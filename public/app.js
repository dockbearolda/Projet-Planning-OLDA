// ===========================================================================
// Planning OLDA — frontend (vanilla ES module, aucun build)
// ===========================================================================

// Guide des étapes (texte du patron, feuille « Descriptif Étapes »).
// Dashboard « Point du jour » (projection temps réel du planning).
// WhatsApp « commande prête » : numéro au format international + message rempli.
import { whatsappLink } from './whatsapp.js';
// La règle d'AFFICHAGE d'un nom de client : TOUT en capitales, restaurants et
// sociétés compris, seul le prénom d'un particulier garde ses initiales. Elle
// vit là et nulle part ailleurs : un écran qui peint un nom sans passer par ce
// module finit par diverger des cinq autres.
import { capitales, nomClientAffiche } from './nom-client.js';
// La boîte de confirmation de l'app (jamais celle du système) — partagée avec
// la Base clients, qui en a besoin pour la suppression d'une fiche.
import { confirmerAction } from './confirmer.js';
// `fetch` avec une fin : sans minuteur, une requête partie sur un réseau qui
// décroche n'échoue jamais et laisse le bouton (ou l'écran) figé pour la journée.
import { fetchBorne, DELAI_ENVOI, api, surNonConnecte } from './reseau.js';
// LE TICKET du client — celui que la vendeuse imprime au comptoir, réimprimable
// à l'identique depuis n'importe quelle ligne du planning.
import { modeleTicket, ticketTexte, dessinerTicket, CSS_TICKET } from './ticket.js';
import { eur } from './format.js';
// LA FICHE DE PRODUCTION ET LA RANGÉE « MANQUE », dans leur propre fichier
// depuis le 27/08 — voir l'en-tête de ligne-faits.js pour ce qui a été
// mesuré avant de couper, et pourquoi les deux emprunts passent par la
// signature plutôt que par un import de retour vers ce fichier-ci.
import { blocFeu, blocProduction, nomArticle } from './ligne-faits.js';
// LA FICHE ATELIER — l'écran qui s'ouvre en cliquant une ligne (28/08). Un
// module à part : c'est un écran NEUF et autonome, il n'emprunte rien à l'état
// partagé d'app.js. Ce qu'il sait faire de l'application lui est passé à
// l'appel (`ctx`), jamais importé en retour — un cycle entre deux modules
// casse à l'ouverture, et il casse ce jour-là seulement.
import { dessinerFicheAtelier } from './fiche-atelier.js';
// LE DOCUMENT DU BUREAU est chargé À LA DEMANDE : c'est un papier qu'on
// ressort pour facturer ou pour contester, pas à chaque ouverture d'un poste.
let bureauMod = null;
const chargerBureau = () => (bureauMod
  ? Promise.resolve(bureauMod)
  : import('./bureau.js').then((m) => { bureauMod = m; return m; }));
// LA FACTURE, chargée à la demande comme le bon de commande — un poste qui
// n'ouvre jamais de facture ne télécharge jamais ce module.
let factureMod = null;
const chargerFacture = () => (factureMod
  ? Promise.resolve(factureMod)
  : import('./facture.js').then((m) => { factureMod = m; return m; }));
// « Le patron a mis à jour » : une tablette du comptoir ne se recharge jamais
// d'elle-même, elle exécute donc encore la version d'avant-hier. On lui propose.
import { noterVersion, surveillerMaj } from './maj.js';
// Qui est au poste : le nom affiché en haut à droite, et celui qui signe les
// demandes prises sur cet appareil (le parcours comptoir le relit).
import { monterPoste, lirePoste } from './poste.js';
import { relireSession, puisJe, moi, comptesActifs, signalerNonConnecte, surChangement }
  from './session.js';

// UN 401 EN PLEIN TRAVAIL REDEMANDE QUI EST LÀ, depuis N'IMPORTE QUEL écran.
// `api()` vit dans `reseau.js`, qui ne connaît pas la session : c'est le
// planning — la seule coquille montée en permanence — qui lui dit quoi faire.
surNonConnecte(signalerNonConnecte);

// --- Pipeline à 2 NIVEAUX (modèle « familles », d'après le CRM du patron) -----
// La FAMILLE (barre latérale) dit OÙ en est le projet ; la SOUS-ÉTAPE (puce sur
// la ligne) précise CE QUI SE PASSE MAINTENANT. « 1 projet = 1 seule place. »
// 5 familles au lieu de 20 étapes → barre latérale nettement plus lisible/aérée.
const FAMILIES = [
  // Le sur-dossier du comptoir, en tête : tout ce que la vendeuse enregistre
  // arrive ici et y attend d'être rangé. Sans sous-étapes (miroir de db.js).
  { slug: 'a_trier', label: 'À trier' },
  { slug: 'demande_chiffrage', label: 'Demande & chiffrage' },
  { slug: 'preparation', label: 'Préparation du projet' },
  { slug: 'production', label: 'Production' },
  { slug: 'facturation', label: 'Facturation & remise au client' },
  { slug: 'paiement', label: 'Paiement & clôture' },
];
// LE SUR-DOSSIER. Nommé une fois, lu partout : c'est la seule famille où l'on
// range plutôt que de travailler.
const A_TRIER = 'a_trier';
// Catégorie spéciale (sous-traitance graphiste), hors des 5 familles.
const SPECIAL = [
  { slug: 'fiverr', label: 'Fiverr' },
];
const STAGES = [...FAMILIES, ...SPECIAL];
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.slug, s.label]));
// Colonne « Prix TTC » : n'a de sens que là où le prix se remplit réellement
// (chiffrage, montant à facturer, contrôle du paiement) — masquée ailleurs.
// « À trier » en fait partie : une vente directe y arrive DÉJÀ
// encaissée, et le montant est ce qui distingue le plus vite une vente d'une
// demande quand on range cinq dossiers à la suite.
const PRICE_VISIBLE_STAGES = new Set([A_TRIER, 'demande_chiffrage', 'facturation', 'paiement']);

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
    // ELLE MANQUAIT ICI, ET ELLE AVALAIT DES DOSSIERS (retrouvée le 26/08).
    // `db.js` la connaît, le serveur la valide, /api/counts la compte — mais
    // l'écran ne l'avait pas : une commande posée là s'affichait « à préciser »
    // et le rail n'avait AUCUNE ligne pour l'accueillir. Elle était donc en
    // base, comptée, et introuvable. Et c'est justement le cas où quelqu'un
    // attend : un BAT que le client renvoie à corriger.
    { slug: 'bat_modif', label: 'BAT – Modification demandée' },
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

// Cibles d'envoi rapide proposées sur chaque ligne. `icone` : le dessin de la
// DESTINATION (cf. fiverrIcon) — une flèche ne dit que le geste, et sur une
// ligne qui en porte déjà une pour « ouvrir », deux flèches ne se distinguent
// pas. Une cible sans `icone` retombe sur la flèche générique.
const SEND_TARGETS = [
  { slug: 'fiverr', label: 'Fiverr', icone: () => fiverrIcon() },
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
    // Le nom de famille EN CAPITALES, comme partout ailleurs : c'est le même
    // nom que le client a sous les yeux sur son ticket.
    client: nomClientAffiche(r.billing_company, r.client_type) || r.contact_referent || '',
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

// `eur` vit dans `format.js` : `ligne-faits.js` en a besoin aussi, et une
// copie de plus est une vérité de plus.

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

// --- API helpers -----------------------------------------------------------

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
  count.className = 'stage-count';
  poserCompte(count, n);
  el.append(label, count);
  // Le compteur fait partie du nom accessible : « À chiffrer, 9 commandes ».
  el.setAttribute('aria-label', `${label.textContent} — ${n} commande${n > 1 ? 's' : ''}`);
  if (active) el.setAttribute('aria-current', 'true');
  el.addEventListener('click', () => selectStage(slug, isSub ? sub.slug : null));
  return el;
}

// ===========================================================================
// LES ÉTAPES VIDES SE REPLIENT — ET RIEN N'EST SUPPRIMÉ
// ===========================================================================
// Mesuré au rendu le 26/08 : 33 lignes dans le rail, 1 362 px de haut, dont
// 899 px (66 %) de lignes VIDES — sur un écran de 1 043 px. Le rail débordait
// donc de l'écran, et les deux tiers de ce qu'on faisait défiler ne portaient
// aucun dossier.
//
// ON NE SUPPRIME AUCUNE ÉTAPE. La structure complète du pipeline est ce que le
// patron veut voir, et il a raison : c'est elle qui dit ce qui reste à faire
// après. Ce qui change, c'est qu'elle ne s'impose plus quand elle est vide.
//
// TROIS RÈGLES, et elles se tiennent :
//   · L'ORDRE NE CHANGE JAMAIS. Les étapes repliées ne partent pas en bas de la
//     phase : elles disparaissent de leur place et y reviennent. L'ordre EST le
//     pipeline, ce n'est pas une mise en page.
//   · L'ÉTAPE OUVERTE NE SE REPLIE JAMAIS, même vide. Sans ça, cliquer sur une
//     étape vide la faisait disparaître sous le doigt.
//   · ON NE REPLIE QU'À PARTIR DE DEUX. Cacher une ligne derrière une ligne ne
//     gagne rien et coûte un clic.
//
// LA LIGNE DE REPLI RESTE AU MÊME ENDROIT dans les deux états — à la fin de sa
// phase, même hauteur. Une bascule = UN mouvement (les étapes qui reviennent),
// et il ne déplace rien d'autre.
const REPLI_MINIMUM = 2;
const RAIL_DEPLIE_KEY = 'olda.rail-deplie';

// LE CHOIX SUIT LA PERSONNE, pas la machine : le chef d'atelier veut sa
// production dépliée, la boutique son chiffrage. Même règle que les colonnes
// du planning (cf. colsKey).
const railKey = () => {
  const qui = lirePoste();
  return qui ? `${RAIL_DEPLIE_KEY}:${qui}` : RAIL_DEPLIE_KEY;
};

function lireRailDeplie() {
  try {
    const brut = JSON.parse(localStorage.getItem(railKey()) || 'null');
    if (Array.isArray(brut)) return new Set(brut.filter((x) => typeof x === 'string'));
  } catch (_) { /* stockage refusé ou illisible */ }
  return new Set();
}

let railDeplie = lireRailDeplie();

// UNE PHASE ENTIÈRE SE PLIE (02/09/2026)
// ---------------------------------------------------------------------------
// Charlie : « ces catégories doivent être pliable repliable ». C'est un cran
// AU-DESSUS du repli des étapes vides : là on masque la phase entière, titre
// compris — le rail de l'atelier tient six phases et personne n'en suit six.
//
// DEUX REPLIS, DEUX MÉMOIRES, ET C'EST VOULU : « + 6 étapes vides » dit quelles
// étapes on veut voir DANS une phase qu'on suit ; celui-ci dit quelles phases
// on suit. Les confondre reviendrait à rouvrir une phase entière pour montrer
// une étape vide.
const RAIL_PLIE_ZONES_KEY = 'olda.rail-zones-pliees';
const zonesKey = () => {
  const qui = lirePoste();
  return qui ? `${RAIL_PLIE_ZONES_KEY}:${qui}` : RAIL_PLIE_ZONES_KEY;
};
function lireZonesPliees() {
  try {
    const brut = JSON.parse(localStorage.getItem(zonesKey()) || 'null');
    if (Array.isArray(brut)) return new Set(brut.filter((x) => typeof x === 'string'));
  } catch (_) { /* stockage refusé ou illisible */ }
  return new Set();
}
let railZonesPliees = lireZonesPliees();
function saveZonesPliees() {
  try { localStorage.setItem(zonesKey(), JSON.stringify([...railZonesPliees])); } catch (_) {}
}

// LES ÉTAPES REPLIÉES RESTENT DES CIBLES. « Les étapes vides, on doit se
// rappeler qu'elles existent : quand je glisse une ligne et que je passe sur
// "+ 5 étapes vides", le simple fait de passer dessus doit les ouvrir pour que
// je puisse y déposer. » (Charlie, 26/08)
//
// Sans ça le repli aurait fermé la porte principale : on déplace un dossier en
// le GLISSANT sur le rail, et une étape vide est exactement celle où l'on veut
// souvent le mettre — c'est même sa définition. Le repli aurait donc caché les
// destinations les plus probables.
//
// L'OUVERTURE EST TEMPORAIRE, dans un ensemble à part : elle ne s'enregistre
// pas et le rail se referme à la fin du geste. Si la ligne a été déposée dans
// une de ces étapes, celle-ci n'est plus vide et reste visible d'elle-même.
let railGlisse = new Set();

function saveRailDeplie() {
  try { localStorage.setItem(railKey(), JSON.stringify([...railDeplie])); } catch (_) {}
}

// QUELLES ÉTAPES SONT VIDES, en une chaîne. Le rail se monte AVANT l'arrivée
// des compteurs (loadCounts les pose ensuite sur place) : sans cette empreinte,
// le repli était calculé sur des compteurs tous à zéro et repliait la totalité
// du rail — 33 lignes devenaient 11, dont aucune ne portait le travail du jour.
// On ne repeint donc pas à chaque rafraîchissement, mais quand la carte des
// vides a VRAIMENT changé.
function empreinteDesVides() {
  const out = [];
  for (const f of FAMILIES) {
    for (const sub of (SUB_STAGES[f.slug] || [])) {
      if ((counts[sub.slug] ?? 0) === 0) out.push(sub.slug);
    }
  }
  return out.join(',');
}
let videsMontees = null;

// Les sous-étapes d'une phase, avec celles qu'on replie marquées. Rend la liste
// à AFFICHER et le nombre de repliées — le rendu n'a plus qu'à poser.
function replierLesVides(famille, sousEtapes) {
  if (railDeplie.has(famille) || railGlisse.has(famille)) {
    return { visibles: sousEtapes, repliees: 0 };
  }
  const cachables = sousEtapes.filter((sub) => {
    const n = counts[sub.slug] ?? 0;
    if (n > 0) return false;
    // L'étape OUVERTE ne se replie pas, même vide : on doit voir où on est.
    return !(currentStage === famille && currentSub === sub.slug);
  });
  if (cachables.length < REPLI_MINIMUM) return { visibles: sousEtapes, repliees: 0 };
  const aCacher = new Set(cachables.map((s) => s.slug));
  return {
    visibles: sousEtapes.filter((s) => !aCacher.has(s.slug)),
    repliees: aCacher.size,
  };
}

// La ligne qui replie ou déplie une phase. Elle porte le MÊME gabarit qu'une
// étape (même hauteur, même colonne de compteur) : le rail garde son rythme.
function ligneDeRepli(famille, repliees) {
  const deplie = railDeplie.has(famille);
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'stage stage-repli';
  // La phase qu'elle replie — c'est par là qu'un glisser vient l'ouvrir.
  // JAMAIS `data-slug` : ce n'est pas une étape, et une cible de dépôt sans
  // étape enverrait un PATCH `stage: undefined`.
  el.dataset.repli = famille;
  el.textContent = deplie ? 'Masquer les étapes vides' : `+ ${repliees} étape${repliees > 1 ? 's' : ''} vide${repliees > 1 ? 's' : ''}`;
  el.setAttribute('aria-expanded', String(deplie));
  attachTip(el, deplie
    ? 'Ne montrer que les étapes qui portent un dossier'
    : 'Montrer toute la structure de cette phase');
  el.addEventListener('click', () => {
    if (deplie) railDeplie.delete(famille); else railDeplie.add(famille);
    saveRailDeplie();
    renderSidebar();
  });
  return el;
}

// LA POIGNÉE D'UNE PHASE. Un bouton À PART, pas un coin du titre : le titre est
// déjà une commande (il montre toute la phase) ET une cible de dépôt. Lui faire
// porter un second geste, c'est exactement le défaut qui a éteint le glisser des
// lignes le mois dernier — deux gestes sur un sélecteur, et le second gagne.
//
// Elle ne s'affiche QUE sur une phase qui a des étapes : plier « À trier », qui
// n'a que son titre, ne masquerait rien.
function poignéeDeZone(famille, plieee) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'zone-plier';
  b.dataset.zone = famille;
  b.setAttribute('aria-expanded', String(!plieee));
  b.setAttribute('aria-label', plieee ? 'Déplier cette phase' : 'Replier cette phase');
  b.textContent = plieee ? '\u25B8' : '\u25BE';
  attachTip(b, plieee ? 'Déplier cette phase' : 'Replier cette phase');
  b.addEventListener('click', () => {
    if (plieee) railZonesPliees.delete(famille); else railZonesPliees.add(famille);
    saveZonesPliees();
    renderSidebar();
  });
  return b;
}

// L'AGENDA DES RETRAITS, EN TÊTE DU RAIL (03/09/2026)
// ---------------------------------------------------------------------------
// Le rail range le planning par ÉTAPE — où en est le travail. L'agenda le range
// par JOUR — qui passe le prendre, et quand. C'est la même liste vue par
// l'autre bout, donc sa porte est ici, là où la vendeuse choisit déjà ses
// listes, et pas dans la barre du haut (pleine, voir HASH_AGENDA).
//
// ELLE PREND LE GABARIT D'UNE ÉTAPE — même boîte, même rembourrage, même
// arrondi — parce que le rail doit garder UN rythme : deux hauteurs dans la
// même colonne se voient tout de suite. Mais elle n'en est pas une, et elle le
// dit : ni puce, ni compteur, et surtout PAS de `data-slug`, sans quoi elle
// deviendrait cible de dépôt et une commande lâchée dessus partirait en PATCH
// `stage: undefined` (le piège que la ligne de repli a déjà payé).
//
// C'EST UN LIEN, pas un bouton : il mène à une adresse, donc il s'ouvre dans un
// nouvel onglet à la molette comme les huit autres écrans.
function entreeAgenda() {
  const bloc = document.createElement('div');
  bloc.className = 'stage-epingle';
  const a = document.createElement('a');
  a.className = 'stage stage--agenda';
  a.href = HASH_AGENDA;
  const label = document.createElement('span');
  label.className = 'stage-label';
  label.textContent = 'Agenda des retraits';
  a.append(label);
  if (viewMode === 'agenda') {
    a.classList.add('active');
    a.setAttribute('aria-current', 'page');
  }
  attachTip(a, 'Qui vient chercher quoi — aujourd’hui, demain, après');
  bloc.append(a);
  return bloc;
}

function renderSidebar() {
  $stages.replaceChildren();
  $stages.appendChild(entreeAgenda());
  // Chaque FAMILLE est une ZONE : un grand titre (en-tête) qui coiffe ses
  // sous-catégories. On enveloppe le tout dans un bloc pour que l'œil isole d'un
  // coup une zone de la suivante (miroir de la « Vue Étapes » du CRM : total
  // famille + détail par sous-étape). Les catégories promues en onglet (voir
  // PROMOTED) n'y figurent plus : leur place est dans la barre du haut.
  FAMILIES.filter((f) => !RAIL_HIDDEN_STAGES.has(f.slug)).forEach((f) => {
    const zone = document.createElement('div');
    zone.className = 'stage-zone';
    // La phase se NOMME : c'est par ce data-fam que la palette (charte.css)
    // pose les cinq rôles de couleur — rail, titre, pastille, chiffre, actif.
    zone.dataset.fam = f.slug;
    const hasSub = familyHasSub(f.slug);
    if (hasSub) zone.classList.add('has-sub');
    // Le filet vertical coloré à gauche de chaque phase a été RETIRÉ le 25/08 :
    // la couleur de phase se lit déjà sur le titre, sur les puces et sur les
    // pastilles de compteur. Une quatrième fois, en barre pleine hauteur, ne
    // disait rien de plus et refermait le rail sur la gauche.
    const corps = document.createElement('div');
    corps.className = 'zone-corps';
    const head = buildStageEl(f);
    head.classList.add('zone-head'); // le grand titre se lit comme un en-tête de zone
    // LA TÊTE EST UNE RANGÉE : le titre, et la poignée qui plie la phase. Deux
    // boutons côte à côte, sur le même bandeau — jamais un bouton dans un
    // bouton, que le navigateur ne rend pas et que le clavier ne sait pas
    // atteindre.
    const pliee = hasSub && railZonesPliees.has(f.slug);
    const tete = document.createElement('div');
    tete.className = 'zone-tete';
    tete.appendChild(head);
    if (hasSub) tete.appendChild(poignéeDeZone(f.slug, pliee));
    corps.appendChild(tete);
    if (hasSub && !pliee) {
      const toutes = SUB_STAGES[f.slug]
        .filter((sub) => !RAIL_HIDDEN_SUBS.has(sub.slug));  // promue en onglet
      const { visibles, repliees } = replierLesVides(f.slug, toutes);
      visibles.forEach((sub) => corps.appendChild(buildStageEl(f, sub)));
      // La ligne de repli ferme la phase, dépliée comme repliée : même place,
      // même hauteur. Elle n'apparaît que s'il y a quelque chose à replier.
      if (repliees > 0 || railDeplie.has(f.slug)) {
        corps.appendChild(ligneDeRepli(f.slug, repliees));
      }
    }
    zone.append(corps);
    $stages.appendChild(zone);
  });
}

// L'ENTRÉE D'UNE ÉTAPE — UN SEUL MOUVEMENT, ET IL NE DÉPLACE RIEN.
// Douze lignes glissaient chacune de 5 px, décalées de 22 ms : une ondulation
// de 414 ms qui démarrait APRÈS que la liste avait déjà changé de hauteur.
// Trois mouvements pour un seul clic (effondrement, remplissage, ondulation) —
// c'est ce que Charlie appelait « ça rebondit ». Le fondu porte désormais sur
// LA LISTE, une fois, et sur la seule opacité : le compositeur l'anime sans
// repasser par la mise en page, une étape de 400 lignes ne coûte donc rien.
let stageEnterTimer = null;
function playStageEnter() {
  const host = modeCartes() ? $cards : $rows;
  if (!host) return;
  // Qui a demandé le calme ne voit rien bouger — et surtout ne se retrouve pas
  // avec une liste bloquée à l'opacité de départ si le minuteur saute.
  if (mouvementReduit()) return;
  host.classList.remove('liste-entre');
  void host.offsetWidth; // relance l'animation CSS
  host.classList.add('liste-entre');
  clearTimeout(stageEnterTimer);
  stageEnterTimer = setTimeout(() => host.classList.remove('liste-entre'), 500);
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
  // Les bannières de lot ne sont ni dans `rowEls` ni dans `cardEls` : sans
  // cette ligne, l'en-tête d'un ticket survivait au vidage et coiffait les
  // commandes d'une AUTRE famille — en désignant le mauvais client.
  nettoyerBandes(new Set());
  rows = [];
  lastRendered = [];
  lastRowsSig = '';
  $stageCount.textContent = '';
  $empty.hidden = true; // pas de « Aucune commande » pendant le chargement
}

// Surbrillance du rail : une seule entrée active à la fois (famille OU sous-cat).
//
// `[data-slug]` ET PAS `.stage` : deux entrées du rail portent la classe sans
// être des étapes — la ligne de repli et l'agenda des retraits. Prises dans
// cette boucle, elles se faisaient ÉTEINDRE à chaque repeinture (leur slug
// valant `undefined`, aucune ne correspond jamais à l'étape courante) : l'agenda
// perdait sa surbrillance dès le premier rafraîchissement, alors qu'il est
// l'écran affiché.
function paintSidebarActive() {
  let active = null;
  document.querySelectorAll('.stage[data-slug]').forEach((el) => {
    const isSub = el.dataset.sub != null;
    const on = isSub
      ? (el.dataset.slug === currentStage && el.dataset.sub === currentSub)
      : (el.dataset.slug === currentStage && (el.dataset.sub != null ? false : currentSub === null));
    el.classList.toggle('active', on);
    if (on) { active = el; el.setAttribute('aria-current', 'true'); }
    else el.removeAttribute('aria-current');
  });
  montrerEtapeActive(active);
}

// LE RAIL DOIT MONTRER OÙ L'ON EST. Il fait 1 858 px pour 679 px de hauteur
// visible sur la tablette : il défile. Or on n'arrive pas toujours dans le
// pipeline en cliquant dessus — la recherche globale, le Point du jour et le
// comptoir ouvrent une étape directement. Mesuré : arrivé sur « Archivé », la
// seule entrée allumée du rail se trouvait 1 100 px SOUS la zone visible.
// L'employé voyait donc la bonne liste au-dessus d'un rail qui ne désignait
// rien, et n'avait aucun moyen de savoir à quelle étape du pipeline il était.
//
// `block: 'nearest'` : le plus petit déplacement qui la rend visible — une
// entrée déjà à l'écran ne bouge pas d'un pixel, et le rail ne se recentre pas
// à chaque repeinture.
function montrerEtapeActive(el) {
  if (!el) return;
  // JAMAIS pendant un glisser : les entrées du rail sont alors les cibles de
  // dépose, et les faire coulisser sous le doigt ferait atterrir la commande
  // dans l'étape voisine.
  if (dragState) return;
  el.scrollIntoView({ block: 'nearest', behavior: mouvementReduit() ? 'auto' : 'smooth' });
}

// Nom accessible d'une entrée du rail : le libellé ET son compteur, pour qu'un
// lecteur d'écran annonce « À chiffrer — 9 commandes » d'un seul tenant.
/* Le chiffre d'un compteur : rien du tout à zéro (refonte du 24/08 — « aucune
   pastille et aucun zéro »), le nombre sinon. L'aria-label, lui, dit toujours
   le vrai compte, zéro compris (syncStageLabel). */
function poserCompte(c, n) {
  c.textContent = n > 0 ? n : '';
  c.classList.toggle('has-items', n > 0);
}
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
  // LE RAIL EST À L'ÉCRAN PARTOUT depuis le 24/08 : on peut donc cliquer une
  // étape depuis le Point du jour, la Base clients, les Réglages ou un parcours
  // du comptoir. La grille du planning n'y est pas affichée — sans ce saut, le
  // clic chargeait une étape que personne ne voyait, et le rail avait l'air
  // mort. Le hash reste le seul pilote de la vue (voir applyHash).
  // Une étape du rail n'est JAMAIS une catégorie promue (elles en sont retirées,
  // voir RAIL_HIDDEN_STAGES / RAIL_HIDDEN_SUBS) : le `applyHash` qui suit ne
  // peut donc pas « corriger » vers FAMILIES[0] par-dessus ce qu'on vient de
  // choisir — c'est le piège du 06/08, et il ne se rouvre pas ici.
  if (!isPlanningMode(viewMode)) { location.hash = '#planning'; return; }
  // Onglet promu (Fiverr, À commander) : la grille montre SA catégorie, pas
  // celle qu'on vient de cliquer dans le rail.
  const promoted = PROMOTED_BY_VIEW[viewMode];
  if (!promoted || (promoted.stage === slug && promoted.sub === sub)) return;
  location.hash = '#planning';
}

// Libellé d'en-tête : la sous-catégorie si l'une est active, sinon la famille.
function currentViewLabel() {
  if (currentSub && SUB_LABEL[currentSub]) return SUB_LABEL[currentSub];
  return STAGE_LABEL[currentStage];
}

// LA LISTE QU'ON VIENT DE DEMANDER COMMENCE EN HAUT.
// Changer de FAMILLE vidait la grille : sa hauteur s'effondrait et le
// navigateur ramenait le défilement à zéro tout seul. Changer de SOUS-ÉTAPE
// passe par le chemin rapide (les lignes de la famille sont déjà en mémoire, on
// ne fait que re-filtrer) : la position de défilement, elle, ne bougeait pas.
// Mesuré : depuis « Production » déroulée à 2 500 px, un tap sur « Production
// DTF » laissait la liste à 510 px — les cinq premières commandes de l'étape
// demandée naissaient AU-DESSUS de l'écran. C'est le geste le plus fréquent de
// la journée, et il donnait à chaque fois l'impression d'avoir raté sa cible.
//
// `auto` et non `smooth` : on ne fait pas voyager l'employé à travers une liste
// qu'il vient de quitter. Le contenu change en même temps — la liste est
// simplement DÉJÀ en haut quand elle apparaît.
function remonterLaListe() {
  const wrap = document.querySelector('.grid-wrap');
  if (wrap && wrap.scrollTop > 0) wrap.scrollTo({ top: 0, behavior: 'auto' });
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
  updateFiverrTool(slug);
  paintSidebarActive();
  // Changer de sous-catégorie DANS la même famille ne recharge rien : les lignes
  // de la famille sont déjà en mémoire, on ne fait que re-filtrer (instantané).
  if (sameFamily && lastRowsSig !== '' && !forcerRelecture) {
    applySortAndRender();
    remonterLaListe();
    playStageEnter();
    return;
  }
  // « Tout afficher » vaut pour L'ÉTAPE où on l'a demandé : on ne traîne pas
  // l'historique complet de la clôture derrière soi en changeant de famille.
  if (!sameFamily) { plafondListe = PALIER_LISTE; listeTronqueeA = 0; listeTotal = 0; renderListeSuite(); }
  // ON NE VIDE PLUS AVANT D'AVOIR LA SUITE. `clearGrid()` posé ICI démontait
  // toutes les lignes puis attendait le réseau : le contenu défilable tombait
  // de 3 718 px à 781 px, l'ascenseur sautait en pleine hauteur, et il
  // remontait à 2 992 px quand la réponse arrivait. Mesuré à 24 ms en local —
  // mais c'est la DURÉE DE LA REQUÊTE en atelier, un demi-seconde d'écran
  // effondré. C'est ce que Charlie appelait « la page rebondit ».
  // La liste sortante reste donc à l'écran, éteinte et injouable, et le rendu
  // suivant la remplace en place : la hauteur ne passe jamais par zéro.
  if (!sameFamily) {
    // LA DONNÉE EST PÉRIMÉE DÈS LE CLIC, même si les lignes restent à l'écran.
    // C'est `clearGrid()` qui remettait cette signature à zéro : sans elle, un
    // clic sur une sous-étape PENDANT le chargement reprenait le raccourci
    // « même famille » et redessinait les lignes de la famille PRÉCÉDENTE,
    // filtrées par une sous-étape qui ne leur appartient pas.
    lastRowsSig = '';
    marquerEnAttente(true);
  }
  try {
    await loadRows();
  } catch (_) {
    // Wi-Fi coupé une seconde : la grille restait VIDE et muette, sans le
    // moindre message — le même symptôme visuel qu'une panne grave. On le dit,
    // et le temps réel remettra les lignes dès que la liaison revient.
    if (currentStage === slug) {
      // ICI, oui, on vide : garder les lignes de la famille PRÉCÉDENTE sous le
      // titre de la nouvelle serait un mensonge, et le message ne se lirait pas.
      clearGrid();
      $empty.hidden = false;
      $empty.textContent = 'Connexion perdue — les commandes réapparaîtront dès le retour du réseau.';
      showToast('Chargement impossible : vérifie la connexion.');
    }
    return;
  } finally {
    if (currentStage === slug) marquerEnAttente(false);
  }
  // Anime l'entrée des VRAIES lignes, seulement si cette sélection est toujours
  // celle affichée (un clic plus récent a pu prendre le relais entre-temps).
  if (currentStage === slug) { remonterLaListe(); playStageEnter(); }
}

// L'ATTENTE NE SE VOIT QUE SI ELLE DURE. La classe est posée tout de suite, mais
// le fondu qui l'accompagne porte un `transition-delay` (voir styles.css) : une
// réponse en 30 ms ne fait donc RIEN clignoter, et seule une vraie attente
// éteint la liste sortante. Pas de minuteur à armer ni à annuler.
// `pointer-events: none` va avec : on ne doit pas pouvoir ouvrir, du bout du
// doigt, une commande de la famille qu'on vient de quitter.
function marquerEnAttente(on) {
  const wrap = document.querySelector('.grid-wrap');
  if (wrap) wrap.classList.toggle('en-attente', !!on);
  if ($rows) $rows.setAttribute('aria-busy', on ? 'true' : 'false');
}

// --- Chargement données ----------------------------------------------------
async function loadCounts() {
  counts = await api('GET', '/api/counts');
  // `[data-slug]` : la ligne de repli et l'agenda des retraits empruntent la
  // classe `.stage` sans être des étapes. Comptées ici, elles héritaient d'un
  // « 0 » — donc de la teinte « étape vide » — et d'un nom accessible qui
  // annonçait « Agenda des retraits — 0 commandes ».
  document.querySelectorAll('.stage[data-slug]').forEach((el) => {
    // Sous-catégorie → compteur par sous-slug ; famille → total famille.
    const key = el.dataset.sub != null ? el.dataset.sub : el.dataset.slug;
    const n = counts[key] ?? 0;
    const c = el.querySelector('.stage-count');
    if (c) poserCompte(c, n);
    el.classList.toggle('is-empty', n === 0);
    syncStageLabel(el, n);
  });
  // LE REPLI DÉPEND DES COMPTEURS, et les compteurs arrivent APRÈS le rail.
  // On le repeint quand la liste des étapes vides a changé — pas à chaque
  // rafraîchissement : reconstruire le rail à chaque évènement du flux lui
  // ferait perdre le survol et l'onde du clic en cours.
  const empreinte = empreinteDesVides();
  if (empreinte !== videsMontees) {
    videsMontees = empreinte;
    renderSidebar();
  }
}

// Jeton de chargement : deux clics rapides lancent deux fetch ; on ne monte QUE la
// réponse de la sélection la plus récente. Sinon une requête lente (ancienne famille)
// pourrait écraser une famille sélectionnée depuis → « bug d'affichage » à l'arrivée.
let loadToken = 0;

// LA LISTE N'EST PAS TOUJOURS ENTIÈRE. Aucune commande ne quitte le planning :
// « Paiement & clôture » garde tout l'historique, et monter des milliers de
// lignes dans la page finit par figer la tablette.
//
// ON EN DEMANDE DONC UN PALIER À LA FOIS. « Tout afficher » sautait d'un coup à
// l'archive complète : mille deux cents lignes montées dans la page, et un
// planning qui reste lourd pour le reste de la journée — alors qu'on cherchait
// UNE commande. Le bouton en ajoute maintenant quatre cents, autant de fois
// qu'il le faut, et l'employé voit combien il en reste.
// Le palier retombe dès qu'on change d'étape : l'historique d'une étape ne
// regarde pas la suivante.
const PALIER_LISTE = 400;
let plafondListe = PALIER_LISTE;
let listeTronqueeA = 0;   // 0 = on a bien tout ; sinon le nombre affiché
let listeTotal = 0;       // combien l'étape en compte en tout (quand c'est coupé)

function urlListe(slug) {
  return `/api/requests?stage=${encodeURIComponent(slug)}&max=${plafondListe}`;
}

// Même chose qu'`api('GET', …)`, mais on garde les en-têtes qui disent si le
// serveur a coupé, et à combien. Le corps reste un simple tableau : rien
// d'autre n'a besoin de changer.
async function chargerListe(url) {
  const res = await fetchBorne(url);
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).error || detail; } catch (_) {}
    throw new Error(detail);
  }
  const plafond = Number(res.headers.get('X-Liste-Tronquee') || 0);
  const total = Number(res.headers.get('X-Liste-Total') || 0);
  return {
    lignes: await res.json(),
    plafond: Number.isFinite(plafond) ? plafond : 0,
    total: Number.isFinite(total) ? total : 0,
  };
}

function renderListeSuite() {
  const bloc = document.getElementById('listeSuite');
  if (!bloc) return;
  bloc.hidden = !listeTronqueeA;
  if (!listeTronqueeA) return;
  const texte = document.getElementById('listeSuiteTexte');
  // On dit ce qu'on montre ET sur combien : « 400 des 1 200 » se lit d'un coup
  // d'œil, là où « 400 affichées » laissait croire qu'il en manquait peut-être
  // deux. Sans le total (vieux serveur), on s'en tient à ce qu'on sait.
  if (texte) {
    texte.textContent = listeTotal > listeTronqueeA
      ? `${listeTronqueeA} des ${listeTotal} commandes — les plus récentes.`
      : `${listeTronqueeA} commandes les plus récentes affichées.`;
  }
  const btn = document.getElementById('listeSuiteTout');
  if (btn && !btn.disabled) {
    const reste = listeTotal > listeTronqueeA ? listeTotal - listeTronqueeA : 0;
    btn.textContent = reste && reste <= PALIER_LISTE
      ? `Afficher les ${reste} dernières`
      : `Afficher ${PALIER_LISTE} de plus`;
  }
}

(function () {
  const btn = document.getElementById('listeSuiteTout');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const avant = plafondListe;
    plafondListe += PALIER_LISTE;
    btn.disabled = true;
    btn.textContent = 'Chargement…';
    try {
      await loadRows();
    } catch (err) {
      // Échec : on ne laisse pas l'employé devant un bouton qui a l'air d'avoir
      // marché. Il redevient cliquable, et la liste courte reste à l'écran.
      plafondListe = avant;
      reportError(err);
    } finally {
      btn.disabled = false;
      renderListeSuite();
    }
  });
}());

async function loadRows() {
  const slug = currentStage;
  const token = ++loadToken;
  const { lignes: data, plafond, total } = await chargerListe(urlListe(slug));
  if (token !== loadToken || slug !== currentStage) return; // sélection dépassée
  rows = data;
  listeTronqueeA = plafond;
  listeTotal = total;
  renderListeSuite();
  lastRowsSig = signature(rows);
  // La mention « vide ici » du rail dépend de l'étape : elle se recalcule ici.
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
  if (c) poserCompte(c, n);
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
//
// On n'envoie QUE l'étape qu'on vient de ranger (ou de dé-ranger). Envoyer la
// liste entière revenait à imposer aux autres postes la vision qu'on avait
// AVANT leur geste : une vendeuse rangeait « Production », une autre rangeait
// « Demande & chiffrage » dans la même minute, et la seconde effaçait la
// décision de la première — l'étape retombait en tri automatique sous les yeux
// de celle qui venait de la ranger. Le serveur fusionne, et nous renvoie la
// liste à jour : on l'adopte plutôt que de garder la nôtre.
function saveOrdreManuel(etape, range) {
  saveOrdreManuelLocal();
  return api('PUT', '/api/ordre-manuel', { etape, range }).then((liste) => {
    if (!Array.isArray(liste)) return;
    ordreManuel = new Set(liste.filter((s) => typeof s === 'string'));
    saveOrdreManuelLocal();
    renderOrdreReset();
  });
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

// `syncDrawer` a disparu avec le tiroir : la fiche atelier n'est pas dans la
// grille et un rendu de grille ne la touche pas. Elle NE SE FERME PAS non plus
// quand la commande quitte l'étape affichée — c'est le tiroir qui faisait ça, et
// ce serait exactement le contraire de ce qu'on veut ici : changer d'étape est
// le geste principal de la fiche, elle ne peut pas se refermer dessus.
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
  return regrouperLots(liste.sort(cmpAuto));
}

// LES ARTICLES D'UN MÊME TICKET RESTENT ENSEMBLE. Le tri automatique classe par
// urgence : les quatre articles d'un panier ayant chacun SA date de retrait, ils
// se retrouvaient dispersés dans la liste, un dossier étranger au milieu — et la
// bannière, qui coiffe des lignes VOISINES, se cassait en morceaux.
// Le lot prend donc la place de son article le plus urgent (le premier que le
// tri a rencontré), et à l'intérieur ses lignes suivent l'ordre du TICKET : ce
// que la vendeuse a saisi, ce que le client a sous les yeux sur son papier.
// Ne s'applique QU'AU TRI AUTOMATIQUE : une étape rangée à la main garde son
// ordre, y compris si quelqu'un a délibérément sorti un article de son groupe.
function regrouperLots(liste) {
  const groupes = new Map();
  for (const r of liste) {
    const l = lotDe(r);
    if (!l) continue;
    if (!groupes.has(l.ref)) groupes.set(l.ref, []);
    groupes.get(l.ref).push(r);
  }
  if (!groupes.size) return liste;
  for (const g of groupes.values()) g.sort((a, b) => lotDe(a).rang - lotDe(b).rang);
  const posee = new Set();
  const out = [];
  for (const r of liste) {
    const l = lotDe(r);
    if (!l) { out.push(r); continue; }
    if (posee.has(l.ref)) continue;      // déjà sortie avec son groupe
    posee.add(l.ref);
    out.push(...groupes.get(l.ref));
  }
  return out;
}

function applySortAndRender() {
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
  // Plus rien en attente : la liste est entière à l'écran (voir listeMontee).
  if (!suiteRendu) marquerRenduAcheve();
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
//
// `surPlace` est l'élément qu'on vient de repeindre à la main (la puce sur
// laquelle on a appuyé). La vue qui le contient est déjà juste : la périmer la
// ferait reconstruire pour rien — et une ligne reconstruite est une ligne NEUVE,
// qui s'affiche directement à son état final. Tout le fondu de couleur qu'on
// vient de déclencher part à la poubelle avec l'ancien nœud, en même temps que
// le survol et l'onde du ripple en cours. C'est précisément ce qui faisait
// claquer les couleurs d'alerte au lieu de les fondre.
function invalidateRowCache(id, surPlace = null) {
  if (id != null) {
    const dedans = (el) => !!(surPlace && el && el.contains(surPlace));
    const entry = rowEls.get(String(id));
    if (entry && !dedans(entry.tr)) entry.sig = '';
    const carte = cardEls.get(String(id));
    if (carte && !dedans(carte.el)) carte.sig = '';
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

// Un bloc de la carte : son intitulé, puis son contenu dans UN SEUL enfant.
// Ce corps n'est pas décoratif : il donne au bloc deux rangées exactement, ce
// qui lui permet de se caler sur celles de la carte (`grid-template-rows:
// subgrid`, cf. styles.css). Sans lui, un intitulé qui passe à la ligne — « Délai
// de production restant » sur la tablette — décalait vers le bas la valeur qu'il
// coiffe, et les quatre valeurs de la carte ne se lisaient plus sur une rangée.
function pcardBloc(label, ...enfants) {
  const d = document.createElement('div');
  d.className = 'pcard__bloc';
  const l = document.createElement('p');
  l.className = 'pcard__label';
  l.textContent = label;
  const corps = document.createElement('div');
  corps.className = 'pcard__corps';
  corps.append(...enfants);
  d.append(l, corps);
  return d;
}


// `opts.coiffee` : la carte est sous une BANNIÈRE de lot, qui nomme déjà le
// client et le ticket. `opts.rangeParLeGroupe` : cette bannière porte son
// « Ranger les N ». Dans les deux cas la carte se tait — trois fois le même nom
// et trois boutons « Ranger » sur quinze centimètres, ce n'est pas de
// l'insistance, c'est du bruit.
function buildCard(r, options) {
  // Pas de valeur par défaut DANS la signature : `opts = {}` y met une paire
  // d'accolades, et les sondes qui relèvent le corps d'une fonction en comptant
  // les accolades depuis la première rencontrée s'arrêtaient net sur celle-là.
  const opts = options || {};
  const carte = document.createElement('article');
  carte.dataset.id = r.id;
  const delai = tempsRestant(r.deadline, r.fiche && r.fiche.heureSouhaitee);
  const bande = bandeUrgence(delai);
  carte.className = `pcard pcard--${bande}`;

  // 1. POUR QUI — le nom du dossier, et la référence du ticket dessous.
  const client = document.createElement('div');
  client.className = 'pcard__client';
  client.textContent = nomClientAffiche(r.billing_company, r.client_type) || 'Sans nom';
  const ref = document.createElement('div');
  ref.className = 'pcard__ref';
  ref.textContent = (r.fiche && r.fiche.ref) || '';
  // « 2/4 » COLLÉ À LA RÉFÉRENCE : la carte dit qu'elle est un article parmi
  // quatre, et lesquels. Aucune piste de grille en plus — une ligne qui
  // n'apparaîtrait que sur certaines cartes décalerait toute la file.
  const marque = lotChip(r);
  if (marque) ref.append(' ', marque);
  const lot = lotDe(r);
  // SOUS UNE BANNIÈRE, la colonne ne répète pas le client : elle dit QUEL
  // article on lit. C'est la seule chose que la bannière ne peut pas dire à sa
  // place, et la colonne garde sa largeur — la file ne se décale pas.
  const blocClient = opts.coiffee && lot
    ? pcardBloc('Article', (() => {
      const n = document.createElement('div');
      n.className = 'pcard__client';
      n.textContent = `${lot.rang} sur ${lot.total}`;
      return n;
    })())
    : (ref.textContent
      ? pcardBloc('Client', client, ref)
      : pcardBloc('Client', client));

  // 2. QUOI — la description, puis les deux puces qui situent la commande.
  const nom = document.createElement('div');
  nom.className = 'pcard__name';
  // LE MÊME TITRE QUE DANS LE TABLEAU, quantité comprise (voir nomArticle).
  if (!nomArticle(r, nom).texte) nom.textContent = 'Sans description';
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
  // À TRIER : à la place de la puce qui SITUE, le bouton qui RANGE.
  // Même emplacement, même gabarit — la file ne se décale pas d'un pixel.
  // NI LE BOUTON NI LA PUCE quand la bannière du lot range déjà les articles
  // ensemble : elle dit le geste ET la destination, à deux centimètres
  // au-dessus. Trois boutons « Ranger » l'un sous l'autre pour un seul geste
  // utile, puis « À trier » répété sur l'écran « À trier » — c'était deux fois
  // du bruit pour rien.
  if (!opts.rangeParLeGroupe) {
    meta.appendChild(r.stage === A_TRIER && currentStage === A_TRIER
      ? boutonRanger(r)
      : puce(r.stage === currentStage
        ? (SUB_LABEL[r.sub_stage] || (familyHasSub(r.stage) ? 'à préciser' : STAGE_LABEL[r.stage]))
        : stageDestinationLabel(r.stage, r.sub_stage ?? null)));
  }
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
  // « À TERMINER AVANT ven. 28/08 18h00 » A QUITTÉ LA CARTE. C'est le MÊME
  // instant que le décompte juste au-dessus, écrit en absolu — et il portait
  // une seconde date (28/08) à côté de la promesse client (29/08) sans qu'un
  // mot n'explique laquelle des deux compte. Trois lignes pour une échéance.
  // Elle reste à portée : au survol du décompte, et en clair dans la fiche.
  const majDelai = () => {
    const d = tempsRestant(r.deadline, r.fiche && r.fiche.heureSouhaitee);
    const b = bandeUrgence(d);
    for (const x of ['retard', 'urgent', 'calme']) carte.classList.toggle(`pcard--${x}`, x === b);
    delaiEl.className = 'pcard__delai' + (b === 'calme' ? '' : ` pcard__delai--${b}`);
    delaiEl.textContent = d.texte;
    attachTip(delaiEl, `À terminer avant ${d.echeanceTexte}`);
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
  // Le bloc référent se repeint SUR PLACE. Il se contentait d'être construit une
  // fois, si bien qu'attribuer un référent obligeait à reconstruire la carte
  // entière : la pastille sautait d'un état à l'autre sans fondu, l'onde du
  // ripple était jetée en cours de route, et sur une file de 400 cartes on
  // refaisait tout un article de DOM pour un simple appui.
  const majRefs = () => {
    const eff = nomEffectif();
    let allumee = false;
    for (const b of refs.children) {
      const on = b.dataset.employe === r.referent;
      b.classList.toggle('is-on', on);
      if (on) allumee = true;
    }
    // LE NOM NE S'ÉCRIT QUE SI AUCUNE PASTILLE NE LE DIT. Une initiale noircie
    // et « Référent : Loïc » juste dessous, c'est deux fois la même chose sur
    // deux lignes. Le nom RESTE quand il vient du réglage de la catégorie :
    // aucune pastille n'est allumée dans ce cas-là, et la carte serait muette
    // sur la seule question qui compte — qui s'en occupe.
    nomRef.hidden = allumee;
    nomRef.textContent = allumee ? '' : `Référent : ${eff.qui}`;
    nomRef.classList.toggle('is-auto', eff.auto);
    attachTip(nomRef, eff.auto
      ? 'Nom par défaut de la catégorie — appuyer sur une initiale pour en nommer un autre'
      : `Référent : ${eff.qui}`);
  };
  for (const e of EMPLOYEES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pcard__ref-btn';
    b.dataset.employe = e;
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
        // La pastille suit le doigt tout de suite. Elle ne le faisait pas : la
        // signature de la carte repose sur `updated_at`, que le serveur seul
        // fait bouger — le clic restait sans effet visible pendant un
        // aller-retour réseau, on re-tapait, et le second tap annulait tout.
        majRefs();
        // La LIGNE du tableau, elle, n'a pas été repeinte : elle se périme.
        invalidateRowCache(r.id, b);
        applySortAndRender();
      }, b);
    });
    refs.append(b);
  }
  majRefs();

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
  // LE TICKET, SUR LA LIGNE. Le client revient au comptoir avec son papier : il
  // fallait ouvrir la fiche, faire défiler, et le bouton d'impression sortait
  // alors le dossier de travail sur une feuille A4. Il est ici, à côté de
  // « ouvrir » — un appui, le ticket s'affiche, un second l'imprime.
  //
  // SUR TOUTES LES LIGNES. Le bouton ne paraissait que sur les dossiers nés au
  // comptoir — c'était logique tant qu'il sortait le papier du CLIENT : une
  // ligne tapée à la main n'en avait jamais eu. Depuis qu'il sort le papier de
  // l'ATELIER, la question n'est plus « d'où vient ce dossier » mais « qui va le
  // produire » : une ligne saisie à la main se fabrique comme les autres, et son
  // ticket se bâtit sur ce que la ligne sait (cf. modeleTicket).
  // LES DEUX PAPIERS ET « OUVRIR » SONT PARTIS (28/08) — dans les deux vues à
  // la fois : la carte et la ligne doivent donner le même geste, et ce geste
  // est maintenant le CLIC sur la carte elle-même (voir `ouvrirAuClic`).
  actions.append(prise, suppr);

  // « Délai restant » et non « Délai de production restant » : les intitulés
  // forment UNE rangée partagée (cf. .pcard__bloc), donc le plus long les
  // grandit tous. Sur la tablette, sa colonne fait ~112 px : les trois lignes
  // qu'il y prenait coûtaient 44 px de haut à CHAQUE carte, soit deux commandes
  // de moins par écran. Le bloc dit déjà « Remise client » et « À terminer
  // avant » juste en dessous : il n'y a pas d'autre délai possible.
  // LE PRIX N'EST PAS OBLIGATOIRE SUR LA LIGNE. À l'atelier il n'apprend rien
  // et prend la place de ce qu'on cherche ; le bloc, lui, RESTE — il porte les
  // référents, et la carte est une grille à cinq colonnes : en retirer un
  // décalerait les actions de toutes les cartes. C'est l'intitulé qui dit ce
  // que le bloc montre.
  const prixVisible = !hiddenCols.has('price');
  // Ce qu'il y a à produire se lit sous le nom du dossier, avant les pastilles
  // d'état : c'est la réponse à « QUOI », pas une décoration de l'étape.
  // « MANQUE » EST LA CINQUIÈME LIGNE DE LA FICHE, pas une rangée à part : on
  // lit ce qu'il y a à produire (réf, marquage, tailles, logos), puis ce qui
  // empêche de le faire. La conclusion vient après les faits — et c'est aussi
  // ce qui aligne les cinq intitulés dans une seule colonne.
  const quoi = [nom, blocProduction(r, hiddenCols), hiddenCols.has('feu') ? null : blocFeu(r, attachTip), meta, motif]
    .filter(Boolean);
  carte.append(
    blocClient,
    pcardBloc('Projet', ...quoi),
    pcardBloc('Délai restant', delaiEl, remise),
    prixVisible
      ? pcardBloc('TTC', montant, refs, nomRef)
      : pcardBloc('Référent', refs, nomRef),
    actions,
  );

  // LA CARTE S'OUVRE QUAND ON LA TOUCHE. Elle fait 146 px de haut et ne
  // répondait que sur quatre pastilles de 44 px, tout à droite : viser le
  // dossier lui-même — le geste que tout le monde essaie d'abord — ne faisait
  // rien du tout. Le corps de la carte ouvre donc la fiche, exactement comme le
  // bouton « ouvrir » qu'il double.
  //
  // Aucun risque d'ouverture pendant un DÉFILEMENT : le navigateur n'émet pas
  // de `click` quand le doigt a fait glisser la liste. Reste le GLISSER de la
  // carte, lui suivi à la main — d'où la garde ci-dessous.
  ouvrirAuClic(carte, r);

  // La carte se glisse sur le rail pour changer d'étape, comme une ligne du
  // tableau. On saisit la carte elle-même : elle n'a pas de poignée, tout son
  // fond est zone de prise (hors boutons, qui arrêtent l'évènement).
  carte.classList.add('pcard__grip');
  attachDrag(carte, carte, r);
  return carte;
}

// --- Réordonnancement animé (FLIP) ------------------------------------------
// Changer une priorité ou une échéance DÉPLACE la commande dans la file. Jusque
// là elle se téléportait : entre deux images, la ligne n'était plus au même
// endroit, et celles qu'elle pousse non plus. À l'atelier, on relisait l'écran
// pour retrouver ce qu'on venait de toucher.
//
// On mesure donc où chaque ligne se trouve AVANT de la déplacer, puis on la
// ramène visuellement à son point de départ pour la laisser glisser jusqu'à sa
// nouvelle place. Rien que du `transform` : ni relayout ni repaint, le
// compositeur suffit — c'est ce qui tient les 60 images/seconde sur la tablette.
const DUREE_REORDRE = 220;

// Interrogé à chaque rendu qui réordonne : on garde la requête média une fois
// pour toutes plutôt que d'en créer une neuve à chaque fois.
const REQUETE_MOUVEMENT = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const mouvementReduit = () => !!(REQUETE_MOUVEMENT && REQUETE_MOUVEMENT.matches);

// Est-ce que la mise en ordre va réellement bouger quelque chose — et combien ?
// La plupart des rendus ne déplacent rien (une valeur change, l'ordre tient) :
// on évite alors les deux mesures de position, qui forcent chacune un calcul de
// mise en page. Et quand PRESQUE TOUT bouge (tri par en-tête : la liste entière
// se rebat), on renvoie le compte pour que l'appelant renonce à l'animation —
// faire glisser quatre cents lignes en même temps coûte deux mises en page
// forcées d'une table complète (~200 ms figées au clic) pour un effet qui se
// lit comme du bruit, pas comme un lien.
const FLIP_MAX_DEPLACES = 16;
function ordreChange(ordre, hote) {
  let deplaces = 0;
  let prev = null;
  for (const node of ordre) {
    if (!estPrise(node)) {
      const attendu = prev ? prev.nextSibling : hote.firstChild;
      if (node !== attendu && ++deplaces > FLIP_MAX_DEPLACES) return deplaces;
    }
    prev = node;
  }
  return deplaces;
}

// On ne mesure que ce qui est à l'écran : sur une étape de 400 lignes, relever
// la position de tout le tableau coûterait plus cher que le saut qu'on efface.
function mesurerVisibles(hote) {
  const positions = new Map();
  if (!hote) return positions;
  const bas = (window.innerHeight || 800) + 200;
  for (const el of hote.children) {
    if (el.classList.contains('is-hidden')) continue;
    const y = el.getBoundingClientRect().top;
    if (y < -200 || y > bas) continue;
    positions.set(el, y);
  }
  return positions;
}

function animerReordonnancement(positions) {
  for (const [el, avant] of positions) {
    if (!el.isConnected || typeof el.animate !== 'function') continue;
    const delta = avant - el.getBoundingClientRect().top;
    // Moins d'1 px : rien n'a bougé. Plus de 2000 : la ligne vient d'ailleurs
    // (changement d'étape, filtre levé) — la faire traverser l'écran serait du
    // bruit, pas du lien.
    if (Math.abs(delta) < 1 || Math.abs(delta) > 2000) continue;
    el.animate(
      [{ transform: `translateY(${delta}px)` }, { transform: 'none' }],
      { duration: DUREE_REORDRE, easing: 'cubic-bezier(.2, 0, 0, 1)' },
    );
  }
}

// Positions à retenir avant de remettre les nœuds en ordre — `null` quand il n'y
// a rien à animer (glisser en cours : le geste pilote déjà les positions à la
// main, et une animation par-dessus lutterait contre le doigt) ou quand le
// rebattement est massif (tri par en-tête : on pose le nouvel ordre d'un coup).
function avantReordonnancement(ordre, hote) {
  if (dragState || mouvementReduit()) return null;
  const deplaces = ordreChange(ordre, hote);
  if (deplaces === 0 || deplaces > FLIP_MAX_DEPLACES) return null;
  return mesurerVisibles(hote);
}

// ===========================================================================
// LE FIL PRINCIPAL NE SE BLOQUE PLUS POUR CONSTRUIRE UNE LISTE
// ===========================================================================
// Ouvrir « Paiement & clôture » monte 400 lignes d'un coup ; retrouver une
// commande archivée par la recherche lève le plafond et en monte plus de mille.
// Chacune coûte une quarantaine de nœuds, ses écouteurs, ses infobulles et son
// calcul d'heures ouvrées. Mesuré sur 1 200 commandes : UNE SEULE tâche d'une
// seconde sur un ordinateur de bureau — donc plusieurs secondes sur la tablette
// de l'atelier, pendant lesquelles RIEN ne répond : ni le défilement, ni un tap,
// ni la barre de recherche. C'est le « ça rame » que l'on voit encore.
//
// On construit donc une première tranche — largement de quoi remplir l'écran —
// puis on rend la main au navigateur avant de poser la suivante. L'employé a sa
// liste tout de suite et peut s'en servir pendant que la fin se pose derrière.
// Les lignes déjà montées ne comptent pas dans la tranche : un rafraîchissement
// ordinaire (une valeur qui change) reste, comme avant, en un seul passage.
const TRANCHE_RENDU = 40;
let suiteRendu = null;

// LA LISTE EST-ELLE ENTIÈREMENT MONTÉE ? Presque tout se moque de la réponse —
// on défile, on tape, on lit. Mais pointer une commande retrouvée par la
// recherche a besoin que SA ligne existe, et elle peut être à la millième
// place : sans cette attente, l'écran conclurait « cette commande n'est plus à
// cette étape » alors qu'elle est simplement en train de se poser.
let rendreFini = null;
let listeMontee = Promise.resolve();

function marquerRenduEnCours() {
  if (rendreFini) return;
  listeMontee = new Promise((resoudre) => { rendreFini = resoudre; });
}

function marquerRenduAcheve() {
  if (!rendreFini) return;
  const resoudre = rendreFini;
  rendreFini = null;
  resoudre();
}

function planifierSuiteRendu() {
  marquerRenduEnCours();
  if (suiteRendu) return;
  // `setTimeout` et non `requestAnimationFrame` : sur un onglet en arrière-plan
  // (tablette écran éteint), rAF est mis en pause et la liste resterait à
  // moitié montée jusqu'au retour — or c'est justement là qu'on a le temps.
  suiteRendu = setTimeout(() => {
    suiteRendu = null;
    // On repart de la liste DÉJÀ triée. Repasser par `applySortAndRender`
    // referait le tri ET le filtre à chaque tranche — le prix fixe de la liste
    // entière, autant de fois qu'il y a de tranches. Et l'ordre pourrait
    // changer au milieu du remplissage, sous les yeux de l'employé.
    // Le tiroir n'est pas resynchronisé non plus : il porte peut-être une
    // correction en cours de saisie, et la suite du rendu ne le concerne pas.
    renderRows(lastRendered);
    if (!suiteRendu) marquerRenduAcheve();
    applySearchAndCounts();
  }, 0);
}

function renderCards(data) {
  const voulus = new Set(data.map((r) => String(r.id)));
  for (const [id, entry] of cardEls) {
    if (!voulus.has(id)) { entry.el.remove(); cardEls.delete(id); }
  }
  const bandes = bandesDeLot(data);
  const debutBande = new Map(bandes.map((b) => [b.debut, b]));
  nettoyerBandes(new Set(bandes.map((b) => b.ref)));
  // CE QUE LA BANNIÈRE DIT DÉJÀ, LA CARTE NE LE RÉPÈTE PAS : le nom du client,
  // le numéro de ticket, le bouton qui range. La SIGNATURE le porte — sans ça
  // une carte sortie de son groupe garderait l'en-tête d'un groupe qu'elle
  // vient de quitter jusqu'au prochain aller-retour serveur.
  const coiffees = new Map();
  for (const b of bandes) {
    const groupe = bandeRangeable(b);
    for (const l of b.lignes) coiffees.set(String(l.id), groupe);
  }
  const ordre = [];
  let budget = TRANCHE_RENDU;
  let reste = false;
  for (let idx = 0; idx < data.length; idx += 1) {
    const r = data[idx];
    if (debutBande.has(idx)) ordre.push(noeudBandeLot(debutBande.get(idx), true));
    const id = String(r.id);
    const coiffee = coiffees.has(id);
    const opts = { coiffee, rangeParLeGroupe: coiffees.get(id) === true };
    const sig = `${r.id}:${r.updated_at}:${coiffee ? 'b' : ''}${opts.rangeParLeGroupe ? 'g' : ''}`;
    let entry = cardEls.get(id);
    if (!entry) {
      if (budget <= 0) { reste = true; break; }
      budget -= 1;
      entry = { el: buildCard(r, opts), sig };
      cardEls.set(id, entry);
    } else if (entry.sig !== sig && !estPrise(entry.el)) {
      if (budget <= 0) { reste = true; break; }
      budget -= 1;
      const el = buildCard(r, opts);
      entry.el.replaceWith(el);
      entry.el = el;
      entry.sig = sig;
    }
    ordre.push(entry.el);
  }
  // Tant que la liste se remplit, les cartes déjà posées « bougent » à chaque
  // tranche : les faire glisser à chaque fois serait du bruit, pas du lien. On
  // n'anime que le passage final, celui qui range vraiment.
  const positions = reste ? null : avantReordonnancement(ordre, $cards);
  let prev = null;
  for (const node of ordre) {
    if (!estPrise(node)) {
      const attendu = prev ? prev.nextSibling : $cards.firstChild;
      if (node !== attendu) $cards.insertBefore(node, attendu);
    }
    prev = node;
  }
  if (positions) animerReordonnancement(positions);
  if (reste) planifierSuiteRendu();
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
  //    réutilisant chacune au passage. Par TRANCHES : voir TRANCHE_RENDU.
  const bandes = bandesDeLot(data);
  const debutBande = new Map(bandes.map((b) => [b.debut, b]));
  nettoyerBandes(new Set(bandes.map((b) => b.ref)));

  const order = [];
  let budget = TRANCHE_RENDU;
  let reste = false;
  for (let idx = 0; idx < data.length; idx += 1) {
    const r = data[idx];
    if (debutBande.has(idx)) order.push(noeudBandeLot(debutBande.get(idx), false));
    const id = String(r.id);
    const sig = `${r.id}:${r.updated_at}`;
    let entry = rowEls.get(id);
    if (!entry) {
      if (budget <= 0) { reste = true; break; }
      budget -= 1;
      entry = { tr: buildRow(r), sig };
      rowEls.set(id, entry);
    } else if (entry.sig !== sig && !isRowBusy(entry.tr)) {
      if (budget <= 0) { reste = true; break; }
      budget -= 1;
      const tr = buildRow(r);
      entry.tr.replaceWith(tr);
      entry.tr = tr;
      entry.sig = sig;
    }
    order.push(entry.tr);
  }

  // 3. Replacer tous les nœuds dans l'ordre voulu (sans déplacer une ligne en
  //    cours de drag : sa position est pilotée à la main). Les lignes qui
  //    changent de rang y glissent au lieu de sauter (cf. FLIP plus haut).
  const positions = reste ? null : avantReordonnancement(order, $rows);
  let prev = null;
  for (const node of order) {
    if (!estPrise(node)) {
      const expectedNext = prev ? prev.nextSibling : $rows.firstChild;
      if (node !== expectedNext) $rows.insertBefore(node, expectedNext);
    }
    prev = node;
  }
  if (positions) animerReordonnancement(positions);
  if (reste) planifierSuiteRendu();

  // Les notes savent maintenant si elles sont coupées : la mise en page existe.
  relireLesNotes();
  // Une ligne neuve naît dans l'ordre du gabarit : on la range comme les autres.
  appliquerOrdreColonnes();
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
    const match = !q || SEARCH_FIELDS.some((f) => fold(r[f]).includes(q)) || refsTicket(r).includes(q);
    // LE COMPTEUR PORTE SUR LA DONNÉE, pas sur ce qui est déjà monté. Une longue
    // liste se pose par tranches (voir TRANCHE_RENDU) : compter les seules
    // lignes présentes dans le DOM aurait affiché « 80 commandes », puis 160,
    // puis 240… sur un écran dont c'est justement le chiffre qu'on vient lire.
    if (match) visible++;
    const entry = cartes ? cardEls.get(String(r.id)) : rowEls.get(String(r.id));
    if (!entry) continue;
    (cartes ? entry.el : entry.tr).classList.toggle('is-hidden', !match);
  }
  // LA BANNIÈRE SUIT SES LIGNES. La recherche masque en CSS sans démonter :
  // sans cette passe, un ticket dont aucune ligne ne correspond laissait son
  // en-tête seul à l'écran, coiffant les lignes du ticket suivant.
  for (const entree of bandEls.values()) {
    const source = cartes ? cardEls : rowEls;
    const vues = entree.ids.filter((id) => {
      const e = source.get(id);
      return e && !(cartes ? e.el : e.tr).classList.contains('is-hidden');
    });
    entree.el.classList.toggle('is-hidden', vues.length < 2);
  }

  $empty.hidden = visible > 0;
  if (visible === 0) {
    $empty.textContent = q
      ? 'Aucune commande ne correspond à la recherche.'
      : 'Aucune commande à cette étape.';
  }
  // LE COMPTE NE MENT PAS (26/08). Quand le serveur a coupé la liste, l'en-tête
  // annonçait ce qu'il AFFICHE et le rail ce que l'étape CONTIENT : mesuré sur
  // une étape de 456 commandes, « Production · 400 commandes » à six centimètres
  // d'un compteur de rail qui disait 456. Les deux avaient raison, et l'écran
  // était faux. La mention « 400 des 456 » existait — mais posée sous les 400
  // cartes, à 172 000 px du haut : pour apprendre qu'il en manque, il fallait
  // les avoir toutes dépassées. On le dit donc là où l'œil va, et on garde le
  // bandeau du bas, qui porte le bouton pour charger la suite.
  // Pendant une recherche, `visible` compte ce que le filtre laisse : on ne
  // parle de troncature que sur la liste entière, sinon « 3 des 456 » ferait
  // croire à une coupe alors que c'est la recherche qui a trié.
  const coupee = !q && listeTronqueeA && listeTotal > listeTronqueeA;
  const base = visible
    ? (coupee
      ? `${visible} des ${listeTotal} commandes`
      : `${visible} commande${visible > 1 ? 's' : ''}`)
    : '';
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

  // DÉBUT DE LIGNE : LA POIGNÉE, ET ELLE REMPLIT SA CELLULE. Elle tenait
  // 28 px de large dans une colonne de 44, et la hauteur d'une ligne NORMALE
  // (`--row-h`) dans une cellule qui grandit avec son contenu : on visait donc
  // une boîte bordée de 8 px de vide à gauche, 8 à droite et jusqu'à 18 en bas,
  // tous inertes. La colonne entière est la zone de prise — on vise la gauche
  // de la ligne, pas un pictogramme de 20 px.
  // Le `div.handle-cell` qui l'enveloppait servait un second contenu (une icône
  // de contact) retiré depuis : il ne restait qu'une boîte autour d'une boîte.
  const tdHandle = document.createElement('td');
  tdHandle.className = 'col-handle';
  const grip = document.createElement('div');
  grip.className = 'handle';
  attachTip(grip, 'glisser pour déplacer');
  grip.appendChild(gripIcon());
  attachDrag(grip, tr, r);
  tdHandle.appendChild(grip);
  tr.appendChild(tdHandle);

  // étoiles : 1 à 3, attribuables au clic (réglent la priorité de la ligne)
  tr.appendChild(cellStars(r));
  // QUI SUIT : le pilote (puce principale) et le référent juste en dessous.
  // C'est ICI qu'on attribue une ligne — pas dans la fiche, qu'il faut ouvrir.
  // Le peu de dossiers attribués (24 pilotes sur 184) n'était pas une raison de
  // retirer la colonne le 27/08 : c'était une raison de la garder SOUS LES YEUX.
  tr.appendChild(cellResponsable(r));
  // TYPE N'A PLUS DE COLONNE (27/08) : toujours rempli, mais il ne change rien
  // à ce qu'on fait de la ligne — le nom du dossier le dit, et le bon de
  // commande le porte. Son contrôle reste entier dans la fiche (typeControl) :
  // on retire une colonne, pas une capacité.
  // nom du dossier client (référent / contact déplacés dans le popover contact)
  tr.appendChild(cellDossier(r));
  // article : ce qui est produit. La donnée la mieux remplie de la base
  // (99 % des 187 dossiers de la production) — et elle n'était pas sur la ligne.
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
  // actions de fin de ligne : OUVRIR (toujours là) + envoyer vers (Fiverr) +
  // dupliquer + supprimer (révélées au survol)
  const tdDel = document.createElement('td');
  tdDel.className = 'col-del';
  // UNE RANGÉE, PAS QUATRE BOUTONS POSÉS CÔTE À CÔTE. Empilés en `inline-flex`
  // dans la cellule, ils se calaient sur la ligne de texte : « ouvrir » et
  // Fiverr au milieu (`vertical-align: middle`), dupliquer et supprimer sur la
  // BASE — et cette base dépend de la taille du dessin qu'ils contiennent, si
  // bien que les deux derniers ne tombaient même pas au même pixel. Trois
  // hauteurs différentes sur quatre boutons. Une rangée flex les centre tous,
  // quel que soit leur contenu, et l'écart vient du `gap` : plus une marge par
  // bouton à tenir à jour (l'envoi disparaît quand la ligne est déjà chez lui).
  const actions = document.createElement('div');
  actions.className = 'row-actions';
  tdDel.appendChild(actions);

  // LE BOUTON « OUVRIR » EST PARTI (28/08). Charlie : « ces trois choses
  // doivent être supprimées définitivement — je clique sur la ligne, elle
  // s'ouvre façon tableau et je peux tout modifier ». Trois pastilles pour une
  // seule intention (ouvrir le dossier, sortir son ticket, sortir son bon de
  // commande) alors que la ligne elle-même ne faisait rien quand on la
  // cliquait. C'est la LIGNE qui ouvre, maintenant (voir `ouvrirAuClic`).

  for (const t of SEND_TARGETS) {
    if (t.slug === r.stage) continue; // déjà dans cette catégorie
    const send = document.createElement('button');
    send.className = 'send-btn';
    send.type = 'button';
    attachTip(send, `Envoyer vers ${t.label}`);
    send.setAttribute('aria-label', `Envoyer vers ${t.label}`);
    const marque = t.icone ? t.icone() : strokeIcon(['M5 12h13', 'M13 6l6 6-6 6']);
    const nom = document.createElement('span');
    nom.textContent = t.label;
    send.append(marque, nom);
    send.addEventListener('click', () => { if (armerUneFois(send)) copyToStage(r, t.slug); });
    actions.appendChild(send);
  }
  const dup = document.createElement('button');
  dup.className = 'dup-btn';
  dup.type = 'button';
  attachTip(dup, 'Dupliquer cette commande');
  dup.setAttribute('aria-label', 'Dupliquer cette commande');
  dup.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  dup.addEventListener('click', () => { if (armerUneFois(dup)) duplicateRow(r); });
  const del = document.createElement('button');
  del.className = 'del-btn';
  del.type = 'button';
  attachTip(del, 'Supprimer cette commande');
  del.setAttribute('aria-label', 'Supprimer cette commande');
  del.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  del.addEventListener('click', () => removeRow(r));
  actions.appendChild(dup);
  actions.appendChild(del);
  tr.appendChild(tdDel);

  ouvrirAuClic(tr, r);
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
// patron que typeControl. Les étoiles ★☆☆ étaient moins lisibles d'un coup d'œil
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
      patch(r, { priority: val }, () => { r.priority = val; renderTag(); }, tag);
    });
  });
  td.appendChild(tag);
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
        // La vue qui porte la puce qu'on vient de repeindre, elle, reste en place.
        invalidateRowCache(r.id, pilot);
        applySortAndRender();
      }, pilot);
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
        invalidateRowCache(r.id, ref);
        applySortAndRender();
      }, ref);
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
      // que l'alerte ait été posée depuis le tableau ou depuis la fiche. La LIGNE
      // du tableau, elle, vient d'être repeinte sur place par `render()` (puce +
      // teinte de fond) : la reconstruire jetterait le fondu qu'on déclenche.
      invalidateRowCache(r.id, btn);
      applySortAndRender();
    }, btn);
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
// LE RANGEMENT D'UN DOSSIER DU COMPTOIR.
// ===========================================================================
// « À trier » est un sur-dossier d'attente : la vendeuse enchaîne ses
// clients sans rien classer, puis revient au planning et range. Le parcours du
// comptoir a DÉJÀ désigné la famille (elle a dit si le client repartait avec sa
// commande, si c'était une demande à chiffrer…), et le serveur l'a gardée dans
// `fiche.destination`. Ranger, c'est donc UN tap : cinq dossiers, cinq gestes.
// Pour une autre famille, on ouvre la fiche — son sélecteur « Famille ›
// Sous-étape » couvre tout le pipeline, et il est déjà là.
function destinationDe(r) {
  const d = r && r.fiche && typeof r.fiche === 'object' ? r.fiche.destination : null;
  const stage = d && typeof d === 'object' ? d.stage : null;
  if (!stage || !STAGE_LABEL[stage] || stage === A_TRIER) return null;
  return { stage, sub: d.subStage && SUB_LABEL[d.subStage] ? d.subStage : null };
}

// UNE seule classe pour les deux vues (`ranger-chip`) : c'est la feuille de
// style qui l'habille en cellule de tableau ou en puce de carte. Il prend
// EXACTEMENT la place de ce qu'il remplace — une piste qui apparaîtrait sur
// certaines lignes seulement décalerait toute la file des cartes.
function boutonRanger(r) {
  const btn = document.createElement('button');
  btn.type = 'button';
  const dest = destinationDe(r);
  if (!dest) {
    // Rien de désigné : un dossier d'avant le sur-dossier, ou une destination
    // devenue inconnue. On ne devine pas — on renvoie sur la fiche.
    btn.className = 'ranger-chip ranger-chip--vide';
    btn.textContent = 'à ranger';
    attachTip(btn, 'Ouvre la fiche pour choisir la famille');
    btn.addEventListener('click', (e) => { e.stopPropagation(); openLigneDetail(r.id); });
    return btn;
  }
  const ou = STAGE_LABEL[dest.stage] + (dest.sub ? ` › ${SUB_LABEL[dest.sub]}` : '');
  btn.className = 'ranger-chip';
  btn.textContent = `Ranger dans ${STAGE_LABEL[dest.stage]}`;
  attachTip(btn, `Ranger dans « ${ou} » — pour une autre famille, ouvre la fiche`);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Un doigt qui rebondit sur la tablette ne range pas deux fois : la ligne
    // aurait déjà quitté la vue, et le second tap partirait dans le vide.
    if (!armerUneFois(btn)) return;
    moveToStage(r, dest.stage, dest.sub);
    showToast(`Rangé dans ${ou}.`);
  });
  return btn;
}

// --- LES LIGNES D'UN MÊME TICKET --------------------------------------------
// Un client prend 10 mugs, 3 tee-shirts, 4 décapsuleurs et 10 casquettes : le
// comptoir en fait QUATRE lignes, parce qu'on produit les casquettes pendant
// que les mugs attendent le fournisseur — et une étape appartient à la LIGNE,
// pas au ticket. Reste à VOIR qu'elles vont ensemble : sans quoi le découpage
// ne ferait que disperser un dossier dans le pipeline, et l'article oublié
// remplacerait le dossier bloqué. Deux marques, complémentaires :
//   - la BANNIÈRE, quand les lignes sont VOISINES (dans « À trier » elles le
//     sont toujours : elles y naissent à la suite) ;
//   - le « 2/4 » sur CHAQUE ligne, qui la suit partout où elle va ensuite.
function lotDe(r) {
  const l = r && r.fiche && typeof r.fiche === 'object' ? r.fiche.lot : null;
  if (!l || typeof l !== 'object') return null;
  const total = Number(l.total);
  const rang = Number(l.rang);
  if (!(total > 1) || !(rang >= 1)) return null;
  return { ref: String(l.ref || r.fiche.ref || ''), rang, total };
}

function lotChip(r) {
  const l = lotDe(r);
  if (!l) return null;
  const s = document.createElement('span');
  s.className = 'lot-chip';
  s.textContent = `${l.rang}/${l.total}`;
  attachTip(s, `Article ${l.rang} sur ${l.total} du ticket ${l.ref}`
    + ` — ${l.total - 1} autre${l.total > 2 ? 's' : ''} avance${l.total > 2 ? 'nt' : ''} de son côté`);
  return s;
}

// Les suites de lignes VOISINES d'un même ticket dans la liste affichée. Une
// ligne isolée n'en fait pas partie : une bannière au-dessus d'une seule ligne
// n'apprend rien — c'est le « 2/4 » qui porte l'information là.
function bandesDeLot(data) {
  const bandes = [];
  let cur = null;
  for (let i = 0; i < data.length; i += 1) {
    const l = lotDe(data[i]);
    if (cur && l && l.ref === cur.ref) { cur.lignes.push(data[i]); continue; }
    if (cur && cur.lignes.length > 1) bandes.push(cur);
    cur = l ? { ref: l.ref, total: l.total, debut: i, lignes: [data[i]] } : null;
  }
  if (cur && cur.lignes.length > 1) bandes.push(cur);
  return bandes;
}

// LA BANNIÈRE RANGE-T-ELLE LE GROUPE ? Vrai tant que les articles n'ont pas
// divergé de destination. Lu à deux endroits — par la bannière, qui pose le
// bouton, et par les cartes qu'elle coiffe, qui n'ont alors pas à poser le
// leur. Une seule règle, pas deux qui se ressemblent.
function bandeRangeable(bande) {
  const r0 = bande.lignes[0];
  const dest = destinationDe(r0);
  if (r0.stage !== A_TRIER || !dest) return false;
  return bande.lignes.every((x) => {
    const d = destinationDe(x);
    return d && d.stage === dest.stage && d.sub === dest.sub;
  });
}

// La bannière : qui, quel ticket, combien d'articles — et le bouton qui les
// range TOUS d'un coup. Découper un dossier en quatre ne doit pas quadrupler le
// travail de la vendeuse : tant que les articles n'ont pas divergé, ils se
// rangent ensemble. Chacun reste déplaçable seul, c'est tout l'intérêt.
function banniereLot(bande) {
  const r0 = bande.lignes[0];
  const el = document.createElement('div');
  el.className = 'lot-band';

  const nom = document.createElement('span');
  nom.className = 'lot-band__nom';
  nom.textContent = nomClientAffiche(r0.billing_company, r0.client_type) || 'Sans nom';
  const ref = document.createElement('span');
  ref.className = 'lot-band__ref';
  ref.textContent = bande.ref;
  const compte = document.createElement('span');
  compte.className = 'lot-band__compte';
  // « 3 des 4 articles » : une ligne du ticket est déjà partie ailleurs. C'est
  // une information, pas une anomalie — mais elle doit se lire.
  compte.textContent = bande.lignes.length === bande.total
    ? `${bande.total} articles`
    : `${bande.lignes.length} des ${bande.total} articles`;
  el.append(nom, ref, compte);

  const dest = destinationDe(r0);
  if (bandeRangeable(bande)) {
    const ou = STAGE_LABEL[dest.stage] + (dest.sub ? ` › ${SUB_LABEL[dest.sub]}` : '');
    const n = bande.lignes.length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ranger-chip lot-band__ranger';
    // LA DESTINATION EST SUR LE BOUTON, plus seulement dans l'infobulle : c'est
    // la bannière, et elle seule, qui la dit maintenant — les cartes qu'elle
    // coiffe ne portent plus de puce d'étape.
    btn.textContent = `Ranger les ${n} dans ${STAGE_LABEL[dest.stage]}`;
    attachTip(btn, `Ranger les ${n} articles du ticket ${bande.ref} dans « ${ou} »`);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!armerUneFois(btn)) return;
      // Copie de la liste : chaque `moveToStage` repeint, donc réécrit `rows`.
      for (const x of [...bande.lignes]) moveToStage(x, dest.stage, dest.sub);
      showToast(`${n} articles rangés dans ${ou}.`);
    });
    el.appendChild(btn);
  }
  return el;
}

// Les bannières montées, par ticket : on les RÉUTILISE d'un rendu à l'autre.
// Reconstruites à chaque fois, elles casseraient le glissement des lignes qui
// changent de rang (cf. avantReordonnancement) et clignoteraient à chaque
// rafraîchissement temps réel.
const bandEls = new Map(); // ref -> { el, sig, ids }

function noeudBandeLot(bande, cartes) {
  const sig = [bande.ref, bande.lignes.length, bande.total,
    bande.lignes[0].stage, bande.lignes[0].sub_stage,
    bande.lignes[0].billing_company, cartes ? 'c' : 't'].join('|');
  const vu = bandEls.get(bande.ref);
  if (vu && vu.sig === sig) {
    vu.ids = bande.lignes.map((x) => String(x.id));
    return vu.el;
  }
  const contenu = banniereLot(bande);
  let el = contenu;
  if (!cartes) {
    // Dans le tableau, la bannière est une ligne à part entière. `colSpan` large
    // plutôt que compté : les colonnes vont et viennent avec les réglages, une
    // valeur exacte se périmerait en silence au prochain ajout.
    const tr = document.createElement('tr');
    tr.className = 'lot-band-row';
    const td = document.createElement('td');
    td.colSpan = 99;
    td.className = 'lot-band-cell';
    td.appendChild(contenu);
    tr.appendChild(td);
    el = tr;
  }
  if (vu) vu.el.remove();
  bandEls.set(bande.ref, { el, sig, ids: bande.lignes.map((x) => String(x.id)) });
  return el;
}

// Retire les bannières dont le ticket n'a plus deux lignes voisines à l'écran.
function nettoyerBandes(gardees) {
  for (const [ref, entree] of bandEls) {
    if (!gardees.has(ref)) { entree.el.remove(); bandEls.delete(ref); }
  }
}

function cellSubStage(r) {
  const td = document.createElement('td');
  td.className = 'col-sub-cell';
  // Le sur-dossier n'a pas de sous-étape : sa cellule ne PRÉCISE pas, elle RANGE.
  if (r.stage === A_TRIER) { td.appendChild(boutonRanger(r)); return td; }
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
      }, btn);
    });
  });
  td.appendChild(btn);
  return td;
}

// Nom du dossier client : SE LIT ici, se modifie dans la fiche (30/08, Charlie :
// « la seule façon de faire des modifs est de cliquer dessus, la ligne »). Le
// référent, le téléphone et l'email restent lisibles via le popover contact
// (icône de la 1re colonne) ; les trois se corrigent dans la fiche.
function cellDossier(r) {
  const td = document.createElement('td');
  td.className = 'col-client-cell';
  const stack = document.createElement('div');
  stack.className = 'client-stack';

  const name = document.createElement('div');
  name.className = 'client-name';
  const company = document.createElement('div');
  company.className = 'client-company';
  const texte = r.billing_company ?? '';
  company.title = texte;
  if (texte === '') {
    company.classList.add('is-empty');
    company.textContent = 'nom du dossier';
  } else {
    // « Jean DUPONT », « HÔTEL RÉSIDENCE DES ÎLES » : le nom du client SE LIT
    // en capitales — une seule graisse, c'est la casse qui le fait ressortir
    // quand on balaie la colonne. Le gras d'avant (31/08, Charlie : « j'ai pas
    // demandé en gras mais en majuscule ») découpait la cellule en deux
    // graisses pour dire ce que les capitales disent déjà.
    company.textContent = nomClientAffiche(texte, r.client_type);
  }
  name.appendChild(company);

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
  // NI TICKET NI « OUVRIR » ICI (28/08) : les deux papiers ont quitté
  // l'application et la fiche s'ouvre en cliquant la ligne. Restent les vraies
  // pièces du dossier — WhatsApp, devis, facture, BAT.
  docs.appendChild(cellWhatsapp(r));
  docs.appendChild(cellPdfSlot(r, 'devis'));
  docs.appendChild(cellPdfSlot(r, 'facture'));
  docs.appendChild(cellPdfSlot(r, 'bat'));
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

// FIVERR : la marque, pas une flèche. « Envoyer vers Fiverr » s'annonçait par
// une flèche « → » — le geste (envoyer) mais jamais la DESTINATION, et sur une
// ligne où l'autre flèche (« ↗ ») ouvrait la fiche, les deux se confondaient.
// Ici c'est le badge de Fiverr : carré arrondi plein et « fi » réservé dedans,
// le seul dessin qu'on reconnaisse du premier coup d'œil.
// MONOCHROME (`currentColor`) et non le vert de la marque : dans cet écran le
// vert dit « livrée » (--st-livree). Une pastille verte au bout d'une ligne se
// lirait comme un état, pas comme une destination — la forme suffit.
function fiverrIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  // Un seul tracé : le carré, puis les contre-formes du « f » et du « i »
  // (`evenodd` les évide au lieu de les remplir).
  path.setAttribute('d', [
    'M6 2h12a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z',
    'M6.6 10.4h2.6V9.3c0-2.2 1.5-3.6 3.7-3.6h1.6v2.4h-1.2c-.9 0-1.4.5-1.4 1.3v1h2.4v2.3h-2.4V19H9.2v-6.3H6.6z',
    'M15.9 12.7h1.9V19h-1.9z',
    'M15.9 5.8h1.9v2.1h-1.9z',
  ].join(''));
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  svg.appendChild(path);
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

// BAT (Bon À Tirer) : un sceau avec un check — la validation avant production.
function batIcon() {
  return strokeIcon([
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
    'M8 12l2.5 2.5L16 9',
  ]);
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
  // Délai d'ENVOI, plus large : un PDF de plusieurs mégaoctets sur la connexion
  // de l'atelier met légitimement du temps à monter.
  const res = await fetchBorne(
    url, { method: 'PUT', body: await file.arrayBuffer() }, DELAI_ENVOI,
  );
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
    // ATTACHER UN PDF SE FAIT AUSSI AU CLAVIER (25/08/2026). Un <label> n'est
    // jamais dans l'ordre de tabulation, et le <input type="file"> qu'il
    // contient en est sorti par `hidden` : il n'y avait rien à atteindre, donc
    // rien à actionner. Le poste est un PC — une vendeuse qui saisit toute la
    // journée tabule. Le label prend donc le rôle et la place d'un bouton, et
    // Entrée/Espace ouvrent le sélecteur de fichier.
    lbl.tabIndex = 0;
    lbl.setAttribute('role', 'button');
    lbl.setAttribute('aria-label', `Attacher ${label.withArticle}`);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf';
    input.hidden = true;
    lbl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); // Espace ferait défiler la page
      input.click();
    });
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

// Description : ce qui est produit (ancien champ « produit »). SE LIT ici
// (30/08, Charlie : « la seule façon de faire des modifs est de cliquer
// dessus, la ligne ») — se modifie dans l'entête de la fiche.
function cellDescription(r) {
  const td = document.createElement('td');
  td.className = 'col-product-cell';
  const stack = document.createElement('div');
  stack.className = 'product-stack';

  const name = document.createElement('div');
  name.className = 'product-name';
  // COMBIEN, PUIS DE QUOI — « 24 × T-shirt col rond ». Le même composant que
  // le titre de la carte (voir nomArticle) : deux vues à un clic l'une de
  // l'autre écrivent la ligne de la même façon, ou elles divergent.
  const { texte } = nomArticle(r, name);
  name.classList.toggle('is-empty', texte === '');
  if (texte === '') name.textContent = 'article';
  name.title = texte;

  stack.appendChild(name);
  // « 2/4 » SOUS LA DESCRIPTION. Dispersée dans le pipeline, la ligne doit dire
  // seule qu'elle appartient à un ticket de quatre articles — sinon les mugs
  // restés en commande n'ont plus personne pour les réclamer.
  const marque = lotChip(r);
  if (marque) {
    const sous = document.createElement('div');
    sous.className = 'product-lot';
    sous.append(marque, ` ${(r.fiche && r.fiche.ref) || ''}`);
    stack.appendChild(sous);
  }
  td.appendChild(stack);
  return td;
}

// Prix : montant TTC de la commande — celui que le client paie. Le HT s'affiche
// dessous, calculé. Vide tant que rien n'est chiffré. SE LIT ici (30/08,
// Charlie : « la seule façon de faire des modifs est de cliquer dessus, la
// ligne ») — se modifie dans la fiche (« Prix TTC », zone Paiement), qui porte
// aussi le Reste à payer et le budget indicatif qu'un simple champ ne montre pas.
function cellPrice(r) {
  const td = document.createElement('td');
  td.className = 'col-price-cell';

  const price = document.createElement('span');
  price.className = 'cell-price';
  const vide = r.project_value == null;
  price.classList.toggle('is-empty', vide);
  // LE MONTANT S'ÉCRIT EN FRANÇAIS, ici comme sur la carte, le ticket et la
  // fiche : « 88,80 » et non « 88.8 ».
  price.textContent = vide ? '—' : Number(r.project_value).toFixed(2).replace('.', ',');

  const ht = document.createElement('span');
  ht.className = 'cell-price-ht';
  ht.textContent = htLabel(r.project_value);

  td.append(price, ht);
  return td;
}

// SAVOIR SI UNE NOTE EST COUPÉE DEMANDE UNE MISE EN PAGE. Tant que la cellule
// n'est pas posée dans le document, `scrollHeight` vaut zéro et le calcul
// conclut toujours « rien à déplier » — la flèche n'apparaissait jamais.
// Attendre une image ne suffit pas : les lignes se posent PAR TRANCHES, à
// plusieurs tours d'horloge. On observe donc la boîte elle-même : la réponse
// arrive quand elle arrive, et elle revient aussi quand on TIRE LA COLONNE,
// ce qui est précisément le moment où une note cesse (ou se met) à déborder.
// UN SEUL observateur pour tout le tableau : un par ligne, sur soixante lignes
// reconstruites à chaque évènement du temps réel, ce serait soixante objets à
// ramasser par rafraîchissement.
const observateurNotes = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entrees) => {
    for (const e of entrees) {
      const relire = e.target.__relire;
      if (relire) relire();
    }
  })
  : null;

// ET UNE RELECTURE À UN MOMENT GARANTI. L'observateur ci-dessus répond quand la
// boîte change — parfait pour la poignée de colonne, insuffisant pour l'état de
// DÉPART : sa première réponse arrive à un tour d'horloge que rien ne garantit,
// et certains contextes ne la délivrent pas du tout. On relit donc une fois,
// après que `renderRows` a posé toutes ses lignes : là, la mise en page existe.
// Une seule mesure groupée pour tout le tableau — pas une par ligne.
function relireLesNotes() {
  if (!$rows) return;
  for (const v of $rows.querySelectorAll('.product-desc-view')) {
    if (v.__relire) v.__relire();
  }
}

// Infos : notes libres multi-lignes (ancien champ « description »). Repliée à
// deux lignes par défaut ; dès qu'elle est coupée, une flèche déroule la
// suite. SE LIT ici (30/08, Charlie : « la seule façon de faire des modifs
// est de cliquer dessus, la ligne ») — se modifie dans la fiche (« Note »).
function cellInfos(r) {
  const td = document.createElement('td');
  td.className = 'col-infos-cell';
  const stack = document.createElement('div');
  stack.className = 'infos-stack';

  // LE MÊME BLOC QUE SUR LA CARTE, au même endroit dans la lecture : ce qu'il y
  // a à produire d'abord, la note libre ensuite. Deux vues à un clic l'une de
  // l'autre doivent donner le même composant, pas deux qui se ressemblent.
  const prod = blocProduction(r, hiddenCols);
  if (prod) stack.appendChild(prod);
  // LE MÊME COMPOSANT, DANS LE MÊME ORDRE, DANS LES DEUX VUES — deux écrans à
  // un clic l'un de l'autre doivent donner le même bloc, pas deux qui se
  // ressemblent.
  if (!hiddenCols.has('feu')) {
    const feu = blocFeu(r, attachTip);
    if (feu) stack.appendChild(feu);
  }

  const descRow = document.createElement('div');
  descRow.className = 'product-desc-row';

  // UNE NOTE SE LIT. Un `<div>` IGNORE… non : c'est le `<textarea>` qu'on a
  // retiré qui ignorait `text-overflow: ellipsis` — la propriété ne vaut que
  // pour un bloc. Mesuré en PRODUCTION : 122 notes, MÉDIANE 336 caractères, et
  // 66 % d'entre elles plus longues que ce qu'une ligne de 244 px peut
  // montrer. Ce bloc-ci pose de vrais points de suspension.
  const view = document.createElement('div');
  view.className = 'product-desc-view';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'desc-toggle';
  attachTip(toggle, 'Afficher / masquer les lignes suivantes');
  toggle.setAttribute('aria-label', 'Afficher les lignes suivantes');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  let open = false;
  // LA FLÈCHE APPARAÎT QUAND IL Y A QUELQUE CHOSE À DÉPLIER — c'est-à-dire
  // quand la vue est COUPÉE. Elle ne se montrait qu'aux notes portant un retour
  // à la ligne : une note d'un seul paragraphe de 300 signes n'en avait donc
  // jamais, et rien ne permettait d'en lire la suite. Or c'est le cas normal —
  // en production, la médiane est à 336 caractères d'un seul tenant.
  const estCoupee = () => view.scrollHeight > view.clientHeight + 1;

  const sync = () => {
    const vide = !r.description || !r.description.trim();
    stack.classList.toggle('desc-empty', vide);
    view.textContent = vide ? '+ Ajouter une note' : r.description;
    view.classList.toggle('expanded', open);
    const coupee = (!vide && estCoupee()) || open;
    toggle.hidden = !coupee;
    if (!coupee) open = false;
    toggle.classList.toggle('open', open);
    // Repliée + texte tronqué : l'infobulle donne la note complète au survol.
    view.title = vide ? '' : r.description;
  };

  toggle.addEventListener('click', (e) => { e.stopPropagation(); open = !open; sync(); });

  descRow.appendChild(view);
  descRow.appendChild(toggle);
  stack.appendChild(descRow);
  td.appendChild(stack);
  sync();
  // Voir `observateurNotes` : la coupure ne se sait qu'une fois la boîte posée.
  if (observateurNotes) { view.__relire = sync; observateurNotes.observe(view); }
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

// on ne charge plus l'archive entière pour l'afficher (c'est ce qui figeait la
// tablette), on garde SA ligne à part. Sans ça, `rows.find` ne la trouverait pas
// et le tiroir se refermerait tout seul au premier rafraîchissement.
let ligneHorsListe = null;


// Va chercher UNE commande et ouvre sa fiche, sans toucher à la grille.
//
// C'EST L'APPELANT QUI DIT D'OÙ L'ON VIENT, s'il y a quelque chose à dire. Le
// message « ouverte depuis la recherche » était écrit ICI en dur : l'agenda des
// retraits, qui ouvre ses dossiers par la même porte, l'aurait affiché à chaque
// clic — en nommant une recherche que personne n'avait faite. Depuis l'agenda,
// une fiche qui s'ouvre n'a rien d'étonnant : il n'y a rien à annoncer.
async function ouvrirFicheHorsListe(id, message) {
  const ligne = await api('GET', `/api/requests/${id}`);
  ligneHorsListe = ligne;
  memoriserFiche(ligne);        // la réponse porte déjà la fiche complète
  openLigneDetail(ligne.id);
  if (message) showToast(message);
}


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
  // La commande ouverte hors de la liste ne passe par aucun rafraîchissement de
  // grille : cette réponse est la SEULE occasion de remettre sa ligne à jour.
  // Sans ça, la fiche d'un vieux dossier resterait sur les valeurs qu'elle avait
  // à l'ouverture, même après qu'un collègue les a corrigées.
  if (ligneHorsListe && String(ligneHorsListe.id) === cle) ligneHorsListe = complet;
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
  // ELLE LISAIT `ligneDrawerId`, TOUJOURS NUL. Le tiroir avait cessé d'être
  // ouvert le 28/08 sans que personne ne reprenne sa place ici : une fiche
  // ouverte ne voyait donc JAMAIS la modification d'un autre poste. Le cache
  // était bien vidé — d'où l'illusion que tout marchait, puisque la fiche
  // suivante était juste.
  if (!ficheAtelierId) return;
  clearTimeout(ficheDebounce);
  ficheDebounce = setTimeout(() => {
    const id = ficheAtelierId;
    if (!id) return;
    chargerFicheComplete(id)
      .then(() => { if (ficheAtelierId === id) rafraichirFicheOuverte(); })
      .catch(() => { /* silencieux : la fiche reste utilisable avec ce qu'elle a */ });
  }, FICHE_DEBOUNCE_MS);
}

// ===========================================================================
// OUVRIR UNE COMMANDE — la fiche atelier, plein écran (28/08/2026)
// ===========================================================================
// Elle remplace le tiroir : un dossier entier tient sur un portable 14 pouces,
// sans rien faire défiler, et les trois gestes fréquents (changer d'étape,
// déplacer une date, corriger une quantité) sont à un clic.
//
// LE TIROIR RESTE MONTÉ pour ce qu'il porte encore et que la fiche atelier ne
// reprend pas — le fil des étapes du comptoir, l'historique du client, le
// journal. Il s'ouvre depuis la fiche, pas depuis la ligne.
let ficheAtelierEl = null;
let ficheAtelierId = null;

// ÉCHAP FERME, comme partout ailleurs. Ce n'est pas un « parcours clavier » —
// c'est le geste que tout le monde a déjà pour sortir d'un écran posé par
// dessus, et il ne remplace aucun bouton : la croix et « Retour au planning »
// sont là pour la souris.
// ÉCHAP FERME CE QUI EST OUVERT PAR-DESSUS, PAS LA FICHE. Le calendrier du
// champ « Retrait » retient la touche lui-même, en CAPTURE (voir calendrier.js) :
// cette ligne n'est donc jamais atteinte tant qu'un calendrier est ouvert. La
// garde a d'abord été écrite ICI — « y a-t-il un panneau ouvert ? » — et elle ne
// marchait pas : le calendrier avait déjà retiré le sien quand on regardait.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !ficheAtelierId) return;
  fermerFicheAtelier();
});

function fermerFicheAtelier() {
  if (ficheAtelierEl) { ficheAtelierEl.remove(); ficheAtelierEl = null; }
  ficheAtelierId = null;
  figerLeFond(false);
}

// Vrai si la fiche ne doit pas être reconstruite : quelqu'un écrit dedans, ou un
// menu / calendrier y est ancré et la reconstruction le démonterait sous le
// popup. Même garde que pour une ligne de la grille (isRowBusy) — et c'est
// `isDrawerBusy` qui la tenait, sur un tiroir qui ne s'ouvrait plus : la bulle
// « mise à jour disponible » pouvait donc s'afficher en pleine saisie.
function ficheAtelierOccupee() {
  if (!ficheAtelierEl) return false;
  if (openMenuEl || openCalendar) return true;
  const ae = document.activeElement;
  if (!ae || !ficheAtelierEl.contains(ae)) return false;
  return ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT' || ae.tagName === 'SELECT';
}

// Un autre poste a touché la commande ouverte : on la redessine — jamais sous
// les doigts de quelqu'un qui est en train d'y écrire.
function rafraichirFicheOuverte() {
  if (!ficheAtelierId || ficheAtelierOccupee()) return;
  openLigneDetail(ficheAtelierId);
}

// Le contexte : tout ce que la fiche sait faire de l'application. Elle ne
// décide d'aucune règle métier — elle dessine, normalise, et rend la main.
// LES FACES QU'UNE FAMILLE DÉCLARE — le même tableau que le comptoir
// ===========================================================================
// Un t-shirt a six emplacements de marquage, un tote bag deux, une casquette
// un seul. Ils sont déclarés dans Réglages → Tailles de logo, et c'est déjà par
// ce NOM que la largeur du logo se retrouve : les taper à la main dans la fiche,
// c'est écrire « coeur » là où le tableau dit « Coeur » et perdre la mesure sans
// que rien ne le signale.
//
// LU UNE FOIS PAR SESSION, et seulement quand une fiche s'ouvre : c'est un
// document de réglage, il ne bouge pas trois fois par jour. Un `settings` du flux
// le périme — c'est le même signal qu'émet l'écran des tailles de logo quand on
// y touche.
let taillesLogo = null;
let taillesLogoEnVol = null;
function chargerTaillesLogo() {
  if (taillesLogo) return Promise.resolve(taillesLogo);
  if (!taillesLogoEnVol) {
    taillesLogoEnVol = api('GET', '/api/tailles-logo')
      .then((t) => { taillesLogo = (t && Array.isArray(t.familles)) ? t : { familles: [] }; return taillesLogo; })
      // Le tableau injoignable ne bloque pas la fiche : elle retombe sur la
      // saisie libre, exactement comme avant qu'il existe.
      .catch(() => { taillesLogoEnVol = null; return { familles: [] }; });
  }
  return taillesLogoEnVol;
}

// Le tableau et le catalogue ne se sont pas mis d'accord sur les pluriels ni sur
// les accents : on compare sur une forme réduite, jamais pour réécrire. C'est la
// règle `txLogoCle` du comptoir, à l'identique — deux écrans qui rapprochent les
// mêmes noms doivent le faire pareil.
const cleFamille = (v) => String(v == null ? '' : v).trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/s$/, '');

// LA CASCADE DU COMPTOIR, DANS LE MÊME ORDRE : la RÉFÉRENCE d'abord (K3025 est
// rangée « Homme », et c'est elle qui porte les six emplacements), l'ARTICLE
// ensuite, la famille « Par défaut » en dernier. Un couteau et une planche
// vivent tous deux dans « Art de la table » et ne se gravent pas au même endroit.
const FACES_REPLI = 'Par défaut';
// LA CASCADE REND LA FAMILLE, pas seulement ses faces : c'est elle qu'une face
// créée à la main vient rejoindre, et sans son NOM on ne saurait pas où l'écrire.
function familleDuDossier(r) {
  const familles = (taillesLogo && taillesLogo.familles) || [];
  const sesFaces = (f) => (f && Array.isArray(f.faces) ? f.faces : []);
  const prod = (r && r.fiche && r.fiche.prod) || null;
  const ref = cleFamille(prod && prod.ref);
  if (ref) {
    const parRef = familles.find((f) => Object.keys((f && f.refs) || {})
      .some((x) => cleFamille(x) === ref));
    if (sesFaces(parRef).length) return parRef;
  }
  const parNom = (nom) => (cleFamille(nom)
    ? familles.find((f) => cleFamille(f && f.nom) === cleFamille(nom)) : null);
  const parArticle = parNom(r && r.product);
  if (sesFaces(parArticle).length) return parArticle;
  const repli = parNom(FACES_REPLI);
  return sesFaces(repli).length ? repli : null;
}

// CRÉER UNE FACE, C'EST L'AJOUTER À LA FAMILLE — pas seulement au dossier.
// « La possibilité de créer MES PROPRES faces » (Charlie, 29/08) : une face
// tapée à la main ne vivait que sur le dossier où on l'avait tapée. Le t-shirt
// suivant ne la proposait pas, il fallait la retaper — et la retaper autrement,
// ce qui est exactement ce que le menu existe pour empêcher.
// Elle rejoint donc la liste de la famille (Réglages → Tailles de logo), d'où
// elle se renomme et se retire comme les autres.
async function creerFaceDeFamille(r, nom) {
  const famille = familleDuDossier(r);
  const propre = String(nom == null ? '' : nom).trim();
  if (!famille || !famille.nom || !propre) return false;
  // Déjà déclarée : rien à écrire, et surtout pas un doublon dans la liste.
  if ((famille.faces || []).some((f) => cleFamille(f) === cleFamille(propre))) return true;
  try {
    const table = await api('PATCH', `/api/tailles-logo/familles/${encodeURIComponent(famille.nom)}`,
      { faces: [...famille.faces, propre] });
    if (!table || !Array.isArray(table.familles)) return false;
    // On repose la réponse au lieu d'attendre le `settings` du flux : le menu
    // se rouvre dans la seconde, il doit déjà la porter.
    taillesLogo = table;
    taillesLogoEnVol = Promise.resolve(table);
    return true;
  } catch (err) {
    // Poste sans droit sur les réglages, ou tableau injoignable : la face entre
    // quand même SUR LE DOSSIER — elle ne sera simplement pas proposée la
    // prochaine fois. On ne perd jamais ce qui vient d'être tapé.
    return false;
  }
}

function facesProposees(r) {
  const f = familleDuDossier(r);
  return f && Array.isArray(f.faces) ? f.faces : [];
}

function contexteFicheAtelier(r, marquage) {
  const place = `${r.stage}|${r.sub_stage || ''}`;
  const lot = r.fiche && r.fiche.lot;
  return {
    etapes: placesDuPipeline(place),
    etapeCourante: place,
    employes: [{ value: '', label: 'Non attribué' },
      ...EMPLOYEES.map((n) => ({ value: n, label: n }))],
    referents: [{ value: '', label: 'Référent : personne' },
      ...EMPLOYEES.map((n) => ({ value: n, label: n }))],
    types: [{ value: '', label: 'Non précisé' }, ...CLIENT_TYPES],
    reglements: [{ value: '', label: 'Non défini' },
      ...PAIEMENT_MODES.map((m) => ({ value: m.id, label: m.label }))],
    // UNE FONCTION, PAS UNE CHAÎNE. Figée à l'ouverture, elle continuait
    // d'annoncer l'ancienne échéance après qu'on avait déplacé la date : un
    // chiffre faux à l'écran, juste sous le champ qu'on venait de corriger.
    // CE QUE LA FAMILLE DÉCLARE, pour que la fiche propose au lieu de faire taper.
    facesProposees: facesProposees(r),
    // CE QUE CHAQUE EMPLACEMENT COÛTE SUR CE DOSSIER-LÀ — l'écart réel, pas le
    // coût « en soi » : le prix passe par deux arrondis au palier et par la
    // majoration, donc cocher un emplacement ne vaut pas la même chose selon ce
    // qu'il y a déjà. Le serveur rejoue le moteur avec et sans (voir
    // `/api/requests/:id/marquage`). Nul sur un dossier qu'on ne sait pas
    // tarifer — une tasse, une gravure, les 184 d'avant le 28/08.
    marquage: marquage && typeof marquage === 'object' ? marquage : null,
    // La famille où atterrit une face créée à la main — vide si aucune n'est
    // reconnue : la face reste alors sur le seul dossier, et la fiche le dit.
    familleDesFaces: (familleDuDossier(r) || {}).nom || '',
    creerFace: (nom) => creerFaceDeFamille(r, nom),
    // La boîte de l'application, jamais celle du navigateur — et la fiche
    // n'importe rien elle-même (elle se relit dans un `vm`, un `import` la
    // rendrait illisible au test).
    confirmer: (titre, texte, libelle) => confirmerAction(titre, texte, libelle),
    rappelDelai: (deadline, heure) => {
      const d = tempsRestant(deadline === undefined ? r.deadline : deadline,
        heure === undefined ? ((r.fiche && r.fiche.heureSouhaitee) || null) : heure);
      // SANS LA DATE : elle est affichée en clair deux champs plus haut, dans
      // la même rangée. Le rappel ne dit que ce qu'elle ne dit pas — le temps
      // qui reste.
      return d.texte ? `${d.texte} restant` : '';
    },
    // L'APPARTENANCE AU LOT, ET RIEN D'AUTRE. C'était un bloc gris de deux lignes
    // en pied de fiche : la première redisait le nom du produit affiché dans
    // l'entête, la seconde horodatait la création. Retiré le 29/08 ; ce qui
    // restait vrai — « cette ligne est un article d'un ticket de trois » — monte
    // dans l'entête, avec la référence.
    lotDossier: lot ? `Article ${lot.rang} sur ${lot.total} du ticket ${lot.ref}` : '',
    aujourdhui: () => new Date(),
    // L'HISTOIRE DU DOSSIER, à la demande. Le module part au premier clic et
    // pas à l'ouverture d'un poste : c'est un écran qu'on consulte quand une
    // question se pose, pas tous les jours.
    ouvrirHistorique: () => import('./historique.js')
      .then((m) => m.ouvrirHistorique(r.id, {
        ref: (r.fiche && r.fiche.ref) || '',
        client: nomClientAffiche(r.billing_company, r.client_type) || '',
      }))
      .catch(reportError),
    fermer: fermerFicheAtelier,
    patchLigne: (champ, valeur) => {
      patch(r, { [champ]: valeur }, () => { r[champ] = valeur; rafraichirLigne(r); });
    },
    patchFiche: async (corps) => {
      try {
        const maj = await api('PATCH', `/api/requests/${r.id}/fiche`, corps);
        if (maj) { Object.assign(r, maj); memoriserFiche(maj); rafraichirLigne(r); }
      } catch (err) { reportError(err); }
    },
    patchProd: (patchProd) => envoyerProduction(r, patchProd),
    // Redessine la fiche depuis la base. Necessaire quand un patch change la
    // STRUCTURE et pas seulement une valeur : ajouter une face l'ecrivait bien
    // en base — trois emplacements — et l'ecran en montrait toujours deux. On
    // croyait le clic perdu, et on recommencait.
    rafraichir: () => openLigneDetail(r.id),
    // IL MANQUAIT. Le menu d'étape et « Étape suivante » — le geste principal
    // de la fiche — jetaient « ctx.changerEtape is not a function » à chaque
    // clic : l'étape ne partait jamais en base. La place s'écrit « famille|sous
    // étape », les deux colonnes voyagent ensemble.
    changerEtape: (place) => {
      const [stage, sub] = String(place || '').split('|');
      if (!stage) return;
      const sub_stage = sub || null;
      if (stage === r.stage && sub_stage === (r.sub_stage ?? null)) return;
      patch(r, { stage, sub_stage }, () => {
        r.stage = stage; r.sub_stage = sub_stage;
        // `render` est LOCAL a deux autres fonctions de ce fichier, il n'existe
        // pas ici : la premiere version jetait « render is not defined » et
        // l'etape ne partait toujours pas. Le rendu global du planning, c'est
        // `applySortAndRender` — la ligne peut changer de place ou sortir du
        // filtre courant, donc on retrie.
        rafraichirLigne(r);
      });
    },
    // LE HASH S'ÉCRIVAIT « #/clients » — AVEC UNE BARRE QUI N'EXISTE NULLE PART
    // (corrigé le 29/08). La table `VIEWS` n'accepte que « #clients » : elle ne
    // trouvait rien, `applyHash` retombait sur son défaut ('planning'), et le
    // clic sur le nom du client refermait la fiche pour rouvrir… la grille.
    // L'onglet était MORT sans que rien ne le dise — le symptôme exact de la
    // mémoire « vue et hash doivent rester alignés ». Une clé de `VIEWS`, jamais
    // une chaîne écrite à la main : c'est ce qui a laissé passer la barre.
    // REPRENDRE LE DEVIS D'UN DOSSIER. On ferme la fiche, on bascule sur
    // l'écran du devis, et c'est LUI qui relit l'archive — la fiche ne sait pas
    // ce qu'est un devis, et n'a pas à l'apprendre.
    reprendreDevis: (ligne) => {
      fermerFicheAtelier();
      location.hash = '#devis-flash';
      // ⚠ LE MODULE PEUT NE PAS ÊTRE ENCORE DEMANDÉ. Il se charge à la demande,
      // et c'est le changement de hash qui le déclenche — de façon asynchrone.
      // Lire `dfLoading` à cet instant, c'est lire `null` sur un poste qui n'a
      // jamais ouvert l'écran : la reprise se perdait, et la fiche s'était déjà
      // fermée. On attend qu'il réponde, sans y passer la journée.
      let restant = 40;
      const quandPret = () => {
        if (dfModule && dfModule.reprendreDevis) {
          Promise.resolve(dfLoading).then(() => dfModule.reprendreDevis(ligne.id)).catch(() => {});
          return;
        }
        if (restant -= 1) setTimeout(quandPret, 100);
      };
      quandPret();
    },
    ouvrirClient: (ligne) => {
      const cible = ligne || r;
      clientVise = cible.billing_company || cible.contact_referent || '';
      location.hash = HASH_CLIENTS;
      fermerFicheAtelier();
    },
  };
}

function openLigneDetail(id) {
  const ligne = rows.find((x) => String(x.id) === String(id))
    || (ligneHorsListe && String(ligneHorsListe.id) === String(id) ? ligneHorsListe : null);
  if (!ligne) return;
  ficheAtelierId = String(id);
  // LA FICHE COMPLÈTE D'ABORD : la liste ne porte qu'un résumé (FICHE_LISTE
  // côté serveur), sans les tailles ni les faces. Dessinée sans elle, la fiche
  // s'ouvrirait sur un dossier amputé qui a l'air complet.
  // LE TABLEAU DES FACES PART AVEC LA FICHE, pas au démarrage : deux requêtes en
  // parallèle, et la seconde ne coûte qu'une fois par session (elle est mise de
  // côté). Sans elle, le menu des faces s'ouvrirait vide sur la première fiche.
  // LE PRIX DE CHAQUE EMPLACEMENT part avec elles. Neuf recalculs du moteur : ils
  // n'ont aucune raison de voyager sur chaque ligne de la grille, à chaque
  // rafraîchissement — ils ne servent qu'ici, et seulement quand on ouvre.
  Promise.all([
    chargerFicheComplete(id).catch(() => {}),
    chargerTaillesLogo(),
    api('GET', `/api/requests/${id}/marquage`).catch(() => null),
  ]).then(([, , marquage]) => {
    if (ficheAtelierId !== String(id)) return;
    const fraiche = rows.find((x) => String(x.id) === String(id)) || ligne;
    completerFiche(fraiche);
    fermerFicheAtelier();
    ficheAtelierId = String(id);
    ficheAtelierEl = dessinerFicheAtelier(fraiche, contexteFicheAtelier(fraiche, marquage));
    // UN CLIC A COTE DE LA CARTE FERME LA FICHE. La racine EST le voile depuis
    // qu'elle defile : on ne ferme donc que si le clic l'a atteinte ELLE, pas
    // un de ses enfants. Sur `click` et non `mousedown` : le champ qu'on quitte
    // doit d'abord perdre le focus, c'est son `blur` qui envoie ce qu'on venait
    // d'y ecrire — ferme au premier des deux, la saisie partirait dans le vide.
    ficheAtelierEl.addEventListener('click', (ev) => {
      if (ev.target === ficheAtelierEl) fermerFicheAtelier();
    });
    document.body.appendChild(ficheAtelierEl);
    figerLeFond(true);
  });
}


// --- Champs éditables du tiroir --------------------------------------------
// Le tiroir n'est pas une fiche de lecture : TOUT ce qu'il affiche se modifie
// Après une modification faite DANS la fiche : la grille affiche les mêmes
// valeurs (nom, prix, priorité, échéance…) et le tri peut déplacer la ligne —
// on périme sa signature et on re-rend.
function rafraichirLigne(r) {
  invalidateRowCache(r.id);
  applySortAndRender();
}


function stageDestinationLabel(stage, sub) {
  const family = STAGE_LABEL[stage] || stage;
  if (sub && SUB_LABEL[sub]) return `${family} › ${SUB_LABEL[sub]}`;
  return familyHasSub(stage) ? `${family} › à préciser` : family;
}


// --- La fiche projet : ce que l'écran du patron appelle « la bulle » ---------

// Les DESSINS de la barre d'actions de la fiche. La police d'icônes de l'app
// est un sous-ensemble auto-hébergé de 91 glyphes : `print`, `download`,
// `content_copy` et `send` n'en font pas partie, et un nom absent de la police
// s'affiche en TEXTE — tronqué à 1 em par `.material-symbols-outlined`, donc
// réduit à sa première lettre. Ces quatre boutons montraient « p », « d », « c »
// et « s », et sous 700 px (où le libellé s'efface) c'était tout ce qu'il en
// restait. On les dessine, plutôt que d'alourdir la police pour quatre traits.
const LD_ICONES = {
  imprimer: ['M6 9V3h12v6', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 14h12v7H6z'],
  telecharger: ['M12 3v12', 'M7 11l5 5 5-5', 'M4 20h16'],
  dupliquer: ['M9 9h11v11H9z', 'M5 15V5a2 2 0 0 1 2-2h10'],
  envoyer: ['M5 12h13', 'M13 6l6 6-6 6'],
  ticket: ['M4 5h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M4 19h16', 'M8 9h8', 'M8 12.5h5'],
  // DESSINÉE, pas prise dans la police. Toutes les actions de la fiche sont des
  // icônes au trait ; un nom de glyphe passé ici retombe sur le repli et
  // s'affiche EN TEXTE à côté du libellé — mesuré : le bouton disait
  // « mailEmail ». La police est un sous-ensemble figé, et son absence ne lève
  // rien : elle se voit, ou elle ne se voit pas.
  mail: ['M3 6h18v12H3z', 'M3 7l9 6 9-6'],
  // Le document du BUREAU : une feuille à lignes, avec son coin replié.
  bureau: ['M6 3h8l4 4v14H6z', 'M14 3v4h4', 'M9 12h6', 'M9 15.5h6', 'M9 19h3'],
};


// Une échéance en français sur un document destiné à un humain. `deadline` est
// une chaîne « aaaa-mm-jj », mais une base de test la rend en ISO complet : on
// coupe avant de découper, plutôt que de dater le récapitulatif en anglais.
function dateFr(iso) {
  const m = String(iso || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

// LE RÉCAPITULATIF EN .TXT EST RETIRÉ (30/08). Il se téléchargeait depuis la
// rangée « Documents » de la fiche atelier, que Charlie a fait supprimer d'un
// bloc — l'intitulé et ses deux boutons. Plus rien n'appelait `recapTexte` ni
// `telechargerRecap`, et un fichier que personne ne descend est un format de
// plus à tenir à jour à chaque champ ajouté.
// CE QUI RESTE : `ticketTexte(modeleTicket(r))`, le même récapitulatif en texte,
// que la boîte du ticket copie dans le presse-papier — c'est ce qu'on colle
// dans un message au client.

// ===========================================================================
// LE TICKET DE L'ATELIER — le ressortir depuis la ligne, le corriger, l'imprimer
// ===========================================================================
// La ligne sortait le ticket du CLIENT : son papier, ses prix, son total, son
// mode de règlement. Or ON NE REMET AUCUN TICKET AU CLIENT — le papier qui sort
// au comptoir suit le travail jusqu'à l'établi. C'est celui-là qu'on ressort
// depuis le planning : quoi produire, combien, pour quand, pour qui, et ce
// qu'il faut savoir avant de couper.
//
// L'ARGENT N'EST PLUS DESSUS. Ni prix, ni total, ni paiement : ça se corrige
// toujours, mais sur la ligne du planning et dans la fiche, là où ça vit.


// LA FICHE COMPLÈTE D'ABORD — ET RIEN NE S'IMPRIME SANS ELLE.
// La liste ne transporte qu'un RÉSUMÉ de la fiche (FICHE_LISTE côté serveur) :
// ni les articles, ni les quantités, ni les prix ligne à ligne, ni la date de
// prise. Cet appel avalait son échec (`.catch(() => {})`) : réseau tombé, le
// modèle retombait sur la seule description de la ligne et sortait un ticket à
// UN article, sans date — un papier FAUX, parti à l'atelier, sans que rien à
// l'écran ne le signale. C'est exactement le cas normal sur la tablette du
// comptoir. On refuse donc, et `ouvrirTicket` le dit.
const TICKET_SANS_DETAIL = 'Détail de la commande indisponible — vérifie la connexion, puis rouvre le ticket.';

async function ticketDeLaLigne(r) {
  // On REQUALIFIE la panne : « Connexion perdue — on réessaie tout seul » (le
  // message maison des erreurs réseau) serait faux ici, rien ne rouvrira le
  // ticket. Ce qu'il faut dire, c'est quoi refaire.
  try {
    await chargerFicheComplete(r.id);
  } catch (_) {
    throw new Error(TICKET_SANS_DETAIL);
  }
  completerFiche(r);
  // Le serveur a répondu, mais avec un résumé (réponse d'une autre route, cache
  // périmé) : mieux vaut ne rien imprimer qu'un ticket amputé qui a l'air vrai.
  if (r.fiche && r.fiche.fichePartielle) throw new Error(TICKET_SANS_DETAIL);
  return modeleTicket(r);
}

// Impression : on n'imprime PAS l'application (la grille, le rail et la fiche
// telle qu'elle est à l'écran donneraient une feuille illisible). On compose
// une page propre dans un cadre hors écran, on l'imprime, on le retire. Un
// cadre plutôt qu'une fenêtre : aucun bloqueur de pop-up ne peut l'empêcher.
//
// `@page { size: A4 portrait }` DEPUIS LE 26/08. Le ticket était un rouleau de
// caisse de 76 mm, et on laissait alors l'imprimante décider du papier — forcer
// un format aurait fait mettre un ticket de 80 mm à l'échelle du A4, c'est-à-dire
// un ticket géant sur toute la largeur de la feuille.
//
// Le papier de l'atelier fait maintenant 210 x 297 mm par construction : le
// déclarer est ce qui garantit qu'un article tient sur UNE feuille, et que le
// suivant commence sur la sienne (voir `.tk + .tk` dans CSS_TICKET). Marge à
// zéro : le ticket porte ses propres marges intérieures, deux marges empilées
// rétréciraient la zone utile sans que rien ne le dise.
function imprimerModele(t, titre) {
  const cadre = document.createElement('iframe');
  cadre.setAttribute('aria-hidden', 'true');
  // LE CADRE DOIT ÊTRE ASSEZ LARGE POUR LA FEUILLE. À 400 px, une page de
  // 210 mm (environ 794 px) se disposait dans un cadre deux fois trop étroit :
  // les grilles de tailles et de zones se calculaient sur la mauvaise largeur.
  cadre.style.cssText = 'position:fixed;left:-9999px;top:0;width:820px;height:1200px;border:0';
  document.body.appendChild(cadre);
  const d = cadre.contentDocument;
  d.title = titre;
  const style = d.createElement('style');
  style.textContent = `@page{size:A4 portrait;margin:0}body{margin:0;background:#fff}${CSS_TICKET}`;
  d.head.appendChild(style);
  d.body.appendChild(dessinerTicket(t, d));
  cadre.contentWindow.focus();
  cadre.contentWindow.print();
  setTimeout(() => cadre.remove(), 1000);
}


// ===========================================================================
// LE DOCUMENT DU BUREAU — l'autre papier de la même ligne
// ===========================================================================
// LE TICKET NE PORTE PAS D'ARGENT, et ce n'est pas un oubli : l'établi n'en
// fait rien, et une feuille qui traîne sur un plan de travail n'a pas à
// annoncer ce que le client a payé. Mais quelqu'un DOIT avoir tout : celui qui
// facture, celui qui relance, celui qui veut savoir ce qu'une affaire a
// rapporté. C'est ce papier-là.
//
// Même ligne, même fiche, deux lectures. Il n'y a pas deux saisies : c'est le
// modèle qui choisit ce qu'il montre.
let bureauOuvert = false;

async function ouvrirBureau(r) {
  if (bureauOuvert) return;
  bureauOuvert = true;
  let mod;
  let t;
  try {
    mod = await chargerBureau();
    // LA MÊME GARDE QUE LE TICKET, et elle compte encore plus ici : un document
    // du bureau amputé de son détail aurait l'air vrai — on facturerait dessus.
    try {
      await chargerFicheComplete(r.id);
    } catch (_) {
      throw new Error(TICKET_SANS_DETAIL);
    }
    completerFiche(r);
    if (r.fiche && r.fiche.fichePartielle) throw new Error(TICKET_SANS_DETAIL);
    // LE TAUX DE TGCA VIENT DES RÉGLAGES, comme partout ailleurs : le papier
    // le lisait en dur, et un changement de taux ne l'atteignait pas.
    t = mod.modeleBureau(r, await identiteAtelier(), TGCA);
  } catch (err) {
    bureauOuvert = false;
    reportError(err);
    return;
  }
  poserStyleBureau(mod.CSS_BUREAU);

  const focusAvant = document.activeElement;
  const fond = document.createElement('div');
  fond.className = 'tk-modal';
  const carte = document.createElement('div');
  carte.className = 'tk-modal__card';
  carte.setAttribute('role', 'dialog');
  carte.setAttribute('aria-modal', 'true');
  carte.setAttribute('aria-label', `${t.titre}${t.ref ? ` ${t.ref}` : ''}`);

  const feuille = document.createElement('div');
  feuille.className = 'tk-modal__paper';
  feuille.appendChild(mod.dessinerBureau(t, document));

  const actions = document.createElement('div');
  actions.className = 'tk-modal__actions';
  const bouton = (label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ask__btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };
  const fermer = () => {
    fond.remove();
    document.removeEventListener('keydown', auClavier);
    bureauOuvert = false;
    if (focusAvant && focusAvant.focus) focusAvant.focus();
  };
  // Échap referme : c'est le geste que tout le monde a déjà, et une boîte dont
  // on ne sort qu'en visant un bouton est une boîte qu'on garde ouverte.
  const auClavier = (e) => { if (e.key === 'Escape') fermer(); };
  document.addEventListener('keydown', auClavier);

  actions.append(
    bouton('Fermer', fermer),
    // PASSER À L'AUTRE PAPIER SANS RESSORTIR. On a la ligne sous les yeux :
    // fermer, la retrouver dans la grille et viser l'autre pastille, c'est
    // trois gestes pour une question qu'on se pose ici.
    bouton('Ticket atelier', () => { fermer(); ouvrirTicket(r); }),
    bouton('Facture', () => { fermer(); ouvrirFacture(r); }),
    // Le document en texte : c'est ce qu'on colle dans un e-mail au bureau.
    bouton('Copier', () => {
      const dit = () => showToast('Bon de commande copié');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(mod.bureauTexte(t))
          .then(dit, () => showToast('Copie refusée par le navigateur'));
      } else {
        showToast('Copie indisponible sur ce poste');
      }
    }),
    bouton('Imprimer', () => imprimerBureau(mod, t)),
  );

  carte.append(feuille, actions);
  fond.append(carte);
  // Le clic HORS de la carte referme, celui dedans non : sans ce test, choisir
  // une ligne du document fermait le document.
  fond.addEventListener('click', (e) => { if (e.target === fond) fermer(); });
  document.body.append(fond);
  // `.tk-modal` NAÎT À OPACITÉ ZÉRO : c'est la classe `open`, posée au cadre
  // suivant, qui la fait apparaître. Sans elle, le document est bien monté,
  // bien dimensionné, et parfaitement INVISIBLE — le bouton « ne fait rien ».
  requestAnimationFrame(() => {
    fond.classList.add('open');
    const premier = actions.querySelector('button');
    if (premier) premier.focus();
  });
}

// La feuille de la facture est posée dans la page à la PREMIÈRE ouverture —
// id DISTINCT de `bu-style` (bon de commande) : `poserStyleBureau` a son id
// fixe en dur, le réutiliser tel quel poserait la CSS de la facture sous le
// nom `bu-style`, ou sauterait l'insertion si un bon de commande a déjà été
// ouvert avant dans la session.
function poserStyleFacturePapier(css) {
  if (document.getElementById('fa-papier-style')) return;
  const s = document.createElement('style');
  s.id = 'fa-papier-style';
  s.textContent = css;
  document.head.appendChild(s);
}

// ===========================================================================
// LA FACTURE — relecture d'un document déjà émis, jamais recalculé
// ===========================================================================
// CONTRAIREMENT AU TICKET ET AU BON DE COMMANDE (qui se recomposent à partir
// de la ligne courante), la facture ne se reconstruit JAMAIS depuis `fiche` :
// elle se RELIT depuis `invoices.document`.
//
// CE QUE LE SERVEUR ARCHIVE EST LA DONNÉE BRUTE, PAS UN RENDU (voir Task 5,
// server.js n'importe pas facture.js — CommonJS contre module ES — et ne
// formate donc rien lui-même). `document.saisie` porte exactement ce que
// `modeleFacture` attend en entrée, `document.entreprise` fige l'identité de
// l'atelier TELLE QU'ELLE ÉTAIT à l'émission. Rouvrir une facture appelle
// donc `modeleFacture(document.saisie, document.entreprise)` — la MÊME
// fonction pure que l'écran de composition utilise pour l'aperçu vivant — et
// c'est CE résultat qui va à `dessinerFacture`. Un changement de taux de
// TGCA ou d'identité de l'atelier depuis l'émission ne change donc rien :
// `document.entreprise` est figé, pas relu depuis les Réglages courants.
let factureOuverte = false;
async function ouvrirFacture(r) {
  if (factureOuverte) return;
  factureOuverte = true;
  let mod;
  let doc;
  try {
    mod = await chargerFacture();
    const rep = await fetchBorne(`/api/requests/${r.id}/facture`);
    if (rep.status === 404) throw new Error('Aucune facture pour ce dossier');
    if (!rep.ok) throw new Error(`Erreur ${rep.status}`);
    const data = await rep.json();
    doc = mod.modeleFacture(data.document.saisie, data.document.entreprise);
  } catch (err) {
    factureOuverte = false;
    reportError(err);
    return;
  }
  poserStyleFacturePapier(mod.CSS_FACTURE);

  const focusAvant = document.activeElement;
  const fond = document.createElement('div');
  fond.className = 'tk-modal';
  const carte = document.createElement('div');
  carte.className = 'tk-modal__card';
  carte.setAttribute('role', 'dialog');
  carte.setAttribute('aria-modal', 'true');
  carte.setAttribute('aria-label', `${doc.titre}${doc.numero ? ` ${doc.numero}` : ''}`);

  const feuille = document.createElement('div');
  feuille.className = 'tk-modal__paper';
  feuille.appendChild(mod.dessinerFacture(doc, document));

  const actions = document.createElement('div');
  actions.className = 'tk-modal__actions';
  const bouton = (label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ask__btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };
  const fermer = () => {
    fond.remove();
    document.removeEventListener('keydown', auClavier);
    factureOuverte = false;
    if (focusAvant && focusAvant.focus) focusAvant.focus();
  };
  const auClavier = (e) => { if (e.key === 'Escape') fermer(); };
  document.addEventListener('keydown', auClavier);

  actions.append(
    bouton('Fermer', fermer),
    bouton('Imprimer', () => {
      const cadre = document.createElement('iframe');
      cadre.setAttribute('aria-hidden', 'true');
      cadre.style.cssText = 'position:fixed;left:-9999px;top:0;width:820px;height:1200px;border:0';
      document.body.appendChild(cadre);
      const d = cadre.contentDocument;
      d.title = `${doc.titre} ${doc.numero || ''}`.trim();
      const style = d.createElement('style');
      style.textContent = `@page{size:A4 portrait;margin:0}body{margin:0;background:#fff}${mod.CSS_FACTURE}`;
      d.head.appendChild(style);
      d.body.appendChild(mod.dessinerFacture(doc, d));
      cadre.contentWindow.focus();
      cadre.contentWindow.print();
      setTimeout(() => cadre.remove(), 1000);
    }),
  );

  carte.append(feuille, actions);
  fond.append(carte);
  fond.addEventListener('click', (e) => { if (e.target === fond) fermer(); });
  document.body.append(fond);
  requestAnimationFrame(() => {
    fond.classList.add('open');
    const premier = actions.querySelector('button');
    if (premier) premier.focus();
  });
}

// L'IDENTITÉ DE L'ATELIER — ce qui signe le bon de commande. Lue UNE fois par
// session : elle change deux fois dans la vie d'un atelier, et la relire à
// chaque ouverture ajouterait un aller-retour entre le clic et le papier.
// Si la lecture échoue, le document sort SANS en-tête plutôt que pas du tout :
// un bon de commande incomplet vaut mieux qu'un bouton qui ne fait rien.
let identitePromesse = null;
function identiteAtelier() {
  if (!identitePromesse) {
    // `fetchBorne` et pas `fetch` nu : un serveur qui ne répond plus laisserait
    // la promesse suspendue, et le bouton « Bon de commande » ne rendrait
    // jamais la main.
    identitePromesse = fetchBorne('/api/settings/entreprise')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return identitePromesse;
}

function imprimerBureau(mod, t) {
  const cadre = document.createElement('iframe');
  cadre.setAttribute('aria-hidden', 'true');
  // Assez large pour une feuille de 210 mm (environ 794 px) : dans un cadre
  // trop étroit, les colonnes du détail se calculent sur la mauvaise largeur.
  cadre.style.cssText = 'position:fixed;left:-9999px;top:0;width:820px;height:1200px;border:0';
  document.body.appendChild(cadre);
  const d = cadre.contentDocument;
  d.title = `${t.titre} ${t.ref || ''}`.trim();
  const style = d.createElement('style');
  style.textContent = `@page{size:A4 portrait;margin:0}body{margin:0;background:#fff}${mod.CSS_BUREAU}`;
  d.head.appendChild(style);
  d.body.appendChild(mod.dessinerBureau(t, d));
  cadre.contentWindow.focus();
  cadre.contentWindow.print();
  setTimeout(() => cadre.remove(), 1000);
}

// La feuille est posée dans la page à la PREMIÈRE ouverture : c'est la même
// chaîne que reçoit le cadre d'impression, donc l'aperçu ne peut pas dériver de
// ce qui sort sur le papier.
function poserStyleBureau(css) {
  if (document.getElementById('bu-style')) return;
  const s = document.createElement('style');
  s.id = 'bu-style';
  s.textContent = css;
  document.head.appendChild(s);
}

// La feuille du ticket est posée dans la page à la PREMIÈRE ouverture, et pas
// recopiée dans styles.css : c'est la même chaîne que reçoit le cadre
// d'impression, donc l'aperçu ne peut pas dériver de ce qui sort sur le papier.
function poserStyleTicket() {
  if (document.getElementById('tk-style')) return;
  const s = document.createElement('style');
  s.id = 'tk-style';
  s.textContent = CSS_TICKET;
  document.head.appendChild(s);
}

// ===========================================================================
// LE TICKET SE CORRIGE — sur la ligne, dans le ticket lui-même
// ===========================================================================
// L'APERÇU sert d'abord à relire : le client revient avec son papier, et sur la
// tablette du comptoir c'est souvent tout ce dont on a besoin. Il s'affiche donc
// exactement comme il s'imprimera, avec l'impression à un doigt de là.
//
// Mais « un appui, le ticket s'affiche », et il n'y avait rien à en faire
// d'autre que l'imprimer. Or c'est justement le papier qu'on a sous les yeux
// quand le client rappelle : son numéro était faux, il ajoute une précision, et
// surtout l'atelier a besoin d'une consigne pour produire. Il fallait fermer l'aperçu,
// ouvrir la fiche, dérouler le récapitulatif, retrouver la bonne ligne,
// enregistrer. Le ticket s'ouvre donc DÉJÀ modifiable : on tape dedans, à
// l'endroit exact où la valeur s'imprimera.
//
// PAS DE BOUTON « ENREGISTRER ». C'est la règle de la GRILLE (une cellule
// quittée est une cellule enregistrée), pas celle de la fiche (« je corrige
// tout, puis je valide ») : ici on vient rectifier UNE chose, vite, debout au
// comptoir. Chaque champ part quand on le quitte — et « Fermer » comme
// « Imprimer » commettent d'abord ce qui est encore en cours de frappe, pour
// qu'aucun geste ne puisse perdre une consigne.

// OÙ S'ÉCRIT UNE VALEUR DU TICKET — trois adresses, une route chacune :
//   `ligne`   → une colonne de la commande (client, téléphone, échéance, prix)
//   `fiche`   → une clé du JSON de la fiche (heure de retrait, consigne atelier)
//   `details` → UNE position du récapitulatif figé du comptoir
// Le récapitulatif se corrige par POSITION, et on n'envoie QUE l'indice touché :
// les autres cases partent vides, et le serveur ne réécrit que les chaînes (cf.
// `corriger` dans server.js). Deux postes qui rectifient deux articles du même
// dossier ne s'effacent donc pas l'un l'autre.
function corpsTicket(cible, valeur) {
  if (cible.ou === 'ligne') return { fiche: false, corps: { [cible.col]: valeur } };
  if (cible.ou === 'fiche') return { fiche: true, corps: { [cible.cle]: valeur } };
  // CE QU'ON RECTIFIE À L'ÉTABLI : un nombre par taille, une largeur de logo.
  // Par POSITION comme le récapitulatif — on n'envoie QUE la case corrigée, et
  // la correction du poste d'à côté tient toujours quand la nôtre arrive.
  if (cible.ou === 'prod') {
    const cases = [];
    cases[cible.i] = cible.liste === 'tailles'
      ? { n: Number(valeur) }
      : { mm: String(valeur == null ? '' : valeur) };
    return { fiche: true, corps: { prod: { [cible.liste]: cases } } };
  }
  const positions = [];
  positions[cible.i] = String(valeur == null ? '' : valeur);
  return { fiche: true, corps: { details: positions } };
}

// Une correction part tout de suite, et la réponse fait foi : elle porte la
// ligne ENTIÈRE, fiche comprise, donc l'impression qui suit sort le ticket
// corrigé. On remet aussi à jour la ligne de la grille — l'objet de `rows` a pu
// être remplacé par un rafraîchissement pendant qu'on tapait.
async function envoyerTicket(r, cible, valeur) {
  const { fiche, corps } = corpsTicket(cible, valeur);
  const maj = fiche
    ? await api('PATCH', `/api/requests/${r.id}/fiche`, corps)
    : await patchRow(r, corps);
  if (maj) {
    Object.assign(r, maj);
    memoriserFiche(maj);
    const vivante = rows.find((x) => String(x.id) === String(r.id));
    if (vivante && vivante !== r) Object.assign(vivante, maj);
  }
  return maj;
}

// L'ÉDITEUR que reçoit `dessinerTicket` : pour chaque valeur du ticket, il rend
// le champ qui l'écrit là où elle vit. Il empile dans `champs` de quoi commettre
// la frappe en cours, l'annuler, et retrouver le contrôle qui a le focus.
function editeurTicket(r, champs) {
  const texteOuNull = (v) => {
    const s = String(v == null ? '' : v).trim();
    return s === '' ? null : s;
  };
  const marquerEnregistre = (ctrl) => {
    ctrl.classList.remove('is-saved');
    void ctrl.offsetWidth; // relance l'animation quand la même case repart deux fois
    ctrl.classList.add('is-saved');
  };

  // UNE SEULE ÉCRITURE À LA FOIS. Chaque champ s'enregistre en le quittant, et
  // « Imprimer » / « Copier » commettent d'un bloc ce qui reste : deux
  // corrections pouvaient donc voler ensemble. Or CHAQUE réponse rapporte la
  // ligne entière et l'écrase dans `r` — c'était donc la dernière ARRIVÉE qui
  // gagnait, pas la dernière écrite. Sur le wifi de l'atelier, le papier
  // pouvait sortir avec la valeur d'AVANT la correction qu'on venait de taper.
  // La file remet l'ordre des réponses sur l'ordre de la frappe.
  let file = Promise.resolve();
  const aLaSuite = (travail) => {
    const suite = file.then(travail, travail);
    file = suite.catch(() => {});   // un échec ne bloque pas la correction suivante
    return suite;
  };

  // Branche un contrôle sur son adresse d'écriture. `sauver()` ne fait rien tant
  // que la valeur n'a pas bougé : on peut l'appeler à chaque perte de focus, à
  // la fermeture ET à l'impression sans multiplier les requêtes.
  const brancher = (ctrl, cible, lire) => {
    let envoye = lire();
    let affiche = ctrl.value;
    const remettre = (v) => { ctrl.value = v; };
    const sauver = () => {
      const v = lire();
      if (v === envoye) return Promise.resolve();
      const envoyeAvant = envoye;
      const afficheAvant = affiche;
      envoye = v;
      affiche = ctrl.value;
      return aLaSuite(() => envoyerTicket(r, cible, v)).then(
        () => marquerEnregistre(ctrl),
        (err) => {
          envoye = envoyeAvant;
          affiche = afficheAvant;
          remettre(afficheAvant);
          reportError(err);
        },
      );
    };
    ctrl.addEventListener('change', sauver);
    ctrl.addEventListener('blur', sauver);
    champs.push({ ctrl, sauver, annuler: () => remettre(affiche) });
    return ctrl;
  };

  // UNE ZONE DE TEXTE ÉPOUSE SON CONTENU. Sans ça elle garde la hauteur de ses
  // `rows` et cache le reste derrière un défilement muet — ce qu'on vient
  // justement de retirer à la désignation. On mesure APRÈS avoir remis la
  // hauteur à `auto` : sinon `scrollHeight` ne redescend jamais quand on
  // efface, et le champ reste haut pour toujours.
  const epouser = (c) => {
    if (c.tagName !== 'TEXTAREA') return;
    c.style.height = 'auto';
    c.style.height = `${c.scrollHeight}px`;
  };

  const champ = (tag, valeur, o) => {
    const c = document.createElement(tag);
    c.className = o.cls ? `tk__champ ${o.cls}` : 'tk__champ';
    if (o.type) c.type = o.type;
    if (o.mode) c.inputMode = o.mode;
    if (o.rows) c.rows = o.rows;
    if (o.placeholder) c.placeholder = o.placeholder;
    c.value = valeur == null ? '' : String(valeur);
    c.setAttribute('aria-label', o.label);
    if (tag === 'textarea') {
      c.addEventListener('input', () => epouser(c));
      // La feuille n'est pas encore posée dans le document : `scrollHeight`
      // n'y vaut rien. On mesure au tour suivant, une fois qu'elle y est.
      requestAnimationFrame(() => epouser(c));
    }
    return c;
  };

  // Un champ de texte branché sur une COLONNE de la ligne : le cas le plus
  // courant (client, contact, téléphone).
  const surLaLigne = (col, valeur, o) => {
    const c = champ('input', valeur, o);
    return brancher(c, { ou: 'ligne', col }, () => texteOuNull(c.value));
  };

  return (cle, txt, cible) => {
    switch (cle) {
      case 'client':
        return surLaLigne('billing_company', txt, { label: 'Client' });
      case 'contact':
        return surLaLigne('contact_referent', txt, {
          label: 'Personne à contacter', placeholder: 'personne à contacter',
        });
      // « Erreur de numéro » : celui-là se corrige plus souvent que tous les
      // autres, et il ne se corrigeait que dans la fiche, deux écrans plus loin.
      case 'tel':
        return surLaLigne('contact_phone', txt, {
          type: 'tel', mode: 'tel', label: 'Téléphone', placeholder: 'téléphone',
        });
      // L'ÉCHÉANCE ET LA CONSIGNE D'ATELIER NE SONT PLUS SUR LE PAPIER (26/08),
      // donc plus corrigeables ici. Elles restent l'une et l'autre dans le
      // dossier : « Heure de remise » et « Consigne atelier », au tiroir.
      default: {
        // Les valeurs d'un ARTICLE. Sans adresse d'écriture — le détail d'un
        // besoin de devis résume trois champs — la valeur reste du texte : mieux
        // vaut ne rien offrir qu'un champ qui n'enregistre rien.
        if (!cible) {
          const s = document.createElement('span');
          s.textContent = txt;
          return s;
        }
        const o = {
          qte: { cls: 'tk__qte', mode: 'numeric', label: 'Quantité' },
          // ZONE DE TEXTE, PAS CHAMP D'UNE LIGNE. Un `input` ne revient jamais à
          // la ligne : « Sweat capuche molleton » y demandait 677 px pour 450
          // disponibles, et se coupait net en plein mot — sur le seul mot que
          // l'atelier cherche du regard, en 44 px.
          designation: { tag: 'textarea', rows: 1, label: 'Désignation de l’article' },
          detail: {
            tag: 'textarea', rows: 2, label: 'Ce qu’on produit',
            placeholder: '+ précision pour l’atelier',
          },
          // LES DEUX VALEURS QU'ON RECTIFIE DEVANT LA PRESSE. Elles sont dans
          // la case du tableau et au bout du filet du bordereau : le champ n'y
          // pose pas de trait de plus (voir CSS_TICKET).
          'prod-taille': { mode: 'numeric', label: 'Nombre de pièces pour cette taille' },
          'prod-logo': { mode: 'numeric', label: 'Largeur du logo en mm' },
        }[cle] || { label: cle };
        const c = champ(o.tag || 'input', txt, o);
        // Une valeur du récapitulatif est une CHAÎNE, pas une valeur typée : on
        // renvoie ce qui est tapé, vide compris (le serveur le note « — »).
        return brancher(c, cible, () => c.value.trim());
      }
    }
  };
}

// UNE SEULE BOÎTE À LA FOIS. La fiche complète s'attend (un aller-retour
// réseau) : au doigt, on tape deux fois avant qu'elle n'arrive, et deux
// aperçus s'empilaient — il fallait fermer deux fois pour revenir à la grille.
let ticketOuvert = false;

async function ouvrirTicket(r) {
  if (ticketOuvert) return;
  ticketOuvert = true;
  poserStyleTicket();
  let t;
  try {
    t = await ticketDeLaLigne(r);
  } catch (err) {
    ticketOuvert = false;
    // On le DIT plutôt que de laisser une promesse rejetée dans la console :
    // aucun appelant (la pastille du tableau, celle de la carte, le bouton de
    // la fiche) n'attend cette promesse. Sans ce message, taper sur le ticket
    // ne produisait tout simplement RIEN — et on retape.
    reportError(err);
    return;
  }
  const focusAvant = document.activeElement;
  const fond = document.createElement('div');
  fond.className = 'tk-modal';
  const carte = document.createElement('div');
  carte.className = 'tk-modal__card';
  carte.setAttribute('role', 'dialog');
  carte.setAttribute('aria-modal', 'true');
  carte.setAttribute('aria-label', `${t.titre}${t.ref ? ` ${t.ref}` : ''} — corriger et imprimer`);

  // Les champs du ticket, dans l'ordre où ils sont dessinés. `commettre()`
  // envoie ce qui est encore en cours de frappe : la fermeture et l'impression
  // passent par lui, donc aucune consigne ne se perd faute d'avoir quitté un
  // champ — et il ne coûte rien quand rien n'a bougé.
  const champs = [];
  const feuille = document.createElement('div');
  feuille.className = 'tk-modal__paper';
  feuille.appendChild(dessinerTicket(t, document, editeurTicket(r, champs)));
  const commettre = () => Promise.all(champs.map((c) => c.sauver()));

  const aide = document.createElement('p');
  aide.className = 'tk-modal__aide';
  aide.textContent = 'Touchez une valeur pour la corriger : c’est enregistré en la quittant.';

  const actions = document.createElement('div');
  actions.className = 'tk-modal__actions';
  const fermer = document.createElement('button');
  fermer.type = 'button';
  fermer.className = 'ask__btn';
  fermer.textContent = 'Fermer';
  const copier = document.createElement('button');
  copier.type = 'button';
  copier.className = 'ask__btn';
  copier.textContent = 'Copier le texte';
  const imprimer = document.createElement('button');
  imprimer.type = 'button';
  imprimer.className = 'ask__btn tk-modal__print';
  imprimer.textContent = 'Imprimer le ticket';
  // PASSER À L'AUTRE PAPIER SANS RESSORTIR. Le bon de commande décrit la même
  // ligne pour d'autres mains : fermer, la retrouver dans la grille et viser
  // l'autre pastille, c'est trois gestes pour une question qu'on se pose ici.
  const versBureau = document.createElement('button');
  versBureau.type = 'button';
  versBureau.className = 'ask__btn';
  versBureau.textContent = 'Bon de commande';
  versBureau.addEventListener('click', () => { partir(); ouvrirBureau(r); });
  actions.append(fermer, versBureau, copier, imprimer);
  carte.append(feuille, aide, actions);
  fond.append(carte);
  document.body.append(fond);

  let fini = false;
  const partir = () => {
    if (fini) return;
    fini = true;
    ticketOuvert = false;
    document.removeEventListener('keydown', onKey, true);
    // On commet AVANT de retirer la boîte, mais on ne l'attend pas : la lecture
    // des champs est immédiate (rien ne se perd), et le ticket se referme sans
    // faire patienter devant un aller-retour réseau.
    commettre();
    fond.remove();
    if (focusAvant && focusAvant.isConnected && focusAvant.focus) focusAvant.focus();
  };
  // Tabulation retenue dans la boîte, comme la confirmation de l'app : sans ça
  // le focus repart derrière le voile, sur une grille qu'on ne voit plus. Elle
  // parcourt maintenant AUSSI les champs du ticket — au clavier, on corrige une
  // ligne après l'autre sans jamais quitter le papier.
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // Dans un champ, Échap annule la frappe en cours (la règle de la grille) ;
      // ailleurs, il ferme le ticket.
      const encours = champs.find((c) => c.ctrl === document.activeElement);
      if (encours) { encours.annuler(); encours.ctrl.blur(); return; }
      partir();
      return;
    }
    // Entrée sur une ligne du ticket = « c'est bon » : ça enregistre et ça rend
    // la main, sans fermer — on corrige souvent deux choses de suite.
    if (e.key === 'Enter' && carte.contains(document.activeElement)
        && document.activeElement.tagName === 'INPUT') {
      e.preventDefault();
      document.activeElement.blur();
      return;
    }
    if (e.key !== 'Tab') return;
    const cibles = [...carte.querySelectorAll('input, textarea, select, button')];
    const i = cibles.indexOf(document.activeElement);
    e.preventDefault();
    cibles[(i + (e.shiftKey ? cibles.length - 1 : 1) + cibles.length) % cibles.length].focus();
  }
  document.addEventListener('keydown', onKey, true);
  fermer.addEventListener('click', partir);
  copier.addEventListener('click', () => {
    // Le ticket en texte : c'est ce qu'on colle dans un WhatsApp au client qui
    // demande « c'était quoi déjà, ma commande ? ». Refait à l'instant du clic,
    // corrections comprises.
    const dit = () => showToast('Ticket copié');
    commettre().then(() => {
      const texte = ticketTexte(modeleTicket(r));
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texte).then(dit, () => showToast('Copie refusée par le navigateur'));
      } else {
        showToast('Copie indisponible sur ce poste');
      }
    });
  });
  imprimer.addEventListener('click', () => {
    // Le modèle est REFAIT au moment d'imprimer : chaque correction a remis la
    // ligne à jour, donc le papier qui sort est celui qu'on vient de relire —
    // et jamais celui d'il y a deux minutes, à l'ouverture de la boîte.
    commettre().then(() => {
      const frais = modeleTicket(r);
      imprimerModele(frais, `Ticket ${frais.ref || r.billing_company || ''}`.trim());
    });
  });
  fond.addEventListener('click', (e) => { if (e.target === fond) partir(); });
  requestAnimationFrame(() => { fond.classList.add('open'); imprimer.focus(); });
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
// CHAQUE PLACE PORTE SA FAMILLE (29/08). Charlie, sur le menu d'étape : « quand
// je clique ici ça doit être lisible PAR FAMILLE plus facilement ». C'était une
// liste à plat de trente lignes qui répétaient toutes leur famille en tête —
// « Préparation du projet › » écrit neuf fois de suite — et il fallait lire la
// moitié de chaque ligne avant d'arriver à ce qui les distingue.
// La famille devient le TITRE d'un groupe, et l'option ne porte plus que la
// sous-étape. Le menu ne dit plus une seule fois de trop ce qu'il a déjà dit.
function placesDuPipeline(placeActuelle) {
  const places = [];
  for (const f of STAGES) {
    const subs = SUB_STAGES[f.slug] || [];
    // Une famille sans sous-étape n'est pas un groupe d'une seule ligne : elle
    // reste une entrée à elle seule, sinon le menu porte un titre pour rien.
    if (!subs.length) { places.push({ value: `${f.slug}|`, label: f.label }); continue; }
    if (placeActuelle === `${f.slug}|`) {
      places.push({ value: `${f.slug}|`, label: 'à préciser', groupe: f.label });
    }
    for (const s of subs) places.push({ value: `${f.slug}|${s.slug}`, label: s.label, groupe: f.label });
  }
  return places;
}

// ===========================================================================
// CE QU'IL Y A À PRODUIRE — le tableau modifiable de la fiche (28/08/2026)
// ===========================================================================
// Charlie : « je clique sur la ligne, elle s'ouvre façon tableau et je peux
// TOUT modifier ». Ce bloc-là n'existait nulle part dans la fiche : la
// référence, la couleur, les tailles et les faces ne se corrigeaient QUE
// depuis le ticket — c'est-à-dire depuis le papier, qui vient de disparaître.
//
// IL S'ENREGISTRE AU VOL, valeur par valeur. C'est la règle de la GRILLE (une
// cellule quittée est une cellule enregistrée) et non celle d'un formulaire :
// on vient rectifier UNE chose, vite. Un bouton « Enregistrer » demanderait de
// viser deux fois pour changer un nombre.
//
// LE PRIX SUIT TOUT SEUL. Le serveur retarife la ligne dès que les tailles ou
// la référence bougent (voir `retarifer`) : la réponse porte la ligne entière,
// donc le montant affiché est déjà le nouveau.
async function envoyerProduction(r, patchProd) {
  try {
    const maj = await api('PATCH', `/api/requests/${r.id}/fiche`, { prod: patchProd });
    if (!maj) return;
    Object.assign(r, maj);
    memoriserFiche(maj);
    // `rows` est REMPLACÉ à chaque rafraîchissement : l'objet qu'on tient peut
    // ne plus être celui de la grille. On repose la réponse sur les deux.
    const vivante = rows.find((x) => String(x.id) === String(r.id));
    if (vivante && vivante !== r) Object.assign(vivante, maj);
    rafraichirLigne(r);
    // ON REND LA LIGNE REFAITE. Corriger une taille refait le prix côté serveur
    // (voir chiffrage.js) : la fiche ouverte doit pouvoir reposer son « Prix
    // TTC », sinon elle garde l'ancien — et la marge et le reste à payer, qui
    // s'en déduisent, affichent des chiffres faux sur un écran qu'on lit pour
    // décider.
    return maj;
  } catch (err) {
    reportError(err);
    return null;
  }
}

// LA PROVENANCE A QUITTE LA FICHE (30/08, Charlie : « tout ca supprime »), et
// la liste avec : la fiche etait le SEUL endroit de l'application qui ecrivait
// cette colonne. Elle reste en base — elle porte l'historique — et rien ne la
// remplit plus.



// Les modèles d'étapes, lus UNE fois : ce sont quatre listes de mots qui ne
// changent qu'aux Réglages, pas à chaque ouverture de fiche.
let MODELES = [];
async function chargerModeles() {
  try { MODELES = await api('GET', '/api/modeles'); } catch (_) { MODELES = []; }
}

// LE BROUILLON D'E-MAIL EST RETIRÉ (30/08), avec le bouton « Email au client »
// qui l'ouvrait — seul appelant. Il passait par `mailto:`, donc par le client
// mail configuré sur le poste : sur un poste qui n'en a pas, le clic ne faisait
// rien du tout, sans rien dire.

// Bouton « ouvrir la fiche projet » : rejoint le cluster documents de la
// cellule Dossier. C'est LUI qui ouvre la bulle récapitulative — comme le ↗ de
// chaque carte dans l'écran du patron. Son propre `stopPropagation` suffit :
// aucun handler n'est posé sur <tr>, donc le reste de la ligne garde son
// édition inline (cliquer une cellule la corrige, ça ne doit pas ouvrir une
// fiche par-dessus les doigts).
// LA COLONNE TICKET — UNE ICÔNE, RIEN D'AUTRE. Elle a d'abord vécu en pastille
// dans le cluster de la cellule Dossier, où elle n'apparaissait que sur les
// dossiers du comptoir : elle décalait alors d'un cran toute la rangée de ses
// voisines sur les lignes saisies à la main. En colonne, tout tombe au même
// endroit d'une ligne à l'autre, et elle se retire d'un clic depuis le rail.
//
// Le NUMÉRO ne s'écrit pas dans la case : il tenait en 162 px de colonne pour
// une information qu'on ne lit qu'au moment de comparer avec le papier du
// client. Il est dans l'infobulle et dans le nom accessible, et en toutes
// lettres sur le ticket qu'un appui fait apparaître — ainsi que sur la carte.
// TOUTES les lignes en ont un : ce papier dit ce qu'il y a à produire, et une
// ligne tapée à la main se produit comme celles du comptoir.
// LES DEUX PAPIERS DE LA LIGNE, CÔTE À CÔTE (27/08/2026).
// Une commande sort DEUX documents, et ils ne servent pas aux mêmes mains :
//   · le TICKET part à l'établi et ne porte aucun argent ;
//   · le BON DE COMMANDE est celui du bureau — prix, taxe, règlement, marge.
// Ils étaient à deux endroits différents : le ticket sur la ligne, le bon de
// commande derrière l'ouverture de la fiche. Or c'est la MÊME question qu'on
// se pose devant une ligne (« sors-moi le papier »), et la réponse dépend
// seulement de qui le demande. Les deux sont donc là, au même endroit.
// ===========================================================================
// LA LIGNE S'OUVRE AU CLIC (28/08/2026)
// ===========================================================================
// Charlie : « je clique sur la ligne, elle s'ouvre façon tableau et je peux
// tout modifier ». C'est la seule porte : les trois pastilles qui la
// doublaient (ouvrir, ticket, bon de commande) sont parties.
//
// CE QUI NE DOIT PAS OUVRIR : tout ce qui se manipule DANS la ligne. Une
// ligne entière cliquable avale les gestes qu'elle porte déjà — la priorité,
// le pilote, l'état, la date, la poignée de glissement. On ne devine donc pas
// « le clic vient-il du fond ? » : on demande à la cible si elle est un
// contrôle, ce qui reste vrai quand on en ajoutera un.
//
// Un texte SÉLECTIONNÉ n'ouvre pas non plus : copier une référence à la souris
// finit toujours par un relâchement sur la ligne, et la fiche s'ouvrait par
// dessus la sélection qu'on venait de prendre.
function ouvrirAuClic(el, r) {
  el.addEventListener('click', (ev) => {
    if (ev.target.closest && ev.target.closest(ZONE_CLIQUABLE)) return;
    // Relâcher une ligne qu'on vient de déplacer émet aussi un `click` : sans
    // cette garde, tout glisser-déposer finissait par ouvrir la fiche du
    // dossier qu'on venait de ranger, par-dessus la liste qu'on voulait voir.
    if (glisserVientDeFinir()) return;
    // Un texte SÉLECTIONNÉ n'ouvre pas : copier une référence à la souris finit
    // toujours par un relâchement sur la ligne.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return;
    openLigneDetail(r.id);
  });
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
// EN PASSIF : posé en capture sur `window`, cet écouteur voit TOUS les
// défilements de l'application. Sans la mention, Chrome doit attendre qu'il
// ait rendu la main avant de composer l'image suivante — alors qu'il ne fait
// que refermer une infobulle et ne peut, par nature, pas annuler le geste.
window.addEventListener('scroll', hideTip, { capture: true, passive: true });
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
// Miroir de MOTIFS_BLOCAGE (server.js). Écrits ici plutôt que chargés : sept
// libellés fixes ne valent pas un aller-retour réseau à l'ouverture d'un menu,
// et l'écran doit s'ouvrir même quand le réseau hésite. `/api/motifs-blocage`
// reste la source pour qui veut les lire (et un test compare les deux listes).
const MOTIFS_BLOCAGE = [
  'Attente client', 'Attente fournisseur', 'Problème machine', 'Fichier manquant',
  'BAT non validé', 'Paiement manquant', 'Rupture de stock',
].map((label) => ({ label }));

function openReasonPrompt(anchor, title, value, onSave) {
  closeMenu();
  closeCalendar();
  const pop = document.createElement('div');
  pop.className = 'menu-pop reason-pop';

  const head = document.createElement('div');
  head.className = 'reason-title';
  head.textContent = `${title} — motif`;

  // LES SEPT MOTIFS DU PATRON (§6), en un clic — et le texte libre EN DESSOUS.
  //
  // Le motif était uniquement tapé à la main : impossible de compter, de trier,
  // ou de dire « quatre dossiers attendent le même fournisseur ». Les jetons
  // remplissent le champ ; ils ne le remplacent pas. Un blocage qui n'entre dans
  // aucune case existe, et le forcer dans une case le rendrait invisible.
  const jetons = document.createElement('div');
  jetons.className = 'reason-motifs';
  for (const m of MOTIFS_BLOCAGE) {
    const j = document.createElement('button');
    j.type = 'button';
    j.className = 'reason-motif';
    j.textContent = m.label;
    j.addEventListener('click', (e) => {
      e.stopPropagation();
      // On REMPLACE plutôt qu'on n'ajoute : deux motifs cliqués l'un après
      // l'autre donneraient « Attente clientAttente fournisseur ».
      input.value = m.label;
      input.focus();
    });
    jetons.append(j);
  }

  const input = document.createElement('textarea');
  input.className = 'reason-input';
  input.rows = 2;
  input.maxLength = FLAG_REASON_MAX;
  input.value = value || '';
  input.placeholder = 'ou en toutes lettres…';

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

  pop.append(head, jetons, input, actions);
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

// --- PATCH générique optimiste --------------------------------------------
// La valeur s'affiche AVANT la réponse du serveur — c'est ce qui rend l'outil
// vif au doigt. Mais si l'enregistrement échoue, elle doit repartir, ICI et
// tout de suite.
//
// On s'en remettait à `loadRows()` pour ça. Or c'est précisément quand le
// réseau est coupé que le PATCH échoue — et la relecture échouait donc avec
// lui : la valeur refusée restait à l'écran. Pire, `rows` gardait la mutation
// alors que `lastRowsSig` n'avait pas bougé : au retour du réseau, `poll()`
// comparait les signatures, les trouvait identiques et ne redessinait jamais.
// La tablette affichait indéfiniment une priorité, un pilote ou une ALERTE
// « BLOQUÉE » que personne n'avait enregistrés, et que le poste d'à côté ne
// voyait pas.
//
// On mémorise donc l'état d'avant pour les seuls champs qu'on touche, et on le
// remet en place sans rien demander au réseau. La relecture ne sert plus qu'à
// récupérer, quand elle le peut, ce qu'un collègue aurait changé entre-temps.
//
// `cible` (facultatif) est la puce sur laquelle le doigt vient d'appuyer : elle
// pousse un halo vert quand le serveur confirme. Sans elle, rien ne distingue à
// l'écran une modification PARTIE d'une modification ACCEPTÉE.
function patch(r, body, applyOptimistic, cible = null) {
  const avant = {};
  for (const cle of Object.keys(body)) avant[cle] = r[cle];
  applyOptimistic();
  // `then(succès, échec)` et NON `then(...).catch(...)` : avec un `.catch` en
  // bout de chaîne, la moindre erreur du code de succès aurait déclenché le
  // rollback — on aurait effacé de l'écran une valeur pourtant enregistrée.
  patchRow(r, body).then((recu) => {
    confirmerVisuellement(cible);
    absorberReponse(r, recu);
  }, (err) => {
    Object.assign(r, avant);
    // La ligne est reconstruite à partir de `r` : les puces peintes à la main
    // par `applyOptimistic` (priorité, type, pilote, alerte…) reviennent avec.
    invalidateRowCache(r.id);
    // La signature suit la donnée rétablie, sinon le prochain `poll()` croirait
    // la grille à jour et laisserait l'écran sur un état qui n'existe pas.
    lastRowsSig = signature(rows);
    applySortAndRender();
    reportError(err);
    // Puis, si le serveur répond de nouveau, on récupère au passage ce qu'un
    // collègue aurait changé pendant ce temps. Silencieux : le rollback
    // ci-dessus a déjà remis l'écran d'aplomb, et l'erreur a déjà été dite.
    resyncAfterRollback();
  });
}

// Halo vert « c'est enregistré » sur la puce touchée (voir .is-saved en CSS).
// On retire la classe avant de la reposer : deux appuis coup sur coup doivent
// rejouer l'animation, pas la laisser figée sur le premier.
function confirmerVisuellement(cible) {
  if (!cible || !cible.classList || !cible.isConnected) return;
  cible.classList.remove('is-saved');
  void cible.offsetWidth; // force le redémarrage de l'animation
  cible.classList.add('is-saved');
  setTimeout(() => cible.classList.remove('is-saved'), 800);
}

// Deux valeurs venues du serveur et de nous se comparent en texte : `1` et `'1'`
// disent la même priorité, `null` et `''` la même absence.
const memeValeur = (a, b) => (a == null ? '' : String(a)) === (b == null ? '' : String(b));

// CE QUE LE SERVEUR RENVOIE APRÈS UN PATCH ACCEPTÉ.
//
// On jetait sa réponse. Résultat : `updated_at` restait à sa vieille valeur en
// local, l'évènement SSE déclenché par notre propre modification faisait relire
// la liste, la signature ne collait plus — et `renderRows` RECONSTRUISAIT de
// fond en comble la ligne qu'on venait de toucher, ~150 ms après le doigt.
// Toute transition de couleur en cours était jetée avec l'ancien <tr> (un nœud
// neuf s'affiche directement à l'état final : plus rien à animer), le survol
// tombait, l'onde du ripple sautait, et sur la tablette la grille entière
// clignotait dès que deux personnes travaillaient en même temps.
//
// On adopte donc la ligne renvoyée. Si le serveur dit exactement ce que
// `applyOptimistic` a déjà peint, l'écran est DÉJÀ juste : on aligne seulement
// la signature et plus personne ne remonte le DOM. S'il diverge (sous-étape
// remise à zéro par un changement de famille, valeur normalisée), c'est LUI qui
// a raison et la ligne se reconstruit — comme avant.
function absorberReponse(r, recu) {
  // Pas de réponse : modification mise en file derrière une création (patchRow
  // rend `null`). Rien à adopter, et surtout pas de signature à figer.
  if (!recu || typeof recu !== 'object' || recu.id == null) return;
  if (String(recu.id) !== String(r.id)) return;   // la ligne a changé d'identité entre-temps
  let divergence = false;
  for (const cle of Object.keys(recu)) {
    if (cle === 'updated_at') continue;
    if (!memeValeur(recu[cle], r[cle])) divergence = true;
    r[cle] = recu[cle];
  }
  r.updated_at = recu.updated_at;
  // Sans ça, le `poll()` que notre propre évènement SSE déclenche trouverait la
  // grille périmée et redessinerait tout.
  lastRowsSig = signature(rows);
  if (divergence) invalidateRowCache(r.id);
  else marquerRenduAJour(r);
  // On repasse quand même par le tri : changer une priorité ou une échéance
  // DÉPLACE la ligne, et c'est `poll()` qui s'en chargeait jusqu'ici. Le
  // déplacement est désormais animé (cf. animerReordonnancement).
  applySortAndRender();
}

// Aligne la signature mémorisée du rendu sur la donnée courante : la ligne ne
// sera pas remontée au prochain rendu. Seule la vue AFFICHÉE peut être déclarée
// à jour — l'autre n'a pas été repeinte par `applyOptimistic`, on la périme.
function marquerRenduAJour(r) {
  const id = String(r.id);
  const sig = `${r.id}:${r.updated_at}`;
  const cartes = modeCartes();
  const ligne = rowEls.get(id);
  if (ligne) ligne.sig = cartes ? '' : sig;
  const carte = cardEls.get(id);
  if (carte) carte.sig = cartes ? sig : '';
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
  const quoi = [nomClientAffiche(r.billing_company, r.client_type), r.product]
    .filter(Boolean).join(' — ') || 'cette commande';
  const ok = await confirmerAction(
    'Supprimer cette commande ?',
    `${quoi} sera retirée du planning définitivement.`,
  );
  if (!ok) return;
  // La commande ouverte HORS de la liste ne peut pas « disparaître de la
  // grille » : elle n'y est pas. On ferme sa fiche, sinon on resterait devant un
  // dossier supprimé, en apparence intact.
  if (ligneHorsListe && String(ligneHorsListe.id) === String(r.id)) fermerFicheAtelier();
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

// DEUX LISTES, PAS UNE — les confondre a éteint le glisser des lignes.
//
// `ZONE_SANS_PRISE`, ce qui n'est JAMAIS une prise : les vrais contrôles. Sur
// une carte du planning toute la surface est saisissable — la poignée EST la
// carte — mais elle porte aussi des boutons (référent, supprimer), et
// `preventDefault()` sur `pointerdown` supprime les évènements souris de
// compatibilité, donc le `click` qui suit. Sans cette garde, aucun bouton posé
// sur une zone de prise ne répondrait plus.
//
// `ZONE_CLIQUABLE`, ce qui n'OUVRE PAS la fiche au clic : les mêmes contrôles,
// PLUS la poignée. La ligne s'ouvre au clic depuis le 28/08 : attraper sa
// poignée ne doit pas ouvrir son dossier.
//
// LA POIGNÉE APPARTIENT À LA SECONDE LISTE, PAS À LA PREMIÈRE. Entrée le 28/08
// dans la liste unique que les deux gestes se partageaient alors, elle a éteint
// le glisser en silence : appuyer sur les six points vise le `<svg>` du
// pictogramme, soit un élément qui n'EST pas la poignée mais dont
// `closest('.handle')` la trouve — la garde « ce n'est pas une prise » se
// déclenchait donc sur la prise elle-même. Il ne restait que les 4 px de marge
// autour du dessin pour attraper une ligne. C'est exactement ce que l'atelier
// décrivait : « on n'arrive pas à attraper les six points ».
const ZONE_SANS_PRISE = 'button, a, input, select, textarea, label, [role="button"]';
const ZONE_CLIQUABLE = `${ZONE_SANS_PRISE}, .handle`;

// À la SOURIS, relâcher une carte qu'on vient de déplacer émet aussi un `click`
// sur elle. Sans cette garde, tout glisser-déposer se terminait par l'ouverture
// de la fiche du dossier qu'on venait de ranger — par-dessus la liste qu'on
// voulait justement voir se réordonner.
let finGlisser = 0;
const glisserVientDeFinir = () => performance.now() - finGlisser < 300;

function attachDrag(handle, tr, r) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target !== handle && e.target.closest && e.target.closest(ZONE_SANS_PRISE)) return;
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
      pointerId: e.pointerId, active: false, ghost: null,
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
    // Les trois sorties sans dépose (cf. annulerGlisser) : Échap, la fenêtre qui
    // part, le menu contextuel. Posées et retirées avec le geste, jamais à
    // demeure — un écouteur de clavier qui survit au glisser avale l'Échap de
    // la fiche.
    window.addEventListener('keydown', toucheGlisser, true);
    window.addEventListener('blur', annulerGlisser);
    window.addEventListener('contextmenu', annulerGlisser);
  });
}

function beginDrag() {
  const { tr, r } = dragState;
  dragState.active = true;
  // UNE ÉTIQUETTE, PAS UNE BARRE. Le fantôme prenait la LARGEUR DE LA LIGNE —
  // 1 308 px sur le poste du patron — et se posait sous le curseur : il
  // recouvrait la ligne visée, débordait sur le panneau « Colonnes » et sortait
  // de la fenêtre. On ne voyait plus où l'on déposait, alors que c'est
  // justement ce qu'on regarde. La ligne d'origine, elle, se déplace déjà en
  // direct dans la liste (`.dragging`, cf. placerDansLaListe) : elle dit la
  // destination, l'étiquette dit ce qu'on transporte — deux rôles, deux tailles.
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = nomClientAffiche(r.billing_company, r.client_type) || r.product || 'commande';
  document.body.appendChild(ghost);
  dragState.ghost = ghost;
  dragState.wrap = document.querySelector('.grid-wrap');
  tr.classList.add('dragging');
  document.body.classList.add('dragging-active');
  // LA CARTE EST EN MAIN — et on le SENT. Au doigt, rien ne distinguait le
  // moment où la commande se décroche de la liste : le fantôme paraît sous le
  // doigt, donc caché par lui. Un tic de 12 ms au décrochage, comme les listes
  // réordonnables du système. Absent d'iOS et de la plupart des ordinateurs :
  // l'appel est facultatif, jamais une condition de fonctionnement.
  if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
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
  // évènement, sans déclencher de layout/repaint. L'étiquette se pose À CÔTÉ du
  // curseur (14 px à droite, centrée sur lui) et jamais dessous : ce qu'on
  // regarde en glissant, c'est la ligne qu'on vise, pas ce qu'on tient. Le
  // décalage vit dans le `transform`, donc sans mesurer la boîte au vol.
  dragState.ghost.style.transform =
    `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(14px, -50%)`;
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
  // CE QUI N'A PAS DE `data-slug` N'EST PAS UNE ÉTAPE, ET NE REÇOIT RIEN.
  // Deux entrées du rail empruntent la classe `.stage` pour en garder le
  // rythme sans en être : la ligne de repli (« + 4 étapes vides ») et l'agenda
  // des retraits. `closest('.stage')` les ramasse toutes les deux — et sans ce
  // refus elles passaient le test, leur `data-slug` valant `undefined`, il
  // « diffère » donc de l'étape de la ligne : elles devenaient cibles, et la
  // dépose partait en PATCH `stage: undefined`.
  // LA GARDE PORTE SUR L'ABSENCE DE SLUG, plus sur le nom d'une classe : la
  // première écriture nommait `.stage-repli`, et l'agenda serait passé à
  // travers en silence le jour où il est arrivé.
  if (!stageEl.dataset.slug) return false;
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

// PASSER SUR « + N ÉTAPES VIDES » PENDANT UN GLISSER LES OUVRE. Le geste ne
// s'interrompt pas : le rail s'allonge sous le curseur et la ligne peut se
// poser dans l'étape voulue. On ne repeint QU'UNE FOIS par phase — le suivi en
// vol tourne à chaque frame, reconstruire le rail soixante fois par seconde
// aurait fait clignoter tout le côté gauche.
function ouvrirAuGlisser(el) {
  const repli = el && el.closest ? el.closest('.stage-repli') : null;
  if (!repli) return false;
  const famille = repli.dataset.repli;
  if (!famille || railGlisse.has(famille)) return false;
  railGlisse.add(famille);
  renderSidebar();
  return true;
}

// Le rail se referme à la fin du geste : l'ouverture était temporaire, elle ne
// s'enregistre pas. Une étape où l'on vient de déposer n'est plus vide et reste
// visible d'elle-même.
function refermerApresGlisser() {
  if (!railGlisse.size) return;
  railGlisse = new Set();
  renderSidebar();
}

function updateDragTarget() {
  if (!dragState) return;
  dragState.raf = 0;
  const x = dragState.lastX, y = dragState.lastY;
  const el = document.elementFromPoint(x, y);
  document.querySelectorAll('.stage.drop-target').forEach((s) => s.classList.remove('drop-target'));
  // L'ouverture change la hauteur du rail sous le curseur : on relit ce qui s'y
  // trouve MAINTENANT plutôt que de viser l'élément d'avant.
  const ouvert = ouvrirAuGlisser(el);
  const sous = ouvert ? document.elementFromPoint(x, y) : el;
  const stageEl = sous && sous.closest ? sous.closest('.stage') : null;
  if (stageEl) {
    if (stageAcceptsDrop(stageEl, dragState.r)) stageEl.classList.add('drop-target');
  } else {
    // réordonnancement vertical dans la vue courante (tableau ou cartes)
    placerDansLaListe(dragState.tr, y);
  }
  autoScroll(y);
}

// TOUT CE QUI TIENT LE GESTE EN L'AIR, RENDU EN UNE SEULE FOIS : les écouteurs,
// la capture de pointeur, le suivi en vol, les marques posées sur la ligne et
// l'étiquette. Trois sorties s'en servent — la dépose, l'abandon, et le simple
// clic qui n'a jamais franchi le seuil — et elles doivent défaire exactement la
// même chose. Ce qu'une seule d'entre elles oublierait resterait collé à l'écran
// jusqu'au rechargement.
function relacherGlisser(ds) {
  if (ds.raf) cancelAnimationFrame(ds.raf);
  if (defilementRaf) { cancelAnimationFrame(defilementRaf); defilementRaf = 0; }
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragEnd);
  window.removeEventListener('keydown', toucheGlisser, true);
  window.removeEventListener('blur', annulerGlisser);
  window.removeEventListener('contextmenu', annulerGlisser);
  try { ds.handle.releasePointerCapture(ds.pointerId); } catch (_) {}
  // La ligne cesse d'être « prise » quoi qu'il arrive ensuite — y compris sur
  // un simple tap. L'oublier, c'était figer la ligne : jamais reconstruite, elle
  // gardait indéfiniment ce qu'elle affichait au moment du tap, sans plus jamais
  // suivre le temps réel.
  ds.tr.classList.remove('prise-en-cours');
  ds.tr.classList.remove('dragging');
  if (ds.ghost) ds.ghost.remove();
  document.body.classList.remove('dragging-active');
  document.querySelectorAll('.stage.drop-target').forEach((s) => s.classList.remove('drop-target'));
  hideTip();
  dragState = null;
}

// TROIS FAÇONS DE LÂCHER UNE LIGNE SANS LA DÉPOSER, et Windows les sert toutes
// les trois : la touche Échap (le geste qu'on cherche quand on s'aperçoit qu'on
// tient la mauvaise ligne), Alt+Tab qui emporte la fenêtre au milieu du glisser,
// et le clic droit qui pose le menu du système par-dessus. Aucune n'émet de
// `pointerup` : sans cette sortie, l'étiquette restait collée à l'écran, la
// ligne figée en transparence, et le suivi en vol tournait dans le vide jusqu'au
// rechargement. Rien ne se dépose et rien ne s'écrit — la grille reprend
// simplement l'ordre qu'elle avait.
function annulerGlisser() {
  if (!dragState) return;
  const ds = dragState;
  const enVol = ds.active;
  relacherGlisser(ds);
  if (!enVol) return;
  // Le bouton relâché après coup émet quand même un `click` sur la ligne : sans
  // cette marque, abandonner un glisser ouvrait la fiche qu'on ne voulait pas.
  finGlisser = performance.now();
  refermerApresGlisser();
  applySortAndRender();
}

// En CAPTURE et arrêtée net : Échap referme aussi le calendrier et la fiche, et
// un geste en cours passe avant eux.
function toucheGlisser(e) {
  if (e.key !== 'Escape' || !dragState) return;
  e.preventDefault();
  e.stopPropagation();
  annulerGlisser();
}

async function onDragEnd(e) {
  if (!dragState) return;
  // Seul le doigt qui a commencé le glisser peut le terminer. Sans ce filtre,
  // le simple fait de lever un AUTRE doigt (paume posée sur la dalle) déposait
  // la commande là où CE doigt-là se trouvait — un dépôt fantôme, parfois sur
  // une entrée du rail, donc un changement d'étape que personne n'a demandé.
  if (e.pointerId !== dragState.pointerId) return;
  const ds = dragState;
  // La cible se lit AVANT de rendre le geste : `relacherGlisser` retire les
  // marques, pas ce qui se trouve sous le curseur.
  const el = ds.active ? document.elementFromPoint(e.clientX, e.clientY) : null;
  const stageEl = el && el.closest ? el.closest('.stage') : null;
  relacherGlisser(ds);

  if (!ds.active) return; // simple clic, pas un drag
  finGlisser = performance.now();

  // Geste ANNULÉ par le système (défilement natif qui prend la main, alerte,
  // bascule d'application sur tablette…) : rien ne se dépose, rien ne s'écrit —
  // la grille reprend simplement son ordre trié.
  if (e.type === 'pointercancel') { refermerApresGlisser(); applySortAndRender(); return; }

  // Ligne encore en cours de création (id temporaire, ex. duplication non
  // brouillon) : on ne peut pas la déplacer / réordonner tant que son id réel
  // n'est pas revenu (sinon PATCH/POST vers /api/requests/tmp-…). On annule le
  // geste proprement et on remet la grille en ordre.
  if (isTempId(ds.r.id)) {
    showToast('Commande en cours de création — réessaie dans un instant.');
    refermerApresGlisser();
    applySortAndRender();
    return;
  }

  // On referme APRÈS avoir lu la cible : la refermer avant retirerait du
  // document l'étape sur laquelle on vient de relâcher.
  const aRefermer = railGlisse.size > 0;

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
  if (aRefermer) refermerApresGlisser();
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
  api('PATCH', `/api/requests/${r.id}`, { stage: slug, sub_stage: targetSub }).catch(async (err) => {
    rows = prevRows;
    r.stage = prevStage;
    r.sub_stage = prevSub;
    lastRowsSig = signature(rows);
    if (familyChanged) { bumpCount(viewSlug, +1); bumpCount(slug, -1); }
    applySortAndRender();

    // LE VERROU DU BAT (§20). Le serveur a refusé le passage en production
    // parce que le BAT n'est pas validé. « La Direction peut forcer le passage
    // si nécessaire » : on le lui PROPOSE ici, plutôt que de la laisser
    // chercher un bouton qui n'existe pas — ou contourner par une autre étape,
    // ce qui viderait le verrou de tout sens.
    const d = err && err.detail;
    if (d && d.batBloque && d.forcable) {
      const ok = await confirmerAction(
        'Produire sans BAT validé ?',
        'Le client n’a pas validé le bon à tirer. Passer en production maintenant, '
        + 'c’est accepter de refaire la pièce s’il demande une correction.',
        'Passer quand même',
      );
      if (ok) {
        try {
          await api('PATCH', `/api/requests/${r.id}`, { stage: slug, sub_stage: targetSub, forcer: true });
          await loadRows();
          applySortAndRender();
          return;
        } catch (e2) { reportError(e2); }
      }
      resyncAfterRollback();
      return;
    }
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
  // L'étape est retenue MAINTENANT : le retour en arrière (plus bas) part après
  // un aller-retour serveur, et le doigt a pu changer d'étape entre-temps —
  // `currentStage` désignerait alors la mauvaise.
  const etapeRangee = currentStage;
  const premierRangement = !ordreManuel.has(etapeRangee);
  if (premierRangement) {
    ordreManuel.add(etapeRangee);
    saveOrdreManuel(etapeRangee, true).catch(reportError);
    renderOrdreReset();
  }
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
      ordreManuel.delete(etapeRangee);
      saveOrdreManuel(etapeRangee, false).catch(() => {});
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
  const etape = currentStage;
  ordreManuel.delete(etape);
  saveOrdreManuel(etape, false).catch(reportError);
  renderOrdreReset();
  applySortAndRender();
});

// Auto-défilement vertical quand le doigt approche des bords de la grille.
// Renvoie vrai si la liste a RÉELLEMENT bougé (butée haute / basse : elle ne
// bouge plus, inutile de recalculer la cible de dépose derrière).
//
// LA VITESSE SUIT LE DOIGT. Elle était fixe (14 px par image) : sur la tablette,
// où l'écran ne montre que trois à quatre cartes à la fois, remonter une
// commande de la fin d'une étape de cinquante demandait de tenir le doigt au
// bord pendant une dizaine de secondes — sans rien pouvoir viser, puisque la
// liste passe à la même allure quoi qu'on fasse. Elle est désormais
// PROPORTIONNELLE à l'enfoncement dans la marge : effleurer le bord fait glisser
// la liste d'un cran, s'y appuyer franchement la fait défiler vite. C'est le
// geste des listes du système, et il rend le bord utilisable pour VISER.
const DEFILEMENT_MIN = 4;    // px par image, au premier pixel de la marge
const DEFILEMENT_MAX = 30;   // px par image, doigt collé au bord
function autoScroll(y) {
  const wrap = dragState && dragState.wrap ? dragState.wrap : document.querySelector('.grid-wrap');
  if (!wrap) return false;
  const rect = wrap.getBoundingClientRect();
  const marge = 72;
  const avant = wrap.scrollTop;
  // `part` : 0 au bord intérieur de la marge, 1 au bord de la liste. Mise au
  // carré pour que la zone lente occupe l'essentiel de la marge — c'est là
  // qu'on ajuste, la vitesse haute ne sert qu'à traverser.
  const vitesse = (part) => DEFILEMENT_MIN
    + (DEFILEMENT_MAX - DEFILEMENT_MIN) * Math.min(1, Math.max(0, part)) ** 2;
  if (y < rect.top + marge) wrap.scrollTop -= vitesse((rect.top + marge - y) / marge);
  else if (y > rect.bottom - marge) wrap.scrollTop += vitesse((y - rect.bottom + marge) / marge);
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
  // Un <th> n'est pas focusable : sans tabindex, le tri des colonnes était le
  // seul geste du tableau inatteignable au clavier sur le poste du patron.
  th.tabIndex = 0;
  th.setAttribute('role', 'button');
  const trier = () => {
    const key = th.dataset.sort;
    if (sort.key === key) sort.dir *= -1;
    else sort = { key, dir: 1 };
    applySortAndRender();
  };
  th.addEventListener('click', trier);
  th.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trier(); }
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
// C'est AUSSI ce que `--cols-off` retranche au plancher de la grille quand on
// range une colonne : cinq de ces valeurs avaient dérivé du CSS (handle, stars,
// flag, sub_stage, del), donc la grille se voyait retrancher une largeur que la
// colonne rangée n'occupait pas. Elles sont remises au miroir le 27/08.
const COL_DEFAULTS = {
  handle: 44, stars: 96, responsable: 132, flag: 120, client: 214,
  product: 220, price: 132, sub_stage: 140, description: 260, deadline: 148, del: 158,
};

let colWidths = {};
try { colWidths = JSON.parse(localStorage.getItem(COLW_KEY) || '{}') || {}; } catch (_) { colWidths = {}; }

// --- Choix des colonnes affichées : rail de droite --------------------------
// Le patron compose son écran. Une colonne retirée descend dans « Retirées »
// et RESTE affichée dans le rail — c'est ce qui permet de la remettre d'un
// clic sans aller chercher un menu.
//
// Le choix est GLOBAL (pas par étape) : c'est un réglage de poste, pas un
// paramètre de navigation. Une colonne cochée reste à SA PLACE quelle que
// soit l'étape affichée — masquer « Prix TTC » en Production le temps d'un
// clic faisait sauter « Infos » et « Date souhaitée » d'une étape à l'autre
// (Charlie, 30/08) : deux tableaux ouverts à un clic l'un de l'autre doivent
// tomber en face, pas se redessiner à chaque catégorie. La colonne reste donc
// montée, simplement vide sur les étapes qu'elle ne remplit jamais (`auto`) ;
// le rail l'écrit noir sur blanc (voir la mention « vide ici ») pour qu'on ne
// croie pas à un bug.
// `v3` : nouvelle clé volontairement, pour que TOUS les postes repartent sur la
// ligne arrêtée le 27/08 (cf. COLS_DEFAUT). Un poste qui avait réglé ses
// colonnes en v2 aurait sinon gardé son écran, et la nouvelle ligne par défaut
// ne serait apparue nulle part.
const COLS_KEY = 'olda_cols_v4';
// `cls` = la classe portée par le <th> ET les <td> de la colonne, telle que
// posée dans index.html et buildRow(). `auto` = la règle qui dit si l'étape
// courante la remplit jamais — sert au seul badge « vide ici » du rail, ne
// masque plus rien. `surCarte` = colonne qui existe DANS LES
// DEUX VUES (le ticket : une colonne du tableau, un bouton sur la carte) — la
// retirer ne fait donc pas basculer d'une vue à l'autre.
const PLANNING_COLS = [
  { key: 'stars',       label: 'Priorité' },
  // « Qui suit », le même mot qu'en fiche et que dans le <th> : trois écrans,
  // un seul nom. « Responsable » nommait la colonne et « Qui suit » la fiche,
  // pour le même contrôle.
  { key: 'responsable', label: 'Qui suit' },
  { key: 'client',      label: 'Nom du dossier client', locked: true },
  // « ARTICLE » ET NON « DESCRIPTION » : la colonne porte `product`, c'est-à-dire
  // ce qu'il y a à produire — et le ticket de l'atelier l'appelle déjà ARTICLE.
  // « Description » la nommait comme sa voisine « Infos », qui porte la note.
  { key: 'product',     label: 'Article' },
  // LE PRIX EXISTE DANS LES DEUX VUES (colonne du tableau, bloc TTC de la
  // carte) : le décocher doit le retirer des deux, pas rappeler le tableau
  // complet — c'est exactement ce que dit `surCarte`. À l'atelier il n'apprend
  // rien et prend la place de ce qu'on cherche.
  { key: 'price',       label: 'Prix TTC', surCarte: true, auto: (slug) => !PRICE_VISIBLE_STAGES.has(slug) },
  { key: 'sub_stage',   label: 'Sous-étape', auto: (slug) => !familyHasSub(slug) },
  // CE QU'IL Y A À FAIRE, fait par fait. Trois cases plutôt qu'une : le chef
  // d'atelier veut la largeur du DTF au dos, la vendeuse veut la référence et
  // la couleur, personne ne veut les trois tout le temps. Elles vivent dans les
  // DEUX vues (voir blocProduction), d'où `surCarte`.
  // `horsTableau` : elles n'ont pas de colonne à elles — le bloc se pose dans
  // la cellule « Infos » et dans le bloc « Projet » de la carte.
  { key: 'feu',          label: 'Ce qui manque (devis/BAT/argent)', surCarte: true, horsTableau: true },
  { key: 'prod_ref',     label: 'Référence & couleur', surCarte: true, horsTableau: true },
  { key: 'prod_dtf',     label: 'Couleur du marquage', surCarte: true, horsTableau: true },
  { key: 'prod_tailles', label: 'Quantité par taille', surCarte: true, horsTableau: true },
  { key: 'prod_logos',   label: 'Largeur des logos', surCarte: true, horsTableau: true },
  { key: 'description', label: 'Infos' },
  { key: 'deadline',    label: 'Date souhaitée' },
  { key: 'flag',        label: 'État' },
];

// Colonnes qu'on peut éteindre (toutes sauf l'identité de la ligne).
const COLS_ETEIGNABLES = new Set(PLANNING_COLS.filter((c) => !c.locked).map((c) => c.key));
// Celles dont la case change ce qu'une ligne DESSINE, sans changer de vue : il
// faut les redessiner à la main. Le ticket n'en est pas — sa place reste
// réservée sur toutes les cartes, c'est le CSS qui l'affiche ou non.
const COLS_REDESSINENT = new Set(['price', 'feu', 'prod_ref', 'prod_dtf', 'prod_tailles', 'prod_logos']);
// Celles qui n'existent QUE dans le tableau : ce sont elles, et elles seules,
// qui décident de la vue (cf. modeCartes). Le ticket en est exclu — le retirer
// sur les cartes doit retirer le bouton, pas rappeler le tableau complet.
const COLS_TABLEAU = new Set(
  PLANNING_COLS.filter((c) => !c.locked && !c.surCarte).map((c) => c.key),
);

// CE QU'UNE LIGNE DIT PAR DÉFAUT (Charlie, 27/08) : qui la suit, à qui c'est,
// ses deux papiers, ce que ça coûte, ce qui manque avant de produire, les
// infos, et pour quand. Le reste attend dans le rail, à un clic.
//
// « QUI SUIT » EST DANS LA LIGNE, pas seulement dans le rail : on attribue un
// dossier en le voyant passer, pas en ouvrant sa fiche. C'est précisément
// parce que 24 dossiers sur 184 ont un pilote qu'il faut le demander là où
// l'œil se pose.
//
// Deux d'entre eux (Infos, Date souhaitée) n'existent que dans le tableau : le
// planning s'ouvre donc sur le TABLEAU et non plus sur les cartes. « Revenir
// aux cartes » est toujours là, en bas du rail.
//
// La colonne « Infos » porte aussi les blocs SANS colonne à eux — ce qui manque
// et les quatre faits de production (cf. `horsTableau`) : les allumer se voit
// dans cette cellule-là.
// `product` — L'ARTICLE — EST ENTRÉ LE 27/08 AU SOIR. Compté sur les 187
// dossiers de la PRODUCTION, colonne par colonne :
//
//   product (l'article)      186 / 187   99 %   ← et il n'était pas sur la ligne
//   quantity                 146 / 187   78 %
//   deadline                 124 / 187   66 %
//   description (Infos)      122 / 187   65 %
//   contact_phone             82 / 187   44 %
//   responsable (Qui suit)    75 / 187   40 %
//   project_value (Prix TTC)  72 / 187   39 %
//   color                      9 / 187    5 %
//   referent                   5 / 187    3 %
//   flag (État)                3 / 187    2 %
//
// La donnée la MIEUX remplie de la base était la seule absente de la ligne :
// le planning d'un atelier ne disait pas ce qu'il y avait à produire. Elle se
// pose juste après le client — qui, pour quoi — avant l'argent et les papiers.
const COLS_DEFAUT = new Set(['responsable', 'client', 'product', 'price', 'feu', 'description', 'deadline']);
const COLS_MASQUEES_DEFAUT = new Set(
  PLANNING_COLS.filter((c) => !c.locked && !COLS_DEFAUT.has(c.key)).map((c) => c.key),
);

// LE CHOIX SUIT LA PERSONNE, PLUS L'APPAREIL. Le chef d'atelier ne veut pas du
// prix qui pollue sa ligne mais lui faut la largeur du DTF au dos ; la boutique
// veut l'inverse — et les deux se nomment tour à tour sur le même PC. La clé
// porte donc le prénom du poste (`olda.qui`, cf. poste.js), et le réglage
// commun à la machine sert de point de départ à qui n'a pas encore choisi :
// personne ne retrouve son écran remis à zéro le jour de la mise à jour.
const colsKey = () => {
  const qui = lirePoste();
  return qui ? `${COLS_KEY}:${qui}` : COLS_KEY;
};

// ---------------------------------------------------------------------------
// L'ORDRE DES COLONNES SE RÈGLE (Charlie, 27/08/2026)
// ---------------------------------------------------------------------------
// « les colonnes ici je dois pouvoir les déplacer comme je le souhaite, mettre
// en premier Documents par exemple. »
//
// LE PIÈGE, D'ABORD. L'ordre était écrit en dur à TROIS endroits qui doivent
// rester au même rang : le <colgroup>, le <thead> et buildRow(). Un <col> agit
// sur la colonne de MÊME RANG — son `data-col` n'est qu'une étiquette. Déplacer
// un <th> sans son <col> vise la mauvaise colonne, en silence.
//
// On ne réécrit donc pas les trois : on applique LA MÊME PERMUTATION aux trois.
// Le <colgroup> reste la source de vérité rang → clé (il porte `data-col`), et
// tout le reste s'y range. L'invariant est tenu par construction, pas par
// vigilance.
//
// La poignée reste en tête et les actions en queue : ce ne sont pas des
// colonnes, ce sont les bords de la ligne.
const ORDRE_FIXE_DEBUT = ['handle'];
const ORDRE_FIXE_FIN = ['del'];
const ordreKey = () => `${colsKey()}:ordre`;

function clesDuTableau() {
  const cg = $grid && $grid.querySelector('colgroup');
  return cg ? [...cg.children].map((c) => c.dataset.col) : [];
}

let ordreCols = null;   // null = l'ordre du gabarit

function lireOrdreCols() {
  const connues = clesDuTableau();
  if (!connues.length) return null;
  for (const cle of [ordreKey(), `${COLS_KEY}:ordre`]) {
    try {
      const brut = JSON.parse(localStorage.getItem(cle) || 'null');
      if (!Array.isArray(brut)) continue;
      // On repart des clés RÉELLES du tableau : un ordre enregistré sous une
      // version précédente peut nommer une colonne qui n'existe plus, ou en
      // oublier une nouvelle. Ce qu'il connaît donne le rang, le reste suit.
      const garde = brut.filter((k) => connues.includes(k));
      const manque = connues.filter((k) => !garde.includes(k));
      return normaliserOrdre([...garde, ...manque]);
    } catch (_) { /* stockage refusé ou illisible : on essaie la suivante */ }
  }
  return null;
}

// La poignée devant, les actions derrière, quoi qu'on ait enregistré.
function normaliserOrdre(liste) {
  const milieu = liste.filter((k) => !ORDRE_FIXE_DEBUT.includes(k) && !ORDRE_FIXE_FIN.includes(k));
  return [...ORDRE_FIXE_DEBUT, ...milieu, ...ORDRE_FIXE_FIN];
}

const ordreVoulu = () => ordreCols || clesDuTableau();

// LA MÊME PERMUTATION POUR LES TROIS RANGS. `append` déplace des nœuds
// existants : on ne reconstruit rien, donc rien ne perd son focus ni son état.
function permutationCols() {
  const connues = clesDuTableau();
  const voulu = ordreVoulu();
  if (voulu.length !== connues.length) return null;
  const perm = voulu.map((k) => connues.indexOf(k));
  return perm.some((i) => i < 0) ? null : perm;
}

function rangerCellules(parent, perm) {
  if (!parent) return;
  const enfants = [...parent.children];
  if (enfants.length !== perm.length) return;   // ligne d'un autre gabarit
  parent.append(...perm.map((i) => enfants[i]));
}

function appliquerOrdreColonnes() {
  if (!$grid) return;
  const perm = permutationCols();
  // L'identité (0,1,2…) ne demande aucun travail : c'est le cas le plus fréquent.
  if (!perm || perm.every((v, i) => v === i)) return;
  rangerCellules($grid.querySelector('colgroup'), perm);
  rangerCellules($grid.querySelector('thead tr'), perm);
  if ($rows) for (const tr of $rows.children) rangerCellules(tr, perm);
}

function poserOrdreCols(liste) {
  ordreCols = normaliserOrdre(liste);
  try { localStorage.setItem(ordreKey(), JSON.stringify(ordreCols)); } catch (_) { /* stockage refusé */ }
  appliquerOrdreColonnes();
  renderColbar();
}

function lireHiddenCols() {
  // On ne garde que des clés connues et jamais une colonne verrouillée : un
  // localStorage d'une version précédente ne doit pas pouvoir faire disparaître
  // l'identité de la ligne, ni ressusciter une colonne retirée du rail.
  for (const cle of [colsKey(), COLS_KEY]) {
    try {
      const saved = JSON.parse(localStorage.getItem(cle) || 'null');
      if (!Array.isArray(saved)) continue;
      return new Set(saved.filter((k) => COLS_ETEIGNABLES.has(k)));
    } catch (_) { /* stockage refusé ou illisible : on essaie la suivante */ }
  }
  return new Set(COLS_MASQUEES_DEFAUT);
}

let hiddenCols = lireHiddenCols();

// VUE ÉPURÉE tant qu'aucune colonne DU TABLEAU n'est allumée. C'est la même
// commande pour les deux vues : le rail « Colonnes » dit ce qu'on veut voir, et
// le planning passe des cartes au tableau dès qu'on lui demande une colonne.
const modeCartes = () => COLS_TABLEAU.size > 0
  && [...COLS_TABLEAU].every((k) => hiddenCols.has(k));

function saveHiddenCols() {
  try { localStorage.setItem(colsKey(), JSON.stringify([...hiddenCols])); } catch (_) {}
}

// QUAND LA PERSONNE CHANGE, L'ÉCRAN CHANGE AVEC ELLE. Sans ça, Julien reprenait
// le poste et gardait l'écran de Mélina jusqu'au prochain rechargement — donc
// le prix qu'il ne veut pas voir, et pas la largeur du dos.
document.addEventListener('olda:poste', () => {
  // Le rail suit la personne lui aussi : le chef d'atelier veut sa production
  // dépliée, la boutique son chiffrage. Il se repeint TOUJOURS, même quand les
  // colonnes n'ont pas bougé — les deux réglages sont indépendants.
  railDeplie = lireRailDeplie();
  // Le pli des phases suit la personne comme celui des étapes vides : le chef
  // d'atelier ne suit pas les mêmes phases que la boutique.
  railZonesPliees = lireZonesPliees();
  renderSidebar();
  const avant = [...hiddenCols].sort().join(',') + '|' + (ordreCols || []).join(',');
  hiddenCols = lireHiddenCols();
  // L'ORDRE SUIT LA PERSONNE, comme le choix des colonnes : le chef d'atelier et
  // la boutique se nomment tour à tour sur le même PC.
  ordreCols = lireOrdreCols();
  if ([...hiddenCols].sort().join(',') + '|' + (ordreCols || []).join(',') === avant) return;
  applyColVisibility();
  appliquerOrdreColonnes();
  renderColbar();
  // Les lignes déjà montées portent le choix de la personne PRÉCÉDENTE : leur
  // signature ne dit rien du réglage, elle ne suit que la date de la commande.
  invalidateRowCache(null);
  applySortAndRender();
});

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
    // Les trois faits de production n'ont PAS de colonne à eux : ils vivent
    // dans la cellule « Infos » et dans le bloc « Projet » de la carte. Leur
    // poser une classe `off-…` que rien ne lit laisserait croire, en lisant la
    // grille, qu'une colonne y répond.
    if (c.horsTableau) continue;
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

  // ON DÉPLACE UNE COLONNE EN LA GLISSANT. Seules celles qui ONT une colonne :
  // le feu et les faits de production vivent dans la cellule « Infos », il n'y
  // a rien à ranger pour eux. Et seulement dans « Sur l'écran » — une colonne
  // rangée n'a pas de rang.
  const deplacable = !col.horsTableau && !hiddenCols.has(col.key)
    && !ORDRE_FIXE_DEBUT.includes(col.key) && !ORDRE_FIXE_FIN.includes(col.key);
  if (deplacable) {
    btn.draggable = true;
    btn.dataset.cle = col.key;
    btn.classList.add('is-deplacable');
    // LA MÊME POIGNÉE QUE LA LIGNE DU TABLEAU, dessinée — pas un nom de glyphe.
    // `drag_indicator` n'est PAS dans le sous-ensemble de 91 ligatures que nous
    // hébergeons : le nom s'affichait donc en toutes lettres, coupé à 1 em par
    // `.material-symbols-outlined`, soit le début d'un « d » à la place des six
    // points. Rien ne le signalait — un glyphe absent ne lève aucune erreur.
    // `gripIcon()` existe depuis toujours pour la poignée du tableau et celle
    // des cartes : deux gestes identiques, un seul dessin.
    const grip = document.createElement('span');
    grip.className = 'colbar-item__grip';
    grip.setAttribute('aria-hidden', 'true');
    grip.appendChild(gripIcon());
    btn.appendChild(grip);
  }

  if (col.locked) {
    // `aria-disabled` plutôt que `disabled` : un bouton désactivé ne reçoit
    // plus d'événements de survol, donc l'infobulle qui EXPLIQUE pourquoi il
    // ne bouge pas ne s'afficherait jamais.
    btn.setAttribute('aria-disabled', 'true');
    attachTip(btn, 'Toujours affichée : c’est elle qui identifie la ligne.');
  } else if (on && col.auto && col.auto(currentStage)) {
    // Cochée, affichée, mais l'étape courante ne la remplit jamais.
    const note = document.createElement('span');
    note.className = 'colbar-item__note';
    note.textContent = 'vide ici';
    btn.appendChild(note);
    attachTip(btn, 'Affichée, mais cette étape ne la remplit jamais — elle se remplit sur les étapes concernées.');
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
      // qu'on ne l'a pas construite. Les cases qui décident du CONTENU d'une
      // ligne (le prix, les trois faits de production) ne changent pas de vue :
      // elles se voient quand même redessiner, sinon la case se coche et rien
      // ne bouge à l'écran. Le ticket, lui, reste réglé par le CSS — sa place
      // est réservée sur toutes les cartes, elle ne doit pas se refermer.
      if (COLS_REDESSINENT.has(col.key)) invalidateRowCache(null);
      if (modeCartes() !== avant || COLS_REDESSINENT.has(col.key)) applySortAndRender();
    });
  }
  return btn;
}

function renderColbar() {
  if (!$colbarOn || !$colbarOff) return;
  $colbarOn.replaceChildren();
  $colbarOff.replaceChildren();
  // « SUR L'ÉCRAN » SE LIT DANS L'ORDRE DE L'ÉCRAN. Une liste qui ne montre pas
  // l'ordre des colonnes ne peut pas servir à le changer — et c'est ici qu'on
  // le change, pas sur l'en-tête : un en-tête porte déjà deux gestes (trier,
  // régler la largeur), un troisième s'y marcherait dessus.
  // Les colonnes SANS colonne (le feu, les faits de production) gardent l'ordre
  // du rail : elles vivent dans la cellule « Infos », il n'y a rien à déplacer.
  const rang = ordreVoulu();
  const place = (c) => (c.horsTableau ? 900 : rang.indexOf(c.key));
  const visibles = PLANNING_COLS.filter((c) => !hiddenCols.has(c.key))
    .sort((a, b) => place(a) - place(b));
  for (const col of visibles) $colbarOn.appendChild(colbarItem(col));
  for (const col of PLANNING_COLS) {
    if (hiddenCols.has(col.key)) $colbarOff.appendChild(colbarItem(col));
  }
  const rien = hiddenCols.size === 0;
  $colbarOffLegend.hidden = rien;
  $colbarOffEmpty.hidden = !rien;
  // Le bouton reste TOUJOURS disponible : sur les cartes il sert à tout
  // rallumer, sur le tableau à tout ranger. Il n'y a pas d'état sans issue.
  $colbarReset.hidden = false;
  $colbarReset.textContent = modeCartes() ? 'Afficher le tableau complet' : 'Revenir aux cartes';
  // « Sur l'écran » reste MONTÉ même sur les cartes : le ticket s'y règle (il
  // existe dans les deux vues), et le masquer rendait sa case introuvable.
  // La note explique juste au-dessus pourquoi la liste est si courte.
  $colbarOn.hidden = false;
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
  // L'ordre se lit ICI et pas plus tôt : il vient du <colgroup>, qui n'existe
  // qu'une fois la page montée.
  ordreCols = lireOrdreCols();
  applyColVisibility();
  appliquerOrdreColonnes();
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

  // --- GLISSER POUR RANGER LES COLONNES ------------------------------------
  // Le glisser-déposer NATIF : c'est lui qui donne l'image fantôme sous le
  // curseur et la fluidité du système, sans une ligne de suivi de pointeur.
  // Les écouteurs sont posés UNE FOIS sur la liste, pas sur chaque entrée —
  // `renderColbar` la reconstruit à chaque changement, et des écouteurs par
  // entrée disparaîtraient avec elle (ou s'empileraient).
  let priseCle = null;
  $colbarOn.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.colbar-item.is-deplacable');
    if (!item) { e.preventDefault(); return; }
    priseCle = item.dataset.cle;
    item.classList.add('est-prise');
    e.dataTransfer.effectAllowed = 'move';
    // Firefox exige une donnée pour armer le glisser.
    try { e.dataTransfer.setData('text/plain', priseCle); } catch (_) { /* refusé */ }
  });
  $colbarOn.addEventListener('dragend', () => {
    priseCle = null;
    $colbarOn.querySelectorAll('.est-prise, .est-cible').forEach((n) => {
      n.classList.remove('est-prise', 'est-cible');
    });
  });
  $colbarOn.addEventListener('dragover', (e) => {
    if (!priseCle) return;
    e.preventDefault();                       // sans ça, aucun dépôt n'est permis
    e.dataTransfer.dropEffect = 'move';
    const sur = e.target.closest('.colbar-item.is-deplacable');
    $colbarOn.querySelectorAll('.est-cible').forEach((n) => n.classList.remove('est-cible'));
    if (sur && sur.dataset.cle !== priseCle) sur.classList.add('est-cible');
  });
  $colbarOn.addEventListener('drop', (e) => {
    if (!priseCle) return;
    e.preventDefault();
    const sur = e.target.closest('.colbar-item.is-deplacable');
    if (!sur || sur.dataset.cle === priseCle) return;
    const liste = ordreVoulu().filter((k) => k !== priseCle);
    const i = liste.indexOf(sur.dataset.cle);
    if (i < 0) return;
    // On se pose AVANT ou APRÈS selon le côté par lequel on arrive : déposer
    // sur la moitié basse d'une entrée veut dire « après elle ».
    const r = sur.getBoundingClientRect();
    const apres = e.clientY > r.top + r.height / 2;
    liste.splice(apres ? i + 1 : i, 0, priseCle);
    priseCle = null;
    poserOrdreCols(liste);
  });
  document.getElementById('colbarClose').addEventListener('click', () => setColbarOpen(false));
  // « Tout réafficher » ramène le tableau complet ; « Tout ranger » repose le
  // planning sur ses cartes épurées. Le même bouton, dans les deux sens : on ne
  // se retrouve jamais coincé dans une vue.
  $colbarReset.addEventListener('click', () => {
    // « Revenir aux cartes » ne range QUE les colonnes du tableau : le ticket
    // reste comme on l'a laissé, sinon le bouton du papier client disparaîtrait
    // des fiches sans que personne l'ait demandé.
    if (modeCartes()) hiddenCols.clear();
    else for (const k of COLS_TABLEAU) hiddenCols.add(k);
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
// Un serveur qui ne répond plus (minuteur de `fetchBorne`) tient la même place
// ici qu'un réseau tombé : rien n'est parti, ça reviendra, et la conduite à
// tenir est la même.
function estPanneReseau(err) {
  const m = String((err && err.message) || '');
  return err instanceof TypeError
    || /failed to fetch|networkerror|load failed|network request failed/i.test(m)
    || /serveur ne répond pas/i.test(m);
}

function reportError(err) {
  console.error(err);
  // Le voile de connexion parle déjà : on ne double pas.
  if (err && err.aConnecter) return;
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
// La fiche atelier a sa propre garde (ficheAtelierOccupee) : elle est montée sur
// <body>, donc hors de tout ce que compte isInteracting().
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
  if (document.hidden) return;
  // L'AGENDA SUIT L'HORLOGE, LUI AUSSI. « Aujourd'hui » et « Demain » sont des
  // étiquettes RELATIVES, et un poste d'atelier ne se recharge jamais : passé
  // minuit, un agenda resté ouvert désignerait la veille. Il se repeint au
  // changement de jour civil, et seulement là (voir `tick`, agenda.js).
  // Avant la garde `booted` : le planning peut ne pas avoir fini de charger,
  // l'heure, elle, avance quand même.
  if (agModule) agModule.tick();
  if (!booted) return;
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
    applySortAndRender();
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

// `listeAussi: false` ne rafraîchit QUE les compteurs du rail. C'est le cas
// quand l'évènement temps réel ne touche pas la famille affichée : la grille
// n'a alors rien à relire, et relire coûtait la liste ENTIÈRE de l'étape — à
// chaque poste, à chaque geste de n'importe qui, y compris à l'autre bout du
// pipeline. C'est ce qui restait de l'amplification réseau après la mise en lot
// des évènements.

// UN RAFRAÎCHISSEMENT NE SE PERD PLUS EN ROUTE. `poll()` renonçait purement et
// simplement quand on avait un menu ouvert, un champ sous le curseur ou une
// carte au bout du doigt — et PERSONNE ne le relançait. Or depuis le passage au
// temps réel, le filet de sécurité à 8 secondes ne tourne QUE si le flux SSE est
// coupé : la modification d'un collègue tombée pendant ces quelques secondes
// restait invisible jusqu'à ce que quelqu'un d'autre touche à quelque chose. Sur
// deux postes qui travaillent la même étape, ça se compte en minutes d'écart.
// On retient donc qu'il reste à relire, et on relit dès que les mains sont
// libres. La grille n'est jamais dérangée pendant le geste, elle rattrape après.
let relectureEnAttente = false;
let relectureTimer = null;

function differerRelecture() {
  relectureEnAttente = true;
  if (relectureTimer) return;
  relectureTimer = setInterval(() => {
    if (isInteracting() && !document.hidden) return;   // mains encore prises
    clearInterval(relectureTimer);
    relectureTimer = null;
    // Onglet passé en arrière-plan : `poll()` en ressortirait aussitôt. Le
    // retour sur l'onglet relit déjà de lui-même (visibilitychange) — et
    // `relectureEnAttente` reste vrai en attendant.
    if (document.hidden) return;
    // Une relecture a pu aboutir entre-temps (le geste s'est interrompu, un
    // autre évènement est passé) : inutile de redemander la liste au serveur.
    if (!relectureEnAttente) return;
    relectureEnAttente = false;
    poll();
  }, 400);
}

async function poll({ listeAussi = true } = {}) {
  if (document.hidden) return; // onglet en arrière-plan : on économise
  try {
    await loadCounts(); // compteurs sidebar : toujours sûrs à rafraîchir
    if (!listeAussi) return;
    if (isInteracting()) { differerRelecture(); return; } // on relira après le geste
    relectureEnAttente = false;
    // Même garde que `loadRows` : on note l'étape demandée ET le jeton de
    // chargement AVANT la requête. Sans ça, une réponse partie pour la famille
    // A qui revient après un clic sur la famille B écrasait la grille avec les
    // lignes de A — affichées sous l'entête de B, et resservies ensuite par le
    // raccourci « même famille » de selectStage.
    const slug = currentStage;
    const token = loadToken;
    // Même URL que `loadRows` : si l'employé a demandé un palier de plus, le
    // rafraîchissement de fond ne doit pas le lui reprendre sous les doigts.
    const { lignes: fresh, plafond, total } = await chargerListe(urlListe(slug));
    if (slug !== currentStage || token !== loadToken) return; // sélection dépassée
    const sig = signature(fresh);
    if (sig !== lastRowsSig) {
      rows = fresh;
      lastRowsSig = sig;
      listeTronqueeA = plafond;
      listeTotal = total;
      renderListeSuite();
      applySortAndRender();
    }
  } catch (_) { /* silencieux : on réessaiera au prochain cycle */ }
}

// Push instantané via SSE (Server-Sent Events) — comme Google Sheets : le
// serveur prévient le navigateur dès qu'une donnée change, refresh en ~150 ms.
let streamAlive = false;
let streamDebounce = null;

// CE QUE LA RAFALE OBLIGE À REFAIRE. Les évènements arrivent par paquets — un
// collègue qui range une étape, un dossier qui naît au comptoir — et on ne les
// traite qu'une fois, 120 ms plus tard. Ce qu'on retient de chacun doit donc se
// CUMULER : ne garder que le dernier ferait sauter la modification arrivée
// 50 ms plus tôt sur la famille qu'on regarde, et perdrait le réglage du patron
// coalescé derrière une commande déplacée.
const rafale = { etapes: new Set(), toutes: false, natures: new Set() };

function noterEvenement(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (p.kind) rafale.natures.add(p.kind);
  // Un évènement qui ne nomme aucune étape ne dit pas « aucune » : il dit
  // « on ne sait pas ». Le seul sens sûr de l'erreur est de relire.
  if (!Array.isArray(p.stages) || !p.stages.length) rafale.toutes = true;
  else for (const s of p.stages) rafale.etapes.add(s);
}

function viderRafale() {
  const vue = { etapes: rafale.etapes, toutes: rafale.toutes, natures: [...rafale.natures] };
  rafale.etapes = new Set();
  rafale.toutes = false;
  rafale.natures = new Set();
  return vue;
}

function onStreamChange(e) {
  // Le patron vient de changer l'attribution des catégories : les pilotes et
  // référents « de base » affichés sur les lignes doivent suivre immédiatement.
  let payload = {};
  try { payload = JSON.parse(e && e.data ? e.data : '{}') || {}; } catch (_) { payload = {}; }
  const kind = payload.kind || null;
  noterEvenement(payload);
  if (kind === 'category-owners' || kind === 'category-referents') {
    loadCategoryConfig().then(() => { invalidateRowCache(); applySortAndRender(); });
  }
  // Le patron vient de réécrire le message WhatsApp : les pastilles des lignes
  // doivent ouvrir le NOUVEAU texte, sans recharger la page.
  if (kind === 'settings') {
    loadWhatsappMessage();
    // Les faces déclarées viennent des réglages : quelqu'un vient peut-être
    // d'en ajouter une. On périme, on ne recharge pas — la prochaine fiche le
    // fera, et personne ne paie une requête pour un écran qui n'est pas ouvert.
    taillesLogo = null;
    taillesLogoEnVol = null;
    // L'IDENTITÉ DE L'ATELIER (nom, RIB, mentions légales) EST UN RÉGLAGE
    // (03/09/2026). Un poste qui a déjà le devis flash ouvert quand quelqu'un
    // la remplit continuait d'imprimer sans elle tant qu'il ne quittait pas
    // l'écran et n'y revenait pas — `dfModule` sait se relire, contrairement
    // aux tailles de logo ci-dessus, l'écran est déjà ouvert.
    if (dfModule && dfModule.refreshDevisFlash) dfModule.refreshDevisFlash();
  }
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
    const { etapes, toutes, natures } = viderRafale();
    // Le Point du jour garde son cache à jour même masqué (fil d'activité,
    // badges, écran mural) — mais à un rythme de fond, pas à chaque évènement.
    // On lui passe la NATURE des évènements de la rafale : lui seul sait s'il
    // doit relire la configuration du patron ou se contenter de sa synthèse
    // incrémentale.
    dashboard.notifyChange(natures);
    // L'AGENDA NE SE RELIT QUE S'IL EST À L'ÉCRAN (voir `notifyChange`,
    // agenda.js) : il n'a ni badge ni compteur qui vivent ailleurs que sur lui,
    // et une commande déplacée à l'atelier n'a pas à coûter une requête à
    // chaque poste resté sur le planning.
    if (agModule) agModule.notifyChange();
    // LA GRILLE NE SE RELIT QUE SI LA FAMILLE AFFICHÉE EST CONCERNÉE. Le
    // serveur nomme les étapes touchées ; on ne les lisait pas, et un simple
    // glisser en Production faisait retélécharger sa liste entière au poste qui
    // regardait « Demande & chiffrage ». Les compteurs du rail, eux, se
    // rafraîchissent toujours : ils portent sur tout le pipeline.
    if (isPlanningMode(viewMode)) poll({ listeAussi: toutes || etapes.has(currentStage) });
  }, 120);
}

let stream = null;
let streamReprise = null;
let streamEssais = 0;

// LE NAVIGATEUR NE ROUVRE PAS TOUJOURS LE FLUX TOUT SEUL. Sur une coupure réseau
// il repasse en `CONNECTING` et retente : c'est le cas qu'on connaissait. Mais
// quand le serveur répond AUTRE CHOSE qu'un flux — 503 du plafond de connexions,
// 401 quand le mot de passe partagé n'est plus envoyé, page d'erreur d'un proxy
// Railway — il passe en `CLOSED` et RENONCE définitivement. Plus personne ne
// rouvrait : la tablette finissait la journée (et les suivantes, elle ne se
// recharge jamais) sur le filet de sécurité à 8 secondes, sans que rien ne le
// signale. On rouvre donc nous-mêmes, en espaçant : si le serveur refuse, ce
// n'est pas en insistant toutes les secondes qu'on l'aidera.
function reprendreStream() {
  if (streamReprise) return;                       // reprise déjà programmée
  streamEssais = Math.min(streamEssais + 1, 5);
  const attente = Math.min(3000 * (2 ** (streamEssais - 1)), 60000);
  streamReprise = setTimeout(() => { streamReprise = null; connectStream(); }, attente);
}

function connectStream() {
  clearTimeout(streamReprise);
  streamReprise = null;
  try {
    if (stream) stream.close();                    // jamais deux flux à la fois
    const es = new EventSource('/api/stream');
    stream = es;
    es.addEventListener('change', onStreamChange);
    // L'empreinte du site, envoyée à l'ouverture du flux. Un déploiement fait
    // tomber tous les flux : chaque poste rouvre le sien, reçoit une empreinte
    // qui n'est plus la sienne, et allume sa bulle. Rien à sonder.
    es.addEventListener('version', (e) => {
      try { noterVersion(JSON.parse(e.data).version); } catch (_) { /* trame illisible */ }
    });
    es.onopen = () => { streamAlive = true; streamEssais = 0; };
    es.onerror = () => {
      streamAlive = false;
      // CONNECTING : le navigateur retente seul, on le laisse faire.
      if (es.readyState === EventSource.CLOSED) reprendreStream();
    };
  } catch (_) { streamAlive = false; reprendreStream(); }
}

function startRealtime() {
  connectStream();
  // La bulle « mise à jour disponible ». `saisieEnCours` est ce qu'on refuse de
  // jeter sans prévenir : une cellule ou un tiroir en cours d'édition, et
  // surtout un parcours du comptoir ouvert — c'est là que se perdent les
  // dossiers. `fluxVivant` évite d'interroger le serveur quand l'évènement du
  // flux fait déjà le travail.
  surveillerMaj({
    saisieEnCours: () => isInteracting() || ficheAtelierOccupee() || comptoirOuvert(),
    fluxVivant: () => streamAlive,
  });
  // filet de sécurité : si le flux est coupé, on revient à un poll lent
  setInterval(() => {
    if (!streamAlive) { poll(); dashboard.notifyChange(); if (agModule) agModule.notifyChange(); }
  }, POLL_MS);
  // les délais affichés suivent l'horloge, pas seulement les données
  setInterval(rafraichirTemps, TICK_TEMPS_MS);
  // rafraîchit immédiatement quand on revient sur l'onglet / réveille la tablette
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    poll(); rafraichirTemps(); dashboard.notifyChange();
    if (agModule) agModule.notifyChange();
    // On reprend la tablette en main : c'est le moment de retrouver le temps
    // réel tout de suite, sans attendre la fin de l'espacement.
    if (!streamAlive && stream && stream.readyState === EventSource.CLOSED) {
      streamEssais = 0;
      connectStream();
    }
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

// LE NUMÉRO DU TICKET SE CHERCHE. « 26.08.06-003 » : c'est par là qu'on
// retrouve un dossier quand on a son papier sous les yeux, et c'était justement
// le seul champ que ni la recherche de la grille ni la recherche globale ne
// regardaient — taper ce numéro ne rendait rien. Il vit dans la fiche, que la
// liste transporte allégée (FICHE_LISTE côté serveur garde `ref`).
// `refTicket` reste cherché pour les vieux dossiers : plus rien ne l'écrit
// depuis qu'aucun papier ne part chez le client, mais ceux d'avant le portent.
function refsTicket(r) {
  const f = r && r.fiche;
  if (!f || typeof f !== 'object') return '';
  return fold([f.ref, f.refTicket].filter(Boolean).join(' '));
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
// Les deux natures de résultat qui ne sont pas des commandes. Elles portent un
// « stage » à elles pour que le groupement existant les range sans savoir
// qu'elles sont d'une autre nature.
const GROUPE_RECHERCHE = { __clients: 'Clients' };

// Interroge le serveur. Le jeton écarte les réponses dépassées : sur une frappe
// rapide, celle de « po » peut revenir APRÈS celle de « polo » et réafficher les
// résultats d'avant sous les doigts de celui qui cherche.
function rechercheServeur(texte) {
  const token = ++rechercheToken;
  return api('GET', `/api/recherche?q=${encodeURIComponent(texte)}`)
    .then((data) => {
      if (token !== rechercheToken) return null;
      if (!data || typeof data !== 'object') return [];
      // UNE SEULE LISTE, MARQUÉE. Le rendu groupe déjà par `stage` : on donne
      // donc aux clients et aux produits un « stage » à eux, et tout le reste du
      // code de la palette continue de fonctionner sans savoir qu'il y a
      // maintenant trois natures de résultat.
      //
      // Les COMMANDES d'abord : c'est ce qu'on cherche dans neuf cas sur dix.
      return [
        ...(data.commandes || []),
        ...(data.clients || []).map((c) => ({ ...c, __quoi: 'client', stage: '__clients' })),
      ];
    });
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

window.addEventListener('resize', () => { if (paletteOpen) positionPalette(); }, { passive: true });

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
    paletteMessage('Rien ne correspond — ni commande, ni client.');
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
      gh.textContent = GROUPE_RECHERCHE[r.stage] || STAGE_LABEL[r.stage] || r.stage;
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

  const title = r.__quoi === 'client'
    ? nomClientAffiche(r.entreprise, r.client_type)
    : (nomClientAffiche(r.billing_company, r.client_type) || r.contact_referent || '— sans dossier');
  const desc = r.__quoi === 'client'
    ? [capitales(r.nom), r.ville, r.telephone, r.email].filter(Boolean).join(' · ')
    : (r.product || r.description || '');

  const main = document.createElement('div');
  main.className = 'spi-main';
  const t = document.createElement('div');
  t.className = 'spi-title';
  appendHighlighted(t, title, tokens);
  // LA RÉFÉRENCE DU TICKET, sur le résultat. On cherche désormais par ce numéro
  // (c'est le seul repère que le client rapporte) : il doit se LIRE sur la
  // ligne trouvée, sinon on ne sait pas laquelle des trois « Coco Beach » est
  // celle du papier qu'on tient.
  const ref = r.fiche && typeof r.fiche === 'object' ? (r.fiche.ref || '') : '';
  if (ref) {
    const rf = document.createElement('span');
    rf.className = 'spi-ref';
    appendHighlighted(rf, ref, tokens);
    t.append(' ', rf);
  }
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
// Renvoie VRAI si la ligne était bien montée. L'appelant en a besoin : une
// commande absente de la grille n'est pas une anomalie d'affichage, c'est une
// commande qu'on n'a pas chargée (voir ouvrirCommandeAuPlanning).
function revealRow(id) {
  const entry = modeCartes() ? cardEls.get(String(id)) : rowEls.get(String(id));
  const el = entry ? (entry.tr || entry.el) : null;
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('row-flash');
  void el.offsetWidth; // relance l'animation même si déjà posée
  el.classList.add('row-flash');
  setTimeout(() => el.isConnected && el.classList.remove('row-flash'), 1800);
  return true;
}

// Saute vers la commande choisie : ouvre sa catégorie (et sa sous-étape), ferme
// la palette, met la ligne brièvement en évidence.
async function jumpToResult(r) {
  closePalette();
  // UN CLIENT NE S'OUVRE PAS AU PLANNING. L'envoyer sur
  // `ouvrirCommandeAuPlanning` chercherait une commande qui n'existe pas, et le
  // clic semblerait « ne rien faire » — le pire résultat possible pour une
  // recherche, parce qu'on ne sait pas si on a mal cherché ou mal cliqué.
  if (r.__quoi === 'client') {
    location.hash = '#clients';
    // La Base clients filtre sa propre liste : on lui passe le nom, elle
    // s'ouvre dessus. Un identifiant ne lui servirait à rien tant qu'elle n'a
    // pas chargé sa liste.
    setTimeout(() => window.dispatchEvent(
      new CustomEvent('olda:chercher-client', { detail: r.entreprise }),
    ), 120);
    return;
  }
  // La recherche a rempli son office : on la vide, sinon la grille d'arrivée
  // resterait filtrée sur la requête et semblerait amputée de ses lignes.
  if ($gridSearchInput) { $gridSearchInput.value = ''; $gridSearchInput.blur(); }
  setGridQuery('');
  // On cherche dans TOUT le planning, y compris depuis la prise de commande, le
  // dashboard ou la base clients : on ouvre donc la vue qui montre vraiment la
  // commande — l'onglet promu (Fiverr, À commander) quand elle y vit, le
  // Planning sinon — avant de pointer la ligne. Sans ça la cible reste cachée
  // derrière la vue courante, et le clic semble « ne rien faire ».
  await ouvrirCommandeAuPlanning({ id: r.id, stage: r.stage, sub: r.sub_stage });
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
  const root = document.documentElement;
  // Les transitions se taisent LE TEMPS DE LA BASCULE (voir .theme-switching en
  // CSS) : changer le thème re-colore la grille entière — cellules, puces,
  // badges — et chacun portant une transition de couleur, un seul clic lançait
  // des milliers de fondus simultanés : l'écran « ramait » précisément sur le
  // geste censé être un simple interrupteur.
  root.classList.add('theme-switching');
  root.dataset.theme = t;
  if ($themeToggle) {
    const ic = $themeToggle.querySelector('.material-symbols-outlined');
    if (ic) ic.textContent = t === 'dark' ? 'light_mode' : 'dark_mode';
    attachTip($themeToggle, t === 'dark' ? 'Passer en clair' : 'Passer en sombre');
  }
  // Deux images : la première applique les nouvelles couleurs sans transition,
  // la seconde rend la parole aux fondus pour tous les gestes suivants.
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
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
  '.type-tag, .deadline-badge, .resp-chip, .sub-chip, .menu-item';
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
// LE MINIMUM EST MESURÉ, PAS CHOISI. En dessous, la colonne qui reste au
// libellé devient plus étroite que ses mots les plus longs — « Préparation »,
// « Facturation », « marchandise », « Production » — et `overflow-wrap:
// break-word` les COUPE EN PLEIN MILIEU : « PRÉPARATIO / N DU PROJET ».
// Mesuré le 24/08/2026 sur les 33 libellés du pipeline : à 180 px, 7 se
// cassaient et il manquait 10 px au pire d'entre eux ; le premier palier sans
// REFONTE DU 24/08 : la spécification du patron fixait le rail à 284 px. C'est
// la largeur MINIMALE — et la base que la zone de travail concède
// (`--rail-base`, styles.css) : au repos, le rail ne recouvre rien. La poignée
// ne sert plus qu'à l'élargir au-delà, PAR-DESSUS les cartes.
// L'ancien minimum mesuré (200, pour la typographie des bandeaux) n'a plus
// cours : les bandeaux sont partis avec la refonte.
//
// 320 DEPUIS LE 25/08, et pour la même raison qu'en 24/08 : cette largeur se
// DÉDUIT de la taille des libellés, elle ne se choisit pas. Les 284 px avaient
// été mesurés sur des étapes en 12,5 px ; passées en 16 px, sept des 33 se
// repliaient sur deux ou trois lignes au lieu de quatre. 320 rétablit le pliage
// d'origine et 340 n'apporte rien de plus — donc 320.
// Le garde-fou de `test/coquille-nav-et-rail.test.js` vérifie l'ÉGALITÉ avec
// `--rail-base`, pas un chiffre : la largeur peut suivre la typographie.
const SIDEBAR_MIN = 320, SIDEBAR_MAX = 460;
const $sidebarResizer = document.getElementById('sidebarResizer');
// La largeur du rail est une colonne de la grille du .shell : c'est donc lui qui
// porte `--sidebar-w` (le rail n'est plus enfant de `.app`).
const $shell = document.querySelector('.shell');
if ($shell && $sidebarResizer) {
  const clampW = (w) => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(w)));

  // LE RAIL SE BLOQUE AVANT DE CASSER LA BARRE DU HAUT. Ce qu'il prend, la
  // barre le rend : poussé à fond (460) sur une fenêtre de 1440, la rangée des
  // sept onglets ne tenait plus (945 px de contenu dans 932), Chrome lui posait
  // une barre de défilement de 12 px, et la barre du haut passait de 108 à
  // 120 px — la zone de travail perdait donc de la hauteur, sans que rien
  // n'explique pourquoi.
  //
  // On ne MODÉLISE pas la largeur qu'il faut aux onglets (elle dépend de la
  // police, de la langue, du pli de la barre, du nombre d'onglets) : ON LA
  // MESURE. Le rail avance tant que la rangée ne déborde pas, et s'arrête au
  // pixel où elle déborderait. La butée est donc juste sur n'importe quelle
  // fenêtre, dans les deux dispositions de la barre.
  const $navSwitch = document.querySelector('.nav-switch');
  const barreDeborde = () => !!$navSwitch && $navSwitch.scrollWidth > $navSwitch.clientWidth + 1;

  // Applique une largeur et la REND si elle casse la barre.
  const poser = (w, repli) => {
    $shell.style.setProperty('--sidebar-w', w + 'px');
    if (w > repli && barreDeborde()) {
      $shell.style.setProperty('--sidebar-w', repli + 'px');
      return repli;
    }
    return w;
  };

  const saved = parseInt(localStorage.getItem(SIDEBAR_W_KEY) || '', 10);
  if (Number.isFinite(saved)) poser(clampW(saved), SIDEBAR_MIN);

  // La fenêtre qui rétrécit reprend de la largeur à la barre : un rail qui
  // tenait tout à l'heure peut ne plus tenir. On le resserre plutôt que de
  // laisser réapparaître la barre de défilement.
  // UNE FOIS PAR IMAGE, PAS UNE FOIS PAR ÉVÈNEMENT. Le resserrement lit une
  // géométrie, écrit une largeur, relit, réécrit — jusqu'à dix-huit fois. Chaque
  // lecture qui suit une écriture force Chrome à recalculer la mise en page
  // AVANT de répondre. Or `resize` part en rafale tant qu'on tire le bord de la
  // fenêtre : c'était donc jusqu'à un millier de calculs de mise en page par
  // seconde, pour un réglage qui ne se voit qu'une fois le geste fini.
  // `requestAnimationFrame` fond la rafale en une seule passe par image — et
  // c'est le moment où le navigateur allait recalculer de toute façon.
  let resserrementPrevu = false;
  const resserrerLeRail = () => {
    const rail = document.getElementById('sidebar');
    if (!rail) return;
    const actuel = Math.round(rail.getBoundingClientRect().width);
    if (!actuel) return;                 // rail replié : rien à resserrer
    if (!barreDeborde()) return;
    let w = actuel;
    while (w > SIDEBAR_MIN && barreDeborde()) {
      w -= 8;
      $shell.style.setProperty('--sidebar-w', Math.max(SIDEBAR_MIN, w) + 'px');
    }
    try { localStorage.setItem(SIDEBAR_W_KEY, String(Math.max(SIDEBAR_MIN, w))); } catch (_) {}
  };
  // Le rail d'abord — il peut rendre la place qui suffit —, les onglets
  // ensuite. Les deux dans la MÊME passe : `resserrerLeRail` sort par trois
  // chemins différents, l'ajustement ne peut pas vivre à l'intérieur.
  const ajusterLaBarre = () => {
    resserrementPrevu = false;
    resserrerLeRail();
    ajusterLesOnglets();
  };
  window.addEventListener('resize', () => {
    if (resserrementPrevu) return;
    resserrementPrevu = true;
    requestAnimationFrame(ajusterLaBarre);
  }, { passive: true });
  ajusterLesOnglets();

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
      // `lastW` sert de repli : c'est la dernière largeur qui TENAIT.
      lastW = poser(clampW(startW + ev.clientX - startX), lastW);
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

// --- Actualiser les données -------------------------------------------------
// LE BOUTON NE RECHARGE PAS LA PAGE. `location.reload()` aurait coûté le
// défilement, l'étape ouverte, le tiroir d'un dossier et une saisie en cours —
// et 600 Ko de statique pour relire trois listes. On relit les DONNÉES à leur
// place, chacune là où elle vit.
// Le flux d'événements tient déjà l'écran à jour ; ce bouton sert quand on
// DOUTE — un collègue vient de poser une commande, le Wi-Fi a toussé.
const RECHARGE_TOUR_MS = 700;   // une révolution de la flèche, cf. styles.css
const $recharger = document.getElementById('rechargerBtn');
let rechargeEnCours = false;

async function rafraichirLaVue() {
  // Les compteurs du rail valent pour TOUTES les vues : ils sont le seul chiffre
  // qu'on relit sans quitter l'écran où l'on est.
  await loadCounts();
  if (isPlanningMode(viewMode)) return selectStage(currentStage, currentSub, true);
  if (viewMode === 'dashboard') return dashboard.show();
  if (viewMode === 'clients') return mountClients();
  if (viewMode === 'reglages') return mountReglages();
  if (viewMode === 'montravail') return mountMonTravail();
  if (viewMode === 'pilotage') return mountPilotage();
  if (viewMode === 'tailleslogos') return mountTaillesLogos();
  if (viewMode === 'devisflash') return mountDevisFlash();
  if (viewMode === 'venteflash') return mountVenteFlash();
  // Nouveau Projet : le parcours est un document à part, il a sa propre base
  // clients — c'est LUI qui sait la relire (voir pont.js).
  const cadre = document.querySelector('.np-frame:not([hidden])');
  const relire = cadre && cadre.contentWindow && cadre.contentWindow.oldaRafraichirClients;
  if (typeof relire === 'function') relire();
}

if ($recharger) {
  attachTip($recharger, 'Actualiser les données');
  $recharger.addEventListener('click', async () => {
    if (rechargeEnCours) return;          // deux clics ne relisent pas deux fois
    rechargeEnCours = true;
    $recharger.setAttribute('aria-busy', 'true');
    $recharger.classList.remove('est-fait');
    // LA FLÈCHE FINIT SON TOUR. Une relecture qui revient en 40 ms couperait
    // l'animation de travers : l'œil y lit un incident, pas une réussite. On
    // attend donc la révolution ET la donnée, jamais l'une sans l'autre.
    const tour = new Promise((r) => setTimeout(r, RECHARGE_TOUR_MS));
    try {
      await Promise.all([rafraichirLaVue(), tour]);
      $recharger.classList.add('est-fait');
      setTimeout(() => $recharger.classList.remove('est-fait'), 400);
    } catch (_) {
      // Le réseau parle déjà pour lui-même (voir reseau.js et la bannière hors
      // ligne) : un second message ici ne dirait rien de plus.
      await tour;
    } finally {
      rechargeEnCours = false;
      $recharger.removeAttribute('aria-busy');
    }
  });
}

// --- Replier le rail --------------------------------------------------------
// La poignée ci-dessus règle la largeur, mais elle ne descend pas sous 180 px :
// pour lire une commande large il fallait la traîner jusqu'au minimum, et ça ne
// suffisait pas. Ce bouton met le rail à ZÉRO d'un clic et le ramène du même
// geste. Mémorisé par appareil, comme la largeur.
// La classe vit sur <html>, pas sur <body> : le script en tête de page la relit
// AVANT le premier pixel, sinon le rail s'affiche puis se range sous les yeux à
// chaque ouverture de l'outil.
const RAIL_PLIE_KEY = 'olda_rail_plie';
const $railToggle = document.getElementById('railToggle');
if ($railToggle) {
  const direLEtatDuRail = () => {
    const plie = document.documentElement.classList.contains('rail-plie');
    $railToggle.setAttribute('aria-expanded', String(!plie));
    $railToggle.setAttribute('aria-label', plie ? 'Déplier le rail des étapes' : 'Replier le rail des étapes');
  };
  direLEtatDuRail();
  attachTip($railToggle, 'Replier / déplier le rail');
  $railToggle.addEventListener('click', () => {
    const plie = document.documentElement.classList.toggle('rail-plie');
    try { localStorage.setItem(RAIL_PLIE_KEY, plie ? '1' : '0'); } catch (_) {}
    direLEtatDuRail();
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
const $viewMonTravail = document.getElementById('viewMonTravail');
const $viewPilotage = document.getElementById('viewPilotage');
const $viewTaillesLogos = document.getElementById('viewTaillesLogos');
const $viewDevisFlash = document.getElementById('viewDevisFlash');
const $viewVenteFlash = document.getElementById('viewVenteFlash');
const $viewBat = document.getElementById('viewBat');
const $reglages = document.getElementById('reglages');
const $montravail = document.getElementById('montravail');
const $pilotage = document.getElementById('pilotage');
const $tailleslogos = document.getElementById('tailleslogos');
const $devisflash = document.getElementById('devis-flash');
const $venteflash = document.getElementById('vente-flash');
const $agenda = document.getElementById('agenda');
const $bat = document.getElementById('bat');
// « VENTE » ET « DEVIS » SONT DEUX ONGLETS (29/08/2026, Charlie : « je veux
// retrouver directement vente et devis, ils doivent être cliquables direct »).
// Il y avait un onglet « Nouveau Projet » qui ne menait nulle part : il
// dépliait un panneau de deux lignes pour poser une question à deux réponses.
// Les deux réponses sont maintenant dans la barre, chacune avec son adresse.
//
// CE SONT DES LIENS DE HASH, comme tous les autres onglets : c'est l'adresse
// qui pilote la vue (voir applyHash), donc un rechargement rouvre le parcours
// où on était, et le bouton « précédent » du navigateur en ressort.
// Le seul écouteur qu'ils portent sert au cas que le hash ne couvre pas :
// recliquer sur l'onglet DÉJÀ ouvert. Aucun `hashchange` n'est émis, et « un
// nouveau projet » doit quand même repartir de zéro.
const $viewVente = document.getElementById('viewVente');
const $viewDevis = document.getElementById('viewDevis');
for (const [el, id] of [[$viewVente, 'vente'], [$viewDevis, 'devis']]) {
  if (!el) continue;
  el.addEventListener('click', (ev) => {
    if (location.hash !== el.getAttribute('href')) return;   // le hash s'en charge
    ev.preventDefault();
    allerAuParcours(id);
  });
}
const $projet = document.getElementById('nouveau-projet');

// 'planning' | 'dashboard' | 'clients' | 'reglages' | 'projet'
// | 'fiverr' | 'a_commander' (les deux catégories promues en onglet)
let viewMode = 'planning';

// OUVRIR LE PLANNING SUR UNE COMMANDE — le seul chemin.
//
// Trois entrées y mènent : la recherche globale, le « Ouvrir dans le planning »
// du Point du jour, et le retour du comptoir après enregistrement. Chacune
// basculait la vue à sa façon, et deux d'entre elles laissaient l'URL derrière :
//
//   - le Point du jour posait la vue Planning en GARDANT « #dashboard » dans
//     l'URL. Retaper sur l'onglet Dashboard ne changeait alors plus rien — le
//     hash y était déjà, aucun `hashchange` ne partait : l'onglet restait mort
//     tant qu'on n'était pas passé par un autre. Or « Ouvrir dans le planning »
//     est justement le geste du point du matin, fait vingt fois de suite.
//
//   - le comptoir écrivait `location.hash = '#planning'`, dont le `hashchange`
//     tombait AU MILIEU du chargement de l'étape. Sur un dossier rangé en
//     « Préparation › À commander » — une catégorie promue en onglet —
//     `applyHash` croyait devoir rattraper une grille égarée et renvoyait sur
//     « Demande & chiffrage » : la vendeuse ne voyait PAS la ligne qu'elle
//     venait d'enregistrer, et c'est exactement le moment où l'on ressaisit.
//
// Ici : on choisit la vue (l'onglet promu s'il en existe un pour cette place),
// on aligne l'URL avec `replaceState` — qui ne déclenche AUCUN `hashchange`,
// donc aucune course — puis on charge l'étape et on pointe la ligne.
async function ouvrirCommandeAuPlanning({ id, stage, sub }, forcerRelecture = false) {
  const sousEtape = sub && SUB_LABEL[sub] ? sub : null;
  const promoted = PROMOTED.find((p) => p.stage === stage && p.sub === sousEtape);
  const vue = promoted ? promoted.view : 'planning';
  const hash = promoted ? promoted.hash : '#planning';
  setViewMode(vue);
  if (location.hash !== hash) history.replaceState(null, '', hash);
  await selectStage(stage, sousEtape, forcerRelecture);
  if (!id) return;

  // LA COMMANDE PEUT ÊTRE HORS DE LA LISTE CHARGÉE. Le serveur ne rend que les
  // 400 dernières lignes d'une étape, et « Paiement & clôture » garde tout
  // l'historique : une commande retrouvée par la recherche globale — c'est
  // précisément pour les anciennes qu'on cherche — atterrit dans une grille qui
  // ne la contient pas.
  // La liste se pose par tranches : la ligne visée peut être en bas de la page
  // et n'exister dans le DOM que dans quelques dizaines de millisecondes. On
  // attend qu'elle soit montée plutôt que de conclure qu'elle a disparu.
  await listeMontee;
  if (revealRow(id)) return;

  // ON N'AVALE PLUS L'ARCHIVE POUR MONTRER UNE LIGNE. On chargeait alors TOUTE
  // l'étape — mille deux cents commandes montées dans la page d'une tablette —
  // pour faire clignoter une ligne au milieu, et le planning restait lourd
  // ensuite. Or ce que l'employé veut, quand il ouvre un vieux dossier depuis la
  // recherche, c'est LE DOSSIER : on ouvre sa fiche, tout de suite, et on le dit.
  try {
    await ouvrirFicheHorsListe(id, 'Commande hors de la liste affichée — ouverte depuis la recherche.');
    return;
  } catch (_) { /* la commande n'existe plus, ou le réseau est tombé */ }
  // Introuvable même en la demandant nommément : elle vient d'être supprimée par
  // un collègue. On le dit — une grille muette se lit « le dossier a disparu »,
  // et c'est le moment où quelqu'un le ressaisit.
  showToast('Cette commande n’existe plus — elle vient d’être supprimée.');
}

// Saut depuis le Point du jour (« Ouvrir dans le planning »).
const jumpToPlanning = (r) => ouvrirCommandeAuPlanning({ id: r.id, stage: r.stage, sub: r.sub_stage });

// LE POINT DU JOUR ARRIVE À LA DEMANDE, comme les six autres écrans. Il était
// le seul module secondaire en import STATIQUE : 70 Ko téléchargés, analysés et
// exécutés à l'ouverture de chaque poste, pour un onglet que beaucoup n'ouvrent
// jamais de la journée. Sa PREMIÈRE SYNTHÈSE attendait déjà le premier
// affichage (voir `show` dans dashboard.js) ; c'est le module lui-même qui
// partait trop tôt.
//
// Les quatre appels du planning passent par cette façade. Aucun ne peut arriver
// avant que quelqu'un n'ouvre l'onglet :
//   `show`         — la seule porte : elle charge, monte, puis affiche ;
//   `hide`         — rien à cacher tant que rien n'est monté ;
//   `notifyChange` — sans cache monté il n'y a rien à tenir à jour (le module
//                    lui-même renonce déjà dans ce cas) ;
//   `start`        — ne fait plus rien au démarrage : il monte la coquille, et
//                    c'est `show` qui s'en charge au premier passage.
let pjChargement = null;
let pjModule = null;
function chargerPointDuJour() {
  if (!pjChargement) {
    // SA FEUILLE PART AVEC LUI (29/08). Les 33 Ko du Point du jour vivaient dans
    // styles.css : tous les postes les téléchargeaient à l'ouverture, y compris
    // ceux qui ne quittent jamais le planning.
    pjChargement = Promise.all([poserFeuille('dashboard.css'), import('./dashboard.js')])
      .then(([, m]) => {
        pjModule = m.createDashboard({
          root: $dashboard,
          api, EMPLOYEES, FAMILIES, SUB_STAGES, STAGE_LABEL, SUB_LABEL,
          daysLeft, prioBand, showToast, attachTip,
          jumpToPlanning,
        });
        pjModule.start();
        return pjModule;
      })
      .catch((err) => {
        pjChargement = null;                 // rechargeable au prochain essai
        pjModule = null;
        reportError(err);
      });
  }
  return pjChargement;
}
const dashboard = {
  start() {},
  show() { chargerPointDuJour().then(() => pjModule && pjModule.show()); },
  hide() { if (pjModule) pjModule.hide(); },
  notifyChange(kinds) { if (pjModule) pjModule.notifyChange(kinds); },
};

// --- Bascule Planning / Dashboard ------------------------------------------
// Le HASH de l'URL est l'unique pilote de la vue. La navigation du rail n'est
// faite que de liens : cliquer change le hash, le hash change la vue. Avoir eu
// deux pilotes (des boutons ET le hash) laissait l'URL et l'écran se
// contredire — « #dashboard » affiché sur le planning, et retour au dashboard
// au premier rechargement.
// La Base clients (CRM) : liste + fiche éditable + notes. Module lourd (rendu
// complet), chargé au premier passage puis monté ; les visites suivantes
// rafraîchissent seulement les données (un client a pu être créé à la commande).
// UNE FEUILLE POSÉE AVEC SON ÉCRAN. `clients.css` et `projet.css` partaient au
// démarrage — 30 Ko — pour deux écrans dont le JAVASCRIPT, lui, attendait le
// premier passage. On attend la fin du chargement avant de monter : une vue
// peinte avant sa feuille clignote une fois, et ce clignotement se voit.
const feuillesPosees = new Set();
function poserFeuille(href) {
  if (feuillesPosees.has(href)) return Promise.resolve();
  feuillesPosees.add(href);
  return new Promise((resoudre) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    // Une feuille manquante ne doit pas retenir l'écran : il s'affichera nu
    // plutôt que pas du tout.
    l.addEventListener('load', resoudre, { once: true });
    l.addEventListener('error', resoudre, { once: true });
    document.head.appendChild(l);
  });
}

let clientsLoading = null;
let clientsModule = null;
// LE CLIENT QU'ON VIENT DE QUITTER. Posé par le nom du client de la fiche
// atelier, consommé UNE fois par le montage de la vue — puis oublié : sans quoi
// le prochain passage par l'onglet Base clients rouvrirait la fiche d'un client
// qu'on n'a plus sous les yeux. La vue est chargée PARESSEUSEMENT : au premier
// clic le module n'existe pas encore, la cible doit donc attendre `initClients`.
let clientVise = null;
function viserDansClients(nom) {
  if (!nom || !clientsModule || !clientsModule.viserClient) return;
  clientsModule.viserClient(nom);
}
function mountClients() {
  if (!$clients) return;
  const vise = clientVise;
  clientVise = null;
  if (!clientsLoading) {
    clientsLoading = Promise.all([poserFeuille('clients.css'), import('./clients.js')])
      .then(([, m]) => m)
      .then((m) => { clientsModule = m; return m.initClients($clients); })
      .then(() => viserDansClients(vise))
      .catch((err) => {
        clientsLoading = null;                // rechargeable au prochain essai
        clientsModule = null;
        console.error('Base clients : chargement impossible', err);
      });
  } else if (clientsModule) {
    // `refreshClients` se tait quand elle vient de tourner (garde de 3 s) : la
    // cible ne peut donc pas attendre sa promesse, elle se pose tout de suite
    // sur la liste déjà à l'écran.
    if (clientsModule.refreshClients) clientsModule.refreshClients();
    viserDansClients(vise);
  }
}

// Les Réglages du patron (message WhatsApp « commande prête »…). Petit module,
// chargé au premier passage puis monté ; les visites suivantes relisent la
// valeur enregistrée — un autre poste a pu la changer entre-temps.
// MON TRAVAIL — même montage paresseux que les autres vues : le module ne part
// du serveur qu'au premier passage sur l'onglet, et l'écran de l'opérateur ne
// pèse rien sur le démarrage de ceux qui ne l'ouvrent jamais.
let pilLoading = null;
let pilModule = null;
function mountPilotage() {
  if (!$pilotage) return;
  if (!pilLoading) {
    pilLoading = Promise.all([poserFeuille('pilotage.css'), import('./pilotage.js')])
      .then(([, m]) => { pilModule = m; return m.initPilotage($pilotage); })
      .catch((err) => { pilLoading = null; pilModule = null; reportError(err); });
  } else if (pilModule && pilModule.refreshPilotage) {
    pilModule.refreshPilotage();
  }
}

// TAILLES DES LOGOS — même montage paresseux : le module et le catalogue
// textile qu'il charge ne partent du serveur qu'au premier passage sur
// l'onglet.
let tlLoading = null;
let tlModule = null;
function mountTaillesLogos() {
  if (!$tailleslogos) return;
  if (!tlLoading) {
    // DEUX FEUILLES : la sienne, et celle des Réglages — cet écran reprend
    // leurs rangées de formulaire, et deux écrans à un clic l'un de l'autre
    // doivent donner le même composant, pas deux qui se ressemblent.
    tlLoading = Promise.all([
      poserFeuille('reglages.css'), poserFeuille('tailles-logos.css'), import('./tailles-logos.js'),
    ])
      .then(([, , m]) => { tlModule = m; return m.initTaillesLogos($tailleslogos); })
      .catch((err) => { tlLoading = null; tlModule = null; reportError(err); });
  } else if (tlModule && tlModule.refreshTaillesLogos) {
    tlModule.refreshTaillesLogos();
  }
}

// LE BAT — BAT STUDIO, MONTÉ DANS L'ONGLET.
//
// Une ligne, et c'est tout ce que le CRM a à en savoir : `monterBatStudio` pose
// ses feuilles, précharge ses modules et rend l'écran. Le CRM ne connaît ni ses
// composants, ni son état, ni sa feuille A4.
//
// MÊME MONTAGE PARESSEUX QUE LES AUTRES ÉCRANS, et il compte plus ici
// qu'ailleurs : BAT Studio tire 5,4 Mo de bibliothèques (pdf-lib, pdf.js,
// fontkit) et 1,8 Mo de polices de document. Rien de tout ça ne doit partir du
// serveur tant que personne n'a cliqué sur l'onglet — l'ouverture d'un poste
// pèse 109 Ko, et ce chiffre est un budget, pas un constat.
//
// `chrome: true` : on GARDE sa rangée d'onglets (Projets · Bon À Tirer ·
// Produits · Réglages). L'option existe pour le cas où le CRM monterait chaque
// écran à sa place — un dans la fiche, deux dans les Réglages — et c'est ce que
// recommande son INTEGRATION.md. Mais Charlie a demandé UN onglet dans la
// barre : dans un seul écran, sans cette rangée, trois de ses quatre écrans
// seraient inatteignables.
//
// ON NE DÉMONTE PAS EN QUITTANT L'ONGLET. `demonter()` existe et fonctionne,
// mais il appelle `closeProject()` : passer voir le planning trente secondes
// fermerait le BAT en cours d'édition. Le conteneur est simplement caché, comme
// les huit autres écrans.
let batLoading = null;
function mountBat() {
  if (!$bat || batLoading) return;
  batLoading = Promise.all([poserFeuille('bat.css'), import('./bat/js/monter.js')])
    .then(([, m]) => m.monterBatStudio($bat, { chrome: true }))
    .catch((err) => { batLoading = null; reportError(err); });
}

// LE DEVIS CHIFFRE — meme montage paresseux. Il tire TROIS feuilles et deux
// modules (l'ecran et le papier) : rien ne part du serveur tant qu'on n'a pas
// ouvert l'onglet.
//   · `reglages.css` pour la carte, la barre d'actions et le bouton — ceux des
//     Reglages et des Tailles de logos, a un clic d'ici ;
//   · `devis-flash.css` pour ce qu'aucun autre ecran ne porte : la coupe en deux
//     moities et la rangee d'un article.
// Le CHAMP, lui, n'a pas de feuille a poser : il vient de `fiche-atelier.css`,
// qui part avec la coquille — c'est la grammaire du comptoir, et deux ecrans a
// un clic l'un de l'autre doivent donner le meme composant.
let dfLoading = null;
let dfModule = null;
function mountDevisFlash() {
  if (!$devisflash) return;
  if (!dfLoading) {
    dfLoading = Promise.all([
      poserFeuille('reglages.css'), poserFeuille('devis-flash.css'), import('./devis-flash.js'),
    ])
      .then(([, , m]) => { dfModule = m; return m.initDevisFlash($devisflash); })
      .catch((err) => { dfLoading = null; dfModule = null; reportError(err); });
  } else if (dfModule && dfModule.refreshDevisFlash) {
    // ON NE REMONTE PAS L'ECRAN EN REVENANT DESSUS : un devis en cours de
    // composition se perdrait au premier aller-retour vers le planning. Seuls
    // les reglages (clients, catalogue, identite, taux) se relisent.
    dfModule.refreshDevisFlash();
  }
}

// LA VENTE FLASH — même montage paresseux que le devis flash, et la MÊME
// feuille de style (`devis-flash.css` : c'est la grammaire partagée, voir
// vente-flash.js en tête de fichier).
let vfLoading = null;
let vfModule = null;
function mountVenteFlash() {
  if (!$venteflash) return;
  if (!vfLoading) {
    vfLoading = Promise.all([
      poserFeuille('reglages.css'), poserFeuille('devis-flash.css'), import('./vente-flash.js'),
    ])
      .then(([, , m]) => { vfModule = m; return m.initVenteFlash($venteflash); })
      .catch((err) => { vfLoading = null; vfModule = null; reportError(err); });
  } else if (vfModule && vfModule.refreshVenteFlash) {
    vfModule.refreshVenteFlash();
  }
}

let mtLoading = null;
let mtModule = null;
function mountMonTravail() {
  if (!$montravail) return;
  if (!mtLoading) {
    mtLoading = Promise.all([poserFeuille('montravail.css'), import('./montravail.js')])
      .then(([, m]) => {
        mtModule = m;
        // Les libellés de sous-étape vivent déjà ici : les redemander au serveur
        // ferait un appel de plus pour une table que l'écran connaît par cœur.
        m.poserLibelles(SUB_LABEL);
        return m.initMonTravail($montravail);
      })
      .catch((err) => {
        mtLoading = null;
        mtModule = null;
        reportError(err);
      });
  } else if (mtModule && mtModule.refreshMonTravail) {
    mtModule.refreshMonTravail();
  }
}

// L'AGENDA DES RETRAITS — le planning rangé par JOUR (03/09/2026).
// Même montage que les six autres écrans : sa feuille et son JS arrivent au
// premier passage, jamais à l'ouverture d'un poste.
//
// IL OUVRE LA FICHE, IL NE SAUTE PAS AU PLANNING. Depuis l'agenda, ce qu'on
// veut d'un dossier c'est le dossier — appeler le client, corriger l'heure,
// passer la commande en « récupérée ». Renvoyer vers son étape ferait perdre la
// place dans la journée qu'on est en train de lire, pour un détour.
let agLoading = null;
let agModule = null;
function mountAgenda() {
  if (!$agenda) return;
  if (!agLoading) {
    agLoading = Promise.all([poserFeuille('agenda.css'), import('./agenda.js')])
      .then(([, m]) => {
        agModule = m.createAgenda({
          root: $agenda,
          STAGE_LABEL,
          SUB_LABEL,
          // LA BULLE DE L'APPLICATION, pas celle de Chrome : `title` ouvre
          // l'infobulle système — grise, hors charte, lente à venir puis longue
          // à partir. La vue au mois n'affiche que des noms, tout le reste vit
          // dans cette bulle : elle n'est pas un ornement, c'est la moitié de
          // l'écran.
          attachTip,
          ouvrirDossier: (id) => ouvrirFicheHorsListe(id).catch(() => {
            showToast('Cette commande n’existe plus — elle vient d’être supprimée.');
          }),
        });
        agModule.start();
        agModule.show();
        return agModule;
      })
      .catch((err) => {
        agLoading = null;                     // rechargeable au prochain essai
        agModule = null;
        reportError(err);
      });
  } else if (agModule) {
    agModule.show();
  }
}

let reglagesLoading = null;
let reglagesModule = null;
function mountReglages() {
  if (!$reglages) return;
  if (!reglagesLoading) {
    reglagesLoading = Promise.all([poserFeuille('reglages.css'), import('./reglages.js')])
      .then(([, m]) => { reglagesModule = m; return m.initReglages($reglages); })
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
// LE CHOIX SE FAIT DANS LA BARRE, PLUS SUR UN ÉCRAN À LUI (Charlie, 27/08/2026)
// « les 2 icônes sont au milieu seul, c'est le seul endroit de l'app où il y a
// ça. » C'était une page entière pour poser une question à deux réponses : un
// clic, un chargement, et une grande carte vide autour de deux tuiles.
//
// PUIS LE MENU EST PARTI À SON TOUR (29/08/2026, Charlie : « je veux retrouver
// directement vente et devis, ils doivent être cliquables direct »). Le panneau
// qui tombait de l'onglet posait la même question à deux réponses, en deux
// clics au lieu d'un — plus un calque à caler au pixel sur le rail de son
// onglet, à fermer sur Échap, au clic dehors et au redimensionnement. Les deux
// réponses sont maintenant deux ONGLETS, chacun avec son adresse.
//
// L'écran à deux tuiles n'est pas supprimé : il reste au bout de
// `#nouveau-projet`, et c'est là que retombe un poste qui ne sait pas encore
// lequel il veut.

// Ouvrir un parcours demande le module : il n'est chargé qu'au premier passage.
//
// L'ORDRE COMPTE. Changer l'adresse déclenche `applyHash`, qui monte la vue et
// appelle `mountProjet()` — lequel REMET le parcours à zéro (chaque passage sur
// l'onglet repart de l'accueil). Ouvrir le parcours avant que ça se produise le
// ferait donc refermer aussitôt. On laisse d'abord l'adresse faire son travail,
// puis on ouvre.
//
// ET UN CLIC NE VAUT QU'UNE SEULE REMISE À ZÉRO. Le chemin comptait DEUX
// `mountProjet()` — celui de `applyHash` et le nôtre — donc deux `resetProjet()`,
// donc jusqu'à quatre chargements du document du comptoir, plus un passage
// visible par l'accueil à deux tuiles. « Toute la page recharge, c'est bizarre
// comme effet » (Charlie, 27/08/2026). Le verrou ci-dessous dit à `mountProjet`
// de ne rien remettre à zéro : c'est `ouvrirParcoursNeuf` qui s'en charge, pour
// le seul parcours demandé, et sans traverser l'accueil.
let ouvertureParcours = false;

async function allerAuParcours(id) {
  ouvertureParcours = true;
  try {
    setViewMode('projet');
    mountProjet();
    await projetLoading;
    if (projetModule && projetModule.ouvrirParcoursNeuf) projetModule.ouvrirParcoursNeuf(id);
  } catch (err) { reportError(err); }
  finally { ouvertureParcours = false; }
}

// LE PARCOURS À OUVRIR SE LIT DANS L'ADRESSE, il ne se passe plus de main en
// main. `#vente` et `#devis` mènent tous deux à la vue « projet » (voir VIEWS) :
// c'est le hash qui dit LEQUEL des deux, donc un rechargement, un favori et le
// bouton « précédent » du navigateur rouvrent le bon écran.
function mountProjet() {
  if (!$projet) return;
  const voulu = PARCOURS_PAR_HASH[location.hash] || null;
  // UN CLIC NE VAUT QU'UNE SEULE REMISE À ZÉRO. Quand c'est `allerAuParcours`
  // qui ouvre — recliquer sur l'onglet déjà ouvert — il le fait lui-même : sans
  // ce verrou, le parcours repartirait de zéro deux fois de suite.
  const ouvrir = () => {
    if (voulu && !ouvertureParcours && projetModule) projetModule.ouvrirParcoursNeuf(voulu);
  };
  if (!projetLoading) {
    projetLoading = Promise.all([poserFeuille('projet.css'), import('./nouveau-projet.js')])
      .then(([, m]) => { projetModule = m; return m.initProjet($projet); })
      .then(ouvrir)
      .catch((err) => {
        projetLoading = null;
        projetModule = null;
        console.error('Nouveau Projet : chargement impossible', err);
      });
    return;
  }
  // Un parcours NEUF, jamais l'accueil : `resetProjet` afficherait les deux
  // tuiles le temps d'une image et rechargerait les deux cadres (Charlie,
  // 27/08 : « toute la page recharge, c'est bizarre comme effet »).
  if (voulu) projetLoading.then(ouvrir);
  else if (!ouvertureParcours && projetModule && projetModule.resetProjet) {
    // `#nouveau-projet` : l'écran de repli, celui qui pose encore la question.
    projetModule.resetProjet();
  }
}

// Un parcours du comptoir affiché, c'est peut-être une vente à moitié saisie
// dans le cadre — et le cadre, on ne sait pas le lire d'ici. Tant que le module
// n'a pas été chargé, personne n'a rien ouvert : il n'y a rien à perdre.
function comptoirOuvert() {
  return !!(projetModule && projetModule.parcoursOuvert && projetModule.parcoursOuvert());
}

// Le comptoir vient d'enregistrer un dossier : le planning s'ouvre SUR LUI,
// à son étape, ET DÉFILE JUSQU'À SA LIGNE (flash de repère). Sans ce défilement,
// une étape passée en ordre manuel fait naître la ligne TOUT EN BAS de la
// liste : la vendeuse ne voyait rien apparaître et ressaisissait la commande.
window.addEventListener('olda:projet-cree', async (e) => {
  const { id, stage, sub, avis } = e.detail || {};
  // Le serveur a reconnu un RENVOI du même dossier : rien n'a été créé, et la
  // ligne vers laquelle on saute est celle de l'envoi précédent. On le dit —
  // sans ça, la vendeuse compte une commande de plus qu'il n'y en a.
  if (avis) showToast(avis);
  if (!stage) { location.hash = '#planning'; return; }
  // `true` : la ligne vient de naître côté serveur, elle n'est pas dans le cache
  // local — sans relecture forcée, le raccourci « même famille » redessinerait
  // ce qu'on avait déjà et rien n'apparaîtrait à l'écran.
  await ouvrirCommandeAuPlanning({ id, stage, sub }, true);
});

// Envoi AUTOMATIQUE du comptoir (écran de fin affiché tout seul, voir
// `guetterEcranFinal` dans pont.js) : on ne saute PAS sur la ligne — la
// vendeuse a son ticket à l'écran — mais si l'étape touchée (toujours « À
// trier ») est celle actuellement affichée, son cache est déjà faux. Sans
// ça, revenir sur cet onglet reprenait le raccourci « même famille » de
// `selectStage` et redessinait la liste d'AVANT cette vente.
window.addEventListener('olda:projet-cree-en-fond', (e) => {
  const { stage } = e.detail || {};
  if (stage && stage === currentStage) lastRowsSig = '';
});

// Une catégorie promue en onglet reste une vue de PLANNING : même grille, même
// en-tête. Seul le rail s'efface (l'onglet le remplace).
const isPlanningMode = (mode) => mode === 'planning' || mode in PROMOTED_BY_VIEW;

// CHANGER DE VUE SE VOIT. D'un onglet à l'autre, le contenu du cadre était
// REMPLACÉ d'une image sur l'autre : rien ne disait que c'était la même
// application qui changeait de page, et l'œil repartait de zéro à chaque fois.
// Une entrée courte — 200 ms, opacité + 6 px — suffit à relier les deux états.
// Sur le CADRE, pas sur la page : on n'anime que ce qui change.
// `opacity` et `transform` seulement : ce sont les deux propriétés que le
// compositeur sait animer sans repasser par la mise en page — une grille de
// 400 lignes ne coûte pas une image de plus.
function jouerBasculeDeVue() {
  const cadre = document.querySelector('.work');
  if (!cadre) return;
  // Le réglage système fait foi : on ne bouge rien chez qui a demandé le calme.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  cadre.classList.remove('vue-entre');
  void cadre.offsetWidth;   // force le recalcul : sans lui, l'animation ne rejoue pas
  cadre.classList.add('vue-entre');
}

function setViewMode(mode) {
  // La visibilité du planning (en-tête, grille, outil Fiverr, rail d'étapes) est
  // pilotée par une classe sur <body> : l'attribut `hidden` seul ne suffit pas,
  // ces éléments portent une règle `display` qui l'écrase.
  if ($viewPlanning) $viewPlanning.classList.toggle('active', mode === 'planning');
  if ($viewDashboard) $viewDashboard.classList.toggle('active', mode === 'dashboard');
  if ($viewClients) $viewClients.classList.toggle('active', mode === 'clients');
  if ($viewReglages) $viewReglages.classList.toggle('active', mode === 'reglages');
  if ($viewMonTravail) $viewMonTravail.classList.toggle('active', mode === 'montravail');
  if ($viewPilotage) $viewPilotage.classList.toggle('active', mode === 'pilotage');
  if ($viewTaillesLogos) $viewTaillesLogos.classList.toggle('active', mode === 'tailleslogos');
  if ($viewDevisFlash) $viewDevisFlash.classList.toggle('active', mode === 'devisflash');
  if ($viewVenteFlash) $viewVenteFlash.classList.toggle('active', mode === 'venteflash');
  if ($viewBat) $viewBat.classList.toggle('active', mode === 'bat');
  // L'AGENDA S'ALLUME DANS LE RAIL, pas dans la barre du haut. Le rail n'est
  // reconstruit qu'au changement des étapes vides : sans cette ligne, son
  // entrée resterait éteinte pendant qu'on lit l'agenda, ou allumée après
  // l'avoir quitté. Elle est ICI, avant le retour anticipé quelques lignes plus
  // bas — les onglets se repeignent même quand la vue ne change pas.
  const entree = document.querySelector('.stage--agenda');
  if (entree) {
    entree.classList.toggle('active', mode === 'agenda');
    if (mode === 'agenda') entree.setAttribute('aria-current', 'page');
    else entree.removeAttribute('aria-current');
  }
  // Deux onglets pour une seule vue : c'est le HASH qui dit lequel est allumé.
  if ($viewVente) $viewVente.classList.toggle('active', mode === 'projet' && location.hash === HASH_VENTE);
  if ($viewDevis) $viewDevis.classList.toggle('active', mode === 'projet' && location.hash === HASH_DEVIS);
  for (const p of PROMOTED) {
    const btn = document.getElementById(p.btn);
    if (btn) btn.classList.toggle('active', mode === p.view);
  }
  if (mode === viewMode) return;
  viewMode = mode;
  // La fiche atelier est montée sur <body>, pas dans la vue Planning : elle ne
  // part donc pas toute seule quand on change de vue (y compris via le bouton
  // Retour du navigateur), et elle resterait posée par-dessus le Dashboard.
  fermerFicheAtelier();

  const dash = mode === 'dashboard';
  const clients = mode === 'clients';
  const reglages = mode === 'reglages';
  const montravail = mode === 'montravail';
  const pilotage = mode === 'pilotage';
  const tailleslogos = mode === 'tailleslogos';
  const devisflash = mode === 'devisflash';
  const venteflash = mode === 'venteflash';
  const agenda = mode === 'agenda';
  const bat = mode === 'bat';
  const projet = mode === 'projet';
  if ($dashboard) $dashboard.hidden = !dash;
  if ($clients) $clients.hidden = !clients;
  if ($reglages) $reglages.hidden = !reglages;
  if ($montravail) $montravail.hidden = !montravail;
  if ($pilotage) $pilotage.hidden = !pilotage;
  if ($tailleslogos) $tailleslogos.hidden = !tailleslogos;
  if ($devisflash) $devisflash.hidden = !devisflash;
  if ($venteflash) $venteflash.hidden = !venteflash;
  if ($agenda) $agenda.hidden = !agenda;
  if ($bat) $bat.hidden = !bat;
  if ($projet) $projet.hidden = !projet;
  document.body.classList.toggle('view-plein', !isPlanningMode(mode));
  document.body.classList.toggle('view-focus', mode in PROMOTED_BY_VIEW);
  // Nouveau Projet = poste comptoir, devant le client : la nav du back-office
  // (Dashboard, Fiverr, Réglages…) disparaît, il ne reste que l'étape en cours.
  document.body.classList.toggle('view-comptoir', mode === 'projet');

  // ON MONTE LE CONTENU AVANT D'ANIMER, pas pendant. Dans l'autre ordre, le
  // cadre finissait de monter de 6 px pendant que le Point du jour posait ses
  // quatre colonnes : le mouvement du cadre et l'arrivée du contenu se
  // superposaient, et l'œil lisait deux secousses là où il n'y a qu'un clic.
  // Mesuré : colonnes posées à 42 ms, animation du cadre de 0 à 200 ms.
  if (dash) dashboard.show(); else dashboard.hide();
  if (clients) mountClients();
  if (reglages) mountReglages();
  if (montravail) mountMonTravail();
  if (pilotage) mountPilotage();
  if (tailleslogos) mountTaillesLogos();
  if (bat) mountBat();
  if (devisflash) mountDevisFlash();
  if (venteflash) mountVenteFlash();
  if (agenda) mountAgenda(); else if (agModule) agModule.hide();
  if (projet) mountProjet();

  jouerBasculeDeVue();
  if (isPlanningMode(mode)) {
    // De retour au planning : la sous-étape courante peut avoir changé ailleurs.
    updateFiverrTool(currentStage);
  }
}

// Nouveau Projet est la SEULE porte d'entrée (client, prix, délai obligatoire) :
// il n'existe plus d'écran de saisie parallèle. Les anciens `#demande` et
// `#commande` ne figurent plus ici — ils retombent sur le planning, comme tout
// hash inconnu.
// LE HASH DE LA BASE CLIENTS EST UNE CONSTANTE, plus une chaîne recopiée : la
// seule autre écriture de ce hash dans le fichier portait une barre en trop et
// l'onglet ne s'ouvrait pas (voir `ouvrirClient`).
const HASH_CLIENTS = '#clients';
// LES DEUX PARCOURS DU COMPTOIR ONT CHACUN SON ADRESSE (29/08). Ils partagent
// la vue « projet » — c'est le même onglet, le même cadre — mais pas le même
// hash : sans ça, rien dans l'URL ne dit lequel est ouvert, et un rechargement
// retombe sur l'accueil à deux tuiles.
const HASH_VENTE = '#vente';
const HASH_DEVIS = '#devis';
const PARCOURS_PAR_HASH = { [HASH_VENTE]: 'vente', [HASH_DEVIS]: 'devis' };
// L'AGENDA A UNE ADRESSE, comme les huit autres écrans — c'est ce qui lui
// permet de s'ouvrir dans un second onglet à la molette, de revenir par le
// bouton « précédent », et de rester à l'écran après un rechargement. Il n'a
// pas d'onglet dans la barre du haut pour autant : celle-ci est PLEINE (mesuré
// le 03/09 à 1 280 px, 868 px de rangée pour 868 disponibles, déjà resserrée),
// et le neuvième mot n'y tiendrait qu'en poussant le dernier hors de l'écran —
// un onglet qu'on ne voit pas est un écran qui n'existe pas. Sa porte est donc
// dans le RAIL, qui est la navigation propre au planning et qui reste à
// l'écran sur toutes les vues depuis le 24/08.
const HASH_AGENDA = '#agenda';
const VIEWS = {
  '#dashboard': 'dashboard',
  '#nouveau-projet': 'projet',
  [HASH_VENTE]: 'projet', [HASH_DEVIS]: 'projet',
  [HASH_CLIENTS]: 'clients', '#reglages': 'reglages', '#mon-travail': 'montravail',
  '#pilotage': 'pilotage',
  '#tailles-logos': 'tailleslogos',
  '#bat': 'bat',
  '#devis-flash': 'devisflash',
  '#vente-flash': 'venteflash',
  [HASH_AGENDA]: 'agenda',
  ...Object.fromEntries(PROMOTED.map((p) => [p.hash, p.view])),
};
function applyHash() {
  const h = location.hash;
  const mode = VIEWS[h] || 'planning';
  setViewMode(mode);
  // TROIS HASH MÈNENT À LA VUE « PROJET » — `#vente`, `#devis`, `#nouveau-projet`.
  // `setViewMode` ne fait RIEN quand la vue ne change pas : passer de « Vente »
  // à « Devis » laissait donc le premier parcours à l'écran, onglet allumé sur
  // le second. C'est ici qu'on demande le parcours, pas dans la bascule de vue.
  if (mode === 'projet') mountProjet();
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
  applyColWidths();
  // L'EN-TÊTE NE DÉPEND D'AUCUN RÉSEAU : on le pose avant tout appel. Hors
  // ligne (le service worker sert la coquille), l'écran affichait sinon le
  // titre de repli du HTML — « Commande » — au lieu de l'étape en cours.
  $stageTitle.textContent = currentViewLabel();
  updateStageLink(currentStage);
  updateFiverrTool(currentStage);
  // Les noms « de base » (pilote + référents par catégorie) doivent être connus
  // AVANT le premier rendu, sinon les lignes s'affichent en « Non défini » puis
  // sautent. Aucun de ces appels n'est vital : un compteur manquant ne doit pas
  // empêcher le planning de s'afficher — seul `loadRows` fait foi (son échec
  // déclenche la reprise, voir demarrerAvecReprise).
  await Promise.all([
    loadCategoryConfig(), loadCounts().catch(() => {}), loadWhatsappMessage(),
    loadTgca(), loadOrdreManuel(), chargerModeles(),
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
    // TANT QU'ON NE SAIT PAS QUI EST LÀ, on ne réessaie pas : la reprise
    // relancerait le même appel toutes les 1,5 s derrière le voile, pour
    // recevoir le même 401. C'est la connexion qui relance (elle recharge la
    // page), pas le minuteur.
    if (err && err.aConnecter) return;
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
// QUI EST AU POSTE, avant tout le reste : la question se pose pendant que le
// planning charge, pas après. Sur un appareil qui s'est déjà nommé, ce montage
// ne fait qu'écrire le nom dans la barre.
monterPoste(EMPLOYEES);

// CE QUE CHAQUE RÔLE VOIT. C'est un CONFORT, pas une sécurité : le serveur
// refuse déjà ce qu'il faut refuser, et retire les colonnes d'argent de la
// réponse elle-même. Ici on évite seulement de proposer des portes fermées —
// un opérateur qui clique « Réglages » pour tomber sur « Réservé » apprend
// juste qu'on ne lui fait pas confiance.
//
// Comptes éteints, `puisJe()` rend `true` partout : rien ne se cache, l'écran
// est exactement celui d'avant.
// DERNIER RECOURS : LES FLANCS CÈDENT, JAMAIS LES MOTS (01/09).
//
// Le rail s'est déjà resserré autant qu'il pouvait. S'il manque encore de la
// place, il y a deux mauvaises sorties : replier la barre en DEUX rangées
// d'onglets — deux endroits où chercher — ou faire défiler la rangée, ce qui
// pose le dernier onglet hors de l'écran derrière une barre de défilement que
// rien n'annonce. Un onglet qu'on ne voit pas est un écran qui n'existe pas.
//
// CE QUI CÉDAIT JUSQU'AU 01/09, C'ÉTAIENT LES LIBELLÉS : il ne restait que des
// pictogrammes muets, chacun avec son mot en infobulle qu'il fallait aller
// chercher au survol. Charlie : « je ne veux pas des icône mais les texte ».
// Ce sont donc les ICÔNES qui sont parties — la rangée passe de 1 028 px à
// 810 et tient ses mots dès 1 280, avec 58 px de reste. Ce qui se resserre
// ici, ce sont les flancs, et ça vaut pour la fenêtre plus étroite que le
// plancher de travail.
//
// ON MESURE TOUJOURS DESSERRÉ. Mesurer la rangée déjà réduite dirait « ça
// tient » et on ne la rouvrirait jamais — elle resterait serrée pour toujours
// après un seul passage sur une fenêtre étroite.
//
// DÉCLARATION DE FONCTION, pas une constante : le bloc du rail l'appelle six
// cents lignes plus haut, et une `let` y serait dans sa zone morte.
function ajusterLesOnglets() {
  const nav = document.querySelector('.nav-switch');
  if (!nav) return;
  nav.classList.remove('est-serree');
  if (nav.scrollWidth <= nav.clientWidth + 1) return;
  nav.classList.add('est-serree');
}

function appliquerDroits() {
  const onglet = (el, visible) => { if (el) el.hidden = !visible; };
  onglet($viewMonTravail, comptesActifs());
  // Le pilotage n'existe QUE pour qui voit les marges — c'est-à-dire la
  // Direction. Sans comptes, personne ne le voit : il n'aurait aucun sens
  // d'exposer le CA sur un poste qui ne sait pas qui l'utilise.
  onglet($viewPilotage, comptesActifs() && puisJe('marge'));
  onglet($viewReglages, puisJe('reglages'));
  onglet($viewClients, puisJe('clients'));
  onglet($viewVente, puisJe('clients'));
  onglet($viewDevis, puisJe('clients'));
  // « À commander » et « Fiverr » sont des entrées PROMUES (voir PROMOTED) :
  // elles n'ont pas de constante dédiée, on les prend par leur identifiant.
  onglet(document.getElementById('viewACommander'), puisJe('production'));
  onglet(document.getElementById('viewFiverr'), puisJe('clients'));
  // Le nombre d'onglets vient de changer : la rangée se remesure.
  requestAnimationFrame(() => ajusterLesOnglets());
  // Le Point du jour parle de TOUTE l'équipe : ce n'est pas l'écran d'un
  // opérateur, qui a le sien.
  onglet($viewDashboard, puisJe('production') || puisJe('clients'));

  // Le rôle descend sur <body> : le prix, la marge et les boutons d'argent se
  // cachent en CSS plutôt que par une condition répétée à trente endroits.
  const m = moi();
  for (const r of ['direction', 'chef_atelier', 'boutique', 'operateur']) {
    document.body.classList.toggle(`role-${r}`, !!m && m.role === r);
  }
  document.body.classList.toggle('sans-argent', !puisJe('argent'));

  // L'onglet ouvert est peut-être celui qu'on vient de fermer : on ne laisse
  // personne devant un écran qu'il n'a plus le droit de lire.
  const interdit = (location.hash === '#pilotage' && !puisJe('marge'))
    || (location.hash === '#reglages' && !puisJe('reglages'))
    || (location.hash === '#clients' && !puisJe('clients'))
    || (VIEWS[location.hash] === 'projet' && !puisJe('clients'));
  if (interdit) location.hash = comptesActifs() ? '#mon-travail' : '#planning';
}

// QUI, ET AVEC QUELS DROITS — avant le premier appel de données. Dans l'autre
// ordre, le planning part chercher des lignes qu'on n'a pas encore le droit de
// lire : l'écran affiche une erreur, PUIS le voile de connexion par-dessus.
// Comptes éteints, cet appel rend `{ comptes: false }` et ne fait rien d'autre.
relireSession()
  .catch(() => { /* comptes injoignables : on démarre comme avant */ })
  .then(() => {
    appliquerDroits();
    // ON NE CHARGE RIEN DERRIÈRE LE VOILE (26/08). Le commentaire ci-dessus
    // disait déjà pourquoi l'ordre compte — mais l'appel partait quand même,
    // que quelqu'un soit connecté ou non. Mesuré sur un poste verrouillé :
    // huit requêtes, huit 401, neuf erreurs rouges dans la console, sur le
    // PREMIER écran que voit celui qui arrive le matin. Et sur une liaison
    // lente, huit allers-retours dépensés à ne rien ramener.
    // La connexion recharge la page (voir session.js) : c'est elle qui lance
    // le chargement, une fois qu'on sait qui est là et ce qu'il a le droit de
    // lire. Comptes éteints, `moi()` vaut null mais `comptesActifs()` aussi —
    // et on démarre exactement comme avant.
    if (comptesActifs() && !moi()) return;
    demarrerAvecReprise();
  });
surChangement(appliquerDroits);
