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
const detail = source('renderDetailArticle', '');
// La relecture de la saisie passe par `txTableau`, des DEUX côtés : une ligne
// relue sous le formulaire ou dans la fiche à gauche doit se lire pareil.
assert.ok(/txTableau\(d,c\)/.test(apercu) && /txTableau\(n\.textile, ?c\)/.test(detail),
  'les deux vues montent le récapitulatif avec le même bloc');
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
assert.ok(/txTete\(\),txTableau\(d,c\),txMargeBloc\(d,c\),txCalcul\(d,c\),\.\.\.txAlertes\(d,c\)/.test(apercu),
  'le récapitulatif s’écrit dans l’ordre où il se lit : ce qu’on annonce et ce qu’est l’article, puis la marge, le calcul, les alertes');
// L'EN-TÊTE N'EST QUE SON TITRE (23/08/2026). Il portait « 2 pièces · avant
// ajout au projet » : le nombre de pièces se relit deux rangées plus bas dans
// les tailles, et la seconde moitié décrivait l'écran à qui l'a sous les yeux.
const tete = source('txTete', '');
assert.ok(!/tx-tete-info/.test(DEVIS) && !/pièce/.test(tete),
  'l’en-tête du récapitulatif ne redit ni le nombre de pièces ni où l’on se trouve');
// La fiche ouverte à gauche écrit les mêmes blocs, dans le même ordre.
assert.ok(/metrics,txMargeBloc\(n\.textile,c\),txCalcul\(n\.textile,c\),\.\.\.txAlertes\(n\.textile,c\)/.test(detail),
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
const table = source('txTableau', 'd,c');
assert.ok(/txKpis\(g,c\);\s*bloc\.append\(g,txSaisieBloc\(d\)\)/.test(table),
  'la carte montre les chiffres annoncés, puis ce qu’est l’article');
assert.ok(!/txJauge|txDecompo|txAtelier/.test(table),
  'ni la marge, ni le coût atelier, ni la composition ne restent à découvert');
assert.ok(/txEl\('div','tx-tableau'\)/.test(table), 'et les chiffres annoncés sont bien une table');
// Les sept-huit rangées de l'article, à découvert : ce sont les intitulés du
// formulaire, mot pour mot (vérifié plus haut).
const saisie = source('txSaisieLignes', 'd');
['Couleur textile', 'Genre', 'Emplacement du marquage', 'Couleur du marquage', 'Transport', 'Tailles', 'Note']
  .forEach((champ) => assert.ok(saisie.includes(`'${champ}'`),
    `« ${champ} » se lit dans le récapitulatif, sans rien déplier`));
const kpis = source('txKpis', 'g,c');
assert.ok(/Prix HT \/ pièce/.test(kpis) && /Total HT/.test(kpis),
  'les deux chiffres à découvert sont le prix à la pièce et le total');
assert.ok(!/Temps de production|Marge/.test(kpis),
  '… et rien d’autre');
// UN SEUL PRIX EN GRAND, ET C'EST LE TOTAL, EN TÊTE (23/08/2026). Les deux
// étaient en 28 px l'un sous l'autre : deux nombres de même poids obligent à
// choisir lequel lire, et c'est le total que la vendeuse annonce.
assert.ok(kpis.indexOf('Total HT') < kpis.indexOf('Prix HT / pièce'),
  'le total ouvre la carte, le prix à la pièce vient après');
assert.strictEqual((kpis.match(/est-annonce/g) || []).length, 1,
  'un seul chiffre porte la grande taille : le total');
assert.ok(/txRang\(g,'Total HT',money\(c\.total\),null,'est-annonce'\)/.test(kpis),
  '… et c’est bien le total qui la porte');
// Le volet porte les huit rangées, dans une table de la MÊME forme : sans ça,
// ses valeurs ne tombent pas sous celles du dessus quand on l'ouvre.
const volet = source('txMargeBloc', 'd,c');
assert.ok(/txEl\('div','tx-tableau'\)/.test(volet), 'le volet écrit dans une table de la même forme');
assert.ok(/txAtelier\(g,c\);\s*txJauge\(g,c\);\s*txDecompo\(g,d,c\)/.test(volet),
  'il porte le coût atelier, la marge et la composition, dans cet ordre');
// L'ÉTAT DU VOLET SURVIT À LA FRAPPE. Le récapitulatif se réécrit à chaque
// touche : sans mémoire, il se refermait sous les doigts dès qu'on corrigeait
// une taille — le même piège que les deux volets d'à côté.
assert.ok(/let txCalculOuvert=false,txMargeOuverte=false;/.test(DEVIS),
  'les deux volets qui restent — la marge et le calcul — ont chacun leur mémoire');
assert.ok(/det\.open=txMargeOuverte/.test(volet) && /txMargeOuverte=det\.open/.test(volet),
  '… elle est relue à l’ouverture et réécrite au basculement');
// UN ÉLÉMENT, PAS UN FRAGMENT : le détail d'un article posé ajoute une classe
// au retour de txTableau, et un DocumentFragment n'a pas de `classList`.
assert.ok(/const bloc=txEl\('div'\)/.test(table),
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

// L'ÉTAT DES PANNEAUX SURVIT À LA FRAPPE. Le récapitulatif se réécrit à
// chaque touche : sans mémoire, le volet se refermait sous les doigts.
// (Celui de la marge est vérifié plus haut, avec le bloc qui le porte.)
assert.ok(/det\.open=txCalculOuvert/.test(DEVIS) && /txCalculOuvert=det\.open/.test(DEVIS),
  'le calcul se rouvre comme on l’avait laissé');

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

// « AJOUTER CET ARTICLE » EST TOUJOURS TOUT À DROITE — c'est la règle de
// l'écran. Les deux boutons secondaires vont et viennent (« dupliquer » n'existe
// qu'une fois le prix calculé, « annuler » qu'en édition) : l'action qui engage
// doit donc être la DERNIÈRE du bloc, sinon sa place bouge d'un état à l'autre.
const barre = DEVIS.match(/<div class="tx-barre">([\s\S]*?)<\/div><\/div>/);
assert.ok(barre, 'la barre d’action doit rester repérable');
const ordre = [...barre[1].matchAll(/<button id="(\w+)"/g)].map((m) => m[1]);
assert.deepStrictEqual(ordre, ['txDupBtn', 'txCancelBtn', 'txSaveBtn'],
  'le bouton qui ajoute ferme la rangée, quels que soient les boutons d’à côté');
// Collé à droite par une MARGE AUTOMATIQUE : trop large, un contenu aligné en
// fin de ligne sort par la GAUCHE de sa boîte, hors d’atteinte du défilement.
assert.ok(/\.tx-barre-actions\{[^}]*margin-inline-start:auto/.test(DEVIS),
  '… et le groupe est poussé à droite par une marge, pas par un alignement de fin de ligne');
// La même règle sur la saisie « Autre » : « Fermer » précède l'ajout.
const rangeeAutre = DEVIS.match(/<div class="actions a-droite">([\s\S]*?)<\/div>/);
assert.ok(rangeeAutre, 'la rangée de la saisie « Autre » suit la même règle');
assert.ok(rangeeAutre[1].indexOf('cancelNeedBtn') < rangeeAutre[1].indexOf('saveNeedBtn'),
  '« Ajouter ce besoin » ferme la rangée, « Fermer » le précède');
assert.ok(/\.actions\.a-droite>:first-child\{margin-inline-start:auto\}/.test(DEVIS),
  '… et elle est collée à droite de la même façon');
assert.ok(/txBarre\(c\);\s*if\(!c\)\{/.test(apercu),
  'elle se met à jour AVANT de renoncer : sans prix, elle doit encore parler');
// Le libellé du bouton vit dans son propre nœud : `textContent` sur le bouton
// entier effacerait la pastille du raccourci.
assert.ok(/id="txSaveLabel"/.test(DEVIS) && !/\$\('txSaveBtn'\)\.textContent/.test(DEVIS),
  'changer le libellé du bouton n’efface pas le raccourci écrit dessus');
assert.ok(/ev\.key!=='Enter'\|\|!\(ev\.ctrlKey\|\|ev\.metaKey\)/.test(DEVIS),
  'Ctrl/Cmd + Entrée ajoute l’article sans lâcher le clavier');

// « Ajouter et dupliquer » pose la ligne ET garde la saisie pour la variante.
const enregistrer = source('saveTextileNeed', 'dupliquer');
assert.ok(/const pose=editingTextile>=0\?editingTextile:needs\.length-1;/.test(enregistrer)
  && /if\(dupliquer===true\)duplicateTextileNeed\(pose\)/.test(enregistrer),
  'le duplicata repart de la ligne qu’on vient de poser, pas d’un indice périmé');
// … et l'ordre compte : `cancelTextileEdit()` remet `editingTextile` à -1.
assert.ok(enregistrer.indexOf('const pose=') < enregistrer.indexOf('cancelTextileEdit()'),
  'l’indice se lit AVANT que le formulaire ne soit remis à zéro');

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
