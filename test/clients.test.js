'use strict';

// Base clients professionnelle (CRM) intégrée au planning. On vérifie le cycle
// complet sur le vrai serveur : la base arrive pré-remplie (seed), la fiche est
// éditable en place, la timeline de notes fonctionne, et la prise de commande
// crée automatiquement le client absent sans jamais dédoublonner un connu.

const assert = require('node:assert');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

(async () => {
  process.env.PORT = '0';
  const app = require('../server');
  const base = await new Promise((resolve) => {
    const check = () => {
      const s = app && app.__server;
      if (s && s.listening) resolve(`http://127.0.0.1:${s.address().port}`);
      else setTimeout(check, 25);
    };
    check();
  });

  const j = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  // 1. La base arrive PRÉ-REMPLIE : le seed des clients pros a été importé.
  const seeded = await j('GET', '/api/clients');
  assert.strictEqual(seeded.status, 200);
  assert.ok(Array.isArray(seeded.body), 'liste attendue');
  assert.ok(seeded.body.length >= 80, `base pré-remplie attendue, reçu ${seeded.body.length}`);
  const villas = seeded.body.find((c) => /100% Villas/.test(c.entreprise));
  assert.ok(villas, '100% Villas doit être dans le seed');
  assert.strictEqual(villas.zone, 'Baie Nettle');
  assert.strictEqual(villas.type, 'Conciergerie');
  assert.ok('notes_count' in villas && 'commandes' in villas, 'champs enrichis attendus');
  // Les clients rapatriés de la base PRO sont marqués « pro » par la migration.
  assert.strictEqual(villas.client_type, 'pro', 'les clients seedés sont pro');
  // Trié par entreprise (fr) : chaque nom vient après le précédent.
  for (let i = 1; i < seeded.body.length; i += 1) {
    assert.ok(
      seeded.body[i - 1].entreprise.localeCompare(seeded.body[i].entreprise, 'fr') <= 0,
      'liste triée par société',
    );
  }

  // 2. Création : seule la société est obligatoire.
  const vide = await j('POST', '/api/clients', { nom: 'Sans société' });
  assert.strictEqual(vide.status, 400);
  assert.match(vide.body.error, /société est requis/i);

  const mailFaux = await j('POST', '/api/clients', { entreprise: 'X', email: 'pas-un-email' });
  assert.strictEqual(mailFaux.status, 400);
  assert.match(mailFaux.body.error, /email invalide/i);

  const cree = await j('POST', '/api/clients', {
    entreprise: 'Test Boutique', nom: 'Léa', fonction: 'Gérante',
    type: 'Boutique', zone: 'Marigot', telephone: '06 90 00 00 00', email: 'lea@test.fr',
  });
  assert.strictEqual(cree.status, 201, JSON.stringify(cree.body));
  const id = cree.body.id;
  assert.ok(id, 'un id est renvoyé');
  assert.strictEqual(cree.body.entreprise, 'Test Boutique');
  assert.strictEqual(cree.body.nom, 'Léa');
  assert.strictEqual(cree.body.client_type, 'pro', 'nature « pro » par défaut');

  // Nature pro/perso : création explicite en perso, puis bascule et rejet.
  const perso = await j('POST', '/api/clients', { entreprise: 'Marie Dupont', client_type: 'perso' });
  assert.strictEqual(perso.status, 201, JSON.stringify(perso.body));
  assert.strictEqual(perso.body.client_type, 'perso');

  const natBad = await j('PATCH', `/api/clients/${id}`, { client_type: 'zzz' });
  assert.strictEqual(natBad.status, 400);
  assert.match(natBad.body.error, /nature invalide/i);

  const natOk = await j('PATCH', `/api/clients/${id}`, { client_type: 'perso' });
  assert.strictEqual(natOk.status, 200);
  assert.strictEqual(natOk.body.client_type, 'perso', 'la nature bascule pro → perso');

  // 3. Édition en place : on change un champ, la fiche le reflète.
  const patch = await j('PATCH', `/api/clients/${id}`, { fonction: 'Directrice', zone: 'Grand Case' });
  assert.strictEqual(patch.status, 200);
  assert.strictEqual(patch.body.fonction, 'Directrice');
  assert.strictEqual(patch.body.zone, 'Grand Case');

  // L'entreprise ne peut pas être vidée : c'est l'identité du client.
  const videEnt = await j('PATCH', `/api/clients/${id}`, { entreprise: '   ' });
  assert.strictEqual(videEnt.status, 400);
  assert.match(videEnt.body.error, /société est requis/i);

  // 4. Notes & historique : ajout typé, puis lecture (récent en premier).
  const noteVide = await j('POST', `/api/clients/${id}/notes`, { kind: 'appel', body: '   ' });
  assert.strictEqual(noteVide.status, 400);

  const n1 = await j('POST', `/api/clients/${id}/notes`, { kind: 'appel', body: 'Rappeler lundi' });
  assert.strictEqual(n1.status, 201);
  assert.strictEqual(n1.body.kind, 'appel');
  const n2 = await j('POST', `/api/clients/${id}/notes`, { kind: 'bidon', body: 'Devis envoyé' });
  assert.strictEqual(n2.status, 201);
  assert.strictEqual(n2.body.kind, 'note', 'un kind inconnu retombe sur « note »');

  const fiche = await j('GET', `/api/clients/${id}`);
  assert.strictEqual(fiche.status, 200);
  assert.strictEqual(fiche.body.notes.length, 2);
  assert.strictEqual(fiche.body.notes[0].body, 'Devis envoyé', 'la note la plus récente en tête');

  const listAvecNotes = await j('GET', '/api/clients');
  const testEntry = listAvecNotes.body.find((c) => c.id === id);
  assert.strictEqual(testEntry.notes_count, 2, 'le compteur de notes suit la timeline');

  // Suppression d'une note.
  const delNote = await j('DELETE', `/api/clients/${id}/notes/${n1.body.id}`);
  assert.strictEqual(delNote.status, 204);
  const fiche2 = await j('GET', `/api/clients/${id}`);
  assert.strictEqual(fiche2.body.notes.length, 1);

  // 5. Création automatique à la prise de commande, sans doublon.
  const before = (await j('GET', '/api/clients')).body.length;
  const nouveauClient = 'Chez Testeur ' + Math.floor(seeded.body.length);
  const cmd = {
    kind: 'commande',
    client: { societe: nouveauClient, contact: 'Paul', telephone: '0690 12 34 56', type: 'pro' },
    articles: [{ vetement: 'T-shirt', quantite: 3, zones: [] }],
  };
  const c1 = await j('POST', '/api/commande', cmd);
  assert.strictEqual(c1.status, 201, JSON.stringify(c1.body));
  const after1 = await j('GET', '/api/clients');
  assert.strictEqual(after1.body.length, before + 1, 'un nouveau client créé');
  const auto = after1.body.find((c) => c.entreprise === nouveauClient);
  assert.ok(auto, 'le client de la commande est dans la base');
  assert.strictEqual(auto.nom, 'Paul');
  assert.strictEqual(auto.telephone, '0690 12 34 56');
  assert.strictEqual(auto.client_type, 'pro', 'la nature pro de la commande suit le client');
  assert.ok(auto.commandes >= 1, 'la commande est comptée');

  // Une 2e commande du MÊME client (casse différente) ne crée pas de doublon.
  await j('POST', '/api/commande', { ...cmd, client: { ...cmd.client, societe: nouveauClient.toUpperCase() } });
  const after2 = await j('GET', '/api/clients');
  assert.strictEqual(after2.body.length, before + 1, 'pas de doublon malgré la casse');
  const autoBis = after2.body.find((c) => c.entreprise === nouveauClient);
  assert.ok(autoBis.commandes >= 2, 'le compteur suit les commandes');

  // Une commande PERSO crée un client perso dans la base (la nature suit).
  const persoName = 'Particulier Testeur ' + Math.floor(seeded.body.length);
  const cmdPerso = await j('POST', '/api/commande', {
    kind: 'demande',
    client: { societe: persoName, contact: 'Sophie', type: 'perso' },
    articles: [{ vetement: 'Sweat', quantite: 1, zones: [] }],
  });
  assert.strictEqual(cmdPerso.status, 201, JSON.stringify(cmdPerso.body));
  const autoPerso = (await j('GET', '/api/clients')).body.find((c) => c.entreprise === persoName);
  assert.ok(autoPerso, 'le client perso est dans la base');
  assert.strictEqual(autoPerso.client_type, 'perso', 'la nature perso suit le client');

  // 6. Suppression du client (et de ses notes).
  const del = await j('DELETE', `/api/clients/${id}`);
  assert.strictEqual(del.status, 204);
  const gone = await j('GET', `/api/clients/${id}`);
  assert.strictEqual(gone.status, 404);

  console.log('✓ base clients : seed, CRUD, notes, création auto à la commande et dédoublonnage OK');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
