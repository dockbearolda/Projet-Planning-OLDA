'use strict';

// LA COQUILLE : NAVIGATION ET RAIL (24/08/2026)
//
// Deux demandes du patron, le même jour, sur la même ossature :
//
//   1. « Nouveau Projet doit s'ouvrir ICI comme tout le reste, et je dois
//      pouvoir naviguer entre le planning, le dashboard… » — l'onglet n'a
//      jamais ouvert de nouvelle page (c'est un `<a href="#nouveau-projet">`),
//      mais il MASQUAIT toute la navigation : plus d'onglets, plus de rail,
//      plus rien qui dise qu'on est encore dans l'outil. Un cul-de-sac dont on
//      ne sortait que par la flèche du parcours.
//   2. « Le rail doit rester fixe, mais on doit pouvoir le réduire » — la
//      poignée le règle de 180 à 460 px et ne descend pas plus bas.
//
// Ce fichier tient les deux, et le défaut de mise en page qui est revenu en
// cours de route (les actions du coin retombées à gauche).

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(RACINE, 'public/styles.css'), 'utf8');
const APP = fs.readFileSync(path.join(RACINE, 'public/app.js'), 'utf8');

// --- 1. Nouveau Projet est un onglet comme les autres ------------------------
// L'onglet reste un lien de HASH : c'est lui, et lui seul, qui pilote la vue
// (voir applyHash). Un `target="_blank"` ou un `.html` ouvrirait bien une
// nouvelle page — c'est exactement ce qu'on ne veut pas.
const lienProjet = HTML.match(/<a[^>]*id="viewProjet"[^>]*>/);
assert.ok(lienProjet, 'l’onglet Nouveau Projet doit exister');
assert.ok(/href="#nouveau-projet"/.test(lienProjet[0]),
  'Nouveau Projet est un lien de hash : il s’ouvre DANS l’outil');
assert.ok(!/target=/.test(lienProjet[0]),
  '… et jamais dans un nouvel onglet');

// La navigation ne se masque plus sur cette vue : c'est TOUT le sujet de la
// demande. Le rail, lui, reste hors sujet — il ne porte que les étapes du
// planning, qui n'est pas à l'écran.
assert.ok(!/body\.view-comptoir[^{]*\.nav-switch/.test(CSS),
  'la navigation reste visible sur Nouveau Projet : on doit pouvoir en repartir');
assert.ok(/body\.view-comptoir \.grid-search \{[^}]*display: none/.test(CSS),
  'seule la recherche se masque : elle filtre une grille qui n’est pas là');
// LE DÉFAUT QUI EST REVENU EN COURS DE ROUTE : la recherche est le seul
// élément de gauche de la barre. Sans elle, et dès que les onglets passent à la
// ligne (requête de conteneur, seuil 1360 px), les actions du coin retombent
// contre le bord GAUCHE.
assert.ok(/body\.view-comptoir \.topbar-right \{[^}]*margin-inline-start: auto/.test(CSS),
  'sans la recherche, les actions du coin tiennent la droite par une marge automatique');

// --- 2. Le rail se replie d'un clic -----------------------------------------
assert.ok(/id="railToggle"/.test(HTML), 'le bouton de repli du rail doit exister');
// Posé au bord EXACT du rail : la barre du haut commence à sa droite, donc le
// PREMIER enfant de la barre est collé au rail. Et il ne bouge pas selon que le
// rail est ouvert ou fermé — c'est là que la main le cherche.
const barre = HTML.match(/<header class="topbar">([\s\S]*?)<div class="topbar-right">/);
assert.ok(barre, 'la barre du haut doit être lisible');
assert.ok(barre[1].indexOf('id="railToggle"') < barre[1].indexOf('id="gridSearch"'),
  'le bouton de repli ouvre la barre : il est collé au bord du rail');

// LE REPLI SE LIT AVANT LE PREMIER PIXEL. Posé après coup, le rail s'afficherait
// puis se rangerait sous les yeux à chaque ouverture — c'est pour ça que la
// classe vit sur <html> et non sur <body>, comme le thème juste au-dessus.
const tete = HTML.slice(0, HTML.indexOf('</head>'));
assert.ok(/localStorage\.getItem\('olda_rail_plie'\)/.test(tete),
  'le repli du rail se relit dans le script de tête, avant le premier rendu');
assert.ok(/documentElement\.classList\.add\('rail-plie'\)/.test(tete),
  '… et se pose sur <html>, seul élément qui existe déjà à ce moment-là');
assert.ok(/\.rail-plie \.shell \{[^}]*grid-template-columns: 0 0 minmax\(0, 1fr\)/.test(CSS),
  'replié, le rail ne prend plus aucune colonne');
assert.ok(/\.rail-plie \.sidebar,\s*\.rail-plie \.sidebar-resizer \{ display: none/.test(CSS),
  '… et il sort du flux : 32 entrées dans une piste de largeur nulle déborderaient');

// LA POLICE D'ICÔNES EST UN SOUS-ENSEMBLE FIGÉ de 91 glyphes, et elle n'a
// AUCUNE flèche gauche : un nom absent ne lève rien, il s'affiche en texte
// tronqué à sa première lettre. On retourne donc le seul chevron qu'elle porte.
assert.ok(/<button class="icon-btn rail-toggle"[\s\S]{0,400}>chevron_right</.test(HTML),
  'le bouton utilise `chevron_right`, qui EST dans la police');
assert.ok(/\.rail-toggle \.material-symbols-outlined \{[^}]*transform: scaleX\(-1\)/.test(CSS),
  'rail ouvert, le chevron pointe à gauche : « range-toi »');
assert.ok(/\.rail-plie \.rail-toggle \.material-symbols-outlined \{ transform: none/.test(CSS),
  'rail replié, il pointe à droite : « reviens »');

// Hors du planning le rail n'existe pas (view-plein / view-focus le replient
// déjà) : son bouton n'aurait rien à replier.
assert.ok(/body\.view-plein \.rail-toggle,\s*body\.view-focus \.rail-toggle \{ display: none/.test(CSS),
  'hors planning, le bouton de repli s’efface avec le rail');

// --- 3. Le câblage ----------------------------------------------------------
// Mémorisé PAR APPAREIL, comme la largeur du rail juste au-dessus : c'est un
// réglage de poste, pas une donnée de dossier.
assert.ok(/RAIL_PLIE_KEY = 'olda_rail_plie'/.test(APP),
  'le repli se retient dans localStorage, sous la même clé que le script de tête');
assert.ok(/documentElement\.classList\.toggle\('rail-plie'\)/.test(APP),
  'le clic bascule la classe sur <html>');
assert.ok(/aria-expanded/.test(APP) && /Déplier le rail/.test(APP) && /Replier le rail/.test(APP),
  'le bouton dit son état au clavier et au lecteur d’écran');

console.log('✓ coquille : Nouveau Projet garde la navigation, le rail se replie et s’en souvient');
