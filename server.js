'use strict';

// Charge .env en local (zéro dépendance). En production (Railway), les
// variables sont injectées par la plateforme et ce fichier n'existe pas.
try {
  const envFile = require('fs').readFileSync(require('path').join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch (_) { /* pas de .env : normal en prod */ }

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const zlib = require('node:zlib');
const compression = require('compression');
// LE PRIX SUIT LA QUANTITÉ (Charlie, 28/08). Le moteur du comptoir, rejoué ici :
// corriger « 30 S » en « 100 S » sur la ligne du planning doit appliquer le
// dégressif du fichier V9, pas garder le prix de trente pièces.
const chiffrage = require('./chiffrage');
// BAT STUDIO — l'onglet « BAT » de la barre. Tout son serveur tient là-dedans ;
// son front est servi tel quel depuis `public/bat/`. Voir l'entête de bat.js.
const { monterBat } = require('./bat');
const {
  pool, init, STAGES, STAGE_SLUGS, SUB_SLUGS, RESPONSABLES, CLIENT_TYPES, FLAGS, ORDER_KINDS,
  getCategoryOwners, setCategoryOwners,
  getCategoryReferents, setCategoryReferents,
  getMachines, setMachines,
  getCatalogueProduits, setCatalogueProduits,
  apercuImportCatalogue, appliquerImportCatalogue,
  getTarifsTasseArticles, setTarifsTasseArticles,
  getTarifsTasseParametres, setTarifsTasseParametres,
  getSupplementsExpress, setSupplementsExpress,
  getTarifsTransport, setTarifsTransport,
  getCommandeZones,
  getClientSecteurs, addClientSecteur, removeClientSecteur,
  SUB_STAGES, WHATSAPP_MESSAGE_MAX, getWhatsappMessage, setWhatsappMessage,
  getReglagesTextile, setReglagesTextile,
  getEntreprise, setEntreprise,
  getMentionsRegime, setMentionsRegime,
  getTaillesLogo, majTailleLogo, compterTaillesLogo,
  creerFamilleLogo, majFamilleLogo, retirerFamilleLogo,
  SUB_TO_FAMILY, getOrdreManuel, setOrdreManuel, basculerOrdreManuel,
  JOURNAL_FIELDS, logRequestChanges, logFicheChange, logCycleDeVie, getRequestJournal,
  FLAGS_CONNUS, getFlags, setFlags,
  ROLE_LABELS, CODE_MIN, CODE_MAX,
  getModeles, setModeles,
  getMarges, setMarges,
  getSecretSession, getUtilisateurs, getUtilisateur, getUtilisateurParPrenom,
  poserCode, toucherConnexion, codeCorrect,
  clientKey, nextClientCode,
} = require('./db');
const RESPONSABLE_SET = new Set(RESPONSABLES);
const CLIENT_TYPE_SET = new Set(CLIENT_TYPES);
const FLAG_SET = new Set(FLAGS);
const ORDER_KIND_SET = new Set(ORDER_KINDS);
// Longueur maximale du motif d'alerte : une phrase, pas un roman (la ligne de
// grille l'affiche tronqué, l'infobulle en donne le texte complet).
const FLAG_REASON_MAX = 240;

// UNE COMMANDE ARCHIVÉE RESTE EN BASE ET SORT DE TOUS LES ÉCRANS.
// `deleted_at IS NULL` est donc à poser sur CHAQUE lecture qui alimente un
// écran ou un compteur. Écrit en constante, en deux formes, pour qu'on puisse
// le retrouver d'un `grep` — et un test vérifie qu'aucune lecture d'écran ne
// l'oublie, parce qu'une lecture qui l'oublie ne casse rien : elle ressuscite
// simplement une ligne archivée au milieu du planning, sans erreur ni message.
//
// Deux endroits ne le portent PAS, et c'est voulu :
//   - les recherches par empreinte / par référence de ticket, qui doivent voir
//     l'archive pour ne JAMAIS réutiliser un numéro ni recréer un dossier déjà
//     saisi (voir refs-comptoir-collision) ;
//   - la corbeille, dont c'est tout l'objet.
const VIVANTES = 'r.deleted_at IS NULL';
const VIVANTES_NU = 'deleted_at IS NULL';

// QUI a fait le geste. Aujourd'hui c'est le prénom choisi une fois par
// appareil (`olda.qui`), envoyé en en-tête par le poste : déclaratif, jamais
// une preuve — n'importe qui peut écrire n'importe quel prénom. Le jour où les
// comptes existent, seule CETTE fonction change ; tous ses appelants restent.
const quiDemande = (req) => {
  // LA SESSION D'ABORD, et de loin. Une fois les comptes allumés, `req.moi`
  // vient d'un jeton signé et d'une relecture en base : c'est le seul « qui »
  // qui vaut quelque chose. L'en-tête, lui, est déclaratif — n'importe quel
  // poste peut y écrire n'importe quel prénom.
  //
  // Sans cette ligne, allumer les comptes ne changeait RIEN au journal : il
  // continuait de croire l'en-tête, et se retrouvait vide dès qu'un appel
  // arrivait sans lui. C'est le test de « Mon travail » qui l'a trouvé — la
  // liste « terminé aujourd'hui » se lit dans le journal, pas dans l'état des
  // lignes, et elle restait donc obstinément vide.
  if (req.moi && req.moi.prenom) return req.moi.prenom;
  const brut = req.get('X-Qui');
  if (typeof brut !== 'string' || !brut.trim()) return null;
  // Le poste l'envoie encodé en pourcent — un en-tête HTTP ne transporte pas
  // sûrement un « é ». Un encodage abîmé (proxy, poste ancien) ne doit pas
  // faire échouer l'écriture qu'on est en train de journaliser : on garde
  // alors le texte brut, quitte à ce qu'il soit moins joli.
  let nom = brut;
  try { nom = decodeURIComponent(brut); } catch (_) { /* on garde le brut */ }
  return nom.trim().slice(0, 40) || null;
};

const app = express();
const PORT = process.env.PORT || 3000;

// Railway place un proxy devant le service.
app.set('trust proxy', 1);
// gzip : app.js + styles.css pèsent ~400 Ko à nu, ~4× moins compressés — c'est
// le premier levier du « LCP < 2,5 s en 4G » (Railway ne compresse pas seul).
// JAMAIS sur le flux SSE : la compression mettrait les évènements en tampon et
// le « temps réel » arriverait par paquets tardifs.
app.use(compression({
  filter: (req, res) => req.path !== '/api/stream' && compression.filter(req, res),
}));
// 1 Mo et non les 100 Ko par défaut : un dossier du comptoir transporte le
// récapitulatif complet, la fiche client et jusqu'à trente lignes d'articles.
// Au-delà de 100 Ko, Express répondait 413 en PAGE HTML — le parcours affichait
// une erreur illisible et la vente était perdue, exactement le genre de dossier
// évaporé qu'on a déjà payé (voir l'écran de fin du comptoir).
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------------------
// Basic Auth (mot de passe partagé). Si APP_PASSWORD est absent → accès ouvert.
// ---------------------------------------------------------------------------
const APP_PASSWORD = process.env.APP_PASSWORD;

// Comparaison à temps constant. `timingSafeEqual` exige deux tampons de MÊME
// longueur : on compare donc les empreintes, qui font toujours 32 octets.
function memeSecret(a, b) {
  const h = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

// TENTATIVES RATÉES, PAR ADRESSE. L'application n'a qu'UN mot de passe, partagé
// par tout l'atelier : il ne change jamais et personne ne peut le révoquer poste
// par poste. Sans compteur, rien n'empêchait de l'essayer en boucle, aussi vite
// que le serveur sait répondre. On ne verrouille pas le compte (ce serait offrir
// à n'importe qui le moyen de fermer le comptoir) : on ralentit, puis on refuse
// pendant quelques minutes l'adresse qui insiste.
const AUTH_ESSAIS_MAX = 10;          // au-delà, l'adresse attend
const AUTH_FENETRE_MS = 10 * 60000;  // les échecs s'oublient après 10 minutes
const echecsAuth = new Map();        // ip -> { n, jusqua }

function auditEchec(ip) {
  const maintenant = Date.now();
  const e = echecsAuth.get(ip);
  if (!e || maintenant > e.jusqua) echecsAuth.set(ip, { n: 1, jusqua: maintenant + AUTH_FENETRE_MS });
  else { e.n += 1; e.jusqua = maintenant + AUTH_FENETRE_MS; }
  // La table ne grossit pas indéfiniment : on balaie les entrées périmées dès
  // qu'elle dépasse une taille qui n'a plus rien d'un atelier.
  if (echecsAuth.size > 1000) {
    for (const [cle, v] of echecsAuth) if (maintenant > v.jusqua) echecsAuth.delete(cle);
  }
}

function tropDEssais(ip) {
  const e = echecsAuth.get(ip);
  if (!e) return false;
  if (Date.now() > e.jusqua) { echecsAuth.delete(ip); return false; }
  return e.n >= AUTH_ESSAIS_MAX;
}

function basicAuth(req, res, next) {
  if (!APP_PASSWORD) return next(); // dev local : accès ouvert

  const ip = req.ip || 'inconnue';
  // Adresse déjà à la porte : on ne compare même plus, et le compteur ne monte
  // pas — insister ne rallonge pas la peine, mais ne l'écourte pas non plus.
  if (tropDEssais(ip)) {
    res.set('Retry-After', '600');
    return res.status(429).send('Trop de tentatives. Réessayez dans quelques minutes.');
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const password = idx >= 0 ? decoded.slice(idx + 1) : decoded;
    // L'identifiant est ignoré, seul le mot de passe partagé compte. Comparaison
    // à temps constant : un `===` s'arrête au premier caractère faux et laisse
    // deviner le mot de passe lettre à lettre en chronométrant les réponses.
    if (memeSecret(password, APP_PASSWORD)) {
      echecsAuth.delete(ip); // un poste qui rentre repart d'une ardoise vierge
      return next();
    }
    // Un mot de passe FAUX se compte. Un en-tête absent, non : c'est le premier
    // appel de tout navigateur, avant même que la fenêtre de saisie s'ouvre.
    auditEchec(ip);
    if (tropDEssais(ip)) {
      res.set('Retry-After', '600');
      return res.status(429).send('Trop de tentatives. Réessayez dans quelques minutes.');
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Planning OLDA", charset="UTF-8"');
  return res.status(401).send('Authentification requise.');
}

app.use(basicAuth);

// Tout `:id` de l'API désigne un UUID. Une valeur d'une autre forme (raccourci
// périmé, faute de frappe, lien collé de travers) n'est pas une panne : c'est
// une ressource qui n'existe pas. Sans ce filtre, PostgreSQL tombait sur une
// erreur de conversion et l'écran recevait un 500 « Erreur serveur ».
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
for (const nom of ['id', 'noteId']) {
  app.param(nom, (req, res, next, value) => {
    if (!UUID_RE.test(value)) return res.status(404).json({ error: 'Ressource introuvable' });
    next();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PATCHABLE = [
  'stage', 'sub_stage', 'order_kind', 'responsable', 'referent', 'priority', 'client_type', 'billing_company',
  'contact_referent', 'contact_phone', 'contact_email',
  'quantity', 'product', 'color', 'project_value', 'description', 'deadline', 'position',
  'flag', 'flag_reason', 'provenance', 'date_prevue', 'retrait_creneau',
  'acompte_demande', 'acompte_verse', 'acompte_montant', 'acompte_date', 'paye', 'paiement_mode',
  'cout_revient',
];

// QUELLE CAPACITÉ IL FAUT POUR ÉCRIRE CHAQUE CHAMP.
//
// Une permission par route ne suffit pas ici : le même PATCH sert à faire
// avancer une tâche (tout le monde), à changer un pilote (chef d'atelier) et à
// marquer un acompte reçu (boutique). Refuser la route entière à l'opérateur,
// ce serait l'empêcher de terminer son travail ; la lui ouvrir en entier, ce
// serait lui donner les prix. On tranche donc CHAMP PAR CHAMP.
//
// Cette table décrit exactement ce que le patron écrit de chaque rôle :
//   - l'opérateur « commence une tâche, la termine, indique un problème,
//     passe une tâche en Bloqué » → sous-étape, alerte et motif ;
//   - le chef d'atelier « organise la production, modifie les priorités,
//     attribue les tâches » → étape, priorité, pilote, référent, ordre ;
//   - la boutique « crée les clients et les demandes, enregistre les
//     acomptes » → tout le descriptif, plus l'argent ;
//   - la direction, tout.
// Un champ absent de cette table exige `clients` : c'est le défaut PRUDENT —
// un champ ajouté demain sans y penser est refusé à l'opérateur, jamais offert.
const CAPACITE_PAR_CHAMP = {
  sub_stage: 'travailler', flag: 'travailler', flag_reason: 'travailler',
  stage: 'production', priority: 'production', position: 'production',
  responsable: 'production', referent: 'production',
  // La date PRÉVUE appartient à celui qui organise l'atelier ; la date
  // SOUHAITÉE (`deadline`) est une promesse au client, donc à la boutique.
  date_prevue: 'production',
  project_value: 'argent', acompte_demande: 'argent', acompte_verse: 'argent',
  acompte_montant: 'argent', acompte_date: 'argent', paye: 'argent', paiement_mode: 'argent',
  // Le coût de revient est d'un cran au-dessus du prix : le prix se négocie
  // devant le client, le coût dit ce que l'atelier gagne. Direction seule.
  cout_revient: 'marge',
};
const capaciteDuChamp = (champ) => CAPACITE_PAR_CHAMP[champ] || 'clients';

// Champs booléens du suivi de paiement. null = on ne se prononce pas (une ligne
// jamais renseignée n'affirme pas « non payé »).
const PAIEMENT_FLAGS = new Set(['acompte_demande', 'acompte_verse', 'paye']);

// Longueur maximale des textes libres de la grille : ces valeurs vivent dans
// une cellule, pas dans un traitement de texte (mêmes bornes que le comptoir).
const TEXTE_LIBRE_MAX = {
  billing_company: 120, contact_referent: 120, product: 140, color: 60, description: 1200,
};

// Colonnes que le schéma déclare NOT NULL. La sortie rapide « rien à valider »
// ci-dessous les laissait passer à null : PostgreSQL refusait l'écriture et
// l'écran recevait un 500 « Erreur serveur » — un message technique, après avoir
// déjà posé la valeur en optimiste, là où il attendait un refus qui explique.
const NON_VIDES = new Set(['stage', 'priority']);

function validateField(key, value) {
  if (value === null || value === undefined) {
    if (NON_VIDES.has(key)) return { ok: false, error: `${key} ne peut pas être vide` };
    return { ok: true, value: null };
  }
  if (PAIEMENT_FLAGS.has(key)) {
    if (typeof value === 'boolean') return { ok: true, value };
    const s = String(value).trim().toLowerCase();
    if (s === '' ) return { ok: true, value: null };
    if (s === 'true' || s === 'false') return { ok: true, value: s === 'true' };
    return { ok: false, error: `${key} doit être un booléen` };
  }
  switch (key) {
    case 'stage':
      if (!STAGE_SLUGS.includes(value)) return { ok: false, error: `stage invalide: ${value}` };
      return { ok: true, value };
    case 'sub_stage': {
      // null = pas de sous-étape (familles sans sous-familles, ou « à préciser »).
      if (value === '') return { ok: true, value: null };
      if (!SUB_SLUGS.has(value)) return { ok: false, error: `sous-étape invalide: ${value}` };
      return { ok: true, value };
    }
    case 'responsable': {
      const s = String(value).trim();
      if (s === '') return { ok: true, value: null };
      if (!RESPONSABLE_SET.has(s)) return { ok: false, error: `responsable invalide: ${s}` };
      return { ok: true, value: s };
    }
    case 'referent': {
      const s = String(value).trim();
      // Référent facultatif : vide / « À attribuer » = pas de référent (null).
      if (s === '' || s === 'À attribuer') return { ok: true, value: null };
      if (!RESPONSABLE_SET.has(s)) return { ok: false, error: `referent invalide: ${s}` };
      return { ok: true, value: s };
    }
    case 'flag': {
      // Alerte de la commande : rien / bloquée / à voir.
      const s = String(value).trim();
      if (s === '') return { ok: true, value: null };
      if (!FLAG_SET.has(s)) return { ok: false, error: `flag invalide: ${s}` };
      return { ok: true, value: s };
    }
    case 'order_kind': {
      // Nature de la ligne : demande (à chiffrer) ou commande (validée). Vide =
      // on ne se prononce pas — la ligne reste neutre, pas de nature inventée.
      const s = String(value).trim();
      if (s === '') return { ok: true, value: null };
      if (!ORDER_KIND_SET.has(s)) return { ok: false, error: `order_kind invalide: ${s}` };
      return { ok: true, value: s };
    }
    case 'flag_reason': {
      const s = String(value).trim().slice(0, FLAG_REASON_MAX);
      return { ok: true, value: s === '' ? null : s };
    }
    case 'priority': {
      const n = Number(value);
      if (![1, 2, 3].includes(n)) return { ok: false, error: 'priority doit être 1, 2 ou 3' };
      return { ok: true, value: n };
    }
    case 'client_type':
      if (!CLIENT_TYPE_SET.has(value)) return { ok: false, error: `client_type invalide: ${value}` };
      return { ok: true, value };
    case 'quantity': {
      if (value === '' ) return { ok: true, value: null };
      const n = parseInt(value, 10);
      if (Number.isNaN(n)) return { ok: false, error: 'quantity doit être un entier' };
      return { ok: true, value: n };
    }
    case 'project_value': {
      if (value === '') return { ok: true, value: null };
      const n = Number(value);
      if (Number.isNaN(n)) return { ok: false, error: 'project_value doit être numérique' };
      return { ok: true, value: n };
    }
    case 'acompte_montant': {
      if (value === '') return { ok: true, value: null };
      const n = Number(value);
      if (Number.isNaN(n)) return { ok: false, error: 'acompte_montant doit être numérique' };
      if (n < 0) return { ok: false, error: 'acompte_montant ne peut pas être négatif' };
      return { ok: true, value: Math.round(n * 100) / 100 };
    }
    case 'paiement_mode': {
      const s = String(value).trim();
      if (s === '') return { ok: true, value: null };
      if (!PAIEMENT_MODE_SET.has(s)) return { ok: false, error: `mode de paiement invalide : ${s}` };
      return { ok: true, value: s };
    }
    case 'position': {
      const n = Number(value);
      // `Number.isFinite` et pas seulement `isNaN` : `Infinity` passait, et
      // comme la position par défaut vaut MAX(position)+1000, TOUTES les lignes
      // créées ensuite dans cette étape héritaient d'`Infinity` — ordre manuel
      // définitivement figé, irréparable depuis l'écran.
      if (!Number.isFinite(n)) return { ok: false, error: 'position doit être numérique' };
      return { ok: true, value: n };
    }
    // MEME RECETTE QUE `deadline` : une date bien formee mais inexistante
    // (« 2026-02-30 ») partirait telle quelle vers une colonne `date`.
    case 'acompte_date':
    case 'deadline': {
      if (value === '') return { ok: true, value: null };
      // Une date bien formée mais inexistante (« 2026-02-30 ») partait telle
      // quelle vers la colonne `date` : erreur PostgreSQL, donc 500 au lieu du
      // 400 qui dit à l'écran ce qui ne va pas.
      if (!isDay(value)) return { ok: false, error: `date invalide : ${value}` };
      return { ok: true, value };
    }
    case 'contact_phone': {
      const s = String(value).trim();
      return { ok: true, value: s === '' ? null : s };
    }
    case 'contact_email': {
      const s = String(value).trim();
      if (s === '') return { ok: true, value: null };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { ok: false, error: 'email invalide' };
      return { ok: true, value: s };
    }
    default: {
      // Textes libres de la grille : bornés comme partout ailleurs, et TOUJOURS
      // ramenés à du texte. Un objet envoyé ici finissait en « [object Object] »
      // dans la colonne, ou faisait tomber le driver en 500.
      const max = TEXTE_LIBRE_MAX[key];
      if (max == null) return { ok: true, value };
      if (typeof value === 'object') return { ok: false, error: `${key} doit être du texte` };
      const s = String(value).trim();
      return { ok: true, value: s === '' ? null : s.slice(0, max) };
    }
  }
}

// Un motif n'a de sens qu'avec une alerte : lever l'alerte (flag → null) efface
// le motif, même si l'appelant ne l'a pas envoyé. Appliqué avant la validation
// pour que POST et PATCH partagent exactement la même règle.
function normalizeFlagBody(body) {
  if (!('flag' in body)) return body;
  const raw = body.flag == null ? '' : String(body.flag).trim();
  return raw === '' ? { ...body, flag_reason: null } : body;
}

// Une sous-étape appartient à UNE famille et à une seule. Poser « Production UV »
// sur une commande en Facturation n'a aucun sens : le glisser-déposer l'interdit
// déjà à l'écran, mais rien ne le rattrapait côté serveur — une fiche restée
// ouverte pendant qu'un collègue déplaçait la ligne pouvait écrire la paire
// incohérente, et la commande disparaissait alors de toutes les vues du rail.
// `stageActuel` = l'étape de la ligne en base (PATCH), ou celle du corps (POST).
function verifierCoherenceEtape(body, stageActuel) {
  if (!('sub_stage' in body)) return null;
  const sub = body.sub_stage;
  if (sub == null || sub === '') return null;
  const famille = 'stage' in body && body.stage ? body.stage : stageActuel;
  if (!famille) return null;
  if (SUB_TO_FAMILY[sub] !== famille) {
    return `sous-étape « ${sub} » incompatible avec l'étape « ${famille} »`;
  }
  return null;
}

// CHANGER DE FAMILLE EFFACE LA SOUS-ÉTAPE — même règle qu'à la copie : on ne
// transporte pas « Production UV » dans « Facturation ».
//
// Le contrôle ci-dessus ne se déclenche que si l'appelant parle de la
// sous-étape. Un `PATCH { stage: 'facturation' }` tout seul passait donc au
// travers et laissait `sub_stage = 'prod_uv'` sur une ligne devenue
// « Facturation ». Deux dégâts, tous les deux silencieux :
//   - `/api/counts` compte les sous-étapes indépendamment des familles : le
//     rail affichait « Production UV — 1 commande », on cliquait, la liste
//     était vide. Un badge fantôme que rien ne pouvait éteindre.
//   - la ligne ne relevait plus d'aucune vue cohérente du rail.
// L'écran envoie toujours les deux champs ; ce filet vaut pour tout le reste —
// une fiche restée ouverte, un raccourci, un poste sur une vieille version.
function effacerSousEtapeSiChangementDeFamille(body, stageActuel) {
  if (!('stage' in body) || !body.stage) return body;
  if ('sub_stage' in body) return body;              // l'appelant a tranché
  if (body.stage === stageActuel) return body;       // même famille : rien ne bouge
  return { ...body, sub_stage: null };
}

function asyncH(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    console.error(err);
    // Un identifiant mal formé dans l'URL (`/api/clients/abc`) n'est pas une
    // panne : c'est une ressource qui n'existe pas. 404 plutôt que 500, sinon
    // le moindre lien périmé remonte comme une alerte serveur.
    if (err && err.code === '22P02') {
      return res.status(404).json({ error: 'Ressource introuvable' });
    }
    // Le détail (noms de tables, contraintes) reste dans les logs du serveur :
    // il n'a rien à faire dans le navigateur.
    res.status(500).json({ error: 'Erreur serveur' });
  });
}

// ---------------------------------------------------------------------------
// VERSION DU SITE — de quoi dire à l'atelier « le patron vient de mettre à jour »
// ---------------------------------------------------------------------------
// Une tablette du comptoir ne se recharge JAMAIS d'elle-même : elle reste
// ouverte des jours entiers sur la page chargée le premier matin. Un
// déploiement ne l'atteint donc pas — et personne, sur place, n'a de raison de
// deviner qu'il faudrait recharger. On le lui DIT, elle propose, et c'est un
// tap qui décide (jamais un rechargement d'office : il emporterait la saisie en
// cours, et l'atelier a déjà payé assez cher des dossiers perdus).
//
// L'EMPREINTE PORTE SUR LE CONTENU DE `public/`, PAS SUR LE DÉPLOIEMENT.
// C'est toute la différence entre un signal utile et une alerte qu'on apprend à
// ignorer :
//   - une date de build ou un numéro de version changerait à CHAQUE
//     redémarrage — un correctif serveur, un simple redémarrage du conteneur, et
//     tout l'atelier verrait une bulle pour un site strictement identique ;
//   - le contenu, lui, ne bouge que si un fichier de l'écran a vraiment changé.
// Corollaire assumé : une correction qui ne touche que `server.js` ou `db.js`
// ne fait apparaître aucune bulle. C'est voulu — il n'y a rien à recharger.
//
// Calculée UNE fois au démarrage (~1 Mo lu), jamais par requête.
const VERSION_SITE = empreinteDuSite(path.join(__dirname, 'public'));

function empreinteDuSite(racine) {
  try {
    const h = crypto.createHash('sha1');
    const parcourir = (dossier, prefixe) => {
      // Trié : `readdir` ne promet aucun ordre, et un ordre qui varie d'un
      // conteneur à l'autre donnerait une empreinte différente pour des
      // fichiers identiques — donc une bulle sur chaque déploiement.
      const entrees = fs.readdirSync(dossier, { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : 1));
      for (const e of entrees) {
        const chemin = path.join(dossier, e.name);
        if (e.isDirectory()) { parcourir(chemin, `${prefixe}${e.name}/`); continue; }
        if (!e.isFile()) continue;
        h.update(`${prefixe}${e.name}\0`).update(fs.readFileSync(chemin)).update('\0');
      }
    };
    parcourir(racine, '');
    return h.digest('hex').slice(0, 12);
  } catch (err) {
    // Une empreinte illisible ne doit pas empêcher le serveur de démarrer. On
    // rend une valeur CONSTANTE : un poste ne verra jamais de fausse mise à
    // jour, il n'en verra simplement aucune — et la console le dit.
    console.warn('Version du site incalculable — la bulle « mise à jour » restera muette :', err && err.message);
    return 'indisponible';
  }
}

// Ce que le poste interroge quand son flux temps réel est mort (503 du plafond,
// proxy qui a coupé) : sans lui, une tablette au flux perdu ne saurait jamais
// qu'une nouvelle version l'attend. `no-store` et pas `no-cache` : la réponse
// tient en trente octets, la revalidation coûterait autant que la réponse.
app.get('/api/version', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ version: VERSION_SITE });
});

// ---------------------------------------------------------------------------
// COMPTES NOMINATIFS ET RÔLES (§3, §25, §39 du patron).
//
// « Construire les permissions proprement dès le départ. Ne pas simplement
//   cacher les boutons côté interface. Les permissions doivent également être
//   contrôlées côté serveur. »
//
// Le mot de passe partagé RESTE : c'est lui qui protège le site de l'extérieur,
// et il le fait bien. Ce qui s'ajoute par-dessus dit QUI est au poste parmi les
// quatre personnes déjà entrées — et c'est cette identité-là qui décide de ce
// qu'on voit et de ce qu'on peut écrire.
//
// TOUT CE BLOC DORT tant que l'interrupteur `comptes` est éteint : sans lui,
// l'application se comporte exactement comme avant. C'est ce qui permet de le
// livrer sans toucher au comptoir qui tourne.
// ---------------------------------------------------------------------------

// Les interrupteurs sont lus à CHAQUE requête protégée : les relire en base à
// chaque fois, c'est un aller-retour Postgres par appel, sur toutes les routes.
// On les garde en mémoire et on invalide à l'écriture (voir PUT /api/flags).
let flagsCache = null;
async function flags() {
  if (!flagsCache) flagsCache = await getFlags();
  return flagsCache;
}
const oublierFlags = () => { flagsCache = null; };

// CE QUE CHAQUE RÔLE PEUT FAIRE. Écrit une fois, en toutes lettres — c'est la
// seule table à relire quand on se demande « qui a le droit de quoi ».
//   travailler : avancer une tâche, signaler un blocage (tout le monde)
//   production : priorités, attribution, ordre du planning, changement de famille
//   clients    : créer/modifier clients, demandes, commandes
//   argent     : voir ET écrire prix, acompte, paiement
//   marge      : voir les coûts et la marge
//   forcer     : débloquer, passer outre une étape
//   reglages   : tout ce qui vaut pour tous les postes
//   bat        : composer un bon à tirer et le déposer sur une fiche
//
// POURQUOI `bat` N'EST PAS `clients` (04/09/2026). Le dépôt d'un PDF sur une
// fiche passe par `exige('clients')` — la boutique et la Direction, pas
// l'atelier. Or « Préparation du BAT » est une sous-étape de l'ATELIER : le
// chef d'atelier est précisément celui qui compose le bon à tirer. Lui refuser
// l'écran l'aurait renvoyé à demander à quelqu'un d'autre de cliquer, ce que
// personne ne fait — on rouvre alors la porte de service qu'on vient de
// fermer. Une capacité à part dit la règle sans mentir : composer un BAT n'est
// pas gérer un client, et ce n'est pas non plus « travailler » (l'opérateur
// exécute, il ne s'engage pas auprès du client).
const CAPACITES = {
  direction: ['travailler', 'production', 'clients', 'argent', 'marge', 'forcer', 'reglages', 'bat'],
  chef_atelier: ['travailler', 'production', 'bat'],
  boutique: ['travailler', 'clients', 'argent', 'bat'],
  operateur: ['travailler'],
};

// Sans session (interrupteur éteint, ou poste pas encore connecté alors que le
// mot de passe partagé l'a laissé entrer), on rend TOUT : c'est le comportement
// d'avant, et il ne doit pas changer tant que les comptes ne sont pas allumés.
function peut(moi, capacite) {
  if (!moi) return true;
  return (CAPACITES[moi.role] || []).includes(capacite);
}

// --- Jeton de session ---------------------------------------------------------
// Signé, pas chiffré : le poste peut lire son contenu, il ne peut pas le
// fabriquer. Aucune table de sessions à tenir — donc rien à nettoyer, et rien
// qui grossisse. La contrepartie assumée : révoquer une session avant son terme
// demanderait de changer le secret (donc de déconnecter les quatre).
const COOKIE_SESSION = 'olda_session';
const SESSION_JOURS = 30;
// `Secure` interdit au navigateur de poser le cookie sur du http : en local, la
// connexion échouerait sans un mot d'explication — on se reconnecterait en
// boucle. En production, Railway sert en https et le drapeau est indispensable.
const SUR_HTTPS = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

const b64u = (buf) => Buffer.from(buf).toString('base64url');

async function signerJeton(charge) {
  const secret = await getSecretSession();
  const corps = b64u(JSON.stringify(charge));
  const sceau = crypto.createHmac('sha256', secret).update(corps).digest('base64url');
  return `${corps}.${sceau}`;
}

async function lireJeton(jeton) {
  if (typeof jeton !== 'string' || !jeton.includes('.')) return null;
  const [corps, sceau] = jeton.split('.');
  if (!corps || !sceau) return null;
  const secret = await getSecretSession();
  const attendu = crypto.createHmac('sha256', secret).update(corps).digest('base64url');
  // Longueurs différentes → `timingSafeEqual` LÈVE au lieu de rendre faux : un
  // jeton tronqué ferait alors une erreur 500 au lieu d'une déconnexion propre.
  if (sceau.length !== attendu.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sceau), Buffer.from(attendu))) return null;
  try {
    const charge = JSON.parse(Buffer.from(corps, 'base64url').toString('utf8'));
    if (!charge || typeof charge !== 'object') return null;
    if (!Number.isFinite(charge.e) || charge.e < Date.now()) return null;
    return charge;
  } catch (_) {
    return null;
  }
}

// Analyse du `Cookie` à la main : une dépendance de plus pour découper une
// chaîne sur des points-virgules ne se justifie pas.
function cookie(req, nom) {
  const brut = req.headers.cookie;
  if (!brut) return null;
  for (const part of brut.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === nom) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

// Pose `req.moi` = { id, prenom, role } quand les comptes sont allumés ET que le
// poste s'est connecté. `null` sinon — et `null` veut dire « comme avant ».
//
// ⚠ PAS `asyncH` ICI : il rend `(req, res) => …` et laisse tomber le `next`.
// Passé en middleware, la chaîne ne repartirait jamais — toutes les requêtes
// resteraient en attente, sans erreur ni message.
//
// Une panne de lecture ne bloque pas le poste : on continue SANS session,
// c'est-à-dire comme avant les comptes. Refuser l'entrée parce qu'on n'a pas su
// lire un cookie, ce serait fermer l'atelier sur un incident de base.
app.use((req, res, next) => {
  req.moi = null;
  (async () => {
    const f = await flags();
    if (!f.comptes) return;
    const charge = await lireJeton(cookie(req, COOKIE_SESSION));
    if (!charge) return;
    // On relit l'utilisateur en base plutôt que de croire le jeton sur parole :
    // un compte désactivé, ou dont le rôle a changé, doit valoir immédiatement —
    // sinon un jeton de trente jours porterait un rôle périmé pendant un mois.
    const u = await getUtilisateur(charge.u);
    if (u) req.moi = { id: u.id, prenom: u.prenom, role: u.role };
  })().catch((err) => { console.error('session :', err.message); }).then(() => next());
});

// LES MOTIFS DE BLOCAGE (§6), au choix plutôt qu'en texte libre.
//
// Le motif était une phrase tapée à la main : impossible de compter, de trier,
// ou de dire « il y a quatre dossiers qui attendent le même fournisseur ». Ce
// sont EXACTEMENT les sept motifs que le patron liste. On garde le texte libre
// à côté — un blocage qui n'entre dans aucune case existe, et le forcer dans
// une case le rendrait invisible.
const MOTIFS_BLOCAGE = [
  { id: 'attente_client', label: 'Attente client' },
  { id: 'attente_fournisseur', label: 'Attente fournisseur' },
  { id: 'probleme_machine', label: 'Problème machine' },
  { id: 'fichier_manquant', label: 'Fichier manquant' },
  { id: 'bat_non_valide', label: 'BAT non validé' },
  { id: 'paiement_manquant', label: 'Paiement manquant' },
  { id: 'rupture_stock', label: 'Rupture de stock' },
];

// LA PORTE. Comptes allumés et personne de connecté = on ne répond RIEN d'utile.
//
// Sans elle, le trou est béant : `peut(null, …)` rend `true` — c'est le
// comportement d'avant, celui qu'il faut garder quand les comptes dorment — et
// un poste qui se contenterait de ne pas se connecter aurait donc TOUS les
// droits. L'interrupteur ne servirait qu'à afficher un écran de connexion qu'on
// peut ignorer.
//
// Trois routes restent ouvertes, et seulement trois : celle qui dit s'il faut se
// connecter, celle par où l'on se connecte, et le numéro de version (la bulle
// « mise à jour disponible » interroge celle-là en boucle, y compris sur un
// poste au repos).
//
// ⚠ ELLE COUVRE AUSSI `/bat/api/` (04/09/2026). BAT Studio est monté sous son
// propre préfixe : ses routes ne commencent donc PAS par `/api/`, et la porte
// les laissait toutes passer. Mesuré, comptes allumés et personne de connecté :
// `PUT /api/requests/<id>/pdf/bat` répondait 401 pendant que
// `PUT /bat/api/crm/bat/<id>` déposait le PDF et répondait 200 — la même
// écriture, sur la même fiche, par la porte de service. `POST
// /bat/api/menage/mockups`, qui EFFACE des images, était ouvert de la même
// façon. Un préfixe n'est pas une frontière de sécurité : la liste des
// préfixes protégés l'est, et elle s'écrit ici.
const PREFIXES_PROTEGES = ['/api/', '/bat/api/'];
const PORTE_OUVERTE = new Set(['/api/session', '/api/version']);
app.use((req, res, next) => {
  // le site, ses pages, ses polices, et tout le statique de `/bat`
  if (!PREFIXES_PROTEGES.some((p) => req.path.startsWith(p))) return next();
  if (PORTE_OUVERTE.has(req.path)) return next();
  flags().then((f) => {
    if (!f.comptes || req.moi) return next();
    // 401 et pas 403 : ce n'est pas « interdit à vous », c'est « dis-moi qui tu
    // es ». L'écran sait faire la différence et n'affiche pas le même message.
    res.status(401).json({ error: 'Connecte-toi pour continuer.', connexion: true });
  }).catch(() => next());
});

// Refuse la route à qui n'a pas la capacité. C'est la garde de DERNIER recours :
// l'écran cache déjà ce qu'on ne peut pas faire, mais un écran n'est pas une
// permission — le patron le dit lui-même.
const exige = (capacite) => (req, res, next) => {
  if (peut(req.moi, capacite)) return next();
  res.status(403).json({
    error: `Réservé : ${ROLE_LABELS[req.moi.role]} n’a pas accès à cette action.`,
    capacite,
  });
};

// LES COLONNES D'ARGENT, retirées de la réponse pour qui n'a pas la capacité.
// C'est LA différence entre « cacher un bouton » et une permission : un
// opérateur qui ouvre les outils de son navigateur ne doit pas trouver le prix
// dans la réponse réseau. Le patron l'écrit noir sur blanc pour ce rôle-là.
const CHAMPS_ARGENT = ['project_value', 'acompte_demande', 'acompte_verse',
  'acompte_montant', 'acompte_date', 'paye', 'paiement_mode', 'cout_revient'];

// LE COÛT EST D'UN CRAN AU-DESSUS DU PRIX. La boutique doit voir le prix — elle
// le négocie et encaisse l'acompte — mais ce que l'atelier GAGNE sur chaque
// article ne la regarde pas, et le patron ne liste la marge que pour la
// Direction. Deux niveaux, donc deux filtres.
const CHAMPS_MARGE = ['cout_revient', 'marge_euros', 'marge_pct'];

function sansMarge(ligne) {
  const propre = { ...ligne };
  for (const c of CHAMPS_MARGE) delete propre[c];
  return propre;
}

function sansArgent(ligne) {
  const propre = { ...ligne };
  for (const c of CHAMPS_ARGENT) delete propre[c];
  // La fiche du comptoir porte le détail chiffré ligne à ligne : la vider à
  // moitié serait pire que la retirer, le récapitulatif deviendrait faux.
  if (propre.fiche && typeof propre.fiche === 'object') {
    const { paiement, prix, total, lot, ...reste } = propre.fiche;
    propre.fiche = { ...reste, ...(lot ? { lot } : {}) };
  }
  return propre;
}

// Un seul point de passage pour toutes les lectures de commande : ajouter une
// route plus tard sans y penser, c'est rouvrir le trou qu'on vient de fermer.
// LA MARGE SE CALCULE À LA LECTURE, elle ne se range pas : rangée, elle mentirait
// dès qu'un prix ou un coût bouge — et une marge fausse est pire qu'une marge
// absente, parce qu'on décide dessus.
//
// Le HT se déduit du TTC : c'est sur le HT que la marge se compte, la TGCA
// n'appartenant pas à l'atelier. Sans coût connu, PAS de marge — surtout pas
// zéro, qui se lirait « on ne gagne rien » là où on ne sait simplement pas.
function avecMarge(ligne, tgca) {
  const prix = Number(ligne.project_value);
  const cout = Number(ligne.cout_revient);
  if (!Number.isFinite(prix) || !Number.isFinite(cout) || ligne.cout_revient == null) return ligne;
  const ht = prix / (1 + tgca);
  const euros = Math.round((ht - cout) * 100) / 100;
  return {
    ...ligne,
    marge_euros: euros,
    marge_pct: ht > 0 ? Math.round((euros / ht) * 1000) / 10 : null,
  };
}

const selonMoi = (req, lignes) => {
  const un = (l) => {
    if (!peut(req.moi, 'argent')) return sansArgent(l);
    if (!peut(req.moi, 'marge')) return sansMarge(l);
    return avecMarge(l, PROJET_TGCA);
  };
  return Array.isArray(lignes) ? lignes.map(un) : un(lignes);
};

// --- Routes de session ---------------------------------------------------------

// Qui suis-je, et que puis-je ? L'écran s'en sert pour se composer.
app.get('/api/session', asyncH(async (req, res) => {
  const f = await flags();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    comptes: !!f.comptes,
    moi: req.moi ? { ...req.moi, label: ROLE_LABELS[req.moi.role] } : null,
    capacites: req.moi ? CAPACITES[req.moi.role] : null,
    // La liste des prénoms sert l'écran de connexion : on ne demande à personne
    // de taper son nom, on le lui fait choisir. Quatre personnes, quatre tuiles.
    equipe: f.comptes ? (await getUtilisateurs()).map((u) => ({
      prenom: u.prenom, role: u.role, label: ROLE_LABELS[u.role], aUnCode: u.a_un_code,
    })) : [],
  });
}));

// Ralentisseur de connexion, même principe que le mot de passe partagé : dix
// essais par prénom, puis l'attente. Sans lui, un code à quatre chiffres se
// devine en quelques minutes.
const echecsCode = new Map();
function tropDEssaisCode(prenom) {
  const e = echecsCode.get(prenom);
  return !!e && Date.now() < e.jusqua && e.n >= 10;
}
function compterEchecCode(prenom) {
  const e = echecsCode.get(prenom);
  const maintenant = Date.now();
  if (!e || maintenant > e.jusqua) echecsCode.set(prenom, { n: 1, jusqua: maintenant + 10 * 60000 });
  else echecsCode.set(prenom, { n: e.n + 1, jusqua: maintenant + 10 * 60000 });
}

app.post('/api/session', asyncH(async (req, res) => {
  const f = await flags();
  if (!f.comptes) return res.status(409).json({ error: 'Les comptes ne sont pas activés.' });
  const b = req.body || {};
  const prenom = typeof b.prenom === 'string' ? b.prenom.trim() : '';
  const code = typeof b.code === 'string' ? b.code : '';
  if (!prenom) return res.status(400).json({ error: 'Choisis ton prénom.' });
  if (tropDEssaisCode(prenom)) {
    res.set('Retry-After', '600');
    return res.status(429).json({ error: 'Trop d’essais. Réessaie dans quelques minutes.' });
  }
  const u = await getUtilisateurParPrenom(prenom);
  if (!u) return res.status(404).json({ error: 'Ce prénom n’est pas dans l’équipe.' });

  if (!u.code_hash) {
    // PREMIÈRE CONNEXION : la personne pose son code. Il n'y a pas d'écran
    // d'administration à traverser pour ça — à quatre personnes derrière un mot
    // de passe commun, en inventer un serait du travail pour rien.
    if (code.length < CODE_MIN || code.length > CODE_MAX) {
      return res.status(400).json({ error: `Choisis un code de ${CODE_MIN} chiffres au moins.` });
    }
    await poserCode(u.id, code);
  } else if (!codeCorrect(code, u.code_hash)) {
    compterEchecCode(prenom);
    return res.status(401).json({ error: 'Code incorrect.' });
  }

  echecsCode.delete(prenom);
  await toucherConnexion(u.id);
  const jeton = await signerJeton({
    u: u.id, p: u.prenom, r: u.role, e: Date.now() + SESSION_JOURS * 86400000,
  });
  // `HttpOnly` : le jeton n'est pas lisible en JavaScript, donc un script tiers
  // ne peut pas l'emporter. `SameSite=Lax` : il ne part pas sur une requête
  // venue d'un autre site. `Secure` seulement en production — en local, le site
  // est en http et un cookie `Secure` n'y serait jamais posé.
  res.setHeader('Set-Cookie', [
    `${COOKIE_SESSION}=${encodeURIComponent(jeton)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${SESSION_JOURS * 86400}`,
    ...(SUR_HTTPS ? ['Secure'] : []),
  ].join('; '));
  res.json({
    moi: { id: u.id, prenom: u.prenom, role: u.role, label: ROLE_LABELS[u.role] },
    capacites: CAPACITES[u.role],
    premiere: !u.code_hash,
  });
}));

app.delete('/api/session', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_SESSION}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Interrupteurs de fonctionnalité (voir FLAGS_CONNUS dans db.js).
// Ils décident ce qu'un poste AFFICHE, jamais ce que le serveur AUTORISE : un
// écran éteint côté interface reste atteignable par l'API. C'est volontaire à
// ce stade — ce sont des chantiers en cours, pas des droits. Le jour où les
// comptes existent, ce sont les RÔLES qui autorisent, et eux se vérifient ici.
// ---------------------------------------------------------------------------
app.get('/api/flags', asyncH(async (req, res) => {
  res.json({ flags: await getFlags(), connus: FLAGS_CONNUS });
}));

app.put('/api/flags', exige('reglages'), asyncH(async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Objet attendu' });
  }
  const etat = await setFlags(req.body);
  oublierFlags();
  // Chaque poste doit basculer sans qu'on aille le rouvrir un par un : c'est
  // tout l'intérêt d'un interrupteur central plutôt que d'un réglage local.
  broadcast({ kind: 'flags' });
  res.json({ flags: etat, connus: FLAGS_CONNUS });
}));

// ---------------------------------------------------------------------------
// Flux temps réel (SSE) — push instantané façon Google Sheets.
// Le serveur garde une connexion ouverte par client et diffuse un événement
// « change » à chaque création / modification / suppression. Aucune dépendance.
// ---------------------------------------------------------------------------
const sseClients = new Set();
// Un poste = une connexion. L'atelier en compte une dizaine, le patron une ou
// deux de plus : le plafond n'est pas là pour rationner, il est là pour qu'un
// client qui rouvrirait le flux en boucle (bug d'onglet, script) ne finisse pas
// par tenir toute la mémoire du serveur.
const SSE_CLIENTS_MAX = 100;
// Au-delà, le poste ne lit plus assez vite : ses évènements s'empilent dans la
// mémoire du serveur. Un poste éteint sans que le TCP l'ait signalé fait
// exactement ça, en silence, jusqu'à ce que le conteneur manque de mémoire.
const SSE_TAMPON_MAX = 512 * 1024;

app.get('/api/stream', (req, res) => {
  if (sseClients.size >= SSE_CLIENTS_MAX) {
    return res.status(503).json({ error: 'Trop de connexions temps réel' });
  }
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // désactive le buffering proxy (streaming immédiat)
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n'); // reconnexion auto côté navigateur
  // LA VERSION DU SITE, DÈS L'OUVERTURE DU FLUX — et c'est tout le mécanisme.
  // Un déploiement redémarre le conteneur : tous les flux tombent, chaque poste
  // rouvre le sien tout seul (`retry`) et reçoit ici l'empreinte du site QU'IL
  // VIENT DE NE PAS RECHARGER. Elle a changé → sa bulle s'allume. Aucun sondage,
  // aucune requête de plus : l'évènement voyage dans la connexion qui existait
  // déjà, une fois, à l'ouverture.
  res.write(`event: version\ndata: ${JSON.stringify({ version: VERSION_SITE })}\n\n`);

  sseClients.add(res);
  // heartbeat pour traverser les proxies (Railway) sans timeout
  const ping = setInterval(() => { if (!ecrireSse(res, ': ping\n\n')) clearInterval(ping); }, 25000);

  req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
  return undefined;
});

// Écrit sur un flux, et le lâche s'il ne suit plus. Renvoie false quand le
// client a été retiré. `res.write` ne lève RIEN quand le destinataire ne lit
// pas : il accepte, met en tampon, et le tampon grandit indéfiniment. C'est
// `writableLength` qu'il faut regarder, pas l'exception qui ne viendra pas.
function ecrireSse(res, frame) {
  try {
    if (res.writableEnded || res.destroyed) { sseClients.delete(res); return false; }
    if (res.writableLength > SSE_TAMPON_MAX) {
      sseClients.delete(res);
      res.end();
      return false;
    }
    res.write(frame);
    return true;
  } catch (_) {
    sseClients.delete(res);
    return false;
  }
}

function broadcast(payload) {
  const frame = `event: change\ndata: ${JSON.stringify(payload || {})}\n\n`;
  // Copie de la liste : `ecrireSse` retire les flux morts au passage, et on ne
  // modifie pas l'ensemble qu'on est en train de parcourir.
  for (const res of [...sseClients]) ecrireSse(res, frame);
}

// ---------------------------------------------------------------------------
// API REST
// ---------------------------------------------------------------------------

// Attribution des catégories à un employé (config du patron).
// GET  → { slugCatégorie: employé, ... }
// PUT  → remplace la config (corps = même forme). Diffusé en SSE pour que le
//        dashboard des autres postes se recalcule instantanément.
app.get('/api/category-owners', asyncH(async (req, res) => {
  res.json(await getCategoryOwners());
}));

app.put('/api/category-owners', exige('reglages'), asyncH(async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Objet { catégorie: employé } attendu' });
  }
  const saved = await setCategoryOwners(body);
  broadcast({ kind: 'category-owners' });
  res.json(saved);
}));

// Référents par catégorie (0..N employés sous le pilote de la catégorie).
// GET  → { slugCatégorie: [employé, ...], ... }
// PUT  → remplace la config (corps = même forme), diffusé en SSE.
app.get('/api/category-referents', asyncH(async (req, res) => {
  res.json(await getCategoryReferents());
}));

app.put('/api/category-referents', exige('reglages'), asyncH(async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Objet { catégorie: [employés] } attendu' });
  }
  const saved = await setCategoryReferents(body);
  broadcast({ kind: 'category-referents' });
  res.json(saved);
}));

// Registre des machines (réglages du patron : importance + durée de fab).
// GET  → [ { slug, name, importance, minutesPerUnit }, ... ]
// PUT  → remplace la liste (corps = tableau), diffusé en SSE pour que le
//        dashboard des autres postes recalcule la file « À faire maintenant ».
app.get('/api/machines', asyncH(async (req, res) => {
  res.json(await getMachines());
}));

app.put('/api/machines', exige('reglages'), asyncH(async (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Tableau de machines attendu' });
  }
  const saved = await setMachines(req.body);
  broadcast({ kind: 'machines' });
  res.json(saved);
}));

// Catalogue tarifs TASSE (réglages du patron : prix + temps par produit/option).
// GET  → [ { id, categorie, designation, prixAchat, prixVenteTtc, tempsMoMin,
//            tempsMachineMin, actif, position }, ... ]
// PUT  → remplace la liste (corps = tableau), diffusé en SSE pour que Nouveau
//        Projet et Réglages voient le même catalogue partout sans recharger.
app.get('/api/tarifs-tasse', asyncH(async (req, res) => {
  res.json(await getTarifsTasseArticles());
}));

const enregistrerTarifsTasse = asyncH(async (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Tableau d\'articles attendu' });
  }
  const saved = await setTarifsTasseArticles(req.body);
  broadcast({ kind: 'tarifs-tasse' });
  res.json(saved);
});
app.put('/api/tarifs-tasse', exige('reglages'), enregistrerTarifsTasse);
// POST accepté aussi : c'est la seule méthode que `navigator.sendBeacon` sait
// émettre, et c'est lui qui sauve la dernière correction quand on ferme
// l'onglet Réglages avant la fin du délai d'enregistrement (voir reglages.js).
app.post('/api/tarifs-tasse', exige('reglages'), enregistrerTarifsTasse);

// Paramètres globaux du calcul (taux horaires MO/machine, TGCA).
app.get('/api/tarifs-tasse/parametres', asyncH(async (req, res) => {
  res.json(await getTarifsTasseParametres());
}));

app.put('/api/tarifs-tasse/parametres', exige('reglages'), asyncH(async (req, res) => {
  const body = req.body || {};
  for (const key of ['tauxHoraireMo', 'tauxHoraireMachine', 'tgca']) {
    if (key in body && !Number.isFinite(Number(body[key]))) {
      return res.status(400).json({ error: `${key} doit être numérique` });
    }
  }
  const saved = await setTarifsTasseParametres(body);
  // Les taux servent AUSSI au calcul de marge, à chaque lecture de ligne : sans
  // ce rappel, la TGCA changée aux Réglages ne vaudrait qu'au prochain
  // redémarrage, et les marges affichées seraient celles d'avant.
  await chargerTaux();
  broadcast({ kind: 'tarifs-tasse' });
  res.json(saved);
}));

// LE CATALOGUE DU COMPTOIR (01/09/2026). Il vivait en dur dans
// `public/comptoir/catalogue.js` : familles, articles, variantes, et aucun
// prix — parce qu'un prix ne s'importe pas dans du code. Il est en base.
//
// GET est OUVERT, comme celui des tarifs tasse : les deux écrans du comptoir
// sont des documents à part qui le lisent au chargement pour remplir leur menu
// produits. Sans lui, la page s'ouvre sans rayon.
// GET → [ { id, famille, familleNote, designation, variante, note, label,
//           couleur, reference, prixAchat, prixVenteTtc, tempsMoMin,
//           tempsMachineMin, actif, position }, ... ]
app.get('/api/catalogue-produits', asyncH(async (req, res) => {
  res.json(await getCatalogueProduits());
}));

// PUT → remplace la liste (corps = tableau), comme la grille tarifaire tasse.
// C'est la porte de l'écran de réglages, celle qui corrige une case.
app.put('/api/catalogue-produits', exige('reglages'), asyncH(async (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Tableau de produits attendu' });
  }
  const saved = await setCatalogueProduits(req.body);
  broadcast({ kind: 'catalogue-produits' });
  res.json(saved);
}));

// L'IMPORT DE PRIX, EN DEUX TEMPS — et le premier n'écrit RIEN.
//
// « Rien ne s'écrit sur un import à moitié lu » : l'aperçu analyse le fichier
// ENTIER et rend ce qu'il ferait, ligne par ligne — combien créées, combien
// mises à jour, combien refusées et POURQUOI. C'est seulement au second appel,
// avec la SIGNATURE de cet aperçu, que la base bouge.
//
// Le format est du CSV UTF-8 (« Enregistrer sous » depuis Excel) : lire du
// .xlsx natif demanderait une quatrième dépendance au dépôt, qui n'en a que
// trois. Les intitulés de SumUp (« Category », « Item name », « Price ») sont
// reconnus tels quels — le patron n'a pas trois colonnes à renommer avant
// chaque import.
const csvDuCorps = (req) => (req.body && typeof req.body.csv === 'string' ? req.body.csv : null);

app.post('/api/catalogue-produits/import/apercu', exige('reglages'), asyncH(async (req, res) => {
  const csv = csvDuCorps(req);
  if (csv === null) return res.status(400).json({ error: 'Corps attendu : { csv: "…" }' });
  const rapport = await apercuImportCatalogue(csv);
  // Un fichier illisible n'est pas une PANNE du serveur : c'est une réponse,
  // et l'écran doit pouvoir l'afficher telle quelle plutôt qu'un « Erreur 500 »
  // qui n'apprend rien au patron.
  // `error` autant qu'`erreur` : c'est sous ce nom-là que toutes les autres
  // routes rendent un refus, et sous ce nom-là que les écrans le lisent.
  res.status(rapport.erreur ? 400 : 200).json({ ...rapport, error: rapport.erreur, ecrit: false });
}));

app.post('/api/catalogue-produits/import', exige('reglages'), asyncH(async (req, res) => {
  const csv = csvDuCorps(req);
  if (csv === null) return res.status(400).json({ error: 'Corps attendu : { csv: "…" }' });
  // LA SIGNATURE EST OBLIGATOIRE : c'est elle qui garantit qu'on n'écrit que ce
  // qui a été MONTRÉ. Sans elle, un appel direct écrirait un import que
  // personne n'a relu — exactement ce que cette route existe pour empêcher.
  const signature = String((req.body && req.body.signature) || '');
  if (!signature) {
    return res.status(400).json({ error: 'Signature de l’aperçu manquante : rien n’a été écrit.' });
  }
  const rapport = await appliquerImportCatalogue(csv, signature);
  if (rapport.erreur) return res.status(409).json({ ...rapport, error: rapport.erreur, ecrit: false });
  broadcast({ kind: 'catalogue-produits' });
  res.json(rapport);
}));

// SUPPLÉMENTS EXPRESS de la vente directe, par palier de délai (en pourcents).
// Réglage commercial, pas constante de code : il se change au comptoir, depuis
// l'écran, et vaut aussitôt pour tous les postes (d'où le SSE).
// GET → { j5, j10, j15 } · PUT { j5, j10, j15 } → barème retenu.
app.get('/api/supplements-express', asyncH(async (req, res) => {
  res.json(await getSupplementsExpress());
}));

app.put('/api/supplements-express', exige('reglages'), asyncH(async (req, res) => {
  const body = req.body || {};
  for (const key of ['j5', 'j10', 'j15']) {
    if (!(key in body)) continue;   // palier non envoyé = palier inchangé
    const brut = body[key];
    // `Number(null)` et `Number('')` valent 0 : sans ce garde-fou, un champ vide
    // s'enregistrerait comme « 0 % » — le supplément disparaîtrait du ticket
    // sans que personne n'ait demandé la gratuité.
    const n = brut === null || brut === '' ? NaN : Number(brut);
    // Un taux hors [0, 100] est une faute de frappe, pas une intention : on la
    // renvoie à l'écran plutôt que de la retomber en silence sur l'ancienne
    // valeur — la vendeuse croirait avoir enregistré son nouveau barème.
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return res.status(400).json({ error: `${key} : pourcentage attendu entre 0 et 100` });
    }
  }
  const saved = await setSupplementsExpress(body);
  broadcast({ kind: 'supplements-express' });
  res.json(saved);
}));

// TARIF DE TRANSPORT — euros HT par pièce, réglable depuis les Réglages.
// Il vivait figé dans le catalogue textile : le changer demandait un
// déploiement, alors qu'un tarif de transporteur bouge (et ne fait
// qu'augmenter). Le catalogue garde la LISTE des transports, cette table leur
// PRIX. Diffusé en SSE : les postes du comptoir chiffrent au nouveau tarif
// sans recharger.
app.get('/api/tarifs-transport', asyncH(async (req, res) => {
  res.json(await getTarifsTransport());
}));

app.put('/api/tarifs-transport', exige('reglages'), asyncH(async (req, res) => {
  const body = req.body || {};
  for (const [nom, brut] of Object.entries(body)) {
    if (brut === null || brut === '') continue;      // non envoyé = inchangé
    const n = Number(brut);
    // Un prix hors [0, 100] € la pièce est une faute de frappe, pas une
    // intention : on la renvoie à l'écran plutôt que de la laisser retomber en
    // silence sur l'ancienne valeur — le patron croirait avoir enregistré.
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return res.status(400).json({ error: `${nom} : prix en euros attendu entre 0 et 100` });
    }
  }
  const saved = await setTarifsTransport(body);
  broadcast({ kind: 'tarifs-transport' });
  res.json(saved);
}));

// Message WhatsApp « votre commande est prête » (réglage du patron, onglet
// Réglages). Le planning s'en sert pour pré-remplir WhatsApp au clic sur la
// pastille d'une ligne ; il n'envoie jamais rien tout seul.
// GET → { message } · PUT { message } → texte retenu, diffusé en SSE pour que
// les autres postes utilisent le nouveau texte sans recharger.
app.get('/api/settings/whatsapp', asyncH(async (req, res) => {
  res.json({ message: await getWhatsappMessage() });
}));

app.put('/api/settings/whatsapp', exige('reglages'), asyncH(async (req, res) => {
  const body = req.body || {};
  if (typeof body.message !== 'string') {
    return res.status(400).json({ error: 'Champ « message » (texte) attendu' });
  }
  if (body.message.length > WHATSAPP_MESSAGE_MAX) {
    return res.status(400).json({ error: `Message trop long (max ${WHATSAPP_MESSAGE_MAX} caractères)` });
  }
  const message = await setWhatsappMessage(body.message);
  broadcast({ kind: 'settings' });
  res.json({ message });
}));

// Coûts et cadences qui pilotent le chiffrage textile du comptoir. Ils valent
// pour l'atelier entier : deux postes ne doivent pas annoncer deux prix pour le
// même article. Les valeurs hors bornes sont ignorées, pas refusées — un poste
// resté sur l'ancien JS ne doit pas voir son enregistrement échouer en bloc.
// GET → réglages · PUT { … } → fusionne avec l'existant, diffusé en SSE.
app.get('/api/settings/textile', asyncH(async (req, res) => {
  res.json(await getReglagesTextile());
}));

app.put('/api/settings/textile', exige('reglages'), asyncH(async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Objet de réglages attendu' });
  }
  const reglages = await setReglagesTextile(body);
  broadcast({ kind: 'settings' });
  res.json(reglages);
}));

// L'IDENTITÉ DE L'ATELIER — ce qui signe le bon de commande. Elle vaut pour
// tous les postes : deux papiers sortis de deux PC ne peuvent pas annoncer deux
// adresses. Lecture ouverte (tout poste imprime), écriture réservée aux
// réglages.
app.get('/api/settings/entreprise', asyncH(async (req, res) => {
  res.json(await getEntreprise());
}));

app.put('/api/settings/entreprise', exige('reglages'), asyncH(async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Objet d’identité attendu' });
  }
  const entreprise = await setEntreprise(body);
  broadcast({ kind: 'settings' });
  res.json(entreprise);
}));

// LA PHRASE QUI JUSTIFIE UNE EXONÉRATION, par régime. Lecture ouverte (tout
// poste compose une facture), écriture réservée aux réglages — comme
// l'identité juste au-dessus, et pour la même raison : deux postes ne peuvent
// pas justifier la même exonération par deux textes différents.
//
// ⚠ NOUS N'EN INVENTONS AUCUNE : voir `getMentionsRegime` (db.js). Vide = rien
// ne s'imprime.
app.get('/api/settings/mentions-regime', asyncH(async (req, res) => {
  res.json(await getMentionsRegime());
}));

app.put('/api/settings/mentions-regime', exige('reglages'), asyncH(async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Objet de mentions attendu' });
  }
  const mentions = await setMentionsRegime(body);
  broadcast({ kind: 'settings' });
  res.json(mentions);
}));

// LE TABLEAU DES TAILLES DE LOGO. La largeur du logo à imprimer, par famille,
// par référence, par FACE et par taille — et chaque famille porte SES faces et
// SES tailles : un tote bag n'a pas les faces d'un t-shirt.
app.get('/api/tailles-logo', asyncH(async (req, res) => {
  res.json(await getTaillesLogo());
}));

// UNE CASE À LA FOIS. Le tableau se remplit case par case, à la main : envoyer
// le document entier à chaque frappe ferait perdre la colonne d'à côté si deux
// postes le remplissent en même temps. Une largeur vide EFFACE la case — c'est
// une action, pas un oubli.
app.patch('/api/tailles-logo', exige('reglages'), asyncH(async (req, res) => {
  const { famille, reference, face, taille, largeur } = req.body || {};
  try {
    const table = await majTailleLogo(famille, reference, face, taille, largeur);
    broadcast({ kind: 'settings' });
    res.json({ ...table, ...compterTaillesLogo(table) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// LES FAMILLES SE CRÉENT DEPUIS L'ÉCRAN. Un objet nouveau arrive à l'atelier :
// il lui faut sa catégorie le jour même, pas au prochain déploiement.
app.post('/api/tailles-logo/familles', exige('reglages'), asyncH(async (req, res) => {
  try {
    const table = await creerFamilleLogo((req.body || {}).nom, req.body);
    broadcast({ kind: 'settings' });
    res.status(201).json(table);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// Renommer la famille, ou changer SA liste de faces / de tailles. Retirer une
// face retire ses mesures : c'est le sens de l'action, et l'écran le demande.
app.patch('/api/tailles-logo/familles/:nom', exige('reglages'), asyncH(async (req, res) => {
  try {
    const table = await majFamilleLogo(req.params.nom, req.body || {});
    broadcast({ kind: 'settings' });
    res.json(table);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

app.delete('/api/tailles-logo/familles/:nom', exige('reglages'), asyncH(async (req, res) => {
  try {
    const table = await retirerFamilleLogo(req.params.nom);
    broadcast({ kind: 'settings' });
    res.json(table);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// ÉTAPES RANGÉES À LA MAIN. Glisser une carte réécrit les `position` en base :
// le geste vaut pour tous les postes. La décision « cette étape est rangée à la
// main » doit donc l'être aussi — sinon une vendeuse range sa liste et la
// tablette d'à côté n'en voit rien, jusqu'à basculer un jour d'un coup.
// GET → [slugÉtape, ...] · PUT [slugÉtape, ...] → liste retenue, diffusée en SSE.
app.get('/api/ordre-manuel', asyncH(async (req, res) => {
  res.json(await getOrdreManuel());
}));

// PUT { etape, range } → ne touche QUE cette étape, le serveur fusionne avec ce
// que les autres postes ont décidé (voir basculerOrdreManuel).
// PUT [slug, …]        → ancienne forme, remplacement intégral. Elle ne subsiste
//                        que pour l'onglet resté ouvert sur le JS d'avant le
//                        déploiement : le fichier garde son nom, donc une
//                        tablette peut encore l'envoyer pendant quelques minutes.
app.put('/api/ordre-manuel', exige('production'), asyncH(async (req, res) => {
  const b = req.body;
  if (b && !Array.isArray(b) && typeof b === 'object' && 'etape' in b) {
    if (!STAGE_SLUGS.includes(b.etape)) {
      return res.status(400).json({ error: `étape invalide: ${b.etape}` });
    }
    if (typeof b.range !== 'boolean') {
      return res.status(400).json({ error: 'Champ « range » (booléen) attendu' });
    }
    const fusionne = await basculerOrdreManuel(b.etape, b.range);
    broadcast({ kind: 'ordre-manuel' });
    return res.json(fusionne);
  }
  if (!Array.isArray(b)) {
    return res.status(400).json({ error: '{ etape, range } ou tableau de slugs attendu' });
  }
  const inconnu = b.find((s) => !STAGE_SLUGS.includes(s));
  if (inconnu !== undefined) return res.status(400).json({ error: `étape invalide: ${inconnu}` });
  const saved = await setOrdreManuel(b);
  broadcast({ kind: 'ordre-manuel' });
  return res.json(saved);
}));

// Toutes les colonnes de `requests`, écrites une à une. `r.*` serait plus court,
// mais il ramènerait la fiche ENTIÈRE et annulerait l'allègement ci-dessous.
// Une colonne ajoutée au schéma et oubliée ici disparaîtrait de la liste sans
// bruit : un test la compare à `information_schema` pour que ça ne puisse pas
// arriver.
const COLONNES_REQUEST = [
  'id', 'stage', 'sub_stage', 'order_kind', 'responsable', 'referent', 'priority',
  'client_type', 'billing_company', 'contact_referent', 'contact_phone', 'contact_email',
  'quantity', 'product', 'color', 'project_value', 'description', 'deadline',
  'acompte_demande', 'acompte_verse', 'acompte_montant', 'acompte_date', 'paye', 'paiement_mode',
  'flag', 'flag_reason', 'position', 'fiche', 'created_at', 'updated_at',
  // Un identifiant, donc 36 octets par ligne — et il gagne sa place : c'est lui
  // qui dit à la grille qu'une ligne appartient à un DOSSIER, donc qu'il y a une
  // page de projet à ouvrir et des articles voisins à montrer. Sans lui, il
  // faudrait un appel par ligne pour le découvrir.
  'project_id',
  // LE COÛT DE REVIENT. Il ne part QUE vers qui a le droit de voir les marges
  // (voir `sansArgent` / `sansMarge`) : c'est la donnée la plus sensible du
  // dossier — elle dit ce que l'atelier gagne, article par article.
  'cout_revient',
  // LE BAT : la grille en a besoin pour marquer les lignes qu'on ne doit pas
  // encore produire, et la fiche pour dire pourquoi le passage est refusé.
  'bat_requis', 'bat_valide_le',
  // LE DEVIS, en miroir : la carte en a besoin pour dire ce qui manque AVANT
  // qu'on tente de produire.
  'devis_requis', 'devis_valide_le',
  // La provenance de la demande, la date PRÉVUE par l'atelier (à ne pas
  // confondre avec la date souhaitée par le client) et le créneau de retrait.
  'provenance', 'date_prevue', 'retrait_creneau',
];

// LA LISTE NE LIT PLUS LA FICHE ENTIÈRE. `allegerFiche` n'en garde que quatre
// champs et les techniques : tout le reste — le récapitulatif ligne à ligne du
// comptoir, les contrôles, le paiement — était lu sur le disque par Postgres,
// sérialisé, transporté jusqu'à Node et analysé… pour être jeté à la ligne
// suivante. Une vraie fiche de vente pèse 3,6 Ko, dont 3,2 Ko de `client` +
// `details` : sur les 400 lignes d'une étape, ce sont 1,4 Mo lus pour en servir
// 330 Ko — à chaque rafraîchissement, pour chaque poste. On les retire donc DANS
// LA REQUÊTE, là où ça ne coûte rien.
// `techniquesDeLaFiche` ne lit que `textiles` / `articles` / `lignes` : aucune
// des clés retirées ici n'est nécessaire à la grille.
const FICHE_JETEE = ['client', 'details', 'controles', 'paiement'];
const FICHE_ALLEGEE_SQL = `(r.fiche ${FICHE_JETEE.map((k) => `- '${k}'`).join(' ')}) AS fiche`;
const CHAMPS_LISTE = [
  ...COLONNES_REQUEST.filter((c) => c !== 'fiche').map((c) => `r.${c}`),
  FICHE_ALLEGEE_SQL,
].join(', ');

// On expose seulement le nom de fichier des PDF (jamais les blobs) afin que la
// grille et le temps réel restent légers.
const JOINTURES_PDF = `FROM requests r
  LEFT JOIN attachments ad ON ad.request_id = r.id AND ad.kind = 'devis'
  LEFT JOIN attachments ab ON ab.request_id = r.id AND ab.kind = 'bat'
  LEFT JOIN attachments af ON af.request_id = r.id AND af.kind = 'facture'`;
const NOMS_PDF = `ad.filename AS devis_name,
    ab.filename AS bat_name,
    af.filename AS facture_name`;

const SELECT = `SELECT ${CHAMPS_LISTE},
    ${NOMS_PDF}
  ${JOINTURES_PDF}`;
// La MÊME lecture, fiche comprise : le tiroir de détail et le récapitulatif
// imprimable en ont besoin, et eux ne portent que sur UNE ligne.
const SELECT_COMPLET = `SELECT r.*,
    ${NOMS_PDF}
  ${JOINTURES_PDF}`;
const ORDER = 'ORDER BY r.position ASC NULLS LAST, r.priority DESC, r.deadline ASC NULLS LAST, r.created_at ASC';
// Le MÊME ordre, exactement à l'envers. Il sert à prendre la FIN d'une étape
// sans la lire en entier : on trie à rebours, on coupe, on remet à l'endroit.
// Écrit en toutes lettres plutôt que dérivé de `ORDER` par substitution : deux
// tris qui doivent rester le miroir l'un de l'autre se lisent côte à côte.
const ORDER_INVERSE = 'ORDER BY r.position DESC NULLS FIRST, r.priority ASC, r.deadline DESC NULLS FIRST, r.created_at DESC';

// La LISTE ne transporte de la fiche que ce que la grille affiche vraiment :
// le numéro de ticket et l'heure de retrait. Le reste — le récapitulatif ligne
// à ligne du comptoir, les contrôles, le paiement — pèse plusieurs kilo-octets
// PAR COMMANDE et repartait à chaque rafraîchissement, vers chaque poste, alors
// que seule la fiche ouverte en a besoin. Elle se charge donc à l'ouverture du
// tiroir (GET /api/requests/:id).
// `destination` : la famille (et la sous-étape) que la vendeuse a désignées au
// comptoir. Le dossier n'y va pas tout seul — il attend dans « Arrivées
// comptoir » — mais la grille en a besoin pour offrir le rangement en UN geste.
// `atelier` : la consigne de production écrite depuis le ticket. Elle est
// courte (500 caractères au plus) et la grille en a besoin pour marquer d'un
// point les lignes qui en portent une — sinon il faudrait ouvrir chaque fiche
// pour savoir laquelle parle à l'atelier.
// `lot` EST DANS LA LISTE, et doit y rester : c'est lui qui regroupe les lignes
// d'un même ticket sous une bannière et qui pose le « 2/4 » sur chaque carte.
// Retiré d'ici, il ne casse rien — les lignes se dispersent simplement dans le
// pipeline sans que plus personne ne voie qu'elles vont ensemble.
// `prod` EST DANS LA LISTE, et c'est tout son intérêt : référence, couleur,
// nombre par taille et largeur de logo par face — les quatre faits qui disent
// à l'atelier ce qu'il a à faire, lus sur la carte sans ouvrir le dossier. Il
// est court et borné (voir prodDuComptoir) ; retiré d'ici, la ligne redevient
// muette et il faut rouvrir chaque fiche pour savoir ce qu'on produit.
const FICHE_LISTE = ['kind', 'source', 'ref', 'heureSouhaitee', 'destination', 'atelier', 'lot', 'prod'];

// LES TECHNIQUES DE MARQUAGE, en clair : « dtf », « uv », « laser »…
// Le moteur de priorité s'en sert pour rattacher une commande à sa machine AVANT
// qu'elle n'arrive en production, et faire compter l'importance d'un poste
// goulot dès le chiffrage (voir machineOf dans priority.js). Il les cherchait
// dans `fiche.articles`, un tableau qu'aucun des trois flux n'a jamais produit
// — et que l'allègement ci-dessous aurait de toute façon retiré. La pondération
// « machine » ne pesait donc QUE sur les commandes déjà rangées dans une
// sous-étape de production : jamais avant, contrairement à ce qu'annonçait le
// code. On les extrait ici, une fois, dans la seule forme que la liste transporte.
function techniquesDeLaFiche(f) {
  const vues = new Set();
  const poser = (t) => {
    const id = t && typeof t === 'object' ? t.id : t;
    if (typeof id === 'string' && id && id !== 'a_definir') vues.add(id);
  };
  // Flux « commande atelier » (et l'ancienne forme `articles`) : zones du textile.
  for (const l of [...(f.textiles || []), ...(f.articles || [])]) {
    for (const z of (l && l.zones) || []) poser(z && z.technique);
  }
  // Flux « Nouveau Projet » : faces marquées de chaque ligne du panier.
  for (const l of f.lignes || []) {
    for (const face of (l && l.faces) || []) poser(face && face.technique);
  }
  return [...vues];
}

function allegerFiche(row) {
  const f = row.fiche;
  if (!f || typeof f !== 'object') return row;
  const court = {};
  for (const k of FICHE_LISTE) if (f[k] !== undefined) court[k] = f[k];
  const techniques = techniquesDeLaFiche(f);
  if (techniques.length) court.techniques = techniques;
  // `fichePartielle` dit au front que ce n'est qu'un résumé : il sait alors
  // qu'il doit aller chercher le détail avant d'ouvrir la fiche.
  court.fichePartielle = true;
  return { ...row, fiche: court };
}

// PLAFOND DE LA LISTE. Aucune commande ne quitte jamais le planning : « Paiement
// & clôture » est la dernière étape, et tout ce qui s'y termine y reste. La
// grille montait donc TOUTES les lignes de l'étape dans la page — une par une,
// avec leurs cellules, leurs écouteurs et leur poignée de glisser. Ça tient à
// deux cents lignes ; à deux mille, la tablette du comptoir se fige.
//
// On rend donc, par défaut, la FIN de la liste : les commandes récentes, celles
// qu'on vient consulter.
const LISTE_MAX = 400;

// ET LE PLAFOND NE SAUTE PLUS D'UN COUP. `?tout=1` rendait l'archive ENTIÈRE —
// mille deux cents lignes, cinquante mille nœuds montés dans la page d'une
// tablette, et un défilement qui reste poussif ensuite pour la journée. L'écran
// demande maintenant un palier de plus (`?max=800`, puis 1200…) : il en montre
// davantage quand on le lui demande, sans jamais tout avaler.
// `?tout=1` reste servi — un onglet resté ouvert sur le JS d'avant le
// déploiement peut encore l'envoyer, et l'export d'un poste tiers s'en sert.
const HAUT_PLAFOND = 5000;

function plafondDemande(query) {
  if (query.tout === '1') return null;                 // ancienne forme : sans plafond
  const n = Number(query.max);
  if (!Number.isFinite(n) || n <= LISTE_MAX) return LISTE_MAX;
  // On arrondit au palier : l'écran raisonne en « 400 de plus », le serveur ne
  // doit pas se retrouver à servir des tranches de taille arbitraire.
  return Math.min(Math.ceil(n / LISTE_MAX) * LISTE_MAX, HAUT_PLAFOND);
}

// Une lecture bornée renvoie UN élément de plus que le plafond : c'est ainsi que
// l'écran sait qu'il en reste, sans avoir à compter la table (même procédé que
// la recherche globale).
function bornerListe(rows, plafond) {
  const complet = rows.length <= plafond;
  return { lignes: complet ? rows : rows.slice(0, plafond), complet };
}

// GET /api/requests?stage=<étape>[&max=N] → commandes de cette étape (les N
//                                     dernières, N par paliers de 400)
// GET /api/requests                 → toutes les étapes, même plafond
//
// L'en-tête `X-Liste-Tronquee` dit à l'écran COMBIEN il a reçu quand la liste
// est coupée, et `X-Liste-Total` combien il y en a en tout : sans ce second
// chiffre, le pied de liste ne pouvait qu'annoncer « il en reste » sans jamais
// dire combien — donc sans qu'on sache si un clic de plus suffit. Le corps
// reste un simple tableau, que tous les appelants savent déjà lire.
app.get('/api/requests', asyncH(async (req, res) => {
  const { stage } = req.query;
  const plafond = plafondDemande(req.query);
  let rows;

  if (stage) {
    if (!STAGE_SLUGS.includes(stage)) return res.status(400).json({ error: `stage invalide: ${stage}` });
    if (plafond === null) {
      ({ rows } = await pool.query(`${SELECT} WHERE r.stage = $1 AND ${VIVANTES} ${ORDER}`, [stage]));
    } else {
      // On prend la fin de la liste — donc on trie À L'ENVERS pour la couper,
      // puis on remet l'ordre d'affichage. Prendre les premières aurait donné
      // les plus anciennes : exactement celles que personne ne vient voir.
      const r = await pool.query(
        `${SELECT} WHERE r.stage = $1 AND ${VIVANTES} ${ORDER_INVERSE} LIMIT $2`, [stage, plafond + 1],
      );
      const { lignes, complet } = bornerListe(r.rows, plafond);
      rows = lignes.reverse();
      if (!complet) {
        res.set('X-Liste-Tronquee', String(plafond));
        const { rows: n } = await pool.query(
          `SELECT COUNT(*)::int AS n FROM requests WHERE stage = $1 AND ${VIVANTES_NU}`, [stage],
        );
        res.set('X-Liste-Total', String(n[0].n));
      }
    }
  } else {
    const parEtape = 'r.stage, r.position ASC NULLS LAST, r.priority DESC, r.deadline ASC NULLS LAST, r.created_at ASC';
    if (plafond === null) {
      ({ rows } = await pool.query(`${SELECT} WHERE ${VIVANTES} ORDER BY ${parEtape}`));
    } else {
      // MÊME RÈGLE QUE PAR ÉTAPE : on rend la FIN de la liste. Le plafond
      // s'appliquait ici sur l'ordre normal, donc sur les PREMIÈRES lignes —
      // classées par étape, alphabétiquement : « demande_chiffrage » et
      // « facturation » remplissaient les 400 places et « production »,
      // « préparation » n'apparaissaient tout simplement jamais. Un appelant
      // sans `?stage=` recevait une réponse amputée sans rien qui le dise.
      const parEtapeInverse = 'r.stage DESC, r.position DESC NULLS FIRST, r.priority ASC, r.deadline DESC NULLS FIRST, r.created_at DESC';
      const r = await pool.query(
        `${SELECT} WHERE ${VIVANTES} ORDER BY ${parEtapeInverse} LIMIT $1`, [plafond + 1],
      );
      const { lignes, complet } = bornerListe(r.rows, plafond);
      rows = lignes.reverse();
      if (!complet) {
        res.set('X-Liste-Tronquee', String(plafond));
        const { rows: n } = await pool.query(`SELECT COUNT(*)::int AS n FROM requests WHERE ${VIVANTES_NU}`);
        res.set('X-Liste-Total', String(n[0].n));
      }
    }
  }

  res.json(selonMoi(req, rows.map(allegerFiche)));
}));

// GET /api/requests/synthese[?depuis=<ISO>] → CE QUI A CHANGÉ, et rien d'autre.
//
// Le Point du jour retéléchargeait TOUT le planning — toutes les commandes,
// depuis toujours — à chaque évènement temps réel, sur chaque poste. Un simple
// glisser-déposer chez une vendeuse déclenchait donc, chez tous les autres, le
// téléchargement de l'historique complet. C'est le « ça rame » qui restait après
// avoir mis les évènements en lot : on avait supprimé la rafale d'évènements,
// pas le poids de ce que chacun allait rechercher derrière.
//
// L'écran a besoin de l'ensemble du planning pour ses compteurs — mais pas de le
// RETÉLÉCHARGER. On rend donc :
//   - `ids`      : tous les identifiants, dans l'ordre. C'est ce qui permet de
//                  repérer une commande supprimée (elle n'y est plus) sans
//                  tenir de registre des suppressions. ~40 octets par ligne.
//   - `lignes`   : les commandes modifiées depuis `depuis`, en entier.
//   - `jusqua`   : l'horodatage à renvoyer au prochain appel. Il vient du
//                  SERVEUR, jamais de l'horloge du poste : deux montres qui
//                  divergent d'une seconde suffiraient à sauter une modification.
// Sans `depuis`, c'est un premier chargement : tout part, comme avant.
//
// LES CHAMPS SONT CEUX QUE LE POINT DU JOUR LIT, tous ceux-là et pas d'autres.
// Il en manquait deux, et les deux manquaient EN SILENCE :
//   - `contact_email` : sa recherche le cherche (même liste de champs que le
//     planning, c'était tout l'objet d'un correctif précédent). Absent d'ici,
//     chercher une adresse trouvait la commande au planning et rien ici.
//   - la TECHNIQUE de marquage : le moteur de priorité s'en sert pour rattacher
//     une commande à sa machine avant qu'elle n'arrive en production. La liste
//     a appris à la transporter à plat (voir allegerFiche) le jour même où le
//     Point du jour a cessé de lire la liste : la pondération « machine » n'a
//     donc jamais rien pesé. On ne remonte pas `fiche` pour autant — plusieurs
//     kilo-octets par commande pour une poignée de mots.
const SYNTHESE_CHAMPS = `r.id, r.stage, r.sub_stage, r.order_kind, r.responsable, r.referent,
  r.priority, r.client_type, r.billing_company, r.contact_referent, r.contact_phone,
  r.contact_email, r.quantity, r.product, r.color, r.project_value, r.description, r.deadline,
  r.flag, r.flag_reason, r.paye, r.acompte_verse, r.created_at, r.updated_at,
  ${FICHE_ALLEGEE_SQL}`;

// La fiche quitte la ligne, ses techniques restent. Une commande sans technique
// connue ne se voit pas inventer de fiche : `machineOf` doit pouvoir répondre
// « aucune machine » plutôt que de fouiller un objet vide.
function allegerSynthese(row) {
  const { fiche, ...reste } = row;
  const techniques = fiche && typeof fiche === 'object' ? techniquesDeLaFiche(fiche) : [];
  if (!techniques.length) return reste;
  return { ...reste, fiche: { techniques, fichePartielle: true } };
}

// L'EMPREINTE DE LA COMPOSITION. `ids` dit quelles commandes existent et dans
// quel ordre — c'est ce qui permet de repérer une suppression sans tenir de
// registre. Mais la composition ne bouge QUE quand une ligne naît, meurt ou
// change de place, alors que la liste repartait ENTIÈRE à chaque évènement : sur
// 1 500 commandes, 60 Ko d'identifiants rigoureusement identiques, vers chaque
// poste, pour la moindre pastille posée à l'autre bout de l'atelier. Et ça ne
// fait que grossir, aucune commande ne quittant jamais le planning.
// Le poste renvoie donc l'empreinte qu'il a reçue ; tant qu'elle correspond, on
// ne réexpédie pas la liste — il garde celle qu'il a déjà.
const empreinteIds = (ids) => crypto
  .createHash('sha1').update(ids.join(','), 'utf8').digest('hex').slice(0, 16);

// CE QUE LE POINT DU JOUR REGARDE, ET RIEN DE PLUS. Son écran ne parle que des
// quatre familles vivantes : « ce que chacun a à faire ce matin ». Tout ce qui
// est en « Paiement & clôture » ou en Fiverr, il l'ignore déjà, ligne par ligne
// (`isActive`, côté dashboard) — mais le serveur le lui envoyait quand même.
// Or c'est l'archive qui pèse, et elle seule grossit : à 1 500 commandes le
// premier chargement faisait 1 Mo, dont 800 Ko d'historique que personne ne
// regarde, et ça ne pouvait qu'empirer.
// Cette liste doit rester le MIROIR d'`ACTIVE_FAMILIES` (dashboard.js) : une
// famille ajoutée là-bas et oubliée ici serait vide sur le Point du jour, sans
// message ni erreur — un test compare les deux.
const SYNTHESE_FAMILLES = ['a_trier', 'demande_chiffrage', 'preparation', 'production', 'facturation'];
const SYNTHESE_FILTRE = `r.stage IN (${SYNTHESE_FAMILLES.map((s) => `'${s}'`).join(', ')}) AND ${VIVANTES}`;

app.get('/api/requests/synthese', asyncH(async (req, res) => {
  const depuis = typeof req.query.depuis === 'string' && req.query.depuis ? req.query.depuis : null;
  // `depuis` part droit dans une comparaison de timestamp : mal formé, Postgres
  // lève, et le Point du jour recevait « Erreur serveur » — donc plus aucune
  // mise à jour, sur un écran dont c'est la seule raison d'être. Une borne
  // illisible n'est pas une panne : c'est qu'on ne sait plus depuis quand, et la
  // réponse juste est de tout renvoyer plutôt que de ne rien renvoyer.
  const borne = depuis && Number.isFinite(Date.parse(depuis)) ? depuis : null;
  // L'horloge de référence est celle de la base, prise AVANT la lecture : une
  // écriture qui tomberait pendant la requête sera reprise au tour suivant
  // plutôt que sautée. Mieux vaut renvoyer deux fois une ligne que zéro fois.
  const { rows: horloge } = await pool.query('SELECT now() AS maintenant');
  const jusqua = horloge[0].maintenant;

  const { rows: idRows } = await pool.query(
    `SELECT id FROM requests r WHERE ${SYNTHESE_FILTRE}
     ORDER BY stage, position ASC NULLS LAST, created_at ASC`,
  );
  const ids = idRows.map((r) => r.id);
  const empreinte = empreinteIds(ids);
  // Même composition qu'au dernier passage de CE poste : il la connaît déjà.
  // Absente de la réponse, elle vaut « rien n'a changé de ce côté-là » — le
  // poste garde sa liste (voir fusionner, côté Point du jour).
  const memeComposition = req.query.empreinte === empreinte;

  let lignes;
  if (borne) {
    // LES LIGNES QUI VIENNENT DE QUITTER LE BORD PARTENT AUSSI. Elles ne sont
    // plus dans `ids`, donc elles disparaîtront du tableau — mais le fil
    // d'activité doit pouvoir dire « marquée traitée ✓ » plutôt que de les voir
    // s'évaporer. On ne filtre donc PAS sur la famille dans la mise à jour
    // incrémentale : ce qui a bougé depuis `depuis` est toujours peu de chose.
    const { rows } = await pool.query(
      `SELECT ${SYNTHESE_CHAMPS} FROM requests r WHERE r.updated_at >= $1 AND ${VIVANTES} ${ORDER}`, [borne],
    );
    lignes = rows;
  } else {
    // Premier chargement : il n'y a rien à comparer, donc rien à dire sur ce qui
    // a quitté le bord. On s'en tient à ce que l'écran affiche.
    const { rows } = await pool.query(
      `SELECT ${SYNTHESE_CHAMPS} FROM requests r WHERE ${SYNTHESE_FILTRE} ${ORDER}`,
    );
    lignes = rows;
  }

  res.json({
    jusqua,
    empreinte,
    ...(memeComposition ? {} : { ids }),
    lignes: selonMoi(req, lignes.map(allegerSynthese)),
  });
}));

// GET /api/requests/recherche?q=…  → LA RECHERCHE GLOBALE (palette « Spotlight »).
//
// Elle se faisait dans le navigateur : à la première frappe, le poste
// TÉLÉCHARGEAIT TOUT LE PLANNING — archives comprises, donc une liste qui ne
// cesse de grossir, à vie — pour filtrer dessus en mémoire. C'est le serveur qui
// filtre désormais, et il ne renvoie qu'une page de résultats.
//
// Mêmes champs et même règle qu'à l'écran : tous les jetons doivent apparaître,
// sans distinction de casse ni d'accent (« melina » trouve « Mélina »).
const RECHERCHE_CHAMPS = ['billing_company', 'contact_referent', 'product', 'color', 'description',
  'contact_phone', 'contact_email', 'responsable', 'referent', 'flag_reason'];
// LE NUMÉRO DU TICKET. C'est ce que le client rapporte au comptoir, et c'était
// le seul repère qu'aucune recherche ne regardait : taper « 26.08.06-003 » ne
// rendait rien, alors que ce numéro est écrit sur son papier. Il vit dans le
// JSON de la fiche, d'où l'extraction ici plutôt qu'une colonne dans la liste.
// `refTicket` est la référence du ticket DÉJÀ REMIS quand le dossier a dû être
// enregistré sous une autre : c'est celle que le client a en main.
const RECHERCHE_FICHE = ["r.fiche->>'ref'", "r.fiche->>'refTicket'"];
const RECHERCHE_MAX = 60;      // miroir de PALETTE_MAX côté écran
const RECHERCHE_JETONS_MAX = 8;
// `unaccent` est une extension, pas toujours installée (et absente de la base
// locale de test) : `translate` fait le même travail sur les lettres qui nous
// concernent, partout.
const ACCENTS = 'àâäáãåçéèêëíìîïñóòôöõùúûüýÿ';
const SANS_ACCENTS = 'aaaaaaceeeeiiiinooooouuuuyy';
const FOIN_RECHERCHE = `translate(lower(concat_ws(' ', ${[
  ...RECHERCHE_CHAMPS.map((c) => `r.${c}`), ...RECHERCHE_FICHE,
].join(', ')})), '${ACCENTS}', '${SANS_ACCENTS}')`;

const replier = (s) => String(s == null ? '' : s).toLowerCase()
  .normalize('NFD').replace(/\p{Diacritic}/gu, '');
// `strpos`, et surtout PAS `LIKE` : `%` et `_` y sont des jokers, et un client
// nommé « 100 % Coton » se cherche tel quel. Les échapper marchait, mais faisait
// dépendre le résultat des règles d'échappement du moteur — ce qui n'est pas la
// même chose d'une base à l'autre. Une recherche de sous-chaîne n'a pas de
// jokers du tout : rien à échapper, donc rien qui puisse diverger.
app.get('/api/requests/recherche', asyncH(async (req, res) => {
  const jetons = replier(req.query.q).split(/\s+/).filter(Boolean).slice(0, RECHERCHE_JETONS_MAX);
  if (!jetons.length) return res.json([]);
  const params = [...jetons];
  const conditions = jetons.map((_, i) => `strpos(${FOIN_RECHERCHE}, $${i + 1}) > 0`).join(' AND ');
  params.push(RECHERCHE_MAX + 1); // un de plus : l'écran sait dire « affine »
  const { rows } = await pool.query(
    `${SELECT} WHERE ${conditions} AND ${VIVANTES} ORDER BY r.updated_at DESC LIMIT $${params.length}`, params,
  );
  res.json(selonMoi(req, rows.map(allegerFiche)));
}));

// GET /api/requests/corbeille → ce qui a été retiré du planning, du plus récent
// au plus ancien. La SEULE lecture qui regarde volontairement l'archive.
//
// DÉCLARÉE AVANT `/:id`, et c'est obligatoire : Express prend la première route
// qui correspond, et « corbeille » se lirait sinon comme un identifiant — la
// réponse serait un 404, ou une erreur de type Postgres selon l'humeur.
// C'est la même règle que pour `recherche` et `synthese`, juste au-dessus.
//
// Bornée : la corbeille ne se vide jamais, et personne ne remonte au-delà des
// dernières erreurs de manipulation.
const CORBEILLE_MAX = 100;
app.get('/api/requests/corbeille', asyncH(async (req, res) => {
  const { rows } = await pool.query(
    `${SELECT} WHERE r.deleted_at IS NOT NULL ORDER BY r.deleted_at DESC LIMIT $1`, [CORBEILLE_MAX],
  );
  res.json(selonMoi(req, rows.map(allegerFiche)));
}));

// ===========================================================================
// L'AGENDA DES RETRAITS — qui vient chercher quoi, et quel jour (03/09/2026)
// ===========================================================================
// Demande de Charlie : « un agenda par jours, avec juste les noms des clients
// et les jours de retrait, pour que ma vendeuse en 1 regard puisse voir qui
// vient chercher quoi pour aujourd'hui, demain… ».
//
// LE JOUR DE RETRAIT, C'EST `deadline`. La colonne s'appelle « Date souhaitée »
// à l'écran : c'est le jour que le client a donné au comptoir, et c'est le seul
// des trois qui soit rempli. `date_prevue` et `retrait_creneau` ont été mesurées
// VIDES sur les 205 dossiers de production le 01/09 (voir schema.sql) — bâtir
// l'agenda dessus, c'est bâtir un écran vide. L'HEURE, elle, vit dans le JSON de
// la fiche (`heureSouhaitee`), que le comptoir remplit et que la fiche atelier
// édite : d'où l'extraction ici plutôt qu'une colonne de plus.
//
// CE QUI N'Y FIGURE PAS, ET POURQUOI :
//   · « Paiement & clôture » — le dossier est PARTI chez le client (le libellé
//     de la famille le dit) : plus personne ne vient le chercher ;
//   · « Commande récupérée » — il vient d'être remis, à la main, au comptoir ;
//   · Fiverr — de la sous-traitance graphiste, aucun client au comptoir ;
//   · l'archive (`deleted_at`) ;
//   · TOUS LES DEVIS — et c'est le correctif du 03/09 au soir.
//
// ===========================================================================
// IL N'Y A PLUS DE « DEMANDE » : IL Y A UN DEVIS, ET IL Y A UNE VENTE
// ===========================================================================
// Charlie, le 03/09 : « faut bien comprendre qu'il n'y a plus de demande, il y a
// maintenant devis et vente ».
//
// UN DEVIS N'EST PAS UN RETRAIT. Tant que le client n'a pas dit oui, rien n'est
// produit et personne ne vient rien chercher : un devis n'a pas sa place dans
// une liste de gens qui poussent la porte du comptoir. Une VENTE, si.
//
// LE MOT « demande » SURVIT DANS LA BASE, et seulement là : `order_kind` vaut
// encore `'demande'` / `'commande'`, et la famille s'appelle encore
// `demande_chiffrage` (« Demande & chiffrage » à l'écran). Ce sont des noms
// d'avant ; ce qu'ils désignent aujourd'hui, c'est DEVIS et VENTE. On les lit
// comme tels, on ne les renomme pas ici — renommer une valeur écrite sur 71
// dossiers vivants pour du vocabulaire, ce serait une migration pour rien.
//
// D'OÙ DEUX CONDITIONS, ET IL EN FAUT DEUX — c'est ce que la première écriture
// avait manqué :
//
//   1. LA FAMILLE « Demande & chiffrage » NE FIGURE JAMAIS. C'est le pipeline du
//      devis (reçu, à qualifier, à chiffrer, chiffrage en cours, devis envoyé,
//      devis validé) : rien n'y est produit.
//   2. UN DEVIS QUI ATTEND « À TRIER » NON PLUS. Depuis le 02/09, « Enregistrer »
//      sur le devis flash crée la ligne dans « À trier » — la même famille que
//      les ventes du comptoir. La famille ne suffit donc plus à distinguer : là,
//      c'est `order_kind` qui dit lequel des deux on regarde.
//
// ET SURTOUT, CE QUE CES DEUX RÈGLES NE FONT PAS : elles n'écartent PAS un
// dossier `order_kind = 'demande'` posé en préparation, en production ou en
// facturation. Un devis accepté DEVIENT une vente en entrant dans ces
// familles-là — c'est ce passage qui le fait entrer à l'agenda, pas un champ que
// quelqu'un devrait penser à changer. Mesuré sur la base de PRODUCTION le 03/09 :
// dix dossiers sont dans ce cas (six en préparation, quatre en production), et
// les écarter aurait vidé l'agenda de dossiers qu'on est en train de fabriquer.
//
// LES CHIFFRES, sur les 71 dossiers vivants du périmètre, le 03/09 :
//
//                                      avant   après
//     retraits datés                     41      28
//     dont EN RETARD                     18      12
//     dossiers sans date de retrait      30       7
//
// Les six retards que « Demande & chiffrage » apportait avaient 6, 32, 34, 36 et
// 37 jours, et cinq des six étaient créés en juin ou juillet : personne ne vient
// les chercher. Et les 23 dossiers sans date qu'elle apportait n'en manquaient
// pas — un devis n'A PAS de jour de retrait, c'est normal, et le compter comme
// un manque était un faux reproche affiché en permanence.
//
// LES DOSSIERS SANS DATE NE SONT PAS DES RETRAITS : ils ne peuvent se ranger
// sous aucun jour. On ne les renvoie pas — mais on les COMPTE, et l'écran le
// dit dans son en-tête. Les taire ferait lire l'agenda comme complet.
const AGENDA_FAMILLES = ['a_trier', 'preparation', 'production', 'facturation'];
const AGENDA_REMIS = 'commande_recuperee';
// `COALESCE` et pas `IS DISTINCT FROM` : les vieilles lignes (25 en production)
// ont un `order_kind` NUL, et `NULL <> 'demande'` vaut NULL — donc faux — ce qui
// les aurait toutes écartées de « À trier » en silence.
const AGENDA_FILTRE = `r.stage IN (${AGENDA_FAMILLES.map((s) => `'${s}'`).join(', ')})
  AND (r.stage <> 'a_trier' OR COALESCE(r.order_kind, '') <> 'demande')
  AND (r.sub_stage IS NULL OR r.sub_stage <> '${AGENDA_REMIS}')
  AND ${VIVANTES}`;

// GET /api/agenda → { lignes: [...], sansDate: n }
//
// La réponse ne porte QUE ce que l'agenda affiche : pas de prix (l'écran n'en
// montre aucun, et l'argent est réservé côté serveur), pas de fiche, pas de
// pièce jointe. Une ligne pèse ~150 octets là où la liste du planning en pèse
// dix fois plus — et cet écran se relit à chaque évènement temps réel.
app.get('/api/agenda', asyncH(async (req, res) => {
  const [{ rows: lignes }, { rows: sans }] = await Promise.all([
    pool.query(
      `SELECT r.id, r.stage, r.sub_stage, r.billing_company, r.client_type,
              r.quantity, r.product, r.deadline, r.flag, r.flag_reason,
              r.fiche->>'heureSouhaitee' AS heure
         FROM requests r
        WHERE ${AGENDA_FILTRE} AND r.deadline IS NOT NULL
        ORDER BY r.deadline ASC, (r.fiche->>'heureSouhaitee') ASC NULLS LAST,
                 r.billing_company ASC`,
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM requests r
        WHERE ${AGENDA_FILTRE} AND r.deadline IS NULL`,
    ),
  ]);
  res.json({ lignes, sansDate: sans[0] ? sans[0].n : 0 });
}));

// GET /api/requests/:id → UNE commande, fiche COMPLÈTE. C'est ce que le tiroir
// de détail et le récapitulatif imprimable vont chercher : le détail n'est
// chargé que pour la ligne qu'on ouvre, jamais pour les centaines d'autres.
app.get('/api/requests/:id', asyncH(async (req, res) => {
  // Une commande archivée n'a plus de tiroir : elle a quitté les écrans. Sans
  // ce filtre, un lien gardé ouvert dans un onglet rouvrait une fiche que
  // personne ne peut plus atteindre autrement — et qu'on pouvait modifier.
  const { rows } = await pool.query(`${SELECT_COMPLET} WHERE r.id = $1 AND ${VIVANTES}`, [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Commande introuvable' });
  res.json(selonMoi(req, rows[0]));
}));

// GET /api/requests/:id/marquage → CE QUE COÛTE CHAQUE EMPLACEMENT sur CE
// dossier-là (29/08). Charlie : « le prix est écrit en face de chaque
// personnalisation et s'ajoute ou se soustrait au devis ».
//
// L'ÉCART, PAS LE COÛT « EN SOI ». Le prix passe par deux arrondis au palier et
// par la majoration : ajouter un emplacement ne coûte donc pas la même chose
// selon ce qu'il y a déjà. On rejoue le moteur avec et sans, et on rend la
// différence — c'est très exactement ce que le devis fera.
//
// UNE REQUÊTE, ET SEULEMENT QUAND LA FICHE S'OUVRE : ces neuf recalculs n'ont
// aucune raison de voyager sur chaque ligne de la grille, à chaque
// rafraîchissement.
app.get('/api/requests/:id/marquage', asyncH(async (req, res) => {
  const { rows } = await pool.query(`${SELECT_COMPLET} WHERE r.id = $1 AND ${VIVANTES}`, [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Commande introuvable' });
  const f = rows[0].fiche;
  const ch = f && typeof f === 'object' ? f.chiffrage : null;
  const connus = chiffrage.emplacements();
  // Un dossier sans chiffrage — une tasse, une gravure, les 184 d'avant le
  // 28/08 — n'a pas de prix à faire bouger. On le DIT (`tarifable: false`)
  // plutôt que de rendre des zéros, qui se liraient comme « c'est gratuit ».
  const dispo = chiffrage.ecartsParEmplacement(chiffrage.bornerChiffrage(ch), await reglagesChiffrage());
  res.json(dispo
    ? { tarifable: true, connus, ...dispo }
    : { tarifable: false, connus, actuels: [], ttc: null, ecarts: {} });
}));

// GET /api/mon-travail → les trois listes de l'écran « Mon travail » (§25).
//
// « L'objectif : ouvrir le logiciel le matin et savoir immédiatement quoi
//   faire. » Donc trois listes et rien d'autre — pas de compteurs, pas de
//   graphique, pas de rappel de ce qui va bien.
//
// Le tri se fait ICI et pas au poste : c'est la même règle pour les quatre, et
// un opérateur ne doit pas recevoir tout le planning pour en garder six lignes.
//
// EN ATTENTE ≠ À FAIRE : une commande dont on attend le client, le fournisseur
// ou un BAT n'est pas du travail — la mettre dans « à faire » ferait une liste
// qu'on ne peut pas finir, donc une liste qu'on cesse de regarder.
const SOUS_ETAPES_ATTENTE = new Set([
  'devis_envoye', 'bat_envoye', 'attente_marchandise', 'client_prevenu', 'validation_acompte',
]);

app.get('/api/mon-travail', asyncH(async (req, res) => {
  // Sans comptes, « mon » n'a pas de sens : on prend le prénom du poste, qui est
  // ce que l'application sait de mieux. Avec, c'est l'identité qui tranche.
  const qui = req.moi ? req.moi.prenom : quiDemande(req);
  if (!qui) return res.json({ qui: null, aFaire: [], enAttente: [], finiAujourdhui: [] });

  const { rows } = await pool.query(
    `${SELECT} WHERE ${VIVANTES} AND (r.responsable = $1 OR r.referent = $1)
       AND r.stage IN ('a_trier','demande_chiffrage','preparation','production','facturation')
     ${ORDER}`, [qui],
  );
  const lignes = rows.map(allegerFiche);

  const enAttente = [];
  const aFaire = [];
  for (const l of lignes) {
    if (l.flag === 'bloque' || SOUS_ETAPES_ATTENTE.has(l.sub_stage)) enAttente.push(l);
    else aFaire.push(l);
  }

  // TERMINÉ AUJOURD'HUI se lit dans le journal, pas dans l'état des lignes :
  // l'état dit où elles SONT, pas ce que cette personne a fait. Le jour est
  // celui de l'ATELIER — en UTC, la journée basculerait à 20 h locales et la
  // liste se viderait en plein service.
  const debutJour = `${jourAtelier()}T00:00:00-04:00`;
  const { rows: faits } = await pool.query(
    `SELECT e.request_id, e.value_after, e.created_at, r.billing_company, r.client_type, r.product
       FROM request_events e JOIN requests r ON r.id = e.request_id
      WHERE e.who = $1 AND e.field = 'sub_stage' AND e.created_at >= $2
        AND r.deleted_at IS NULL
      ORDER BY e.created_at DESC LIMIT 40`, [qui, debutJour],
  );
  // Une commande poussée trois fois dans la journée ne fait qu'UNE ligne : la
  // liste raconte ce qui a avancé, pas combien de fois on a cliqué.
  const vues = new Set();
  const finiAujourdhui = [];
  for (const f of faits) {
    if (vues.has(f.request_id)) continue;
    vues.add(f.request_id);
    finiAujourdhui.push({
      id: f.request_id, billing_company: f.billing_company, client_type: f.client_type,
      product: f.product, sub_stage: f.value_after, quand: f.created_at,
    });
  }

  // LES ÉTAPES VIENNENT AVEC. Sans elles, l'écran dirait « Polos brodés » et
  // l'opérateur devrait ouvrir la fiche pour savoir laquelle des sept étapes lui
  // revient — c'est exactement le clic que cet écran est censé supprimer.
  // Un seul appel pour toutes les lignes : une requête par carte, sur une liste
  // qui se rafraîchit au temps réel, ce serait un aller-retour par battement.
  const idsVus = [...aFaire, ...enAttente].map((l) => l.id);
  let parLigne = new Map();
  if (idsVus.length) {
    const { rows: t } = await pool.query(
      'SELECT * FROM tasks WHERE request_id = ANY($1::uuid[]) ORDER BY ordre ASC', [idsVus],
    );
    for (const tache of t) {
      if (!parLigne.has(tache.request_id)) parLigne.set(tache.request_id, []);
      parLigne.get(tache.request_id).push(tache);
    }
  }
  const avecTaches = (liste) => selonMoi(req, liste).map((l) => ({
    ...l, taches: parLigne.get(l.id) || [],
  }));

  res.json({
    qui,
    aFaire: avecTaches(aFaire),
    enAttente: avecTaches(enAttente),
    finiAujourdhui,
  });
}));

// ---------------------------------------------------------------------------
// PROJETS ET TÂCHES (§1, §5, §10, §26, §27, §28, §29, §30)
//
// « CLIENT → PROJET → ARTICLE / LOT → TÂCHES. » Le client existait, les articles
// existaient. Entre les deux, rien ; en dessous, rien non plus.
//
// Un projet est un REGROUPEMENT, pas un passage obligé : une commande à un seul
// article n'a pas besoin d'un dossier, et toutes les lignes d'avant n'en ont
// pas. Une tâche appartient à UNE LIGNE — c'est-à-dire à un article — parce
// que c'est là que le patron pose la différence : le T-shirt a ses sept étapes,
// la gourde ses cinq.
// ---------------------------------------------------------------------------
const PROJET_NOM_MAX = 160;
const TACHE_MAX = 80;
const COMMENTAIRE_MAX = 500;

// Le total et l'avancement d'un projet ne se RANGENT pas : ils se recalculent.
// Rangés, ils se désynchronisent au premier article modifié ailleurs — et un
// total faux sur une page de projet est pire que pas de total du tout.
async function projetComplet(id, req) {
  const { rows: p } = await pool.query(
    `SELECT * FROM projects WHERE id = $1 AND ${VIVANTES_NU}`, [id],
  );
  if (!p.length) return null;
  const { rows: lignes } = await pool.query(
    `${SELECT} WHERE r.project_id = $1 AND ${VIVANTES} ${ORDER}`, [id],
  );
  const articles = lignes.map(allegerFiche);
  const ids = articles.map((a) => a.id);
  let taches = [];
  if (ids.length) {
    const { rows: t } = await pool.query(
      `SELECT * FROM tasks WHERE request_id = ANY($1::uuid[]) ORDER BY request_id, ordre ASC`, [ids],
    );
    taches = t;
  }
  // Le total n'est rendu qu'à qui a le droit de le voir. Le calculer puis le
  // retirer serait inutile ; ne pas le calculer du tout, c'est la même règle
  // que pour les colonnes d'argent — la donnée n'arrive pas.
  const total = peut(req.moi, 'argent')
    ? articles.reduce((s, a) => s + (Number(a.project_value) || 0), 0)
    : undefined;
  return {
    ...p[0],
    articles: selonMoi(req, articles),
    taches,
    ...(total === undefined ? {} : { total: Math.round(total * 100) / 100 }),
  };
}

app.get('/api/projets/:id', asyncH(async (req, res) => {
  const projet = await projetComplet(req.params.id, req);
  if (!projet) return res.status(404).json({ error: 'Projet introuvable' });
  res.json(projet);
}));

// PATCH /api/projets/:id → le nom, et surtout LA PROCHAINE ACTION (§5).
//
// « C'est une notion très importante. L'objectif est qu'un projet ne puisse pas
//   être oublié. » Elle ne se déduit pas de l'étape : l'étape dit où on en est,
//   la prochaine action dit ce qu'il faut faire — et « relancer le client »
//   n'est l'étape de personne.
const PROJET_PATCHABLE = ['nom', 'action', 'action_qui', 'action_date', 'action_faite'];
app.patch('/api/projets/:id', exige('clients'), asyncH(async (req, res) => {
  const b = req.body || {};
  const sets = [];
  const params = [];
  let i = 1;
  for (const champ of PROJET_PATCHABLE) {
    if (!(champ in b)) continue;
    let v = b[champ];
    if (champ === 'action_faite') v = v === true;
    else if (champ === 'action_date') v = isDay(v) ? v : null;
    else if (champ === 'action_qui') v = RESPONSABLE_SET.has(v) ? v : null;
    else v = borner(v, PROJET_NOM_MAX) || null;
    sets.push(`${champ} = $${i}`); params.push(v); i += 1;
  }
  if (!sets.length) return res.status(400).json({ error: 'rien à modifier' });
  sets.push('updated_at = now()');
  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE projects SET ${sets.join(', ')} WHERE id = $${i} AND ${VIVANTES_NU} RETURNING *`, params,
  );
  if (!rows.length) return res.status(404).json({ error: 'Projet introuvable' });
  broadcast({ kind: 'update', stages: [] });
  res.json(rows[0]);
}));

// POST /api/projets/:id/copie → refait le dossier à neuf (§29).
//
// « C'est essentiel pour les clients récurrents. » L'hôtel qui recommande les
// mêmes uniformes chaque saison ne doit pas les ressaisir article par article.
//
// CE QUI NE SE COPIE PAS, et c'est le fond du sujet : l'avancement. Un dossier
// dupliqué repart de zéro — étapes décochées, pas de paiement, pas de référence
// de ticket, pas de pièce jointe. Copier l'avancement donnerait une commande
// qui se croit à moitié faite alors que rien n'est produit, et c'est ainsi
// qu'on livre une caisse vide.
app.post('/api/projets/:id/copie', exige('clients'), asyncH(async (req, res) => {
  const { rows: p } = await pool.query(
    `SELECT * FROM projects WHERE id = $1 AND ${VIVANTES_NU}`, [req.params.id],
  );
  if (!p.length) return res.status(404).json({ error: 'Projet introuvable' });
  const { rows: articles } = await pool.query(
    `SELECT * FROM requests WHERE project_id = $1 AND ${VIVANTES_NU} ORDER BY position ASC`, [req.params.id],
  );
  if (!articles.length) return res.status(400).json({ error: 'Ce dossier n’a aucun article à copier' });

  const cx = await pool.connect();
  let neuf;
  try {
    await cx.query('BEGIN');
    const { rows: pr } = await cx.query(
      'INSERT INTO projects (nom, client_id, billing_company) VALUES ($1, $2, $3) RETURNING *',
      [`${p[0].nom} (copie)`, p[0].client_id, p[0].billing_company],
    );
    neuf = pr[0];
    const { rows: pos } = await cx.query(
      'SELECT COALESCE(MAX(position), 0) + 1000 AS pos FROM requests WHERE stage = $1',
      [articles[0].stage],
    );
    for (let i = 0; i < articles.length; i += 1) {
      const a = articles[i];
      // La fiche du comptoir part SANS son empreinte ni sa référence : ce sont
      // les deux clés d'idempotence du dossier d'origine. Les recopier ferait
      // passer la copie pour un renvoi de l'original — donc la ferait ignorer.
      const fiche = a.fiche && typeof a.fiche === 'object' ? { ...a.fiche } : null;
      if (fiche) { delete fiche.empreinte; delete fiche.ref; delete fiche.lot; }
      await cx.query(
        `INSERT INTO requests
           (stage, sub_stage, order_kind, responsable, referent, priority, client_type,
            billing_company, contact_referent, contact_phone, contact_email,
            quantity, product, color, project_value, description, deadline, position, fiche, project_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [a.stage, a.sub_stage, a.order_kind, a.responsable, a.referent, a.priority, a.client_type,
          a.billing_company, a.contact_referent, a.contact_phone, a.contact_email,
          a.quantity, a.product, a.color, a.project_value, a.description, null,
          Number(pos[0].pos) + i, fiche ? JSON.stringify(fiche) : null, neuf.id],
      );
    }
    await cx.query('COMMIT');
  } catch (err) {
    await cx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cx.release();
  }
  broadcast({ kind: 'update', stages: [articles[0].stage] });
  res.status(201).json(await projetComplet(neuf.id, req));
}));

// ---------------------------------------------------------------------------
// ARGENT : marge (§13), règles d'acompte (§21), pilotage (§24)
// ---------------------------------------------------------------------------

// Le libellé lisible d'une sous-étape, construit UNE fois : « prod_dtf » ne dit
// rien à personne sur un écran de pilotage.
const LIBELLE_SOUS_ETAPE = new Map(
  Object.values(SUB_STAGES).flat().map((s) => [s.slug, s.label]),
);

// GET /api/motifs-blocage → les sept motifs du §6, en clair.
//
// Le texte libre RESTE possible à côté : un blocage qui n'entre dans aucune
// case existe, et le forcer dans une case le rendrait invisible. Ce qu'on gagne,
// c'est de pouvoir compter — « quatre dossiers attendent le même fournisseur »
// est une information ; quatre phrases tapées à la main n'en sont pas une.
app.get('/api/motifs-blocage', (req, res) => res.json(MOTIFS_BLOCAGE));

app.get('/api/marges', asyncH(async (req, res) => res.json(await getMarges())));
app.put('/api/marges', exige('reglages'), asyncH(async (req, res) => {
  const saved = await setMarges(req.body);
  broadcast({ kind: 'marges' });
  res.json(saved);
}));

// LES RÈGLES D'ACOMPTE D'OLDA (§21), écrites une fois.
//
//   ≤ 100 €        → paiement intégral
//   > 100 €        → acompte de 50 %
//   Express / J    → paiement intégral
//
// Elles se CALCULENT, elles ne se rangent pas : rangées sur la ligne, elles
// mentiraient dès que le prix change — et c'est justement quand le prix change
// que la question « combien doit-il verser ? » se pose.
const ACOMPTE_SEUIL = 100;
const ACOMPTE_PART = 0.5;
function acompteAttendu(total, express) {
  const n = Number(total);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (express || n <= ACOMPTE_SEUIL) {
    return { montant: Math.round(n * 100) / 100, part: 1, motif: express ? 'Express ou Jour J : paiement intégral' : `Moins de ${ACOMPTE_SEUIL} € : paiement intégral` };
  }
  return {
    montant: Math.round(n * ACOMPTE_PART * 100) / 100,
    part: ACOMPTE_PART,
    motif: `Plus de ${ACOMPTE_SEUIL} € : acompte de ${Math.round(ACOMPTE_PART * 100)} %`,
  };
}

// GET /api/argent/:id → ce que CETTE commande doit rapporter, et où en est son
// règlement. Un seul endroit qui répond à « combien reste-t-il à encaisser ? ».
app.get('/api/argent/:id', exige('argent'), asyncH(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT project_value, acompte_montant, acompte_demande, acompte_verse, paye, cout_revient, deadline, created_at
       FROM requests WHERE id = $1 AND ${VIVANTES_NU}`, [req.params.id],
  );
  if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });
  const l = rows[0];
  const total = Number(l.project_value);
  // « Express » se déduit du délai réellement accordé : moins de trois jours
  // entre la prise et l'échéance, c'est la règle du catalogue (jour_j +20 %,
  // express sous 3 jours +10 %) — on ne redemande pas au poste de le dire.
  let express = false;
  if (l.deadline && l.created_at) {
    const jours = (Date.parse(String(l.deadline).slice(0, 10)) - Date.parse(String(l.created_at).slice(0, 10))) / 86400000;
    express = Number.isFinite(jours) && jours <= 3;
  }
  const attendu = acompteAttendu(total, express);
  const verse = l.acompte_verse ? (Number(l.acompte_montant) || 0) : 0;
  const marges = await getMarges();
  const ht = Number.isFinite(total) ? total / (1 + PROJET_TGCA) : null;
  const cout = l.cout_revient == null ? null : Number(l.cout_revient);
  const margeEuros = ht != null && cout != null ? Math.round((ht - cout) * 100) / 100 : null;
  const margePct = margeEuros != null && ht > 0 ? Math.round((margeEuros / ht) * 1000) / 10 : null;

  res.json({
    total: Number.isFinite(total) ? total : null,
    express,
    acompte: attendu,
    verse,
    reste: l.paye ? 0 : Math.round(((Number.isFinite(total) ? total : 0) - verse) * 100) / 100,
    paye: l.paye === true,
    // La marge n'est rendue qu'à la Direction, comme partout ailleurs.
    ...(peut(req.moi, 'marge') ? { marge: { euros: margeEuros, pct: margePct, ...marges } } : {}),
  });
}));

// GET /api/pilotage → l'écran de la Direction (§24).
//
// Il ne remplace PAS le Point du jour : celui-là est un écran d'ÉQUIPE, vidé
// exprès de tout ce qui n'est pas du travail. Le patron veut y voir le chiffre
// d'affaires et la marge ; les deux ont raison, mais pas sur le même écran.
// C'est donc un second écran, réservé, et le premier ne bouge pas.
app.get('/api/pilotage', exige('marge'), asyncH(async (req, res) => {
  const marges = await getMarges();
  const [enCours, bloques, retards, aEncaisser, machines] = await Promise.all([
    // CE QUI RENTRE : tout ce qui n'est pas soldé ni archivé porte encore de
    // l'argent à faire ou à encaisser.
    // LE CA PORTE SUR TOUT ; LA MARGE, SEULEMENT SUR CE QUI EST CHIFFRÉ.
    // Sommer le prix de huit lignes et le coût d'une seule donne une
    // « marge » de 92 % qui n'existe pas — c'est une soustraction entre deux
    // périmètres différents. Le `ca_chiffre` ci-dessous est donc le prix des
    // SEULES lignes qui portent un coût, et c'est de celui-là que la marge se
    // déduit. L'écran dit sur combien de lignes elle porte.
    pool.query(
      `SELECT COUNT(*)::int AS n,
              COALESCE(SUM(project_value), 0) AS ca,
              COALESCE(SUM(CASE WHEN cout_revient IS NOT NULL THEN project_value ELSE 0 END), 0) AS ca_chiffre,
              COALESCE(SUM(cout_revient), 0) AS cout,
              COUNT(cout_revient)::int AS chiffres
         FROM requests WHERE ${VIVANTES_NU} AND stage <> 'paiement'`,
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM requests WHERE ${VIVANTES_NU} AND flag = 'bloque'`,
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM requests
        WHERE ${VIVANTES_NU} AND deadline < $1 AND stage NOT IN ('paiement', 'facturation')`,
      [jourAtelier()],
    ),
    pool.query(
      `SELECT COALESCE(SUM(project_value), 0) - COALESCE(SUM(CASE WHEN acompte_verse THEN acompte_montant ELSE 0 END), 0) AS reste,
              COUNT(*)::int AS n
         FROM requests WHERE ${VIVANTES_NU} AND (paye IS NULL OR paye = false) AND project_value IS NOT NULL`,
    ),
    // LA CHARGE DE L'ATELIER : les minutes de production encore devant, par
    // machine. Sans `minutesPerUnit` réglé, une machine ne dit rien plutôt que
    // d'annoncer zéro — zéro se lirait « rien à faire ».
    pool.query(
      `SELECT sub_stage, COALESCE(SUM(quantity), 0)::int AS pieces, COUNT(*)::int AS lignes
         FROM requests WHERE ${VIVANTES_NU} AND stage = 'production' GROUP BY sub_stage`,
    ),
  ]);

  const ca = Math.round(Number(enCours.rows[0].ca) * 100) / 100;
  const cout = Math.round(Number(enCours.rows[0].cout) * 100) / 100;
  const ht = Math.round((ca / (1 + PROJET_TGCA)) * 100) / 100;
  const chiffrees = enCours.rows[0].chiffres;
  // La marge se calcule sur le MÊME périmètre que le coût : le prix des seules
  // lignes chiffrées. Sans aucune ligne chiffrée, elle vaut `null` — pas zéro,
  // qui se lirait « on ne gagne rien ».
  const htChiffre = Math.round((Number(enCours.rows[0].ca_chiffre) / (1 + PROJET_TGCA)) * 100) / 100;
  const margeEuros = chiffrees ? Math.round((htChiffre - cout) * 100) / 100 : null;

  // LA LISTE DES BLOQUÉS, pas seulement leur nombre. « La Direction doit avoir
  // un écran À DÉBLOQUER qui montre immédiatement les projets nécessitant une
  // intervention » (§6). Un compteur ne montre rien : il dit qu'il y a quatre
  // dossiers, pas lesquels ni pourquoi — donc il faut aller les chercher, et
  // c'est exactement le geste que cet écran doit supprimer.
  //
  // Triés du plus ANCIENNEMENT bloqué au plus récent : c'est celui qui attend
  // depuis le plus longtemps qui coûte le plus cher, pas le dernier arrivé.
  const { rows: aDebloquer } = await pool.query(
    `SELECT id, billing_company, client_type, product, flag_reason, responsable, deadline, updated_at, stage, sub_stage
       FROM requests WHERE ${VIVANTES_NU} AND flag = 'bloque'
      ORDER BY updated_at ASC LIMIT 30`,
  );

  res.json({
    aDebloquer: aDebloquer.map((l) => ({
      ...l, etape: LIBELLE_SOUS_ETAPE.get(l.sub_stage) || l.stage,
    })),
    marges,
    enCours: {
      lignes: enCours.rows[0].n, ca, ht, cout, chiffrees,
      marge: margeEuros,
      // Le pourcentage porte lui aussi sur le périmètre chiffré, et l'écran le
      // dit : « sur 3 des 8 lignes » n'est pas la même information que « 68 % ».
      margePct: margeEuros != null && htChiffre > 0
        ? Math.round((margeEuros / htChiffre) * 1000) / 10 : null,
    },
    bloques: bloques.rows[0].n,
    retards: retards.rows[0].n,
    aEncaisser: {
      montant: Math.round(Number(aEncaisser.rows[0].reste) * 100) / 100,
      lignes: aEncaisser.rows[0].n,
    },
    atelier: machines.rows.map((m) => ({
      sousEtape: m.sub_stage, libelle: LIBELLE_SOUS_ETAPE.get(m.sub_stage) || m.sub_stage,
      pieces: m.pieces, lignes: m.lignes,
    })),
  });
}));

// GET /api/modeles → les listes d'étapes toutes faites (§28).
app.get('/api/modeles', asyncH(async (req, res) => res.json(await getModeles())));
app.put('/api/modeles', exige('reglages'), asyncH(async (req, res) => {
  const saved = await setModeles(req.body);
  broadcast({ kind: 'modeles' });
  res.json(saved);
}));

// GET /api/requests/:id/taches → la liste d'étapes d'UN article.
app.get('/api/requests/:id/taches', asyncH(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM tasks WHERE request_id = $1 ORDER BY ordre ASC', [req.params.id],
  );
  res.json(rows);
}));

// POST /api/requests/:id/taches → pose une liste d'étapes, depuis un modèle ou
// à la main. REMPLACE la liste existante : deux poses successives ne doivent pas
// donner deux fois les mêmes étapes — c'est le premier réflexe de quelqu'un qui
// s'est trompé de modèle, et le résultat serait une liste inutilisable.
//
// Ce qui est DÉJÀ FAIT est conservé quand l'étape porte le même libellé : sinon
// changer de modèle en cours de route effacerait le travail de la matinée.
app.post('/api/requests/:id/taches', exige('production'), asyncH(async (req, res) => {
  const b = req.body || {};
  let etapes = [];
  if (typeof b.modele === 'string') {
    const modele = (await getModeles()).find((m) => m.id === b.modele);
    if (!modele) return res.status(400).json({ error: `modèle inconnu : ${b.modele}` });
    etapes = modele.etapes;
  } else if (Array.isArray(b.etapes)) {
    etapes = b.etapes.map((e) => borner(e, TACHE_MAX)).filter(Boolean).slice(0, 20);
  }
  if (!etapes.length) return res.status(400).json({ error: 'aucune étape à poser' });

  const { rows: ligne } = await pool.query(
    `SELECT quantity FROM requests WHERE id = $1 AND ${VIVANTES_NU}`, [req.params.id],
  );
  if (!ligne.length) return res.status(404).json({ error: 'Commande introuvable' });

  const { rows: avant } = await pool.query(
    'SELECT libelle, fait, qui, fait_at, qte_faite, perte, commentaire FROM tasks WHERE request_id = $1',
    [req.params.id],
  );
  const dejaFait = new Map(avant.filter((t) => t.fait).map((t) => [t.libelle, t]));

  const cx = await pool.connect();
  let posees = [];
  try {
    await cx.query('BEGIN');
    await cx.query('DELETE FROM tasks WHERE request_id = $1', [req.params.id]);
    for (let k = 0; k < etapes.length; k += 1) {
      const garde = dejaFait.get(etapes[k]);
      const { rows } = await cx.query(
        `INSERT INTO tasks (request_id, ordre, libelle, fait, qui, fait_at, qte_prevue, qte_faite, perte, commentaire)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.params.id, k, etapes[k], !!garde, garde ? garde.qui : null,
          garde ? garde.fait_at : null, ligne[0].quantity,
          garde ? garde.qte_faite : null, garde ? garde.perte : null,
          garde ? garde.commentaire : null],
      );
      posees.push(rows[0]);
    }
    await cx.query('COMMIT');
  } catch (err) {
    await cx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cx.release();
  }
  broadcast({ kind: 'update', stages: [] });
  res.status(201).json(posees);
}));

// PATCH /api/taches/:id → cocher une étape, et déclarer ce qui s'est passé.
//
// « Prévu : 50, produit : 49, perte : 1 » (§26) et le contrôle qualité (§27)
// passent tous les deux par ici : l'étape « Contrôle » est une tâche comme une
// autre, ce sont ses quantités qui disent ce qu'elle a trouvé.
//
// C'est la SEULE écriture ouverte à l'opérateur au-delà de la sous-étape : c'est
// exactement son travail, et le patron le liste mot pour mot.
app.patch('/api/taches/:id', exige('travailler'), asyncH(async (req, res) => {
  const b = req.body || {};
  const sets = [];
  const params = [];
  let i = 1;
  const entier = (v) => {
    if (v == null || v === '') return null;
    const n = Number.parseInt(v, 10);
    return Number.isInteger(n) && n >= 0 && n <= 999999 ? n : undefined;
  };

  if ('fait' in b) {
    const fait = b.fait === true;
    sets.push(`fait = $${i}`); params.push(fait); i += 1;
    // L'heure et le nom se posent AVEC la case, pas à côté : une étape cochée
    // sans savoir par qui ni quand ne répond à aucune des questions qu'on se
    // pose en rouvrant le dossier.
    sets.push(`qui = $${i}`); params.push(fait ? quiDemande(req) : null); i += 1;
    sets.push(`fait_at = ${fait ? 'now()' : 'NULL'}`);
  }
  for (const champ of ['qte_faite', 'perte']) {
    if (!(champ in b)) continue;
    const v = entier(b[champ]);
    if (v === undefined) return res.status(400).json({ error: `${champ} doit être un nombre entier` });
    sets.push(`${champ} = $${i}`); params.push(v); i += 1;
  }
  if ('commentaire' in b) {
    sets.push(`commentaire = $${i}`); params.push(borner(b.commentaire, COMMENTAIRE_MAX) || null); i += 1;
  }
  if (!sets.length) return res.status(400).json({ error: 'rien à modifier' });
  sets.push('updated_at = now()');
  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params,
  );
  if (!rows.length) return res.status(404).json({ error: 'Étape introuvable' });

  // LA LIGNE EST TOUCHÉE, elle aussi : sans ça, cocher une étape ne change pas
  // `updated_at` et le temps réel ne dit rien — l'écran d'à côté garde une case
  // décochée jusqu'au prochain rafraîchissement complet.
  const { rows: ligne } = await pool.query(
    'UPDATE requests SET updated_at = now() WHERE id = $1 RETURNING stage', [rows[0].request_id],
  );
  broadcast({ kind: 'update', stages: ligne.length ? [ligne[0].stage] : [] });
  res.json(rows[0]);
}));

// GET /api/counts → { slug: n, ... } : objet plat mêlant FAMILLES et SOUS-FAMILLES
// (leurs slugs ne se chevauchent jamais). La sidebar lit counts[familleSlug] pour
// le total d'une famille et counts[sousSlug] pour chaque sous-catégorie. Le total
// famille inclut les commandes « à préciser » (sub_stage null), donc il peut être
// supérieur à la somme des sous-catégories : c'est voulu.
app.get('/api/counts', asyncH(async (req, res) => {
  const counts = {};
  for (const s of STAGE_SLUGS) counts[s] = 0;
  for (const s of SUB_SLUGS) counts[s] = 0;

  // Les deux agrégats sont indépendants : en série, chaque poste payait deux
  // allers-retours Postgres à CHAQUE évènement temps réel (loadCounts est
  // systématique dans le poll). En parallèle, un seul temps d'attente.
  const [{ rows: byStage }, { rows: bySub }] = await Promise.all([
    pool.query(`SELECT stage, COUNT(*)::int AS n FROM requests WHERE ${VIVANTES_NU} GROUP BY stage`),
    pool.query(`SELECT sub_stage, COUNT(*)::int AS n FROM requests
      WHERE sub_stage IS NOT NULL AND ${VIVANTES_NU} GROUP BY sub_stage`),
  ]);
  for (const r of byStage) if (r.stage in counts) counts[r.stage] = r.n;
  for (const r of bySub) if (SUB_SLUGS.has(r.sub_stage)) counts[r.sub_stage] = r.n;

  res.json(counts);
}));

// LE BAT SE MARQUE TOUT SEUL. Demander à quelqu'un de cocher « ce dossier a un
// BAT » revient à ne jamais l'avoir : entrer dans une étape qui parle de BAT,
// c'est en avoir un. Et le valider, c'est le dater.
//
// APPELÉ DEPUIS LA CRÉATION *ET* DEPUIS LA MODIFICATION. Posé sur le seul
// PATCH, le verrou ne s'armait pas sur une ligne CRÉÉE directement à une étape
// de BAT — c'est-à-dire sur tout dossier venu du comptoir avec une destination.
// Le verrou paraissait alors fonctionner et laissait passer la moitié des cas.
const ETAPES_BAT = new Set(['prepa_bat', 'bat_envoye', 'bat_modif', 'bat_valide']);
// LE DEVIS SUIT LA MÊME RÈGLE (26/08). Un dossier qui traverse le chiffrage en
// exige un ; « Devis validé » pose la date. Ce sont les mêmes trois lignes que
// pour le BAT, et pour la même raison : personne n'a à cocher une case.
const ETAPES_DEVIS = new Set(['chiffrage_en_cours', 'devis_envoye', 'devis_valide']);

async function marquerBat(id, sousEtape) {
  if (!ETAPES_BAT.has(sousEtape)) return;
  const valide = sousEtape === 'bat_valide';
  await pool.query(
    `UPDATE requests SET bat_requis = true
       ${valide ? ', bat_valide_le = COALESCE(bat_valide_le, now())' : ''}
     WHERE id = $1`, [id],
  ).catch(() => { /* le verrou est un garde-fou, pas une raison de faire échouer */ });
}

async function marquerDevis(id, sousEtape) {
  if (!ETAPES_DEVIS.has(sousEtape)) return;
  const valide = sousEtape === 'devis_valide';
  await pool.query(
    `UPDATE requests SET devis_requis = true
       ${valide ? ', devis_valide_le = COALESCE(devis_valide_le, now())' : ''}
     WHERE id = $1`, [id],
  ).catch(() => { /* garde-fou, jamais une raison de faire échouer la requête */ });
}

// POST /api/requests → crée (corps partiel autorisé)
app.post('/api/requests', exige('clients'), asyncH(async (req, res) => {
  const body = normalizeFlagBody(req.body || {});
  const incoherence = verifierCoherenceEtape(body, body.stage || 'demande_chiffrage');
  if (incoherence) return res.status(400).json({ error: incoherence });
  const cols = [];
  const vals = [];
  const params = [];
  let i = 1;

  for (const key of PATCHABLE) {
    if (key in body) {
      const v = validateField(key, body[key]);
      if (!v.ok) return res.status(400).json({ error: v.error });
      cols.push(key);
      vals.push(`$${i++}`);
      params.push(v.value);
    }
  }

  // position par défaut : place la nouvelle ligne en bas de son étape.
  if (!cols.includes('position')) {
    const stage = body.stage && STAGE_SLUGS.includes(body.stage) ? body.stage : 'demande_chiffrage';
    const { rows } = await pool.query(
      'SELECT COALESCE(MAX(position), 0) + 1000 AS pos FROM requests WHERE stage = $1', [stage],
    );
    cols.push('position');
    vals.push(`$${i++}`);
    params.push(rows[0].pos);
  }

  let query;
  if (cols.length === 0) {
    query = 'INSERT INTO requests DEFAULT VALUES RETURNING *';
    const { rows } = await pool.query(query);
    broadcast({ kind: 'create', stages: [rows[0].stage] });
    return res.status(201).json(rows[0]);
  }
  query = `INSERT INTO requests (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *`;
  const { rows } = await pool.query(query, params);
  await marquerBat(rows[0].id, rows[0].sub_stage);
  await marquerDevis(rows[0].id, rows[0].sub_stage);
  broadcast({ kind: 'create', stages: [rows[0].stage] });
  res.status(201).json({
    ...rows[0],
    ...(ETAPES_BAT.has(rows[0].sub_stage) ? { bat_requis: true } : {}),
    ...(ETAPES_DEVIS.has(rows[0].sub_stage) ? { devis_requis: true } : {}),
  });
}));

// POST /api/requests/:id/copie → recopie une commande (« Dupliquer », « Envoyer
// vers Fiverr »), éventuellement dans une autre famille (`{ stage }`).
//
// La copie se fait ICI et pas côté navigateur : le front renvoyait champ par
// champ ce qu'il avait à l'écran, or la liste ne transporte qu'un RÉSUMÉ de
// `fiche` (voir allegerFiche) et `fiche` n'est pas — volontairement — un champ
// que l'on peut écrire par PATCH. La copie repartait donc sans le récapitulatif
// du comptoir : l'atelier héritait d'une commande vide de tout ce qu'il doit
// produire (articles, tailles, faces marquées, heure de retrait).
//
// Ce qui ne se copie PAS : les pièces jointes (devis / BAT / facture appartiennent
// au dossier d'origine), l'alerte (`flag` / `flag_reason` — une copie repart d'une
// page blanche) et le numéro de ticket `fiche.ref`, qui identifie UNE prise de
// commande au comptoir : deux lignes ne peuvent pas revendiquer le même.
const COPIABLE = PATCHABLE.filter((k) => !['position', 'flag', 'flag_reason'].includes(k));

app.post('/api/requests/:id/copie', exige('clients'), asyncH(async (req, res) => {
  const { rows: src } = await pool.query(
    `SELECT * FROM requests WHERE id = $1 AND ${VIVANTES_NU}`, [req.params.id],
  );
  if (src.length === 0) return res.status(404).json({ error: 'Commande introuvable' });
  const source = src[0];

  const stage = req.body && req.body.stage ? req.body.stage : source.stage;
  if (!STAGE_SLUGS.includes(stage)) return res.status(400).json({ error: `stage invalide: ${stage}` });
  // Changer de famille invalide la sous-étape : on ne transporte pas
  // « Production UV » dans « Facturation ».
  const subStage = stage === source.stage ? source.sub_stage : null;

  const cols = [];
  const vals = [];
  const params = [];
  let i = 1;
  const poser = (col, valeur) => { cols.push(col); vals.push(`$${i++}`); params.push(valeur); };

  for (const key of COPIABLE) {
    if (key === 'stage' || key === 'sub_stage') continue;
    poser(key, source[key] ?? null);
  }
  poser('stage', stage);
  poser('sub_stage', subStage);

  // Selon le pilote (Postgres / pg-mem), une colonne JSON revient en objet ou
  // en texte : on accepte les deux plutôt que de perdre le détail sur l'un.
  let fiche = source.fiche;
  if (typeof fiche === 'string') {
    try { fiche = JSON.parse(fiche); } catch (_) { fiche = null; }
  }
  if (fiche && typeof fiche === 'object') {
    const { ref, ...reste } = fiche;
    poser('fiche', JSON.stringify(reste));
  }

  const { rows: pos } = await pool.query(
    'SELECT COALESCE(MAX(position), 0) + 1000 AS pos FROM requests WHERE stage = $1', [stage],
  );
  poser('position', pos[0].pos);

  const { rows } = await pool.query(
    `INSERT INTO requests (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *`, params,
  );
  broadcast({ kind: 'create', stages: [rows[0].stage] });
  res.status(201).json(allegerFiche(rows[0]));
}));

// PATCH /api/requests/positions → RANGE TOUTE UNE ÉTAPE EN UNE FOIS.
// Corps : [{ id, position }, …]
//
// Glisser une seule carte renumérote toute la famille (voir commitReorder) : le
// navigateur envoyait donc un PATCH PAR LIGNE. Sur une étape de quarante
// commandes, un geste produisait quarante requêtes, quarante écritures, et
// surtout QUARANTE ÉVÈNEMENTS temps réel — que chaque poste connecté payait en
// rechargeant sa grille, son dashboard et la fiche ouverte. C'était le « ça
// rame » de la tablette : un geste, une tempête.
// Ici : une requête, une transaction, UN seul évènement.
const REORDER_MAX = 500; // une étape n'en tient pas tant ; au-delà c'est une erreur
app.patch('/api/requests/positions', exige('production'), asyncH(async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : null;
  if (!list) return res.status(400).json({ error: 'Tableau [{ id, position }] attendu' });
  if (list.length === 0) return res.json({ misAJour: 0 });
  if (list.length > REORDER_MAX) return res.status(400).json({ error: `trop de lignes (${REORDER_MAX} maximum)` });

  for (const item of list) {
    if (!item || typeof item !== 'object') return res.status(400).json({ error: '{ id, position } attendu' });
    if (!UUID_RE.test(String(item.id))) return res.status(400).json({ error: `identifiant invalide : ${item.id}` });
    const v = validateField('position', item.position);
    if (!v.ok) return res.status(400).json({ error: v.error });
  }

  // TOUT ou RIEN, et surtout EN UNE SEULE REQUÊTE. La transaction faisait un
  // aller-retour SQL par ligne : sur une étape de quatre cents commandes, le
  // verrou restait tenu plusieurs centaines de millisecondes, pendant
  // lesquelles toute écriture concurrente sur ces lignes attendait — le poste
  // d'à côté « ramait » exactement le temps du rangement du voisin. Un seul
  // UPDATE à CASE tient le verrou le temps d'une requête, pas d'une boucle.
  // (La forme `FROM (VALUES …)` est plus élégante, mais pg-mem — la base des
  // tests — y rend RETURNING vide : le CASE se comporte, lui, à l'identique
  // sur les deux moteurs.)
  const etapes = new Set();
  {
    const params = [];
    const cas = list.map((item) => {
      params.push(item.id, Number(item.position));
      return `WHEN $${params.length - 1}::uuid THEN $${params.length}::int`;
    });
    const ids = list.map((_, i) => `$${params.length + i + 1}::uuid`);
    params.push(...list.map((item) => item.id));
    const { rows } = await pool.query(
      `UPDATE requests SET position = CASE id ${cas.join(' ')} END, updated_at = now()
       WHERE id IN (${ids.join(', ')}) RETURNING stage`,
      params,
    );
    for (const r of rows) etapes.add(r.stage);
  }

  // La `position` n'est pas journalisée (un seul glisser en réécrit une dizaine,
  // le journal se remplirait de bruit) — même règle qu'au PATCH unitaire.
  broadcast({ kind: 'update', stages: [...etapes] });
  res.json({ misAJour: list.length });
}));

// PATCH /api/requests/:id → met à jour un ou plusieurs champs
app.patch('/api/requests/:id', asyncH(async (req, res) => {
  // On relit la ligne AVANT toute chose : elle sert à trois usages — savoir si
  // la famille change (pour remettre la sous-étape à zéro), vérifier que la
  // sous-étape demandée relève bien de cette famille, et fournir l'« avant » du
  // journal des modifications.
  const { rows: avant } = await pool.query(
    `SELECT * FROM requests WHERE id = $1 AND ${VIVANTES_NU}`, [req.params.id],
  );
  if (avant.length === 0) return res.status(404).json({ error: 'Commande introuvable' });

  const body = effacerSousEtapeSiChangementDeFamille(
    normalizeFlagBody(req.body || {}), avant[0].stage,
  );
  const incoherence = verifierCoherenceEtape(body, avant[0].stage);
  if (incoherence) return res.status(400).json({ error: incoherence });

  // LE VERROU DU BAT (§20). « La production ne doit normalement commencer
  // qu'après validation. La Direction peut forcer le passage si nécessaire. »
  //
  // Le mot important est « normalement » : on refuse, on n'interdit pas
  // définitivement. Un refus sans porte de sortie serait contourné en passant
  // la ligne par une autre étape — et alors le verrou n'aurait rien gardé, il
  // aurait juste appris à le contourner.
  if (body.stage === 'production' && avant[0].stage !== 'production'
      && avant[0].bat_requis && !avant[0].bat_valide_le) {
    if (!(peut(req.moi, 'forcer') && body.forcer === true)) {
      return res.status(409).json({
        error: 'Le BAT n’est pas validé : la production ne peut pas commencer.',
        batBloque: true,
        // On DIT qui peut passer outre, sinon l'employé cherche le bouton qui
        // n'existe pas chez lui, ou pire, contourne par une autre étape.
        forcable: peut(req.moi, 'forcer'),
      });
    }
  }

  // PERMISSION CHAMP PAR CHAMP. On refuse TOUT le PATCH dès qu'un seul champ
  // dépasse : appliquer les champs permis et taire les autres serait pire — le
  // poste croirait avoir enregistré, et la moitié seulement serait passée.
  for (const champ of PATCHABLE) {
    if (!(champ in body)) continue;
    const capacite = capaciteDuChamp(champ);
    if (peut(req.moi, capacite)) continue;
    return res.status(403).json({
      error: `Réservé : ${ROLE_LABELS[req.moi.role]} ne peut pas modifier « ${JOURNAL_FIELDS[champ] || champ} ».`,
      capacite,
    });
  }

  const sets = [];
  const params = [];
  let i = 1;

  for (const key of PATCHABLE) {
    if (key in body) {
      const v = validateField(key, body[key]);
      if (!v.ok) return res.status(400).json({ error: v.error });
      sets.push(`${key} = $${i++}`);
      params.push(v.value);
    }
  }

  // LE PRIX SUIT LA QUANTITÉ — côté VENTE DIRECTE (28/08). Là, aucune grille de
  // tailles ne commande le total : la vendeuse a tapé un prix à la pièce, et
  // passer de 10 tasses à 20 doit doubler le montant. La demande de devis, elle,
  // se retarife par ses tailles (voir le PATCH de la fiche).
  //
  // Même règle qu'ailleurs : un prix posé à la main gagne. On le reconnaît en
  // redemandant ce que la formule donnait pour l'ANCIENNE quantité — si le prix
  // en base ne vaut plus ça, quelqu'un l'a écrit, et on n'y touche pas. Et si
  // le même PATCH porte déjà un prix, c'est celui-là qui compte.
  if ('quantity' in body && !('project_value' in body)) {
    const f = avant[0].fiche && typeof avant[0].fiche === 'object' ? avant[0].fiche : {};
    const ch = f.chiffrage;
    if (ch && ch.moteur === 'unitaire') {
      const apres = chiffrage.recalculer(ch, null, body.quantity);
      const ancien = chiffrage.recalculer(ch, null, avant[0].quantity);
      const calcule = ancien && avant[0].project_value != null
        && Math.abs(Number(avant[0].project_value) - ancien.ttc) < 0.01;
      if (apres && calcule) {
        sets.push(`project_value = $${i++}`);
        params.push(apres.ttc);
      }
    }
  }

  if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

  sets.push('updated_at = now()');
  params.push(req.params.id);
  const query = `UPDATE requests SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`;
  const { rows } = await pool.query(query, params);
  if (rows.length === 0) return res.status(404).json({ error: 'Commande introuvable' });
  await logRequestChanges(req.params.id, avant[0], rows[0], quiDemande(req));
  // LES DEUX ÉTAPES quand la ligne change de famille. L'évènement ne nommait
  // que la nouvelle : le poste qui regardait l'ANCIENNE n'avait aucune raison
  // de relire sa grille et gardait la ligne à l'écran, dans une famille qu'elle
  // a quittée. Tant que chaque poste retéléchargeait tout à chaque évènement,
  // ça ne se voyait pas ; maintenant que l'écran écoute ce champ, c'est lui qui
  // décide — il doit donc être exact.
  await marquerBat(req.params.id, rows[0].sub_stage);
  await marquerDevis(req.params.id, rows[0].sub_stage);

  const etapes = [...new Set([avant[0].stage, rows[0].stage])];
  broadcast({ kind: 'update', stages: etapes });

  // ALERTE MARGE FAIBLE (§13). « Si un commercial descend sous la marge
  // minimum : afficher une alerte. La Direction peut néanmoins forcer le prix. »
  //
  // ON ALERTE, ON N'INTERDIT PAS — c'est écrit noir sur blanc, et c'est aussi
  // la seule règle tenable : un prix se négocie devant le client, et un logiciel
  // qui refuse une vente au comptoir est un logiciel qu'on contourne en notant
  // sur un papier. L'enregistrement est donc DÉJÀ fait quand l'alerte part.
  //
  // Elle n'accompagne que les modifications de PRIX ou de COÛT : recevoir
  // « marge faible » en changeant une date d'échéance apprendrait à l'ignorer.
  let alerte = null;
  const touchePrix = 'project_value' in body || 'cout_revient' in body;
  if (touchePrix && rows[0].cout_revient != null && rows[0].project_value != null) {
    const marges = await getMarges();
    const ht = Number(rows[0].project_value) / (1 + PROJET_TGCA);
    const euros = ht - Number(rows[0].cout_revient);
    const pct = ht > 0 ? (euros / ht) * 100 : 0;
    if (pct < marges.minimum) {
      alerte = {
        type: 'marge_faible',
        pct: Math.round(pct * 10) / 10,
        minimum: marges.minimum,
        message: `Marge de ${Math.round(pct * 10) / 10} % — en dessous du minimum de ${marges.minimum} %.`,
      };
    }
  }
  res.json({ ...selonMoi(req, rows[0]), ...(alerte ? { alerte } : {}) });
}));

// GET /api/recherche?q=… → UNE recherche pour tout (§44).
//
// « Créer une recherche permettant de retrouver rapidement : client, société,
//   numéro projet, téléphone, email. »
//
// Il y en avait DEUX : la palette (commandes) et la Base clients. Chacune
// marchait ; aucune ne répondait à la question telle qu'elle se pose, qui est
// « où est ce truc ? » et pas « dans quelle table est ce truc ? ».
//
// On ne fusionne PAS les deux écrans — chacun garde le sien, qui filtre sa
// liste sur place. On ajoute le point d'entrée qui manquait : celui qui ne
// demande pas de choisir d'abord.
app.get('/api/recherche', asyncH(async (req, res) => {
  const jetons = replier(req.query.q).split(/\s+/).filter(Boolean).slice(0, RECHERCHE_JETONS_MAX);
  if (!jetons.length) return res.json({ commandes: [], clients: [] });

  // Les trois lectures partent ENSEMBLE : en série, une recherche paierait trois
  // temps d'attente pour une frappe. Chacune est bornée court — la palette
  // affiche une poignée de résultats par groupe, pas un inventaire.
  const foinClient = `translate(lower(concat_ws(' ',
    c.entreprise, c.nom, c.prenom, c.raison_sociale, c.email, c.telephone,
    c.code, c.ville, c.zone, c.secteur)), '${ACCENTS}', '${SANS_ACCENTS}')`;

  // Les conditions se construisent AVANT, dans une variable — pas dans un
  // gabarit imbriqué au milieu de la requête. C'est la forme qu'emploie déjà la
  // recherche de commandes, et elle a une deuxième vertu : le test qui vérifie
  // qu'aucune lecture d'écran n'oublie le filtre d'archivage lit le source, et
  // un backtick imbriqué lui masquait la suite de la requête.
  const ou = (foin) => jetons.map((_, i) => `strpos(${foin}, $${i + 1}) > 0`).join(' AND ');
  const condCommandes = ou(FOIN_RECHERCHE);
  const condClients = ou(foinClient);

  const [commandes, clients] = await Promise.all([
    pool.query(
      `${SELECT} WHERE ${condCommandes} AND ${VIVANTES}
        ORDER BY r.updated_at DESC LIMIT 20`, jetons,
    ),
    pool.query(
      `SELECT id, entreprise, nom, prenom, ville, telephone, email, code FROM clients c
        WHERE ${condClients} AND c.${VIVANTES_NU} ORDER BY entreprise ASC LIMIT 10`, jetons,
    ),
  ]);

  res.json({
    commandes: selonMoi(req, commandes.rows.map(allegerFiche)),
    clients: clients.rows,
  });
}));

// GET /api/requests/:id/journal → ce qui a changé sur cette commande, du plus
// récent au plus ancien. La fiche l'affiche dans « Historique ».
// CE QUE LE JOURNAL A GARDÉ, RELU COMME ON LE LIT À L'ÉCRAN.
// La table stocke des valeurs BRUTES — « 3 » pour une priorité, « prod_dtf »
// pour une étape, « 648.96 » pour un prix — parce que c'est ce qui a été écrit
// dans la colonne. Rendues telles quelles, elles donnaient « Priorité : 2 → 3 »,
// que personne ne sait relire : l'écran, lui, dit « Basse / Moyenne / Haute ».
// La traduction se fait ICI, à la lecture, et jamais à l'écriture : le journal
// doit garder ce qui a été écrit, pas la mise en forme du jour.
const PRIORITES_LUES = { 1: 'Basse', 2: 'Moyenne', 3: 'Haute' };
const ETAPES_LUES = new Map([
  ...STAGES.map((e) => [e.slug, e.label]),
  ...Object.values(SUB_STAGES).flat().map((s) => [s.slug, s.label]),
]);
const ALERTES_LUES = { bloque: 'Bloquée', a_voir: 'À voir' };
const EUROS_LUS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const CHAMPS_MONTANT = new Set(['project_value', 'acompte_montant']);

function lisible(champ, brut) {
  if (brut == null || brut === '') return brut;
  const v = String(brut);
  if (champ === 'priority') return PRIORITES_LUES[v] || v;
  if (champ === 'stage' || champ === 'sub_stage') return ETAPES_LUES.get(v) || v;
  if (champ === 'flag') return ALERTES_LUES[v] || v;
  if (v === 'true') return 'oui';
  if (v === 'false') return 'non';
  if (CHAMPS_MONTANT.has(champ)) {
    const n = Number(v);
    return Number.isFinite(n) ? EUROS_LUS.format(n) : v;
  }
  if (champ === 'paiement_mode') {
    const m = COM.paiementModes.find((p) => p.id === v);
    return m ? m.label : v;
  }
  return v;
}

// L'HISTOIRE D'UN DOSSIER EN UNE SEULE LISTE (01/09/2026).
//
// Elle en faisait deux, et aucune n'avait d'écran. Le JOURNAL enregistrait
// depuis des mois ce qui change sur une commande — prix, étape, acompte, qui
// et quand — sans que personne puisse le lire. Les VERSIONS de documents
// archivaient chaque devis remplacé, dans une table que rien n'ouvrait. Deux
// historiques écrits pour rien, ce qui est pire que pas d'historique : on croit
// pouvoir répondre à « qu'est-ce qui s'est passé sur ce dossier ? ».
//
// Ils sortent par la même porte, mêlés et datés, parce que c'est UNE histoire :
// « le prix est passé à 520 €, puis le devis V1 a été remplacé ». Les lire
// séparément demanderait de recoller deux listes à l'œil.
//
// LE LIBELLÉ VIENT D'ICI, PAS DE L'ÉCRAN. `JOURNAL_FIELDS` dit comment un champ
// s'appelle en français ; le recopier côté navigateur ferait deux tables à tenir
// et une divergence le jour où l'une bouge.
app.get('/api/requests/:id/journal', asyncH(async (req, res) => {
  const [journal, versions] = await Promise.all([
    getRequestJournal(req.params.id),
    pool.query(
      `SELECT kind, version, filename, qui, created_at FROM attachment_versions
        WHERE request_id = $1 ORDER BY created_at DESC`, [req.params.id],
    ).then((r) => r.rows).catch(() => []),
  ]);

  // `value_before` / `value_after` RESTENT BRUTS — c'est ce que la colonne
  // contient, et une API qui travestit ce qu'elle a stocké ment à qui la relit.
  // `avant` / `apres` sont les mêmes, en français, pour l'écran.
  const champs = journal.map((l) => ({
    ...l,
    label: JOURNAL_FIELDS[l.field] || l.field,
    avant: lisible(l.field, l.value_before),
    apres: lisible(l.field, l.value_after),
  }));
  // Un document remplacé est un évènement comme un autre : même forme, pour que
  // l'écran n'ait qu'une seule façon d'afficher une ligne. `value_after` porte
  // de quoi le rouvrir — c'est la seule chose qu'on ne peut pas reconstituer.
  const documents = versions.map((v) => ({
    field: 'document',
    label: `${PDF_LABELS[v.kind] || v.kind} — version ${v.version}`,
    avant: v.filename,
    apres: null,
    // Un document archivé se ROUVRE : c'est tout l'intérêt de l'avoir gardé.
    lien: `/api/requests/${req.params.id}/pdf/${v.kind}/versions/${v.version}`,
    who: v.qui,
    created_at: v.created_at,
  }));

  const tout = [...champs, ...documents]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(tout);
}));

// LES DEUX VALEURS QUE L'ÉTABLI RECTIFIE, et rien d'autre : le nombre d'une
// taille, la largeur d'une face. Ce QU'ON MARQUE (`quoi`) n'en fait pas partie :
// c'est la commande du client, elle se corrige au dossier, pas au ticket — et
// `{ ...l, mm }` la reporte telle quelle. Par POSITION, comme le récapitulatif — une
// entrée absente du patch laisse la valeur en place, donc deux postes qui
// corrigent deux largeurs différentes ne s'effacent pas l'un l'autre.
//
// UN NOMBRE DE PIÈCES NE DESCEND PAS À ZÉRO par cette porte : retirer une
// taille change la longueur du tableau, donc les positions de toutes les
// suivantes — la correction d'à côté irait alors sur la mauvaise case. On
// retire une taille au dossier, pas au ticket.
//
// SAUF QUAND LE PATCH NOMME LA TAILLE (`{ t: 'XL', n: 0 }`, 28/08). Un libellé
// ne bouge pas quand une taille tombe à zéro, donc le danger des positions
// n'existe pas : on peut alors descendre à zéro, et même NOMMER UNE TAILLE
// ABSENTE de la liste — c'est ce qui permet de passer de 0 à 20 XL depuis le
// planning. Le comptoir ne pose que les tailles commandées ; corriger un
// dossier, c'est justement en ajouter une.
// L'IDENTITÉ DE L'ARTICLE S'ÉCRIT AUSSI (28/08). Elle ne s'écrivait pas : « le
// reste de prod se corrige au dossier », disait la règle — sauf que le dossier
// n'avait aucun endroit pour ça, et que la seule porte, le ticket, disparaît.
// Charlie : « je clique sur la ligne, elle s'ouvre façon tableau et je peux
// TOUT modifier ». La référence, la couleur, la technique et la couleur du
// marquage sont donc modifiables comme le reste.
const PROD_IDENTITE = ['ref', 'couleur', 'marquage', 'encre'];

function corrigerProd(actuel, patch) {
  if (!actuel || typeof actuel !== 'object') return actuel;
  if (!patch || typeof patch !== 'object') return actuel;
  const out = { ...actuel };
  // UNE FICHE PEUT N'AVOIR NI TAILLES NI FACES — et c'est le cas de TOUS les
  // dossiers d'avant le nouveau comptoir : `fiche.prod` n'existe sur aucun des
  // 187 de la production (mesuré le 29/08). Les deux blocs ci-dessous exigeaient
  // que la liste existe DÉJÀ pour accepter d'y écrire : la fiche atelier
  // affichait donc la colonne Production sur ces dossiers, et rien de ce qu'on y
  // tapait n'arrivait — sans erreur, sans message. Une liste absente vaut une
  // liste vide : on peut y ajouter.
  const taillesActuelles = Array.isArray(actuel.tailles) ? actuel.tailles : [];
  const logosActuels = Array.isArray(actuel.logos) ? actuel.logos : [];
  for (const cle of PROD_IDENTITE) {
    // `undefined` = le poste n'y touche pas ; une chaîne vide EFFACE (une
    // couleur saisie par erreur doit pouvoir partir).
    if (typeof patch[cle] === 'string') out[cle] = borner(patch[cle], 60);
  }
  if (Array.isArray(patch.tailles)) {
    const parNom = patch.tailles.filter((v) => v && typeof v === 'object' && typeof v.t === 'string');
    if (parNom.length) {
      const rang = new Map();
      const liste = taillesActuelles.map((t) => ({ ...t }));
      liste.forEach((t, i) => rang.set(String(t.t), i));
      for (const v of parNom) {
        const nom = borner(v.t, 60);
        const n = Number(v.n);
        if (!nom || !Number.isInteger(n) || n < 0 || n > 100000) continue;
        if (rang.has(nom)) liste[rang.get(nom)].n = n;
        else if (n > 0) { rang.set(nom, liste.length); liste.push({ t: nom, n }); }
      }
      // UNE TAILLE À ZÉRO N'EST PAS UNE TAILLE. La ligne du planning dit ce
      // qu'il y a À PRODUIRE : « 0 × XL » y occupe la place d'un fait et n'en
      // est pas un. Le chiffrage, lui, garde ses six cases (voir chiffrage.js).
      out.tailles = liste.filter((t) => Number(t.n) > 0);
    } else {
      out.tailles = taillesActuelles.map((t, i) => {
        const v = patch.tailles[i];
        const n = v && typeof v === 'object' ? Number(v.n) : NaN;
        return Number.isInteger(n) && n > 0 ? { ...t, n } : t;
      });
    }
  }
  // LES EMPLACEMENTS DE MARQUAGE — ce qui est FACTURÉ, pas ce qui est écrit sur
  // le papier. La fiche les coche un par un depuis le 29/08, et le prix suit :
  // c'est `retarifer` qui les repose dans le chiffrage juste après.
  // Une liste VIDE est une décision (« plus aucun marquage »), pas un oubli :
  // seule l'absence de clé laisse le marquage en place.
  if (Array.isArray(patch.emplacements)) {
    out.emplacements = patch.emplacements
      .filter((v) => typeof v === 'string')
      .map((v) => borner(v, 60))
      .filter(Boolean);
  }
  // UNE FACE SE CORRIGE EN ENTIER (28/08) : son nom, sa cote, ET CE QU'ON Y
  // MARQUE. Seule la cote s'écrivait — or sur une tasse ou une gravure il n'y a
  // pas de cote : c'est `quoi` qui porte toute l'information, et elle était la
  // seule chose de la ligne qu'on ne pouvait pas rectifier.
  //
  // Par position, comme le récapitulatif. `undefined` laisse la valeur en
  // place ; une chaîne vide efface — un « mm » saisi sur une tasse doit pouvoir
  // partir, sinon le ticket promet une cote qui n'existe pas.
  if (Array.isArray(patch.logos)) {
    const liste = logosActuels.map((l) => ({ ...l }));
    patch.logos.forEach((v, i) => {
      if (!v || typeof v !== 'object') return;
      // UNE FACE DE PLUS. Le comptoir n'en pose que ce que la famille déclare,
      // et neuf familles sur dix-sept n'en déclarent aucune : sans cette porte,
      // une tasse arrivée sans face reste à jamais sans face.
      const zone = i < liste.length ? liste[i] : { face: '', mm: '' };
      if (typeof v.face === 'string') zone.face = borner(v.face, 60);
      if (typeof v.mm === 'string') zone.mm = borner(v.mm, 120);
      if (typeof v.quoi === 'string') {
        const quoi = borner(v.quoi, 160);
        // `quoi` N'EXISTE QUE S'IL EXISTE : cette structure repart vers chaque
        // poste à chaque rafraîchissement, un « quoi: '' » sur chaque face de
        // chaque textile est du poids sur le fil pour ne rien dire.
        if (quoi) zone.quoi = quoi; else delete zone.quoi;
      }
      if (i >= liste.length) liste.push(zone);
    });
    // UNE FACE SANS NOM N'EST PAS UNE FACE — c'est ainsi qu'on en retire une :
    // on efface son nom. (Le comptoir applique déjà la même règle à l'entrée.)
    out.logos = liste.filter((z) => z.face);
  }
  return out;
}

// --- LE PRIX SUIT LA QUANTITÉ (28/08) ---------------------------------------
// Les réglages du chiffrage vivent en base — coût DTF, débit, pressage, coût
// horaire, arrondi, palier de coefficient — et les tarifs de transport dans
// leur propre table. Le moteur les attend d'un seul tenant.
const reglagesChiffrage = async () => ({
  ...(await getReglagesTextile()),
  transports: await getTarifsTransport(),
});

// CE QU'IL FAUT RÉÉCRIRE quand les tailles d'une ligne TARIFABLE ont bougé.
// Rend `null` dès qu'on ne sait pas retarifer — et c'est le cas le plus
// fréquent : les 184 dossiers d'avant le 28/08 n'ont aucun chiffrage, une
// tasse et un couteau n'en ont pas non plus. Une ligne qu'on ne sait pas
// retarifer reste modifiable, son prix ne bouge simplement pas.
//
// Le chiffrage repart des tailles de la ligne (`prod.tailles`), jamais des
// siennes : c'est la ligne qu'on vient de corriger, c'est elle qui a raison.
// `qte` ne sert qu'à la vente directe : là, ce n'est pas une grille de tailles
// qui commande le total mais la quantité elle-même, saisie sur la ligne.
async function retarifer(f, reglages, qte) {
  const ch = f && f.chiffrage;
  if (!ch || typeof ch !== 'object') return null;
  if (ch.moteur === 'unitaire') {
    const r = chiffrage.recalculer(ch, reglages, qte);
    return r ? { chiffrage: ch, ...r } : null;
  }
  if (!f.prod || !Array.isArray(f.prod.tailles)) return null;
  // LA RÉFÉRENCE SUIT L'ARTICLE. Corriger « NS300 » en « NS332 » sur la ligne,
  // c'est changer de produit : le prix d'achat n'est plus le même, donc le prix
  // de vente non plus. On ne l'accepte QUE si le moteur connaît la nouvelle
  // référence — sinon on garde le chiffrage d'origine plutôt que de rendre la
  // ligne muette au premier nom tapé de travers.
  let base = ch;
  const refLigne = String((f.prod.ref || '')).trim();
  if (refLigne && refLigne !== ch.ref) {
    const essai = chiffrage.bornerChiffrage({ ...ch, ref: refLigne });
    if (essai && chiffrage.recalculer(essai, reglages)) base = essai;
  }
  let majCh = chiffrage.poserTailles(base, f.prod.tailles);
  // LES EMPLACEMENTS SUIVENT LA FICHE, quand elle les porte (29/08). Ils
  // n'étaient reliés à RIEN : cocher « Manche GA » l'écrivait sur le ticket de
  // l'atelier, et le devis ne la facturait pas — `prod.logos` vient des zones du
  // besoin, `chiffrage.printType` de la liste du comptoir, et les deux vivaient
  // chacune de leur côté.
  // ⚠ SEULEMENT SI LA FICHE LES POSE (`prod.emplacements`). Sur les dossiers
  // d'avant, `prod.logos` peut très bien ne porter qu'une face pendant que le
  // marquage facturé en compte deux : les relire ici ferait BAISSER un prix déjà
  // annoncé au client, à la première correction de quantité, sans que personne
  // ne l'ait demandé.
  if (Array.isArray(f.prod.emplacements)) {
    majCh = chiffrage.poserEmplacements(majCh, f.prod.emplacements);
  }
  const r = chiffrage.recalculer(majCh, reglages);
  return r ? { chiffrage: majCh, ...r } : null;
}

// PATCH /api/requests/:id/fiche → corrige le DÉTAIL COMPLET d'une commande du
// comptoir (le récapitulatif enregistré à la prise). Une quantité change, une
// taille se précise, un numéro de téléphone était faux : ça se corrige sur la
// fiche, sinon la correction ne vit que dans la tête de celui qui l'a apprise.
//
// On accepte UNIQUEMENT des valeurs, par position (`{ client: [...], details:
// [...] }`) : les libellés viennent du parcours et ne se réécrivent pas, et
// personne ne peut glisser n'importe quel JSON dans `fiche` par cette porte.
//
// LA FICHE SE RÉÉCRIT EN ENTIER À CHAQUE CORRECTION — c'est un seul `jsonb`, pas
// une colonne par champ. Lue puis réécrite hors transaction, deux postes qui
// corrigent le MÊME dossier en même temps s'effaçaient donc l'un l'autre en
// silence : l'atelier rectifie l'heure de retrait pendant que le comptoir
// rectifie une quantité, chacun est parti de la fiche d'AVANT, et le dernier
// enregistré remet l'autre correction à sa valeur initiale. Rien à l'écran,
// rien dans le journal — la correction avait bien été « enregistrée ».
// On prend donc la ligne (`FOR UPDATE`) le temps de la relire et de la
// réécrire : le second poste attend, repart de la fiche corrigée, et les deux
// corrections tiennent.
app.patch('/api/requests/:id/fiche', exige('clients'), asyncH(async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  // Ce qui se juge SANS la fiche stockée se juge avant de prendre le verrou :
  // une saisie invalide ne doit pas faire patienter le poste d'à côté.
  // Une heure mal formée (« 14h00 ») EFFAÇAIT l'heure de retrait sans rien
  // dire, alors que la même valeur est refusée à la prise de commande. On
  // refuse ici aussi : seul un champ explicitement vidé remet à null.
  const heureVide = b.heureSouhaitee == null || b.heureSouhaitee === '';
  if ('heureSouhaitee' in b && !heureVide && !isHeure(b.heureSouhaitee)) {
    return res.status(400).json({ error: `heure souhaitée invalide : ${b.heureSouhaitee}` });
  }

  // Une valeur vidée devient « — » plutôt que rien : le récapitulatif imprimé
  // garde sa ligne, et on voit que le champ a été vidé exprès.
  const corriger = (lignes, valeurs) => {
    if (!Array.isArray(lignes) || !Array.isArray(valeurs)) return lignes;
    return lignes.map((l, i) => (
      typeof valeurs[i] === 'string' ? { ...l, v: borner(valeurs[i], 600) || '—' } : l
    ));
  };

  // LES RÉGLAGES SE LISENT AVANT LE VERROU. Deux requêtes de plus sur le pool
  // pendant qu'on tient une ligne `FOR UPDATE`, c'est le poste d'à côté qui
  // attend pour rien — et un pool saturé qui ne peut plus les servir. Ils ne
  // bougent pas entre-temps ; s'ils bougeaient, c'est le calcul SUIVANT qui en
  // tiendrait compte, et c'est très bien comme ça.
  const reglages = 'prod' in b ? await reglagesChiffrage() : null;

  const client = await pool.connect();
  let issue;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT fiche, project_value FROM requests WHERE id = $1 AND ${VIVANTES_NU} FOR UPDATE`,
      [req.params.id],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable' });
    }
    const fiche = rows[0].fiche && typeof rows[0].fiche === 'object' ? rows[0].fiche : {};

    const majFiche = { ...fiche };
    // Le récapitulatif ligne à ligne n'existe que sur une commande du comptoir :
    // ailleurs il n'y a rien à corriger, et on ne va pas en inventer un.
    if (fiche.kind === 'comptoir-v17') {
      majFiche.client = corriger(fiche.client, b.client);
      majFiche.details = corriger(fiche.details, b.details);
    } else if (Array.isArray(b.client) || Array.isArray(b.details)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'cette commande n’a pas de détail modifiable' });
    }
    // L'heure de retrait (elle commande le calcul du délai de production) et le
    // secteur de production se corrigent en revanche sur N'IMPORTE QUELLE ligne,
    // y compris une ligne créée à la main : la fiche les affiche pour tout le
    // monde, ils doivent s'enregistrer pour tout le monde. `undefined` = le poste
    // n'y touche pas.
    if ('heureSouhaitee' in b) majFiche.heureSouhaitee = heureVide ? null : b.heureSouhaitee;
    if ('production' in b) majFiche.production = borner(b.production, 200);
    // LA CONSIGNE POUR L'ATELIER, écrite depuis le ticket ouvert sur la ligne.
    // Elle s'imprime avec lui : c'est le papier qui suit le dossier jusqu'à la
    // machine. Bornée court — c'est une consigne, pas un cahier des charges.
    if ('atelier' in b) majFiche.atelier = borner(b.atelier, 500);
    // Le numéro du PAPIER remis au client, quand il ne porte pas la référence
    // du dossier (deux postes hors réseau se sont donné le même numéro de
    // secours, l'un a dû changer). `ref`, elle, ne se retape JAMAIS : c'est la
    // clé du dossier — la recherche et l'idempotence de la prise s'y appuient.
    if ('refTicket' in b) majFiche.refTicket = borner(b.refTicket, 40);
    // CE QU'ON RECTIFIE À L'ÉTABLI : un nombre par taille, une largeur de logo.
    // « Finalement le dos en 300 » se décide devant la presse, et une
    // rectification qui ne vit que sur le papier est perdue au ticket suivant.
    // On corrige PAR POSITION, comme le récapitulatif — deux postes qui
    // rectifient deux largeurs différentes ne s'effacent pas l'un l'autre.
    // Le reste de `prod` (référence, couleur, technique) ne s'écrit PAS par
    // cette porte : c'est l'identité de l'article, elle se corrige au dossier.
    // `fiche.prod || {}` : une fiche sans production accepte sa PREMIÈRE écriture.
    // Sans ce repli, `corrigerProd` rendait `undefined` et la colonne Production
    // de la fiche atelier était en lecture seule sur tout le passé — 187 dossiers
    // sur 187, et rien à l'écran ne le disait.
    if ('prod' in b) majFiche.prod = corrigerProd(fiche.prod || {}, b.prod);

    // LE PRIX SUIT LA QUANTITÉ. « Il ne veut plus 30 S, il en veut 100 » : le
    // dégressif du fichier V9 s'applique, la quantité de la ligne et le coût de
    // revient suivent. C'est le SERVEUR qui recalcule, une fois, sous le verrou
    // — deux postes qui corrigent la même ligne obtiennent le même prix.
    //
    // UN PRIX POSÉ À LA MAIN GAGNE TOUJOURS. La vendeuse a négocié, ou le patron
    // a écrit un montant sur la ligne : le recalcul rectifie alors la quantité
    // et le coût, jamais le prix. Effacer un accord client sans le dire, c'est
    // le genre de correction qu'on ne découvre qu'à la facture.
    //
    // ON NE POSE AUCUN DRAPEAU POUR LE SAVOIR : on REDEMANDE au moteur ce qu'il
    // donnait AVANT la correction, et on compare au prix en base. Égal, le prix
    // est calculé et se remet à jour ; différent, une main est passée dessus et
    // on n'y touche pas. Un drapeau, il aurait fallu le poser partout où un
    // prix s'écrit — et il aurait manqué sur les dossiers d'avant.
    //
    // UN PRIX ABSENT LE RESTE. Une demande de devis vaut `project_value` NULL
    // et jamais 0 : lui écrire un montant parce qu'on a corrigé une quantité,
    // ce serait annoncer un prix que personne n'a donné au client.
    const cols = [];
    const vals = [];
    const tarif = 'prod' in b ? await retarifer(majFiche, reglages) : null;
    if (tarif) {
      majFiche.chiffrage = tarif.chiffrage;
      const avant = chiffrage.recalculer(fiche.chiffrage, reglages);
      const enBase = rows[0].project_value;
      const calcule = avant && enBase != null
        && Math.abs(Number(enBase) - avant.ttc) < 0.01;
      // `$1` porte la fiche et `$2` l'identifiant : les valeurs ajoutées ici
      // commencent donc à `$3`.
      const place = (v) => { vals.push(v); return `$${vals.length + 2}`; };
      cols.push(`quantity = ${place(tarif.qte)}`);
      // La vente directe n'a pas de coût de revient — la vendeuse tape un prix,
      // pas une marge. On n'écrit donc pas `null` par-dessus ce que quelqu'un a
      // pu renseigner à la main dans le tableau de marge.
      if (tarif.revient != null) cols.push(`cout_revient = ${place(tarif.revient)}`);
      if (calcule) cols.push(`project_value = ${place(tarif.ttc)}`);
    }
    const { rows: maj } = await client.query(
      `UPDATE requests SET fiche = $1${cols.length ? `, ${cols.join(', ')}` : ''},
              updated_at = now() WHERE id = $2 RETURNING *`,
      [JSON.stringify(majFiche), req.params.id, ...vals],
    );
    await client.query('COMMIT');
    issue = { ligne: maj[0], avant: fiche, apres: majFiche };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Une correction de fiche est une modification de la commande comme une autre :
  // elle a sa ligne dans l'« Historique ». Sans ça, une quantité rectifiée ou
  // une heure de retrait déplacée ne laissait aucune trace, et personne ne
  // pouvait dire ce qui avait bougé sur le dossier.
  await logFicheChange(req.params.id, issue.avant, issue.apres, quiDemande(req));
  broadcast({ kind: 'update', stages: [issue.ligne.stage] });
  return res.json(issue.ligne);
}));

// DELETE /api/requests/:id → ARCHIVE la commande. Rien ne s'efface.
//
// Cette route DÉTRUISAIT tout : la ligne, ses PDF (devis, BAT, facture) et son
// journal entier. Une main qui glisse sur une corbeille, et le dossier n'avait
// jamais existé — impossible de dire ce qui avait été commandé, ni pour combien,
// ni par qui. Le patron le demande noir sur blanc : on archive, on ne supprime
// pas. La ligne quitte donc tous les écrans (voir VIVANTES) et garde tout.
//
// Le verbe HTTP ne change pas : c'est bien « retirer du planning » que le poste
// demande, et tous les appelants le disent déjà comme ça. C'est ce qu'on FAIT
// derrière qui change.
app.delete('/api/requests/:id', exige('production'), asyncH(async (req, res) => {
  // `RETURNING stage` : l'évènement doit dire OÙ la ligne vivait, sinon les
  // postes ne savent pas si la grille qu'ils affichent vient de perdre une
  // ligne — et, faute de mieux, ils relisent tous la leur.
  // `AND deleted_at IS NULL` : archiver deux fois ne doit pas réécrire la date
  // du premier archivage, sinon la corbeille se réordonne toute seule.
  const { rows: partie } = await pool.query(
    `UPDATE requests SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND ${VIVANTES_NU} RETURNING stage`, [req.params.id],
  );
  if (partie.length === 0) return res.status(404).json({ error: 'Commande introuvable' });
  await logCycleDeVie(req.params.id, 'Retirée du planning', quiDemande(req));
  broadcast({ kind: 'delete', stages: [partie[0].stage] });
  res.status(204).end();
}));

// POST /api/requests/:id/restaurer → la remet au planning, là où elle était.
//
// Sans ce chemin, l'archivage serait un trou noir : plus doux qu'une
// suppression pour l'historique, mais tout aussi définitif pour l'employé qui
// s'est trompé de ligne. Elle revient dans SA famille et à SA sous-étape —
// aucune des deux n'a été touchée par l'archivage.
app.post('/api/requests/:id/restaurer', exige('production'), asyncH(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE requests SET deleted_at = NULL, updated_at = now()
     WHERE id = $1 AND deleted_at IS NOT NULL RETURNING stage`, [req.params.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Commande introuvable dans la corbeille' });
  await logCycleDeVie(req.params.id, 'Remise au planning', quiDemande(req));
  broadcast({ kind: 'update', stages: [rows[0].stage] });
  res.status(204).end();
}));


// ---------------------------------------------------------------------------
// Pièces jointes PDF (Devis / BAT / Facture) — 3 emplacements fixes par commande.
// Stockées en base (base64) ; servies inline pour consultation immédiate.
// ---------------------------------------------------------------------------
const PDF_KINDS = ['devis', 'bat', 'facture'];
// Comment chaque document s'appelle dans une phrase — l'historique en a besoin,
// et c'est le serveur qui nomme, jamais l'écran (voir GET …/journal).
const PDF_LABELS = { devis: 'Devis', bat: 'BAT', facture: 'Facture' };

// Marque la commande comme modifiée pour que le temps réel (signature basée sur
// updated_at) propage l'apparition / suppression d'un PDF aux autres clients.
async function touchRequest(id) {
  const { rows } = await pool.query(
    'UPDATE requests SET updated_at = now() WHERE id = $1 RETURNING stage', [id],
  );
  return rows[0] ? rows[0].stage : null;
}

// DÉPOSER UN PDF SUR UNE COMMANDE — LA RÈGLE, ÉCRITE UNE FOIS.
//
// Elle avait un seul appelant (la route ci-dessous) jusqu'à ce que BAT Studio
// entre dans le CRM : son export dépose le bon à tirer sur la fiche, et il
// passait pour ça par un aller-retour HTTP vers cette même route, avec un mot
// de passe à tenir. Dans le même processus, c'est un appel de fonction — et
// surtout, le versionnage, l'archivage de la version d'avant, l'armement du
// verrou de production et le temps réel restent écrits À UN SEUL ENDROIT.
// Deux écritures redeviennent deux comportements le jour où l'une bouge.
//
// Renvoie `{ statut, corps }` : à l'appelant de le rendre au client.
async function deposerPdf({ id, kind, buf, nom, qui }) {
  if (!PDF_KINDS.includes(kind)) return { statut: 400, corps: { error: `type invalide (${PDF_KINDS.join('|')})` } };
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { statut: 400, corps: { error: 'PDF vide' } };
  // Un vrai PDF commence par « %PDF- ». Sans ce contrôle, n'importe quel
  // fichier de 12 Mo entrait en base (encodé base64, soit +33 % de poids) et
  // s'ouvrait ensuite sur une page blanche chez celui qui le consultait.
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return { statut: 400, corps: { error: 'ce fichier n’est pas un PDF' } };
  }

  const exists = await pool.query(`SELECT 1 FROM requests WHERE id = $1 AND ${VIVANTES_NU}`, [id]);
  if (exists.rowCount === 0) return { statut: 404, corps: { error: 'Commande introuvable' } };

  let filename = String(nom || '').slice(0, 255).trim();
  if (!filename) filename = `${kind}.pdf`;
  const data = buf.toString('base64');

  // LA VERSION D'AVANT PART À L'HISTORIQUE (§19, §20). Elle était PERDUE :
  // un devis V2 déposé écrasait le V1, et « quel prix lui avait-on annoncé la
  // première fois ? » n'avait plus de réponse. Même chose pour un BAT qu'on
  // corrige — c'est justement la version d'avant que le client conteste.
  //
  // TROIS LECTURES, PAS UNE SOUS-REQUÊTE CORRÉLÉE. La forme
  // `INSERT … SELECT … (SELECT MAX(v.version) … WHERE v.request_id = a.request_id)`
  // est valide en Postgres, mais pg-mem — la base locale, celle sur laquelle
  // le patron valide — répond « column "a.request_id" does not exist ». Même
  // piège que la liste des achats : cassé en local, parfait en production.
  //
  // La course entre deux dépôts simultanés est tenue par l'index UNIQUE sur
  // (request_id, kind, version) : le perdant relit le maximum et réessaie une
  // fois. Deux versions ne peuvent donc pas porter le même numéro.
  await archiverVersion(id, kind, qui).catch((err) => {
    // L'historique est un CONFORT : s'il échoue, le dépôt du document doit
    // quand même aboutir. Perdre une version d'archive est ennuyeux ; perdre
    // le devis que la vendeuse vient de déposer est bien pire.
    console.error('historique des pièces jointes :', err.message);
  });

  // Upsert atomique sur la clé (request_id, kind). En delete + insert, deux
  // envois simultanés du même emplacement se marchaient dessus : le second
  // violait la clé primaire et renvoyait 500 sur un dépôt pourtant valide.
  await pool.query(
    `INSERT INTO attachments (request_id, kind, filename, data, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (request_id, kind)
     DO UPDATE SET filename = EXCLUDED.filename, data = EXCLUDED.data, updated_at = now()`,
    [id, kind, filename, data],
  );
  // DÉPOSER UN BAT, C'EST EN AVOIR UN. Le verrou de production s'arme donc
  // tout seul : personne n'a à cocher « ce dossier a un BAT », et personne ne
  // le ferait.
  if (kind === 'bat') {
    await pool.query('UPDATE requests SET bat_requis = true WHERE id = $1', [id]).catch(() => {});
  }
  // DÉPOSER UN DEVIS, C'EST EN AVOIR UN. Même règle, même raison : le dossier
  // en exige un désormais, sans que personne ait eu à le déclarer.
  if (kind === 'devis') {
    await pool.query('UPDATE requests SET devis_requis = true WHERE id = $1', [id]).catch(() => {});
  }
  const stage = await touchRequest(id);
  broadcast({ kind: 'update', stages: stage ? [stage] : [] });
  return { statut: 200, corps: { kind, filename } };
}

// PUT /api/requests/:id/pdf/:kind  (corps = PDF brut, ?name=<nom de fichier>)
//
// LA CAPACITÉ SUIT LE DOCUMENT, PAS LA ROUTE (04/09/2026). Les trois
// emplacements passaient par `exige('clients')` — la boutique et la Direction.
// Le BAT n'est pourtant pas un document de client : « Préparation du BAT » est
// une sous-étape de l'ATELIER, et le chef d'atelier se voyait refuser la
// pastille de sa propre étape (403) alors que le même dépôt lui était ouvert
// par `PUT /bat/api/crm/bat/:id`. Une même écriture, deux réponses selon la
// porte empruntée : c'est la porte qu'on répare, pas l'utilisateur.
const capacitePdf = (req, res, next) =>
  (req.params.kind === 'bat' ? exige('bat') : exige('clients'))(req, res, next);
app.put('/api/requests/:id/pdf/:kind', capacitePdf,
  express.raw({ type: () => true, limit: '12mb' }),
  asyncH(async (req, res) => {
    const { statut, corps } = await deposerPdf({
      id: req.params.id, kind: req.params.kind,
      buf: req.body, nom: req.query.name, qui: quiDemande(req),
    });
    res.status(statut).json(corps);
  }));

// BAT STUDIO, MONTÉ ICI ET PAS AILLEURS : juste derrière `deposerPdf`, qui est
// la seule chose que le CRM lui prête. Tout ce qui est sous `/bat/api` lui
// appartient ; le reste de `/bat` (js, css, polices, vendor) est du statique
// ordinaire, servi par `express.static` comme le reste de `public/`.
// `exige` PART AVEC LE RESTE, et ce n'est pas décoratif : sans lui, les routes
// d'écriture de BAT Studio n'avaient AUCUN contrôle de capacité, là où la route
// qu'elles appellent (`PUT /api/requests/:id/pdf/:kind`) en a un. Deux chemins
// vers la même écriture, un seul gardé.
monterBat(app, { deposerPdf, asyncH, quiDemande, exige });

// Range la version COURANTE à l'historique, avant qu'on l'écrase.
async function archiverVersion(id, kind, qui, essai = 0) {
  const { rows: actuel } = await pool.query(
    'SELECT filename, data FROM attachments WHERE request_id = $1 AND kind = $2', [id, kind],
  );
  // Rien à archiver : c'est le PREMIER dépôt. L'historique commence donc à V1
  // le jour où on remplace ce document-là, pas le jour où on le pose.
  if (!actuel.length) return;
  const { rows: max } = await pool.query(
    'SELECT COALESCE(MAX(version), 0) AS n FROM attachment_versions WHERE request_id = $1 AND kind = $2',
    [id, kind],
  );
  try {
    await pool.query(
      `INSERT INTO attachment_versions (request_id, kind, version, filename, data, qui)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, kind, Number(max[0].n) + 1, actuel[0].filename, actuel[0].data, qui],
    );
  } catch (err) {
    // 23505 = un autre dépôt a pris ce numéro entre-temps. On relit et on
    // réessaie UNE fois : deux tentatives suffisent à deux postes, et une
    // boucle sur un échec durable bloquerait le dépôt qu'on protège.
    if (err && err.code === '23505' && essai === 0) return archiverVersion(id, kind, qui, 1);
    throw err;
  }
}

// GET /api/requests/:id/pdf/:kind/versions → la liste des versions passées.
// Sans les blobs : une liste de dix devis ferait plusieurs mégaoctets pour
// afficher trois lignes de dates.
app.get('/api/requests/:id/pdf/:kind/versions', asyncH(async (req, res) => {
  const { id, kind } = req.params;
  if (!PDF_KINDS.includes(kind)) return res.status(400).json({ error: `type invalide (${PDF_KINDS.join('|')})` });
  const { rows } = await pool.query(
    `SELECT version, filename, qui, created_at FROM attachment_versions
      WHERE request_id = $1 AND kind = $2 ORDER BY version DESC`, [id, kind],
  );
  res.json(rows);
}));

// GET /api/requests/:id/pdf/:kind/versions/:v → CETTE version-là, en clair.
app.get('/api/requests/:id/pdf/:kind/versions/:v', asyncH(async (req, res) => {
  const { id, kind, v } = req.params;
  if (!PDF_KINDS.includes(kind)) return res.status(400).json({ error: `type invalide (${PDF_KINDS.join('|')})` });
  const { rows } = await pool.query(
    'SELECT filename, data FROM attachment_versions WHERE request_id = $1 AND kind = $2 AND version = $3',
    [id, kind, Number.parseInt(v, 10) || 0],
  );
  if (!rows.length) return res.status(404).json({ error: 'Version introuvable' });
  const buf = Buffer.from(rows[0].data, 'base64');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${rows[0].filename.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(buf);
}));

// GET /api/requests/:id/pdf/:kind  → ouvre le PDF inline (consultable à tout moment)
app.get('/api/requests/:id/pdf/:kind', asyncH(async (req, res) => {
  const { id, kind } = req.params;
  if (!PDF_KINDS.includes(kind)) return res.status(400).json({ error: `type invalide (${PDF_KINDS.join('|')})` });
  const { rows } = await pool.query(
    'SELECT filename, data FROM attachments WHERE request_id = $1 AND kind = $2', [id, kind],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'PDF introuvable' });
  const buf = Buffer.from(rows[0].data, 'base64');
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': buf.length,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(rows[0].filename)}`,
    'Cache-Control': 'private, no-store',
  });
  res.send(buf);
}));

// DELETE /api/requests/:id/pdf/:kind
// MÊME RÈGLE QU'AU DÉPÔT (`capacitePdf`) : qui peut poser le BAT peut le
// retirer. Deux capacités différentes pour poser et pour reprendre, ce serait
// une pastille qu'on remplit sans jamais pouvoir la vider.
app.delete('/api/requests/:id/pdf/:kind', capacitePdf, asyncH(async (req, res) => {
  const { id, kind } = req.params;
  if (!PDF_KINDS.includes(kind)) return res.status(400).json({ error: `type invalide (${PDF_KINDS.join('|')})` });
  const { rowCount } = await pool.query(
    'DELETE FROM attachments WHERE request_id = $1 AND kind = $2', [id, kind],
  );
  if (rowCount === 0) return res.status(404).json({ error: 'PDF introuvable' });
  const stage = await touchRequest(id);
  broadcast({ kind: 'update', stages: stage ? [stage] : [] });
  res.status(204).end();
}));

// ---------------------------------------------------------------------------
// Catalogue de l'atelier (catalog.json) — source unique des listes de la
// prise de commande : vêtements, tailles, zones d'impression, techniques.
// ---------------------------------------------------------------------------
const CATALOG = require('./catalog.json');

// Une date civile valide, pas seulement bien formée : « 2026-02-30 » a la bonne
// tête mais n'existe pas, et la colonne `date` rejetterait l'INSERT (500). On la
// traite donc comme une date absente — le délai par défaut s'applique.
const isDay = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// Heure de retrait de la vente directe, « HH:MM » sur 24 h.
const isHeure = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

// Fuseau de l'ATELIER (Saint-Martin, UTC−4 toute l'année, pas d'heure d'été).
// Il ne suffit pas de dire « date locale » : en production le conteneur tourne
// en UTC, donc `new Date()` y bascule au LENDEMAIN dès 20 h à l'atelier. Une
// vente prise à 20 h 30 datait alors du jour suivant — échéance décalée d'un
// jour, et numéro de ticket ouvrant la série du lendemain.
const ATELIER_TZ = process.env.ATELIER_TZ || 'America/Marigot';
// `en-CA` formate en aaaa-mm-jj, exactement la forme attendue par la colonne.
const FORMAT_JOUR_ATELIER = new Intl.DateTimeFormat('en-CA', {
  timeZone: ATELIER_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

// Date civile de l'atelier, aujourd'hui.
const jourAtelier = () => FORMAT_JOUR_ATELIER.format(new Date());

// Date civile de l'atelier à J+n. Le décalage se fait à midi UTC sur la date
// déjà ramenée au fuseau : aucun risque de retomber sur la veille en chemin.
function todayPlus(days) {
  const base = jourAtelier();
  if (!days) return base;
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Base clients professionnelle (CRM) — table `clients` + `client_notes`.
// Rapatriée de l'ancienne app « Base clients » (Next.js) pour vivre DANS le
// planning : la prise de commande y puise ses suggestions (auto-complétion) et
// y crée automatiquement le client absent ; la fiche est éditable en place.
// ---------------------------------------------------------------------------

// `clientKey` (clé de rapprochement) vient de db.js : la base la range désormais
// en colonne, les deux doivent donc la calculer exactement pareil.

const trimOrNull = (v) => {
  // UN OBJET N'EST PAS UN TEXTE. `String({})` rend « [object Object] » et
  // `String([1,2])` rend « 1,2 » : un poste qui envoie `client` là où le
  // serveur attend `clientObj` écrivait donc « [object Object] » comme NOM DE
  // CLIENT au planning — une chaîne parfaitement valide, qu'aucune validation
  // ne rattrape ensuite. Une valeur du mauvais type vaut « rien », pas « ça ».
  if (v !== null && typeof v === 'object') return null;
  const s = String(v == null ? '' : v).trim();
  return s === '' ? null : s;
};

// Champs éditables d'un client et leur longueur bornée (ces textes vivent dans
// une carte / une cellule, pas dans un traitement de texte). `client_type` est
// une ÉNUMÉRATION (pro / perso), pas un texte libre : validé à part.
const CLIENT_MAX = {
  entreprise: 120, nom: 80, type: 60, zone: 60,
  email: 160, telephone: 40,
  // `fonction` est une colonne de la table depuis l'origine et la Base clients
  // la cherche — mais elle ne figurait pas ici : aucune écriture ne pouvait
  // donc la remplir. Le comptoir, qui demande « Personne à contacter » et son
  // rôle, la perdait en silence à chaque fiche créée.
  fonction: 80,
  raison_sociale: 120, code_postal: 12, ville: 80, pays: 60, secteur: 60, referent_prenom: 80,
  prenom: 80, adresse: 200,
};
const CLIENT_FIELDS = [...Object.keys(CLIENT_MAX), 'client_type'];
// La nature du client (pro/perso/asso/revendeur) partage désormais la MÊME liste
// que requests.client_type — la fiche patron distingue Professionnel/Revendeur/
// Association/Particulier (classeur « CRM OLDA CREATION CLIENTS »).
const NOTE_KINDS = new Set(['note', 'appel', 'email', 'rdv']);
const NOTE_MAX = 2000;

function validateClientField(key, value) {
  if (key === 'client_type') {
    const s = String(value == null ? '' : value).trim().toLowerCase();
    if (s !== '' && !CLIENT_TYPE_SET.has(s)) return { ok: false, error: `nature invalide : ${value}` };
    return { ok: true, value: s === '' ? 'pro' : s };
  }
  const s = String(value == null ? '' : value).trim().slice(0, CLIENT_MAX[key]);
  if (key === 'email' && s !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
    return { ok: false, error: 'email invalide' };
  }
  return { ok: true, value: s === '' ? null : s };
}

// Compte des commandes du planning rattachées à chaque client (rapprochement
// normalisé sur le nom de société). Sert la pastille « 3 commandes au planning »
// de l'auto-complétion et de la fiche. Table petite : agrégation en JS.
async function commandeCountByClientKey() {
  // GROUP BY côté Postgres : on ne remonte qu'une ligne par nom distinct (des
  // dizaines) au lieu d'une par commande (des milliers, l'archive ne se vide
  // jamais). Le rapprochement normalisé (clientKey) reste en JS : deux
  // graphies du même client s'additionnent ici.
  const { rows } = await pool.query(
    `SELECT billing_company, COUNT(*)::int AS n FROM requests
     WHERE billing_company IS NOT NULL AND ${VIVANTES_NU} GROUP BY billing_company`,
  );
  const counts = new Map();
  for (const r of rows) {
    const key = clientKey(r.billing_company);
    if (key) counts.set(key, (counts.get(key) || 0) + r.n);
  }
  return counts;
}

// GET /api/clients → base clients complète, enrichie du nombre de commandes au
// planning et de notes. Sert AUSSI l'auto-complétion de la prise de commande.
app.get('/api/clients', asyncH(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM clients WHERE ${VIVANTES_NU}`);
  const { rows: noteRows } = await pool.query(
    'SELECT client_id, COUNT(*)::int AS n FROM client_notes GROUP BY client_id',
  );
  const notesByClient = new Map(noteRows.map((r) => [r.client_id, r.n]));
  const counts = await commandeCountByClientKey();

  const list = rows.map((c) => ({
    ...c,
    notes_count: notesByClient.get(c.id) || 0,
    commandes: counts.get(clientKey(c.entreprise)) || 0,
  }));
  list.sort((a, b) => a.entreprise.localeCompare(b.entreprise, 'fr'));
  res.json(list);
}));

// Secteurs d'activité : liste MODIFIABLE (le patron ajoute et retranche depuis
// Base clients), pas une constante du code. Déclarées avant `/api/clients/:id`
// pour qu'« secteurs » ne soit pas pris pour un identifiant de client.
app.get('/api/clients/secteurs', asyncH(async (req, res) => {
  res.json(await getClientSecteurs());
}));

app.post('/api/clients/secteurs', exige('clients'), asyncH(async (req, res) => {
  const label = req.body && req.body.label;
  const list = await addClientSecteur(label);
  if (!list) return res.status(400).json({ error: 'libellé de secteur vide' });
  res.status(201).json(list);
}));

app.delete('/api/clients/secteurs/:label', exige('clients'), asyncH(async (req, res) => {
  res.json(await removeClientSecteur(req.params.label));
}));

// GET /api/clients/:id → une fiche + sa timeline de notes (récent en premier).
app.get('/api/clients/:id', asyncH(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM clients WHERE id = $1 AND ${VIVANTES_NU}`, [req.params.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
  const { rows: notes } = await pool.query(
    'SELECT * FROM client_notes WHERE client_id = $1 ORDER BY created_at DESC', [req.params.id],
  );
  const counts = await commandeCountByClientKey();

  // §9 : « chiffre d'affaires, dernière commande, projets, devis, commandes ».
  // La fiche disait QUI est le client ; elle ne disait pas CE QU'IL PÈSE — donc
  // impossible de savoir, en le rappelant, si on parle à un client de 200 € ou
  // de 12 000 €.
  //
  // Le rapprochement se fait sur la CLÉ normalisée du nom, pas sur un
  // identifiant : les commandes ne portent pas `client_id` (elles citent le nom,
  // et deux graphies du même client existent). C'est le même rapprochement que
  // partout ailleurs — voir `clientKey`.
  const cle = clientKey(rows[0].entreprise);
  const { rows: lignes } = await pool.query(
    `SELECT id, billing_company, product, project_value, stage, sub_stage, created_at, project_id
       FROM requests WHERE ${VIVANTES_NU} AND billing_company IS NOT NULL
       ORDER BY created_at DESC LIMIT 500`,
  );
  const siennes = lignes.filter((l) => clientKey(l.billing_company) === cle);
  // Le CA ne se rend qu'à qui voit l'argent : sur un poste d'atelier, une fiche
  // client ne doit pas annoncer ce que le client a dépensé.
  const ca = siennes.reduce((t, l) => t + (Number(l.project_value) || 0), 0);
  const dossiers = [...new Set(siennes.map((l) => l.project_id).filter(Boolean))];

  res.json({
    ...rows[0],
    notes,
    commandes: counts.get(cle) || 0,
    derniere_commande: siennes.length ? siennes[0].created_at : null,
    projets: dossiers.length,
    // Les cinq dernières suffisent : la fiche se lit au téléphone, pas en
    // réunion — au-delà, personne ne descend.
    dernieres: selonMoi(req, siennes.slice(0, 5)),
    ...(peut(req.moi, 'argent') ? { ca: Math.round(ca * 100) / 100 } : {}),
  });
}));

// `nextClientCode` (compteur « CLI-PRO-0007 ») vient de db.js : la migration qui
// rattrape les codes manquants s'en sert aussi, et il ne doit exister qu'UN seul
// compteur — deux fiches ne peuvent pas porter le même numéro.

// POST /api/clients → crée un client. Seule l'entreprise est obligatoire.
app.post('/api/clients', exige('clients'), asyncH(async (req, res) => {
  const body = req.body || {};
  const cols = [];
  const vals = [];
  const params = [];
  let i = 1;
  for (const key of CLIENT_FIELDS) {
    if (!(key in body)) continue;
    const v = validateClientField(key, body[key]);
    if (!v.ok) return res.status(400).json({ error: v.error });
    cols.push(key); vals.push(`$${i++}`); params.push(v.value);
  }
  if (!cols.includes('entreprise') || params[cols.indexOf('entreprise')] == null) {
    return res.status(400).json({ error: 'le nom de la société est requis' });
  }
  const entreprise = params[cols.indexOf('entreprise')];
  const clientType = cols.includes('client_type') ? params[cols.indexOf('client_type')] : 'pro';
  cols.push('code'); vals.push(`$${i++}`); params.push(await nextClientCode(clientType));
  // La clé de rapprochement suit TOUJOURS le nom de société : c'est elle qui
  // porte l'unicité de la fiche, elle ne peut pas être laissée à la traîne.
  cols.push('cle'); vals.push(`$${i++}`); params.push(clientKey(entreprise));
  let rows;
  try {
    ({ rows } = await pool.query(
      `INSERT INTO clients (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *`, params,
    ));
  } catch (err) {
    // Ce client existe déjà (à la casse et aux accents près). Le dire plutôt que
    // d'en créer une seconde fiche que personne ne saurait plus départager.
    if (err && err.code === '23505') {
      return res.status(409).json({ error: `« ${entreprise} » est déjà dans la base clients` });
    }
    throw err;
  }
  broadcast({ kind: 'client' });
  res.status(201).json(rows[0]);
}));

// PATCH /api/clients/:id → met à jour un ou plusieurs champs (édition en place).
app.patch('/api/clients/:id', exige('clients'), asyncH(async (req, res) => {
  const body = req.body || {};
  const sets = [];
  const params = [];
  let i = 1;
  for (const key of CLIENT_FIELDS) {
    if (!(key in body)) continue;
    const v = validateClientField(key, body[key]);
    if (!v.ok) return res.status(400).json({ error: v.error });
    // L'entreprise ne peut pas être vidée : c'est l'identité du client.
    if (key === 'entreprise' && v.value == null) {
      return res.status(400).json({ error: 'le nom de la société est requis' });
    }
    sets.push(`${key} = $${i++}`); params.push(v.value);
    // Renommer la société déplace le client : sa clé de rapprochement doit
    // suivre dans le même mouvement, sinon la prise de commande continuerait de
    // le retrouver sous son ancien nom — et en créerait une seconde fiche.
    if (key === 'entreprise') { sets.push(`cle = $${i++}`); params.push(clientKey(v.value)); }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
  sets.push('updated_at = now()');
  params.push(req.params.id);
  let rows;
  try {
    ({ rows } = await pool.query(
      `UPDATE clients SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params,
    ));
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'une autre fiche porte déjà ce nom de société' });
    }
    throw err;
  }
  if (rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
  broadcast({ kind: 'client' });
  res.json(rows[0]);
}));

// DELETE /api/clients/:id → supprime le client et ses notes (cascade applicative).
// DELETE /api/clients/:id → DÉSACTIVE la fiche. Ses notes restent.
//
// Elle détruisait la fiche ET tout son historique d'appels, d'emails et de
// rendez-vous. Or les commandes passées citent ce client par son nom : une
// fiche effacée laissait des dossiers rattachés à quelqu'un qui n'existe plus,
// et la timeline qui expliquait pourquoi partait avec.
app.delete('/api/clients/:id', exige('clients'), asyncH(async (req, res) => {
  const { rowCount } = await pool.query(
    `UPDATE clients SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND ${VIVANTES_NU}`, [req.params.id],
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Client introuvable' });
  broadcast({ kind: 'client' });
  res.status(204).end();
}));

// POST /api/clients/:id/notes → ajoute une note (note / appel / email / rdv).
app.post('/api/clients/:id/notes', exige('clients'), asyncH(async (req, res) => {
  const body = req.body || {};
  const kind = NOTE_KINDS.has(body.kind) ? body.kind : 'note';
  const text = String(body.body == null ? '' : body.body).trim().slice(0, NOTE_MAX);
  if (!text) return res.status(400).json({ error: 'la note est vide' });
  const exists = await pool.query(
    `SELECT 1 FROM clients WHERE id = $1 AND ${VIVANTES_NU}`, [req.params.id],
  );
  if (exists.rowCount === 0) return res.status(404).json({ error: 'Client introuvable' });
  const { rows } = await pool.query(
    'INSERT INTO client_notes (client_id, kind, body) VALUES ($1,$2,$3) RETURNING *',
    [req.params.id, kind, text],
  );
  broadcast({ kind: 'client' });
  res.status(201).json(rows[0]);
}));

// DELETE /api/clients/:id/notes/:noteId → retire une note de la timeline.
app.delete('/api/clients/:id/notes/:noteId', exige('clients'), asyncH(async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM client_notes WHERE id = $1 AND client_id = $2',
    [req.params.noteId, req.params.id],
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Note introuvable' });
  broadcast({ kind: 'client' });
  res.status(204).end();
}));

// Crée le client dans la base s'il n'y est pas encore (rapprochement normalisé
// sur le nom de société). Appelé à chaque prise de commande : « si c'est un
// nouveau client, on crée sa fiche ». Ne touche jamais un client déjà présent.
// Enrober l'appel : la fiche client est un CONFORT (elle se recrée à la
// commande suivante), la vente est de l'argent. Si la création de la fiche
// échoue APRÈS l'insertion de la ligne, l'écran ne doit pas annoncer un échec
// pour une vente qui, elle, est bien enregistrée : la vendeuse revalidait, et
// la vente entrait deux fois.
async function upsertClientSansBloquer(cl) {
  try {
    await upsertClientFromCommande(cl);
  } catch (err) {
    console.error('Fiche client non créée (la commande, elle, est enregistrée) :', err);
  }
}

async function upsertClientFromCommande(cl) {
  const entreprise = trimOrNull(cl && cl.societe);
  if (!entreprise) return;
  // Recherche PAR CLÉ, en base. On chargeait toute la table pour comparer en
  // JS : le coût montait avec le fichier client, et surtout deux postes qui
  // prenaient une commande du même nouveau client en même temps lisaient tous
  // les deux « pas encore là » et créaient chacun leur fiche.
  const key = clientKey(entreprise);
  // SANS filtre sur `deleted_at`, et c'est voulu : `idx_clients_cle` est UNIQUE,
  // donc une fiche désactivée occupe toujours sa clé. Ignorer l'archive ferait
  // partir un INSERT qui violerait la contrainte — et la prise de commande
  // échouerait sur un doublon que personne ne voit à l'écran.
  const { rowCount } = await pool.query('SELECT 1 FROM clients WHERE cle = $1 LIMIT 1', [key]);
  if (rowCount) return;
  // La nature pro/perso choisie au comptoir suit le client dans sa fiche ;
  // toute autre valeur (asso/revendeur d'une commande) retombe sur 'pro'.
  const nature = cl.type === 'perso' ? 'perso' : 'pro';
  // Un particulier a un prénom ET un nom : les deux vont dans sa fiche, sinon
  // elle naîtrait à moitié vide et la prochaine commande n'aurait plus que
  // `entreprise` pour retrouver son identité. Un pro n'a qu'un contact.
  const nom = nature === 'perso' ? trimOrNull(cl.nom) : trimOrNull(cl.contact);
  const prenom = nature === 'perso' ? trimOrNull(cl.prenom) : null;
  try {
    await pool.query(
      `INSERT INTO clients (entreprise, nom, prenom, telephone, email, client_type, code, cle)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      // Le CODE aussi. Une fiche née d'une prise de commande n'en recevait
      // aucun, alors que la création manuelle en attribuait un : le fichier du
      // patron avait deux sortes de clients, et la majorité — ceux qui viennent
      // du comptoir — n'avait aucun repère lisible.
      [entreprise, nom, prenom, trimOrNull(cl.telephone), trimOrNull(cl.email), nature,
        await nextClientCode(nature), key],
    );
  } catch (err) {
    // Un autre poste vient de créer la même fiche entre notre lecture et notre
    // écriture : c'est exactement ce qu'on voulait, il n'y en a qu'une.
    if (err && err.code === '23505') return;
    throw err;
  }
  broadcast({ kind: 'client' });
}

// ---------------------------------------------------------------------------
// Listes de référence de la prise de projet (catalog.json).
// Depuis que Nouveau Projet est la seule porte d'entrée, il n'en reste que
// trois : la NATURE de la ligne (demande à chiffrer / commande validée), les
// DÉLAIS raccourcis avec leur majoration, et les MODES de paiement.
// Le catalogue est la source unique ; le serveur revalide tout ce que le poste
// de saisie envoie, et ne lui fait jamais confiance sur les prix.
// ---------------------------------------------------------------------------
const COM = CATALOG.commande;
// Modes acceptés par requests.paiement_mode. Défini ici, à côté du catalogue qui
// en est la source ; validateField le lit à la requête, donc bien après le
// chargement du module.
const PAIEMENT_MODE_SET = new Set(COM.paiementModes.map((p) => p.id));


const OBJET_MAX = 140;          // objet de la demande (titre d'une ligne du planning)
const DESCRIPTION_MAX = 1200;   // description libre de la demande

// Emplacements d'impression ajoutés au comptoir (base), en plus de ceux du
// catalogue. Gardés en MÉMOIRE pour que la validation d'un article reste
// synchrone ; la base n'est relue qu'au démarrage et à chaque ajout / retrait.
let CUSTOM_ZONES = [];
async function loadCommandeZones() {
  CUSTOM_ZONES = await getCommandeZones();
}

// Nouveau Projet demande OÙ enregistrer avant de valider : il lui faut donc le
// pipeline complet (familles + sous-étapes), servi ici plutôt que recopié dans
// le module — une étape ajoutée en base apparaît dans le choix sans retoucher
// le front.
const PIPELINE = STAGES.map((s) => ({ ...s, subs: SUB_STAGES[s.slug] || [] }));

app.get('/api/pipeline', (req, res) => res.json(PIPELINE));






// --- NOUVEAU PROJET -----------------------------------------------------------
// Le flux comptoir : client → panier de produits → prix. Chaque famille a sa
// propre fiche de production (tasse, textile, autres/signalétique), construite
// par la fonction correspondante ci-dessous. Pour la tasse, les options
// référencent des ids du catalogue tarifs (jamais un prix envoyé par le client
// — toujours recalculé depuis `tarifsById` chargé juste avant l'appel) ; le
// prix unitaire, lui, peut être écrasé au comptoir.







// Variables de calcul (taux horaires, TGCA) injectées avant chaque appel à
// buildProjet — évite de faire de buildProjet une fonction async (elle reste
// pure et testable), tout en lisant les tarifs réglés par le patron plutôt que
// des constantes figées dans le code.
let PROJET_TAUX_MO = 25;
let PROJET_TAUX_MACHINE = 25;
let PROJET_TGCA = 0.04;








// ---------------------------------------------------------------------------
// COMPTOIR — les deux parcours validés par le patron (les deux pages HTML de
// `public/comptoir`).
// ⚠ NE PAS Y REMETTRE D'ÉTOILE APRÈS UNE BARRE. Ces deux caractères, même
// dans un commentaire de LIGNE, ouvrent un bloc pour tout lecteur qui
// dépouille les commentaires à l'expression régulière — et plusieurs tests le
// font. Celui-ci avalait alors trois cents lignes du fichier, dont la requête
// qui cherche un dossier par sa référence : le test d'archivage a fini par le
// dire, mais seulement le jour où cette requête a changé de place.
// ---------------------------------------------------------------------------
// Ces écrans ne connaissent RIEN du planning : ils recueillent un dossier
// complet et le postent tel quel. C'est ici qu'il devient une ligne de planning.
// Tout ce qui n'entre pas dans une colonne est conservé dans `fiche` : le
// récapitulatif complet, ligne à ligne, s'ouvre depuis le tiroir de la commande.
// Rien de ce que la vendeuse a saisi ne se perd en route.

// L'étape que nomme le parcours → la FAMILLE du planning.
const COMPTOIR_FAMILLE = {
  demande: 'demande_chiffrage',
  preparation: 'preparation',
  production: 'production',
  facturation: 'facturation',
  cloture: 'paiement',
};
// La sous-étape est donnée par son LIBELLÉ (« Préparation des produits ») :
// c'est ce que le parcours affiche à la vendeuse. On la retrouve par son texte,
// dans sa famille — un libellé inconnu laisse la sous-étape à préciser plutôt
// que de refuser la commande.
const SOUS_ETAPE_PAR_LIBELLE = new Map(
  Object.entries(SUB_STAGES).flatMap(
    ([famille, subs]) => subs.map((s) => [`${famille}|${s.label.toLowerCase()}`, s.slug]),
  ),
);
// La nature du client telle que l'écran la nomme → celle du planning.
const COMPTOIR_CLIENT_TYPE = {
  particulier: 'perso',
  professionnel: 'pro',
  association: 'asso',
  revendeur: 'revendeur',
};

const borner = (v, max) => {
  const s = trimOrNull(v);
  if (s === null) return null;
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
};

// Prix : seule une VENTE en a un. Une demande de devis vaut null — surtout pas
// 0, qui se lit « gratuit » dans la colonne Prix alors qu'il faut le chiffrer.
// Un montant ILLISIBLE n'est pas « pas de prix » : c'est une faute de frappe. On
// la renvoie à l'écran ({ error }) plutôt que d'enregistrer une vente sans
// montant, que personne ne remarque avant la facturation.
function prixComptoir(brut) {
  if (brut == null || brut === '') return { valeur: null };
  const n = Number(brut);
  if (!Number.isFinite(n) || n < 0) return { error: `montant invalide : ${brut}` };
  return { valeur: Math.round(n * 100) / 100 };
}

// EMPREINTE DU DOSSIER — ce qui distingue une commande d'une autre, sans l'heure
// ni rien de ce qui change d'un envoi à l'autre. Elle sert à trancher, quand une
// référence est déjà en base, entre les deux seules explications possibles :
//   - le MÊME dossier renvoyé (le réseau avait avalé la réponse) → on rend la
//     ligne existante, c'est exactement ce qu'on veut ;
//   - un AUTRE dossier qui porte la même référence (deux postes hors réseau se
//     donnent tous deux « DEV-26.08.05-001 ») → jusqu'ici il était jeté EN
//     SILENCE, l'écran annonçant un succès. Il doit vivre, sous une autre
//     référence.
// La RÉFÉRENCE DEMANDÉE en fait partie : sans elle, deux ventes rigoureusement
// identiques du même jour au même client (les mêmes 12 mugs commandés deux fois)
// partageraient une empreinte, et la seconde serait avalée. Un renvoi, lui,
// reposte exactement le même corps — référence comprise.
function empreinteDossier(b, ref, nomDossier, valeur, quantite) {
  const detail = (l) => (Array.isArray(l) ? l.map((x) => (Array.isArray(x) ? x.join('=') : '')).join('|') : '');
  // Séparateur explicite entre les champs : collés bout à bout, « AB » + « C »
  // et « A » + « BC » donneraient la même empreinte — donc deux dossiers
  // distincts pris l'un pour l'autre.
  const brut = [
    String(ref || ''), String(nomDossier || ''),
    valeur == null ? '' : String(valeur), quantite == null ? '' : String(quantite),
    String(b.source || ''), String(b.name || ''), String(b.recap || ''), String(b.comment || ''),
    detail(b.client_info), detail(b.details),
  ].join('\u001f');
  return crypto.createHash('sha256').update(brut, 'utf8').digest('hex').slice(0, 32);
}

// Une référence libre, à partir de celle demandée. On ne renvoie JAMAIS null :
// le seul but de cette fonction est qu'un dossier puisse naître, et une ligne
// sans référence est une ligne qu'on ne sait plus relier à son ticket. Après
// quelques essais lisibles (« -2 », « -3 »…), on tranche avec l'horodatage.
async function refDisponible(ref) {
  // On raccourcit la base pour que le suffixe tienne dans les 40 caractères de
  // la colonne : `borner` y ajouterait des points de suspension, qui n'ont rien
  // à faire dans un numéro de ticket (et pourraient re-collisionner).
  const base = String(ref).slice(0, 30);
  for (let i = 2; i <= 20; i += 1) {
    const essai = `${base}-${i}`;
    const { rowCount } = await pool.query(
      "SELECT 1 FROM requests WHERE fiche->>'ref' = $1 LIMIT 1", [essai],
    );
    if (rowCount === 0) return essai;
  }
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

// « Prénom NOM » d'un particulier : le texte ENTIER reste le nom du dossier
// (c'est lui qui sert de clé de rapprochement, on n'y touche pas). On en tire
// seulement le prénom et le nom pour remplir la fiche de la base clients.
function couperNomPerso(nomComplet) {
  const mots = String(nomComplet || '').trim().split(/\s+/).filter(Boolean);
  if (mots.length < 2) return { prenom: null, nom: mots[0] || null };
  return { prenom: mots[0], nom: mots.slice(1).join(' ') };
}

// UN DOSSIER À LA FOIS. Toute la prise de commande du comptoir — reconnaître un
// renvoi, trouver une référence libre, insérer la ligne — est une suite de
// lectures suivies d'écritures. Lancées en parallèle, ces suites se marchent
// dessus : deux envois du MÊME dossier partis ensemble (la tablette rame, la
// vendeuse tape deux fois) trouvaient tous les deux la base vide de leur
// empreinte, et la vente entrait DEUX FOIS sous le même numéro de ticket.
//
// On les fait donc passer une par une. Le comptoir enregistre quelques dossiers
// par heure et chacun prend quelques millisecondes : la file ne se voit pas.
// C'est le seul endroit de l'application où l'ordre d'arrivée décide de ce qui
// est écrit — ailleurs, chaque requête touche sa propre ligne.
let fileComptoir = Promise.resolve();
// La file avance QUOI QU'IL ARRIVE. Un dossier en erreur ne bloque pas les
// suivants (le `then(travail, travail)`), mais un dossier qui ne REPOND JAMAIS
// — une requête Postgres suspendue avant que les délais du pool n'existent —
// les bloquait tous : le comptoir fermait sans message, pour la journée. Le
// minuteur ne coupe pas le travail en cours (les délais du pool s'en chargent),
// il libère la file pour le client suivant.
const COMPTOIR_TOUR_MAX_MS = 30000;
function unDossierALaFois(travail) {
  const tour = fileComptoir.then(travail, travail);
  const laisserPasser = new Promise((done) => {
    const minuteur = setTimeout(done, COMPTOIR_TOUR_MAX_MS);
    tour.then(() => { clearTimeout(minuteur); done(); },
      () => { clearTimeout(minuteur); done(); });
  });
  fileComptoir = laisserPasser;
  return tour;
}

// POST /api/comptoir/projet → enregistre le dossier d'un des deux parcours.
app.post('/api/comptoir/projet', exige('clients'), asyncH(async (req, res) => unDossierALaFois(async () => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};

  // NATURE : une vente directe est une commande validée et payée ; une demande
  // de devis reste à chiffrer. C'est cette différence qui commande tout le reste.
  const estDemande = b.source === 'Demande de devis';
  // CE QUE LE PARCOURS A DÉSIGNÉ — la famille où ce dossier finira. Il n'y va
  // PAS tout de suite : tout ce qui sort du comptoir atterrit dans le
  // sur-dossier « À trier », en tête du planning. La vendeuse
  // enchaîne ses clients, puis revient ranger. On garde donc la destination
  // dans la fiche, pour que le rangement se fasse d'un seul geste.
  const destination = COMPTOIR_FAMILLE[b.stage] || (estDemande ? 'demande_chiffrage' : 'preparation');
  const destinationSous = SOUS_ETAPE_PAR_LIBELLE.get(`${destination}|${String(b.status || '').toLowerCase()}`) || null;
  const famille = 'a_trier';
  const sousEtape = null;

  const cl = b.clientObj && typeof b.clientObj === 'object' ? b.clientObj : {};
  const nomDossier = borner(cl.company || cl.name || b.client, 120);
  if (!nomDossier) return res.status(400).json({ error: 'le nom du client est requis' });
  const clientType = COMPTOIR_CLIENT_TYPE[String(cl.type || '').toLowerCase()] || 'pro';

  const responsable = RESPONSABLE_SET.has(b.responsible) ? b.responsible : 'À attribuer';
  const priorite = [1, 2, 3].includes(Number(b.priority)) ? Number(b.priority) : 1;
  const quantite = Number.isInteger(Number(b.quantity)) && Number(b.quantity) > 0 ? Number(b.quantity) : null;
  // Une DEMANDE de devis sans date souhaitée n'a pas d'échéance : la dater du
  // jour la faisait paraître en retard dès le lendemain alors que personne n'a
  // rien promis au client. Une VENTE, elle, garde le jour même par défaut.
  const deadline = isDay(b.due) ? b.due : (estDemande ? null : todayPlus(0));
  const prix = estDemande ? { valeur: null } : prixComptoir(b.amount);
  if (prix.error) return res.status(400).json({ error: prix.error });
  const valeur = prix.valeur;

  // COMBIEN DE LIGNES ce dossier va-t-il produire ? Un seul article (ou un
  // écran qui n'en envoie pas) : une ligne, à l'identique de toujours.
  // Plusieurs : une ligne par article, sauf si l'argent ne se découpe pas
  // proprement — auquel cas on préfère une ligne juste à quatre fausses.
  const articles = articlesDuComptoir(b.articles);
  const parts = articles.length > 1 ? partsDuTicket(articles, valeur) : null;
  const lot = articles.length > 1 && parts ? articles : [];
  const nbLignes = lot.length || 1;

  // IDEMPOTENCE. Le réseau de la tablette peut avaler la RÉPONSE d'un envoi qui
  // a pourtant abouti : l'écran annonce un échec, la vendeuse réessaie, et la
  // vente entrait une seconde fois au planning sous le même numéro de ticket.
  // On rend alors la ligne existante au lieu d'en créer une jumelle.
  //
  // MAIS une référence déjà en base ne prouve pas qu'il s'agit du même dossier :
  // quand le compteur du serveur est injoignable, chaque écran se donne une
  // référence de secours, et deux postes hors réseau tombaient sur la MÊME.
  // Le second dossier était alors jeté sans un mot, l'écran annonçant un succès
  // et sautant sur la ligne de la collègue. On compare donc l'empreinte du
  // dossier avant de conclure.
  //
  // C'est donc l'EMPREINTE, pas la référence, qui identifie un dossier. On la
  // cherche en premier : elle reconnaît un renvoi même quand la ligne d'origine
  // a fini sous une autre référence (cas de la collision ci-dessous).
  const ref = borner(b.ref, 40);
  const empreinte = empreinteDossier(b, ref, nomDossier, valeur, quantite);
  // L'empreinte porte un index UNIQUE (voir db.js) : quatre lignes du même
  // dossier ne peuvent pas porter la même. Chacune prend donc son rang en
  // suffixe. Un dossier d'UNE ligne garde l'empreinte nue — le dédoublonnage
  // des dossiers déjà en base reste bit pour bit celui d'avant.
  const empreinteDe = (i) => (nbLignes > 1 ? `${empreinte}#${i + 1}` : empreinte);
  let refFinale = ref;
  let refModifiee = null;
  if (ref) {
    // On interroge l'empreinte de la PREMIÈRE ligne : les quatre naissent dans
    // une seule transaction, la première existe si et seulement si le lot existe.
    const { rows: memeDossier } = await pool.query(
      "SELECT id, stage, sub_stage FROM requests WHERE fiche->>'empreinte' = $1 LIMIT 1", [empreinteDe(0)],
    );
    if (memeDossier.length) {
      return res.json({
        id: memeDossier[0].id, stage: memeDossier[0].stage, subStage: memeDossier[0].sub_stage,
        dejaEnregistre: true,
      });
    }

    const { rows: memeRef } = await pool.query(
      "SELECT id, stage, sub_stage, fiche->>'empreinte' AS empreinte FROM requests WHERE fiche->>'ref' = $1 LIMIT 1",
      [ref],
    );
    if (memeRef.length) {
      // Ligne d'AVANT l'empreinte : on ne peut pas comparer. On garde l'ancien
      // comportement (dédoublonnage) — ces références-là ont toutes été
      // attribuées par le compteur du serveur, elles ne collisionnent pas.
      if (memeRef[0].empreinte == null) {
        return res.json({
          id: memeRef[0].id, stage: memeRef[0].stage, subStage: memeRef[0].sub_stage, dejaEnregistre: true,
        });
      }
      // Un AUTRE dossier porte cette référence : celui-ci vit quand même, sous
      // une référence distincte. C'est le ticket du client qu'il faudra corriger
      // — pas le dossier qu'il faut perdre.
      refFinale = await refDisponible(ref);
      refModifiee = refFinale;
    }
  }

  const pay = b.paiement && typeof b.paiement === 'object' ? b.paiement : {};
  const mode = PAIEMENT_MODE_SET.has(pay.mode) ? pay.mode : null;

  // `fiche` archive le dossier ENTIER, tel que le parcours l'a produit : c'est
  // lui que le tiroir du planning rouvre, ligne à ligne. Jamais retouché ensuite.
  const fiche = {
    kind: 'comptoir-v17',
    source: estDemande ? 'Demande de devis' : 'Vente directe',
    ref: refFinale,
    // Ce qui permettra de reconnaître un RENVOI de ce dossier précis, plus tard,
    // sans le confondre avec un autre qui porterait la même référence.
    empreinte,
    // La référence telle qu'elle figure sur le ticket déjà remis au client,
    // quand on a dû en changer : sinon plus personne ne peut relier les deux.
    refTicket: refModifiee ? ref : undefined,
    creeLe: new Date().toISOString(),
    // Là où ce dossier doit être rangé, tel que le parcours l'a désigné. La
    // grille en fait un bouton : « Ranger dans Préparation du projet ».
    destination: { stage: destination, subStage: destinationSous },
    heureSouhaitee: isHeure(b.dueTime) ? b.dueTime : null,
    production: borner(b.production, 200),
    commentaire: borner(b.comment, DESCRIPTION_MAX),
    // Le budget est INDICATIF : ce que le client a annoncé de vive voix. Illisible
    // ou absent, il ne vaut rien — et surtout il ne fait pas échouer la prise de
    // commande, contrairement au MONTANT de la vente (contrôlé plus haut).
    budgetIndicatif: prixComptoir(b.budgetIndicatif).valeur ?? null,
    canal: borner(b.canal, 60),
    suite: borner(b.suite, 120),
    paiement: { ...pay, mode },
    controles: b.checks && typeof b.checks === 'object' ? b.checks : null,
    // Les deux blocs de libellé/valeur que le parcours a construits pour le
    // ticket : le client d'un côté, le dossier de l'autre.
    client: lignesLibelleValeur(b.client_info),
    details: lignesLibelleValeur(b.details),
  };

  // La colonne « Infos » du planning est une NOTE LIBRE, pas une archive. Elle
  // recevait le récapitulatif IMPRIMÉ — quarante lignes de « Type de dossier :
  // … / Article 1 — Prix personnalisation : 0,00 € » dans une colonne large de
  // deux cents pixels. Le chef d'atelier ne pouvait plus rien y lire, et la
  // note qu'il voulait y écrire se perdait au bout du pavé.
  //
  // RIEN N'EST PERDU : le récapitulatif est archivé en entier dans
  // `fiche.details`, d'où le tiroir du planning et le ticket de l'atelier le
  // relisent déjà, ligne à ligne. Seul ce que la vendeuse a écrit de sa main
  // entre ici — et ce qu'il y a à PRODUIRE a désormais sa place à lui (`prod`).
  const description = borner(b.comment, DESCRIPTION_MAX);

  const { rows: posRows } = await pool.query(
    'SELECT COALESCE(MAX(position), 0) + 1000 AS pos FROM requests WHERE stage = $1', [famille],
  );

  // CE QUE CHAQUE LIGNE PORTE EN PROPRE. Un dossier d'un seul article n'a
  // qu'une entrée, et elle vaut exactement ce que la ligne unique valait avant :
  // aucun chemin nouveau pour le cas courant.
  const lignes = nbLignes > 1
    ? lot.map((a, i) => ({
      // La désignation de l'article devient l'objet de la ligne — c'est ce que
      // l'atelier lit dans la grille. « 10 x Mug • 3 x T-shirt • … » ne disait
      // à personne ce qu'IL avait à faire.
      produit: a.label,
      quantite: a.qte,
      // La part de cet article dans le ticket. La somme des lignes vaut le
      // ticket, à l'euro près (voir partsDuTicket).
      valeur: parts[i],
      // Sa PROPRE date : les mugs vendredi, les casquettes mardi. Sans date à
      // lui, l'article suit celle du dossier.
      deadline: a.due || deadline,
      description: a.detail || description,
      // CE QUE CET ARTICLE-LÀ demande à l'atelier. Il appartient à la LIGNE et
      // pas au dossier : quatre articles, quatre références, quatre séries de
      // tailles — les partager reviendrait à annoncer le même travail partout.
      prod: a.prod,
      chiffrage: a.chiffrage,
      // Le rang sert au suffixe d'empreinte ET à retrouver l'article dans
      // `fiche.details` (« Article 2 — Désignation »), que le ticket relit déjà.
      lot: { ref: refFinale, rang: i + 1, total: nbLignes },
      heure: a.heure,
    }))
    : [{
      produit: borner(b.name, OBJET_MAX),
      quantite,
      valeur,
      deadline,
      description,
      // Un dossier d'un seul article n'a pas de lot, mais il a bien un article :
      // sa ligne mérite la même lecture que les quatre d'un ticket groupé.
      prod: (articles[0] && articles[0].prod) || null,
      chiffrage: (articles[0] && articles[0].chiffrage) || null,
      lot: null,
      heure: null,
    }];

  // UNE SEULE TRANSACTION. Quatre `INSERT` autonomes, c'est un dossier qui peut
  // rester à moitié en base si le réseau tombe entre le deuxième et le
  // troisième : la vendeuse verrait un échec, réessaierait, et l'empreinte des
  // deux premières lignes ferait passer le renvoi pour un doublon — les deux
  // articles manquants n'entreraient JAMAIS. Tout ou rien.
  let rows;
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    rows = [];
    // LE DOSSIER NAÎT ICI, dans la MÊME transaction que ses articles. Créé
    // avant, il resterait en base tout seul si l'insertion échouait — un projet
    // vide, sans article, que personne ne saurait interpréter.
    //
    // Un seul article ne fait PAS de projet : le niveau ne dirait plus rien s'il
    // y avait autant de dossiers que de commandes. C'est le regroupement qui
    // justifie le projet, et lui seul.
    let projetId = null;
    if (nbLignes > 1) {
      // LE NOM SE CONSTRUIT DE CE QU'ON A, pas d'un gabarit. Un dossier sans
      // référence (le comptoir n'en a pas toujours réservé une) donnait
      // « Client — null » ; et le nom de client peut manquer aussi. On assemble
      // donc ce qui existe, dans l'ordre, et on ne colle jamais un tiret sur
      // rien — un titre est la première chose qu'on lit du dossier.
      const bouts = [borner(nomDossier, 120), refFinale].filter(Boolean);
      const nomProjet = bouts.join(' — ') || 'Dossier sans nom';
      const { rows: pr } = await cx.query(
        'INSERT INTO projects (numero, nom, billing_company) VALUES ($1, $2, $3) RETURNING id',
        [refFinale || null, nomProjet, borner(nomDossier, 120) || null],
      );
      projetId = pr[0].id;
    }
    for (let i = 0; i < lignes.length; i += 1) {
      const l = lignes[i];
      const ficheLigne = {
        ...fiche,
        empreinte: empreinteDe(i),
        ...(l.lot ? { lot: l.lot } : {}),
        ...(l.prod ? { prod: l.prod } : {}),
        ...(l.chiffrage ? { chiffrage: l.chiffrage } : {}),
        ...(l.heure ? { heureSouhaitee: l.heure } : {}),
      };
      const { rows: r } = await cx.query(
        `INSERT INTO requests
           (stage, sub_stage, order_kind, responsable, priority, client_type, billing_company,
            contact_referent, contact_phone, contact_email, quantity, product, description,
            deadline, position, fiche, project_value, paye, paiement_mode, project_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING id`,
        [
          famille, sousEtape, estDemande ? 'demande' : 'commande', responsable, priorite,
          clientType, nomDossier,
          borner(cl.contact, 120), borner(cl.phone, 40), borner(cl.email, 160),
          l.quantite, l.produit, l.description,
          // Les rangs se suivent (pos, pos+1, pos+2…) : les lignes d'un même
          // ticket restent CONTIGUËS dans « À trier », ce dont la bannière a
          // besoin. L'écart de 1000 entre deux dossiers laisse la place aux
          // déplacements à la main.
          l.deadline, Number(posRows[0].pos) + i, JSON.stringify(ficheLigne), l.valeur,
          // Un paiement n'existe que sur une vente : une demande ne se prononce
          // pas. Sur un lot, le client a payé le TICKET — les quatre lignes
          // portent donc le même état de paiement, et leurs prix se somment.
          estDemande ? null : !!pay.paye, estDemande ? null : mode,
          projetId,
        ],
      );
      rows.push(r[0]);
    }
    await cx.query('COMMIT');
  } catch (err) {
    await cx.query('ROLLBACK').catch(() => {});
    // La base vient de refuser un dossier dont l'empreinte existe déjà : c'est
    // le MÊME dossier, arrivé deux fois. La file ci-dessus l'empêche déjà au
    // sein d'un serveur ; ce rattrapage vaut pour le jour où il y en aurait
    // deux. On rend la ligne d'origine — exactement ce que la vendeuse attend.
    if (!err || err.code !== '23505') throw err;
    const { rows: dejaLa } = await pool.query(
      "SELECT id, stage, sub_stage FROM requests WHERE fiche->>'empreinte' = $1 LIMIT 1", [empreinteDe(0)],
    );
    if (!dejaLa.length) throw err;
    return res.json({
      id: dejaLa[0].id, stage: dejaLa[0].stage, subStage: dejaLa[0].sub_stage, dejaEnregistre: true,
    });
  } finally {
    cx.release();
  }

  const perso = clientType === 'perso' ? couperNomPerso(nomDossier) : null;
  await upsertClientSansBloquer({
    societe: nomDossier,
    type: clientType,
    contact: trimOrNull(cl.contact),
    nom: perso ? perso.nom : null,
    prenom: perso ? perso.prenom : null,
    telephone: trimOrNull(cl.phone),
    email: trimOrNull(cl.email),
  });

  broadcast({ kind: 'create', stages: [famille] });
  res.status(201).json({
    id: rows[0].id, stage: famille, subStage: sousEtape,
    // Combien de lignes ce dossier a produites, et lesquelles. L'écran de la
    // vendeuse le DIT : « 4 articles → 4 lignes ». Sans ce compte, elle croit
    // avoir enregistré une commande et en trouve quatre au planning.
    ...(nbLignes > 1 ? { lot: { total: nbLignes, ids: rows.map((r) => r.id) } } : {}),
    // Où le dossier ATTEND (`stage`) et où il DOIT aller (`destination`) : deux
    // choses différentes depuis que tout le comptoir passe par le sur-dossier.
    destination: { stage: destination, subStage: destinationSous },
    // Renseigné UNIQUEMENT quand la référence du ticket était déjà prise par une
    // autre commande : l'écran doit le dire, le ticket remis au client ne porte
    // plus le bon numéro.
    ...(refModifiee ? { refModifiee } : {}),
  });
})));

// --- UN DOSSIER, PLUSIEURS TRAVAUX -----------------------------------------
// Un client prend 10 mugs, 3 tee-shirts, 4 décapsuleurs et 10 casquettes. Ce
// n'est pas UN travail, c'en est quatre : les casquettes peuvent partir en
// production pendant que les mugs attendent le fournisseur. Or une étape
// appartient à la LIGNE (« À commander » est une sous-étape de Préparation),
// pas au ticket — tant que le dossier est une seule ligne, il est tout entier
// en attente ou tout entier en production, jamais les deux.
//
// Un dossier à plusieurs articles entre donc au planning en autant de lignes,
// reliées par le numéro de ticket (`fiche.lot`). Le comptoir envoie ses
// articles en clair dans `articles` ; un écran qui n'en envoie pas retombe sur
// UNE ligne, exactement comme avant.
function articlesDuComptoir(brut) {
  if (!Array.isArray(brut)) return [];
  const out = [];
  for (const a of brut) {
    if (!a || typeof a !== 'object') continue;
    const label = borner(a.label, OBJET_MAX);
    if (!label) continue;                       // sans désignation, pas de ligne
    const qte = Number(a.qty);
    out.push({
      label,
      qte: Number.isInteger(qte) && qte > 0 ? qte : null,
      prod: prodDuComptoir(a.prod),
      // CE QUI PERMETTRA DE REFAIRE LE PRIX (28/08). Les paramètres du moteur —
      // référence, genre, transport, emplacement, tailles, remise, majoration —
      // tels que le comptoir les a chiffrés. Sans eux, corriger une quantité au
      // planning laisse le prix de la commande d'origine : le dégressif du
      // fichier V9 ne s'applique plus, et personne ne le voit.
      //
      // Ils ne sont pas dans `prod` : `prod` est ce que la ligne AFFICHE et
      // repart vers chaque poste à chaque rafraîchissement (FICHE_LISTE). Le
      // chiffrage ne se lit pas, il se rejoue — et seulement au serveur.
      chiffrage: chiffrage.bornerChiffrage(a.chiffrage),
      detail: borner(a.detail, DESCRIPTION_MAX) || null,
      due: isDay(a.due) ? a.due : null,
      heure: isHeure(a.heure) ? a.heure : null,
      // `montant` reste BRUT ici : c'est `partsDuTicket` qui décide s'il est
      // exploitable, parce que la décision porte sur le lot entier.
      montant: a.amount,
    });
  }
  return out;
}

// CE QU'IL Y A À FAIRE, EN CHAMPS SÉPARÉS — jamais en phrase. Le comptoir
// l'envoie déjà découpé (référence, couleur, marquage, nombre par taille,
// largeur par face) et on le range tel quel : le chef d'atelier lit sa ligne,
// il ne la déchiffre pas.
//
// TOUT EST BORNÉ, et court. Cette structure est dans FICHE_LISTE : elle repart
// vers chaque poste à chaque rafraîchissement du planning, comme le numéro de
// ticket. Une largeur de logo tient en trois chiffres, une taille en trois
// signes — ce qui déborde n'est pas une mesure, c'est une faute de frappe.
// ⚠ RELEVE DE 12 A 24 LE 04/09/2026. Le compte « 6 tailles, 6 emplacements »
// ne tenait que tant que les tailles etaient les six du tableau. Depuis le
// 03/09 la vendeuse cree ses propres bulles (`taillesLibres`) : une commande de
// staff a neuf tailles ET six emplacements existe, et le plafond la tronquait
// EN SILENCE — des pieces disparaissaient du dossier sans un message nulle
// part. 24 reste borne, et c'est ce qui compte : cette structure repart vers
// chaque poste a chaque rafraichissement du planning.
const PROD_ENTREES_MAX = 24;
function prodDuComptoir(brut) {
  if (!brut || typeof brut !== 'object') return null;
  const mot = (v) => borner(v, 60);
  const tailles = (Array.isArray(brut.tailles) ? brut.tailles : [])
    .slice(0, PROD_ENTREES_MAX)
    .map((x) => ({ t: mot(x && x.t), n: Number(x && x.n) }))
    .filter((x) => x.t && Number.isInteger(x.n) && x.n > 0);
  // UNE ZONE PORTE UNE CONSIGNE, PAS SEULEMENT UNE COTE (26/08). Charlie :
  // « dessus c'est pas des mm mais des noms de logo, des phrases — elle me dit
  // quoi graver ». Sur un textile la largeur vient du catalogue et suffit ; sur
  // une tasse ou une gravure, ce qui compte est CE QU'ON MARQUE, et la mesure
  // se prend à l'établi.
  //
  // Le filtre exigeait une mesure. Les trois faces d'une tasse n'en ont pas :
  // elles n'atteignaient donc même pas la base, et tout le détail repartait
  // dans le pavé de commentaire. Une zone existe dès qu'elle a un NOM.
  const logos = (Array.isArray(brut.logos) ? brut.logos : [])
    .slice(0, PROD_ENTREES_MAX)
    // `quoi` N'EXISTE QUE S'IL EXISTE. Cette structure est dans FICHE_LISTE :
    // elle repart vers CHAQUE poste à chaque rafraîchissement du planning. Un
    // « quoi: null » sur chaque face de chaque textile, c'est du poids sur le
    // fil pour ne rien dire — et ça change la forme des dossiers d'avant.
    .map((x) => {
      const zone = { face: mot(x && x.face), mm: borner(x && x.mm, 120) };
      const quoi = borner(x && x.quoi, 160);
      if (quoi) zone.quoi = quoi;
      return zone;
    })
    .filter((x) => x.face);
  const prod = {
    ref: mot(brut.ref) || '',
    couleur: mot(brut.couleur) || '',
    marquage: mot(brut.marquage) || '',
    // La couleur de l'ENCRE, pas celle du vêtement : elle ne se lit que sur le
    // ticket de l'atelier, là où quelqu'un charge un rouleau.
    encre: mot(brut.encre) || '',
    tailles,
    logos,
  };
  // Un objet vide ne vaut pas la place qu'il prend dans la liste : sans un seul
  // fait, il n'y a rien à afficher et la carte doit l'ignorer.
  return prod.ref || prod.couleur || prod.marquage || prod.encre
    || tailles.length || logos.length ? prod : null;
}

// LA PART DE CHAQUE LIGNE DANS LE TICKET. Règle : la somme des lignes vaut
// EXACTEMENT ce que le client a payé — sinon la colonne Prix du planning ment,
// et toute somme faite dessus ment avec elle. L'écart d'arrondi se pose sur la
// première ligne plutôt que de se diluer.
//
// `null` = on ne sait pas découper proprement (un article sans montant lisible).
// On refuse alors de découper le dossier : une ligne unique au bon prix vaut
// mieux que quatre au mauvais.
function partsDuTicket(articles, total) {
  if (total == null) return articles.map(() => null);   // une demande n'a pas de prix
  const parts = [];
  for (const a of articles) {
    const p = prixComptoir(a.montant);
    if (p.error || p.valeur == null) return null;
    parts.push(p.valeur);
  }
  const somme = parts.reduce((t, v) => t + v, 0);
  const ecart = Math.round((total - somme) * 100) / 100;
  if (ecart) parts[0] = Math.round((parts[0] + ecart) * 100) / 100;
  // Un écart qui rendrait la première ligne négative n'est pas un arrondi :
  // c'est que les montants envoyés ne décrivent pas ce ticket. On ne découpe pas.
  if (parts[0] < 0) return null;
  return parts;
}

// Les récapitulatifs du comptoir arrivent en paires [libellé, valeur]. On les
// range en objets et on jette tout ce qui n'a pas cette forme : la fiche est
// affichée telle quelle dans le tiroir, elle ne doit contenir que du texte.
function lignesLibelleValeur(brut) {
  if (!Array.isArray(brut)) return [];
  return brut
    .filter((l) => Array.isArray(l) && l.length >= 2)
    .map((l) => ({ k: borner(l[0], 120), v: borner(l[1], 600) }))
    .filter((l) => l.k && l.v);
}

// ---------------------------------------------------------------------------
// LE DEVIS CHIFFRÉ — l'écran qui se compose devant le client
// ---------------------------------------------------------------------------
// CE N'EST PAS UNE DEMANDE DE DEVIS. Celle-là entre par le comptoir et vaut
// « à chiffrer » : `project_value` NULL, surtout pas 0, qui se lirait
// « gratuit ». Celui-ci EST le chiffrage : les lignes sont posées, le prix est
// annoncé au client, le papier est imprimé. Il entre donc directement à
// « Demande & chiffrage › Tarif / Devis envoyé – Attente client », avec son
// montant — l'étape dit qu'on a chiffré, une colonne Prix vide la
// contredirait.
//
// LA NATURE RESTE `demande` : le client n'a rien signé. C'est ce qui fait la
// différence avec une vente, et c'est ce que le planning lit pour ne pas
// compter un devis comme du chiffre d'affaires.
//
// L'ARITHMÉTIQUE VIENT DE L'ÉCRAN, comme pour la vente directe du comptoir
// (`prixComptoir` sur `b.amount`) : elle vit une seule fois, dans
// `public/devis.js`, et c'est elle qui a imprimé le papier que le client tient.
// La recalculer ici en donnerait une DEUXIÈME — et le jour où les deux
// divergent, c'est l'archive qui contredit le papier remis au client. Le
// serveur contrôle donc que le montant est un nombre, et archive ce qui a été
// imprimé.
//
// LE PRIX EST FIGÉ. `fiche.devis` porte les lignes telles qu'elles sont sorties
// sur la feuille : un tarif de catalogue qui change demain ne retarife jamais
// ce devis-ci.
app.post('/api/devis', exige('clients'), asyncH(async (req, res) => unDossierALaFois(async () => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const cl = b.client && typeof b.client === 'object' ? b.client : {};

  const nomDossier = borner(cl.nom, 120);
  if (!nomDossier) return res.status(400).json({ error: 'le nom du client est requis' });

  // UN DEVIS SANS LIGNE N'EST PAS UN DEVIS. On refuse plutôt que d'ouvrir un
  // dossier vide au planning, que personne ne saurait relire.
  const lignes = (Array.isArray(b.lignes) ? b.lignes : [])
    .filter((l) => l && typeof l === 'object' && trimOrNull(l.designation))
    .slice(0, 60)
    .map((l) => ({
      designation: borner(l.designation, 200),
      reference: borner(l.reference, 60),
      couleur: borner(l.couleur, 80),
      tailles: borner(l.tailles, 120),
      marquage: borner(l.marquage, 120),
      // CE QU'ON IMPRIME, AVEC QUOI, ET OÙ (02/09). L'atelier les lit sur la
      // fiche, le client sur le devis.
      encre: borner(l.encre, 80),
      faces: borner(l.faces, 160),
      remise: Math.min(100, Math.max(0, Number(l.remise) || 0)),
      note: borner(l.note, 400),
      quantite: Math.max(0, Math.round(Number(l.quantite) || 0)),
      unitaireHt: Math.max(0, Math.round((Number(l.unitaireHt) || 0) * 100) / 100),
      totalHt: Math.max(0, Math.round((Number(l.totalHt) || 0) * 100) / 100),
      // ⚠ « PAS DE PRIX » N'EST PAS « PRIX ZÉRO », ET L'ARCHIVE DOIT S'EN
      // SOUVENIR (02/09). Le montant est rangé à 0 — c'est ce que vaut la
      // ligne dans l'addition — mais un article resté à chiffrer redeviendrait
      // un article OFFERT à la reprise en V2, et le devis suivant partirait
      // avec la promesse de le donner. Le drapeau tient la distinction.
      sansPrix: l.sansPrix === true,
    }));
  if (!lignes.length) return res.status(400).json({ error: 'un devis sans article ne s’enregistre pas' });

  // UN MONTANT ILLISIBLE N'EST PAS « PAS DE PRIX » : c'est une faute de frappe.
  // On la renvoie à l'écran plutôt que d'enregistrer un devis sans montant, que
  // personne ne remarque avant la relance.
  const prix = prixComptoir(b.ttc);
  if (prix.error) return res.status(400).json({ error: prix.error });
  if (prix.valeur == null) return res.status(400).json({ error: 'le montant du devis est requis' });

  // LE NUMÉRO EST CELUI DU PAPIER. L'écran le réserve avant d'imprimer — c'est
  // lui que le client a sous les yeux. S'il n'a rien imprimé, on en réserve un
  // ici : un dossier de devis sans référence ne se retrouve pas.
  let numero = borner(b.numero, 40);
  if (!numero) {
    const r = await reserverNumeroDuJour('devis', { jour: b.jour });
    numero = `DEV-${r.numero}`;
  }

  // LA REPRISE D'UN DEVIS EXISTANT — V2, V3, V4… (02/09/2026)
  // ---------------------------------------------------------------------------
  // Charlie : « ce devis pourra être modifié directement depuis la ligne pour
  // créer la v2, 3, 4… dans le cas où le client souhaite une modification ».
  //
  // UNE VERSION NE REMPLACE PAS LA PRÉCÉDENTE, ELLE LA RANGE. Le client a une
  // feuille en main avec un numéro et un montant : le jour où il rappelle, il
  // faut pouvoir dire ce qu'on lui avait chiffré. La version courante prend donc
  // la place, et l'ancienne descend dans `fiche.devisPassees` — d'où sort
  // l'historique du dossier.
  //
  // ⚠ ET LE DOSSIER NE SE DÉDOUBLE PAS. Créer une deuxième ligne au planning
  // pour le même client et le même projet, c'est deux dossiers qu'il faudra
  // rapprocher à la main, et un des deux qu'on relancera pour rien.
  // ⚠ UN IDENTIFIANT DE DOSSIER EST UNE CHAÎNE, PAS UN NOMBRE. `requests.id` est
  // un UUID : `Number('00000000-0000-4000-…')` rend NaN, la reprise passait pour
  // absente, et l'écran ouvrait un SECOND dossier pour le même client au lieu
  // d'écrire la version 2 sur le premier. Trouvé en le jouant de bout en bout.
  const repriseId = typeof b.dossierId === 'string' && b.dossierId.trim()
    ? b.dossierId.trim().slice(0, 64) : null;
  if (repriseId) {
    // ⚠ UN IDENTIFIANT MAL FORMÉ N'EST PAS UNE PANNE, C'EST UN DOSSIER
    // INTROUVABLE. `requests.id` est un UUID : Postgres refuse la comparaison et
    // lève — l'écran recevait un 500 « erreur interne » là où la seule chose à
    // dire est « ce dossier n'existe pas ».
    let anc = [];
    try {
      ({ rows: anc } = await pool.query('SELECT id, fiche FROM requests WHERE id = $1', [repriseId]));
    } catch (_) { anc = []; }
    if (!anc.length) return res.status(404).json({ error: 'dossier introuvable' });
    const ficheAnc = anc[0].fiche && typeof anc[0].fiche === 'object' ? anc[0].fiche : {};
    if (!String(ficheAnc.kind || '').startsWith('devis')) {
      return res.status(400).json({ error: 'ce dossier n’est pas un devis' });
    }
    const version = Math.max(1, Math.round(Number(ficheAnc.version) || 1)) + 1;
    // LE NUMÉRO GARDE SA RACINE et gagne son rang : « DEV-26.09.02-001-V2 ». Le
    // client retrouve son devis, et on sait tout de suite laquelle des deux
    // feuilles il a sous les yeux.
    const racine = String(ficheAnc.devis && ficheAnc.devis.numero ? ficheAnc.devis.numero : numero)
      .replace(/-V\d+$/, '');
    numero = `${racine}-V${version}`;
  } else {
    // IDEMPOTENCE. Le réseau peut avaler la RÉPONSE d'un envoi qui a pourtant
    // abouti : l'écran annonce un échec, on réessaie, et le devis entrerait une
    // seconde fois sous le même numéro. On rend alors la ligne existante.
    const { rows: deja } = await pool.query(
      "SELECT id, stage, sub_stage FROM requests WHERE fiche->>'ref' = $1 LIMIT 1", [numero],
    );
    if (deja.length) {
      return res.json({
        id: deja[0].id, stage: deja[0].stage, subStage: deja[0].sub_stage,
        numero, dejaEnregistre: true,
      });
    }
  }

  // ⚠ LE DEVIS ENTRE PAR « À TRIER » (02/09, Charlie). Il allait droit à
  // « Demande & chiffrage / Devis envoyé — Attente client », ce qui répondait à
  // la question « qui le relance ? » mais présumait de la suivante : un devis
  // composé devant un client n'est pas forcément un devis PARTI. « À trier » est
  // le sur-dossier de l'atelier — la corbeille d'entrée qu'on vide chaque matin
  // — et c'est de là qu'il se range.
  const famille = 'a_trier';
  const sousEtape = null;
  const clientType = COMPTOIR_CLIENT_TYPE[String(cl.type || '').toLowerCase()] || 'pro';
  const responsable = RESPONSABLE_SET.has(b.responsable) ? b.responsable : 'À attribuer';
  const quantite = lignes.reduce((t, l) => t + l.quantite, 0) || null;
  // CE QU'ON PRODUIT, EN UN MOT : la première désignation, et le nombre des
  // autres. La colonne « Article » du planning fait deux cents pixels — y
  // déverser quatre désignations n'y rend rien lisible, et le détail complet
  // est de toute façon dans la fiche.
  const produit = lignes.length > 1
    ? borner(`${lignes[0].designation} + ${lignes.length - 1} autre${lignes.length > 2 ? 's' : ''}`, 200)
    : lignes[0].designation;

  // Traduit AVANT la fiche, pour que la clé puisse ne pas exister du tout (voir
  // le commentaire de `prod` plus bas). Une reprise V2/V3 le reprend par le
  // `...fiche` de `neuve` : elle porte donc le `prod` de SA version, pas celui
  // de la précédente — un devis qui passe d'un article à trois cesse d'en avoir
  // un, et c'est juste.
  const prodDevis = prodDuComptoir(Array.isArray(b.prod) ? b.prod[0] : null);

  const fiche = {
    kind: 'devis-v1',
    source: 'Devis',
    ref: numero,
    creeLe: new Date().toISOString(),
    // LE RANG DE CETTE VERSION. 1 au premier enregistrement, puis 2, 3, 4 à
    // chaque reprise. ⚠ Ce n'est PAS `kind` : `devis-v1` nomme la FORME de la
    // fiche (le format de données), celle-ci nomme la version du DEVIS remis au
    // client. Deux choses qui n'ont aucune raison de bouger ensemble.
    version: 1,
    // CE QUI SUIT LE DOSSIER SANS S'IMPRIMER : l'heure de retrait souhaitée, le
    // travail de maquette à prévoir, et ce qu'on se dit entre nous.
    dueHeure: /^\d{2}:\d{2}$/.test(String(b.dueHeure || '')) ? b.dueHeure : null,
    maquette: b.maquette === true,
    noteInterne: borner(b.noteInterne, 600),
    // CE QU'IL Y A À PRODUIRE (04/09/2026). Un dossier né d'un devis n'en
    // portait RIEN : la fiche atelier s'ouvrait vide, le ticket sortait sans
    // les tailles, et le BAT n'avait rien à se mettre. Le détail vivait dans
    // `devis.lignes[]`, en texte, sous une forme qu'aucun de ces trois écrans
    // ne lit — ils lisent tous `fiche.prod`, et lui seul.
    //
    // ⚠ SEULEMENT SUR UN DEVIS À UN SEUL ARTICLE, et c'est la même règle que
    // la route du comptoir applique déjà à un panier d'un article : à
    // plusieurs, le dossier n'ouvre pour l'instant qu'UNE ligne au planning, et
    // y écrire le premier article ferait passer la ligne entière pour lui.
    // Deux articles sur une ligne, ce n'est pas une production à moitié
    // décrite, c'est une production FAUSSE. Le découpage en une ligne par
    // article lève cette réserve — l'écran envoie déjà les N.
    //
    // `prodDuComptoir` rend `null` sur un article qui ne porte aucun fait : on
    // n'écrit alors PAS la clé, plutôt qu'un `prod: null` que chaque poste
    // recevrait à chaque rafraîchissement pour ne rien dire.
    ...(lignes.length === 1 && prodDevis ? { prod: prodDevis } : {}),
    // LE DEVIS TEL QU'IL A ÉTÉ IMPRIMÉ. C'est l'archive : elle ne se retouche
    // pas, et c'est elle qu'on ressort quand le client revient avec sa feuille.
    devis: {
      numero,
      date: isDay(b.date) ? b.date : todayPlus(0),
      validite: isDay(b.validite) ? b.validite : null,
      projet: borner(b.projet, 120),
      appro: borner(b.appro, 40),
      regime: borner(b.regime, 40),
      tauxTgca: Number(b.tauxTgca) || 0,
      arrondi: borner(b.arrondi, 20),
      // LA BASCULE VEDETTE (03/09/2026) — lequel des deux totaux est le géant
      // de la feuille. Elle ne touche à aucun montant.
      vedette: b.vedette === 'ht' ? 'ht' : 'ttc',
      // L'AJUSTEMENT GLOBAL (03/09/2026) — remise ou majoration négociée sur
      // l'ensemble, en plus des remises par article. Un montant NÉGATIF est
      // une remise : `prixComptoir` le refuserait, donc on borne ici.
      ajustement: {
        unite: b.ajustementUnite === 'pct' ? 'pct' : 'eur',
        valeur: Number.isFinite(Number(b.ajustementValeur))
          ? Math.max(-1000000, Math.min(1000000, Math.round(Number(b.ajustementValeur) * 100) / 100)) : 0,
        montant: Number.isFinite(Number(b.ajustementMontant))
          ? Math.max(-1000000, Math.min(1000000, Math.round(Number(b.ajustementMontant) * 100) / 100)) : 0,
      },
      lignes,
      sousTotalHt: prixComptoir(b.sousTotalHt).valeur ?? null,
      totalHt: prixComptoir(b.totalHt).valeur ?? null,
      taxe: prixComptoir(b.taxe).valeur ?? null,
      ttc: prix.valeur,
      acompte: {
        // UN POURCENTAGE LIBRE (03/09/2026) — plus un menu figé à 0/30/50/100.
        pourcent: Math.min(100, Math.max(0, Number(b.acomptePourcent) || 0)),
        montant: prixComptoir(b.acompteMontant).valeur ?? null,
      },
    },
    client: [
      ['Client', nomDossier], ['Code client', borner(cl.code, 20)],
      ['Ville', borner(cl.ville, 120)], ['Personne à contacter', borner(cl.contact, 120)],
      ['Téléphone', borner(cl.tel, 40)], ['WhatsApp', borner(cl.whatsapp, 40)],
      ['E-mail', borner(cl.email, 160)],
    ].filter(([, v]) => v).map(([k, v]) => ({ k, v })),
  };

  // UNE REPRISE ÉCRIT SUR LE DOSSIER, ELLE N'EN OUVRE PAS UN SECOND.
  if (repriseId) {
    const { rows: anc } = await pool.query('SELECT fiche FROM requests WHERE id = $1', [repriseId]);
    const ficheAnc = anc.length && anc[0].fiche && typeof anc[0].fiche === 'object' ? anc[0].fiche : {};
    const version = Math.max(1, Math.round(Number(ficheAnc.version) || 1)) + 1;
    // LES VERSIONS PASSÉES, DE LA PLUS RÉCENTE À LA PLUS ANCIENNE, et bornées :
    // une fiche qu'on reprend vingt fois ne doit pas devenir un objet d'un méga.
    const passees = Array.isArray(ficheAnc.devisPassees) ? ficheAnc.devisPassees : [];
    const neuve = {
      ...fiche,
      version,
      creeLe: ficheAnc.creeLe || fiche.creeLe,
      repriseLe: new Date().toISOString(),
      devisPassees: (ficheAnc.devis
        ? [{ version: Math.max(1, Number(ficheAnc.version) || 1), devis: ficheAnc.devis }, ...passees]
        : passees).slice(0, 20),
    };
    await pool.query(
      `UPDATE requests SET billing_company = $2, contact_referent = $3, contact_phone = $4,
              contact_email = $5, quantity = $6, product = $7, description = $8,
              deadline = $9, fiche = $10, project_value = $11, client_type = $12
       WHERE id = $1`,
      [
        repriseId, nomDossier, borner(cl.contact, 120), borner(cl.tel, 40),
        borner(cl.email, 160), quantite, produit, borner(b.projet, DESCRIPTION_MAX),
        isDay(b.dueDate) ? b.dueDate : null, JSON.stringify(neuve), prix.valeur, clientType,
      ],
    );
    // LE JOURNAL DIT QU'UNE VERSION EST NÉE. Sans lui, le montant du dossier
    // change tout seul entre deux relectures et personne ne sait pourquoi.
    await pool.query(
      'INSERT INTO request_events (request_id, field, value_before, value_after, who) VALUES ($1,$2,$3,$4,$5)',
      [repriseId, 'devis',
        `V${version - 1}${ficheAnc.devis && ficheAnc.devis.ttc != null ? ` — ${ficheAnc.devis.ttc} €` : ''}`,
        `V${version} — ${prix.valeur} €`, quiDemande(req)],
    ).catch(() => { /* le journal est un confort, il ne fait pas échouer la reprise */ });
    broadcast({ kind: 'update', ids: [repriseId] });
    return res.json({ id: repriseId, stage: null, numero, version, reprise: true });
  }

  const { rows: posRows } = await pool.query(
    'SELECT COALESCE(MAX(position), 0) + 1000 AS pos FROM requests WHERE stage = $1', [famille],
  );
  const { rows } = await pool.query(
    `INSERT INTO requests
       (stage, sub_stage, order_kind, responsable, priority, client_type, billing_company,
        contact_referent, contact_phone, contact_email, quantity, product, description,
        deadline, position, fiche, project_value)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING id`,
    [
      famille, sousEtape, 'demande', responsable, 1, clientType, nomDossier,
      borner(cl.contact, 120), borner(cl.tel, 40), borner(cl.email, 160),
      quantite, produit, borner(b.projet, DESCRIPTION_MAX),
      // UNE DATE SOUHAITÉE N'EST PAS UNE PROMESSE. Sans elle le dossier n'a pas
      // d'échéance : la dater du jour le ferait paraître en retard dès demain
      // alors que personne n'a rien promis au client.
      isDay(b.dueDate) ? b.dueDate : null,
      posRows[0].pos, JSON.stringify(fiche), prix.valeur,
    ],
  );

  await upsertClientSansBloquer({
    societe: nomDossier,
    type: clientType,
    contact: trimOrNull(cl.contact),
    telephone: trimOrNull(cl.tel),
    email: trimOrNull(cl.email),
  });

  broadcast({ kind: 'create', stages: [famille] });
  res.status(201).json({ id: rows[0].id, stage: famille, subStage: sousEtape, numero });
})));

// POST /api/vente/numero → réserve le numéro du ticket de vente directe,
// « 26.07.30-001 » : deux chiffres d'année, mois, jour, puis le rang de la vente
// DANS LA JOURNÉE. Le compteur vit en app_meta (même principe que les codes
// clients) : deux comptoirs qui encaissent en même temps ne peuvent pas remettre
// le même numéro au client, et un numéro attribué n'est jamais réutilisé.
// Le jour est celui du POSTE (`jour`, aaaa-mm-jj) : le conteneur tourne en UTC,
// il basculerait au lendemain dès 20 h à Saint-Martin.
app.post('/api/vente/numero', exige('clients'), asyncH(async (req, res) => {
  const r = await reserverNumeroDuJour('vente', req.body || {});
  res.status(201).json(r);
}));

// POST /api/devis/numero → même compteur, même garantie, pour la DEMANDE DE
// DEVIS : « DEV-26.07.30-001 ». Deux séries distinctes et deux clés app_meta
// distinctes — une demande et une vente du même jour ne se disputent pas un
// rang, et le préfixe dit du premier coup d'œil ce qu'on a en main.
app.post('/api/devis/numero', exige('clients'), asyncH(async (req, res) => {
  const r = await reserverNumeroDuJour('devis', req.body || {});
  res.status(201).json({ ...r, numero: `DEV-${r.numero}` });
}));

async function reserverNumeroDuJour(serie, body) {
  const jour = isDay(body.jour) ? body.jour : todayPlus(0);
  const [y, m, d] = jour.split('-');
  const metaKey = `${serie}_seq_${y}${m}${d}`;
  // UNE seule requête, atomique : PostgreSQL sérialise les écritures sur la
  // même clé. En lecture-puis-écriture (SELECT, DELETE, INSERT), deux comptoirs
  // qui encaissaient dans la même fraction de seconde lisaient la même valeur
  // et remettaient le MÊME numéro de ticket à deux clients différents.
  const { rows } = await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ($1, '1')
     ON CONFLICT (key) DO UPDATE SET value = ((app_meta.value)::int + 1)::text
     RETURNING value`,
    [metaKey],
  );
  const rang = Number.parseInt(rows[0].value, 10);
  return { numero: `${y.slice(2)}.${m}.${d}-${String(rang).padStart(3, '0')}`, jour, rang };
}

// ---------------------------------------------------------------------------
// LA FACTURE — numérotation continue, émission immuable (03/09/2026)
// ---------------------------------------------------------------------------
// DIFFÉRENCE VOLONTAIRE AVEC LE NUMÉRO DE DEVIS : celui-là se réserve CÔTÉ
// ÉCRAN, avant même d'enregistrer (voir imprimer(), devis-flash.js) — un
// devis imprimé puis abandonné laisse un trou, tolérable pour un document
// sans valeur comptable. Une facture ne peut pas se permettre ce trou : la
// réservation du numéro et l'insertion de la ligne se font dans LA MÊME
// transaction. Un rejet (validation, coupure réseau avant écriture) annule
// les deux ensemble.
async function reserverNumeroFacture(cx, annee) {
  const metaKey = `facture_seq_${annee}`;
  const { rows } = await cx.query(
    `INSERT INTO app_meta (key, value) VALUES ($1, '1')
     ON CONFLICT (key) DO UPDATE SET value = ((app_meta.value)::int + 1)::text
     RETURNING value`,
    [metaKey],
  );
  const rang = Number.parseInt(rows[0].value, 10);
  return { numero: `FA-${annee}-${String(rang).padStart(4, '0')}`, rang };
}

// SA PROPRE SÉRIE, SON PROPRE COMPTEUR. `avoir_seq_<annee>`, jamais celui des
// factures : deux séries qui se partagent un compteur donnent deux suites
// trouées, et un trou dans une suite est exactement ce qu'un contrôle cherche.
// Réservé DANS la transaction d'insertion, pour la même raison qu'un numéro de
// facture — un rejet annule le rang avec la ligne.
async function reserverNumeroAvoir(cx, annee) {
  const metaKey = `avoir_seq_${annee}`;
  const { rows } = await cx.query(
    `INSERT INTO app_meta (key, value) VALUES ($1, '1')
     ON CONFLICT (key) DO UPDATE SET value = ((app_meta.value)::int + 1)::text
     RETURNING value`,
    [metaKey],
  );
  const rang = Number.parseInt(rows[0].value, 10);
  return { numero: `AV-${annee}-${String(rang).padStart(4, '0')}`, rang };
}

// POST /api/factures → émet une facture pour un dossier déjà créé par
// POST /api/comptoir/projet. IDEMPOTENT sur `dossierId` : une resoumission
// après perte de réponse réseau (le grand classique du comptoir — voir
// comptoir-dossiers-perdus-silence) retombe sur la ligne déjà créée au lieu
// de brûler un second numéro.
app.post('/api/factures', exige('clients'), asyncH(async (req, res) => unDossierALaFois(async () => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};

  const dossierId = trimOrNull(b.dossierId);
  if (!dossierId) return res.status(400).json({ error: 'dossierId requis' });

  // RETOMBÉE IDEMPOTENTE — AUCUN numéro consommé sur ce chemin.
  const { rows: existante } = await pool.query(
    'SELECT id, numero, document, montant_ttc FROM invoices WHERE dossier_id = $1', [dossierId],
  );
  if (existante.length) {
    return res.status(201).json({
      id: existante[0].id, numero: existante[0].numero, montantTtc: Number(existante[0].montant_ttc), document: existante[0].document,
    });
  }

  const cl = b.client && typeof b.client === 'object' ? b.client : {};
  const nomClient = borner(cl.nom, 120);
  if (!nomClient) return res.status(400).json({ error: 'le nom du client est requis' });
  const client = {
    nom: nomClient,
    // L'ADRESSE DU CLIENT — mention obligatoire de la facture. Acceptée VIDE :
    // au comptoir, un particulier qui paie comptant n'a pas toujours donné la
    // sienne, et refuser l'émission ferait attendre la file pour une donnée
    // qu'on peut compléter dans la fiche client. L'écran la SIGNALE quand le
    // client est un PROFESSIONNEL (compteur d'émission, vente-flash.js) sans
    // jamais bloquer : c'est là que le manque coûte, la facture partant chez
    // un comptable.
    adresse: borner(cl.adresse, 160),
    ville: borner(cl.ville, 80),
    contact: borner(cl.contact, 120),
    tel: borner(cl.tel, 40),
    email: borner(cl.email, 160),
    type: cl.type === 'perso' ? 'perso' : 'pro',
  };

  const mode = b.mode;
  if (!PAIEMENT_MODE_SET.has(mode)) return res.status(400).json({ error: `mode de paiement invalide : ${mode}` });

  const lignes = (Array.isArray(b.lignes) ? b.lignes : [])
    .filter((l) => l && typeof l === 'object' && trimOrNull(l.designation))
    .slice(0, 60)
    .map((l) => ({
      designation: borner(l.designation, 200),
      reference: borner(l.reference, 60),
      couleur: borner(l.couleur, 80),
      tailles: borner(l.tailles, 120),
      marquage: borner(l.marquage, 120),
      encre: borner(l.encre, 80),
      faces: borner(l.faces, 160),
      note: borner(l.note, 400),
      quantite: Math.max(0, Math.round(Number(l.quantite) || 0)),
      unitaireHt: Math.max(0, Math.round((Number(l.unitaireHt) || 0) * 100) / 100),
    }));
  if (!lignes.length) return res.status(400).json({ error: 'une facture sans article ne s’émet pas' });
  // UNE FACTURE NE PORTE JAMAIS DE LIGNE SANS PRIX : contrairement au devis,
  // une vente déjà réglée connaît tous ses prix. Un zéro ici est un article
  // OFFERT (voulu), pas une case oubliée.
  if (lignes.some((l) => l.unitaireHt == null)) {
    return res.status(400).json({ error: 'toutes les lignes doivent porter un prix' });
  }

  const jour = isDay(b.jour) ? b.jour : todayPlus(0);
  const annee = Number(jour.slice(0, 4));

  // L'ADDITION EST REJOUÉE ICI, PAS IMPORTÉE. `calculerDevis` vit dans
  // public/devis.js — un module ES pensé pour le navigateur (`import`/
  // `export`) que `server.js` (CommonJS) n'exécute pas. Le serveur est
  // pourtant la SEULE autorité sur le total archivé : il ne fait pas
  // confiance à un TTC calculé côté client et simplement recopié. Même
  // arithmétique que `calculerDevis` (arrondi TTC, puis HT au centime, la
  // taxe est ce qui reste) — voir devis.js si les deux doivent un jour être
  // unifiées (hors scope de ce lot).
  // LE RÉGIME SE DÉCIDE UNE FOIS, ici, et sert PARTOUT ensuite : le taux, le
  // document archivé, la mention d'exonération. Il était relu de `b.regime` à
  // deux endroits — deux lectures, deux vérités le jour où l'une bouge.
  const regime = b.regime === 'revente' || b.regime === 'export' ? b.regime : 'tgca';
  const sousTotalHt = Math.round(lignes.reduce((t, l) => t + l.quantite * l.unitaireHt, 0) * 100) / 100;
  const ajustementUnite = b.ajustement && b.ajustement.unite === 'pct' ? 'pct' : 'eur';
  const ajustementValeur = Number(b.ajustement && b.ajustement.valeur) || 0;
  const ajustementMontant = Math.round((ajustementUnite === 'pct'
    ? sousTotalHt * (ajustementValeur / 100) : ajustementValeur) * 100) / 100;
  const sousTotalAjuste = Math.round((sousTotalHt + ajustementMontant) * 100) / 100;
  const taux = regime === 'tgca' ? Math.max(0, Number(b.tauxTgca) || 0) : 0;
  const vise = Math.round(sousTotalAjuste * (1 + taux) * 100) / 100;
  let ttc = vise;
  if (b.arrondi === 'euro') ttc = Math.floor(vise + 1e-9);
  else if (b.arrondi === 'dix') ttc = Math.floor(vise * 10 + 1e-9) / 10;
  ttc = Math.round(ttc * 100) / 100;

  // ⚠ CE QUI EST ARCHIVÉ EST LA DONNÉE BRUTE, PAS UN RENDU. Le serveur ne
  // formate rien (pas d'euro(), pas de maisonPapier()) : `modeleFacture` /
  // `dessinerFacture` (public/facture.js) sont les SEULS à savoir composer un
  // papier, et ils tournent CÔTÉ CLIENT — c'est la séparation déjà en place
  // pour les trois autres papiers (« cet écran ne dessine aucun document »,
  // voir devis-flash.js). `document.saisie` porte donc exactement la forme
  // que `modeleFacture(saisie, entreprise)` attend en entrée ; `document.
  // entreprise` fige l'identité de l'atelier TELLE QU'ELLE ÉTAIT à l'émission
  // — un changement plus tard dans Réglages ne doit jamais réécrire une
  // facture déjà sortie. La relecture (GET ci-dessous) rend cette paire telle
  // quelle ; c'est `ouvrirFacture` (app.js) qui rappelle `modeleFacture` avec,
  // exactement comme le fait l'écran de composition pour l'aperçu vivant.
  const entreprise = await getEntreprise();
  // LA PHRASE D'EXONÉRATION EST FIGÉE ICI, comme l'identité : la facture porte
  // celle du jour de l'émission, et un changement de texte plus tard ne
  // réécrit rien. Le serveur la lit LUI-MÊME plutôt que de croire l'écran —
  // c'est une mention légale, pas une préférence d'affichage.
  const mentionRegime = (await getMentionsRegime())[regime] || '';

  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    const { numero, rang } = await reserverNumeroFacture(cx, annee);
    const document = {
      saisie: {
        numero,
        date: jour,
        projet: borner(b.projet, 160),
        client,
        lignes,
        regime,
        mentionRegime,
        tauxTgca: Number(b.tauxTgca) || 0,
        arrondi: ['euro', 'dix'].includes(b.arrondi) ? b.arrondi : 'aucun',
        ajustement: { unite: ajustementUnite, valeur: ajustementValeur },
        vedette: b.vedette === 'ht' ? 'ht' : 'ttc',
        mode,
      },
      entreprise,
    };
    const { rows } = await cx.query(
      `INSERT INTO invoices (numero, annee, rang, dossier_id, client_nom, montant_ttc, emise_par, document)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, numero, document, montant_ttc`,
      [numero, annee, rang, dossierId, nomClient, ttc, borner(req.headers['x-qui'] ? decodeURIComponent(req.headers['x-qui']) : null, 80), document],
    );
    // LE DOSSIER SAIT QU'IL EST FACTURÉ. Sans cette marque, rien dans la
    // fiche ne distingue un dossier facturé d'un autre — et le bouton
    // « Facture » aurait dû paraître partout pour ne mener nulle part la
    // plupart du temps, ce qu'on n'apprend qu'à ne plus lire (même règle que
    // « Reprendre le devis », fiche-atelier.js).
    //
    // ON FUSIONNE EN JS PLUTÔT QU'EN SQL : `fiche || $1::jsonb` demanderait à
    // pg-mem un opérateur jsonb qu'elle n'a pas, et la base locale de test est
    // la seule qu'on puisse casser sans le voir. La transaction et
    // `unDossierALaFois` tiennent déjà la concurrence.
    const { rows: dossierRows } = await cx.query('SELECT fiche FROM requests WHERE id = $1', [dossierId]);
    if (dossierRows.length) {
      const ficheDossier = (dossierRows[0].fiche && typeof dossierRows[0].fiche === 'object') ? dossierRows[0].fiche : {};
      await cx.query('UPDATE requests SET fiche = $1 WHERE id = $2',
        [{ ...ficheDossier, factureNumero: numero, factureId: rows[0].id }, dossierId]);
    }
    await cx.query('COMMIT');
    return res.status(201).json({
      id: rows[0].id, numero: rows[0].numero, montantTtc: Number(rows[0].montant_ttc), document: rows[0].document,
    });
  } catch (err) {
    await cx.query('ROLLBACK');
    // UN AUTRE APPEL A GAGNÉ LA COURSE entre notre lecture d'idempotence et
    // notre écriture (contrainte UNIQUE(dossier_id)) : on rend SA facture,
    // pas une erreur — c'est le même dossier, la même intention.
    if (err && err.code === '23505') {
      const { rows: apres } = await pool.query(
        'SELECT id, numero, document, montant_ttc FROM invoices WHERE dossier_id = $1', [dossierId],
      );
      if (apres.length) {
        return res.status(201).json({
          id: apres[0].id, numero: apres[0].numero, montantTtc: Number(apres[0].montant_ttc), document: apres[0].document,
        });
      }
    }
    throw err;
  } finally {
    cx.release();
  }
})));

// ---------------------------------------------------------------------------
// L'AVOIR — la SEULE façon de corriger une facture (03/09/2026)
// ---------------------------------------------------------------------------
// UNE FACTURE ÉMISE NE SE MODIFIE NI NE S'EFFACE : c'est ce qui fait qu'un
// journal de ventes vaut quelque chose. Une erreur, un retour, une annulation
// se rattrapent donc par un document DE PLUS, qui cite celui qu'il corrige.
//
// ⚠ L'AVOIR NE RELIT AUCUN RÉGLAGE. Régime, taux, arrondi, identité de
// l'atelier, mention d'exonération : TOUT vient du `document` archivé de la
// facture corrigée. Un avoir qui rendrait 4 % de TGCA sur une facture émise à
// 3 % ne corrigerait pas cette facture-là, il en inventerait une autre. C'est
// la même règle que « un prix de catalogue ne retarife jamais une commande
// passée », appliquée un cran plus haut.
//
// L'AJUSTEMENT GLOBAL SUIT AU PRORATA du HT rendu. Sur un avoir TOTAL le
// prorata vaut 1 et le TTC retombe au centime sur celui de la facture — c'est
// la propriété qui compte, et un test la tient. Sur un avoir partiel, une
// remise négociée sur l'ensemble se rend dans la proportion de ce qu'on rend.
const avoirLignes = (brutes) => (Array.isArray(brutes) ? brutes : [])
  .filter((l) => l && typeof l === 'object' && trimOrNull(l.designation))
  .slice(0, 60)
  .map((l) => ({
    designation: borner(l.designation, 200),
    reference: borner(l.reference, 60),
    couleur: borner(l.couleur, 80),
    tailles: borner(l.tailles, 120),
    marquage: borner(l.marquage, 120),
    encre: borner(l.encre, 80),
    faces: borner(l.faces, 160),
    note: borner(l.note, 400),
    quantite: Math.max(0, Math.round(Number(l.quantite) || 0)),
    unitaireHt: Math.max(0, Math.round((Number(l.unitaireHt) || 0) * 100) / 100),
  }));

app.post('/api/avoirs', exige('argent'), asyncH(async (req, res) => unDossierALaFois(async () => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};

  // LA CLÉ VIENT DE L'ÉCRAN, tirée à l'OUVERTURE du formulaire. C'est elle qui
  // protège du doublon quand le réseau avale la réponse : la resoumission
  // porte la même clé et retombe sur la ligne déjà écrite. Deux avoirs VOULUS
  // viennent de deux formulaires, donc de deux clés — c'est pour ça qu'on ne
  // dédoublonne PAS sur `invoice_id` (une facture peut recevoir plusieurs
  // avoirs partiels).
  const cle = borner(b.cle, 80);
  if (!cle) return res.status(400).json({ error: 'cle requise' });

  const { rows: deja } = await pool.query(
    'SELECT id, numero, document, montant_ttc FROM credit_notes WHERE cle = $1', [cle],
  );
  if (deja.length) {
    return res.status(201).json({
      id: deja[0].id, numero: deja[0].numero, montantTtc: Number(deja[0].montant_ttc), document: deja[0].document,
    });
  }

  const invoiceId = trimOrNull(b.invoiceId);
  if (!invoiceId) return res.status(400).json({ error: 'invoiceId requis' });
  const { rows: fRows } = await pool.query(
    'SELECT id, numero, client_nom, montant_ttc, document FROM invoices WHERE id = $1', [invoiceId],
  );
  if (!fRows.length) return res.status(404).json({ error: 'Facture introuvable' });
  const facture = fRows[0];
  const source = (facture.document && facture.document.saisie) || {};

  const lignes = avoirLignes(b.lignes);
  if (!lignes.length) return res.status(400).json({ error: 'un avoir sans ligne ne s’émet pas' });

  // L'ARITHMÉTIQUE DE LA FACTURE CORRIGÉE, pas celle du jour.
  const tauxSource = source.regime === 'tgca' ? Math.max(0, Number(source.tauxTgca) || 0) : 0;
  const sousTotalHt = Math.round(lignes.reduce((t, l) => t + l.quantite * l.unitaireHt, 0) * 100) / 100;
  const htFacture = Math.round((Array.isArray(source.lignes) ? source.lignes : [])
    .reduce((t, l) => t + (Number(l.quantite) || 0) * (Number(l.unitaireHt) || 0), 0) * 100) / 100;
  // Prorata borné à 1 : un avoir ne rend pas plus de remise qu'il n'y en avait.
  const part = htFacture > 0 ? Math.min(1, sousTotalHt / htFacture) : 0;
  const ajSource = (source.ajustement && typeof source.ajustement === 'object') ? source.ajustement : { unite: 'eur', valeur: 0 };
  const ajUnite = ajSource.unite === 'pct' ? 'pct' : 'eur';
  // En POURCENTAGE, la valeur s'applique déjà au sous-total rendu : le prorata
  // est dans l'assiette, l'appliquer une seconde fois le compterait deux fois.
  const ajValeur = ajUnite === 'pct' ? (Number(ajSource.valeur) || 0)
    : Math.round((Number(ajSource.valeur) || 0) * part * 100) / 100;
  const ajMontant = Math.round((ajUnite === 'pct'
    ? sousTotalHt * (ajValeur / 100) : ajValeur) * 100) / 100;
  const sousTotalAjuste = Math.round((sousTotalHt + ajMontant) * 100) / 100;
  const vise = Math.round(sousTotalAjuste * (1 + tauxSource) * 100) / 100;
  let ttc = vise;
  if (source.arrondi === 'euro') ttc = Math.floor(vise + 1e-9);
  else if (source.arrondi === 'dix') ttc = Math.floor(vise * 10 + 1e-9) / 10;
  ttc = Math.round(ttc * 100) / 100;
  if (ttc <= 0) return res.status(400).json({ error: 'un avoir à zéro ne s’émet pas' });

  // ON NE REND JAMAIS PLUS QU'ON N'A FACTURÉ, avoirs précédents compris. Sans
  // ce garde-fou, deux avoirs partiels successifs pouvaient dépasser le total
  // de la facture sans que rien ne proteste — et c'est le genre d'écart qui ne
  // se voit qu'au bilan.
  const { rows: dejaRendu } = await pool.query(
    'SELECT COALESCE(SUM(montant_ttc), 0)::numeric AS ttc FROM credit_notes WHERE invoice_id = $1', [invoiceId],
  );
  const rendu = Number(dejaRendu[0].ttc) || 0;
  const reste = Math.round((Number(facture.montant_ttc) - rendu) * 100) / 100;
  if (ttc > reste + 0.004) {
    return res.status(400).json({
      error: `Un avoir ne peut pas dépasser ce qui reste à rendre sur ${facture.numero} : ${reste.toFixed(2)} €`,
    });
  }

  const jour = isDay(b.jour) ? b.jour : todayPlus(0);
  const annee = Number(jour.slice(0, 4));
  const motif = borner(b.motif, 240);

  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    const { numero, rang } = await reserverNumeroAvoir(cx, annee);
    const document = {
      // MÊME FORME QUE LA FACTURE : c'est `modeleFacture` (public/facture.js)
      // qui compose les DEUX papiers, et `saisie.avoir` est tout ce qui les
      // distingue. Un second fichier de rendu à 95 % identique aurait dérivé.
      saisie: {
        numero,
        date: jour,
        projet: source.projet || '',
        client: source.client || {},
        lignes,
        regime: source.regime || 'tgca',
        mentionRegime: source.mentionRegime || '',
        tauxTgca: Number(source.tauxTgca) || 0,
        arrondi: source.arrondi || 'aucun',
        ajustement: { unite: ajUnite, valeur: ajValeur },
        vedette: source.vedette === 'ht' ? 'ht' : 'ttc',
        mode: source.mode || '',
        avoir: { surFacture: facture.numero, surDate: source.date || '', motif },
      },
      // L'IDENTITÉ DE LA FACTURE CORRIGÉE, pas celle d'aujourd'hui : les deux
      // papiers doivent porter le même émetteur, même après un déménagement.
      entreprise: (facture.document && facture.document.entreprise) || {},
    };
    const { rows } = await cx.query(
      `INSERT INTO credit_notes (numero, annee, rang, cle, invoice_id, facture_numero, client_nom, montant_ttc, motif, emis_par, document)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, numero, document, montant_ttc`,
      [numero, annee, rang, cle, invoiceId, facture.numero, facture.client_nom, ttc, motif,
        borner(req.headers['x-qui'] ? decodeURIComponent(req.headers['x-qui']) : null, 80), document],
    );
    await cx.query('COMMIT');
    return res.status(201).json({
      id: rows[0].id, numero: rows[0].numero, montantTtc: Number(rows[0].montant_ttc), document: rows[0].document,
    });
  } catch (err) {
    await cx.query('ROLLBACK');
    // Une autre requête a gagné la course sur la même clé : on rend LE SIEN.
    if (err && err.code === '23505') {
      const { rows: apres } = await pool.query(
        'SELECT id, numero, document, montant_ttc FROM credit_notes WHERE cle = $1', [cle],
      );
      if (apres.length) {
        return res.status(201).json({
          id: apres[0].id, numero: apres[0].numero, montantTtc: Number(apres[0].montant_ttc), document: apres[0].document,
        });
      }
    }
    throw err;
  } finally {
    cx.release();
  }
})));

// Les avoirs posés sur une facture — ce que la modale doit dire avant de
// proposer d'en établir un de plus.
async function avoirsDeFacture(invoiceId) {
  const { rows } = await pool.query(
    `SELECT id, numero, montant_ttc, motif, emis_le, document
       FROM credit_notes WHERE invoice_id = $1 ORDER BY rang ASC`, [invoiceId],
  );
  return rows.map((a) => ({
    id: a.id,
    numero: a.numero,
    montantTtc: Number(a.montant_ttc),
    motif: a.motif || '',
    emisLe: a.emis_le,
    document: a.document,
  }));
}

// GET /api/requests/:id/facture → relit la facture d'un dossier, TELLE QUE
// STOCKÉE. Aucun recalcul, aucune lecture des Réglages courants : `document`
// porte déjà tout ce qu'il faut (saisie + entreprise figées à l'émission)
// pour que `modeleFacture`/`dessinerFacture` (côté client) recomposent
// EXACTEMENT le même papier qu'au premier jour.
app.get('/api/requests/:id/facture', exige('clients'), asyncH(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, numero, document, montant_ttc FROM invoices WHERE dossier_id = $1', [req.params.id],
  );
  if (!rows.length) return res.status(404).json({ error: 'Aucune facture pour ce dossier' });
  // LES AVOIRS VIENNENT AVEC. La facture archivée, elle, ne bouge pas d'un
  // caractère : ce qu'on a remis au client reste ce qu'on a remis au client.
  // C'est l'APPLICATION qui sait qu'elle a été corrigée, pas le papier — d'où
  // ces deux champs à côté du document, et non dedans.
  const avoirs = await avoirsDeFacture(rows[0].id);
  const rendu = avoirs.reduce((t, a) => t + a.montantTtc, 0);
  res.json({
    id: rows[0].id, numero: rows[0].numero, montantTtc: Number(rows[0].montant_ttc), document: rows[0].document,
    avoirs,
    resteARendre: Math.round((Number(rows[0].montant_ttc) - rendu) * 100) / 100,
  });
}));

// ---------------------------------------------------------------------------
// LE JOURNAL DES FACTURES (03/09/2026)
// ---------------------------------------------------------------------------
// SANS LUI, PERSONNE NE PEUT SORTIR LA LISTE. La seule lecture qui existait
// était `GET /api/requests/:id/facture` — une facture à la fois, à condition
// de connaître son dossier. Un comptable qui demande « les ventes du mois »
// n'avait aucun chemin, et le patron non plus : il aurait fallu ouvrir la base.
//
// CAPACITÉ `argent` ET NON `reglages` : la boutique encaisse, elle doit pouvoir
// retrouver et relire ce qu'elle a émis. L'atelier, non.
//
// ⚠ RIEN N'EST RECALCULÉ ICI NON PLUS. Le TTC rendu est la COLONNE archivée
// (`montant_ttc`), jamais une addition refaite sur les lignes. Le HT et la taxe
// s'en DÉDUISENT avec l'arithmétique de `calculerDevis` (le TTC est le nombre
// arrondi, le HT est ce qu'il redonne, la taxe est ce qui reste) — c'est la
// même opération, dans le même sens, donc elle ne peut pas diverger du papier.
function ligneJournal(r) {
  const doc = r.document && typeof r.document === 'object' ? r.document : {};
  const saisie = doc.saisie && typeof doc.saisie === 'object' ? doc.saisie : {};
  const client = saisie.client && typeof saisie.client === 'object' ? saisie.client : {};
  const ttc = Number(r.montant_ttc) || 0;
  const taux = saisie.regime === 'tgca' ? Math.max(0, Number(saisie.tauxTgca) || 0) : 0;
  const totalHt = taux ? Math.round((ttc / (1 + taux)) * 100) / 100 : ttc;
  return {
    id: r.id,
    numero: r.numero,
    dossierId: r.dossier_id,
    date: saisie.date || null,
    client: r.client_nom,
    clientType: client.type === 'perso' ? 'perso' : 'pro',
    // CE QUI MANQUE SE VOIT DANS LE JOURNAL, pas seulement au moment d'émettre :
    // c'est la colonne qu'on trie pour savoir quelles factures rattraper.
    clientAdresse: client.adresse || '',
    projet: saisie.projet || '',
    regime: saisie.regime || 'tgca',
    tauxTgca: taux,
    totalHt,
    taxe: Math.round((ttc - totalHt) * 100) / 100,
    ttc,
    mode: saisie.mode || '',
    emiseLe: r.emise_le,
    emisePar: r.emise_par || '',
  };
}

// UN AVOIR SE LIT COMME UNE FACTURE, au signe près : mêmes colonnes, même
// arithmétique, et `ttc` reste POSITIF ici. C'est l'export qui le passe en
// négatif — voir plus bas — parce que c'est là que la somme d'une colonne doit
// donner le chiffre d'affaires réel.
function ligneAvoir(a) {
  const doc = a.document && typeof a.document === 'object' ? a.document : {};
  const saisie = doc.saisie && typeof doc.saisie === 'object' ? doc.saisie : {};
  const client = saisie.client && typeof saisie.client === 'object' ? saisie.client : {};
  const ttc = Number(a.montant_ttc) || 0;
  const taux = saisie.regime === 'tgca' ? Math.max(0, Number(saisie.tauxTgca) || 0) : 0;
  const totalHt = taux ? Math.round((ttc / (1 + taux)) * 100) / 100 : ttc;
  return {
    id: a.id,
    numero: a.numero,
    surFacture: a.facture_numero,
    invoiceId: a.invoice_id,
    date: saisie.date || null,
    client: a.client_nom,
    clientType: client.type === 'perso' ? 'perso' : 'pro',
    clientAdresse: client.adresse || '',
    projet: saisie.projet || '',
    motif: a.motif || '',
    regime: saisie.regime || 'tgca',
    tauxTgca: taux,
    totalHt,
    taxe: Math.round((ttc - totalHt) * 100) / 100,
    ttc,
    mode: saisie.mode || '',
    emiseLe: a.emis_le,
    emisePar: a.emis_par || '',
  };
}

// L'ANNÉE EST LA MAILLE DU JOURNAL, parce que c'est celle de la NUMÉROTATION
// (`FA-<annee>-<rang>`, colonne `annee`) — et donc celle sur laquelle un
// contrôle vérifie qu'il ne manque aucun numéro. Sans année : tout, la plus
// récente d'abord.
app.get('/api/factures', exige('argent'), asyncH(async (req, res) => {
  const annee = /^\d{4}$/.test(String(req.query.annee || '')) ? Number(req.query.annee) : null;
  const { rows } = await pool.query(
    `SELECT id, numero, annee, rang, dossier_id, client_nom, montant_ttc, emise_le, emise_par, document
       FROM invoices ${annee ? 'WHERE annee = $1' : ''}
      ORDER BY annee DESC, rang DESC`,
    annee ? [annee] : [],
  );
  // CE QUI A ÉTÉ RENDU, PAR FACTURE. Une facture entièrement avoirée reste au
  // journal — elle ne s'efface pas, elle se lit « annulée par AV-… ». Une
  // requête pour tout le monde plutôt qu'une par ligne : la liste d'une année
  // en compte des centaines.
  const { rows: avoirs } = await pool.query(
    `SELECT id, numero, annee, rang, invoice_id, facture_numero, client_nom, montant_ttc, motif, emis_le, emis_par, document
       FROM credit_notes ${annee ? 'WHERE annee = $1' : ''}
      ORDER BY annee DESC, rang DESC`,
    annee ? [annee] : [],
  );
  const rendusParFacture = new Map();
  for (const a of avoirs) {
    const e = rendusParFacture.get(a.invoice_id) || { ttc: 0, numeros: [] };
    e.ttc = Math.round((e.ttc + Number(a.montant_ttc)) * 100) / 100;
    e.numeros.push(a.numero);
    rendusParFacture.set(a.invoice_id, e);
  }
  const { rows: annees } = await pool.query(
    'SELECT annee, COUNT(*)::int AS n, SUM(montant_ttc)::numeric AS ttc FROM invoices GROUP BY annee ORDER BY annee DESC',
  );
  const { rows: anneesAv } = await pool.query(
    'SELECT annee, COUNT(*)::int AS n, SUM(montant_ttc)::numeric AS ttc FROM credit_notes GROUP BY annee',
  );
  const rendusParAnnee = new Map(anneesAv.map((a) => [a.annee, { n: a.n, ttc: Number(a.ttc) || 0 }]));
  res.json({
    factures: rows.map((r) => {
      const l = ligneJournal(r);
      const rendu = rendusParFacture.get(r.id);
      return {
        ...l,
        rendu: rendu ? rendu.ttc : 0,
        avoirs: rendu ? rendu.numeros : [],
        // « Annulée » = tout a été rendu. Le mot compte : c'est ce qu'un
        // comptable cherche du regard dans une liste.
        annulee: !!rendu && Math.abs(rendu.ttc - l.ttc) < 0.005,
      };
    }),
    avoirs: avoirs.map(ligneAvoir),
    annees: annees.map((a) => {
      const av = rendusParAnnee.get(a.annee) || { n: 0, ttc: 0 };
      const ttc = Number(a.ttc) || 0;
      return { annee: a.annee, n: a.n, ttc, avoirs: av.n, rendu: av.ttc,
        // LE NET EST CE QUI COMPTE : facturé moins rendu. C'est le chiffre que
        // le patron cherche, et le seul qui corresponde à l'export.
        net: Math.round((ttc - av.ttc) * 100) / 100 };
    }),
  });
}));

// L'EXPORT QUE LE COMPTABLE OUVRE. Point-virgule et non virgule : c'est le
// séparateur qu'attend un tableur configuré en français, et une virgule y
// collerait toutes les colonnes dans la première. Le BOM en tête pour la même
// raison — sans lui, « Réglé » arrive en « RÃ©glÃ© ».
//
// LES NOMBRES PARTENT À LA VIRGULE DÉCIMALE, eux aussi pour le tableur français.
//
// LES AVOIRS Y SONT, EN NÉGATIF. C'est le seul choix qui rende la colonne
// « Total TTC » sommable : additionner un journal où les avoirs sont positifs
// donne un chiffre d'affaires faux, et de la pire façon — trop haut. La
// colonne « Nature » dit lequel des deux on lit, la colonne « Sur facture »
// dit laquelle un avoir corrige.
const euroCsv = (n) => n.toFixed(2).replace('.', ',');
const CSV_COLONNES = [
  ['Nature', (f) => (f.nature === 'avoir' ? 'Avoir' : 'Facture')],
  ['Numero', (f) => f.numero],
  ['Sur facture', (f) => f.surFacture || ''],
  ['Date de vente', (f) => f.date || ''],
  ['Client', (f) => f.client],
  ['Type de client', (f) => (f.clientType === 'perso' ? 'Particulier' : 'Professionnel')],
  ['Adresse client', (f) => f.clientAdresse],
  ['Projet', (f) => f.projet],
  ['Motif', (f) => f.motif || ''],
  ['Regime', (f) => f.regime],
  ['Taux', (f) => euroCsv(f.tauxTgca * 100)],
  ['Total HT', (f) => euroCsv(f.signe * f.totalHt)],
  ['Taxe', (f) => euroCsv(f.signe * f.taxe)],
  ['Total TTC', (f) => euroCsv(f.signe * f.ttc)],
  ['Reglement', (f) => f.mode],
  ['Emise le', (f) => (f.emiseLe ? new Date(f.emiseLe).toISOString() : '')],
  ['Poste', (f) => f.emisePar],
];

// Un point-virgule, un guillemet ou un retour à la ligne DANS une valeur casse
// la colonne suivante : on double les guillemets et on entoure. Un nom de
// client contient « ; » plus souvent qu'on ne le croit.
const csvChamp = (v) => {
  const t = String(v == null ? '' : v);
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

app.get('/api/factures.csv', exige('argent'), asyncH(async (req, res) => {
  const annee = /^\d{4}$/.test(String(req.query.annee || '')) ? Number(req.query.annee) : null;
  const { rows } = await pool.query(
    `SELECT id, numero, annee, rang, dossier_id, client_nom, montant_ttc, emise_le, emise_par, document
       FROM invoices ${annee ? 'WHERE annee = $1' : ''}
      ORDER BY annee ASC, rang ASC`,
    annee ? [annee] : [],
  );
  const { rows: avoirs } = await pool.query(
    `SELECT id, numero, annee, rang, invoice_id, facture_numero, client_nom, montant_ttc, motif, emis_le, emis_par, document
       FROM credit_notes ${annee ? 'WHERE annee = $1' : ''}
      ORDER BY annee ASC, rang ASC`,
    annee ? [annee] : [],
  );
  // TRIÉ PAR DATE PUIS PAR NUMÉRO, les deux séries mêlées : un journal
  // comptable se lit dans l'ordre où les documents sont sortis, pas en deux
  // blocs. Le numéro départage deux documents du même jour, et il est
  // croissant dans chaque série par construction.
  const tout = [
    ...rows.map((r) => ({ ...ligneJournal(r), nature: 'facture', signe: 1, motif: '', surFacture: '' })),
    ...avoirs.map((a) => ({ ...ligneAvoir(a), nature: 'avoir', signe: -1 })),
  ].sort((x, y) => String(x.date || '').localeCompare(String(y.date || ''))
    // LA FACTURE AVANT SON AVOIR le même jour : sans ce départage, « AV »
    // passe avant « FA » par l'alphabet et l'avoir se lit avant ce qu'il
    // corrige — l'inverse de l'ordre dans lequel ils sont sortis.
    || (x.nature === y.nature ? 0 : (x.nature === 'facture' ? -1 : 1))
    || String(x.numero).localeCompare(String(y.numero)));
  const lignes = [CSV_COLONNES.map(([nom]) => nom).join(';')];
  for (const f of tout) {
    lignes.push(CSV_COLONNES.map(([, prendre]) => csvChamp(prendre(f))).join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="factures-olda-${annee || 'toutes'}.csv"`);
  res.send(`\uFEFF${lignes.join('\r\n')}\r\n`);
}));

// ---------------------------------------------------------------------------
// Statique + SPA
// ---------------------------------------------------------------------------
// L'application n'a AUCUN build : les fichiers gardent le même nom d'un
// déploiement à l'autre. Sans cette entête, le navigateur continue d'exécuter
// l'ancien app.js et interroge le serveur avec des slugs d'étape qui n'existent
// plus — la grille apparaît VIDE alors que tout est en base. C'est arrivé au
// passage aux 5 familles.
// `no-cache` ne désactive pas le cache : il impose de le revalider. Quand rien
// n'a changé, le serveur répond 304 sans renvoyer le fichier.
// Le SVG en fait partie : c'est le logo, servi aussi comme icône de la PWA.
// Sans en-tête, un poste gardait l'ancien plusieurs heures après un changement.
// La police d'icônes en fait partie pour la même raison que le reste : elle
// porte un nom fixe, et le jour où l'on y ajoute un glyphe, aucun poste ne doit
// rester des heures sur l'ancienne. Revalider 16 Ko coûte un 304, rien de plus.
const NO_CACHE = /\.(html|js|css|webmanifest|svg|woff2)$/;

// LES COMMENTAIRES NE PARTENT PAS SUR LE FIL. 46 % du poids servi était de la
// prose française : la mémoire du projet, indispensable dans la source,
// parfaitement inutile dans un navigateur. On la retire ICI, à la volée, et le
// disque n'est jamais touché — 391 → 177 Ko compressés sur les 25 fichiers
// servis, soit 214 Ko de moins à chaque chargement à froid.
//
// CE N'EST PAS UN BUILD : rien n'est écrit, aucun outil n'entre dans le dépôt,
// les fichiers gardent leur nom (c'est ce nom fixe qui impose `no-cache` juste
// en dessous). Les numéros de ligne ne bougent pas d'un cran — voir
// depouiller.js — donc une pile d'appels remontée d'un poste reste lisible.
//
// LE CACHE EST INDEXÉ SUR (chemin, taille, date) : en développement, un fichier
// modifié se resert dépouillé à neuf sans redémarrer. Il est BORNÉ par le
// nombre de fichiers du dossier, pas par le trafic.
const { depouiller } = require('./depouiller.js');

// LE HTML EN FAIT PARTIE DEPUIS LE 29/08. Il était le dernier à partir entier :
// `index.html` portait 12 Ko de prose sur 27 — et c'est la PREMIÈRE requête d'un
// poste, celle qui bloque la découverte de tout le reste. Les deux écrans du
// comptoir en portaient bien plus, dans des blocs `<style>` et `<script>` en
// ligne qu'aucun des deux autres dépouilleurs n'atteignait : 209 Ko pour
// `demande-devis.html`. Les trois pèsent 111 Ko compressés, ils en pèsent 60.
const DEPOUILLABLE = /\.(js|css|html)$/;
// SAUF LES BIBLIOTHÈQUES TIERCES DE BAT STUDIO. 5,4 Mo de bundles DÉJÀ minifiés
// (pdf-lib, pdf.js, fontkit, pako, libheif, UTIF) : il n'y a plus un commentaire
// à retirer, et les dépouiller coûterait le calcul et le risque pour zéro octet
// gagné. Le reste de `public/bat/` passe au dépouillage comme le reste du CRM —
// c'est du code écrit à la main, et il est très commenté.
const NON_DEPOUILLABLE = /^\/bat\/vendor\//;
const TYPE_MIME = { css: 'text/css', html: 'text/html; charset=utf-8', js: 'text/javascript' };
const genre = (chemin) => (chemin.endsWith('.css') ? 'css' : chemin.endsWith('.html') ? 'html' : 'js');

// UNE ENTRÉE PAR CHEMIN, PAS UNE SEULE EN TOUT. Le cache se vidait avant chaque
// écriture : il ne contenait donc jamais qu'un fichier, et un poste qui ouvre
// l'application en demande seize d'un coup. Chaque ouverture redépouillait donc
// TOUT — 27 ms de calcul et 1 Mo de lecture disque à chaque fois, sur le seul
// conteneur qui sert tout l'atelier. Le cache est maintenant borné par le
// nombre de fichiers du dossier, ce que son commentaire promettait déjà.
const depouilles = new Map();

// BROTLI. `compression` ne connaît que gzip ; sur le boot complet, brotli rend
// 110 Ko là où gzip en rend 121. On ne le fait QUE sur ces fichiers-là (ils
// sont 100 % du poids d'ouverture) et le résultat est mis de côté avec le
// corps, donc le calcul n'a lieu qu'une fois par version de fichier.
// QUALITÉ 9, PAS 11 : 11 descendrait à 102 Ko, mais coûterait 395 ms de calcul
// bloquant au premier appel après un déploiement — sur un conteneur unique,
// c'est tout l'atelier qui attend. 9 coûte 15 ms pour 9 Ko de moins que gzip.
const BROTLI = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } };

function servirDepouille(req, res, chemin, stat) {
  const cle = `${stat.size}:${stat.mtimeMs}`;
  let entree = depouilles.get(chemin);
  if (!entree || entree.cle !== cle) {
    const corps = depouiller(fs.readFileSync(chemin, 'utf8'), genre(chemin));
    entree = { cle, corps, br: null };
    depouilles.set(chemin, entree);
  }
  // L'ETAG DOIT SUIVRE LE CORPS SERVI, pas le fichier sur le disque : sinon un
  // poste qui a l'ancienne version en cache reçoit un 304 pour un contenu qui
  // a changé, et garde du code périmé — exactement le mal que `no-cache`
  // existe pour empêcher.
  const taille = Buffer.byteLength(entree.corps);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Vary', 'Accept-Encoding');
  res.type(TYPE_MIME[genre(chemin)]);

  if (/\bbr\b/.test(String(req.headers['accept-encoding'] || ''))) {
    if (!entree.br) entree.br = zlib.brotliCompressSync(Buffer.from(entree.corps), BROTLI);
    // L'EMPREINTE PORTE L'ENCODAGE. Deux corps différents sous une même
    // empreinte, et un cache intermédiaire rend le gzip à qui demandait brotli.
    res.setHeader('ETag', `W/"d-${taille}-${Math.round(stat.mtimeMs)}-br"`);
    res.setHeader('Content-Encoding', 'br');
    res.send(entree.br);
    return;
  }
  res.setHeader('ETag', `W/"d-${taille}-${Math.round(stat.mtimeMs)}"`);
  res.send(entree.corps);
}

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  // `/` EST `index.html`. C'est l'adresse que tapent les postes, et c'est
  // `express.static` qui la servait — en amont de la route `/` posée plus bas,
  // et sans passer par ici. Le fichier le plus lu de l'application était donc le
  // seul à repartir avec ses 12 Ko de prose.
  const voulu = req.path.endsWith('/') ? `${req.path}index.html` : req.path;
  if (!DEPOUILLABLE.test(voulu) || NON_DEPOUILLABLE.test(voulu)) return next();
  // `path.join` normalise `..` : on vérifie ensuite qu'on n'est pas sorti de
  // `public/`, sans quoi une adresse fabriquée lirait n'importe quel fichier.
  const racine = path.join(__dirname, 'public');
  const chemin = path.join(racine, decodeURIComponent(voulu));
  if (!chemin.startsWith(racine + path.sep)) return next();
  let stat;
  try { stat = fs.statSync(chemin); } catch (_) { return next(); }
  if (!stat.isFile()) return next();
  try { servirDepouille(req, res, chemin, stat); } catch (_) { return next(); }
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (NO_CACHE.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
// Filet : si le dépouillage a renoncé, la racine reste servie telle quelle.
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// L'ancienne adresse de la fiche reste valide (raccourcis déjà posés sur les
// écrans) : elle renvoie sur Nouveau Projet, la seule porte d'entrée.
app.get('/fiche', (req, res) => res.redirect(301, '/#nouveau-projet'));

// FILET FINAL : les erreurs levées AVANT les routes répondent en JSON.
// `asyncH` couvre les gestionnaires ; mais un corps JSON malformé (tablette qui
// décroche en plein envoi) ou trop gros fait lever `express.json()` lui-même —
// et sans ce filet, Express répondait une PAGE HTML que le parcours du comptoir
// tentait de lire comme du JSON : message illisible, dossier perdu.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err && Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) console.error(err);
  const messages = {
    400: 'Envoi illisible — réessaie.',
    413: 'Dossier trop volumineux pour être envoyé.',
  };
  res.status(status).json({ error: messages[status] || 'Erreur serveur' });
});

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
// LES TAUX SE CHARGENT AU DÉMARRAGE, pas au premier chiffrage.
//
// Ils n'étaient posés qu'à l'intérieur de `POST /api/projets`. Tant que
// personne n'avait chiffré depuis le redémarrage, ils valaient donc les
// constantes du code — et c'est sur la TGCA que la marge se calcule, à chaque
// lecture de ligne. Un serveur qui vient de repartir aurait affiché des marges
// calculées sur 4 % même si le patron avait réglé autre chose.
async function chargerTaux() {
  try {
    const p = await getTarifsTasseParametres();
    PROJET_TAUX_MO = p.tauxHoraireMo;
    PROJET_TAUX_MACHINE = p.tauxHoraireMachine;
    PROJET_TGCA = p.tgca;
  } catch (err) {
    console.error('taux de calcul :', err.message);
  }
}

init()
  .then(chargerTaux)
  .then(loadCommandeZones)
  .then(() => {
    // `__server` est exposé pour les tests (PORT=0 → port libre, adresse lue au
    // moment où le serveur écoute). En production rien ne le lit.
    app.__server = app.listen(PORT, () => {
      console.log(`Planning OLDA — en écoute sur le port ${app.__server.address().port}`);
      if (!APP_PASSWORD) console.log('⚠  APP_PASSWORD non défini : accès ouvert (mode dev).');
    });
    // Node ferme par défaut une connexion inactive après 5 s ; le proxy Railway,
    // lui, la réutilise volontiers plus tard. Quand il retombe sur une connexion
    // que l'origine vient de fermer, le poste reçoit un 502 sporadique — le
    // genre de « ça a raté une fois, réessaie » qu'on ne sait jamais expliquer.
    // On tient la connexion PLUS LONGTEMPS que le proxy, et l'en-tête suit.
    app.__server.keepAliveTimeout = 65000;
    app.__server.headersTimeout = 66000;
    // UN PORT DÉJÀ PRIS N'EST PAS UN PLANTAGE. Sans écouteur, Node relançait
    // l'évènement `error` en exception et l'atelier recevait vingt lignes de
    // pile pour dire « tu l'as déjà lancé ». On le dit en une phrase, avec la
    // sortie.
    app.__server.on('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        console.error(`✗ Le port ${PORT} est déjà occupé — Planning OLDA tourne probablement déjà.`);
        console.error(`  Ferme l'autre fenêtre, ou lance celui-ci ailleurs :  PORT=3001 npm start`);
        process.exit(1);
      }
      console.error('Erreur du serveur :', err);
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error('Échec de l\'initialisation de la base :', err);
    process.exit(1);
  });

module.exports = app;
