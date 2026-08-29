'use strict';

// ===========================================================================
// LE POINT DU JOUR SE LIT — les invariants de la refonte du 25/08
// ===========================================================================
// Le patron avait tranché « absolument illisible ». Ce qui se mesurait :
//
//   · NEUF tailles de texte (11, 12, 13, 14, 16, 17, 19, 26 px) et cinq
//     graisses, quand la charte en pose quatre et trois. Le corps de la file
//     était à 11 px, sous le plancher de la charte.
//   · SEPT textes sous le seuil de contraste, dont l'étoile pleine de la
//     priorité à 1,18:1 — invisible.
//   · La même information écrite deux ou trois fois par ligne.
//
// Les trois familles sont gardées ici. La troisième est la plus fragile :
// elle tient à un ACCORD entre deux fichiers (priority.js écrit les motifs,
// dashboard.js retire ceux que les colonnes portent déjà). Changer un libellé
// d'un côté sans l'autre, et la répétition revient sans que rien ne casse.

process.env.TZ = 'UTC';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const lire = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const DASH = lire('public/dashboard.js');
const PRIO = lire('public/priority.js');
const CSS = lire('public/styles.css');

// ===========================================================================
// 1. AUCUNE INFORMATION ÉCRITE DEUX FOIS SUR UNE LIGNE
// ===========================================================================
// `reasonsFor` produit cinq familles de motifs. Deux d'entre elles — l'échéance
// et la priorité haute — sont exactement les deux cellules voisines de la
// colonne « pourquoi ». En pratique, toute ligne en retard portait
// « En retard de 3 j · Priorité haute (3★) » à côté d'un badge « Retard 3 j »
// et d'une colonne de priorité.
const bacPrio = {};
vm.createContext(bacPrio);
vm.runInContext(`${PRIO.replace(/^export\s+/gm, '')}
  globalThis.reasonsFor = reasonsFor;
  globalThis.scoreRequest = scoreRequest;`, bacPrio);

// Le filtre du dashboard, extrait de sa source (pas une copie).
const MOTIF_LIGNE = DASH.match(/const MOTIF_DEJA_DIT = (\/.+\/);/);
assert.ok(MOTIF_LIGNE, 'MOTIF_DEJA_DIT introuvable — le dédoublonnage des motifs a disparu');
const MOTIF_DEJA_DIT = new RegExp(MOTIF_LIGNE[1].slice(1, -1));
const utiles = (r) => r.filter((t) => !MOTIF_DEJA_DIT.test(t));

const NOW = Date.parse('2026-08-25T12:00:00Z');
const mk = (o) => ({
  id: 'x', stage: 'production', sub_stage: null, priority: 1,
  deadline: null, updated_at: '2026-08-25T09:00:00Z', ...o,
});
const motifs = (o, machines) => bacPrio.reasonsFor(
  bacPrio.scoreRequest(mk(o), { now: NOW, machines: new Map(machines || []), weights: undefined }),
);

// a) Tout ce que l'ÉCHÉANCE peut produire doit être retiré : le badge le dit.
for (const [jours, attendu] of [[-3, 'En retard de 3 j'], [0, 'Échéance aujourd’hui'],
  [1, 'Échéance demain'], [3, 'Échéance dans 3 j']]) {
  const d = new Date(NOW + jours * 86400000).toISOString().slice(0, 10);
  const bruts = motifs({ deadline: d });
  assert.ok(bruts.includes(attendu),
    `le moteur doit toujours produire « ${attendu} » (sinon ce test ne garde plus rien)`);
  assert.ok(!utiles(bruts).includes(attendu),
    `« ${attendu} » double le badge d’échéance : il ne doit pas s’afficher dans la colonne`);
}

// b) La PRIORITÉ haute est retirée : la cellule « Prio » la dit.
const hautes = motifs({ priority: 3 });
assert.ok(hautes.some((t) => /^Priorité haute/.test(t)), 'le moteur produit toujours la priorité haute');
assert.ok(!utiles(hautes).some((t) => /^Priorité haute/.test(t)),
  '« Priorité haute » double la cellule Prio de la ligne');

// c) Ce qu'AUCUNE autre cellule ne porte doit SURVIVRE — sinon on aurait retiré
//    une colonne au lieu de la dédoublonner.
const goulot = motifs({ sub_stage: 'prod_trotec' }, [['trotec', { slug: 'trotec', name: 'Trotec', importance: 5 }]]);
assert.deepStrictEqual(utiles(goulot), goulot,
  'la machine goulot n’est écrite nulle part ailleurs : elle doit rester');
assert.ok(goulot.length, 'le cas machine goulot doit bien produire un motif');

const fige = motifs({ updated_at: '2026-08-05T09:00:00Z' });
assert.ok(fige.some((t) => /^Sans mouvement/.test(t)), 'le moteur signale la stagnation');
assert.ok(utiles(fige).some((t) => /^Sans mouvement/.test(t)),
  'la stagnation n’est écrite nulle part ailleurs : elle doit rester');

// d) Et le MOTEUR n'est pas amputé : le panneau détail et priority.test.js
//    s'appuient sur ses motifs complets.
assert.ok(/out\.push\(`En retard de \$\{-s\.d\} j`\)/.test(PRIO),
  'le moteur garde ses motifs complets — c’est l’AFFICHAGE qui ne répète pas');

// ===========================================================================
// 2. UNE COLONNE CONSTANTE N'EST PAS UNE COLONNE
// ===========================================================================
// Dans la file d'une personne, la colonne « Pilote » affichait son propre nom
// à chaque rang. Elle n'existe donc que dans une vue d'atelier.
assert.ok(/if \(!who\) b\.appendChild\(porteurEl\(r, null\)\);/.test(DASH),
  'la cellule « pilote » ne doit être posée que quand la vue n’est pas celle d’une personne');
assert.ok(/\.\.\.\(who \? \[\] : \[\{ k: 'pilot'/.test(DASH),
  'l’en-tête de colonnes doit suivre la ligne : pas de colonne « Pilote » dans une vue personne');
assert.ok(/'pj-todo-list' \+ \(who \? '' : ' is-atelier'\)/.test(DASH),
  'c’est la LISTE qui porte la variante de grille — l’entête et toutes ses lignes '
  + 'doivent partager exactement les mêmes pistes');
assert.ok(/\.pj-todo-list\.is-atelier \.pj-row \{/.test(CSS),
  'la variante « atelier » de la grille doit exister en CSS');

// ===========================================================================
// 3. L'ÉCRAN NE PORTE QUE DU TRAVAIL
// ===========================================================================
// Le 25/08, le patron a retiré d'un coup tout ce qui n'était pas le travail
// lui-même : les quatre compteurs d'alarme, la jauge « Charge par étape », le
// briefing « Ce matin », le champ de recherche, la pastille de filtre et
// l'onglet « Tout l'atelier ». Il reste les onglets, les files, les cartes.
//
// La garde tient le PRINCIPE, pas la nostalgie : rien qui compte, mesure,
// jauge ou filtre ne doit revenir s'intercaler entre l'ouverture de l'écran et
// la première ligne de travail. Une reprise se discute avec lui, elle ne se
// glisse pas dans un correctif.
const cssNu = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
for (const parti of ['pj-alarme', 'pj-al', 'pj-charge', 'pj-matin', 'pj-mot',
  'pj-search', 'pj-filterchip', 'pj-stat']) {
  const enSelecteur = new RegExp('\\.' + parti + '(?![\\w-])');
  assert.ok(!enSelecteur.test(cssNu), `${parti} : cet appareil de mesure a été retiré de l’écran`);
}
for (const mort of ['kpiFilter', 'KPI_PRED', 'KPI_LABEL', 'filtreMatin',
  'searchQuery', 'isDimmed', 'buildCharge', 'buildMatin', 'MATIN_MAX']) {
  assert.ok(!DASH.includes(mort), `${mort} : le code qui le servait part avec lui`);
}
assert.ok(!fs.existsSync(path.join(__dirname, '..', 'public/matin.js')),
  'le moteur du briefing est retiré, pas laissé en code mort — il reste dans '
  + 'l’historique si le patron le redemande');
assert.ok(!/'\/matin\.js'/.test(lire('public/sw.js')),
  '… et il quitte la coquille hors ligne en même temps');

// L'écran n'a plus que DEUX formes : l'équipe, ou la file d'une personne.
assert.ok(!/mkTab\('todo'/.test(DASH), 'l’onglet « Tout l’atelier » est retiré');
assert.ok(/buildTodoView\(activeTab\)/.test(DASH),
  'un onglet de prénom mène directement à la file de cette personne');

// ===========================================================================
// 4. L'ÉCHELLE EST CELLE DE LA CHARTE
// ===========================================================================
// Le bloc du Point du jour (écran + panneaux) ne pose plus AUCUNE taille de
// texte en dur : tout passe par --taille-*. Seules les fontes d'icônes et les
// glyphes cliquables (l'étoile du panneau détail) gardent une taille propre —
// ce ne sont pas des textes.
const DEBUT = CSS.indexOf('/* ------------------------------------------------ En-tête « Point du jour » */');
// LA BORNE DE FIN ÉTAIT LE TITRE DU TIROIR, parti le 29/08 avec lui. On prend
// la section suivante qui reste : le bloc contrôlé est donc au moins aussi
// large qu'avant, jamais moins.
const FIN = CSS.indexOf('/* ------------------------------------------------------- Finitions desktop');
assert.ok(DEBUT > 0 && FIN > DEBUT, 'bloc CSS du Point du jour introuvable');
const blocPJ = CSS.slice(DEBUT, FIN);

// On lit le CODE, pas les commentaires : ceux-ci CITENT les valeurs retirées
// pour expliquer pourquoi elles l'ont été.
const sansCommentaires = blocPJ.replace(/\/\*[\s\S]*?\*\//g, '');
// Ce qui reste en dur ne peut être QU'une taille d'ICÔNE — même règle que
// coquille-nav-et-rail.test.js pour le reste de l'outil : une icône est
// dimensionnée par sa boîte, pas par une ligne de texte.
const TAILLES_ICONE = [16, 20, 24, 40];
const enDur = [];
for (const r of sansCommentaires.split('}')) {
  const m = r.match(/font-size:\s*(\d+)px/g);
  if (!m) continue;
  for (const t of m) {
    if (TAILLES_ICONE.includes(Number(t.match(/\d+/)[0]))) continue;
    enDur.push(`${r.split('{')[0].trim().slice(0, 40)} → ${t}`);
  }
}
assert.deepStrictEqual(enDur, [],
  'toute taille de texte du Point du jour doit passer par la charte '
  + '(--taille-note / --taille-texte / --taille-grand) :\n  ' + enDur.join('\n  '));

// Et l'échelle du Point du jour est celle, FERMÉE, de tout l'outil : trois
// tailles. Une quatrième ferait tomber coquille-nav-et-rail.test.js — on le
// dit ici aussi, à l'endroit où la tentation se présente (un titre d'écran,
// un chiffre d'alarme). La hiérarchie se dit à la GRAISSE.
const jetonsTaille = new Set(
  [...sansCommentaires.matchAll(/font-size:\s*var\((--taille-[\w-]+)\)/g)].map((m) => m[1]),
);
assert.deepStrictEqual([...jetonsTaille].sort(), ['--taille-note', '--taille-texte'],
  'le Point du jour ne connaît que la taille de lecture et l’annotation — '
  + `trouvé : ${[...jetonsTaille].sort().join(', ')}`);

const graissesEnDur = [...sansCommentaires.matchAll(/font-weight:\s*(\d+)/g)].map((m) => m[1]);
assert.deepStrictEqual(graissesEnDur, [],
  `graisses en dur dans le Point du jour : ${graissesEnDur.join(', ')} — la charte en `
  + 'pose trois (--graisse-texte / --graisse-note / --graisse-forte)');

// ===========================================================================
// 5. LE GRIS ATTÉNUÉ NE PORTE PAS DE TEXTE
// ===========================================================================
// --pj-ink-4 était --text-3 (#9ca3af, 2,54:1 sur blanc) et portait la famille
// sous l'étape, les badges « Dans 3 j » et « Sans date », les en-têtes de
// colonnes, les messages vides. --text-3 reste un REPÈRE, jamais du texte.
assert.ok(/--pj-ink-4: var\(--text-2\);/.test(CSS),
  '--pj-ink-4 porte du texte qu’on lit : il ne peut pas être l’encre atténuée');
assert.ok(/--pj-star-off: var\(--text-2\);/.test(CSS),
  'l’étoile éteinte du panneau détail doit se voir — c’est la FORME du glyphe qui '
  + 'dit l’état, pas un gris à 1,52:1');
assert.ok(!/var\(--text-3\)/.test(sansCommentaires),
  'aucune règle du Point du jour ne doit tirer directement sur l’encre atténuée');

// Et l'étoile de la FILE a disparu : la priorité y est un mot, comme sur le
// planning. C'est elle qui se rendait à 1,18:1 — l'étoile PLEINE, celle qui
// était censée signaler une priorité haute.
//
// On regarde ce que le dashboard ÉMET, pas la position d'un sélecteur dans le
// CSS : `--pj-star-off` (le jeton du panneau détail) contient « pj-star » et
// ferait passer n'importe quelle recherche naïve pour un échec.
assert.ok(!/'pj-stars?\b/.test(DASH),
  'la file ne monte plus d’étoiles : la priorité y est un mot');
assert.ok(!/\.pj-stars?\b\s*[,{]/.test(CSS),
  'et leurs règles ne traînent pas derrière elles');
// Le panneau détail, lui, GARDE ses étoiles : c'est un champ de saisie, pas un
// affichage — on y clique pour régler la priorité.
assert.ok(/\.dd-star\b/.test(CSS), 'le réglage par étoiles du panneau détail reste');
assert.ok(/w\.textContent = 'Haute';/.test(DASH),
  'seule la priorité HAUTE porte une marque — basse et moyenne n’en méritent aucune');

// ===========================================================================
// 6. L'ÉCRAN S'OUVRE SUR L'ÉQUIPE, ET LES QUATRE PRÉNOMS NE BOUGENT PAS
// ===========================================================================
// Une version du 25/08 sortait la personne au poste de la liste pour la poser
// en tête (« À toi, Charlie ») : l'ordre des collègues devenait variable d'un
// poste à l'autre, et un prénom manquait là où l'œil allait le chercher. On ne
// réordonne pas une liste de quatre noms qu'on connaît par cœur.
assert.ok(/let activeTab = 'team';/.test(DASH),
  'l’écran s’ouvre sur l’équipe — c’est la lecture du matin');
const ordreOnglets = DASH.slice(DASH.indexOf("mkTab('team'"), DASH.indexOf("mkTab('todo'"));
assert.ok(/for \(const who of EMPLOYEES\)/.test(ordreOnglets),
  'l’Équipe vient d’abord, puis les employés DANS L’ORDRE de EMPLOYEES');
assert.ok(!/if \(who === qui\) continue/.test(DASH),
  'aucun prénom ne quitte la liste : la personne au poste est MARQUÉE, pas déplacée');
assert.ok(/who === qui \? 'pj-tab--moi' : null/.test(DASH),
  '… et c’est bien une marque sur son onglet');
assert.ok(/\.pj-tab--moi \.pj-tab-l/.test(CSS), 'la marque existe en CSS');

// Le poste reste ce qui personnalise l'écran — le briefing, et la marque.
assert.ok(/import \{ lirePoste \} from '\.\/poste\.js';/.test(DASH),
  'le Point du jour doit savoir qui est au poste');
assert.ok(/document\.addEventListener\('olda:poste'/.test(DASH),
  'un changement de personne en cours de journée doit déplacer la marque '
  + '— `storage` ne se déclenche pas dans l’onglet qui écrit');
assert.ok(lire('public/sw.js').includes("'/poste.js'"),
  'poste.js est importé par le dashboard : sans lui dans la coquille, l’écran '
  + 'ne s’ouvre plus hors ligne');

console.log('dashboard-lisibilite.test.js OK');
