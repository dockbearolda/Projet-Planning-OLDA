'use strict';

// COMPTOIR — les deux parcours de « Nouveau Projet » (public/comptoir/*.html).
// Ces écrans sont ceux du patron : ils ne connaissent rien du planning, ils
// postent le dossier COMPLET tel qu'ils l'ont recueilli. Ce fichier vérifie la
// seule chose qui compte ensuite : que ce dossier arrive ENTIER et au BON
// ENDROIT dans le planning.
//
//   - une VENTE directe entre déjà chiffrée, encaissée, et à l'étape que la
//     vendeuse a choisie (préparation, ou facturation si le client repart) ;
//   - une DEMANDE de devis entre SANS PRIX (null, jamais 0 €) en « Demande &
//     chiffrage », avec tout le brief pour que celui qui chiffrera n'ait pas à
//     rappeler le client ;
//   - le client entre dans la base au passage ;
//   - rien de ce que la vendeuse a saisi ne se perd : le récapitulatif complet
//     est archivé dans `fiche`, c'est lui que rouvre le tiroir du planning.

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

  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const ligneDe = async (id) => (await call('GET', '/api/requests')).body.find((r) => r.id === id);

  // -------------------------------------------------------------------------
  // 1. VENTE DIRECTE — le client paie et repart plus tard : la commande entre
  //    en préparation, chiffrée et encaissée.
  // -------------------------------------------------------------------------
  const vente = await call('POST', '/api/comptoir/projet', {
    source: 'Vente directe',
    ref: '26.07.31-001',
    client: 'Hôtel Grand Case Beach Club',
    clientObj: {
      type: 'Professionnel',
      name: 'Hôtel Grand Case Beach Club',
      company: 'Hôtel Grand Case Beach Club',
      contact: 'Marie Durand',
      phone: '0690112233',
      email: 'contact@hgcbc.com',
    },
    name: '40 x Polo brodé • 10 x Casquette',
    responsible: 'Non défini',
    due: '2026-08-12',
    dueTime: '14:00',
    priority: '3',
    stage: 'preparation',
    status: 'Préparation des produits',
    production: 'Broderie',
    comment: 'Délai souhaité : 5 jours ouvrés | Logo poitrine',
    amount: 1840.5,
    quantity: 50,
    client_info: [['Type de client', 'Professionnel'], ['WhatsApp', '0690112233']],
    details: [['Commande', '26.07.31-001'], ['Article 1 — Désignation', 'Polo brodé']],
    recap: 'ATELIER OLDA — RÉCAPITULATIF DE VENTE DIRECTE\n\nCommande : 26.07.31-001',
    checks: { products: true, bat: false, files: true, qty: true, payment: true },
    paiement: { modeLabel: 'Carte bancaire', mode: 'cb', paye: true, retraitImmediat: false },
  });
  assert.strictEqual(vente.status, 201, JSON.stringify(vente.body));
  assert.strictEqual(vente.body.stage, 'preparation');
  assert.strictEqual(vente.body.subStage, 'prepa_produits', 'le libellé de l’écran retrouve sa sous-étape');

  const lVente = await ligneDe(vente.body.id);
  assert.ok(lVente, 'la vente est au planning');
  assert.strictEqual(lVente.order_kind, 'commande', 'une vente est une commande validée, pas une demande');
  assert.strictEqual(Number(lVente.project_value), 1840.5, 'le prix payé est celui du planning');
  assert.strictEqual(lVente.paye, true);
  assert.strictEqual(lVente.paiement_mode, 'cb');
  assert.strictEqual(lVente.billing_company, 'Hôtel Grand Case Beach Club');
  assert.strictEqual(lVente.client_type, 'pro');
  assert.strictEqual(lVente.contact_referent, 'Marie Durand');
  assert.strictEqual(lVente.contact_phone, '0690112233');
  assert.strictEqual(lVente.contact_email, 'contact@hgcbc.com');
  assert.strictEqual(lVente.quantity, 50);
  // pg-mem rend la date en ISO complet là où Postgres rend « aaaa-mm-jj ».
  assert.strictEqual(String(lVente.deadline).slice(0, 10), '2026-08-12');
  assert.strictEqual(lVente.priority, 3);
  assert.strictEqual(lVente.product, '40 x Polo brodé • 10 x Casquette');
  assert.strictEqual(lVente.responsable, 'À attribuer', '« Non défini » n’est pas un employé : la ligne attend son pilote');
  assert.match(lVente.description, /RÉCAPITULATIF DE VENTE DIRECTE/, 'la colonne Infos porte le récapitulatif imprimé');

  // La fiche archive le dossier ENTIER : c'est elle que rouvre le tiroir.
  assert.strictEqual(lVente.fiche.kind, 'comptoir-v17');
  assert.strictEqual(lVente.fiche.source, 'Vente directe');
  assert.strictEqual(lVente.fiche.ref, '26.07.31-001');
  assert.strictEqual(lVente.fiche.heureSouhaitee, '14:00');
  assert.strictEqual(lVente.fiche.production, 'Broderie');
  assert.deepStrictEqual(lVente.fiche.client[0], { k: 'Type de client', v: 'Professionnel' });
  assert.deepStrictEqual(lVente.fiche.details[0], { k: 'Commande', v: '26.07.31-001' });
  assert.strictEqual(lVente.fiche.controles.payment, true);
  assert.strictEqual(lVente.fiche.paiement.modeLabel, 'Carte bancaire');

  // Le client est entré dans la base au passage : la prochaine vente le trouve.
  const clients = (await call('GET', '/api/clients')).body;
  const fiche = clients.find((c) => c.entreprise === 'Hôtel Grand Case Beach Club');
  assert.ok(fiche, 'le client de la vente rejoint la base clients');
  assert.strictEqual(fiche.client_type, 'pro');
  assert.strictEqual(fiche.nom, 'Marie Durand', 'la personne à contacter suit le client dans sa fiche');
  assert.strictEqual(fiche.telephone, '0690112233');

  // -------------------------------------------------------------------------
  // 2. VENTE, CLIENT REPART IMMÉDIATEMENT — la commande n'a rien à produire :
  //    elle entre directement en facturation, déjà récupérée.
  // -------------------------------------------------------------------------
  const emporte = await call('POST', '/api/comptoir/projet', {
    source: 'Vente directe',
    ref: '26.07.31-002',
    clientObj: { type: 'Particulier', name: 'Jean Dupont', phone: '0690477788' },
    name: '2 x Tasse personnalisée',
    due: '2026-07-31',
    priority: '1',
    stage: 'facturation',
    status: 'Commande récupérée',
    amount: 38,
    quantity: 2,
    recap: 'Ticket 26.07.31-002',
    paiement: { modeLabel: 'Espèces', mode: 'especes', paye: true, retraitImmediat: true },
  });
  assert.strictEqual(emporte.status, 201, JSON.stringify(emporte.body));
  assert.strictEqual(emporte.body.stage, 'facturation');
  assert.strictEqual(emporte.body.subStage, 'commande_recuperee');

  const lEmporte = await ligneDe(emporte.body.id);
  assert.strictEqual(lEmporte.client_type, 'perso');
  assert.strictEqual(lEmporte.billing_company, 'Jean Dupont');
  assert.strictEqual(lEmporte.paiement_mode, 'especes');

  // Un particulier garde son identité en UN seul texte dans la grille, mais sa
  // fiche client est remplie : prénom d'un côté, nom de l'autre.
  const jean = (await call('GET', '/api/clients')).body.find((c) => c.entreprise === 'Jean Dupont');
  assert.ok(jean, 'le particulier rejoint lui aussi la base');
  assert.strictEqual(jean.client_type, 'perso');
  assert.strictEqual(jean.prenom, 'Jean');
  assert.strictEqual(jean.nom, 'Dupont');

  // -------------------------------------------------------------------------
  // 3. DEMANDE DE DEVIS — le cœur du flux : AUCUN PRIX. Le budget annoncé par
  //    le client est une indication, il ne devient jamais un prix.
  // -------------------------------------------------------------------------
  const demande = await call('POST', '/api/comptoir/projet', {
    source: 'Demande de devis',
    ref: 'DEV-26.07.31-001',
    clientObj: { type: 'Professionnel', name: 'Coco Beach', company: 'Coco Beach', contact: 'Paul' },
    name: 'Uniformes et goodies — Coco Beach',
    responsible: 'Mélina',
    due: '2026-08-20',
    dueTime: '14:00',
    priority: '2',
    stage: 'demande',
    status: 'À chiffrer',
    production: 'DTF + TROTEC',
    comment: 'Validation toujours par WhatsApp',
    amount: null,
    budgetIndicatif: 1500,
    quantity: 43,
    canal: 'WhatsApp',
    suite: 'Devis à faire',
    client_info: [['Type de client', 'Professionnel'], ['Personne à contacter', 'Paul']],
    details: [['Objet du projet', 'Équiper le personnel'], ['Besoin 1 — Désignation', 'Tee-shirts']],
    recap: 'ATELIER OLDA — RÉCAPITULATIF DE DEMANDE\n\nDemande : DEV-26.07.31-001',
    checks: { products: false, bat: false, files: true, qty: true, payment: false },
  });
  assert.strictEqual(demande.status, 201, JSON.stringify(demande.body));
  assert.strictEqual(demande.body.stage, 'demande_chiffrage');
  assert.strictEqual(demande.body.subStage, 'a_chiffrer');

  const lDemande = await ligneDe(demande.body.id);
  assert.strictEqual(lDemande.project_value, null, 'la colonne Prix TTC reste VIDE, pas à 0,00 €');
  assert.strictEqual(lDemande.order_kind, 'demande');
  assert.strictEqual(lDemande.paye, null, 'une demande ne se prononce pas sur le paiement');
  assert.strictEqual(lDemande.paiement_mode, null);
  assert.strictEqual(lDemande.responsable, 'Mélina', 'celle qui a pris la demande la pilote');
  assert.strictEqual(lDemande.fiche.budgetIndicatif, 1500, 'le budget annoncé est gardé, à côté du prix');
  assert.strictEqual(lDemande.fiche.canal, 'WhatsApp');
  assert.strictEqual(lDemande.fiche.suite, 'Devis à faire');

  // Un montant envoyé par erreur sur une demande ne devient JAMAIS un prix.
  const demandeChiffree = await call('POST', '/api/comptoir/projet', {
    source: 'Demande de devis',
    clientObj: { type: 'Professionnel', company: 'Mersea' },
    name: 'Gourdes UV',
    stage: 'demande',
    status: 'À chiffrer',
    amount: 780,
  });
  assert.strictEqual(demandeChiffree.status, 201);
  assert.strictEqual((await ligneDe(demandeChiffree.body.id)).project_value, null);

  // -------------------------------------------------------------------------
  // 4. « Attendre les informations du client » → l'autre sous-étape.
  // -------------------------------------------------------------------------
  const attente = await call('POST', '/api/comptoir/projet', {
    source: 'Demande de devis',
    clientObj: { type: 'Professionnel', company: 'Kalatua' },
    name: 'Casquettes brodées',
    stage: 'demande',
    status: 'Demande à qualifier',
  });
  assert.strictEqual(attente.body.subStage, 'demande_a_qualifier');

  // -------------------------------------------------------------------------
  // 5. LA FICHE SE CORRIGE. Le récapitulatif enregistré à la prise n'est pas
  //    une archive morte : une quantité change, une taille se précise. On
  //    corrige la VALEUR, jamais le libellé — et une valeur vidée devient « — »
  //    pour que la ligne reste visible sur le récapitulatif imprimé.
  // -------------------------------------------------------------------------
  const avantCorrection = await ligneDe(vente.body.id);
  assert.strictEqual(avantCorrection.fiche.details[1].v, 'Polo brodé');

  const corrige = await call('PATCH', `/api/requests/${vente.body.id}/fiche`, {
    client: ['Professionnel', '0690999999'],
    details: ['26.07.31-001', 'Polo brodé bicolore', 'ligne en trop, ignorée'],
  });
  assert.strictEqual(corrige.status, 200, JSON.stringify(corrige.body));

  const apresCorrection = await ligneDe(vente.body.id);
  assert.strictEqual(apresCorrection.fiche.details[1].v, 'Polo brodé bicolore', 'la valeur corrigée est en base');
  assert.strictEqual(apresCorrection.fiche.details[1].k, 'Article 1 — Désignation', 'le libellé vient du parcours, il ne se réécrit pas');
  assert.strictEqual(apresCorrection.fiche.client[1].v, '0690999999');
  assert.strictEqual(apresCorrection.fiche.details.length, 2, 'une valeur en trop n’ajoute pas de ligne');
  assert.strictEqual(apresCorrection.fiche.ref, '26.07.31-001', 'le reste de la fiche est intact');
  assert.strictEqual(apresCorrection.fiche.paiement.mode, 'cb');

  // Vider une valeur ne fait pas disparaître la ligne du récapitulatif.
  await call('PATCH', `/api/requests/${vente.body.id}/fiche`, { details: ['26.07.31-001', '   '] });
  assert.strictEqual((await ligneDe(vente.body.id)).fiche.details[1].v, '—');

  // Une ligne créée à la main dans la grille n'a pas de détail à corriger.
  const sansFiche = await call('POST', '/api/requests', { billing_company: 'Ligne manuelle' });
  const refus = await call('PATCH', `/api/requests/${sansFiche.body.id}/fiche`, { details: ['x'] });
  assert.strictEqual(refus.status, 400);
  assert.match(refus.body.error, /pas de détail modifiable/);

  const introuvable = await call('PATCH', '/api/requests/00000000-0000-4000-8000-000000000000/fiche', { details: [] });
  assert.strictEqual(introuvable.status, 404);

  // -------------------------------------------------------------------------
  // 6. CE QUI NE DOIT PAS CASSER LE COMPTOIR. Une nouvelle version de l'écran
  //    peut renommer une étape : la commande entre quand même, sous-étape « à
  //    préciser ». Refuser l'enregistrement laisserait la vendeuse avec un
  //    client encaissé et rien au planning.
  // -------------------------------------------------------------------------
  const libelleInconnu = await call('POST', '/api/comptoir/projet', {
    source: 'Vente directe',
    clientObj: { type: 'Professionnel', company: 'Seayou' },
    name: 'Tee-shirts équipage',
    stage: 'preparation',
    status: 'Une étape qui n’existe pas',
    amount: 120,
  });
  assert.strictEqual(libelleInconnu.status, 201);
  assert.strictEqual(libelleInconnu.body.stage, 'preparation');
  assert.strictEqual(libelleInconnu.body.subStage, null, 'famille connue, sous-étape à préciser');

  const etapeInconnue = await call('POST', '/api/comptoir/projet', {
    source: 'Demande de devis',
    clientObj: { type: 'Professionnel', company: 'Etika' },
    name: 'Tote bags',
    stage: 'nulle_part',
    status: 'À chiffrer',
  });
  assert.strictEqual(etapeInconnue.body.stage, 'demande_chiffrage', 'une demande retombe sur son étape naturelle');

  const dateBidon = await call('POST', '/api/comptoir/projet', {
    source: 'Vente directe',
    clientObj: { type: 'Professionnel', company: 'Voilà SXM' },
    name: 'Signalétique vitrine',
    due: '2026-02-30',
    stage: 'preparation',
    status: 'Préparation des produits',
    amount: 2200,
  });
  assert.strictEqual(dateBidon.status, 201);
  const jourJ = new Date();
  const aujourdhui = `${jourJ.getFullYear()}-${String(jourJ.getMonth() + 1).padStart(2, '0')}-${String(jourJ.getDate()).padStart(2, '0')}`;
  assert.strictEqual(
    String((await ligneDe(dateBidon.body.id)).deadline).slice(0, 10), aujourdhui,
    'une date impossible retombe sur aujourd’hui — la commande passe quand même',
  );

  // Sans nom de client, en revanche, la ligne serait anonyme au planning : refus.
  const sansClient = await call('POST', '/api/comptoir/projet', {
    source: 'Vente directe', name: 'Tasse', stage: 'preparation', status: 'Préparation des produits', amount: 19,
  });
  assert.strictEqual(sansClient.status, 400);
  assert.match(sansClient.body.error, /nom du client/);

  console.log('OK comptoir — vente directe et demande de devis arrivent entières au planning');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
