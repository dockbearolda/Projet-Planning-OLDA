// ===========================================================================
// Planning OLDA — frontend (vanilla ES module, aucun build)
// ===========================================================================

// Guide des étapes (texte du patron, feuille « Descriptif Étapes »).
import { STEP_GUIDE } from './guide.js';
// Dashboard « Point du jour » (projection temps réel du planning).
import { createDashboard } from './dashboard.js';
// WhatsApp « commande prête » : numéro au format international + message rempli.
import { whatsappLink } from './whatsapp.js';

// --- Pipeline à 2 NIVEAUX (modèle « familles », d'après le CRM du patron) -----
// La FAMILLE (barre latérale) dit OÙ en est le projet ; la SOUS-ÉTAPE (puce sur
// la ligne) précise CE QUI SE PASSE MAINTENANT. « 1 projet = 1 seule place. »
// 8 familles au lieu de 20 étapes → barre latérale nettement plus lisible/aérée.
const FAMILIES = [
  { slug: 'demande', label: 'Demande' },
  { slug: 'chiffrage', label: 'Commande' },
  { slug: 'attente_client', label: 'Attente Client' },
  { slug: 'preparation', label: 'Préparation' },
  { slug: 'production', label: 'Production' },
  { slug: 'facturation', label: 'Facturation / Retrait' },
  { slug: 'termine', label: 'Terminé' },
  { slug: 'archive', label: 'Archivé' },
];
// Catégorie spéciale (sous-traitance graphiste), hors des 8 familles.
const SPECIAL = [
  { slug: 'fiverr', label: 'Fiverr' },
];
const STAGES = [...FAMILIES, ...SPECIAL];
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.slug, s.label]));

// Sous-étapes par famille (miroir de db.js). Une famille absente = pas de puce.
const SUB_STAGES = {
  chiffrage: [
    { slug: 'a_chiffrer', label: 'À chiffrer' },
    { slug: 'chiffrage_en_cours', label: 'Chiffrage en cours' },
    { slug: 'devis_a_envoyer', label: 'Devis à envoyer' },
  ],
  preparation: [
    { slug: 'prepa_fichiers', label: 'Préparation fichiers & produits' },
    { slug: 'a_commander', label: 'À commander' },
    { slug: 'attente_marchandise', label: 'Attente marchandise' },
    { slug: 'pret_a_produire', label: 'Prêt à produire' },
  ],
  production: [
    { slug: 'prod_dtf', label: 'Production DTF' },
    { slug: 'prod_pressage', label: 'Pressage' },
    { slug: 'prod_trotec', label: 'Production Trotec' },
    { slug: 'prod_uv', label: 'Production UV' },
    { slug: 'montage_finition', label: 'Montage / Finition' },
    { slug: 'controle_emballage', label: 'Contrôle & emballage' },
  ],
  facturation: [
    { slug: 'facturation_a_faire', label: 'Facturation à faire' },
    { slug: 'pret_retrait', label: 'Prêt client / Attente retrait' },
  ],
  termine: [
    { slug: 'attente_paiement', label: 'Attente paiement' },
    { slug: 'solde', label: 'Soldé' },
  ],
};
// Libellé d'une sous-étape par son slug (toutes familles confondues).
const SUB_LABEL = Object.fromEntries(
  Object.values(SUB_STAGES).flat().map((s) => [s.slug, s.label]),
);
const familyHasSub = (slug) => Array.isArray(SUB_STAGES[slug]) && SUB_STAGES[slug].length > 0;

// --- Catégories PROMUES EN ONGLET ------------------------------------------
// « Fiverr » et « À commander » sont les deux listes qu'on ouvre le plus souvent
// dans la journée : elles ont désormais leur onglet dans la barre du haut, entre
// Dashboard et Base clients. Elles quittent donc le rail des étapes — sans
// quitter le pipeline : le flux (« étape suivante »), les compteurs, la puce de
// sous-étape et les commandes déjà posées ne bougent pas d'un pouce.
const PROMOTED = [
  { hash: '#fiverr', view: 'fiverr', btn: 'viewFiverr', stage: 'fiverr', sub: null },
  { hash: '#a-commander', view: 'a_commander', btn: 'viewACommander', stage: 'preparation', sub: 'a_commander' },
];
const PROMOTED_BY_VIEW = Object.fromEntries(PROMOTED.map((p) => [p.view, p]));
// Ce que le rail ne montre plus : la famille « fiverr » et la sous-étape
// « a_commander » (leur onglet les remplace).
const RAIL_HIDDEN_STAGES = new Set(PROMOTED.filter((p) => !p.sub).map((p) => p.stage));
const RAIL_HIDDEN_SUBS = new Set(PROMOTED.filter((p) => p.sub).map((p) => p.sub));

// Employés de l'entreprise (miroir de db.js). `responsable` = PILOTE du projet,
// `referent` = 2e personne rattachée : les deux puisent dans cette liste.
const EMPLOYEES = ['Loïc', 'Charlie', 'Mélina', 'Julien'];
const RESPONSABLES = [...EMPLOYEES, 'À attribuer'];

// Types de client : libellé court affiché + classe de couleur.
const CLIENT_TYPES = [
  { value: 'pro', label: 'Pro', cls: 'pro' },
  { value: 'perso', label: 'Perso', cls: 'perso' },
  { value: 'asso', label: 'Asso', cls: 'asso' },
  { value: 'revendeur', label: 'Revendeur', cls: 'revendeur' },
];
const CLIENT_TYPE_LABEL = Object.fromEntries(CLIENT_TYPES.map((t) => [t.value, t.label]));

// --- Alerte de commande (requests.flag / flag_reason) ----------------------
// N'importe quel collaborateur pose l'alerte depuis la colonne « État » : la
// commande est BLOQUÉE (elle n'avance plus, on dit pourquoi) ou À VOIR (elle
// avance, mais quelqu'un doit y jeter un œil). Le motif est libre et facultatif.
const FLAGS = [
  { value: 'bloque', label: 'BLOQUÉE', cls: 'bloque' },
  { value: 'a_voir', label: 'À VOIR', cls: 'a-voir' },
];
const FLAG_BY_VALUE = Object.fromEntries(FLAGS.map((f) => [f.value, f]));
const FLAG_REASON_MAX = 240; // miroir de server.js

// --- Flux linéaire du pipeline (bouton « étape suivante ») ------------------
// Ordre de progression réel d'un projet : les familles dans l'ordre de la
// sidebar, et à l'intérieur d'une famille ses sous-étapes dans l'ordre. Un clic
// sur la flèche d'une ligne l'envoie à la position suivante de cette liste.
// Fiverr (catégorie spéciale hors flux) n'y figure pas : pas de flèche.
const FLOW = FAMILIES.flatMap((f) => (
  familyHasSub(f.slug)
    ? SUB_STAGES[f.slug].map((s) => ({ stage: f.slug, sub: s.slug }))
    : [{ stage: f.slug, sub: null }]
));

// Position suivante pour une commande, ou null si elle est en bout de flux
// (Archivé) ou hors flux (Fiverr). Une commande posée sur une famille sans
// sous-étape précisée (« à préciser ») avance vers la 1re sous-étape de sa
// famille : c'est bien l'étape d'après pour elle.
function nextFlowStep(r) {
  if (!familyHasSub(r.stage)) {
    const i = FLOW.findIndex((p) => p.stage === r.stage && p.sub === null);
    return i >= 0 && i + 1 < FLOW.length ? FLOW[i + 1] : null;
  }
  if (!r.sub_stage) return FLOW.find((p) => p.stage === r.stage) || null;
  const i = FLOW.findIndex((p) => p.stage === r.stage && p.sub === r.sub_stage);
  return i >= 0 && i + 1 < FLOW.length ? FLOW[i + 1] : null;
}

const flowLabel = (p) => (p.sub ? `${STAGE_LABEL[p.stage]} · ${SUB_LABEL[p.sub]}` : STAGE_LABEL[p.stage]);

// --- Liens externes par catégorie (affichés dans l'en-tête de l'étape). -----
const STAGE_LINKS = {
  fiverr: { url: 'https://fr.fiverr.com/', label: 'Ouvrir Fiverr' },
};

// Cibles d'envoi rapide proposées sur chaque ligne (boutons « → … »).
const SEND_TARGETS = [
  { slug: 'fiverr', label: 'Fiverr' },
];

// --- État applicatif -------------------------------------------------------
let currentStage = 'demande';
let currentSub = null;         // sous-catégorie active (null = toute la famille)
let rows = [];                 // demandes de l'étape courante
let counts = {};               // compteurs par étape
let gridQuery = '';            // texte du filtre de recherche live (étape courante)
let sort = { key: null, dir: 1 }; // tri manuel via en-têtes (null = tri par défaut)
let lastRendered = [];         // dernière liste triée montée (pour le masquage recherche)
let catOwners = {};            // { slugCatégorie: employé }   → pilote NOMMÉ DE BASE
let catRefs = {};              // { slugCatégorie: [employés] } → référents NOMMÉS DE BASE
let whatsappMessage = '';      // message « commande prête » réglé par le patron
let booted = false;            // la grille est montée (start() est allé au bout)

// --- WhatsApp « votre commande est prête » ---------------------------------
// Chaque ligne dont le client a laissé un numéro porte une pastille WhatsApp :
// un clic ouvre la conversation avec le message DÉJÀ ÉCRIT. Rien ne part tout
// seul — c'est l'employé qui appuie sur Envoyer dans WhatsApp. Le texte se règle
// dans l'onglet Réglages (voir reglages.js) ; la mise au format international du
// numéro et le remplissage des jetons vivent dans whatsapp.js (règles pures).

// L'adresse wa.me d'une ligne du planning, ou null si son numéro est illisible
// (ou absent) — la ligne ne porte alors aucune pastille.
function rowWhatsappLink(r) {
  const d = parseDeadline(r.deadline);
  return whatsappLink(r.contact_phone, whatsappMessage, {
    client: r.billing_company || r.contact_referent || '',
    commande: r.product || r.description || '',
    date: d ? d.toLocaleDateString('fr-FR') : '',
  });
}

async function loadWhatsappMessage() {
  try {
    const data = await api('GET', '/api/settings/whatsapp');
    whatsappMessage = typeof data.message === 'string' ? data.message : '';
  } catch (_) { /* silencieux : la pastille ouvrira une conversation vide */ }
}

// --- Pilote / référent effectifs -------------------------------------------
// Chaque catégorie porte un pilote et des référents « de base » (config
// « Attribution des catégories », sous-étape prioritaire sur la famille) : une
// commande n'est donc JAMAIS sans nom. Ce qui est posé à la main sur la ligne
// prime — et n'importe quel collaborateur peut le changer à tout moment, ou
// revenir au nom de base en choisissant « Par défaut ».
const ownerOf = (family, sub) => (sub && catOwners[sub]) || catOwners[family] || null;

function referentsOf(family, sub) {
  const subList = sub && catRefs[sub];
  if (Array.isArray(subList) && subList.length) return subList;
  const famList = catRefs[family];
  return Array.isArray(famList) ? famList : [];
}

const isManualPilot = (r) => !!(r.responsable && EMPLOYEES.includes(r.responsable));
const isManualReferent = (r) => !!(r.referent && EMPLOYEES.includes(r.referent));
const effectivePilot = (r) => (isManualPilot(r) ? r.responsable : ownerOf(r.stage, r.sub_stage));
const effectiveReferents = (r) => (isManualReferent(r) ? [r.referent] : referentsOf(r.stage, r.sub_stage));

// Config d'attribution (pilote + référents de base). Silencieuse en cas
// d'échec : la grille reste utilisable, elle affiche juste « Qui ? ».
async function loadCategoryConfig() {
  try {
    const [owners, refs] = await Promise.all([
      api('GET', '/api/category-owners'),
      api('GET', '/api/category-referents'),
    ]);
    catOwners = owners && typeof owners === 'object' ? owners : {};
    catRefs = refs && typeof refs === 'object' ? refs : {};
  } catch (_) { /* silencieux */ }
}

// --- Sélecteurs ------------------------------------------------------------
const $stages = document.getElementById('stages');
const $rows = document.getElementById('rows');
const $empty = document.getElementById('empty');
const $stageTitle = document.getElementById('stageTitle');
const $stageCount = document.getElementById('stageCount');
const $btnNew = document.getElementById('btnNew');
const $stageLink = document.getElementById('stageLink');
const $stageLinkLabel = document.getElementById('stageLinkLabel');
const $stageDesc = document.getElementById('stageDesc');
const $stageHelp = document.getElementById('stageHelp');

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

// --- Guide de l'étape (explication du patron) ------------------------------
// Le guide de la vue courante : la sous-catégorie si l'une est active, sinon la
// famille. Certaines entrées (ex. Fiverr) n'ont pas de guide → renvoie null.
function currentGuide() {
  return STEP_GUIDE[currentSub] || STEP_GUIDE[currentStage] || null;
}

// Met à jour le sous-titre explicatif (toujours visible) et l'accès au guide
// complet, selon la famille / sous-catégorie affichée.
function updateStageHelp() {
  const g = currentGuide();
  if ($stageDesc) {
    $stageDesc.textContent = g ? g.desc : '';
    $stageDesc.hidden = !g;
  }
  if ($stageHelp) $stageHelp.hidden = !g;
  // Si le panneau est ouvert, on le recale sur la nouvelle étape.
  if (guideOpen) fillGuide();
}

// Remplit le panneau détaillé avec le texte de la vue courante.
function fillGuide() {
  const g = currentGuide();
  if (!g) { closeGuide(); return; }
  setText('guideTitle', currentViewLabel());
  setText('guideDesc', g.desc);
  setText('guideWho', g.who);
  setText('guideWhenIn', g.whenIn);
  setText('guideWhenOut', g.whenOut);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || '—';
}

const $guideOverlay = document.getElementById('guideOverlay');
let guideOpen = false;

function openGuide() {
  if (!currentGuide() || !$guideOverlay) return;
  fillGuide();
  $guideOverlay.hidden = false;
  guideOpen = true;
  requestAnimationFrame(() => $guideOverlay.classList.add('open'));
}

function closeGuide() {
  if (!$guideOverlay) return;
  $guideOverlay.classList.remove('open');
  guideOpen = false;
  // Laisse jouer la transition d'opacité avant de masquer.
  setTimeout(() => { if (!guideOpen) $guideOverlay.hidden = true; }, 180);
}

if ($stageHelp) $stageHelp.addEventListener('click', openGuide);
if ($guideOverlay) {
  const $guideClose = document.getElementById('guideClose');
  if ($guideClose) $guideClose.addEventListener('click', closeGuide);
  // Fermeture en tapant le fond (hors carte) : pratique au doigt sur tablette.
  $guideOverlay.addEventListener('click', (e) => { if (e.target === $guideOverlay) closeGuide(); });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && guideOpen) closeGuide(); });

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
// Une entrée de rail = une FAMILLE (sub omis) ou une SOUS-CATÉGORIE (sub fourni).
// La sous-catégorie porte data-slug = famille (cible de dépôt) + data-sub = sous-slug.
function buildStageEl(family, sub) {
  const isSub = !!sub;
  const slug = family.slug;
  const countKey = isSub ? sub.slug : slug;
  const el = document.createElement('div');
  el.className = 'stage' + (isSub ? ' substage' : '');
  el.dataset.slug = slug;
  if (isSub) el.dataset.sub = sub.slug;
  const active = isSub
    ? (currentStage === slug && currentSub === sub.slug)
    : (currentStage === slug && currentSub === null);
  if (active) el.classList.add('active');
  const n = counts[countKey] ?? 0;
  if (n === 0) el.classList.add('is-empty');
  const label = document.createElement('span');
  label.className = 'stage-label';
  label.textContent = isSub ? sub.label : family.label;
  const count = document.createElement('span');
  count.className = 'stage-count' + (n > 0 ? ' has-items' : '');
  count.textContent = n;
  el.append(label, count);
  el.addEventListener('click', () => selectStage(slug, isSub ? sub.slug : null));
  return el;
}

function renderSidebar() {
  $stages.replaceChildren();
  // Chaque FAMILLE est une ZONE : un grand titre (en-tête) qui coiffe ses
  // sous-catégories. On enveloppe le tout dans un bloc pour que l'œil isole d'un
  // coup une zone de la suivante (miroir de la « Vue Étapes » du CRM : total
  // famille + détail par sous-étape). Les catégories promues en onglet (voir
  // PROMOTED) n'y figurent plus : leur place est dans la barre du haut.
  FAMILIES.filter((f) => !RAIL_HIDDEN_STAGES.has(f.slug)).forEach((f) => {
    const zone = document.createElement('div');
    zone.className = 'stage-zone';
    const hasSub = familyHasSub(f.slug);
    if (hasSub) zone.classList.add('has-sub');
    const head = buildStageEl(f);
    head.classList.add('zone-head'); // le grand titre se lit comme un en-tête de zone
    zone.appendChild(head);
    if (hasSub) {
      SUB_STAGES[f.slug]
        .filter((sub) => !RAIL_HIDDEN_SUBS.has(sub.slug))  // promue en onglet
        .forEach((sub) => zone.appendChild(buildStageEl(f, sub)));
    }
    $stages.appendChild(zone);
  });
}

// Rejoue l'animation d'entrée des lignes (léger fondu décalé) au changement d'étape.
let stageEnterTimer = null;
function playStageEnter() {
  if (!$rows) return;
  $rows.classList.remove('stage-enter');
  void $rows.offsetWidth; // relance l'animation CSS
  $rows.classList.add('stage-enter');
  clearTimeout(stageEnterTimer);
  stageEnterTimer = setTimeout(() => $rows.classList.remove('stage-enter'), 600);
}

// Masque la colonne « Sous-étape » quand la famille courante n'a pas de
// sous-familles (Demande, Attente Client, Archivé, Fiverr) → vue plus aérée.
function updateSubColVisibility(slug) {
  const grid = document.getElementById('grid');
  if (grid) grid.classList.toggle('no-sub', !familyHasSub(slug));
}

// Vide la grille INSTANTANÉMENT au changement de famille : on ne laisse jamais les
// lignes (ni le compteur) de l'ancienne famille sous le nouvel entête pendant que
// les nouvelles données arrivent. La colonne « Sous-étape » et l'animation d'entrée
// sont posées avec la donnée (dans loadRows), pas avant — tout reste cohérent.
function clearGrid() {
  for (const [, entry] of rowEls) entry.tr.remove();
  rowEls.clear();
  for (const [, g] of groupEls) g.remove();
  groupEls.clear();
  rows = [];
  lastRendered = [];
  lastRowsSig = '';
  $stageCount.textContent = '';
  $empty.hidden = true; // pas de « Aucune commande » pendant le chargement
}

// Surbrillance du rail : une seule entrée active à la fois (famille OU sous-cat).
function paintSidebarActive() {
  document.querySelectorAll('.stage').forEach((el) => {
    const isSub = el.dataset.sub != null;
    const on = isSub
      ? (el.dataset.slug === currentStage && el.dataset.sub === currentSub)
      : (el.dataset.slug === currentStage && (el.dataset.sub != null ? false : currentSub === null));
    el.classList.toggle('active', on);
  });
}

// L'onglet allumé et la grille affichée ne doivent jamais se contredire :
// demander une AUTRE catégorie alors qu'on est sur l'onglet Fiverr / À commander
// (rail d'un saut depuis le dashboard, recherche globale…) ramène sur Planning,
// où le rail est visible. Défini ici, utilisé par selectStage ; la bascule de
// vue elle-même vit plus bas (setViewMode / applyHash).
function syncTabForStage(slug, sub) {
  const promoted = PROMOTED_BY_VIEW[viewMode];
  if (!promoted || (promoted.stage === slug && promoted.sub === sub)) return;
  location.hash = '#planning';
}

// Libellé d'en-tête : la sous-catégorie si l'une est active, sinon la famille.
function currentViewLabel() {
  if (currentSub && SUB_LABEL[currentSub]) return SUB_LABEL[currentSub];
  return STAGE_LABEL[currentStage];
}

async function selectStage(slug, sub = null) {
  const sameFamily = slug === currentStage;
  syncTabForStage(slug, sub ?? null);
  currentStage = slug;
  currentSub = sub ?? null;
  sort = { key: null, dir: 1 };
  // Réponse immédiate au clic : entête + surbrillance (c'est ce qu'on a cliqué,
  // donc jamais périmé). Le reste (colonnes, lignes, animation) suit la donnée.
  $stageTitle.textContent = currentViewLabel();
  updateStageLink(slug);
  updateStageHelp();
  updateFiverrTool(slug);
  paintSidebarActive();
  // Changer de sous-catégorie DANS la même famille ne recharge rien : les lignes
  // de la famille sont déjà en mémoire, on ne fait que re-filtrer (instantané).
  if (sameFamily && lastRowsSig !== '') {
    applySortAndRender();
    playStageEnter();
    return;
  }
  clearGrid();
  await loadRows();
  // Anime l'entrée des VRAIES lignes, seulement si cette sélection est toujours
  // celle affichée (un clic plus récent a pu prendre le relais entre-temps).
  if (currentStage === slug) playStageEnter();
}

// --- Chargement données ----------------------------------------------------
async function loadCounts() {
  counts = await api('GET', '/api/counts');
  document.querySelectorAll('.stage').forEach((el) => {
    // Sous-catégorie → compteur par sous-slug ; famille → total famille.
    const key = el.dataset.sub != null ? el.dataset.sub : el.dataset.slug;
    const n = counts[key] ?? 0;
    const c = el.querySelector('.stage-count');
    if (c) {
      c.textContent = n;
      c.classList.toggle('has-items', n > 0);
    }
    el.classList.toggle('is-empty', n === 0);
  });
}

// Jeton de chargement : deux clics rapides lancent deux fetch ; on ne monte QUE la
// réponse de la sélection la plus récente. Sinon une requête lente (ancienne famille)
// pourrait écraser une famille sélectionnée depuis → « bug d'affichage » à l'arrivée.
let loadToken = 0;
async function loadRows() {
  const slug = currentStage;
  const token = ++loadToken;
  const data = await api('GET', `/api/requests?stage=${encodeURIComponent(slug)}`);
  if (token !== loadToken || slug !== currentStage) return; // sélection dépassée
  rows = data;
  lastRowsSig = signature(rows);
  updateSubColVisibility(slug); // colonne « Sous-étape » posée AVEC la donnée
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
  if (r.stage !== currentStage) return false;
  if (currentSub === null) return true;
  return (r.sub_stage ?? null) === currentSub;
}

// --- Tri -------------------------------------------------------------------
function applySortAndRender() {
  // `rows` contient TOUTE la famille ; si une sous-catégorie est active, on ne
  // rend que les commandes qui en relèvent (filtre instantané, côté client).
  const base = currentSub === null
    ? rows
    : rows.filter((r) => (r.sub_stage ?? null) === currentSub);
  const sorted = [...base];
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

// Rang de tri de la colonne État : ce qui bloque remonte, le calme descend.
const FLAG_RANK = { bloque: 0, a_voir: 1 };

function cmp(a, b, key) {
  let va = a[key], vb = b[key];
  if (key === 'responsable') {
    // On trie sur le nom AFFICHÉ (pilote effectif), pas sur la colonne brute :
    // sinon toutes les lignes au pilote automatique se retrouvent groupées à vide.
    va = effectivePilot(a) ?? '';
    vb = effectivePilot(b) ?? '';
  }
  if (key === 'flag') {
    return (FLAG_RANK[va] ?? 2) - (FLAG_RANK[vb] ?? 2);
  }
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

// Force la reconstruction des lignes au prochain rendu. renderRows() ne remonte
// une ligne que si son `updated_at` a bougé ; or l'affichage dépend aussi de
// données EXTÉRIEURES à la ligne (pilote / référent de base d'une catégorie).
// Quand cette config change, on périme les signatures pour tout recalculer.
function invalidateRowCache(id) {
  if (id != null) {
    const entry = rowEls.get(String(id));
    if (entry) entry.sig = '';
    return;
  }
  for (const [, entry] of rowEls) entry.sig = '';
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
  paintZebra();
}

// Zébrage : pose la classe `.row-alt` une ligne visible sur deux, dans l'ordre
// d'affichage réel du <tbody>. On compte sur le DOM (et non sur nth-child CSS)
// parce que la recherche masque des lignes (.is-hidden) et le drag les réordonne :
// le zébrage doit suivre les lignes réellement affichées, pas leur index brut.
function paintZebra() {
  let i = 0;
  for (const tr of $rows.children) {
    if (tr.dataset.id == null || tr.classList.contains('is-hidden')) continue;
    tr.classList.toggle('row-alt', i % 2 === 1);
    i++;
  }
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
  // Teinte d'alerte posée ici : cellFlag() ne peut pas atteindre le <tr> tant que
  // sa cellule n'est pas montée (elle la remet à jour aux changements suivants).
  if (r.flag === 'bloque') tr.classList.add('is-bloque');
  else if (r.flag === 'a_voir') tr.classList.add('is-a-voir');

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
    attachTip(add, 'Ajouter — remplir cette ligne');
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
    attachTip(grip, 'glisser pour déplacer');
    grip.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.4"/><circle cx="11" cy="3" r="1.4"/><circle cx="5" cy="8" r="1.4"/><circle cx="11" cy="8" r="1.4"/><circle cx="5" cy="13" r="1.4"/><circle cx="11" cy="13" r="1.4"/></svg>';
    handleCell.appendChild(grip);
    attachDrag(grip, tr, r);
  }
  tdHandle.appendChild(handleCell);
  tr.appendChild(tdHandle);

  // étoiles : 1 à 3, attribuables au clic (réglent la priorité de la ligne)
  tr.appendChild(cellStars(r));
  // type : Pro / Perso / Asso / Revendeur (menu au clic)
  tr.appendChild(cellType(r));
  // responsable : QUI agit (puce cliquable) — la réponse du patron au « personne
  // ne remplit » : chaque projet porte un nom.
  tr.appendChild(cellResponsable(r));
  // nom du dossier client (référent / contact déplacés dans le popover contact)
  tr.appendChild(cellDossier(r));
  // description : ce qui est produit (ancien champ « produit »)
  tr.appendChild(cellDescription(r));
  // prix : montant HT — une ligne sans prix ne peut pas entrer en Facturation
  tr.appendChild(cellPrice(r));
  // sous-étape : puce précisant ce qui se passe maintenant dans la famille
  tr.appendChild(cellSubStage(r));
  // étape suivante : un clic pousse la commande à la position suivante du flux
  tr.appendChild(cellNext(r));
  // infos : notes libres multi-lignes (ancien champ « description »)
  tr.appendChild(cellInfos(r));
  // date souhaitée : badge relatif coloré (« En retard 1j », « 4j »), éditable au clic
  tr.appendChild(cellDeadline(r));
  // état : alerte posée par n'importe qui — BLOQUÉE (+ motif) ou À VOIR
  tr.appendChild(cellFlag(r));
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
      attachTip(send, `Envoyer vers ${t.label}`);
      send.setAttribute('aria-label', `Envoyer vers ${t.label}`);
      send.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13"/><path d="M13 6l6 6-6 6"/></svg><span>${escapeHtml(t.label)}</span>`;
      send.addEventListener('click', () => copyToStage(r, t.slug));
      tdDel.appendChild(send);
    }
  }
  const dup = document.createElement('button');
  dup.className = 'dup-btn';
  dup.type = 'button';
  attachTip(dup, 'Dupliquer cette commande');
  dup.setAttribute('aria-label', 'Dupliquer cette commande');
  dup.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  dup.addEventListener('click', () => duplicateRow(r));
  const del = document.createElement('button');
  del.className = 'del-btn';
  del.type = 'button';
  attachTip(del, 'Supprimer cette commande');
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

// Cellule étoiles (1 à 3) : attribuée au clic, règle la priorité de la ligne.
// Recliquer la même note ne fait rien ; changer de note enregistre en optimiste.
function cellStars(r) {
  const td = document.createElement('td');
  td.className = 'col-stars-cell';
  if (isDraftRow(r)) return td; // pas d'étoiles sur la ligne brouillon
  const wrap = document.createElement('div');
  wrap.className = 'grid-stars';
  attachTip(wrap, 'attribuer des étoiles (priorité)');
  const cur = prioBand(r);
  for (let i = 1; i <= 3; i++) {
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'grid-star' + (i <= cur ? ' on' : '');
    star.textContent = i <= cur ? '★' : '☆';
    star.setAttribute('aria-label', `${i} étoile${i > 1 ? 's' : ''} sur 3`);
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      if (prioBand(r) === i) return;
      patch(r, { priority: i }, () => {
        r.priority = i;
        for (let j = 0; j < wrap.children.length; j++) {
          const on = (j + 1) <= i;
          wrap.children[j].classList.toggle('on', on);
          wrap.children[j].textContent = on ? '★' : '☆';
        }
      });
    });
    wrap.appendChild(star);
  }
  td.appendChild(wrap);
  return td;
}

// Type de client : Pro / Perso / Asso / Revendeur. Menu au clic (4 valeurs).
function cellType(r) {
  const td = document.createElement('td');
  td.className = 'col-type';
  const type = document.createElement('button');
  type.type = 'button';
  const renderType = () => {
    const t = CLIENT_TYPES.find((x) => x.value === r.client_type) || CLIENT_TYPES[0];
    type.className = 'type-tag ' + t.cls;
    type.textContent = t.label;
  };
  renderType();
  attachTip(type, 'cliquer pour changer le type de client');
  type.addEventListener('click', (e) => {
    e.stopPropagation();
    openMenu(type, CLIENT_TYPES.map((t) => ({ value: t.value, label: t.label })), r.client_type, (val) => {
      if (val === r.client_type) return;
      patch(r, { client_type: val }, () => { r.client_type = val; renderType(); });
    });
  });
  td.appendChild(type);
  return td;
}

// Espace RESPONSABLE : QUI pilote le projet (puce principale) et QUI en est le
// référent (puce plus discrète en dessous). Les deux affichent le nom EFFECTIF —
// celui posé à la main sur la ligne, sinon le nom DE BASE de la catégorie
// (puce en pointillés), pour qu'aucune commande ne reste anonyme. N'importe quel
// collaborateur peut changer le référent (et le pilote) à tout moment, ou
// revenir au nom de base via « Par défaut ».
function cellResponsable(r) {
  const td = document.createElement('td');
  td.className = 'col-resp-cell';
  const stack = document.createElement('div');
  stack.className = 'resp-stack';

  // --- Pilote (responsable) ---
  const pilot = document.createElement('button');
  pilot.type = 'button';
  const renderPilot = () => {
    pilot.replaceChildren();
    const who = effectivePilot(r);
    const auto = !!who && !isManualPilot(r);
    if (who) {
      pilot.className = 'resp-chip' + (auto ? ' auto' : '');
      const ini = document.createElement('span');
      ini.className = 'resp-ini';
      ini.textContent = who.charAt(0).toUpperCase();
      const name = document.createElement('span');
      name.className = 'resp-name';
      name.textContent = who;
      // Pas de mot « auto » écrit dans la puce : la colonne est étroite et le NOM
      // est ce qui compte. Le liseré pointillé le signale, l'infobulle l'explique.
      pilot.append(ini, name);
    } else {
      pilot.className = 'resp-chip empty';
      const name = document.createElement('span');
      name.className = 'resp-name';
      name.textContent = 'Qui ?';
      pilot.append(name);
    }
    attachTip(pilot, auto
      ? `Pilote par défaut de la catégorie : ${who} — cliquer pour en nommer un autre`
      : 'assigner le pilote');
  };
  renderPilot();
  pilot.addEventListener('click', (e) => {
    e.stopPropagation();
    const base = ownerOf(r.stage, r.sub_stage);
    const items = RESPONSABLES.map((n) => ({ value: n, label: n }));
    items.push({ value: null, label: base ? `Par défaut (${base})` : 'Aucun', muted: true });
    openMenu(pilot, items, r.responsable ?? null, (val) => {
      if ((val ?? null) === (r.responsable ?? null)) return;
      patch(r, { responsable: val }, () => { r.responsable = val; renderPilot(); });
    });
  });

  // --- Référent (2e personne) : modifiable par n'importe quel collaborateur ---
  const ref = document.createElement('button');
  ref.type = 'button';
  const renderRef = () => {
    const who = effectiveReferents(r);
    const auto = who.length > 0 && !isManualReferent(r);
    if (who.length) {
      ref.className = 'ref-chip' + (auto ? ' auto' : '');
      ref.textContent = 'Réf. ' + who.join(', ');
      attachTip(ref, auto
        ? `Référent${who.length > 1 ? 's' : ''} par défaut de la catégorie : ${who.join(', ')} — cliquer pour en nommer un autre`
        : 'changer le référent');
    } else {
      ref.className = 'ref-chip empty';
      ref.textContent = '+ référent';
      attachTip(ref, 'ajouter un référent');
    }
  };
  renderRef();
  ref.addEventListener('click', (e) => {
    e.stopPropagation();
    const base = referentsOf(r.stage, r.sub_stage);
    const items = EMPLOYEES.map((n) => ({ value: n, label: n }));
    items.push({ value: null, label: base.length ? `Par défaut (${base.join(', ')})` : 'Aucun', muted: true });
    openMenu(ref, items, r.referent ?? null, (val) => {
      if ((val ?? null) === (r.referent ?? null)) return;
      patch(r, { referent: val }, () => { r.referent = val; renderRef(); });
    });
  });

  stack.append(pilot, ref);
  td.appendChild(stack);
  return td;
}

// Colonne ÉTAT : l'alerte que n'importe qui pose sur la commande — BLOQUÉE
// (avec le motif : pourquoi ça n'avance plus) ou À VOIR. Un clic ouvre le menu ;
// choisir une alerte enchaîne sur la saisie du motif (facultatif).
function cellFlag(r) {
  const td = document.createElement('td');
  td.className = 'col-flag-cell';
  const stack = document.createElement('div');
  stack.className = 'flag-stack';

  const btn = document.createElement('button');
  btn.type = 'button';
  const reason = document.createElement('button');
  reason.type = 'button';
  reason.className = 'flag-reason';

  const render = () => {
    const f = FLAG_BY_VALUE[r.flag];
    if (f) {
      btn.className = 'flag-chip ' + f.cls;
      btn.textContent = f.label;
      attachTip(btn, r.flag_reason ? `${f.label} — ${r.flag_reason}` : `${f.label} — ajouter un motif`);
      reason.textContent = r.flag_reason || '+ motif';
      reason.classList.toggle('empty', !r.flag_reason);
      reason.hidden = false;
      attachTip(reason, r.flag_reason ? `Motif : ${r.flag_reason}` : 'préciser le motif');
    } else {
      btn.className = 'flag-chip empty';
      btn.textContent = '+ état';
      attachTip(btn, 'signaler : BLOQUÉE (avec motif) ou À VOIR');
      reason.textContent = '';
      reason.hidden = true;
    }
    // La ligne entière se teinte : une commande bloquée doit sauter aux yeux.
    const tr = td.closest('tr');
    if (tr) {
      tr.classList.toggle('is-bloque', r.flag === 'bloque');
      tr.classList.toggle('is-a-voir', r.flag === 'a_voir');
    }
  };

  // Enregistre alerte + motif d'un bloc (un seul PATCH, un seul rollback).
  const save = (flag, motif) => {
    const body = { flag: flag ?? null, flag_reason: flag ? (motif || null) : null };
    if (body.flag === (r.flag ?? null) && body.flag_reason === (r.flag_reason ?? null)) return;
    patch(r, body, () => { r.flag = body.flag; r.flag_reason = body.flag_reason; render(); });
  };

  render();
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const items = FLAGS.map((f) => ({ value: f.value, label: f.label }));
    items.push({ value: null, label: 'Rien à signaler', muted: true });
    openMenu(btn, items, r.flag ?? null, (val) => {
      if (!val) return save(null, null);
      // Une alerte se justifie : on enchaîne sur le motif (validable à vide).
      openReasonPrompt(btn, FLAG_BY_VALUE[val].label, r.flag_reason || '', (motif) => save(val, motif));
    });
  });
  reason.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!r.flag) return;
    openReasonPrompt(reason, FLAG_BY_VALUE[r.flag].label, r.flag_reason || '', (motif) => save(r.flag, motif));
  });

  stack.append(btn, reason);
  td.appendChild(stack);
  return td;
}

// Bouton « étape suivante » : un clic envoie la commande à la position suivante
// du flux (sous-étape suivante, ou 1re sous-étape de la famille d'après). Rien à
// afficher en bout de flux (Archivé) ou hors flux (Fiverr).
function cellNext(r) {
  const td = document.createElement('td');
  td.className = 'col-next-cell';
  if (isDraftRow(r)) return td;
  const next = nextFlowStep(r);
  if (!next) return td;

  const btn = document.createElement('button');
  btn.className = 'next-btn';
  btn.type = 'button';
  const label = flowLabel(next);
  attachTip(btn, `Étape suivante → ${label}`);
  btn.setAttribute('aria-label', `Envoyer à l’étape suivante : ${label}`);
  btn.appendChild(arrowIcon());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTip();
    if (blockedByPrice(r, next.stage, next.sub)) {
      const msg = priceBlockMessage(next.stage, next.sub);
      showTip(btn, msg);
      showToast(msg);
      return;
    }
    showToast(`→ ${label}`);
    moveToStage(r, next.stage, next.sub);
  });
  td.appendChild(btn);
  return td;
}

// Flèche « suivant » construite en DOM (pas d'innerHTML) : même trait que les
// autres icônes de la grille.
function arrowIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '17');
  svg.setAttribute('height', '17');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M5 12h13', 'M12 5l7 7-7 7']) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

// Sous-étape : précise ce qui se passe MAINTENANT dans la famille. Puce
// cliquable ; menu des sous-familles de la famille + « Aucune ». Rien à afficher
// (et colonne masquée par CSS) pour les familles sans sous-étapes.
function cellSubStage(r) {
  const td = document.createElement('td');
  td.className = 'col-sub-cell';
  const subs = SUB_STAGES[r.stage];
  if (!subs || !subs.length) return td;
  const btn = document.createElement('button');
  btn.type = 'button';
  const render = () => {
    if (r.sub_stage && SUB_LABEL[r.sub_stage]) {
      btn.className = 'sub-chip';
      btn.textContent = SUB_LABEL[r.sub_stage];
    } else {
      btn.className = 'sub-chip empty';
      btn.textContent = 'à préciser';
    }
  };
  render();
  attachTip(btn, 'préciser la sous-étape');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const items = subs.map((s) => ({ value: s.slug, label: s.label }));
    items.push({ value: null, label: 'Aucune', muted: true });
    openMenu(btn, items, r.sub_stage ?? null, (val) => {
      if ((val ?? null) === (r.sub_stage ?? null)) return;
      patch(r, { sub_stage: val }, () => {
        r.sub_stage = val;
        render();
        // Si on filtre sur une sous-catégorie, la ligne peut sortir/entrer de la
        // vue courante : on re-filtre. Les pastilles se recalent au prochain SSE.
        if (currentSub !== null) applySortAndRender();
      });
    });
  });
  td.appendChild(btn);
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

  // Le nom du dossier et la pastille WhatsApp sur la MÊME ligne : le numéro
  // appartient au client, il se lit juste à côté de son nom.
  const line = document.createElement('div');
  line.className = 'client-line';
  line.appendChild(company);
  const wa = cellWhatsapp(r);
  if (wa) line.appendChild(wa);
  line.appendChild(cellPdfSlot(r, 'devis'));
  line.appendChild(cellPdfSlot(r, 'facture'));
  const pdfWa = cellPdfWhatsapp(r);
  if (pdfWa) line.appendChild(pdfWa);
  stack.appendChild(line);
  // Nature tranchée à la prise : DEMANDE (à chiffrer) ou COMMANDE (validée).
  // Les lignes créées à la main dans la grille n'en portent pas — on n'invente
  // pas la nature à la place de la personne qui saisit.
  if (r.order_kind === 'demande' || r.order_kind === 'commande') {
    const kind = document.createElement('span');
    kind.className = `kind-badge kind-badge--${r.order_kind}`;
    kind.textContent = r.order_kind === 'demande' ? 'Demande' : 'Commande';
    attachTip(kind, r.order_kind === 'demande'
      ? 'Demande reçue : reste à chiffrer'
      : 'Commande validée par le client');
    stack.appendChild(kind);
  }
  td.appendChild(stack);
  return td;
}

// Le logo WhatsApp, monté en DOM (pas en `innerHTML`) : c'est la seule icône de
// marque de l'application, Material Symbols n'en fournit pas.
const WA_GLYPH = 'M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 .01 16.47Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.79.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.09-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.47c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07s.89 2.4 1.01 2.56c.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.14-1.18-.06-.11-.22-.17-.47-.29Z';

function whatsappIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', WA_GLYPH);
  svg.appendChild(path);
  return svg;
}

// Icônes devis/facture construites en DOM (même trait que arrowIcon/whatsappIcon,
// pas d'innerHTML) : deux glyphes neutres et distincts, pour reconnaître la
// pastille au premier coup d'œil sans attendre l'infobulle.
function strokeIcon(paths) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

// Devis : une feuille avec des lignes de texte (un document à lire).
function devisIcon() {
  return strokeIcon([
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z',
    'M14 2v6h6',
    'M9 13h6',
    'M9 17h6',
  ]);
}

// Facture : un ticket au bord dentelé (une pièce à régler).
function factureIcon() {
  return strokeIcon([
    'M6 2h12v18l-3-2-3 2-3-2-3 2Z',
    'M9 7h6',
    'M9 11h6',
    'M9 15h3',
  ]);
}

// Libellés pour les infobulles des deux emplacements PDF de la ligne.
const PDF_SLOT_LABELS = {
  devis: { noun: 'devis', withArticle: 'le devis' },
  facture: { noun: 'facture', withArticle: 'la facture' },
};

// PUT brut (pas de JSON) : `api()` ne convient pas, il JSON.stringify toujours
// le corps. Le serveur lit le corps quel que soit son Content-Type.
async function uploadPdf(requestId, kind, file) {
  const url = `/api/requests/${requestId}/pdf/${kind}?name=${encodeURIComponent(file.name)}`;
  const res = await fetch(url, { method: 'PUT', body: await file.arrayBuffer() });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).error || detail; } catch (_) {}
    throw new Error(detail);
  }
  return res.json(); // { kind, filename }
}

// Déclenchée par la pastille WhatsApp dédiée (cellPdfWhatsapp) : télécharge le
// PDF ET ouvre la conversation WhatsApp du client VIERGE (aucun texte
// pré-rempli — le patron/employé tape son message à la main avec ses réponses
// rapides « / »). Glisser le fichier téléchargé dans la conversation puis
// Envoyer restent deux gestes manuels : aucun lien wa.me ne peut porter une
// pièce jointe.
function sendPdf(r, kind, filename) {
  const a = document.createElement('a');
  a.href = `/api/requests/${r.id}/pdf/${kind}`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  const lien = whatsappLink(r.contact_phone, '', {});
  if (lien) window.open(lien, '_blank', 'noopener,noreferrer');
}

const PDF_SLOT_ICON = { devis: devisIcon, facture: factureIcon };

// Pastille PDF à deux états, pour `devis` et `facture` (mêmes règles, icône
// propre à chaque type — cf. PDF_SLOT_ICON) :
//  - vide   : icône neutre, clic → sélecteur de fichier → upload immédiat.
//  - remplie : icône accentuée, clic → ouvre le PDF dans un nouvel onglet pour
//    le visualiser ; une petite croix apparaît au survol pour retirer le
//    fichier. L'envoi via WhatsApp est une pastille séparée (cellPdfWhatsapp).
// Toujours rendue (contrairement à cellWhatsapp) : un devis/une facture
// s'archive même sans numéro client lisible.
function cellPdfSlot(r, kind) {
  const label = PDF_SLOT_LABELS[kind];
  const icon = PDF_SLOT_ICON[kind];
  const filename = r[`${kind}_name`];
  const wrap = document.createElement('span');
  wrap.className = 'pdf-slot';

  if (!filename) {
    const lbl = document.createElement('label');
    lbl.className = 'pdf-btn pdf-btn--empty';
    attachTip(lbl, `Attacher ${label.withArticle}`);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf';
    input.hidden = true;
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      uploadPdf(r.id, kind, file)
        .then(({ filename: name }) => {
          input.blur();
          r[`${kind}_name`] = name;
          invalidateRowCache(r.id);
          applySortAndRender();
        })
        .catch(reportError);
    });
    lbl.appendChild(input);
    lbl.appendChild(icon());
    wrap.appendChild(lbl);
    return wrap;
  }

  const btn = document.createElement('a');
  btn.className = 'pdf-btn pdf-btn--filled';
  btn.href = `/api/requests/${r.id}/pdf/${kind}`;
  btn.target = '_blank';
  btn.rel = 'noopener noreferrer';
  const labelCap = label.noun.charAt(0).toUpperCase() + label.noun.slice(1);
  attachTip(btn, `${labelCap} : ${filename} — clic pour visualiser`);
  btn.appendChild(icon());
  wrap.appendChild(btn);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'pdf-btn__remove';
  remove.setAttribute('aria-label', `Retirer ${label.withArticle}`);
  remove.textContent = '×';
  remove.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    api('DELETE', `/api/requests/${r.id}/pdf/${kind}`)
      .then(() => {
        remove.blur();
        r[`${kind}_name`] = null;
        invalidateRowCache(r.id);
        applySortAndRender();
      })
      .catch(reportError);
  });
  wrap.appendChild(remove);
  return wrap;
}

// Pastille d'envoi WhatsApp du devis/de la facture : présente UNIQUEMENT si au
// moins un des deux est attaché ET que le numéro du client est lisible (sinon
// il n'y a rien à envoyer, ou personne à qui l'envoyer). La facture prime sur
// le devis quand les deux sont attachés — c'est elle qui part en priorité en
// fin de production. Réutilise le style de la pastille WhatsApp de marque
// (.wa-btn) : c'est la même action (envoyer via WhatsApp), sur un fichier
// différent de « commande prête ».
function cellPdfWhatsapp(r) {
  const kind = r.facture_name ? 'facture' : r.devis_name ? 'devis' : null;
  if (!kind) return null;
  const filename = r[`${kind}_name`];
  const lien = whatsappLink(r.contact_phone, '', {});
  if (!lien) return null;
  const label = PDF_SLOT_LABELS[kind];

  const a = document.createElement('a');
  a.className = 'wa-btn';
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.href = lien;
  a.setAttribute('aria-label', `Envoyer ${label.withArticle} par WhatsApp`);
  attachTip(a, `Envoyer ${label.withArticle} par WhatsApp (${filename})`);
  a.appendChild(whatsappIcon());
  a.addEventListener('click', (e) => {
    e.preventDefault();
    sendPdf(r, kind, filename);
  });
  return a;
}

// Pastille WhatsApp : présente UNIQUEMENT si le client a laissé un numéro
// lisible. Un clic ouvre WhatsApp (application sur la tablette, WhatsApp Web sur
// le PC) avec le message du patron déjà écrit — l'employé n'a plus qu'à relire
// et appuyer sur Envoyer. Renvoie null quand il n'y a pas de numéro : la ligne
// ne porte alors aucune pastille morte.
// L'adresse est recalculée AU CLIC et pas seulement au rendu : le nom du
// dossier, la description ou le message du patron ont pu changer depuis que la
// ligne est à l'écran, et c'est le texte du moment qu'il faut envoyer.
function cellWhatsapp(r) {
  const lien = rowWhatsappLink(r);
  if (!lien) return null;
  const a = document.createElement('a');
  a.className = 'wa-btn';
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.href = lien;
  a.setAttribute('aria-label', 'Prévenir le client sur WhatsApp que sa commande est prête');
  attachTip(a, 'WhatsApp — prévenir que la commande est prête');
  a.appendChild(whatsappIcon());
  a.addEventListener('click', (e) => {
    const href = rowWhatsappLink(r);
    if (!href) { e.preventDefault(); return; }
    a.href = href;
  });
  return a;
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

// Prix : montant HT de la commande. Une ligne sans prix ne peut pas ENTRER dans la
// zone Devis à envoyer → Archivé (voir blockedByPrice plus bas) — affiché ici pour
// que la saisie se fasse tôt, pas au moment du glisser-déposer.
function cellPrice(r) {
  const td = document.createElement('td');
  td.className = 'col-price-cell';

  const price = document.createElement('input');
  price.className = 'cell-input num cell-price';
  price.type = 'text';
  price.inputMode = 'decimal';
  price.value = r.project_value != null ? String(r.project_value) : '';
  price.placeholder = '—';
  bindInline(
    price, r, 'project_value',
    (raw) => {
      const t = raw.trim();
      return t === '' ? null : parseFloat(t.replace(',', '.'));
    },
    (raw) => {
      const t = raw.trim();
      if (t === '') return '';
      const n = parseFloat(t.replace(',', '.'));
      return Number.isNaN(n) ? raw : n.toFixed(2);
    },
  );

  td.appendChild(price);
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
  attachTip(toggle, 'Afficher / masquer les lignes suivantes');
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
      attachTip(badge, 'cliquer pour choisir une date');
    } else {
      let cls, label;
      if (d > 0) { cls = d <= 7 ? 'orange' : 'green'; label = `${d} j`; }
      else if (d === 0) { cls = 'orange'; label = "Aujourd'hui"; }
      else { cls = 'red'; label = `En retard ${-d} j`; }
      badge.className = `deadline-badge ${cls}`;
      badge.textContent = label;
      const dd = parseDeadline(r.deadline);
      attachTip(badge, (dd ? dd.toLocaleDateString('fr-FR') : '') + ' — cliquer pour modifier');
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

// --- Infobulles maison -----------------------------------------------------
// L'attribut `title` déclenche la bulle système de Chrome : grise, hors charte,
// lente à venir puis longue à partir — elle se superposait au calendrier qu'on
// vient d'ouvrir. On la remplace par une bulle aux tokens du thème.
// Souris et clavier seulement : au doigt (tablette), une infobulle gênerait le
// tap sans rien apporter. `aria-label` porte le texte pour les lecteurs d'écran.
const TIP_DELAY = 400;
let tipEl = null;
let tipTimer = 0;

function hideTip() {
  clearTimeout(tipTimer);
  if (tipEl) { tipEl.remove(); tipEl = null; }
}

function showTip(anchor, text) {
  hideTip();
  // L'ancre a pu être démontée (re-rendu de la ligne) pendant le délai.
  if (!anchor.isConnected) return;
  tipEl = document.createElement('div');
  tipEl.className = 'tip';
  tipEl.textContent = text;
  document.body.appendChild(tipEl);
  const a = anchor.getBoundingClientRect();
  const t = tipEl.getBoundingClientRect();
  let left = Math.round(a.left + (a.width - t.width) / 2);
  left = Math.min(Math.max(8, left), window.innerWidth - t.width - 8);
  let top = Math.round(a.bottom + 8);
  if (top + t.height > window.innerHeight - 8) top = Math.round(a.top - t.height - 8);
  tipEl.style.left = left + 'px';
  tipEl.style.top = Math.max(8, top) + 'px';
}

// Remplace `el.title = texte` : même intention, bulle maison. Ré-appelable sur
// un même élément pour changer le texte (bouton plein écran) sans réempiler
// d'écouteurs — on lit donc le texte au survol, pas à la capture.
function attachTip(el, text) {
  el.setAttribute('aria-label', text);
  el.tipText = text;
  if (el.tipBound) return;
  el.tipBound = true;
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return; // pas d'infobulle au doigt / stylet
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showTip(el, el.tipText), TIP_DELAY);
  });
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('pointerdown', hideTip); // le clic ouvre un popup : la bulle dégage
  // Au clavier seulement : un clic souris donne aussi le focus, et la bulle
  // reviendrait aussitôt se poser sur le calendrier qu'on vient d'ouvrir.
  el.addEventListener('focus', () => {
    if (el.matches(':focus-visible')) showTip(el, el.tipText);
  });
  el.addEventListener('blur', hideTip);
}

// Filets de sécurité : une ancre peut disparaître sans pointerleave (ligne
// re-rendue, grille défilée, onglet changé) — la bulle resterait orpheline.
window.addEventListener('scroll', hideTip, true);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); }, true);

// --- Menu déroulant réutilisable (type / responsable / sous-étape) ---------
// Petit popover ancré à une puce : liste d'options, fermé au clic dehors / Échap.
// Même idiome de popup que le calendrier. items : [{ value, label, muted? }].
let openMenuEl = null;
function closeMenu() {
  if (!openMenuEl) return;
  openMenuEl.remove();
  openMenuEl = null;
  document.removeEventListener('pointerdown', onMenuDocDown, true);
  document.removeEventListener('keydown', onMenuKey, true);
}
function onMenuDocDown(e) {
  if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu();
}
function onMenuKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } }

function openMenu(anchor, items, current, onPick) {
  closeMenu();
  closeCalendar();
  const menu = document.createElement('div');
  menu.className = 'menu-pop';
  items.forEach((it) => {
    const b = document.createElement('button');
    b.type = 'button';
    const isSel = (it.value ?? null) === (current ?? null);
    b.className = 'menu-item' + (it.muted ? ' muted' : '') + (isSel ? ' selected' : '');
    b.textContent = it.label;
    b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); onPick(it.value); });
    menu.appendChild(b);
  });

  document.body.appendChild(menu);
  const pr = anchor.getBoundingClientRect();
  const cr = menu.getBoundingClientRect();
  let top = pr.bottom + 4;
  if (top + cr.height > window.innerHeight - 8) top = pr.top - cr.height - 4;
  let left = pr.left;
  if (left + cr.width > window.innerWidth - 8) left = window.innerWidth - cr.width - 8;
  menu.style.top = Math.max(8, Math.round(top)) + 'px';
  menu.style.left = Math.max(8, Math.round(left)) + 'px';

  openMenuEl = menu;
  setTimeout(() => {
    document.addEventListener('pointerdown', onMenuDocDown, true);
    document.addEventListener('keydown', onMenuKey, true);
  }, 0);
}

// --- Saisie du motif d'alerte (popover) ------------------------------------
// « BLOQUÉE — pourquoi ? » : petit popover ancré à la puce d'état, même idiome
// que le menu. Le motif est FACULTATIF (Entrée / Enregistrer valide même vide),
// pour ne jamais bloquer quelqu'un qui veut juste signaler vite fait.
// Réutilise openMenuEl : ouvrir l'un ferme l'autre, un clic dehors ferme tout.
function openReasonPrompt(anchor, title, value, onSave) {
  closeMenu();
  closeCalendar();
  const pop = document.createElement('div');
  pop.className = 'menu-pop reason-pop';

  const head = document.createElement('div');
  head.className = 'reason-title';
  head.textContent = `${title} — motif`;

  const input = document.createElement('textarea');
  input.className = 'reason-input';
  input.rows = 2;
  input.maxLength = FLAG_REASON_MAX;
  input.value = value || '';
  input.placeholder = 'ex. attente du BAT signé par le client';

  const actions = document.createElement('div');
  actions.className = 'reason-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'reason-btn';
  cancel.textContent = 'Annuler';
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'reason-btn primary';
  ok.textContent = 'Enregistrer';
  actions.append(cancel, ok);

  const commit = () => { const v = input.value.trim(); closeMenu(); onSave(v); };
  ok.addEventListener('click', (e) => { e.stopPropagation(); commit(); });
  cancel.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); });
  // Entrée valide (Maj+Entrée = retour à la ligne) : saisie au clavier sans souris.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
  });

  pop.append(head, input, actions);
  document.body.appendChild(pop);
  const pr = anchor.getBoundingClientRect();
  const cr = pop.getBoundingClientRect();
  let top = pr.bottom + 4;
  if (top + cr.height > window.innerHeight - 8) top = pr.top - cr.height - 4;
  let left = pr.left;
  if (left + cr.width > window.innerWidth - 8) left = window.innerWidth - cr.width - 8;
  pop.style.top = Math.max(8, Math.round(top)) + 'px';
  pop.style.left = Math.max(8, Math.round(left)) + 'px';

  openMenuEl = pop;
  setTimeout(() => {
    document.addEventListener('pointerdown', onMenuDocDown, true);
    document.addEventListener('keydown', onMenuKey, true);
    input.focus();
    input.select();
  }, 0);
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

    // Échéances rapides : quand le client n'a pas donné de date, la vendeuse pose
    // une cible en un tap (aujourd'hui + N jours). Ne dépend pas du mois affiché.
    const quick = document.createElement('div');
    quick.className = 'cal-quick';
    const qlab = document.createElement('span');
    qlab.className = 'cal-quick-label';
    qlab.textContent = 'Sous';
    quick.appendChild(qlab);
    [5, 7, 10, 15].forEach((n) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cal-quick-btn'; b.textContent = `${n} j`;
      const t = new Date(today); t.setDate(t.getDate() + n);
      attachTip(b, t.toLocaleDateString('fr-FR'));
      b.setAttribute('aria-label', `Échéance dans ${n} jours (${t.toLocaleDateString('fr-FR')})`);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onPick(ymd(t.getFullYear(), t.getMonth(), t.getDate()));
        closeCalendar();
      });
      quick.appendChild(b);
    });
    cal.appendChild(quick);

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
    // Créée depuis une sous-catégorie → elle en hérite (sinon la ligne
    // n'apparaîtrait pas dans la vue filtrée où on vient de la créer).
    sub_stage: currentSub, responsable: null, referent: null,
    order_kind: null,
    flag: null, flag_reason: null,
    priority: 1, client_type: 'pro',
    billing_company: null, contact_referent: null, contact_phone: null, contact_email: null,
    quantity: null, product: null, color: null, project_value: null,
    description: null, deadline: null,
    position: maxPos + 1000,
    devis_name: null, bat_name: null, facture_name: null,
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
  const viewSub = currentSub;    // sous-catégorie éventuelle, figée de même
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

  api('POST', '/api/requests', viewSub ? { stage: viewSlug, sub_stage: viewSub } : { stage: viewSlug })
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
    // On ne transporte la sous-étape que si la commande reste dans sa famille
    // (une copie « Envoyer vers … » change de famille → sous-étape repartie à zéro).
    sub_stage: (!stage || stage === r.stage) ? (r.sub_stage ?? null) : null,
    // La nature (demande / commande) est une propriété du dossier, pas de sa
    // place dans le flux : une copie la garde, où qu'on l'envoie.
    order_kind: r.order_kind ?? null,
    responsable: r.responsable ?? null,
    referent: r.referent ?? null,
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
    // `flag` / `flag_reason` volontairement NON copiés : une copie repart d'une
    // page blanche, elle n'hérite pas du blocage de l'originale.
  };
}

// Duplique une commande (optimiste) : la copie reste dans la même étape et
// apparaît tout de suite. Les PDF ne sont pas recopiés (comme côté serveur).
function duplicateRow(r) {
  const maxPos = rows.reduce((m, x) => Math.max(m, x.position ?? 0), 0);
  const now = new Date().toISOString();
  const tmpId = `tmp-${++tmpSeq}`;
  const copy = {
    ...r, id: tmpId, devis_name: null, bat_name: null, facture_name: null,
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
// Cible Facturation actuellement affichée comme refusée (classe + bulle visibles),
// pour ne rafraîchir la bulle qu'au changement de cible, pas à chaque frame de survol.
let priceBlockedEl = null;

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

// --- Blocage prix : zone « Devis à envoyer » → Archivé (glisser-déposer + étape
// suivante) ------------------------------------------------------------------
// Le devis fixe le prix : une commande sans prix ne peut pas ENTRER dans cette
// zone (sous-étape Devis à envoyer, ou toute famille après Commande/Chiffrage —
// Attente Client, Préparation, Production, Facturation, Terminé, Archivé) depuis
// une position en dehors. Une fois la ligne dans la zone, tous les mouvements
// internes (réordonner, changer de sous-étape, revenir en arrière dans la zone)
// restent toujours possibles, même si le prix venait à manquer entre-temps : la
// règle ne verrouille que l'ENTRÉE, jamais les mouvements internes.
function hasPrice(r) {
  return r.project_value != null;
}

function inPriceZone(stage, sub) {
  if (stage === 'chiffrage') return sub === 'devis_a_envoyer';
  const idx = STAGE_ORDER[stage];
  const chiffrageIdx = STAGE_ORDER.chiffrage;
  return idx != null && chiffrageIdx != null && idx > chiffrageIdx;
}

function blockedByPrice(r, targetStage, targetSub = null) {
  if (hasPrice(r)) return false;
  if (!inPriceZone(targetStage, targetSub)) return false;
  return !inPriceZone(r.stage, r.sub_stage ?? null);
}

function priceBlockMessage(targetStage, targetSub) {
  const label = targetStage === 'chiffrage' && targetSub
    ? SUB_LABEL[targetSub]
    : STAGE_LABEL[targetStage];
  return `Sans prix, impossible de passer en ${label}.`;
}

// Une entrée du rail accepte-t-elle qu'on y DÉPOSE la ligne `r` ?
// Un GRAND TITRE qui a des sous-catégories n'est JAMAIS une cible : la ligne doit
// atterrir sur une sous-catégorie précise, pas rester « à préciser » sur le titre.
// Les familles sans sous-catégorie (Demande, Attente Client, Archivé) et Fiverr
// restent des cibles directes — il n'y a rien de plus fin où viser.
function stageAcceptsDrop(stageEl, r) {
  const slug = stageEl.dataset.slug;
  const isSub = stageEl.dataset.sub != null;
  if (!isSub && familyHasSub(slug)) return false;          // en-tête de zone : verrouillé
  const sub = isSub ? stageEl.dataset.sub : null;
  if (blockedByPrice(r, slug, sub)) return false;            // pas de prix : entrée refusée
  return slug !== r.stage || sub !== (r.sub_stage ?? null); // exclut la place actuelle
}

function updateDragTarget() {
  if (!dragState) return;
  dragState.raf = 0;
  const x = dragState.lastX, y = dragState.lastY;
  const el = document.elementFromPoint(x, y);
  document.querySelectorAll('.stage.drop-target').forEach((s) => s.classList.remove('drop-target'));
  document.querySelectorAll('.stage.drop-blocked').forEach((s) => s.classList.remove('drop-blocked'));
  const stageEl = el && el.closest ? el.closest('.stage') : null;
  let blockedEl = null;
  if (stageEl) {
    const stageSub = stageEl.dataset.sub != null ? stageEl.dataset.sub : null;
    if (stageAcceptsDrop(stageEl, dragState.r)) {
      stageEl.classList.add('drop-target');
    } else if (blockedByPrice(dragState.r, stageEl.dataset.slug, stageSub)) {
      stageEl.classList.add('drop-blocked');
      blockedEl = stageEl;
    }
  } else {
    // réordonnancement vertical dans la grille
    const after = getDragAfterElement($rows, y);
    if (after == null) $rows.appendChild(dragState.tr);
    else if (after !== dragState.tr) $rows.insertBefore(dragState.tr, after);
    paintZebra(); // garder les bandes cohérentes pendant le réordonnancement
  }
  if (blockedEl !== priceBlockedEl) {
    priceBlockedEl = blockedEl;
    if (blockedEl) {
      const sub = blockedEl.dataset.sub != null ? blockedEl.dataset.sub : null;
      showTip(blockedEl, priceBlockMessage(blockedEl.dataset.slug, sub));
    } else hideTip();
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
  document.querySelectorAll('.stage.drop-blocked').forEach((s) => s.classList.remove('drop-blocked'));
  hideTip();
  priceBlockedEl = null;
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

  if (stageEl) {
    // Relâché sur le rail. Une cible valide (sous-catégorie, ou famille sans
    // sous-catégorie) déplace la ligne ; un grand titre À sous-catégories la
    // refuse (on guide vers une sous-catégorie) ; même place = rien à faire.
    if (stageAcceptsDrop(stageEl, ds.r)) {
      const slug = stageEl.dataset.slug;
      const sub = stageEl.dataset.sub != null ? stageEl.dataset.sub : null;
      await moveToStage(ds.r, slug, sub);
    } else {
      if (stageEl.dataset.sub == null && familyHasSub(stageEl.dataset.slug)) {
        showToast('Dépose la ligne sur une sous-catégorie, pas sur le titre.');
      } else {
        const sub = stageEl.dataset.sub != null ? stageEl.dataset.sub : null;
        if (blockedByPrice(ds.r, stageEl.dataset.slug, sub)) {
          showToast(priceBlockMessage(stageEl.dataset.slug, sub));
        }
      }
      applySortAndRender(); // rien n'a bougé : on rétablit l'ordre trié de la grille
    }
  } else {
    await commitReorder(ds.r); // déposé dans la grille → réordonnancement
  }
}

// Déplace une commande vers une famille (targetSub null) ou directement vers une
// sous-catégorie (targetSub = sous-slug de la MÊME famille que `slug`).
function moveToStage(r, slug, targetSub = null) {
  const prevRows = rows;
  const prevStage = r.stage;
  const prevSub = r.sub_stage;
  const viewSlug = currentStage;
  // Changer de famille invalide toute ancienne sous-étape : on ne transporte pas,
  // p. ex., « Production UV » dans « Facturation ». Déposer sur une sous-catégorie
  // la pose directement ; déposer sur l'en-tête de famille la remet à zéro.
  const familyChanged = slug !== r.stage;
  r.stage = slug;
  r.sub_stage = targetSub;
  if (familyChanged) {
    // La ligne quitte la famille affichée : on la retire de la vue courante.
    rows = rows.filter((x) => x.id !== r.id);
    bumpCount(viewSlug, -1);
    bumpCount(slug, +1);
  }
  // Même famille, seule la sous-étape change : la ligne reste dans `rows` ; le
  // filtre de sous-catégorie (applySortAndRender) l'affiche ou la masque. On
  // périme sa signature pour que la puce de sous-étape, le pilote de base et la
  // flèche « étape suivante » se recalculent tout de suite (sans attendre le SSE).
  invalidateRowCache(r.id);
  applySortAndRender();
  api('PATCH', `/api/requests/${r.id}`, { stage: slug, sub_stage: targetSub }).catch((err) => {
    rows = prevRows;
    r.stage = prevStage;
    r.sub_stage = prevSub;
    lastRowsSig = signature(rows);
    if (familyChanged) { bumpCount(viewSlug, +1); bumpCount(slug, -1); }
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
const COLW_KEY = 'olda_col_widths_v5';
const COL_MIN = 36; // largeur plancher en px, toutes colonnes
const $grid = document.getElementById('grid');
const COL_ELS = [...document.querySelectorAll('#grid colgroup col')];
const COL_KEYS = COL_ELS.map((c) => c.dataset.col);
// Largeurs naturelles (miroir des .col-* du CSS) : sert de repli quand une
// colonne est masquée (offsetWidth 0) au moment de figer les largeurs manuelles,
// pour qu'elle reprenne une largeur utile — pas le plancher — en réapparaissant.
const COL_DEFAULTS = {
  handle: 52, stars: 78, client_type: 96, responsable: 148, flag: 138, client: 210, product: 220,
  price: 92, sub_stage: 170, next: 56, description: 210, deadline: 136, del: 200,
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
    if (key === 'del' || key === 'next') return; // colonnes d'actions : pas de poignée
    const h = document.createElement('span');
    h.className = 'col-resizer';
    attachTip(h, 'glisser pour régler la largeur');
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
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); }, 2600);
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
  if (openMenuEl) return true;   // menu (type / responsable / sous-étape) ouvert
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
  // Le patron vient de changer l'attribution des catégories : les pilotes et
  // référents « de base » affichés sur les lignes doivent suivre immédiatement.
  let kind = null;
  try { kind = JSON.parse(e && e.data ? e.data : '{}').kind; } catch (_) {}
  if (kind === 'category-owners' || kind === 'category-referents') {
    loadCategoryConfig().then(() => { invalidateRowCache(); applySortAndRender(); });
  }
  // Le patron vient de réécrire le message WhatsApp : les pastilles des lignes
  // doivent ouvrir le NOUVEAU texte, sans recharger la page.
  if (kind === 'settings') loadWhatsappMessage();
  // Le planning a changé côté serveur → le cache global de recherche est périmé.
  // On l'invalide, et si la palette est ouverte on recharge + ré-affiche.
  allRows = null;
  if (paletteOpen) loadAllRows().then(() => { if (paletteOpen) runSearch(); }).catch(() => {});
  // coalesce les rafales (plusieurs modifs quasi simultanées) en un seul refresh
  clearTimeout(streamDebounce);
  streamDebounce = setTimeout(() => {
    // Le dashboard maintient son cache en continu (fil d'activité, badges,
    // écran mural), même quand on est sur le Planning.
    dashboard.notifyChange();
    if (isPlanningMode(viewMode)) poll();
  }, 120);
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
  setInterval(() => { if (!streamAlive) { poll(); dashboard.notifyChange(); } }, POLL_MS);
  // rafraîchit immédiatement quand on revient sur l'onglet / réveille la tablette
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { poll(); dashboard.notifyChange(); }
  });
}

// --- Recherche live : filtre la grille de l'étape courante -----------------
// Le champ inline (work-head) filtre en direct les lignes affichées par
// société / référent / produit / description / contact. ⌘K (ou Ctrl+K) place
// le curseur dans le champ ; Échap efface le filtre puis rend la main.
const SEARCH_FIELDS = ['billing_company', 'contact_referent', 'product', 'color', 'description', 'contact_phone', 'contact_email', 'responsable', 'referent', 'flag_reason'];

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

// ===========================================================================
// Recherche GLOBALE (palette « Spotlight ») — cherche dans TOUTES les étapes.
// ===========================================================================
// Peu importe la catégorie affichée : on tape, on voit les commandes de tout le
// planning qui correspondent, groupées par étape. Un clic (ou ↵) saute vers la
// commande dans sa catégorie et la met brièvement en évidence.
//
// Données : on charge TOUT le planning une fois (cache `allRows`) à la première
// frappe, puis on l'invalide au moindre changement temps réel (SSE) pour rester
// juste sans re-fetch à chaque touche.

const $palette = document.getElementById('searchPalette');
const $paletteScrim = document.getElementById('searchPaletteScrim');
const $paletteResults = document.getElementById('searchPaletteResults');
const $paletteCount = document.getElementById('searchPaletteCount');

let allRows = null;           // cache de toutes les commandes (tous stages)
let allRowsPromise = null;    // fetch en cours (dédup)
let paletteOpen = false;
let paletteItems = [];        // résultats plats, dans l'ordre affiché
let paletteActive = -1;       // index surligné (navigation clavier)
const PALETTE_MAX = 60;       // plafond d'affichage (au-delà : « affinez »)

// Ordre d'affichage des groupes = ordre du pipeline (familles puis spécial).
const STAGE_ORDER = Object.fromEntries(STAGES.map((s, i) => [s.slug, i]));

// Recharge le cache global depuis le serveur (une requête, dédupliquée).
function loadAllRows() {
  if (allRowsPromise) return allRowsPromise;
  allRowsPromise = api('GET', '/api/requests')
    .then((data) => { allRows = data; return data; })
    .finally(() => { allRowsPromise = null; });
  return allRowsPromise;
}

// Découpe la requête en jetons (espaces) ; une commande matche si CHAQUE jeton
// est présent dans l'un de ses champs cherchés (accent- et casse-insensible).
function matchRow(r, tokens) {
  const hay = ' ' + SEARCH_FIELDS.map((f) => fold(r[f])).join(' ') + ' ';
  return tokens.every((t) => hay.includes(t));
}

// Ajoute `text` à `parent` en soulignant (<mark>) les occurrences des jetons.
// Accent-sensible (suffisant visuellement) ; construit des nœuds DOM, pas d'HTML.
function appendHighlighted(parent, text, tokens) {
  const s = String(text == null ? '' : text);
  if (!s) return;
  const esc = tokens
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  if (!esc.length) { parent.appendChild(document.createTextNode(s)); return; }
  const re = new RegExp('(' + esc.join('|') + ')', 'gi');
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index > last) parent.appendChild(document.createTextNode(s.slice(last, m.index)));
    const mark = document.createElement('mark');
    mark.textContent = m[0];
    parent.appendChild(mark);
    last = m.index + m[0].length;
  }
  if (last < s.length) parent.appendChild(document.createTextNode(s.slice(last)));
}

// Libellé + classe couleur de l'échéance, pour la pastille du résultat.
function deadlineChip(r) {
  const d = daysLeft(r.deadline);
  if (r.deadline == null || d === null) return null;
  if (d > 0) return { cls: d <= 7 ? 'orange' : 'green', label: `${d} j` };
  if (d === 0) return { cls: 'orange', label: 'Auj.' };
  return { cls: 'red', label: `-${-d} j` };
}

const $palettePanel = $palette ? $palette.querySelector('.search-palette-panel') : null;

// Ancre le panneau juste sous la pilule de recherche, aligné à gauche, largeur
// bornée. Sur mobile la pilule occupe toute la barre → le panneau prend toute la
// largeur automatiquement (le clamp gère les deux cas).
function positionPalette() {
  if (!$palettePanel || !$gridSearch) return;
  const r = $gridSearch.getBoundingClientRect();
  const width = Math.min(Math.max(r.width, 360), window.innerWidth - 24);
  let left = r.left;
  left = Math.min(left, window.innerWidth - width - 12);
  left = Math.max(12, left);
  $palettePanel.style.left = `${Math.round(left)}px`;
  $palettePanel.style.top = `${Math.round(r.bottom + 8)}px`;
  $palettePanel.style.width = `${Math.round(width)}px`;
}

const $topbar = document.querySelector('.topbar');

function openPalette() {
  if (paletteOpen) return;
  paletteOpen = true;
  $palette.hidden = false;
  // La barre du haut passe AU-DESSUS de l'assombrissement : le champ (et sa
  // croix) restent cliquables et bien nets pendant la recherche.
  if ($topbar) $topbar.classList.add('searching');
  positionPalette();
  requestAnimationFrame(() => $palette.classList.add('open'));
}

window.addEventListener('resize', () => { if (paletteOpen) positionPalette(); });

function closePalette() {
  if (!paletteOpen) return;
  paletteOpen = false;
  paletteActive = -1;
  if ($topbar) $topbar.classList.remove('searching');
  $palette.classList.remove('open');
  setTimeout(() => { if (!paletteOpen) $palette.hidden = true; }, 200);
}

// (Re)calcule et rend les résultats à partir de la requête courante.
function runSearch() {
  const raw = gridQuery.trim();
  if (!raw) { closePalette(); return; }
  openPalette();
  // Cache vide → on lance le chargement et on ré-affiche à l'arrivée.
  if (!allRows) {
    renderPaletteLoading();
    loadAllRows().then(() => { if (paletteOpen) runSearch(); }).catch(() => {});
    return;
  }
  const tokens = fold(raw).split(/\s+/).filter(Boolean);
  const hits = allRows
    .filter((r) => !isDraftRow(r) && matchRow(r, tokens))
    .sort((a, b) => {
      const sa = STAGE_ORDER[a.stage] ?? 99, sb = STAGE_ORDER[b.stage] ?? 99;
      if (sa !== sb) return sa - sb;
      return cmpDeadline(a.deadline, b.deadline);
    });
  renderPaletteResults(hits, tokens);
}

function clearPalette() {
  paletteItems = [];
  paletteActive = -1;
  while ($paletteResults.firstChild) $paletteResults.removeChild($paletteResults.firstChild);
}

function paletteMessage(text) {
  const el = document.createElement('div');
  el.className = 'search-palette-empty';
  el.textContent = text;
  $paletteResults.appendChild(el);
}

function renderPaletteLoading() {
  clearPalette();
  $paletteCount.textContent = 'Recherche…';
  paletteMessage('Chargement du planning…');
}

function renderPaletteResults(hits, tokens) {
  clearPalette();

  if (!hits.length) {
    $paletteCount.textContent = '0 résultat';
    paletteMessage('Aucune commande ne correspond dans tout le planning.');
    return;
  }

  const total = hits.length;
  const shown = hits.slice(0, PALETTE_MAX);
  $paletteCount.textContent = total > PALETTE_MAX
    ? `${PALETTE_MAX} sur ${total} résultats`
    : `${total} résultat${total > 1 ? 's' : ''}`;

  let curStage = null;
  for (const r of shown) {
    if (r.stage !== curStage) {
      curStage = r.stage;
      const gh = document.createElement('div');
      gh.className = 'search-palette-group';
      gh.textContent = STAGE_LABEL[r.stage] || r.stage;
      $paletteResults.appendChild(gh);
    }
    const idx = paletteItems.length;
    const item = buildPaletteItem(r, tokens, idx);
    paletteItems.push({ r, el: item });
    $paletteResults.appendChild(item);
  }
  setActive(0);
}

function buildPaletteItem(r, tokens, idx) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'search-palette-item';
  el.setAttribute('role', 'option');
  el.dataset.idx = idx;

  const title = r.billing_company || r.contact_referent || '— sans dossier';
  const desc = r.product || r.description || '';

  const main = document.createElement('div');
  main.className = 'spi-main';
  const t = document.createElement('div');
  t.className = 'spi-title';
  appendHighlighted(t, title, tokens);
  main.appendChild(t);
  if (desc) {
    const d = document.createElement('div');
    d.className = 'spi-desc';
    appendHighlighted(d, desc, tokens);
    main.appendChild(d);
  }
  el.appendChild(main);

  const meta = document.createElement('div');
  meta.className = 'spi-meta';
  const sub = r.sub_stage && SUB_LABEL[r.sub_stage] ? SUB_LABEL[r.sub_stage] : null;
  if (sub) {
    const chip = document.createElement('span');
    chip.className = 'spi-sub';
    chip.textContent = sub;
    meta.appendChild(chip);
  }
  const dl = deadlineChip(r);
  if (dl) {
    const badge = document.createElement('span');
    badge.className = `spi-deadline ${dl.cls}`;
    badge.textContent = dl.label;
    meta.appendChild(badge);
  }
  el.appendChild(meta);

  el.addEventListener('mouseenter', () => setActive(idx));
  el.addEventListener('click', () => jumpToResult(r));
  return el;
}

function setActive(i) {
  if (!paletteItems.length) { paletteActive = -1; return; }
  const n = paletteItems.length;
  paletteActive = ((i % n) + n) % n;
  paletteItems.forEach((it, k) => it.el.classList.toggle('active', k === paletteActive));
  const cur = paletteItems[paletteActive];
  if (cur) cur.el.scrollIntoView({ block: 'nearest' });
}

// Saute vers la commande choisie : ouvre sa catégorie (et sa sous-étape), ferme
// la palette, met la ligne brièvement en évidence.
async function jumpToResult(r) {
  closePalette();
  if ($gridSearchInput) $gridSearchInput.blur();
  // On cherche dans TOUT le planning, y compris depuis la prise de commande, le
  // dashboard ou la base clients. Si on n'est pas déjà sur le planning, on y
  // revient AVANT de pointer la ligne — sinon la cible reste cachée derrière la
  // vue courante et le clic semble « ne rien faire ». On bascule la vue tout de
  // suite (le hashchange est asynchrone) et on aligne le hash sans le relancer.
  if (viewMode !== 'planning') {
    setViewMode('planning');
    if (location.hash && location.hash !== '#planning') {
      history.replaceState(null, '', '#planning');
    }
  }
  const sub = r.sub_stage && SUB_LABEL[r.sub_stage] ? r.sub_stage : null;
  await selectStage(r.stage, sub);
  const entry = rowEls.get(String(r.id));
  if (entry && entry.tr) {
    entry.tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    entry.tr.classList.remove('row-flash');
    void entry.tr.offsetWidth; // relance l'animation même si déjà posée
    entry.tr.classList.add('row-flash');
    setTimeout(() => entry.tr && entry.tr.classList.remove('row-flash'), 1800);
  }
}

function setGridQuery(v) {
  const next = v || '';
  if (next === gridQuery) return;
  gridQuery = next;
  syncSearchUI();
  runSearch();
}

if ($gridSearchInput) {
  $gridSearchInput.addEventListener('input', () => setGridQuery($gridSearchInput.value));
  $gridSearchInput.addEventListener('focus', () => { if (gridQuery.trim()) runSearch(); });
  $gridSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (gridQuery) { $gridSearchInput.value = ''; setGridQuery(''); }
      else $gridSearchInput.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (paletteOpen) setActive(paletteActive + 1); else runSearch();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (paletteOpen) setActive(paletteActive - 1);
    } else if (e.key === 'Enter') {
      if (paletteOpen && paletteActive >= 0 && paletteItems[paletteActive]) {
        e.preventDefault();
        jumpToResult(paletteItems[paletteActive].r);
      }
    }
  });
}
if ($gridSearchClear) {
  $gridSearchClear.addEventListener('click', () => {
    if ($gridSearchInput) { $gridSearchInput.value = ''; $gridSearchInput.focus(); }
    setGridQuery('');
  });
}
if ($paletteScrim) $paletteScrim.addEventListener('click', () => closePalette());

// ⌘K / Ctrl+K : place le curseur dans le champ de recherche (plus de modal).
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    if ($gridSearchInput) { $gridSearchInput.focus(); $gridSearchInput.select(); }
  }
});

// --- Densité d'affichage ---------------------------------------------------
// Le sélecteur Compact/Normal/Confort a été retiré : densité fixée à « Confort ».
const $app = document.querySelector('.app');
if ($app) $app.classList.add('density-confort');

// --- Thème clair / sombre ----------------------------------------------------
// Suit le système par défaut ; la bascule manuelle est mémorisée par appareil.
// (le thème initial est appliqué avant le premier rendu par un script dans <head>)
const THEME_KEY = 'olda_theme';
const $themeToggle = document.getElementById('themeToggle');
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  if ($themeToggle) {
    const ic = $themeToggle.querySelector('.material-symbols-outlined');
    if (ic) ic.textContent = t === 'dark' ? 'light_mode' : 'dark_mode';
    attachTip($themeToggle, t === 'dark' ? 'Passer en clair' : 'Passer en sombre');
  }
}
applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
if ($themeToggle) {
  $themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
  });
}
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? 'dark' : 'light');
  });
} catch (_) {}

// --- Plein écran (tablette / navigateur) --------------------------------------
// Masqué en PWA installée (déjà plein écran) via CSS display-mode.
const $fullscreenToggle = document.getElementById('fullscreenToggle');
if ($fullscreenToggle && document.documentElement.requestFullscreen) {
  $fullscreenToggle.hidden = false;
  const syncFullscreenIcon = () => {
    const on = !!document.fullscreenElement;
    const ic = $fullscreenToggle.querySelector('.material-symbols-outlined');
    if (ic) ic.textContent = on ? 'fullscreen_exit' : 'fullscreen';
    attachTip($fullscreenToggle, on ? 'Quitter le plein écran' : 'Plein écran');
    $fullscreenToggle.setAttribute('aria-label', $fullscreenToggle.title);
  };
  $fullscreenToggle.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
  });
  document.addEventListener('fullscreenchange', syncFullscreenIcon);
  syncFullscreenIcon();
}

// --- Élévation de l'en-tête de grille au scroll --------------------------------
const $gridWrap = document.querySelector('.grid-wrap');
if ($gridWrap) {
  let gridScrolled = false;
  $gridWrap.addEventListener('scroll', () => {
    const s = $gridWrap.scrollTop > 0;
    if (s !== gridScrolled) {
      gridScrolled = s;
      $gridWrap.classList.toggle('is-scrolled', s);
    }
  }, { passive: true });
}

// --- Ripple Material -----------------------------------------------------------
// Onde discrète au toucher/clic sur les surfaces interactives en pilule.
const RIPPLE_SELECTOR = '.stage, .btn-primary, .cal-foot-btn, .send-btn, .stage-link, ' +
  '.type-tag, .deadline-badge, .prio-pill, .resp-chip, .sub-chip, .menu-item';
document.addEventListener('pointerdown', (e) => {
  const host = e.target.closest(RIPPLE_SELECTOR);
  if (!host) return;
  const r = host.getBoundingClientRect();
  const d = Math.max(r.width, r.height) * 2;
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.width = span.style.height = `${d}px`;
  span.style.left = `${e.clientX - r.left - d / 2}px`;
  span.style.top = `${e.clientY - r.top - d / 2}px`;
  host.appendChild(span);
  span.addEventListener('animationend', () => span.remove());
}, { passive: true });

// --- Largeur du rail réglable ----------------------------------------------
// Une poignée verticale entre le rail et la zone de travail règle la largeur du
// rail (glisser souris / doigt). Mémorisé par appareil (localStorage).
const SIDEBAR_W_KEY = 'olda_sidebar_w';
const SIDEBAR_MIN = 180, SIDEBAR_MAX = 460;
const $sidebarResizer = document.getElementById('sidebarResizer');
// La largeur du rail est une colonne de la grille du .shell : c'est donc lui qui
// porte `--sidebar-w` (le rail n'est plus enfant de `.app`).
const $shell = document.querySelector('.shell');
if ($shell && $sidebarResizer) {
  const clampW = (w) => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(w)));
  const saved = parseInt(localStorage.getItem(SIDEBAR_W_KEY) || '', 10);
  if (Number.isFinite(saved)) $shell.style.setProperty('--sidebar-w', clampW(saved) + 'px');
  attachTip($sidebarResizer, 'Glisser pour régler la largeur');
  $sidebarResizer.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = document.getElementById('sidebar').getBoundingClientRect().width;
    let lastW = clampW(startW);
    $sidebarResizer.classList.add('active');
    document.body.classList.add('sidebar-resizing');
    try { $sidebarResizer.setPointerCapture(e.pointerId); } catch (_) {}
    const onMove = (ev) => {
      lastW = clampW(startW + ev.clientX - startX);
      $shell.style.setProperty('--sidebar-w', lastW + 'px');
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      $sidebarResizer.classList.remove('active');
      document.body.classList.remove('sidebar-resizing');
      try { localStorage.setItem(SIDEBAR_W_KEY, String(lastW)); } catch (_) {}
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

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

// ===========================================================================
// ONGLET DASHBOARD — « Point du jour » (module dédié : dashboard.js)
// ===========================================================================
// Toute la vue (KPI, vue équipe / perso, panneau détail « Envoyer vers », fil
// d'activité, écran mural, attribution des catégories) vit dans dashboard.js.
// Ici : le câblage — bascule Planning/Dashboard, saut vers une ligne du
// planning, et injection des utilitaires partagés.

const $dashboard = document.getElementById('dashboard');
const $viewPlanning = document.getElementById('viewPlanning');
const $viewDashboard = document.getElementById('viewDashboard');
const $viewCommande = document.getElementById('viewCommande');
const $viewDemande = document.getElementById('viewDemande');
const $commande = document.getElementById('commande');
const $viewClients = document.getElementById('viewClients');
const $clients = document.getElementById('clients');
const $viewReglages = document.getElementById('viewReglages');
const $reglages = document.getElementById('reglages');

// 'planning' | 'dashboard' | 'commande' | 'clients' | 'reglages'
// | 'fiverr' | 'a_commander' (les deux catégories promues en onglet)
let viewMode = 'planning';
// La vue « Prise de commande » sert DEUX entrées de menu (#demande / #commande) :
// la nature est décidée par le lien cliqué, pas par un réglage dans la fiche.
let commandeNature = 'demande';
let commandeModule = null;

// Saut vers une commande : bascule sur le Planning, l'ouvre et la surligne.
// Si elle vit dans une catégorie promue en onglet (Fiverr, À commander), c'est
// SON onglet qu'on ouvre : sinon on afficherait une grille dont l'onglet allumé
// et le rail ne parlent pas.
async function jumpToPlanning(r) {
  const sub = r.sub_stage && SUB_LABEL[r.sub_stage] ? r.sub_stage : null;
  const promoted = PROMOTED.find((p) => p.stage === r.stage && p.sub === sub);
  setViewMode(promoted ? promoted.view : 'planning');
  await selectStage(r.stage, sub);
  const entry = rowEls.get(String(r.id));
  if (entry && entry.tr) {
    entry.tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    entry.tr.classList.remove('row-flash');
    void entry.tr.offsetWidth;
    entry.tr.classList.add('row-flash');
    setTimeout(() => entry.tr && entry.tr.classList.remove('row-flash'), 1800);
  }
}

const dashboard = createDashboard({
  root: $dashboard,
  api, EMPLOYEES, FAMILIES, SUB_STAGES, STAGE_LABEL, SUB_LABEL,
  daysLeft, prioBand, showToast, attachTip, fold,
  jumpToPlanning,
});

// --- Bascule Planning / Dashboard ------------------------------------------
// Le HASH de l'URL est l'unique pilote de la vue. La navigation du rail n'est
// faite que de liens : cliquer change le hash, le hash change la vue. Avoir eu
// deux pilotes (des boutons ET le hash) laissait l'URL et l'écran se
// contredire — « #dashboard » affiché sur le planning, et retour au dashboard
// au premier rechargement.
// La Prise de commande (catalogue textile, annuaire client) est chargée au
// premier passage sur la vue, puis montée une bonne fois : les bascules
// suivantes ne sont qu'un changement de classe — instantanées, et la saisie en
// cours est conservée. La nature (demande / commande) lui est poussée dès
// qu'elle est prête.
let commandeLoading = null;
function mountCommande() {
  if (!$commande) return;
  if (!commandeLoading) {
    commandeLoading = import('./commande.js')
      .then((m) => { commandeModule = m; return m.initCommande($commande); })
      .then(() => commandeModule.setNature(commandeNature))
      .catch((err) => {
        commandeLoading = null;             // rechargeable au prochain essai
        commandeModule = null;
        console.error('Prise de commande : chargement impossible', err);
      });
  } else if (commandeModule) {
    commandeModule.setNature(commandeNature);
  }
}

// La Base clients (CRM) : liste + fiche éditable + notes. Module lourd (rendu
// complet), chargé au premier passage puis monté ; les visites suivantes
// rafraîchissent seulement les données (un client a pu être créé à la commande).
let clientsLoading = null;
let clientsModule = null;
function mountClients() {
  if (!$clients) return;
  if (!clientsLoading) {
    clientsLoading = import('./clients.js')
      .then((m) => { clientsModule = m; return m.initClients($clients); })
      .catch((err) => {
        clientsLoading = null;                // rechargeable au prochain essai
        clientsModule = null;
        console.error('Base clients : chargement impossible', err);
      });
  } else if (clientsModule && clientsModule.refreshClients) {
    clientsModule.refreshClients();
  }
}

// Les Réglages du patron (message WhatsApp « commande prête »…). Petit module,
// chargé au premier passage puis monté ; les visites suivantes relisent la
// valeur enregistrée — un autre poste a pu la changer entre-temps.
let reglagesLoading = null;
let reglagesModule = null;
function mountReglages() {
  if (!$reglages) return;
  if (!reglagesLoading) {
    reglagesLoading = import('./reglages.js')
      .then((m) => { reglagesModule = m; return m.initReglages($reglages); })
      .catch((err) => {
        reglagesLoading = null;               // rechargeable au prochain essai
        reglagesModule = null;
        console.error('Réglages : chargement impossible', err);
      });
  } else if (reglagesModule && reglagesModule.refreshReglages) {
    reglagesModule.refreshReglages();
  }
}

// Une catégorie promue en onglet reste une vue de PLANNING : même grille, même
// en-tête. Seul le rail s'efface (l'onglet le remplace).
const isPlanningMode = (mode) => mode === 'planning' || mode in PROMOTED_BY_VIEW;

function setViewMode(mode) {
  // La visibilité du planning (en-tête, grille, outil Fiverr, rail d'étapes) est
  // pilotée par une classe sur <body> : l'attribut `hidden` seul ne suffit pas,
  // ces éléments portent une règle `display` qui l'écrase.
  if ($viewPlanning) $viewPlanning.classList.toggle('active', mode === 'planning');
  if ($viewDashboard) $viewDashboard.classList.toggle('active', mode === 'dashboard');
  if ($viewClients) $viewClients.classList.toggle('active', mode === 'clients');
  if ($viewReglages) $viewReglages.classList.toggle('active', mode === 'reglages');
  for (const p of PROMOTED) {
    const btn = document.getElementById(p.btn);
    if (btn) btn.classList.toggle('active', mode === p.view);
  }
  // Les deux entrées de saisie s'allument selon la NATURE courante, pas juste
  // selon la vue : sur #commande c'est « Commande », sur #demande « Demande ».
  const onIntake = mode === 'commande';
  if ($viewDemande) $viewDemande.classList.toggle('active', onIntake && commandeNature === 'demande');
  if ($viewCommande) $viewCommande.classList.toggle('active', onIntake && commandeNature === 'commande');
  if (mode === viewMode) return;
  viewMode = mode;

  const dash = mode === 'dashboard';
  const commande = mode === 'commande';
  const clients = mode === 'clients';
  const reglages = mode === 'reglages';
  if ($dashboard) $dashboard.hidden = !dash;
  if ($commande) $commande.hidden = !commande;
  if ($clients) $clients.hidden = !clients;
  if ($reglages) $reglages.hidden = !reglages;
  document.body.classList.toggle('view-plein', !isPlanningMode(mode));
  document.body.classList.toggle('view-focus', mode in PROMOTED_BY_VIEW);

  if (dash) dashboard.show(); else dashboard.hide();
  if (commande) mountCommande();
  if (clients) mountClients();
  if (reglages) mountReglages();
  if (isPlanningMode(mode)) {
    // De retour au planning : la sous-étape courante peut avoir changé ailleurs.
    updateFiverrTool(currentStage);
  }
}

// #demande et #commande ouvrent la MÊME vue, avec une nature différente.
const VIEWS = {
  '#dashboard': 'dashboard', '#demande': 'commande', '#commande': 'commande',
  '#clients': 'clients', '#reglages': 'reglages',
  ...Object.fromEntries(PROMOTED.map((p) => [p.hash, p.view])),
};
function applyHash() {
  const h = location.hash;
  const mode = VIEWS[h] || 'planning';
  if (mode === 'commande') commandeNature = h === '#commande' ? 'commande' : 'demande';
  setViewMode(mode);
  // Changer de nature SANS changer de vue (#demande ↔ #commande) : setViewMode a
  // pris le raccourci « même vue », on pousse donc la nature à la main.
  if (mode === 'commande' && commandeModule) commandeModule.setNature(commandeNature);
  // Onglet Fiverr / À commander : la grille doit pointer sur LEUR catégorie.
  // On ne recharge que si elle affiche autre chose (revenir sur l'onglet déjà
  // ouvert ne doit pas vider la grille sous les yeux). Au tout premier passage
  // la grille n'est pas encore montée : on pose seulement la catégorie, start()
  // s'occupe du chargement — sinon on la chargerait deux fois.
  const promoted = PROMOTED_BY_VIEW[mode];
  if (promoted) {
    if (!booted) { currentStage = promoted.stage; currentSub = promoted.sub; }
    else if (currentStage !== promoted.stage || currentSub !== promoted.sub) {
      selectStage(promoted.stage, promoted.sub);
    }
    return;
  }
  // Retour sur l'onglet Planning alors que la grille affiche une catégorie
  // promue : elle ne figure plus dans le rail, on repart donc du début du
  // pipeline plutôt que de laisser une grille sans entrée allumée en face.
  const onPromotedStage = PROMOTED.some((p) => p.stage === currentStage && p.sub === currentSub);
  if (booted && mode === 'planning' && onPromotedStage) {
    selectStage(FAMILIES[0].slug, null);
  }
}
window.addEventListener('hashchange', applyHash);
applyHash();

async function start() {
  setTodayDate();
  initBrandReflection();
  renderSidebar();
  attachColResizers();
  updateSubColVisibility(currentStage);
  applyColWidths();
  // Les noms « de base » (pilote + référents par catégorie) doivent être connus
  // AVANT le premier rendu, sinon les lignes s'affichent en « Qui ? » puis sautent.
  await Promise.all([loadCategoryConfig(), loadCounts(), loadWhatsappMessage()]);
  $stageTitle.textContent = currentViewLabel();
  updateStageLink(currentStage);
  updateStageHelp();
  updateFiverrTool(currentStage);
  await loadRows();
  lastRowsSig = signature(rows);
  // À partir d'ici la grille est montée : les changements d'onglet peuvent la
  // recharger d'eux-mêmes (voir applyHash).
  booted = true;
  dashboard.start(); // monte le « Point du jour » et charge son cache en fond
  startRealtime();
}

start().catch(reportError);
