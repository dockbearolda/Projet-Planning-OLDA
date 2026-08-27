'use strict';

const { ecran } = require('./ecran-comptoir');

// LE CHIFFRAGE DOIT DONNER LES CHIFFRES DU FICHIER DU PATRON (21/08/2026)
//
// Le moteur de `textile-catalog.js` est porté du fichier de calcul du patron
// (OLDA_Chiffrage_Rapide_Tshirts_V9_Classement_Gain_OLDA.html). « Porté » ne
// se vérifie pas à l'œil : une virgule de coefficient, un arrondi posé une
// ligne plus haut, un seuil recopié de travers, et le devis part faux sans
// que rien ne le dise.
//
// `test/fixtures/chiffrage-patron-v9.json` a été produit EN FAISANT TOURNER
// le fichier du patron lui-même sur 205 configurations — les 49 produits, les
// 13 emplacements de marquage, les trois genres, les paliers de coefficient,
// la majoration, la remise, le prix manuel et le produit hors catalogue. Ce
// test rejoue ces 205 cas chez nous et compare les 24 valeurs de sortie.
//
// Si un chiffre bouge ici, ce n'est pas le test qu'il faut corriger : c'est
// que notre chiffrage s'est écarté de celui du patron.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
const REF = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/chiffrage-patron-v9.json'), 'utf8'));

const bac = { window: {}, module: { exports: {} }, console, Math, JSON, Number, String, Array, Object, Date, parseFloat, Intl };
vm.createContext(bac);
vm.runInContext(fs.readFileSync(path.join(RACINE, 'public/comptoir/textile-catalog.js'), 'utf8'), bac);
const TE = bac.window.TextileEngine;
/* Le moteur tourne dans un autre « royaume » : ses objets n'ont pas le même
   Object.prototype que ceux d'ici, et `deepStrictEqual` compare aussi ça. On
   les repasse par du texte avant de les juger. */
const local = (v) => JSON.parse(JSON.stringify(v));

// --- 0. LE TARIF DE TRANSPORT N'EST PLUS UNE CONSTANTE DU MOTEUR ------------
// Il vaut 1,80 € HT depuis le 27/08/2026, et il se règle désormais depuis les
// Réglages : un tarif de transporteur bouge, le changer ne doit pas demander un
// déploiement. LE FICHIER V9 DU PATRON, LUI, SUPPOSE 1,50 — 59 de ses 205 cas
// passent par Chronopost.
//
// On vérifie donc DEUX choses distinctes, et il faut les garder distinctes :
//   - la FORMULE est conforme au fichier du patron → on lui injecte 1,50, le
//     tarif que ce fichier suppose, et on compare les 205 cas ;
//   - le TARIF DU JOUR est bien celui que Charlie a donné → assertion séparée,
//     ci-dessous.
// Confondre les deux, c'est soit figer le tarif pour toujours, soit perdre la
// preuve que le moteur calcule juste.
assert.deepStrictEqual(local(TE.getSettings().transports), { Maritime: 0, Chronopost: 1.8 },
  'le tarif d’usine : le maritime est compris dans le prix d’achat, Chronopost vaut 1,80 € HT');
const TARIF_DU_FICHIER_V9 = { Maritime: 0, Chronopost: 1.5 };
TE.setSettings({ transports: TARIF_DU_FICHIER_V9 });

// --- 1. Les réglages de l'atelier -------------------------------------------
// Coût du DTF, débit, pressage, coût horaire, arrondi, quantité plafond du
// coefficient : ce sont EUX qui multiplient tout le reste.
const reglagesHorsTarif = local(TE.getSettings());
delete reglagesHorsTarif.transports;   // comparé juste au-dessus, il ne bouge pas ici
assert.deepStrictEqual(reglagesHorsTarif, REF.reglages,
  'les réglages par défaut sont ceux du fichier du patron');

// --- 2. Les 205 cas ----------------------------------------------------------
const arrondi = (v) => (typeof v === 'number' ? (Number.isNaN(v) ? 'NaN' : Math.round(v * 1e6) / 1e6) : v);
const ecarts = [];
REF.cas.forEach(({ entree, attendu, designation, purchase }) => {
  const e = entree;
  const obtenu = TE.calculate({
    ref: e.ref, isCustom: e.ref === '__CUSTOM__',
    customPurchase: e.customPurchase, customRef: e.customRef, customDesignation: e.customDesignation,
    genre: e.genre, transport: e.transport, printType: e.printType,
    sizes: { S: e.qty }, discount: e.discount, manualPrice: e.manualPrice,
    markupPercent: e.markupPercent,
  });
  const quoi = `${e.ref} · ${e.genre} · ${e.printType} · ${e.transport} · ${e.qty} pièce(s)`
    + (e.markupPercent ? ` · majoration ${e.markupPercent} %` : '')
    + (e.discount ? ` · remise ${e.discount} %` : '')
    + (e.manualPrice ? ` · prix manuel ${e.manualPrice}` : '');
  if (!obtenu) { ecarts.push(`${quoi} → notre moteur ne chiffre pas ce cas`); return; }
  Object.entries(attendu).forEach(([champ, valeur]) => {
    const nous = arrondi(obtenu[champ]);
    if (nous !== valeur) ecarts.push(`${quoi} → ${champ} : patron ${valeur}, nous ${nous}`);
  });
  if (obtenu.item.designation !== designation) ecarts.push(`${quoi} → désignation : « ${designation} » ≠ « ${obtenu.item.designation} »`);
  if (obtenu.item.purchase !== purchase) ecarts.push(`${quoi} → prix d’achat : ${purchase} ≠ ${obtenu.item.purchase}`);
});
assert.deepStrictEqual(ecarts, [], `le chiffrage s’écarte du fichier du patron :\n  - ${ecarts.slice(0, 12).join('\n  - ')}`);
assert.ok(REF.cas.length >= 200, 'la table de référence doit couvrir au moins 200 configurations');

// --- 3. Les tables qui décident du prix ne se réécrivent pas en douce --------
// Un produit retiré, un coefficient arrondi, un seuil déplacé : le devis part
// faux sans erreur. On tient les bornes.
assert.strictEqual(TE.DB.refs.length, 49, 'les 49 produits du patron');
// `DB.transports` garde la LISTE des transports — c'est elle qui remplit le
// menu de l'écran. Leur PRIX, lui, est un réglage (voir §0). On tient donc les
// deux noms, pas leurs valeurs.
assert.deepStrictEqual(Object.keys(local(TE.DB.transports)).sort(), ['Chronopost', 'Maritime'],
  'les deux transports du patron restent au catalogue');
assert.strictEqual(Object.keys(TE.DB.printTypes).length, 13, 'les 13 emplacements de marquage');
assert.deepStrictEqual(local(TE.DB.thresholds[0]), { minQty: 1, excellent: 0.7, veryGood: 0.6, good: 0.55, correct: 0.5, limited: 0.45 },
  'les seuils de marge de la première tranche');
assert.deepStrictEqual(local(TE.DB.thresholds[TE.DB.thresholds.length - 1]),
  { minQty: 150, excellent: 0.55, veryGood: 0.5, good: 0.45, correct: 0.4, limited: 0.35 },
  '… et ceux de la dernière');

// --- 4. La négociation : les mêmes quatre sorties, plus « Ma solution » ------
// Portées du même fichier (V9 « Classement & gain OLDA »). Le moteur ne rend
// que les quatre sorties CALCULÉES ; la cinquième ligne du patron, « Ma
// solution », ne calcule rien — elle se saisit, et c'est l'écran qui la pose.
const c = TE.calculate({ ref: 'NS300', genre: 'Unisexe', transport: 'Maritime', printType: 'Poitrine + Dos', sizes: { S: 50 } });
const cible = Math.round(c.sold * 0.75 * 100) / 100;
const sols = TE.defaultNegotiationSolutions(c, cible);
assert.deepStrictEqual(local(sols.map(s => s.kind)), ['small_gift', 'full_gift', 'volume_target', 'volume_mid'],
  'les quatre sorties du patron, dans son ordre');
assert.ok(sols.every(s => s.paidQty > 0 && s.unitPrice > 0), 'aucune sortie ne propose de vendre à zéro');

// « MA SOLUTION » — la contre-offre écrite à la main, mesurée par la MÊME règle.
const DEVIS = ecran('demande-devis');
const fonction = (nom, signature) => {
  const m = DEVIS.match(new RegExp(`function ${nom}\\(${signature}\\)\\{[\\s\\S]*?\\n\\}`));
  assert.ok(m, `${nom} doit exister`);
  return m[0];
};
assert.ok(/hote\.append\(negCarteMienne\(i, c\)\);\s*negMajCustom\(i\);/.test(DEVIS),
  'la cinquième ligne est posée APRÈS les quatre sorties classées');
const defaut = fonction('negCustomDe', 'i, c');
assert.ok(/paidQty: t \? t\.paidQty : c\.qty/.test(defaut)
  && /unitPrice: t \? t\.unitPrice : c\.sold/.test(defaut)
  && /freeQty: t \? t\.freeQty : 0/.test(defaut),
  'elle part du devis actuel, comme chez le patron — et tant qu’on n’y touche pas, elle SUIT la ligne');
const poser = fonction('negPoserCustom', 'i, champ, valeur');
assert.ok(/negMajCustom\(i\)/.test(poser) && !/renderNeeds\(\)/.test(poser),
  'on écrit dans la carte, on ne la redessine pas : la tabulation d’un champ à l’autre perdrait sa cible');
assert.ok(/input\.onchange = \(\) => negPoserCustom/.test(DEVIS) && !/input\.oninput = \(\) => negPoserCustom/.test(DEVIS),
  '… et la mesure se refait quand le champ rend la main, pas à chaque chiffre tapé');
const maj = fonction('negMajCustom', 'i');
assert.ok(/TE\(\)\.scenarioMetrics\(c, s, target\)/.test(maj)
  && /rankedScenarios\(c, \[\.\.\.TE\(\)\.defaultNegotiationSolutions\(c, target\), s\], target\)/.test(maj),
  'elle est mesurée et classée avec les quatre autres, par la règle du patron');

// Les chiffres, vérifiés à la main : 70 payées à 17 € + 5 offertes = 75 livrées.
const mienne = TE.scenarioMetrics(c, { paidQty: 70, unitPrice: 17, freeQty: 5 }, cible);
assert.strictEqual(mienne.delivered, 75);
assert.strictEqual(Math.round(mienne.revenue * 100) / 100, 1190);
assert.strictEqual(Math.round(mienne.effective * 100) / 100, 15.87, 'le client paie 15,87 € en moyenne par pièce livrée');
assert.strictEqual(Math.round(mienne.margin * 100) / 100,
  Math.round((1190 - 75 * c.unitProductionCost) * 100) / 100, 'les pièces offertes coûtent leur production');

// --- LE TARIF RÈGLE DOIT ARRIVER JUSQU'AU CHIFFRAGE -------------------------
// Un réglage qui n'atteint pas le moteur est pire que pas de réglage : le
// patron change le prix, l'écran dit « enregistré », et le devis part au tarif
// d'avant. On tient donc les trois maillons.
assert.strictEqual(typeof TE.tarifTransport, 'function',
  'le moteur doit exposer le tarif : l’écran en a besoin pour son récapitulatif');
assert.match(DEVIS, /fetch\('\/api\/tarifs-transport'\)/,
  'le parcours doit lire le tarif du serveur à son ouverture');
assert.match(DEVIS, /TE\(\)\.setSettings\(\{transports:t\}\)/,
  '… et l’injecter dans le moteur');
// La forme d'APPEL, pas le mot : `DB.transports['']` est cité dans un
// commentaire de l'écran, et un commentaire ne chiffre rien.
assert.ok(!/TE\(\)\.DB\.transports\[/.test(DEVIS),
  'plus rien ne doit lire le prix dans la table figée du catalogue — c’est un réglage');

// Et le calcul en tient VRAIMENT compte : on le prouve, on ne le suppose pas.
// Le transport entre dans le prix d'achat AVANT le coefficient : 30 centimes de
// transport en plus font 80 centimes sur le prix de vente d'une pièce. C'est
// pour ça que ce réglage ne peut pas être approximatif.
const cas = { ref: 'NS300', genre: 'Unisexe', printType: 'Poitrine Seul', sizes: { S: 10 }, transport: 'Chronopost' };
TE.setSettings({ transports: { Maritime: 0, Chronopost: 1.5 } });
const a150 = TE.calculate(cas);
TE.setSettings({ transports: { Maritime: 0, Chronopost: 1.8 } });
const a180 = TE.calculate(cas);
assert.ok(a180.sold > a150.sold,
  `un transport plus cher doit faire monter le prix (${a150.sold} → ${a180.sold}) `
  + '— sinon le réglage ne sert à rien');
TE.setSettings({ transports: TARIF_DU_FICHIER_V9 });

console.log(`✓ chiffrage conforme au fichier du patron : ${REF.cas.length} configurations, 24 valeurs chacune`);
