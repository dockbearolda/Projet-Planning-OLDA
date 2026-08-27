'use strict';

// OUVRIR LA LIGNE, ET LA MARQUE FIVERR À LA PLACE DE LA FLÈCHE.
//
// Deux plaintes du patron, le même jour, sur le même bout d'écran :
//
//   1. « Envoyer vers Fiverr » s'annonçait par une flèche « → ». La flèche dit
//      le GESTE (ça part), jamais la DESTINATION — et la ligne portait déjà une
//      autre flèche (« ↗ ») pour ouvrir la fiche. Deux flèches côte à côte, dont
//      l'une recopie la commande ailleurs : c'est le bouton qu'on presse par
//      erreur. Il faut la marque, reconnaissable du premier coup d'œil.
//
//   2. « Il faut OBLIGATOIREMENT une icône qui permet d'ouvrir la ligne et de
//      voir toutes les indications à l'intérieur. » Le tableau complet n'en avait
//      AUCUNE : les cartes avaient leur bouton, le tableau non. Onze colonnes
//      tronquées, et pas un moyen de lire le dossier entier.
//
// Ce fichier lit les VRAIS fichiers servis (aucune copie) et vérifie que les
// deux corrections tiennent : la marque là où on envoie, le dossier là où on
// ouvre, dans les DEUX vues.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const APP = lire('app.js');
const CSS = lire('styles.css');
const HTML = lire('index.html');

// ===========================================================================
// 1. LA MARQUE FIVERR, PAS UNE FLÈCHE
// ===========================================================================

// L'icône est DESSINÉE, pas prise dans la police d'icônes : `olda-icones.woff2`
// est un sous-ensemble figé, et un nom absent s'y affiche en texte tronqué à sa
// première lettre — sans erreur, sans carré vide, sans rien qui prévienne.
assert.ok(/function fiverrIcon\(\) \{/.test(APP), 'fiverrIcon() doit exister');
const ICONE = APP.match(/function fiverrIcon\(\)[\s\S]*?\n\}/)[0];
assert.ok(/createElementNS/.test(ICONE) && !/material-symbols/.test(ICONE),
  'la marque Fiverr doit être un SVG dessiné, pas une ligature de la police');

// MONOCHROME. Dans cet écran la couleur dit un ÉTAT (--st-livree est vert) :
// une pastille au vert de la marque (#1DBF73) se lirait « livrée » au bout
// d'une ligne. La forme du badge porte seule la reconnaissance.
assert.ok(/fill', 'currentColor'/.test(ICONE),
  'la marque Fiverr doit suivre currentColor');
assert.ok(!/#1[dD][bB][fF]73|#1dbf73/.test(APP + CSS + HTML),
  'aucun vert de marque en dur : le vert de cet écran veut dire « livrée »');

// La cible d'envoi porte sa propre marque, et le code retombe sur la flèche
// générique pour une destination qui n'en aurait pas.
assert.ok(/\{ slug: 'fiverr', label: 'Fiverr', icone: \(\) => fiverrIcon\(\) \}/.test(APP),
  'SEND_TARGETS doit associer Fiverr à sa marque');
assert.ok(/const marque = t\.icone \? t\.icone\(\) : strokeIcon\(\['M5 12h13'/.test(APP),
  'la ligne doit poser la marque de la cible, la flèche seulement en repli');

// La même règle dans la fiche : le bouton « Vers Fiverr » de l'en-tête portait
// la flèche `LD_ICONES.envoyer`, c'est le bouton que le patron voit le plus.
assert.ok(/ldActionBtn\(t\.icone \|\| 'envoyer', `Vers \$\{t\.label\}`/.test(APP),
  'la fiche doit elle aussi montrer la marque de la destination');
assert.ok(/if \(typeof icone === 'function'\) \{/.test(APP),
  'ldActionBtn doit accepter une icône dessinée à la demande');

// L'ONGLET Fiverr du bandeau porte LE MÊME dessin : c'est ce qui fait
// comprendre que le bouton de la ligne mène à cet onglet-là. Les deux tracés
// doivent rester identiques — sinon ils divergent en silence.
// Dans app.js le tracé est écrit en morceaux (un par contre-forme) puis
// recollé ; dans le HTML il tient en un seul attribut `d`. On recolle avant de
// comparer, sinon on comparerait deux mises en forme, pas deux dessins.
const traceApp = (ICONE.match(/'(M[^']+)'/g) || []).map((s) => s.slice(1, -1)).join('');
const traceHtml = (HTML.match(/id="viewFiverr"[\s\S]*?<path[^>]*\sd="([^"]+)"/) || [])[1];
assert.ok(traceApp.length > 100, 'le tracé du badge doit être lisible dans fiverrIcon()');
assert.strictEqual(traceHtml, traceApp,
  'l’onglet Fiverr doit reprendre exactement le tracé de fiverrIcon()');
assert.ok(!/id="viewFiverr"[\s\S]{0,200}material-symbols-outlined/.test(HTML),
  'l’onglet Fiverr ne doit plus afficher le glyphe « draw »');

// ===========================================================================
// 2. OUVRIR LA LIGNE — DANS LES DEUX VUES
// ===========================================================================

assert.ok(/function dossierIcon\(\) \{/.test(APP), 'dossierIcon() doit exister');

// LA CARTE. Elle avait déjà son bouton, mais dessiné en flèche sortante — le
// dessin de « ça part ailleurs », alors que rien ne part.
const CARTE = APP.match(/ouvrir\.className = 'pcard__open'[\s\S]*?openLigneDetail\(r\.id\);/)[0];
assert.ok(/ouvrir\.appendChild\(dossierIcon\(\)\)/.test(CARTE),
  'la carte doit ouvrir sur un dossier, plus sur une flèche sortante');
assert.ok(!/'M7 17L17 7'/.test(APP), 'la flèche sortante ne doit plus exister nulle part');

// LA LIGNE DU TABLEAU. Elle n'avait rien : `openLigneDetail` n'était appelée
// que depuis les cartes, la fiche elle-même et la recherche.
const LIGNE = APP.match(/function buildRow\(r\)[\s\S]*?\n\}/)[0];
assert.ok(/ouvrir\.className = 'open-btn'/.test(LIGNE),
  'la ligne du tableau doit porter son bouton d’ouverture');
assert.ok(/ouvrir\.appendChild\(dossierIcon\(\)\)/.test(LIGNE),
  'et le même dessin que la carte');
assert.ok(/openLigneDetail\(r\.id\)/.test(LIGNE),
  'il doit ouvrir la fiche de SA ligne');
// Premier de la file : c'est le geste qui donne accès à tout le reste.
assert.ok(LIGNE.indexOf("'open-btn'") < LIGNE.indexOf("'send-btn'")
  && LIGNE.indexOf("'open-btn'") < LIGNE.indexOf("'del-btn'"),
'« ouvrir » doit précéder envoyer / dupliquer / supprimer');

// Le même libellé des deux côtés : c'est le même geste.
const libelles = APP.match(/attachTip\((?:ouvrir), '([^']+)'\)/g) || [];
assert.strictEqual(libelles.length, 2, 'les deux vues doivent nommer le geste');
assert.strictEqual(libelles[0], libelles[1],
  'carte et tableau doivent annoncer la MÊME chose');

// ===========================================================================
// 3. « OUVRIR » NE DÉPEND PAS DU SURVOL
// ===========================================================================
// Les autres actions de la colonne n'apparaissent qu'au survol. Sur la tablette
// du comptoir il n'y a pas de souris : un bouton qui attend un survol n'existe
// pas. Celui-là est toujours là.
const REGLE_OPEN = CSS.match(/\n\.open-btn \{[\s\S]*?\n\}/)[0];
assert.ok(!/opacity:\s*0/.test(REGLE_OPEN),
  '.open-btn ne doit jamais partir de opacity: 0');
// Le sélecteur est borné à `.grid tbody` (un `tr:hover` nu marquait tous les
// <tr> du document comme sensibles au survol) et la révélation rend aussi les
// boutons cliquables (`pointer-events`) : invisibles, ils ne le sont pas.
assert.ok(/\.grid tbody tr:hover \.send-btn,\n\.grid tbody tr:hover \.del-btn,\n\.grid tbody tr:hover \.dup-btn \{ opacity: 1; pointer-events: auto; \}/.test(CSS),
  'le contraste est voulu : les autres actions, elles, restent au survol');

// ===========================================================================
// 4. LES QUATRE BOUTONS SONT ALIGNÉS
// ===========================================================================
// Ils étaient posés en `inline-flex` DIRECTEMENT dans la cellule, donc calés sur
// la ligne de texte — et pas de la même façon : « ouvrir » et Fiverr au milieu
// (`vertical-align: middle`), dupliquer et supprimer sur la BASE. Or la base
// d'une boîte `inline-flex` se déduit de son contenu : leurs dessins faisant
// 15 et 16 px, ces deux-là ne tombaient même pas au même pixel. Mesuré : trois
// hauteurs pour quatre boutons (31,8 / 28,0 / 27,5).
assert.ok(/actions\.className = 'row-actions'/.test(LIGNE),
  'la cellule doit porter une rangée .row-actions');
assert.ok(/tdDel\.appendChild\(actions\)/.test(LIGNE),
  'la rangée vit DANS le <td> : un display:flex sur le <td> le sortirait du tableau');
for (const b of ['ouvrir', 'send', 'dup', 'del']) {
  assert.ok(new RegExp(`actions\\.appendChild\\(${b}\\)`).test(LIGNE),
    `« ${b} » doit être posé dans la rangée, pas dans la cellule`);
  assert.ok(!new RegExp(`tdDel\\.appendChild\\(${b}\\)`).test(LIGNE),
    `« ${b} » ne doit plus être posé directement dans la cellule`);
}
const RANGEE = CSS.match(/\n\.row-actions \{[\s\S]*?\n\}/)[0];
assert.ok(/display: flex/.test(RANGEE) && /align-items: center/.test(RANGEE),
  '.row-actions doit centrer ses boutons');
const ecart = Number(RANGEE.match(/gap: (\d+)px/)[1]);
const margeDroite = Number(RANGEE.match(/padding-right: (\d+)px/)[1]);

// Plus aucun calage ni marge PAR BOUTON : c'est exactement ce qui les décalait,
// et une marge par bouton laisse un trou de travers dès qu'une action manque
// (le bouton Fiverr disparaît sur une ligne déjà chez lui).
for (const sel of ['.open-btn', '.send-btn', '.del-btn,\n.dup-btn']) {
  const regle = CSS.match(new RegExp(`\\n${sel.replace(/[.]/g, '\\.')} \\{[\\s\\S]*?\\n\\}`))[0];
  assert.ok(!/vertical-align/.test(regle),
    `${sel} ne doit plus se caler sur la ligne de texte`);
  assert.ok(!/margin-right/.test(regle),
    `${sel} ne doit plus porter sa propre marge — c'est le rôle du gap`);
}

// ---------------------------------------------------------------------------
// …et la colonne les tient. Elle en portait trois : sans élargir, le quatrième
// débordait sur « État », et les planchers de largeur de la grille étaient
// calculés avec l'ancienne valeur — Description et Infos auraient payé le bouton.
const largeurCol = Number(CSS.match(/\.col-del \{ width: (\d+)px; \}/)[1]);
const rangee = (cible) => 4 * cible + 3 * ecart + margeDroite;
assert.ok(largeurCol >= rangee(34),
  `.col-del (${largeurCol}px) doit tenir ${rangee(34)}px de rangée`);

// LE DOUBLE JEU TACTILE A DISPARU LE 25/08. Les boutons passaient à 44 px sous
// `(pointer: coarse)` et la colonne s'élargissait avec eux ; le projet est PC
// uniquement depuis le 21/08, ces règles ne servaient plus personne et
// entretenaient une deuxième échelle de tailles. Ce qui reste vérifié, c'est
// que la colonne tient la rangée à la SEULE taille qui existe désormais.
// (On lit le CODE, pas les commentaires : ceux-ci racontent ce qui a été
//  retiré, et la garde se déclenchait sur leur propre récit.)
assert.ok(!/@media\s*\(pointer:\s*coarse\)/.test(CSS.replace(/\/\*[\s\S]*?\*\//g, '')),
  'plus de second jeu de tailles tactiles : une seule échelle');

// La marge de droite se pose sur la rangée et PAS sur le <td> : `.grid tbody td`
// écrit un `padding` raccourci plus spécifique qui écrasait celui de .col-del —
// la corbeille touchait le bord de la grille.
assert.ok(/\.col-del \{ white-space: nowrap; text-align: right; padding-right: 8px; \}/.test(CSS)
  && margeDroite > 0,
'la marge de droite doit vivre sur .row-actions, que rien n’écrase');

// Les planchers de la grille suivent la LARGEUR RÉELLE des colonnes. Ils ont
// d'abord grandi de 42 px avec la colonne d'actions (116 → 158), puis perdu
// 66 px le 27/08 quand Type a quitté le tableau — une colonne retirée de
// PLANNING_COLS ne peut plus être retranchée par `--cols-off`, c'est donc au
// plancher de l'oublier — et regagné 106 px le même jour, quand cinq colonnes
// ont été élargies à ce qu'elles portent vraiment.
for (const [avant, apres] of [[1376, 1416], [1326, 1366], [1466, 1506]]) {
  assert.ok(CSS.includes(`min-width: calc(${apres}px - var(--cols-off, 0px))`),
    `le plancher ${avant} doit avoir suivi le retrait des deux colonnes`);
}

console.log('✓ planning : la marque Fiverr remplace la flèche, la ligne s’ouvre dans les deux vues OK');
