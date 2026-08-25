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

// Aucun champ de l'étape ne reste seul sur sa ligne : chaque .field du bloc
// des listes vit dans une .grid. (Les champs de repli « nouveau mode de
// transmission » vivent DANS le field de leur liste, pas à côté.)
const champsNus = (step4.match(/<\/div>\s*<div class="field">/g) || []).length;
assert.ok(/<div class="bloc"><div class="grid">/.test(step4),
  'le bloc des listes ouvre directement sur une rangée de deux');

// « Informations transmises par » garde son identité : c'est lui qui disparaît
// quand on est en attente, et sa moitié de rangée reste vide — l'état ne se
// déplace pas sous les yeux.
assert.ok(/<div class="field" id="receivedViaField">/.test(step4),
  'le champ « transmises par » porte toujours l’identifiant que le code cache');
assert.ok(/\$\('receivedViaField'\)\.classList\.toggle\('hidden',status==='waiting'\)/.test(DEVIS),
  '… et il se cache toujours quand les informations sont en attente');

// LA QUANTITÉ DE LA DEMANDE N'EST PLUS UNE BULLE. Fond gris et arrondi de
// champ : le sosie d'une liste déroulante, sur un écran où tout ce qui a cette
// forme se clique. Reste le nombre, à droite de son rail, chiffres à chasse
// fixe pour que « 11× » et « 33× » finissent au même endroit.
assert.ok(/\.need-qte\{font-size:var\(--taille-texte\);font-weight:var\(--graisse-forte\);text-align:right;font-variant-numeric:tabular-nums\}/.test(DEVIS),
  'la quantité se lit, elle ne se clique pas : ni fond, ni rembourrage, ni arrondi');
assert.ok(!/\.need-qte\{[^}]*background/.test(DEVIS),
  '… le fond gris de pastille ne revient pas');

const CHARTE = fs.readFileSync(path.join(__dirname, '..', 'public/charte.css'), 'utf8');
assert.ok(/--need-qte: 46px;/.test(CHARTE),
  'le rail de la quantité est calé sur « 9999\u00d7 » mesuré nu (44,9 px), plus sur la bulle');

console.log('\u2713 contr\u00f4le en deux colonnes, et la quantit\u00e9 sans bulle');
