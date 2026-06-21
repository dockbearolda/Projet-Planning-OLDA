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
// Mini-titres des 3 blocs de la barre latérale (même ordre que STAGE_GROUPS).
const GROUP_TITLES = ['Pipeline', 'Production', 'Admin'];
const STAGES = STAGE_GROUPS.flat();
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.slug, s.label]));
STAGE_LABEL.production = 'Production'; // phase interne (vue via les secteurs)

// Secteurs de production : les 6 lignes « Prod … » du bloc du milieu. Une commande
// en production en porte 1..N (table production_sectors côté serveur).
const SECTOR_SLUGS = ['prod_dtf', 'prod_pressage', 'prod_trotec', 'prod_roland_uv', 'prod_sous_traitance', 'prod_autre'];
const isSector = (slug) => SECTOR_SLUGS.includes(slug);
// Libellé court pour les pastilles (« Prod Trotec » → « Trotec »).
const sectorShort = (slug) => (STAGE_LABEL[slug] || slug).replace(/^Prod\s+/, '');

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
let gridQuery = '';            // texte du filtre de recherche live (étape courante)
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

// --- Outil de devis logo Fiverr -------------------------------------------
// Reprend la feuille de calcul : on saisit le prix du graphiste Fiverr EN DOLLARS
// (B) et on lit le prix de revente OLDA EN EUROS (J), arrondi à l'euro supérieur.
//   J = (B$ × 1,055 + 3,5) × 0,87 × 2,5
// Le 0,87 (colonne G) est la conversion dollar → euro (1 $ ≈ 0,87 €) : la sortie
// est donc bien en euros.
const FIVERR_FEE_PCT = 0.055; // commission Fiverr +5,5 % (colonne D)
const FIVERR_FIXED = 3.5;     // frais fixe (colonne C)
const USD_TO_EUR = 0.87;      // conversion dollar → euro (colonne G)
const OLDA_MARGIN = 2.5;      // marge de revente (colonne I)

const $fiverrTool = document.getElementById('fiverrTool');
const $fiverrCost = document.getElementById('fiverrCost');
const $fiverrPrice = document.getElementById('fiverrPrice');

// Recalcule le prix client à partir du champ de saisie.
function updateFiverrPrice() {
  if (!$fiverrCost || !$fiverrPrice) return;
  const cost = parseFloat($fiverrCost.value.replace(',', '.').trim());
  if (!Number.isFinite(cost) || cost < 0) {
    $fiverrPrice.textContent = '—';
    return;
  }
  // cost = prix graphiste en $ ; USD_TO_EUR convertit en €. Résultat en euros.
  const resale = Math.ceil((cost * (1 + FIVERR_FEE_PCT) + FIVERR_FIXED) * USD_TO_EUR * OLDA_MARGIN);
  $fiverrPrice.textContent = `${resale} €`;
}

// Affiche l'outil uniquement sur l'onglet Fiverr et place le focus sur la saisie.
function updateFiverrTool(slug) {
  if (!$fiverrTool) return;
  const show = slug === 'maquette_fiverr';
  $fiverrTool.hidden = !show;
  if (show) {
    updateFiverrPrice();
    requestAnimationFrame(() => $fiverrCost && $fiverrCost.focus());
  }
}

if ($fiverrCost) $fiverrCost.addEventListener('input', updateFiverrPrice);

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
    const title = document.createElement('div');
    title.className = 'stage-group-title';
    title.textContent = GROUP_TITLES[gi] || '';
    $stages.appendChild(title);
    group.forEach((s) => {
      const el = document.createElement('div');
      el.className = 'stage' + (s.slug === currentStage ? ' active' : '');
      el.dataset.slug = s.slug;
      const n = counts[s.slug] ?? 0;
      if (n === 0) el.classList.add('is-empty');
      el.innerHTML = `<span class="stage-label">${escapeHtml(s.label)}</span>` +
        `<span class="stage-count${n > 0 ? ' has-items' : ''}">${n}</span>`;
      el.addEventListener('click', () => selectStage(s.slug));
      attachDrop(el, s.slug);
      $stages.appendChild(el);
    });
  });
}

function selectStage(slug) {
  currentStage = slug;
  sort = { key: null, dir: 1 };
  $stageTitle.textContent = STAGE_LABEL[slug];
  updateStageLink(slug);
  updateFiverrTool(slug);
  applyColWidths();
  document.querySelectorAll('.stage').forEach((el) => {
    el.classList.toggle('active', el.dataset.slug === slug);
  });
  loadRows();
}

// --- Chargement données ----------------------------------------------------
async function loadCounts() {
  counts = await api('GET', '/api/counts');
  document.querySelectorAll('.stage').forEach((el) => {
    const n = counts[el.dataset.slug] ?? 0;
    const c = el.querySelector('.stage-count');
    if (c) {
      c.textContent = n;
      c.classList.toggle('has-items', n > 0);
    }
    el.classList.toggle('is-empty', n === 0);
  });
}

async function loadRows() {
  rows = await api('GET', `/api/requests?stage=${encodeURIComponent(currentStage)}`);
  lastRowsSig = signature(rows);
  applySortAndRender();
}

// --- Tri -------------------------------------------------------------------
function applySortAndRender() {
  const sorted = [...rows];
  if (sort.key) {
    sorted.sort((a, b) => cmp(a, b, sort.key) * sort.dir);
  } else {
    // tri par défaut : les commandes urgentes (échéance dans ≤ 1 jour, aujourd'hui
    // ou déjà dépassée) remontent en tête, la plus urgente d'abord ; le reste suit
    // le tri priorité décroissante puis échéance la plus proche.
    sorted.sort((a, b) => {
      const ua = urgentDaysLeft(a), ub = urgentDaysLeft(b);
      if ((ua !== null) !== (ub !== null)) return ua !== null ? -1 : 1;
      if (ua !== null && ub !== null) return ua - ub;
      if (b.priority !== a.priority) return b.priority - a.priority;
      return cmpDeadline(a.deadline, b.deadline);
    });
  }
  // Filtre de recherche live : on garde toujours la ligne brouillon (ajout).
  const q = fold(gridQuery.trim());
  const data = q
    ? sorted.filter((r) => isDraftRow(r) || SEARCH_FIELDS.some((f) => fold(r[f]).includes(q)))
    : sorted;
  renderRows(data);
  const nMaq = data.filter((r) => MAQUETTE_STATUSES.includes(r.status)).length;
  const base = data.length ? `${data.length} commande${data.length > 1 ? 's' : ''}` : '';
  $stageCount.innerHTML = base
    ? escapeHtml(base) + (nMaq ? ` <span class="maq-count">· ${nMaq} maquette${nMaq > 1 ? 's' : ''}</span>` : '')
    : '';
}

function cmpDeadline(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// Une commande devient « urgente » quand il lui reste 1 jour ou moins avant
// l'échéance (aujourd'hui ou déjà dépassée comprises) : elle remonte alors en
// tête de liste. Renvoie le nombre de jours restants si urgente, sinon null.
const URGENT_DAYS = 1;
function urgentDaysLeft(r) {
  const d = daysLeft(r.deadline);
  return (d !== null && d <= URGENT_DAYS) ? d : null;
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
  if (data.length === 0) {
    $empty.textContent = gridQuery.trim()
      ? 'Aucune commande ne correspond à la recherche.'
      : 'Aucune commande à cette étape.';
  }
  for (const r of data) $rows.appendChild(buildRow(r));
  applyEmptyCols(data);
  updateSortArrows();
}

// Prix et Échéance restent TOUJOURS affichés. Seule la Quantité est masquée
// quand aucune commande réelle de la vue ne la renseigne (et qu'aucune ligne
// brouillon n'est présente, sinon son champ de saisie serait inaccessible).
function applyEmptyCols(data) {
  const hasDraft = data.some(isDraftRow);
  const hasQty = hasDraft ||
    data.some((r) => !isDraftRow(r) && r.quantity !== null && r.quantity !== undefined && r.quantity !== '');
  $grid.classList.toggle('hide-quantity', !hasQty);
  $grid.classList.remove('hide-value', 'hide-deadline');
  // Les largeurs manuelles dépendent des colonnes visibles : on recalcule.
  applyColWidths();
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
      const first = tr.querySelector('.client-company');
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
  handleCell.appendChild(attachButton(r));
  tdHandle.appendChild(handleCell);
  tr.appendChild(tdHandle);

  // priorité (3 niveaux codés couleur)
  tr.appendChild(cellPriority(r));
  // client : société (info principale) + référent + type pro/perso fusionnés
  tr.appendChild(cellClient(r));
  // produit (nom + description fusionnés sur deux lignes)
  tr.appendChild(cellProduct(r));
  // quantité (masquée si la colonne est vide sur la vue)
  tr.appendChild(cellNumber(r, 'quantity', 'qté'));
  // valeur (masquée si la colonne est vide sur la vue)
  tr.appendChild(cellMoney(r, 'project_value'));
  // échéance : badge relatif coloré (« En retard 1j », « 4j »), éditable au clic
  tr.appendChild(cellDeadline(r));
  // état : signal principal, aligné à droite
  tr.appendChild(cellStatus(r));
  // actions de fin de ligne : envoyer vers (Fiverr / Toptex) + dupliquer +
  // supprimer (révélées au survol)
  const tdDel = document.createElement('td');
  tdDel.className = 'col-del';
  tdDel.appendChild(voiceButton(r));
  if (!draft) {
    for (const t of SEND_TARGETS) {
      if (t.slug === r.stage) continue; // déjà dans cette catégorie
      const send = document.createElement('button');
      send.className = 'send-btn';
      send.type = 'button';
      send.title = `Envoyer vers ${t.label}`;
      send.setAttribute('aria-label', `Envoyer vers ${t.label}`);
      send.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13"/><path d="M13 6l6 6-6 6"/></svg><span>${escapeHtml(t.label)}</span>`;
      send.addEventListener('click', () => copyToStage(r, t.slug));
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

// --- Pièces jointes PDF (Devis / BAT) --------------------------------------
// Deux emplacements fixes par commande. Le PDF est consultable à tout moment
// (ouverture inline dans un nouvel onglet). Géré via un petit icône « trombone »
// par ligne, gris si vide, bleu si au moins un PDF présent.
const PDF_SLOTS = [
  { kind: 'devis', label: 'Devis' },
  { kind: 'bat', label: 'BAT' },
];

function attachCount(r) {
  return (r.devis_name ? 1 : 0) + (r.bat_name ? 1 : 0);
}

function attachButton(r) {
  const btn = document.createElement('button');
  btn.type = 'button';
  const n = attachCount(r);
  btn.className = 'attach-btn' + (n > 0 ? ' has-attach' : '');
  btn.title = n ? `${n} PDF joint${n > 1 ? 's' : ''} — voir / gérer` : 'Joindre des PDF (Devis, BAT)';
  btn.setAttribute('aria-label', 'Pièces jointes PDF');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.07-7.07l8.6-8.6a3.34 3.34 0 0 1 4.72 4.72l-8.6 8.6a1.67 1.67 0 0 1-2.36-2.36l7.9-7.9"/></svg>';
  if (n > 0) {
    const dot = document.createElement('span');
    dot.className = 'attach-count';
    dot.textContent = n;
    btn.appendChild(dot);
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); openAttachPopover(r, btn); });
  return btn;
}

let openAttachPop = null;
function closeAttachPopover() {
  if (!openAttachPop) return;
  openAttachPop.pop.remove();
  document.removeEventListener('pointerdown', onAttachDocDown, true);
  document.removeEventListener('keydown', onAttachKey, true);
  openAttachPop = null;
}
function onAttachDocDown(e) {
  if (openAttachPop && !openAttachPop.pop.contains(e.target) && !e.target.closest('.attach-btn')) {
    closeAttachPopover();
  }
}
function onAttachKey(e) { if (e.key === 'Escape') closeAttachPopover(); }

// Met à jour l'icône d'ancrage (couleur + badge) après un changement de PDF.
function refreshAttachAnchor(r, anchor) {
  const n = attachCount(r);
  anchor.classList.toggle('has-attach', n > 0);
  anchor.title = n ? `${n} PDF joint${n > 1 ? 's' : ''} — voir / gérer` : 'Joindre des PDF (Devis, BAT)';
  const existing = anchor.querySelector('.attach-count');
  if (existing) existing.remove();
  if (n > 0) {
    const dot = document.createElement('span');
    dot.className = 'attach-count';
    dot.textContent = n;
    anchor.appendChild(dot);
  }
}

// Construit la ligne d'un emplacement PDF. Se reconstruit après upload/suppression.
function attachSlot(r, slot, anchor) {
  const row = document.createElement('div');
  row.className = 'ap-slot';
  const nameKey = `${slot.kind}_name`;

  const lbl = document.createElement('div');
  lbl.className = 'ap-slot-label';
  lbl.textContent = slot.label;
  row.appendChild(lbl);

  const body = document.createElement('div');
  body.className = 'ap-slot-body';
  row.appendChild(body);

  const rerender = () => row.replaceWith(attachSlot(r, slot, anchor));

  const pickFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.addEventListener('change', () => uploadPdf(input.files && input.files[0]));
    input.click();
  };

  const uploadPdf = (file) => {
    if (!file) return;
    if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      reportError(new Error('Seuls les fichiers PDF sont acceptés.'));
      return;
    }
    body.innerHTML = '<span class="ap-progress">Envoi…</span>';
    fetch(`/api/requests/${r.id}/pdf/${slot.kind}?name=${encodeURIComponent(file.name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: file,
    })
      .then(async (res) => {
        if (!res.ok) {
          let d = res.statusText;
          try { d = (await res.json()).error || d; } catch (_) {}
          throw new Error(d);
        }
        return res.json();
      })
      .then((meta) => {
        r[nameKey] = meta.filename;
        const live = rows.find((x) => x.id === r.id);
        if (live && live !== r) live[nameKey] = meta.filename;
        refreshAttachAnchor(r, anchor);
        rerender();
      })
      .catch((err) => { reportError(err); rerender(); });
  };

  if (r[nameKey]) {
    const file = document.createElement('div');
    file.className = 'ap-file';
    file.textContent = r[nameKey];
    file.title = r[nameKey];
    body.appendChild(file);

    const actions = document.createElement('div');
    actions.className = 'ap-actions';

    const open = document.createElement('a');
    open.className = 'ap-act ap-open';
    open.href = `/api/requests/${r.id}/pdf/${slot.kind}`;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = 'Ouvrir';
    actions.appendChild(open);

    const replace = document.createElement('button');
    replace.type = 'button';
    replace.className = 'ap-act';
    replace.textContent = 'Remplacer';
    replace.addEventListener('click', pickFile);
    actions.appendChild(replace);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ap-act ap-del';
    del.textContent = 'Supprimer';
    del.addEventListener('click', () => {
      api('DELETE', `/api/requests/${r.id}/pdf/${slot.kind}`)
        .then(() => {
          r[nameKey] = null;
          const live = rows.find((x) => x.id === r.id);
          if (live && live !== r) live[nameKey] = null;
          refreshAttachAnchor(r, anchor);
          rerender();
        })
        .catch(reportError);
    });
    actions.appendChild(del);

    body.appendChild(actions);
  } else {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'ap-add';
    add.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg> Ajouter un PDF';
    add.addEventListener('click', pickFile);
    body.appendChild(add);
  }

  return row;
}

function openAttachPopover(r, anchor) {
  if (openAttachPop && openAttachPop.id === r.id) { closeAttachPopover(); return; }
  closeAttachPopover();

  const pop = document.createElement('div');
  pop.className = 'attach-pop';
  const title = document.createElement('div');
  title.className = 'ap-title';
  title.textContent = 'Pièces jointes';
  pop.appendChild(title);
  for (const slot of PDF_SLOTS) pop.appendChild(attachSlot(r, slot, anchor));

  document.body.appendChild(pop);
  const ar = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = ar.left;
  if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
  let top = ar.bottom + 6;
  if (top + pr.height > window.innerHeight - 8) top = ar.top - pr.height - 6;
  pop.style.left = Math.max(8, Math.round(left)) + 'px';
  pop.style.top = Math.max(8, Math.round(top)) + 'px';

  openAttachPop = { id: r.id, pop };
  setTimeout(() => {
    document.addEventListener('pointerdown', onAttachDocDown, true);
    document.addEventListener('keydown', onAttachKey, true);
  }, 0);
}

// --- Dictée vocale -----------------------------------------------------------
// Un micro par ligne (+ bouton global « Commande vocale ») : la voix est
// transcrite en direct par le navigateur (Web Speech API, fr-FR), le texte est
// envoyé à /api/voice/extract qui en déduit les champs (API Claude), puis
// l'utilisateur confirme avant remplissage de la ligne (PATCH classique → SSE).
const VOICE_FIELD_LABELS = {
  billing_company: 'Société',
  contact_referent: 'Référent',
  contact_phone: 'Téléphone',
  contact_email: 'Email',
  product: 'Produits',
  color: 'Couleur',
  quantity: 'Quantité',
  project_value: 'Valeur',
  deadline: 'Échéance',
  description: 'Description',
  client_type: 'Type',
};

const MIC_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v4"/></svg>';

function speechRecognitionClass() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function voiceButton(r) {
  const btn = document.createElement('button');
  btn.className = 'voice-btn';
  btn.type = 'button';
  btn.title = 'Dicter la commande — remplissage automatique';
  btn.setAttribute('aria-label', 'Dicter la commande');
  btn.innerHTML = MIC_SVG;
  btn.addEventListener('click', (e) => { e.stopPropagation(); openVoicePopover(r, btn); });
  return btn;
}

let openVoicePop = null;
function closeVoicePopover() {
  if (!openVoicePop) return;
  const s = openVoicePop;
  s.closed = true;
  if (s.rec) { try { s.rec.onend = null; s.rec.abort(); } catch (_) {} }
  s.pop.remove();
  document.removeEventListener('pointerdown', onVoiceDocDown, true);
  document.removeEventListener('keydown', onVoiceKey, true);
  openVoicePop = null;
}
function onVoiceDocDown(e) {
  if (openVoicePop && !openVoicePop.pop.contains(e.target) &&
      !e.target.closest('.voice-btn') && !e.target.closest('#btnVoice')) {
    closeVoicePopover();
  }
}
function onVoiceKey(e) { if (e.key === 'Escape') closeVoicePopover(); }

function positionVoicePop(pop, anchor) {
  const ar = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = ar.left;
  if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
  let top = ar.bottom + 6;
  if (top + pr.height > window.innerHeight - 8) top = ar.top - pr.height - 6;
  pop.style.left = Math.max(8, Math.round(left)) + 'px';
  pop.style.top = Math.max(8, Math.round(top)) + 'px';
}

function openVoicePopover(r, anchor) {
  if (openVoicePop && openVoicePop.id === r.id) { closeVoicePopover(); return; }
  closeVoicePopover();
  closeContactPopover(false);
  closeAttachPopover();

  const pop = document.createElement('div');
  pop.className = 'voice-pop';
  document.body.appendChild(pop);

  const s = { id: r.id, r, pop, anchor, rec: null, finalText: '', closed: false, stopping: false };
  openVoicePop = s;

  setTimeout(() => {
    document.addEventListener('pointerdown', onVoiceDocDown, true);
    document.addEventListener('keydown', onVoiceKey, true);
  }, 0);

  if (!speechRecognitionClass()) {
    renderVoiceError(s, "La dictée n'est pas disponible sur ce navigateur. Utilisez Chrome, Edge ou Safari.", false);
    return;
  }
  startListening(s);
}

function startListening(s) {
  s.finalText = '';
  s.stopping = false;
  renderVoiceListen(s);

  const SR = speechRecognitionClass();
  const rec = new SR();
  s.rec = rec;
  rec.lang = 'fr-FR';
  rec.continuous = true;
  rec.interimResults = true;

  rec.onresult = (e) => {
    if (s.closed) return;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) s.finalText += t + ' ';
      else interim += t;
    }
    updateVoiceTranscript(s, interim);
  };
  rec.onerror = (e) => {
    if (s.closed) return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      s.stopping = true;
      renderVoiceError(s, 'Accès au micro refusé. Autorisez le micro pour ce site dans le navigateur, puis réessayez.', true);
    }
    // 'no-speech' / 'aborted' : gérés par onend (relance automatique)
  };
  rec.onend = () => {
    if (s.closed) return;
    if (s.stopping) return; // arrêt volontaire : la suite est déjà déclenchée
    // certains navigateurs coupent après un silence : on relance la dictée
    try { rec.start(); } catch (_) {}
  };

  try { rec.start(); } catch (_) {
    renderVoiceError(s, 'Impossible de démarrer le micro.', true);
  }
}

function finishListening(s) {
  s.stopping = true;
  if (s.rec) { try { s.rec.stop(); } catch (_) {} }
  // courte latence pour laisser arriver le dernier segment finalisé
  setTimeout(() => { if (!s.closed) analyzeVoice(s); }, 350);
}

async function analyzeVoice(s) {
  const text = s.finalText.trim();
  if (!text) {
    renderVoiceError(s, "Je n'ai rien entendu. Parlez après l'ouverture du panneau, puis appuyez sur « Terminer ».", true);
    return;
  }
  renderVoiceAnalyze(s);
  try {
    const { fields } = await api('POST', '/api/voice/extract', { transcript: text });
    if (s.closed) return;
    const entries = Object.entries(fields || {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
    if (!entries.length) {
      renderVoiceError(s, 'Aucune information de commande reconnue dans la dictée.', true);
      return;
    }
    renderVoiceConfirm(s, fields, entries);
  } catch (err) {
    if (s.closed) return;
    renderVoiceError(s, err.message || "L'analyse a échoué.", true);
  }
}

function voiceDisplayValue(key, v) {
  if (key === 'project_value') return formatMoney(v);
  if (key === 'deadline') {
    const d = parseDeadline(v);
    return d ? d.toLocaleDateString('fr-FR') : String(v);
  }
  return String(v);
}

async function applyVoiceFields(s, fields) {
  const r = s.r;
  const body = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined || v === '') continue; // jamais d'effacement
    if ((r[k] ?? null) === v) continue;
    body[k] = v;
  }
  if (Object.keys(body).length === 0) { closeVoicePopover(); return; }
  try {
    const updated = await api('PATCH', `/api/requests/${r.id}`, body);
    closeVoicePopover();
    const idx = rows.findIndex((x) => x.id === updated.id);
    if (idx >= 0) rows[idx] = Object.assign({}, rows[idx], updated);
    applySortAndRender();
    lastRowsSig = signature(rows);
    const tr = $rows.querySelector(`tr[data-id="${updated.id}"]`);
    if (tr) {
      tr.scrollIntoView({ block: 'nearest' });
      tr.classList.add('row-flash');
      setTimeout(() => tr.classList.remove('row-flash'), 1700);
    }
    showToast('Commande remplie depuis la dictée');
  } catch (err) { reportError(err); }
}

function renderVoiceListen(s) {
  s.pop.innerHTML = `
    <div class="vp-head">
      <span class="vp-dot" aria-hidden="true"></span>
      <span class="vp-title">Dictée en cours…</span>
    </div>
    <div class="vp-transcript"><span class="vp-placeholder">Parlez : société, contact, téléphone, produit, couleur, quantité, échéance…</span></div>
    <div class="vp-actions">
      <button type="button" class="vp-btn vp-cancel">Annuler</button>
      <button type="button" class="vp-btn vp-primary vp-done">Terminer</button>
    </div>`;
  s.pop.querySelector('.vp-cancel').addEventListener('click', () => closeVoicePopover());
  s.pop.querySelector('.vp-done').addEventListener('click', () => finishListening(s));
  positionVoicePop(s.pop, s.anchor);
}

function updateVoiceTranscript(s, interim) {
  const box = s.pop.querySelector('.vp-transcript');
  if (!box) return;
  const fin = escapeHtml(s.finalText);
  const int = escapeHtml(interim || '');
  box.innerHTML = (fin || int)
    ? `${fin}<span class="vp-interim">${int}</span>`
    : '<span class="vp-placeholder">…</span>';
  box.scrollTop = box.scrollHeight;
}

function renderVoiceAnalyze(s) {
  s.pop.innerHTML = `
    <div class="vp-head">
      <span class="vp-spinner" aria-hidden="true"></span>
      <span class="vp-title">Analyse de la commande…</span>
    </div>`;
  positionVoicePop(s.pop, s.anchor);
}

function renderVoiceConfirm(s, fields, entries) {
  const rowsHtml = entries.map(([k, v]) => `
    <div class="vp-field">
      <span class="vp-field-label">${escapeHtml(VOICE_FIELD_LABELS[k] || k)}</span>
      <span class="vp-field-value">${escapeHtml(voiceDisplayValue(k, v))}</span>
    </div>`).join('');
  s.pop.innerHTML = `
    <div class="vp-head">
      <span class="vp-title">Vérifiez avant d'appliquer</span>
    </div>
    <div class="vp-fields">${rowsHtml}</div>
    <div class="vp-actions">
      <button type="button" class="vp-btn vp-cancel">Annuler</button>
      <button type="button" class="vp-btn vp-redo">↻ Re-dicter</button>
      <button type="button" class="vp-btn vp-primary vp-apply">✓ Appliquer</button>
    </div>`;
  s.pop.querySelector('.vp-cancel').addEventListener('click', () => closeVoicePopover());
  s.pop.querySelector('.vp-redo').addEventListener('click', () => startListening(s));
  s.pop.querySelector('.vp-apply').addEventListener('click', () => applyVoiceFields(s, fields));
  positionVoicePop(s.pop, s.anchor);
}

function renderVoiceError(s, msg, retry) {
  s.pop.innerHTML = `
    <div class="vp-head error">
      <span class="vp-title">Dictée vocale</span>
    </div>
    <div class="vp-msg">${escapeHtml(msg)}</div>
    <div class="vp-actions">
      <button type="button" class="vp-btn vp-cancel">Fermer</button>
      ${retry ? '<button type="button" class="vp-btn vp-primary vp-retry">Réessayer</button>' : ''}
    </div>`;
  s.pop.querySelector('.vp-cancel').addEventListener('click', () => closeVoicePopover());
  const r2 = s.pop.querySelector('.vp-retry');
  if (r2) r2.addEventListener('click', () => startListening(s));
  positionVoicePop(s.pop, s.anchor);
}

// --- Cellules ---------------------------------------------------------------
// Priorité : 3 niveaux clairs codés couleur (basse → moyenne → haute).
// Une seule pastille tactile ; un clic fait défiler les niveaux 1 → 2 → 3 → 1.
const PRIORITY_LEVELS = {
  1: { cls: 'p1', label: 'Basse' },
  2: { cls: 'p2', label: 'Moyenne' },
  3: { cls: 'p3', label: 'Haute' },
};

function cellPriority(r) {
  const td = document.createElement('td');
  td.className = 'col-priority';
  const pill = document.createElement('button');
  pill.type = 'button';
  const render = () => {
    const lvl = PRIORITY_LEVELS[r.priority] || PRIORITY_LEVELS[1];
    pill.className = 'prio-pill ' + lvl.cls;
    pill.innerHTML = `<span class="prio-dot" aria-hidden="true"></span><span>${lvl.label}</span>`;
    pill.title = `Priorité ${lvl.label.toLowerCase()} — cliquer pour changer`;
    pill.setAttribute('aria-label', `Priorité ${lvl.label}`);
  };
  render();
  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = (r.priority % 3) + 1; // 1 → 2 → 3 → 1
    patch(r, { priority: next }, () => { r.priority = next; render(); });
  });
  td.appendChild(pill);
  return td;
}

// Client : société (info principale, en gras) + sous-ligne discrète référent +
// bascule pro/perso. Fusionne les anciennes colonnes Type / Société / Référent.
function cellClient(r) {
  const td = document.createElement('td');
  td.className = 'col-client-cell';
  const stack = document.createElement('div');
  stack.className = 'client-stack';

  const company = document.createElement('input');
  company.className = 'cell-input client-company';
  company.type = 'text';
  company.value = r.billing_company ?? '';
  company.placeholder = 'société';
  bindInline(company, r, 'billing_company', (v) => v === '' ? null : v);

  const sub = document.createElement('div');
  sub.className = 'client-sub';

  const type = document.createElement('button');
  type.type = 'button';
  const renderType = () => {
    type.className = 'type-tag ' + (r.client_type === 'pro' ? 'pro' : 'perso');
    type.textContent = r.client_type === 'pro' ? 'Pro' : 'Perso';
  };
  renderType();
  type.title = 'cliquer pour basculer pro / perso';
  type.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = r.client_type === 'pro' ? 'perso' : 'pro';
    patch(r, { client_type: next }, () => { r.client_type = next; renderType(); });
  });

  const ref = document.createElement('input');
  ref.className = 'cell-input client-ref';
  ref.type = 'text';
  ref.value = r.contact_referent ?? '';
  ref.placeholder = 'référent';
  bindInline(ref, r, 'contact_referent', (v) => v === '' ? null : v);

  sub.appendChild(type);
  sub.appendChild(ref);
  stack.appendChild(company);
  stack.appendChild(sub);
  td.appendChild(stack);
  return td;
}

// Produit : nom (gras, 1re ligne) + description (texte secondaire gris en
// dessous). Les deux restent éditables en ligne. La description disparaît au
// repos quand elle est vide, et réapparaît au survol / focus de la cellule —
// même idiome que les actions « révélées au survol » ailleurs dans la grille.
function cellProduct(r) {
  const td = document.createElement('td');
  td.className = 'col-product-cell';
  const stack = document.createElement('div');
  stack.className = 'product-stack';

  const name = document.createElement('input');
  name.className = 'cell-input product-name';
  name.type = 'text';
  name.value = r.product ?? '';
  name.placeholder = 'produit';
  bindInline(name, r, 'product', (v) => v === '' ? null : v);

  const desc = document.createElement('input');
  desc.className = 'cell-input product-desc';
  desc.type = 'text';
  desc.value = r.description ?? '';
  desc.placeholder = 'description';
  const syncEmpty = () => stack.classList.toggle('desc-empty', desc.value.trim() === '');
  syncEmpty();
  desc.addEventListener('input', syncEmpty);
  bindInline(desc, r, 'description', (v) => v === '' ? null : v);

  stack.appendChild(name);
  stack.appendChild(desc);
  td.appendChild(stack);
  return td;
}

function cellNumber(r, field, placeholder) {
  const td = document.createElement('td');
  td.className = 'num' + (field === 'quantity' ? ' col-qty' : '');
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
  td.className = 'num col-value';
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

// Échéance fusionnée : un seul badge relatif et coloré (« En retard 1j », « 4j »,
// « Aujourd'hui »). Au repos = badge ; au clic = sélecteur de date natif.
function cellDeadline(r) {
  const td = document.createElement('td');
  td.className = 'col-deadline-cell';

  // Enregistre la nouvelle échéance (optimiste) puis re-rend le badge.
  const setDeadline = (val) => {
    if (val === (r.deadline || null)) return;
    const prev = r.deadline;
    r.deadline = val;
    showBadge();
    api('PATCH', `/api/requests/${r.id}`, { deadline: val }).catch((err) => {
      r.deadline = prev; showBadge(); reportError(err);
    });
  };

  function showBadge() {
    td.innerHTML = '';
    const badge = document.createElement('button');
    badge.type = 'button';
    const d = daysLeft(r.deadline);
    if (r.deadline == null || d === null) {
      badge.className = 'deadline-badge empty';
      badge.textContent = '+ échéance';
      badge.title = 'cliquer pour choisir une date';
    } else {
      let cls, label;
      if (d > 0) { cls = d <= 7 ? 'orange' : 'green'; label = `${d} j`; }
      else if (d === 0) { cls = 'orange'; label = "Aujourd'hui"; }
      else { cls = 'red'; label = `En retard ${-d} j`; }
      badge.className = `deadline-badge ${cls}`;
      badge.textContent = label;
      const dd = parseDeadline(r.deadline);
      badge.title = (dd ? dd.toLocaleDateString('fr-FR') : '') + ' — cliquer pour modifier';
    }
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openCalendar) { closeCalendar(); return; }
      showDeadlineCalendar(r, badge, setDeadline);
    });
    td.appendChild(badge);
  }

  showBadge();
  return td;
}

// --- Calendrier d'échéance (popup mois complet) ----------------------------
// Au clic sur le badge échéance, on ouvre un vrai calendrier (grille du mois)
// pour choisir la date — même idiome de popup que le menu d'état.
const CAL_MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const CAL_DOW = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

let openCalendar = null;
function closeCalendar() {
  if (!openCalendar) return;
  openCalendar.remove();
  openCalendar = null;
  document.removeEventListener('pointerdown', onCalDocDown, true);
  document.removeEventListener('keydown', onCalKey, true);
}
function onCalDocDown(e) {
  if (openCalendar && !openCalendar.contains(e.target) && !e.target.closest('.deadline-badge')) closeCalendar();
}
function onCalKey(e) { if (e.key === 'Escape') closeCalendar(); }

function showDeadlineCalendar(r, anchor, onPick) {
  closeCalendar();
  const sel = parseDeadline(r.deadline);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let viewY = sel ? sel.getFullYear() : today.getFullYear();
  let viewM = sel ? sel.getMonth() : today.getMonth();

  const cal = document.createElement('div');
  cal.className = 'cal-pop';

  const build = () => {
    cal.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'cal-head';
    const mkNav = (label, aria, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cal-nav'; b.textContent = label;
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); build(); });
      return b;
    };
    const title = document.createElement('span');
    title.className = 'cal-title';
    title.textContent = `${CAL_MONTHS[viewM]} ${viewY}`;
    head.appendChild(mkNav('‹', 'Mois précédent', () => { viewM--; if (viewM < 0) { viewM = 11; viewY--; } }));
    head.appendChild(title);
    head.appendChild(mkNav('›', 'Mois suivant', () => { viewM++; if (viewM > 11) { viewM = 0; viewY++; } }));
    cal.appendChild(head);

    const dow = document.createElement('div');
    dow.className = 'cal-dow';
    CAL_DOW.forEach((d) => { const s = document.createElement('span'); s.textContent = d; dow.appendChild(s); });
    cal.appendChild(dow);

    const grid = document.createElement('div');
    grid.className = 'cal-grid';
    const offset = (new Date(viewY, viewM, 1).getDay() + 6) % 7; // semaine commençant lundi
    const nDays = new Date(viewY, viewM + 1, 0).getDate();
    for (let i = 0; i < offset; i++) grid.appendChild(document.createElement('span'));
    for (let day = 1; day <= nDays; day++) {
      const cell = document.createElement('button');
      cell.type = 'button'; cell.className = 'cal-day'; cell.textContent = day;
      if (viewY === today.getFullYear() && viewM === today.getMonth() && day === today.getDate()) cell.classList.add('today');
      if (sel && viewY === sel.getFullYear() && viewM === sel.getMonth() && day === sel.getDate()) cell.classList.add('selected');
      cell.addEventListener('click', (e) => { e.stopPropagation(); onPick(ymd(viewY, viewM, day)); closeCalendar(); });
      grid.appendChild(cell);
    }
    cal.appendChild(grid);

    const foot = document.createElement('div');
    foot.className = 'cal-foot';
    const tBtn = document.createElement('button');
    tBtn.type = 'button'; tBtn.className = 'cal-foot-btn'; tBtn.textContent = "Aujourd'hui";
    tBtn.addEventListener('click', (e) => { e.stopPropagation(); onPick(ymd(today.getFullYear(), today.getMonth(), today.getDate())); closeCalendar(); });
    const cBtn = document.createElement('button');
    cBtn.type = 'button'; cBtn.className = 'cal-foot-btn clear'; cBtn.textContent = 'Effacer';
    cBtn.addEventListener('click', (e) => { e.stopPropagation(); onPick(null); closeCalendar(); });
    foot.appendChild(tBtn); foot.appendChild(cBtn);
    cal.appendChild(foot);
  };
  build();

  document.body.appendChild(cal);
  const pr = anchor.getBoundingClientRect();
  const cr = cal.getBoundingClientRect();
  let top = pr.bottom + 4;
  if (top + cr.height > window.innerHeight - 8) top = pr.top - cr.height - 4;
  let left = pr.left;
  if (left + cr.width > window.innerWidth - 8) left = window.innerWidth - cr.width - 8;
  cal.style.top = Math.max(8, Math.round(top)) + 'px';
  cal.style.left = Math.max(8, Math.round(left)) + 'px';

  openCalendar = cal;
  setTimeout(() => {
    document.addEventListener('pointerdown', onCalDocDown, true);
    document.addEventListener('keydown', onCalKey, true);
  }, 0);
}

const STATUS_CLASS = {
  'À traiter': 's-atraiter',
  'Maquette à faire': 's-maquette',
  'Maquette à valider': 's-maquette-valid',
  'En attente client': 's-attente',
  'Validé': 's-valide',
  'Bloqué': 's-bloque',
  'Terminé': 's-termine',
};
const STATUS_OPTIONS = ['À traiter', 'Maquette à faire', 'Maquette à valider', 'En attente client', 'Validé', 'Bloqué', 'Terminé'];

// États « maquette » : mis en avant (pastille violette + compteur d'étape)
// pour repérer d'un coup d'œil les maquettes à faire / à faire valider.
// --- Secteurs de production -------------------------------------------------
// On affecte un secteur à une commande en la glissant sur la colonne machine
// de la sidebar (voir onDragEnd) ; cela la fait entrer en production.
async function addSector(r, sector) {
  try {
    await api('POST', `/api/requests/${r.id}/sectors`, { sector });
    await loadRows();
    await loadCounts();
    showToast(`Ajouté à ${sectorShort(sector)}`);
  } catch (err) { reportError(err); }
}

const MAQUETTE_STATUSES = ['Maquette à faire', 'Maquette à valider'];

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
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur(); // Entrée valide → blur déclenche l'enregistrement
    } else if (e.key === 'Escape') {
      // Échap annule : on restaure la dernière valeur validée et on quitte le
      // champ. Comme input.value === lastSent, le blur ci-dessous ne PATCH pas.
      input.value = (lastSent ?? '').toString();
      input.blur();
    }
  });
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
// Crée une commande adaptée à la vue courante et renvoie son id.
//  - vue secteur (prod_*) → commande en production + ce secteur affecté
//  - sinon → commande dans cette phase
async function createForCurrentView() {
  if (isSector(currentStage)) {
    const created = await api('POST', '/api/requests', { stage: 'production' });
    await api('POST', `/api/requests/${created.id}/sectors`, { sector: currentStage });
    return created.id;
  }
  const created = await api('POST', '/api/requests', { stage: currentStage });
  return created.id;
}

$btnNew.addEventListener('click', async () => {
  try {
    const id = await createForCurrentView();
    await loadRows();
    await loadCounts();
    // focus première cellule éditable de la nouvelle ligne
    const tr = $rows.querySelector(`tr[data-id="${id}"]`);
    if (tr) {
      tr.scrollIntoView({ block: 'nearest' });
      const firstInput = tr.querySelector('.client-company, .cell-input');
      if (firstInput) firstInput.focus();
    }
  } catch (err) { reportError(err); }
});

// Bouton global « Commande vocale » : crée une ligne dans la vue courante,
// puis ouvre immédiatement la dictée dessus.
const $btnVoice = document.getElementById('btnVoice');
if ($btnVoice) {
  $btnVoice.addEventListener('click', async () => {
    if (openVoicePop) { closeVoicePopover(); return; }
    try {
      const id = await createForCurrentView();
      await loadRows();
      lastRowsSig = signature(rows);
      await loadCounts();
      const tr = $rows.querySelector(`tr[data-id="${id}"]`);
      if (tr) tr.scrollIntoView({ block: 'nearest' });
      const live = rows.find((x) => x.id === id);
      if (!live) return;
      const anchor = (tr && tr.querySelector('.voice-btn')) || $btnVoice;
      openVoicePopover(live, anchor);
    } catch (err) { reportError(err); }
  });
}

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

// Construit le corps de copie d'une commande (tous les champs sauf la position,
// recalculée en bas de l'étape cible). Les PDF ne sont pas recopiés.
function copyBody(r, stage) {
  return {
    stage: stage || r.stage,
    priority: r.priority,
    client_type: r.client_type,
    billing_company: r.billing_company,
    contact_referent: r.contact_referent,
    contact_phone: r.contact_phone,
    contact_email: r.contact_email,
    quantity: r.quantity,
    product: r.product,
    color: r.color,
    project_value: r.project_value,
    description: r.description,
    deadline: r.deadline ? String(r.deadline).slice(0, 10) : null,
    status: r.status,
  };
}

// Duplique une commande : crée une copie qui reste dans la même étape.
async function duplicateRow(r) {
  try {
    const created = await api('POST', '/api/requests', copyBody(r));
    if (created.stage === currentStage) {
      rows.push(created);
      applySortAndRender();
      const tr = $rows.querySelector(`tr[data-id="${created.id}"]`);
      if (tr) tr.scrollIntoView({ block: 'nearest' });
    }
    await loadCounts();
  } catch (err) { reportError(err); }
}

// Envoi vers Fiverr / Toptex : copie la commande dans la catégorie cible en
// laissant l'originale en place (contrairement au déplacement par glisser).
async function copyToStage(r, slug) {
  try {
    await api('POST', '/api/requests', copyBody(r, slug));
    await loadCounts();
    showToast(`Copié vers ${STAGE_LABEL[slug] || slug}`);
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

  const slug = stageEl ? stageEl.dataset.slug : null;
  if (slug) {
    // déposé sur une entrée de la sidebar
    if (isSector(slug)) {
      await addSector(ds.r, slug); // colonne machine → affecter ce secteur
    } else if (slug !== ds.r.stage) {
      await moveToStage(ds.r, slug); // autre phase → déplacer
    }
  } else {
    await commitReorder(ds.r); // déposé dans la grille → réordonnancement
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

// --- Largeur des colonnes : réglage manuel par catégorie --------------------
// Chaque catégorie mémorise ses propres largeurs (localStorage, par appareil).
// Tant qu'aucune colonne n'a été réglée à la main, la répartition reste celle
// du navigateur.
const COLW_KEY = 'olda_col_widths_v2';
const COL_MIN = 36; // largeur plancher en px, toutes colonnes
const $grid = document.getElementById('grid');
const COL_ELS = [...document.querySelectorAll('#grid colgroup col')];
const COL_KEYS = COL_ELS.map((c) => c.dataset.col);
// Largeurs naturelles (miroir des .col-* du CSS) : sert de repli quand une
// colonne est masquée (offsetWidth 0) au moment de figer les largeurs manuelles,
// pour qu'elle reprenne une largeur utile — pas le plancher — en réapparaissant.
const COL_DEFAULTS = {
  handle: 92, priority: 118, client: 196, product: 240, quantity: 92,
  project_value: 118, deadline: 134, status: 162, del: 216,
};

let colWidths = {};
try { colWidths = JSON.parse(localStorage.getItem(COLW_KEY) || '{}') || {}; } catch (_) { colWidths = {}; }

function saveColWidths() {
  try { localStorage.setItem(COLW_KEY, JSON.stringify(colWidths)); } catch (_) {}
}

// Applique les largeurs de l'étape courante, ou revient au mode automatique.
// En mode manuel le tableau passe en table-layout fixed et sa largeur devient
// la somme des colonnes : chaque poignée suit alors exactement le curseur.
function applyColWidths() {
  const w = colWidths[currentStage];
  if (w) {
    let sum = 0;
    COL_ELS.forEach((col, i) => {
      const px = Math.max(COL_MIN, Math.round(w[COL_KEYS[i]] || COL_DEFAULTS[COL_KEYS[i]] || COL_MIN));
      col.style.width = px + 'px';
      // Une colonne masquée (display:none) ne compte pas dans la largeur fixe,
      // sinon les colonnes visibles s'étirent pour absorber l'espace fantôme.
      if (getComputedStyle(col).display !== 'none') sum += px;
    });
    $grid.classList.add('manual-cols');
    $grid.style.width = sum + 'px';
  } else {
    COL_ELS.forEach((col) => { col.style.width = ''; });
    $grid.classList.remove('manual-cols');
    $grid.style.width = '';
  }
}

// Premier réglage d'une étape : on fige les largeurs rendues par le navigateur
// pour que seule la colonne saisie bouge, sans « saut » des autres.
function ensureManualWidths() {
  if (colWidths[currentStage]) return;
  const w = {};
  document.querySelectorAll('#grid thead th').forEach((th, i) => {
    // Colonne masquée → offsetWidth 0 : on garde sa largeur naturelle de repli
    // pour ne pas la figer au plancher si elle réapparaît plus tard.
    w[COL_KEYS[i]] = th.offsetWidth || COL_DEFAULTS[COL_KEYS[i]] || COL_MIN;
  });
  colWidths[currentStage] = w;
  applyColWidths();
}

function attachColResizers() {
  document.querySelectorAll('#grid thead th').forEach((th, i) => {
    const key = COL_KEYS[i];
    if (key === 'del') return; // colonne d'actions : pas de poignée
    const h = document.createElement('span');
    h.className = 'col-resizer';
    h.title = 'glisser pour régler la largeur';
    th.appendChild(h);
    h.addEventListener('click', (e) => e.stopPropagation()); // ne pas déclencher le tri
    h.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      ensureManualWidths();
      const startX = e.clientX;
      const startW = colWidths[currentStage][key];
      h.classList.add('active');
      document.body.classList.add('col-resizing');
      try { h.setPointerCapture(e.pointerId); } catch (_) {}
      const onMove = (ev) => {
        colWidths[currentStage][key] = Math.max(COL_MIN, Math.round(startW + ev.clientX - startX));
        applyColWidths();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        h.classList.remove('active');
        document.body.classList.remove('col-resizing');
        saveColWidths();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
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
  if (openAttachPop) return true; // panneau PDF ouvert : on ne reconstruit pas la grille
  if (openVoicePop) return true; // dictée en cours : on ne reconstruit pas la grille
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

// --- Recherche live : filtre la grille de l'étape courante -----------------
// Le champ inline (work-head) filtre en direct les lignes affichées par
// société / référent / produit / description / contact. ⌘K (ou Ctrl+K) place
// le curseur dans le champ ; Échap efface le filtre puis rend la main.
const SEARCH_FIELDS = ['billing_company', 'contact_referent', 'product', 'color', 'description', 'contact_phone', 'contact_email'];

function fold(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const $gridSearch = document.getElementById('gridSearch');
const $gridSearchInput = document.getElementById('gridSearchInput');
const $gridSearchClear = document.getElementById('gridSearchClear');

(function () {
  const kbd = document.getElementById('searchKbd');
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '') || /Mac/.test(navigator.userAgent || '');
  if (kbd) kbd.textContent = isMac ? '⌘K' : 'Ctrl K';
})();

function syncSearchUI() {
  const has = gridQuery !== '';
  if ($gridSearch) $gridSearch.classList.toggle('has-value', has);
  if ($gridSearchClear) $gridSearchClear.hidden = !has;
}

function setGridQuery(v) {
  const next = v || '';
  if (next === gridQuery) return;
  gridQuery = next;
  syncSearchUI();
  applySortAndRender();
}

if ($gridSearchInput) {
  $gridSearchInput.addEventListener('input', () => setGridQuery($gridSearchInput.value));
  $gridSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (gridQuery) { $gridSearchInput.value = ''; setGridQuery(''); }
      else $gridSearchInput.blur();
    }
  });
}
if ($gridSearchClear) {
  $gridSearchClear.addEventListener('click', () => {
    if ($gridSearchInput) { $gridSearchInput.value = ''; $gridSearchInput.focus(); }
    setGridQuery('');
  });
}

// ⌘K / Ctrl+K : place le curseur dans le champ de recherche (plus de modal).
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    if ($gridSearchInput) { $gridSearchInput.focus(); $gridSearchInput.select(); }
  }
});

// --- Impression de la catégorie courante -----------------------------------
// Le DOM ne contient que les lignes de l'étape affichée : window.print() imprime
// donc exactement la catégorie en cours. On renseigne un en-tête papier (titre
// de la catégorie + date) juste avant l'impression ; le CSS @media print masque
// la barre latérale, la recherche et les colonnes d'action.
const $btnPrint = document.getElementById('btnPrint');
const $printHead = document.getElementById('printHead');

function preparePrint() {
  if (!$printHead) return;
  const label = STAGE_LABEL[currentStage] || '';
  const n = rows.length;
  const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  $printHead.innerHTML =
    `<div class="ph-title">${escapeHtml(label)}</div>` +
    `<div class="ph-meta">${n} commande${n > 1 ? 's' : ''} · imprimé le ${escapeHtml(dateStr)}</div>`;
}

if ($btnPrint) {
  $btnPrint.addEventListener('click', () => { preparePrint(); window.print(); });
}

// --- Init ------------------------------------------------------------------
async function start() {
  renderSidebar();
  attachColResizers();
  applyColWidths();
  await loadCounts();
  $stageTitle.textContent = STAGE_LABEL[currentStage];
  updateStageLink(currentStage);
  updateFiverrTool(currentStage);
  await loadRows();
  lastRowsSig = signature(rows);
  startRealtime();
}

start().catch(reportError);
