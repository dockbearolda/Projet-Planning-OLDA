// ===========================================================================
// Planning OLDA — frontend (vanilla ES module, aucun build)
// ===========================================================================

// --- Étapes : pipeline LINÉAIRE (une commande = une seule étape à la fois). --
// Groupes = séparateurs visuels de la barre latérale gauche ; l'ordre et les
// libellés sont ceux affichés tels quels.
const STAGE_GROUPS = [
  [
    { slug: 'nouvelle_demande', label: 'Nouvelle demande' },
    { slug: 'chiffrage', label: 'Chiffrage à faire' },
    { slug: 'devis_a_envoyer', label: 'Devis à envoyer' },
    { slug: 'attente_validation_devis', label: 'Attente validation du devis' },
    { slug: 'devis_accepte_bat', label: 'Devis accepté – BAT à faire' },
    { slug: 'bat_envoye', label: 'BAT envoyé – Attente validation' },
    { slug: 'bat_a_modifier', label: 'BAT à modifier' },
    { slug: 'projet_valide', label: 'Projet validé – Lancement autorisé' },
  ],
  [
    { slug: 'a_commander', label: 'À commander' },
    { slug: 'preparation_production', label: 'Préparation production' },
    { slug: 'prod_trotec', label: 'Prod TROTEC' },
    { slug: 'prod_dtf', label: 'Prod DTF' },
    { slug: 'prod_pressage', label: 'Prod Pressage' },
    { slug: 'prod_uv', label: 'Prod UV' },
    { slug: 'montage_nettoyage', label: 'Montage / Nettoyage' },
    { slug: 'finitions_qualite', label: 'Finitions et contrôle qualité' },
  ],
  [
    { slug: 'facturation', label: 'Facturation' },
    { slug: 'termine_archive', label: 'Terminé – Archivé' },
    { slug: 'bloque', label: 'Bloqué – Action requise' },
    { slug: 'fiverr', label: 'Fiverr' },
  ],
];
// Mini-titres des 3 blocs de la barre latérale (même ordre que STAGE_GROUPS).
const GROUP_TITLES = ['Devis & BAT', 'Production', 'Clôture'];
const STAGES = STAGE_GROUPS.flat();
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.slug, s.label]));

// --- Liens externes par catégorie (affichés dans l'en-tête de l'étape). -----
const STAGE_LINKS = {
  fiverr: { url: 'https://fr.fiverr.com/', label: 'Ouvrir Fiverr' },
};

// Cibles d'envoi rapide proposées sur chaque ligne (boutons « → … »).
const SEND_TARGETS = [
  { slug: 'fiverr', label: 'Fiverr' },
];

// --- État applicatif -------------------------------------------------------
let currentStage = 'nouvelle_demande';
let rows = [];                 // demandes de l'étape courante
let counts = {};               // compteurs par étape
let gridQuery = '';            // texte du filtre de recherche live (étape courante)
let sort = { key: null, dir: 1 }; // tri manuel via en-têtes (null = tri par défaut)
let lastRendered = [];         // dernière liste triée montée (pour le masquage recherche)

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
  const show = slug === 'fiverr';
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

// Met à jour un compteur de la sidebar EN OPTIMISTE (sans aller-retour) : objet
// `counts` local + pastille correspondante. Le SSE/poll (loadCounts) réconciliera
// ensuite la valeur exacte, donc une approximation passagère est sans gravité.
function bumpCount(slug, delta) {
  if (!slug) return;
  counts[slug] = Math.max(0, (counts[slug] ?? 0) + delta);
  const el = document.querySelector(`.stage[data-slug="${slug}"]`);
  if (!el) return;
  const n = counts[slug];
  const c = el.querySelector('.stage-count');
  if (c) { c.textContent = n; c.classList.toggle('has-items', n > 0); }
  el.classList.toggle('is-empty', n === 0);
}

// Vrai si la commande appartient à la vue actuellement affichée (même critère que
// le filtre serveur) : sert à décider, en optimiste, si une ligne reste visible
// après un changement d'étape / d'affectation secteur.
function belongsToCurrentView(r) {
  return r.stage === currentStage;
}

// --- Tri -------------------------------------------------------------------
function applySortAndRender() {
  const sorted = [...rows];
  if (sort.key) {
    sorted.sort((a, b) => cmp(a, b, sort.key) * sort.dir);
  } else {
    // tri par défaut : groupé par PRIORITÉ (Haute → Moyenne → Basse) pour que les
    // bandes soient contiguës (en-têtes de groupe). À l'intérieur d'une bande, les
    // commandes urgentes (échéance ≤ 1 jour, aujourd'hui ou dépassée) remontent en
    // tête, la plus urgente d'abord, puis échéance la plus proche.
    sorted.sort((a, b) => {
      const pa = prioBand(a), pb = prioBand(b);
      if (pa !== pb) return pb - pa;
      const ua = urgentDaysLeft(a), ub = urgentDaysLeft(b);
      if ((ua !== null) !== (ub !== null)) return ua !== null ? -1 : 1;
      if (ua !== null && ub !== null) return ua - ub;
      return cmpDeadline(a.deadline, b.deadline);
    });
  }
  // Rendu incrémental : on monte / réutilise TOUTES les lignes de l'étape. Le
  // filtre de recherche se fait ensuite par masquage CSS (aucune reconstruction
  // par frappe) — cf. applySearchAndCounts.
  lastRendered = sorted;
  renderRows(sorted);
  applySearchAndCounts();
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

// --- Rendu grille (incrémental, réconcilié par clé) ------------------------
// On ne vide JAMAIS le <tbody> : chaque ligne est créée une fois puis réutilisée.
// rowEls mémorise, par id, le <tr> monté et sa signature `id:updated_at`. À chaque
// rendu : on retire les lignes disparues, on reconstruit UNIQUEMENT celles dont la
// signature a changé, on réutilise les autres telles quelles, et on ne déplace que
// les lignes réellement hors-position. La ligne en cours d'édition ou de drag n'est
// jamais reconstruite (isRowBusy).
const rowEls = new Map(); // id (string) -> { tr, sig }
const groupEls = new Map(); // bande de priorité (1..3) -> <tr> en-tête de groupe

// En-tête de groupe de priorité : bandeau « ● Haute · 3 » couvrant toute la
// largeur. Réutilisé d'un rendu à l'autre (le total est posé par applySearchAndCounts).
function buildGroupHeader(band) {
  const lvl = PRIORITY_LEVELS[band] || PRIORITY_LEVELS[1];
  const tr = document.createElement('tr');
  tr.className = `prio-group ${lvl.cls}`;
  const td = document.createElement('td');
  td.colSpan = COL_KEYS.length;
  td.innerHTML = '<div class="prio-group-inner">' +
    '<span class="prio-group-dot" aria-hidden="true"></span>' +
    `<span class="prio-group-label">${escapeHtml(lvl.label)}</span>` +
    '<span class="prio-group-count"></span></div>';
  tr.appendChild(td);
  return tr;
}
function ensureGroupHeader(band) {
  let g = groupEls.get(band);
  if (!g) { g = buildGroupHeader(band); groupEls.set(band, g); }
  return g;
}

function renderRows(data) {
  // Planning simplifié : plus de colonne priorité, donc plus de regroupement par
  // bande. On affiche toujours une liste à plat (tri par urgence puis échéance).
  const grouping = false;
  const wanted = new Set(data.map((r) => String(r.id)));

  // 1. Retirer les <tr> de données dont l'id n'est plus présent dans la liste voulue.
  for (const [id, entry] of rowEls) {
    if (!wanted.has(id)) { entry.tr.remove(); rowEls.delete(id); }
  }

  // 2. Construire la séquence ordonnée des nœuds (en-têtes de groupe + lignes),
  //    en créant / reconstruisant / réutilisant les lignes au passage.
  const order = [];
  const usedGroups = new Set();
  let curBand = null;
  for (const r of data) {
    if (grouping) {
      const band = prioBand(r);
      if (band !== curBand) {
        curBand = band;
        order.push(ensureGroupHeader(band));
        usedGroups.add(band);
      }
    }
    const id = String(r.id);
    const sig = `${r.id}:${r.updated_at}`;
    let entry = rowEls.get(id);
    if (!entry) {
      entry = { tr: buildRow(r), sig };
      rowEls.set(id, entry);
    } else if (entry.sig !== sig && !isRowBusy(entry.tr)) {
      const tr = buildRow(r);
      entry.tr.replaceWith(tr);
      entry.tr = tr;
      entry.sig = sig;
    }
    order.push(entry.tr);
  }

  // 3. Retirer les en-têtes de groupe inutilisés à ce rendu.
  for (const [band, g] of groupEls) {
    if (!usedGroups.has(band)) { g.remove(); groupEls.delete(band); }
  }

  // 4. Replacer tous les nœuds dans l'ordre voulu (sans déplacer une ligne en
  //    cours de drag : sa position est pilotée à la main).
  let prev = null;
  for (const node of order) {
    if (!node.classList.contains('dragging')) {
      const expectedNext = prev ? prev.nextSibling : $rows.firstChild;
      if (node !== expectedNext) $rows.insertBefore(node, expectedNext);
    }
    prev = node;
  }

  applyEmptyCols();
  updateSortArrows();
}

// Vrai si la ligne ne doit pas être reconstruite : focus d'édition à l'intérieur
// ou drag en cours. On la réutilise alors intacte (on ne perd ni la saisie ni le drag).
function isRowBusy(tr) {
  if (!tr) return false;
  if (tr.classList.contains('dragging')) return true;
  const ae = document.activeElement;
  return !!(ae && tr.contains(ae));
}

// Filtre de recherche par masquage CSS (.is-hidden) : la grille reste montée,
// aucune ligne n'est reconstruite par frappe. Met aussi à jour l'état vide et le
// compteur d'étape à partir des seules lignes visibles. On garde toujours la ligne
// brouillon (ajout) visible.
function applySearchAndCounts() {
  const q = fold(gridQuery.trim());
  let visible = 0;
  const bandVisible = { 1: 0, 2: 0, 3: 0 };
  for (const r of lastRendered) {
    const entry = rowEls.get(String(r.id));
    if (!entry) continue;
    const match = !q || isDraftRow(r) || SEARCH_FIELDS.some((f) => fold(r[f]).includes(q));
    entry.tr.classList.toggle('is-hidden', !match);
    if (match) {
      visible++;
      bandVisible[prioBand(r)]++;
    }
  }
  // En-têtes de groupe : on masque une bande vide (après filtre) et on affiche le
  // total des lignes visibles de la bande.
  for (const [band, g] of groupEls) {
    const n = bandVisible[band] || 0;
    g.classList.toggle('is-hidden', n === 0);
    const c = g.querySelector('.prio-group-count');
    if (c) c.textContent = `· ${n}`;
  }
  $empty.hidden = visible > 0;
  if (visible === 0) {
    $empty.textContent = q
      ? 'Aucune commande ne correspond à la recherche.'
      : 'Aucune commande à cette étape.';
  }
  const base = visible ? `${visible} commande${visible > 1 ? 's' : ''}` : '';
  $stageCount.textContent = base;
}

// Toutes les colonnes du planning simplifié restent affichées en permanence :
// on se contente de recaler les largeurs manuelles au rendu.
function applyEmptyCols() {
  applyColWidths();
}

// Une ligne est un « brouillon d'ajout » tant qu'aucun champ de contenu n'est
// renseigné : on l'affiche alors comme un formulaire, pas comme une donnée.
function isDraftRow(r) {
  const fields = ['billing_company', 'product', 'description', 'deadline'];
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
  tdHandle.appendChild(handleCell);
  tr.appendChild(tdHandle);

  // type : bascule Pro / Perso
  tr.appendChild(cellType(r));
  // nom du dossier client (référent / contact déplacés dans le popover contact)
  tr.appendChild(cellDossier(r));
  // description : ce qui est produit (ancien champ « produit »)
  tr.appendChild(cellDescription(r));
  // infos : notes libres multi-lignes (ancien champ « description »)
  tr.appendChild(cellInfos(r));
  // date souhaitée : badge relatif coloré (« En retard 1j », « 4j »), éditable au clic
  tr.appendChild(cellDeadline(r));
  // actions de fin de ligne : envoyer vers (Fiverr) + dupliquer +
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

// --- Cellules ---------------------------------------------------------------
// Priorité : 3 niveaux clairs codés couleur (basse → moyenne → haute).
// Une seule pastille tactile ; un clic fait défiler les niveaux 1 → 2 → 3 → 1.
const PRIORITY_LEVELS = {
  1: { cls: 'p1', label: 'Basse' },
  2: { cls: 'p2', label: 'Moyenne' },
  3: { cls: 'p3', label: 'Haute' },
};

// Niveau de priorité normalisé en bande 1..3 (toute valeur inattendue → Basse).
function prioBand(r) {
  return PRIORITY_LEVELS[r && r.priority] ? r.priority : 1;
}

// Type : bascule Pro / Perso, désormais dans sa propre colonne (1re du fichier).
function cellType(r) {
  const td = document.createElement('td');
  td.className = 'col-type';
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
  td.appendChild(type);
  return td;
}

// Nom du dossier client : champ principal éditable. Le référent, le téléphone et
// l'email restent saisissables via le popover contact (icône de la 1re colonne).
function cellDossier(r) {
  const td = document.createElement('td');
  td.className = 'col-client-cell';
  const stack = document.createElement('div');
  stack.className = 'client-stack';

  const company = document.createElement('input');
  company.className = 'cell-input client-company';
  company.type = 'text';
  company.value = r.billing_company ?? '';
  company.placeholder = 'nom du dossier';
  bindInline(company, r, 'billing_company', (v) => v === '' ? null : v, capitalizeName);

  stack.appendChild(company);
  td.appendChild(stack);
  return td;
}

// Description : ce qui est produit (ancien champ « produit »). Champ simple,
// éditable en ligne, avec majuscules automatiques à la validation.
function cellDescription(r) {
  const td = document.createElement('td');
  td.className = 'col-product-cell';
  const stack = document.createElement('div');
  stack.className = 'product-stack';

  const name = document.createElement('input');
  name.className = 'cell-input product-name';
  name.type = 'text';
  name.value = r.product ?? '';
  name.placeholder = 'description';
  bindInline(name, r, 'product', (v) => v === '' ? null : v, capitalizeName);

  stack.appendChild(name);
  td.appendChild(stack);
  return td;
}

// Infos : notes libres multi-lignes (ancien champ « description »). Repliée à
// 1 ligne par défaut ; dès qu'il y a ≥ 2 lignes, une flèche déroule les suivantes.
function cellInfos(r) {
  const td = document.createElement('td');
  td.className = 'col-infos-cell';
  const stack = document.createElement('div');
  stack.className = 'infos-stack';

  const descRow = document.createElement('div');
  descRow.className = 'product-desc-row';
  const desc = document.createElement('textarea');
  desc.className = 'cell-input product-desc';
  desc.rows = 1;
  desc.value = r.description ?? '';
  desc.placeholder = 'infos';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'desc-toggle';
  toggle.title = 'Afficher / masquer les lignes suivantes';
  toggle.setAttribute('aria-label', 'Afficher les lignes suivantes');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  let open = false;
  let lastSent = r.description ?? '';
  const isMulti = () => desc.value.indexOf('\n') !== -1;

  const sync = () => {
    stack.classList.toggle('desc-empty', desc.value.trim() === '');
    const multi = isMulti();
    toggle.hidden = !multi;
    if (!multi) open = false;
    toggle.classList.toggle('open', open);
    // hauteur : repliée = 1 ligne (CSS) ; dépliée OU en édition = tout le contenu.
    const expanded = open || document.activeElement === desc;
    if (expanded) {
      desc.style.height = 'auto';
      desc.style.height = desc.scrollHeight + 'px';
    } else {
      desc.style.height = '';
    }
  };

  toggle.addEventListener('click', (e) => { e.stopPropagation(); open = !open; sync(); });
  desc.addEventListener('input', sync);
  desc.addEventListener('focus', sync);
  desc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { desc.value = lastSent; desc.blur(); } // Entrée = nouvelle ligne
  });
  desc.addEventListener('blur', () => {
    const val = desc.value === '' ? null : desc.value;
    if ((val ?? '') !== (lastSent ?? '')) {
      const prev = r.description;
      r.description = val;
      lastSent = desc.value;
      patchRow(r, { description: val }).catch((err) => {
        r.description = prev; reportError(err);
      });
    }
    sync();
  });

  descRow.appendChild(desc);
  descRow.appendChild(toggle);
  stack.appendChild(descRow);
  td.appendChild(stack);
  sync();
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
    patchRow(r, { deadline: val }).catch((err) => {
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
      badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg><span>Date souhaitée</span>';
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

// --- Majuscules automatiques (noms, référents, projets) --------------------
// On tape vite en minuscules ; le champ se range proprement à la validation
// (Entrée / sortie du champ). Title-case « à la française » :
//   - 1re lettre de chaque mot en majuscule (« mug photo » → « Mug Photo ») ;
//   - particules en minuscule sauf en tête (« brasserie du coin » → « Brasserie du Coin ») ;
//   - sigles métier toujours en capitales (dtf, uv, bat… → DTF, UV, BAT) ;
//   - un mot déjà saisi avec une majuscule interne est respecté (acronyme voulu).
// Idempotent : ré-appliquer ne change rien (sûr à repasser à chaque blur).
const NAME_PARTICLES = new Set(['de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'et', 'au', 'aux', 'von', 'van', 'der', 'den', 'di', 'da', 'dos', 'das']);
const FORCE_UPPER = new Set(['dtf', 'uv', 'bat', 'tva', 'olda', 'pdf', 'cmjn', 'rvb', 'sav']);

function capitalizeName(s) {
  if (s == null) return s;
  let first = true;
  return s.trim().replace(/\s+/g, ' ').replace(/[\p{L}\p{N}]+/gu, (word) => {
    const lower = word.toLowerCase();
    const wasFirst = first;
    first = false;
    if (FORCE_UPPER.has(lower)) return lower.toUpperCase();
    if (/\p{Lu}/u.test(word.slice(1))) return word;       // majuscule interne → acronyme voulu
    if (!wasFirst && NAME_PARTICLES.has(lower)) return lower; // particule (hors tête) → minuscule
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

// --- Édition inline générique (texte/nombre) ------------------------------
// `normalize` (optionnel) range la valeur saisie avant l'enregistrement et la
// réécrit dans le champ (ex. capitalizeName pour les noms / projets).
function bindInline(input, r, field, transform, normalize) {
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
    let raw = input.value;
    if (normalize) {
      const norm = normalize(raw);
      if (norm !== raw) { input.value = norm; raw = norm; } // range le champ à l'écran
    }
    if (raw === (lastSent ?? '').toString()) return;
    const val = transform(raw);
    if (val !== null && typeof val === 'number' && Number.isNaN(val)) {
      input.value = r[field] ?? ''; return;
    }
    const prev = r[field];
    r[field] = val;
    lastSent = raw;
    patchRow(r, { [field]: val }).catch((err) => {
      r[field] = prev; input.value = prev ?? ''; lastSent = prev ?? ''; reportError(err);
    });
  });
}

// --- PATCH générique optimiste --------------------------------------------
function patch(r, body, applyOptimistic) {
  applyOptimistic();
  patchRow(r, body).catch((err) => {
    reportError(err);
    loadRows(); // resync en cas d'échec
  });
}

// --- Création / sauvegardes optimistes ------------------------------------
// Une ligne tout juste créée reçoit d'abord un id temporaire (« tmp-N ») et
// s'affiche instantanément ; le POST part en arrière-plan. Tant que l'id réel
// n'est pas revenu, les sauvegardes de champs de cette ligne sont mises EN FILE
// (pendingCreates) au lieu d'appeler /api/requests/tmp-… ; finalizeCreate les
// envoie d'un bloc dès l'arrivée de l'id réel.
const pendingCreates = new Map(); // tmpId -> { patch: {champ: valeur, …} }
// Ids temporaires supprimés AVANT que leur POST de création ne réponde : on
// supprimera la vraie ligne (orpheline côté serveur) dès l'arrivée de l'id réel.
const cancelledCreates = new Set();
let tmpSeq = 0;
const isTempId = (id) => typeof id === 'string' && id.startsWith('tmp-');

// Réconcilie discrètement la grille + les compteurs avec le serveur après un
// rollback : récupère un éventuel changement concurrent d'un autre poste et la
// valeur exacte des compteurs. Silencieux si le serveur est injoignable — le
// rollback local a déjà rétabli un état cohérent (cas « serveur coupé »).
function resyncAfterRollback() {
  loadRows().catch(() => {});
  loadCounts().catch(() => {});
}

// PATCH d'un (ou plusieurs) champ d'une commande, compatible ligne optimiste.
// Renvoie une promesse : réseau réel si l'id est définitif, résolue tout de suite
// si la modif a été mise en file (l'appelant ne déclenche alors pas son rollback).
function patchRow(r, body) {
  const pending = pendingCreates.get(String(r.id));
  if (pending) {
    Object.assign(pending.patch, body); // coalesce les champs en attente
    return Promise.resolve(null);
  }
  return api('PATCH', `/api/requests/${r.id}`, body);
}

// Construit une ligne brouillon optimiste (tous champs vides) pour l'étape
// courante.
function makeOptimisticRow() {
  const maxPos = rows.reduce((m, r) => Math.max(m, r.position ?? 0), 0);
  const now = new Date().toISOString();
  return {
    id: `tmp-${++tmpSeq}`,
    stage: currentStage,
    priority: 1, client_type: 'pro',
    billing_company: null, contact_referent: null, contact_phone: null, contact_email: null,
    quantity: null, product: null, color: null, project_value: null,
    description: null, deadline: null,
    position: maxPos + 1000,
    devis_name: null, bat_name: null,
    created_at: now, updated_at: now,
  };
}

// Remplace l'id temporaire par l'id réel renvoyé par le serveur — dans `rows`,
// dans le <tr> (data-id) et dans le renderer incrémental (rowEls) — sans jamais
// reconstruire la ligne (on préserve le focus / la saisie en cours). Puis envoie
// les modifications de champs mises en file pendant l'attente.
function finalizeCreate(tmpId, created) {
  // La ligne a été supprimée pendant que son POST était en vol : on retire la
  // commande désormais orpheline côté serveur au lieu de la « finaliser ».
  if (cancelledCreates.has(tmpId)) {
    cancelledCreates.delete(tmpId);
    pendingCreates.delete(tmpId);
    api('DELETE', `/api/requests/${created.id}`).catch(reportError);
    return;
  }
  const pending = pendingCreates.get(tmpId);
  pendingCreates.delete(tmpId);
  const r = rows.find((x) => x.id === tmpId);
  if (r) {
    r.id = created.id;
    if (created.position != null) r.position = created.position;
    if (created.created_at) r.created_at = created.created_at;
    if (created.updated_at) r.updated_at = created.updated_at;
    const entry = rowEls.get(tmpId);
    if (entry) {
      rowEls.delete(tmpId);
      entry.tr.dataset.id = created.id;
      entry.sig = `${created.id}:${r.updated_at}`;
      rowEls.set(String(created.id), entry);
    }
    lastRowsSig = signature(rows);
  }
  if (pending && Object.keys(pending.patch).length) {
    // Échec du flush : on resynchronise pour montrer l'état réel du serveur
    // plutôt que de laisser des valeurs locales non enregistrées en silence.
    api('PATCH', `/api/requests/${created.id}`, pending.patch).catch((err) => {
      reportError(err);
      loadRows().catch(() => {});
    });
  }
}

// Crée une commande adaptée à la vue courante, en optimiste : la ligne brouillon
// apparaît et reçoit le focus immédiatement, le POST suit en arrière-plan.
function createForCurrentView() {
  const r = makeOptimisticRow();
  const tmpId = r.id;
  const viewSlug = currentStage; // figé : la vue peut changer avant la réponse
  rows.push(r);
  pendingCreates.set(tmpId, { patch: {} });
  applySortAndRender();
  bumpCount(viewSlug, +1);

  const tr = $rows.querySelector(`tr[data-id="${tmpId}"]`);
  if (tr) {
    tr.scrollIntoView({ block: 'nearest' });
    const firstInput = tr.querySelector('.client-company, .cell-input');
    if (firstInput) firstInput.focus();
  }

  api('POST', '/api/requests', { stage: viewSlug })
    .then((created) => finalizeCreate(tmpId, created))
    .catch((err) => {
      pendingCreates.delete(tmpId);
      cancelledCreates.delete(tmpId);
      rows = rows.filter((x) => x.id !== tmpId);
      applySortAndRender();
      bumpCount(viewSlug, -1);
      reportError(err);
      loadCounts().catch(() => {}); // valeur exacte (un loadCounts concurrent a pu déjà corriger)
    });
}

$btnNew.addEventListener('click', () => createForCurrentView());

// --- Suppression (optimiste) ----------------------------------------------
function removeRow(r) {
  if (!confirm('Supprimer cette commande définitivement ?')) return;
  // Ligne pas encore créée côté serveur : on l'enlève localement et on marque
  // l'id temporaire — si son POST de création est encore en vol, finalizeCreate
  // supprimera la commande orpheline à la réponse.
  if (isTempId(r.id)) {
    pendingCreates.delete(String(r.id));
    cancelledCreates.add(String(r.id));
    rows = rows.filter((x) => x.id !== r.id);
    applySortAndRender();
    bumpCount(currentStage, -1);
    return;
  }
  const prevRows = rows;
  const viewSlug = currentStage;
  rows = rows.filter((x) => x.id !== r.id);
  applySortAndRender();
  bumpCount(viewSlug, -1);
  api('DELETE', `/api/requests/${r.id}`).catch((err) => {
    // rollback local immédiat (résilient même serveur coupé), puis resync.
    rows = prevRows;
    lastRowsSig = signature(rows);
    bumpCount(viewSlug, +1);
    applySortAndRender();
    reportError(err);
    resyncAfterRollback();
  });
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
  };
}

// Duplique une commande (optimiste) : la copie reste dans la même étape et
// apparaît tout de suite. Les PDF ne sont pas recopiés (comme côté serveur).
function duplicateRow(r) {
  const maxPos = rows.reduce((m, x) => Math.max(m, x.position ?? 0), 0);
  const now = new Date().toISOString();
  const tmpId = `tmp-${++tmpSeq}`;
  const copy = {
    ...r, id: tmpId, devis_name: null, bat_name: null,
    position: maxPos + 1000, created_at: now, updated_at: now,
  };
  // La copie n'apparaît dans la grille que si elle relève bien de la vue courante.
  if (!belongsToCurrentView(copy)) {
    api('POST', '/api/requests', copyBody(r)).catch(reportError);
    return;
  }
  const viewSlug = currentStage;
  rows.push(copy);
  pendingCreates.set(tmpId, { patch: {} });
  applySortAndRender();
  bumpCount(viewSlug, +1);
  const tr = $rows.querySelector(`tr[data-id="${tmpId}"]`);
  if (tr) tr.scrollIntoView({ block: 'nearest' });
  api('POST', '/api/requests', copyBody(r))
    .then((created) => finalizeCreate(tmpId, created))
    .catch((err) => {
      pendingCreates.delete(tmpId);
      cancelledCreates.delete(tmpId);
      rows = rows.filter((x) => x.id !== tmpId);
      applySortAndRender();
      bumpCount(viewSlug, -1);
      reportError(err);
      loadCounts().catch(() => {});
    });
}

// Envoi vers Fiverr (optimiste) : copie la commande dans l'étape cible en
// laissant l'originale en place. La copie n'est pas dans la vue courante
// (autre étape) : seul le compteur de la cible bouge, le SSE réconciliera.
function copyToStage(r, slug) {
  bumpCount(slug, +1);
  showToast(`Copié vers ${STAGE_LABEL[slug] || slug}`);
  api('POST', '/api/requests', copyBody(r, slug)).catch((err) => {
    bumpCount(slug, -1);
    reportError(err);
    loadCounts().catch(() => {}); // valeur exacte (un loadCounts concurrent a pu déjà corriger)
  });
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
      raf: 0, lastX: e.clientX, lastY: e.clientY,
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
  // Position du fantôme : transform compositor-only → suit le doigt à chaque
  // évènement, sans déclencher de layout/repaint.
  dragState.ghost.style.transform =
    `translate3d(${e.clientX - dragState.grabDX}px, ${e.clientY - dragState.grabDY}px, 0)`;
  // Détection de cible + réordonnancement : ces lectures de layout
  // (elementFromPoint, getBoundingClientRect par ligne) sont coûteuses, on les
  // limite à une fois par frame pour ne pas saturer le thread au tactile.
  dragState.lastX = e.clientX;
  dragState.lastY = e.clientY;
  if (!dragState.raf) dragState.raf = requestAnimationFrame(updateDragTarget);
}

function updateDragTarget() {
  if (!dragState) return;
  dragState.raf = 0;
  const x = dragState.lastX, y = dragState.lastY;
  const el = document.elementFromPoint(x, y);
  document.querySelectorAll('.stage.drop-target').forEach((s) => s.classList.remove('drop-target'));
  const stageEl = el && el.closest ? el.closest('.stage') : null;
  if (stageEl) {
    if (stageEl.dataset.slug !== dragState.r.stage) stageEl.classList.add('drop-target');
  } else {
    // réordonnancement vertical dans la grille
    const after = getDragAfterElement($rows, y);
    if (after == null) $rows.appendChild(dragState.tr);
    else if (after !== dragState.tr) $rows.insertBefore(dragState.tr, after);
  }
  autoScroll(y);
}

async function onDragEnd(e) {
  if (!dragState) return;
  const ds = dragState;
  if (ds.raf) cancelAnimationFrame(ds.raf);
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

  // Ligne encore en cours de création (id temporaire, ex. duplication non
  // brouillon) : on ne peut pas la déplacer / réordonner tant que son id réel
  // n'est pas revenu (sinon PATCH/POST vers /api/requests/tmp-…). On annule le
  // geste proprement et on remet la grille en ordre.
  if (isTempId(ds.r.id)) {
    showToast('Commande en cours de création — réessaie dans un instant.');
    applySortAndRender();
    return;
  }

  const slug = stageEl ? stageEl.dataset.slug : null;
  if (slug) {
    // déposé sur une entrée de la sidebar → déplacer vers cette étape
    if (slug !== ds.r.stage) await moveToStage(ds.r, slug);
  } else {
    await commitReorder(ds.r); // déposé dans la grille → réordonnancement
  }
}

function moveToStage(r, slug) {
  const prevRows = rows;
  const viewSlug = currentStage;
  rows = rows.filter((x) => x.id !== r.id);
  applySortAndRender();
  bumpCount(viewSlug, -1);
  bumpCount(slug, +1);
  api('PATCH', `/api/requests/${r.id}`, { stage: slug }).catch((err) => {
    rows = prevRows;
    lastRowsSig = signature(rows);
    bumpCount(viewSlug, +1);
    bumpCount(slug, -1);
    applySortAndRender();
    reportError(err);
    resyncAfterRollback();
  });
}

async function commitReorder(r) {
  const siblings = [...$rows.querySelectorAll('tr[data-id]:not(.is-hidden)')];
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
  const els = [...container.querySelectorAll('tr[data-id]:not(.dragging):not(.is-hidden)')];
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
const COLW_KEY = 'olda_col_widths_v4';
const COL_MIN = 36; // largeur plancher en px, toutes colonnes
const $grid = document.getElementById('grid');
const COL_ELS = [...document.querySelectorAll('#grid colgroup col')];
const COL_KEYS = COL_ELS.map((c) => c.dataset.col);
// Largeurs naturelles (miroir des .col-* du CSS) : sert de repli quand une
// colonne est masquée (offsetWidth 0) au moment de figer les largeurs manuelles,
// pour qu'elle reprenne une largeur utile — pas le plancher — en réapparaissant.
const COL_DEFAULTS = {
  handle: 52, client_type: 96, client: 220, product: 240, description: 240,
  deadline: 140, del: 200,
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
  if (openCalendar) return true; // popup ancré à un badge de la grille
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

function onStreamChange(e) {
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
  // Pas de reconstruction : on ne fait que masquer/démasquer les lignes déjà montées.
  applySearchAndCounts();
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

// --- Réglage de densité (Compact / Normal / Confort) -----------------------
// Pilote la hauteur de ligne via une classe sur .app (--row-h). Mémorisé par
// appareil (localStorage). Réglage visuel pur : aucun aller-retour serveur.
const DENSITY_KEY = 'olda_density';
const DENSITIES = ['compact', 'normal', 'confort'];
const $app = document.querySelector('.app');
const $densityToggle = document.getElementById('densityToggle');
let density = 'normal';
try { const d = localStorage.getItem(DENSITY_KEY); if (DENSITIES.includes(d)) density = d; } catch (_) {}

function applyDensity(d) {
  density = DENSITIES.includes(d) ? d : 'normal';
  if ($app) DENSITIES.forEach((x) => $app.classList.toggle('density-' + x, x === density));
  if ($densityToggle) {
    $densityToggle.querySelectorAll('.density-opt').forEach((b) => {
      const on = b.dataset.density === density;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  try { localStorage.setItem(DENSITY_KEY, density); } catch (_) {}
}

if ($densityToggle) {
  $densityToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.density-opt');
    if (btn) applyDensity(btn.dataset.density);
  });
}
applyDensity(density);

// --- Init ------------------------------------------------------------------
// Date du jour affichée en haut à gauche : jour de la semaine + date complète.
function setTodayDate() {
  const el = document.getElementById('todayDate');
  if (!el) return;
  const now = new Date();
  const dow = now.toLocaleDateString('fr-FR', { weekday: 'long' });
  const date = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  el.replaceChildren();
  const a = document.createElement('span');
  a.className = 'today-dow';
  a.textContent = dow.charAt(0).toUpperCase() + dow.slice(1);
  const b = document.createElement('span');
  b.className = 'today-date';
  b.textContent = date;
  el.append(a, b);
}

// Reflet spéculaire dynamique du logo : le halo lumineux suit le pointeur.
function initBrandReflection() {
  const tile = document.getElementById('brandLogo');
  if (!tile) return;
  if (window.matchMedia('(hover: none)').matches) return; // inutile au tactile
  tile.addEventListener('pointermove', (e) => {
    const r = tile.getBoundingClientRect();
    tile.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    tile.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
  });
  tile.addEventListener('pointerleave', () => {
    tile.style.setProperty('--mx', '50%');
    tile.style.setProperty('--my', '8%');
  });
}

async function start() {
  setTodayDate();
  initBrandReflection();
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
