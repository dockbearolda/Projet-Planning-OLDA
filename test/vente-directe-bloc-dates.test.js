'use strict';

const { ecran } = require('./ecran-comptoir');

// LE BLOC DES DATES DE LA VENTE DIRECTE (24/08/2026)
//
// « Cette bulle ne va pas, y'a trop de truc. » Mesuré avant de toucher :
// « Date souhaitée » portait à elle seule HUIT enfants et DEUX intitulés — sa
// date, les trois raccourcis de délai, l'avis de supplément, le barème
// dépliable, puis l'heure souhaitée avec son propre intitulé. 276 px de haut
// à droite ; à gauche « Date de commande » et son champ, deux enfants étirés à
// la même hauteur : 215 px de vide en face d'un empilement.
//
// Puis : « la date de la commande n'a pas besoin d'être affichée puisqu'elle
// est à la date du jour. Donc recentre-moi date souhaitée. »

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const VENTE = ecran('vente-directe');

// Le bloc va de son ouverture au champ de l'heure : c'est là que tout se joue.
const deb = VENTE.indexOf('<input id="orderDate"');
assert.ok(deb > 0, 'la date de commande existe toujours dans la page');
const bloc = VENTE.slice(VENTE.lastIndexOf('<div class="bloc">', deb),
                         VENTE.indexOf('<div class="actions">', deb));
assert.ok(bloc.length > 0 && bloc.includes('deliveryTime'), 'le bloc des dates est bien découpé');

// --- 1. La date de commande quitte l'écran, PAS le dossier -----------------
// Elle est toujours celle du jour et personne ne la saisit. Mais huit endroits
// s'en servent : le palier de délai, l'enregistrement de l'article, la
// réouverture d'une commande, le contrôle des champs et le ticket qui
// l'imprime. La retirer du DOM aurait cassé les huit.
assert.ok(/<input id="orderDate" type="date" class="hidden">/.test(VENTE),
  'la date de commande reste dans la page, masquée — sa valeur sert encore');
assert.ok(!/<label for="orderDate"/.test(VENTE),
  '… mais elle n’a plus d’intitulé à l’écran');
for (const usage of [
  ['orderDate").value=isoDate(today)', 'elle est posée à la date du jour'],
  ['orderDate:document.getElementById("orderDate").value', 'elle est enregistrée avec l’article'],
  ['orderDate").value=p.orderDate', 'elle revient quand on rouvre une commande'],
  ["'Date de commande',d(v('orderDate')", 'le ticket l’imprime toujours'],
]) assert.ok(VENTE.includes(usage[0]), `${usage[1]} — sinon la retirer de l’écran l’aurait perdue`);

// `isoDate()` retire le décalage AVANT de formater : il rend la date civile
// LOCALE. À Saint-Martin (UTC−4) un `toISOString()` nu daterait du lendemain
// dès 20 h — et depuis qu'elle est masquée, personne ne verrait l'erreur.
assert.ok(/function isoDate\(date\)\{[^}]*getTimezoneOffset\(\)/.test(VENTE),
  'la date du jour est la date civile locale, pas un toISOString() nu');

// --- 2. La rangée ne porte plus que des dates ------------------------------
// Deux cellules, un seul intitulé chacune. Tout le reste est descendu.
assert.ok(/<div class="grid">\s*<div class="field">\s*<label for="deliveryDate">/.test(bloc),
  'la rangée commence par « Date souhaitée »');
assert.ok(/<label for="deliveryTime">/.test(bloc),
  '… et « Heure souhaitée » est une CELLULE, plus un second intitulé empilé');
// Tout ce qui n'est pas une date vient APRÈS la dernière cellule de la rangée :
// plus rien n'est empilé dans la cellule de « Date souhaitée ».
const finRangee = bloc.indexOf('<label for="deliveryTime">');
assert.ok(finRangee > -1, 'la cellule de l’heure est dans le bloc');
for (const orphelin of ['delay-quick', 'deadlineInfo']) {
  const ou = bloc.indexOf(orphelin);
  assert.ok(ou > -1, `${orphelin} est toujours là`);
  assert.ok(ou > finRangee, `${orphelin} n’est plus empilé dans la cellule de la date`);
}
// LE BARÈME A QUITTÉ L'ÉCRAN DE VENTE (27/08). Trois pourcentages d'atelier
// qui valent pour tous les postes et changent une fois par an : ils n'ont rien
// à faire sous les yeux d'une vendeuse qui a un client devant elle. Ils se
// règlent dans Réglages, sur la même API.
for (const parti of ['baremeOpen', 'baremeBox', 'bareme-open']) {
  assert.ok(!VENTE.includes(`id="${parti}"`) && !VENTE.includes(`class="${parti}"`),
    `${parti} ne doit plus être sur l’écran de vente`);
}
// …MAIS LE BARÈME SE CHARGE TOUJOURS. `charger()` partait APRÈS la garde qui
// cherchait le bouton : retirer le bouton aurait fait tourner l'écran sur les
// pourcentages par DÉFAUT, et le supplément affiché au client aurait été faux.
const gardeBareme = VENTE.indexOf('const ouvrir = el("baremeOpen");');
const chargeBareme = VENTE.indexOf('    charger();');
assert.ok(chargeBareme > -1 && chargeBareme < gardeBareme,
  'le barème se charge AVANT la garde qui cherche son éditeur');

// LE SECOND INTITULÉ ÉTAIT LA CAUSE DE L'EXCEPTION. Une rangée qui contient un
// champ à deux intitulés renonce au partage de lignes (`label~label`) — c'était
// « le seul cas des deux écrans ». La règle reste, elle ne mord plus ici.
assert.ok(/\.grid:has\(>\.field label~label\)/.test(VENTE),
  'la règle d’exception existe toujours pour qui en aurait besoin');

// --- 3. Le délai sous la rangée, sur deux lignes stables -------------------
// Une seule ligne déborderait (385 + 420 + 150 px pour 910 disponibles), et une
// rangée qui se replie change de hauteur selon la longueur du texte.
assert.ok(/<div class="delai-rangee">/.test(bloc), 'le délai a sa propre rangée');
assert.ok(!/\.delai-rangee\{[^}]*justify-content:\s*flex-end/.test(VENTE),
  'ce qui ferme la rangée à droite se pose par une marge automatique, '
  + 'jamais par un flex-end, qui rogne par la gauche');

// L'AVIS DE SUPPLÉMENT CHANGE DE TEXTE À CHAQUE DATE. Sur toute la largeur il a
// la marge qui lui manquait dans une cellule de 430 px. Vérifié dans le
// navigateur : ses quatre textes font 22 px, le bloc 224 px, et le bouton
// « Ajouter l'article » ne bouge pas d'un pixel.
assert.ok(/<div id="deadlineInfo" class="help delai-etat"><\/div>/.test(bloc),
  'l’avis de supplément prend toute la largeur du bloc');

// --- 4. `minmax(0, 1fr)`, jamais `1fr` -------------------------------------
// Sans le minimum à zéro, une cellule refuse de se réduire sous son contenu :
// le menu des heures déséquilibrait la rangée.
assert.ok(/\.grid-3\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(VENTE),
  'les colonnes peuvent se réduire : sinon un libellé long les déséquilibre');

// --- 5. La validation de la vente ferme la ligne, à droite -----------------
// Cette barre flottait au CENTRE, large de 385 px pour 1071 de carte.
// `.container` est en `flex-direction:column` : la barre en est un ITEM, et sur
// un item flex une marge `auto` n'aligne pas — elle AVALE l'espace libre.
// Mesuré : 342,9 px absorbés de chaque côté. Le `max-width` et les marges
// automatiques avaient été écrits pour un contexte de BLOC, où ils marchaient.
const barre = VENTE.match(/\.tablet-wizard-nav\{[^}]*\}/);
assert.ok(barre, 'la barre de validation existe');
assert.ok(/align-self:stretch/.test(barre[0]),
  'la barre prend la largeur de la carte, elle ne flotte plus au centre');
assert.ok(!/margin:var\(--pas-3\) auto 0/.test(barre[0]),
  '… ses marges automatiques ne l’avalent plus');
assert.ok(!/max-width:1100px/.test(barre[0]),
  '… et aucun plafond ne la laisse plus étroite que la carte (48 px à 1180)');
// L'écarteur pousse « Valider … et continuer → » au bord droit ; le retour
// reste à gauche. Mesuré : 1 px de chaque côté, à l'intérieur de la barre.
assert.ok(/\.tablet-wizard-nav \.wizard-spacer\{flex:1\}/.test(VENTE),
  'l’écarteur sépare le retour de la validation');

console.log('✓ vente directe : la date du jour quitte l’écran sans quitter le dossier, et le bloc des dates ne porte plus d’empilement');
