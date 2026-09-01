'use strict';

// LE CATALOGUE PASSE DU CODE À LA BASE (01/09/2026)
// ===========================================================================
// `public/comptoir/catalogue.js` était un tableau écrit en dur : familles,
// articles, variantes — et AUCUN prix. C'était ça, le verrou : tant qu'un
// catalogue est du code, aucun prix ne peut s'y importer, il faut redéployer
// pour changer un tarif. Seuls les tarifs TASSE vivaient en base et
// s'éditaient (`app_meta.tarifs_tasse_articles`).
//
// Le catalogue est maintenant une table, aux MÊMES colonnes que la grille
// tarifaire tasse : prix d'achat, prix de vente TTC, temps de main-d'œuvre,
// temps machine. Le fichier de code est devenu `catalogue-produits-seed.json`,
// la SEMENCE d'une base neuve — comme `tailles-logo-seed.json` — et plus une
// source lue à chaud.
//
// CE FICHIER GARDE :
//
//   1. LA SEMENCE EST FIDÈLE. Les quatre-vingt-deux lignes vendables de
//      l'ancien fichier sont en base, à l'identique : mêmes familles, mêmes
//      variantes, même ordre, mêmes intitulés de devis (« TC 01 » se lit
//      « Tasse céramique 350 ml TC 01 »).
//   2. UN PRIX ABSENT RESTE ABSENT. Le catalogue d'aujourd'hui n'en porte
//      aucun ; les semer à 0 ferait annoncer « 0 € » au comptoir sur
//      quatre-vingts produits (même règle que `project_value` sur une demande
//      de devis).
//   3. LA GARDE NE REJOUE PAS. Sa clé `app_meta` est à elle — deux incidents
//      réels sont venus d'une garde partagée — et un produit supprimé par le
//      patron ne revient pas au redémarrage suivant.
//   4. L'UNICITÉ EST POSÉE EN BASE. C'est elle, et pas le code, qui empêche
//      deux imports lancés en même temps de créer deux fois le même produit.
//   5. ⚠ UN PRIX QUI CHANGE NE RETARIFE JAMAIS UNE COMMANDE DÉJÀ PASSÉE.
//      C'est LA règle. Le chiffrage d'une ligne est figé dans
//      `fiche.chiffrage` au moment de la prise ; le moteur, conforme au
//      fichier V9 du patron, ne lit pas cette table. Sans cette garde, corriger
//      un tarif en septembre réécrirait le prix d'un dossier d'août — et
//      personne ne le verrait, parce que le nombre affiché aurait l'air juste.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const SEMENCE = JSON.parse(lire('catalogue-produits-seed.json'));

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

(async () => {
  process.env.PORT = '0';
  const app = require('../server');
  const db = require('../db');
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
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };

  // =========================================================================
  // 1. LA SEMENCE EST EN BASE, FIDÈLE À L'ANCIEN FICHIER
  // =========================================================================
  let r = await call('GET', '/api/catalogue-produits');
  assert.strictEqual(r.status, 200);
  // LES OBJETS DU PATRON, ET LE TEXTILE QUI LES A REJOINTS LE 01/09. Les deux
  // vivent dans la même table depuis que les trois écrans doivent lire la même
  // base — voir `test/catalogue-textile-base.test.js`, qui tient le textile.
  const objets = r.body.filter((p) => p.famille !== 'Textile');
  assert.strictEqual(objets.length, 82, 'les 82 lignes vendables de l’ancien fichier');
  assert.strictEqual(objets.length, SEMENCE.length, '… c’est-à-dire exactement la semence');

  const familles = [...new Set(objets.map((p) => p.famille))];
  assert.deepStrictEqual(familles, [
    'Art de la table', 'Du quotidien', 'Voyage', 'Gourdes', 'Jeux & loisirs',
    'Papeterie', 'Porte-clés', 'Tasse céramique 350 ml',
  ], 'les familles du patron, dans SON ordre — le menu du comptoir s’y range');
  // … et le textile arrive APRÈS elles : un t-shirt ne s'intercale pas au
  // milieu des rayons de la boutique.
  assert.deepStrictEqual([...new Set(r.body.map((p) => p.famille))],
    [...familles, 'Textile'],
    'le textile est le dernier rayon — la semence part à la suite des positions');

  const couteau = r.body.filter((p) => p.designation === 'Couteau Multi');
  assert.deepStrictEqual(couteau.map((p) => p.variante), ['Bois', 'Liège'],
    'une variante est SA propre ligne : il n’y a pas de deuxième choix à faire au comptoir');

  const tc01 = r.body.find((p) => p.designation === 'TC 01');
  assert.strictEqual(tc01.label, 'Tasse céramique 350 ml TC 01',
    '« TC 01 » seul ne dit rien à l’atelier trois jours plus tard');
  assert.strictEqual(tc01.note, 'Rouge / Blanc', 'la couleur du dehors, puis celle du dedans');
  assert.strictEqual(tc01.couleur, 'Rouge (ext.) / Blanc (int.)');
  assert.strictEqual(tc01.familleNote, 'extérieur / intérieur',
    'l’intitulé du groupe dit lequel des deux tons est le dehors');

  // =========================================================================
  // 2. UN PRIX ABSENT RESTE ABSENT — jamais zéro
  // =========================================================================
  assert.ok(r.body.every((p) => p.prixVenteTtc === null),
    'aucun produit n’est tarifé aujourd’hui : les semer à 0 ferait annoncer « 0 € » en rayon');
  assert.ok(r.body.every((p) => p.prixAchat === null && p.tempsMoMin === null
    && p.tempsMachineMin === null),
    'et ni prix d’achat, ni temps : un blanc n’est pas un zéro');
  assert.ok(r.body.every((p) => p.actif === true), 'tout est en rayon au départ');

  // Les colonnes sont CELLES de la grille tarifaire tasse : c'est la même
  // question posée sur un autre rayon, elle ne se pose pas deux fois autrement.
  const tasse = (await call('GET', '/api/tarifs-tasse')).body[0];
  for (const champ of ['prixAchat', 'prixVenteTtc', 'tempsMoMin', 'tempsMachineMin']) {
    assert.ok(champ in tasse, `la grille tasse porte « ${champ} »`);
    assert.ok(champ in r.body[0], `… et le catalogue aussi : « ${champ} »`);
  }

  // =========================================================================
  // 3. LA GARDE NE REJOUE PAS, ET NE RESSUSCITE RIEN
  // =========================================================================
  const sansTasses = r.body.filter((p) => p.famille !== 'Tasse céramique 350 ml');
  const restantes = r.body.length - 17;
  await call('PUT', '/api/catalogue-produits', sansTasses);
  let apres = (await call('GET', '/api/catalogue-produits')).body;
  assert.strictEqual(apres.length, restantes, 'le patron retire les tasses du rayon');

  // La semence rejouée à la main : c'est ce que fait un redémarrage. LES DEUX
  // semences, depuis le 01/09 — celle des objets et celle du textile, chacune
  // avec sa PROPRE garde `app_meta`.
  await db.semerCatalogueProduits();
  await db.semerCatalogueTextile();
  apres = (await call('GET', '/api/catalogue-produits')).body;
  assert.strictEqual(apres.length, restantes,
    'un redémarrage ne fait pas revenir un produit que le patron a retiré');
  assert.ok(!apres.some((p) => p.designation === 'TC 01'),
    '… pas même une tasse');

  // Et le textile suit la même règle : retiré du rayon, il ne revient pas au
  // démarrage suivant. Un catalogue qui repousse tout seul est un catalogue
  // que le patron ne contrôle plus.
  const sansTextile = apres.filter((p) => p.famille !== 'Textile');
  await call('PUT', '/api/catalogue-produits', sansTextile);
  await db.semerCatalogueTextile();
  apres = (await call('GET', '/api/catalogue-produits')).body;
  assert.ok(!apres.some((p) => p.famille === 'Textile'),
    'un t-shirt retiré ne revient pas non plus');

  // =========================================================================
  // 4. L'UNICITÉ EST POSÉE EN BASE
  // =========================================================================
  // « Art de la Table » et « Art de la table » sont le MÊME rayon : c'est la
  // clé réduite (sans casse ni accent) qui identifie un produit, sinon un
  // import créerait un doublon à la première majuscule tapée autrement.
  const { cleProduit } = require('../catalogue-csv');
  assert.strictEqual(cleProduit('Art de la Table', 'Bouchon Bois', ''),
    cleProduit('art de la table', 'BOUCHON BOIS', ''),
    'la casse ne fait pas deux produits');
  assert.notStrictEqual(cleProduit('Art de la table', 'Couteau Multi', 'Bois'),
    cleProduit('Art de la table', 'Couteau Multi', 'Liège'),
    '… mais deux variantes en font bien deux');

  // Deux lignes de même clé envoyées ensemble : la première gagne, la seconde
  // n'ouvre pas une deuxième case qui écrirait dans la même.
  const doublon = await call('PUT', '/api/catalogue-produits', [
    { famille: 'Essais', designation: 'Objet', variante: '', prixVenteTtc: 10 },
    { famille: 'ESSAIS', designation: 'objet', variante: '', prixVenteTtc: 99 },
  ]);
  assert.strictEqual(doublon.body.length, 1, 'deux fois le même produit ne font qu’une ligne');
  assert.strictEqual(doublon.body[0].prixVenteTtc, 10, 'et c’est la première qui reste');
  // La contrainte se repose sans broncher sur une base déjà remplie.
  await db.poserUniciteCatalogue();

  // Une ligne sans famille ou sans désignation n'est pas un produit : il n'y
  // aurait rien à ranger au menu, et personne ne la retrouverait pour la
  // corriger.
  const muettes = await call('PUT', '/api/catalogue-produits', [
    { famille: 'Essais', designation: 'Bon', prixVenteTtc: 5 },
    { famille: '   ', designation: 'Sans rayon' },
    { famille: 'Essais', designation: '  ' },
  ]);
  assert.strictEqual(muettes.body.length, 1, 'une ligne muette n’entre pas au catalogue');

  // =========================================================================
  // 5. ⚠ UN PRIX QUI CHANGE NE RETARIFE PAS UNE COMMANDE DÉJÀ PASSÉE
  // =========================================================================
  // C'est LA règle. On la joue en entier : un produit tarifé, une vente prise
  // à ce prix, puis le tarif qui triple. Rien du dossier ne doit bouger — ni
  // son montant, ni son chiffrage archivé — y compris quand on RECALCULE la
  // ligne en corrigeant sa quantité.
  await call('PUT', '/api/catalogue-produits', [
    {
      famille: 'Art de la table', designation: 'Bouchon Bois', variante: '',
      prixAchat: 2, prixVenteTtc: 6, tempsMoMin: 1, tempsMachineMin: 0,
    },
  ]);

  const REF = 'CAT-26.09.01-001';
  const PRIX_DU_JOUR = 6;
  const cree = await call('POST', '/api/comptoir/projet', {
    source: 'Vente directe',
    ref: REF,
    client: 'Marina Royale',
    name: 'Bouchon Bois',
    responsible: 'Loïc',
    due: '2026-09-04',
    stage: 'preparation',
    quantity: 10,
    amount: PRIX_DU_JOUR * 10,
    articles: [{
      label: 'Bouchon Bois',
      qty: 10,
      prod: { ref: '', couleur: '', marquage: 'Gravure', tailles: [], logos: [] },
      // Le chiffrage ARCHIVÉ : le prix à la pièce du jour de la vente, figé.
      chiffrage: { moteur: 'unitaire', unitTTC: PRIX_DU_JOUR, rate: 0 },
    }],
    recap: `TICKET ${REF}`,
    details: [['Article 1 — Désignation', 'Bouchon Bois']],
  });
  assert.strictEqual(cree.status, 201);

  const ligneDe = async (ref) => {
    const courte = (await call('GET', '/api/requests')).body
      .find((x) => x.fiche && x.fiche.ref === ref);
    return courte ? (await call('GET', `/api/requests/${courte.id}`)).body : null;
  };
  const avant = await ligneDe(REF);
  assert.ok(avant, 'le dossier doit exister');
  assert.strictEqual(avant.fiche.chiffrage.unitTTC, PRIX_DU_JOUR,
    'le prix du jour de la vente est ARCHIVÉ sur la ligne');
  assert.ok(Math.abs(Number(avant.project_value) - 60) < 0.01, 'dix bouchons à 6 € : 60 €');

  // LE TARIF TRIPLE AU CATALOGUE.
  await call('PUT', '/api/catalogue-produits', [
    {
      famille: 'Art de la table', designation: 'Bouchon Bois', variante: '',
      prixAchat: 9, prixVenteTtc: 18, tempsMoMin: 5, tempsMachineMin: 5,
    },
  ]);
  const nouveau = (await call('GET', '/api/catalogue-produits')).body[0];
  assert.strictEqual(nouveau.prixVenteTtc, 18, 'le catalogue, lui, a bien changé');

  const intact = await ligneDe(REF);
  assert.ok(Math.abs(Number(intact.project_value) - 60) < 0.01,
    'la commande d’hier vaut TOUJOURS 60 € : un prix de catalogue ne retarife rien');
  assert.strictEqual(intact.fiche.chiffrage.unitTTC, PRIX_DU_JOUR,
    'et son chiffrage archivé n’a pas bougé non plus');

  // … Y COMPRIS QUAND ON RECALCULE. Corriger la quantité rejoue le moteur : il
  // doit repartir du prix FIGÉ (6 €), jamais du tarif d'aujourd'hui (18 €).
  const recalcul = await call('PATCH', `/api/requests/${intact.id}`, { quantity: 20 });
  assert.strictEqual(recalcul.status, 200);
  assert.strictEqual(Number(recalcul.body.quantity), 20, 'la quantité, elle, se corrige');
  assert.ok(Math.abs(Number(recalcul.body.project_value) - 120) < 0.01,
    `vingt bouchons au prix FIGÉ font 120 €, pas 360 (obtenu : ${recalcul.body.project_value})`);
  assert.strictEqual(recalcul.body.fiche.chiffrage.unitTTC, PRIX_DU_JOUR,
    'le chiffrage archivé reste celui de la prise de commande');

  // Et le moteur ne connaît toujours pas cette table : ce qui le pilote, ce
  // sont les réglages du chiffrage, pas le catalogue.
  assert.ok(!lire('chiffrage.js').includes('catalogue_produits'),
    'le moteur de chiffrage (conforme au V9 du patron) ne lit pas le catalogue');

  // =========================================================================
  // 6. LE COMPTOIR LIT LA BASE, PLUS LE FICHIER
  // =========================================================================
  const CATALOGUE_JS = lire('public/comptoir/catalogue.js');
  assert.ok(/\/api\/catalogue-produits/.test(CATALOGUE_JS),
    'le comptoir va chercher ses rayons en base');
  assert.ok(!/const CATALOGUE\s*=\s*\[\s*\{/.test(CATALOGUE_JS),
    '… et ne les porte plus en dur : un prix ne s’importe pas dans du code');

  console.log('✓ catalogue produits : la base sème, le comptoir lit, et un prix qui change ne retarife rien');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
