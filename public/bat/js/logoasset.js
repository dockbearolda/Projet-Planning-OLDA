// Logos posés sur un vêtement : un seul contrat, quel que soit le format choisi.
//
// Un logo arrive VECTORIEL (PDF) ou MATRICIEL (PNG, JPG, WebP, GIF, BMP, AVIF,
// HEIC, TIFF — et SVG, rasterisé à l'import faute de pouvoir embarquer des
// vecteurs SVG dans un PDF via pdf-lib ; les formats que le navigateur ne
// décode pas passent par imgconvert.js). Exception aux PDF : un PDF > 3 Mo
// contenant une image est une PHOTO en habit vectoriel — il est converti en
// image à l'import (cf. rasterizeHeavyPhotoPdf). Aucun fichier n'est refusé
// sur son extension. Ce module est le SEUL endroit qui connaît la différence :
// il ramène tout fichier à trois types stockables — 'pdf' (embarqué tel quel,
// donc sans perte à l'impression), 'png' (matriciel avec transparence) et 'jpg'
// (matriciel opaque) — puis expose les opérations dont l'éditeur ET l'export ont
// besoin, identiques des deux côtés : mesurer, analyser, afficher, recolorer.
//
// Le type retenu est stocké sur le logo (`logo.logoType`) et sert d'extension au
// fichier (store.saveLogoFile). Son absence vaut 'pdf' : les projets d'avant
// l'import d'images se relisent à l'identique, sans migration.

// pdfcolor tire pdf-lib et pako (201 Ko sur le réseau) pour lire ou recolorer
// un logo VECTORIEL. La grande majorité des logos déposés sont matriciels : ces
// deux bibliothèques n'ont donc rien à faire dans le chemin de démarrage. Elles
// viennent au premier PDF, et une seule fois (le module reste en mémoire).
const pdfcolor = () => import('./pdfcolor.js');
import { EXOTIC_TYPES, DEAD_END, decodeExotic, decodeUnknown } from './imgconvert.js';
import { pdfjs } from './pdfjs.js';
import { clamp, hexToRgb } from './util.js';

// Extensions proposées dans le sélecteur de fichier. Le type réel est de toute
// façon relu dans les octets (sniffLogoType) : l'extension n'est qu'un filtre.
//
// La liste est LARGE À DESSEIN, et le sélecteur ajoute « Tous les fichiers » :
// un fichier grisé dans le dialogue est une impasse muette, alors qu'un fichier
// choisi puis refusé peut au moins expliquer pourquoi et quoi faire (cf.
// DEAD_END). On y trouve donc aussi des formats qu'on ne sait pas décoder.
export const LOGO_EXTENSIONS = [
  'pdf', 'ai', 'eps', 'svg',
  'png', 'jpg', 'jpeg', 'jpe', 'jfif', 'webp', 'gif', 'bmp', 'avif', 'ico',
  'heic', 'heif', 'tif', 'tiff', 'psd',
];

// Extensions qui désignent le même format. Le sélecteur en propose plusieurs,
// le reste du module n'en connaît qu'une.
const EXT_ALIAS = { jpeg: 'jpg', jpe: 'jpg', jfif: 'jpg', heif: 'heic', tiff: 'tif' };

// Grand côté maximal d'un logo matriciel stocké. 2000 px sur un marquage de
// 10 cm = 500 dpi : au-delà, le BAT grossit sans qu'aucune impression n'en
// profite (les mockups eux-mêmes sont embarqués à ~200 dpi).
const MAX_RASTER_PX = 2000;
const JPEG_QUALITY = 0.92;
// En dessous, l'image est trop pauvre pour un marquage : on prévient à l'import.
const LOW_DEF_PX = 600;

const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
  avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
  heic: 'image/heic', tif: 'image/tiff',
};

// ---------------------------------------------------------------------------
// Reconnaissance du format
// ---------------------------------------------------------------------------

const startsWith = (u8, sig, at = 0) => sig.every((b, i) => u8[at + i] === b);
const ascii = (u8, a, b) => String.fromCharCode(...u8.subarray(a, b));

// Type réel d'un fichier, lu dans ses PREMIERS OCTETS et non dans son extension :
// un « .png » qui est en réalité un JPEG (capture renommée, export d'un logiciel
// bavard) doit être traité comme un JPEG, sinon pdf-lib refuse le fichier au
// moment de l'export — c'est-à-dire bien trop tard pour l'utilisateur.
export function sniffLogoType(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 12) return null;
  if (startsWith(u8, [0x25, 0x50, 0x44, 0x46])) return 'pdf';                       // %PDF
  if (startsWith(u8, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(u8, [0xff, 0xd8, 0xff])) return 'jpg';
  if (ascii(u8, 0, 4) === 'RIFF' && ascii(u8, 8, 12) === 'WEBP') return 'webp';
  if (ascii(u8, 0, 4) === 'GIF8') return 'gif';
  if (startsWith(u8, [0x42, 0x4d])) return 'bmp';                                   // BM
  if (startsWith(u8, [0x38, 0x42, 0x50, 0x53])) return 'psd';                       // 8BPS
  if (ascii(u8, 0, 4) === '%!PS') return 'eps';
  // TIFF : « II » (petit-boutiste) ou « MM » (grand-boutiste) + le nombre 42.
  if (startsWith(u8, [0x49, 0x49, 0x2a, 0x00]) || startsWith(u8, [0x4d, 0x4d, 0x00, 0x2a])) return 'tif';
  if (ascii(u8, 4, 8) === 'ftyp') {
    // Même conteneur (ISOBMFF) pour AVIF et HEIC : c'est la marque qui tranche.
    const brand = ascii(u8, 8, 12);
    if (/avif|avis/.test(brand)) return 'avif';
    if (/heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1/.test(brand)) return 'heic';
  }
  // SVG : pas de nombre magique. On cherche la balise racine dans l'en-tête
  // (déclaration XML, DOCTYPE et commentaires peuvent la précéder).
  if (/<svg[\s>]/i.test(ascii(u8, 0, Math.min(u8.length, 1024)))) return 'svg';
  return null;
}

// Marqueur de fin de fichier. Un logo arrive souvent par courriel, messagerie
// ou téléchargement : le transfert s'interrompt et le fichier est AMPUTÉ de sa
// fin. Le décodeur strict (`createImageBitmap`) le refuse, mais la balise <img>
// — le repli volontairement tolérant qui rattrape les fichiers mal nommés —
// décode les lignes présentes et déclare « chargé » : le logo entre à moitié
// dessiné, l'aperçu paraît crédible, et le défaut n'apparaît qu'à l'export
// (embedPng qui échoue) ou, pire, sur le BAT reçu par le client.
//
// Deux octets suffisent à trancher, sans rien décoder. Seuls PNG et JPEG sont
// vérifiés : leur marqueur de fin est une séquence distinctive, ce qui écarte
// tout faux positif — c'est la condition pour qu'un fichier valide ne soit
// JAMAIS refusé ici. GIF et BMP, qui n'en ont pas d'équivalent fiable,
// continuent de passer par le décodage.
const IMAGE_TERMINATOR = {
  png: [0x49, 0x45, 0x4e, 0x44],   // chunk IEND
  jpg: [0xff, 0xd9],               // marqueur EOI
};

// Recherche à REBOURS, et non sur tout le fichier : un « IEND » figurant par
// hasard dans les données d'un tCHUNK textuel ne doit pas valider une image
// coupée juste après. Un fichier complet porte son marqueur tout à la fin, à
// la métadonnée traînante près (miniature, profil, signature d'export).
const TAIL_SCAN = 65536;

export function isTruncatedImage(bytes, kind) {
  const seq = IMAGE_TERMINATOR[kind];
  if (!seq) return false;
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const stop = Math.max(0, u8.length - TAIL_SCAN);
  for (let i = u8.length - seq.length; i >= stop; i--) {
    let hit = true;
    for (let j = 0; j < seq.length; j++) {
      if (u8[i + j] !== seq[j]) { hit = false; break; }
    }
    if (hit) return false;
  }
  return true;
}

export function extensionType(fileName) {
  const ext = String(fileName || '').toLowerCase().split('.').pop();
  if (!LOGO_EXTENSIONS.includes(ext)) return null;
  return EXT_ALIAS[ext] || ext;
}

// Orientation EXIF d'un JPEG (1 = à l'endroit, 2-8 = pivoté/miroité), 1 par
// défaut. Une photo de téléphone porte presque toujours cette étiquette : le
// canevas la respecte (imageOrientation), pas pdf-lib. Sans ce test, l'aperçu
// serait à l'endroit et le PDF exporté couché — l'app ne serait plus le PDF.
export function jpegOrientation(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!startsWith(u8, [0xff, 0xd8, 0xff])) return 1;
  let i = 2;
  while (i + 4 <= u8.length) {
    if (u8[i] !== 0xff) { i++; continue; }               // resynchronisation
    const marker = u8[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xda || marker === 0xd9) return 1;    // début des données : plus d'EXIF
    const len = (u8[i + 2] << 8) | u8[i + 3];
    if (len < 2) return 1;
    if (marker === 0xe1 && ascii(u8, i + 4, i + 10) === 'Exif\0\0') {
      const tiff = i + 10;
      const le = ascii(u8, tiff, tiff + 2) === 'II';
      const u16 = (o) => (le ? u8[o] | (u8[o + 1] << 8) : (u8[o] << 8) | u8[o + 1]);
      const u32 = (o) => (le ? u16(o) | (u16(o + 2) << 16) : (u16(o) << 16) | u16(o + 2));
      const ifd = tiff + u32(tiff + 4);
      const count = u16(ifd);
      for (let e = 0; e < count; e++) {
        const entry = ifd + 2 + e * 12;
        if (entry + 12 > u8.length) break;
        if (u16(entry) === 0x0112) {
          const v = u16(entry + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

// Dimensions intrinsèques déclarées par un SVG. Sans elles, Chrome rasterise un
// SVG dépourvu de width/height au format par défaut 300×150 — et le logo posé
// prend un rapport largeur/hauteur qui n'est pas le sien.
export function svgIntrinsicSize(text) {
  const attr = (name) => {
    const m = String(text).match(new RegExp(`<svg\\b[^>]*\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
    if (!m) return null;
    const v = parseFloat(m[1]);
    return Number.isFinite(v) && v > 0 && !/%\s*$/.test(m[1]) ? v : null;
  };
  const w = attr('width'), h = attr('height');
  if (w && h) return { width: w, height: h };
  const vb = String(text).match(/<svg\b[^>]*\bviewBox\s*=\s*["']([^"']+)["']/i);
  if (vb) {
    const p = vb[1].trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p[2] > 0 && p[3] > 0) return { width: p[2], height: p[3] };
  }
  return w ? { width: w, height: w } : { width: 1000, height: 1000 };
}

// ---------------------------------------------------------------------------
// Décodage / encodage (navigateur)
// ---------------------------------------------------------------------------

// Rend un objet dessinable (ImageBitmap ou canevas — drawImage accepte les deux,
// et tous deux exposent width/height), quel que soit le chemin de décodage.
async function decodeRaster(bytes, type) {
  if (EXOTIC_TYPES.has(type)) return decodeExotic(bytes, type);
  const blob = new Blob([bytes], { type: MIME[type] || 'application/octet-stream' });
  try {
    // imageOrientation : applique l'étiquette EXIF d'une photo de téléphone.
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // Type mal deviné, fichier renommé, format rare : la balise <img> renifle le
    // contenu là où createImageBitmap se fie au type MIME du blob. On préfère un
    // second essai à un refus — c'est la différence entre « ça marche » et
    // « convertis-le ailleurs et reviens ».
    const canvas = await decodeUnknown(bytes);
    if (canvas) return canvas;
    throw new Error('image illisible');
  }
}

// Décode l'image dans un canevas, sans jamais l'agrandir, borné à `maxPx`.
// Le canevas reste TRANSPARENT là où l'image l'est : un logo se pose sur le
// vêtement, jamais dans un pavé blanc (contrairement aux mockups).
//
// `readback` n'est vrai que pour les canevas dont on relit les pixels
// (analyse, recoloration) : sur le canevas d'APERÇU il forcerait un rendu en
// mémoire système, re-téléversé au GPU à chaque image — donc du jank pendant
// qu'on déplace un logo, redessiné à chaque mouvement de pointeur.
async function drawRaster(bytes, type, maxPx, readback = false) {
  const bmp = await decodeRaster(bytes, type);
  const natural = { width: bmp.width, height: bmp.height };
  const s = Math.min(1, maxPx / Math.max(natural.width, natural.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(natural.width * s));
  canvas.height = Math.max(1, Math.round(natural.height * s));
  const ctx = canvas.getContext('2d', { willReadFrequently: readback });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return { canvas, ctx, natural };
}

async function canvasBytes(canvas, mime, quality) {
  const blob = await new Promise((r) => canvas.toBlob(r, mime, quality));
  if (!blob) throw new Error('encodage de l\'image impossible');
  return new Uint8Array(await blob.arrayBuffer());
}

// Rasterisation d'un SVG : <img> + canevas. `createImageBitmap` ne gère pas les
// blobs SVG dans Chromium, d'où le passage par une balise image.
async function rasterizeSvg(bytes) {
  const { width, height } = svgIntrinsicSize(new TextDecoder().decode(bytes));
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME.svg }));
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('SVG illisible'));
      img.src = url;
    });
    const s = MAX_RASTER_PX / Math.max(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * s));
    canvas.height = Math.max(1, Math.round(height * s));
    // drawImage rasterise le SVG à la taille de destination (vecteur → net).
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await canvasBytes(canvas, MIME.png);
  } finally { URL.revokeObjectURL(url); }
}

// ---------------------------------------------------------------------------
// Import : tout fichier → { bytes, type } stockable
// ---------------------------------------------------------------------------

// Un PNG/JPEG déjà raisonnable est CONSERVÉ TEL QUEL : ré-encoder au canevas
// gonflerait le PNG (l'encodeur du navigateur n'optimise pas) et ferait perdre
// une génération au JPEG, pour rien. On ne ré-encode que si l'image est trop
// grande, dans un format que pdf-lib ne sait pas embarquer, ou étiquetée EXIF.
export async function normalizeLogoFile(bytes, fileName = '') {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // `sniffed` et non `kind` : on ne parle de fichier INCOMPLET que si les
  // octets d'en-tête annoncent bien un PNG ou un JPEG. Un fichier qui n'est pas
  // une image mais porte l'extension .png n'a pas été « interrompu » — il doit
  // garder son message à lui, plus bas.
  const sniffed = sniffLogoType(u8);
  const kind = sniffed || extensionType(fileName);
  if (sniffed && isTruncatedImage(u8, sniffed)) {
    throw new Error('Ce fichier est incomplet — le transfert a dû être interrompu. Demandez à nouveau le logo à votre client, puis réessayez.');
  }
  if (kind === 'pdf') {
    if (u8.length > PDF_PHOTO_MAX_BYTES) {
      const converted = await rasterizeHeavyPhotoPdf(u8);
      if (converted) return converted;
    }
    return { bytes: u8, type: 'pdf' };
  }
  if (kind === 'svg') return { bytes: await rasterizeSvg(u8), type: 'png' };
  // Format identifié mais indécodable ici : on le nomme et on dit quoi faire,
  // plutôt qu'un « format non reconnu » qui laisse sans issue.
  if (DEAD_END[kind]) throw new Error(DEAD_END[kind]);

  // Tout le reste part au décodage, Y COMPRIS un format non identifié : le
  // navigateur tranche mieux qu'une liste d'extensions (cf. decodeRaster).
  let drawn;
  try {
    drawn = await drawRaster(u8, kind, MAX_RASTER_PX, true);
  } catch {
    throw new Error('Ce fichier n\'est pas une image lisible. Formats sûrs : PDF, PNG, JPEG (HEIC, TIFF, SVG et WebP sont convertis automatiquement).');
  }
  const { canvas, ctx, natural } = drawn;
  const asIs = Math.max(natural.width, natural.height) <= MAX_RASTER_PX
    && (kind === 'png' || (kind === 'jpg' && jpegOrientation(u8) === 1));
  if (asIs) return { bytes: u8, type: kind };
  return encodeCanvas(canvas, ctx);
}

// Transparence réelle → PNG ; sinon JPEG, bien plus léger sur une photo.
async function encodeCanvas(canvas, ctx) {
  const opaque = !hasTransparency(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  return opaque
    ? { bytes: await canvasBytes(canvas, MIME.jpg, JPEG_QUALITY), type: 'jpg' }
    : { bytes: await canvasBytes(canvas, MIME.png), type: 'png' };
}

// Un PDF de plusieurs Mo n'est pas un logo vectoriel : c'est une photo posée
// dans une page (export Illustrator, scan), souvent lestée des données privées
// d'édition (PieceInfo — l'export « éditable » d'Illustrator embarque le .ai
// complet). Embarqué tel quel via embedPdf, il emporte son image pleine
// résolution dans CHAQUE BAT : budget 3 Mo dépassé avant les mockups. Converti
// en image à l'import, il redevient un marquage ordinaire — l'aperçu écran le
// rasterisait déjà, le PDF exporté est visuellement identique. Un vrai dessin
// vectoriel de cette taille (rare) ne contient pas d'image : il reste du PDF.
const PDF_PHOTO_MAX_BYTES = 3 * 1024 * 1024;
// 1600 px (et non MAX_RASTER_PX) : un PNG-photo à canal alpha pèse vite ~3 Mo
// à 2000 px — tout le budget du BAT. À 1600 px on garde ≥ 220 dpi aux tailles
// réelles de marquage (la photo source d'un PDF client dépasse rarement
// 1800 px de toute façon) pour un poids moitié moindre.
const PDF_CONVERT_PX = 1600;

async function rasterizeHeavyPhotoPdf(u8) {
  try {
    const { hasImage } = await (await pdfcolor()).analyzePdfLogo(u8);
    if (!hasImage) return null;
    const canvas = await renderPdfLogoToCanvas(u8, null, PDF_CONVERT_PX);
    return await encodeCanvas(canvas, canvas.getContext('2d'));
  } catch {
    return null;   // PDF que pdf.js ne relit pas : on le garde tel quel plutôt que refuser
  }
}

// ---------------------------------------------------------------------------
// Analyse : monochrome (donc recolorable par pastille) ou non
// ---------------------------------------------------------------------------

const CHROMA_MIN = 30;         // (max−min) en deçà duquel un pixel est « gris »
const HUE_FOCUS_MIN = 0.95;    // concentration des teintes (1 = teinte unique)
const CHROMA_SHARE_MIN = 0.02; // part de pixels colorés à partir de laquelle l'encre est « couleur »
const BG_LUM_GAP = 0.18;       // écart de luminance au fond à partir duquel un pixel est de l'encre

const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const hex2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
const toHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);

export function hasTransparency(data) {
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

// Luminance moyenne du pourtour (1 px) : le fond d'une image opaque touche
// toujours le cadre. Sert à séparer l'encre du fond, puis à détourer à la
// recoloration.
function borderLum(data, w, h) {
  let sum = 0, n = 0;
  const add = (x, y) => { const i = (y * w + x) * 4; sum += lum(data[i], data[i + 1], data[i + 2]); n++; };
  for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }
  return n ? sum / n : 1;
}

// Relevé des pixels retenus par `keep` : combien font de l'encre, de quelle(s)
// teinte(s), et quelle couleur moyenne les représente.
function measureInk(data, keep) {
  let ink = 0, chromatic = 0;
  let cx = 0, cy = 0, wSum = 0;              // moyenne circulaire des teintes
  let cr = 0, cg = 0, cb = 0;                // couleur moyenne, pondérée chroma
  let gr = 0, gg = 0, gb = 0;                // couleur moyenne de l'encre neutre
  for (let i = 0; i < data.length; i += 4) {
    if (!keep(i)) continue;
    ink++;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), chroma = max - min;
    if (chroma < CHROMA_MIN) { gr += r; gg += g; gb += b; continue; }
    chromatic++;
    let hue = 0;
    if (max === r) hue = ((g - b) / chroma) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
    const rad = (hue * 60) * Math.PI / 180;
    cx += Math.cos(rad) * chroma; cy += Math.sin(rad) * chroma; wSum += chroma;
    cr += r * chroma; cg += g * chroma; cb += b * chroma;
  }
  if (!ink) return null;
  // Encre neutre (noir, gris) : une seule couleur suffit à la reproduire.
  if (chromatic / ink < CHROMA_SHARE_MIN) {
    const n = ink - chromatic || 1;
    return { monochrome: true, color: toHex(gr / n, gg / n, gb / n) };
  }
  // Sinon, monochrome si toutes les teintes se serrent autour d'une seule
  // (longueur de la résultante circulaire, pondérée par la chroma).
  return {
    monochrome: Math.hypot(cx, cy) / wSum >= HUE_FOCUS_MIN,
    color: toHex(cr / wSum, cg / wSum, cb / wSum),
  };
}

// Classement d'un logo matriciel. Fonction PURE (pixels RGBA en entrée) : c'est
// elle qui décide si les pastilles de couleur sont proposées, et la recoloration
// réutilise le MÊME verdict — l'aperçu ne peut donc pas diverger de l'analyse.
//
// Encre = les pixels qui « comptent » : les pixels opaques si l'image a de la
// transparence, sinon ceux qui s'écartent nettement du fond (échantillonné sur
// le pourtour, qu'un fond touche toujours).
export function classifyRasterPixels(data, w, h) {
  const opaque = !hasTransparency(data);
  const bgLum = opaque ? borderLum(data, w, h) : null;
  let bgSeparable = opaque;
  let m = measureInk(data, opaque
    ? (i) => Math.abs(lum(data[i], data[i + 1], data[i + 2]) - bgLum) > BG_LUM_GAP
    : (i) => data[i + 3] >= 200);
  // Aucune encre trouvée alors que l'image est opaque : elle n'a pas de fond
  // séparable (aplat de couleur unie, visuel à fond perdu qui touche les quatre
  // bords). On la reprend alors dans son entier — sinon un carré de couleur
  // passerait pour « vide », donc non recolorable.
  if (!m && opaque) { bgSeparable = false; m = measureInk(data, () => true); }
  if (!m) return { monochrome: false, colors: [], opaque, bgLum, bgSeparable };
  return { monochrome: m.monochrome, colors: [m.color], opaque, bgLum, bgSeparable };
}

// Analyse d'un logo, vectoriel ou matriciel — même forme de retour des deux
// côtés (cf. analyzePdfLogo), c'est ce que promptAddLogo pose sur le logo.
export async function analyzeLogo(bytes, type) {
  if (type === 'pdf') return (await pdfcolor()).analyzePdfLogo(bytes);
  const { canvas, ctx, natural } = await drawRaster(bytes, type, 256, true);
  const cls = classifyRasterPixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  const warnings = [];
  if (Math.max(natural.width, natural.height) < LOW_DEF_PX) {
    warnings.push(`Image de faible définition (${natural.width}×${natural.height} px) : elle risque d'être floue à l'impression.`);
  }
  return {
    pageCount: 1,
    monochrome: cls.monochrome,
    colors: cls.colors,
    hasImage: true, hasShading: false, hasPattern: false,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Mesure, aperçu, recoloration
// ---------------------------------------------------------------------------

// Dimensions natives de la page 1 d'un logo PDF (points).
export async function pdfLogoSize(bytes) {
  const task = (await pdfjs()).getDocument({ data: bytes.slice(0) });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const out = { width: vp.width, height: vp.height };
  // pdf.js ≥ 4 : destroy vit sur la TÂCHE (elle ferme doc et worker), plus sur
  // le document. task.destroy existe aussi en 3.x — même geste partout.
  await task.destroy();
  return out;
}

// Seul le RAPPORT largeur/hauteur est exploité par l'éditeur : points PDF ou
// pixels, l'unité n'a pas d'importance.
export async function logoNaturalSize(bytes, type) {
  if (type === 'pdf') return pdfLogoSize(bytes);
  const bmp = await decodeRaster(bytes, type);
  const out = { width: bmp.width, height: bmp.height };
  bmp.close?.();
  return out;
}

// Éviction LRU (retire la plus ancienne) au lieu de vider tout le cache d'un
// coup — sinon re-rendu en boucle près du seuil.
function cacheStore(cache, key, value) {
  if (!key) return;
  while (cache.size >= 30) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}

// Rendu d'un logo PDF en bitmap (aperçu éditeur), via pdf.js.
// La qualité d'aperçu est indépendante du PDF final (toujours vectoriel).
const logoRenderCache = new Map();   // hash+couleur+taille → canvas

export async function renderPdfLogoToCanvas(bytes, cacheKey, targetPx = 900) {
  if (cacheKey && logoRenderCache.has(cacheKey)) return logoRenderCache.get(cacheKey);
  const task = (await pdfjs()).getDocument({ data: bytes.slice(0) });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = targetPx / Math.max(vp1.width, vp1.height);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d');
  // fond transparent : le logo se pose sur le mockup sans « pavé » blanc.
  // intent « print » : l'ordonnancement « display » attend requestAnimationFrame,
  // qui ne bat PAS dans un onglet en arrière-plan — un rendu lancé juste avant
  // un changement d'onglet resterait suspendu jusqu'au retour. Le résultat
  // pixel est identique pour un logo (ni formulaire ni annotation).
  await page.render({ canvasContext: ctx, viewport: vp, background: 'rgba(0,0,0,0)', intent: 'print' }).promise;
  await task.destroy();
  cacheStore(logoRenderCache, cacheKey, canvas);
  return canvas;
}

const rasterRenderCache = new Map();

// Aperçu éditeur d'un logo, quel que soit son type. Une image matricielle n'est
// jamais agrandie ici : elle est dessinée à sa définition native (bornée), et
// c'est l'affichage qui l'étire — exactement comme le fera le lecteur PDF.
export async function renderLogoToCanvas(bytes, type, cacheKey, targetPx = 900) {
  if (type === 'pdf') return renderPdfLogoToCanvas(bytes, cacheKey, targetPx);
  if (cacheKey && rasterRenderCache.has(cacheKey)) return rasterRenderCache.get(cacheKey);
  const { canvas } = await drawRaster(bytes, type, targetPx);
  cacheStore(rasterRenderCache, cacheKey, canvas);
  return canvas;
}

// Recoloration vers une couleur unie. Vectoriel : réécriture des opérateurs de
// couleur, le logo reste en vecteurs. Matriciel : teinture à plat (comme le
// vectoriel, qui ramène tous les aplats à la couleur cible), la FORME étant
// portée par l'alpha — celui du PNG détouré, ou le taux d'encre déduit du
// contraste avec le fond pour une image opaque. Recolorer un JPEG noir sur
// blanc en détoure donc le fond, ce qui est exactement ce qu'on attend d'un
// marquage posé sur un vêtement.
export async function recolorLogo(bytes, type, hex) {
  if (type === 'pdf') return { bytes: await (await pdfcolor()).recolorPdfLogo(bytes, hex), type: 'pdf' };
  const { canvas, ctx } = await drawRaster(bytes, type, MAX_RASTER_PX, true);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const { bgLum, opaque, bgSeparable } = classifyRasterPixels(d, canvas.width, canvas.height);
  const { r, g, b } = hexToRgb(hex);
  for (let i = 0; i < d.length; i += 4) {
    let a = d[i + 3];
    // Fond séparable → il est détouré ; sinon (aplat, visuel à fond perdu)
    // l'image entière prend la couleur, il n'y a rien à retirer.
    if (opaque) {
      if (!bgSeparable) a = 255;
      else {
        const L = lum(d[i], d[i + 1], d[i + 2]);
        const cover = bgLum > 0.5
          ? (bgLum - L) / Math.max(0.08, bgLum)
          : (L - bgLum) / Math.max(0.08, 1 - bgLum);
        a = Math.round(clamp(cover, 0, 1) * 255);
      }
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return { bytes: await canvasBytes(canvas, MIME.png), type: 'png' };
}
