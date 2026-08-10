'use strict';

// Vérifie les règles pures du glisser d'un document vers WhatsApp
// (public/documents.js) : le nom sous lequel le client reçoit le fichier, et la
// charge utile « DownloadURL » que Chrome attend pour sortir le PDF de la page.
//
// Ce qui se joue ici est invisible à l'écran : une charge utile mal formée ne
// lève AUCUNE erreur — `setData` l'accepte, le glisser part, et rien n'arrive
// jamais dans la conversation. D'où des cas de bord plutôt qu'un cas nominal.

// Comme whatsapp.test.js : on n'exécute pas une copie, on charge le vrai source
// (module ES du navigateur), on retire les `export` et on l'évalue dans un vm.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'documents.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    `${SRC.replace(/^export\s+/gm, '')}
     globalThis.nomDocument = nomDocument;
     globalThis.chargeGlisser = chargeGlisser;`,
    sandbox,
  );
  const { nomDocument, chargeGlisser } = sandbox;

  // --- Le nom reçu par le client --------------------------------------------
  assert.strictEqual(nomDocument('devis', 'MARTIN Jean'), 'Devis - MARTIN Jean.pdf');
  assert.strictEqual(nomDocument('facture', 'Boulangerie du Port'), 'Facture - Boulangerie du Port.pdf');
  assert.strictEqual(nomDocument('bat', 'MARTIN Jean'), 'BAT - MARTIN Jean.pdf');

  // Sans client lisible, le libellé seul : pas de tiret orphelin sous les yeux
  // du client (« Devis - .pdf »).
  assert.strictEqual(nomDocument('devis', null), 'Devis.pdf');
  assert.strictEqual(nomDocument('devis', ''), 'Devis.pdf');
  assert.strictEqual(nomDocument('devis', '   '), 'Devis.pdf');

  // Un type inconnu ne doit pas produire « undefined - Client.pdf ».
  assert.strictEqual(nomDocument('inconnu', 'MARTIN Jean'), 'Document - MARTIN Jean.pdf');

  // Le trait d'union et l'apostrophe sont LÉGITIMES dans un nom : les avaler
  // renverrait « Jean Pierre » et « L Atelier » au client.
  assert.strictEqual(nomDocument('devis', 'Jean-Pierre DUPONT'), 'Devis - Jean-Pierre DUPONT.pdf');
  assert.strictEqual(nomDocument('devis', "L'Atelier"), "Devis - L'Atelier.pdf");

  // Les caractères que Windows refuse deviennent des espaces — et surtout PAS
  // rien : « Dupont/Martin » se lit « Dupont Martin », pas « DupontMartin ».
  assert.strictEqual(nomDocument('devis', 'Dupont/Martin'), 'Devis - Dupont Martin.pdf');
  assert.strictEqual(nomDocument('devis', 'SARL "Le Phare"'), 'Devis - SARL Le Phare.pdf');
  assert.strictEqual(nomDocument('devis', 'A\\B|C?D*E<F>G'), 'Devis - A B C D E F G.pdf');

  // Un « : » dans le nom du client découperait la charge utile en plein milieu :
  // le fichier partirait sous un nom tronqué, sans erreur nulle part.
  assert.strictEqual(nomDocument('devis', 'Client: urgent'), 'Devis - Client urgent.pdf');
  assert.ok(!nomDocument('devis', 'Client: urgent').includes(':'));

  // Retour à la ligne et tabulation collés dans la fiche depuis un autre outil.
  assert.strictEqual(nomDocument('devis', 'MARTIN\nJean'), 'Devis - MARTIN Jean.pdf');
  assert.strictEqual(nomDocument('devis', '  MARTIN\t Jean  '), 'Devis - MARTIN Jean.pdf');

  // Nom à rallonge : borné, sinon Windows et Android tronquent eux-mêmes.
  const long = nomDocument('facture', 'X'.repeat(400));
  assert.ok(long.length <= 120, `nom trop long : ${long.length}`);
  assert.ok(long.endsWith('.pdf'));
  assert.ok(long.startsWith('Facture - X'));

  // --- La charge utile du glisser -------------------------------------------
  const URL_OK = 'https://planning.example/api/requests/abc-123/pdf/devis';
  assert.strictEqual(
    chargeGlisser('Devis - MARTIN Jean.pdf', URL_OK),
    `application/pdf:Devis - MARTIN Jean.pdf:${URL_OK}`,
  );

  // Le découpage se fait sur les DEUX premiers « : » : l'adresse garde le sien
  // (https://) intact, sinon Chrome téléchargerait une adresse tronquée.
  const charge = chargeGlisser('Devis.pdf', URL_OK);
  const [type, nom, ...reste] = charge.split(':');
  assert.strictEqual(type, 'application/pdf');
  assert.strictEqual(nom, 'Devis.pdf');
  assert.strictEqual(reste.join(':'), URL_OK);

  // Adresse relative : `setData` l'accepterait sans broncher et RIEN n'arriverait
  // dans la conversation. On refuse en amont pour laisser le glisser par défaut.
  assert.strictEqual(chargeGlisser('Devis.pdf', '/api/requests/abc-123/pdf/devis'), null);
  assert.strictEqual(chargeGlisser('Devis.pdf', ''), null);
  assert.strictEqual(chargeGlisser('Devis.pdf', null), null);
  assert.strictEqual(chargeGlisser('Devis.pdf', undefined), null);

  // Nom vide : un fichier sans nom n'arrive pas non plus.
  assert.strictEqual(chargeGlisser('', URL_OK), null);
  assert.strictEqual(chargeGlisser('   ', URL_OK), null);
  assert.strictEqual(chargeGlisser(null, URL_OK), null);

  // http local (le poste de l'atelier en direct sur le serveur) doit passer.
  assert.ok(chargeGlisser('Devis.pdf', 'http://192.168.1.20:3000/api/requests/1/pdf/devis'));

  // Ceinture : même si l'appelant passe un nom non nettoyé, la charge utile ne
  // doit jamais porter un « : » de plus que les deux séparateurs.
  const sale = chargeGlisser('Devis: MARTIN.pdf', URL_OK);
  assert.strictEqual(sale.split(':').length, 2 + URL_OK.split(':').length);

  console.log('glisser-documents.test.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
