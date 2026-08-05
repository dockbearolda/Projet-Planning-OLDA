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
  assert.ok(seeded.body.length >= 70, `base pré-remplie attendue, reçu ${seeded.body.length}`);
  // …et SANS DOUBLON. Le fichier d'import contient neuf sociétés en double
  // (« Sima », « Blue Martini », « Le Martin »…) : elles entraient telles quelles
  // et s'affichaient deux fois dans la base du patron. L'import se fait
  // désormais par clé de rapprochement, chaque société n'entre qu'une fois.
  const clesSeed = seeded.body.map((c) => c.entreprise.toLowerCase().trim());
  assert.strictEqual(new Set(clesSeed).size, clesSeed.length, 'aucune société en double à l\'import');
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
    entreprise: 'Test Boutique', nom: 'Léa',
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
  const patch = await j('PATCH', `/api/clients/${id}`, { secteur: 'Boutique haut de gamme', zone: 'Grand Case' });
  assert.strictEqual(patch.status, 200);
  assert.strictEqual(patch.body.secteur, 'Boutique haut de gamme');
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
  // La timeline est triée sur `created_at`. Postgres l'horodate à la
  // microseconde, mais la base en mémoire des tests s'arrête à la milliseconde :
  // deux notes postées coup sur coup y partagent la même heure et le tri
  // devient un tirage au sort. On les sépare pour tester l'ORDRE, pas la
  // résolution de l'horloge.
  await new Promise((r) => setTimeout(r, 5));
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

  // 5. Création automatique à l'enregistrement d'un projet, sans doublon.
  const before = (await j('GET', '/api/clients')).body.length;
  const nouveauClient = 'Chez Testeur ' + Math.floor(seeded.body.length);
  const cmd = {
    kind: 'commande',
    client: { societe: nouveauClient, contact: 'Paul', telephone: '0690 12 34 56', type: 'pro' },
    lignes: [{ type: 'textile', quantite: 3, description: '3 t-shirts', prixTtcManuel: 60 }],
    delai: 'j5',
  };
  const c1 = await j('POST', '/api/projets', cmd);
  assert.strictEqual(c1.status, 201, JSON.stringify(c1.body));
  const after1 = await j('GET', '/api/clients');
  assert.strictEqual(after1.body.length, before + 1, 'un nouveau client créé');
  const auto = after1.body.find((c) => c.entreprise === nouveauClient);
  assert.ok(auto, 'le client du projet est dans la base');
  assert.strictEqual(auto.nom, 'Paul');
  assert.strictEqual(auto.telephone, '0690 12 34 56');
  assert.strictEqual(auto.client_type, 'pro', 'la nature pro du projet suit le client');
  assert.ok(auto.commandes >= 1, 'la commande est comptée');

  // Un 2e projet du MÊME client (casse différente) ne crée pas de doublon.
  await j('POST', '/api/projets', { ...cmd, client: { ...cmd.client, societe: nouveauClient.toUpperCase() } });
  const after2 = await j('GET', '/api/clients');
  assert.strictEqual(after2.body.length, before + 1, 'pas de doublon malgré la casse');
  const autoBis = after2.body.find((c) => c.entreprise === nouveauClient);
  assert.ok(autoBis.commandes >= 2, 'le compteur suit les commandes');

  // Un projet PERSO crée un client perso dans la base (la nature suit).
  const persoName = 'Particulier Testeur ' + Math.floor(seeded.body.length);
  const cmdPerso = await j('POST', '/api/projets', {
    kind: 'demande',
    client: { societe: persoName, contact: 'Sophie', type: 'perso' },
    lignes: [{ type: 'textile', quantite: 1, description: '1 sweat', prixTtcManuel: 40 }],
    delai: 'j5',
  });
  assert.strictEqual(cmdPerso.status, 201, JSON.stringify(cmdPerso.body));
  const autoPerso = (await j('GET', '/api/clients')).body.find((c) => c.entreprise === persoName);
  assert.ok(autoPerso, 'le client perso est dans la base');
  assert.strictEqual(autoPerso.client_type, 'perso', 'la nature perso suit le client');

  // Un particulier commandé avec prénom + nom séparés : la colonne Client du
  // planning porte « Prénom NOM » — jamais le nom de famille tout seul —, et sa
  // fiche naît complète (les deux champs remplis, pas seulement `entreprise`).
  const suffixe = Math.floor(seeded.body.length);
  const cmdIdentite = await j('POST', '/api/projets', {
    kind: 'demande',
    client: { type: 'perso', prenom: 'Jean-Marc', nom: `DUPONT${suffixe}`, whatsapp: '0690 11 22 33' },
    lignes: [{ type: 'textile', quantite: 1, description: '1 polo', prixTtcManuel: 30 }],
    delai: 'j5',
  });
  assert.strictEqual(cmdIdentite.status, 201, JSON.stringify(cmdIdentite.body));
  assert.strictEqual(
    cmdIdentite.body.projet.client.societe, `Jean-Marc DUPONT${suffixe}`,
    'le nom du dossier porte le prénom ET le nom',
  );
  const ligneIdentite = (await j('GET', '/api/requests')).body
    .find((r) => r.billing_company === `Jean-Marc DUPONT${suffixe}`);
  assert.ok(ligneIdentite, 'la ligne du planning affiche « Prénom NOM »');
  const ficheIdentite = (await j('GET', '/api/clients')).body
    .find((c) => c.entreprise === `Jean-Marc DUPONT${suffixe}`);
  assert.ok(ficheIdentite, 'la fiche du particulier est créée');
  assert.strictEqual(ficheIdentite.prenom, 'Jean-Marc', 'le prénom est enregistré dans la fiche');
  assert.strictEqual(ficheIdentite.nom, `DUPONT${suffixe}`, 'le nom est enregistré dans la fiche');

  // 6. Suppression du client (et de ses notes).
  const del = await j('DELETE', `/api/clients/${id}`);
  assert.strictEqual(del.status, 204);
  const gone = await j('GET', `/api/clients/${id}`);
  assert.strictEqual(gone.status, 404);

  // 7. Champs enrichis (fiche complète) + nature étendue (pro/perso/asso/revendeur)
  //    + identifiant lisible généré côté serveur.
  const proEnrichi = await j('POST', '/api/clients', {
    entreprise: 'SARL Evelyne', raison_sociale: 'SARL EVELYNE', code_postal: '97150',
    ville: 'SAINT-MARTIN', pays: 'France', adresse: '12 rue de la Liberté, Marigot',
    secteur: 'Hôtel / Restaurant',
    referent_prenom: 'Cédric', prenom: 'Evelyne', client_type: 'revendeur',
  });
  assert.strictEqual(proEnrichi.status, 201, JSON.stringify(proEnrichi.body));
  assert.strictEqual(proEnrichi.body.raison_sociale, 'SARL EVELYNE');
  assert.strictEqual(proEnrichi.body.code_postal, '97150');
  assert.strictEqual(proEnrichi.body.adresse, '12 rue de la Liberté, Marigot',
    'l’adresse est acceptée et relue telle quelle');
  assert.strictEqual(proEnrichi.body.prenom, 'Evelyne');
  assert.strictEqual(proEnrichi.body.secteur, 'Hôtel / Restaurant');
  assert.strictEqual(proEnrichi.body.client_type, 'revendeur', 'nature étendue acceptée');
  assert.match(proEnrichi.body.code, /^CLI-PRO-\d{4}$/, 'code lisible CLI-PRO-xxxx généré');

  const persoEnrichi = await j('POST', '/api/clients', { entreprise: 'Grégory Lacroix', client_type: 'perso' });
  assert.strictEqual(persoEnrichi.status, 201);
  assert.match(persoEnrichi.body.code, /^CLI-PERSO-\d{4}$/, 'code lisible CLI-PERSO-xxxx pour un perso');

  const assoEnrichi = await j('POST', '/api/clients', { entreprise: 'Asso Test', client_type: 'asso' });
  assert.strictEqual(assoEnrichi.status, 201, JSON.stringify(assoEnrichi.body));
  assert.strictEqual(assoEnrichi.body.client_type, 'asso');

  const natureInvalide = await j('POST', '/api/clients', { entreprise: 'X2', client_type: 'zzz' });
  assert.strictEqual(natureInvalide.status, 400);

  // Les codes s'incrémentent, jamais réutilisés (robuste aux suppressions).
  const proEnrichi2 = await j('POST', '/api/clients', { entreprise: 'Deuxième Pro', client_type: 'pro' });
  const codeN1 = Number.parseInt(proEnrichi.body.code.slice('CLI-PRO-'.length), 10);
  const codeN2 = Number.parseInt(proEnrichi2.body.code.slice('CLI-PRO-'.length), 10);
  assert.ok(codeN2 > codeN1, 'le code suivant est strictement supérieur');

  await j('DELETE', `/api/clients/${proEnrichi2.body.id}`);
  const proEnrichi3 = await j('POST', '/api/clients', { entreprise: 'Troisième Pro', client_type: 'pro' });
  const codeN3 = Number.parseInt(proEnrichi3.body.code.slice('CLI-PRO-'.length), 10);
  assert.ok(codeN3 > codeN2, 'le code n\'est jamais réutilisé après suppression');

  // L'adresse se modifie comme le reste de la fiche.
  const majAdresse = await j('PATCH', `/api/clients/${proEnrichi.body.id}`, { adresse: 'Baie Nettlé, lot 4' });
  assert.strictEqual(majAdresse.status, 200);
  assert.strictEqual(majAdresse.body.adresse, 'Baie Nettlé, lot 4');

  // 8. SECTEURS D'ACTIVITÉ : liste modifiable, plus une constante du code.
  const sect0 = await j('GET', '/api/clients/secteurs');
  assert.strictEqual(sect0.status, 200);
  assert.ok(Array.isArray(sect0.body) && sect0.body.length >= 20,
    'la liste est amorcée avec les secteurs connus, pas vide');
  assert.ok(sect0.body.includes('Boutique'));

  const ajout = await j('POST', '/api/clients/secteurs', { label: 'Yachting' });
  assert.strictEqual(ajout.status, 201, JSON.stringify(ajout.body));
  assert.ok(ajout.body.includes('Yachting'), 'le secteur ajouté est dans la liste');

  // Idempotent, casse et accents compris : « yachting » n'en crée pas un second.
  const doublon = await j('POST', '/api/clients/secteurs', { label: 'yachting' });
  assert.strictEqual(doublon.body.filter((x) => x.toLowerCase() === 'yachting').length, 1,
    'pas de doublon sur la casse');
  assert.strictEqual((await j('POST', '/api/clients/secteurs', { label: '   ' })).status, 400,
    'un libellé vide est refusé');

  // Un secteur retiré de la LISTE ne disparaît pas des FICHES qui le portent :
  // la valeur y est recopiée, jamais référencée.
  await j('POST', '/api/clients/secteurs', { label: 'Éphémère' });
  const fichePorteuse = await j('POST', '/api/clients', { entreprise: 'Client Éphémère', secteur: 'Éphémère' });
  const apresRetrait = await j('DELETE', '/api/clients/secteurs/' + encodeURIComponent('Éphémère'));
  assert.ok(!apresRetrait.body.includes('Éphémère'), 'le secteur quitte la liste');
  const relue = await j('GET', `/api/clients/${fichePorteuse.body.id}`);
  assert.strictEqual(relue.body.secteur, 'Éphémère', 'la fiche garde son secteur');

  // La liste survit au redémarrage : elle est en base, pas en mémoire.
  const sectRelue = await j('GET', '/api/clients/secteurs');
  assert.ok(sectRelue.body.includes('Yachting'), 'l’ajout est bien persisté');

  console.log('✓ base clients : seed, CRUD, notes, adresse, secteurs modifiables et dédoublonnage OK');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
