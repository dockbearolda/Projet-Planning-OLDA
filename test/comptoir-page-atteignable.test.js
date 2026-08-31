'use strict';

// ON NE RETIRE PAS LE DÉFILEMENT À UNE PAGE QUI N'A PERSONNE POUR LE REPRENDRE
// ===========================================================================
// (29/08/2026 — trouvé en mesurant la vente directe à 1366 × 700.)
//
// `pont.js` pose, pour les écrans du comptoir au-dessus de 981 px de large :
//
//     html,body{height:100%;overflow:hidden}
//     .layout>main{min-height:0;overflow-y:auto}     ← la colonne qui défile
//
// L'intention est bonne et elle est écrite juste au-dessus : « seule la colonne
// de saisie défile », pour que la rangée d'étapes et le panier ne glissent pas
// d'un pixel. Elle suppose seulement une chose — qu'il EXISTE une colonne à qui
// donner le défilement.
//
// LA VENTE DIRECTE N'EN A PAS. Elle n'a ni `.layout` ni `<main>` : ses cartes
// sont posées à la suite dans `.container`. Le document perdait donc son
// défilement sans que personne ne le reprenne, et la page se coupait net à la
// hauteur de la fenêtre. Mesuré : `.container` demandait 1665 px dans 700,
// « Ajouter l'article » tombait 147 px SOUS le bas de l'écran, la molette ne
// faisait rien. **La vendeuse ne pouvait pas ajouter un article** sur un
// portable 1366 × 768. Rien ne le signalait : aucune erreur, aucun test rouge,
// et à 950 px de fenêtre — la taille d'un grand écran de bureau — le bouton
// était visible, seulement rogné de 23 px par la barre du bas.
//
// D'où ce fichier : le contrat se vérifie des DEUX côtés, la règle et la page.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');

const PONT = lire('public/comptoir/pont.js');

// --- 1. LA RÈGLE EST CONDITIONNÉE -------------------------------------------
assert.match(PONT, /const colonneQuiDefile = !!document\.querySelector\('\.layout > main'\);/,
  'pont.js doit CHERCHER la colonne avant de retirer le défilement du document');
assert.match(PONT, /colonneQuiDefile \? \[\s*\n\s*'@media screen and \(min-width:981px\)\{',/,
  '… et n’écrire le bloc que si elle existe');

// Le verrou et la colonne vivent dans le MÊME bloc : séparés, l'un pourrait
// partir sans l'autre, et c'est exactement le défaut qu'on vient de fermer.
const bloc = PONT.slice(PONT.indexOf('colonneQuiDefile ? ['), PONT.indexOf("].join('') : ''"));
assert.ok(bloc.includes("'html,body{height:100%;overflow:hidden}'"),
  'le verrou est dans le bloc conditionné');
assert.ok(bloc.includes("'.layout>main{min-height:0;overflow-y:auto;padding-bottom:var(--pas-4)}'"),
  '… avec la colonne qui reprend le défilement, dans le même bloc');

// LE CADRE GARDE SA MARGE HAUTE, celle de `charte.css`, qui pose les DEUX
// parcours à la même ordonnée. Ce bloc ne s'écrit que sur la demande de devis
// — elle seule a la colonne — donc tout ce qu'il fait à la marge du haut ne
// touche QU'ELLE, et les deux écrans se décalent l'un de l'autre sans que rien
// ne le signale. Payé le 30/08 : un `margin-top:0` ici posait la bulle
// « 1. Besoins » à 10 px quand « 1. Articles » tombait à 34.
// La hauteur doit alors défalquer cette marge, sinon le cadre dépasse d'autant
// et le `overflow:hidden` ci-dessus rogne le bas de la colonne.
assert.ok(!/margin-top:\s*0/.test(bloc),
  'le bloc du devis ne remet pas à zéro la marge haute du cadre : elle seule aligne '
  + 'sa rangée d’étapes sur celle de la vente directe');
assert.ok(bloc.includes('.container{height:calc(100% - var(--pas-4))'),
  '… et il défalque cette marge de la hauteur, sinon le bas de la colonne est rogné');

// --- 2. LES DEUX PAGES, TELLES QU'ELLES SONT --------------------------------
// On ne les corrige pas ici : les écrans du comptoir viennent du patron et se
// remplacent en entier (CLAUDE.md). On vérifie seulement que la greffe suit ce
// qu'elles sont — c'est elle qui doit s'adapter, pas l'inverse.
const DEVIS = lire('public/comptoir/demande-devis.html');
const VENTE = lire('public/comptoir/vente-directe.html');

assert.ok(/<main\b/.test(DEVIS) && /class="layout"/.test(DEVIS),
  'la demande de devis a bien la colonne : elle garde le défilement interne');
assert.ok(!/<main\b/.test(VENTE),
  'la vente directe n’a pas de colonne : si elle en gagne une, le verrou s’appliquera '
  + 'à elle aussi — vérifier alors que « Ajouter l’article » reste atteignable');

// --- 3. LA BARRE DU BAS N'EMPRISONNE RIEN -----------------------------------
// Elle est `sticky` DANS `.container` : elle occupe donc sa propre place à la
// fin du flux, et aucun contenu ne peut rester coincé dessous. Si elle passait
// en `fixed`, il faudrait rendre sa hauteur au rembourrage bas du conteneur.
const VENTE_CSS = lire('public/comptoir/vente-directe.css');
const barre = VENTE_CSS.match(/\.tablet-wizard-nav\s*\{[^}]*\}/);
assert.ok(barre, 'la barre de navigation du bas existe');
assert.ok(!/position:\s*fixed/.test(barre[0]),
  'elle reste dans le flux (`sticky`) : `fixed` la sortirait, et le dernier bloc de '
  + 'la page finirait dessous sans que rien ne le pousse');

console.log('✓ comptoir : aucune page ne perd son défilement sans que quelqu’un le reprenne');
