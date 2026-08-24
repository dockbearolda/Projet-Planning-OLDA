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

// Les tailles se composent en NŒUDS (le « × » est en gris, le nombre à
// l'encre) : le bac à sable n'a pas de DOM, on lui en donne juste assez pour
// que `txTaillesNode` s'exécute — et pour relire le texte qu'il produit.
class Noeud {
  constructor(cls, texte) {
    this.className = cls || '';
    this.enfants = texte == null ? [] : [String(texte)];
  }

  append(...n) { this.enfants.push(...n); }

  get childNodes() { return this.enfants; }

  get childElementCount() { return this.enfants.filter((e) => e instanceof Noeud).length; }

  get textContent() { return this.enfants.map((e) => (e instanceof Noeud ? e.textContent : e)).join(''); }
}

function lignesDeSaisie(d) {
  const contexte = vm.createContext({
    TE: () => ({ SIZE_KEYS: ['S', 'M', 'L', 'XL', 'XXL', 'other'],
      SIZE_LABELS: { S: 'S', M: 'M', L: 'L', XL: 'XL', XXL: '2XL', other: 'Autres' } }),
    txNum: (v) => Number(v) || 0,
    txDisplayRef: (x) => (x.isCustom ? (x.customRef || 'NOUVEAU') : x.ref),
    txEl: (tag, cls, texte) => new Noeud(cls, texte),
    d,
  });
  vm.runInContext(`${source('txSaisieLignes', 'd')}\n${source('txTaillesNode', 'd')}\nglobalThis.__r=txSaisieLignes(d);`, contexte);
  return contexte.__r;
}

// La valeur d'une rangée est un texte, sauf les tailles qui sont un nœud.
const lire = (v) => (v instanceof Noeud ? v.textContent : v);

const lignes = lignesDeSaisie(SAISIE);
const par = Object.fromEntries(lignes);

// --- 1. Les intitulés sont ceux des champs -----------------------------------
// Un récapitulatif qui rebaptise les champs oblige à traduire de tête entre le
// haut et le bas de la même page.
const LABELS = DEVIS.match(/<label[^>]*>([^<]+)/g).map((m) => m.replace(/<label[^>]*>/, '').trim());
// PLUS D'EXCEPTION : « Note » est redevenu un champ du formulaire le 24/08.
// Il en était sorti la veille pour vivre sur la ligne de la demande — mais un
// champ de saisie sur une carte qu'on relit n'a jamais eu sa place, et la note
// décide du fichier d'impression (voir txAlertes) : elle appartient à la
// saisie de l'article, avec les tailles et le marquage.
lignes.forEach(([intitule]) => {
  assert.ok(LABELS.includes(intitule),
    `« ${intitule} » doit être l’intitulé d’un champ du formulaire, pas un autre mot`);
});
assert.ok(/<label for="txNote">Note<\/label>/.test(DEVIS),
  'le champ « Note » est de retour dans le formulaire, sous son intitulé');
assert.ok(!/setNeedPerso/.test(DEVIS),
  '… et le champ posé sur la carte de la demande s’en va avec');

// --- 2. Tout ce qui est saisi se relit ---------------------------------------
assert.strictEqual(par['Référence'], 'K3008');
assert.strictEqual(par['Couleur textile'], 'Coconut Milk');
assert.strictEqual(par['Genre'], 'Bébé', 'le genre décide des temps de marquage : il se relit');
assert.strictEqual(par['Emplacement du marquage'], 'Poitrine + Dos');
assert.strictEqual(par['Couleur du marquage'], 'Kaki');
assert.strictEqual(par['Transport'], 'Chronopost');
// LE NOMBRE D'ABORD, LA TAILLE ENSUITE (23/08/2026). La rangée disait « M 2 »
// — qui se lit aussi bien « taille M2 » — et obligeait à traduire à chaque
// lecture. On écrit « 2 × M », dans l'ordre où la vendeuse le dit à voix haute.
assert.strictEqual(lire(par['Tailles']), '2×M', 'la quantité précède la taille');
// Deux tailles se recopient avec une VRAIE espace entre elles : un simple
// écart de mise en page donnerait « 2 × S4 × M » au copier-coller.
const deux = Object.fromEntries(lignesDeSaisie({
  ...SAISIE, sizes: { S: '2', M: '4', L: '', XL: '', XXL: '', other: '' },
}));
assert.strictEqual(lire(deux['Tailles']), '2×S 4×M', 'les paquets restent séparés dans le texte');
// Le « × » est le seul élément gris de la rangée : il ne porte aucune donnée.
const paquets = par['Tailles'].enfants.filter((e) => e instanceof Noeud);
assert.strictEqual(paquets.length, 1, 'une taille saisie, un paquet');
assert.ok(paquets[0].className === 'tx-taille'
  && paquets[0].enfants.some((e) => e instanceof Noeud && e.className === 'tx-taille-x'),
  'le paquet est insécable et son « × » porte sa propre classe');
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
assert.ok(/2 × M/.test(html), 'la ligne dit les tailles commandées, dans le même sens qu’ailleurs');
// NI LE GENRE NI LE TRANSPORT SUR LA LIGNE (23/08/2026). Le genre est une clé
// de barème — il décide des temps de marquage — pas ce qui distingue un
// article d'un autre pour la vendeuse ; le transport ne se lit qu'au moment de
// chiffrer. Les deux restent dans le récapitulatif et dans la fiche, sous leur
// intitulé (vérifié plus haut : txSaisieLignes les porte toujours).
assert.ok(!/Chronopost/.test(html) && !/Bébé/.test(html),
  'la ligne ne porte ni le transport ni le genre : elle dit ce qui distingue l’article');
assert.ok(par['Genre'] === 'Bébé' && par['Transport'] === 'Chronopost',
  '… mais le récapitulatif de l’article les garde, chacun sous son intitulé');
// Depuis le 24/08 la carte est une TABLE : l'intitulé est un `<span>`, sa
// valeur un `<b>` calé à droite (voir `.need-tab`).
assert.ok(/<span>Marquage<\/span>/.test(html) && /<span>Tailles<\/span>/.test(html),
  'chaque valeur porte son intitulé : « Coconut Milk » et « Kaki » ne se devinent pas');
assert.ok(/<span class="est-argent">Total<\/span>/.test(html),
  '… et l’argent ferme la table, sous son intitulé lui aussi');
// « Production DTF » n'a jamais été saisi au comptoir : c'est le code qui
// l'écrivait, et il occupait la place du marquage.
assert.ok(!/Production DTF/.test(html),
  'la ligne ne remplit plus la place avec ce que personne n’a choisi');

// Un article du catalogue n'a pas de chiffrage textile : il garde sa famille,
// et son intitulé aussi — une case vide décalerait toute la grille.
const catalogue = rendre([{ category: 'Art de la table', label: 'Bouchon Bois', qty: 3, comment: '', unitHT: NaN }]);
assert.ok(/<span>Famille<\/span><b>Art de la table/.test(catalogue),
  'un article hors textile garde sa famille, sous un intitulé');
assert.ok(!/<span><\/span>/.test(catalogue),
  'aucun intitulé vide : la colonne de gauche de la table resterait béante');
// Et il DIT qu'il reste à chiffrer, dans la rangée d'argent : il n'affiche
// jamais 0 € — « pas encore chiffré » et « gratuit » sont deux choses.
assert.ok(/a-chiffrer">À chiffrer<\/b>/.test(catalogue) && !/0,00/.test(catalogue),
  '… et sa rangée Total dit « À chiffrer », jamais 0 €');

// --- 4. Le bloc sous le formulaire et la fiche disent la MÊME chose ----------
const apercu = source('previewTextile', '');
const detail = source('renderDetailArticle', '');
// La relecture de la saisie passe par `txTableau`, des DEUX côtés : une ligne
// relue sous le formulaire ou dans la fiche à gauche doit se lire pareil.
assert.ok(/txTableau\(d,c\)/.test(apercu)
  && /txTableau\(n\.textile, ?c,'fiche'\)/.test(detail),
  'les deux vues montent le récapitulatif avec le même bloc');
// « VOIR LE CALCUL ET LA MARGE » EST À CÔTÉ DU RÉCAPITULATIF, PAS DEDANS
// (24/08/2026). Il y était logé (par un paramètre `dedans`) et disparaissait
// donc avec lui : un volet à ouvrir qu'il fallait d'abord déplier un autre
// volet pour trouver. Trois volets frères désormais — Récapitulatif article,
// Voir le calcul et la marge, Négociation — qu'on ouvre dans l'ordre qu'on veut.
assert.ok(!/txTableau\([^)]*\[txDetail/.test(DEVIS),
  'le calcul n’est plus glissé À L’INTÉRIEUR du récapitulatif');
assert.ok(!/function txTableau\(d,c,dedans/.test(DEVIS),
  '… et le paramètre qui servait à l’y glisser n’existe plus');
assert.ok(/txDetail\(d,c\),txNegVolet\(\)/.test(apercu),
  '… il se pose entre le récapitulatif et la négociation, au même niveau qu’eux');
assert.ok(/bloc\.append\(tete,rang,metrics,txDetail\(n\.textile,c\)/.test(detail),
  '… des deux côtés : sous le formulaire comme dans la fiche');
assert.ok(!/txDetailsBloc/.test(DEVIS),
  'le volet « Détail des champs » n’existe plus : la relecture ne se déplie pas');
// Le classement de l'atelier (« ⭐ PRIORITÉ OLDA ») ne s'affiche plus du tout :
// il tenait d'abord dans la valeur — « 436,74 € ⭐ PRIORITÉ OLDA » se lisait
// d'un bloc — puis en pastille, que le patron a retirée le 21/08. La marge à
// l'heure reste, c'est le chiffre.
assert.ok(!/c\.atelier/.test(DEVIS),
  'le classement de l’atelier ne s’affiche nulle part sur l’écran du comptoir');
assert.ok(/txRang\(g,'Marge \/ heure'/.test(DEVIS),
  '… la marge à l’heure, elle, reste une des rangées du tableau');

// --- 5. LE RÉCAPITULATIF REFAIT (21/08/2026) --------------------------------
// Chiffres clés en haut, jauge de marge à la place du badge « EXCELLENT »,
// décomposition du prix dépliable, détail des champs replié, barre d'action
// collante.
assert.ok(/txFill\(box,\[txTableau\(d,c\),txDetail\(d,c\),txNegVolet\(\),\.\.\.txAlertes\(d,c\)\]\)/.test(apercu),
  'le récapitulatif s’écrit dans l’ordre où il se lit : l’article, son calcul, la négociation, puis les alertes');
// LES ALERTES RESTENT DEHORS. Une alarme qu'on peut plier n'en est plus une :
// une dimension écrite dans la note engage la production, un prix manuel dit
// que le calcul ne décide plus du prix.
assert.ok(!/txAlertes/.test(source('txTableau', 'd,c,ou')),
  'les alertes ne se replient pas avec le récapitulatif');
// LE TITRE DE LA CARTE ET SON TOTAL SONT LA MÊME LIGNE (23/08/2026). Ils en
// faisaient deux — « Récapitulatif article » au-dessus, « Total HT … » en
// dessous, deux lignes pour dire une seule chose — et le chevron du volet se
// posait sur la seconde.
assert.ok(!/tx-tete-info|txTete|tx-tete-titre/.test(DEVIS),
  'plus de titre séparé : le titre EST le résumé du volet');
// La fiche ouverte à gauche écrit les mêmes blocs, dans le même ordre :
// le récapitulatif, son calcul à CÔTÉ de lui, puis les alertes.
assert.ok(/metrics,txDetail\(n\.textile,c\),\.\.\.txAlertes\(n\.textile,c\)/.test(detail),
  '… et la fiche à gauche les écrit dans le même ordre');
// CE QUE LA CARTE MONTRE SANS QU'ON OUVRE RIEN (23/08/2026).
// Elle portait dix rangées d'affilée : le prix, le total, puis le temps de
// production, la marge à l'heure, la marge, son seuil, sa cible, et le détail
// textile / marquage / transport / TGCA — pendant que ce qu'EST l'article
// (référence, couleur, genre, marquage, transport, tailles) dormait derrière
// « Détail des champs — pour relecture ». C'était l'inverse de ce qu'il faut :
// la lecture d'atelier noyait le prix qu'on annonce de vive voix, et le
// contrôle de saisie — la raison d'être d'un récapitulatif — demandait un clic.
// À découvert : les deux chiffres, puis l'article. Repliés : la marge et le
// calcul du prix.
const table = source('txTableau', 'd,c,ou');
assert.ok(/det\.append\(txKpiTotal\(c\),txSaisieBloc\(d\)\);/.test(table),
  'la carte montre son résumé, puis ce qu’est l’article — et RIEN d’autre');
assert.ok(!/txJauge|txDecompo|txAtelier/.test(table),
  'ni la marge, ni le coût atelier, ni la composition ne restent à découvert');
assert.ok(/txEl\('div','tx-tableau'\)/.test(source('txKpiTotal', 'c')),
  'et les chiffres annoncés sont bien une table');
// IL SE REPLIE SUR SON RÉSUMÉ, ET IL EST FERMÉ PAR DÉFAUT (23/08/2026). Ce
// résumé porte déjà les deux chiffres qu'on annonce — le total et le prix à la
// pièce — et le reste est une relecture qu'on ouvre au besoin. Ouvert d'office,
// il poussait la négociation et le bouton d'ajout d'une dizaine de rangées.
assert.ok(/txEl\('details','tx-recap'\)/.test(table) && /det\.open=TX_RECAP\[cle\]/.test(table),
  'le récapitulatif est un volet, ouvert selon sa mémoire');
assert.ok(/const TX_RECAP=\{form:false,fiche:false\};/.test(DEVIS),
  '… et cette mémoire vaut « fermé » par défaut, des deux côtés');
assert.ok(/if\(det\.isConnected\)TX_RECAP\[cle\]=det\.open/.test(table),
  '… avec le même garde-fou que l’autre volet : un `toggle` différé n’écrase plus la remise à zéro');
// CHAQUE SURFACE A SA PROPRE MÉMOIRE. Avec une mémoire commune, replier la
// fiche pour négocier faisait écrire le besoin SUIVANT déjà replié.
assert.ok(/txTableau\(n\.textile, ?c,'fiche'\)/.test(detail),
  'la fiche a sa propre mémoire d’ouverture');
assert.ok(/txDetailOuvert=false;TX_RECAP\.form=false;/.test(source('cancelTextileEdit', '')),
  '… et un nouveau besoin repart sur celle du formulaire, ouverte');
// NÉGOCIER, C'EST REGARDER UN SEUL CHIFFRE : les dix rangées de relecture
// poussaient les solutions hors de l'écran au moment de les comparer. Depuis
// le 24/08 la négociation d'une ligne posée est un VOLET de la fiche : c'est
// son ouverture qui replie le récapitulatif, comme sur le ticket.
const voletFiche = source('negFicheVolet', 'i');
assert.ok(/if\(det\.open&&TX_RECAP\.fiche\)\{TX_RECAP\.fiche=false;/.test(voletFiche),
  'ouvrir la négociation replie le récapitulatif sur son total');
assert.ok(/if\(!det\.isConnected\)return/.test(voletFiche),
  '… et un `toggle` différé sur un volet retiré n’écrit plus rien');
// Une fiche s'ouvre sur son récapitulatif replié, comme le ticket.
assert.ok(/TX_RECAP\.fiche=false;/.test(source('ouvrirArticle', 'i,ev')),
  'une fiche s’ouvre sur un récapitulatif replié');
// Sans prix demandé, la négociation n'écrit RIEN : le champ juste au-dessus
// porte déjà son intitulé, une phrase de plus décrivait l'écran.
assert.ok(!/Saisis le prix que le client demande/.test(DEVIS),
  'plus de phrase qui décrit le champ d’à côté');
// Les sept-huit rangées de l'article, à découvert : ce sont les intitulés du
// formulaire, mot pour mot (vérifié plus haut).
const saisie = source('txSaisieLignes', 'd');
['Couleur textile', 'Genre', 'Emplacement du marquage', 'Couleur du marquage', 'Transport', 'Tailles', 'Note']
  .forEach((champ) => assert.ok(saisie.includes(`'${champ}'`),
    `« ${champ} » se lit dans le récapitulatif, sans rien déplier`));
// UN SEUL PRIX EN GRAND, ET C'EST LE TOTAL, EN TÊTE (23/08/2026). Les deux
// étaient en 28 px l'un sous l'autre : deux nombres de même poids obligent à
// choisir lequel lire, et c'est le total que la vendeuse annonce. C'est aussi
// le RÉSUMÉ du volet : replié, c'est le seul chiffre qui reste.
const kpis = source('txKpiTotal', 'c');
assert.ok(/txEl\('summary'\)/.test(kpis) && /Récapitulatif article/.test(kpis),
  'le titre de la carte et ses prix sont le résumé du volet');
assert.ok(!/Temps de production|Marge/.test(kpis),
  '… et rien de la lecture d’atelier n’y monte');
// LES DEUX PRIX, L'UN SOUS L'AUTRE. Le volet étant fermé par défaut, un prix à
// la pièce resté dans le corps ne se voyait plus du tout.
assert.ok(/money\(c\.total\)/.test(kpis) && /\$\{money\(c\.sold\)\} \/ pièce/.test(kpis),
  'le résumé porte le total ET le prix à la pièce');
assert.ok(kpis.indexOf('c.total') < kpis.indexOf('c.sold'),
  '… le total d’abord, le prix à la pièce en dessous');
// Un seul chiffre en grand, et c'est le total.
assert.strictEqual((DEVIS.match(/font-size:var\(--recap-grand\)/g) || []).length, 1,
  'une seule déclaration de la grande taille dans toute la carte');
assert.ok(/\.tx-recap-total\{font-size:var\(--recap-grand\)/.test(DEVIS),
  '… et c’est le total qui la porte');
// LE CHEVRON NE SE DESSINE QU'UNE FOIS. `txRang` recopie la classe de
// l'intitulé sur la cellule de la valeur quand on ne lui en donne pas une :
// le chevron apparaissait alors une seconde fois, à gauche du prix à la pièce.
assert.ok(/txRang\(g,'Récapitulatif article',prix,'tx-recap-cle',null\)/.test(kpis),
  'la cellule du prix ne reprend pas la classe de l’intitulé');
// Le titre se lit à l'encre et en gras — pas en gris comme les intitulés qu'il
// coiffe —, et c'est lui qui porte le chevron.
assert.ok(/\.tx-recap>summary \.tx-recap-cle\{color:var\(--text-1\);font-weight:var\(--graisse-forte\)\}/.test(DEVIS)
  && /\.tx-recap>summary \.tx-recap-cle::before\{content:'▸'/.test(DEVIS),
  'le titre porte le chevron, et se lit comme un titre');
// TOUS LES VOLETS DE LA CARTE ONT LA MÊME RANGÉE (23/08/2026) : « Ajustements »
// gardait le triangle plein du navigateur et aucun rembourrage, les deux volets
// du récapitulatif un chevron fin posé à la main. Trois hauteurs et deux
// glyphes dans une pile de titres qu'on lit pourtant comme une liste.
assert.ok(/\.tx-adjust>summary,\.tx-volet>summary,\.tx-recap>summary\{[^}]*padding:var\(--pas-2\) 0\}/.test(DEVIS),
  'les trois volets de la carte partagent le rembourrage de leur rangée');
assert.ok(/\.tx-adjust>summary::before,\.tx-volet>summary::before\{content:'▸'/.test(DEVIS),
  '… et le même chevron, à la place du triangle du navigateur');
// UN VOLET SE DÉROULE, IL NE SAUTE PAS : ouvrir « Ajustements » faisait bondir
// toute la bulle d'une image à l'autre.
assert.ok(/#besoinTextileForm\{interpolate-size:allow-keywords\}/.test(DEVIS),
  'la hauteur « auto » est interpolable, sur le formulaire et pas au :root');
assert.ok(/::details-content[^}]*transition:height var\(--dur-2\)[^}]*content-visibility var\(--dur-2\) allow-discrete/.test(DEVIS),
  '… et le contenu glisse au lieu d’apparaître d’un coup');
assert.ok(/@media\(prefers-reduced-motion:reduce\)\{\s*\.tx-adjust::details-content/.test(DEVIS),
  '… sauf pour qui a demandé moins de mouvement');
// UN SEUL VOLET, PAS DEUX (23/08/2026). « Marge et composition » et « Voir le
// calcul » racontaient la même histoire en deux clics — et trois de leurs
// rangées deux fois : « Textile », « Marquage » et « Transport » redonnaient
// les montants que le calcul détaillait juste en dessous.
const volet = source('txDetail', 'd,c');
assert.ok(!/txMargeBloc|txDecompo|function txCalcul\(/.test(DEVIS),
  'les deux anciens volets et la composition en double ont disparu');
assert.ok(/det\.append\(sum,txCalculBloc\(d,c\),reste\)/.test(volet),
  'un clic ouvre la suite entière : comment le prix se construit, puis ce qu’il laisse');
assert.ok(/txAtelier\(reste,c\);\s*txJauge\(reste,c\)/.test(volet),
  '… et ce qu’il laisse, c’est le coût atelier puis la marge et ses repères');
assert.ok(/txEl\('div','tx-tableau'\)/.test(volet), 'le volet écrit dans une table de la même forme');
// La TGCA était la SEULE des quatre rangées de la composition que le calcul ne
// portait pas : elle y est passée, en fin de chaîne — tout ce qui précède est HT.
const calcul = source('txCalculBloc', 'd,c');
assert.ok(/txLigneCalcul\(g,'TGCA'/.test(calcul) && calcul.indexOf("'TGCA'") > calcul.indexOf('Total HT'),
  'la TGCA ferme le calcul, après le total HT');
// TOUS LES INTITULÉS SE LISENT PAREIL (23/08/2026). Quatre étaient en gras à
// l'encre pour marquer les « sommes intermédiaires » : l'œil sautait sur quatre
// lignes au milieu de dix sans savoir ce qui les rassemblait, et « Marquage »
// paraissait plus important qu'« Arrondi » sans raison. Il reste UNE marque,
// qui dit une seule chose : le trait fort sous lequel tombe le prix retenu.
assert.ok(!/est-somme/.test(DEVIS),
  'plus de gras qui distingue quatre intitulés des autres');
assert.strictEqual((calcul.match(/est-total/g) || []).length, 1,
  'une seule rangée marquée dans tout le calcul');
assert.ok(/txLigneCalcul\(g,'Prix HT \/ pièce',money\(c\.sold\),'est-total'\)/.test(calcul),
  '… et c’est celle où le prix est arrêté');
// La couleur de l'état ne va que sur la VALEUR : l'intitulé se lit comme les
// autres, sinon deux repères se disputent la même rangée.
assert.ok(/txRang\(g,`Seuil [^`]+`,verdict,null,etat\)/.test(source('txJauge', 'g,c')),
  'le verdict porte l’état, son intitulé reste un intitulé');
// CE QUE LE PRIX LAISSE COMMENCE PLUS BAS : un écart, pas un titre ni un
// deuxième trait fort qui se lirait comme un second total.
assert.ok(/\.tx-volet \.tx-tableau\+\.tx-tableau\{margin-top:var\(--pas-4\)\}/.test(DEVIS),
  'les deux tables du volet sont séparées par un écart franc');
// L'ÉTAT DU VOLET SURVIT À LA FRAPPE. Le récapitulatif se réécrit à chaque
// touche : sans mémoire, il se refermait sous les doigts dès qu'on corrigeait
// une taille.
assert.ok(/let txDetailOuvert=false;/.test(DEVIS),
  'le volet unique garde sa mémoire d’ouverture, fermé par défaut');
assert.ok(/det\.open=txDetailOuvert/.test(volet) && /txDetailOuvert=det\.open/.test(volet),
  '… elle est relue à l’ouverture et réécrite au basculement');
// UN VOLET RETIRÉ DU DOCUMENT DÉLIVRE ENCORE SON `toggle` : l'évènement est
// différé. Sans ce garde-fou, le volet du besoin qu'on vient de poser réécrit
// la mémoire APRÈS la remise à zéro, et le besoin suivant s'ouvre déjà déplié.
assert.ok(/if\(!det\.isConnected\)return;/.test(volet),
  'un volet déjà remplacé ne réécrit plus la mémoire');
// UN ÉLÉMENT, PAS UN FRAGMENT : le détail d'un article posé ajoute une classe
// au retour de txTableau, et un DocumentFragment n'a pas de `classList`.
assert.ok(/const det=txEl\('details','tx-recap'\)/.test(table),
  'txTableau rend un élément — l’appelant lui pose une classe');
// Le calcul déplié écrit dans une table de la MÊME forme : sans ça, ses
// valeurs ne tombent pas sous celles du récapitulatif.
assert.ok(/function txCalculBloc\(d,c\)\{\s*const g=txEl\('div','tx-tableau'\)/.test(DEVIS),
  'le calcul déplié se lit dans la même table');
assert.ok(/function txSaisieBloc\(d\)\{\s*const box=txEl\('div','tx-tableau'\)/.test(DEVIS),
  'la relecture des champs aussi');

assert.ok(!/tx-avis/.test(DEVIS),
  'le badge « EXCELLENT — VALIDÉ » a laissé la place à la jauge, ici comme dans la fiche');

// LES DEUX REPÈRES SONT CEUX DU PATRON. Écrits en dur (45 / 60), ils
// mentiraient dès la dixième pièce : les seuils baissent avec la quantité.
const jauge = source('txJauge', 'g,c');
assert.ok(/TE\(\)\.thresholdFor\(c\.qty\)/.test(jauge) && /seuil=t\.limited/.test(jauge) && /cible=t\.veryGood/.test(jauge),
  'seuil et cible viennent des seuils par quantité du moteur, jamais d’un nombre écrit en dur');
assert.ok(/Sous le seuil/.test(jauge) && /Au-dessus du seuil/.test(jauge) && /Au-dessus de la cible/.test(jauge),
  'la jauge dit lequel des trois états on occupe');
// La barre de remplissage a été retirée le 21/08 : elle ne disait rien que les
// trois nombres ne disent déjà, et elle amenait sa propre géométrie.
assert.ok(!/tx-rail|tx-fil|tx-tick/.test(DEVIS),
  'la marge se lit en chiffres — plus de barre, ni de style qui traîne derrière');

// Le moteur, lui, place bien 45 % et 60 % à neuf pièces — c'est ce que montre
// la maquette du patron.
const TE = (() => {
  const sandbox = { window: {}, module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(RACINE, 'public/comptoir/textile-catalog.js'), 'utf8'), sandbox);
  return sandbox.window.TextileEngine;
})();
assert.strictEqual(Math.round(TE.thresholdFor(9).limited * 100), 45, 'seuil à 9 pièces');
assert.strictEqual(Math.round(TE.thresholdFor(9).veryGood * 100), 60, 'cible à 9 pièces');
assert.ok(TE.thresholdFor(200).limited < TE.thresholdFor(9).limited,
  'les deux repères baissent quand la quantité monte');

// (L'état du volet unique est vérifié plus haut, avec le bloc qui le porte.)

// UNE DIMENSION ÉCRITE DANS LA NOTE ENGAGE LA PRODUCTION.
const [, motif] = DEVIS.match(/const TX_DIMENSION=(\/.*\/i);/);
const RE = eval(motif); // eslint-disable-line no-eval
['Le client veut que le logo avant mesure 120mm', 'marquage 30x40', 'poitrine 12,5 cm', 'dos 20 × 30']
  .forEach((note) => assert.ok(RE.test(note), `« ${note} » porte une dimension`));
['Prénom Léa sur la manche', 'urgent pour vendredi', 'logo doré']
  .forEach((note) => assert.ok(!RE.test(note), `« ${note} » n’en porte pas`));

// LA BARRE D'ACTION. Elle reste visible quand le prix ne l'est pas : c'est par
// son bouton qu'on apprend quel champ manque.
assert.ok(/\.tx-barre\{[^}]*position:sticky/.test(DEVIS), 'elle est collée en bas');
// ELLE NE PORTE QUE SES BOUTONS (23/08/2026). Elle répétait « T-shirt … ·
// 4 pièces · 123,60 € HT » juste sous le récapitulatif qui le dit déjà en plus
// grand, et sans prix calculable « Complète les champs obligatoires » — alors
// que le bouton pose l'erreur SUR le champ qui manque.
// Les commentaires du fichier CITENT la phrase retirée pour dire pourquoi :
// c'est le code qu'on interroge, pas ce qui l'explique.
const CODE = DEVIS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
assert.ok(!/txBarreObjet|tx-barre-objet|Complète les champs obligatoires/.test(CODE),
  'la barre ne redit pas ce que le récapitulatif dit déjà juste au-dessus');

// « AJOUTER UN BESOIN » EST TOUJOURS TOUT À DROITE — c'est la règle de
// l'écran. Le bouton d'à côté va et vient (« annuler » n'existe qu'en
// édition) : l'action qui engage doit donc être la DERNIÈRE du bloc, sinon sa
// place bouge d'un état à l'autre.
const barre = DEVIS.match(/<div class="tx-barre">([\s\S]*?)<\/div><\/div>/);
assert.ok(barre, 'la barre d’action doit rester repérable');
const ordre = [...barre[1].matchAll(/<button id="(\w+)"/g)].map((m) => m[1]);
assert.deepStrictEqual(ordre, ['txCancelBtn', 'txSaveBtn'],
  'le bouton qui ajoute ferme la rangée, quel que soit le bouton d’à côté');
// LE RACCOURCI NE S'ÉCRIT PLUS SUR LE BOUTON (23/08/2026) : la pastille disait
// la même chose à chaque article, à côté du seul bouton de la barre. La touche,
// elle, reste — vérifiée juste en dessous.
assert.ok(!/tx-kbd|txRaccourci/.test(DEVIS),
  'plus de pastille de raccourci sur le bouton');
// LA NÉGOCIATION EST UN VOLET DU TICKET (23/08/2026). C'était un bouton qui
// posait la ligne et emmenait la vendeuse sur une autre carte — trois gestes
// pour une question qui se pose en plein milieu de la saisie.
assert.ok(!/txNegBtn|negocierDepuisTicket|tx-lien/.test(DEVIS),
  'plus de bouton « le client négocie » : c’est un volet');
const negVolet = source('txNegVolet', '');
assert.ok(/txEl\('summary',null,'Négociation'\)/.test(negVolet)
  && /det\.append\(sum,negPanneau\('ticket'\)\)/.test(negVolet),
  'le volet s’appelle « Négociation » et déroule les possibilités, sur l’article en cours');
// L'ouvrir replie le récapitulatif — et une SEULE fois : sans la garde, chaque
// redessin rouvrirait la boucle (le volet se recrée ouvert, donc il rebascule).
assert.ok(/if\(det\.open&&TX_RECAP\.form\)\{TX_RECAP\.form=false;previewTextile\(\)\}/.test(negVolet),
  '… et l’ouvrir replie le récapitulatif, sans boucler sur son propre redessin');
// Collé à droite par une MARGE AUTOMATIQUE : trop large, un contenu aligné en
// fin de ligne sort par la GAUCHE de sa boîte, hors d’atteinte du défilement.
assert.ok(/\.tx-barre-actions\{[^}]*margin-inline-start:auto/.test(DEVIS),
  '… et le groupe est poussé à droite par une marge, pas par un alignement de fin de ligne');
// La même règle sur la saisie « Autre » : « Fermer » précède l'ajout.
const rangeeAutre = DEVIS.match(/<div class="actions a-droite">([\s\S]*?)<\/div>/);
assert.ok(rangeeAutre, 'la rangée de la saisie « Autre » suit la même règle');
assert.ok(rangeeAutre[1].indexOf('cancelNeedBtn') < rangeeAutre[1].indexOf('saveNeedBtn'),
  '« Ajouter un besoin » ferme la rangée, « Fermer » le précède');
// LE MÊME MOT SUR LES DEUX FORMULAIRES (23/08/2026) : le textile disait
// « Ajouter cet article », l'autre « Ajouter ce besoin » — deux libellés pour
// le même geste, sur le même écran.
assert.ok(!/Ajouter cet article|Ajouter ce besoin/.test(DEVIS),
  'plus qu’un seul libellé pour le geste qui pose une ligne');
assert.strictEqual((DEVIS.match(/Ajouter un besoin/g) || []).length, 4,
  '« Ajouter un besoin » : les deux boutons, et les deux remises à zéro');
// LE VOLET SE REFERME AVEC LA LIGNE QU'ON VIENT DE POSER. Sa mémoire existe
// pour qu'il ne se referme pas sous les doigts pendant la frappe, pas pour
// qu'un besoin s'ouvre déjà déplié parce que le précédent l'était.
const annuler = source('cancelTextileEdit', '');
assert.ok(/txDetailOuvert=false;/.test(annuler),
  'un besoin repart volet fermé');
assert.ok(/txDetailOuvert=false;/.test(source('editTextileNeed', 'i')),
  '… et une modification aussi');
// Le collage à droite ne dépend plus de la classe `a-droite` : TOUTE rangée de
// commandes finit à droite depuis le 24/08, par un écarteur flexible — un
// premier enfant MASQUÉ ne portait pas la marge (voir
// etape-projet-rangees-et-validation.test.js).
assert.ok(/\.actions::before\{content:"";flex:1 1 0;min-width:0\}/.test(DEVIS),
  '… et elle est collée à droite de la même façon');
// La barre ne décide plus d'aucun état : elle ne porte que ses deux boutons,
// et c'est par eux qu'on apprend quel champ manque.
assert.ok(!/txBarre/.test(DEVIS),
  'plus rien à mettre à jour dans la barre');
assert.ok(/id="txSaveLabel"/.test(DEVIS) && !/\$\('txSaveBtn'\)\.textContent/.test(DEVIS),
  'le libellé du bouton vit dans son propre nœud');
assert.ok(/ev\.key!=='Enter'\|\|!\(ev\.ctrlKey\|\|ev\.metaKey\)/.test(DEVIS),
  'Ctrl/Cmd + Entrée ajoute l’article sans lâcher le clavier');

// POSER LA LIGNE REND SON INDICE — c'est par lui que « Le client négocie »
// enchaîne sur l'article qu'on vient d'ajouter.
const enregistrer = source('saveTextileNeed', '');
assert.ok(/const pose=editingTextile>=0\?editingTextile:needs\.length-1;/.test(enregistrer)
  && /return pose;/.test(enregistrer),
  'l’enregistrement rend l’indice de la ligne posée');
// … et l'ordre compte : `cancelTextileEdit()` remet `editingTextile` à -1, donc
// la ligne modifiée serait confondue avec la dernière.
assert.ok(enregistrer.indexOf('const pose=') < enregistrer.indexOf('cancelTextileEdit()'),
  'l’indice se lit AVANT que le formulaire ne soit remis à zéro');
// « Dupliquer » a disparu des deux écrans où il vivait : la barre du ticket et
// la fiche. Rien ne doit en rester derrière.
assert.ok(!/duplicateTextileNeed|negBasculer/.test(DEVIS),
  'ni la duplication ni la bascule de négociation ne traînent en code mort');
// (Le commentaire de la fonction CITE les deux boutons retirés pour dire
// pourquoi : c'est le code qu'on interroge, pas ce qui l'explique.)
const fiche = source('renderDetailArticle', '').replace(/\/\*[\s\S]*?\*\//g, '');
assert.ok(/boutons\.append\(modifier\);/.test(fiche) && !/Dupliquer|Le client négocie/.test(fiche),
  'la fiche ne garde que « Modifier l’article »');

// --- 6. DEUX TAILLES DE TEXTE, PAS UNE DE PLUS (21/08/2026) -----------------
// La carte en comptait onze : 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 17, 20 et
// 27 px. Des écarts d'un demi-pixel que l'œil ne lit pas comme une hiérarchie,
// seulement comme du désordre — « c'est illisible », dit le patron. Une taille
// pour tout ce qui se lit, une pour les quatre chiffres clés, et la hiérarchie
// se fait à la GRAISSE et à la COULEUR.
const DEBUT = DEVIS.indexOf('/* ---- LE RÉCAPITULATIF DE L\'ARTICLE ---');
const FIN = DEVIS.indexOf('@media(max-width:700px){.tx-barre{position:static}}');
assert.ok(DEBUT > 0 && FIN > DEBUT, 'le bloc de style du récapitulatif doit rester repérable');
const STYLE = DEVIS.slice(DEBUT, FIN);

// LA COLONNE DES VALEURS EST LA MÊME PARTOUT. Elle vient d'un jeton de la
// charte, pas d'un « auto » : deux tables imbriquées — le récapitulatif et son
// calcul déplié — doivent aligner leurs virgules sur la même verticale, et
// « auto » les laisse chacune se dimensionner sur son plus long nombre.
const regleTable = STYLE.match(/\.tx-tableau\{([^}]*)\}/);
assert.ok(regleTable, 'la table du récapitulatif doit rester repérable');
assert.ok(/grid-template-columns:minmax\(0,1fr\) var\(--tab-valeur\)/.test(regleTable[1]),
  'une seule colonne de valeurs, large de --tab-valeur, pour toutes les tables de la carte');
// LE FILET D'UNE RANGÉE EST UN SEUL TRAIT. `align-items:baseline` posait
// l'intitulé et sa valeur sur la même ligne de base — mais PAS à la même
// hauteur de boîte : sur les deux rangées qu'on annonce, le nombre en 28 px
// commençait 11 px plus haut que son intitulé en 15 px, et comme c'est chaque
// CELLULE qui porte le trait, le filet se cassait en deux marches au milieu de
// la ligne. Les cellules s'étirent, leur contenu se pose en bas.
assert.ok(!/align-items:baseline/.test(regleTable[1]),
  'les cellules ne s’alignent plus sur la ligne de base : le filet se cassait en deux');
const regleCellule = STYLE.match(/\.tx-tableau>\*\{([^}]*)\}/);
assert.ok(regleCellule && /display:flex/.test(regleCellule[1]) && /align-items:flex-end/.test(regleCellule[1]),
  '… c’est le CONTENU de la cellule qui se pose en bas, la cellule prend toute la rangée');
assert.ok(/border-top:1px solid var\(--border-soft\)/.test(regleCellule[1]),
  '… et c’est bien la cellule qui porte le filet');
assert.ok(/\.tx-tableau>b\{[^}]*text-align:right/.test(STYLE)
  && /\.tx-tableau>b\{[^}]*font-variant-numeric:tabular-nums/.test(STYLE),
  'les valeurs sont alignées à droite, en chiffres de largeur fixe : c’est ce qui fait le tableau');
// Le filet fait la rangée — pas un cadre de plus autour de chaque bande.
assert.ok(/\.tx-tableau>\*\{[^}]*border-top:1px solid var\(--border-soft\)/.test(STYLE),
  'un filet sépare les rangées');
assert.ok(!/tx-jauge|tx-chip|tx-recap-kpis|tx-saisie\{/.test(DEVIS),
  'les cinq anciennes façons de présenter la même chose ont disparu');

const AUTORISEES = ['var(--recap-texte)', 'var(--recap-grand)', 'inherit'];
const tailles = [...STYLE.matchAll(/font-size:\s*([^;}!]+)/g)].map((m) => m[1].trim());
assert.ok(tailles.length >= 4, 'les tailles du bloc doivent bien être déclarées');
// Le reste de la carte n'en déclare AUCUNE : tout hérite. C'est ce qui rend la
// règle tenable — une bande de plus ne rouvre pas la question.
assert.ok(!/font-size:\s*[\d.]+px/.test(STYLE),
  'aucune taille en pixels dans le bloc : les deux seules vivent dans les variables');
tailles.forEach((t) => assert.ok(AUTORISEES.includes(t),
  `« font-size:${t} » — la carte n’a droit qu’à deux tailles : var(--recap-texte) et var(--recap-grand)`));

// Les deux tailles elles-mêmes, déclarées une seule fois, pour les trois
// surfaces qui portent ces blocs — le récapitulatif, sa barre, et la fiche.
// Depuis le 22/08 elles ne portent plus leurs propres nombres : elles pointent
// L'ÉCHELLE DE L'ÉCRAN, qui vit au `:root` de la page. La carte reste à deux
// tailles, mais ce sont désormais deux des quatre de la page — elle ne peut
// plus dériver de son côté.
const declaration = STYLE.match(/\.tx-preview,\.tx-barre,#detailArticle\{--recap-texte:var\(--([\w-]+)\);--recap-grand:var\(--([\w-]+)\);/);
assert.ok(declaration, 'les deux tailles se déclarent au même endroit, fiche comprise, et viennent de l’échelle');
// L'échelle vit dans charte.css depuis le 22/08 : c'est le même fichier pour
// le planning et pour les deux écrans du comptoir.
const CHARTE = fs.readFileSync(path.join(__dirname, '..', 'public/charte.css'), 'utf8');
assert.ok(/<link[^>]+charte\.css/.test(DEVIS), 'l’écran charge bien la charte de l’application');
const echelle = {};
for (const m of CHARTE.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/:root\s*\{([^}]*)\}/g)) {
  m[1].split(';').forEach((d) => {
    const i = d.indexOf(':');
    if (i > 0 && d.trim().startsWith('--')) echelle[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  });
}
const texte = Number.parseFloat(echelle['--' + declaration[1]]);
const grand = Number.parseFloat(echelle['--' + declaration[2]]);
assert.ok(texte > 0 && grand > 0, 'les deux tailles pointées existent bien dans l’échelle de la page');
assert.ok(texte >= 15, 'le texte courant ne descend pas sous 15 px : ces écrans se lisent debout');
assert.ok(grand > texte * 1.5,
  'les quatre chiffres clés se voient de loin — sinon les deux tailles n’en font qu’une');

// Et rien, dans la fiche, ne réintroduit une troisième taille par la porte de
// derrière : un bouton, une pastille, un intitulé et un champ décident chacun
// de la leur par défaut.
['#detailArticle button', '#detailArticle input', '#detailArticle label', '#detailArticle .help',
 '#detailArticle .badge'].forEach((sel) => assert.ok(STYLE.includes(sel),
  `${sel} doit être ramené à la taille de la carte`));
assert.ok(!/\.detail-nom\{[^}]*font-size/.test(DEVIS) && !/\.detail-meta\{[^}]*font-size/.test(DEVIS),
  'la tête de la fiche ne garde pas ses anciennes tailles');

// UNE SEULE POLICE. Les champs et les boutons n'héritent PAS de celle du corps
// sans qu'on le leur dise — c'est ce qui donnait des écrans bariolés, champ
// par champ, sur les postes Windows de l'atelier.
assert.ok(/input,select,textarea,button\{font-family:inherit!important\}/.test(DEVIS),
  'tout ce qui s’écrit hérite de la police du corps');

console.log('✓ récapitulatif : intitulés des champs, jauge seuil/cible, calcul dépliable, deux tailles de texte');
