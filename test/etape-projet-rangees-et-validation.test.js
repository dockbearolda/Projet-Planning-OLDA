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

// --- 1. Le titre du projet est à DROITE des familles -----------------------
// Les deux partagent la ligne en deux moitiés. L'ORDRE compte : « à droite »
// veut dire deuxième cellule, pas « quelque part sur la même ligne ».
const debut = DEVIS.indexOf('<div class="grid tete-projet">');
assert.ok(debut > 0, 'les familles et le titre partagent une rangée');
const zone = DEVIS.slice(debut, debut + 700);
const iFamilles = zone.indexOf('id="categoryPills"');
const iTitre = zone.indexOf('id="projectTitle"');
// LES DEUX D'ABORD, L'ORDRE ENSUITE. Comparer deux `indexOf` sans vérifier
// qu'ils ont trouvé laisse passer exactement le défaut qu'on veut attraper :
// absent, `indexOf` rend -1, et -1 est plus petit que tout.
assert.ok(iFamilles > -1 && iTitre > -1,
  'les deux cellules sont bien DANS la rangée');
assert.ok(iFamilles < iTitre,
  'les familles à gauche, le titre du projet à DROITE');
assert.ok(!/<h3>Familles concernées<\/h3>/.test(DEVIS),
  'les familles portent un intitulé de champ, pas un titre : sinon les deux ' +
  'intitulés de la rangée ne sont ni de la même boîte ni sur la même ligne');

// Le collage en bas de `.grid` mettrait la pastille des familles au niveau du
// CHAMP du titre — les deux intitulés se retrouveraient décalés d'une ligne.
assert.ok(/\.tete-projet\{align-items:start\}/.test(DEVIS),
  'la rangée s’aligne par le HAUT : les deux intitulés sur la même ligne');

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

console.log('✓ étape Projet : le titre à droite des familles, chaque rangée remplit sa ligne, ce qui valide ferme à droite');
