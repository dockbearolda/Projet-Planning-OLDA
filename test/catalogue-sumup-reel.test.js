'use strict';

// ===========================================================================
// LE FICHIER DE CAISSE RÉEL CONTRE LE CATALOGUE RÉEL — et rien en double
// ===========================================================================
// Le 02/09/2026, le fichier SumUp du patron (export du 26/08) a été importé en
// production SANS table de correspondance : 113 produits créés, dont une
// quarantaine étaient DÉJÀ au catalogue sous un autre rayon, et les t-shirts
// finis de la boutique posés à côté des références du moteur textile. Le devis
// flash montrait le même t-shirt dans deux onglets, à deux prix (33,65 € HT en
// « Boutique », 12,20 € HT en « Textile »), et « Couteau Multi » trois fois.
//
// Ce test rejoue l'import du FICHIER RÉEL, avec les RÈGLES LIVRÉES, sur la
// SEMENCE RÉELLE — pas un extrait de trois lignes. C'est la seule façon de voir
// un doublon : chaque ligne du fichier, prise seule, avait l'air juste.
//
// Puis il éprouve la migration qui range la production : une base qui porte
// l'import du 02/09 tel qu'il a été fait doit ressortir IDENTIQUE à une base
// neuve — mêmes produits, mêmes prix, aucun rayon de caisse.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { analyserImport, cleProduit, reduire } = require('../catalogue-csv');

const RACINE = path.join(__dirname, '..');
const lireJson = (f) => JSON.parse(fs.readFileSync(path.join(RACINE, f), 'utf8'));
const SEMENCE = lireJson('catalogue-produits-seed.json');
const TEXTILE = lireJson('catalogue-textile-seed.json');
const REGLES = lireJson('catalogue-import-regles.json');
const CSV = fs.readFileSync(path.join(RACINE, 'catalogue-sumup-2026-08-26.csv'), 'utf8');

// La forme que `getCatalogueProduits` rend, reconstruite depuis les semences.
const enBase = (liste) => liste.map((p, i) => ({
  id: `s${i}`,
  famille: p.famille,
  designation: p.designation,
  variante: p.variante || '',
  reference: p.reference || '',
  prixAchat: p.prixAchat == null ? null : p.prixAchat,
  prixVenteTtc: p.prixVenteTtc == null ? null : p.prixVenteTtc,
  tempsMoMin: null,
  tempsMachineMin: null,
  actif: true,
}));

// Le catalogue APRÈS un plan : les créations ajoutées, les mises à jour posées.
function appliquer(existants, plan) {
  const apres = existants.map((p) => ({ ...p }));
  for (const m of plan.majs) {
    const p = apres.find((x) => x.id === m.id);
    for (const c of m.changements) p[c.champ] = c.apres;
  }
  for (const c of plan.creations) apres.push({ ...c, id: `c${apres.length}` });
  return apres;
}
const cle = (p) => cleProduit(p.famille, p.designation, p.variante);
const trouver = (liste, famille, designation, variante = '') => liste
  .find((p) => cle(p) === cleProduit(famille, designation, variante));

// LES RAYONS TELS QUE LA CAISSE LES ÉCRIT — aucun ne doit survivre au menu.
const RAYONS_DE_CAISSE = ['0 UNISEXE', '01 FEMME', '2 FEMME', '3 FEMME', '4 FEMME', '5 FEMME',
  '6 FEMME', '02 ENFANT', 'Accessoires', 'Offres Spéciales', 'Jeux', 'Planches',
  'Art de la Table', 'Textile — Femme'];

// ===========================================================================
// 1. L'ANALYSE PURE — le fichier réel sur la semence réelle
// ===========================================================================
const depart = enBase([...SEMENCE, ...TEXTILE]);
const rap = analyserImport(CSV, depart, REGLES);
assert.ok(!rap.erreur, `le fichier de caisse doit se lire : ${rap.erreur}`);
assert.strictEqual(rap.resume.lues, 255, 'les 255 lignes de l’export du 26/08');

// 1.1 Aucun rayon de caisse ne survit : ils sont rangés, pas recopiés.
for (const c of rap.plan.creations) {
  assert.ok(!RAYONS_DE_CAISSE.includes(c.famille),
    `« ${c.famille} / ${c.designation} » entre sous un rayon de caisse — il manque une règle`);
}

// 1.2 Aucune création ne double un produit de la semence. Deux produits de
// même désignation (et même variante) dans deux rayons, c'est le couteau à
// trois exemplaires du 02/09.
const dejaLa = new Map();
for (const p of depart) dejaLa.set(`${reduire(p.designation)}|${reduire(p.variante)}`, p);
for (const c of rap.plan.creations) {
  const k = `${reduire(c.designation)}|${reduire(c.variante)}`;
  if (dejaLa.has(k)) {
    assert.fail(`« ${c.famille} / ${c.designation}${c.variante ? ` / ${c.variante}` : ''} » double `
      + `« ${dejaLa.get(k).famille} / ${dejaLa.get(k).designation} » de la semence`);
  }
}
// … ni deux fois le même objet à l'intérieur du fichier.
const clesCreees = rap.plan.creations.map(cle);
assert.strictEqual(new Set(clesCreees).size, clesCreees.length, 'deux créations ne partagent pas une clé');

const apres = appliquer(depart, rap.plan);

// 1.3 Les correspondances nommées : la ligne du fichier retombe sur le produit
// du comptoir, et son prix vaut pour toutes les variantes de celui-ci.
const attendus = [
  // [famille, designation, variante, prix TTC attendu]
  ['Art de la table', 'Couteau Multi', 'Bois', 14],
  ['Art de la table', 'Couteau Multi', 'Liège', 14],
  ['Art de la table', 'Flasque Bois', 'Clair', 19],
  ['Art de la table', 'Flasque Bois', 'Foncé', 19],
  ['Art de la table', 'Limonadier Bois', 'Clair', 12],
  ['Art de la table', 'Limonadier Bois', 'Foncé', 12],
  ['Art de la table', 'Dessous de verre Liège', '', 4.5],
  ['Art de la table', 'Dessous de verre Liège', '2 pièces', 15],
  ['Art de la table', 'Dessous de verre Liège', '6 pièces', 19],
  ['Art de la table', 'Plateau Liège', '', 29],
  ['Art de la table', 'Décapsuleur Bois', '', 6],
  ['Art de la table', 'Planche à découper Aulne', 'Petite', 19],
  ['Du quotidien', 'Miroir Liège', 'XL', 14],
  ['Du quotidien', 'Miroir Liège', 'Petit', 11],
  ['Du quotidien', 'Pince à billet', 'Argent', 8],
  ['Du quotidien', 'Pince à billet', 'Or', 8],
  ['Du quotidien', 'Porte sac', '', 9],
  ['Du quotidien', 'Cendrier Liège', '', 8],
  ['Du quotidien', 'Porte Carte Liège', '', 12],
  ['Du quotidien', 'Porte Monnaie Liège', '', 9],
  ['Du quotidien', 'Boite à bijoux en bois', '', 9],
  ['Du quotidien', 'Bracelet', 'Bois', 19],
  ['Du quotidien', 'Bracelet', 'Acrylique', 15],
  ['Voyage', 'Identificateur Valise Cuir PU', 'Bleu Brume', 9],
  ['Voyage', 'Identificateur Valise Cuir PU', 'Rose', 9],
  ['Voyage', 'Identificateur Valise Liège', '', 9],
  ['Voyage', 'Identificateur Valise Métal', '', 9],
  ['Gourdes', 'Gourde 800 ml Métal', 'Blanc', 29],
  ['Gourdes', 'Gourde 800 ml Métal', 'Noir', 29],
  ['Gourdes', 'Gourde 800 ml Métal', 'Inox', 29],
  ['Jeux & loisirs', 'Dominos', '', 15],
  ['Jeux & loisirs', 'Raquette Bois', '', 29],
  ['Porte-clés', 'Porte-clés', 'Acrylique', 7],
  ['Porte-clés', 'Porte-clés', 'Bois', 7],
  ['Porte-clés', 'Porte-clés', 'Plexiglass', 5],
  ['Goodies', 'Magnet', 'Plexi', 5],
  ['Goodies', 'Magnet', 'Friendly Books', 9],
  ['Goodies', 'Sticker', '', 4],
  ['Verre', 'Verre à Ti Punch', '', 12],
  ['Tasses', 'Tasse Fuck', '', 18],
  ['Mug', 'Mug Iso 300 ml', '', 18],
  ['Sacs', 'S 004 Tote Bag Classic', '', 14],
  ['Papeterie', 'Carte Postale', 'Petite', 2.5],
  ['Papeterie', 'Affiche A4', '', 39],
  // LES VÊTEMENTS FINIS DE LA BOUTIQUE : un rayon qui a un nom, et le prix magasin.
  ['Vêtements — Unisexe', 'H001 T-shirt Léger Premium 155 gr', '', 35],
  ['Vêtements — Femme', 'F001 Débardeur Crop Top', '', 39],
  ['Vêtements — Femme', 'F003 T-shirt Léger Premium', '', 35],
  ['Vêtements — Enfant', 'B001 Body Manches Longues', '', 29],
];
for (const [famille, designation, variante, prix] of attendus) {
  const p = trouver(apres, famille, designation, variante);
  assert.ok(p, `« ${famille} / ${designation}${variante ? ` / ${variante}` : ''} » doit être au catalogue`);
  assert.strictEqual(p.prixVenteTtc, prix,
    `« ${designation}${variante ? ` / ${variante}` : ''} » vaut ${prix} € au fichier de caisse`);
}
// Et pas de résidu : ni le couteau de caisse, ni la gourde sans « Métal », ni la
// planche « Petite planche… », ni le « Plateau en Liège », ni « Dessous Verre ».
for (const [famille, designation] of [
  ['Du quotidien', 'Couteau Multi'], ['Du quotidien', 'Flasque Bois'], ['Du quotidien', 'Grand Miroir Liège'],
  ['Du quotidien', 'Identificateur Valise'], ['Gourdes', 'Gourde 800 ml'],
  ['Art de la table', 'Petite planche à découper Aulne'], ['Art de la table', 'Plateau en Liège'],
  ['Art de la table', 'Dessous Verre'], ['Du quotidien', 'Décapsuleur Bois'], ['Goodies', 'Porte-clés'],
]) {
  assert.ok(!apres.some((p) => reduire(p.famille) === reduire(famille) && reduire(p.designation) === reduire(designation)),
    `« ${famille} / ${designation} » ne doit pas exister : c'est un doublon rangé par les règles`);
}
// La casse du rayon ne fait pas un second rayon.
assert.ok(!apres.some((p) => p.famille === 'Art de la Table'), '« Art de la Table » s’écrit comme le comptoir');

// 1.4 LE TEXTILE DU MOTEUR NE BOUGE PAS : ni prix, ni ligne de plus.
for (const m of rap.plan.majs) {
  const p = depart.find((x) => x.id === m.id);
  assert.notStrictEqual(p.famille, 'Textile', `le fichier de caisse ne touche pas « ${p.designation} » (moteur)`);
}
assert.ok(!rap.plan.creations.some((c) => c.famille === 'Textile'), 'rien n’entre dans le rayon du moteur');
assert.strictEqual(apres.filter((p) => p.famille === 'Textile').length, TEXTILE.length);
assert.strictEqual(apres.find((p) => p.reference === 'NS300').prixVenteTtc, null,
  'NS300 se chiffre, il n’a pas de prix de rayon');

// 1.5 Ce qui reste dehors est nommé : les cinq « Armelle B » sans variante, et
// les répétitions Grand/Petit des livres. Rien d'autre.
const refus = rap.lignes.filter((l) => l.action === 'refus');
assert.strictEqual(refus.length, 7, `sept refus attendus, ${refus.length} trouvés : ${refus.map((l) => l.designation).join(', ')}`);
assert.ok(refus.every((l) => /Armelle B|Friendly Books/.test(l.designation)),
  'seuls Armelle B et les répétitions des livres restent refusés');
// Le verre à Ti Punch à 12 € entre ; celui à 14 € est écarté avec sa raison.
const tiPunch = rap.lignes.filter((l) => l.designation === 'Verre à Ti Punch' && l.prixVenteTtc != null);
assert.deepStrictEqual(tiPunch.map((l) => [l.prixVenteTtc, l.action]).sort(), [[12, 'creation'], [14, 'ecartee']]);
// Les trois tasses de la grille, l'express, la perso : écartés, pas refusés.
assert.ok(rap.lignes.filter((l) => l.action === 'ecartee').length >= 20);

// 1.6 Le rapport DIT ce que les règles ont fait.
const couteau = rap.lignes.find((l) => l.designation === 'Couteau Multi' && l.prixVenteTtc != null);
assert.strictEqual(couteau.rangeDepuis, 'Accessoires', 'la ligne dit d’où elle vient');
assert.strictEqual(couteau.famille, 'Art de la table');
assert.strictEqual(couteau.action, 'inchangee', 'le couteau valait déjà 14 € sur ses deux variantes');
const gourde = rap.lignes.find((l) => l.designation === 'Gourde 800 ml Métal' && l.prixVenteTtc != null);
assert.strictEqual(gourde.renommeDepuis, 'Gourde 800 ml', 'et sous quel nom le fichier l’écrivait');

// 1.7 Rejoué sur son propre résultat, le fichier ne crée plus rien.
const rejoue = analyserImport(CSV, apres, REGLES);
assert.strictEqual(rejoue.resume.creees, 0, 'le même fichier deux fois de suite ne crée rien la seconde');
assert.strictEqual(rejoue.resume.majs, 0);

console.log(`✓ fichier de caisse réel : ${rap.resume.creees} produits créés sous des rayons qui ont un nom, `
  + `${rap.resume.majs} mis à jour, ${rap.resume.inchangees} déjà justes, aucun doublon`);

// ===========================================================================
// 2. LA MIGRATION RANGE LA PRODUCTION
// ===========================================================================
// Une base neuve reçoit la semence, le textile, puis le fichier de caisse par
// les MÊMES règles ; une base qui porte l'import du 02/09 tel qu'il a été fait
// doit ressortir identique.
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
  const etat = (liste) => liste.map((p) => `${cle(p)}=${p.prixVenteTtc == null ? '' : p.prixVenteTtc}`).sort();

  // 2.1 Une base neuve est déjà rangée : c'est le résultat de l'analyse au-dessus.
  const neuve = (await call('GET', '/api/catalogue-produits')).body;
  assert.deepStrictEqual(etat(neuve), etat(apres),
    'au démarrage, la base porte la semence, le textile et le fichier de caisse rangé');
  assert.ok(!neuve.some((p) => RAYONS_DE_CAISSE.includes(p.famille)));
  const h001 = neuve.find((p) => p.designation === 'H001 T-shirt Léger Premium 155 gr');
  assert.strictEqual(h001.famille, 'Vêtements — Unisexe');
  assert.strictEqual(h001.prixVenteTtc, 35);

  // 2.2 On refait l'état de la production du 02/09 : les règles d'alors — sans
  // correspondance de produits, « FEMME » vers « Textile — Femme », et le dessous
  // de verre à 4,50 nommé « 1 pièce » — appliquées à la semence.
  const REGLES_0209 = {
    ecartes: REGLES.ecartes.filter((e) => !['Grand Bloc Note A5', 'Petit Bloc Note A6', 'Verre à Ti Punch']
      .includes(e.designation)),
    familles: ['01 FEMME', '2 FEMME', '3 FEMME', '4 FEMME', '5 FEMME', '6 FEMME']
      .map((de) => ({ de, vers: 'Textile — Femme' })),
    variantes: [...REGLES.variantes,
      { famille: 'Art de la Table', designation: 'Dessous Verre', prix: 4.5, variante: '1 pièce' }],
  };
  const dAlors = analyserImport(CSV, depart, REGLES_0209);
  assert.strictEqual(dAlors.resume.creees, 113, 'l’import du 02/09 avait créé 113 produits');
  const clesNeuve = new Set(neuve.map(cle));
  const residus = dAlors.plan.creations.filter((c) => !clesNeuve.has(cle(c)));
  assert.ok(residus.length >= 40, `au moins quarante doublons ou rayons de caisse à ranger (${residus.length})`);
  await call('PUT', '/api/catalogue-produits', [...neuve, ...residus]);
  const sale = (await call('GET', '/api/catalogue-produits')).body;
  assert.strictEqual(sale.length, neuve.length + residus.length);
  assert.ok(sale.some((p) => p.famille === '0 UNISEXE'), 'la base porte bien le rayon « 0 UNISEXE »');
  assert.ok(sale.some((p) => p.famille === 'Textile — Femme'));
  assert.strictEqual(sale.filter((p) => reduire(p.designation) === 'couteau multi').length, 3,
    'le couteau est bien en trois exemplaires, comme en prod');

  // 2.3 La migration rejoue : la garde tombe, elle range.
  await db.pool.query("DELETE FROM app_meta WHERE key = 'catalogue_sumup_2026_08_26_v1'");
  await db.rangerCatalogueSumup();
  const rangee = (await call('GET', '/api/catalogue-produits')).body;
  assert.deepStrictEqual(etat(rangee), etat(neuve),
    'la base rangée est IDENTIQUE à une base neuve — mêmes produits, mêmes prix');
  assert.strictEqual(rangee.filter((p) => reduire(p.designation) === 'couteau multi').length, 2);

  // 2.4 Elle ne repasse pas, et elle ne touche pas à ce que le patron a ajouté.
  await call('PUT', '/api/catalogue-produits', [...rangee,
    { famille: 'Du quotidien', designation: 'Objet ajouté à la main', variante: '', prixVenteTtc: 12 }]);
  await db.rangerCatalogueSumup();
  const encore = (await call('GET', '/api/catalogue-produits')).body;
  assert.strictEqual(encore.length, rangee.length + 1, 'la garde tient : rien ne bouge au redémarrage suivant');
  await db.pool.query("DELETE FROM app_meta WHERE key = 'catalogue_sumup_2026_08_26_v1'");
  await db.rangerCatalogueSumup();
  const relancee = (await call('GET', '/api/catalogue-produits')).body;
  assert.ok(relancee.some((p) => p.designation === 'Objet ajouté à la main'),
    'un produit posé à la main n’est pas un résidu d’import : la migration ne le retire pas');
  assert.strictEqual(relancee.length, rangee.length + 1);

  console.log('✓ migration : une base du 02/09 ressort comme une base neuve, et un ajout manuel survit');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
