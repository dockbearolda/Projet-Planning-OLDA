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
  getTarifsTasseArticles, setTarifsTasseArticles,
  getTarifsTasseParametres, setTarifsTasseParametres,
  getCommandeZones, getHiddenCommandeZones,
  getClientSecteurs, addClientSecteur, removeClientSecteur,
  SUB_STAGES, WHATSAPP_MESSAGE_MAX, getWhatsappMessage, setWhatsappMessage,
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
  'acompte_demande', 'acompte_verse', 'acompte_montant', 'paye', 'paiement_mode',
];

// Champs booléens du suivi de paiement. null = on ne se prononce pas (une ligne
// jamais renseignée n'affirme pas « non payé »).
const PAIEMENT_FLAGS = new Set(['acompte_demande', 'acompte_verse', 'paye']);

function validateField(key, value) {
  if (value === null || value === undefined) return { ok: true, value: null };
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

// On expose seulement le nom de fichier des PDF (jamais les blobs) afin que la
// grille et le temps réel restent légers.
const SELECT = `SELECT r.*,
    ad.filename AS devis_name,
    ab.filename AS bat_name,
    af.filename AS facture_name
  FROM requests r
  LEFT JOIN attachments ad ON ad.request_id = r.id AND ad.kind = 'devis'
  LEFT JOIN attachments ab ON ab.request_id = r.id AND ab.kind = 'bat'
  LEFT JOIN attachments af ON af.request_id = r.id AND af.kind = 'facture'`;
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

// Identifiant lisible « CLI-PRO-0007 » / « CLI-PERSO-0007 » : un repère visuel
// pour le patron (comme dans son classeur), pas un UUID. Compteur persistant en
// app_meta (jamais dérivé des lignes existantes) : un numéro attribué n'est
// JAMAIS réutilisé, même si le client qui le portait est supprimé ensuite.
async function nextClientCode(clientType) {
  const perso = clientType === 'perso';
  const prefix = perso ? 'CLI-PERSO-' : 'CLI-PRO-';
  const metaKey = perso ? 'client_code_seq_perso' : 'client_code_seq_pro';
  const { rows } = await pool.query('SELECT value FROM app_meta WHERE key = $1', [metaKey]);
  const next = (rows[0] ? Number.parseInt(rows[0].value, 10) || 0 : 0) + 1;
  await pool.query('DELETE FROM app_meta WHERE key = $1', [metaKey]);
  await pool.query('INSERT INTO app_meta (key, value) VALUES ($1, $2)', [metaKey, String(next)]);
  return `${prefix}${String(next).padStart(4, '0')}`;
}

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
  const clientType = cols.includes('client_type') ? params[cols.indexOf('client_type')] : 'pro';
  cols.push('code'); vals.push(`$${i++}`); params.push(await nextClientCode(clientType));
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
  // Un particulier a un prénom ET un nom : les deux vont dans sa fiche, sinon
  // elle naîtrait à moitié vide et la prochaine commande n'aurait plus que
  // `entreprise` pour retrouver son identité. Un pro n'a qu'un contact.
  const nom = nature === 'perso' ? trimOrNull(cl.nom) : trimOrNull(cl.contact);
  const prenom = nature === 'perso' ? trimOrNull(cl.prenom) : null;
  await pool.query(
    'INSERT INTO clients (entreprise, nom, prenom, telephone, email, client_type) VALUES ($1,$2,$3,$4,$5,$6)',
    [entreprise, nom, prenom, trimOrNull(cl.telephone), trimOrNull(cl.email), nature],
  );
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
function readPrixLigne(raw, quantite, where, defautUnitaireTtc) {
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
function buildLigneTextile(raw, index) {
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

  const prix = readPrixLigne(l, q.quantite, where, null);
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
function buildLigneAutres(raw, index, typeLabel) {
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
    ['methode', 'méthode de production', TEXTE_MAX]]) {
    const t = readTexte(l[champ], where, quoi, max);
    if (t.error) return { error: t.error };
    champs[champ] = t.value;
  }

  const prix = readPrixLigne(l, q.quantite, where, null);
  if (prix.error) return { error: prix.error };

  return {
    ligne: {
      quantite: q.quantite, designation: designation.value, ...champs,
      prixUnitaireTtc: prix.prixUnitaireTtc, prixUnitaireHt: prix.prixUnitaireHt,
      description: `${q.quantite} × ${designation.value}`,
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

  const lignes = [];
  let prixTotalTtc = 0;
  let prixRevientTotal = 0;
  for (let i = 0; i < rawLignes.length; i += 1) {
    const raw = rawLignes[i] && typeof rawLignes[i] === 'object' ? rawLignes[i] : {};
    const type = PROJET_TYPE_BY_ID.get(raw.type);
    if (!type) return { error: `Produit ${i + 1} : type de projet inconnu (${raw.type})` };
    let built;
    if (type.forme === 'tasse') built = buildLigneTasse(raw, i, tarifsById);
    else if (type.forme === 'textile') built = buildLigneTextile(raw, i);
    else built = buildLigneAutres(raw, i, type.label);
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
  prixTotalTtc = prixTotalTtc * (1 + (delai.majoration || 0) / 100);
  prixTotalTtc = Math.round(prixTotalTtc * 100) / 100;

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

  const venteHt = prixTotalTtc / (1 + PROJET_TGCA);
  const margeHt = Math.round((venteHt - prixRevientTotal) * 100) / 100;
  // Le HT n'est jamais stocké : il se déduit du TTC et du taux TGCA du moment.
  // On le renvoie quand même à l'écran de confirmation, pour éviter que chaque
  // vue le recalcule avec un taux qu'elle aurait deviné.
  const prixTotalHt = Math.round(venteHt * 100) / 100;

  const paiement = readPaiement(b.paiement);

  const projet = {
    kind: 'projet-simple',
    // v1 = type unique ; v2 = panier multi-type ; v3 = suivi paiement ;
    // v4 = fiche de production détaillée par famille + prix unitaire HT/TTC ;
    // v5 = vente directe (numéro de ticket, heure de retrait, note interne)
    version: 5,
    numero: ticket.value,
    client,
    lignes,
    heureSouhaitee: heure,
    noteInterne: note.value,
    retraitImmediat,
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
  const resume = [
    `${typesPresents.join(' + ').toUpperCase()} — ${client.societe}${client.type === 'perso' ? ' (perso)' : ''}`,
    ticket.value ? `Ticket : ${ticket.value}` : null,
    ...lignes.map(detailLigneTexte),
    `Délai : ${delai.label}${delai.majoration ? ` (+${delai.majoration} %)` : ''}`,
    heure ? `Retrait souhaité : le ${deadline} à ${heure.replace(':', 'h')}` : null,
    retraitImmediat ? 'Le client est reparti avec sa commande.' : null,
    `Prix : ${prixTotalTtc.toFixed(2)} € TTC (${prixTotalHt.toFixed(2)} € HT)`,
    etatPaiement ? `Paiement : ${etatPaiement}` : null,
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
       (stage, sub_stage, order_kind, priority, client_type, billing_company, contact_referent,
        contact_phone, contact_email, quantity, product, description, deadline, position, fiche, project_value,
        acompte_demande, acompte_verse, acompte_montant, paye, paiement_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING *`,
    [
      projet.stage, projet.subStage, 'commande', projet.priority, projet.client.type,
      projet.client.societe, projet.client.contact, projet.client.telephone, projet.client.email,
      projet.quantite, produit, resume, projet.deadline, posRows[0].pos,
      // `project_value` porte le TTC : c'est le prix que le client paie, et
      // c'est lui qu'on saisit au comptoir. Le HT s'en déduit à l'affichage.
      JSON.stringify(projet), projet.prixTotalTtc,
      projet.paiement.acompteDemande, projet.paiement.acompteVerse, projet.paiement.acompteMontant,
      projet.paiement.paye, projet.paiement.mode ? projet.paiement.mode.id : null,
    ],
  );

  await upsertClientFromCommande(projet.client);

  broadcast({ kind: 'create', stages: [projet.stage] });
  res.status(201).json({ id: rows[0].id, projet });
}));

// POST /api/vente/numero → réserve le numéro du ticket de vente directe,
// « 26.07.30-001 » : deux chiffres d'année, mois, jour, puis le rang de la vente
// DANS LA JOURNÉE. Le compteur vit en app_meta (même principe que les codes
// clients) : deux comptoirs qui encaissent en même temps ne peuvent pas remettre
// le même numéro au client, et un numéro attribué n'est jamais réutilisé.
// Le jour est celui du POSTE (`jour`, aaaa-mm-jj) : le conteneur tourne en UTC,
// il basculerait au lendemain dès 20 h à Saint-Martin.
app.post('/api/vente/numero', asyncH(async (req, res) => {
  const body = req.body || {};
  const jour = isDay(body.jour) ? body.jour : todayPlus(0);
  const [y, m, d] = jour.split('-');
  const metaKey = `vente_seq_${y}${m}${d}`;
  const { rows } = await pool.query('SELECT value FROM app_meta WHERE key = $1', [metaKey]);
  const rang = (rows[0] ? Number.parseInt(rows[0].value, 10) || 0 : 0) + 1;
  await pool.query('DELETE FROM app_meta WHERE key = $1', [metaKey]);
  await pool.query('INSERT INTO app_meta (key, value) VALUES ($1, $2)', [metaKey, String(rang)]);
  res.status(201).json({
    numero: `${y.slice(2)}.${m}.${d}-${String(rang).padStart(3, '0')}`, jour, rang,
  });
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
const NO_CACHE = /\.(html|js|css|webmanifest)$/;
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
