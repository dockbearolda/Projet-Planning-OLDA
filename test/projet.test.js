'use strict';

// Nouveau Projet — le flux comptoir ultra-minimal : client → type → produit.
// On vérifie ici la route POST /api/projets de bout en bout : calcul du prix
// SERVEUR (jamais confiance dans un total envoyé par le client), lignes tasse
// détaillées, lignes sommaires (textile/autres/signalétique), destination,
// et création automatique du client.

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
    type: 'tasse',
    client: { societe: 'Le Temps des Cerises', contact: 'Cédric', whatsapp: '0690479788', type: 'pro' },
    lignes: [{
      quantite: 1, produitId: produit.id, coloris: 'TC 01 Rouge Blanc',
      face1Id: faceLogoAjout.id, face2Id: faceTexte.id, dessousId: dessousAucune.id, batId: batNon.id,
    }],
    delai: 'jour_j',
  };
  let r = await call('POST', '/api/projets', tasseBody);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.projet.prixTotalTtc, 28.8, 'prix recalculé serveur : (10+8+6)×1.2');
  assert.strictEqual(r.body.projet.stage, 'chiffrage');
  assert.strictEqual(r.body.projet.subStage, 'a_chiffrer');
  assert.strictEqual(r.body.projet.client.societe, 'Le Temps des Cerises');
  assert.strictEqual(r.body.projet.lignes[0].produit.label, 'Tasse Céramique 350 ml');

  // Le total envoyé par le client (s'il y en avait un) est IGNORÉ : le serveur
  // recalcule toujours depuis les ids de catalogue.
  const triche = await call('POST', '/api/projets', { ...tasseBody, prixTotalTtc: 1 });
  assert.strictEqual(triche.body.projet.prixTotalTtc, 28.8, 'le total client est ignoré, jamais fait confiance');

  // 2. Deux lignes tasse dans le même projet : le total s'additionne.
  const deuxLignes = await call('POST', '/api/projets', {
    ...tasseBody,
    lignes: [
      { quantite: 2, produitId: produit.id, face1Id: faceLogoAjout.id, face2Id: '', dessousId: dessousAucune.id, batId: batNon.id },
      { quantite: 1, produitId: produit.id, face1Id: '', face2Id: '', dessousId: dessousAucune.id, batId: batNon.id },
    ],
    delai: 'j5',
  });
  assert.strictEqual(deuxLignes.status, 201, JSON.stringify(deuxLignes.body));
  // Ligne 1 : qty 2 × (10+8+0) = 36 ; ligne 2 : qty 1 × 10 = 10 ; pas de majoration (j5) → 46.
  assert.strictEqual(deuxLignes.body.projet.prixTotalTtc, 46);

  // 3. Type textile/autres/signalétique : ligne sommaire, prix saisi à la main.
  const textile = await call('POST', '/api/projets', {
    kind: 'demande',
    type: 'textile',
    client: { societe: 'Client Textile', type: 'pro' },
    lignes: [{ quantite: 5, description: '5 polos brodés équipe', prixTtcManuel: 150 }],
    delai: 'j10',
  });
  assert.strictEqual(textile.status, 201, JSON.stringify(textile.body));
  assert.strictEqual(textile.body.projet.prixTotalTtc, 150);
  assert.strictEqual(textile.body.projet.stage, 'demande');

  // 4. Sans lignes → refusé (un projet vide n'a pas de sens).
  const vide = await call('POST', '/api/projets', { kind: 'commande', type: 'tasse', client: { societe: 'X' }, lignes: [] });
  assert.strictEqual(vide.status, 400);

  // 5. Type inconnu → refusé.
  const typeInconnu = await call('POST', '/api/projets', { kind: 'commande', type: 'zzz', client: { societe: 'X' }, lignes: [{ quantite: 1, description: 'x', prixTtcManuel: 1 }] });
  assert.strictEqual(typeInconnu.status, 400);

  // 6. Id de catalogue inconnu (tasse) → refusé, pas un crash silencieux à 0€.
  const idInconnu = await call('POST', '/api/projets', {
    kind: 'commande', type: 'tasse', client: { societe: 'X' },
    lignes: [{ quantite: 1, produitId: 'nimporte-quoi', face1Id: '', face2Id: '', dessousId: dessousAucune.id, batId: batNon.id }],
  });
  assert.strictEqual(idInconnu.status, 400);

  // 7. La ligne atterrit dans le planning, lisible sans ouvrir le JSON.
  const list = await (await fetch(`${base}/api/requests?stage=chiffrage`)).json();
  const row = list.find((x) => x.id === r.body.id);
  assert.ok(row, 'le projet doit apparaître à l\'étape chiffrage');
  assert.strictEqual(row.project_value, 28.8);
  assert.match(row.product, /Tasse Céramique 350 ml/);

  // 8. Le client est créé automatiquement (comme pour Commande).
  const clients = await (await fetch(`${base}/api/clients`)).json();
  assert.ok(clients.some((c) => c.entreprise === 'Le Temps des Cerises'), 'le client du projet est créé');

  console.log('✓ nouveau projet : calcul prix serveur, lignes multiples, sommaire, refus et planning OK');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
