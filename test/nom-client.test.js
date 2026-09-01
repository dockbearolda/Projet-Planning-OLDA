'use strict';

// Vérifie le découpage « Prénom / NOM » d'un client particulier
// (public/nom-client.js) : c'est lui qui décide quelle partie du nom de dossier
// passe en GRAS dans la colonne Client du planning.
//
// Comme priority.test.js : on n'exécute pas une copie, on charge le vrai source
// (module ES du navigateur), on retire les `export` et on l'évalue dans un vm.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'nom-client.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  `${SRC.replace(/^export\s+/gm, '')}
   globalThis.splitPersoName = splitPersoName;
   globalThis.capitales = capitales;
   globalThis.nomClientAffiche = nomClientAffiche;`,
  sandbox,
);
const { splitPersoName, capitales, nomClientAffiche } = sandbox;

// Champ par champ : l'objet vient d'un AUTRE contexte vm, son prototype n'est
// pas celui d'ici — deepStrictEqual le refuserait à valeurs égales.
const eq = (entree, prenom, nom, quoi) => {
  const r = splitPersoName(entree);
  assert.strictEqual(r.prenom, prenom, `${quoi} — prénom de « ${entree} »`);
  assert.strictEqual(r.nom, nom, `${quoi} — nom de « ${entree} »`);
};

// --- Cas normal : la casse imposée à la saisie dit où couper ----------------
eq('Jean DUPONT', 'Jean', 'DUPONT', 'prénom en initiales + nom en capitales');
eq('Jean-Marc O’Brien DUPONT', 'Jean-Marc O’Brien', 'DUPONT', 'prénom composé');
eq('Marie Anne DUPONT', 'Marie Anne', 'DUPONT', 'prénom composé non tiré');
eq('Jean DE LA FONTAINE', 'Jean', 'DE LA FONTAINE', 'nom à particules, tout en capitales');

// --- Un seul mot = un NOM (règle du comptoir) ------------------------------
// Rien à couper en deux graisses : le champ s'affiche tel quel.
eq('DUPONT', '', 'DUPONT', 'un mot seul est un nom');
eq('Dupont', '', 'Dupont', 'un mot seul, même en initiales, est un nom');

// --- Sans capitales lisibles : le 1er mot est le prénom ---------------------
// Nom tapé à la main dans la grille, ou fiche importée sans la casse imposée.
eq('Marie Dupont', 'Marie', 'Dupont', 'aucune capitale : 1er mot = prénom');
eq('marie dupont', 'marie', 'dupont', 'tout en minuscules : 1er mot = prénom');
eq('Marie Anne Dupont', 'Marie', 'Anne Dupont', 'aucune capitale : le reste est le nom');

// --- Tout en capitales : le 1er mot reste le prénom ------------------------
// La boucle ne mange jamais le mot de tête, sinon le prénom disparaîtrait.
eq('JEAN DUPONT', 'JEAN', 'DUPONT', 'tout en capitales : 1er mot = prénom');

// --- Champs vides / espaces parasites --------------------------------------
eq('', '', '', 'chaîne vide');
eq('   ', '', '', 'espaces seuls');
eq(null, '', '', 'null');
eq(undefined, '', '', 'undefined');
eq('  Jean   DUPONT  ', 'Jean', 'DUPONT', 'espaces multiples et bords');

// --- LE NOM DE FAMILLE SE LIT EN CAPITALES, LE PRÉNOM NE BOUGE PAS ---------
// La règle vit ICI, en un seul endroit : un écran qui affiche un nom sans
// passer par ce module est un écran à corriger, pas une copie à écrire.
// La règle ne s'atteint QUE par la nature du client : `nomPersoAffiche` n'est
// pas exporté, parce que posée sur un champ libre comme « Personne à
// contacter » — un prénom seul, le plus souvent — elle imprimerait « MÉLINA ».
const aff = (entree, attendu, quoi) =>
  assert.strictEqual(nomClientAffiche(entree, 'perso'), attendu, `${quoi} — « ${entree} »`);

aff('Jean Dupont', 'Jean DUPONT', 'nom en initiales : seule la famille monte');
aff('Jean DUPONT', 'Jean DUPONT', 'déjà en capitales : rien ne bouge');
aff('Marie Anne Dupont', 'Marie ANNE DUPONT', 'sans capitales, le reste est le nom');
aff('Jean-Marc de la Fontaine', 'Jean-Marc DE LA FONTAINE', 'nom à particules');
aff('Jean DE LA FONTAINE', 'Jean DE LA FONTAINE', 'particules déjà en capitales');
aff('Dupont', 'DUPONT', 'un mot seul est un nom de famille');
aff('Élodie Ménard', 'Élodie MÉNARD', 'les accents montent avec la lettre');
aff('  Jean   Dupont  ', 'Jean DUPONT', 'espaces multiples et bords');
aff('', '', 'chaîne vide');
aff(null, '', 'null');
aff(undefined, '', 'undefined');

// Le PRÉNOM ne change pas : c'est la famille qu'on cherche en balayant.
assert.strictEqual(nomClientAffiche('jean dupont', 'perso'), 'jean DUPONT',
  'un prénom en minuscules reste en minuscules');

// --- Un restaurant, une boutique : TOUT monte ------------------------------
// « tous les noms d'ailleurs, même les restaurants » (Charlie, 31/08). Le nom
// entier passe en capitales : il n'y a pas de prénom à préserver.
assert.strictEqual(nomClientAffiche('Sarl Le Marin', 'pro'), 'SARL LE MARIN',
  'un professionnel monte en entier');
assert.strictEqual(nomClientAffiche('Beach Bar Orient', 'pro'), 'BEACH BAR ORIENT',
  'un restaurant monte en entier');
assert.strictEqual(nomClientAffiche('Les Amis de l’École', 'asso'), 'LES AMIS DE L’ÉCOLE',
  'une association monte en entier, accents compris');
assert.strictEqual(nomClientAffiche('Sarl Le Marin', 'revendeur'), 'SARL LE MARIN',
  'un revendeur monte en entier');
// C'est `client_type` qui tranche, jamais la graphie : « Sarl Le Marin » se
// découpe comme « Prénom Nom » et sortirait « Sarl LE MARIN » si on le prenait
// pour un particulier.
assert.strictEqual(nomClientAffiche('Sarl Le Marin', null), 'SARL LE MARIN',
  'nature absente : la colonne vaut « pro » par défaut en base');
assert.strictEqual(nomClientAffiche('Jean Dupont', 'perso'), 'Jean DUPONT',
  'un particulier suit la règle');
assert.strictEqual(nomClientAffiche(null, 'perso'), '', 'valeur absente');
assert.strictEqual(nomClientAffiche(null, 'pro'), '', 'valeur absente, société');

// LE PRÉNOM D'UN PARTICULIER EST LA SEULE EXCEPTION : « JEAN DUPONT » ne dirait
// plus lequel des deux mots est le nom de famille.
assert.strictEqual(nomClientAffiche('Jean Dupont', 'pro'), 'JEAN DUPONT',
  'la même chaîne prise pour une société monte en entier');

// --- LA VENDEUSE TAPE EN MINUSCULES, LE PLANNING LIT EN CAPITALES ----------
// Charlie, 31/08 : « quand ma vendeuse va taper le nom de l'hôtel, elle va le
// taper en minuscule — chiant de faire ce genre d'accent en majuscule, é, è —
// sauf que dans le planning ça doit apparaître en MAJ ». C'est exactement ce
// que la règle rend possible : elle vit à L'AFFICHAGE, donc la saisie reste
// libre, et `toLocaleUpperCase('fr-FR')` monte les accents AVEC la lettre —
// « É », pas « E ». Un nom accentué ne doit jamais perdre ses accents en
// montant : c'est ce qui casserait la recherche et le rapprochement des fiches.
assert.strictEqual(nomClientAffiche('hôtel de la baie', 'pro'), 'HÔTEL DE LA BAIE',
  'un hôtel tapé en minuscules se lit en capitales');
assert.strictEqual(nomClientAffiche('résidence des îles', 'pro'), 'RÉSIDENCE DES ÎLES',
  'les accents montent avec la lettre, ils ne tombent pas');
assert.strictEqual(nomClientAffiche('crêperie à côté', 'pro'), 'CRÊPERIE À CÔTÉ',
  'circonflexe, accent grave et tréma compris');
assert.strictEqual(nomClientAffiche('jean élodie ménard', 'perso'), 'jean ÉLODIE MÉNARD',
  'un particulier tapé en minuscules : seul le prénom reste tel quel');

// --- La VALEUR n'est jamais touchée ----------------------------------------
// Le module est pur : il rend une chaîne neuve et ne modifie rien. C'est la
// garantie qui autorise à l'appeler au rendu et NULLE PART à l'écriture.
const saisi = 'Jean Dupont';
nomClientAffiche(saisi, 'perso');
nomClientAffiche(saisi, 'pro');
assert.strictEqual(saisi, 'Jean Dupont', 'la valeur saisie reste intacte');

assert.strictEqual(capitales('Dupont'), 'DUPONT', 'capitales monte le texte');
assert.strictEqual(capitales(''), '', 'capitales sur le vide');
assert.strictEqual(capitales(null), '', 'capitales sur null');

console.log('✓ nom-client : découpage Prénom / NOM + NOM DU CLIENT EN CAPITALES à l’affichage OK');
