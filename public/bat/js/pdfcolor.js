// Analyse et recoloration VECTORIELLE de logos PDF.
//
// Principe : on lit les content streams de la page 1 (et de ses Form XObjects),
// on répertorie les couleurs réellement utilisées par les opérateurs de peinture,
// et — pour la recoloration — on réécrit les opérateurs de couleur
// (rg/g/k/sc/scn/cs et leurs variantes contour) vers la couleur cible en
// DeviceRGB. Aucune rastérisation : les tracés restent des vecteurs.

import { PDFLib, pako } from './vendor.js';

const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFRef, PDFNumber } = PDFLib;

// ---------------------------------------------------------------------------
// Décodage / encodage de streams
// ---------------------------------------------------------------------------

function filterNames(dict) {
  const f = dict.lookup(PDFName.of('Filter'));
  if (!f) return [];
  if (f instanceof PDFName) return [f.decodeText ? f.decodeText() : f.asString()];
  if (f instanceof PDFArray) {
    const out = [];
    for (let i = 0; i < f.size(); i++) {
      const n = f.lookup(i);
      if (n instanceof PDFName) out.push(n.asString());
    }
    return out;
  }
  return [];
}

function decodeStream(stream) {
  const raw = stream.getContents ? stream.getContents() : stream.contents;
  const names = filterNames(stream.dict);
  if (names.length === 0) return raw;
  if (names.length === 1 && (names[0] === '/FlateDecode' || names[0] === 'FlateDecode')) {
    const parms = stream.dict.lookup(PDFName.of('DecodeParms'));
    if (parms) {
      const pd = parms instanceof PDFArray ? parms.lookup(0) : parms;
      if (pd instanceof PDFDict) {
        const pred = pd.lookup(PDFName.of('Predictor'));
        if (pred && pred.asNumber && pred.asNumber() > 1) {
          throw new Error('Flux PDF avec prédicteur non géré.');
        }
      }
    }
    return pako.inflate(raw);
  }
  throw new Error('Filtre de flux PDF non géré : ' + names.join(','));
}

// ---------------------------------------------------------------------------
// Tokenizer de content stream
// ---------------------------------------------------------------------------

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%'].map(c => c.charCodeAt(0)));

function isRegular(b) { return !WS.has(b) && !DELIM.has(b); }

// Décodage octet→code point 1:1 (latin1 brut), par blocs : String.fromCharCode
// avec spread dépasse la limite d'arguments du moteur sur un gros token (image
// inline BI/ID/EI, longue chaîne) → RangeError, qui faisait rejeter un logo
// pourtant valide. Le découpage en blocs de 32 Ko l'évite.
function latin1Slice(u8, a, b) {
  let out = '';
  for (let i = a; i < b; i += 0x8000) {
    out += String.fromCharCode.apply(null, u8.subarray(i, Math.min(b, i + 0x8000)));
  }
  return out;
}

// Ré-encodage 1:1 code point→octet (latin1). TextEncoder produirait de l'UTF-8
// et corromprait tout octet ≥ 128 conservé (chaînes de texte accentué d'un
// wordmark) → flux recoloré invalide.
function latin1Bytes(str) {
  const u8 = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) u8[i] = str.charCodeAt(i) & 0xff;
  return u8;
}

// Découpe le flux en tokens { t: 'num'|'name'|'str'|'op'|'arrOpen'|... , v, raw }
function tokenize(bytes) {
  const toks = [];
  let i = 0;
  const n = bytes.length;
  const s = (a, b) => latin1Slice(bytes, a, b);

  while (i < n) {
    const b = bytes[i];
    if (WS.has(b)) { i++; continue; }

    if (b === 0x25) { // % commentaire
      while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
      continue;
    }
    if (b === 0x2f) { // /Name
      let j = i + 1;
      while (j < n && isRegular(bytes[j])) j++;
      toks.push({ t: 'name', v: s(i, j) });
      i = j; continue;
    }
    if (b === 0x28) { // (string)
      let j = i + 1, depth = 1;
      while (j < n && depth > 0) {
        const c = bytes[j];
        if (c === 0x5c) j++; // échappement
        else if (c === 0x28) depth++;
        else if (c === 0x29) depth--;
        j++;
      }
      toks.push({ t: 'str', v: s(i, j) });
      i = j; continue;
    }
    if (b === 0x3c) { // << ou <hex>
      if (bytes[i + 1] === 0x3c) { toks.push({ t: 'dictOpen', v: '<<' }); i += 2; continue; }
      let j = i + 1;
      while (j < n && bytes[j] !== 0x3e) j++;
      toks.push({ t: 'str', v: s(i, j + 1) });
      i = j + 1; continue;
    }
    if (b === 0x3e && bytes[i + 1] === 0x3e) { toks.push({ t: 'dictClose', v: '>>' }); i += 2; continue; }
    if (b === 0x5b) { toks.push({ t: 'arrOpen', v: '[' }); i++; continue; }
    if (b === 0x5d) { toks.push({ t: 'arrClose', v: ']' }); i++; continue; }
    if (b === 0x7b) { toks.push({ t: 'op', v: '{' }); i++; continue; }
    if (b === 0x7d) { toks.push({ t: 'op', v: '}' }); i++; continue; }

    // nombre ou opérateur
    let j = i;
    while (j < n && isRegular(bytes[j])) j++;
    const w = s(i, j);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) toks.push({ t: 'num', v: parseFloat(w) });
    else toks.push({ t: 'op', v: w });
    i = j;

    // Image inline : BI ... ID <binaire> EI — on saute le binaire.
    if (w === 'ID') {
      let k = i + 1; // un espace après ID
      while (k < n - 1) {
        if (WS.has(bytes[k]) && bytes[k + 1] === 0x45 && bytes[k + 2] === 0x49 &&
            (k + 3 >= n || WS.has(bytes[k + 3]) || DELIM.has(bytes[k + 3]))) break;
        k++;
      }
      toks.push({ t: 'inlineData', v: s(i, k) });
      toks.push({ t: 'op', v: 'EI' });
      i = k + 3;
    }
  }
  return toks;
}

// ---------------------------------------------------------------------------
// Conversions couleur
// ---------------------------------------------------------------------------

function cmykToRgb(c, m, y, k) {
  return [(1 - Math.min(1, c + k)), (1 - Math.min(1, m + k)), (1 - Math.min(1, y + k))];
}

function toHex(rgb) {
  const h = (x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
  return '#' + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
}

function operandsToRgb(nums) {
  if (nums.length === 1) return [nums[0], nums[0], nums[0]];
  if (nums.length === 3) return nums.slice();
  if (nums.length === 4) return cmykToRgb(...nums);
  return null;
}

const FILL_OPS = new Set(['f', 'F', 'f*', 'b', 'b*', 'B', 'B*']);
const STROKE_OPS = new Set(['S', 's', 'b', 'b*', 'B', 'B*']);
const TEXT_SHOW = new Set(['Tj', 'TJ', "'", '"']);
// Les opérandes sc/scn se convertissent en RGB par leur seul nombre (1=gris,
// 3=rgb, 4=cmyk) pour les espaces Device / Cal / ICCBased — ce dernier étant le
// cas MAJORITAIRE des logos vectoriels Adobe. SEULS les espaces ci-dessous, où
// l'opérande est une teinte ou un index (pas une composante directe), doivent
// être marqués « inconnu » : « 1 scn » y vaut 100 % d'encre spot, pas du gris.
const NONCONVERTIBLE_SPACES = new Set(['Separation', 'DeviceN', 'Indexed', 'Pattern']);
const DEVICE_LITERALS = new Set(['/DeviceRGB', '/DeviceGray', '/DeviceCMYK', '/Pattern']);

// Type réel d'un espace colorimétrique (valeur de /ColorSpace) : nom direct
// (/DeviceRGB) ou 1er élément d'un tableau ([/ICCBased …], [/Separation …]).
function colorSpaceType(val, ctx) {
  const v = val instanceof PDFRef ? ctx.lookup(val) : val;
  if (v instanceof PDFName) return v.asString().replace('/', '');
  if (v instanceof PDFArray && v.size()) {
    const head = v.lookup(0);
    if (head instanceof PDFName) return head.asString().replace('/', '');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Passe d'analyse / réécriture sur UN content stream
// ---------------------------------------------------------------------------

function fmt(x) {
  const r = Math.round(x * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
}

// mode 'analyze' : remplit report. mode 'recolor' : retourne le flux réécrit.
function processTokens(toks, mode, target, report, xobjectInfo, colorSpaceInfo, injectDefaultColor) {
  const out = [];
  let operands = []; // tokens en attente (opérandes)
  const st = {
    fill: { rgb: [0, 0, 0], known: true, space: null },
    stroke: { rgb: [0, 0, 0], known: true, space: null },
  };
  const stack = [];

  const pushUsed = (which) => {
    const c = st[which];
    report.used.add(c.known ? toHex(c.rgb) : 'inconnu');
  };
  const flushOperands = () => { for (const t of operands) out.push(t); operands = []; };
  const emit = (str) => out.push({ t: 'raw', v: str });

  for (let idx = 0; idx < toks.length; idx++) {
    const tok = toks[idx];
    if (tok.t !== 'op') { operands.push(tok); continue; }
    const op = tok.v;

    const nums = operands.filter(t => t.t === 'num').map(t => t.v);
    const lastName = [...operands].reverse().find(t => t.t === 'name');

    let handled = false;
    const isSCN = (op === 'sc' || op === 'scn' || op === 'SC' || op === 'SCN');
    if (op === 'rg' || op === 'RG' || op === 'g' || op === 'G' || op === 'k' || op === 'K' || isSCN) {
      const isFill = op === op.toLowerCase();
      const which = isFill ? 'fill' : 'stroke';
      if (isSCN && lastName) {
        report.hasPattern = true;         // teinte via Pattern/Separation nommé
        st[which] = { ...st[which], known: false };
      } else if (isSCN && st[which].space && NONCONVERTIBLE_SPACES.has(st[which].space)) {
        st[which] = { ...st[which], known: false }; // teinte/index (Separation/DeviceN/Indexed) non convertible
      } else {
        const rgb = operandsToRgb(nums);
        // rg/g/k fixent implicitement un espace Device (space := null) ; sc/scn
        // conservent l'espace courant.
        if (rgb) st[which] = { ...st[which], rgb, known: true, space: isSCN ? st[which].space : null };
        else { st[which] = { ...st[which], known: false }; report.oddColor = true; }
      }
      if (mode === 'recolor') {
        operands = [];
        emit(`${fmt(target[0])} ${fmt(target[1])} ${fmt(target[2])} ${isFill ? 'rg' : 'RG'}`);
        handled = true;
      }
    } else if (op === 'cs' || op === 'CS') {
      const which = op === 'cs' ? 'fill' : 'stroke';
      // Résout l'alias (/Cs1) ou le littéral (/DeviceRGB) vers le TYPE réel via
      // les Resources → distingue ICCBased (convertible) de Separation (teinte).
      let type = null;
      if (lastName) {
        type = DEVICE_LITERALS.has(lastName.v)
          ? lastName.v.slice(1)
          : (colorSpaceInfo?.get(lastName.v.slice(1)) ?? null);
      }
      st[which] = { ...st[which], space: type, known: false };
      if (mode === 'recolor') {
        operands = [];
        emit(`/DeviceRGB ${op}`);
        handled = true;
      }
    } else if (op === 'sh') {
      report.hasShading = true;
    } else if (op === 'BI') {
      report.hasImage = true;
    } else if (op === 'Do') {
      const nm = lastName ? lastName.v : null;
      if (nm && xobjectInfo) {
        const info = xobjectInfo.get(nm.slice(1));
        if (info === 'image') report.hasImage = true;
        if (info === 'form') report.forms.add(nm.slice(1));
      }
    } else if (op === 'q') {
      stack.push(JSON.parse(JSON.stringify(st)));
    } else if (op === 'Q') {
      const prev = stack.pop();
      if (prev) { st.fill = prev.fill; st.stroke = prev.stroke; }
    } else if (FILL_OPS.has(op) || STROKE_OPS.has(op) || TEXT_SHOW.has(op)) {
      if (FILL_OPS.has(op) || TEXT_SHOW.has(op)) pushUsed('fill');
      if (STROKE_OPS.has(op)) pushUsed('stroke');
    }

    if (!handled) { flushOperands(); out.push(tok); }
  }
  flushOperands();

  if (mode !== 'recolor') return null;

  // Re-sérialisation. On force la couleur initiale de l'état graphique à la
  // cible UNIQUEMENT en tête du PREMIER flux de page (niveau description, où les
  // opérateurs couleur sont toujours légaux) : un logo peignant avec la couleur
  // PAR DÉFAUT (noir) sans jamais émettre d'opérateur couleur est ainsi recoloré,
  // et les Form XObjects en héritent. On n'injecte JAMAIS dans un flux suivant
  // d'un tableau /Contents (il peut commencer au milieu d'un tracé → PDF invalide).
  const parts = [];
  if (injectDefaultColor) {
    const t0 = `${fmt(target[0])} ${fmt(target[1])} ${fmt(target[2])}`;
    parts.push(`${t0} rg`, `${t0} RG`);
  }
  for (const t of out) {
    if (t.t === 'raw') parts.push(t.v);
    else if (t.t === 'num') parts.push(fmt(t.v));
    else if (t.t === 'name' || t.t === 'str' || t.t === 'op' ||
             t.t === 'dictOpen' || t.t === 'dictClose' || t.t === 'arrOpen' || t.t === 'arrClose') parts.push(t.v);
    else if (t.t === 'inlineData') parts.push(t.v);
  }
  // latin1 (1:1), surtout PAS d'UTF-8 (corromprait les octets ≥ 128 conservés).
  return latin1Bytes(parts.join(' ') + '\n');
}

// ---------------------------------------------------------------------------
// Parcours de la page : Contents + Form XObjects (récursif)
// ---------------------------------------------------------------------------

function contentStreamRefs(pageNode, ctx) {
  const raw = pageNode.get(PDFName.of('Contents'));
  const refs = [];
  if (raw instanceof PDFRef) {
    const obj = ctx.lookup(raw);
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) refs.push(obj.get(i));
    } else refs.push(raw);
  } else if (raw instanceof PDFArray) {
    for (let i = 0; i < raw.size(); i++) refs.push(raw.get(i));
  }
  return refs.filter(r => r instanceof PDFRef);
}

// Retourne { xobjectInfo: Map(nom → 'image'|'form'), formRefs, colorSpaceInfo }
function resourcesInfo(resDict, ctx) {
  const xobjectInfo = new Map();
  const formRefs = new Map();
  const colorSpaceInfo = new Map(); // nom d'alias → type réel (ICCBased, Separation…)
  if (!resDict) return { xobjectInfo, formRefs, colorSpaceInfo };
  const xo = resDict.lookup(PDFName.of('XObject'));
  if (xo instanceof PDFDict) {
    for (const [key, val] of xo.entries()) {
      const name = key.asString().slice(1);
      const stream = val instanceof PDFRef ? ctx.lookup(val) : val;
      if (stream && stream.dict) {
        const sub = stream.dict.lookup(PDFName.of('Subtype'));
        const subName = sub instanceof PDFName ? sub.asString() : '';
        if (subName === '/Image') xobjectInfo.set(name, 'image');
        else if (subName === '/Form') {
          xobjectInfo.set(name, 'form');
          if (val instanceof PDFRef) formRefs.set(name, val);
        }
      }
    }
  }
  const csDict = resDict.lookup(PDFName.of('ColorSpace'));
  if (csDict instanceof PDFDict) {
    for (const [key, val] of csDict.entries()) {
      colorSpaceInfo.set(key.asString().slice(1), colorSpaceType(val, ctx));
    }
  }
  return { xobjectInfo, formRefs, colorSpaceInfo };
}

async function walkPage(bytes, mode, targetRgb) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const report = {
    pageCount: doc.getPageCount(),
    used: new Set(), hasImage: false, hasShading: false, hasPattern: false,
    oddColor: false, forms: new Set(),
  };
  const page = doc.getPage(0);
  const ctx = doc.context;

  const resDict = page.node.Resources ? page.node.Resources() : page.node.lookup(PDFName.of('Resources'), PDFDict);
  const seen = new Set();

  // File de streams à traiter : contents de page + forms récursifs
  const queue = [];
  for (const ref of contentStreamRefs(page.node, ctx)) queue.push({ ref, res: resDict, isForm: false });
  let firstStream = true; // le 1er flux dépilé est le 1er flux de description de page

  while (queue.length) {
    const { ref, res, isForm } = queue.shift();
    const tag = ref.objectNumber + '/' + ref.generationNumber;
    if (seen.has(tag)) continue;
    seen.add(tag);

    const stream = ctx.lookup(ref);
    if (!(stream instanceof PDFRawStream) && !(stream && stream.dict)) continue;

    let decoded;
    try { decoded = decodeStream(stream); }
    catch (e) { report.oddColor = true; continue; }

    const streamRes = isForm
      ? (stream.dict.lookup(PDFName.of('Resources')) instanceof PDFDict
          ? stream.dict.lookup(PDFName.of('Resources'))
          : (stream.dict.lookup(PDFName.of('Resources')) instanceof PDFRef
              ? ctx.lookup(stream.dict.lookup(PDFName.of('Resources')))
              : res))
      : res;

    const { xobjectInfo, formRefs, colorSpaceInfo } = resourcesInfo(streamRes, ctx);
    const toks = tokenize(decoded);
    const rewritten = processTokens(toks, mode, targetRgb, report, xobjectInfo, colorSpaceInfo, firstStream && !isForm);
    firstStream = false;

    // Empile les Form XObjects réellement utilisés
    for (const name of report.forms) {
      const fr = formRefs.get(name);
      if (fr) queue.push({ ref: fr, res: streamRes, isForm: true });
    }
    report.forms = new Set();

    if (mode === 'recolor' && rewritten) {
      const deflated = pako.deflate(rewritten);
      const newDict = ctx.obj({});
      for (const [k, v] of stream.dict.entries()) {
        const ks = k.asString();
        if (ks !== '/Filter' && ks !== '/DecodeParms' && ks !== '/Length') newDict.set(k, v);
      }
      newDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
      newDict.set(PDFName.of('Length'), PDFNumber.of(deflated.length));
      const newStream = PDFRawStream.of(newDict, deflated);
      ctx.assign(ref, newStream);
    }
  }

  return { doc, report };
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

// Analyse un logo PDF : nombre de pages, couleurs utilisées, monochrome ?
export async function analyzePdfLogo(bytes) {
  const { report } = await walkPage(bytes, 'analyze', null);
  const colors = [...report.used];
  const known = colors.filter(c => c !== 'inconnu');
  const monochrome = !report.hasImage && !report.hasShading && !report.hasPattern &&
    !report.oddColor && colors.length === 1 && known.length === 1;
  const warnings = [];
  if (report.pageCount > 1) warnings.push(`Le PDF contient ${report.pageCount} pages : seule la page 1 est utilisée.`);
  // `hasImage` reste exposé — il conditionne `monochrome`, donc la recoloration
  // par pastille — mais N'EST PLUS un avertissement : poser une photo sur un
  // vêtement est un usage normal, pas un défaut à signaler. Le seul reproche
  // utile à une image reste sa définition, et il est fait par analyzeLogo.
  return {
    pageCount: report.pageCount,
    monochrome,
    colors: known,
    hasImage: report.hasImage,
    hasShading: report.hasShading,
    hasPattern: report.hasPattern,
    warnings,
  };
}

// Recolore la page 1 d'un logo PDF monochrome vers une couleur hex.
// Retourne les octets du PDF recoloré (vectoriel).
export async function recolorPdfLogo(bytes, hex) {
  const v = String(hex).replace('#', '');
  const rgb = [
    parseInt(v.slice(0, 2), 16) / 255,
    parseInt(v.slice(2, 4), 16) / 255,
    parseInt(v.slice(4, 6), 16) / 255,
  ];
  const { doc } = await walkPage(bytes, 'recolor', rgb);
  return doc.save({ useObjectStreams: false });
}
