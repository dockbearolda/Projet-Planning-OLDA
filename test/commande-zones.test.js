'use strict';

// Vérifie les EMPLACEMENTS d'impression de la prise de commande : ceux du
// catalogue (dont « Avant gauche »), et ceux que le comptoir ajoute à la volée.
// L'enjeu : une zone créée sur la fiche doit être acceptée à l'enregistrement
// et retrouvée par les autres postes, sans redéploiement.

const assert = require('node:assert');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

const jour = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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

  // 1. Le catalogue sert les zones de base, « Avant gauche » comprise.
  let r = await call('GET', '/api/commande/catalog');
  assert.strictEqual(r.status, 200);
  const ids = r.body.zones.map((z) => z.id);
  assert.ok(ids.includes('avant_g'), '« Avant gauche » est au catalogue');
  assert.ok(r.body.zones.every((z) => !z.custom), 'aucune zone du catalogue n\'est effaçable');

  // 2. Ajout au comptoir : l'identifiant suit la convention du catalogue.
  r = await call('POST', '/api/commande/zones', { label: 'Bas du dos' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.zone.id, 'bas_du_dos');
  assert.strictEqual(r.body.zone.custom, true, 'une zone ajoutée est effaçable');
  assert.ok(r.body.zones.map((z) => z.id).includes('bas_du_dos'), 'la liste rendue contient la nouvelle zone');

  // 3. Idempotent : le même libellé ne crée pas de doublon, accents compris.
  r = await call('POST', '/api/commande/zones', { label: 'Bas du dos' });
  assert.strictEqual(r.body.zones.filter((z) => z.id === 'bas_du_dos').length, 1, 'pas de doublon');

  // 4. Libellé vide refusé.
  r = await call('POST', '/api/commande/zones', { label: '   ' });
  assert.strictEqual(r.status, 400, 'un libellé vide est refusé');

  // 5. Un libellé qui retombe sur une zone du catalogue rend celle du catalogue.
  r = await call('POST', '/api/commande/zones', { label: 'Avant gauche' });
  assert.strictEqual(r.body.zone.id, 'avant_g', 'pas de zone parallèle au catalogue');
  assert.strictEqual(r.body.zones.filter((z) => z.id === 'avant_g').length, 1);

  // 6. La nouvelle zone est acceptée à l'enregistrement d'une commande.
  const commande = {
    kind: 'commande',
    client: { societe: 'Atelier test', type: 'pro' },
    articles: [{
      vetement: 'Sweat à capuche', quantite: 2,
      zones: [
        { zone: 'avant_g', consigne: 'Logo brodé' },
        { zone: 'bas_du_dos', consigne: 'Site web' },
      ],
    }],
    deadline: jour(7),
  };
  r = await call('POST', '/api/commande', commande);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const posees = r.body.commande.articles[0].zones;
  assert.deepStrictEqual(posees.map((z) => z.zoneLabel), ['Avant gauche', 'Bas du dos'],
    'le libellé est recopié dans la commande');

  // 7. Retrait : la zone ajoutée disparaît de la liste, celles du catalogue non.
  r = await call('DELETE', '/api/commande/zones/bas_du_dos');
  assert.strictEqual(r.status, 200);
  assert.ok(!r.body.zones.map((z) => z.id).includes('bas_du_dos'), 'la zone ajoutée est retirée');
  r = await call('DELETE', '/api/commande/zones/avant_g');
  assert.strictEqual(r.status, 400, 'une zone du catalogue ne se supprime pas');

  // 8. Une zone inconnue reste refusée à l'enregistrement.
  r = await call('POST', '/api/commande', {
    ...commande,
    articles: [{ vetement: 'T-shirt', quantite: 1, zones: [{ zone: 'nulle_part' }] }],
  });
  assert.strictEqual(r.status, 400, 'zone inconnue refusée');

  console.log('✓ emplacements : catalogue, ajout au comptoir, idempotence, usage et retrait OK');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
