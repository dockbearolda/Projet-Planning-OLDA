// Formats d'image que le NAVIGATEUR NE SAIT PAS DÉCODER, ramenés à un canevas
// avant que le reste de l'application ne les voie.
//
// Chromium (donc l'app, en bureau comme en web) refuse deux formats que les
// clients envoient tous les jours : le HEIC/HEIF — format par défaut de l'appareil
// photo d'un iPhone — et le TIFF, format de sortie des scanners et des chaînes
// d'impression. Sans ce module, un logo parfaitement exploitable se voyait
// répondre « format non reconnu », et il fallait le convertir à la main ailleurs.
//
// Les deux décodeurs sont chargés À LA DEMANDE (import dynamique) : ils ne
// coûtent rien tant qu'aucun fichier exotique n'est importé — et l'immense
// majorité des imports (PDF, PNG, JPG) ne les touche jamais.

// pako n'est utile qu'au décodeur TIFF, et `vendor.js` tire pdf-lib avec lui.
// Un import statique mettait donc 201 Ko sur le chemin de démarrage pour un
// format que presque personne ne dépose. Il vient avec le décodeur.

// Types que decodeExotic sait produire. Le reste de l'application ne les
// rencontre jamais : ils sont convertis à l'import (cf. normalizeLogoFile).
export const EXOTIC_TYPES = new Set(['heic', 'tif']);

// Formats reconnus mais réellement indécodables ici : mieux vaut nommer le
// format et dire quoi faire que renvoyer « format non reconnu », qui laisse
// l'utilisateur sans issue devant un fichier qu'il sait valide.
export const DEAD_END = {
  psd: 'Fichier Photoshop (.psd) : dans Photoshop, « Enregistrer sous » en PNG (fond transparent) ou en JPEG.',
  eps: 'Fichier EPS : dans Illustrator, « Enregistrer sous » en PDF — le logo restera vectoriel.',
};

// ---------------------------------------------------------------------------
// HEIC / HEIF (libheif compilé en WebAssembly)
// ---------------------------------------------------------------------------

// Variante « bundle » : le binaire wasm est embarqué en base64 dans le module.
// Aucun second fichier à charger, donc rien à router côté serveur ni à
// retrouver derrière file:// dans l'application de bureau.
let heifLib = null;

async function libheif() {
  if (!heifLib) {
    const mod = await import('../vendor/libheif-bundle.mjs');
    const made = (mod.default ?? mod)();
    // Selon la version d'Emscripten, la fabrique rend le module ou une promesse.
    heifLib = made && typeof made.then === 'function' ? await made : made;
  }
  return heifLib;
}

async function decodeHeic(u8) {
  const lib = await libheif();
  const images = new lib.HeifDecoder().decode(u8);
  if (!images?.length) throw new Error('HEIC illisible');
  // Un « live photo » ou une rafale contient plusieurs images : la première est
  // l'image principale, celle que l'utilisateur voit dans sa photothèque.
  const image = images[0];
  const width = image.get_width();
  const height = image.get_height();
  const data = new ImageData(width, height);
  await new Promise((res, rej) => {
    image.display(data, (out) => (out ? res() : rej(new Error('HEIC illisible'))));
  });
  for (const im of images) im.free?.();
  return imageDataToCanvas(data);
}

// ---------------------------------------------------------------------------
// TIFF (UTIF, JavaScript pur)
// ---------------------------------------------------------------------------

let utifLoaded = null;

async function utif() {
  if (!utifLoaded) {
    utifLoaded = (async () => {
      // UTIF est un script classique : il se publie sur l'objet global et y
      // lit `pako` au moment de son évaluation — d'où l'ordre imposé ici.
      globalThis.pako ??= (await import('./vendor.js')).pako;
      await import('../vendor/UTIF.js');
      if (!globalThis.UTIF) throw new Error('décodeur TIFF indisponible');
      return globalThis.UTIF;
    })();
  }
  return utifLoaded;
}

async function decodeTiff(u8) {
  const UTIF = await utif();
  const pages = UTIF.decode(u8);
  if (!pages?.length) throw new Error('TIFF illisible');
  // Un TIFF porte souvent une vignette en première page (et un scanner y met
  // parfois plusieurs pages) : on prend la plus grande, c'est-à-dire l'image.
  const page = pages.reduce((a, b) => ((b.width || 0) * (b.height || 0) > (a.width || 0) * (a.height || 0) ? b : a));
  UTIF.decodeImage(u8, page, pages);
  const rgba = UTIF.toRGBA8(page);
  if (!rgba?.length) throw new Error('TIFF illisible');
  return imageDataToCanvas(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), page.width, page.height));
}

// ---------------------------------------------------------------------------
// Entrées publiques
// ---------------------------------------------------------------------------

function imageDataToCanvas(data) {
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext('2d').putImageData(data, 0, 0);
  return canvas;
}

// Décode un format exotique en canevas — interchangeable avec l'ImageBitmap
// rendu par createImageBitmap partout où l'app dessine une image.
export function decodeExotic(bytes, type) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (type === 'heic') return decodeHeic(u8);
  if (type === 'tif') return decodeTiff(u8);
  throw new Error('format non pris en charge : ' + type);
}

// Dernier recours, pour un fichier dont on n'a identifié NI la signature NI
// l'extension : on le soumet quand même au navigateur. Une balise <img> renifle
// le contenu (là où createImageBitmap se fie au type MIME du blob), ce qui
// rattrape les fichiers mal nommés et les formats que Chromium sait lire sans
// qu'on les ait listés. Rend null si ce n'est décidément pas une image.
export async function decodeUnknown(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const url = URL.createObjectURL(new Blob([u8]));
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('illisible'));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) return null;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
