'use strict';

// Copie d'une commande (« Dupliquer », « Envoyer vers Fiverr »).
//
// Ce que ce test protège : la copie se fait CÔTÉ SERVEUR et emporte `fiche` —
// le récapitulatif du comptoir, c'est-à-dire tout ce que l'atelier doit lire
// pour produire. Le navigateur recopiait champ par champ ce qu'il avait à
// l'écran, or la liste ne transporte qu'un RÉSUMÉ de la fiche : la copie
// arrivait vide de son détail, et `fiche` n'est — volontairement — pas un
// champ que l'on peut écrire par PATCH.
//
// Ce qui ne se copie PAS : le numéro de ticket (il identifie UNE prise de
// commande), l'alerte en cours et les pièces jointes.

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

  // Une commande née au comptoir : c'est `fiche` qui porte le détail à produire.
  const { body: source } = await call('POST', '/api/requests', {
    stage: 'preparation',
    sub_stage: 'prepa_produits',
    billing_company: 'Coco Beach',
    product: '30 polos brodés',
    project_value: 640,
    priority: 3,
    contact_phone: '0690112233',
    flag: 'bloque',
    flag_reason: 'attente du BAT signé',
  });
  assert.ok(source.id, 'la commande de départ est créée');

  // Le détail complet ne s'écrit que par la porte prévue pour ça.
  const { status: stFiche } = await call('PATCH', `/api/requests/${source.id}/fiche`, {
    heureSouhaitee: '10:30',
    production: 'Broderie + DTF',
  });
  assert.strictEqual(stFiche, 200, 'la fiche accepte heure de retrait et production');

  // On pose un récapitulatif de comptoir directement en base, comme le fait le
  // parcours de vente : c'est LUI qui se perdait à la copie.
  const { pool } = require('../db');
  await pool.query('UPDATE requests SET fiche = $1 WHERE id = $2', [
    JSON.stringify({
      kind: 'comptoir-v17',
      source: 'Vente directe',
      ref: '26.08.05-004',
      heureSouhaitee: '10:30',
      production: 'Broderie + DTF',
      client: [{ k: 'Nom', v: 'Coco Beach' }],
      details: [{ k: 'Article', v: '30 × Polo marine — taille L' }],
    }),
    source.id,
  ]);

  // --- Duplication dans la même famille -------------------------------------
  const { status, body: copie } = await call('POST', `/api/requests/${source.id}/copie`, {});
  assert.strictEqual(status, 201, 'la copie est créée');
  assert.notStrictEqual(String(copie.id), String(source.id), 'la copie est une autre ligne');
  assert.strictEqual(copie.stage, 'preparation', 'même famille');
  assert.strictEqual(copie.sub_stage, 'prepa_produits', 'même sous-étape');
  assert.strictEqual(copie.billing_company, 'Coco Beach', 'le client suit');
  assert.strictEqual(Number(copie.project_value), 640, 'le prix suit');
  assert.strictEqual(copie.contact_phone, '0690112233', 'le contact suit');
  // Une copie repart d'une page blanche : elle n'hérite pas du blocage.
  assert.strictEqual(copie.flag, null, 'l’alerte ne se copie pas');
  assert.strictEqual(copie.flag_reason, null, 'le motif ne se copie pas');

  const { body: copiePleine } = await call('GET', `/api/requests/${copie.id}`);
  const f = copiePleine.fiche;
  assert.ok(f && typeof f === 'object', 'la copie a bien une fiche');
  assert.strictEqual(f.kind, 'comptoir-v17', 'le type de fiche suit');
  assert.strictEqual(f.heureSouhaitee, '10:30', 'l’heure de retrait suit');
  assert.strictEqual(f.production, 'Broderie + DTF', 'le secteur de production suit');
  assert.deepStrictEqual(f.details, [{ k: 'Article', v: '30 × Polo marine — taille L' }],
    'LE DÉTAIL DE PRODUCTION SUIT — c’est tout l’objet de ce test');
  assert.strictEqual(f.ref, undefined,
    'le numéro de ticket ne se copie pas : deux lignes ne peuvent pas le revendiquer');

  // --- Envoi vers une autre famille -----------------------------------------
  const { status: st2, body: versFiverr } = await call('POST', `/api/requests/${source.id}/copie`, { stage: 'fiverr' });
  assert.strictEqual(st2, 201, 'l’envoi vers une autre famille passe');
  assert.strictEqual(versFiverr.stage, 'fiverr', 'la copie atterrit dans la famille demandée');
  assert.strictEqual(versFiverr.sub_stage, null,
    'changer de famille remet la sous-étape à zéro (on ne transporte pas « Préparation des produits » dans Fiverr)');

  const { body: fiverrPlein } = await call('GET', `/api/requests/${versFiverr.id}`);
  assert.strictEqual(fiverrPlein.fiche.details.length, 1, 'le détail suit aussi hors de la famille');

  // --- Refus ----------------------------------------------------------------
  const { status: st404 } = await call('POST', '/api/requests/999999/copie', {});
  assert.strictEqual(st404, 404, 'copier une commande qui n’existe pas → 404');
  const { status: st400 } = await call('POST', `/api/requests/${source.id}/copie`, { stage: 'nawak' });
  assert.strictEqual(st400, 400, 'une famille inconnue est refusée');

  // --- L'originale n'a pas bougé --------------------------------------------
  const { body: apres } = await call('GET', `/api/requests/${source.id}`);
  assert.strictEqual(apres.flag, 'bloque', 'l’originale garde son alerte');
  assert.strictEqual(apres.fiche.ref, '26.08.05-004', 'l’originale garde son numéro de ticket');

  console.log('✓ copie de commande : détail du comptoir conservé, ticket et alerte non recopiés OK');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
