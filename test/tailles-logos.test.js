'use strict';

// LES TAILLES DES LOGOS (26/08/2026)
//
// La largeur du logo à imprimer, par référence, par EMPLACEMENT et par taille
// de vêtement. Ce n'est pas une constante par référence : sur NS300 le dos va
// de 240 mm en XS à 320 mm en XL, et c'est ce qu'on ne retient pas de tête.
//
// Le tableau vivait sur un second site que le CRM recopiait. Deux applications
// pour une même donnée : une copie qui pouvait dater, un bouton qu'il fallait
// avoir trouvé, et un essai en local où le comptoir accusait une référence
// d'être absente alors qu'elle y était. Il a son écran ici, entre la Base
// clients et les Réglages.
//
// Ce que ce fichier tient, et qui casserait en silence :
//   1. UNE BASE NEUVE PORTE DÉJÀ LES LARGEURS. Une fonction qu'il faut aller
//      allumer est une fonction qui n'existe pas.
//   2. UNE CASE À LA FOIS, ET SANS PERTE. Deux postes qui remplissent deux
//      colonnes ne doivent pas s'effacer — le document est lu puis réécrit, et
//      il y a un `await` au milieu.
//   3. UNE CASE VIDE N'EST PAS UN ZÉRO. 0 mm partirait en production sans que
//      rien ne proteste.
//   4. LA RECHERCHE SE FAIT SUR LA RÉFÉRENCE, pas sur la famille : le catalogue
//      range le body K831 en « Enfant », l'atelier l'a mesuré en « Bébé », et la
//      vendeuse peut corriger le genre à la main.
//   5. LE MESSAGE N'ACCUSE PAS LA RÉFÉRENCE tant qu'on n'a pas lu le tableau.
//   6. LE PRIX NE BOUGE PAS. Le moteur conforme au fichier V9 ne connaît pas le
//      logo et ne doit pas l'apprendre.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const DEVIS = lire('public/comptoir/demande-devis.html');
const ECRAN = lire('public/tailles-logos.js');
const APP = lire('public/app.js');
const INDEX = lire('public/index.html');
const CHARTE = lire('public/charte.css');
const CLIENTS_CSS = lire('public/clients.css');
const CLIENTS_JS = lire('public/clients.js');
const REGLAGES = lire('public/reglages.js');

// Les commentaires disent l'intention, pas ce que le code fait : on lit le CODE.
const sansCom = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const DEVIS_JS = sansCom(DEVIS);

// Le moteur s'écrit pour le navigateur : on lui pose un `window` et on le lit.
global.window = global.window || {};
require(path.join(RACINE, 'public/comptoir/textile-catalog.js'));
const TE = global.window.TextileEngine;

(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.APP_PASSWORD;
  process.env.PORT = '0';
  const app = require(path.join(RACINE, 'server.js'));
  const url = await new Promise((resolve) => {
    const check = () => {
      const s = app && app.__server;
      if (s && s.listening) resolve(`http://127.0.0.1:${s.address().port}`);
      else setTimeout(check, 25);
    };
    check();
  });
  const call = async (method, chemin, corps) => {
    const res = await fetch(url + chemin, {
      method,
      headers: corps !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const cellule = (t, famille, ref, emplacement, taille) => (
    ((((t.familles || {})[famille] || {})[ref] || {})[emplacement] || {})[taille]);

  // --- 1. UNE BASE NEUVE PORTE DÉJÀ LES LARGEURS -----------------------------
  const neuve = await call('GET', '/api/tailles-logo');
  assert.strictEqual(neuve.status, 200);
  assert.strictEqual(cellule(neuve.body, 'Homme', 'NS300', 'Dos', 'XL'), 320,
    'l’instantané livré avec le code est en base dès le premier démarrage');
  assert.strictEqual(cellule(neuve.body, 'Homme', 'NS300', 'Dos', 'XS'), 240,
    'la largeur dépend de la TAILLE du vêtement : 240 en XS, 320 en XL');
  // Les colonnes descendent AVEC le tableau : une liste recopiée des deux côtés
  // finit toujours par diverger.
  assert.deepStrictEqual(neuve.body.emplacements,
    ['Coeur', 'Poitrine', 'Avant', 'Dos', 'Manche DR', 'Manche GA'],
    'les colonnes sont les emplacements du chiffrage, mot pour mot');
  assert.deepStrictEqual(neuve.body.tailles.Homme, ['XS', 'S', 'M', 'L', 'XL', '2XL']);
  assert.ok(neuve.body.tailles['Bébé'].includes('3 mois'), 'chaque famille a ses tailles');

  // L'ancien site n'avait que « Avant » et « Dos », et son « Avant » (55 à
  // 80 mm) n'était PAS l'« Avant » du chiffrage (une pleine face, au même temps
  // que le dos). La reprise l'a rangé là où il est vrai : le logo de poitrine.
  assert.strictEqual(cellule(neuve.body, 'Homme', 'NS300', 'Coeur', 'S'), 60);
  assert.strictEqual(cellule(neuve.body, 'Homme', 'NS300', 'Poitrine', 'S'), 60);
  assert.strictEqual(cellule(neuve.body, 'Homme', 'NS300', 'Avant', 'S'), undefined,
    '« Avant » est une PLEINE FACE : rien ne l’a mesurée, la case reste vide');

  // --- 2. UNE CASE À LA FOIS -------------------------------------------------
  const ecrit = await call('PATCH', '/api/tailles-logo',
    { famille: 'Homme', reference: 'NS300', emplacement: 'Avant', taille: 'M', largeur: 300 });
  assert.strictEqual(ecrit.status, 200, JSON.stringify(ecrit.body));
  assert.strictEqual(cellule(ecrit.body, 'Homme', 'NS300', 'Avant', 'M'), 300);
  assert.strictEqual(cellule(ecrit.body, 'Homme', 'NS300', 'Dos', 'M'), 280,
    'la case d’à côté n’a pas bougé');

  // DEUX POSTES EN MÊME TEMPS, sur trois cases différentes. Le document est lu
  // puis réécrit : sans file d'attente, une écriture est perdue — et on ne s'en
  // aperçoit qu'en relisant le tableau trois jours plus tard.
  await Promise.all([
    call('PATCH', '/api/tailles-logo', { famille: 'Homme', reference: 'K3025', emplacement: 'Manche DR', taille: 'S', largeur: 90 }),
    call('PATCH', '/api/tailles-logo', { famille: 'Homme', reference: 'K3025', emplacement: 'Manche GA', taille: 'S', largeur: 95 }),
    call('PATCH', '/api/tailles-logo', { famille: 'Femme', reference: 'NS313', emplacement: 'Avant', taille: 'L', largeur: 305 }),
  ]);
  const apres = (await call('GET', '/api/tailles-logo')).body;
  assert.strictEqual(cellule(apres, 'Homme', 'K3025', 'Manche DR', 'S'), 90, 'écriture 1 gardée');
  assert.strictEqual(cellule(apres, 'Homme', 'K3025', 'Manche GA', 'S'), 95, 'écriture 2 gardée');
  assert.strictEqual(cellule(apres, 'Femme', 'NS313', 'Avant', 'L'), 305, 'écriture 3 gardée');

  // --- 3. UNE CASE VIDE N'EST PAS UN ZÉRO ------------------------------------
  const efface = await call('PATCH', '/api/tailles-logo',
    { famille: 'Homme', reference: 'NS300', emplacement: 'Avant', taille: 'M', largeur: '' });
  assert.strictEqual(cellule(efface.body, 'Homme', 'NS300', 'Avant', 'M'), undefined,
    'vider une case la RETIRE — on n’y range pas un zéro');
  for (const mauvaise of [0, -5, 'abc']) {
    const r = await call('PATCH', '/api/tailles-logo',
      { famille: 'Homme', reference: 'NS332', emplacement: 'Dos', taille: 'S', largeur: mauvaise });
    assert.strictEqual(cellule(r.body, 'Homme', 'NS332', 'Dos', 'S'), undefined,
      `une largeur « ${mauvaise} » n’est pas une mesure`);
  }
  const refus = await call('PATCH', '/api/tailles-logo',
    { famille: 'Homme', reference: 'NS300', emplacement: 'Nombril', taille: 'M', largeur: 50 });
  assert.strictEqual(refus.status, 400, 'un emplacement inconnu est refusé, pas rangé');

  if (app.__server) app.__server.close();

  // --- 4. LA RECHERCHE SE FAIT SUR LA RÉFÉRENCE ------------------------------
  // Passer par la famille rouvrait trois pièges : le catalogue range K831 en
  // « Enfant » quand l'atelier l'a mesuré en « Bébé », la vendeuse peut
  // corriger le genre à la main, et « Pochette » n'est pas « Pochettes ».
  const indexeur = DEVIS_JS.slice(DEVIS_JS.indexOf('function txLogoIndexer('));
  const corpsIndex = indexeur.slice(0, indexeur.indexOf('\n}'));
  assert.match(corpsIndex, /TX_LOGO_INDEX\[txLogoCle\(ref\)\]/, 'l’index est rangé sous la RÉFÉRENCE');
  assert.ok(!/txLogoCle\(famille\)/.test(corpsIndex),
    'la famille ne sert plus qu’à ranger le tableau dans l’écran de saisie');
  const cherche = DEVIS_JS.slice(DEVIS_JS.indexOf('function txLogoEmplacementsDe('));
  assert.match(cherche.slice(0, cherche.indexOf('\n}')), /item&&item\.toptex/,
    'le nom TopTex est essayé aussi (K3025 / K3025IC)');
  // LES DEUX FACES DE TOTE BAG N'OUVRENT PAS DE RANGÉE : leur taille est écrite
  // dans leur nom (« Face Classique 250 x 250 mm »).
  const places = DEVIS_JS.slice(DEVIS_JS.indexOf('function txPlacementsMarques('));
  assert.match(places.slice(0, places.indexOf('\n}')), /colonnes\.includes\(p\)/,
    'seuls les emplacements que le tableau mesure ouvrent une rangée');

  // --- 5. LE TABLEAU AVANT LA RÉFÉRENCE --------------------------------------
  const aideSrc = DEVIS_JS.slice(DEVIS_JS.indexOf('function txLogoAideMaj('));
  const corpsAide = aideSrc.slice(0, aideSrc.indexOf('\n}'));
  const posEtat = corpsAide.indexOf("TX_LOGO_ETAT==='vide'");
  const posAccuse = corpsAide.indexOf('n’est pas encore au tableau');
  assert.ok(posEtat > 0 && posAccuse > 0, 'les deux messages existent');
  assert.ok(posEtat < posAccuse,
    'l’état du TABLEAU se dit AVANT d’accuser la référence — sinon le message ment');
  for (const etat of ['attente', 'muet', 'vide']) {
    assert.ok(corpsAide.includes(`TX_LOGO_ETAT==='${etat}'`), `l’état « ${etat} » a son message`);
  }
  assert.match(DEVIS_JS, /let TX_LOGO_ETAT='attente'/);
  assert.match(DEVIS_JS, /TX_LOGO_ETAT=Object\.keys\(TX_LOGO_INDEX\)\.length\?'ok':'vide'/);
  assert.match(DEVIS_JS, /TX_LOGO_ETAT='muet'/);

  // --- 5 bis. LE CHAMP, SES GARDES ET SON VOYAGE -----------------------------
  assert.match(DEVIS, /id="txLogoWrap"/, 'le bloc existe dans le formulaire textile');
  assert.match(DEVIS_JS, /logo:txLogoLu\(\)/, 'la saisie porte la grille');
  assert.match(DEVIS_JS, /lignes\.push\(\['Taille du logo \(mm\)',logo,/,
    'le récapitulatif la montre, sous l’intitulé du champ lui-même');
  assert.match(DEVIS_JS, /Taille du logo \(mm\) : \$\{logo\}/,
    'le texte qui part à l’atelier et au planning la porte');
  assert.match(DEVIS_JS, /txLogoManuel\[placement\+'\|'\+cle\]=String\(v\)/,
    'rouvrir une ligne rend EXACTEMENT les largeurs annoncées au client');
  for (const [fn, quoi] of [['onTextileRefChange', 'de référence'], ['onTextileGenreChange', 'de genre']]) {
    const bloc = DEVIS_JS.slice(DEVIS_JS.indexOf(`function ${fn}(`));
    assert.match(bloc.slice(0, bloc.indexOf('\n}')), /txLogoOublier\(\)/,
      `changer ${quoi} rend la main au tableau`);
  }
  // LA GRILLE NE SE RECONSTRUIT PAS SOUS LES DOIGTS.
  const rendu = DEVIS_JS.slice(DEVIS_JS.indexOf('function txRenderLogo('));
  assert.match(rendu.slice(0, 900), /if\(!force&&signature===txLogoSignature\)return/,
    'la grille ne se refait que si son contenu change');
  const ecouteur = DEVIS_JS.slice(DEVIS_JS.indexOf("hote.addEventListener('input'"));
  assert.ok(!/txRenderLogo/.test(ecouteur.slice(0, ecouteur.indexOf('});'))),
    'la correction ne reconstruit RIEN : elle reprendrait le champ sous les doigts');

  // --- 6. LE PRIX NE BOUGE PAS ----------------------------------------------
  const saisie = {
    ref: 'K3025', isCustom: false, genre: 'Unisexe', transport: 'Maritime',
    printType: 'Coeur + Dos', sizes: { M: 20, L: 20, XL: 10 },
    discount: '', manualPrice: '', markupPercent: 0,
  };
  const sansLogo = TE.calculate(saisie);
  const avecLogo = TE.calculate({ ...saisie, logo: { Coeur: { M: 65 }, Dos: { M: 280 } } });
  assert.strictEqual(avecLogo.sold, sansLogo.sold,
    'LE CHIFFRAGE DU PATRON NE CONNAÎT PAS LE LOGO : le prix ne bouge pas d’un centime');
  assert.strictEqual(avecLogo.margin, sansLogo.margin);
  assert.ok(!/\blogo\b/i.test(sansCom(lire('public/comptoir/textile-catalog.js'))),
    'le moteur conforme au fichier V9 reste hors du sujet : rien n’y parle de logo');

  // --- 7. L'ÉCRAN, ENTRE LA BASE CLIENTS ET LES RÉGLAGES ---------------------
  const nav = INDEX.slice(INDEX.indexOf('class="nav-switch"'), INDEX.indexOf('</nav>'));
  const iLogos = nav.indexOf('id="viewTaillesLogos"');
  const iReglages = nav.indexOf('id="viewReglages"');
  assert.ok(iLogos > 0 && iReglages > 0 && iLogos < iReglages,
    'l’onglet est JUSTE AVANT Réglages');
  // « draw » est vérifié présent dans le sous-ensemble figé de la police : un
  // nom absent s'affiche en TEXTE, réduit à sa première lettre, sans erreur.
  assert.match(nav.slice(iLogos, iReglages), /material-symbols-outlined"[^>]*>draw</);
  assert.match(INDEX, /id="tailleslogos"/, 'la vue a sa racine');
  // VUE ET HASH DOIVENT RESTER ALIGNÉS : un hash absent de la table rend
  // l'onglet MORT (il retombe sur le planning sans rien dire).
  assert.match(APP, /'#tailles-logos': 'tailleslogos'/);
  assert.match(APP, /if \(tailleslogos\) mountTaillesLogos\(\);/);
  assert.match(APP, /if \(\$tailleslogos\) \$tailleslogos\.hidden = !tailleslogos;/);
  assert.match(APP, /import\('\.\/tailles-logos\.js'\)/, 'le module est monté à la demande');

  // Le tableau LUI-MÊME, pas un bouton vers un autre site.
  assert.match(ECRAN, /api\('PATCH', '\/api\/tailles-logo'/, 'il écrit case par case');
  assert.ok(!/rafraichir/.test(ECRAN) && !/taille-logo-app/.test(ECRAN),
    'plus rien ne va chercher l’ancien site');
  assert.ok(!fs.existsSync(path.join(RACINE, 'tailles-logo.js')),
    'le client vers l’ancien site n’a plus lieu d’être');
  assert.ok(!/tailles-logo/.test(REGLAGES), 'et les Réglages n’en gardent pas un morceau');
  // Les lignes sont les références DU CATALOGUE : les taper à la main laisserait
  // passer une faute de frappe qui rendrait la mesure introuvable au comptoir.
  assert.match(ECRAN, /textile-catalog\.js/, 'le catalogue fournit les lignes');
  assert.match(ECRAN, /TE\.genreSaisie\(r\.genre\) !== nom/);
  // L'enregistrement se fait à la PERTE DU FOCUS : à la frappe, « 260 »
  // commencerait par écrire 2, puis 26.
  assert.match(ECRAN, /addEventListener\('change'/);
  assert.ok(!/addEventListener\('input'/.test(ECRAN));

  // --- 8. UN SEUL SÉLECTEUR SEGMENTÉ POUR TOUTE L'APPLICATION ---------------
  // Deux écrans à un clic l'un de l'autre doivent donner le MÊME composant.
  assert.match(CHARTE, /^\.segmente \{/m, 'le composant est monté dans la charte partagée');
  assert.match(CHARTE, /^\.segmente__btn \{/m);
  assert.ok(!/\.cl-seg\b/.test(CLIENTS_CSS),
    'la Base clients ne garde pas sa copie : elle lirait deux règles pour un composant');
  assert.match(CLIENTS_JS, /'segmente'/, 'la Base clients émet le composant partagé');
  assert.match(ECRAN, /el\('div', 'segmente'\)/, 'l’écran des tailles aussi');

  console.log('✓ tailles des logos : semis, écriture case par case, recherche par référence, prix inchangé');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
