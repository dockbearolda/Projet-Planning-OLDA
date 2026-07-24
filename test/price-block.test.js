'use strict';

// Vérifie la règle de blocage prix à l'entrée en Facturation (glisser-déposer et
// flèche « étape suivante »). Comme test/next-flow-step.test.js, on extrait le VRAI
// bloc source de public/app.js (entre les deux bornes ci-dessous) plutôt que d'en
// recopier la logique : une régression dans app.js fait donc échouer ce test.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const START = '// --- Blocage prix : entrée en Facturation (glisser-déposer + étape suivante) ------';
const END = '// Une entrée du rail accepte-t-elle';
const from = SRC.indexOf(START);
const to = SRC.indexOf(END);
assert.ok(from >= 0 && to > from, 'bloc blocage-prix introuvable dans public/app.js');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${SRC.slice(from, to)}
globalThis.hasPrice = hasPrice;
globalThis.blockedByPrice = blockedByPrice;
globalThis.PRICE_BLOCK_MESSAGE = PRICE_BLOCK_MESSAGE;`, sandbox);
const { hasPrice, blockedByPrice, PRICE_BLOCK_MESSAGE } = sandbox;

// 1. hasPrice : seule l'absence de prix (null/undefined) compte comme « sans prix ».
assert.strictEqual(hasPrice({ project_value: null }), false, 'prix absent (null)');
assert.strictEqual(hasPrice({ project_value: undefined }), false, 'prix absent (undefined)');
assert.strictEqual(hasPrice({ project_value: 0 }), true, 'prix à 0€ est valide');
assert.strictEqual(hasPrice({ project_value: 45.5 }), true, 'prix positif valide');

// 2. Sans prix, entrer en facturation depuis une autre famille est bloqué.
assert.strictEqual(
  blockedByPrice({ stage: 'production', project_value: null }, 'facturation'),
  true,
  'sans prix, entrer en facturation depuis une autre famille est bloqué',
);

// 3. Avec un prix (même 0€), l'entrée n'est jamais bloquée.
assert.strictEqual(
  blockedByPrice({ stage: 'production', project_value: 0 }, 'facturation'),
  false,
  'un prix à 0€ ne bloque pas',
);
assert.strictEqual(
  blockedByPrice({ stage: 'production', project_value: 120 }, 'facturation'),
  false,
  'un prix positif ne bloque pas',
);

// 4. Déjà dans facturation (même sans prix) : les mouvements internes à la famille
//    (réordonnancement, bascule entre sous-étapes) ne sont jamais bloqués.
assert.strictEqual(
  blockedByPrice({ stage: 'facturation', project_value: null }, 'facturation'),
  false,
  'un mouvement interne à facturation n’est jamais bloqué',
);

// 5. Cible autre que facturation : jamais bloqué par le prix.
assert.strictEqual(
  blockedByPrice({ stage: 'demande', project_value: null }, 'production'),
  false,
  'entrer ailleurs qu’en facturation n’est jamais bloqué par le prix',
);

// 6. Le message est exposé (réutilisé par la bulle et le toast).
assert.strictEqual(typeof PRICE_BLOCK_MESSAGE, 'string');
assert.ok(PRICE_BLOCK_MESSAGE.length > 0);

console.log('✓ price-block : hasPrice/blockedByPrice couvrent prix null/0/positif et entrée vs mouvement interne');
