'use strict';

// LES ÉTAPES DE LA PRISE DE COMMANDE — RETIRÉES LE 29/08/2026
//
// Ce fichier tenait, depuis le 26/08, une demande de Charlie : « lorsque je
// clique sur le dossier, je dois retrouver toutes les étapes de ma prise de
// commande ». Le détail archivé du comptoir s'affichait alors regroupé par
// étape, avec le fil du comptoir lui-même (`.stepper` / `.step` de charte.css).
//
// CE FIL VIVAIT DANS LE TIROIR. Le tiroir a cessé d'être ouvert le 28/08, quand
// la fiche atelier a pris sa place : plus rien n'appelait `openLigneDrawer`, et
// personne ne s'en est aperçu — l'écran continuait de s'ouvrir, simplement sans
// ces étapes-là. Le 29/08 le tiroir a été retiré pour de bon (il coûtait 35 Ko
// de CSS et 1 500 lignes de JavaScript à chaque poste, pour du code mort).
//
// LE FIL N'EST DONC PLUS NULLE PART, et ce fichier existe pour que ça ne se
// perde pas dans un journal de commits. Quatre choses du tiroir n'ont pas été
// reprises par la fiche atelier :
//
//   1. LE FIL DES ÉTAPES du comptoir, avec le détail archivé regroupé par étape.
//   2. L'HISTORIQUE DU CLIENT — ses autres dossiers, vus depuis celui-ci.
//   3. LES PIÈCES JOINTES (les versions de BAT).
//   4. LE JOURNAL de la commande — qui a changé quoi, et quand.
//
// Elles sont à rebâtir dans la fiche atelier si elles doivent revenir ; le code
// d'origine se retrouve dans l'historique git, avant ce commit.
//
// Ce qui reste vérifiable aujourd'hui, et qui est vérifié ici : le composant du
// comptoir est intact dans la charte (c'est l'écran du comptoir qui le porte),
// et plus une seule règle orpheline ne traîne dans le CRM.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RACINE, 'public/app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(RACINE, 'public/styles.css'), 'utf8');
const CHARTE = fs.readFileSync(path.join(RACINE, 'public/charte.css'), 'utf8');

// LE FIL RESTE DANS LA CHARTE : les deux parcours du comptoir le portent, et
// c'est de là qu'il faudra le reprendre le jour où la fiche le redemande.
assert.match(CHARTE, /\n\.stepper \{/, 'le fil reste dans la charte, pour le comptoir');
assert.match(CHARTE, /\n\.step \{/);

// ET PLUS RIEN DU TIROIR NE TRAÎNE. Une règle orpheline se sert à chaque poste
// sans jamais rencontrer un élément : c'est du poids pur.
assert.ok(!/ld-fil|ld-etape|LD_ETAPES|LD_ETAPE_CLIENT|ldEtapesDuRecap/.test(APP),
  'plus une trace du fil des étapes dans app.js');
assert.ok(!/\.ld-/.test(CSS.replace(/\/\*[\s\S]*?\*\//g, '')),
  'plus une règle du tiroir dans styles.css');

console.log('✓ étapes de la prise de commande : RETIRÉES avec le tiroir — le fil reste dans la charte');
