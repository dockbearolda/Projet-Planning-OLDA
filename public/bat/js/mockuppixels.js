// ===========================================================================
// LE TRAVAIL PIXEL — SANS DOM, DONC EXÉCUTABLE DANS UN OUVRIER
// ---------------------------------------------------------------------------
// Composer une face coûte 141 ms pour une image de 1200 × 1200, et les deux
// tiers partent dans les boucles ci-dessous : le masque du vêtement (un
// remplissage par diffusion sur toute l'image) et le fondu des bords. Tant que
// ce code vivait dans `mockup.js`, à côté du `store` et du `document`, il ne
// pouvait tourner QUE sur le fil principal — donc changer de couleur figeait
// l'interface, et sur une tablette (~4× plus lente) c'était près d'une seconde.
//
// Ce fichier n'importe ni le store, ni le DOM, ni quoi que ce soit qui suppose
// une fenêtre. Il est donc chargeable des deux côtés : par `mockup.js` sur le
// fil principal (chemin de repli), et par `mockupouvrier.js` dans un Worker.
// UNE SEULE implémentation, deux hôtes — c'est ce qui garantit que le repli
// donne exactement la même image, au pixel près.
//
// Le seul point d'adaptation est la fabrique de canvas ci-dessous.

import { HEX } from './batlayout.js';
import { hexToRgb, clamp } from './util.js';

// Dans un ouvrier il n'y a pas de `document` : c'est `OffscreenCanvas` qui rend
// le service. Le test porte sur `document` et non sur `OffscreenCanvas` — le
// fil principal en dispose aussi, mais un canvas hors écran n'y sert à rien et
// se comporte différemment vis-à-vis de `toBlob`.
export function creerCanvas(w, h) {
  if (typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Fondu des bords du mockup vers la couleur de feuille (HEX.SHEET). Le fond
// blanc des photos produit (incrusté dans les pixels, images sans alpha)
// créait une démarcation nette avec le fond de la feuille. On mélange la
// couleur de feuille sur les 4 côtés, mais SEULEMENT sur les pixels de fond
// réellement blancs — jamais sur le produit, même quand celui-ci touche le
// cadre (ex. anses de tote bag qui montent jusqu'en haut de la photo) : sans
// ce filtre, un dégradé spatial aveugle au contenu peint par-dessus le produit
// et le fait paraître flouté/rongé sur les bords.
// La peinture est OPAQUE (pas de transparence) : elle survit à l'encodage JPEG
// du mockup dans le PDF, et comme la teinte == le fond de feuille (à l'écran
// ET dans le PDF, via HEX.SHEET), le bord se fond exactement dans la feuille.
// `faceVisual` étant partagé éditeur/PDF, le rendu reste identique des deux côtés.
// Depuis que SHEET est blanc pur, ce fondu est neutre sur un fond de photo déjà
// blanc : il ne sert plus qu'à rattraper les bords légèrement vignettés/grisés
// de certains packshots. On le garde à ce titre — et il redeviendrait
// indispensable si la feuille reprenait la moindre teinte.
const FEATHER_FRAC = 0.10; // ~10 % de chaque côté au maximum.
export function featherEdges(ctx, w, h) {
  const { r: sr, g: sg, b: sb } = hexToRgb(HEX.SHEET);
  const fx = Math.max(4, Math.round(w * FEATHER_FRAC));
  const fy = Math.max(4, Math.round(h * FEATHER_FRAC));
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  const edgeAlpha = (x, y) => {
    let a = 0;
    if (y < fy) a = Math.max(a, 1 - y / fy);
    if (y >= h - fy) a = Math.max(a, 1 - (h - 1 - y) / fy);
    if (x < fx) a = Math.max(a, 1 - x / fx);
    if (x >= w - fx) a = Math.max(a, 1 - (w - 1 - x) / fx);
    return a;
  };

  const applyPixel = (x, y) => {
    const ea = edgeAlpha(x, y);
    if (ea <= 0) return;
    const i = (y * w + x) * 4;
    const R = d[i], G = d[i + 1], B = d[i + 2];
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    // Poids « fond blanc » : ~1 sur un fond quasi blanc et peu saturé, chute
    // à 0 dès que le pixel s'écarte du blanc (tissu, ombre, couleur produit).
    const bg = clamp((max - 235) / 18, 0, 1) * clamp(1 - (max - min) / 30, 0, 1);
    const a = ea * bg;
    if (a <= 0) return;
    d[i]     = R + (sr - R) * a;
    d[i + 1] = G + (sg - G) * a;
    d[i + 2] = B + (sb - B) * a;
  };

  for (let y = 0; y < fy; y++)      for (let x = 0; x < w; x++) applyPixel(x, y);
  for (let y = h - fy; y < h; y++)  for (let x = 0; x < w; x++) applyPixel(x, y);
  for (let y = fy; y < h - fy; y++) {
    for (let x = 0; x < fx; x++) applyPixel(x, y);
    for (let x = w - fx; x < w; x++) applyPixel(x, y);
  }

  ctx.putImageData(img, 0, 0);
}

// ── Harmonisation couleur des manches ──────────────────────────────────────
// Une manche sans photo propre est « empruntée » à une couleur voisine (cf.
// resolveSleeve) : c'est une vraie photo d'un vêtement d'une AUTRE teinte, d'où
// le décalage visible avec l'avant/arrière. On recolore le tissu de la manche
// vers la couleur de RÉFÉRENCE échantillonnée sur les photos avant/arrière.
// La transformation est *relative* (rotation de teinte + mise à l'échelle de la
// saturation, luminosité conservée) : les plis et ombres de la photo restent
// intacts, et le fond blanc — achromatique — n'a pas de teinte à faire tourner,
// donc il n'est pas coloré.

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s, l };
}

export function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

// Couleur moyenne du vêtement : ignore le fond (quasi-blanc / transparent) et
// les gris peu saturés (ombres), pour ne retenir que les pixels de tissu.
export function garmentMeanColor(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h);
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40000))); // ≤ ~40k échantillons
  let R = 0, G = 0, B = 0, n = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 200) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max > 240 && (max - min) < 18) continue; // fond blanc
      if ((max - min) < 12) continue;              // gris / ombre neutre
      R += r; G += g; B += b; n++;
    }
  }
  return n ? { r: R / n, g: G / n, b: B / n } : null;
}

// Recolore le tissu de `from` vers `to` (couleurs moyennes RGB). Chaque pixel
// est déplacé relativement : sa teinte tourne de (Hto − Hfrom), sa saturation
// est mise à l'échelle, sa luminosité recentrée — puis fondu avec l'original au
// prorata de sa saturation (poids ≈ 0 sur le fond → fond préservé).
export function recolorGarment(ctx, w, h, from, to) {
  const A = rgbToHsl(from.r, from.g, from.b);
  const B = rgbToHsl(to.r, to.g, to.b);
  const dH = B.h - A.h;
  const sScale = A.s > 0.02 ? clamp(B.s / A.s, 0.4, 2.5) : 1;
  const dL = B.l - A.l;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const hsl = rgbToHsl(r, g, b);
    const wgt = clamp((hsl.s - 0.06) / 0.14, 0, 1); // 0 sur le fond, 1 sur le tissu franc
    if (wgt <= 0) continue;
    let nh = (hsl.h + dH) % 360; if (nh < 0) nh += 360;
    const out = hslToRgb(nh, clamp(hsl.s * sScale, 0, 1), clamp(hsl.l + dL, 0, 1));
    d[i]     = r + (out.r - r) * wgt;
    d[i + 1] = g + (out.g - g) * wgt;
    d[i + 2] = b + (out.b - b) * wgt;
  }
  ctx.putImageData(img, 0, 0);
}

// ── Masque du vêtement ─────────────────────────────────────────────────────
// 1 = pixel de tissu, 0 = fond de la feuille. Sert à ne déclencher l'ajout d'un
// logo QUE sur le vêtement : un clic à côté du t-shirt ne doit pas ouvrir le
// sélecteur de fichier (batpage.js → FaceView.hitGarment).
//
// Pourquoi cet algorithme, et pas plus simple :
//  - la transparence est inutilisable — les mockups sont des photos opaques
//    sans canal alpha (WebP VP8 lossy), et faceVisual pose de toute façon un
//    fond blanc avant de dessiner ;
//  - un seuil de luminosité l'est tout autant — le tissu le plus clair du
//    catalogue (H-013_K357 blanc) est à 254, à UN niveau du fond : tout seuil
//    qui isole le fond mange aussi ce t-shirt.
// En revanche le fond est un blanc de SYNTHÈSE, exactement 255/255/255 sur
// toute sa surface, et aucun tissu du catalogue n'atteint 255. On part donc des
// bords de l'image (le fond touche toujours le bord) et on propage de proche en
// proche sur les SEULS pixels blancs purs : tout ce qui n'est pas atteint est du
// vêtement. Le contour du vêtement (≤ 254) arrête la propagation — un t-shirt
// blanc reste donc détecté. Le léger halo de compression autour du vêtement est
// compté comme tissu : la cible de clic est un peu plus généreuse, ce qui est
// souhaitable.
//
// À APPELER AVANT featherEdges() : le fondu teinte les bords vers HEX.SHEET.
// L'ordre est sans conséquence tant que SHEET est blanc pur (le fondu est
// alors neutre sur un fond déjà blanc), mais il redevient vital à la moindre
// teinte : les points d'amorce à 255 sauteraient et le masque serait vide.
const MASK_STEP = 4;   // un point tous les 4 px : ~3 px de précision, 16× moins de mémoire
export function buildGarmentMask(ctx, w, h) {
  const mw = Math.ceil(w / MASK_STEP), mh = Math.ceil(h / MASK_STEP);
  const d = ctx.getImageData(0, 0, w, h).data;
  const pure = new Uint8Array(mw * mh);   // 1 = blanc pur, donc fond potentiel
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const o = (Math.min(y * MASK_STEP, h - 1) * w + Math.min(x * MASK_STEP, w - 1)) * 4;
      pure[y * mw + x] = (d[o] === 255 && d[o + 1] === 255 && d[o + 2] === 255) ? 1 : 0;
    }
  }
  // Propagation depuis tout le pourtour (pile explicite : une récursion
  // déborderait sur des zones de fond de plusieurs dizaines de milliers de points).
  const bg = new Uint8Array(mw * mh);
  const stack = [];
  for (let x = 0; x < mw; x++) stack.push(x, 0, x, mh - 1);
  for (let y = 0; y < mh; y++) stack.push(0, y, mw - 1, y);
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= mw || y >= mh) continue;
    const i = y * mw + x;
    if (bg[i] || !pure[i]) continue;
    bg[i] = 1;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  let garment = 0;
  for (let i = 0; i < bg.length; i++) if (!bg[i]) garment++;
  const ratio = garment / bg.length;
  // Garde-fou : sur un mockup au fond inattendu (photo d'ambiance, fond non
  // blanc, vêtement débordant du cadre), le masque n'a plus de sens. Plutôt que
  // de rendre le visuel inerte — l'utilisateur ne pourrait PLUS poser de logo —
  // on renvoie null et l'appelant retombe sur « tout le visuel est cliquable ».
  if (ratio < 0.05 || ratio > 0.92) return null;
  const data = new Uint8Array(mw * mh);
  for (let i = 0; i < data.length; i++) data[i] = bg[i] ? 0 : 1;
  return { data, w: mw, h: mh, step: MASK_STEP };
}


// ── La composition, d'un bout à l'autre ────────────────────────────────────
// Le SEUL endroit où l'ordre des opérations est écrit. Il compte :
//   1. fond blanc, puis l'image (recadrée, éventuellement miroitée) ;
//   2. la recoloration, s'il faut harmoniser une manche empruntée ;
//   3. le MASQUE, avant le fondu — `featherEdges` teinte les bords vers
//      HEX.SHEET et détruirait les points d'amorce en blanc pur ;
//   4. le fondu.
// Un ouvrier et le fil principal appellent cette même fonction : c'est ce qui
// garantit que le repli rend exactement la même image.
//
// @param {ImageBitmap} bmp
// @param {{crop:number, mirror:boolean, maxDim:number, mask:boolean,
//          feather:boolean, whiteBg:boolean, recolorVers:?{r,g,b}}} spec
export function composerFace(bmp, spec) {
  const fullW = bmp.width, fullH = bmp.height;
  const cropW = Math.round(fullW * spec.crop);
  const sx = Math.round((fullW - cropW) / 2);
  const scale = spec.maxDim ? Math.min(1, spec.maxDim / Math.max(cropW, fullH)) : 1;

  const canvas = creerCanvas(Math.round(cropW * scale), Math.round(fullH * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  if (spec.whiteBg !== false) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.save();
  if (spec.mirror) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(bmp, sx, 0, cropW, fullH, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  if (spec.recolorVers) {
    const from = garmentMeanColor(ctx, canvas.width, canvas.height);
    if (from) recolorGarment(ctx, canvas.width, canvas.height, from, spec.recolorVers);
  }

  const mask = spec.mask ? buildGarmentMask(ctx, canvas.width, canvas.height) : null;
  if (spec.feather !== false) featherEdges(ctx, canvas.width, canvas.height);

  return { canvas, width: canvas.width, height: canvas.height, mask, scale };
}
