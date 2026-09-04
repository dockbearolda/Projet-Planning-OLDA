// Chargement et préparation des visuels de faces (mockup découpé/miroité,
// échelle cm exacte). Utilisé par l'éditeur ET par la génération PDF,
// pour garantir un rendu identique.

import { store, FACES, resolveSleeve, defaultCalibration } from './store.js';
import { hexToRgb } from './util.js';
// Le travail pixel vit à part : sans DOM, il est exécutable dans un ouvrier.
// `garmentMeanColor` est ré-exporté parce que `imgimport.js` le prend ici — sa
// provenance est un détail d'organisation, pas une interface.
import { creerCanvas, composerFace, garmentMeanColor } from './mockuppixels.js';
export { garmentMeanColor };

const bitmapCache = new Map(); // rel → ImageBitmap plein format


export function mimeOf(name) {
  const ext = String(name).toLowerCase().split('.').pop();
  return {
    webp: 'image/webp', avif: 'image/avif', png: 'image/png',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml',
  }[ext] || 'application/octet-stream';
}

// URL d'affichage d'une image du catalogue, utilisable directement dans une
// balise <img> (vignettes de la liste des projets). Passe par
// store.readCatalogueFile : le catalogue est servi en HTTP côté web mais lu sur
// le disque en desktop — une URL « /catalogue/… » en dur ne marcherait qu'en web.
// Les URL blob sont mémorisées par chemin : sans ce cache, chaque rendu de la
// liste recréerait un objet jamais révoqué (fuite mémoire). Cache borné et
// purgé en FIFO — une vignette est minuscule, mais le catalogue compte des
// milliers d'images.
const thumbUrlCache = new Map();   // rel → objectURL
// Relevé au plus large des usages : la grille de couleurs d'un produit peut en
// afficher 52 d'un coup. Un plafond plus bas ferait évincer, pendant qu'il est
// ouvert, les vignettes du menu lui-même.
const THUMB_URL_MAX = 300;
export async function catalogueImageUrl(rel) {
  if (!rel) return null;
  if (thumbUrlCache.has(rel)) return thumbUrlCache.get(rel);
  const buf = await store.readCatalogueFile(rel);
  if (!buf) return null;
  const url = URL.createObjectURL(new Blob([new Uint8Array(buf)], { type: mimeOf(rel) }));
  thumbUrlCache.set(rel, url);
  if (thumbUrlCache.size > THUMB_URL_MAX) {
    const oldest = thumbUrlCache.keys().next().value;
    URL.revokeObjectURL(thumbUrlCache.get(oldest));
    thumbUrlCache.delete(oldest);
  }
  return url;
}

export async function loadCatalogueBitmap(rel) {
  if (bitmapCache.has(rel)) {
    // ré-insertion → devient l'entrée « la plus récemment utilisée » (LRU)
    const bmp = bitmapCache.get(rel);
    bitmapCache.delete(rel);
    bitmapCache.set(rel, bmp);
    return bmp;
  }
  const buf = await store.readCatalogueFile(rel);
  if (!buf) throw new Error('Image introuvable : ' + rel);
  const blob = new Blob([new Uint8Array(buf)], { type: mimeOf(rel) });
  const bmp = await createImageBitmap(blob);
  // Éviction LRU : retire la plus ancienne entrée et libère sa mémoire GPU
  // (au lieu de vider tout le cache d'un coup et de re-décoder en boucle).
  while (bitmapCache.size >= 40) {
    const oldestKey = bitmapCache.keys().next().value;
    const old = bitmapCache.get(oldestKey);
    bitmapCache.delete(oldestKey);
    old?.close?.();
  }
  bitmapCache.set(rel, bmp);
  return bmp;
}

// Purge l'entrée cache d'un mockup (après remplacement de son fichier à chemin
// identique) : sans cela l'ancien bitmap resterait servi aux BAT jusqu'à
// éviction LRU ou rechargement de la page.
export function invalidateBitmap(rel) {
  const bmp = bitmapCache.get(rel);
  if (bmp) { bitmapCache.delete(rel); bmp.close?.(); }
  // Le bitmap source ET tout ce qui en a été composé : purger l'un sans l'autre
  // laisserait l'éditeur afficher l'ancienne image à partir d'un visuel en
  // cache, alors même que le fichier a bien été rechargé.
  invalidateVisuals(rel);
}

// Purge la vignette en cache d'un mockup remplacé (chemin identique) : sinon la
// liste des projets et la grille de couleurs afficheraient l'ancienne image
// jusqu'au rechargement.
export function invalidateThumb(rel) {
  const url = thumbUrlCache.get(rel);
  if (url) { URL.revokeObjectURL(url); thumbUrlCache.delete(rel); }
}

export function calibrationFor(product, view) {
  return product.calibration?.[view] || defaultCalibration(product.type, view);
}


// Couleur de référence d'une couleur produit = moyenne du tissu de sa photo
// avant (repli : arrière, puis pastille `hex`). Mise en cache par produit+slug.
const refColorCache = new Map();
export async function referenceGarmentColor(product, colorSlug, variant = 'full') {
  const key = product.id + '|' + colorSlug;
  if (refColorCache.has(key)) return refColorCache.get(key);
  const color = product.colors.find(c => c.slug === colorSlug);
  const pick = (v) => (variant === 'medium' ? v?.medium : null) || v?.full;
  const rel = color && (pick(color.views.front) || pick(color.views.back));
  let out = null;
  if (rel) {
    try {
      const bmp = await loadCatalogueBitmap(rel);
      const s = Math.min(1, 256 / Math.max(bmp.width, bmp.height)); // couleur moyenne : 256px suffisent
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * s));
      c.height = Math.max(1, Math.round(bmp.height * s));
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(bmp, 0, 0, c.width, c.height);
      out = garmentMeanColor(cx, c.width, c.height);
    } catch { out = null; }
  }
  if (!out && color?.hex) out = hexToRgb(color.hex); // repli sur la pastille
  refColorCache.set(key, out);
  return out;
}


// Le point (x, y) — en pixels du bitmap visuel — tombe-t-il sur le vêtement ?
// Sans masque exploitable, on considère tout le visuel comme vêtement.
export function isOnGarment(vis, x, y) {
  const m = vis?.mask;
  if (!m) return true;
  const mx = Math.floor(x / m.step), my = Math.floor(y / m.step);
  if (mx < 0 || my < 0 || mx >= m.w || my >= m.h) return false;
  return m.data[my * m.w + mx] === 1;
}

// Prépare le visuel d'une face : bitmap recadré/miroité + échelle px/cm.
// Retourne { canvas, width, height, pxPerCm, kind, mask } ou null si indisponible.
// `opts.mask` : calcule le masque du vêtement (éditeur uniquement ; l'export PDF
// n'en a pas l'usage et évite ainsi le coût).
// ── Cache des visuels composés ─────────────────────────────────────────────
// `faceVisual` est PUR : mêmes arguments, même canvas. Et il est cher — 141 ms
// pour une face en 1200×1200, dont les deux tiers en boucles pixel (masque du
// vêtement, fondu des bords). Or l'appelant vidait son cache à chaque
// changement de couleur : comparer deux coloris recalculait les DEUX, à chaque
// aller-retour.
//
// La clé est ce qui DÉTERMINE l'image — le produit, la couleur, la face, la
// variante et les options de composition — et surtout PAS l'article qui la
// demande : deux articles du même t-shirt noir partagent désormais le calcul.
//
// PLAFOND EN PIXELS, pas en entrées. Un visuel de 1600×1600 occupe 10 Mo de
// mémoire de canvas ; compter les entrées ferait tenir 10 Mo ou 200 Mo sous le
// même chiffre. 20 Mpx ≈ deux articles complets, ce qui couvre l'aller-retour
// entre deux coloris — le seul cas qui se répète.
const visualCache = new Map();   // clé → { vis, px, rel }
const VISUAL_CACHE_MAX_PX = 20e6;
let visualCachePx = 0;

function visualCacheDrop(k) {
  const e = visualCache.get(k);
  if (!e) return;
  visualCachePx -= e.px;
  visualCache.delete(k);
}

// Purge tout visuel composé À PARTIR de ce fichier. Appelée quand un mockup est
// remplacé au même chemin : sans elle, l'éditeur continuerait d'afficher
// l'ancienne image alors que le bitmap source, lui, a bien été rechargé.
function invalidateVisuals(rel) {
  for (const [k, e] of visualCache) if (e.rel === rel) visualCacheDrop(k);
}

// ── L'ouvrier ──────────────────────────────────────────────────────────────
// Un seul, créé au premier besoin. Composer une face est un travail de pixel
// pur : le paralléliser sur plusieurs ouvriers ferait surtout se disputer la
// mémoire, alors que le gain recherché est ailleurs — libérer LE FIL PRINCIPAL,
// pas aller plus vite dans l'absolu.
let ouvrier = null;
let ouvrierHS = false;      // une fois indisponible, on ne réessaie pas à chaque face
let prochainId = 1;
const enAttente = new Map();

function obtenirOuvrier() {
  if (ouvrierHS) return null;
  if (ouvrier) return ouvrier;
  try {
    // `type: 'module'` : l'ouvrier importe `mockuppixels.js`, donc la MÊME
    // implémentation que le repli. Un ouvrier classique obligerait à en tenir
    // une seconde copie, et deux copies finissent toujours par diverger.
    ouvrier = new Worker(new URL('./mockupouvrier.js', import.meta.url), { type: 'module' });
    ouvrier.onmessage = (e) => {
      const attente = enAttente.get(e.data.id);
      if (!attente) return;
      enAttente.delete(e.data.id);
      attente(e.data.ok ? e.data : null);
    };
    // Un ouvrier mort ne se répare pas : on rend la main au fil principal, et
    // toutes les attentes en cours retombent sur lui plutôt que de rester
    // suspendues — une face qui ne revient jamais, c'est un écran vide.
    ouvrier.onerror = () => {
      ouvrierHS = true;
      ouvrier = null;
      for (const [id, attente] of enAttente) { enAttente.delete(id); attente(null); }
    };
  } catch {
    ouvrierHS = true;       // navigateur sans ouvrier de type module
    return null;
  }
  return ouvrier;
}

// Rend `null` — jamais une exception — quand l'ouvrier n'est pas disponible ou
// qu'il a échoué : l'appelant retombe alors sur `composerFace` en local.
async function composerDansOuvrier(rel, spec) {
  const w = obtenirOuvrier();
  if (!w) return null;
  const buf = await store.readCatalogueFile(rel);
  if (!buf) return null;
  const id = prochainId++;
  const reponse = await new Promise((ok) => {
    enAttente.set(id, ok);
    // Les octets sont TRANSFÉRÉS : ils sortent de ce fil sans copie. Ils
    // proviennent d'une lecture fraîche, personne d'autre ne les tient.
    const octets = buf instanceof ArrayBuffer ? buf : new Uint8Array(buf).buffer;
    try { w.postMessage({ id, bytes: octets, spec }, [octets]); }
    catch { enAttente.delete(id); ok(null); }
  });
  return reponse && reponse.ok ? reponse : null;
}

export async function faceVisual(product, colorSlug, faceKey, opts = {}) {
  // L'export PDF (batpdf.js) passe `cache: false` : ses visuels sont en pleine
  // résolution, servent une seule fois, et évinceraient tout l'éditeur.
  if (opts.cache === false) return composeFaceVisual(product, colorSlug, faceKey, opts);
  const k = [
    product.id, colorSlug, faceKey,
    opts.variant === 'medium' ? 'medium' : 'full',
    opts.maxDim || 0,
    opts.mask ? 1 : 0, opts.feather === false ? 0 : 1, opts.whiteBg === false ? 0 : 1,
  ].join('|');
  const hit = visualCache.get(k);
  if (hit) {
    // ré-insertion → devient l'entrée la plus récemment utilisée (LRU)
    visualCache.delete(k);
    visualCache.set(k, hit);
    return hit.vis;
  }
  const vis = await composeFaceVisual(product, colorSlug, faceKey, opts);
  if (!vis) return vis;
  const px = vis.width * vis.height;
  // Un visuel plus gros que le plafond ne se met pas en cache : il l'aurait
  // vidé entièrement pour ne servir qu'une fois.
  if (px <= VISUAL_CACHE_MAX_PX) {
    visualCache.set(k, { vis, px, rel: vis.rel || null });
    visualCachePx += px;
    while (visualCachePx > VISUAL_CACHE_MAX_PX && visualCache.size > 1) {
      visualCacheDrop(visualCache.keys().next().value);
    }
  }
  return vis;
}

async function composeFaceVisual(product, colorSlug, faceKey, opts = {}) {
  const face = FACES[faceKey];
  const color = product.colors.find(c => c.slug === colorSlug);
  if (!face || !color) return null;

  // variant : 'medium' (aperçu éditeur, ~4× plus léger) ou 'full' (export PDF).
  const variant = opts.variant === 'medium' ? 'medium' : 'full';
  let rel = null, kind = 'own';
  if (face.view === 'sleeve') {
    const r = resolveSleeve(product, colorSlug);
    if (!r) return null;
    rel = r.rel; kind = r.kind;
  } else {
    const v = color.views[face.view];
    rel = (variant === 'medium' ? v?.medium : null) || v?.full;
    if (!rel) return null;
  }

  // Une manche empruntée à une couleur voisine se recolore vers la teinte de
  // référence du vêtement. Cette teinte se lit sur une image réduite à 256 px,
  // coûte une milliseconde et se mémorise : elle reste ICI, et seule la
  // COULEUR part à l'ouvrier — jamais une seconde image.
  const recolorVers = (face.view === 'sleeve' && kind === 'borrowed')
    ? await referenceGarmentColor(product, colorSlug, variant)
    : null;

  const spec = {
    crop: face.crop, mirror: face.mirror, maxDim: opts.maxDim || 0,
    mask: !!opts.mask, feather: opts.feather !== false, whiteBg: opts.whiteBg !== false,
    recolorVers,
    // L'export PDF demande directement le JPEG : composé et encodé du même
    // côté, il n'y a plus rien à repeindre sur le fil principal.
    jpegQ: opts.jpegQ || 0,
  };

  // L'échelle cm se déduit de la dimension D'ORIGINE, que l'ouvrier ne rend
  // pas : elle se lit sur le bitmap, déjà en cache ici la plupart du temps.
  const bmp = await loadCatalogueBitmap(rel);
  const cal = calibrationFor(product, face.view);
  const pxPerCm = (bmp.width * (cal.widthPct / 100)) / cal.widthCm;

  // L'OUVRIER D'ABORD, LE FIL PRINCIPAL EN REPLI. `composerDansOuvrier` rend
  // `null` — jamais une exception — quand les ouvriers ne sont pas disponibles
  // (navigateur sans ouvrier de type module) ou qu'un message a échoué. Les
  // deux chemins appellent la MÊME `composerFace` : l'image est identique au
  // pixel près, seul le fil qui la calcule change.
  const r = (await composerDansOuvrier(rel, spec)) || composerFace(bmp, spec);

  // `rel` voyage avec le visuel : c'est ce qui permet de le purger quand SON
  // fichier source est remplacé (cf. invalidateVisuals).
  //
  // `canvas` est un ACCESSEUR. L'ouvrier rend une `ImageBitmap`, que les deux
  // appelants savent dessiner tel quel (`drawImage`) ; seul l'export PDF
  // réclame un vrai canvas, pour `toBlob`. Il ne se peint donc qu'à ce
  // moment-là, une seule fois — et jamais pour l'éditeur.
  return {
    width: r.width, height: r.height, pxPerCm: pxPerCm * r.scale, kind, mask: r.mask, rel,
    bitmap: r.bitmap || null,
    jpeg: r.jpeg || null,
    get canvas() {
      if (r.canvas) return r.canvas;
      const c = creerCanvas(r.width, r.height);
      c.getContext('2d').drawImage(r.bitmap, 0, 0);
      r.canvas = c;
      return c;
    },
  };
}
