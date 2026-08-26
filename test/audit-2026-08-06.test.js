'use strict';

// Audit du 06/08/2026 — les correctifs, vérifiés là où ils vivent.
//
//   1. CHANGER DE FAMILLE INVALIDE LA SOUS-ÉTAPE. Un PATCH qui ne portait que
//      `{ stage }` laissait « Production UV » sur une commande passée en
//      Facturation : la ligne comptait dans DEUX entrées du rail, et la
//      pastille annonçait un dossier de plus que ce que la grille montrait.
//   2. OUVRIR LE PLANNING SUR UNE COMMANDE passe par UN SEUL chemin, qui aligne
//      l'URL. Sans ça l'onglet Dashboard restait mort après « Ouvrir dans le
//      planning », et un dossier comptoir rangé en « À commander » s'ouvrait sur
//      la mauvaise étape — sans jamais montrer la ligne qu'on venait de créer.
//   3. LE POINT DU JOUR NE TÉLÉCHARGE PLUS TOUT LE PLANNING avant d'être ouvert,
//      ni quand l'onglet du navigateur est en veille.
//   4. LES TECHNIQUES DE MARQUAGE voyagent dans la liste allégée : le moteur de
//      priorité peut enfin rattacher une commande à sa machine avant qu'elle
//      n'arrive en production, comme son code l'annonce.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

// Découpe une fonction dans un source : de sa signature jusqu'à l'accolade
// fermante posée à la MÊME indentation. Suffisant ici — ces fichiers ne mettent
// jamais une accolade seule à ce niveau au milieu d'un corps de fonction.
function bloc(src, signature) {
  const from = src.indexOf(signature);
  assert.ok(from >= 0, `bloc introuvable : ${signature}`);
  const indent = signature.match(/^\s*/)[0];
  const to = src.indexOf(`\n${indent}}`, from);
  assert.ok(to > from, `fin de bloc introuvable : ${signature}`);
  return src.slice(from, to + indent.length + 2);
}

(async () => {
  // =========================================================================
  // 1. Serveur — changer de famille remet la sous-étape à zéro
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

  const call = async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };

  const avant = (await call('GET', '/api/counts')).body;
  const cree = await call('POST', '/api/requests', {
    billing_company: 'Audit 06/08 — orpheline', stage: 'production', sub_stage: 'prod_uv',
  });
  assert.strictEqual(cree.status, 201);
  const id = cree.body.id;
  assert.strictEqual(
    (await call('GET', '/api/counts')).body.prod_uv, avant.prod_uv + 1,
    'la ligne compte bien dans sa sous-étape de départ',
  );

  // Le geste fautif : on ne dit RIEN de la sous-étape, on change juste de famille.
  const deplacee = await call('PATCH', `/api/requests/${id}`, { stage: 'facturation' });
  assert.strictEqual(deplacee.status, 200);
  assert.strictEqual(deplacee.body.stage, 'facturation');
  assert.strictEqual(
    deplacee.body.sub_stage, null,
    'changer de famille sans préciser la sous-étape la remet à « à préciser »',
  );

  const apres = (await call('GET', '/api/counts')).body;
  assert.strictEqual(
    apres.prod_uv, avant.prod_uv,
    'la commande ne compte plus dans une sous-étape de son ancienne famille',
  );
  assert.strictEqual(apres.facturation, avant.facturation + 1, 'elle compte dans sa nouvelle famille');

  // Rester dans la MÊME famille ne touche évidemment à rien.
  await call('PATCH', `/api/requests/${id}`, { stage: 'facturation', sub_stage: 'facturation_a_faire' });
  const memeFamille = await call('PATCH', `/api/requests/${id}`, { stage: 'facturation' });
  assert.strictEqual(
    memeFamille.body.sub_stage, 'facturation_a_faire',
    'un PATCH qui reprend la même famille garde la sous-étape',
  );

  // Et la sous-étape explicitement demandée l'emporte toujours.
  const explicite = await call('PATCH', `/api/requests/${id}`, {
    stage: 'production', sub_stage: 'prod_dtf',
  });
  assert.strictEqual(explicite.body.sub_stage, 'prod_dtf', 'la paire explicite passe telle quelle');

  // Les colonnes NOT NULL : un refus qui explique, pas un « Erreur serveur ».
  for (const corps of [{ stage: null }, { priority: null }]) {
    const vide = await call('PATCH', `/api/requests/${id}`, corps);
    assert.strictEqual(vide.status, 400, `${Object.keys(corps)[0]} vide → 400, pas 500`);
    assert.match(vide.body.error, /ne peut pas être vide/);
  }
  assert.strictEqual(
    (await call('POST', '/api/requests', { stage: null, billing_company: 'x' })).status, 400,
    'même refus à la création',
  );
  // La ligne n'a évidemment pas bougé.
  assert.strictEqual((await call('GET', `/api/requests/${id}`)).body.stage, 'production');

  // =========================================================================
  // 2. Les techniques de marquage voyagent dans la liste
  // =========================================================================
  // Une commande de polos marqués en DTF, prise par Nouveau Projet : elle entre
  // au chiffrage, donc bien AVANT la production — c'est tout l'enjeu.
  const projet = await call('POST', '/api/projets', {
    kind: 'commande',
    delai: 'j5',
    client: { type: 'pro', societe: 'Audit Technique' },
    lignes: [{
      type: 'textile', quantite: 3, designation: 'Polo', prixUnitaireTtc: 30,
      faces: { avant: { emplacement: 'coeur', technique: 'dtf' } },
    }],
  });
  assert.strictEqual(projet.status, 201, JSON.stringify(projet.body));
  assert.strictEqual(projet.body.projet.stage, 'demande_chiffrage');

  const liste = (await call('GET', '/api/requests?stage=demande_chiffrage')).body;
  const ligne = liste.find((r) => r.id === projet.body.id);
  assert.ok(ligne, 'la ligne du projet est bien au planning');
  assert.deepStrictEqual(
    ligne.fiche.techniques, ['dtf'],
    'la liste allégée transporte la technique de marquage',
  );
  // Le détail complet, lui, n'est TOUJOURS PAS dans la liste : l'allègement tient.
  assert.strictEqual(ligne.fiche.fichePartielle, true);
  assert.strictEqual(ligne.fiche.lignes, undefined);
  assert.strictEqual(ligne.fiche.client, undefined);

  // =========================================================================
  // 3. priority.js — machineOf lit ce que la liste transporte vraiment
  // =========================================================================
  const bac = {};
  vm.createContext(bac);
  vm.runInContext(
    `${lire('priority.js').replace(/^export\s+/gm, '')}
     globalThis.machineOf = machineOf;`,
    bac,
  );
  assert.strictEqual(
    bac.machineOf({ sub_stage: 'prod_dtf' }), 'dtf',
    'la sous-étape de production reste prioritaire',
  );
  assert.strictEqual(
    bac.machineOf({ stage: 'demande_chiffrage', fiche: { techniques: ['laser'] } }), 'trotec',
    'une commande encore au chiffrage est rattachée à sa machine par la technique',
  );
  assert.strictEqual(
    bac.machineOf({ stage: 'preparation', fiche: { fichePartielle: true } }), null,
    'sans technique connue, aucune machine inventée',
  );

  // =========================================================================
  // 4. app.js — un seul chemin pour ouvrir le planning sur une commande
  // =========================================================================
  const APP = lire('app.js');
  const contexte = {
    SUB_LABEL: { a_commander: 'À commander', prod_uv: 'Production UV' },
    PROMOTED: [
      { hash: '#fiverr', view: 'fiverr', stage: 'fiverr', sub: null },
      { hash: '#a-commander', view: 'a_commander', stage: 'preparation', sub: 'a_commander' },
    ],
    journal: [],
  };
  contexte.setViewMode = (m) => { contexte.vue = m; contexte.journal.push(`vue:${m}`); };
  contexte.selectStage = async (slug, sub, forcer) => {
    contexte.journal.push(`etape:${slug}|${sub || ''}${forcer ? '|forcee' : ''}`);
  };
  // La ligne visée est toujours montée ici : le repli « hors des 400 dernières »
  // a son propre test (audit-2026-08-06-soir).
  contexte.revealRow = (rid) => { contexte.journal.push(`pointe:${rid}`); return true; };
  // La ligne visée est toujours montée dans ce test-ci : la fiche hors liste ne
  // sert jamais, mais elle doit exister dans le bac à sable.
  contexte.ouvrirFicheHorsListe = async (rid) => { contexte.journal.push(`fiche:${rid}`); };
  contexte.showToast = (t) => { contexte.journal.push(`toast:${t}`); };
  contexte.location = { hash: '#dashboard' };
  contexte.history = { replaceState: (_a, _b, h) => { contexte.location.hash = h; } };
  // La liste se monte par tranches ; le saut l'attend avant de conclure (voir
  // TRANCHE_RENDU dans app.js). Ici elle est toujours prête.
  contexte.listeMontee = Promise.resolve();
  vm.createContext(contexte);
  vm.runInContext(
    `${bloc(APP, 'async function ouvrirCommandeAuPlanning(')}
     globalThis.ouvrir = ouvrirCommandeAuPlanning;`,
    contexte,
  );

  // Depuis le Point du jour, sur une commande ordinaire : l'URL suit la vue.
  await contexte.ouvrir({ id: 'abc', stage: 'production', sub: 'prod_uv' });
  assert.strictEqual(contexte.vue, 'planning');
  assert.strictEqual(
    contexte.location.hash, '#planning',
    'l’URL ne reste pas sur #dashboard — sinon retaper l’onglet Dashboard ne fait plus rien',
  );
  assert.deepStrictEqual(contexte.journal.slice(-2), ['etape:production|prod_uv', 'pointe:abc']);

  // Un dossier comptoir rangé dans une catégorie promue en onglet : c'est SON
  // onglet qui s'ouvre, et la relecture est forcée (la ligne vient de naître).
  contexte.journal.length = 0;
  contexte.location.hash = '#nouveau-projet';
  await contexte.ouvrir({ id: 'def', stage: 'preparation', sub: 'a_commander' }, true);
  assert.strictEqual(contexte.vue, 'a_commander', 'l’onglet « À commander » prend la main');
  assert.strictEqual(contexte.location.hash, '#a-commander');
  assert.deepStrictEqual(
    contexte.journal, ['vue:a_commander', 'etape:preparation|a_commander|forcee', 'pointe:def'],
    'on charge l’étape APRÈS avoir posé la vue, et on pointe la ligne créée',
  );

  // Une sous-étape inconnue (slug hérité) ne fait pas dérailler : famille seule.
  contexte.journal.length = 0;
  await contexte.ouvrir({ id: 'ghi', stage: 'production', sub: 'slug_inconnu' });
  assert.deepStrictEqual(contexte.journal.slice(-2), ['etape:production|', 'pointe:ghi']);

  // Les TROIS entrées passent par ce chemin — c'est tout l'intérêt du correctif.
  for (const appelant of [
    'const jumpToPlanning = (r) => ouvrirCommandeAuPlanning(',
    'await ouvrirCommandeAuPlanning({ id: r.id, stage: r.stage, sub: r.sub_stage });',
    'await ouvrirCommandeAuPlanning({ id, stage, sub }, true);',
  ]) {
    assert.ok(APP.includes(appelant), `entrée non branchée sur le chemin unique : ${appelant}`);
  }
  // LA GARDE PORTE SUR LE CHEMIN DES COMMANDES, et seulement sur lui. Depuis
  // que la recherche est globale (§44), elle rend aussi des CLIENTS et des
  // PRODUITS — qui ne s'ouvrent pas au planning : les envoyer sur
  // `ouvrirCommandeAuPlanning` chercherait une commande qui n'existe pas, et le
  // clic semblerait « ne rien faire ».
  //
  // Ce qui doit rester vrai : une COMMANDE ne saute jamais par le hash. On
  // vérifie donc que chaque écriture de hash est gardée par un test de nature,
  // et que la fonction se termine bien sur le chemin unique.
  const saut = APP.slice(APP.indexOf('async function jumpToResult'));
  const corpsSaut = saut.slice(0, saut.indexOf('\n}'));
  const avantChaqueHash = corpsSaut.split('location.hash = ').slice(0, -1);
  for (const avant of avantChaqueHash) {
    assert.ok(/r\.__quoi === '(client|produit)'\)\s*\{[^}]*$/.test(avant.replace(/\n/g, ' ')),
      'toute écriture de hash dans la recherche doit être réservée à un résultat qui n’est PAS une commande');
  }
  assert.ok(
    /await ouvrirCommandeAuPlanning\(\{ id: r\.id, stage: r\.stage, sub: r\.sub_stage \}\);/.test(corpsSaut),
    '… et une commande passe TOUJOURS par le chemin unique',
  );

  // =========================================================================
  // 5. dashboard.js — pas de planning entier avant d'être ouvert
  // =========================================================================
  const DASH = lire('dashboard.js');
  const start = bloc(DASH, '  function start() {');
  assert.ok(!/\brefresh\(\)/.test(start), 'start() ne déclenche plus le chargement du planning entier');

  const notify = bloc(DASH, '  function notifyChange(kinds) {');
  const bacDash = {
    loaded: false, visible: false, veilleTimer: null, dernierRefresh: 0,
    configARecharger: false,
    KINDS_CONFIG: new Set(['category-owners', 'category-referents', 'machines']),
    REFRESH_FOND_MS: 30000, appels: 0, minuteries: 0,
    document: { hidden: false },
    setTimeout: () => { bacDash.minuteries += 1; return 1; },
    Date: { now: () => 1000 },
  };
  bacDash.refresh = () => { bacDash.appels += 1; };
  vm.createContext(bacDash);
  vm.runInContext(`${notify}\n globalThis.notifyChange = notifyChange;`, bacDash);

  bacDash.notifyChange('update');
  assert.strictEqual(bacDash.appels, 0, 'jamais ouvert : aucun téléchargement');
  assert.strictEqual(bacDash.minuteries, 0, 'ni minuterie de rattrapage');

  // Un réglage du patron pendant qu'on ne regarde pas ne doit pas se perdre :
  // il est NOTÉ, même si la relecture attend.
  bacDash.notifyChange('category-owners');
  assert.strictEqual(bacDash.appels, 0, 'toujours aucun téléchargement');
  assert.strictEqual(bacDash.configARecharger, true, 'la config à relire est retenue pour plus tard');

  bacDash.loaded = true;
  bacDash.document.hidden = true;
  bacDash.visible = true;
  bacDash.notifyChange('update');
  assert.strictEqual(bacDash.appels, 0, 'onglet en veille : on ne rejoue pas la synthèse');

  bacDash.document.hidden = false;
  bacDash.notifyChange('update');
  assert.strictEqual(bacDash.appels, 1, 'affiché et sous les yeux : on suit le temps réel');

  bacDash.visible = false;
  bacDash.notifyChange('update');
  assert.strictEqual(bacDash.appels, 1, 'masqué : pas de rechargement immédiat…');
  assert.strictEqual(bacDash.minuteries, 1, '…mais un rattrapage de fond est programmé');

  console.log('✓ audit 06/08 : sous-étape orpheline, chemin unique vers le planning, '
    + 'Point du jour à la demande, techniques de marquage OK');
  app.__server.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
