'use strict';

// AUDIT DU 26/08/2026 — ce qui restait après celui du 25.
//
// Même méthode que la veille : neuf écrans mesurés DANS le navigateur, un
// composant à la fois, puis comparés entre eux — plus les deux parcours du
// comptoir. Ce que la comparaison a donné, et que ce fichier tient :
//
//   · 164 éléments hors échelle sur la SEULE base clients — onze règles en
//     graisse 500 ou 700, c'est-à-dire deux marches que la charte n'a pas.
//     La garde de la veille ne lisait que `styles.css` : le fichier voisin
//     était passé à côté du filet.
//   · CINQ tailles pour la même pastille d'initiale — 40 px en tête de page,
//     42 dans le tiroir, 44 dans la liste, 26 au planning, 24 au point du
//     jour. Le même objet, sur des écrans ouverts à un clic les uns des autres.
//   · DEUX champs de recherche, à un clic l'un de l'autre, différents sur cinq
//     points : 44 px contre 50, 14 de rembourrage contre 12, blanc sur blanc
//     d'un côté et gris recreusé de l'autre, la bordure qui s'accentue ici et
//     l'accent qui s'allume là, --dur-1 contre --dur-2.
//   · QUATRE-VINGT-DEUX replis dans les parcours du comptoir — `var(--jeton,
//     valeur)` — dont dix qui rendaient 15 px et deux 13 px pour le MÊME jeton
//     de 17. Ils ne servent que si la charte n'est pas chargée : l'écran se
//     serait alors rendu dans l'ancienne palette bleu marine, à l'ancienne
//     échelle, sans que rien ne le signale.
//   · TROIS écritures pour la durée de l'accusé de réception : `--dur-1`,
//     `120ms` et `.09s`. Et un arrondi de 9 px sur les 33 entrées du rail —
//     donc la forme la plus vue de l'application était la seule sans jeton.
//   · NEUF onglets pour 1 072 px de barre : il en fallait 1 279. « Réglages »
//     se posait 175 px hors de l'écran, derrière une barre de défilement que
//     rien n'annonce.
//   · HUIT requêtes vouées au 401 sur un poste non connecté, et neuf erreurs
//     rouges en console, sur le premier écran de la journée.
//   · UN redimensionnement de fenêtre qui force jusqu'à dix-huit calculs de
//     mise en page PAR ÉVÈNEMENT, en rafale.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const sansCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CHARTE = lire('public/charte.css');
const CRM = lire('public/styles.css');
const CLIENTS = lire('public/clients.css');
const PROJET = lire('public/projet.css');
const APP = lire('public/app.js');
const PONT = lire('public/comptoir/pont.js');
const INDEX = lire('public/index.html');
const DEVIS = lire('public/comptoir/demande-devis.html');
const VENTE = lire('public/comptoir/vente-directe.html');

const FEUILLES = [['styles.css', CRM], ['clients.css', CLIENTS], ['projet.css', PROJET]];

// ===========================================================================
// 1. LES TROIS GRAISSES, DANS TOUTES LES FEUILLES
// ---------------------------------------------------------------------------
// La garde du 25/08 ne lisait que `styles.css`. `clients.css` en portait onze,
// et l'écran de la vendeuse rendait 157 éléments en 700 et 7 en 500 : cinq
// graisses sur une page, dont deux que Manrope distingue à peine de leurs
// voisines. On lit désormais TOUTES les feuilles avec le même filet.
// ===========================================================================
for (const [nom, src] of FEUILLES) {
  const enDur = [];
  for (const m of sansCom(src).matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (/@font-face/.test(m[1])) continue;         // « 200 800 » y est la PLAGE du fichier
    for (const g of m[2].matchAll(/font-weight:\s*(\d+)/g)) enDur.push(`${m[1].trim().slice(0, 30)} → ${g[1]}`);
  }
  assert.deepStrictEqual(enDur, [], `${nom} : une graisse en dur — les trois jetons suffisent`);
}

// ===========================================================================
// 2. AUCUNE TAILLE ÉCRITE EN CHIFFRES
// ---------------------------------------------------------------------------
// Les icônes en portaient 35 (16, 20, 24, 40) : quatre valeurs sans jeton,
// donc rien qui dise laquelle prendre pour un cas neuf. Elles ont maintenant
// leurs trois marches — --ic-serre / --ic / --ic-grand — et la tuile son
// --ic-tuile. Le texte, lui, n'a jamais que l'échelle de la charte.
// ===========================================================================
for (const [nom, src] of FEUILLES) {
  const enDur = [...sansCom(src).matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => m[1]);
  assert.deepStrictEqual(enDur, [], `${nom} : une taille en chiffres — elle doit sortir d’un jeton`);
}
for (const jeton of ['--ic-serre', '--ic', '--ic-grand', '--ic-tuile', '--rond', '--rond-serre']) {
  assert.ok(new RegExp(`${jeton}:\\s*\\d+px`).test(CHARTE), `${jeton} est déclarée dans la charte`);
}

// ===========================================================================
// 3. UNE DURÉE NE S'ÉCRIT PAS EN CHIFFRES
// ---------------------------------------------------------------------------
// La charte en nomme trois, et la durée DIT quel genre de changement se joue.
// Il y en avait six en service : --dur-1, --dur-2, --dur-3, mais aussi 120ms
// et .09s (qui redisent --dur-1 en chiffres), .28s (entre --dur-2 et --dur-3),
// et côté comptoir .08s / .12s / .16s / .18s. Une transition qui ne sort pas
// d'un jeton, c'est une septième durée en puissance.
// ===========================================================================
for (const [nom, src] of [...FEUILLES, ['pont.js', PONT], ['demande-devis', DEVIS], ['vente-directe', VENTE]]) {
  const chiffrees = [];
  for (const m of sansCom(src).matchAll(/transition[^;}"'`]*/g)) {
    if (/\.01ms/.test(m[0])) continue;             // le repli « mouvement réduit »
    for (const d of m[0].matchAll(/(?<![\w-])(\d*\.?\d+)(m?s)\b/g)) {
      if (d[1] === '0') continue;                  // « visibility 0s … » : un délai nul
      chiffrees.push(`${nom} : ${m[0].trim().slice(0, 60)}`);
    }
  }
  assert.deepStrictEqual(chiffrees, [], `${nom} : une durée en chiffres dans une transition`);
}

// ===========================================================================
// 4. UN REPLI QUI MENT EST PIRE QU'AUCUN REPLI
// ---------------------------------------------------------------------------
// `var(--taille-texte,15px)` ne sert QUE si la charte n'est pas chargée. Ce
// jour-là l'écran ne tomberait pas en panne : il se rendrait dans l'ancienne
// échelle et l'ancienne palette — le bleu marine #142e54 que la charte a
// remplacé le 29/07 — avec l'air d'aller bien. Et les replis se
// contredisaient : --text-1 en avait quatre, --taille-texte deux (15 et 13).
// Un jeton déclaré dans la charte se lit NU.
// ===========================================================================
{
  const declares = new Set([...CHARTE.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const fautifs = [];
  for (const [nom, src] of [['pont.js', PONT], ['demande-devis', DEVIS], ['vente-directe', VENTE],
    ['styles.css', CRM], ['clients.css', CLIENTS], ['projet.css', PROJET]]) {
    for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)\s*,/g)) {
      if (declares.has(m[1])) fautifs.push(`${nom} : var(${m[1]}, …)`);
    }
  }
  assert.deepStrictEqual(fautifs, [],
    'un jeton de la charte se lit nu : le repli ne sert qu’à masquer une charte absente');
}

// ===========================================================================
// 5. LE MÊME CHAMP DE RECHERCHE SUR LES DEUX ÉCRANS
// ---------------------------------------------------------------------------
// Pas « deux qui se ressemblent » : le MÊME. La pilule vit dans la charte,
// avec le bouton « revenir » et le fil des étapes — les composants que plus
// d'un écran porte. Ce qui reste local, c'est la largeur.
// ===========================================================================
assert.ok(/\.champ-recherche\s*\{[^}]*height:\s*var\(--ctrl-h\)/.test(CHARTE),
  'la pilule de recherche vit dans la charte et prend LA boîte');
assert.match(INDEX, /class="champ-recherche grid-search"/,
  'le planning porte la pilule partagée');
assert.match(lire('public/clients.js'), /el\('div', 'champ-recherche cl-search'\)/,
  'la base clients porte la même');
for (const [nom, src, sel] of [['styles.css', CRM, '.grid-search'], ['clients.css', CLIENTS, '.cl-search']]) {
  const regle = sansCom(src).match(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`));
  assert.ok(regle, `${nom} : ${sel} existe`);
  for (const propriete of ['height', 'padding', 'background', 'border-radius', 'transition']) {
    assert.ok(!new RegExp(`(^|;)\\s*${propriete}\\s*:`).test(regle[1]),
      `${nom} : ${sel} ne redit pas « ${propriete} » — la charte le porte`);
  }
}

// ===========================================================================
// 6. NEUF ONGLETS TIENNENT DANS LA BARRE
// ---------------------------------------------------------------------------
// Ils défilaient : `overflow-x: auto` était le dernier recours, calibré sur
// sept onglets. À neuf, « Réglages » se posait 175 px hors de l'écran d'une
// fenêtre de 1 440 — derrière une barre de défilement horizontale que rien
// n'annonce. Un onglet qu'on ne voit pas est un écran qui n'existe pas.
// ===========================================================================
{
  const regle = sansCom(CRM).match(/\.topbar\s+\.nav-switch\s*\{([^}]*)\}/);
  assert.ok(regle, 'la rangée d’onglets a bien sa règle de barre');
  assert.match(regle[1], /flex-wrap:\s*wrap/,
    'la rangée d’onglets se PLIE quand la place manque, elle ne sort pas de l’écran');
}
// … et deux onglets voisins ne portent pas le même pictogramme : « Pilotage »
// et « Dashboard » se suivent, et tous deux disaient `dashboard`.
{
  const icones = [...INDEX.matchAll(/<a class="nav-switch-btn[^"]*"[^>]*>\s*<span class="material-symbols-outlined"[^>]*>([a-z_]+)</g)]
    .map((m) => m[1]);
  assert.ok(icones.length >= 7, 'on lit bien les pictogrammes des onglets');
  assert.strictEqual(new Set(icones).size, icones.length,
    'deux onglets ne partagent pas un pictogramme — ils ne se distingueraient plus que par leur mot');
}

// ===========================================================================
// 7. RIEN NE SE CHARGE DERRIÈRE LE VOILE DE CONNEXION
// ---------------------------------------------------------------------------
// Huit requêtes, huit 401, neuf erreurs rouges — sur le premier écran de la
// journée, et sur une liaison lente, huit allers-retours pour rien. Mesuré
// après correctif : un seul appel, `/api/session`, et zéro erreur.
// ===========================================================================
assert.match(APP, /if \(comptesActifs\(\) && !moi\(\)\) return;\s*\n\s*demarrerAvecReprise\(\);/,
  'le chargement attend qu’on sache qui est au poste');

// ===========================================================================
// 8. LE REDIMENSIONNEMENT NE PIÉTINE PLUS LA MISE EN PAGE
// ---------------------------------------------------------------------------
// Le resserrement du rail lit une géométrie, écrit une largeur, relit, réécrit
// — jusqu'à dix-huit fois. Chaque lecture qui suit une écriture force Chrome à
// recalculer la mise en page avant de répondre, et `resize` part en rafale
// tant qu'on tire le bord de la fenêtre.
// ===========================================================================
assert.match(APP, /resserrementPrevu = true;\s*\n\s*requestAnimationFrame\(resserrerLeRail\);/,
  'la rafale de redimensionnement se fond en une passe par image');

// ===========================================================================
// 9. CE QUI ÉCOUTE LE DÉFILEMENT NE LE FAIT PAS ATTENDRE
// ---------------------------------------------------------------------------
// Posé en capture sur `window`, un écouteur voit CHAQUE défilement de
// l'application. Sans `passive`, Chrome doit attendre qu'il rende la main
// avant de composer l'image suivante — au cas où il annulerait le geste, ce
// qu'aucun de ceux-ci ne fait.
// ===========================================================================
for (const [nom, src] of [['app.js', APP], ['pont.js', PONT]]) {
  for (const m of src.matchAll(/(?:window|document)\.addEventListener\(\s*'(scroll|wheel|touchmove)'[\s\S]{0,200}?\)\s*;/g)) {
    assert.ok(/passive\s*:\s*true/.test(m[0]),
      `${nom} : « ${m[1]} » écouté sans passive — une image d’attente à chaque geste`);
  }
}

// ===========================================================================
// 10. UN SÉLECTEUR RESTÉ OUVERT AVALE LA RÈGLE SUIVANTE
// ---------------------------------------------------------------------------
// DEUX fois dans ce fichier, et par le même geste : on retire un sélecteur
// d'une liste écrite sur plusieurs lignes, et on emporte la ligne qui la
// FERME — accolade et déclaration comprises. Il reste une liste close par une
// virgule, qui se colle à la règle d'après. Le CSS est valide, rien ne
// s'affiche en console, et le symptôme apparaît à côté :
//
//   · `.guide-card` retiré (edf1fc1) → six panneaux ont perdu
//     `overscroll-behavior: contain` et hérité d'un `scrollbar-gutter`. Au
//     bout d'un panneau, c'est la PAGE derrière qui se met à défiler.
//   · `.pj-feed` retiré (089d581) → le panneau du Point du jour a gagné un
//     `gap: 6px` en thème sombre SEULEMENT, et perdu l'ombre qui devait le
//     détacher du fond sombre.
//
// On tient donc les deux déclarations par leur EFFET, pas par leur écriture.
// ===========================================================================
{
  const css = sansCom(CRM);
  const confinement = css.match(/([^{}]*)\{[^{}]*overscroll-behavior:\s*contain[^{}]*\}/g) || [];
  const couvert = confinement.join(' ');
  for (const panneau of ['.pj-body', '.dd-scroll', '.ld-body', '.menu-pop', '.search-palette-results', '.colbar-scroll']) {
    assert.ok(couvert.includes(panneau),
      `${panneau} confine son défilement — sinon la page derrière bouge quand on arrive au bout`);
  }
  // Et le panneau sombre garde SON ombre, sans écart parasite.
  const sombre = css.match(/:root\[data-theme="dark"\] \.dd-panel\s*\{([^}]*)\}/);
  assert.ok(sombre, 'le panneau du Point du jour garde une règle propre en thème sombre');
  assert.match(sombre[1], /box-shadow:/, '… et c’est bien son ombre qu’elle porte');
  assert.ok(!/gap:/.test(sombre[1]), '… et rien d’autre : un « gap » y serait le reste d’une règle avalée');
}

// ===========================================================================
// 11. LA BOÎTE SERRÉE A UNE RECETTE, PAS UN NOMBRE
// ---------------------------------------------------------------------------
// Cinq boutons au rembourrage IDENTIQUE (7 px / 10 px) mesuraient 37, 39, 40,
// 44 et 50 px. Trois causes, toutes invisibles à la lecture :
//   · `min-height` écrit en dur, qui court-circuite le calcul ;
//   · `line-height: normal`, qui laisse le contenu décider — la charte le dit
//     déjà pour la grande boîte, il manquait pour la petite ;
//   · `font: inherit` posé APRÈS l'interligne : le raccourci réécrit
//     `line-height` avec la valeur héritée, et annule la règle sans rien dire.
// La recette tient en quatre ingrédients — taille, interligne, rembourrage,
// trait réservé — et la hauteur en sort seule : 39,4 px, mesuré identique sur
// l'onglet de la barre, l'action de la fiche et les pilules de la base clients.
// ===========================================================================
for (const jeton of ['--ligne-serre', '--trait-reserve', '--champ-y-serre']) {
  assert.ok(new RegExp(`${jeton}:`).test(CHARTE), `${jeton} est déclarée dans la charte`);
}
for (const [nom, src, sels] of [
  ['styles.css', CRM, ['.nav-switch-btn', '.ld-act']],
  ['clients.css', CLIENTS, ['.cl-filter__btn', '.cl-sort__btn', '.cl-seg__btn']],
]) {
  for (const sel of sels) {
    // EN DÉBUT DE LIGNE : la règle de base s'écrit sans indentation, les
    // variantes de requête média sont décalées. Sans l'ancre, on lisait
    // « .topbar .nav-switch-btn { padding: … } » et pas la vraie règle.
    const regle = sansCom(src).match(new RegExp(`^\\${sel}\\s*\\{([^}]*)\\}`, 'm'));
    assert.ok(regle, `${nom} : ${sel} existe`);
    assert.match(regle[1], /line-height:\s*var\(--ligne-serre\)/,
      `${nom} : ${sel} prend l’interligne serré — sinon sa hauteur suit son contenu`);
    // UN TRAIT DE 1 px, VISIBLE OU RÉSERVÉ. Il compte dans la boîte : la pilule
    // de filtre n'en avait pas et tombait à 37,4 quand l'action de la fiche,
    // qui en porte un, faisait 39,4. Même recette, deux pixels d'écart.
    assert.match(regle[1], /border:\s*(var\(--trait-reserve\)|1px solid )/,
      `${nom} : ${sel} porte un trait de 1 px, visible ou réservé — il compte dans la boîte`);
    assert.ok(!/min-height:\s*\d/.test(regle[1]),
      `${nom} : ${sel} n’écrit pas sa hauteur — elle sort de la recette`);
    // L'ORDRE COMPTE : `font:` est un raccourci, il réécrit `line-height`.
    const iLigne = regle[1].indexOf('line-height');
    const mFont = /(^|[;\s])font:\s/.exec(regle[1]);
    assert.ok(!mFont || mFont.index < iLigne,
      `${nom} : ${sel} pose son interligne APRÈS « font: », sinon le raccourci l’écrase`);
  }
}

console.log('✓ audit du 26/08 : une échelle, une boîte, un rond, une durée — et rien qui charge derrière le voile');
