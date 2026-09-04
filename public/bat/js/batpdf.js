// Génération du PDF « Bon À Tirer » — A4 paysage, UNE page par article de la
// commande (« 2 pochettes, 3 t-shirts… ») : toutes les faces incluses d'un
// article tiennent côte à côte sur sa page, avec sa propre grille commande +
// marquage. Les mockups sont recompressés en JPEG (~200 dpi utile) ; les logos
// PDF sont embarqués en VECTORIEL via embedPdf (aucune rastérisation), les
// logos images en objet image (embedPng/embedJpg), tels qu'ils ont été importés.

import { PDFLib, loadFontkit } from './vendor.js';
import { store, FACES, FACE_ORDER, companyIdentityLine, companyMentionVars, facesByLogoId, articleCouleur, articleRef, projectFileName } from './store.js';
import { faceVisual } from './mockup.js';
import { buildProjectAttachment, attachProjectBytes } from './batfile.js';
import { recolorLogo } from './logoasset.js';
import { fillTemplate, deg2rad, hexToRgb } from './util.js';
import { servedSizes } from './tailles.js';
import {
  PW, PH, M, V_BOTTOM,
  grid, BUB_PAD, BUB_RADIUS, G_RADIUS,
  ROW_H, PLACE_ROW_H, TBL_FONT, TBL_FONT_SM, TBL_FONT_ZONE, G_HEX,
  META_COLS, META_FLEX_SUM,
  HEX, faceLayout, evenColWidth,
} from './batlayout.js';

// Géométrie de la grille (bulles + largeurs de colonnes) → hauteur de la bulle.
// Propre à l'article : sa hauteur dépend du nombre de tailles et d'emplacements,
// donc elle change d'une page à l'autre. Compte les tailles COMMANDÉES — mêmes
// lignes que celles que drawGrid dessinera plus bas (cf. servedSizes).
const gridFor = (article) => grid(servedSizes(article).length, (article.placements || []).length);
import { OLDA_VIEWBOX, OLDA_PATHS, OLDA_H } from './brand.js';

const {
  PDFDocument, rgb, degrees,
  pushGraphicsState, popGraphicsState, moveTo, lineTo, closePath, clip, endPath,
} = PDFLib;

// Encres : mêmes valeurs que l'écran WYSIWYG (batlayout.js)
const pdfRgb = (hex) => { const { r, g, b } = hexToRgb(hex); return rgb(r / 255, g / 255, b / 255); };
const GREY = pdfRgb(HEX.GREY);
const FAINT = pdfRgb(HEX.FAINT);
const HAIR = pdfRgb(HEX.HAIR);
const BUB_FILL = pdfRgb('#fafbfa');    // fond des bulles
const BUB_BORDER = pdfRgb('#e2e4e3');  // bordure des bulles

// Palette Material du bandeau (identité + tableau, G_HEX dans batlayout.js)
// — seules ces deux bulles en dévient ; le reste de la feuille garde HEX.
const G_BG = pdfRgb(G_HEX.BG);
const G_HEAD_BG = pdfRgb(G_HEX.HEAD_BG);
const G_INK = pdfRgb(G_HEX.INK);
const G_GREY = pdfRgb(G_HEX.GREY);
const G_FAINT = pdfRgb(G_HEX.FAINT);
const G_BORDER = pdfRgb(G_HEX.BORDER);
const G_SEP = pdfRgb(G_HEX.SEP);

// ---------------------------------------------------------------------------
// Polices
// ---------------------------------------------------------------------------
let fontBytesCache = null;
// Chauffe le composeur : les six .ttf embarqués dans le PDF pèsent 1,36 Mo
// (701 Ko transférés) et ne sont demandés qu'au moment de composer — c'est-à-dire
// APRÈS que l'utilisateur a choisi son nom de fichier, donc en pleine attente.
// Appelé au survol du bouton d'export : le téléchargement se fait pendant qu'on
// vise le bouton et qu'on nomme le fichier, et l'export démarre sur des polices
// déjà là. Sans effet au deuxième export (mémoïsé), ni en bureau (lecture disque).
export function prechargerPolices() {
  return loadFontBytes().catch(() => {});
}

async function loadFontBytes() {
  if (fontBytesCache) return fontBytesCache;
  const dir = store.appInfo.appDir + '/assets/fonts/';
  const read = async (f) => new Uint8Array(await window.batApi.fsRead(dir + f));
  fontBytesCache = {
    regular: await read('Inter-Regular.ttf'),
    medium: await read('Inter-Medium.ttf'),
    // Bandeau Material (identité + tableau) uniquement — le reste du PDF
    // reste en Inter ci-dessus.
    gRegular: await read('Roboto-Regular.ttf'),
    gMedium: await read('Roboto-Medium.ttf'),
    gBold: await read('Roboto-Bold.ttf'),
    gMono: await read('RobotoMono-Regular.ttf'),
  };
  return fontBytesCache;
}

// ---------------------------------------------------------------------------
// Aides texte
// ---------------------------------------------------------------------------
function wrap(text, font, size, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(t, size) <= maxW || !line) line = t;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

function drawTracked(page, text, x, y, { font, size, color, tracking = 0.14 }) {
  let cx = x;
  const t = tracking * size;
  for (const ch of String(text)) {
    page.drawText(ch, { x: cx, y, size, font, color });
    cx += font.widthOfTextAtSize(ch, size) + t;
  }
  return cx - t - x; // largeur totale
}

function trackedWidth(text, font, size, tracking = 0.14) {
  let w = 0;
  for (const ch of String(text)) w += font.widthOfTextAtSize(ch, size) + tracking * size;
  return w - tracking * size;
}

// Tronque un texte à `maxW` (pt) en ajoutant « … » (valeurs de bandeau qui
// dépassent leur colonne de largeur égale) — reproduit le rognage des cases
// de saisie de l'écran (overflow masqué).
function fitText(str, font, size, maxW) {
  str = String(str);
  if (font.widthOfTextAtSize(str, size) <= maxW) return str;
  let s = str;
  while (s.length > 1 && font.widthOfTextAtSize(s + '…', size) > maxW) s = s.slice(0, -1);
  return s + '…';
}

// Valeur du bandeau d'identité : on RÉDUIT le corps jusqu'à ce que le texte
// tienne, au lieu de le couper. « Washed Dream Blue » sortait en « Washed Dream
// Bl… » — sur un document contractuel, la couleur commandée amputée de sa fin
// est une information fausse, et c'est justement l'une des cinq que le client
// doit vérifier avant de signer. Le plancher garde la valeur lisible à
// l'impression ; en dessous seulement, on tronque (nom aberrant collé au
// clavier), faute de quoi la case déborderait sur sa voisine.
const META_SIZE_MIN = 6.4;
function fitValue(str, font, size, maxW) {
  str = String(str);
  let s = size;
  while (s > META_SIZE_MIN && font.widthOfTextAtSize(str, s) > maxW) s -= 0.1;
  return { text: fitText(str, font, s, maxW), size: s };
}

function hline(page, x1, x2, y, color = HAIR, thickness = 0.6) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, color, thickness });
}

// « Bulle » : carte à coins arrondis. `box.top` est mesuré depuis le HAUT
// de page ; drawSvgPath ancre l'origine SVG (0,0) au point donné, y vers le
// bas — d'où x = box.x, y = PH - box.top (bord supérieur).
function drawBubble(page, box, { r = BUB_RADIUS, fill = BUB_FILL, border = BUB_BORDER, borderWidth = 0.9 } = {}) {
  const { w, h } = box;
  const d = `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} `
    + `V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} `
    + `H ${r} A ${r} ${r} 0 0 1 0 ${h - r} `
    + `V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
  page.drawSvgPath(d, {
    x: box.x, y: PH - box.top,
    color: fill, borderColor: border, borderWidth,
  });
}

// Cote de marquage : stockée en cm (fiche.placements[].dims), affichée en mm
// entiers dans le tableau — même conversion d'affichage que l'écran (batpage.js).
const cmToMm = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? String(Math.round(n * 10)) : ''; };

// ---------------------------------------------------------------------------
// « Fiche de production » — grille Material (Google), voir G_HEX/TBL_FONT*
// dans batlayout.js.
// LES TAILLES SONT EN COLONNES (cf. grid()) : colonnes = intitulé | une par
// taille | Total ; lignes = en-tête (les tailles) | Qté | un emplacement par
// logo posé (intitulé = face en gras + « couleur · emplacement »).
// Rigoureusement la même structure qu'à l'écran (batpage.buildGrid) : les deux
// ne peuvent pas diverger, c'est ce que l'aperçu promet.
// ---------------------------------------------------------------------------
function drawGrid(page, F, {
  x, yTop, labelW, sizeW, totalW, sizes, placements, faceLabels, headH,
  fontSize = TBL_FONT, rowH = ROW_H, placeRowH = PLACE_ROW_H,
}) {
  const list = sizes.length ? sizes : [null];
  const xs = [];
  let acc = x;
  xs.push(acc); acc += labelW;                              // colonne d'intitulé
  for (let i = 0; i < list.length; i++) { xs.push(acc); acc += sizeW; }
  const xTotal = acc;
  const width = labelW + sizeW * list.length + totalW;
  let y = yTop;

  const fit = (txt, font, size, maxW) => {
    let t = String(txt ?? '');
    while (t.length > 1 && font.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -2) + '…';
    return t;
  };
  const centre = (txt, colX, colW, yy, { font = F.gRegular, color = G_INK, size = fontSize } = {}) => {
    const t = fit(txt, font, size, colW - 4);
    const tw = font.widthOfTextAtSize(t, size);
    page.drawText(t, { x: colX + colW / 2 - tw / 2, y: yy, size, font, color });
  };
  // Petites capitales espacées — le libellé d'un intitulé, en-tête ou ligne.
  // `align` reproduit exactement ce que fait la feuille de style de l'écran :
  // la colonne d'intitulé est calée à GAUCHE, la colonne Total est centrée.
  const petitesCapitales = (label, colX, colW, yy, align = 'centre') => {
    const t = (label || '').toUpperCase();
    const lw = trackedWidth(t, F.gMedium, TBL_FONT_SM, 0.06);
    const tx = align === 'gauche' ? colX + 4 : colX + colW / 2 - lw / 2;
    drawTracked(page, t, tx, yy, { font: F.gMedium, size: TBL_FONT_SM, color: G_GREY, tracking: 0.06 });
  };

  // ---- En-tête : TAILLE (à gauche) · les tailles · TOTAL
  petitesCapitales('Taille', xs[0], labelW, y - headH / 2 - TBL_FONT_SM * 0.36, 'gauche');
  list.forEach((sz, i) => {
    const t = fit(sz ? (sz.taille || '—') : '—', F.gBold, fontSize, sizeW - 4);
    const tw = F.gBold.widthOfTextAtSize(t, fontSize);
    page.drawText(t, { x: xs[1 + i] + sizeW / 2 - tw / 2, y: y - headH / 2 - fontSize * 0.36, size: fontSize, font: F.gBold, color: sz ? G_INK : G_GREY });
  });
  petitesCapitales('Total', xTotal, totalW, y - headH / 2 - TBL_FONT_SM * 0.36);
  // Filets verticaux de l'en-tête
  for (let i = 1; i <= list.length; i++) {
    page.drawLine({ start: { x: xs[i], y: y - headH }, end: { x: xs[i], y }, color: G_BORDER, thickness: 0.6 });
  }
  page.drawLine({ start: { x: xTotal, y: y - headH }, end: { x: xTotal, y }, color: G_BORDER, thickness: 0.6 });
  y -= headH;
  hline(page, x, x + width, y, G_BORDER, 0.8);

  // ---- Ligne « Qté » : une case par taille, puis la somme
  const milieu = (h) => y + (h - fontSize) / 2 + 0.5;
  y -= rowH;
  petitesCapitales('Qté', xs[0], labelW, milieu(rowH), 'gauche');
  list.forEach((sz, i) => centre(sz ? (sz.quantite || '—') : '—', xs[1 + i], sizeW, milieu(rowH), { color: G_GREY }));
  let somme = 0, uneQte = false;
  for (const sz of sizes) {
    const n = parseFloat(String(sz.quantite ?? '').replace(',', '.'));
    if (Number.isFinite(n)) { somme += n; uneQte = true; }
  }
  centre(uneQte ? String(somme) : '—', xTotal, totalW, milieu(rowH), { font: F.gBold, color: G_INK });
  hline(page, x, x + width, y, placements.length ? G_BORDER : G_SEP, placements.length ? 0.8 : 0.6);

  // ---- Une ligne par emplacement : intitulé, puis une cote par taille
  const cote = (val, colX, colW, yy) => {
    const mm = cmToMm(val);
    if (!mm) { centre('—', colX, colW, yy, { color: G_GREY }); return; }
    const numW = F.gMono.widthOfTextAtSize(mm, fontSize);
    const unitW = F.gRegular.widthOfTextAtSize('mm', TBL_FONT_SM);
    const sx = colX + colW / 2 - (numW + 2 + unitW) / 2;
    page.drawText(mm, { x: sx, y: yy, size: fontSize, font: F.gMono, color: G_INK });
    page.drawText('mm', { x: sx + numW + 2, y: yy, size: TBL_FONT_SM, font: F.gRegular, color: G_GREY });
  };
  for (const pl of placements) {
    y -= placeRowH;
    const yy = milieu(placeRowH);
    // Intitulé : la zone en gras, puis « couleur · emplacement » — sur une
    // ligne, calé à gauche comme un intitulé de ligne.
    const zone = fit(faceLabels.get(pl.logoId) || '', F.gBold, TBL_FONT_ZONE, labelW - 8);
    const zw = F.gBold.widthOfTextAtSize(zone, TBL_FONT_ZONE);
    page.drawText(zone, { x: xs[0] + 4, y: yy, size: TBL_FONT_ZONE, font: F.gBold, color: G_INK });
    const cap = [pl.color, pl.name].filter(Boolean).join(' · ');
    if (cap) {
      const t = fit(cap, F.gRegular, TBL_FONT_SM, labelW - 12 - zw);
      page.drawText(t, { x: xs[0] + 4 + zw + 4, y: yy, size: TBL_FONT_SM, font: F.gRegular, color: G_GREY });
    }
    list.forEach((sz, i) => cote(sz ? pl.dims?.[sz.id] : '', xs[1 + i], sizeW, yy));
    // La case Total reste vide : sommer des millimètres n'a pas de sens.
    hline(page, x, x + width, y, G_SEP, 0.6);
  }

  return y;
}

// ---------------------------------------------------------------------------
// Logo entreprise → objet embarquable (PDF vectoriel, ou image)
// ---------------------------------------------------------------------------
async function embedCompanyLogo(doc) {
  const c = store.settings.company;
  if (!c.logoFile) return null;
  const bytes = await window.batApi.dataRead('company/' + c.logoFile);
  if (!bytes) return null;
  const u8 = new Uint8Array(bytes);
  try {
    if (c.logoType === 'pdf') {
      const [p] = await doc.embedPdf(u8);
      return { kind: 'pdf', obj: p, w: p.width, h: p.height };
    }
    if (c.logoType === 'png') {
      const img = await doc.embedPng(u8);
      return { kind: 'img', obj: img, w: img.width, h: img.height };
    }
    if (c.logoType === 'jpg') {
      const img = await doc.embedJpg(u8);
      return { kind: 'img', obj: img, w: img.width, h: img.height };
    }
    if (c.logoType === 'svg') {
      // SVG → PNG haute résolution (le seul cas rasterisé, documenté)
      const blob = new Blob([u8], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const scale = 600 / Math.max(img.width || 300, img.height || 100);
      const cv = document.createElement('canvas');
      cv.width = Math.ceil((img.width || 300) * scale);
      cv.height = Math.ceil((img.height || 100) * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      const png = await (await new Promise(r => cv.toBlob(r, 'image/png'))).arrayBuffer();
      const em = await doc.embedPng(new Uint8Array(png));
      return { kind: 'img', obj: em, w: em.width, h: em.height };
    }
  } catch (e) {
    console.warn('Logo entreprise non embarquable :', e);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Préparation des faces (visuels + logos vectoriels)
// ---------------------------------------------------------------------------
async function prepareFaces(article, product, dpi, jpegQ) {
  const included = FACE_ORDER.filter(k => article.faces[k]?.included);
  const { V_TOP } = gridFor(article);
  const boxHIn = (PH - V_TOP - V_BOTTOM) / 72;
  // Toutes les faces sur une seule page. La mise en page finale dépend des
  // ratios (hauteur commune, cf. faceLayout) — inconnus tant que le visuel
  // n'est pas chargé ; on borne donc la résolution avec une largeur de colonne
  // égalitaire (proxy) et la hauteur de zone, qui domine pour du textile.
  const boxWIn = evenColWidth(included.length) / 72;
  const maxDim = Math.ceil(Math.max(boxWIn, boxHIn) * dpi);
  const faces = [];
  for (let i = 0; i < included.length; i++) {
    const key = included[i];
    // `cache: false` : ces visuels sont en pleine résolution et ne servent qu'une
    // fois — les retenir évincerait tout ce que l'éditeur a composé.
    const vis = await faceVisual(product, article.colorSlug, key, { maxDim, cache: false, jpegQ });
    if (!vis) continue;
    // L'ouvrier rend le JPEG déjà encodé. Le repli — pas d'ouvrier disponible —
    // passe par le canvas, comme avant : même image, même qualité.
    const jpgBytes = vis.jpeg
      || new Uint8Array(await (await new Promise(r => vis.canvas.toBlob(r, 'image/jpeg', jpegQ))).arrayBuffer());
    faces.push({ key, label: FACES[key].label, vis, jpgBytes, logos: article.faces[key].logos });
  }
  return faces;
}

// Prépare (et met en cache) les octets de chaque logo, recolorés si besoin.
// Un logo vectoriel reste du PDF ; une image reste une image (cf. logoasset.js).
async function logoAssetFor(logo, cache) {
  const k = logo.logoFile + '|' + (logo.color || '');
  if (cache.has(k)) return cache.get(k);
  const type = logo.logoType || 'pdf';
  const raw = await store.readLogoFile(logo.logoFile, type);
  if (!raw) throw new Error(`Fichier du logo « ${logo.name || logo.logoFile} » introuvable.`);
  const bytes = new Uint8Array(raw);
  const asset = logo.color ? await recolorLogo(bytes, type, logo.color) : { bytes, type };
  cache.set(k, asset);
  return asset;
}

// Embarque un logo dans le document et renvoie de quoi le poser :
// { kind, obj, width, height }. Le PDF entre en VECTORIEL (drawPage), une image
// en objet image (drawImage) — mêmes repères d'ancrage et de rotation dans les
// deux cas (cf. operations.drawImage/drawPage de pdf-lib).
async function embedLogo(doc, asset) {
  if (asset.type === 'pdf') {
    const [p] = await doc.embedPdf(asset.bytes);
    return { kind: 'pdf', obj: p, width: p.width, height: p.height };
  }
  const img = asset.type === 'jpg' ? await doc.embedJpg(asset.bytes) : await doc.embedPng(asset.bytes);
  return { kind: 'img', obj: img, width: img.width, height: img.height };
}

// ---------------------------------------------------------------------------
// Rendu d'une page BAT
// ---------------------------------------------------------------------------
async function renderPage(doc, F, faces, ctxInfo) {
  const { project, article, product, color, companyLogo, embedCache, mentionsLines, mentionsSize, identityLine } = ctxInfo;
  const page = doc.addPage([PW, PH]);
  // Fond de feuille #f4f4f2 (jamais blanc pur) — identique à l'aperçu écran
  // (.bat-page). Dessiné en premier, sous tout le contenu.
  page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: pdfRgb(HEX.SHEET) });
  const { BUB_HEAD, ID, TBL, labelW, sizeW, totalW, TBL_HEAD_H, V_TOP } = gridFor(article);

  // ---- Bandeau : UNE carte Material unifiée (identité + grille commande/
  // marquage empilées, séparées par un filet — entête unifiée façon Google).
  drawBubble(page, BUB_HEAD, { r: G_RADIUS, fill: G_BG, border: G_BORDER, borderWidth: 1 });
  hline(page, ID.x, ID.x + ID.w, PH - (ID.top + ID.h), G_BORDER, 0.8);

  // ---- Section identité : logo + client / projet / date + BON À TIRER + version
  const idMidY = PH - ID.top - ID.h / 2;   // centre vertical de la section
  const lx = ID.x + BUB_PAD + 4;
  let logoRight;
  if (companyLogo) {
    const s = Math.min(110 / companyLogo.w, 22 / companyLogo.h);
    const w = companyLogo.w * s, h = companyLogo.h * s;
    const ly = idMidY - h / 2;
    if (companyLogo.kind === 'pdf') page.drawPage(companyLogo.obj, { x: lx, y: ly, xScale: s, yScale: s });
    else page.drawImage(companyLogo.obj, { x: lx, y: ly, width: w, height: h });
    logoRight = lx + w + 18;
  } else {
    // Logo de marque OLDA en vectoriel (drawSvgPath : anchor SVG (0,0) → page).
    const s = OLDA_H / OLDA_VIEWBOX.h;
    const xA = lx - OLDA_VIEWBOX.minX * s;
    const yA = idMidY + OLDA_H / 2 + OLDA_VIEWBOX.minY * s;   // haut du viewBox centré
    for (const d of OLDA_PATHS) page.drawSvgPath(d, { x: xA, y: yA, scale: s, color: G_INK });
    logoRight = lx + OLDA_VIEWBOX.w * s + 18;
  }

  // BON À TIRER, calé à droite dans la bulle et centré verticalement dans la
  // bande identité. On mesure sa largeur pour borner à sa gauche les colonnes
  // de métadonnées. (trackedWidth exclut la gouttière finale → libellé flush.)
  const rx = ID.x + ID.w - BUB_PAD - 4;
  const batLabel = 'BON À TIRER';
  const rightW = trackedWidth(batLabel, F.gBold, 13, 0.24);
  drawTracked(page, batLabel, rx - rightW, idMidY - 4.6, { font: F.gBold, size: 13, color: G_INK, tracking: 0.24 });

  // ---- Métadonnées : les colonnes de META_COLS réparties dans l'espace libre
  // entre le logo et le bloc de droite (label au-dessus, valeur en dessous —
  // même structure que les cases de l'écran).
  const meta = [
    ['DESTINATAIRE', project.client || '—'],
    ['PROJET', project.name || '—'],
    ['COULEUR', articleCouleur(article, color) || '—'],
    ['RÉF. PRODUIT', articleRef(article, product) || '—'],
  ];
  const metaLeft = logoRight;
  const metaRight = rx - rightW - 14;
  const colGap = 8;
  // Largeurs au prorata de META_COLS (mêmes poids que l'écran) : CLIENT et
  // PROJET, à texte libre, cessent d'être tronqués par fitText au profit des
  // colonnes dont le contenu est de longueur fixe.
  const metaAvail = metaRight - metaLeft - colGap * (meta.length - 1);
  let mcx = metaLeft;
  for (const [label, value] of meta) {
    const flex = META_COLS.find(c => c.label === label)?.flex ?? 1;
    const colW = Math.max(20, (metaAvail * flex) / META_FLEX_SUM);
    drawTracked(page, label, mcx, idMidY + 2.2, { font: F.gMedium, size: 5.8, color: G_FAINT, tracking: 0.12 });
    const val = fitValue(value, F.gBold, 9, colW);
    page.drawText(val.text, { x: mcx, y: idMidY - 6.4, size: val.size, font: F.gBold, color: G_INK });
    mcx += colW + colGap;
  }

  // ---- Visuels : toutes les faces incluses côte à côte sur la même feuille
  // (1 à 4 colonnes), toutes à la MÊME hauteur (faceLayout) pour un alignement
  // visuel parfait entre vues de face et vues de côté.
  const zoneH = PH - V_TOP - V_BOTTOM;
  const boxes = faceLayout(faces.map(f => f.vis.width / f.vis.height), zoneH);

  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    const box = boxes[i];
    const jpg = await doc.embedJpg(face.jpgBytes);
    const s = Math.min(box.w / face.vis.width, box.h / face.vis.height);
    const mw = face.vis.width * s, mh = face.vis.height * s;
    const mx = box.x + (box.w - mw) / 2;
    const my = V_BOTTOM + (zoneH - mh) / 2;
    page.drawImage(jpg, { x: mx, y: my, width: mw, height: mh });

    // Découpe au rectangle du mockup : reproduit fidèlement le rognage écran —
    // un logo débordant du visuel est coupé net, jamais dessiné dans l'espace
    // inter-visuels ni sur la face voisine (contrat « l'app EST le PDF »).
    if (face.logos.length) {
      page.pushOperators(
        pushGraphicsState(),
        moveTo(mx, my), lineTo(mx + mw, my), lineTo(mx + mw, my + mh), lineTo(mx, my + mh),
        closePath(), clip(), endPath(),
      );
      for (const logo of face.logos) {
        const k = logo.logoFile + '|' + (logo.color || '');
        let emb = embedCache.get(k);
        if (!emb) {
          emb = await embedLogo(doc, await logoAssetFor(logo, ctxInfo.recolorCache));
          embedCache.set(k, emb);
        }
        const wPt = logo.widthCm * face.vis.pxPerCm * s;
        const hPt = (logo.heightCm || logo.widthCm * (emb.height / emb.width)) * face.vis.pxPerCm * s;
        const cx = mx + (logo.xPct / 100) * mw;
        const cy = my + mh - (logo.yPct / 100) * mh;
        const th = deg2rad(-(logo.rotation || 0)); // écran (horaire) → PDF (anti-horaire)
        const ax = cx - ((wPt / 2) * Math.cos(th) - (hPt / 2) * Math.sin(th));
        const ay = cy - ((wPt / 2) * Math.sin(th) + (hPt / 2) * Math.cos(th));
        const rotate = degrees(-(logo.rotation || 0));
        if (emb.kind === 'pdf') {
          page.drawPage(emb.obj, { x: ax, y: ay, xScale: wPt / emb.width, yScale: hPt / emb.height, rotate });
        } else {
          page.drawImage(emb.obj, { x: ax, y: ay, width: wPt, height: hPt, rotate });
        }
      }
      page.pushOperators(popGraphicsState());
    }
  }

  // ---- Bulle 2 : grille fusionnée (Taille | Qté | un emplacement par logo)
  drawGrid(page, F, {
    x: TBL.x, yTop: PH - TBL.top,
    labelW, sizeW, totalW, headH: TBL_HEAD_H,
    sizes: servedSizes(article), placements: article.placements || [],
    faceLabels: facesByLogoId(article),
  });

  // ---- Pied de page : mentions légales + identité
  const footTop = 30 + mentionsLines.length * (mentionsSize + 1.6) + 10;
  hline(page, M, PW - M, footTop, HAIR, 0.6);
  let fy = footTop - 9;
  for (const ln of mentionsLines) {
    page.drawText(ln, { x: M, y: fy, size: mentionsSize, font: F.regular, color: FAINT });
    fy -= mentionsSize + 1.6;
  }
  // Identité sur une seule ligne, centrée sur la page (taille auto-réduite
  // pour tenir entre les marges, en laissant la place du numéro de page).
  let idSize = 6.4;
  const idMaxW = PW - 2 * M - 40;
  while (idSize > 4.6 && F.medium.widthOfTextAtSize(identityLine, idSize) > idMaxW) idSize -= 0.2;
  const idW = F.medium.widthOfTextAtSize(identityLine, idSize);
  page.drawText(identityLine, { x: PW / 2 - idW / 2, y: 14, size: idSize, font: F.medium, color: GREY });
  // « n / N » dès qu'il y a plusieurs articles — même libellé que l'écran
  // (batpage.js), pour qu'une page isolée dise à quel document elle appartient.
  const total = project.articles.length;
  const pageNum = total > 1 ? `${doc.getPageCount()} / ${total}` : `${doc.getPageCount()}`;
  page.drawText(pageNum, { x: PW - M - F.regular.widthOfTextAtSize(pageNum, 6.4), y: 14, size: 6.4, font: F.regular, color: FAINT });
}

// ---------------------------------------------------------------------------
// API : génération complète avec garantie de poids (≤ 3 Mo)
// ---------------------------------------------------------------------------
export async function generateBAT(project, { onProgress } = {}) {
  const articles = project.articles || [];
  if (!articles.length) throw new Error('Ce projet ne contient aucun article.');
  // Vêtements résolus d'emblée : un article dont le produit a disparu du
  // catalogue doit arrêter l'export AVANT la composition, pas au milieu.
  const garments = articles.map((article) => {
    const product = store.product(article.productId);
    if (!product) throw new Error('Produit introuvable dans le catalogue.');
    return { article, product, color: product.colors.find(c => c.slug === article.colorSlug) };
  });
  const cfg = store.settings.pdf;
  const tiers = [
    { dpi: cfg.targetDpi || 200, q: cfg.jpegQuality || 0.85 },
    { dpi: 180, q: 0.78 }, { dpi: 160, q: 0.7 }, { dpi: 140, q: 0.62 }, { dpi: 120, q: 0.55 },
  ];

  // fontkit n'existe que pour l'export : on le fait venir ICI, une fois, avant
  // la boucle des paliers de qualité (il serait sinon redemandé à chaque tour).
  const fontkit = await loadFontkit();
  const fb = await loadFontBytes();
  // Le projet embarqué (cf. batfile.js) est identique quel que soit le palier
  // de qualité : calculé une fois, réutilisé — sinon les logos seraient relus
  // et ré-encodés à chaque tentative.
  onProgress?.('Projet embarqué dans le PDF…');
  const projectAttachment = await buildProjectAttachment(project);
  let lastBytes = null, lastTier = null;

  for (const tier of tiers) {
    onProgress?.(`Composition (${tier.dpi} dpi)…`);
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const F = {
      regular: await doc.embedFont(fb.regular, { subset: true }),
      medium: await doc.embedFont(fb.medium, { subset: true }),
      gRegular: await doc.embedFont(fb.gRegular, { subset: true }),
      gMedium: await doc.embedFont(fb.gMedium, { subset: true }),
      gBold: await doc.embedFont(fb.gBold, { subset: true }),
      gMono: await doc.embedFont(fb.gMono, { subset: true }),
    };

    const c = store.settings.company;
    const mentions = fillTemplate(store.settings.mentions, companyMentionVars(c));
    let mentionsSize = 5.2;
    let mentionsLines = wrap(mentions, F.regular, mentionsSize, PW - 2 * M);
    if (mentionsLines.length > 4) { mentionsSize = 4.8; mentionsLines = wrap(mentions, F.regular, mentionsSize, PW - 2 * M); }
    const identityLine = companyIdentityLine(c);

    const companyLogo = await embedCompanyLogo(doc);
    // Caches partagés par TOUTES les pages : un même logo posé sur plusieurs
    // articles n'est embarqué (ni recoloré) qu'une fois — deux pochettes et
    // trois t-shirts au même marquage ne pèsent pas cinq fois le logo.
    const embedCache = new Map(), recolorCache = new Map();

    doc.setTitle(`BAT ${project.client} — ${project.name} — v${project.fiche.version}`);
    doc.setAuthor(c.name || 'BAT Studio');
    doc.setProducer('BAT Studio');
    doc.setCreator('BAT Studio');

    // UNE page par article, dans l'ordre des onglets de l'éditeur ; chaque page
    // porte toutes les faces incluses de son article, côte à côte.
    for (let i = 0; i < garments.length; i++) {
      const { article, product, color } = garments[i];
      const faces = await prepareFaces(article, product, tier.dpi, tier.q);
      if (!faces.length) throw new Error(`Aucune face sélectionnée pour l'article ${i + 1} du BAT.`);
      onProgress?.(garments.length > 1
        ? `Article ${i + 1}/${garments.length} — ${product.name}…`
        : `Page « ${faces.map(f => f.label).join(' + ')} »…`);
      await renderPage(doc, F, faces, {
        project, article, product, color, companyLogo,
        embedCache, recolorCache,
        mentionsLines, mentionsSize, identityLine,
      });
    }

    // Le projet voyage DANS le PDF : le fichier remis au client est aussi le
    // fichier de travail, rouvrable et modifiable (cf. batfile.js).
    await attachProjectBytes(doc, projectAttachment);

    const bytes = await doc.save();
    lastBytes = bytes; lastTier = tier;
    const max = cfg.maxBytes || 3 * 1024 * 1024;
    if (bytes.length <= max) break;
    // Le document SEUL tient dans le budget : c'est le projet embarqué qui le
    // fait déborder. Dégrader les mockups n'y changerait rien (la pièce jointe
    // ne rétrécit pas) et sacrifierait la qualité d'aperçu pour rien — quatre
    // recompositions complètes en pure perte.
    if (bytes.length - projectAttachment.length <= max) break;
  }

  const fileName = projectFileName(project);
  return { bytes: lastBytes, fileName, size: lastBytes.length, tier: lastTier };
}
