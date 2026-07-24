'use strict';

// Vérifie les règles pures de la pastille WhatsApp (public/whatsapp.js) :
// mise au format international du numéro — l'atelier est à Saint-Martin, on y
// croise autant de 0690 que de 06 métropole — remplissage du message du patron,
// et adresse wa.me finale.

// Comme priority.test.js : on n'exécute pas une copie, on charge le vrai source
// (module ES du navigateur), on retire les `export` et on l'évalue dans un vm.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'whatsapp.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    `${SRC.replace(/^export\s+/gm, '')}
     globalThis.whatsappNumber = whatsappNumber;
     globalThis.fillMessage = fillMessage;
     globalThis.whatsappLink = whatsappLink;
     globalThis.groupDigits = groupDigits;`,
    sandbox,
  );
  const { whatsappNumber, fillMessage, whatsappLink, groupDigits } = sandbox;

  // --- Numéro ---------------------------------------------------------------
  // Antilles / Saint-Martin : 0690 et 0691 → +590.
  assert.strictEqual(whatsappNumber('06 90 66 24 00'), '590690662400');
  assert.strictEqual(whatsappNumber('06 91 23 45 67'), '590691234567');
  // Les autres DOM gardent leur indicatif propre.
  assert.strictEqual(whatsappNumber('0696 12 34 56'), '596696123456');
  assert.strictEqual(whatsappNumber('0694 12 34 56'), '594694123456');
  assert.strictEqual(whatsappNumber('0692 12 34 56'), '262692123456');
  // Métropole : tout le reste des 06 / 07 → +33.
  assert.strictEqual(whatsappNumber('06 42 26 69 49'), '33642266949');
  assert.strictEqual(whatsappNumber('07 86 05 39 34'), '33786053934');
  // Déjà international : on ne retouche pas ce qui a été saisi.
  assert.strictEqual(whatsappNumber('+590 690 66 24 00'), '590690662400');
  assert.strictEqual(whatsappNumber('00590690662400'), '590690662400');
  assert.strictEqual(whatsappNumber('590690662400'), '590690662400');
  // Illisible ou absent → pas de pastille du tout.
  for (const vide of [null, undefined, '', '   ', 'à rappeler', '0690', '12345']) {
    assert.strictEqual(whatsappNumber(vide), null, `numéro illisible : ${JSON.stringify(vide)}`);
  }

  // --- Message --------------------------------------------------------------
  const modele = 'Bonjour {client}, votre commande « {commande} » est prête pour le {date}. — OLDA';
  assert.strictEqual(
    fillMessage(modele, { client: 'Hôtel Esmeralda', commande: '50 t-shirts', date: '29/07/2026' }),
    'Bonjour Hôtel Esmeralda, votre commande « 50 t-shirts » est prête pour le 29/07/2026. — OLDA',
  );
  // Un jeton sans valeur laisse un blanc refermé, jamais un « null » en clair.
  assert.strictEqual(
    fillMessage('Bonjour {client}, {commande} est prête.', { commande: '50 t-shirts' }),
    'Bonjour , 50 t-shirts est prête.',
  );
  assert.ok(!fillMessage('{client} {commande} {date}', {}).includes('undefined'));
  assert.strictEqual(fillMessage(null, {}), '', 'message absent → texte vide');
  // Un jeton répété est remplacé partout.
  assert.strictEqual(fillMessage('{client} / {client}', { client: 'OLDA' }), 'OLDA / OLDA');

  // --- Adresse wa.me --------------------------------------------------------
  const lien = whatsappLink('06 90 66 24 00', 'Bonjour {client} !', { client: 'Iguana' });
  assert.strictEqual(lien, `https://wa.me/590690662400?text=${encodeURIComponent('Bonjour Iguana !')}`);
  // Message vidé par le patron : on ouvre la conversation, sans texte.
  assert.strictEqual(whatsappLink('06 90 66 24 00', '', {}), 'https://wa.me/590690662400');
  // Pas de numéro lisible → pas de lien (donc pas de pastille).
  assert.strictEqual(whatsappLink('', 'Bonjour', {}), null);
  assert.strictEqual(whatsappLink('à rappeler', 'Bonjour', {}), null);

  // --- Groupement à la frappe -------------------------------------------------
  assert.strictEqual(groupDigits('0690662400'), '06 90 66 24 00');
  assert.strictEqual(groupDigits('06 90 66 24 00'), '06 90 66 24 00', 'idempotent une fois déjà groupé');
  assert.strictEqual(groupDigits('069'), '06 9', 'chiffre impair en fin : pas d\'espace en trop');
  assert.strictEqual(groupDigits('+590690662400'), '+59 06 90 66 24 00');
  assert.strictEqual(groupDigits(''), '');
  assert.strictEqual(groupDigits(null), '');

  console.log('✓ whatsapp : indicatifs Antilles/métropole, jetons du message et adresse wa.me OK');
})().catch((err) => { console.error(err); process.exit(1); });
