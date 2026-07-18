'use strict';

const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// `deadline` est une colonne `date` : un jour civil, sans heure ni fuseau. Par
// défaut pg la convertit en Date à minuit LOCAL, que res.json re-sérialise en
// UTC — à l'est de Greenwich l'échéance recule d'un jour à chaque lecture, et
// copyBody() (« Envoyer vers Fiverr », dupliquer) réécrit la valeur reculée en
// base, donc la dérive s'accumule. On garde donc la chaîne « aaaa-mm-jj » telle
// que Postgres la renvoie.
types.setTypeParser(types.builtins.DATE, (v) => v);

// Pipeline à 2 NIVEAUX (modèle « familles », d'après le CRM du patron) :
//   - la FAMILLE (requests.stage) dit OÙ en est le projet — 8 grandes étapes,
//     affichées dans la barre latérale gauche ;
//   - la SOUS-FAMILLE (requests.sub_stage) précise CE QUI SE PASSE MAINTENANT —
//     choisie en ligne sur la commande (puce), uniquement pour les familles qui
//     en ont. « 1 projet = 1 seule place. »
const FAMILIES = [
  { slug: 'demande', label: 'Demande' },
  { slug: 'chiffrage', label: 'Chiffrage / Devis' },
  { slug: 'attente_client', label: 'Attente Client' },
  { slug: 'preparation', label: 'Préparation' },
  { slug: 'production', label: 'Production' },
  { slug: 'facturation', label: 'Facturation / Retrait' },
  { slug: 'termine', label: 'Terminé' },
  { slug: 'archive', label: 'Archivé' },
];

// Catégorie spéciale conservée hors des 8 familles : sous-traitance graphiste
// (outil de devis + « Envoyer vers Fiverr »). Épinglée en bas de la sidebar.
const SPECIAL = [
  { slug: 'fiverr', label: 'Fiverr' },
];

// Toutes les valeurs possibles de requests.stage (familles + spécial).
const STAGES = [...FAMILIES, ...SPECIAL];
const STAGE_SLUGS = STAGES.map((s) => s.slug);

// Sous-familles par famille (slug → libellé). Une famille absente d'ici n'a pas
// de sous-étape (Demande, Attente Client, Archivé, Fiverr).
const SUB_STAGES = {
  chiffrage: [
    { slug: 'a_chiffrer', label: 'À chiffrer' },
    { slug: 'chiffrage_en_cours', label: 'Chiffrage en cours' },
    { slug: 'devis_a_envoyer', label: 'Devis à envoyer' },
  ],
  preparation: [
    { slug: 'prepa_fichiers', label: 'Préparation fichiers & produits' },
    { slug: 'a_commander', label: 'À commander' },
    { slug: 'attente_marchandise', label: 'Attente marchandise' },
    { slug: 'pret_a_produire', label: 'Prêt à produire' },
  ],
  production: [
    { slug: 'prod_dtf', label: 'Production DTF' },
    { slug: 'prod_pressage', label: 'Pressage' },
    { slug: 'prod_trotec', label: 'Production Trotec' },
    { slug: 'prod_uv', label: 'Production UV' },
    { slug: 'montage_finition', label: 'Montage / Finition' },
    { slug: 'controle_emballage', label: 'Contrôle & emballage' },
  ],
  facturation: [
    { slug: 'facturation_a_faire', label: 'Facturation à faire' },
    { slug: 'pret_retrait', label: 'Prêt client / Attente retrait' },
  ],
  termine: [
    { slug: 'attente_paiement', label: 'Attente paiement' },
    { slug: 'solde', label: 'Soldé' },
  ],
};

// Ensemble plat des slugs de sous-étape valides (pour la validation serveur).
const SUB_SLUGS = new Set(
  Object.values(SUB_STAGES).flatMap((list) => list.map((s) => s.slug)),
);

// Responsables proposés (le champ reste du texte libre côté base).
const RESPONSABLES = ['Loïc', 'Mélina', 'Charlie', 'Opérateur', 'À attribuer'];

// Types de client.
const CLIENT_TYPES = ['pro', 'perso', 'asso', 'revendeur'];

const isProd = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

// Choix du backend :
//  - DATABASE_URL défini → vrai PostgreSQL (Railway / prod / local avec Postgres).
//  - DATABASE_URL absent → base en mémoire (pg-mem), pour tester en local sans
//    rien installer. Données NON persistantes (réinitialisées à chaque démarrage).
let pool;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // SSL requis côté Railway en production.
    ssl: isProd ? { rejectUnauthorized: false } : false,
  });
} else {
  // Fallback local zéro-config.
  const { newDb } = require('pg-mem');
  const mem = newDb();
  mem.registerExtension('pgcrypto', () => {});
  let seq = 0;
  const hex = (n) => n.toString(16).padStart(12, '0');
  mem.public.registerFunction({
    name: 'gen_random_uuid', returns: 'uuid', impure: true,
    implementation: () => '00000000-0000-4000-8000-' + hex(++seq),
  });
  const MemPg = mem.adapters.createPg();
  pool = new MemPg.Pool();
  console.log('ℹ  Mode local : base en mémoire (pg-mem). Données non persistantes.');
}

// Migration automatique au démarrage : crée le schéma + seed si vide.
async function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);

  // Migration : colonnes ajoutées après coup sur les bases existantes
  // (CREATE TABLE IF NOT EXISTS n'ajoute pas de colonnes à une table déjà créée).
  for (const col of ['contact_phone', 'contact_email', 'color', 'sub_stage', 'responsable']) {
    try {
      await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS ${col} text`);
    } catch (_) { /* pg-mem local : colonnes déjà présentes via le schéma */ }
  }

  // Migration vers le planning linéaire : convertit les anciens slugs d'étape
  // (dont la phase « production » multi-machines) vers la liste linéaire.
  // Non destructif, idempotent, réversible (voir migrateStagesToLinear).
  await migrateStagesToLinear();

  // Puis bascule du modèle linéaire vers le modèle « familles » à 2 niveaux.
  // Non destructif, exécuté UNE seule fois (garde app_meta).
  await migrateStagesToFamilies();

  // Seed : si la table est vide, on insère quelques demandes d'exemple
  // réparties sur plusieurs étapes pour démontrer le pipeline.
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM requests');
  if (rows[0].n === 0) {
    await seed();
  }
}

// Correspondance ancien slug d'étape → nouveau (planning linéaire). Réversible :
// aucune donnée n'est supprimée (la table production_sectors est conservée
// intacte, ce qui permet de reconstruire l'ancien modèle si besoin). Idempotent :
// après un passage, plus aucune ligne ne porte d'ancien slug.
const STAGE_MIGRATION = {
  demande: 'nouvelle_demande',
  devis_en_cours: 'chiffrage',
  devis_accepte: 'devis_accepte_bat',
  archive: 'termine_archive',
  maquette_fiverr: 'fiverr',
  toptex: 'a_commander',
  // 'facturation' : slug inchangé.
  // Anciennes étapes prod_* restées telles quelles (sécurité) :
  prod_roland_uv: 'prod_uv',
  prod_sous_traitance: 'preparation_production',
  prod_autre: 'preparation_production',
};

async function migrateStagesToLinear() {
  // 1) Commandes en phase « production » (modèle multi-machines) : on choisit
  //    l'étape prod correspondant au secteur porté (priorité TROTEC > DTF >
  //    Pressage > UV ; sinon « Préparation production »).
  const { rows: prod } = await pool.query("SELECT id FROM requests WHERE stage = 'production'");
  for (const r of prod) {
    const { rows: secs } = await pool.query(
      'SELECT sector FROM production_sectors WHERE request_id = $1', [r.id],
    );
    const have = new Set(secs.map((s) => s.sector));
    let target = 'preparation_production';
    if (have.has('prod_trotec')) target = 'prod_trotec';
    else if (have.has('prod_dtf')) target = 'prod_dtf';
    else if (have.has('prod_pressage')) target = 'prod_pressage';
    else if (have.has('prod_roland_uv')) target = 'prod_uv';
    await pool.query('UPDATE requests SET stage = $1 WHERE id = $2', [target, r.id]);
  }

  // 2) Renommage direct des autres anciens slugs.
  for (const [from, to] of Object.entries(STAGE_MIGRATION)) {
    if (from === to) continue;
    await pool.query('UPDATE requests SET stage = $1 WHERE stage = $2', [to, from]);
  }

  // 3) Aligne la valeur par défaut de la colonne sur la première étape linéaire.
  //    (migrateStagesToFamilies la repositionnera ensuite sur 'demande'.)
  try {
    await pool.query("ALTER TABLE requests ALTER COLUMN stage SET DEFAULT 'nouvelle_demande'");
  } catch (_) { /* pg-mem local : défaut déjà posé par le schéma */ }
}

// Bascule du pipeline LINÉAIRE (20 étapes à plat) vers le modèle « FAMILLES »
// à 2 niveaux (8 familles + sous-étapes). Chaque ancien slug d'étape devient une
// FAMILLE (requests.stage) + éventuellement une SOUS-FAMILLE (requests.sub_stage).
//
// Idempotence : certains slugs se recoupent entre les deux modèles
// (« chiffrage », « facturation », « fiverr »), donc on ne peut pas se fier au
// seul slug pour savoir si la bascule a déjà eu lieu. On la protège par un flag
// dans app_meta : la migration ne s'exécute qu'une fois.
//
// Réversibilité : non destructif. Le détail perdu par le regroupement est
// conservé dans sub_stage, ce qui permet de reconstruire l'ancien modèle si
// besoin (mapping inverse : famille+sous-étape → ancien slug linéaire).
const STAGE_TO_FAMILY = {
  // ancien slug linéaire → [famille, sous-étape | null]
  nouvelle_demande:         ['demande', null],
  chiffrage:                ['chiffrage', 'a_chiffrer'],
  devis_a_envoyer:          ['chiffrage', 'devis_a_envoyer'],
  attente_validation_devis: ['attente_client', null],
  devis_accepte_bat:        ['preparation', 'prepa_fichiers'],
  bat_envoye:               ['attente_client', null],
  bat_a_modifier:           ['preparation', 'prepa_fichiers'],
  projet_valide:            ['preparation', 'prepa_fichiers'],
  a_commander:              ['preparation', 'a_commander'],
  preparation_production:   ['preparation', 'prepa_fichiers'],
  prod_trotec:              ['production', 'prod_trotec'],
  prod_dtf:                 ['production', 'prod_dtf'],
  prod_pressage:            ['production', 'prod_pressage'],
  prod_uv:                  ['production', 'prod_uv'],
  montage_nettoyage:        ['production', 'montage_finition'],
  finitions_qualite:        ['production', 'controle_emballage'],
  facturation:              ['facturation', 'facturation_a_faire'],
  termine_archive:          ['termine', null],
  bloque:                   ['attente_client', null],
  fiverr:                   ['fiverr', null],
};

async function migrateStagesToFamilies() {
  // Garde d'idempotence : ne bascule qu'une fois.
  try {
    const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'stage_model'");
    if (rows[0] && rows[0].value === 'families') return;
  } catch (_) { /* table app_meta absente (base très ancienne) : on tente quand même */ }

  for (const [from, [family, sub]] of Object.entries(STAGE_TO_FAMILY)) {
    // On ne fixe sub_stage QUE lors de cette bascule initiale ; on ne réécrit
    // jamais une valeur déjà choisie par un utilisateur (sub_stage IS NULL only
    // n'est pas requis ici car la garde app_meta empêche tout second passage).
    await pool.query(
      'UPDATE requests SET stage = $1, sub_stage = $2 WHERE stage = $3',
      [family, sub, from],
    );
  }

  // Nouvelle valeur par défaut de la colonne : première famille.
  try {
    await pool.query("ALTER TABLE requests ALTER COLUMN stage SET DEFAULT 'demande'");
  } catch (_) { /* pg-mem local */ }

  // Pose le flag (upsert manuel, compatible pg-mem).
  await pool.query("DELETE FROM app_meta WHERE key = 'stage_model'");
  await pool.query("INSERT INTO app_meta (key, value) VALUES ('stage_model', 'families')");
}

async function seed() {
  const today = new Date();
  const inDays = (d) => {
    const x = new Date(today);
    x.setDate(x.getDate() + d);
    return x.toISOString().slice(0, 10);
  };

  const samples = [
    {
      stage: 'demande', sub_stage: null, responsable: 'Mélina', priority: 3, client_type: 'pro',
      billing_company: 'Hôtel Esmeralda', contact_referent: 'Julie M.', quantity: 50,
      product: '50 t-shirts staff', color: 'Noir', project_value: 850,
      description: 'Tee-shirts équipe — gros devis', deadline: inDays(3), position: 1000,
    },
    {
      stage: 'demande', sub_stage: null, responsable: 'À attribuer', priority: 1, client_type: 'perso',
      billing_company: 'Alessandro', contact_referent: 'Alessandro', quantity: 1,
      product: 'Impression plexi A3', project_value: 30, description: 'Photo à vérifier',
      deadline: inDays(12), position: 2000,
    },
    {
      stage: 'chiffrage', sub_stage: 'a_chiffrer', responsable: 'Charlie', priority: 2, client_type: 'revendeur',
      billing_company: 'Saint-Barth Store', contact_referent: 'Coach Bernard', quantity: 120,
      product: 'Collection été', project_value: 1450, description: 'Maillots saison 2026',
      deadline: inDays(8), position: 1000,
    },
    {
      stage: 'preparation', sub_stage: 'a_commander', responsable: 'Charlie', priority: 3, client_type: 'pro',
      billing_company: 'Mairie de Vic', contact_referent: 'Service Com', quantity: 120,
      product: 'Tote bags sérigraphie', color: 'Écru', project_value: 3200,
      description: 'Sacs marché de Noël — TopTex en cours', deadline: inDays(1), position: 1000,
    },
    {
      stage: 'production', sub_stage: 'prod_dtf', responsable: 'Opérateur', priority: 2, client_type: 'asso',
      billing_company: 'Auto-école Rapid', contact_referent: 'M. Faure', quantity: 15,
      product: 'Polos brodés DTF', project_value: 540, description: 'Polos moniteurs',
      deadline: inDays(-1), position: 1000,
    },
    {
      stage: 'production', sub_stage: 'prod_trotec', responsable: 'Charlie', priority: 3, client_type: 'pro',
      billing_company: 'Menuiserie Vidal', contact_referent: 'Bruno V.', quantity: 40,
      product: 'Panneaux PVC', color: 'Blanc', project_value: 1200,
      description: 'Découpe forme sur la Trotec', deadline: inDays(5), position: 1000,
    },
    {
      stage: 'facturation', sub_stage: 'facturation_a_faire', responsable: 'Mélina', priority: 1, client_type: 'pro',
      billing_company: 'Pizzeria Bella', contact_referent: 'Marco', quantity: 8,
      product: 'Tabliers personnalisés', project_value: 240, description: 'Tabliers cuisine',
      deadline: inDays(-5), position: 1000,
    },
  ];

  for (const s of samples) {
    await pool.query(
      `INSERT INTO requests
        (stage, sub_stage, responsable, priority, client_type, billing_company, contact_referent,
         quantity, product, color, project_value, description, deadline, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [s.stage, s.sub_stage ?? null, s.responsable ?? null, s.priority, s.client_type,
       s.billing_company, s.contact_referent, s.quantity, s.product, s.color ?? null,
       s.project_value, s.description, s.deadline, s.position],
    );
  }
}

module.exports = {
  pool, init,
  STAGES, STAGE_SLUGS, FAMILIES, SUB_STAGES, SUB_SLUGS, RESPONSABLES, CLIENT_TYPES,
};
