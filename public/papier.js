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

// ===========================================================================
// QUI ÉMET LE PAPIER — l'identité de l'atelier, commune aux TROIS documents
// ===========================================================================
// Elle vivait dans `bureau.js`. Le DEVIS est arrivé le 01/09 et lui demande
// exactement la même chose : le nom, l'adresse, de quoi joindre la maison, et
// les numéros légaux du pied de page. Recopiée, elle serait devenue deux
// identités le jour où l'une bouge — et c'est le genre d'écart qu'on ne voit
// qu'en comparant deux documents imprimés, pas en relisant un fichier.
//
// C'EST UN RÉGLAGE, JAMAIS UNE CONSTANTE (app_meta.entreprise) : un
// déménagement ne demande pas un déploiement, et un champ vide ne s'imprime
// pas. Aucun numéro réel n'a sa place dans le dépôt.
//
// CES DEUX HABILLAGES NE TOUCHENT QUE CE QU'ILS RECONNAISSENT. Une valeur qui
// n'a pas la forme attendue (un numéro international, une saisie déjà espacée,
// un SIRET incomplet) ressort TELLE QUELLE : mieux vaut un numéro brut qu'un
// numéro découpé de travers sur le document qui sert à facturer. La valeur
// STOCKÉE, elle, ne bouge jamais.

const papTexte = (v) => String(v == null ? '' : v).trim();

// Un numéro français se lit par paires : 06 90 47 97 88. Dix chiffres
// exactement, et rien d'autre — le « + » d'un international change le découpage.
export function telLisible(v) {
  const brut = papTexte(v);
  return /^\d{10}$/.test(brut) ? brut.replace(/(\d\d)(?=\d)/g, '$1 ') : brut;
}

// UN SIRET S'ÉCRIT GROUPÉ : les neuf chiffres du SIREN en trois groupes de
// trois, puis les cinq du NIC. C'est la convention de l'INSEE, et c'est comme
// ça qu'il se recopie sans se tromper de chiffre. Le n° de TVA
// intracommunautaire, lui, s'écrit d'un bloc : ce n'est pas un oubli de
// symétrie, c'est sa convention à lui.
export function siretLisible(v) {
  const brut = papTexte(v);
  return /^\d{14}$/.test(brut)
    ? `${brut.slice(0, 3)} ${brut.slice(3, 6)} ${brut.slice(6, 9)} ${brut.slice(9)}`
    : brut;
}

// UN IBAN SE RECOPIE PAR GROUPES DE QUATRE. C'est la convention, et c'est la
// seule chose qui rend un virement saisissable sans se tromper de caractère.
export function ibanLisible(v) {
  const brut = papTexte(v).replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(brut)
    ? brut.replace(/(.{4})(?=.)/g, '$1 ')
    : papTexte(v);
}

// L'en-tête et le pied de page d'un papier, tirés du réglage. Chaque liste ne
// porte QUE ce qui est renseigné : une ligne vide ne s'imprime pas.
export function maisonPapier(e) {
  const m = e && typeof e === 'object' ? e : {};
  const legal = [];
  if (papTexte(m.siret)) legal.push(`SIRET ${siretLisible(m.siret)}`);
  if (papTexte(m.ape)) legal.push(`APE ${papTexte(m.ape)}`);
  if (papTexte(m.rcs)) legal.push(`RCS ${papTexte(m.rcs)}`);
  if (papTexte(m.tva)) legal.push(`TVA ${papTexte(m.tva)}`);
  if (papTexte(m.capital)) legal.push(`Capital ${papTexte(m.capital)}`);
  return {
    nom: papTexte(m.nom),
    // L'adresse postale, telle qu'on l'écrirait sur une enveloppe.
    lignes: [papTexte(m.adresse), papTexte(m.ville)].filter(Boolean),
    // De quoi joindre la maison : c'est ce que le client cherche en premier.
    contact: [telLisible(m.tel), papTexte(m.email), papTexte(m.web)].filter(Boolean),
    // OÙ VERSER. Sans les trois, le cadre de règlement ne s'imprime pas du
    // tout : un devis qui réclame un acompte sans dire où le virer fait
    // rappeler le client, et c'est pire que pas de cadre.
    banque: {
      nom: papTexte(m.banque),
      iban: ibanLisible(m.iban),
      bic: papTexte(m.bic).toUpperCase(),
    },
    legal,
  };
}
