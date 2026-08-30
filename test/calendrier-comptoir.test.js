'use strict';

// ===========================================================================
// LE CALENDRIER DES DEUX ÉCRANS (27/08/2026)
// ===========================================================================
// Charlie : « le calendrier doit être le calendrier style SumUp ».
//
// Le calendrier natif de Chrome n'est réglable en rien — ni sa langue, ni son
// dessin, ni le jour où commence sa semaine — et il ouvrait, sur les deux
// écrans du comptoir, un objet gris qui n'appartenait à aucun des deux.
//
// IL VIVAIT DANS pont.js — le seul fichier que les DEUX écrans du comptoir
// lisent. Le 30/08, Charlie en a demandé un troisième, sur le champ « Retrait »
// de la fiche de l'atelier : « le même que l'autre ». Il a donc déménagé dans
// `public/calendrier.js`, que les TROIS écrans lisent, et pont.js le charge à
// la demande — un script classique ne peut pas écrire `import` en tête, mais il
// peut appeler `import()`.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const PONT = lire('public/comptoir/pont.js');
const CAL = lire('public/calendrier.js');
const FICHE = lire('public/fiche-atelier.js');
const VENTE = lire('public/comptoir/vente-directe.html');
const DEVIS = lire('public/comptoir/demande-devis.html');

// --- 1. UN SEUL CALENDRIER, DANS LE FICHIER QUE LES TROIS ÉCRANS LISENT ----
assert.match(CAL, /function calendrierPoserInterne\(champ\)/,
  'le calendrier vit dans calendrier.js — le seul fichier que les TROIS écrans lisent');
assert.ok(!/function calOuvrir\(|\.cal-panneau\{/.test(PONT),
  'il n’en reste RIEN dans pont.js : deux copies divergent au premier correctif');
assert.match(PONT, /import\('\.\.\/calendrier\.js'\)/,
  'pont.js le charge à la demande — un script classique ne peut pas l’importer en tête');
// SI LE MODULE NE VIENT PAS, l'écran de devis retombe sur `showPicker()` : la
// date reste choisissable, avec le calendrier de Chrome.
assert.match(PONT, /window\.oldaCalendrier=mod\.calendrierOuvrir/,
  'et il le republie sous le nom que la demande de devis appelle');
// LA FICHE DE L'ATELIER PREND LE MÊME, sur un champ CACHÉ : celui qu'on lit
// garde « demain », « +3 », « lundi ».
assert.match(FICHE, /import \{ calendrierOuvrir \} from '\.\/calendrier\.js';/,
  'la fiche importe le composant, elle ne le recopie pas');
assert.match(FICHE, /const fantome = el\('input', 'date-fantome'\);/,
  'la date ISO vit dans un champ fantôme, pas dans celui qu’on lit');
assert.match(FICHE, /calendrierOuvrir\(fantome, c\)/,
  'le panneau s’accroche au champ VISIBLE — sur le fantôme il tomberait n’importe où');
assert.match(FICHE, /c\.dispatchEvent\(new Event\('blur'\)\)/,
  'ce que le calendrier pose repasse par le blur : normalisation, envoi, annulation, message');
// UNE SEULE RÈGLE POUR LE FANTÔME, dans charte.css : elle était écrite dans
// demande-devis.css, invisible depuis le CRM.
assert.match(lire('public/charte.css'), /input\[type="date"\]\.date-fantome \{/,
  'le champ fantôme est habillé dans la charte partagée');
assert.ok(!/\.date-fantome\{/.test(lire('public/comptoir/demande-devis.css')),
  '… et plus dans la feuille d’un seul écran');
assert.match(PONT, /document\.querySelectorAll\('input\[type="date"\]'\)\.forEach\(calendrierPoser\)/,
  'toute date de l’écran passe par lui, sans que la page ait à le demander');
for (const [nom, src] of [['vente-directe', VENTE], ['demande-devis', DEVIS]]) {
  assert.ok(!/\.showPicker\(\)/.test(src) || /window\.oldaCalendrier/.test(src),
    `${nom} : plus personne n’ouvre le calendrier natif sans repli sur le nôtre`);
}
// L'écran de devis choisit sa date depuis une LISTE : le champ qui la porte est
// un fantôme d'un pixel (voir `date-fantome`). Le panneau s'accroche donc au
// MENU, sinon il tombe n'importe où.
assert.match(DEVIS, /window\.oldaCalendrier\(\$\('desiredDate'\),ancre\)/,
  'la demande de devis accroche le calendrier sur son MENU, pas sur le champ fantôme');

// --- 2. LA SEMAINE COMMENCE LUNDI -----------------------------------------
assert.match(CAL, /const JOURS_COURTS=\['L','M','M','J','V','S','D'\];/,
  'la semaine française, pas celle de getDay()');
assert.match(CAL, /const calRang=\(d\)=>\(d\.getDay\(\)\+6\)%7;/,
  'lundi vaut 0 : c’est ce décalage qui place la première case du mois');

// --- 3. SIX SEMAINES, TOUJOURS --------------------------------------------
// Une grille qui change de hauteur d'un mois à l'autre fait sauter tout ce
// qu'il y a dessous à chaque flèche.
assert.match(CAL, /for\(let i=0;i<42;i\+=1\)/,
  'six semaines pleines : la grille ne change jamais de hauteur');

// --- 4. UNE DATE ISO SE LIT À MIDI ----------------------------------------
// L'atelier est à UTC−4 : à minuit, le fuseau ramène la date la veille.
assert.match(CAL, /new Date\(Number\(m\[1\]\),Number\(m\[2\]\)-1,Number\(m\[3\]\),12,0,0\)/,
  'une date ISO se construit à MIDI — à minuit, UTC−4 la ramène au jour d’avant');

// --- 5. LE PIÈGE DU COMPTOIR : UNE RÈGLE NUE SUR `button` ------------------
// Les deux écrans imposent « button{min-height:…;padding:0 18px} » à TOUS leurs
// boutons. Sans le redire, chaque case du calendrier héritait de 18 px de
// rembourrage de chaque côté : la grille de sept colonnes sortait du panneau et
// le jour choisi se retrouvait 26 px À CÔTÉ de la boîte (mesuré au rendu).
assert.match(CAL, /\.cal-panneau button\{padding:0;min-height:0;min-width:0;margin:0\}/,
  'toute commande du calendrier redit sa boîte en entier — sinon la page la lui impose');

// --- 6. ET AUCUN ACCENT GRAVE DANS LA FEUILLE ------------------------------
// Elle vit dans un littéral de gabarit : un seul accent grave non échappé le
// referme, et les composants des deux écrans redeviennent des champs bruts —
// sans une erreur visible nulle part. C'est arrivé DEUX fois le 27/08.
for (const [nom, src, cle] of [['pont.js', PONT, 'STYLE_MENU'], ['calendrier.js', CAL, 'CSS_CALENDRIER']]) {
  const bloc = src.match(new RegExp(`const ${cle}\\s*=\\s*\`([\\s\\S]*?)\\n\`;`));
  assert.ok(bloc, `${nom} : la feuille du composant doit rester repérable`);
  assert.strictEqual(bloc[1].replace(/\\`/g, '').indexOf('`'), -1,
    `${nom} : un accent grave non échappé referme le gabarit, et la feuille part NUE`);
}

// --- 7. IL SE DEROULE VERS LE BAS -----------------------------------------
// Charlie (30/08) : « tous les menus déroulants doivent se dérouler vers le
// bas ». Le calendrier ET les menus du comptoir se retournaient AU-DESSUS du
// champ dès qu'ils ne tenaient pas dessous et qu'ils tenaient dessus : le même
// geste ouvrait le panneau tantôt en haut tantôt en bas, selon l'endroit de
// l'écran. S'il ne tient pas, il glisse juste assez pour rester visible.
assert.ok(!/r\.top-6-p\.height/.test(CAL),
  'le calendrier ne se retourne plus au-dessus du champ');
assert.match(CAL, /if\(y\+p\.height>window\.innerHeight-marge\)y=Math\.max\(marge,window\.innerHeight-marge-p\.height\);/,
  '… il glisse pour rester visible, il ne change pas de côté');
assert.ok(!/champ\.top-6-haut/.test(PONT),
  'les menus du comptoir non plus');

console.log('✓ calendrier : un seul pour les TROIS écrans, la semaine commence lundi, et les cases tiennent dans la boîte');
