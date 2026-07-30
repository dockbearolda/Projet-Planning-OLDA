// Nom d'un client PARTICULIER — règles pures (aucun DOM)
// ===========================================================================
// La colonne « Client » du planning ne garde qu'UN texte (`billing_company`),
// et pour un particulier ce texte vaut « Prénom NOM ». Le comptoir veut lire
// les DEUX, le nom de famille EN GRAS : c'est lui qu'on cherche en balayant la
// colonne. Il faut donc savoir où s'arrête le prénom.
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
// vide, et l'affichage n'a alors rien à couper en deux graisses.
export function splitPersoName(complet) {
  const mots = String(complet == null ? '' : complet).trim().split(/\s+/).filter(Boolean);
  if (mots.length < 2) return { prenom: '', nom: mots.join(' ') };
  let coupe = mots.length;
  while (coupe > 1 && enCapitales(mots[coupe - 1])) coupe -= 1;
  // Aucune capitale en fin de chaîne : le 1er mot est le prénom.
  if (coupe === mots.length) coupe = 1;
  return { prenom: mots.slice(0, coupe).join(' '), nom: mots.slice(coupe).join(' ') };
}
