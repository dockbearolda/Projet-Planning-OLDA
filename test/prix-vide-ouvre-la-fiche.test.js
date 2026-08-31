'use strict';

// LE PRIX QUI N'OUVRAIT JAMAIS RIEN — puis plus rien de la ligne n'édite en place.
// ===========================================================================
// Plainte de Charlie, le 30/08 : « les prix doivent apparaître quand je
// clique sur une ligne, car en ligne aucun prix n'apparaît quand je clique
// dessus ». Premier correctif, le même jour : tant que `project_value` est
// `null`, un clic sur le champ prix n'y entrait pas — il ouvrait la fiche.
// Dès qu'un prix existait, la cellule restait ce qu'elle avait toujours
// été : un champ qu'on édite en place.
//
// CE CORRECTIF EST DÉPASSÉ, le jour même, par une demande plus large :
// « la seule façon de faire des modifs est de cliquer dessus, la ligne ».
// Le prix (comme le nom du dossier, l'article et la note) n'édite plus RIEN
// en place — il se lit, un clic n'importe où dessus ouvre la fiche, chiffré
// ou non. Le correctif spécifique au cas vide n'a donc plus de raison
// d'exister : ce test vérifie qu'il est bien parti, et que le cas qu'il
// réglait (rien, dans la cellule vide, ne menait à la fiche) reste réglé —
// pour une raison plus simple : la cellule n'est plus un `<input>` du tout,
// donc `ZONE_CLIQUABLE` (voir ce fichier même) ne l'exclut plus jamais du
// clic qui ouvre la fiche (`ouvrirAuClic`).

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

const CELL_PRICE = APP.match(/function cellPrice\(r\) \{[\s\S]*?\n\}/);
assert.ok(CELL_PRICE, 'cellPrice(r) doit exister telle quelle');
const CORPS = CELL_PRICE[0];

// LE CORRECTIF SPÉCIFIQUE AU CAS VIDE A DISPARU : il n'a plus de raison
// d'être, la cellule entière n'ouvre plus rien EN PLACE.
assert.ok(!/mousedown/.test(CORPS),
  'plus de correctif au cas par cas : la cellule prix n’intercepte plus aucun clic');
assert.ok(!/openLigneDetail/.test(CORPS),
  'elle n’ouvre plus la fiche elle-même — c’est la ligne entière qui le fait, via ouvrirAuClic');

// LA CELLULE N'EST PLUS UN CHAMP. `ZONE_CLIQUABLE` exclut input/select/
// textarea/button/a/label/[role=button]/.handle du clic qui ouvre la fiche :
// tant que le prix reste un `<span>`, il n'entre jamais dans cette liste,
// donc AUCUN clic dessus — vide ou chiffré — ne peut être avalé par un champ.
assert.ok(!/createElement\('input'\)/.test(CORPS) && !/createElement\('textarea'\)/.test(CORPS),
  'la cellule prix ne doit plus créer aucun champ de saisie');
assert.ok(/createElement\('span'\)/.test(CORPS),
  'elle reste un simple texte, comme le nom du dossier et l’article');

// LE MONTANT S'ÉCRIT TOUJOURS EN FRANÇAIS, à l'affichage — ce n'est plus une
// question de saisie (voir cellPrice), mais la lecture ne doit pas régresser.
assert.ok(/Number\(r\.project_value\)\.toFixed\(2\)\.replace\('\.', ','\)/.test(CORPS),
  'le montant s’affiche en français, comme sur la carte, le ticket et la fiche');
assert.ok(/vide \? '—'/.test(CORPS),
  'sans prix, la cellule montre un tiret — jamais un zéro ni un champ muet');

// ET LA FICHE SAIT TOUJOURS CORRIGER LE PRIX, chiffré ou non — « Reste à
// payer » et le budget indicatif ne se lisent que là.
const FICHE = fs.readFileSync(path.join(__dirname, '..', 'public', 'fiche-atelier.js'), 'utf8');
assert.ok(/ctx\.patchLigne\('project_value'/.test(FICHE),
  'le Prix TTC reste modifiable dans la fiche, zone Paiement');

console.log('✔ prix-vide-ouvre-la-fiche : la cellule prix n’édite plus rien en place, chiffrée ou non — tout clic ouvre la fiche');
