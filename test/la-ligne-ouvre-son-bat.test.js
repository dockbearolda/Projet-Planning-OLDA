'use strict';

// LA LIGNE OUVRE SON BAT — et la chaîne s'allume enfin.
// ===========================================================================
// TOUT ÉTAIT ÉCRIT, RIEN N'ÉTAIT BRANCHÉ. Depuis l'entrée de BAT Studio dans le
// CRM (04/09), `ouvrirPourFiche`, `batDeLaFiche`, `attacherContexte` et
// `deposerDansCrm` existaient, étaient testés — et ne s'exécutaient jamais :
// `public/app.js` montait l'écran avec `{ chrome: true }` et rien d'autre, donc
// `contexteOuverture.requestId` restait vide. Conséquence mesurée : TOUT BAT
// composé dans le CRM était orphelin, et au moment de le déposer l'écran
// répondait « Aucune fiche CRM associée à ce projet ».
//
// CE FICHIER TIENT LES TROIS MAILLONS :
//   1. QUI a droit à un bouton — « mérite un BAT » n'est pas « chiffré au
//      moteur V9 », et se tromper là prive 25 produits sur 86 de leur BAT.
//   2. QUE le CRM annonce la fiche à l'écran, au montage comme au changement de
//      ligne. Sans ça, la chaîne reste écrite et morte.
//   3. QUE le bouton ne paraît QUE là où il mène quelque part. Un bouton qui
//      n'ouvre rien est un bouton qu'on apprend à ne plus lire — la règle du
//      « Reprendre le devis » et de la « Facture », déjà tenue dans la fiche.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const APP = lire('public/app.js');
const FICHE = lire('public/fiche-atelier.js');
const MONTER = lire('public/bat/js/monter.js');
const DB = lire('db.js');

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
    const txt = res.status === 204 ? '' : await res.text();
    let corps = null;
    try { corps = txt ? JSON.parse(txt) : null; } catch (_) { corps = txt; }
    return { status: res.status, body: corps };
  };

  // =========================================================================
  // 1. QUI MÉRITE UN BAT
  // =========================================================================
  const r = await call('GET', '/api/settings/bat-produits');
  assert.strictEqual(r.status, 200);
  const cles = new Set(r.body.cles);
  const a = (v) => cles.has(String(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));

  // LE PIÈGE, ET IL COÛTE 25 PRODUITS SUR 86. Les deux écrans flash rangent un
  // produit sous l'onglet « Textile » ou « Boutique » en testant
  // `famille === 'Textile'` — la famille du moteur V9. S'en servir ici
  // priverait de BAT les « Vêtements — Unisexe / Femme / Enfant » : des
  // t-shirts FINIS, vendus au prix magasin, sur lesquels on imprime exactement
  // comme sur les autres.
  assert.ok(r.body.familles.includes('Textile'), 'le textile chiffré au V9, évidemment');
  for (const f of ['Vêtements — Unisexe', 'Vêtements — Femme', 'Vêtements — Enfant']) {
    assert.ok(r.body.familles.includes(f),
      `${f} aussi : « mérite un BAT » n’est pas « chiffré au moteur V9 »`);
  }
  for (const f of ['Casquettes', 'Pochettes', 'Sacs']) {
    assert.ok(r.body.familles.includes(f), `${f} — Charlie les cite mot pour mot`);
  }

  // On reconnaît une ligne par SA RÉFÉRENCE et par SA DÉSIGNATION. Les deux :
  // une vendeuse peut taper une désignation sans choisir au catalogue, et sans
  // cette seconde clé un t-shirt saisi à la main n'aurait pas de bouton.
  assert.ok(a('K3025') && a('NS300'), 'les références textile sont des clés');
  assert.ok(a('T-shirt unisexe léger Pro 145 g'), 'les désignations aussi');

  // ET CE QUI RESTE CHEZ ILLUSTRATOR N'EN A PAS. « Le reste, on fait encore les
  // BAT sur Illustrator » (Charlie, 04/09).
  const catalogue = (await call('GET', '/api/catalogue-produits')).body;
  const horsBat = catalogue.filter((p) => !r.body.familles.includes(p.famille));
  assert.ok(horsBat.length > 100, 'la majorité du catalogue n’est pas du textile');
  for (const p of horsBat.slice(0, 40)) {
    assert.ok(!a(p.designation),
      `« ${p.designation} » (${p.famille}) ne doit pas ouvrir de BAT`);
  }

  // LA LISTE EST UN RÉGLAGE, pas une constante : une famille neuve au catalogue
  // ne doit pas demander un déploiement pour recevoir des BAT.
  assert.ok(/app_meta WHERE key = 'familles_bat'/.test(DB),
    'la liste vit en base, comme l’identité de l’atelier');
  // Une liste VIDE est un choix — « aucun BAT nulle part » — et ne doit pas
  // retomber sur la valeur par défaut, qui rallumerait ce qu'on vient d'éteindre.
  assert.ok(/Une liste VIDE est un choix/.test(DB), 'et le cas vide est écrit');

  // =========================================================================
  // 2. LE CRM ANNONCE LA FICHE — c'est ce qui manquait
  // =========================================================================
  assert.ok(/monterBatStudio\(\$bat, \{ chrome: true, \.\.\.\(pour \|\| \{\}\) \}\)/.test(APP),
    'le montage passe la fiche : sans elle, `ouvrirPourFiche` ne s’exécute jamais');
  assert.ok(/function ouvrirBatDeLaLigne\(r\)/.test(APP), 'et la ligne sait ouvrir SON bat');
  assert.ok(/batMonte = mod/.test(APP),
    'on GARDE ce que le montage rend : sans la référence, on ne peut plus rien lui demander');
  // Passer d'une ligne à une autre ne remonte pas 5,4 Mo de bibliothèques et ne
  // ferme pas le projet en cours d'édition.
  assert.ok(/mod\.ouvrirPourFiche \? mod\.ouvrirPourFiche\(r\.id, quoi\)/.test(APP),
    'déjà monté, on demande la bascule au lieu de tout remonter');
  assert.ok(/async ouvrirPourFiche\(requestId, quoi = \{\}\)/.test(MONTER),
    'et l’écran expose la prise correspondante');
  // ⚠ Une clé de `VIEWS`, jamais une chaîne écrite à la main : c'est ce qui a
  // laissé passer une barre morte le 31/08 (« vue et hash doivent rester alignés »).
  assert.ok(/'#bat': 'bat'/.test(APP), 'le hash du BAT est déclaré dans la table des vues');

  // =========================================================================
  // 3. LE BOUTON NE PARAÎT QUE LÀ OÙ IL MÈNE QUELQUE PART
  // =========================================================================
  assert.ok(/if \(ctx\.peutBat && ctx\.ouvrirBat\) \{/.test(FICHE),
    'la fiche n’affiche le BAT que sur une ligne qui en mérite un');
  assert.ok(/peutBat: meriteUnBat\(r\)/.test(APP), 'et c’est le planning qui tranche');
  // INJOIGNABLE, ON NE PROPOSE RIEN : un bouton posé au hasard sur une tasse est
  // pire qu'aucun bouton.
  assert.ok(/if \(!batProduits \|\| !batProduits\.size\) return false;/.test(APP),
    'liste absente = aucun bouton, jamais un bouton au hasard');
  // La liste part AVEC la fiche, comme le tableau des faces : sans ça, le
  // bouton manquerait sur la première fiche ouverte de la session.
  assert.ok(/chargerBatProduits\(\),\n\s*api\('GET', `\/api\/requests\/\$\{id\}\/marquage`\)/.test(APP),
    'elle est chargée à l’ouverture de la fiche, pas après');

  // ET LES TROIS BOUTONS DE DOCUMENT SONT LA MÊME FAMILLE. « Tout ce qui peut
  // être à la même hauteur l'est » : un seul `fa-btn`, une seule règle.
  const barre = FICHE.slice(FICHE.indexOf('ctx.peutBat'), FICHE.indexOf('outils.append(etatSauve'));
  const classes = [...barre.matchAll(/bouton\('([^']+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual([...new Set(classes)], ['fa-btn'],
    'BAT, Facture et Reprendre sortent du MÊME composant, pas de trois qui se ressemblent');

  console.log('✓ la ligne ouvre son BAT : le textile seulement, la fiche annoncée, '
    + 'et un bouton qui ne paraît que là où il mène quelque part');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
