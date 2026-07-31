'use strict';

// SUPPLÉMENTS EXPRESS de la vente directe : le pourcentage de majoration par
// palier de délai (5 / 10 / 15 jours). Décision commerciale, pas constante de
// code — elle vit en app_meta et se règle depuis l'écran du comptoir, sans
// redéploiement.
//
// Ce que ce test protège, c'est surtout le REFUS : un taux se saisit à la main
// sur une tablette, entre deux clients. Une faute de frappe qui passerait
// facturerait le client suivant au mauvais prix, et personne ne le verrait avant
// le ticket. On vérifie donc qu'une valeur aberrante est rejetée ET que
// l'ancienne reste en place.

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

  // 1. Barème par défaut, tant que personne n'y a touché : c'est le barème
  //    historique de l'écran, à l'identique (la semaine à +20 %, puis +10 %).
  let r = await call('GET', '/api/supplements-express');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, { j5: 20, j10: 10, j15: 0 }, 'barème par défaut = celui d’avant le réglage');

  // 2. Enregistrement d'un nouveau barème, relu tel quel au GET suivant.
  r = await call('PUT', '/api/supplements-express', { j5: 25, j10: 15, j15: 5 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body, { j5: 25, j10: 15, j15: 5 });
  r = await call('GET', '/api/supplements-express');
  assert.deepStrictEqual(r.body, { j5: 25, j10: 15, j15: 5 }, 'le barème est bien persisté');

  // 3. Palier omis = palier inchangé : on peut ne corriger qu'une ligne.
  r = await call('PUT', '/api/supplements-express', { j10: 12 });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, { j5: 25, j10: 12, j15: 5 }, 'seul le palier envoyé bouge');

  // 4. REFUS. Chaque cas repart de {25, 12, 5} et doit l'y laisser : un taux
  //    refusé ne doit jamais être confondu avec un taux enregistré.
  for (const mauvais of [{ j5: 2000 }, { j5: -5 }, { j10: 'vingt' }, { j15: null }]) {
    r = await call('PUT', '/api/supplements-express', mauvais);
    assert.strictEqual(r.status, 400, `refus attendu pour ${JSON.stringify(mauvais)}`);
    assert.match(r.body.error, /entre 0 et 100/, 'le refus dit ce qui est attendu');
    const apres = await call('GET', '/api/supplements-express');
    assert.deepStrictEqual(apres.body, { j5: 25, j10: 12, j15: 5 },
      `le barème ne doit pas bouger après ${JSON.stringify(mauvais)}`);
  }

  // 5. Les bornes elles-mêmes sont valides : 0 % (aucun supplément) et 100 %.
  r = await call('PUT', '/api/supplements-express', { j5: 0, j10: 100, j15: 0 });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, { j5: 0, j10: 100, j15: 0 });

  // 6. Un demi-point se garde (7,5 %) ; au-delà on arrondit au dixième.
  r = await call('PUT', '/api/supplements-express', { j5: 7.5, j10: 12.34, j15: 0 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.j5, 7.5, 'le demi-point est conservé');
  assert.strictEqual(r.body.j10, 12.3, 'arrondi au dixième');

  console.log('✓ suppléments express : barème par défaut, enregistrement partiel, refus et bornes OK');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
