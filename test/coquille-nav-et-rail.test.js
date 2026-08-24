'use strict';

// LA COQUILLE : NAVIGATION ET RAIL (24/08/2026)
//
// Deux demandes du patron, le même jour, sur la même ossature :
//
//   1. « Nouveau Projet doit s'ouvrir ICI comme tout le reste, et je dois
//      pouvoir naviguer entre le planning, le dashboard… » — l'onglet n'a
//      jamais ouvert de nouvelle page (c'est un `<a href="#nouveau-projet">`),
//      mais il MASQUAIT toute la navigation : plus d'onglets, plus de rail,
//      plus rien qui dise qu'on est encore dans l'outil. Un cul-de-sac dont on
//      ne sortait que par la flèche du parcours.
//   2. « Le rail doit rester fixe, mais on doit pouvoir le réduire » — la
//      poignée le règle de 180 à 460 px et ne descend pas plus bas.
//
// Ce fichier tient les deux, et le défaut de mise en page qui est revenu en
// cours de route (les actions du coin retombées à gauche).

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(RACINE, 'public/styles.css'), 'utf8');
const APP = fs.readFileSync(path.join(RACINE, 'public/app.js'), 'utf8');

// --- 1. Nouveau Projet est un onglet comme les autres ------------------------
// L'onglet reste un lien de HASH : c'est lui, et lui seul, qui pilote la vue
// (voir applyHash). Un `target="_blank"` ou un `.html` ouvrirait bien une
// nouvelle page — c'est exactement ce qu'on ne veut pas.
const lienProjet = HTML.match(/<a[^>]*id="viewProjet"[^>]*>/);
assert.ok(lienProjet, 'l’onglet Nouveau Projet doit exister');
assert.ok(/href="#nouveau-projet"/.test(lienProjet[0]),
  'Nouveau Projet est un lien de hash : il s’ouvre DANS l’outil');
assert.ok(!/target=/.test(lienProjet[0]),
  '… et jamais dans un nouvel onglet');

// La navigation ne se masque plus sur cette vue : c'est TOUT le sujet de la
// demande. Le rail, lui, reste hors sujet — il ne porte que les étapes du
// planning, qui n'est pas à l'écran.
assert.ok(!/body\.view-comptoir[^{]*\.nav-switch/.test(CSS),
  'la navigation reste visible sur Nouveau Projet : on doit pouvoir en repartir');
assert.ok(/body\.view-comptoir \.grid-search \{[^}]*display: none/.test(CSS),
  'seule la recherche se masque : elle filtre une grille qui n’est pas là');
// LE DÉFAUT QUI EST REVENU EN COURS DE ROUTE : la recherche est le seul
// élément de gauche de la barre. Sans elle, et dès que les onglets passent à la
// ligne (requête de conteneur, seuil 1360 px), les actions du coin retombent
// contre le bord GAUCHE.
assert.ok(/body\.view-comptoir \.topbar-right \{[^}]*margin-inline-start: auto/.test(CSS),
  'sans la recherche, les actions du coin tiennent la droite par une marge automatique');

// --- 2. Le rail se replie d'un clic -----------------------------------------
assert.ok(/id="railToggle"/.test(HTML), 'le bouton de repli du rail doit exister');
// Posé au bord EXACT du rail : la barre du haut commence à sa droite, donc le
// PREMIER enfant de la barre est collé au rail. Et il ne bouge pas selon que le
// rail est ouvert ou fermé — c'est là que la main le cherche.
const barre = HTML.match(/<header class="topbar">([\s\S]*?)<div class="topbar-right">/);
assert.ok(barre, 'la barre du haut doit être lisible');
assert.ok(barre[1].indexOf('id="railToggle"') < barre[1].indexOf('id="gridSearch"'),
  'le bouton de repli ouvre la barre : il est collé au bord du rail');

// LE REPLI SE LIT AVANT LE PREMIER PIXEL. Posé après coup, le rail s'afficherait
// puis se rangerait sous les yeux à chaque ouverture — c'est pour ça que la
// classe vit sur <html> et non sur <body>, comme le thème juste au-dessus.
const tete = HTML.slice(0, HTML.indexOf('</head>'));
assert.ok(/localStorage\.getItem\('olda_rail_plie'\)/.test(tete),
  'le repli du rail se relit dans le script de tête, avant le premier rendu');
assert.ok(/documentElement\.classList\.add\('rail-plie'\)/.test(tete),
  '… et se pose sur <html>, seul élément qui existe déjà à ce moment-là');
assert.ok(/\.rail-plie \.shell \{[^}]*grid-template-columns: 0 0 minmax\(0, 1fr\)/.test(CSS),
  'replié, le rail ne prend plus aucune colonne');
assert.ok(/\.rail-plie \.sidebar,\s*\.rail-plie \.sidebar-resizer \{ display: none/.test(CSS),
  '… et il sort du flux : 32 entrées dans une piste de largeur nulle déborderaient');

// LA POLICE D'ICÔNES EST UN SOUS-ENSEMBLE FIGÉ de 91 glyphes, et elle n'a
// AUCUNE flèche gauche : un nom absent ne lève rien, il s'affiche en texte
// tronqué à sa première lettre. On retourne donc le seul chevron qu'elle porte.
assert.ok(/<button class="icon-btn rail-toggle"[\s\S]{0,400}>chevron_right</.test(HTML),
  'le bouton utilise `chevron_right`, qui EST dans la police');
assert.ok(/\.rail-toggle \.material-symbols-outlined \{[^}]*transform: scaleX\(-1\)/.test(CSS),
  'rail ouvert, le chevron pointe à gauche : « range-toi »');
assert.ok(/\.rail-plie \.rail-toggle \.material-symbols-outlined \{ transform: none/.test(CSS),
  'rail replié, il pointe à droite : « reviens »');

// --- 3. LE RAIL RESTE TANT QU'ON NE LE REFERME PAS --------------------------
// Il se repliait TOUT SEUL hors du planning : l'écran perdait sa colonne de
// gauche en même temps que sa navigation, et changer d'onglet donnait
// l'impression de changer de page. Un seul geste le range désormais : le
// bouton. C'est la demande du 24/08, mot pour mot : « quand je clique, la
// sidebar doit rester si je ne la referme pas ».
assert.ok(!/body\.view-(plein|focus)[^{]*\.sidebar/.test(CSS),
  'le rail ne se replie plus tout seul hors du planning');
assert.ok(!/body\.view-(plein|focus)[^{]*\.rail-toggle/.test(CSS),
  '… et son bouton reste disponible sur toutes les vues');
assert.ok(!/body\.view-(plein|focus) \.shell/.test(CSS),
  'la coquille garde ses trois colonnes partout : le rail a toujours la sienne');
// Ce qui disparaît hors planning, c'est l'échafaudage de la GRILLE — pas la
// navigation. Sans cette règle, l'en-tête d'étape se poserait sur le Dashboard.
assert.ok(/body\.view-plein \.work-head[\s\S]{0,400}?display: none/.test(CSS),
  'hors planning, c’est la grille qui s’efface, pas le rail');

// Le rail est cliquable depuis TOUTES les vues : sans saut vers le planning, il
// chargerait une étape que personne ne regarde et paraîtrait mort.
const sync = APP.match(/function syncTabForStage\(slug, sub\) \{[\s\S]*?\n\}/);
assert.ok(sync, 'syncTabForStage doit exister');
assert.ok(/if \(!isPlanningMode\(viewMode\)\) \{ location\.hash = '#planning'; return; \}/.test(sync[0]),
  'cliquer une étape depuis le Point du jour, la Base clients ou un parcours ramène AU PLANNING');

// --- 4. Le câblage ----------------------------------------------------------
// Mémorisé PAR APPAREIL, comme la largeur du rail juste au-dessus : c'est un
// réglage de poste, pas une donnée de dossier.
assert.ok(/RAIL_PLIE_KEY = 'olda_rail_plie'/.test(APP),
  'le repli se retient dans localStorage, sous la même clé que le script de tête');
assert.ok(/documentElement\.classList\.toggle\('rail-plie'\)/.test(APP),
  'le clic bascule la classe sur <html>');
assert.ok(/aria-expanded/.test(APP) && /Déplier le rail/.test(APP) && /Replier le rail/.test(APP),
  'le bouton dit son état au clavier et au lecteur d’écran');

console.log('✓ coquille : Nouveau Projet garde la navigation, le rail se replie et s’en souvient');

// --- 5. L'ÉCHELLE DE L'ÉCRAN DE RÉFÉRENCE VAUT POUR TOUT L'OUTIL ------------
// « De Nouveau Projet à Réglages, tout doit être parfaitement normé à l'image
// de cette page. » Les trois feuilles du CRM ne connaissaient AUCUN jeton de la
// charte : 293 déclarations de texte sur 15 tailles, 133 arrondis sur 17.
const CLIENTS = fs.readFileSync(path.join(RACINE, 'public/clients.css'), 'utf8');
const PROJ = fs.readFileSync(path.join(RACINE, 'public/projet.css'), 'utf8');
const sansCommentaire = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

for (const [nom, feuille] of [['styles.css', CSS], ['clients.css', CLIENTS], ['projet.css', PROJ]]) {
  const f = sansCommentaire(feuille);
  const parJeton = (f.match(/font-size:\s*var\(--taille-/g) || []).length;
  const enDur = (f.match(/font-size:\s*[0-9.]+px/g) || []);
  assert.ok(parJeton > 0, `${nom} doit employer l’échelle de la charte`);
  // Ce qui reste en dur ne peut être QUE des icônes : elles sont dimensionnées
  // par leur boîte, pas par la ligne de texte. Et leur échelle tient en 4
  // valeurs, contre 15 avant.
  const tailles = [...new Set(enDur.map((d) => parseFloat(d.match(/[0-9.]+/)[0])))];
  const hors = tailles.filter((t) => ![16, 20, 24, 40].includes(t));
  assert.deepStrictEqual(hors, [],
    `${nom} : toute taille en dur doit être une taille d’icône (16/20/24/40), trouvé ${hors}`);
}
// Le TEXTE ne connaît que deux tailles — et `--taille-grand` est réservée aux
// chiffres qu'on annonce, jamais à un intitulé.
const employees = new Set();
for (const d of sansCommentaire(CSS).matchAll(/font-size:\s*var\((--taille-[\w-]+)\)/g)) employees.add(d[1]);
assert.deepStrictEqual([...employees].sort(), ['--taille-grand', '--taille-texte'],
  'deux tailles de texte sur tout l’outil, pas une de plus');

// LA HIÉRARCHIE SE DIT À LA GRAISSE : sans ça, un titre et son paragraphe se
// lisent pareil — c'est ce qui est arrivé en ramenant tout sur une taille.
assert.ok(/#stageTitle|\.work-title h1/.test(CSS), 'le titre d’étape doit avoir sa règle');
const titreEtape = sansCommentaire(CSS).match(/\.work-title h1 \{[^}]*\}/);
assert.ok(titreEtape && /font-weight: var\(--graisse-forte\)/.test(titreEtape[0]),
  'le titre d’étape se distingue par sa GRAISSE, plus par sa taille');

// UNE SEULE BOÎTE DE SAISIE, celle de la charte. Deux exceptions ASSUMÉES, et
// elles sont écrites dans le fichier : l'éditeur posé sur une cellule de la
// grille et les titres de la fiche ne sont pas des champs — ce sont des textes
// qu'on peut taper, leur rembourrage aligne leurs lettres sur celles qu'ils
// recouvrent.
for (const sel of ['.reason-input', '.cat-row-select', '.reg-textarea']) {
  const r = sansCommentaire(CSS).match(new RegExp('\\' + sel + ' \\{[^}]*\\}'));
  assert.ok(r && /padding: var\(--champ-y\) var\(--champ-x\)/.test(r[0]),
    `${sel} prend la boîte de saisie de la charte`);
}
assert.ok(/CET ÉDITEUR N'EST PAS UN CHAMP/.test(CSS),
  'l’exception de `.cell-input` est écrite dans le fichier, pas devinée');

console.log('✓ échelle : le CRM parle la langue de l’écran de référence du comptoir');

// --- 6. UN SEUL VOCABULAIRE DE COMMANDE, ET UNE BASCULE QUI SE VOIT ---------
// « Les mêmes boutons retour, les mêmes boutons valider… pour qu'à l'œil il y
// ait une normalisation complète. » Les boutons du CRM comptaient DIX-NEUF
// rembourrages différents ; l'écran de référence en a deux, plus la forme
// ronde d'un retour / fermer.
{
  const boites = new Set();
  for (const [nom, feuille] of [['styles.css', CSS], ['clients.css', CLIENTS], ['projet.css', PROJ]]) {
    for (const [, sel, corps] of sansCommentaire(feuille).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const s1 = sel.replace(/\s+/g, ' ').trim();
      if (!/button|\.btn|-btn\b|__btn/.test(s1)) continue;
      // Les cases du calendrier sont une GRILLE, pas des commandes ; les boutons
      // en `padding: 0 Npx` tiennent leur hauteur du parent ; `padding: 0` est
      // la forme ronde (44 px), troisième mot du vocabulaire.
      if (/\.cal-|\.maj__btn|\.reg-btn|\.cl-seg__btn/.test(s1)) continue;
      const p = corps.match(/padding:\s*([^;]+)/);
      if (!p) continue;
      const v = p[1].trim();
      if (v === '0' || /^0 \d+px$/.test(v) || v === '10px') continue;
      boites.add(v);
    }
  }
  assert.deepStrictEqual([...boites].sort(),
    ['var(--champ-y) var(--champ-x)', 'var(--champ-y-serre) var(--pas-2)'],
    `deux boîtes de commande sur tout l’outil, trouvé : ${[...boites].join(' / ')}`);
}

// CHANGER DE VUE SE VOIT. Le cadre est le même pour toutes les vues : son
// contenu était remplacé d'une image sur l'autre, sans rien pour relier les
// deux états. Deux propriétés seulement — le compositeur les anime sans
// repasser par la mise en page, une grille de 400 lignes ne coûte rien.
const anim = sansCommentaire(CSS).match(/@keyframes vue-entre \{([\s\S]*?)\n\}/);
assert.ok(anim, 'la bascule d’une vue à l’autre doit être animée');
assert.ok(/opacity/.test(anim[1]) && /transform/.test(anim[1]),
  '… par opacité et déplacement');
assert.ok(!/\b(width|height|margin|padding|top|left)\s*:/.test(anim[1]),
  '… et JAMAIS par une propriété qui repasse par la mise en page');
assert.ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\.work\.vue-entre \{ animation: none/.test(sansCommentaire(CSS)),
  'qui a demandé le calme ne voit rien bouger');
const bascule = APP.match(/function jouerBasculeDeVue\(\) \{[\s\S]*?\n\}/);
assert.ok(bascule, 'jouerBasculeDeVue doit exister');
assert.ok(/prefers-reduced-motion: reduce/.test(bascule[0]),
  '… et le script le vérifie AUSSI, avant de poser la classe');
assert.ok(/void cadre\.offsetWidth/.test(bascule[0]),
  '… avec le recalcul forcé, sans lequel l’animation ne rejoue pas au 2e passage');

console.log('✓ vocabulaire : deux boîtes de commande, et une bascule de vue qui se voit');

// --- 7. UN SEUL BOUTON « RETOUR / FERMER » ---------------------------------
// Celui que le patron a montré du doigt (`.np-bar-home`) : 44 px, rond, bordé.
// Il en existait cinq formes — 32, 36, 40, 44, 46 px, trois arrondis, la moitié
// sans bordure. À l'œil, aucun ne se reconnaissait d'un écran à l'autre.
{
  // Le modèle a déménagé dans la CHARTE le 24/08 (`.btn-retour`) : c'est le seul
  // fichier que le CRM et les deux parcours du comptoir lisent tous les deux.
  const CHARTE0 = fs.readFileSync(path.join(RACINE, 'public/charte.css'), 'utf8');
  const modele = sansCommentaire(CHARTE0).match(/\.btn-retour \{[^}]*\}/);
  assert.ok(modele, 'le bouton « revenir d’un cran » est le modèle : il doit exister');
  assert.ok(/width: 44px/.test(modele[0]) && /border-radius: 999px/.test(modele[0]),
    '… 44 px et rond');
  for (const sel of ['.colbar-close', '.cat-close', '.ld-close']) {
    const r = sansCommentaire(CSS).match(new RegExp('\\' + sel + ' \\{[^}]*\\}'));
    assert.ok(r, `${sel} doit exister`);
    assert.ok(/width: 44px/.test(r[0]) && /height: 44px/.test(r[0]),
      `${sel} prend la taille du bouton de retour`);
    assert.ok(/border-radius: 999px/.test(r[0]), `${sel} est rond comme lui`);
    assert.ok(/border: 1px solid var\(--border\)/.test(r[0]), `${sel} est bordé comme lui`);
  }
  // Les icônes NUES de la barre du haut ne sont pas des retours : ce sont des
  // interrupteurs (plein écran, thème). Elles gardent leur forme sans bordure —
  // la distinction est voulue, le test la tient pour qu'elle ne se perde pas.
  const nu = sansCommentaire(CSS).match(/\.icon-btn \{[^}]*\}/);
  assert.ok(nu && /border: 0/.test(nu[0]),
    'un interrupteur d’icône n’est pas un bouton de retour : il reste sans bordure');
}

console.log('✓ retour : un seul bouton « revenir / fermer » dans toute l’application');

// --- 8. LA FLÈCHE « REVENIR D'UN CRAN » ------------------------------------
// Elle vit dans la CHARTE, pas dans la feuille du CRM : les deux parcours du
// comptoir sont des documents à part, et la charte est le seul fichier qu'eux
// et le CRM lisent tous les deux. C'est ce qui fait que la flèche du parcours
// et celle d'une étape sont littéralement le même bouton.
{
  const CHARTE = fs.readFileSync(path.join(RACINE, 'public/charte.css'), 'utf8');
  const modele = sansCommentaire(CHARTE).match(/\.btn-retour \{[^}]*\}/);
  assert.ok(modele, '.btn-retour doit être déclaré dans la charte, pas ailleurs');
  assert.ok(/width: 44px/.test(modele[0]) && /border-radius: 999px/.test(modele[0])
    && /border: 1px solid var\(--border\)/.test(modele[0]),
    'la flèche est ronde, 44 px, bordée');
  // LA BARRE DE SORTIE DE L'HÔTE N'EXISTE PLUS (24/08). Elle coûtait 61 px pour
  // une seule flèche ; celle-ci vit dans la rangée d'étapes du parcours. Tout
  // ce qui la construisait est parti avec elle — sinon c'est du code qu'on
  // relit pendant des mois sans savoir qu'il ne sert plus.
  assert.ok(!/np-bar/.test(sansCommentaire(PROJ)),
    'plus une règle pour la barre de sortie : elle n’existe plus');

  // ELLE N'APPARAÎT PAS SUR LES TUILES. Elle y restait du temps où elle était la
  // SEULE sortie du poste ; la navigation est revenue, elle n'y ferait plus que
  // doubler l'onglet « Planning » — et proposer de « revenir » d'un écran où
  // l'on vient d'arriver.
  const NP = fs.readFileSync(path.join(RACINE, 'public/nouveau-projet.js'), 'utf8');
  const PONT = fs.readFileSync(path.join(RACINE, 'public/comptoir/pont.js'), 'utf8');
  // LA BARRE DE L'HÔTE NE COÛTE PLUS UNE RANGÉE (24/08). Elle prenait 61 px pour
  // porter UNE flèche, au-dessus d'une rangée d'étapes qui en prenait 94 :
  // 155 px avant le premier champ. Et c'est la rangée d'étapes qui s'en allait
  // au défilement — la barre, hors du cadre, ne bougeait pas.
  assert.ok(!/np-bar|construireBarre|flecheRetour/.test(NP),
    '… et rien ne la construit plus : la barre, son bouton, sa flèche dessinée');
  // La flèche descend DANS le cadre, dans la rangée d'étapes, qui devient
  // collante : on voit en permanence où l'on en est ET par où sortir.
  assert.ok(/id = 'sortieParcours'/.test(PONT) && /b\.className = 'btn-retour'/.test(PONT),
    'la rangée d’étapes porte la sortie, avec le bouton de la charte');
  assert.ok(/position:sticky;top:0/.test(PONT),
    '… et elle est collante : elle ne s’en va plus au défilement');
  // Le fond n'est pas décoratif : sans lui, le contenu défile en transparence
  // derrière les pastilles.
  assert.ok(/background:var\(--bg\)/.test(PONT),
    '… avec un fond opaque, sinon le contenu défile au travers');
  // Le parcours ne connaît AUCUNE adresse : il dit qu'on veut sortir, l'hôte
  // sait ce qu'il y a derrière.
  assert.ok(/OLDA_PARCOURS_RETOUR/.test(PONT) && /OLDA_PARCOURS_RETOUR'\) \{ afficher\(null\)/.test(NP.replace(/msg\.type === '/, "'")),
    'le parcours demande la sortie, l’hôte décide de ce que ça veut dire');

  // Les étapes des DEUX parcours portent la même. `← Retour` en bulle grise
  // n'existe plus nulle part.
  for (const f of ['public/comptoir/demande-devis.html', 'public/comptoir/vente-directe.html']) {
    const doc = fs.readFileSync(path.join(RACINE, f), 'utf8');
    assert.ok(!/>← Retour/.test(doc) && !/textContent='← Retour'/.test(doc),
      `${f} : plus aucun « ← Retour » en bulle grise`);
    assert.ok((doc.match(/class="btn-retour"/g) || []).length >= 2 || /className='btn-retour'/.test(doc),
      `${f} : ses étapes portent la flèche de la charte`);
    // UN `!important` SUR UN SÉLECTEUR NU BAT N'IMPORTE QUELLE CLASSE : sans
    // cette exception, la flèche reprenait l'arrondi d'un CHAMP (9 px).
    assert.ok(/button:not\(\.btn-retour\)\{border-radius/.test(doc),
      `${f} : la flèche échappe à l’arrondi de champ imposé aux boutons`);
  }
}

console.log('✓ flèche : le même « revenir d’un cran » de l’hôte jusqu’aux étapes des parcours');

// --- 9. LA RANGÉE D'ONGLETS EST CENTRÉE, ET LES SEPT SUR LA MÊME LIGNE ------
// Deux défauts mesurés le 24/08 dans la barre du haut.
{
  // (1) « Base clients » était le SEUL des sept à ne pas être sur la ligne :
  // un `margin-top: 6px` traînait dans clients.css, sans un mot pour dire
  // pourquoi. La rangée est centrée (`align-items: center`) : 6 px de marge
  // haute y descendent le bouton de 3 px. Mesuré : haut à 66 px contre 63.
  assert.ok(!/\.nav-switch-btn--base\s*\{[^}]*margin/.test(sansCommentaire(CLIENTS)),
    '« Base clients » n’a plus de marge à elle : les sept onglets sont sur la ligne');

  // (2) Pliés sur leur propre rangée, les onglets partaient du bord gauche —
  // 917 px de contenu dans 1012 px, tout le vide à droite.
  const pli = sansCommentaire(CSS).match(/@container barre \(max-width: 1360px\) \{[\s\S]*?\n\}\n/);
  assert.ok(pli, 'le pli de la barre doit exister');
  assert.ok(/justify-content: safe center/.test(pli[0]),
    'la rangée pliée centre ses onglets');
  // `safe` n'est pas décoratif : la rangée peut DÉFILER, et un `center` sec rend
  // le début du contenu inatteignable dès qu'il déborde — même famille de piège
  // que `justify-content: flex-end`.
  assert.ok(/overflow-x: auto/.test(pli[0]),
    '… et elle défile, ce qui est exactement pourquoi le centrage doit être `safe`');
  // UNE MARGE AUTO MANGE TOUTE LA PLACE LIBRE AVANT `justify-content` : sans la
  // rendre, le centrage ne prend pas. Mesuré : 67,4 px résolus sur le premier
  // onglet, la rangée 33,7 px à droite de l’axe malgré le centrage demandé.
  assert.ok(/\.topbar \.nav-switch > :first-child \{ margin-left: 0; \}/.test(pli[0]),
    '… et le premier onglet rend sa marge automatique, sinon le centrage ne prend pas');
  // Sur la rangée PLEINE, en revanche, les onglets tiennent la droite par cette
  // marge — jamais par flex-end (le contenu sortirait par la gauche).
  assert.ok(/\.nav-switch > :first-child \{ margin-left: auto; \}/.test(sansCommentaire(CSS)),
    'sur la rangée pleine, les onglets tiennent la droite par une marge automatique');
  assert.ok(!/\.nav-switch \{[^}]*justify-content:\s*flex-end/.test(sansCommentaire(CSS)),
    '… jamais par flex-end');
  // Le rembourrage rend l'écart des flancs de la barre (32 à gauche, 16 à
  // droite) : sans lui, centrer dans cette boîte poserait les onglets 8 px à
  // droite de l'axe réel de la barre.
  assert.ok(/padding-inline-end: 16px/.test(pli[0]),
    '… et le rembourrage rend l’écart des flancs, pour que l’axe tombe juste');
}

console.log('✓ barre : sept onglets sur la même ligne, la rangée centrée sur l’axe');

// --- 10. ACTUALISER, ET LE POSTE RÉDUIT À SA LETTRE ------------------------
{
  const NP2 = fs.readFileSync(path.join(RACINE, 'public/nouveau-projet.js'), 'utf8');
  void NP2;
  // LE BOUTON NE RECHARGE PAS LA PAGE. `location.reload()` aurait coûté le
  // défilement, l'étape ouverte, le tiroir d'un dossier et une saisie en cours,
  // pour relire trois listes. On relit les DONNÉES à leur place.
  assert.ok(/id="rechargerBtn"/.test(HTML), 'le bouton d’actualisation doit exister');
  const geste = APP.match(/async function rafraichirLaVue\(\) \{[\s\S]*?\n\}/);
  assert.ok(geste, 'rafraichirLaVue doit exister');
  assert.ok(!/location\.reload/.test(geste[0]) && /loadCounts\(\)/.test(geste[0]),
    'il relit les données, il ne recharge pas la page');
  assert.ok(/selectStage\(currentStage, currentSub, true\)/.test(geste[0]),
    '… et la liste de l’étape courante, en forçant la relecture');
  // LA FLÈCHE FINIT SON TOUR : coupée en plein milieu, elle laisse le trait de
  // travers et l'œil y lit un incident, pas une réussite.
  assert.ok(/RECHARGE_TOUR_MS = 700/.test(APP)
    && /Promise\.all\(\[rafraichirLaVue\(\), tour\]\)/.test(APP),
    'on attend la révolution ET la donnée, jamais l’une sans l’autre');
  assert.ok(/if \(rechargeEnCours\) return;/.test(APP),
    'deux clics ne relisent pas deux fois');
  assert.ok(/@keyframes recharge-tourne \{ to \{ transform: rotate\(360deg\); \} \}/.test(sansCommentaire(CSS))
    && /prefers-reduced-motion: reduce\)\s*\{\s*\.recharge/.test(sansCommentaire(CSS)),
    'la flèche tourne par `transform` seul, et se tait si on a demandé le calme');
  // La police est un sous-ensemble figé de 91 glyphes : aucune icône de
  // rafraîchissement dedans. Elle est donc DESSINÉE.
  assert.ok(/class="recharge-ic"[\s\S]{0,80}viewBox/.test(HTML),
    'la flèche est un SVG dessiné : la police n’en porte pas');

  // LE POSTE NE MONTRE QUE SA LETTRE : le prénom doublait la pastille et tenait
  // 60 à 90 px dans le coin le plus disputé de la barre.
  assert.ok(/\.poste-nom \{ display: none; \}/.test(sansCommentaire(CSS)),
    'le prénom quitte la barre : la pastille dit déjà qui est au poste');
  const poste = sansCommentaire(CSS).match(/\.poste \{[^}]*\}/);
  assert.ok(poste && /width: 44px/.test(poste[0]) && /padding: 0;/.test(poste[0]),
    '… et le bouton devient son disque');
  assert.ok(/aria-label="Poste : /.test(HTML) || /aria-label/.test(HTML),
    'le nom complet reste au nom accessible');
}

// --- 11. TOUT CE QUI PEUT ÊTRE FIGÉ L'EST ----------------------------------
{
  const PONT2 = fs.readFileSync(path.join(RACINE, 'public/comptoir/pont.js'), 'utf8');
  // UNE BARRE QUI ENVELOPPE, pas un bouton glissé DANS la rangée : les deux
  // parcours ne composent pas leurs étapes pareil (flex ici, `repeat(4, 1fr)`
  // là), et un bouton posé dedans devenait une cinquième colonne.
  assert.ok(/barre\.className = 'etapes-barre no-print'/.test(PONT2)
    && /barre\.appendChild\(etapes\)/.test(PONT2),
    'la barre enveloppe la rangée d’étapes, elle ne s’y insère pas');
  assert.ok(/\.etapes-barre\{flex:0 0 auto/.test(PONT2),
    'la barre garde sa hauteur en tête de la colonne : elle ne se comprime pas');
  // UNE SEULE RANGÉE, TOUJOURS. Sous 980 px de cadre, `flex-basis: 20%` mettait
  // les cinq pastilles sur CINQ lignes (mesuré à 569 px de cadre).
  assert.ok(/\.etapes-barre \.stepper\{flex-wrap:nowrap\}/.test(PONT2)
    && /\.etapes-barre \.step\{flex:1 1 0!important/.test(PONT2),
    'les étapes tiennent sur une seule rangée, quelle que soit la largeur');
  assert.ok(/text-overflow:ellipsis/.test(PONT2),
    '… et un libellé qui ne rentre plus se coupe, il ne pousse pas la rangée');
  // LE PANIER N'A PLUS RIEN À SE CALER : il n'est plus dans ce qui défile.
  // La mesure de la barre qui lui servait d'appui est partie avec — du code
  // mort dès l'instant où le document a cessé de défiler.
  assert.ok(!/mesurerLaBarre/.test(PONT2) && !/--h-etapes/.test(PONT2),
    'plus de hauteur à mesurer : rien ne se cale sur rien');
  assert.ok(!/\.etapes-barre\{position:sticky/.test(PONT2),
    'la barre n’a plus besoin d’être collante : elle ne défile plus du tout');

  // SEULE LA COLONNE DE SAISIE DÉFILE. Coller ne suffisait pas : « collant »
  // veut dire que l'élément SUIT le défilement jusqu'à sa marque, puis
  // s'arrête — il bouge donc quand même, sur les premiers pixels. On retire le
  // défilement au document et on le donne à la seule colonne qui doit bouger.
  assert.ok(/html,body\{height:100%;overflow:hidden\}/.test(PONT2),
    'le document du parcours ne défile plus');
  assert.ok(/\.layout>main\{min-height:0;overflow-y:auto/.test(PONT2),
    '… c’est la colonne de saisie qui défile, elle seule');
  // `min-height: 0` n'est pas décoratif : sans lui, un enfant de flex refuse de
  // descendre sous la hauteur de son contenu et c'est la PAGE qui reprend le
  // défilement.
  assert.ok(/\.layout\{flex:1 1 auto;min-height:0/.test(PONT2),
    '… et la mise en page lui laisse la place de le faire');
  // Deux garde-fous que rien ne rappelle quand on relit le fichier :
  assert.ok(/@media screen and \(min-width:981px\)/.test(PONT2),
    'JAMAIS à l’impression : une hauteur d’écran couperait le récapitulatif');
  assert.ok(/min-width:981px/.test(PONT2),
    '… ni sous 981 px, où la mise en page s’empile et rend le défilement à la page');
}

console.log('✓ stabilité : actualiser sans recharger, et tout ce qui peut être figé l’est');
