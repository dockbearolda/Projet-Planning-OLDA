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
// ⚠ LE COMPOSANT A DÉMÉNAGÉ LE 01/09 : il vit dans `public/menu-recherche.js`,
// que les DEUX écrans du comptoir et le CRM importent (voir
// `menus-comptoir.test.js`). Les gardes de placement suivent le composant.
const PONT = fs.readFileSync(path.join(RACINE, 'public/menu-recherche.js'), 'utf8');
const CALENDRIER = fs.readFileSync(path.join(RACINE, 'public/calendrier.js'), 'utf8');

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
// ET EN PASSIF (26/08). L'écoute est posée sur `window`, en capture : elle voit
// donc CHAQUE défilement de l'écran. Sans la mention `passive`, Chrome doit
// attendre que le rappel ait rendu la main avant de composer l'image suivante,
// au cas où il appellerait `preventDefault()` — ce qu'il ne fait pas et ne peut
// pas faire ici. C'est une image d'attente offerte à chaque défilement, pour
// rien.
const ecouteScroll = PONT.match(/window\.addEventListener\('scroll',menuDefilementExterieur,([^)]*)\)/);
assert.ok(ecouteScroll, 'un défilement referme les menus');
assert.ok(/capture:\s*true/.test(ecouteScroll[1]) || ecouteScroll[1].trim() === 'true',
  '… et l’écoute est en capture — un conteneur qui défile ne remonte pas au document');
assert.ok(/passive:\s*true/.test(ecouteScroll[1]),
  '… et en passif : elle n’annule rien, elle ne doit donc rien faire attendre');

// --- 3 bis. MAIS SA PROPRE LISTE N'EST PAS « L'ÉCRAN QUI DÉFILE » ---------
// (Charlie, 27/08/2026 : « ce menu bug, ça ne doit pas arriver ».)
//
// La même écoute, en capture sur `window`, voyait AUSSI le défilement de la
// liste du panneau — et refermait le menu sous le doigt. Deux symptômes, une
// seule cause :
//   · à la molette, 82 produits sur 13 familles : la liste part, le menu ferme ;
//   · à l'OUVERTURE, `menuPeindreVise()` amène le choix en cours à l'écran par
//     `scrollIntoView`. Dès qu'on avait choisi un article situé plus bas que la
//     fenêtre de liste, le menu se refermait AU MOMENT MÊME où il s'ouvrait —
//     et ne se rouvrait plus jamais. Mesuré : « TC 01 », 68e de 82, liste
//     déroulée à 2921 px.
//
// Le garde-fou EXÉCUTE la règle plutôt que de la relire : on sort la fonction
// du fichier et on la fait tourner sur des objets factices. Une reformulation
// du test d'appartenance ne peut donc pas passer à côté.
const source = PONT.match(/function menuDefilementExterieur\(ev\)\{[\s\S]*?\n\}/);
assert.ok(source, 'le tri des défilements est une fonction nommée, donc lisible et testable');

function faireNoeud(enfants = []) {
  const n = { enfants };
  n.contains = (autre) => autre === n || enfants.some((e) => e.contains && e.contains(autre));
  return n;
}
const vm = require('node:vm');
function joue(ev, etats) {
  const fermes = [];
  const contexte = vm.createContext({
    ev,
    menus: new Map(etats.map((e, i) => [i, e])),
    menuFermer: (e) => { e.ouvert = false; fermes.push(e.nom); },
    // Les noeuds factices sont de simples objets : `instanceof Node` doit donc
    // les reconnaitre, sinon la garde tomberait pour la mauvaise raison.
    Node: Object,
  });
  vm.runInContext(`${source[0]}\nmenuDefilementExterieur(ev);`, contexte);
  return fermes;
}

const listeA = faireNoeud();
const panneauA = faireNoeud([listeA]);
const menuA = { nom: 'A', ouvert: true, panneau: panneauA };
const panneauB = faireNoeud([]);
const menuB = { nom: 'B', ouvert: true, panneau: panneauB };

// La liste du menu A défile : A reste ouvert. B, lui, n'a rien à voir avec ce
// geste — mais il est ailleurs à l'écran, et il se referme comme avant.
assert.deepStrictEqual(joue({ target: listeA }, [menuA, { ...menuB }]), ['B'],
  'le défilement de sa PROPRE liste ne referme pas le menu');

// Le document défile : tout se referme.
menuA.ouvert = true;
assert.deepStrictEqual(joue({ target: faireNoeud() }, [menuA, { ...menuB, ouvert: true }]).sort(), ['A', 'B'],
  '… mais un défilement venu d’ailleurs les referme tous, comme avant');

// Un menu déjà fermé ne se referme pas deux fois.
assert.deepStrictEqual(joue({ target: faireNoeud() }, [{ nom: 'C', ouvert: false, panneau: faireNoeud() }]), [],
  'un menu fermé est laissé tranquille');

// LE CALENDRIER SUIT LA MÊME RÈGLE, MAIS DEPUIS SON PROPRE FICHIER. Il est
// posé en coordonnées de fenêtre lui aussi : sans ça il restait en plan
// pendant que son champ s'en allait. `calOuvert`/`calFermer` sont PRIVÉS au
// module ES `calendrier.js` — pont.js ne peut pas les lire depuis sa propre
// écoute globale : c'est exactement ce que faisait l'ancienne version de ce
// garde-fou, en les injectant à la main dans un bac à sable qui ne existait
// pas en vrai. `calFermer` throw en silence à CHAQUE défilement du comptoir.
// Le calendrier ferme donc désormais sur son propre `window.addEventListener
// ('scroll', …)`, au même endroit que son `resize` déjà présent.
assert.ok(!/\bcalOuvert\b/.test(source[0]) && !/\bcalFermer\b/.test(source[0]),
  'pont.js ne référence plus des noms privés à calendrier.js — ils n’existent pas dans sa portée');
const ecouteScrollCal = CALENDRIER.match(/window\.addEventListener\('scroll',calFermer,([^)]*)\)/);
assert.ok(ecouteScrollCal, 'un défilement referme aussi le calendrier, depuis calendrier.js');
assert.ok(/capture:\s*true/.test(ecouteScrollCal[1]),
  '… en capture — un conteneur qui défile ne remonte pas au document');
assert.ok(/passive:\s*true/.test(ecouteScrollCal[1]),
  '… et en passif, comme le reste');

// --- 3 ter. LE DÉFILEMENT S'ARRÊTE AU BAS DE LA LISTE ---------------------
// Sans `overscroll-behavior`, la molette poursuivie en bout de liste part dans
// la page derrière — donc dans un défilement d'écran, donc dans la fermeture du
// menu, exactement quand on cherche le dernier article.
assert.match(PONT, /\.menu-liste\{[^}]*overscroll-behavior:contain/,
  'la liste retient le défilement au lieu de le passer à la page');
const ecouteResize = PONT.match(/window\.addEventListener\('resize',\(\)=>\{menus\.forEach\(a=>menuFermer\(a,false\)\)\}(?:,([^)]*))?\)/);
assert.ok(ecouteResize, '… et un redimensionnement aussi');
assert.ok(/passive:\s*true/.test(ecouteResize[1] || ''),
  '… lui aussi en passif');

// --- 3 bis. ON CHANGE D'ÉCRAN, LE PANNEAU S'EN VA (01/09) ------------------
// Le panneau est en `position: fixed`, hors de la vue qui l'a ouvert : le CRM
// masque sa section, et la liste déroulée se retrouve posée sur l'écran
// suivant, au-dessus de tout. Une fonction existait pour ça (`menuFermerTous`)
// et personne ne l'appelait — le commentaire du module décrivait le bug depuis
// le début. Le module s'en charge désormais lui-même, comme il le fait déjà au
// redimensionnement : un écran de plus n'a pas à y penser.
// ⚠ La ligne entière, pas `([^)]*)` : la fonction passée à l'écouteur contient
// elle-même des parenthèses, et la capture s'arrêtait au premier `)` — elle
// rendait « () » et le test échouait sur un code juste.
const ecouteHash = PONT.match(/window\.addEventListener\('hashchange',[\s\S]*?\);/);
assert.ok(ecouteHash, 'le module ferme ses menus quand on change d’écran');
assert.ok(/menuFermerTous\(\)/.test(ecouteHash[0]),
  '… en fermant TOUS les menus, pas seulement celui qu’il croit ouvert');
assert.ok(/passive:\s*true/.test(ecouteHash[0]),
  '… en passif, comme les deux autres écouteurs de fenêtre du module');
assert.ok(!/export function menuFermerTous/.test(PONT),
  '… et il ne demande plus aux écrans de l’appeler : la fonction reste, son export part');

// --- 4. Le bloc CSS vit dans un littéral de gabarit ------------------------
// UN ACCENT GRAVE Y REFERME LA CHAÎNE. C'est arrivé en écrivant ce correctif :
// un commentaire qui citait `fixed` entre accents graves a cassé tout pont.js,
// et la page s'ouvrait sans un seul menu.
const css = PONT.slice(PONT.indexOf('.menu-declencheur{'), PONT.indexOf('.menu-panneau{') + 400);
assert.ok(!/`/.test(css),
  'aucun accent grave dans le bloc CSS : il refermerait le littéral de gabarit');

console.log('✓ menu : le panneau sort du conteneur qui défile, et rien ne bouge quand il s’ouvre');
