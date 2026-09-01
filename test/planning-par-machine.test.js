'use strict';

// ===========================================================================
// CE QU'IL Y A À PRODUIRE, MACHINE PAR MACHINE (01/09/2026)
// ===========================================================================
// Charlie : « je veux voir en un clic ce que j'ai à produire sur chaque
// machine : DTF, Trotec, impression UV ». La donnée existait déjà en entier —
// le registre des machines (app_meta.machines), le rattachement d'une ligne à
// sa machine (machineOf) et l'ordre (rankRequests) : ce qui manquait était le
// POINT DE VUE, et un point de vue se pose sur l'écran où les lignes sont.
//
// CE FICHIER TIENT LES QUATRE PROMESSES DE LA DEMANDE, et rien d'autre :
//   1. un filtre en UN CLIC, sur le planning, sans écran neuf ;
//   2. la ligne dit ce qu'il y a à produire, avec sa QUANTITÉ, son échéance et
//      son urgence ;
//   3. l'ordre est celui du MOTEUR existant, pas un tri écrit sur place ;
//   4. un compteur par machine, lisible SANS ouvrir le filtre — donc un
//      compteur qui ne peut pas mentir sur ce que le clic va montrer.
//
// La quatrième est la plus fragile, et c'est elle qui a dicté la forme : un
// compteur qui porte sur la phase entière ne dit vrai que si le clic montre la
// phase entière. C'est pour ça que la machine REMPLACE la sous-étape au lieu
// de s'y ajouter, et c'est vérifié ici dans les deux sens.
//
// Fuseau figé AVANT tout usage de Date : le moteur lit les composantes locales
// de `now` pour compter les jours d'ici l'échéance.
process.env.TZ = 'UTC';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');

const APP = lire('public/app.js');
const CSS = lire('public/styles.css');
const HTML = lire('public/index.html');
const PRIORITE = lire('public/priority.js');
const db = require('../db');

// Les commentaires portent les anciennes valeurs et les phrases d'explication :
// les chercher ferait passer (ou échouer) le test pour de mauvaises raisons.
const sansCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// 1. LES SEPT SOUS-ÉTAPES DE PRODUCTION, ET CELLE QUI MANQUAIT
// ---------------------------------------------------------------------------
// Le moteur rattachait quatre sous-étapes sur sept à un poste. La cinquième,
// « Découpe & Contrôle DTF », NOMME sa machine dans son intitulé et n'y était
// pas : elle retombait sur la technique de la fiche, donc sur RIEN pour un
// dossier sans fiche. Elle ne comptait dans aucune file, et le filtre « DTF »
// l'aurait sautée alors que c'est du travail à faire au poste DTF.
// Les deux dernières — montage/finition, contrôle & emballage — ne nomment
// aucun poste : elles restent à la technique, et c'est voulu.
{
  const subs = db.SUB_STAGES.production.map((s) => s.slug);
  assert.deepStrictEqual(subs, [
    'prod_dtf', 'decoupe_dtf', 'prod_pressage', 'prod_trotec', 'prod_uv',
    'montage_finition', 'controle_emballage',
  ], 'la phase Production garde ses sept sous-étapes, dans cet ordre');

  const moteur = {};
  vm.createContext(moteur);
  vm.runInContext(`${PRIORITE.replace(/^export\s+/gm, '')}
    globalThis.machineOf = machineOf;
    globalThis.rankRequests = rankRequests;`, moteur);

  const par = (sub) => moteur.machineOf({ stage: 'production', sub_stage: sub });
  assert.strictEqual(par('prod_dtf'), 'dtf');
  assert.strictEqual(par('decoupe_dtf'), 'dtf',
    'découper le DTF se fait au poste DTF — sans ça, la file du poste est incomplète');
  assert.strictEqual(par('prod_pressage'), 'presse');
  assert.strictEqual(par('prod_trotec'), 'trotec');
  assert.strictEqual(par('prod_uv'), 'uv');
  // Une ligne sans poste identifiable n'entre dans aucune file : c'est EXACT,
  // et c'est pour ça que la somme des pilules peut être inférieure au compte
  // de l'étape. On ne lui invente pas de machine.
  assert.strictEqual(par('montage_finition'), null);
  assert.strictEqual(par('controle_emballage'), null);
  assert.strictEqual(
    moteur.machineOf({ stage: 'production', sub_stage: 'montage_finition', fiche: { techniques: ['laser'] } }),
    'trotec', '… sauf si sa fiche dit par quelle technique elle passe');
}

// ---------------------------------------------------------------------------
// 2. LA LOGIQUE DU PLANNING, EXÉCUTÉE — pas seulement relue
// ---------------------------------------------------------------------------
// On découpe le bloc « par machine » de `app.js` et on le rejoue dans un
// contexte nu, avec de vraies lignes. Le reste du fichier est un état partagé
// qu'on ne peut pas monter ici ; ce bloc-là, si — c'est justement pour ça
// qu'il ne touche au DOM qu'à partir de `$machines`.
{
  const debut = APP.indexOf("const MACHINE_STAGE = 'production';");
  const fin = APP.indexOf("const $machines = document.getElementById('machines');");
  assert.ok(debut > 0 && fin > debut, 'le bloc « par machine » se découpe toujours au même endroit');

  const moteur = {};
  vm.createContext(moteur);
  vm.runInContext(`${PRIORITE.replace(/^export\s+/gm, '')}
    globalThis.machineOf = machineOf;
    globalThis.rankRequests = rankRequests;`, moteur);

  const bac = {
    api: () => Promise.reject(new Error('pas de réseau dans ce test')),
    rows: [],
    currentStage: 'production',
  };
  vm.createContext(bac);
  vm.runInContext(`${APP.slice(debut, fin)}
    globalThis.poser = (r, s, m) => { rows = r; currentStage = s; currentMachine = m; };
    globalThis.reglerMachines = (l, of, rank) => { machines = l; machineOf = of; rankRequests = rank; };
    globalThis.comptesParMachine = comptesParMachine;
    globalThis.ordreMachine = ordreMachine;
    globalThis.machineActive = machineActive;`, bac);

  bac.reglerMachines(
    [{ slug: 'dtf', name: 'DTF', importance: 3 }, { slug: 'trotec', name: 'Trotec', importance: 3 },
      { slug: 'uv', name: 'UV', importance: 3 }],
    moteur.machineOf, moteur.rankRequests,
  );

  // LES ÉCHÉANCES SE COMPTENT DEPUIS AUJOURD'HUI, pas depuis une date écrite.
  // `ordreMachine` lit l'horloge du poste (`Date.now()`) — le moteur est pur,
  // c'est l'appelant qui la lui donne. Un jeu de dates figé aurait vieilli :
  // « dans 6 jours » serait devenu « en retard » un mardi de novembre, et le
  // test aurait échoué sur le calendrier, pas sur le code.
  const jour = (n) => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const ligne = (o) => ({
    id: o.id, stage: 'production', sub_stage: o.sub, flag: o.flag || null,
    priority: o.prio || 1, deadline: o.deadline || null,
    updated_at: '2026-09-01T09:00:00Z', created_at: '2026-08-01T09:00:00Z', fiche: o.fiche || null,
  });
  const phase = [
    ligne({ id: 'a', sub: 'prod_dtf', deadline: jour(6) }),
    ligne({ id: 'b', sub: 'decoupe_dtf', deadline: jour(-3) }),
    ligne({ id: 'c', sub: 'prod_dtf', deadline: jour(1) }),
    ligne({ id: 'd', sub: 'prod_trotec', deadline: jour(0) }),
    ligne({ id: 'e', sub: 'montage_finition', deadline: jour(0) }),          // aucun poste
    ligne({ id: 'f', sub: 'controle_emballage', fiche: { techniques: ['uv'] }, deadline: jour(2) }),
    ligne({ id: 'g', sub: 'prod_dtf', deadline: jour(-9), flag: 'bloque' }), // à débloquer
  ];

  // LE COMPTEUR PORTE SUR LA PHASE ENTIÈRE. `rows` contient toujours la
  // famille entière (la sous-étape n'en filtre que l'affichage) : le chiffre
  // se lit donc sans ouvrir quoi que ce soit, et il ne change pas quand on
  // change de sous-étape sous lui.
  bac.poser(phase, 'production', null);
  const comptes = bac.comptesParMachine();
  assert.strictEqual(comptes.get('dtf'), 4, 'DTF compte ses 3 lignes de production ET sa découpe');
  assert.strictEqual(comptes.get('trotec'), 1);
  assert.strictEqual(comptes.get('uv'), 1, 'la technique de la fiche rattache aussi, faute de sous-étape');
  assert.ok(!comptes.has(undefined) && !comptes.has(null),
    'une ligne sans poste n’entre dans aucune file — elle n’en invente pas une');
  const somme = [...comptes.values()].reduce((t, n) => t + n, 0);
  assert.strictEqual(somme, phase.length - 1,
    'la somme des pilules peut être inférieure au compte de l’étape, et c’est exact');

  // L'ORDRE EST CELUI DU MOTEUR. On le recalcule ici SANS passer par `app.js`,
  // à partir du seul `rankRequests` : si le planning s'était écrit un tri à
  // lui, les deux listes divergeraient.
  bac.poser(phase, 'production', 'dtf');
  // `Array.from` : le tableau naît DANS le contexte vm, donc avec l'`Array` de
  // ce contexte-là. `deepStrictEqual` compare aussi les prototypes et refusait
  // deux listes pourtant identiques, sans rien montrer de l'écart.
  const vue = Array.from(bac.ordreMachine('dtf'), (r) => r.id);
  const dtf = phase.filter((r) => moteur.machineOf(r) === 'dtf');
  const attendu = moteur.rankRequests(dtf, [], { now: Date.now() });
  assert.deepStrictEqual(vue, [
    ...attendu.queue.map((q) => q.r.id), ...attendu.blocked.map((r) => r.id),
    ...attendu.waiting.map((r) => r.id),
  ], 'la vue machine EST la sortie du moteur, bac après bac');
  assert.deepStrictEqual([...vue].sort(), ['a', 'b', 'c', 'g'],
    '… et elle ne montre que les lignes du poste');
  assert.strictEqual(vue[0], 'b', 'l’échéance dépassée passe en tête (poids dominant du moteur)');
  assert.strictEqual(vue[vue.length - 1], 'g',
    'ce qui est BLOQUÉ ne s’intercale pas dans une file de production : le moteur le met à part');

  // LE FILTRE NE VAUT QUE SUR SA PHASE. Sorti de la production, il se tait de
  // lui-même — une machine se lit sur un dossier en chiffrage, mais personne
  // ne va au poste DTF chercher un devis à envoyer.
  assert.strictEqual(bac.machineActive(), 'dtf');
  bac.poser(phase, 'preparation', 'dtf');
  assert.strictEqual(bac.machineActive(), null, 'hors de la Production, aucun poste n’est « actif »');
}

// ---------------------------------------------------------------------------
// 3. LES DEUX FILTRES NE S'EMPILENT PAS — dans les DEUX sens
// ---------------------------------------------------------------------------
// C'est ce qui empêche le compteur de mentir. Le rail coupe la phase par étape
// du parcours, la rangée la coupe par poste : deux façons de regarder la MÊME
// phase. Empilées, la pilule annoncerait 12 et n'en montrerait que 3 ; et
// cliquer « Pressage » dans le rail en gardant le filtre DTF donnait une liste
// vide sous un compteur qui disait douze.
{
  const nu = sansCom(APP);
  const choisir = nu.match(/function choisirMachine\(slug\) \{[\s\S]*?\n\}/);
  assert.ok(choisir, 'choisir une machine est une fonction, pas un écouteur en ligne');
  assert.match(choisir[0], /if \(veut && currentSub !== null\) \{[\s\S]*currentSub = null;/,
    'choisir un poste relâche la sous-étape');
  assert.match(choisir[0], /paintSidebarActive\(\)/,
    '… et le rail cesse d’en désigner une : l’écran ne se contredit pas');
  assert.match(choisir[0], /const veut = currentMachine === slug \? null : slug;/,
    'le même clic enlève le filtre : un clic pour entrer, un clic pour sortir');

  const select = nu.match(/async function selectStage\(slug, sub = null, forcerRelecture = false\) \{[\s\S]*?\n  sort = \{ key: null, dir: 1 \};/);
  assert.ok(select, 'selectStage garde sa tête');
  assert.match(select[0], /currentMachine = null;/,
    'cliquer une étape du rail relâche le poste — sans ça, la liste est vide sous un compteur plein');
}

// ---------------------------------------------------------------------------
// 4. ON NE RANGE PAS À LA MAIN CE QU'ON N'A PAS TRIÉ
// ---------------------------------------------------------------------------
// `commitReorder` numérote en REJOUANT l'ordre de la famille et en y replaçant
// les lignes visibles : il suppose que la tranche affichée est une
// sous-séquence de cet ordre. La vue machine ne l'est plus — elle vient du
// moteur. Un glisser y écrirait des positions qui ne veulent rien dire pour
// les autres postes, et le geste paraîtrait avoir marché.
{
  const nu = sansCom(APP);
  assert.match(nu, /\} else if \(machineActive\(\)\) \{[\s\S]*?showToast\([\s\S]*?\);\s*applySortAndRender\(\);/,
    'déposer une ligne dans une vue machine ne réordonne rien, et le dit');
  const fin = nu.match(/\} else if \(machineActive\(\)\) \{[\s\S]*?\n  \} else \{/);
  assert.ok(fin && !/commitReorder/.test(fin[0]),
    '… et surtout n’écrit aucune position');
  const reset = nu.match(/function renderOrdreReset\(\) \{[\s\S]*?\n\}/);
  assert.match(reset[0], /!!machineActive\(\)/,
    'le bouton « revenir au tri par urgence » se tait aussi : il n’aurait rien à annuler');
}

// ---------------------------------------------------------------------------
// 5. LE TRI NE SE RÉÉCRIT PAS SUR PLACE
// ---------------------------------------------------------------------------
{
  const nu = sansCom(APP);
  const ordre = nu.match(/function ordreMachine\(slug\) \{[\s\S]*?\n\}/);
  assert.ok(ordre, 'l’ordre d’une vue machine a sa fonction');
  assert.match(ordre[0], /rankRequests\(lignes, machines, \{ now: Date\.now\(\) \}\)/,
    'il APPELLE le moteur — le registre lui sert de table d’importance, comme au Point du jour');
  assert.ok(!/\.sort\(/.test(ordre[0]),
    'et il ne trie rien lui-même : concaténer les trois bacs du moteur n’est pas trier');

  const rendu = nu.match(/function applySortAndRender\(\) \{[\s\S]*?\n\}/);
  assert.match(rendu[0], /const poste = machineActive\(\);\s*const sorted = poste\s*\? ordreMachine\(poste\)/,
    'la grille prend cette branche-là quand un poste est regardé');
  assert.match(rendu[0], /renderMachines\(\);/,
    'et les compteurs se refont ICI : c’est le seul point par lequel passent TOUS '
    + 'les changements de la liste (flux temps réel compris)');
}

// ---------------------------------------------------------------------------
// 6. LE MOTEUR RESTE HORS DU CHEMIN D'OUVERTURE
// ---------------------------------------------------------------------------
// `priority.js` avait été SORTI du préchargement de la coquille le 29/08,
// précisément parce que seul le Point du jour le tirait — 10 Ko payés à chaque
// ouverture pour un écran que bien des postes n'ouvrent jamais. Le filtre
// machine ne le remet pas sur ce chemin : il le charge au premier passage en
// Production, et le service worker l'a déjà de côté.
{
  assert.match(APP, /import\('\.\/priority\.js'\)/,
    'le moteur arrive par un import DYNAMIQUE');
  assert.ok(!/^import[\s\S]*?from '\.\/priority\.js'/m.test(APP),
    '… jamais par un import statique, qui le remettrait dans la coquille');
  assert.ok(!/<link rel="modulepreload" href="\.?\/?priority\.js"/.test(HTML),
    '… et il n’est pas annoncé en préchargement');
  assert.ok(lire('public/sw.js').includes("'/priority.js'"),
    '… mais il est dans la coquille du service worker : hors ligne, le filtre marche encore');
  // Le registre et le moteur voyagent ENSEMBLE : des noms de machines sans
  // rattachement ne compteraient rien, et une rangée de zéros ne se distingue
  // pas d'une rangée qui n'a pas fini de charger.
  assert.match(sansCom(APP), /Promise\.all\(\[api\('GET', '\/api\/machines'\), import\('\.\/priority\.js'\)\]\)/,
    'le registre et le moteur se chargent d’un seul tenant');
  assert.match(sansCom(APP), /\.catch\(\(err\) => \{ machinesEnVol = null; throw err; \}\)/,
    'un échec réseau ne fige pas la rangée pour la journée : le passage suivant réessaie');
}

// ---------------------------------------------------------------------------
// 7. AUCUN COMPOSANT NEUF — la pilule EST celle de la charte
// ---------------------------------------------------------------------------
// « Tout ce qui peut être à la même hauteur l'est » : la pilule se pose dans
// le même en-tête que « revenir au tri par urgence », donc c'est le MÊME
// objet — `.action-ligne`, la commande posée dans une rangée. Mesuré au rendu
// à 1280 px : 39,38 px, exactement `--ctrl-h-serre`, comme ses voisines.
{
  const nu = sansCom(CSS);
  assert.match(sansCom(APP), /btn\.className = 'action-ligne machine';/,
    'la pilule prend la commande de ligne de la charte, elle ne s’en réécrit pas une');

  // Rien de ce qui fait une BOÎTE ne se redéclare ici : ni hauteur, ni
  // rembourrage, ni arrondi, ni cran de texte. C'est par là que la deuxième
  // hauteur revient.
  const regles = [...nu.matchAll(/\n\.machine[\w.\-_]*[^{]*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(regles.length >= 4, 'la rangée des machines a bien ses règles');
  for (const r of regles) {
    for (const interdit of ['min-height', 'height', 'padding', 'border-radius', 'font-size']) {
      assert.ok(!new RegExp(`(^|;|\\s)${interdit}\\s*:`).test(r),
        `la pilule machine redéclare « ${interdit} » : sa boîte vient de .action-ligne, pas d’ici`);
    }
  }
  // LE COMPTEUR SE COMPARE D'UN COUP D'ŒIL : quatre nombres empilés côte à
  // côte ne se lisent que si le « 1 » prend la même place que le « 8 ».
  const compteur = nu.match(/\n\.machine__n \{([^}]*)\}/);
  assert.ok(compteur, 'le compteur a sa règle');
  assert.match(compteur[1], /font-variant-numeric: tabular-nums/);
  assert.match(compteur[1], /font-weight: var\(--graisse-forte\)/,
    'c’est le chiffre qu’on cherche du regard : il porte la graisse');
  // Un poste sans rien à produire s'ÉTEINT, il ne disparaît pas : il
  // reviendrait sous les doigts au fil de la journée, et la rangée se
  // redessinerait à chaque ligne rangée. On l'éteint comme toute commande
  // éteinte de l'application — jamais à l'`opacity`, qui est une impasse.
  const vide = nu.match(/\n\.machine\.is-vide \{([^}]*)\}/);
  assert.ok(vide && /var\(--inactif\)/.test(vide[1]) && /var\(--inactif-encre\)/.test(vide[1]),
    'le poste vide prend les deux jetons « éteint » de la charte');
  assert.ok(!/opacity/.test(regles.join(';')),
    '… et aucune règle de la rangée ne passe par l’opacité');
}

// ---------------------------------------------------------------------------
// 8. LA RANGÉE NE PARAÎT QUE LÀ OÙ « À PRODUIRE » VEUT DIRE QUELQUE CHOSE
// ---------------------------------------------------------------------------
{
  const nu = sansCom(APP);
  assert.match(HTML, /<div class="machines" id="machines" role="group" aria-label="Filtrer par machine" hidden><\/div>/,
    'la rangée est un groupe nommé, vide et masqué dans la page : c’est le JS qui la remplit');
  assert.ok(HTML.indexOf('id="machines"') > HTML.indexOf('id="stageCount"')
    && HTML.indexOf('id="machines"') < HTML.indexOf('id="ordreReset"'),
    'elle se pose entre le compteur d’étape et l’action de la rangée — la ligne du titre');

  const render = nu.match(/function renderMachines\(\) \{[\s\S]*?\n\}/);
  assert.match(render[0], /if \(currentStage !== MACHINE_STAGE\) \{\s*\$machines\.hidden = true;/,
    'ailleurs qu’en Production, la rangée n’est pas là');
  // ON NE COMPTE PAS SUR LES LIGNES DE L'ÉTAPE PRÉCÉDENTE. `selectStage` pose
  // l'en-tête tout de suite (c'est ce qu'on vient de cliquer) mais `rows`
  // porte encore la famille qu'on quitte tant que la réponse n'est pas là.
  assert.match(render[0], /if \(!lastRowsSig\) \{ \$machines\.hidden = true; return; \}/,
    'et elle ne compte jamais les lignes de la famille qu’on vient de quitter');
}

// ---------------------------------------------------------------------------
// 9. LA LIGNE DIT COMBIEN, QUAND, ET SI C'EST URGENT
// ---------------------------------------------------------------------------
// Ce qu'il y a à produire était déjà sur la ligne depuis le 27/08 (`product`,
// la donnée la mieux remplie de la base). Ce qui manquait, c'est le NOMBRE —
// il n'avait de colonne nulle part. L'échéance et l'urgence, elles, sont le
// même badge depuis toujours : « En retard 3 j » en rouge, « Aujourd'hui » en
// ambre, « 6 j » au calme. Les trois se lisent donc sans rien ouvrir.
{
  const nu = sansCom(APP);
  assert.match(lire('public/ligne-faits.js'), /export function nomArticle\(r, hote\)/,
    'la quantité entre dans le titre de la ligne, par un composant unique');
  const cellule = nu.match(/function cellDescription\(r\) \{[\s\S]*?\n\}/);
  assert.match(cellule[0], /nomArticle\(r, name\)/, 'la cellule « Article » le prend');
  assert.ok(!/r\.product \?\? ''/.test(cellule[0]),
    '… et n’écrit plus la désignation toute seule à côté');
  assert.ok(new Set(['product', 'deadline']).size === 2
    && /const COLS_DEFAUT = new Set\(\[[^\]]*'product'[^\]]*'deadline'[^\]]*\]\)/.test(nu),
    'l’article et l’échéance sont sur la ligne PAR DÉFAUT — personne n’a de case à cocher');
  const badge = nu.match(/function cellDeadline\(r\) \{[\s\S]*?\n\}/);
  assert.match(badge[0], /cls = 'red'; label = `En retard \$\{-d\} j`/,
    'et l’urgence se lit sur ce même badge, sans ouvrir la ligne');
}

console.log('✓ par machine : un clic sur le planning, un compteur qui ne ment pas, '
  + 'et l’ordre du moteur — pas un tri de plus');
