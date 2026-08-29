'use strict';

// UNE FACE PAR DÉFAUT — parce que 63 lignes du catalogue sur 82 n'en avaient
// AUCUNE (29/08/2026)
// ===========================================================================
// Les faces d'un article viennent de la FAMILLE déclarée dans Réglages →
// Tailles de logo, et le comptoir les rend telles quelles. Le mécanisme est
// bon ; le tableau, lui, n'était pas rempli. Mesuré ce jour-là :
//
//   · 82 lignes vendables au catalogue, 63 sans aucune face (42 articles) ;
//   · 8 familles au catalogue, UNE SEULE en déclarait — la tasse ;
//   · 17 catégories dans la saisie hors catalogue, DEUX en ramenaient
//     (« Casquette » et « Tasse céramique 350 ml »).
//
// Pour tout le reste, la boîte « Ce qu'on marque » ne s'ouvrait pas : la
// vendeuse décrivait les zones dans le pavé « Informations importantes » et
// l'atelier lisait un paragraphe au lieu d'une carte — exactement ce que les
// faces devaient supprimer.
//
// LE REPLI EST UNE DONNÉE. C'est la famille « Par défaut » du tableau, une
// ligne comme les autres : la vider rend le comportement d'avant, y ajouter une
// face la donne à tout le catalogue, et une famille créée demain marche demain
// sans revenir dans le code. Ce fichier tient les quatre choses qui casseraient
// en silence :
//
//   1. le repli passe APRÈS l'article et la famille — jamais devant ;
//   2. il ne s'ouvre pas sur un écran vierge (rien choisi = rien affiché) ;
//   3. la migration a sa PROPRE garde `app_meta`, et son `down` ;
//   4. la couverture du catalogue est CHIFFRÉE ici : le jour où une famille
//      déclare enfin ses faces, ce test le dit au lieu de laisser le nombre
//      dériver en silence.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8');
const DB = lire('db.js');
const PAGE = lire('public/comptoir/demande-devis.html');
const SEED = JSON.parse(lire('tailles-logo-seed.json'));

const NOM_REPLI = 'Par défaut';
const FACE_REPLI = 'Face à marquer';

// ---------------------------------------------------------------------------
// 1. LA MIGRATION : SA PROPRE GARDE, SON PROPRE DOWN
// ---------------------------------------------------------------------------
// Règle du dépôt : chaque migration porte SA garde `app_meta`. Deux incidents
// réels sont venus d'une garde partagée — la seconde migration se croyait déjà
// jouée parce que la première l'était.
assert.match(DB, /async function semerFaceDefaut\(\)/, 'la migration existe');
assert.match(DB, /SELECT 1 FROM app_meta WHERE key = 'faces_defaut'/,
  'sa PROPRE garde, pas celle de la tasse ni du couteau');
assert.match(DB, /await poserMeta\('faces_defaut', '1'\);/, 'et elle la pose après coup');
assert.match(DB, /Down : DELETE FROM app_meta WHERE key = 'faces_defaut';/,
  'toute migration porte son down');
assert.match(DB, /await semerFaceDefaut\(\);/, 'elle est jouée au démarrage');
// L'ordre compte : l'instantané pose la table, les semis la complètent.
assert.ok(DB.indexOf('await semerTaillesLogo();') < DB.indexOf('await semerFaceDefaut();'),
  'le repli se sème APRÈS l’instantané, jamais avant');

// Trois gardes distinctes, jamais deux fois la même clé.
const gardes = [...DB.matchAll(/SELECT 1 FROM app_meta WHERE key = '(faces_[a-z]+)'/g)].map((m) => m[1]);
assert.deepStrictEqual([...new Set(gardes)].sort(), ['faces_couteau', 'faces_defaut', 'faces_tasse'],
  'chaque semis de faces a sa clé à lui');

// ---------------------------------------------------------------------------
// 2. L'INSTANTANÉ AUSSI — une base NEUVE ne passe pas par la migration
// ---------------------------------------------------------------------------
// `semerTaillesLogo` ne parle qu'à une base sans clé `tailles_logo`. En
// production la clé existe depuis le 26/08 : c'est la migration qui y travaille.
// En local, sur une base neuve, c'est l'instantané. Il faut les deux.
const replSeed = SEED.familles.find((f) => f.nom === NOM_REPLI);
assert.ok(replSeed, 'la famille de repli est dans l’instantané, pour les bases neuves');
assert.deepStrictEqual(replSeed.faces, [FACE_REPLI], 'UNE face : de quoi écrire une consigne');
assert.deepStrictEqual(replSeed.tailles, ['Taille unique'],
  'aucune taille à retenir — la cote se prend à l’établi');
assert.deepStrictEqual(replSeed.refs, {}, 'et aucune référence : ce n’est pas un produit');

// ---------------------------------------------------------------------------
// 3. LA CASCADE : ARTICLE, PUIS FAMILLE, PUIS REPLI — ET RIEN SUR UN ÉCRAN VIERGE
// ---------------------------------------------------------------------------
// On rejoue la vraie fonction de l'écran, pas une copie : une copie diverge le
// jour où l'écran change, et c'est le test qui se met à mentir.
const debut = PAGE.indexOf('function txLogoCle(');
assert.ok(debut > 0, 'txLogoCle se lit dans l’écran');
const source = [
  PAGE.slice(debut, PAGE.indexOf('function txLogoIndexer(')),
  PAGE.slice(PAGE.indexOf('function facesDeclarees('), PAGE.indexOf('function renderNeedFaces(')),
].join('\n');
const bac = vm.createContext({ TX_LOGO: null });
vm.runInContext(`${source}\nglobalThis.facesDeLaCategorie = facesDeLaCategorie;`, bac);

const poserTable = (familles) => { bac.TX_LOGO = { familles }; };
// LE TABLEAU REVIENT D'UN AUTRE REALM. Un `[]` construit dans le bac à sable
// n'a pas le même `Array.prototype` que celui du test : `deepStrictEqual` compare
// les prototypes et refuse deux tableaux vides pourtant identiques. On recopie.
const faces = (cat, label) => [...bac.facesDeLaCategorie(cat, label)];

poserTable([
  { nom: 'Tasse céramique 350 ml', faces: ['Face avant', 'Face arrière', 'Fond'] },
  { nom: 'Couteau Multi', faces: ['Manche — face 1', 'Manche — face 2'] },
  { nom: 'Casquettes', faces: ['Avant'] },
  { nom: NOM_REPLI, faces: [FACE_REPLI] },
]);

// L'article passe devant sa famille : un couteau et une planche à découper
// vivent tous deux dans « Art de la table » et ne se gravent pas au même endroit.
assert.deepStrictEqual(faces('Art de la table', 'Couteau Multi'),
  ['Manche — face 1', 'Manche — face 2'], 'la désignation d’abord');
// La famille ensuite — et le pluriel ne fait pas rater la ligne.
assert.deepStrictEqual(faces('Casquette', 'Casquette 5 panneaux'), ['Avant'],
  'la famille ensuite, pluriel toléré');
// Le repli en dernier, et seulement là.
assert.deepStrictEqual(faces('Art de la table', 'Planche à découper Aulne'), [FACE_REPLI],
  'ce que personne ne déclare retombe sur la face de repli');
assert.deepStrictEqual(faces('Papeterie', ''), [FACE_REPLI],
  'une catégorie seule suffit à ouvrir la boîte');
assert.deepStrictEqual(faces('', 'Gourde inox'), [FACE_REPLI],
  'une désignation seule aussi — la vendeuse tape souvent avant de choisir');

// RIEN CHOISI, RIEN AFFICHÉ. Sans cette garde, la boîte s'ouvrirait à
// l'ouverture de l'écran, avant même qu'on ait dit de quel article on parle.
assert.deepStrictEqual(faces('', ''), [], 'écran vierge : pas de boîte');
assert.deepStrictEqual(faces(null, undefined), [], 'et pas davantage sans valeur du tout');

// VIDER LE REPLI REND EXACTEMENT LE COMPORTEMENT D'AVANT. C'est ce qui fait que
// la décision reste celle de l'atelier, dans son écran, et pas celle du code.
poserTable([{ nom: 'Casquettes', faces: ['Avant'] }, { nom: NOM_REPLI, faces: [] }]);
assert.deepStrictEqual(faces('Papeterie', 'Carnet A5'), [],
  'repli vidé : l’écran d’avant, au pixel près');
assert.deepStrictEqual(faces('Casquette', ''), ['Avant'],
  'et les familles déclarées continuent de marcher');
poserTable([{ nom: 'Casquettes', faces: ['Avant'] }]);
assert.deepStrictEqual(faces('Papeterie', 'Carnet A5'), [],
  'repli absent du tableau : pas d’erreur, pas de boîte');

// ---------------------------------------------------------------------------
// 4. CE QUE ÇA COUVRE, EN NOMBRE
// ---------------------------------------------------------------------------
// Les chiffres du 29/08, pris sur le vrai catalogue. Ils sont ici pour qu'une
// famille qui déclare enfin ses faces le DISE, au lieu de laisser le compte
// dériver sans que personne ne le voie.
const catalogue = vm.createContext({ window: {} });
vm.runInContext(lire('public/comptoir/catalogue.js'), catalogue);
const groupes = catalogue.window.lignesCatalogue();
const lignes = groupes.flatMap((g) => g.lignes.map((l) => ({ famille: g.famille, label: l.label })));

poserTable([
  { nom: 'Tasse céramique 350 ml', faces: ['Face avant', 'Face arrière', 'Fond'] },
  { nom: 'Couteau Multi', faces: ['Manche — face 1', 'Manche — face 2'] },
  { nom: NOM_REPLI, faces: [FACE_REPLI] },
]);

assert.strictEqual(lignes.length, 82, 'le catalogue compte 82 lignes vendables');
const sansFace = lignes.filter((l) => !faces(l.famille, l.label).length);
assert.strictEqual(sansFace.length, 0,
  `PLUS AUCUNE ligne du catalogue sans face (${sansFace.length} restantes)`);

// Combien sont couvertes PAR LE REPLI, et non par leur propre famille : c'est
// la dette de remplissage du tableau, et elle doit baisser, jamais monter.
const parLeRepli = lignes.filter((l) => {
  const f = faces(l.famille, l.label);
  return f.length === 1 && f[0] === FACE_REPLI;
});
assert.strictEqual(parLeRepli.length, 63,
  `63 lignes tenaient au seul repli le 29/08 ; il y en a ${parLeRepli.length}. `
  + 'Si le nombre a BAISSÉ, une famille a été remplie — corrigez-le ici. '
  + 'S’il a MONTÉ, une famille a perdu ses faces.');

// Les 17 catégories de la saisie hors catalogue : toutes ouvrent une boîte.
const categories = [...PAGE.matchAll(/<option>([^<]+)<\/option>/g)].map((m) => m[1]);
const CATS = categories.slice(0, categories.indexOf('Tasse céramique 350 ml') + 1);
assert.strictEqual(CATS.length, 17, `les 17 catégories du menu (${CATS.length} lues)`);
for (const c of CATS) {
  assert.ok(faces(c, '').length >= 1, `la catégorie « ${c} » doit ouvrir une boîte`);
}

// ---------------------------------------------------------------------------
// 5. LE CHEMIN QUI COMPTE : UNE BASE QUI EXISTE DÉJÀ
// ---------------------------------------------------------------------------
// En local, la base est neuve à chaque démarrage : c'est l'INSTANTANÉ qui pose
// la famille, et tout paraît bon. En production la clé `tailles_logo` existe
// depuis le 26/08 — l'instantané n'y repassera plus JAMAIS, et sans migration
// l'écran de la vendeuse n'aurait toujours aucune face. C'est exactement le
// piège qui a coûté une migration à la tasse.
//
// On rejoue donc la vraie situation de l'atelier : une table déjà en place, à
// laquelle il manque la famille — et on vérifie que `init()` l'y remet.
(async () => {
  const db = require('../db');
  await db.init();

  // On défait ce que l'instantané vient de faire : la table reste, la famille
  // et la garde partent. C'est l'état de la production ce matin.
  const table = await db.getTaillesLogo();
  table.familles = table.familles.filter((f) => f.nom !== NOM_REPLI);
  await db.pool.query("UPDATE app_meta SET value = $1 WHERE key = 'tailles_logo'",
    [JSON.stringify(table)]);
  await db.pool.query("DELETE FROM app_meta WHERE key = 'faces_defaut'");

  const avant = await db.getTaillesLogo();
  assert.ok(!avant.familles.some((f) => f.nom === NOM_REPLI),
    'départ : la table existe et n’a pas la famille de repli');

  // On rejoue la MIGRATION SEULE, pas `init()` : pg-mem ne relit pas
  // `schema.sql` une deuxième fois (il refuse l'AST d'un CREATE TABLE déjà
  // joué). C'est une limite de la base locale, pas de l'application.
  await db.semerFaceDefaut();

  const apres = await db.getTaillesLogo();
  const repli = apres.familles.find((f) => f.nom === NOM_REPLI);
  assert.ok(repli, 'la migration pose la famille sur une base DÉJÀ REMPLIE');
  assert.deepStrictEqual(repli.faces, [FACE_REPLI], 'avec sa face, et une seule');

  // Et elle ne repasse pas : un troisième démarrage ne doit rien dupliquer.
  await db.semerFaceDefaut();
  const encore = await db.getTaillesLogo();
  assert.strictEqual(encore.familles.filter((f) => f.nom === NOM_REPLI).length, 1,
    'la garde tient : aucune famille en double au redémarrage suivant');

console.log('✓ face par défaut : plus une ligne du catalogue sans zone à écrire (63 tenues par le repli)');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
