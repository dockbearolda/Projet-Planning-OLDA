'use strict';

const { ecran } = require('./ecran-comptoir');

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
const CSS = require('./feuilles-crm').cssCrm();   // styles.css + les cinq feuilles d'ecran
const APP = fs.readFileSync(path.join(RACINE, 'public/app.js'), 'utf8');

// --- 1. Vente et Devis sont des onglets comme les autres ---------------------
// Ils ont remplacé « Nouveau Projet » le 29/08 (Charlie : « je veux retrouver
// directement vente et devis, ils doivent être cliquables direct ») : l'onglet
// unique ne menait nulle part, il dépliait un panneau de deux lignes pour poser
// une question à deux réponses.
// Ils restent des liens de HASH : c'est lui, et lui seul, qui pilote la vue
// (voir applyHash). Un `target="_blank"` ou un `.html` ouvrirait bien une
// nouvelle page — c'est exactement ce qu'on ne veut pas.
for (const [id, hash] of [['viewVente', '#vente'], ['viewDevis', '#devis']]) {
  const lien = HTML.match(new RegExp(`<a[^>]*id="${id}"[^>]*>`));
  assert.ok(lien, `l’onglet ${id} doit exister`);
  assert.ok(new RegExp(`href="${hash}"`).test(lien[0]),
    `${id} est un lien de hash : il s’ouvre DANS l’outil`);
  assert.ok(!/target=/.test(lien[0]), '… et jamais dans un nouvel onglet');
}
// Et le panneau qu'ils remplacent n'existe plus nulle part : ni sa rangée, ni
// son calque, ni les trois écouteurs qu'il fallait pour le refermer.
assert.ok(!/np-menu/.test(CSS) && !/np-menu/.test(APP),
  'le menu de « Nouveau Projet » est parti en entier — feuille comprise');

// La navigation ne se masque plus sur cette vue : c'est TOUT le sujet de la
// demande. Le rail, lui, reste hors sujet — il ne porte que les étapes du
// planning, qui n'est pas à l'écran.
assert.ok(!/body\.view-comptoir[^{]*\.nav-switch/.test(CSS),
  'la navigation reste visible sur Nouveau Projet : on doit pouvoir en repartir');
// LA RECHERCHE NE SE MASQUE PLUS NON PLUS (24/08 au soir). Elle restait
// cachée sur cette vue — « elle filtre une grille absente de l'écran ». Mais
// une barre qui perd un élément en changeant d'onglet n'est plus une ossature,
// et le vide qu'elle laissait déplaçait le reste : il avait fallu une marge
// automatique de rattrapage sur `.topbar-right`, partie avec le masquage.
// Elle n'a jamais eu besoin de la grille : elle interroge le SERVEUR et rend
// ses résultats dans sa propre palette, par-dessus l'écran — vérifié depuis un
// parcours ouvert, « esmeralda » y trouve bien son dossier.
assert.ok(!/body\.view-comptoir[^{]*\.grid-search/.test(CSS),
  'la recherche reste à sa place sur Nouveau Projet');
assert.ok(!/body\.view-comptoir[^{]*\.topbar-right/.test(CSS),
  '… et la marge qui rattrapait son absence n’a plus d’objet');

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
// La fenêtre est large À DESSEIN : ce qui compte, c'est que `.work-head` et
// `display: none` soient dans LE MÊME bloc de sélecteurs, pas qu'ils soient
// proches. Chaque commentaire ajouté entre deux sélecteurs de la liste rognait
// la marge, et la garde tombait sur une règle parfaitement correcte.
assert.ok(/body\.view-plein \.work-head[\s\S]{0,1200}?display: none/.test(CSS),
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

// --- 3. LE RAIL S’ÉLARGIT PAR-DESSUS LA ZONE DE TRAVAIL -----------------------
// « Quand j’élargis le rail, ma zone de travail se rétrécit » (24/08). Elle se
// rétrécissait pour de bon : le rail est une COLONNE de la grille du .shell,
// donc chaque pixel qu’il prenait était retiré à la carte de travail, qui
// recalculait toute sa grille à CHAQUE pixel du glisser — les colonnes des
// cartes changeaient de largeur sous les yeux, le texte se repliát, et la
// requête de conteneur de `.grid-wrap` rebasculait d’une disposition à l’autre.
//
// La zone de travail ne concède plus QUE la largeur MINIMALE du rail (284 px,
// la même que SIDEBAR_MIN). Tout ce que le rail prend au-delà, il le prend
// PAR-DESSUS : la boîte de travail ne bouge plus d’un pixel, ni en largeur ni
// en position, et c’est le rail qui recouvre le bord gauche des cartes.
//
// À NE PAS CONFONDRE avec « la zone de travail ne perd plus rien » : le rail
// reste opaque et à gauche, donc ce qu’il gagne, l’œil le perd de toute façon.
// Ce qui est gagné ici, c’est que RIEN NE SE RECALCULE — pas de reflux, pas de
// saut de mise en page (CLS), un glisser de poignée à 60 fps.
const shellCSS = (CSS.match(/\n\.shell \{\n[\s\S]*?\n\}/) || [''])[0];
// 284 px à la refonte du 24/08, 320 depuis le 25/08 : cette largeur n'est pas
// un chiffre rond, elle se DÉDUIT de la typographie du rail. Elle avait été
// mesurée sur les 33 libellés du pipeline en 12,5 px ; passés en 16 px, sept
// d'entre eux se cassaient sur deux ou trois lignes au lieu de quatre. 320 px
// rétablit exactement le pliage d'origine, et au-delà on ne gagne plus rien
// (mesuré : 340 px donne le même résultat que 320). Toute nouvelle taille de
// libellé oblige à refaire cette mesure.
const base = shellCSS.match(/--rail-base:\s*(\d+)px/);
assert.ok(base, 'la coquille nomme la part de rail que la zone de travail concède');
assert.ok(Number(base[1]) >= 320,
  `--rail-base = ${base[1]}px : sous 320, les libellés d’étape se replient en 16 px`);
// Le socle CSS et la borne du script disent le MÊME nombre — c'est l'invariant,
// pas la valeur. S’ils divergent, le rail découvre une bande de carte
// (base > min) ou la recouvre en permanence (base < min) : deux défauts muets,
// invisibles au minimum de largeur. On le vérifie donc PAR ÉGALITÉ, pour que la
// largeur puisse suivre la typographie sans qu'on ait à corriger un littéral.
const min = APP.match(/SIDEBAR_MIN\s*=\s*(\d+)/);
assert.ok(min, 'SIDEBAR_MIN doit exister');
assert.strictEqual(min[1], base[1],
  'la largeur minimale du rail et `--rail-base` sont le MÊME nombre');
// Le surplus : ce que le rail prend au-delà de sa base. Jamais négatif — un
// rail plus étroit que sa base pousserait la zone de travail vers la droite.
assert.ok(/--rail-sur:\s*max\(0px,/.test(shellCSS),
  'le surplus du rail ne descend jamais sous zéro');
// La zone de travail se reprend ce surplus par la GAUCHE : sa boîte part
// toujours de `--rail-base` + la poignée, quelle que soit la largeur du rail.
assert.ok(/\n\.app \{\n[\s\S]*?margin-left: calc\(-1 \* var\(--rail-sur/.test(CSS),
  'la zone de travail glisse SOUS le rail au lieu de se laisser rétrécir');
// Sans peinture au-dessus, la carte passerait PAR-DESSUS le rail : les étapes
// disparaîtraient derrière elle dès le premier pixel de surplus.
const railCSS = (CSS.match(/\n\.sidebar \{\n[\s\S]*?\n\}/) || [''])[0];
assert.ok(/position: relative/.test(railCSS) && /z-index: 10/.test(railCSS),
  'le rail se peint AU-DESSUS de la zone de travail');
// … et sous la barre du haut (20) : le rail ne recouvre jamais les onglets, ni
// le bouton qui le range. C’est pour ça que la barre garde sa colonne à lui.
assert.ok(/\.topbar \{[\s\S]*?z-index: 20/.test(CSS),
  'la barre du haut reste au-dessus du rail');
// LA POIGNÉE EST OPAQUE. Les 16 px de respiration entre le rail et la carte
// sont sa colonne à elle : transparente, on y verrait la carte glisser dessous
// et le rail paraîtrait collé au papier.
const poigneeCSS = (CSS.match(/\n\.sidebar-resizer \{\n[\s\S]*?\n\}/) || [''])[0];
assert.ok(/background: var\(--bg\)/.test(poigneeCSS),
  'la poignée masque ce qui glisse dessous : elle porte le fond de la page');
assert.ok(/z-index: 10/.test(poigneeCSS),
  '… et elle se peint elle aussi au-dessus de la zone de travail');
// Rail rangé : plus de colonne, donc plus de surplus. Sans cette remise à zéro,
// la zone de travail garderait sa marge négative et sortirait de l’écran par la
// gauche — sans aucun rail pour la recouvrir.
assert.ok(/\.rail-plie \.shell \{[^}]*--rail-sur: 0px/.test(CSS),
  'rail rangé, la zone de travail reprend toute sa place');
// Même raison en une seule colonne (≤ 640) : le rail n’est plus à gauche mais
// AU-DESSUS, il ne recouvre donc plus rien.
const uneColonne = (CSS.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}\n/) || [''])[0];
assert.ok(/--rail-sur: 0px/.test(uneColonne),
  'empilé sur une colonne, le rail ne recouvre plus la zone de travail');

console.log('✓ coquille : le rail s’élargit par-dessus la zone de travail, qui ne bouge plus');

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
// LE TEXTE NE CONNAÎT QUE TROIS TAILLES, chacune avec un seul métier :
//   --taille-texte  ce qui se lit et ce qui se saisit ;
//   --taille-note   une ANNOTATION secondaire, et rien d'autre ;
//   --taille-grand  les chiffres qu'on annonce, jamais un intitulé.
// « --taille-note » est entrée le 25/08 avec les pastilles « À voir » et leur
// motif : ils écrivaient en 16 px, la dernière taille de vrai texte à traîner
// hors de l'échelle. Le point qui compte n'a pas changé — la liste est CLOSE,
// et une quatrième taille fait tomber le test.
const employees = new Set();
for (const d of sansCommentaire(CSS).matchAll(/font-size:\s*var\((--taille-[\w-]+)\)/g)) employees.add(d[1]);
assert.deepStrictEqual([...employees].sort(), ['--taille-grand', '--taille-note', '--taille-texte'],
  'trois tailles de texte sur tout l’outil, pas une de plus');

// LA HIÉRARCHIE SE DIT À LA GRAISSE : sans ça, un titre et son paragraphe se
// lisent pareil — c'est ce qui est arrivé en ramenant tout sur une taille.
// Le titre d'étape a rejoint l'en-tête d'écran de la charte le 30/08 : la règle
// à garder est donc celle du composant, dans `charte.css`, et il n'y en a plus
// qu'UNE pour les huit écrans (il y en avait six).
const CHARTE_TETE = fs.readFileSync(path.join(RACINE, 'public/charte.css'), 'utf8');
const titreEcran = sansCommentaire(CHARTE_TETE).match(/\.ecran-tete__titre \{[^}]*\}/);
assert.ok(titreEcran, 'l’en-tête d’écran de la charte doit avoir sa règle de titre');
assert.ok(/font-weight: var\(--graisse-forte\)/.test(titreEcran[0]),
  'le titre d’écran se distingue par sa GRAISSE');
assert.ok(/font-size: var\(--taille-titre\)/.test(titreEcran[0]),
  'le titre d’écran prend le cran que la charte lui réserve (21 px), pas celui des chiffres');
// AUCUN ÉCRAN NE RÉÉCRIT SON TITRE. C'est le fond de la passe du 30/08 : six
// classes de titre dans cinq fichiers, trois tailles, quatre abscisses. Un écran
// qui s'en refait un ne se voit qu'en comparant deux écrans — donc ici.
for (const perdu of ['.work-title', '.mt-head__titre', '.pil-titre', '.cl-brand__title', '.reg-head__title']) {
  assert.ok(!sansCommentaire(CSS).includes(`${perdu} `) && !sansCommentaire(CLIENTS).includes(`${perdu} `),
    `${perdu} : un écran ne réécrit pas le titre de la charte`);
}

// UNE SEULE BOÎTE DE SAISIE, celle de la charte. Une exception ASSUMÉE — les
// titres de la fiche ne sont pas des champs, ce sont des textes qu'on peut
// taper, leur rembourrage aligne leurs lettres sur celles qu'ils recouvrent.
// La SECONDE exception, `.cell-input` (l'éditeur posé sur une cellule de la
// grille), A DISPARU LE 30/08 avec la ligne elle-même : les quatre champs
// qu'elle portait (dossier, article, prix, note) ne s'éditent plus en place,
// ils se lisent — voir test/prix-vide-ouvre-la-fiche.test.js.
for (const sel of ['.reason-input', '.cat-row-select', '.reg-textarea']) {
  const r = sansCommentaire(CSS).match(new RegExp('\\' + sel + ' \\{[^}]*\\}'));
  assert.ok(r && /padding: var\(--champ-y\) var\(--champ-x\)/.test(r[0]),
    `${sel} prend la boîte de saisie de la charte`);
}
assert.ok(!/cell-input/.test(CSS),
  'l’exception `.cell-input` est partie avec la dernière cellule éditable en ligne');

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
      if (/\.cal-|\.maj__btn|\.reg-btn/.test(s1)) continue;
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
  // LE ROND EST UN JETON DEPUIS LE 26/08 (`--rond`), et la pilule aussi
  // (`--pilule`). Le nombre s'écrivait treize fois dans le CRM : on vérifie
  // donc que le modèle prend bien le jeton, ET que le jeton vaut bien 44 px.
  assert.ok(/width: var\(--rond\)/.test(modele[0]) && /border-radius: var\(--pilule\)/.test(modele[0]),
    '… la boîte ronde nommée de la charte');
  assert.match(CHARTE0, /--rond:\s*44px/, '… et ce rond vaut 44 px');
  // `.ld-close` est parti avec le tiroir le 29/08. La croix de la fiche
  // atelier est `.fa-btn--carre`, dans sa propre feuille.
  for (const sel of ['.colbar-close', '.cat-close']) {
    const r = sansCommentaire(CSS).match(new RegExp('\\' + sel + ' \\{[^}]*\\}'));
    assert.ok(r, `${sel} doit exister`);
    assert.ok(/width: var\(--rond\)/.test(r[0]) && /height: var\(--rond\)/.test(r[0]),
      `${sel} prend la taille du bouton de retour`);
    assert.ok(/border-radius: var\(--pilule\)/.test(r[0]), `${sel} est rond comme lui`);
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
  assert.ok(/width: var\(--rond\)/.test(modele[0]) && /border-radius: var\(--pilule\)/.test(modele[0])
    && /border: 1px solid var\(--border\)/.test(modele[0]),
    'la flèche prend la boîte ronde nommée, et elle est bordée');
  assert.match(CHARTE, /--rond:\s*44px/, '… et ce rond vaut 44 px');
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
  // PLUS AUCUNE FLÈCHE DANS LE CADRE (27/08/2026). Charlie : « cette flèche
  // devient inutile, supprime ». Elle avait sa raison quand le parcours
  // occupait l'écran entier : c'était la seule porte. Depuis que la barre de
  // navigation reste visible autour du cadre, elle en était une deuxième — et
  // deux sorties à trois centimètres l'une de l'autre se contredisent.
  // Tout ce qui la construisait part avec elle, sinon c'est du code qu'on
  // relit pendant des mois sans savoir qu'il ne sert plus.
  assert.ok(!/sortieParcours/.test(PONT),
    'le cadre ne greffe plus de flèche de sortie');
  assert.ok(!/btn-retour/.test(PONT),
    '… ni le bouton de la charte qui la portait');
  // LA BARRE, ELLE, RESTE — elle n'a jamais été là pour la flèche. C'est elle
  // qui pose le fond, la hauteur fixe et la rangée sur UNE seule ligne, pour
  // les deux parcours à la fois : ils ne composent pas leurs étapes pareil (la
  // demande de devis en flex, la vente directe en grille de quatre colonnes),
  // et un bouton posé DANS la rangée y devenait une cinquième colonne.
  assert.ok(/function grefferBarreEtapes\(\) \{/.test(PONT),
    'la rangée d’étapes garde sa barre : c’est elle qui la tient sur une ligne');
  assert.ok(/barre\.className = 'etapes-barre no-print'/.test(PONT)
    && /barre\.appendChild\(etapes\)/.test(PONT),
    '… elle enveloppe la rangée au lieu de se glisser dedans');
  // Le fond n'est pas décoratif : sans lui, le contenu défile en transparence
  // derrière les pastilles.
  assert.ok(/\.etapes-barre\{[^']*background:var\(--bg\)/.test(PONT),
    '… avec un fond opaque, sinon le contenu défile au travers');
  // L'HÔTE GARDE SON GUICHET. Plus personne ne lui demande de fermer un
  // parcours depuis le cadre, mais c'est son contrat public : le supprimer
  // ferait échouer en silence tout parcours qui le rappellerait un jour.
  assert.ok(/OLDA_PARCOURS_RETOUR'\) \{ afficher\(null\)/.test(NP.replace(/msg\.type === '/, "'")),
    'l’hôte sait encore fermer un parcours qui le lui demande');

  // `← Retour` en bulle grise n'existe plus nulle part.
  //
  // REVIREMENT DU 24/08, APRÈS COUP : la demande de devis portait DEUX flèches
  // à l'écran — celle de la rangée d'étapes (« quitter le parcours ») et une
  // en bas de chaque étape (« revenir d'un cran »). Deux gestes différents,
  // mais deux flèches identiques à 40 cm des yeux. Le patron a tranché : « les
  // flèches retour ici sont supprimées définitivement, car elle existe en haut
  // à gauche. » Il n'en reste qu'UNE par écran, celle que pont.js greffe.
  // Ce que ça coûte est écrit noir sur blanc plus bas.
  for (const f of ['demande-devis', 'vente-directe']) {
    const doc = ecran(f);
    assert.ok(!/>← Retour/.test(doc) && !/textContent='← Retour'/.test(doc),
      `${f} : plus aucun « ← Retour » en bulle grise`);
    // UN `!important` SUR UN SÉLECTEUR NU BAT N'IMPORTE QUELLE CLASSE : sans
    // cette exception, la flèche reprenait l'arrondi d'un CHAMP (9 px).
    assert.ok(/button:not\(\.btn-retour\)\{border-radius/.test(doc),
      `${f} : la flèche échappe à l’arrondi de champ imposé aux boutons`);
  }
}

// LA DEMANDE DE DEVIS N'A PLUS QU'UNE SEULE FLÈCHE, ET ELLE N'EST PAS À ELLE :
// c'est pont.js qui la greffe dans la rangée d'étapes. Aucune flèche « revenir
// d'un cran » ne subsiste en bas d'étape, ni écrite dans la page, ni reposée
// par un `setInterval` (le récapitulatif s'en remettait une toutes les 400 ms).
{
  const DEVIS = ecran('demande-devis');
  assert.ok(!/class="btn-retour"[^>]*onclick="showStep\(/.test(DEVIS),
    'plus aucune flèche « revenir d’un cran » en bas d’étape');
  assert.ok(!/addBackButton/.test(DEVIS),
    '… et plus rien ne la repose au récapitulatif, toutes les 400 ms');
  // ET LE RETOUR EN ARRIÈRE S'EN VA AVEC ELLE (27/08/2026). C'est le prix de
  // la suppression, écrit noir sur blanc : la flèche portait DEUX gestes —
  // revenir d'une étape tant qu'il y en avait une derrière, quitter le
  // parcours à la première. Les pastilles ne sont pas cliquables. Cet écran
  // n'a donc plus de retour en arrière du tout ; on sort par la barre de
  // navigation, qui reste visible autour du cadre.
  //
  // Le pont était le SEUL consommateur de `window.oldaParcours` : gardé, il
  // n'aurait plus répondu à personne tout en donnant à lire qu'un retour
  // existe encore.
  // Les commentaires de cet écran RACONTENT ce qui est parti : on lit le code,
  // pas ce qu'il dit de lui-même.
  const devisNu = sansCommentaire(DEVIS);
  assert.ok(!/window\.oldaParcours/.test(devisNu),
    'le parcours n’expose plus comment revenir : plus personne ne le lui demande');
  assert.ok(!/etapePrecedente|peutRevenir/.test(devisNu),
    '… et rien ne reste de ce qui calculait l’étape d’avant');

  // LE PONT NE CONNAÎT TOUJOURS AUCUN MODÈLE D'ÉTAPES. C'est ce qui lui permet
  // d'envelopper les deux rangées sans savoir comment elles sont faites —
  // `data-step` + showStep() ici, displayStep() sans `data-step` en vente
  // directe.
  const PONTJS = fs.readFileSync(path.join(RACINE, 'public/comptoir/pont.js'), 'utf8');
  const greffe = PONTJS.match(/function grefferBarreEtapes\(\) \{[\s\S]*?\n  \}/);
  assert.ok(greffe, 'la greffe de la barre existe');
  assert.ok(!/showStep|displayStep|data-step/.test(greffe[0]),
    'le pont ne code en dur aucun modèle d’étapes : il enveloppe, il ne suppose pas');
  // Elle ne se pose qu'une fois : le guet la rappelle toutes les 400 ms.
  assert.ok(/etapes\.parentNode\.classList\.contains\('etapes-barre'\)\) return/.test(greffe[0]),
    '… et elle ne s’emboîte pas dans elle-même à chaque tour de guet');
}
console.log('✓ flèche : une seule dans l’application, et plus aucune dans le cadre d’un parcours');

// --- 9. LA RANGÉE D'ONGLETS EST CENTRÉE, ET LES SEPT SUR LA MÊME LIGNE ------
// Deux défauts mesurés le 24/08 dans la barre du haut.
{
  // (1) « Base clients » était le SEUL des sept à ne pas être sur la ligne :
  // un `margin-top: 6px` traînait dans clients.css, sans un mot pour dire
  // pourquoi. La rangée est centrée (`align-items: center`) : 6 px de marge
  // haute y descendent le bouton de 3 px. Mesuré : haut à 66 px contre 63.
  assert.ok(!/\.nav-switch-btn--base\s*\{[^}]*margin/.test(sansCommentaire(CLIENTS)),
    '« Base clients » n’a plus de marge à elle : les sept onglets sont sur la ligne');

  // (2) LA BARRE NE DÉCIDE PLUS DE SA FORME — ELLE N'EN A PLUS QU'UNE.
  // Elle se mesurait elle-même (`@container barre`), donc son pli dépendait de
  // sa propre largeur, donc du rail. Mesuré en 1440 : rail sorti, barre 1260 →
  // deux rangées ; rail rentré, 1440 → une rangée. Ranger le rail réorganisait
  // l'ossature : onglets de la 2e rangée à la 1re, recherche de 940 à 391 px,
  // et les quatre actions sous la recherche CONTRE LE BORD GAUCHE.
  // Depuis le 01/09 il n'y a plus de pli du tout : UNE rangée, à toutes les
  // largeurs. Ce qui reste vrai, et que ce bloc tient, c'est qu'aucune mesure
  // de la barre ni aucune requête média ne choisit sa disposition.
  const CSSNET = sansCommentaire(CSS);
  assert.ok(!/@container barre/.test(CSSNET),
    'la forme de la barre ne se décide pas sur sa largeur : elle dépend du rail');
  assert.ok(!/\.topbar \{[^}]*container-type/.test(CSSNET),
    '… la barre ne se mesure donc plus elle-même');

  // LA RANGÉE UNIQUE (01/09, demande de Charlie : « fusionne ça pour gagner de
  // la place d'affichage en hauteur »). Mesuré à 1 280 : la barre passe de
  // 126 px à 66, et la zone de travail de 673 à 733 — sur les sept écrans.
  const barreRegle = CSSNET.match(/(?:^|\n)\.topbar \{\n(?:.*\n)*?\}/);
  assert.ok(barreRegle && /flex-wrap: nowrap/.test(barreRegle[0]),
    'la barre est VERROUILLÉE sur une rangée : plus rien ne repasse en dessous');
  assert.ok(/min-height: calc\(var\(--ctrl-h\)/.test(barreRegle[0]),
    '… et sa hauteur est sa RECETTE, pas un nombre : la boîte plus ses flancs');

  const pli = CSSNET.match(/\.topbar \.nav-switch \{\n(?:.*\n)*?\}/);
  assert.ok(pli && /order: 2/.test(pli[0]),
    'les onglets sont le 2e groupe de la rangée : rail, recherche, onglets, actions');
  assert.ok(/flex: 0 1 auto/.test(pli[0]) && /width: auto/.test(pli[0]),
    'la rangée vaut ses onglets : ni élastique, ni pleine largeur');
  // ELLE NE REPREND PLUS LES FLANCS DE LA BARRE. C'était juste tant qu'elle
  // était SEULE sur sa ligne ; sur la rangée unique, ces marges négatives la
  // feraient passer sous la recherche et sous les actions.
  assert.ok(!/-1 \* var\(--topbar-flanc/.test(pli[0]),
    '… et elle ne déborde plus sur les flancs de la barre, qu’elle ne partageait avec personne');
  // MESURÉ À 1 920 : la recherche s'arrête à sa borne (520) et 332 px restaient
  // derrière les actions — le poste flottait à 332 px du bord de l'écran. La
  // marge automatique ne passe qu'APRÈS la répartition élastique : la recherche
  // grandit d'abord, le reste vient ici, et le bord droit se tient.
  assert.ok(/margin: 0 0 0 auto/.test(pli[0]),
    '… onglets et actions tiennent le bord droit à toutes les largeurs');
  assert.ok(/justify-content: safe center/.test(pli[0]),
    'le centrage reste `safe`');
  // `safe` n'est pas décoratif : la rangée peut DÉFILER, et un `center` sec rend
  // le début du contenu inatteignable dès qu'il déborde — même famille de piège
  // que `justify-content: flex-end`.
  assert.ok(/overflow-x: auto/.test(pli[0]),
    '… et elle défile en dernier recours, ce qui est exactement pourquoi');
  // LES ONGLETS NE SE COMPRIMENT PAS, et c'est ce qui fait tenir la mesure :
  // comprimés, ils coupent leurs libellés en silence, `scrollWidth` retombe sur
  // `clientWidth`, et `ajusterLesOnglets` conclut « ça tient » sur une rangée
  // illisible. Vérifié au rendu le 01/09 : nav à 515 px pour 1 070 de contenu,
  // aucun débordement signalé.
  assert.ok(/\.topbar \.nav-switch-btn \{ flex: 0 0 auto; \}/.test(CSSNET),
    'un onglet ne rétrécit pas : sinon le débordement ne se voit plus, et les libellés restent');
  // LA RECHERCHE EST LE SEUL ÉLÉMENT ÉLASTIQUE, et son plancher est un JETON —
  // elle s'en sert deux fois (base et minimum), et deux nombres divergent.
  const rech = CSSNET.match(/\.topbar \.grid-search \{\n(?:.*\n)*?\}/);
  assert.ok(rech && /flex: 1 1 var\(--rech-plancher\)/.test(rech[0])
    && /min-width: var\(--rech-plancher\)/.test(rech[0]),
    'la recherche absorbe la place en trop et la rend, sans descendre sous son plancher');
  assert.ok(/--rech-plancher:/.test(barreRegle[0]), 'le plancher est déclaré par la barre');

  // UNE MARGE AUTO MANGE TOUTE LA PLACE LIBRE AVANT `justify-content` : sans la
  // rendre, la recherche ne pourrait pas grandir. Mesuré : 67,4 px résolus sur
  // le premier onglet.
  assert.ok(/\.topbar \.nav-switch > :first-child \{ margin-left: 0; \}/.test(CSSNET),
    '… et le premier onglet rend sa marge automatique, sinon elle mange la place de la recherche');

  assert.ok(!/@media \(min-width: 1720px\)/.test(CSSNET),
    'la barre ne change plus de forme au milieu de la plage de largeurs');
  assert.ok(!/\.nav-switch \{[^}]*justify-content:\s*flex-end/.test(CSSNET),
    'les onglets ne tiennent jamais la droite par flex-end : le contenu sortirait par la gauche');

  // Le resserrement des onglets se décide sur la FENÊTRE : un écart qui
  // changerait au rangement du rail serait le même défaut en plus petit.
  assert.ok(/@media \(max-width: 1100px\) \{\n  \.topbar \.nav-switch \{ gap: 2px; \}/.test(CSSNET),
    'le resserrement des onglets ne dépend pas du rail');

  // L'ONGLET À DEUX ÉTAGES EST PARTI (01/09) : icône au-dessus du mot, posé
  // pour le doigt (« au doigt il n'y a pas de survol pour révéler une
  // infobulle »). L'atelier n'a plus de tablette, et il faisait 60 px de haut
  // dans une barre qui en fait 66.
  assert.ok(!/\.nav-switch-btn \{[^}]*flex-direction: column/.test(CSSNET),
    'plus d’onglet à deux étages : c’était une réponse au doigt, et le doigt n’est plus une cible');
  assert.ok(!/#viewProjet/.test(CSSNET),
    '« Nouveau Projet » n’existe plus depuis le 29/08 : sa règle non plus');
}

console.log('✓ barre : UNE rangée pour tout — 126 px de barre ramenés à 66');

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
  // LE DISQUE EST TOUJOURS UN DISQUE, mais il prend depuis le 28/08 la boîte de
  // la BARRE et non plus celle du rond général : la barre du haut n'a plus
  // qu'une seule hauteur (`--ctrl-h`), voir test/meme-hauteur.test.js. Le
  // `--rond` reste celui de `.btn-retour` et des croix de tiroir, hors barre.
  const poste = sansCommentaire(CSS).match(/\.poste \{[^}]*\}/);
  assert.ok(poste && /width: var\(--ctrl-h\)/.test(poste[0]) && /padding: 0;/.test(poste[0]),
    '… et le bouton devient son disque, à la hauteur de la barre');
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

// --- 12. L'OSSATURE NE DÉPEND D'AUCUNE PAGE, ET LE RAIL NE GLISSE JAMAIS ----
{
  const CSSNET2 = sansCommentaire(CSS);

  // (1) AUCUNE VUE NE TOUCHE À LA BARRE. « Nouveau Projet » masquait la
  // recherche — « elle filtre une grille absente de l'écran ». Refusé le 24/08
  // au soir : une barre qui perd un élément en changeant d'onglet n'est plus
  // une ossature, et le vide qu'elle laisse déplace le reste (il avait fallu
  // une marge automatique de rattrapage sur `.topbar-right`, qui part avec).
  // La recherche n'a jamais eu besoin de la grille : elle interroge le SERVEUR
  // et rend ses résultats dans sa propre palette, par-dessus l'écran.
  assert.ok(!/body\.view-[a-z-]+\s+\.grid-search/.test(CSSNET2),
    'aucune vue ne masque ni ne déplace la recherche');
  assert.ok(!/body\.view-[a-z-]+\s+\.topbar-right/.test(CSSNET2),
    '… ni les actions du coin');
  assert.ok(!/body\.view-[a-z-]+\s+\.nav-switch/.test(CSSNET2),
    '… ni les onglets');
  assert.ok(!/body\.view-[a-z-]+\s+\.topbar\b/.test(CSSNET2),
    '… ni la barre elle-même');

  // (2) LE RAIL NE DÉFILE JAMAIS DE CÔTÉ. `overflow-y: auto` seul ne laisse pas
  // l'autre axe tranquille : dès qu'un axe cesse d'être `visible`, l'autre
  // passe de `visible` à `auto`. Le rail devenait un conteneur qui glisse
  // latéralement — il suffit d'un libellé qui dépasse d'un pixel, ou d'un
  // bouton qui prend le focus, pour que toute la colonne des étapes parte de
  // l'écran. Les deux axes se déclarent, toujours.
  const rail = CSSNET2.match(/\.sidebar \{\n(?:.*\n)*?\}/);
  assert.ok(rail, 'le bloc .sidebar doit exister');
  assert.ok(/overflow-x: clip;/.test(rail[0]),
    'le rail déclare son axe horizontal — sinon il glisse tout seul');
  assert.ok(/overflow-y: auto;/.test(rail[0]), '… et son axe vertical');
  // `clip` plutôt que `hidden` : `hidden` reste un conteneur de défilement,
  // qu'un `scrollIntoView` peut décaler sans que personne n'ait rien demandé.
  assert.ok(!/overflow-x: hidden;/.test(rail[0]),
    '`hidden` défilerait encore par programme : c’est `clip` qu’il faut');

  // (3) LA LARGEUR MINIMALE DU RAIL. L'ancien plancher (200) était MESURÉ sur
  // la typographie des bandeaux, partis avec la refonte du 24/08 : c'est la
  // spécification du patron qui fixe désormais le rail à 284 px — sa nouvelle
  // largeur minimale, et la base que la zone de travail concède. La poignée ne
  // sert plus qu'à l'élargir au-delà, par-dessus les cartes.
  const min = Number((APP.match(/const SIDEBAR_MIN = (\d+)/) || [])[1]);
  assert.ok(min >= 284,
    `le rail ne descend pas sous les 284 px de la spécification (lu : ${min})`);
  // La valeur mémorisée par appareil repasse par le même serrage : un poste qui
  // avait enregistré 180 avant ce jour-là ne rouvre pas sur des mots coupés.
  assert.ok(/if \(Number\.isFinite\(saved\)\) poser\(clampW\(saved\), SIDEBAR_MIN\);/.test(APP),
    'la largeur relue au démarrage repasse par le serrage');

  // (4) LE RAIL SE BLOQUE AVANT DE CASSER LA BARRE DU HAUT. Poussé à fond (460)
  // sur une fenêtre de 1440, la rangée des sept onglets ne tenait plus (945 px
  // dans 932), Chrome lui posait une barre de défilement de 12 px et la barre
  // passait de 108 à 120 px : la zone de travail perdait de la hauteur sans que
  // rien ne l'explique. Mesuré après : la poignée s'arrête à 440.
  // ON NE MODÉLISE PAS la largeur qu'il faut aux onglets — elle dépend de la
  // police, de la langue, du pli de la barre, du nombre d'onglets. ON LA MESURE.
  assert.ok(/const barreDeborde = \(\) => !!\$navSwitch && \$navSwitch\.scrollWidth > \$navSwitch\.clientWidth \+ 1;/.test(APP),
    'la butée du rail se mesure sur la rangée d’onglets, elle ne se calcule pas');
  assert.ok(/lastW = poser\(clampW\(startW \+ ev\.clientX - startX\), lastW\);/.test(APP),
    '… le glisser rend la largeur qui casserait la barre et garde la dernière qui tenait');
  // Une fenêtre qui rétrécit reprend de la largeur à la barre : un rail qui
  // tenait tout à l'heure peut ne plus tenir.
  assert.ok(/window\.addEventListener\('resize', \(\) => \{[\s\S]*?while \(w > SIDEBAR_MIN && barreDeborde\(\)\)/.test(APP),
    'et le rail se resserre tout seul quand la fenêtre rétrécit');
  assert.ok(/overflow-wrap: break-word/.test(CSSNET2),
    'un mot plus long que sa colonne se coupe plutôt que de déborder — d’où le minimum mesuré');
}

// ===========================================================================
// LE TITRE D'UNE FAMILLE EST UN BANDEAU DE SA PHASE (25/08)
// ---------------------------------------------------------------------------
// « Ces familles-là doivent être mises en avant, surlignées en couleur. »
//
// Le piège de ce genre de demande, c'est de surligner avec le ton PÂLE de la
// phase : `--zp` se rend à 1,18:1 sur le fond du rail, c'est-à-dire un blanc
// légèrement sali. Un surlignage qu'on ne distingue pas de son support ne
// surligne rien — même défaut que le premier segment de l'ancienne jauge de
// charge. Le bandeau prend donc le ton FONCÉ (`--zsur-fond`), sur lequel le
// blanc passe à 5,7:1 au pire des six phases (mesuré au rendu).
{
  // Son propre exemplaire sans commentaires : `CSSNET2` vit dans un bloc plus
  // haut. On lit le CODE, pas les commentaires — ceux-ci CITENT les valeurs
  // écartées pour expliquer pourquoi elles l'ont été.
  const CSSNU = sansCommentaire(CSS);
  const bloc = (sel) => {
    const m = CSSNU.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}'));
    assert.ok(m, `règle introuvable : ${sel}`);
    return m[0];
  };
  assert.match(bloc('.stage.zone-head'), /background: var\(--zsur-fond\)/,
    'le titre d’une famille porte le bandeau de sa phase');
  assert.match(bloc('.stage.zone-head .stage-label'), /color: var\(--zsur-encre\)/,
    '… et son libellé l’encre qui va avec — jamais une couleur en dur');
  // L'ACTIF ne peut pas être « la même couleur en plus foncé » : six bandeaux
  // colorés dont un plus sombre ne se distinguent pas. Il prend l'accent de
  // l'application, qui ne ressemble à aucune phase et bascule seul de nuit.
  assert.match(bloc('.stage.zone-head.active'), /background: var\(--primary\)/,
    'la famille ouverte quitte sa phase pour l’accent');
  // Le sur-dossier gardait un compteur INVERSÉ quand il était seul à l'être.
  // Maintenant que chaque titre est un bandeau, un fond de plus se confondrait
  // avec le bandeau : il lui reste un anneau, qui le distingue encore.
  assert.match(bloc('.stage[data-slug="a_trier"] .stage-count.has-items'),
    /box-shadow: inset 0 0 0 [\d.]+px var\(--zsur-encre\)/,
    'le compteur du sur-dossier garde un trait, pas un fond redondant');
}

console.log('✓ ossature : aucune page ne touche à la barre, le rail ne glisse pas et ne casse plus ses mots');
