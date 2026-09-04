// Fonctions pures : normalisation d'un produit TopTex vers la forme BAT.
// Aucune dépendance (importable côté serveur ET client / tests Node).

export function guessProductType(designation) {
  const s = (designation || '').toLowerCase();
  if (s.includes('polo')) return 'Polo';
  if (s.includes('débardeur') || s.includes('debardeur') || s.includes('tank')) return 'Débardeur';
  if (s.includes('sweat')) return 'Sweat';
  if (s.includes('t-shirt') || s.includes('tee-shirt') || s.includes('tee shirt') || s.includes('tshirt')) return 'T-shirt';
  if (s.includes('tote') || s.includes('sac')) return 'Tote bag';
  if (s.includes('pochette') || s.includes('trousse')) return 'Pochette';
  return 'Autre';
}

// ---------------------------------------------------------------------------
// LE RAYON — homme, femme, enfant, bébé — DÉDUIT DE LA DÉSIGNATION.
// C'est lui qui décide des TAILLES : un t-shirt enfant se commande en
// « 2/4 ans »… « 12/14 ans », un body en « 3 mois »… « 36 mois », et jamais en
// XS…2XL. Le champ `category` du catalogue devrait le porter, mais il ne le
// porte pas toujours : un produit importé de TopTex y reçoit sa MARQUE
// (« Native Spirit »), et un produit saisi à la main peut n'avoir rien du tout.
// La désignation, elle, le dit toujours — c'est le mot que le fournisseur met
// en premier dans le nom de l'article.
//
// L'ORDRE COMPTE, du plus précis au plus large : « body bébé enfant » est un
// article de bébé, et le nom d'un vêtement femme contient rarement « homme »
// alors que l'inverse arrive (« coupe homme et femme »).
// Les bornes de mot ne sont pas décoratives : sans elles, « manches » donnerait
// « man » et tout le catalogue partirait en rayon homme.
const RAYONS = [
  ['BEBE', /\b(bebe|bebes|baby|babies|barboteuse|grenouillere|naissance)\b/],
  ['ENFANT', /\b(enfant|enfants|kid|kids|child|children|junior|juniors|garcon|garcons|fille|filles)\b/],
  ['FEMME', /\b(femme|femmes|woman|women|ladies|lady|feminin|feminine)\b/],
  ['HOMME', /\b(homme|hommes|man|men|mens|masculin|masculine)\b/],
  ['POCHETTE', /\b(pochette|pochettes|trousse|trousses)\b/],
];

// Renvoie null quand rien ne tranche — « unisexe » en particulier, qui ne dit
// pas le rayon mais dont les tailles sont celles de l'adulte, c'est-à-dire
// exactement le repli de l'appelant. Un null n'est donc pas un échec : c'est
// « rien à ajouter ».
export function guessSizeCategory(designation) {
  const s = String(designation ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [rayon, re] of RAYONS) if (re.test(s)) return rayon;
  return null;
}

// TopTex utilise « FACE CAP » (au lieu de « FACE ») pour la vue de face des
// casquettes — sans cet alias, la face principale disparaît silencieusement.
const PACKSHOT_VIEWS = { FACE: 'front', 'FACE CAP': 'front', BACK: 'back', SIDE: 'sleeve' };
export function mapPackshotView(key) {
  return PACKSHOT_VIEWS[String(key || '').toUpperCase()] || null;
}

export function hexClean(h) {
  if (!h) return null;
  return h.startsWith('#') ? h : '#' + h;
}

// Distance couleur (0 = identique) entre deux hex #rrggbb. Moyenne quadratique
// des écarts par canal — même métrique que la résolution de manche runtime.
// Le « # » de tête est optionnel.
function hexInt(h) {
  return parseInt(String(h || '').replace(/^#/, ''), 16) || 0;
}
export function colorDistance(a, b) {
  const pa = hexInt(a), pb = hexInt(b);
  const ra = (pa >> 16) & 255, ga = (pa >> 8) & 255, ba = pa & 255;
  const rb = (pb >> 16) & 255, gb = (pb >> 8) & 255, bb = pb & 255;
  return Math.sqrt(((ra - rb) ** 2 + (ga - gb) ** 2 + (ba - bb) ** 2) / 3);
}

function normLabel(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
}

// Apparie une couleur existante du catalogue à la couleur TopTex correspondante.
// 1) label normalisé identique (les deux sources viennent de TopTex → le nom de
//    coloris est la clé fiable et suffit pour ~toutes les couleurs) ;
// 2) sinon, repli hex STRICT : la plus proche, mais uniquement si TRÈS proche
//    (`maxHex`) ET sans ambiguïté (2e candidat nettement plus loin, `margin`).
//    Sans cette garde, une teinte à mi-chemin entre deux couleurs TopTex serait
//    appariée à la mauvaise (p. ex. un noir happé par un bleu marine) → on
//    préfère ne rien apparier (repli au rendu) plutôt que poser une manche
//    d'une autre teinte. Renvoie la couleur TopTex, ou null si rien de sûr.
// `target` = { hex, label } ; `toptexColors` = [{ label, hex, views }].
export function matchToptexColor(target, toptexColors, opts = {}) {
  const list = Array.isArray(toptexColors) ? toptexColors : [];
  const tl = normLabel(target?.label);
  if (tl) {
    const byLabel = list.find((c) => normLabel(c.label) === tl);
    if (byLabel) return byLabel;
  }
  // Repli hex quasi-exact seulement : en pratique les couleurs catalogue non
  // appariées par label le sont par un hex IDENTIQUE (import ancien en famille
  // générique « Gris/Rouge » → hex strictement égal à la couleur TopTex). Un
  // seuil serré (≈ bruit d'arrondi) capte ces cas et écarte toute ambiguïté.
  const maxHex = opts.maxHex ?? 3;
  const margin = opts.margin ?? 8;
  if (maxHex > 0 && list.length) {
    const sorted = list.map((c) => ({ c, d: colorDistance(target?.hex, c.hex) })).sort((a, b) => a.d - b.d);
    const [best, second] = sorted;
    if (best.d <= maxHex && (!second || second.d - best.d >= margin)) return best.c;
  }
  return null;
}

// raw = objet renvoyé par GET /v3/products?catalog_reference=…
export function normalizeToptexProduct(raw) {
  const name = raw.designation?.fr || raw.designation?.en || raw.catalogReference || '';
  const colors = (raw.colors || []).map((c) => {
    const views = {};
    for (const [k, v] of Object.entries(c.packshots || {})) {
      const view = mapPackshotView(k);
      if (view && v?.url) views[view] = v.url;
    }
    return {
      // Nom SPÉCIFIQUE du coloris (« Ash Heather », « Chocolate »…), stable et
      // identique dans toutes les langues — clé d'appariement fiable. On évite
      // `colorsDominant` (famille générique « Gris/Vert/Bleu », avec doublons)
      // qui rendait deux teintes distinctes indiscernables.
      label: c.colors?.fr || c.colors?.en || c.colorsDominant?.[0]?.fr || '',
      hex: hexClean(c.colorsHexa?.[0]) || '#cccccc',
      views,
    };
  }).filter((c) => Object.keys(c.views).length > 0);
  return {
    ref: raw.catalogReference || '',
    name,
    brand: raw.brand || '',
    type: guessProductType(name),
    colors,
  };
}

// Calibration plausible d'un OBJET photographié par un fournisseur (mug,
// gourde, casquette…), là où defaultCalibration ne connaît que des vêtements.
// `widthCm` = largeur réelle du sujet ; `widthPct` = la part de la largeur de
// l'image qu'il occupe sur un packshot typique (sujet centré, fond blanc).
//
// Renvoie null pour un type inconnu : l'appelant retombe alors sur son
// comportement d'origine. C'est ce qui garantit qu'aucun produit déjà au
// catalogue ne voit sa calibration bouger.
const OBJECT_DEFAULTS = {
  mug: { widthCm: 9.5, widthPct: 70 },
  gourde: { widthCm: 7, widthPct: 45 },
  casquette: { widthCm: 18, widthPct: 80 },
  parapluie: { widthCm: 25, widthPct: 75 },
  tapisdesouris: { widthCm: 22, widthPct: 85 },
};

export function objectDefaults(type) {
  const k = String(type ?? '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  const d = OBJECT_DEFAULTS[k];
  return d ? { ...d } : null;
}
