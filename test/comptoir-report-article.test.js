'use strict';

// CE QUI NE CHANGE PAS D'UN ARTICLE AU SUIVANT RESTE POSÉ (04/09/2026)
//
// Mesuré à l'écran, sur « Demande de devis », étape « Besoins » : TREIZE champs
// pour un article, et DEUX seulement remplis une fois la référence choisie (la
// référence et le genre, que `onTextileRefChange` déduit du catalogue). Puis
// `cancelTextileEdit` les vidait TOUS à l'ajout — y compris ceux qui décrivent
// le travail de l'atelier et non l'article.
//
// Un client qui prend le même t-shirt en trois couleurs faisait donc trois fois
// le tour complet : référence, genre, emplacement du marquage, couleur du
// marquage, transport. Cinq choix refaits à l'identique par article.
//
// C'EST LE LEVIER DE VITESSE DU COMPTOIR, et le seul : le NOMBRE de champs et
// les valeurs DÉJÀ POSÉES — pas la façon de circuler entre eux (aucun parcours
// clavier ici, tranché le 26/08 : la vendeuse navigue à la souris).
//
// LA FRONTIÈRE EST NETTE, et c'est elle que ce test tient :
//   · se reporte   ce qui décrit le TRAVAIL — le vêtement, son genre, où et de
//                  quelle couleur on marque, comment il arrive ;
//   · ne se reporte pas   ce qui définit L'ARTICLE — la couleur du textile, les
//                  tailles, la note, l'ajustement tarifaire. Ce sont justement
//                  les raisons pour lesquelles on en ajoute un deuxième ; les
//                  reporter poserait une ligne fausse d'apparence complète.

const assert = require('node:assert');
const { page } = require('./ecran-comptoir.js');

const DD = page('demande-devis');

// --- 1. L'ajout repose les valeurs, et il le fait APRÈS le vidage -----------
// `cancelTextileEdit` sert AUSSI au bouton « Annuler la modification » : elle
// doit continuer à tout vider. Le report se pose donc par-dessus, dans le seul
// chemin de l'ajout — pas en affaiblissant le vidage.
assert.ok(/cancelTextileEdit\(\);txReporter\(d\);renderNeeds\(\)/.test(DD),
  'l’ajout repose les valeurs reportées après avoir vidé le formulaire');
assert.ok(/function txReporter\(d\)\{/.test(DD), 'txReporter est définie');

const rep = DD.match(/function txReporter\(d\)\{[\s\S]*?\n\}/);
assert.ok(rep, 'le corps de txReporter se lit');
const corps = rep[0].replace(/\/\*[\s\S]*?\*\//g, '');

// --- 2. La référence D'ABORD, seule ---------------------------------------
// C'est elle qui repeuple le genre, les coloris et le tableau des tailles :
// poser le genre avant elle, c'est le voir effacé une milliseconde plus tard.
assert.ok(corps.indexOf("$('txRef').value=d.ref") < corps.indexOf('onTextileRefChange()'),
  'la référence se pose avant le rappel qui repeuple ses listes');
assert.ok(corps.indexOf('onTextileRefChange()') < corps.indexOf("poser('txGenre'"),
  '… et le genre se pose APRÈS, sinon le rappel l’écrase');

// --- 3. CE QUI SE REPORTE, ET RIEN D'AUTRE --------------------------------
for (const champ of ['txGenre', 'txPrintType', 'txMarkColor', 'txTransport']) {
  assert.ok(corps.includes(`poser('${champ}'`), `${champ} décrit le travail : il se reporte`);
}
for (const champ of ['txColor', 'txS', 'txM', 'txL', 'txXL', 'txXXL', 'txOther',
  'txNote', 'txDiscount', 'txManualPrice']) {
  assert.ok(!corps.includes(`'${champ}'`),
    `${champ} définit l’article, pas le travail : il ne se reporte JAMAIS`);
}

// --- 4. UN PRODUIT LIBRE NE SE REPORTE PAS --------------------------------
// Sa référence, son prix d'achat et sa désignation sont saisis à la main pour
// CE produit-là. Reporter la référence sans le prix rendrait une ligne fausse
// d'apparence complète — et le prix d'achat est ce qui la chiffre.
assert.ok(/if\(!d\|\|!d\.ref\|\|d\.isCustom\)return/.test(corps),
  'un produit libre, ou un formulaire sans référence, ne reporte rien');
for (const champ of ['txCustomRef', 'txCustomPurchase', 'txCustomDesignation']) {
  assert.ok(!corps.includes(`'${champ}'`), `${champ} appartient au produit libre : il ne se reporte pas`);
}

// --- 5. LES MENUS MAISON SONT PRÉVENUS ------------------------------------
// Ils HABILLENT ces champs (menu-recherche.js) : changer la valeur sans les
// rafraîchir laisse le déclencheur afficher l'ancienne — le champ MENT, et
// c'est un défaut déjà payé sur cet écran.
assert.ok(/menusRafraichirTous\(\)/.test(corps),
  'les menus qui habillent ces champs sont rafraîchis, sinon ils affichent l’ancienne valeur');

// --- 6. RIEN N'EST VERROUILLÉ ---------------------------------------------
// Un champ reporté se change comme un champ vide : on repose une valeur, on ne
// pose ni `disabled` ni `readonly`.
assert.ok(!/disabled|readOnly/.test(corps),
  'une valeur reportée reste modifiable — on gagne un geste, on n’en interdit aucun');

console.log('✓ comptoir : l’article suivant garde ce qui décrit le travail, et rien de ce qui le définit');
