'use strict';

// Correctifs de l'audit planning du 05/08/2026, vérifiés de bout en bout sur le
// vrai serveur Express branché sur la base en mémoire :
//   1. cohérence étape / sous-étape — une sous-étape d'une AUTRE famille est
//      refusée (le glisser-déposer l'interdisait à l'écran, rien ne rattrapait
//      une fiche restée ouverte pendant qu'un collègue déplaçait la ligne) ;
//   2. ordre manuel PARTAGÉ — la décision « cette étape est rangée à la main »
//      vit en base, pas dans le localStorage d'une tablette ;
//   3. journal des modifications — ce qui a changé est enregistré, la position
//      en est exclue (un seul glisser en réécrit une dizaine), et le journal
//      part avec la commande qu'on supprime.

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

  // =========================================================================
  // 1. Cohérence étape / sous-étape
  // =========================================================================
  const cree = await call('POST', '/api/requests', {
    billing_company: 'Audit cohérence', stage: 'production', sub_stage: 'prod_uv',
  });
  assert.strictEqual(cree.status, 201);
  const id = cree.body.id;

  // Sous-étape de production sur une commande passée en facturation : refusé.
  let r = await call('PATCH', `/api/requests/${id}`, { stage: 'facturation', sub_stage: 'prod_uv' });
  assert.strictEqual(r.status, 400, 'une sous-étape d’une autre famille est refusée');
  assert.match(r.body.error, /incompatible/);

  // Même refus quand seule la sous-étape est envoyée (l'étape reste celle de la
  // ligne en base) : c'est le cas d'une fiche périmée.
  r = await call('PATCH', `/api/requests/${id}`, { sub_stage: 'facturation_a_faire' });
  assert.strictEqual(r.status, 400, 'sous-étape seule : comparée à l’étape en base');

  // La paire cohérente passe, et « à préciser » (null) reste toujours permis.
  r = await call('PATCH', `/api/requests/${id}`, { stage: 'facturation', sub_stage: 'facturation_a_faire' });
  assert.strictEqual(r.status, 200);
  r = await call('PATCH', `/api/requests/${id}`, { sub_stage: null });
  assert.strictEqual(r.status, 200, '« à préciser » reste une valeur valide');

  // Même règle à la création.
  r = await call('POST', '/api/requests', { stage: 'paiement', sub_stage: 'prod_dtf' });
  assert.strictEqual(r.status, 400, 'la création applique la même cohérence');

  // =========================================================================
  // 2. Ordre manuel partagé
  // =========================================================================
  r = await call('GET', '/api/ordre-manuel');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, [], 'aucune étape rangée à la main au départ');

  r = await call('PUT', '/api/ordre-manuel', ['production', 'production', 'facturation']);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, ['production', 'facturation'], 'liste dédoublonnée');

  // Un autre poste lit exactement la même chose : c'est tout l'intérêt.
  r = await call('GET', '/api/ordre-manuel');
  assert.deepStrictEqual(r.body, ['production', 'facturation']);

  r = await call('PUT', '/api/ordre-manuel', ['pas_une_etape']);
  assert.strictEqual(r.status, 400, 'un slug inconnu est refusé');
  r = await call('PUT', '/api/ordre-manuel', { production: true });
  assert.strictEqual(r.status, 400, 'un objet n’est pas une liste d’étapes');

  // Le retour au tri automatique se propage aussi.
  r = await call('PUT', '/api/ordre-manuel', []);
  assert.deepStrictEqual(r.body, []);

  // =========================================================================
  // 3. Journal des modifications
  // =========================================================================
  const jc = await call('POST', '/api/requests', {
    billing_company: 'Audit journal', stage: 'demande_chiffrage', sub_stage: 'a_chiffrer',
  });
  const jid = jc.body.id;

  r = await call('GET', `/api/requests/${jid}/journal`);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, [], 'une commande neuve n’a rien à raconter');

  await call('PATCH', `/api/requests/${jid}`, { project_value: 250, priority: 3 });
  await call('PATCH', `/api/requests/${jid}`, { flag: 'bloque', flag_reason: 'Attente acompte' });
  // La position est volontairement HORS journal : un seul glisser en réécrit une
  // dizaine, et le journal ne serait plus lisible.
  await call('PATCH', `/api/requests/${jid}`, { position: 7000 });
  // Un PATCH qui ne change rien n'écrit rien non plus.
  await call('PATCH', `/api/requests/${jid}`, { priority: 3 });

  r = await call('GET', `/api/requests/${jid}/journal`);
  const champs = r.body.map((l) => l.field).sort();
  assert.deepStrictEqual(
    champs, ['flag', 'flag_reason', 'priority', 'project_value'],
    'seuls les champs suivis et réellement modifiés sont journalisés',
  );
  const prix = r.body.find((l) => l.field === 'project_value');
  assert.strictEqual(prix.value_before, null, 'la commande n’avait pas de prix');
  assert.strictEqual(Number(prix.value_after), 250);
  const etat = r.body.find((l) => l.field === 'flag');
  assert.strictEqual(etat.value_after, 'bloque');

  // Une échéance est une colonne `date` : le pilote la rend en objet Date, dont
  // le String() donne « Wed Aug 05 2026 … ». Le journal la garde en ISO, seule
  // forme que la fiche sait relire (et un humain aussi).
  await call('PATCH', `/api/requests/${jid}`, { deadline: '2026-09-14' });
  r = await call('GET', `/api/requests/${jid}/journal`);
  const ech = r.body.find((l) => l.field === 'deadline');
  assert.strictEqual(ech.value_after, '2026-09-14', 'l’échéance est journalisée en ISO');
  assert.strictEqual(ech.value_before, null);

  // Une commande supprimée n'abandonne pas son journal derrière elle.
  r = await call('DELETE', `/api/requests/${jid}`);
  assert.strictEqual(r.status, 204);
  r = await call('GET', `/api/requests/${jid}/journal`);
  assert.deepStrictEqual(r.body, [], 'le journal part avec la commande');

  console.log('✓ audit planning : cohérence étape/sous-étape, ordre manuel partagé, journal OK');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
