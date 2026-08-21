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
assert.ok(/function menuFiltrees\(etat\)\{[\s\S]{0,260}?const toutes=menuOptions\(etat\.hote\)/.test(PONT),
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

// La liste NATIVE doit être débranchée du champ : tant que `list` reste posé,
// Chrome ouvre la sienne — fond sombre, deuxième chevron — PAR-DESSUS la nôtre.
// Le <datalist> reste dans la page, c'est le formulaire qui le remplit par son id.
const poser = bloc(PONT, 'menuPoser');
assert.ok(/hote\.dataset\.menuListe=hote\.getAttribute\('list'\);\s*hote\.removeAttribute\('list'\)/.test(poser),
  'le champ libre perd son attribut `list` : sinon la liste native s’ouvre par-dessus');
assert.ok(/hote\.setAttribute\('autocomplete','off'\)/.test(poser),
  'les saisies mémorisées du navigateur se superposeraient pareil');
assert.ok(/document\.getElementById\(hote\.dataset\.menuListe\|\|hote\.getAttribute\('list'\)\)/.test(PONT),
  'les options se relisent par le nom retenu');
assert.ok(/<datalist id="txColorList">/.test(DEVIS) && /<datalist id="txMarkColorList">/.test(DEVIS),
  'les <datalist> restent dans la page : le formulaire les remplit par leur id');

// CLIQUER MONTRE TOUT. Un champ libre contient déjà une valeur : filtrer dessus
// à l'ouverture ne laissait voir QUE cette valeur — « Multi couleur » cachait
// les dix-sept autres couleurs de marquage. C'est exactement le bug remonté.
assert.ok(/etat\.filtrer=false;\s*\/\* on ouvre sur la liste ENTIÈRE \*\//.test(PONT),
  'ouvrir un champ libre montre la liste entière, pas seulement sa valeur');
assert.ok(/const brut=etat\.libre\?\(etat\.filtrer\?etat\.hote\.value:''\):etat\.filtre\.value/.test(PONT),
  'le filtre d’un champ libre ne part qu’à la première frappe');

// Le panneau est plus large que son champ : celui de la dernière colonne
// débordait de la page et la faisait défiler de côté.
assert.ok(/function menuPlacer\(etat\)/.test(PONT) && /panneau\.style\.right='0'/.test(PONT),
  'un panneau qui ne tient pas à droite se retourne');
assert.ok(/menuPlacer\(etat\);/.test(bloc(PONT, 'menuOuvrir')),
  'le placement se recalcule à chaque ouverture');

// Une couleur de marquage doit se VOIR : « Vert » et « Vert pastel » ne se
// distinguent pas par leur nom.
const CAT = fs.readFileSync(path.join(RACINE, 'public/comptoir/textile-catalog.js'), 'utf8');
global.window = global.window || {};
require(path.join(RACINE, 'public/comptoir/textile-catalog.js'));
const TE = global.window.TextileEngine;
TE.DB.markingColors.forEach((nom) => assert.ok(TE.markColorHexFor(nom),
  `« ${nom} » doit avoir sa teinte d’affichage`));
assert.strictEqual(TE.markColorHexFor('  VERT PASTEL '), TE.DB.markingColorsHex['Vert pastel'],
  'la casse et les espaces ne doivent pas éteindre la pastille');
assert.strictEqual(TE.markColorHexFor('Teinte maison'), null,
  'une couleur hors liste n’invente pas de pastille');
// « Multi couleur » n'est pas une teinte : elle se montre en dégradé.
assert.ok(/gradient/.test(TE.markColorHexFor('Multi couleur')),
  '« Multi couleur » se montre en dégradé — c’est ce qu’elle veut dire');
assert.ok(/const hex=TE\(\)\.markColorHexFor\(x\)/.test(DEVIS),
  'chaque couleur de marquage emporte sa teinte dans la liste');

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
  assert.ok(/url\('\.\.\/manrope-latin-variable\.woff2'\)/.test(src), `${nom} sert la police lui-même`);
  assert.ok(/font-display:swap/.test(src), `${nom} affiche le texte tout de suite, Arial fait le relais`);
  // UN CHAMP N'HÉRITE PAS DE LA POLICE DU CORPS : Chrome impose Arial à un
  // `input`, un `select` et un `button`, et du MONOSPACE à une zone de texte.
  // Sans cette règle l'écran est bariolé champ par champ, ce qui saute aux
  // yeux sur un poste Windows. `inherit` et non un nom en dur : dans le ticket
  // de l'atelier, qui compose en Courier, les champs restent en Courier.
  assert.ok(/input,select,textarea,button\{font-family:inherit!important\}/.test(src),
    `${nom} : champs, listes et boutons prennent la police de la page`);
});
assert.ok(fs.existsSync(path.join(RACINE, 'public/manrope-latin-variable.woff2')), 'le fichier de police est là');
// SIL OFL : le texte de licence accompagne le fichier, sinon on ne peut pas
// le redistribuer.
assert.ok(fs.existsSync(path.join(RACINE, 'public/manrope-LICENCE.txt')), 'la licence de la police voyage avec elle');
assert.ok(/'\/manrope-latin-variable\.woff2'/.test(fs.readFileSync(path.join(RACINE, 'public/sw.js'), 'utf8')),
  'la police est dans la coquille : hors ligne, le poste garde sa tête');


// --- 5. L'AJOUT MANUEL, À LA MÊME PLACE PARTOUT ------------------------------
//
// Cinq listes portaient leur propre entrée libre — sous trois valeurs
// différentes (« + Saisie manuelle », « ➕ Nouvelle référence », « + Créer un
// nouveau »), noyée au milieu du catalogue — et les vingt autres n'en avaient
// aucune. La ligne vit maintenant DANS le composant, épinglée en tête du
// panneau, hors de la liste : ni emportée par un filtre, ni repoussée par le
// défilement.

assert.ok(/if\(avecManuel\)panneau\.append\(manuel,saisie\);\s*panneau\.append\(tete,liste\)/.test(PONT),
  'la ligne d’ajout manuel est posée AVANT le filtre et la liste — tout en haut du panneau');
assert.ok(/\.menu\.est-saisie \.menu-manuel,\.menu\.est-saisie \.menu-tete,\.menu\.est-saisie \.menu-liste\{display:none\}/.test(PONT),
  'pendant la saisie libre la liste s’efface : une seule façon de répondre à la fois');

// L'option libre déjà gérée par le formulaire n'apparaît pas DEUX fois : la
// ligne du haut y renvoie, et la liste ne la montre plus.
assert.ok(/const MENU_VALEURS_LIBRES=\['__new__','__manuel','__CUSTOM__'\]/.test(PONT),
  'les trois valeurs conventionnelles d’entrée libre sont reconnues d’office');
assert.ok(/const renvoi=menuRenvoiManuel\(etat\.hote\);\s*const toutes=menuOptions\(etat\.hote\)\.filter\(o=>renvoi===undefined\|\|o\.valeur!==renvoi\)/.test(PONT),
  'l’option vers laquelle la ligne renvoie sort de la liste — sinon elle y est deux fois');

// UNE VALEUR LIBRE NE DOIT JAMAIS DEVENIR UNE CLÉ DE BARÈME. `DB.times[x]` et
// `DB.printTypes[x]` rendent `{}` pour une valeur inconnue : le marquage
// tomberait à 0 € SANS erreur, et le devis partirait sous-facturé.
['txTgca', 'txTransport', 'txGenre', 'txPrintType', 'desiredDelay', 'desiredTime', 'controlStatus']
  .forEach(id => {
    assert.ok(new RegExp(`<select id="${id}" data-menu-manuel-non`).test(DEVIS),
      `${id} porte un CODE, pas un libellé : pas d’ajout manuel`);
  });
assert.ok(/<select id="deliveryTime" data-menu-manuel-non/.test(VENTE),
  'une heure de retrait ne se saisit pas librement');
assert.ok(/select\.setAttribute\('data-menu-manuel-non', ''\)/.test(PONT),
  'l’indicatif du pays non plus : « 590 » ou rien');

// Ce qui est tapé devient une option RÉELLE de la liste — le formulaire lit
// toujours `.value`, il n'a rien de spécial à savoir. Et une deuxième saisie
// identique réutilise la même option, sinon la liste se remplit de doublons
// au fil de la journée.
assert.ok(/if\(!\[\.\.\.hote\.options\]\.some\(o=>o\.value===texte\)\)\{/.test(PONT),
  'une valeur déjà saisie ne crée pas une deuxième option');
assert.ok(/menuManuelFermer\(etat\);\s*menuChoisir\(etat,texte\)/.test(PONT),
  'valider choisit la valeur : `change` part, le rouge s’efface, le formulaire suit');

// Le panneau ne se rouvre jamais en cours de frappe libre, et se referme à plat.
assert.ok(/etat\.filtrer=false;[^\n]*\n\s*etat\.peau\.classList\.remove\('est-saisie'\)/.test(PONT),
  'ouvrir un menu repart de la liste, jamais du champ libre resté ouvert');
assert.ok(/etat\.peau\.classList\.remove\('est-ouvert'\);\s*etat\.peau\.classList\.remove\('est-saisie'\)/.test(PONT),
  'fermer un menu referme aussi la saisie libre');

// --- 6. LE NUMÉRO DE LA LIGNE EN COURS ---------------------------------------
//
// Six branches écrivaient « Article n°X » / « Modifier l'article n°X ». Le
// texte et l'état passent maintenant par le même endroit, sinon l'un des deux
// finit par être oublié dans une des six.
assert.ok(/function poserTitreForm\(id,texte,enEdition\)\{[\s\S]*?classList\.toggle\('is-edit',!!enEdition\)/.test(DEVIS),
  'le texte de la bulle et sa couleur se posent ensemble');
assert.ok(!/\$\('(tx|need)FormTitle'\)\.textContent=/.test(DEVIS),
  'plus aucune branche n’écrit le titre en direct — elles passeraient à côté de l’état');
assert.ok(/<h3 class="form-num" id="txFormTitle">/.test(DEVIS) && /<h3 class="form-num" id="needFormTitle">/.test(DEVIS),
  'les deux formulaires portent la même bulle');
assert.ok(/\.form-num\.is-edit\{background:var\(--orange\)\}/.test(DEVIS),
  'la couleur dit l’état : sombre on ajoute, orange on reprend une ligne déjà posée');

// --- 7. LE CADRE DE CHIFFRAGE NE RESTE PAS VIDE ------------------------------
assert.ok(/<div class="tx-preview hidden" id="txPreview"><\/div>/.test(DEVIS),
  'le cadre part masqué : sans prix à montrer il n’a rien à dire');
assert.ok(/box\.classList\.add\('hidden'\);\s*return;\s*\}\s*box\.classList\.remove\('hidden'\)/.test(DEVIS),
  'il s’efface tant qu’il n’y a pas de prix, et revient dès qu’il y en a un');
// Un catalogue en échec est une ERREUR, pas une attente : elle doit se voir.
assert.ok(/Recharge la page\.';\s*\$\('txPreview'\)\.classList\.remove\('hidden'\)/.test(DEVIS),
  'le catalogue qui ne charge pas se dit à l’écran, cadre masqué ou non');

console.log('✓ menus du comptoir : un seul modèle sur les deux écrans, la référence ouvre la ligne, la police est à nous');
