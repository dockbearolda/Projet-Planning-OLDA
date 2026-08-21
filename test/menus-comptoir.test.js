'use strict';

// LES MENUS DÉROULANTS DU COMPTOIR
//
// Un seul modèle pour les deux écrans : le <select> natif affichait la
// désignation puis la référence, et la coupait — la vendeuse lisait « T-shirt
// bio léger Premium 155 g » sans jamais voir « NS300 ». Le composant vit dans
// `comptoir/pont.js` : il HABILLE les champs au lieu de les remplacer.
//
// Ce fichier tient les quatre choses qui casseraient en silence :
//   1. L'HÔTE RESTE — le <select> et l'<input list> sont toujours là, avec
//      leur valeur, leur `onchange` et leurs options.
//   2. L'ORDRE DE LA LIGNE — référence d'abord, désignation derrière.
//   3. LES ÉCRITURES PAR PROGRAMME — un `.value` posé à la main ne déclenche
//      rien : le champ fermé doit être repeint.
//   4. LES SORTIES — champ manquant, saisie libre, chargement.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const DEVIS = fs.readFileSync(path.join(RACINE, 'public/comptoir/demande-devis.html'), 'utf8');
const VENTE = fs.readFileSync(path.join(RACINE, 'public/comptoir/vente-directe.html'), 'utf8');
const PONT = fs.readFileSync(path.join(RACINE, 'public/comptoir/pont.js'), 'utf8');

// Le corps d'une fonction, accolades comptées. Une expression régulière s'y
// casse les dents : elle s'arrête au premier `}` en début de ligne, c'est-à-dire
// à la fin du premier `if` — et le test passe alors sur un bout de fonction.
function bloc(src, nom) {
  const depart = src.search(new RegExp(`function ${nom}\\(`));
  if (depart < 0) return '';
  let i = src.indexOf('{', depart), profondeur = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') profondeur++;
    else if (src[j] === '}' && --profondeur === 0) return src.slice(depart, j + 1);
  }
  return '';
}
// Garde-fou : sans lui, une extraction tronquée ferait passer les tests d'ordre
// pour de mauvaises raisons (deux `indexOf` à -1 se valent).
assert.ok(bloc(PONT, 'menuPeindre').includes('menu-option-texte'),
  'l’extraction de menuPeindre doit couvrir toute la fonction');

// --- 1. L'hôte reste ---------------------------------------------------------

// Le composant n'est qu'une peau. Si l'hôte disparaissait, TOUT le formulaire
// tomberait : `.value`, les `onchange="…"` en attribut, et les options que le
// code réécrit en cours de route (catalogue, coloris, genres).
assert.ok(/<select id="txRef" onchange="onTextileRefChange\(\)"/.test(DEVIS),
  'la référence reste un <select> : c’est lui qui porte valeur et évènement');
assert.ok(/<input id="txColor" list="txColorList"/.test(DEVIS),
  'la couleur reste un champ LIBRE : la vendeuse peut saisir hors catalogue');
assert.ok(/hote\.tagName!=='SELECT'/.test(PONT), 'le composant distingue le menu fermé du menu libre');
assert.ok(/hote\.replaceWith\(peau\);\s*peau\.append\(hote\)/.test(PONT),
  'l’hôte est déplacé DANS la peau, jamais retiré de la page');

// Le composant vit dans pont.js pour que les DEUX écrans du comptoir aient les
// mêmes menus — et qu'un écran remplacé par le patron ne l'emporte pas.
assert.ok(/window\.menusPoserTous\s*=/.test(PONT) && /window\.menuRafraichir\s*=/.test(PONT),
  'pont.js expose de quoi poser et rafraîchir les menus');
[['demande-devis', DEVIS], ['vente-directe', VENTE]].forEach(([nom, src]) => {
  assert.ok(/<script src="pont\.js"><\/script>/.test(src), `${nom} charge pont.js`);
});
// pont.js est chargé APRÈS le script de la page, qui s'initialise au fil de sa
// lecture : sans ces relais, le premier appel lèverait une erreur et
// l'initialisation entière s'arrêterait là.
assert.ok(/window\.menusPoserTous=window\.menusPoserTous\|\|\(\(\)=>\{\}\)/.test(DEVIS),
  'la page pose des relais le temps que pont.js arrive');

// --- 2. La référence ouvre la ligne -----------------------------------------

assert.ok(/o\.dataset\.ref=r\.ref/.test(DEVIS),
  'chaque option porte sa référence : c’est elle qui devient le jeton');
const peindreListe = bloc(PONT, 'menuPeindre');
assert.ok(peindreListe.indexOf("className='menu-jeton'") < peindreListe.indexOf("className='menu-option-texte'"),
  'dans la liste, le jeton de référence est posé avant la désignation');
const peindreChamp = bloc(PONT, 'menuPeindreChamp');
assert.ok(peindreChamp.indexOf("className='menu-jeton'") < peindreChamp.indexOf("className='menu-texte'"),
  'dans le champ fermé, le jeton de référence est posé avant la désignation');
// Le tri par référence rend la colonne de gauche lisible d'un trait.
assert.ok(/\.sort\(\(a,b\)=>a\.ref\.localeCompare\(b\.ref,'fr',\{numeric:true\}\)\)/.test(DEVIS),
  'les références se rangent par référence dans leur groupe');
// Les <optgroup> deviennent les titres de famille, collés en haut au défilement.
assert.ok(/n\.tagName==='OPTGROUP'/.test(PONT), 'un optgroup devient un titre de famille');

// La teinte d'un coloris est une information, pas une décoration : sans elle
// « Wet Sand » ne dit rien.
assert.ok(/if\(hex\)o\.dataset\.hex=hex/.test(DEVIS), 'chaque coloris emporte sa teinte');
assert.ok(/className='menu-pastille'/.test(PONT), 'la teinte devient une pastille');

// --- 3. Les écritures par programme -----------------------------------------

// Poser `.value` à la main ne déclenche AUCUN évènement : sans repeinture, le
// champ fermé continuerait d'afficher l'ancien choix — le pire des bugs, celui
// qui ne se voit qu'à la relecture du devis.
['txApplyToForm', 'cancelTextileEdit'].forEach((f) => {
  assert.ok(/menusRafraichirTous\(\)/.test(bloc(DEVIS, f)),
    `${f} pose des valeurs par programme : les champs fermés doivent suivre`);
});
assert.ok(/menuRafraichir\(\$\('txRef'\)\)/.test(bloc(DEVIS, 'onTextileRefChange')),
  'changer de référence repeint le champ de la référence');
assert.ok(/\[\$\('txRef'\),\$\('txPrintType'\),\$\('txMarkColor'\)\]\.forEach\(menuRafraichir\)/.test(DEVIS),
  'remplir le catalogue repeint les champs qu’il vient de réécrire');

// Les options sont relues À CHAQUE ouverture : le formulaire les réécrit en
// cours de route (coloris d'une référence, genres d'une famille).
assert.ok(/function menuFiltrees\(etat\)\{\s*const toutes=menuOptions\(etat\.hote\)/.test(PONT),
  'la liste se construit sur les options du moment, jamais sur une copie figée');

// --- 4. Les sorties ----------------------------------------------------------

// fail('txRef') doit rougir ce que la vendeuse VOIT. Marquer le <select> caché
// ne montrerait rien du tout.
assert.ok(/const peau=el\.closest\('\.menu'\),cible=peau&&el\.tagName==='SELECT'\?peau:el/.test(DEVIS),
  'un menu fermé fait rougir sa peau, pas le <select> caché');
assert.ok(/focusable\.focus\(\)/.test(DEVIS), 'le focus va sur le déclencheur, qui est visible');
assert.ok(/menuEffacerRouge\(etat\)/.test(PONT), 'choisir efface le rouge du champ manquant');
assert.ok(/dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/.test(PONT),
  'choisir déclenche `change` : c’est lui qui porte les onchange du formulaire');

// Un menu qui n'a pas encore d'options ne doit pas s'ouvrir sur du vide.
assert.ok(/if\(!options\.length\)return;/.test(PONT),
  'un menu sans options ne s’ouvre pas — le catalogue peut n’être pas encore là');

// Sous le seuil, un champ de filtre est du bruit : « Maritime / Chronopost »
// se lit d'un coup d'œil.
assert.ok(/MENU_SEUIL_FILTRE = 8/.test(PONT), 'le filtre n’apparaît qu’au-delà d’un seuil');
assert.ok(/const filtrable=!etat\.libre&&toutes>MENU_SEUIL_FILTRE/.test(PONT),
  'un menu libre se filtre en tapant dans le champ, pas dans une deuxième case');

// Le clavier fait tout : le comptoir est un poste PC.
const touche = bloc(PONT, 'menuTouche');
['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape', 'Tab'].forEach((k) => {
  assert.ok(touche.includes(`'${k}'`), `la touche ${k} doit être traitée`);
});
assert.ok(/normalize\('NFD'\)/.test(bloc(PONT, 'menuNorm')),
  'le filtre ignore les accents : « debardeur » doit trouver « Débardeur »');
assert.ok(/addEventListener\('pointerdown'/.test(PONT),
  'un clic dehors referme AVANT que le clic n’atteigne ce qu’il visait');

// La ligne d'essai du fichier du patron n'a jamais rien à faire dans le menu.
assert.ok(/db\.refs\.filter\(r=>r\.genre&&r\.designation&&r\.designation!=='TEST'\)/.test(DEVIS),
  'la ligne « TEST » reste hors du menu de la vendeuse');

// --- La police, servie par nous ----------------------------------------------

// Manrope venait de fonts.googleapis.com : hors ligne, la page retombait en
// silence sur Arial. Rien ne doit venir d'un autre domaine.
[['demande-devis', DEVIS], ['vente-directe', VENTE]].forEach(([nom, src]) => {
  // On cherche un CHARGEMENT, pas une mention : le commentaire qui explique
  // pourquoi Google Fonts est parti a le droit de nommer le domaine.
  assert.ok(!/(href|src|url\()\s*=?\s*["'(]?https?:\/\/fonts\./.test(src),
    `${nom} ne charge plus de police d’un autre domaine`);
  assert.ok(/url\('\.\.\/inter-latin-variable\.woff2'\)/.test(src), `${nom} sert la police lui-même`);
  assert.ok(/font-display:swap/.test(src), `${nom} affiche le texte tout de suite, Arial fait le relais`);
});
assert.ok(fs.existsSync(path.join(RACINE, 'public/inter-latin-variable.woff2')), 'le fichier de police est là');
assert.ok(fs.existsSync(path.join(RACINE, 'public/inter-LICENCE.txt')), 'sa licence voyage avec lui');
assert.ok(/'\/inter-latin-variable\.woff2'/.test(fs.readFileSync(path.join(RACINE, 'public/sw.js'), 'utf8')),
  'la police est dans la coquille : hors ligne, le poste garde sa tête');

console.log('✓ menus du comptoir : un seul modèle sur les deux écrans, la référence ouvre la ligne, la police est à nous');
