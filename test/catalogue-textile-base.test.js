'use strict';

// UNE SEULE BASE PRODUITS POUR LES TROIS ÉCRANS (01/09/2026)
// ===========================================================================
// « Les t-shirts doivent être inclus dans le devis flash ; vente, devis et
// devis flash doivent avoir exactement la même base de données de produit »
// (Charlie, 01/09).
//
// Il y avait DEUX catalogues, et TROIS écrans qui n'en voyaient pas les mêmes
// morceaux :
//
//   · Vente directe    : AUCUN catalogue — nom, prix et description à la main ;
//   · Demande de devis : la table `catalogue_produits` pour les objets, et les
//                        49 références du moteur textile pour les t-shirts ;
//   · Devis flash      : la table seule, donc pas un seul t-shirt.
//
// Les références du moteur descendent maintenant dans la table, famille
// « Textile ». Ce fichier tient les deux bouts :
//
//   1. LA SEMENCE NE PEUT PAS DÉRIVER DU MOTEUR. Une référence ajoutée au
//      fichier du patron sans l'être au catalogue ferait un t-shirt qu'on
//      chiffre mais qu'on ne trouve pas — et personne ne s'en apercevrait, un
//      catalogue ne signale pas ce qu'il ne contient pas.
//   2. LA TABLE PORTE L'IDENTITÉ, PAS L'ARGENT. Un t-shirt ne se vend pas à un
//      prix de rayon : il se CHIFFRE. Un prix d'achat posé ici serait une case
//      qu'on corrige et qui ne change rien au devis.
//   3. LES TROIS ÉCRANS LISENT LE MÊME ENDPOINT.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');

// Le moteur s'écrit pour le navigateur : on lui pose un `window` et on le lit.
global.window = global.window || {};
require(path.join(RACINE, 'public/comptoir/textile-catalog.js'));
const TE = global.window.TextileEngine;
assert.ok(TE && TE.DB && Array.isArray(TE.DB.refs), 'le moteur textile doit s’exposer');

const SEMENCE = JSON.parse(lire('catalogue-textile-seed.json'));

// ---------------------------------------------------------------------------
// 1. LA SEMENCE EST LE MOTEUR, RÉFÉRENCE PAR RÉFÉRENCE
// ---------------------------------------------------------------------------
// ⚠ UNE SEULE EXCLUSION, ET CE N'EST PAS LA NÔTRE. « TEST » est une ligne
// d'essai restée dans le fichier du patron : genre vide, désignation « TEST »,
// 6,50 € d'achat. L'écran de devis du comptoir l'écarte DÉJÀ de son menu
// textile, avec sa propre règle — `r.genre && r.designation !== 'TEST'`, tenue
// par `test/menus-comptoir.test.js`. Le catalogue applique donc EXACTEMENT
// cette règle, pas une deuxième qui lui ressemble : les deux écrans doivent
// proposer les mêmes t-shirts, sinon « la même base » ne veut plus rien dire.
const vendable = (r) => !!(r && r.genre && r.designation && r.designation !== 'TEST');

const duMoteur = new Map(TE.DB.refs.map((r) => [r.ref, r]));
const deLaSemence = new Map(SEMENCE.map((p) => [p.reference, p]));

for (const r of TE.DB.refs.filter((x) => !vendable(x))) {
  assert.ok(!deLaSemence.has(r.ref),
    `« ${r.ref} » n’est pas un produit vendable : le comptoir l’écarte, le catalogue aussi`);
}
assert.ok(TE.DB.refs.some((r) => !vendable(r)),
  'la règle doit écarter quelque chose, sinon elle ne prouve rien');

const attendues = TE.DB.refs.filter(vendable);
assert.strictEqual(SEMENCE.length, attendues.length,
  `la semence porte ${SEMENCE.length} références, le moteur en a ${attendues.length} de vendables : `
  + 'une référence ajoutée au moteur doit descendre au catalogue');

// … ET C'EST BIEN LA MÊME LISTE QUE LE MENU DU COMPTOIR. La règle est écrite
// dans l'écran du patron : si elle y bouge, elle doit bouger ici aussi.
{
  const DEVIS_COMPTOIR = lire('public/comptoir/demande-devis.html');
  assert.ok(/db\.refs\.filter\(r=>r\.genre&&r\.designation&&r\.designation!=='TEST'\)/.test(DEVIS_COMPTOIR),
    'le comptoir écarte les mêmes références que le catalogue — une règle, deux lecteurs');
}

for (const r of attendues) {
  const p = deLaSemence.get(r.ref);
  assert.ok(p, `la référence « ${r.ref} » du moteur n’est pas au catalogue`);
  assert.strictEqual(p.designation, r.designation,
    `« ${r.ref} » : le catalogue et le moteur ne disent pas la même désignation`);
  assert.strictEqual(p.note, r.genre || '',
    `« ${r.ref} » : le genre du moteur doit suivre — c’est lui qui choisit la table des temps`);
  assert.strictEqual(p.famille, 'Textile',
    `« ${r.ref} » : un seul rayon pour tout ce que le moteur chiffre`);
}

// Et rien qui vienne d'ailleurs : une ligne de la semence sans référence au
// moteur serait un produit qu'on propose et qu'on ne sait pas chiffrer.
for (const p of SEMENCE) {
  assert.ok(duMoteur.has(p.reference),
    `« ${p.reference} » est au catalogue mais pas au moteur : on le proposerait sans savoir le chiffrer`);
}

// ---------------------------------------------------------------------------
// 2. L'IDENTITÉ, PAS L'ARGENT
// ---------------------------------------------------------------------------
// Le moteur garde ses prix d'achat : ce sont ses données de calcul, conformes
// au fichier V9. Les recopier au catalogue donnerait deux vérités, et celle que
// l'on peut corriger à l'écran ne serait PAS celle qui compte.
for (const p of SEMENCE) {
  assert.ok(!('prixAchat' in p) && !('prixVenteTtc' in p),
    `« ${p.reference} » : le catalogue porte l’identité du produit, pas son prix — `
    + 'un t-shirt se chiffre, il ne se vend pas à un prix de rayon');
}

// La désignation ne se répète pas : la clé du catalogue est
// famille + désignation + variante, deux articles de même nom n'en feraient
// qu'un, et le second disparaîtrait en silence à l'insertion.
{
  const vues = new Set();
  for (const p of SEMENCE) {
    assert.ok(!vues.has(p.designation), `deux références portent « ${p.designation} »`);
    vues.add(p.designation);
  }
}

// ---------------------------------------------------------------------------
// 2 bis. LA VENTE DIRECTE AVAIT SEPT PRODUITS ÉCRITS DANS SA PAGE
// ---------------------------------------------------------------------------
// C'était la vraie fracture : l'écran n'avait AUCUNE base. Son champ « Article »
// proposait sept intitulés en dur — « Tee-shirt personnalisé », « Tasse
// personnalisée »… — qui ne correspondaient à aucun produit réel, ne portaient
// ni référence ni prix, et ne pouvaient pas bouger sans redéploiement.
{
  const VENTE = lire('public/comptoir/vente-directe.html');
  const PONT = lire('public/comptoir/pont.js');

  // La greffe vit dans le PONT, pas dans l'écran : l'écran vient du patron, et
  // une nouvelle version de sa part se pose en REMPLAÇANT le fichier — une
  // greffe écrite dedans partirait avec.
  assert.ok(/getElementById\('productsList'\)/.test(PONT),
    'le catalogue de la vente directe se greffe dans le pont');
  assert.ok(!/catalogue-produits/.test(VENTE),
    '… et pas dans l’écran du patron, qui se remplace en entier');

  // Les sept intitulés sont REMPLACÉS, pas complétés : les garder ferait deux
  // bases dans un seul menu, et c'est exactement ce qu'on vient de défaire.
  assert.ok(/liste\.replaceChildren\(frag\)/.test(PONT),
    'le catalogue remplace la liste, il ne s’y ajoute pas');

  // ⚠ LE PRIX NE S'IMPOSE PAS. La vente directe est une vente au comptoir : on
  // y remise, on y arrondit. Un prix de rayon qui écraserait un prix négocié
  // serait une remise perdue à chaque article.
  assert.ok(/if \(!prix \|\| String\(prix\.value\)\.trim\(\) !== ''\) return;/.test(PONT),
    'le prix ne se pose que dans une case VIDE');

  // Et le fetch est MINUTÉ — partagé avec le pont, pas recopié.
  assert.ok(/window\.oldaFetchMinute = fetchMinute;/.test(PONT),
    'le minuteur du pont est partagé avec les greffes posées à sa suite');
}

// ---------------------------------------------------------------------------
// 3. LA MIGRATION : ELLE AJOUTE, ELLE N'ÉCRASE RIEN, ET ELLE NE REJOUE PAS
// ---------------------------------------------------------------------------
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
  const db = require('../db');

  const call = async (method, chemin, corps) => {
    const res = await fetch(base + chemin, {
      method,
      headers: corps !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };

  // --- 3.1 Le textile est en base, servi par le MÊME endpoint que le reste ---
  let r = await call('GET', '/api/catalogue-produits');
  assert.strictEqual(r.status, 200);
  const textile = r.body.filter((p) => p.famille === 'Textile');
  assert.strictEqual(textile.length, SEMENCE.length,
    'les références du moteur sont au catalogue, au même endroit que les objets');
  assert.ok(r.body.length > textile.length,
    '… et elles s’ajoutent au catalogue, elles ne le remplacent pas');
  const ns300 = textile.find((p) => p.reference === 'NS300');
  assert.ok(ns300, 'NS300 est au catalogue');
  assert.strictEqual(ns300.prixVenteTtc, null, 'un t-shirt n’a pas de prix de rayon : il se chiffre');
  assert.strictEqual(ns300.note, 'Unisexe', 'son genre voyage avec lui — c’est la clé des temps de marquage');

  // --- 3.2 Rejouée, elle ne double rien --------------------------------------
  await db.semerCatalogueTextile();
  r = await call('GET', '/api/catalogue-produits');
  assert.strictEqual(r.body.filter((p) => p.famille === 'Textile').length, SEMENCE.length,
    'la garde app_meta tient : la semence ne repasse pas');

  // --- 3.3 ⚠ ELLE N'ÉCRASE PAS UN PRIX POSÉ À LA MAIN ------------------------
  // La production porte 82 lignes et, un jour, les prix d'un import. Une
  // semence qui remplacerait le catalogue les emporterait toutes — et personne
  // ne verrait la différence avant le premier devis sous-tarifé.
  const avant = r.body.filter((p) => p.famille !== 'Textile');
  assert.ok(avant.length >= 82, 'les rayons d’origine sont intacts');
  const tasse = avant.find((p) => p.famille.startsWith('Tasse'));
  assert.ok(tasse, 'la famille des tasses est toujours là');

  // On pose un prix à la main sur un textile, on rejoue la semence : il tient.
  await db.pool.query(
    "UPDATE catalogue_produits SET prix_vente_ttc = 19.9 WHERE reference = 'NS300'",
  );
  await db.pool.query("DELETE FROM app_meta WHERE key = 'catalogue_textile_seed_v1'");
  await db.semerCatalogueTextile();
  r = await call('GET', '/api/catalogue-produits');
  const apres = r.body.filter((p) => p.reference === 'NS300');
  assert.strictEqual(apres.length, 1, 'la semence n’insère pas un doublon de ce qui est déjà là');
  assert.strictEqual(apres[0].prixVenteTtc, 19.9,
    'un prix posé à la main n’est pas une erreur à réparer : la semence n’y touche pas');

  console.log('✓ base produits : une seule, le textile dedans, et la semence ne peut pas dériver du moteur');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
