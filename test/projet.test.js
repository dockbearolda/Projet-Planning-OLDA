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

  // 9. DÉLAI OBLIGATOIRE : sans raccourci ni date précise, la fiche est refusée.
  //    C'est ce qui garantit une date butoir sur chaque ligne du planning — il
  //    n'y a plus de repli silencieux sur « 5 jours ».
  const sansDelai = await call('POST', '/api/projets', {
    kind: 'commande',
    client: { societe: 'Sans Délai', type: 'pro' },
    lignes: [{ type: 'textile', quantite: 1, description: 'x', prixTtcManuel: 10 }],
  });
  assert.strictEqual(sansDelai.status, 400, 'un projet sans délai est refusé');
  assert.match(sansDelai.body.error, /délai est obligatoire/);

  // Une date mal formée ne vaut pas un délai : elle ne doit pas passer en douce.
  const dateBidon = await call('POST', '/api/projets', {
    kind: 'commande',
    client: { societe: 'Date Bidon', type: 'pro' },
    lignes: [{ type: 'textile', quantite: 1, description: 'x', prixTtcManuel: 10 }],
    deadline: '2026-02-30',
  });
  assert.strictEqual(dateBidon.status, 400, 'une date civile inexistante est refusée');

  // 10. DATE PRÉCISE : elle devient l'échéance telle quelle, et n'applique
  //     AUCUNE majoration (on ne facture pas l'urgence d'une date au large).
  const datePrecise = await call('POST', '/api/projets', {
    kind: 'commande',
    client: { societe: 'Mariage Dupont', type: 'perso' },
    lignes: [{ type: 'textile', quantite: 10, description: '10 t-shirts mariage', prixTtcManuel: 200 }],
    deadline: '2026-09-14',
  });
  assert.strictEqual(datePrecise.status, 201, JSON.stringify(datePrecise.body));
  assert.strictEqual(datePrecise.body.projet.deadline, '2026-09-14', 'la date choisie devient l’échéance');
  assert.strictEqual(datePrecise.body.projet.prixTotalTtc, 200, 'une date précise ne majore pas le prix');
  assert.strictEqual(datePrecise.body.projet.delai.majoration, 0);

  // 11. HT calculé à partir du TTC et du taux TGCA (4 % par défaut) : 200 / 1.04.
  assert.strictEqual(datePrecise.body.projet.prixTotalHt, 192.31, 'le HT se déduit du TTC');

  // 12. PAIEMENT : les cinq informations arrivent sur la ligne du planning.
  const paye = await call('POST', '/api/projets', {
    kind: 'commande',
    client: { societe: 'Acompte SARL', type: 'pro' },
    lignes: [{ type: 'textile', quantite: 1, description: 'bâche', prixTtcManuel: 500 }],
    delai: 'j10',
    paiement: { acompteDemande: true, acompteVerse: true, acompteMontant: 150, paye: false, mode: 'virement' },
  });
  assert.strictEqual(paye.status, 201, JSON.stringify(paye.body));
  const ligne = (await (await fetch(`${base}/api/requests?stage=demande_chiffrage`)).json())
    .find((x) => x.id === paye.body.id);
  assert.ok(ligne, 'la ligne payée est bien au planning');
  assert.strictEqual(ligne.acompte_demande, true);
  assert.strictEqual(ligne.acompte_verse, true);
  assert.strictEqual(Number(ligne.acompte_montant), 150);
  assert.strictEqual(ligne.paye, false);
  assert.strictEqual(ligne.paiement_mode, 'virement');

  // Sans acompte versé, aucune somme n'est retenue : une somme sans encaissement
  // ne veut rien dire et se lirait comme de l'argent reçu.
  const sansAcompte = await call('POST', '/api/projets', {
    kind: 'commande',
    client: { societe: 'Sans Acompte', type: 'pro' },
    lignes: [{ type: 'textile', quantite: 1, description: 'x', prixTtcManuel: 20 }],
    delai: 'j5',
    paiement: { acompteDemande: true, acompteVerse: false, acompteMontant: 999, mode: 'cb' },
  });
  assert.strictEqual(sansAcompte.body.projet.paiement.acompteMontant, null,
    'pas d’acompte versé → pas de somme retenue');

  // Rien de renseigné = null, PAS « non payé » : on n'affirme pas à la place de
  // l'employé qui n'a rien coché.
  const paiementVide = await call('POST', '/api/projets', {
    kind: 'commande',
    client: { societe: 'Rien Coché', type: 'pro' },
    lignes: [{ type: 'textile', quantite: 1, description: 'x', prixTtcManuel: 20 }],
    delai: 'j5',
  });
  assert.strictEqual(paiementVide.body.projet.paiement.paye, null);
  assert.strictEqual(paiementVide.body.projet.paiement.acompteDemande, null);

  // Un mode de paiement inconnu est ignoré plutôt que stocké tel quel.
  const modeInconnu = await call('POST', '/api/projets', {
    kind: 'commande',
    client: { societe: 'Mode Inconnu', type: 'pro' },
    lignes: [{ type: 'textile', quantite: 1, description: 'x', prixTtcManuel: 20 }],
    delai: 'j5',
    paiement: { mode: 'bitcoin' },
  });
  assert.strictEqual(modeInconnu.body.projet.paiement.mode, null);

  // 13. Le tiroir de détail modifie ces mêmes champs par PATCH : c'est le geste
  //     quotidien (« l'acompte est tombé »). Les valeurs sont validées, pas
  //     recopiées telles quelles.
  const pid = paye.body.id;
  const patch = async (body) => {
    const res = await fetch(`${base}/api/requests/${pid}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  let up = await patch({ paye: true, acompte_montant: '250,00'.replace(',', '.'), paiement_mode: 'cheque' });
  assert.strictEqual(up.status, 200, JSON.stringify(up.body));
  assert.strictEqual(up.body.paye, true);
  assert.strictEqual(Number(up.body.acompte_montant), 250);
  assert.strictEqual(up.body.paiement_mode, 'cheque');

  // Remettre à « non renseigné » reste possible : c'est un état à part entière.
  up = await patch({ paye: null });
  assert.strictEqual(up.body.paye, null, 'on peut revenir à « non renseigné »');

  assert.strictEqual((await patch({ paiement_mode: 'bitcoin' })).status, 400, 'mode de paiement inconnu refusé');
  assert.strictEqual((await patch({ acompte_montant: -5 })).status, 400, 'acompte négatif refusé');
  assert.strictEqual((await patch({ paye: 'peut-être' })).status, 400, 'booléen fantaisiste refusé');

  console.log('✓ nouveau projet : prix serveur, HT/TTC, délai obligatoire, paiement, panier mixte et refus OK');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
