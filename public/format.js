// ===========================================================================
// LES NOMBRES QU'ON MONTRE À L'ÉCRAN
// ===========================================================================
// Un fichier d'une ligne, et c'est voulu : il existe pour qu'un module sorti
// de `app.js` n'ait pas à emporter une copie du formateur avec lui. La règle
// de la maison est qu'une chose s'écrit à UN endroit ; le jour où l'on découpe
// un gros fichier, le premier réflexe est de recopier les trois lignes de
// service dont le morceau dépend, et c'est comme ça qu'on se retrouve avec
// deux vérités.
//
// CE FORMATEUR EST CELUI DE L'ÉCRAN, PAS CELUI DU PAPIER. `ticket.js` et
// `bureau.js` passent par `Intl.NumberFormat('fr-FR')`, qui pose une FINE
// INSÉCABLE (U+202F) avant l'euro : c'est la bonne typographie pour un
// document imprimé, et c'est aussi ce qui fait qu'une comparaison de chaînes
// entre les deux échoue sur deux textes qui s'affichent pareil. Les deux
// cohabitent exprès — on ne les fond pas en un seul.

export const eur = (n) => `${n.toFixed(2).replace('.', ',')} €`;
