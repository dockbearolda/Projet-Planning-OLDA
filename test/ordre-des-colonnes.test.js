'use strict';

// ===========================================================================
// L'ORDRE DES COLONNES SE RÈGLE — SANS DÉSALIGNER LES TROIS RANGS (27/08/2026)
// ===========================================================================
// Charlie : « les colonnes ici je dois pouvoir les déplacer comme je le
// souhaite, mettre en premier Documents par exemple. »
//
// LE PIÈGE QU'IL FALLAIT ÉVITER. L'ordre était écrit en dur à TROIS endroits
// qui doivent rester au même rang : le <colgroup>, le <thead> et buildRow().
// Un <col> agit sur la colonne de MÊME RANG — son `data-col` n'est qu'une
// étiquette. Déplacer un <th> sans son <col> vise la mauvaise colonne, en
// silence. C'est arrivé le 27/08 au soir en déplaçant « Documents » à la main,
// et c'est `ligne-par-defaut` qui l'a rattrapé.
//
// On ne réécrit donc PAS les trois listes : on applique LA MÊME PERMUTATION aux
// trois. L'invariant est tenu par construction, pas par vigilance — et c'est ça
// que ce fichier vérifie.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public/styles.css'), 'utf8');

// --- 1. UNE SEULE PERMUTATION, TROIS DESTINATAIRES ------------------------
assert.match(APP, /function permutationCols\(\) \{[\s\S]*?const connues = clesDuTableau\(\);/,
  'le <colgroup> est la source de vérité rang → clé : c’est lui qui porte data-col');
const applique = APP.match(/function appliquerOrdreColonnes\(\) \{[\s\S]*?\n\}/);
assert.ok(applique, 'appliquerOrdreColonnes doit exister');
for (const cible of ['colgroup', 'thead tr']) {
  assert.ok(applique[0].includes(cible),
    `la permutation doit s’appliquer au ${cible} — sinon un <col> vise la mauvaise colonne`);
}
assert.match(applique[0], /for \(const tr of \$rows\.children\) rangerCellules\(tr, perm\)/,
  '… et à chaque ligne du corps');

// La ligne qui NAÎT doit être rangée elle aussi : sinon elle revient dans
// l'ordre du gabarit pendant que l'entête est dans celui du poste.
assert.match(APP, /relireLesNotes\(\);\s*\n\s*\/\/[^\n]*\n\s*appliquerOrdreColonnes\(\);/,
  'renderRows doit ranger les lignes neuves');

// --- 2. LES BORDS DE LA LIGNE NE SE DÉPLACENT PAS -------------------------
// La poignée et les actions ne sont pas des colonnes : ce sont les bords.
assert.match(APP, /const ORDRE_FIXE_DEBUT = \['handle'\];/);
assert.match(APP, /const ORDRE_FIXE_FIN = \['del'\];/);
assert.match(APP, /function normaliserOrdre\(liste\) \{[\s\S]*?ORDRE_FIXE_DEBUT, \.\.\.milieu, \.\.\.ORDRE_FIXE_FIN/,
  'quoi qu’on enregistre, la poignée passe devant et les actions derrière');

// --- 3. UN ORDRE ENREGISTRÉ HIER NE CASSE PAS L'ÉCRAN D'AUJOURD'HUI -------
// Une colonne peut avoir disparu, une autre être née : ce qu'il connaît donne
// le rang, le reste suit. Sans ça, la permutation n'a pas la bonne longueur et
// le tableau part de travers — ou ne s'affiche plus.
const lire = APP.match(/function lireOrdreCols\(\) \{[\s\S]*?\n\}/)[0];
assert.match(lire, /const garde = brut\.filter\(\(k\) => connues\.includes\(k\)\)/,
  'on ne garde que les colonnes qui existent VRAIMENT');
assert.match(lire, /const manque = connues\.filter\(\(k\) => !garde\.includes\(k\)\)/,
  '… et on ajoute celles qu’il ne connaissait pas');
assert.match(APP, /if \(voulu\.length !== connues\.length\) return null;/,
  'une liste incohérente ne permute RIEN : mieux vaut l’ordre du gabarit qu’un tableau de travers');

// --- 4. L'ORDRE SUIT LA PERSONNE, comme le choix des colonnes -------------
assert.match(APP, /const ordreKey = \(\) => `\$\{colsKey\(\)\}:ordre`;/,
  'le chef d’atelier et la boutique se nomment tour à tour sur le même PC');

// --- 5. ON LE RANGE DANS LE PANNEAU, PAS SUR L'EN-TÊTE --------------------
// Un en-tête porte DÉJÀ deux gestes : cliquer pour trier, glisser son bord pour
// régler la largeur. Un troisième s'y marcherait dessus — on trierait en
// voulant déplacer. Le panneau « Colonnes », lui, n'a aucun geste en
// concurrence, et il liste déjà les colonnes.
assert.match(APP, /\$colbarOn\.addEventListener\('dragstart'/,
  'le glisser vit dans le panneau « Colonnes »');
assert.ok(!/thead[^\n]*addEventListener\('dragstart'/.test(APP),
  'l’en-tête ne doit PAS porter le glisser : il trie et il se redimensionne déjà');
// La liste « Sur l'écran » doit se lire dans l'ordre de l'écran, sinon elle ne
// peut pas servir à le changer.
assert.match(APP, /const rang = ordreVoulu\(\);[\s\S]*?\.sort\(\(a, b\) => place\(a\) - place\(b\)\)/,
  '« Sur l’écran » se lit dans l’ordre de l’écran');
// Les écouteurs sont posés UNE FOIS sur la liste : renderColbar la reconstruit,
// des écouteurs par entrée s'empileraient ou disparaîtraient avec elle.
assert.ok(!/colbarItem[\s\S]{0,400}addEventListener\('dragstart'/.test(APP),
  'les écouteurs de glisser vivent sur la LISTE, pas sur chaque entrée');

// --- 6. CE QUI N'A PAS DE COLONNE NE SE DÉPLACE PAS -----------------------
// Le feu et les faits de production vivent dans la cellule « Infos » : il n'y a
// aucun rang à leur donner.
assert.match(APP, /const deplacable = !col\.horsTableau && !hiddenCols\.has\(col\.key\)/,
  'seules les colonnes qui ONT une colonne, et qui sont affichées, se déplacent');

// --- 7. LE DESSIN NE DÉPLACE RIEN --------------------------------------
// La poignée garde sa place au repos (opacité, pas `display`), et la cible se
// marque d'un trait — pas en écartant ses voisins : une cible qui bouge sous le
// curseur, c'est un dépôt à côté.
assert.match(CSS, /\.colbar-item__grip \{[^}]*opacity: 0;/,
  'la poignée garde sa place : sinon l’intitulé se décale au survol');
assert.match(CSS, /\.colbar-item\.est-cible \{ box-shadow: inset 0 0 0 2px var\(--primary\); \}/,
  'la cible se marque d’un trait, elle n’écarte pas ses voisins');

console.log('✓ ordre des colonnes : une permutation, trois rangs, et les bords qui ne bougent pas');
