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

console.log('✓ facture : arithmétique, règlement toujours soldé, pièges accent/jeton évités');
