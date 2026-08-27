'use strict';

// ===========================================================================
// LE CALENDRIER DES DEUX ÉCRANS (27/08/2026)
// ===========================================================================
// Charlie : « le calendrier doit être le calendrier style SumUp ».
//
// Le calendrier natif de Chrome n'est réglable en rien — ni sa langue, ni son
// dessin, ni le jour où commence sa semaine — et il ouvrait, sur les deux
// écrans du comptoir, un objet gris qui n'appartenait à aucun des deux.
//
// IL VIT DANS pont.js. La vente directe pose une date par son champ, la demande
// de devis par son option « Choisir une date » : deux écrans à un clic l'un de
// l'autre ne peuvent pas offrir deux calendriers différents.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const PONT = lire('public/comptoir/pont.js');
const VENTE = lire('public/comptoir/vente-directe.html');
const DEVIS = lire('public/comptoir/demande-devis.html');

// --- 1. UN SEUL CALENDRIER, DANS LE FICHIER PARTAGÉ ------------------------
assert.match(PONT, /function calendrierPoser\(champ\)/,
  'le calendrier vit dans pont.js — le seul fichier que les deux parcours lisent');
assert.match(PONT, /document\.querySelectorAll\('input\[type="date"\]'\)\.forEach\(calendrierPoser\)/,
  'toute date de l’écran passe par lui, sans que la page ait à le demander');
for (const [nom, src] of [['vente-directe', VENTE], ['demande-devis', DEVIS]]) {
  assert.ok(!/\.showPicker\(\)/.test(src) || /window\.oldaCalendrier/.test(src),
    `${nom} : plus personne n’ouvre le calendrier natif sans repli sur le nôtre`);
}
// L'écran de devis choisit sa date depuis une LISTE : le champ qui la porte est
// un fantôme d'un pixel (voir `date-fantome`). Le panneau s'accroche donc au
// MENU, sinon il tombe n'importe où.
assert.match(DEVIS, /window\.oldaCalendrier\(\$\('desiredDate'\),ancre\)/,
  'la demande de devis accroche le calendrier sur son MENU, pas sur le champ fantôme');

// --- 2. LA SEMAINE COMMENCE LUNDI -----------------------------------------
assert.match(PONT, /const JOURS_COURTS=\['L','M','M','J','V','S','D'\];/,
  'la semaine française, pas celle de getDay()');
assert.match(PONT, /const calRang=\(d\)=>\(d\.getDay\(\)\+6\)%7;/,
  'lundi vaut 0 : c’est ce décalage qui place la première case du mois');

// --- 3. SIX SEMAINES, TOUJOURS --------------------------------------------
// Une grille qui change de hauteur d'un mois à l'autre fait sauter tout ce
// qu'il y a dessous à chaque flèche.
assert.match(PONT, /for\(let i=0;i<42;i\+=1\)/,
  'six semaines pleines : la grille ne change jamais de hauteur');

// --- 4. UNE DATE ISO SE LIT À MIDI ----------------------------------------
// L'atelier est à UTC−4 : à minuit, le fuseau ramène la date la veille.
assert.match(PONT, /new Date\(Number\(m\[1\]\),Number\(m\[2\]\)-1,Number\(m\[3\]\),12,0,0\)/,
  'une date ISO se construit à MIDI — à minuit, UTC−4 la ramène au jour d’avant');

// --- 5. LE PIÈGE DU COMPTOIR : UNE RÈGLE NUE SUR `button` ------------------
// Les deux écrans imposent « button{min-height:…;padding:0 18px} » à TOUS leurs
// boutons. Sans le redire, chaque case du calendrier héritait de 18 px de
// rembourrage de chaque côté : la grille de sept colonnes sortait du panneau et
// le jour choisi se retrouvait 26 px À CÔTÉ de la boîte (mesuré au rendu).
assert.match(PONT, /\.cal-panneau button\{padding:0;min-height:0;min-width:0;margin:0\}/,
  'toute commande du calendrier redit sa boîte en entier — sinon la page la lui impose');

// --- 6. ET AUCUN ACCENT GRAVE DANS LA FEUILLE ------------------------------
// Elle vit dans un littéral de gabarit : un seul accent grave non échappé le
// referme, et les composants des deux écrans redeviennent des champs bruts —
// sans une erreur visible nulle part. C'est arrivé DEUX fois le 27/08.
const bloc = PONT.match(/const STYLE_MENU\s*=\s*`([\s\S]*?)\n`;/);
assert.ok(bloc, 'la feuille du composant doit rester repérable');
assert.strictEqual(bloc[1].replace(/\\`/g, '').indexOf('`'), -1,
  'un accent grave non échappé referme le gabarit : les menus redeviennent des listes brutes');

console.log('✓ calendrier : un seul pour les deux écrans, la semaine commence lundi, et les cases tiennent dans la boîte');
