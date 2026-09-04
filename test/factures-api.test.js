'use strict';

// ===========================================================================
// LA FACTURE — numérotation continue, immuabilité, idempotence (03/09/2026)
// ===========================================================================
// Ce que ce fichier tient, dans l'esprit du dépôt : les bugs vivent dans la
// concurrence et le réseau qui tombe, pas dans le cas nominal.
//   1. La numérotation ne laisse JAMAIS de trou : un rejet ne consomme pas de
//      rang, une resoumission après perte de réponse réseau retombe sur la
//      ligne déjà créée au lieu d'en brûler un second.
//   2. Deux émissions concurrentes pour le MÊME dossier ne créent qu'une
//      seule ligne et ne consomment qu'un seul numéro.
//   3. Aucune route d'écriture n'existe après création — l'immutabilité est
//      un FAIT d'API, pas une convention qu'on espère respectée.

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

  // `n` DOIT VARIER D'UN APPEL À L'AUTRE : /api/comptoir/projet dédoublonne
  // par EMPREINTE (hash du nom client + montant + articles…, index unique
  // sur fiche->>'empreinte' — voir db.js « poserUniciteEmpreinte »), pas
  // seulement par référence explicite. Deux paniers byte-pour-byte
  // identiques sont donc traités comme LE MÊME dossier renvoyé deux fois
  // (le comportement voulu, protège contre une tablette qui réessaie) — ce
  // qui n'est PAS ce qu'on veut tester ici : chaque `n` simule une vente
  // RÉELLEMENT différente.
  const dossier = (n) => fetch(`${base}/api/comptoir/projet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'Vente directe',
      clientObj: { name: `Client Facture Test ${n}`, type: 'pro' },
      amount: 40.04,
      articles: [{ label: 'T-shirt logo coeur', qty: 2, amount: 30 }, { label: 'Tasse céramique', qty: 1, amount: 8.5 }],
      paiement: { mode: 'cb' },
    }),
  }).then((r) => r.json());

  const factureBody = (dossierId, n) => ({
    dossierId,
    client: { nom: `Client Facture Test ${n}`, ville: 'Marigot', type: 'pro' },
    mode: 'cb',
    regime: 'tgca', tauxTgca: 0.04, arrondi: 'aucun', vedette: 'ttc',
    ajustement: { unite: 'eur', valeur: 0 },
    lignes: [
      { designation: 'T-shirt logo coeur', quantite: 2, unitaireHt: 15 },
      { designation: 'Tasse céramique', quantite: 1, unitaireHt: 8.5 },
    ],
  });

  // --- Émission nominale ------------------------------------------------------
  const d1 = await dossier(1);
  assert.ok(d1.id, 'le dossier doit se créer');
  const r1 = await fetch(`${base}/api/factures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(factureBody(d1.id, 1)),
  });
  assert.strictEqual(r1.status, 201);
  const f1 = await r1.json();
  assert.match(f1.numero, /^FA-\d{4}-\d{4}$/, `numéro mal formé : ${f1.numero}`);
  assert.strictEqual(f1.montantTtc, 40.04);
  // LE DOCUMENT ARCHIVÉ EST LA DONNÉE BRUTE (saisie + entreprise figée), PAS
  // UN RENDU : c'est modeleFacture/dessinerFacture, côté client, qui
  // composent le papier — le serveur ne formate rien (voir server.js).
  assert.strictEqual(f1.document.saisie.numero, f1.numero);
  assert.strictEqual(f1.document.saisie.mode, 'cb');
  assert.strictEqual(f1.document.saisie.client.nom, 'Client Facture Test 1');
  assert.strictEqual(f1.document.saisie.lignes.length, 2);
  assert.ok('entreprise' in f1.document, 'l’identité de l’atelier doit être figée dans le document archivé');

  // --- Un dossier sans article ou sans mode est rejeté, SANS consommer de numéro
  const d2 = await dossier(2);
  const avantRejet = await fetch(`${base}/api/factures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...factureBody(d2.id, 2), mode: 'inconnu' }),
  });
  assert.strictEqual(avantRejet.status, 400);
  const okApresRejet = await fetch(`${base}/api/factures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(factureBody(d2.id, 2)),
  });
  assert.strictEqual(okApresRejet.status, 201);
  const f2 = await okApresRejet.json();
  // Les deux numéros doivent être CONSÉCUTIFS : le rejet n'a pas brûlé de rang.
  const rangDe = (num) => Number(num.split('-')[2]);
  assert.strictEqual(rangDe(f2.numero), rangDe(f1.numero) + 1,
    `un rejet a consommé un numéro : ${f1.numero} puis ${f2.numero}`);

  // --- Resoumission (réseau qui avale la réponse) : pas de doublon, pas de second numéro
  const d3 = await dossier(3);
  const body3 = factureBody(d3.id, 3);
  const [ra, rb] = await Promise.all([
    fetch(`${base}/api/factures`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body3) }),
    fetch(`${base}/api/factures`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body3) }),
  ]);
  const [fa, fb] = await Promise.all([ra.json(), rb.json()]);
  assert.strictEqual(fa.id, fb.id, 'deux émissions concurrentes pour le même dossier doivent rendre LA MÊME facture');
  assert.strictEqual(fa.numero, fb.numero);

  // --- Un dossier déjà facturé refuse une SECONDE facture distincte ----------
  const encore = await fetch(`${base}/api/factures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(factureBody(d1.id, 1)),
  });
  const encoreJson = await encore.json();
  assert.strictEqual(encoreJson.id, f1.id, 'redemander une facture pour un dossier déjà facturé rend l’EXISTANTE');
  assert.strictEqual(encoreJson.numero, f1.numero);

  // --- Relecture depuis la fiche -----------------------------------------------
  const relue = await fetch(`${base}/api/requests/${d1.id}/facture`);
  assert.strictEqual(relue.status, 200);
  const relueJson = await relue.json();
  assert.strictEqual(relueJson.numero, f1.numero);
  assert.deepStrictEqual(relueJson.document, f1.document, 'la relecture ne recalcule rien : elle rend le document archivé tel quel');

  const introuvable = await fetch(`${base}/api/requests/00000000-0000-0000-0000-000000000000/facture`);
  assert.strictEqual(introuvable.status, 404);

  // --- Aucune route d'écriture n'existe ----------------------------------------
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const rep = await fetch(`${base}/api/factures/${f1.id}`, { method });
    assert.ok([404, 405].includes(rep.status), `${method} /api/factures/:id doit être refusé (reçu ${rep.status})`);
  }

  // --- LE JOURNAL : la liste et l'export que le comptable demande -------------
  // SANS EUX, PERSONNE NE PEUT SORTIR LES VENTES DU MOIS : la seule lecture qui
  // existait rendait UNE facture, à condition de connaître son dossier.
  const journalRep = await fetch(`${base}/api/factures`);
  assert.strictEqual(journalRep.status, 200);
  const journal = await journalRep.json();
  assert.ok(Array.isArray(journal.factures), 'le journal doit rendre une liste');
  assert.ok(journal.factures.length >= 3, `au moins les trois factures émises ici : ${journal.factures.length}`);
  assert.ok(journal.annees.length >= 1, 'le journal doit dire quelles années portent des factures');

  const ligne = journal.factures.find((f) => f.numero === f1.numero);
  assert.ok(ligne, 'la facture émise doit figurer au journal');
  assert.strictEqual(ligne.ttc, 40.04, 'le TTC du journal est la COLONNE archivée, jamais une addition refaite');
  // HT + taxe DOIVENT redonner le TTC au centime : c'est le contrôle qu'un
  // comptable fait en premier, et une dérive d'un centime par ligne se voit
  // sur le total du mois, pas sur la ligne.
  assert.strictEqual(Math.round((ligne.totalHt + ligne.taxe) * 100) / 100, ligne.ttc,
    `HT ${ligne.totalHt} + taxe ${ligne.taxe} ne redonne pas ${ligne.ttc}`);
  assert.strictEqual(ligne.mode, 'cb');

  // Le filtre par année est la maille de la NUMÉROTATION — celle sur laquelle
  // un contrôle vérifie qu'il ne manque aucun rang.
  const anneeCourante = Number(f1.numero.split('-')[1]);
  const filtre = await fetch(`${base}/api/factures?annee=${anneeCourante}`).then((r) => r.json());
  assert.ok(filtre.factures.length >= 3);
  assert.ok(filtre.factures.every((f) => f.numero.startsWith(`FA-${anneeCourante}-`)),
    'le filtre par année ne doit rendre que cette année-là');
  const horsAnnee = await fetch(`${base}/api/factures?annee=1999`).then((r) => r.json());
  assert.strictEqual(horsAnnee.factures.length, 0);

  const csvRep = await fetch(`${base}/api/factures.csv?annee=${anneeCourante}`);
  assert.strictEqual(csvRep.status, 200);
  assert.match(csvRep.headers.get('content-type') || '', /text\/csv/);
  // LE BOM ET LE POINT-VIRGULE ne sont pas cosmétiques : sans eux, le fichier
  // s'ouvre en une seule colonne et « Réglé » arrive en « RÃ©glÃ© ».
  //
  // ⚠ ON LIT LES OCTETS, PAS LE TEXTE. `Response.text()` DÉCODE en UTF-8 et
  // retire le BOM au passage (c'est la spec) : l'assertion sur la chaîne
  // passerait tout aussi bien si le serveur n'en envoyait aucun.
  const octets = new Uint8Array(await csvRep.clone().arrayBuffer());
  assert.deepStrictEqual([...octets.slice(0, 3)], [0xef, 0xbb, 0xbf],
    'le CSV doit commencer par un BOM UTF-8, sinon les accents sortent en mojibake');
  const csv = await csvRep.text();
  const entete = csv.replace('\uFEFF', '').split('\r\n')[0];
  assert.ok(entete.split(';').length > 5, `l'en-tête doit être séparé par des point-virgules : ${entete}`);
  assert.ok(csv.includes(f1.numero), 'la facture émise doit figurer dans l’export');
  // Les lignes de l'export sont dans l'ordre CROISSANT des numéros : un journal
  // comptable se lit dans le sens où il a été écrit.
  const numerosCsv = csv.replace('\uFEFF', '').trim().split('\r\n').slice(1).map((l) => l.split(';')[0]);
  assert.deepStrictEqual(numerosCsv, [...numerosCsv].sort(),
    `l'export doit être trié par numéro croissant : ${numerosCsv.join(', ')}`);

  // --- L'IDENTITÉ QUI SIGNE LA FACTURE ---------------------------------------
  // LE DÉFAUT PAYÉ LE 03/09 : `app_meta.entreprise` n'existait pas en
  // production, `getEntreprise()` retombait sur ses valeurs de repli (le nom
  // seul) et une facture serait sortie sans SIRET, sans adresse et sans pied
  // légal — un papier qui ne vaut rien. La semence de `db.js` la pose ; ce
  // test est là pour qu'aucune base ne reparte nue.
  const identite = await fetch(`${base}/api/settings/entreprise`).then((r) => r.json());
  for (const cle of ['nom', 'adresse', 'ville', 'siret', 'ape', 'rcs', 'tva', 'capital']) {
    assert.ok(String(identite[cle] || '').trim(),
      `l’identité de l’atelier doit porter « ${cle} » — sans lui la facture n’est pas opposable`);
  }
  assert.strictEqual(identite.siret, '97829695200028');
  // « RCS » est le préfixe posé par le papier (maisonPapier) : la valeur ne
  // doit pas le reporter, sinon le pied dit « RCS RCS Saint-Martin ».
  assert.ok(!/^RCS/i.test(identite.rcs), `le RCS ne doit pas reporter son préfixe : ${identite.rcs}`);
  // Le document déjà archivé fige cette identité — il ne la relit jamais.
  assert.strictEqual(f1.document.entreprise.siret, identite.siret);

  // Une valeur SAISIE À LA MAIN n'est jamais réécrite par un second passage :
  // c'est une décision, pas une case oubliée. La garde `app_meta` suffirait,
  // mais c'est le « ne remplir que le vide » qu'on tient ici.
  const { semerIdentiteAtelier, pool } = require('../db');
  await fetch(`${base}/api/settings/entreprise`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adresse: 'Nouvelle adresse du patron' }),
  });
  await pool.query("DELETE FROM app_meta WHERE key = 'entreprise_seed_v1'");
  await semerIdentiteAtelier();
  const apresSemence = await fetch(`${base}/api/settings/entreprise`).then((r) => r.json());
  assert.strictEqual(apresSemence.adresse, 'Nouvelle adresse du patron',
    'la semence ne doit JAMAIS réécrire une identité saisie à la main');
  assert.strictEqual(apresSemence.siret, '97829695200028', 'ce qui était déjà posé reste posé');

  // --- L'AVOIR — la seule façon de corriger une facture -----------------------
  // UNE FACTURE ÉMISE NE SE MODIFIE NI NE S'EFFACE : ce qui se teste ici, c'est
  // que le rattrapage existe, qu'il tombe JUSTE, et qu'il ne permet pas de
  // rendre plus qu'on n'a facturé.
  const dAv = await dossier(10);
  const fAv = await fetch(`${base}/api/factures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(factureBody(dAv.id, 10)),
  }).then((r) => r.json());
  assert.strictEqual(fAv.montantTtc, 40.04);

  const avoirBody = (cle, lignes, motif) => ({
    cle, invoiceId: fAv.id, motif: motif || 'Retour client', lignes,
  });
  // 1. AVOIR PARTIEL : une seule ligne, la tasse à 8,50 HT → 8,84 TTC.
  const av1 = await fetch(`${base}/api/avoirs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(avoirBody('cle-partielle-1',
      [{ designation: 'Tasse céramique', quantite: 1, unitaireHt: 8.5 }], 'Tasse ébréchée')),
  });
  assert.strictEqual(av1.status, 201);
  const a1 = await av1.json();
  assert.match(a1.numero, /^AV-\d{4}-\d{4}$/, `numéro d'avoir mal formé : ${a1.numero}`);
  assert.strictEqual(a1.montantTtc, 8.84, 'l’avoir applique le taux de la facture, pas celui du jour');
  // LE RÉGIME VIENT DE LA FACTURE CORRIGÉE, jamais des réglages courants.
  assert.strictEqual(a1.document.saisie.tauxTgca, fAv.document.saisie.tauxTgca);
  assert.strictEqual(a1.document.saisie.regime, fAv.document.saisie.regime);
  assert.strictEqual(a1.document.saisie.avoir.surFacture, fAv.numero);
  assert.strictEqual(a1.document.saisie.avoir.motif, 'Tasse ébréchée');
  // L'identité figée est celle de la FACTURE : les deux papiers portent le même
  // émetteur, même après un déménagement.
  assert.deepStrictEqual(a1.document.entreprise, fAv.document.entreprise);

  // 2. SA PROPRE SÉRIE : un avoir ne consomme AUCUN numéro de facture.
  const dApres = await dossier(11);
  const fApres = await fetch(`${base}/api/factures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(factureBody(dApres.id, 11)),
  }).then((r) => r.json());
  assert.strictEqual(rangDe(fApres.numero), rangDe(fAv.numero) + 1,
    `un avoir a consommé un numéro de facture : ${fAv.numero} puis ${fApres.numero}`);

  // 3. IDEMPOTENCE SUR LA CLÉ : le réseau qui avale la réponse ne rembourse
  //    pas deux fois. Deux appels concurrents, même clé, un seul avoir.
  const [ca, cb] = await Promise.all([
    fetch(`${base}/api/avoirs`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(avoirBody('cle-concurrente', [{ designation: 'T-shirt logo coeur', quantite: 1, unitaireHt: 15 }])) }),
    fetch(`${base}/api/avoirs`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(avoirBody('cle-concurrente', [{ designation: 'T-shirt logo coeur', quantite: 1, unitaireHt: 15 }])) }),
  ]);
  const [ja, jb] = await Promise.all([ca.json(), cb.json()]);
  assert.strictEqual(ja.id, jb.id, 'deux avoirs concurrents sur la même clé doivent rendre LE MÊME');
  assert.strictEqual(ja.numero, jb.numero);

  // 4. ON NE REND JAMAIS PLUS QU'ON N'A FACTURÉ, avoirs précédents compris.
  //    Déjà rendu : 8,84 + 15,60 = 24,44 sur 40,04 → reste 15,60.
  const trop = await fetch(`${base}/api/avoirs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(avoirBody('cle-trop',
      [{ designation: 'T-shirt logo coeur', quantite: 2, unitaireHt: 15 }])),
  });
  assert.strictEqual(trop.status, 400, 'un avoir qui dépasse le reste à rendre doit être refusé');
  const messageTrop = (await trop.json()).error;
  assert.ok(messageTrop.includes(fAv.numero) && messageTrop.includes('15.60'),
    `le refus doit dire ce qui reste : ${messageTrop}`);

  // 5. LA FACTURE PORTE SES AVOIRS À LA RELECTURE, mais son document archivé
  //    n'a pas bougé d'un caractère.
  const relueAv = await fetch(`${base}/api/requests/${dAv.id}/facture`).then((r) => r.json());
  assert.strictEqual(relueAv.avoirs.length, 2);
  assert.strictEqual(relueAv.resteARendre, 15.6);
  assert.deepStrictEqual(relueAv.document, fAv.document,
    'les avoirs n’ont PAS réécrit la facture — elle se relit à l’identique');

  // 6. AVOIR TOTAL : sur une facture neuve, rendre toutes les lignes retombe au
  //    CENTIME sur le TTC facturé. C'est la propriété qui compte — un avoir
  //    d'annulation qui laisse 0,01 € au bilan est un avoir faux.
  const dTot = await dossier(12);
  const fTot = await fetch(`${base}/api/factures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...factureBody(dTot.id, 12), arrondi: 'euro', ajustement: { unite: 'eur', valeur: -3 } }),
  }).then((r) => r.json());
  const avTot = await fetch(`${base}/api/avoirs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cle: 'cle-totale', invoiceId: fTot.id, motif: 'Commande annulée',
      lignes: fTot.document.saisie.lignes,
    }),
  }).then((r) => r.json());
  assert.strictEqual(avTot.montantTtc, fTot.montantTtc,
    `un avoir total doit rendre exactement ce qui a été facturé : ${avTot.montantTtc} contre ${fTot.montantTtc}`);
  const relueTot = await fetch(`${base}/api/requests/${dTot.id}/facture`).then((r) => r.json());
  assert.strictEqual(relueTot.resteARendre, 0);

  // 7. AUCUNE ROUTE D'ÉCRITURE SUR UN AVOIR NON PLUS.
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const rep = await fetch(`${base}/api/avoirs/${a1.id}`, { method });
    assert.ok([404, 405].includes(rep.status), `${method} /api/avoirs/:id doit être refusé (reçu ${rep.status})`);
  }

  // 8. LE JOURNAL ET L'EXPORT PORTENT LES DEUX SÉRIES, l'avoir en NÉGATIF —
  //    seule façon de rendre la colonne « Total TTC » sommable.
  const j2 = await fetch(`${base}/api/factures`).then((r) => r.json());
  assert.ok(j2.avoirs.length >= 3, `le journal doit porter les avoirs : ${j2.avoirs.length}`);
  const ligneTot = j2.factures.find((f) => f.numero === fTot.numero);
  assert.strictEqual(ligneTot.annulee, true, 'une facture entièrement rendue se lit « annulée »');
  assert.deepStrictEqual(ligneTot.avoirs, [avTot.numero]);
  const anneeJ = j2.annees.find((a) => a.annee === Number(fAv.numero.split('-')[1]));
  assert.strictEqual(anneeJ.net, Math.round((anneeJ.ttc - anneeJ.rendu) * 100) / 100,
    'le net de l’année doit être le facturé moins le rendu');

  const csv2 = await fetch(`${base}/api/factures.csv?annee=${anneeCourante}`).then((r) => r.text());
  const lignesCsv = csv2.replace('\uFEFF', '').trim().split('\r\n');
  const colonnes = lignesCsv[0].split(';');
  assert.strictEqual(colonnes[0], 'Nature');
  const iTtc = colonnes.indexOf('Total TTC');
  const ligneAvoirCsv = lignesCsv.find((l) => l.startsWith(`Avoir;${avTot.numero};`));
  assert.ok(ligneAvoirCsv, `l’avoir doit figurer dans l’export : ${avTot.numero}`);
  assert.ok(ligneAvoirCsv.split(';')[iTtc].startsWith('-'),
    `un avoir doit sortir en NÉGATIF dans l’export : ${ligneAvoirCsv.split(';')[iTtc]}`);
  assert.strictEqual(ligneAvoirCsv.split(';')[2], fTot.numero, 'l’avoir doit citer la facture qu’il corrige');
  // LA FACTURE AVANT SON AVOIR le même jour : « AV » passerait avant « FA » par
  // l'alphabet, et l'export listerait l'avoir avant ce qu'il corrige.
  const iFacture = lignesCsv.findIndex((l) => l.startsWith(`Facture;${fTot.numero};`));
  const iAvoir = lignesCsv.findIndex((l) => l.startsWith(`Avoir;${avTot.numero};`));
  assert.ok(iFacture > 0 && iFacture < iAvoir,
    `la facture doit précéder son avoir dans l'export (facture ligne ${iFacture}, avoir ligne ${iAvoir})`);

  // 9. LA MENTION D'EXONÉRATION EST FIGÉE À L'ÉMISSION, comme l'identité.
  await fetch(`${base}/api/settings/mentions-regime`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ export: 'Exoneration de TGCA — exportation, article a preciser' }),
  });
  const dExp = await dossier(13);
  const fExp = await fetch(`${base}/api/factures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...factureBody(dExp.id, 13), regime: 'export' }),
  }).then((r) => r.json());
  assert.strictEqual(fExp.document.saisie.mentionRegime, 'Exoneration de TGCA — exportation, article a preciser');
  // Une exportation n'est pas taxée : le TTC retombe sur le HT.
  assert.strictEqual(fExp.montantTtc, 38.5);
  await fetch(`${base}/api/settings/mentions-regime`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ export: 'Texte change apres coup' }),
  });
  const relueExp = await fetch(`${base}/api/requests/${dExp.id}/facture`).then((r) => r.json());
  assert.strictEqual(relueExp.document.saisie.mentionRegime,
    'Exoneration de TGCA — exportation, article a preciser',
    'changer la mention ne doit JAMAIS réécrire une facture déjà sortie');

  console.log('✓ factures-api : numéros sans trou, idempotence, immutabilité, avoirs, journal et export');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
