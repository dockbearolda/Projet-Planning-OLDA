'use strict';

// Reproduction du bug « sous-famille affiche un compteur mais liste vide » :
// des lignes gardent un ANCIEN slug d'étape (jamais converti vers le modèle
// « familles »). /api/counts les compte par sub_stage, /api/requests?stage=…
// ne les renvoie pas. On vérifie que repairOrphanStages() les réaligne, en
// PRÉSERVANT la sous-étape déjà valide.

const assert = require('node:assert');

// Force le backend pg-mem (aucune DATABASE_URL).
delete process.env.DATABASE_URL;
const db = require('../db');

// État orphelin reproduisant EXACTEMENT la distribution observée en prod.
const ORPHANS = [
  { stage: 'nouvelle_demande', sub_stage: null, n: 8, wantStage: 'demande', wantSub: null },
  { stage: 'prod_trotec', sub_stage: 'prod_trotec', n: 6, wantStage: 'production', wantSub: 'prod_trotec' },
  { stage: 'prod_trotec', sub_stage: 'montage_finition', n: 1, wantStage: 'production', wantSub: 'montage_finition' },
  { stage: 'prod_dtf', sub_stage: 'prod_pressage', n: 1, wantStage: 'production', wantSub: 'prod_pressage' },
  { stage: 'preparation_production', sub_stage: 'prod_dtf', n: 1, wantStage: 'production', wantSub: 'prod_dtf' },
  { stage: 'preparation_production', sub_stage: 'prod_pressage', n: 2, wantStage: 'production', wantSub: 'prod_pressage' },
  { stage: 'preparation_production', sub_stage: 'prod_trotec', n: 1, wantStage: 'production', wantSub: 'prod_trotec' },
];

(async () => {
  await db.init(); // schéma + migrations + seed d'exemple

  // Injecte les lignes orphelines (en contournant l'API : on écrit un ancien slug
  // que la validation refuserait).
  const ids = [];
  for (const o of ORPHANS) {
    for (let k = 0; k < o.n; k++) {
      const { rows } = await db.pool.query(
        'INSERT INTO requests (stage, sub_stage, priority, client_type, description) VALUES ($1, $2, 2, $3, $4) RETURNING id',
        [o.stage, o.sub_stage, 'pro', `${o.stage}/${o.sub_stage}#${k}`],
      );
      ids.push({ id: rows[0].id, want: o });
    }
  }

  const injectedProd = ids.filter((x) => x.want.wantStage === 'production').length;
  const stageOf = async (id) =>
    (await db.pool.query('SELECT stage, sub_stage FROM requests WHERE id = $1', [id])).rows[0];

  // Avant réparation : aucune orpheline n'est visible par famille (leur stage
  // n'est pas un slug de famille), alors que /api/counts les compterait.
  let visibleBefore = 0;
  for (const { id } of ids) if ((await stageOf(id)).stage === 'production') visibleBefore++;
  assert.strictEqual(visibleBefore, 0, 'préambule : orphelines invisibles par famille avant réparation');

  await db.repairOrphanStages();

  // Chaque orpheline pointe désormais vers la bonne famille + sous-étape préservée.
  let nowProd = 0;
  for (const { id, want } of ids) {
    const row = await stageOf(id);
    assert.strictEqual(row.stage, want.wantStage, `stage réaligné pour ${want.stage}/${want.sub_stage}`);
    assert.strictEqual(row.sub_stage ?? null, want.wantSub, `sub_stage préservé pour ${want.stage}/${want.sub_stage}`);
    if (row.stage === 'production') nowProd++;
  }
  assert.strictEqual(nowProd, injectedProd, 'les lignes machines relèvent maintenant de production');
  assert.strictEqual(injectedProd, 12, 'contrôle : 12 lignes machines injectées');

  // Idempotence : plus aucune orpheline (filtre JS — pg-mem plante sur NOT IN).
  const familySlugs = new Set(db.STAGE_SLUGS);
  const { rows: allRows } = await db.pool.query('SELECT stage FROM requests');
  const leftover = allRows.filter((r) => !familySlugs.has(r.stage)).length;
  assert.strictEqual(leftover, 0, 'plus aucune ligne sur un ancien slug (idempotent)');

  console.log('✓ repair-orphan-stages : réparation OK, sous-étapes préservées, idempotent');
  await db.pool.end();
  process.exit(0);
})().catch((err) => {
  console.error('✗ échec du test :', err);
  process.exit(1);
});
