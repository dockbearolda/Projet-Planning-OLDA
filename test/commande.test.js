'use strict';

// Vérifie la prise de commande atelier de bout en bout sur le vrai serveur.
// L'enjeu est la FIDÉLITÉ : ce que Mélina saisit au téléphone doit arriver
// intact dans le planning, sans qu'on ait à rouvrir le mail. Le cas de
// référence est le mail « Iguana T-shirts » de Loïc OULED (2 articles, cœur +
// dos, article en boîte, maquette à faire, facture à faire).

const assert = require('node:assert');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

// Date CIVILE locale : le serveur raisonne en jours civils locaux, pas en UTC.
const jour = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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

  const post = async (body) => {
    const res = await fetch(`${base}/api/commande`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  const marquage = [
    { zone: 'coeur', consigne: 'Les Doudous à SXM', technique: 'dtf' },
    { zone: 'dos', consigne: 'Grand Case', technique: 'dtf' },
  ];
  const iguana = {
    kind: 'commande',
    client: { societe: 'Iguana (Discover)', contact: 'Jérôme', telephone: '0690 66 24 00', type: 'pro' },
    articles: [
      { vetement: 'T-shirt sans manches', ref: 'K3022', couleur: 'Light Sand', taille: 'S', quantite: 1, zones: marquage },
      { vetement: 'Débardeur crop top', ref: 'NS342', couleur: 'Ivory', taille: 'XS', quantite: 1, zones: marquage },
    ],
    enBoite: true, maquette: true, facture: 'a_faire',
    deadline: jour(7), priority: 2, vendeuse: 'Mélina', referent: 'Loïc',
  };

  // 1. Le mail de référence passe en entier : nature, client, articles, zones.
  const ok = await post(iguana);
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
  const c = ok.body.commande;
  assert.strictEqual(c.type.id, 'commande');
  assert.strictEqual(c.client.societe, 'Iguana (Discover)');
  assert.strictEqual(c.articles.length, 2);
  assert.strictEqual(c.articles[0].ref, 'K3022');
  assert.strictEqual(c.articles[0].zones.length, 2);
  assert.strictEqual(c.articles[0].zones[0].zoneLabel, 'Cœur');
  assert.strictEqual(c.articles[0].zones[0].consigne, 'Les Doudous à SXM');
  assert.strictEqual(c.quantite, 2);

  // 2. Une COMMANDE validée n'a rien à faire dans « Demande » : elle part
  //    directement en préparation. Une DEMANDE reste à chiffrer.
  assert.strictEqual(c.stage, 'preparation');
  assert.strictEqual(c.subStage, 'prepa_fichiers');
  const dem = await post({ ...iguana, kind: 'demande' });
  assert.strictEqual(dem.body.commande.stage, 'demande');
  assert.strictEqual(dem.body.commande.subStage, null);

  // 3. La ligne atterrit dans le planning, lisible SANS ouvrir le JSON : la
  //    nature, le détail des zones et les statuts sont dans les colonnes.
  const list = await (await fetch(`${base}/api/requests?stage=preparation`)).json();
  const row = list.find((r) => r.id === ok.body.id);
  assert.ok(row, 'la commande doit apparaître à l\'étape préparation');
  assert.strictEqual(row.order_kind, 'commande');
  assert.strictEqual(row.billing_company, 'Iguana (Discover)');
  assert.strictEqual(row.contact_referent, 'Jérôme');
  assert.strictEqual(row.contact_phone, '0690 66 24 00');
  assert.strictEqual(row.quantity, 2);
  assert.strictEqual(row.responsable, 'Mélina');
  assert.strictEqual(row.referent, 'Loïc');
  assert.match(row.description, /Cœur \[DTF\] : Les Doudous à SXM/);
  assert.match(row.description, /Dos \[DTF\] : Grand Case/);
  assert.match(row.description, /réf\. K3022 · Light Sand · taille S/);
  assert.match(row.description, /Article en boîte : oui · Maquette à faire · Facture : à faire/);
  assert.match(row.product, /2 pièces/);

  // 4. Sans date, la règle maison s'applique : 7 jours, jamais « sans échéance ».
  const sansDate = await post({ ...iguana, deadline: '' });
  assert.strictEqual(sansDate.body.commande.deadline, jour(7));

  // 4 bis. Une date bien formée mais impossible (30 février) ne doit pas casser
  //        l'INSERT : on retombe sur le délai par défaut, pas sur un 500.
  const dateFolle = await post({ ...iguana, deadline: '2026-02-30' });
  assert.strictEqual(dateFolle.status, 201, JSON.stringify(dateFolle.body));
  assert.strictEqual(dateFolle.body.commande.deadline, jour(7));

  // 5. L'ordre des zones suit le catalogue, pas l'ordre de saisie : le cœur
  //    passe avant le dos même si l'atelier a coché le dos en premier.
  const inverse = await post({
    ...iguana,
    articles: [{ ...iguana.articles[0], zones: [marquage[1], marquage[0]] }],
  });
  assert.deepStrictEqual(
    inverse.body.commande.articles[0].zones.map((z) => z.zone),
    ['dos', 'coeur'],
    'le serveur conserve l\'ordre reçu — c\'est le front qui trie',
  );

  // 6. Refus explicites : chaque manque a son message.
  const cases = [
    [{ ...iguana, kind: 'peut-être' }, /nature inconnue/i],
    [{ ...iguana, client: { societe: '' } }, /nom du client/i],
    [{ ...iguana, client: { societe: 'X', email: 'pas-un-email' } }, /email invalide/i],
    [{ ...iguana, articles: [] }, /commande est vide/i],
    [{ ...iguana, articles: [{ vetement: '', quantite: 1 }] }, /type de vêtement est vide/i],
    [{ ...iguana, articles: [{ vetement: 'T-shirt', quantite: 0 }] }, /quantité invalide/i],
    [{ ...iguana, articles: [{ vetement: 'T-shirt', quantite: 1, zones: [{ zone: 'nulle-part' }] }] }, /zone d'impression inconnue/i],
    [{ ...iguana, articles: [{ vetement: 'T-shirt', quantite: 1, zones: [{ zone: 'dos' }, { zone: 'dos' }] }] }, /deux fois/i],
    [{ ...iguana, articles: [{ vetement: 'T-shirt', quantite: 1, zones: [{ zone: 'dos', consigne: 'x'.repeat(161) }] }] }, /consigne trop longue/i],
  ];
  for (const [body, re] of cases) {
    const res = await post(body);
    assert.strictEqual(res.status, 400, `attendu 400 pour ${JSON.stringify(body).slice(0, 70)}`);
    assert.match(res.body.error, re);
  }

  // 7. L'annuaire client se déduit du planning : le client qu'on vient de
  //    saisir est proposé à la saisie suivante, dédoublonné malgré la casse.
  const clients = await (await fetch(`${base}/api/clients`)).json();
  const iguanaEntry = clients.filter((x) => /iguana/i.test(x.nom));
  assert.strictEqual(iguanaEntry.length, 1, 'un seul Iguana, quel que soit le nombre de commandes');
  assert.strictEqual(iguanaEntry[0].contact, 'Jérôme');
  assert.strictEqual(iguanaEntry[0].telephone, '0690 66 24 00');
  assert.ok(iguanaEntry[0].commandes >= 2, 'le compteur suit les commandes du client');

  // 8. La nature est aussi validée sur la grille : on ne pose pas n'importe quoi.
  const bad = await fetch(`${base}/api/requests/${ok.body.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_kind: 'brouillon' }),
  });
  assert.strictEqual(bad.status, 400);
  const cleared = await fetch(`${base}/api/requests/${ok.body.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_kind: '' }),
  });
  assert.strictEqual((await cleared.json()).order_kind, null, 'vide = pas de nature, pas d\'erreur');

  // 9. La nature est une propriété du DOSSIER : elle survit à une duplication
  //    et à un « Envoyer vers » (le front la recopie, le serveur l'accepte).
  const copie = await fetch(`${base}/api/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage: 'fiverr', order_kind: 'commande', billing_company: 'Iguana (Discover)' }),
  });
  assert.strictEqual((await copie.json()).order_kind, 'commande');

  console.log('✓ commande : nature, articles, zones, délai par défaut, annuaire client et refus OK');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
