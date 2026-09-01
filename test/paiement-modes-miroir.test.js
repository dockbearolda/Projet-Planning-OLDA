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

// ET `catalog.json` NE PORTE PLUS QUE ÇA. Ses autres listes — types, délais,
// zones, typos, techniques, logos — n'étaient lues que par `POST /api/projets`,
// la route que plus aucun écran n'appelait depuis le 31/07. Elle a d'abord
// paru intouchable : elle portait le SEUL chiffrage serveur de la grille tasse,
// donc la seule preuve qu'une tasse sort à 16 €. Le calcul est sorti dans
// `tarif-tasse.js`, prouvé là où il vit, et la route est partie — le fichier
// l'a suivie. Une clé qui reviendrait ici sans consommateur serait un doublon
// en devenir.
assert.deepStrictEqual(Object.keys(catalogue), ['commande'], 'catalog.json : une seule racine');
assert.deepStrictEqual(Object.keys(catalogue.commande), ['paiementModes'],
  'catalog.json : rien d’autre que les modes de paiement');

console.log('✓ modes de paiement : le miroir du planning suit le serveur, et catalog.json ne porte plus que lui');
