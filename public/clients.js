// Base clients (CRM) — Atelier OLDA
// La fiche client PRO de référence, rapatriée de l'ancienne app « Base clients ».
// Liste cherchable + fiche éditable EN PLACE + notes/historique. Cette base
// alimente la prise de commande (auto-complétion) et se remplit toute seule
// quand un nouveau client est saisi au comptoir.
//
// Chargé À LA DEMANDE par app.js au premier passage sur la vue ; ensuite chaque
// retour ne fait que rafraîchir les données (un client a pu naître d'une commande).

let ROOT = null;
const $ = (sel) => ROOT.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const ic = (name, cls) => {
  const n = el('span', `material-symbols-outlined${cls ? ` ${cls}` : ''}`, name);
  n.setAttribute('aria-hidden', 'true');
  return n;
};
const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// Champs éditables de la fiche (ordre d'affichage). `list` = suggestions
// (datalist) construites depuis les valeurs déjà présentes dans la base.
const FIELDS = [
  { key: 'entreprise', label: 'Société', icon: 'apartment', ph: 'Nom de la société', required: true },
  { key: 'nom', label: 'Contact', icon: 'person', ph: 'Personne à contacter' },
  { key: 'fonction', label: 'Fonction', icon: 'badge', ph: 'Gérante, Resp. Marketing…' },
  { key: 'type', label: 'Type', icon: 'sell', ph: 'Boutique, Hôtel, Entretien…', list: 'cl-dl-types' },
  { key: 'zone', label: 'Zone', icon: 'location_on', ph: 'Grand Case, Marigot…', list: 'cl-dl-zones' },
  { key: 'telephone', label: 'Téléphone', icon: 'call', ph: '06 90 …', type: 'tel', inputmode: 'tel' },
  { key: 'email', label: 'E-mail', icon: 'mail', ph: 'contact@…', type: 'email', inputmode: 'email' },
  { key: 'adresse', label: 'Adresse', icon: 'home', ph: 'Ajouter…' },
];

const NOTE_KINDS = [
  { id: 'note', label: 'Note', icon: 'sticky_note_2' },
  { id: 'appel', label: 'Appel', icon: 'call' },
  { id: 'email', label: 'Email', icon: 'mail' },
  { id: 'rdv', label: 'RDV', icon: 'event' },
];
const KIND_BY_ID = new Map(NOTE_KINDS.map((k) => [k.id, k]));

// Nature du client : pro (société) / perso (particulier). Axe DISTINCT du `type`
// métier libre (Boutique, Hôtel…). Filtre de liste + segmented dans la fiche.
const NATURES = [
  { id: 'pro', label: 'Pro', icon: 'apartment' },
  { id: 'perso', label: 'Perso', icon: 'person' },
];
const nature = (v) => (v === 'perso' ? 'perso' : 'pro');
const natureLabel = (v) => (nature(v) === 'perso' ? 'Perso' : 'Pro');

// --- État ------------------------------------------------------------------
let LIST = [];             // clients (forme /api/clients, enrichie)
let query = '';
let sort = 'nom';          // 'nom' | 'recent'
let natureFilter = 'all';  // 'all' | 'pro' | 'perso'
let drawer = null;         // { id | null, mode, draft?, notes? }
let noteKind = 'note';

// --- API -------------------------------------------------------------------
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
  return data;
}

// --- Petits utilitaires d'affichage ---------------------------------------
function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return String(name || '?').replace(/\s+/g, '').slice(0, 2).toUpperCase() || '?';
}

// « il y a 3 j », « aujourd'hui », « il y a 2 h ». Repère de fraîcheur discret.
function ago(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 0) return "aujourd'hui";
  if (d === 1) return 'hier';
  if (d < 31) return `il y a ${d} j`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `il y a ${mo} mois`;
  return `il y a ${Math.floor(mo / 12)} an${mo >= 24 ? 's' : ''}`;
}

let toastTimer;
function toast(msg) {
  const t = $('#cl-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 3200);
}

// --- Construction statique (une fois) --------------------------------------
function buildStatic() {
  ROOT.replaceChildren();

  const view = el('div', 'cl');

  // En-tête : marque + recherche + tri + Nouveau.
  const head = el('header', 'cl-head');
  const brand = el('div', 'cl-brand');
  brand.append(el('span', 'cl-brand__av', 'O'));
  const bt = el('div', 'cl-brand__text');
  bt.append(el('h2', 'cl-brand__title', 'Base clients'));
  bt.append(el('p', 'cl-brand__sub', ''));
  brand.append(bt);

  const search = el('div', 'cl-search');
  search.append(ic('search', 'cl-search__ic'));
  const input = el('input', 'cl-search__input');
  input.type = 'text';
  input.placeholder = 'Rechercher un client, une zone, un type…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Rechercher un client');
  input.id = 'cl-q';
  search.append(input);
  const clear = el('button', 'cl-search__clear', '×');
  clear.type = 'button';
  clear.id = 'cl-q-clear';
  clear.hidden = true;
  clear.setAttribute('aria-label', 'Effacer la recherche');
  search.append(clear);

  const natWrap = el('div', 'cl-filter');
  natWrap.setAttribute('role', 'group');
  natWrap.setAttribute('aria-label', 'Filtrer par nature');
  for (const f of [{ id: 'all', label: 'Tous' }, ...NATURES]) {
    const b = el('button', `cl-filter__btn${natureFilter === f.id ? ' is-on' : ''}`, f.label);
    b.type = 'button';
    b.dataset.nature = f.id;
    natWrap.append(b);
  }

  const sortWrap = el('div', 'cl-sort');
  for (const s of [{ id: 'nom', label: 'Nom' }, { id: 'recent', label: 'Récent' }]) {
    const b = el('button', `cl-sort__btn${sort === s.id ? ' is-on' : ''}`, s.label);
    b.type = 'button';
    b.dataset.sort = s.id;
    sortWrap.append(b);
  }

  const nw = el('button', 'cl-new');
  nw.type = 'button';
  nw.id = 'cl-new';
  nw.append(ic('add'), el('span', null, 'Nouveau'));

  head.append(brand, search, natWrap, sortWrap, nw);

  const list = el('div', 'cl-list');
  list.id = 'cl-list';
  const empty = el('div', 'cl-empty', 'Aucun client.');
  empty.id = 'cl-empty';
  empty.hidden = true;

  view.append(head, list, empty);

  // Suggestions type / zone (remplies au rendu).
  const dlT = el('datalist'); dlT.id = 'cl-dl-types';
  const dlZ = el('datalist'); dlZ.id = 'cl-dl-zones';

  // Tiroir (fiche), overlay plein écran.
  const drawerEl = el('div', 'cl-drawer');
  drawerEl.id = 'cl-drawer';
  drawerEl.hidden = true;
  const scrim = el('div', 'cl-drawer__scrim');
  scrim.id = 'cl-drawer-scrim';
  const card = el('aside', 'cl-drawer__card');
  card.id = 'cl-drawer-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  drawerEl.append(scrim, card);

  const toastEl = el('div', 'cl-toast');
  toastEl.id = 'cl-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');

  ROOT.append(view, dlT, dlZ, drawerEl, toastEl);
}

// --- Liste -----------------------------------------------------------------
function suggestions() {
  const types = [...new Set(LIST.map((c) => c.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const zones = [...new Set(LIST.map((c) => c.zone).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  $('#cl-dl-types').replaceChildren(...types.map((t) => new Option(t)));
  $('#cl-dl-zones').replaceChildren(...zones.map((z) => new Option(z)));
}

function filtered() {
  const needle = fold(query).trim();
  let list = LIST;
  if (natureFilter !== 'all') list = list.filter((c) => nature(c.client_type) === natureFilter);
  if (needle) {
    const parts = needle.split(/\s+/);
    list = list.filter((c) => {
      const hay = fold([c.entreprise, c.nom, c.fonction, natureLabel(c.client_type), c.type, c.zone, c.telephone, c.email].filter(Boolean).join(' '));
      return parts.every((p) => hay.includes(p));
    });
  }
  list = [...list];
  if (sort === 'recent') list.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  else list.sort((a, b) => a.entreprise.localeCompare(b.entreprise, 'fr'));
  return list;
}

function card(c) {
  const b = el('button', 'cl-card');
  b.type = 'button';
  b.dataset.id = c.id;
  if (drawer && drawer.id === c.id) b.classList.add('is-active');

  b.append(el('span', 'cl-av', initials(c.entreprise)));

  const body = el('div', 'cl-card__body');
  const nameRow = el('div', 'cl-card__namerow');
  nameRow.append(el('span', 'cl-card__name', c.entreprise));
  const nat = nature(c.client_type);
  nameRow.append(el('span', `cl-nature cl-nature--${nat}`, natureLabel(nat)));
  body.append(nameRow);
  const sub = [c.nom, c.type, c.zone].filter(Boolean).join(' · ');
  body.append(el('div', 'cl-card__sub', sub || '—'));
  b.append(body);

  const meta = el('div', 'cl-card__meta');
  const badges = el('div', 'cl-card__badges');
  if (c.commandes > 0) {
    const cmd = el('span', 'cl-badge cl-badge--cmd');
    cmd.append(ic('receipt_long'), el('span', null, String(c.commandes)));
    cmd.title = `${c.commandes} commande${c.commandes > 1 ? 's' : ''} au planning`;
    badges.append(cmd);
  }
  if (c.notes_count > 0) {
    const nt = el('span', 'cl-badge cl-badge--note');
    nt.append(ic('chat'), el('span', null, String(c.notes_count)));
    nt.title = `${c.notes_count} note${c.notes_count > 1 ? 's' : ''}`;
    badges.append(nt);
  }
  meta.append(badges);
  meta.append(el('span', 'cl-card__time', ago(c.updated_at)));
  meta.append(ic('chevron_right', 'cl-card__chev'));
  b.append(meta);
  return b;
}

function renderList() {
  suggestions();

  const list = filtered();
  $('#cl-list').replaceChildren(...list.map(card));
  $('#cl-empty').hidden = list.length > 0;
  const clear = $('#cl-q-clear');
  if (clear) clear.hidden = !query;

  // Sous-titre : total, ou « filtrés / total » quand une recherche est active.
  const brandSub = $('.cl-brand__sub');
  if (brandSub) {
    brandSub.textContent = query
      ? `${list.length} / ${LIST.length} clients`
      : `OLDA · ${LIST.length} client${LIST.length > 1 ? 's' : ''}`;
  }
}

// --- Fiche (tiroir) --------------------------------------------------------
function fieldRow(field, value, opts) {
  const row = el('div', 'cl-f');
  const lab = el('label', 'cl-f__label');
  lab.append(ic(field.icon, 'cl-f__ic'), el('span', null, field.label));
  const input = el('input', 'cl-f__input');
  input.type = field.type || 'text';
  if (field.inputmode) input.inputMode = field.inputmode;
  if (field.list) input.setAttribute('list', field.list);
  input.value = value == null ? '' : value;
  input.placeholder = field.ph || '';
  input.autocomplete = 'off';
  input.dataset.key = field.key;
  const id = `cl-f-${field.key}`;
  input.id = id;
  lab.setAttribute('for', id);
  row.append(lab, input);
  if (field.key === 'entreprise') input.classList.add('cl-f__input--strong');
  return row;
}

function noteEl(n) {
  const k = KIND_BY_ID.get(n.kind) || KIND_BY_ID.get('note');
  const item = el('div', `cl-note cl-note--${k.id}`);
  const head = el('div', 'cl-note__head');
  const badge = el('span', 'cl-note__kind');
  badge.append(ic(k.icon), el('span', null, k.label));
  head.append(badge, el('span', 'cl-note__time', ago(n.created_at)));
  const del = el('button', 'cl-note__del');
  del.type = 'button';
  del.dataset.noteId = n.id;
  del.title = 'Supprimer la note';
  del.setAttribute('aria-label', 'Supprimer la note');
  del.append(ic('close'));
  head.append(del);
  item.append(head, el('p', 'cl-note__body', n.body));
  return item;
}

function renderDrawer() {
  const card = $('#cl-drawer-card');
  const box = $('#cl-drawer');
  if (!drawer) { box.hidden = true; return; }
  box.hidden = false;
  card.replaceChildren();

  const creating = drawer.mode === 'create';
  const c = drawer.draft;

  // En-tête : avatar + titre + supprimer + fermer.
  const head = el('header', 'cl-dh');
  head.append(el('span', 'cl-dh__av', initials(c.entreprise) || '+'));
  const titles = el('div', 'cl-dh__titles');
  titles.append(el('h2', 'cl-dh__title', creating ? 'Nouveau client' : (c.entreprise || 'Client')));
  const sub = [c.type, c.zone].filter(Boolean).join(' · ');
  titles.append(el('p', 'cl-dh__sub', creating ? 'Renseignez au moins la société' : (sub || '—')));
  head.append(titles);
  const tools = el('div', 'cl-dh__tools');
  if (!creating) {
    const del = el('button', 'cl-dh__btn cl-dh__btn--danger');
    del.type = 'button';
    del.id = 'cl-del';
    del.title = 'Supprimer le client';
    del.setAttribute('aria-label', 'Supprimer le client');
    del.append(ic('delete'));
    tools.append(del);
  }
  const close = el('button', 'cl-dh__btn');
  close.type = 'button';
  close.id = 'cl-close';
  close.title = 'Fermer';
  close.setAttribute('aria-label', 'Fermer la fiche');
  close.append(ic('close'));
  tools.append(close);
  head.append(tools);
  card.append(head);

  const bodyScroll = el('div', 'cl-dbody');

  // Champs éditables. La NATURE pro/perso ouvre la fiche : segmented, pas texte.
  const fields = el('div', 'cl-fields');
  const natRow = el('div', 'cl-f cl-f--nature');
  const natLab = el('span', 'cl-f__label');
  natLab.append(ic('badge', 'cl-f__ic'), el('span', null, 'Nature'));
  const seg = el('div', 'cl-seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Nature du client');
  const cur = nature(c.client_type);
  for (const n of NATURES) {
    const nb = el('button', `cl-seg__btn${n.id === cur ? ' is-on' : ''}`, n.label);
    nb.type = 'button';
    nb.dataset.nature = n.id;
    nb.setAttribute('role', 'radio');
    nb.setAttribute('aria-checked', String(n.id === cur));
    seg.append(nb);
  }
  natRow.append(natLab, seg);
  fields.append(natRow);
  for (const f of FIELDS) fields.append(fieldRow(f, c[f.key]));
  bodyScroll.append(fields);

  // Actions rapides : appeler / écrire (fiche existante seulement).
  if (!creating) {
    const acts = el('div', 'cl-acts');
    const call = el('a', `cl-act${c.telephone ? '' : ' is-off'}`);
    call.append(ic('call'), el('span', null, 'Appeler'));
    if (c.telephone) call.href = `tel:${String(c.telephone).replace(/\s+/g, '')}`;
    const mail = el('a', `cl-act${c.email ? '' : ' is-off'}`);
    mail.append(ic('mail'), el('span', null, 'Écrire'));
    if (c.email) mail.href = `mailto:${c.email}`;
    acts.append(call, mail);
    bodyScroll.append(acts);

    // Méta + timeline.
    const meta = el('p', 'cl-meta');
    const parts = [];
    if (c.commandes > 0) parts.push(`${c.commandes} commande${c.commandes > 1 ? 's' : ''} au planning`);
    parts.push(`créé ${ago(c.created_at)}`);
    if (c.updated_at && c.updated_at !== c.created_at) parts.push(`modifié ${ago(c.updated_at)}`);
    meta.textContent = parts.join(' · ');
    bodyScroll.append(meta);

    const notes = el('section', 'cl-notes');
    const nh = el('header', 'cl-notes__head');
    nh.append(el('h3', 'cl-notes__title', 'Notes & historique'));
    nh.append(el('span', 'cl-notes__count', String((drawer.notes || []).length)));
    notes.append(nh);

    // Saisie d'une note (type + texte + ajouter).
    const composer = el('div', 'cl-composer');
    const ta = el('textarea', 'cl-composer__input');
    ta.id = 'cl-note-input';
    ta.rows = 2;
    ta.placeholder = 'Ajouter une note, un appel, un email, un rdv…';
    composer.append(ta);
    const bar = el('div', 'cl-composer__bar');
    const kinds = el('div', 'cl-kinds');
    for (const k of NOTE_KINDS) {
      const kb = el('button', `cl-kind${k.id === noteKind ? ' is-on' : ''}`);
      kb.type = 'button';
      kb.dataset.kind = k.id;
      kb.append(ic(k.icon), el('span', null, k.label));
      kinds.append(kb);
    }
    const add = el('button', 'cl-composer__add');
    add.type = 'button';
    add.id = 'cl-note-add';
    add.append(ic('add'), el('span', null, 'Ajouter'));
    bar.append(kinds, add);
    composer.append(bar);
    notes.append(composer);

    const timeline = el('div', 'cl-timeline');
    if ((drawer.notes || []).length === 0) {
      timeline.append(el('p', 'cl-timeline__empty', 'Aucune note pour ce client.'));
    } else {
      for (const n of drawer.notes) timeline.append(noteEl(n));
    }
    notes.append(timeline);
    bodyScroll.append(notes);
  }

  card.append(bodyScroll);

  // Pied : en création, bouton Créer.
  if (creating) {
    const foot = el('footer', 'cl-dfoot');
    const cancel = el('button', 'cl-btn', 'Annuler');
    cancel.type = 'button';
    cancel.id = 'cl-close-2';
    const create = el('button', 'cl-btn cl-btn--primary', 'Créer le client');
    create.type = 'button';
    create.id = 'cl-create';
    foot.append(cancel, create);
    card.append(foot);
    setTimeout(() => { const e = $('#cl-f-entreprise'); if (e) e.focus(); }, 40);
  }
}

// --- Ouverture / fermeture -------------------------------------------------
async function openClient(id) {
  // Optimiste : on ouvre tout de suite avec ce qu'on a, puis on complète (notes).
  const known = LIST.find((c) => c.id === id);
  drawer = { id, mode: 'edit', draft: { ...(known || { entreprise: '' }) }, notes: [] };
  renderDrawer();
  renderList();
  try {
    const full = await api('GET', `/api/clients/${id}`);
    if (drawer && drawer.id === id) {
      drawer.draft = { ...full };
      drawer.notes = full.notes || [];
      renderDrawer();
    }
  } catch (err) {
    toast(err.message || 'Fiche indisponible.');
  }
}

function openNew() {
  drawer = { id: null, mode: 'create', draft: { entreprise: '', nom: '', fonction: '', client_type: 'pro', type: '', zone: '', telephone: '', email: '', adresse: '' }, notes: [] };
  renderDrawer();
}

function closeDrawer() {
  drawer = null;
  renderDrawer();
  renderList();
}

// --- Mutations -------------------------------------------------------------
// Édition en place : PATCH d'un champ à la validation. Optimiste avec repli.
async function saveField(key, raw) {
  if (!drawer || drawer.mode !== 'edit') return;
  const value = String(raw).trim();
  const prev = drawer.draft[key] == null ? '' : String(drawer.draft[key]);
  if (value === prev) return;
  try {
    const updated = await api('PATCH', `/api/clients/${drawer.id}`, { [key]: value });
    drawer.draft = { ...drawer.draft, ...updated };
    // Reflète dans la liste locale sans tout recharger.
    const i = LIST.findIndex((c) => c.id === drawer.id);
    if (i >= 0) LIST[i] = { ...LIST[i], ...updated };
    renderList();
    // Met à jour l'en-tête du tiroir (titre/sous-titre) sans casser le focus.
    const av = $('.cl-dh__av'); if (av) av.textContent = initials(drawer.draft.entreprise) || '+';
    const t = $('.cl-dh__title'); if (t) t.textContent = drawer.draft.entreprise || 'Client';
    const s = $('.cl-dh__sub'); if (s) s.textContent = [drawer.draft.type, drawer.draft.zone].filter(Boolean).join(' · ') || '—';
  } catch (err) {
    // Repli : on remet la valeur d'avant dans le champ.
    const input = $(`#cl-f-${key}`);
    if (input) input.value = prev;
    toast(err.message || 'Modification refusée.');
  }
}

// Nature pro/perso : posée par le segmented (bouton, pas champ texte). En
// édition on PATCH aussitôt ; en création on ne fait que mémoriser le choix.
async function setNature(value) {
  if (!drawer) return;
  const nat = nature(value);
  const unchanged = nature(drawer.draft.client_type) === nat;
  drawer.draft.client_type = nat;
  for (const b of ROOT.querySelectorAll('.cl-seg__btn')) {
    const on = b.dataset.nature === nat;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  }
  if (drawer.mode !== 'edit' || unchanged) return;   // création, ou rien à changer
  try {
    const updated = await api('PATCH', `/api/clients/${drawer.id}`, { client_type: nat });
    drawer.draft = { ...drawer.draft, ...updated };
    const i = LIST.findIndex((c) => c.id === drawer.id);
    if (i >= 0) LIST[i] = { ...LIST[i], ...updated };
    renderList();
  } catch (err) {
    toast(err.message || 'Modification refusée.');
  }
}

async function createClient() {
  if (!drawer || drawer.mode !== 'create') return;
  const draft = { client_type: nature(drawer.draft.client_type) };
  for (const f of FIELDS) {
    const input = $(`#cl-f-${f.key}`);
    if (input) draft[f.key] = input.value.trim();
  }
  if (!draft.entreprise) { toast('Le nom de la société est requis.'); const e = $('#cl-f-entreprise'); if (e) e.focus(); return; }
  const btn = $('#cl-create');
  if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }
  try {
    const created = await api('POST', '/api/clients', draft);
    LIST.push({ ...created, notes_count: 0, commandes: 0 });
    await openClient(created.id);
    renderList();
    toast('Client créé.');
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Créer le client'; }
    toast(err.message || 'Création impossible.');
  }
}

async function deleteClient() {
  if (!drawer || drawer.mode !== 'edit') return;
  const c = drawer.draft;
  if (!window.confirm(`Supprimer définitivement « ${c.entreprise} » et ses notes ?`)) return;
  try {
    await api('DELETE', `/api/clients/${drawer.id}`);
    LIST = LIST.filter((x) => x.id !== drawer.id);
    closeDrawer();
    toast('Client supprimé.');
  } catch (err) {
    toast(err.message || 'Suppression impossible.');
  }
}

async function addNote() {
  if (!drawer || drawer.mode !== 'edit') return;
  const ta = $('#cl-note-input');
  const body = ta ? ta.value.trim() : '';
  if (!body) { if (ta) ta.focus(); return; }
  try {
    const note = await api('POST', `/api/clients/${drawer.id}/notes`, { kind: noteKind, body });
    drawer.notes = [note, ...(drawer.notes || [])];
    const i = LIST.findIndex((c) => c.id === drawer.id);
    if (i >= 0) LIST[i] = { ...LIST[i], notes_count: (LIST[i].notes_count || 0) + 1 };
    renderDrawer();
    renderList();
  } catch (err) {
    toast(err.message || 'Note non enregistrée.');
  }
}

async function deleteNote(noteId) {
  if (!drawer || drawer.mode !== 'edit') return;
  try {
    await api('DELETE', `/api/clients/${drawer.id}/notes/${noteId}`);
    drawer.notes = (drawer.notes || []).filter((n) => n.id !== noteId);
    const i = LIST.findIndex((c) => c.id === drawer.id);
    if (i >= 0) LIST[i] = { ...LIST[i], notes_count: Math.max(0, (LIST[i].notes_count || 0) - 1) };
    renderDrawer();
    renderList();
  } catch (err) {
    toast(err.message || 'Suppression impossible.');
  }
}

// --- Câblage ---------------------------------------------------------------
function wire() {
  // Clics (délégués).
  ROOT.addEventListener('click', (e) => {
    const t = e.target;

    const cardBtn = t.closest('.cl-card');
    if (cardBtn) return openClient(cardBtn.dataset.id);

    const sortBtn = t.closest('.cl-sort__btn');
    if (sortBtn) {
      sort = sortBtn.dataset.sort;
      for (const b of ROOT.querySelectorAll('.cl-sort__btn')) b.classList.toggle('is-on', b === sortBtn);
      return renderList();
    }

    const filterBtn = t.closest('.cl-filter__btn');
    if (filterBtn) {
      natureFilter = filterBtn.dataset.nature;
      for (const b of ROOT.querySelectorAll('.cl-filter__btn')) b.classList.toggle('is-on', b === filterBtn);
      return renderList();
    }

    const segBtn = t.closest('.cl-seg__btn');
    if (segBtn) return setNature(segBtn.dataset.nature);

    if (t.closest('#cl-new')) return openNew();
    if (t.closest('#cl-q-clear')) { query = ''; $('#cl-q').value = ''; $('#cl-q').focus(); return renderList(); }
    if (t.closest('#cl-close') || t.closest('#cl-close-2') || t.closest('#cl-drawer-scrim')) return closeDrawer();
    if (t.closest('#cl-del')) return deleteClient();
    if (t.closest('#cl-create')) return createClient();
    if (t.closest('#cl-note-add')) return addNote();

    const kindBtn = t.closest('.cl-kind');
    if (kindBtn) {
      noteKind = kindBtn.dataset.kind;
      for (const b of ROOT.querySelectorAll('.cl-kind')) b.classList.toggle('is-on', b === kindBtn);
      return;
    }

    const delNote = t.closest('.cl-note__del');
    if (delNote) return deleteNote(delNote.dataset.noteId);
  });

  // Recherche.
  ROOT.addEventListener('input', (e) => {
    if (e.target.id === 'cl-q') { query = e.target.value; renderList(); }
  });

  // Édition en place : on enregistre à la validation (blur ou Entrée).
  ROOT.addEventListener('change', (e) => {
    if (e.target.classList && e.target.classList.contains('cl-f__input') && drawer && drawer.mode === 'edit') {
      saveField(e.target.dataset.key, e.target.value);
    }
  });
  ROOT.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer) { e.preventDefault(); return closeDrawer(); }
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('cl-f__input')) {
      e.preventDefault();
      e.target.blur();
    }
  });
}

// --- Chargement ------------------------------------------------------------
async function load() {
  try {
    LIST = await api('GET', '/api/clients');
  } catch (err) {
    LIST = [];
    toast('Base clients indisponible.');
  }
  renderList();
  // Si une fiche est ouverte, on la resynchronise avec la liste rechargée.
  if (drawer && drawer.id) {
    const fresh = LIST.find((c) => c.id === drawer.id);
    if (fresh) { drawer.draft = { ...drawer.draft, ...fresh }; }
    else closeDrawer();
  }
}

let mounted = false;
export async function initClients(root) {
  if (mounted) return;
  ROOT = root;
  buildStatic();
  wire();
  mounted = true;
  await load();
}

// Rappelé par app.js à chaque retour sur la vue : un client a pu être créé
// depuis une prise de commande, ou modifié depuis un autre poste.
export async function refreshClients() {
  if (!mounted) return;
  await load();
}
