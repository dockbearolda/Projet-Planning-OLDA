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
// 2 ter. L'AJUSTEMENT GLOBAL, L'ACOMPTE LIBRE, LA BASCULE VEDETTE (03/09/2026)
// ---------------------------------------------------------------------------
// UNE REMISE OU UNE MAJORATION NÉGOCIÉE SUR L'ENSEMBLE, en plus des remises
// par article : elle porte sur le sous-total HT, avant la TGCA, et l'addition
// continue de tomber juste par construction.
{
  const remise = calculerDevis({
    lignes: [{ designation: 'x', quantite: 10, unitaireHt: 20 }],
    regime: 'tgca', tauxTgca: 0.04, arrondi: 'aucun', acompte: 0,
    ajustement: { unite: 'eur', valeur: -50 },
  });
  assert.strictEqual(remise.sousTotalHt, 200, 'le sous-total brut ne bouge pas');
  assert.strictEqual(remise.ajustement.montant, -50, 'la remise est bien de -50 €');
  assert.strictEqual(remise.totalHt, 150, 'la remise porte sur le HT, avant la taxe');
  assert.strictEqual(Math.round((remise.totalHt + remise.taxe) * 100) / 100, remise.ttc,
    'HT + taxe = TTC, même avec un ajustement');

  const majoration = calculerDevis({
    lignes: [{ designation: 'x', quantite: 10, unitaireHt: 20 }],
    regime: 'tgca', tauxTgca: 0.04, arrondi: 'aucun', acompte: 0,
    ajustement: { unite: 'pct', valeur: 10 },
  });
  assert.strictEqual(majoration.ajustement.montant, 20, '10 % de majoration sur 200 € HT = 20 €');
  assert.strictEqual(majoration.totalHt, 220);
}
// L'ARRONDI NE MESURE QUE L'ARRONDI, PAS L'AJUSTEMENT : sinon la ligne
// « Arrondi commercial » mentirait sur ce qu'elle doit à chaque euro rond.
for (const arrondi of ['aucun', 'euro', 'dix']) {
  for (const valeur of [-37.5, 0, 62.3]) {
    const c = calculerDevis({
      lignes: [{ designation: 'x', quantite: 7, unitaireHt: 13.37 }],
      regime: 'tgca', tauxTgca: 0.04, arrondi, acompte: 20,
      ajustement: { unite: 'eur', valeur },
    });
    assert.strictEqual(Math.round((c.totalHt + c.taxe) * 100) / 100, c.ttc,
      `HT + taxe ≠ TTC pour un ajustement de ${valeur} € (arrondi « ${arrondi} »)`);
    assert.strictEqual(Math.round((c.sousTotalHt + c.ajustement.montant + c.ecart) * 100) / 100, c.totalHt,
      `sous-total + ajustement + écart ≠ total HT pour ${valeur} € (arrondi « ${arrondi} »)`);
  }
}
// L'ACOMPTE EST UN POURCENTAGE LIBRE (03/09/2026) : 17 %, 85 %… n'importe quel
// nombre entre 0 et 100, plus seulement 0/30/50/100.
{
  const c = calculerDevis({
    lignes: [{ designation: 'x', quantite: 1, unitaireHt: 200 }],
    regime: 'tgca', tauxTgca: 0.04, arrondi: 'aucun', acompte: 17,
  });
  assert.strictEqual(c.acompte.pourcent, 17, 'un pourcentage libre est accepté tel quel');
  assert.strictEqual(c.acompte.montant, Math.round(c.ttc * 0.17 * 100) / 100);
}
// UN ACOMPTE HORS BORNES EST RAMENÉ ENTRE 0 ET 100 : une saisie de travers
// (négative, ou au-delà de 100 %) ne doit pas réclamer plus que le total.
{
  const trop = calculerDevis({
    lignes: [{ designation: 'x', quantite: 1, unitaireHt: 100 }],
    regime: 'tgca', tauxTgca: 0.04, arrondi: 'aucun', acompte: 250,
  });
  assert.strictEqual(trop.acompte.pourcent, 100);
  const negatif = calculerDevis({
    lignes: [{ designation: 'x', quantite: 1, unitaireHt: 100 }],
    regime: 'tgca', tauxTgca: 0.04, arrondi: 'aucun', acompte: -10,
  });
  assert.strictEqual(negatif.acompte.pourcent, 0);
}
// LA BASCULE VEDETTE NE CHANGE AUCUN MONTANT — juste lequel des deux totaux
// est le géant de la feuille.
{
  const ttcDevant = dessinerDevis(modeleDevis({ ...SAISIE, vedette: 'ttc' }, MAISON), faireDoc());
  const grandTtc = tousLes(ttcDevant, 'dv__grand');
  assert.strictEqual(grandTtc.length, 1);
  assert.ok(texteEntier(grandTtc[0]).includes('TOTAL À PAYER'), 'par défaut, le TTC est le géant');
  assert.ok(texteEntier(grandTtc[0]).includes('502,00'));

  const htDevant = dessinerDevis(modeleDevis({ ...SAISIE, vedette: 'ht' }, MAISON), faireDoc());
  const grandHt = tousLes(htDevant, 'dv__grand');
  assert.strictEqual(grandHt.length, 1);
  assert.ok(texteEntier(grandHt[0]).includes('TOTAL HT'), 'la bascule met le HT en géant');
  assert.ok(texteEntier(htDevant).includes('TTC'), 'le TTC redescend en ligne normale, il ne disparaît pas');
}
// L'AJUSTEMENT NE S'IMPRIME QUE S'IL N'EST PAS NUL — comme l'arrondi.
{
  const sansAjustement = modeleDevis(SAISIE, MAISON);
  assert.strictEqual(sansAjustement.totaux.ajustement, '', 'pas d’ajustement, pas de ligne');
  const avecAjustement = modeleDevis({ ...SAISIE, ajustement: { unite: 'eur', valeur: -20 } }, MAISON);
  assert.notStrictEqual(avecAjustement.totaux.ajustement, '');
  assert.ok(texteEntier(dessinerDevis(avecAjustement, faireDoc())).includes('Ajustement'),
    'la ligne « Ajustement » sort sur le papier quand elle n’est pas nulle');
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
  ['segmente', 'le sélecteur segmenté de la charte (bascule TTC/HT)'],
]) {
  assert.ok(ECRAN.includes(classe), `le devis doit reprendre ${ou} (${classe})`);
}
// … et sa feuille ne les redéclare pas : elle ne porte que ce qu'aucun autre
// écran n'a — la coupe en deux moitiés et la rangée d'un article.
for (const classe of ['.reg-card', '.reg-btn', '.fa-in', '.fa-case', '.ecran-tete', '.segmente']) {
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
  // `volet-carte` s'y ajoute le 02/09 : depuis que l'écran de VENTE replie ses
  // cartes de la même façon, la hauteur de la poignée est partagée par deux
  // écrans et ne peut plus être écrite dans la feuille de celui-ci.
  assert.ok(/el\('details', 'reg-card dvf-cat volet-plus volet-carte'\)/.test(ECRAN),
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
  // LA POIGNÉE PREND SA HAUTEUR DANS LA CHARTE, PAS ICI. Une hauteur que deux
  // écrans partagent et qui s'écrit dans la feuille de l'un des deux redevient
  // deux hauteurs le jour où l'une bouge.
  assert.ok(!/\.dvf-cat > summary/.test(FEUILLE),
    'devis-flash.css n’écrit plus la hauteur de la poignée : `.volet-carte` la porte');
  assert.ok(/\.volet-carte > summary \{ min-height: var\(--ctrl-h\); padding-block: 0; \}/.test(CHARTE_CSS),
    '… et elle est un JETON dans charte.css, jamais un nombre');
  // L'ÉTAT DES VOLETS SUIT LE BROUILLON, par appareil.
  assert.ok(/JSON\.stringify\(\{ saisie, dossierId, replis \}\)/.test(ECRAN),
    'le pli de chaque catégorie part avec le brouillon');
  // … MAIS UN DEVIS NEUF REPART REPLIÉ (02/09). Charlie : « ils sont fermés par
  // défaut et doivent être fermés à chaque nouveau devis. » Le pli suivait le
  // brouillon jusque-là : celui qui avait déplié la fiscalité la retrouvait
  // dépliée sur le devis d'après.
  const zero = ECRAN.match(/function repartirDeZero\(\)[\s\S]*?\n\}/)[0];
  assert.ok(/replis = \{\};/.test(zero)
    && /querySelectorAll\('details\.dvf-cat'\)[\s\S]*?open = false/.test(zero),
    'un devis neuf referme ses volets — l’état ET les nœuds déjà rendus');
  // … ET ELLES SONT FERMÉES AU DÉPART (02/09). Quatre catégories dépliées,
  // c'est trois écrans à franchir avant d'arriver aux articles.
  assert.ok(/c\.open = replis\[cle\] === true;/.test(ECRAN),
    'une catégorie qu’on n’a jamais ouverte est fermée : « par défaut ces bulles doivent être fermé »');
}
{
  // LA FEUILLE : intitulé à gauche, case à droite (`.fa-in`), et l'écran garde
  // aussi le champ à intitulé au-dessus pour le détail d'un article — deux
  // mises en place, UNE grammaire.
  // ⚠ ELLE A DÉMÉNAGÉ DANS LA CHARTE LE 02/09 : l'écran de VENTE porte la même
  // rangée, et deux écrans du même poste ne peuvent pas avoir deux grammaires
  // de ligne. L'intitulé ne porte plus `fa-lab` non plus — `.rang__k` déclare
  // sa police, et la vente ne charge pas `fiche-atelier.css`.
  assert.ok(/el\('label', 'rang__k', nom\)/.test(ECRAN), 'l’intitulé d’une rangée est celui de l’application');
  assert.ok(/\.rangs \{[^}]*grid-template-columns: var\(--rangs-k\) minmax\(0, 1fr\)/.test(CHARTE_CSS),
    'la feuille a deux colonnes : les intitulés sur un rail, les cases sur l’autre');
  assert.ok(/\.rang \{ display: contents; \}/.test(CHARTE_CSS),
    'une rangée ne fait pas sa propre grille : elle tombe dans celle de la feuille');
  // … ET LE DEVIS N'EN REDÉCLARE AUCUNE. Ce qu'il garde, ce sont les règles qui
  // MASQUENT le détail d'un de ses articles (`.lignes__art .fa-…`) : c'est son
  // contenu à lui, pas le composant.
  const feuilleNue = FEUILLE.replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const sel of (feuilleNue.match(/(^|\n)\.[A-Za-z0-9_-]+/g) || []).map((x) => x.trim())) {
    assert.ok(!/^\.(rangs|rang|tot|totaux|nb)$/.test(sel) && sel !== '.lignes',
      `devis-flash.css redéclare « ${sel} » : c’est charte.css qui le porte`);
  }
  // L'INTITULÉ ET SA CASE REMPLISSENT LA MÊME RANGÉE — donc leurs deux traits
  // tombent au même endroit. `align-items: center` sur la grille faisait tomber
  // chaque cellule sur SA hauteur de contenu : 33,3 px pour l'intitulé, 59 pour
  // la case, et 12,9 px entre les deux traits (mesuré au rendu le 02/09).
  // ⚠ SUR LA FEUILLE DÉPOUILLÉE DE SES COMMENTAIRES : la règle EXPLIQUE
  // pourquoi elle ne porte pas `align-items: center`, et chercher la phrase
  // ferait échouer le test sur sa propre note.
  const grille = CHARTE_CSS.replace(/\/\*[\s\S]*?\*\//g, ' ').match(/\.rangs \{[\s\S]*?\n\}/);
  assert.ok(grille && !/align-items:\s*center/.test(grille[0]),
    'la feuille étire ses cellules : deux traits de séparation à des hauteurs différentes, ça se voit');
  assert.ok(/\.rang__k \{[^}]*display: flex;[^}]*align-items: center/.test(CHARTE_CSS),
    '… et c’est l’intitulé qui centre son texte DANS sa cellule');
}
{
  // LE TABLEAU : les pistes sont écrites UNE fois et lues par l'en-tête et par
  // la rangée — deux écritures, c'est un intitulé sur la mauvaise colonne.
  const pistes = CHARTE_CSS.match(/--lignes-cols:/g) || [];
  assert.strictEqual(pistes.length, 1, 'les colonnes du tableau sont déclarées une seule fois');
  assert.ok(!/--lignes-cols/.test(FEUILLE.replace(/\/\*[\s\S]*?\*\//g, ' ')),
    '… et le devis ne les réécrit pas chez lui : ce sont SES mesures, elles vivent dans la charte');
  assert.ok(/\.lignes__tete,\n\.lignes__rang \{[^}]*grid-template-columns: var\(--lignes-cols\)/.test(CHARTE_CSS),
    'l’en-tête et la rangée lisent la même déclaration, dans la même règle');
  // SIX COLONNES : ce qu'on vend, combien, à quel prix HT, à quel prix TTC, le
  // total, la corbeille. Référence, couleur, marquage, note et tailles sont
  // SOUS la ligne — les huit colonnes du départ demandaient 772 px là où la
  // colonne de saisie en fait 574, et à six la référence sortait à 50 px avec
  // son intitulé chevauchant celui de « Qté » (mesuré au rendu le 02/09). Le PU
  // TTC (03/09) s'est ajouté à ce compte, pas retranché d'une autre colonne.
  const colonnes = ECRAN.match(/const COLONNES = \[([^\]]*)\]/);
  assert.ok(colonnes, 'les intitulés de colonne sont une liste, écrite une fois');
  assert.strictEqual(colonnes[1].split(',').length, 6, 'six colonnes, pas une de plus');
  assert.ok(/rangee\.append\(design, qte, pu, puTtc, total, sup\)/.test(ECRAN),
    'la rangée remplit les six colonnes dans l’ordre de l’en-tête');
  // ⚠ ON COMPTE DES PISTES, PAS DES MOTS : `minmax(0, 1fr)` en fait deux si on
  // découpe sur l'espace. Les parenthèses se replient d'abord.
  const pistes5 = CHARTE_CSS.match(/--lignes-cols:([^;]*);/);
  assert.ok(pistes5, 'les pistes du tableau sont déclarées');
  assert.strictEqual(pistes5[1].replace(/\([^)]*\)/g, '()').trim().split(/\s+/).length,
    colonnes[1].split(',').length,
    'la feuille déclare exactement autant de pistes que l’en-tête a d’intitulés');
  // LE MENU S'HABILLE APRÈS L'INSERTION : `menuPoser` remplace le champ dans la
  // page, et un champ habillé hors de la page perd sa peau à l'append suivant.
  assert.ok(ECRAN.indexOf('rangee.append(design, qte, pu, puTtc, total, sup)') < ECRAN.indexOf('menuPoser(design)'),
    'la désignation entre dans la rangée AVANT d’être habillée par le menu');
  // UNE LIGNE SIMPLE S'ARRÊTE À SA RANGÉE : le transport n'a ni référence, ni
  // couleur, ni marquage, ni tailles — il sortait avec les trois rangées d'un
  // t-shirt, soit quatre fois la place de ce qu'il dit.
  assert.ok(/if \(!ligne\.simple\) bloc\.append\(detail, detail2, libre, caseNote, cases, cadreLibres\)/.test(ECRAN),
    'une ligne simple ne porte pas le détail de production d’un article');
  assert.ok(/simple: true,/.test(ECRAN), '… et c’est le transport qui la demande');
  // L'en-tête se tait quand il n'y a rien dessous, et il se réveille au premier
  // article — c'est une fonction, appelée des deux côtés.
  assert.strictEqual((ECRAN.match(/majTeteTableau\(\);/g) || []).length, 2,
    'l’en-tête suit le nombre de lignes, à l’ajout comme à la pose');
}
{
  // LES SIX TAILLES, de XS à 2XL, dans la grille de la fiche de production.
  // « AUTRES » A DISPARU (03/09) : remplacé par les tailles LIBRES (bulles
  // nommées, testées plus bas) — un 3XL ou un enfant se nomme désormais,
  // au lieu de se compter dans un bac générique.
  assert.ok(/const TAILLES = \['XS', 'S', 'M', 'L', 'XL', '2XL'\]/.test(ECRAN),
    'XS, S, M, L, XL, 2XL — et dans cet ordre, sans « Autres »');
  assert.ok(ECRAN.includes("el('div', 'fa-tailles')") && ECRAN.includes("'fa-lab fa-taille__k'"),
    'les cases de taille sont celles de la fiche de production, pas une grille qui leur ressemble');
  assert.ok(!/\.fa-tailles?\s*(,|\{)/.test(FEUILLE), 'devis-flash.css ne redéclare pas la grille des tailles');
  // LE TEXTE DU DEVIS EST DÉRIVÉ DES CASES — une seule source.
  assert.ok(/ligne\.tailles = texteTailles\(ligne\.parTaille, ligne\.taillesLibres\)/.test(ECRAN),
    'ce que le papier dit des tailles sort des cases, jamais d’un champ à part');
  assert.ok(/`\$\{Number\(parTaille\[t\]\)\} × \$\{t\}`/.test(ECRAN) && /\.join\(' · '\)/.test(ECRAN),
    'et c’est la grammaire de la maison : « 2 × S · 3 × M »');
  // LA QUANTITÉ SE COMPTE dès qu'une taille est remplie, et la case le DIT.
  assert.ok(/qte\.readOnly = somme > 0/.test(ECRAN), 'la quantité devient la somme des tailles, et ne se tape plus');
  assert.ok(/qte\.classList\.toggle\('lignes__calc', somme > 0\)/.test(ECRAN)
    && /\.lignes__calc \{ background: var\(--zone-bg\)/.test(CHARTE_CSS),
    '… et elle prend le gris des zones qu’on lit : sinon on tape dedans et rien ne bouge');
  // Le prix suit : le coefficient est dégressif, et une taille de plus est une
  // pièce de plus.
  assert.ok(/for \(const \[t, c\] of champsTaille\) \{[\s\S]{0,500}if \(ligne\.textile\) recalculer\(\);/.test(ECRAN),
    'une case de taille qui bouge fait rechiffrer un textile');
  // UN BROUILLON D'AVANT LES CASES se relit : ses tailles étaient un texte.
  assert.ok(/l\.parTaille = lireTailles\(l\.tailles\)/.test(ECRAN), 'un vieux brouillon retrouve ses tailles depuis son texte');
}

// ---------------------------------------------------------------------------
// 4 ter. LES TROIS PRIX DE LA MAISON — et celui qui manque (02/09/2026)
// ---------------------------------------------------------------------------
// Charlie : « c'est n'importe quoi dans devis flash, les prix bug, ne
// s'affichent pas ». Reproduit à l'écran : une tasse choisie au catalogue
// sortait sur le papier du client à « 0,00 € », et le total du devis l'ignorait
// sans que rien ne le dise.
//
// LA MAISON A TROIS PRIX, L'ÉCRAN N'EN CONNAISSAIT QUE DEUX :
//   · le TEXTILE se chiffre au moteur V9 ;
//   · le RAYON a son prix au catalogue ;
//   · la TASSE s'ADDITIONNE depuis la grille du comptoir — et personne ne la
//     lisait ici.
//
// Et un quatrième défaut, celui qui rendait les trois autres silencieux : un
// prix ABSENT s'écrivait « 0,00 € », exactement comme un article OFFERT.
{
  // --- Un prix absent n'est pas un prix de zéro ---------------------------
  const compte = calculerDevis({
    lignes: [
      { designation: 'Sans prix', quantite: 2, unitaireHt: null },
      { designation: 'Offert', quantite: 1, unitaireHt: 0 },
      { designation: 'Vendu', quantite: 1, unitaireHt: 10 },
    ],
    regime: 'tgca', tauxTgca: 0.04, arrondi: 'aucun', acompte: 0,
  });
  assert.strictEqual(compte.lignes[0].sansPrix, true, 'une ligne sans prix se signale');
  assert.strictEqual(compte.lignes[1].sansPrix, false, '… et un zéro TAPÉ reste un article offert');
  assert.strictEqual(compte.lignes[2].sansPrix, false, '… un prix posé n’est jamais « à chiffrer »');
  // L'ADDITION NE CHANGE PAS : ce qui manque compte pour zéro, comme avant.
  assert.strictEqual(compte.sousTotalHt, 10, 'ce qui n’est pas chiffré ne s’invente pas dans le total');

  // --- Et le papier le DIT, il n'imprime pas un zéro ----------------------
  const t = modeleDevis({
    numero: 'D-1', date: '2026-09-02', client: { nom: 'X' },
    lignes: [
      { designation: 'Tasse', quantite: 1, unitaireHt: null },
      { designation: 'Cadeau', quantite: 1, unitaireHt: 0 },
    ],
    regime: 'tgca', tauxTgca: 0.04, arrondi: 'aucun', acompte: 0,
  }, {});
  assert.strictEqual(t.lignes[0].unitaireHt, 'À chiffrer', 'le papier dit ce qui manque');
  assert.strictEqual(t.lignes[0].totalHt, 'À chiffrer', '… dans les deux colonnes');
  assert.ok(/0,00/.test(t.lignes[1].totalHt), '… et un article offert s’imprime bien à zéro');
  // UN SEUL MOT POUR LES DEUX MOITIÉS DE L'ÉCRAN. Le tableau et la feuille sont
  // à dix centimètres l'un de l'autre : deux formulations, ce sont deux choses
  // aux yeux de la vendeuse.
  assert.ok(/export const SANS_PRIX = /.test(DEVIS), 'le mot est écrit une fois, dans devis.js');
  assert.ok(/SANS_PRIX,?\n\} from '\.\/devis\.js'/.test(ECRAN) || /SANS_PRIX/.test(ECRAN),
    '… et l’écran le reprend au lieu d’en écrire un second');
  assert.ok(/pu\.placeholder = SANS_PRIX/.test(ECRAN), 'la case de prix vide dit ce qu’on attend d’elle');

  // --- Une ligne neuve n'a pas de prix, elle n'a pas un prix de zéro ------
  assert.ok(/quantite: 1, unitaireHt: null,/.test(ECRAN),
    'un article ajouté part SANS prix : un zéro serait une promesse de le donner');
  assert.ok(/String\(pu\.value\)\.trim\(\) === '' \? null :/.test(ECRAN),
    'vider la case retire le prix ; taper 0 le pose');
  // LE COMPTE DE L'EN-TÊTE. Le tableau des articles se replie, et c'est replié
  // qu'on clique « Imprimer » : ce qui manque doit rester sous les yeux.
  assert.ok(/filter\(\(l\) => l\.sansPrix\)\.length/.test(ECRAN),
    'l’en-tête compte les lignes qui attendent encore leur prix');
}
// ---------------------------------------------------------------------------
// UN DEVIS OÙ RIEN N'EST CHIFFRÉ N'A PAS DE TOTAL (02/09/2026)
// ---------------------------------------------------------------------------
// Charlie : « par défaut je ne veux pas de prix, ça doit être vierge ». À
// l'ouverture de l'écran, la feuille imprimait déjà « TOTAL À PAYER 0,00 € » en
// géant, trois lignes à zéro au-dessus, et le compteur annonçait « 0 article ·
// 0,00 € ». C'est la règle des lignes (« À chiffrer ») tenue une marche plus
// haut : un zéro affiché est un prix, et celui-là, c'est la maison qui le tient.
{
  const BASE = { regime: 'tgca', tauxTgca: 0.04, arrondi: 'euro', acompte: 50 };
  const vierge = calculerDevis({ ...BASE, lignes: [] });
  assert.strictEqual(vierge.aucunPrix, true, 'un devis sans article n’a pas de prix');
  // TOUTES LES LIGNES « À CHIFFRER », C'EST PAREIL : personne n'a rien décidé.
  const attente = calculerDevis({ ...BASE, lignes: [{ designation: 'Tasse', quantite: 12, unitaireHt: null }] });
  assert.strictEqual(attente.aucunPrix, true,
    'un devis dont toutes les lignes sont à chiffrer n’a pas de total non plus');
  // UNE SEULE LIGNE CHIFFRÉE SUFFIT À LES FAIRE REVENIR — et un article OFFERT
  // en est une : son zéro a été TAPÉ.
  const offert = calculerDevis({ ...BASE, lignes: [{ designation: 'Cadeau', quantite: 1, unitaireHt: 0 }] });
  assert.strictEqual(offert.aucunPrix, false, 'un zéro voulu est un prix : les totaux reviennent');

  // --- LE PAPIER ----------------------------------------------------------
  const neuf = modeleDevis({ ...BASE, date: '2026-09-02', client: {}, lignes: [] }, MAISON);
  assert.strictEqual(neuf.totaux, null, 'pas de bloc de totaux sur un devis vierge');
  assert.strictEqual(neuf.reglement, null,
    'ni acompte à réclamer : 0,00 € tout de suite, c’est la même promesse écrite plus gros');
  const sur = texteEntier(dessinerDevis(neuf, faireDoc()));
  for (const mot of ['Sous-total HT', 'Total HT', 'TOTAL À PAYER', 'ACOMPTE']) {
    assert.ok(!sur.includes(mot),
      `« ${mot} » ne s’imprime pas sur un devis vierge (feuille obtenue : ${sur})`);
  }
  // ⚠ ET PAS LE MONTANT NON PLUS. Le pied porte le capital de la maison — un
  // « 500,00 € » réglé, qui n'est pas un prix : on cherche le zéro, pas l'euro.
  assert.ok(!/\b0,00\s*€/.test(sur), `aucun montant à zéro sur la feuille (obtenu : ${sur})`);
  // LE DÉLAI ET LE BAT, EUX, RESTENT : ce sont des textes commerciaux, pas des
  // montants — c'est ce qu'on peut opposer à la maison en cas de retard.
  assert.ok(/BON À TIRER/.test(sur), 'les cadres délai et BAT ne dépendent pas du prix');

  // --- ET L'ÉCRAN DIT LA MÊME CHOSE QUE LA FEUILLE ------------------------
  // Deux moitiés d'écran à dix centimètres l'une de l'autre : le volet
  // « Fiscalité et règlement » et le compteur de l'en-tête portent tous deux un
  // montant, et tous deux doivent se taire.
  assert.ok((ECRAN.match(/compte\.aucunPrix/g) || []).length >= 2,
    'l’écran applique le verdict aux DEUX endroits qui affichent un montant');
}
{
  // --- LA TASSE S'ADDITIONNE, ET LA GRILLE FAIT FOI -----------------------
  assert.ok(/api\('GET', '\/api\/tarifs-tasse'\)/.test(ECRAN),
    'l’écran lit la grille tarifaire de la tasse, pas seulement ses paramètres');
  // LA FORMULE EST CELLE DU COMPTOIR : produit + face 1 + face 2 + dessous + BAT.
  assert.ok(/\[t\.produitId, t\.face1Id, t\.face2Id, t\.dessousId, t\.batId\]/.test(ECRAN),
    'les cinq puces du comptoir, et les cinq seulement');
  assert.ok(/somme \+ \(Number\(a\.prixVenteTtc\) \|\| 0\)/.test(ECRAN),
    'c’est une addition de prix TTC, comme dans buildLigneTasse');
  // ⚠ AUCUN PRIX DE TASSE ÉCRIT EN DUR. « 16 € » est la tasse nue plus une
  // face : recopié ici, il resterait celui d'avant le jour où le patron corrige
  // sa grille — et le devis dirait un prix que le comptoir ne dit plus.
  const chiffres = (ECRAN.match(/^(?!\s*(?:\/\/|\*)).*\b(?:prix|tarif|ttc|euro)\w*\s*[=:]\s*\d+(?:\.\d+)?/gim) || []);
  assert.strictEqual(chiffres.length, 0,
    `aucun prix n’est écrit en dur dans l’écran (trouvé : ${chiffres.join(' | ')})`);
  // LE JOINT AVEC LE CATALOGUE EST LE NOM DE LA FAMILLE, comparé à plat : la
  // grille dit « Tasse Céramique 350 ml », le catalogue « Tasse céramique
  // 350 ml ». Une majuscule ne fait pas deux produits.
  assert.ok(/normalize\('NFD'\)\.replace\(\/\[\\u0300-\\u036f\]\/g, ''\)/.test(ECRAN),
    'la comparaison des noms ignore la casse ET les accents');
  assert.ok(/aPlat\(a\.designation\) === f/.test(ECRAN),
    'une famille du catalogue trouve son produit dans la grille par le nom');
  // UNE TASSE ARRIVE MARQUÉE : nue elle vaut 10 €, le magasin la vend 16.
  assert.ok(/function faceParDefaut\(\)/.test(ECRAN) && /face1Id: faceParDefaut\(\)/.test(ECRAN),
    'une tasse arrive avec une face — sinon elle sort six euros sous son prix de rayon');
  assert.ok(/faces\.find\(\(a\) => !estRien\(a\) && Number\(a\.prixVenteTtc\) > 0\)/.test(ECRAN),
    '… et si le patron renomme cette face, on retombe sur la première qui coûte quelque chose');
  // LE PRIX SUIT LA PUCE. Changer la face devant le client doit bouger le
  // montant — et rendre la main au calcul, sinon la face est vendue pour rien.
  assert.ok(/ligne\.tasse\[cle\] = n4\.value;[\s\S]{0,400}ligne\.puManuel = false;[\s\S]{0,80}recalculer\(\);/.test(ECRAN),
    'une puce changée refait le prix, même après une négociation');
  // CE QUE LE CLIENT RELIT : les faces d'une tasse sont ce qu'on lui vend.
  assert.ok(/function texteFacesTasse\(ligne\)/.test(ECRAN)
    && /ligne\.faces = texteFacesTasse\(ligne\)/.test(ECRAN),
    'les faces choisies s’écrivent dans la colonne que le papier imprime déjà');
  // UN ARTICLE SE CHIFFRE D'UNE SEULE FAÇON : les deux ne cohabitent jamais.
  assert.ok(/ligne\.textile = null;\n\s+ligne\.tasse = null;/.test(ECRAN),
    'un produit de rayon efface les deux chiffrages');
  assert.ok(/ligne\.tasse = null;\n\s+if \(!ligne\.marquage\)/.test(ECRAN),
    '… et un textile efface celui de la tasse');
}
{
  // --- `hidden` NE SUFFIT PAS SOUS UN `display` POSÉ ----------------------
  // Défaut VU À L'ÉCRAN le 02/09 : la rangée du volet « Référence libre »
  // portait `hidden = true` et mesurait 96,5 px de haut. Ses trois cases
  // sortaient sur CHAQUE article, à tous les postes. `.dvf-r3` est en
  // `display: grid` — et un `display` posé rallume ce que `hidden` éteint.
  // C'est le piège de `.poste-ecran` (styles.css), payé une seconde fois.
  const sansCommentaire = FEUILLE.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const sel of ['\\.dvf-r3\\[hidden\\]', '\\.fa-case\\[hidden\\]', '\\.fa-tailles\\[hidden\\]']) {
    assert.ok(new RegExp(`${sel}[^{]*\\{[^}]*display: none`).test(sansCommentaire.replace(/,\s*\n/g, ', ')),
      `${sel.replace(/\\/g, '')} s’éteint pour de bon`);
  }
  // UNE TASSE N'A NI TAILLES, NI RÉFÉRENCE, NI MARQUAGE ; un t-shirt n'a ni
  // face 1, ni dessous, ni BAT. Une seule écriture décide, appelée à la
  // construction ET à chaque changement de produit.
  assert.ok(/const majFamille = \(\) => \{/.test(ECRAN), 'ce que la ligne montre dépend de ce qu’elle est');
  assert.strictEqual((ECRAN.match(/majFamille\(\);/g) || []).length, 2,
    '… et c’est la même écriture au montage et au changement de produit');
  assert.ok(/cases\.hidden = estTasse;/.test(ECRAN), 'une tasse ne porte pas de grille de tailles');
  // TROIS CASES VISIBLES PAR RANGÉE DANS LES DEUX CAS : c'est la grille de
  // `.dvf-r3`, et deux articles de familles différentes gardent la même coupe.
  assert.ok(/detail\.append\(caseRef, caseCoul, caseMarq, caseFace1, caseFace2\)/.test(ECRAN),
    'la première rangée porte les deux familles et n’en montre qu’une');
  assert.ok(/detail2\.append\(caseEncre, caseFacesA, caseDessous, caseBat, champ\('Remise %'/.test(ECRAN),
    '… la seconde aussi, la remise fermant les deux');
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

// UN PRODUIT ÉTEINT NE SE PROPOSE PAS — le menu du comptoir et la vente directe
// le taisent déjà (`r.actif===false` dans catalogue.js, `p.actif !== false` dans
// pont.js) ; le devis flash lit la même base et doit montrer la même liste.
assert.ok(/if \(p\.actif === false\) continue;/.test(ECRAN),
  'le devis flash ne propose pas un produit éteint au catalogue');

// LE PRIX SUIT LE PRODUIT (02/09, Charlie : « peu importe où je clique, c'est
// toujours le même prix »). Le prix de rayon ne se posait que sur une ligne
// SANS prix : une tasse à 15,38 € corrigée en planche restait à 15,38 €, avec la
// teinte du décor et la face de la tasse. Choisir un produit, c'est en changer.
{
  const debut = ECRAN.indexOf('function choisirProduit(');
  const choisir = ECRAN.slice(debut, ECRAN.indexOf('function ajouterTransport(', debut));
  assert.ok(debut > 0 && choisir.length > 0, 'choisirProduit existe');
  assert.ok(!/!ligne\.unitaireHt/.test(choisir),
    'choisir un produit pose SON prix, même si la ligne en portait déjà un');
  assert.ok(/ligne\.puManuel = false;/.test(choisir),
    '… et rend la main au moteur ou à la grille : un prix repris à la main appartenait à l’article d’avant');
  assert.ok(/ligne\.pleinHt = ht;/.test(choisir) && /ligne\.unitaireHt = ligne\.remise \?/.test(choisir),
    'la remise de la ligne s’applique au prix du nouvel article, depuis son prix plein');
  assert.ok(/\} else \{\s*\n(?:\s*\/\/[^\n]*\n)*\s*ligne\.pleinHt = null;\s*\n\s*ligne\.unitaireHt = null;/.test(choisir),
    'un produit sans prix se dit « à chiffrer », pas au prix de l’article d’avant');
  assert.ok(/if \(etaitTasse\) ligne\.faces = '';/.test(choisir) && /else if \(etaitTasse\) ligne\.couleur = '';/.test(choisir),
    'la teinte du décor et les faces de la tasse d’avant ne suivent pas une planche');
  // Et l'écran relit TOUTES les cases après le choix, pas seulement celles de la tasse.
  assert.ok(/marq\.value = ligne\.marquage \|\| '';\s*\n\s*faces\.value = ligne\.faces \|\| '';\s*\n\s*coul\.value = ligne\.couleur \|\| '';\s*\n\s*majFamille\(\);/.test(ECRAN),
    'marquage, faces et couleur se relisent depuis la ligne après un changement de produit');
}

// --- PU TTC, lié au PU HT (03/09/2026) --------------------------------------
// « tu fait les modif dans vente flash car ces 2 categorie sont lié » (Charlie)
// — la même fonctionnalité que Vente Flash (test/vente-flash.test.js), dans
// l’écran du devis.
assert.ok(/COLONNES = \[.*'PU TTC'.*\]/.test(ECRAN), 'la colonne PU TTC doit exister dans l’en-tête du tableau');
assert.ok(/const puTtc = entree/.test(ECRAN), 'le champ PU TTC doit exister sur chaque ligne');
assert.ok(/tauxEffectif/.test(ECRAN), 'le taux effectif (régime + TGCA) doit servir à convertir HT ↔ TTC');
assert.ok(/puTtc\.addEventListener\('input'/.test(ECRAN),
  'éditer le TTC doit recalculer le HT — sinon le lien n’est que dans un sens');

// --- Tailles libres, « Autres » retiré (03/09/2026) -------------------------
assert.ok(!/TAILLES = \[[^\]]*'Autres'/.test(ECRAN), '« Autres » doit avoir disparu de la liste des tailles fixes');
assert.ok(/taillesLibres/.test(ECRAN), 'les tailles libres (bulles nommées) doivent exister sur chaque ligne');
assert.ok(/\+ Taille/.test(ECRAN), 'le bouton d’ajout d’une taille libre doit exister');

// --- `[hidden]` DÉFAIT PAR `display` (piège déjà documenté du dépôt) -------
// Trouvé en vérifiant Vente Flash au navigateur (03/09/2026) : `.dvf-libres-cadre`
// et `.fa-tailles` portent toutes deux une règle `display` d'auteur qui bat le
// `display: none` de l'agent utilisateur à spécificité égale — sans override
// explicite, `cases.hidden`/`cadreLibres.hidden` ne masquent RIEN sur une
// tasse. Le correctif vit dans la feuille PARTAGÉE (devis-flash.css) : ce
// devis en bénéficie donc déjà, mais on le verrouille aussi depuis cet écran.
assert.ok(/\.dvf-libres-cadre\[hidden\]\s*\{\s*display:\s*none/.test(FEUILLE),
  '.dvf-libres-cadre[hidden] doit forcer display:none — sinon le hidden JS ne masque rien');
assert.ok(/\.fa-tailles\[hidden\]\s*\{\s*display:\s*none/.test(FEUILLE),
  '.fa-tailles[hidden] (scopé à ces deux écrans) doit forcer display:none — six cases fantômes sous une tasse, sinon');

console.log('✓ devis : l’addition tombe juste sur trois arrondis, le papier tient son A4, '
  + 'l’écran ne réinvente aucun composant, les six tailles comptent la quantité, '
  + 'PU TTC lié, tailles libres, hidden/display');
