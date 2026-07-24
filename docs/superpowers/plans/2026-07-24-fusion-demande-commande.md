# Fusion Demande/Commande + choix d'étape obligatoire — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supprimer la notion de nature (`order_kind`, badge "Demande"/"Commande") pour ne garder qu'un seul type de fiche — Demande — et rendre le choix de l'étape de destination obligatoire à chaque enregistrement, wizard complet comme ajout rapide dans la grille.

**Architecture:** Backend : suppression de la colonne `order_kind` (migration réversible) et de toute la logique de "nature" dans `buildCommande`/`validateField`. Frontend : fusion des deux entrées de menu `#demande`/`#commande` en une seule, suppression de `state.kind`/`setNature` dans le wizard, et ajout d'un menu ancré (réutilisant `openMenu()`) sur le bouton `+` de la grille pour forcer le choix d'étape avant toute création rapide.

**Tech Stack:** Node/Express, PostgreSQL (pg-mem en local), vanilla JS ES modules côté client, tests `node:assert` (`npm test`).

Design de référence : [docs/superpowers/specs/2026-07-24-fusion-demande-commande-design.md](../specs/2026-07-24-fusion-demande-commande-design.md)

---

### Task 1: Aligner les tests existants sur le nouveau contrat (sans `kind`)

Quatre fichiers de test envoient aujourd'hui `kind: 'demande'|'commande'` à `POST /api/commande`, et `commande.test.js` teste en plus la validation/copie de `order_kind` sur `POST /api/requests`. Cette tâche réécrit ces tests pour le comportement CIBLE (plus de `kind`, destination toujours explicite, plus de `order_kind`) — ils doivent donc ÉCHOUER tant que le Task 2 n'a pas modifié le backend (étape rouge du TDD).

**Files:**
- Modify: `test/commande.test.js`
- Modify: `test/destination-whatsapp.test.js:37-42,57-61`
- Modify: `test/commande-zones.test.js:68-70`
- Modify: `test/clients.test.js:128-132,153-157`

- [ ] **Step 1: Réécrire `test/commande.test.js`**

Remplacer tout le contenu du fichier par :

```js
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
    stage: 'chiffrage', subStage: 'a_chiffrer',
    client: { societe: 'Iguana (Discover)', contact: 'Jérôme', telephone: '0690 66 24 00', type: 'pro' },
    articles: [
      { vetement: 'T-shirt sans manches', ref: 'K3022', couleur: 'Light Sand', taille: 'S', quantite: 1, zones: marquage },
      { vetement: 'Débardeur crop top', ref: 'NS342', couleur: 'Ivory', taille: 'XS', quantite: 1, zones: marquage },
    ],
    enBoite: true,
    deadline: jour(7), priority: 2, vendeuse: 'Mélina', referent: 'Loïc',
  };

  // 1. Le mail de référence passe en entier : client, articles, zones,
  //    destination choisie. Le textile reste lisible sous son ancien nom
  //    (`articles`), la fiche le range dans la famille `textiles`.
  const ok = await post(iguana);
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
  const c = ok.body.commande;
  assert.strictEqual(c.client.societe, 'Iguana (Discover)');
  assert.strictEqual(c.textiles.length, 2);
  assert.strictEqual(c.textiles[0].ref, 'K3022');
  assert.strictEqual(c.textiles[0].zones.length, 2);
  assert.strictEqual(c.textiles[0].zones[0].zoneLabel, 'Cœur');
  assert.strictEqual(c.textiles[0].zones[0].consigne, 'Les Doudous à SXM');
  assert.strictEqual(c.quantite, 2);

  // 2. La destination choisie l'emporte toujours : ici « Commande » (ex-chiffrage),
  //    sous-étape « À chiffrer ». Une fiche envoyée vers « Demande » y reste.
  assert.strictEqual(c.stage, 'chiffrage');
  assert.strictEqual(c.subStage, 'a_chiffrer');
  const dem = await post({ ...iguana, stage: 'demande', subStage: null });
  assert.strictEqual(dem.body.commande.stage, 'demande');
  assert.strictEqual(dem.body.commande.subStage, null);

  // 3. La ligne atterrit dans le planning, lisible SANS ouvrir le JSON : le
  //    contact, le détail des zones et les statuts sont en colonnes.
  const row = await rowOf(ok.body.id, 'chiffrage');
  assert.ok(row, 'la commande doit apparaître à l\'étape chiffrage');
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
  assert.match(row.description, /Article en boîte : oui · Paiement : non payé/);
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

  // 6. Refus explicites : chaque manque a son message. (Le refus d'une étape
  //    inconnue est couvert par test/destination-whatsapp.test.js.)
  const cases = [
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

  // 8. CONTACT PRO complet : nom de facturation, contact, WhatsApp, email.
  //    Les quatre atterrissent dans les colonnes du planning, pas dans un JSON.
  const pro = await post({
    stage: 'chiffrage', subStage: 'a_chiffrer',
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

  // 9. CONTACT PERSO : prénom + nom + WhatsApp. Le nom complet occupe la
  //    colonne « Client » (pas de doublon en contact) et la fiche créée dans
  //    la base clients est marquée « perso ».
  const perso = await post({
    stage: 'demande', subStage: null,
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

  // 10. TASSES : les deux faces gardent leur convention d'anse — c'est elle qui
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

  // 11. OBJETS : ce qui compte, c'est la machine (TROTEC / UV / autre).
  const objets = await post({
    stage: 'chiffrage', subStage: 'a_chiffrer',
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

  // 12. DEMANDE SIMPLE : un objet et deux lignes de description suffisent à
  //     ouvrir le dossier. Aucun produit détaillé, et la ligne est quand même
  //     lisible dans le planning (l'objet devient la description).
  const simple = await post({
    stage: 'demande', subStage: null,
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

  // 13. Les trois familles cohabitent sur une même fiche, dans l'ordre de
  //     lecture de l'atelier (tasses, textile, objets), et le total de pièces
  //     les additionne toutes.
  const melange = await post({
    stage: 'chiffrage', subStage: 'a_chiffrer',
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

  // 14. Le mode de paiement ne veut rien dire tant que rien n'est encaissé :
  //     « non payé » l'efface au lieu de laisser traîner un « CB » trompeur.
  //     Sans étape choisie, la fiche retombe sur « demande » (plus de nature
  //     pour deviner une autre destination).
  const impaye = await post({
    client: { type: 'pro', facturation: 'Le Piment' },
    objet: 'Réassort',
    paiement: { statut: 'non_paye', mode: 'cb' },
  });
  assert.strictEqual(impaye.body.commande.paiement.mode, null);
  assert.strictEqual(impaye.body.commande.stage, 'demande', 'sans étape choisie, retombe sur « demande »');

  // 15. GRILLE DE TAILLES : un textile peut porter une quantité PAR TAILLE
  //     (XS…2XL). La quantité de la ligne est la somme, les tailles à zéro
  //     tombent, et le détail reste lisible dans le planning. Une description
  //     de ligne accompagne la référence.
  const grille = await post({
    stage: 'chiffrage', subStage: 'a_chiffrer',
    client: { type: 'pro', facturation: 'Beach Club' },
    textiles: [{
      vetement: 'T-shirt', ref: 'BC100', couleur: 'Sable', note: 'Col rond, coupe large',
      tailles: [
        { taille: 'XS', quantite: 2 },
        { taille: 'S', quantite: 0 },
        { taille: 'M', quantite: 5 },
        { taille: '2XL', quantite: 3 },
      ],
      zones: [{ zone: 'coeur', consigne: 'Logo' }],
    }],
    delai: 'jour_j',
  });
  assert.strictEqual(grille.status, 201, JSON.stringify(grille.body));
  const gc = grille.body.commande;
  assert.strictEqual(gc.textiles[0].quantite, 10, 'la quantité de ligne = somme des tailles');
  assert.strictEqual(gc.textiles[0].tailles.length, 3, 'les tailles à zéro ne comptent pas');
  assert.strictEqual(gc.quantite, 10);
  // Le délai « Jour J » pose l'échéance du jour même et garde sa majoration.
  assert.strictEqual(gc.deadline, jour(0));
  assert.strictEqual(gc.delai.id, 'jour_j');
  assert.strictEqual(gc.delai.majoration, 20);
  const grilleRow = await rowOf(grille.body.id, 'chiffrage');
  assert.match(grilleRow.description, /XS×2 · M×5 · 2XL×3/);
  assert.match(grilleRow.description, /Col rond, coupe large/);
  assert.match(grilleRow.description, /Délai : Jour J \(\+20 %\)/);

  // 16. La maquette n'est plus un état de la fiche : plus de ligne « Maquette »
  //     dans le récapitulatif, même si un ancien poste l'envoie encore.
  const sansMaq = await post({ ...iguana, maquette: true });
  assert.doesNotMatch((await rowOf(sansMaq.body.id, 'chiffrage')).description, /Maquette/);

  console.log('✓ commande : contact pro/perso, demande simple, tasses/textile/objets, grille de tailles, délais, paiement, annuaire et refus OK');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Modifier `test/destination-whatsapp.test.js`**

Remplacer :

```js
  const fiche = (extra) => ({
    kind: 'commande',
    client: { type: 'pro', facturation: 'Hôtel Mercure', whatsapp: '0690 66 24 00' },
    objet: '30 polos brodés',
    ...extra,
  });
```

par :

```js
  const fiche = (extra) => ({
    client: { type: 'pro', facturation: 'Hôtel Mercure', whatsapp: '0690 66 24 00' },
    objet: '30 polos brodés',
    ...extra,
  });
```

Puis remplacer :

```js
  // 1.2 Sans destination (ancien corps) : celle du catalogue, comme avant.
  r = await call('POST', '/api/commande', fiche());
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.commande.stage, 'chiffrage');
  assert.strictEqual(r.body.commande.subStage, 'a_chiffrer');
```

par :

```js
  // 1.2 Sans destination (ancien corps, script) : retombe sur l'étape « demande »
  // (il n'y a plus de nature pour deviner une autre destination).
  r = await call('POST', '/api/commande', fiche());
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.commande.stage, 'demande');
  assert.strictEqual(r.body.commande.subStage, null);
```

- [ ] **Step 3: Modifier `test/commande-zones.test.js`**

Remplacer :

```js
  const commande = {
    kind: 'commande',
    client: { societe: 'Atelier test', type: 'pro' },
```

par :

```js
  const commande = {
    client: { societe: 'Atelier test', type: 'pro' },
```

- [ ] **Step 4: Modifier `test/clients.test.js`**

Remplacer :

```js
  const cmd = {
    kind: 'commande',
    client: { societe: nouveauClient, contact: 'Paul', telephone: '0690 12 34 56', type: 'pro' },
    articles: [{ vetement: 'T-shirt', quantite: 3, zones: [] }],
  };
```

par :

```js
  const cmd = {
    client: { societe: nouveauClient, contact: 'Paul', telephone: '0690 12 34 56', type: 'pro' },
    articles: [{ vetement: 'T-shirt', quantite: 3, zones: [] }],
  };
```

Puis remplacer :

```js
  const cmdPerso = await j('POST', '/api/commande', {
    kind: 'demande',
    client: { societe: persoName, contact: 'Sophie', type: 'perso' },
    articles: [{ vetement: 'Sweat', quantite: 1, zones: [] }],
  });
```

par :

```js
  const cmdPerso = await j('POST', '/api/commande', {
    client: { societe: persoName, contact: 'Sophie', type: 'perso' },
    articles: [{ vetement: 'Sweat', quantite: 1, zones: [] }],
  });
```

- [ ] **Step 5: Lancer les tests modifiés et vérifier qu'ils ÉCHOUENT (étape rouge)**

Run: `node test/commande.test.js`
Expected: FAIL (ex. `nature inconnue : undefined (demande ou commande)`, ou statut 400 au lieu de 201) — normal, le backend n'a pas encore changé.

Run: `node test/destination-whatsapp.test.js`
Expected: FAIL sur l'assertion `stage === 'demande'` du cas 1.2 (le backend renvoie encore `chiffrage` par défaut).

- [ ] **Step 6: Commit**

```bash
git add test/commande.test.js test/destination-whatsapp.test.js test/commande-zones.test.js test/clients.test.js
git commit -m "test: aligne les tests commande sur le contrat sans nature (rouge, backend à venir)"
```

---

### Task 2: Backend — suppression de `order_kind` (schema, migration, validation, `buildCommande`)

Fait passer les tests du Task 1 au vert : supprime la colonne `order_kind`, la validation associée, et la dépendance de `buildCommande`/`buildDestination` à une "nature" de fiche.

**Files:**
- Modify: `schema.sql:9`
- Modify: `db.js:105-109,150-155,728`
- Modify: `server.js:16,27,66,104-111,726,1077-1101,1170,1218,1246-1273`
- Modify: `catalog.json:1-6`

- [ ] **Step 1: `schema.sql` — retirer la colonne `order_kind`**

Remplacer :

```sql
  stage           text NOT NULL DEFAULT 'demande',   -- FAMILLE (8 grandes étapes + fiverr)
  sub_stage       text,                              -- SOUS-FAMILLE (précise l'action en cours ; null si la famille n'en a pas)
  order_kind      text,                              -- NATURE tranchée à la prise : 'demande' (à chiffrer) / 'commande' (validée) ; null = ancienne ligne
  responsable     text,                              -- PILOTE : qui pilote le projet (Loïc / Charlie / Mélina / Julien / À attribuer)
```

par :

```sql
  stage           text NOT NULL DEFAULT 'demande',   -- FAMILLE (8 grandes étapes + fiverr)
  sub_stage       text,                              -- SOUS-FAMILLE (précise l'action en cours ; null si la famille n'en a pas)
  responsable     text,                              -- PILOTE : qui pilote le projet (Loïc / Charlie / Mélina / Julien / À attribuer)
```

- [ ] **Step 2: `db.js` — retirer `ORDER_KINDS` et ajouter la migration DROP**

Remplacer :

```js
// NATURE de la ligne, tranchée dès la prise de commande (requests.order_kind) :
// une DEMANDE est à chiffrer (devis à faire), une COMMANDE est déjà validée par
// le client. null = ligne créée avant l'existence du champ, ou saisie à la main
// dans la grille : on n'invente pas la nature à sa place.
const ORDER_KINDS = ['demande', 'commande'];

const isProd = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
```

par :

```js
const isProd = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
```

Puis remplacer :

```js
  for (const col of ['contact_phone', 'contact_email', 'color', 'sub_stage', 'responsable', 'referent',
    'flag', 'flag_reason', 'order_kind']) {
    try {
      await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS ${col} text`);
    } catch (_) { /* pg-mem local : colonnes déjà présentes via le schéma */ }
  }
```

par :

```js
  for (const col of ['contact_phone', 'contact_email', 'color', 'sub_stage', 'responsable', 'referent',
    'flag', 'flag_reason']) {
    try {
      await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS ${col} text`);
    } catch (_) { /* pg-mem local : colonnes déjà présentes via le schéma */ }
  }

  // Migration : fusion demande/commande — la NATURE (order_kind) disparaît, il
  // n'existe plus qu'un seul type de fiche (« Demande »).
  // Down : ALTER TABLE requests ADD COLUMN IF NOT EXISTS order_kind text
  try {
    await pool.query('ALTER TABLE requests DROP COLUMN IF EXISTS order_kind');
  } catch (_) { /* pg-mem local : colonne déjà absente via le schéma */ }
```

Puis retirer `ORDER_KINDS,` de `module.exports` :

```js
  STAGES, STAGE_SLUGS, FAMILIES, SUB_STAGES, SUB_SLUGS, EMPLOYEES, RESPONSABLES, CLIENT_TYPES, FLAGS,
  ORDER_KINDS,
  getCategoryOwners, setCategoryOwners,
```

devient :

```js
  STAGES, STAGE_SLUGS, FAMILIES, SUB_STAGES, SUB_SLUGS, EMPLOYEES, RESPONSABLES, CLIENT_TYPES, FLAGS,
  getCategoryOwners, setCategoryOwners,
```

- [ ] **Step 3: `server.js` — retirer `ORDER_KINDS`/`ORDER_KIND_SET`, `PATCHABLE`, `validateField`**

Remplacer :

```js
const {
  pool, init, STAGES, STAGE_SLUGS, SUB_SLUGS, RESPONSABLES, CLIENT_TYPES, FLAGS, ORDER_KINDS,
  getCategoryOwners, setCategoryOwners,
  getCategoryReferents, setCategoryReferents,
  getMachines, setMachines,
  getCommandeZones, addCommandeZone, removeCommandeZone,
  getHiddenCommandeZones, hideCommandeZone,
  SUB_STAGES, WHATSAPP_MESSAGE_MAX, getWhatsappMessage, setWhatsappMessage,
} = require('./db');
const RESPONSABLE_SET = new Set(RESPONSABLES);
const CLIENT_TYPE_SET = new Set(CLIENT_TYPES);
const FLAG_SET = new Set(FLAGS);
const ORDER_KIND_SET = new Set(ORDER_KINDS);
```

par :

```js
const {
  pool, init, STAGES, STAGE_SLUGS, SUB_SLUGS, RESPONSABLES, CLIENT_TYPES, FLAGS,
  getCategoryOwners, setCategoryOwners,
  getCategoryReferents, setCategoryReferents,
  getMachines, setMachines,
  getCommandeZones, addCommandeZone, removeCommandeZone,
  getHiddenCommandeZones, hideCommandeZone,
  SUB_STAGES, WHATSAPP_MESSAGE_MAX, getWhatsappMessage, setWhatsappMessage,
} = require('./db');
const RESPONSABLE_SET = new Set(RESPONSABLES);
const CLIENT_TYPE_SET = new Set(CLIENT_TYPES);
const FLAG_SET = new Set(FLAGS);
```

Remplacer :

```js
const PATCHABLE = [
  'stage', 'sub_stage', 'order_kind', 'responsable', 'referent', 'priority', 'client_type', 'billing_company',
  'contact_referent', 'contact_phone', 'contact_email',
  'quantity', 'product', 'color', 'project_value', 'description', 'deadline', 'position',
  'flag', 'flag_reason',
];
```

par :

```js
const PATCHABLE = [
  'stage', 'sub_stage', 'responsable', 'referent', 'priority', 'client_type', 'billing_company',
  'contact_referent', 'contact_phone', 'contact_email',
  'quantity', 'product', 'color', 'project_value', 'description', 'deadline', 'position',
  'flag', 'flag_reason',
];
```

Remplacer :

```js
    case 'order_kind': {
      // Nature de la ligne : demande (à chiffrer) ou commande (validée). Vide =
      // on ne se prononce pas — la ligne reste neutre, pas de nature inventée.
      const s = String(value).trim();
      if (s === '') return { ok: true, value: null };
      if (!ORDER_KIND_SET.has(s)) return { ok: false, error: `order_kind invalide: ${s}` };
      return { ok: true, value: s };
    }
    case 'flag_reason': {
```

par :

```js
    case 'flag_reason': {
```

- [ ] **Step 4: `server.js` — retirer `COM_TYPE_BY_ID`**

Remplacer :

```js
const COM = CATALOG.commande;
const COM_TYPE_BY_ID = new Map(COM.types.map((t) => [t.id, t]));
const COM_ZONE_BY_ID = new Map(COM.zones.map((z) => [z.id, z]));
```

par :

```js
const COM = CATALOG.commande;
const COM_ZONE_BY_ID = new Map(COM.zones.map((z) => [z.id, z]));
```

- [ ] **Step 5: `server.js` — `buildDestination` sans nature, fallback fixe**

Remplacer :

```js
function buildDestination(b, type) {
  if (b.stage == null || b.stage === '') return { stage: type.stage, subStage: type.subStage };
  if (!STAGE_SLUGS.includes(b.stage)) return { error: `étape inconnue : ${b.stage}` };
```

par :

```js
function buildDestination(b) {
  if (b.stage == null || b.stage === '') return { stage: 'demande', subStage: null };
  if (!STAGE_SLUGS.includes(b.stage)) return { error: `étape inconnue : ${b.stage}` };
```

- [ ] **Step 6: `server.js` — `buildCommande` sans lookup de `type`**

Remplacer :

```js
function buildCommande(body) {
  const b = body && typeof body === 'object' ? body : {};

  const type = COM_TYPE_BY_ID.get(b.kind);
  if (!type) return { error: `nature inconnue : ${b.kind} (demande ou commande)` };

  // OÙ la fiche atterrit dans le planning. Le poste de saisie le demande
  // TOUJOURS avant d'enregistrer (« Où l'enregistrer ? ») ; la nature ne fait
  // plus que proposer la destination habituelle. Un corps sans destination
  // (ancien client, script) retombe donc sur celle du catalogue.
  const dest = buildDestination(b, type);
  if (dest.error) return { error: dest.error };
```

par :

```js
function buildCommande(body) {
  const b = body && typeof body === 'object' ? body : {};

  // OÙ la fiche atterrit dans le planning. Le poste de saisie le demande
  // TOUJOURS avant d'enregistrer (« Où l'enregistrer ? »). Un corps sans
  // destination (ancien client, script) retombe sur l'étape « demande ».
  const dest = buildDestination(b);
  if (dest.error) return { error: dest.error };
```

- [ ] **Step 7: `server.js` — retirer `type` de l'objet `commande` et du résumé**

Remplacer :

```js
  const commande = {
    kind: 'commande-atelier',        // discriminant : identifie ce JSON dans requests.fiche
    version: 2,                      // v1 = { articles } sans objet ni paiement
    type: { id: type.id, label: type.label },
    client,
```

par :

```js
  const commande = {
    kind: 'commande-atelier',        // discriminant : identifie ce JSON dans requests.fiche
    version: 2,                      // v1 = { articles } sans objet ni paiement
    client,
```

Remplacer :

```js
  const resume = [
    `${type.label.toUpperCase()} — ${client.societe}${client.type === 'perso' ? ' (perso)' : ''}`,
```

par :

```js
  const resume = [
    `DEMANDE — ${client.societe}${client.type === 'perso' ? ' (perso)' : ''}`,
```

- [ ] **Step 8: `server.js` — retirer `order_kind` de l'INSERT `/api/commande`**

Remplacer :

```js
  const { rows } = await pool.query(
    `INSERT INTO requests
       (stage, sub_stage, order_kind, priority, client_type, billing_company, contact_referent,
        contact_phone, contact_email, quantity, product, color, description, deadline,
        responsable, referent, position, fiche)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      commande.stage,
      commande.subStage,
      commande.type.id,
      commande.priority,
      commande.client.type,
      commande.client.societe,
      commande.client.contact,
      commande.client.telephone,
      commande.client.email,
      commande.quantite || null,      // demande simple : aucune pièce comptée
      produit,
      // Colonne « Coloris » : le premier renseigné, toutes familles confondues
      // (une demande simple, sans produit, la laisse vide).
      [...commande.tasses, ...commande.textiles].map((l) => l.couleur).find(Boolean) || null,
      resume,
      commande.deadline,
      commande.vendeuse,
      commande.referent,
      posRows[0].pos,
      JSON.stringify(commande),
    ],
  );
```

par :

```js
  const { rows } = await pool.query(
    `INSERT INTO requests
       (stage, sub_stage, priority, client_type, billing_company, contact_referent,
        contact_phone, contact_email, quantity, product, color, description, deadline,
        responsable, referent, position, fiche)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      commande.stage,
      commande.subStage,
      commande.priority,
      commande.client.type,
      commande.client.societe,
      commande.client.contact,
      commande.client.telephone,
      commande.client.email,
      commande.quantite || null,      // demande simple : aucune pièce comptée
      produit,
      // Colonne « Coloris » : le premier renseigné, toutes familles confondues
      // (une demande simple, sans produit, la laisse vide).
      [...commande.tasses, ...commande.textiles].map((l) => l.couleur).find(Boolean) || null,
      resume,
      commande.deadline,
      commande.vendeuse,
      commande.referent,
      posRows[0].pos,
      JSON.stringify(commande),
    ],
  );
```

- [ ] **Step 9: `catalog.json` — retirer `commande.types`**

Remplacer :

```json
{
  "commande": {
    "types": [
      { "id": "demande", "label": "Demande", "hint": "à chiffrer, devis à faire", "stage": "demande", "subStage": null },
      { "id": "commande", "label": "Commande", "hint": "validée par le client", "stage": "chiffrage", "subStage": "a_chiffrer" }
    ],
    "familles": [
```

par :

```json
{
  "commande": {
    "familles": [
```

- [ ] **Step 10: Lancer les tests modifiés au Task 1, vérifier qu'ils PASSENT (étape verte)**

Run: `node test/commande.test.js && node test/destination-whatsapp.test.js && node test/commande-zones.test.js && node test/clients.test.js`
Expected: les 4 fichiers affichent leur ligne `✓ ...` et le process se termine en code 0.

- [ ] **Step 11: Lancer la suite complète (aucune régression ailleurs)**

Run: `npm test`
Expected: tous les fichiers `test/*.test.js` passent.

- [ ] **Step 12: Commit**

```bash
git add schema.sql db.js server.js catalog.json
git commit -m "feat: supprime order_kind — fusion demande/commande côté backend"
```

---

### Task 3: Fusion des entrées de menu Demande/Commande (index.html, app.js, commande.js)

Une seule entrée de menu "Demande" reste visible ; `#commande` continue de fonctionner comme alias de routage (compat anciens liens) mais n'a plus de bouton dédié. La notion de "nature" (`state.kind`, `setNature`, `typeById`, `destHabituelle`) disparaît entièrement du wizard.

**Files:**
- Modify: `public/index.html:54-66`
- Modify: `public/app.js:3333-3334,3344-3346,3386-3401,3447-3463,3488-3501`
- Modify: `public/commande.js:1-14,47-59,65-66,740-744,1211-1226,1237-1303,1338-1352,1384-1389`

- [ ] **Step 1: `public/index.html` — retirer le bouton de menu "Commande"**

Remplacer :

```html
      <!-- Navigation de l'outil, désormais dans la barre du haut. Le hash de
           l'URL fait foi (voir applyHash dans app.js) : un seul pilote, donc pas
           de vue qui se contredit. Demande / Commande = le premier pas du client
           (deux entrées distinctes) ; Base clients (CRM) = le socle. -->
      <nav class="nav-switch" aria-label="Navigation">
        <a class="nav-switch-btn nav-switch-btn--intake" id="viewDemande" href="#demande">
          <span class="material-symbols-outlined" aria-hidden="true">help</span>
          <span class="nav-switch-label">Demande</span>
        </a>
        <a class="nav-switch-btn nav-switch-btn--intake" id="viewCommande" href="#commande">
          <span class="material-symbols-outlined" aria-hidden="true">task_alt</span>
          <span class="nav-switch-label">Commande</span>
        </a>
        <a class="nav-switch-btn" id="viewPlanning" href="#planning">
```

par :

```html
      <!-- Navigation de l'outil, désormais dans la barre du haut. Le hash de
           l'URL fait foi (voir applyHash dans app.js) : un seul pilote, donc pas
           de vue qui se contredit. Demande = le premier pas du client ; Base
           clients (CRM) = le socle. -->
      <nav class="nav-switch" aria-label="Navigation">
        <a class="nav-switch-btn nav-switch-btn--intake" id="viewDemande" href="#demande">
          <span class="material-symbols-outlined" aria-hidden="true">help</span>
          <span class="nav-switch-label">Demande</span>
        </a>
        <a class="nav-switch-btn" id="viewPlanning" href="#planning">
```

- [ ] **Step 2: `public/app.js` — retirer la référence DOM `$viewCommande` et la variable `commandeNature`**

Remplacer :

```js
const $viewCommande = document.getElementById('viewCommande');
const $viewDemande = document.getElementById('viewDemande');
```

par :

```js
const $viewDemande = document.getElementById('viewDemande');
```

Remplacer :

```js
// La vue « Prise de commande » sert DEUX entrées de menu (#demande / #commande) :
// la nature est décidée par le lien cliqué, pas par un réglage dans la fiche.
let commandeNature = 'demande';
let commandeModule = null;
```

par :

```js
let commandeModule = null;
```

- [ ] **Step 3: `public/app.js` — simplifier `mountCommande()`**

Remplacer :

```js
let commandeLoading = null;
function mountCommande() {
  if (!$commande) return;
  if (!commandeLoading) {
    commandeLoading = import('./commande.js')
      .then((m) => { commandeModule = m; return m.initCommande($commande); })
      .then(() => commandeModule.setNature(commandeNature))
      .catch((err) => {
        commandeLoading = null;             // rechargeable au prochain essai
        commandeModule = null;
        console.error('Prise de commande : chargement impossible', err);
      });
  } else if (commandeModule) {
    commandeModule.setNature(commandeNature);
  }
}
```

par :

```js
let commandeLoading = null;
function mountCommande() {
  if (!$commande || commandeLoading) return;
  commandeLoading = import('./commande.js')
    .then((m) => { commandeModule = m; return m.initCommande($commande); })
    .catch((err) => {
      commandeLoading = null;             // rechargeable au prochain essai
      commandeModule = null;
      console.error('Prise de commande : chargement impossible', err);
    });
}
```

- [ ] **Step 4: `public/app.js` — `setViewMode()` : une seule entrée à allumer**

Remplacer :

```js
  // Les deux entrées de saisie s'allument selon la NATURE courante, pas juste
  // selon la vue : sur #commande c'est « Commande », sur #demande « Demande ».
  const onIntake = mode === 'commande';
  if ($viewDemande) $viewDemande.classList.toggle('active', onIntake && commandeNature === 'demande');
  if ($viewCommande) $viewCommande.classList.toggle('active', onIntake && commandeNature === 'commande');
```

par :

```js
  if ($viewDemande) $viewDemande.classList.toggle('active', mode === 'commande');
```

- [ ] **Step 5: `public/app.js` — `applyHash()` : retirer la gestion de nature**

Remplacer :

```js
// #demande et #commande ouvrent la MÊME vue, avec une nature différente.
const VIEWS = {
  '#dashboard': 'dashboard', '#demande': 'commande', '#commande': 'commande',
  '#clients': 'clients', '#reglages': 'reglages',
  ...Object.fromEntries(PROMOTED.map((p) => [p.hash, p.view])),
};
function applyHash() {
  const h = location.hash;
  const mode = VIEWS[h] || 'planning';
  if (mode === 'commande') commandeNature = h === '#commande' ? 'commande' : 'demande';
  setViewMode(mode);
  // Changer de nature SANS changer de vue (#demande ↔ #commande) : setViewMode a
  // pris le raccourci « même vue », on pousse donc la nature à la main.
  if (mode === 'commande' && commandeModule) commandeModule.setNature(commandeNature);
```

par :

```js
// #demande et #commande ouvrent la MÊME vue (#commande reste un alias de
// routage pour les anciens liens ; le menu n'affiche plus qu'une entrée).
const VIEWS = {
  '#dashboard': 'dashboard', '#demande': 'commande', '#commande': 'commande',
  '#clients': 'clients', '#reglages': 'reglages',
  ...Object.fromEntries(PROMOTED.map((p) => [p.hash, p.view])),
};
function applyHash() {
  const h = location.hash;
  const mode = VIEWS[h] || 'planning';
  setViewMode(mode);
```

- [ ] **Step 6: `public/commande.js` — mettre à jour le commentaire d'en-tête**

Remplacer :

```js
// La NATURE (demande / commande) vient de l'entrée de menu cliquée, poussée par
// app.js via setNature() — il n'y a pas de réglage de nature dans la fiche.
//   - Demande  → planning, colonne « Demande » (à chiffrer).
//   - Commande → planning, colonne « Commande » (validée par le client).
//
// Chargé À LA DEMANDE par app.js au premier passage sur la vue ; ensuite la
```

par :

```js
// Il n'existe plus qu'une seule nature de fiche : Demande. La destination dans
// le planning se choisit à la dernière étape (openDestinations), jamais devinée.
//
// Chargé À LA DEMANDE par app.js au premier passage sur la vue ; ensuite la
```

- [ ] **Step 7: `public/commande.js` — retirer `state.kind` et `typeById`**

Remplacer :

```js
const state = {
  kind: 'demande',
  client: { type: 'pro', facturation: '', contact: '', whatsapp: '', email: '', prenom: '', nom: '' },
```

par :

```js
const state = {
  client: { type: 'pro', facturation: '', contact: '', whatsapp: '', email: '', prenom: '', nom: '' },
```

Remplacer :

```js
const zoneById = (id) => CAT.zones.find((z) => z.id === id);
const typeById = (id) => CAT.types.find((t) => t.id === id);
const delaiById = (id) => CAT.delais.find((d) => d.id === id);
```

par :

```js
const zoneById = (id) => CAT.zones.find((z) => z.id === id);
const delaiById = (id) => CAT.delais.find((d) => d.id === id);
```

- [ ] **Step 8: `public/commande.js` — `render()` sans titre/sous-titre dynamiques**

Remplacer :

```js
function render() {
  const t = typeById(state.kind);
  $('#cmd-title').textContent = t.label;
  $('#cmd-sub').textContent = t.hint;

  // Contact : pro ou perso, jamais les deux.
```

par :

```js
function render() {
  // Contact : pro ou perso, jamais les deux.
```

- [ ] **Step 9: `public/commande.js` — `payload()` sans `kind`**

Remplacer :

```js
  return {
    kind: state.kind,
    // Où la fiche atterrit : choisi à la main juste avant l'envoi (voir
```

par :

```js
  return {
    // Où la fiche atterrit : choisi à la main juste avant l'envoi (voir
```

- [ ] **Step 10: `public/commande.js` — écran de destination sans "habituel"**

Remplacer :

```js
// La destination habituelle d'une nature, telle que le catalogue la définit
// (Demande → Demande · Commande → Commande / À chiffrer).
function destHabituelle() {
  const t = typeById(state.kind);
  return t ? { stage: t.stage, sub: t.subStage || null } : null;
}

const memeDest = (a, b) => !!a && !!b && a.stage === b.stage && a.sub === b.sub;

// « Préparation · À commander » — la destination écrite en clair.
function destLabel(stage, sub) {
  const fam = (CAT.pipeline || []).find((f) => f.slug === stage);
  if (!fam) return 'au planning';
  const s = sub && (fam.subs || []).find((x) => x.slug === sub);
  return s ? `${fam.label} · ${s.label}` : fam.label;
}

// Une carte par famille : son grand titre enregistre dans la famille « à
// préciser », ses puces dans la sous-étape correspondante.
function destCarte(fam, habituelle) {
  const carte = el('div', 'cmd-dest__fam');
  const tete = el('button', 'cmd-dest__opt', fam.label);
  tete.type = 'button';
  tete.dataset.stage = fam.slug;
  if (memeDest({ stage: fam.slug, sub: null }, habituelle)) {
    tete.classList.add('is-habituel');
    tete.appendChild(el('span', 'cmd-dest__tag', 'habituel'));
  }
  carte.appendChild(tete);

  if (fam.subs && fam.subs.length) {
    const puces = el('div', 'cmd-dest__subs');
    for (const s of fam.subs) {
      const b = el('button', 'cmd-dest__sub', s.label);
      b.type = 'button';
      b.dataset.stage = fam.slug;
      b.dataset.sub = s.slug;
      if (memeDest({ stage: fam.slug, sub: s.slug }, habituelle)) {
        b.classList.add('is-habituel');
        b.appendChild(el('span', 'cmd-dest__tag', 'habituel'));
      }
      puces.appendChild(b);
    }
    carte.appendChild(puces);
  }
  return carte;
}

function openDestinations() {
  const habituelle = destHabituelle();
  const t = typeById(state.kind);
  // La famille qui porte la destination habituelle passe en tête : au comptoir,
  // c'est celle qu'on tape neuf fois sur dix.
  const pipeline = [...(CAT.pipeline || [])].sort((a, b) => (
    Number(b.slug === (habituelle && habituelle.stage)) - Number(a.slug === (habituelle && habituelle.stage))
  ));
  $('#cmd-dest-title').textContent = `Où enregistrer cette ${t ? t.label.toLowerCase() : 'fiche'} ?`;
  const lignes = toutesLignes();
  $('#cmd-dest-sub').textContent = [
    nomClient(),
    lignes.length ? `${lignes.length} ligne${lignes.length > 1 ? 's' : ''}` : state.objet.trim(),
  ].filter(Boolean).join(' · ');
  $('#cmd-dest-list').replaceChildren(...pipeline.map((f) => destCarte(f, habituelle)));
  $('#cmd-dest').hidden = false;
  const premier = $('#cmd-dest-list .cmd-dest__opt');
  if (premier) premier.focus();
}
```

par :

```js
// « Préparation · À commander » — la destination écrite en clair.
function destLabel(stage, sub) {
  const fam = (CAT.pipeline || []).find((f) => f.slug === stage);
  if (!fam) return 'au planning';
  const s = sub && (fam.subs || []).find((x) => x.slug === sub);
  return s ? `${fam.label} · ${s.label}` : fam.label;
}

// Une carte par famille : son grand titre enregistre dans la famille « à
// préciser », ses puces dans la sous-étape correspondante.
function destCarte(fam) {
  const carte = el('div', 'cmd-dest__fam');
  const tete = el('button', 'cmd-dest__opt', fam.label);
  tete.type = 'button';
  tete.dataset.stage = fam.slug;
  carte.appendChild(tete);

  if (fam.subs && fam.subs.length) {
    const puces = el('div', 'cmd-dest__subs');
    for (const s of fam.subs) {
      const b = el('button', 'cmd-dest__sub', s.label);
      b.type = 'button';
      b.dataset.stage = fam.slug;
      b.dataset.sub = s.slug;
      puces.appendChild(b);
    }
    carte.appendChild(puces);
  }
  return carte;
}

function openDestinations() {
  $('#cmd-dest-title').textContent = 'Où enregistrer cette demande ?';
  const lignes = toutesLignes();
  $('#cmd-dest-sub').textContent = [
    nomClient(),
    lignes.length ? `${lignes.length} ligne${lignes.length > 1 ? 's' : ''}` : state.objet.trim(),
  ].filter(Boolean).join(' · ');
  $('#cmd-dest-list').replaceChildren(...(CAT.pipeline || []).map((f) => destCarte(f)));
  $('#cmd-dest').hidden = false;
  const premier = $('#cmd-dest-list .cmd-dest__opt');
  if (premier) premier.focus();
}
```

- [ ] **Step 11: `public/commande.js` — `showDone()` sans `c.type`**

Remplacer :

```js
  $('#cmd-done-title').textContent = `${c.type.label} enregistrée`;
```

par :

```js
  $('#cmd-done-title').textContent = 'Demande enregistrée';
```

- [ ] **Step 12: `public/commande.js` — retirer `setNature()` et le commentaire de `reset()`**

Remplacer :

```js
// Remet la fiche à zéro sans recharger la page. La nature reste celle de
// l'entrée de menu : on enchaîne souvent plusieurs saisies du même type.
function reset() {
```

par :

```js
// Remet la fiche à zéro sans recharger la page : le comptoir enchaîne souvent
// plusieurs saisies à la suite.
function reset() {
```

Remplacer :

```js
// Nature poussée par app.js selon l'entrée de menu (#demande / #commande).
export function setNature(kind) {
  if (kind !== 'demande' && kind !== 'commande') return;
  state.kind = kind;
  if (ROOT) render();
}

// Montage unique, déclenché par app.js au premier affichage de la vue.
```

par :

```js
// Montage unique, déclenché par app.js au premier affichage de la vue.
```

- [ ] **Step 13: Vérification manuelle (aucun test automatisé n'existe pour ce câblage de navigation/UI dans ce projet)**

Démarrer le serveur de preview, puis dans le navigateur :
1. La barre de navigation n'affiche qu'une seule entrée "Demande" (plus de "Commande").
2. Cliquer "Demande" ouvre le wizard ; remplir une fiche minimale (objet + client) et cliquer "Enregistrer" : l'écran "Où enregistrer cette demande ?" s'affiche toujours, titre fixe, familles dans l'ordre du catalogue, sans étiquette "habituel".
3. Choisir une destination : la fiche s'enregistre, l'écran de confirmation affiche "Demande enregistrée".
4. Naviguer manuellement vers `#commande` dans l'URL : la même vue s'ouvre (alias toujours actif), sans bouton dédié dans le menu.
5. Console navigateur sans erreur JS.

- [ ] **Step 14: Commit**

```bash
git add public/index.html public/app.js public/commande.js
git commit -m "feat: fusionne les entrées de menu Demande/Commande en une seule"
```

---

### Task 4: Ajout rapide dans la grille — choix d'étape obligatoire

Le bouton `+` de la grille crée aujourd'hui une ligne silencieusement dans l'étape de la vue courante. Il doit désormais ouvrir un menu ancré (familles, puis sous-étapes) et n'envoyer la création qu'une fois l'étape choisie.

**Files:**
- Modify: `public/app.js:2104-2199`

- [ ] **Step 1: Remplacer `makeOptimisticRow()`, `createForCurrentView()` et l'écouteur du bouton `+`**

Remplacer :

```js
// Construit une ligne brouillon optimiste (tous champs vides) pour l'étape
// courante.
function makeOptimisticRow() {
  const maxPos = rows.reduce((m, r) => Math.max(m, r.position ?? 0), 0);
  const now = new Date().toISOString();
  return {
    id: `tmp-${++tmpSeq}`,
    stage: currentStage,
    // Créée depuis une sous-catégorie → elle en hérite (sinon la ligne
    // n'apparaîtrait pas dans la vue filtrée où on vient de la créer).
    sub_stage: currentSub, responsable: null, referent: null,
    order_kind: null,
    flag: null, flag_reason: null,
    priority: 1, client_type: 'pro',
    billing_company: null, contact_referent: null, contact_phone: null, contact_email: null,
    quantity: null, product: null, color: null, project_value: null,
    description: null, deadline: null,
    position: maxPos + 1000,
    devis_name: null, bat_name: null, facture_name: null,
    created_at: now, updated_at: now,
  };
}
```

par :

```js
// Construit une ligne brouillon optimiste (tous champs vides) pour l'étape
// choisie.
function makeOptimisticRow(stage, sub) {
  const maxPos = rows.reduce((m, r) => Math.max(m, r.position ?? 0), 0);
  const now = new Date().toISOString();
  return {
    id: `tmp-${++tmpSeq}`,
    stage,
    sub_stage: sub, responsable: null, referent: null,
    flag: null, flag_reason: null,
    priority: 1, client_type: 'pro',
    billing_company: null, contact_referent: null, contact_phone: null, contact_email: null,
    quantity: null, product: null, color: null, project_value: null,
    description: null, deadline: null,
    position: maxPos + 1000,
    devis_name: null, bat_name: null, facture_name: null,
    created_at: now, updated_at: now,
  };
}
```

Puis remplacer :

```js
// Crée une commande adaptée à la vue courante, en optimiste : la ligne brouillon
// apparaît et reçoit le focus immédiatement, le POST suit en arrière-plan.
function createForCurrentView() {
  const r = makeOptimisticRow();
  const tmpId = r.id;
  const viewSlug = currentStage; // figé : la vue peut changer avant la réponse
  const viewSub = currentSub;    // sous-catégorie éventuelle, figée de même
  rows.push(r);
  pendingCreates.set(tmpId, { patch: {} });
  applySortAndRender();
  bumpCount(viewSlug, +1);

  const tr = $rows.querySelector(`tr[data-id="${tmpId}"]`);
  if (tr) {
    tr.scrollIntoView({ block: 'nearest' });
    const firstInput = tr.querySelector('.client-company, .cell-input');
    if (firstInput) firstInput.focus();
  }

  api('POST', '/api/requests', viewSub ? { stage: viewSlug, sub_stage: viewSub } : { stage: viewSlug })
    .then((created) => finalizeCreate(tmpId, created))
    .catch((err) => {
      pendingCreates.delete(tmpId);
      cancelledCreates.delete(tmpId);
      rows = rows.filter((x) => x.id !== tmpId);
      applySortAndRender();
      bumpCount(viewSlug, -1);
      reportError(err);
      loadCounts().catch(() => {}); // valeur exacte (un loadCounts concurrent a pu déjà corriger)
    });
}

$btnNew.addEventListener('click', () => createForCurrentView());
```

par :

```js
// Demande l'étape de destination avant de créer une ligne : un menu ancré sur
// le bouton « + » liste les familles (Fiverr compris), puis leurs sous-étapes
// le cas échéant. Annuler (Échap / clic dehors) ne crée rien — jamais de stage
// par défaut muet.
function openNewRowPicker() {
  const items = STAGES.map((s) => ({ value: s.slug, label: s.label }));
  openMenu($btnNew, items, null, (stage) => {
    if (familyHasSub(stage)) {
      const subItems = SUB_STAGES[stage].map((s) => ({ value: s.slug, label: s.label }));
      openMenu($btnNew, subItems, null, (sub) => createRowAt(stage, sub));
    } else {
      createRowAt(stage, null);
    }
  });
}

// Crée une commande à l'étape choisie, en optimiste si elle relève de la vue
// affichée (ligne visible + focus immédiat) ; sinon seul le compteur bouge, le
// SSE réconciliera les autres postes (même logique que duplicateRow).
function createRowAt(stage, sub) {
  const r = makeOptimisticRow(stage, sub);
  const tmpId = r.id;
  const body = sub ? { stage, sub_stage: sub } : { stage };

  if (!belongsToCurrentView(r)) {
    bumpCount(stage, +1);
    api('POST', '/api/requests', body).catch((err) => {
      bumpCount(stage, -1);
      reportError(err);
      loadCounts().catch(() => {});
    });
    return;
  }

  rows.push(r);
  pendingCreates.set(tmpId, { patch: {} });
  applySortAndRender();
  bumpCount(stage, +1);

  const tr = $rows.querySelector(`tr[data-id="${tmpId}"]`);
  if (tr) {
    tr.scrollIntoView({ block: 'nearest' });
    const firstInput = tr.querySelector('.client-company, .cell-input');
    if (firstInput) firstInput.focus();
  }

  api('POST', '/api/requests', body)
    .then((created) => finalizeCreate(tmpId, created))
    .catch((err) => {
      pendingCreates.delete(tmpId);
      cancelledCreates.delete(tmpId);
      rows = rows.filter((x) => x.id !== tmpId);
      applySortAndRender();
      bumpCount(stage, -1);
      reportError(err);
      loadCounts().catch(() => {});
    });
}

$btnNew.addEventListener('click', () => openNewRowPicker());
```

- [ ] **Step 2: Vérification manuelle (aucun test automatisé n'existe pour le glisser-déposer / les menus ancrés de la grille — même précédent que `duplicateRow`/`copyToStage`)**

Démarrer le serveur de preview, puis dans le navigateur, sur `#planning` :
1. Cliquer `+` : un menu liste les 8 familles + Fiverr, ancré sous le bouton.
2. Choisir "Production" (a des sous-étapes) : un second menu liste ses sous-étapes ; en choisir une → une ligne apparaît (si la vue affichée est Production/cette sous-étape) ou le compteur de Production s'incrémente (sinon), aucune erreur console.
3. Choisir "Demande" (pas de sous-étape) : la ligne est créée directement, focus sur le premier champ.
4. Cliquer `+` puis Échap : le menu se ferme, **aucune** ligne n'est créée (vérifier dans l'onglet Réseau : pas de `POST /api/requests`).
5. Cliquer `+` puis cliquer en dehors du menu : même résultat qu'Échap.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: l'ajout rapide dans la grille demande l'étape avant de créer"
```

---

### Task 5: Nettoyage du badge de nature (app.js + styles.css)

Le badge "Demande"/"Commande" sur les cartes, et le champ `order_kind` résiduel dans `copyBody()`, n'ont plus de raison d'être (la colonne a disparu côté serveur — Task 2).

**Files:**
- Modify: `public/app.js:1293-1305,2238-2242`
- Modify: `public/styles.css:1219-1231`

- [ ] **Step 1: `public/app.js` — retirer le rendu du badge**

Remplacer :

```js
  stack.appendChild(line);
  // Nature tranchée à la prise : DEMANDE (à chiffrer) ou COMMANDE (validée).
  // Les lignes créées à la main dans la grille n'en portent pas — on n'invente
  // pas la nature à la place de la personne qui saisit.
  if (r.order_kind === 'demande' || r.order_kind === 'commande') {
    const kind = document.createElement('span');
    kind.className = `kind-badge kind-badge--${r.order_kind}`;
    kind.textContent = r.order_kind === 'demande' ? 'Demande' : 'Commande';
    attachTip(kind, r.order_kind === 'demande'
      ? 'Demande reçue : reste à chiffrer'
      : 'Commande validée par le client');
    stack.appendChild(kind);
  }
  td.appendChild(stack);
  return td;
}
```

par :

```js
  stack.appendChild(line);
  td.appendChild(stack);
  return td;
}
```

- [ ] **Step 2: `public/app.js` — retirer `order_kind` de `copyBody()`**

Remplacer :

```js
    // On ne transporte la sous-étape que si la commande reste dans sa famille
    // (une copie « Envoyer vers … » change de famille → sous-étape repartie à zéro).
    sub_stage: (!stage || stage === r.stage) ? (r.sub_stage ?? null) : null,
    // La nature (demande / commande) est une propriété du dossier, pas de sa
    // place dans le flux : une copie la garde, où qu'on l'envoie.
    order_kind: r.order_kind ?? null,
    responsable: r.responsable ?? null,
```

par :

```js
    // On ne transporte la sous-étape que si la commande reste dans sa famille
    // (une copie « Envoyer vers … » change de famille → sous-étape repartie à zéro).
    sub_stage: (!stage || stage === r.stage) ? (r.sub_stage ?? null) : null,
    responsable: r.responsable ?? null,
```

- [ ] **Step 3: `public/styles.css` — retirer les règles `.kind-badge`**

Remplacer :

```css
.pdf-slot:hover .pdf-btn__remove { display: inline-flex; }

/* Nature posée à la prise de commande : DEMANDE (à chiffrer) ou COMMANDE
   (validée par le client). Purement informatif sur la ligne — l'étape du
   pipeline reste ce qui pilote le travail. */
.kind-badge {
  align-self: flex-start;
  margin: 0 0 0 14px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  white-space: nowrap;
}
.kind-badge--demande { background: var(--st-demande-bg); color: var(--st-demande); }
.kind-badge--commande { background: var(--st-livree-bg); color: var(--st-livree); }

/* Type Pro / Perso : pastille */
.type-tag {
```

par :

```css
.pdf-slot:hover .pdf-btn__remove { display: inline-flex; }

/* Type Pro / Perso : pastille */
.type-tag {
```

- [ ] **Step 4: Vérification**

Run: `grep -rn "order_kind\|kind-badge" public/ server.js db.js schema.sql catalog.json`
Expected: aucun résultat.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/styles.css
git commit -m "chore: retire le badge de nature et order_kind résiduel côté client"
```

---

### Task 6: Documentation (README.md)

Trois passages du README décrivent le comportement disparu (deux entrées de menu avec nature, `order_kind`, destination "habituelle").

**Files:**
- Modify: `README.md:189-204,315-321,407-417`

- [ ] **Step 1: Section "Prise de commande" — retirer la nature et l'"habituel"**

Remplacer :

```markdown
Deux entrées **en tête du menu**, l'une pour une *Demande* (à chiffrer), l'autre
pour une *Commande* (déjà validée par le client). Elles ouvrent la **même fiche**
— la nature est décidée par le lien cliqué, pas par un réglage dans l'écran.

La nature est conservée dans `requests.order_kind` et rappelée par un badge sur
la ligne du planning. La fiche se lit dans l'ordre où ça se dit.

### La dernière question : où l'enregistrer ?

« Enregistrer » n'envoie rien tout seul : il **demande d'abord où la fiche
atterrit**, à chaque saisie. Tout le pipeline s'affiche (familles + sous-étapes,
Fiverr compris) ; la destination habituelle de la nature choisie — Demande →
*Demande*, Commande → *Commande · À chiffrer* — est marquée **habituel** et
placée en tête. **Taper une destination enregistre aussitôt** : un seul geste,
comme le reste de la fiche, mais un geste conscient. L'écran de confirmation
redit où la commande est partie.
```

par :

```markdown
Une seule entrée **en tête du menu**, *Demande* : il n'existe plus qu'un seul
type de fiche, quel que soit l'état d'avancement du projet. La fiche se lit
dans l'ordre où ça se dit.

### La dernière question : où l'enregistrer ?

« Enregistrer » n'envoie rien tout seul : il **demande d'abord où la fiche
atterrit**, à chaque saisie — wizard comme ajout rapide dans la grille. Tout le
pipeline s'affiche (familles + sous-étapes, Fiverr compris). **Taper une
destination enregistre aussitôt** : un seul geste, comme le reste de la fiche,
mais un geste conscient. L'écran de confirmation redit où la commande est
partie.
```

- [ ] **Step 2: Section "Navigation" — retirer la mention de `setNature`**

Remplacer :

```markdown
`#demande` et `#commande` ouvrent la même vue de saisie, seule la nature diffère
(poussée au module par `setNature`) — d'où deux liens distincts en tête du menu.
```

par :

```markdown
`#demande` et `#commande` ouvrent la même vue de saisie — `#commande` reste un
alias de routage pour les anciens liens, mais le menu n'affiche plus qu'une
entrée, « Demande ».
```

- [ ] **Step 3: Section "Modèle de données" — retirer `order_kind`**

Remplacer :

```markdown
`id` (uuid), `stage` (slug de la FAMILLE, 8 valeurs + `fiverr`), `sub_stage`
(slug de la SOUS-FAMILLE ou null), `order_kind` (nature posée à la prise :
`demande` / `commande` / null pour une ligne créée à la main), `responsable`
```

par :

```markdown
`id` (uuid), `stage` (slug de la FAMILLE, 8 valeurs + `fiverr`), `sub_stage`
(slug de la SOUS-FAMILLE ou null), `responsable`
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: met à jour le README pour la fusion demande/commande"
```

---

### Task 7: Vérification finale complète

- [ ] **Step 1: Suite de tests complète**

Run: `npm test`
Expected: tous les fichiers `test/*.test.js` passent (code de sortie 0 pour chacun).

- [ ] **Step 2: Recherche de résidus**

Run: `grep -rn "order_kind\|ORDER_KIND\|setNature\|typeById\|destHabituelle\|commandeNature\|kind-badge" --include="*.js" --include="*.html" --include="*.json" --include="*.css" . --exclude-dir=node_modules --exclude-dir=docs`
Expected: aucun résultat (hors `public/clients.js` où `setNature`/`dataset.nature` désignent la nature pro/perso du CLIENT — fonction distincte, sans rapport, à ne pas toucher).

- [ ] **Step 3: Vérification visuelle bout en bout dans le navigateur**

Démarrer le serveur de preview (`mcp__Claude_Browser__preview_start` avec la config `olda` de `.claude/launch.json`), puis :
1. Menu : une seule entrée "Demande".
2. Créer une fiche complète via le wizard (client + un produit) → écran "Où enregistrer cette demande ?" → choisir une famille avec sous-étapes → confirmation "Demande enregistrée" → la ligne apparaît dans le planning à la bonne étape, sans badge de nature.
3. Ajout rapide (`+`) dans la grille → menu de familles → ligne créée à l'étape choisie.
4. Dupliquer une ligne existante → la copie atterrit dans la même étape que l'originale, sans prompt.
5. Aucune erreur dans la console navigateur sur l'ensemble du parcours.

- [ ] **Step 4: Rapport final**

Résumer dans le chat : tests verts, résidus recherchés, parcours vérifié en navigateur, prêt pour revue/merge.
