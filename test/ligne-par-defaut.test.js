'use strict';

// CE QU'UNE LIGNE DIT PAR DÉFAUT (27/08/2026)
//
// Le rail des colonnes comptait seize entrées. Charlie en a arrêté six — et
// seulement six :
//
//   Nom du dossier client · Documents · Prix TTC · Ce qui manque · Infos ·
//   Date souhaitée
//
// À qui c'est, ses deux papiers, ce que ça coûte, ce qui l'empêche d'avancer,
// les notes, et pour quand. Deux d'entre elles n'existent que dans le tableau :
// le planning s'ouvre donc sur le TABLEAU, plus sur les cartes.
//
// DEUX COLONNES ONT ÉTÉ RETIRÉES, mesure à l'appui sur les 184 dossiers réels
// de la production :
//
//   · RESPONSABLE — le pilote n'est vraiment attribué que sur 24 d'entre eux
//     (48 disent « À attribuer », ce qui ne dit rien) et le référent sur 5.
//     Une colonne de 132 px vide neuf fois sur dix.
//   · TYPE — toujours rempli, mais il ne change RIEN à ce qu'on fait de la
//     ligne : le nom du dossier le dit, et le bon de commande le porte.
//
// ON RETIRE UNE COLONNE, PAS UNE CAPACITÉ : les deux contrôles vivaient déjà
// dans la fiche projet (`typeControl`, `respControl`), ils y restent entiers.
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

// ---------------------------------------------------------------------------
// 1. LES SIX FAITS DE LA LIGNE
// ---------------------------------------------------------------------------
const defaut = APP.match(/const COLS_DEFAUT = new Set\(\[([^\]]*)\]\)/);
assert.ok(defaut, 'la ligne par défaut doit être écrite en clair, pas déduite');
const cles = defaut[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1));
assert.deepStrictEqual(cles, ['client', 'ticket', 'price', 'feu', 'description', 'deadline'],
  'six faits, dans l’ordre où la ligne les lit');

// Le reste se déduit de la liste : ajouter une colonne au rail ne doit pas
// l'allumer chez tout le monde sans que personne l'ait demandé.
assert.match(APP, /const COLS_MASQUEES_DEFAUT = new Set\(\s*\n\s*PLANNING_COLS\.filter\(\(c\) => !c\.locked && !COLS_DEFAUT\.has\(c\.key\)\)/,
  'ce qui n’est pas dans la ligne par défaut est rangé, par construction');
assert.match(APP, /return new Set\(COLS_MASQUEES_DEFAUT\);/,
  'un poste qui n’a jamais choisi ouvre sur la ligne par défaut');

// NOUVELLE LIGNE = NOUVELLE CLÉ. Un poste réglé sous l'ancienne garderait son
// écran, et la ligne arrêtée n'apparaîtrait nulle part.
assert.match(APP, /const COLS_KEY = 'olda_cols_v3';/);

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
for (const mort of ['client_type', 'responsable']) {
  assert.ok(!new RegExp(`\\{ key: '${mort}',`).test(APP), `${mort} ne doit plus être une colonne`);
  assert.ok(!HTML.includes(`<col data-col="${mort}"`), `le <col> ${mort} doit avoir disparu`);
  assert.ok(!new RegExp(`data-sort="${mort}"`).test(HTML), `le <th> ${mort} doit avoir disparu`);
  assert.ok(!new RegExp(`off-${mort}`).test(CSS), `la règle de masquage off-${mort} n’a plus de cible`);
  assert.ok(!new RegExp(`\\b${mort}: \\d+`).test(APP.match(/const COL_DEFAULTS = \{[\s\S]*?\};/)[0]),
    `${mort} ne doit plus peser dans COL_DEFAULTS`);
}
for (const mort of ['cellType', 'cellResponsable']) {
  assert.ok(!new RegExp(`function ${mort}\\b`).test(APP), `${mort} est du code mort`);
}
assert.ok(!/\.col-type \{|\.col-resp \{|\.col-resp-cell \{/.test(CSS),
  'les largeurs et l’habillage des deux colonnes retirées partent avec elles');

// ON RETIRE UNE COLONNE, PAS UNE CAPACITÉ.
assert.match(APP, /ldBox\('Type de client', typeControl\(r\)\)/,
  'le type se change toujours, dans la fiche');
assert.match(APP, /ldBox\('Qui suit', respControl\(r\)\)/,
  'le pilote et le référent se changent toujours, dans la fiche');
assert.match(APP, /function typeControl\(r\) \{/);
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
  ['client', 'col-client', 'cellDossier'],
  ['ticket', 'col-ticket', 'cellTicket'],
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
for (const px of [1284, 1234, 1374]) {
  assert.ok(CSS.includes(`min-width: calc(${px}px - var(--cols-off, 0px))`),
    `le plancher ${px} doit refléter les colonnes réellement présentes`);
}
// ---------------------------------------------------------------------------
// 5. UNE COLONNE N'EST JAMAIS PLUS ÉTROITE QUE SON PROPRE INTITULÉ
// ---------------------------------------------------------------------------
// Le tableau est en `table-layout: fixed` : un contenu trop large pour sa
// colonne ne la pousse pas, il se COUPE — en plein milieu d'une lettre, sans
// même les points de suspension. « DOCUME », « DATE SOUHAIT », « PRIX TTC (»
// accueillaient tout le monde le jour où le tableau est devenu la vue par
// défaut. Et la colonne du prix ne coupait pas son intitulé mais sa ligne
// « HT : 1 394,23 € », dès le premier millier. Largeurs mesurées au rendu.
for (const [sel, px] of [['col-ticket', 116], ['col-price', 132], ['col-deadline', 148], ['col-client', 214]]) {
  assert.ok(new RegExp(`\\.${sel} \\{ width: ${px}px; \\}`).test(CSS),
    `${sel} doit tenir son intitulé (${px}px)`);
}
// L'INTITULÉ EST UN INTITULÉ : 14, pas 17. À la taille du contenu il pesait
// autant que la ligne qu'il nomme — et c'est ce qui le faisait déborder.
assert.match(CSS, /\.grid thead th \{[\s\S]*?font-size: var\(--taille-note\)/);
// Les mots du tableau et ceux du rail sont les MÊMES : deux noms pour une
// colonne, c'est deux composants qui se ressemblent au lieu d'un seul.
for (const mot of ['Nom du dossier client', 'Documents', 'Prix TTC', 'Date souhaitée']) {
  assert.ok(HTML.includes(`>${mot}</th>`), `le <th> doit dire « ${mot} », comme le rail`);
  assert.ok(APP.includes(`label: '${mot}'`), `le rail doit dire « ${mot} », comme le <th>`);
}

// COL_DEFAULTS se dit « miroir des .col-* du CSS » : qu'il le soit, sinon
// `--cols-off` retranche au plancher une largeur que la colonne n'occupait pas.
const defauts = APP.match(/const COL_DEFAULTS = \{[\s\S]*?\};/)[0];
for (const [cle, sel] of [['ticket', 'col-ticket'], ['price', 'col-price'],
  ['deadline', 'col-deadline'], ['client', 'col-client'], ['stars', 'col-stars'],
  ['flag', 'col-flag'], ['sub_stage', 'col-sub'], ['del', 'col-del'],
  ['product', 'col-product'], ['description', 'col-infos']]) {
  const px = CSS.match(new RegExp(`\\.${sel} \\{ width: (\\d+)px; \\}`))[1];
  assert.ok(new RegExp(`\\b${cle}: ${px}\\b`).test(defauts),
    `COL_DEFAULTS.${cle} doit valoir ${px}, comme .${sel}`);
}

console.log('✓ ligne par défaut : six faits, deux colonnes retirées, et les trois rangs alignés');
