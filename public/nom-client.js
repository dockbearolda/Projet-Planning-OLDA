// Comment s'affiche le nom d'un client — règles pures (aucun DOM)
// ===========================================================================
// UN SEUL ENDROIT décide de la casse d'un nom de client, pour le CRM, la fiche
// client, la liste des clients, les deux écrans du comptoir, la fiche de
// production et les deux papiers. Recopiée dans un écran, la règle diverge le
// jour où l'une des deux bouge — et l'écart ne se voit qu'en comparant deux
// écrans, jamais en relisant l'un d'eux.
//
// La colonne « Client » du planning ne garde qu'UN texte (`billing_company`),
// et pour un particulier ce texte vaut « Prénom NOM ». Le nom de famille se
// lit en capitales et le prénom non : il faut donc savoir où s'arrête le
// prénom.
//
// La saisie impose la casse (voir `applyCasse` dans clients.js) : prénom en
// initiales (« Jean-Marc »), nom en CAPITALES (« DE LA FONTAINE »). Le nom est
// donc la série de mots EN CAPITALES qui termine la chaîne — ça tient aussi
// pour un prénom composé non tiré (« Marie Anne DUPONT »). Sans capitales
// lisibles (nom tapé à la main dans la grille, fiche importée), on retombe sur
// la règle du comptoir : le 1er mot est le prénom, tout le reste est le nom.
//
// Règle pure, testée seule : voir test/nom-client.test.js.

// Un mot « en capitales » : il porte au moins une lettre, et aucune minuscule.
const enCapitales = (mot) => /\p{L}/u.test(mot) && !/\p{Ll}/u.test(mot);

// « Jean-Marc DUPONT » → { prenom: 'Jean-Marc', nom: 'DUPONT' }.
// Un mot seul est un NOM (« ce client s'appelle DUPONT ») : le prénom reste
// vide, et tout le texte monte en capitales.
function splitPersoName(complet) {
  const mots = String(complet == null ? '' : complet).trim().split(/\s+/).filter(Boolean);
  if (mots.length < 2) return { prenom: '', nom: mots.join(' ') };
  let coupe = mots.length;
  while (coupe > 1 && enCapitales(mots[coupe - 1])) coupe -= 1;
  // Aucune capitale en fin de chaîne : le 1er mot est le prénom.
  if (coupe === mots.length) coupe = 1;
  return { prenom: mots.slice(0, coupe).join(' '), nom: mots.slice(coupe).join(' ') };
}

// --- L'AFFICHAGE ------------------------------------------------------------
// UN NOM DE CLIENT SE LIT EN CAPITALES, PARTOUT. C'est le mot qu'on cherche en
// balayant une colonne, une liste ou un papier : il doit sauter aux yeux sans
// qu'on le lise. Le nom de famille d'un particulier COMME la raison sociale
// d'un restaurant ou d'une boutique — « BEACH BAR ORIENT », « Jean DUPONT ».
// La règle est ICI et nulle part ailleurs — dix copies, c'est dix écrans qui
// divergent le jour où l'une bouge.
//
// C'est L'AFFICHAGE qui change, JAMAIS la valeur. Un nom saisi « Dupont » reste
// « Dupont » en base et se lit « DUPONT ». Transformer à l'écriture rendrait la
// correction d'une faute impossible (le champ qu'on rouvre n'est plus celui
// qu'on a tapé) et casserait le rapprochement des fiches, qui compare des
// chaînes. Aucun appelant ne doit donc renvoyer ce que ces fonctions rendent
// vers un `PATCH`, un `POST` ou un `localStorage`.
export const capitales = (v) => String(v == null ? '' : v).toLocaleUpperCase('fr-FR');

// « Jean Dupont » → « Jean DUPONT ». LE PRÉNOM EST LA SEULE EXCEPTION à la
// règle : c'est la famille qu'on cherche, pas la personne, et « JEAN DUPONT »
// ne dit plus lequel des deux mots est le nom. Un mot seul (« Dupont ») est un
// nom de famille — voir `splitPersoName` — donc il passe en entier.
//
// Cette règle-là ne sort pas du module : posée sur un champ libre comme
// « Personne à contacter », qui ne porte souvent qu'un prénom, elle laisserait
// « Mélina » en initiales alors que le reste de l'écran est en capitales. Elle
// ne s'applique qu'au nom d'un CLIENT, dont la nature est connue — voir
// `nomClientAffiche`.
function nomPersoAffiche(complet) {
  const { prenom, nom } = splitPersoName(complet);
  return [prenom, capitales(nom)].filter(Boolean).join(' ');
}

// Le nom d'un CLIENT (colonne « Client » du planning, `entreprise` d'une fiche,
// nom porté par les deux papiers). Tout monte en capitales — un restaurant, une
// boutique, une association, un revendeur : « BEACH BAR ORIENT ».
//
// UN PARTICULIER EST LE SEUL CAS À PART, et c'est `client_type` qui le dit, pas
// la graphie : lui garde son prénom en initiales, parce que c'est ce qui laisse
// voir où s'arrête le prénom et où commence la famille. « Sarl Le Marin » se
// découpe d'ailleurs exactement comme « Prénom Nom » — sans la nature, il
// sortirait « Sarl LE MARIN » au lieu de « SARL LE MARIN ».
export function nomClientAffiche(valeur, clientType) {
  const texte = String(valeur == null ? '' : valeur);
  return clientType === 'perso' ? nomPersoAffiche(texte) : capitales(texte);
}
