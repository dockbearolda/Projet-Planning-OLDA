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
const vm = require('node:vm');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const APP = lire('app.js');
const CSS = lire('styles.css');
const FICHE = lire('fiche-atelier.js');
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

// L'EN-TÊTE DE LA FICHE N'A PLUS D'ACTIONS (28/08). Charlie, en les désignant :
// « supprime ça ». Quatre boutons au-dessus d'un tableau qu'on vient lire et
// corriger, pour des gestes qu'on fait une fois de temps en temps — et deux
// d'entre eux (dupliquer, vers Fiverr) doublaient la ligne du planning.
// Le tiroir qui portait cet en-tête a été retiré le 29/08 : c'est la fiche
// atelier qu'on contrôle, et elle n'a JAMAIS eu ces quatre boutons.
assert.ok(!/fiverr|dupliquer/i.test(FICHE.split('const outils')[1] || ''),
  'plus de bouton d’envoi dans l’en-tête');
assert.ok(/outils\.append\(etatSauve, bouton\('fa-btn fa-btn--carre', '×'/.test(FICHE),
  'l’en-tête ne garde que ce qu’on fait DEPUIS la fiche : la fermer');

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

// LE BOUTON A DISPARU DES DEUX VUES (28/08/2026). Charlie, en désignant les
// trois pastilles : « ces 3 choses doivent être supprimées définitivement, je
// clique sur la ligne, elle s'ouvre façon tableau et je peux tout modifier ».
//
// Trois portes pour une seule intention — ouvrir le dossier, sortir son ticket,
// sortir son bon de commande — pendant que la ligne elle-même, la cible la plus
// large de l'écran, ne faisait rien quand on la cliquait.
assert.ok(!/'open-btn'/.test(APP), 'plus de bouton d’ouverture dans la ligne');
assert.ok(!/'pcard__open'/.test(APP), 'ni sur la carte');
assert.ok(!/open-btn|pcard__open/.test(CSS), 'et plus de style pour un bouton qui n’existe pas');
assert.ok(!/function dossierIcon/.test(APP), 'ni son dessin');

// C'EST LA LIGNE QUI OUVRE, et par la MÊME fonction que la carte : deux vues à
// un clic l'une de l'autre doivent donner le même geste, pas deux qui se
// ressemblent.
const AUCLIC = APP.match(/function ouvrirAuClic\(el, r\) \{[\s\S]*?\n\}/);
assert.ok(AUCLIC, 'une seule fonction ouvre la fiche');
assert.ok(/openLigneDetail\(r\.id\)/.test(AUCLIC[0]), 'elle ouvre la fiche de SA ligne');
assert.ok(/ouvrirAuClic\(tr, r\)/.test(APP), 'la ligne du tableau s’ouvre au clic');
assert.ok(/ouvrirAuClic\(carte, r\)/.test(APP), 'la carte aussi');
// CE QUI NE DOIT PAS OUVRIR : tout ce qui se manipule DANS la ligne. Une ligne
// entière cliquable avale les gestes qu'elle porte déjà — priorité, pilote,
// état, date, poignée de glissement.
assert.ok(/ZONE_CLIQUABLE/.test(AUCLIC[0]),
  'un clic sur un contrôle de la ligne ne doit pas AUSSI ouvrir la fiche');
// LES DEUX LISTES SE LISENT POUR LEUR VALEUR, pas pour leur orthographe :
// `ZONE_CLIQUABLE` se construit sur `ZONE_SANS_PRISE` depuis le 01/09.
{
  const src = APP.match(/const ZONE_SANS_PRISE = [\s\S]*?const ZONE_CLIQUABLE = [^;]+;/);
  assert.ok(src, 'les deux listes de sélecteurs restent repérables');
  const zones = vm.runInNewContext(`${src[0]}\n({ ZONE_SANS_PRISE, ZONE_CLIQUABLE })`);
  assert.ok(zones.ZONE_CLIQUABLE.includes('.handle'),
    'la poignée de glissement en fait partie : l’attraper n’ouvre pas la fiche');
  assert.ok(!zones.ZONE_SANS_PRISE.includes('.handle'),
    '… mais elle n’entre PAS dans la liste du glisser : la poignée EST la prise');
}
assert.ok(/glisserVientDeFinir\(\)/.test(AUCLIC[0]),
  'la dépose d’un glisser ne doit pas ouvrir le dossier qu’on vient de ranger');
assert.ok(/getSelection\(\)/.test(AUCLIC[0]),
  'copier un texte à la souris finit par un relâchement sur la ligne : ça n’ouvre pas');

const LIGNE = APP.match(/function buildRow\(r\)[\s\S]*?\n\}/)[0];

// ===========================================================================
// 4. LES TROIS BOUTONS SONT ALIGNÉS
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
for (const b of ['send', 'dup', 'del']) {
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
for (const sel of ['.send-btn', '.del-btn,\n.dup-btn']) {
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
const rangee = (cible) => 3 * cible + 2 * ecart + margeDroite;
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
// plancher de l'oublier — regagné 106 px le même jour quand cinq colonnes ont
// été élargies, et reperdu les 116 px de « Documents » le 28/08.
assert.ok(CSS.includes('min-width: calc(1390px - var(--cols-off, 0px))'),
  'le plancher doit avoir suivi le retrait des deux colonnes');

console.log('✓ planning : la marque Fiverr remplace la flèche, la ligne s’ouvre dans les deux vues OK');
