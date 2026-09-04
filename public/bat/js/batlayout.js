// Constantes de mise en page du Bon À Tirer (points PDF, 1 pt = 1 px écran).
// Partagées entre l'écran d'édition WYSIWYG (batpage.js) et la génération
// du PDF (batpdf.js) : l'écran et le fichier exporté ne peuvent pas diverger.

export const PW = 841.89, PH = 595.28, M = 28;   // A4 paysage + marge (réduite pour élargir le visuel)

// Contenu borné par les marges gauche/droite
export const CW = PW - 2 * M;

// Bandeau = UNE seule « bulle » (carte arrondie) unifiée, avec deux sections
// empilées à l'intérieur : identité (logo + client / projet / date + titre
// BON À TIRER + version) puis tableau de production (commande + marquage).
// `top` est mesuré depuis le HAUT de page (repère écran) ; le PDF utilise
// `PH - top` pour retrouver le repère depuis le bas.
// Le bandeau démarre plus haut que la marge latérale (M) : la marge basse
// n'est que de ~9 pt, on remonte donc le haut pour équilibrer et surtout
// laisser plus de hauteur au visuel (t-shirt), qui est bridé par la hauteur.
export const BAND_TOP = 12;    // bandeau remonté vers le haut de page
export const BUB_PAD = 7;      // marge intérieure d'une bulle
export const BUB_RADIUS = 9;   // rayon des coins arrondis (bulles génériques)

const ID_H = 36;               // hauteur section identité (fixe, INCHANGÉE)

// Bandeau « Material » (Google), une seule carte blanche pour toute la zone
// identité + tableau — voir G_HEX/G_RADIUS. Le reste de la feuille (visuels,
// pied de page) garde HEX / bleu canard. Le tableau occupe TOUJOURS la
// largeur pleine de la carte (colonnes d'emplacement étirées pour remplir),
// pour une entête unifiée façon Google plutôt que deux cartes distinctes.
export const G_RADIUS = 12;      // rayon des coins arrondis de la carte
export const ROW_H = 16;         // hauteur d'une ligne de données (= .pdf-tbl-row)
export const PLACE_ROW_H = 19;   // ligne d'emplacement : elle porte un intitulé éditable
export const TBL_FONT = 9;       // taille des valeurs de cellule (Taille/Qté/cotes)
export const TBL_FONT_SM = 6.5;  // libellés d'en-tête + légende « couleur · emplacement »
export const TBL_FONT_ZONE = 8;  // nom de zone (Avant/Arrière/Côté gauche/Côté droit)
const TBL_HEAD_H = 20;           // en-tête 2 lignes (= .pdf-tbl-head)
const TBL_FOOT = 13;             // place basse (bouton « + ligne » sur l'écran)

// Palette Material dédiée au bandeau (identité + tableau) — mêmes valeurs que
// les tokens --g-* du chrome (src/css/app.css), pour que écran et export PDF
// restent identiques.
export const G_HEX = {
  BG:          '#ffffff',
  HEAD_BG:     '#f8f9fa',
  INK:         '#202124',
  GREY:        '#5f6368',
  FAINT:       '#80868b',
  BORDER:      '#dadce0',
  SEP:         '#f1f3f4',
  ACCENT:      '#1a73e8',
  ACCENT_SOFT: '#e8f0fe',
};

// Champs du bandeau d'identité, dans l'ordre d'affichage, avec leur largeur
// RELATIVE. Des colonnes de largeur égale donneraient autant de place à
// RÉF. PRODUIT (une référence courte) qu'à CLIENT (raison sociale libre, souvent
// longue) : le nom du client serait à l'étroit à l'écran et tronqué par fitText
// dans le PDF. On répartit donc au prorata du contenu réellement attendu.
// Consommé par l'écran (batpage.js → flex-grow) ET par le PDF (batpdf.js →
// largeur en points) : une seule source de vérité, pas de divergence possible.
//
// ÉCHÉANCE A QUITTÉ LE BANDEAU. Sa saisie a disparu de la barre du haut ; une
// colonne sans saisie n'imprime qu'un tiret, et un tiret sur un document envoyé
// au client n'est pas une information, c'est une case oubliée. Les quatre qui
// restent se partagent la largeur libérée.
// « DESTINATAIRE », PAS « CLIENT ». Le bon à tirer PART chez la personne qu'il
// nomme : lui écrire « CLIENT » en tête de page, c'est lui rappeler ce qu'elle
// est pour nous au lieu de lui dire à qui le document s'adresse. Le mot juste
// sur un document sortant est celui de la poste, et il vaut pour une société
// comme pour une association ou une personne.
// L'application, elle, garde « Client » dans ses écrans : c'est le vocabulaire
// de la maison, et il ne sort pas.
export const META_COLS = [
  { key: 'client', label: 'DESTINATAIRE', flex: 2.5 },
  { key: 'name', label: 'PROJET', flex: 2.2 },
  { key: 'couleur', label: 'COULEUR', flex: 1.3 },
  { key: 'ref', label: 'RÉF. PRODUIT', flex: 1.2 },
];
export const META_FLEX_SUM = META_COLS.reduce((s, c) => s + c.flex, 0);

// Grille fusionnée commande + marquage, dans la même carte que l'identité.
// Colonnes = Taille | Qté (largeur FIXE et lisible) | un emplacement par logo
// posé (largeur ÉGALE, ÉTIRÉE pour occuper toute la largeur restante de la
// carte — entête unifiée pleine largeur, pas un tableau flottant plus étroit
// que l'identité au-dessus). Lignes = une par taille, puis un total (somme
// des Qté). `grid()` renvoie la géométrie (carte + largeurs de colonnes en
// points) ; appelée à l'identique par l'écran (batpage) et le PDF (batpdf) —
// les deux ne peuvent pas diverger.
const B_XPAD = 8;      // marge horizontale grille ↔ bord de carte
const LABEL_W = 148;   // colonne d'intitulé de ligne (Qté, puis un emplacement par logo)
const TOTAL_W = 56;    // colonne Total, à droite

// LA TAILLE EST UNE COLONNE, PAS UNE LIGNE.
//
// La grille croise deux axes : les TAILLES et les EMPLACEMENTS de marquage. Il
// fallait choisir lequel descend et lequel s'étale — et c'était l'inverse.
//
// Les tailles sont l'axe LONG (cinq à douze) et les emplacements l'axe COURT
// (zéro à trois). En posant les tailles en lignes, l'axe long mangeait la
// HAUTEUR — la seule ressource rare d'un A4 paysage, celle qui borne le visuel
// du vêtement — pendant que l'axe court laissait la largeur inoccupée. Sans
// aucun marquage posé, deux colonnes (Taille, Qté) s'étiraient sur 770 pt pour
// afficher « S » et « — » : mesuré, 129 pt de hauteur pour dix valeurs.
//
// Transposée, la grille se lit comme une fiche de commande textile — la
// gamme de tailles en bandeau, une ligne par information — et rend 80 pt de
// hauteur au vêtement quand rien n'est encore posé, 44 avec deux marquages.
// Aucune information ne disparaît : mêmes tailles, mêmes quantités, même
// total, mêmes cotes, mêmes intitulés de zone et de couleur.
//
// Colonnes : intitulé | une par taille | Total.
// Lignes   : en-tête (les tailles) | Qté | un emplacement par logo posé.
export function grid(sizeCount, placementCount) {
  const sCols = Math.max(sizeCount | 0, 1);
  const pRows = Math.max(placementCount | 0, 0);

  const innerW = CW - 2 * B_XPAD;   // largeur utile de la carte (jamais de débordement)

  // Les colonnes de taille se partagent ce qui reste, à parts égales : elles
  // remplissent donc toujours la carte, à l'écran comme dans le PDF (l'écran
  // raisonne en pourcentages de ce total, le PDF en points — même source).
  const sizeW = (innerW - LABEL_W - TOTAL_W) / sCols;

  const tableH = TBL_HEAD_H + ROW_H + pRows * PLACE_ROW_H + TBL_FOOT;
  const bandH = ID_H + tableH;

  const BUB_HEAD = { x: M, top: BAND_TOP, w: CW, h: bandH };
  const ID        = { x: M, top: BAND_TOP, w: CW, h: ID_H };
  const TBL       = { x: M + B_XPAD, top: BAND_TOP + ID_H, w: innerW };
  const V_TOP     = BAND_TOP + bandH + 5;
  return { BUB_HEAD, ID, TBL, labelW: LABEL_W, sizeW, totalW: TOTAL_W, TBL_HEAD_H, V_TOP };
}

// Zone visuel : toute la largeur de la page, sous les bulles
export const VX = M, VW = PW - 2 * M;
export const V_BOTTOM = 72;                       // depuis le bas de page
// ^ plancher du visuel : plus de légende sous les vues → on descend le plancher
//   pour agrandir le textile. Il doit rester au-dessus du filet des mentions
//   légales (4 lignes → filet vers 67 pt) : 72 laisse ~5 pt de garde.
export const V_GAP = 18;                          // espace entre 2 visuels

// Encres (hex écran ; batpdf les convertit en rgb pdf-lib).
// SHEET = fond de feuille ; ACCENT = bleu canard, partagé avec l'écran
// (var(--accent)) pour que l'aperçu et le PDF ne divergent pas.
//
// SHEET est BLANC PUR, et doit le rester : les packshots fournisseur ont un
// fond blanc opaque (#ffffff). Tout papier même légèrement teinté (l'ancien
// #f4f4f2) transformait le rectangle de chaque photo en halo blanc visible
// autour du vêtement — précisément la « carte artificielle » que la mise en
// page cherche à éviter. Avec un papier blanc, la photo se fond dans la
// feuille et le produit trône seul. Consommé par l'écran (var(--surface)),
// le PDF (batpdf.js) et le fondu des bords de mockup (mockup.js).
export const HEX = {
  INK: '#1a1c1f',
  GREY: '#6b7378',
  FAINT: '#9ea3a9',
  HAIR: '#d4d8d8',
  ACCENT: '#4A6274',
  SHEET: '#ffffff',
};

// Le BAT tient sur UNE seule page : toutes les faces incluses (avant,
// arrière, côtés — 4 au maximum) sont posées côte à côte sur la même feuille.
export function facePages(includedFaceKeys) {
  return [includedFaceKeys.slice()];
}

// Mise en page des visuels d'une page : UNE rangée à HAUTEUR COMMUNE.
// `aspects` = largeur/hauteur natif de chaque visuel. On impose à tous la même
// hauteur (les vues de face, larges, et les vues de côté, étroites et hautes,
// s'alignent sur la même ligne haut/bas) ; chaque visuel garde son ratio, donc
// sa largeur de colonne varie. La hauteur commune est bornée par la hauteur de
// zone ET par la largeur disponible (VW) ; la rangée est centrée. Renvoie
// [{x, w, h}] en pt — mêmes valeurs à l'écran (batpage) et dans le PDF (batpdf).
export function faceLayout(aspects, zoneH) {
  const n = aspects.length;
  if (!n) return [];
  const gaps = V_GAP * (n - 1);
  const sumAspect = aspects.reduce((s, a) => s + a, 0) || 1;
  const h = Math.min(zoneH, (VW - gaps) / sumAspect);
  const rowW = sumAspect * h + gaps;
  let x = VX + (VW - rowW) / 2;   // rangée centrée horizontalement
  return aspects.map((a) => {
    const w = a * h;
    const box = { x, w, h };
    x += w + V_GAP;
    return box;
  });
}

// Largeur de colonne « égalitaire » (pt) — proxy servant uniquement à borner
// la résolution de rendu des mockups avant que la mise en page réelle
// (dépendante des ratios) soit connue.
export function evenColWidth(count) {
  const n = Math.max(count | 0, 1);
  return n === 1 ? VW : (VW - V_GAP * (n - 1)) / n;
}
