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
assert.ok(/txDetailsBloc\(d\)/.test(apercu),
  'le bloc sous le formulaire relit la saisie en cours');
const detail = source('renderDetailArticle', '');
assert.ok(/txSaisieBloc\(n\.textile\)/.test(detail),
  'la fiche ouverte à gauche relit la saisie de l’article');
assert.ok(/function txDetailsBloc\(d\)\{[\s\S]*?txSaisieBloc\(d\)/.test(DEVIS),
  '… et le détail replié porte bien cette même relecture');
// Le classement de l'atelier (« ⭐ PRIORITÉ OLDA ») ne s'affiche plus du tout :
// il tenait d'abord dans la valeur — « 436,74 € ⭐ PRIORITÉ OLDA » se lisait
// d'un bloc — puis en pastille, que le patron a retirée le 21/08. La marge à
// l'heure reste, c'est le chiffre.
assert.ok(!/c\.atelier/.test(DEVIS),
  'le classement de l’atelier ne s’affiche nulle part sur l’écran du comptoir');
assert.ok(/txKpi\('Marge \/ heure'/.test(DEVIS),
  '… la marge à l’heure, elle, reste un des quatre chiffres clés');

// --- 5. LE RÉCAPITULATIF REFAIT (21/08/2026) --------------------------------
// Chiffres clés en haut, jauge de marge à la place du badge « EXCELLENT »,
// décomposition du prix dépliable, détail des champs replié, barre d'action
// collante.
assert.ok(/txTete\(c\),txKpis\(c\),txJauge\(c\),txDecompo\(d,c\),\.\.\.txAlertes\(d,c\),txDetailsBloc\(d\)/.test(apercu),
  'le récapitulatif s’écrit dans l’ordre où il se lit : chiffres, marge, prix, alertes, saisie');
assert.ok(!/tx-avis/.test(DEVIS),
  'le badge « EXCELLENT — VALIDÉ » a laissé la place à la jauge, ici comme dans la fiche');

// LES DEUX REPÈRES SONT CEUX DU PATRON. Écrits en dur (45 / 60), ils
// mentiraient dès la dixième pièce : les seuils baissent avec la quantité.
const jauge = source('txJauge', 'c');
assert.ok(/TE\(\)\.thresholdFor\(c\.qty\)/.test(jauge) && /seuil=t\.limited/.test(jauge) && /cible=t\.veryGood/.test(jauge),
  'seuil et cible viennent des seuils par quantité du moteur, jamais d’un nombre écrit en dur');
assert.ok(/Sous le seuil/.test(jauge) && /Au-dessus du seuil/.test(jauge) && /Au-dessus de la cible/.test(jauge),
  'la jauge dit lequel des trois états on occupe');
assert.ok(/Math\.max\(0,Math\.min\(100,c\.mark\*100\)\)/.test(jauge),
  'une marge négative ne fait pas déborder la jauge');

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

// L'ÉTAT DES DEUX PANNEAUX SURVIT À LA FRAPPE. Le récapitulatif se réécrit à
// chaque touche : sans mémoire, le détail se refermait sous les doigts.
assert.ok(/let txCalculOuvert=false,txDetailsOuvert=false;/.test(DEVIS),
  'les deux panneaux dépliables gardent leur état hors du rendu');
assert.ok(/det\.open=txDetailsOuvert/.test(DEVIS) && /txDetailsOuvert=det\.open/.test(DEVIS),
  'le détail des champs se rouvre comme on l’avait laissé');
assert.ok(/det\.open=txCalculOuvert/.test(DEVIS) && /txCalculOuvert=det\.open/.test(DEVIS),
  'le calcul aussi');

// UNE DIMENSION ÉCRITE DANS LA NOTE ENGAGE LA PRODUCTION.
const [, motif] = DEVIS.match(/const TX_DIMENSION=(\/.*\/i);/);
const RE = eval(motif); // eslint-disable-line no-eval
['Le client veut que le logo avant mesure 120mm', 'marquage 30x40', 'poitrine 12,5 cm', 'dos 20 × 30']
  .forEach((note) => assert.ok(RE.test(note), `« ${note} » porte une dimension`));
['Prénom Léa sur la manche', 'urgent pour vendredi', 'logo doré']
  .forEach((note) => assert.ok(!RE.test(note), `« ${note} » n’en porte pas`));

// LA BARRE D'ACTION. Elle reste visible quand le prix ne l'est pas : c'est par
// son bouton qu'on apprend quel champ manque.
assert.ok(/<div class="tx-barre"><span class="tx-barre-objet" id="txBarreObjet">/.test(DEVIS),
  'la barre d’action porte ce qu’on s’apprête à ajouter');
assert.ok(/\.tx-barre\{[^}]*position:sticky/.test(DEVIS), 'elle est collée en bas');
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
const declaration = STYLE.match(/\.tx-preview,\.tx-barre,#detailArticle\{--recap-texte:(\d+)px;--recap-grand:(\d+)px;/);
assert.ok(declaration, 'les deux tailles se déclarent au même endroit, fiche comprise');
assert.ok(Number(declaration[1]) >= 15, 'le texte courant ne descend pas sous 15 px : ces écrans se lisent debout');
assert.ok(Number(declaration[2]) > Number(declaration[1]) * 1.5,
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
