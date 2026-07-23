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
// Fiche « Commande Express » — /fiche
// Le catalogue (produits, options, délais, typos, logos, placements, encres)
// est la source unique des prix : le front l'affiche, le serveur s'en ressert
// pour RECALCULER le total. Le montant envoyé par le poste de vente n'est
// jamais cru sur parole.
// ---------------------------------------------------------------------------
const CATALOG = require('./catalog.json');
const OPTION_BY_ID = new Map(CATALOG.options.map((o) => [o.id, o]));
const DELAI_BY_ID = new Map(CATALOG.delais.map((d) => [d.id, d]));
const PRODUCT_BY_SKU = new Map(CATALOG.products.map((p) => [p.sku, p]));
const FACE_BY_ID = new Map(CATALOG.faces.map((f) => [f.id, f]));
const PLACEMENT_BY_ID = new Map(CATALOG.placements.map((p) => [p.id, p]));
const TAILLE_BY_ID = new Map(CATALOG.tailles.map((t) => [t.id, t]));
const ENCRE_BY_ID = new Map(CATALOG.encres.map((e) => [e.id, e]));
const MODE_BY_ID = new Map(CATALOG.paiementModes.map((p) => [p.id, p]));
const STATUT_BY_ID = new Map(CATALOG.paiementStatuts.map((p) => [p.id, p]));
const LOGO_BY_REF = new Map(CATALOG.logosOlda.map((l) => [l.ref, l]));

app.get('/api/fiche/catalog', (req, res) => {
  res.json({ ...CATALOG, vendeuses: RESPONSABLES, stages: STAGES });
});

// Arrondi monétaire : évite les 30.800000000000004 en base et sur le reçu.
const euro = (n) => Math.round(n * 100) / 100;

const DAY = 86400000;
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
// Nombre de jours pleins entre aujourd'hui et une date civile, sans heure ni
// fuseau : les deux bornes sont ramenées à minuit UTC avant la soustraction.
function daysUntil(day) {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = day.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - today) / DAY);
}

// Majoration effective. Les délais nommés portent leur taux ; « Date précise »
// n'en a pas (rate: null) et le déduit de la date choisie, avec les mêmes
// seuils. Sans cette dérivation, choisir « Date précise = demain » offrirait
// l'express au tarif standard.
function rateFor(delai, deadline) {
  if (delai.rate !== null && delai.rate !== undefined) return delai.rate;
  const d = daysUntil(deadline);
  if (d <= 0) return 0.2;
  if (d < 3) return 0.1;
  return 0;
}

// Valide un élément de personnalisation (un visuel posé sur une face).
// Renvoie { element } ou { error }.
function buildElement(raw, index) {
  const where = `Élément ${index + 1}`;
  const face = FACE_BY_ID.get(raw && raw.face);
  if (!face) return { error: `${where} : emplacement inconnu` };

  // Le logo OLDA vaut 6 € sur un flanc et 2 € sous la tasse : c'est la FACE qui
  // désigne le tarif. On normalise TOUTE variante de logo OLDA (y compris un
  // `logo_olda_dessous` envoyé sur un flanc) vers l'option de la face — sinon
  // le poste de vente pourrait réclamer le tarif du dessous n'importe où.
  const asked = String((raw && raw.option) || 'aucune');
  const wanted = asked.startsWith('logo_olda') ? face.logoOption : asked;
  const opt = OPTION_BY_ID.get(wanted || 'aucune');
  if (!opt) return { error: `${where} : visuel inconnu` };
  if (opt.id === 'aucune') return { element: null };

  const placement = PLACEMENT_BY_ID.get(raw.placement) || CATALOG.placements[1];
  const taille = TAILLE_BY_ID.get(raw.taille) || CATALOG.tailles[1];

  const element = {
    face: face.id,
    faceLabel: `${face.label} — ${face.hint}`,
    option: opt.id,
    optionLabel: opt.label,
    price: opt.price,
    placement: placement.id,
    placementLabel: placement.label,
    taille: taille.id,
    tailleLabel: taille.label,
    remarque: String(raw.remarque || '').trim() || null,
  };

  if (opt.needs === 'texte') {
    element.texte = String(raw.texte || '').trim();
    if (!element.texte) return { error: `${where} : le texte est vide` };
    if (element.texte.length > CATALOG.texteMax) {
      return { error: `${where} : texte trop long (${CATALOG.texteMax} caractères maximum)` };
    }
    const typo = CATALOG.typos.find((t) => t.id === raw.typo);
    if (!typo) return { error: `${where} : police manquante` };
    element.typo = typo.id;
    element.typoLabel = typo.label;
    const encre = ENCRE_BY_ID.get(raw.encre) || CATALOG.encres[0];
    element.encre = encre.id;
    element.encreLabel = encre.label;
    element.encreHex = encre.hex;
  } else if (opt.needs === 'logo_olda') {
    const logo = LOGO_BY_REF.get(raw.logo);
    if (!logo) return { error: `${where} : référence du visuel OLDA manquante` };
    element.logo = logo.ref;
    element.logoLabel = logo.label;
  } else if (opt.needs === 'logo_client') {
    element.logo = String(raw.logo || '').trim();
    if (!element.logo) return { error: `${where} : nom du fichier client manquant` };
  }

  return { element };
}

// Reconstruit le détail d'une fiche à partir du corps reçu : valide chaque
// référence contre le catalogue et renvoie { fiche, resume } ou une erreur
// explicite. Aucune écriture ici — la fonction est pure.
function buildFiche(body) {
  const product = PRODUCT_BY_SKU.get(body.product);
  if (!product) return { error: `produit inconnu : ${body.product}` };

  const delai = DELAI_BY_ID.get(body.delai);
  if (!delai) return { error: `délai inconnu : ${body.delai}` };

  const mode = MODE_BY_ID.get(body.paiementMode);
  if (!mode) return { error: `mode de paiement inconnu : ${body.paiementMode}` };

  const statut = STATUT_BY_ID.get(body.paiementStatut);
  if (!statut) return { error: `statut de paiement inconnu : ${body.paiementStatut}` };

  const quantity = Number.parseInt(body.quantity, 10);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    return { error: 'quantité invalide (1 à 999)' };
  }

  const prenom = String(body.prenom || '').trim();
  const nom = String(body.nom || '').trim();
  if (!prenom && !nom) return { error: 'nom du client requis' };

  const color = CATALOG.colors.includes(body.color) ? body.color : CATALOG.colors[0];

  const elements = [];
  const raws = Array.isArray(body.elements) ? body.elements : [];
  for (let i = 0; i < raws.length; i += 1) {
    const built = buildElement(raws[i], i);
    if (built.error) return { error: built.error };
    if (built.element) elements.push(built.element);
  }
  if (elements.length === 0) return { error: 'aucune personnalisation : la fiche est vide' };

  // Échéance : la date posée fait foi ; à défaut on applique les jours du délai.
  const deadline = isDay(body.deadline) ? body.deadline : todayPlus(delai.days);
  const heure = /^\d{2}:\d{2}$/.test(body.heure) ? body.heure : null;

  const rate = rateFor(delai, deadline);
  const unitaire = euro(product.price + elements.reduce((s, e) => s + e.price, 0));
  const personnalisation = euro(elements.reduce((s, e) => s + e.price, 0) * quantity);
  const sousTotal = euro(unitaire * quantity);
  const supplement = euro(sousTotal * rate);
  const total = euro(sousTotal + supplement);

  const stage = STAGE_SLUGS.includes(body.stage) ? body.stage : 'demande';

  const fiche = {
    client: { prenom, nom, whatsapp: String(body.whatsapp || '').trim() || null },
    vendeuse: RESPONSABLE_SET.has(body.vendeuse) ? body.vendeuse : 'À attribuer',
    referent: RESPONSABLE_SET.has(body.referent) ? body.referent : null,
    product: { sku: product.sku, label: product.label, price: product.price },
    color,
    quantity,
    elements,
    delai: { id: delai.id, label: delai.label, hint: delai.hint, rate },
    paiement: { mode: mode.id, modeLabel: mode.label, statut: statut.id, statutLabel: statut.label },
    prix: { unitaire, produit: euro(product.price * quantity), personnalisation, sousTotal, supplement, total },
    deadline,
    heure,
    stage,
    createdAt: new Date().toISOString(),
  };

  const lignes = elements.map((e) => {
    const quoi = e.texte ? `« ${e.texte} » (${e.typoLabel}, ${e.encreLabel})` : e.logo;
    return `• ${e.faceLabel} — ${e.optionLabel} : ${quoi} · ${e.placementLabel.toLowerCase()}, ${e.tailleLabel.toLowerCase()}${e.remarque ? ` — ${e.remarque}` : ''}`;
  });
  const resume = [
    `${quantity} × ${product.label} — ${color}`,
    ...lignes,
    `Délai ${delai.label}${heure ? ` — à retirer à ${heure}` : ''} · ${mode.label} (${statut.label})`,
    `Total ${total.toFixed(2)} €${supplement ? ` (dont ${supplement.toFixed(2)} € de majoration)` : ''}`,
  ].join('\n');

  return { fiche, resume };
}

// POST /api/fiche → crée la demande dans le planning.
app.post('/api/fiche', asyncH(async (req, res) => {
  const built = buildFiche(req.body || {});
  if (built.error) return res.status(400).json({ error: built.error });
  const { fiche, resume } = built;

  const clientName = [fiche.client.prenom, fiche.client.nom].filter(Boolean).join(' ');
  const { rows: posRows } = await pool.query(
    'SELECT COALESCE(MAX(position), 0) + 1000 AS pos FROM requests WHERE stage = $1', [fiche.stage],
  );

  const { rows } = await pool.query(
    `INSERT INTO requests
       (stage, priority, client_type, billing_company, contact_referent, contact_phone,
        quantity, product, color, project_value, description, deadline, responsable,
        referent, position, fiche)
     VALUES ($1, $2, 'perso', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      fiche.stage,
      Math.min(3, Math.max(1, Number.parseInt(req.body.priority, 10) || 1)),
      clientName,
      clientName,
      fiche.client.whatsapp,
      fiche.quantity,
      fiche.product.label,
      fiche.color,
      fiche.prix.total,
      resume,
      fiche.deadline,
      fiche.vendeuse,
      fiche.referent,
      posRows[0].pos,
      JSON.stringify(fiche),
    ],
  );

  broadcast({ kind: 'create', stages: [fiche.stage] });
  res.status(201).json({ id: rows[0].id, fiche });
}));

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
// une carte / une cellule, pas dans un traitement de texte).
const CLIENT_MAX = {
  entreprise: 120, nom: 80, fonction: 80, type: 60, zone: 60,
  email: 160, telephone: 40, adresse: 200,
};
const CLIENT_FIELDS = Object.keys(CLIENT_MAX);
const NOTE_KINDS = new Set(['note', 'appel', 'email', 'rdv']);
const NOTE_MAX = 2000;

function validateClientField(key, value) {
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
  await pool.query(
    'INSERT INTO clients (entreprise, nom, telephone, email) VALUES ($1,$2,$3,$4)',
    [entreprise, trimOrNull(cl.contact), trimOrNull(cl.telephone), trimOrNull(cl.email)],
  );
  broadcast({ kind: 'client' });
}

// ---------------------------------------------------------------------------
// Prise de commande atelier — POST /api/commande
// La saisie de Mélina : on tranche DEMANDE ou COMMANDE dès le départ, on liste
// les articles (vêtement, référence, couleur, taille) et, pour chacun, les zones
// d'impression avec leur consigne (« Cœur : Les Doudous à SXM »).
// Le catalogue (`catalog.commande`) est la source unique des listes ; le serveur
// revalide tout ce que le poste de saisie envoie.
// ---------------------------------------------------------------------------
const COM = CATALOG.commande;
const COM_TYPE_BY_ID = new Map(COM.types.map((t) => [t.id, t]));
const COM_ZONE_BY_ID = new Map(COM.zones.map((z) => [z.id, z]));
const COM_TECH_BY_ID = new Map(COM.techniques.map((t) => [t.id, t]));
const COM_FACTURE_BY_ID = new Map(COM.factureEtats.map((f) => [f.id, f]));

// Longueurs bornées : ces textes finissent dans une cellule de grille, pas dans
// un traitement de texte.
const VETEMENT_MAX = 80;
const REF_MAX = 40;
const COULEUR_MAX = 40;
const REMARQUE_MAX = 400;

app.get('/api/commande/catalog', (req, res) => {
  res.json({ ...COM, employes: RESPONSABLES, clientTypes: CLIENT_TYPES });
});

// Valide un article et ses zones d'impression. Renvoie { article } ou { error }.
function buildArticle(raw, index) {
  const where = `Article ${index + 1}`;
  const a = raw && typeof raw === 'object' ? raw : {};

  const vetement = trimOrNull(a.vetement);
  if (!vetement) return { error: `${where} : le type de vêtement est vide` };
  if (vetement.length > VETEMENT_MAX) return { error: `${where} : type de vêtement trop long` };

  const quantite = Number.parseInt(a.quantite, 10);
  if (!Number.isInteger(quantite) || quantite < 1 || quantite > 9999) {
    return { error: `${where} : quantité invalide (1 à 9999)` };
  }

  // La taille peut ne pas être au catalogue (grille fournisseur exotique) : on
  // l'accepte telle quelle plutôt que de bloquer la prise de commande.
  const taille = trimOrNull(a.taille);
  if (taille && taille.length > 24) return { error: `${where} : taille trop longue` };

  const ref = trimOrNull(a.ref);
  if (ref && ref.length > REF_MAX) return { error: `${where} : référence trop longue` };
  const couleur = trimOrNull(a.couleur);
  if (couleur && couleur.length > COULEUR_MAX) return { error: `${where} : couleur trop longue` };

  const zones = [];
  const rawZones = Array.isArray(a.zones) ? a.zones : [];
  for (const rz of rawZones) {
    const zone = COM_ZONE_BY_ID.get(rz && rz.zone);
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
    article: {
      vetement, ref, couleur, taille: taille || null, quantite, zones,
    },
  };
}

// Reconstruit une prise de commande à partir du corps reçu. Fonction pure :
// aucune écriture, elle renvoie { commande, resume, produit } ou { error }.
function buildCommande(body) {
  const b = body && typeof body === 'object' ? body : {};

  const type = COM_TYPE_BY_ID.get(b.kind);
  if (!type) return { error: `nature inconnue : ${b.kind} (demande ou commande)` };

  const rawClient = b.client && typeof b.client === 'object' ? b.client : {};
  const societe = trimOrNull(rawClient.societe);
  if (!societe) return { error: 'le nom du client (société / marque) est requis' };
  if (societe.length > 120) return { error: 'nom du client trop long' };

  const email = trimOrNull(rawClient.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'email invalide' };

  const client = {
    societe,
    contact: trimOrNull(rawClient.contact),
    telephone: trimOrNull(rawClient.telephone),
    email,
    type: CLIENT_TYPE_SET.has(rawClient.type) ? rawClient.type : 'pro',
  };

  const rawArticles = Array.isArray(b.articles) ? b.articles : [];
  if (rawArticles.length === 0) return { error: 'aucun article : la commande est vide' };
  if (rawArticles.length > COM.articlesMax) {
    return { error: `trop d'articles (${COM.articlesMax} maximum)` };
  }
  const articles = [];
  for (let i = 0; i < rawArticles.length; i += 1) {
    const built = buildArticle(rawArticles[i], i);
    if (built.error) return { error: built.error };
    articles.push(built.article);
  }

  const facture = COM_FACTURE_BY_ID.get(b.facture) || COM_FACTURE_BY_ID.get('a_faire');

  const remarque = trimOrNull(b.remarque);
  if (remarque && remarque.length > REMARQUE_MAX) return { error: 'remarque trop longue' };

  // Délai : la date posée fait foi. Sans date, la règle maison s'applique —
  // 7 jours (catalog.commande.delaiDefautJours), jamais « sans échéance ».
  const deadline = isDay(b.deadline) ? b.deadline : todayPlus(COM.delaiDefautJours);

  const priority = Math.min(3, Math.max(1, Number.parseInt(b.priority, 10) || 1));
  const quantite = articles.reduce((s, a) => s + a.quantite, 0);

  const commande = {
    kind: 'commande-atelier',        // discriminant : distingue ce JSON d'une fiche Express
    type: { id: type.id, label: type.label },
    client,
    articles,
    enBoite: b.enBoite === true,
    maquette: b.maquette === true,
    facture: { id: facture.id, label: facture.label },
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
  // coup d'œil, sans ouvrir le détail.
  const noms = [...new Set(articles.map((a) => a.vetement))];
  const produit = articles.length === 1
    ? `${articles[0].quantite} × ${articles[0].vetement}`
    : `${quantite} pièces — ${noms.slice(0, 3).join(', ')}${noms.length > 3 ? '…' : ''}`;

  // Colonne « Infos » : le détail lisible, pour que la grille n'ait jamais à
  // lire le JSON.
  const lignes = articles.map((a) => {
    const id = [a.ref && `réf. ${a.ref}`, a.couleur, a.taille && `taille ${a.taille}`]
      .filter(Boolean).join(' · ');
    const tete = `• ${a.quantite} × ${a.vetement}${id ? ` — ${id}` : ''}`;
    const zs = a.zones.map((z) => {
      const tech = z.technique === 'a_definir' ? '' : ` [${z.techniqueLabel}]`;
      return `   ↳ ${z.zoneLabel}${tech}${z.consigne ? ` : ${z.consigne}` : ''}`;
    });
    return [tete, ...zs].join('\n');
  });

  const etats = [
    `Article en boîte : ${commande.enBoite ? 'oui' : 'non'}`,
    commande.maquette ? 'Maquette à faire' : 'Maquette : non',
    `Facture : ${facture.label.toLowerCase()}`,
  ].join(' · ');

  const resume = [
    `${type.label.toUpperCase()} — ${societe}${client.contact ? ` (${client.contact})` : ''}`,
    ...lignes,
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
      commande.quantite,
      produit,
      commande.articles[0].couleur,
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
// écrans) : elle renvoie sur la vue Express de l'application.
app.get('/fiche', (req, res) => res.redirect(301, '/#express'));

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
init()
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
