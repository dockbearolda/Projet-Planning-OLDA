'use strict';

// Bascule des 8 familles vers les 5 familles du patron (28/07/2026).
// Ce qui est vérifié ici, c'est ce qui coûterait cher à rater : une commande
// qui change de main, une sous-étape perdue, ou une migration qui se rejoue et
// écrase des positions choisies à la main depuis.

const assert = require('node:assert');

// Force le backend pg-mem (aucune DATABASE_URL).
delete process.env.DATABASE_URL;
const db = require('../db');

// Chaque couple d'AVANT et la place qu'il doit occuper APRÈS. `null` en
// `wantSub` = « à préciser », une position valide du planning.
const CASES = [
  // Demande : toute la famille se range sur « Demande reçue ».
  { stage: 'demande', sub: null, wantStage: 'demande_chiffrage', wantSub: 'demande_recue' },
  { stage: 'demande', sub: 'peu_importe', wantStage: 'demande_chiffrage', wantSub: 'demande_recue' },
  // Chiffrage : les slugs qui existaient déjà sont conservés tels quels.
  { stage: 'chiffrage', sub: null, wantStage: 'demande_chiffrage', wantSub: 'a_chiffrer' },
  { stage: 'chiffrage', sub: 'a_chiffrer', wantStage: 'demande_chiffrage', wantSub: 'a_chiffrer' },
  { stage: 'chiffrage', sub: 'chiffrage_en_cours', wantStage: 'demande_chiffrage', wantSub: 'chiffrage_en_cours' },
  { stage: 'chiffrage', sub: 'devis_a_envoyer', wantStage: 'demande_chiffrage', wantSub: 'devis_envoye' },
  // Attente Client disparaît en tant que famille : le dossier est « devis envoyé ».
  { stage: 'attente_client', sub: null, wantStage: 'demande_chiffrage', wantSub: 'devis_envoye' },
  // Préparation : seul prepa_fichiers est renommé, le reste ne bouge pas.
  { stage: 'preparation', sub: 'prepa_fichiers', wantStage: 'preparation', wantSub: 'prepa_produits' },
  { stage: 'preparation', sub: 'a_commander', wantStage: 'preparation', wantSub: 'a_commander' },
  { stage: 'preparation', sub: 'attente_marchandise', wantStage: 'preparation', wantSub: 'attente_marchandise' },
  { stage: 'preparation', sub: 'pret_a_produire', wantStage: 'preparation', wantSub: 'pret_a_produire' },
  { stage: 'preparation', sub: null, wantStage: 'preparation', wantSub: null },
  // Production : intégralement conservée.
  { stage: 'production', sub: 'prod_dtf', wantStage: 'production', wantSub: 'prod_dtf' },
  { stage: 'production', sub: 'prod_trotec', wantStage: 'production', wantSub: 'prod_trotec' },
  { stage: 'production', sub: 'controle_emballage', wantStage: 'production', wantSub: 'controle_emballage' },
  // Facturation : « Prêt client / Attente retrait » devient « Client prévenu ».
  { stage: 'facturation', sub: 'facturation_a_faire', wantStage: 'facturation', wantSub: 'facturation_a_faire' },
  { stage: 'facturation', sub: 'pret_retrait', wantStage: 'facturation', wantSub: 'client_prevenu' },
  // Terminé + Archivé fusionnent dans « Paiement & clôture ».
  { stage: 'termine', sub: 'attente_paiement', wantStage: 'paiement', wantSub: 'paiement_a_controler' },
  { stage: 'termine', sub: 'solde', wantStage: 'paiement', wantSub: 'paiement_valide' },
  { stage: 'termine', sub: null, wantStage: 'paiement', wantSub: 'paiement_a_controler' },
  { stage: 'archive', sub: null, wantStage: 'paiement', wantSub: 'archive' },
  // Fiverr reste hors des familles, intouché.
  { stage: 'fiverr', sub: null, wantStage: 'fiverr', wantSub: null },
];

// 1. La table de correspondance, exercée directement (sans base).
for (const c of CASES) {
  const got = db.toFiveFamilies(c.stage, c.sub);
  const [stage, sub] = got || [c.stage, c.sub];
  assert.strictEqual(stage, c.wantStage, `famille pour ${c.stage}/${c.sub}`);
  assert.strictEqual(sub ?? null, c.wantSub, `sous-étape pour ${c.stage}/${c.sub}`);
}

// 2. Toute position d'ARRIVÉE est une position valide du nouveau modèle : une
//    correspondance qui viserait un slug inexistant rendrait les lignes
//    invisibles dans la barre latérale — exactement le bug qu'on veut éviter.
const familySlugs = new Set(db.STAGE_SLUGS);
for (const c of CASES) {
  assert.ok(familySlugs.has(c.wantStage), `${c.wantStage} est une famille connue`);
  if (c.wantSub !== null) {
    const subs = (db.SUB_STAGES[c.wantStage] || []).map((s) => s.slug);
    assert.ok(subs.includes(c.wantSub), `${c.wantSub} appartient bien à ${c.wantStage}`);
  }
}

// 3. Les slugs de sous-étape restent GLOBALEMENT uniques : c'est l'hypothèse sur
//    laquelle repose la réparation des lignes orphelines (une sous-étape suffit
//    à désigner sa famille).
const seen = new Map();
for (const [family, list] of Object.entries(db.SUB_STAGES)) {
  for (const s of list) {
    assert.ok(!seen.has(s.slug), `sous-étape « ${s.slug} » dupliquée (${seen.get(s.slug)} et ${family})`);
    seen.set(s.slug, family);
  }
}

(async () => {
  await db.init(); // schéma + migrations + seed d'exemple

  // 4. Sur une base RÉELLE : on réinjecte l'ancien modèle (en contournant l'API,
  //    qui refuserait ces slugs) puis on rejoue la bascule.
  const ids = [];
  for (const c of CASES) {
    const { rows } = await db.pool.query(
      'INSERT INTO requests (stage, sub_stage, priority, client_type, description) VALUES ($1,$2,2,$3,$4) RETURNING id',
      [c.stage, c.sub, 'pro', `${c.stage}/${c.sub}`],
    );
    ids.push({ id: rows[0].id, want: c });
  }

  // La garde a déjà été posée par init() : on la retire pour rejouer la bascule
  // sur les lignes qu'on vient d'injecter. (On appelle la migration seule, pas
  // init() : pg-mem ne supporte pas de rejouer le CREATE TABLE du schéma.)
  await db.pool.query("DELETE FROM app_meta WHERE key = 'stage_model_v3'");
  await db.migrateFamiliesToFive();

  const posOf = async (id) =>
    (await db.pool.query('SELECT stage, sub_stage FROM requests WHERE id = $1', [id])).rows[0];

  for (const { id, want } of ids) {
    const row = await posOf(id);
    assert.strictEqual(row.stage, want.wantStage, `base : famille pour ${want.stage}/${want.sub}`);
    assert.strictEqual(row.sub_stage ?? null, want.wantSub, `base : sous-étape pour ${want.stage}/${want.sub}`);
  }

  // 5. Aucune ligne, nulle part, ne reste sur une famille inconnue.
  const { rows: all } = await db.pool.query('SELECT stage FROM requests');
  assert.strictEqual(all.filter((r) => !familySlugs.has(r.stage)).length, 0,
    'aucune ligne sur un slug de famille inconnu');

  // 6. Les réglages « pilote par défaut » suivent les sous-étapes renommées :
  //    le patron ne doit pas voir ses affectations disparaître en silence.
  await db.pool.query("DELETE FROM app_meta WHERE key = 'category_owners'");
  await db.pool.query(
    "INSERT INTO app_meta (key, value) VALUES ('category_owners', $1)",
    [JSON.stringify({ prepa_fichiers: 'Charlie', pret_retrait: 'Mélina', production: 'Julien' })],
  );
  await db.pool.query("DELETE FROM app_meta WHERE key = 'stage_model_v3'");
  await db.migrateFamiliesToFive();
  const owners = await db.getCategoryOwners();
  assert.strictEqual(owners.prepa_produits, 'Charlie', 'le pilote suit prepa_fichiers → prepa_produits');
  assert.strictEqual(owners.client_prevenu, 'Mélina', 'le pilote suit pret_retrait → client_prevenu');
  assert.strictEqual(owners.production, 'Julien', 'un slug inchangé garde son pilote');
  assert.strictEqual(owners.prepa_fichiers, undefined, 'l’ancienne clé ne traîne pas');

  // 7. Idempotence : un employé déplace une ligne à la main, un redémarrage ne
  //    doit PAS la remettre où la migration l'avait posée.
  const cobaye = ids[0].id;
  await db.pool.query(
    'UPDATE requests SET stage = $1, sub_stage = $2 WHERE id = $3',
    ['production', 'prod_uv', cobaye],
  );
  await db.migrateFamiliesToFive();   // la garde est posée : deuxième passage sans effet
  const apres = await posOf(cobaye);
  assert.strictEqual(apres.stage, 'production', 'une position choisie à la main survit au redémarrage');
  assert.strictEqual(apres.sub_stage, 'prod_uv', 'la sous-étape choisie à la main survit au redémarrage');

  console.log('✓ pipeline-migration : 8 familles → 5, positions valides, slugs uniques, idempotent');
  await db.pool.end();
  process.exit(0);
})().catch((err) => {
  console.error('✗ échec du test :', err);
  process.exit(1);
});
