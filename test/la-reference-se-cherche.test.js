'use strict';

// LA RÉFÉRENCE SE CHERCHE, ELLE NE SE TAPE PAS.
// ===========================================================================
// Charlie, 04/09/2026 : « ce genre de chose ne doit pas exister, la recherche
// doit faire des propositions car personne n'écrit les réfs pareil, il faut de
// la fluidité absolue car ce genre de détails nous emmerde tout au long de la
// journée. »
//
// CE QUI L'A DÉCLENCHÉ : le comptoir range « K3025 », TopTex l'appelle
// « K3025IC », et le pré-remplissage du BAT échouait sur huit références sur
// quarante-neuf — en silence. Mais le vrai sujet est plus large : le champ
// « Référence » de la rangée d'article était une saisie LIBRE. Ni liste, ni
// proposition, ni contrôle — pendant que le champ « Désignation », juste à
// côté, cherchait déjà dans tout le catalogue.
//
// LA RECHERCHE EXISTAIT DÉJÀ, ET ELLE EST BONNE. `menu-recherche.js` réduit les
// deux côtés à leurs LETTRES ET CHIFFRES avant de comparer, et classe la
// référence avant le libellé. Il n'y avait rien à écrire : il y avait à la
// BRANCHER. Ce fichier tient les deux moitiés — la liste au comptoir, et la
// tolérance du rapprochement côté BAT.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { chargerPapier } = require('./socle-papier');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const VENTE = lire('public/vente-flash.js');
const DEVIS_FLASH = lire('public/devis-flash.js');
const MENU = lire('public/menu-recherche.js');
const STORE = lire('public/bat/js/store.js');

// ---------------------------------------------------------------------------
// 1. LA LISTE DES RÉFÉRENCES, ÉCRITE UNE FOIS
// ---------------------------------------------------------------------------
const bac = chargerPapier('devis.js', ['referencesDuCatalogue']);
const clair = (v) => JSON.parse(JSON.stringify(v));
const referencesDuCatalogue = (c, f) => clair(bac.referencesDuCatalogue(c, f));

const CATALOGUE = [
  { famille: 'Textile', reference: 'K3025', designation: 'T-shirt unisexe léger Pro 145 g', note: 'Unisexe' },
  { famille: 'Textile', reference: 'NS300', designation: 'T-shirt unisexe bio léger Premium 155 g' },
  { famille: 'Tasses', reference: 'TC 01', designation: 'Tasse céramique 350 ml', couleur: 'Rouge / Blanc' },
  { famille: 'Textile', reference: 'K3025', designation: 'DOUBLON à ignorer' },
  { famille: 'Textile', reference: '', designation: 'Sans référence — pas de ligne' },
  { famille: 'Textile', reference: 'NS999', designation: 'Éteint', actif: false },
];

const refs = referencesDuCatalogue(CATALOGUE, 'Textile');
assert.deepStrictEqual(refs.map((r) => r.valeur), ['K3025', 'NS300', 'TC 01'],
  'une référence par produit vivant : pas de doublon, pas de produit éteint, pas de ligne sans référence');

// CE QU'ON LIT EST LA DÉSIGNATION, CE QU'ON RANGE EST LA RÉFÉRENCE. « K3025 »
// ne dit rien à personne trois jours plus tard ; « T-shirt unisexe léger Pro
// 145 g » si. Le composant sait afficher les deux — la valeur tombe dans le
// champ, le texte se lit, le jeton se voit en tête de ligne.
assert.strictEqual(refs[0].texte, 'T-shirt unisexe léger Pro 145 g');
assert.strictEqual(refs[0].jeton, 'K3025');
assert.strictEqual(refs[0].onglet, 'Textile', 'les deux métiers de la maison se retrouvent au menu');
assert.strictEqual(refs[2].onglet, 'Boutique');
assert.ok(refs[2].cherche.includes('Rouge'), 'ce qui ne s’affiche pas reste cherchable');

// ---------------------------------------------------------------------------
// 2. LA RECHERCHE COMPREND CE QUE LES GENS TAPENT
// ---------------------------------------------------------------------------
// C'est la règle de `menu-recherche.js`, et c'est elle qu'on branche. On la
// rejoue ici sur les mêmes données : si elle changeait, ce test le dirait avant
// que quelqu'un s'en aperçoive au comptoir.
const menuReduire = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
assert.ok(/function menuReduire\(s\)\{return menuNorm\(s\)\.replace\(\/\[\^a-z0-9\]\+\/g,''\)\}/.test(MENU),
  'la réduction du composant est bien « lettres et chiffres » — le test rejoue SA règle');

const foin = (r) => menuReduire(`${r.jeton} ${r.texte} ${r.cherche}`);
const trouve = (q) => refs.filter((r) => menuReduire(q).length && foin(r).includes(menuReduire(q)))
  .map((r) => r.valeur);
for (const [q, attendu] of [
  ['3025', ['K3025']],
  ['K3025', ['K3025']],
  ['k 3025', ['K3025']],
  ['K-3025', ['K3025']],
  ['ns300', ['NS300']],
  ['NS-300', ['NS300']],
  ['ns3', ['NS300']],
  ['tc01', ['TC 01']],       // la référence porte une espace, personne ne la tape
  ['pro 145', ['K3025']],    // et on cherche aussi par ce qu'on lit
]) {
  assert.deepStrictEqual(trouve(q), attendu, `« ${q} » doit trouver ${attendu.join(', ')}`);
}

// ---------------------------------------------------------------------------
// 3. LE CHAMP EST BRANCHÉ — DANS LES DEUX ÉCRANS
// ---------------------------------------------------------------------------
for (const [nom, src] of [['vente flash', VENTE], ['devis flash', DEVIS_FLASH]]) {
  assert.ok(/referencesDuCatalogue/.test(src), `${nom} construit la liste depuis le module partagé`);
  assert.ok(/if \(poserListeRefs\(\)\) habiller\(refe, ID_REFS, null\);/.test(src),
    `${nom} habille le champ Référence`);

  // ⚠ ET IL L'HABILLE À LA FIN, PAS À SA CRÉATION. Le composant SORT le champ
  // de sa place pour lui poser sa peau (`replaceWith` + `append`) ; `champ()`,
  // appelé juste après, le remettait dans SA boîte — le champ quittait la peau,
  // l'attribut restait, et le menu ne s'ouvrait jamais. Trouvé au navigateur :
  // le champ portait bien `data-menu-liste`, et rien ne se déroulait.
  const iHabille = src.indexOf('habiller(refe, ID_REFS, null)');
  const iChamp = src.indexOf("champ('Référence', refe)");
  assert.ok(iChamp > 0 && iHabille > iChamp,
    `${nom} : la peau se pose APRÈS que le champ a trouvé sa place, sinon le menu ne s’ouvre pas`);

  // CHOISIR UNE RÉFÉRENCE, C'EST CHOISIR L'ARTICLE — et par le MÊME chemin.
  // Choisir un article, c'est trente lignes (le prix, le coloris, les
  // emplacements du moteur, les puces de la tasse, la famille). Recopiées ici,
  // elles seraient deux comportements le jour où l'une bouge.
  assert.ok(/design\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\);/.test(src),
    `${nom} relance le geste de la Désignation au lieu de le recopier`);
  // Sur `change` et jamais sur `input` : une référence tapée à moitié ne doit
  // pas remplacer l'article sous les doigts.
  assert.ok(/refe\.addEventListener\('change'/.test(src) && !/refe\.addEventListener\('input'/.test(src),
    `${nom} ne change d’article qu’au CHOIX, pas à la frappe`);

  // ET LE FILTRE NE PROMET QUE CE QU'IL TIENT. Il annonçait « couleur » : les
  // textiles n'en portent pas dans le catalogue produits.
  assert.ok(/menuFiltre = 'Reference ou designation…'/.test(src),
    `${nom} : le filtre annonce ce qu’il sait faire`);
}

// ---------------------------------------------------------------------------
// 4. LE BAT AUSSI CHERCHE, AU LIEU DE COMPARER DEUX CHAÎNES
// ---------------------------------------------------------------------------
// `productByRef` comparait deux formes réduites : « k3025 » n'est pas
// « k3025ic », donc rien. La cascade va du plus sûr au plus tolérant, et
// s'ARRÊTE quand plusieurs vêtements répondent — un produit choisi au hasard
// donnerait un BAT plausible et faux.
assert.ok(/export function trouverProduitParRef\(ref\)/.test(STORE));
assert.ok(/s\.startsWith\(k\) \|\| k\.startsWith\(s\)/.test(STORE),
  'le préfixe joue dans les DEUX sens : « k3025 » trouve « k3025ic », et l’inverse');
assert.ok(/if \(proches\.length === 1\) return \{ produit: proches\[0\], propositions: \[\] \};/.test(STORE),
  'un seul candidat : on ouvre. Plusieurs : on PROPOSE, on ne devine pas');
assert.ok(/refKey\(p\.refInternal\) === k/.test(STORE),
  'la référence interne compte aussi — certains produits en portent deux');

// La règle du préfixe, jouée : c'est elle qui règle le cas TopTex sans table.
const refKey = (r) => String(r || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const proche = (a, b) => {
  const x = refKey(a); const y = refKey(b);
  return !!x && !!y && (x.startsWith(y) || y.startsWith(x));
};
assert.ok(proche('K3025', 'K3025IC'), '« K3025 » et « K3025IC » sont le même vêtement');
assert.ok(proche('k-3025 ic', 'K3025IC'), 'à la ponctuation et à la casse près');
assert.ok(!proche('K3025', 'NS300'), 'et deux vêtements différents le restent');

console.log('✓ la référence se cherche : « 3025 », « ns-300 » et « pro 145 » proposent, '
  + 'choisir applique l’article, et le BAT ne compare plus deux chaînes');
