'use strict';

// ROBUSTESSE — les garde-fous qui protègent une journée d'atelier réelle :
// plusieurs postes qui écrivent en même temps, un réseau de tablette capricieux,
// un conteneur qui tourne en UTC alors que l'atelier est aux Antilles.
//
// Chacun de ces cas a été trouvé par audit sur du code qui, sans ces tests,
// « passait » : le bug ne se voit qu'en concurrence, le soir, ou au retry.

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
    const texte = await res.text();
    return { status: res.status, body: texte ? JSON.parse(texte) : null };
  };

  // -------------------------------------------------------------------------
  // 1. Deux comptoirs qui encaissent EN MÊME TEMPS n'obtiennent jamais le même
  //    numéro de ticket. C'est la promesse faite au client sur son ticket.
  // -------------------------------------------------------------------------
  const jour = '2026-08-04';
  const enParallele = await Promise.all(
    Array.from({ length: 12 }, () => call('POST', '/api/vente/numero', { jour })),
  );
  const numeros = enParallele.map((r) => r.body.numero);
  assert.strictEqual(new Set(numeros).size, 12,
    `12 encaissements simultanés = 12 numéros distincts (obtenu : ${numeros.join(', ')})`);
  const rangs = enParallele.map((r) => r.body.rang).sort((a, b) => a - b);
  assert.deepStrictEqual(rangs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    'la série est continue : aucun rang sauté ni doublé');

  // Le préfixe de la demande de devis vit sur SA propre série.
  const devis = await call('POST', '/api/devis/numero', { jour });
  assert.match(devis.body.numero, /^DEV-26\.08\.04-001$/,
    'la série des devis est indépendante de celle des ventes');

  // -------------------------------------------------------------------------
  // 2. Deux fiches clients créées en même temps ne partagent pas leur code.
  // -------------------------------------------------------------------------
  const clients = await Promise.all(
    Array.from({ length: 8 }, (_, i) => call('POST', '/api/clients', { entreprise: `Simultané ${i}` })),
  );
  const codes = clients.map((c) => c.body.code);
  assert.strictEqual(new Set(codes).size, 8, `8 créations simultanées = 8 codes distincts (${codes})`);

  // -------------------------------------------------------------------------
  // 3. IDEMPOTENCE du comptoir : le réseau de la tablette peut avaler la
  //    réponse d'un envoi qui a pourtant abouti. La vendeuse réessaie — et la
  //    vente ne doit PAS entrer deux fois sous le même numéro de ticket.
  // -------------------------------------------------------------------------
  const vente = {
    source: 'Vente directe', stage: 'preparation', status: 'Préparation des produits',
    ref: '26.08.04-777', client: 'Client Retry', clientObj: { company: 'Client Retry', type: 'Professionnel' },
    name: 'Tee-shirts', quantity: 3, amount: 60, due: jour,
  };
  const premier = await call('POST', '/api/comptoir/projet', vente);
  assert.strictEqual(premier.status, 201);
  const rejeu = await call('POST', '/api/comptoir/projet', vente);
  assert.strictEqual(rejeu.body.id, premier.body.id, 'le rejeu rend la ligne déjà créée');
  assert.strictEqual(rejeu.body.dejaEnregistre, true, 'et le dit franchement');

  const toutes = (await call('GET', '/api/requests')).body;
  const memeTicket = toutes.filter((r) => r.fiche && r.fiche.ref === '26.08.04-777');
  assert.strictEqual(memeTicket.length, 1, 'une seule ligne au planning pour un seul encaissement');

  // -------------------------------------------------------------------------
  // 3 bis. …MAIS une référence déjà prise ne prouve pas qu'il s'agit du même
  //    dossier. Quand le compteur du serveur est injoignable, chaque écran se
  //    donne une référence de secours tirée d'un compteur LOCAL qui repart à 1
  //    chaque matin : deux postes hors réseau tombaient sur la MÊME. Le second
  //    dossier était alors jeté EN SILENCE — l'écran annonçait un succès et
  //    sautait sur la ligne de la collègue. C'est le scénario des dossiers
  //    perdus des 03-04/08. Il doit désormais VIVRE, sous une autre référence.
  // -------------------------------------------------------------------------
  const autreDossier = await call('POST', '/api/comptoir/projet', {
    ...vente,
    client: 'Autre Cliente', clientObj: { company: 'Autre Cliente', type: 'Professionnel' },
    name: 'Mugs', quantity: 12, amount: 240,
  });
  assert.strictEqual(autreDossier.status, 201, 'un dossier DIFFÉRENT n’est jamais avalé');
  assert.notStrictEqual(autreDossier.body.id, premier.body.id, 'et ce n’est pas la ligne de la collègue');
  assert.strictEqual(autreDossier.body.refModifiee, '26.08.04-777-2',
    'il prend une référence distincte, et le dit pour qu’on corrige le ticket');

  const apresCollision = (await call('GET', '/api/requests')).body;
  const ligneSauvee = apresCollision.find((r) => r.id === autreDossier.body.id);
  assert.strictEqual(ligneSauvee.billing_company, 'Autre Cliente', 'le bon dossier, avec son bon client');
  assert.strictEqual(ligneSauvee.fiche.ref, '26.08.04-777-2');
  assert.strictEqual(
    apresCollision.filter((r) => r.fiche && r.fiche.ref === '26.08.04-777').length, 1,
    'la première ligne n’a pas bougé',
  );

  // Et le RENVOI de ce second dossier reste idempotent : il retrouve SA ligne,
  // pas celle de la première, malgré la référence d'origine identique.
  const rejeuSecond = await call('POST', '/api/comptoir/projet', {
    ...vente,
    client: 'Autre Cliente', clientObj: { company: 'Autre Cliente', type: 'Professionnel' },
    name: 'Mugs', quantity: 12, amount: 240,
  });
  assert.strictEqual(rejeuSecond.body.id, autreDossier.body.id,
    'le rejeu du second dossier retrouve SA ligne');
  assert.strictEqual(rejeuSecond.body.dejaEnregistre, true);

  // Un montant illisible n'est plus « pas de prix » : c'est une faute de frappe,
  // et une vente sans montant ne se découvre qu'à la facturation.
  const montantIllisible = await call('POST', '/api/comptoir/projet', {
    source: 'Vente directe', ref: '26.08.04-999', client: 'Faute Frappe',
    clientObj: { company: 'Faute Frappe' }, name: 'Polo', amount: '12,50 €',
  });
  assert.strictEqual(montantIllisible.status, 400, 'un montant illisible est refusé, pas effacé');

  // -------------------------------------------------------------------------
  // 4. Une DEMANDE de devis sans date souhaitée n'a pas d'échéance : la dater
  //    du jour la faisait paraître en retard dès le lendemain.
  // -------------------------------------------------------------------------
  const demandeSansDate = await call('POST', '/api/comptoir/projet', {
    source: 'Demande de devis', stage: 'demande', status: 'À chiffrer',
    ref: 'DEV-26.08.04-777', client: 'Sans Date', clientObj: { company: 'Sans Date' },
    name: 'À chiffrer',
  });
  assert.strictEqual(demandeSansDate.status, 201);
  const ligneDemande = (await call('GET', '/api/requests')).body
    .find((r) => r.id === demandeSansDate.body.id);
  assert.strictEqual(ligneDemande.deadline, null, 'pas de date souhaitée = pas d’échéance inventée');
  assert.strictEqual(ligneDemande.project_value, null, 'et toujours aucun prix (jamais 0 €)');

  // Une VENTE sans date, elle, garde le jour même : le client repart avec.
  const venteSansDate = await call('POST', '/api/comptoir/projet', {
    source: 'Vente directe', stage: 'facturation', status: 'Commande récupérée',
    ref: '26.08.04-778', client: 'Compta', clientObj: { company: 'Compta' }, name: 'Sticker', amount: 5,
  });
  const ligneVente = (await call('GET', '/api/requests')).body.find((r) => r.id === venteSansDate.body.id);
  assert.ok(ligneVente.deadline, 'une vente garde une échéance par défaut');

  // -------------------------------------------------------------------------
  // 5. VALIDATION : ce qui est refusé l'est avec un 400 qui explique, pas un
  //    500 — et surtout rien n'entre en base qui empoisonnerait l'écran.
  // -------------------------------------------------------------------------
  const ligne = await call('POST', '/api/requests', { billing_company: 'Contrôles' });
  const id = ligne.body.id;

  const dateImpossible = await call('PATCH', `/api/requests/${id}`, { deadline: '2026-02-30' });
  assert.strictEqual(dateImpossible.status, 400, 'le 30 février est refusé, pas transformé en 500');

  const positionInfinie = await call('PATCH', `/api/requests/${id}`, { position: 'Infinity' });
  assert.strictEqual(positionInfinie.status, 400,
    'une position infinie figerait DÉFINITIVEMENT l’ordre de toute l’étape');

  const texteObjet = await call('PATCH', `/api/requests/${id}`, { product: { x: 1 } });
  assert.strictEqual(texteObjet.status, 400, 'un objet dans un champ texte est refusé');

  const texteLong = await call('PATCH', `/api/requests/${id}`, { billing_company: 'z'.repeat(500) });
  assert.strictEqual(texteLong.status, 200);
  assert.strictEqual(texteLong.body.billing_company.length, 120, 'les textes libres restent bornés');

  // Un identifiant qui n'a pas la forme d'un UUID est une ressource absente,
  // pas une panne du serveur.
  const idBancal = await call('GET', '/api/clients/pas-un-uuid');
  assert.strictEqual(idBancal.status, 404, 'un identifiant mal formé rend 404, pas 500');

  // Le détail technique de l'erreur ne part jamais dans le navigateur.
  assert.ok(!('detail' in (idBancal.body || {})), 'aucun détail interne exposé au client');

  // -------------------------------------------------------------------------
  // 6. Le fichier déposé dans un emplacement PDF est bien un PDF.
  // -------------------------------------------------------------------------
  const faux = await fetch(`${base}/api/requests/${id}/pdf/devis?name=piege.pdf`, {
    method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('PK pas un pdf'),
  });
  assert.strictEqual(faux.status, 400, 'un fichier qui n’est pas un PDF est refusé à l’entrée');

  const vrai = await fetch(`${base}/api/requests/${id}/pdf/devis?name=devis.pdf`, {
    method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-1.4\nvrai'),
  });
  assert.strictEqual(vrai.status, 200, 'un vrai PDF passe');

  // Deux dépôts simultanés sur le MÊME emplacement : le dernier gagne, aucun
  // n'échoue (en delete + insert, le second violait la clé primaire → 500).
  const simultanes = await Promise.all([1, 2, 3].map((n) => fetch(
    `${base}/api/requests/${id}/pdf/bat?name=bat${n}.pdf`,
    { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from(`%PDF-1.4\nbat${n}`) },
  )));
  assert.ok(simultanes.every((r) => r.ok), 'trois dépôts simultanés, aucun rejet');

  // -------------------------------------------------------------------------
  // 7. FUSEAU DE L'ATELIER. La prod tourne en UTC, l'atelier est à Saint-Martin
  //    (UTC−4) : dès 20 h locales, une date calculée en UTC saute au LENDEMAIN.
  // -------------------------------------------------------------------------
  const formatAtelier = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.ATELIER_TZ || 'America/Marigot',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const aujourdhuiAtelier = formatAtelier.format(new Date());
  const venteAujourdhui = await call('POST', '/api/comptoir/projet', {
    source: 'Vente directe', stage: 'preparation', status: 'Préparation des produits',
    ref: '26.08.04-779', client: 'Fuseau', clientObj: { company: 'Fuseau' }, name: 'Test', amount: 10,
  });
  const ligneFuseau = (await call('GET', '/api/requests')).body
    .find((r) => r.id === venteAujourdhui.body.id);
  // `slice(0, 10)` : en local la base est pg-mem, qui rend un horodatage complet
  // là où le vrai PostgreSQL rend « aaaa-mm-jj ». C'est le JOUR qui est en test.
  assert.strictEqual(String(ligneFuseau.deadline).slice(0, 10), aujourdhuiAtelier,
    'l’échéance par défaut suit le jour de l’ATELIER, pas celui du conteneur');

  // Le numéro de ticket sans jour explicite suit la même horloge.
  const ticketDuJour = await call('POST', '/api/vente/numero', {});
  assert.strictEqual(ticketDuJour.body.jour, aujourdhuiAtelier,
    'la série du jour est celle de l’atelier');

  console.log('✓ robustesse : compteurs atomiques, idempotence, validations, PDF et fuseau atelier OK');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
