'use strict';

// L'ACOMPTE EN UN CLIC — optimisation 14 du handoff (29/08/2026)
// ===========================================================================
// Un acompte se demande presque toujours au tiers ou à la moitié. Le chiffre
// existe : il se déduit du prix. Le taper à la main, c'est refaire un calcul
// que l'écran sait faire — et se tromper d'un centime une fois sur dix.
//
// TROIS CHOSES QUI CASSERAIENT EN SILENCE :
//
//   1. LES DEUX DRAPEAUX DU FEU. `acompte_verse` et `acompte_demande` se
//      déduisent du montant — un acompte versé a forcément été demandé. Deux
//      portes mènent maintenant au même fait (la frappe et les pastilles) : si
//      l'une oublie les drapeaux, le feu du planning se tait sur ces
//      dossiers-là sans que rien ne le dise. C'est le défaut du 26/08 au soir,
//      où `acompte_demande` était NULL sur les 184 dossiers. La règle est donc
//      écrite UNE fois, et ce fichier le vérifie.
//   2. SANS PRIX, ON NE CALCULE RIEN. 30 % de rien vaut zéro, et un acompte à
//      0,00 € posé sur un dossier non chiffré allumerait les deux drapeaux pour
//      un versement qui n'a pas eu lieu. Or « demande de devis = sans prix »
//      est le cas NORMAL ici : `project_value` y est NULL, jamais 0.
//   3. CHAQUE ACTION SE POSE CONTRE LE NOMBRE QU'ELLE CHANGE, dans la case du
//      LIBELLÉ — la seule place où quelque chose peut accompagner un montant
//      sans sortir du rail des chiffres (règle du 29/08 : rien ne passe à DROITE
//      du montant). Les deux pastilles sur la ligne de l'acompte, « Soldé » sur
//      celle du reste. Ça retire au passage la quatrième rangée du compte, qui
//      ne portait qu'eux et coûtait 56 px de haut.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const JS = lire('public/fiche-atelier.js');
const CSS = lire('public/fiche-atelier.css');

// ---------------------------------------------------------------------------
// 1. LA RÈGLE DES DRAPEAUX EST ÉCRITE UNE SEULE FOIS
// ---------------------------------------------------------------------------
assert.match(JS, /const envoyerAcompte = \(n\) => \{/,
  'le montant et ses deux drapeaux passent par UNE fonction');
assert.match(JS, /envoyer: \(v\) => envoyerAcompte\(nombreDe\(v\)\),/,
  'la frappe dans le champ passe par là');
assert.match(JS, /\n\s*envoyerAcompte\(v\);/,
  'et les pastilles aussi — pas une deuxième écriture des drapeaux');
// Un seul endroit décide de `acompte_verse` : s'il y en a deux, ils divergeront.
const verse = JS.match(/const verse = n != null && n > 0;/g) || [];
assert.strictEqual(verse.length, 1,
  `la déduction des drapeaux ne s’écrit qu’une fois (${verse.length} trouvées)`);

// ---------------------------------------------------------------------------
// 2. LE CALCUL, ET CE QU'IL REFUSE DE FAIRE
// ---------------------------------------------------------------------------
const BLOC = JS.slice(JS.indexOf('const pastilleAcompte ='), JS.indexOf('const bSolde ='));
assert.match(BLOC, /if \(ttc == null \|\| ttc <= 0\)/,
  'sans prix TTC, la pastille ne calcule rien');
assert.match(BLOC, /dire\('Pas de prix TTC/, 'et elle le DIT, au lieu de poser un zéro');
assert.match(BLOC, /Math\.round\(ttc \* part \* 100\) \/ 100/,
  'le montant est arrondi au centime, pas laissé en flottant');
assert.match(BLOC, /empiler\(\(\) => poser\(avant\)\);/,
  'un acompte posé d’un clic s’annule d’un clic');
assert.match(BLOC, /if \(n === avant\) return;/,
  'recliquer la même pastille ne réécrit rien et n’empile pas un faux retour');

// CHAQUE ACTION CONTRE LE NOMBRE QU'ELLE CHANGE (29/08). Les deux pastilles
// calculent l'ACOMPTE : elles vivent sur sa ligne. « Soldé » met le RESTE à
// zéro : il vit sur la sienne. Elles sont dans la case du LIBELLÉ — la seule
// place où quelque chose peut accompagner un montant sans sortir du rail.
assert.match(JS, /chAcompteDate,\s*\n\s*pastilleAcompte\(0\.3\),\s*\n\s*pastilleAcompte\(0\.5\),/,
  'les deux pastilles sont sur la ligne de l’acompte, qu’elles calculent');
assert.match(JS, /ligneArgent\(\[bSolde, document\.createTextNode\('Reste à payer'\)\], resteCase\);/,
  '« Soldé » est sur la ligne du reste, qu’il met à zéro');
// Et la quatrième rangée du compte n'existe plus : elle ne portait qu'eux.
assert.ok(!/fa-argent__actions/.test(JS), 'plus de rangée d’actions à elle seule');
assert.match(BLOC, /`\$\{Math\.round\(part \* 100\)\} %`/,
  'le libellé se déduit du taux : un seul nombre, pas deux à tenir d’accord');

// Le calcul lui-même, rejoué : c'est ce que la vendeuse lit sur l'écran.
const acompte = (ttc, part) => Math.round(ttc * part * 100) / 100;
assert.strictEqual(acompte(1200, 0.3), 360);
assert.strictEqual(acompte(1200, 0.5), 600);
assert.strictEqual(acompte(648.96, 0.3), 194.69, 'un prix qui ne tombe pas rond s’arrondit au centime');
assert.strictEqual(acompte(52.1, 0.5), 26.05);

// ---------------------------------------------------------------------------
// 3. LA RANGÉE : MÊME BOÎTE POUR LES TROIS, ET LE RAIL DES MONTANTS INTACT
// ---------------------------------------------------------------------------
// Règle du dépôt : deux composants de la même famille prennent la même hauteur,
// le même rembourrage, le même écart et la même graisse — dans UNE règle.
assert.match(JS, /bouton\('fa-seg__b', `\$\{Math\.round\(part \* 100\)\} %`/,
  'les pastilles prennent la boîte de « Soldé », pas une à elles');
// La largeur des trois suit leur mot : à 88 px fixes on obtenait 88 / 88 / 52.
assert.match(CSS, /\.fa-argent__k \.fa-seg__b \{ flex: 0 0 auto; \}/,
  'UNE règle donne aux trois boutons la même façon de se dimensionner');
assert.ok(!/\.fa-argent__actions/.test(CSS), 'la rangée d’actions n’a plus de règle non plus');

// ---------------------------------------------------------------------------
// 4. LE PANNEAU EST UN SEUL BLOC, PAS DEUX MORCEAUX ET UN VIDE
// ---------------------------------------------------------------------------
// Charlie, 29/08 : « toute cette partie doit être ensemble, et cette bulle doit
// être beaucoup moins haute ». Les deux rangées de l'atelier tenaient une ligne
// PLEINE LARGEUR au-dessus du compte, qui descendait sous elles calé à droite :
// il restait un rectangle vide de 910 × 225 px en bas à gauche, pour 318 px de
// panneau. Elles se rangent maintenant dans la moitié gauche, face au compte.
assert.match(JS, /const atelier = grilleCompte\(\);/,
  'ce qui ne regarde que l’atelier tient sa propre moitié');
assert.match(JS, /rangeesPanneau\.push\(atelier, argent\);/,
  'deux moitiés côte à côte, et rien d’empilé au-dessus');
// Le compte ne traverse plus les deux colonnes : c'est ce qui libère la gauche.
const ARGENT = CSS.match(/\.fa-argent \{[\s\S]*?\n\}/)[0];
assert.ok(!/grid-column: 1 \/ -1/.test(ARGENT),
  'le compte tient la colonne de droite, il ne s’étale plus sur les deux');
assert.match(ARGENT, /margin-left: auto;/, 'et reste collé à droite par une marge automatique');

// ---------------------------------------------------------------------------
// 5. LES DEUX MOITIÉS SONT LA MÊME FAMILLE
// ---------------------------------------------------------------------------
// Charlie, 29/08 : « tout ça doit être la même famille ». C'étaient deux
// composants différents côte à côte — à gauche l'intitulé posé au rail de
// GAUCHE et la valeur qui le suit, à droite l'intitulé calé CONTRE la colonne
// des montants. Même paire, deux géométries : exactement ce qui se voit sans
// qu'on sache le nommer.
assert.match(JS, /const grilleCompte = \(\) => el\('div', 'fa-argent'\);/,
  'les deux moitiés sortent de la MÊME fabrique');
assert.match(JS, /const ligneDe = \(hote\) => \(cle, montant\) => \{/,
  'et leurs lignes du même composant, pas de deux qui se ressemblent');
assert.ok(!/fa-details__atelier|fa-duo|fa-marge-k/.test(JS),
  'plus aucun composant propre à la moitié gauche');
assert.ok(!/\.fa-duo|\.fa-marge \{/.test(CSS),
  'ni la moindre règle qui lui reste');
// MÊME FORME, LIGNE POUR LIGNE : deux faits qu'on saisit, un filet, le nombre
// qui en tombe. C'est le filet qui fait tomber les six lignes aux mêmes
// hauteurs — sans lui, la gauche décalait de 6, 3 et 7 px.
const PANNEAU = JS.slice(JS.indexOf('const atelier = grilleCompte();'), JS.indexOf('panneau.append(...rangeesPanneau);'));
assert.match(PANNEAU, /ligneAtelier\('Coût', chCout\);\s*\n\s*ligneAtelier\('Règlement', selReglement\);\s*\n\s*atelier\.append\(el\('div', 'fa-argent__filet'\)\);\s*\n\s*ligneAtelier\('Marge', valMarge\);/,
  'deux faits, un filet, la marge — le miroir exact du compte de droite');
// TOUTE LIGNE FAIT LA HAUTEUR D'UNE COMMANDE, même celle qui ne porte qu'un
// texte : sans ça la ligne « Marge » écrasait sa rangée. Et c'est un JETON.
assert.match(CSS, /\.fa-argent__k, \.fa-argent__v \{ min-height: var\(--fa-h-champ\); \}/,
  'la hauteur d’une ligne du compte est un jeton, jamais un nombre');
// LES DEUX BLOCS SONT ENSEMBLE, EN BAS À DROITE (29/08). Charlie : « toutes ces
// valeurs doivent être en bas à droite ou centré, mais elles doivent être
// ENSEMBLE ». Posés aux deux bords opposés d'une grille en deux colonnes, ils se
// lisaient encore comme deux choses — 480 px de blanc entre le coût et le prix.
const DETAILS = CSS.match(/\.fa-details \{[\s\S]*?\n\}/)[0];
assert.match(DETAILS, /display: flex; gap: var\(--pas-4\);/,
  'les deux blocs se suivent, séparés d’un seul écart de la maison');
assert.ok(!/grid-template-columns/.test(DETAILS),
  'plus de grille en deux colonnes qui les écarte aux deux bords');
// ⚠ LA PAIRE SE COLLE À DROITE PAR UNE MARGE AUTOMATIQUE sur le PREMIER bloc,
// jamais par `justify-content: flex-end` : celui-ci rogne par la gauche dès que
// le contenu déborde, et c'est le début de la ligne — donc l'intitulé — qui
// disparaît. Défaut déjà payé ailleurs.
assert.ok(!/justify-content: flex-end/.test(DETAILS), 'jamais par `flex-end`');
assert.match(CSS, /\.fa-details > \.fa-argent--atelier \{ margin-left: auto; \}/,
  'c’est le premier bloc qui pousse la paire à droite');
assert.match(CSS, /\.fa-details > \.fa-argent \{ margin-left: 0; \}/,
  'et le second reste collé au premier');
// ⚠ `--pas-6` N'EXISTE PAS — l'échelle s'arrête à 4. Une variable inconnue ne
// lève rien : la déclaration tombe et l'écart valait ZÉRO, les deux blocs se
// touchaient sans qu'aucun contrôle ne bronche.
const jetonsEcart = [...CSS.matchAll(/var\(--pas-(\d+)\)/g)].map((m) => Number(m[1]));
assert.ok(jetonsEcart.every((n) => n >= 1 && n <= 4),
  `l’échelle des écarts s’arrête à --pas-4 (trouvé : ${[...new Set(jetonsEcart)].join(', ')})`);

console.log('✓ acompte en un clic : 30 % / 50 % déduits du TTC, les deux drapeaux suivent, le rail ne bouge pas');
