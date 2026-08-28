'use strict';

// LE PRIX SUIT LA QUANTITÉ — le dégressif s'applique quand on corrige au planning
// ===========================================================================
// Charlie, 28/08 : « extrêmement important et obligatoire que le prix suive ».
// Le client rappelle, il ne veut plus 30 S mais 100 : on corrige sur la ligne,
// et le montant doit descendre au tarif de cent pièces — pas rester celui de
// trente. Sans ça, chaque correction de quantité fabrique un devis faux, et
// personne ne le voit : le nombre a bien changé à l'écran.
//
// CE QUI EST GARDÉ ICI :
//
//   1. le serveur ne RÉIMPLÉMENTE pas le calcul — il rejoue le moteur du
//      comptoir, celui qui est conforme au fichier V9 du patron ;
//   2. le dégressif s'applique vraiment (100 pièces coûtent moins cher la
//      pièce que 30) ;
//   3. une taille ramenée à zéro SORT du calcul — la ligne du planning ne
//      garde pas les tailles vides, et sans ça le prix ne redescendait jamais ;
//   4. les deux écrans du comptoir envoient de quoi refaire le prix ;
//   5. bout en bout : corriger les tailles d'une ligne met à jour la quantité,
//      le coût de revient et le prix ;
//   6. UN PRIX POSÉ À LA MAIN N'EST JAMAIS ÉCRASÉ — c'est un accord client ;
//   7. UNE DEMANDE DE DEVIS N'EN REÇOIT PAS : sans prix, elle reste sans prix ;
//   8. une ligne sans chiffrage (les 184 dossiers d'avant, une tasse, un
//      couteau) reste modifiable — son prix ne bouge simplement pas ;
//   9. la vente directe suit sa propre règle : prix à la pièce × quantité ;
//  10. on peut AJOUTER une taille que le comptoir n'avait pas commandée.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');

const chiffrage = require('../chiffrage.js');

// Les réglages du fichier du patron. Le tarif Chronopost vaut 1,80 € depuis le
// 27/08 ; ce qui est conforme au V9, c'est la FORMULE, pas le prix du jour.
const REGLAGES = {
  dtfCost: 7.56, dtfSpeed: 12, pressMin: 1.2, hourlyCost: 25,
  roundStep: 0.1, maxCoefQty: 150,
  transports: { Maritime: 0, Chronopost: 1.8 },
};

const ARTICLE = {
  ref: 'NS300', genre: 'Unisexe', transport: 'Chronopost',
  printType: 'Coeur', sizes: { S: 30 }, markupPercent: 0,
};

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

(async () => {
  // =========================================================================
  // 1. LE SERVEUR NE RÉIMPLÉMENTE PAS LE CALCUL
  // =========================================================================
  // Un second moteur, c'est un second prix — et c'est celui qu'on ne teste pas
  // qui part au client. On charge donc le moteur du comptoir exactement comme
  // le fait le test de conformité au V9, et on exige les MÊMES nombres.
  const bac = {
    window: {}, console, Math, JSON, Number, String, Array, Object, Date, parseFloat, Intl,
  };
  vm.createContext(bac);
  vm.runInContext(lire('public/comptoir/textile-catalog.js'), bac);
  const TE = bac.window.TextileEngine;
  TE.resetSettings();
  TE.setSettings(REGLAGES);

  const ch30 = chiffrage.bornerChiffrage(ARTICLE);
  assert.ok(ch30, 'un article textile complet doit se ranger');
  const attendu = TE.calculate({ ...ARTICLE, sizes: { S: 30 } });
  const obtenu = chiffrage.recalculer(ch30, REGLAGES);
  assert.strictEqual(obtenu.ht, Math.round(attendu.total * 100) / 100,
    'le total HT du serveur doit être CELUI du moteur du comptoir, au centime');
  assert.strictEqual(obtenu.unitHT, Math.round(attendu.sold * 100) / 100,
    'le prix à la pièce aussi : c’est lui que la vendeuse a annoncé');
  assert.strictEqual(obtenu.revient, Math.round(attendu.costSeries * 100) / 100,
    'le coût de revient est celui de la SÉRIE, pas de la pièce');
  assert.strictEqual(obtenu.ttc, Math.round((attendu.total * 1.04) * 100) / 100,
    'la TGCA de 4 % ferme la chaîne, comme au comptoir');

  // La TGCA se décide PAR ARTICLE : décochée, elle ne s'ajoute pas.
  const sansTaxe = chiffrage.recalculer(
    chiffrage.bornerChiffrage({ ...ARTICLE, tgca: false }), REGLAGES,
  );
  assert.strictEqual(sansTaxe.taxe, 0, 'TGCA décochée : aucune taxe');
  assert.strictEqual(sansTaxe.ttc, sansTaxe.ht, 'et le TTC vaut alors le HT');

  // =========================================================================
  // 2. LE DÉGRESSIF S'APPLIQUE — c'est TOUT l'objet de la demande
  // =========================================================================
  const ch100 = chiffrage.poserTailles(ch30, [{ t: 'S', n: 100 }]);
  const cent = chiffrage.recalculer(ch100, REGLAGES);
  assert.strictEqual(cent.qte, 100, 'cent pièces, pas trente');
  assert.ok(cent.unitHT < obtenu.unitHT,
    `cent pièces doivent coûter MOINS cher la pièce que trente (${cent.unitHT} vs ${obtenu.unitHT})`);
  assert.ok(cent.ht > obtenu.ht, 'mais le total, lui, monte');
  // Le piège inverse, et il est réel : un prix à la pièce recopié tel quel
  // aurait donné trois fois le total de trente pièces.
  assert.ok(cent.ht < obtenu.ht * (100 / 30),
    'le total ne doit PAS être une simple règle de trois : le coefficient a bougé');

  // =========================================================================
  // 3. UNE TAILLE RAMENÉE À ZÉRO SORT DU CALCUL
  // =========================================================================
  // La ligne du planning ne garde pas « 0 × XL » — elle dit ce qu'il y a à
  // PRODUIRE. La liste des tailles est donc lue comme la ligne ENTIÈRE, pas
  // comme un patch : une taille absente vaut zéro. Sans ça, retirer les XL les
  // laissait dans le chiffrage et le prix ne redescendait jamais.
  const mixte = chiffrage.bornerChiffrage({ ...ARTICLE, sizes: { S: 30, XL: 20 } });
  assert.strictEqual(chiffrage.recalculer(mixte, REGLAGES).qte, 50);
  const sansXL = chiffrage.poserTailles(mixte, [{ t: 'S', n: 30 }]);
  assert.strictEqual(chiffrage.recalculer(sansXL, REGLAGES).qte, 30,
    'une taille retirée de la ligne doit quitter le calcul');

  // MAIS UNE LISTE QU'ON NE SAIT PAS LIRE NE VIDE RIEN. Une gravure « 33 cl »,
  // un couteau : ces libellés ne sont pas ceux du moteur. Tout remettre à zéro
  // effacerait le chiffrage d'une ligne qu'on ne comprend pas.
  const etranger = chiffrage.poserTailles(mixte, [{ t: '33 cl', n: 12 }]);
  assert.strictEqual(chiffrage.recalculer(etranger, REGLAGES).qte, 50,
    'des tailles inconnues du moteur laissent le chiffrage intact');

  // =========================================================================
  // 4. LES DEUX ÉCRANS DU COMPTOIR ENVOIENT DE QUOI REFAIRE LE PRIX
  // =========================================================================
  const DEVIS = lire('public/comptoir/demande-devis.html');
  const VENTE = lire('public/comptoir/vente-directe.html');
  assert.match(DEVIS, /chiffrage:\s*n\.textile/,
    'la demande de devis doit envoyer les entrées du moteur — elles étaient déjà '
    + 'calculées dans le besoin, elles ne partaient nulle part');
  assert.match(VENTE, /chiffrage:\s*\{\s*moteur:\s*'unitaire'/,
    'la vente directe n’a pas de moteur : elle envoie son prix à la pièce');
  assert.match(VENTE, /unitTTC:\s*p\.price/,
    'et c’est le prix SAISI (objet + travail), pas le total de la ligne');

  // =========================================================================
  // Le serveur, maintenant : bout en bout.
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
  const call = async (method, chemin, body) => {
    const res = await fetch(base + chemin, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  // LA LISTE NE PORTE PAS LE CHIFFRAGE, et c'est voulu : il ne se lit pas, il se
  // rejoue — et seulement au serveur. Le rendre à chaque poste à chaque
  // rafraîchissement serait du poids sur le fil pour rien. On relit donc la
  // ligne ENTIÈRE pour l'examiner.
  const ligneDe = async (ref) => {
    const courte = (await call('GET', '/api/requests')).body
      .find((r) => r.fiche && r.fiche.ref === ref);
    return courte ? (await call('GET', `/api/requests/${courte.id}`)).body : null;
  };

  // Les réglages en base sont ceux d'usine, pas ceux du fichier V9 : on prend
  // donc le prix que le SERVEUR calculera, pas celui d'ici. Ce qu'on vérifie,
  // c'est qu'il SUIT — pas sa valeur absolue, déjà gardée par le test de
  // conformité au V9.
  const reglagesServeur = {
    ...(await call('GET', '/api/settings/textile')).body,
    transports: (await call('GET', '/api/tarifs-transport')).body,
  };
  const prixDe = (sizes) => chiffrage.recalculer(
    chiffrage.bornerChiffrage({ ...ARTICLE, sizes }), reglagesServeur,
  );

  const venteDe = (ref, article, montant) => ({
    source: 'Vente directe',
    ref,
    client: 'Marina Royale',
    name: article.label,
    responsible: 'Loïc',
    due: '2026-09-04',
    stage: 'preparation',
    // Les deux écrans envoient la somme des quantités du panier : sur un seul
    // article, c'est la sienne.
    quantity: article.qty,
    amount: montant,
    articles: [article],
    recap: `TICKET ${ref}`,
    details: [['Article 1 — Désignation', article.label]],
  });

  // =========================================================================
  // 5. BOUT EN BOUT : corriger les tailles corrige le prix
  // =========================================================================
  const REF = 'PRIX-26.08.28-001';
  const dep = prixDe({ S: 30 });
  const cree = await call('POST', '/api/comptoir/projet', venteDe(REF, {
    label: 'T-shirt unisexe bio léger Premium 155 g',
    qty: 30,
    prod: { ref: 'NS300', couleur: 'Noir', marquage: 'DTF', tailles: [{ t: 'S', n: 30 }], logos: [] },
    chiffrage: ARTICLE,
  }, dep.ttc));
  assert.strictEqual(cree.status, 201);

  const avant = await ligneDe(REF);
  assert.ok(avant.fiche.chiffrage, 'le chiffrage doit être ARCHIVÉ sur la ligne');
  assert.strictEqual(avant.fiche.chiffrage.sizes.S, 30);
  assert.ok(Math.abs(Number(avant.project_value) - dep.ttc) < 0.01,
    'le dossier part au prix du comptoir');

  const patch = await call('PATCH', `/api/requests/${avant.id}/fiche`, {
    prod: { tailles: [{ t: 'S', n: 100 }] },
  });
  assert.strictEqual(patch.status, 200);
  const cible = prixDe({ S: 100 });
  assert.strictEqual(Number(patch.body.quantity), 100,
    'la quantité de la ligne suit la somme des tailles');
  assert.ok(Math.abs(Number(patch.body.project_value) - cible.ttc) < 0.01,
    `le prix doit suivre le dégressif (${patch.body.project_value} ≠ ${cible.ttc})`);
  assert.ok(Math.abs(Number(patch.body.cout_revient) - cible.revient) < 0.01,
    'le coût de revient aussi — sinon la marge affichée est fausse');
  assert.ok(Number(patch.body.project_value) > Number(avant.project_value),
    'cent pièces coûtent plus cher que trente au total');
  assert.strictEqual(patch.body.fiche.chiffrage.sizes.S, 100,
    'le chiffrage archivé retient la nouvelle quantité, sinon la correction suivante repart de 30');
  assert.deepStrictEqual(patch.body.fiche.prod.tailles, [{ t: 'S', n: 100 }],
    'et la ligne affiche la même chose que ce qu’elle a chiffré');

  // =========================================================================
  // 6. UN PRIX POSÉ À LA MAIN N'EST JAMAIS ÉCRASÉ
  // =========================================================================
  // La vendeuse a négocié, ou le patron a écrit un montant : le recalcul
  // rectifie la quantité et le coût, jamais le prix. Un accord client effacé
  // sans le dire ne se découvre qu'à la facture.
  const accorde = 999.99;
  await call('PATCH', `/api/requests/${avant.id}`, { project_value: accorde });
  const apresMain = await call('PATCH', `/api/requests/${avant.id}/fiche`, {
    prod: { tailles: [{ t: 'S', n: 60 }] },
  });
  assert.strictEqual(apresMain.status, 200);
  assert.ok(Math.abs(Number(apresMain.body.project_value) - accorde) < 0.01,
    'un prix écrit à la main ne bouge pas quand la quantité change');
  assert.strictEqual(Number(apresMain.body.quantity), 60,
    'la quantité, elle, suit toujours : c’est un fait, pas un accord');
  const soixante = prixDe({ S: 60 });
  assert.ok(Math.abs(Number(apresMain.body.cout_revient) - soixante.revient) < 0.01,
    'et le coût de revient aussi — c’est ce qui dit ce que l’accord laisse');

  // =========================================================================
  // 7. UNE DEMANDE DE DEVIS RESTE SANS PRIX
  // =========================================================================
  // `project_value` NULL, jamais 0 : lui écrire un montant parce qu'on a
  // corrigé une quantité, ce serait annoncer un prix que personne n'a donné.
  const REF_D = 'PRIX-26.08.28-002';
  const demande = await call('POST', '/api/comptoir/projet', {
    ...venteDe(REF_D, {
      label: 'T-shirt unisexe bio léger Premium 155 g',
      qty: 30,
      prod: { ref: 'NS300', couleur: 'Noir', marquage: 'DTF', tailles: [{ t: 'S', n: 30 }], logos: [] },
      chiffrage: ARTICLE,
    }, null),
    source: 'Demande de devis',
    amount: null,
  });
  assert.strictEqual(demande.status, 201);
  const ldemande = await ligneDe(REF_D);
  assert.strictEqual(ldemande.project_value, null, 'une demande de devis part sans prix');
  const majD = await call('PATCH', `/api/requests/${ldemande.id}/fiche`, {
    prod: { tailles: [{ t: 'S', n: 100 }] },
  });
  assert.strictEqual(majD.body.project_value, null,
    'corriger une quantité ne DONNE PAS un prix à une demande de devis');
  assert.strictEqual(Number(majD.body.quantity), 100,
    'mais la quantité se corrige — c’est justement ce qu’on vient faire');

  // =========================================================================
  // 8. UNE LIGNE SANS CHIFFRAGE RESTE MODIFIABLE
  // =========================================================================
  // Les 184 dossiers d'avant le 28/08, une tasse, un couteau : rien à rejouer.
  // La correction passe quand même, le prix ne bouge pas. C'est le cas le plus
  // fréquent, et il ne doit pas échouer.
  const REF_S = 'PRIX-26.08.28-003';
  await call('POST', '/api/comptoir/projet', venteDe(REF_S, {
    label: 'Tasse céramique 350 ml',
    qty: 30,
    prod: { ref: 'TC 06', couleur: 'Blanc', marquage: 'UV', tailles: [{ t: '35 cl', n: 30 }], logos: [] },
  }, 300));
  const lsans = await ligneDe(REF_S);
  assert.ok(!lsans.fiche.chiffrage, 'sans entrée de moteur, aucun chiffrage n’est inventé');
  const majS = await call('PATCH', `/api/requests/${lsans.id}/fiche`, {
    prod: { tailles: [{ t: '35 cl', n: 60 }] },
  });
  assert.strictEqual(majS.status, 200, 'la correction doit passer quand même');
  assert.deepStrictEqual(majS.body.fiche.prod.tailles, [{ t: '35 cl', n: 60 }]);
  assert.ok(Math.abs(Number(majS.body.project_value) - 300) < 0.01,
    'faute de savoir refaire le prix, on n’y touche pas — on n’en invente pas un');

  // =========================================================================
  // 9. VENTE DIRECTE : prix à la pièce × quantité
  // =========================================================================
  // Pas de grille de tailles ici : c'est la QUANTITÉ de la ligne qui commande.
  // Dix tasses à 10 € en font 100 ; vingt en font 200.
  const REF_V = 'PRIX-26.08.28-004';
  await call('POST', '/api/comptoir/projet', venteDe(REF_V, {
    label: 'Tasse céramique 350 ml',
    qty: 10,
    chiffrage: { moteur: 'unitaire', unitTTC: 10, rate: 0 },
  }, 100));
  const lv = await ligneDe(REF_V);
  assert.strictEqual(lv.fiche.chiffrage.moteur, 'unitaire');
  const majV = await call('PATCH', `/api/requests/${lv.id}`, { quantity: 20 });
  assert.strictEqual(majV.status, 200);
  assert.ok(Math.abs(Number(majV.body.project_value) - 200) < 0.01,
    `vingt tasses à 10 € font 200 € (obtenu ${majV.body.project_value})`);

  // Et si le même envoi porte un prix, c'est LUI qui compte : on ne recalcule
  // pas par-dessus une valeur que quelqu'un vient d'écrire.
  const majV2 = await call('PATCH', `/api/requests/${lv.id}`, { quantity: 30, project_value: 250 });
  assert.ok(Math.abs(Number(majV2.body.project_value) - 250) < 0.01,
    'un prix envoyé dans le même PATCH gagne sur le recalcul');

  // =========================================================================
  // 10. AJOUTER UNE TAILLE QUE LE COMPTOIR N'AVAIT PAS COMMANDÉE
  // =========================================================================
  // « Finalement il en veut aussi 20 en XL. » La ligne ne porte que les tailles
  // commandées : un patch par POSITION ne peut pas en ajouter une. Nommer la
  // taille le permet — et un libellé ne bouge pas quand une taille disparaît,
  // contrairement à un rang.
  const REF_X = 'PRIX-26.08.28-005';
  const dep2 = prixDe({ S: 30 });
  await call('POST', '/api/comptoir/projet', venteDe(REF_X, {
    label: 'T-shirt unisexe bio léger Premium 155 g',
    qty: 30,
    prod: { ref: 'NS300', couleur: 'Noir', marquage: 'DTF', tailles: [{ t: 'S', n: 30 }], logos: [] },
    chiffrage: ARTICLE,
  }, dep2.ttc));
  const lx = await ligneDe(REF_X);
  const majX = await call('PATCH', `/api/requests/${lx.id}/fiche`, {
    prod: { tailles: [{ t: 'S', n: 30 }, { t: 'XL', n: 20 }] },
  });
  assert.strictEqual(Number(majX.body.quantity), 50, 'la taille ajoutée compte dans la quantité');
  assert.deepStrictEqual(majX.body.fiche.prod.tailles, [{ t: 'S', n: 30 }, { t: 'XL', n: 20 }],
    'et elle s’affiche sur la ligne');
  const attenduX = prixDe({ S: 30, XL: 20 });
  assert.ok(Math.abs(Number(majX.body.project_value) - attenduX.ttc) < 0.01,
    'le prix tient compte de la taille ajoutée');

  // Et on peut la retirer : zéro nommé retire la taille de la ligne.
  const majX2 = await call('PATCH', `/api/requests/${lx.id}/fiche`, {
    prod: { tailles: [{ t: 'S', n: 30 }, { t: 'XL', n: 0 }] },
  });
  assert.deepStrictEqual(majX2.body.fiche.prod.tailles, [{ t: 'S', n: 30 }],
    '« 0 × XL » n’est pas un fait à produire : la taille quitte la ligne');
  assert.strictEqual(Number(majX2.body.quantity), 30, 'et la quantité redescend');

  // LA VOIE PAR POSITION RESTE OUVERTE — c'est celle des corrections d'avant, et
  // elle ne doit pas descendre à zéro : retirer une taille décalerait toutes les
  // suivantes, et la correction du poste d'à côté irait sur la mauvaise case.
  const majPos = await call('PATCH', `/api/requests/${lx.id}/fiche`, {
    prod: { tailles: [{ n: 0 }] },
  });
  assert.deepStrictEqual(majPos.body.fiche.prod.tailles, [{ t: 'S', n: 30 }],
    'un zéro SANS nom de taille ne passe pas : la position est trop fragile pour ça');

  // =========================================================================
  // 11. LES DOSSIERS D'EXEMPLE SONT DE VRAIS DOSSIERS
  // =========================================================================
  // Charlie, 28/08 : « supprime tous ceux en local et recrée-m'en des nouveaux
  // modifiables ». Le piège est silencieux : un prix d'exemple ÉCRIT à la main
  // serait reconnu comme un prix POSÉ à la main, le recalcul le respecterait, et
  // la base de démonstration montrerait le contraire de ce qu'elle sert à
  // montrer. Le semis doit donc DEMANDER son prix au moteur.
  const demo = (await call('GET', '/api/requests')).body
    .filter((r) => r.fiche && String(r.fiche.ref || '').startsWith('DEMO-'));
  assert.ok(demo.length >= 8, `le semis doit poser des dossiers travaillables (${demo.length})`);
  assert.ok(demo.some((r) => r.fiche.prod && r.fiche.prod.tailles.length),
    'au moins un dossier d’exemple porte une grille de tailles — c’est le cas que Charlie corrige');
  assert.ok(demo.some((r) => r.fiche.prod && r.fiche.prod.logos.some((z) => z.quoi)),
    'et au moins un porte des faces avec une consigne, sans cote : une tasse ne se mesure pas au comptoir');

  let verifies = 0;
  for (const court of demo) {
    const r = (await call('GET', `/api/requests/${court.id}`)).body;
    const ch = r.fiche.chiffrage;
    if (!ch) continue;
    const calc = chiffrage.recalculer(ch, reglagesServeur, r.quantity);
    assert.ok(calc, `le chiffrage de « ${r.billing_company} » doit se rejouer`);
    assert.strictEqual(Number(r.quantity), calc.qte,
      `la quantité de « ${r.billing_company} » doit valoir la somme de ses tailles`);
    // Un dossier laissé SANS prix exprès (demande pas encore chiffrée) le reste :
    // c'est la règle, et le semis doit la montrer aussi.
    if (r.project_value != null) {
      assert.ok(Math.abs(Number(r.project_value) - calc.ttc) < 0.01,
        `le prix de « ${r.billing_company} » doit être CELUI du moteur (${r.project_value} ≠ ${calc.ttc}) — `
        + 'un prix écrit à la main serait pris pour un prix négocié et ne bougerait jamais');
    }
    verifies += 1;
  }
  assert.ok(verifies >= 6, `au moins six dossiers d’exemple doivent être retarifables (${verifies})`);
  assert.ok(demo.some((r) => r.project_value == null),
    'et un doit rester SANS prix : une demande pas encore chiffrée n’en reçoit pas');

  console.log('✓ le prix suit la quantité : dégressif rejoué, accord préservé, devis sans prix');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
