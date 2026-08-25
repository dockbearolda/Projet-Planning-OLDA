'use strict';

// L'ÉTAPE « CONTRÔLE » SE LIT EN DEUX COLONNES (24/08/2026)
//
// « État des informations » et « Reprise de vectorisation » prenaient chacun
// une ligne entière pour une liste de trois mots, entre deux rangées qui en
// portaient deux : l'œil descendait en zigzag. Deux champs par ligne partout,
// et des paires qui disent quelque chose : l'état des informations avec le
// chemin par lequel elles arrivent, le logo avec son statut, la vectorisation
// avec la maquette, ce qu'on a reçu avec ce qu'il reste à contrôler.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DEVIS = fs.readFileSync(path.join(__dirname, '..', 'public/comptoir/demande-devis.html'), 'utf8');
const CHARTE = fs.readFileSync(path.join(__dirname, '..', 'public/charte.css'), 'utf8');

const step4 = DEVIS.match(/<section id="step4"[\s\S]*?<\/section>/)[0];

// Les quatre rangées, chacune une .grid de deux champs, dans l'ordre du tri.
[['controlStatus', 'informationReceivedVia'],
 ['clientLogoStatus', 'logoReceptionStatus'],
 ['vectorizationStatus', 'oldaMockupStatus'],
 ['receivedElements', 'missingNotes']].forEach(([g, d]) => {
  const re = new RegExp(
    `<div class="grid">\\s*<div class="field"[^>]*>[\\s\\S]*?id="${g}"[\\s\\S]*?<div class="field"[^>]*>[\\s\\S]*?id="${d}"[\\s\\S]*?<\\/div>\\s*<\\/div>`);
  assert.ok(re.test(step4), `« ${g} » et « ${d} » partagent une rangée de deux`);
});

assert.ok(/<div class="bloc"><div class="grid">/.test(step4),
  'le bloc des listes ouvre directement sur une rangée de deux');

// « Informations transmises par » garde son identité : c'est lui qui disparaît
// quand on est en attente, et sa moitié de rangée reste vide — l'état ne se
// déplace pas sous les yeux.
assert.ok(/<div class="field" id="receivedViaField">/.test(step4),
  'le champ « transmises par » porte toujours l’identifiant que le code cache');
assert.ok(/\$\('receivedViaField'\)\.classList\.toggle\('hidden',status==='waiting'\)/.test(DEVIS),
  '… et il se cache toujours quand les informations sont en attente');

// LA QUANTITÉ DE LA DEMANDE A REJOINT LE TITRE DE SA LIGNE (2e passe du
// 24/08). D'abord la bulle grise est partie — le sosie d'une liste
// déroulante —, puis le rail entier : dans un panneau de 320 px, une colonne
// réservée au « 3× » repoussait le nom, qui se repliait sur deux lignes.
// « 3× T-shirt … » s'écrit d'un seul tenant, comme on l'annonce.
assert.ok(/<div class="need-titre"><span class="need-qte">/.test(DEVIS),
  'le nombre et le nom sont la même ligne de titre');
assert.ok(/\.need-qte\{font-variant-numeric:tabular-nums/.test(DEVIS),
  '… le nombre en chiffres à chasse fixe, et plus aucune bulle autour');
assert.ok(!/\.need-qte\{[^}]*background/.test(DEVIS),
  '… le fond gris de pastille ne revient pas');
assert.ok(!/--need-qte/.test(CHARTE) && !/var\(--need-qte\)/.test(DEVIS),
  'le rail de la quantité n’existe plus — ni le jeton, ni personne pour le lire');

console.log('✓ contrôle en deux colonnes, et la quantité dans le titre de sa ligne');
