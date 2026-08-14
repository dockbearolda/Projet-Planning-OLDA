'use strict';

// AUDIT DU 05/08 AU SOIR — les huit problèmes trouvés en relisant l'outil, et
// ce qui les empêche de revenir. Chacun est REPRODUIT ici tel qu'il se produit
// à l'atelier, pas décrit en principe.
//
//   1. Deux envois SIMULTANÉS du même dossier comptoir (la tablette rame, la
//      vendeuse tape deux fois) créaient deux commandes sous le même numéro de
//      ticket. La garde d'idempotence lisait, puis écrivait : rien entre les deux.
//   2. Un PATCH qui ne parle que de l'étape laissait la sous-étape de l'ancienne
//      famille en place. Le rail affichait alors « Production UV — 1 commande »
//      et la liste était vide : un badge fantôme que rien n'éteignait.
//   3. La liste d'une étape partait ENTIÈRE. Rien ne quitte jamais le planning :
//      l'étape de clôture garde tout l'historique, et la tablette finit par se
//      figer dessus.
//   4. Le Point du jour retéléchargeait tout le planning à chaque évènement
//      temps réel, sur chaque poste.
//   5. Un client né d'une prise de commande n'avait pas de code lisible, alors
//      que la création manuelle en attribuait un.
//   6. Deux fiches pouvaient naître pour le même client (lecture puis écriture).
//   7. Le fichier d'import contenait neuf sociétés en double, entrées telles
//      quelles dans la base du patron.
//   8. Corriger le détail d'une fiche ne laissait AUCUNE trace dans l'historique.

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

  const brut = (method, path, body) => fetch(base + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const call = async (method, path, body) => {
    const res = await brut(method, path, body);
    return {
      status: res.status,
      tronquee: Number(res.headers.get('X-Liste-Tronquee') || 0),
      body: res.status === 204 ? null : await res.json(),
    };
  };

  // -------------------------------------------------------------------------
  // 1. DOUBLE-TAP AU COMPTOIR — un dossier, une commande.
  // -------------------------------------------------------------------------
  const dossier = {
    source: 'Vente directe',
    stage: 'preparation',
    ref: '26.08.05-101',
    clientObj: { type: 'Professionnel', company: 'Doublon Test SARL', phone: '0690000001' },
    name: '12 mugs personnalisés',
    quantity: 12,
    amount: '180.00',
    recap: 'Récapitulatif de la vente',
    client_info: [['Société', 'Doublon Test SARL']],
    details: [['Objet', '12 mugs personnalisés']],
  };

  // Le geste réel : deux envois EXACTEMENT identiques, partis ensemble.
  const [a, b] = await Promise.all([
    call('POST', '/api/comptoir/projet', dossier),
    call('POST', '/api/comptoir/projet', dossier),
  ]);
  assert.strictEqual(a.body.id, b.body.id, 'le même dossier envoyé deux fois = UNE commande');
  assert.ok(a.body.dejaEnregistre || b.body.dejaEnregistre, 'le second envoi doit se dire déjà enregistré');

  // Le dossier attend dans le sur-dossier du comptoir : c'est là qu'on compte.
  const enAttente = await call('GET', '/api/requests?stage=a_trier');
  const jumelles = enAttente.body.filter((r) => r.billing_company === 'Doublon Test SARL');
  assert.strictEqual(jumelles.length, 1, `une seule ligne attendue, reçu ${jumelles.length}`);
  assert.strictEqual(jumelles[0].fiche.ref, '26.08.05-101', 'le numéro de ticket est conservé');

  // Un AUTRE dossier qui porte la même référence (deux postes hors réseau) doit
  // vivre quand même, sous une référence distincte. C'est l'acquis du 05/08 : on
  // vérifie que la file ne l'a pas repris.
  const autre = await call('POST', '/api/comptoir/projet', {
    ...dossier, name: '30 t-shirts', quantity: 30, amount: '450.00',
  });
  assert.strictEqual(autre.status, 201, 'un autre dossier de même référence doit vivre');
  assert.ok(autre.body.refModifiee, 'et sa référence doit être signalée comme changée');

  // -------------------------------------------------------------------------
  // 2. PAIRE ÉTAPE / SOUS-ÉTAPE — changer de famille efface la sous-étape.
  // -------------------------------------------------------------------------
  const creee = await call('POST', '/api/requests', {
    billing_company: 'Cohérence Test', stage: 'production', sub_stage: 'prod_uv',
  });
  const idCoherence = creee.body.id;

  const deplacee = await call('PATCH', `/api/requests/${idCoherence}`, { stage: 'facturation' });
  assert.strictEqual(deplacee.status, 200);
  assert.strictEqual(deplacee.body.stage, 'facturation');
  assert.strictEqual(deplacee.body.sub_stage, null, 'la sous-étape de production ne suit pas en facturation');

  const compteurs = await call('GET', '/api/counts');
  assert.strictEqual(compteurs.body.prod_uv, 0, 'aucun badge fantôme sur la sous-étape quittée');

  // Rester dans la MÊME famille ne doit rien effacer : préciser le prix d'une
  // commande en production ne lui fait pas perdre sa machine.
  const enProd = await call('POST', '/api/requests', {
    billing_company: 'Même famille', stage: 'production', sub_stage: 'prod_pressage',
  });
  const inchangee = await call('PATCH', `/api/requests/${enProd.body.id}`, { project_value: 90 });
  assert.strictEqual(inchangee.body.sub_stage, 'prod_pressage', 'la sous-étape reste dans sa famille');

  // Et la paire franchement incohérente reste refusée, comme avant.
  const refus = await call('PATCH', `/api/requests/${enProd.body.id}`, {
    stage: 'facturation', sub_stage: 'prod_uv',
  });
  assert.strictEqual(refus.status, 400, 'une sous-étape d\'une autre famille est refusée');

  // -------------------------------------------------------------------------
  // 3. PLAFOND DE LA LISTE — on rend la FIN de l'étape, pas son début.
  // -------------------------------------------------------------------------
  // On dépasse le plafond du serveur (400) sur une étape dédiée.
  const TOTAL = 410;
  for (let i = 0; i < TOTAL; i += 1) {
    // `position` croissante : la dernière créée est la dernière de la liste.
    await call('POST', '/api/requests', {
      billing_company: `Clôture ${String(i).padStart(3, '0')}`,
      stage: 'paiement', position: (i + 1) * 10,
    });
  }

  const bornee = await call('GET', '/api/requests?stage=paiement');
  assert.strictEqual(bornee.tronquee, 400, 'le serveur annonce le plafond appliqué');
  assert.strictEqual(bornee.body.length, 400, 'la liste est bornée à 400 lignes');
  // Ce sont bien les DERNIÈRES : la toute dernière créée doit y être, la
  // première non. L'inverse (prendre le début) donnerait l'historique le plus
  // ancien — exactement ce que personne ne vient consulter.
  const noms = bornee.body.map((r) => r.billing_company);
  assert.ok(noms.includes(`Clôture ${String(TOTAL - 1).padStart(3, '0')}`), 'la plus récente est affichée');
  assert.ok(!noms.includes('Clôture 000'), 'la plus ancienne est hors du plafond');
  // Et l'ordre d'affichage reste celui de l'étape (croissant), pas l'inverse.
  assert.ok(noms[0] < noms[noms.length - 1], 'la liste bornée est rendue dans le bon sens');

  const entiere = await call('GET', '/api/requests?stage=paiement&tout=1');
  assert.strictEqual(entiere.tronquee, 0, '« tout » ne signale aucune troncature');
  assert.ok(entiere.body.length >= TOTAL, 'et rend bien toute l\'étape');

  // -------------------------------------------------------------------------
  // 4. SYNTHÈSE INCRÉMENTALE — le Point du jour ne retélécharge que le delta.
  // -------------------------------------------------------------------------
  const complet = await call('GET', '/api/requests/synthese');
  assert.ok(Array.isArray(complet.body.ids), 'la synthèse rend la composition du planning');
  assert.ok(complet.body.lignes.length === complet.body.ids.length, 'premier appel : tout part');
  assert.ok(complet.body.jusqua, 'et un horodatage serveur pour la suite');
  // La synthèse ne transporte PAS la fiche : c'est elle qui pesait le plus lourd.
  assert.ok(!('fiche' in complet.body.lignes[0]), 'la synthèse ne transporte pas le détail des fiches');

  const depuis = encodeURIComponent(complet.body.jusqua);
  const rien = await call('GET', `/api/requests/synthese?depuis=${depuis}`);
  assert.strictEqual(rien.body.lignes.length, 0, 'rien n\'a bougé : aucune ligne ne repart');
  assert.strictEqual(rien.body.ids.length, complet.body.ids.length, 'la composition, elle, est toujours rendue');

  // Une seule commande change → une seule ligne repart.
  await call('PATCH', `/api/requests/${idCoherence}`, { priority: 3 });
  const delta = await call('GET', `/api/requests/synthese?depuis=${depuis}`);
  assert.strictEqual(delta.body.lignes.length, 1, 'une modification = une ligne dans la synthèse');
  assert.strictEqual(delta.body.lignes[0].id, idCoherence);

  // Une suppression se lit dans `ids` : la commande n'y est plus.
  await call('DELETE', `/api/requests/${idCoherence}`);
  const apresSuppression = await call('GET', `/api/requests/synthese?depuis=${depuis}`);
  assert.ok(!apresSuppression.body.ids.includes(idCoherence), 'la commande supprimée sort de la composition');

  // -------------------------------------------------------------------------
  // 5 & 6. BASE CLIENTS — code lisible, et une seule fiche par client.
  // -------------------------------------------------------------------------
  const clients = await call('GET', '/api/clients');
  const neDuComptoir = clients.body.find((c) => c.entreprise === 'Doublon Test SARL');
  assert.ok(neDuComptoir, 'la prise de commande crée la fiche client');
  assert.match(
    neDuComptoir.code || '', /^CLI-PRO-\d{4}$/,
    `un client né d'une commande doit avoir un code lisible, reçu ${neDuComptoir.code}`,
  );

  // Tous les clients — y compris ceux de l'import initial — en ont un.
  assert.ok(clients.body.every((c) => c.code), 'aucune fiche client sans code');
  const codes = clients.body.map((c) => c.code);
  assert.strictEqual(new Set(codes).size, codes.length, 'aucun code attribué deux fois');

  // Le même client, écrit autrement, ne crée pas une seconde fiche.
  const avant = (await call('GET', '/api/clients')).body.length;
  await call('POST', '/api/comptoir/projet', {
    source: 'Vente directe', stage: 'preparation', ref: '26.08.05-102',
    clientObj: { type: 'Professionnel', company: 'doublon test sarl' },
    name: 'Une casquette', quantity: 1, amount: '15.00',
  });
  const apres = (await call('GET', '/api/clients')).body.length;
  assert.strictEqual(apres, avant, '« doublon test sarl » est le même client que « Doublon Test SARL »');

  // Et la création manuelle d'un client déjà présent est refusée, pas dédoublée.
  const enDouble = await call('POST', '/api/clients', { entreprise: 'Doublon Test SARL' });
  assert.strictEqual(enDouble.status, 409, 'créer un client déjà présent est refusé');

  // -------------------------------------------------------------------------
  // 7. L'IMPORT INITIAL — neuf sociétés y figuraient deux fois.
  // -------------------------------------------------------------------------
  const cles = clients.body.map((c) => c.entreprise.trim().toLowerCase());
  assert.strictEqual(new Set(cles).size, cles.length, 'aucune société en double dans la base clients');

  // -------------------------------------------------------------------------
  // 8. JOURNAL — corriger une fiche laisse une trace.
  // -------------------------------------------------------------------------
  const idVente = jumelles[0].id;
  const avantJournal = (await call('GET', `/api/requests/${idVente}/journal`)).body.length;

  const corrigee = await call('PATCH', `/api/requests/${idVente}/fiche`, {
    heureSouhaitee: '16:30',
    details: ['24 mugs personnalisés'],
  });
  assert.strictEqual(corrigee.status, 200);

  const journal = (await call('GET', `/api/requests/${idVente}/journal`)).body;
  assert.ok(journal.length > avantJournal, 'une correction de fiche entre au journal');
  const champs = journal.map((l) => l.field);
  assert.ok(champs.includes('fiche_heure'), 'l\'heure de retrait est journalisée nommément');
  assert.ok(champs.includes('fiche_detail'), 'la correction du détail est journalisée');
  const heure = journal.find((l) => l.field === 'fiche_heure');
  assert.strictEqual(heure.value_after, '16:30', 'et le journal porte la nouvelle heure');

  // Réenregistrer la MÊME chose n'ajoute rien : le journal raconte ce qui a
  // changé, il ne compte pas les clics sur « Enregistrer ».
  await call('PATCH', `/api/requests/${idVente}/fiche`, { heureSouhaitee: '16:30' });
  const journalBis = (await call('GET', `/api/requests/${idVente}/journal`)).body;
  assert.strictEqual(journalBis.length, journal.length, 'une correction sans changement n\'écrit rien');

  console.log('✓ audit du 05/08 (soir) : double-tap comptoir, cohérence étape, plafond de liste,');
  console.log('  synthèse incrémentale, code client, dédoublonnage et journal de fiche OK');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
