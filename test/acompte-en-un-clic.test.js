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
const BLOC = JS.slice(JS.indexOf('const pastilleAcompte ='), JS.indexOf('const selReglement ='));
assert.match(BLOC, /if \(ttc == null \|\| ttc <= 0\)/,
  'sans prix TTC, la pastille ne calcule rien');
assert.match(BLOC, /dire\('Pas de prix TTC/, 'et elle le DIT, au lieu de poser un zéro');
assert.match(BLOC, /Math\.round\(ttc \* part \* 100\) \/ 100/,
  'le montant est arrondi au centime, pas laissé en flottant');
// LA PILE D'ANNULATION EST RETIRÉE (30/08) : son unique porte était le bouton
// « Annuler » du message, et le message ne dit plus les réussites. Ce qui reste
// vrai, et qui compte : recliquer la même pastille ne réécrit rien.
assert.match(BLOC, /if \(n === avant\) return;/,
  'recliquer la même pastille ne réécrit rien');
assert.ok(!/empiler\(/.test(JS), 'plus de pile d’annulation : elle n’avait plus de porte');

// CHAQUE ACTION EST DANS LA CASE DU MONTANT QU'ELLE CHANGE. Les deux pastilles
// calculent l'ACOMPTE : elles sont dans sa case.
assert.match(JS, /caseArgent\('Acompte versé le', 'fa-case--large',\s*\n\s*chAcompteDate, pastilleAcompte\(0\.3\), pastilleAcompte\(0\.5\), chAcompte\)/,
  'les deux pastilles sont dans la case de l’acompte, qu’elles calculent');

// ---------------------------------------------------------------------------
// 2 bis. « SOLDÉ » EST RETIRÉE — LE TROISIÈME DRAPEAU SE DÉDUIT (30/08)
// ---------------------------------------------------------------------------
// Charlie, en désignant la bascule : « supprime ça ». Elle était le SEUL
// endroit de l'application qui écrivait `paye` : sans elle et sans déduction,
// un dossier entièrement réglé serait resté « à encaisser » sur le bon de
// commande (bureau.js) et se serait plaint au feu du planning (ligne-faits.js).
// Elle pouvait même contredire les chiffres : allumée sur un acompte de 30 %,
// elle affichait « Reste à payer : 0,00 € » sur un dossier à moitié réglé.
assert.ok(!/fa-solde|const bSolde/.test(JS), 'la bascule « Soldé » n’existe plus');
// ⚠ On cherche la RÈGLE, pas le nom : le commentaire qui raconte le retrait
// cite la classe, et un test qui trébuche sur son propre commentaire est un
// test qu'on désarme au lieu de le lire.
assert.ok(!/\.fa-solde\s*\{/.test(CSS), '… ni sa règle');
assert.match(JS, /caseArgent\('Reste à payer', 'fa-case--fin', reste\)/,
  'la case du reste ne porte plus que son nombre');
// LE DRAPEAU REJOINT LES DEUX AUTRES, dans la MÊME fonction : un versement qui
// couvre le TTC solde le dossier, le ramener en dessous le rouvre.
assert.match(JS, /const solde = verse && ttc != null && ttc > 0 && n >= ttc - 0\.005;/,
  '« payé » se déduit du montant versé, au centime près');
const paye = JS.match(/ctx\.patchLigne\('paye',/g) || [];
assert.strictEqual(paye.length, 1,
  `un seul endroit écrit « payé » (${paye.length} trouvés)`);
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
assert.match(JS, /const caseArgent = \(cle, cls, \.\.\.contenu\) => \{/,
  'chaque valeur est une case : son intitulé au-dessus, sa valeur dessous');
// LES DEUX SIGNES « − » ET « = » SONT PARTIS AVEC LE FLOTTEMENT (29/08). Ils
// disaient la soustraction quand la bande n'était qu'une suite de chiffres
// calée à droite, sans rapport entre eux. Sur les rails des colonnes, sous
// leurs intitulés, « Prix TTC », « Acompte versé le » et « Reste à payer » se
// lisent dans cet ordre sans qu'on ait à ponctuer — et un signe n'a pas de
// rail : gardé, il aurait décalé les trois cases qui le suivent.
assert.ok(!/signe\('−'\)/.test(JS) && !/const signe =/.test(JS),
  'plus de signes intercalaires : ils n’ont pas de rail, ils décaleraient tout ce qui suit');
assert.ok(!/fa-signe/.test(CSS), '… et leur règle est partie avec eux');

// LA BANDE TOMBE SUR LES COLONNES DE LA FICHE (29/08). Charlie, en désignant
// les six intitulés puis quatre intitulés du formulaire : « je veux que tout ça
// soit parfaitement aligné avec ces colonnes ». Elle flottait à DROITE par une
// marge automatique, chaque case à la largeur de son contenu : le premier
// intitulé commençait à 320 px, c'est-à-dire sur rien.
const DETAILS = CSS.match(/\.fa-details \{[\s\S]*?\n\}/)[0];
assert.match(DETAILS, /display: grid; grid-template-columns: 1fr 1fr;/,
  'la bande reprend les DEUX moitiés de `.fa-travail`');
assert.ok(!/margin-left: auto/.test(DETAILS),
  'elle ne flotte plus à droite : elle part du bord gauche du contenu, comme les colonnes');
const MOITIE = CSS.match(/\.fa-details__moitie \{[\s\S]*?\n\}/)[0];
assert.match(MOITIE, /grid-template-columns: var\(--fa-lab-w\) 1fr var\(--fa-lab-w\) 1fr;/,
  '… et dans chaque moitié les QUATRE MÊMES PISTES que les deux grilles du haut');
const GRILLES = CSS.match(/\.fa-grille-client,\n\.fa-grille-prod \{[^}]*\}/)[0];
assert.match(GRILLES, /grid-template-columns: var\(--fa-lab-w\) 1fr var\(--fa-lab-w\) 1fr;/,
  '… lues là où elles sont écrites : trois rails recopiés, ce sont trois rails qui divergent');
assert.ok(!/justify-content: flex-end/.test(DETAILS) && !/justify-content: flex-end/.test(MOITIE),
  'jamais `flex-end` : il rogne par la gauche quand ça déborde');
// LA DERNIÈRE CASE FINIT SUR LE BORD DROIT, par une MARGE AUTOMATIQUE : c'est
// le nombre qu'on vient chercher, et `flex-end` ferait disparaître son début.
assert.match(CSS, /\.fa-case--fin \.fa-case__v > \*:first-child \{ margin-left: auto; \}/,
  'le reste à payer se colle à droite par une marge, jamais par `flex-end`');

// UNE CASE NE DÉBORDE PAS DE SA PISTE. `min-width: 0` est obligatoire : la
// largeur intrinsèque d'un `<input>` ou d'un `<select>` l'emporte sinon sur la
// piste, et la moitié sort de sa colonne. (Avant la grille, c'était
// `flex-shrink: 0` qui tenait ce rôle : sans lui, « 26,05 € » passait à la
// ligne DANS sa bulle, 61 px de haut pour une police de 21.)
const CASE = CSS.match(/\.fa-case \{[^}]*\}/)[0];
assert.match(CASE, /min-width: 0/, 'une case ne déborde pas de sa piste');
assert.match(CSS, /\.fa-case__v \{[^}]*white-space: nowrap;/,
  'et son montant ne s’enroule pas');
// ET LE MONTANT PART DU RAIL DE SON INTITULÉ. Un champ de la fiche est inséré
// de son rembourrage ; dans les colonnes ça ne se voit pas, l'intitulé est sur
// un AUTRE rail. Ici il est juste au-dessus. Le rembourrage rendu, c'est aussi
// 20 px de moins pour le montant : « 1 250,50 € » débordait de 2 px du coût et
// de 9 px du prix TTC — mesuré au rendu le 29/08.
// DEPUIS LE 30/08 LES DEUX TIENNENT (Charlie : « la bulle a un problème, les
// écritures sont collées à gauche de la bulle »). Le rembourrage revient À
// GAUCHE SEULEMENT, et une marge négative de la même valeur rend au texte sa
// place : la boîte grandit vers la gauche, le texte ne bouge pas, et rien
// n'est perdu en largeur.
{
  const regle = CSS.match(/\.fa-details \.fa-in, \.fa-details \.fa-choix \{[^}]*\}/);
  assert.ok(regle, 'les champs de la bande ont leur règle');
  assert.match(regle[0], /padding: 0 0 0 var\(--pas-2\);/,
    'le rembourrage revient, à gauche seulement — des deux côtés il coûte 20 px au montant');
  assert.match(regle[0], /margin-left: calc\(var\(--pas-2\) \* -1\);/,
    '… et la marge négative rend au texte le rail de son intitulé');
}

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
