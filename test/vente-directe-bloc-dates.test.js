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

// ⚠ LE « BLOC » N'EN EST PLUS UN DEPUIS LE 02/09. La saisie est une FEUILLE DE
// CALCUL — l'intitulé à gauche, la case à droite (`.rangs` / `.rang`,
// charte.css, la grammaire du devis flash). Les deux groupes encadrés ont
// fusionné : les traits de la feuille séparent déjà rangée par rangée, et un
// cadre de plus dans une carte-volet faisait un niveau de trop.
// Ce que ce fichier tient reste le MÊME : la date de commande qui quitte
// l'écran sans quitter le dossier, et rien d'empilé dans la cellule d'une date.
const deb = VENTE.indexOf('<input id="orderDate"');
assert.ok(deb > 0, 'la date de commande existe toujours dans la page');
const bloc = VENTE.slice(deb, VENTE.indexOf('<div class="actions">', deb));
assert.ok(bloc.length > 0 && bloc.includes('deliveryTime'), 'la feuille de saisie est bien découpée');

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

// --- 2. Chaque date est une RANGÉE, et rien n'y est empilé -----------------
// Un intitulé, une case, un trait. « Date souhaitée » portait à elle seule huit
// enfants et deux intitulés ; elle n'en porte plus qu'un.
assert.ok(/<label class="rang__k" for="deliveryDate">Date souhaitée \*<\/label>/.test(bloc),
  '« Date souhaitée » est une rangée de la feuille');
assert.ok(/<label class="rang__k" for="deliveryTime">Heure souhaitée \*<\/label>/.test(bloc),
  '… et « Heure souhaitée » est une RANGÉE À ELLE, plus un second intitulé empilé');
// Tout ce qui n'est pas une date vient APRÈS la dernière rangée : plus rien
// n'est empilé dans la case de « Date souhaitée ».
const finRangee = bloc.indexOf('for="deliveryTime"');
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
// Depuis le 01/09 la garde n'existe plus : le script de l'éditeur est parti
// avec lui, et le chargement est branché seul sur l'ouverture de la page.
assert.match(VENTE, /document\.addEventListener\("DOMContentLoaded", charger\);/,
  'le barème se charge à l’ouverture, sans éditeur à chercher');
assert.ok(!/baremeSave|baremeCancel|baremeMsg/.test(VENTE),
  'le script de l’éditeur est parti avec ses boutons');

// LE SECOND INTITULÉ ÉTAIT LA CAUSE D'UNE EXCEPTION — une rangée à deux
// intitulés renonçait au partage de lignes (`label~label`), « le seul cas des
// deux écrans ». Elle est partie AVEC la grille de champs le 02/09 : sur une
// feuille de calcul, une rangée porte un intitulé et une case, il n'y a plus
// de lignes à partager ni d'exception à écrire.
// Sur la feuille DÉPOUILLÉE : la note qui explique le départ de la règle en
// porte le nom, et la chercher ferait échouer le test sur sa propre explication.
assert.ok(!/label~label/.test(VENTE.replace(/\/\*[\s\S]*?\*\//g, ' ')) && !/class="field"/.test(VENTE),
  'plus de grille de champs sur cet écran, donc plus d’exception à tenir');

// --- 3. Les raccourcis sous la feuille, sur toute la largeur ---------------
// `.delai-rangee` est partie avec le barème : elle mettait les trois raccourcis
// et le réglage du barème sur une ligne, et le barème a quitté cet écran le
// 27/08 — il ne restait qu'un conteneur à un seul enfant.
assert.ok(/<div class="delay-quick">/.test(bloc), 'les trois raccourcis sont sous la feuille');
assert.ok(!/delai-rangee/.test(VENTE.replace(/\/\*[\s\S]*?\*\//g, ' ')),
  'le conteneur à un seul enfant est parti avec le barème qu’il accompagnait');

// L'AVIS DE SUPPLÉMENT CHANGE DE TEXTE À CHAQUE DATE. Sur toute la largeur il a
// la marge qui lui manquait dans une cellule de 430 px. Vérifié dans le
// navigateur : ses quatre textes font 22 px, le bloc 224 px, et le bouton
// « Ajouter l'article » ne bouge pas d'un pixel.
assert.ok(/<div id="deadlineInfo" class="help delai-etat"><\/div>/.test(bloc),
  'l’avis de supplément prend toute la largeur');

// --- 4. `minmax(0, 1fr)`, jamais `1fr` -------------------------------------
// Sans le minimum à zéro, une piste refuse de se réduire sous son contenu :
// une désignation longue pousserait les trois colonnes de nombres hors de la
// carte. La règle a suivi la feuille de calcul : elle est sur les pistes du
// TABLEAU maintenant, plus sur une grille de champs qui n'existe plus.
assert.ok(/\.lignes\{--lignes-cols:minmax\(0,1fr\) /.test(VENTE),
  'la désignation peut se réduire : sinon elle pousse les nombres hors de la carte');
assert.ok(/\.rangs\{--rangs-k:\d+px\}/.test(VENTE),
  'la colonne des intitulés est un JETON de cet écran : ses libellés sont plus longs que ceux du devis');

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
