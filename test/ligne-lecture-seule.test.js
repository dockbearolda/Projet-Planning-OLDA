'use strict';

// LA LIGNE NE S'ÉDITE PLUS EN PLACE (30/08/2026)
// ===========================================================================
// Charlie, en désignant une ligne du planning : « supprime le fait qu'on
// puisse écrire directement sur la ligne, la seule façon de faire des modifs
// est de cliquer dessus, la ligne ».
//
// Quatre cellules tapaient encore en place : le nom du dossier, l'article, le
// prix TTC et la note (« Infos »). Toutes les quatre deviennent du texte
// qu'on LIT — un `<div>`/`<span>`/`<button>` sans jamais un `<input>` ni un
// `<textarea>` — pour la même raison que les trois portes retirées le 28/08
// (voir test/fiche-tout-modifiable.test.js) : la ligne entière ouvre déjà la
// fiche au clic (`ouvrirAuClic`), et `ZONE_CLIQUABLE` n'exclut que les
// VRAIS contrôles. Un champ texte qui traîne encore dans une cellule avale
// donc ce clic — c'est exactement le bug que ce fichier interdit.
//
// TROIS DES QUATRE avaient déjà leur place dans la fiche (Client, Prix TTC,
// Note). LA QUATRIÈME — l'article (`product`) — N'ÉTAIT ÉDITABLE NULLE
// PART AILLEURS : sans une porte de repli, la ligne serait devenue
// définitivement muette sur ce champ. Elle entre donc dans l'entête de la
// fiche, à la place du texte qui l'affichait déjà en lecture.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const APP = lire('public/app.js');
const FICHE = lire('public/fiche-atelier.js');

// Découpe une fonction : de sa signature jusqu'à l'accolade fermante posée à
// la MÊME indentation (même utilitaire que test/audit-2026-08-17.test.js).
function bloc(src, signature) {
  const from = src.indexOf(signature);
  assert.ok(from >= 0, `bloc introuvable : ${signature}`);
  const indent = signature.match(/^\s*/)[0];
  const to = src.indexOf(`\n${indent}}`, from);
  assert.ok(to > from, `fin de bloc introuvable : ${signature}`);
  return src.slice(from, to + indent.length + 2);
}

// ---------------------------------------------------------------------------
// 1. LES QUATRE CELLULES NE CRÉENT PLUS AUCUN CHAMP DE SAISIE
// ---------------------------------------------------------------------------
for (const signature of [
  'function cellDossier(r)',
  'function cellDescription(r)',
  'function cellPrice(r)',
  'function cellInfos(r)',
]) {
  const b = bloc(APP, signature);
  assert.ok(!/createElement\('input'\)/.test(b) && !/createElement\('textarea'\)/.test(b),
    `${signature} ne doit créer ni <input> ni <textarea> : la ligne se lit, elle ne se remplit pas`);
}

// ---------------------------------------------------------------------------
// 2. LA NOTE GARDE SA LECTURE — deux lignes, une flèche pour la suite. On a
// retiré l'ÉDITION, pas la lisibilité gagnée le 25/08 (médiane 336
// caractères, 66 % coupées à deux lignes).
// ---------------------------------------------------------------------------
{
  const b = bloc(APP, 'function cellInfos(r)');
  assert.ok(/estCoupee = \(\) => view\.scrollHeight > view\.clientHeight \+ 1/.test(b),
    'la détection de note coupée doit survivre au retrait du champ');
  assert.ok(/toggle\.addEventListener\('click'/.test(b),
    'la flèche déplie toujours la suite d’une note longue');
  assert.ok(/observateurNotes\.observe\(view\)/.test(APP),
    'la mesure au redimensionnement de colonne doit toujours tourner');
}

// ---------------------------------------------------------------------------
// 3. L'ARTICLE ENTRE DANS L'ENTÊTE DE LA FICHE — sa seule porte de repli.
// ---------------------------------------------------------------------------
assert.ok(/champ\('fa-projet', r\.product \|\| '', \{ label: 'Projet'/.test(FICHE),
  'l’entête doit poser un champ éditable pour l’article, pas un simple texte');
assert.ok(/ctx\.patchLigne\('product', v \|\| null\)/.test(FICHE),
  'et l’écrire sur la même colonne que la ligne lisait');

// ---------------------------------------------------------------------------
// 4. LES TROIS AUTRES CHAMPS RESTENT MODIFIABLES DANS LA FICHE, comme avant
// le 30/08 — ce n'est QUE la ligne qui perd l'édition, pas l'application.
// ---------------------------------------------------------------------------
for (const [champ, motif] of [
  ['Client', /ctx\.patchLigne\('billing_company'/],
  ['Prix TTC', /ctx\.patchLigne\('project_value'/],
  ['Note', /ctx\.patchLigne\('description'/],
]) {
  assert.ok(motif.test(FICHE), `« ${champ} » doit rester modifiable dans la fiche`);
}

console.log('✓ ligne-lecture-seule : dossier, article, prix et note se lisent sur la ligne, se modifient dans la fiche');
