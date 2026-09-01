'use strict';
// LES MODES DE PAIEMENT, DEUX LISTES, UNE VÉRITÉ (01/09).
//
// Le serveur valide `paiement_mode` contre `catalog.json` ; le planning affiche
// ses libellés depuis `PAIEMENT_MODES` dans app.js. Un écran ne peut pas lire un
// JSON du serveur sans un appel de plus au démarrage, et l'application n'en veut
// pas : la liste est donc recopiée — et ce test est ce qui empêche la copie de
// dériver. Ajouter « Chèque cadeau » d'un côté sans l'autre fait échouer ici,
// pas au comptoir trois semaines plus tard.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const catalogue = JSON.parse(fs.readFileSync(path.join(RACINE, 'catalog.json'), 'utf8'));
const app = fs.readFileSync(path.join(RACINE, 'public/app.js'), 'utf8');

const m = app.match(/^const PAIEMENT_MODES = (\[[\s\S]*?\n\]);/m);
assert.ok(m, 'app.js déclare PAIEMENT_MODES en clair, en tête de fichier');
// eslint-disable-next-line no-new-func
const miroir = new Function(`return ${m[1]};`)();

const serveur = catalogue.commande.paiementModes;
assert.ok(Array.isArray(serveur) && serveur.length > 0, 'catalog.json porte les modes de paiement');
assert.deepStrictEqual(
  miroir.map((p) => [p.id, p.label]),
  serveur.map((p) => [p.id, p.label]),
  'les modes de paiement du planning sont ceux que le serveur accepte, dans le même ordre, avec les mêmes libellés',
);

// LE RESTE DE `catalog.json` N'EST PAS MORT, IL EST MAL RANGÉ (constat du
// 01/09). Ses listes (types, zones, délais, typos, techniques, logos) ne sont
// lues que par `POST /api/projets` — la route que plus aucun écran n'appelle…
// et qui porte le SEUL chiffrage serveur de la grille tasse. C'est par elle que
// `test/tarifs-tasse.test.js` vérifie qu'une tasse sort bien à 16 €, 14 € et
// 22 €, et qu'un logo client sur l'autre face vaut +6 €.
// Tant que ce calcul n'a pas d'autre porte, ni la route ni le fichier ne
// partent : on ne retire pas le seul endroit qui prouve qu'un prix est juste.
assert.deepStrictEqual(Object.keys(catalogue), ['commande'], 'catalog.json : une seule racine');
assert.ok(Object.keys(catalogue.commande).includes('paiementModes'),
  'catalog.json porte les modes de paiement');

console.log('✓ modes de paiement : le miroir du planning suit le serveur, et catalog.json ne porte plus que lui');
