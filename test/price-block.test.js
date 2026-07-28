'use strict';

// Vérifie la règle de blocage prix à l'entrée dans la zone Devis envoyé → Archivé
// (glisser-déposer et flèche « étape suivante »). Comme test/next-flow-step.test.js,
// on extrait le VRAI bloc source de public/app.js (entre les deux bornes ci-dessous)
// plutôt que d'en recopier la logique : une régression dans app.js fait donc échouer
// ce test.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

// Bloc 1 : FAMILIES/SPECIAL/STAGES/STAGE_LABEL/SUB_STAGES/SUB_LABEL — nécessaires à
// inPriceZone (STAGE_ORDER) et priceBlockMessage (les libellés).
const HEADER_START = 'const FAMILIES = [';
const HEADER_END = 'const familyHasSub =';
const headerFrom = SRC.indexOf(HEADER_START);
const headerTo = SRC.indexOf(HEADER_END);
assert.ok(headerFrom >= 0 && headerTo > headerFrom, 'bloc FAMILIES/STAGE_LABEL/SUB_LABEL introuvable dans public/app.js');

// Bloc 2 : STAGE_ORDER, construit plus loin dans le fichier à partir de STAGES.
const ORDER_LINE = 'const STAGE_ORDER = Object.fromEntries(STAGES.map((s, i) => [s.slug, i]));';
assert.ok(SRC.includes(ORDER_LINE), 'ligne STAGE_ORDER introuvable dans public/app.js');

// Bloc 3 : la règle de blocage prix elle-même.
const START = '// --- Blocage prix : zone « Devis à envoyer » → Archivé (glisser-déposer + étape';
const END = '// Une entrée du rail accepte-t-elle';
const from = SRC.indexOf(START);
const to = SRC.indexOf(END);
assert.ok(from >= 0 && to > from, 'bloc blocage-prix introuvable dans public/app.js');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${SRC.slice(headerFrom, headerTo)}
${ORDER_LINE}
${SRC.slice(from, to)}
globalThis.hasPrice = hasPrice;
globalThis.inPriceZone = inPriceZone;
globalThis.blockedByPrice = blockedByPrice;
globalThis.priceBlockMessage = priceBlockMessage;`, sandbox);
const { hasPrice, blockedByPrice, priceBlockMessage } = sandbox;

// 1. hasPrice : seule l'absence de prix (null/undefined) compte comme « sans prix ».
assert.strictEqual(hasPrice({ project_value: null }), false, 'prix absent (null)');
assert.strictEqual(hasPrice({ project_value: undefined }), false, 'prix absent (undefined)');
assert.strictEqual(hasPrice({ project_value: 0 }), true, 'prix à 0€ est valide');
assert.strictEqual(hasPrice({ project_value: 45.5 }), true, 'prix positif valide');

// 2. Sans prix, entrer dans la sous-étape « Devis envoyé » depuis Chiffrage en
//    cours est bloqué : c'est le premier point d'entrée de la zone.
assert.strictEqual(
  blockedByPrice({ stage: 'demande_chiffrage', sub_stage: 'chiffrage_en_cours', project_value: null }, 'demande_chiffrage', 'devis_envoye'),
  true,
  'sans prix, envoyer le devis est bloqué',
);

// 3. Les sous-étapes de chiffrage AVANT l'envoi du devis ne demandent pas de prix.
assert.strictEqual(
  blockedByPrice({ stage: 'demande_chiffrage', sub_stage: 'a_chiffrer', project_value: null }, 'demande_chiffrage', 'chiffrage_en_cours'),
  false,
  'avancer vers Chiffrage en cours ne demande pas de prix',
);

// 4. Sans prix, entrer dans n'importe quelle famille après Demande & chiffrage
//    est bloqué (Préparation, Production, Facturation, Paiement & clôture).
for (const targetStage of ['preparation', 'production', 'facturation', 'paiement']) {
  assert.strictEqual(
    blockedByPrice({ stage: 'demande_chiffrage', sub_stage: 'demande_recue', project_value: null }, targetStage, null),
    true,
    `sans prix, entrer en ${targetStage} depuis Demande reçue est bloqué`,
  );
}

// 5. Avec un prix (même 0€), l'entrée n'est jamais bloquée.
assert.strictEqual(
  blockedByPrice({ stage: 'production', project_value: 0 }, 'facturation', null),
  false,
  'un prix à 0€ ne bloque pas',
);
assert.strictEqual(
  blockedByPrice({ stage: 'production', project_value: 120 }, 'facturation', null),
  false,
  'un prix positif ne bloque pas',
);

// 6. Déjà dans la zone (même sans prix) : les mouvements internes (réordonnancement,
//    bascule entre sous-étapes ou familles à l'intérieur de la zone) ne sont jamais
//    bloqués.
assert.strictEqual(
  blockedByPrice({ stage: 'facturation', project_value: null }, 'facturation', null),
  false,
  'un mouvement interne à facturation n’est jamais bloqué',
);
assert.strictEqual(
  blockedByPrice({ stage: 'production', project_value: null }, 'facturation', null),
  false,
  'avancer de Production vers Facturation, déjà dans la zone, n’est jamais bloqué',
);
assert.strictEqual(
  blockedByPrice({ stage: 'facturation', project_value: null }, 'demande_chiffrage', 'devis_envoye'),
  false,
  'revenir en arrière dans la zone (jusqu’à Devis envoyé) n’est jamais bloqué',
);

// 7. Cible avant la zone (les 4 premières sous-étapes de Demande & chiffrage) :
//    jamais bloqué par le prix, y compris en reculant depuis la zone.
assert.strictEqual(
  blockedByPrice({ stage: 'facturation', project_value: null }, 'demande_chiffrage', 'chiffrage_en_cours'),
  false,
  'sortir de la zone vers l’arrière n’est jamais bloqué par le prix',
);
assert.strictEqual(
  blockedByPrice({ stage: 'demande_chiffrage', sub_stage: 'demande_recue', project_value: null }, 'demande_chiffrage', 'demande_a_qualifier'),
  false,
  'rester avant la zone n’est jamais bloqué par le prix',
);

// 8. Le message est généré dynamiquement à partir de la cible (réutilisé par la
//    bulle et le toast).
assert.strictEqual(priceBlockMessage('demande_chiffrage', 'devis_envoye'), 'Sans prix, impossible de passer en Tarif / Devis envoyé – Attente client.');
assert.strictEqual(priceBlockMessage('facturation', null), 'Sans prix, impossible de passer en Facturation & remise au client.');

console.log('✓ price-block : hasPrice/blockedByPrice couvrent la zone Devis envoyé → Archivé, prix null/0/positif et entrée vs mouvement interne');
