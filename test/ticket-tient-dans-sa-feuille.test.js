'use strict';

// ===========================================================================
// CE QUI EST ÉCRIT SUR LE TICKET TIENT DANS LA FEUILLE (27/08/2026)
// ===========================================================================
// Charlie, capture à l'appui : « les polices dépassent complètement de la
// fiche ». Mesuré au rendu, sur « Sweat capuche molleton » :
//
//   la désignation sortait à 64 px  → 677 px de texte pour 450 disponibles,
//                                     coupée net en plein mot ;
//   la quantité sortait à 17 px     → la taille du texte courant, derrière un
//                                     trait pointillé de 308 px pour 2 chiffres.
//
// Les deux venaient du MÊME endroit : `teteArticle()`, la tête d'article des
// lignes SANS fiche de production — c'est-à-dire la plupart. Son jumeau
// `blocsProduction()` faisait déjà les deux choses correctement ; les deux
// têtes avaient divergé.
//
// Ce fichier tient les trois règles de fond, pas les trois lignes de code.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const TICKET = lire('public/ticket.js');
const APP = lire('public/app.js');

const corps = (nom) => {
  const i = TICKET.indexOf(`function ${nom}(`);
  assert.ok(i > 0, `${nom} introuvable dans ticket.js`);
  // jusqu'à la fonction suivante — suffisant pour lire ce qu'elle construit
  const j = TICKET.indexOf('\n  function ', i + 10);
  return TICKET.slice(i, j > 0 ? j : i + 3000);
};

// --- 1. UNE DÉSIGNATION EST UNE PHRASE, ELLE PREND LE CRAN EN DESSOUS ------
// 64 px est la taille d'une RÉFÉRENCE (six signes). Une désignation est une
// phrase : à cette taille elle ne tient dans aucune colonne.
for (const nom of ['teteArticle', 'blocsProduction']) {
  const c = corps(nom);
  assert.ok(/tk__geant--texte/.test(c),
    `${nom} : une désignation doit prendre « tk__geant--texte » — à 64 px une phrase déborde`);
}

// --- 2. LA QUANTITÉ EST DANS LA BOÎTE GÉANTE, PAS À CÔTÉ ------------------
// Le champ hérite sa taille de son PARENT (.tk__champ { font: inherit }).
// Posé en voisin d'un `tk__geant` vide, il n'hérite de rien : la quantité —
// l'un des deux seuls faits qu'on cherche du regard sur une pile — sortait en
// texte courant.
for (const nom of ['teteArticle', 'blocsProduction']) {
  const c = corps(nom);
  assert.ok(!/tk__geant',\s*''\s*\)\s*,\s*val\(/.test(c),
    `${nom} : le champ de quantité est posé À CÔTÉ d'un « tk__geant » vide — il n'hérite donc pas de sa taille`);
  assert.match(c, /el\('span', 'tk__geant'\);?\s*\n\s*\w+\.append\(val\('qte'/,
    `${nom} : le champ de quantité doit être NICHÉ dans le « tk__geant »`);
}

// --- 3. CE QUI PEUT ÊTRE LONG DOIT POUVOIR REVENIR À LA LIGNE -------------
// Un `input` ne s'enroule jamais : son contenu défile à l'intérieur, invisible,
// et rien ne le dit. Aucune taille de police ne rend ça sûr.
assert.match(APP, /designation: \{ tag: 'textarea'/,
  'la désignation doit être une zone de texte : un champ d’une ligne ne s’enroule pas');
assert.match(APP, /const epouser = \(c\) => \{[\s\S]*?scrollHeight/,
  'une zone de texte du ticket doit épouser son contenu, sinon elle le cache derrière un défilement muet');
assert.match(TICKET, /textarea\.tk__champ \{[^}]*resize: none/,
  'une zone de texte du ticket ne se redimensionne pas à la main : la feuille garde ses proportions');

// --- 4. UN SEUL BORD INTÉRIEUR --------------------------------------------
// La boîte d'identité porte un trait ; la ligne de précision juste dessous n'en
// a pas. À rembourrage égal, leurs textes tombaient à 73,3 et 75,2 px du bord
// de la feuille : deux pixels, c'est trop peu pour être une hiérarchie et bien
// assez pour se voir.
const px = (re, quoi) => {
  const m = TICKET.match(re);
  assert.ok(m, `${quoi} introuvable dans CSS_TICKET`);
  return parseFloat(m[1]);
};
const traitBoite = px(/\.tk__ident \{ border: ([\d.]+)px/, 'le trait de .tk__ident');
const padBoite = px(/\.tk__ident-tete \{[^}]*padding: [\d.]+px ([\d.]+)px/, 'le rembourrage de .tk__ident-tete');
const padNom = px(/\.tk__ident-nom \{[^}]*padding: 0 ([\d.]+)px/, 'le rembourrage de .tk__ident-nom');
assert.strictEqual(padNom, padBoite + traitBoite,
  `.tk__ident-nom doit valoir ${padBoite} + ${traitBoite} = ${padBoite + traitBoite} px, `
  + `il vaut ${padNom} : son texte ne tombe pas sur le même bord que celui de la boîte juste au-dessus`);

// --- 5. ET TOUJOURS AUCUN ACCENT GRAVE ------------------------------------
// CSS_TICKET est un littéral de gabarit : un seul accent grave le referme et
// l'écran s'affiche NU. C'est arrivé en écrivant les commentaires ci-dessus.
const d = TICKET.indexOf('export const CSS_TICKET = `') + 'export const CSS_TICKET = `'.length;
const f = TICKET.indexOf('`;', d);
assert.ok(f > d, 'CSS_TICKET doit rester repérable');
assert.strictEqual(TICKET.slice(d, f).indexOf('`'), -1,
  'un accent grave dans CSS_TICKET referme le gabarit : l’écran s’affiche NU');

console.log('✓ ticket : la désignation s’enroule, la quantité est géante, et un seul bord intérieur');
