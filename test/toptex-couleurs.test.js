'use strict';

// LES COLORIS TEXTILE VIENNENT DE TOPTEX
//
// Le client vit dans toptex.js (racine, jamais public/) et le catalogue du
// comptoir est REMPLI HORS LIGNE par scripts/refresh-toptex-couleurs.js. Ce
// fichier vérifie :
//   1. LA LECTURE DE L'API — ce qui identifie une couleur, et ce qui n'est
//      surtout pas un identifiant.
//   2. L'API QUI FLANCHE — réponse vide en rafale, jeton expiré, référence
//      inconnue : aucun de ces cas ne doit faire perdre ou inventer un coloris.
//   3. CE QUI ARRIVE AU COMPTOIR — une seule forme dans le catalogue, et la
//      clé du fournisseur qui ne descend jamais au navigateur.
//
// Aucun appel réseau : `fetch` est remplacé le temps du test.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const toptex = require(path.join(RACINE, 'toptex.js'));

process.env.TOPTEX_API_KEY = 'cle-de-test';
process.env.TOPTEX_API_USER = 'utilisateur';
process.env.TOPTEX_API_PASSWORD = 'motdepasse';
toptex.REGLAGES.attenteMs = 1;   // on teste le RÉESSAI, pas la patience

// --- 1. Ce qui identifie une couleur ----------------------------------------

const BRUT = {
  catalogReference: 'NS300',
  brand: 'Native Spirit',
  designation: { fr: 'T-shirt écoresponsable unisexe', en: 'Eco-friendly unisex t-shirt' },
  colors: [
    {
      colors: { fr: 'Adriatic Blue', en: 'Adriatic Blue' },
      colorsHexa: ['4C8290'],                       // SANS le « # » chez TopTex
      colorsDominant: [{ fr: 'Bleu', en: 'Blue' }],
      saleState: 'active',
      packshots: { FACE: { url: 'https://x/f.jpg?token=abc' }, BACK: { url: 'https://x/b.jpg?token=abc' }, SIDE: { url: 'https://x/s.jpg' } },
    },
    {
      colors: { fr: 'Navy Blue', en: 'Navy Blue' },
      colorsHexa: ['292D39'],
      colorsDominant: [{ fr: 'Bleu', en: 'Blue' }],  // MÊME famille que ci-dessus
      saleState: 'active',
      packshots: { 'FACE CAP': { url: 'https://x/c.jpg' } },
    },
    {
      colors: { fr: 'Cool Blue Heather' },
      colorsHexa: [],                               // une teinte chinée n'a pas de code
      colorsDominant: [{ fr: 'Bleu' }],
      saleState: 'active',
      packshots: { FACE: { url: 'https://x/h.jpg' } },
    },
    {
      colors: { fr: 'Vieux Rose' },
      colorsHexa: ['C59F9B'],
      colorsDominant: [{ fr: 'Rose' }],
      saleState: 'discontinued_item',               // le fournisseur ne la livre plus
      packshots: { FACE: { url: 'https://x/r.jpg' } },
    },
  ],
};

const norm = toptex.normaliserProduit(BRUT);
assert.strictEqual(norm.ref, 'NS300');
assert.strictEqual(norm.marque, 'Native Spirit');
assert.strictEqual(norm.nom, 'T-shirt écoresponsable unisexe', 'la désignation se lit en français');

const bleus = norm.couleurs.filter((c) => c.famille === 'Bleu');
assert.strictEqual(bleus.length, 3, 'trois teintes partagent la famille « Bleu »');
assert.strictEqual(new Set(bleus.map((c) => c.label)).size, 3,
  'colors.fr distingue les teintes que colorsDominant confond — jamais la famille comme identifiant');

assert.strictEqual(norm.couleurs[0].hex, '#4C8290', 'le « # » est ajouté devant colorsHexa');
assert.strictEqual(norm.couleurs[2].hex, null, 'une teinte chinée sans code passe à null, elle n’est pas perdue');
assert.deepStrictEqual(Object.keys(norm.couleurs[0].vues).sort(), ['cote', 'dos', 'face']);
assert.strictEqual(norm.couleurs[1].vues.face, 'https://x/c.jpg',
  '« FACE CAP » est la face des casquettes : sans l’alias, la vue principale disparaît en silence');

// Les URLs de packshot portent un jeton et expirent : elles se consomment tout
// de suite. Rien de ce que le script écrit dans le catalogue ne doit en garder.
const catalogueSource = fs.readFileSync(path.join(RACINE, 'public/comptoir/textile-catalog.js'), 'utf8');
assert.ok(!/toptex\.io/.test(catalogueSource),
  'aucune URL TopTex ne doit être figée dans le catalogue : elles expirent');

(async function verifier() {
  // --- 2. L'API qui flanche ----------------------------------------------------

  function poserFetch(reponses) {
    const appels = [];
    global.fetch = async (url, opts) => {
      appels.push({ url: String(url), opts });
      if (String(url).includes('/authenticate')) {
        return { ok: true, status: 200, json: async () => ({ token: 'jeton-test' }) };
      }
      const r = reponses.shift();
      if (!r) throw new Error('appel réseau non prévu par le test');
      if (r.boom) throw new Error('socket coupé');
      return { ok: r.status < 400, status: r.status, json: async () => r.body };
    };
    return appels;
  }
  const vraiFetch = global.fetch;

  // Une réponse vide en rafale n'est PAS la vérité : on réessaie, et c'est la
  // réponse pleine qui fait foi.
  let appels = poserFetch([
    { status: 200, body: { catalogReference: 'NS300', colors: [] } },
    { status: 500, body: {} },
    { boom: true },
    { status: 200, body: BRUT },
  ]);
  let produit = await toptex.getProduit('NS300');
  assert.strictEqual(produit.couleurs.length, 4, 'la réponse pleine finit par arriver');
  assert.strictEqual(appels.filter((a) => a.url.includes('/products')).length, 4,
    'vide, 500 et coupure réseau se réessaient tous les trois');

  // Un produit dont AUCUNE couleur n'a de packshot est le même symptôme.
  appels = poserFetch([
    { status: 200, body: { colors: [{ colors: { fr: 'Noir' }, packshots: {} }] } },
    { status: 200, body: BRUT },
  ]);
  produit = await toptex.getProduit('NS300');
  assert.strictEqual(produit.couleurs.length, 4, '0 packshot = réponse suspecte, on retente');

  // Référence inconnue : TopTex répond 200 avec une liste vide, sans erreur. On
  // ne lève rien — c'est la LONGUEUR que l'appelant teste.
  appels = poserFetch(Array.from({ length: 4 }, () => ({ status: 200, body: { colors: [] } })));
  produit = await toptex.getProduit('ZZZ-INCONNUE');
  assert.strictEqual(produit.couleurs.length, 0, 'une référence inconnue rend une liste vide, pas une exception');

  // Jeton expiré en cours de route : on se réauthentifie et on repart, sans
  // consommer de tentative. Le jeton en cache est réutilisé tant qu'il vaut :
  // le SEUL appel à /authenticate ici est celui que le 401 provoque.
  appels = poserFetch([{ status: 401, body: {} }, { status: 200, body: BRUT }]);
  produit = await toptex.getProduit('NS300');
  assert.strictEqual(produit.couleurs.length, 4, 'un 401 se rattrape par une réauthentification');
  assert.strictEqual(appels.filter((a) => a.url.includes('/authenticate')).length, 1,
    'le 401 déclenche une nouvelle authentification, et une seule');
  assert.strictEqual(appels.filter((a) => a.url.includes('/products')).length, 2,
    'la requête est rejouée avec le jeton neuf, sans brûler de tentative');

  // Les deux en-têtes sont obligatoires côté TopTex.
  const appelProduit = appels.find((a) => a.url.includes('/products'));
  assert.ok(appelProduit.opts.headers['x-api-key'], 'x-api-key est obligatoire');
  assert.ok(appelProduit.opts.headers['x-toptex-authorization'], 'x-toptex-authorization est obligatoire');
  assert.ok(appelProduit.url.includes('usage_right=b2b_b2c') && appelProduit.url.includes('language=fr'),
    'droits d’affichage et langue partent dans la requête');

  // Un coloris arrêté reste dans la réponse : il ne doit pas arriver au comptoir.
  appels = poserFetch([{ status: 200, body: BRUT }]);
  const vendables = await toptex.getCouleurs('NS300');
  assert.deepStrictEqual(vendables.map((c) => c.label), ['Adriatic Blue', 'Navy Blue', 'Cool Blue Heather'],
    'un coloris « discontinued_item » n’est pas proposé à la vente');

  global.fetch = vraiFetch;

  // --- 3. Ce qui arrive au comptoir -------------------------------------------

  // Les refs passent EN SÉQUENCE : TopTex limite par IP et un envoi en parallèle
  // fait tomber la moitié des réponses.
  const script = fs.readFileSync(path.join(RACINE, 'scripts/refresh-toptex-couleurs.js'), 'utf8');
  assert.ok(/await toptex\.pause\(toptex\.REGLAGES\.pauseRefMs\)/.test(script),
    'le script attend entre deux références');
  assert.ok(!/Promise\.all|Promise\.allSettled/.test(script),
    'aucune rafale en parallèle vers TopTex');
  assert.ok(toptex.REGLAGES.pauseRefMs >= 250, 'au moins 250 ms entre deux références');

  // La clé ne descend jamais au navigateur.
  for (const fichier of fs.readdirSync(path.join(RACINE, 'public/comptoir'))) {
    const contenu = fs.readFileSync(path.join(RACINE, 'public/comptoir', fichier), 'utf8');
    assert.ok(!/TOPTEX_API|api\.toptex\.io/.test(contenu),
      `${fichier} ne doit rien savoir des identifiants TopTex`);
  }

  // Le catalogue n'a qu'UNE forme : { n, h }. Un tableau mixte casserait la
  // pastille en silence.
  global.window = global.window || {};
  require(path.join(RACINE, 'public/comptoir/textile-catalog.js'));
  const TE = global.window.TextileEngine;
  const toutes = Object.values(TE.DB.colors).flat();
  assert.ok(toutes.length > 500, 'les coloris du fournisseur sont bien dans le catalogue');
  toutes.forEach((c) => {
    assert.strictEqual(typeof c, 'object', 'un coloris est un objet { n, h }, jamais une chaîne');
    assert.ok(c.n && typeof c.n === 'string', 'le nom du coloris est la clé — c’est lui qui part sur le devis');
    assert.ok(c.h === null || /^#[0-9A-Fa-f]{6}$/.test(c.h), `code couleur illisible : ${c.h}`);
  });

  // Chaque clé de couleurs désigne une référence réelle du catalogue.
  const refs = new Set(TE.DB.refs.map((r) => r.ref));
  Object.keys(TE.DB.colors).forEach((ref) => assert.ok(refs.has(ref),
    `« ${ref} » ne correspond à aucun produit : clé orpheline`));

  // La liste déroulante attend des NOMS, la pastille retrouve la teinte par ce nom.
  const noms = TE.colorsFor('NS300');
  assert.ok(noms.length > 30 && noms.every((n) => typeof n === 'string'),
    'colorsFor rend les noms attendus par la liste déroulante');
  assert.strictEqual(TE.colorHexFor('NS300', noms[0]), TE.DB.colors.NS300[0].h);
  assert.strictEqual(TE.colorHexFor('NS300', '  ' + noms[0].toUpperCase() + '  '), TE.DB.colors.NS300[0].h,
    'la casse et les espaces de la saisie ne doivent pas éteindre la pastille');
  assert.strictEqual(TE.colorHexFor('NS300', 'Teinte maison'), null,
    'un coloris hors catalogue n’invente pas de pastille');
  assert.strictEqual(TE.colorHexFor('NS300', ''), null);

  // Le patron a renommé ses produits comme dans son fichier de chiffrage ; TopTex
  // a rebaptisé la gamme Bio150/Bio190. Sa référence reste celle du catalogue.
  const renommees = TE.DB.refs.filter((r) => r.toptex);
  assert.ok(renommees.length >= 8, 'les références renommées par TopTex portent leur équivalent fournisseur');
  renommees.forEach((r) => assert.ok(TE.DB.colors[r.ref] && TE.DB.colors[r.ref].length,
    `${r.ref} (${r.toptex} chez TopTex) doit avoir ses coloris`));

  // La pastille de la page suit le champ, y compris quand la couleur est posée
  // APRÈS la référence (reprise d'un article déjà saisi).
  const DEVIS = fs.readFileSync(path.join(RACINE, 'public/comptoir/demande-devis.html'), 'utf8');
  assert.ok(/id="txColor"[^>]*oninput="onTextileColorChange\(\)"/.test(DEVIS),
    'la saisie libre d’une couleur rafraîchit la pastille et l’aperçu');
  const reprise = (DEVIS.match(/function txApplyToForm\(t\)\{[\s\S]*?\n\}/) || [''])[0];
  assert.ok(/onTextileColorChange\(\)/.test(reprise),
    'reprendre un article relit la pastille après avoir posé la couleur');

  console.log('✓ toptex : coloris identifiés par leur nom, API qui flanche rattrapée, clé jamais au navigateur');
})().catch((e) => { console.error(e); process.exit(1); });
