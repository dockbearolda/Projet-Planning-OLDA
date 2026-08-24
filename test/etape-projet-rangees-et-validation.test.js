'use strict';

// L'ÉTAPE « PROJET » : LA LIGNE SE REMPLIT, ET CE QUI VALIDE FERME LA RANGÉE
// (24/08/2026)
//
// Quatre demandes du patron sur le même écran :
//
//   1. « Titre du projet doit être à droite de la famille concernée. »
//   2. « Dans cette bulle, les inputs — s'ils sont 2 ou 3 par ligne — doivent
//      remplir toute la ligne avec les mêmes tailles. Date souhaitée et heure
//      souhaitée doivent faire la même taille pour remplir parfaitement la
//      longueur. »
//   3. « Les flèches retour ici sont supprimées définitivement, car elle
//      existe en haut à gauche. » (tenu dans coquille-nav-et-rail.test.js)
//   4. « Contrôler le dossier doit obligatoirement, en tant qu'input de
//      validation, être en bas à droite comme partout sur cette app. »

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const DEVIS = fs.readFileSync(path.join(RACINE, 'public/comptoir/demande-devis.html'), 'utf8');

// --- 1. Le titre du projet tient la ligne, seul ------------------------------
// Le 24/08 au matin le titre est passé à DROITE des familles, en deux moitiés.
// L'après-midi : « supprime ça » — la pastille des familles. Elle ne faisait
// que répéter, en lecture seule, ce qui se déduit des besoins déjà saisis, et
// mangeait une moitié de rangée pour ça.
assert.ok(!/id="categoryPills"/.test(DEVIS),
  'la pastille des familles a quitté l’écran');
assert.ok(!/<label>Familles concernées<\/label>/.test(DEVIS) && !/<h3>Familles concernées<\/h3>/.test(DEVIS),
  '… avec son intitulé');
// … ET AVEC CE QUI L'ÉCRIVAIT. `prepareProject()` posait son contenu par
// `innerHTML` : laissé en place, il lèverait sur un élément absent à chaque
// passage à l'étape Projet — donc à chaque dossier.
assert.ok(!/categoryPills/.test(DEVIS),
  'plus rien n’écrit dans un élément qui n’existe plus');
// `categories()` reste : le titre proposé s'en sert.
assert.ok(/function categories\(\)/.test(DEVIS) && /suggestedTitle/.test(DEVIS),
  'le titre proposé automatiquement continue de se déduire des familles');

// La rangée n'ayant plus qu'une cellule, le titre prend toute la ligne — et la
// règle d'alignement écrite pour deux cellules s'en va avec elle.
assert.ok(!/tete-projet/.test(DEVIS),
  'la rangée à deux moitiés n’existe plus : ni sa classe, ni sa règle');

// --- 2. Une rangée remplit sa ligne ----------------------------------------
// `.grid` et `.grid-3` posaient un nombre FIXE de colonnes sans regarder ce
// qu'on y mettait. Trois rangées de l'écran étaient dans ce cas — dont
// « Date souhaitée » / « Heure souhaitée », qui ne faisaient ensemble que les
// deux tiers de la ligne. Mesuré après correctif : 2 × 445 px pour 906 px de
// rangée, gouttière comprise.
assert.ok(/\.grid-3:has\(> :nth-child\(2\)\):not\(:has\(> :nth-child\(3\)\)\)\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/.test(DEVIS),
  'une rangée de deux fait deux moitiés, pas deux tiers de trois');
assert.ok(/\.grid:not\(:has\(> :nth-child\(2\)\)\),\s*\.grid-3:not\(:has\(> :nth-child\(2\)\)\)\{grid-template-columns:minmax\(0,1fr\)\}/.test(DEVIS),
  'une rangée d’une seule cellule prend toute la ligne');

// `minmax(0, 1fr)` et pas `1fr` : sans le minimum à zéro, un menu au libellé
// long refuse de se réduire et déborde sa colonne — les colonnes cessent
// d'être égales au moment précis où le contenu arrive.
const nouvelles = DEVIS.match(/@media\(min-width:701px\)\{[\s\S]*?\n\}/);
assert.ok(nouvelles, 'les règles de remplissage existent');
assert.ok(!/:\s*repeat\(\d+,\s*1fr\)/.test(nouvelles[0]),
  'les colonnes passent par minmax(0,1fr) : sinon un libellé long les déséquilibre');

// SANS CE GARDE, LA RÈGLE CASSE L'ÉTROIT. Sous 701 px la rangée retombe sur
// une colonne — mais ces règles-ci sont PLUS SPÉCIFIQUES et la battraient.
assert.ok(/@media\(min-width:701px\)\{/.test(DEVIS),
  'les règles sont bornées au large : sinon elles battent le repli étroit');

// --- 3. Ce qui valide ferme la rangée, à droite ----------------------------
// Toute rangée d'actions qui porte une commande d'avancement (« … → ») se
// range à droite. Le garde-fou vise le SENS, pas les quatre rangées connues :
// une cinquième étape ajoutée demain sera prise elle aussi.
// TOUTE rangée de commandes finit à droite — plus seulement celles marquées
// `a-droite`. « Ajouter l'article, etc. doit TOUJOURS être en bas à droite. »
// Mesuré avant : « Ajouter l'article » à 1252 px du bord droit, « + Créer un
// nouveau client » à 771, « Réinitialiser valeurs Excel » à 365.
const rangees = DEVIS.match(/<div class="actions[^"]*"[^>]*>[\s\S]*?<\/div>/g) || [];
const avecAvancement = rangees.filter(r => /<button[^>]*class="primary"[^>]*>[^<]*→/.test(r));
assert.ok(avecAvancement.length >= 3,
  `les pieds d’étape portent une commande d’avancement (trouvé ${avecAvancement.length})`);

// Aucune rangée ne remet un alignement à gauche par un style EN LIGNE : il
// battrait la règle. « Créer et sélectionner » en portait un.
for (const r of rangees) {
  assert.ok(!/justify-content:\s*flex-start/.test(r),
    `une rangée se recolle à gauche par un style en ligne : ${r.slice(0, 80)}`);
}

// L'ACTION QUI ENGAGE EST LA DERNIÈRE. Coller la rangée à droite ne suffit
// pas : si « Annuler » suit le bouton primaire, c'est ANNULER qui se retrouve
// au bord. Trois rangées étaient dans ce cas sur les deux écrans.
//
// UNE EXCEPTION, ET ELLE A COÛTÉ UN DOSSIER. La rangée du récapitulatif porte
// « Nouvelle demande », qui EFFACE le dossier. L'accent (`primary`) reste sur
// « Enregistrer » et le bouton qui efface ne doit PAS fermer la rangée : c'est
// la règle écrite dans echelle-comptoir.test.js après le dossier perdu le
// 13/08. Ce qui ferme réellement cette rangée-là, c'est « Créer dans le
// planning », ajouté à l'exécution — donc l'action qui engage est bien la
// dernière à l'écran. On saute cette rangée ici plutôt que de la « corriger ».
for (const r of rangees) {
  if (/onclick="newRequest\(\)"/.test(r)) continue;
  const boutons = r.match(/<button[^>]*>/g) || [];
  if (boutons.length < 2) continue;
  const iPrimaire = boutons.findIndex(b => /class="[^"]*\bprimary\b/.test(b));
  if (iPrimaire === -1) continue;
  assert.ok(iPrimaire === boutons.length - 1,
    `l’action qui engage doit fermer la rangée : ${r.slice(0, 80)}`);
}

// … et on vérifie que l'exception reste ce qu'elle est : un bouton qui efface
// n'est jamais le dernier d'une rangée collée à droite.
const rangeeRecap = rangees.find(r => /onclick="newRequest\(\)"/.test(r));
assert.ok(rangeeRecap, 'la rangée du récapitulatif existe');
const derniersBoutons = rangeeRecap.match(/<button[^>]*>/g) || [];
assert.ok(!/onclick="newRequest\(\)"/.test(derniersBoutons[derniersBoutons.length - 1]),
  'le bouton qui EFFACE le dossier ne ferme pas la rangée — voir le 13/08');

// Le récapitulatif ne dit pas « → » — il enregistre — mais c'est le même pied
// d'étape, et il se range pareil.
const recap = DEVIS.match(/<div class="actions[^"]*" style="margin-top:var\(--pas-3\)">[\s\S]*?<\/div>/);
assert.ok(recap, 'le récapitulatif a son pied d’étape');
assert.ok(/\ba-droite\b/.test(recap[0]),
  '… rangé à droite comme les quatre autres');

// ON COLLE À DROITE PAR UNE MARGE AUTOMATIQUE, PAS PAR `flex-end` : une rangée
// en `justify-content:flex-end` qui déborde se fait rogner PAR LA GAUCHE, et
// c'est le début du contenu qui devient inatteignable. Piège déjà payé ailleurs
// dans ce dépôt.
// PAR UN ÉCARTEUR, PAS PAR UNE MARGE SUR LE PREMIER ENFANT. Le premier enfant
// est souvent MASQUÉ (« Annuler la modification » ne paraît qu'en modification) :
// un élément en `display:none` n'est pas mis en page, la marge posée dessus ne
// pousse rien. Piège vicieux — en démasquant les boutons POUR MESURER, on
// obtient le bon résultat et on croit la règle bonne.
assert.ok(/\.actions::before\{content:"";flex:1 1 0;min-width:0\}/.test(DEVIS),
  'le collage à droite passe par un écarteur flexible, insensible aux boutons masqués');
const blocActions = DEVIS.match(/\.actions\{[^}]*\}/);
assert.ok(blocActions && !/justify-content:\s*flex-end/.test(blocActions[0]),
  '… et surtout pas par un flex-end, qui rogne par la gauche');

// --- 5. L'avis sur la date : deux états, et hors de la cellule -------------
// « Supprime ça » visait le bandeau VERT — « ✓ Date compatible avec les
// horaires de l'atelier ». Il ne disait rien qu'on ne sache, prenait deux
// lignes pour confirmer l'absence de problème, et DÉCALAIT la rangée en
// paraissant. La charte est explicite : la couleur dit un état, pas une
// décoration.
assert.ok(!/Date compatible avec les horaires/.test(DEVIS),
  'le bandeau « tout va bien » ne s’affiche plus');
assert.ok(!/\.delay-warn\.ok\{/.test(DEVIS),
  '… et sa couleur n’a plus d’emploi');

// LES DEUX VRAIS ÉTATS RESTENT. Ce sont des garde-fous, pas des confirmations :
// l'atelier est fermé le week-end, et un délai de moins de 3 jours ouvrés n'est
// pas tenable. Chacun propose une date de remplacement en un clic.
assert.ok(/L’atelier est fermé le week-end/.test(DEVIS),
  'l’alerte week-end reste — l’atelier ne travaille pas le samedi');
assert.ok(/Délai très court/.test(DEVIS),
  'l’alerte de délai court reste');
assert.strictEqual((DEVIS.match(/>Utiliser cette date</g) || []).length, 2,
  '… et chacune des DEUX garde son bouton « Utiliser cette date »');

// IL VIT SOUS LA RANGÉE, PAS DEDANS. Posé dans la cellule de « Date souhaitée »
// il la faisait grandir, et « Heure souhaitée » descendait avec — le défaut du
// matin, à l'identique. Mesuré après : 0 px sur les deux commandes de la
// rangée quand l'alerte week-end paraît.
// Il porte un BOUTON : il ne peut donc pas flotter comme un message, un
// message flottant ne prend pas le clic.
const rangeeDates = DEVIS.match(/<div class="grid-3">(?:(?!<\/div><\/div>)[\s\S])*?id="desiredTime"[\s\S]*?<\/select><\/div><\/div>/);
assert.ok(rangeeDates, 'la rangée des dates existe');
assert.ok(!/desiredDateWarning/.test(rangeeDates[0]),
  'l’avis n’est plus dans une cellule de la rangée');
assert.ok(/<div id="desiredDateWarning" class="delay-warn hidden"><\/div>/.test(DEVIS),
  '… il a sa place à lui, sous la rangée, et il naît muet');

console.log('✓ étape Projet : le titre tient la ligne, chaque rangée la remplit, l’avis de date ne dit plus « tout va bien », ce qui valide ferme à droite');
