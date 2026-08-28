'use strict';

const { ecran } = require('./ecran-comptoir');

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
const DEVIS = ecran('demande-devis');
const VENTE = ecran('vente-directe');
const PONT = fs.readFileSync(path.join(RACINE, 'public/comptoir/pont.js'), 'utf8');

// L'ÉCHELLE DE L'ÉCRAN (22/08/2026). Les tailles, graisses, interlignes et
// arrondis ne s'écrivent plus en dur : ils vivent dans des variables déclarées
// au `:root` de la page. Chercher « 13px » dans une règle ne prouverait donc
// plus rien — il faut RÉSOUDRE la variable avec la table de la page qui
// l'accueille. C'est aussi ce qui permet de comparer les deux écrans entre eux
// alors qu'un seul a encore ses valeurs en dur.
const CHARTE = fs.readFileSync(path.join(RACINE, 'public/charte.css'), 'utf8');
function jetonsDe(src, table = {}) {
  for (const m of src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/:root\s*\{([^}]*)\}/g)) {
    m[1].split(';').forEach((d) => {
      const i = d.indexOf(':');
      if (i > 0 && d.trim().startsWith('--')) table[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    });
  }
  return table;
}
// Ce que la PAGE voit : ses propres jetons, plus ceux de la charte si elle la
// charge. C'est aussi ce qui distingue les deux écrans — l'un l'a adoptée,
// l'autre pas encore.
function echelleDe(src) {
  const table = /<link[^>]+charte\.css/.test(src) ? jetonsDe(CHARTE) : {};
  return jetonsDe(src, table);
}
// Les déclarations posées sur UN sélecteur exact, cascade comprise : la même
// règle est écrite deux fois sur ces écrans (la feuille de base, puis celle qui
// impose). La dernière gagne, comme dans le navigateur.
function reglesDe(src, selecteur) {
  const out = {};
  // Les commentaires de ce dépôt CITENT des règles, accolades comprises : sans
  // les retirer d'abord, le découpage en règles part de travers.
  const net = src.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of net.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (m[1].replace(/\s+/g, '') !== selecteur.replace(/\s+/g, '')) continue;
    m[2].split(';').forEach((d) => {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).replace('!important', '').trim();
    });
  }
  return out;
}
function resoudre(valeur, table) {
  let v = String(valeur || '');
  for (let i = 0; i < 8 && v.includes('var('); i++) {
    v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*?)\s*)?\)/g,
      (_, nom, repli) => (nom in table ? table[nom] : (repli || '')));
  }
  return v.trim();
}
// « calc(1.375 * 1em + 13px * 2 + 3px) » → un nombre de pixels.
function pixels(expression, em) {
  const brut = String(expression).replace(/^calc\(/, '').replace(/\)$/, '')
    .replace(/1em/g, String(em)).replace(/px/g, '');
  assert.ok(/^[\d.+\-*/() ]+$/.test(brut), `« ${expression} » doit rester du calcul`);
  return Math.round(Function('return ' + brut)() * 100) / 100;
}

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
assert.ok(/function menuProposees\(etat\)\{[\s\S]{0,200}?return menuOptions\(etat\.hote\)\.filter/.test(PONT),
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
// débordait et faisait défiler de côté.
//
// LA PARADE A CHANGÉ LE 24/08. On le RETOURNAIT (`right:0`) quand il dépassait
// la fenêtre. Insuffisant : le panneau restait en position absolue DANS <main>,
// devenu conteneur défilant le même jour, et comptait dans sa largeur quoi
// qu'on calcule. Il est désormais posé en position FIXE, hors du conteneur, et
// ramené dans les bornes réelles — voir menu-ne-fait-pas-defiler.test.js.
assert.ok(/function menuPlacer\(etat\)/.test(PONT),
  'le panneau est placé à la main');
assert.ok(/if\(gauche\+largeur>b\.droite-marge\)gauche=b\.droite-marge-largeur/.test(PONT),
  'un panneau qui ne tient pas à droite est ramené à l’intérieur');
assert.ok(/if\(gauche<b\.gauche\+marge\)gauche=b\.gauche\+marge/.test(PONT),
  '… et il ne sort pas par la gauche pour autant');
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

// ON CHERCHE DANS LA BULLE, ET SUR TOUS LES MENUS (27/08/2026).
//
// La règle d'avant disait « deux recherches sur l'écran, et deux seulement » —
// la référence et le client — parce qu'un champ de filtre EN TÊTE DU PANNEAU
// est un deuxième champ pour la même question. Charlie l'a renversée : « la
// recherche se fait directement dans la bulle comme les sites haut de gamme,
// une recherche de pointe ultra intelligente PARTOUT sur l'app ».
//
// Les deux tiennent ensemble, parce que ce n'est plus le même objet : le champ
// ne s'ajoute plus SOUS la bulle, il DEVIENT la bulle. Il n'y a toujours qu'un
// seul champ pour une seule question — et le curseur y est déjà.
assert.ok(!/MENU_SEUIL_FILTRE/.test(PONT), 'plus de seuil qui pose un filtre tout seul');
assert.ok(/\.menu\.est-ouvert>\.menu-filtre\{/.test(PONT),
  'le champ de recherche se pose SUR le déclencheur, à sa place exacte');
assert.ok(/if\(!libre\)peau\.append\(filtre\)/.test(PONT),
  '… donc sur la peau du menu, pas dans le panneau');
assert.ok(/if\(!etat\.libre\)etat\.filtre\.focus\(\)/.test(PONT),
  'ouvrir un menu, c’est vouloir choisir : le curseur est dans la bulle, sur TOUS les menus');
assert.ok(/etat\.filtre\.placeholder=choisie&&choisie\.valeur/.test(PONT),
  'ce qui était choisi devient l’invite : on cherche sans perdre de vue ce qu’on remplace');

// LA RECHERCHE COMPREND CE QU'ON TAPE VRAIMENT. « NS300 », « ns 300 »,
// « n ns 300 », « NS-300 », « ns3 » désignent la même référence.
assert.ok(/function menuReduire\(s\)\{return menuNorm\(s\)\.replace\(\/\[\^a-z0-9\]\+\/g,''\)\}/.test(PONT),
  'les deux côtés se réduisent à leurs lettres et à leurs chiffres avant comparaison');
assert.ok(/if\(jeton&&jeton\.startsWith\(tout\)\)return 3/.test(PONT),
  'une référence qui COMMENCE par ce qu’on tape remonte en tête — le rang compte autant que le filtre');
assert.strictEqual((DEVIS.match(/data-menu-recherche/g) || []).length, 2,
  'deux listes seulement portent une recherche sur l’écran de devis');
assert.ok(/<select id="txRef"[^>]*data-menu-recherche/.test(DEVIS),
  '… la référence du catalogue');
assert.ok(/<select id="clientSelect"[\s\S]{0,200}?data-menu-recherche/.test(DEVIS),
  '… et le client, qui remplace l’ancienne pile de cartes cliquables');
assert.ok(!/data-menu-recherche/.test(VENTE), 'aucune sur l’écran de vente directe');

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
// UN CHAMP LIBRE S'ÉCRIT DÉJÀ : un gros bouton « Saisir autre chose » y est du
// bruit, il ne lui manque que de le DIRE. Une mention, pas une commande.
// LA MÊME LIGNE PARTOUT, champ libre compris. Un deuxième message au même
// endroit, formulé autrement, c'est déjà une hésitation.
assert.ok(!/menu-mention/.test(PONT),
  'plus de mention à part dans un champ libre : c’est « + Ajouter » comme ailleurs');
assert.ok(/if\(!etat\.libre&&!\[\.\.\.hote\.options\]\.some\(o=>o\.value===texte\)\)\{/.test(PONT),
  'un champ libre porte sa valeur directement — il n’a pas d’options où la ranger');
assert.ok(/\.menu\.est-saisie \.menu-manuel,\.menu\.est-saisie \.menu-tete,\.menu\.est-saisie \.menu-liste\{display:none\}/.test(PONT),
  'pendant la saisie libre la liste s’efface : une seule façon de répondre à la fois');

// L'option libre déjà gérée par le formulaire n'apparaît pas DEUX fois : la
// ligne du haut y renvoie, et la liste ne la montre plus.
assert.ok(/const MENU_VALEURS_LIBRES=\['__new__','__manuel','__CUSTOM__'\]/.test(PONT),
  'les trois valeurs conventionnelles d’entrée libre sont reconnues d’office');
assert.ok(/\(renvoi===undefined\|\|o\.valeur!==renvoi\)/.test(PONT),
  'l’option vers laquelle la ligne renvoie sort de la liste — sinon elle y est deux fois');
// « — Choisir une référence — » en tête de liste, mise en avant comme le choix
// EN COURS, alors que c'est exactement ce que le champ fermé affiche déjà.
assert.ok(/const rienChoisi=etat\.hote\.value==='';\s*return menuOptions\(etat\.hote\)\.filter\(o=>\s*\(renvoi===undefined\|\|o\.valeur!==renvoi\) && !\(rienChoisi&&o\.valeur===''\)\)/.test(PONT),
  'la ligne d’attente ne se propose pas tant que rien n’est choisi…');
// … mais elle revient ensuite : sur « Délai souhaité », « Non précisée » n'est
// pas un libellé d'attente, c'est une réponse — et le seul chemin de retour.
assert.ok(/rienChoisi&&o\.valeur===''/.test(PONT),
  '… et redevient proposable une fois une vraie valeur prise');
// LA RÉFÉRENCE, ELLE, N'EN A PLUS DU TOUT (23/08/2026). Elle est obligatoire :
// on ne revient jamais à « rien », et la ligne d'attente occupait la première
// place de la liste en répétant le champ fermé et le filtre. Elle est retirée
// du <select> lui-même, pas du composant — les autres champs la gardent.
assert.ok(!/Choisir une référence/.test(DEVIS.replace(/\/\*[\s\S]*?\*\//g, '')),
  'la liste des références n’a plus de ligne d’attente');
// SANS OPTION VIDE, LE NAVIGATEUR SÉLECTIONNE LA PREMIÈRE — « Nouvelle
// référence / produit libre » : le formulaire se serait ouvert en saisie libre.
assert.ok(/txFill\(\$\('txRef'\),noeuds\);[\s\S]{0,400}?\$\('txRef'\)\.value='';/.test(DEVIS),
  '… et la référence repart explicitement sur aucune option sélectionnée');
// Le compteur portait sur le contenu brut du <select> : « 49 / 50 » alors que
// rien n'était filtré.
assert.ok(/const toutes=menuProposees\(etat\)\.length;/.test(PONT),
  'le compteur compte ce qui est proposé, pas ce que le <select> contient');

// UNE VALEUR LIBRE NE DOIT JAMAIS DEVENIR UNE CLÉ DE BARÈME. `DB.times[x]` et
// `DB.printTypes[x]` rendent `{}` pour une valeur inconnue : le marquage
// tomberait à 0 € SANS erreur, et le devis partirait sous-facturé.
// (txTgca a quitté la liste le 24/08 : la TGCA n'est plus un <select> global,
// c'est une case par article, sous le prix du volet « Détails ».)
// (controlStatus est parti le 27/08 avec l'étape « Contrôle ».)
['txTransport', 'txGenre', 'txPrintType', 'desiredDelay', 'desiredTime']
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
assert.ok(/\.form-num\.is-edit\{color:var\(--warning\)\}/.test(DEVIS),
  'la couleur dit l’état : ambre quand on reprend une ligne déjà posée');
// TOUT L’ARTICLE est détouré, pas seulement son titre : ses dix champs se
// mélangeaient aux réglages de la page (majoration, TGCA, réglages de
// production) et on ne voyait plus où commençait la ligne en cours d’écriture.
// Depuis le 24/08 (« trois niveaux, jamais plus »), le cadre est celui d'une
// carte de PREMIER niveau : liseré de carte, arrondi de carte, fond blanc —
// partagé avec `.bloc`. L'article reste détouré, c'est ça qui compte.
assert.ok(/\.bloc,\.article-bloc\{border:1px solid var\(--card-border\);border-radius:var\(--arrondi-carte\);/.test(DEVIS),
  'l’article en cours de saisie porte un cadre');
assert.ok(/<div class="article-bloc"><div class="form-tete"><h3 class="form-num" id="txFormTitle">/.test(DEVIS)
  && /<div id="besoinManuel" class="hidden article-bloc">/.test(DEVIS),
  'les deux familles de besoin ont le même cadre — « Autre » avait déjà son enveloppe');
// Le cadre ne pose AUCUN `display` : `#besoinManuel` porte aussi `hidden`,
// et une classe qui déclarerait son propre display le rendrait de nouveau visible.
assert.ok(!/\.article-bloc\{[^}]*display:/.test(DEVIS),
  '… et le cadre ne redonne pas de display à un bloc replié');

// --- 7. LE CADRE DE CHIFFRAGE NE RESTE PAS VIDE ------------------------------
assert.ok(/<div class="tx-preview hidden" id="txPreview"><\/div>/.test(DEVIS),
  'le cadre part masqué : sans prix à montrer il n’a rien à dire');
assert.ok(/box\.classList\.add\('hidden'\);\s*return;\s*\}\s*box\.classList\.remove\('hidden'\)/.test(DEVIS),
  'il s’efface tant qu’il n’y a pas de prix, et revient dès qu’il y en a un');
// Un catalogue en échec est une ERREUR, pas une attente : elle doit se voir.
assert.ok(/Recharge la page\.';\s*\$\('txPreview'\)\.classList\.remove\('hidden'\)/.test(DEVIS),
  'le catalogue qui ne charge pas se dit à l’écran, cadre masqué ou non');


// --- 8. UN DOIGT, PAS UN CHEVRON ---------------------------------------------
//
// Le chevron répondait à « il y a autre chose en dessous ». Au comptoir la
// question n'est pas celle-là, c'est « est-ce que ça se clique ? ». Le doigt
// le dit sans un mot, et le dit pareil sur les vingt-cinq champs.
assert.ok(!/menu-chevron|menuChevron|menu-doigt|menuDoigt/.test(PONT),
  'RIEN dans le champ : ni flèche, ni pictogramme — la place revient au texte');
// LE DOIGT EST LE CURSEUR. Un champ qui propose un choix se clique : la main
// le dit au survol. Le déclencheur d'une liste l'avait déjà ; c'est le champ
// LIBRE qui affichait un curseur de texte et se lisait comme une zone de
// frappe ordinaire.
assert.ok(/\.menu>input\{cursor:pointer;caret-color:transparent\}/.test(PONT),
  'un champ libre qui propose un choix montre la main, pas le curseur de texte');
// CLIQUER OUVRE, ÇA NE COMMENCE PAS UNE SAISIE. Le trait clignotant ramenait
// le champ à une zone de frappe alors qu'on venait d'en faire un bouton.
assert.ok(/\.menu>input\.est-frappe\{cursor:text;caret-color:auto\}/.test(PONT),
  'le trait ne revient qu’une fois qu’on tape vraiment');
assert.ok(/hote\.addEventListener\('keydown',ev=>\{\s*if\(ev\.key\.length===1\|\|ev\.key==='Backspace'\|\|ev\.key==='Delete'\)hote\.classList\.add\('est-frappe'\)/.test(PONT),
  'la première touche rend le trait — sur keydown, sinon il arrive une frappe en retard');
assert.ok(/hote\.addEventListener\('pointerdown',\(\)=>hote\.classList\.remove\('est-frappe'\)\)/.test(PONT),
  'un clic le reprend : on revient à « je choisis »');
assert.ok(/if\(etat\.libre\)etat\.hote\.classList\.remove\('est-frappe'\)/.test(PONT),
  'une valeur prise dans la liste n’est pas une saisie');
assert.ok(/\.menu-declencheur\{[^}]*cursor:pointer/.test(PONT),
  'le déclencheur d’une liste aussi');
// « Saisir autre chose… » barrait le haut du panneau comme une bannière. Un
// raccourci se montre, il ne passe pas devant la réponse attendue.
assert.ok(/\|\|'Ajouter';/.test(PONT) && !/Saisir autre chose/.test(PONT),
  'l’ajout manuel tient en un « + » et un mot');
{
  const manuel = reglesDe(PONT, '.menu-manuel');
  const ech = echelleDe(DEVIS);
  // La page ne connaît plus qu'UNE taille de texte (22/08) : l'ajout manuel
  // l'a comme le reste, et se détache par sa graisse et son gris.
  assert.strictEqual(resoudre(manuel['font-size'], ech), resoudre('var(--taille-texte)', ech),
    'il se lit à la taille du texte de la page');
  assert.strictEqual(resoudre(manuel['font-weight'], ech), '600',
    '… en demi-gras, pas en gras : ce n’est pas la réponse attendue');
  assert.ok(/\.menu-manuel\{[^}]*color:var\(--text-2/.test(PONT), '… et en gris, pas à l’encre');
}


// --- 9. DEUX CHAMPS SUR UNE LIGNE ONT LA MÊME BOÎTE --------------------------
//
// Le déclencheur d'une liste est un <div> : il ÉCHAPPE au
// « input,select,textarea{…!important} » que les deux écrans imposent. Il était
// 5 px plus court que l'<input> d'à côté, avec un trait plus fin (1 px contre
// 1,5), plus sombre (#bcc2c8 contre #d7dce3) et moins arrondi (9 px contre 10).
const declencheur = reglesDe(PONT, '.menu-declencheur');
// ELLE ÉTAIT CALCULÉE, ELLE EST MAINTENANT LUE (25/08). Le calcul
// « interligne + 2 × rembourrage + 3 » tenait tant que ses trois termes
// restaient d'accord avec ceux du champ voisin — et ils avaient fini par
// diverger de 2,4 px. Le déclencheur prend désormais la boîte NOMMÉE de
// l'application, exactement comme le champ, le bouton et la zone de texte :
// il n'y a plus qu'un seul endroit où cette hauteur existe.
// SANS REPLI (26/08). La valeur s'écrivait « var(--ctrl-h,50px) » : le jeton,
// puis le même nombre écrit à côté. Un repli n'est lu que si la charte n'est
// pas chargée — auquel cas l'écran se rendrait dans l'ANCIENNE échelle sans que
// rien ne le signale. On exige donc le jeton NU, et on vérifie qu'aucun chiffre
// ne subsiste dans la valeur : une hauteur, un seul endroit, pour de bon.
assert.strictEqual(declencheur['min-height'], 'var(--ctrl-h)',
  'le déclencheur prend la boîte nommée, pas une hauteur à lui');
assert.ok(!/\d/.test(declencheur['min-height'] || ''),
  '… et aucun nombre ne double le jeton, pas même en repli');
assert.ok(/--ctrl-h:\s*\d+px/.test(fs.readFileSync(path.join(__dirname, '..', 'public/charte.css'), 'utf8')),
  '… et cette boîte est déclarée une seule fois, dans la charte');
// EN RAPPORT ET NON EN « normal » : Chrome ne calcule pas la boîte d'un <input>
// comme celle d'un <div>, « normal » les laissait à 22 px contre 20,5. Un
// rapport suit la taille du texte et ne dépend pas de la police chargée — sur
// un poste où Manrope n'est pas encore arrivée, les deux rétrécissent ENSEMBLE.
// La hauteur d'un champ de l'écran à boîte nommée : `input,select{height:…}`.
const regleChampHauteur = (src) => reglesDe(src, 'input,select').height || '';
[['demande-devis', DEVIS], ['vente-directe', VENTE]].forEach(([nom, src]) => {
  const ech = echelleDe(src);
  const champ = reglesDe(src, 'input,select,textarea');
  const lire = (regles, cle) => resoudre(regles[cle], ech);

  assert.strictEqual(lire(champ, 'line-height'), '1.375',
    `${nom} : les champs ont une hauteur de ligne fixée, pas « normal »`);
  // La même valeur des deux côtés, quelle que soit la façon de l'écrire : le
  // déclencheur d'une liste est un <div>, il ÉCHAPPE au
  // « input,select,textarea{…!important} » que les deux écrans imposent.
  //
  // LES DEUX ÉCRANS LISENT LA MÊME BOÎTE DEPUIS LE 25/08. Il y avait deux
  // modèles jusque-là : une hauteur NOMMÉE sur l'écran de la demande, et un
  // CALCUL (interligne + 2 × rembourrage + 3) sur la vente et dans pont.js.
  // Deux façons d'obtenir la même chose, donc deux façons de diverger — et
  // elles avaient divergé de 2,4 px. L'égalité est maintenant structurelle :
  // champ, bouton et déclencheur pointent tous sur `--ctrl-h`.
  const surcharge = nom === 'demande-devis' ? reglesDe(src, '.menu>.menu-declencheur') : {};
  const decl = Object.assign({}, declencheur, surcharge);
  ['padding', 'font-size', 'line-height', 'border-radius'].forEach((cle) => {
    assert.strictEqual(lire(decl, cle), lire(champ, cle),
      `${nom} : « ${cle} » — le déclencheur d'une liste et le champ d'à côté`);
  });
  assert.strictEqual(lire(decl, 'border'), lire(champ, 'border'),
    `${nom} : … et le même trait`);
  assert.ok(/^1\.5px solid /.test(lire(champ, 'border')),
    `${nom} : … un trait de 1,5 px, celui de la charte`);
  // La hauteur : le champ la LIT, et elle remonte jusqu'à `--ctrl-h`.
  const hauteurChamp = regleChampHauteur(src);
  assert.ok(/^var\(--(ctrl-h|dd-champ-h)\)$/.test(hauteurChamp),
    `${nom} : le champ lit la boîte nommée (trouvé « ${hauteurChamp} »)`);
  const hauteurDecl = (decl['min-height'] || '').replace(/,\s*\d+px\)/, ')');
  assert.ok(/^var\(--(ctrl-h|dd-champ-h)\)$/.test(hauteurDecl),
    `${nom} : le déclencheur lit la même (trouvé « ${decl['min-height']} »)`);
  // Un bouton plein et un bouton bordé sur la même rangée : le trait du second
  // ajoutait 3 px. Le plein porte le même trait, en transparent.
  assert.ok(/\.primary,[^{]*\.whatsapp\{[^}]*border:1\.5px solid transparent!important/.test(src),
    `${nom} : bouton plein et bouton bordé ont la même boîte`);
  // « 💾 Enregistrer » tirait sa hauteur de la police d'émojis : un demi-pixel
  // de plus que ses voisins.
  const bouton = reglesDe(src, 'button');
  assert.strictEqual(resoudre(bouton['line-height'], ech), '1.375',
    `${nom} : un émoji dans un libellé ne décide plus de la hauteur du bouton`);
  // ET LA MÊME BOÎTE QU'UN CHAMP. Sur la même rangée on trouvait 51 px pour un
  // champ, 49,6 pour le bouton plein et 48,3 pour le bouton bordé : trois
  // hauteurs, parce que chacun décidait de sa taille de texte. Même texte,
  // même interligne, même rembourrage vertical — donc la même hauteur.
  // Cette égalité ne se vérifie que sur l'écran qui a adopté l'échelle. Le
  // 22/08, c'est demande-devis.html : vente-directe.html garde ses champs à
  // 16 px et ses boutons à 15, et attend sa reprise. Le jour où il déclare
  // l'échelle, ce contrôle s'allume tout seul et ne le laissera plus passer.
  if (!ech['--taille-texte']) return;
  const pilule = reglesDe(src, '.primary,.secondary,.danger,.whatsapp');
  assert.strictEqual(resoudre(bouton['font-size'], ech), lire(champ, 'font-size'),
    `${nom} : le bouton écrit dans la même taille que le champ d'à côté`);
  assert.strictEqual(resoudre(pilule.padding, ech).split(' ')[0], lire(champ, 'padding').split(' ')[0],
    `${nom} : … et se remplit de la même hauteur`);
});


// --- 10. LA RÉFÉRENCE EST EN GRAS, PAS EN CHASSE FIXE ------------------------
//
// Elle était composée en monospace pour aligner les colonnes. Le patron n'en
// veut pas : la graisse suffit à la détacher de la désignation qui la suit.
assert.ok(!/font-family:ui-monospace/.test(PONT), 'plus de chasse fixe dans les menus');
{
  const jeton = reglesDe(PONT, '.menu-jeton');
  const ech = echelleDe(DEVIS);
  assert.strictEqual(resoudre(jeton['font-size'], ech), resoudre('var(--taille-texte)', ech),
    'la référence se lit à la taille du texte de la page');
  assert.strictEqual(resoudre(jeton['font-weight'], ech), '800', 'la référence prend la police de la page, en gras');
}
// « PARAGON 218T » fait 98 px en Manrope gras : à largeur FIXE, il s'écrivait
// par-dessus la désignation. Un plancher garde les courtes alignées et laisse
// les longues pousser leur seule ligne — une référence ne se coupe jamais,
// c'est elle qui identifie l'article.
assert.ok(/\.menu-option \.menu-jeton\{[^}]*min-width:100px;flex:none\}/.test(PONT),
  'la colonne des références a un plancher, pas une largeur fixe');


// --- 11. LA RÉFÉRENCE SEULE DANS LE CHAMP ------------------------------------
//
// « NS401 » identifie l'article ; la désignation qui la suivait mangeait la
// largeur du champ et finissait en points de suspension. Elle s'écrit à côté du
// numéro de la ligne, où on la lit d'un coup d'œil — et l'infobulle du champ
// porte toujours les deux.
assert.ok(/if\(!\(choisie&&choisie\.jeton\)\)\{[\s\S]{0,220}?declencheur\.append\(t\);\s*\}/.test(PONT),
  'une option qui porte une référence se suffit à elle-même dans le champ');
assert.ok(/declencheur\.title=choisie&&choisie\.valeur\?\[choisie\.jeton,choisie\.texte\]/.test(PONT),
  '… l’infobulle, elle, garde la référence ET la désignation');
assert.ok(/<span class="form-objet" id="txFormObjet"><\/span>/.test(DEVIS),
  'la désignation a sa place à côté du numéro de la ligne');
// La liste porte la désignation dans le TEXTE de son option ; un produit libre
// porte la sienne dans son propre champ.
assert.ok(/const libre=sel\.value==='__CUSTOM__';[\s\S]{0,200}?\$\('txCustomDesignation'\)\.value\.trim\(\)/.test(DEVIS),
  'un produit libre affiche la désignation que la vendeuse écrit');
// Elle s'efface quand plus rien n'est choisi : une désignation qui reste ferait
// croire à un article encore en cours.
assert.ok(/: \(o && o\.value \? \(o\.textContent\|\|''\)\.trim\(\) : ''\)/.test(DEVIS),
  '… et disparaît dès qu’aucune référence n’est choisie');
assert.ok(/function previewTextile\(\)\{\s*if\(!txReady\(\)\)return;\s*txPoserObjet\(\);/.test(DEVIS),
  'elle se réécrit sur CHAQUE relecture du formulaire, pas seulement au choix de la référence');

// --- LE TITRE DE FAMILLE NE FLOTTE PAS (27/08/2026) -----------------------
// Charlie : « ça c'est flottant, ça ne doit pas ».
//
// Le titre de famille est COLLANT : sur 82 produits et 13 familles, sans lui on
// ne sait plus dans quoi on est. Mais un élément collant ne sort jamais de son
// bloc englobant — et à plat dans une seule liste, ce bloc est la liste
// ENTIÈRE. Les titres déjà passés restaient donc collés au même endroit, les
// uns SUR les autres : mesuré, trois titres à 374 px en même temps. Comme ils
// n'ont pas tous la même hauteur, celui de dessous dépassait de quelques
// pixels et la liste se lisait au travers du titre.
//
// Deux causes, deux corrections, et elles tiennent ensemble :
//   1. chaque famille est son propre bloc, donc le titre suivant pousse le
//      précédent dehors ;
//   2. la zone qui défile n'a plus de rembourrage en haut — ces six pixels-là
//      laissaient passer une bande de liste AU-DESSUS du titre collé.
assert.ok(/cible=document\.createElement\('ul'\);\s*cible\.className='menu-famille-liste'/.test(PONT),
  'chaque famille porte sa propre liste : c’est ce qui laisse le titre sortir');
assert.ok(/cible\.setAttribute\('role','group'\)/.test(PONT),
  '… et elle s’annonce comme un groupe, pas comme une deuxième liste de choix');
assert.ok(/const poser=\(el\)=>\{if\(cible\)cible\.append\(el\);else noeuds\.push\(el\)\}/.test(PONT),
  '… les options sans famille — le choix vide, la saisie manuelle — restent à la racine');
assert.ok(/\.menu-liste\{[^}]*padding:0 6px 6px/.test(PONT),
  'la zone qui défile n’a plus de rembourrage en haut : rien ne peut passer au-dessus du titre collé');
assert.ok(!/\.menu-groupe:first-child/.test(PONT),
  'et plus d’exception de hauteur sur le premier titre : deux titres de hauteurs différentes au même endroit, c’est le défaut qui revient');
assert.ok(/\.menu-groupe\{[^}]*white-space:nowrap/.test(PONT),
  '… un titre qui s’enroulerait sur deux lignes le ferait revenir aussi');

console.log('✓ menus du comptoir : un seul modèle sur les deux écrans, la référence ouvre la ligne, la police est à nous');
