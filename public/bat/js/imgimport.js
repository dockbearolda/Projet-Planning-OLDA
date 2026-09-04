// Pipeline d'import d'une image de mockup, partagé écran manuel / import API.
// PNG/JPG/WebP conservés ; SVG/PDF/HEIC/TIFF rendus en PNG 2000 px. Stockage sous
// data/mockups-custom/ ; renvoie le chemin relatif « custom/… » à mettre dans
// color.views[view]. Dérive aussi la teinte moyenne du vêtement (pastille).
import { garmentMeanColor, invalidateBitmap, invalidateThumb } from './mockup.js';
import { sniffLogoType } from './logoasset.js';
import { EXOTIC_TYPES, decodeExotic } from './imgconvert.js';
import { pdfjs } from './pdfjs.js';

// bytes: ArrayBuffer | Uint8Array ; ext: indice de format (nom du fichier
// déposé, type MIME du presse-papiers, en-tête HTTP d'une URL)
// → { bytes: Uint8Array, ext: 'png'|'jpg'|'webp' }
export async function normalizeImageBytes(bytes, ext) {
  let u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // L'extension n'est qu'un INDICE : un mockup arrive par glisser-déposer,
  // par collage ou par URL, trois chemins où elle est absente ou fausse. Le
  // format réel se lit dans les octets — et une photo d'iPhone (HEIC) ou un
  // fichier de scanner (TIFF) doit être converti avant que <img> ne le voie.
  const kind = sniffLogoType(u8) || (ext === 'jpeg' ? 'jpg' : ext);
  let outExt = kind;
  if (EXOTIC_TYPES.has(kind)) {
    const cv = await decodeExotic(u8, kind);
    u8 = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/png'))).arrayBuffer());
    outExt = 'png';
  } else if (kind === 'pdf') {
    const task = (await pdfjs()).getDocument({ data: u8.slice(0) });
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 2000 / Math.max(vp1.width, vp1.height) });
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    // intent « print » : ne dépend pas de requestAnimationFrame, donc n'est pas
    // suspendu si l'onglet passe en arrière-plan pendant l'import (cf. logoasset).
    await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
    // pdf.js ≥ 4 : destroy vit sur la tâche, plus sur le document.
    await task.destroy();
    u8 = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/png'))).arrayBuffer());
    outExt = 'png';
  } else if (kind === 'svg') {
    const url = URL.createObjectURL(new Blob([u8], { type: 'image/svg+xml' }));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('SVG illisible')); img.src = url; });
    const scale = 2000 / Math.max(img.width || 1000, img.height || 1000);
    const cv = document.createElement('canvas');
    cv.width = Math.ceil((img.width || 1000) * scale); cv.height = Math.ceil((img.height || 1000) * scale);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(url);
    u8 = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/png'))).arrayBuffer());
    outExt = 'png';
  }
  return { bytes: u8, ext: outExt };
}

// Déclinaisons de taille, alignées sur la convention du catalogue OLDA exporté
// (…​.webp / ….medium.webp / ….thumb.webp). Un packshot TopTex brut fait
// 1666×2500 en PNG, soit 1,6 Mo — et il était jusqu'ici enregistré tel quel,
// `thumb` et `medium` pointant sur ce même fichier. Résultat : 215 Mo par
// produit, et la moindre vignette de l'interface tirait 1,6 Mo. Les trois
// déclinaisons réunies pèsent ~40 Ko.
//
// WebP LOSSY, comme le catalogue OLDA : les aplats de blanc du fond restent à
// 255 exactement (aucun ringing en zone plate), ce dont dépend le masque du
// vêtement (mockup.js → buildGarmentMask) pour distinguer le textile du fond.
const VARIANTS = [
  { key: 'full', max: 1500, q: 0.9, suffix: '' },
  { key: 'medium', max: 1200, q: 0.88, suffix: '.medium' },
  { key: 'thumb', max: 400, q: 0.82, suffix: '.thumb' },
];

// Redimensionne vers `max` (plus grande dimension), sans jamais agrandir.
async function encodeVariant(img, max, q) {
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(img.width * s));
  cv.height = Math.max(1, Math.round(img.height * s));
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // Fond blanc sous l'image : un packshot à canal alpha donnerait sinon un fond
  // noir en WebP, et le masque du vêtement ne trouverait plus son blanc pur.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/webp', q));
  return new Uint8Array(await blob.arrayBuffer());
}

// Stocke l'image en 3 tailles et renvoie l'objet views[view] = { full, medium, thumb }.
export async function saveMockup(productId, slug, view, bytes, ext) {
  const norm = await normalizeImageBytes(bytes, ext);
  const url = URL.createObjectURL(new Blob([norm.bytes], { type: 'image/' + (norm.ext === 'jpg' ? 'jpeg' : norm.ext) }));
  const out = {};
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Image illisible')); img.src = url; });
    for (const v of VARIANTS) {
      const rel = `${productId}/${slug}_${view}${v.suffix}.webp`;
      const u8 = await encodeVariant(img, v.max, v.q);
      await window.batApi.dataWrite('mockups-custom/' + rel, u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
      const p = 'custom/' + rel;
      // Le fichier est réécrit au même chemin : purge les caches indexés dessus
      // (aperçu BAT + vignette du sélecteur) pour refléter la nouvelle image.
      invalidateBitmap(p);
      invalidateThumb(p);
      out[v.key] = p;
    }
  } finally { URL.revokeObjectURL(url); }
  return out;
}

// Teinte moyenne du tissu d'une image (pour la pastille) → '#rrggbb' ou null.
export async function deriveSwatchHex(bytes, ext) {
  const norm = await normalizeImageBytes(bytes, ext);
  const url = URL.createObjectURL(new Blob([norm.bytes], { type: 'image/' + (norm.ext === 'jpg' ? 'jpeg' : norm.ext) }));
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const s = Math.min(1, 256 / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.width * s));
    cv.height = Math.max(1, Math.round(img.height * s));
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const c = garmentMeanColor(ctx, cv.width, cv.height);
    if (!c) return null;
    const h = (n) => Math.round(n).toString(16).padStart(2, '0');
    return '#' + h(c.r) + h(c.g) + h(c.b);
  } finally { URL.revokeObjectURL(url); }
}
