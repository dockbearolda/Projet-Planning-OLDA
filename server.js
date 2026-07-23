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
const {
  pool, init, STAGES, STAGE_SLUGS, SUB_SLUGS, RESPONSABLES, CLIENT_TYPES, FLAGS, ORDER_KINDS,
  getCategoryOwners, setCategoryOwners,
  getCategoryReferents, setCategoryReferents,
  getMachines, setMachines,
  getCommandeZones, addCommandeZone, removeCommandeZone,
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
app.use(express.json());

// ---------------------------------------------------------------------------
// Basic Auth (mot de passe partagé). Si APP_PASSWORD est absent → accès ouvert.
// ---------------------------------------------------------------------------
const APP_PASSWORD = process.env.APP_PASSWORD;

function basicAuth(req, res, next) {
  if (!APP_PASSWORD) return next(); // dev local : accès ouvert

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const password = idx >= 0 ? decoded.slice(idx + 1) : decoded;
    // L'identifiant est ignoré, seul le mot de passe partagé compte.
    if (password === APP_PASSWORD) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Planning OLDA", charset="UTF-8"');
  return res.status(401).send('Authentification requise.');
}

app.use(basicAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PATCHABLE = [
  'stage', 'sub_stage', 'order_kind', 'responsable', 'referent', 'priority', 'client_type', 'billing_company',
  'contact_referent', 'contact_phone', 'contact_email',
  'quantity', 'product', 'color', 'project_value', 'description', 'deadline', 'position',
  'flag', 'flag_reason',
];

function validateField(key, value) {
  if (value === null || value === undefined) return { ok: true, value: null };
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
    case 'position': {
      const n = Number(value);
      if (Number.isNaN(n)) return { ok: false, error: 'position doit être numérique' };
      return { ok: true, value: n };
    }
    case 'deadline': {
      if (value === '') return { ok: true, value: null };
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
    default:
      return { ok: true, value };
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

function asyncH(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  });
}

// ---------------------------------------------------------------------------
// Flux temps réel (SSE) — push instantané façon Google Sheets.
// Le serveur garde une connexion ouverte par client et diffuse un événement
// « change » à chaque création / modification / suppression. Aucune dépendance.
// ---------------------------------------------------------------------------
const sseClients = new Set();

app.get('/api/stream', (req, res) => {
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
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 25000);

  req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
});

function broadcast(payload) {
  const frame = `event: change\ndata: ${JSON.stringify(payload || {})}\n\n`;
  for (const res of sseClients) {
    try { res.write(frame); } catch (_) { sseClients.delete(res); }
  }
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

// On expose seulement le nom de fichier des PDF (jamais les blobs) afin que la
// grille et le temps réel restent légers.
const SELECT = `SELECT r.*,
    ad.filename AS devis_name,
    ab.filename AS bat_name
  FROM requests r
  LEFT JOIN attachments ad ON ad.request_id = r.id AND ad.kind = 'devis'
  LEFT JOIN attachments ab ON ab.request_id = r.id AND ab.kind = 'bat'`;
const ORDER = 'ORDER BY r.position ASC NULLS LAST, r.priority DESC, r.deadline ASC NULLS LAST, r.created_at ASC';

// GET /api/requests?stage=<étape>   → commandes de cette étape
// GET /api/requests                 → toutes
app.get('/api/requests', asyncH(async (req, res) => {
  const { stage } = req.query;
  let result;
  if (stage) {
    if (!STAGE_SLUGS.includes(stage)) return res.status(400).json({ error: `stage invalide: ${stage}` });
    result = await pool.query(`${SELECT} WHERE r.stage = $1 ${ORDER}`, [stage]);
  } else {
    result = await pool.query(
      `${SELECT} ORDER BY r.stage, r.position ASC NULLS LAST, r.priority DESC, r.deadline ASC NULLS LAST, r.created_at ASC`,
    );
  }
  res.json(result.rows);
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
    const stage = body.stage && STAGE_SLUGS.includes(body.stage) ? body.stage : 'demande';
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

// PATCH /api/requests/:id → met à jour un ou plusieurs champs
app.patch('/api/requests/:id', asyncH(async (req, res) => {
  const body = normalizeFlagBody(req.body || {});
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
  broadcast({ kind: 'update', stages: [rows[0].stage] });
  res.json(rows[0]);
}));

// DELETE /api/requests/:id
app.delete('/api/requests/:id', asyncH(async (req, res) => {
  // Supprime d'abord les PDF + secteurs rattachés (cascade gérée côté applicatif
  // pour rester compatible avec pg-mem en local).
  await pool.query('DELETE FROM attachments WHERE request_id = $1', [req.params.id]);
  await pool.query('DELETE FROM production_sectors WHERE request_id = $1', [req.params.id]);
  const { rowCount } = await pool.query('DELETE FROM requests WHERE id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Commande introuvable' });
  broadcast({ kind: 'delete' });
  res.status(204).end();
}));

// ---------------------------------------------------------------------------
// Pièces jointes PDF (Devis / BAT) — 2 emplacements fixes par commande.
// Stockées en base (base64) ; servies inline pour consultation immédiate.
// ---------------------------------------------------------------------------
const PDF_KINDS = ['devis', 'bat'];

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
    if (!PDF_KINDS.includes(kind)) return res.status(400).json({ error: 'type invalide (devis|bat)' });
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: 'PDF vide' });

    const exists = await pool.query('SELECT 1 FROM requests WHERE id = $1', [id]);
    if (exists.rowCount === 0) return res.status(404).json({ error: 'Commande introuvable' });

    let filename = String(req.query.name || '').slice(0, 255).trim();
    if (!filename) filename = `${kind}.pdf`;
    const data = buf.toString('base64');

    // upsert manuel (compatible pg-mem) : delete + insert sur (request_id, kind).
    await pool.query('DELETE FROM attachments WHERE request_id = $1 AND kind = $2', [id, kind]);
    await pool.query(
      'INSERT INTO attachments (request_id, kind, filename, data, updated_at) VALUES ($1, $2, $3, $4, now())',
      [id, kind, filename, data],
    );
    const stage = await touchRequest(id);
    broadcast({ kind: 'update', stages: stage ? [stage] : [] });
    res.json({ kind, filename });
  }));

// GET /api/requests/:id/pdf/:kind  → ouvre le PDF inline (consultable à tout moment)
app.get('/api/requests/:id/pdf/:kind', asyncH(async (req, res) => {
  const { id, kind } = req.params;
  if (!PDF_KINDS.includes(kind)) return res.status(400).json({ error: 'type invalide (devis|bat)' });
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
  if (!PDF_KINDS.includes(kind)) return res.status(400).json({ error: 'type invalide (devis|bat)' });
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

// Date civile LOCALE à J+n. `toISOString()` bascule en UTC : à l'ouest de
// Greenwich (l'atelier est aux Antilles) il rend déjà la date du lendemain en
// soirée, et le délai « 7 jours » en vaudrait 8. Le front calcule pareil.
function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Base clients professionnelle (CRM) — table `clients` + `client_notes`.
// Rapatriée de l'ancienne app « Base clients » (Next.js) pour vivre DANS le
// planning : la prise de commande y puise ses suggestions (auto-complétion) et
// y crée automatiquement le client absent ; la fiche est éditable en place.
// ---------------------------------------------------------------------------

// Clé de rapprochement : insensible à la casse, aux accents et à la ponctuation,
// pour que « Iguana (Discover) » et « iguana discover » soient LE MÊME client.
const clientKey = (s) => String(s)
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const trimOrNull = (v) => {
  const s = String(v == null ? '' : v).trim();
  return s === '' ? null : s;
};

// Champs éditables d'un client et leur longueur bornée (ces textes vivent dans
// une carte / une cellule, pas dans un traitement de texte). `client_type` est
// une ÉNUMÉRATION (pro / perso), pas un texte libre : validé à part.
const CLIENT_MAX = {
  entreprise: 120, nom: 80, fonction: 80, type: 60, zone: 60,
  email: 160, telephone: 40, adresse: 200,
};
const CLIENT_FIELDS = [...Object.keys(CLIENT_MAX), 'client_type'];
// La base clients ne tranche qu'entre pro et perso ; les nuances asso/revendeur
// restent au niveau de la commande (requests.client_type).
const CLIENT_NATURE = new Set(['pro', 'perso']);
const NOTE_KINDS = new Set(['note', 'appel', 'email', 'rdv']);
const NOTE_MAX = 2000;

function validateClientField(key, value) {
  if (key === 'client_type') {
    const s = String(value == null ? '' : value).trim().toLowerCase();
    if (s !== '' && !CLIENT_NATURE.has(s)) return { ok: false, error: `nature invalide : ${value}` };
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
  const { rows } = await pool.query(
    `INSERT INTO clients (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *`, params,
  );
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
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
  sets.push('updated_at = now()');
  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE clients SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params,
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
  broadcast({ kind: 'client' });
  res.json(rows[0]);
}));

// DELETE /api/clients/:id → supprime le client et ses notes (cascade applicative).
app.delete('/api/clients/:id', asyncH(async (req, res) => {
  await pool.query('DELETE FROM client_notes WHERE client_id = $1', [req.params.id]);
  const { rowCount } = await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Client introuvable' });
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
async function upsertClientFromCommande(cl) {
  const entreprise = trimOrNull(cl && cl.societe);
  if (!entreprise) return;
  const key = clientKey(entreprise);
  const { rows } = await pool.query('SELECT entreprise FROM clients');
  if (rows.some((r) => clientKey(r.entreprise) === key)) return;
  // La nature pro/perso choisie au comptoir suit le client dans sa fiche ;
  // toute autre valeur (asso/revendeur d'une commande) retombe sur 'pro'.
  const nature = cl.type === 'perso' ? 'perso' : 'pro';
  await pool.query(
    'INSERT INTO clients (entreprise, nom, telephone, email, client_type) VALUES ($1,$2,$3,$4,$5)',
    [entreprise, trimOrNull(cl.contact), trimOrNull(cl.telephone), trimOrNull(cl.email), nature],
  );
  broadcast({ kind: 'client' });
}

// ---------------------------------------------------------------------------
// Prise de commande atelier — POST /api/commande
// La saisie du comptoir, EN FACE DU CLIENT : elle doit tenir en 30 à 45 secondes.
// On tranche DEMANDE ou COMMANDE dès le départ, puis :
//   - le CONTACT, en deux formes exclusives — PRO (nom de facturation, contact,
//     WhatsApp, email) ou PERSO (prénom, nom, WhatsApp) ;
//   - la DEMANDE : objet, description, délai choisi d'un tap (3 / 5 / 10 / 15 j) ;
//   - les PRODUITS, en trois familles indépendantes qu'on n'ouvre que si besoin :
//     TASSES (réf, coloris, face 1 anse à droite / face 2 anse à gauche, options,
//     typo), TEXTILE (réf, coloris, taille, placements + consignes) et
//     OBJETS (réf, TROTEC / UV / autre, info de personnalisation) ;
//   - le PAIEMENT : non payé / acompte / payé, et le mode (CB / espèces).
// Le catalogue (`catalog.commande`) est la source unique des listes ; le serveur
// revalide tout ce que le poste de saisie envoie.
// ---------------------------------------------------------------------------
const COM = CATALOG.commande;
const COM_TYPE_BY_ID = new Map(COM.types.map((t) => [t.id, t]));
const COM_ZONE_BY_ID = new Map(COM.zones.map((z) => [z.id, z]));
const COM_TECH_BY_ID = new Map(COM.techniques.map((t) => [t.id, t]));
const COM_DELAI_BY_ID = new Map(COM.delais.map((d) => [d.id, d]));
const COM_TASSE_OPT_BY_ID = new Map(COM.tasseOptions.map((o) => [o.id, o]));
const COM_OBJ_TECH_BY_ID = new Map(COM.objetTechniques.map((t) => [t.id, t]));
const COM_PAY_STATUT_BY_ID = new Map(COM.paiementStatuts.map((p) => [p.id, p]));
const COM_PAY_MODE_BY_ID = new Map(COM.paiementModes.map((p) => [p.id, p]));
const COM_FACE_BY_ID = new Map(COM.faces.map((f) => [f.id, f]));
// Délai retenu quand la fiche n'en porte aucun : la règle maison, jamais
// « sans échéance ».
const DELAI_DEFAUT = COM_DELAI_BY_ID.get(COM.delaiDefaut) || COM.delais[0];

// Longueurs bornées : ces textes finissent dans une cellule de grille, pas dans
// un traitement de texte.
const VETEMENT_MAX = 80;
const REF_MAX = 40;
const COULEUR_MAX = 40;
const REMARQUE_MAX = 400;
const OBJET_MAX = 140;          // objet de la demande (titre d'une ligne du planning)
const DESCRIPTION_MAX = 1200;   // description libre de la demande
const TEXTE_MAX = 200;          // face de tasse, typo, info de personnalisation…

// Emplacements d'impression ajoutés au comptoir (base), en plus de ceux du
// catalogue. Gardés en MÉMOIRE pour que la validation d'un article reste
// synchrone ; la base n'est relue qu'au démarrage et à chaque ajout / retrait.
let CUSTOM_ZONES = [];
// `custom: true` distingue les zones effaçables (ajoutées) de celles du
// catalogue, que la fiche ne propose pas de retirer.
const allZones = () => [...COM.zones, ...CUSTOM_ZONES.map((z) => ({ ...z, custom: true }))];
const zoneById = (id) => COM_ZONE_BY_ID.get(id) || CUSTOM_ZONES.find((z) => z.id === id) || null;
async function loadCommandeZones() {
  CUSTOM_ZONES = await getCommandeZones();
}

app.get('/api/commande/catalog', (req, res) => {
  res.json({ ...COM, zones: allZones(), employes: RESPONSABLES, clientTypes: CLIENT_TYPES });
});

// POST /api/commande/zones { label } → crée l'emplacement et renvoie la liste
// complète. Idempotent : deux fois « Nuque » ne fait qu'une zone.
app.post('/api/commande/zones', asyncH(async (req, res) => {
  const label = req.body && req.body.label;
  const added = await addCommandeZone(label, COM.zones);
  if (!added) return res.status(400).json({ error: 'libellé d\'emplacement vide' });
  CUSTOM_ZONES = added.zones;
  // On rend la zone telle qu'elle figure dans la liste servie — y compris quand
  // le libellé retombe sur une zone du CATALOGUE : le poste de saisie n'a pas à
  // connaître la nuance, il la coche et c'est tout.
  const zones = allZones();
  res.status(201).json({ zone: zones.find((z) => z.id === added.id) || null, zones });
}));

// DELETE /api/commande/zones/:id → retire un emplacement ajouté au comptoir.
// Les zones du catalogue ne s'effacent pas ; les commandes déjà enregistrées
// gardent leur marquage (le libellé y est recopié à l'enregistrement).
app.delete('/api/commande/zones/:id', asyncH(async (req, res) => {
  const id = String(req.params.id || '');
  if (COM_ZONE_BY_ID.has(id)) {
    return res.status(400).json({ error: 'emplacement du catalogue : non supprimable' });
  }
  CUSTOM_ZONES = await removeCommandeZone(id);
  res.json({ zones: allZones() });
}));

// Quantité d'une ligne : « Qté identique », le nombre de pièces rigoureusement
// semblables. Toujours au moins 1 — une ligne sans pièce n'existe pas.
function readQuantite(raw, where) {
  const quantite = Number.parseInt(raw, 10);
  if (!Number.isInteger(quantite) || quantite < 1 || quantite > 9999) {
    return { error: `${where} : quantité invalide (1 à 9999)` };
  }
  return { quantite };
}

// Un texte libre borné (face de tasse, typo, remarque…). Renvoie { value } ou
// { error } — jamais d'exception, l'appelant remonte le message tel quel.
function readTexte(raw, where, quoi, max) {
  const value = trimOrNull(raw);
  if (value && value.length > max) return { error: `${where} : ${quoi} trop long` };
  return { value };
}

// TEXTILE — le vêtement et ses placements (ex-« article »). Le catalogue ne fait
// que proposer : une taille de grille fournisseur exotique passe telle quelle.
function buildTextile(raw, index) {
  const where = `Textile ${index + 1}`;
  const a = raw && typeof raw === 'object' ? raw : {};

  const vetement = trimOrNull(a.vetement);
  if (!vetement) return { error: `${where} : le type de vêtement est vide` };
  if (vetement.length > VETEMENT_MAX) return { error: `${where} : type de vêtement trop long` };

  const q = readQuantite(a.quantite, where);
  if (q.error) return { error: q.error };

  const taille = trimOrNull(a.taille);
  if (taille && taille.length > 24) return { error: `${where} : taille trop longue` };

  const ref = trimOrNull(a.ref);
  if (ref && ref.length > REF_MAX) return { error: `${where} : référence trop longue` };
  const couleur = trimOrNull(a.couleur);
  if (couleur && couleur.length > COULEUR_MAX) return { error: `${where} : couleur trop longue` };

  const zones = [];
  const rawZones = Array.isArray(a.zones) ? a.zones : [];
  for (const rz of rawZones) {
    const zone = zoneById(rz && rz.zone);
    if (!zone) return { error: `${where} : zone d'impression inconnue` };
    if (zones.some((z) => z.zone === zone.id)) {
      return { error: `${where} : la zone « ${zone.label} » est posée deux fois` };
    }
    const consigne = trimOrNull(rz.consigne);
    if (consigne && consigne.length > COM.consigneMax) {
      return { error: `${where} — ${zone.label} : consigne trop longue (${COM.consigneMax} caractères maximum)` };
    }
    const tech = COM_TECH_BY_ID.get(rz.technique) || COM.techniques[0];
    zones.push({
      zone: zone.id,
      zoneLabel: zone.label,
      consigne,
      technique: tech.id,
      techniqueLabel: tech.label,
    });
  }

  return {
    ligne: {
      famille: 'textile',
      vetement, ref, couleur, taille: taille || null, quantite: q.quantite, zones,
    },
  };
}

// TASSE — la référence, le coloris, et SURTOUT les deux faces : l'atelier
// imprime face 1 anse à droite, face 2 anse à gauche. Sans cette convention le
// visuel se retrouve à l'envers pour un gaucher.
function buildTasse(raw, index) {
  const where = `Tasse ${index + 1}`;
  const a = raw && typeof raw === 'object' ? raw : {};

  const ref = trimOrNull(a.ref);
  if (!ref) return { error: `${where} : la référence de tasse est vide` };
  if (ref.length > REF_MAX) return { error: `${where} : référence trop longue` };

  const q = readQuantite(a.quantite, where);
  if (q.error) return { error: q.error };

  const couleur = trimOrNull(a.couleur);
  if (couleur && couleur.length > COULEUR_MAX) return { error: `${where} : coloris trop long` };

  const faces = [];
  for (const f of COM.faces) {
    const t = readTexte(a[f.id], where, `visuel de la ${f.label.toLowerCase()}`, TEXTE_MAX);
    if (t.error) return { error: t.error };
    if (t.value) faces.push({ face: f.id, label: f.label, hint: f.hint, visuel: t.value });
  }

  // Options cochées (logo OLDA, texte personnalisé, logo client) : rien
  // d'obligatoire, mais pas d'identifiant inventé non plus.
  const options = [];
  for (const id of Array.isArray(a.options) ? a.options : []) {
    const opt = COM_TASSE_OPT_BY_ID.get(id);
    if (!opt) return { error: `${where} : option inconnue` };
    if (!options.some((o) => o.id === opt.id)) options.push({ id: opt.id, label: opt.label });
  }

  const infos = readTexte(a.infos, where, 'information de personnalisation', TEXTE_MAX);
  if (infos.error) return { error: infos.error };
  const typo = readTexte(a.typo, where, 'typo', TEXTE_MAX);
  if (typo.error) return { error: typo.error };
  const remarque = readTexte(a.remarque, where, 'remarque', REMARQUE_MAX);
  if (remarque.error) return { error: remarque.error };

  return {
    ligne: {
      famille: 'tasse',
      ref, couleur, quantite: q.quantite, faces, options,
      infos: infos.value, typo: typo.value, remarque: remarque.value,
    },
  };
}

// OBJET — tout le reste (gourde, plaque, trophée…). Ce qui compte à l'atelier,
// c'est PAR QUELLE MACHINE ça passe : TROTEC, UV, ou autre chose à préciser.
function buildObjet(raw, index) {
  const where = `Objet ${index + 1}`;
  const a = raw && typeof raw === 'object' ? raw : {};

  const ref = trimOrNull(a.ref);
  if (!ref) return { error: `${where} : la référence d'objet est vide` };
  if (ref.length > REF_MAX) return { error: `${where} : référence trop longue` };

  const q = readQuantite(a.quantite, where);
  if (q.error) return { error: q.error };

  const tech = COM_OBJ_TECH_BY_ID.get(a.technique) || null;
  if (a.technique && !tech) return { error: `${where} : type de personnalisation inconnu` };

  const infos = readTexte(a.infos, where, 'information de personnalisation', TEXTE_MAX);
  if (infos.error) return { error: infos.error };

  return {
    ligne: {
      famille: 'objet',
      ref, quantite: q.quantite,
      technique: tech ? tech.id : null,
      techniqueLabel: tech ? tech.label : null,
      infos: infos.value,
    },
  };
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

// Nom lisible d'une ligne, quelle que soit sa famille — sert à la colonne
// « Description » du planning (« 20 × Tasse blanche 33 cl »).
const nomLigne = (l) => (l.famille === 'textile' ? l.vetement : l.ref);

// Le détail d'une ligne, en clair, pour la colonne « Infos » : ce que l'atelier
// doit lire sans jamais ouvrir le JSON ni rappeler le comptoir.
function detailLigne(l) {
  if (l.famille === 'textile') {
    const id = [l.ref && `réf. ${l.ref}`, l.couleur, l.taille && `taille ${l.taille}`]
      .filter(Boolean).join(' · ');
    const tete = `• ${l.quantite} × ${l.vetement}${id ? ` — ${id}` : ''}`;
    return [tete, ...l.zones.map((z) => {
      const tech = z.technique === 'a_definir' ? '' : ` [${z.techniqueLabel}]`;
      return `   ↳ ${z.zoneLabel}${tech}${z.consigne ? ` : ${z.consigne}` : ''}`;
    })].join('\n');
  }
  if (l.famille === 'tasse') {
    const tete = `• ${l.quantite} × ${l.ref}${l.couleur ? ` — ${l.couleur}` : ''}`;
    const suite = [
      ...l.faces.map((f) => `   ↳ ${f.label} (${f.hint}) : ${f.visuel}`),
      l.options.length ? `   ↳ ${l.options.map((o) => o.label).join(' · ')}` : null,
      l.typo ? `   ↳ Typo : ${l.typo}` : null,
      l.infos ? `   ↳ ${l.infos}` : null,
      l.remarque ? `   ↳ Remarque : ${l.remarque}` : null,
    ].filter(Boolean);
    return [tete, ...suite].join('\n');
  }
  const tete = `• ${l.quantite} × ${l.ref}`;
  const suite = [
    l.techniqueLabel ? `   ↳ ${l.techniqueLabel}${l.infos ? ` : ${l.infos}` : ''}` : (l.infos ? `   ↳ ${l.infos}` : null),
  ].filter(Boolean);
  return [tete, ...suite].join('\n');
}

// Reconstruit une prise de commande à partir du corps reçu. Fonction pure :
// aucune écriture, elle renvoie { commande, resume, produit } ou { error }.
function buildCommande(body) {
  const b = body && typeof body === 'object' ? body : {};

  const type = COM_TYPE_BY_ID.get(b.kind);
  if (!type) return { error: `nature inconnue : ${b.kind} (demande ou commande)` };

  const who = buildClient(b.client);
  if (who.error) return { error: who.error };
  const { client } = who;

  // La DEMANDE SIMPLE : de quoi enregistrer en dix secondes une affaire qu'on
  // détaillera plus tard (« Devis 40 polos brodés »), sans ouvrir une famille.
  const objet = trimOrNull(b.objet);
  if (objet && objet.length > OBJET_MAX) return { error: 'objet de la demande trop long' };
  const description = trimOrNull(b.description);
  if (description && description.length > DESCRIPTION_MAX) return { error: 'description trop longue' };

  // Trois familles, chacune facultative. `articles` (ancien nom) = le textile.
  const rawTextiles = Array.isArray(b.textiles) ? b.textiles
    : (Array.isArray(b.articles) ? b.articles : []);
  const sources = [
    ['tasses', Array.isArray(b.tasses) ? b.tasses : [], buildTasse],
    ['textiles', rawTextiles, buildTextile],
    ['objets', Array.isArray(b.objets) ? b.objets : [], buildObjet],
  ];
  const total = sources.reduce((s, [, raw]) => s + raw.length, 0);
  if (total === 0 && !objet) {
    return { error: 'ni objet ni produit : la commande est vide' };
  }
  if (total > COM.articlesMax) {
    return { error: `trop de lignes (${COM.articlesMax} maximum)` };
  }

  const produits = { tasses: [], textiles: [], objets: [] };
  for (const [cle, raw, build] of sources) {
    for (let i = 0; i < raw.length; i += 1) {
      const built = build(raw[i], i);
      if (built.error) return { error: built.error };
      produits[cle].push(built.ligne);
    }
  }
  const lignes = [...produits.tasses, ...produits.textiles, ...produits.objets];

  const paie = b.paiement && typeof b.paiement === 'object' ? b.paiement : {};
  const statut = COM_PAY_STATUT_BY_ID.get(paie.statut) || COM.paiementStatuts[0];
  // Le mode ne veut rien dire tant que rien n'est encaissé : on ne l'invente pas.
  const modeBrut = statut.id === 'non_paye' ? null : COM_PAY_MODE_BY_ID.get(paie.mode);
  const paiement = {
    statut: { id: statut.id, label: statut.label },
    mode: modeBrut ? { id: modeBrut.id, label: modeBrut.label } : null,
  };

  const remarque = trimOrNull(b.remarque);
  if (remarque && remarque.length > REMARQUE_MAX) return { error: 'remarque trop longue' };

  // Délai et date sont deux façons de dire la même chose. Le délai TAPÉ fait
  // foi (il porte sa majoration : « sous 3 jours, +10 % ») ; à défaut, une date
  // choisie à la main s'impose seule ; sans rien, la règle maison s'applique —
  // jamais « sans échéance ».
  const delaiChoisi = COM_DELAI_BY_ID.get(b.delai) || null;
  const dateChoisie = isDay(b.deadline) ? b.deadline : null;
  const delai = delaiChoisi || (dateChoisie ? null : DELAI_DEFAUT);
  const deadline = delaiChoisi
    ? (dateChoisie || todayPlus(delaiChoisi.jours))
    : (dateChoisie || todayPlus(DELAI_DEFAUT.jours));

  const priority = Math.min(3, Math.max(1, Number.parseInt(b.priority, 10) || 1));
  const quantite = lignes.reduce((s, l) => s + l.quantite, 0);

  const commande = {
    kind: 'commande-atelier',        // discriminant : identifie ce JSON dans requests.fiche
    version: 2,                      // v1 = { articles } sans objet ni paiement
    type: { id: type.id, label: type.label },
    client,
    objet,
    description,
    tasses: produits.tasses,
    textiles: produits.textiles,
    objets: produits.objets,
    articles: produits.textiles,     // alias historique : le textile s'appelait « articles »
    paiement,
    delai: delai
      ? { id: delai.id, label: delai.label, jours: delai.jours, majoration: delai.majoration || 0 }
      : null,                        // date choisie à la main : pas de délai type
    enBoite: b.enBoite === true,
    maquette: b.maquette === true,
    remarque,
    deadline,
    priority,
    vendeuse: RESPONSABLE_SET.has(b.vendeuse) ? b.vendeuse : 'À attribuer',
    referent: RESPONSABLE_SET.has(b.referent) && b.referent !== 'À attribuer' ? b.referent : null,
    stage: type.stage,
    subStage: type.subStage,
    quantite,
    createdAt: new Date().toISOString(),
  };

  // Colonne « Description » de la grille : de quoi reconnaître la commande d'un
  // coup d'œil, sans ouvrir le détail. Une demande sans produit affiche son objet.
  const noms = [...new Set(lignes.map(nomLigne))];
  let produit;
  if (lignes.length === 0) produit = objet;
  else if (lignes.length === 1) produit = `${lignes[0].quantite} × ${noms[0]}`;
  else produit = `${quantite} pièces — ${noms.slice(0, 3).join(', ')}${noms.length > 3 ? '…' : ''}`;

  // Colonne « Infos » : le détail lisible, pour que la grille n'ait jamais à
  // lire le JSON. Une famille vide ne laisse aucune trace.
  const bloc = (titre, ls) => (ls.length ? [titre, ...ls.map(detailLigne)] : []);

  const contact = [
    client.contact,
    client.whatsapp && `WhatsApp ${client.whatsapp}`,
    client.email,
  ].filter(Boolean).join(' · ');

  const etats = [
    `Article en boîte : ${commande.enBoite ? 'oui' : 'non'}`,
    commande.maquette ? 'Maquette à faire' : 'Maquette : non',
    `Paiement : ${paiement.statut.label.toLowerCase()}${paiement.mode ? ` (${paiement.mode.label})` : ''}`,
  ].join(' · ');

  const resume = [
    `${type.label.toUpperCase()} — ${client.societe}${client.type === 'perso' ? ' (perso)' : ''}`,
    ...(contact ? [`Contact : ${contact}`] : []),
    ...(objet ? [`Objet : ${objet}`] : []),
    ...(description ? [description] : []),
    ...bloc('Tasses', produits.tasses),
    ...bloc('Textile', produits.textiles),
    ...bloc('Objets', produits.objets),
    // La date a sa colonne : on n'écrit ici que le délai TYPE, pour sa
    // majoration (« sous 3 jours, +10 % ») que le chiffrage doit voir.
    ...(delai ? [`Délai : ${delai.label}${delai.majoration ? ` (+${delai.majoration} %)` : ''}`] : []),
    etats,
    ...(remarque ? [`Remarque : ${remarque}`] : []),
  ].join('\n');

  return { commande, resume, produit };
}

// POST /api/commande → crée la demande / commande dans le planning.
app.post('/api/commande', asyncH(async (req, res) => {
  const built = buildCommande(req.body || {});
  if (built.error) return res.status(400).json({ error: built.error });
  const { commande, resume, produit } = built;

  const { rows: posRows } = await pool.query(
    'SELECT COALESCE(MAX(position), 0) + 1000 AS pos FROM requests WHERE stage = $1', [commande.stage],
  );

  const { rows } = await pool.query(
    `INSERT INTO requests
       (stage, sub_stage, order_kind, priority, client_type, billing_company, contact_referent,
        contact_phone, contact_email, quantity, product, color, description, deadline,
        responsable, referent, position, fiche)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      commande.stage,
      commande.subStage,
      commande.type.id,
      commande.priority,
      commande.client.type,
      commande.client.societe,
      commande.client.contact,
      commande.client.telephone,
      commande.client.email,
      commande.quantite || null,      // demande simple : aucune pièce comptée
      produit,
      // Colonne « Coloris » : le premier renseigné, toutes familles confondues
      // (une demande simple, sans produit, la laisse vide).
      [...commande.tasses, ...commande.textiles].map((l) => l.couleur).find(Boolean) || null,
      resume,
      commande.deadline,
      commande.vendeuse,
      commande.referent,
      posRows[0].pos,
      JSON.stringify(commande),
    ],
  );

  // « Si c'est un nouveau client, on crée sa fiche » : la base clients se
  // remplit toute seule à la prise de commande, sans jamais dédoublonner un
  // client déjà connu.
  await upsertClientFromCommande(commande.client);

  broadcast({ kind: 'create', stages: [commande.stage] });
  res.status(201).json({ id: rows[0].id, commande });
}));

// ---------------------------------------------------------------------------
// Statique + SPA
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
// L'ancienne adresse de la fiche reste valide (raccourcis déjà posés sur les
// écrans) : elle renvoie sur la prise de commande de l'application.
app.get('/fiche', (req, res) => res.redirect(301, '/#commande'));

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
