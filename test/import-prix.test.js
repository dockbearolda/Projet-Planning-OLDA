'use strict';

// L'IMPORT DE PRIX — on lit tout, on dit tout, PUIS seulement on écrit
// ===========================================================================
// « Un écran dans Réglages qui avale mon fichier de prix et me dit, AVANT
// d'écrire quoi que ce soit, ce qu'il va faire : combien de lignes créées,
// combien mises à jour, combien refusées et POURQUOI. Rien ne s'écrit sur un
// import à moitié lu. » (Charlie, 01/09/2026.)
//
// LE FORMAT EST DU CSV, PAS DU .XLSX. Le dépôt n'a que trois dépendances
// (express, pg, compression). Lire un .xlsx natif — un ZIP, du XML, la table
// des chaînes partagées et celle des styles pour savoir si « 35 » est un prix
// ou une date — en demanderait une quatrième. Le CSV se lit sans rien ajouter.
//
// CE FICHIER GARDE :
//
//   1. L'APERÇU N'ÉCRIT RIEN, et il dit tout : les quatre comptes, et la
//      RAISON de chaque refus, avec son numéro de ligne.
//   2. RIEN NE S'ÉCRIT SUR UN IMPORT À MOITIÉ LU. Un guillemet jamais refermé,
//      une colonne obligatoire absente : c'est le FICHIER qui est refusé, pas
//      ses quatre-vingts premières lignes acceptées et le reste perdu.
//   3. ON N'ÉCRIT QUE CE QU'ON A MONTRÉ. L'écriture réclame la SIGNATURE de
//      l'aperçu ; si la base a bougé entre les deux, elle est refusée.
//   4. LE FICHIER DU PATRON, TEL QU'IL SORT DE SUMUP. « Category », « Item
//      name », « Price », séparateur deviné, et les variantes en lignes
//      RÉPÉTÉES : d'accord elles se fondent, en désaccord elles sont TOUTES
//      refusées — deviner poserait un prix faux en rayon.
//   5. UNE COLONNE ABSENTE N'EFFACE RIEN. Un fichier qui ne parle que du prix
//      ne remet pas les temps machine à zéro.
//   6. L'IMPORT EST REJOUABLE. Le même fichier deux fois de suite ne crée
//      rien la seconde : tout est « inchangé ».

const assert = require('node:assert');
const { analyserImport, nombre, lireCsv } = require('../catalogue-csv');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

// Les lignes déjà en base, dans la forme que le module attend.
const enBase = (liste) => liste.map((p, i) => ({
  id: `id-${i}`,
  famille: p.famille,
  designation: p.designation,
  variante: p.variante || '',
  reference: p.reference || '',
  prixAchat: p.prixAchat == null ? null : p.prixAchat,
  prixVenteTtc: p.prixVenteTtc == null ? null : p.prixVenteTtc,
  tempsMoMin: p.tempsMoMin == null ? null : p.tempsMoMin,
  tempsMachineMin: p.tempsMachineMin == null ? null : p.tempsMachineMin,
  actif: p.actif !== false,
}));

(async () => {
  // =========================================================================
  // 0. LES NOMBRES D'UN TABLEUR FRANÇAIS
  // =========================================================================
  // « 12,50 € », « 1 234,56 », « 1,234.56 » : le patron tape dans Excel, pas
  // dans un format. Ce qu'on ne sait PAS lire est refusé — un prix mal lu ne
  // doit surtout pas valoir zéro.
  assert.strictEqual(nombre('12,50').valeur, 12.5);
  assert.strictEqual(nombre('12.50 €').valeur, 12.5);
  assert.strictEqual(nombre('1 234,56').valeur, 1234.56, 'l’espace groupe les milliers');
  assert.strictEqual(nombre('1.234,56').valeur, 1234.56, 'le dernier séparateur est le décimal');
  assert.strictEqual(nombre('1,234.56').valeur, 1234.56, '… dans l’autre sens aussi');
  assert.strictEqual(nombre('').vide, true, 'une case vide ne dit rien');
  assert.strictEqual(nombre('à revoir').erreur, true, 'et ce qu’on ne lit pas est REFUSÉ');

  // =========================================================================
  // 1. L'APERÇU DIT LES QUATRE COMPTES, ET LA RAISON DE CHAQUE REFUS
  // =========================================================================
  const catalogue = enBase([
    { famille: 'Art de la table', designation: 'Bouchon Bois' },
    { famille: 'Art de la table', designation: 'Couteau Multi', variante: 'Bois', prixVenteTtc: 14 },
    { famille: 'Art de la table', designation: 'Couteau Multi', variante: 'Liège' },
  ]);

  let rap = analyserImport([
    'Famille;Désignation;Variante;Prix de vente TTC',
    'Art de la table;Bouchon Bois;;6,00',              // mise à jour
    'Art de la table;Couteau Multi;Bois;14,00',        // inchangée
    'Papeterie;Sticker;;4,00',                         // création
    'Art de la table;Plateau Liège;;à revoir',         // refus : prix illisible
    ';Sans rayon;;9,00',                               // refus : famille vide
    'Art de la table;;;9,00',                          // refus : désignation vide
  ].join('\n'), catalogue);

  assert.deepStrictEqual(rap.resume,
    { lues: 6, creees: 1, majs: 1, inchangees: 1, refusees: 3 },
    'les quatre comptes sont ceux du fichier, pas une approximation');
  assert.strictEqual(rap.separateur, ';', 'le séparateur d’Excel français est deviné');

  const parNumero = new Map(rap.lignes.map((l) => [l.numero, l]));
  // Le numéro est celui du TABLEUR : la ligne 1 porte les intitulés.
  assert.strictEqual(parNumero.get(2).action, 'maj');
  assert.deepStrictEqual(parNumero.get(2).changements,
    [{ champ: 'prixVenteTtc', avant: null, apres: 6 }],
    'une mise à jour dit les DEUX nombres — « 4 mises à jour » ne dirait pas si un prix passe de 6 à 6,50 ou de 6 à 600');
  assert.strictEqual(parNumero.get(3).action, 'inchangee');
  assert.strictEqual(parNumero.get(4).action, 'creation');
  assert.strictEqual(parNumero.get(5).action, 'refus');
  assert.match(parNumero.get(5).refus[0], /prix de vente TTC illisible : « à revoir »/,
    'un refus NOMME sa raison : « 42 lignes ignorées » oblige à rouvrir le tableur et à deviner');
  assert.match(parNumero.get(6).refus[0], /famille vide/);
  assert.match(parNumero.get(7).refus[0], /désignation vide/);

  // Un prix négatif est refusé, pas ramené à zéro.
  const negatif = analyserImport('Famille;Désignation;Prix\nA;B;-4', enBase([]));
  assert.strictEqual(negatif.resume.refusees, 1);
  assert.match(negatif.lignes[0].refus[0], /négatif/);

  // =========================================================================
  // 2. RIEN NE S'ÉCRIT SUR UN IMPORT À MOITIÉ LU
  // =========================================================================
  // Un guillemet jamais refermé, c'est un fichier COUPÉ. On ne garde pas les
  // lignes d'avant : on refuse le fichier.
  const coupe = analyserImport('Famille;Désignation;Prix\nA;B;5\nC;"Désignation qui', catalogue);
  assert.ok(coupe.erreur, 'un fichier coupé est refusé EN ENTIER');
  assert.match(coupe.erreur, /Guillemet jamais refermé/);
  assert.ok(!coupe.plan, '… et il ne propose RIEN à écrire');

  assert.match(analyserImport('Prix;Autre\n5;x', catalogue).erreur,
    /Colonnes? obligatoires? absentes?/,
    'sans famille ni désignation, il n’y a pas de produit à retrouver');
  assert.match(analyserImport('Famille;Désignation\nA;B', catalogue).erreur,
    /ne transporte rien à importer/,
    'un fichier sans aucune colonne de valeur n’est pas un tarif');
  assert.ok(analyserImport('', catalogue).erreur, 'un fichier vide est refusé');

  // Un champ entre guillemets peut contenir le séparateur ET un saut de ligne :
  // découper par `\n` puis par `;` casserait ces champs-là en silence.
  const guillemets = lireCsv('a;b\n"un;deux";"sur\ndeux lignes"');
  assert.deepStrictEqual(guillemets.lignes[1], ['un;deux', 'sur\ndeux lignes']);

  // =========================================================================
  // 3. LE BOM, LA TABULATION, LA VIRGULE
  // =========================================================================
  // Excel colle trois octets invisibles devant le premier intitulé : sans les
  // retirer, « Category » ne s'appelle plus « Category ».
  const bom = analyserImport('﻿Category,Item name,Price\nPapeterie,Sticker,4', enBase([]));
  assert.strictEqual(bom.resume.creees, 1, 'le BOM d’Excel ne cache pas la première colonne');
  assert.strictEqual(bom.separateur, ',');
  const tab = analyserImport('Famille\tDésignation\tPrix\nPapeterie\tSticker\t4', enBase([]));
  assert.strictEqual(tab.separateur, 'tabulation');
  assert.strictEqual(tab.resume.creees, 1);

  // Une colonne dont on ne sait rien est IGNORÉE et DITE — pas devinée.
  const inconnue = analyserImport('Famille;Désignation;Prix;Stock restant\nA;B;5;12', enBase([]));
  assert.deepStrictEqual(inconnue.inconnues, ['Stock restant']);
  assert.strictEqual(inconnue.resume.creees, 1);

  // =========================================================================
  // 4. LE FICHIER DU PATRON, TEL QU'IL SORT DE SUMUP
  // =========================================================================
  // SumUp exporte trois colonnes — Category / Item name / Price — et répète la
  // ligne du produit UNE FOIS PAR VARIANTE, la première sans prix, sans jamais
  // nommer la variante. Deux lignes qui parlent du même produit se fondent
  // TANT QU'ELLES SONT D'ACCORD ; dès qu'elles se contredisent, AUCUNE n'est
  // retenue : le fichier ne dit pas laquelle a raison, et le deviner poserait
  // un prix faux en rayon.
  const sumup = analyserImport([
    'Category;Item name;Price',
    '0 UNISEXE;H001 T-shirt Léger Premium 155 gr;',      // la ligne « parente », sans prix
    '0 UNISEXE;H001 T-shirt Léger Premium 155 gr;35.00',
    '0 UNISEXE;H001 T-shirt Léger Premium 155 gr;35.00',
    'Accessoires;Bracelet;',
    'Accessoires;Bracelet;19.00',
    'Accessoires;Bracelet;15.00',                        // ⚠ deux prix pour un même nom
  ].join('\n'), enBase([]));

  assert.strictEqual(sumup.resume.creees, 1,
    'trois lignes d’accord (dont une muette) ne font qu’UN produit');
  assert.strictEqual(sumup.plan.creations[0].prixVenteTtc, 35);
  assert.strictEqual(sumup.resume.refusees, 3,
    'les trois lignes du bracelet sont refusées : deux prix, aucune raison de choisir');
  const raison = sumup.lignes.find((l) => l.designation === 'Bracelet').refus[0];
  assert.match(raison, /apparaît 3 fois avec des prix de vente TTC différents \(19 et 15\)/);
  assert.match(raison, /Ajoute une colonne « Variante »/,
    'et le refus dit QUOI FAIRE — sinon le patron rouvre le tableur et devine');
  assert.match(raison, /aucune de ces lignes n’est importée/);

  // La même liste, une fois la colonne « Variante » ajoutée : deux produits.
  const distinguees = analyserImport([
    'Category;Item name;Variante;Price',
    'Accessoires;Bracelet;Cuir;19.00',
    'Accessoires;Bracelet;Corde;15.00',
  ].join('\n'), enBase([]));
  assert.strictEqual(distinguees.resume.creees, 2);
  assert.strictEqual(distinguees.resume.refusees, 0);

  // Une famille écrite autrement retombe sur le MÊME rayon : « Art de la
  // Table » et « Art de la table » ne sont pas deux produits.
  const casse = analyserImport('Category;Item name;Price\nArt de la Table;BOUCHON BOIS;6', catalogue);
  assert.strictEqual(casse.resume.majs, 1, 'la casse ne fabrique pas un doublon');
  assert.strictEqual(casse.resume.creees, 0);

  // =========================================================================
  // 5. BOUT EN BOUT : l'aperçu n'écrit rien, la signature garde l'écriture
  // =========================================================================
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
  const call = async (method, chemin, body) => {
    const res = await fetch(base + chemin, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };

  const depart = (await call('GET', '/api/catalogue-produits')).body;
  assert.strictEqual(depart.length, 82);
  assert.strictEqual(depart.find((p) => p.designation === 'Bouchon Bois').prixVenteTtc, null);

  const CSV = [
    'Category;Item name;Price',
    'Art de la table;Bouchon Bois;6,00',
    'Papeterie;Sticker;4,00',
    'Art de la table;Plateau Liège;n’importe quoi',
  ].join('\n');

  // L'APERÇU N'ÉCRIT RIEN.
  const apercu = await call('POST', '/api/catalogue-produits/import/apercu', { csv: CSV });
  assert.strictEqual(apercu.status, 200);
  assert.strictEqual(apercu.body.ecrit, false);
  assert.deepStrictEqual(apercu.body.resume,
    { lues: 3, creees: 1, majs: 1, inchangees: 0, refusees: 1 });
  const inchange = (await call('GET', '/api/catalogue-produits')).body;
  assert.strictEqual(inchange.length, 82, 'un aperçu ne crée rien');
  assert.strictEqual(inchange.find((p) => p.designation === 'Bouchon Bois').prixVenteTtc, null,
    '… et n’écrit aucun prix');

  // SANS SIGNATURE, RIEN. Un appel direct écrirait un import que personne n'a
  // relu — exactement ce que cette route existe pour empêcher.
  const nue = await call('POST', '/api/catalogue-produits/import', { csv: CSV });
  assert.strictEqual(nue.status, 400);
  assert.match(nue.body.error, /Signature de l’aperçu manquante/);

  // UNE SIGNATURE QUI NE CORRESPOND PLUS : la base a bougé entre l'aperçu et
  // le clic, on n'écrit pas ce qui n'a pas été montré.
  const fausse = await call('POST', '/api/catalogue-produits/import',
    { csv: CSV, signature: 'jamais-vue' });
  assert.strictEqual(fausse.status, 409);
  assert.match(fausse.body.error, /rien n’a été écrit/);
  assert.strictEqual((await call('GET', '/api/catalogue-produits')).body.length, 82);

  // L'ÉCRITURE, avec la signature de l'aperçu.
  const fait = await call('POST', '/api/catalogue-produits/import',
    { csv: CSV, signature: apercu.body.signature });
  assert.strictEqual(fait.status, 200);
  assert.strictEqual(fait.body.ecrit, true);
  const apres = (await call('GET', '/api/catalogue-produits')).body;
  assert.strictEqual(apres.length, 83, 'un produit créé, un mis à jour, un refusé');
  assert.strictEqual(apres.find((p) => p.designation === 'Bouchon Bois').prixVenteTtc, 6);
  assert.strictEqual(apres.find((p) => p.designation === 'Sticker').prixVenteTtc, 4);
  assert.ok(!apres.some((p) => p.designation === 'Plateau Liège' && p.prixVenteTtc != null),
    'la ligne refusée n’a rien écrit du tout');
  // Un produit créé entre à la SUITE des rayons du patron, pas au milieu.
  assert.ok(apres[apres.length - 1].designation === 'Sticker',
    'un produit importé se range en fin de catalogue');

  // =========================================================================
  // 6. UNE COLONNE ABSENTE N'EFFACE RIEN
  // =========================================================================
  await call('PUT', '/api/catalogue-produits', [
    {
      famille: 'Essais', designation: 'Objet', variante: '',
      prixAchat: 3, prixVenteTtc: 9, tempsMoMin: 2, tempsMachineMin: 4, reference: 'OBJ-1',
    },
  ]);
  const partiel = 'Famille;Désignation;Prix\nEssais;Objet;11';
  const vu = await call('POST', '/api/catalogue-produits/import/apercu', { csv: partiel });
  await call('POST', '/api/catalogue-produits/import',
    { csv: partiel, signature: vu.body.signature });
  const objet = (await call('GET', '/api/catalogue-produits')).body[0];
  assert.strictEqual(objet.prixVenteTtc, 11, 'le prix que le fichier porte est écrit');
  assert.strictEqual(objet.prixAchat, 3, 'le prix d’achat, dont il ne parle pas, ne bouge pas');
  assert.strictEqual(objet.tempsMoMin, 2, 'ni le temps de main-d’œuvre');
  assert.strictEqual(objet.tempsMachineMin, 4, 'ni le temps machine');
  assert.strictEqual(objet.reference, 'OBJ-1', 'ni la référence');

  // =========================================================================
  // 7. L'IMPORT EST REJOUABLE
  // =========================================================================
  const rejoue = await call('POST', '/api/catalogue-produits/import/apercu', { csv: partiel });
  assert.deepStrictEqual(rejoue.body.resume,
    { lues: 1, creees: 0, majs: 0, inchangees: 1, refusees: 0 },
    'le même fichier deux fois de suite ne crée rien la seconde');

  console.log('✓ import de prix : on lit tout, on dit tout, et rien ne s’écrit sur un fichier à moitié lu');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
