// ===========================================================================
// LE SOCLE DES PAPIERS — ce que le ticket et le bon de commande partagent
// ===========================================================================
// DEUX PAPIERS SORTENT DE LA MÊME LIGNE, à un clic l'un de l'autre (la modale
// porte les deux boutons). Ils avaient chacun leur encre, leur gris, leur
// filet, leur taille de capitales et leur marge de feuille — trois valeurs
// identiques écrites deux fois, ce qui redevient deux valeurs le jour où l'une
// bouge. C'est exactement ce que la charte interdit : un composant que plus
// d'un écran porte descend dans le fichier partagé.
//
// CE QUI EST ICI EST COMMUN, ET RIEN D'AUTRE. Les deux papiers ne se lisent pas
// à la même distance — le ticket sur un plan de travail, à bout de bras ; le
// bon de commande sur un bureau, à trente centimètres. Leurs échelles de texte
// restent donc chez eux ; leur GRAMMAIRE est ici.
//
// ATTENTION, DEUX PIÈGES DÉJÀ PAYÉS :
//   1. AUCUN ACCENT GRAVE dans les gabarits : c'est le caractère qui les
//      termine. Le module reste valide, `node --check` passe, et l'écran est NU.
//   2. AUCUN JETON DE `charte.css` : le cadre d'impression ne reçoit QUE ces
//      chaînes. Un `var(--pas-3)` y vaut la chaîne vide, donc un rembourrage à
//      zéro SUR LE PAPIER et nulle part ailleurs — l'aperçu, lui, a la charte
//      et reste impeccable. Tous les jetons d'ici commencent par `--pap-`.

// Les jetons, posés sur la feuille elle-même (`.tk` / `.bu`) : une feuille
// d'impression n'a pas de racine à qui les demander.
export const JETONS_PAPIER = `
    --pap-encre: #202930; --pap-ardoise: #4A6274; --pap-filet: #ADB8B9;
    --pap-cap: 9px; --pap-marge: 42px;`;

// LES INTITULÉS, une seule classe pour les deux papiers : capitales espacées,
// gris ardoise, petites. Un intitulé ne se lit pas, il se saute — c'est la
// valeur qu'on vient chercher.
//
// LES CAPITALES SONT DANS LE TEXTE, PAS DANS LA RÈGLE. Une bascule
// text-transform ici mettait aussi en capitales ce qui n'en veut pas : le
// millimètre du ticket sortait « MM », alors que mm est une unité du système
// international et s'écrit en minuscules. Ce qui doit crier s'écrit en
// capitales à l'endroit où on l'écrit.
export const SOCLE_PAPIER = `
  .pap-cap { font: 500 var(--pap-cap)/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
             letter-spacing: .16em; color: var(--pap-ardoise); }
`;
