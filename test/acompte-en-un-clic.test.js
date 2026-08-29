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
//   3. LE RAIL DES MONTANTS NE BOUGE PAS. Trois boutons de 88 px posés dans la
//      colonne des chiffres l'auraient élargie de 136 px, donc déplacé tous les
//      libellés. La rangée traverse les deux colonnes à la place.

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

// Les deux taux, et rien d'autre : le libellé se déduit du taux, il ne se tape
// pas à côté — sinon « 30 % » finira par calculer 35 %.
assert.match(JS, /pastilleAcompte\(0\.3\), pastilleAcompte\(0\.5\), bSolde/,
  '30 %, 50 %, puis Soldé — l’action qui engage est la dernière à droite');
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
const ACTIONS = CSS.match(/\.fa-argent__actions \{[^}]*\}/)[0];
assert.match(ACTIONS, /grid-column: 1 \/ -1;/,
  'la rangée traverse les deux colonnes : la colonne des chiffres ne s’élargit pas');
// `flex-end` rogne par la gauche dès que le contenu déborde — défaut déjà payé.
assert.match(ACTIONS, /margin-left: auto;/, 'elle se colle à droite par une marge automatique');
assert.ok(!/justify-content: flex-end/.test(ACTIONS), 'jamais par `flex-end`');
assert.match(ACTIONS, /gap: var\(--pas-2\)/, 'l’écart est un jeton');
assert.ok(!/\d+px/.test(ACTIONS.replace(/var\([^)]*\)/g, '')),
  'aucune mesure écrite en dur dans la rangée');
// La largeur des trois suit leur mot : à 88 px fixes on obtenait 88 / 88 / 52.
assert.match(CSS, /\.fa-argent__actions \.fa-seg__b \{ flex: 0 0 auto; \}/,
  'UNE règle donne aux trois boutons la même façon de se dimensionner');

console.log('✓ acompte en un clic : 30 % / 50 % déduits du TTC, les deux drapeaux suivent, le rail ne bouge pas');
