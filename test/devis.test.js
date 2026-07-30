'use strict';

// DEMANDE DE DEVIS — le second flux de « Nouveau Projet ».
// Le client demande un PRIX : rien n'est chiffré, rien n'est encaissé. Ce que
// vérifie ce fichier, c'est exactement ce qui distingue une demande d'une vente :
//   - aucun prix n'est exigé, et la ligne du planning reste SANS prix (null, pas
//     0 € — « pas encore chiffré » et « gratuit » ne se confondent pas) ;
//   - la nature enregistrée est « demande », pas « commande » ;
//   - la suite à donner décide de la sous-étape (À chiffrer / Demande à qualifier) ;
//   - le brief du client (canal, objet, contrôle du dossier) part au planning,
//     pour que celui qui chiffrera n'ait pas à rappeler le client ;
//   - une COMMANDE, elle, reste refusée sans prix.

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

  // 1. RÉFÉRENCE DU JOUR — même garantie que le ticket de caisse (un rang
  //    attribué n'est jamais réutilisé), mais une SÉRIE À PART : une demande et
  //    une vente du même jour ne se disputent pas un numéro.
  const ref1 = await call('POST', '/api/devis/numero', { jour: '2026-07-30' });
  assert.strictEqual(ref1.status, 201, JSON.stringify(ref1.body));
  assert.strictEqual(ref1.body.numero, 'DEV-26.07.30-001');
  const ref2 = await call('POST', '/api/devis/numero', { jour: '2026-07-30' });
  assert.strictEqual(ref2.body.numero, 'DEV-26.07.30-002', 'le rang du jour avance');
  const ref3 = await call('POST', '/api/devis/numero', { jour: '2026-07-31' });
  assert.strictEqual(ref3.body.numero, 'DEV-26.07.31-001', 'chaque journée repart à 001');
  // Le compteur des ventes n'a PAS bougé : deux séries, deux clés.
  const vente = await call('POST', '/api/vente/numero', { jour: '2026-07-30' });
  assert.strictEqual(vente.body.numero, '26.07.30-001', 'la série des ventes est indépendante');
  // Jour absent ou illisible : le serveur prend le sien plutôt que de refuser —
  // le comptoir ne s'arrête pas pour une horloge.
  const refSansJour = await call('POST', '/api/devis/numero', {});
  assert.strictEqual(refSansJour.status, 201);
  assert.match(refSansJour.body.numero, /^DEV-\d\d\.\d\d\.\d\d-\d{3}$/);

  // 2. LA DEMANDE COMPLÈTE — deux besoins, aucun prix, brief du client.
  const demande = await call('POST', '/api/projets', {
    kind: 'demande',
    numero: 'DEV-26.07.30-001',
    client: { societe: 'Hôtel Grand Case Beach Club', contact: 'Marie', whatsapp: '0690112233', type: 'pro' },
    lignes: [
      {
        type: 'autres', quantite: 40, designation: 'Tee-shirts manches courtes',
        categorie: 'Textile', reference: 'NS300', couleur: 'Noir', methode: 'DTF',
        explication: 'Logo cœur + dos 30 cm. Tailles S x10 / M x20 / L x10.',
      },
      {
        type: 'autres', quantite: 3, designation: 'Panneaux d’accueil',
        categorie: 'Signalétique', methode: 'TROTEC + UV',
      },
    ],
    deadline: '2026-08-20',
    heureSouhaitee: '14:00',
    priority: 3,
    responsable: 'Mélina',
    stage: 'demande_chiffrage', subStage: 'a_chiffrer',
    demande: {
      priseLe: '2026-07-30', prisePar: 'Mélina', canal: 'WhatsApp',
      objet: 'Équiper le personnel', budget: '1500',
      description: 'Le client souhaite 40 tee-shirts et 3 panneaux.',
      contraintes: 'Validation toujours par WhatsApp.',
      etat: 'partiel', logoType: 'Logo client non vectorisé', logoStatut: 'Reçu',
      vectorisation: 'À chiffrer', maquette: 'À prévoir', transmisPar: 'WhatsApp',
      recus: 'Logo PNG reçu.', aVerifier: 'Confirmer les tailles.',
      suite: 'devis',
    },
  });
  assert.strictEqual(demande.status, 201, JSON.stringify(demande.body));
  const p = demande.body.projet;

  // Le cœur du flux : PAS DE PRIX. Ni sur les lignes, ni au total.
  assert.strictEqual(p.prixTotalTtc, null, 'une demande n’a pas de prix : c’est ce qu’on doit chiffrer');
  assert.strictEqual(p.prixTotalHt, null);
  assert.strictEqual(p.margeHt, null);
  assert.strictEqual(p.lignes[0].prixUnitaireTtc, null);
  assert.strictEqual(p.lignes[1].prixUnitaireTtc, null);

  // La nature tranchée à la prise, et la place au planning.
  assert.strictEqual(p.orderKind, 'demande');
  assert.strictEqual(p.stage, 'demande_chiffrage');
  assert.strictEqual(p.subStage, 'a_chiffrer');
  assert.strictEqual(p.responsable, 'Mélina', 'celle qui a pris la demande la pilote');
  assert.strictEqual(p.priority, 3);
  assert.strictEqual(p.deadline, '2026-08-20');
  assert.strictEqual(p.quantite, 43, 'quantité totale = somme des besoins');

  // Ce que le client a demandé, tel qu'il l'a demandé : la référence et la
  // couleur voulues comptent AVANT qu'un article du catalogue soit choisi.
  assert.strictEqual(p.lignes[0].categorie, 'Textile');
  assert.strictEqual(p.lignes[0].reference, 'NS300');
  assert.strictEqual(p.lignes[0].couleur, 'Noir');
  assert.strictEqual(p.lignes[0].methode, 'DTF');
  assert.strictEqual(p.lignes[0].description, '40 × Tee-shirts manches courtes — réf. NS300 · Noir');
  assert.strictEqual(p.lignes[1].description, '3 × Panneaux d’accueil', 'sans référence ni couleur, la description reste nue');

  // Le brief, validé et rangé.
  assert.strictEqual(p.demande.canal, 'WhatsApp');
  assert.strictEqual(p.demande.budget, 1500, 'le budget est indicatif, il ne devient jamais un prix');
  assert.strictEqual(p.demande.etat.label, 'Informations reçues partiellement');
  assert.strictEqual(p.demande.suite.label, 'Devis à faire');

  // 3. LA LIGNE DU PLANNING — c'est elle que l'atelier voit.
  const lignes = (await call('GET', '/api/requests')).body;
  const ligne = lignes.find((r) => r.id === demande.body.id);
  assert.ok(ligne, 'la demande est bien au planning');
  assert.strictEqual(ligne.project_value, null, 'la colonne Prix TTC reste VIDE, pas à 0,00 €');
  assert.strictEqual(ligne.order_kind, 'demande', 'la nature suit le flux, elle n’est plus figée à « commande »');
  assert.strictEqual(ligne.responsable, 'Mélina');
  assert.strictEqual(ligne.stage, 'demande_chiffrage');
  assert.strictEqual(ligne.sub_stage, 'a_chiffrer');
  assert.strictEqual(ligne.billing_company, 'Hôtel Grand Case Beach Club');
  // Le résumé dit ce qui manque, et porte le brief : celui qui chiffrera n'a pas
  // à rappeler le client.
  assert.match(ligne.description, /Prix : à chiffrer/);
  assert.match(ligne.description, /Demande prise par Mélina via WhatsApp/);
  assert.match(ligne.description, /Objet : Équiper le personnel/);
  assert.match(ligne.description, /Budget indicatif : 1500\.00 €/);
  assert.match(ligne.description, /Dossier : Informations reçues partiellement/);
  assert.match(ligne.description, /Vectorisation : À chiffrer/);
  assert.match(ligne.description, /Suite à donner : Devis à faire/);
  assert.doesNotMatch(ligne.description, /0\.00 € TTC/, 'jamais de prix inventé sur une demande');

  // 4. « Attendre les informations du client » → l'autre sous-étape.
  const attente = await call('POST', '/api/projets', {
    kind: 'demande',
    client: { societe: 'Coco Beach', type: 'pro' },
    lignes: [{ type: 'autres', quantite: 10, designation: 'Casquettes brodées', categorie: 'Casquette' }],
    deadline: '2026-09-01',
    stage: 'demande_chiffrage', subStage: 'demande_a_qualifier',
    demande: {
      prisePar: 'Loïc', canal: 'Téléphone', etat: 'attente',
      attenduPar: 'WhatsApp', attendu: 'Le logo vectorisé et les tailles.',
      suite: 'attente',
    },
  });
  assert.strictEqual(attente.status, 201, JSON.stringify(attente.body));
  assert.strictEqual(attente.body.projet.subStage, 'demande_a_qualifier');
  assert.strictEqual(attente.body.projet.demande.suite.label, 'Attendre les informations du client');
  const ligneAttente = (await call('GET', '/api/requests')).body.find((r) => r.id === attente.body.id);
  assert.match(ligneAttente.description, /Encore attendu \(par WhatsApp\) : Le logo vectorisé/);

  // 5. UNE COMMANDE SANS PRIX RESTE REFUSÉE. La souplesse est réservée à la
  //    demande : une vente qu'on encaisse a forcément un montant.
  const commandeSansPrix = await call('POST', '/api/projets', {
    kind: 'commande',
    client: { societe: 'X', type: 'pro' },
    lignes: [{ type: 'autres', quantite: 1, designation: 'Plaque' }],
    delai: 'j5',
  });
  assert.strictEqual(commandeSansPrix.status, 400, 'une commande sans prix n’entre pas au planning');
  assert.match(commandeSansPrix.body.error, /prix TTC invalide/);

  // 6. Un prix reste possible sur une demande (le comptoir connaît parfois déjà
  //    le tarif) : dans ce cas la ligne est chiffrée, comme avant.
  const demandeChiffree = await call('POST', '/api/projets', {
    kind: 'demande',
    client: { societe: 'Kalatua', type: 'pro' },
    lignes: [{ type: 'autres', quantite: 2, designation: 'Plaque gravée', prixUnitaireTtc: 45 }],
    delai: 'j10',
  });
  assert.strictEqual(demandeChiffree.status, 201, JSON.stringify(demandeChiffree.body));
  assert.strictEqual(demandeChiffree.body.projet.prixTotalTtc, 90);

  // 7. Valeurs inventées : refusées, jamais rangées en silence.
  const etatInconnu = await call('POST', '/api/projets', {
    kind: 'demande',
    client: { societe: 'X', type: 'pro' },
    lignes: [{ type: 'autres', quantite: 1, designation: 'Plaque' }],
    delai: 'j5',
    demande: { etat: 'nimporte-quoi' },
  });
  assert.strictEqual(etatInconnu.status, 400);
  assert.match(etatInconnu.body.error, /état du dossier inconnu/);

  const suiteInconnue = await call('POST', '/api/projets', {
    kind: 'demande',
    client: { societe: 'X', type: 'pro' },
    lignes: [{ type: 'autres', quantite: 1, designation: 'Plaque' }],
    delai: 'j5',
    demande: { suite: 'plus-tard' },
  });
  assert.strictEqual(suiteInconnue.status, 400);
  assert.match(suiteInconnue.body.error, /suite à donner inconnue/);

  console.log('✓ demande de devis : référence du jour, demande sans prix, brief au planning, sous-étapes et refus OK');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
