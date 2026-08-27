'use strict';

const { ecran } = require('./ecran-comptoir');

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
const DEVIS = ecran('demande-devis');
const CHARTE = fs.readFileSync(path.join(RACINE, 'public/charte.css'), 'utf8');

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

function rendre(needs, articleOuvert = -1, ouverts) {
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
    dmdDetailsOuverts: ouverts || new Set(),
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

// --- 2 bis. LE DÉTAIL SE DÉROULE, ET LE CHOIX TIENT (24/08/2026) -------------
// Fermée, la carte dit l'essentiel : la désignation (en titre), la référence,
// le prix. Le reste — marquage, encre, tailles, prix à la pièce, famille —
// attend derrière « Détail ». Le choix est un ÉTAT (dmdDetailsOuverts) : la
// liste se redessine à chaque ajout, une ouverture portée par le seul DOM se
// refermerait sous les yeux au premier article suivant. Un nouvel article
// arrive toujours refermé.
{
  const ferme = rendre([TASSES, TSHIRTS]);
  // Les rangées pliées restent dans le DOM (le CSS les cache) : ce qui doit
  // se vérifier ici, c'est le MARQUAGE des rangées et l'état de la ligne.
  assert.ok(/class="need-derouler"/.test(ferme.html),
    'chaque carte qui a du détail porte sa rangée « Détail »');
  assert.ok(!/detail-ouvert/.test(ferme.html),
    'aucune ouverture par défaut : un nouvel article arrive refermé');
  assert.ok(/aria-expanded="false"/.test(ferme.html) && !/aria-expanded="true"/.test(ferme.html),
    '… et la rangée-bouton le dit aussi au lecteur d’écran');
  // La référence et l'argent ne sont jamais pliés ; le descriptif l'est.
  assert.ok(/<span>Réf\.<\/span>/.test(ferme.html),
    'la référence reste visible carte fermée : elle n’est pas marquée pliée');
  assert.ok(/<span class="est-argent">Total<\/span>/.test(ferme.html),
    '… le total non plus');
  assert.ok(/<span class="need-plie">Famille<\/span>/.test(ferme.html),
    'la famille attend derrière « Détail »');
  assert.ok(/class="est-argent need-plie">À la pièce<\/span>/.test(ferme.html),
    '… le prix à la pièce aussi');
  // Le bouton vient APRÈS les paires visibles : glissé entre deux moitiés de
  // rangée, il décale la parité de la grille et le filet de première rangée
  // tombe sur une seule des deux cellules.
  assert.ok(ferme.html.indexOf('need-derouler') > ferme.html.indexOf('>Total<'),
    'la rangée « Détail » suit les rangées visibles, elle ne coupe pas une paire');

  const deroule = rendre([TASSES, TSHIRTS], -1, new Set([1]));
  assert.ok(/detail-ouvert/.test(deroule.html) && /aria-expanded="true"/.test(deroule.html),
    'l’état mémorisé rouvre la ligne au redessin suivant : le choix tient');
  assert.strictEqual((deroule.html.match(/detail-ouvert/g) || []).length, 1,
    '… et il ne rouvre QUE la ligne choisie');
}
// La suppression décale les indices : la mémoire d'ouverture se réindexe,
// sinon le déroulé saute sur la ligne d'en dessous.
assert.ok(/dmdDetailsOuverts=new Set\(\[\.\.\.dmdDetailsOuverts\]\.filter\(k=>k!==i\)\.map\(k=>k>i\?k-1:k\)\)/.test(source('deleteNeed', 'i')),
  'supprimer une ligne réindexe la mémoire du déroulé');
// Le clic sur « Détail » ne remonte pas jusqu'à la ligne : il ouvrirait la
// fiche à gauche en même temps qu'il déroule.
assert.ok(/ev\.stopPropagation\(\)/.test(source('basculerDetailArticle', 'i,ev')),
  'dérouler n’ouvre pas la fiche : le clic s’arrête à la rangée « Détail »');

// --- 3. Les indices se décalent ---------------------------------------------
// `needs.splice(i,1)` remonte tout ce qui suit : garder l'article ouvert
// afficherait le chiffrage d'un AUTRE article, et la négociation en cours
// porterait sur celui d'à côté.
const supprimer = source('deleteNeed', 'i');
assert.ok(/articleOuvert=-1/.test(supprimer) && /negFicheOuvert=false/.test(supprimer),
  'supprimer une ligne referme le détail : les indices derrière viennent de bouger');

// --- 4. Le clic sur la ligne -------------------------------------------------
const ouvrir = source('ouvrirArticle', 'i,ev');
assert.ok(/closest\('button,input,textarea,select'\)/.test(ouvrir),
  'un clic sur une commande de la ligne n’ouvre pas le détail');
assert.ok(/if\(!n\.textile\)return editNeed\(i\)/.test(ouvrir),
  'un article hors textile n’a pas de chiffrage : sa modification EST son détail');

// --- 5. Le partage des colonnes ---------------------------------------------
// Le panneau fait 380 px : les cartes de solutions de la négociation n'y
// tiennent pas. Le chiffrage vit à gauche, dans `renderDetailArticle`.
assert.ok(!/tx-card-metrics|negPanneau|tx-avis/.test(renderNeedsSrc),
  'le panneau de droite porte la demande, jamais le chiffrage ni la négociation');
const detail = source('renderDetailArticle', '');
assert.ok(/tx-card-metrics/.test(detail) && /negFicheVolet\(i\)/.test(detail),
  'le détail à gauche porte les chiffres de l’article et sa négociation');
assert.ok(/hote\.classList\.add\('hidden'\)/.test(detail) && /replaceChildren\(\)/.test(detail),
  'sans article ouvert le détail se VIDE : les chiffres d’une ligne supprimée ne doivent pas rester à l’écran');

// Les totaux du panneau s'écrivent avec une garde : ces cases ont déjà changé
// de forme deux fois, et un identifiant disparu arrêtait les six autres.
const totaux = source('txRefreshTotals', '');
assert.ok(/setTextSafe\('txKpi/.test(totaux) && !/\$\('txKpi[^']*'\)\.textContent/.test(totaux),
  'les totaux s’écrivent par `setTextSafe` : un identifiant disparu n’arrête pas les autres');

// La ligne porte DEUX actions dans 326 px : si un libellé s'allonge ou si le
// poste zoome, elles passent à la ligne au lieu de se comprimer.
assert.ok(/\.demande-corps \.need-actions\{[^}]*flex-wrap:wrap/.test(DEVIS),
  'la rangée d’actions peut passer à la ligne');

// --- 6. LA CARTE SE LIT, ELLE NE SE REMPLIT PAS -----------------------------
// Elle portait un champ de saisie sous les boutons (« Personnalisation ») et
// une TROISIÈME action, « Négociation » — la seule des trois qui n'agissait
// ni sur la ligne ni sur ce qu'elle porte. Le patron les a retirées le 24/08.
assert.ok(!/<input/.test(renderNeedsSrc),
  'aucun champ de saisie sur la carte : la note se tape dans le formulaire de l’article');
assert.ok(!/>Négociation</.test(renderNeedsSrc),
  'la carte ne porte plus de bulle « Négociation »');
// Depuis le 24/08 la carte porte AUSSI la rangée « Détail » — une commande de
// LECTURE (elle déroule ce que la carte dit, elle ne touche pas au dossier).
// La règle des deux actions reste entière : Modifier et Supprimer, dans
// .need-actions, et rien d'autre qui AGISSE.
// La garde compte ce qui AGIT, pas les balises. Depuis le 25/08 le titre de la
// carte est lui aussi un <button> : c'est le seul chemin CLAVIER pour ouvrir
// l'article (c'était le dernier <div onclick> du dépôt). Comme « Détail », il
// LIT — il ne touche pas au dossier. Ce qui agit reste dans `.need-actions`,
// et ils restent deux.
const actions = (renderNeedsSrc.match(/need-actions">(.*?)<\/div>/) || ['', ''])[1];
assert.strictEqual((actions.match(/<button/g) || []).length, 2,
  'deux actions et deux seules sur la carte : Modifier et Supprimer');
assert.ok(/>Modifier</.test(actions) && />Supprimer</.test(actions),
  '… et ce sont bien celles-là');
assert.strictEqual((renderNeedsSrc.match(/<button/g) || []).length, 4,
  'quatre boutons en tout : les deux actions, la rangée « Détail », et le titre qui ouvre la ligne');
assert.strictEqual((renderNeedsSrc.match(/class="need-actions"[\s\S]*?<\/div>/g) || [''])[0].split('<button').length - 1, 2,
  'DEUX actions qui agissent sur la carte, pas une de plus : Modifier et Supprimer');
assert.ok(!/function ouvrirNegociation/.test(DEVIS),
  'le raccourci de la ligne n’a plus de bouton : il s’en va avec lui');
// La négociation reste à UN clic : la carte ouvre la fiche, la fiche porte son
// volet — la même boîte que celui du ticket.
const negVolet = source('negFicheVolet', 'i');
assert.ok(/tx-volet/.test(negVolet) && /negPanneau\(i\)/.test(negVolet),
  'la négociation d’une ligne posée est un volet de la fiche');
assert.ok(/if\(!det\.isConnected\)return/.test(negVolet),
  '… avec la garde du volet retiré : un `toggle` différé n’ouvre pas la fiche suivante');
assert.ok(/TX_RECAP\.fiche=false/.test(negVolet),
  '… et l’ouvrir replie le récapitulatif sur son total');

// --- 7. LA CARTE SE LIT COMME UN TABLEAU ------------------------------------
// Elle en était deux : une grille de détail SANS FILET pour ce qui se lit, et
// un pied à part pour l'argent, collé aux boutons. Deux façons de présenter la
// même chose sur une carte de 322 px, et un bloc où l'œil ne trouvait pas de
// ligne à suivre. Une seule table maintenant, du premier mot au dernier
// chiffre — la langue du récapitulatif de l'article (voir `.tx-tableau`).
assert.ok(/need-tab/.test(renderNeedsSrc) && !/need-detail/.test(renderNeedsSrc),
  'le détail et l’argent sont UNE table, plus deux blocs');
assert.ok(!/demande-prix/.test(DEVIS),
  'le prix n’a plus de bloc à lui : il est devenu des rangées de la table');
assert.ok(renderNeedsSrc.indexOf("'Total'") > renderNeedsSrc.indexOf('lignes'),
  'l’argent FERME la table : la carte se lit de haut en bas');
// Intitulé à gauche, valeur à droite, un filet entre les rangées, tabular-nums.
assert.ok(/\.need-tab>b\{[^}]*text-align:right/.test(DEVIS)
  && /\.need-tab>b\{[^}]*font-variant-numeric:tabular-nums/.test(DEVIS),
  'les valeurs tiennent la droite, les chiffres sur la même verticale');
assert.ok(/\.need-tab>\*\{[^}]*border-top:1px solid var\(--border-soft\)/.test(DEVIS),
  'un filet sépare les rangées : c’est ce qui en fait un tableau');
assert.ok(/\.need-tab>:nth-child\(-n\+2\)\{border-top:0\}/.test(DEVIS),
  '… sauf la première : un tableau commence par une valeur, pas par un trait');
assert.ok(/\.need-tab\{[^}]*grid-template-columns:var\(--need-cle\) minmax\(0,1fr\)/.test(DEVIS),
  'sa colonne d’intitulés est le jeton fixe : deux cartes empilées s’alignent');
// (La carte n'est plus une grille depuis la 2e passe du 24/08 : le pied est
// un bloc, il prend toute la largeur sans qu'une piste ait à le dire.)
assert.ok(/\.need-pied\{display:flex/.test(DEVIS),
  'le pied ne porte plus que les actions, sur toute la largeur');
// Coller à droite par une MARGE AUTOMATIQUE : sur une rangée trop étroite,
// `justify-content:flex-end` fait sortir le contenu par la GAUCHE, et ce
// débordement n'est pas rattrapable au défilement.
assert.ok(/\.need-actions\{[^}]*margin-inline-start:auto/.test(DEVIS),
  'les actions ferment la rangée, poussées par une marge automatique');
assert.ok(!/\.(demande-corps \.)?need-actions\{[^}]*justify-content:flex-end/.test(DEVIS),
  '… jamais par flex-end');

// --- 8. TOUT LE TEXTE DE LA CARTE PART DU MÊME RAIL -------------------------
// En `auto`, chaque carte calculait ses colonnes sur SON contenu. Mesuré sur
// deux articles empilés : la pastille passait de 38 à 50 px (« 5× » contre
// « 120× ») et la colonne des intitulés de 74 à 83 px (« Marquage » contre
// « Production ») — le nom décalé de 11 px d'une carte à l'autre, les valeurs
// de 21 px. Deux jetons FIXES, comme `--tab-valeur` pour les tableaux.
assert.ok(/--need-cle\s*:\s*\d+px/.test(CHARTE),
  '--need-cle doit être déclaré au :root de la charte, en pixels');
// LA QUANTITÉ N'A PLUS DE RAIL (2e passe du 24/08) : « 3× » fait partie du
// titre — « 3× T-shirt … » d'un seul tenant — parce que la colonne qui lui
// était réservée repoussait le nom dans un panneau de 320 px.
assert.ok(!/--need-qte/.test(CHARTE) && !/var\(--need-qte\)/.test(DEVIS),
  'le rail de la quantité n’existe plus, ni le jeton qui le portait');
// Le titre est un <button> depuis le 25/08 (le seul chemin clavier pour ouvrir
// la ligne) ; ce que la garde protège n'a pas bougé : nombre et nom dans LE
// MÊME élément de titre, dans cet ordre.
assert.ok(/class="need-titre"[^>]*><span class="need-qte">/.test(DEVIS),
  'le nombre et le nom sont la même ligne de titre');
assert.ok(!/\.need-(ligne|tab)\{[^}]*grid-template-columns:auto/.test(DEVIS),
  'aucune piste `auto` sur la carte : c’est elle qui faisait glisser les rails');
// LA TABLE PREND TOUTE LA LARGEUR DE LA CARTE : dans 322 px, l'indenter d'une
// gouttière coûtait 68 px à la colonne des valeurs, et « Poitrine + Dos +
// Manche Dr · Multi couleur » y passait sur trois lignes. La carte étant un
// BLOC (2e passe du 24/08), la table est pleine largeur d'elle-même — ce qui
// se vérifie, c'est qu'aucune indentation ne revient.
assert.ok(/\.need-tab\{display:grid/.test(DEVIS) && !/\.need-tab\{[^}]*margin-inline-start/.test(DEVIS),
  'la table prend toute la largeur de la carte');
// L'EMPLACEMENT ET L'ENCRE SONT DEUX RANGÉES. Collés par un point, ils
// faisaient une valeur de 195 px : dans 322 px elle repassait à la ligne, et
// son intitulé se retrouvait à hauteur de la SECONDE ligne — sous le début de
// sa propre valeur.
// (le « ,1 » marque la rangée comme pliée derrière « Détail », voir 2 bis)
assert.ok(/\['Marquage',t\.printType,1\]/.test(renderNeedsSrc)
  && /\['Couleur',t\.markColor,1\]/.test(renderNeedsSrc),
  'le marquage et sa couleur tiennent chacun leur rangée');
assert.ok(!/\[t\.printType,t\.markColor\]/.test(renderNeedsSrc),
  '… ils ne sont plus collés dans une seule valeur');
// Et une valeur qui passerait quand même à la ligne garde son intitulé en face
// de sa PREMIÈRE ligne : calé en bas, l'intitulé descendait au niveau de la
// dernière et la valeur semblait commencer au-dessus de lui.
assert.ok(/\.need-tab>\*\{[^}]*align-items:flex-start/.test(DEVIS),
  'l’intitulé reste en face de la première ligne de sa valeur');
// (Le `gap` de grille est parti avec la grille : l'espacement vertical vient
// des marges de la table et du pied, la carte est un simple empilement.)
assert.ok(!/\.demande-corps \.need-ligne\{[^}]*gap:/.test(DEVIS),
  'plus de gap de grille sur une carte qui n’en est plus une');

// La feuille « Esprit SumUp » impose `padding:13px 22px!important` à toutes les
// pilules. Sans `!important` ici, chaque article coûtait 45 px de hauteur et le
// bouton « Construire le projet » passait sous la ligne de flottaison.
assert.ok(/\.demande-corps \.need-actions button\{[^}]*padding:var\(--champ-y-serre\) var\(--pas-2\)!important/.test(DEVIS),
  'les boutons de la ligne doivent battre le padding !important de la feuille du comptoir');

console.log('✓ demande à droite : catalogue et textile dans une seule liste, prix absent qui se dit, indices qui se referment');
