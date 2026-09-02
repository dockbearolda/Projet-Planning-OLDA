'use strict';

// ===========================================================================
// LE DEVIS — le troisième papier, et l'écran qui le compose (01/09/2026)
// ===========================================================================
// L'écran du patron est rentré dans le CRM. Ce fichier tient les trois choses
// qui coûtent cher si elles dérivent :
//
//   1. L'ARITHMÉTIQUE. C'est un document qui engage la maison. Le montant du
//      papier, celui de l'écran et celui de l'archive sortent de la MÊME
//      fonction — deux calculs qui se ressemblent finissent par se contredire,
//      et c'est le client qui trouve l'écart.
//   2. LE PAPIER. Mêmes pièges que le ticket et le bon de commande : un accent
//      grave referme le gabarit (écran NU), un jeton de `charte.css` y vaut
//      VIDE (rembourrage à zéro sur le papier, et nulle part ailleurs).
//   3. LE PRIX FIGÉ. Un tarif qui change demain ne retarife jamais un devis
//      déjà remis au client. La règle est la même que pour `fiche.chiffrage` ;
//      elle est jouée ici de bout en bout, contre le vrai serveur.
//
// Et une quatrième, celle de la charte : cet écran n'invente AUCUN composant.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { chargerPapier } = require('./socle-papier');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');

const DEVIS = lire('public/devis.js');
const ECRAN = lire('public/devis-flash.js');
const FEUILLE = lire('public/devis-flash.css');
const FICHE_CSS = lire('public/fiche-atelier.css');
const APP = lire('public/app.js');
const INDEX = lire('public/index.html');
const CHARTE_CSS = lire('public/charte.css');
const REGLAGES_JS = lire('public/reglages.js');
const REGLAGES_CSS = lire('public/reglages.css');

const {
  CSS_DEVIS, modeleDevis, dessinerDevis, calculerDevis, jourPlus,
} = chargerPapier('devis.js',
  ['CSS_DEVIS', 'modeleDevis', 'dessinerDevis', 'calculerDevis', 'jourPlus']);

// Un DOM minimal : c'est lui qui prouve que le papier se dessine hors
// navigateur, et il se perd au premier `style.width` posé à la main.
function faireDoc() {
  const mk = () => ({
    className: '', textContent: '', children: [],
    append(...n) { this.children.push(...n); },
  });
  return { createElement: mk };
}
const texteEntier = (n) => (n.textContent || '') + n.children.map(texteEntier).join(' ');
function tousLes(n, cls) {
  const out = String(n.className || '').split(' ').includes(cls) ? [n] : [];
  for (const e of n.children) out.push(...tousLes(e, cls));
  return out;
}

// ---------------------------------------------------------------------------
// 1. L'ARITHMÉTIQUE — l'addition tombe juste PAR CONSTRUCTION
// ---------------------------------------------------------------------------
// On arrondit le TTC, puis le HT au centime, et la taxe est CE QUI RESTE. Sans
// ça, un devis peut imprimer 100,00 + 4,00 = 104,01, et c'est le genre de ligne
// qui fait rappeler un comptable.
{
  const c = calculerDevis({
    lignes: [
      { designation: 'T-shirt', quantite: 30, unitaireHt: 14.30 },
      { designation: 'Transport', quantite: 30, unitaireHt: 1.80 },
    ],
    regime: 'tgca', tauxTgca: 0.04, arrondi: 'euro', acompte: 50,
  });
  assert.strictEqual(c.sousTotalHt, 483, 'la somme des lignes');
  assert.strictEqual(c.ttc, 502, 'l’arrondi commercial porte sur le TTC, à l’euro inférieur');
  assert.strictEqual(c.totalHt + c.taxe, c.ttc,
    `HT + taxe doit valoir le TTC au centime (obtenu : ${c.totalHt} + ${c.taxe})`);
  assert.strictEqual(c.ecart, Math.round((c.totalHt - c.sousTotalHt) * 100) / 100,
    'l’arrondi affiché est bien l’écart entre le sous-total et le total HT');
  assert.strictEqual(c.acompte.montant + c.acompte.solde, c.ttc,
    'l’acompte et le solde se somment au total : le client ne doit ni un centime de plus ni de moins');
}
// L'ADDITION TOMBE JUSTE SUR TOUS LES ARRONDIS, pas seulement sur celui qu'on a
// essayé à la main. Un centime perdu ne se voit pas sur un devis ; il se voit
// sur la centième facture.
for (const arrondi of ['aucun', 'euro', 'dix']) {
  for (const pu of [1.99, 7.77, 14.3, 133.33]) {
    for (const q of [1, 3, 17]) {
      const c = calculerDevis({
        lignes: [{ designation: 'x', quantite: q, unitaireHt: pu }],
        regime: 'tgca', tauxTgca: 0.04, arrondi, acompte: 30,
      });
      assert.strictEqual(Math.round((c.totalHt + c.taxe) * 100) / 100, c.ttc,
        `HT + taxe ≠ TTC pour ${q} × ${pu} € (arrondi « ${arrondi} »)`);
      assert.strictEqual(Math.round((c.acompte.montant + c.acompte.solde) * 100) / 100, c.ttc,
        `acompte + solde ≠ TTC pour ${q} × ${pu} € (arrondi « ${arrondi} »)`);
      assert.ok(c.ttc <= Math.round(c.sousTotalHt * 1.04 * 100) / 100 + 0.001,
        'un arrondi commercial descend, il ne monte jamais : il ne se fait pas au détriment du client');
    }
  }
}
// UN RÉGIME EXEMPTÉ NE TAXE RIEN, et le dit sur le papier : c'est une mention
// obligatoire, pas une ligne à zéro qu'on laisserait passer.
for (const regime of ['revente', 'export']) {
  const c = calculerDevis({
    lignes: [{ designation: 'x', quantite: 2, unitaireHt: 50 }],
    regime, tauxTgca: 0.04, arrondi: 'aucun', acompte: 0,
  });
  assert.strictEqual(c.taxe, 0, `« ${regime} » ne porte aucune taxe`);
  assert.strictEqual(c.ttc, 100, 'et le total vaut le HT');
  assert.ok(/non applicable/i.test(c.regime.label), 'la mention figure sur le devis');
}
// LE TAUX DE TGCA VIENT DES RÉGLAGES, il n'est pas écrit dans le moteur : le
// jour où il bouge, il ne doit bouger qu'à un endroit.
assert.ok(!/0\.04|4\s*%/.test(DEVIS.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')),
  'aucun taux de taxe en dur dans devis.js : il se règle, il ne se déploie pas');
{
  const c = calculerDevis({
    lignes: [{ designation: 'x', quantite: 1, unitaireHt: 100 }],
    regime: 'tgca', tauxTgca: 0.10, arrondi: 'aucun', acompte: 0,
  });
  assert.strictEqual(c.ttc, 110, 'le taux passé fait foi');
}
// UNE QUANTITÉ OU UN PRIX ABERRANT NE CASSE PAS LE DEVIS : il vaut zéro, il ne
// vaut jamais NaN — un « NaN € » imprimé devant le client, c'est la vente.
{
  const c = calculerDevis({
    lignes: [{ designation: 'x', quantite: 'douze', unitaireHt: -5 }],
    regime: 'tgca', tauxTgca: 0.04, arrondi: 'euro', acompte: 50,
  });
  assert.strictEqual(c.ttc, 0);
  assert.ok(Number.isFinite(c.acompte.montant));
}
// LA VALIDITÉ SE COMPTE SUR LE CALENDRIER, pas sur l'horloge : l'atelier est à
// Saint-Martin (UTC−4) et le conteneur tourne en UTC.
assert.strictEqual(jourPlus('2026-12-31', 30), '2027-01-30', 'le passage d’année');
assert.strictEqual(jourPlus('2026-02-28', 1), '2026-03-01', 'et celui d’un mois court');

// ---------------------------------------------------------------------------
// 2. LE PAPIER — mêmes gardes que les deux autres
// ---------------------------------------------------------------------------
assert.match(DEVIS, /import \{[^}]*\bJETONS_PAPIER\b[^}]*\bSOCLE_PAPIER\b[^}]*\} from '\.\/papier\.js';/,
  'le devis prend le socle partagé, il ne réécrit pas sa grammaire');
assert.ok(/maisonPapier/.test(DEVIS) && !/function\s+maisonDe\b/.test(DEVIS),
  'l’identité de la maison vient du socle, elle ne se refabrique pas ici');
for (const jeton of ['--pap-encre', '--pap-ardoise', '--pap-filet', '--pap-cap', '--pap-marge']) {
  assert.ok(!new RegExp(`${jeton}\\s*:`).test(DEVIS),
    `devis.js redéclare ${jeton} : le socle ne sert plus à rien`);
}
// UN ACCENT GRAVE — le caractère — referme le gabarit. Le module reste valide,
// `node --check` passe, et l'écran s'ouvre NU. C'est le contrôle le moins cher
// du dépôt, et il a déjà servi trois fois sur les deux autres papiers.
assert.ok(!CSS_DEVIS.includes(String.fromCharCode(96)),
  'un accent grave dans CSS_DEVIS referme le gabarit : l’écran s’affiche NU');
// AUCUN JETON ÉTRANGER : le cadre d'impression ne charge QUE cette chaîne. Un
// `var(--pas-3)` y vaut la chaîne vide — rembourrage à zéro SUR LE PAPIER, et
// nulle part ailleurs : l'aperçu a la charte et paraît impeccable.
assert.deepStrictEqual(CSS_DEVIS.match(/var\(--(?!dv-|pap-)[\w-]+\)/g) || [], [],
  'la feuille du devis ne lit que ses propres jetons et ceux du socle');
assert.ok(/width:\s*210mm/.test(CSS_DEVIS) && /min-height:\s*297mm/.test(CSS_DEVIS),
  'la feuille fait un A4 par construction');
// TROIS CRANS DE TEXTE, plus celui des intitulés qui vient du socle. Le patron
// en avait dix ; ça se voit, et sur un document qu'on imprime devant le client
// ça coûte une réimpression.
{
  // Le cran du corps est posé par le raccourci `font:` sur la feuille elle-même,
  // les deux autres par `font-size:` : on lit donc les deux écritures.
  const crans = new Set((CSS_DEVIS.match(/font(?:-size)?:\s*(?:\d+\s+)?var\((--[\w-]+)\)/g) || [])
    .map((m) => m.match(/--[\w-]+/)[0]));
  crans.delete('--pap-cap');
  assert.deepStrictEqual([...crans].sort(), ['--dv-cle', '--dv-geant', '--dv-texte'],
    `le devis déclare trois crans, pas ${crans.size} : ${[...crans].join(', ')}`);
  assert.deepStrictEqual(CSS_DEVIS.match(/font-size:\s*\d+px/g) || [], [],
    'aucune taille écrite en clair : elles passent toutes par un des trois crans');
}
// LE RENDU RESTE PORTABLE : un `.style` posé à la main perd la vérification
// hors navigateur — le DOM minimal des tests n'a pas de propriété `style`.
{
  const rendu = DEVIS.slice(DEVIS.indexOf('export function dessinerDevis'));
  assert.ok(!/\.style\b/.test(rendu),
    'devis.js ne pose aucun style en ligne : les largeurs se déclarent en CSS');
}
// L'IDENTITÉ VIENT DES RÉGLAGES, JAMAIS DU CODE : une adresse écrite en dur
// demanderait un déploiement le jour d'un déménagement, et resterait fausse sur
// tous les papiers imprimés en attendant.
assert.ok(!/\d{3}\s?\d{3}\s?\d{3}\s?\d{5}/.test(DEVIS),
  'aucun numéro légal en dur dans devis.js');
assert.ok(!/[A-Z]{2}\d{2}[\s\d]{14,}/.test(DEVIS),
  'aucun IBAN en dur dans devis.js : il se règle, il ne se déploie pas');

const SAISIE = {
  numero: 'DEV-26.09.01-001',
  date: '2026-09-01', validite: '2026-10-01', projet: 'STAFF',
  client: { nom: 'aloha', type: 'pro', ville: '97150 Saint-Martin', code: 'ALO' },
  appro: 'groupe',
  lignes: [
    { designation: 'T-shirt', reference: 'NS300', quantite: 30, unitaireHt: 14.3 },
    { designation: 'Transport Chronopost', note: 'Acheminement a Saint-Martin.', quantite: 30, unitaireHt: 1.8 },
  ],
  regime: 'tgca', tauxTgca: 0.04, arrondi: 'euro', acompte: 50,
};
const MAISON = {
  nom: 'Atelier OLDA', adresse: '27 rue de Hollande', ville: '97150 Marigot',
  tel: '0590871234', siret: '81234567800019', ape: '1813Z', capital: '500,00 €',
  banque: 'Banque de contrôle', iban: 'FR7612345678901234567890123', bic: 'abcdfrpp',
};

{
  const feuille = dessinerDevis(modeleDevis(SAISIE, MAISON), faireDoc());
  const sur = texteEntier(feuille);
  // LE NOM DU CLIENT S'IMPRIME EN CAPITALES, comme sur les deux autres papiers
  // et comme il se lit à l'écran : c'est le mot qu'on cherche en balayant une
  // pile. La valeur en base, elle, ne bouge pas.
  assert.ok(sur.includes('ALOHA'), 'le nom du client s’imprime en capitales');
  // DE QUI VIENT LE PAPIER. Un devis sans émetteur n'est pas un document.
  for (const attendu of ['Atelier OLDA', '27 rue de Hollande', '97150 Marigot', '05 90 87 12 34']) {
    assert.ok(sur.includes(attendu), `le devis doit porter « ${attendu} »`);
  }
  // LES MENTIONS LÉGALES SONT AU PIED, là où on les cherche sur un document
  // commercial — pas dans l'en-tête, où elles disputent la place à ce qui sert
  // tous les jours.
  const pied = tousLes(feuille, 'dv__pied');
  assert.strictEqual(pied.length, 1, 'un seul pied de page');
  assert.ok(texteEntier(pied[0]).includes('812 345 678 00019'), 'le SIRET est au pied, groupé');
  assert.ok(texteEntier(pied[0]).includes('APE 1813Z'), 'et les mentions que le devis réclame');
  // UN IBAN SE RECOPIE PAR GROUPES DE QUATRE : c'est la seule chose qui le rend
  // saisissable sans se tromper de caractère.
  assert.ok(sur.includes('FR76 1234 5678 9012 3456 7890 123'), 'l’IBAN se lit par groupes de quatre');
  assert.ok(sur.includes('ABCDFRPP'), 'le BIC s’imprime en capitales, quelle que soit la saisie');
  // LA RÉFÉRENCE DU VIREMENT : c'est par elle qu'on retrouve un versement.
  assert.ok(sur.includes('ALO-DEV-26.09.01-001-REG50'), 'la référence de virement est composée');
  assert.ok(sur.includes('502,00'), 'le total à payer');
  assert.ok(sur.includes('251,00'), 'et l’acompte demandé');
}
// UN CHAMP VIDE NE S'IMPRIME PAS. Rien n'est inventé : tant que les réglages
// sont vides, le papier porte le seul nom qu'on connaisse, et c'est honnête.
{
  const nue = dessinerDevis(modeleDevis(SAISIE, { nom: 'Atelier OLDA' }), faireDoc());
  const sur = texteEntier(nue);
  assert.ok(!/SIRET|TVA|APE/.test(sur), 'un numéro non renseigné ne sort pas');
  // LE CADRE DE RÈGLEMENT NE SORT QUE COMPLET : un devis qui réclame un acompte
  // sans dire où le virer fait rappeler le client — c'est pire qu'un cadre
  // absent.
  assert.ok(!/VIREMENT/.test(sur), 'sans IBAN réglé, le cadre de règlement ne s’imprime pas');
}
// SANS ACOMPTE DEMANDÉ, il n'y a rien à réclamer : le cadre disparaît, il
// n'affiche pas 0,00 €.
{
  const sans = dessinerDevis(modeleDevis({ ...SAISIE, acompte: 0 }, MAISON), faireDoc());
  assert.ok(!/ACOMPTE/.test(texteEntier(sans)), 'pas d’acompte demandé, pas de cadre');
}
// SANS NUMÉRO — un devis qu'on n'a pas encore imprimé — on ne fabrique pas une
// référence de virement qui ne renverrait à rien.
{
  const t = modeleDevis({ ...SAISIE, numero: '' }, MAISON);
  assert.strictEqual(t.reglement.reference, '', 'pas de numéro, pas de référence inventée');
}
// L'ARRONDI NE S'IMPRIME QUE S'IL EXISTE : à zéro, c'est une ligne qui
// n'apprend rien et qui pousse le total d'un rang vers le bas.
{
  const rond = modeleDevis({ ...SAISIE, arrondi: 'aucun' }, MAISON);
  assert.strictEqual(rond.totaux.ecart, '', 'sans arrondi, pas de ligne d’arrondi');
}

// ---------------------------------------------------------------------------
// 3. L'ÉCRAN N'INVENTE AUCUN COMPOSANT
// ---------------------------------------------------------------------------
// Deux écrans à un clic l'un de l'autre doivent donner le MÊME composant, pas
// deux qui se ressemblent. Le patron avait écrit le sien d'un bloc : sa carte,
// son bouton et son champ existaient déjà trois fois dans l'application.
for (const [classe, ou] of [
  ['reg-card', 'la carte des Réglages'],
  ['reg-btn', 'le bouton des Réglages'],
  ['fa-case', 'le champ du comptoir (intitulé au-dessus)'],
  ['fa-lab', 'l’intitulé du comptoir'],
  ['fa-in', 'la boîte de saisie du comptoir'],
  ['ecran-tete', 'l’en-tête de la charte'],
  ['champ-recherche', 'la pilule de recherche de la charte'],
  ['msg-flottant', 'le message qui ne pousse personne'],
]) {
  assert.ok(ECRAN.includes(classe), `le devis doit reprendre ${ou} (${classe})`);
}
// … et sa feuille ne les redéclare pas : elle ne porte que ce qu'aucun autre
// écran n'a — la coupe en deux moitiés et la rangée d'un article.
for (const classe of ['.reg-card', '.reg-btn', '.fa-in', '.fa-case', '.ecran-tete']) {
  assert.ok(!new RegExp(`\\${classe}\\s*(,|\\{)`).test(FEUILLE),
    `devis-flash.css redéclare ${classe} : c’est le composant partagé qu’il faut lire`);
}
// LA GRAMMAIRE DE CHAMP EST DÉCLARÉE UNE FOIS POUR LES DEUX ÉCRANS. Recopier
// les jetons chez le devis aurait donné deux échelles qui se ressemblent, et la
// première à bouger aurait laissé l'autre seule dans son coin.
assert.ok(/\.fa, \.devis-flash \{/.test(FICHE_CSS),
  'la fiche et le devis nomment la même règle pour l’échelle et la boîte');
assert.ok(!/--fa-h-champ|--fa-lab|--fa-val/.test(FEUILLE),
  'le devis ne recopie aucun jeton de cette grammaire : il est nommé dans sa règle');
// UNE HAUTEUR EST UN JETON, JAMAIS UN NOMBRE, et c'est celle de l'application.
assert.ok(!/(?:min-)?height:\s*\d+px/.test(FEUILLE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/1px|2px/g, '')),
  'aucune hauteur écrite en dur dans devis-flash.css');
// LE MESSAGE NE POUSSE PERSONNE : posé dans la colonne, il descendrait tous les
// champs sous les doigts au moment précis où l'on vient de cliquer.
assert.ok(/msg\.className = `msg-flottant/.test(ECRAN),
  'le message de l’écran sort du flux');

// ⚠ … MAIS IL S'ANCRE À LA COMMANDE QUI LE PROVOQUE, JAMAIS AU CORPS DE LA PAGE.
// ---------------------------------------------------------------------------
// « Quand je clique sur enregistrer au planning rien ne s'affiche » (Charlie,
// 01/09). Le dossier partait bien : c'est le message qui ne se voyait pas, et
// TOUS étaient dans ce cas — les deux refus, la confirmation, l'échec
// d'impression. `.msg-flottant` est `position: absolute; top: 100%` et prend
// pour ancre son parent DIRECT (`:has(> .msg-flottant)`, charte.css) : sur
// `<body>`, « 100 % » vaut la hauteur de la PAGE. Mesuré au rendu : 904 px dans
// une fenêtre de 900 — quatre pixels sous le pli, à tous les coups.
//
// Le défaut ne se voyait ni en relisant l'écran (la classe est la bonne) ni en
// relisant la charte (la règle est la bonne) : il naît de leur RENCONTRE. D'où
// cette garde, et pas une bonne intention.
assert.ok(!/document\.body\.appendChild\(msg\)/.test(ECRAN),
  'le message ne se pose PAS sur <body> : « top: 100 % » y vaut la hauteur de la page');
assert.ok(/const hote = \$\('\.ecran-tete__droite'\)/.test(ECRAN),
  'il s’ancre à la rangée des boutons de l’en-tête — la commande qui le provoque');
assert.ok(/msg\.parentElement !== hote/.test(ECRAN),
  'un écran rebâti ne réutilise pas un message resté hors de la page');

// LES DEUX ÉTATS DU MESSAGE EXISTENT VRAIMENT. L'écran écrivait `is-ok` /
// `is-ko` — les noms que `.reg-status` emploie aux Réglages — sur un
// `.msg-flottant` qui ne les connaissait pas : son refus s'affichait en gris.
assert.ok(/\.msg-flottant\.is-ko/.test(CHARTE_CSS) && /\.msg-flottant\.is-ok/.test(CHARTE_CSS),
  'is-ok / is-ko sont des états du message flottant, pas des classes mortes');
// Le rouge garde UNE écriture : `is-ko` entre dans la règle existante, il n’en
// ouvre pas une seconde qui lui ressemble.
assert.ok(/\.error\.msg-flottant,\s*\.field-error\.msg-flottant,\s*\.msg-flottant\.is-ko\s*\{/.test(CHARTE_CSS),
  'le rouge du message reste défini une seule fois, pour les trois noms');

// ---------------------------------------------------------------------------
// 3 bis. L'AIDE SE DEMANDE — elle ne tient plus le haut de la colonne
// ---------------------------------------------------------------------------
// « Supprime les phrases de ce genre, et mettre à côté du titre un petit i dans
// une bulle qui nous affiche les infos quand on clique dessus » (Charlie,
// 01/09). Quatre paragraphes de deux à quatre lignes tenaient le haut de la
// colonne de saisie du devis, six autres celui des Réglages.
assert.ok(!/reg-card__desc/.test(ECRAN) && !/reg-card__desc/.test(REGLAGES_JS)
  && !/reg-card__desc/.test(REGLAGES_CSS),
  'plus une seule phrase d’explication posée sous un titre de carte');
// ⚠ LE DEVIS NE POSE PLUS D'AIDE DU TOUT (02/09, Charlie : « supprime les points
// d'information »). Ses quatre « i » sont partis avec les paragraphes qu'ils
// remplaçaient : ce qu'ils disaient s'apprend une fois, et se franchit à chaque
// devis. Le composant reste — les Réglages s'en servent — et c'est ce qui est
// vérifié ici : il n'a pas été réécrit, il a cessé d'être appelé.
assert.ok(/poserAide/.test(REGLAGES_JS), 'les Réglages gardent la bulle du « i »');
assert.ok(!/poserAide|aide-b/.test(ECRAN),
  'le devis ne pose plus de « i » : ni la fabrique, ni un bouton qui lui ressemble');
// LA BULLE NE POUSSE PERSONNE NON PLUS. Dépliée dans le flux, elle descendrait
// toute la carte — et l'écran de saisie du devis est précisément celui qu'on
// remplit devant le client.
{
  const regle = CHARTE_CSS.match(/\n\.aide-bulle \{[^}]*\}/);
  assert.ok(regle, 'la bulle d’aide est définie une fois, dans le fichier partagé');
  assert.ok(/position: absolute/.test(regle[0]), 'elle sort du flux');
  assert.ok(/left: 0; right: 0/.test(regle[0]),
    'elle prend la largeur de son HÔTE : ancrée au « i », elle déborderait de la '
    + 'colonne de saisie — qui défile, donc dont l’overflow rognerait ce qui dépasse');
  assert.ok(/:has\(> \.aide-bulle\) \{ position: relative/.test(CHARTE_CSS),
    '… et son parent direct lui sert d’ancre, comme le message flottant');
  assert.ok(/\.aide-bulle\[hidden\] \{ display: none/.test(CHARTE_CSS),
    '`hidden` reste plus fort que l’affichage : sinon l’aide reste posée sur la carte');
}
// LE « i » PREND LA BOÎTE D'UNE ICÔNE, et il la déclare en largeur ET en
// hauteur — la garde de `meme-hauteur.test.js`.
{
  const b = CHARTE_CSS.match(/\n\.aide-b \{[^}]*\}/);
  assert.ok(b, 'le « i » est un composant, pas un bouton réécrit par écran');
  assert.ok(/width: var\(--ic\); height: var\(--ic\)/.test(b[0]),
    'sa boîte est un JETON, en largeur et en hauteur');
  assert.ok(/border-radius: var\(--pilule\)/.test(b[0]), 'et c’est un rond : une icône seule');
}

// ---------------------------------------------------------------------------
// 3 ter. LE TEXTILE : MÊME BASE, MÊME MOTEUR — PAS UNE COPIE
// ---------------------------------------------------------------------------
// « Les t-shirts doivent être inclus dans le devis flash ; vente, devis et
// devis flash doivent avoir exactement la même base de données de produit »
// (Charlie, 01/09). Les références du fichier du patron sont descendues dans
// `catalogue_produits` : elles arrivent ici par le MÊME endpoint que les tasses.
//
// ⚠ MAIS UN T-SHIRT NE SE VEND PAS À UN PRIX DE RAYON, IL SE CHIFFRE — à la
// quantité (coefficients dégressifs), au marquage (mètres de DTF, temps de
// presse) et au genre (la table des temps). Le moteur qui sait faire ça est
// écrit, conforme au fichier V9, et vérifié sur 611 520 combinaisons. L'écran
// l'APPELLE. La moindre formule recopiée ici ferait DEUX moteurs — et le jour
// où l'un bouge, le devis et le comptoir cessent de dire le même prix sans que
// personne ne s'en aperçoive.
assert.ok(/CHEMIN_MOTEUR = '\/comptoir\/textile-catalog\.js'/.test(ECRAN),
  'le devis charge LE moteur du comptoir, il n’en embarque pas un deuxième');
assert.ok(/TE\.calculate\(/.test(ECRAN),
  '… et il l’appelle : c’est lui qui fait le prix');
// Aucune arithmétique de chiffrage ne doit exister dans cet écran. Ces cinq
// noms sont les briques du moteur : leur présence ici voudrait dire qu'on a
// recommencé à calculer sur place.
for (const brique of ['dtfCost', 'dtfSpeed', 'pressMin', 'ceilStep', 'coefFor', 'purchase']) {
  assert.ok(!new RegExp(`\\b${brique}\\b`).test(ECRAN),
    `« ${brique} » est une brique du moteur : le devis ne refait pas son calcul`);
}
// LE MOTEUR SE CHARGE À LA DEMANDE. 78 Ko que la plupart des devis n'ouvrent
// jamais : au premier t-shirt posé, pas à l'ouverture de l'écran.
assert.ok(/function moteurTextile\(\)/.test(ECRAN) && /document\.head\.appendChild\(s\)/.test(ECRAN),
  'le moteur arrive par une balise posée au premier t-shirt');
assert.ok(!/^import[^\n]*textile-catalog/m.test(ECRAN),
  '… et pas par un import de tête, qui le chargerait pour tout le monde');

// LES DEUX PARAMÈTRES QUI SE PAYENT S'ILS SONT FAUX.
assert.ok(/markupPercent: 0/.test(ECRAN),
  'les coefficients du V9 portent déjà la marge : une majoration de plus la compterait deux fois');
assert.ok(/TRANSPORT_MOTEUR = 'Maritime'/.test(ECRAN),
  'le transport a sa PROPRE ligne sur le devis (bouton « Transport », tarif des '
  + 'Réglages) : le chiffrer aussi dans le prix à la pièce le facturerait deux fois');
// Le genre décide de la table des temps : introuvable, il vaut ZÉRO mètre de
// DTF — donc un marquage facturé 2,30 € au lieu de 9,90 €.
assert.ok(/genre: ligne\.textile\.genre/.test(ECRAN),
  'le genre du moteur voyage avec la ligne');

// UN MARQUAGE DEVINÉ EST UN PRIX FAUX UNE FOIS SUR DEUX. « Aucun » donne le
// prix juste du vêtement nu, qui est une vente réelle ; le menu est dans la
// rangée, à côté de la quantité.
assert.ok(/MARQUAGE_AUCUN = 'Aucun'/.test(ECRAN),
  'le marquage par défaut ne se devine pas');
assert.ok(/const ID_MARQUAGES = 'dvf-marquages';/.test(ECRAN)
  && /function poserMarquages\(champMarq\)/.test(ECRAN),
  'sur un textile le marquage propose les emplacements du moteur : « coeur+dos » tapé '
  + 'à la main ne serait plus un emplacement, et la ligne sortirait au prix du vêtement nu');
// … et il devient une liste SANS changer de forme : le composant HABILLE le
// champ, il ne le remplace pas. Rien ne bouge sous les doigts (loi 9), et une
// ligne qui n'est pas un textile garde un champ ordinaire — pas un menu vide.
assert.ok(/champMarq\.setAttribute\('list', ID_MARQUAGES\);\s*\n\s*menuPoser\(champMarq\);/.test(ECRAN),
  'le champ de marquage se fait habiller, il ne se fait pas remplacer');

// ---------------------------------------------------------------------------
// 3 quater. LE PRODUIT SE CHOISIT DANS LA LIGNE, ET LA RECHERCHE EST OBLIGATOIRE
// ---------------------------------------------------------------------------
// Charlie, 01/09, en désignant la Désignation d'un article : « y'a un gros
// problème pour bien sélectionner le produit ; ya 2 parties dans mon
// entreprise, Textiles et le reste ; dans le menu déroulant je veux pouvoir
// switch entre les 2 familles ; ce input doit avoir OBLIGATOIREMENT une
// fonction recherche COMME TOUS LES INPUTS avec un menu déroulant. »
//
// La barre portait une liste de 130 entrées SANS recherche, posée ailleurs que
// dans la ligne : il fallait descendre à la molette pour trouver un t-shirt.
assert.ok(!/dvf-catalogue/.test(ECRAN),
  'la liste « Ajouter un article du catalogue » de la barre est partie : un endroit de moins');
assert.ok(/import \{[^}]*\bmenuPoser\b[^}]*\} from '\.\/menu-recherche\.js';/.test(ECRAN),
  'le devis prend LE menu du comptoir, pas un qui lui ressemble');
assert.ok(/design\.setAttribute\('list', ID_PRODUITS\);/.test(ECRAN)
  && /menuPoser\(design\);/.test(ECRAN),
  'la désignation est le champ où le produit se cherche');
// LES DEUX MÉTIERS DE LA MAISON, et le composant sait les basculer.
assert.ok(/o\.dataset\.onglet = p\.famille === FAMILLE_TEXTILE \? 'Textile' : 'Boutique';/.test(ECRAN),
  'chaque produit dit de quel métier il est');
{
  const MENU_JS = lire('public/menu-recherche.js');
  assert.ok(/function menuOngletsDe\(etat\)/.test(MENU_JS)
    && /onglets\.className='menu-onglets';/.test(MENU_JS),
    'le composant porte la rangée des deux métiers');
  assert.ok(/return vus\.length>1\?vus:\[\];/.test(MENU_JS),
    'moins de deux métiers : pas de rangée — un seul bouton est un bouton qui ne fait rien');
  assert.ok(/if\(!etat\.onglet\)return liste;\s*\n\s*return liste\.filter\(o=>!o\.onglet\|\|o\.onglet===etat\.onglet\);/.test(MENU_JS),
    'une option sans métier traverse : le choix vide appartient aux deux');
  // ⚠ UNE IMPASSE SE DIT. Chercher « NS300 » depuis « Boutique » ne rendait
  // RIEN, alors que la réponse était à un clic.
  assert.ok(/b\.className='menu-ailleurs-lien';/.test(MENU_JS),
    'ce qui est de l’autre côté se dit, et se franchit d’un clic');
  // … mais on ne bascule pas tout seul : un menu qui change de métier sous les
  // doigts est pire que le trou qu'il comble.
  assert.ok(!/etat\.onglet=nom;etat\.vise=0;menuPeindre\(etat\);\s*\n\s*\}\);\s*\n\s*\/\* auto/.test(MENU_JS),
    'la bascule reste un geste, jamais un effet de bord');
}

// LE PRIX SUIT LA QUANTITÉ, PARCE QUE LE COEFFICIENT EST DÉGRESSIF. Dix
// t-shirts et cent t-shirts n'ont pas le même prix à la pièce.
{
  const surQte = ECRAN.slice(ECRAN.indexOf("qte.addEventListener('input'"), ECRAN.indexOf("pu.addEventListener('input'"));
  assert.ok(/recalculer\(\)/.test(surQte), 'changer la quantité refait le prix');
}
// … MAIS UN PRIX TAPÉ PENDANT UNE NÉGOCIATION NE SE FAIT PAS ÉCRASER.
assert.ok(/ligne\.puManuel = true/.test(ECRAN) && /if \(!ligne \|\| !ligne\.textile \|\| ligne\.puManuel\) return null/.test(ECRAN),
  'un prix repris à la main tient jusqu’à ce qu’on rende la main au moteur');
assert.ok(/'action-ligne', 'Recalculer'/.test(ECRAN),
  '… et on la rend avec le composant de la charte, pas un bouton de plus');

// LE NOM DU RAYON EST LE MÊME PARTOUT. Trois fichiers le lisent : l'écran pour
// reconnaître une ligne qui se chiffre, le menu du comptoir pour l'écarter (il
// a son propre parcours textile), la semence pour le poser. Trois écritures,
// c'est trois occasions de se tromper d'un accent.
{
  const CATALOGUE_JS = lire('public/comptoir/catalogue.js');
  const SEMENCE = JSON.parse(lire('catalogue-textile-seed.json'));
  assert.ok(/FAMILLE_TEXTILE = 'Textile'/.test(ECRAN), 'l’écran nomme le rayon');
  assert.ok(/FAMILLE_TEXTILE='Textile'/.test(CATALOGUE_JS), 'le menu du comptoir le nomme pareil');
  assert.ok(SEMENCE.every((p) => p.famille === 'Textile'), 'et la semence aussi');
  assert.ok(/famille===FAMILLE_TEXTILE\)continue/.test(CATALOGUE_JS),
    'le comptoir écarte le textile de sa liste « Autre » : il y a sa tuile, celle '
    + 'qui sait faire le prix — deux chemins pour la même chose, c’est une ligne mal chiffrée');
}

// ---------------------------------------------------------------------------
// 4. ON NE RECONSTRUIT PAS UN CHAMP SOUS LES DOIGTS
// ---------------------------------------------------------------------------
// Redessiner le formulaire à chaque frappe reprend le curseur à qui écrit :
// c'est une saisie perdue par ligne, et ça s'est déjà payé deux fois ailleurs
// dans ce dépôt. Seuls les TOTAUX et la FEUILLE se redessinent — ni l'un ni
// l'autre ne porte de curseur.
{
  const peindre = ECRAN.slice(ECRAN.indexOf('function peindre()'), ECRAN.indexOf('// ====', ECRAN.indexOf('function peindre()')));
  assert.ok(!/poserLignes\(\)|batir\(\)/.test(peindre),
    'le redessin ne reconstruit ni le formulaire ni les rangées d’articles');
  assert.ok(/requestAnimationFrame/.test(ECRAN),
    'un seul redessin par image : sans report, vingt frappes construisent vingt feuilles A4');
}
// L'APERÇU ET L'IMPRESSION REÇOIVENT LA MÊME CHAÎNE DE STYLE. Recopiée dans la
// feuille de l'écran, elle aurait donné un aperçu qui dérive de ce qui sort de
// l'imprimante — et on ne s'en apercevrait qu'une fois le papier remis.
assert.ok(/s\.textContent = CSS_DEVIS;/.test(ECRAN) && /\$\{CSS_DEVIS\}/.test(ECRAN),
  'la même chaîne habille l’aperçu et le cadre d’impression');
assert.ok(!/dv__|\.dv\s*\{/.test(FEUILLE),
  'aucune règle du papier dans la feuille de l’écran : le papier a la sienne');

// ---------------------------------------------------------------------------
// 4 bis. LE TABLEAU, LES VOLETS ET LES SIX TAILLES (01/09/2026)
// ---------------------------------------------------------------------------
// Charlie : « une présentation façon tableau, avec menu dépliant pour chaque
// catégorie ; en dessous les lignes simples à remplir façon Google Sheet ; des
// inputs par défaut pour chaque taille de t-shirt, de XS à 2XL. »
//
// Ce qui coûte cher si ça dérive : que les tailles disent au papier autre chose
// que l'écran, qu'un volet soit réécrit au lieu d'être celui du comptoir, et
// qu'un en-tête de tableau coiffe la mauvaise colonne.
{
  // LE VOLET EST CELUI DE LA CHARTE — `.volet-plus`, un <details> — pas un
  // repli écrit pour l'écran.
  assert.ok(/el\('details', 'reg-card dvf-cat volet-plus'\)/.test(ECRAN),
    'une catégorie est la carte des Réglages ET le volet du comptoir, sur le même nœud');
  assert.ok(/el\('summary', 'reg-card__head'\)/.test(ECRAN),
    'la poignée du volet est l’en-tête de la carte : pas une rangée de plus');
  assert.ok(!/\.volet-plus\s*(,|\{)/.test(FEUILLE) && !/::details-content/.test(FEUILLE),
    'devis-flash.css ne redéclare pas le volet : c’est charte.css qui le porte');
  // LE CORPS PORTE L'ÉCART DE LA CARTE : `.reg-card` est une colonne flex, et
  // sur un <details> elle ne compte que deux enfants.
  assert.ok(/\.dvf-cat \{ display: block; \}/.test(FEUILLE)
    && /\.dvf-cat__corps \{[^}]*gap: var\(--pas-3\)/.test(FEUILLE),
    'le corps du volet reprend l’écart de la carte, une seule fois');
  // L'ÉTAT DES VOLETS SUIT LE BROUILLON, par appareil.
  assert.ok(/JSON\.stringify\(\{ saisie, dossierId, replis \}\)/.test(ECRAN),
    'le pli de chaque catégorie part avec le brouillon');
  // … ET ELLES SONT FERMÉES AU DÉPART (02/09). Quatre catégories dépliées,
  // c'est trois écrans à franchir avant d'arriver aux articles.
  assert.ok(/c\.open = replis\[cle\] === true;/.test(ECRAN),
    'une catégorie qu’on n’a jamais ouverte est fermée : « par défaut ces bulles doivent être fermé »');
}
{
  // LA FEUILLE : intitulé à gauche (`.fa-lab`), case à droite (`.fa-in`), et
  // l'écran garde aussi le champ à intitulé au-dessus pour le détail d'un
  // article — deux mises en place, UNE grammaire.
  assert.ok(/el\('label', 'fa-lab dvf-rang__k', nom\)/.test(ECRAN), 'l’intitulé d’une rangée est celui de l’application');
  assert.ok(/\.dvf-grille \{[^}]*grid-template-columns: var\(--dvf-k\) minmax\(0, 1fr\)/.test(FEUILLE),
    'la feuille a deux colonnes : les intitulés sur un rail, les cases sur l’autre');
  assert.ok(/\.dvf-rang \{ display: contents; \}/.test(FEUILLE),
    'une rangée ne fait pas sa propre grille : elle tombe dans celle de la feuille');
  // L'INTITULÉ ET SA CASE REMPLISSENT LA MÊME RANGÉE — donc leurs deux traits
  // tombent au même endroit. `align-items: center` sur la grille faisait tomber
  // chaque cellule sur SA hauteur de contenu : 33,3 px pour l'intitulé, 59 pour
  // la case, et 12,9 px entre les deux traits (mesuré au rendu le 02/09).
  // ⚠ SUR LA FEUILLE DÉPOUILLÉE DE SES COMMENTAIRES : la règle EXPLIQUE
  // pourquoi elle ne porte pas `align-items: center`, et chercher la phrase
  // ferait échouer le test sur sa propre note.
  const grille = FEUILLE.replace(/\/\*[\s\S]*?\*\//g, ' ').match(/\.dvf-grille \{[\s\S]*?\n\}/);
  assert.ok(grille && !/align-items:\s*center/.test(grille[0]),
    'la feuille étire ses cellules : deux traits de séparation à des hauteurs différentes, ça se voit');
  assert.ok(/\.dvf-rang__k \{[^}]*display: flex;[^}]*align-items: center/.test(FEUILLE),
    '… et c’est l’intitulé qui centre son texte DANS sa cellule');
}
{
  // LE TABLEAU : les pistes sont écrites UNE fois et lues par l'en-tête et par
  // la rangée — deux écritures, c'est un intitulé sur la mauvaise colonne.
  const pistes = FEUILLE.match(/--dvf-cols:/g) || [];
  assert.strictEqual(pistes.length, 1, 'les colonnes du tableau sont déclarées une seule fois');
  assert.ok(/\.dvf-tab__tete,\n\.dvf-tab__rang \{[^}]*grid-template-columns: var\(--dvf-cols\)/.test(FEUILLE),
    'l’en-tête et la rangée lisent la même déclaration, dans la même règle');
  // CINQ COLONNES : ce qu'on vend, combien, à quel prix, le total, la corbeille.
  // Référence, couleur, marquage, note et tailles sont SOUS la ligne — les huit
  // colonnes du départ demandaient 772 px là où la colonne de saisie en fait
  // 574, et à six la référence sortait à 50 px avec son intitulé chevauchant
  // celui de « Qté » (mesuré au rendu le 02/09).
  const colonnes = ECRAN.match(/const COLONNES = \[([^\]]*)\]/);
  assert.ok(colonnes, 'les intitulés de colonne sont une liste, écrite une fois');
  assert.strictEqual(colonnes[1].split(',').length, 5, 'cinq colonnes, pas une de plus');
  assert.ok(/rangee\.append\(design, qte, pu, total, sup\)/.test(ECRAN),
    'la rangée remplit les cinq colonnes dans l’ordre de l’en-tête');
  // ⚠ ON COMPTE DES PISTES, PAS DES MOTS : `minmax(0, 1fr)` en fait deux si on
  // découpe sur l'espace. Les parenthèses se replient d'abord.
  const pistes5 = FEUILLE.match(/--dvf-cols:([^;]*);/);
  assert.ok(pistes5, 'les pistes du tableau sont déclarées');
  assert.strictEqual(pistes5[1].replace(/\([^)]*\)/g, '()').trim().split(/\s+/).length,
    colonnes[1].split(',').length,
    'la feuille déclare exactement autant de pistes que l’en-tête a d’intitulés');
  // LE MENU S'HABILLE APRÈS L'INSERTION : `menuPoser` remplace le champ dans la
  // page, et un champ habillé hors de la page perd sa peau à l'append suivant.
  assert.ok(ECRAN.indexOf('rangee.append(design, qte, pu, total, sup)') < ECRAN.indexOf('menuPoser(design)'),
    'la désignation entre dans la rangée AVANT d’être habillée par le menu');
  // UNE LIGNE SIMPLE S'ARRÊTE À SA RANGÉE : le transport n'a ni référence, ni
  // couleur, ni marquage, ni tailles — il sortait avec les trois rangées d'un
  // t-shirt, soit quatre fois la place de ce qu'il dit.
  assert.ok(/if \(!ligne\.simple\) bloc\.append\(detail, caseNote, cases\)/.test(ECRAN),
    'une ligne simple ne porte pas le détail de production d’un article');
  assert.ok(/simple: true,/.test(ECRAN), '… et c’est le transport qui la demande');
  // L'en-tête se tait quand il n'y a rien dessous, et il se réveille au premier
  // article — c'est une fonction, appelée des deux côtés.
  assert.strictEqual((ECRAN.match(/majTeteTableau\(\);/g) || []).length, 2,
    'l’en-tête suit le nombre de lignes, à l’ajout comme à la pose');
}
{
  // LES SIX TAILLES, de XS à 2XL, dans la grille de la fiche de production.
  assert.ok(/const TAILLES = \['XS', 'S', 'M', 'L', 'XL', '2XL'\]/.test(ECRAN), 'XS, S, M, L, XL, 2XL — et dans cet ordre');
  assert.ok(ECRAN.includes("el('div', 'fa-tailles')") && ECRAN.includes("'fa-lab fa-taille__k'"),
    'les cases de taille sont celles de la fiche de production, pas une grille qui leur ressemble');
  assert.ok(!/\.fa-tailles?\s*(,|\{)/.test(FEUILLE), 'devis-flash.css ne redéclare pas la grille des tailles');
  // LE TEXTE DU DEVIS EST DÉRIVÉ DES CASES — une seule source.
  assert.ok(/ligne\.tailles = texteTailles\(ligne\.parTaille\)/.test(ECRAN),
    'ce que le papier dit des tailles sort des cases, jamais d’un champ à part');
  assert.ok(/`\$\{Number\(parTaille\[t\]\)\} × \$\{t\}`/.test(ECRAN) && /\.join\(' · '\)/.test(ECRAN),
    'et c’est la grammaire de la maison : « 2 × S · 3 × M »');
  // LA QUANTITÉ SE COMPTE dès qu'une taille est remplie, et la case le DIT.
  assert.ok(/qte\.readOnly = somme > 0/.test(ECRAN), 'la quantité devient la somme des tailles, et ne se tape plus');
  assert.ok(/qte\.classList\.toggle\('dvf-tab__calc', somme > 0\)/.test(ECRAN)
    && /\.dvf-tab__calc \{ background: var\(--zone-bg\)/.test(FEUILLE),
    '… et elle prend le gris des zones qu’on lit : sinon on tape dedans et rien ne bouge');
  // Le prix suit : le coefficient est dégressif, et une taille de plus est une
  // pièce de plus.
  assert.ok(/for \(const \[t, c\] of champsTaille\) \{[\s\S]{0,500}if \(ligne\.textile\) recalculer\(\);/.test(ECRAN),
    'une case de taille qui bouge fait rechiffrer un textile');
  // UN BROUILLON D'AVANT LES CASES se relit : ses tailles étaient un texte.
  assert.ok(/l\.parTaille = lireTailles\(l\.tailles\)/.test(ECRAN), 'un vieux brouillon retrouve ses tailles depuis son texte');
}

// ---------------------------------------------------------------------------
// 5. L'ÉCRAN EST BRANCHÉ, ET SON ONGLET MÈNE QUELQUE PART
// ---------------------------------------------------------------------------
assert.ok(/'#devis-flash': 'devisflash',/.test(APP), 'le hash pilote la vue');
assert.ok(/if \(devisflash\) mountDevisFlash\(\);/.test(APP), 'la bascule monte l’écran');
assert.ok(/viewMode === 'devisflash'\) return mountDevisFlash\(\);/.test(APP),
  '« Actualiser » relit les réglages de cet écran comme des autres');
assert.ok(/id="viewDevisFlash" href="#devis-flash"/.test(INDEX)
  && /id="devis-flash"/.test(INDEX), 'l’onglet et sa section existent dans la coquille');
// ON NE REMONTE PAS L'ÉCRAN EN REVENANT DESSUS : un devis en cours de
// composition se perdrait au premier aller-retour vers le planning.
assert.ok(/dfModule\.refreshDevisFlash\(\)/.test(APP),
  'revenir sur l’onglet relit les réglages, il ne reconstruit pas le devis');

console.log('✓ devis : l’addition tombe juste sur trois arrondis, le papier tient son A4, '
  + 'l’écran ne réinvente aucun composant, et les six tailles comptent la quantité');
