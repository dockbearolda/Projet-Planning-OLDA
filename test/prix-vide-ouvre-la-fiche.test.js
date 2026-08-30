'use strict';

// LE PRIX QUI N'OUVRAIT JAMAIS RIEN.
// ===========================================================================
// Plainte de Charlie, le 30/08 : « les prix doivent apparaître quand je
// clique sur une ligne, car en ligne aucun prix n'apparaît quand je clique
// dessus ».
//
// La cellule PRIX TTC de la grille est un champ éditable en place (comme
// toutes les autres) : `ZONE_CLIQUABLE` exclut donc un clic dessus du clic
// qui ouvre la fiche (`ouvrirAuClic`, voir ce fichier même). Tant qu'un prix
// existe, ce n'est pas un problème — le petit texte « HT : … » à côté reste
// cliquable et ouvre la fiche. Mais SANS prix (une demande de devis pas
// encore chiffrée, précisément le cas où on a le plus besoin d'ouvrir la
// fiche), ce texte est VIDE, donc sans largeur : plus rien, dans toute la
// cellule, ne mène à la fiche. Le clic le plus naturel — sur le prix
// lui-même — tombait dans un champ vide qui ne montrait jamais rien de plus
// qu'un curseur, comme si rien ne s'était passé.
//
// Le correctif : tant que `project_value` est `null`, un clic sur le champ
// n'y entre pas — il ouvre la fiche, comme si on avait cliqué à côté. Dès
// qu'un prix existe, la cellule redevient ce qu'elle a toujours été : un
// champ qu'on édite en place, sans détour par la fiche.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

const CELL_PRICE = APP.match(/function cellPrice\(r\) \{[\s\S]*?\n\}/);
assert.ok(CELL_PRICE, 'cellPrice(r) doit exister telle quelle');
const CORPS = CELL_PRICE[0];

assert.ok(/price\.addEventListener\('mousedown', \(e\) => \{/.test(CORPS),
  'le champ prix doit intercepter le clic avant qu’il ne l’ouvre en édition');

const GARDE = CORPS.match(/price\.addEventListener\('mousedown', \(e\) => \{[\s\S]*?\n {2}\}\);/);
assert.ok(GARDE, 'l’écouteur doit être bien formé');
assert.ok(/r\.project_value == null/.test(GARDE[0]),
  'la bascule doit porter sur l’ABSENCE de prix, pas sur son contenu');
assert.ok(/e\.preventDefault\(\)/.test(GARDE[0]),
  'il doit empêcher le focus par défaut — sinon la fiche s’ouvrirait DERRIÈRE un champ resté actif');
assert.ok(/openLigneDetail\(r\.id\)/.test(GARDE[0]),
  'à la place, il doit ouvrir la fiche complète — c’est là que « Reste à payer » et le budget indicatif se lisent');

// CE QUI NE DOIT PAS CHANGER : une ligne déjà chiffrée reste éditable en
// place. Le correctif ne doit pas se déclencher quel que soit le contenu —
// seulement quand il n'y a RIEN à éditer.
assert.ok(!/if \(r\.project_value != null\)[\s\S]{0,40}preventDefault/.test(CORPS),
  'le correctif ne doit jamais empêcher l’édition d’un prix déjà posé');

console.log('✔ prix-vide-ouvre-la-fiche : une ligne sans prix ouvre la fiche au clic, une ligne chiffrée s’édite toujours en place');
