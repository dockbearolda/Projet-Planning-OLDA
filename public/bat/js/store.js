// Couche de persistance : paramètres, catalogue, projets.
// Tout est stocké en JSON dans le répertoire de données de l'app (voir main.cjs).

import { uid, todayISO, fileSafe, batFileName, isProjectBlank } from './util.js';
import { productSizeLabels } from './tailles.js';
import { objectDefaults } from './producttype.js';
import { saveJSON, saveJSONNow, pendingJSON, lastServerJSON, rememberServerJSON, forgetServerJSON, forgetPending } from './persist.js';

const api = window.batApi;
const dec = new TextDecoder();

// Lecture d'un JSON de l'app. Une copie locale non confirmée (modification que
// le serveur n'a jamais reçue : onglet fermé trop vite, coupure réseau) a
// TOUJOURS raison de la copie serveur — c'est l'état le plus récent voulu par
// l'utilisateur, et la seule raison pour laquelle elle existe encore est
// précisément que le serveur ne l'a pas. Elle repartira à la prochaine
// sauvegarde (la file de persist.js la garde en attente).
async function readJSON(rel, fallback = null) {
  const local = pendingJSON(rel);
  let buf = null;
  let joignable = true;
  try {
    buf = await api.dataRead(rel);
  } catch {
    joignable = false;   // réseau coupé : l'app doit quand même s'ouvrir
  }
  let remote = fallback;
  if (buf) {
    try { remote = JSON.parse(dec.decode(new Uint8Array(buf))); } catch { remote = fallback; }
    rememberServerJSON(rel, remote);
  } else if (!joignable) {
    // Réseau injoignable seulement. Une réponse négative du serveur (fichier
    // absent, session expirée) n'invalide PAS la copie hors-ligne : c'est la
    // suppression explicite d'un projet qui l'efface (deleteProject), pas un
    // 401 passager qui viderait le hors-ligne de tout le poste.
    const offline = lastServerJSON(rel);
    if (offline !== null) remote = offline;
  }
  if (!local) return remote;
  // Les deux existent : on départage sur updatedAt quand il y en a un (projets
  // et index), sinon la copie locale gagne — elle porte une modification que
  // l'utilisateur a faite et qui n'est jamais arrivée.
  const ta = local.updatedAt, tb = remote?.updatedAt;
  if (ta && tb && String(tb).localeCompare(String(ta)) > 0) return remote;
  return local;
}

// Informations de l'installation (répertoires, séparateur, identité de build).
// Sans réseau, `appInfo()` rejette : dans un Promise.all, ce seul rejet faisait
// échouer TOUTE l'initialisation, et l'application s'ouvrait sur un écran vide
// alors que projets et catalogue étaient disponibles hors-ligne. Elles ne
// changent jamais d'une session à l'autre : la dernière copie connue fait
// parfaitement l'affaire, et à défaut les valeurs du serveur web.
async function readAppInfo() {
  const REL = 'app-info';
  try {
    const info = await api.appInfo();
    rememberServerJSON(REL, info);
    return info;
  } catch {
    return lastServerJSON(REL) || {
      dataDir: '@data', appDir: '@app',
      version: '1.0.0', platform: 'web', sep: '/', build: null,
    };
  }
}

// Écriture d'un JSON : mise en file (miroir local synchrone + envoi sérialisé).
// Ne rend pas la main sur la confirmation serveur — c'est justement ce qui
// permet à l'interface de rester fluide pendant la frappe ; l'état de la
// sauvegarde est affiché par l'indicateur de la barre supérieure.
async function writeJSON(rel, obj, base = null) {
  saveJSON(rel, obj, base);
}

// ---------------------------------------------------------------------------
// Valeurs par défaut
// ---------------------------------------------------------------------------

export const MENTIONS_DEFAUT = `En validant le présent Bon À Tirer, le client reconnaît avoir vérifié l'intégralité du document : orthographe, contenus, dimensions, emplacements, couleurs et quantités. La validation vaut acceptation définitive et engage le client sur la conformité du visuel : aucune réclamation portant sur un élément visible sur ce document ne pourra être acceptée après validation. Les couleurs affichées à l'écran ou imprimées sur ce document sont indicatives : des variations peuvent exister entre le rendu écran, l'impression papier et le résultat final sur textile, en fonction des supports, matières et techniques de marquage. Les dimensions indiquées sont exprimées en centimètres et peuvent varier de ±5 % à la production. Ce document reste la propriété de {RAISON_SOCIALE} ({SIRET}) jusqu'à complet paiement de la commande. La production est lancée exclusivement après réception du présent document daté et signé, précédé de la mention « Bon pour accord ».`;

// LES NOMS SONT CEUX DE L'ATELIER, pas ceux de la géométrie. « Avant » et
// « Côté gauche » décrivaient le vêtement vu de l'extérieur ; le bon de
// commande, lui, dit « cœur + dos », et c'est ce vocabulaire-là que le client
// relit sur le BAT. Une seule table de libellés, consommée par l'écran ET par
// le PDF : les deux ne peuvent pas diverger. Les CLÉS, elles, ne bougent pas —
// elles sont dans tous les projets déjà enregistrés.
export const FACES = {
  front: { key: 'front', label: 'Cœur', view: 'front', mirror: false, crop: 1 },
  back: { key: 'back', label: 'Dos', view: 'back', mirror: false, crop: 1 },
  sideRight: { key: 'sideRight', label: 'Manche droite', view: 'sleeve', mirror: false, crop: 0.5 },
  sideLeft: { key: 'sideLeft', label: 'Manche gauche', view: 'sleeve', mirror: true, crop: 0.5 },
};
export const FACE_ORDER = ['front', 'back', 'sideLeft', 'sideRight'];

// Face d'origine (« Avant », « Arrière »…) de chaque emplacement posé, pour
// l'en-tête de colonne du tableau de production (batpage.js / batpdf.js) :
// un placement ne porte pas lui-même sa face, seul le logo source (rangé
// dans article.faces[faceKey].logos) le sait.
export function facesByLogoId(article) {
  const map = new Map();
  for (const faceKey of FACE_ORDER) {
    const face = article.faces?.[faceKey];
    if (!face?.included) continue;
    for (const l of face.logos) map.set(l.id, FACES[faceKey].label);
  }
  return map;
}

function defaultZones() {
  // Positions en % de l'image mockup (x = centre du logo), largeur en cm réels.
  const tshirt = {
    front: [
      { id: uid(), name: 'Cœur', xPct: 60, yPct: 30, widthCm: 8 },
      { id: uid(), name: 'Poitrine', xPct: 50, yPct: 32, widthCm: 24 },
      { id: uid(), name: 'Avant G', xPct: 40, yPct: 30, widthCm: 8 },
      { id: uid(), name: 'Avant', xPct: 50, yPct: 40, widthCm: 28 },
    ],
    back: [
      { id: uid(), name: 'Dos', xPct: 50, yPct: 40, widthCm: 28 },
    ],
    sideLeft: [{ id: uid(), name: 'Manche gauche', xPct: 54, yPct: 32, widthCm: 7 }],
    sideRight: [{ id: uid(), name: 'Manche droite', xPct: 46, yPct: 32, widthCm: 7 }],
  };
  const sweat = JSON.parse(JSON.stringify(tshirt));
  const pochette = {
    front: [
      { id: uid(), name: 'Centre', xPct: 50, yPct: 50, widthCm: 18 },
      { id: uid(), name: 'Coin bas droit', xPct: 72, yPct: 72, widthCm: 7 },
    ],
    back: [{ id: uid(), name: 'Centre dos', xPct: 50, yPct: 50, widthCm: 18 }],
    sideLeft: [], sideRight: [],
  };
  return {
    'T-shirt': tshirt,
    'Sweat': sweat,
    'Polo': JSON.parse(JSON.stringify(tshirt)),
    'Débardeur': JSON.parse(JSON.stringify(tshirt)),
    'Pochette': pochette,
    'Tote bag': JSON.parse(JSON.stringify(pochette)),
    'Autre': JSON.parse(JSON.stringify(tshirt)),
  };
}

// Migration ponctuelle des noms d'emplacements (raccourcis + suppression de
// « Dos nuque », doublon jugé superflu à côté de « Dos »). Ne touche que les
// zones dont le nom correspond exactement à un ancien défaut — les zones
// ajoutées ou renommées à la main par l'utilisateur restent intactes. Le
// drapeau `_zoneNamesMigratedV1` rend l'opération idempotente : elle ne
// s'exécute qu'une seule fois par jeu de données, y compris si l'utilisateur
// choisit ensuite de revenir à un ancien nom.
const ZONE_RENAME_V1 = {
  'Poitrine centrée': 'Poitrine',
  'Avant gauche': 'Avant G',
  'Avant plein': 'Avant',
  'Dos plein': 'Dos',
};
const ZONE_REMOVE_V1 = new Set(['Dos nuque']);

function migrateZoneNames(settings) {
  if (settings._zoneNamesMigratedV1) return false;
  for (const zonesByFace of Object.values(settings.zones || {})) {
    for (const faceKey of ['front', 'back']) {
      const arr = zonesByFace[faceKey];
      if (!Array.isArray(arr)) continue;
      zonesByFace[faceKey] = arr
        .filter(z => !ZONE_REMOVE_V1.has(z.name))
        .map(z => (ZONE_RENAME_V1[z.name] ? { ...z, name: ZONE_RENAME_V1[z.name] } : z));
    }
  }
  settings._zoneNamesMigratedV1 = true;
  return true;
}

export function defaultSettings() {
  return {
    company: {
      name: 'Atelier OLDA SARL',
      capital: '500,00 €',
      siret: '978 296 952 00028',
      rcs: 'Saint-Martin',
      ape: '1813Z',
      tva: 'FR86978296952',
      address: '1 Rue Opale — Grand-Case, 97150 Saint-Martin',
      email: 'atelierolda@gmail.com',
      phone: '05 90 77 13 04',
      phoneMobile: '06 90 47 97 88',
      logoFile: null,   // fichier dans data/company/ (pdf, png, jpg, svg)
      logoType: null,
    },
    mentions: MENTIONS_DEFAUT,
    productTypes: ['T-shirt', 'Sweat', 'Polo', 'Débardeur', 'Pochette', 'Tote bag', 'Autre'],
    techniques: ['Sérigraphie', 'Broderie', 'DTF', 'Flex'],
    zones: defaultZones(),
    cataloguePath: null, // dossier contenant catalogue-export.json + mockups/
    pdf: { targetDpi: 200, jpegQuality: 0.85, maxBytes: 3 * 1024 * 1024 },
  };
}

// Lignes d'identité affichées en pied de BAT (écran + PDF) : ligne légale
// puis ligne contact. Les champs vides sont ignorés.
// Identité complète de l'entreprise sur UNE seule ligne (pied de page).
export function companyIdentityLine(c) {
  const sep = ' · ';
  return [
    c.name,
    c.capital ? 'Capital ' + c.capital : '',
    c.siret ? 'SIRET ' + c.siret : '',
    c.rcs ? 'RCS ' + c.rcs : '',
    c.ape ? 'APE ' + c.ape : '',
    c.tva ? 'TVA ' + c.tva : '',
    c.address,
    c.phone ? 'Tél. ' + c.phone : '',
    c.phoneMobile ? 'Port. ' + c.phoneMobile : '',
    c.email,
  ].filter(Boolean).join(sep);
}

// COULEUR / RÉF. PRODUIT du bandeau : dérivés du vêtement de l'article,
// surchargeables à la main. Un champ VIDE — absent ou chaîne vide — signifie
// « suivre le vêtement ». Tester avec `??` seul ne suffit pas : il ne retombe
// que sur null/undefined et laisse passer la chaîne vide, si bien qu'un article
// dont couleur valait '' affichait « — » à l'écran et sortait une case VIDE
// dans le PDF, alors même que le vêtement était choisi. Écran (batpage.js) et
// PDF (batpdf.js) passent tous deux par ici.
export const articleCouleur = (article, color) => String(article?.couleur ?? '').trim() || (color?.label || '');
export const articleRef = (article, product) => String(article?.ref ?? '').trim() || (product?.refSupplier || '');

// LA RÉFÉRENCE D'UN PRODUIT — le seul nom qu'on lui donne à l'atelier, et celui
// qui s'imprime sur le BAT. Les désignations fournisseur (« T-shirt
// écoresponsable manches longues unisexe », 45 caractères) ne servent qu'à
// CHOISIR le vêtement ; une fois choisi, c'est « NS333 » qu'on relit.
// LES DEUX RÉFÉRENCES QUAND IL Y EN A DEUX : « H-001 NS300 » — le code interne
// est celui par lequel l'atelier appelle le vêtement, la référence fournisseur
// celle qui s'imprime. C'est déjà, mot pour mot, le nom que porte le produit
// dans le catalogue OLDA ; un import TopTex n'a que la seconde, et donne
// « NS333 ».
// `name` est un dernier recours : un produit saisi à la main peut n'avoir
// aucune référence, et une case vide n'identifie rien.
export const productRef = (p) =>
  [p?.refInternal, p?.refSupplier].map((v) => String(v ?? '').trim()).filter(Boolean).join(' ')
  || p?.name || '—';

// Deux références désignent le même vêtement à la casse et à la ponctuation
// près (« CGTU05TC » ↔ « cgtu-05tc ») — même tolérance que la grille de tailles.
export const refKey = (r) => String(r || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Produit du catalogue portant cette référence fournisseur. Ré-importer une
// référence depuis TopTex doit COMPLÉTER ce produit (nouveaux coloris) et non
// en créer un jumeau : c'est ici que se joue l'absence de doublon.
export function productByRef(ref) {
  const k = refKey(ref);
  if (!k) return null;
  return store.catalogue?.products?.find(p => refKey(p.refSupplier) === k) || null;
}

// ===========================================================================
// RETROUVER UN VÊTEMENT QUAND PERSONNE N'ÉCRIT SA RÉFÉRENCE PAREIL
// ===========================================================================
// Charlie, 04/09/2026 : « ce genre de chose ne doit pas exister, la recherche
// doit faire des propositions car personne n'écrit les réfs pareil, il faut de
// la fluidité absolue car ce genre de détails nous emmerde toute la journée ».
//
// LE CAS QUI L'A DÉCLENCHÉ. Le comptoir range « K3025 » ; TopTex — et donc ce
// catalogue, indexé sur `refSupplier` — l'appelle « K3025IC ». `productByRef`
// compare deux formes réduites : « k3025 » n'est pas « k3025ic », donc rien.
// Huit références sur quarante-neuf sont dans ce cas : ça marchait une fois sur
// deux, en silence.
//
// LA CASCADE, DU PLUS SÛR AU PLUS TOLÉRANT :
//   1. la référence EXACTE (à la casse et à la ponctuation près) ;
//   2. la référence INTERNE, quand le produit en porte une ;
//   3. le PRÉFIXE, dans les deux sens — « k3025 » trouve « k3025ic », et
//      « k3025ic » trouve « k3025 ». C'est ce qui règle le cas TopTex sans
//      table à tenir.
//
// ⚠ ET SEULEMENT S'IL N'Y EN A QU'UN. Deux vêtements qui commencent pareil, ce
// n'est pas un choix à deviner : on rend la liste, et c'est l'appelant qui
// PROPOSE. Un produit choisi au hasard donnerait un BAT plausible et faux —
// c'est exactement ce qu'on essaie d'arrêter.
export function trouverProduitParRef(ref) {
  const k = refKey(ref);
  const tous = store.catalogue?.products || [];
  if (!k) return { produit: null, propositions: [] };

  const exact = tous.find(p => refKey(p.refSupplier) === k)
    || tous.find(p => refKey(p.refInternal) === k);
  if (exact) return { produit: exact, propositions: [] };

  const proches = tous.filter((p) => {
    const s = refKey(p.refSupplier);
    const i = refKey(p.refInternal);
    return (s && (s.startsWith(k) || k.startsWith(s)))
      || (i && (i.startsWith(k) || k.startsWith(i)));
  });
  if (proches.length === 1) return { produit: proches[0], propositions: [] };
  return { produit: null, propositions: proches };
}

// Nombre d'articles (tous projets confondus) qui utilisent ce vêtement. Lu dans
// l'index des projets : inutile d'ouvrir les fichiers un par un. Sert à ne
// jamais retirer du catalogue un produit dont un BAT dépend encore.
export function productUsage(productId) {
  let n = 0;
  for (const e of store.projectsIndex || []) {
    for (const a of e.articles || []) if (a.productId === productId) n++;
  }
  return n;
}

// Les projets concernés, nommés. « Ce vêtement sert encore quelque part » n'aide
// personne : il faut pouvoir aller ouvrir LE projet qui bloque.
export function productProjects(productId) {
  return (store.projectsIndex || [])
    .filter(e => (e.articles || []).some(a => a.productId === productId))
    .map(e => [e.client, e.name].map(s => String(s || '').trim()).filter(Boolean).join(' — ') || 'Projet sans nom');
}

// Fragment « modèle » du nom de fichier BAT (cf. batFileName) : le nom du
// vêtement tel qu'il est choisi dans le sélecteur (« H-001 NS300 »). Une
// commande peut mélanger plusieurs vêtements : on nomme les deux premiers, et
// au-delà on compte (« H-001-NS300-x4 ») pour garder un nom manipulable.
export function projectModel(project) {
  const names = [...new Set((project?.articles || [])
    .map(a => store.product(a.productId)?.name)
    .filter(Boolean))];
  if (!names.length) return 'modele';
  if (names.length <= 2) return names.map(fileSafe).join('-');
  return `${fileSafe(names[0])}-x${names.length}`;
}

// Nom du fichier BAT d'un projet. Une seule source de vérité : l'export
// (batpage.js) a besoin du nom AVANT la génération — pour ouvrir le sélecteur
// « Enregistrer sous » tant que le clic de l'utilisateur est encore valide —
// et la génération (batpdf.js) le renvoie ensuite ; les deux doivent coïncider.
export function projectFileName(project) {
  return batFileName(project.client, project.fiche.date, projectModel(project), project.fiche.version || 1);
}

// ---------------------------------------------------------------------------
// CE QUI MANQUE AVANT D'ENVOYER
// ---------------------------------------------------------------------------
// Un BAT est le document que le client SIGNE. L'export ne vérifiait que le
// client, le nom du projet et qu'une face soit cochée : une feuille pouvait
// partir avec l'échéance vide, aucune quantité et aucun logo, sans un mot.
// Ces contrôles ne BLOQUENT pas — c'est parfois volontaire (un BAT purement
// visuel, une échéance encore inconnue). Ils se disent, et on décide.
// Fonction pure : elle ne lit que le projet, elle est donc testable telle
// quelle et ne peut pas mentir sur ce qu'elle inspecte.
export function manquesDuBat(project) {
  const out = [];
  if (!project) return out;
  const arts = project.articles || [];
  if (!String(project.fiche?.deadline || '').trim()) out.push('L\'échéance n\'est pas renseignée.');

  const sansQuantite = arts.filter(a => !(a.sizes || []).some(s => String(s.quantite ?? '').trim()));
  if (sansQuantite.length === arts.length && arts.length) {
    out.push('Aucune quantité n\'est saisie.');
  } else if (sansQuantite.length) {
    out.push(sansQuantite.length === 1
      ? 'Un article n\'a aucune quantité.'
      : `${sansQuantite.length} articles n'ont aucune quantité.`);
  }

  const sansLogo = arts.filter(a => !FACE_ORDER.some(k => a.faces?.[k]?.included && (a.faces[k].logos || []).length));
  if (sansLogo.length === arts.length && arts.length) {
    out.push('Aucun marquage n\'est posé sur le vêtement.');
  } else if (sansLogo.length) {
    out.push(sansLogo.length === 1
      ? 'Un article n\'a aucun marquage posé.'
      : `${sansLogo.length} articles n'ont aucun marquage posé.`);
  }

  const tailleSansNom = arts.some(a => (a.sizes || []).some(s => !String(s.taille ?? '').trim()));
  if (tailleSansNom) out.push('Une colonne de taille n\'a pas d\'intitulé.');

  return out;
}

// Variables disponibles dans le texte des mentions légales du BAT.
export function companyMentionVars(c) {
  return {
    RAISON_SOCIALE: c.name || '', CAPITAL: c.capital || '', SIRET: c.siret || '',
    RCS: c.rcs || '', APE: c.ape || '', TVA: c.tva || '', ADRESSE: c.address || '',
    EMAIL: c.email || '', TELEPHONE: c.phone || '', PORTABLE: c.phoneMobile || '',
  };
}

// Calibration par défaut : largeur réelle du vêtement (cm) et largeur du
// vêtement en % de la largeur de l'image mockup.
export function defaultCalibration(type, view) {
  // Objets (mug, gourde…) : leur largeur réelle n'a rien à voir avec celle
  // d'un vêtement — 9,5 cm pour un mug contre 53 pour un t-shirt. Un type
  // inconnu de la table objet retombe sur la table vêtement d'origine. Un
  // objet n'ayant ni manche ni côté, la vue ne change rien pour lui.
  const obj = objectDefaults(type);
  if (obj) return obj;

  const garment = {
    'T-shirt': 53, 'Sweat': 56, 'Polo': 53, 'Débardeur': 48,
    'Pochette': 38, 'Tote bag': 38, 'Autre': 53,
  }[type] ?? 53;
  if (view === 'sleeve') return { widthCm: Math.round(garment * 0.45), widthPct: 42 };
  return { widthCm: garment, widthPct: { 'Pochette': 82, 'Tote bag': 80 }[type] ?? 66 };
}

// ---------------------------------------------------------------------------
// Articles : un projet client = une commande, donc PLUSIEURS articles
// (« 2 pochettes, 3 t-shirts, 2 casquettes »). Chaque article porte son
// vêtement, ses faces/logos et sa propre grille commande + marquage ; il occupe
// un onglet dans l'éditeur et UNE page du PDF exporté. Le client, le nom du
// projet, l'échéance, la date et la version restent au niveau du projet : un
// seul document, signé une fois.
// ---------------------------------------------------------------------------

// Lignes de tailles d'un article neuf. Un objet sans taille (mug…) n'a pas
// cinq lignes S/M/L/XL/2XL à effacer : il démarre sur une ligne libre, où
// seule la quantité est à saisir.
function newArticleSizes(product) {
  const labels = productSizeLabels(product);
  return labels.length
    ? labels.map(taille => ({ id: uid(), taille, quantite: '' }))
    : [{ id: uid(), taille: '', quantite: '' }];
}

export function newArticle({ productId, colorSlug } = {}) {
  const faces = {};
  for (const f of FACE_ORDER) faces[f] = { included: f === 'front', logos: [] };
  return {
    id: uid(), productId, colorSlug,
    // couleur / ref : absents = suivent le vêtement (cf. articleCouleur/articleRef).
    faces,
    // Grille fusionnée : lignes = tailles (taille+qté), colonnes = un
    // emplacement par logo posé (largeur d'impression par taille + couleur).
    // Tailles reprises de l'app « Tailles Logo DTF » pour ce vêtement (XS…2XL,
    // « 2/4 ans », « 3 mois »… selon la catégorie) ; ajout/suppression via la
    // grille.
    sizes: newArticleSizes(store.product(productId)),
    placements: [],   // { id, logoId, name, color, dims:{sizeId:'largeur cm'}, auto }
  };
}

// Copie complète d'un article (logos posés + grille), avec de nouveaux ids :
// le geste « Dupliquer » de l'onglet — la même pochette dans une 2e couleur se
// obtient alors en un clic de plus, sans reposer les logos.
export function cloneArticle(src) {
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid();
  // Ré-identifier les logos ET les colonnes qui les suivent : les ids de logo
  // sont la clé de rattachement (placements[].logoId, facesByLogoId), deux
  // articles ne peuvent pas les partager.
  const remap = new Map();
  for (const faceKey of FACE_ORDER) {
    for (const l of copy.faces?.[faceKey]?.logos || []) {
      const id = uid();
      remap.set(l.id, id);
      l.id = id;
    }
  }
  const sizeRemap = new Map();
  for (const s of copy.sizes || []) { const id = uid(); sizeRemap.set(s.id, id); s.id = id; }
  for (const p of copy.placements || []) {
    p.id = uid();
    if (p.logoId) p.logoId = remap.get(p.logoId) ?? null;
    const dims = {};
    for (const [sizeId, v] of Object.entries(p.dims || {})) dims[sizeRemap.get(sizeId) ?? sizeId] = v;
    p.dims = dims;
  }
  return copy;
}

// Projets d'avant le multi-articles : le vêtement, les faces et la grille
// vivaient à plat sur le projet (productId/colorSlug/faces) et dans la fiche
// (sizes/placements/couleur/ref). On les replie dans un article unique —
// idempotent, et appliqué à CHAQUE lecture (aucune réécriture forcée du
// fichier : la conversion est refaite tant que le projet n'est pas réenregistré).
// Clés de grille ayant vécu dans `fiche` : formats successifs
// (orderRows/markRows → order/rows → sizes/placements). On les DÉPLACE telles
// quelles sur l'article ; leur conversion vers la grille actuelle reste le
// travail de migrateGrid (batpage.js), qui les trouve désormais là.
const ARTICLE_KEYS = ['sizes', 'placements', 'couleur', 'ref', 'order', 'rows', 'orderRows', 'markRows', 'markRowsOverride'];

export function migrateProject(p) {
  if (!p) return p;
  const f = p.fiche || (p.fiche = {});
  if (!Array.isArray(p.articles) || !p.articles.length) {
    const art = { id: uid(), productId: p.productId, colorSlug: p.colorSlug, faces: p.faces || {} };
    for (const k of ARTICLE_KEYS) if (f[k] !== undefined) { art[k] = f[k]; delete f[k]; }
    p.articles = [art];
  }
  // Le vêtement et les faces appartiennent à l'article : plus rien ne lit ces
  // champs à plat sur le projet.
  delete p.productId; delete p.colorSlug; delete p.faces;
  for (const a of p.articles) {
    a.id ??= uid();
    a.faces ??= {};
    for (const k of FACE_ORDER) a.faces[k] ??= { included: false, logos: [] };
    a.placements ??= [];
  }
  return p;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Entrée d'index : de quoi dessiner la carte de l'écran Projets sans ouvrir le
// fichier projet — dont la LISTE des articles (vignette + pastille par article).
function indexEntry(p) {
  return {
    id: p.id, client: p.client, name: p.name,
    articles: (p.articles || []).map(a => ({ productId: a.productId, colorSlug: a.colorSlug })),
    updatedAt: p.updatedAt, version: p.fiche?.version ?? 1,
    // LA FICHE DU CRM, DANS L'INDEX. Sans elle, retrouver « le BAT de la fiche
    // req-42 » obligeait à OUVRIR les projets un par un. Monté dans le CRM,
    // c'est le tout premier geste au chargement : il tombait donc en plein sur
    // le chemin critique. Avec, c'est un balayage de l'index déjà en mémoire.
    // Chaîne vide et non `undefined` : `undefined` est le marqueur d'une entrée
    // écrite par une version antérieure, et il déclenche le balayage de secours.
    crmRequestId: p.crmRequestId || '',
    // BAT VIERGE : rien saisi, rien posé. Calculé ICI, à l'enregistrement, et
    // pas au démarrage — `startNewProject` reprend le BAT vierge s'il en existe
    // un, et sans ce drapeau il devait OUVRIR les projets un par un pour le
    // reconnaître : jusqu'à cinq allers-retours réseau en série avant le premier
    // affichage. Avec, il en fait un seul, sur le bon.
    vierge: isProjectBlank(p),
  };
}

// Entrées d'index d'avant le multi-articles : un seul vêtement à plat.
function migrateIndexEntry(e) {
  if (!Array.isArray(e.articles)) e.articles = [{ productId: e.productId, colorSlug: e.colorSlug }];
  delete e.productId; delete e.colorSlug;
  return e;
}

export const store = {
  settings: null,
  catalogue: null, // { products: [...] }
  projectsIndex: null, // [{id, client, name, articles:[{productId,colorSlug}], updatedAt, version}]
  appInfo: null,

  async init() {
    // Les 4 lectures sont indépendantes : en parallèle plutôt qu'en cascade
    // (≈1 aller-retour réseau au lieu de 4 au démarrage).
    const [appInfo, savedSettings, catalogue, projectsIndex] = await Promise.all([
      readAppInfo(),
      readJSON('settings.json', {}),
      readJSON('catalogue.json', { products: [] }),
      readJSON('projects-index.json', []),
    ]);
    this.appInfo = appInfo;
    this.settings = { ...defaultSettings(), ...savedSettings };
    // fusion douce : les nouvelles clés par défaut apparaissent après mise à jour
    const d = defaultSettings();
    this.settings.company = { ...d.company, ...this.settings.company };
    this.settings.pdf = { ...d.pdf, ...this.settings.pdf };
    if (!this.settings.zones || !Object.keys(this.settings.zones).length) this.settings.zones = d.zones;
    if (migrateZoneNames(this.settings)) await this.saveSettings();
    this.catalogue = catalogue && Array.isArray(catalogue.products) ? catalogue : { products: [] };
    this.projectsIndex = (Array.isArray(projectsIndex) ? projectsIndex : []).map(migrateIndexEntry);
    // Filet anti-perte de données : si l'index est vide/illisible alors que des
    // fichiers projet subsistent sur disque (index corrompu par une écriture
    // interrompue), on le reconstruit AVANT toute sauvegarde qui l'écraserait.
    await this.reconcileIndex();
  },

  async saveSettings() { await writeJSON('settings.json', this.settings); },
  // Le catalogue (≈550 Ko) s'écrit sur une action explicite avec sa propre
  // progression, jamais au fil de la frappe : écriture attendue, dont l'échec
  // doit remonter à l'appelant (« import interrompu ») plutôt que d'être
  // rejoué en silence.
  async saveCatalogue() { await saveJSONNow('catalogue.json', this.catalogue); },
  async saveProjectsIndex() { await writeJSON('projects-index.json', this.projectsIndex); },

  // Reconstruit l'index des projets depuis le dossier `projects/` quand l'index
  // en mémoire est vide mais que des fichiers projet existent. Idempotent : ne
  // fait rien pour une installation neuve (dossier vide) ni index déjà peuplé.
  async reconcileIndex() {
    if (this.projectsIndex.length) return;
    let files = [];
    try { files = await api.dataList('projects'); } catch { files = []; }
    const jsons = (files || []).filter(f => !f.dir && /\.json$/i.test(f.name));
    if (!jsons.length) return;
    const rebuilt = [];
    for (const f of jsons) {
      const p = migrateProject(await readJSON(`projects/${f.name}`, null));
      if (!p?.id) continue;
      p.updatedAt ||= p.createdAt || todayISO();
      rebuilt.push(indexEntry(p));
    }
    if (!rebuilt.length) return;
    rebuilt.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    this.projectsIndex = rebuilt;
    await this.saveProjectsIndex();
  },

  // `?.` : appelable avant init() (catalogue encore null) — newArticle s'en sert
  // pour lire les tailles du produit, et un article doit rester créable même
  // sans catalogue chargé.
  product(id) { return this.catalogue?.products?.find(p => p.id === id) || null; },

  // --- Projets ---------------------------------------------------------
  async loadProject(id) { return migrateProject(await readJSON(`projects/${id}.json`)); },

  async saveProject(p) {
    // BASE = l'horodatage que le fichier portait AVANT cette écriture, c'est-à-
    // dire l'état du serveur qu'on avait sous les yeux. Le serveur refuse
    // l'écriture si le disque a bougé depuis : sans cela, deux postes ouverts
    // sur le même projet s'écrasaient l'un l'autre en silence.
    const base = typeof p.updatedAt === 'string' ? p.updatedAt : null;
    p.updatedAt = new Date().toISOString();
    await writeJSON(`projects/${p.id}.json`, p, base);
    const i = this.projectsIndex.findIndex(x => x.id === p.id);
    const entry = indexEntry(p);
    if (i === -1) this.projectsIndex.unshift(entry); else this.projectsIndex[i] = entry;
    // `String(...)` des DEUX côtés : une entrée héritée sans `updatedAt` (index
    // d'avant ce champ) faisait lever `Cannot read properties of undefined` —
    // et c'est l'enregistrement du projet en cours qui échouait, pas l'affichage
    // de la vieille entrée.
    this.projectsIndex.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    await this.saveProjectsIndex();
  },

  async deleteProject(id) {
    const rel = `projects/${id}.json`;
    // L'ORDRE COMPTE : on oublie d'abord ce qui est EN ATTENTE d'envoi. Un
    // projet modifié hors-ligne laisse un miroir local et une écriture en file ;
    // supprimé, cette écriture partait quand même — au retour du réseau ou au
    // démarrage suivant (`resumePending`) — et recréait le fichier sur le
    // serveur. Le projet ressuscitait, sans ligne dans l'index, jusqu'à ce
    // qu'une reconstruction de l'index le fasse réapparaître dans la liste.
    forgetPending(rel);
    await api.dataDelete(rel);
    // Sinon le projet réapparaîtrait à la première ouverture hors-ligne, servi
    // par sa copie locale — un projet supprimé doit l'être partout.
    forgetServerJSON(rel);
    this.projectsIndex = this.projectsIndex.filter(x => x.id !== id);
    await this.saveProjectsIndex();
  },

  newProject({ client, name, productId, colorSlug }) {
    return {
      id: uid(), client, name,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      articles: [newArticle({ productId, colorSlug })],
      fiche: { date: todayISO(), version: 1 },
      history: [],
    };
  },

  async duplicateProject(id) {
    const src = await this.loadProject(id);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    const nextVer = (src.fiche?.version ?? 1) + 1;
    // évite l'empilement des suffixes « (v2) (v3) » sur duplications successives
    const base = String(src.name || '').replace(/\s*\(v\d+\)\s*$/i, '');
    copy.name = `${base} (v${nextVer})`;
    copy.createdAt = new Date().toISOString();
    copy.fiche.version = (src.fiche?.version ?? 1) + 1;
    copy.fiche.date = todayISO();
    copy.history = [];
    await this.saveProject(copy);
    return copy;
  },

  // --- Logos importés, dédupliqués par hash de contenu -----------------
  // `type` = extension du fichier stocké ('pdf' vectoriel, 'png'/'jpg'
  // matriciels — cf. logoasset.js) et vaut 'pdf' par défaut : les logos posés
  // avant l'import d'images n'en portent pas et se relisent au même chemin.
  async saveLogoFile(hash, bytes, type = 'pdf') { await api.dataWrite(`logos/${hash}.${type}`, bytes); },
  async readLogoFile(hash, type = 'pdf') { return api.dataRead(`logos/${hash}.${type}`); },

  // --- Fichiers du catalogue (chemins relatifs au dossier catalogue) ---
  catalogueAbs(rel) {
    if (!this.settings.cataloguePath) return null;
    const sep = this.appInfo.sep;
    const clean = String(rel || '').replace(/^\//, '').split('/').join(sep);
    return this.settings.cataloguePath + sep + clean;
  },

  async readCatalogueFile(rel) {
    // mockups personnalisés (produits créés à la main) : stockés dans les données de l'app
    if (String(rel).startsWith('custom/')) return api.dataRead('mockups-custom/' + rel.slice(7));
    const abs = this.catalogueAbs(rel);
    return abs ? api.fsRead(abs) : null;
  },

  // Ne supprime QUE dans les données de l'application. Le catalogue OLDA
  // importé est une source extérieure, en lecture seule : rien de ce que fait
  // BAT Studio ne doit pouvoir effacer un fichier chez quelqu'un d'autre.
  async deleteCatalogueFile(rel) {
    if (!String(rel).startsWith('custom/')) return false;
    await api.dataDelete('mockups-custom/' + rel.slice(7));
    return true;
  },
};

// ---------------------------------------------------------------------------
// Import du catalogue « olda-catalogue-export/v1 »
// ---------------------------------------------------------------------------

function guessType(ref) {
  const id = (ref.id || '').toUpperCase();
  if (ref.category === 'POCHETTE' || id.includes('KI3210')) return 'Pochette';
  if (ref.sleeveType === 'none') return 'Pochette';
  if (ref.sleeveType === 'long') return 'Sweat';
  if (ref.sleeveType === 'sleeveless') return 'Débardeur';
  return 'T-shirt';
}

export async function importOldaCatalogue(folderAbs) {
  const sep = store.appInfo.sep;
  const jsonBuf = await api.fsRead(folderAbs + sep + 'catalogue-export.json');
  if (!jsonBuf) throw new Error("catalogue-export.json introuvable dans ce dossier.");
  const data = JSON.parse(dec.decode(new Uint8Array(jsonBuf)));
  if (data.schema !== 'olda-catalogue-export/v1') {
    throw new Error('Schéma non reconnu : ' + (data.schema || 'inconnu'));
  }

  const products = data.refs.map(ref => {
    const type = guessType(ref);
    const colors = (ref.colors || []).map(c => {
      const views = {};
      for (const [view, sizes] of Object.entries(c.images || {})) {
        views[view] = {
          full: (sizes.full || '').replace(/^\//, ''),
          medium: (sizes.medium || sizes.full || '').replace(/^\//, ''),
          thumb: (sizes.thumb || sizes.medium || sizes.full || '').replace(/^\//, ''),
        };
      }
      return { slug: c.slug, label: c.label, hex: c.hex, views };
    });
    return {
      id: ref.id, name: ref.label || ref.id,
      refInternal: ref.refInternal || '', refSupplier: ref.refSupplier || '',
      category: ref.category || '', sleeveType: ref.sleeveType || 'short',
      type, colors,
      calibration: {
        front: defaultCalibration(type, 'front'),
        back: defaultCalibration(type, 'back'),
        sleeve: defaultCalibration(type, 'sleeve'),
      },
    };
  });

  store.settings.cataloguePath = folderAbs;
  store.catalogue = { products, sideSpec: data.sideSpec || null, importedAt: new Date().toISOString() };
  await store.saveSettings();
  await store.saveCatalogue();
  return products.length;
}

// Résolution d'une vue « sleeve » pour une couleur donnée (own → borrowed).
export function resolveSleeve(product, colorSlug) {
  const color = product.colors.find(c => c.slug === colorSlug);
  if (!color) return null;
  if (color.views.sleeve?.full) return { rel: color.views.sleeve.full, kind: 'own' };
  if (product.sleeveType === 'none') return null;
  // même produit, même slug de base ou hex proche
  const target = color.hex;
  let best = null, bestD = Infinity;
  for (const prod of store.catalogue.products) {
    if (prod.sleeveType !== product.sleeveType) continue;
    for (const c of prod.colors) {
      if (!c.views.sleeve?.full) continue;
      const d = colorDist(c.hex, target) + (prod.id === product.id ? 0 : 10) + (c.slug === colorSlug ? -20 : 0);
      if (d < bestD) { bestD = d; best = c.views.sleeve.full; }
    }
  }
  if (best && bestD <= 45) return { rel: best, kind: 'borrowed' };
  return null;
}

function colorDist(a, b) {
  const pa = parseInt(String(a || '#000').slice(1), 16), pb = parseInt(String(b || '#000').slice(1), 16);
  const ra = (pa >> 16) & 255, ga = (pa >> 8) & 255, ba = pa & 255;
  const rb = (pb >> 16) & 255, gb = (pb >> 8) & 255, bb = pb & 255;
  return Math.sqrt(((ra - rb) ** 2 + (ga - gb) ** 2 + (ba - bb) ** 2) / 3);
}

// Faces réellement disponibles pour un produit+couleur.
export function availableFaces(product, colorSlug) {
  const color = product.colors.find(c => c.slug === colorSlug);
  if (!color) return [];
  const out = [];
  if (color.views.front?.full) out.push('front');
  if (color.views.back?.full) out.push('back');
  if (product.sleeveType !== 'none' && resolveSleeve(product, colorSlug)) {
    out.push('sideLeft', 'sideRight');
  }
  return out;
}
