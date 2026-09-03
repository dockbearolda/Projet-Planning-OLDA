'use strict';

// ===========================================================================
// LA FACTURE — le quatrième papier (03/09/2026)
// ===========================================================================
// Trois choses qui coûtent cher si elles dérivent, comme pour le devis
// (voir test/devis-flash.test.js) :
//   1. L'ARITHMÉTIQUE — le même moteur que le devis (calculerDevis), jamais
//      un second qui finirait par diverger.
//   2. LE PAPIER — mêmes pièges que les trois autres : accent grave, jeton
//      charte.css.
//   3. L'IMMUABILITÉ — une facture sort TOUJOURS soldée (mode + montant TTC),
//      jamais avec un solde dû.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { chargerPapier } = require('./socle-papier');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const FACTURE_SRC = lire('public/facture.js');

const {
  CSS_FACTURE, modeleFacture, dessinerFacture, MODES_PAIEMENT,
} = chargerPapier('facture.js',
  ['CSS_FACTURE', 'modeleFacture', 'dessinerFacture', 'MODES_PAIEMENT'],
  undefined, ['devis.js']);

function faireDoc() {
  const mk = () => ({
    className: '', textContent: '', children: [],
    append(...n) { this.children.push(...n); },
  });
  return { createElement: mk };
}
const texteEntier = (n) => (n.textContent || '') + n.children.map(texteEntier).join(' ');

const MAISON = {
  nom: 'Atelier OLDA', adresse: '27 rue de Hollande', ville: '97150 Marigot',
  tel: '0690123456', email: 'contact@olda.fr',
  siret: '81234567800019', banque: 'Crédit Mutuel', iban: 'FR7612345678901234567890123', bic: 'CMCIFR2A',
};

const SAISIE = {
  numero: 'FA-2026-0001', date: '2026-09-03', projet: 'Comptoir',
  client: { nom: 'Restaurant Le Flamboyant', ville: 'Marigot', contact: 'Mélina', tel: '0690112233', type: 'pro' },
  lignes: [
    { designation: 'T-shirt logo coeur', reference: 'TS-01', couleur: 'Blanc', tailles: '2 × M', quantite: 2, unitaireHt: 15 },
    { designation: 'Tasse céramique', reference: 'TC-01', quantite: 1, unitaireHt: 8.5 },
  ],
  regime: 'tgca', tauxTgca: 0.04, arrondi: 'aucun', vedette: 'ttc',
  ajustement: { unite: 'eur', valeur: 0 },
  mode: 'cb',
};

// --- Aucun piège des trois autres papiers -----------------------------------
assert.ok(!CSS_FACTURE.includes(String.fromCharCode(96)),
  'un accent grave dans CSS_FACTURE referme le gabarit : l’écran s’affiche NU');
assert.deepStrictEqual(CSS_FACTURE.match(/var\(--(?!pap-|fa-)[\w-]+\)/g) || [],
  [], 'CSS_FACTURE ne doit lire AUCUN jeton de charte.css : le cadre d’impression ne la charge pas');
assert.ok(/width:\s*210mm/.test(CSS_FACTURE) && /min-height:\s*297mm/.test(CSS_FACTURE),
  'la feuille doit être une A4 portrait autonome');
assert.ok(!FACTURE_SRC.includes(String.fromCharCode(96) + String.fromCharCode(96) + 'X'),
  'garde-fou trivial : le fichier source ne doit pas contenir de gabarit corrompu');

// --- Le moteur d'argent est celui du devis, pas un second ------------------
assert.ok(/import\s*\{[^}]*calculerDevis[^}]*\}\s*from\s*'\.\/devis\.js'/.test(FACTURE_SRC),
  'facture.js doit importer calculerDevis de devis.js, pas le réécrire');

// --- L'addition tombe juste ---------------------------------------------------
const t = modeleFacture(SAISIE, MAISON);
assert.strictEqual(t.titre, 'FACTURE');
assert.strictEqual(t.numero, 'FA-2026-0001');
// 2x15 + 1x8,5 = 38,5 HT ; TGCA 4% = 1,54 ; TTC = 40,04
// Intl.NumberFormat separe le montant du symbole par une NO-BREAK SPACE
// (U+00A0), pas une espace ordinaire : echappement explicite plutot
// qu'un caractere tape au clavier, invisible a l'oeil mais faux au test.
const NBSP = ' ';
assert.strictEqual(t.totaux.totalHt, `38,50${NBSP}€`);
assert.strictEqual(t.totaux.taxe, `1,54${NBSP}€`);
assert.strictEqual(t.totaux.ttc, `40,04${NBSP}€`);

// --- Le règlement est TOUJOURS le TTC, jamais un solde ----------------------
assert.ok(t.reglement, 'une facture émise porte toujours un bloc règlement');
assert.strictEqual(t.reglement.montant, t.totaux.ttc,
  'le montant réglé doit être EXACTEMENT le TTC — une facture Vente Flash sort toujours soldée');
assert.strictEqual(t.reglement.mode, 'Carte bancaire');
assert.ok(!('acompte' in t), 'la facture ne porte pas de concept d’acompte/solde, contrairement au devis');
assert.ok(!('appro' in t) && !('delai' in t) && !('bat' in t),
  'pas de bloc délai/BAT sur une facture : elle documente une vente déjà réglée, pas une promesse');

// --- Un champ vide ne s'imprime pas -----------------------------------------
const feuille = dessinerFacture(t, faireDoc());
const rendu = texteEntier(feuille);
// Un nom de client PRO s'affiche EN CAPITALES (nom-client.js, règle unique
// pour toute l'application) — la valeur SAISIE reste 'Restaurant Le
// Flamboyant', seul l'AFFICHAGE change.
assert.ok(rendu.includes('RESTAURANT LE FLAMBOYANT'));
assert.ok(!rendu.includes('undefined') && !rendu.includes('null'));

// --- Les mentions légales sont toujours présentes ---------------------------
assert.ok(rendu.includes('40'), 'l’indemnité forfaitaire de recouvrement doit figurer sur toute facture');
assert.ok(/p[ée]nalit[ée]/i.test(rendu), 'la mention de pénalité de retard doit figurer sur toute facture');

// --- Un mode de paiement inconnu ne casse pas le rendu ----------------------
const sansMode = modeleFacture({ ...SAISIE, mode: 'inconnu' }, MAISON);
assert.strictEqual(sansMode.reglement, null);
assert.doesNotThrow(() => dessinerFacture(sansMode, faireDoc()));

// --- Une facture VIERGE n'affiche aucun total (trouvé en vérifiant l'écran
// vide, 03/09 — même règle que le devis, 02/09 : « par défaut je ne veux pas
// de prix, ça doit être vierge »). Réclamer 0,00 € serait une fausse
// promesse de règlement sur ce document précis.
const vierge = modeleFacture({ ...SAISIE, lignes: [] }, MAISON);
assert.strictEqual(vierge.totaux, null, 'une facture sans ligne ne doit afficher AUCUN total');
assert.strictEqual(vierge.reglement, null, 'une facture sans prix ne doit rien réclamer');
const rendVierge = texteEntier(dessinerFacture(vierge, faireDoc()));
assert.ok(!rendVierge.includes('0,00'), 'aucun montant à zéro ne doit apparaître sur une facture vierge');

// --- MODES_PAIEMENT couvre les cinq modes validés par le serveur -----------
// Array.from(...) plutôt que MODES_PAIEMENT.map(...) : le tableau vient du
// bac à sable vm (autre realm) — un .map() dessus produirait un tableau du
// MÊME realm, et deepStrictEqual refuse de le comparer à un littéral d'ici
// (« same structure but are not reference-equal »). Array.from(), appelé
// dans CE realm, construit le tableau de comparaison ici, une fois pour toutes.
assert.deepStrictEqual(Array.from(MODES_PAIEMENT, (m) => m.id).sort(),
  ['cb', 'cheque', 'especes', 'mixte', 'virement']);

// --- CE QUI REND LA FACTURE OPPOSABLE (03/09/2026) --------------------------
// Vérifié en prod ce jour-là : `app_meta.entreprise` n'existait pas, la facture
// serait sortie avec le NOM SEUL — ni SIRET, ni adresse, ni pied légal. Ces
// trois assertions tiennent le contenu qui distingue une facture d'un reçu.
const IDENTITE = {
  ...MAISON,
  nom: 'Atelier OLDA SARL', siret: '97829695200028', ape: '1813Z',
  rcs: 'Saint-Martin', tva: 'FR86978296952', capital: '500,00 €',
};
const CLIENT_PRO = {
  ...SAISIE,
  client: { ...SAISIE.client, adresse: '12 boulevard de Grand-Case' },
};
const complete = modeleFacture(CLIENT_PRO, IDENTITE);
const papierComplet = texteEntier(dessinerFacture(complete, faireDoc()));

// 1. L'ÉMETTEUR. Le pied ne s'imprime QUE si un numéro légal existe — c'est
//    exactement ce qui manquait, et ce qui ne se voit pas en relisant le code.
assert.ok(complete.maison.legal.length >= 4,
  `le pied légal doit porter les numéros de l'atelier : ${JSON.stringify(complete.maison.legal)}`);
for (const attendu of ['SIRET 978 296 952 00028', 'APE 1813Z', 'RCS Saint-Martin', 'TVA FR86978296952']) {
  assert.ok(papierComplet.includes(attendu), `mention légale absente du papier : ${attendu}`);
}
// « RCS RCS Saint-Martin » : le préfixe est posé par maisonPapier, la valeur
// ne doit pas le reporter. Le genre d'erreur qu'on ne voit qu'à l'impression.
assert.ok(!papierComplet.includes('RCS RCS'), 'le préfixe RCS ne doit pas être écrit deux fois');

// 2. L'ADRESSE DU CLIENT — mention obligatoire, et le reste du bloc client ne
//    doit pas s'être décalé en la posant.
assert.strictEqual(complete.client.adresse, '12 boulevard de Grand-Case');
assert.ok(papierComplet.includes('12 boulevard de Grand-Case'), 'l’adresse du client doit s’imprimer');
// On compare les INTITULÉS, pas les valeurs : « Marigot » est aussi la ville
// de l'atelier, en tête de page — l'index de la valeur pointait sur l'en-tête
// et l'assertion passait (ou échouait) pour la mauvaise raison.
assert.ok(papierComplet.indexOf('ADRESSE') < papierComplet.indexOf('VILLE'),
  'l’adresse s’écrit avant la ville, comme sur une enveloppe');
// Un champ vide ne s'imprime toujours pas : la règle des quatre papiers tient.
const factureSansAdresse = modeleFacture(SAISIE, IDENTITE);
assert.strictEqual(factureSansAdresse.client.adresse, '');

// 3. LES DEUX DATES. L'en-tête porte l'émission (« DU … »), le bloc dossier la
//    VENTE — une facture doit dire les deux, même quand elles tombent le même
//    jour au comptoir.
assert.ok(papierComplet.includes('DATE DE VENTE'), 'le papier doit nommer la date de vente');
assert.ok(papierComplet.includes('DU 03/09/2026'), 'l’en-tête doit porter la date d’émission');

// 4. LE TAUX DE PÉNALITÉ EST CELUI DES CGV DE LA MAISON, pas un autre : le
//    document qui réclame et celui qui engage doivent dire le même chiffre.
assert.ok(complete.mentions.includes('trois fois'),
  `les mentions doivent reprendre le taux des CGV : ${complete.mentions}`);
assert.ok(complete.mentions.includes('40 €') && complete.mentions.includes('L441-10'));

// --- L'AVOIR, LE MÊME PAPIER À TROIS LIGNES PRÈS (03/09/2026) --------------
// Un second fichier de rendu à 95 % identique aurait dérivé du premier au
// premier changement : c'est `modeleFacture` qui compose les DEUX documents, et
// `saisie.avoir` est tout ce qui les distingue.
const AVOIR = {
  ...CLIENT_PRO,
  numero: 'AV-2026-0001',
  lignes: [{ designation: 'Tasse céramique', quantite: 1, unitaireHt: 8.5 }],
  avoir: { surFacture: 'FA-2026-0001', surDate: '2026-09-03', motif: 'Tasse ébréchée' },
};
const avoir = modeleFacture(AVOIR, IDENTITE);
const papierAvoir = texteEntier(dessinerFacture(avoir, faireDoc()));

assert.strictEqual(avoir.titre, 'AVOIR');
// IL CITE LA FACTURE QU'IL CORRIGE, et il la cite en haut : sans ce lien, un
// avoir est un document qui rend de l'argent sans dire pourquoi.
assert.ok(papierAvoir.includes('SUR FACTURE') && papierAvoir.includes('FA-2026-0001'),
  'un avoir doit citer la facture qu’il corrige');
assert.ok(papierAvoir.includes('Tasse ébréchée'), 'le motif doit s’imprimer avec le montant');
assert.ok(papierAvoir.includes('MONTANT DE L’AVOIR'), 'le grand total doit dire ce qu’il est');
// UN AVOIR N'EST PAS UNE VENTE : le mot compte, à côté de « FACTURE DU » juste
// au-dessus — les deux dates diffèrent dès que l'avoir sort un autre jour.
assert.ok(papierAvoir.includes('DATE DE L’AVOIR') && !papierAvoir.includes('DATE DE VENTE'),
  'un avoir date l’avoir, pas une vente');
// LE CADRE NE DIT PAS COMMENT ON A PAYÉ : y laisser « Carte bancaire » ferait
// croire que le remboursement part sur la carte, ce que ce papier ne décide pas.
assert.strictEqual(avoir.reglement.mode, '');
assert.ok(!papierAvoir.includes('Carte bancaire'));
// ET SURTOUT : un avoir ne réclame rien. Lui laisser les mentions de la facture
// (« réglée en totalité à la remise », pénalités de retard, 40 €) lui faisait
// dire exactement le contraire de ce qu'il fait.
assert.ok(!avoir.mentions.includes('40 €') && !avoir.mentions.includes('pénalité'),
  `un avoir ne porte pas les mentions de recouvrement : ${avoir.mentions}`);
assert.ok(avoir.mentions.includes('rectification'));
// La facture, elle, ne devient PAS un avoir au passage.
assert.strictEqual(complete.titre, 'FACTURE');
assert.strictEqual(complete.avoir, null);

// --- LA MENTION QUI JUSTIFIE UNE EXONÉRATION -------------------------------
// Vide = rien ne s'imprime : nous n'inventons AUCUNE citation d'article —
// Saint-Martin a son propre code des contributions.
assert.strictEqual(modeleFacture(CLIENT_PRO, IDENTITE).mentionRegime, '');
const exonere = modeleFacture({
  ...CLIENT_PRO, regime: 'export',
  mentionRegime: 'Exoneration de TGCA — exportation, article a preciser',
}, IDENTITE);
const papierExonere = texteEntier(dessinerFacture(exonere, faireDoc()));
assert.ok(papierExonere.includes('Exoneration de TGCA'), 'la mention de régime doit s’imprimer');
// SUR SA PROPRE LIGNE, avant les mentions de règlement : noyée dans le
// paragraphe des pénalités de retard, elle reviendrait à ne pas être écrite.
assert.ok(papierExonere.indexOf('Exoneration de TGCA') < papierExonere.indexOf('Aucun escompte'));

console.log('✓ facture : arithmétique, mentions légales, adresse client, avoir, exonération, pièges accent/jeton');
