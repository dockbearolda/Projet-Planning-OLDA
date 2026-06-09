// ===========================================================================
// Planning OLDA — frontend (vanilla ES module, aucun build)
// ===========================================================================

// --- Étapes : groupes pour les séparateurs (3 blocs). ----------------------
const STAGE_GROUPS = [
  [
    { slug: 'demande', label: 'Demande' },
    { slug: 'devis_en_cours', label: 'Devis en cours' },
    { slug: 'devis_accepte', label: 'Devis accepté' },
  ],
  [
    { slug: 'prod_dtf', label: 'Prod DTF' },
    { slug: 'prod_pressage', label: 'Prod Pressage' },
    { slug: 'prod_trotec', label: 'Prod Trotec' },
    { slug: 'prod_roland_uv', label: 'Prod Roland UV' },
    { slug: 'prod_sous_traitance', label: 'Prod Sous-traitance' },
    { slug: 'prod_autre', label: 'Prod Autre' },
  ],
  [
    { slug: 'facturation', label: 'Facturation' },
    { slug: 'archive', label: 'Archivé' },
    { slug: 'maquette_fiverr', label: 'Fiverr' },
    { slug: 'toptex', label: 'Toptex' },
  ],
];
const STAGES = STAGE_GROUPS.flat();
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.slug, s.label]));

// --- Liens externes par catégorie (affichés dans l'en-tête de l'étape). -----
const STAGE_LINKS = {
  maquette_fiverr: { url: 'https://fr.fiverr.com/', label: 'Ouvrir Fiverr' },
  toptex: { url: 'https://www.toptex.fr/', label: 'Ouvrir Toptex' },
};

// Cibles d'envoi rapide proposées sur chaque ligne (boutons « → … »).
const SEND_TARGETS = [
  { slug: 'maquette_fiverr', label: 'Fiverr' },
  { slug: 'toptex', label: 'Toptex' },
];

// --- État applicatif -------------------------------------------------------
let currentStage = 'demande';
let rows = [];                 // demandes de l'étape courante
let counts = {};               // compteurs par étape
let sort = { key: null, dir: 1 }; // tri manuel via en-têtes (null = tri par défaut)

// --- Sélecteurs ------------------------------------------------------------
const $stages = document.getElementById('stages');
const $rows = document.getElementById('rows');
const $empty = document.getElementById('empty');
const $stageTitle = document.getElementById('stageTitle');
const $stageCount = document.getElementById('stageCount');
const $btnNew = document.getElementById('btnNew');
const $stageLink = document.getElementById('stageLink');
const $stageLinkLabel = document.getElementById('stageLinkLabel');

// Affiche (ou masque) le lien externe associé à l'étape courante.
function updateStageLink(slug) {
  if (!$stageLink) return;
  const link = STAGE_LINKS[slug];
  if (link) {
    $stageLink.href = link.url;
    if ($stageLinkLabel) $stageLinkLabel.textContent = link.label;
    $stageLink.hidden = false;
  } else {
    $stageLink.removeAttribute('href');
    $stageLink.hidden = true;
  }
}

// --- API helpers -----------------------------------------------------------
async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).error || detail; } catch (_) {}
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

// --- Rendu sidebar ---------------------------------------------------------
function renderSidebar() {
  $stages.innerHTML = '';
  STAGE_GROUPS.forEach((group, gi) => {
    group.forEach((s) => {
      const el = document.createElement('div');
      el.className = 'stage' + (s.slug === currentStage ? ' active' : '');
      el.dataset.slug = s.slug;
      const n = counts[s.slug] ?? 0;
      el.innerHTML = `<span class="stage-label">${escapeHtml(s.label)}</span>` +
        `<span class="stage-count${n > 0 ? ' has-items' : ''}">${n}</span>`;
      el.addEventListener('click', () => selectStage(s.slug));
      attachDrop(el, s.slug);
      $stages.appendChild(el);
    });
    if (gi < STAGE_GROUPS.length - 1) {
      const hr = document.createElement('hr');
      hr.className = 'stage-sep';
      $stages.appendChild(hr);
    }
  });
}

function selectStage(slug) {
  currentStage = slug;
  sort = { key: null, dir: 1 };
  $stageTitle.textContent = STAGE_LABEL[slug];
  updateStageLink(slug);
  document.querySelectorAll('.stage').forEach((el) => {
    el.classList.toggle('active', el.dataset.slug === slug);
  });
  loadRows();
}

// --- Chargement données ----------------------------------------------------
async function loadCounts() {
  counts = await api('GET', '/api/counts');
  document.querySelectorAll('.stage').forEach((el) => {
    const c = el.querySelector('.stage-count');
    if (c) {
      const n = counts[el.dataset.slug] ?? 0;
      c.textContent = n;
      c.classList.toggle('has-items', n > 0);
    }
  });
}

async function loadRows() {
  rows = await api('GET', `/api/requests?stage=${encodeURIComponent(currentStage)}`);
  lastRowsSig = signature(rows);
  applySortAndRender();
}

// --- Tri -------------------------------------------------------------------
function applySortAndRender() {
  const data = [...rows];
  if (sort.key) {
    data.sort((a, b) => cmp(a, b, sort.key) * sort.dir);
  } else {
    // tri par défaut : priorité desc, échéance asc
    data.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return cmpDeadline(a.deadline, b.deadline);
    });
  }
  renderRows(data);
  $stageCount.textContent = data.length ? `${data.length} commande${data.length > 1 ? 's' : ''}` : '';
}

function cmpDeadline(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// Parse une échéance en date locale (minuit). Gère l'ISO renvoyé par la DB
// (« 2026-06-11T00:00:00.000Z ») et la saisie « jj/mm/aaaa ». null si invalide.
function parseDeadline(deadline) {
  if (!deadline) return null;
  const s = String(deadline).trim();
  if (!s) return null;
  let y, m, d;
  if (s.includes('/')) {
    const p = s.split('/');
    if (p.length !== 3) return null;
    d = +p[0]; m = +p[1]; y = +p[2];
  } else {
    const p = s.slice(0, 10).split('-'); // « aaaa-mm-jj » (ignore l'heure)
    if (p.length !== 3) return null;
    y = +p[0]; m = +p[1]; d = +p[2];
  }
  if (![y, m, d].every(Number.isFinite)) return null;
  const date = new Date(y, m - 1, d);
  // rejette les valeurs hors-bornes (ex. 32/13) qui « débordent » silencieusement
  if (Number.isNaN(date.getTime()) ||
      date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

function daysLeft(deadline) {
  const d = parseDeadline(deadline);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((d - today) / 86400000);
}

function cmp(a, b, key) {
  if (key === 'days') {
    const da = daysLeft(a.deadline), db = daysLeft(b.deadline);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  }
  let va = a[key], vb = b[key];
  if (key === 'priority' || key === 'quantity' || key === 'project_value') {
    va = va == null ? -Infinity : Number(va);
    vb = vb == null ? -Infinity : Number(vb);
    return va - vb;
  }
  va = (va ?? '').toString().toLowerCase();
  vb = (vb ?? '').toString().toLowerCase();
  return va < vb ? -1 : va > vb ? 1 : 0;
}

// --- Rendu grille ----------------------------------------------------------
function renderRows(data) {
  $rows.innerHTML = '';
  $empty.hidden = data.length > 0;
  for (const r of data) $rows.appendChild(buildRow(r));
  updateSortArrows();
}

// Une ligne est un « brouillon d'ajout » tant qu'aucun champ de contenu n'est
// renseigné : on l'affiche alors comme un formulaire, pas comme une donnée.
function isDraftRow(r) {
  const fields = ['billing_company', 'contact_referent', 'quantity', 'product',
    'project_value', 'description', 'deadline', 'status'];
  return fields.every((k) => r[k] === null || r[k] === undefined || r[k] === '');
}

function buildRow(r) {
  const tr = document.createElement('tr');
  tr.dataset.id = r.id;
  const draft = isDraftRow(r);
  if (draft) tr.classList.add('is-draft');

  // début de ligne : poignée draggable (ou bouton « + Ajouter » si brouillon)
  // + icône contact discret (téléphone / email), sans modifier le reste.
  const tdHandle = document.createElement('td');
  tdHandle.className = 'col-handle';
  const handleCell = document.createElement('div');
  handleCell.className = 'handle-cell';
  if (draft) {
    const add = document.createElement('button');
    add.className = 'add-btn';
    add.type = 'button';
    add.title = 'Ajouter — remplir cette ligne';
    add.setAttribute('aria-label', 'Ajouter une commande');
    add.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
    add.addEventListener('click', () => {
      const first = tr.querySelector('.col-company input');
      if (first) first.focus();
    });
    handleCell.appendChild(add);
  } else {
    const grip = document.createElement('div');
    grip.className = 'handle';
    grip.title = 'glisser pour déplacer';
    grip.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.4"/><circle cx="11" cy="3" r="1.4"/><circle cx="5" cy="8" r="1.4"/><circle cx="11" cy="8" r="1.4"/><circle cx="5" cy="13" r="1.4"/><circle cx="11" cy="13" r="1.4"/></svg>';
    handleCell.appendChild(grip);
    attachDrag(grip, tr, r);
  }
  handleCell.appendChild(contactButton(r));
  tdHandle.appendChild(handleCell);
  tr.appendChild(tdHandle);

  // priorité (étoiles)
  tr.appendChild(cellStars(r));
  // type
  tr.appendChild(cellType(r));
  // société
  tr.appendChild(cellText(r, 'billing_company', 'société'));
  // référent
  tr.appendChild(cellText(r, 'contact_referent', 'référent'));
  // quantité
  tr.appendChild(cellNumber(r, 'quantity', 'qté'));
  // produits
  tr.appendChild(cellText(r, 'product', 'produits'));
  // valeur
  tr.appendChild(cellMoney(r, 'project_value'));
  // description
  tr.appendChild(cellText(r, 'description', 'description'));
  // échéance
  tr.appendChild(cellDate(r, 'deadline'));
  // jours restant (calculé)
  tr.appendChild(cellDays(r));
  // état
  tr.appendChild(cellStatus(r));
  // actions de fin de ligne : envoyer vers (Fiverr / Toptex) + dupliquer +
  // supprimer (révélées au survol)
  const tdDel = document.createElement('td');
  tdDel.className = 'col-del';
  if (!draft) {
    for (const t of SEND_TARGETS) {
      if (t.slug === r.stage) continue; // déjà dans cette catégorie
      const send = document.createElement('button');
      send.className = 'send-btn';
      send.type = 'button';
      send.title = `Envoyer vers ${t.label}`;
      send.setAttribute('aria-label', `Envoyer vers ${t.label}`);
      send.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13"/><path d="M13 6l6 6-6 6"/></svg><span>${escapeHtml(t.label)}</span>`;
      send.addEventListener('click', () => moveToStage(r, t.slug));
      tdDel.appendChild(send);
    }
  }
  const dup = document.createElement('button');
  dup.className = 'dup-btn';
  dup.type = 'button';
  dup.title = 'Dupliquer cette commande';
  dup.setAttribute('aria-label', 'Dupliquer cette commande');
  dup.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  dup.addEventListener('click', () => duplicateRow(r));
  const del = document.createElement('button');
  del.className = 'del-btn';
  del.type = 'button';
  del.title = 'Supprimer cette commande';
  del.setAttribute('aria-label', 'Supprimer cette commande');
  del.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  del.addEventListener('click', () => removeRow(r));
  tdDel.appendChild(dup);
  tdDel.appendChild(del);
  tr.appendChild(tdDel);

  return tr;
}

// --- Contact (téléphone / email) -------------------------------------------
// Stocké sur la commande, jamais affiché en clair dans la ligne : on l'expose
// via un petit icône (gris si vide, bleu si renseigné) ouvrant un popover.
function hasContact(r) {
  return !!((r.contact_phone && r.contact_phone !== '') || (r.contact_email && r.contact_email !== ''));
}

function contactButton(r) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'contact-btn' + (hasContact(r) ? ' has-contact' : '');
  btn.title = hasContact(r) ? 'Contact renseigné — voir / éditer' : 'Ajouter un contact (téléphone, email)';
  btn.setAttribute('aria-label', 'Contact');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5"/><circle cx="12" cy="11" r="2.4"/><path d="M8.5 17a3.5 3.5 0 0 1 7 0"/></svg>';
  btn.addEventListener('click', (e) => { e.stopPropagation(); openContactPopover(r, btn); });
  return btn;
}

let openContactPop = null;
function closeContactPopover(commit) {
  if (!openContactPop) return;
  const { pop, commitAll } = openContactPop;
  if (commit !== false) commitAll();
  pop.remove();
  document.removeEventListener('pointerdown', onContactDocDown, true);
  document.removeEventListener('keydown', onContactKey, true);
  openContactPop = null;
}
function onContactDocDown(e) {
  if (openContactPop && !openContactPop.pop.contains(e.target) && !e.target.closest('.contact-btn')) {
    closeContactPopover();
  }
}
function onContactKey(e) { if (e.key === 'Escape') closeContactPopover(false); }

function openContactPopover(r, anchor) {
  // re-clic sur le même bouton = fermeture
  if (openContactPop && openContactPop.id === r.id) { closeContactPopover(); return; }
  closeContactPopover();

  const pop = document.createElement('div');
  pop.className = 'contact-pop';
  pop.innerHTML = `
    <div class="cp-title">Contact</div>
    <label class="cp-field">Téléphone
      <input type="tel" class="cp-phone" placeholder="06 12 34 56 78" autocomplete="tel" />
    </label>
    <label class="cp-field">Email
      <input type="email" class="cp-email" placeholder="nom@exemple.fr" autocomplete="email" />
    </label>
    <div class="cp-err" hidden></div>`;
  const phone = pop.querySelector('.cp-phone');
  const email = pop.querySelector('.cp-email');
  const err = pop.querySelector('.cp-err');
  phone.value = r.contact_phone || '';
  email.value = r.contact_email || '';

  const save = (field, inputEl) => {
    const raw = inputEl.value.trim();
    const val = raw === '' ? null : raw;
    if (val === (r[field] || null)) return;
    const prev = r[field];
    r[field] = val;
    api('PATCH', `/api/requests/${r.id}`, { [field]: val })
      .then(() => {
        anchor.classList.toggle('has-contact', hasContact(r));
        anchor.title = hasContact(r) ? 'Contact renseigné — voir / éditer' : 'Ajouter un contact (téléphone, email)';
        err.hidden = true;
      })
      .catch((e2) => {
        r[field] = prev;
        err.textContent = e2.message || 'Erreur';
        err.hidden = false;
      });
  };
  const commitAll = () => { save('contact_phone', phone); save('contact_email', email); };

  phone.addEventListener('change', () => save('contact_phone', phone));
  email.addEventListener('change', () => save('contact_email', email));

  document.body.appendChild(pop);
  // positionnement sous l'icône, en restant dans la fenêtre
  const ar = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = ar.left;
  if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
  let top = ar.bottom + 6;
  if (top + pr.height > window.innerHeight - 8) top = ar.top - pr.height - 6;
  pop.style.left = Math.max(8, Math.round(left)) + 'px';
  pop.style.top = Math.max(8, Math.round(top)) + 'px';

  openContactPop = { id: r.id, pop, commitAll };
  setTimeout(() => {
    document.addEventListener('pointerdown', onContactDocDown, true);
    document.addEventListener('keydown', onContactKey, true);
  }, 0);
  phone.focus();
}

// --- Cellules ---------------------------------------------------------------
function cellStars(r) {
  const td = document.createElement('td');
  td.className = 'col-priority';
  const wrap = document.createElement('div');
  wrap.className = 'stars';
  for (let n = 1; n <= 3; n++) {
    const star = document.createElement('span');
    star.className = 'star' + (n <= r.priority ? ' on' : '');
    star.textContent = '★';
    star.title = `priorité ${n}`;
    star.addEventListener('click', () => patch(r, { priority: n }, () => {
      r.priority = n;
      [...wrap.children].forEach((s, i) => s.classList.toggle('on', i < n));
    }));
    wrap.appendChild(star);
  }
  td.appendChild(wrap);
  return td;
}

function cellType(r) {
  const td = document.createElement('td');
  td.className = 'col-type';
  const pill = document.createElement('span');
  const render = () => {
    pill.className = 'type-pill ' + (r.client_type === 'pro' ? 'pro' : 'perso');
    pill.textContent = r.client_type === 'pro' ? 'pro' : 'perso';
  };
  render();
  pill.title = 'cliquer pour basculer';
  pill.addEventListener('click', () => {
    const next = r.client_type === 'pro' ? 'perso' : 'pro';
    patch(r, { client_type: next }, () => { r.client_type = next; render(); });
  });
  td.appendChild(pill);
  return td;
}

function cellText(r, field, placeholder) {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.className = 'cell-input';
  input.type = 'text';
  input.value = r[field] ?? '';
  input.placeholder = placeholder;
  bindInline(input, r, field, (v) => v === '' ? null : v);
  td.appendChild(input);
  return td;
}

function cellNumber(r, field, placeholder) {
  const td = document.createElement('td');
  td.className = 'num';
  const input = document.createElement('input');
  input.className = 'cell-input num';
  input.type = 'number';
  input.value = r[field] ?? '';
  input.placeholder = placeholder;
  bindInline(input, r, field, (v) => v === '' ? null : parseInt(v, 10));
  td.appendChild(input);
  return td;
}

function cellMoney(r, field) {
  const td = document.createElement('td');
  td.className = 'num';
  const input = document.createElement('input');
  input.className = 'cell-input num';
  input.type = 'text';
  input.inputMode = 'decimal';
  const fmt = () => { input.value = r[field] != null ? formatMoney(r[field]) : ''; };
  fmt();
  input.classList.add('val-cell');
  input.placeholder = '—'; // valeur vide → tiret gris clair (cf. .val-cell::placeholder)
  input.addEventListener('focus', () => {
    input.value = r[field] != null ? String(r[field]) : '';
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  input.addEventListener('blur', () => {
    const raw = input.value.replace(/\s/g, '').replace(',', '.').replace('€', '');
    const val = raw === '' ? null : Number(raw);
    if (val !== null && Number.isNaN(val)) { fmt(); return; }
    if (val === r[field]) { fmt(); return; }
    const prev = r[field];
    r[field] = val;
    fmt();
    api('PATCH', `/api/requests/${r.id}`, { project_value: val }).catch((err) => {
      r[field] = prev; fmt(); reportError(err);
    });
  });
  td.appendChild(input);
  return td;
}

function cellDate(r, field) {
  const td = document.createElement('td');

  const commit = (input) => {
    const val = input.value === '' ? null : input.value;
    if (val === (r[field] || null)) return; // pas de changement
    const prev = r[field];
    r[field] = val;
    // re-render badge jours restant
    const td2 = td.closest('tr').querySelector('.col-days');
    if (td2) td2.replaceWith(cellDays(r));
    api('PATCH', `/api/requests/${r.id}`, { deadline: val }).catch((err) => {
      r[field] = prev; reportError(err);
    });
  };

  // Affichage « vide » : un simple tiret gris clair (pas de « jj/mm/aaaa »).
  const showDash = () => {
    td.innerHTML = '';
    const dash = document.createElement('span');
    dash.className = 'date-empty';
    dash.textContent = '—';
    dash.title = 'cliquer pour définir une échéance';
    dash.addEventListener('click', () => showInput(true));
    td.appendChild(dash);
  };

  // Affichage / édition via l'input date natif.
  const showInput = (openPicker) => {
    td.innerHTML = '';
    const input = document.createElement('input');
    input.className = 'cell-input';
    input.type = 'date';
    input.value = r[field] ? r[field].slice(0, 10) : '';
    input.addEventListener('change', () => commit(input));
    input.addEventListener('blur', () => {
      commit(input);
      if (!input.value) showDash(); // revient au tiret si laissé vide
    });
    td.appendChild(input);
    if (openPicker) {
      input.focus();
      if (typeof input.showPicker === 'function') { try { input.showPicker(); } catch (_) {} }
    }
  };

  if (r[field]) showInput(false);
  else showDash();
  return td;
}

function cellDays(r) {
  const td = document.createElement('td');
  td.className = 'col-days';
  const d = daysLeft(r.deadline);
  const badge = document.createElement('span');
  if (d === null) {
    badge.className = 'days-badge muted';
    badge.textContent = '—';
    td.appendChild(badge);
    return td;
  }
  let cls, label;
  if (d > 0) {
    cls = d <= 7 ? 'orange' : 'green';
    label = `${d} j`;
  } else if (d === 0) {
    cls = 'orange';
    label = "Aujourd'hui";
  } else {
    cls = 'red';
    label = `En retard de ${-d} j`;
  }
  badge.className = `days-badge ${cls}`;
  badge.textContent = label;
  td.appendChild(badge);
  return td;
}

const STATUS_CLASS = {
  'À traiter': 's-atraiter',
  'En attente client': 's-attente',
  'Validé': 's-valide',
  'Bloqué': 's-bloque',
  'Terminé': 's-termine',
};
const STATUS_OPTIONS = ['À traiter', 'En attente client', 'Validé', 'Bloqué', 'Terminé'];

function cellStatus(r) {
  const td = document.createElement('td');
  td.className = 'col-status';
  const pill = document.createElement('span');
  const render = () => {
    const val = r.status || '';
    pill.className = 'status-pill ' + (STATUS_CLASS[val] || '');
    pill.textContent = val || 'définir';
    if (!val) pill.classList.add('placeholder');
  };
  render();
  pill.title = 'cliquer pour choisir un état';
  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openStatusMenu) { closeStatusMenu(); return; }
    showStatusMenu(r, pill, render);
  });
  td.appendChild(pill);
  return td;
}

// Menu d'état : au clic, tous les choix apparaissent directement ; on sélectionne.
let openStatusMenu = null;
function closeStatusMenu() {
  if (!openStatusMenu) return;
  openStatusMenu.remove();
  openStatusMenu = null;
  document.removeEventListener('pointerdown', onStatusDocDown, true);
  document.removeEventListener('keydown', onStatusKey, true);
}
function onStatusDocDown(e) {
  if (openStatusMenu && !openStatusMenu.contains(e.target) && !e.target.closest('.status-pill')) closeStatusMenu();
}
function onStatusKey(e) { if (e.key === 'Escape') closeStatusMenu(); }

function setStatus(r, val, render) {
  const prev = r.status || null;
  if (val === prev) return;
  r.status = val;
  render();
  api('PATCH', `/api/requests/${r.id}`, { status: val }).catch((err) => {
    r.status = prev; render(); reportError(err);
  });
}

function showStatusMenu(r, pill, render) {
  closeStatusMenu();
  const menu = document.createElement('div');
  menu.className = 'status-menu';
  for (const opt of STATUS_OPTIONS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'status-menu-item' + (r.status === opt ? ' current' : '');
    const p = document.createElement('span');
    p.className = 'status-pill ' + STATUS_CLASS[opt];
    p.textContent = opt;
    item.appendChild(p);
    item.addEventListener('click', () => { setStatus(r, opt, render); closeStatusMenu(); });
    menu.appendChild(item);
  }
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'status-menu-item clear';
  clear.textContent = '— effacer —';
  clear.addEventListener('click', () => { setStatus(r, null, render); closeStatusMenu(); });
  menu.appendChild(clear);

  document.body.appendChild(menu);
  const pr = pill.getBoundingClientRect();
  const mr = menu.getBoundingClientRect();
  let top = pr.bottom + 4;
  if (top + mr.height > window.innerHeight - 8) top = pr.top - mr.height - 4;
  let left = pr.left;
  if (left + mr.width > window.innerWidth - 8) left = window.innerWidth - mr.width - 8;
  menu.style.top = Math.max(8, Math.round(top)) + 'px';
  menu.style.left = Math.max(8, Math.round(left)) + 'px';

  openStatusMenu = menu;
  setTimeout(() => {
    document.addEventListener('pointerdown', onStatusDocDown, true);
    document.addEventListener('keydown', onStatusKey, true);
  }, 0);
}

// --- Édition inline générique (texte/nombre) ------------------------------
function bindInline(input, r, field, transform) {
  let lastSent = r[field] ?? '';
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  input.addEventListener('blur', () => {
    const raw = input.value;
    if (raw === (lastSent ?? '').toString()) return;
    const val = transform(raw);
    if (val !== null && typeof val === 'number' && Number.isNaN(val)) {
      input.value = r[field] ?? ''; return;
    }
    const prev = r[field];
    r[field] = val;
    lastSent = raw;
    api('PATCH', `/api/requests/${r.id}`, { [field]: val }).catch((err) => {
      r[field] = prev; input.value = prev ?? ''; lastSent = prev ?? ''; reportError(err);
    });
  });
}

// --- PATCH générique optimiste --------------------------------------------
function patch(r, body, applyOptimistic) {
  applyOptimistic();
  api('PATCH', `/api/requests/${r.id}`, body).catch((err) => {
    reportError(err);
    loadRows(); // resync en cas d'échec
  });
}

// --- Création --------------------------------------------------------------
$btnNew.addEventListener('click', async () => {
  try {
    const created = await api('POST', '/api/requests', { stage: currentStage });
    rows.push(created);
    applySortAndRender();
    await loadCounts();
    // focus première cellule éditable de la nouvelle ligne
    const tr = $rows.querySelector(`tr[data-id="${created.id}"]`);
    if (tr) {
      tr.scrollIntoView({ block: 'nearest' });
      const firstInput = tr.querySelector('.col-company input, .cell-input');
      if (firstInput) firstInput.focus();
    }
  } catch (err) { reportError(err); }
});

// --- Suppression -----------------------------------------------------------
async function removeRow(r) {
  if (!confirm('Supprimer cette commande définitivement ?')) return;
  try {
    await api('DELETE', `/api/requests/${r.id}`);
    rows = rows.filter((x) => x.id !== r.id);
    applySortAndRender();
    await loadCounts();
  } catch (err) { reportError(err); }
}

// Duplique une commande : crée une copie de tous ses champs (sans la position,
// recalculée en bas de l'étape). La copie reste dans la même étape.
async function duplicateRow(r) {
  const body = {
    stage: r.stage,
    priority: r.priority,
    client_type: r.client_type,
    billing_company: r.billing_company,
    contact_referent: r.contact_referent,
    contact_phone: r.contact_phone,
    contact_email: r.contact_email,
    quantity: r.quantity,
    product: r.product,
    project_value: r.project_value,
    description: r.description,
    deadline: r.deadline ? String(r.deadline).slice(0, 10) : null,
    status: r.status,
  };
  try {
    const created = await api('POST', '/api/requests', body);
    if (created.stage === currentStage) {
      rows.push(created);
      applySortAndRender();
      const tr = $rows.querySelector(`tr[data-id="${created.id}"]`);
      if (tr) tr.scrollIntoView({ block: 'nearest' });
    }
    await loadCounts();
  } catch (err) { reportError(err); }
}

// --- Glisser-déposer unifié souris + tactile (Pointer Events) --------------
// Fonctionne au doigt sur tablette : le DnD HTML5 ne se déclenche pas au tactile,
// on utilise donc les Pointer Events (souris, doigt et stylet unifiés).
let dragState = null;

function attachDrag(handle, tr, r) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    dragState = {
      id: r.id, r, tr, handle,
      startX: e.clientX, startY: e.clientY,
      pointerId: e.pointerId, active: false, ghost: null, grabDX: 0, grabDY: 0,
    };
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    // Écouteurs sur window (pas sur la poignée) : on reçoit ainsi tous les
    // pointermove/up quel que soit l'élément sous le curseur, même quand il a
    // quitté la poignée (survol de la sidebar) ou si la capture de pointeur est
    // perdue lors du re-parentage de la ligne pendant le réordonnancement.
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
  });
}

function beginDrag() {
  const { tr, r, startX, startY } = dragState;
  const rect = tr.getBoundingClientRect();
  dragState.active = true;
  dragState.grabDX = startX - rect.left;
  dragState.grabDY = startY - rect.top;
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = r.billing_company || r.product || 'commande';
  ghost.style.width = rect.width + 'px';
  document.body.appendChild(ghost);
  dragState.ghost = ghost;
  tr.classList.add('dragging');
  document.body.classList.add('dragging-active');
}

function onDragMove(e) {
  if (!dragState) return;
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  if (!dragState.active) {
    if (Math.hypot(dx, dy) < 8) return; // seuil avant de démarrer le drag
    beginDrag();
  }
  e.preventDefault();
  dragState.ghost.style.left = (e.clientX - dragState.grabDX) + 'px';
  dragState.ghost.style.top = (e.clientY - dragState.grabDY) + 'px';

  const el = document.elementFromPoint(e.clientX, e.clientY);
  document.querySelectorAll('.stage.drop-target').forEach((s) => s.classList.remove('drop-target'));
  const stageEl = el && el.closest ? el.closest('.stage') : null;
  if (stageEl) {
    if (stageEl.dataset.slug !== dragState.r.stage) stageEl.classList.add('drop-target');
  } else {
    // réordonnancement vertical dans la grille
    const after = getDragAfterElement($rows, e.clientY);
    if (after == null) $rows.appendChild(dragState.tr);
    else if (after !== dragState.tr) $rows.insertBefore(dragState.tr, after);
  }
  autoScroll(e.clientY);
}

async function onDragEnd(e) {
  if (!dragState) return;
  const ds = dragState;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragEnd);
  try { ds.handle.releasePointerCapture(ds.pointerId); } catch (_) {}

  if (!ds.active) { dragState = null; return; } // simple clic, pas un drag

  const el = document.elementFromPoint(e.clientX, e.clientY);
  const stageEl = el && el.closest ? el.closest('.stage') : null;

  if (ds.ghost) ds.ghost.remove();
  ds.tr.classList.remove('dragging');
  document.body.classList.remove('dragging-active');
  document.querySelectorAll('.stage.drop-target').forEach((s) => s.classList.remove('drop-target'));
  dragState = null;

  if (stageEl && stageEl.dataset.slug !== ds.r.stage) {
    await moveToStage(ds.r, stageEl.dataset.slug);
  } else {
    await commitReorder(ds.r);
  }
}

async function moveToStage(r, slug) {
  try {
    await api('PATCH', `/api/requests/${r.id}`, { stage: slug });
    rows = rows.filter((x) => x.id !== r.id);
    applySortAndRender();
    await loadCounts();
  } catch (err) { reportError(err); loadRows(); }
}

async function commitReorder(r) {
  const siblings = [...$rows.querySelectorAll('tr')];
  const idx = siblings.findIndex((el) => el.dataset.id === r.id);
  const posOf = (el) => el ? (rows.find((x) => x.id === el.dataset.id)?.position ?? null) : null;
  const pPrev = posOf(siblings[idx - 1]);
  const pNext = posOf(siblings[idx + 1]);
  let newPos;
  if (pPrev == null && pNext == null) newPos = 1000;
  else if (pPrev == null) newPos = pNext - 1000;
  else if (pNext == null) newPos = pPrev + 1000;
  else newPos = (pPrev + pNext) / 2;
  const prevPos = r.position;
  if (newPos === prevPos) return;
  r.position = newPos;
  try {
    await api('PATCH', `/api/requests/${r.id}`, { position: newPos });
    sort = { key: null, dir: 1 };
    rows.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    lastRowsSig = signature(rows);
  } catch (err) { r.position = prevPos; reportError(err); loadRows(); }
}

// Conservé pour compat : le dépôt sidebar est géré par elementFromPoint ci-dessus.
function attachDrop() { /* géré via Pointer Events */ }

// auto-scroll vertical quand le doigt approche des bords de la grille
function autoScroll(y) {
  const wrap = document.querySelector('.grid-wrap');
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const margin = 64;
  if (y < rect.top + margin) wrap.scrollTop -= 14;
  else if (y > rect.bottom - margin) wrap.scrollTop += 14;
}

function getDragAfterElement(container, y) {
  const els = [...container.querySelectorAll('tr:not(.dragging)')];
  return els.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

// --- Tri par en-têtes -------------------------------------------------------
document.querySelectorAll('th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (sort.key === key) sort.dir *= -1;
    else sort = { key, dir: 1 };
    applySortAndRender();
  });
});

function updateSortArrows() {
  document.querySelectorAll('th.sortable').forEach((th) => {
    const existing = th.querySelector('.arrow');
    if (existing) existing.remove();
    if (sort.key === th.dataset.sort) {
      const a = document.createElement('span');
      a.className = 'arrow';
      a.textContent = sort.dir === 1 ? '▲' : '▼';
      th.appendChild(a);
    }
  });
}

// --- Utilitaires -----------------------------------------------------------
function formatMoney(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '';
  const rounded = Number.isInteger(n) ? n : Math.round(n * 100) / 100;
  // séparateur de milliers + espace avant € = espace insécable (U+00A0), € après le montant
  const num = rounded.toLocaleString('fr-FR').replace(/[\s  ]/g, ' ');
  return num + ' €';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function reportError(err) {
  console.error(err);
  // signal discret et non bloquant
  const msg = (err && err.message) ? err.message : 'Erreur réseau';
  showToast(msg);
}

let toastTimer = null;
function showToast(text) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
      'background:#1d1d1f;color:#fff;padding:9px 16px;border-radius:8px;font-size:13px;' +
      'z-index:1000;opacity:0;transition:opacity .2s;pointer-events:none;';
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2600);
}

// --- Synchronisation temps réel (polling) ----------------------------------
// Re-synchronise compteurs + grille en arrière-plan, sans recharger la page et
// sans jamais écraser une saisie en cours. Permet à plusieurs personnes (ex.
// le patron depuis l'étranger) de voir les changements des autres en continu.
const POLL_MS = 8000; // filet de sécurité uniquement ; le temps réel passe par SSE
let lastRowsSig = '';

// Vrai si l'utilisateur est en train d'éditer / glisser → on ne touche pas à la grille.
function isInteracting() {
  if (dragState) return true;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) return true;
  return false;
}

function signature(list) {
  // signature compacte : détecte tout changement de contenu ou d'ordre
  return list.map((r) => `${r.id}:${r.updated_at}`).join('|') + '#' + list.length;
}

async function poll() {
  if (document.hidden) return; // onglet en arrière-plan : on économise
  try {
    await loadCounts(); // compteurs sidebar : toujours sûrs à rafraîchir
    if (isInteracting()) return; // ne pas perturber une saisie / un glisser
    const fresh = await api('GET', `/api/requests?stage=${encodeURIComponent(currentStage)}`);
    const sig = signature(fresh);
    if (sig !== lastRowsSig) {
      rows = fresh;
      lastRowsSig = sig;
      applySortAndRender();
    }
  } catch (_) { /* silencieux : on réessaiera au prochain cycle */ }
}

// Push instantané via SSE (Server-Sent Events) — comme Google Sheets : le
// serveur prévient le navigateur dès qu'une donnée change, refresh en ~150 ms.
let streamAlive = false;
let streamDebounce = null;

function onStreamChange() {
  // coalesce les rafales (plusieurs modifs quasi simultanées) en un seul refresh
  clearTimeout(streamDebounce);
  streamDebounce = setTimeout(poll, 120);
}

function connectStream() {
  try {
    const es = new EventSource('/api/stream');
    es.addEventListener('change', onStreamChange);
    es.onopen = () => { streamAlive = true; };
    es.onerror = () => { streamAlive = false; /* EventSource se reconnecte seul */ };
  } catch (_) { streamAlive = false; }
}

function startRealtime() {
  connectStream();
  // filet de sécurité : si le flux est coupé, on revient à un poll lent
  setInterval(() => { if (!streamAlive) poll(); }, POLL_MS);
  // rafraîchit immédiatement quand on revient sur l'onglet / réveille la tablette
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
}

// --- Recherche : palette de commandes (⌘K) ---------------------------------
const $searchTrigger = document.getElementById('searchTrigger');
const SEARCH_FIELDS = ['billing_company', 'contact_referent', 'product', 'description', 'contact_phone', 'contact_email'];

(function () {
  const kbd = document.getElementById('searchKbd');
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '') || /Mac/.test(navigator.userAgent || '');
  if (kbd) kbd.textContent = isMac ? '⌘K' : 'Ctrl K';
})();

function fold(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function highlightMatch(text, q) {
  const t = String(text == null ? '' : text);
  if (!q) return escapeHtml(t);
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return escapeHtml(t);
  return escapeHtml(t.slice(0, i)) + '<mark>' + escapeHtml(t.slice(i, i + q.length)) + '</mark>' + escapeHtml(t.slice(i + q.length));
}

let searchState = null;

function closeSearch() {
  if (!searchState) return;
  document.removeEventListener('keydown', onSearchKeydown, true);
  const bd = searchState.backdrop;
  bd.classList.remove('open');
  setTimeout(() => bd.remove(), 180);
  searchState = null;
}

async function openSearch() {
  if (searchState) { searchState.input.focus(); return; }
  const backdrop = document.createElement('div');
  backdrop.className = 'cmdk-backdrop';
  backdrop.innerHTML = `
    <div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="Recherche de commandes">
      <div class="cmdk-head">
        <svg class="cmdk-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <input class="cmdk-input" type="text" placeholder="Rechercher — société, référent, produit, contact…" autocomplete="off" autocapitalize="off" spellcheck="false" />
        <kbd class="cmdk-esc">Esc</kbd>
      </div>
      <div class="cmdk-list" role="listbox"></div>
      <div class="cmdk-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> naviguer</span>
        <span><kbd>↵</kbd> ouvrir</span>
        <span><kbd>esc</kbd> fermer</span>
        <span class="cmdk-count"></span>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const input = backdrop.querySelector('.cmdk-input');
  const list = backdrop.querySelector('.cmdk-list');
  const countEl = backdrop.querySelector('.cmdk-count');
  searchState = { backdrop, input, list, countEl, results: [], sel: 0, all: null };

  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) closeSearch(); });
  input.addEventListener('input', () => runSearch(input.value));
  document.addEventListener('keydown', onSearchKeydown, true);

  requestAnimationFrame(() => backdrop.classList.add('open'));
  input.focus();
  renderSearch('');

  try {
    const all = await api('GET', '/api/requests');
    if (searchState) { searchState.all = all; runSearch(input.value); }
  } catch (_) {
    if (searchState) searchState.list.innerHTML = '<div class="cmdk-empty">Erreur de chargement.</div>';
  }
}

function runSearch(qRaw) {
  if (!searchState) return;
  const q = (qRaw || '').trim();
  const all = searchState.all || [];
  let results = [];
  if (q) {
    const fq = fold(q);
    results = all.filter((r) => SEARCH_FIELDS.some((f) => fold(r[f]).includes(fq))).slice(0, 50);
  }
  searchState.results = results;
  searchState.sel = 0;
  renderSearch(q);
}

function renderSearch(q) {
  if (!searchState) return;
  const { list, countEl, results } = searchState;
  if (!q) {
    list.innerHTML = '<div class="cmdk-empty">Tapez pour rechercher dans toutes les étapes…</div>';
    countEl.textContent = '';
    return;
  }
  if (results.length === 0) {
    list.innerHTML = '<div class="cmdk-empty">Aucune commande trouvée.</div>';
    countEl.textContent = '0 résultat';
    return;
  }
  countEl.textContent = results.length + (results.length > 1 ? ' résultats' : ' résultat');
  list.innerHTML = results.map((r, i) => {
    const title = r.billing_company || r.product || r.contact_referent || '(sans nom)';
    const subParts = [];
    if (r.contact_referent && r.billing_company) subParts.push(highlightMatch(r.contact_referent, q));
    if (r.product) subParts.push(highlightMatch(r.product, q));
    if (r.contact_phone) subParts.push(highlightMatch(r.contact_phone, q));
    if (r.contact_email) subParts.push(highlightMatch(r.contact_email, q));
    const sub = subParts.slice(0, 3).join(' · ');
    return `<button class="cmdk-item${i === searchState.sel ? ' sel' : ''}" role="option" data-i="${i}">
      <span class="cmdk-item-body">
        <span class="cmdk-item-title">${highlightMatch(title, q)}</span>
        ${sub ? `<span class="cmdk-item-sub">${sub}</span>` : ''}
      </span>
      <span class="cmdk-badge">${escapeHtml(STAGE_LABEL[r.stage] || r.stage)}</span>
    </button>`;
  }).join('');
  [...list.querySelectorAll('.cmdk-item')].forEach((el) => {
    const i = +el.dataset.i;
    el.addEventListener('mousemove', () => setSel(i));
    el.addEventListener('click', () => openResult(searchState.results[i]));
  });
  scrollSelIntoView();
}

function setSel(i) {
  if (!searchState) return;
  searchState.sel = i;
  [...searchState.list.querySelectorAll('.cmdk-item')].forEach((el, idx) => el.classList.toggle('sel', idx === i));
}
function scrollSelIntoView() {
  if (!searchState) return;
  const el = searchState.list.querySelector('.cmdk-item.sel');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function onSearchKeydown(e) {
  if (!searchState) return;
  if (e.key === 'Escape') { e.preventDefault(); closeSearch(); return; }
  const n = searchState.results.length;
  if (e.key === 'ArrowDown') { e.preventDefault(); if (n) { searchState.sel = (searchState.sel + 1) % n; setSel(searchState.sel); scrollSelIntoView(); } }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) { searchState.sel = (searchState.sel - 1 + n) % n; setSel(searchState.sel); scrollSelIntoView(); } }
  else if (e.key === 'Enter') { e.preventDefault(); if (n) openResult(searchState.results[searchState.sel]); }
}

function openResult(r) {
  if (!r) return;
  const id = r.id, stage = r.stage;
  closeSearch();
  const flashRow = () => {
    const tr = $rows.querySelector(`tr[data-id="${id}"]`);
    if (!tr) return false;
    tr.scrollIntoView({ block: 'center' });
    tr.classList.remove('row-flash'); void tr.offsetWidth; tr.classList.add('row-flash');
    setTimeout(() => tr.classList.remove('row-flash'), 1700);
    return true;
  };
  if (stage === currentStage) {
    flashRow();
  } else {
    selectStage(stage);
    let tries = 0;
    const tick = () => { if (flashRow()) return; if (tries++ < 25) setTimeout(tick, 80); };
    setTimeout(tick, 120);
  }
}

if ($searchTrigger) $searchTrigger.addEventListener('click', openSearch);
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openSearch(); }
});

// --- Init ------------------------------------------------------------------
async function start() {
  renderSidebar();
  await loadCounts();
  $stageTitle.textContent = STAGE_LABEL[currentStage];
  updateStageLink(currentStage);
  await loadRows();
  lastRowsSig = signature(rows);
  startRealtime();
}

start().catch(reportError);
