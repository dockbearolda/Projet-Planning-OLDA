'use strict';

// Nouveau Projet — le flux comptoir ultra-minimal : client → panier → prix.
// Un projet est un PANIER : plusieurs produits, de types différents (tasse,
// textile…), pour un seul client et un seul enregistrement — façon caisse
// SumUp. On vérifie ici POST /api/projets de bout en bout : calcul du prix
// SERVEUR (jamais confiance dans un total envoyé par le client), panier
// mixte (types différents dans le même projet), refus et planning.

const assert = require('node:assert');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

(async () => {
  process.env.PORT = '0';
  const app = require('../server');
  const base = await new Promise((resolve) => {
    const check = () => {
      const s = app && app.__server;
      if (s && s.listening) resolve(`http://127.0.0.1:${s.address().port}`);
      else setTimeout(check, 25);
    };
    check();
  });

  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  const tarifs = (await call('GET', '/api/tarifs-tasse')).body;
  const produit = tarifs.find((a) => a.categorie === 'produit' && a.designation === 'Tasse Céramique 350 ml');
  const faceLogoAjout = tarifs.find((a) => a.categorie === 'face' && a.designation === 'Logo OLDA à ajouter');
  const faceTexte = tarifs.find((a) => a.categorie === 'face' && a.designation === 'Texte personnalisé simple');
  const dessousAucune = tarifs.find((a) => a.categorie === 'dessous' && a.designation === 'Aucune');
  const batNon = tarifs.find((a) => a.categorie === 'bat' && a.designation === 'Non');

  // 1. Une tasse, Jour J (+20%) : prix TTC = (10+8+6+0+0) × 1 × 1.20 = 28.8.
  const tasseBody = {
    kind: 'commande',
    client: { societe: 'Le Temps des Cerises', contact: 'Cédric', whatsapp: '0690479788', type: 'pro' },
    lignes: [{
      type: 'tasse', quantite: 1, produitId: produit.id, coloris: 'TC 01 Rouge Blanc',
      face1Id: faceLogoAjout.id, face2Id: faceTexte.id, dessousId: dessousAucune.id, batId: batNon.id,
    }],
    delai: 'jour_j',
  };
  let r = await call('POST', '/api/projets', tasseBody);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.projet.prixTotalTtc, 28.8, 'prix recalculé serveur : (10+8+6)×1.2');
  assert.strictEqual(r.body.projet.stage, 'demande_chiffrage');
  assert.strictEqual(r.body.projet.subStage, 'a_chiffrer');
  assert.strictEqual(r.body.projet.client.societe, 'Le Temps des Cerises');
  assert.strictEqual(r.body.projet.lignes[0].produit.label, 'Tasse Céramique 350 ml');
  assert.strictEqual(r.body.projet.lignes[0].type.id, 'tasse');

  // Le total envoyé par le client (s'il y en avait un) est IGNORÉ : le serveur
  // recalcule toujours depuis les ids de catalogue.
  const triche = await call('POST', '/api/projets', { ...tasseBody, prixTotalTtc: 1 });
  assert.strictEqual(triche.body.projet.prixTotalTtc, 28.8, 'le total client est ignoré, jamais fait confiance');

  // 2. PANIER MIXTE : une tasse ET une ligne textile dans le MÊME projet,
  // pour le même client — l'essentiel de la demande « façon SumUp ».
  const panierMixte = await call('POST', '/api/projets', {
    kind: 'commande',
    client: { societe: 'Le Temps des Cerises', type: 'pro' },
    lignes: [
      { type: 'tasse', quantite: 2, produitId: produit.id, face1Id: faceLogoAjout.id, face2Id: '', dessousId: dessousAucune.id, batId: batNon.id },
      { type: 'textile', quantite: 5, description: '5 polos brodés équipe', prixTtcManuel: 150 },
    ],
    delai: 'j5',
  });
  assert.strictEqual(panierMixte.status, 201, JSON.stringify(panierMixte.body));
  // Tasse : 2 × (10+8) = 36 ; textile : 150 ; pas de majoration (j5) → 186.
  assert.strictEqual(panierMixte.body.projet.prixTotalTtc, 186);
  assert.strictEqual(panierMixte.body.projet.lignes.length, 2);
  assert.strictEqual(panierMixte.body.projet.lignes[0].type.id, 'tasse');
  assert.strictEqual(panierMixte.body.projet.lignes[1].type.id, 'textile');
  assert.strictEqual(panierMixte.body.projet.quantite, 7, 'quantité totale = somme des deux lignes (2 + 5)');

  // 3. Type textile/autres/signalétique seul : ligne sommaire, prix manuel.
  const textile = await call('POST', '/api/projets', {
    kind: 'demande',
    client: { societe: 'Client Textile', type: 'pro' },
    lignes: [{ type: 'textile', quantite: 5, description: '5 polos brodés équipe', prixTtcManuel: 150 }],
    delai: 'j10',
  });
  assert.strictEqual(textile.status, 201, JSON.stringify(textile.body));
  assert.strictEqual(textile.body.projet.prixTotalTtc, 150);
  assert.strictEqual(textile.body.projet.stage, 'demande_chiffrage');

  // 4. Sans lignes → refusé (un panier vide n'a pas de sens).
  const vide = await call('POST', '/api/projets', { kind: 'commande', client: { societe: 'X' }, lignes: [] });
  assert.strictEqual(vide.status, 400);

  // 5. Type inconnu sur une ligne → refusé.
  const typeInconnu = await call('POST', '/api/projets', { kind: 'commande', client: { societe: 'X' }, lignes: [{ type: 'zzz', quantite: 1, description: 'x', prixTtcManuel: 1 }] });
  assert.strictEqual(typeInconnu.status, 400);

  // 6. Id de catalogue inconnu (tasse) → refusé, pas un crash silencieux à 0€.
  const idInconnu = await call('POST', '/api/projets', {
    kind: 'commande', client: { societe: 'X' },
    lignes: [{ type: 'tasse', quantite: 1, produitId: 'nimporte-quoi', face1Id: '', face2Id: '', dessousId: dessousAucune.id, batId: batNon.id }],
  });
  assert.strictEqual(idInconnu.status, 400);

  // 7. La ligne atterrit dans le planning, lisible sans ouvrir le JSON.
  const list = await (await fetch(`${base}/api/requests?stage=demande_chiffrage`)).json();
  const row = list.find((x) => x.id === r.body.id);
  assert.ok(row, 'le projet doit apparaître à l\'étape chiffrage');
  assert.strictEqual(row.project_value, 28.8);
  assert.match(row.product, /Tasse Céramique 350 ml/);

  // 8. Le client est créé automatiquement (comme pour Commande).
  const clients = await (await fetch(`${base}/api/clients`)).json();
  assert.ok(clients.some((c) => c.entreprise === 'Le Temps des Cerises'), 'le client du projet est créé');

  console.log('✓ nouveau projet : calcul prix serveur, panier mixte, refus et planning OK');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
