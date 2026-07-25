'use strict';

// Catalogue tarifs TASSE (réglages du patron) : produits, options face/dessous,
// BAT, avec prix d'achat / vente / temps MO / temps machine. Stocké en app_meta,
// même principe que les machines. Pré-rempli au premier démarrage avec les
// valeurs du classeur patron.

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
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };

  // 1. Seed par défaut : 3 tasses, 6 options face, 6 options dessous, 2 BAT.
  let r = await call('GET', '/api/tarifs-tasse');
  assert.strictEqual(r.status, 200);
  const produits = r.body.filter((a) => a.categorie === 'produit');
  const faces = r.body.filter((a) => a.categorie === 'face');
  const dessous = r.body.filter((a) => a.categorie === 'dessous');
  const bat = r.body.filter((a) => a.categorie === 'bat');
  assert.strictEqual(produits.length, 3, 'trois tasses par défaut');
  assert.strictEqual(faces.length, 7, 'sept options face par défaut');
  assert.strictEqual(dessous.length, 6, 'six options dessous par défaut');
  assert.strictEqual(bat.length, 2, 'BAT oui/non par défaut');
  const tasse350 = produits.find((a) => a.designation === 'Tasse Céramique 350 ml');
  assert.ok(tasse350, 'la tasse céramique 350ml est dans le seed');
  assert.strictEqual(tasse350.prixVenteTtc, 10);
  assert.strictEqual(tasse350.prixAchat, 1.78);

  // 2. Paramètres par défaut : taux horaires + TGCA du classeur.
  r = await call('GET', '/api/tarifs-tasse/parametres');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.tauxHoraireMo, 25);
  assert.strictEqual(r.body.tauxHoraireMachine, 25);
  assert.strictEqual(r.body.tgca, 0.04);

  // 3. PUT articles : remplace la liste, valide la forme, filtre les entrées vides.
  r = await call('PUT', '/api/tarifs-tasse', [
    { categorie: 'produit', designation: 'Tasse Test', prixAchat: 1, prixVenteTtc: 12, tempsMoMin: 1, tempsMachineMin: 0, actif: true },
    { categorie: 'produit', designation: '   ' },   // désignation vide → écartée
    { categorie: 'zzz', designation: 'Mauvaise catégorie' },   // catégorie invalide → écartée
  ]);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.length, 1, 'seule l\'entrée valide est conservée');
  assert.strictEqual(r.body[0].designation, 'Tasse Test');
  assert.strictEqual(r.body[0].prixVenteTtc, 12);
  assert.ok(r.body[0].id, 'un id est attribué');
  assert.strictEqual(r.body[0].actif, true);

  r = await call('GET', '/api/tarifs-tasse');
  assert.strictEqual(r.body.length, 1, 'le GET reflète le dernier PUT');

  r = await call('PUT', '/api/tarifs-tasse', { not: 'an array' });
  assert.strictEqual(r.status, 400, 'un corps non-tableau est refusé');

  // 4. PUT paramètres : bornage numérique simple.
  r = await call('PUT', '/api/tarifs-tasse/parametres', { tauxHoraireMo: 30, tauxHoraireMachine: 28, tgca: 0.05 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.tauxHoraireMo, 30);
  assert.strictEqual(r.body.tgca, 0.05);

  r = await call('PUT', '/api/tarifs-tasse/parametres', { tauxHoraireMo: 'pas un nombre' });
  assert.strictEqual(r.status, 400);

  console.log('✓ tarifs tasse : seed, GET/PUT articles et paramètres OK');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
