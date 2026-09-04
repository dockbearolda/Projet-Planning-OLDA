// Recherche de produit : trouver un vêtement à partir de ce qu'on tape, quelle
// que soit la façon dont on le tape.
//
// À l'atelier, une référence s'écrit de six façons pour le même vêtement :
// « NS300 », « ns 300 », « ns-300 », « n300 » quand la main a glissé, « 300 »
// quand on ne se souvient que du numéro, « ns » quand on cherche la famille.
// Une recherche par sous-chaîne n'en attrape que trois. Celle-ci les attrape
// toutes, et surtout elle les CLASSE : « NS300 » tapé en entier doit sortir
// NS300 en premier, pas NS3001.
//
// LE SQUELETTE FAIT LE GROS DU TRAVAIL. On retire accents, espaces, tirets et
// points : « H-001 » et « h001 » deviennent la même chaîne. Toute la
// ponctuation des références disparaît, et avec elle la moitié des façons de
// se tromper.
export const sansAccents = (v) =>
  String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const squelette = (v) => sansAccents(v).replace(/[^a-z0-9]/g, '');

// LA SOUS-SÉQUENCE, RÉSERVÉE AUX RÉFÉRENCES. « n300 » se retrouve dans
// « ns300 » : les quatre caractères y sont, dans l'ordre, avec un trou. C'est
// ce qui rattrape la lettre oubliée et la faute de frappe par omission.
// On ne l'applique JAMAIS à un nom de produit : « ns » se retrouverait dans
// « maNcheS longues » et la recherche ramènerait tout le catalogue.
// `trous` compte les caractères sautés — il départage deux références qui
// contiennent toutes deux la requête en pointillé.
function sousSequence(chaine, q) {
  let i = 0, trous = 0, debut = -1;
  for (const c of q) {
    const k = chaine.indexOf(c, i);
    if (k < 0) return null;
    if (debut < 0) debut = k;
    if (i > 0) trous += k - i;
    i = k + 1;
  }
  return { trous, debut };
}

// Score d'un CHAMP DE RÉFÉRENCE face à une requête. Du plus sûr au plus flou —
// et l'écart entre les paliers est large exprès : une correspondance exacte ne
// doit jamais passer derrière un début de chaîne, quel que soit le bonus.
function scoreRef(ref, q) {
  const s = squelette(ref);
  if (!s || !q) return 0;
  if (s === q) return 1000;
  if (s.startsWith(q)) return 900 - Math.min(99, s.length - q.length);
  if (s.includes(q)) return 700 - Math.min(99, s.length - q.length);
  const sub = sousSequence(s, q);
  if (sub) return 500 - Math.min(199, sub.trous * 10 + sub.debut);
  return 0;
}

// Score d'un CHAMP DE TEXTE (désignation, type, famille). Pas de sous-séquence
// ici, et un mot qui COMMENCE par la requête vaut mieux qu'un mot qui la
// contient : « sweat » doit sortir les sweats avant les « molletonné sweat ».
function scoreTexte(texte, q) {
  const s = squelette(texte);
  if (!s || !q) return 0;
  if (s.startsWith(q)) return 400;
  if (s.includes(q)) return 250;
  const mots = sansAccents(texte).split(/[^a-z0-9]+/).filter(Boolean);
  if (mots.some((m) => m.startsWith(q))) return 300;
  return 0;
}

// Score d'un produit pour UN mot de la requête. Les références comptent plus
// que la désignation : on cherche un vêtement par sa référence, on le
// reconnaît par son nom.
function scoreMot(p, q) {
  return Math.max(
    scoreRef(p?.refSupplier, q),
    scoreRef(p?.refInternal, q) - 5,   // départage à égalité : la réf fournisseur d'abord
    scoreTexte(p?.name, q),
    scoreTexte(p?.type, q),
    scoreTexte(p?.category, q),
  );
}

// Score d'un produit pour la requête ENTIÈRE.
// Deux lectures, et on garde la meilleure :
//   — la requête telle quelle, ponctuation ôtée (« ns 300 » → « ns300 ») ;
//   — mot à mot, où CHAQUE mot doit trouver preneur (« sweat noir » ne doit
//     pas ramener tous les sweats).
// La première lecture est ce qui fait marcher « ns 300 » et « h 001 ».
export function scoreProduit(p, requete) {
  const brut = squelette(requete);
  if (!brut) return 0;
  const entier = scoreMot(p, brut);

  const mots = sansAccents(requete).split(/\s+/).map(squelette).filter(Boolean);
  let somme = 0;
  if (mots.length > 1) {
    for (const m of mots) {
      const s = scoreMot(p, m);
      if (!s) { somme = 0; break; }
      somme += s;
    }
    somme = Math.round(somme / mots.length);
  }
  return Math.max(entier, somme);
}

// Les produits qui correspondent, du meilleur au moins bon. Requête vide : tout
// le catalogue, dans son ordre d'origine — c'est la liste de départ, pas un
// résultat de recherche.
export function chercherProduits(produits, requete) {
  const liste = Array.isArray(produits) ? produits : [];
  if (!squelette(requete)) return [...liste];
  return liste
    .map((p, rang) => ({ p, score: scoreProduit(p, requete), rang }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.rang - b.rang)
    .map((x) => x.p);
}

// LA REQUÊTE RESSEMBLE-T-ELLE À UNE RÉFÉRENCE À IMPORTER ? Une référence
// TopTex mêle lettres et chiffres (« NS333 », « K3022IC », « CGTM072 ») et fait
// au moins quatre caractères. « sweat » n'en est pas une, « 300 » non plus —
// proposer un import sur ces mots-là mettrait une commande de téléchargement
// sous chaque frappe.
export function ressembleAUneReference(requete) {
  const s = squelette(requete);
  return s.length >= 4 && /[a-z]/.test(s) && /[0-9]/.test(s);
}
