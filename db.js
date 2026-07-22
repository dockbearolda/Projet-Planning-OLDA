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
  // Ex-« Chiffrage / Devis » : c'est là qu'atterrit une COMMANDE validée prise
  // au comptoir (le devis/chiffrage reste à faire, mais le client a dit oui).
  { slug: 'chiffrage', label: 'Commande' },
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

// Famille propriétaire de chaque sous-slug. Les sous-slugs sont GLOBALEMENT
// uniques (aucun chevauchement entre familles), donc une sous-étape suffit à
// désigner sa famille — ce qui sert à la réparation des lignes orphelines.
const SUB_TO_FAMILY = {};
for (const [family, subs] of Object.entries(SUB_STAGES)) {
  for (const s of subs) SUB_TO_FAMILY[s.slug] = family;
}

// Employés de l'entreprise. `responsable` = PILOTE (qui pilote le projet),
// `referent` = 2e personne rattachée à la tâche : les deux champs puisent dans
// cette même liste. « À attribuer » = pas encore de pilote désigné.
//   - EMPLOYEES : les 4 personnes réelles (Loïc = patron).
//   - RESPONSABLES : valeurs acceptées pour responsable/referent (+ « À attribuer »).
const EMPLOYEES = ['Loïc', 'Charlie', 'Mélina', 'Julien'];
const RESPONSABLES = [...EMPLOYEES, 'À attribuer'];

// Types de client.
const CLIENT_TYPES = ['pro', 'perso', 'asso', 'revendeur'];

// ALERTE portée par une commande (requests.flag), posable par n'importe quel
// collaborateur depuis la grille. null = rien à signaler. Le MOTIF libre vit
// dans requests.flag_reason (« BLOQUÉE — attente BAT client »).
const FLAGS = ['bloque', 'a_voir'];

// NATURE de la ligne, tranchée dès la prise de commande (requests.order_kind) :
// une DEMANDE est à chiffrer (devis à faire), une COMMANDE est déjà validée par
// le client. null = ligne créée avant l'existence du champ, ou saisie à la main
// dans la grille : on n'invente pas la nature à sa place.
const ORDER_KINDS = ['demande', 'commande'];

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
  // Down : ALTER TABLE requests DROP COLUMN IF EXISTS <col> (aucune contrainte,
  // aucune valeur par défaut → suppression sans effet de bord sur le reste).
  for (const col of ['contact_phone', 'contact_email', 'color', 'sub_stage', 'responsable', 'referent',
    'flag', 'flag_reason', 'order_kind']) {
    try {
      await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS ${col} text`);
    } catch (_) { /* pg-mem local : colonnes déjà présentes via le schéma */ }
  }

  // Migration : détail structuré de la fiche vendeuse (client, faces, typos,
  // logos, prix). Colonne nullable, sans contrainte : les lignes créées
  // autrement restent valides. `requests.description` porte en parallèle un
  // résumé lisible, donc la grille n'a jamais besoin de lire ce JSON.
  // Down : ALTER TABLE requests DROP COLUMN IF EXISTS fiche.
  try {
    await pool.query('ALTER TABLE requests ADD COLUMN IF NOT EXISTS fiche jsonb');
  } catch (_) { /* pg-mem local : colonne déjà présente via le schéma */ }

  // Migration RÉVERSIBLE de la liste d'employés : « Opérateur » a été retiré au
  // profit de « Julien ». Les lignes encore pilotées par « Opérateur » basculent
  // sur « À attribuer » (valeur neutre, toujours valide) pour rester éditables.
  // Down : UPDATE requests SET responsable='Opérateur' WHERE responsable='À attribuer'
  // (non rejouable à l'identique, mais aucune donnée n'est perdue).
  await pool.query("UPDATE requests SET responsable = 'À attribuer' WHERE responsable = 'Opérateur'");

  // Migration vers le planning linéaire : convertit les anciens slugs d'étape
  // (dont la phase « production » multi-machines) vers la liste linéaire.
  // Non destructif, idempotent, réversible (voir migrateStagesToLinear).
  await migrateStagesToLinear();

  // Puis bascule du modèle linéaire vers le modèle « familles » à 2 niveaux.
  // Non destructif, exécuté UNE seule fois (garde app_meta).
  await migrateStagesToFamilies();

  // Filet de sécurité : réaligne toute ligne restée sur un ancien slug malgré la
  // garde ci-dessus (import / restauration de sauvegarde). Idempotent.
  await repairOrphanStages();

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
  // Valeur par défaut de la colonne = première famille. Posée à CHAQUE démarrage
  // (idempotent) car migrateStagesToLinear la repositionne sur un slug linéaire ;
  // sinon, après la bascule, le défaut resterait bloqué sur l'ancien modèle.
  try {
    await pool.query("ALTER TABLE requests ALTER COLUMN stage SET DEFAULT 'demande'");
  } catch (_) { /* pg-mem local : défaut déjà posé par le schéma */ }

  // Garde d'idempotence : ne rejoue la bascule des DONNÉES qu'une seule fois
  // (certains slugs se recoupent entre les deux modèles → on ne peut pas se fier
  // au seul slug pour la détecter).
  try {
    const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'stage_model'");
    if (rows[0] && rows[0].value === 'families') return;
  } catch (_) { /* table app_meta absente (base très ancienne) : on tente quand même */ }

  for (const [from, [family, sub]] of Object.entries(STAGE_TO_FAMILY)) {
    // On ne fixe sub_stage QUE lors de cette bascule initiale ; la garde app_meta
    // empêche tout second passage, donc aucune valeur choisie ensuite n'est écrasée.
    await pool.query(
      'UPDATE requests SET stage = $1, sub_stage = $2 WHERE stage = $3',
      [family, sub, from],
    );
  }

  // Pose le flag (upsert manuel, compatible pg-mem).
  await pool.query("DELETE FROM app_meta WHERE key = 'stage_model'");
  await pool.query("INSERT INTO app_meta (key, value) VALUES ('stage_model', 'families')");
}

// Réparation AUTO-CICATRISANTE (idempotente, non destructive). Certaines lignes
// portent un `stage` resté sur un ANCIEN slug (linéaire ou multi-machines :
// « prod_trotec », « preparation_production », « nouvelle_demande »…) jamais
// converti vers le modèle « familles ». Elles ont franchi la garde app_meta de
// migrateStagesToFamilies (import / restauration de sauvegarde, ou garde posée
// avant leur conversion), donc la bascule ne les rejoue jamais.
//
// Conséquence exacte du bug observé : leur famille n'existe pas dans la sidebar
// (ex. stage='prod_trotec'), donc /api/counts les agrège par sub_stage — « 7 » —
// mais /api/requests?stage=production ne les renvoie pas → liste vide sous la
// sous-famille. On réaligne à CHAQUE démarrage ; une fois réparé, plus aucune
// ligne ne matche, donc les passages suivants ne touchent rien.
async function repairOrphanStages() {
  // On filtre les orphelines en JS (table petite) plutôt qu'avec un NOT IN sur la
  // colonne `stage` indexée : pg-mem (dev local) plante sur ce cas.
  const familySlugs = new Set(STAGE_SLUGS);
  const { rows: all } = await pool.query('SELECT id, stage, sub_stage FROM requests');
  const rows = all.filter((r) => !familySlugs.has(r.stage));
  for (const r of rows) {
    let family;
    let sub = r.sub_stage ?? null;
    if (sub && SUB_TO_FAMILY[sub]) {
      // La sous-étape est déjà valide : elle désigne la famille et reste TELLE
      // QUELLE (plus précise que le mapping générique — ex. une ligne bloquée en
      // stage='preparation_production' mais sub_stage='prod_trotec' est bien une
      // commande de production Trotec, pas une préparation fichiers).
      family = SUB_TO_FAMILY[sub];
    } else if (STAGE_TO_FAMILY[r.stage]) {
      [family, sub] = STAGE_TO_FAMILY[r.stage];
    } else {
      // Slug totalement inconnu : on la renvoie en tête de pipeline plutôt que de
      // la laisser invisible dans la sidebar.
      family = 'demande';
      sub = null;
    }
    await pool.query('UPDATE requests SET stage = $1, sub_stage = $2 WHERE id = $3', [family, sub, r.id]);
  }
  if (rows.length) {
    console.log(`ℹ  Réparation : ${rows.length} commande(s) réalignée(s) vers le modèle « familles ».`);
  }
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
      stage: 'demande', sub_stage: null, responsable: 'Mélina', referent: 'Loïc', priority: 3, client_type: 'pro',
      billing_company: 'Hôtel Esmeralda', contact_referent: 'Julie M.', quantity: 50,
      product: '50 t-shirts staff', color: 'Noir', project_value: 850,
      description: 'Tee-shirts équipe — gros devis', deadline: inDays(3), position: 1000,
    },
    {
      stage: 'demande', sub_stage: null, responsable: 'À attribuer', priority: 1, client_type: 'perso',
      billing_company: 'Alessandro', contact_referent: 'Alessandro', quantity: 1,
      product: 'Impression plexi A3', project_value: 30, description: 'Photo à vérifier',
      deadline: inDays(1), position: 2000,
    },
    {
      stage: 'chiffrage', sub_stage: 'a_chiffrer', responsable: 'Mélina', priority: 2, client_type: 'revendeur',
      billing_company: 'Saint-Barth Store', contact_referent: 'Coach Bernard', quantity: 120,
      product: 'Collection été', project_value: 1450, description: 'Maillots saison 2026',
      deadline: inDays(8), position: 1000,
    },
    {
      stage: 'preparation', sub_stage: 'a_commander', responsable: 'Charlie', referent: 'Julien', priority: 3, client_type: 'pro',
      billing_company: 'Mairie de Vic', contact_referent: 'Service Com', quantity: 120,
      product: 'Tote bags sérigraphie', color: 'Écru', project_value: 3200,
      description: 'Sacs marché de Noël — TopTex en cours', deadline: inDays(1), position: 1000,
      flag: 'bloque', flag_reason: 'Attente du BAT signé par le service Com',
    },
    {
      stage: 'production', sub_stage: 'prod_pressage', responsable: 'Julien', priority: 2, client_type: 'asso',
      billing_company: 'Auto-école Rapid', contact_referent: 'M. Faure', quantity: 15,
      product: 'Polos brodés DTF', project_value: 540, description: 'Polos moniteurs',
      deadline: inDays(-1), position: 1000,
    },
    {
      stage: 'production', sub_stage: 'prod_trotec', responsable: 'Charlie', priority: 3, client_type: 'pro',
      billing_company: 'Menuiserie Vidal', contact_referent: 'Bruno V.', quantity: 40,
      product: 'Panneaux PVC', color: 'Blanc', project_value: 1200,
      description: 'Découpe forme sur la Trotec', deadline: inDays(5), position: 1000,
      flag: 'a_voir', flag_reason: 'Vérifier la teinte du blanc avec le client',
    },
    {
      stage: 'facturation', sub_stage: 'facturation_a_faire', responsable: 'Mélina', referent: 'Loïc', priority: 1, client_type: 'pro',
      billing_company: 'Pizzeria Bella', contact_referent: 'Marco', quantity: 8,
      product: 'Tabliers personnalisés', project_value: 240, description: 'Tabliers cuisine',
      deadline: inDays(-5), position: 1000,
    },
    {
      // Sans date et ancienne (> 7 j) : illustre le vieillissement « À planifier »
      // du dashboard (badge orange, remonte au-dessus des « Sans date » récentes).
      stage: 'preparation', sub_stage: 'prepa_fichiers', priority: 1, client_type: 'perso',
      billing_company: 'Atelier Broderie Sud', contact_referent: 'Mme Costa', quantity: 6,
      product: 'Casquettes brodées', project_value: 120, description: 'Client pas pressé — à planifier',
      deadline: null, position: 3000, created_days_ago: 9,
    },
  ];

  for (const s of samples) {
    const createdAt = new Date(today.getTime() - (s.created_days_ago ?? 0) * 86400000).toISOString();
    await pool.query(
      `INSERT INTO requests
        (stage, sub_stage, responsable, referent, priority, client_type, billing_company, contact_referent,
         quantity, product, color, project_value, description, deadline, position, created_at,
         flag, flag_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [s.stage, s.sub_stage ?? null, s.responsable ?? null, s.referent ?? null, s.priority, s.client_type,
       s.billing_company, s.contact_referent, s.quantity, s.product, s.color ?? null,
       s.project_value, s.description, s.deadline, s.position, createdAt,
       s.flag ?? null, s.flag_reason ?? null],
    );
  }
}

// --- Attribution des catégories à un employé (config éditable par le patron) --
// Stockée en clé/valeur applicative (app_meta.category_owners) sous forme d'un
// objet JSON { slugCatégorie: employé }. Une catégorie = une FAMILLE (ex.
// « chiffrage ») ou une SOUS-ÉTAPE (ex. « prod_pressage ») ; la sous-étape est
// plus précise et l'emporte sur sa famille lors du calcul du pilote effectif.
// Absente → aucune attribution par défaut (pilote effectif = « À attribuer »).
async function getCategoryOwners() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'category_owners'");
  if (!rows[0]) return {};
  try {
    const parsed = JSON.parse(rows[0].value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

async function setCategoryOwners(map) {
  const clean = {};
  const validSlugs = new Set([...STAGE_SLUGS, ...SUB_SLUGS]);
  const employeeSet = new Set(EMPLOYEES);
  for (const [slug, who] of Object.entries(map || {})) {
    // On ne retient que des couples valides : catégorie connue + vrai employé.
    // Une valeur vide / « À attribuer » = pas d'attribution → on l'omet.
    if (validSlugs.has(slug) && employeeSet.has(who)) clean[slug] = who;
  }
  const value = JSON.stringify(clean);
  await pool.query("DELETE FROM app_meta WHERE key = 'category_owners'");
  await pool.query("INSERT INTO app_meta (key, value) VALUES ('category_owners', $1)", [value]);
  return clean;
}

// --- Référents des catégories (config éditable par le patron) ---------------
// Même principe que l'attribution du pilote, mais N employés par catégorie :
// app_meta.category_referents = { slugCatégorie: [employé, ...] }. Sous-étape
// prioritaire sur sa famille (une liste posée sur la sous-étape REMPLACE celle
// de la famille). Sert de référents PAR DÉFAUT : un référent saisi à la main
// sur une commande (requests.referent) reste prioritaire.
async function getCategoryReferents() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'category_referents'");
  if (!rows[0]) return {};
  try {
    const parsed = JSON.parse(rows[0].value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

async function setCategoryReferents(map) {
  const clean = {};
  const validSlugs = new Set([...STAGE_SLUGS, ...SUB_SLUGS]);
  const employeeSet = new Set(EMPLOYEES);
  for (const [slug, list] of Object.entries(map || {})) {
    if (!validSlugs.has(slug) || !Array.isArray(list)) continue;
    // Catégorie connue + vrais employés, dédupliqués, ordre des EMPLOYEES.
    const who = EMPLOYEES.filter((e) => list.includes(e) && employeeSet.has(e));
    if (who.length) clean[slug] = who;   // liste vide = pas de référent → omise
  }
  const value = JSON.stringify(clean);
  await pool.query("DELETE FROM app_meta WHERE key = 'category_referents'");
  await pool.query("INSERT INTO app_meta (key, value) VALUES ('category_referents', $1)", [value]);
  return clean;
}

module.exports = {
  pool, init, repairOrphanStages,
  STAGES, STAGE_SLUGS, FAMILIES, SUB_STAGES, SUB_SLUGS, EMPLOYEES, RESPONSABLES, CLIENT_TYPES, FLAGS,
  ORDER_KINDS,
  getCategoryOwners, setCategoryOwners,
  getCategoryReferents, setCategoryReferents,
};
