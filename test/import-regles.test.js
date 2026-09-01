'use strict';

// LES RÈGLES D'IMPORT — ce que le fichier ne dit pas, et qu'on ne devine pas
// ===========================================================================
// L'export SumUp ne nomme JAMAIS ses variantes : il répète la ligne du produit
// une fois par variante, la première SANS prix, et rien ne distingue les
// suivantes que leur montant. Et ses rayons ne sont pas ceux du comptoir : le
// « Décapsuleur Bois » est chez lui dans « Offres Spéciales » à 6 €, et au
// catalogue OLDA dans « Art de la table » sans prix.
//
// Ces deux écarts se comblent par des DONNÉES (`catalogue-import-regles.json`),
// pas par du code : un rayon qui change ne doit pas demander un déploiement.
//
// CE FICHIER GARDE :
//
//   1. UN RAYON ÉCARTÉ N'EST PAS UN REFUS. « Express » est un réglage,
//      « Perso » une grille de travail graphique : ce sont des DÉCISIONS, et
//      elles se comptent à part. Confondre les deux ferait lire « 64 refusées »
//      là où il y a onze problèmes et cinquante-trois choix.
//   2. UNE VARIANTE SE NOMME PAR SON PRIX — le seul repère que l'export laisse.
//      Une variante déjà écrite dans le fichier gagne toujours sur la règle.
//   3. NOMMER UNE VARIANTE COUPE LE PRODUIT EN DEUX, et c'est le piège. Tant
//      qu'aucune ligne n'était nommée, la ligne d'ouverture (sans prix) se
//      fondait avec les autres. Dès qu'une règle nomme les lignes tarifées,
//      elle reste seule — et fabrique un PRODUIT FANTÔME sans variante et sans
//      prix, posé au menu du comptoir juste à côté de ses propres variantes.
//      Elle est donc ABSORBÉE.
//   4. UNE VARIANTE ORPHELINE EST REFUSÉE. Si ses sœurs ont été nommées et pas
//      elle, elle entrerait au menu comme un « Porte-clés » nu à côté d'un
//      « Porte-clés — Classique » : personne ne saurait lequel prendre.
//   5. LE RAYON SE REMAPPE EN DERNIER — les deux règles au-dessus se lisent sur
//      le rayon d'ORIGINE, celui que le patron a sous les yeux.
//   6. LE FICHIER LIVRÉ EST COHÉRENT : pas deux règles pour un même prix.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { analyserImport, preparerRegles, reduire } = require('../catalogue-csv');

const RACINE = path.join(__dirname, '..');

// --- 1. Un rayon écarté n'est pas un refus ---------------------------------

const REGLES = {
  ecartes: [{ famille: 'Express', pourquoi: 'le supplément d’urgence est un réglage' }],
  familles: [{ de: '2 FEMME', vers: 'Textile — Femme' }, { de: '01 FEMME', vers: 'Textile — Femme' }],
  variantes: [
    { famille: 'Goodies', designation: 'Magnet', prix: 5, variante: 'Plexi' },
    { famille: 'Goodies', designation: 'Magnet', prix: 7, variante: 'Classique' },
  ],
};

let rap = analyserImport([
  'Category;Item name;Price',
  'Express;Le jour même (40%);',
  'Express;Sous 24h (25%);',
  'Goodies;Sticker;4',
].join('\n'), [], REGLES);

assert.strictEqual(rap.resume.ecartees, 2, 'les deux lignes « Express » sont écartées');
assert.strictEqual(rap.resume.refusees, 0, '… et ce ne sont PAS des refus');
assert.strictEqual(rap.resume.creees, 1);
const express = rap.lignes.find((l) => l.numero === 2);
assert.strictEqual(express.action, 'ecartee');
assert.match(express.ecarte, /réglage/, 'une ligne écartée dit POURQUOI, comme un refus');

// UN ÉCART PORTE SUR UN RAYON, OU SUR UN SEUL PRODUIT — et le plus précis
// gagne. C'est arrivé avec les tasses : la famille entière n'est pas à écarter,
// mais les trois que la GRILLE DE CHIFFRAGE tarife déjà, si. Vérifié le 01/09 en
// faisant tourner le vrai moteur : tasse nue 10 € + une face 6 € = 16 €, le prix
// magasin au centime, et le logo du client sur l'autre face fait +6 € → 22 €.
// Importer ce 16 € ferait DEUX sources pour un même nombre — et si le catalogue
// servait un jour à chiffrer, le marquage s'ajouterait par-dessus un prix qui le
// contient déjà.
const parProduit = {
  ecartes: [{ famille: 'Tasses', designation: 'Tasse Céramique 350 ml', pourquoi: 'la grille la tarife déjà' }],
};
rap = analyserImport([
  'Category;Item name;Price',
  'Tasses;Tasse Céramique 350 ml;16.00',
  'Tasses;Tasse Fuck;18.00',
].join('\n'), [], parProduit);
assert.strictEqual(rap.resume.ecartees, 1, 'la tasse que la grille tarife est écartée');
assert.strictEqual(rap.resume.creees, 1, '… et le reste du rayon entre normalement');
assert.strictEqual(rap.plan.creations[0].designation, 'Tasse Fuck');

// --- 2. Une variante se nomme par son prix ---------------------------------

rap = analyserImport([
  'Category;Item name;Price',
  'Goodies;Magnet;',
  'Goodies;Magnet;7',
  'Goodies;Magnet;5',
].join('\n'), [], REGLES);

assert.strictEqual(rap.resume.creees, 2, 'deux prix nommés font deux produits');
assert.deepStrictEqual(rap.plan.creations.map((c) => [c.variante, c.prixVenteTtc]),
  [['Classique', 7], ['Plexi', 5]],
  'chaque variante porte SON nom et SON prix — sans la règle, les deux se seraient contredites');
assert.ok(rap.lignes.find((l) => l.numero === 3).varianteNommee,
  'le rapport DIT qu’une règle est passée là : une règle silencieuse ne se relit jamais');

// LA COLONNE DU PATRON PASSE AVANT LA RÈGLE. S'il prend la peine d'écrire la
// variante dans son fichier, c'est elle qui fait foi.
rap = analyserImport([
  'Category;Item name;Variante;Price',
  'Goodies;Magnet;Bois gravé;7',
].join('\n'), [], REGLES);
assert.strictEqual(rap.plan.creations[0].variante, 'Bois gravé');
assert.strictEqual(rap.lignes[0].varianteNommee, false, '… et le rapport ne prétend pas l’avoir nommée');

// --- 2 bis. DEUX VARIANTES AU MÊME PRIX -------------------------------------
// Le prix ne les distingue plus — mais on SAIT qu'il y en a deux, et on sait
// leurs noms. « Magnet acrylique et bois 7 euros », « les porte-clés à 7 euros
// sont les acrylique et bois » (Charlie, 01/09). La règle porte alors une LISTE,
// et chaque ligne de ce prix prend le nom suivant.
{
  const deux = {
    variantes: [
      { famille: 'Goodies', designation: 'Magnet', prix: 5, variante: 'Plexi' },
      { famille: 'Goodies', designation: 'Magnet', prix: 7, variantes: ['Acrylique', 'Bois'] },
    ],
  };
  const r = analyserImport([
    'Category;Item name;Price',
    'Goodies;Magnet;',
    'Goodies;Magnet;7',
    'Goodies;Magnet;5',
    'Goodies;Magnet;7',
  ].join('\n'), [], deux);
  assert.strictEqual(r.resume.creees, 3, 'trois variantes, dont deux au même prix');
  assert.deepStrictEqual(r.plan.creations.map((c) => [c.variante, c.prixVenteTtc]),
    [['Acrylique', 7], ['Plexi', 5], ['Bois', 7]],
    'chaque ligne prend le nom suivant, dans l’ordre où elle se présente');
  assert.strictEqual(r.resume.refusees, 0);

  // ⚠ ON NE RÉUTILISE JAMAIS UN NOM DÉJÀ PRIS. Deux lignes du même nom se
  // FONDENT en un seul produit : une variante disparaîtrait en silence, et le
  // catalogue vendrait trois choses là où il y en a quatre. Une ligne de plus
  // que de noms reste donc SANS NOM, et se fait refuser avec sa raison — c'est
  // exactement ce qu'on veut lire dans l'aperçu avant d'écrire.
  const trop = analyserImport([
    'Category;Item name;Price',
    'Goodies;Magnet;',
    'Goodies;Magnet;7',
    'Goodies;Magnet;7',
    'Goodies;Magnet;7',
  ].join('\n'), [], deux);
  assert.strictEqual(trop.resume.creees, 2, 'deux noms, deux produits — pas trois');
  assert.strictEqual(trop.resume.refusees, 1, 'la troisième ligne à 7 € n’a plus de nom');
  assert.match(trop.lignes.find((l) => l.refus.length).refus[0], /variante inconnue pour 7/);
}

// --- 2 ter. UNE SEULE LIGNE S'ÉCARTE, pas tout le produit -------------------
// « pas de porte-clés à 9 euros » (Charlie, 01/09). Le produit n'est pas à
// écarter — ses autres lignes se vendent — c'est CETTE ligne-là qui ne
// correspond à rien. Sans la portée « prix », il fallait choisir entre perdre
// le produit entier et laisser entrer un tarif qui n'existe pas.
{
  const fine = {
    ecartes: [{ famille: 'Goodies', designation: 'Porte-clés', prix: 9, pourquoi: 'il n’y en a pas à 9 €' }],
    variantes: [
      { famille: 'Goodies', designation: 'Porte-clés', prix: 5, variante: 'Plexiglass' },
      { famille: 'Goodies', designation: 'Porte-clés', prix: 7, variantes: ['Acrylique', 'Bois'] },
    ],
  };
  const r = analyserImport([
    'Category;Item name;Price',
    'Goodies;Porte-clés ;',
    'Goodies;Porte-clés ;7',
    'Goodies;Porte-clés ;5',
    'Goodies;Porte-clés ;7',
    'Goodies;Porte-clés ;9',
  ].join('\n'), [], fine);
  assert.strictEqual(r.resume.creees, 3, 'les trois autres lignes entrent normalement');
  assert.strictEqual(r.resume.refusees, 0, 'et la ligne à 9 € n’est pas un refus');
  const neuf = r.lignes.find((l) => l.numero === 6);
  assert.match(neuf.ecarte, /9 €/, 'elle est écartée, avec sa raison');
  assert.ok(!r.plan.creations.some((c) => c.prixVenteTtc === 9),
    'aucun porte-clés à 9 € au catalogue');

  // LA RÈGLE LA PLUS PRÉCISE L'EMPORTE : une ligne visée par son prix passe
  // devant l'écart du produit, qui passe devant celui du rayon.
  const portees = preparerRegles(fine);
  assert.strictEqual(portees.ecartes.size, 1);
}

// --- 3. La ligne d'ouverture est absorbée, pas laissée derrière -------------
// C'EST LE PIÈGE DE CE LOT. Sans absorption, la ligne sans prix reste seule dès
// qu'une règle nomme les autres : le catalogue porte alors « Magnet » (sans
// variante, sans prix) À CÔTÉ de « Magnet — Plexi 5 € ». Au comptoir, la
// vendeuse a deux lignes pour un objet, et une des deux ne coûte rien.

const fantomes = rap.plan.creations.filter((c) => !c.variante && c.prixVenteTtc == null);
assert.strictEqual(fantomes.length, 0);

rap = analyserImport([
  'Category;Item name;Price',
  'Goodies;Magnet;',
  'Goodies;Magnet;7',
  'Goodies;Magnet;5',
].join('\n'), [], REGLES);
assert.ok(!rap.plan.creations.some((c) => !c.variante),
  'aucun produit fantôme : la ligne d’ouverture ne reste pas seule de son côté');
const ouverture = rap.lignes.find((l) => l.numero === 2);
assert.strictEqual(ouverture.action, 'ecartee');
assert.match(ouverture.ecarte, /ligne d’ouverture du produit/);

// Une ligne sans valeur qui est SEULE de son produit reste un produit : c'est
// une création volontaire, à tarifer plus tard (`Affiche A3` dans le fichier du
// patron, dont la case est simplement vide).
rap = analyserImport('Category;Item name;Price\nPapeterie;Affiche A3;', [], REGLES);
assert.strictEqual(rap.resume.creees, 1, 'un produit seul sans prix se crée quand même');
assert.strictEqual(rap.plan.creations[0].prixVenteTtc, null, '… sans prix, pas à zéro');

// --- 4. Une variante orpheline est refusée ---------------------------------

rap = analyserImport([
  'Category;Item name;Price',
  'Goodies;Magnet;',
  'Goodies;Magnet;7',
  'Goodies;Magnet;9',        // aucune règle pour 9 € : ses sœurs sont nommées, pas elle
].join('\n'), [], REGLES);
const orpheline = rap.lignes.find((l) => l.numero === 4);
assert.strictEqual(orpheline.action, 'refus',
  'une variante que la règle ne sait pas nommer n’entre pas au menu sans nom');
assert.match(orpheline.refus[0], /variante inconnue pour 9 €/);
assert.match(orpheline.refus[0], /catalogue-import-regles\.json/,
  '… et le refus dit OÙ la nommer');
assert.ok(!rap.plan.creations.some((c) => !c.variante),
  'elle ne se glisse pas au catalogue en tant que produit sans variante');

// --- 5. Le rayon se remappe, et la fusion rend son prix --------------------
// L'export a mis l'indice de variante dans la colonne du RAYON : « 2 FEMME »
// porte F001 à 39 €, « 01 FEMME » porte le même F001 SANS prix. Les fondre
// règle les deux d'un coup — une case vide ne contredit rien.

rap = analyserImport([
  'Category;Item name;Price',
  '01 FEMME;F001 Débardeur Crop Top;',
  '2 FEMME;F001 Débardeur Crop Top;39',
].join('\n'), [], REGLES);
assert.strictEqual(rap.resume.creees, 1, 'les deux rayons n’en font qu’un, donc un seul produit');
assert.strictEqual(rap.plan.creations[0].famille, 'Textile — Femme');
assert.strictEqual(rap.plan.creations[0].prixVenteTtc, 39,
  'et le produit récupère le prix que « 01 FEMME » ne portait pas');
assert.strictEqual(rap.lignes[0].rangeDepuis, '01 FEMME',
  'le rapport dit D’OÙ vient la ligne : un produit qui change de rayon en silence se cherche au mauvais endroit');

// Une famille absente des règles entre sous son propre nom.
rap = analyserImport('Category;Item name;Price\nJeux;Dominos;15', [], REGLES);
assert.strictEqual(rap.plan.creations[0].famille, 'Jeux');
assert.strictEqual(rap.lignes[0].rangeDepuis, null);

// Sans règles du tout, l'import se comporte exactement comme avant.
const sansRegles = analyserImport('Category;Item name;Price\nExpress;Le jour même (40%);', []);
assert.strictEqual(sansRegles.resume.ecartees, 0);
assert.strictEqual(sansRegles.resume.creees, 1);

// --- 6. Le fichier de règles livré est cohérent ----------------------------

const brut = JSON.parse(fs.readFileSync(path.join(RACINE, 'catalogue-import-regles.json'), 'utf8'));
const prep = preparerRegles(brut);
assert.ok(prep.actives > 0, 'le fichier livré porte des règles');

// DEUX RÈGLES POUR UN MÊME PRIX, c'est un nom qui en écrase un autre en
// silence — et c'est le genre d'erreur qu'on écrit en copiant la ligne du
// dessus. `preparerRegles` garde la dernière ; on interdit donc le doublon.
const vues = new Set();
for (const v of brut.variantes) {
  const cle = `${reduire(v.famille)}|${reduire(v.designation)}|${v.prix}`;
  assert.ok(!vues.has(cle),
    `deux règles pour « ${v.famille} / ${v.designation} » à ${v.prix} € : l’une écraserait l’autre`);
  vues.add(cle);
  assert.ok(String(v.variante).trim(), 'une règle de variante doit poser un NOM');
  assert.ok(Number.isFinite(Number(v.prix)), 'et s’accrocher à un prix lisible');
}
// Un rayon ne peut pas être à la fois écarté et remappé : la première règle
// gagnerait toujours, et la seconde ne servirait jamais.
const ecartes = new Set(brut.ecartes.map((e) => reduire(e.famille)));
for (const f of brut.familles) {
  assert.ok(!ecartes.has(reduire(f.de)),
    `« ${f.de} » est écarté ET remappé : la seconde règle ne servira jamais`);
}
for (const e of brut.ecartes) {
  assert.ok(String(e.pourquoi || '').trim().length > 20,
    `« ${e.famille} » est écarté sans raison écrite — dans six mois, personne ne saura pourquoi`);
}

console.log('✓ règles d’import : un rayon écarté n’est pas un refus, une variante se nomme, et rien ne reste fantôme');
