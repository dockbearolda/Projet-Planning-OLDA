'use strict';

// LA FEUILLE DU CRM EST DEVENUE PLUSIEURS FICHIERS (29/08/2026)
//
// `styles.css` partait en entier a l'ouverture de tous les postes — 57 Ko pour
// six ecrans dont le JavaScript, lui, attendait deja le premier passage. Chaque
// ecran a maintenant sa feuille, chargee avec lui (voir `poserFeuille` dans
// app.js) : dashboard.css, reglages.css, tailles-logos.css, montravail.css,
// pilotage.css — comme clients.css et projet.css le faisaient depuis longtemps.
//
// LES GARDES, ELLES, PORTENT SUR LE CRM ENTIER. Une regle qui a change de
// fichier n'a pas change de nature : un test qui ne lit que `styles.css`
// deviendrait aveugle a la moitie de l'application sans qu'aucune assertion ne
// tombe — c'est exactement l'accident du 25/08, ou la garde de l'echelle ne
// lisait que `styles.css` pendant que `clients.css` accumulait onze ecarts.
//
// On lit donc TOUT, ici, en un seul endroit.

const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');

// Les feuilles que le CRM charge — la coquille d'abord, puis celles qui
// arrivent avec leur ecran, dans l'ordre ou elles peuvent se poser.
const FEUILLES_CRM = [
  'public/styles.css',
  'public/dashboard.css',
  'public/reglages.css',
  'public/tailles-logos.css',
  'public/montravail.css',
  'public/pilotage.css',
  'public/devis-flash.css',
];

const lireFeuille = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');

// Tout le CSS du CRM, bout a bout. C'est ce que voit un poste qui a ouvert tous
// ses ecrans — donc ce sur quoi une garde doit porter.
const cssCrm = () => FEUILLES_CRM.map(lireFeuille).join('\n');

module.exports = { FEUILLES_CRM, lireFeuille, cssCrm };
