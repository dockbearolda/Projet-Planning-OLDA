// Tailles produit : les lignes du tableau de production (« Taille · Qté »)
// viennent de l'app « Tailles Logo DTF », où elles sont déjà tenues à jour
// produit par produit. Plus rien à retaper à chaque BAT : choisir le vêtement
// suffit.
//
// Lecture seule, et jamais bloquant : si la grille est injoignable (app
// distante en panne, variante bureau sans serveur), on retombe sur les tailles
// par défaut — un BAT reste toujours créable.

import { uid } from './util.js';
import { chemin } from './base.js';
import { guessSizeCategory } from './producttype.js';

// Repli quand le produit est inconnu de la grille (pochettes, accessoires…).
// XS EN FAIT PARTIE : c'est la série adulte de la grille elle-même, où HOMME
// comme FEMME vont de XS à 2XL. Sans elle, un produit hors grille ne proposait
// que S…2XL — commander un XS demandait de l'ajouter à la main, et la ligne
// arrivait marquée « hors série », comme si la taille était exotique.
export const DEFAULT_SIZE_LABELS = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

// Rapprochement des références : « H-021 » et « H021 » désignent le même
// produit dans les deux applications, la ponctuation près.
const normKey = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Rapprochement des tailles entre l'ancienne grille et la nouvelle (« 2/4 ans »
// ↔ « 2/4 ANS ») pour reporter les quantités déjà saisies.
const normLabel = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '');

// ---------------------------------------------------------------------------
// Grille distante
// ---------------------------------------------------------------------------
let table = null;      // dernière grille chargée, ou null
let loading = null;

// Charge la grille une fois pour toutes. Ne rejette jamais : `null` = grille
// indisponible, l'appelant se rabat sur les tailles par défaut.
export function loadTailles() {
  if (table) return Promise.resolve(table);
  loading ??= fetch(chemin('/api/tailles'))
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((t) => {
      if (Array.isArray(t?.products)) table = t;
      loading = null;
      return table;
    });
  return loading;
}

// ---------------------------------------------------------------------------
// Appariement produit du catalogue → tailles
// ---------------------------------------------------------------------------

// Ligne de la grille correspondant à un produit du catalogue, par ordre de
// fiabilité décroissante : même code interne (H-001), puis même référence
// fournisseur (NS300). Null si le produit n'y figure pas.
export function findProduct(t, product) {
  if (!Array.isArray(t?.products) || !product) return null;
  const code = normKey(product.refInternal);
  const ref = normKey(product.refSupplier);
  return (code && t.products.find(p => normKey(p.code) === code)) ||
    (ref && t.products.find(p => normKey(p.reference) === ref)) ||
    null;
}

// LE RAYON D'UN PRODUIT, tel que la grille le nomme (HOMME, ENFANT, BEBE…).
// Trois sources, de la plus sûre à la plus faible :
//   1. la ligne de la grille — c'est l'app tailles qui a classé ce produit ;
//   2. le champ `category` du catalogue — renseigné à l'import OLDA ;
//   3. la DÉSIGNATION du produit, en dernier recours.
// Le troisième point n'est pas un luxe : un produit importé de TopTex reçoit sa
// MARQUE dans `category` (« Native Spirit »). Aucun rayon ne s'y rattachait, et
// un t-shirt enfant se retrouvait donc proposé en XS…2XL — alors que son nom,
// lui, dit « enfant ».
// On ne retient qu'un rayon que la grille CONNAÎT : un libellé inventé ne doit
// pas faire échouer la recherche, il doit la laisser retomber sur le repli.
function sizeCategory(t, match, product) {
  const connu = (v) => {
    const k = String(v ?? '').toUpperCase().trim();
    return k && t?.categories?.[k]?.sizes?.length ? k : null;
  };
  return connu(match?.category) || connu(product?.category) || connu(guessSizeCategory(product?.name));
}

// Tailles d'un produit : les siennes si la grille les connaît, sinon celles de
// son rayon (HOMME → XS…2XL, ENFANT → 2/4 ans…, BEBE → 3 mois…) — un produit
// tout juste ajouté n'a pas encore de ligne dans l'app tailles, mais son rayon,
// lui, a bien ses tailles. Renvoie null si rien ne correspond.
export function findProductSizes(t, product) {
  const match = findProduct(t, product);
  const own = (match?.sizes || []).map(s => String(s.label || '').trim()).filter(Boolean);
  if (own.length) return own;

  const cat = sizeCategory(t, match, product);
  return cat ? [...t.categories[cat].sizes] : null;
}

// Face du BAT → colonne de la grille. Les manches n'ont pas de cote définie
// dans l'app tailles : leur marquage reste piloté par le logo posé.
const FACE_FIELD = { front: 'devant', back: 'dos' };

// Largeur d'impression (cm) prévue pour ce produit, cette face et cette taille.
// C'est la valeur métier du BAT : elle grandit avec la taille (H-001 au dos :
// 24 cm en XS, 32 cm en XL), là où la largeur du logo posé sur le mockup est
// la même partout. Null quand la grille ne la renseigne pas — l'appelant
// retombe alors sur la largeur du logo.
export function findPrintWidthCm(t, product, faceKey, sizeLabel) {
  const field = FACE_FIELD[faceKey];
  if (!field || !sizeLabel) return null;
  const rows = findProduct(t, product)?.sizes || [];
  const mm = rows.find(r => normLabel(r.label) === normLabel(sizeLabel))?.[field];
  return Number.isFinite(mm) && mm > 0 ? mm / 10 : null;
}

export const printWidthCm = (product, faceKey, sizeLabel) =>
  findPrintWidthCm(table, product, faceKey, sizeLabel);

// Un produit porte-t-il des tailles ? Les objets (mug, gourde, tapis…) n'en
// ont pas : leur BAT ne demande qu'une quantité. L'ABSENCE du champ vaut
// « oui » — les produits déjà au catalogue se relisent sans migration.
export const productHasSizes = (product) => product?.sized !== false;

// Tailles à donner à un article portant ce produit — toujours une liste
// exploitable, même sans grille. Vide pour un objet sans taille : l'appelant
// (newArticleSizes) pose alors une unique ligne libre.
export const productSizeLabels = (product) =>
  productHasSizes(product) ? (findProductSizes(table, product) || [...DEFAULT_SIZE_LABELS]) : [];

// LA SÉRIE COMPLÈTE DU RAYON auquel appartient ce produit — celle à laquelle
// une grille de produit incomplète a le droit de se compléter.
// Ce n'est PAS toujours XS…2XL. Compléter « 2/4 ans » avec la série adulte met
// bout à bout deux séries qui n'ont rien à voir : la rangée des quantités
// s'ouvrait sur XS…2XL suivis de « 2/4 ans » — six tailles qui ne seront jamais
// commandées, et le mot qu'on cherchait (« 10/12 ans ») absent parce que la
// grille du produit ne le connaissait pas encore.
function findSizeSeries(t, product) {
  const cat = sizeCategory(t, findProduct(t, product), product);
  const serie = cat ? t.categories[cat].sizes : null;
  return serie?.length ? [...serie] : [...DEFAULT_SIZE_LABELS];
}

// ---------------------------------------------------------------------------
// Application à un article
// ---------------------------------------------------------------------------

// Remplace les lignes de tailles d'un article par `labels`, SANS rien perdre :
// une taille déjà présente garde sa ligne (donc son id, sa quantité et ses
// cotes), et une taille absente de la grille mais déjà commandée est conservée
// à la suite. L'opération est ainsi sûre à rejouer — pas de confirmation à
// demander, pas de saisie effacée.
export function applySizeLabels(article, labels) {
  const old = article.sizes || [];
  const byLabel = new Map();
  for (const s of old) {
    const k = normLabel(s.taille);
    if (k && !byLabel.has(k)) byLabel.set(k, s);
  }

  const kept = new Set();
  const next = labels.map((label) => {
    const s = byLabel.get(normLabel(label));
    if (!s) return { id: uid(), taille: label, quantite: '' };
    kept.add(s);
    s.taille = label;   // aligne la casse/graphie sur la grille
    return s;
  });
  for (const s of old) {
    if (!kept.has(s) && String(s.quantite ?? '').trim()) next.push(s);
  }
  article.sizes = next;

  purgeDims(article, next);
  return next;
}

// Cotes : celles des tailles disparues sont purgées. Les nouvelles tailles sont
// laissées vides sur les colonnes rattachées à un logo — syncGrid y pose juste
// après la cote du produit (ou la largeur du logo) ; y écrire une valeur
// provisoire ici la ferait passer pour une saisie manuelle, donc intouchable.
// Les colonnes détachées, elles, n'ont plus que leur valeur automatique.
function purgeDims(article, next) {
  const ids = new Set(next.map(s => s.id));
  for (const p of article.placements || []) {
    p.dims ??= {};
    if (!p.logoId) for (const s of next) if (p.dims[s.id] === undefined) p.dims[s.id] = p.auto?.dim ?? '';
    for (const k of Object.keys(p.dims)) if (!ids.has(k)) delete p.dims[k];
  }
}

// ---------------------------------------------------------------------------
// LES TAILLES SERVIES
// ---------------------------------------------------------------------------
// Un bon à tirer n'a aucune raison d'imprimer une ligne « XS — » : la taille
// n'est pas commandée, elle ne dit rien au client, et elle coûte 16 pt de
// hauteur — pris sur le vêtement, seule chose que la page est trop petite pour
// montrer. Une taille est donc SERVIE quand elle a une ligne, et le choix se
// fait au rail, en boîtes de 50 px, plutôt qu'au clavier dans une case de 9 pt.
//
// LA RÈGLE QUI REND LE GESTE SÛR : une taille QUI PORTE UNE QUANTITÉ ne peut
// pas être retirée. Elle est commandée, par définition — la retirer d'un clic
// jetterait une saisie sans rien demander. Le verrou remplace la confirmation :
// il n'y a pas de geste destructeur à confirmer.

const aQuantite = (s) => String(s?.quantite ?? '').trim() !== '';

// LA SÉRIE DE RÉFÉRENCE — ce que le rail a le droit de proposer, et qui ne doit
// PAS dépendre de ce qui est servi à l'instant : sinon retirer une taille la
// fait disparaître du choix, et le geste devient une porte à sens unique.
//
// La grille du produit fait foi… quand elle est complète. Elle est parfois plus
// PAUVRE que la série de son rayon : la table DTF ne connaît qu'une taille pour
// certaines références (mesuré sur BY190 : « L » seule ; sur NS307, enfant :
// « 2/4 ans » et « 4/6 ans » seulement). On prend donc la plus riche des deux
// comme ossature, et on ajoute à la suite ce que l'autre a en propre —
// l'ordre reste celui de la liste qui mène.
// La série de complément est celle du RAYON, jamais la série adulte par
// principe : un t-shirt enfant se complète en « 6/8 ans », pas en « XL ».
export function findSizeReference(t, product) {
  const grille = productHasSizes(product) ? (findProductSizes(t, product) || [...DEFAULT_SIZE_LABELS]) : [];
  if (!grille.length) return grille;   // objet sans taille : rien à proposer
  const serie = findSizeSeries(t, product);
  const [tete, queue] = grille.length >= serie.length ? [grille, serie] : [serie, grille];
  const vus = new Set(tete.map(normLabel));
  return [...tete, ...queue.filter(l => !vus.has(normLabel(l)))];
}

export const sizeReference = (product) => findSizeReference(table, product);

// La série proposée au rail : la grille du produit, puis les tailles servies
// qui n'y sont pas (une taille hors catalogue déjà posée ne doit pas
// disparaître du choix parce qu'elle n'est pas au catalogue).
export function sizeChoices(article, labels) {
  const servies = article?.sizes || [];
  const parLabel = new Map();
  for (const s of servies) { const k = normLabel(s.taille); if (k && !parLabel.has(k)) parLabel.set(k, s); }
  const deLaGrille = new Set(labels.map(normLabel));
  // Une ligne SANS INTITULÉ (« + ligne », pas encore nommée) n'est pas une
  // taille hors série : la compter comme telle faisait basculer tout le rail
  // dans l'ordre de repli au moment même où l'on ajoutait une ligne vierge.
  const horsGrille = servies.some(s => normLabel(s.taille) && !deLaGrille.has(normLabel(s.taille)));

  // L'ORDRE DES PASTILLES EST CELUI DE LA FEUILLE. Deux cas :
  //   · tout ce qui est servi vient de la grille (le cas courant) → on suit la
  //     GRILLE, et une taille qu'on éteint garde sa place au lieu de sauter en
  //     fin de rangée ;
  //   · une taille servie n'est pas au catalogue (grille partielle, taille
  //     ajoutée à la main) → la grille ne sait plus ranger, on suit l'ordre de
  //     l'article, qui EST l'ordre imprimé, et on met à la suite ce qui reste à
  //     proposer.
  const ordre = horsGrille
    ? [...servies.map(s => s.taille), ...labels.filter(l => !parLabel.has(normLabel(l)))]
    : labels;

  const vus = new Set();
  const out = [];
  for (const label of ordre) {
    const k = normLabel(label);
    if (!k || vus.has(k)) continue;
    vus.add(k);
    const s = parLabel.get(k);
    out.push({
      label: s?.taille ?? label,
      servie: !!s, verrouillee: aQuantite(s), quantite: s?.quantite ?? '',
      horsGrille: !deLaGrille.has(k),
    });
  }
  return out;
}

// Reconstruit `article.sizes` sur l'ensemble voulu.
//
// LA GRILLE PLACE CE QU'ON AJOUTE, ELLE NE RE-TRIE PAS CE QUI EST LÀ. Servir
// puis retirer une taille ne doit pas remettre la feuille dans un autre ordre :
// mesuré sur un produit à grille partielle, un simple ménage renvoyait
// « L, S, M, XL » là où le BAT disait « S, M, L, XL ». L'ordre imprimé est un
// fait du document — seule une resynchronisation explicite sur le produit
// (`applySizeLabels`, bouton « tailles du produit ») a le droit de le refaire.
//
// Une taille déjà là garde donc sa ligne ET son rang — donc son id, sa quantité
// et ses cotes.
function poserSeries(article, voulues, labels) {
  const old = article.sizes || [];
  const next = old.filter(s => voulues.has(normLabel(s.taille)));

  // Ce qui reste à poser s'insère au rang que lui donne la grille : juste avant
  // la première taille déjà là qui la suit dans la série. Une taille hors grille
  // compte comme « après » tout le monde — les extras restent à la fin.
  const rang = (t) => {
    const i = labels.findIndex(l => normLabel(l) === normLabel(t));
    return i < 0 ? Infinity : i;
  };
  const dejaLa = new Set(next.map(s => normLabel(s.taille)));
  for (const label of labels) {
    const k = normLabel(label);
    if (!voulues.has(k) || dejaLa.has(k)) continue;
    let i = next.findIndex(s => rang(s.taille) > rang(label));
    if (i < 0) i = next.length;
    next.splice(i, 0, { id: uid(), taille: label, quantite: '' });
    dejaLa.add(k);
  }

  article.sizes = next;
  purgeDims(article, next);
  return next;
}

// LA QUANTITÉ EST L'INTERRUPTEUR. Écrire un nombre pose la taille sur le bon à
// tirer ; effacer le champ l'en retire. Il n'y a donc pas deux gestes à tenir
// cohérents (cocher une taille, puis la remplir) — il y en a UN, et l'état du
// document se lit dans ce qu'on a écrit.
//
// C'est aussi ce qui rend le geste sûr sans confirmation : on ne peut pas
// retirer une taille sans avoir d'abord effacé sa quantité, c'est-à-dire sans
// avoir vu ce qu'on jetait.
export function setSizeQuantity(article, label, valeur, labels) {
  const k = normLabel(label);
  const v = String(valeur ?? '').trim();
  const voulues = new Set((article.sizes || []).map(s => normLabel(s.taille)));
  if (v) voulues.add(k); else voulues.delete(k);
  const next = poserSeries(article, voulues, labels);
  const ligne = next.find(s => normLabel(s.taille) === k);
  if (ligne) ligne.quantite = v;
  return next;
}

// Somme des quantités saisies. `null` tant qu'aucune n'est lisible : « 0 » et
// « rien de saisi » ne disent pas la même chose sur un bon à tirer.
export function totalQuantity(article) {
  let somme = 0, vu = false;
  for (const s of article?.sizes || []) {
    const n = parseFloat(String(s.quantite ?? '').replace(',', '.'));
    if (Number.isFinite(n)) { somme += n; vu = true; }
  }
  return vu ? somme : null;
}

// Les tailles posées mais sans quantité : exactement ce qu'un BAT n'a pas à
// imprimer. Sert à ne proposer le ménage que s'il a un effet.
export const unorderedSizes = (article) =>
  (article?.sizes || []).filter(s => !aQuantite(s)).map(s => s.taille || '—');

// CE QUE LE DOCUMENT MONTRE : les tailles commandées, jamais les vides. Le
// tri (« seulement les commandées ») n'a donc plus à être demandé — il est
// automatique, à la lecture. Repli sur la série complète tant qu'AUCUNE
// quantité n'est saisie : un BAT tout juste ouvert doit encore montrer une
// grille à remplir, pas une feuille vide qui semble cassée.
export function servedSizes(article) {
  const rows = article?.sizes || [];
  const servies = rows.filter(aQuantite);
  return servies.length ? servies : rows;
}

// Le ménage d'un clic. SANS PERTE POSSIBLE : il ne retire que des lignes vides.
export function keepOrderedSizes(article, labels) {
  const voulues = new Set((article.sizes || []).filter(aQuantite).map(s => normLabel(s.taille)));
  return poserSeries(article, voulues, labels);
}

// La grille de l'article est-elle déjà à jour ? Vrai quand ses lignes sont
// celles du produit, dans l'ordre, suivies des seules tailles hors grille
// encore commandées — autrement dit quand applySizeLabels ne changerait rien.
// Sert à ne proposer la resynchronisation que si elle a un effet.
export function sizesAreSynced(article, labels) {
  const cur = article?.sizes || [];
  if (cur.length < labels.length) return false;
  for (let i = 0; i < labels.length; i++) {
    if (normLabel(cur[i]?.taille) !== normLabel(labels[i])) return false;
  }
  const wanted = new Set(labels.map(normLabel));
  return cur.slice(labels.length).every(s =>
    !wanted.has(normLabel(s.taille)) && String(s.quantite ?? '').trim() !== '');
}
