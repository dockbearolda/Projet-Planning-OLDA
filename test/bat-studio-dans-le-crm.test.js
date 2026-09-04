'use strict';

// ===========================================================================
// BAT STUDIO, DANS LE CRM (04/09/2026)
// ---------------------------------------------------------------------------
// Ce test tient les trois choses que l'intégration a changées, et dont aucune
// ne se voit en relisant un écran.
//
//   1. LE MAGASIN. BAT Studio écrivait sur un disque ; il écrit maintenant dans
//      `bat_fichiers`. Un magasin qui rend d'autres octets que ceux qu'on lui a
//      donnés ne se remarque pas : le PDF s'ouvre sur une page blanche, le logo
//      s'affiche gris, et c'est le client qui le dit.
//   2. LES ROUTES. `webapi.js` est le SEUL endroit du front qui parle au
//      serveur, et il n'a pas changé d'une ligne : ce sont donc les routes qui
//      doivent tomber en face, pas l'inverse.
//   3. LA CHARTE. L'intégration ne vaut que si les deux écrans se ressemblent
//      VRAIMENT. Un jeton redéclaré sous `.bat-app` couperait la cascade, et la
//      divergence n'apparaîtrait que le jour où Charlie change l'encre du CRM.
// ===========================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8');
// UN COMMENTAIRE N'APPLIQUE AUCUNE REGLE. Ce depot explique longuement ce qu'il
// retire — le nom de ce qui est parti reste donc ecrit partout, dans la prose
// qui dit POURQUOI il est parti. Chercher « Manrope » ou « data-theme » dans le
// texte brut trouverait ces explications et croirait la regle encore la.
const sansCommentaires = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

// --- 3. LA CHARTE : elle se lit sans serveur, on commence par là -----------

// Les jetons du CRM descendent dans `.bat-app` tout seuls. En redéclarer un
// COUPE la cascade à cet endroit précis — et rien ne le dit avant qu'on ouvre
// les deux écrans côte à côte.
const PHARE = lire('public/bat/css/phare.css');
const CHARTE = lire('public/charte.css');
const jetonsDe = (css) => {
  const m = new Map();
  for (const l of css.split('\n')) {
    const r = l.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (r && !m.has(r[1])) m.set(r[1], r[2].trim().replace(/\s+/g, ' ').toLowerCase());
  }
  return m;
};
// Le thème sombre du CRM commence à `:root[data-theme="dark"]` : on ne lit que
// ce qui est au-dessus, c'est la palette claire.
const crmClair = jetonsDe(CHARTE.split(':root[data-theme="dark"]')[0]);
const batJetons = jetonsDe(PHARE);

const redeclares = [...batJetons.keys()].filter((k) => crmClair.has(k));
assert.deepStrictEqual(redeclares, [],
  'BAT Studio redéclare un jeton que `charte.css` porte déjà : la cascade est coupée là, '
  + 'et le jour où le CRM change cette valeur, cet écran gardera l\'ancienne.\n  '
  + redeclares.join(' · '));

// Les quatre couleurs d'état que BAT nomme autrement sont des ALIAS, pas des
// copies : c'est ce qui les fait suivre le CRM dans les DEUX thèmes.
for (const [alias, source] of [
  ['--st-neutre', '--st-demande'], ['--st-ok', '--st-livree'],
  ['--st-fort', '--st-facture'], ['--st-eteint', '--st-archive'],
]) {
  assert.strictEqual(batJetons.get(alias), `var(${source})`,
    `${alias} doit renvoyer à ${source} du CRM, pas recopier sa valeur`);
}

// LA POLICE EST CELLE DU CRM. `--font` n'est plus déclaré ici (il descend), et
// aucune webfont d'INTERFACE ne part du serveur.
assert.ok(!batJetons.has('--font'),
  '`--font` ne se redéclare pas : la police de l\'interface est celle du CRM (native)');
assert.ok(!/Manrope/.test(sansCommentaires(lire('public/bat/css/app.css'))),
  'la police d\'interface de BAT Studio (Manrope) est partie avec son @font-face');
assert.ok(!fs.existsSync(path.join(RACINE, 'public/bat/assets/fonts/Manrope-latin.woff2')),
  '…et son fichier avec');

// LES POLICES DU DOCUMENT RESTENT. Elles habillent la feuille A4, et
// `batpdf.js` embarque les .ttf correspondants : les retirer ferait mentir
// l'aperçu sur ce qui sort de l'imprimante.
for (const f of ['Inter-Regular.ttf', 'Roboto-Regular.ttf', 'RobotoMono-Regular.ttf']) {
  assert.ok(fs.existsSync(path.join(RACINE, 'public/bat/assets/fonts', f)),
    `${f} est embarquée dans le PDF exporté : elle doit rester servie`);
}

// L'EN-TÊTE EST CELUI DU CRM, et il n'y en a qu'un. `#topbar` (62 px, avec sa
// marque « BAT Studio ») a laissé la place à `.ecran-tete`, le composant des
// huit autres écrans.
const MONTER = lire('public/bat/js/monter.js');
assert.ok(/ecranTete/.test(MONTER) && /\.\.\/\.\.\/ecran-tete\.js/.test(MONTER),
  'le montage demande l\'en-tête au CRM au lieu d\'en écrire un neuvième');
const monterNu = MONTER.replace(/\/\/[^\n]*/g, ' ');
assert.ok(!/id="topbar"/.test(monterNu) && !/class="brand"/.test(monterNu),
  'ni barre ni marque en propre : l\'onglet allumé dit déjà où l\'on est');

// LE THÈME EST CELUI DU CRM. `theme.js` posait `data-theme` SUR `.bat-app`,
// que le sélecteur `[data-theme="dark"] .bat-app` ne pouvait pas atteindre :
// embarqué, le thème sombre n'existait pas. Il n'y a plus qu'une commande, la
// lune du CRM, et plus qu'une palette.
assert.ok(!fs.existsSync(path.join(RACINE, 'public/bat/js/theme.js')),
  'theme.js est parti : le thème est celui de l\'hôte');
assert.ok(!/data-theme/.test(sansCommentaires(PHARE)),
  'phare.css ne porte plus de bloc sombre : celui de charte.css descend');

// PC UNIQUEMENT (21/08) : plus de bloc téléphone ni de safe-area.
const APPCSS = lire('public/bat/css/app.css');
assert.ok(!/max-width:\s*640px/.test(sansCommentaires(APPCSS)), 'le bloc téléphone est retiré');
assert.ok(!/safe-area-inset/.test(sansCommentaires(APPCSS)), 'les safe-areas sont retirées');
assert.ok(!/pointer:\s*coarse/.test(sansCommentaires(lire('public/bat/css/feuille/feuille.css'))),
  'le bloc tactile de la feuille est retiré');

// L'ÉCRAN NE DEMANDE QUE SIX CHOSES (04/09/2026).
// Charlie, mot pour mot : « si je clique sur BAT je veux que ça me demande nom,
// projet, référence, couleur, les faces, et les quantités, rien d'autre. »
// Deux écrans, pas quatre : la FEUILLE, et PRODUITS pour ajouter une référence
// qu'on n'a pas. Sont partis la liste des projets et les réglages du BAT.
{
  const MONTER_NU = MONTER.replace(/\/\/[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const ecrans = [...MONTER_NU.matchAll(/data-screen="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(ecrans, ['bat', 'produits'],
    'deux onglets, dans cet ordre : la feuille, puis les produits');
  const sections = [...MONTER_NU.matchAll(/id="screen-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(sections, ['bat', 'produits'],
    '…et deux sections, pas une de plus : une section sans onglet est un écran inatteignable');
  // Le bouton est construit en JS, pas dans une chaine de balisage : on cherche
  // son identifiant, pas un attribut HTML.
  assert.ok(/'bat-neuf'/.test(MONTER) && /'Nouveau'/.test(MONTER),
    '« Nouveau » est dans l\'en-tête : sans lui l\'écran serait à un coup, le BAT sorti '
    + 'et l\'onglet rouvrant le même, rempli');

  // LES SIX CHAMPS, ET DANS CET ORDRE. Client et Projet sont posés par
  // `renderFiche`, les trois suivants par l'ossature de la feuille, et les
  // quantités ferment la rangée.
  const PAGE = lire('public/bat/js/batpage.js');
  for (const champ of ['Client', 'Projet', 'Vêtement', 'Couleur', 'Faces', 'Quantités']) {
    assert.ok(PAGE.includes(champ), `la feuille demande « ${champ} »`);
  }
  assert.ok(!/id="bat-history"/.test(PAGE),
    'l\'historique est parti : le PDF est la seule action terminale');
  assert.ok(/id="bat-export"/.test(PAGE), '…mais l\'export du PDF reste');

  // LE CODE DES DEUX ÉCRANS RETIRÉS EST PARTI AVEC EUX. Un écran qu'on ne peut
  // plus atteindre dont le code reste, c'est le code qu'on rallume par erreur
  // six mois plus tard.
  const PROJETS = lire('public/bat/js/projects.js');
  const REGLAGES = lire('public/bat/js/reglages.js');
  assert.ok(!/export async function renderProjects/.test(PROJETS), 'renderProjects est retirée');
  assert.ok(!/export async function renderReglages/.test(REGLAGES), 'renderReglages est retirée');
  assert.ok(/export async function startNewProject/.test(PROJETS),
    '…mais ce qui OUVRE un BAT reste : « Nouveau » en dépend');
  assert.ok(/export async function ouvrirPourFiche/.test(PROJETS),
    '…et l\'ouverture depuis une fiche du CRM aussi');
  assert.ok(/export async function calibrationModal/.test(REGLAGES),
    '…et la calibration, que l\'écran Produits appelle');
}

// L'ONGLET EST DANS LA BARRE, ENTRE LES ÉCRANS QUI PRODUISENT UN DOCUMENT.
const INDEX = lire('public/index.html');
const nav = INDEX.slice(INDEX.indexOf('class="nav-switch"'), INDEX.indexOf('</nav>'));
const iBat = nav.indexOf('id="viewBat"');
assert.ok(iBat > 0, 'l\'onglet BAT est dans la rangée');
assert.ok(nav.indexOf('id="viewVenteFlash"') < iBat && iBat < nav.indexOf('id="viewPlanning"'),
  'il suit les deux autres écrans qui produisent un document (devis, facture)');
assert.ok(nav.indexOf('id="viewTaillesLogos"') > iBat,
  '…et « Tailles logos » ferme toujours la rangée');
assert.match(nav.slice(iBat), /<span class="nav-switch-label">BAT</,
  'l\'onglet porte un MOT, comme les dix autres — pas un glyphe');

// LE HASH MÈNE À L'ÉCRAN, et l'écran se monte paresseusement : 5,4 Mo de
// bibliothèques ne doivent pas partir à l'ouverture d'un poste.
const APPJS = lire('public/app.js');
assert.ok(/'#bat':\s*'bat'/.test(APPJS), 'le hash #bat mène à la vue bat');
assert.ok(/import\('\.\/bat\/js\/monter\.js'\)/.test(APPJS),
  'le module n\'est demandé qu\'au premier affichage de l\'onglet');

(async () => {
  // LE SERVEUR D'ABORD, ET IL N'Y EN A QU'UN. `init()` ne se rejoue pas sur
  // pg-mem : son `CREATE TABLE IF NOT EXISTS` echoue au second passage (c'est
  // ecrit dans les exports de db.js). Demarrer le serveur l'appelle deja — un
  // `db.init()` de plus ici casserait le schema avant la premiere assertion.
  // Le magasin s'utilise ensuite : meme processus, donc meme base.
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
  const db = require('../db');

  // --- 1. LE MAGASIN ------------------------------------------------------

  // LE PIÈGE QUI A DÉCIDÉ DE LA COLONNE. `bytea` semble le type naturel — et
  // pg-mem, la base locale sur laquelle le patron valide, le fait transiter par
  // une chaîne UTF-8 : un octet 0xFF en revient en EF BF BD. Mesuré. Un PDF y
  // perd ses octets hauts en silence. D'où le base64, comme `attachments`.
  const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0x00, 0x41, 0xfe, 0x80]);
  await db.batEcrire('bat/abc/preuve.pdf', pdf);
  const relu = await db.batLire('bat/abc/preuve.pdf');
  assert.strictEqual(Buffer.compare(relu.octets, pdf), 0,
    'les octets ressortent EXACTEMENT comme ils sont entrés, 0xFF compris');

  // Un chemin qui sort du magasin ne doit jamais atteindre la base : sur disque
  // il sortait du répertoire de données, ici il lirait la clé d'un autre.
  for (const mauvais of ['../secret', '/etc/passwd', 'a/../../b', '', 'a//b', '.']) {
    await assert.rejects(() => db.batLire(mauvais), /refusé/,
      `chemin refusé : ${JSON.stringify(mauvais)}`);
  }

  // Effacer un projet emportait son dossier de logos (`rm -r`). Sans le
  // sous-arbre, ils resteraient en base pour toujours — invisibles, et comptés
  // dans le ménage.
  await db.batEcrire('logos/p1/a.png', Buffer.from([1]));
  await db.batEcrire('logos/p1/b.png', Buffer.from([2]));
  await db.batEcrire('logos/p2/c.png', Buffer.from([3]));
  assert.strictEqual(await db.batSupprimer('logos/p1'), 2, 'le sous-arbre part entier');
  assert.deepStrictEqual(await db.batLister('logos'), [{ name: 'p2', dir: true }],
    '…et rien d\'autre');

  // La taille est RANGÉE à l'écriture (pg-mem n'a pas `length`), et elle suit
  // une réécriture — sinon le ménage compterait le poids d'avant.
  await db.batEcrire('mockups-custom/t/x.webp', Buffer.alloc(2048, 7));
  await db.batEcrire('mockups-custom/t/x.webp', Buffer.alloc(10, 7));
  assert.deepStrictEqual(await db.batTailles('mockups-custom'),
    [{ chemin: 't/x.webp', octets: 10 }], 'la taille suit le contenu');

  // --- 2. LES ROUTES ------------------------------------------------------
  // `js/base.js` DÉDUIT sa racine de sa propre URL : servi sous `/bat/js/`, il
  // préfixe tout par `/bat`. Les routes doivent tomber là, et nulle part
  // ailleurs — le CRM sert déjà `/api/requests`.
  const info = await (await fetch(`${base}/bat/api/info`)).json();
  assert.strictEqual(info.appDir, '@app', 'l\'app se sait servie sous son préfixe');
  assert.strictEqual(info.donneesEphemeres, false,
    'les données sont en base : plus rien d\'éphémère à annoncer');
  assert.strictEqual((await fetch(`${base}/api/info`)).status, 404,
    'la racine reste au CRM : BAT ne pose aucune route hors de /bat');

  // L'écriture conditionnelle : deux postes sur le même projet. Sans elle, le
  // dernier arrivé gagnait EN SILENCE et le travail de l'autre disparaissait.
  const chemin = `${base}/bat/api/data/projects/essai.json`;
  const v1 = JSON.stringify({ updatedAt: '2026-09-04T10:00:00Z', n: 1 });
  assert.strictEqual((await fetch(chemin, { method: 'PUT', body: v1 })).status, 200);
  const conflit = await fetch(chemin, {
    method: 'PUT', body: JSON.stringify({ updatedAt: 'x', n: 2 }),
    headers: { 'X-Bat-Base': '1999-01-01T00:00:00Z' },
  });
  assert.strictEqual(conflit.status, 409, 'un poste en retard est refusé, pas silencieusement écrasé');
  assert.strictEqual((await conflit.json()).n, 1,
    'et la version du serveur voyage AVEC le refus : on peut poser la question');

  // Sans l'en-tête, le comportement d'avant : le dernier écrit gagne.
  const v3 = JSON.stringify({ updatedAt: '2026-09-04T11:00:00Z', n: 3 });
  assert.strictEqual((await fetch(chemin, { method: 'PUT', body: v3 })).status, 200);
  assert.strictEqual((await (await fetch(chemin)).json()).n, 3);

  assert.deepStrictEqual(await (await fetch(`${base}/bat/api/list/projects`)).json(),
    [{ name: 'essai.json', dir: false }]);
  assert.strictEqual((await fetch(chemin, { method: 'DELETE' })).status, 200);
  assert.strictEqual((await fetch(chemin)).status, 404);

  // LE CATALOGUE SORT DU MÊME MAGASIN. C'est de la donnée de référence, pas du
  // code : elle n'a rien à faire dans le dépôt.
  await db.batEcrire('catalogue/mockups/T/rouge.webp', Buffer.from([0x52, 0x49, 0x46, 0x46]));
  const cat = await fetch(`${base}/bat/catalogue/mockups/T/rouge.webp`);
  assert.strictEqual(cat.status, 200);
  assert.strictEqual(cat.headers.get('content-type'), 'image/webp');

  // --- LE DÉPÔT DU BAT SUR LA FICHE ---------------------------------------
  // Il partait en HTTP vers le CRM, avec un mot de passe à tenir dans une
  // variable d'environnement. Même processus : c'est un appel de fonction, et
  // c'est la MÊME règle que la route du CRM — versionnage, armement du verrou
  // de production, temps réel. Écrite une fois.
  const dossier = await (await fetch(`${base}/api/comptoir/projet`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'Vente directe', ref: `BAT-${Math.random().toString(36).slice(2, 8)}`,
      clientObj: { type: 'Professionnel', company: 'ATELIER ESSAI' },
      name: 'Dossier pour le BAT', stage: 'Préparation du projet',
      amount: 100, quantity: 2, comment: '', recap: '',
    }),
  })).json();
  assert.ok(dossier.id, 'un dossier pour y accrocher le BAT');

  const bat = Buffer.from('%PDF-1.4 bon a tirer', 'utf8');
  const depot = await fetch(`${base}/bat/api/crm/bat/${dossier.id}?name=BAT-essai.pdf`, {
    method: 'PUT', body: bat,
  });
  assert.strictEqual(depot.status, 200, 'le BAT se dépose sans quitter le processus');
  assert.strictEqual((await depot.json()).filename, 'BAT-essai.pdf');

  const fiche = await (await fetch(`${base}/api/requests/${dossier.id}`)).json();
  assert.strictEqual(fiche.bat_name, 'BAT-essai.pdf', 'il arrive bien sur LA fiche visée');
  assert.strictEqual(fiche.bat_requis, true,
    'DÉPOSER UN BAT, C\'EST EN AVOIR UN : le verrou de production s\'arme tout seul');

  // L'identifiant décide DANS QUELLE FICHE le BAT tombe : on ne devine jamais
  // ce qu'un identifiant douteux voulait dire.
  for (const mauvais of ['../autre', 'a/b', '']) {
    const r = await fetch(`${base}/bat/api/crm/bat/${encodeURIComponent(mauvais)}`, {
      method: 'PUT', body: bat,
    });
    assert.ok(r.status === 400 || r.status === 404,
      `identifiant refusé : ${JSON.stringify(mauvais)} (reçu ${r.status})`);
  }

  // --- LES TAILLES VIENNENT DU CRM, ET LA FACE S'APPARIE PAR SON NOM -------
  // Elles venaient d'une application à part (« Tailles Logo DTF ») qui n'existe
  // plus — Railway répond « Application not found ». Le CRM porte la même
  // table, et il la porte avec SES faces : Coeur, Poitrine, Avant, Dos…
  await fetch(`${base}/api/tailles-logo/familles`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom: 'Essai BAT', tailles: ['XS', 'XL'], faces: ['Coeur', 'Dos'] }),
  });
  for (const [face, taille, mm] of [['Coeur', 'XS', 60], ['Coeur', 'XL', 70], ['Dos', 'XS', 240], ['Dos', 'XL', 320]]) {
    const r = await fetch(`${base}/api/tailles-logo`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ famille: 'Essai BAT', reference: 'ZZ-ESSAI', face, taille, largeur: mm }),
    });
    assert.strictEqual(r.status, 200, `la mesure ${face}/${taille} doit s'enregistrer`);
  }

  const grille = await (await fetch(`${base}/bat/api/tailles`)).json();
  assert.strictEqual(grille.source, 'crm', 'la grille vient du CRM, plus du réseau');
  assert.deepStrictEqual(grille.categories['ESSAI BAT'].sizes, ['XS', 'XL'],
    'le rayon porte ses tailles — c\'est la série à laquelle un produit incomplet se complète');
  const ns300 = grille.products.find((x) => x.reference === 'ZZ-ESSAI');
  assert.ok(ns300, 'la référence mesurée devient un produit de la grille');
  assert.strictEqual(ns300.category, 'ESSAI BAT');
  assert.deepStrictEqual(ns300.sizes, [
    { label: 'XS', faces: { Coeur: 60, Dos: 240 } },
    { label: 'XL', faces: { Coeur: 70, Dos: 320 } },
  ], 'chaque taille porte la largeur de CHAQUE face, en millimètres');

  // LE CŒUR N'EST PAS LE DOS, et c'est tout l'enjeu du changement : l'ancienne
  // grille n'avait que « devant » et « dos », donc les deux marquages de devant
  // recevaient la même cote. Ici 6 cm contre 24 — une réimpression d'écart.
  const { findPrintWidthCm } = await import(
    'data:text/javascript;base64,' + Buffer.from(
      fs.readFileSync(path.join(RACINE, 'public/bat/js/tailles.js'), 'utf8')
        // Le module tire deux voisins dont on n'a pas besoin ici : on ne teste
        // que l'appariement, pas le chargement.
        .replace(/^import .*$/gm, '')
        .replace(/\buid\(\)/g, "'x'")
        .replace(/guessSizeCategory\(/g, '(() => null)('),
      'utf8').toString('base64'));
  const produit = { refInternal: '', refSupplier: 'ZZ-ESSAI' };
  assert.strictEqual(findPrintWidthCm(grille, produit, 'Dos', 'XL'), 32, 'Dos en XL : 32 cm');
  assert.strictEqual(findPrintWidthCm(grille, produit, 'Coeur', 'XL'), 7, 'Cœur en XL : 7 cm');
  assert.strictEqual(findPrintWidthCm(grille, produit, 'coeur', 'XL'), 7, 'la casse ne compte pas');
  assert.strictEqual(findPrintWidthCm(grille, produit, 'Placement libre', 'XL'), null,
    'une zone que le tableau ne mesure pas rend null — le BAT retombe sur la largeur du logo posé');
  assert.strictEqual(findPrintWidthCm(grille, produit, 'Dos', 'M'), null,
    'une taille non mesurée aussi');

  // LES CINQ RAYONS QUE LE BAT DEVINE gardent leur code. Il les ecrit au
  // SINGULIER (`guessSizeCategory`) quand la famille du CRM est au pluriel :
  // sans la table de correspondance, une pochette ne retrouvait jamais ses
  // tailles par le nom de son produit.
  for (const code of ['HOMME', 'FEMME', 'ENFANT', 'BEBE', 'POCHETTE']) {
    assert.ok(grille.categories[code], `le rayon ${code} existe sous le nom que le BAT emploie`);
  }

  // LE CATALOGUE DE MOCKUPS SORT DU MAGASIN, sous son préfixe.
  const vignette = await fetch(`${base}/bat/catalogue/mockups/T/rouge.webp`);
  assert.strictEqual(vignette.status, 200, 'une image du catalogue se sert comme le reste');

  // Le CRM est là — il sert la page. Plus rien à configurer.
  assert.deepStrictEqual(await (await fetch(`${base}/bat/api/crm`)).json(), { actif: true });

  console.log('✓ BAT Studio dans le CRM : magasin en base (octets intacts, sous-arbre, conflit 409), '
    + 'routes sous /bat, dépôt direct sur la fiche, tailles du CRM appariées par nom de face, '
    + 'et une seule charte');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
