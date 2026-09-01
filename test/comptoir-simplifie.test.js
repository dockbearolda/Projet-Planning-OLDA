'use strict';

const { ecran } = require('./ecran-comptoir');

// LES DEUX PARCOURS DU COMPTOIR, SIMPLIFIÉS (27/08/2026)
//
// Charlie : « il y a toutes les infos, mais on ne va pas se servir de toutes
// les infos. » Mesuré champ par champ sur les 55 dossiers réels du comptoir en
// production — 33 ventes directes, 22 demandes de devis.
//
// TROIS NIVEAUX, PAS UN DE PLUS.
//   1. sur le chemin — ce qui est rempli neuf fois sur dix ;
//   2. derrière un volet — ce qui sert une fois sur trois ;
//   3. ailleurs — une fiche client va dans la Base clients, un barème
//      d'atelier dans les Réglages.
//
// ET UNE RÈGLE DE FOND : aucun champ obligatoire en dessous de 90 % de
// remplissage réel. Trois champs marqués `*` étaient remplis 14 %, 14 % et
// 38 % du temps : l'astérisque ne voulait plus rien dire, on le contournait.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const DEVIS = ecran('demande-devis');
const VENTE = ecran('vente-directe');
const CHARTE = lire('public/charte.css');
const REGLAGES = lire('public/reglages.js');

// ---------------------------------------------------------------------------
// 1. LE VOLET EST UN COMPOSANT PARTAGÉ, PAS DEUX QUI SE RESSEMBLENT
// ---------------------------------------------------------------------------
// Deux écrans à un clic l'un de l'autre doivent donner le MÊME volet. Il vit
// donc dans charte.css, le seul fichier que les deux parcours lisent.
assert.match(CHARTE, /\.volet-plus > summary \{/, 'le volet vit dans la charte partagée');
assert.match(CHARTE, /\.volet-plus\[open\]::details-content \{ height: auto; \}/,
  'un volet se déroule, il ne saute pas');
assert.match(CHARTE, /\.volet-plus \{ interpolate-size: allow-keywords; \}/,
  '`interpolate-size` est posé sur le volet, pas au :root : il rend TOUTE hauteur '
  + 'automatique animable, on ne l’ouvre que là où on s’en sert');
for (const [nom, src] of [['devis', DEVIS], ['vente', VENTE]]) {
  assert.ok(src.includes('class="volet-plus"') || src.includes('volet-plus"'),
    `${nom} : l’écran emploie le volet partagé`);
  // …et n'en réinvente pas un à côté.
  assert.ok(!/\.volet-plus\s*>\s*summary\s*\{/.test(src),
    `${nom} : le volet ne se redéclare pas dans l’écran`);
}

// ---------------------------------------------------------------------------
// 2. CE QUI N'EST PAS UNE SAISIE DE COMPTOIR A DÉMÉNAGÉ
// ---------------------------------------------------------------------------
// LE BARÈME EXPRESS : trois pourcentages d'atelier qui valent pour tous les
// postes et changent une fois par an.
assert.ok(!/id="baremeOpen"/.test(VENTE) && !/id="baremeBox"/.test(VENTE),
  'le barème a quitté l’écran de vente');
assert.match(REGLAGES, /carteSimple\('bolt', 'Suppléments express'/,
  '… et il a une carte dans Réglages');
assert.match(REGLAGES, /api\('PUT', '\/api\/supplements-express'/,
  '… sur la MÊME API : un seul barème, pas deux');
assert.match(REGLAGES, /api\('GET', '\/api\/supplements-express'\)/,
  '… relu à chaque retour sur l’onglet');
// LE PIÈGE (27/08) : le chargement partait APRÈS la garde qui cherchait le
// bouton. Depuis le 01/09 l'éditeur n'a plus de script du tout : il ne reste
// que le chargement, branché directement sur l'ouverture de la page.
assert.match(VENTE, /document\.addEventListener\("DOMContentLoaded", charger\);/,
  'le comptoir charge toujours le barème : sinon il applique les valeurs par '
  + 'DÉFAUT et le supplément affiché au client est faux');
assert.ok(!/baremeSave|baremeCancel|baremeMsg|bareme-j5/.test(VENTE),
  'l’éditeur du barème est parti en entier, script compris');

// ---------------------------------------------------------------------------
// 3. LES COORDONNÉES DE FACTURATION SONT DERRIÈRE UN VOLET
// ---------------------------------------------------------------------------
// Secteur 38 %, adresse / ville / code postal 40 %, fonction du contact 25 %,
// second contact 1 fois sur 22. L’atelier ne livre pas — le client vient
// chercher, et la facture part par e-mail.
for (const [nom, src, champs] of [
  ['vente', VENTE, ['newCompanySector', 'newCompanyAddress', 'newCompanyCity',
    'newCompanyPostal', 'newCompanyContactRole']],
  ['devis', DEVIS, ['newClientSector', 'newClientAddress', 'newClientCity',
    'newClientPostal', 'newClientContactRole', 'newClientPhone2']],
]) {
  const volets = src.match(/<details class="volet-plus">[\s\S]*?<\/details>/g) || [];
  for (const champ of champs) {
    assert.ok(volets.some((v) => v.includes(`id="${champ}"`)),
      `${nom} : ${champ} doit être dans un volet`);
  }
  // UN SEUL ÉLÉMENT PAR VALEUR. Le <select> descend d'un cran, il ne se
  // recopie pas : deux champs pour une valeur, c'est la valeur qui se perd.
  for (const champ of champs) {
    assert.strictEqual((src.match(new RegExp(`id="${champ}"`, 'g')) || []).length, 1,
      `${nom} : ${champ} n’existe qu’une fois`);
  }
}
// L'ASTÉRISQUE DU SECTEUR EST TOMBÉ des deux côtés.
assert.ok(!/Secteur d.activité \*/.test(VENTE) && !/Secteur d.activité \*/.test(DEVIS),
  'un champ rempli 38 % du temps n’est pas obligatoire : il est contourné');
assert.ok(!/newCompanySector","newCompanyContact"/.test(VENTE),
  '… et la validation ne le réclame plus');
assert.ok(!/getElementById\('newClientSector'\)\.value\)return fail/.test(DEVIS),
  '… des deux côtés');

// ---------------------------------------------------------------------------
// 4. UN RÉCAPITULATIF REPREND LES CHAMPS SAISIS
// ---------------------------------------------------------------------------
// La règle existait pour l'écran de la demande, appliquée nulle part. Sur une
// demande ordinaire, TREIZE lignes du dossier disaient « — » ; sur une vente,
// cinq. Recopiées sur le bon de commande, relues à chaque ouverture.
assert.match(DEVIS, /return out\.filter\(function\(l\)\{\s*\n\s*if\(IDENTITE\[l\[0\]\]\)return true;/,
  'devis : une ligne vide ne s’écrit plus au dossier');
assert.match(DEVIS, /var IDENTITE=\{'Type de dossier':1,'Référence':1\};/,
  '… sauf les deux qui IDENTIFIENT le dossier : une référence absente doit se voir');
assert.match(DEVIS, /function tl\(k,v\)\{var t=String\(v==null\?'':v\)\.trim\(\);return \(!t\|\|t==='—'\)\?''/,
  '… ni sur le ticket imprimé');
assert.match(VENTE, /var vide=function\(x\)\{/, 'vente : la même règle');
assert.match(VENTE, /if\(!zero\(p\.priceCustom\)\)out\.push/,
  '… et le prix de personnalisation ne s’écrit qu’au-dessus de zéro (11 fois sur 19)');
assert.match(VENTE, /if\(!zero\(p\.surcharge\)\)out\.push/,
  '… le supplément express aussi (3 fois sur 41)');
// CE QUI RESTE MESURÉ : « Prix personnalisation » sert 11 fois sur 19. On ne
// le fusionne PAS avec le prix de l'article — c'est une vraie distinction.
assert.ok(/id="customPrice"/.test(VENTE) && /id="articlePrice"/.test(VENTE),
  'les deux prix restent deux champs : la personnalisation sert une fois sur deux');

console.log('✓ comptoir : trois niveaux, et rien qui disparaisse sans avoir été mesuré');
