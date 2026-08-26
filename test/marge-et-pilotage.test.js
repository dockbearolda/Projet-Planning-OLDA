'use strict';

// L'ARGENT : COÛT, MARGE, ACOMPTE, PILOTAGE.
// ===========================================================================
// §11 (décomposition), §12 (coût machine), §13 (marge), §21 (règles d'acompte),
// §24 (tableau de bord Direction).
//
// CE QUI MANQUAIT. Le moteur sortait un PRIX — conforme au fichier V9, vérifié
// sans écart sur 611 520 combinaisons — mais un prix seul ne dit pas ce qu'on
// gagne. Le coût de revient était calculé dans le flux « Nouveau Projet » puis
// enfoui dans le JSON de la fiche : ni lisible depuis la liste, ni sommable, ni
// comparable à quoi que ce soit. Aucune marge cible, aucun minimum, aucune
// alerte. Et les règles d'acompte d'OLDA (100 €, 50 %, express intégral)
// n'étaient codées NULLE PART.
//
// CONTRAINTE ABSOLUE DE CE LOT : le prix calculé ne doit pas bouger d'un
// centime. C'est pour ça que le coût est une COLONNE À PART et que rien n'a été
// touché dans le moteur.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SRV = lire('server.js');
const DB = lire('db.js');
const PIL = lire('public/pilotage.js');

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

  // =========================================================================
  // 1. LA MARGE SE CALCULE, ELLE NE SE RANGE PAS
  // =========================================================================
  const cree = await call('x', 'POST', '/api/requests', {
    stage: 'production', sub_stage: 'prod_dtf', billing_company: 'Hôtel Marge',
    product: 'Polos brodés', quantity: 20,
  });
  const id = cree.body.id;

  // SANS COÛT, PAS DE MARGE — surtout pas zéro. Une marge de 0 % se lirait
  // « on ne gagne rien » là où on ne sait simplement pas.
  await call('x', 'PATCH', `/api/requests/${id}`, { project_value: 1000 });
  const sansCout = await call('x', 'GET', `/api/requests/${id}`);
  assert.strictEqual(sansCout.body.marge_euros, undefined,
    'sans coût connu, aucune marge n’est annoncée — 0 % serait un mensonge');

  const avec = await call('x', 'PATCH', `/api/requests/${id}`, { cout_revient: 300 });
  // 1000 TTC → 961,54 HT (TGCA 4 %) → 661,54 de marge → 68,8 %.
  assert.strictEqual(avec.body.marge_euros, 661.54, 'la marge se compte sur le HT, la TGCA n’est pas à nous');
  assert.strictEqual(avec.body.marge_pct, 68.8);

  // Elle SUIT le prix sans qu'on la recalcule nulle part : rangée, elle
  // mentirait dès le premier changement — et on décide dessus.
  const brade = await call('x', 'PATCH', `/api/requests/${id}`, { project_value: 400 });
  assert.strictEqual(brade.body.marge_pct, 22, 'baisser le prix baisse la marge, tout de suite');

  // =========================================================================
  // 2. ON ALERTE, ON N'INTERDIT PAS (§13)
  // =========================================================================
  // « Si un commercial descend sous la marge minimum : afficher une alerte. La
  //   Direction peut néanmoins forcer le prix. » C'est aussi la seule règle
  //   tenable : un logiciel qui refuse une vente au comptoir est un logiciel
  //   qu'on contourne en notant sur un papier.
  assert.strictEqual(brade.status, 200, 'la vente à marge faible est ENREGISTRÉE');
  assert.ok(brade.body.alerte, '… et signalée');
  assert.strictEqual(brade.body.alerte.type, 'marge_faible');
  assert.strictEqual(brade.body.alerte.minimum, 35);
  assert.match(brade.body.alerte.message, /22 %/);

  const relu = await call('x', 'GET', `/api/requests/${id}`);
  assert.strictEqual(Number(relu.body.project_value), 400, 'le prix forcé est bien en base');

  // L'alerte n'accompagne QUE les modifications de prix ou de coût : la
  // recevoir en changeant une date d'échéance apprendrait à l'ignorer.
  const autre = await call('x', 'PATCH', `/api/requests/${id}`, { deadline: '2026-12-01' });
  assert.strictEqual(autre.body.alerte, undefined,
    'changer une date ne déclenche pas « marge faible »');

  // Et une marge saine ne dit rien du tout.
  const saine = await call('x', 'PATCH', `/api/requests/${id}`, { project_value: 1000 });
  assert.strictEqual(saine.body.alerte, undefined, 'le vert se tait');

  // Le seuil est réglable, et un minimum au-dessus de la cible n'a pas de sens.
  const regle = await call('x', 'PUT', '/api/marges', { cible: 40, minimum: 55 });
  assert.strictEqual(regle.body.cible, 55,
    'un minimum au-dessus de la cible rendrait l’alerte permanente : la cible suit');
  await call('x', 'PUT', '/api/marges', { cible: 60, minimum: 35 });

  // =========================================================================
  // 3. LES RÈGLES D'ACOMPTE D'OLDA (§21)
  // =========================================================================
  // « ≤ 100 € : paiement intégral. > 100 € : acompte de 50 %. Express / Jour J :
  //   paiement intégral. » Elles n'étaient codées nulle part.
  const petit = await call('x', 'POST', '/api/requests', {
    stage: 'preparation', billing_company: 'Petit achat', project_value: 80,
  });
  const a1 = await call('x', 'GET', `/api/argent/${petit.body.id}`);
  assert.strictEqual(a1.body.acompte.montant, 80, 'moins de 100 € : on paie tout');
  assert.strictEqual(a1.body.acompte.part, 1);

  const gros = await call('x', 'POST', '/api/requests', {
    stage: 'preparation', billing_company: 'Grosse commande', project_value: 900,
    deadline: '2026-12-31',
  });
  const a2 = await call('x', 'GET', `/api/argent/${gros.body.id}`);
  assert.strictEqual(a2.body.acompte.montant, 450, 'plus de 100 € : acompte de 50 %');
  assert.strictEqual(a2.body.express, false);

  // EXPRESS SE DÉDUIT DU DÉLAI ACCORDÉ, on ne le redemande pas au poste : moins
  // de trois jours entre la prise et l'échéance, c'est la règle du catalogue.
  const presse = await call('x', 'POST', '/api/requests', {
    stage: 'preparation', billing_company: 'Pressé', project_value: 900,
    deadline: new Date().toISOString().slice(0, 10),
  });
  const a3 = await call('x', 'GET', `/api/argent/${presse.body.id}`);
  assert.strictEqual(a3.body.express, true);
  assert.strictEqual(a3.body.acompte.montant, 900, 'express : paiement intégral, quel que soit le montant');

  // Le reste à encaisser tient compte de ce qui est DÉJÀ versé.
  await call('x', 'PATCH', `/api/requests/${gros.body.id}`, { acompte_verse: true, acompte_montant: 450 });
  const a4 = await call('x', 'GET', `/api/argent/${gros.body.id}`);
  assert.strictEqual(a4.body.reste, 450, 'acompte versé : il reste le solde');

  // =========================================================================
  // 4. TROIS NIVEAUX DE VISIBILITÉ, PAS DEUX
  // =========================================================================
  // La boutique doit voir le prix — elle le négocie et encaisse l'acompte — mais
  // ce que l'atelier GAGNE ne la regarde pas : le patron ne liste la marge que
  // pour la Direction.
  await call('x', 'PUT', '/api/flags', { comptes: true });
  for (const [prenom, code] of [['Loïc', '3333'], ['Mélina', '2222'], ['Julien', '1111']]) {
    await call(prenom, 'POST', '/api/session', { prenom, code });
  }
  const vue = async (qui) => (await call(qui, 'GET', `/api/requests/${id}`)).body;

  const direction = await vue('Loïc');
  assert.ok(direction.project_value != null && direction.cout_revient != null && direction.marge_pct != null,
    'la Direction voit le prix, le coût ET la marge');
  const boutique = await vue('Mélina');
  assert.ok(boutique.project_value != null, 'la boutique voit le prix');
  assert.strictEqual(boutique.cout_revient, undefined, '… mais pas le coût');
  assert.strictEqual(boutique.marge_pct, undefined, '… ni la marge');
  const atelier = await vue('Julien');
  assert.strictEqual(atelier.project_value, undefined, 'l’atelier ne voit rien de tout ça');
  assert.strictEqual(atelier.cout_revient, undefined);

  // Le coût s'ÉCRIT d'un cran plus haut que le prix.
  assert.strictEqual((await call('Mélina', 'PATCH', `/api/requests/${id}`, { cout_revient: 1 })).status, 403,
    'la boutique fixe le prix, pas le coût');
  assert.strictEqual((await call('Loïc', 'PATCH', `/api/requests/${id}`, { cout_revient: 300 })).status, 200);

  // =========================================================================
  // 5. L'ÉCRAN DE PILOTAGE (§24)
  // =========================================================================
  assert.strictEqual((await call('Julien', 'GET', '/api/pilotage')).status, 403);
  assert.strictEqual((await call('Mélina', 'GET', '/api/pilotage')).status, 403,
    'même la boutique n’a pas le tableau de bord de la Direction');
  const pil = await call('Loïc', 'GET', '/api/pilotage');
  assert.strictEqual(pil.status, 200);

  // LA MARGE PORTE SUR LE MÊME PÉRIMÈTRE QUE LE COÛT. Sommer le prix de huit
  // lignes et le coût d'une seule donne une « marge » de 92 % qui n'existe pas —
  // c'est une soustraction entre deux périmètres différents.
  assert.ok(pil.body.enCours.chiffrees >= 1);
  assert.ok(pil.body.enCours.chiffrees < pil.body.enCours.lignes,
    'le jeu de test a bien des lignes SANS coût — c’est le cas piégeux');
  assert.ok(pil.body.enCours.margePct <= 100 && pil.body.enCours.margePct > 0,
    `la marge reste plausible (${pil.body.enCours.margePct} %) : elle ne compare pas 8 prix à 1 coût`);
  assert.ok(/ca_chiffre/.test(SRV),
    'le CA du périmètre chiffré est calculé à part — c’est ce qui empêche la marge de mentir');

  assert.ok(typeof pil.body.aEncaisser.montant === 'number', 'ce qui reste à encaisser est un chiffre');
  assert.ok(Array.isArray(pil.body.atelier), 'la charge de l’atelier est par poste');
  assert.ok(pil.body.atelier.every((a) => a.libelle && !/^prod_/.test(a.libelle)),
    '… en toutes lettres : « prod_dtf » ne dit rien sur un écran de pilotage');

  // =========================================================================
  // 6. CE QUI SE LIT DANS LE SOURCE
  // =========================================================================
  // LE PRIX N'A PAS BOUGÉ. Le coût est une colonne À PART : rien n'est entré
  // dans le moteur conforme au V9, et c'est la condition de tout ce lot.
  assert.ok(/cout_revient\s+numeric/.test(lire('schema.sql')),
    'le coût est une colonne, pas un champ glissé dans le calcul du prix');
  assert.ok(!/prixRevient[\s\S]{0,200}prixUnitaireTtc\s*=/.test(SRV),
    'le coût de revient n’intervient nulle part dans le calcul d’un prix');

  // Les taux se chargent AU DÉMARRAGE : ils n'étaient posés qu'au premier
  // chiffrage, et c'est sur la TGCA que la marge se calcule à chaque lecture.
  assert.ok(/init\(\)\s*\n\s*\.then\(chargerTaux\)/.test(SRV),
    'la TGCA est lue au démarrage — sinon les marges se calculent sur la valeur par défaut');
  assert.ok(/await chargerTaux\(\);/.test(SRV),
    '… et relue quand le patron la change aux Réglages');

  // Le coût horaire par machine est réglable (§12).
  assert.ok(/coutHoraire: positifOuNull/.test(DB) && /consommables: positifOuNull/.test(DB),
    'chaque machine peut porter son coût horaire et ses consommables');
  assert.ok(/return null;\s*\n\s*const n = Number\(v\);/.test(DB.slice(DB.indexOf('positifOuNull'))),
    'non renseigné vaut `null`, pas zéro : une machine non chiffrée ne coûte pas « rien »');

  // L'écran ne ment pas quand il ne sait pas.
  assert.ok(/Aucune commande ne porte de coût de revient/.test(PIL),
    'sans aucune ligne chiffrée, le pilotage le DIT au lieu d’afficher un chiffre');
  assert.ok(/les autres n’ont pas de coût saisi/.test(PIL),
    '… et il annonce toujours sur combien de commandes la marge porte');

  console.log('✓ argent : la marge se calcule, l’alerte prévient sans interdire, et le pilotage ne ment pas');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
