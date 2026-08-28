'use strict';

// LA FICHE ATELIER — 14 pouces, sans défilement (28/08/2026)
// ===========================================================================
// Spécification livrée en handoff (`design_handoff_fiche_commande`), recréée
// avec les composants et l'état de l'application. Ce fichier tient ce qui se
// casse en silence :
//
//   1. LA CONTRAINTE CENTRALE — rien ne défile à 1366 × 630. Elle ne se
//      mesure qu'au rendu, mais les quatre décisions de structure qui la
//      rendent possible se lisent, elles, dans la feuille ;
//   2. le panneau Détails est un CALQUE et reste MONTÉ ;
//   3. la normalisation des saisies — ce qu'on tape vite et ce qu'on relit ;
//   4. la marge, calculée et jamais stockée ;
//   5. aucun raccourci clavier, sauf Échap pour sortir ;
//   6. le module n'importe rien d'app.js : un cycle casse à l'ouverture.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const JS = lire('public/fiche-atelier.js');
const CSS = lire('public/fiche-atelier.css');
const APP = lire('public/app.js');

// Le module est un module ES du navigateur : on l'évalue dans un bac après
// avoir retiré ses `export`, comme le fait déjà `test/socle-papier.js` pour les
// deux papiers. Aucun DOM n'est touché par les fonctions qu'on éprouve ici.
const bac = { document: { createElement: () => ({ style: {}, classList: { add() {} } }) }, window: {}, console, Math, JSON, Number, String, Array, Object, Date, parseFloat, parseInt, setTimeout, clearTimeout };
vm.createContext(bac);
vm.runInContext(`${JS.replace(/^export /gm, '')}\nthis.API = { normaliserMontant, normaliserTelephone, normaliserHeure, normaliserDate, texteMarge };`, bac);
const { normaliserMontant, normaliserTelephone, normaliserHeure, normaliserDate, texteMarge } = bac.API;

// ---------------------------------------------------------------------------
// 1. LA CONTRAINTE CENTRALE : rien ne défile
// ---------------------------------------------------------------------------
// Mesuré au rendu à 1366 × 630, panneau fermé PUIS ouvert : 0 px de
// débordement sur les deux colonnes, sur la page et sur la fiche. Ce qui le
// rend possible tient en quatre décisions, et chacune se casse d'une ligne.
const RACINE_CSS = CSS.match(/\.fa \{[\s\S]*?\n\}/)[0];
// LA FICHE FAIT SA TAILLE, bornée à l'écran : `inset: 0` la forçait à 100 % de
// haut, et tout ce qui restait sous son contenu devenait du vide à combler —
// on l'avait comblé en étirant deux champs à 287 et 416 px, ce qui remplaçait
// le vide par du gris. Elle s'ancre en haut et s'arrête où son contenu
// s'arrête ; ce sont les COLONNES qui défilent si un dossier déborde.
assert.ok(/position: fixed;/.test(RACINE_CSS) && /max-height: 100vh;/.test(RACINE_CSS),
  'la fiche est bornée à l’écran et ne défile pas elle-même');
assert.ok(!/overflow: hidden;/.test(RACINE_CSS),
  '`overflow: hidden` sur la racine rogne le voile à la hauteur de la fiche : '
  + 'le planning resterait à découvert sous elle');
// Le voile est un FRERE de la fiche : posé dedans, il se voyait à travers
// l'entête et les colonnes — elles n'ont pas de fond opaque — et grisait tout.
assert.ok(/\.fa-voile \{[^}]*position: fixed[^}]*z-index: 59/.test(CSS),
  'le voile se pose juste SOUS la fiche (59 contre 60), jamais dedans');
assert.ok(/ficheAtelierVoile[\s\S]*document\.body\.appendChild\(ficheAtelierVoile\)/.test(APP)
  && /ficheAtelierVoile\.remove\(\)/.test(APP),
  'il est monté et retiré avec la fiche, sinon il reste sur le planning');
assert.ok(!/fa-voile/.test(JS), 'et il n’est jamais un enfant de la racine');
// UN CLIC DEHORS FERME. Sur `click` et non `mousedown` : le champ qu'on quitte
// doit d'abord perdre le focus, c'est son `blur` qui envoie ce qu'on venait d'y
// écrire. Fermé au premier des deux, la saisie partirait dans le vide.
assert.ok(/ficheAtelierVoile\.addEventListener\('click', \(\) => fermerFicheAtelier\(\)\)/.test(APP),
  'un clic sur le voile ferme la fiche');
assert.ok(!/ficheAtelierVoile\.addEventListener\('mousedown'/.test(APP),
  'jamais sur `mousedown` : le blur du champ n’aurait pas encore envoyé la saisie');
const BAS_CSS = CSS.match(/\.fa-bas \{[\s\S]*?\n\}/)[0];
assert.ok(/border-bottom-left-radius/.test(BAS_CSS),
  'la racine ne rognant plus, c’est la barre basse qui porte les coins du bas');
const TRAVAIL = CSS.match(/\.fa-travail \{[\s\S]*?\n\}/)[0];
assert.ok(/min-height: 0;/.test(TRAVAIL),
  'sans `min-height: 0`, une grille en flex:1 prend la hauteur de son CONTENU '
  + 'et pousse la barre basse hors de l’écran');
for (const zone of ['.fa-head', '.fa-bandeau', '.fa-details__b', '.fa-bas']) {
  const regle = CSS.match(new RegExp(`\\${zone} \\{[\\s\\S]*?\\n\\}`))[0];
  assert.ok(/flex-shrink: 0;/.test(regle),
    `${zone} ne se laisse pas comprimer : c'est du chrome fixe, pas de la place à prendre`);
}
assert.ok(/\.fa-col \{[\s\S]*?overflow: auto;/.test(CSS),
  'ce sont les COLONNES qui défileraient, jamais la page — et elles n’ont pas à le faire');

// ---------------------------------------------------------------------------
// 2. LE PANNEAU DÉTAILS EST UN CALQUE, ET IL RESTE MONTÉ
// ---------------------------------------------------------------------------
// Posé dans le flux, il comprime les colonnes et elles se mettent à défiler —
// la seule chose que cet écran ne doit pas faire.
const PANNEAU = CSS.match(/\.fa-details \{[\s\S]*?\n\}/)[0];
assert.ok(/position: absolute;/.test(PANNEAU), 'le panneau est un calque, pas un élément du flux');
assert.ok(/bottom: 105px;/.test(PANNEAU), 'il se pose au-dessus des deux barres basses');
// Démonté au repliage, il emporte les valeurs qu'on venait d'y saisir et fausse
// les calculs qui les lisent. On le masque, on ne le retire pas.
assert.ok(/panneau\.hidden = true;/.test(JS) && /panneau\.hidden = !panneau\.hidden;/.test(JS),
  'le panneau se masque par `hidden`, il n’est jamais démonté');
assert.ok(!/panneau\.remove\(\)/.test(JS), 'et jamais retiré du document');
// `hidden` ne masque rien tout seul quand la classe pose son propre `display`.
assert.ok(/\.fa-details\[hidden\] \{ display: none; \}/.test(CSS),
  'la règle de masquage est écrite en clair : `display: grid` défait `hidden` en silence');

// ---------------------------------------------------------------------------
// 3. CE QU'ON TAPE VITE, CE QU'ON RELIT
// ---------------------------------------------------------------------------
// À l'atelier on tape « 1430 », on veut relire « 14h30 ». Une saisie non
// reconnue est laissée TELLE QUELLE : refuser une valeur au comptoir, c'est
// perdre l'information que quelqu'un venait d'écrire.
// `toLocaleString('fr-FR')` sépare les milliers par une espace INSÉCABLE ÉTROITE
// (U+202F), pas par une espace ordinaire : comparer à l'espace du clavier fait
// échouer un test sur un format qui est le bon. On normalise les blancs.
const blancs = (s) => s.replace(/\s/g, ' ');
assert.strictEqual(normaliserMontant('648,96'), '648,96 €');
assert.strictEqual(normaliserMontant('648.96'), '648,96 €');
assert.strictEqual(normaliserMontant('648,96 €'), '648,96 €');
assert.strictEqual(blancs(normaliserMontant('1250,5')), '1 250,50 €');
assert.strictEqual(normaliserMontant(''), '');
assert.strictEqual(normaliserMontant('à voir'), 'à voir', 'ce qu’on ne sait pas lire, on le garde');

assert.strictEqual(normaliserTelephone('0690778899'), '06 90 77 88 99');
// Sous huit chiffres ce n'est pas un numéro : un poste, un début de saisie.
assert.strictEqual(normaliserTelephone('123'), '123');

assert.strictEqual(normaliserHeure('14'), '14h00');
assert.strictEqual(normaliserHeure('143'), '01h43');
assert.strictEqual(normaliserHeure('1430'), '14h30');
assert.strictEqual(normaliserHeure(''), '');

// Un jeudi 27 août 2026 pour repère.
const REPERE = new Date(2026, 7, 27, 12, 0, 0);
assert.strictEqual(normaliserDate('3/9', REPERE).texte, 'jeu. 03/09');
assert.strictEqual(normaliserDate('03/09/2026', REPERE).texte, 'jeu. 03/09');
assert.strictEqual(normaliserDate('demain', REPERE).texte, 'ven. 28/08');
assert.strictEqual(normaliserDate('auj', REPERE).texte, 'jeu. 27/08');
// UN NOM DE JOUR RENVOIE LA PROCHAINE OCCURRENCE, jamais aujourd'hui : « jeudi »
// dit un jeudi veut dire la semaine suivante.
assert.strictEqual(normaliserDate('jeudi', REPERE).texte, 'jeu. 03/09');
// « +N » = DANS N JOURS. Les quatre boutons rapides ont été retirés le 28/08 :
// ce raccourci est ce qu'ils disaient, il doit rester atteignable au clavier.
assert.strictEqual(normaliserDate('+3', REPERE).texte, 'dim. 30/08');
assert.strictEqual(normaliserDate('+7', REPERE).texte, 'jeu. 03/09');
assert.strictEqual(normaliserDate('+ 1', REPERE).texte, 'ven. 28/08');
assert.strictEqual(normaliserDate('n’importe quoi', REPERE).texte, 'n’importe quoi');
// L'ISO part en base, le texte reste à l'œil : deux choses, jamais confondues.
assert.strictEqual(normaliserDate('3/9', REPERE).iso, '2026-09-03');
assert.strictEqual(normaliserDate('à voir', REPERE).iso, null);

// ---------------------------------------------------------------------------
// 4. LA MARGE SE CALCULE, ELLE NE SE STOCKE PAS
// ---------------------------------------------------------------------------
assert.strictEqual(blancs(texteMarge(648.96, 318.17)), '330,79 € · 51 %');
// UN TTC VIDE OU NUL REND UN TIRET. Une marge sur rien n'est pas zéro pour
// cent : c'est une marge qu'on ne connaît pas, et l'écran doit le dire.
assert.strictEqual(texteMarge(null, 100), '—');
assert.strictEqual(texteMarge(0, 100), '—');
assert.strictEqual(texteMarge(500, null), '—');

// ---------------------------------------------------------------------------
// 5. AUCUN RACCOURCI CLAVIER, SAUF SORTIR
// ---------------------------------------------------------------------------
// Demande explicite : la vendeuse travaille à la souris, souvent une main
// occupée. Tout ce qui est faisable au clavier doit l'être à la souris — d'où
// les boutons de date, les steppers, et les DEUX points d'entrée de
// l'annulation (l'entête et le message).
assert.ok(!/key === '[a-zA-Z]'|ctrlKey|metaKey/.test(JS),
  'aucun raccourci clavier dans la fiche');
assert.ok(/e\.key === 'Escape' && ficheAtelierId/.test(APP),
  'Échap ferme — c’est le geste que tout le monde a déjà, et il ne remplace aucun bouton');
assert.ok(/'↺ Annuler', defaire/.test(JS) && /'fa-toast__undo', 'Annuler'/.test(JS),
  'l’annulation a ses deux points d’entrée souris');
// LA PILE EST ILLIMITÉE et sans expiration : une correction de midi se défait
// à 17 h, c'est la même journée de travail.
assert.ok(!/annulations\.length >|slice\(-\d/.test(JS), 'la pile d’annulation ne se borne pas');

// ---------------------------------------------------------------------------
// 6. LE MODULE NE DÉPEND PAS D'APP.JS
// ---------------------------------------------------------------------------
// Un cycle entre deux modules s'initialise dans un ordre qui dépend de qui
// charge qui, et le jour où il casse, il casse à l'ouverture de l'application.
// Ce que la fiche sait faire de l'application lui est passé à l'appel (`ctx`).
assert.ok(!/from '\.\/app\.js'/.test(JS), 'la fiche n’importe rien d’app.js');
assert.ok(/import \{ dessinerFicheAtelier \} from '\.\/fiche-atelier\.js'/.test(APP),
  'c’est app.js qui l’importe, dans ce sens seulement');
for (const clef of ['patchLigne', 'patchFiche', 'patchProd', 'fermer', 'ajouterNote']) {
  assert.ok(new RegExp(`ctx\\.${clef}`).test(JS), `\`ctx.${clef}\` doit être fourni par l'appelant`);
}
// LE PRIX SUIT TOUJOURS : corriger une taille passe par la même porte que le
// reste (voir chiffrage.js), la fiche ne recalcule rien elle-même.
assert.ok(/patchProd: \(patchProd\) => ldEnvoyerProd\(r, patchProd\)/.test(APP),
  'les tailles passent par le chemin qui retarife la ligne');

// ---------------------------------------------------------------------------
// 7. DEUX PIÈGES DE MISE EN PAGE, NOMMÉS DANS LA SPEC
// ---------------------------------------------------------------------------
// `min-width: 0` sur la case de taille : la largeur intrinsèque d'un `<input>`
// (≈ 20 caractères) l'emporte sinon sur la piste de la grille, et les quatre
// cases débordent de la colonne.
const CASE = CSS.match(/\.fa-taille \{[\s\S]*?\n\}/)[0];
assert.ok(/min-width: 0;/.test(CASE), 'sans min-width:0, la grille des tailles déborde');
// Le reset : un champ en `width:100%` avec padding sort de sa colonne sans lui.
assert.ok(/\.fa \*, \.fa \*::before, \.fa \*::after \{ box-sizing: border-box; \}/.test(CSS),
  'le reset de boîte est posé sur la fiche');

// ---------------------------------------------------------------------------
// 8. LA FEUILLE ET LE MODULE PARTENT AVEC LA COQUILLE
// ---------------------------------------------------------------------------
// Hors ligne, un import qui échoue empêche TOUTE l'application de s'ouvrir.
assert.ok(lire('public/sw.js').includes("'/fiche-atelier.js'"), 'le module est dans la coquille du SW');
assert.ok(lire('public/sw.js').includes("'/fiche-atelier.css'"), 'la feuille aussi');
assert.ok(lire('public/index.html').includes('modulepreload" href="fiche-atelier.js"'));
assert.ok(lire('public/index.html').includes('href="fiche-atelier.css"'));

console.log('✓ fiche atelier : rien ne défile, le panneau est un calque, les saisies se relisent');
