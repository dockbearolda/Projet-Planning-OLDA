'use strict';

// Vérifie l'alerte de commande (BLOQUÉE / À VOIR + motif) de bout en bout, sur
// le vrai serveur Express branché sur la base en mémoire : validation des
// valeurs, troncature du motif, et surtout la règle « lever l'alerte efface le
// motif » — sinon un motif orphelin resterait collé à une commande débloquée.

const assert = require('node:assert');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

(async () => {
  // server.js appelle init() puis écoute au require : on le laisse faire (un
  // second init() sur pg-mem rejouerait le schéma et échouerait).
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
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };

  const created = await call('POST', '/api/requests', { billing_company: 'Test alerte' });
  assert.strictEqual(created.status, 201);
  const id = created.body.id;
  assert.strictEqual(created.body.flag, null, 'une commande naît sans alerte');

  // 1. Pose d'une alerte avec motif.
  let r = await call('PATCH', `/api/requests/${id}`, { flag: 'bloque', flag_reason: '  Attente BAT client  ' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.flag, 'bloque');
  assert.strictEqual(r.body.flag_reason, 'Attente BAT client', 'le motif est nettoyé de ses espaces');

  // 2. Valeur inconnue refusée (la commande garde son alerte précédente).
  r = await call('PATCH', `/api/requests/${id}`, { flag: 'urgent' });
  assert.strictEqual(r.status, 400, 'un flag hors liste doit être refusé');
  r = await call('PATCH', `/api/requests/${id}`, {});
  assert.strictEqual(r.status, 400, 'un PATCH vide reste refusé');

  // 3. RÈGLE CLÉ : lever l'alerte efface le motif, même sans l'envoyer.
  r = await call('PATCH', `/api/requests/${id}`, { flag: null });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.flag, null);
  assert.strictEqual(r.body.flag_reason, null, 'le motif ne doit pas survivre au déblocage');

  // 4. Chaîne vide = pas d'alerte (le front peut envoyer '' depuis un menu).
  r = await call('PATCH', `/api/requests/${id}`, { flag: 'a_voir', flag_reason: 'Vérifier la teinte' });
  assert.strictEqual(r.body.flag, 'a_voir');
  r = await call('PATCH', `/api/requests/${id}`, { flag: '' });
  assert.strictEqual(r.body.flag, null);
  assert.strictEqual(r.body.flag_reason, null);

  // 5. Motif trop long : tronqué, jamais rejeté (on ne perd pas la saisie).
  const long = 'x'.repeat(400);
  r = await call('PATCH', `/api/requests/${id}`, { flag: 'bloque', flag_reason: long });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.flag_reason.length, 240, 'le motif est tronqué à 240 caractères');

  // 6. Création directe avec alerte (duplication / import).
  const c2 = await call('POST', '/api/requests', { flag: 'a_voir', flag_reason: 'À revoir avec Loïc' });
  assert.strictEqual(c2.status, 201);
  assert.strictEqual(c2.body.flag, 'a_voir');
  assert.strictEqual(c2.body.flag_reason, 'À revoir avec Loïc');

  await call('DELETE', `/api/requests/${id}`);
  await call('DELETE', `/api/requests/${c2.body.id}`);

  console.log('✓ flag-validation : alerte, motif, troncature et nettoyage au déblocage OK');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
