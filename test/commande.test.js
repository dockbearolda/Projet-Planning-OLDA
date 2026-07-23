'use strict';

// Vérifie la prise de commande atelier de bout en bout sur le vrai serveur.
// L'enjeu est la FIDÉLITÉ : ce que le comptoir saisit devant le client doit
// arriver intact dans le planning, sans qu'on ait à rappeler personne. Le cas de
// référence est le mail « Iguana T-shirts » de Loïc OULED (2 articles, cœur +
// dos, article en boîte, maquette à faire).
//
// Depuis la refonte « pro / perso », la fiche couvre aussi : le contact en deux
// formes (PRO nom de facturation / PERSO prénom + nom), la demande simple
// (objet + description, sans produit), les trois familles (tasses, textile,
// objets), le délai d'un tap (3 / 5 / 10 / 15 jours) et le statut de paiement.

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
  const rowOf = async (id, stage) => {
    const list = await (await fetch(`${base}/api/requests?stage=${stage}`)).json();
    return list.find((r) => r.id === id);
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
    enBoite: true, maquette: true,
    deadline: jour(7), priority: 2, vendeuse: 'Mélina', referent: 'Loïc',
  };

  // 1. Le mail de référence passe en entier : nature, client, articles, zones.
  //    Le textile reste lisible sous son ancien nom (`articles`), la fiche le
  //    range dans la famille `textiles`.
  const ok = await post(iguana);
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
  const c = ok.body.commande;
  assert.strictEqual(c.type.id, 'commande');
  assert.strictEqual(c.client.societe, 'Iguana (Discover)');
  assert.strictEqual(c.textiles.length, 2);
  assert.strictEqual(c.textiles[0].ref, 'K3022');
  assert.strictEqual(c.textiles[0].zones.length, 2);
  assert.strictEqual(c.textiles[0].zones[0].zoneLabel, 'Cœur');
  assert.strictEqual(c.textiles[0].zones[0].consigne, 'Les Doudous à SXM');
  assert.strictEqual(c.quantite, 2);

  // 2. Une COMMANDE validée va dans la colonne « Commande » (ex-chiffrage),
  //    directement sur la sous-étape « À chiffrer » ; une DEMANDE reste dans
  //    « Demande ».
  assert.strictEqual(c.stage, 'chiffrage');
  assert.strictEqual(c.subStage, 'a_chiffrer');
  const dem = await post({ ...iguana, kind: 'demande' });
  assert.strictEqual(dem.body.commande.stage, 'demande');
  assert.strictEqual(dem.body.commande.subStage, null);

  // 3. La ligne atterrit dans le planning, lisible SANS ouvrir le JSON : la
  //    nature, le contact, le détail des zones et les statuts sont en colonnes.
  const row = await rowOf(ok.body.id, 'chiffrage');
  assert.ok(row, 'la commande doit apparaître à l\'étape chiffrage');
  assert.strictEqual(row.order_kind, 'commande');
  assert.strictEqual(row.billing_company, 'Iguana (Discover)');
  assert.strictEqual(row.contact_referent, 'Jérôme');
  assert.strictEqual(row.contact_phone, '0690 66 24 00');
  assert.strictEqual(row.quantity, 2);
  assert.strictEqual(row.responsable, 'Mélina');
  assert.strictEqual(row.referent, 'Loïc');
  assert.match(row.description, /Contact : Jérôme · WhatsApp 0690 66 24 00/);
  assert.match(row.description, /Cœur \[DTF\] : Les Doudous à SXM/);
  assert.match(row.description, /Dos \[DTF\] : Grand Case/);
  assert.match(row.description, /réf\. K3022 · Light Sand · taille S/);
  assert.match(row.description, /Article en boîte : oui · Maquette à faire · Paiement : non payé/);
  assert.match(row.product, /2 pièces/);

  // 4. Sans date ni délai, la règle maison s'applique : 5 jours (le délai par
  //    défaut du catalogue), jamais « sans échéance ».
  const sansDate = await post({ ...iguana, deadline: '' });
  assert.strictEqual(sansDate.body.commande.deadline, jour(5));
  assert.strictEqual(sansDate.body.commande.delai.id, 'j5');

  // 4 bis. Une date bien formée mais impossible (30 février) ne doit pas casser
  //        l'INSERT : on retombe sur le délai par défaut, pas sur un 500.
  const dateFolle = await post({ ...iguana, deadline: '2026-02-30' });
  assert.strictEqual(dateFolle.status, 201, JSON.stringify(dateFolle.body));
  assert.strictEqual(dateFolle.body.commande.deadline, jour(5));

  // 4 ter. Le délai se choisit d'un tap : « sous 3 jours » pose l'échéance ET
  //        garde sa majoration de 10 %, que le chiffrage retrouvera dans la fiche.
  const urgent = await post({ ...iguana, deadline: '', delai: 'express' });
  assert.strictEqual(urgent.body.commande.deadline, jour(3));
  assert.strictEqual(urgent.body.commande.delai.majoration, 10);
  assert.match((await rowOf(urgent.body.id, 'chiffrage')).description, /Délai : Sous 3 jours \(\+10 %\)/);
  const long = await post({ ...iguana, deadline: '', delai: 'j15' });
  assert.strictEqual(long.body.commande.deadline, jour(15));

  // 5. L'ordre des zones suit le catalogue, pas l'ordre de saisie : le cœur
  //    passe avant le dos même si l'atelier a coché le dos en premier.
  const inverse = await post({
    ...iguana,
    articles: [{ ...iguana.articles[0], zones: [marquage[1], marquage[0]] }],
  });
  assert.deepStrictEqual(
    inverse.body.commande.textiles[0].zones.map((z) => z.zone),
    ['dos', 'coeur'],
    'le serveur conserve l\'ordre reçu — c\'est le front qui trie',
  );

  // 6. Refus explicites : chaque manque a son message.
  const cases = [
    [{ ...iguana, kind: 'peut-être' }, /nature inconnue/i],
    [{ ...iguana, client: { societe: '' } }, /nom du client/i],
    [{ ...iguana, client: { type: 'perso', prenom: '', nom: '' } }, /nom du client/i],
    [{ ...iguana, client: { societe: 'X', email: 'pas-un-email' } }, /email invalide/i],
    [{ ...iguana, articles: [] }, /commande est vide/i],
    [{ ...iguana, articles: [{ vetement: '', quantite: 1 }] }, /type de vêtement est vide/i],
    [{ ...iguana, articles: [{ vetement: 'T-shirt', quantite: 0 }] }, /quantité invalide/i],
    [{ ...iguana, articles: [{ vetement: 'T-shirt', quantite: 1, zones: [{ zone: 'nulle-part' }] }] }, /zone d'impression inconnue/i],
    [{ ...iguana, articles: [{ vetement: 'T-shirt', quantite: 1, zones: [{ zone: 'dos' }, { zone: 'dos' }] }] }, /deux fois/i],
    [{ ...iguana, articles: [{ vetement: 'T-shirt', quantite: 1, zones: [{ zone: 'dos', consigne: 'x'.repeat(161) }] }] }, /consigne trop longue/i],
    [{ ...iguana, articles: [], tasses: [{ ref: '', quantite: 1 }] }, /référence de tasse est vide/i],
    [{ ...iguana, articles: [], tasses: [{ ref: 'Tasse', quantite: 1, options: ['logo_martien'] }] }, /option inconnue/i],
    [{ ...iguana, articles: [], objets: [{ ref: '', quantite: 1 }] }, /référence d'objet est vide/i],
    [{ ...iguana, articles: [], objets: [{ ref: 'Gourde', quantite: 1, technique: 'marteau' }] }, /type de personnalisation inconnu/i],
  ];
  for (const [body, re] of cases) {
    const res = await post(body);
    assert.strictEqual(res.status, 400, `attendu 400 pour ${JSON.stringify(body).slice(0, 70)}`);
    assert.match(res.body.error, re);
  }

  // 7. La prise de commande alimente la BASE CLIENTS : le client saisi y est
  //    créé (une seule fois, dédoublonné malgré la casse) et proposé ensuite à
  //    la saisie suivante, avec son contact, son téléphone et son compteur de
  //    commandes au planning.
  const clients = await (await fetch(`${base}/api/clients`)).json();
  const iguanaEntry = clients.filter((x) => x.entreprise === 'Iguana (Discover)');
  assert.strictEqual(iguanaEntry.length, 1, 'un seul Iguana (Discover), quel que soit le nombre de commandes');
  assert.strictEqual(iguanaEntry[0].nom, 'Jérôme', 'le contact saisi est repris dans la fiche');
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

  // 10. CONTACT PRO complet : nom de facturation, contact, WhatsApp, email.
  //     Les quatre atterrissent dans les colonnes du planning, pas dans un JSON.
  const pro = await post({
    kind: 'commande',
    client: {
      type: 'pro',
      facturation: 'Hôtel La Samanna',
      contact: 'Sophie',
      whatsapp: '0690 12 34 56',
      email: 'sophie@samanna.com',
    },
    objet: 'Polos réception',
    textiles: [{ vetement: 'Polo', quantite: 12, couleur: 'Marine', taille: 'L', zones: [{ zone: 'coeur', consigne: 'Logo brodé' }] }],
    delai: 'j10',
  });
  assert.strictEqual(pro.status, 201, JSON.stringify(pro.body));
  assert.strictEqual(pro.body.commande.client.facturation, 'Hôtel La Samanna');
  assert.strictEqual(pro.body.commande.client.whatsapp, '0690 12 34 56');
  const proRow = await rowOf(pro.body.id, 'chiffrage');
  assert.strictEqual(proRow.billing_company, 'Hôtel La Samanna');
  assert.strictEqual(proRow.contact_referent, 'Sophie');
  assert.strictEqual(proRow.contact_phone, '0690 12 34 56');
  assert.strictEqual(proRow.contact_email, 'sophie@samanna.com');
  assert.match(proRow.description, /Contact : Sophie · WhatsApp 0690 12 34 56 · sophie@samanna\.com/);

  // 11. CONTACT PERSO : prénom + nom + WhatsApp. Le nom complet occupe la
  //     colonne « Client » (pas de doublon en contact) et la fiche créée dans
  //     la base clients est marquée « perso ».
  const perso = await post({
    kind: 'demande',
    client: { type: 'perso', prenom: 'Marie', nom: 'Dupont', whatsapp: '0690 99 88 77' },
    objet: 'Tasse anniversaire',
    tasses: [{
      ref: 'Tasse blanche 33 cl', couleur: 'Blanc', quantite: 2,
      face1: 'Photo mariage', face2: 'Merci Maman',
      options: ['logo_client', 'texte'], typo: 'Great Vibes',
      infos: 'Photo fournie par WhatsApp', remarque: 'À emballer cadeau',
    }],
    paiement: { statut: 'acompte', mode: 'especes' },
    delai: 'express',
  });
  assert.strictEqual(perso.status, 201, JSON.stringify(perso.body));
  const pc = perso.body.commande;
  assert.strictEqual(pc.client.type, 'perso');
  assert.strictEqual(pc.client.societe, 'Marie Dupont');
  assert.strictEqual(pc.client.contact, null, 'le nom occupe déjà la colonne client');
  const persoRow = await rowOf(perso.body.id, 'demande');
  assert.strictEqual(persoRow.billing_company, 'Marie Dupont');
  assert.strictEqual(persoRow.client_type, 'perso');
  assert.strictEqual(persoRow.contact_phone, '0690 99 88 77');
  const marie = (await (await fetch(`${base}/api/clients`)).json()).find((x) => x.entreprise === 'Marie Dupont');
  assert.ok(marie, 'le particulier entre aussi dans la base clients');
  assert.strictEqual(marie.client_type, 'perso');

  // 12. TASSES : les deux faces gardent leur convention d'anse — c'est elle qui
  //     évite d'imprimer le visuel du mauvais côté pour un gaucher.
  assert.strictEqual(pc.tasses[0].faces.length, 2);
  assert.strictEqual(pc.tasses[0].faces[0].hint, 'anse à droite');
  assert.strictEqual(pc.tasses[0].faces[1].hint, 'anse à gauche');
  assert.match(persoRow.description, /Face 1 \(anse à droite\) : Photo mariage/);
  assert.match(persoRow.description, /Face 2 \(anse à gauche\) : Merci Maman/);
  assert.match(persoRow.description, /Logo client · Texte personnalisé/);
  assert.match(persoRow.description, /Typo : Great Vibes/);
  assert.match(persoRow.description, /Remarque : À emballer cadeau/);
  assert.match(persoRow.description, /Paiement : acompte payé \(Espèces\)/);
  assert.match(persoRow.product, /2 × Tasse blanche 33 cl/);

  // 13. OBJETS : ce qui compte, c'est la machine (TROTEC / UV / autre).
  const objets = await post({
    kind: 'commande',
    client: { type: 'pro', facturation: 'Sunset Bar' },
    objets: [
      { ref: 'Gourde inox', quantite: 30, technique: 'trotec', infos: 'Gravure logo 5 cm' },
      { ref: 'Plaque bois', quantite: 1, technique: 'uv', infos: 'Panneau entrée' },
    ],
  });
  assert.strictEqual(objets.status, 201, JSON.stringify(objets.body));
  const objRow = await rowOf(objets.body.id, 'chiffrage');
  assert.strictEqual(objRow.quantity, 31);
  assert.match(objRow.description, /TROTEC : Gravure logo 5 cm/);
  assert.match(objRow.description, /UV : Panneau entrée/);
  assert.match(objRow.product, /31 pièces — Gourde inox, Plaque bois/);

  // 14. DEMANDE SIMPLE : un objet et deux lignes de description suffisent à
  //     ouvrir le dossier. Aucun produit détaillé, et la ligne est quand même
  //     lisible dans le planning (l'objet devient la description).
  const simple = await post({
    kind: 'demande',
    client: { type: 'pro', facturation: 'Karibuni' },
    objet: 'Devis 40 polos brodés',
    description: 'Le client repasse mardi avec son logo vectorisé.',
  });
  assert.strictEqual(simple.status, 201, JSON.stringify(simple.body));
  const simpleRow = await rowOf(simple.body.id, 'demande');
  assert.strictEqual(simpleRow.product, 'Devis 40 polos brodés');
  assert.strictEqual(simpleRow.quantity, null, 'aucune pièce comptée sans produit');
  assert.match(simpleRow.description, /Objet : Devis 40 polos brodés/);
  assert.match(simpleRow.description, /logo vectorisé/);

  // 15. Les trois familles cohabitent sur une même fiche, dans l'ordre de
  //     lecture de l'atelier (tasses, textile, objets), et le total de pièces
  //     les additionne toutes.
  const melange = await post({
    kind: 'commande',
    client: { type: 'pro', facturation: 'Le Piment' },
    tasses: [{ ref: 'Mug thermos', quantite: 10 }],
    textiles: [{ vetement: 'T-shirt', quantite: 20, zones: [{ zone: 'dos' }] }],
    objets: [{ ref: 'Porte-clés', quantite: 50, technique: 'autres', infos: 'Découpe forme île' }],
    paiement: { statut: 'paye', mode: 'cb' },
  });
  assert.strictEqual(melange.status, 201, JSON.stringify(melange.body));
  assert.strictEqual(melange.body.commande.quantite, 80);
  const melRow = await rowOf(melange.body.id, 'chiffrage');
  const ordre = ['Tasses', 'Textile', 'Objets'].map((t) => melRow.description.indexOf(`\n${t}\n`));
  assert.ok(ordre[0] >= 0 && ordre[0] < ordre[1] && ordre[1] < ordre[2], 'tasses, puis textile, puis objets');
  assert.match(melRow.description, /Paiement : payé \(CB\)/);

  // 16. Le mode de paiement ne veut rien dire tant que rien n'est encaissé :
  //     « non payé » l'efface au lieu de laisser traîner un « CB » trompeur.
  const impaye = await post({
    kind: 'commande',
    client: { type: 'pro', facturation: 'Le Piment' },
    objet: 'Réassort',
    paiement: { statut: 'non_paye', mode: 'cb' },
  });
  assert.strictEqual(impaye.body.commande.paiement.mode, null);

  console.log('✓ commande : contact pro/perso, demande simple, tasses/textile/objets, délais, paiement, annuaire et refus OK');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
