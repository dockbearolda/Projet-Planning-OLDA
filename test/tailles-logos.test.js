'use strict';

const { ecran } = require('./ecran-comptoir');

// LES TAILLES DES LOGOS (26/08/2026)
//
// La largeur du logo à imprimer, par famille, par référence, par FACE et par
// taille. Ce n'est pas une constante par référence : sur NS300 le dos va de
// 240 mm en XS à 320 mm en XL, et c'est ce qu'on ne retient pas de tête.
//
// Le tableau vivait sur un second site que le CRM recopiait — une copie qui
// pouvait dater, un bouton qu'il fallait avoir trouvé. Il a son écran ici,
// entre la Base clients et les Réglages.
//
// Ce que ce fichier tient, et qui casserait en silence :
//   1. UNE BASE NEUVE PORTE DÉJÀ LES LARGEURS. Une fonction qu'il faut aller
//      allumer est une fonction qui n'existe pas.
//   2. UNE FAMILLE PORTE SES PROPRES FACES. Un tote bag en a deux, une
//      casquette une seule (l'avant), un t-shirt six. Une liste unique donnait
//      à la casquette une colonne « Manche GA » — et une colonne qui n'a aucun
//      sens finit par être remplie.
//   3. LES FAMILLES SE CRÉENT DEPUIS L'ÉCRAN. Un objet nouveau arrive à
//      l'atelier : il lui faut sa catégorie le jour même.
//   4. UNE CASE À LA FOIS, ET SANS PERTE. Le document est lu puis réécrit, et
//      il y a un `await` au milieu.
//   5. UNE CASE VIDE N'EST PAS UN ZÉRO. 0 mm partirait en production sans que
//      rien ne proteste.
//   6. LA RECHERCHE SE FAIT SUR LA RÉFÉRENCE, pas sur la famille.
//   7. LE MESSAGE N'ACCUSE PAS LA RÉFÉRENCE tant qu'on n'a pas lu le tableau.
//   8. LE PRIX NE BOUGE PAS. Le moteur du fichier V9 ne connaît pas le logo.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const DEVIS = ecran('demande-devis');
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
  const fam = (t, nom) => (t.familles || []).find((f) => f.nom === nom);
  const cellule = (t, nom, ref, face, taille) => {
    const f = fam(t, nom);
    return f && ((((f.refs || {})[ref] || {})[face] || {})[taille]);
  };

  // --- 1. UNE BASE NEUVE PORTE DÉJÀ LES LARGEURS -----------------------------
  const neuve = await call('GET', '/api/tailles-logo');
  assert.strictEqual(neuve.status, 200);
  assert.ok(Array.isArray(neuve.body.familles), 'les familles sont une LISTE : elles ont un ordre, et il se range');
  assert.strictEqual(cellule(neuve.body, 'Homme', 'NS300', 'Dos', 'XL'), 320,
    'l’instantané livré avec le code est en base dès le premier démarrage');
  assert.strictEqual(cellule(neuve.body, 'Homme', 'NS300', 'Dos', 'XS'), 240,
    'la largeur dépend de la TAILLE du vêtement : 240 en XS, 320 en XL');
  // L'ancien site n'avait que « Avant » et « Dos », et son « Avant » (55 à
  // 80 mm) n'était PAS l'« Avant » du chiffrage (une pleine face, au même temps
  // que le dos). La reprise l'a rangé là où il est vrai : le logo de poitrine.
  assert.strictEqual(cellule(neuve.body, 'Homme', 'NS300', 'Coeur', 'S'), 60);
  assert.strictEqual(cellule(neuve.body, 'Homme', 'NS300', 'Poitrine', 'S'), 60);
  assert.strictEqual(cellule(neuve.body, 'Homme', 'NS300', 'Avant', 'S'), undefined,
    '« Avant » est une PLEINE FACE : rien ne l’a mesurée, la case reste vide');

  // --- 2. UNE FAMILLE PORTE SES PROPRES FACES ET SES PROPRES TAILLES --------
  assert.deepStrictEqual(fam(neuve.body, 'Homme').faces,
    ['Coeur', 'Poitrine', 'Avant', 'Dos', 'Manche DR', 'Manche GA'],
    'un vêtement a les six emplacements du chiffrage, mot pour mot');
  assert.strictEqual(fam(neuve.body, 'Tote Bag').faces.length, 2, 'un tote bag a DEUX faces');
  assert.deepStrictEqual(fam(neuve.body, 'Casquettes').faces, ['Avant'],
    'une casquette n’a qu’une face, l’avant — et « Avant » est un emplacement du chiffrage, donc le comptoir la remplira');
  assert.deepStrictEqual(fam(neuve.body, 'Homme').tailles, ['XS', 'S', 'M', 'L', 'XL', '2XL']);
  assert.ok(fam(neuve.body, 'Bébé').tailles.includes('3 mois'), 'chaque famille a ses tailles');
  assert.deepStrictEqual(fam(neuve.body, 'Casquettes').tailles, ['Taille unique'],
    'un objet n’a qu’une taille');

  // --- 3. LES FAMILLES SE CRÉENT, SE RÈGLENT, SE RETIRENT --------------------
  let t = (await call('POST', '/api/tailles-logo/familles', { nom: 'Mug' })).body;
  assert.ok(fam(t, 'Mug'), 'la famille est créée');
  assert.deepStrictEqual(fam(t, 'Mug').faces, ['Avant'], 'elle démarre avec une face');
  const doublon = await call('POST', '/api/tailles-logo/familles', { nom: 'Mug' });
  assert.strictEqual(doublon.status, 400, 'deux familles du même nom écriraient dans la même case');
  const sansNom = await call('POST', '/api/tailles-logo/familles', { nom: '   ' });
  assert.strictEqual(sansNom.status, 400);

  t = (await call('PATCH', '/api/tailles-logo/familles/Mug', { faces: ['Face 1', 'Face 2'], tailles: ['350 ml'] })).body;
  assert.deepStrictEqual(fam(t, 'Mug').faces, ['Face 1', 'Face 2']);
  // UNE FAMILLE GARDE AU MOINS UNE FACE ET UNE TAILLE : une liste vide serait
  // un effacement déguisé en réglage.
  for (const vide of [{ faces: [] }, { tailles: [] }]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await call('PATCH', '/api/tailles-logo/familles/Mug', vide);
    assert.strictEqual(r.status, 400, 'on ne vide pas une famille par un réglage');
  }

  await call('PATCH', '/api/tailles-logo', { famille: 'Mug', reference: 'MUG-1', face: 'Face 2', taille: '350 ml', largeur: 90 });
  t = (await call('GET', '/api/tailles-logo')).body;
  assert.strictEqual(cellule(t, 'Mug', 'MUG-1', 'Face 2', '350 ml'), 90);
  // RETIRER UNE FACE RETIRE SES MESURES : sans ça elles resteraient en base,
  // invisibles et indéboulonnables.
  t = (await call('PATCH', '/api/tailles-logo/familles/Mug', { faces: ['Face 1'] })).body;
  assert.strictEqual(cellule(t, 'Mug', 'MUG-1', 'Face 2', '350 ml'), undefined,
    'la mesure part avec sa colonne — c’est le sens de l’action');
  // Une face qui n'existe pas dans CETTE famille est refusée : sinon la mesure
  // se rangerait dans une colonne que l'écran n'affiche pas.
  const inconnue = await call('PATCH', '/api/tailles-logo', { famille: 'Mug', reference: 'MUG-1', face: 'Nombril', taille: '350 ml', largeur: 50 });
  assert.strictEqual(inconnue.status, 400);
  // UNE FAMILLE CRÉÉE À LA MAIN N'A AUCUN GENRE AU CATALOGUE : sans références
  // déclarées, elle s'ouvrirait vide et il n'y aurait rien à remplir.
  t = (await call('PATCH', '/api/tailles-logo/familles/Mug', { references: ['MUG-350', 'MUG-500'] })).body;
  assert.deepStrictEqual(fam(t, 'Mug').references, ['MUG-350', 'MUG-500'],
    'on déclare ses références à la main');
  assert.match(ECRAN, /f\.references \|\| \[\]/, 'et l’écran en fait des lignes');

  t = (await call('DELETE', '/api/tailles-logo/familles/Mug')).body;
  assert.ok(!fam(t, 'Mug'), 'la famille s’en va');

  // --- 4. UNE CASE À LA FOIS, ET SANS PERTE ---------------------------------
  const ecrit = await call('PATCH', '/api/tailles-logo',
    { famille: 'Homme', reference: 'NS300', face: 'Avant', taille: 'M', largeur: 300 });
  assert.strictEqual(cellule(ecrit.body, 'Homme', 'NS300', 'Avant', 'M'), 300);
  assert.strictEqual(cellule(ecrit.body, 'Homme', 'NS300', 'Dos', 'M'), 280, 'la case d’à côté n’a pas bougé');

  // DEUX POSTES EN MÊME TEMPS, sur trois cases différentes. Sans file d'attente,
  // une écriture est perdue — et on ne s'en aperçoit qu'en relisant le tableau
  // trois jours plus tard.
  await Promise.all([
    call('PATCH', '/api/tailles-logo', { famille: 'Homme', reference: 'K3025', face: 'Manche DR', taille: 'S', largeur: 90 }),
    call('PATCH', '/api/tailles-logo', { famille: 'Homme', reference: 'K3025', face: 'Manche GA', taille: 'S', largeur: 95 }),
    call('PATCH', '/api/tailles-logo', { famille: 'Femme', reference: 'NS313', face: 'Avant', taille: 'L', largeur: 305 }),
  ]);
  const apres = (await call('GET', '/api/tailles-logo')).body;
  assert.strictEqual(cellule(apres, 'Homme', 'K3025', 'Manche DR', 'S'), 90, 'écriture 1 gardée');
  assert.strictEqual(cellule(apres, 'Homme', 'K3025', 'Manche GA', 'S'), 95, 'écriture 2 gardée');
  assert.strictEqual(cellule(apres, 'Femme', 'NS313', 'Avant', 'L'), 305, 'écriture 3 gardée');

  // --- 5. UNE CASE VIDE N'EST PAS UN ZÉRO -----------------------------------
  const efface = await call('PATCH', '/api/tailles-logo',
    { famille: 'Homme', reference: 'NS300', face: 'Avant', taille: 'M', largeur: '' });
  assert.strictEqual(cellule(efface.body, 'Homme', 'NS300', 'Avant', 'M'), undefined,
    'vider une case la RETIRE — on n’y range pas un zéro');
  for (const mauvaise of [0, -5, 'abc']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await call('PATCH', '/api/tailles-logo',
      { famille: 'Homme', reference: 'NS332', face: 'Dos', taille: 'S', largeur: mauvaise });
    assert.strictEqual(cellule(r.body, 'Homme', 'NS332', 'Dos', 'S'), undefined,
      `une largeur « ${mauvaise} » n’est pas une mesure`);
  }

  if (app.__server) app.__server.close();

  // --- 6. LA RECHERCHE SE FAIT SUR LA RÉFÉRENCE ------------------------------
  // Passer par la famille rouvrait trois pièges : le catalogue range le body
  // K831 en « Enfant » quand l'atelier l'a mesuré en « Bébé », la vendeuse peut
  // corriger le genre à la main, et « Pochette » n'est pas « Pochettes ».
  const indexeur = DEVIS_JS.slice(DEVIS_JS.indexOf('function txLogoIndexer('));
  const corpsIndex = indexeur.slice(0, indexeur.indexOf('\n}'));
  assert.match(corpsIndex, /TX_LOGO_INDEX\[txLogoCle\(ref\)\]/, 'l’index est rangé sous la RÉFÉRENCE');
  assert.match(corpsIndex, /famille&&famille\.refs/, 'et il lit la LISTE des familles');
  const cherche = DEVIS_JS.slice(DEVIS_JS.indexOf('function txLogoEmplacementsDe('));
  assert.match(cherche.slice(0, cherche.indexOf('\n}')), /item&&item\.toptex/,
    'le nom TopTex est essayé aussi (K3025 / K3025IC)');
  // CHAQUE EMPLACEMENT MARQUÉ OUVRE SA RANGÉE. Filtrer sur une liste de
  // colonnes n'a plus de sens depuis que chaque famille porte les siennes — et
  // filtrer cacherait une rangée dont l'atelier a besoin.
  const places = DEVIS_JS.slice(DEVIS_JS.indexOf('function txPlacementsMarques('));
  assert.ok(!/colonnes/.test(places.slice(0, places.indexOf('\n}'))),
    'plus de filtre sur des colonnes valables pour tout le monde : il n’y en a plus');
  // UN OBJET N'A QU'UNE TAILLE : « Taille unique » répond pour toutes. Un
  // vêtement n'a jamais cette clé — le repli ne peut pas donner un S à un 2XL.
  {
    const f = DEVIS_JS.slice(DEVIS_JS.indexOf('function txLogoDuTableau('));
    const corps = f.slice(0, f.indexOf('\n}'));
    const iExacte = corps.indexOf('SIZE_LABELS[cleTaille]');
    const iUnique = corps.indexOf("txLogoCle('Taille unique')");
    assert.ok(iExacte > 0 && iUnique > iExacte, 'la taille EXACTE d’abord, « Taille unique » en repli');
  }

  // --- 7. PAS DE LIGNE D'AIDE SOUS LA GRILLE ---------------------------------
  // Elle disait « 2 largeurs reprises du tableau — modifiables ». Charlie l'a
  // retirée : sous des cases pleines elle ne dit rien qu'on ne voie déjà, et
  // sous des cases vides le vide se lit tout seul.
  assert.ok(!/txLogoAide/.test(DEVIS), 'plus de ligne d’aide sous la grille');
  // L'ÉTAT DE LA LECTURE RESTE, LUI : il n'affiche plus rien, mais c'est lui
  // qui fait reconstruire la grille quand le tableau arrive du serveur — sans
  // ça, une référence connue s'ouvrirait vide et n'aurait jamais ses largeurs.
  const rendu2 = DEVIS_JS.slice(DEVIS_JS.indexOf('function txRenderLogo('));
  assert.match(rendu2.slice(0, 900), /TX_LOGO_ETAT\]\.join\('\|'\)/,
    'l’arrivée du tableau change la signature, donc la grille se refait');

  // --- 7 bis. LE CHAMP, SES GARDES ET SON VOYAGE -----------------------------
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
    assert.match(bloc.slice(0, bloc.indexOf('\n}')), /txLogoOublier\(\)/, `changer ${quoi} rend la main au tableau`);
  }
  const rendu = DEVIS_JS.slice(DEVIS_JS.indexOf('function txRenderLogo('));
  assert.match(rendu.slice(0, 900), /if\(!force&&signature===txLogoSignature\)return/,
    'la grille ne se refait que si son contenu change');
  const ecouteur = DEVIS_JS.slice(DEVIS_JS.indexOf("hote.addEventListener('input'"));
  assert.ok(!/txRenderLogo/.test(ecouteur.slice(0, ecouteur.indexOf('});'))),
    'la correction ne reconstruit RIEN : elle reprendrait le champ sous les doigts');

  // --- 8. LE PRIX NE BOUGE PAS ----------------------------------------------
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

  // --- 9. L'ÉCRAN FERME LA RANGÉE, APRÈS LA BASE CLIENTS --------------------
  // Il était JUSTE AVANT Réglages jusqu'au 01/09, jour où Réglages a quitté la
  // rangée d'onglets pour rejoindre les commandes de l'appareil : « Tailles
  // logos » ferme donc la marche, et c'est toujours le dernier écran de
  // travail de la barre.
  const nav = INDEX.slice(INDEX.indexOf('class="nav-switch"'), INDEX.indexOf('</nav>'));
  const iLogos = nav.indexOf('id="viewTaillesLogos"');
  const iClients = nav.indexOf('id="viewClients"');
  assert.ok(iLogos > 0 && iClients > 0 && iClients < iLogos, 'l’onglet vient après la Base clients');
  assert.ok(!/id="view/.test(nav.slice(iLogos + 20)), '… et plus rien après lui : il ferme la rangée');
  assert.match(nav.slice(iLogos), /material-symbols-outlined"[^>]*>draw</,
    '« draw » est vérifié présent dans le sous-ensemble figé de la police');
  // VUE ET HASH DOIVENT RESTER ALIGNÉS : un hash absent de la table rend
  // l'onglet MORT (il retombe sur le planning sans rien dire).
  assert.match(APP, /'#tailles-logos': 'tailleslogos'/);
  assert.match(APP, /import\('\.\/tailles-logos\.js'\)/, 'le module est monté à la demande');

  // LES FAMILLES EN COLONNE, ce qu'elles contiennent à droite. En rangée de
  // pilules, familles et faces faisaient deux barres superposées et rien ne
  // disait laquelle commandait l'autre.
  assert.match(ECRAN, /el\('nav', 'tl-familles'\)/, 'les familles ont leur colonne');
  assert.match(ECRAN, /dataset\.action = 'famille-creer'/, 'et on en crée une d’ici');
  for (const action of ['famille-renommer', 'famille-retirer', 'face-creer', 'face-renommer', 'face-retirer']) {
    assert.ok(ECRAN.includes(action), `« ${action} » existe`);
  }
  // Charlie ne veut pas du paragraphe de description : l'écran dit ce qu'il est
  // par son titre et par ce qu'il montre.
  assert.ok(!/reg-head__sub/.test(ECRAN), 'pas de paragraphe de description sur cet écran');
  // Les lignes sont les références DU CATALOGUE : les taper à la main
  // laisserait passer une faute de frappe introuvable ensuite.
  assert.match(ECRAN, /textile-catalog\.js/, 'le catalogue fournit les lignes');
  // RENOMMER UNE FACE EMPORTE SES MESURES : sinon elles resteraient sur
  // l'ancien nom, invisibles et indéboulonnables.
  {
    const bloc = ECRAN.slice(ECRAN.indexOf("action === 'face-renommer'"));
    assert.match(bloc.slice(0, 900), /face === faceNom \? nom : face/,
      'renommer une face emporte ses largeurs');
  }
  assert.ok(!/rafraichir/.test(ECRAN) && !/taille-logo-app/.test(ECRAN),
    'plus rien ne va chercher l’ancien site');
  // (Le fichier lui-même est tenu par `test/ce-qui-ne-revient-pas.test.js`, avec
  // les huit autres retraits : ce sont tous des poids servis, pas des sujets.)
  assert.ok(!/tailles-logo/.test(REGLAGES), 'et les Réglages n’en gardent pas un morceau');

  // --- 10. LA SAISIE SE COMPORTE COMME UN TABLEUR ---------------------------
  // Ces largeurs se MESURENT : il faut les rentrer, et le tableau en compte des
  // centaines.
  {
    const clavier = ECRAN.slice(ECRAN.indexOf("addEventListener('keydown'"));
    const corps = clavier.slice(0, clavier.indexOf('});'));
    // LES FLÈCHES DÉPLACENT, ELLES N'INCRÉMENTENT PLUS : sur un champ
    // numérique, une flèche change la VALEUR — de quoi corriger une mesure sans
    // s'en apercevoir, en croyant descendre d'une ligne.
    assert.match(corps, /ArrowUp[\s\S]*preventDefault/, '« haut » ne touche pas à la valeur');
    assert.match(corps, /'ArrowDown' \|\| e\.key === 'Enter'/, '« bas » et « Entrée » descendent la colonne');
    assert.ok(!/ArrowLeft|ArrowRight/.test(corps), 'gauche et droite restent au curseur');
  }
  {
    const coller = ECRAN.slice(ECRAN.indexOf('async function collerBloc('));
    const corps = coller.slice(0, coller.indexOf('\n}'));
    assert.match(corps, /split\('\\t'\)/, 'un bloc de tableur se colle d’un coup');
    assert.match(corps, /if \(!val\) return;/, 'un blanc du bloc n’efface pas la case');
    assert.match(corps, /col >= colonnes/, 'un bloc plus large ne déborde pas sur la colonne d’à côté');
    assert.match(corps, /largeurs enregistrées/, 'le compte avance pendant le collage');
    assert.match(corps, /if \(etat\) return;/, 'un refus arrête le collage');
  }

  // --- 11. UN SEUL SÉLECTEUR SEGMENTÉ POUR TOUTE L'APPLICATION --------------
  assert.match(CHARTE, /^\.segmente \{/m, 'le composant est monté dans la charte partagée');
  assert.ok(!/\.cl-seg\b/.test(CLIENTS_CSS), 'la Base clients ne garde pas sa copie');
  assert.match(CLIENTS_JS, /'segmente'/, 'la Base clients émet le composant partagé');

  console.log('✓ tailles des logos : familles créables, faces par famille, saisie tableur, prix inchangé');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
