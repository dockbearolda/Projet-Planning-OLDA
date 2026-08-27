'use strict';

const { ecran } = require('./ecran-comptoir');

// L'ÉTAPE « CONTRÔLE » A DISPARU (27/08/2026)
//
// Charlie : « il y a toutes les infos, mais on ne va pas se servir de toutes
// les infos. » Cette étape posait DIX questions, et une étape entière du
// parcours pour ça. Mesuré sur les 22 demandes réelles de la production :
//
//   Points à contrôler .................  1 fois sur 22
//   Transmission prévue par * ..........  3 fois sur 22   (obligatoire)
//   Informations que le client doit
//     transmettre * ....................  3 fois sur 22   (obligatoire)
//   Éléments reçus du client ........... 10 fois sur 22
//   Informations transmises par ........ 10 fois sur 22
//   État des informations * ............ 16 fois sur 22 la MÊME réponse
//   Reprise de vectorisation ........... 16 fois sur 22 la MÊME réponse
//
// Trois questions seulement disaient quelque chose : le type de logo (36 %),
// son statut (50 %) et la maquette (45 %). Elles sont descendues dans l'étape
// « Projet », avec le reste du dossier. Les six cases de notes quasi vides
// posaient six fois la même question — qu'est-ce qui manque, qui l'apporte,
// quand — elles n'en font plus qu'une : « Notes ».
//
// RIEN N'EST PERDU : ce qui s'écrivait dans ces six cases s'écrit dans celle-là,
// et arrive au même endroit du dossier.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DEVIS = ecran('demande-devis');
const CHARTE = fs.readFileSync(path.join(__dirname, '..', 'public/charte.css'), 'utf8');

// ---------------------------------------------------------------------------
// 1. L'ÉTAPE N'EXISTE PLUS — NI SA SECTION, NI SES CHAMPS, NI SON CODE
// ---------------------------------------------------------------------------
assert.ok(!/id="step4"/.test(DEVIS), 'la section de l’étape « Contrôle » a disparu');
for (const champ of ['controlStatus', 'informationReceivedVia', 'newInformationReceivedVia',
  'expectedInformationVia', 'newExpectedInformationVia', 'expectedInformation',
  'receivedElements', 'missingNotes', 'vectorizationStatus', 'waitingInformationBox',
  'receivedViaField']) {
  assert.ok(!DEVIS.includes(`id="${champ}"`), `le champ ${champ} ne doit plus exister`);
}
// Le code qui les lisait part avec eux : un `$('id').value` sur un élément
// absent lève, et l'écran s'arrête net au milieu du parcours.
for (const mort of ['toggleControlStatus', 'transmissionValue(']) {
  assert.ok(!DEVIS.includes(mort), `${mort} est du code mort`);
}
// `clientNextActionValue` reste — elle est appelée de partout —, mais elle ne
// peut plus rien lire : elle répond « devis à faire », qui était déjà la
// réponse 21 fois sur 22.
assert.ok(/function clientNextActionValue\(\)\{[\s\S]*?champ&&champ\.value==='waiting'/.test(DEVIS),
  'la déduction survit, et elle est GARDÉE contre l’élément absent');

// ---------------------------------------------------------------------------
// 2. CE QUI SERVAIT VRAIMENT EST DESCENDU DANS « PROJET »
// ---------------------------------------------------------------------------
const step3 = DEVIS.match(/<section id="step3"[\s\S]*?<\/section>/)[0];
for (const garde of ['clientLogoStatus', 'logoReceptionStatus', 'oldaMockupStatus']) {
  assert.ok(step3.includes(`id="${garde}"`), `${garde} vit maintenant dans l’étape Projet`);
}
assert.ok(/<h3[^>]*>Le logo<\/h3>/.test(step3),
  'les trois questions du logo forment un bloc qui se nomme');

// UNE SEULE CASE DE NOTES, et elle ne s'écrit au dossier que si elle dit
// quelque chose — la règle du récapitulatif, appliquée ici aussi.
assert.ok(step3.includes('id="projectNotes"'), 'la case « Notes » remplace les six');
assert.ok(/if\(val\('projectNotes'\)\.trim\(\)\)out\.push\(\['Notes'/.test(DEVIS),
  'une case vide ne pose pas de ligne au dossier');
assert.ok(/if\(val\('projectNotes'\)\.trim\(\)\)control\.push\(tl\('Notes'/.test(DEVIS),
  '… ni sur le ticket');

// ---------------------------------------------------------------------------
// 3. LE PARCOURS COMPTE UNE ÉTAPE DE MOINS
// ---------------------------------------------------------------------------
const pastilles = [...DEVIS.matchAll(/class="step[^"]*"[^>]*data-step="(\d+)"[^>]*>\s*([^<]+?)\s*</g)]
  .map((m) => m[2]);
assert.deepStrictEqual(pastilles,
  ['1. Besoins', '2. Projet', '3. Client', 'Chiffrage', '4. Récapitulatif'],
  'quatre étapes numérotées, et le chiffrage qui reste à part');
// Le bouton de « Projet » saute par-dessus l'ancienne étape 4.
assert.ok(/onclick="goStep\(5\)">Choisir le client/.test(DEVIS),
  '« Projet » mène directement au client');

// ---------------------------------------------------------------------------
// 4. CE QUI RESTE VRAI DE L'ANCIEN ÉCRAN
// ---------------------------------------------------------------------------
// LA QUANTITÉ DE LA DEMANDE VIT DANS LE TITRE DE SA LIGNE (24/08). Dans un
// panneau de 320 px, une colonne réservée au « 3× » repoussait le nom, qui se
// repliait sur deux lignes. « 3× T-shirt … » s'écrit d'un seul tenant.
assert.ok(/class="need-titre"[^>]*><span class="need-qte">/.test(DEVIS),
  'le nombre et le nom sont la même ligne de titre');
assert.ok(/\.need-qte\{font-variant-numeric:tabular-nums/.test(DEVIS),
  '… le nombre en chiffres à chasse fixe, et plus aucune bulle autour');
assert.ok(!/\.need-qte\{[^}]*background/.test(DEVIS),
  '… le fond gris de pastille ne revient pas');
assert.ok(!/--need-qte/.test(CHARTE) && !/var\(--need-qte\)/.test(DEVIS),
  'le rail de la quantité n’existe plus — ni le jeton, ni personne pour le lire');

console.log('✓ l’étape « Contrôle » a disparu, ses trois questions utiles sont dans « Projet »');
