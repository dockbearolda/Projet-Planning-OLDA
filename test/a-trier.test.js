'use strict';

// LE SUR-DOSSIER « À TRIER ».
// ===========================================================================
// Demande du patron, 14/08 : « je veux que 100 % des commandes qui arrivent sur
// la page de fin s'ajoutent automatiquement dans un sur-dossier tout en haut du
// planning, où ma vendeuse peut prendre 5 clients et à la fin revenir sur
// l'écran du planning pour dispatcher les commandes dans les bonnes
// catégories. »
//
// Donc : tout ce qui sort du comptoir — vente encaissée comme demande de devis —
// atterrit dans UNE famille d'attente, en tête du rail. Elle n'a pas de
// sous-étapes : un dossier qui n'a pas encore été rangé n'est à aucune étape de
// travail, et c'est précisément ce qu'il faut voir.
//
// La famille que la vendeuse a désignée AU COMPTOIR n'est pas perdue pour
// autant : elle voyage dans `fiche.destination` et devient le bouton « Ranger
// dans … ». Cinq dossiers se rangent en cinq gestes.
//
// Ce que ce fichier garde :
//   - la famille existe, en TÊTE, sans sous-étape ;
//   - tout le comptoir y arrive, quelle que soit sa nature ;
//   - la destination survit à l'allègement de la fiche (sans elle, plus de
//     bouton — le rangement redeviendrait un menu à fouiller) ;
//   - ranger, c'est un simple déplacement : la ligne quitte le sur-dossier et
//     arrive entière à sa place ;
//   - le Point du jour la regarde (une famille absente de sa liste est vide EN
//     SILENCE) ;
//   - l'écran : un bouton, dans les deux vues, à la place de ce qu'il remplace.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const APP = lire('public/app.js');
const CSS = lire('public/styles.css');
const DB = lire('db.js');
const SERVEUR = lire('server.js');
const DASH = lire('public/dashboard.js');

// ===========================================================================
// 1. LA FAMILLE : EN TÊTE, ET SANS SOUS-ÉTAPE
// ===========================================================================
const { STAGES, STAGE_SLUGS, SUB_STAGES } = require('../db');
assert.strictEqual(STAGES[0].slug, 'a_trier',
  'le sur-dossier doit être la PREMIÈRE famille : « tout en haut du planning »');
assert.strictEqual(SUB_STAGES.a_trier, undefined,
  'un dossier non rangé n’est à aucune étape de travail : pas de sous-étapes');
assert.ok(STAGE_SLUGS.includes('a_trier'));

// Le rail de l'écran est un MIROIR de db.js : une famille présente d'un côté et
// absente de l'autre, c'est une catégorie qu'on ne peut plus atteindre.
const famillesEcran = APP.match(/const FAMILIES = \[([\s\S]*?)\n\];/)[1]
  .match(/slug: '([a-z_]+)'/g).map((m) => m.slice(7, -1));
assert.strictEqual(famillesEcran[0], 'a_trier', 'l’écran doit la placer en tête, lui aussi');
assert.deepStrictEqual(famillesEcran, STAGES.filter((s) => s.slug !== 'fiverr').map((s) => s.slug),
  'les familles de l’écran et celles du serveur doivent dire la même chose');

// Le Point du jour ne regarde qu'une liste de familles : celle qu'il ignore est
// vide EN SILENCE, sans message ni erreur.
assert.ok(/const SYNTHESE_FAMILLES = \['a_trier'/.test(SERVEUR),
  'la synthèse doit porter le sur-dossier');
assert.ok(/const ACTIVE_FAMILIES = \['a_trier'/.test(DASH),
  'le Point du jour doit regarder le sur-dossier');

// ===========================================================================
// 2. L'ÉCRAN : UN BOUTON QUI RANGE, À LA PLACE DE CE QU'IL REMPLACE
// ===========================================================================
assert.ok(/const A_TRIER = 'a_trier';/.test(APP), 'le sur-dossier se nomme une fois');

// Tableau : la cellule « sous-étape » — vide pour une famille qui n'en a pas —
// porte le bouton. Carte : la deuxième puce. Dans les deux cas, l'élément
// EXISTE DÉJÀ : une piste qui n'apparaîtrait que sur certaines lignes décalerait
// toute la file (c'est arrivé, cf. la rangée d'actions de la ligne).
assert.ok(/if \(r\.stage === A_TRIER\) \{ td\.appendChild\(boutonRanger\(r\)\); return td; \}/.test(APP),
  'la cellule sous-étape du tableau doit porter le rangement');
assert.ok(/meta\.appendChild\(r\.stage === A_TRIER && currentStage === A_TRIER\s*\n\s*\? boutonRanger\(r\)/.test(APP),
  'la puce de la carte doit porter le rangement');

// UN tap = rangé. La destination vient du comptoir, pas d'un menu à fouiller.
const BOUTON = APP.match(/function boutonRanger\(r\)[\s\S]*?\n\}/)[0];
assert.ok(/moveToStage\(r, dest\.stage, dest\.sub\)/.test(BOUTON),
  'ranger, c’est déplacer la ligne vers la famille désignée');
assert.ok(/armerUneFois\(btn\)/.test(BOUTON),
  'un doigt qui rebondit ne doit pas ranger deux fois');
// Destination inconnue : on n'invente pas de famille, on ouvre la fiche — son
// sélecteur « Famille › Sous-étape » couvre tout le pipeline.
assert.ok(/openLigneDetail\(r\.id\)/.test(BOUTON),
  'sans destination connue, on renvoie sur la fiche plutôt que de deviner');

// LE TACTILE A ÉTÉ RETIRÉ LE 25/08. Les Galaxy Tab sont au rebut depuis le
// 21/08 et le projet est PC uniquement : les sept blocs `@media (pointer:
// coarse)` ne servaient plus personne, et leurs cibles de 44 px entretenaient
// une deuxième échelle de tailles à côté de celle de la charte.
// Ce qui se vérifie maintenant : qu'ils ne reviennent pas.
assert.ok(!/@media \(pointer: coarse\)/.test(CSS),
  'plus de règles tactiles : le projet est PC uniquement (voir CLAUDE.md)');
// La couleur dit un ÉTAT (« pas encore à sa place »), jamais une décoration :
// elle vient des variables de la charte, pas d'un code écrit en dur.
const REGLE = CSS.match(/\n\.ranger-chip \{[\s\S]*?\n\}/)[0];
assert.ok(/background: var\(--primary\)/.test(REGLE) && !/#[0-9a-fA-F]{3,6}/.test(REGLE),
  'le bouton suit la charte, aucune couleur en dur');
// Le compteur du rail se repeint à trois endroits : sa teinte se règle en CSS,
// pas à la main — sinon l'un des trois finit par l'oublier.
assert.ok(/\.stage\[data-slug="a_trier"\] \.stage-count\.has-items/.test(CSS),
  'le compteur du sur-dossier doit se distinguer, en CSS');

// La fiche doit pouvoir RAMENER une commande dans le sur-dossier (erreur de
// rangement) : `placesDuPipeline` traite déjà les familles sans sous-étape.
assert.ok(/if \(!subs\.length\) \{ places\.push\(\{ value: `\$\{f\.slug\}\|`, label: f\.label \}\); continue; \}/.test(APP),
  'une famille sans sous-étape reste une destination à part entière');

// ===========================================================================
// 3. LE PARCOURS COMPLET, CONTRE LE VRAI SERVEUR
// ===========================================================================
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
  const call = async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  // Cinq clients d'affilée, comme au comptoir : ventes et demandes mêlées, avec
  // les trois destinations que les écrans savent produire.
  const clients = [
    { source: 'Vente directe', stage: 'preparation', status: 'Préparation des produits', nom: 'Client A', amount: 120, dest: ['preparation', 'prepa_produits'] },
    { source: 'Vente directe', stage: 'facturation', status: 'Commande récupérée', nom: 'Client B', amount: 38, dest: ['facturation', 'commande_recuperee'] },
    { source: 'Demande de devis', stage: 'demande', status: 'À chiffrer', nom: 'Client C', amount: null, dest: ['demande_chiffrage', 'a_chiffrer'] },
    { source: 'Demande de devis', stage: 'demande', status: 'Demande à qualifier', nom: 'Client D', amount: null, dest: ['demande_chiffrage', 'demande_a_qualifier'] },
    { source: 'Vente directe', stage: 'preparation', status: 'Libellé qui n’existe pas', nom: 'Client E', amount: 60, dest: ['preparation', null] },
  ];

  const crees = [];
  for (const [i, c] of clients.entries()) {
    const r = await call('POST', '/api/comptoir/projet', {
      source: c.source,
      ref: `TRI-26.08.14-00${i + 1}`,
      clientObj: { type: 'Particulier', name: c.nom, phone: '0690000000' },
      name: `Commande de ${c.nom}`,
      stage: c.stage,
      status: c.status,
      amount: c.amount,
      recap: `Récapitulatif ${c.nom}`,
    });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    // 100 % DES DOSSIERS, sans exception : même une vente déjà encaissée passe
    // par le tri. C'est le prix de « rien n'entre au planning sans être vu ».
    assert.strictEqual(r.body.stage, 'a_trier', `${c.nom} doit attendre dans le sur-dossier`);
    assert.strictEqual(r.body.subStage, null, `${c.nom} n’est à aucune étape de travail`);
    assert.deepStrictEqual(r.body.destination, { stage: c.dest[0], subStage: c.dest[1] },
      `${c.nom} garde la famille désignée au comptoir`);
    crees.push({ ...c, id: r.body.id });
  }

  // Les cinq sont là, ensemble, dans le sur-dossier.
  const tri = await call('GET', '/api/requests?stage=a_trier');
  for (const c of crees) {
    const ligne = tri.body.find((r) => r.id === c.id);
    assert.ok(ligne, `${c.nom} doit être dans la liste du sur-dossier`);
    // Sans la destination dans la LISTE, plus de bouton « Ranger dans… » : la
    // fiche est allégée en SQL, cette clé doit expressément y survivre.
    assert.deepStrictEqual(ligne.fiche.destination, { stage: c.dest[0], subStage: c.dest[1] },
      `${c.nom} porte sa destination jusque dans la grille`);
    assert.strictEqual(ligne.sub_stage, null);
  }
  const compteurs = await call('GET', '/api/counts');
  assert.ok(compteurs.body.a_trier >= 5, 'le rail doit compter les dossiers en attente');

  // LE RANGEMENT — un déplacement, rien de plus : c'est ce que fait le bouton.
  for (const c of crees) {
    const r = await call('PATCH', `/api/requests/${c.id}`, { stage: c.dest[0], sub_stage: c.dest[1] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.stage, c.dest[0], `${c.nom} arrive dans sa famille`);
    assert.strictEqual(r.body.sub_stage, c.dest[1], `${c.nom} arrive à sa sous-étape`);
    // Rien ne s'est perdu au passage : le dossier est celui du comptoir.
    assert.strictEqual(r.body.billing_company, c.nom);
    if (c.amount != null) assert.strictEqual(Number(r.body.project_value), c.amount);
  }

  // Le sur-dossier est vide, et le planning a tout récupéré.
  const apres = await call('GET', '/api/requests?stage=a_trier');
  assert.strictEqual(apres.body.filter((r) => crees.some((c) => c.id === r.id)).length, 0,
    'une fois rangés, les dossiers ont quitté le sur-dossier');

  // Un dossier qui attend reste JOIGNABLE comme les autres : la recherche le
  // trouve, sinon on aurait juste déplacé le problème d'hier.
  const cherche = await call('GET', '/api/requests/recherche?q=TRI-26.08.14-003');
  assert.strictEqual(cherche.body.length, 1, 'le numéro du ticket retrouve le dossier');

  console.log('✓ à trier : tout arrive dans le sur-dossier, se range en un geste, et rien ne se perd');
  process.exit(0);
})();
