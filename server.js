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
const express = require('express');
const compression = require('compression');
const {
  pool, init, STAGES, STAGE_SLUGS, SUB_SLUGS, RESPONSABLES, CLIENT_TYPES, FLAGS, ORDER_KINDS,
  getCategoryOwners, setCategoryOwners,
  getCategoryReferents, setCategoryReferents,
  getMachines, setMachines,
  getTarifsTasseArticles, setTarifsTasseArticles,
  getTarifsTasseParametres, setTarifsTasseParametres,
  getSupplementsExpress, setSupplementsExpress,
  getCommandeZones, getHiddenCommandeZones,
  getClientSecteurs, addClientSecteur, removeClientSecteur,
  SUB_STAGES, WHATSAPP_MESSAGE_MAX, getWhatsappMessage, setWhatsappMessage,
  SUB_TO_FAMILY, getOrdreManuel, setOrdreManuel, basculerOrdreManuel,
  logRequestChanges, logFicheChange, getRequestJournal,
  clientKey, nextClientCode,
} = require('./db');
const RESPONSABLE_SET = new Set(RESPONSABLES);
const CLIENT_TYPE_SET = new Set(CLIENT_TYPES);
const FLAG_SET = new Set(FLAGS);
const ORDER_KIND_SET = new Set(ORDER_KINDS);
// Longueur maximale du motif d'alerte : une phrase, pas un roman (la ligne de
// grille l'affiche tronqué, l'infobulle en donne le texte complet).
const FLAG_REASON_MAX = 240;

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
app.use(express.json());

// ---------------------------------------------------------------------------
// Basic Auth (mot de passe partagé). Si APP_PASSWORD est absent → accès ouvert.
// ---------------------------------------------------------------------------
const APP_PASSWORD = process.env.APP_PASSWORD;

// Comparaison à temps constant. `timingSafeEqual` exige deux tampons de MÊME
// longueur : on compare donc les empreintes, qui font toujours 32 octets.
function memeSecret(a, b) {
  const crypto = require('crypto');
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
  'flag', 'flag_reason',
  'acompte_demande', 'acompte_verse', 'acompte_montant', 'paye', 'paiement_mode',
];

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

// Liste des étapes (pour le front).
app.get('/api/stages', (req, res) => res.json(STAGES));

// Attribution des catégories à un employé (config du patron).
// GET  → { slugCatégorie: employé, ... }
// PUT  → remplace la config (corps = même forme). Diffusé en SSE pour que le
//        dashboard des autres postes se recalcule instantanément.
app.get('/api/category-owners', asyncH(async (req, res) => {
  res.json(await getCategoryOwners());
}));

app.put('/api/category-owners', asyncH(async (req, res) => {
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

app.put('/api/category-referents', asyncH(async (req, res) => {
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

app.put('/api/machines', asyncH(async (req, res) => {
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

app.put('/api/tarifs-tasse', asyncH(async (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Tableau d\'articles attendu' });
  }
  const saved = await setTarifsTasseArticles(req.body);
  broadcast({ kind: 'tarifs-tasse' });
  res.json(saved);
}));

// Paramètres globaux du calcul (taux horaires MO/machine, TGCA).
app.get('/api/tarifs-tasse/parametres', asyncH(async (req, res) => {
  res.json(await getTarifsTasseParametres());
}));

app.put('/api/tarifs-tasse/parametres', asyncH(async (req, res) => {
  const body = req.body || {};
  for (const key of ['tauxHoraireMo', 'tauxHoraireMachine', 'tgca']) {
    if (key in body && !Number.isFinite(Number(body[key]))) {
      return res.status(400).json({ error: `${key} doit être numérique` });
    }
  }
  const saved = await setTarifsTasseParametres(body);
  broadcast({ kind: 'tarifs-tasse' });
  res.json(saved);
}));

// SUPPLÉMENTS EXPRESS de la vente directe, par palier de délai (en pourcents).
// Réglage commercial, pas constante de code : il se change au comptoir, depuis
// l'écran, et vaut aussitôt pour tous les postes (d'où le SSE).
// GET → { j5, j10, j15 } · PUT { j5, j10, j15 } → barème retenu.
app.get('/api/supplements-express', asyncH(async (req, res) => {
  res.json(await getSupplementsExpress());
}));

app.put('/api/supplements-express', asyncH(async (req, res) => {
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

// Message WhatsApp « votre commande est prête » (réglage du patron, onglet
// Réglages). Le planning s'en sert pour pré-remplir WhatsApp au clic sur la
// pastille d'une ligne ; il n'envoie jamais rien tout seul.
// GET → { message } · PUT { message } → texte retenu, diffusé en SSE pour que
// les autres postes utilisent le nouveau texte sans recharger.
app.get('/api/settings/whatsapp', asyncH(async (req, res) => {
  res.json({ message: await getWhatsappMessage() });
}));

app.put('/api/settings/whatsapp', asyncH(async (req, res) => {
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
app.put('/api/ordre-manuel', asyncH(async (req, res) => {
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
  'acompte_demande', 'acompte_verse', 'acompte_montant', 'paye', 'paiement_mode',
  'flag', 'flag_reason', 'position', 'fiche', 'created_at', 'updated_at',
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
const FICHE_LISTE = ['kind', 'source', 'ref', 'heureSouhaitee'];

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
      ({ rows } = await pool.query(`${SELECT} WHERE r.stage = $1 ${ORDER}`, [stage]));
    } else {
      // On prend la fin de la liste — donc on trie À L'ENVERS pour la couper,
      // puis on remet l'ordre d'affichage. Prendre les premières aurait donné
      // les plus anciennes : exactement celles que personne ne vient voir.
      const r = await pool.query(
        `${SELECT} WHERE r.stage = $1 ${ORDER_INVERSE} LIMIT $2`, [stage, plafond + 1],
      );
      const { lignes, complet } = bornerListe(r.rows, plafond);
      rows = lignes.reverse();
      if (!complet) {
        res.set('X-Liste-Tronquee', String(plafond));
        const { rows: n } = await pool.query(
          'SELECT COUNT(*)::int AS n FROM requests WHERE stage = $1', [stage],
        );
        res.set('X-Liste-Total', String(n[0].n));
      }
    }
  } else {
    const parEtape = 'r.stage, r.position ASC NULLS LAST, r.priority DESC, r.deadline ASC NULLS LAST, r.created_at ASC';
    if (plafond === null) {
      ({ rows } = await pool.query(`${SELECT} ORDER BY ${parEtape}`));
    } else {
      // MÊME RÈGLE QUE PAR ÉTAPE : on rend la FIN de la liste. Le plafond
      // s'appliquait ici sur l'ordre normal, donc sur les PREMIÈRES lignes —
      // classées par étape, alphabétiquement : « demande_chiffrage » et
      // « facturation » remplissaient les 400 places et « production »,
      // « préparation » n'apparaissaient tout simplement jamais. Un appelant
      // sans `?stage=` recevait une réponse amputée sans rien qui le dise.
      const parEtapeInverse = 'r.stage DESC, r.position DESC NULLS FIRST, r.priority ASC, r.deadline DESC NULLS FIRST, r.created_at DESC';
      const r = await pool.query(`${SELECT} ORDER BY ${parEtapeInverse} LIMIT $1`, [plafond + 1]);
      const { lignes, complet } = bornerListe(r.rows, plafond);
      rows = lignes.reverse();
      if (!complet) {
        res.set('X-Liste-Tronquee', String(plafond));
        const { rows: n } = await pool.query('SELECT COUNT(*)::int AS n FROM requests');
        res.set('X-Liste-Total', String(n[0].n));
      }
    }
  }

  res.json(rows.map(allegerFiche));
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
const empreinteIds = (ids) => require('crypto')
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
const SYNTHESE_FAMILLES = ['demande_chiffrage', 'preparation', 'production', 'facturation'];
const SYNTHESE_FILTRE = `r.stage IN (${SYNTHESE_FAMILLES.map((s) => `'${s}'`).join(', ')})`;

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
      `SELECT ${SYNTHESE_CHAMPS} FROM requests r WHERE r.updated_at >= $1 ${ORDER}`, [borne],
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
    lignes: lignes.map(allegerSynthese),
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
    `${SELECT} WHERE ${conditions} ORDER BY r.updated_at DESC LIMIT $${params.length}`, params,
  );
  res.json(rows.map(allegerFiche));
}));

// GET /api/requests/:id → UNE commande, fiche COMPLÈTE. C'est ce que le tiroir
// de détail et le récapitulatif imprimable vont chercher : le détail n'est
// chargé que pour la ligne qu'on ouvre, jamais pour les centaines d'autres.
app.get('/api/requests/:id', asyncH(async (req, res) => {
  const { rows } = await pool.query(`${SELECT_COMPLET} WHERE r.id = $1`, [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Commande introuvable' });
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

  const { rows: byStage } = await pool.query('SELECT stage, COUNT(*)::int AS n FROM requests GROUP BY stage');
  for (const r of byStage) if (r.stage in counts) counts[r.stage] = r.n;

  const { rows: bySub } = await pool.query(
    'SELECT sub_stage, COUNT(*)::int AS n FROM requests WHERE sub_stage IS NOT NULL GROUP BY sub_stage',
  );
  for (const r of bySub) if (SUB_SLUGS.has(r.sub_stage)) counts[r.sub_stage] = r.n;

  res.json(counts);
}));

// POST /api/requests → crée (corps partiel autorisé)
app.post('/api/requests', asyncH(async (req, res) => {
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
  broadcast({ kind: 'create', stages: [rows[0].stage] });
  res.status(201).json(rows[0]);
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

app.post('/api/requests/:id/copie', asyncH(async (req, res) => {
  const { rows: src } = await pool.query('SELECT * FROM requests WHERE id = $1', [req.params.id]);
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
app.patch('/api/requests/positions', asyncH(async (req, res) => {
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

  // TOUT ou RIEN. En écritures indépendantes, une panne au milieu laissait la
  // moitié de l'étape renumérotée et l'autre sur ses anciennes valeurs : un
  // ordre mélangé que personne ne pouvait plus démêler à la main.
  const client = await pool.connect();
  const etapes = new Set();
  try {
    await client.query('BEGIN');
    for (const item of list) {
      const { rows } = await client.query(
        'UPDATE requests SET position = $1, updated_at = now() WHERE id = $2 RETURNING stage',
        [Number(item.position), item.id],
      );
      if (rows[0]) etapes.add(rows[0].stage);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
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
  const { rows: avant } = await pool.query('SELECT * FROM requests WHERE id = $1', [req.params.id]);
  if (avant.length === 0) return res.status(404).json({ error: 'Commande introuvable' });

  const body = effacerSousEtapeSiChangementDeFamille(
    normalizeFlagBody(req.body || {}), avant[0].stage,
  );
  const incoherence = verifierCoherenceEtape(body, avant[0].stage);
  if (incoherence) return res.status(400).json({ error: incoherence });

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

  if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

  sets.push('updated_at = now()');
  params.push(req.params.id);
  const query = `UPDATE requests SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`;
  const { rows } = await pool.query(query, params);
  if (rows.length === 0) return res.status(404).json({ error: 'Commande introuvable' });
  await logRequestChanges(req.params.id, avant[0], rows[0]);
  // LES DEUX ÉTAPES quand la ligne change de famille. L'évènement ne nommait
  // que la nouvelle : le poste qui regardait l'ANCIENNE n'avait aucune raison
  // de relire sa grille et gardait la ligne à l'écran, dans une famille qu'elle
  // a quittée. Tant que chaque poste retéléchargeait tout à chaque évènement,
  // ça ne se voyait pas ; maintenant que l'écran écoute ce champ, c'est lui qui
  // décide — il doit donc être exact.
  const etapes = [...new Set([avant[0].stage, rows[0].stage])];
  broadcast({ kind: 'update', stages: etapes });
  res.json(rows[0]);
}));

// GET /api/requests/:id/journal → ce qui a changé sur cette commande, du plus
// récent au plus ancien. La fiche l'affiche dans « Historique ».
app.get('/api/requests/:id/journal', asyncH(async (req, res) => {
  res.json(await getRequestJournal(req.params.id));
}));

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
app.patch('/api/requests/:id/fiche', asyncH(async (req, res) => {
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

  const client = await pool.connect();
  let issue;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT fiche FROM requests WHERE id = $1 FOR UPDATE', [req.params.id],
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

    const { rows: maj } = await client.query(
      'UPDATE requests SET fiche = $1, updated_at = now() WHERE id = $2 RETURNING *',
      [JSON.stringify(majFiche), req.params.id],
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
  await logFicheChange(req.params.id, issue.avant, issue.apres);
  broadcast({ kind: 'update', stages: [issue.ligne.stage] });
  return res.json(issue.ligne);
}));

// DELETE /api/requests/:id
app.delete('/api/requests/:id', asyncH(async (req, res) => {
  // La COMMANDE part en premier. Dans l'ordre inverse, une panne au milieu de
  // la cascade détruisait définitivement les PDF (devis, BAT, facture) d'une
  // commande qui, elle, restait au planning. Ici le pire cas laisse des pièces
  // orphelines, invisibles et sans conséquence.
  // `RETURNING stage` : l'évènement doit dire OÙ la ligne vivait, sinon les
  // postes ne savent pas si la grille qu'ils affichent vient de perdre une
  // ligne — et, faute de mieux, ils relisent tous la leur.
  const { rows: partie } = await pool.query(
    'DELETE FROM requests WHERE id = $1 RETURNING stage', [req.params.id],
  );
  if (partie.length === 0) return res.status(404).json({ error: 'Commande introuvable' });
  // Cascade côté applicatif (pg-mem ne gère pas les clés étrangères en local).
  await pool.query('DELETE FROM attachments WHERE request_id = $1', [req.params.id]);
  // `production_sectors` est retirée des bases où elle est vide (voir
  // retirerTableProductionSectors) : absente, il n'y a rien à nettoyer — et une
  // table manquante ne doit pas transformer une suppression en « Erreur serveur ».
  await pool.query('DELETE FROM production_sectors WHERE request_id = $1', [req.params.id])
    .catch(() => {});
  await pool.query('DELETE FROM request_events WHERE request_id = $1', [req.params.id]);
  broadcast({ kind: 'delete', stages: [partie[0].stage] });
  res.status(204).end();
}));

// ---------------------------------------------------------------------------
// Pièces jointes PDF (Devis / BAT / Facture) — 3 emplacements fixes par commande.
// Stockées en base (base64) ; servies inline pour consultation immédiate.
// ---------------------------------------------------------------------------
const PDF_KINDS = ['devis', 'bat', 'facture'];

// Marque la commande comme modifiée pour que le temps réel (signature basée sur
// updated_at) propage l'apparition / suppression d'un PDF aux autres clients.
async function touchRequest(id) {
  const { rows } = await pool.query(
    'UPDATE requests SET updated_at = now() WHERE id = $1 RETURNING stage', [id],
  );
  return rows[0] ? rows[0].stage : null;
}

// PUT /api/requests/:id/pdf/:kind  (corps = PDF brut, ?name=<nom de fichier>)
app.put('/api/requests/:id/pdf/:kind',
  express.raw({ type: () => true, limit: '12mb' }),
  asyncH(async (req, res) => {
    const { id, kind } = req.params;
    if (!PDF_KINDS.includes(kind)) return res.status(400).json({ error: `type invalide (${PDF_KINDS.join('|')})` });
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: 'PDF vide' });
    // Un vrai PDF commence par « %PDF- ». Sans ce contrôle, n'importe quel
    // fichier de 12 Mo entrait en base (encodé base64, soit +33 % de poids) et
    // s'ouvrait ensuite sur une page blanche chez celui qui le consultait.
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return res.status(400).json({ error: 'ce fichier n’est pas un PDF' });
    }

    const exists = await pool.query('SELECT 1 FROM requests WHERE id = $1', [id]);
    if (exists.rowCount === 0) return res.status(404).json({ error: 'Commande introuvable' });

    let filename = String(req.query.name || '').slice(0, 255).trim();
    if (!filename) filename = `${kind}.pdf`;
    const data = buf.toString('base64');

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
    const stage = await touchRequest(id);
    broadcast({ kind: 'update', stages: stage ? [stage] : [] });
    res.json({ kind, filename });
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
app.delete('/api/requests/:id/pdf/:kind', asyncH(async (req, res) => {
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
  const s = String(v == null ? '' : v).trim();
  return s === '' ? null : s;
};

// Champs éditables d'un client et leur longueur bornée (ces textes vivent dans
// une carte / une cellule, pas dans un traitement de texte). `client_type` est
// une ÉNUMÉRATION (pro / perso), pas un texte libre : validé à part.
const CLIENT_MAX = {
  entreprise: 120, nom: 80, type: 60, zone: 60,
  email: 160, telephone: 40,
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
  const { rows } = await pool.query(
    'SELECT billing_company FROM requests WHERE billing_company IS NOT NULL',
  );
  const counts = new Map();
  for (const r of rows) {
    const key = clientKey(r.billing_company);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// GET /api/clients → base clients complète, enrichie du nombre de commandes au
// planning et de notes. Sert AUSSI l'auto-complétion de la prise de commande.
app.get('/api/clients', asyncH(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM clients');
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

app.post('/api/clients/secteurs', asyncH(async (req, res) => {
  const label = req.body && req.body.label;
  const list = await addClientSecteur(label);
  if (!list) return res.status(400).json({ error: 'libellé de secteur vide' });
  res.status(201).json(list);
}));

app.delete('/api/clients/secteurs/:label', asyncH(async (req, res) => {
  res.json(await removeClientSecteur(req.params.label));
}));

// GET /api/clients/:id → une fiche + sa timeline de notes (récent en premier).
app.get('/api/clients/:id', asyncH(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
  const { rows: notes } = await pool.query(
    'SELECT * FROM client_notes WHERE client_id = $1 ORDER BY created_at DESC', [req.params.id],
  );
  const counts = await commandeCountByClientKey();
  res.json({ ...rows[0], notes, commandes: counts.get(clientKey(rows[0].entreprise)) || 0 });
}));

// `nextClientCode` (compteur « CLI-PRO-0007 ») vient de db.js : la migration qui
// rattrape les codes manquants s'en sert aussi, et il ne doit exister qu'UN seul
// compteur — deux fiches ne peuvent pas porter le même numéro.

// POST /api/clients → crée un client. Seule l'entreprise est obligatoire.
app.post('/api/clients', asyncH(async (req, res) => {
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
app.patch('/api/clients/:id', asyncH(async (req, res) => {
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
app.delete('/api/clients/:id', asyncH(async (req, res) => {
  // La fiche d'abord, ses notes ensuite : si la suppression échoue en chemin,
  // on ne veut pas d'un client vivant dont l'historique a disparu.
  const { rowCount } = await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Client introuvable' });
  await pool.query('DELETE FROM client_notes WHERE client_id = $1', [req.params.id]);
  broadcast({ kind: 'client' });
  res.status(204).end();
}));

// POST /api/clients/:id/notes → ajoute une note (note / appel / email / rdv).
app.post('/api/clients/:id/notes', asyncH(async (req, res) => {
  const body = req.body || {};
  const kind = NOTE_KINDS.has(body.kind) ? body.kind : 'note';
  const text = String(body.body == null ? '' : body.body).trim().slice(0, NOTE_MAX);
  if (!text) return res.status(400).json({ error: 'la note est vide' });
  const exists = await pool.query('SELECT 1 FROM clients WHERE id = $1', [req.params.id]);
  if (exists.rowCount === 0) return res.status(404).json({ error: 'Client introuvable' });
  const { rows } = await pool.query(
    'INSERT INTO client_notes (client_id, kind, body) VALUES ($1,$2,$3) RETURNING *',
    [req.params.id, kind, text],
  );
  broadcast({ kind: 'client' });
  res.status(201).json(rows[0]);
}));

// DELETE /api/clients/:id/notes/:noteId → retire une note de la timeline.
app.delete('/api/clients/:id/notes/:noteId', asyncH(async (req, res) => {
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
const COM_TYPE_BY_ID = new Map(COM.types.map((t) => [t.id, t]));
const COM_ZONE_BY_ID = new Map(COM.zones.map((z) => [z.id, z]));
const COM_DELAI_BY_ID = new Map(COM.delais.map((d) => [d.id, d]));
const COM_PAY_MODE_BY_ID = new Map(COM.paiementModes.map((p) => [p.id, p]));
const COM_TYPE_LOGO_BY_ID = new Map(COM.typeLogos.map((t) => [t.id, t]));
// Techniques de marquage d'un textile (sérigraphie, broderie, DTF, flex) : le
// COMMENT, quand l'emplacement dit le OÙ. Chaque marquage porte les deux.
const COM_TECHNIQUE_BY_ID = new Map((COM.techniques || []).map((t) => [t.id, t]));
// Modes acceptés par requests.paiement_mode. Défini ici, à côté du catalogue qui
// en est la source ; validateField le lit à la requête, donc bien après le
// chargement du module.
const PAIEMENT_MODE_SET = new Set(COM.paiementModes.map((p) => p.id));

// Les 4 types de projet (classeur « CRM TASSES OLDA », onglet Création Projet :
// Tasse / T-shirt / Goodies / Signalétique / Reprise Graphique / Autre, réduits
// aux 4 que le patron a validés pour Nouveau Projet). Seule la tasse a une
// grille de prix détaillée ; les autres restent sommaires (prix manuel).
// Les 4 types de projet. `forme` désigne le CONSTRUCTEUR de ligne à employer :
// chaque famille a désormais sa propre fiche de production (cf. spec
// « Nouveau Projet — champs détaillés par famille »). « Autres » et « Plaque
// signalétique » partagent la même : désignation, explication, matière, format,
// méthode de production.
const PROJET_TYPES = [
  { id: 'tasse', label: 'Tasse', forme: 'tasse' },
  { id: 'textile', label: 'Textile', forme: 'textile' },
  { id: 'autres', label: 'Autres', forme: 'autres' },
  { id: 'signaletique', label: 'Plaque signalétique', forme: 'autres' },
];
const PROJET_TYPE_BY_ID = new Map(PROJET_TYPES.map((t) => [t.id, t]));
// Les deux faces marquables d'un textile. L'ordre fait foi à l'affichage.
const PROJET_FACES_TEXTILE = [
  { id: 'avant', label: 'Face avant' },
  { id: 'arriere', label: 'Face arrière' },
];
const PROJET_TAILLES_MAX = 16;     // grille (7 cases) + quelques tailles libres
const TAILLE_MAX = 20;             // « Taille unique », « 3XL », « 12 ans »…
const PROJET_LIGNES_MAX = 30;

// Longueurs bornées : ces textes finissent dans une cellule de grille, pas dans
// un traitement de texte.
const VETEMENT_MAX = 80;
const REF_MAX = 40;
const COULEUR_MAX = 40;
// Un textile part souvent en PLUSIEURS coloris sur la même ligne (« Blanc,
// Noir, Bleu roi ») : le champ reçoit une liste, pas une teinte.
const COLORIS_LISTE_MAX = 160;
const REMARQUE_MAX = 400;
const TICKET_MAX = 24;          // « 26.07.30-001 » — numéro du ticket de caisse
const OBJET_MAX = 140;          // objet de la demande (titre d'une ligne du planning)
const DESCRIPTION_MAX = 1200;   // description libre de la demande
const TEXTE_MAX = 200;          // face de tasse, typo, info de personnalisation…

// Emplacements d'impression ajoutés au comptoir (base), en plus de ceux du
// catalogue. Gardés en MÉMOIRE pour que la validation d'un article reste
// synchrone ; la base n'est relue qu'au démarrage et à chaque ajout / retrait.
let CUSTOM_ZONES = [];
// Emplacements du catalogue masqués (inutiles pour ce poste) : le catalogue
// n'est pas modifié, on filtre juste ce qu'on en sert.
let HIDDEN_ZONES = [];
// `custom: true` distingue les zones effaçables (ajoutées) de celles du
// catalogue, que la fiche ne propose pas de retirer.
const allZones = () => [
  ...COM.zones.filter((z) => !HIDDEN_ZONES.includes(z.id)),
  ...CUSTOM_ZONES.map((z) => ({ ...z, custom: true })),
];
const zoneById = (id) => COM_ZONE_BY_ID.get(id) || CUSTOM_ZONES.find((z) => z.id === id) || null;
async function loadCommandeZones() {
  CUSTOM_ZONES = await getCommandeZones();
  HIDDEN_ZONES = await getHiddenCommandeZones();
}

// Nouveau Projet demande OÙ enregistrer avant de valider : il lui faut donc le
// pipeline complet (familles + sous-étapes), servi ici plutôt que recopié dans
// le module — une étape ajoutée en base apparaît dans le choix sans retoucher
// le front.
const PIPELINE = STAGES.map((s) => ({ ...s, subs: SUB_STAGES[s.slug] || [] }));

app.get('/api/pipeline', (req, res) => res.json(PIPELINE));

app.get('/api/commande/catalog', (req, res) => {
  res.json({
    ...COM, zones: allZones(), employes: RESPONSABLES, clientTypes: CLIENT_TYPES, pipeline: PIPELINE,
  });
});

// Quantité d'une ligne : « Qté identique », le nombre de pièces rigoureusement
// semblables. Toujours au moins 1 — une ligne sans pièce n'existe pas.
function readQuantite(raw, where) {
  const quantite = Number.parseInt(raw, 10);
  if (!Number.isInteger(quantite) || quantite < 1 || quantite > 9999) {
    return { error: `${where} : quantité invalide (1 à 9999)` };
  }
  return { quantite };
}

// TEXTILE — le vêtement, sa GRILLE DE TAILLES et ses placements (ex-« article »).
// Le catalogue ne fait que proposer : une taille de grille fournisseur exotique
// passe telle quelle. Deux formats acceptés :
//   - GRILLE (nouveau) : `tailles: [{ taille, quantite }]` — une quantité par
//     taille (XS…2XL). La quantité de la ligne est la SOMME ; les tailles à zéro
//     sont ignorées. Une ligne sans aucune quantité reste valable (demande dont
//     les tailles se préciseront plus tard).
//   - HISTORIQUE : `taille` (une seule) + `quantite` (pièces identiques).
// Un texte libre borné (face de tasse, typo, remarque…). Renvoie { value } ou
// { error } — jamais d'exception, l'appelant remonte le message tel quel.
function readTexte(raw, where, quoi, max) {
  const value = trimOrNull(raw);
  if (value && value.length > max) return { error: `${where} : ${quoi} trop long` };
  return { value };
}

// Le CONTACT, en deux formes exclusives. `societe` est le nom qui fait foi
// partout ailleurs (colonne du planning, base clients) : le nom de facturation
// pour un pro, « Prénom Nom » pour un particulier.
// Les anciens noms de champs (societe / contact / telephone) restent acceptés.
function buildClient(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const type = CLIENT_TYPE_SET.has(c.type) ? c.type : 'pro';

  const email = trimOrNull(c.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'email invalide' };
  const whatsapp = trimOrNull(c.whatsapp) || trimOrNull(c.telephone);
  if (whatsapp && whatsapp.length > 40) return { error: 'numéro WhatsApp trop long' };

  if (type === 'perso') {
    const prenom = trimOrNull(c.prenom);
    const nom = trimOrNull(c.nom);
    const societe = [prenom, nom].filter(Boolean).join(' ') || trimOrNull(c.societe);
    if (!societe) return { error: 'le nom du client (prénom, nom) est requis' };
    if (societe.length > 120) return { error: 'nom du client trop long' };
    // Pas de doublon dans la grille : le nom occupe déjà la colonne « Client ».
    return {
      client: {
        type, societe, facturation: null, prenom, nom,
        contact: null, whatsapp, telephone: whatsapp, email,
      },
    };
  }

  const facturation = trimOrNull(c.facturation) || trimOrNull(c.societe);
  if (!facturation) return { error: 'le nom du client (facturation) est requis' };
  if (facturation.length > 120) return { error: 'nom du client trop long' };
  const contact = trimOrNull(c.contact);
  if (contact && contact.length > 120) return { error: 'nom du contact trop long' };
  return {
    client: {
      type, societe: facturation, facturation, prenom: null, nom: null,
      contact, whatsapp, telephone: whatsapp, email,
    },
  };
}

// Destination retenue pour la fiche : { stage, subStage } ou { error }.
// Une sous-étape n'est acceptée QUE si elle appartient bien à la famille visée —
// sinon la ligne s'afficherait dans une famille dont la puce vient d'ailleurs.
// Une famille à sous-étapes peut rester « à préciser » (subStage null) : c'est
// une position valide du planning, pas un oubli.
const SUB_SLUGS_BY_STAGE = new Map(
  Object.entries(SUB_STAGES).map(([stage, list]) => [stage, new Set(list.map((s) => s.slug))]),
);

function buildDestination(b, type) {
  if (b.stage == null || b.stage === '') return { stage: type.stage, subStage: type.subStage };
  if (!STAGE_SLUGS.includes(b.stage)) return { error: `étape inconnue : ${b.stage}` };
  const subStage = b.subStage == null || b.subStage === '' ? null : b.subStage;
  if (subStage === null) return { stage: b.stage, subStage: null };
  const allowed = SUB_SLUGS_BY_STAGE.get(b.stage);
  if (!allowed || !allowed.has(subStage)) {
    return { error: `sous-étape « ${subStage} » étrangère à l'étape « ${b.stage} »` };
  }
  return { stage: b.stage, subStage };
}

// --- NOUVEAU PROJET -----------------------------------------------------------
// Le flux comptoir : client → panier de produits → prix. Chaque famille a sa
// propre fiche de production (tasse, textile, autres/signalétique), construite
// par la fonction correspondante ci-dessous. Pour la tasse, les options
// référencent des ids du catalogue tarifs (jamais un prix envoyé par le client
// — toujours recalculé depuis `tarifsById` chargé juste avant l'appel) ; le
// prix unitaire, lui, peut être écrasé au comptoir.

// Prix d'une ligne, en TTC. Le TTC est la RÉFÉRENCE : le HT s'en déduit avec le
// taux TGCA du moment, il n'est jamais lu depuis la requête. Deux formes
// acceptées :
//   - UNITAIRE (actuelle) : `prixUnitaireTtc`, multiplié par la quantité.
//   - HISTORIQUE : `prixTtcManuel`, qui portait le TOTAL de la ligne.
// `defautUnitaireTtc` (tasse) sert quand le comptoir n'a rien saisi : le prix
// calculé depuis la grille tarifaire fait alors foi.
// `prixFacultatif` (demande de devis) : une demande arrive PAR DÉFINITION sans
// prix — c'est justement ce qu'Atelier OLDA doit chiffrer. La ligne vaut alors
// `null`, jamais 0 : « pas encore chiffré » et « gratuit » ne se confondent pas
// dans la colonne Prix TTC du planning.
function readPrixLigne(raw, quantite, where, defautUnitaireTtc, prixFacultatif) {
  const l = raw && typeof raw === 'object' ? raw : {};
  const cents = (v) => Math.round(v * 100) / 100;
  const positif = (v) => Number.isFinite(v) && v >= 0;

  const unitaire = Number(l.prixUnitaireTtc);
  const total = Number(l.prixTtcManuel);
  let prixUnitaireTtc;
  let prixLigneTtc;
  if (l.prixUnitaireTtc != null && l.prixUnitaireTtc !== '') {
    if (!positif(unitaire)) return { error: `${where} : prix unitaire TTC invalide` };
    prixUnitaireTtc = cents(unitaire);
    prixLigneTtc = cents(prixUnitaireTtc * quantite);
  } else if (l.prixTtcManuel != null && l.prixTtcManuel !== '') {
    if (!positif(total)) return { error: `${where} : prix TTC invalide` };
    prixLigneTtc = cents(total);
    prixUnitaireTtc = cents(prixLigneTtc / quantite);
  } else if (defautUnitaireTtc != null) {
    prixUnitaireTtc = cents(defautUnitaireTtc);
    prixLigneTtc = cents(prixUnitaireTtc * quantite);
  } else if (prixFacultatif) {
    return { prixUnitaireTtc: null, prixUnitaireHt: null, prixLigneTtc: 0, prixCatalogue: false };
  } else {
    return { error: `${where} : prix TTC invalide` };
  }
  return {
    prixUnitaireTtc,
    prixUnitaireHt: cents(prixUnitaireTtc / (1 + PROJET_TGCA)),
    prixLigneTtc,
    // Trace : le prix vient-il de la grille tarifaire ou de la main de l'employé ?
    prixCatalogue: defautUnitaireTtc != null && prixUnitaireTtc === cents(defautUnitaireTtc),
  };
}

// Ligne TASSE : résout produit/face1/face2/dessous/bat depuis le catalogue.
// Renvoie { ligne, prixLigneTtc, prixRevientLigne } ou { error }.
function buildLigneTasse(raw, index, tarifsById) {
  const where = `Tasse ${index + 1}`;
  const l = raw && typeof raw === 'object' ? raw : {};
  const q = readQuantite(l.quantite, where);
  if (q.error) return { error: q.error };

  const resolve = (id, champ, categorie) => {
    if (id == null || id === '') return { article: null };
    const a = tarifsById.get(id);
    if (!a || a.categorie !== categorie) return { error: `${where} : ${champ} inconnu` };
    return { article: a };
  };
  const produit = resolve(l.produitId, 'type de tasse', 'produit');
  if (produit.error) return { error: produit.error };
  if (!produit.article) return { error: `${where} : le type de tasse est requis` };
  const face1 = resolve(l.face1Id, 'option face 1', 'face');
  if (face1.error) return { error: face1.error };
  const face2 = resolve(l.face2Id, 'option face 2', 'face');
  if (face2.error) return { error: face2.error };
  const dessous = resolve(l.dessousId, 'option dessous', 'dessous');
  if (dessous.error) return { error: dessous.error };
  const bat = resolve(l.batId, 'BAT', 'bat');
  if (bat.error) return { error: bat.error };

  const coloris = trimOrNull(l.coloris);
  if (coloris && coloris.length > TEXTE_MAX) return { error: `${where} : coloris trop long` };
  const remarque = trimOrNull(l.remarque);
  if (remarque && remarque.length > REMARQUE_MAX) return { error: `${where} : remarque trop longue` };

  // Ce qu'on GRAVE, à côté de ce qu'on FACTURE : la puce tarifée dit l'option
  // vendue (« Texte personnalisé simple », 6 €), ces textes disent le contenu
  // exact à passer en machine (« OLDA — Grand Case »).
  const textes = {};
  for (const [champ, quoi] of [['face1Texte', 'texte de la face 1'], ['face2Texte', 'texte de la face 2'],
    ['dessousTexte', 'texte du dessous'], ['typo', 'typo']]) {
    const t = readTexte(l[champ], where, quoi, TEXTE_MAX);
    if (t.error) return { error: t.error };
    textes[champ] = t.value;
  }

  const parts = [produit.article, face1.article, face2.article, dessous.article, bat.article].filter(Boolean);
  const catalogueTtc = parts.reduce((s, a) => s + a.prixVenteTtc, 0);
  const prixAchatUnitaire = parts.reduce((s, a) => s + a.prixAchat, 0);
  const tempsMoUnitaire = parts.reduce((s, a) => s + a.tempsMoMin, 0);
  const tempsMachineUnitaire = parts.reduce((s, a) => s + a.tempsMachineMin, 0);
  // La grille tarifaire propose ; le comptoir peut écraser (remise négociée,
  // cas particulier). Le COÛT DE REVIENT, lui, reste celui de la grille : un
  // prix de vente négocié ne change pas ce que la tasse coûte à produire.
  const prix = readPrixLigne(l, q.quantite, where, catalogueTtc);
  if (prix.error) return { error: prix.error };

  const asRef = (a) => (a ? { id: a.id, label: a.designation, prixTtc: a.prixVenteTtc } : null);
  return {
    ligne: {
      quantite: q.quantite,
      produit: asRef(produit.article), coloris,
      face1: asRef(face1.article), face2: asRef(face2.article), dessous: asRef(dessous.article),
      face1Texte: textes.face1Texte, face2Texte: textes.face2Texte, dessousTexte: textes.dessousTexte,
      typo: textes.typo,
      bat: bat.article ? bat.article.designation === 'Oui' : false,
      remarque,
      prixUnitaireTtc: prix.prixUnitaireTtc, prixUnitaireHt: prix.prixUnitaireHt,
      prixCatalogue: prix.prixCatalogue,
      description: null, prixTtcManuel: null,
    },
    prixLigneTtc: prix.prixLigneTtc,
    prixRevientLigne: q.quantite * (prixAchatUnitaire + (tempsMoUnitaire / 60) * PROJET_TAUX_MO
      + (tempsMachineUnitaire / 60) * PROJET_TAUX_MACHINE),
  };
}

// GRILLE DE TAILLES d'un textile : une quantité par taille (Taille unique, XS…2XL
// et tailles libres). La quantité de la ligne en est la SOMME — on ne redemande
// pas un « Qté » qui pourrait la contredire. Une grille vide est acceptée :
// `quantite` prend alors le relais (demande dont les tailles se préciseront).
function readTailles(raw, where) {
  if (!Array.isArray(raw)) return { tailles: [] };
  if (raw.length > PROJET_TAILLES_MAX) return { error: `${where} : trop de tailles (${PROJET_TAILLES_MAX} maximum)` };
  const tailles = [];
  for (const t of raw) {
    const cell = t && typeof t === 'object' ? t : {};
    const taille = trimOrNull(cell.taille);
    if (!taille) continue;
    if (taille.length > TAILLE_MAX) return { error: `${where} : nom de taille trop long` };
    const n = Number.parseInt(cell.quantite, 10);
    if (!Number.isInteger(n) || n < 1) continue;      // une taille à zéro ne part pas
    if (n > 9999) return { error: `${where} : quantité invalide pour la taille ${taille}` };
    tailles.push({ taille, quantite: n });
  }
  return { tailles };
}

// UNE FACE marquée d'un textile (avant / arrière) : où, quoi, quelle référence,
// quelle couleur. Une face sans emplacement n'est pas retenue — l'atelier ne
// doit jamais lire une consigne à moitié posée.
function readFaceTextile(raw, face, where) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const zone = zoneById(f.emplacement);
  if (!zone) return { face: null };
  const technique = COM_TECHNIQUE_BY_ID.get(f.technique) || null;
  const typeLogo = COM_TYPE_LOGO_BY_ID.get(f.typeLogo) || null;
  const ref = readTexte(f.referenceLogo, where, `référence logo (${face.label.toLowerCase()})`, TEXTE_MAX);
  if (ref.error) return { error: ref.error };
  const couleur = readTexte(f.couleurMarquage, where, `couleur de marquage (${face.label.toLowerCase()})`, COULEUR_MAX);
  if (couleur.error) return { error: couleur.error };
  return {
    face: {
      face: face.id, faceLabel: face.label,
      emplacement: { id: zone.id, label: zone.label },
      // Le COMMENT du marquage (sérigraphie, broderie, DTF, flex) : c'est lui
      // qui dit à l'atelier quelle machine sort, l'emplacement ne dit que le OÙ.
      technique: technique ? { id: technique.id, label: technique.label } : null,
      typeLogo: typeLogo ? { id: typeLogo.id, label: typeLogo.label } : null,
      referenceLogo: ref.value, couleurMarquage: couleur.value,
    },
  };
}

// Ligne TEXTILE : le vêtement, sa grille de tailles, ses deux faces marquées.
function buildLigneTextile(raw, index, prixFacultatif) {
  const where = `Textile ${index + 1}`;
  const l = raw && typeof raw === 'object' ? raw : {};

  const grille = readTailles(l.tailles, where);
  if (grille.error) return { error: grille.error };
  const totalTailles = grille.tailles.reduce((s, t) => s + t.quantite, 0);
  const q = totalTailles > 0 ? { quantite: totalTailles } : readQuantite(l.quantite, where);
  if (q.error) return { error: q.error };

  const designation = readTexte(l.designation ?? l.description, where, 'désignation produit', VETEMENT_MAX);
  if (designation.error) return { error: designation.error };
  if (!designation.value) return { error: `${where} : la désignation du produit est vide` };
  const reference = readTexte(l.reference, where, 'référence', REF_MAX);
  if (reference.error) return { error: reference.error };
  const coloris = readTexte(l.coloris, where, 'couleur', COLORIS_LISTE_MAX);
  if (coloris.error) return { error: coloris.error };
  const remarque = readTexte(l.remarque, where, 'remarque', REMARQUE_MAX);
  if (remarque.error) return { error: remarque.error };

  const faces = [];
  for (const face of PROJET_FACES_TEXTILE) {
    const built = readFaceTextile((l.faces || {})[face.id], face, where);
    if (built.error) return { error: built.error };
    if (built.face) faces.push(built.face);
  }

  const prix = readPrixLigne(l, q.quantite, where, null, prixFacultatif);
  if (prix.error) return { error: prix.error };

  const tailleTxt = grille.tailles.map((t) => `${t.taille}×${t.quantite}`).join(' · ');
  const identite = [reference.value && `réf. ${reference.value}`, coloris.value, tailleTxt].filter(Boolean).join(' · ');
  return {
    ligne: {
      quantite: q.quantite,
      designation: designation.value, reference: reference.value, coloris: coloris.value,
      tailles: grille.tailles, faces, remarque: remarque.value,
      prixUnitaireTtc: prix.prixUnitaireTtc, prixUnitaireHt: prix.prixUnitaireHt,
      // Résumé lisible : c'est lui qui alimente la grille du planning et la
      // recherche, comme la « description » des fiches d'avant.
      description: `${q.quantite} × ${designation.value}${identite ? ` — ${identite}` : ''}`,
      produit: null, face1: null, face2: null, dessous: null, bat: false, prixTtcManuel: null,
    },
    prixLigneTtc: prix.prixLigneTtc,
    prixRevientLigne: 0,
  };
}

// Ligne AUTRES / PLAQUE SIGNALÉTIQUE : un projet décrit à la main (désignation,
// explication, matière, format, méthode de production).
// `categorie`, `reference` et `couleur` viennent de la DEMANDE DE DEVIS : le
// client demande « des NS300 noirs, catégorie Textile » bien avant qu'un article
// du catalogue soit choisi. Facultatifs — la vente directe ne les envoie pas.
function buildLigneAutres(raw, index, typeLabel, prixFacultatif) {
  const where = `${typeLabel} ${index + 1}`;
  const l = raw && typeof raw === 'object' ? raw : {};
  const q = readQuantite(l.quantite, where);
  if (q.error) return { error: q.error };

  const designation = readTexte(l.designation ?? l.description, where, 'désignation du projet', OBJET_MAX);
  if (designation.error) return { error: designation.error };
  if (!designation.value) return { error: `${where} : la désignation du projet est vide` };
  const champs = {};
  for (const [champ, quoi, max] of [['explication', 'explication du projet', DESCRIPTION_MAX],
    ['matiere', 'matière', TEXTE_MAX], ['format', 'format', TEXTE_MAX],
    ['methode', 'méthode de production', TEXTE_MAX],
    ['categorie', 'catégorie', TEXTE_MAX], ['reference', 'référence', TEXTE_MAX],
    ['couleur', 'couleur', TEXTE_MAX]]) {
    const t = readTexte(l[champ], where, quoi, max);
    if (t.error) return { error: t.error };
    champs[champ] = t.value;
  }

  const prix = readPrixLigne(l, q.quantite, where, null, prixFacultatif);
  if (prix.error) return { error: prix.error };

  // Ce que la grille du planning et la recherche liront : la désignation, puis
  // ce qui distingue vraiment la demande (référence demandée, couleur).
  const identite = [
    champs.reference && `réf. ${champs.reference}`, champs.couleur,
  ].filter(Boolean).join(' · ');
  return {
    ligne: {
      quantite: q.quantite, designation: designation.value, ...champs,
      prixUnitaireTtc: prix.prixUnitaireTtc, prixUnitaireHt: prix.prixUnitaireHt,
      description: `${q.quantite} × ${designation.value}${identite ? ` — ${identite}` : ''}`,
      produit: null, coloris: null, face1: null, face2: null, dessous: null, bat: false,
      remarque: null, prixTtcManuel: null,
    },
    prixLigneTtc: prix.prixLigneTtc,
    prixRevientLigne: 0,
  };
}

// Variables de calcul (taux horaires, TGCA) injectées avant chaque appel à
// buildProjet — évite de faire de buildProjet une fonction async (elle reste
// pure et testable), tout en lisant les tarifs réglés par le patron plutôt que
// des constantes figées dans le code.
let PROJET_TAUX_MO = 25;
let PROJET_TAUX_MACHINE = 25;
let PROJET_TGCA = 0.04;

// Où en est l'argent du projet, en UN choix. `demande`/`verse`/`paye` est la
// PROJECTION du statut sur les colonnes du planning (requests.acompte_demande,
// acompte_verse, paye), qui restent la source de vérité de la grille, du
// dashboard et du tiroir. `null` = « on ne se prononce pas » : au comptoir on ne
// sait pas toujours, et « on ne sait pas » ne doit pas s'enregistrer comme « non ».
const PROJET_PAY_STATUTS = [
  { id: 'non_demande', label: 'Non demandé', demande: null, verse: null, paye: null },
  { id: 'acompte_demande', label: 'Acompte demandé', demande: true, verse: false, paye: false },
  { id: 'acompte_recu', label: 'Acompte reçu', demande: true, verse: true, paye: false },
  { id: 'a_encaisser', label: 'Paiement à encaisser', demande: false, verse: false, paye: false },
  { id: 'paye', label: 'Payé', demande: null, verse: null, paye: true },
];
const PROJET_PAY_STATUT_BY_ID = new Map(PROJET_PAY_STATUTS.map((s) => [s.id, s]));

// Suivi du paiement envoyé par le comptoir. Tout est FACULTATIF : sans statut
// choisi, rien n'est affirmé.
// Deux formes acceptées, parce qu'un poste dont l'onglet est resté ouvert peut
// encore poster l'ancienne (le JS n'est pas versionné, cf. incident du cache
// navigateur) :
//   - STATUT (actuelle) : `statut` + `modeAcompte` / `modeFinal`.
//   - HISTORIQUE : trois booléens `acompteDemande` / `acompteVerse` / `paye`
//     + un `mode` unique. Le statut équivalent est déduit.
// Le montant n'a de sens que si l'acompte est reçu — sinon il est ignoré.
function readPaiement(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const bool = (v) => (v === true || v === false ? v : null);
  const ref = (m) => { const x = COM_PAY_MODE_BY_ID.get(m); return x ? { id: x.id, label: x.label } : null; };

  const statut = PROJET_PAY_STATUT_BY_ID.get(p.statut) || deduireStatut(p);
  const modeAcompte = ref(p.modeAcompte);
  const modeFinal = ref(p.modeFinal);
  // La colonne `paiement_mode` est unique : elle porte le mode le plus avancé
  // connu. Les deux restent intacts dans la fiche.
  const mode = modeFinal || modeAcompte || ref(p.mode);

  const montant = Number(p.acompteMontant);
  const acompteRecu = statut ? statut.id === 'acompte_recu' : bool(p.acompteVerse) === true;
  return {
    statut: statut ? { id: statut.id, label: statut.label } : null,
    acompteMontant: acompteRecu && Number.isFinite(montant) && montant >= 0
      ? Math.round(montant * 100) / 100
      : null,
    modeAcompte,
    modeFinal,
    // Projection sur les colonnes du planning.
    acompteDemande: statut ? statut.demande : bool(p.acompteDemande),
    acompteVerse: statut ? statut.verse : bool(p.acompteVerse),
    paye: statut ? statut.paye : bool(p.paye),
    mode,
  };
}

// Ancienne forme (trois booléens) → le statut qui lui correspond, pour que les
// fiches gardent toutes le même vocabulaire. Rien de coché = pas de statut.
function deduireStatut(p) {
  if (p.paye === true) return PROJET_PAY_STATUT_BY_ID.get('paye');
  if (p.acompteVerse === true) return PROJET_PAY_STATUT_BY_ID.get('acompte_recu');
  if (p.acompteDemande === true) return PROJET_PAY_STATUT_BY_ID.get('acompte_demande');
  return null;
}

// --- DEMANDE DE DEVIS ---------------------------------------------------------
// Le BRIEF que la vendeuse recueille au comptoir ou au téléphone : qui a pris la
// demande, par quel canal, ce que le client veut obtenir, et surtout OÙ EN EST LE
// DOSSIER (logo reçu ou pas, vectorisation, informations encore attendues).
// Rien n'est obligatoire ici — c'est le front qui exige ce qu'il faut avant de
// laisser passer ; le serveur borne les textes et refuse les valeurs inventées.
// Tout est facultatif côté serveur pour que la vente directe, qui n'envoie pas
// de brief, continue de passer sans rien changer.
const DEMANDE_ETATS = new Map([
  ['recu', 'Informations reçues'],
  ['partiel', 'Informations reçues partiellement'],
  ['attente', 'En attente d’informations'],
]);
const DEMANDE_SUITES = new Map([
  ['devis', 'Devis à faire'],
  ['attente', 'Attendre les informations du client'],
]);

function readDemande(raw) {
  if (!raw || typeof raw !== 'object') return { demande: null };
  const textes = {};
  for (const [champ, quoi, max] of [
    ['prisePar', 'personne qui a pris la demande', TEXTE_MAX],
    ['canal', 'canal d’entrée', TEXTE_MAX],
    ['objet', 'objet du projet', TEXTE_MAX],
    ['description', 'description du projet', DESCRIPTION_MAX],
    ['contraintes', 'contraintes du projet', DESCRIPTION_MAX],
    ['logoType', 'type de logo', TEXTE_MAX],
    ['logoStatut', 'statut du logo', TEXTE_MAX],
    ['vectorisation', 'reprise de vectorisation', TEXTE_MAX],
    ['maquette', 'maquette / fichier numérique', TEXTE_MAX],
    ['transmisPar', 'mode de transmission', TEXTE_MAX],
    ['attenduPar', 'mode de transmission attendu', TEXTE_MAX],
    ['attendu', 'informations attendues', DESCRIPTION_MAX],
    ['recus', 'éléments reçus du client', DESCRIPTION_MAX],
    ['aVerifier', 'points à contrôler', DESCRIPTION_MAX],
  ]) {
    const t = readTexte(raw[champ], 'Demande', quoi, max);
    if (t.error) return { error: t.error };
    textes[champ] = t.value;
  }

  if (raw.etat != null && raw.etat !== '' && !DEMANDE_ETATS.has(raw.etat)) {
    return { error: `état du dossier inconnu : ${raw.etat}` };
  }
  if (raw.suite != null && raw.suite !== '' && !DEMANDE_SUITES.has(raw.suite)) {
    return { error: `suite à donner inconnue : ${raw.suite}` };
  }
  // Le budget est INDICATIF : ce que le client a annoncé, jamais un prix. Il ne
  // remplit donc pas `project_value` — c'est le chiffrage qui le fera.
  const budget = Number(raw.budget);
  const budgetOk = raw.budget != null && raw.budget !== '' && Number.isFinite(budget) && budget >= 0;

  return {
    demande: {
      ...textes,
      priseLe: isDay(raw.priseLe) ? raw.priseLe : null,
      etat: DEMANDE_ETATS.has(raw.etat) ? { id: raw.etat, label: DEMANDE_ETATS.get(raw.etat) } : null,
      suite: DEMANDE_SUITES.has(raw.suite) ? { id: raw.suite, label: DEMANDE_SUITES.get(raw.suite) } : null,
      budget: budgetOk ? Math.round(budget * 100) / 100 : null,
    },
  };
}

// Un projet est un PANIER : plusieurs produits, de types DIFFÉRENTS (une
// tasse, un polo, une plaque…), pour un seul client et un seul enregistrement
// — façon caisse SumUp, on encaisse tout d'un coup. Chaque ligne du panier
// porte donc son propre type ; il n'y a plus de type unique au niveau projet.
function buildProjet(body, tarifsById) {
  const b = body && typeof body === 'object' ? body : {};

  const orderType = COM_TYPE_BY_ID.get(b.kind);
  if (!orderType) return { error: `nature inconnue : ${b.kind} (demande ou commande)` };
  const dest = buildDestination(b, orderType);
  if (dest.error) return { error: dest.error };

  const who = buildClient(b.client);
  if (who.error) return { error: who.error };
  const { client } = who;

  const rawLignes = Array.isArray(b.lignes) ? b.lignes : [];
  if (rawLignes.length === 0) return { error: 'un projet doit contenir au moins un produit' };
  if (rawLignes.length > PROJET_LIGNES_MAX) return { error: `trop de produits (${PROJET_LIGNES_MAX} maximum)` };

  // Une DEMANDE arrive sans prix — c'est ce qu'Atelier OLDA doit chiffrer. Une
  // COMMANDE, elle, est déjà chiffrée : le prix y reste obligatoire.
  const prixFacultatif = orderType.id === 'demande';

  const lignes = [];
  let prixTotalTtc = 0;
  let prixRevientTotal = 0;
  for (let i = 0; i < rawLignes.length; i += 1) {
    const raw = rawLignes[i] && typeof rawLignes[i] === 'object' ? rawLignes[i] : {};
    const type = PROJET_TYPE_BY_ID.get(raw.type);
    if (!type) return { error: `Produit ${i + 1} : type de projet inconnu (${raw.type})` };
    let built;
    if (type.forme === 'tasse') built = buildLigneTasse(raw, i, tarifsById);
    else if (type.forme === 'textile') built = buildLigneTextile(raw, i, prixFacultatif);
    else built = buildLigneAutres(raw, i, type.label, prixFacultatif);
    if (built.error) return { error: built.error };
    built.ligne.type = { id: type.id, label: type.label };
    lignes.push(built.ligne);
    prixTotalTtc += built.prixLigneTtc;
    prixRevientTotal += built.prixRevientLigne;
  }

  // DÉLAI OBLIGATOIRE : soit un raccourci du catalogue (qui porte sa majoration),
  // soit une date précise choisie au calendrier (jamais de majoration — on ne
  // facture pas l'urgence d'une date que le client a lui-même fixée au large).
  // Aucun défaut silencieux : sans l'un ni l'autre, la fiche est refusée, pour
  // qu'aucune ligne n'entre au planning sans date butoir.
  const delaiChoisi = COM_DELAI_BY_ID.get(b.delai) || null;
  const dateChoisie = isDay(b.deadline) ? b.deadline : null;
  if (!delaiChoisi && !dateChoisie) {
    return { error: 'le délai est obligatoire : choisis un raccourci ou une date précise' };
  }
  const delai = delaiChoisi || { id: 'date', label: `Pour le ${dateChoisie}`, jours: 0, majoration: 0 };
  // AUCUNE ligne chiffrée (demande de devis) : le projet vaut `null`, pas 0 —
  // la colonne Prix TTC du planning reste vide jusqu'au chiffrage, au lieu
  // d'annoncer un projet à 0,00 €.
  const nonChiffre = lignes.every((l) => l.prixUnitaireTtc == null);
  prixTotalTtc = prixTotalTtc * (1 + (delai.majoration || 0) / 100);
  prixTotalTtc = nonChiffre ? null : Math.round(prixTotalTtc * 100) / 100;

  // La date précise l'emporte : c'est une échéance dictée par le client, pas un
  // J+n calculé.
  const deadline = dateChoisie || todayPlus(delai.jours);
  const priority = Math.min(3, Math.max(1, Number.parseInt(b.priority, 10) || 1));
  const quantite = lignes.reduce((s, l) => s + l.quantite, 0);

  // Vente directe (comptoir) : l'HEURE de retrait, la note interne et le numéro
  // du ticket remis au client. Facultatifs — les autres flux n'en ont pas.
  const heure = isHeure(b.heureSouhaitee) ? b.heureSouhaitee : null;
  if (b.heureSouhaitee != null && b.heureSouhaitee !== '' && !heure) {
    return { error: `heure souhaitée invalide : ${b.heureSouhaitee}` };
  }
  const note = readTexte(b.noteInterne, 'Note interne', 'note interne', DESCRIPTION_MAX);
  if (note.error) return { error: note.error };
  const ticket = readTexte(b.numero, 'Ticket', 'numéro de ticket', TICKET_MAX);
  if (ticket.error) return { error: ticket.error };
  // Le client est reparti avec sa commande : il n'y a plus rien à produire ni à
  // faire retirer. C'est le comptoir qui le sait, personne d'autre.
  const retraitImmediat = b.retraitImmediat === true;

  const venteHt = nonChiffre ? null : prixTotalTtc / (1 + PROJET_TGCA);
  const margeHt = nonChiffre ? null : Math.round((venteHt - prixRevientTotal) * 100) / 100;
  // Le HT n'est jamais stocké : il se déduit du TTC et du taux TGCA du moment.
  // On le renvoie quand même à l'écran de confirmation, pour éviter que chaque
  // vue le recalcule avec un taux qu'elle aurait deviné.
  const prixTotalHt = nonChiffre ? null : Math.round(venteHt * 100) / 100;

  const paiement = readPaiement(b.paiement);
  // Le PILOTE de la ligne. La vente directe n'en désigne pas ; la demande de
  // devis, si : celle qui a pris la demande la suit jusqu'au devis.
  const responsable = RESPONSABLE_SET.has(b.responsable) ? b.responsable : null;

  const brief = readDemande(b.demande);
  if (brief.error) return { error: brief.error };

  const projet = {
    kind: 'projet-simple',
    // v1 = type unique ; v2 = panier multi-type ; v3 = suivi paiement ;
    // v4 = fiche de production détaillée par famille + prix unitaire HT/TTC ;
    // v5 = vente directe (numéro de ticket, heure de retrait, note interne) ;
    // v6 = demande de devis (brief client, contrôle du dossier, prix non chiffré)
    version: 6,
    orderKind: orderType.id,
    numero: ticket.value,
    client,
    lignes,
    demande: brief.demande,
    heureSouhaitee: heure,
    noteInterne: note.value,
    retraitImmediat,
    responsable,
    delai: { id: delai.id, label: delai.label, majoration: delai.majoration || 0 },
    prixTotalTtc,
    prixTotalHt,
    margeHt,
    paiement,
    deadline,
    priority,
    stage: dest.stage,
    subStage: dest.subStage,
    quantite,
    createdAt: new Date().toISOString(),
  };

  const detailLigneTexte = (l) => {
    if (l.produit) {
      const opts = [l.face1, l.face2, l.dessous].filter((o) => o && o.label !== 'Aucune').map((o) => o.label);
      return `${l.quantite} × ${l.produit.label}${l.coloris ? ` (${l.coloris})` : ''}${opts.length ? ` — ${opts.join(', ')}` : ''}`;
    }
    // `description` porte déjà « 10 × Polo — réf. … » : la préfixer une seconde
    // fois par la quantité donnerait « 10 × 10 × Polo ».
    return l.description;
  };
  const noms = lignes.map((l) => (l.produit ? l.produit.label : (l.designation || l.description)));
  const uniqNoms = [...new Set(noms)];
  const produitResume = lignes.length === 1
    ? `${lignes[0].quantite} × ${noms[0]}`
    : `${quantite} pièces — ${uniqNoms.slice(0, 3).join(', ')}${uniqNoms.length > 3 ? '…' : ''}`;

  const typesPresents = [...new Set(lignes.map((l) => l.type.label))];
  // Ligne « argent » du résumé : elle ne dit que ce qui est réellement connu,
  // pour qu'on ne lise jamais « non payé » là où personne n'a rien renseigné.
  const etatPaiement = [
    paiement.statut ? paiement.statut.label.toLowerCase() : null,
    paiement.acompteMontant != null ? `${paiement.acompteMontant.toFixed(2)} €` : null,
    paiement.mode ? paiement.mode.label : null,
  ].filter(Boolean).join(' · ');
  // Le brief de la demande de devis, en clair : c'est ce que lira celui qui
  // chiffrera, et il doit pouvoir le faire sans rappeler le client.
  const d = brief.demande;
  const lignesDemande = d ? [
    [d.prisePar && `Demande prise par ${d.prisePar}`, d.canal && `via ${d.canal}`,
      d.priseLe && `le ${d.priseLe}`].filter(Boolean).join(' ') || null,
    d.objet ? `Objet : ${d.objet}` : null,
    d.budget != null ? `Budget indicatif : ${d.budget.toFixed(2)} €` : null,
    d.description ? `Projet : ${d.description}` : null,
    d.contraintes ? `À garder en tête : ${d.contraintes}` : null,
    d.etat ? `Dossier : ${d.etat.label}` : null,
    d.logoType ? `Logo : ${d.logoType}${d.logoStatut ? ` (${d.logoStatut})` : ''}` : null,
    d.vectorisation ? `Vectorisation : ${d.vectorisation}` : null,
    d.maquette ? `Maquette : ${d.maquette}` : null,
    d.transmisPar ? `Informations transmises par ${d.transmisPar}` : null,
    d.recus ? `Reçu du client : ${d.recus}` : null,
    d.attendu ? `Encore attendu${d.attenduPar ? ` (par ${d.attenduPar})` : ''} : ${d.attendu}` : null,
    d.aVerifier ? `À contrôler : ${d.aVerifier}` : null,
    d.suite ? `Suite à donner : ${d.suite.label}` : null,
  ].filter(Boolean) : [];

  const resume = [
    `${typesPresents.join(' + ').toUpperCase()} — ${client.societe}${client.type === 'perso' ? ' (perso)' : ''}`,
    ticket.value ? `${prixFacultatif ? 'Demande' : 'Ticket'} : ${ticket.value}` : null,
    ...lignes.map(detailLigneTexte),
    `Délai : ${delai.label}${delai.majoration ? ` (+${delai.majoration} %)` : ''}`,
    // Au comptoir l'heure est celle du RETRAIT ; sur une demande de devis, ce
    // n'est qu'un souhait du client — on ne lui promet pas un retrait.
    heure ? `${prixFacultatif ? 'Souhaité' : 'Retrait souhaité'} : le ${deadline} à ${heure.replace(':', 'h')}` : null,
    retraitImmediat ? 'Le client est reparti avec sa commande.' : null,
    nonChiffre ? 'Prix : à chiffrer' : `Prix : ${prixTotalTtc.toFixed(2)} € TTC (${prixTotalHt.toFixed(2)} € HT)`,
    etatPaiement ? `Paiement : ${etatPaiement}` : null,
    ...lignesDemande,
    note.value ? `Note interne : ${note.value}` : null,
  ].filter(Boolean).join('\n');

  return { projet, resume, produit: produitResume };
}

// POST /api/projets → crée un Nouveau Projet (comptoir ultra-minimal). Recharge
// systématiquement le catalogue tarifs + paramètres AVANT de construire, pour
// ne jamais calculer avec des prix périmés.
app.post('/api/projets', asyncH(async (req, res) => {
  const [articles, parametres] = await Promise.all([getTarifsTasseArticles(), getTarifsTasseParametres()]);
  PROJET_TAUX_MO = parametres.tauxHoraireMo;
  PROJET_TAUX_MACHINE = parametres.tauxHoraireMachine;
  PROJET_TGCA = parametres.tgca;
  const tarifsById = new Map(articles.filter((a) => a.actif).map((a) => [a.id, a]));

  const built = buildProjet(req.body || {}, tarifsById);
  if (built.error) return res.status(400).json({ error: built.error });
  const { projet, resume, produit } = built;

  const { rows: posRows } = await pool.query(
    'SELECT COALESCE(MAX(position), 0) + 1000 AS pos FROM requests WHERE stage = $1', [projet.stage],
  );

  const { rows } = await pool.query(
    `INSERT INTO requests
       (stage, sub_stage, order_kind, responsable, priority, client_type, billing_company, contact_referent,
        contact_phone, contact_email, quantity, product, description, deadline, position, fiche, project_value,
        acompte_demande, acompte_verse, acompte_montant, paye, paiement_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING *`,
    [
      // La NATURE tranchée à la prise : une demande de devis entre en
      // « demande » (à chiffrer), une vente directe en « commande » (validée).
      projet.stage, projet.subStage, projet.orderKind, projet.responsable, projet.priority, projet.client.type,
      projet.client.societe, projet.client.contact, projet.client.telephone, projet.client.email,
      projet.quantite, produit, resume, projet.deadline, posRows[0].pos,
      // `project_value` porte le TTC : c'est le prix que le client paie, et
      // c'est lui qu'on saisit au comptoir. Le HT s'en déduit à l'affichage.
      JSON.stringify(projet), projet.prixTotalTtc,
      projet.paiement.acompteDemande, projet.paiement.acompteVerse, projet.paiement.acompteMontant,
      projet.paiement.paye, projet.paiement.mode ? projet.paiement.mode.id : null,
    ],
  );

  await upsertClientSansBloquer(projet.client);

  broadcast({ kind: 'create', stages: [projet.stage] });
  res.status(201).json({ id: rows[0].id, projet });
}));

// ---------------------------------------------------------------------------
// COMPTOIR — les deux parcours validés par le patron (public/comptoir/*.html).
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
  return require('crypto').createHash('sha256').update(brut, 'utf8').digest('hex').slice(0, 32);
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
function unDossierALaFois(travail) {
  // On chaîne sur la fin de la précédente, quoi qu'il lui soit arrivé : un
  // dossier en erreur ne doit pas bloquer la file derrière lui.
  const tour = fileComptoir.then(travail, travail);
  fileComptoir = tour.then(() => {}, () => {});
  return tour;
}

// POST /api/comptoir/projet → enregistre le dossier d'un des deux parcours.
app.post('/api/comptoir/projet', asyncH(async (req, res) => unDossierALaFois(async () => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};

  // NATURE : une vente directe est une commande validée et payée ; une demande
  // de devis reste à chiffrer. C'est cette différence qui commande tout le reste.
  const estDemande = b.source === 'Demande de devis';
  const famille = COMPTOIR_FAMILLE[b.stage] || (estDemande ? 'demande_chiffrage' : 'preparation');
  const sousEtape = SOUS_ETAPE_PAR_LIBELLE.get(`${famille}|${String(b.status || '').toLowerCase()}`) || null;

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
  let refFinale = ref;
  let refModifiee = null;
  if (ref) {
    const { rows: memeDossier } = await pool.query(
      "SELECT id, stage, sub_stage FROM requests WHERE fiche->>'empreinte' = $1 LIMIT 1", [empreinte],
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

  // La colonne « Infos » du planning : le récapitulatif tel qu'il est imprimé.
  const description = borner(b.recap, DESCRIPTION_MAX)
    || borner(b.comment, DESCRIPTION_MAX);

  const { rows: posRows } = await pool.query(
    'SELECT COALESCE(MAX(position), 0) + 1000 AS pos FROM requests WHERE stage = $1', [famille],
  );

  let rows;
  try {
    ({ rows } = await pool.query(
      `INSERT INTO requests
         (stage, sub_stage, order_kind, responsable, priority, client_type, billing_company,
          contact_referent, contact_phone, contact_email, quantity, product, description,
          deadline, position, fiche, project_value, paye, paiement_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING id`,
      [
        famille, sousEtape, estDemande ? 'demande' : 'commande', responsable, priorite,
        clientType, nomDossier,
        borner(cl.contact, 120), borner(cl.phone, 40), borner(cl.email, 160),
        quantite, borner(b.name, OBJET_MAX), description,
        deadline, posRows[0].pos, JSON.stringify(fiche), valeur,
        // Un paiement n'existe que sur une vente : une demande ne se prononce pas.
        estDemande ? null : !!pay.paye, estDemande ? null : mode,
      ],
    ));
  } catch (err) {
    // La base vient de refuser un dossier dont l'empreinte existe déjà : c'est
    // le MÊME dossier, arrivé deux fois. La file ci-dessus l'empêche déjà au
    // sein d'un serveur ; ce rattrapage vaut pour le jour où il y en aurait
    // deux. On rend la ligne d'origine — exactement ce que la vendeuse attend.
    if (!err || err.code !== '23505') throw err;
    const { rows: dejaLa } = await pool.query(
      "SELECT id, stage, sub_stage FROM requests WHERE fiche->>'empreinte' = $1 LIMIT 1", [empreinte],
    );
    if (!dejaLa.length) throw err;
    return res.json({
      id: dejaLa[0].id, stage: dejaLa[0].stage, subStage: dejaLa[0].sub_stage, dejaEnregistre: true,
    });
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
    // Renseigné UNIQUEMENT quand la référence du ticket était déjà prise par une
    // autre commande : l'écran doit le dire, le ticket remis au client ne porte
    // plus le bon numéro.
    ...(refModifiee ? { refModifiee } : {}),
  });
})));

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

// POST /api/vente/numero → réserve le numéro du ticket de vente directe,
// « 26.07.30-001 » : deux chiffres d'année, mois, jour, puis le rang de la vente
// DANS LA JOURNÉE. Le compteur vit en app_meta (même principe que les codes
// clients) : deux comptoirs qui encaissent en même temps ne peuvent pas remettre
// le même numéro au client, et un numéro attribué n'est jamais réutilisé.
// Le jour est celui du POSTE (`jour`, aaaa-mm-jj) : le conteneur tourne en UTC,
// il basculerait au lendemain dès 20 h à Saint-Martin.
app.post('/api/vente/numero', asyncH(async (req, res) => {
  const r = await reserverNumeroDuJour('vente', req.body || {});
  res.status(201).json(r);
}));

// POST /api/devis/numero → même compteur, même garantie, pour la DEMANDE DE
// DEVIS : « DEV-26.07.30-001 ». Deux séries distinctes et deux clés app_meta
// distinctes — une demande et une vente du même jour ne se disputent pas un
// rang, et le préfixe dit du premier coup d'œil ce qu'on a en main.
app.post('/api/devis/numero', asyncH(async (req, res) => {
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
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (NO_CACHE.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// L'ancienne adresse de la fiche reste valide (raccourcis déjà posés sur les
// écrans) : elle renvoie sur Nouveau Projet, la seule porte d'entrée.
app.get('/fiche', (req, res) => res.redirect(301, '/#nouveau-projet'));

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
init()
  .then(loadCommandeZones)
  .then(() => {
    // `__server` est exposé pour les tests (PORT=0 → port libre, adresse lue au
    // moment où le serveur écoute). En production rien ne le lit.
    app.__server = app.listen(PORT, () => {
      console.log(`Planning OLDA — en écoute sur le port ${app.__server.address().port}`);
      if (!APP_PASSWORD) console.log('⚠  APP_PASSWORD non défini : accès ouvert (mode dev).');
    });
  })
  .catch((err) => {
    console.error('Échec de l\'initialisation de la base :', err);
    process.exit(1);
  });

module.exports = app;
