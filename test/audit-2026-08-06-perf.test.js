'use strict';

// Audit du 06/08/2026 — CE QUI RAME, et ce qui grossit sans fin.
//
//   1. LA TABLETTE SE FIGE À L'OUVERTURE D'UNE LONGUE LISTE. Aucune commande ne
//      quitte le planning : « Paiement & clôture » en garde 400 par défaut, et
//      tout l'historique dès qu'on retrouve une commande archivée par la
//      recherche. Chacune coûte une quarantaine de nœuds, ses écouteurs et son
//      calcul d'heures ouvrées, et TOUT était construit d'un seul tenant :
//      mesuré à 1 200 commandes, une tâche d'UNE SECONDE sur un ordinateur de
//      bureau — donc plusieurs secondes sur la Galaxy Tab de l'atelier, pendant
//      lesquelles ni le défilement, ni un tap, ni la recherche ne répondent.
//   2. LA MOITIÉ DE CE QUE LIT LA BASE EST JETÉE À LA LIGNE SUIVANTE. La liste
//      ne garde de la fiche que le numéro de ticket, l'heure de retrait et les
//      techniques — mais elle la lisait ENTIÈRE. Une vraie fiche de vente pèse
//      3,6 Ko dont 3,2 Ko de récapitulatif ligne à ligne : sur 400 commandes,
//      1,4 Mo lus, sérialisés et analysés pour en servir 330 Ko. À chaque
//      rafraîchissement, pour chaque poste.
//   3. LE POINT DU JOUR RETÉLÉCHARGEAIT 60 Ko D'IDENTIFIANTS INCHANGÉS. `ids`
//      dit quelles commandes existent et dans quel ordre : c'est ce qui permet
//      de repérer une suppression. Mais la composition ne bouge QUE quand une
//      ligne naît, meurt ou change de place — et la liste repartait entière à
//      chaque évènement, sur chaque poste. Mesuré : 59 Ko par pastille posée,
//      sur 1 500 commandes, et ça ne fait que grossir.
//   4. `GET /api/requests` SANS ÉTAPE AMPUTAIT LA RÉPONSE EN SILENCE. Le plafond
//      de 400 s'appliquait sur l'ordre normal, donc sur les PREMIÈRES lignes,
//      classées par étape (alphabétiquement) : « demande_chiffrage » et
//      « facturation » remplissaient les 400 places, « production » et
//      « préparation » n'apparaissaient jamais.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

const racine = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8');

// Découpe une fonction dans un source : de sa signature jusqu'à l'accolade
// fermante posée à la MÊME indentation.
function bloc(src, signature) {
  const from = src.indexOf(signature);
  assert.ok(from >= 0, `bloc introuvable : ${signature}`);
  const indent = signature.match(/^\s*/)[0];
  const to = src.indexOf(`\n${indent}}`, from);
  assert.ok(to > from, `fin de bloc introuvable : ${signature}`);
  return src.slice(from, to + indent.length + 2);
}

(async () => {
  process.env.PORT = '0';
  const app = require('../server');
  const { pool } = require('../db');
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
    return {
      status: res.status,
      tronque: res.headers.get('X-Liste-Tronquee'),
      total: res.headers.get('X-Liste-Total'),
      body: res.status === 204 ? null : await res.json(),
    };
  };

  const SRV = lire('server.js');
  const APP = lire('public/app.js');
  const DASH = lire('public/dashboard.js');
  const CSS = lire('public/styles.css');

  // =========================================================================
  // 2. La liste ne lit plus les parties lourdes de la fiche
  // =========================================================================
  // Un dossier du comptoir avec un vrai récapitulatif : c'est lui qui pèse.
  const lignesRecap = (n, prefixe) => Array.from({ length: n }, (_, i) => [
    `${prefixe} ${i + 1}`,
    'Valeur détaillée — taille L, zone poitrine, technique DTF, quantité 12',
  ]);
  const cree = await call('POST', '/api/comptoir/projet', {
    source: 'Vente directe',
    stage: 'Préparation du projet',
    status: 'prêt à produire',
    clientObj: { company: 'Audit Fiche Lourde', type: 'Professionnel', phone: '0690000000' },
    ref: 'AUDIT-PERF-001',
    name: '50 t-shirts staff',
    quantity: 50,
    amount: 850,
    dueTime: '14:00',
    recap: 'Récapitulatif imprimé. '.repeat(10),
    client_info: lignesRecap(8, 'Client'),
    details: lignesRecap(22, 'Article'),
    paiement: { mode: 'cb', paye: true },
    checks: { bat: true },
  });
  assert.strictEqual(cree.status, 201, JSON.stringify(cree.body));
  const idComptoir = cree.body.id;

  // Le comptoir dépose tout dans le sur-dossier « À trier » : c'est
  // là que la ligne se lit tant que personne ne l'a rangée.
  const listeATrier = await call('GET', '/api/requests?stage=a_trier');
  const enListe = listeATrier.body.find((r) => r.id === idComptoir);
  assert.ok(enListe, 'la commande du comptoir est bien dans la liste de son étape');
  // Ce que la grille affiche vraiment est là…
  assert.strictEqual(enListe.fiche.ref, 'AUDIT-PERF-001', 'le numéro de ticket voyage');
  assert.strictEqual(enListe.fiche.heureSouhaitee, '14:00', 'l’heure de retrait aussi');
  // …y compris la famille où il faudra le ranger : c'est elle qui fait le
  // bouton « Ranger dans… », donc elle DOIT survivre à l'allègement de la fiche.
  assert.deepStrictEqual(enListe.fiche.destination, { stage: 'preparation', subStage: 'pret_a_produire' },
    'la destination désignée au comptoir voyage dans la liste');
  assert.strictEqual(enListe.fiche.fichePartielle, true, 'et l’écran sait que ce n’est qu’un résumé');
  // …et le récapitulatif ligne à ligne, jamais.
  assert.strictEqual(enListe.fiche.details, undefined, 'le récapitulatif ne voyage pas dans la liste');
  assert.strictEqual(enListe.fiche.client, undefined, 'le bloc client non plus');

  // Ce n'est PAS seulement le JSON de sortie qui s'allège : la requête elle-même
  // ne demande plus ces clés à la base. Sans ça, tout le coût — lecture disque,
  // sérialisation Postgres, transport, analyse par Node — restait payé.
  const jetees = SRV.match(/const FICHE_JETEE = \[([^\]]+)\]/);
  assert.ok(jetees, 'les clés lourdes de la fiche sont nommées en un seul endroit');
  for (const cle of ['client', 'details']) {
    assert.ok(jetees[1].includes(`'${cle}'`), `« ${cle} » fait partie de ce que la liste ne lit pas`);
  }
  assert.match(
    SRV, /const FICHE_ALLEGEE_SQL = `\(r\.fiche \$\{FICHE_JETEE\.map\(\(k\) => `- '\$\{k\}'`\)/,
    'la soustraction se fait en SQL, pas après coup en JavaScript : sinon Postgres lit, '
    + 'sérialise et transporte ces kilo-octets pour rien',
  );
  assert.match(SRV, /const CHAMPS_LISTE = \[[\s\S]*?FICHE_ALLEGEE_SQL,/, 'et la liste s’en sert');
  const declSelect = SRV.slice(SRV.indexOf('const SELECT = `'), SRV.indexOf('const SELECT_COMPLET'));
  assert.ok(
    !/SELECT r\.\*/.test(declSelect),
    'la lecture de liste n’utilise plus `r.*` : il ramènerait la fiche entière et annulerait tout',
  );
  assert.match(
    SRV, /SELECT_COMPLET[\s\S]{0,40}SELECT r\.\*/,
    'seule la lecture d’UNE commande garde `r.*` — c’est elle qui doit tout rendre',
  );

  // La fiche COMPLÈTE reste servie là où on en a besoin : le tiroir de détail.
  const fichePleine = await call('GET', `/api/requests/${idComptoir}`);
  assert.strictEqual(fichePleine.status, 200);
  assert.strictEqual(
    fichePleine.body.fiche.details.length, 22,
    'le détail complet est toujours là pour la fiche qu’on ouvre',
  );
  assert.strictEqual(fichePleine.body.fiche.client.length, 8, 'le bloc client aussi');
  assert.strictEqual(fichePleine.body.fiche.fichePartielle, undefined, 'et il n’est pas marqué partiel');

  // La colonne ajoutée un jour au schéma et oubliée dans la projection
  // disparaîtrait de la grille SANS RIEN DIRE. On compare à la table.
  const { rows: colonnes } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'requests'",
  );
  const declarees = new Set(
    SRV.slice(SRV.indexOf('const COLONNES_REQUEST = ['), SRV.indexOf('];', SRV.indexOf('const COLONNES_REQUEST = [')))
      .match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1)),
  );
  for (const { column_name: c } of colonnes) {
    assert.ok(declarees.has(c), `colonne « ${c} » absente de COLONNES_REQUEST : elle ne serait plus servie`);
  }

  // =========================================================================
  // 7. Le poids mort part — mais seulement s'il est VIDE
  // =========================================================================
  // `production_sectors` et `requests.status` datent du modèle d'avant les
  // familles : recréés à chaque démarrage, jamais lus. Retirés — sauf si une
  // base contient encore quelque chose dedans : ce n'est pas au démarrage du
  // service de décider de jeter des données que personne n'a regardées.
  const DB = lire('db.js');
  const SQL = lire('schema.sql');
  for (const [fonction, compte] of [
    ['async function retirerTableProductionSectors() {', 'FROM production_sectors'],
    ['async function retirerColonneStatus() {', 'FROM requests WHERE status IS NOT NULL'],
  ]) {
    const corps = bloc(DB, fonction);
    assert.ok(corps.includes(compte), `${fonction} compte ce qu'il y a avant de retirer`);
    assert.ok(
      corps.indexOf('rows[0].n > 0') < corps.indexOf('DROP'),
      `${fonction} ne retire rien tant qu'il reste une ligne`,
    );
    assert.match(corps, /Down :|console\.log/, `${fonction} dit ce qu'il a conservé`);
  }
  // Sans les commentaires : le DDL de retour arrière (« Down ») cite forcément
  // ce qu'on vérifie avoir disparu.
  const SQL_ACTIF = SQL.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  assert.ok(!/^\s*status\s+text,/m.test(SQL_ACTIF), 'la colonne `status` ne se crée plus');
  assert.ok(
    !/CREATE TABLE IF NOT EXISTS production_sectors/.test(SQL_ACTIF),
    'la table `production_sectors` ne se crée plus',
  );
  // Les deux derniers points qui la touchaient encore doivent survivre à son
  // absence : une table manquante ne doit transformer ni un démarrage ni une
  // suppression de commande en panne.
  assert.match(
    SRV, /DELETE FROM production_sectors WHERE request_id = \$1', \[req\.params\.id\]\)\s*\n\s*\.catch/,
    'la cascade de suppression tolère la table retirée',
  );
  assert.match(
    DB, /SELECT sector FROM production_sectors[\s\S]{0,120}\.then\(\(x\) => x\.rows, \(\) => \[\]\)/,
    'et la vieille migration aussi',
  );
  const suppr = await call('POST', '/api/requests', { stage: 'production', billing_company: 'À supprimer' });
  assert.strictEqual(
    (await call('DELETE', `/api/requests/${suppr.body.id}`)).status, 204,
    'supprimer une commande marche toujours sans la table',
  );

  // La synthèse du Point du jour porte la même règle.
  const chSynthese = SRV.slice(SRV.indexOf('const SYNTHESE_CHAMPS'), SRV.indexOf('function allegerSynthese'));
  assert.ok(
    !/r\.fiche(?!\s*-)/.test(chSynthese.replace('FICHE_ALLEGEE_SQL', '')),
    'la synthèse ne lit pas non plus la fiche entière',
  );

  // =========================================================================
  // 3. La synthèse ne réexpédie plus une composition inchangée
  // =========================================================================
  const premier = await call('GET', '/api/requests/synthese');
  assert.strictEqual(premier.status, 200);
  assert.ok(Array.isArray(premier.body.ids), 'un premier chargement reçoit la composition entière');
  assert.ok(premier.body.empreinte, 'et l’empreinte qui la résume');
  const empreinte = premier.body.empreinte;

  // Deuxième passage, rien n'a bougé : le poste renvoie l'empreinte, le serveur
  // ne réexpédie pas la liste.
  const inchange = await call(
    'GET', `/api/requests/synthese?depuis=${encodeURIComponent(premier.body.jusqua)}&empreinte=${empreinte}`,
  );
  assert.strictEqual(inchange.body.ids, undefined, 'composition identique : les identifiants ne repartent pas');
  assert.strictEqual(inchange.body.empreinte, empreinte, 'l’empreinte, elle, est toujours rendue');

  // Une modification SANS changement de composition (une valeur qui change) ne
  // fait pas repartir la liste non plus — c'est tout l'intérêt.
  assert.strictEqual(
    (await call('PATCH', `/api/requests/${idComptoir}`, { priority: 3 })).status, 200,
  );
  const modifiee = await call(
    'GET', `/api/requests/synthese?depuis=${encodeURIComponent(premier.body.jusqua)}&empreinte=${empreinte}`,
  );
  assert.strictEqual(modifiee.body.ids, undefined, 'une valeur qui change ne modifie pas la composition');
  assert.ok(
    modifiee.body.lignes.some((l) => l.id === idComptoir),
    'mais la ligne modifiée, elle, est bien renvoyée',
  );

  // Une commande qui NAÎT change la composition : la liste repart, sinon le
  // Point du jour ne la verrait jamais.
  const neuve = await call('POST', '/api/requests', {
    stage: 'production', billing_company: 'Audit Composition', priority: 1,
  });
  assert.strictEqual(neuve.status, 201);
  const apresCreation = await call('GET', `/api/requests/synthese?empreinte=${empreinte}`);
  assert.ok(Array.isArray(apresCreation.body.ids), 'composition changée : les identifiants repartent');
  assert.ok(
    apresCreation.body.ids.includes(neuve.body.id),
    'et la nouvelle commande y figure',
  );
  assert.notStrictEqual(apresCreation.body.empreinte, empreinte, 'l’empreinte a changé avec elle');

  // Une SUPPRESSION aussi — c'est le cas que `ids` sert justement à repérer.
  assert.strictEqual((await call('DELETE', `/api/requests/${neuve.body.id}`)).status, 204);
  const apresSuppression = await call(
    'GET', `/api/requests/synthese?empreinte=${apresCreation.body.empreinte}`,
  );
  assert.ok(Array.isArray(apresSuppression.body.ids), 'une suppression fait repartir la composition');
  assert.ok(
    !apresSuppression.body.ids.includes(neuve.body.id),
    'et la commande supprimée n’y est plus',
  );

  // Côté écran : sans `ids`, on GARDE l'ordre du dernier passage. Le confondre
  // avec « plus aucune commande » viderait le Point du jour à chaque évènement.
  const fusionner = bloc(DASH, '  function fusionner(synthese) {');
  assert.match(
    fusionner, /if \(Array\.isArray\(synthese\.ids\)\) ordreIds =/,
    'le Point du jour ne remplace son ordre que si le serveur en a envoyé un',
  );
  const bac = { rows: [{ id: 'a' }, { id: 'b' }], ordreIds: ['a', 'b'] };
  vm.createContext(bac);
  vm.runInContext(`${fusionner}\nglobalThis.f = fusionner;`, bac);
  assert.deepStrictEqual(
    bac.f({ lignes: [] }).map((r) => r.id), ['a', 'b'],
    'réponse sans `ids` : la composition connue tient',
  );
  assert.deepStrictEqual(
    bac.f({ ids: ['b'], lignes: [] }).map((r) => r.id), ['b'],
    'réponse avec `ids` : c’est elle qui fait foi (une commande a disparu)',
  );
  assert.match(
    DASH, /parametres\.set\('empreinte', empreinteIds\)/,
    'et il renvoie bien l’empreinte reçue au passage précédent',
  );

  // =========================================================================
  // 5. Le plafond de la liste monte PAR PALIERS, il ne saute plus d'un coup
  // =========================================================================
  const bourrage = [];
  for (let i = 0; i < 950; i += 1) {
    bourrage.push(call('POST', '/api/requests', {
      stage: 'paiement', sub_stage: 'archive', billing_company: `Archive ${i}`, priority: 1,
    }));
    if (bourrage.length >= 40) await Promise.all(bourrage.splice(0));
  }
  await Promise.all(bourrage);

  const palier1 = await call('GET', '/api/requests?stage=paiement');
  assert.strictEqual(palier1.body.length, 400, 'par défaut, les 400 dernières');
  assert.strictEqual(palier1.tronque, '400', 'et l’écran sait que c’est coupé');
  assert.strictEqual(
    palier1.total, '950',
    'AVEC le nombre total : sans lui, le pied de liste ne peut que dire « il en reste » '
    + 'sans jamais dire combien — donc sans qu’on sache si un clic de plus suffit',
  );

  const palier2 = await call('GET', '/api/requests?stage=paiement&max=800');
  assert.strictEqual(palier2.body.length, 800, 'un palier de plus en rend 800, pas les 950');
  assert.strictEqual(palier2.tronque, '800');
  // Le palier suivant EMBOÎTE le précédent : ce sont bien les mêmes commandes,
  // plus les anciennes. Une pagination qui décalerait la fenêtre ferait
  // disparaître des lignes de l'écran à chaque clic.
  const fin1 = palier1.body.map((r) => r.id).join(',');
  assert.ok(
    palier2.body.map((r) => r.id).join(',').endsWith(fin1),
    'le palier suivant ajoute les plus ANCIENNES en tête et garde les précédentes',
  );

  const palier3 = await call('GET', '/api/requests?stage=paiement&max=1200');
  assert.strictEqual(palier3.body.length, 950, 'au bout, tout y est');
  assert.strictEqual(palier3.tronque, null, 'et plus rien ne dit que c’est coupé');

  // Une valeur farfelue ne fait pas tomber le serveur ni sauter le plafond.
  const farfelu = await call('GET', '/api/requests?stage=paiement&max=abc');
  assert.strictEqual(farfelu.body.length, 400, 'un plafond illisible retombe sur le palier de base');
  const enorme = await call('GET', '/api/requests?stage=paiement&max=99999999');
  assert.ok(enorme.body.length <= 5000, 'et un plafond démesuré reste borné');

  // Côté écran : le palier, pas le tout-ou-rien.
  assert.match(APP, /const PALIER_LISTE = 400;/, 'l’écran raisonne en paliers');
  assert.match(APP, /&max=\$\{plafondListe\}/, 'et demande explicitement son plafond');
  const bouton = bloc(APP, "  btn.addEventListener('click', async () => {");
  assert.match(bouton, /plafondListe \+= PALIER_LISTE;/, '« afficher plus » ajoute UN palier');
  assert.match(
    bouton, /plafondListe = avant;/,
    'et le rend si le chargement échoue — sinon l’écran croirait afficher plus qu’il n’a',
  );

  // =========================================================================
  // 6. Le Point du jour ne reçoit plus l'archive
  // =========================================================================
  const pj = await call('GET', '/api/requests/synthese');
  const famillesRendues = new Set(pj.body.lignes.map((l) => l.stage));
  assert.ok(!famillesRendues.has('paiement'), 'l’archive ne part plus au Point du jour');
  assert.ok(!famillesRendues.has('fiverr'), 'Fiverr non plus — l’écran l’ignore déjà ligne par ligne');
  assert.ok(famillesRendues.has('production'), 'les familles vivantes, si');
  const idsPj = new Set(pj.body.ids);
  assert.ok(
    !pj.body.lignes.some((l) => l.stage === 'paiement' && idsPj.has(l.id)),
    'et la composition ne les liste pas non plus',
  );

  // La liste des familles doit rester le MIROIR de celle du dashboard : une
  // famille ajoutée là-bas et oubliée ici serait vide À L'ÉCRAN, sans message.
  const famillesServeur = SRV.match(/const SYNTHESE_FAMILLES = \[([^\]]+)\]/)[1]
    .match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1)).sort();
  const famillesEcran = DASH.match(/const ACTIVE_FAMILIES = \[([^\]]+)\]/)[1]
    .match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1)).sort();
  assert.deepStrictEqual(
    famillesServeur, famillesEcran,
    'SYNTHESE_FAMILLES (serveur) et ACTIVE_FAMILIES (Point du jour) doivent dire la même chose',
  );

  // MAIS une commande qui QUITTE le bord doit continuer d'arriver : c'est elle
  // que le fil d'activité annonce « marquée traitée ✓ ». Elle n'est plus dans
  // `ids`, elle est quand même dans `lignes`.
  const vivante = (await call('GET', '/api/requests?stage=production')).body[0];
  const avantSortie = await call('GET', '/api/requests/synthese');
  assert.strictEqual(
    (await call('PATCH', `/api/requests/${vivante.id}`, {
      stage: 'paiement', sub_stage: 'paiement_a_controler',
    })).status, 200,
  );
  const apresSortie = await call(
    'GET', `/api/requests/synthese?depuis=${encodeURIComponent(avantSortie.body.jusqua)}`,
  );
  assert.ok(
    apresSortie.body.lignes.some((l) => l.id === vivante.id && l.stage === 'paiement'),
    'la commande qui vient de quitter le bord est bien envoyée — sinon elle s’évaporerait '
    + 'du fil d’activité au lieu d’y être annoncée « marquée traitée »',
  );
  assert.ok(
    !apresSortie.body.ids || !apresSortie.body.ids.includes(vivante.id),
    'mais elle ne fait plus partie du tableau',
  );
  const fusion = bloc(DASH, '  async function refresh() {');
  assert.match(
    fusion, /const parties = \(synthese\.lignes \|\| \[\]\)\.filter/,
    'et l’écran donne bien ces sorties au fil d’activité',
  );

  // =========================================================================
  // 4. `GET /api/requests` sans étape rend la FIN de la liste
  // =========================================================================
  const paquet = [];
  for (let i = 0; i < 430; i += 1) {
    paquet.push(call('POST', '/api/requests', {
      stage: 'demande_chiffrage', billing_company: `Bourrage ${i}`, priority: 1,
    }));
    if (paquet.length >= 30) await Promise.all(paquet.splice(0));
  }
  await Promise.all(paquet);

  const toutes = await call('GET', '/api/requests');
  assert.strictEqual(toutes.body.length, 400, 'la réponse reste plafonnée');
  assert.strictEqual(toutes.tronque, '400', 'et l’écran est prévenu qu’elle est coupée');
  const etapesVues = new Set(toutes.body.map((r) => r.stage));
  assert.ok(
    etapesVues.has('preparation'),
    'la « Préparation » est représentée : avant, 430 lignes de « demande_chiffrage » '
    + 'remplissaient les 400 places et les étapes suivantes disparaissaient en silence',
  );
  assert.ok(etapesVues.has('production'), 'la « Production » aussi');

  // =========================================================================
  // 1. La liste se monte par tranches — le fil principal ne se bloque plus
  // =========================================================================
  assert.match(APP, /const TRANCHE_RENDU = \d+;/, 'la taille d’une tranche de rendu est nommée');
  const tranche = Number(APP.match(/const TRANCHE_RENDU = (\d+);/)[1]);
  assert.ok(tranche >= 40 && tranche <= 150, `tranche de ${tranche} : de quoi remplir un écran, pas plus`);

  for (const nom of ['function renderCards(data) {', 'function renderRows(data) {']) {
    const corps = bloc(APP, nom);
    assert.match(corps, /let budget = TRANCHE_RENDU;/, `${nom} construit par tranches`);
    assert.match(corps, /if \(budget <= 0\) \{ reste = true; break; \}/, `${nom} s’arrête au bout de sa tranche`);
    assert.match(corps, /if \(reste\) planifierSuiteRendu\(\);/, `${nom} programme la suite`);
    assert.match(
      corps, /reste \? null : avantReordonnancement\(/,
      `${nom} n’anime pas le réordonnancement tant que la liste se remplit — `
      + 'sinon chaque tranche ferait glisser tout ce qui est déjà posé',
    );
  }

  // Une ligne DÉJÀ montée ne consomme pas la tranche : un rafraîchissement
  // ordinaire (une valeur qui change) reste en un seul passage, comme avant.
  const corpsCartes = bloc(APP, 'function renderCards(data) {');
  const ordreOps = corpsCartes.indexOf('ordre.push(entry.el)');
  assert.ok(
    corpsCartes.lastIndexOf('budget -= 1', ordreOps) > corpsCartes.indexOf('let budget'),
    'seule la CONSTRUCTION d’une carte consomme la tranche',
  );

  // Le saut vers une commande retrouvée par la recherche attend que la liste
  // soit montée : sans ça, il conclurait « cette commande n’est plus à cette
  // étape » sur une ligne simplement en train de se poser.
  const saut = bloc(APP, 'async function ouvrirCommandeAuPlanning(');
  assert.ok(
    saut.indexOf('await listeMontee;') < saut.indexOf('if (revealRow(id)) return;'),
    'le saut attend la fin du rendu AVANT de chercher la ligne',
  );
  // Et il ne charge PLUS l'archive entière pour montrer une ligne : il ouvre la
  // fiche. Monter mille deux cents commandes pour en faire clignoter une, c'est
  // exactement ce qui laissait le planning lourd pour le reste de la journée.
  assert.match(saut, /await ouvrirFicheHorsListe\(id\)/, 'la commande hors liste s’ouvre par sa fiche');
  assert.ok(
    !/toutAfficher/.test(saut) && !/loadRows\(\)/.test(saut),
    'le saut ne relit plus l’étape sans plafond',
  );
  assert.ok(!/toutAfficher/.test(APP), '« tout afficher » a disparu de l’écran au profit des paliers');

  // Le compteur d'étape porte sur la DONNÉE : compter les seules lignes déjà
  // dans le DOM afficherait « 80 commandes », puis 160, puis 240…
  const compteur = bloc(APP, 'function applySearchAndCounts() {');
  const posMatch = compteur.indexOf('if (match) visible++');
  const posEntry = compteur.indexOf('const entry =');
  assert.ok(posMatch > 0 && posEntry > posMatch, 'on compte avant de regarder si la ligne est montée');

  const replier = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const sable = {
    gridQuery: '',
    lastRendered: [
      { id: '1', billing_company: 'Hôtel Esmeralda' },
      { id: '2', billing_company: 'Ocean Dive' },
      { id: '3', billing_company: 'Esmeralda Beach', fiche: { ref: '26.08.06-042' } },
    ],
    // Une seule carte montée sur trois : on est au milieu du rendu par tranches.
    cardEls: new Map([['1', { el: { classList: { toggle() {} } } }]]),
    rowEls: new Map(),
    modeCartes: () => true,
    SEARCH_FIELDS: ['billing_company'],
    fold: replier,
    // Le numéro du ticket entre lui aussi dans le filtre (voir refsTicket) :
    // c'est le repère que le client rapporte au comptoir.
    refsTicket: (r) => (r.fiche ? replier([r.fiche.ref, r.fiche.refTicket].filter(Boolean).join(' ')) : ''),
    paintZebra: () => {},
    $empty: { hidden: false, textContent: '' },
    $stageCount: { textContent: '' },
  };
  vm.createContext(sable);
  vm.runInContext(`${compteur}\nglobalThis.compter = applySearchAndCounts;`, sable);
  sable.compter();
  assert.strictEqual(
    sable.$stageCount.textContent, '3 commandes',
    'le compteur annonce les 3 commandes de l’étape, pas la seule carte déjà posée',
  );
  sable.gridQuery = 'esmeralda';
  sable.compter();
  assert.strictEqual(
    sable.$stageCount.textContent, '2 commandes',
    'et le filtre porte lui aussi sur la donnée entière',
  );
  // Le numéro lu sur le ticket du client filtre la grille comme un nom.
  sable.gridQuery = '06-042';
  sable.compter();
  assert.strictEqual(sable.$stageCount.textContent, '1 commande');

  // `content-visibility: auto` a été essayé sur les cartes, mesuré, et RETIRÉ :
  // sur une liste de cette forme, le travail différé retombe pendant le
  // défilement (72 ms par image contre 52 sans, processeur ralenti au niveau de
  // la tablette) et la hauteur présumée gonflait la liste de 44 %. Le garde-fou
  // est ici pour qu'on ne le repose pas de bonne foi dans six mois.
  // Sans les commentaires : celui qui explique la décision cite forcément la
  // propriété qu'on interdit.
  const reglePcard = CSS.slice(CSS.indexOf('\n.pcard {'), CSS.indexOf('.pcard:hover'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(
    !/content-visibility:\s*auto/.test(reglePcard),
    'les cartes ne sautent PAS leur rendu : mesuré plus lent au défilement, et la '
    + 'barre de défilement s’en trouvait faussée. Le blocage venait de la construction '
    + 'de la liste, réglé par TRANCHE_RENDU.',
  );

  console.log(
    '✓ audit 06/08 perf : liste montée par tranches, fiche allégée en SQL, '
    + 'composition non réexpédiée, plafond sans étape corrigé',
  );
  app.__server.close();
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
