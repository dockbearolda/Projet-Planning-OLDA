'use strict';

// CHANGER D'ÉTAPE OU DE VUE NE DOIT RIEN FAIRE REBONDIR.
// ===========================================================================
// Charlie, 25/08/2026 : « quand je passe de famille en famille, planning,
// dashboard… la page qui se charge rebondit, ça ne fait pas haut de gamme ».
//
// Mesuré avant de toucher quoi que ce soit, sur une étape de 33 lignes
// défilée à 900 px, en changeant de famille :
//
//     hauteur défilable  3 718 px  →  781 px  →  2 992 px      en 24 ms
//
// Le creux, c'est `clearGrid()` appelé AVANT `await loadRows()` : toutes les
// lignes démontées, puis l'attente du réseau. L'ascenseur saute en pleine
// course et revient. 24 ms en local — mais c'est la DURÉE DE LA REQUÊTE en
// atelier, donc un demi-écran effondré pendant une demi-seconde.
//
// Par-dessus, deux mouvements de plus pour le même clic :
//   - douze lignes glissant chacune de 5 px, décalées de 22 ms (154 ms de
//     départs + 260 ms d'animation) ;
//   - le cadre `.work` montant de 6 px PENDANT que le contenu se monte
//     (colonnes du Point du jour posées à 42 ms, animation de 0 à 200 ms).
//
// Trois mouvements pour une intention. Ce fichier garde le principe qui les
// remplace : UN seul mouvement, et il ne déplace RIEN.
//
// Après correction, mêmes conditions : 3 829 → 2 992, en une fois, sans
// jamais descendre sous la hauteur d'arrivée. Et zéro déplacement des repères
// (barre du haut, nav, cadre, rail) sur un aller-retour Planning ↔ Dashboard.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const APP = lire('public/app.js');
const CSS = lire('public/styles.css');
const sansCommentaire = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
const CSSNU = sansCommentaire(CSS);

function fonction(src, nom) {
  const debut = src.indexOf(`function ${nom}(`);
  assert.ok(debut >= 0, `« function ${nom}( » doit rester repérable`);
  const ouvrante = src.indexOf('{', debut);
  let profondeur = 0;
  for (let i = ouvrante; i < src.length; i += 1) {
    if (src[i] === '{') profondeur += 1;
    else if (src[i] === '}') {
      profondeur -= 1;
      if (profondeur === 0) return src.slice(debut, i + 1);
    }
  }
  throw new Error(`accolades non appariées pour ${nom}`);
}

// ===========================================================================
// 1. ON NE VIDE PAS AVANT D'AVOIR LA SUITE
// ===========================================================================
// LA règle. Démonter les lignes puis attendre le réseau, c'est la hauteur
// défilable qui tombe à zéro — l'effondrement que Charlie voyait.
// On juge le CODE, pas les commentaires : celui qui explique la correction cite
// forcément `clearGrid()`, et il ne doit pas faire échouer sa propre garde.
const sansLigneCommentee = (s) => s.replace(/^[ \t]*\/\/.*$/gm, '');
const select = sansLigneCommentee(fonction(APP, 'selectStage'));
const posAttente = select.indexOf('await loadRows()');
assert.ok(posAttente > 0, 'selectStage doit toujours attendre la liste');

const vidagesAvant = select.slice(0, posAttente).match(/clearGrid\(\)/g) || [];
assert.strictEqual(vidagesAvant.length, 0,
  'RIEN ne doit vider la grille AVANT `await loadRows()` : la liste sortante '
  + 'reste à l’écran jusqu’à ce qu’on ait de quoi la remplacer');

// La liste sortante est marquée en attente à la place — et démarquée ensuite,
// quoi qu'il arrive (une erreur réseau ne doit pas laisser l'écran éteint).
assert.ok(/marquerEnAttente\(true\)/.test(select.slice(0, posAttente)),
  '… elle est marquée « en attente » à la place');
// `clearGrid()` remettait AUSSI la signature à zéro. Sans elle, un clic sur une
// sous-étape pendant le chargement reprend le raccourci « même famille » et
// redessine les lignes de la famille PRÉCÉDENTE, filtrées par une sous-étape
// qui ne leur appartient pas. Garder les lignes à l'écran ne veut pas dire
// garder la donnée pour bonne.
assert.ok(/lastRowsSig = '';/.test(select.slice(0, posAttente)),
  '… et la donnée est déclarée périmée dès le clic, même si les lignes restent affichées');
assert.ok(/finally\s*\{[\s\S]*?marquerEnAttente\(false\)/.test(select),
  '… et démarquée dans un `finally` : une panne réseau ne laisse pas la liste éteinte');

// L'ÉCHEC, LUI, VIDE. Garder les lignes de la famille précédente sous le titre
// de la nouvelle serait un mensonge, et le message d'erreur ne se lirait pas.
const bloc = select.slice(select.indexOf('} catch'), select.indexOf('} finally'));
assert.ok(/clearGrid\(\)/.test(bloc),
  'en cas d’échec réseau, la grille se vide : on n’affiche pas la famille précédente sous le nouveau titre');
assert.ok(/Connexion perdue/.test(bloc), '… et on le DIT');

// ===========================================================================
// 2. L'ATTENTE NE SE VOIT QUE SI ELLE DURE, ET ON NE PEUT PAS CLIQUER DEDANS
// ===========================================================================
const attente = CSSNU.match(/\.grid-wrap\.en-attente[^{]*\{([^}]*)\}/);
assert.ok(attente, 'l’état d’attente de la liste doit être habillé');
assert.ok(/pointer-events:\s*none/.test(attente[1]),
  'on ne doit pas pouvoir ouvrir une commande de la famille qu’on vient de quitter');
// Le délai REMPLACE le minuteur qu'il aurait fallu armer puis annuler en JS :
// une réponse en 30 ms ne fait alors rien clignoter du tout.
// LE DÉLAI EST UN JETON DEPUIS LE 26/08 : il était écrit « 160ms » au milieu
// d'une transition, seul nombre de tout le fichier qui ne sortait pas de la
// charte. On vérifie donc les DEUX maillons — la règle prend bien le jeton, et
// le jeton vaut bien assez pour couvrir une réponse rapide.
assert.ok(/transition:[^;]*var\(--delai-aveu\)/.test(attente[1]),
  'le fondu d’attente prend le délai NOMMÉ de la charte, pas un nombre posé là');
const jeton = lire('public/charte.css').match(/--delai-aveu:\s*([\d.]+)(m?s)/);
assert.ok(jeton, '`--delai-aveu` est déclaré dans la charte');
const ms = jeton[2] === 's' ? Number(jeton[1]) * 1000 : Number(jeton[1]);
assert.ok(ms >= 120,
  'le fondu d’attente doit être RETARDÉ (≥ 120 ms) : sinon une réponse rapide fait clignoter l’écran');
// L'opacité, jamais la mise en page : sur une étape de 400 lignes, une
// propriété qui repasse par le layout coûterait le prix de la liste entière.
assert.ok(!/\b(width|height|margin|padding|top|left|display)\s*:/.test(attente[1]),
  '… et il ne touche QUE ce que le compositeur sait animer');

// ===========================================================================
// 3. L'ENTRÉE D'UNE ÉTAPE : UN SEUL MOUVEMENT, QUI NE DÉPLACE RIEN
// ===========================================================================
const entre = fonction(APP, 'playStageEnter');
assert.ok(/mouvementReduit\(\)/.test(entre),
  'qui a demandé le calme ne voit rien bouger');
// Une classe sur LE CONTENEUR, pas une par ligne : la cascade de douze lignes
// (chacune son `animationDelay`) était le troisième mouvement du même clic.
assert.ok(!/animationDelay/.test(entre) && !/for \(const el of host\.children\)/.test(entre),
  'l’entrée ne s’écrit plus ligne par ligne : une classe, sur la liste');

const kf = CSSNU.match(/@keyframes listeIn \{([\s\S]*?)\n\}/);
assert.ok(kf, 'le fondu d’entrée de liste doit exister');
assert.ok(/opacity/.test(kf[1]), '… par l’opacité');
assert.ok(!/transform/.test(kf[1]),
  '… et SANS déplacement : c’est le glissement des lignes qui se lisait comme un rebond');
assert.ok(!/\b(width|height|margin|padding|top|left)\s*:/.test(kf[1]),
  '… ni aucune propriété qui repasse par la mise en page');
assert.ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\.liste-entre \{ animation: none/.test(CSSNU),
  'le garde-fou CSS double celui du script');

// ===========================================================================
// 4. LE CONTENU EST MONTÉ AVANT QUE LE CADRE NE S'ANIME
// ===========================================================================
// Dans l'autre ordre, le cadre finissait de monter de 6 px pendant que le Point
// du jour posait ses colonnes : deux secousses pour un clic.
const vue = fonction(APP, 'setViewMode');
const posAnim = vue.indexOf('jouerBasculeDeVue()');
assert.ok(posAnim > 0, 'setViewMode doit toujours jouer la bascule');
for (const montage of ['dashboard.show()', 'mountClients()', 'mountReglages()', 'mountProjet()']) {
  const pos = vue.indexOf(montage);
  assert.ok(pos > 0 && pos < posAnim,
    `${montage} doit être appelé AVANT jouerBasculeDeVue() — on anime un écran déjà monté`);
}

// ===========================================================================
// 5. VIDER LA GRILLE VIDE AUSSI LES BANNIÈRES DE LOT
// ===========================================================================
// Elles ne sont ni dans `rowEls` ni dans `cardEls` : oubliées, l'en-tête d'un
// ticket survivait au vidage et coiffait les commandes d'une AUTRE famille,
// en désignant le mauvais client.
assert.ok(/nettoyerBandes\(new Set\(\)\)/.test(fonction(APP, 'clearGrid')),
  'clearGrid doit retirer les bannières de lot avec les lignes');

// ===========================================================================
// 6. LE REBOND DE L'OUVERTURE : LA POLICE DU TEXTE
// ===========================================================================
// IL N'Y A PLUS DE POLICE DE TEXTE À ATTENDRE (29/08). C'était Manrope : le
// navigateur ne la découvrait qu'après avoir analysé la feuille, et l'écran
// s'affichait ENTIER dans la police de secours avant de tout recomposer à son
// arrivée. On la préchargeait pour raccourcir l'attente ; depuis qu'on écrit
// dans la police de la MACHINE, il n'y a plus d'attente du tout.
const INDEX = lire('public/index.html');
// On lit le CODE, pas les commentaires : celui d'index.html CITE le nom de la
// police retirée pour dire pourquoi elle l'a été.
const sansCom = (h) => h.replace(/<!--[\s\S]*?-->/g, ' ');
assert.ok(!/manrope/i.test(sansCom(INDEX)), 'plus de police de texte à précharger');
assert.ok(!fs.existsSync(path.join(__dirname, '..', 'public/manrope-latin-variable.woff2')),
  '… et son fichier ne dort plus dans public/');
// LES ICÔNES, ELLES, RESTENT UNE WEBFONT : un nom absent s'y écrit en toutes
// lettres, donc elle se précharge ET se met de côté.
const re = /<link rel="preload" href="olda-icones\.woff2"[^>]*as="font"[^>]*crossorigin/;
assert.ok(re.test(INDEX), 'olda-icones.woff2 doit être préchargée, avec `crossorigin`');
const SW = lire('public/sw.js');
assert.ok(SW.includes('/olda-icones.woff2'), 'olda-icones.woff2 doit être dans la coquille hors ligne');
assert.ok(!/manrope/i.test(SW), 'la police de texte a quitté la coquille avec le fichier');

console.log('✓ bascule : rien ne se vide avant d’avoir la suite, un seul mouvement, et il ne déplace rien');
