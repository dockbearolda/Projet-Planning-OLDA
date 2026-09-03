'use strict';

// ===========================================================================
// LA FACTURE — numérotation continue, immuabilité, idempotence (03/09/2026)
// ===========================================================================
// Ce que ce fichier tient, dans l'esprit du dépôt : les bugs vivent dans la
// concurrence et le réseau qui tombe, pas dans le cas nominal.
//   1. La numérotation ne laisse JAMAIS de trou : un rejet ne consomme pas de
//      rang, une resoumission après perte de réponse réseau retombe sur la
//      ligne déjà créée au lieu d'en brûler un second.
//   2. Deux émissions concurrentes pour le MÊME dossier ne créent qu'une
//      seule ligne et ne consomment qu'un seul numéro.
//   3. Aucune route d'écriture n'existe après création — l'immutabilité est
//      un FAIT d'API, pas une convention qu'on espère respectée.

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

  // `n` DOIT VARIER D'UN APPEL À L'AUTRE : /api/comptoir/projet dédoublonne
  // par EMPREINTE (hash du nom client + montant + articles…, index unique
  // sur fiche->>'empreinte' — voir db.js « poserUniciteEmpreinte »), pas
  // seulement par référence explicite. Deux paniers byte-pour-byte
  // identiques sont donc traités comme LE MÊME dossier renvoyé deux fois
  // (le comportement voulu, protège contre une tablette qui réessaie) — ce
  // qui n'est PAS ce qu'on veut tester ici : chaque `n` simule une vente
  // RÉELLEMENT différente.
  const dossier = (n) => fetch(`${base}/api/comptoir/projet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'Vente directe',
      clientObj: { name: `Client Facture Test ${n}`, type: 'pro' },
      amount: 40.04,
      articles: [{ label: 'T-shirt logo coeur', qty: 2, amount: 30 }, { label: 'Tasse céramique', qty: 1, amount: 8.5 }],
      paiement: { mode: 'cb' },
    }),
  }).then((r) => r.json());

  const factureBody = (dossierId, n) => ({
    dossierId,
    client: { nom: `Client Facture Test ${n}`, ville: 'Marigot', type: 'pro' },
    mode: 'cb',
    regime: 'tgca', tauxTgca: 0.04, arrondi: 'aucun', vedette: 'ttc',
    ajustement: { unite: 'eur', valeur: 0 },
    lignes: [
      { designation: 'T-shirt logo coeur', quantite: 2, unitaireHt: 15 },
      { designation: 'Tasse céramique', quantite: 1, unitaireHt: 8.5 },
    ],
  });

  // --- Émission nominale ------------------------------------------------------
  const d1 = await dossier(1);
  assert.ok(d1.id, 'le dossier doit se créer');
  const r1 = await fetch(`${base}/api/factures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(factureBody(d1.id, 1)),
  });
  assert.strictEqual(r1.status, 201);
  const f1 = await r1.json();
  assert.match(f1.numero, /^FA-\d{4}-\d{4}$/, `numéro mal formé : ${f1.numero}`);
  assert.strictEqual(f1.montantTtc, 40.04);
  // LE DOCUMENT ARCHIVÉ EST LA DONNÉE BRUTE (saisie + entreprise figée), PAS
  // UN RENDU : c'est modeleFacture/dessinerFacture, côté client, qui
  // composent le papier — le serveur ne formate rien (voir server.js).
  assert.strictEqual(f1.document.saisie.numero, f1.numero);
  assert.strictEqual(f1.document.saisie.mode, 'cb');
  assert.strictEqual(f1.document.saisie.client.nom, 'Client Facture Test 1');
  assert.strictEqual(f1.document.saisie.lignes.length, 2);
  assert.ok('entreprise' in f1.document, 'l’identité de l’atelier doit être figée dans le document archivé');

  // --- Un dossier sans article ou sans mode est rejeté, SANS consommer de numéro
  const d2 = await dossier(2);
  const avantRejet = await fetch(`${base}/api/factures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...factureBody(d2.id, 2), mode: 'inconnu' }),
  });
  assert.strictEqual(avantRejet.status, 400);
  const okApresRejet = await fetch(`${base}/api/factures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(factureBody(d2.id, 2)),
  });
  assert.strictEqual(okApresRejet.status, 201);
  const f2 = await okApresRejet.json();
  // Les deux numéros doivent être CONSÉCUTIFS : le rejet n'a pas brûlé de rang.
  const rangDe = (num) => Number(num.split('-')[2]);
  assert.strictEqual(rangDe(f2.numero), rangDe(f1.numero) + 1,
    `un rejet a consommé un numéro : ${f1.numero} puis ${f2.numero}`);

  // --- Resoumission (réseau qui avale la réponse) : pas de doublon, pas de second numéro
  const d3 = await dossier(3);
  const body3 = factureBody(d3.id, 3);
  const [ra, rb] = await Promise.all([
    fetch(`${base}/api/factures`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body3) }),
    fetch(`${base}/api/factures`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body3) }),
  ]);
  const [fa, fb] = await Promise.all([ra.json(), rb.json()]);
  assert.strictEqual(fa.id, fb.id, 'deux émissions concurrentes pour le même dossier doivent rendre LA MÊME facture');
  assert.strictEqual(fa.numero, fb.numero);

  // --- Un dossier déjà facturé refuse une SECONDE facture distincte ----------
  const encore = await fetch(`${base}/api/factures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(factureBody(d1.id, 1)),
  });
  const encoreJson = await encore.json();
  assert.strictEqual(encoreJson.id, f1.id, 'redemander une facture pour un dossier déjà facturé rend l’EXISTANTE');
  assert.strictEqual(encoreJson.numero, f1.numero);

  // --- Relecture depuis la fiche -----------------------------------------------
  const relue = await fetch(`${base}/api/requests/${d1.id}/facture`);
  assert.strictEqual(relue.status, 200);
  const relueJson = await relue.json();
  assert.strictEqual(relueJson.numero, f1.numero);
  assert.deepStrictEqual(relueJson.document, f1.document, 'la relecture ne recalcule rien : elle rend le document archivé tel quel');

  const introuvable = await fetch(`${base}/api/requests/00000000-0000-0000-0000-000000000000/facture`);
  assert.strictEqual(introuvable.status, 404);

  // --- Aucune route d'écriture n'existe ----------------------------------------
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const rep = await fetch(`${base}/api/factures/${f1.id}`, { method });
    assert.ok([404, 405].includes(rep.status), `${method} /api/factures/:id doit être refusé (reçu ${rep.status})`);
  }

  console.log('✓ factures-api : numérotation sans trou, idempotence, immutabilité, relecture');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
