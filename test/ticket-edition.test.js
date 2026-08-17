'use strict';

// LE TICKET SE CORRIGE SUR LA LIGNE
//
// Le ticket s'affichait, et il n'y avait rien à en faire d'autre que
// l'imprimer. Or c'est le papier qu'on a sous les yeux quand le client
// rappelle : un numéro faux, une précision à ajouter — et surtout une consigne
// à laisser à l'atelier. Il fallait fermer l'aperçu, ouvrir la fiche, dérouler
// le récapitulatif, retrouver la bonne ligne, enregistrer.
//
// Ce fichier vérifie, là où elles vivent :
//   1. LE MODÈLE SAIT OÙ CHAQUE VALEUR S'ÉCRIT — colonne de la ligne, clé de la
//      fiche, ou POSITION dans le récapitulatif figé du comptoir.
//   2. LE CADRE « POUR L'ATELIER » — ce qu'il porte, et ce qu'il ne porte pas.
//   3. LE PAPIER NE SORT AUCUN CHAMP : l'impression n'appelle pas l'éditeur.
//   4. LE SERVEUR enregistre la consigne et le numéro du papier — et refuse de
//      laisser retaper la RÉFÉRENCE, qui est la clé du dossier.
//   5. L'ÉCRITURE PAR POSITION : deux corrections sur deux articles du même
//      dossier ne s'effacent pas l'une l'autre.
//   6. LA CONSIGNE VOYAGE DANS LA LISTE, et laisse une ligne d'historique.
//   7. LE BRANCHEMENT DANS L'ÉCRAN.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

const SRC = lire('ticket.js');
const bac = {};
vm.createContext(bac);
vm.runInContext(
  `${SRC.replace(/^export\s+/gm, '')}
   globalThis.modeleTicket = modeleTicket;
   globalThis.ticketTexte = ticketTexte;
   globalThis.dessinerTicket = dessinerTicket;`,
  bac,
);
const { modeleTicket, ticketTexte, dessinerTicket } = bac;

// Une vente du comptoir : deux articles, dans la forme exacte que produit
// `saleRecapLines()` de public/comptoir/vente-directe.html. Les indices comptent
// — c'est par eux que le ticket corrigé retrouve sa ligne.
const DETAILS = [
  { k: 'Type de client', v: 'Professionnel' },
  { k: 'Article 1 — Désignation', v: 'Polo brodé' },
  { k: 'Article 1 — Quantité', v: '2' },
  { k: 'Article 1 — Total TTC', v: '126,40 €' },
  { k: 'Article 1 — Description de production', v: 'Broderie poitrine' },
  { k: 'Article 2 — Désignation', v: 'Tasse' },
  { k: 'Article 2 — Quantité', v: '1' },
  { k: 'Article 2 — Total TTC', v: '22,10 €' },
  { k: 'Article 2 — Description de production', v: 'Logo une face' },
  { k: 'Note interne OLDA', v: 'Client difficile, encaisser d’avance' },
];

const VENTE = {
  id: 'v1',
  order_kind: 'commande',
  billing_company: 'Coco Beach',
  contact_phone: '0690 66 24 00',
  project_value: 148.5,
  deadline: '2026-08-07',
  paye: false,
  fiche: {
    kind: 'comptoir-v17',
    source: 'Vente directe',
    ref: '26.08.06-003',
    creeLe: '2026-08-06T18:00:00.000Z',
    heureSouhaitee: '16:30',
    details: DETAILS,
  },
};

(async () => {
  // =========================================================================
  // 1. LE MODÈLE SAIT OÙ CHAQUE VALEUR S'ÉCRIT
  // =========================================================================
  const t = modeleTicket(VENTE);

  // Le récapitulatif du comptoir se corrige par POSITION (les libellés viennent
  // du parcours et ne se réécrivent pas) : chaque valeur du ticket porte donc
  // l'indice de SA ligne dans `fiche.details`. Un indice faux corrigerait la
  // quantité d'un article en croyant corriger celle de l'autre.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(t.lignes[0].ou)), {
    designation: { ou: 'details', i: 1 },
    qte: { ou: 'details', i: 2 },
    detail: { ou: 'details', i: 4 },
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(t.lignes[1].ou)), {
    designation: { ou: 'details', i: 5 },
    qte: { ou: 'details', i: 6 },
    detail: { ou: 'details', i: 8 },
  });
  // L'indice pointe bien sur la ligne dont on lit la valeur.
  for (const a of t.lignes) {
    assert.strictEqual(DETAILS[a.ou.designation.i].v, a.designation);
    assert.strictEqual(DETAILS[a.ou.detail.i].v, a.detail);
  }

  // UNE LIGNE MANQUANTE NE DÉCALE RIEN. Un dossier ancien n'a pas toujours
  // toutes les lignes d'un article : les postes se regroupent par NUMÉRO, et
  // l'article suivant garde ses propres indices.
  const troue = modeleTicket({
    ...VENTE,
    fiche: {
      ...VENTE.fiche,
      details: [
        { k: 'Article 1 — Désignation', v: 'Bâche' },
        { k: 'Article 2 — Désignation', v: 'Panneau' },
        { k: 'Article 2 — Quantité', v: '4' },
      ],
    },
  });
  assert.strictEqual(troue.lignes[0].ou.qte, null, 'pas de ligne « Quantité » : rien à corriger');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(troue.lignes[1].ou.qte)), { ou: 'details', i: 2 });

  // UNE LIGNE SAISIE À LA MAIN n'a pas de récapitulatif : sa désignation et sa
  // quantité sont des COLONNES, sa production une clé de la fiche. Le ticket
  // d'un dossier créé dans la grille se corrige donc lui aussi.
  const main = modeleTicket({
    id: 'm1', product: 'Bâche 2 m', quantity: 3, project_value: 60,
    fiche: { ref: 'X-1', production: 'Impression UV' },
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(main.lignes[0].ou)), {
    designation: { ou: 'ligne', col: 'product' },
    qte: { ou: 'ligne', col: 'quantity' },
    detail: { ou: 'fiche', cle: 'production' },
  });

  // LE DÉTAIL D'UN BESOIN DE DEVIS résume trois champs (catégorie, couleur,
  // production) : il ne se réécrit pas d'un bloc, et le ticket n'offre donc pas
  // un champ qui n'enregistrerait rien.
  const devis = modeleTicket({
    id: 'd1', order_kind: 'demande', project_value: null,
    fiche: {
      kind: 'comptoir-v17', source: 'Demande de devis', ref: 'DEV-1',
      details: [
        { k: 'Besoin 1 — Désignation', v: 'Panneau dibond' },
        { k: 'Besoin 1 — Quantité', v: '40' },
        { k: 'Besoin 1 — Couleur', v: 'Blanc' },
      ],
    },
  });
  assert.strictEqual(devis.lignes[0].ou.detail, null);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(devis.lignes[0].ou.designation)), { ou: 'details', i: 0 });

  console.log('✓ ticket modifiable : chaque valeur sait où elle se réécrit');

  // =========================================================================
  // 2. LE CADRE « POUR L'ATELIER »
  // =========================================================================
  // Il ne vient PAS du comptoir : ni la note interne (« client difficile »), ni
  // les points à contrôler ne le remplissent — ceux-là restent au dossier de
  // travail. C'est ce qu'un collègue écrit pour celui qui va produire.
  assert.strictEqual(t.atelier, '', 'aucune consigne tant que personne n’en a écrit');
  assert.ok(!ticketTexte(t).includes("POUR L'ATELIER"));
  assert.ok(!ticketTexte(t).includes('Client difficile'), 'la note interne ne passe jamais sur le papier');

  const avecConsigne = modeleTicket({
    ...VENTE,
    fiche: { ...VENTE.fiche, atelier: 'Logo poitrine gauche 8 cm — appeler avant de couper' },
  });
  const papier = ticketTexte(avecConsigne);
  assert.ok(papier.includes("POUR L'ATELIER"));
  assert.ok(papier.includes('Logo poitrine gauche 8 cm — appeler avant de couper'));
  // Elle se lit APRÈS le travail : d'abord ce qu'on produit, puis ce qu'il faut
  // savoir pour le produire — et sans jamais retourner le papier.
  assert.ok(papier.indexOf('Polo brodé') < papier.indexOf("POUR L'ATELIER"));
  assert.ok(papier.indexOf("POUR L'ATELIER") < papier.indexOf("L'équipe Atelier OLDA"));
  // Et elle n'a pas fait disparaître le reste au passage.
  assert.ok(papier.includes('Polo brodé') && papier.includes('Broderie poitrine'));

  console.log('✓ ticket modifiable : la consigne atelier s’imprime, la note interne jamais');

  // =========================================================================
  // 3. LE PAPIER NE SORT AUCUN CHAMP
  // =========================================================================
  // Le MÊME dessin sert l'aperçu et l'imprimante — c'est ce qui garantit qu'on
  // corrige le ticket qui sortira. L'impression, elle, n'appelle jamais
  // l'éditeur : un papier d'atelier ne porte pas de cases à remplir.
  const faireDoc = () => ({
    createElement: (tag) => ({
      tag, className: '', textContent: '', enfants: [],
      append(...n) { this.enfants.push(...n); },
      appendChild(n) { this.enfants.push(n); return n; },
      setAttribute() {},
    }),
  });
  const balises = (n, acc = []) => {
    acc.push(n.tag);
    for (const c of n.enfants) balises(c, acc);
    return acc;
  };
  const texteDe = (n) => [n.textContent || '', ...n.enfants.map(texteDe)].join('');

  const surPapier = dessinerTicket(avecConsigne, faireDoc());
  const balisesPapier = balises(surPapier);
  for (const interdite of ['input', 'textarea', 'select']) {
    assert.ok(!balisesPapier.includes(interdite), `le papier ne doit porter aucun ${interdite}`);
  }
  assert.ok(texteDe(surPapier).includes("Pour l'atelier"));
  // On ne remet aucun ticket au client : la ligne « Ticket remis au client »
  // n'existe plus, ni sur le papier ni en correction.
  assert.ok(!texteDe(surPapier).includes('remis au client'));

  // Avec l'éditeur, TOUTES les valeurs corrigeables deviennent des champs — y
  // compris celles qui sont vides (le numéro du papier, la consigne atelier) :
  // c'est en les voyant offertes qu'on pense à les remplir.
  const vus = [];
  const doc = faireDoc();
  const aLEcran = dessinerTicket(t, doc, (cle) => {
    vus.push(cle);
    const c = doc.createElement('input');
    c.className = 'tk__champ';
    return c;
  });
  for (const attendu of ['client', 'contact', 'tel', 'remise', 'atelier',
    'qte', 'designation', 'detail']) {
    assert.ok(vus.includes(attendu), `« ${attendu} » doit être corrigeable dans l’aperçu`);
  }
  // L'ARGENT N'EST PLUS OFFERT DU TOUT. Pas un champ vide qu'on remplirait par
  // mégarde : aucune case. Le prix et le règlement se corrigent sur la ligne du
  // planning et dans la fiche, là où ils vivent.
  for (const parti of ['total', 'paiement', 'prix', 'supplement', 'refTicket']) {
    assert.ok(!vus.includes(parti), `« ${parti} » n’a plus à figurer sur un ticket d’atelier`);
  }
  assert.ok(balises(aLEcran).includes('input'));
  // La RÉFÉRENCE n'est pas dans la liste : c'est la clé du dossier (recherche,
  // idempotence de la prise au comptoir), elle ne se retape pas.
  assert.ok(!vus.includes('ref'));
  assert.ok(texteDe(aLEcran).includes('26.08.06-003'), 'la référence reste lisible, en toutes lettres');

  // Une demande de devis suit la même règle, et garde sa consigne : l'atelier
  // peut avoir une maquette à préparer avant que rien ne soit chiffré.
  const vusDevis = [];
  const docD = faireDoc();
  dessinerTicket(devis, docD, (cle) => { vusDevis.push(cle); return docD.createElement('input'); });
  for (const parti of ['total', 'paiement', 'prix']) assert.ok(!vusDevis.includes(parti));
  assert.ok(vusDevis.includes('atelier'), 'une demande aussi peut porter une consigne');

  console.log('✓ ticket modifiable : champs à l’écran, aucun sur le papier');

  // =========================================================================
  // 4-6. LE SERVEUR
  // =========================================================================
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
  const call = async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const cree = await call('POST', '/api/comptoir/projet', {
    source: 'Vente directe',
    ref: '26.08.16-100',
    client: 'Sun Bar',
    clientObj: { type: 'Professionnel', company: 'Sun Bar', phone: '0690 11 22 33' },
    name: '2 x Polo brodé',
    amount: 148.5,
    due: '2026-08-20',
    dueTime: '16:30',
    stage: 'preparation',
    status: 'Préparation des produits',
    client_info: [['Type de client', 'Professionnel']],
    details: [
      ['Article 1 — Désignation', 'Polo brodé'],
      ['Article 1 — Quantité', '2'],
      ['Article 1 — Description de production', 'Broderie poitrine'],
      ['Article 2 — Désignation', 'Tasse'],
      ['Article 2 — Description de production', 'Logo une face'],
    ],
    recap: 'ATELIER OLDA — RÉCAPITULATIF DE VENTE DIRECTE',
  });
  assert.strictEqual(cree.status, 201);
  const id = cree.body.id;
  // La fiche COMPLÈTE ne se lit que sur la commande seule : la liste et la
  // création n'en transportent qu'un résumé (cf. allegerFiche).
  const dossier = await call('GET', `/api/requests/${id}`);
  const detailsEnBase = dossier.body.fiche.details;
  const idxProd1 = detailsEnBase.findIndex((l) => l.k === 'Article 1 — Description de production');
  const idxProd2 = detailsEnBase.findIndex((l) => l.k === 'Article 2 — Description de production');
  assert.ok(idxProd1 >= 0 && idxProd2 > idxProd1);
  // Les indices que le modèle du ticket donne à l'écran sont CEUX-LÀ : c'est
  // tout l'enjeu — corriger le bon article, pas son voisin.
  const modele = modeleTicket(dossier.body);
  assert.strictEqual(modele.lignes[0].ou.detail.i, idxProd1);
  assert.strictEqual(modele.lignes[1].ou.detail.i, idxProd2);

  // --- 4. La consigne, le numéro du papier, et la référence intouchable -----
  const consigne = await call('PATCH', `/api/requests/${id}/fiche`, {
    atelier: 'Broderie fil or — vérifier la charte avant de lancer',
  });
  assert.strictEqual(consigne.status, 200);
  assert.strictEqual(consigne.body.fiche.atelier, 'Broderie fil or — vérifier la charte avant de lancer');
  // Le reste de la fiche est intact : la consigne s'AJOUTE au dossier.
  assert.strictEqual(consigne.body.fiche.details.length, detailsEnBase.length);
  assert.strictEqual(consigne.body.fiche.ref, '26.08.16-100');

  // Un vieux dossier peut porter un `refTicket` — le numéro du papier remis à
  // l'époque où on en remettait un. La route l'accepte toujours ; ce qui compte
  // ici, c'est que le ticket de l'atelier ne le sorte JAMAIS (plus bas).
  const vieuxPapier = await call('PATCH', `/api/requests/${id}/fiche`, { refTicket: '26.08.16-099' });
  assert.strictEqual(vieuxPapier.body.fiche.refTicket, '26.08.16-099');

  // LA RÉFÉRENCE NE SE RETAPE PAS par cette porte : la recherche du comptoir et
  // l'idempotence de la prise s'appuient dessus. Ce qu'on envoie est ignoré.
  const tentative = await call('PATCH', `/api/requests/${id}/fiche`, { ref: 'JE-CHANGE-TOUT' });
  assert.strictEqual(tentative.status, 200);
  assert.strictEqual(tentative.body.fiche.ref, '26.08.16-100');

  // Une consigne n'est pas un cahier des charges : elle est bornée, et le
  // serveur la coupe au lieu de laisser grossir la ligne indéfiniment.
  const trop = await call('PATCH', `/api/requests/${id}/fiche`, { atelier: 'x'.repeat(900) });
  assert.ok(trop.body.fiche.atelier.length <= 500);

  // Vidée, elle disparaît — et le ticket reprend sa forme d'avant.
  const videe = await call('PATCH', `/api/requests/${id}/fiche`, { atelier: '' });
  assert.strictEqual(videe.body.fiche.atelier, null);
  assert.strictEqual(modeleTicket(videe.body).atelier, '');
  await call('PATCH', `/api/requests/${id}/fiche`, { atelier: 'Broderie fil or' });

  console.log('✓ ticket modifiable : le serveur écrit la consigne, jamais la référence');

  // --- 5. Deux corrections, deux articles : aucune n'efface l'autre ---------
  // La fiche entière se réécrit à chaque correction (c'est un seul `jsonb`). Le
  // ticket n'envoie donc QUE la position touchée : les autres cases partent
  // vides et le serveur ne réécrit que les chaînes. Sans ça, deux collègues qui
  // précisent chacun un article se seraient effacés l'un l'autre — et rien à
  // l'écran ne l'aurait dit.
  const pos1 = [];
  pos1[idxProd1] = 'Broderie poitrine GAUCHE, 8 cm';
  const pos2 = [];
  pos2[idxProd2] = 'Logo DEUX faces';
  await call('PATCH', `/api/requests/${id}/fiche`, { details: pos1 });
  const apres = await call('PATCH', `/api/requests/${id}/fiche`, { details: pos2 });
  const lu = (i) => apres.body.fiche.details[i].v;
  assert.strictEqual(lu(idxProd1), 'Broderie poitrine GAUCHE, 8 cm', 'la première correction a tenu');
  assert.strictEqual(lu(idxProd2), 'Logo DEUX faces');
  // Les libellés ne bougent jamais : ils viennent du parcours du comptoir.
  assert.strictEqual(apres.body.fiche.details[idxProd1].k, 'Article 1 — Description de production');
  // Et la consigne globale a survécu aux deux.
  assert.strictEqual(apres.body.fiche.atelier, 'Broderie fil or');

  // Ce que le ticket réimprimé porte désormais.
  const rejoue = ticketTexte(modeleTicket(apres.body));
  assert.ok(rejoue.includes('Broderie poitrine GAUCHE, 8 cm'));
  assert.ok(rejoue.includes('Logo DEUX faces'));
  // …et le numéro du papier d'autrefois reste au dossier, hors du ticket.
  assert.strictEqual(apres.body.fiche.refTicket, '26.08.16-099');
  assert.ok(!rejoue.includes('26.08.16-099'), 'aucun numéro de papier client sur le ticket d’atelier');

  console.log('✓ ticket modifiable : une correction par position n’efface pas la voisine');

  // --- 6. La liste porte la consigne, l'historique la garde ----------------
  // La grille marque d'un point les dossiers qui parlent à l'atelier : sans la
  // consigne dans la liste allégée, il faudrait ouvrir chaque fiche pour savoir
  // laquelle en porte une.
  // Le dossier attend dans « À trier » : tout ce qui vient du comptoir y
  // atterrit avant d'être rangé (`fiche.destination` garde la famille visée).
  const liste = await call('GET', `/api/requests?stage=${dossier.body.stage}`);
  const dansLaListe = liste.body.find((x) => x.id === id);
  assert.ok(dansLaListe, 'le dossier doit être dans sa famille');
  assert.strictEqual(dansLaListe.fiche.atelier, 'Broderie fil or');
  // La liste reste ALLÉGÉE pour autant : le récapitulatif ne repart pas avec.
  assert.strictEqual(dansLaListe.fiche.details, undefined);

  // « Qui a écrit ça, et quand ? » est la première question posée quand la
  // pièce ne correspond pas au ticket : la consigne a sa ligne d'historique.
  const journal = await call('GET', `/api/requests/${id}/journal`);
  const consignes = journal.body.filter((e) => e.field === 'fiche_atelier');
  assert.ok(consignes.length >= 1, 'la consigne atelier doit laisser une trace');
  assert.strictEqual(consignes[0].value_after, 'Broderie fil or');

  console.log('✓ ticket modifiable : la consigne voyage dans la liste et laisse une trace');

  // =========================================================================
  // 7. LE BRANCHEMENT DANS L'ÉCRAN
  // =========================================================================
  const APP = lire('app.js');
  const CSS = lire('styles.css');

  // L'aperçu s'ouvre DÉJÀ modifiable : le même dessin, avec l'éditeur.
  assert.ok(/dessinerTicket\(t, document, editeurTicket\(r, champs\)\)/.test(APP),
    'l’aperçu du ticket doit être dessiné avec son éditeur');
  // L'impression, elle, ne le passe jamais.
  assert.ok(/d\.body\.appendChild\(dessinerTicket\(t, d\)\);/.test(APP),
    'le cadre d’impression ne doit recevoir aucun éditeur');

  // Pas de bouton « Enregistrer » : c'est la règle de la grille (un champ
  // quitté est un champ enregistré), pas celle de la fiche.
  const boite = APP.match(/async function ouvrirTicket\(r\)[\s\S]*?\n\}\n/)[0];
  assert.ok(!/Enregistrer/.test(boite), 'le ticket ne s’enregistre pas au bouton');
  assert.ok(/ctrl\.addEventListener\('blur', sauver\)/.test(APP));
  // Fermer et imprimer commettent d'abord la frappe en cours : sinon une
  // consigne tapée puis imprimée sortait sur un papier qui ne la portait pas.
  assert.ok(/commettre\(\);\n\s*fond\.remove\(\)/.test(APP), 'fermer doit commettre avant de retirer la boîte');
  assert.ok(/commettre\(\)\.then\(\(\) => \{\n\s*const frais = modeleTicket\(r\)/.test(APP),
    'imprimer doit commettre puis refaire le modèle');

  // La correction va à la bonne route : les colonnes de la ligne d'un côté, la
  // fiche de l'autre.
  assert.ok(/api\('PATCH', `\/api\/requests\/\$\{r\.id\}\/fiche`, corps\)/.test(APP));
  assert.ok(/: await patchRow\(r, corps\)/.test(APP));
  // Et le récapitulatif part par POSITION, une seule case remplie.
  assert.ok(/positions\[cible\.i\] = String\(valeur == null \? '' : valeur\);/.test(APP));

  // Le point sur la pastille dit qu'une consigne existe, dans les DEUX vues.
  assert.ok(/function consigneAtelier\(r\)/.test(APP));
  assert.ok(/btn\.classList\.add\('ticket-cell--consigne'\)/.test(APP));
  assert.ok(/tk\.classList\.add\('pcard__ticket--consigne'\)/.test(APP));
  assert.ok(/\.ticket-cell--consigne::after,\s*\.pcard__ticket--consigne::after/.test(CSS));
  // Il se peint HORS de la boîte : une pastille qui grossit décalerait toute la
  // rangée d'actions des cartes, ligne après ligne.
  assert.ok(/\.ticket-cell--consigne \{ position: relative; \}/.test(CSS));

  // La fiche montre la MÊME consigne : sinon elle ne se relirait qu'en
  // imprimant le ticket.
  assert.ok(/const cAtelier = ldSuivi\('atelier',/.test(APP));
  assert.ok(/if \(ldModifie\(c\.cAtelier\)\) corpsFiche\.atelier = texte\(c\.cAtelier\.value\);/.test(APP));

  // Le module du ticket part avec la coquille hors ligne (rien n'y a changé,
  // mais un oubli ici rendrait le ticket muet sur un poste sans réseau).
  assert.ok(/ticket\.js/.test(lire('sw.js')));

  console.log('✓ ticket modifiable : branché sur la ligne, sur la fiche, et dans les deux vues');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
