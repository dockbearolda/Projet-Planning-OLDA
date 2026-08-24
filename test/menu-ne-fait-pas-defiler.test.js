'use strict';

// UN MENU QUI S'OUVRE NE DÉPLACE RIEN (24/08/2026)
//
// « Quand je clique sur cet input, ça le décale. J'ai l'impression que le site
//   local bug et ne réagit pas comme mon site en ligne sur Railway. »
//
// C'ÉTAIT JUSTE, ET C'ÉTAIT NOUS. Mesuré : cliquer sur « Transport » déplaçait
// le champ de 332,5 px vers la gauche. Rien ne bougeait dans la mise en page —
// c'est <main> qui DÉFILAIT de 333 px sur le côté.
//
// Pourquoi seulement en local : le même jour, `.layout>main` a reçu
// `overflow-y:auto` pour que seule la colonne de saisie défile. En CSS, dès
// qu'un axe n'est plus `visible`, l'autre passe de `visible` à `auto` :
// <main> est devenu un conteneur qui défile AUSSI de côté, sans qu'on le
// demande. Le panneau du menu (560 px) ouvert dans une cellule de 178 le
// faisait déborder, et le navigateur décalait <main> pour le montrer.
// Ce commit n'est pas sur `main`, donc la prod n'avait pas le défaut.
//
// Le garde-fou tient les deux bouts : la cause (le panneau doit sortir du
// conteneur qui défile) et la mesure (les bornes ne sont pas la fenêtre).

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const PONT = fs.readFileSync(path.join(RACINE, 'public/comptoir/pont.js'), 'utf8');

// --- 1. Le panneau sort du conteneur qui défile ----------------------------
// En position absolue il restait DEDANS : quoi qu'on calcule, il comptait dans
// la largeur défilable. C'est la seule correction qui ferme le problème.
assert.ok(/\.menu-panneau\{position:fixed/.test(PONT),
  'le panneau est hors du flux du conteneur : il ne peut plus l’élargir');
assert.ok(!/\.menu-panneau\{position:absolute/.test(PONT),
  '… et il n’y retourne pas');

// EN POSITION FIXE, UN POURCENTAGE PARLE DE LA FENÊTRE. La largeur ne peut
// donc plus se déduire du champ en CSS : elle est posée en pixels.
assert.ok(/panneau\.style\.width=Math\.round\(largeur\)\+'px'/.test(PONT),
  'la largeur est calculée depuis le champ, pas héritée en pourcentage');

// --- 2. Les bornes ne sont pas la fenêtre ---------------------------------
// L'ancien test comparait à `window.innerWidth`. <main> fait 651 px dans une
// fenêtre de 1103 : le panneau « tenait » dans la fenêtre et débordait <main>.
assert.ok(/function menuBornes\(peau\)/.test(PONT),
  'les bornes se prennent sur les ancêtres qui coupent ou qui défilent');
const bornes = PONT.match(/function menuBornes\(peau\)\{[\s\S]*?\n\}/);
assert.ok(bornes, 'menuBornes est définie');
assert.ok(/overflowX==='visible'&&cs\.overflowY==='visible'\)continue/.test(bornes[0]),
  '… on saute ceux qui ne coupent rien');
assert.ok(/Math\.min\(b\.droite,r\.right\)/.test(bornes[0]) && /Math\.max\(b\.gauche,r\.left\)/.test(bornes[0]),
  '… et on prend l’INTERSECTION, pas le premier venu');

const placer = PONT.match(/function menuPlacer\(etat\)\{[\s\S]*?\n\}/);
assert.ok(placer, 'menuPlacer est définie');
assert.ok(/menuBornes\(peau\)/.test(placer[0]),
  'le placement passe par les bornes réelles');
assert.ok(!/window\.innerWidth/.test(placer[0]),
  '… et plus jamais par la largeur de la fenêtre — c’était tout le défaut');

// --- 3. Un panneau posé en coordonnées de fenêtre ne suit pas le défilement -
// Il resterait planté pendant que son champ s'en va. On le referme.
// En CAPTURE (`true`) : le défilement d'un conteneur ne remonte PAS jusqu'au
// document, et <main> est précisément un conteneur.
assert.ok(/window\.addEventListener\('scroll',\(\)=>\{menus\.forEach\(a=>menuFermer\(a,false\)\)\},true\)/.test(PONT),
  'un défilement referme les menus, et l’écoute est en capture');
assert.ok(/window\.addEventListener\('resize',\(\)=>\{menus\.forEach\(a=>menuFermer\(a,false\)\)\}\)/.test(PONT),
  '… et un redimensionnement aussi');

// --- 4. Le bloc CSS vit dans un littéral de gabarit ------------------------
// UN ACCENT GRAVE Y REFERME LA CHAÎNE. C'est arrivé en écrivant ce correctif :
// un commentaire qui citait `fixed` entre accents graves a cassé tout pont.js,
// et la page s'ouvrait sans un seul menu.
const css = PONT.slice(PONT.indexOf('.menu-declencheur{'), PONT.indexOf('.menu-panneau{') + 400);
assert.ok(!/`/.test(css),
  'aucun accent grave dans le bloc CSS : il refermerait le littéral de gabarit');

console.log('✓ menu : le panneau sort du conteneur qui défile, et rien ne bouge quand il s’ouvre');
