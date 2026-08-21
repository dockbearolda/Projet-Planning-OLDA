'use strict';

// LA DEMANDE DANS LA COLONNE DE DROITE (21/08/2026)
//
// Le client commande trois tasses ET deux tee-shirts : les deux s'empilent
// dans le même panneau, à droite, quel que soit le formulaire qui les a
// créés. La colonne de gauche garde ce qui a besoin de largeur — le chiffrage
// d'un article et sa négociation.
//
// Ce fichier vérifie les pièges du chantier :
//   1. LE PRIX ABSENT — « pas encore chiffré » n'est pas « 0 € ».
//   2. LES INDICES — supprimer une ligne décale toutes celles derrière.
//   3. LE CLIC — un bouton dans la ligne n'est pas un clic sur la ligne.
//   4. LE PARTAGE — le panneau porte la demande, jamais le chiffrage.

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
// On EXÉCUTE `renderNeeds` avec un écran factice plutôt que de relire son
// source : c'est le HTML réellement produit qu'on veut juger, pas sa forme.
const renderNeedsSrc = source('renderNeeds', '');

function rendre(needs, articleOuvert = -1) {
  const ecran = {};
  const boite = (id) => (ecran[id] = ecran[id] || {});
  const contexte = vm.createContext({
    $: boite,
    needs,
    articleOuvert,
    editingNeed: 0, // pas en cours de modification : le titre du formulaire ne bouge pas
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[c])),
    money: (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
      .format(Number(n) || 0),
    renderDetailArticle() {}, txRefreshTotals() {}, updateSidebar() {},
  });
  vm.runInContext(`${renderNeedsSrc}\nrenderNeeds();`, contexte);
  return { html: boite('needsDisplay').innerHTML || '', compteur: boite('needCount').textContent };
}

const TASSES = { category: 'Art de la table', label: 'Tasse céramique', qty: 3, color: 'Blanc', comment: '', unitHT: NaN };
const TSHIRTS = { category: 'Textile', label: 'T-shirt col V', qty: 2, requestedRef: 'K357', comment: '', unitHT: 34.3, textile: { ref: 'K357' } };

// --- 1. Le prix absent -------------------------------------------------------
// `Number(NaN)||0` vaut ZÉRO : une ligne pas encore chiffrée s'afficherait
// « 0,00 € », c'est-à-dire GRATUITE. Elle doit dire ce qu'elle est.
const melange = rendre([TASSES, TSHIRTS]);
assert.ok(/À chiffrer/.test(melange.html),
  'un article sans prix annonce qu’il reste à chiffrer');
assert.ok(!/0,00/.test(melange.html),
  'un article sans prix n’affiche JAMAIS 0 € — « pas chiffré » n’est pas « gratuit »');
assert.ok(/68,60/.test(melange.html) && /34,30/.test(melange.html),
  'un article chiffré montre son total ET son prix à la pièce');
assert.strictEqual(melange.compteur, '2 articles', 'l’en-tête compte les articles de la demande');

// Les deux familles arrivent dans la MÊME liste, dans l'ordre d'ajout : c'est
// tout l'intérêt du panneau, une commande mixte se lit d'un coup d'œil.
assert.ok(melange.html.indexOf('Tasse céramique') < melange.html.indexOf('T-shirt col V'),
  'catalogue et textile se suivent dans une seule liste, dans l’ordre d’ajout');
assert.strictEqual((melange.html.match(/class="need-ligne/g) || []).length, 2,
  'un article = une ligne, quelle que soit sa provenance');

// Le nom d'un produit vient d'une saisie libre au comptoir : il reste du texte.
const piege = rendre([{ ...TASSES, label: '<img src=x onerror=alert(1)>' }]);
assert.ok(!/<img/.test(piege.html), 'le nom d’un article est échappé avant d’entrer dans la page');

// --- 2. La ligne ouverte -----------------------------------------------------
const ouvert = rendre([TASSES, TSHIRTS], 1);
assert.ok(/need-ligne is-ouvert/.test(ouvert.html),
  'la ligne dont le détail est ouvert à gauche se repère dans le panneau');
assert.strictEqual((ouvert.html.match(/is-ouvert/g) || []).length, 1,
  'une seule ligne ouverte à la fois');

// --- 3. Les indices se décalent ---------------------------------------------
// `needs.splice(i,1)` remonte tout ce qui suit : garder l'article ouvert
// afficherait le chiffrage d'un AUTRE article, et la négociation en cours
// porterait sur celui d'à côté.
const supprimer = source('deleteNeed', 'i');
assert.ok(/articleOuvert=-1/.test(supprimer) && /negOuvert=-1/.test(supprimer),
  'supprimer une ligne referme le détail : les indices derrière viennent de bouger');

// --- 4. Le clic sur la ligne -------------------------------------------------
const ouvrir = source('ouvrirArticle', 'i,ev');
assert.ok(/closest\('button,input,textarea,select'\)/.test(ouvrir),
  'un clic sur un bouton ou sur la personnalisation n’ouvre pas le détail');
assert.ok(/if\(!n\.textile\)return editNeed\(i\)/.test(ouvrir),
  'un article hors textile n’a pas de chiffrage : sa modification EST son détail');

// --- 5. Le partage des colonnes ---------------------------------------------
// Le panneau fait 380 px : les cartes de solutions de la négociation n'y
// tiennent pas. Le chiffrage vit à gauche, dans `renderDetailArticle`.
assert.ok(!/tx-card-metrics|negPanneau|tx-avis/.test(renderNeedsSrc),
  'le panneau de droite porte la demande, jamais le chiffrage ni la négociation');
const detail = source('renderDetailArticle', '');
assert.ok(/tx-card-metrics/.test(detail) && /negPanneau\(i,n\)/.test(detail),
  'le détail à gauche porte les chiffres de l’article et sa négociation');
assert.ok(/hote\.classList\.add\('hidden'\)/.test(detail) && /replaceChildren\(\)/.test(detail),
  'sans article ouvert le détail se VIDE : les chiffres d’une ligne supprimée ne doivent pas rester à l’écran');

// Les totaux du panneau s'écrivent avec une garde : ces cases ont déjà changé
// de forme deux fois, et un identifiant disparu arrêtait les six autres.
const totaux = source('txRefreshTotals', '');
assert.ok(/setTextSafe\('txKpi/.test(totaux) && !/\$\('txKpi[^']*'\)\.textContent/.test(totaux),
  'les totaux s’écrivent par `setTextSafe` : un identifiant disparu n’arrête pas les autres');

// La feuille « Esprit SumUp » impose `padding:13px 22px!important` à toutes les
// pilules. Sans `!important` ici, chaque article coûtait 45 px de hauteur et le
// bouton « Construire le projet » passait sous la ligne de flottaison.
assert.ok(/\.demande-corps \.need-actions button\{[^}]*padding:5px 12px!important/.test(DEVIS),
  'les boutons de la ligne doivent battre le padding !important de la feuille du comptoir');

console.log('✓ demande à droite : catalogue et textile dans une seule liste, prix absent qui se dit, indices qui se referment');
