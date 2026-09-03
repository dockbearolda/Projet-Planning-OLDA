'use strict';

// ===========================================================================
// L'ÉCRAN VENTE FLASH (03/09/2026)
// ===========================================================================
// Assertions statiques sur le SOURCE, comme test/devis-flash.test.js pour
// l'écran devis (ECRAN) : ce fichier pilote trop de DOM et de réseau pour
// être évalué dans un bac à sable vm, on vérifie donc sa forme.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const ECRAN = lire('public/vente-flash.js');

// --- Aucun piège d'accent grave dans un template literal du fichier --------
// (vente-flash.js n'a pas de gabarit de papier à lui — CSS_FACTURE vit dans
// facture.js, déjà couvert par test/facture.test.js — mais un accent grave
// resté dans un template literal copié depuis devis-flash.js romprait quand
// même la construction de chaîne : vérification de sûreté.)
assert.ok(!/`[^`]*` \+ CSS_FACTURE/.test(ECRAN) || !ECRAN.includes(String.fromCharCode(96) + String.fromCharCode(96)),
  'pas de gabarit corrompu dans vente-flash.js');

// --- Les exports attendus existent, ceux du devis flash ont disparu --------
assert.ok(/export\s+async\s+function\s+initVenteFlash/.test(ECRAN), 'initVenteFlash doit être exporté');
assert.ok(/export\s+async\s+function\s+refreshVenteFlash/.test(ECRAN), 'refreshVenteFlash doit être exporté');
assert.ok(!/export\s+.*reprendreDevis/.test(ECRAN), 'pas de reprise/version : une facture émise est immuable');
assert.ok(!ECRAN.includes('initDevisFlash') && !ECRAN.includes('refreshDevisFlash'),
  'les noms d’export du devis flash ne doivent pas traîner dans la copie');

// --- Le papier importé est la facture, pas le devis -------------------------
assert.ok(/from\s+'\.\/facture\.js'/.test(ECRAN), 'vente-flash.js doit importer facture.js');
assert.ok(!/modeleDevis|dessinerDevis|CSS_DEVIS/.test(ECRAN),
  'aucune trace du papier devis ne doit rester dans l’écran de vente');

// --- Pas d'acompte, un mode de règlement obligatoire ------------------------
assert.ok(!/saisie\.acompte/.test(ECRAN), 'pas de concept d’acompte sur une facture');
assert.ok(/saisie\.mode/.test(ECRAN), 'le mode de règlement doit être un champ de la saisie');
assert.ok(/MODES_PAIEMENT/.test(ECRAN), 'le menu du mode de règlement doit venir de MODES_PAIEMENT (facture.js)');

// --- Le bouton d'émission est bloqué sans mode de règlement -----------------
assert.ok(/!saisie\.mode/.test(ECRAN),
  'le bouton "Émettre la facture" doit être désactivé tant qu’aucun mode de règlement n’est choisi');
assert.ok(/l\.sansPrix/.test(ECRAN),
  'le bouton doit rester désactivé tant qu’une ligne n’a pas de prix — contrairement au devis');

// --- Les cinq identifiants DOM globaux ne collisionnent pas avec le devis --
for (const idGlobal of ['fa-style', 'vf-produits', 'vf-marquages', 'vf-encres', 'vf-faces', 'vf-msg']) {
  assert.ok(ECRAN.includes(idGlobal), `l’identifiant ${idGlobal} doit exister — voir Task 6 Step 3 du plan`);
}
for (const idDevis of ["'dv-style'", "'dvf-produits'", "'dvf-marquages'", "'dvf-encres'", "'dvf-faces'", "'dvf-msg'"]) {
  assert.ok(!ECRAN.includes(idDevis),
    `${idDevis} (identifiant global du devis flash) ne doit pas réapparaître dans vente-flash.js — collision de DOM possible`);
}

// --- L'émission enchaîne bien les deux appels réseau, dans l'ordre ---------
const idxProjet = ECRAN.indexOf("api('POST', '/api/comptoir/projet'");
const idxFacture = ECRAN.indexOf("api('POST', '/api/factures'");
assert.ok(idxProjet > -1 && idxFacture > -1, 'les deux appels doivent exister');
assert.ok(idxProjet < idxFacture, '/api/comptoir/projet doit être appelé AVANT /api/factures — le dossier doit exister avant la facture');

// --- Le panier d'UN SEUL article envoie name/quantity à la racine ----------
// (voir server.js, POST /api/comptoir/projet : sur un seul article, il lit
// produit/quantité dans CES CHAMPS RACINE, pas dans articles[0] — un piège
// déjà tombé une fois en écrivant ce plan, voir la task correspondante).
assert.ok(/name:\s*articles\.length\s*===\s*1/.test(ECRAN),
  'le payload doit poser `name` à la racine pour le cas d’un seul article');
assert.ok(/quantity:\s*articles\.length\s*===\s*1/.test(ECRAN),
  'le payload doit poser `quantity` à la racine pour le cas d’un seul article');

console.log('✓ vente-flash : exports, papier, mode de règlement obligatoire, ids sans collision, ordre des appels, panier à un article');
