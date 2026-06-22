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
const { pool, init, STAGES, STAGE_SLUGS, SECTOR_SLUGS } = require('./db');

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
  'stage', 'priority', 'client_type', 'billing_company', 'contact_referent',
  'contact_phone', 'contact_email',
  'quantity', 'product', 'color', 'project_value', 'description', 'deadline', 'status', 'position',
];

function validateField(key, value) {
  if (value === null || value === undefined) return { ok: true, value: null };
  switch (key) {
    case 'stage':
      if (!STAGE_SLUGS.includes(value)) return { ok: false, error: `stage invalide: ${value}` };
      return { ok: true, value };
    case 'priority': {
      const n = Number(value);
      if (![1, 2, 3].includes(n)) return { ok: false, error: 'priority doit être 1, 2 ou 3' };
      return { ok: true, value: n };
    }
    case 'client_type':
      if (!['pro', 'perso'].includes(value)) return { ok: false, error: "client_type doit être 'pro' ou 'perso'" };
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

// On expose seulement le nom de fichier des PDF (jamais les blobs) afin que la
// grille et le temps réel restent légers.
const SELECT = `SELECT r.*,
    ad.filename AS devis_name,
    ab.filename AS bat_name
  FROM requests r
  LEFT JOIN attachments ad ON ad.request_id = r.id AND ad.kind = 'devis'
  LEFT JOIN attachments ab ON ab.request_id = r.id AND ab.kind = 'bat'`;
const ORDER = 'ORDER BY r.position ASC NULLS LAST, r.priority DESC, r.deadline ASC NULLS LAST, r.created_at ASC';

// Attache à chaque commande la liste de ses secteurs de production [{sector, done}].
async function attachSectors(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const ph = ids.map((_, i) => `$${i + 1}`).join(', ');
  const { rows: secs } = await pool.query(
    `SELECT request_id, sector, done FROM production_sectors
     WHERE request_id IN (${ph}) ORDER BY created_at ASC`, ids,
  );
  const by = {};
  for (const s of secs) (by[s.request_id] = by[s.request_id] || []).push({ sector: s.sector, done: s.done });
  for (const r of rows) r.sectors = by[r.id] || [];
  return rows;
}

// GET /api/requests?stage=<phase>   → commandes de cette phase
// GET /api/requests?sector=<machine>→ commandes en prod rattachées à ce secteur
//   (compat : ?stage=<machine> est aussi accepté côté sidebar)
// GET /api/requests                 → toutes
app.get('/api/requests', asyncH(async (req, res) => {
  const { stage, sector } = req.query;
  let result;
  if (sector || (stage && SECTOR_SLUGS.includes(stage))) {
    const sec = sector || stage;
    if (!SECTOR_SLUGS.includes(sec)) return res.status(400).json({ error: `secteur invalide: ${sec}` });
    // La commande reste dans la colonne de la machine même une fois ce secteur
    // coché « fait » ; elle ne la quitte qu'en étant déplacée vers une autre phase.
    result = await pool.query(
      `${SELECT}
       JOIN production_sectors ps ON ps.request_id = r.id AND ps.sector = $1
       WHERE r.stage = 'production' ${ORDER}`, [sec],
    );
  } else if (stage) {
    if (!STAGE_SLUGS.includes(stage)) return res.status(400).json({ error: `stage invalide: ${stage}` });
    result = await pool.query(`${SELECT} WHERE r.stage = $1 ${ORDER}`, [stage]);
  } else {
    result = await pool.query(
      `${SELECT} ORDER BY r.stage, r.position ASC NULLS LAST, r.priority DESC, r.deadline ASC NULLS LAST, r.created_at ASC`,
    );
  }
  await attachSectors(result.rows);
  res.json(result.rows);
}));

// GET /api/counts → { slug: n, ... } : phases + secteurs. Objet plat → la
// sidebar lit counts[slug] sans rien changer.
app.get('/api/counts', asyncH(async (req, res) => {
  const counts = {};
  for (const s of STAGE_SLUGS) counts[s] = 0;
  for (const s of SECTOR_SLUGS) counts[s] = 0;

  const { rows: byStage } = await pool.query('SELECT stage, COUNT(*)::int AS n FROM requests GROUP BY stage');
  for (const r of byStage) if (r.stage in counts) counts[r.stage] = r.n;

  // Secteurs : toutes les commandes en production rattachées à ce secteur
  // (le badge reflète les cartes affichées dans la colonne, cochées comprises).
  const { rows: bySector } = await pool.query(
    `SELECT ps.sector, COUNT(*)::int AS n
     FROM production_sectors ps JOIN requests r ON r.id = ps.request_id
     WHERE r.stage = 'production'
     GROUP BY ps.sector`,
  );
  for (const r of bySector) if (r.sector in counts) counts[r.sector] = r.n;

  res.json(counts);
}));

// POST /api/requests → crée (corps partiel autorisé)
app.post('/api/requests', asyncH(async (req, res) => {
  const body = req.body || {};
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
  const body = req.body || {};
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
// Secteurs de production d'une commande (relation 1 commande ↔ N machines).
// Ajouter un secteur fait entrer la commande en production ; cocher « done »
// marque ce secteur comme fait, mais la commande reste dans la colonne de la
// machine jusqu'à ce qu'on la déplace manuellement vers Facturation.
// ---------------------------------------------------------------------------

// POST /api/requests/:id/sectors  body { sector } → ajoute (ou réactive) un secteur
app.post('/api/requests/:id/sectors', asyncH(async (req, res) => {
  const { id } = req.params;
  const sector = (req.body || {}).sector;
  if (!SECTOR_SLUGS.includes(sector)) return res.status(400).json({ error: `secteur invalide: ${sector}` });

  const exists = await pool.query('SELECT stage FROM requests WHERE id = $1', [id]);
  if (exists.rowCount === 0) return res.status(404).json({ error: 'Commande introuvable' });

  // Affecter un secteur fait basculer la commande en phase 'production'.
  if (exists.rows[0].stage !== 'production') {
    await pool.query("UPDATE requests SET stage = 'production', updated_at = now() WHERE id = $1", [id]);
  }

  const has = await pool.query(
    'SELECT 1 FROM production_sectors WHERE request_id = $1 AND sector = $2', [id, sector],
  );
  if (has.rowCount === 0) {
    await pool.query(
      'INSERT INTO production_sectors (request_id, sector, done) VALUES ($1, $2, false)', [id, sector],
    );
  }
  await touchRequest(id);
  broadcast({ kind: 'update', stages: ['production'] });
  res.status(201).json({ sector, done: false });
}));

// PATCH /api/requests/:id/sectors/:sector  body { done } → coche / décoche
app.patch('/api/requests/:id/sectors/:sector', asyncH(async (req, res) => {
  const { id, sector } = req.params;
  if (!SECTOR_SLUGS.includes(sector)) return res.status(400).json({ error: `secteur invalide: ${sector}` });
  const done = !!(req.body || {}).done;
  const { rowCount } = await pool.query(
    'UPDATE production_sectors SET done = $1 WHERE request_id = $2 AND sector = $3', [done, id, sector],
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Secteur introuvable sur cette commande' });
  await touchRequest(id);
  broadcast({ kind: 'update', stages: ['production'] });
  res.json({ sector, done });
}));

// DELETE /api/requests/:id/sectors/:sector → retire le secteur de la commande
app.delete('/api/requests/:id/sectors/:sector', asyncH(async (req, res) => {
  const { id, sector } = req.params;
  if (!SECTOR_SLUGS.includes(sector)) return res.status(400).json({ error: `secteur invalide: ${sector}` });
  const { rowCount } = await pool.query(
    'DELETE FROM production_sectors WHERE request_id = $1 AND sector = $2', [id, sector],
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Secteur introuvable sur cette commande' });
  await touchRequest(id);
  broadcast({ kind: 'update', stages: ['production'] });
  res.status(204).end();
}));

// ---------------------------------------------------------------------------
// États de commande — liste éditable (créer / supprimer depuis le menu d'état).
// requests.status garde le LIBELLÉ ; la couleur est rattachée ici par libellé.
// ---------------------------------------------------------------------------

// GET /api/statuses → liste ordonnée
app.get('/api/statuses', asyncH(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, label, color FROM statuses ORDER BY position ASC NULLS LAST, created_at ASC',
  );
  res.json(rows);
}));

// POST /api/statuses  body { label, color } → crée un état
app.post('/api/statuses', asyncH(async (req, res) => {
  const body = req.body || {};
  const label = String(body.label == null ? '' : body.label).trim();
  const color = String(body.color == null ? '' : body.color).trim();
  if (!label) return res.status(400).json({ error: 'Libellé requis' });
  if (label.length > 40) return res.status(400).json({ error: 'Libellé trop long' });
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ error: 'Couleur invalide' });

  const dup = await pool.query('SELECT 1 FROM statuses WHERE lower(label) = lower($1)', [label]);
  if (dup.rowCount) return res.status(409).json({ error: 'Cet état existe déjà' });

  const { rows: p } = await pool.query('SELECT COALESCE(MAX(position), 0) + 1000 AS pos FROM statuses');
  const { rows } = await pool.query(
    'INSERT INTO statuses (label, color, position) VALUES ($1, $2, $3) RETURNING id, label, color',
    [label, color, p[0].pos],
  );
  broadcast({ kind: 'statuses' });
  res.status(201).json(rows[0]);
}));

// DELETE /api/statuses/:id → retire un état de la liste (les commandes gardent
// leur texte, sans couleur). Recréer le même libellé restitue la couleur.
app.delete('/api/statuses/:id', asyncH(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM statuses WHERE id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'État introuvable' });
  broadcast({ kind: 'statuses' });
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
// Dictée vocale → extraction structurée via l'API Claude.
// Le navigateur transcrit la voix (Web Speech API) et envoie le TEXTE ici ;
// Claude le transforme en champs de commande (JSON garanti par json_schema).
// ---------------------------------------------------------------------------
let anthropicClient = null;
function getAnthropic() {
  if (!anthropicClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ timeout: 30000, maxRetries: 1 }); // lit ANTHROPIC_API_KEY
  }
  return anthropicClient;
}

// Schéma de sortie : tous les champs nullables — on n'invente jamais une valeur.
const VOICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    billing_company: { type: ['string', 'null'], description: 'Société / organisation à facturer, ou nom du client particulier' },
    contact_referent: { type: ['string', 'null'], description: 'Prénom / nom de la personne référente' },
    contact_phone: { type: ['string', 'null'], description: 'Téléphone, normalisé « 06 12 34 56 78 »' },
    contact_email: { type: ['string', 'null'], description: 'Adresse email si dictée' },
    product: { type: ['string', 'null'], description: 'Produit commandé (sans la couleur ni la quantité)' },
    color: { type: ['string', 'null'], description: 'Couleur(s) du produit, ex. « Noir », « Blanc et rouge »' },
    quantity: { type: ['integer', 'null'], description: 'Quantité commandée' },
    project_value: { type: ['number', 'null'], description: 'Prix / valeur en euros, uniquement si dicté' },
    deadline: { type: ['string', 'null'], description: 'Échéance au format AAAA-MM-JJ' },
    description: { type: ['string', 'null'], description: 'Détails utiles : emplacement du marquage, technique, précisions' },
    client_type: { enum: ['pro', 'perso', null], description: '« pro » si entreprise/association/collectivité, « perso » si particulier' },
  },
  required: ['billing_company', 'contact_referent', 'contact_phone', 'contact_email',
    'product', 'color', 'quantity', 'project_value', 'deadline', 'description', 'client_type'],
};

function voiceSystemPrompt() {
  const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }); // AAAA-MM-JJ
  const weekday = new Date().toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
  return `Tu extrais les informations d'une commande dictée à voix haute dans un atelier français d'impression textile et de personnalisation (DTF, sérigraphie, broderie, gravure, objets).
Nous sommes le ${weekday} ${today}.

Règles strictes :
- N'extrais QUE ce qui est réellement dicté : un champ non mentionné vaut null. N'invente jamais.
- Téléphone : normalise au format « 06 12 34 56 78 » (la dictée donne souvent « zéro six douze… » ou des chiffres collés).
- Échéance : convertis les dates relatives (« vendredi », « dans 15 jours », « fin du mois ») en date AAAA-MM-JJ à partir de la date du jour, toujours dans le futur.
- product : le produit sans la couleur ni la quantité (ex. « 25 t-shirts noirs » → product « T-shirts », color « Noir », quantity 25).
- description : les précisions utiles à la production (logo, emplacement, technique, contexte) reformulées proprement. Pas une copie de toute la dictée.
- client_type : « pro » pour une entreprise / association / mairie / club, « perso » pour un particulier, null si indéterminable.
- Corrige les erreurs évidentes de transcription vocale (homophones) d'après le contexte atelier.`;
}

// Nettoyage défensif : l'API garantit le format, on borne quand même les valeurs.
function sanitizeVoiceFields(raw) {
  const out = {};
  const str = (v, max) => {
    if (typeof v !== 'string') return null;
    const s = v.trim().slice(0, max);
    return s === '' ? null : s;
  };
  out.billing_company = str(raw.billing_company, 200);
  out.contact_referent = str(raw.contact_referent, 200);
  out.contact_phone = str(raw.contact_phone, 40);
  out.contact_email = (() => {
    const s = str(raw.contact_email, 200);
    return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
  })();
  out.product = str(raw.product, 300);
  out.color = str(raw.color, 120);
  out.quantity = Number.isInteger(raw.quantity) && raw.quantity > 0 ? raw.quantity : null;
  out.project_value = (typeof raw.project_value === 'number' && Number.isFinite(raw.project_value) && raw.project_value >= 0)
    ? raw.project_value : null;
  out.deadline = (typeof raw.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.deadline)) ? raw.deadline : null;
  out.description = str(raw.description, 1000);
  out.client_type = ['pro', 'perso'].includes(raw.client_type) ? raw.client_type : null;
  return out;
}

app.post('/api/voice/extract', asyncH(async (req, res) => {
  const transcript = typeof (req.body || {}).transcript === 'string' ? req.body.transcript.trim() : '';
  if (!transcript) return res.status(400).json({ error: 'Dictée vide.' });
  if (transcript.length > 4000) return res.status(400).json({ error: 'Dictée trop longue.' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Dictée indisponible : clé API non configurée sur le serveur.' });
  }

  try {
    const msg = await getAnthropic().messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1500,
      system: voiceSystemPrompt(),
      messages: [{ role: 'user', content: transcript }],
      output_config: { format: { type: 'json_schema', schema: VOICE_SCHEMA } },
    });
    const text = (msg.content.find((b) => b.type === 'text') || {}).text || '{}';
    res.json({ fields: sanitizeVoiceFields(JSON.parse(text)) });
  } catch (err) {
    console.error('voice/extract:', err.status || '', err.message);
    if (err.status === 401 || err.status === 403) {
      return res.status(502).json({ error: 'Clé API invalide ou compte sans crédit.' });
    }
    if (err.status === 429 || err.status === 529) {
      return res.status(503).json({ error: 'Service saturé — réessayez dans un instant.' });
    }
    res.status(502).json({ error: "L'analyse de la dictée a échoué. Réessayez." });
  }
}));

// ---------------------------------------------------------------------------
// Statique + SPA
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Planning OLDA — en écoute sur le port ${PORT}`);
      if (!APP_PASSWORD) console.log('⚠  APP_PASSWORD non défini : accès ouvert (mode dev).');
    });
  })
  .catch((err) => {
    console.error('Échec de l\'initialisation de la base :', err);
    process.exit(1);
  });
