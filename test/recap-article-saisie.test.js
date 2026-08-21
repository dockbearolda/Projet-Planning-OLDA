'use strict';

// LE RÉCAPITULATIF DIT CE QUI A ÉTÉ SAISI (21/08/2026)
//
// Le bloc sous le formulaire annonçait « K3008 · Coconut Milk · Poitrine +
// Dos · 2 pièces », et la ligne de la demande « Textile · Coconut Milk ·
// Réf. K3008 · Production DTF » : le genre, la couleur du marquage, les
// tailles, le transport et la note — la moitié de ce que la vendeuse venait
// de choisir — n'apparaissaient nulle part, et deux mots sur quatre étaient
// écrits par le code. Rien ne disait non plus laquelle des deux couleurs
// était celle de l'encre.
//
// Ce fichier tient trois choses :
//   1. LES INTITULÉS sont ceux des champs du formulaire, pas d'autres mots.
//   2. TOUT CE QUI EST SAISI se relit — et rien de ce qui est vide.
//   3. LA LIGNE DE LA DEMANDE porte le marquage, les tailles, le transport.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
const DEVIS = fs.readFileSync(path.join(RACINE, 'public/comptoir/demande-devis.html'), 'utf8');

function source(nom, signature) {
  const re = new RegExp(`function ${nom}\\(${signature}\\)\\{[\\s\\S]*?\\n\\}`);
  const m = DEVIS.match(re);
  assert.ok(m, `${nom} doit exister et se terminer par une accolade en colonne 0`);
  return m[0];
}

// --- Le bac à sable ----------------------------------------------------------
// Le moteur textile n'est pas chargé ici : seules les deux tables de tailles
// lui sont empruntées, elles sont figées.
const SAISIE = {
  ref: 'K3008', isCustom: false, customRef: '', customPurchase: '', customDesignation: '',
  color: 'Coconut Milk', genre: 'Bébé', transport: 'Chronopost',
  printType: 'Poitrine + Dos', markColor: 'Kaki',
  sizes: { S: '', M: '2', L: '', XL: '', XXL: '', other: '' },
  note: 'Prénom Léa sur la manche', discount: '', manualPrice: '', markupPercent: '',
};

function lignesDeSaisie(d) {
  const contexte = vm.createContext({
    TE: () => ({ SIZE_KEYS: ['S', 'M', 'L', 'XL', 'XXL', 'other'],
      SIZE_LABELS: { S: 'S', M: 'M', L: 'L', XL: 'XL', XXL: '2XL', other: 'Autres' } }),
    txNum: (v) => Number(v) || 0,
    txDisplayRef: (x) => (x.isCustom ? (x.customRef || 'NOUVEAU') : x.ref),
    d,
  });
  vm.runInContext(`${source('txSaisieLignes', 'd')}\nglobalThis.__r=txSaisieLignes(d);`, contexte);
  return contexte.__r;
}

const lignes = lignesDeSaisie(SAISIE);
const par = Object.fromEntries(lignes);

// --- 1. Les intitulés sont ceux des champs -----------------------------------
// Un récapitulatif qui rebaptise les champs oblige à traduire de tête entre le
// haut et le bas de la même page.
const LABELS = DEVIS.match(/<label[^>]*>([^<]+)/g).map((m) => m.replace(/<label[^>]*>/, '').trim());
lignes.forEach(([intitule]) => {
  assert.ok(LABELS.includes(intitule),
    `« ${intitule} » doit être l’intitulé d’un champ du formulaire, pas un autre mot`);
});

// --- 2. Tout ce qui est saisi se relit ---------------------------------------
assert.strictEqual(par['Référence'], 'K3008');
assert.strictEqual(par['Couleur textile'], 'Coconut Milk');
assert.strictEqual(par['Genre'], 'Bébé', 'le genre décide des temps de marquage : il se relit');
assert.strictEqual(par['Emplacement du marquage'], 'Poitrine + Dos');
assert.strictEqual(par['Couleur du marquage'], 'Kaki');
assert.strictEqual(par['Transport'], 'Chronopost');
assert.strictEqual(par['Tailles'], 'M 2', 'les tailles se relisent taille par taille');
assert.strictEqual(par['Note'], 'Prénom Léa sur la manche');

// Les DEUX couleurs sont là, chacune sous son intitulé : « Coconut Milk » et
// « Kaki » ne se distinguent pas autrement.
assert.ok(par['Couleur textile'] !== par['Couleur du marquage']
  && 'Couleur textile' in par && 'Couleur du marquage' in par,
  'la couleur du vêtement et celle de l’encre ne se confondent pas');

// Un champ vide ne prend pas de place : un « Note : — » de plus à lire à chaque
// article, c'est ce qui rendait le bloc illisible.
const nu = Object.fromEntries(lignesDeSaisie({
  ...SAISIE, color: '', markColor: '', note: '', sizes: { S: '', M: '', L: '', XL: '', XXL: '', other: '' },
}));
assert.ok(!('Couleur textile' in nu) && !('Note' in nu) && !('Tailles' in nu),
  'un champ laissé vide ne s’affiche pas du tout');
assert.strictEqual(nu['Référence'], 'K3008', '… et ce qui est rempli reste');

// Un produit hors catalogue porte SA référence, pas une case vide.
const libre = Object.fromEntries(lignesDeSaisie({ ...SAISIE, isCustom: true, customRef: 'SWEAT-XL' }));
assert.strictEqual(libre['Référence'], 'SWEAT-XL');

// --- 3. La ligne de la demande -----------------------------------------------
// On EXÉCUTE `renderNeeds` : c'est le HTML produit qu'on juge.
const renderNeedsSrc = source('renderNeeds', '');
function rendre(needs) {
  const ecran = {};
  const boite = (id) => (ecran[id] = ecran[id] || {});
  const contexte = vm.createContext({
    $: boite, needs, articleOuvert: -1, editingNeed: 0,
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])),
    money: (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0),
    renderDetailArticle() {}, txRefreshTotals() {}, updateSidebar() {},
  });
  vm.runInContext(`${renderNeedsSrc}\nrenderNeeds();`, contexte);
  return boite('needsDisplay').innerHTML || '';
}

const html = rendre([{
  category: 'Textile', label: 'T-shirt unisexe Oversize épais 220 g', qty: 2,
  requestedRef: 'K3008', color: 'Coconut Milk', productionType: 'DTF',
  comment: '', unitHT: 37.9, textile: SAISIE,
}]);
assert.ok(/Poitrine \+ Dos/.test(html) && /Kaki/.test(html),
  'la ligne dit où va le marquage et de quelle couleur');
assert.ok(/M 2/.test(html), 'la ligne dit les tailles commandées');
assert.ok(/Chronopost/.test(html), 'la ligne dit le transport choisi');
assert.ok(/Bébé/.test(html), 'la ligne dit le genre');
assert.ok(/Marquage<\/div>/.test(html) && /Tailles<\/div>/.test(html),
  'chaque valeur porte son intitulé : « Coconut Milk » et « Kaki » ne se devinent pas');
// « Production DTF » n'a jamais été saisi au comptoir : c'est le code qui
// l'écrivait, et il occupait la place du marquage.
assert.ok(!/Production DTF/.test(html),
  'la ligne ne remplit plus la place avec ce que personne n’a choisi');

// Un article du catalogue n'a pas de chiffrage textile : il garde sa famille,
// et son intitulé aussi — une case vide décalerait toute la grille.
const catalogue = rendre([{ category: 'Art de la table', label: 'Bouchon Bois', qty: 3, comment: '', unitHT: NaN }]);
assert.ok(/need-detail-k">Famille<\/div><div class="need-detail-v">Art de la table/.test(catalogue),
  'un article hors textile garde sa famille, sous un intitulé');
assert.ok(!/need-detail-k"><\/div>/.test(catalogue),
  'aucun intitulé vide : la colonne de gauche de la grille resterait béante');

// --- 4. Le bloc sous le formulaire et la fiche disent la MÊME chose ----------
const apercu = source('previewTextile', '');
assert.ok(/txSaisieBloc\(d\)/.test(apercu),
  'le bloc sous le formulaire relit la saisie en cours');
const detail = source('renderDetailArticle', '');
assert.ok(/txSaisieBloc\(n\.textile\)/.test(detail),
  'la fiche ouverte à gauche relit la saisie de l’article');
// Le classement de l'atelier est une PASTILLE, pas la fin d'un nombre :
// « 436,74 € ⭐ PRIORITÉ OLDA » se lisait d'un bloc.
assert.ok(!/money\(c\.eurH\):'—'\} \$\{c\.atelier\}/.test(DEVIS),
  'le classement de l’atelier ne se colle plus au chiffre');
assert.ok(/function txAtelier\(c\)\{/.test(DEVIS) && /txEl\('span','tx-atelier',c\.atelier\)/.test(DEVIS),
  '… il a sa propre pastille');

console.log('✓ récapitulatif : les intitulés des champs, tout ce qui est saisi, rien de ce qui est vide');
