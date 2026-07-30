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
   globalThis.splitPersoName = splitPersoName;`,
  sandbox,
);
const { splitPersoName } = sandbox;

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

console.log('✓ nom-client : découpage Prénom / NOM (casse imposée, repli 1er mot, cas vides) OK');
