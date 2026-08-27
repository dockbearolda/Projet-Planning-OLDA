'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool, types } = require('pg');

// `deadline` est une colonne `date` : un jour civil, sans heure ni fuseau. Par
// défaut pg la convertit en Date à minuit LOCAL, que res.json re-sérialise en
// UTC — à l'est de Greenwich l'échéance recule d'un jour à chaque lecture, et
// copyBody() (« Envoyer vers Fiverr », dupliquer) réécrit la valeur reculée en
// base, donc la dérive s'accumule. On garde donc la chaîne « aaaa-mm-jj » telle
// que Postgres la renvoie.
types.setTypeParser(types.builtins.DATE, (v) => v);

// Pipeline à 2 NIVEAUX (modèle « familles », d'après le CRM du patron) :
//   - la FAMILLE (requests.stage) dit OÙ en est le projet — 5 grandes étapes,
//     affichées dans la barre latérale gauche ;
//   - la SOUS-FAMILLE (requests.sub_stage) précise CE QUI SE PASSE MAINTENANT —
//     choisie en ligne sur la commande (puce), uniquement pour les familles qui
//     en ont. « 1 projet = 1 seule place. »
const FAMILIES = [
  // LE SUR-DOSSIER DU COMPTOIR, en tête de toutes les familles. TOUT ce que la
  // vendeuse enregistre arrive ici, vente comme demande de devis, et nulle part
  // ailleurs : elle enchaîne cinq clients sans rien classer, puis revient au
  // planning et range chaque dossier dans sa famille.
  // Elle n'a PAS de sous-étapes : un dossier qui n'a pas encore été rangé n'est
  // à aucune étape de travail — c'est précisément ce qu'il faut voir.
  { slug: 'a_trier', label: 'À trier' },
  // Reçu, qualifié, chiffré, devis envoyé, devis validé : tout le commercial
  // avant que l'atelier ne touche quoi que ce soit.
  { slug: 'demande_chiffrage', label: 'Demande & chiffrage' },
  { slug: 'preparation', label: 'Préparation du projet' },
  { slug: 'production', label: 'Production' },
  { slug: 'facturation', label: 'Facturation & remise au client' },
  // Le dossier est parti chez le client : reste l'argent, puis l'archive.
  { slug: 'paiement', label: 'Paiement & clôture' },
];

// Catégorie spéciale conservée hors des 5 familles : sous-traitance graphiste
// (outil de devis + « Envoyer vers Fiverr »). Épinglée en bas de la sidebar.
const SPECIAL = [
  { slug: 'fiverr', label: 'Fiverr' },
];

// Toutes les valeurs possibles de requests.stage (familles + spécial).
const STAGES = [...FAMILIES, ...SPECIAL];
const STAGE_SLUGS = STAGES.map((s) => s.slug);

// Sous-familles par famille (slug → libellé). « À trier » et Fiverr
// n'en ont pas : la première est un sur-dossier d'attente (le dossier n'est à
// aucune étape de travail tant qu'il n'est pas rangé), le second est une
// sous-traitance. Les 5 autres décrivent une suite d'actions précises.
// « À commander » et « Attente marchandise » se glissent entre la validation de
// l'acompte et « Prêt à produire » : on valide l'argent, on commande la
// marchandise, on la reçoit, alors seulement la production peut démarrer.
const SUB_STAGES = {
  demande_chiffrage: [
    { slug: 'demande_recue', label: 'Demande reçue' },
    { slug: 'demande_a_qualifier', label: 'Demande à qualifier' },
    { slug: 'a_chiffrer', label: 'À chiffrer' },
    { slug: 'chiffrage_en_cours', label: 'Chiffrage en cours' },
    { slug: 'devis_envoye', label: 'Tarif / Devis envoyé – Attente client' },
    { slug: 'devis_valide', label: 'Devis validé' },
  ],
  preparation: [
    { slug: 'prepa_produits', label: 'Préparation des produits' },
    { slug: 'prepa_bat', label: 'Préparation du BAT' },
    { slug: 'bat_envoye', label: 'BAT envoyé – Attente validation' },
    // « Modification demandée » (§20). Sans elle, un BAT que le client renvoie
    // à corriger retombait dans « Préparation du BAT » — indiscernable d'un BAT
    // qu'on n'a jamais envoyé, alors que ce n'est pas du tout le même travail
    // ni la même urgence : là, quelqu'un attend.
    { slug: 'bat_modif', label: 'BAT – Modification demandée' },
    { slug: 'bat_valide', label: 'BAT validé' },
    { slug: 'validation_acompte', label: 'Validation acompte / Conditions de paiement' },
    { slug: 'a_commander', label: 'À commander' },
    { slug: 'attente_marchandise', label: 'Attente marchandise' },
    { slug: 'pret_a_produire', label: 'Prêt à produire' },
  ],
  production: [
    { slug: 'prod_dtf', label: 'Production DTF' },
    { slug: 'decoupe_dtf', label: 'Découpe & Contrôle DTF' },
    { slug: 'prod_pressage', label: 'Pressage' },
    { slug: 'prod_trotec', label: 'Production Trotec' },
    { slug: 'prod_uv', label: 'Production UV' },
    { slug: 'montage_finition', label: 'Montage / Finition' },
    { slug: 'controle_emballage', label: 'Contrôle & Emballage' },
  ],
  facturation: [
    { slug: 'facturation_a_faire', label: 'Facturation à faire' },
    { slug: 'client_a_prevenir', label: 'Client à prévenir' },
    { slug: 'client_prevenu', label: 'Client prévenu – Attente retrait' },
    { slug: 'commande_recuperee', label: 'Commande récupérée' },
  ],
  paiement: [
    { slug: 'paiement_a_controler', label: 'Paiement à contrôler' },
    { slug: 'paiement_valide', label: 'Paiement validé / Soldé' },
    { slug: 'archive', label: 'Archivé' },
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

// --- Les quatre personnes, et leur rôle --------------------------------------
// Attribution donnée par Charlie le 25/08/2026, en réponse au §3 du patron.
// Ce sont EXACTEMENT les quatre prénoms d'EMPLOYEES ci-dessus : le rôle se pose
// sur une liste qui existe déjà, il ne crée pas de population nouvelle. C'est
// pour ça qu'aucun écran de gestion d'utilisateurs n'est nécessaire d'abord.
const ROLES = ['direction', 'chef_atelier', 'boutique', 'operateur'];
const ROLE_LABELS = {
  direction: 'Direction',
  chef_atelier: 'Chef d’atelier',
  boutique: 'Boutique',
  operateur: 'Atelier',
};
const EQUIPE = [
  { prenom: 'Loïc', role: 'direction' },
  { prenom: 'Charlie', role: 'chef_atelier' },
  { prenom: 'Mélina', role: 'boutique' },
  { prenom: 'Julien', role: 'operateur' },
];

// Types de client.
const CLIENT_TYPES = ['pro', 'perso', 'asso', 'revendeur'];

// ALERTE portée par une commande (requests.flag), posable par n'importe quel
// collaborateur depuis la grille. null = rien à signaler. Le MOTIF libre vit
// dans requests.flag_reason (« BLOQUÉE — attente BAT client »).
const FLAGS = ['bloque', 'a_voir'];

// NATURE de la ligne, tranchée à l'enregistrement (requests.order_kind) :
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
    // TOUTE REQUÊTE A UNE FIN — la règle du navigateur (reseau.js) vaut pour le
    // serveur. Sans ces bornes, un Postgres qui décroche (bascule Railway,
    // réseau interne) laissait `pool.connect()` et chaque requête pendre à
    // l'infini : les 10 clients du pool se remplissaient de requêtes mortes et
    // l'application entière se figeait, sans erreur, jusqu'au redémarrage.
    max: 10,
    connectionTimeoutMillis: 5000,  // obtenir un client du pool
    idleTimeoutMillis: 30000,       // rendre les clients inutilisés
    query_timeout: 15000,           // côté pilote : la promesse échoue
    statement_timeout: 15000,       // côté Postgres : la requête est tuée
  });
  // Un client INACTIF du pool peut mourir tout seul (redémarrage de Postgres,
  // coupure réseau) : `pg` émet alors 'error' sur le pool, et un EventEmitter
  // sans écouteur 'error'... TERMINE LE PROCESSUS. C'était le crash le plus
  // probable en production — sans aucune requête en cours pour l'expliquer.
  pool.on('error', (err) => {
    console.error('Client PostgreSQL inactif perdu (reconnexion au prochain usage) :', err.message);
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
  // pg-mem n'implémente que très peu de fonctions natives. On lui apprend
  // celles dont la RECHERCHE GLOBALE se sert, pour que la base locale se
  // comporte comme PostgreSQL : sans elles, le test passait à côté du chemin
  // réellement servi en production.
  mem.public.registerFunction({
    name: 'translate', args: ['text', 'text', 'text'], returns: 'text',
    implementation: (s, de, vers) => {
      if (s == null) return null;
      let out = '';
      for (const c of String(s)) {
        const i = String(de || '').indexOf(c);
        // Un caractère listé dans `de` sans équivalent dans `vers` est SUPPRIMÉ :
        // c'est la règle de PostgreSQL, pas un oubli.
        out += i === -1 ? c : (String(vers || '')[i] ?? '');
      }
      return out;
    },
  });
  mem.public.registerFunction({
    name: 'concat_ws', args: ['text', 'text'], returns: 'text', allowNullArguments: true,
    implementation: (sep, ...parts) => parts.filter((p) => p != null).join(sep == null ? '' : sep),
  });
  mem.public.registerFunction({
    name: 'strpos', args: ['text', 'text'], returns: 'int',
    implementation: (foin, aiguille) => (foin == null || aiguille == null
      ? null
      : String(foin).indexOf(String(aiguille)) + 1),
  });
  const MemPg = mem.adapters.createPg();
  pool = new MemPg.Pool();
  console.log('ℹ  Mode local : base en mémoire (pg-mem). Données non persistantes.');
}

// Écrit un réglage en UNE requête. En DELETE puis INSERT, la clé n'existait
// plus pendant un court instant : une lecture simultanée retombait sur les
// valeurs d'usine (un barème express remis à 20/10/0, par exemple), et deux
// écritures entrelacées violaient la clé primaire — 500 sur un réglage valide.
async function poserMeta(key, value) {
  await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  );
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

  // Migration : SUIVI DU PAIEMENT sur une commande. Cinq informations que le
  // patron veut voir d'un coup d'œil : l'acompte a-t-il été demandé, a-t-il été
  // versé, pour quelle somme exacte, le projet est-il soldé, et par quel moyen.
  // Toutes nullables et sans valeur par défaut : une ligne d'avant cette
  // migration n'affirme rien plutôt que d'affirmer « non payé » à tort.
  // Down : ALTER TABLE requests DROP COLUMN IF EXISTS <col> pour chacune.
  for (const [col, type] of [
    ['acompte_demande', 'boolean'],
    ['acompte_verse', 'boolean'],
    ['acompte_montant', 'numeric(12,2)'],
    ['paye', 'boolean'],
    ['paiement_mode', 'text'],
  ]) {
    try {
      await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS ${col} ${type}`);
    } catch (_) { /* pg-mem local : colonne déjà présente via le schéma */ }
  }

  // Migration : NATURE pro / perso sur la base clients (distincte du `type`
  // métier libre). Les clients déjà présents viennent tous de la base PRO
  // rapatriée → on les marque 'pro'. Nouveaux clients perso saisis au comptoir.
  // Down : ALTER TABLE clients DROP COLUMN IF EXISTS client_type.
  try {
    await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_type text DEFAULT 'pro'");
  } catch (_) { /* pg-mem local : colonne déjà présente via le schéma */ }
  await pool.query("UPDATE clients SET client_type = 'pro' WHERE client_type IS NULL");

  // Migration : champs enrichis de la fiche client (venus du classeur patron
  // « CRM OLDA CREATION CLIENTS ») — identifiant lisible, raison sociale,
  // adresse détaillée, secteur d'activité, référent. Tous nullable : une fiche
  // créée avant cette migration reste valide, juste incomplète.
  // Down : ALTER TABLE clients DROP COLUMN IF EXISTS <col> pour chacune.
  for (const col of ['code', 'raison_sociale', 'code_postal', 'ville', 'pays', 'secteur', 'referent_prenom', 'prenom']) {
    try {
      await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS ${col} text`);
    } catch (_) { /* pg-mem local : colonne déjà présente via le schéma */ }
  }

  // Migration RÉVERSIBLE de la liste d'employés : « Opérateur » a été retiré au
  // profit de « Julien ». Les lignes encore pilotées par « Opérateur » basculent
  // sur « À attribuer » (valeur neutre, toujours valide) pour rester éditables.
  // Down : UPDATE requests SET responsable='Opérateur' WHERE responsable='À attribuer'
  // (non rejouable à l'identique, mais aucune donnée n'est perdue).
  await pool.query("UPDATE requests SET responsable = 'À attribuer' WHERE responsable = 'Opérateur'");

  // Index sur les deux clés d'idempotence du comptoir. Elles vivent DANS le
  // JSON de la fiche (pas dans une colonne) : sans index, chaque prise de
  // commande balayait toute la table `requests` — deux fois — et le coût montait
  // avec l'historique. Créés ici plutôt que dans schema.sql : ce sont des index
  // sur EXPRESSION, que pg-mem (base locale de test) ne sait pas construire.
  // Down : DROP INDEX IF EXISTS idx_requests_fiche_ref, idx_requests_fiche_empreinte;
  try {
    await pool.query("CREATE INDEX IF NOT EXISTS idx_requests_fiche_ref ON requests ((fiche->>'ref'))");
  } catch (_) { /* pg-mem local : pas d'index sur expression, sans conséquence */ }

  // L'ORDRE DE LA LISTE, indexé. /api/requests trie par (position NULLS LAST,
  // priority DESC, deadline, created_at) — or l'index existant commence par
  // priority : Postgres filtrait par étape puis TRIAIT TOUTE L'ÉTAPE à chaque
  // affichage, y compris l'archive de clôture que le LIMIT 401 aurait épargnée.
  // Avec l'index aligné sur l'ORDER BY, la lecture s'arrête au plafond — et le
  // même index, parcouru à rebours, sert ORDER_INVERSE (son miroir exact).
  // Down : DROP INDEX IF EXISTS idx_requests_liste;
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_requests_liste
      ON requests (stage, position ASC NULLS LAST, priority DESC, deadline ASC NULLS LAST, created_at ASC)`);
  } catch (_) { /* pg-mem local : options d'index partiellement gérées, sans conséquence */ }

  // L'EMPREINTE, elle, est UNIQUE — et c'est la base qui le garantit, pas le
  // code. Le serveur lisait l'empreinte puis insérait : deux envois du MÊME
  // dossier partis en même temps (la tablette rame, la vendeuse tape deux fois)
  // passaient tous les deux la lecture et créaient deux commandes portant le
  // même numéro de ticket. Une lecture-puis-écriture ne peut pas trancher ça ;
  // une contrainte, si. Les lignes d'avant l'empreinte valent NULL, et Postgres
  // autorise autant de NULL qu'il veut dans un index unique : elles ne gênent pas.
  await creerIndexUniqueEmpreinte();

  // Migration vers le planning linéaire : convertit les anciens slugs d'étape
  // (dont la phase « production » multi-machines) vers la liste linéaire.
  // Non destructif, idempotent, réversible (voir migrateStagesToLinear).
  await migrateStagesToLinear();

  // Puis bascule du modèle linéaire vers le modèle « familles » à 2 niveaux.
  // Non destructif, exécuté UNE seule fois (garde app_meta).
  await migrateStagesToFamilies();

  // Enfin, regroupement des 8 familles en 5 (liste d'étapes du patron).
  // Non destructif, exécuté UNE seule fois (garde app_meta séparée).
  await migrateFamiliesToFive();

  // Filet de sécurité : réaligne toute ligne restée sur un ancien slug malgré la
  // garde ci-dessus (import / restauration de sauvegarde). Idempotent.
  await repairOrphanStages();

  // Seed : si la table est vide, on insère quelques demandes d'exemple
  // réparties sur plusieurs étapes pour démontrer le pipeline.
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM requests');
  if (rows[0].n === 0) {
    await seed();
  }

  // Clé de rapprochement du client, RANGÉE EN COLONNE. Elle se calculait en JS
  // à chaque prise de commande, ce qui obligeait à charger TOUTE la table pour
  // savoir si un client existait déjà — et laissait deux postes créer la même
  // fiche en même temps, la lecture ne bloquant rien.
  // AVANT l'import : celui-ci renseigne désormais la colonne lui-même.
  await migrerCleClient();

  // Base clients : import initial des clients pros rapatriés de l'ancienne app.
  await seedClients();

  // Tailles de logo : l'instantané livré avec le code, si la base n'en a pas.
  await semerTaillesLogo();

  // Les faces de la tasse, que l'instantané ne pouvait plus poser en place.
  await semerFacesTasse();
  await semerFacesCouteau();
  // Le feu ne peut rien dire des dossiers d'avant lui tant qu'on ne lui a pas
  // rendu ce qu'ils portaient déjà.
  await rattraperFeu();

  // Identifiant lisible pour les fiches qui n'en ont pas — après l'import, pour
  // que les clients rapatriés en reçoivent un eux aussi.
  await rattraperCodesClients();

  // ARCHIVAGE au lieu de suppression, sur les deux tables qui portent du métier.
  // Colonnes nullables sans défaut : une ligne d'avant la migration vaut « null »
  // donc « vivante », ce qui est exact. Rien à recalculer, rien à rattraper.
  // Down : ALTER TABLE requests DROP COLUMN IF EXISTS deleted_at;
  //        ALTER TABLE clients  DROP COLUMN IF EXISTS deleted_at;
  for (const table of ['requests', 'clients']) {
    try {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS deleted_at timestamptz`);
    } catch (_) { /* pg-mem local : colonne déjà présente via le schéma */ }
  }

  // LE « QUI » DU JOURNAL. Déclaratif (le prénom du poste), pas une preuve —
  // voir le commentaire de la colonne dans schema.sql.
  // Down : ALTER TABLE request_events DROP COLUMN IF EXISTS who;
  try {
    await pool.query('ALTER TABLE request_events ADD COLUMN IF NOT EXISTS who text');
  } catch (_) { /* pg-mem local : colonne déjà présente via le schéma */ }

  // Toutes les lectures d'écran filtrent désormais `deleted_at IS NULL` (voir
  // VIVANTES dans server.js). Sans index, ce filtre s'ajoute à un parcours que
  // l'index de liste couvrait entièrement — et il porte sur TOUTES les lectures,
  // y compris le temps réel. L'index PARTIEL ne range que les lignes vivantes :
  // il reste petit quoi qu'il arrive, l'archive n'y entrant jamais.
  // Down : DROP INDEX IF EXISTS idx_requests_vivantes;
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_requests_vivantes
      ON requests (stage, position ASC NULLS LAST) WHERE deleted_at IS NULL`);
  } catch (_) { /* pg-mem local : index partiel non géré, sans conséquence */ }

  // LE BAT et LA PROVENANCE. Down : ALTER TABLE requests DROP COLUMN IF EXISTS
  // bat_requis, bat_valide_le, provenance;
  for (const [col, type] of [
    ['bat_requis', 'boolean NOT NULL DEFAULT false'],
    ['bat_valide_le', 'timestamptz'],
    ['provenance', 'text'],
    ['date_prevue', 'date'],
    ['retrait_creneau', 'text'],
  ]) {
    try {
      await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS ${col} ${type}`);
    } catch (_) { /* pg-mem local : colonne déjà présente via le schéma */ }
  }

  // LE DEVIS, EN MIROIR DU BAT (26/08/2026). « Quand le projet arrive en
  // production il doit obligatoirement avoir un devis validé, un BAT validé
  // ainsi que le paiement » (le patron, rapporté par Charlie). Le BAT avait ses
  // deux colonnes ; le devis n'était qu'une SOUS-ÉTAPE qu'on déplaçait à la
  // main — donc rien qu'on puisse vérifier, ni dater, ni attribuer.
  //
  // `devis_requis` s'arme TOUT SEUL, comme `bat_requis` : déposer un devis,
  // c'est en avoir un ; et un dossier né d'une demande de devis en exige un par
  // construction. Personne n'a à cocher « ce dossier a un devis », et personne
  // ne le ferait.
  //
  // La date, elle, dit QUAND et — au journal — PAR QUI. Une colonne dans un
  // tableau ne dit ni l'un ni l'autre : c'est toute la différence entre un fait
  // et une position.
  // Down : ALTER TABLE requests DROP COLUMN IF EXISTS devis_requis, devis_valide_le;
  for (const [col, type] of [
    ['devis_requis', 'boolean NOT NULL DEFAULT false'],
    ['devis_valide_le', 'timestamptz'],
  ]) {
    try {
      await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS ${col} ${type}`);
    } catch (_) { /* pg-mem local : colonne déjà présente via le schéma */ }
  }

  // LE COÛT DE REVIENT, colonne à part. Down : ALTER TABLE requests DROP COLUMN
  // IF EXISTS cout_revient;
  try {
    await pool.query('ALTER TABLE requests ADD COLUMN IF NOT EXISTS cout_revient numeric(12,2)');
  } catch (_) { /* pg-mem local : colonne déjà présente via le schéma */ }

  // LE RATTACHEMENT D'UNE LIGNE À SON PROJET. Nullable, sans contrainte : les
  // lignes d'avant restent valides, elles n'appartiennent simplement à aucun
  // dossier — et une commande à un seul article n'a pas besoin d'en avoir un.
  // Down : ALTER TABLE requests DROP COLUMN IF EXISTS project_id;
  try {
    await pool.query('ALTER TABLE requests ADD COLUMN IF NOT EXISTS project_id uuid');
  } catch (_) { /* pg-mem local : colonne déjà présente via le schéma */ }
  try {
    await pool.query('CREATE INDEX IF NOT EXISTS idx_requests_project ON requests (project_id)');
  } catch (_) { /* pg-mem : sans conséquence, le filtre reste correct */ }

  // LES PROJETS DÉJÀ REGROUPÉS À L'ÉCRAN DEVIENNENT DE VRAIS DOSSIERS.
  //
  // Depuis le travail sur les lots, un panier de N articles fait N lignes qui
  // portent la MÊME référence de ticket dans `fiche.lot.ref`. Ce regroupement
  // existait donc déjà — mais seulement à l'affichage. On le range en base, une
  // fois, pour les dossiers qui étaient là avant les projets.
  //
  // Garde app_meta PROPRE (deux incidents réels sont venus d'une garde
  // partagée) : la migration ne doit pas rejouer et recréer des doublons.
  // Down : UPDATE requests SET project_id = NULL; DELETE FROM projects;
  //        DELETE FROM app_meta WHERE key = 'lots_en_projets_v1';
  await migrerLotsEnProjets();

  // LES QUATRE COMPTES. Créés s'ils manquent, jamais réécrits : un code déjà
  // choisi ne doit pas repartir à zéro au redémarrage suivant. C'est un `INSERT
  // … ON CONFLICT DO NOTHING` sur le prénom, donc idempotent par nature — pas
  // besoin d'une garde `app_meta`, et surtout pas d'une garde qui empêcherait
  // un cinquième compte d'arriver un jour.
  // Down : DELETE FROM users WHERE prenom IN ('Loïc','Charlie','Mélina','Julien');
  for (const membre of EQUIPE) {
    try {
      await pool.query(
        'INSERT INTO users (prenom, role) VALUES ($1, $2) ON CONFLICT (prenom) DO NOTHING',
        [membre.prenom, membre.role],
      );
    } catch (_) {
      // pg-mem : l'index unique sur `prenom` peut manquer, donc `ON CONFLICT`
      // n'a rien à quoi se raccrocher. On retombe sur la lecture-puis-écriture,
      // qui suffit ici : le démarrage n'est pas concurrent avec lui-même.
      const { rows } = await pool.query('SELECT 1 FROM users WHERE prenom = $1', [membre.prenom]);
      if (!rows.length) {
        await pool.query('INSERT INTO users (prenom, role) VALUES ($1, $2)', [membre.prenom, membre.role]);
      }
    }
  }
  // LE RÔLE, LUI, SE RÉALIGNE. C'est une décision d'organisation, pas une
  // donnée que la personne possède : si Charlie décide que Julien passe chef
  // d'atelier, la ligne d'EQUIPE fait foi au prochain démarrage. Le code
  // personnel, lui, n'est jamais touché.
  for (const membre of EQUIPE) {
    await pool.query(
      'UPDATE users SET role = $2, updated_at = now() WHERE prenom = $1 AND role <> $2',
      [membre.prenom, membre.role],
    );
  }

  // LES DOSSIERS DÉJÀ EN BASE RATTRAPENT LEUR LIGNE DE PRODUCTION.
  //
  // Garde app_meta PROPRE, une par migration (deux incidents réels sont venus
  // d'une garde partagée) — et elles sont indépendantes : la première lit
  // `fiche.details`, la seconde compare `description`.
  // Down : UPDATE requests SET fiche = fiche - 'prod' WHERE ... ;
  //        DELETE FROM app_meta WHERE key = 'prod_des_lignes_v1';
  await reprendreProdDesLignes();
  // Down : reposer le récapitulatif recomposé (recapDeLaFiche) sur les mêmes
  //        lignes ; DELETE FROM app_meta WHERE key = 'infos_sans_recap_v1';
  await libererLaColonneInfos();

  // Ménage : table créée à chaque démarrage et jamais utilisée.
  await retirerTableStatuses();
  // Le stock retiré le 26/08 : on récupère la place, mais seulement si personne
  // n'y a rien saisi.
  await retirerTablesStock();
  // Même règle pour les deux autres reliquats : on ne retire QUE ce qui est vide.
  await retirerTableProductionSectors();
  await retirerColonneStatus();
}

// La table `statuses` était recréée à chaque démarrage sans qu'aucune ligne de
// code ne la lise ni ne l'écrive. On la retire — mais SEULEMENT si elle est
// vide. Si une base contient quoi que ce soit dedans (import, essai, version
// plus ancienne), on n'y touche pas : ce n'est pas au démarrage du service de
// décider de supprimer des données que personne n'a regardées.
// Down : voir le DDL conservé dans schema.sql.
// LE STOCK A ÉTÉ RETIRÉ (26/08/2026, décision de Charlie : « supprime stock
// définitivement »). Les six tables du lot 5 — catalogue, déclinaisons,
// mouvements, fournisseurs, commandes fournisseur et leurs lignes — ne sont plus
// créées ni lues par personne.
//
// On les retire des bases qui les portent, mais SEULEMENT si elles sont toutes
// VIDES : c'est la règle du dépôt pour tout ménage de schéma, et ici elle a une
// raison de plus — rien n'a jamais été déployé, donc une base qui contiendrait
// des lignes serait une base où quelqu'un a saisi pour de bon.
//
// Down (tout est dans le commit ca5d556) :
//   git revert af709a2  →  rend l'écran, les routes et le schéma.
async function retirerTablesStock() {
  const tables = ['purchase_lines', 'purchase_orders', 'stock_moves', 'variants', 'products', 'suppliers'];
  let occupees = 0;
  for (const t of tables) {
    try {
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
      if (rows[0].n > 0) occupees += rows[0].n;
    } catch (_) { /* absente : c'est ce qu'on veut */ }
  }
  if (occupees > 0) {
    console.log(`ℹ  Tables du stock conservées : elles contiennent ${occupees} ligne(s).`);
    return;
  }
  // L'ORDRE COMPTE : les lignes d'achat avant les commandes, les déclinaisons
  // avant les produits. Sur une base qui porte de vraies clés étrangères,
  // l'inverse échouerait — et sur pg-mem, qui n'en pose pas, ça ne coûte rien.
  for (const t of tables) {
    try {
      await pool.query(`DROP TABLE ${t}`);
    } catch (err) {
      const absente = (err && err.code === '42P01')
        || /does not exist|n'existe pas/i.test((err && err.message) || '');
      if (!absente) console.error(`Table « ${t} » non retirée (sans conséquence) :`, err.message);
    }
  }
}

async function retirerTableStatuses() {
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM statuses');
    if (rows[0].n > 0) {
      console.log(`ℹ  Table « statuses » conservée : elle contient ${rows[0].n} ligne(s).`);
      return;
    }
    await pool.query('DROP TABLE statuses');
  } catch (err) {
    // La table n'existe plus : c'est exactement ce qu'on voulait. Postgres le
    // dit par le code 42P01, pg-mem seulement par le message — les deux comptent.
    const absente = (err && err.code === '42P01')
      || /does not exist|n'existe pas/i.test((err && err.message) || '');
    if (absente) return;
    console.error('Table « statuses » non retirée (sans conséquence) :', err.message);
  }
}

// `production_sectors` datait du pipeline linéaire : depuis le passage aux
// 5 familles, la production se lit dans `sub_stage` et plus AUCUNE requête de
// l'application n'y touche — sauf une vieille migration, elle-même gardée par
// `app_meta`, et la cascade de suppression d'une commande. Elle est recréée à
// chaque démarrage par `schema.sql` pour rien.
// Même prudence qu'ailleurs : on ne retire que si elle est VIDE. Une base qui
// contiendrait encore des secteurs (atelier resté sur une vieille version, essai
// jamais nettoyé) la garde, et la migration continue de la lire.
// Down : voir le DDL conservé dans schema.sql.
async function retirerTableProductionSectors() {
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM production_sectors');
    if (rows[0].n > 0) {
      console.log(`ℹ  Table « production_sectors » conservée : ${rows[0].n} ligne(s) dedans.`);
      return;
    }
    await pool.query('DROP TABLE production_sectors');
  } catch (err) {
    const absente = (err && err.code === '42P01')
      || /does not exist|n'existe pas/i.test((err && err.message) || '');
    if (absente) return;
    console.error('Table « production_sectors » non retirée (sans conséquence) :', err.message);
  }
}

// `requests.status` est un reliquat du modèle d'avant les familles : plus
// personne ne l'écrit ni ne la lit (l'état d'une commande vit dans `stage` /
// `sub_stage`, son alerte dans `flag`). Elle repartait pourtant vers chaque
// poste, sur chaque ligne, à chaque rafraîchissement.
// On ne la supprime QUE si elle est vide partout : une colonne qui porte encore
// quelque chose n'est pas au démarrage du service de décider de la jeter.
// Down : ALTER TABLE requests ADD COLUMN IF NOT EXISTS status text;
async function retirerColonneStatus() {
  try {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM requests WHERE status IS NOT NULL',
    );
    if (rows[0].n > 0) {
      console.log(`ℹ  Colonne « requests.status » conservée : ${rows[0].n} ligne(s) la renseignent.`);
      return;
    }
    await pool.query('ALTER TABLE requests DROP COLUMN status');
  } catch (err) {
    const absente = (err && err.code === '42703')
      || /does not exist|n'existe pas|column/i.test((err && err.message) || '');
    if (absente) return;
    console.error('Colonne « requests.status » non retirée (sans conséquence) :', err.message);
  }
}

// Colonne `cle` + unicité sur la base clients.
// Down : DROP INDEX IF EXISTS idx_clients_cle; ALTER TABLE clients DROP COLUMN IF EXISTS cle;
//        DELETE FROM app_meta WHERE key = 'clients_cle_v1';
async function migrerCleClient() {
  try {
    await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS cle text');
  } catch (_) { /* déjà là */ }

  const { rows: meta } = await pool.query("SELECT value FROM app_meta WHERE key = 'clients_cle_v1'");
  if (!(meta[0] && meta[0].value === '1')) {
    // Garde PROPRE à cette migration (deux incidents sont venus d'une garde
    // partagée). On remplit la clé en JS : la normalisation retire les accents
    // et la ponctuation, ce qu'aucune fonction native disponible ne fait ici.
    const { rows } = await pool.query('SELECT id, entreprise FROM clients WHERE cle IS NULL');
    for (const c of rows) {
      await pool.query('UPDATE clients SET cle = $1 WHERE id = $2', [clientKey(c.entreprise), c.id]);
    }
    if (rows.length) console.log(`ℹ  Base clients : ${rows.length} clé(s) de rapprochement posée(s).`);
    await poserMeta('clients_cle_v1', '1');
  }

  // Même prudence que pour l'empreinte : si la base contient déjà deux fiches
  // pour le même client, on ne choisit pas à la place du patron — une des deux
  // porte peut-être des notes ou un historique d'appels. On le dit, en NOMMANT
  // les sociétés concernées pour que la fusion prenne deux minutes depuis Base
  // clients, et on garde un index simple : il suffit déjà à supprimer le
  // balayage complet de la table à chaque prise de commande.
  try {
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_cle ON clients (cle)');
  } catch (err) {
    if (err && err.code === '23505') {
      let noms = '';
      try {
        const { rows } = await pool.query(`
          SELECT entreprise, COUNT(*)::int AS n FROM clients
           GROUP BY cle, entreprise HAVING COUNT(*) > 1 ORDER BY entreprise LIMIT 20`);
        noms = rows.map((r) => `${r.entreprise} ×${r.n}`).join(', ');
      } catch (_) { /* l'aperçu est un confort */ }
      console.error(
        '⚠  Base clients : des fiches font double emploi, l\'unicité n\'a PAS été',
        'posée (rien n\'a été supprimé). À fusionner depuis Base clients.',
        noms ? `Concernées : ${noms}.` : '',
      );
    }
    try {
      await pool.query('CREATE INDEX IF NOT EXISTS idx_clients_cle ON clients (cle)');
    } catch (_) { /* pg-mem : sans conséquence, la table est petite */ }
  }
}

// Les clients nés d'une prise de commande n'avaient PAS de code : la création
// manuelle en attribuait un (« CLI-PRO-0007 »), pas l'automatique. La base du
// patron avait donc deux sortes de fiches, dont la majorité sans repère lisible.
// On rattrape les manquantes, dans l'ordre où elles ont été créées, avec le même
// compteur que les nouvelles — aucun numéro n'est réutilisé.
// Down : UPDATE clients SET code = NULL WHERE ... ; DELETE FROM app_meta WHERE key = 'clients_codes_v1';
async function rattraperCodesClients() {
  const { rows: meta } = await pool.query("SELECT value FROM app_meta WHERE key = 'clients_codes_v1'");
  if (meta[0] && meta[0].value === '1') return;
  const { rows } = await pool.query(
    "SELECT id, client_type FROM clients WHERE code IS NULL OR code = '' ORDER BY created_at ASC, id ASC",
  );
  for (const c of rows) {
    await pool.query('UPDATE clients SET code = $1 WHERE id = $2', [await nextClientCode(c.client_type), c.id]);
  }
  if (rows.length) console.log(`ℹ  Base clients : ${rows.length} code(s) attribué(s).`);
  await poserMeta('clients_codes_v1', '1');
}

// Clé de rapprochement d'un client : insensible à la casse, aux accents et à la
// ponctuation, pour que « Iguana (Discover) » et « iguana discover » soient LE
// MÊME client. Elle vit ici parce que la base s'en sert aussi (colonne `cle`).
// ATTENTION : elle ne normalise pas l'ORDRE des mots — « Prénom NOM » et
// « NOM Prénom » sont deux clés distinctes. C'est pour ça que le nom d'un
// particulier se stocke toujours dans le même ordre.
const clientKey = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Identifiant lisible « CLI-PRO-0007 » / « CLI-PERSO-0007 » : un repère visuel
// pour le patron (comme dans son classeur), pas un UUID. Compteur persistant en
// app_meta (jamais dérivé des lignes existantes) : un numéro attribué n'est
// JAMAIS réutilisé, même si le client qui le portait est supprimé ensuite.
// Incrément atomique : deux fiches créées en même temps sur deux postes ne
// peuvent pas porter le même code.
async function nextClientCode(clientType) {
  const perso = clientType === 'perso';
  const prefix = perso ? 'CLI-PERSO-' : 'CLI-PRO-';
  const metaKey = perso ? 'client_code_seq_perso' : 'client_code_seq_pro';
  const { rows } = await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ($1, '1')
     ON CONFLICT (key) DO UPDATE SET value = ((app_meta.value)::int + 1)::text
     RETURNING value`,
    [metaKey],
  );
  return `${prefix}${String(Number.parseInt(rows[0].value, 10)).padStart(4, '0')}`;
}

// Pose la contrainte d'unicité sur l'empreinte du dossier comptoir.
//
// Une base qui tourne déjà peut contenir des doublons nés du bug qu'on corrige.
// L'index refuse alors de se créer. Deux choses qu'on ne fait PAS dans ce cas :
//   - laisser l'erreur remonter, qui empêcherait le service de démarrer et
//     fermerait le comptoir pour une migration de confort ;
//   - supprimer les lignes en trop toutes seules au démarrage. Ce sont des
//     COMMANDES. Deux dossiers identiques peuvent aussi être deux vraies ventes
//     (les mêmes 12 mugs, commandés deux fois le même jour) et personne ne doit
//     découvrir après coup qu'un serveur a tranché à sa place.
// On retombe donc sur un index simple, et on écrit dans les logs de quoi aller
// regarder. La file du serveur, elle, empêche déjà tout NOUVEAU doublon.
// Down : DROP INDEX IF EXISTS idx_requests_fiche_empreinte;
//        CREATE INDEX idx_requests_fiche_empreinte ON requests ((fiche->>'empreinte'));
async function creerIndexUniqueEmpreinte() {
  const creer = async (unique) => pool.query(
    `CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS idx_requests_fiche_empreinte
     ON requests ((fiche->>'empreinte'))`,
  );
  try {
    await creer(true);
    return;
  } catch (err) {
    // Tout ce qui n'est pas « il y a déjà des doublons » n'a rien à voir avec
    // cette migration : pg-mem, en local, ne construit simplement aucun index
    // sur expression. La sérialisation côté serveur suffit là-bas.
    if (!err || err.code !== '23505') return;
  }

  let apercu = '';
  try {
    const { rows } = await pool.query(`
      SELECT fiche->>'ref' AS ref, COUNT(*)::int AS n
        FROM requests
       WHERE fiche->>'empreinte' IS NOT NULL
       GROUP BY fiche->>'empreinte', fiche->>'ref'
      HAVING COUNT(*) > 1
       ORDER BY n DESC LIMIT 10`);
    apercu = rows.map((r) => `${r.ref || '(sans réf)'} ×${r.n}`).join(', ');
  } catch (_) { /* l'aperçu est un confort, son absence ne change rien */ }

  console.error(
    '⚠  Dossiers comptoir en double détectés : la contrainte d\'unicité n\'a PAS',
    'été posée (aucune donnée n\'a été touchée). Les nouveaux doublons sont déjà',
    'empêchés par la file du serveur ; ceux-ci sont à trancher à la main.',
    apercu ? `Tickets concernés : ${apercu}.` : '',
  );
  try { await creer(false); } catch (_) { /* même l'index simple : sans conséquence */ }
}

// Import initial de la base clients professionnelle (clients-seed.json). Joué
// UNE seule fois (garde app_meta), et seulement si la table est vide : on ne
// réinjecte jamais un client que le patron aurait volontairement supprimé.
// Réversible : DELETE FROM app_meta WHERE key = 'clients_seeded' rejoue l'import.
async function seedClients() {
  const { rows: meta } = await pool.query("SELECT value FROM app_meta WHERE key = 'clients_seeded'");
  if (meta[0] && meta[0].value === '1') return;

  const { rows: cnt } = await pool.query('SELECT COUNT(*)::int AS n FROM clients');
  if (cnt[0].n === 0) {
    let list = [];
    try {
      list = JSON.parse(fs.readFileSync(path.join(__dirname, 'clients-seed.json'), 'utf8'));
    } catch (_) { list = []; }
    // Le fichier d'import contient neuf sociétés EN DOUBLE (« Sima », « Blue
    // Martini », « Le Martin »…) : elles sont entrées deux fois dans la base du
    // patron, et s'y affichaient depuis, l'une sous l'autre. On importe donc par
    // clé de rapprochement — la première fiche gagne, la seconde est ignorée.
    const vues = new Set();
    let ignores = 0;
    let importes = 0;
    for (const c of list) {
      const entreprise = String(c.entreprise || '').trim();
      if (!entreprise) continue;
      const cle = clientKey(entreprise);
      if (vues.has(cle)) { ignores += 1; continue; }
      vues.add(cle);
      const g = (v) => { const s = String(v == null ? '' : v).trim(); return s === '' ? null : s; };
      await pool.query(
        `INSERT INTO clients (entreprise, nom, fonction, type, zone, email, telephone, adresse, cle)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [entreprise, g(c.nom), g(c.fonction), g(c.type), g(c.zone), g(c.email), g(c.telephone),
          g(c.adresse), cle],
      );
      importes += 1;
    }
    if (importes) {
      console.log(`ℹ  Base clients : ${importes} clients pros importés`
        + `${ignores ? ` (${ignores} doublon(s) du fichier ignoré(s))` : ''}.`);
    }
  }

  await poserMeta('clients_seeded', '1');
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
  // GARDE D'IDEMPOTENCE. Sans elle, cette bascule rejouait ses renommages à
  // CHAQUE démarrage — et ses anciens slugs finissent par se recouper avec les
  // modèles suivants. C'est exactement ce qui est arrivé au passage aux 5
  // familles : `archive` était encore une clé de STAGE_MIGRATION, donc la seule
  // commande archivée est devenue `termine_archive` juste avant la nouvelle
  // migration, qui ne l'a plus reconnue — elle a fini en « Paiement à
  // contrôler » au lieu d'« Archivé ».
  // Down : DELETE FROM app_meta WHERE key = 'stage_model_linear'.
  try {
    const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'stage_model_linear'");
    if (rows[0] && rows[0].value === '1') return;
  } catch (err) {
    // On ne tolère QUE « la table n'existe pas » (42P01, base très ancienne).
    // Le catch fourre-tout précédent avalait aussi les pannes passagères : une
    // seule erreur de lecture au démarrage et la migration se rejouait sur une
    // base DÉJÀ migrée, écrasant les sous-étapes en place. C'est le mécanisme
    // exact des deux incidents de pipeline.
    if (err.code !== '42P01') throw err;
  }

  // 1) Commandes en phase « production » (modèle multi-machines) : on choisit
  //    l'étape prod correspondant au secteur porté (priorité TROTEC > DTF >
  //    Pressage > UV ; sinon « Préparation production »).
  const { rows: prod } = await pool.query("SELECT id FROM requests WHERE stage = 'production'");
  for (const r of prod) {
    // `production_sectors` est retirée des bases où elle est vide (voir
    // retirerTableProductionSectors). Absente, il n'y a simplement aucun secteur
    // à lire : ce n'est pas une panne, et ça ne doit pas faire échouer un
    // démarrage.
    const secs = await pool.query(
      'SELECT sector FROM production_sectors WHERE request_id = $1', [r.id],
    ).then((x) => x.rows, () => []);
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

  // 3) Pose le flag (upsert manuel, compatible pg-mem). La valeur par défaut de
  //    la colonne n'est plus touchée ici : les deux bascules suivantes la
  //    reposent de toute façon, et l'aligner sur un slug linéaire entre-temps
  //    n'apportait rien.
  await poserMeta('stage_model_linear', '1');
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
  // `termine_archive` veut dire « terminé ET archivé » : il vise la famille
  // Archivé, pas Terminé. Le faire atterrir sur `termine` renvoyait ensuite,
  // dans le modèle à 5 familles, un dossier archivé vers « Paiement à
  // contrôler » — donc de retour dans les listes actives du patron.
  termine_archive:          ['archive', null],
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
  } catch (err) {
    // On ne tolère QUE « la table n'existe pas » (42P01, base très ancienne).
    // Le catch fourre-tout précédent avalait aussi les pannes passagères : une
    // seule erreur de lecture au démarrage et la migration se rejouait sur une
    // base DÉJÀ migrée, écrasant les sous-étapes en place. C'est le mécanisme
    // exact des deux incidents de pipeline.
    if (err.code !== '42P01') throw err;
  }

  for (const [from, [family, sub]] of Object.entries(STAGE_TO_FAMILY)) {
    // On ne fixe sub_stage QUE lors de cette bascule initiale ; la garde app_meta
    // empêche tout second passage, donc aucune valeur choisie ensuite n'est écrasée.
    await pool.query(
      'UPDATE requests SET stage = $1, sub_stage = $2 WHERE stage = $3',
      [family, sub, from],
    );
  }

  // Pose le flag (upsert manuel, compatible pg-mem).
  await poserMeta('stage_model', 'families');
}

// Bascule du modèle « 8 familles » (v2) vers le modèle « 5 FAMILLES » (v3), la
// liste d'étapes écrite par le patron le 28/07/2026.
//
// Clé de correspondance : `famille/sous-étape` (sous-étape vide = la famille
// sans puce). `famille/*` sert de repli pour toute sous-étape non listée.
// Une position ABSENTE de cette table ne bouge pas : Préparation (sauf
// prepa_fichiers), Production, Facturation à faire et Fiverr gardent leurs
// slugs, donc la grande majorité des lignes n'est même pas réécrite.
const V2_TO_V3 = {
  'demande/*': ['demande_chiffrage', 'demande_recue'],
  'chiffrage/': ['demande_chiffrage', 'a_chiffrer'],
  'chiffrage/a_chiffrer': ['demande_chiffrage', 'a_chiffrer'],
  'chiffrage/chiffrage_en_cours': ['demande_chiffrage', 'chiffrage_en_cours'],
  'chiffrage/devis_a_envoyer': ['demande_chiffrage', 'devis_envoye'],
  'chiffrage/*': ['demande_chiffrage', 'a_chiffrer'],
  'attente_client/*': ['demande_chiffrage', 'devis_envoye'],
  'preparation/prepa_fichiers': ['preparation', 'prepa_produits'],
  'facturation/pret_retrait': ['facturation', 'client_prevenu'],
  'termine/attente_paiement': ['paiement', 'paiement_a_controler'],
  'termine/solde': ['paiement', 'paiement_valide'],
  'termine/*': ['paiement', 'paiement_a_controler'],
  'archive/*': ['paiement', 'archive'],
};

// Position v2 → position v3, ou null si rien ne change. Exportée : le test de
// migration l'exerce directement, sans passer par une base.
function toFiveFamilies(stage, sub) {
  const key = `${stage}/${sub ?? ''}`;
  return V2_TO_V3[key] || V2_TO_V3[`${stage}/*`] || null;
}

// Garde d'idempotence SÉPARÉE de `stage_model` : cette clé-là doit garder la
// valeur 'families', sinon migrateStagesToFamilies se rejouerait à chaque
// démarrage et son UPDATE « WHERE stage = 'facturation' » écraserait la
// sous-étape de toutes les lignes en facturation.
//
// Down : appliquer V2_TO_V3 à l'envers (demande_recue/demande_a_qualifier →
// demande, devis_envoye → attente_client, prepa_produits → prepa_fichiers,
// client_prevenu → facturation/pret_retrait, paiement/* → termine et archive),
// puis DELETE FROM app_meta WHERE key = 'stage_model_v3'.
async function migrateFamiliesToFive() {
  try {
    await pool.query("ALTER TABLE requests ALTER COLUMN stage SET DEFAULT 'demande_chiffrage'");
  } catch (_) { /* pg-mem local : défaut déjà posé par le schéma */ }

  try {
    const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'stage_model_v3'");
    if (rows[0] && rows[0].value === '1') return;
  } catch (err) {
    // On ne tolère QUE « la table n'existe pas » (42P01, base très ancienne).
    // Le catch fourre-tout précédent avalait aussi les pannes passagères : une
    // seule erreur de lecture au démarrage et la migration se rejouait sur une
    // base DÉJÀ migrée, écrasant les sous-étapes en place. C'est le mécanisme
    // exact des deux incidents de pipeline.
    if (err.code !== '42P01') throw err;
  }

  const { rows: all } = await pool.query('SELECT id, stage, sub_stage FROM requests');
  let moved = 0;
  for (const r of all) {
    const next = toFiveFamilies(r.stage, r.sub_stage ?? null);
    if (!next) continue;
    await pool.query('UPDATE requests SET stage = $1, sub_stage = $2 WHERE id = $3', [next[0], next[1], r.id]);
    moved += 1;
  }
  if (moved) console.log(`ℹ  Pipeline : ${moved} commande(s) reclassée(s) dans les 5 familles.`);

  await renameCategorySettingKeys();

  await poserMeta('stage_model_v3', '1');
}

// Les pilotes et référents PAR DÉFAUT sont réglés par étape (app_meta
// category_owners / category_referents, clé = slug). Cinq sous-étapes changent
// simplement de nom : sans ce report, le patron verrait ses réglages disparaître
// sans comprendre pourquoi.
//
// Seules les correspondances 1 pour 1 sont reportées. Les anciennes FAMILLES
// (demande, chiffrage, attente_client → une seule famille aujourd'hui) sont
// laissées telles quelles : trois réglages différents ne peuvent pas fusionner
// sans en écraser deux, autant que le patron retranche lui-même.
const SETTING_KEY_RENAMES = {
  prepa_fichiers: 'prepa_produits',
  devis_a_envoyer: 'devis_envoye',
  pret_retrait: 'client_prevenu',
  attente_paiement: 'paiement_a_controler',
  solde: 'paiement_valide',
};

async function renameCategorySettingKeys() {
  for (const key of ['category_owners', 'category_referents']) {
    const { rows } = await pool.query('SELECT value FROM app_meta WHERE key = $1', [key]);
    if (!rows[0]) continue;
    let map;
    try {
      map = JSON.parse(rows[0].value);
    } catch (_) { continue; }
    if (!map || typeof map !== 'object') continue;

    let changed = false;
    for (const [from, to] of Object.entries(SETTING_KEY_RENAMES)) {
      // Un réglage déjà posé sur le nouveau slug fait foi : on ne l'écrase pas.
      if (map[from] === undefined || map[to] !== undefined) continue;
      map[to] = map[from];
      delete map[from];
      changed = true;
    }
    if (!changed) continue;
    await poserMeta(key, JSON.stringify(map));
  }
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
    } else {
      // Deux modèles peuvent précéder celui-ci : le linéaire (20 étapes à plat)
      // et les 8 familles. On les traverse dans l'ordre — linéaire → v2 → v3 —
      // pour qu'un slug très ancien retombe quand même sur sa place actuelle.
      const [v2Stage, v2Sub] = STAGE_TO_FAMILY[r.stage] || [r.stage, sub];
      const v3 = toFiveFamilies(v2Stage, v2Sub);
      if (v3) {
        [family, sub] = v3;
      } else if (STAGE_SLUGS.includes(v2Stage)) {
        family = v2Stage;
        sub = v2Sub;
      } else {
        // Slug totalement inconnu : on la renvoie en tête de pipeline plutôt que
        // de la laisser invisible dans la sidebar.
        family = 'demande_chiffrage';
        sub = 'demande_recue';
      }
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
      stage: 'demande_chiffrage', sub_stage: 'demande_recue', responsable: 'Mélina', referent: 'Loïc', priority: 3, client_type: 'pro',
      billing_company: 'Hôtel Esmeralda', contact_referent: 'Julie M.', quantity: 50,
      product: '50 t-shirts staff', color: 'Noir', project_value: 850,
      description: 'Tee-shirts équipe — gros devis', deadline: inDays(3), position: 1000,
    },
    {
      stage: 'demande_chiffrage', sub_stage: 'demande_a_qualifier', responsable: 'À attribuer', priority: 1, client_type: 'perso',
      billing_company: 'Alessandro', contact_referent: 'Alessandro', quantity: 1,
      product: 'Impression plexi A3', project_value: 30, description: 'Photo à vérifier',
      deadline: inDays(1), position: 2000,
    },
    {
      stage: 'demande_chiffrage', sub_stage: 'a_chiffrer', responsable: 'Mélina', priority: 2, client_type: 'revendeur',
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
      stage: 'preparation', sub_stage: 'prepa_produits', priority: 1, client_type: 'perso',
      billing_company: 'Atelier Broderie Sud', contact_referent: 'Mme Costa', quantity: 6,
      product: 'Casquettes brodées', project_value: 120, description: 'Client pas pressé — à planifier',
      deadline: null, position: 3000, created_days_ago: 9,
    },
    // --- CINQ DOSSIERS POUR VOIR LE FEU (27/08/2026) -----------------------
    //
    // Le feu ne s'allume que sur ce qui MANQUE, et il ne dit rien tant qu'on
    // n'a pas de dossier qui coince. Les huit exemples ci-dessus sont tous en
    // règle : la base locale était donc muette sur la seule chose qu'on ait
    // besoin de regarder pour juger la rangée « Manque ».
    //
    // Ces cinq-là couvrent les quatre mots que le feu sait écrire — Devis, BAT,
    // Paiement, Acompte — plus le cas où deux manquent en même temps. Ils
    // portent un `updated_at` RECULÉ : sans lui, « depuis 0 j » ne s'écrit pas,
    // et c'est précisément le nombre qui dit s'il faut relancer.
    //
    // Ils ne partent jamais en production : `seed()` n'est appelé QUE sur une
    // table vide, et la base de l'atelier en porte 187.
    {
      stage: 'demande_chiffrage', sub_stage: 'devis_envoye', responsable: 'Mélina', priority: 2, client_type: 'pro',
      billing_company: 'Beach Bar Orient', contact_referent: 'Nathalie R.', quantity: 60,
      product: 'Polos service', color: 'Bleu marine', project_value: 1180,
      description: 'Devis parti le 15, aucun retour', deadline: inDays(6), position: 3000,
      devis_requis: true, updated_days_ago: 12,
    },
    {
      stage: 'preparation', sub_stage: 'prepa_bat', responsable: 'Charlie', priority: 3, client_type: 'pro',
      billing_company: 'Garage Marigot', contact_referent: 'Pascal D.', quantity: 25,
      product: 'Sweats atelier', color: 'Gris', project_value: 900,
      description: 'BAT envoyé, en attente de validation', deadline: inDays(2), position: 4000,
      bat_requis: true, updated_days_ago: 4,
    },
    {
      stage: 'production', sub_stage: 'prod_pressage', responsable: 'Julien', priority: 3, client_type: 'pro',
      billing_company: 'Villa Rousseau', contact_referent: 'Mme Rousseau', quantity: 30,
      product: 'Serviettes brodées', color: 'Blanc', project_value: 660,
      description: 'Parti en production sans encaissement', deadline: inDays(1), position: 2000,
      paye: false, updated_days_ago: 6,
    },
    {
      stage: 'production', sub_stage: 'prod_trotec', responsable: 'Charlie', priority: 2, client_type: 'asso',
      billing_company: 'Club Nautique', contact_referent: 'Yann L.', quantity: 80,
      product: 'Plaques gravées', project_value: 1600,
      description: 'Acompte demandé, pas encore versé', deadline: inDays(4), position: 3000,
      paye: false, acompte_demande: true, acompte_verse: false, updated_days_ago: 2,
    },
    {
      stage: 'demande_chiffrage', sub_stage: 'devis_envoye', responsable: 'À attribuer', priority: 1, client_type: 'perso',
      billing_company: 'Sophie Delcourt', contact_referent: 'Sophie Delcourt', quantity: 4,
      product: 'Tableaux photo', project_value: 260,
      description: 'Maquette commencée avant le retour du devis', deadline: inDays(10), position: 4000,
      devis_requis: true, bat_requis: true, updated_days_ago: 21,
    },
  ];

  for (const s of samples) {
    const recule = (j) => new Date(today.getTime() - (j ?? 0) * 86400000).toISOString();
    const createdAt = recule(s.created_days_ago);
    // `updated_at` PORTE L'HORLOGE DU FEU : « Devis 12 j » se lit dessus. Sans
    // le reculer, tout dossier d'exemple est frais du jour et la rangée
    // « Manque » sort sans son nombre — c'est-à-dire sans ce qui dit s'il faut
    // relancer. Il ne peut pas être plus ancien que la création.
    const updatedAt = recule(Math.max(s.updated_days_ago ?? 0, 0) || s.created_days_ago || 0);
    await pool.query(
      `INSERT INTO requests
        (stage, sub_stage, responsable, referent, priority, client_type, billing_company, contact_referent,
         quantity, product, color, project_value, description, deadline, position, created_at, updated_at,
         flag, flag_reason, devis_requis, bat_requis, paye, acompte_demande, acompte_verse)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [s.stage, s.sub_stage ?? null, s.responsable ?? null, s.referent ?? null, s.priority, s.client_type,
       s.billing_company, s.contact_referent, s.quantity, s.product, s.color ?? null,
       s.project_value, s.description, s.deadline, s.position, createdAt, updatedAt,
       s.flag ?? null, s.flag_reason ?? null,
       // `bat_requis` et `devis_requis` sont NOT NULL DEFAULT false : leur
       // passer `null` explicitement viole la contrainte au lieu de prendre le
       // défaut. Les trois autres acceptent le nul, mais un booléen d'exemple
       // qui vaut « on ne sait pas » ne dit rien de plus que « non ».
       s.devis_requis ?? false, s.bat_requis ?? false,
       s.paye ?? false, s.acompte_demande ?? false, s.acompte_verse ?? false],
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
  await poserMeta('category_owners', value);
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
  await poserMeta('category_referents', value);
  return clean;
}

// --- Registre des MACHINES (réglages du patron) ------------------------------
// Chaque poste de production porte deux leviers, réglés dans le dashboard :
//   - `importance` (1..5) : poids de priorité. Une machine « goulot » (importance
//     haute) fait remonter les commandes qui passent par elle dans la file
//     « À faire maintenant ». 3 = neutre.
//   - `minutesPerUnit` : durée de fabrication indicative (min/pièce), FACULTATIVE
//     (null tant qu'elle n'est pas renseignée) — réservée à l'estimation de charge.
// Le `slug` fait le lien avec la sous-étape de production (prod_dtf → dtf, etc.)
// et la technique de la fiche ; il est stable, le libellé peut changer.
// Stocké en clé/valeur applicative (app_meta.machines, tableau JSON), comme les
// autres réglages. Absent → on sert la liste par défaut (les 4 postes du flux).
const DEFAULT_MACHINES = [
  { slug: 'dtf', name: 'DTF', importance: 3, minutesPerUnit: null, coutHoraire: null, consommables: null },
  { slug: 'presse', name: 'Presse', importance: 3, minutesPerUnit: null, coutHoraire: null, consommables: null },
  { slug: 'trotec', name: 'Trotec', importance: 3, minutesPerUnit: null, coutHoraire: null, consommables: null },
  { slug: 'uv', name: 'UV', importance: 3, minutesPerUnit: null, coutHoraire: null, consommables: null },
];

// Clé stable à partir d'un libellé : minuscules, sans accents, alphanumérique.
function slugify(s) {
  return String(s)
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Normalise une entrée machine reçue du client (défensif : le patron édite à la
// main). Renvoie null si inexploitable (nom vide).
function cleanMachine(m, index) {
  if (!m || typeof m !== 'object') return null;
  const name = String(m.name == null ? '' : m.name).trim().slice(0, 40);
  if (!name) return null;
  const slug = (typeof m.slug === 'string' && slugify(m.slug)) || slugify(name) || `machine-${index + 1}`;
  let importance = Number.parseInt(m.importance, 10);
  if (!Number.isInteger(importance)) importance = 3;
  importance = Math.min(5, Math.max(1, importance));
  let minutesPerUnit = null;
  if (m.minutesPerUnit != null && m.minutesPerUnit !== '') {
    const n = Number(m.minutesPerUnit);
    if (Number.isFinite(n) && n > 0) minutesPerUnit = Math.round(n * 10) / 10;
  }
  // COÛT HORAIRE ET CONSOMMABLES (§12). « Chaque machine peut avoir un coût
  // horaire… Les coûts doivent être paramétrables. » `null` = non renseigné, et
  // c'est différent de zéro : une machine dont on n'a pas encore chiffré
  // l'heure ne coûte pas « rien », on ne sait simplement pas. Le calcul
  // retombe alors sur le taux machine global des paramètres.
  const positifOuNull = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  };
  return {
    slug, name, importance, minutesPerUnit,
    coutHoraire: positifOuNull(m.coutHoraire),
    consommables: positifOuNull(m.consommables),
  };
}

async function getMachines() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'machines'");
  if (!rows[0]) return DEFAULT_MACHINES.map((m) => ({ ...m }));
  try {
    const parsed = JSON.parse(rows[0].value);
    if (!Array.isArray(parsed)) return DEFAULT_MACHINES.map((m) => ({ ...m }));
    const clean = parsed.map(cleanMachine).filter(Boolean);
    return clean.length ? clean : DEFAULT_MACHINES.map((m) => ({ ...m }));
  } catch (_) {
    return DEFAULT_MACHINES.map((m) => ({ ...m }));
  }
}

async function setMachines(list) {
  const seen = new Set();
  const clean = [];
  const raw = Array.isArray(list) ? list : [];
  for (let i = 0; i < raw.length; i += 1) {
    const m = cleanMachine(raw[i], i);
    if (!m || seen.has(m.slug)) continue;   // slug unique : premier gagne
    seen.add(m.slug);
    clean.push(m);
  }
  const value = JSON.stringify(clean);
  await poserMeta('machines', value);
  return clean;
}

// --- Catalogue TARIFS TASSE (réglages du patron) -----------------------------
// Reprend l'onglet « Tarifs & coûts » du classeur CRM TASSES OLDA : une ligne
// par tasse / option face / option dessous / BAT, avec prix d'achat, prix de
// vente TTC, temps main-d'œuvre et temps machine. Stocké en app_meta (2 clés),
// même principe que les machines — pas de table dédiée, le patron l'édite
// depuis Réglages.
const TARIFS_TASSE_CATEGORIES = new Set(['produit', 'face', 'dessous', 'bat']);

// Valeurs du classeur patron au 2026-07-25 (onglet « Tarifs & coûts »).
const DEFAULT_TARIFS_TASSE_ARTICLES = [
  { categorie: 'produit', designation: 'Tasse Céramique 350 ml', prixAchat: 1.78, prixVenteTtc: 10, tempsMoMin: 0.5, tempsMachineMin: 0 },
  { categorie: 'produit', designation: 'Tasse Expresso 180 ml', prixAchat: 0, prixVenteTtc: 7, tempsMoMin: 0.5, tempsMachineMin: 0 },
  { categorie: 'produit', designation: 'Tasse en Bois', prixAchat: 0, prixVenteTtc: 10, tempsMoMin: 0.5, tempsMachineMin: 0 },
  { categorie: 'face', designation: 'Aucune', prixAchat: 0, prixVenteTtc: 0, tempsMoMin: 0, tempsMachineMin: 0 },
  { categorie: 'face', designation: 'Logo OLDA existant', prixAchat: 0, prixVenteTtc: 6, tempsMoMin: 0, tempsMachineMin: 0 },
  { categorie: 'face', designation: 'Logo OLDA à ajouter', prixAchat: 0, prixVenteTtc: 8, tempsMoMin: 3, tempsMachineMin: 3 },
  { categorie: 'face', designation: 'Texte personnalisé simple', prixAchat: 0, prixVenteTtc: 6, tempsMoMin: 3, tempsMachineMin: 3 },
  { categorie: 'face', designation: 'Logo client vectorisé', prixAchat: 0, prixVenteTtc: 6, tempsMoMin: 3, tempsMachineMin: 3 },
  { categorie: 'face', designation: 'Logo client non vectorisé', prixAchat: 0, prixVenteTtc: 10, tempsMoMin: 5, tempsMachineMin: 3 },
  { categorie: 'face', designation: 'Création graphique OLDA', prixAchat: 0, prixVenteTtc: 10, tempsMoMin: 6, tempsMachineMin: 3 },
  { categorie: 'dessous', designation: 'Aucune', prixAchat: 0, prixVenteTtc: 0, tempsMoMin: 0, tempsMachineMin: 0 },
  { categorie: 'dessous', designation: 'Logo Client Vectorisé', prixAchat: 0, prixVenteTtc: 4, tempsMoMin: 3, tempsMachineMin: 3 },
  { categorie: 'dessous', designation: 'Logo Client Non Vectorisé', prixAchat: 0, prixVenteTtc: 5, tempsMoMin: 5, tempsMachineMin: 3 },
  { categorie: 'dessous', designation: 'Logo OLDA dessous', prixAchat: 0, prixVenteTtc: 3, tempsMoMin: 1, tempsMachineMin: 3 },
  { categorie: 'dessous', designation: 'Texte personnalisé dessous', prixAchat: 0, prixVenteTtc: 6, tempsMoMin: 3, tempsMachineMin: 3 },
  { categorie: 'dessous', designation: 'QR Code dessous', prixAchat: 0, prixVenteTtc: 5, tempsMoMin: 5, tempsMachineMin: 3 },
  { categorie: 'bat', designation: 'Oui', prixAchat: 0, prixVenteTtc: 2, tempsMoMin: 5, tempsMachineMin: 0 },
  { categorie: 'bat', designation: 'Non', prixAchat: 0, prixVenteTtc: 0, tempsMoMin: 0, tempsMachineMin: 0 },
].map((a, i) => ({ ...a, id: `seed-${i + 1}`, actif: true, position: (i + 1) * 1000 }));

const DEFAULT_TARIFS_TASSE_PARAMETRES = { tauxHoraireMo: 25, tauxHoraireMachine: 25, tgca: 0.04 };

let tarifsTasseUid = 0;

// Normalise une entrée reçue du client (défensif : édition à la main dans
// Réglages). Renvoie null si inexploitable (désignation vide ou catégorie
// inconnue).
function cleanTarifTasseArticle(a, index) {
  if (!a || typeof a !== 'object') return null;
  const designation = String(a.designation == null ? '' : a.designation).trim().slice(0, 80);
  if (!designation) return null;
  if (!TARIFS_TASSE_CATEGORIES.has(a.categorie)) return null;
  const num = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : def; };
  tarifsTasseUid += 1;
  return {
    id: typeof a.id === 'string' && a.id ? a.id : `tt-${Date.now()}-${tarifsTasseUid}`,
    categorie: a.categorie,
    designation,
    prixAchat: Math.round(num(a.prixAchat) * 100) / 100,
    prixVenteTtc: Math.round(num(a.prixVenteTtc) * 100) / 100,
    tempsMoMin: Math.round(num(a.tempsMoMin) * 10) / 10,
    tempsMachineMin: Math.round(num(a.tempsMachineMin) * 10) / 10,
    actif: a.actif !== false,
    position: Number.isFinite(Number(a.position)) ? Number(a.position) : (index + 1) * 1000,
  };
}

async function getTarifsTasseArticles() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'tarifs_tasse_articles'");
  if (!rows[0]) return DEFAULT_TARIFS_TASSE_ARTICLES.map((a) => ({ ...a }));
  try {
    const parsed = JSON.parse(rows[0].value);
    return Array.isArray(parsed) ? parsed : DEFAULT_TARIFS_TASSE_ARTICLES.map((a) => ({ ...a }));
  } catch (_) {
    return DEFAULT_TARIFS_TASSE_ARTICLES.map((a) => ({ ...a }));
  }
}

async function setTarifsTasseArticles(list) {
  const raw = Array.isArray(list) ? list : [];
  const clean = raw.map(cleanTarifTasseArticle).filter(Boolean);
  const value = JSON.stringify(clean);
  await poserMeta('tarifs_tasse_articles', value);
  return clean;
}

async function getTarifsTasseParametres() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'tarifs_tasse_parametres'");
  if (!rows[0]) return { ...DEFAULT_TARIFS_TASSE_PARAMETRES };
  try {
    const parsed = JSON.parse(rows[0].value);
    return parsed && typeof parsed === 'object' ? { ...DEFAULT_TARIFS_TASSE_PARAMETRES, ...parsed } : { ...DEFAULT_TARIFS_TASSE_PARAMETRES };
  } catch (_) {
    return { ...DEFAULT_TARIFS_TASSE_PARAMETRES };
  }
}

async function setTarifsTasseParametres(p) {
  const src = p && typeof p === 'object' ? p : {};
  const num = (v, def) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : def; };
  const clean = {
    tauxHoraireMo: num(src.tauxHoraireMo, DEFAULT_TARIFS_TASSE_PARAMETRES.tauxHoraireMo),
    tauxHoraireMachine: num(src.tauxHoraireMachine, DEFAULT_TARIFS_TASSE_PARAMETRES.tauxHoraireMachine),
    tgca: num(src.tgca, DEFAULT_TARIFS_TASSE_PARAMETRES.tgca),
  };
  const value = JSON.stringify(clean);
  await poserMeta('tarifs_tasse_parametres', value);
  return clean;
}

// --- Suppléments express (vente directe) -------------------------------------
// Le supplément d'urgence facturé au comptoir, par palier de délai. Ce n'est pas
// une constante de code : c'est une décision commerciale, elle change au gré de
// la charge de l'atelier et de la saison. Elle vit donc en base, modifiable
// depuis l'écran, sans redéploiement.
//
// Les trois paliers correspondent aux trois choix de l'écran de vente directe.
// Une date choisie au calendrier retombe sur le même barème, en JOURS OUVRÉS :
// ≤ 5 → j5, ≤ 10 → j10, au-delà → j15. Valeurs en POURCENTS (20 = +20 %).
const DEFAULT_SUPPLEMENTS_EXPRESS = { j5: 20, j10: 10, j15: 0 };

async function getSupplementsExpress() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'supplements_express'");
  if (!rows[0]) return { ...DEFAULT_SUPPLEMENTS_EXPRESS };
  try {
    const parsed = JSON.parse(rows[0].value);
    return parsed && typeof parsed === 'object'
      ? { ...DEFAULT_SUPPLEMENTS_EXPRESS, ...parsed }
      : { ...DEFAULT_SUPPLEMENTS_EXPRESS };
  } catch (_) {
    return { ...DEFAULT_SUPPLEMENTS_EXPRESS };
  }
}

async function setSupplementsExpress(p) {
  const src = p && typeof p === 'object' ? p : {};
  // On repart du barème EN PLACE, pas des valeurs d'usine : un palier absent de
  // l'envoi doit rester ce qu'il était. Corriger « 10 jours » ne doit pas
  // remettre « 5 jours » à sa valeur d'origine dans le dos de la vendeuse.
  const actuel = await getSupplementsExpress();
  // Un taux se saisit à la main, sur une tablette, entre deux clients : on borne
  // à 0–100 % et on arrondit au dixième plutôt que d'accepter une faute de frappe
  // qui facturerait « +2000 % » au client suivant.
  // `null` / '' ne valent PAS 0 ici (Number les y ramènerait) : ils veulent dire
  // « rien envoyé », donc on garde la valeur en place.
  const taux = (v, def) => {
    const n = v === null || v === '' ? NaN : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) return def;
    return Math.round(n * 10) / 10;
  };
  const clean = {
    j5: taux(src.j5, actuel.j5),
    j10: taux(src.j10, actuel.j10),
    j15: taux(src.j15, actuel.j15),
  };
  const value = JSON.stringify(clean);
  await poserMeta('supplements_express', value);
  return clean;
}

// --- Emplacements d'impression ajoutés au comptoir ---------------------------
// Zones créées à la volée du temps de l'ancienne prise de commande détaillée
// (app_meta.commande_zones) et zones du catalogue qu'un poste avait masquées
// (app_meta.commande_zones_masquees). Plus rien ne les ALIMENTE depuis que
// Nouveau Projet est la seule porte d'entrée, mais on continue de les LIRE : les
// emplacements déjà créés restent proposés, les masqués restent masqués.
async function getCommandeZones() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'commande_zones'");
  if (!rows[0]) return [];
  try {
    const parsed = JSON.parse(rows[0].value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((z) => z && typeof z === 'object' && z.id && z.label)
      .map((z) => ({ id: String(z.id), label: String(z.label) }));
  } catch (_) {
    return [];
  }
}

// Un emplacement du CATALOGUE (figé dans catalog.json) ne se supprime pas —
// mais un poste peut vouloir le masquer (inutile pour son activité). On garde
// la liste des identifiants masqués à part (app_meta.commande_zones_masquees) :
// le catalogue lui-même ne bouge pas, on filtre juste ce qu'on en sert.
async function getHiddenCommandeZones() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'commande_zones_masquees'");
  if (!rows[0]) return [];
  try {
    const parsed = JSON.parse(rows[0].value);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch (_) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Secteurs d'activité de la base clients (app_meta.client_secteurs).
// La liste vient du classeur patron « CRM OLDA CREATION CLIENTS », mais elle
// n'est plus figée dans le code : elle s'ajoute et se retranche depuis Base
// clients. Un secteur retranché ne disparaît PAS des fiches qui le portent —
// `clients.secteur` en garde une copie, jamais relue dans cette liste.
// Down : DELETE FROM app_meta WHERE key = 'client_secteurs' (la liste repart
// des valeurs d'amorçage ci-dessous).
const SECTEURS_AMORCE = [
  'Hôtel / Restaurant', 'Hôtel', 'Restaurant', 'Bar', 'Boutique', 'Agence immobilière',
  'Conciergerie', 'Villa de location', 'Nautisme', 'BTP', 'Artisan', 'Événementiel',
  'Association', 'École', 'Salle de sport', 'Santé', 'Tourisme', 'Transport',
  'Administration', 'Autre',
];
const SECTEUR_LABEL_MAX = 60;
// Rapprochement insensible à la casse et aux accents : « hotel » et « Hôtel »
// sont le même secteur, on n'en crée pas deux.
const secteurKey = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function writeSecteurs(list) {
  await poserMeta('client_secteurs', JSON.stringify(list));
  return list;
}

// Première lecture : la clé est écrite avec la liste connue, pour que le patron
// parte de ses 20 secteurs et non d'une page blanche.
async function getClientSecteurs() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'client_secteurs'");
  if (!rows[0]) return writeSecteurs(SECTEURS_AMORCE);
  try {
    const parsed = JSON.parse(rows[0].value);
    if (!Array.isArray(parsed)) return writeSecteurs(SECTEURS_AMORCE);
    return parsed.filter((s) => typeof s === 'string' && s.trim() !== '');
  } catch (_) {
    return writeSecteurs(SECTEURS_AMORCE);
  }
}

// Idempotent : rajouter « hotel » quand « Hôtel » existe ne crée rien.
// Renvoie null si le libellé est vide (rien à créer, l'appelant le signale).
async function addClientSecteur(label) {
  const clean = String(label == null ? '' : label).trim().slice(0, SECTEUR_LABEL_MAX);
  if (!clean) return null;
  const list = await getClientSecteurs();
  if (list.some((s) => secteurKey(s) === secteurKey(clean))) return list;
  return writeSecteurs([...list, clean]);
}

async function removeClientSecteur(label) {
  const list = await getClientSecteurs();
  const next = list.filter((s) => secteurKey(s) !== secteurKey(label));
  return next.length === list.length ? list : writeSecteurs(next);
}

// --- Message WhatsApp « commande prête » -------------------------------------
// Le planning affiche une pastille WhatsApp sur chaque commande dont le client a
// laissé un numéro : un clic ouvre WhatsApp avec le message DÉJÀ ÉCRIT (rien ne
// part tout seul, c'est l'employé qui appuie sur Envoyer). Le texte n'est pas
// figé dans le code : le patron l'écrit dans l'onglet Réglages, et il vaut pour
// tous les postes. Stocké en clé/valeur applicative (app_meta.whatsapp_message).
// Trois jetons sont remplacés à l'ouverture, tous facultatifs :
//   {client} → nom du dossier · {commande} → description · {date} → date souhaitée
const WHATSAPP_MESSAGE_MAX = 1000;
const DEFAULT_WHATSAPP_MESSAGE =
  'Bonjour {client}, votre commande « {commande} » est prête, '
  + 'vous pouvez venir la récupérer à l\'atelier. À bientôt — OLDA';

async function getWhatsappMessage() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'whatsapp_message'");
  if (!rows[0] || typeof rows[0].value !== 'string') return DEFAULT_WHATSAPP_MESSAGE;
  // Un message VIDÉ est un choix (le patron préfère écrire à la main) : on le
  // respecte au lieu de lui remettre le texte par défaut à chaque chargement.
  return rows[0].value.slice(0, WHATSAPP_MESSAGE_MAX);
}

async function setWhatsappMessage(text) {
  const clean = String(text == null ? '' : text).slice(0, WHATSAPP_MESSAGE_MAX);
  await poserMeta('whatsapp_message', clean);
  return clean;
}

// --- Réglages de chiffrage textile -------------------------------------------
// Coûts et cadences de l'ATELIER (DTF, pressage, coût horaire, arrondi) : ils
// pilotent le prix calculé au comptoir. Ils appartiennent donc à l'atelier, pas
// au navigateur d'un poste — un coût horaire corrigé sur un PC doit valoir pour
// les autres, sinon deux postes annoncent deux prix pour le même article.
// Stockés en clé/valeur applicative (app_meta.textile_settings, JSON).
const TEXTILE_DEFAULTS = Object.freeze({
  dtfCost: 7.56, dtfSpeed: 12, pressMin: 1.2, hourlyCost: 25, roundStep: 0.1, maxCoefQty: 150,
});
// Bornes hautes larges : elles n'existent que pour écarter une saisie absurde
// (ou un corps de requête forgé), pas pour arbitrer un tarif.
const TEXTILE_BORNES = Object.freeze({
  dtfCost: [0, 1000], dtfSpeed: [0.1, 1000], pressMin: [0, 600],
  hourlyCost: [0, 10000], roundStep: [0.01, 100], maxCoefQty: [1, 150],
});

function nettoyerReglagesTextile(brut) {
  const out = { ...TEXTILE_DEFAULTS };
  if (!brut || typeof brut !== 'object') return out;
  for (const [cle, [min, max]] of Object.entries(TEXTILE_BORNES)) {
    const v = Number(brut[cle]);
    if (Number.isFinite(v) && v >= min && v <= max) out[cle] = v;
  }
  return out;
}

async function getReglagesTextile() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'textile_settings'");
  if (!rows[0] || typeof rows[0].value !== 'string') return { ...TEXTILE_DEFAULTS };
  try {
    return nettoyerReglagesTextile(JSON.parse(rows[0].value));
  } catch {
    return { ...TEXTILE_DEFAULTS };
  }
}

async function setReglagesTextile(patch) {
  const propre = nettoyerReglagesTextile({ ...(await getReglagesTextile()), ...(patch || {}) });
  await poserMeta('textile_settings', JSON.stringify(propre));
  return propre;
}

// --- Tailles de logo ----------------------------------------------------------
// LA LARGEUR DU LOGO À IMPRIMER, en millimètres : par famille, par référence,
// par FACE et par taille. Ce n'est pas une constante par référence — sur NS300
// le dos va de 240 mm en XS à 320 mm en XL, et c'est ce qu'on ne retient pas de
// tête.
//
// UNE FAMILLE PORTE SES PROPRES FACES ET SES PROPRES TAILLES, parce qu'un objet
// n'a pas les faces d'un vêtement : un tote bag en a deux, une casquette une
// seule (l'avant), un t-shirt six. Une liste unique valable pour tout le monde
// donnait à la casquette une colonne « Manche GA » — et une colonne qui n'a
// aucun sens finit par être remplie.
//
// LES FACES SONT DES NOMS LIBRES, et c'est le nom qui fait le lien avec le
// comptoir : la vendeuse choisit un emplacement de marquage (« Coeur + Dos »),
// et la largeur se prend sur la face qui porte ce nom. Les familles connues du
// chiffrage arrivent donc avec les noms du chiffrage. Une face nommée autrement
// vit très bien — elle ne se remplira simplement pas toute seule au comptoir.
//
// Stocké en clé/valeur applicative (app_meta.tailles_logo, JSON), comme les
// machines et les tarifs tasse : quelques centaines de nombres, lus en entier,
// écrits une case à la fois.
// Down : DELETE FROM app_meta WHERE key = 'tailles_logo'.
//   { familles: [ { nom, tailles: [], faces: [], refs: { REF: { face: { taille: mm } } } } ] }

const TAILLES_LOGO_MAX_NOM = 60;

// Une largeur n'est retenue que si c'est un nombre tenable. Une case vide reste
// VIDE : un logo de 0 mm partirait en production sans que rien ne proteste.
function largeurLogo(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 5000 ? Math.round(n) : null;
}

function nomPropre(v) {
  return String(v == null ? '' : v).trim().slice(0, TAILLES_LOGO_MAX_NOM);
}

// Une liste de noms : rangée, sans doublon, sans vide. Elle sert de colonnes et
// d'onglets — deux entrées du même nom donneraient deux colonnes qui écrivent
// dans la même case.
function listeDeNoms(brut) {
  const out = [];
  for (const v of Array.isArray(brut) ? brut : []) {
    const nom = nomPropre(v);
    if (nom && !out.includes(nom)) out.push(nom);
  }
  return out;
}

function nettoyerTaillesLogo(brut) {
  const out = { familles: [] };
  const familles = brut && typeof brut === 'object' ? brut.familles : null;
  if (!Array.isArray(familles)) return out;
  for (const f of familles) {
    if (!f || typeof f !== 'object') continue;
    const nom = nomPropre(f.nom);
    if (!nom || out.familles.some((x) => x.nom === nom)) continue;
    const tailles = listeDeNoms(f.tailles);
    const faces = listeDeNoms(f.faces);
    // LES RÉFÉRENCES DÉCLARÉES À LA MAIN. Les lignes d'une famille viennent
    // normalement du catalogue textile, par le genre. Une famille créée ici
    // (« Sac à dos », « Mug ») n'y a aucun genre : sans cette liste, elle
    // s'ouvrirait vide et il n'y aurait rien à remplir.
    const references = listeDeNoms(f.references);
    const refs = {};
    for (const [ref, parFace] of Object.entries(f.refs && typeof f.refs === 'object' ? f.refs : {})) {
      const cleRef = nomPropre(ref);
      if (!cleRef || !parFace || typeof parFace !== 'object') continue;
      for (const [face, parTaille] of Object.entries(parFace)) {
        const cleFace = nomPropre(face);
        // UNE MESURE SANS COLONNE EST INVISIBLE ET INDÉBOULONNABLE : on ne garde
        // que ce qui a encore une face et une taille dans la famille. Retirer
        // une face retire donc ses mesures, et c'est le sens de l'action.
        if (!cleFace || !faces.includes(cleFace) || !parTaille || typeof parTaille !== 'object') continue;
        for (const [taille, v] of Object.entries(parTaille)) {
          const cleTaille = nomPropre(taille);
          if (!cleTaille || !tailles.includes(cleTaille)) continue;
          const mm = largeurLogo(v);
          if (mm === null) continue;
          if (!refs[cleRef]) refs[cleRef] = {};
          if (!refs[cleRef][cleFace]) refs[cleRef][cleFace] = {};
          refs[cleRef][cleFace][cleTaille] = mm;
        }
      }
    }
    out.familles.push({ nom, tailles, faces, references, refs });
  }
  return out;
}

// Combien de références et combien de cases : c'est ce que l'écran affiche pour
// dire si le tableau sert encore à quelque chose.
function compterTaillesLogo(table) {
  let refs = 0;
  let mesures = 0;
  for (const f of (table && table.familles) || []) {
    for (const parFace of Object.values(f.refs || {})) {
      refs += 1;
      for (const t of Object.values(parFace)) mesures += Object.keys(t).length;
    }
  }
  return { refs, mesures };
}

async function getTaillesLogo() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'tailles_logo'");
  if (!rows[0] || typeof rows[0].value !== 'string') return { familles: [] };
  try {
    return nettoyerTaillesLogo(JSON.parse(rows[0].value));
  } catch {
    return { familles: [] };
  }
}

// TOUTES LES ÉCRITURES PASSENT EN FILE.
//
// Le document est lu, modifié, réécrit : entre la lecture et l'écriture il y a
// un `await`, donc deux requêtes qui se croisent perdraient l'une des deux — et
// pas seulement quand elles visent la même case. Deux postes qui remplissent
// deux colonnes différentes, c'est exactement le genre de perte qu'on ne voit
// qu'en relisant le tableau trois jours plus tard. Les écritures sont rares et
// courtes : la file ne coûte rien.
let fileTaillesLogo = Promise.resolve();

function ecrireTaillesLogo(travail) {
  const suite = fileTaillesLogo.then(async () => {
    const table = await getTaillesLogo();
    const sortie = await travail(table);
    await poserMeta('tailles_logo', JSON.stringify(nettoyerTaillesLogo(table)));
    return sortie === undefined ? getTaillesLogo() : sortie;
  });
  // La file ne doit pas mourir sur un refus : l'écriture suivante repart.
  fileTaillesLogo = suite.catch(() => {});
  return suite;
}

const trouverFamille = (table, nom) => (table.familles || []).find((f) => f.nom === nomPropre(nom));

function majTailleLogo(famille, reference, face, taille, largeur) {
  return ecrireTaillesLogo(async (table) => {
    const f = trouverFamille(table, famille);
    if (!f) throw new Error('Famille inconnue');
    const ref = nomPropre(reference);
    const cleFace = nomPropre(face);
    const cleTaille = nomPropre(taille);
    if (!ref) throw new Error('Référence manquante');
    if (!f.faces.includes(cleFace)) throw new Error('Face inconnue dans cette famille');
    if (!f.tailles.includes(cleTaille)) throw new Error('Taille inconnue dans cette famille');
    const mm = largeurLogo(largeur);
    if (mm === null) {
      // VIDER UNE CASE EST UNE ACTION, pas un oubli : on retire la clé plutôt
      // que d'y ranger un zéro. `nettoyerTaillesLogo` fait le ménage des
      // niveaux devenus vides à l'écriture.
      const parFace = f.refs[ref];
      if (parFace && parFace[cleFace]) delete parFace[cleFace][cleTaille];
    } else {
      if (!f.refs[ref]) f.refs[ref] = {};
      if (!f.refs[ref][cleFace]) f.refs[ref][cleFace] = {};
      f.refs[ref][cleFace][cleTaille] = mm;
    }
  });
}

// CRÉER, RENOMMER, RETIRER UNE FAMILLE — et ses faces, et ses tailles. Le
// tableau doit suivre l'atelier : un objet nouveau arrive, il lui faut sa
// catégorie le jour même, pas au prochain déploiement.
function creerFamilleLogo(nom, modele) {
  return ecrireTaillesLogo(async (table) => {
    const propre = nomPropre(nom);
    if (!propre) throw new Error('Il faut un nom');
    if (trouverFamille(table, propre)) throw new Error('Cette famille existe déjà');
    table.familles.push({
      nom: propre,
      tailles: listeDeNoms((modele && modele.tailles) || ['Taille unique']),
      faces: listeDeNoms((modele && modele.faces) || ['Avant']),
      references: listeDeNoms((modele && modele.references) || []),
      refs: {},
    });
  });
}

function majFamilleLogo(nom, patch) {
  return ecrireTaillesLogo(async (table) => {
    const f = trouverFamille(table, nom);
    if (!f) throw new Error('Famille inconnue');
    if (patch && patch.nom !== undefined) {
      const propre = nomPropre(patch.nom);
      if (!propre) throw new Error('Il faut un nom');
      if (propre !== f.nom && trouverFamille(table, propre)) throw new Error('Cette famille existe déjà');
      f.nom = propre;
    }
    // RETIRER UNE FACE OU UNE TAILLE RETIRE SES MESURES, et c'est le sens de
    // l'action — `nettoyerTaillesLogo` ne garde que ce qui a encore une
    // colonne. On refuse en revanche de tout vider d'un coup par une liste
    // vide : ce serait un effacement déguisé en réglage.
    for (const cle of ['tailles', 'faces']) {
      if (!patch || patch[cle] === undefined) continue;
      const liste = listeDeNoms(patch[cle]);
      if (!liste.length) throw new Error(cle === 'faces' ? 'Il faut au moins une face' : 'Il faut au moins une taille');
      f[cle] = liste;
    }
    // Les références déclarées, elles, peuvent être vides : une famille qui
    // prend ses lignes au catalogue n'en déclare aucune.
    if (patch && patch.references !== undefined) f.references = listeDeNoms(patch.references);
  });
}

function retirerFamilleLogo(nom) {
  return ecrireTaillesLogo(async (table) => {
    const avant = table.familles.length;
    table.familles = table.familles.filter((f) => f.nom !== nomPropre(nom));
    if (table.familles.length === avant) throw new Error('Famille inconnue');
  });
}

// L'INSTANTANÉ LIVRÉ AVEC LE CODE, pour une base NEUVE.
//
// Il porte ce que l'atelier avait relevé sur l'ancien site. Sans lui, une base
// fraîche démarre vide : le comptoir affiche des cases vides et annonce que la
// référence n'est pas au tableau — alors qu'elle y est. Constaté le 26/08 sur
// un essai en local.
//
// LA GARDE, C'EST LA CLÉ ELLE-MÊME : si `tailles_logo` est là, on n'y touche
// pas. Pas de seconde clé à tenir, donc pas de garde partagée.
// Down : DELETE FROM app_meta WHERE key = 'tailles_logo'.
async function semerTaillesLogo() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'tailles_logo'");
  if (rows.length) return;
  let brut;
  try {
    brut = JSON.parse(fs.readFileSync(path.join(__dirname, 'tailles-logo-seed.json'), 'utf8'));
  } catch (_) {
    return;   // pas d'instantané : on démarre sans, l'écran le remplira
  }
  const propre = nettoyerTaillesLogo(brut);
  if (!propre.familles.length) return;
  await poserMeta('tailles_logo', JSON.stringify(propre));
}

// LES FACES DE LA TASSE ENTRENT AU TABLEAU (27/08/2026).
//
// Charlie : « une tasse y'a 2 faces et le cul de la tasse, ce qui fait
// 3 faces ». Le comptoir affiche les faces qu'une famille DÉCLARE — c'est ce
// qui fait qu'un couteau à graver marchera le jour où on lui en déclare. La
// tasse, elle, est déjà vendue tous les jours : elle arrive avec le code.
//
// L'INSTANTANÉ NE SUFFIT PAS. `semerTaillesLogo` ne parle qu'à une base NEUVE
// (sa garde est la présence de la clé) : en production la clé est là depuis le
// 26/08, l'instantané n'y passera donc plus jamais. D'où cette migration, et sa
// PROPRE garde — deux incidents réels sont venus d'une garde partagée.
//
// Elle AJOUTE, elle n'écrase pas : si la famille existe déjà avec ses faces,
// rien ne bouge. Une famille que l'atelier aurait renommée n'est pas retrouvée
// et on en crée une seconde — c'est visible dans l'écran des tailles de logo,
// et réparable d'un clic, là où écraser une déclaration ne se voit pas.
// Down : DELETE FROM app_meta WHERE key = 'faces_tasse';
//        puis retirer la famille depuis Réglages → Tailles de logo.
const TASSE_FAMILLE = 'Tasse céramique 350 ml';
// LE COUTEAU SE GRAVE SUR SON MANCHE, DEUX FACES (Charlie, 27/08). Il vit dans
// « Art de la table », avec treize autres objets qui ne se gravent pas au même
// endroit : ses faces sont donc déclarées sur L'ARTICLE et non sur la famille —
// le comptoir cherche la désignation d'abord, la catégorie ensuite.
// Le nom se change dans Réglages → Tailles de logo, c'est une donnée.
const COUTEAU_FAMILLE = 'Couteau Multi';
const COUTEAU_FACES = ['Manche — face 1', 'Manche — face 2'];
const TASSE_FACES = ['Face avant', 'Face arrière', 'Fond'];
async function semerFacesTasse() {
  const { rows } = await pool.query("SELECT 1 FROM app_meta WHERE key = 'faces_tasse'");
  if (rows.length) return;
  await ecrireTaillesLogo(async (table) => {
    const f = table.familles.find((x) => x.nom === TASSE_FAMILLE);
    if (f) {
      for (const face of TASSE_FACES) if (!f.faces.includes(face)) f.faces.push(face);
    } else {
      // UNE TAILLE, parce que le tableau en exige une pour retenir une mesure —
      // et une tasse n'en a qu'une. Ce sont les FACES qui portent le travail.
      table.familles.push({
        nom: TASSE_FAMILLE, tailles: ['Taille unique'],
        faces: [...TASSE_FACES], references: [], refs: {},
      });
    }
  });
  await poserMeta('faces_tasse', '1');
}

// Down : retirer la famille « Couteau Multi » de app_meta.tailles_logo,
//        DELETE FROM app_meta WHERE key = 'faces_couteau';
async function semerFacesCouteau() {
  const { rows } = await pool.query("SELECT 1 FROM app_meta WHERE key = 'faces_couteau'");
  if (rows.length) return;
  await ecrireTaillesLogo(async (table) => {
    const f = table.familles.find((x) => x.nom === COUTEAU_FAMILLE);
    if (f) {
      for (const face of COUTEAU_FACES) if (!f.faces.includes(face)) f.faces.push(face);
    } else {
      // UNE TAILLE, parce que le tableau en exige une pour retenir une mesure —
      // et un manche n'en a qu'une. Ce sont les FACES qui portent le travail.
      table.familles.push({
        nom: COUTEAU_FAMILLE, tailles: ['Taille unique'],
        faces: [...COUTEAU_FACES], references: [], refs: {},
      });
    }
  });
  await poserMeta('faces_couteau', '1');
}

// --- Rattrapage du feu : ce que les dossiers d'avant savaient déjà -----------
// `bat_requis` et `devis_requis` s'arment TOUT SEULS depuis leur création — au
// dépôt d'un PDF, ou au passage par une sous-étape de BAT / de chiffrage. Mais
// ils s'arment vers l'AVANT : les dossiers déjà en base au moment où les
// colonnes sont apparues valent `false`, quoi qu'ils aient traversé.
//
// Mesuré sur la base de l'atelier le 27/08 : le feu s'allumait sur ZÉRO carte
// des 185. Pas parce que tout va bien — parce que personne n'avait rien à lui
// dire. Le rattrapage lit les trois traces que le dossier porte déjà, dans cet
// ordre de fiabilité décroissante :
//   1. sa sous-étape ACTUELLE      (15 dossiers pour le devis, 5 pour le BAT) ;
//   2. une pièce jointe déposée    (3 · 4) ;
//   3. le journal des sous-étapes  (4 · 21 — de loin la meilleure source pour
//      le BAT : vingt dossiers sont passés par « Préparation du BAT »).
// Total : 20 dossiers armés pour le devis, 22 pour le BAT.
//
// ON NE DEVINE RIEN. Un dossier qui n'a laissé aucune de ces trois traces reste
// à `false` : mieux vaut un feu muet sur un dossier qu'un feu qui ment sur
// trente.
//
// Down : UPDATE requests SET bat_requis = false, devis_requis = false;
//        DELETE FROM app_meta WHERE key = 'feu_rattrapage';
//        (les colonnes elles-mêmes se défont avec leur propre migration)
const FEU_ETAPES_DEVIS = ['chiffrage_en_cours', 'devis_envoye', 'devis_valide'];
const FEU_ETAPES_BAT = ['prepa_bat', 'bat_envoye', 'bat_modif', 'bat_valide'];

// `IN ($1, $2, …)` et non `= ANY($1)` : pg-mem, la base locale de test, ne rend
// pas le tableau à plat — la migration passerait en prod et ne ferait RIEN en
// local, ce qui est exactement le genre d'écart qu'on ne voit qu'une fois
// déployé.
const placeholders = (liste, depuis = 1) => liste.map((_, i) => `$${i + depuis}`).join(', ');

async function rattraperFeu() {
  const { rows } = await pool.query("SELECT 1 FROM app_meta WHERE key = 'feu_rattrapage'");
  if (rows.length) return;
  for (const [colonne, dateColonne, etapes, kind, etapeValide] of [
    ['devis_requis', 'devis_valide_le', FEU_ETAPES_DEVIS, 'devis', 'devis_valide'],
    ['bat_requis', 'bat_valide_le', FEU_ETAPES_BAT, 'bat', 'bat_valide'],
  ]) {
    const ids = new Set();
    const ramasser = async (sql, params) => {
      const r = await pool.query(sql, params).catch(() => ({ rows: [] }));
      for (const x of r.rows) if (x.id) ids.add(x.id);
    };
    await ramasser(
      `SELECT id FROM requests WHERE sub_stage IN (${placeholders(etapes)})`, etapes,
    );
    await ramasser('SELECT request_id AS id FROM attachments WHERE kind = $1', [kind]);
    await ramasser(
      `SELECT request_id AS id FROM request_events
        WHERE field = 'sub_stage' AND value_after IN (${placeholders(etapes)})`, etapes,
    );
    if (!ids.size) continue;
    const liste = [...ids];
    await pool.query(
      `UPDATE requests SET ${colonne} = true WHERE id IN (${placeholders(liste)})`, liste,
    ).catch(() => { /* colonne absente : sa migration ne s'est pas jouée */ });
    // LA VALIDATION, quand elle a laissé une trace. Elle n'en laisse presque
    // jamais aujourd'hui (zéro dossier sur 185 est passé par « Devis validé »),
    // mais la ligne coûte une requête et évite d'allumer un dossier qui, lui,
    // a bel et bien été validé.
    await pool.query(
      `UPDATE requests SET ${dateColonne} = COALESCE(${dateColonne}, updated_at)
        WHERE sub_stage = $1 AND ${dateColonne} IS NULL`, [etapeValide],
    ).catch(() => {});
  }
  await poserMeta('feu_rattrapage', '1');
}

// --- Étapes rangées à la main (ordre manuel) ---------------------------------
// Glisser une carte réécrit les `position` en base : le geste vaut donc pour
// TOUS les postes. Or la décision « cette étape est rangée à la main » vivait,
// elle, dans le localStorage de chaque tablette — une vendeuse rangeait sa
// liste et la tablette d'à côté ne bougeait pas, jusqu'au jour où un geste
// accidentel la faisait basculer et rebattait tout d'un coup. La décision
// rejoint donc l'endroit où vivent ses effets : la base.
// Down : DELETE FROM app_meta WHERE key = 'ordre_manuel'.
async function getOrdreManuel() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'ordre_manuel'");
  if (!rows[0] || typeof rows[0].value !== 'string') return [];
  try {
    const list = JSON.parse(rows[0].value);
    return Array.isArray(list) ? list.filter((s) => STAGE_SLUGS.includes(s)) : [];
  } catch (_) {
    return [];
  }
}

async function setOrdreManuel(list) {
  const clean = Array.isArray(list)
    ? [...new Set(list.filter((s) => STAGE_SLUGS.includes(s)))]
    : [];
  await poserMeta('ordre_manuel', JSON.stringify(clean));
  return clean;
}

// UNE ÉTAPE À LA FOIS, et le serveur fusionne. La liste partie de chaque poste
// était la liste ENTIÈRE telle que ce poste la connaissait : une vendeuse range
// « Production » pendant qu'une autre range « Demande & chiffrage », chacune
// envoie sa vision d'avant, et la seconde écrase la décision de la première.
// L'étape rangée retombait alors en tri automatique sous les yeux de celle qui
// venait de la ranger — les `position` en base, elles, étaient bien écrites : le
// geste avait « marché » puis s'était défait tout seul.
// La ligne d'`app_meta` est donc prise (`FOR UPDATE`) le temps de la relire et
// de la réécrire, et on ne touche QUE l'étape nommée.
async function basculerOrdreManuel(etape, range) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // `FOR UPDATE` ne verrouille que des lignes existantes : au tout premier
    // rangement il n'y en a aucune, et deux postes passeraient de front. On
    // sème donc la ligne avant de la prendre.
    await client.query(
      "INSERT INTO app_meta (key, value) VALUES ('ordre_manuel', '[]') ON CONFLICT (key) DO NOTHING",
    );
    const { rows } = await client.query(
      "SELECT value FROM app_meta WHERE key = 'ordre_manuel' FOR UPDATE",
    );
    let connues = [];
    try {
      const lu = JSON.parse(rows[0] && rows[0].value);
      if (Array.isArray(lu)) connues = lu.filter((s) => STAGE_SLUGS.includes(s));
    } catch (_) { connues = []; }
    const set = new Set(connues);
    if (range) set.add(etape); else set.delete(etape);
    const clean = [...set];
    await client.query(
      "UPDATE app_meta SET value = $1 WHERE key = 'ordre_manuel'", [JSON.stringify(clean)],
    );
    await client.query('COMMIT');
    return clean;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// --- Marge : cible, minimum, alerte (§13) ------------------------------------
// « Je veux pouvoir définir : marge cible, marge minimum, alerte marge faible.
//   Si un commercial descend sous la marge minimum : afficher une alerte. La
//   Direction peut néanmoins forcer le prix. »
//
// ALERTER, PAS INTERDIRE — c'est écrit noir sur blanc, et c'est aussi la seule
// règle tenable : un prix se négocie devant le client, et un logiciel qui refuse
// une vente au comptoir est un logiciel qu'on contourne en notant sur un papier.
// Down : DELETE FROM app_meta WHERE key = 'marges'.
const DEFAULT_MARGES = { cible: 60, minimum: 35 };

async function getMarges() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'marges'");
  if (!rows[0]) return { ...DEFAULT_MARGES };
  try {
    const lu = JSON.parse(rows[0].value);
    return lu && typeof lu === 'object' ? { ...DEFAULT_MARGES, ...lu } : { ...DEFAULT_MARGES };
  } catch (_) {
    return { ...DEFAULT_MARGES };
  }
}

async function setMarges(p) {
  const src = p && typeof p === 'object' ? p : {};
  const pct = (v, def) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 10) / 10 : def;
  };
  const propre = {
    cible: pct(src.cible, DEFAULT_MARGES.cible),
    minimum: pct(src.minimum, DEFAULT_MARGES.minimum),
  };
  // Un minimum au-dessus de la cible n'a pas de sens et rendrait l'alerte
  // permanente : on remet la cible au niveau du minimum plutôt que d'accepter
  // un réglage qui crierait sur chaque vente.
  if (propre.minimum > propre.cible) propre.cible = propre.minimum;
  await poserMeta('marges', JSON.stringify(propre));
  return propre;
}

// --- Projets et tâches -------------------------------------------------------

// Range en projets les lots déjà regroupés à l'écran. Une seule fois.
async function migrerLotsEnProjets() {
  const { rows: deja } = await pool.query("SELECT 1 FROM app_meta WHERE key = 'lots_en_projets_v1'");
  if (deja.length) return;

  // On ne prend QUE les lignes qui portent une référence de lot ET pas encore de
  // projet. Une ligne isolée n'a pas de dossier à recevoir : lui en fabriquer un
  // ferait autant de projets que de commandes, et le niveau ne dirait plus rien.
  let lignes = [];
  try {
    const { rows } = await pool.query(
      `SELECT id, fiche->'lot'->>'ref' AS ref, billing_company
         FROM requests
        WHERE project_id IS NULL AND fiche->'lot'->>'ref' IS NOT NULL
        ORDER BY created_at ASC`,
    );
    lignes = rows;
  } catch (_) {
    // pg-mem ne sait pas toujours descendre dans un jsonb imbriqué. Ce n'est
    // pas une panne : la base locale n'a pas d'historique à reprendre.
    lignes = [];
  }

  const parRef = new Map();
  for (const l of lignes) {
    if (!l.ref) continue;
    if (!parRef.has(l.ref)) parRef.set(l.ref, []);
    parRef.get(l.ref).push(l);
  }

  for (const [ref, groupe] of parRef) {
    const nom = `${groupe[0].billing_company || 'Client'} — ${ref}`;
    const { rows: p } = await pool.query(
      'INSERT INTO projects (numero, nom, billing_company) VALUES ($1, $2, $3) RETURNING id',
      [ref, nom, groupe[0].billing_company || null],
    );
    for (const l of groupe) {
      await pool.query('UPDATE requests SET project_id = $1 WHERE id = $2', [p[0].id, l.id]);
    }
  }
  await poserMeta('lots_en_projets_v1', String(parRef.size));
}

// ---------------------------------------------------------------------------
// CE QU'IL Y A À FAIRE, POUR LES DOSSIERS D'AVANT (26/08/2026)
//
// Un dossier du comptoir arrive désormais avec le travail rangé fait par fait
// dans `fiche.prod` — référence, couleur, nombre par taille, largeur de logo
// par face — et la carte du planning le lit là. Les dossiers déjà en base ne
// portent ces faits que dans le récapitulatif archivé (`fiche.details`), noyés
// dans des phrases : nulle part où la carte puisse aller les chercher.
//
// ON RECOPIE, ON NE CALCULE RIEN. Chaque fait est repris tel quel dans les
// rangées du récapitulatif, écrites par nous et donc de forme connue. Ce qui ne
// se relit pas exactement est ABANDONNÉ, jamais deviné : un chiffre faux coûte
// une réimpression, une case vide coûte une question.
// ---------------------------------------------------------------------------

// Les tailles que le comptoir sait écrire. Toute autre est le signe qu'on ne
// lit pas ce qu'on croit : on préfère alors ne rien reprendre du tout.
const TAILLES_DU_RECAP = ['S', 'M', 'L', 'XL', '2XL', 'Autres'];
const CASE_LOGO = `(?:${TAILLES_DU_RECAP.join('|')}) \\d+`;
const LOGO_D_UNE_FACE = new RegExp(`^(.+?) (${CASE_LOGO}(?: · ${CASE_LOGO})*)$`);
const UNE_TAILLE = /^(\d+) × (.+)$/;

// Un récapitulatif archivé, relu par libellé. « — » est la marque du champ vide
// au comptoir : il vaut absence, pas valeur.
function rangeesDuRecap(details) {
  const par = new Map();
  for (const l of Array.isArray(details) ? details : []) {
    if (!l || typeof l !== 'object') continue;
    const v = String(l.v == null ? '' : l.v).trim();
    if (l.k && v && v !== '—') par.set(String(l.k), v);
  }
  return par;
}

// Le détail textile est une suite de segments séparés par « • ». On ne prend
// que celui qu'on cherche, et seulement s'il se nomme exactement.
function segmentDuDetail(texte, tete) {
  for (const seg of String(texte || '').split(' • ')) {
    if (seg.startsWith(tete)) return seg.slice(tete.length).trim();
  }
  return '';
}

function taillesDuDetail(texte) {
  const seg = segmentDuDetail(texte, 'Tailles : ');
  if (!seg || seg === 'à préciser') return [];
  const out = [];
  for (const bout of seg.split(' · ')) {
    const m = bout.trim().match(UNE_TAILLE);
    // UNE SEULE RANGÉE DOUTEUSE ET ON ABANDONNE TOUT : une série de tailles
    // amputée d'une taille est pire qu'une série absente — elle se croit
    // complète.
    if (!m || !TAILLES_DU_RECAP.includes(m[2])) return [];
    out.push({ t: m[2], n: Number(m[1]) });
  }
  return out;
}

function logosDuDetail(texte) {
  const seg = segmentDuDetail(texte, 'Taille du logo (mm) : ');
  if (!seg) return [];
  const out = [];
  for (const bloc of seg.split(' / ')) {
    const m = bloc.trim().match(LOGO_D_UNE_FACE);
    if (!m) return [];
    const largeurs = m[2].split(' · ').map((c) => c.split(' ')[1]);
    const distinctes = [...new Set(largeurs)];
    // Une face, une largeur — sauf quand elle change d'une taille à l'autre,
    // et là on garde les tailles avec : sur NS300 le dos va de 240 à 320 mm.
    // Les tailles d'une même face se rejoignent à la BARRE : le point médian
    // sépare deux faces sur la ligne du planning, et le même signe des deux
    // côtés ferait lire « Dos S 260 · M 280 » comme deux faces.
    out.push({
      face: m[1],
      mm: distinctes.length === 1 ? distinctes[0] : m[2].split(' · ').join('/'),
    });
  }
  return out;
}

function encreDuDetail(texte) {
  const seg = segmentDuDetail(texte, 'Marquage ');
  const m = seg.match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : '';
}

// Ce qu'une ligne a à produire, relu dans le récapitulatif de SON dossier. Le
// rang vient du lot (« Besoin 2 — Couleur ») : quatre lignes d'un même ticket
// n'ont ni la même référence ni les mêmes tailles.
function prodDuRecap(fiche) {
  const rangees = rangeesDuRecap(fiche.details);
  if (!rangees.size) return null;
  const rang = (fiche.lot && Number(fiche.lot.rang)) || 1;
  const tete = `${fiche.source === 'Vente directe' ? 'Article' : 'Besoin'} ${rang} — `;
  const detail = rangees.get(`${tete}Détail textile`) || '';
  const prod = {
    ref: rangees.get(`${tete}Référence`) || '',
    couleur: rangees.get(`${tete}Couleur`) || '',
    marquage: rangees.get(`${tete}Production`) || '',
    // « Marquage Coeur + Dos (Blanc) » : entre parenthèses, la couleur de
    // l'ENCRE. Elle ne se devine pas — si la parenthèse manque, on n'écrit rien.
    encre: encreDuDetail(detail),
    tailles: taillesDuDetail(detail),
    logos: logosDuDetail(detail),
  };
  return prod.ref || prod.couleur || prod.marquage || prod.encre
    || prod.tailles.length || prod.logos.length ? prod : null;
}

// Selon le pilote (Postgres / pg-mem), une colonne JSON revient en objet ou en
// texte : on accepte les deux plutôt que de sauter la moitié des lignes.
function ficheObjet(brut) {
  let f = brut;
  if (typeof f === 'string') {
    try { f = JSON.parse(f); } catch (_) { return null; }
  }
  return f && typeof f === 'object' ? f : null;
}

async function reprendreProdDesLignes() {
  const { rows: deja } = await pool.query("SELECT 1 FROM app_meta WHERE key = 'prod_des_lignes_v1'");
  if (deja.length) return;

  // LE TRI SE FAIT EN JAVASCRIPT, PAS EN SQL. Un `LIKE` est le premier réflexe
  // — et pg-mem lui rend zéro ligne dès que le motif porte un accent ou un
  // tiret cadratin (constaté le 26/08 sur « ATELIER OLDA — RÉCAPITULATIF% » :
  // la migration ne trouvait rien en local et tout en prod, le pire des deux
  // mondes). Une passe complète, UNE fois dans la vie de la base, ne coûte pas
  // le risque de ne migrer que la moitié des postes.
  let lignes = [];
  try {
    const { rows } = await pool.query('SELECT id, fiche FROM requests WHERE fiche IS NOT NULL');
    lignes = rows;
  } catch (_) {
    lignes = [];   // base neuve : rien à reprendre
  }

  let reprises = 0;
  for (const l of lignes) {
    const fiche = ficheObjet(l.fiche);
    if (!fiche || fiche.prod) continue;
    if (!String(fiche.kind || '').startsWith('comptoir')) continue;
    const prod = prodDuRecap(fiche);
    if (!prod) continue;
    // `updated_at` n'est PAS touché : le Point du jour lit « ce qui a bougé
    // depuis », et un démarrage ne doit pas lui faire croire que tout le
    // comptoir vient d'être repris à la main.
    await pool.query('UPDATE requests SET fiche = $2 WHERE id = $1',
      [l.id, JSON.stringify({ ...fiche, prod })]);
    reprises += 1;
  }
  await poserMeta('prod_des_lignes_v1', String(reprises));
}

// ---------------------------------------------------------------------------
// LA COLONNE « INFOS » SE LIBÈRE DU RÉCAPITULATIF IMPRIMÉ (26/08/2026)
//
// Un dossier du comptoir entrait au planning avec son récapitulatif ENTIER dans
// `description` : quarante lignes de « Type de dossier : … / Article 1 — Prix
// personnalisation : 0,00 € » dans une colonne large de deux cents pixels. Le
// chef d'atelier n'y lisait rien, et la note qu'il voulait y écrire se perdait
// au bout du pavé. Le comptoir n'y met plus que ce que la vendeuse a écrit ;
// restent les dossiers déjà en base.
//
// ON NE RETIRE QUE CE QU'ON SAIT RÉÉCRIRE. Une ligne n'est touchée que si sa
// description est EXACTEMENT le récapitulatif recomposé depuis `fiche.details`
// — la preuve que personne n'y a jamais ajouté un mot. Dès qu'un signe diffère,
// on laisse : ce n'est plus une copie, c'est du travail.
// ---------------------------------------------------------------------------
const RECAP_MAX = 1200;   // le même plafond que le serveur applique à `description`
const RECAP_TETE = 'ATELIER OLDA — RÉCAPITULATIF';

function recapDeLaFiche(fiche) {
  const titre = fiche.source === 'Vente directe'
    ? `${RECAP_TETE} DE VENTE DIRECTE`
    : `${RECAP_TETE} DE DEMANDE`;
  const lignes = (Array.isArray(fiche.details) ? fiche.details : [])
    .map((l) => `${l.k} : ${l.v}`);
  const texte = [titre, ''].concat(lignes).join('\n');
  return texte.length <= RECAP_MAX ? texte : `${texte.slice(0, RECAP_MAX - 1)}…`;
}

async function libererLaColonneInfos() {
  const { rows: deja } = await pool.query("SELECT 1 FROM app_meta WHERE key = 'infos_sans_recap_v1'");
  if (deja.length) return;

  // Même règle qu'au-dessus : aucun `LIKE`, le motif est accentué et pg-mem
  // lui rend zéro ligne.
  let lignes = [];
  try {
    const { rows } = await pool.query(
      'SELECT id, description, fiche FROM requests WHERE description IS NOT NULL AND fiche IS NOT NULL',
    );
    lignes = rows;
  } catch (_) { lignes = []; }

  let liberees = 0;
  for (const l of lignes) {
    if (!String(l.description).startsWith(RECAP_TETE)) continue;
    const fiche = ficheObjet(l.fiche);
    if (!fiche) continue;
    if (l.description !== recapDeLaFiche(fiche)) continue;
    // Ce que la vendeuse avait écrit de sa main reprend la place — et si elle
    // n'avait rien écrit, la colonne redevient vide, prête à recevoir une note.
    const note = typeof fiche.commentaire === 'string' && fiche.commentaire.trim()
      ? fiche.commentaire : null;
    await pool.query('UPDATE requests SET description = $2 WHERE id = $1', [l.id, note]);
    liberees += 1;
  }
  await poserMeta('infos_sans_recap_v1', String(liberees));
}

// MODÈLES DE PROJET (§28) — « T-shirt DTF » pose ses cinq étapes.
//
// Sans modèle, la tâche est ingérable : il faudrait ressaisir la liste des
// étapes à chaque commande, et personne ne le ferait deux fois. C'est la
// condition de son utilité, pas un confort.
//
// Rangés en `app_meta` et non dans une table : ce sont quatre listes de mots que
// le patron veut pouvoir changer, pas des données qui se croisent avec autre
// chose. Une table coûterait un écran d'administration pour rien.
// Down : DELETE FROM app_meta WHERE key = 'modeles_taches'.
const DEFAULT_MODELES = [
  { id: 'tshirt_dtf', nom: 'T-shirt DTF', etapes: ['Préparation du fichier', 'Impression DTF', 'Découpe', 'Pressage', 'Contrôle'] },
  { id: 'tasse_uv', nom: 'Tasse UV', etapes: ['Préparation du fichier', 'Impression UV', 'Contrôle'] },
  { id: 'trotec', nom: 'Gravure & Découpe', etapes: ['Préparation du fichier', 'Gravure Trotec', 'Nettoyage', 'Contrôle'] },
  { id: 'textile_commande', nom: 'Textile à commander', etapes: ['Commande textile', 'Réception', 'Préparation du fichier', 'Impression DTF', 'Pressage', 'Contrôle'] },
];

async function getModeles() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'modeles_taches'");
  if (!rows[0] || typeof rows[0].value !== 'string') return DEFAULT_MODELES.map((m) => ({ ...m }));
  try {
    const lu = JSON.parse(rows[0].value);
    return Array.isArray(lu) && lu.length ? lu : DEFAULT_MODELES.map((m) => ({ ...m }));
  } catch (_) {
    return DEFAULT_MODELES.map((m) => ({ ...m }));
  }
}

async function setModeles(liste) {
  const propre = (Array.isArray(liste) ? liste : [])
    .map((m) => ({
      id: String((m && m.id) || '').trim().slice(0, 40),
      nom: String((m && m.nom) || '').trim().slice(0, 80),
      etapes: (Array.isArray(m && m.etapes) ? m.etapes : [])
        .map((e) => String(e || '').trim().slice(0, 80)).filter(Boolean).slice(0, 20),
    }))
    .filter((m) => m.id && m.nom && m.etapes.length);
  await poserMeta('modeles_taches', JSON.stringify(propre));
  return propre;
}

// --- Comptes nominatifs ------------------------------------------------------
// Le code personnel est haché en scrypt — fourni par Node, aucune dépendance à
// ajouter (le dépôt en compte trois en tout, et c'est une règle). Le sel est
// tiré par code : deux personnes qui choisiraient « 1234 » n'ont pas la même
// empreinte, donc la voir ne renseigne sur rien.
//
// Format rangé : « scrypt$<sel hex>$<empreinte hex> ». Écrit en toutes lettres
// pour qu'une empreinte lue en base dise elle-même comment elle a été faite —
// le jour où le paramètre change, l'ancienne reste vérifiable.
const SCRYPT_N = 16384; // ~50 ms par vérification : négligeable à quatre personnes
const CODE_MIN = 4;
const CODE_MAX = 64;

function hacherCode(code) {
  const sel = crypto.randomBytes(16);
  const cle = crypto.scryptSync(String(code), sel, 32, { N: SCRYPT_N, r: 8, p: 1 });
  return `scrypt$${sel.toString('hex')}$${cle.toString('hex')}`;
}

// Comparaison à TEMPS CONSTANT. Un `===` s'arrête au premier octet faux et
// laisse deviner l'empreinte en chronométrant les réponses — même travers que
// le mot de passe partagé, déjà corrigé côté Basic Auth.
function codeCorrect(code, range) {
  if (typeof range !== 'string') return false;
  const [algo, selHex, attenduHex] = range.split('$');
  if (algo !== 'scrypt' || !selHex || !attenduHex) return false;
  try {
    const attendu = Buffer.from(attenduHex, 'hex');
    const cle = crypto.scryptSync(String(code), Buffer.from(selHex, 'hex'), attendu.length,
      { N: SCRYPT_N, r: 8, p: 1 });
    return crypto.timingSafeEqual(cle, attendu);
  } catch (_) {
    return false;
  }
}

// Le secret qui SIGNE les jetons de session. Tiré une fois et rangé en base :
// tiré à chaque démarrage, il déconnecterait tout l'atelier à chaque
// déploiement — et sur Railway, un déploiement c'est un redémarrage.
// Down : DELETE FROM app_meta WHERE key = 'session_secret'.
let secretSession = null;
async function getSecretSession() {
  if (secretSession) return secretSession;
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'session_secret'");
  if (rows[0] && typeof rows[0].value === 'string' && rows[0].value.length >= 32) {
    secretSession = rows[0].value;
    return secretSession;
  }
  const neuf = crypto.randomBytes(32).toString('hex');
  // ON CONFLICT DO NOTHING puis relecture : deux instances qui démarrent
  // ensemble (Railway pendant un déploiement) ne doivent pas se voler le
  // secret l'une à l'autre — la première qui écrit gagne, l'autre relit.
  await pool.query(
    "INSERT INTO app_meta (key, value) VALUES ('session_secret', $1) ON CONFLICT (key) DO NOTHING", [neuf],
  );
  const { rows: relu } = await pool.query("SELECT value FROM app_meta WHERE key = 'session_secret'");
  secretSession = (relu[0] && relu[0].value) || neuf;
  return secretSession;
}

async function getUtilisateurs() {
  const { rows } = await pool.query(
    'SELECT id, prenom, role, actif, derniere_connexion, (code_hash IS NOT NULL) AS a_un_code'
    + ' FROM users WHERE actif = true ORDER BY created_at ASC',
  );
  return rows;
}

async function getUtilisateurParPrenom(prenom) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE prenom = $1 AND actif = true LIMIT 1', [prenom],
  );
  return rows[0] || null;
}

async function getUtilisateur(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1 AND actif = true LIMIT 1', [id]);
  return rows[0] || null;
}

async function poserCode(id, code) {
  await pool.query(
    'UPDATE users SET code_hash = $1, updated_at = now() WHERE id = $2', [hacherCode(code), id],
  );
}

async function toucherConnexion(id) {
  await pool.query('UPDATE users SET derniere_connexion = now() WHERE id = $1', [id]);
}

// --- Interrupteurs de fonctionnalité -----------------------------------------
// Les gros chantiers à venir (comptes nominatifs, modèle Projet/Tâche, coûts et
// marge, stock) touchent tous des écrans qui tournent aujourd'hui au comptoir et
// à l'atelier. Un interrupteur permet de les livrer À MOITIÉ sans que personne
// ne s'en aperçoive : le code part, l'écran reste celui d'avant, et il ne bascule
// que le jour où le patron a validé en local.
//
// La liste est ÉCRITE ICI, pas devinée : un interrupteur inconnu envoyé par un
// poste est ignoré. Sans ça, une faute de frappe créerait un drapeau fantôme
// que personne ne lit et qui ne s'éteint jamais.
//
// Tous à `false` par défaut. Un interrupteur absent d'`app_meta` vaut « éteint »,
// jamais « allumé » : au pire on n'a pas la nouveauté, jamais un écran cassé.
// Down : DELETE FROM app_meta WHERE key = 'flags'.
const FLAGS_CONNUS = {
  comptes: 'Connexion nominative et rôles',
  projets: 'Regroupement Projet et liste de tâches',
  marges: 'Décomposition des coûts et marge',
};
const FLAGS_SLUGS = Object.keys(FLAGS_CONNUS);
const FLAGS_ETEINTS = Object.fromEntries(FLAGS_SLUGS.map((s) => [s, false]));

async function getFlags() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'flags'");
  if (!rows[0] || typeof rows[0].value !== 'string') return { ...FLAGS_ETEINTS };
  try {
    const lu = JSON.parse(rows[0].value);
    if (!lu || typeof lu !== 'object') return { ...FLAGS_ETEINTS };
    // On repart TOUJOURS de la liste connue : un drapeau retiré du code
    // disparaît de la réponse même s'il traîne encore en base.
    return { ...FLAGS_ETEINTS, ...Object.fromEntries(
      FLAGS_SLUGS.filter((s) => s in lu).map((s) => [s, lu[s] === true]),
    ) };
  } catch (_) {
    return { ...FLAGS_ETEINTS };
  }
}

// Fusion, jamais remplacement : deux postes ouverts sur les réglages ne doivent
// pas s'effacer l'un l'autre parce que l'un a envoyé sa vision complète.
async function setFlags(patch) {
  const src = patch && typeof patch === 'object' ? patch : {};
  const propre = { ...(await getFlags()) };
  for (const s of FLAGS_SLUGS) if (s in src) propre[s] = src[s] === true;
  await poserMeta('flags', JSON.stringify(propre));
  return propre;
}

// --- Journal des modifications ----------------------------------------------
// « Qui a déplacé ça ? » n'avait aucune réponse : la fiche ne connaissait que la
// naissance de la ligne et sa dernière retouche. On enregistre désormais CE QUI
// a changé, et quand — pas QUI, l'application n'ayant qu'un mot de passe commun
// (identifier chaque employé est un choix d'architecture, pas un correctif).
//
// On ne journalise que les champs qui racontent la vie de la commande. La
// `position` en est exclue : un seul glisser en réécrit une dizaine, et le
// journal se remplirait de bruit au lieu d'être lisible.
const JOURNAL_FIELDS = {
  stage: 'Étape',
  sub_stage: 'Sous-étape',
  flag: 'État',
  flag_reason: 'Motif',
  priority: 'Priorité',
  project_value: 'Prix TTC',
  deadline: 'Date souhaitée',
  responsable: 'Pilote',
  referent: 'Référent',
  // CE QUI TOUCHE À L'ARGENT ET À LA QUANTITÉ. Ces six-là ne laissaient aucune
  // trace : un acompte marqué reçu par erreur, une quantité corrigée de 50 à 5,
  // un mode de règlement changé — le dossier ne disait plus ni quoi, ni quand.
  // Ce sont précisément les mouvements qu'on cherche à reconstituer quand un
  // chiffre ne tombe pas juste.
  quantity: 'Quantité',
  product: 'Désignation',
  acompte_demande: 'Acompte demandé',
  acompte_verse: 'Acompte reçu',
  acompte_montant: 'Montant de l’acompte',
  paye: 'Payé',
  paiement_mode: 'Mode de règlement',
  // Le DÉTAIL de la fiche comptoir ne vit pas dans une colonne : ces deux-là
  // sont écrits par `logFicheChange`, pas par la comparaison de colonnes.
  fiche_heure: 'Heure de retrait',
  fiche_detail: 'Détail de la fiche',
  fiche_atelier: 'Consigne atelier',
  // L'ARCHIVAGE et son retour, écrits en toutes lettres par `logCycleDeVie` :
  // ce ne sont pas des comparaisons de colonnes, ce sont deux gestes.
  archive: 'Archivage',
};
const JOURNAL_MAX = 40; // ce qu'on renvoie à la fiche : la vie récente suffit

// Compare l'avant / l'après et écrit une ligne de journal par champ suivi qui a
// réellement bougé. Silencieux en cas d'échec : un journal indisponible ne doit
// jamais faire échouer l'enregistrement que l'employé vient de demander.
// `deadline` est une colonne `date` : le pilote la rend en objet Date, dont le
// `String()` donne « Wed Aug 05 2026 … ». Le journal doit garder la forme ISO,
// seule relisible par la fiche (et par un humain qui ouvre la table).
const enTexte = (v) => {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v);
};

// `qui` : le prénom du poste, tel qu'il arrive dans l'en-tête `X-Qui`. Toujours
// le DERNIER argument et toujours facultatif — un appelant qui l'ignore écrit
// une ligne sans « qui », exactement comme avant, plutôt que de ne rien écrire.
async function logRequestChanges(requestId, avant, apres, qui) {
  if (!avant || !apres) return;
  const memeValeur = (a, b) => (enTexte(a) ?? '') === (enTexte(b) ?? '');
  const lignes = Object.keys(JOURNAL_FIELDS)
    .filter((k) => k in apres && !memeValeur(avant[k], apres[k]))
    .map((k) => ({ field: k, before: enTexte(avant[k]), after: enTexte(apres[k]) }));
  if (!lignes.length) return;
  try {
    for (const l of lignes) {
      await pool.query(
        'INSERT INTO request_events (request_id, field, value_before, value_after, who) VALUES ($1, $2, $3, $4, $5)',
        [requestId, l.field, l.before, l.after, nomDuPoste(qui)],
      );
    }
  } catch (err) {
    console.error('journal des modifications :', err.message);
  }
}

// Le prénom du poste, borné. Il vient d'un en-tête HTTP : il peut être absent,
// vide, ou long comme le bras. On le range comme une donnée, pas comme une
// affirmation — c'est déclaratif jusqu'à ce que les comptes existent.
const QUI_MAX = 40;
function nomDuPoste(qui) {
  if (typeof qui !== 'string') return null;
  const propre = qui.trim().slice(0, QUI_MAX);
  return propre || null;
}

// ARCHIVAGE ET RETOUR D'ARCHIVE. Deux gestes, pas deux valeurs de colonne : le
// journal doit dire « archivée » et « remise au planning », pas afficher un
// horodatage brut que personne ne lit. C'est aussi la seule trace qui survit à
// un archivage — la ligne, elle, quitte tous les écrans.
async function logCycleDeVie(requestId, geste, qui) {
  try {
    await pool.query(
      'INSERT INTO request_events (request_id, field, value_before, value_after, who) VALUES ($1, $2, $3, $4, $5)',
      [requestId, 'archive', null, geste, nomDuPoste(qui)],
    );
  } catch (err) {
    console.error('journal du cycle de vie :', err.message);
  }
}

// Journalise une correction du DÉTAIL de la fiche comptoir.
//
// Le PATCH ordinaire compare les colonnes ; la fiche, elle, est un JSON — ses
// corrections ne laissaient donc AUCUNE trace. Une quantité rectifiée, une heure
// de retrait déplacée : l'« Historique » de la commande restait muet, et
// personne ne pouvait dire ce qui avait bougé, ni quand.
//
// On ne recopie pas le JSON dans le journal (illisible, et il grossirait la
// table pour rien) : on écrit CE QUI A CHANGÉ. L'heure de retrait a son propre
// libellé — c'est elle qui commande le délai de production, elle mérite d'être
// lue d'un coup d'œil ; le reste se résume au nombre de lignes rectifiées.
async function logFicheChange(requestId, avant, apres, qui) {
  const lignes = [];
  const heureAvant = avant && avant.heureSouhaitee ? String(avant.heureSouhaitee) : null;
  const heureApres = apres && apres.heureSouhaitee ? String(apres.heureSouhaitee) : null;
  if (heureAvant !== heureApres) {
    lignes.push({ field: 'fiche_heure', before: heureAvant, after: heureApres });
  }

  // LA CONSIGNE POUR L'ATELIER a sa propre ligne d'historique : c'est elle qui
  // dit ce qu'il faut produire, et « qui a écrit ça, et quand ? » est la
  // première question posée quand la pièce ne correspond pas au ticket.
  const consigne = (f) => (f && f.atelier ? String(f.atelier) : null);
  if (consigne(avant) !== consigne(apres)) {
    lignes.push({ field: 'fiche_atelier', before: consigne(avant), after: consigne(apres) });
  }

  const valeurs = (f, cle) => (Array.isArray(f && f[cle]) ? f[cle] : []).map((l) => (l && l.v) || '');
  let corrigees = 0;
  for (const cle of ['client', 'details']) {
    const a = valeurs(avant, cle);
    const b = valeurs(apres, cle);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if ((a[i] ?? '') !== (b[i] ?? '')) corrigees += 1;
    }
  }
  if (corrigees) {
    lignes.push({
      field: 'fiche_detail', before: null,
      after: `${corrigees} ligne${corrigees > 1 ? 's' : ''} corrigée${corrigees > 1 ? 's' : ''}`,
    });
  }
  if (!lignes.length) return;

  try {
    for (const l of lignes) {
      await pool.query(
        'INSERT INTO request_events (request_id, field, value_before, value_after, who) VALUES ($1, $2, $3, $4, $5)',
        [requestId, l.field, l.before, l.after, nomDuPoste(qui)],
      );
    }
  } catch (err) {
    console.error('journal des modifications (fiche) :', err.message);
  }
}

// La fiche n'affiche que la vie récente : on coupe DANS LA REQUÊTE, pas après.
// À lire toute la table pour n'en garder que quarante lignes, une commande
// retouchée pendant des semaines faisait remonter son historique entier à
// chaque ouverture du tiroir — et le tiroir se rouvre à chaque évènement temps
// réel (voir rafraichirFichesApresChangement).
async function getRequestJournal(requestId) {
  const { rows } = await pool.query(
    `SELECT field, value_before, value_after, who, created_at FROM request_events
     WHERE request_id = $1 ORDER BY created_at DESC, field ASC LIMIT $2`,
    [requestId, JOURNAL_MAX],
  );
  return rows;
}

module.exports = {
  pool, init, repairOrphanStages, toFiveFamilies, migrateFamiliesToFive, migrateStagesToLinear,
  STAGES, STAGE_SLUGS, FAMILIES, SUB_STAGES, SUB_SLUGS, EMPLOYEES, RESPONSABLES, CLIENT_TYPES, FLAGS,
  ORDER_KINDS,
  getCategoryOwners, setCategoryOwners,
  getCategoryReferents, setCategoryReferents,
  DEFAULT_MACHINES, getMachines, setMachines,
  getTarifsTasseArticles, setTarifsTasseArticles,
  getTarifsTasseParametres, setTarifsTasseParametres,
  DEFAULT_TARIFS_TASSE_ARTICLES, DEFAULT_TARIFS_TASSE_PARAMETRES,
  DEFAULT_SUPPLEMENTS_EXPRESS, getSupplementsExpress, setSupplementsExpress,
  getCommandeZones, getHiddenCommandeZones,
  SECTEURS_AMORCE, getClientSecteurs, addClientSecteur, removeClientSecteur,
  WHATSAPP_MESSAGE_MAX, DEFAULT_WHATSAPP_MESSAGE, getWhatsappMessage, setWhatsappMessage,
  TEXTILE_DEFAULTS, getReglagesTextile, setReglagesTextile,
  getTaillesLogo, majTailleLogo, compterTaillesLogo, nettoyerTaillesLogo,
  creerFamilleLogo, majFamilleLogo, retirerFamilleLogo,
  SUB_TO_FAMILY, getOrdreManuel, setOrdreManuel, basculerOrdreManuel,
  JOURNAL_FIELDS, logRequestChanges, logFicheChange, logCycleDeVie, getRequestJournal,
  FLAGS_CONNUS, FLAGS_SLUGS, getFlags, setFlags,
  ROLES, ROLE_LABELS, EQUIPE, CODE_MIN, CODE_MAX,
  DEFAULT_MODELES, getModeles, setModeles,
  DEFAULT_MARGES, getMarges, setMarges,
  getSecretSession, getUtilisateurs, getUtilisateur, getUtilisateurParPrenom,
  poserCode, toucherConnexion, codeCorrect,
  clientKey, nextClientCode,
  // Exposées pour être ÉPROUVÉES, pas pour être appelées : ce sont les deux
  // fonctions qui décident, à la reprise des dossiers d'avant, ce qu'on relit
  // du récapitulatif archivé et ce qu'on accepte d'y retirer. Une migration qui
  // se trompe sur un chiffre coûte une réimpression ; celle-là doit pouvoir se
  // vérifier sans base.
  prodDuRecap, recapDeLaFiche,
  // Et les deux migrations elles-mêmes : pg-mem refuse de rejouer `init()` en
  // entier (son `CREATE TABLE IF NOT EXISTS` échoue au second passage), or une
  // migration qui n'a jamais tourné sur de vraies lignes n'est pas éprouvée.
  reprendreProdDesLignes, libererLaColonneInfos,
};
