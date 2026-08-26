'use strict';

// LE BAT VERROUILLE, LES DOCUMENTS SE VERSIONNENT, LE BLOCAGE SE COMPTE.
// ===========================================================================
// §6 (motifs de blocage), §7 (délais), §8 (provenance), §9 (fiche client),
// §19 (versions de devis), §20 (BAT), §22 (retrait), §23 (date prévue).
//
// CE QUI MANQUAIT, point par point :
//   - §20 : les trois sous-étapes DÉCRIVAIENT le BAT, elles ne le
//     garantissaient pas — rien n'empêchait de produire avant validation ;
//   - §19 : un emplacement PDF unique par type, donc le devis V2 ÉCRASAIT le
//     V1 — « quel prix lui avait-on annoncé la première fois ? » n'avait plus
//     de réponse ;
//   - §6 : le motif était une phrase tapée à la main, donc incomptable ;
//   - §9 : la fiche client disait QUI est le client, pas CE QU'IL PÈSE ;
//   - §23 : `deadline` servait à la fois de promesse au client et de planning
//     d'atelier — les confondre, c'est déplacer une promesse en croyant
//     déplacer un planning.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SRV = lire('server.js');
const SQL = lire('schema.sql');
const APP = lire('public/app.js');

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

  const postes = new Map();
  const call = async (qui, method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(postes.get(qui) ? { Cookie: postes.get(qui) } : {}),
        'X-Qui': encodeURIComponent(qui),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) postes.set(qui, set.split(';')[0]);
    const brut = res.status === 204 ? '' : await res.text();
    let corps = null;
    try { corps = brut ? JSON.parse(brut) : null; } catch (_) { corps = brut; }
    return { status: res.status, body: corps };
  };
  const deposer = (qui, id, kind, contenu, nom) => fetch(
    `${base}/api/requests/${id}/pdf/${kind}?name=${encodeURIComponent(nom)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/pdf', 'X-Qui': encodeURIComponent(qui),
        ...(postes.get(qui) ? { Cookie: postes.get(qui) } : {}),
      },
      body: Buffer.from(contenu),
    },
  );

  // =========================================================================
  // 1. LE VERROU DU BAT (§20)
  // =========================================================================
  const c = await call('Mélina', 'POST', '/api/requests', {
    stage: 'preparation', sub_stage: 'prepa_bat', billing_company: 'Hôtel BAT',
    product: 'Serviettes brodées', quantity: 40,
  });
  const id = c.body.id;

  // LE BAT SE MARQUE TOUT SEUL : entrer dans une étape qui parle de BAT, c'est
  // en avoir un. Demander à quelqu'un de cocher « ce dossier a un BAT » revient
  // à ne jamais l'avoir.
  await call('Charlie', 'PATCH', `/api/requests/${id}`, { sub_stage: 'bat_envoye' });
  const arme = await call('Charlie', 'GET', `/api/requests/${id}`);
  assert.strictEqual(arme.body.bat_requis, true, 'le verrou s’arme sans qu’on le demande');

  const refus = await call('Charlie', 'PATCH', `/api/requests/${id}`, {
    stage: 'production', sub_stage: 'prod_dtf',
  });
  assert.strictEqual(refus.status, 409, 'on ne produit pas sans BAT validé');
  assert.strictEqual(refus.body.batBloque, true);
  // ON DIT QUI PEUT PASSER OUTRE : sinon l'employé cherche un bouton qui
  // n'existe pas chez lui — ou contourne par une autre étape, et le verrou
  // n'aura rien gardé.
  assert.ok('forcable' in refus.body, 'la réponse dit si CE poste peut forcer');

  // « MODIFICATION DEMANDÉE » (§20). Sans cette étape, un BAT que le client
  // renvoie à corriger retombait dans « Préparation du BAT » — indiscernable
  // d'un BAT jamais envoyé, alors que là, quelqu'un attend.
  assert.strictEqual(
    (await call('Charlie', 'PATCH', `/api/requests/${id}`, { sub_stage: 'bat_modif' })).status, 200,
    'le client peut demander une correction, et ça se voit',
  );

  const valide = await call('Charlie', 'PATCH', `/api/requests/${id}`, { sub_stage: 'bat_valide' });
  assert.strictEqual(valide.status, 200);
  const date = await call('Charlie', 'GET', `/api/requests/${id}`);
  assert.ok(date.body.bat_valide_le, 'valider un BAT, c’est le DATER');
  assert.strictEqual(
    (await call('Charlie', 'PATCH', `/api/requests/${id}`, { stage: 'production', sub_stage: 'prod_dtf' })).status,
    200, 'BAT validé : la production part',
  );

  // FORCER LE PASSAGE, réservé (§20 : « la Direction peut forcer si nécessaire »).
  const c2 = await call('Mélina', 'POST', '/api/requests', {
    stage: 'preparation', sub_stage: 'bat_envoye', billing_company: 'Hôtel Pressé',
  });
  await call('x', 'PUT', '/api/flags', { comptes: true });
  for (const [prenom, code] of [['Loïc', '3333'], ['Charlie', '4444'], ['Julien', '1111'], ['Mélina', '2222']]) {
    await call(prenom, 'POST', '/api/session', { prenom, code });
  }
  const chef = await call('Charlie', 'PATCH', `/api/requests/${c2.body.id}`, {
    stage: 'production', sub_stage: 'prod_dtf', forcer: true,
  });
  assert.strictEqual(chef.status, 409, 'le chef d’atelier ne passe pas outre le BAT');
  assert.strictEqual(chef.body.forcable, false, '… et l’écran ne lui proposera donc pas de le faire');
  const patron = await call('Loïc', 'PATCH', `/api/requests/${c2.body.id}`, {
    stage: 'production', sub_stage: 'prod_dtf', forcer: true,
  });
  assert.strictEqual(patron.status, 200, 'la Direction, si — et seulement en le disant explicitement');
  // Sans le mot `forcer`, même la Direction est arrêtée : le verrou ne doit pas
  // être invisible pour celui qui a le droit de le lever.
  const c3 = await call('Mélina', 'POST', '/api/requests', {
    stage: 'preparation', sub_stage: 'bat_envoye', billing_company: 'Hôtel Trois',
  });
  assert.strictEqual(
    (await call('Loïc', 'PATCH', `/api/requests/${c3.body.id}`, { stage: 'production' })).status, 409,
    'forcer se DEMANDE : un droit n’est pas un passe-droit automatique',
  );

  // =========================================================================
  // 2. LES VERSIONS DE DOCUMENT (§19)
  // =========================================================================
  const d = await call('Mélina', 'POST', '/api/requests', {
    stage: 'demande_chiffrage', billing_company: 'Devis versionné',
  });
  const did = d.body.id;
  for (const v of [1, 2, 3]) {
    const r = await deposer('Mélina', did, 'devis', `%PDF-1.4 devis V${v}`, `devis-v${v}.pdf`);
    assert.ok(r.ok, `le devis V${v} se dépose`);
  }
  const versions = await call('Mélina', 'GET', `/api/requests/${did}/pdf/devis/versions`);
  assert.strictEqual(versions.status, 200,
    'la liste des versions doit répondre EN LOCAL : pg-mem ne gère pas les sous-requêtes corrélées');
  assert.deepStrictEqual(versions.body.map((v) => v.version), [2, 1],
    'V1 et V2 sont archivées ; V3 est la version courante');
  assert.strictEqual(versions.body[0].filename, 'devis-v2.pdf');
  assert.strictEqual(versions.body[0].qui, 'Mélina', 'chaque version dit qui l’a déposée');

  const v1 = await fetch(`${base}/api/requests/${did}/pdf/devis/versions/1`,
    { headers: { Cookie: postes.get('Mélina') } });
  assert.strictEqual(await v1.text(), '%PDF-1.4 devis V1', 'la V1 se relit telle qu’elle était');
  const courant = await fetch(`${base}/api/requests/${did}/pdf/devis`,
    { headers: { Cookie: postes.get('Mélina') } });
  assert.strictEqual(await courant.text(), '%PDF-1.4 devis V3', '… et la courante reste la dernière');

  // DÉPOSER UN BAT ARME LE VERROU, même sans passer par les sous-étapes.
  await deposer('Mélina', did, 'bat', '%PDF-1.4 bat', 'bat.pdf');
  const armeParPdf = await call('Mélina', 'GET', `/api/requests/${did}`);
  assert.strictEqual(armeParPdf.body.bat_requis, true, 'déposer un BAT, c’est en avoir un');

  // =========================================================================
  // 3. LES MOTIFS DE BLOCAGE (§6)
  // =========================================================================
  const motifs = await call('Charlie', 'GET', '/api/motifs-blocage');
  assert.deepStrictEqual(
    motifs.body.map((m) => m.label),
    ['Attente client', 'Attente fournisseur', 'Problème machine', 'Fichier manquant',
      'BAT non validé', 'Paiement manquant', 'Rupture de stock'],
    'les sept motifs du patron, dans son ordre',
  );
  // L'écran porte la MÊME liste : elle est écrite des deux côtés (sept libellés
  // fixes ne valent pas un aller-retour réseau à l'ouverture d'un menu), donc
  // les deux doivent rester d'accord.
  const cote = APP.slice(APP.indexOf('const MOTIFS_BLOCAGE'), APP.indexOf('function openReasonPrompt'));
  for (const m of motifs.body) {
    assert.ok(cote.includes(m.label), `« ${m.label} » doit exister des DEUX côtés`);
  }
  // Le texte libre reste possible : un blocage hors case existe.
  const libre = await call('Charlie', 'PATCH', `/api/requests/${did}`, {
    flag: 'bloque', flag_reason: 'Le graphiste est en congé jusqu’au 3',
  });
  assert.strictEqual(libre.status, 200, 'un motif hors liste s’écrit quand même');

  // =========================================================================
  // 4. LA FICHE CLIENT DIT CE QU'IL PÈSE (§9)
  // =========================================================================
  const cl = await call('Mélina', 'POST', '/api/clients', { entreprise: 'Hôtel Esmeralda Poids' });
  for (const prix of [1200, 800, 450]) {
    await call('Mélina', 'POST', '/api/requests', {
      stage: 'facturation', billing_company: 'Hôtel Esmeralda Poids', project_value: prix,
    });
  }
  const fiche = await call('Loïc', 'GET', `/api/clients/${cl.body.id}`);
  assert.strictEqual(fiche.body.ca, 2450, 'le chiffre d’affaires du client');
  assert.ok(fiche.body.derniere_commande, '… et sa dernière commande');
  assert.strictEqual(fiche.body.dernieres.length, 3, '… avec ce qu’il a commandé');

  // Le CA ne sort pas de qui voit l'argent : sur un poste d'atelier, une fiche
  // client ne doit pas annoncer ce que le client a dépensé.
  const ficheAtelier = await call('Julien', 'GET', `/api/clients/${cl.body.id}`);
  assert.strictEqual(ficheAtelier.body.ca, undefined, 'l’atelier ne voit pas le CA du client');
  assert.ok(ficheAtelier.body.entreprise, '… mais il voit bien la fiche');

  // =========================================================================
  // 5. DATE PRÉVUE ≠ DATE SOUHAITÉE (§23), CRÉNEAU DE RETRAIT (§22)
  // =========================================================================
  await call('Mélina', 'PATCH', `/api/requests/${did}`, { deadline: '2026-09-30' });
  const planif = await call('Charlie', 'PATCH', `/api/requests/${did}`, { date_prevue: '2026-09-25' });
  assert.strictEqual(planif.status, 200);
  const relu = await call('Charlie', 'GET', `/api/requests/${did}`);
  assert.ok(String(relu.body.deadline).startsWith('2026-09-30'), 'la promesse au client ne bouge pas');
  assert.ok(String(relu.body.date_prevue).startsWith('2026-09-25'), '… et le planning de l’atelier vit à côté');
  // Planifier appartient à l'atelier ; promettre appartient à la boutique.
  assert.strictEqual(
    (await call('Mélina', 'PATCH', `/api/requests/${did}`, { date_prevue: '2026-09-20' })).status, 403,
    'la boutique promet, elle ne planifie pas',
  );

  const retrait = await call('Mélina', 'PATCH', `/api/requests/${did}`, { retrait_creneau: '14:00' });
  assert.strictEqual(retrait.status, 200, 'le créneau de retrait se pose depuis la boutique');

  // =========================================================================
  // 6. LES DEUX BARÈMES DE DÉLAI (§7)
  // =========================================================================
  const delais = await call('Loïc', 'GET', '/api/delais');
  const jourJ = delais.body.delais.find((x) => x.id === 'jour_j');
  const express = delais.body.delais.find((x) => x.id === 'express');
  assert.strictEqual(jourJ.majoration, 20, 'Jour J : +20 %, exactement la règle du patron');
  assert.strictEqual(express.majoration, 10, 'Express sous 3 jours : +10 %');
  // LE SECOND BARÈME EST RENDU À CÔTÉ, PAS FUSIONNÉ. Les réconcilier en silence
  // changerait des prix sans que personne l'ait décidé.
  assert.ok(delais.body.supplementsVenteDirecte,
    'le barème de la vente directe est SIGNALÉ, pas fondu dans l’autre');

  // =========================================================================
  // 7. CE QUI SE LIT DANS LE SOURCE
  // =========================================================================
  // L'archivage d'une version est ADDITIF : aucune migration destructive sur
  // une table qui porte déjà des PDF en production.
  assert.ok(/CREATE TABLE IF NOT EXISTS attachment_versions/.test(SQL));
  assert.ok(/PRIMARY KEY \(request_id, kind\)/.test(SQL),
    '`attachments` garde sa clé : tout le code existant continue de la lire');
  assert.ok(/CREATE UNIQUE INDEX IF NOT EXISTS idx_att_versions/.test(SQL),
    'deux dépôts simultanés ne peuvent pas prendre le même numéro de version');
  assert.ok(/err\.code === '23505' && essai === 0/.test(SRV),
    '… et le perdant relit puis réessaie UNE fois — pas en boucle');

  // L'historique ne doit jamais faire échouer le dépôt : perdre une archive est
  // ennuyeux, perdre le devis qu'on vient de déposer est bien pire.
  assert.ok(/archiverVersion\([\s\S]{0,60}?\)\.catch\(/.test(SRV),
    'un historique en panne ne bloque pas le dépôt du document');

  // L'écran propose de forcer plutôt que de laisser chercher.
  assert.ok(/d\.batBloque && d\.forcable/.test(APP),
    'quand le serveur refuse ET que le poste peut forcer, l’écran le PROPOSE');
  assert.ok(/err\.detail = corps;/.test(APP),
    'le corps du refus voyage avec l’erreur — sinon un 409 n’est qu’un texte');

  // =========================================================================
  // 8. UNE SEULE RECHERCHE POUR TOUT (§44)
  // =========================================================================
  // « Créer UNE recherche permettant de retrouver rapidement : client, société,
  //   numéro projet, référence produit, téléphone, email. » Il y en avait
  //   TROIS : la palette (commandes), la Base clients, le Stock. Chacune
  //   marchait ; aucune ne répondait à la question telle qu'elle se pose — « où
  //   est ce truc ? », pas « dans quelle table est ce truc ? ».
  await call('Mélina', 'POST', '/api/requests', {
    stage: 'production', sub_stage: 'prod_dtf', billing_company: 'Native Beach Bar',
    product: 'T-shirts staff', quantity: 30,
  });
  await call('Mélina', 'POST', '/api/clients', { entreprise: 'Native Spirit Boutique', ville: 'Marigot' });
  // MÉLINA et pas Charlie : créer au catalogue relève de la capacité `clients`,
  // que le chef d'atelier n'a pas. Le test s'était trompé de personne — et c'est
  // la permission qui avait raison.
  const auCatalogue = await call('Mélina', 'POST', '/api/produits', {
    designation: 'T-shirt NS300', marque: 'Native Spirit', ref_interne: 'OLDA-TS-001',
  });
  assert.strictEqual(auCatalogue.status, 201, JSON.stringify(auCatalogue.body));

  const globale = await call('Loïc', 'GET', '/api/recherche?q=native');
  assert.strictEqual(globale.status, 200);
  assert.ok(globale.body.commandes.some((c) => c.billing_company === 'Native Beach Bar'),
    'un seul mot trouve la commande…');
  assert.ok(globale.body.clients.some((c) => c.entreprise === 'Native Spirit Boutique'),
    '… le client, même sans commande…');
  assert.ok(globale.body.produits.some((x) => x.designation === 'T-shirt NS300'),
    '… et le produit au catalogue');

  // Une référence interne suffit — c'est ce qu'on a sous les yeux sur l'étagère.
  const parRef = await call('Loïc', 'GET', '/api/recherche?q=OLDA-TS-001');
  assert.ok(parRef.body.produits.length, 'la référence interne trouve le produit');

  // L'ARCHIVE NE REMONTE PAS. Une recherche qui rend des dossiers retirés du
  // planning ferait rouvrir ce qu'on vient de ranger.
  const aRetirer = await call('Mélina', 'POST', '/api/requests', {
    stage: 'production', billing_company: 'Native Fantome',
  });
  await call('Charlie', 'DELETE', `/api/requests/${aRetirer.body.id}`);
  const apres = await call('Loïc', 'GET', '/api/recherche?q=fantome');
  assert.strictEqual(apres.body.commandes.length, 0, 'une commande archivée ne remonte pas');

  // Rien à chercher = rien à répondre, sans balayer trois tables pour le dire.
  const vide = await call('Loïc', 'GET', '/api/recherche?q=');
  assert.deepStrictEqual(vide.body, { commandes: [], clients: [], produits: [] });

  // Côté écran : une commande passe TOUJOURS par le chemin unique, un client et
  // un produit vont sur LEUR écran — les envoyer au planning chercherait une
  // commande qui n'existe pas, et le clic semblerait ne rien faire.
  assert.ok(/GROUPE_RECHERCHE = \{ __clients: 'Clients', __produits: 'Catalogue' \}/.test(APP),
    'les deux natures qui ne sont pas des commandes ont leur groupe');
  assert.ok(/olda:chercher-client/.test(APP) && /olda:chercher-produit/.test(APP),
    'cliquer un client ou un produit emmène l’écran d’arrivée sur CE résultat');

  console.log('✓ BAT verrouillé, devis versionnés, motifs comptables, client pesé, UNE recherche');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
