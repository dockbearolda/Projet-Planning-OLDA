'use strict';

const { ecran } = require('./ecran-comptoir');

// ===========================================================================
// LES FACES D'UN ARTICLE — CE QU'ON MARQUE, PAS COMBIEN DE MILLIMÈTRES
// ===========================================================================
// Charlie, 26/08 : « du mug au couteau à graver, une carte adaptée à chaque
// article » — puis « dessus c'est pas des mm mais des noms de logo, des
// phrases : elle me dit quoi graver ».
//
// Une tasse n'a pas de TAILLES, elle a des EMPLACEMENTS, et sur chacun on écrit
// une consigne. Ce fichier tient les cinq choses qui casseraient en silence :
//
//   1. LES FACES VIENNENT DE LA FAMILLE, jamais d'une liste écrite dans
//      l'écran. Une famille déclarée demain doit marcher demain.
//   2. UNE FACE VIDE N'EST PAS UNE ZONE — une carte vide sur le papier finit
//      par être remplie de n'importe quoi.
//   3. LA CONSIGNE VOYAGE JUSQU'À LA PRODUCTION : saisie au comptoir, elle doit
//      arriver dans `prod.logos`, sinon elle retombe dans le pavé de
//      commentaire et on est revenu au point de départ.
//   4. LE FOND EST UN DISQUE. Les deux écrans du comptoir imposent
//      « input,select,textarea{border-radius:… !important} » : un `!important`
//      sur un sélecteur nu bat n'importe quelle classe, y compris celle d'un
//      composant partagé — le fond se retrouvait CARRÉ, à l'endroit précis où
//      la forme dit de quel côté on marque.
//   5. LA TASSE EST DÉCLARÉE EN BASE. L'instantané des tailles de logo ne parle
//      qu'à une base NEUVE : en production la clé existe depuis le 26/08, il n'y
//      passera donc plus jamais. Sans migration à garde propre, l'écran de la
//      vendeuse n'aurait aucune face à afficher.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8');
const PONT = lire('public/comptoir/pont.js');
const CHARTE = lire('public/charte.css');
const DEVIS = ecran('demande-devis');
const VENTE = ecran('vente-directe');
const DB = lire('db.js');

// --- 1. Les fonctions pures de pont.js, dans un bac à sable -----------------
// On n'évalue QUE la section des faces : le reste du fichier parle au document
// et au réseau, et n'a rien à faire dans un test de logique.
const debut = PONT.indexOf('function cleDeFace(');
assert.ok(debut > 0, 'pont.js expose la section des faces');
const SECTION = PONT.slice(debut, PONT.indexOf('window.facesArticle'));
const bac = new Function(`${SECTION}
  return { cleDeFace, dessinDeFamille, zonesDepuisFaces, valeursDepuisZones };`)();

// La clé sert à RETROUVER une valeur et à donner sa forme au dessin. Ce n'est
// jamais elle qui part en production : c'est le nom, tel que l'atelier l'a
// écrit dans le tableau.
assert.strictEqual(bac.cleDeFace('Face arrière'), 'arriere');
assert.strictEqual(bac.cleDeFace('Face avant'), 'avant');
assert.strictEqual(bac.cleDeFace('Fond'), 'fond');
assert.strictEqual(bac.cleDeFace('Manche DR'), 'manche-dr');
assert.strictEqual(bac.cleDeFace(null), '');

// UNE SEULE FAMILLE EST DESSINÉE, et elle se reconnaît sur son nom réduit.
assert.strictEqual(bac.dessinDeFamille('Tasse céramique 350 ml'), 'tasse');
assert.strictEqual(bac.dessinDeFamille('TASSES CERAMIQUE 350 ML'), 'tasse');
assert.strictEqual(bac.dessinDeFamille('Casquettes'), '',
  'une famille non dessinée prend la grille nue, qui suffit');
assert.strictEqual(bac.dessinDeFamille(''), '');

// UNE FACE VIDE N'EST PAS UNE ZONE.
const zones = bac.zonesDepuisFaces(
  ['Face avant', 'Face arrière', 'Fond'],
  { 'Face avant': '  Logo client  ', 'Face arrière': '   ', Fond: 'Logo OLDA' },
);
assert.deepStrictEqual(zones, [
  { face: 'Face avant', mm: '', quoi: 'Logo client' },
  { face: 'Fond', mm: '', quoi: 'Logo OLDA' },
], 'seules les faces écrites deviennent des zones, et la consigne est ébarbée');
assert.ok(zones.every((z) => z.mm === ''),
  'AUCUN MILLIMÈTRE AU COMPTOIR : demander une largeur ici, c’est obtenir un chiffre inventé');
assert.deepStrictEqual(bac.zonesDepuisFaces([], { x: 'y' }), [],
  'une famille sans faces ne produit aucune zone');

// Une ligne rouverte se relit à l'identique : c'est elle qui a été annoncée.
assert.deepStrictEqual(bac.valeursDepuisZones(zones),
  { 'Face avant': 'Logo client', Fond: 'Logo OLDA' });
assert.deepStrictEqual(bac.valeursDepuisZones(null), {},
  'un dossier d’avant les faces se rouvre sans faces, pas en erreur');

// --- 2. La consigne voyage jusqu'à la production ----------------------------
// `prodDuBesoin` est ce que la demande de devis envoie au planning. Sans les
// zones, la tasse repart dans le pavé de commentaire.
const prodSrc = (DEVIS.match(/function prodDuBesoin\(n\)\{[\s\S]*?\n\}/) || [''])[0];
assert.ok(prodSrc, 'prodDuBesoin doit rester une fonction nommée');
const prodDuBesoin = new Function('ctx', `with(ctx){${prodSrc}
  return prodDuBesoin}`)({ TE: () => ({ SIZE_LABELS: {}, SIZE_KEYS: [] }), TX_LOGO_ORDRE: [] });

const tasse = prodDuBesoin({
  requestedRef: '', color: 'Blanc', productionType: 'UV',
  zones: [
    { face: 'Face avant', quoi: 'Logo Coco Beach' },
    { face: 'Fond', quoi: 'Logo OLDA' },
  ],
});
assert.deepStrictEqual(tasse.logos, [
  { face: 'Face avant', mm: '', quoi: 'Logo Coco Beach' },
  { face: 'Fond', mm: '', quoi: 'Logo OLDA' },
], 'les faces saisies au comptoir arrivent en zones de production');
assert.deepStrictEqual(tasse.tailles, [], 'une tasse n’a pas de grille de tailles');

// Un besoin d'avant les faces n'en invente pas.
assert.deepStrictEqual(prodDuBesoin({ requestedRef: 'NS300' }).logos, [],
  'sans zones saisies, aucune zone inventée');

// --- 3. Le composant partagé descend dans la charte -------------------------
// Deux écrans à un clic l'un de l'autre doivent donner le MÊME composant.
assert.ok(/\.faces__zone\s*\{/.test(CHARTE) && /\.faces--tasse/.test(CHARTE),
  'le composant vit dans charte.css, le seul fichier que les trois écrans lisent');
assert.ok(!/\.tasse__/.test(CHARTE),
  'plus de composant « tasse » à part : une seule famille de classes');

// LE FOND EST UN DISQUE, et rien ne doit le reprendre.
const disque = (CHARTE.match(/\.faces--tasse \.faces__face--fond \.faces__zone \{[^}]*\}/) || [''])[0];
assert.ok(/border-radius:\s*50%/.test(disque), 'le fond de la tasse est un disque');

// AUCUNE COULEUR EN DUR dans le composant : la couleur dit un état, et une face
// n'est pas un état.
const bloc = CHARTE.slice(CHARTE.indexOf('.faces {'));
assert.ok(!/#[0-9a-f]{3,8}\b/i.test(bloc.replace(/\/\*[\s\S]*?\*\//g, '')),
  'aucune teinte écrite en clair dans le composant');

// L'ANSE NE SORT PAS DE LA CARTE. Elle déborde la face de sa propre largeur :
// sans réserve à droite, elle se faisait couper au bord sur une colonne étroite.
assert.ok(/\.faces--tasse \{[^}]*padding-right:\s*var\(--pas-3\)/.test(CHARTE),
  'la tasse réserve à droite la largeur de son anse');

// --- 4. LE PIÈGE PERMANENT : `!important` sur un sélecteur nu ---------------
// Les deux écrans du comptoir arrondissent tous les champs de force. Le fond de
// la tasse s'y retrouvait CARRÉ — et ça ne se voit sur AUCUN autre composant,
// donc personne ne va le chercher là.
for (const [nom, src] of [['demande-devis', DEVIS], ['vente-directe', VENTE]]) {
  const regles = src.match(/input,select,textarea[^{]*\{[^}]*border-radius[^}]*!important[^}]*\}/g) || [];
  assert.ok(regles.length, `${nom} : la règle d’arrondi de force existe toujours`);
  assert.ok(regles.every((r) => r.includes(':not(.faces__zone)')),
    `${nom} : l’arrondi imposé aux champs ÉPARGNE les faces — sinon le fond de la tasse est carré`);
}

// --- 5. La tasse est déclarée en base, par une migration à garde propre -----
assert.ok(/async function semerFacesTasse\(\)/.test(DB),
  'une migration déclare les faces de la tasse');
assert.ok(/SELECT 1 FROM app_meta WHERE key = 'faces_tasse'/.test(DB),
  'elle porte SA PROPRE garde : deux incidents réels sont venus d’une garde partagée');
assert.ok(/DELETE FROM app_meta WHERE key = 'faces_tasse'/.test(DB),
  'et son chemin retour est écrit');
assert.ok(DB.indexOf('await semerTaillesLogo();') < DB.indexOf('await semerFacesTasse();'),
  'elle passe APRÈS l’instantané, sinon l’instantané l’écraserait sur une base neuve');

// La déclaration elle-même, sur le vrai serveur et sa base.
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

  const table = await fetch(`${base}/api/tailles-logo`).then((r) => r.json());
  const famille = (table.familles || []).find((f) => f.nom === 'Tasse céramique 350 ml');
  assert.ok(famille, 'la tasse est au tableau des tailles de logo');
  assert.deepStrictEqual(famille.faces, ['Face avant', 'Face arrière', 'Fond'],
    'ses trois faces : les deux parois et le fond');
  assert.deepStrictEqual(famille.tailles, ['Taille unique'],
    'une seule taille — ce sont les FACES qui portent le travail');

  // Aucune famille en double : la migration ajoute, elle ne duplique pas.
  const noms = (table.familles || []).map((f) => f.nom);
  assert.strictEqual(new Set(noms).size, noms.length, 'aucune famille en double');

  // ET LA CONSIGNE ARRIVE JUSQU'À LA FICHE DE PRODUCTION. C'est le trajet
  // complet : le serveur filtrait `face && mm`, donc les trois faces d'une
  // tasse — qui n'ont pas de millimètres — n'entraient même pas en base.
  const creee = await fetch(`${base}/api/comptoir/projet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'Demande de devis', ref: 'TEST-FACES', client: 'Coco Beach',
      name: 'Tasses', responsible: 'Mélina', stage: 'demande',
      status: 'Demande reçue', due: '2026-09-04', quantity: 24,
      articles: [{
        label: 'Tasses personnalisées', qty: 24, detail: '',
        prod: {
          ref: '', couleur: 'Blanc', marquage: 'UV', encre: '', tailles: [],
          logos: [
            { face: 'Face avant', mm: '', quoi: 'Logo Coco Beach' },
            { face: 'Fond', mm: '', quoi: 'Logo OLDA' },
          ],
        },
      }],
    }),
  }).then((r) => r.json());
  assert.ok(creee.id, 'le dossier est créé');

  const dossier = await fetch(`${base}/api/requests/${creee.id}`).then((r) => r.json());
  const fiche = typeof dossier.fiche === 'string' ? JSON.parse(dossier.fiche) : dossier.fiche;
  assert.deepStrictEqual((fiche.prod.logos || []).map((z) => [z.face, z.quoi]),
    [['Face avant', 'Logo Coco Beach'], ['Fond', 'Logo OLDA']],
    'les faces sans millimètre atteignent la base AVEC leur consigne');

  // -------------------------------------------------------------------------
  // LE COUTEAU : DEUX FACES SUR LE MANCHE, DÉCLARÉES SUR L'ARTICLE
  // -------------------------------------------------------------------------
  // « Art de la table » porte quatorze objets qui ne se gravent pas au même
  // endroit : un couteau sur son manche, une planche sur sa surface. Les faces
  // se déclarent donc sur la DÉSIGNATION, et la famille ne sert que de repli —
  // comme pour la tasse, dont la famille EST l'article.
  assert.match(DB, /const COUTEAU_FAMILLE = 'Couteau Multi';/);
  assert.match(DB, /const COUTEAU_FACES = \['Manche — face 1', 'Manche — face 2'\];/);
  assert.match(DB, /SELECT 1 FROM app_meta WHERE key = 'faces_couteau'/,
    'sa PROPRE garde : deux incidents réels sont venus d’une garde partagée');
  assert.match(DB, /await semerFacesCouteau\(\);/, 'et elle est jouée au démarrage');
  assert.match(DB, /Down : retirer la famille « Couteau Multi »/,
    'toute migration porte son down');

  // La table le rend vraiment, avec ses deux faces et rien d'autre.
  const tableLogos = await fetch(`${base}/api/tailles-logo`).then((r) => r.json());
  const couteau = (tableLogos.familles || []).find((f) => f.nom === 'Couteau Multi');
  assert.ok(couteau, 'la famille « Couteau Multi » doit exister dans app_meta.tailles_logo');
  assert.deepStrictEqual(couteau.faces, ['Manche — face 1', 'Manche — face 2']);

  // LA RECHERCHE SUIT L'ARTICLE PUIS LA FAMILLE. Un couteau ajouté depuis le
  // catalogue arrive avec `category: 'Art de la table'` : sans cette cascade,
  // il n'aurait jamais ses faces.
  const PAGE = ecran('demande-devis');
  assert.match(PAGE, /const parArticle=facesDeclarees\(label\);\s*\n\s*if\(parArticle\.length\)return parArticle;\s*\n\s*const parFamille=facesDeclarees\(cat\);/,
    'la désignation d’abord, la catégorie ensuite');
  // ET LE REPLI EN DERNIER (29/08) : la cascade a un troisième cran, la famille
  // « Par défaut ». Il ne prend jamais la main sur une famille qui déclare —
  // c'est ce que l'ordre des trois lignes ci-dessus garantit.
  assert.match(PAGE, /if\(parFamille\.length\)return parFamille;\s*\n\s*if\(!txLogoCle\(cat\)&&!txLogoCle\(label\)\)return\[\];\s*\n\s*return facesDeclarees\(FACES_REPLI\);/,
    'le repli passe APRÈS l’article et la famille, et jamais sur un écran vierge');
  assert.match(PAGE, /zones:zonesDuBesoin\(category,\$\('needLabel'\)\.value\.trim\(\)\)/,
    'et le besoin enregistré passe bien la désignation');
  assert.match(PAGE, /l\.addEventListener\('input',\(\)=>renderNeedFaces\(\)\)/,
    'écrire la désignation ouvre la boîte des faces sans attendre');

  console.log('✓ faces d’article : la famille déclare, la vendeuse écrit, l’atelier lit');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
