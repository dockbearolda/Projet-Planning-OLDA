'use strict';

// LES DEUX SÉRIES DE NUMÉROS DU COMPTOIR
// ===========================================================================
// Une vente directe repart avec « 26.07.30-001 » sur son ticket ; une demande
// de devis avec « DEV-26.07.30-001 ». Ce sont les deux seuls repères que le
// client rapporte à l'atelier : « j'ai commandé le trente, numéro un ». Trois
// garanties, et elles ne se négocient pas.
//
//   1. UN RANG ATTRIBUÉ N'EST JAMAIS RÉUTILISÉ. Le compteur vit en base
//      (`app_meta`), incrémenté en une requête atomique — jamais déduit des
//      lignes en place, sinon deux postes qui encaissent dans la même seconde
//      remettent le même papier à deux clients.
//   2. CHAQUE JOURNÉE REPART À 001, parce que c'est ce que le patron dicte au
//      téléphone.
//   3. LES DEUX SÉRIES SONT INDÉPENDANTES : une demande et une vente du même
//      jour ne se disputent pas un numéro.
//
// POURQUOI CE FICHIER EXISTE (01/09/2026)
// ---------------------------------------------------------------------------
// Ces trois garanties étaient vérifiées dans `projet.test.js` et
// `devis.test.js` — deux fichiers construits autour de `POST /api/projets`,
// l'ancien « Nouveau Projet » interne. Cette route n'avait plus d'écran depuis
// le 31/07 et la production l'a confirmé : huit dossiers, aucun depuis. Elle
// est partie le 01/09, et ses deux fichiers de test avec elle.
//
// Les numéros, eux, sont bien VIVANTS : les deux écrans du comptoir les
// réservent à chaque prise de commande. Leurs garanties déménagent donc ici,
// dans un fichier qui ne parle que d'elles. `robustesse.test.js` vérifie en
// plus le cas qui fait vraiment mal : douze encaissements simultanés.

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

  const call = async (method, chemin, corps) => {
    const res = await fetch(base + chemin, {
      method,
      headers: corps !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };

  // -------------------------------------------------------------------------
  // 1. LA VENTE DIRECTE
  // -------------------------------------------------------------------------
  const v1 = await call('POST', '/api/vente/numero', { jour: '2026-07-30' });
  assert.strictEqual(v1.status, 201, JSON.stringify(v1.body));
  assert.strictEqual(v1.body.numero, '26.07.30-001');
  const v2 = await call('POST', '/api/vente/numero', { jour: '2026-07-30' });
  assert.strictEqual(v2.body.numero, '26.07.30-002',
    'le rang du jour avance : deux postes ne peuvent pas remettre le même papier');
  const v3 = await call('POST', '/api/vente/numero', { jour: '2026-07-31' });
  assert.strictEqual(v3.body.numero, '26.07.31-001', 'chaque journée repart à 001');

  // -------------------------------------------------------------------------
  // 2. LA DEMANDE DE DEVIS — même garantie, série à part
  // -------------------------------------------------------------------------
  const d1 = await call('POST', '/api/devis/numero', { jour: '2026-07-30' });
  assert.strictEqual(d1.status, 201, JSON.stringify(d1.body));
  assert.strictEqual(d1.body.numero, 'DEV-26.07.30-001');
  const d2 = await call('POST', '/api/devis/numero', { jour: '2026-07-30' });
  assert.strictEqual(d2.body.numero, 'DEV-26.07.30-002', 'le rang du jour avance');
  const d3 = await call('POST', '/api/devis/numero', { jour: '2026-07-31' });
  assert.strictEqual(d3.body.numero, 'DEV-26.07.31-001', 'chaque journée repart à 001');

  // La série des ventes n'a pas bougé pendant ce temps : deux séries, deux clés.
  const apres = await call('POST', '/api/vente/numero', { jour: '2026-07-30' });
  assert.strictEqual(apres.body.numero, '26.07.30-003',
    'la série des ventes est indépendante de celle des devis');

  // -------------------------------------------------------------------------
  // 3. UNE HORLOGE ABSENTE N'ARRÊTE PAS LE COMPTOIR
  // -------------------------------------------------------------------------
  // Jour absent ou illisible : le serveur prend le sien plutôt que de refuser.
  // Le comptoir ne s'arrête pas pour une horloge — et le serveur est à l'heure
  // de l'atelier, pas à celle du poste.
  for (const [chemin, forme] of [
    ['/api/vente/numero', /^\d\d\.\d\d\.\d\d-\d{3}$/],
    ['/api/devis/numero', /^DEV-\d\d\.\d\d\.\d\d-\d{3}$/],
  ]) {
    const sansJour = await call('POST', chemin, {});
    assert.strictEqual(sansJour.status, 201, `${chemin} accepte un corps sans jour`);
    assert.match(sansJour.body.numero, forme, `${chemin} rend un numéro bien formé`);
    const illisible = await call('POST', chemin, { jour: 'pas-une-date' });
    assert.strictEqual(illisible.status, 201, `${chemin} accepte un jour illisible`);
    assert.match(illisible.body.numero, forme, '… et rend quand même un numéro utilisable');
  }

  console.log('✓ numéros du jour : deux séries indépendantes, un rang jamais réutilisé, une horloge absente n’arrête rien');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
