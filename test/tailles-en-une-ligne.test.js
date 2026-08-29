'use strict';

// LA SÉRIE SE DICTE EN UNE LIGNE — optimisation 04 du handoff (29/08/2026)
// ===========================================================================
// « M12 L12 XL6 » remplace toute la grille. C'est la forme sous laquelle une
// série ARRIVE — dans un message, au téléphone, sur un bon du client. La
// ventiler case par case, c'est la retranscrire ; ici on la recopie.
//
// L'EXPRESSION DU HANDOFF NE MARCHE PAS SUR NOS ÉTIQUETTES. Il propose
// `/(XXL|XL|[SMLX])\s*(\d+)/g`. Sur les tailles réelles du catalogue elle se
// trompe deux fois :
//   · « XS12 » → elle y trouve « S » et laisse un « X » orphelin ;
//   · « 2XL6 » → elle y trouve « XL » et perd le « 2 ».
// Les tailles connues viennent donc du DOSSIER, triées de la plus longue à la
// plus courte. Ce fichier tient ces deux cas nommément : ils reviendront le
// jour où quelqu'un « simplifiera » l'expression.
//
// Et trois règles qui casseraient en silence :
//   1. une taille absente de la grille est REFUSÉE, jamais créée ;
//   2. une taille non citée passe à ZÉRO — on dicte la série entière, c'est
//      tout l'intérêt — donc le geste doit être annulable d'un seul clic ;
//   3. le PRIX se repose après coup : le serveur retarife à la quantité.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const JS = lire('public/fiche-atelier.js');
const CSS = lire('public/fiche-atelier.css');
const APP = lire('public/app.js');

const bac = {
  document: { createElement: () => ({ style: {}, classList: { add() {} } }) },
  window: {}, console, Math, JSON, Number, String, Array, Object, Date, RegExp,
  parseFloat, parseInt, setTimeout, clearTimeout, Map, Promise,
};
vm.createContext(bac);
vm.runInContext(`${JS.replace(/^export /gm, '')}\nthis.API = { lireTailles };`, bac);
// LE RÉSULTAT REVIENT D'UN AUTRE REALM. Les objets construits dans le bac à
// sable n'ont pas le même `Object.prototype` que ceux du test :
// `deepStrictEqual` compare les prototypes et refuse deux valeurs pourtant
// identiques. On recopie à la frontière, une fois.
const brut = bac.API.lireTailles;
const lireTailles = (saisie, connues) => JSON.parse(JSON.stringify(brut(saisie, connues)));

// ---------------------------------------------------------------------------
// 1. CE QUE LE HANDOFF AURAIT CASSÉ
// ---------------------------------------------------------------------------
const TEXTILE = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

// « XS12 » : l'expression du handoff y voit « S » + 12. La nôtre voit « XS ».
const xs = lireTailles('XS12', TEXTILE);
assert.strictEqual(xs.lues, 1, '« XS12 » est UNE taille lue, pas une moitié');
assert.deepStrictEqual(xs.tailles.find((t) => t.t === 'XS'), { t: 'XS', n: 12 });
assert.deepStrictEqual(xs.tailles.find((t) => t.t === 'S'), { t: 'S', n: 0 },
  '« S » ne doit RIEN recevoir : c’est « XS » qui a été dicté');
assert.deepStrictEqual(xs.inconnues, [], 'et il ne reste aucun « X » orphelin');

// « 2XL6 » : l'expression du handoff y voit « XL » + 6 et perd le « 2 ».
const deuxXl = lireTailles('2XL6', TEXTILE);
assert.deepStrictEqual(deuxXl.tailles.find((t) => t.t === '2XL'), { t: '2XL', n: 6 });
assert.deepStrictEqual(deuxXl.tailles.find((t) => t.t === 'XL'), { t: 'XL', n: 0 },
  '« XL » ne reçoit rien quand c’est « 2XL » qui est dicté');

// ---------------------------------------------------------------------------
// 2. LA SÉRIE COMPLÈTE, ET LES SÉPARATEURS QU'ON TAPE VRAIMENT
// ---------------------------------------------------------------------------
const G = ['S', 'M', 'L', 'XL'];
assert.deepStrictEqual(lireTailles('M12 L12 XL6', G).tailles,
  [{ t: 'S', n: 0 }, { t: 'M', n: 12 }, { t: 'L', n: 12 }, { t: 'XL', n: 6 }],
  'l’exemple du handoff, mot pour mot');

// La casse, les virgules, les espaces, le « x » : une série se recopie d'un
// message ou se tape à l'oreille, elle n'arrive jamais deux fois pareil.
for (const forme of ['m12 l12 xl6', 'M 12, L 12, XL 6', 'M x12 L x12 XL x6', 'M:12; L:12; XL:6']) {
  assert.deepStrictEqual(lireTailles(forme, G).tailles, lireTailles('M12 L12 XL6', G).tailles,
    `« ${forme} » doit donner la même série`);
}

// UNE TAILLE NON CITÉE PASSE À ZÉRO. C'est la série ENTIÈRE qu'on dicte : sans
// ça, corriger une série à la baisse serait impossible autrement que case à case.
const partiel = lireTailles('M12', G);
assert.deepStrictEqual(partiel.tailles.map((t) => t.n), [0, 12, 0, 0],
  'ce qui n’est pas cité tombe à zéro — on dicte la série, pas un ajout');

// ---------------------------------------------------------------------------
// 3. UNE TAILLE INCONNUE EST REFUSÉE, ET LA FRAPPE N'EST PAS AVALÉE
// ---------------------------------------------------------------------------
// Les tailles viennent du catalogue et du chiffrage. En inventer une donnerait
// à l'atelier une pièce qu'il ne sait pas couper, et au serveur un prix qu'il
// ne sait pas faire.
const horsGrille = lireTailles('M12 XXXL9', G);
assert.deepStrictEqual(horsGrille.tailles.map((t) => t.t), G,
  'la grille garde EXACTEMENT les tailles du dossier');
assert.ok(horsGrille.inconnues.length > 0, 'ce qui n’a pas été compris se dit');

// Rien de compris du tout : on ne touche à RIEN. Reposer une grille vide sur
// une frappe qu'on n'a pas su lire effacerait une série juste.
const rien = lireTailles('bonjour', G);
assert.strictEqual(rien.tailles, null, 'rien compris : la grille ne bouge pas');
assert.deepStrictEqual(rien.inconnues, ['bonjour'], 'et on peut le lui dire');

assert.strictEqual(lireTailles('', G).tailles, null, 'un champ vide ne fait rien');
assert.strictEqual(lireTailles('M12', []).tailles, null,
  'un dossier sans grille de tailles n’en reçoit pas une');
assert.strictEqual(lireTailles(null, G).tailles, null, 'ni valeur du tout : rien');

// Un nombre absurde est borné plutôt que refusé : elle a tapé une touche de trop.
assert.strictEqual(lireTailles('M999999', G).tailles[1].n, 9999, 'la quantité est bornée');

// ---------------------------------------------------------------------------
// 4. L'ÉCRAN : LE CHAMP, SON GESTE, ET CE QU'IL NE FAIT PAS
// ---------------------------------------------------------------------------
assert.match(JS, /placeholder: 'Saisie rapide : M12 L12 XL6 puis Entrée'/,
  'le champ dit ce qu’il attend, comme dans la maquette');
assert.match(JS, /blocT\.append\(dicter, grilleT\)/,
  'il se pose AU-DESSUS de la grille, comme dans la maquette');
// UNE COMMANDE, PAS UNE VALEUR : le champ se vide une fois joué. Sinon il
// laisse croire qu'il décrit l'état de la grille, qui a pu bouger depuis.
assert.match(JS, /dicter\.value = '';/, 'le champ se vide une fois la série posée');
// ANNULABLE D'UN SEUL CLIC, parce qu'il remet des cases à zéro.
assert.match(JS, /empiler\(\(\) => poserGrille\(avantSerie\)\);/,
  'la série remplacée s’annule d’un clic, comme le reste');

// ENTRÉE VALIDE LE CHAMP OÙ L'ON EST, ET NE DÉPLACE PAS LE FOCUS. Ce n'est pas
// un parcours clavier — la règle du 26/08 tient : « pas de chaînage à l'Entrée ».
// C'est le même geste que « + Face », déjà en place.
const BLOC_DICTER = JS.slice(JS.indexOf('const dicter = champ('), JS.indexOf('const blocT ='));
assert.match(BLOC_DICTER, /if \(ev\.key === 'Enter'\) \{ ev\.preventDefault\(\); jouerSerie\(\); \}/,
  'Entrée joue la série');
assert.ok(!/\.focus\(\)/.test(BLOC_DICTER),
  'et ne déplace AUCUN focus : ce n’est pas un enchaînement clavier');
assert.ok(!/Tab|ArrowDown|metaKey|ctrlKey/.test(BLOC_DICTER),
  'aucun autre raccourci n’entre par cette porte');

// ---------------------------------------------------------------------------
// 5. LE PRIX SE REPOSE — SUR LES TROIS CHEMINS QUI ÉCRIVENT LES TAILLES
// ---------------------------------------------------------------------------
// Le serveur retarife à chaque changement de quantité (chiffrage.js). L'écran
// gardait l'ancien montant : la marge et le reste à payer, qui s'en déduisent,
// affichaient alors des chiffres faux sur un écran qu'on lit pour décider.
// Ça ne se voyait pas en corrigeant une case ; la série déplace tout d'un coup.
assert.match(APP, /return maj;/, 'envoyerProduction rend la ligne retarifée');
const chemins = JS.match(/Promise\.resolve\(ctx\.patchProd\(\{ tailles/g) || [];
assert.strictEqual(chemins.length, 3,
  `les TROIS chemins qui écrivent les tailles reposent le prix (${chemins.length} trouvés)`);
assert.match(JS, /if \(maj\.cout_revient !== undefined\)/,
  'le coût de revient suit aussi : il se recalcule lui aussi à la quantité');
assert.match(JS, /majMarge\(\);\s*\n\s*majReste\(\);\s*\n\s*\};/,
  'et la marge comme le reste à payer se refont derrière');

// ---------------------------------------------------------------------------
// 6. LA RANGÉE NE CHANGE PAS DE FORME, ET AUCUNE HAUTEUR N'EST ÉCRITE
// ---------------------------------------------------------------------------
// Règle du dépôt : une hauteur est un JETON, jamais un nombre. Le champ dicté
// prend la boîte commune (`champ()` → `.fa-in`), donc la même hauteur que tous
// les autres — une seule règle, pas deux qui se ressemblent.
const BLOC_CSS = CSS.match(/\.fa-tailles-bloc \{[^}]*\}/)[0];
assert.ok(!/\d+px/.test(BLOC_CSS.replace(/var\([^)]*\)/g, '')),
  'aucune mesure écrite en dur dans le bloc des tailles');
assert.match(BLOC_CSS, /gap: var\(--pas-2\)/, 'l’écart est le jeton, celui des cases');
assert.match(BLOC_CSS, /flex: 1; min-width: 0;/,
  'le bloc reprend la place que la grille prenait seule : la rangée garde sa forme');
assert.ok(!/\.fa-serie \{/.test(CSS),
  'le champ dicté n’a AUCUNE règle à lui : il est un champ comme les autres');

console.log('✓ série en une ligne : « M12 L12 XL6 » repose la grille, le prix suit, et XS/2XL ne se confondent pas');
