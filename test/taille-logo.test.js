'use strict';

// LA TAILLE DU LOGO, REPRISE DU TABLEAU DE L'ATELIER (26/08/2026).
//
// L'atelier tient un second site — « Tailles Logo DTF » — où chaque référence
// porte, POUR CHAQUE TAILLE DE VÊTEMENT, la largeur du logo à imprimer. La
// vendeuse choisissait sa référence au comptoir et allait lire là-bas ; quand
// elle y pensait. Le comptoir la propose maintenant tout seul.
//
// Ce que ce fichier tient, et qui casserait en silence :
//   1. LA LECTURE DU SITE — une case vide n'est pas un zéro, un produit sans
//      référence ne descend pas, un doublon ne doit pas effacer une mesure.
//   2. LE SITE INJOIGNABLE — le tableau déjà enregistré ne bouge pas. C'est le
//      moment exact où la vendeuse en a besoin.
//   3. LE RAPPROCHEMENT — Coeur et Poitrine sur « avant », Dos sur « dos », et
//      SURTOUT PAS « Avant » : le mot est le même des deux côtés, la taille
//      non (55-80 mm dans le tableau, une pleine face côté chiffrage).
//   4. LA CORRECTION À LA MAIN — elle tient, elle ne reprend pas le champ sous
//      les doigts, et elle revient à l'identique quand on rouvre la ligne.
//   5. LE PRIX NE BOUGE PAS. Le chiffrage du patron ne connaît pas le logo et
//      ne doit pas le connaître.
//
// AUCUN APPEL SORTANT : le test sert son propre faux site.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const RACINE = path.join(__dirname, '..');
const DEVIS = fs.readFileSync(path.join(RACINE, 'public/comptoir/demande-devis.html'), 'utf8');
const REGLAGES = fs.readFileSync(path.join(RACINE, 'public/reglages.js'), 'utf8');

// Les commentaires disent l'intention, pas ce que le code fait : on lit le CODE.
const sansCom = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const DEVIS_JS = sansCom(DEVIS);

// --- Le faux site ------------------------------------------------------------
// Mêmes formes que « Tailles Logo DTF », avec exprès tout ce qui peut piéger :
// une case vide, un produit sans référence, un doublon partiel, une largeur
// nulle.
const CATEGORIES = [
  { id: 1, code: 'HOMME', label: 'Homme', ordre: 1 },
  { id: 2, code: 'BEBE', label: 'Bébé', ordre: 2 },
];
const GRILLES = {
  HOMME: {
    category: { id: 1, code: 'HOMME', label: 'Homme' },
    sizes: [{ id: 1, label: 'S', ordre: 0 }, { id: 2, label: 'M', ordre: 1 }],
    products: [
      {
        id: 1, code: 'H-001', reference: 'NS300', ordre: 0,
        measurements: {
          1: { devant: 60, dos: 260 },
          2: { devant: null, dos: 280 },      // le devant n'est pas encore mesuré
        },
      },
      {
        id: 2, code: 'H-002', reference: null, ordre: 1,   // rien à rapprocher
        measurements: { 1: { devant: 99, dos: 999 } },
      },
      {
        id: 3, code: 'H-003', reference: 'NS300', ordre: 2, // doublon de saisie
        measurements: { 1: { devant: null, dos: null }, 2: { devant: 65, dos: null } },
      },
      {
        id: 4, code: 'H-004', reference: 'K3025', ordre: 3,
        measurements: { 1: { devant: 0, dos: -5 } },        // 0 mm n'est pas une mesure
      },
    ],
  },
  BEBE: {
    category: { id: 2, code: 'BEBE', label: 'Bébé' },
    sizes: [{ id: 9, label: '3 mois', ordre: 0 }],
    products: [{ id: 5, code: 'B-001', reference: 'K831', ordre: 0, measurements: { 9: { devant: 110, dos: 110 } } }],
  },
};

// Le site peut aussi répondre 200 SANS AUCUNE LARGEUR — c'est ce qu'il fait le
// temps de se réveiller, et c'est le cas qui écraserait tout en silence.
let siteVide = false;

function fauxSite() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const m = req.url.match(/^\/api\/categories\/([A-Z]+)\/grid$/);
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/categories') return res.end(JSON.stringify(siteVide ? [] : CATEGORIES));
      if (m && GRILLES[m[1]]) {
        const g = GRILLES[m[1]];
        return res.end(JSON.stringify(siteVide ? { ...g, products: [] } : g));
      }
      res.statusCode = 404;
      res.end('{}');
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

// --- 6. Le moteur du patron ne connaît pas le logo ---------------------------
global.window = global.window || {};
require(path.join(RACINE, 'public/comptoir/textile-catalog.js'));
const TE = global.window.TextileEngine;

(async () => {
  const site = await fauxSite();
  const base = `http://127.0.0.1:${site.address().port}`;
  process.env.TAILLE_LOGO_URL = base;

  // --- 1. LA LECTURE DU SITE -------------------------------------------------
  const { lireTaillesLogo } = require(path.join(RACINE, 'tailles-logo.js'));
  const lu = await lireTaillesLogo();

  assert.deepStrictEqual(Object.keys(lu.familles).sort(), ['Bébé', 'Homme'],
    'les familles gardent le LIBELLÉ du site — ce sont les genres de saisie du comptoir');
  assert.strictEqual(lu.familles.Homme.NS300.S.avant, 60);
  assert.strictEqual(lu.familles.Homme.NS300.S.dos, 260);
  assert.strictEqual(lu.familles.Homme.NS300.M.dos, 280);
  // Le doublon complète, il n'écrase pas : la case M/dos vient de la première
  // ligne, la case M/avant de la seconde.
  assert.strictEqual(lu.familles.Homme.NS300.M.avant, 65,
    'un doublon partiel doit COMPLÉTER la mesure, pas la remplacer');
  assert.ok(!lu.familles.Homme.K3025,
    'une largeur de 0 ou négative n’est pas une mesure : elle ne descend pas');
  assert.ok(!JSON.stringify(lu.familles).includes('999'),
    'un produit SANS référence ne peut pas être rapproché du catalogue : il ne descend pas');
  assert.strictEqual(lu.familles['Bébé']['K831']['3 mois'].avant, 110);

  // --- 2. LES DEUX ROUTES ----------------------------------------------------
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
  const call = async (method, chemin) => {
    const res = await fetch(url + chemin, { method });
    return { status: res.status, body: await res.json() };
  };

  // UNE BASE NEUVE PORTE DÉJÀ LES LARGEURS. C'est le défaut du 26/08 : sur une
  // base fraîche, le comptoir montrait des cases vides et accusait la référence
  // de ne pas être au tableau — il fallait avoir trouvé un bouton dans les
  // Réglages pour que la fonction existe.
  const neuve = await call('GET', '/api/tailles-logo');
  assert.strictEqual(neuve.status, 200);
  const semees = Object.keys(neuve.body.familles || {});
  assert.ok(semees.length, 'l’instantané livré avec le code est en base dès le premier démarrage');
  assert.ok(neuve.body.familles.Homme && neuve.body.familles.Homme.NS300,
    'et il porte les références du catalogue');
  // `maj` reste NULL : ces largeurs viennent du FICHIER, pas d'une lecture du
  // site. C'est ce que l'écran des Réglages annonce, et c'est vrai.
  assert.strictEqual(neuve.body.maj, null,
    'aucun appel sortant au démarrage : le semis n’est pas une mise à jour');

  const maj = await call('POST', '/api/tailles-logo/rafraichir');
  assert.strictEqual(maj.status, 200, JSON.stringify(maj.body));
  assert.strictEqual(maj.body.refs, 2, 'NS300 et K831 — pas le produit sans référence, pas le 0 mm');
  assert.ok(maj.body.maj, 'la date de mise à jour est posée');

  const relu = await call('GET', '/api/tailles-logo');
  assert.strictEqual(relu.body.familles.Homme.NS300.S.dos, 260,
    'le comptoir lit la COPIE : il ne parle jamais au second site');
  assert.ok(relu.body.maj, 'un relevé du site fait foi sur l’instantané, et il est daté');

  // --- 3. LE SITE INJOIGNABLE NE VIDE RIEN -----------------------------------
  process.env.TAILLE_LOGO_URL = 'http://127.0.0.1:9';   // discard : refus immédiat
  const echec = await call('POST', '/api/tailles-logo/rafraichir');
  assert.strictEqual(echec.status, 502);
  assert.match(echec.body.error, /restent en place/,
    'le message doit dire que rien n’a été perdu — sinon on croit avoir tout effacé');
  const apresEchec = await call('GET', '/api/tailles-logo');
  assert.strictEqual(apresEchec.body.familles.Homme.NS300.S.dos, 260,
    'UN SITE MUET NE DOIT RIEN EFFACER : c’est le moment où le comptoir en a besoin');
  process.env.TAILLE_LOGO_URL = base;

  // --- 3 bis. UN SITE QUI RÉPOND « RIEN » N'ÉCRASE RIEN ----------------------
  // Plus vicieux que le site muet : il répond 200, tout va bien, et le tableau
  // se viderait sans un mot.
  siteVide = true;
  const rienDuTout = await call('POST', '/api/tailles-logo/rafraichir');
  assert.strictEqual(rienDuTout.status, 502, 'un relevé sans aucune largeur est un échec, pas une mise à jour');
  const apresRien = await call('GET', '/api/tailles-logo');
  assert.strictEqual(apresRien.body.familles.Homme.NS300.S.dos, 260,
    'le tableau en place ne bouge pas');
  siteVide = false;

  site.close();
  if (app.__server) app.__server.close();

  // --- 4. LE RAPPROCHEMENT ---------------------------------------------------
  const colonnes = DEVIS_JS.match(/const TX_LOGO_COLONNE=\{([^}]*)\}/);
  assert.ok(colonnes, 'la table de rapprochement doit exister et être lisible d’un seul endroit');
  assert.match(colonnes[1], /'Coeur':'avant'/);
  assert.match(colonnes[1], /'Poitrine':'avant'/);
  assert.match(colonnes[1], /'Dos':'dos'/);
  // LE PIÈGE : le tableau appelle sa colonne « Avant » et le chiffrage appelle
  // « Avant » une impression PLEINE FACE. 55-80 mm d'un côté, une pleine face
  // de l'autre. Remplir d'office coûterait une réimpression.
  assert.ok(!/'Avant'\s*:/.test(colonnes[1]),
    '« Avant » côté chiffrage est une pleine face : le tableau ne le mesure pas, on ne remplit rien');
  for (const manche of ['Manche DR', 'Manche GA']) {
    assert.ok(!colonnes[1].includes(manche), `${manche} n’est pas mesuré par le tableau`);
  }

  // --- 5. LE CHAMP, SES GARDES ET SON VOYAGE ---------------------------------
  assert.match(DEVIS, /id="txLogoWrap"/, 'le bloc existe dans le formulaire textile');
  assert.match(DEVIS, /id="txLogo"[^>]*>/, 'la grille a son hôte');
  assert.match(DEVIS, /id="txLogoAide"/, 'la ligne qui dit d’où viennent les chiffres');

  // Il voyage avec l'article : récapitulatif, texte de l'atelier, et retour au
  // formulaire quand on rouvre la ligne.
  assert.match(DEVIS_JS, /logo:txLogoLu\(\)/, 'la saisie porte la grille');
  assert.match(DEVIS_JS, /lignes\.push\(\['Taille du logo \(mm\)',logo,/,
    'le récapitulatif de l’article la montre, sous l’intitulé du champ lui-même');
  assert.match(DEVIS_JS, /Taille du logo \(mm\) : \$\{logo\}/,
    'le texte qui part à l’atelier et au planning la porte');
  assert.match(DEVIS_JS, /txLogoManuel\[placement\+'\|'\+cle\]=String\(v\)/,
    'rouvrir une ligne doit rendre EXACTEMENT les largeurs annoncées au client');

  // Une autre référence, un autre genre : le tableau reprend la main.
  const refChange = DEVIS_JS.slice(DEVIS_JS.indexOf('function onTextileRefChange('));
  assert.match(refChange.slice(0, refChange.indexOf('\n}')), /txLogoOublier\(\)/,
    'changer de référence efface les corrections de l’ancien vêtement');
  const genreChange = DEVIS_JS.slice(DEVIS_JS.indexOf('function onTextileGenreChange('));
  assert.match(genreChange.slice(0, genreChange.indexOf('\n}')), /txLogoOublier\(\)/,
    'le genre change les largeurs autant que la référence (220 mm en femme, 260 en homme)');

  // LA GRILLE NE SE RECONSTRUIT PAS SOUS LES DOIGTS. previewTextile() tourne à
  // chaque frappe : sans la signature, la vendeuse perdrait son curseur au
  // milieu d'une largeur.
  const rendu = DEVIS_JS.slice(DEVIS_JS.indexOf('function txRenderLogo('));
  assert.match(rendu.slice(0, 900), /if\(!force&&signature===txLogoSignature\)return/,
    'la grille ne se refait que si son contenu change');
  const ecouteur = DEVIS_JS.slice(DEVIS_JS.indexOf("hote.addEventListener('input'"));
  const corps = ecouteur.slice(0, ecouteur.indexOf('});'));
  assert.ok(!/txRenderLogo/.test(corps),
    'la correction ne reconstruit RIEN : elle reprendrait le champ sous les doigts');
  assert.match(corps, /txLogoAideMaj\(\)/, 'seule la ligne d’aide est réécrite');

  // LE TABLEAU AVANT LA RÉFÉRENCE. Le 26/08, un essai en local a montré « Cette
  // référence n'est pas encore dans le tableau » sous une référence qui y
  // était : c'est la copie du serveur qui n'avait pas été remplie. Accuser la
  // référence quand on n'a pas lu le tableau envoie chercher au mauvais endroit.
  const aideSrc = DEVIS_JS.slice(DEVIS_JS.indexOf('function txLogoAideMaj('));
  const corpsAide = aideSrc.slice(0, aideSrc.indexOf('\n}'));
  const posEtat = corpsAide.indexOf("TX_LOGO_ETAT==='vide'");
  const posAccuse = corpsAide.indexOf('n’est pas encore dans le tableau');
  assert.ok(posEtat > 0 && posAccuse > 0, 'les deux messages existent');
  assert.ok(posEtat < posAccuse,
    'l’état du TABLEAU se dit AVANT d’accuser la référence — sinon le message ment');
  for (const etat of ['attente', 'muet', 'vide']) {
    assert.ok(corpsAide.includes(`TX_LOGO_ETAT==='${etat}'`), `l’état « ${etat} » a son message`);
  }
  // Et l'état se pose bien aux trois moments : au départ, à la réponse, à l'échec.
  assert.match(DEVIS_JS, /let TX_LOGO_ETAT='attente'/);
  assert.match(DEVIS_JS, /TX_LOGO_ETAT=Object\.keys\(TX_LOGO_INDEX\)\.length\?'ok':'vide'/);
  assert.match(DEVIS_JS, /TX_LOGO_ETAT='muet'/);

  // --- 6. LE PRIX NE BOUGE PAS ----------------------------------------------
  const saisie = {
    ref: 'K3025', isCustom: false, genre: 'Unisexe', transport: 'Maritime',
    printType: 'Coeur + Dos', sizes: { M: 20, L: 20, XL: 10 },
    discount: '', manualPrice: '', markupPercent: 0,
  };
  const sansLogo = TE.calculate(saisie);
  const avecLogo = TE.calculate({ ...saisie, logo: { Coeur: { M: 65 }, Dos: { M: 280 } } });
  assert.strictEqual(avecLogo.sold, sansLogo.sold,
    'LE CHIFFRAGE DU PATRON NE CONNAÎT PAS LE LOGO : le prix ne doit pas bouger d’un centime');
  assert.strictEqual(avecLogo.total, sansLogo.total);
  assert.strictEqual(avecLogo.margin, sansLogo.margin);
  // Et il ne doit pas apprendre à le connaître.
  const MOTEUR = sansCom(fs.readFileSync(path.join(RACINE, 'public/comptoir/textile-catalog.js'), 'utf8'));
  assert.ok(!/\blogo\b/i.test(MOTEUR),
    'le moteur conforme au fichier V9 reste hors du sujet : rien n’y parle de logo');

  // --- 7. LA CHARTE ----------------------------------------------------------
  // Aucune taille ni graisse de texte en chiffres dans le nouveau bloc : c'est
  // exactement le défaut corrigé partout le 26/08.
  const CSS_LOGO = DEVIS.slice(DEVIS.indexOf('.tx-logo{'), DEVIS.indexOf('.tx-logo-recap span'));
  assert.ok(!/font-size:\s*\d/.test(CSS_LOGO), 'aucune taille de texte en dur');
  assert.ok(!/font-weight:\s*\d/.test(CSS_LOGO), 'aucune graisse en dur');
  // Les en-têtes de colonne nomment une colonne, comme les intitulés des six
  // cases de tailles juste au-dessus : MÊME taille, sinon deux rangées de
  // libellés se suivent à trois pixels d'écart.
  assert.match(CSS_LOGO, /\.tx-logo-tete\{font-size:var\(--dd-taille-label\)/);
  assert.match(CSS_LOGO, /\.tx-logo-place\{font-size:var\(--dd-taille-label\)/);

  // --- 8. LES RÉGLAGES -------------------------------------------------------
  // Le tableau se remplit AU FUR ET À MESURE : sans ce bouton, chaque nouvelle
  // référence demanderait un déploiement.
  assert.match(REGLAGES, /reg-tailles-logo-maj/, 'le bouton de mise à jour existe');
  assert.match(REGLAGES, /\/api\/tailles-logo\/rafraichir/, 'et il appelle la route');
  assert.match(REGLAGES, /api\('GET', '\/api\/tailles-logo'\)/, 'l’écran relit le compte à chaque passage');
  // L'icône doit être dans le sous-ensemble figé de la police (91 glyphes) :
  // un nom absent s'affiche en TEXTE, réduit à sa première lettre, sans erreur.
  assert.match(REGLAGES, /carteSimple\('draw', 'Tailles de logo'/,
    '« draw » est vérifié présent dans olda-icones.woff2');

  console.log('taille-logo : OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
