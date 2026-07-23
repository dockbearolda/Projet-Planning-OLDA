'use strict';

// Vérifie l'API du registre des MACHINES (réglages du patron) sur le vrai
// serveur Express + base en mémoire : liste par défaut, bornage de l'importance,
// durée facultative, déduplication des slugs et refus d'un corps mal formé.

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

  // 1. Défaut : les 4 postes du flux, importance neutre, durée non renseignée.
  let r = await call('GET', '/api/machines');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.map((m) => m.slug), ['dtf', 'presse', 'trotec', 'uv'],
    'la liste par défaut couvre DTF, Presse, Trotec, UV');
  assert.ok(r.body.every((m) => m.importance === 3 && m.minutesPerUnit === null),
    'par défaut : importance neutre (3) et durée vide');

  // 2. PUT : importance bornée à 1..5, durée arrondie, slug dérivé du nom.
  r = await call('PUT', '/api/machines', [
    { name: 'Trotec', importance: 9, minutesPerUnit: '2.34' },
    { name: 'Broderie', importance: 0 },
    { name: '  ', importance: 4 },                 // nom vide → ignorée
  ]);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.map((m) => m.slug), ['trotec', 'broderie'],
    'les entrées sans nom sont écartées, le slug vient du libellé');
  assert.strictEqual(r.body[0].importance, 5, 'importance plafonnée à 5');
  assert.strictEqual(r.body[0].minutesPerUnit, 2.3, 'durée arrondie au dixième');
  assert.strictEqual(r.body[1].importance, 1, 'importance plancher à 1');

  // 3. Déduplication : deux fois le même slug → la première gagne.
  r = await call('PUT', '/api/machines', [
    { slug: 'dtf', name: 'DTF', importance: 4 },
    { slug: 'dtf', name: 'DTF bis', importance: 2 },
  ]);
  assert.deepStrictEqual(r.body.map((m) => m.name), ['DTF'], 'slug dupliqué : première entrée conservée');

  // 4. Persistance : le GET relit ce qui a été enregistré.
  r = await call('GET', '/api/machines');
  assert.deepStrictEqual(r.body.map((m) => m.slug), ['dtf'], 'le GET reflète le dernier PUT');

  // 5. Corps mal formé (objet au lieu d'un tableau) refusé.
  r = await call('PUT', '/api/machines', { dtf: 3 });
  assert.strictEqual(r.status, 400, 'un corps non-tableau est refusé');

  console.log('✓ machines : défauts, bornage importance, durée, déduplication et refus OK');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
