'use strict';

// CE QU'UNE LIGNE DIT PAR DÉFAUT (27/08/2026)
//
// Le rail des colonnes comptait seize entrées. Charlie en a arrêté six — et
// seulement six :
//
//   Qui suit · Nom du dossier client · Documents · Prix TTC · Ce qui manque ·
//   Infos · Date souhaitée
//
// Qui s'en occupe, à qui c'est, ses deux papiers, ce que ça coûte, ce qui
// l'empêche d'avancer, les notes, et pour quand. Deux d'entre elles n'existent
// que dans le tableau : le planning s'ouvre donc sur le TABLEAU, plus sur les
// cartes.
//
// DEUX CHANGEMENTS LE 27/08 AU SOIR, sur les chiffres de la PRODUCTION (187
// dossiers, pas les 184 d'alors) :
//
//   1. L'ARTICLE ENTRE. `product` est rempli sur 186 dossiers sur 187 — 99 %,
//      la donnée la mieux remplie de toute la base — et c'était la seule qui
//      manquait à la ligne. Un planning d'atelier ne disait pas ce qu'il y
//      avait à produire. Elle se lit juste après le client : qui, pour quoi.
//      Elle s'appelle « Article » et non « Description » : le ticket de
//      l'atelier l'appelle déjà comme ça, et « Description » la nommait comme
//      sa voisine « Infos », qui porte la note libre.
//   2. LES PAPIERS DESCENDENT EN FIN DE LIGNE. Ce sont des OUTILS, pas des
//      faits : posés entre « à qui » et « quoi », ils coupaient la lecture en
//      deux. Toutes les autres actions de la ligne sont déjà à droite.
//
// UNE COLONNE A ÉTÉ RETIRÉE — TYPE : toujours rempli sur les 184 dossiers
// réels, mais il ne change RIEN à ce qu'on fait de la ligne (le nom du dossier
// le dit, et le bon de commande le porte). ON RETIRE UNE COLONNE, PAS UNE
// CAPACITÉ : `typeControl` vivait déjà dans la fiche projet, il y reste entier.
//
// « QUI SUIT » A ÉTÉ RETIRÉE PUIS REMISE LE MÊME JOUR. Le chiffre qui l'avait
// condamnée — 24 pilotes attribués sur 184, 5 référents — disait l'inverse de
// ce que j'en avais lu : on n'attribue pas un dossier en ouvrant sa fiche, on
// l'attribue en le voyant passer. La colonne est donc sur la ligne PAR DÉFAUT,
// et elle porte les DEUX puces, le pilote et le référent en dessous.
//
// Et le piège qui a déjà coûté une colonne masquée de travers : un <col> agit
// sur la colonne de MÊME RANG, son `data-col` n'est qu'une étiquette. Retirer
// une colonne, c'est la retirer aux TROIS endroits, dans le même ordre.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const APP = lire('app.js');
const HTML = lire('index.html');
const CSS = lire('styles.css');
const FICHE = lire('fiche-atelier.js');

// ---------------------------------------------------------------------------
// 1. LES SIX FAITS DE LA LIGNE
// ---------------------------------------------------------------------------
const defaut = APP.match(/const COLS_DEFAUT = new Set\(\[([^\]]*)\]\)/);
assert.ok(defaut, 'la ligne par défaut doit être écrite en clair, pas déduite');
const cles = defaut[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1));
assert.deepStrictEqual(cles,
  ['responsable', 'client', 'product', 'price', 'feu', 'description', 'deadline'],
  'les faits de la ligne, dans l’ordre où elle les lit');

// Le reste se déduit de la liste : ajouter une colonne au rail ne doit pas
// l'allumer chez tout le monde sans que personne l'ait demandé.
assert.match(APP, /const COLS_MASQUEES_DEFAUT = new Set\(\s*\n\s*PLANNING_COLS\.filter\(\(c\) => !c\.locked && !COLS_DEFAUT\.has\(c\.key\)\)/,
  'ce qui n’est pas dans la ligne par défaut est rangé, par construction');
assert.match(APP, /return new Set\(COLS_MASQUEES_DEFAUT\);/,
  'un poste qui n’a jamais choisi ouvre sur la ligne par défaut');

// NOUVELLE LIGNE = NOUVELLE CLÉ. Un poste réglé sous l'ancienne garderait son
// écran, et la ligne arrêtée n'apparaîtrait nulle part.
assert.match(APP, /const COLS_KEY = 'olda_cols_v4';/);

// LE TABLEAU, PAS LES CARTES. « Infos » et « Date souhaitée » n'existent que
// là ; le planning ne peut donc plus s'ouvrir sur les cartes — et c'est voulu.
const tableauSeul = ['description', 'deadline'];
for (const k of tableauSeul) {
  const ligne = new RegExp(`\\{ key: '${k}',\\s+label: '[^']+' \\}`);
  assert.match(APP, ligne, `${k} ne doit porter ni surCarte ni horsTableau`);
}
// …mais le retour aux cartes reste à un clic, jamais un état sans issue.
assert.match(APP, /\$colbarReset\.textContent = modeCartes\(\) \? 'Afficher le tableau complet' : 'Revenir aux cartes';/);

// « Ce qui manque » n'a PAS de colonne à lui : il se pose dans la cellule
// « Infos ». Les allumer ensemble est donc cohérent — l'un porte l'autre.
assert.match(APP, /\{ key: 'feu',\s+label: '[^']+', surCarte: true, horsTableau: true \}/);

// ---------------------------------------------------------------------------
// 2. TYPE ET RESPONSABLE ONT QUITTÉ LE TABLEAU — AUX TROIS ENDROITS
// ---------------------------------------------------------------------------
for (const mort of ['client_type']) {
  assert.ok(!new RegExp(`\\{ key: '${mort}',`).test(APP), `${mort} ne doit plus être une colonne`);
  assert.ok(!HTML.includes(`<col data-col="${mort}"`), `le <col> ${mort} doit avoir disparu`);
  assert.ok(!new RegExp(`data-sort="${mort}"`).test(HTML), `le <th> ${mort} doit avoir disparu`);
  assert.ok(!new RegExp(`off-${mort}`).test(CSS), `la règle de masquage off-${mort} n’a plus de cible`);
  assert.ok(!new RegExp(`\\b${mort}: \\d+`).test(APP.match(/const COL_DEFAULTS = \{[\s\S]*?\};/)[0]),
    `${mort} ne doit plus peser dans COL_DEFAULTS`);
}
assert.ok(!/function cellType\b/.test(APP), 'cellType est du code mort');
assert.ok(!/\.col-type \{/.test(CSS),
  'la largeur de la colonne retirée part avec elle');

// ON ATTRIBUE UNE LIGNE DEPUIS LA LIGNE. La cellule est revenue, et elle porte
// le contrôle COMPLET — pilote ET référent — pas seulement le premier.
assert.match(APP, /function cellResponsable\(r\) \{[\s\S]*?td\.appendChild\(respControl\(r\)\)/,
  'la cellule pose le contrôle entier, pas une puce isolée');
assert.match(APP, /tr\.appendChild\(cellResponsable\(r\)\);/,
  'buildRow doit reposer la cellule sur la ligne');
assert.match(CSS, /\.col-resp \{ width: 132px; \}/);
assert.match(CSS, /\.grid\.off-responsable col\[data-col="responsable"\]/,
  'elle se range depuis le rail, comme les autres');

// ON RETIRE UNE COLONNE, PAS UNE CAPACITÉ.
// Depuis le 29/08 c'est la FICHE ATELIER qui les porte : le tiroir qui les
// tenait n'était plus appelé, et `typeControl` est mort avec lui. Le pilote,
// lui, garde son contrôle dans la grille (colonne « Qui suit »).
assert.match(FICHE, /menu\(null, ctx\.types, r\.client_type/,
  'le type se change toujours, dans la fiche');
// Depuis le 29/08 il vit dans la ZONE CLIENT (« il est important de bien
// séparer client, production et paiement ») : sa grille le nomme « Type ».
assert.match(FICHE, /rangee\('Type', selType\)/,
  '… et il est nommé, dans la zone du client');
assert.match(FICHE, /ctx\.employes/, 'le pilote se change toujours, dans la fiche');
// Le référent de NOTE est parti avec la barre basse le 29/08 ; le référent du
// DOSSIER reste sur la ligne du planning (colonne « Qui suit »).
assert.match(APP, /function respControl\(r\) \{/, 'le référent reste sur la ligne');
assert.match(APP, /function respControl\(r\) \{/);

// ---------------------------------------------------------------------------
// 3. LES TROIS RANGS RESTENT ALIGNÉS
// ---------------------------------------------------------------------------
// Un <col> agit sur la colonne de MÊME RANG. Retirer une colonne du <colgroup>
// sans la retirer du <thead> décale TOUT ce qui suit : les règles `off-…`
// visent alors la colonne voisine, et on masque la mauvaise.
const ordreCol = [...HTML.matchAll(/<col data-col="([^"]+)"/g)].map((m) => m[1]);
const thead = HTML.match(/<thead>[\s\S]*?<\/thead>/)[0];
const ordreTh = [...thead.matchAll(/<th class="(col-[a-z]+)/g)].map((m) => m[1]);
const corps = APP.match(/function buildRow\(r\)[\s\S]*?\n\}/)[0];
const ordreTd = [...corps.matchAll(/(?:tr\.appendChild\((cell[A-Za-z]+)\(r\)\)|className = '(col-handle|col-del)')/g)]
  .map((m) => m[1] || m[2]);

const LIGNE = [
  ['handle', 'col-handle', 'col-handle'],
  ['stars', 'col-stars', 'cellStars'],
  ['responsable', 'col-resp', 'cellResponsable'],
  ['client', 'col-client', 'cellDossier'],
  ['product', 'col-product', 'cellDescription'],
  ['price', 'col-price', 'cellPrice'],
  ['sub_stage', 'col-sub', 'cellSubStage'],
  ['description', 'col-infos', 'cellInfos'],
  ['deadline', 'col-deadline', 'cellDeadline'],
  ['flag', 'col-flag', 'cellFlag'],
  ['del', 'col-del', 'col-del'],
];
assert.deepStrictEqual(ordreCol, LIGNE.map((x) => x[0]), 'le <colgroup> dit la ligne');
assert.deepStrictEqual(ordreTh, LIGNE.map((x) => x[1]), 'le <thead> dit la MÊME ligne');
assert.deepStrictEqual(ordreTd, LIGNE.map((x) => x[2]), 'buildRow pose les cellules au même rang');

// ---------------------------------------------------------------------------
// 4. LE PLANCHER DU TABLEAU OUBLIE CE QU'IL NE PORTE PLUS
// ---------------------------------------------------------------------------
// `--cols-off` ne retranche que les colonnes RANGÉES, celles qui existent
// encore. Une colonne supprimée doit donc sortir du plancher lui-même, sinon
// la grille garde 198 px de largeur qu'aucune colonne n'occupe et continue de
// défiler de côté alors qu'on vient de lui faire de la place.
assert.ok(CSS.includes('min-width: calc(1390px - var(--cols-off, 0px))'),
  'le plancher doit refléter les colonnes réellement présentes');
// ---------------------------------------------------------------------------
// 5. UNE COLONNE N'EST JAMAIS PLUS ÉTROITE QUE SON PROPRE INTITULÉ
// ---------------------------------------------------------------------------
// Le tableau est en `table-layout: fixed` : un contenu trop large pour sa
// colonne ne la pousse pas, il se COUPE — en plein milieu d'une lettre, sans
// même les points de suspension. « DOCUME », « DATE SOUHAIT », « PRIX TTC (»
// accueillaient tout le monde le jour où le tableau est devenu la vue par
// défaut. Et la colonne du prix ne coupait pas son intitulé mais sa ligne
// « HT : 1 394,23 € », dès le premier millier. Largeurs mesurées au rendu.
for (const [sel, px] of [['col-price', 132], ['col-deadline', 148], ['col-client', 214]]) {
  assert.ok(new RegExp(`\\.${sel} \\{ width: ${px}px; \\}`).test(CSS),
    `${sel} doit tenir son intitulé (${px}px)`);
}
// L'INTITULÉ EST UN INTITULÉ : 14, pas 17. À la taille du contenu il pesait
// autant que la ligne qu'il nomme — et c'est ce qui le faisait déborder.
assert.match(CSS, /\.grid thead th \{[\s\S]*?font-size: var\(--taille-note\)/);
// Les mots du tableau et ceux du rail sont les MÊMES : deux noms pour une
// colonne, c'est deux composants qui se ressemblent au lieu d'un seul.
for (const mot of ['Nom du dossier client', 'Prix TTC', 'Date souhaitée', 'Qui suit']) {
  assert.ok(HTML.includes(`>${mot}</th>`), `le <th> doit dire « ${mot} », comme le rail`);
  assert.ok(APP.includes(`label: '${mot}'`), `le rail doit dire « ${mot} », comme le <th>`);
}

// COL_DEFAULTS se dit « miroir des .col-* du CSS » : qu'il le soit, sinon
// `--cols-off` retranche au plancher une largeur que la colonne n'occupait pas.
const defauts = APP.match(/const COL_DEFAULTS = \{[\s\S]*?\};/)[0];
for (const [cle, sel] of [['price', 'col-price'],
  ['deadline', 'col-deadline'], ['client', 'col-client'], ['stars', 'col-stars'],
  ['flag', 'col-flag'], ['sub_stage', 'col-sub'], ['del', 'col-del'], ['responsable', 'col-resp'],
  ['product', 'col-product'], ['description', 'col-infos']]) {
  const px = CSS.match(new RegExp(`\\.${sel} \\{ width: (\\d+)px; \\}`))[1];
  assert.ok(new RegExp(`\\b${cle}: ${px}\\b`).test(defauts),
    `COL_DEFAULTS.${cle} doit valoir ${px}, comme .${sel}`);
}

// ---------------------------------------------------------------------------
// 6. LE PRIX ET SON HT SONT DEUX LIGNES D'UN MÊME FAIT
// ---------------------------------------------------------------------------
// Le champ prenait la hauteur d'une rangée entière — 88 px pour un nombre de
// 17 — et ouvrait trente-trois pixels de vide entre le montant et son HT.
// C'était aussi, à elle seule, la cellule qui décidait de la hauteur de TOUTES
// les lignes du planning : 110 px demandés quand la plus haute des autres en
// demandait 88. Mesuré au rendu : la ligne est passée de 111 à 89 px, et elle
// fait désormais la même hauteur avec ou sans prix.
const prix = CSS.match(/\.col-price-cell \.cell-price \{[\s\S]*?\n\}/);
assert.ok(prix, 'la cellule du prix doit reprendre la main sur la hauteur du champ');
assert.match(prix[0], /height: auto;/,
  'le champ ne prend plus la hauteur d’une rangée');
// `line-height: normal` laisse le CONTENU décider de la hauteur — c'est ce qui
// donne trois hauteurs de champ dans une même application. Et il est un JETON
// depuis le 29/08 : il s'écrivait en dix valeurs dans styles.css, dont cinq
// pour la seule taille de 17 px.
assert.match(prix[0], /line-height: var\(--ligne-serre\);/);

// LE MÊME BORD DROIT. 24 px de rembourrage pour le champ, 8 pour le HT : deux
// nombres alignés à droite et décalés de 16 px l'un sous l'autre.
const ht = CSS.match(/\.cell-price-ht \{[\s\S]*?\n\}/)[0];
const bord = (bloc) => (bloc.match(/padding(?:-inline-end)?: ([^;]+);/) || [])[1];
assert.ok(/24px/.test(bord(prix[0])) && /24px/.test(bord(ht)),
  'le montant et son HT se calent sur le même bord droit');
// 14 : une mention de contrôle ne pèse pas autant que le montant qu'elle contrôle.
assert.match(ht, /font-size: var\(--taille-note\)/);
// L'écart entre les deux lignes est un PAS du système, pas un nombre choisi.
assert.match(ht, /margin-top: var\(--pas-1\)/);

// Et l'écart de la cellule « Qui suit » aussi : 12 px n'est pas un des quatre
// pas, et il coûtait exactement les deux pixels qui coupaient « Réf. Charlie »
// (110 px de puce demandés, 108 laissés).
assert.match(CSS, /\.resp-stack \{[^}]*padding: var\(--pas-1\) var\(--pas-2\);/,
  'la colonne dont le métier est de nommer quelqu’un ne coupe pas le nom');

console.log('✓ ligne par défaut : qui suit la ligne, ce qu’elle porte, et les trois rangs alignés');
