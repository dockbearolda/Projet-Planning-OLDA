// ===========================================================================
// Planning OLDA — frontend (vanilla ES module, aucun build)
// ===========================================================================

// Guide des étapes (texte du patron, feuille « Descriptif Étapes »).
import { STEP_GUIDE } from './guide.js';
// Dashboard « Point du jour » (projection temps réel du planning).
import { createDashboard } from './dashboard.js';
// WhatsApp « commande prête » : numéro au format international + message rempli.
import { whatsappLink } from './whatsapp.js';
// Nom d'un particulier : où s'arrête le prénom, où commence le NOM de famille.
import { splitPersoName } from './nom-client.js';
// La boîte de confirmation de l'app (jamais celle du système) — partagée avec
// la Base clients, qui en a besoin pour la suppression d'une fiche.
import { confirmerAction } from './confirmer.js';

// --- Pipeline à 2 NIVEAUX (modèle « familles », d'après le CRM du patron) -----
// La FAMILLE (barre latérale) dit OÙ en est le projet ; la SOUS-ÉTAPE (puce sur
// la ligne) précise CE QUI SE PASSE MAINTENANT. « 1 projet = 1 seule place. »
// 5 familles au lieu de 20 étapes → barre latérale nettement plus lisible/aérée.
const FAMILIES = [
  { slug: 'demande_chiffrage', label: 'Demande & chiffrage' },
  { slug: 'preparation', label: 'Préparation du projet' },
  { slug: 'production', label: 'Production' },
  { slug: 'facturation', label: 'Facturation & remise au client' },
  { slug: 'paiement', label: 'Paiement & clôture' },
];
// Catégorie spéciale (sous-traitance graphiste), hors des 5 familles.
const SPECIAL = [
  { slug: 'fiverr', label: 'Fiverr' },
];
const STAGES = [...FAMILIES, ...SPECIAL];
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.slug, s.label]));
// Colonne « Prix TTC » : n'a de sens que là où le prix se remplit réellement
// (chiffrage, montant à facturer, contrôle du paiement) — masquée ailleurs.
const PRICE_VISIBLE_STAGES = new Set(['demande_chiffrage', 'facturation', 'paiement']);

// Sous-étapes par famille (miroir de db.js). Une famille absente = pas de puce.
const SUB_STAGES = {
  demande_chiffrage: [
    { slug: 'demande_recue', label: 'Demande reçue' },
    { slug: 'demande_a_qualifier', label: 'Demande à qualifier' },
    { slug: 'a_chiffrer', label: 'À chiffrer' },
    { slug: 'chiffrage_en_cours', label: 'Chiffrage en cours' },
    { slug: 'devis_envoye', label: 'Tarif / Devis envoyé – Attente client' },
    { slug: 'devis_valide', label: 'Devis validé' },
  ],
  preparation: [
    { slug: 'prepa_produits', label: 'Préparation des produits' },
    { slug: 'prepa_bat', label: 'Préparation du BAT' },
    { slug: 'bat_envoye', label: 'BAT envoyé – Attente validation' },
    { slug: 'bat_valide', label: 'BAT validé' },
    { slug: 'validation_acompte', label: 'Validation acompte / Conditions de paiement' },
    { slug: 'a_commander', label: 'À commander' },
    { slug: 'attente_marchandise', label: 'Attente marchandise' },
    { slug: 'pret_a_produire', label: 'Prêt à produire' },
  ],
  production: [
    { slug: 'prod_dtf', label: 'Production DTF' },
    { slug: 'decoupe_dtf', label: 'Découpe & Contrôle DTF' },
    { slug: 'prod_pressage', label: 'Pressage' },
    { slug: 'prod_trotec', label: 'Production Trotec' },
    { slug: 'prod_uv', label: 'Production UV' },
    { slug: 'montage_finition', label: 'Montage / Finition' },
    { slug: 'controle_emballage', label: 'Contrôle & Emballage' },
  ],
  facturation: [
    { slug: 'facturation_a_faire', label: 'Facturation à faire' },
    { slug: 'client_a_prevenir', label: 'Client à prévenir' },
    { slug: 'client_prevenu', label: 'Client prévenu – Attente retrait' },
    { slug: 'commande_recuperee', label: 'Commande récupérée' },
  ],
  paiement: [
    { slug: 'paiement_a_controler', label: 'Paiement à contrôler' },
    { slug: 'paiement_valide', label: 'Paiement validé / Soldé' },
    { slug: 'archive', label: 'Archivé' },
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

// Modes de paiement (miroir de catalog.json → commande.paiementModes, que le
// serveur valide). Une commande peut n'en porter aucun : « non précisé ».
const PAIEMENT_MODES = [
  { id: 'cb', label: 'CB' },
  { id: 'especes', label: 'Espèces' },
  { id: 'virement', label: 'Virement' },
  { id: 'cheque', label: 'Chèque' },
  { id: 'mixte', label: 'Mixte (CB + espèces)' },
];

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

// --- Liens externes par catégorie (affichés dans l'en-tête de l'étape). -----
const STAGE_LINKS = {
  fiverr: { url: 'https://fr.fiverr.com/', label: 'Ouvrir Fiverr' },
};

// Cibles d'envoi rapide proposées sur chaque ligne (boutons « → … »).
const SEND_TARGETS = [
  { slug: 'fiverr', label: 'Fiverr' },
];

// --- État applicatif -------------------------------------------------------
let currentStage = 'demande_chiffrage';
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
// d'échec : la grille reste utilisable, elle affiche juste « Non défini ».
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

// --- Prix : le TTC est saisi, le HT se déduit ------------------------------
// `project_value` porte le TTC — c'est le prix que le client paie, et celui
// qu'on tape au comptoir. Le HT n'est jamais stocké : il vaut TTC ÷ (1 + TGCA),
// avec le taux réglé dans Réglages (jamais une constante en dur). 4 % en repli
// si l'appel échoue : la grille reste utilisable, avec le taux d'usage local.
let TGCA = 0.04;

async function loadTgca() {
  try {
    const p = await api('GET', '/api/tarifs-tasse/parametres');
    if (p && Number.isFinite(Number(p.tgca))) TGCA = Number(p.tgca);
  } catch (_) { /* silencieux : on garde le taux par défaut */ }
}

// `Number(null)` vaut 0 : sans le test d'absence, une ligne SANS prix affichait
// « HT : 0 € » — et une demande de devis, qui n'a par définition pas encore de
// prix, se serait lue comme un projet à zéro euro.
const htFromTtc = (ttc) => (ttc != null && ttc !== '' && Number.isFinite(Number(ttc))
  ? Number(ttc) / (1 + TGCA)
  : null);

// « HT : 230,77 € » — la mention discrète qui accompagne chaque TTC affiché.
// Renvoie '' si la ligne n'a pas de prix : rien à déduire, donc rien à écrire.
function htLabel(ttc) {
  const ht = htFromTtc(ttc);
  return ht == null ? '' : `HT : ${formatMoney(Math.round(ht * 100) / 100)}`;
}

// --- Sélecteurs ------------------------------------------------------------
const $stages = document.getElementById('stages');
const $rows = document.getElementById('rows');
const $cards = document.getElementById('cards');
const $empty = document.getElementById('empty');
const $stageTitle = document.getElementById('stageTitle');
const $stageCount = document.getElementById('stageCount');
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
const $fiverrCostEur = document.getElementById('fiverrCostEur');
const $fiverrMargin = document.getElementById('fiverrMargin');
const $fiverrPrice = document.getElementById('fiverrPrice');

const eur = (n) => `${n.toFixed(2).replace('.', ',')} €`;

// Recalcule le prix client à partir du champ de saisie, en détaillant chaque
// étape (coût réel, marge ajoutée) pour que le calcul soit lisible par tous,
// pas seulement le résultat final.
function updateFiverrPrice() {
  if (!$fiverrCost || !$fiverrPrice) return;
  const cost = parseFloat($fiverrCost.value.replace(',', '.').trim());
  if (!Number.isFinite(cost) || cost < 0) {
    if ($fiverrCostEur) $fiverrCostEur.textContent = '—';
    if ($fiverrMargin) $fiverrMargin.textContent = '—';
    $fiverrPrice.textContent = '—';
    return;
  }
  // cost = prix graphiste en $ ; USD_TO_EUR convertit en €. Résultat en euros.
  const costEur = (cost * (1 + FIVERR_FEE_PCT) + FIVERR_FIXED) * USD_TO_EUR;
  const resale = Math.ceil(costEur * OLDA_MARGIN);
  if ($fiverrCostEur) $fiverrCostEur.textContent = eur(costEur);
  if ($fiverrMargin) $fiverrMargin.textContent = `+ ${eur(resale - costEur)}`;
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
  // Un VRAI bouton, pas un <div> cliquable : le rail est la navigation
  // principale de l'outil et il n'était atteignable ni au clavier (aucune de
  // ses 32 entrées n'était focusable) ni par un lecteur d'écran. `type=button`
  // pour qu'il ne valide jamais un formulaire par mégarde.
  const el = document.createElement('button');
  el.type = 'button';
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
  // Le compteur fait partie du nom accessible : « À chiffrer, 9 commandes ».
  el.setAttribute('aria-label', `${label.textContent} — ${n} commande${n > 1 ? 's' : ''}`);
  if (active) el.setAttribute('aria-current', 'true');
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

// Rejoue l'animation d'entrée (léger fondu décalé) au changement d'étape — sur
// la vue réellement affichée : le tableau OU les cartes, même geste visuel.
let stageEnterTimer = null;
function playStageEnter() {
  const host = modeCartes() ? $cards : $rows;
  if (!host) return;
  $rows.classList.remove('stage-enter');
  $cards.classList.remove('stage-enter');
  void host.offsetWidth; // relance l'animation CSS
  host.classList.add('stage-enter');
  clearTimeout(stageEnterTimer);
  stageEnterTimer = setTimeout(() => host.classList.remove('stage-enter'), 600);
}

// Masque la colonne « Sous-étape » quand la famille courante n'a pas de
// sous-familles (Demande, Attente Client, Archivé, Fiverr) → vue plus aérée.
function updateSubColVisibility(slug) {
  const grid = document.getElementById('grid');
  if (grid) grid.classList.toggle('no-sub', !familyHasSub(slug));
}

// Masque la colonne « Prix » hors des étapes où elle se remplit réellement
// (Commande, Facturation) → pas de colonne vide en Demande, Production…
function updatePriceColVisibility(slug) {
  const grid = document.getElementById('grid');
  if (grid) grid.classList.toggle('no-price', !PRICE_VISIBLE_STAGES.has(slug));
}

// Vide la grille INSTANTANÉMENT au changement de famille : on ne laisse jamais les
// lignes (ni le compteur) de l'ancienne famille sous le nouvel entête pendant que
// les nouvelles données arrivent. La colonne « Sous-étape » et l'animation d'entrée
// sont posées avec la donnée (dans loadRows), pas avant — tout reste cohérent.
function clearGrid() {
  for (const [, entry] of rowEls) entry.tr.remove();
  rowEls.clear();
  // Les DEUX vues se vident : la vue épurée (cartes) est celle par défaut, et
  // laisser les cartes de l'ancienne famille à l'écran pendant le chargement
  // serait exactement le « glitch » que cette fonction existe pour empêcher.
  for (const [, carte] of cardEls) carte.el.remove();
  cardEls.clear();
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
    if (on) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
  });
}

// Nom accessible d'une entrée du rail : le libellé ET son compteur, pour qu'un
// lecteur d'écran annonce « À chiffrer — 9 commandes » d'un seul tenant.
function syncStageLabel(el, n) {
  const label = el.querySelector('.stage-label');
  if (label) el.setAttribute('aria-label', `${label.textContent} — ${n} commande${n > 1 ? 's' : ''}`);
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

// `forcerRelecture` : la ligne visée vient d'être créée côté serveur et n'est
// donc PAS dans le cache local. Sans ce drapeau, le raccourci « même famille »
// ci-dessous se contentait de re-dessiner ce qu'on avait déjà — la nouvelle
// ligne n'y était pas, `revealRow` ne trouvait rien, et la vendeuse ne voyait
// rien apparaître (le cas le plus courant : elle était déjà sur cette famille).
async function selectStage(slug, sub = null, forcerRelecture = false) {
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
  if (sameFamily && lastRowsSig !== '' && !forcerRelecture) {
    applySortAndRender();
    playStageEnter();
    return;
  }
  // Relecture forcée : on garde la grille à l'écran (pas de `clearGrid`), sinon
  // elle clignoterait alors qu'on est déjà au bon endroit.
  if (!sameFamily) clearGrid();
  try {
    await loadRows();
  } catch (_) {
    // Wi-Fi coupé une seconde : la grille restait VIDE et muette, sans le
    // moindre message — le même symptôme visuel qu'une panne grave. On le dit,
    // et le temps réel remettra les lignes dès que la liaison revient.
    if (currentStage === slug) {
      $empty.hidden = false;
      $empty.textContent = 'Connexion perdue — les commandes réapparaîtront dès le retour du réseau.';
      showToast('Chargement impossible : vérifie la connexion.');
    }
    return;
  }
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
    syncStageLabel(el, n);
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
  updatePriceColVisibility(slug);
  // La mention « vide ici » du rail dépend de l'étape : elle se recalcule ici,
  // en même temps que les deux règles automatiques ci-dessus.
  renderColbar();
  renderOrdreReset(); // l'ordre manuel est propre à l'étape : le bouton la suit
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
  syncStageLabel(el, n);
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
// ORDRE MANUEL, PAR ÉTAPE. Le planning s'ouvre sur un tri automatique (priorité,
// puis urgence) : c'est le bon défaut, personne n'a rien à ranger le premier
// jour. Mais dès qu'on glisse une carte dans la liste, on prend une décision que
// le rendu suivant n'a pas le droit d'effacer — c'était le bug : la carte
// revenait toujours à sa place, l'ordre n'étant jamais lu depuis `position`.
//
// Le basculement se fait DONC étape par étape, et seulement au premier
// glissement : une étape que personne n'a rangée garde son tri automatique. Sans
// ça, passer tout le planning en ordre manuel le rebattrait d'un coup dans
// l'ordre de création — les urgences ne seraient plus en tête.
//
// La décision est PARTAGÉE, comme ses effets. Glisser une carte réécrit les
// `position` en base, donc pour tout le monde ; garder « cette étape est rangée
// à la main » dans le localStorage de chaque tablette faisait diverger les
// postes — une vendeuse rangeait sa liste, la tablette d'à côté ne bougeait pas,
// puis basculait un jour d'un coup sur un geste accidentel. Le localStorage ne
// sert plus que de cache d'amorçage (pas de saut à l'ouverture) ; la référence
// est le serveur (voir /api/ordre-manuel).
const ORDRE_KEY = 'olda.ordre-manuel';
let ordreManuel = new Set();
try {
  const saved = JSON.parse(localStorage.getItem(ORDRE_KEY) || '[]');
  if (Array.isArray(saved)) ordreManuel = new Set(saved.filter((s) => typeof s === 'string'));
} catch (_) { ordreManuel = new Set(); }

function saveOrdreManuelLocal() {
  try { localStorage.setItem(ORDRE_KEY, JSON.stringify([...ordreManuel])); } catch (_) {}
}

// Publie la décision pour tous les postes. Renvoie une promesse : l'appelant
// (commitReorder) sait ainsi revenir en arrière si l'écriture échoue.
function saveOrdreManuel() {
  saveOrdreManuelLocal();
  return api('PUT', '/api/ordre-manuel', [...ordreManuel]);
}

// Relit la liste partagée. Silencieux en cas d'échec : on garde le dernier état
// connu plutôt que de rebattre la grille sur une panne réseau.
async function loadOrdreManuel() {
  try {
    const list = await api('GET', '/api/ordre-manuel');
    if (Array.isArray(list)) {
      ordreManuel = new Set(list.filter((s) => typeof s === 'string'));
      saveOrdreManuelLocal();
    }
  } catch (_) { /* silencieux */ }
}

// Tri automatique : priorité décroissante, puis les urgences en tête, puis
// l'échéance la plus proche. Sert de tri par défaut ET de départage dans l'ordre
// manuel.
function cmpAuto(a, b) {
  const pa = prioBand(a), pb = prioBand(b);
  if (pa !== pb) return pb - pa;
  const ua = urgentDaysLeft(a), ub = urgentDaysLeft(b);
  if ((ua !== null) !== (ub !== null)) return ua !== null ? -1 : 1;
  if (ua !== null && ub !== null) return ua - ub;
  return cmpDeadline(a.deadline, b.deadline);
}

// `syncDrawer: false` rend la grille SANS reconstruire la side bar de détail.
// Réservé aux sauvegardes d'un champ de saisie DU tiroir : le champ affiche
// déjà ce qu'on vient d'y taper, et le reconstruire démonterait la puce sur
// laquelle l'utilisateur est peut-être en train de cliquer (le clic tomberait
// dans le vide entre le `mousedown` qui a déclenché la sauvegarde et le `click`).
// L'ordre dans lequel la FAMILLE ENTIÈRE est rangée — sous-catégories comprises,
// qu'elles soient affichées ou non. La grille en montre une tranche (filtre de
// sous-catégorie), mais le réordonnancement a besoin de la séquence complète
// pour ne pas laisser d'ancienne position derrière lui (cf. commitReorder).
function ordreFamille() {
  const liste = [...rows];
  if (sort.key) return liste.sort((a, b) => cmp(a, b, sort.key) * sort.dir);
  if (ordreManuel.has(currentStage)) {
    // L'ÉTAPE A ÉTÉ RANGÉE À LA MAIN : c'est cet ordre-là qui fait foi. Une carte
    // qu'on déplace doit rester où on l'a posée — sinon le geste ment. Le tri
    // automatique ne départage plus que les positions à égalité (lignes créées
    // avant le premier rangement, qui partagent la même valeur).
    return liste.sort((a, b) => {
      const qa = a.position ?? Number.POSITIVE_INFINITY;
      const qb = b.position ?? Number.POSITIVE_INFINITY;
      if (qa !== qb) return qa - qb;
      return cmpAuto(a, b);
    });
  }
  // tri par défaut : groupé par PRIORITÉ (Haute → Moyenne → Basse) pour que les
  // bandes soient contiguës (en-têtes de groupe). À l'intérieur d'une bande, les
  // commandes urgentes (échéance ≤ 1 jour, aujourd'hui ou dépassée) remontent en
  // tête, la plus urgente d'abord, puis échéance la plus proche.
  return liste.sort(cmpAuto);
}

function applySortAndRender({ syncDrawer = true } = {}) {
  // `rows` contient TOUTE la famille ; si une sous-catégorie est active, on ne
  // rend que les commandes qui en relèvent (filtre instantané, côté client).
  // On trie AVANT de filtrer : la tranche affichée est donc toujours une
  // sous-séquence exacte de l'ordre de la famille, et commitReorder peut y
  // replacer les lignes déplacées sans déranger les autres.
  const sorted = ordreFamille()
    .filter((r) => currentSub === null || (r.sub_stage ?? null) === currentSub);
  // Rendu incrémental : on monte / réutilise TOUTES les lignes de l'étape. Le
  // filtre de recherche se fait ensuite par masquage CSS (aucune reconstruction
  // par frappe) — cf. applySearchAndCounts.
  lastRendered = sorted;
  renderRows(sorted);
  applySearchAndCounts();
  if (syncDrawer) renderLigneDetailIfOpen();
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
const cardEls = new Map(); // id (string) -> { el, sig } — vue épurée (cartes)

// Anti double-tap sur les boutons qui CRÉENT quelque chose (dupliquer, envoyer
// vers une autre catégorie) : au doigt, un appui appuyé se lit souvent comme
// deux clics, et on se retrouvait avec deux copies de la commande. Le bouton
// est rendu inerte le temps que la création parte.
function armerUneFois(bouton, ms = 700) {
  if (bouton.dataset.enCours === '1') return false;
  bouton.dataset.enCours = '1';
  setTimeout(() => { delete bouton.dataset.enCours; }, ms);
  return true;
}

// Force la reconstruction des lignes au prochain rendu. renderRows() ne remonte
// une ligne que si son `updated_at` a bougé ; or l'affichage dépend aussi de
// données EXTÉRIEURES à la ligne (pilote / référent de base d'une catégorie).
// Quand cette config change, on périme les signatures pour tout recalculer.
// Périme le rendu mémorisé d'une ligne pour forcer sa reconstruction. Les DEUX
// vues sont concernées : la signature ne porte que `updated_at`, or un
// changement optimiste (glisser vers une autre sous-étape) modifie la donnée
// locale sans toucher cette date. Oublier les cartes ici, c'est laisser une
// carte afficher son ancienne sous-étape jusqu'au prochain aller-retour serveur.
function invalidateRowCache(id) {
  if (id != null) {
    const entry = rowEls.get(String(id));
    if (entry) entry.sig = '';
    const carte = cardEls.get(String(id));
    if (carte) carte.sig = '';
    return;
  }
  for (const [, entry] of rowEls) entry.sig = '';
  for (const [, carte] of cardEls) carte.sig = '';
}

// ===========================================================================
// PLANNING ÉPURÉ — une carte par projet
// ===========================================================================
// La vue par défaut, reprise de l'écran du patron. Une ligne du planning ne
// répond qu'à quatre questions : POUR QUI, QUOI, COMBIEN DE TEMPS IL RESTE,
// COMBIEN. Le reste — coordonnées, détail complet, paiement, documents — vit
// dans la fiche, à un clic. Le tableau complet n'a pas disparu : il revient dès
// qu'on rallume une colonne dans le rail « Colonnes ».

// L'atelier est ouvert du lundi au vendredi, 9h → 18h. Le délai affiché ne
// compte QUE ces heures-là : « 2 jours » un vendredi soir ne veut rien dire si
// on les compte en jours calendaires.
const OUVERTURE = 9;
const FERMETURE = 18;
const estJourOuvre = (d) => d.getDay() >= 1 && d.getDay() <= 5;
const aLHeure = (d, h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; };

// L'instant de remise au client. Sans heure connue, 14h : le milieu d'après-midi
// est l'heure de retrait la plus courante au comptoir.
function momentRemise(jour, heure) {
  const j = String(jour || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(j)) return null;
  const h = /^\d{1,2}:\d{2}$/.test(heure || '') ? (heure.length === 4 ? `0${heure}` : heure) : '14:00';
  const d = new Date(`${j}T${h}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Le dernier moment OUVRÉ utile avant la remise. Une récupération le lundi à 9h
// doit donc être terminée le vendredi à 18h — c'est ça, la vraie échéance de
// production, et c'est elle qu'on affiche.
function echeanceProduction(jour, heure) {
  const remise = momentRemise(jour, heure);
  if (!remise) return null;
  let x = new Date(remise);
  for (let i = 0; i < 30; i++) {
    if (estJourOuvre(x)) {
      const ouvre = aLHeure(x, OUVERTURE);
      const ferme = aLHeure(x, FERMETURE);
      if (x > ferme) return ferme;
      if (x > ouvre) return x;
    }
    x = aLHeure(new Date(x.getFullYear(), x.getMonth(), x.getDate() - 1), FERMETURE);
  }
  return remise;
}

function minutesOuvrees(de, a) {
  if (a <= de) return 0;
  let total = 0;
  let curseur = new Date(de);
  for (let i = 0; i < 400 && curseur < a; i++) {
    if (estJourOuvre(curseur)) {
      const ouvre = aLHeure(curseur, OUVERTURE);
      const ferme = aLHeure(curseur, FERMETURE);
      const debut = curseur > ouvre ? curseur : ouvre;
      const fin = ferme < a ? ferme : a;
      if (fin > debut) total += (fin - debut) / 60000;
    }
    curseur = aLHeure(new Date(curseur.getFullYear(), curseur.getMonth(), curseur.getDate() + 1), 0);
  }
  return Math.floor(total);
}

const etiquetteEcheance = (d) => (d
  ? `${d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })} `
    + `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`
  : '—');

// Le temps de production RESTANT, en heures ouvrées.
function tempsRestant(jour, heure) {
  const echeance = echeanceProduction(jour, heure);
  if (!echeance) return { texte: 'Non défini', heures: Infinity, retard: false, echeanceTexte: '—' };
  const maintenant = new Date();
  if (echeance <= maintenant) {
    return { texte: 'Échéance dépassée', heures: 0, retard: true, echeanceTexte: etiquetteEcheance(echeance) };
  }
  const heures = Math.floor(minutesOuvrees(maintenant, echeance) / 60);
  const jours = Math.floor(heures / (FERMETURE - OUVERTURE));
  const reste = heures - jours * (FERMETURE - OUVERTURE);
  let texte = '';
  if (jours > 0) texte += `${jours} jour${jours > 1 ? 's' : ''} ouvré${jours > 1 ? 's' : ''}`;
  if (reste > 0) texte += `${texte ? ' et ' : ''}${reste} heure${reste > 1 ? 's' : ''}`;
  if (!texte) texte = 'Moins d’une heure';
  return { texte, heures, retard: false, echeanceTexte: etiquetteEcheance(echeance) };
}

// Moins de deux jours ouvrés restants = urgent. Au-delà, la commande est calme.
const bandeUrgence = (d) => (d.retard ? 'retard' : d.heures <= 16 ? 'urgent' : 'calme');

const initiales = (nom) => String(nom || '').split(/\s+/).map((m) => m[0] || '').join('').slice(0, 2).toUpperCase();

// Les six points de préhension (même dessin que la poignée du tableau).
function gripIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  for (const [cx, cy] of [[5, 3], [11, 3], [5, 8], [11, 8], [5, 13], [11, 13]]) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', cx);
    c.setAttribute('cy', cy);
    c.setAttribute('r', '1.4');
    svg.appendChild(c);
  }
  return svg;
}

function pcardBloc(label, ...enfants) {
  const d = document.createElement('div');
  const l = document.createElement('p');
  l.className = 'pcard__label';
  l.textContent = label;
  d.append(l, ...enfants);
  return d;
}

function buildCard(r) {
  const carte = document.createElement('article');
  carte.dataset.id = r.id;
  const delai = tempsRestant(r.deadline, r.fiche && r.fiche.heureSouhaitee);
  const bande = bandeUrgence(delai);
  carte.className = `pcard pcard--${bande}`;

  // 1. POUR QUI — le nom du dossier, et la référence du ticket dessous.
  const client = document.createElement('div');
  client.className = 'pcard__client';
  client.textContent = r.billing_company || 'Sans nom';
  const ref = document.createElement('div');
  ref.className = 'pcard__ref';
  ref.textContent = (r.fiche && r.fiche.ref) || '';
  const blocClient = pcardBloc('Client', client);
  if (ref.textContent) blocClient.appendChild(ref);

  // 2. QUOI — la description, puis les deux puces qui situent la commande.
  const nom = document.createElement('div');
  nom.className = 'pcard__name';
  nom.textContent = r.product || 'Sans description';
  const meta = document.createElement('div');
  meta.className = 'pcard__meta';
  const puce = (texte) => {
    const s = document.createElement('span');
    s.className = 'pcard__pill';
    s.textContent = texte;
    return s;
  };
  meta.appendChild(puce(PRIORITY_LEVELS[prioBand(r)].label));
  // On est DÉJÀ dans cette famille (son nom coiffe l'écran) : répéter
  // « Demande & chiffrage › » sur chaque carte n'apprend rien et vole la place
  // de la seule information neuve, la sous-étape.
  meta.appendChild(puce(r.stage === currentStage
    ? (SUB_LABEL[r.sub_stage] || (familyHasSub(r.stage) ? 'à préciser' : STAGE_LABEL[r.stage]))
    : stageDestinationLabel(r.stage, r.sub_stage ?? null)));
  if (r.flag) {
    const pf = puce(FLAG_BY_VALUE[r.flag] ? FLAG_BY_VALUE[r.flag].label : 'À voir');
    pf.classList.add('pcard__pill--' + (r.flag === 'bloque' ? 'bloque' : 'a-voir'));
    meta.appendChild(pf);
  }
  // LE MOTIF, PAS SEULEMENT LA PASTILLE. « Bloquée » sans le pourquoi oblige à
  // ouvrir la fiche pour comprendre — ou, avant, à rallumer une colonne du
  // tableau, ce que personne ne devine. La raison se lit sur la carte.
  const motif = document.createElement('div');
  motif.className = 'pcard__motif';
  motif.textContent = r.flag_reason || '';
  motif.hidden = !(r.flag && r.flag_reason);

  // 3. COMBIEN DE TEMPS IL RESTE — la seule question que le tableau ne posait
  //    nulle part, alors que c'est celle qui décide de l'ordre de la journée.
  const delaiEl = document.createElement('div');
  const remise = document.createElement('div');
  remise.className = 'pcard__sub';
  const heure = r.fiche && r.fiche.heureSouhaitee ? ` à ${r.fiche.heureSouhaitee.replace(':', 'h')}` : '';
  remise.textContent = `Remise client : ${dateFr(r.deadline)}${heure}`;
  const cible = document.createElement('div');
  cible.className = 'pcard__sub';

  // Le délai restant suit l'HORLOGE, pas la donnée : on le réécrit sur place à
  // chaque minute (voir rafraichirTemps) plutôt que de reconstruire la carte —
  // reconstruire, c'était refaire tout le DOM du planning une fois par minute.
  const majDelai = () => {
    const d = tempsRestant(r.deadline, r.fiche && r.fiche.heureSouhaitee);
    const b = bandeUrgence(d);
    for (const x of ['retard', 'urgent', 'calme']) carte.classList.toggle(`pcard--${x}`, x === b);
    delaiEl.className = 'pcard__delai' + (b === 'calme' ? '' : ` pcard__delai--${b}`);
    delaiEl.textContent = d.texte;
    cible.textContent = `À terminer avant ${d.echeanceTexte}`;
  };
  majDelai();
  carte.__majTemps = majDelai;

  // 4. COMBIEN — le TTC, et le référent qu'on change d'un clic.
  const montant = document.createElement('div');
  if (r.project_value == null) {
    montant.className = 'pcard__value pcard__value--vide';
    montant.textContent = 'À chiffrer';
  } else {
    montant.className = 'pcard__value';
    montant.textContent = eur(Number(r.project_value));
  }
  const refs = document.createElement('div');
  refs.className = 'pcard__refs';
  const nomRef = document.createElement('div');
  nomRef.className = 'pcard__ref-name';
  // Le nom EFFECTIF, comme dans le tableau : celui posé à la main sur la ligne,
  // sinon le référent (ou le pilote) PAR DÉFAUT de la catégorie. La carte lisait
  // la colonne brute et annonçait « Non attribué » sur des commandes que le
  // tableau, lui, montrait bien nommées — la règle du patron (« aucune commande
  // n'est anonyme ») était donc fausse sur la vue par défaut.
  const nomEffectif = () => {
    const manuels = isManualReferent(r) ? [r.referent] : [];
    if (manuels.length) return { qui: manuels.join(', '), auto: false };
    const base = referentsOf(r.stage, r.sub_stage);
    if (base.length) return { qui: base.join(', '), auto: true };
    const pilote = effectivePilot(r);
    return pilote ? { qui: pilote, auto: !isManualPilot(r) } : { qui: 'Non attribué', auto: false };
  };
  const eff = nomEffectif();
  nomRef.textContent = `Référent : ${eff.qui}`;
  nomRef.classList.toggle('is-auto', eff.auto);
  if (eff.auto) attachTip(nomRef, 'Nom par défaut de la catégorie — appuyer sur une initiale pour en nommer un autre');
  for (const e of EMPLOYEES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pcard__ref-btn' + (r.referent === e ? ' is-on' : '');
    b.textContent = initiales(e);
    b.setAttribute('aria-label', `Référent : ${e}`);
    attachTip(b, e);
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      // Re-cliquer sur le référent en place le retire : c'est le même geste
      // pour attribuer et pour désattribuer, personne n'a à chercher comment.
      const valeur = r.referent === e ? null : e;
      patch(r, { referent: valeur }, () => {
        r.referent = valeur;
        // Sans invalidation, la carte n'est PAS reconstruite : sa signature
        // repose sur `updated_at`, que le serveur seul fait bouger. Le clic
        // restait donc sans effet visible pendant un aller-retour réseau — on
        // re-tapait, et le second tap annulait l'attribution.
        invalidateRowCache(r.id);
        applySortAndRender();
      });
    });
    refs.append(b);
  }

  const ouvrir = document.createElement('button');
  ouvrir.type = 'button';
  ouvrir.className = 'pcard__open';
  ouvrir.setAttribute('aria-label', 'Ouvrir la fiche projet');
  attachTip(ouvrir, 'Ouvrir la fiche projet');
  ouvrir.appendChild(strokeIcon(['M7 17L17 7', 'M9 7h8v8']));
  ouvrir.addEventListener('click', (ev) => { ev.stopPropagation(); openLigneDetail(r.id); });

  // SUPPRIMER. La corbeille n'existait que sur le tableau complet — or le
  // planning s'ouvre sur les cartes : sans elle, une commande entrée par erreur
  // ne pouvait plus sortir du planning. Toujours visible (pas de survol : au
  // comptoir on est au doigt), et le geste passe par la même confirmation que
  // sur le tableau.
  const suppr = document.createElement('button');
  suppr.type = 'button';
  suppr.className = 'pcard__del';
  suppr.setAttribute('aria-label', 'Supprimer cette commande');
  attachTip(suppr, 'Supprimer cette commande');
  suppr.appendChild(strokeIcon(['M3 6h18', 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2',
    'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6']));
  suppr.addEventListener('click', (ev) => { ev.stopPropagation(); removeRow(r); });

  // Poignée de prise TACTILE : au doigt, c'est par elle (et elle seule) que la
  // carte se glisse — le reste de la surface fait défiler la liste. À la
  // souris, toute la carte reste saisissable (cf. attachDrag).
  const prise = document.createElement('div');
  prise.className = 'pcard__handle';
  prise.setAttribute('aria-hidden', 'true');
  prise.appendChild(gripIcon());

  const actions = document.createElement('div');
  actions.className = 'pcard__actions';
  actions.append(prise, ouvrir, suppr);

  carte.append(
    blocClient,
    pcardBloc('Projet', nom, meta, motif),
    pcardBloc('Délai de production restant', delaiEl, remise, cible),
    pcardBloc('TTC', montant, refs, nomRef),
    actions,
  );

  // La carte se glisse sur le rail pour changer d'étape, comme une ligne du
  // tableau. On saisit la carte elle-même : elle n'a pas de poignée, tout son
  // fond est zone de prise (hors boutons, qui arrêtent l'évènement).
  carte.classList.add('pcard__grip');
  attachDrag(carte, carte, r);
  return carte;
}

function renderCards(data) {
  const voulus = new Set(data.map((r) => String(r.id)));
  for (const [id, entry] of cardEls) {
    if (!voulus.has(id)) { entry.el.remove(); cardEls.delete(id); }
  }
  const ordre = [];
  for (const r of data) {
    const id = String(r.id);
    const sig = `${r.id}:${r.updated_at}`;
    let entry = cardEls.get(id);
    if (!entry) {
      entry = { el: buildCard(r), sig };
      cardEls.set(id, entry);
    } else if (entry.sig !== sig && !estPrise(entry.el)) {
      const el = buildCard(r);
      entry.el.replaceWith(el);
      entry.el = el;
      entry.sig = sig;
    }
    ordre.push(entry.el);
  }
  let prev = null;
  for (const node of ordre) {
    if (!estPrise(node)) {
      const attendu = prev ? prev.nextSibling : $cards.firstChild;
      if (node !== attendu) $cards.insertBefore(node, attendu);
    }
    prev = node;
  }
}

// Une ligne qu'on NE TOUCHE PAS pendant un rendu : soit elle est en train d'être
// glissée, soit un doigt vient de s'y poser et le geste n'a pas encore décidé
// s'il en était un. Les deux comptent — c'est la seconde qui manquait.
//
// La marque « prise » n'a de valeur QUE tant qu'un geste est réellement en
// cours. Si le `pointerup` ne parvient jamais (bascule d'application au milieu
// d'un geste, sur tablette), la classe reste posée sur la carte : sans cette
// garde, la ligne serait figée pour de bon — jamais reconstruite, elle
// afficherait indéfiniment ce qu'elle montrait à cet instant-là.
const estPrise = (el) => !!el && (el.classList.contains('dragging')
  || (!!dragState && el.classList.contains('prise-en-cours')));

function renderRows(data) {
  // Vue épurée : une carte par projet, le tableau reste monté mais masqué.
  if (modeCartes()) { renderCards(data); return; }

  const wanted = new Set(data.map((r) => String(r.id)));

  // 1. Retirer les <tr> de données dont l'id n'est plus présent dans la liste voulue.
  for (const [id, entry] of rowEls) {
    if (!wanted.has(id)) { entry.tr.remove(); rowEls.delete(id); }
  }

  // 2. Construire la séquence ordonnée des lignes, en créant / reconstruisant /
  //    réutilisant chacune au passage.
  const order = [];
  for (const r of data) {
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

  // 3. Replacer tous les nœuds dans l'ordre voulu (sans déplacer une ligne en
  //    cours de drag : sa position est pilotée à la main).
  let prev = null;
  for (const node of order) {
    if (!estPrise(node)) {
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
  if (estPrise(tr)) return true;
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
  const cartes = modeCartes();
  for (const r of lastRendered) {
    const entry = cartes ? cardEls.get(String(r.id)) : rowEls.get(String(r.id));
    if (!entry) continue;
    const match = !q || SEARCH_FIELDS.some((f) => fold(r[f]).includes(q));
    (cartes ? entry.el : entry.tr).classList.toggle('is-hidden', !match);
    if (match) visible++;
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
  if (modeCartes()) return;      // les cartes sont déjà détachées les unes des autres
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

// LA « LIGNE BROUILLON » N'EXISTE PLUS. Elle datait de l'époque où l'on créait
// une ligne vide directement dans la grille : depuis que Nouveau Projet est la
// seule porte d'entrée, plus rien n'en crée. Le code restant, lui, frappait de
// vraies commandes : un dossier du comptoir sans nom, sans description, sans
// note ni date cochait le test « brouillon » et perdait sa poignée, sa
// priorité, ses boutons dupliquer / supprimer — et disparaissait de la
// recherche globale. Toute ligne est désormais une ligne.

function buildRow(r) {
  const tr = document.createElement('tr');
  tr.dataset.id = r.id;
  // Teinte d'alerte posée ici : cellFlag() ne peut pas atteindre le <tr> tant que
  // sa cellule n'est pas montée (elle la remet à jour aux changements suivants).
  if (r.flag === 'bloque') tr.classList.add('is-bloque');
  else if (r.flag === 'a_voir') tr.classList.add('is-a-voir');

  // début de ligne : poignée draggable + icône contact discret
  // (téléphone / email), sans modifier le reste.
  const tdHandle = document.createElement('td');
  tdHandle.className = 'col-handle';
  const handleCell = document.createElement('div');
  handleCell.className = 'handle-cell';
  const grip = document.createElement('div');
  grip.className = 'handle';
  attachTip(grip, 'glisser pour déplacer');
  grip.appendChild(gripIcon());
  handleCell.appendChild(grip);
  attachDrag(grip, tr, r);
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
  for (const t of SEND_TARGETS) {
    if (t.slug === r.stage) continue; // déjà dans cette catégorie
    const send = document.createElement('button');
    send.className = 'send-btn';
    send.type = 'button';
    attachTip(send, `Envoyer vers ${t.label}`);
    send.setAttribute('aria-label', `Envoyer vers ${t.label}`);
    const fleche = strokeIcon(['M5 12h13', 'M13 6l6 6-6 6']);
    fleche.setAttribute('width', '13');
    fleche.setAttribute('height', '13');
    const nom = document.createElement('span');
    nom.textContent = t.label;
    send.append(fleche, nom);
    send.addEventListener('click', () => { if (armerUneFois(send)) copyToStage(r, t.slug); });
    tdDel.appendChild(send);
  }
  const dup = document.createElement('button');
  dup.className = 'dup-btn';
  dup.type = 'button';
  attachTip(dup, 'Dupliquer cette commande');
  dup.setAttribute('aria-label', 'Dupliquer cette commande');
  dup.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  dup.addEventListener('click', () => { if (armerUneFois(dup)) duplicateRow(r); });
  const del = document.createElement('button');
  del.className = 'del-btn';
  del.type = 'button';
  attachTip(del, 'Supprimer cette commande');
  del.setAttribute('aria-label', 'Supprimer cette commande');
  del.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
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

// Cellule priorité : badge texte (Basse/Moyenne/Haute), menu au clic — même
// patron que cellType. Les étoiles ★☆☆ étaient moins lisibles d'un coup d'œil
// et moins « pro » qu'un mot ; « Haute » seule reste en accent (c'est la
// priorité qui doit sauter aux yeux dans la file), Basse/Moyenne restent
// neutres pour ne pas rivaliser avec elle.
function cellStars(r) {
  const td = document.createElement('td');
  td.className = 'col-stars-cell';
  const tag = document.createElement('button');
  tag.type = 'button';
  const renderTag = () => {
    const lvl = PRIORITY_LEVELS[prioBand(r)];
    tag.className = 'prio-tag ' + lvl.cls;
    tag.textContent = lvl.label;
  };
  renderTag();
  attachTip(tag, 'cliquer pour changer la priorité');
  tag.addEventListener('click', (e) => {
    e.stopPropagation();
    const cur = prioBand(r);
    openMenu(tag, [1, 2, 3].map((i) => ({ value: i, label: PRIORITY_LEVELS[i].label })), cur, (val) => {
      if (val === cur) return;
      patch(r, { priority: val }, () => { r.priority = val; renderTag(); });
    });
  });
  td.appendChild(tag);
  return td;
}

// Type de client : Pro / Perso / Asso / Revendeur. Menu au clic (4 valeurs).
function cellType(r) {
  const td = document.createElement('td');
  td.className = 'col-type';
  td.appendChild(typeControl(r));
  return td;
}

// La puce de type, détachée de sa cellule — la fiche projet la réutilise (elle
// n'existait que dans le tableau complet, donc nulle part sur la vue par défaut).
function typeControl(r) {
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
      patch(r, { client_type: val }, () => {
        r.client_type = val;
        renderType();
        // Seul un PARTICULIER lit son nom en deux graisses : la cellule voisine
        // doit suivre le changement de type sans attendre un rechargement.
        const tr = type.closest('tr');
        const box = tr && tr.querySelector('.client-name');
        if (box) paintClientName(box, val);
      });
    });
  });
  return type;
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
  td.appendChild(respControl(r));
  return td;
}

// Pilote + référent, détachés de leur cellule : la fiche projet les réutilise.
// Le PILOTE, en particulier, n'était modifiable que depuis le tableau complet —
// donc inaccessible sur la vue par défaut, où seul le référent se change.
function respControl(r) {
  const stack = document.createElement('div');
  stack.className = 'resp-stack';

  // --- Pilote (responsable) ---
  const pilot = document.createElement('button');
  pilot.type = 'button';
  // --- Référent (2e personne) : modifiable par n'importe quel collaborateur ---
  const ref = document.createElement('button');
  ref.type = 'button';

  // Cas le plus courant : le référent EST le pilote. Répéter son nom juste en
  // dessous n'apprend rien et alourdit la ligne — la puce ne réapparaît que
  // lorsque le référent diffère effectivement du pilote (ou qu'il y en a
  // plusieurs), le seul cas où l'information est nouvelle.
  const updateRefVisibility = () => {
    const pilotWho = effectivePilot(r);
    const refWho = effectiveReferents(r);
    ref.hidden = refWho.length > 0 && refWho.every((n) => n === pilotWho);
  };

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
      name.textContent = 'Non défini';
      pilot.append(name);
    }
    attachTip(pilot, auto
      ? `Pilote par défaut de la catégorie : ${who} — cliquer pour en nommer un autre`
      : 'assigner le pilote');
    updateRefVisibility();
  };
  renderPilot();
  pilot.addEventListener('click', (e) => {
    e.stopPropagation();
    const base = ownerOf(r.stage, r.sub_stage);
    const items = RESPONSABLES.map((n) => ({ value: n, label: n }));
    items.push({ value: null, label: base ? `Par défaut (${base})` : 'Aucun', muted: true });
    openMenu(pilot, items, r.responsable ?? null, (val) => {
      if ((val ?? null) === (r.responsable ?? null)) return;
      patch(r, { responsable: val }, () => {
        r.responsable = val;
        renderPilot();
        // La carte affiche elle aussi un nom effectif : elle doit se remonter.
        invalidateRowCache(r.id);
        applySortAndRender();
      });
    });
  });

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
    updateRefVisibility();
  };
  renderRef();
  ref.addEventListener('click', (e) => {
    e.stopPropagation();
    const base = referentsOf(r.stage, r.sub_stage);
    const items = EMPLOYEES.map((n) => ({ value: n, label: n }));
    items.push({ value: null, label: base.length ? `Par défaut (${base.join(', ')})` : 'Aucun', muted: true });
    openMenu(ref, items, r.referent ?? null, (val) => {
      if ((val ?? null) === (r.referent ?? null)) return;
      patch(r, { referent: val }, () => {
        r.referent = val;
        renderRef();
        invalidateRowCache(r.id);
        applySortAndRender();
      });
    });
  });

  stack.append(pilot, ref);
  return stack;
}

// Colonne ÉTAT : l'alerte que n'importe qui pose sur la commande — BLOQUÉE
// (avec le motif : pourquoi ça n'avance plus) ou À VOIR. Un clic ouvre le menu ;
// choisir une alerte enchaîne sur la saisie du motif (facultatif).
function cellFlag(r) {
  const td = document.createElement('td');
  td.className = 'col-flag-cell';
  td.appendChild(flagControl(r, td));
  return td;
}

// Le contrôle d'alerte lui-même, détaché de sa cellule : la fiche projet s'en
// sert telle quelle. Sans ça, poser ou lever un blocage n'était possible que
// dans le tableau complet — donc invisible depuis la vue par défaut (cartes),
// où l'on voyait « Bloquée » sans pouvoir ni savoir pourquoi ni y remédier.
// `hote` sert à retrouver la ligne du tableau à teinter (null dans la fiche).
function flagControl(r, hote) {
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
    const tr = hote && hote.closest ? hote.closest('tr') : null;
    if (tr) {
      tr.classList.toggle('is-bloque', r.flag === 'bloque');
      tr.classList.toggle('is-a-voir', r.flag === 'a_voir');
    }
  };

  // Enregistre alerte + motif d'un bloc (un seul PATCH, un seul rollback).
  const save = (flag, motif) => {
    const body = { flag: flag ?? null, flag_reason: flag ? (motif || null) : null };
    if (body.flag === (r.flag ?? null) && body.flag_reason === (r.flag_reason ?? null)) return;
    patch(r, body, () => {
      r.flag = body.flag;
      r.flag_reason = body.flag_reason;
      render();
      // La carte porte désormais la pastille ET le motif : elle doit se remonter,
      // que l'alerte ait été posée depuis le tableau ou depuis la fiche.
      invalidateRowCache(r.id);
      applySortAndRender();
    });
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
  return stack;
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

// (Re)peint la vue « Prénom NOM » superposée au champ du nom de dossier. `box`
// est le conteneur .client-name : il porte le champ ET la vue. Un particulier se
// lit prénom en graisse normale + NOM DE FAMILLE EN GRAS (c'est le nom qu'on
// cherche en balayant la colonne) ; une société garde son nom d'un seul bloc.
function paintClientName(box, clientType) {
  const input = box.querySelector('.client-company');
  const view = box.querySelector('.client-company-view');
  if (!input || !view) return;
  const { prenom, nom } = clientType === 'perso'
    ? splitPersoName(input.value)
    : { prenom: '', nom: '' };
  // Rien à couper en deux graisses (société, nom seul, champ vide) : le champ
  // s'affiche tel quel et la vue reste vide.
  const deuxParts = !!(prenom && nom);
  box.classList.toggle('is-split', deuxParts);
  if (!deuxParts) { view.replaceChildren(); return; }
  const famille = document.createElement('b');
  famille.textContent = nom;
  view.replaceChildren(document.createTextNode(`${prenom} `), famille);
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

  // Un <input> ne porte qu'UNE graisse : pour lire « Jean DUPONT » avec le nom
  // en gras, une vue formatée se superpose au champ et s'efface dès qu'il prend
  // le focus. La saisie, elle, reste un champ texte ordinaire.
  const name = document.createElement('div');
  name.className = 'client-name';
  const view = document.createElement('div');
  view.className = 'client-company-view';
  view.setAttribute('aria-hidden', 'true');   // le champ porte déjà la valeur
  name.append(company, view);

  const peindre = () => paintClientName(name, r.client_type);
  bindInline(company, r, 'billing_company', (v) => v === '' ? null : v, capitalizeName);
  // Écouteurs posés APRÈS bindInline : son propre `blur` range la casse en
  // premier, la vue se repeint donc sur la valeur définitive.
  company.addEventListener('input', peindre);
  company.addEventListener('blur', peindre);
  peindre();
  syncTitleOnOverflow(company);

  const line = document.createElement('div');
  line.className = 'client-line';
  line.appendChild(name);

  // Les pastilles sur leur PROPRE rangée, sous le nom (cf. .client-docs) : à
  // cinq ou six elles occupent 172 à 204 px incompressibles, alors que le nom se
  // réduit jusqu'à zéro. Sur la même rangée, c'était donc toujours le nom qui
  // disparaissait — et le cluster sortait quand même de la cellule pour
  // recouvrir la colonne voisine.
  const docs = document.createElement('div');
  docs.className = 'client-docs';
  docs.appendChild(cellWhatsapp(r));
  docs.appendChild(cellPdfSlot(r, 'devis'));
  docs.appendChild(cellPdfSlot(r, 'facture'));
  docs.appendChild(cellPdfSlot(r, 'bat'));
  docs.appendChild(cellLigneDetailButton(r));
  const pdfWa = cellPdfWhatsapp(r);
  if (pdfWa) docs.appendChild(pdfWa);

  stack.append(line, docs);
  td.appendChild(stack);
  return td;
}

// Toutes les icônes maison (WhatsApp/devis/facture) montées en DOM (pas en
// `innerHTML`), un seul set fin au trait : même stroke-width, même viewBox,
// pour qu'elles se lisent comme UNE famille dans la ligne du tableau plutôt
// que trois styles différents côte à côte. WhatsApp portait avant un logo
// plein (fill) — reconnaissable seul, mais visuellement plus « lourd » que
// les deux glyphes voisins ; la couleur de marque (#25d366, .wa-btn) et
// l'infobulle suffisent à l'identifier sans logo plein.
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

// WhatsApp : bulle de conversation au trait — la couleur de marque (.wa-btn)
// et l'infobulle portent la reconnaissance, pas un logo plein.
function whatsappIcon() {
  return strokeIcon([
    'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z',
  ]);
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

// BAT (Bon À Tirer) : un sceau avec un check — la validation avant production.
function batIcon() {
  return strokeIcon([
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
    'M8 12l2.5 2.5L16 9',
  ]);
}

// Détail : chevron — « voir le détail complet de cette ligne ».
function detailIcon() {
  return strokeIcon(['M9 6l6 6-6 6']);
}

// Libellés pour les infobulles des emplacements PDF de la ligne.
const PDF_SLOT_LABELS = {
  devis: { noun: 'devis', withArticle: 'le devis' },
  facture: { noun: 'facture', withArticle: 'la facture' },
  bat: { noun: 'BAT', withArticle: 'le BAT' },
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

const PDF_SLOT_ICON = { devis: devisIcon, facture: factureIcon, bat: batIcon };

// Pastille PDF à deux états, pour `devis`, `facture` et `bat` (mêmes règles,
// icône propre à chaque type — cf. PDF_SLOT_ICON) :
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

// Pastille WhatsApp : un clic ouvre WhatsApp (application sur la tablette,
// WhatsApp Web sur le PC) avec le message du patron déjà écrit — l'employé n'a
// plus qu'à relire et appuyer sur Envoyer. Sans numéro lisible, la pastille
// reste affichée mais grisée et inerte plutôt que de disparaître sans
// explication : un nouvel arrivant doit comprendre pourquoi elle manque à
// l'action (« pas de numéro »), pas juste ne rien voir.
// L'adresse est recalculée AU CLIC et pas seulement au rendu : le nom du
// dossier, la description ou le message du patron ont pu changer depuis que la
// ligne est à l'écran, et c'est le texte du moment qu'il faut envoyer.
function cellWhatsapp(r) {
  const lien = rowWhatsappLink(r);
  if (!lien) {
    const span = document.createElement('span');
    span.className = 'wa-btn wa-btn--disabled';
    span.setAttribute('aria-disabled', 'true');
    attachTip(span, 'WhatsApp — aucun numéro de téléphone renseigné pour ce client');
    span.appendChild(whatsappIcon());
    return span;
  }
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
  syncTitleOnOverflow(name);

  stack.appendChild(name);
  td.appendChild(stack);
  return td;
}

// Prix : montant TTC de la commande — celui que le client paie. Le HT s'affiche
// dessous, calculé, jamais saisi. Vide tant que rien n'est chiffré : le prix ne
// conditionne plus aucun déplacement de ligne, il ne fait que renseigner.
function cellPrice(r) {
  const td = document.createElement('td');
  td.className = 'col-price-cell';

  const price = document.createElement('input');
  price.className = 'cell-input num cell-price';
  price.type = 'text';
  price.inputMode = 'decimal';
  price.value = r.project_value != null ? String(r.project_value) : '';
  price.placeholder = '—';

  const ht = document.createElement('span');
  ht.className = 'cell-price-ht';
  const refreshHt = () => { ht.textContent = htLabel(r.project_value); };
  refreshHt();

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
  // Le HT suit la frappe : on voit tout de suite ce que la remise donne hors
  // taxe, sans attendre l'enregistrement de la cellule.
  price.addEventListener('input', () => {
    const n = parseFloat(price.value.trim().replace(',', '.'));
    ht.textContent = price.value.trim() === '' || Number.isNaN(n) ? '' : htLabel(n);
  });
  price.addEventListener('blur', refreshHt);

  td.append(price, ht);
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
  desc.placeholder = '+ Ajouter une note';
  desc.setAttribute('aria-label', 'Infos — note libre sur la commande');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'desc-toggle';
  attachTip(toggle, 'Afficher / masquer les lignes suivantes');
  toggle.setAttribute('aria-label', 'Afficher les lignes suivantes');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  let open = false;
  let lastSent = r.description ?? '';
  const isMulti = () => desc.value.indexOf('\n') !== -1;

  const sync = () => {
    stack.classList.toggle('desc-empty', desc.value.trim() === '');
    const multi = isMulti();
    toggle.hidden = !multi;
    if (!multi) open = false;
    toggle.classList.toggle('open', open);
    // hauteur : repliée = 1 ligne tronquée (CSS) ; dépliée OU en édition = tout le contenu.
    const expanded = open || document.activeElement === desc;
    desc.classList.toggle('expanded', expanded);
    if (expanded) {
      desc.style.height = 'auto';
      desc.style.height = desc.scrollHeight + 'px';
    } else {
      desc.style.height = '';
    }
    // Repliée + texte tronqué : l'infobulle donne la note complète au survol.
    // `title` et non `attachTip` : attachTip pose aussi un `aria-label`, et le
    // lecteur d'écran annonçait alors le CONTENU du champ en guise d'étiquette
    // (« Vérifier la taille des logos, zone de saisie ») au lieu de son rôle.
    desc.title = desc.value.trim() ? desc.value : 'cliquer pour ajouter une note';
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
  // Le badge est RELATIF à aujourd'hui (« 4 j », « En retard 1 j ») : il se
  // repeint à chaque minute sans reconstruire la ligne (voir rafraichirTemps).
  td.__majTemps = showBadge;
  return td;
}

// --- Side bar détail de ligne -----------------------------------------------
// Panneau à droite, calqué sur le tiroir de clients.js (.cl-drawer) : mêmes
// jetons CSS que la grille, classes dédiées (.ligne-drawer) pour ne pas
// mélanger deux fonctionnalités indépendantes. Une seule instance, montée au
// premier clic ; son contenu est entièrement reconstruit à chaque ouverture
// ou re-synchronisation — jamais de référence figée à un objet `r` : `rows`
// est remplacé (pas muté) à chaque poll/SSE (cf. renderRows), donc on stocke
// seulement l'id et on refait `rows.find(...)` à chaque rendu.
let ligneDrawerEl = null;
let ligneDrawerCard = null;
let ligneDrawerId = null; // id (string) de la ligne affichée, ou null si fermé

function ensureLigneDrawer() {
  if (ligneDrawerEl) return;
  ligneDrawerEl = document.createElement('div');
  ligneDrawerEl.className = 'ligne-drawer';
  ligneDrawerEl.hidden = true;
  const scrim = document.createElement('div');
  scrim.className = 'ligne-drawer__scrim';
  scrim.addEventListener('click', closeLigneDetail);
  ligneDrawerCard = document.createElement('aside');
  ligneDrawerCard.className = 'ligne-drawer__card';
  ligneDrawerCard.setAttribute('role', 'dialog');
  ligneDrawerCard.setAttribute('aria-modal', 'true');
  ligneDrawerCard.setAttribute('aria-label', 'Détail de la commande');
  ligneDrawerEl.append(scrim, ligneDrawerCard);
  document.body.appendChild(ligneDrawerEl);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ligneDrawerId) closeLigneDetail();
  });
  // La fiche se DÉCLARE modale (`aria-modal`) : la tabulation doit donc y
  // rester. Sans ce filet, Tab repartait derrière le voile, dans un planning
  // qu'on ne voit plus mais dont les champs restaient modifiables.
  ligneDrawerEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !ligneDrawerId) return;
    const cibles = [...ligneDrawerCard.querySelectorAll(
      'a[href], button:not([disabled]), input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
    )].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!cibles.length) return;
    const premier = cibles[0];
    const dernier = cibles[cibles.length - 1];
    if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
    else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
  });
}

// Ce qui avait le focus avant l'ouverture de la fiche : on le lui rend à la
// fermeture, sinon le clavier repart du haut de la page à chaque consultation.
let ldFocusAvant = null;

// Le fond ne doit être ni cliquable ni tabulable pendant qu'une fiche est
// ouverte. `inert` fait les deux (et le retire de l'arbre d'accessibilité) ;
// il est ignoré sans dommage sur un navigateur qui ne le connaît pas.
function figerLeFond(fige) {
  const shell = document.querySelector('.shell');
  if (shell) shell.inert = fige;
}

// La liste ne transporte qu'un RÉSUMÉ de la fiche (voir server.js) : le détail
// complet — récapitulatif ligne à ligne du comptoir, contrôles, paiement — ne
// se charge que pour la ligne qu'on ouvre. On le garde ici, car chaque
// rafraîchissement remplace les objets de `rows` par des versions allégées.
const fichesCompletes = new Map(); // id (string) -> fiche complète

// Recolle la fiche complète sur la ligne si on l'a déjà chargée.
function completerFiche(r) {
  if (!r || !r.fiche || !r.fiche.fichePartielle) return r;
  const pleine = fichesCompletes.get(String(r.id));
  if (pleine) r.fiche = pleine;
  return r;
}

async function chargerFicheComplete(id) {
  const cle = String(id);
  if (fichesCompletes.has(cle)) return fichesCompletes.get(cle);
  const complet = await api('GET', `/api/requests/${cle}`);
  const fiche = complet && complet.fiche && typeof complet.fiche === 'object' ? complet.fiche : {};
  fichesCompletes.set(cle, fiche);
  const r = rows.find((x) => String(x.id) === cle);
  if (r) r.fiche = fiche;
  return fiche;
}

// Le serveur vient de nous rendre une commande AVEC sa fiche complète (réponse
// d'un PATCH) : c'est elle qui fait foi désormais. Sans cette mise à jour, le
// cache gardait la version chargée à l'ouverture du tiroir et `completerFiche`
// la reposait au premier rafraîchissement temps réel — la correction qu'on
// venait d'enregistrer (heure de retrait, détail du comptoir) disparaissait de
// la fiche ~150 ms après l'avoir validée.
function memoriserFiche(ligne) {
  if (!ligne || !ligne.id) return;
  const f = ligne.fiche;
  if (!f || typeof f !== 'object' || f.fichePartielle) return;
  fichesCompletes.set(String(ligne.id), f);
}

// Un AUTRE poste a touché au planning : notre copie du détail peut être périmée
// (le temps réel ne transporte que le résumé). On oublie ce qu'on a mis de côté
// et, si une fiche est ouverte, on va rechercher SON détail — une seule requête,
// pour la seule commande qu'on regarde.
// La relecture est DIFFÉRÉE et coalescée, comme le rafraîchissement de la
// grille : une rafale d'évènements (un collègue qui range une étape) déclenchait
// autant de `GET /api/requests/:id` qu'il y avait d'évènements, tous en vol en
// même temps, pour la même fiche.
let ficheDebounce = null;
const FICHE_DEBOUNCE_MS = 150;

function rafraichirFichesApresChangement() {
  fichesCompletes.clear();
  if (!ligneDrawerId) return;
  clearTimeout(ficheDebounce);
  ficheDebounce = setTimeout(() => {
    const id = ligneDrawerId;
    if (!id) return;
    chargerFicheComplete(id)
      .then(() => { if (ligneDrawerId === id) renderLigneDetailIfOpen(); })
      .catch(() => { /* silencieux : la fiche reste utilisable avec ce qu'elle a */ });
  }, FICHE_DEBOUNCE_MS);
}

function openLigneDetail(id) {
  ensureLigneDrawer();
  // On ouvre une fiche : rien de ce qui a été tapé dans la précédente n'a à
  // suivre. (Un enregistrement réussi nettoie déjà, mais on peut aussi fermer.)
  if (ligneDrawerId !== String(id)) ldOublierSaisie();
  const premiereOuverture = !ligneDrawerId;
  if (premiereOuverture) ldFocusAvant = document.activeElement;
  ligneDrawerId = String(id);
  ligneDrawerEl.hidden = false;
  figerLeFond(true);
  // Chargement du détail en tâche de fond : le tiroir s'ouvre TOUT DE SUITE
  // avec ce que la grille connaît déjà (client, projet, prix, échéance), et le
  // récapitulatif complet s'y ajoute dès qu'il arrive. Personne n'attend
  // devant un écran vide.
  chargerFicheComplete(id)
    .then(() => {
      if (ligneDrawerId !== String(id)) return;
      renderLigneDetail();
      // Ce second rendu remplace le corps de la fiche : s'il a emporté
      // l'élément qui avait le focus (le bouton Fermer posé à l'ouverture) et
      // que personne d'autre ne l'a pris entre-temps, on le repose. Sinon le
      // clavier se retrouve sur <body>, hors de la fiche qui se dit modale.
      if (document.activeElement === document.body) focusFiche();
    })
    .catch((err) => {
      // Le tiroir reste utilisable sans le récapitulatif, mais on ne le passe
      // pas sous silence : sinon un détail manquant ressemble à un détail
      // « jamais enregistré », et personne ne cherche plus loin.
      console.warn('Détail de la commande non chargé :', err);
      showToast('Détail complet indisponible — vérifie la connexion.');
    });
  // Le corps du tiroir précédent est encore monté (closeLigneDetail masque, ne
  // vide pas) et le navigateur lui rend sa position de scroll dès qu'il
  // redevient visible : on la remet à zéro APRÈS l'affichage — sinon la remise
  // à zéro tombe sur un élément sans boîte de défilement et reste sans effet —
  // pour que renderLigneDetail n'aille pas reporter le scroll d'une AUTRE ligne
  // sur celle qu'on ouvre.
  const oldBody = ligneDrawerCard.querySelector('.ld-body');
  if (oldBody) oldBody.scrollTop = 0;
  renderLigneDetail();
  // Le clavier entre dans la fiche — mais SEULEMENT à l'ouverture : reposer le
  // focus à chaque re-rendu (temps réel) arracherait le curseur du champ en
  // cours de saisie.
  focusFiche();
}

// Pose le focus sur le bouton Fermer de la fiche : le premier arrêt du clavier
// à l'intérieur du panneau.
function focusFiche() {
  const fermer = ligneDrawerCard && ligneDrawerCard.querySelector('.ld-close');
  if (fermer) fermer.focus();
}

function closeLigneDetail() {
  if (!ligneDrawerEl) return;
  ligneDrawerId = null;
  ligneDrawerEl.hidden = true;
  figerLeFond(false);
  ldOublierSaisie();
  if (ldFocusAvant && ldFocusAvant.isConnected && ldFocusAvant.focus) ldFocusAvant.focus();
  ldFocusAvant = null;
}

// Rappelée après CHAQUE (re)rendu de la grille (poll, SSE, tri, sauvegarde
// locale) : la side bar se re-synchronise depuis `rows`, et se ferme si la
// ligne a quitté la vue courante (déplacée vers une autre étape, supprimée).
function renderLigneDetailIfOpen() {
  if (!ligneDrawerId) return;
  const r = completerFiche(rows.find((x) => String(x.id) === ligneDrawerId));
  // La fermeture passe AVANT la garde : un tiroir ouvert sur une ligne qui a
  // quitté la vue doit se fermer même si le focus est resté dedans.
  if (!r) { closeLigneDetail(); return; }
  if (isDrawerBusy()) return;
  renderLigneDetail();
}

// Vrai si le tiroir ne doit pas être reconstruit : focus d'édition à l'intérieur
// (même protection que isRowBusy pour une ligne de la grille). Sans elle, un
// rendu déclenché par un tiers — ex. `category-owners` en SSE, qui appelle
// applySortAndRender() sans passer par la garde isInteracting() de poll() —
// remplacerait le <textarea> des Notes et effacerait la saisie non sauvegardée.
// On se limite aux champs de saisie, comme isInteracting() : c'est ce qui
// garantit que poll() s'arrête AVANT d'avoir consommé lastRowsSig. Geler aussi
// sur un bouton ou un lien qui garde le focus laisserait le tiroir périmé pour
// de bon — poll() aurait avalé le changement sans jamais le rendre.
// Un menu / calendrier ouvert compte aussi : il est ancré à une puce du tiroir,
// que la reconstruction démonterait sous le popup (même règle qu'isInteracting).
// Ces popups sont transitoires — clic dehors ou Échap les ferme — donc le tiroir
// ne peut pas rester gelé.
function isDrawerBusy() {
  if (!ligneDrawerCard) return false;
  if (openMenuEl || openCalendar) return true;
  const ae = document.activeElement;
  if (!ae || !ligneDrawerCard.contains(ae)) return false;
  return ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT' || ae.tagName === 'SELECT';
}

// --- Champs éditables du tiroir --------------------------------------------
// Le tiroir n'est pas une fiche de lecture : TOUT ce qu'il affiche se modifie
// sur place, avec exactement les mêmes contrôles que la grille (même bindInline,
// mêmes menus, même calendrier) — donc les mêmes validations côté serveur.

// Une rangée « libellé / contrôle » : le libellé à gauche, le champ ou la puce
// modifiable à droite.
function ldRow(label, control) {
  const row = document.createElement('div');
  row.className = 'ld-field';
  const k = document.createElement('span');
  k.className = 'ld-field__label';
  k.textContent = label;
  row.append(k, control);
  return row;
}

// Après une modification faite DANS le tiroir : la grille affiche les mêmes
// valeurs (nom, prix, priorité, échéance…) et le tri peut déplacer la ligne —
// on périme sa signature et on re-rend.
// `syncDrawer` distingue les deux origines : une puce (menu, calendrier) doit
// se relire depuis `r`, donc le tiroir se reconstruit ; un champ de saisie
// affiche déjà la valeur tapée et n'a rien à reconstruire (cf. applySortAndRender).
function ldRefresh(r, syncDrawer = true) {
  invalidateRowCache(r.id);
  applySortAndRender({ syncDrawer });
}

// PATCH optimiste d'un champ choisi dans un menu du tiroir (rollback + resync
// gérés par patch()).
function ldPatch(r, body) {
  patch(r, body, () => {
    Object.assign(r, body);
    ldRefresh(r);
  });
}

// --- La saisie en cours dans la fiche ---------------------------------------
// La fiche est un FORMULAIRE : rien ne part avant « Enregistrer ». Or elle se
// reconstruit entièrement dès qu'un autre poste touche au planning (SSE). Deux
// dégâts, tous les deux silencieux : ce qu'on venait de taper disparaissait, et
// « Enregistrer » renvoyait les valeurs d'origine — écrasant au passage ce que
// le collègue venait de changer.
// On mémorise donc, pour chaque contrôle, LA VALEUR TELLE QU'ELLE A ÉTÉ RENDUE.
// La différence avec ce qu'affiche le contrôle, c'est exactement la correction
// de l'employé : elle survit aux reconstructions, et elle seule part au serveur.
let ldValeursRendues = {};   // { clé: valeur au moment du rendu }
let ldSaisieEnCours = {};    // { clé: valeur tapée, non encore enregistrée }

function ldOublierSaisie() {
  ldValeursRendues = {};
  ldSaisieEnCours = {};
}

// Déclare un contrôle et la valeur avec laquelle il vient d'être rempli.
function ldSuivi(cle, el, valeur) {
  el.dataset.ldKey = cle;
  ldValeursRendues[cle] = valeur == null ? '' : String(valeur);
  return el;
}

// Avant de tout reconstruire : on relève ce qui a été tapé et pas enregistré.
//
// UNE CORRECTION EST UN ÉCART À CE QU'ON A RENDU — encore faut-il qu'on ait
// rendu quelque chose. `ldValeursRendues` est vidé par `ldOublierSaisie()`
// (ouverture d'une AUTRE commande, fermeture, enregistrement réussi) ; sans la
// garde ci-dessous, la capture qui suit comparait alors les champs de la fiche
// PRÉCÉDENTE — encore montée à l'écran — à du vide, prenait tout pour une
// correction en cours, et `ldAppliquerSaisie()` la reposait sur la commande
// qu'on vient d'ouvrir. Ouvrir deux fiches à la suite remplissait la seconde
// avec le dossier de la première, et « Enregistrer » écrasait pour de bon le
// client, le projet, le prix, l'échéance et l'étape. Une clé absente de
// `ldValeursRendues` = ce contrôle n'appartient pas au rendu courant : il n'y a
// rien à en retenir.
function ldCapturerSaisie() {
  if (!ligneDrawerCard) return;
  for (const el of ligneDrawerCard.querySelectorAll('[data-ld-key]')) {
    const cle = el.dataset.ldKey;
    if (!(cle in ldValeursRendues)) continue;
    if (String(el.value) !== ldValeursRendues[cle]) ldSaisieEnCours[cle] = el.value;
  }
}

// Après reconstruction : on repose les corrections en cours par-dessus.
function ldAppliquerSaisie() {
  if (!ligneDrawerCard) return;
  for (const el of ligneDrawerCard.querySelectorAll('[data-ld-key]')) {
    const cle = el.dataset.ldKey;
    if (cle in ldSaisieEnCours) el.value = ldSaisieEnCours[cle];
  }
}

// Vrai si ce contrôle porte une valeur différente de celle qui a été rendue.
const ldModifie = (el) => !!el && String(el.value) !== (ldValeursRendues[el.dataset.ldKey] ?? '');

// Puce cliquable du tiroir : `render` réécrit libellé + classe depuis `r`,
// `open` ouvre le menu (ou le popover) au clic.
function ldChip(render, open) {
  const btn = document.createElement('button');
  btn.type = 'button';
  render(btn);
  btn.addEventListener('click', (e) => { e.stopPropagation(); open(btn); });
  return btn;
}

function stageDestinationLabel(stage, sub) {
  const family = STAGE_LABEL[stage] || stage;
  if (sub && SUB_LABEL[sub]) return `${family} › ${SUB_LABEL[sub]}`;
  return familyHasSub(stage) ? `${family} › à préciser` : family;
}

// Un article du détail produit : un titre, puis ses sous-lignes (les valeurs
// vides sont ignorées, pour ne jamais afficher de ligne creuse).
function ficheLigneEl(titre, sousLignes) {
  const box = document.createElement('div');
  box.className = 'ld-fiche-item';
  const t = document.createElement('p');
  t.className = 'ld-fiche-item__title';
  t.textContent = titre;
  box.appendChild(t);
  for (const s of sousLignes) {
    if (!s) continue;
    const p = document.createElement('p');
    p.className = 'ld-fiche-item__sub';
    p.textContent = s;
    box.appendChild(p);
  }
  return box;
}

// Flux « Commande » (tasses / textiles / objets), fiche.kind = 'commande-atelier'.
// Mêmes champs que detailLigne() côté serveur (server.js:1115-1153), rendus en
// HTML structuré plutôt qu'en texte à flèches « ↳ ».
function ficheItemsCommandeAtelier(fiche) {
  const items = [];
  for (const l of fiche.tasses || []) {
    items.push(ficheLigneEl(
      `${l.quantite} × ${l.ref}${l.couleur ? ` — ${l.couleur}` : ''}`,
      [
        ...(l.faces || []).map((f) => `${f.label} (${f.hint}) : ${f.visuel}`),
        (l.options || []).length ? l.options.map((o) => o.label).join(' · ') : null,
        l.typo ? `Typo : ${l.typo}` : null,
        l.infos || null,
        l.remarque ? `Remarque : ${l.remarque}` : null,
      ],
    ));
  }
  for (const l of fiche.textiles || []) {
    const tailleTxt = (l.tailles && l.tailles.length)
      ? l.tailles.map((t) => `${t.taille}×${t.quantite}`).join(' · ')
      : (l.taille ? `taille ${l.taille}` : '');
    const id = [l.ref && `réf. ${l.ref}`, l.couleur, tailleTxt].filter(Boolean).join(' · ');
    items.push(ficheLigneEl(
      `${l.quantite} × ${l.vetement}${id ? ` — ${id}` : ''}`,
      [
        l.note || null,
        ...(l.zones || []).map((z) => {
          const tech = z.technique === 'a_definir' ? '' : ` [${z.techniqueLabel}]`;
          const detail = [z.logo, z.couleur, z.largeur ? `${z.largeur} cm` : null]
            .filter(Boolean).join(' · ') || z.consigne || '';
          return `${z.zoneLabel}${tech}${detail ? ` : ${detail}` : ''}`;
        }),
      ],
    ));
  }
  for (const l of fiche.objets || []) {
    items.push(ficheLigneEl(
      `${l.quantite} × ${l.ref}`,
      [l.techniqueLabel ? `${l.techniqueLabel}${l.infos ? ` : ${l.infos}` : ''}` : (l.infos || null)],
    ));
  }
  return items;
}

// Flux « Nouveau Projet » (panier multi-type), fiche.kind = 'projet-simple'.
// `l.bat` est l'option catalogue tarifée (server.js buildLigneTasse) — à NE PAS
// confondre avec la pièce jointe BAT (documents) : badge texte distinct.
// Depuis la v4, chaque famille porte sa fiche de production : on rend ce que
// l'atelier doit lire pour produire, pas seulement le nom du produit.
function ficheItemsProjetSimple(fiche) {
  return (fiche.lignes || []).map((l) => {
    const prix = l.prixUnitaireTtc != null
      ? `${Number(l.prixUnitaireTtc).toFixed(2)} € TTC / unité`
      : null;
    if (l.produit) {
      const opts = [l.face1, l.face2, l.dessous].filter((o) => o && o.label !== 'Aucune').map((o) => o.label);
      return ficheLigneEl(
        `${l.quantite} × ${l.produit.label}${l.coloris ? ` (${l.coloris})` : ''}`,
        [
          opts.length ? opts.join(', ') : null,
          l.face1Texte ? `Face 01 (anse à droite) : ${l.face1Texte}` : null,
          l.face2Texte ? `Face 02 (anse à gauche) : ${l.face2Texte}` : null,
          l.dessousTexte ? `Dessous : ${l.dessousTexte}` : null,
          l.typo ? `Typo : ${l.typo}` : null,
          l.remarque ? `Remarque : ${l.remarque}` : null,
          l.bat ? '★ BAT à confirmer avant production' : null,
          prix,
        ],
      );
    }
    // Depuis la v4, `description` est un résumé complet qui commence par la
    // quantité (« 10 × Polo — réf. … ») ; avant, elle ne portait que le texte
    // libre saisi, qu'il fallait préfixer. `designation` distingue les deux.
    const titre = l.designation ? l.description : `${l.quantite} × ${l.description}`;
    // Textile : les faces marquées, une sous-ligne chacune. Le titre porte déjà
    // référence, couleur et grille de tailles.
    if (l.faces || l.tailles) {
      return ficheLigneEl(titre, [
        ...(l.faces || []).map((f) => [
          f.faceLabel, f.emplacement && f.emplacement.label,
          // `technique` n'existe pas sur les fiches archivées avant sa mise en
          // place : la sous-ligne se contente alors de ce qu'elle a.
          f.technique && f.technique.label,
          f.typeLogo && f.typeLogo.label, f.referenceLogo, f.couleurMarquage,
        ].filter(Boolean).join(' · ')),
        l.remarque ? `Remarque : ${l.remarque}` : null,
        prix,
      ]);
    }
    // Autres / Plaque signalétique. `categorie` vient de la demande de devis :
    // le client demande une famille (Textile, Goodies…) bien avant qu'un article
    // du catalogue soit choisi. Le titre porte déjà référence et couleur.
    return ficheLigneEl(titre, [
      l.categorie ? `Catégorie : ${l.categorie}` : null,
      l.explication || null,
      l.matiere ? `Matière : ${l.matiere}` : null,
      l.format ? `Format : ${l.format}` : null,
      l.methode ? `Production : ${l.methode}` : null,
      // Une demande de devis n'a pas encore de prix : c'est précisément ce
      // qu'on doit chiffrer. On le DIT, plutôt que de ne rien afficher.
      prix || (fiche.orderKind === 'demande' ? 'Prix : à chiffrer' : null),
    ]);
  });
}

// Flux « Nouveau Projet » du comptoir (public/comptoir/*.html), fiche.kind =
// 'comptoir-v17'. Le parcours a déjà mis son dossier en forme pour le ticket :
// des paires libellé / valeur, dans l'ordre où la vendeuse les a saisies. On les
// rend TELLES QUELLES — deux blocs, le client puis le dossier. Réinterpréter
// serait une occasion de perdre une ligne à chaque nouvelle version de l'écran.
function ficheItemsComptoir(fiche) {
  const bloc = (titre, lignes) => (lignes && lignes.length
    ? [ficheLigneEl(titre, lignes.map((l) => `${l.k} : ${l.v}`))]
    : []);
  return [
    ...bloc('Client', fiche.client),
    ...bloc(fiche.source === 'Demande de devis' ? 'Demande' : 'Vente', fiche.details),
  ];
}

// Détail produit : reconstruit un affichage lisible depuis `r.fiche` (le JSON
// archivé à la création de la commande, jamais retouché après). Trois formats
// possibles selon le flux de création — cf. server.js buildCommande/buildProjet
// et POST /api/comptoir/projet.
// Retourne `null` si `fiche` est absent ou d'un `kind` non reconnu (ligne créée
// à la main dans la grille) ; une fiche de commande v1, qui porte bien le
// `kind` mais pas les tableaux attendus, renvoie `[]`. Dans les deux cas
// l'appelant masque la section, sans erreur.
function ficheItems(fiche) {
  if (!fiche || typeof fiche !== 'object') return null;
  if (fiche.kind === 'commande-atelier') return ficheItemsCommandeAtelier(fiche);
  if (fiche.kind === 'projet-simple') return ficheItemsProjetSimple(fiche);
  if (fiche.kind === 'comptoir-v17') return ficheItemsComptoir(fiche);
  return null;
}

// --- La fiche projet : ce que l'écran du patron appelle « la bulle » ---------

function ldActionBtn(icone, label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ld-act';
  const i = document.createElement('span');
  i.className = 'material-symbols-outlined';
  i.setAttribute('aria-hidden', 'true');
  i.textContent = icone;
  const t = document.createElement('span');
  t.className = 'ld-act-label';
  t.textContent = label;
  b.append(i, t);
  b.setAttribute('aria-label', label);
  // Le bouton lui-même est passé au gestionnaire : les actions qui CRÉENT
  // quelque chose (dupliquer, envoyer vers) doivent pouvoir se désarmer le temps
  // que la création parte, sinon un appui appuyé au doigt fait deux copies.
  b.addEventListener('click', (e) => onClick(b, e));
  return b;
}

// Même règle de rapprochement que le serveur (clientKey) : insensible à la
// casse, aux accents et à la ponctuation. « Coco Beach » et « coco-beach »
// sont LE MÊME client.
const clientKeyLocal = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Une échéance en français sur un document destiné à un humain. `deadline` est
// une chaîne « aaaa-mm-jj », mais une base de test la rend en ISO complet : on
// coupe avant de découper, plutôt que de dater le récapitulatif en anglais.
function dateFr(iso) {
  const m = String(iso || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

// Le récapitulatif en TEXTE, tel qu'il s'imprime et se télécharge. Reconstruit
// à la demande depuis la ligne ET sa fiche : il porte donc les corrections
// faites depuis, pas l'état du jour de la prise.
function recapTexte(r) {
  const f = r.fiche && typeof r.fiche === 'object' ? r.fiche : {};
  const lignes = [
    'ATELIER OLDA — RÉCAPITULATIF PROJET',
    '',
    f.ref ? `Référence : ${f.ref}` : null,
    f.source ? `Origine : ${f.source}` : null,
    `Client : ${r.billing_company || '—'}`,
    `Projet : ${r.product || '—'}`,
    `Étape : ${stageDestinationLabel(r.stage, r.sub_stage ?? null)}`,
    `Responsable : ${r.responsable || 'À attribuer'}`,
    r.referent ? `Référent : ${r.referent}` : null,
    `Date souhaitée : ${dateFr(r.deadline)}${f.heureSouhaitee ? ` à ${f.heureSouhaitee.replace(':', 'h')}` : ''}`,
    // Une demande n'a pas de prix : on le DIT, on n'écrit pas « 0,00 € ».
    `Prix TTC : ${r.project_value == null ? 'à chiffrer' : eur(Number(r.project_value))}`,
    f.production ? `Production : ${f.production}` : null,
  ].filter(Boolean);

  const bloc = (titre, liste) => {
    if (!Array.isArray(liste) || !liste.length) return;
    lignes.push('', titre.toUpperCase());
    for (const l of liste) lignes.push(`${l.k} : ${l.v}`);
  };
  bloc('Client', f.client);
  bloc(f.source === 'Demande de devis' ? 'Demande' : 'Vente', f.details);
  return lignes.join('\n');
}

async function telechargerRecap(r) {
  // Le récapitulatif se compose depuis la fiche COMPLÈTE : si elle n'est pas
  // encore arrivée, on l'attend plutôt que d'écrire un fichier amputé.
  await chargerFicheComplete(r.id).then(() => completerFiche(r)).catch(() => {});
  const nom = `Recap_${(r.fiche && r.fiche.ref) || r.billing_company || 'projet'}`.replace(/[^\w.-]+/g, '_');
  // Le BOM en tête : sans lui, Excel et le Bloc-notes de Windows affichent les
  // accents en charabia — et ce fichier finit souvent sur un poste Windows.
  const blob = new Blob([`﻿${recapTexte(r).replace(/\n/g, '\r\n')}`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nom}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Récapitulatif téléchargé');
}

// Impression : on n'imprime PAS l'application (la grille, le rail et la fiche
// telle qu'elle est à l'écran donneraient une feuille illisible). On compose
// une page propre dans un cadre hors écran, on l'imprime, on le retire. Un
// cadre plutôt qu'une fenêtre : aucun bloqueur de pop-up ne peut l'empêcher.
async function imprimerRecap(r) {
  // Même raison qu'au téléchargement : on n'imprime pas un récapitulatif dont
  // le détail n'est pas encore arrivé.
  await chargerFicheComplete(r.id).then(() => completerFiche(r)).catch(() => {});
  const cadre = document.createElement('iframe');
  cadre.setAttribute('aria-hidden', 'true');
  cadre.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;height:1000px;border:0';
  document.body.appendChild(cadre);
  const d = cadre.contentDocument;
  d.title = `${r.billing_company || 'Projet'} — ${r.product || ''}`.trim();
  const style = d.createElement('style');
  style.textContent = 'body{font:13px/1.55 Arial,Helvetica,sans-serif;margin:28px;color:#111}'
    + 'pre{white-space:pre-wrap;font:inherit;margin:0}';
  d.head.appendChild(style);
  const pre = d.createElement('pre');
  pre.textContent = recapTexte(r);
  d.body.appendChild(pre);
  cadre.contentWindow.focus();
  cadre.contentWindow.print();
  setTimeout(() => cadre.remove(), 1000);
}

// DÉTAIL COMPLET, MODIFIABLE. Le récapitulatif du comptoir, ligne à ligne :
// libellé figé (il vient du parcours), valeur éditable. On n'enregistre qu'au
// bouton — corriger dix lignes ne doit pas faire dix allers-retours réseau, et
// tant qu'on n'a pas validé, rien n'a bougé en base.
function ldBlocDetail(r) {
  const f = r.fiche;
  const groupes = [
    { cle: 'client', titre: 'Client', lignes: Array.isArray(f.client) ? f.client : [] },
    {
      cle: 'details',
      titre: f.source === 'Demande de devis' ? 'Demande' : 'Vente',
      lignes: Array.isArray(f.details) ? f.details : [],
    },
  ].filter((g) => g.lignes.length);
  if (!groupes.length) return null;

  const total = groupes.reduce((n, g) => n + g.lignes.length, 0);
  const section = ldVolet(
    'Détail complet de la demande enregistrée',
    `${total} ligne${total > 1 ? 's' : ''} — tout est modifiable`,
    null, true,
  );
  const champs = { client: [], details: [] };

  for (const g of groupes) {
    if (groupes.length > 1) {
      const st = document.createElement('p');
      st.className = 'ld-fiche-item__title';
      st.style.margin = '10px 0 4px';
      st.textContent = g.titre;
      section.appendChild(st);
    }
    for (const l of g.lignes) {
      const ligne = document.createElement('div');
      ligne.className = 'ld-detail-line';
      const k = document.createElement('span');
      k.textContent = l.k;
      // Une valeur longue ou sur plusieurs lignes mérite une zone de texte :
      // une description de production ne se relit pas dans un champ d'une ligne.
      const longue = String(l.v || '').length > 60 || String(l.v || '').includes('\n');
      const champ = document.createElement(longue ? 'textarea' : 'input');
      champ.className = 'ld-detail-input';
      if (longue) champ.rows = 3;
      champ.value = l.v == null ? '' : l.v;
      champ.setAttribute('aria-label', l.k);
      ldSuivi(`detail:${g.cle}:${champs[g.cle].length}`, champ, l.v);
      champs[g.cle].push(champ);
      ligne.append(k, champ);
      section.appendChild(ligne);
    }
  }

  // Pas de bouton ici : le détail s'enregistre avec le reste de la fiche, par
  // le bouton du bas. Un seul geste pour l'employé.
  return { box: section, champs };
}

// HISTORIQUE DU CLIENT : les autres commandes du même dossier. « On a déjà fait
// quoi pour eux ? » est la question qu'on pose au téléphone, et la réponse doit
// être sous les yeux, pas à chercher dans la grille.
function ldBlocHistoriqueClient(r) {
  const cle = clientKeyLocal(r.billing_company);
  if (!cle) return null;
  const autres = rows
    .filter((x) => String(x.id) !== String(r.id) && clientKeyLocal(x.billing_company) === cle)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const section = ldBox(`Historique du client (${autres.length})`, null, true);
  if (!autres.length) {
    const p = document.createElement('p');
    p.className = 'ld-empty';
    // La grille ne porte que l'étape affichée : on ne prétend pas connaître
    // tout l'historique du client, on dit ce qu'on voit.
    p.textContent = 'Aucune autre commande de ce client à cette étape.';
    section.appendChild(p);
    return section;
  }
  for (const x of autres) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ld-hist';
    const main = document.createElement('span');
    main.className = 'ld-hist__main';
    const t = document.createElement('span');
    t.className = 'ld-hist__title';
    t.textContent = x.product || 'Sans description';
    const s = document.createElement('span');
    s.className = 'ld-hist__sub';
    s.textContent = stageDestinationLabel(x.stage, x.sub_stage ?? null);
    main.append(t, s);
    const v = document.createElement('span');
    v.className = 'ld-hist__value';
    v.textContent = x.project_value == null ? 'à chiffrer' : eur(Number(x.project_value));
    b.append(main, v);
    b.addEventListener('click', () => openLigneDetail(x.id));
    section.appendChild(b);
  }
  return section;
}

// ===========================================================================
// LA FICHE PROJET — « la bulle », telle que l'écran du patron la dessine
// ===========================================================================
// Une carte du planning ne dit que l'essentiel ; la fiche dit TOUT, et tout y
// est modifiable. Elle se lit en encadrés à deux colonnes : chaque encadré
// porte un libellé en capitales et son contenu.
//
// La fiche suit le modèle « je corrige, puis j'enregistre » : les champs se
// tapent librement et rien ne part avant le bouton du bas. C'est la règle de
// l'écran validé, et elle vaut mieux ici qu'une sauvegarde à chaque frappe —
// on relit une fiche entière avant de la valider.

function ldBox(label, contenu, pleine) {
  const box = document.createElement('section');
  box.className = 'ld-box' + (pleine ? ' ld-box--full' : '');
  const k = document.createElement('p');
  k.className = 'ld-k';
  k.textContent = label;
  box.append(k);
  for (const c of [].concat(contenu)) if (c) box.append(c);
  return box;
}

// UN VOLET : tout ce qui se MODIFIE est replié par défaut.
// La fiche s'ouvre donc en lecture — on la parcourt d'un coup d'œil sans risquer
// de retoucher un champ au passage. Le volet fermé montre le libellé ET la
// valeur du moment : on lit sans ouvrir, on n'ouvre que pour changer.
// `<details>` natif : ça marche au clavier, ça s'imprime déplié si besoin, et
// aucun script ne pilote l'ouverture.
function ldVolet(label, apercu, contenu, pleine) {
  const volet = document.createElement('details');
  volet.className = 'ld-box ld-volet' + (pleine ? ' ld-box--full' : '');
  const tete = document.createElement('summary');
  tete.className = 'ld-volet__tete';
  const textes = document.createElement('span');
  textes.className = 'ld-volet__textes';
  const k = document.createElement('span');
  k.className = 'ld-k';
  k.textContent = label;
  const v = document.createElement('span');
  v.className = 'ld-volet__apercu';
  v.textContent = apercu == null || apercu === '' ? '—' : String(apercu);
  textes.append(k, v);
  const chevron = document.createElement('span');
  chevron.className = 'material-symbols-outlined ld-volet__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = 'expand_more';
  tete.append(textes, chevron);
  volet.append(tete);
  for (const c of [].concat(contenu)) if (c) volet.append(c);
  return volet;
}

// Valeur en lecture seule (étape courante, échéance calculée…).
function ldValeur(texte) {
  const p = document.createElement('p');
  p.className = 'ld-v';
  p.textContent = texte;
  return p;
}

function ldChamp(valeur, opts = {}) {
  const el = document.createElement(opts.multi ? 'textarea' : 'input');
  el.className = 'ld-ctl';
  if (opts.multi) el.rows = opts.rows || 3;
  else el.type = opts.type || 'text';
  if (opts.inputMode) el.inputMode = opts.inputMode;
  if (opts.step) el.step = opts.step;
  if (opts.placeholder) el.placeholder = opts.placeholder;
  el.value = valeur == null ? '' : valeur;
  if (opts.label) el.setAttribute('aria-label', opts.label);
  return el;
}

function ldSelect(options, valeur, label) {
  const s = document.createElement('select');
  s.className = 'ld-ctl';
  if (label) s.setAttribute('aria-label', label);
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (String(o.value) === String(valeur)) opt.selected = true;
    s.append(opt);
  }
  return s;
}

// Toutes les places possibles du pipeline, « Famille › Sous-étape ». Une
// famille sans sous-étape est une destination à elle seule.
//
// « Famille › à préciser » n'est PAS proposée : le glisser-déposer la refuse
// déjà (« Dépose la ligne sur une sous-catégorie, pas sur le titre »), et une
// commande qui atterrit là n'apparaît sous AUCUNE entrée du rail — on ne la
// retrouve qu'en cliquant le grand titre. La fiche ne doit pas être la porte
// dérobée d'un état qu'on a fermé partout ailleurs.
// Seule exception : la place ACTUELLE de la commande. Une ligne déjà « à
// préciser » doit retrouver sa valeur dans la liste, sinon le sélecteur
// afficherait la première option et l'enregistrement la déplacerait toute seule.
function placesDuPipeline(placeActuelle) {
  const places = [];
  for (const f of STAGES) {
    const subs = SUB_STAGES[f.slug] || [];
    if (!subs.length) { places.push({ value: `${f.slug}|`, label: f.label }); continue; }
    if (placeActuelle === `${f.slug}|`) {
      places.push({ value: `${f.slug}|`, label: `${f.label} › à préciser` });
    }
    for (const s of subs) places.push({ value: `${f.slug}|${s.slug}`, label: `${f.label} › ${s.label}` });
  }
  return places;
}

function renderLigneDetail() {
  const r = completerFiche(rows.find((x) => String(x.id) === ligneDrawerId));
  if (!r) { closeLigneDetail(); return; }
  // Ce que l'employé a tapé sans l'enregistrer doit traverser la reconstruction.
  ldCapturerSaisie();
  ldValeursRendues = {};
  // `.ld-body` est le conteneur qui défile, et replaceChildren() le détruit :
  // on relève sa position pour la reposer sur le corps reconstruit, sinon la
  // fiche remonte en haut à chaque enregistrement alors qu'on travaillait tout
  // en bas. Le navigateur borne lui-même la valeur au défilement réellement
  // disponible, donc un contenu plus court retombe naturellement.
  const oldBody = ligneDrawerCard.querySelector('.ld-body');
  const prevScrollTop = oldBody ? oldBody.scrollTop : 0;
  ligneDrawerCard.replaceChildren();

  const fiche = r.fiche && typeof r.fiche === 'object' ? r.fiche : {};
  const delai = tempsRestant(r.deadline, fiche.heureSouhaitee);

  // --- En-tête ---------------------------------------------------------------
  const head = document.createElement('header');
  head.className = 'ld-head';

  const titles = document.createElement('div');
  titles.className = 'ld-head__titles';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'ld-eyebrow';
  eyebrow.textContent = [fiche.ref, fiche.source].filter(Boolean).join(' • ')
    || stageDestinationLabel(r.stage, r.sub_stage ?? null);
  const titre = document.createElement('h2');
  titre.className = 'ld-title';
  titre.textContent = [r.billing_company || 'Sans nom', r.product].filter(Boolean).join(' — ');
  titles.append(eyebrow, titre);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ld-close';
  close.setAttribute('aria-label', 'Fermer la fiche');
  close.appendChild(strokeIcon(['M18 6L6 18', 'M6 6l12 12']));
  close.addEventListener('click', closeLigneDetail);

  const actions = document.createElement('div');
  actions.className = 'ld-head__actions';
  // Dupliquer et « Envoyer vers Fiverr » n'existaient que dans le tableau
  // complet : depuis les cartes (la vue par défaut), il n'y avait aucun moyen de
  // recopier une commande. Ils rejoignent la fiche, où l'on ouvre la ligne.
  const dupliquer = ldActionBtn('content_copy', 'Dupliquer', (b) => {
    if (!armerUneFois(b)) return;
    duplicateRow(r);
    showToast('Commande dupliquée');
  });
  actions.append(dupliquer);
  for (const t of SEND_TARGETS) {
    if (t.slug === r.stage) continue; // déjà dans cette catégorie
    actions.append(ldActionBtn('send', `Vers ${t.label}`, (b) => {
      if (armerUneFois(b)) copyToStage(r, t.slug);
    }));
  }
  actions.append(
    ldActionBtn('print', 'Imprimer', () => imprimerRecap(r)),
    ldActionBtn('download', 'Télécharger', () => telechargerRecap(r)),
    close,
  );
  head.append(titles, actions);
  ligneDrawerCard.appendChild(head);

  // --- Corps ------------------------------------------------------------------
  const body = document.createElement('div');
  body.className = 'ld-body';

  const cClient = ldSuivi('client', ldChamp(r.billing_company, { label: 'Client' }), r.billing_company);
  const cProjet = ldSuivi('projet', ldChamp(r.product, { label: 'Projet' }), r.product);
  const cPriorite = ldSuivi('priorite', ldSelect(
    [3, 2, 1].map((i) => ({ value: i, label: PRIORITY_LEVELS[i].label })),
    prioBand(r), 'Priorité',
  ), prioBand(r));
  const dateIso = String(r.deadline || '').slice(0, 10);
  const cDate = ldSuivi('date', ldChamp(dateIso, { type: 'date', label: 'Date de remise' }), dateIso);
  // Pas de 14:00 pré-rempli : ouvrir puis enregistrer une fiche gravait alors
  // une heure de remise que le client n'avait jamais demandée, et la carte
  // l'annonçait ensuite comme une promesse (« Remise client : … à 14h00 »).
  // Le calcul du délai, lui, prend déjà 14 h par défaut de son côté.
  const cHeure = ldSuivi('heure',
    ldChamp(fiche.heureSouhaitee || '', { type: 'time', label: 'Heure de remise' }),
    fiche.heureSouhaitee || '');
  const cPrix = ldSuivi('prix', ldChamp(r.project_value == null ? '' : r.project_value, {
    type: 'number', step: '0.01', inputMode: 'decimal',
    placeholder: 'à chiffrer', label: 'Valeur TTC',
  }), r.project_value == null ? '' : r.project_value);
  const cProduction = ldSuivi('production',
    ldChamp(fiche.production, { placeholder: 'À définir', label: 'Production' }), fiche.production);
  const cInfos = ldSuivi('infos',
    ldChamp(r.description, { multi: true, rows: 3, label: 'Informations / commentaire' }), r.description);
  // Téléphone et e-mail ne vivaient que dans un popover du tableau complet :
  // depuis les cartes, on ne pouvait ni les lire, ni les corriger, ni prévenir
  // le client. Ils rejoignent la fiche, avec la pastille WhatsApp.
  const cTel = ldSuivi('tel',
    ldChamp(r.contact_phone, { type: 'tel', inputMode: 'tel', placeholder: 'téléphone', label: 'Téléphone' }),
    r.contact_phone);
  const cEmail = ldSuivi('email',
    ldChamp(r.contact_email, { type: 'email', inputMode: 'email', placeholder: 'e-mail', label: 'E-mail' }),
    r.contact_email);

  const remise = document.createElement('div');
  remise.className = 'ld-duo';
  remise.append(cDate, cHeure);

  const contact = document.createElement('div');
  contact.className = 'ld-duo';
  contact.append(cTel, cEmail);
  const contactBloc = document.createElement('div');
  contactBloc.append(contact, cellWhatsapp(r));

  // Les champs de tête restent SOUS LES YEUX, comme sur l'écran du patron : ce
  // sont ceux qu'on corrige au téléphone, avec le client en ligne. Seuls les
  // deux longs pavés du bas se replient (voir plus loin).
  body.append(
    ldBox('Client', cClient),
    ldBox('Type de client', typeControl(r)),
    ldBox('Contact', contactBloc),
    ldBox('Projet', cProjet),
    ldBox('Étape actuelle', ldValeur(stageDestinationLabel(r.stage, r.sub_stage ?? null))),
    // L'ALERTE, ENFIN ACCESSIBLE. Sur les cartes on lisait « Bloquée » sans
    // pouvoir savoir pourquoi ni y remédier : le contrôle n'existait que dans le
    // tableau complet, qui est éteint par défaut. Il est ici, avec son motif.
    ldBox('État', flagControl(r, null)),
    ldBox('Qui suit', respControl(r)),
    ldBox('Priorité', cPriorite),
    ldBox('Remise au client', remise),
    ldBox('À terminer avant', ldValeur(`${delai.echeanceTexte} — ${delai.texte} restant`)),
    ldBox('Valeur TTC', cPrix),
    ldBox('Production', cProduction),
    ldBox('Informations / commentaire', cInfos, true),
  );

  // --- Documents et paiement : deux encadrés en plus de l'écran du patron -----
  // Les pièces jointes (devis, facture, BAT) et le suivi du paiement n'existent
  // que dans le CRM. Les retirer pour « coller à la maquette » ferait perdre
  // des fonctions dont l'atelier se sert : ils prennent leur place ici.
  const docs = document.createElement('div');
  docs.className = 'ld-docs';
  docs.append(cellPdfSlot(r, 'devis'), cellPdfSlot(r, 'facture'), cellPdfSlot(r, 'bat'));
  body.append(ldBox('Documents', docs, true));

  const paiement = document.createElement('div');
  paiement.className = 'ld-pay';
  const bascule = (champ, libelle) => ldChip(
    (b) => {
      const on = r[champ] === true;
      b.className = `ld-toggle${on ? ' is-on' : ''}`;
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', String(on));
      b.textContent = on ? 'Oui' : (r[champ] === false ? 'Non' : '—');
      attachTip(b, on ? `retirer « ${libelle} »` : `marquer « ${libelle} »`);
    },
    () => ldPatch(r, { [champ]: r[champ] !== true }),
  );
  paiement.append(
    ldRow('Acompte demandé', bascule('acompte_demande', 'acompte demandé')),
    ldRow('Acompte versé', bascule('acompte_verse', 'acompte versé')),
    ldRow('Payé / soldé', bascule('paye', 'payé')),
  );
  const modeChip = ldChip(
    (b) => {
      const m = PAIEMENT_MODES.find((x) => x.id === r.paiement_mode);
      b.className = 'sub-chip' + (m ? '' : ' empty');
      b.textContent = m ? m.label : '+ mode';
      attachTip(b, 'mode de paiement');
    },
    (b) => {
      const items = PAIEMENT_MODES.map((m) => ({ value: m.id, label: m.label }));
      items.push({ value: null, label: 'Non précisé', muted: true });
      openMenu(b, items, r.paiement_mode ?? null, (val) => {
        if ((val ?? null) === (r.paiement_mode ?? null)) return;
        ldPatch(r, { paiement_mode: val });
      });
    },
  );
  paiement.append(ldRow('Mode', modeChip));
  body.append(ldBox('Paiement', paiement, true));

  // --- Historique (replié) ------------------------------------------------------
  // L'application ne tient pas de journal des modifications : on affiche ce
  // qu'on sait vraiment, la naissance de la ligne et sa dernière retouche,
  // plutôt qu'un historique inventé.
  // Replié comme le détail complet : c'est un pavé qu'on consulte de temps en
  // temps, pas une information de travail. Déplié en permanence, il repousserait
  // les champs qu'on corrige vraiment hors de l'écran.
  const histoLignes = [
    fiche.creeLe || r.created_at ? `Créée le ${horodatageFr(fiche.creeLe || r.created_at)}${fiche.source ? ` depuis ${fiche.source}` : ''}` : null,
    r.updated_at ? `Dernière modification le ${horodatageFr(r.updated_at)}` : null,
  ].filter(Boolean);
  const histoBox = document.createElement('div');
  histoBox.className = 'ld-journal';
  histoBox.append(...histoLignes.map(ldValeur));
  // Le journal des modifications (étape, état, prix, échéance…) arrive du
  // serveur : on annonce l'attente plutôt que d'afficher un vide qui se lirait
  // comme « rien n'a jamais bougé ».
  const journalEl = document.createElement('div');
  journalEl.className = 'ld-journal__liste';
  journalEl.appendChild(ldValeur('Chargement du journal…'));
  histoBox.appendChild(journalEl);
  body.append(ldVolet('Historique', histoLignes[0] || '—', [histoBox], true));
  chargerJournal(r.id, journalEl);

  // --- Détail complet, modifiable, replié ---------------------------------------
  // Le récapitulatif du comptoir fait des dizaines de lignes : déplié, il pousse
  // tout le reste de la fiche hors de l'écran. On l'ouvre quand on en a besoin.
  let champsDetail = null;
  if (fiche.fichePartielle) {
    // Le détail arrive dans un instant (voir openLigneDetail) : on l'annonce
    // plutôt que d'afficher « non enregistré », qui serait faux.
    body.append(ldVolet('Détail complet', 'Chargement…', ldValeur('Un instant…'), true));
  } else if (fiche.kind === 'comptoir-v17') {
    const bloc = ldBlocDetail(r);
    if (bloc) { champsDetail = bloc.champs; body.append(bloc.box); }
  } else {
    const items = ficheItems(r.fiche);
    body.append(ldVolet(
      'Détail complet',
      items && items.length ? `${items.length} article${items.length > 1 ? 's' : ''}` : 'Non enregistré',
      items && items.length ? items : ldValeur('Cette commande a été créée avant l’enregistrement du détail complet.'),
      true,
    ));
  }

  // --- Historique du client -----------------------------------------------------
  const histoClient = ldBlocHistoriqueClient(r);
  if (histoClient) body.append(histoClient);

  ligneDrawerCard.appendChild(body);

  // --- Pied : où va la ligne, qui la suit, et on enregistre --------------------
  const pied = document.createElement('footer');
  pied.className = 'ld-foot';
  const placeActuelle = `${r.stage}|${r.sub_stage || ''}`;
  const cPlace = ldSuivi('place',
    ldSelect(placesDuPipeline(placeActuelle), placeActuelle, 'Étape de la commande'), placeActuelle);
  const cReferent = ldSuivi('referent', ldSelect(
    [{ value: '', label: 'Référent : personne' }, ...EMPLOYEES.map((n) => ({ value: n, label: `Référent : ${n}` }))],
    r.referent || '', 'Référent',
  ), r.referent || '');
  const enregistrer = document.createElement('button');
  enregistrer.type = 'button';
  enregistrer.className = 'ld-save';
  enregistrer.textContent = 'Enregistrer les modifications';
  const note = ldChamp('', {
    multi: true, rows: 2,
    placeholder: 'Ajouter une note de production, une information client ou un point de contrôle…',
    label: 'Ajouter une note',
  });
  note.className += ' ld-note';
  ldSuivi('note', note, '');

  enregistrer.addEventListener('click', async () => {
    enregistrer.disabled = true;
    const ancien = enregistrer.textContent;
    enregistrer.textContent = 'Enregistrement…';
    try {
      const modifie = await enregistrerFiche(r, {
        cClient, cProjet, cPriorite, cDate, cHeure, cPrix, cProduction, cInfos,
        cTel, cEmail, cPlace, cReferent, note, champsDetail,
      });
      showToast(modifie ? 'Fiche enregistrée' : 'Rien à enregistrer — aucune modification');
      ldRefresh(r);
    } catch (err) {
      reportError(err);
    } finally {
      enregistrer.disabled = false;
      enregistrer.textContent = ancien;
    }
  });

  const barre = document.createElement('div');
  barre.className = 'ld-foot__row';
  barre.append(cPlace, cReferent, enregistrer);
  pied.append(barre, note);
  ligneDrawerCard.appendChild(pied);

  // Les corrections tapées et pas encore enregistrées reviennent par-dessus les
  // valeurs fraîchement rendues : une reconstruction ne fait plus perdre la
  // saisie en cours.
  ldAppliquerSaisie();

  body.scrollTop = prevScrollTop;
}

// Libellés du journal (miroir de JOURNAL_FIELDS côté serveur) et mise en mots
// des valeurs brutes : « production » ne veut rien dire dans une fiche, « Étape :
// Préparation du projet » si.
const JOURNAL_LABELS = {
  stage: 'Étape', sub_stage: 'Sous-étape', flag: 'État', flag_reason: 'Motif',
  priority: 'Priorité', project_value: 'Prix TTC', deadline: 'Date souhaitée',
  responsable: 'Pilote', referent: 'Référent', paye: 'Payé',
};

function journalValeur(field, brut) {
  if (brut == null || brut === '') return '—';
  if (field === 'stage') return STAGE_LABEL[brut] || brut;
  if (field === 'sub_stage') return SUB_LABEL[brut] || brut;
  if (field === 'flag') return FLAG_BY_VALUE[brut] ? FLAG_BY_VALUE[brut].label : brut;
  if (field === 'priority') return PRIORITY_LEVELS[brut] ? PRIORITY_LEVELS[brut].label : brut;
  // Même écriture que sur les cartes (centimes toujours affichés) : « 99,5 € »
  // dans un journal de prix se lit comme une valeur tronquée.
  if (field === 'project_value') {
    const n = Number(brut);
    return Number.isFinite(n) ? eur(n) : String(brut);
  }
  if (field === 'deadline') return dateFr(brut);
  if (field === 'paye') return brut === 'true' ? 'oui' : 'non';
  return String(brut);
}

// Va chercher ce qui a changé sur cette commande et l'écrit dans l'Historique.
// Ce que l'application NE SAIT PAS, c'est QUI : elle n'a qu'un mot de passe
// commun à tout l'atelier. On l'écrit noir sur blanc plutôt que de laisser
// croire à un oubli.
async function chargerJournal(id, hote) {
  let lignes = [];
  try {
    lignes = await api('GET', `/api/requests/${id}/journal`);
  } catch (_) {
    hote.replaceChildren(ldValeur('Journal indisponible — vérifie la connexion.'));
    return;
  }
  if (!hote.isConnected) return;
  if (!Array.isArray(lignes) || !lignes.length) {
    hote.replaceChildren(ldValeur('Aucune modification enregistrée depuis la mise en service du journal.'));
    return;
  }
  const items = lignes.map((l) => ldValeur(
    `${horodatageFr(l.created_at)} — ${JOURNAL_LABELS[l.field] || l.field} : `
    + `${journalValeur(l.field, l.value_before)} → ${journalValeur(l.field, l.value_after)}`,
  ));
  const note = ldValeur('L’application n’a qu’un mot de passe commun : elle enregistre ce qui a changé, pas qui l’a fait.');
  note.className += ' ld-journal__note';
  hote.replaceChildren(...items, note);
}

const horodatageFr = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR');
};

// Applique en une fois tout ce que la fiche a modifié : les colonnes de la
// ligne, la place dans le pipeline, le détail du comptoir, et la note ajoutée.
// Un seul geste pour l'employé, un aller-retour par nature de donnée.
async function enregistrerFiche(r, c) {
  const nombre = (v) => {
    const t = String(v == null ? '' : v).trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const texte = (v) => {
    const t = String(v == null ? '' : v).trim();
    return t === '' ? null : t;
  };

  // ON N'ENVOIE QUE CE QUI A CHANGÉ. La fiche renvoyait tout son formulaire d'un
  // bloc : ouvrir une commande, la laisser deux minutes à l'écran et cliquer
  // « Enregistrer » remettait alors les valeurs d'origine par-dessus le travail
  // d'un collègue — y compris l'étape, si l'atelier venait de faire avancer la
  // commande. Chaque contrôle est comparé à la valeur avec laquelle il a été
  // rendu (voir ldSuivi) : ce qu'on n'a pas touché ne part pas.
  const corps = {};
  if (ldModifie(c.cClient)) corps.billing_company = texte(c.cClient.value);
  if (ldModifie(c.cProjet)) corps.product = texte(c.cProjet.value);
  if (ldModifie(c.cPriorite)) corps.priority = Number(c.cPriorite.value);
  if (ldModifie(c.cDate)) corps.deadline = texte(c.cDate.value);
  if (ldModifie(c.cPrix)) corps.project_value = nombre(c.cPrix.value);
  if (ldModifie(c.cTel)) corps.contact_phone = texte(c.cTel.value);
  if (ldModifie(c.cEmail)) corps.contact_email = texte(c.cEmail.value);
  if (ldModifie(c.cReferent)) corps.referent = c.cReferent.value || null;
  if (ldModifie(c.cPlace)) {
    const [stage, sub] = c.cPlace.value.split('|');
    corps.stage = stage;
    corps.sub_stage = sub || null;
  }

  // La note s'AJOUTE aux informations, elle ne les remplace pas : on n'efface
  // jamais ce qu'un collègue avait écrit. Si le pavé d'infos n'a pas été touché,
  // on repart de sa valeur À JOUR (celle de la ligne) et non de ce que la fiche
  // affichait — c'est là que se perdait la note d'un collègue.
  const noteAjoutee = texte(c.note.value);
  const infosModifiees = ldModifie(c.cInfos);
  if (infosModifiees || noteAjoutee) {
    const base = infosModifiees ? texte(c.cInfos.value) : texte(r.description);
    corps.description = noteAjoutee
      ? [base, `${horodatageFr(new Date().toISOString())} — ${noteAjoutee}`].filter(Boolean).join('\n')
      : base;
  }

  let touche = false;
  if (Object.keys(corps).length) {
    const maj = await api('PATCH', `/api/requests/${r.id}`, corps);
    Object.assign(r, maj);
    memoriserFiche(maj);
    touche = true;
  }

  // L'heure de retrait, le secteur de production et le détail du comptoir
  // vivent dans `fiche` : seconde route, qui ne touche qu'aux valeurs et jamais
  // aux libellés.
  const corpsFiche = {};
  if (ldModifie(c.cHeure)) corpsFiche.heureSouhaitee = texte(c.cHeure.value);
  if (ldModifie(c.cProduction)) corpsFiche.production = texte(c.cProduction.value);
  if (c.champsDetail) {
    const detail = [...c.champsDetail.client, ...c.champsDetail.details];
    // Le récapitulatif s'envoie par positions : dès qu'UNE ligne bouge, on
    // renvoie les deux listes complètes — mais telles qu'elles sont à l'écran,
    // donc déjà recalées sur la dernière version connue de la fiche.
    if (detail.some(ldModifie)) {
      corpsFiche.client = c.champsDetail.client.map((x) => x.value);
      corpsFiche.details = c.champsDetail.details.map((x) => x.value);
    }
  }
  if (Object.keys(corpsFiche).length) {
    const majFiche = await api('PATCH', `/api/requests/${r.id}/fiche`, corpsFiche);
    Object.assign(r, majFiche);
    memoriserFiche(majFiche);
    touche = true;
  }

  // Tout est parti : la saisie en cours n'a plus lieu d'être conservée.
  ldOublierSaisie();
  if (touche) await loadCounts();
  return touche;
}

// Bouton « ouvrir la fiche projet » : rejoint le cluster documents de la
// cellule Dossier. C'est LUI qui ouvre la bulle récapitulative — comme le ↗ de
// chaque carte dans l'écran du patron. Son propre `stopPropagation` suffit :
// aucun handler n'est posé sur <tr>, donc le reste de la ligne garde son
// édition inline (cliquer une cellule la corrige, ça ne doit pas ouvrir une
// fiche par-dessus les doigts).
function cellLigneDetailButton(r) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pdf-btn ligne-detail-btn';
  attachTip(btn, 'Ouvrir la fiche projet');
  btn.setAttribute('aria-label', 'Ouvrir la fiche projet');
  btn.appendChild(detailIcon());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openLigneDetail(r.id);
    btn.blur();
  });
  return btn;
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
// `stopPropagation` : sans lui, l'Échap qui ferme le calendrier remontait aussi
// jusqu'au tiroir de la fiche, et les deux se fermaient d'un coup — on perdait
// la fiche entière pour avoir voulu refermer un calendrier.
function onCalKey(e) {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  closeCalendar();
}

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
// `onSaved` (optionnel) est rappelé après un enregistrement réussi : la grille
// s'auto-suffit (le champ édité EST celui affiché), le tiroir de détail s'en
// sert pour recaler la ligne correspondante du tableau.
function bindInline(input, r, field, transform, normalize, onSaved) {
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
    patchRow(r, { [field]: val })
      .then(() => { if (onSaved) onSaved(); })
      .catch((err) => {
        r[field] = prev; input.value = prev ?? ''; lastSent = prev ?? ''; reportError(err);
      });
  });
}

// Infobulle native (title) calée sur la valeur d'un champ tronqué en « … »
// (voir .client-company / .product-name en CSS) : le survol révèle le texte
// complet sans attendre la bulle maison (attachTip), absente sur ces champs.
function syncTitleOnOverflow(input) {
  const sync = () => { input.title = input.value; };
  sync();
  input.addEventListener('input', sync);
  input.addEventListener('blur', sync);
}

// --- PATCH générique optimiste --------------------------------------------
function patch(r, body, applyOptimistic) {
  applyOptimistic();
  patchRow(r, body).catch((err) => {
    reportError(err);
    // Resynchronisation : la valeur posée en optimiste n'a PAS été enregistrée,
    // il ne faut pas la laisser à l'écran comme si elle l'était. Et si même la
    // relecture échoue (réseau toujours coupé), on ne laisse pas filer un rejet
    // non traité — le message d'erreur ci-dessus a déjà prévenu.
    loadRows().catch(() => {});
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

// --- Suppression (optimiste) ----------------------------------------------
async function removeRow(r) {
  const quoi = [r.billing_company, r.product].filter(Boolean).join(' — ') || 'cette commande';
  const ok = await confirmerAction(
    'Supprimer cette commande ?',
    `${quoi} sera retirée du planning définitivement.`,
  );
  if (!ok) return;
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

// LA COPIE SE FAIT CÔTÉ SERVEUR (POST /api/requests/:id/copie). Le navigateur
// renvoyait champ par champ ce qu'il avait à l'écran — or la grille ne reçoit
// qu'un RÉSUMÉ de `fiche` : la copie repartait sans le récapitulatif du
// comptoir, donc sans rien de ce que l'atelier doit produire. Le serveur, lui,
// a la ligne complète sous la main.
function copierCommande(r, stage) {
  return api('POST', `/api/requests/${r.id}/copie`, stage ? { stage } : {});
}

// Duplique une commande (optimiste) : la copie reste dans la même étape et
// apparaît tout de suite. Les PDF ne sont pas recopiés (comme côté serveur).
function duplicateRow(r) {
  const maxPos = rows.reduce((m, x) => Math.max(m, x.position ?? 0), 0);
  const now = new Date().toISOString();
  const tmpId = `tmp-${++tmpSeq}`;
  const copy = {
    ...r, id: tmpId, devis_name: null, bat_name: null, facture_name: null,
    flag: null, flag_reason: null,
    position: maxPos + 1000, created_at: now, updated_at: now,
  };
  // La copie n'apparaît dans la grille que si elle relève bien de la vue courante.
  if (!belongsToCurrentView(copy)) {
    copierCommande(r).catch(reportError);
    return;
  }
  const viewSlug = currentStage;
  rows.push(copy);
  pendingCreates.set(tmpId, { patch: {} });
  applySortAndRender();
  bumpCount(viewSlug, +1);
  // La vue par défaut est en CARTES : viser le <tr> ne trouvait rien, et la
  // copie naissait hors écran sans que personne ne la voie apparaître.
  const nouveau = listeCourante().querySelector(`[data-id="${tmpId}"]`);
  if (nouveau) nouveau.scrollIntoView({ block: 'nearest' });
  copierCommande(r)
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
  copierCommande(r, slug).catch((err) => {
    bumpCount(slug, -1);
    reportError(err);
    loadCounts().catch(() => {}); // valeur exacte (un loadCounts concurrent a pu déjà corriger)
  });
}

// --- Glisser-déposer unifié souris + tactile (Pointer Events) --------------
// Fonctionne au doigt sur tablette : le DnD HTML5 ne se déclenche pas au tactile,
// on utilise donc les Pointer Events (souris, doigt et stylet unifiés).
let dragState = null;

// Sur une carte du planning, toute la surface est saisissable : la poignée EST
// la carte. Mais elle porte aussi des boutons (référent, ouvrir la fiche), et
// `preventDefault()` sur `pointerdown` supprime les évènements souris de
// compatibilité — donc le `click` qui suit. Sans cette garde, aucun bouton posé
// sur une zone de prise ne répondrait plus.
const ZONE_CLIQUABLE = 'button, a, input, select, textarea, [role="button"]';

function attachDrag(handle, tr, r) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target !== handle && e.target.closest && e.target.closest(ZONE_CLIQUABLE)) return;
    // Au doigt / stylet, une CARTE ne se saisit que par sa poignée : le reste de
    // sa surface reste libre pour faire défiler la liste (elle occupe tout
    // l'écran du planning, un `touch-action: none` global y bloquait le
    // défilement). À la souris, toute la carte demeure zone de prise.
    if (e.pointerType !== 'mouse' && handle.classList.contains('pcard')
        && !(e.target.closest && e.target.closest('.pcard__handle'))) return;
    // Un glisser est déjà en cours avec un autre doigt : on ne l'écrase pas.
    // Sinon son fantôme, plus référencé par personne, restait collé à l'écran.
    if (dragState) return;
    e.preventDefault();
    // LA LIGNE EST PRISE DÈS MAINTENANT — pas au franchissement du seuil.
    // La classe `dragging`, elle, n'arrive qu'avec `beginDrag()` : entre le
    // doigt posé et les 8 px, la ligne n'était protégée par RIEN. Qu'un collègue
    // modifie quoi que ce soit pendant cette fraction de seconde, et le rendu
    // temps réel remplaçait la carte sous le doigt : `tr` pointait alors sur un
    // nœud détaché, le fantôme partait se coller en haut à gauche, et la dépose
    // RÉINSÉRAIT ce nœud orphelin — deux cartes pour la même commande, et un
    // ordre manuel corrompu (le même identifiant compté deux fois).
    tr.classList.add('prise-en-cours');
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
  dragState.wrap = document.querySelector('.grid-wrap');
  tr.classList.add('dragging');
  document.body.classList.add('dragging-active');
  if (!defilementRaf) defilementRaf = requestAnimationFrame(boucleDefilement);
}

function onDragMove(e) {
  if (!dragState) return;
  // Un SEUL doigt pilote le glisser : celui qui l'a commencé. Sur la tablette,
  // la paume ou le pouce posé à côté produit ses propres évènements — ils
  // déplaçaient le fantôme et pouvaient déposer la carte ailleurs.
  if (e.pointerId !== dragState.pointerId) return;
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

// LE PRIX NE COMMANDE PLUS LE DÉPLACEMENT. Une commande sans montant était
// refusée à l'entrée de « Devis envoyé », « Devis validé » et de toutes les
// familles suivantes — la cible virait au rouge et l'écran répondait « Sans
// prix, impossible de passer en Facturation ». Règle levée le 31/07/2026 : une
// ligne se déplace où l'on veut, chiffrée ou non, et c'est l'atelier qui décide
// de l'ordre de son travail, pas le champ prix. Le prix reste évidemment
// nécessaire pour facturer — simplement, il ne barre plus la route.

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
  return slug !== r.stage || sub !== (r.sub_stage ?? null); // exclut la place actuelle
}

// Pose l'élément glissé à la hauteur `y` dans la liste affichée. Appelé pendant
// le geste (à chaque frame) ET une dernière fois à la dépose : le suivi en vol
// passe par requestAnimationFrame, que `onDragEnd` annule — sur un geste rapide
// (une pichenette au doigt, ou deux évènements collés), aucune frame n'a le
// temps de tourner et le placement final serait tout simplement perdu.
function placerDansLaListe(el, y) {
  const liste = listeCourante();
  const after = getDragAfterElement(liste, y, el);
  if (after == null) liste.appendChild(el);
  else if (after !== el) liste.insertBefore(el, after);
  paintZebra(); // garder les bandes cohérentes pendant le réordonnancement
}

function updateDragTarget() {
  if (!dragState) return;
  dragState.raf = 0;
  const x = dragState.lastX, y = dragState.lastY;
  const el = document.elementFromPoint(x, y);
  document.querySelectorAll('.stage.drop-target').forEach((s) => s.classList.remove('drop-target'));
  const stageEl = el && el.closest ? el.closest('.stage') : null;
  if (stageEl) {
    if (stageAcceptsDrop(stageEl, dragState.r)) stageEl.classList.add('drop-target');
  } else {
    // réordonnancement vertical dans la vue courante (tableau ou cartes)
    placerDansLaListe(dragState.tr, y);
  }
  autoScroll(y);
}

async function onDragEnd(e) {
  if (!dragState) return;
  // Seul le doigt qui a commencé le glisser peut le terminer. Sans ce filtre,
  // le simple fait de lever un AUTRE doigt (paume posée sur la dalle) déposait
  // la commande là où CE doigt-là se trouvait — un dépôt fantôme, parfois sur
  // une entrée du rail, donc un changement d'étape que personne n'a demandé.
  if (e.pointerId !== dragState.pointerId) return;
  const ds = dragState;
  if (ds.raf) cancelAnimationFrame(ds.raf);
  if (defilementRaf) { cancelAnimationFrame(defilementRaf); defilementRaf = 0; }
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragEnd);
  try { ds.handle.releasePointerCapture(ds.pointerId); } catch (_) {}
  // La ligne cesse d'être « prise » quoi qu'il arrive ensuite — y compris sur
  // un simple tap, qui sort juste en dessous. L'oublier là, c'était figer la
  // ligne : jamais reconstruite, elle gardait indéfiniment ce qu'elle affichait
  // au moment du tap, sans plus jamais suivre le temps réel.
  ds.tr.classList.remove('prise-en-cours');

  if (!ds.active) { dragState = null; return; } // simple clic, pas un drag

  const el = document.elementFromPoint(e.clientX, e.clientY);
  const stageEl = el && el.closest ? el.closest('.stage') : null;

  if (ds.ghost) ds.ghost.remove();
  ds.tr.classList.remove('dragging');
  document.body.classList.remove('dragging-active');
  document.querySelectorAll('.stage.drop-target').forEach((s) => s.classList.remove('drop-target'));
  hideTip();
  dragState = null;

  // Geste ANNULÉ par le système (défilement natif qui prend la main, alerte,
  // bascule d'application sur tablette…) : rien ne se dépose, rien ne s'écrit —
  // la grille reprend simplement son ordre trié.
  if (e.type === 'pointercancel') { applySortAndRender(); return; }

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
      // Le seul refus qui reste : un grand titre à sous-catégories. On guide
      // vers une sous-catégorie plutôt que de laisser la ligne « à préciser ».
      if (stageEl.dataset.sub == null && familyHasSub(stageEl.dataset.slug)) {
        showToast('Dépose la ligne sur une sous-catégorie, pas sur le titre.');
      }
      applySortAndRender(); // rien n'a bougé : on rétablit l'ordre trié de la grille
    }
  } else {
    // Déposé dans la grille → réordonnancement. On rejoue le placement à la
    // position exacte du relâchement avant de l'écrire : c'est là que le geste
    // se termine, et c'est la seule lecture dont on soit certain qu'elle ait eu
    // lieu (le suivi en vol peut n'avoir jamais tourné, cf. placerDansLaListe).
    placerDansLaListe(ds.tr, e.clientY);
    await commitReorder(ds.r);
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

// Le glissement est terminé : le DOM porte l'ordre voulu, on l'écrit dans la
// donnée. On RENUMÉROTE toute la liste visible (1000, 2000, 3000…) au lieu
// d'intercaler la seule ligne déplacée : avant le premier rangement, les lignes
// d'une étape partagent souvent la même `position` (chaque flux de création
// repart de MAX+1000 sans jamais réordonner), et une position calculée « entre
// deux voisins » à égalité retombe exactement sur la valeur de départ — le geste
// était alors perdu en silence. Une étape tient quelques dizaines de lignes :
// tout renuméroter coûte quelques PATCH, une seule fois par déplacement.
async function commitReorder(r) {
  const affichees = [...listeCourante().querySelectorAll('[data-id]:not(.is-hidden)')]
    .map((el) => el.dataset.id);
  if (!affichees.length) return;

  // ON RENUMÉROTE TOUTE LA FAMILLE, pas seulement ce qui est sous les yeux. La
  // vue peut être filtrée (recherche en cours) ou restreinte à une sous-étape :
  // numéroter 1000, 2000, 3000… les seules lignes visibles laissait toutes les
  // autres sur leurs anciennes valeurs — donc des positions en double, et un
  // ordre mélangé dès qu'on effaçait la recherche ou qu'on revenait sur la
  // famille entière.
  const visibles = new Set(affichees);
  const parId = new Map(rows.map((x) => [String(x.id), x]));
  // Séquence de départ = l'ordre de la famille AVANT le geste (l'étape n'est pas
  // encore marquée « rangée à la main » au premier glissement : ordreFamille
  // renvoie donc bien le tri qui était à l'écran).
  const depart = ordreFamille();
  // On rejoue cette séquence en remplaçant, à chaque emplacement tenu par une
  // ligne visible, celle que le geste vient d'y poser. Les lignes hors écran
  // gardent ainsi exactement leur rang dans l'ensemble.
  let k = 0;
  const finale = depart.map((ligne) => (
    visibles.has(String(ligne.id)) ? (parId.get(affichees[k++]) || ligne) : ligne
  ));

  const cibles = [];
  finale.forEach((ligne, i) => {
    const voulue = (i + 1) * 1000;
    if (ligne.position !== voulue) cibles.push({ ligne, voulue, avant: ligne.position });
  });

  // Premier rangement de cette étape : à partir de maintenant, c'est la main qui
  // décide de l'ordre ici. Posé AVANT le rendu, pour que la ligne ne revienne
  // pas à sa place le temps de l'aller-retour serveur.
  const premierRangement = !ordreManuel.has(currentStage);
  if (premierRangement) { ordreManuel.add(currentStage); saveOrdreManuel().catch(reportError); renderOrdreReset(); }
  if (!cibles.length) return;

  for (const c of cibles) c.ligne.position = c.voulue;
  lastRowsSig = signature(rows);
  applySortAndRender();

  try {
    // UNE requête pour toute l'étape, pas une par ligne. En PATCH unitaires, un
    // seul glisser dans une étape de quarante commandes produisait quarante
    // requêtes ET quarante évènements temps réel — que chaque poste connecté
    // payait en rechargeant sa grille, son dashboard et sa fiche ouverte. Le
    // serveur range tout d'un bloc (transaction) et ne prévient qu'une fois.
    await api('PATCH', '/api/requests/positions',
      cibles.map((c) => ({ id: c.ligne.id, position: c.voulue })));
  } catch (err) {
    for (const c of cibles) c.ligne.position = c.avant;
    if (premierRangement) {
      ordreManuel.delete(currentStage);
      saveOrdreManuel().catch(() => {});
      renderOrdreReset();
    }
    applySortAndRender();
    reportError(err);
    loadRows().catch(() => {});
  }
}

// Le retour au tri automatique. Le bouton n'existe que sur une étape rangée à la
// main : ailleurs il n'aurait rien à annuler.
function renderOrdreReset() {
  const b = document.getElementById('ordreReset');
  if (b) b.hidden = !ordreManuel.has(currentStage);
}

document.getElementById('ordreReset')?.addEventListener('click', () => {
  ordreManuel.delete(currentStage);
  saveOrdreManuel().catch(reportError);
  renderOrdreReset();
  applySortAndRender();
});

// Auto-défilement vertical quand le doigt approche des bords de la grille.
// Renvoie vrai si la liste a RÉELLEMENT bougé (butée haute / basse : elle ne
// bouge plus, inutile de recalculer la cible de dépose derrière).
function autoScroll(y) {
  const wrap = dragState && dragState.wrap ? dragState.wrap : document.querySelector('.grid-wrap');
  if (!wrap) return false;
  const rect = wrap.getBoundingClientRect();
  const margin = 64;
  const avant = wrap.scrollTop;
  if (y < rect.top + margin) wrap.scrollTop -= 14;
  else if (y > rect.bottom - margin) wrap.scrollTop += 14;
  return wrap.scrollTop !== avant;
}

// L'auto-défilement ne suivait QUE les évènements de mouvement : doigt immobile
// en bas de l'écran, plus rien ne défilait. Il fallait frétiller pour descendre
// — et sur une longue liste, personne ne devine qu'il faut frétiller. C'est donc
// une boucle à part, qui tourne pendant le glisser et s'arrête avec lui.
let defilementRaf = 0;
function boucleDefilement() {
  if (!dragState || !dragState.active) { defilementRaf = 0; return; }
  // La liste a glissé sous le doigt : la place de dépose n'est plus la même.
  if (autoScroll(dragState.lastY)) updateDragTarget();
  defilementRaf = requestAnimationFrame(boucleDefilement);
}

// Le conteneur de la vue affichée : le corps du tableau, ou la liste de cartes.
// Réordonner, c'est le même geste dans les deux — seul le conteneur change.
const listeCourante = () => (modeCartes() ? $cards : $rows);

// `exclu` : l'élément en cours de déplacement. Pendant le geste il porte la
// classe `.dragging` et le sélecteur suffit ; à la dépose elle a déjà été
// retirée, et sans cet argument l'élément se prendrait lui-même pour repère.
function getDragAfterElement(container, y, exclu = null) {
  const els = [...container.querySelectorAll('[data-id]:not(.dragging):not(.is-hidden)')]
    .filter((el) => el !== exclu);
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
// v6 : le <colgroup> a été remis dans l'ordre réel des colonnes (« flag » était
// en 5e position). Les largeurs enregistrées en v5 étaient rangées sous les
// mauvais noms — on repart d'une clé neuve plutôt que de les réappliquer de
// travers.
const COLW_KEY = 'olda_col_widths_v6';
const COL_MIN = 36; // largeur plancher en px, toutes colonnes
const $grid = document.getElementById('grid');
const COL_ELS = [...document.querySelectorAll('#grid colgroup col')];
const COL_KEYS = COL_ELS.map((c) => c.dataset.col);
// Largeurs naturelles (miroir des .col-* du CSS) : sert de repli quand une
// colonne est masquée (offsetWidth 0) au moment de figer les largeurs manuelles,
// pour qu'elle reprenne une largeur utile — pas le plancher — en réapparaissant.
const COL_DEFAULTS = {
  handle: 52, stars: 78, client_type: 96, responsable: 148, flag: 138, client: 210, product: 220,
  price: 92, sub_stage: 170, description: 210, deadline: 136, del: 200,
};

let colWidths = {};
try { colWidths = JSON.parse(localStorage.getItem(COLW_KEY) || '{}') || {}; } catch (_) { colWidths = {}; }

// --- Choix des colonnes affichées : rail de droite --------------------------
// Le patron compose son écran. Une colonne retirée descend dans « Retirées »
// et RESTE affichée dans le rail — c'est ce qui permet de la remettre d'un
// clic sans aller chercher un menu.
//
// Le choix est GLOBAL (pas par étape) : c'est un réglage de poste, pas un
// paramètre de navigation. Il se cumule avec les règles automatiques
// .no-sub / .no-price, qui elles restent par étape — cocher « Prix TTC » ne
// le fait donc pas apparaître en Production, où il est toujours vide. Le rail
// l'écrit noir sur blanc (voir la mention « vide ici ») pour qu'on ne croie
// pas à un bug.
// `v2` : nouvelle clé volontairement, pour que TOUS les postes repartent sur la
// vue épurée. Un poste qui avait réglé ses colonnes en v1 aurait sinon gardé son
// tableau, et l'écran validé par le patron ne serait apparu nulle part.
const COLS_KEY = 'olda_cols_v2';
// `cls` = la classe portée par le <th> ET les <td> de la colonne, telle que
// posée dans index.html et buildRow(). `auto` = la règle automatique qui peut
// la masquer en plus du choix manuel.
const PLANNING_COLS = [
  { key: 'stars',       label: 'Priorité' },
  { key: 'client_type', label: 'Type' },
  { key: 'responsable', label: 'Responsable' },
  { key: 'client',      label: 'Nom du dossier client', locked: true },
  { key: 'product',     label: 'Description' },
  { key: 'price',       label: 'Prix TTC', auto: (slug) => !PRICE_VISIBLE_STAGES.has(slug) },
  { key: 'sub_stage',   label: 'Sous-étape', auto: (slug) => !familyHasSub(slug) },
  { key: 'description', label: 'Infos' },
  { key: 'deadline',    label: 'Date souhaitée' },
  { key: 'flag',        label: 'État' },
];

// Colonnes qu'on peut éteindre (toutes sauf l'identité de la ligne).
const COLS_ETEIGNABLES = new Set(PLANNING_COLS.filter((c) => !c.locked).map((c) => c.key));

// PAR DÉFAUT, TOUT EST RANGÉ : le planning s'ouvre sur les cartes épurées. Les
// colonnes ne sont pas perdues, elles attendent dans le rail « Colonnes » — en
// rallumer une ramène le tableau avec elle.
let hiddenCols = new Set(COLS_ETEIGNABLES);
try {
  const saved = JSON.parse(localStorage.getItem(COLS_KEY) || 'null');
  // On ne garde que des clés connues et jamais une colonne verrouillée : un
  // localStorage d'une version précédente ne doit pas pouvoir faire disparaître
  // l'identité de la ligne.
  if (Array.isArray(saved)) hiddenCols = new Set(saved.filter((k) => COLS_ETEIGNABLES.has(k)));
} catch (_) { hiddenCols = new Set(COLS_ETEIGNABLES); }

// VUE ÉPURÉE tant qu'aucune colonne n'est allumée. C'est la même commande pour
// les deux vues : le rail « Colonnes » dit ce qu'on veut voir, et le planning
// passe des cartes au tableau dès qu'on lui demande une colonne.
const modeCartes = () => COLS_ETEIGNABLES.size > 0
  && [...COLS_ETEIGNABLES].every((k) => hiddenCols.has(k));

function saveHiddenCols() {
  try { localStorage.setItem(COLS_KEY, JSON.stringify([...hiddenCols])); } catch (_) {}
}

// Pose une classe `off-<clé>` par colonne retirée (règles dans styles.css) et
// publie la largeur totale ainsi libérée dans `--cols-off`. Les planchers de
// largeur du CSS la retranchent : sans ça la grille garderait son plancher
// « toutes colonnes » et continuerait de défiler horizontalement alors qu'on
// vient justement de lui faire de la place.
function applyColVisibility() {
  if (!$grid) return;
  // Une seule des deux vues est montée à la fois : le tableau garderait sinon
  // son en-tête collant au-dessus des cartes.
  const cartes = modeCartes();
  $grid.hidden = cartes;
  if ($cards) $cards.hidden = !cartes;
  document.body.classList.toggle('view-cartes', cartes);
  let off = 0;
  for (const c of PLANNING_COLS) {
    const cache = hiddenCols.has(c.key);
    $grid.classList.toggle('off-' + c.key, cache);
    if (cache) off += COL_DEFAULTS[c.key] || 0;
  }
  $grid.style.setProperty('--cols-off', off + 'px');
}

const $colbar = document.getElementById('colbar');
const $colbarOn = document.getElementById('colbarOn');
const $colbarOff = document.getElementById('colbarOff');
const $colbarOffLegend = document.getElementById('colbarOffLegend');
const $colbarOffEmpty = document.getElementById('colbarOffEmpty');
const $colbarOnNote = document.getElementById('colbarOnNote');
const $colbarReset = document.getElementById('colbarReset');
const $colbarOpen = document.getElementById('colbarOpen');

function colbarItem(col) {
  const on = !hiddenCols.has(col.key);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'colbar-item ' + (on ? 'is-on' : 'is-off') + (col.locked ? ' is-locked' : '');

  const ic = document.createElement('span');
  ic.className = 'material-symbols-outlined colbar-item__ic';
  ic.setAttribute('aria-hidden', 'true');
  ic.textContent = col.locked ? 'lock' : on ? 'check_box' : 'check_box_outline_blank';
  btn.appendChild(ic);

  const label = document.createElement('span');
  label.className = 'colbar-item__label';
  label.textContent = col.label;
  btn.appendChild(label);

  if (col.locked) {
    // `aria-disabled` plutôt que `disabled` : un bouton désactivé ne reçoit
    // plus d'événements de survol, donc l'infobulle qui EXPLIQUE pourquoi il
    // ne bouge pas ne s'afficherait jamais.
    btn.setAttribute('aria-disabled', 'true');
    attachTip(btn, 'Toujours affichée : c’est elle qui identifie la ligne.');
  } else if (on && col.auto && col.auto(currentStage)) {
    // Cochée mais masquée par la règle automatique de l'étape courante.
    const note = document.createElement('span');
    note.className = 'colbar-item__note';
    note.textContent = 'vide ici';
    btn.appendChild(note);
    attachTip(btn, 'Affichée, mais cette étape ne la remplit jamais — elle réapparaît sur les étapes concernées.');
  }

  if (!col.locked) {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.addEventListener('click', () => {
      const avant = modeCartes();
      if (hiddenCols.has(col.key)) hiddenCols.delete(col.key);
      else hiddenCols.add(col.key);
      saveHiddenCols();
      applyColVisibility();
      renderColbar();
      // Rallumer la première colonne fait revenir le tableau, tout éteindre
      // ramène les cartes : dans les deux cas la vue affichée est vide tant
      // qu'on ne l'a pas construite.
      if (modeCartes() !== avant) applySortAndRender();
    });
  }
  return btn;
}

function renderColbar() {
  if (!$colbarOn || !$colbarOff) return;
  $colbarOn.replaceChildren();
  $colbarOff.replaceChildren();
  for (const col of PLANNING_COLS) {
    (hiddenCols.has(col.key) ? $colbarOff : $colbarOn).appendChild(colbarItem(col));
  }
  const rien = hiddenCols.size === 0;
  $colbarOffLegend.hidden = rien;
  $colbarOffEmpty.hidden = !rien;
  // Le bouton reste TOUJOURS disponible : sur les cartes il sert à tout
  // rallumer, sur le tableau à tout ranger. Il n'y a pas d'état sans issue.
  $colbarReset.hidden = false;
  $colbarReset.textContent = modeCartes() ? 'Afficher le tableau complet' : 'Revenir aux cartes';
  // Sur les cartes, « Sur l'écran » n'a que la colonne verrouillée à montrer :
  // on dit ce qui se passe plutôt que de laisser une liste presque vide.
  $colbarOn.hidden = modeCartes();
  if ($colbarOnNote) $colbarOnNote.hidden = !modeCartes();
}

// `memoriser` : on n'enregistre QUE le geste de l'utilisateur. Enregistrer aussi
// l'état calculé au démarrage figeait le tout premier écran ouvert : un passage
// sur un grand moniteur décidait pour la tablette, et le rail se rouvrait en
// paysage comme en portrait alors que personne ne l'avait demandé.
function setColbarOpen(open, memoriser = true) {
  if (!$colbar || !$colbarOpen) return;
  $colbar.hidden = !open;
  $colbarOpen.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (memoriser) {
    try { localStorage.setItem('olda_colbar_open', open ? '1' : '0'); } catch (_) {}
  }
}

function initColbar() {
  if (!$colbar) return;
  applyColVisibility();
  renderColbar();
  // Le rail des colonnes coûte 208 px de largeur (ou, sur tablette, un panneau
  // posé sur la grille) : il ne s'ouvre de lui-même que sur un écran assez
  // large pour l'absorber. Sur la tablette de l'atelier, le planning s'ouvre en
  // pleine largeur et le rail attend derrière son bouton « Colonnes ».
  let open = window.innerWidth >= 1400;
  try {
    const memo = localStorage.getItem('olda_colbar_open');
    if (memo !== null) open = memo !== '0'; // un choix explicite fait toujours foi
  } catch (_) {}
  setColbarOpen(open, false);
  $colbarOpen.addEventListener('click', () => setColbarOpen($colbar.hidden));
  document.getElementById('colbarClose').addEventListener('click', () => setColbarOpen(false));
  // « Tout réafficher » ramène le tableau complet ; « Tout ranger » repose le
  // planning sur ses cartes épurées. Le même bouton, dans les deux sens : on ne
  // se retrouve jamais coincé dans une vue.
  $colbarReset.addEventListener('click', () => {
    if (modeCartes()) hiddenCols.clear();
    else for (const k of COLS_ETEIGNABLES) hiddenCols.add(k);
    saveHiddenCols();
    applyColVisibility();
    renderColbar();
    applySortAndRender();
  });
}

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
    // On LIT d'abord toutes les visibilités, on ÉCRIT ensuite les largeurs.
    // Entrelacées, ces deux opérations forçaient le navigateur à recalculer la
    // mise en page à chaque colonne — douze fois par rendu, et à chaque
    // mouvement du doigt pendant le redimensionnement d'une colonne.
    // Une colonne masquée (display:none) ne compte pas dans la largeur fixe,
    // sinon les colonnes visibles s'étirent pour absorber l'espace fantôme.
    const visibles = COL_ELS.map((col) => getComputedStyle(col).display !== 'none');
    COL_ELS.forEach((col, i) => {
      const px = Math.max(COL_MIN, Math.round(w[COL_KEYS[i]] || COL_DEFAULTS[COL_KEYS[i]] || COL_MIN));
      col.style.width = px + 'px';
      if (visibles[i]) sum += px;
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

// Légende de la colonne priorité : rien dans l'en-tête ne dit qu'un clic sur
// le badge fait défiler les 3 niveaux — un nouvel arrivant ne le devine pas.
function attachStarsHeaderTip() {
  const th = document.querySelector('#grid thead th.col-stars');
  if (th) attachTip(th, 'Priorité : Basse, Moyenne ou Haute — cliquer le badge sur la ligne pour la changer');
}

function attachColResizers() {
  document.querySelectorAll('#grid thead th').forEach((th, i) => {
    const key = COL_KEYS[i];
    if (key === 'del') return; // colonne d'actions : pas de poignée
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

// « Failed to fetch », « NetworkError when attempting to fetch resource » : le
// navigateur parle anglais et technique. L'atelier, lui, doit juste savoir que
// le réseau est tombé et que ça va revenir.
function estPanneReseau(err) {
  const m = String((err && err.message) || '');
  return err instanceof TypeError
    || /failed to fetch|networkerror|load failed|network request failed/i.test(m);
}

function reportError(err) {
  console.error(err);
  // signal discret et non bloquant
  if (estPanneReseau(err)) { showToast('Connexion perdue — on réessaie tout seul.'); return; }
  const msg = (err && err.message) ? err.message : 'Erreur réseau';
  showToast(msg);
}

// --- Demande de confirmation ------------------------------------------------
// Voir confirmer.js : la boîte est partagée avec la Base clients.

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
// La saisie doit être DANS LA GRILLE : c'est elle, et elle seule, qu'un re-rendu
// écraserait. Compter n'importe quel champ de la page gelait le planning du
// poste dès qu'on laissait le curseur dans la recherche de la barre du haut —
// les compteurs du rail continuaient de bouger, eux, et l'écran se contredisait.
// Le tiroir de détail a sa propre garde (isDrawerBusy) et conserve désormais les
// valeurs en cours de saisie à travers un re-rendu (voir renderLigneDetail).
function isInteracting() {
  if (dragState) return true;
  if (openCalendar) return true; // popup ancré à un badge de la grille
  if (openMenuEl) return true;   // menu (type / responsable / sous-étape) ouvert
  const ae = document.activeElement;
  if (!ae) return false;
  if (ae.tagName !== 'INPUT' && ae.tagName !== 'SELECT' && ae.tagName !== 'TEXTAREA') return false;
  return !!(($rows && $rows.contains(ae)) || ($cards && $cards.contains(ae)));
}

// --- Le temps qui passe ------------------------------------------------------
// Délais restants, badges d'échéance et couleurs d'urgence sont calculés AU
// MONTAGE de la ligne — et une ligne n'est remontée que si sa donnée change. Sur
// une tablette ouverte depuis le matin, tout cela restait donc figé sur l'heure
// du petit-déjeuner : une commande qui passait en retard ne virait jamais au
// rouge, et le tri par urgence ne la faisait pas remonter. On repasse dessus
// chaque minute, sans jamais interrompre une saisie ni un glisser.
const TICK_TEMPS_MS = 60000;
// Le jour affiché lors du dernier passage : le TRI par urgence, lui, ne dépend
// que du nombre de jours restants — il ne peut donc changer qu'au passage de
// minuit, pas à chaque minute.
let dernierJourRendu = new Date().toDateString();

function rafraichirTemps() {
  if (document.hidden || !booted) return;
  if (isInteracting()) return;

  // MINUIT : les échéances changent de bande (« 1 j » devient « Aujourd'hui »,
  // « Aujourd'hui » devient « En retard ») et l'ordre du planning avec elles.
  // C'est le seul moment où il faut vraiment tout recalculer.
  const jour = new Date().toDateString();
  if (jour !== dernierJourRendu) {
    dernierJourRendu = jour;
    invalidateRowCache();
    // Le tiroir n'est PAS reconstruit ici : il porte peut-être une correction
    // non encore enregistrée, et son affichage ne dépend pas de la minute.
    applySortAndRender({ syncDrawer: false });
    return;
  }

  // Le reste du temps, seul le TEXTE du délai bouge. On le réécrit sur place :
  // reconstruire chaque carte (buildCard + attachDrag + attachTip, et jusqu'à
  // 400 itérations de calcul d'heures ouvrées par ligne) une fois par minute
  // secouait tout le planning sur une tablette ouverte depuis le matin.
  const cartes = modeCartes();
  const entrees = cartes ? cardEls : rowEls;
  for (const [, e] of entrees) {
    const el = cartes ? e.el : e.tr;
    if (!el || !el.isConnected) continue;
    if (cartes) {
      if (el.__majTemps) el.__majTemps();
    } else {
      const td = el.querySelector('.col-deadline-cell');
      if (td && td.__majTemps) td.__majTemps();
    }
  }
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
    // Même garde que `loadRows` : on note l'étape demandée ET le jeton de
    // chargement AVANT la requête. Sans ça, une réponse partie pour la famille
    // A qui revient après un clic sur la famille B écrasait la grille avec les
    // lignes de A — affichées sous l'entête de B, et resservies ensuite par le
    // raccourci « même famille » de selectStage.
    const slug = currentStage;
    const token = loadToken;
    const fresh = await api('GET', `/api/requests?stage=${encodeURIComponent(slug)}`);
    if (slug !== currentStage || token !== loadToken) return; // sélection dépassée
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
  // Une étape vient d'être rangée (ou dérangée) par un autre poste : la décision
  // est partagée, l'ordre affiché ici doit suivre.
  if (kind === 'ordre-manuel') {
    loadOrdreManuel().then(() => { renderOrdreReset(); applySortAndRender(); });
  }
  // Le détail complet mis de côté peut avoir été corrigé ailleurs : on le relit
  // pour la seule fiche ouverte (voir rafraichirFichesApresChangement).
  rafraichirFichesApresChangement();
  // Le planning a changé côté serveur : si une recherche est ouverte, ses
  // résultats sont peut-être périmés. On la relance — c'est désormais UNE requête
  // qui rend une page de résultats, plus le planning entier retéléchargé en
  // boucle sous les doigts de celui qui cherche.
  if (paletteOpen) runSearch();
  // coalesce les rafales (plusieurs modifs quasi simultanées) en un seul refresh
  clearTimeout(streamDebounce);
  streamDebounce = setTimeout(() => {
    // Le Point du jour garde son cache à jour même masqué (fil d'activité,
    // badges, écran mural) — mais à un rythme de fond, pas à chaque évènement.
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
  // les délais affichés suivent l'horloge, pas seulement les données
  setInterval(rafraichirTemps, TICK_TEMPS_MS);
  // rafraîchit immédiatement quand on revient sur l'onglet / réveille la tablette
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { poll(); rafraichirTemps(); dashboard.notifyChange(); }
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
// Données : C'EST LE SERVEUR QUI CHERCHE. On téléchargeait TOUT le planning à la
// première frappe — archives comprises, donc une liste qui ne cesse de grossir,
// à vie — pour filtrer dessus en mémoire. On envoie désormais la requête, et le
// serveur ne renvoie qu'une page de résultats (voir GET /api/requests/recherche).

const $palette = document.getElementById('searchPalette');
const $paletteScrim = document.getElementById('searchPaletteScrim');
const $paletteResults = document.getElementById('searchPaletteResults');
const $paletteCount = document.getElementById('searchPaletteCount');

let rechercheDebounce = null; // frappe en cours : on attend qu'elle se pose
let rechercheToken = 0;       // ne rend que la réponse de la DERNIÈRE requête
const RECHERCHE_DEBOUNCE_MS = 180;
let paletteOpen = false;
let paletteItems = [];        // résultats plats, dans l'ordre affiché
let paletteActive = -1;       // index surligné (navigation clavier)
const PALETTE_MAX = 60;       // plafond d'affichage (au-delà : « affinez »)

// Ordre d'affichage des groupes = ordre du pipeline (familles puis spécial).
const STAGE_ORDER = Object.fromEntries(STAGES.map((s, i) => [s.slug, i]));

// Interroge le serveur. Le jeton écarte les réponses dépassées : sur une frappe
// rapide, celle de « po » peut revenir APRÈS celle de « polo » et réafficher les
// résultats d'avant sous les doigts de celui qui cherche.
function rechercheServeur(texte) {
  const token = ++rechercheToken;
  return api('GET', `/api/requests/recherche?q=${encodeURIComponent(texte)}`)
    .then((data) => (token === rechercheToken ? (Array.isArray(data) ? data : []) : null));
}

// Le filtrage jeton par jeton vit désormais côté serveur (même règle : chaque
// jeton doit apparaître dans l'un des champs cherchés, sans distinction de casse
// ni d'accent). Les jetons restent utiles ici pour SOULIGNER les occurrences.

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

// (Re)demande les résultats au serveur et les rend. La frappe est amortie : une
// requête par mot tapé, pas par touche.
function runSearch() {
  const raw = gridQuery.trim();
  if (!raw) { closePalette(); return; }
  openPalette();
  clearTimeout(rechercheDebounce);
  rechercheDebounce = setTimeout(() => lancerRecherche(raw), RECHERCHE_DEBOUNCE_MS);
}

function lancerRecherche(raw) {
  if (!paletteOpen) return;
  // On n'efface pas les résultats précédents pendant l'attente : la liste ne
  // doit pas clignoter à chaque mot. « Recherche… » n'apparaît que si l'on n'a
  // encore rien à montrer.
  if (!paletteItems.length) renderPaletteLoading();
  const tokens = fold(raw).split(/\s+/).filter(Boolean);
  rechercheServeur(raw)
    .then((hits) => {
      if (hits === null || !paletteOpen) return; // réponse dépassée / palette fermée
      // Le serveur rend les plus récemment touchées d'abord (c'est ce qui décide
      // de la page servie) ; l'écran, lui, les regroupe par étape du pipeline.
      hits.sort((a, b) => {
        const sa = STAGE_ORDER[a.stage] ?? 99, sb = STAGE_ORDER[b.stage] ?? 99;
        if (sa !== sb) return sa - sb;
        return cmpDeadline(a.deadline, b.deadline);
      });
      renderPaletteResults(hits, tokens);
    })
    .catch(() => {
      if (!paletteOpen) return;
      clearPalette();
      $paletteCount.textContent = '';
      paletteMessage('Recherche indisponible — vérifie la connexion.');
    });
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

  // Le serveur en renvoie UN de plus que ce qu'on affiche : c'est ainsi qu'on
  // sait qu'il y en a d'autres, sans lui faire compter tout le planning.
  const total = hits.length;
  const shown = hits.slice(0, PALETTE_MAX);
  $paletteCount.textContent = total > PALETTE_MAX
    ? `${PALETTE_MAX} premiers résultats — affine ta recherche`
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

// Met en évidence la ligne (tableau) OU la carte (vue épurée) après un saut :
// défilement au centre + bref flash. Partagé par la recherche globale et le
// dashboard — la vue par défaut étant les cartes, viser seulement le <tr>
// laissait le saut « muet » la plupart du temps.
function revealRow(id) {
  const entry = modeCartes() ? cardEls.get(String(id)) : rowEls.get(String(id));
  const el = entry ? (entry.tr || entry.el) : null;
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('row-flash');
  void el.offsetWidth; // relance l'animation même si déjà posée
  el.classList.add('row-flash');
  setTimeout(() => el.isConnected && el.classList.remove('row-flash'), 1800);
}

// Saute vers la commande choisie : ouvre sa catégorie (et sa sous-étape), ferme
// la palette, met la ligne brièvement en évidence.
async function jumpToResult(r) {
  closePalette();
  // La recherche a rempli son office : on la vide, sinon la grille d'arrivée
  // resterait filtrée sur la requête et semblerait amputée de ses lignes.
  if ($gridSearchInput) { $gridSearchInput.value = ''; $gridSearchInput.blur(); }
  setGridQuery('');
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
  revealRow(r.id);
}

function setGridQuery(v) {
  const next = v || '';
  if (next === gridQuery) return;
  gridQuery = next;
  syncSearchUI();
  runSearch();
  // La grille masque ses lignes par `.is-hidden` selon la même requête. Vider
  // le champ par la croix fermait la palette mais laissait la grille filtrée
  // (et parfois « Aucune commande ne correspond ») jusqu'au prochain rendu.
  applySearchAndCounts();
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
    // attachTip pose déjà l'aria-label (le bouton n'a pas de `title`).
    attachTip($fullscreenToggle, on ? 'Quitter le plein écran' : 'Plein écran');
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
const $viewClients = document.getElementById('viewClients');
const $clients = document.getElementById('clients');
const $viewReglages = document.getElementById('viewReglages');
const $reglages = document.getElementById('reglages');
const $viewProjet = document.getElementById('viewProjet');
const $projet = document.getElementById('nouveau-projet');

// 'planning' | 'dashboard' | 'clients' | 'reglages' | 'projet'
// | 'fiverr' | 'a_commander' (les deux catégories promues en onglet)
let viewMode = 'planning';

// Saut vers une commande : bascule sur le Planning, l'ouvre et la surligne.
// Si elle vit dans une catégorie promue en onglet (Fiverr, À commander), c'est
// SON onglet qu'on ouvre : sinon on afficherait une grille dont l'onglet allumé
// et le rail ne parlent pas.
async function jumpToPlanning(r) {
  const sub = r.sub_stage && SUB_LABEL[r.sub_stage] ? r.sub_stage : null;
  const promoted = PROMOTED.find((p) => p.stage === r.stage && p.sub === sub);
  setViewMode(promoted ? promoted.view : 'planning');
  await selectStage(r.stage, sub);
  revealRow(r.id);
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

// Nouveau Projet : même principe que Base clients / Réglages (module lourd,
// chargé au premier passage, monté une bonne fois). `nouveau-projet.js` est
// l'aiguillage des deux flux du comptoir — vente directe et demande de devis —
// et ne charge le JS d'un flux qu'au premier passage dessus.
let projetLoading = null;
let projetModule = null;
function mountProjet() {
  if (!$projet) return;
  if (!projetLoading) {
    projetLoading = import('./nouveau-projet.js')
      .then((m) => { projetModule = m; return m.initProjet($projet); })
      .catch((err) => {
        projetLoading = null;
        projetModule = null;
        console.error('Nouveau Projet : chargement impossible', err);
      });
  } else if (projetModule && projetModule.resetProjet) {
    // Comptoir : chaque passage sur l'onglet repart de « Quel client ? »,
    // jamais sur un brouillon laissé par le passage précédent.
    projetModule.resetProjet();
  }
}

// Le comptoir vient d'enregistrer un dossier : le planning s'ouvre SUR LUI,
// à son étape, ET DÉFILE JUSQU'À SA LIGNE (flash de repère). Sans ce défilement,
// une étape passée en ordre manuel fait naître la ligne TOUT EN BAS de la
// liste : la vendeuse ne voyait rien apparaître et ressaisissait la commande.
window.addEventListener('olda:projet-cree', async (e) => {
  const { id, stage, sub, avis } = e.detail || {};
  location.hash = '#planning';
  // Le serveur a reconnu un RENVOI du même dossier : rien n'a été créé, et la
  // ligne vers laquelle on saute est celle de l'envoi précédent. On le dit —
  // sans ça, la vendeuse compte une commande de plus qu'il n'y en a.
  if (avis) showToast(avis);
  if (!stage) return;
  await selectStage(stage, sub || null, true);
  if (id) revealRow(id);
});

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
  if ($viewProjet) $viewProjet.classList.toggle('active', mode === 'projet');
  for (const p of PROMOTED) {
    const btn = document.getElementById(p.btn);
    if (btn) btn.classList.toggle('active', mode === p.view);
  }
  if (mode === viewMode) return;
  viewMode = mode;
  // Le tiroir de détail est monté sur <body>, pas dans la vue Planning : il ne
  // part donc pas tout seul quand on change de vue (y compris via le bouton
  // Retour du navigateur ou le balayage depuis le bord sur tablette), et il
  // resterait posé par-dessus le Dashboard, scrim compris.
  closeLigneDetail();

  const dash = mode === 'dashboard';
  const clients = mode === 'clients';
  const reglages = mode === 'reglages';
  const projet = mode === 'projet';
  if ($dashboard) $dashboard.hidden = !dash;
  if ($clients) $clients.hidden = !clients;
  if ($reglages) $reglages.hidden = !reglages;
  if ($projet) $projet.hidden = !projet;
  document.body.classList.toggle('view-plein', !isPlanningMode(mode));
  document.body.classList.toggle('view-focus', mode in PROMOTED_BY_VIEW);
  // Nouveau Projet = poste comptoir, devant le client : la nav du back-office
  // (Dashboard, Fiverr, Réglages…) disparaît, il ne reste que l'étape en cours.
  document.body.classList.toggle('view-comptoir', mode === 'projet');

  if (dash) dashboard.show(); else dashboard.hide();
  if (clients) mountClients();
  if (reglages) mountReglages();
  if (projet) mountProjet();
  if (isPlanningMode(mode)) {
    // De retour au planning : la sous-étape courante peut avoir changé ailleurs.
    updateFiverrTool(currentStage);
  }
}

// Nouveau Projet est la SEULE porte d'entrée (client, prix, délai obligatoire) :
// il n'existe plus d'écran de saisie parallèle. Les anciens `#demande` et
// `#commande` ne figurent plus ici — ils retombent sur le planning, comme tout
// hash inconnu.
const VIEWS = {
  '#dashboard': 'dashboard',
  '#nouveau-projet': 'projet',
  '#clients': 'clients', '#reglages': 'reglages',
  ...Object.fromEntries(PROMOTED.map((p) => [p.hash, p.view])),
};
function applyHash() {
  const h = location.hash;
  const mode = VIEWS[h] || 'planning';
  setViewMode(mode);
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

// Échafaudage de l'écran : posé UNE seule fois. Une reprise après coupure
// réseau ne doit pas reconstruire le rail ni rattacher une seconde fois les
// écouteurs de redimensionnement des colonnes.
let echafaudagePose = false;
async function start() {
  if (!echafaudagePose) {
    echafaudagePose = true;
    renderSidebar();
    attachColResizers();
    attachStarsHeaderTip();
    initColbar();
  }
  updateSubColVisibility(currentStage);
  updatePriceColVisibility(currentStage);
  applyColWidths();
  // L'EN-TÊTE NE DÉPEND D'AUCUN RÉSEAU : on le pose avant tout appel. Hors
  // ligne (le service worker sert la coquille), l'écran affichait sinon le
  // titre de repli du HTML — « Commande » — au lieu de l'étape en cours.
  $stageTitle.textContent = currentViewLabel();
  updateStageLink(currentStage);
  updateStageHelp();
  updateFiverrTool(currentStage);
  // Les noms « de base » (pilote + référents par catégorie) doivent être connus
  // AVANT le premier rendu, sinon les lignes s'affichent en « Non défini » puis
  // sautent. Aucun de ces appels n'est vital : un compteur manquant ne doit pas
  // empêcher le planning de s'afficher — seul `loadRows` fait foi (son échec
  // déclenche la reprise, voir demarrerAvecReprise).
  await Promise.all([
    loadCategoryConfig(), loadCounts().catch(() => {}), loadWhatsappMessage(),
    loadTgca(), loadOrdreManuel(),
  ]);
  await loadRows();
  lastRowsSig = signature(rows);
  // À partir d'ici la grille est montée : les changements d'onglet peuvent la
  // recharger d'eux-mêmes (voir applyHash).
  booted = true;
  dashboard.start(); // monte le « Point du jour » et charge son cache en fond
  startRealtime();
}

// --- Installation sur la tablette + ouverture hors ligne ---------------------
// Le manifeste seul ne suffit pas : sans service worker, Chrome ne propose
// jamais « Installer l'application », et une coupure réseau au démarrage laisse
// un écran blanc. Le nôtre ne fait QUE mettre la coquille de côté — le réseau
// garde toujours la priorité (voir sw.js), un déploiement s'applique donc
// immédiatement comme aujourd'hui.
if ('serviceWorker' in navigator) {
  // Après le premier rendu : l'enregistrement ne doit pas disputer la bande
  // passante au chargement du planning.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker non enregistré :', err);
    });
  });
}

// Un seul échec réseau au démarrage laissait l'application MORTE : `booted`
// restait faux, le temps réel n'était jamais lancé, et seul un rechargement
// manuel s'en sortait. On réessaie, en espaçant les tentatives.
function demarrerAvecReprise(essai = 0) {
  start().catch((err) => {
    reportError(err);
    // Le service worker a servi la coquille : l'écran est là, mais vide. On DIT
    // pourquoi — un planning vide sans explication se lit comme « tout a
    // disparu », et c'est le moment où quelqu'un ressaisit une commande.
    if ($empty) {
      $empty.hidden = false;
      $empty.textContent = essai === 0
        ? 'Connexion au serveur perdue — les commandes réapparaîtront dès le retour du réseau.'
        : `Toujours hors ligne — nouvelle tentative (${essai + 1})…`;
    }
    const attente = Math.min(15000, 1500 * (essai + 1));
    setTimeout(() => demarrerAvecReprise(essai + 1), attente);
  });
}
demarrerAvecReprise();
