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

// CHAQUE ACTION EST DANS LA CASE DU MONTANT QU'ELLE CHANGE. Les deux pastilles
// calculent l'ACOMPTE : elles sont dans sa case. « Soldé » met le RESTE à zéro :
// il est dans la sienne, et devant le nombre — la bande finit sur le chiffre
// qu'on vient y chercher.
assert.match(JS, /caseArgent\('Acompte versé le', chAcompteDate, pastilleAcompte\(0\.3\), pastilleAcompte\(0\.5\), chAcompte\)/,
  'les deux pastilles sont dans la case de l’acompte, qu’elles calculent');
assert.match(JS, /caseArgent\('Reste à payer', bSolde, reste\)/,
  '« Soldé » est dans la case du reste, qu’il met à zéro');
assert.match(BLOC, /`\$\{Math\.round\(part \* 100\)\} %`/,
  'le libellé se déduit du taux : un seul nombre, pas deux à tenir d’accord');

// Le calcul lui-même, rejoué : c'est ce que la vendeuse lit sur l'écran.
const acompte = (ttc, part) => Math.round(ttc * part * 100) / 100;
assert.strictEqual(acompte(1200, 0.3), 360);
assert.strictEqual(acompte(1200, 0.5), 600);
assert.strictEqual(acompte(648.96, 0.3), 194.69, 'un prix qui ne tombe pas rond s’arrondit au centime');
assert.strictEqual(acompte(52.1, 0.5), 26.05);

// ---------------------------------------------------------------------------
// 3. TOUT L'ARGENT SUR UNE SEULE BANDE
// ---------------------------------------------------------------------------
// Charlie : « je veux que tu fasses rentrer ça proprement sur une seule ligne ».
// Les deux blocs empilés demandaient 202 px de haut pour six valeurs.
assert.match(JS, /const caseArgent = \(cle, \.\.\.contenu\) => \{/,
  'chaque valeur est une case : son intitulé au-dessus, sa valeur dessous');
// LA SOUSTRACTION SE LIT ENCORE, à l'horizontale : empilée, un filet la disait ;
// couchée, ce sont les deux signes. Sans eux la bande devient une rangée de
// chiffres sans rapport entre eux.
assert.match(JS, /signe\('−'\)/, 'le moins de la soustraction');
assert.match(JS, /signe\('='\)/, 'et son égal');
const DETAILS = CSS.match(/\.fa-details \{[\s\S]*?\n\}/)[0];
assert.match(DETAILS, /display: flex; align-items: flex-end;/,
  'les VALEURS s’alignent entre elles ; les intitulés montent au-dessus');
assert.ok(!/justify-content: flex-end/.test(DETAILS),
  'jamais `flex-end` : il rogne par la gauche quand ça déborde');

// UNE CASE NE SE LAISSE PAS COMPRIMER SOUS SON CONTENU. Sans ça, flexbox rogne
// la plus large pour faire tenir la bande : « 26,05 € » passait à la ligne DANS
// sa bulle, 61 px de haut pour une police de 21 — un montant coupé en deux, à
// l'endroit même où on vient chercher le chiffre.
const CASE = CSS.match(/\.fa-case \{[^}]*\}/)[0];
assert.match(CASE, /flex-shrink: 0/, 'une case ne se comprime pas sous son montant');
assert.match(CSS, /\.fa-case__v \{[^}]*white-space: nowrap;/,
  'et son montant ne s’enroule pas');

// ⚠ LE SÉLECTEUR DES BOUTONS SUIT LA CASE. Il portait sur `.fa-argent__k`, la
// case de l'ancien compte empilé : la bande l'a remplacée, la règle ne mordait
// plus, et les boutons reprenaient leurs 88 px — 76 px perdus sur une bande qui
// débordait déjà. Une règle qui ne s'applique plus ne casse rien : c'est pour ça
// qu'on ne la voit pas.
assert.match(CSS, /\.fa-case__v \.fa-seg__b \{ flex: 0 0 auto; \}/,
  'les boutons épousent leur mot DANS la case du montant');
assert.ok(!/\.fa-argent__k \.fa-seg__b/.test(CSS),
  'et plus aucun sélecteur ne vise une case qui n’existe plus');
// L'ÉCART EST UN JETON DE L'ÉCHELLE, et elle s'arrête à 4.
const jetonsEcart = [...CSS.matchAll(/var\(--pas-(\d+)\)/g)].map((m) => Number(m[1]));
assert.ok(jetonsEcart.every((n) => n >= 1 && n <= 4),
  `l’échelle des écarts s’arrête à --pas-4 (trouvé : ${[...new Set(jetonsEcart)].join(', ')})`);

console.log('✓ acompte en un clic : 30 % / 50 % déduits du TTC, les deux drapeaux suivent, le rail ne bouge pas');
