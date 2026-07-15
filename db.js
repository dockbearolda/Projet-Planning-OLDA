'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Étapes du planning (valeurs possibles de requests.stage), dans l'ordre.
// Pipeline LINÉAIRE : une commande est dans une seule étape à la fois. La liste
// s'affiche telle quelle dans la barre latérale gauche.
const STAGES = [
  { slug: 'nouvelle_demande', label: 'Nouvelle demande' },
  { slug: 'chiffrage', label: 'Chiffrage à faire' },
  { slug: 'devis_a_envoyer', label: 'Devis à envoyer' },
  { slug: 'attente_validation_devis', label: 'Attente validation du devis' },
  { slug: 'devis_accepte_bat', label: 'Devis accepté – BAT à faire' },
  { slug: 'bat_envoye', label: 'BAT envoyé – Attente validation' },
  { slug: 'bat_a_modifier', label: 'BAT à modifier' },
  { slug: 'projet_valide', label: 'Projet validé – Lancement autorisé' },
  { slug: 'a_commander', label: 'À commander' },
  { slug: 'preparation_production', label: 'Préparation production' },
  { slug: 'prod_trotec', label: 'Prod TROTEC' },
  { slug: 'prod_dtf', label: 'Prod DTF' },
  { slug: 'prod_pressage', label: 'Prod Pressage' },
  { slug: 'prod_uv', label: 'Prod UV' },
  { slug: 'montage_nettoyage', label: 'Montage / Nettoyage' },
  { slug: 'finitions_qualite', label: 'Finitions et contrôle qualité' },
  { slug: 'facturation', label: 'Facturation' },
  { slug: 'termine_archive', label: 'Terminé – Archivé' },
  { slug: 'bloque', label: 'Bloqué – Action requise' },
  { slug: 'fiverr', label: 'Fiverr' },
];

const STAGE_SLUGS = STAGES.map((s) => s.slug);

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
  for (const col of ['contact_phone', 'contact_email', 'color']) {
    try {
      await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS ${col} text`);
    } catch (_) { /* pg-mem local : colonnes déjà présentes via le schéma */ }
  }

  // Migration vers le planning linéaire : convertit les anciens slugs d'étape
  // (dont la phase « production » multi-machines) vers la nouvelle liste.
  // Non destructif, idempotent, réversible (voir migrateStagesToLinear).
  await migrateStagesToLinear();

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

  // 3) Aligne la valeur par défaut de la colonne sur la première étape.
  try {
    await pool.query("ALTER TABLE requests ALTER COLUMN stage SET DEFAULT 'nouvelle_demande'");
  } catch (_) { /* pg-mem local : défaut déjà posé par le schéma */ }
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
      stage: 'nouvelle_demande', priority: 3, client_type: 'pro', billing_company: 'Brasserie du Coin',
      contact_referent: 'Julie M.', quantity: 50, product: 'T-shirts DTF logo', color: 'Noir',
      project_value: 850, description: 'Tee-shirts événement bière artisanale',
      deadline: inDays(3), position: 1000,
    },
    {
      stage: 'nouvelle_demande', priority: 1, client_type: 'perso', billing_company: 'Particulier',
      contact_referent: 'Léa', quantity: 2, product: 'Mug photo',
      project_value: 30, description: 'Cadeau anniversaire', deadline: inDays(12),
      position: 2000,
    },
    {
      stage: 'chiffrage', priority: 2, client_type: 'pro', billing_company: 'Club Sportif Aurillac',
      contact_referent: 'Coach Bernard', quantity: 30, product: 'Maillots floqués',
      project_value: 1450, description: 'Maillots saison 2026', deadline: inDays(8),
      position: 1000,
    },
    {
      stage: 'a_commander', priority: 3, client_type: 'pro', billing_company: 'Mairie de Vic',
      contact_referent: 'Service Com', quantity: 120, product: 'Tote bags sérigraphie', color: 'Écru',
      project_value: 3200, description: 'Sacs marché de Noël', deadline: inDays(1),
      position: 1000,
    },
    {
      stage: 'prod_dtf', priority: 2, client_type: 'pro',
      billing_company: 'Auto-école Rapid', contact_referent: 'M. Faure', quantity: 15,
      product: 'Polos brodés DTF', project_value: 540, description: 'Polos moniteurs',
      deadline: inDays(-1), position: 1000,
    },
    {
      stage: 'prod_trotec', priority: 3,
      client_type: 'pro', billing_company: 'Menuiserie Vidal', contact_referent: 'Bruno V.',
      quantity: 40, product: 'Panneaux PVC', color: 'Blanc', project_value: 1200,
      description: 'Découpe forme sur la Trotec',
      deadline: inDays(5), position: 1000,
    },
    {
      stage: 'facturation', priority: 1, client_type: 'pro', billing_company: 'Pizzeria Bella',
      contact_referent: 'Marco', quantity: 8, product: 'Tabliers personnalisés',
      project_value: 240, description: 'Tabliers cuisine', deadline: inDays(-5),
      position: 1000,
    },
  ];

  for (const s of samples) {
    await pool.query(
      `INSERT INTO requests
        (stage, priority, client_type, billing_company, contact_referent, quantity,
         product, color, project_value, description, deadline, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [s.stage, s.priority, s.client_type, s.billing_company, s.contact_referent,
       s.quantity, s.product, s.color ?? null, s.project_value, s.description, s.deadline, s.position],
    );
  }
}

module.exports = { pool, init, STAGES, STAGE_SLUGS };
