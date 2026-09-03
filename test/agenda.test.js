'use strict';

// ===========================================================================
// L'AGENDA DES RETRAITS — qui vient chercher quoi, et quel jour (03/09/2026)
// ===========================================================================
// Demande de Charlie : « un agenda par jours, avec juste les noms des clients
// et les jours de retrait, pour que ma vendeuse en 1 regard puisse voir qui
// vient chercher quoi pour aujourd'hui, demain… ».
//
// CE QUE CE FICHIER TIENT, et pourquoi chacun se paierait cher :
//
//   1. LA ROUTE NE MONTRE QUE CE QUI EST ENCORE À REMETTRE. Un dossier déjà
//      parti chez le client, déjà récupéré au comptoir, ou archivé, n'a rien
//      à faire dans une liste de gens qui vont passer : la vendeuse
//      rappellerait quelqu'un qui a déjà son carton.
//   2. ELLE MONTRE CE QUI N'EST PAS ENCORE PRÊT. Une commande promise pour
//      aujourd'hui et encore « à chiffrer » est exactement ce qu'il faut voir
//      AVANT que le client ne pousse la porte. La taire, c'est promettre un
//      retrait qui n'aura pas lieu.
//   3. ELLE NE PORTE AUCUN PRIX. L'écran n'en affiche pas ; l'argent est
//      réservé côté serveur, et cette liste repart à chaque évènement temps
//      réel, vers chaque poste.
//   4. LES DOSSIERS SANS DATE SONT COMPTÉS, PAS CACHÉS. Ils ne peuvent se
//      ranger sous aucun jour — mais les taire ferait lire l'agenda comme
//      complet, et c'est le genre de silence qui fait rater un client.
//   5. L'HEURE EST CELLE DE LA FICHE (`heureSouhaitee`), pas une colonne
//      fantôme : `retrait_creneau` et `date_prevue` sont mesurées VIDES sur
//      les 205 dossiers de production (voir schema.sql). Bâtir l'agenda
//      dessus, c'est bâtir un écran vide.
//   6. LE JOUR CIVIL EST CELUI DE L'ATELIER. Saint-Martin est à UTC−4 et le
//      conteneur tourne en UTC : dès 20 h locales, un `new Date()` naïf date
//      du lendemain — « Aujourd'hui » se viderait tout seul à l'heure des
//      derniers retraits.
//   7. L'ENTRÉE DU RAIL N'EST PAS UNE ÉTAPE. Elle emprunte le gabarit de
//      `.stage` pour garder le rythme de la colonne, sans `data-slug` : une
//      commande lâchée dessus partirait sinon en PATCH `stage: undefined`.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const APP = lire('public/app.js');
const AGENDA = lire('public/agenda.js');
const AGENDA_CSS = lire('public/agenda.css');
const SERVEUR = lire('server.js');
const HTML = lire('public/index.html');
const SW = lire('public/sw.js');

// ===========================================================================
// PARTIE A — CE QUE L'ÉCRAN EST, SANS RÉSEAU
// ===========================================================================

// --- L'entrée du rail -------------------------------------------------------
assert.match(APP, /const HASH_AGENDA = '#agenda';/,
  'l’agenda a une ADRESSE : sans elle, il ne s’ouvre pas dans un second onglet et un rechargement le perd');
assert.match(APP, /\[HASH_AGENDA\]: 'agenda',/,
  '… et le hash est le seul pilote de la vue, comme pour les huit autres écrans');
assert.match(APP, /function entreeAgenda\(\)/, 'son entrée est construite par le rail');
assert.match(APP, /\$stages\.appendChild\(entreeAgenda\(\)\);/,
  '… et posée EN TÊTE du rail, avant les phases');
assert.match(APP, /a\.className = 'stage stage--agenda';/,
  'elle emprunte le gabarit d’une étape : le rail n’a qu’UN rythme');
assert.ok(!/stage--agenda[\s\S]{0,400}?dataset\.slug/.test(APP),
  '… mais jamais de data-slug — ce n’est pas une étape, et une dépose partirait en PATCH `stage: undefined`');
assert.ok(!/entreeAgenda[\s\S]{0,600}?stage-count/.test(APP),
  '… ni de compteur : elle ne contient aucun dossier, un « 0 » l’éteindrait comme une étape vide');

// LA BARRE DU HAUT NE GAGNE PAS UN NEUVIÈME ONGLET. Mesuré le 03/09 à 1 280 px :
// 868 px de rangée pour 868 disponibles, DÉJÀ resserrée (`est-serree`). Le mot
// de plus ne tiendrait qu'en poussant le dernier hors de l'écran — et un onglet
// qu'on ne voit pas est un écran qui n'existe pas.
const nav = HTML.match(/<nav class="nav-switch"[\s\S]*?<\/nav>/)[0];
assert.ok(!/#agenda/.test(nav),
  'l’agenda n’a pas d’onglet dans la barre du haut : elle est pleine, sa porte est le rail');

// --- Le gabarit du rail, au pixel -------------------------------------------
// `.stage` porte la boîte, le rembourrage et l'arrondi ; l'agenda n'en réécrit
// AUCUN. Deux hauteurs dans la même colonne se voient tout de suite.
const CSS = lire('public/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
const regleAgenda = CSS.match(/\.stage--agenda \{([^}]*)\}/);
assert.ok(regleAgenda, 'l’entrée du rail a sa règle');
assert.ok(!/min-height|padding:/.test(regleAgenda[1]),
  'elle ne réécrit NI la hauteur NI le rembourrage de `.stage` : ils viennent du gabarit');
assert.match(regleAgenda[1], /padding-left: 25px/,
  '… seul le retrait de gauche est repris, comme la ligne de repli : sans puce, le texte reculait de 16 px');
assert.match(CSS, /\.stage--agenda::before \{ content: none; \}/,
  'pas de puce : elle dirait une phase, et l’agenda n’en est pas une');

// --- La vue, dans la coquille de la page ------------------------------------
assert.match(HTML, /<section class="agenda" id="agenda" hidden/,
  'la vue existe dans la page, et elle naît masquée');
assert.match(APP, /if \(\$agenda\) \$agenda\.hidden = !agenda;/,
  'la bascule de vue la montre et la cache');
assert.match(APP, /if \(agenda\) mountAgenda\(\); else if \(agModule\) agModule\.hide\(\);/,
  '… et l’écran quitté se sait quitté : sinon il continuerait de se relire à chaque évènement');

// --- Le chargement à la demande ---------------------------------------------
assert.match(APP, /poserFeuille\('agenda\.css'\), import\('\.\/agenda\.js'\)/,
  'la feuille ET le module arrivent AVEC l’écran, jamais à l’ouverture d’un poste');
for (const fichier of ['/agenda.js', '/agenda.css']) {
  assert.ok(SW.includes(`'${fichier}'`),
    `${fichier} doit être dans la coquille hors ligne : absent, l’écran ne s’ouvre pas du tout`);
}

// --- Le temps réel et l'horloge ---------------------------------------------
assert.match(APP, /if \(agModule\) agModule\.notifyChange\(\);/,
  'l’agenda suit le temps réel comme le reste de l’application');
assert.match(APP, /if \(agModule\) agModule\.tick\(\);/,
  '… et l’HORLOGE : « Aujourd’hui » est une étiquette relative, un poste ne se recharge jamais');
{
  const corps = APP.match(/function rafraichirTemps\(\) \{([\s\S]*?)\n\}/)[1];
  assert.ok(corps.indexOf('agModule.tick()') < corps.indexOf('if (!booted) return;'),
    'le tic de l’horloge passe AVANT la garde `booted` : le planning peut charger, l’heure avance quand même');
}
{
  const notify = AGENDA.match(/function notifyChange\(\) \{([^}]*)\}/);
  assert.ok(notify && /if \(visible\)/.test(notify[1]),
    'MASQUÉ, l’agenda ne redemande rien : une commande déplacée à l’atelier ne coûte pas une requête à chaque poste');
}

// --- Le jour civil de l'atelier ---------------------------------------------
assert.match(AGENDA, /timeZone: 'America\/Marigot'/,
  'le jour civil est celui de SAINT-MARTIN : en UTC, « aujourd’hui » bascule à 20 h locales');
assert.match(AGENDA, /T12:00:00Z/,
  '… et les jours se comparent à MIDI : une heure de décalage ne peut plus faire basculer un jour entier');

// --- L'en-tête d'écran est celui de la charte -------------------------------
assert.match(AGENDA, /import \{ ecranTete \} from '\.\/ecran-tete\.js'/,
  'l’agenda bâtit son en-tête avec celui de la charte — il n’y en a qu’un pour les neuf écrans');
// Sur le CODE, pas sur les commentaires : ceux-ci disent justement où l'en-tête
// vit, et la garde se déclencherait sur son propre récit.
const CSS_NU = AGENDA_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
assert.ok(!/ecran-tete/.test(CSS_NU),
  '… et sa feuille ne le réécrit pas');
assert.match(AGENDA, /import \{ nomClientAffiche \}/,
  'un nom de client se lit en CAPITALES : règle unique, elle ne se recopie pas');

// --- Deux crans de texte par rangée, trois sur l'écran ----------------------
// Le cran de 21 px appartient au NOM DE L'ÉCRAN, et à lui seul : un titre de
// journée est du texte de 17 en 800, comme les titres de bloc de « Mon
// travail » — c'est le même objet à un écran près.
const crans = new Set([...CSS_NU.matchAll(/font-size: var\((--taille-[\w-]+)\)/g)].map((m) => m[1]));
assert.deepStrictEqual([...crans].sort(), ['--taille-note', '--taille-texte'],
  'deux crans de texte sur l’agenda : la hiérarchie se fait à la GRAISSE, pas à une taille de plus');

// --- Une rangée prend la boîte de l'application -----------------------------
const ligne = CSS_NU.match(/\.ag-ligne \{([^}]*)\}/);
assert.ok(ligne, 'la rangée de l’agenda a sa règle');
assert.match(ligne[1], /min-height: var\(--ctrl-h\)/,
  'sa hauteur est un JETON, jamais un nombre : tout ce qui se clique fait la même hauteur dans le CRM');
assert.ok(ligne[1].indexOf('font: inherit') < ligne[1].indexOf('line-height:'),
  '`font: inherit` AVANT l’interligne : la forme courte le remet à `normal` et emporte ce qui précède');

// LE GABARIT DE COLONNES S'ÉCRIT LÀ OÙ IL SERT. Rangé dans une variable posée
// sur `.agenda`, il aurait figé ses deux largeurs à la valeur qu'elles avaient
// SUR CET ÉLÉMENT-LÀ — une substitution se fait chez qui déclare, pas chez qui
// hérite — et la requête de conteneur n'aurait plus rien changé.
assert.match(ligne[1], /grid-template-columns:\s*\n?\s*var\(--ag-quand\)[^;]*var\(--ag-etat\)/,
  'les quatre colonnes se déclarent sur la rangée, avec les deux jetons de largeur');
assert.match(CSS_NU, /@container \(max-width: 780px\) \{\s*\.ag-page \{ --ag-quand[^}]*\}/,
  '… et c’est un DESCENDANT du conteneur qui les réduit, sinon la requête ne s’applique à rien');

// UN SEUL GABARIT POUR TOUTES LES JOURNÉES : écrit bloc par bloc, chaque `fr`
// se résoudrait sur le contenu de SA grille et les noms de clients ne
// tomberaient plus sur le même axe d'un jour à l'autre. La vue au jour n'en
// déclare donc qu'un, sur la rangée.
assert.strictEqual((CSS_NU.match(/\.ag-ligne \{[^}]*grid-template-columns/g) || []).length, 1,
  'les colonnes de la vue au jour sont déclarées UNE fois : deux écritures redeviennent deux axes');

// --- Aucun prix sur cet écran -----------------------------------------------
assert.ok(!/project_value|acompte|paye\b|eur\(/.test(AGENDA),
  'l’agenda ne parle pas d’argent : il sert à préparer une remise, pas à encaisser');

// ===========================================================================
// PARTIE B — LE REGROUPEMENT PAR JOUR, SUR LE VRAI CODE
// ===========================================================================
// On n'exécute pas une copie de la logique : on extrait les blocs source de
// `public/agenda.js` et on les évalue. Une copie diverge le jour où l'écran
// change, et le test continue de passer sur du code que personne n'exécute.
{
  const bac = { Intl, Date };
  vm.createContext(bac);
  const morceaux = [
    AGENDA.match(/const JOUR_ATELIER = [\s\S]*?\n\}\);/)[0],
    AGENDA.match(/const enJour = [\s\S]*?\n\};/)[0],
    AGENDA.match(/const enTemps = [^\n]*\n/)[0],
    AGENDA.match(/const ecartJours = [^\n]*\n/)[0],
    AGENDA.match(/const majuscule = [^\n]*\n/)[0],
    AGENDA.match(/const NOM_DU_JOUR = [\s\S]*?\n\}\);/)[0],
    AGENDA.match(/const enHeure = [\s\S]*?\n\};/)[0],
    AGENDA.match(/function libelleArticle\(l\) \{[\s\S]*?\n\}/)[0],
    AGENDA.match(/ {2}function grouper\(lignes, jour\) \{[\s\S]*?\n {2}\}/)[0],
  ];
  vm.runInContext(`${morceaux.join('\n')}
    globalThis.grouper = grouper;
    globalThis.enHeure = enHeure;
    globalThis.libelleArticle = libelleArticle;
    globalThis.ecartJours = ecartJours;`, bac);

  const jour = '2026-09-03';
  const ligneDe = (id, date) => ({ id, deadline: date, billing_company: id, stage: 'production' });
  const blocs = bac.grouper([
    ligneDe('vieille', '2026-08-20'),
    ligneDe('hier', '2026-09-02'),
    ligneDe('aujourdhui', '2026-09-03'),
    ligneDe('demain', '2026-09-04'),
    ligneDe('apres', '2026-09-06'),
    ligneDe('sansDate', null),
  ], jour);

  // `Array.from` et non `.map` : les tableaux nés DANS le bac à sable viennent
  // d'un autre « realm », et `deepStrictEqual` compare les prototypes — deux
  // listes rigoureusement identiques échouaient, en s'affichant à l'identique.
  assert.deepStrictEqual(Array.from(blocs, (b) => b.nom),
    ['En retard', 'Aujourd’hui', 'Demain', 'Dimanche 6 septembre'],
    'un bloc par jour, dans l’ordre du calendrier — et RIEN pour les jours sans retrait');

  // LE RETARD EST UN SEUL BLOC, ET IL EST EN TÊTE. Un bloc par jour passé
  // donnerait dix en-têtes avant « Aujourd'hui » — exactement ce que cet écran
  // existe pour éviter ; et le mettre en bas reviendrait à ranger sous le tapis
  // les clients qui attendent depuis le plus longtemps.
  assert.deepStrictEqual(Array.from(blocs[0].lignes, (l) => l.id), ['vieille', 'hier'],
    'tous les jours passés tiennent dans UN bloc « En retard »');
  assert.strictEqual(blocs[0].avecDate, true,
    '… et ses lignes portent leur DATE : dans un bloc qui couvre plusieurs jours, l’heure ne situe plus rien');
  assert.ok(!blocs[1].avecDate,
    'dans une journée datée, la colonne porte l’heure — répéter la date sous son propre titre n’apprend rien');

  // Une ligne sans date ne peut se ranger sous aucun jour : elle est ignorée
  // ici, et COMPTÉE par le serveur (voir partie C).
  assert.ok(!blocs.some((b) => b.lignes.some((l) => l.id === 'sansDate')),
    'un dossier sans date de retrait n’invente pas un jour');

  // « Aujourd'hui » et « Demain » sont NOMMÉS, les autres jours se datent.
  assert.strictEqual(blocs[1].precision, 'Jeudi 3 septembre',
    'la date en clair accompagne « Aujourd’hui » : c’est ce qu’on recopie ou qu’on dit au téléphone');
  assert.strictEqual(blocs[2].precision, 'Vendredi 4 septembre');

  // L'écart de jours ne dépend PAS du fuseau de la machine qui fait tourner ce
  // test : c'est tout l'objet du midi UTC.
  assert.strictEqual(bac.ecartJours('2026-09-04', '2026-09-03'), 1);
  assert.strictEqual(bac.ecartJours('2026-08-31', '2026-09-03'), -3);

  // L'heure se lit à la française : un deux-points est une heure de tableur.
  assert.strictEqual(bac.enHeure('16:30'), '16h30');
  assert.strictEqual(bac.enHeure('9:00'), '09h00');
  assert.strictEqual(bac.enHeure(null), '',
    'PAS de tiret quand l’heure manque : une colonne de tirets se lit comme une donnée à aller chercher');

  // La quantité colle à l'article : « 25 T-shirts » et « 1 T-shirt » ne se
  // préparent pas pareil, et le nombre est ce qu'on vérifie en le donnant.
  assert.strictEqual(bac.libelleArticle({ product: 'T-shirt', quantity: 25 }), '25 × T-shirt');
  assert.strictEqual(bac.libelleArticle({ product: 'T-shirt', quantity: 1 }), 'T-shirt');
  assert.strictEqual(bac.libelleArticle({ product: null }), 'Sans description');
}

// ===========================================================================
// PARTIE B bis — LA VUE AU MOIS (03/09/2026)
// ===========================================================================
// Charlie : « l'agenda doit avoir une vue au mois avec uniquement les noms des
// clients en liste dans les jours ».
//
// LA CASE NE PORTE QUE DES NOMS. C'est la demande, mot pour mot, et c'est aussi
// la seule façon de tenir douze journées de front : l'heure, l'article et l'état
// vivent dans la bulle du nom, pas à l'écran.
assert.match(AGENDA, /function rendreMois\(/, 'la vue au mois existe');
assert.match(AGENDA, /function nomDuClient\(l\)/, '… et sa case n’aligne que des noms');
{
  const nom = AGENDA.match(/function nomDuClient\(l\) \{[\s\S]*?\n {2}\}/)[0];
  assert.ok(!/libelleArticle\(l\)[^;]*textContent|textContent = .*(heure|article)/.test(nom),
    'rien d’autre que le nom ne s’écrit dans la case');
  assert.match(nom, /attachTip\(b, detail\)/,
    '… le reste est au SURVOL : la case reste une liste de noms, et on ne perd rien');
  assert.match(nom, /ouvrirDossier/,
    '… et un nom ouvre le dossier, comme une rangée de la vue au jour : même geste sur les deux vues');
}

// LES DEUX GRILLES DU MOIS DÉCLARENT LES MÊMES SEPT COLONNES. Écrites
// différemment, les intitulés (« Lun. », « Mar. »…) ne tomberaient plus sur les
// journées qu'ils coiffent — l'écart d'un pixel qui ne se voit qu'en comparant
// deux rangées.
{
  const sept = (sel) => {
    const m = CSS_NU.match(new RegExp(`\\${sel} \\{[^}]*grid-template-columns:\\s*([^;]+);`));
    return m ? m[1].trim() : null;
  };
  const tete = sept('.ag-mois__tete');
  const corps = sept('.ag-mois__corps');
  assert.ok(tete && corps, 'les deux grilles du mois déclarent leurs colonnes');
  assert.strictEqual(tete, corps,
    'l’en-tête des jours et le corps du mois prennent EXACTEMENT les mêmes colonnes');
  assert.match(tete, /repeat\(7, minmax\(0, 1fr\)\)/, '… et il y en a sept, égales');
  // Le filet de 1 px des cases compte dans leur boîte : sans le même pixel
  // RÉSERVÉ sur les intitulés, les sept titres tombent un pixel à gauche.
  assert.match(CSS_NU, /\.ag-mois__jour \{[^}]*border-left: var\(--trait-reserve\)/,
    'les intitulés réservent le pixel du filet des cases');
}

// LA RANGÉE GRANDIT AVEC SON CONTENU, et sa hauteur plancher est un JETON.
assert.match(CSS_NU, /grid-auto-rows: minmax\(var\(--ag-case-h\), auto\)/,
  'une journée chargée s’allonge : rien n’est caché derrière un « + 3 »');
assert.match(CSS_NU, /--ag-case-h: \d+px;/,
  '… et son plancher est un jeton, pas un nombre recopié dans la règle');

// LE NOM S'ENROULE. Mesuré sur les 87 entreprises de `clients-seed.json` : la
// plus longue fait 27 signes, et une colonne en tient ~15. Sur une seule ligne,
// la moitié de la grille se lisait « SARL BEACH… ».
{
  const regle = CSS_NU.match(/\.ag-nom \{([^}]*)\}/);
  assert.ok(regle, 'le nom du client a sa règle');
  assert.match(regle[1], /white-space: normal/,
    'le nom s’enroule : c’est le contenu de cet écran, l’abréger c’est le vider');
  assert.ok(!/text-overflow: ellipsis/.test(regle[1]),
    '… et il ne se coupe pas');
  const noms = require('../clients-seed.json').map((c) => c.entreprise).filter(Boolean);
  const long = Math.max(...noms.map((n) => n.length));
  assert.ok(long <= 30,
    `la plus longue raison sociale de la base fait ${long} signes : au-delà de 30, deux lignes ne suffiraient plus`);
}

// LA BASCULE EST UN BOUTON DÉJÀ DESSINÉ. Le CRM porte deux rangées d'onglets
// (la barre du haut, le Point du jour) et aucune ne vit dans la charte : en
// inventer une troisième pour deux mots, c'est le défaut que le dépôt nomme en
// toutes lettres. Les deux vues sont des `.help-btn` — le bouton « Colonnes »
// du planning, à un clic d'ici — et son état allumé n'a qu'UNE écriture.
assert.match(AGENDA, /el\('button', 'help-btn', libelle\)/,
  'les deux vues prennent le bouton d’en-tête de l’application');
assert.match(CSS,
  /\.colbar-open\[aria-expanded="true"\],\s*\n\.help-btn\[aria-pressed="true"\] \{/,
  'l’état allumé d’un bouton d’en-tête n’a qu’UNE règle : deux boutons de la même barre ne s’allument pas autrement');
assert.ok(!/\.ag-vues [^}]*font-size|\.ag-vues [^}]*min-height/.test(CSS_NU),
  '… et le groupe des deux vues ne pose aucune forme à lui');

// LES DEUX CHEVRONS SONT DESSINÉS. La police est un sous-ensemble figé de
// 91 ligatures : elle porte `chevron_right` et PAS `chevron_left`, et un nom
// absent s'affiche en texte réduit à sa première lettre, sans erreur.
assert.match(AGENDA, /function chevron\(vers\)/, 'les chevrons du mois sont dessinés');
// Sur le CODE, jamais sur les commentaires : celui du chevron NOMME les
// ligatures absentes pour dire pourquoi il dessine, et la garde se
// déclencherait sur son propre récit.
const AGENDA_NU = AGENDA.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
assert.ok(!/chevron_left|navigate_before|calendar_month/.test(AGENDA_NU),
  '… et aucun nom d’icône absent de la police n’est écrit');

// LA VUE CHOISIE SUIT L'APPAREIL, et un stockage refusé ne casse rien.
assert.match(AGENDA, /const CLE_VUE = 'olda\.agenda-vue';/,
  'la vue choisie se retrouve le lendemain matin');
assert.match(AGENDA, /catch \(_\) \{ return 'jour'; \}/,
  '… et un localStorage refusé (navigation privée) retombe sur la vue au jour');

// LE CALENDRIER, SUR LE VRAI CODE — c'est le calcul qui se paie cher : un mois
// qui commence un jeudi, une année bissextile, décembre + 1 qui doit donner
// janvier de l'année SUIVANTE.
{
  const bac = { Intl, Date, Array, Map };
  vm.createContext(bac);
  const morceaux = [
    AGENDA.match(/const enJour = [\s\S]*?\n\};/)[0],
    AGENDA.match(/const enTemps = [^\n]*\n/)[0],
    AGENDA.match(/const ecartJours = [^\n]*\n/)[0],
    AGENDA.match(/const JOUR_SEMAINE = [^\n]*\n/)[0],
    AGENDA.match(/const majuscule = [^\n]*\n/)[0],
    AGENDA.match(/const JOURS_SEMAINE = [\s\S]*?\n {2}\(_, i\)[^\n]*\n/)[0],
    AGENDA.match(/const moisDe = [^\n]*\n/)[0],
    AGENDA.match(/const moisDecale = [\s\S]*?\n\};/)[0],
    AGENDA.match(/const premierDuMois = [\s\S]*?\n\};/)[0],
    AGENDA.match(/const joursDuMois = [\s\S]*?\n\};/)[0],
    AGENDA.match(/ {2}function casesDuMois\(cible, parJour, jour\) \{[\s\S]*?\n {2}\}/)[0],
  ];
  vm.runInContext(`${morceaux.join('\n')}
    globalThis.casesDuMois = casesDuMois;
    globalThis.moisDecale = moisDecale;
    globalThis.joursDuMois = joursDuMois;
    globalThis.JOURS_SEMAINE = JOURS_SEMAINE;`, bac);

  assert.deepStrictEqual(Array.from(bac.JOURS_SEMAINE),
    ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.', 'Dim.'],
    'la semaine commence le LUNDI, et ses sept noms viennent d’une date connue — pas d’une liste tapée');

  // Décembre + 1 = janvier de l'ANNÉE SUIVANTE. C'est le report qu'on écrit de
  // travers une fois sur deux, et il ne se voit qu'au 31 décembre.
  assert.strictEqual(bac.moisDecale('2026-12', 1), '2027-01');
  assert.strictEqual(bac.moisDecale('2026-01', -1), '2025-12');
  // Février bissextile : le calcul ne connaît aucune règle, il demande la date.
  assert.strictEqual(bac.joursDuMois('2028-02'), 29);
  assert.strictEqual(bac.joursDuMois('2026-02'), 28);

  // Septembre 2026 commence un MARDI : la grille doit poser un bouche-trou
  // (le 31 août) avant le 1er, sans quoi toute la semaine glisse d’une colonne.
  const parJour = new Map([['2026-09-03', [{ id: 'a' }]], ['2026-09-01', [{ id: 'b' }]]]);
  const cases = Array.from(bac.casesDuMois('2026-09', parJour, '2026-09-03'));
  assert.strictEqual(cases.length % 7, 0,
    'la grille se ferme sur des semaines entières : une rangée à moitié laisse un trou sans bordure');
  assert.strictEqual(cases[0].n, 31, 'le lundi 31 août complète la première semaine');
  assert.strictEqual(cases[0].hors, true, '… et c’est un bouche-trou');
  assert.deepStrictEqual(Array.from(cases[0].lignes), [],
    'un jour d’un autre mois ne porte AUCUN nom : son mois est à un clic');
  assert.strictEqual(cases[1].n, 1, 'le 1er septembre tombe donc un mardi');
  assert.strictEqual(cases[1].jour, '2026-09-01');
  assert.strictEqual(cases[1].ecart, -2, '… et il est passé de deux jours');
  assert.strictEqual(cases[3].ecart, 0, 'le 3 septembre est aujourd’hui');
  assert.strictEqual(cases[3].lignes.length, 1, '… et il porte son retrait');
  assert.strictEqual(cases.filter((c) => !c.hors).length, 30,
    'les trente jours de septembre y sont, et rien de plus');
}

// ===========================================================================
// PARTIE C — LA ROUTE, SUR UNE VRAIE BASE
// ===========================================================================
assert.match(SERVEUR, /app\.get\('\/api\/agenda'/, 'la route existe');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

const jourDecale = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

(async () => {
  process.env.PORT = '0';
  const app = require('../server');
  const base = await new Promise((resolve) => {
    const check = () => {
      const s = app && app.__server;
      if (s && s.listening) resolve(`http://127.0.0.1:${s.address().port}`);
      else setTimeout(check, 25);
    };
    check();
  });
  const call = async (method, chemin, corps) => {
    const res = await fetch(base + chemin, {
      method,
      headers: corps !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
    // Un DELETE réussi répond 204 SANS corps : `res.json()` y lève « Unexpected
    // end of JSON input », et l'échec ressemble à une route cassée.
    const texte = await res.text();
    return { status: res.status, body: texte ? JSON.parse(texte) : null };
  };

  const creer = async (champs) => {
    const r = await call('POST', '/api/requests', champs);
    assert.strictEqual(r.status, 201, `création refusée : ${JSON.stringify(r.body)}`);
    return r.body.id;
  };
  const marque = (n) => `AGENDA-${n}`;

  // Ce qui DOIT apparaître : tout ce qu'il reste à remettre au client.
  const aPrevenir = await creer({
    stage: 'facturation', sub_stage: 'client_a_prevenir', billing_company: marque('PRÊT'),
    product: 'Polos brodés', quantity: 12, deadline: jourDecale(0), project_value: 690,
  });
  const enProd = await creer({
    stage: 'production', sub_stage: 'prod_dtf', billing_company: marque('EN PROD'),
    product: 'Casquettes', quantity: 40, deadline: jourDecale(1),
  });
  // ET CE QUI N'EST PAS ENCORE CHIFFRÉ. Une commande promise pour aujourd'hui
  // et encore « à chiffrer », c'est exactement ce qu'il faut voir AVANT que le
  // client ne pousse la porte.
  const aChiffrer = await creer({
    stage: 'demande_chiffrage', sub_stage: 'a_chiffrer', billing_company: marque('À CHIFFRER'),
    product: 'Banderole', deadline: jourDecale(0),
  });
  const aTrier = await creer({
    stage: 'a_trier', billing_company: marque('À TRIER'),
    product: 'Tasse gravée', deadline: jourDecale(2),
  });

  // Ce qui ne doit PAS apparaître : plus personne ne vient le chercher.
  const recuperee = await creer({
    stage: 'facturation', sub_stage: 'commande_recuperee', billing_company: marque('RÉCUPÉRÉE'),
    product: 'Menus plastifiés', deadline: jourDecale(0),
  });
  const soldee = await creer({
    stage: 'paiement', sub_stage: 'paiement_valide', billing_company: marque('SOLDÉE'),
    product: 'Tapis de comptoir', deadline: jourDecale(0),
  });
  const fiverr = await creer({
    stage: 'fiverr', billing_company: marque('FIVERR'),
    product: 'Logo vectorisé', deadline: jourDecale(0),
  });
  const archivee = await creer({
    stage: 'production', sub_stage: 'prod_uv', billing_company: marque('ARCHIVÉE'),
    product: 'Autocollants', deadline: jourDecale(0),
  });
  await call('DELETE', `/api/requests/${archivee}`);

  // Et un dossier SANS date : il n'est pas un retrait, mais il est compté.
  const sansDate = await creer({
    stage: 'preparation', sub_stage: 'prepa_bat', billing_company: marque('SANS DATE'),
    product: 'Plaques gravées',
  });

  const agenda = (await call('GET', '/api/agenda')).body;
  const ids = new Set(agenda.lignes.map((l) => l.id));

  for (const [id, quoi] of [[aPrevenir, 'un dossier prêt à remettre'],
    [enProd, 'un dossier encore en production'],
    [aChiffrer, 'un dossier promis pour aujourd’hui et pas encore chiffré'],
    [aTrier, 'un dossier encore à trier']]) {
    assert.ok(ids.has(id), `${quoi} doit figurer à l’agenda`);
  }
  for (const [id, quoi] of [[recuperee, 'une commande déjà récupérée au comptoir'],
    [soldee, 'un dossier parti chez le client (« Paiement & clôture »)'],
    [fiverr, 'de la sous-traitance graphiste — aucun client au comptoir'],
    [archivee, 'un dossier archivé'],
    [sansDate, 'un dossier sans date de retrait']]) {
    assert.ok(!ids.has(id), `${quoi} n’a rien à faire dans une liste de gens qui vont passer`);
  }

  assert.ok(agenda.sansDate >= 1,
    'les dossiers sans date sont COMPTÉS : les taire ferait lire l’agenda comme complet');

  // LA LISTE EST ORDONNÉE PAR JOUR, puis par heure : l'écran groupe, il ne trie
  // pas. Un tri côté navigateur redeviendrait un deuxième avis sur la question.
  const jours = agenda.lignes.map((l) => String(l.deadline).slice(0, 10));
  assert.deepStrictEqual(jours, [...jours].sort(),
    'la route rend les retraits dans l’ordre du calendrier');

  // L'HEURE VIENT DE LA FICHE. `retrait_creneau` est mesurée vide sur les 205
  // dossiers de production : l'agenda lit `fiche.heureSouhaitee`, celle que le
  // comptoir remplit et que la fiche atelier édite.
  await call('PATCH', `/api/requests/${aPrevenir}/fiche`, { heureSouhaitee: '16:30' });
  const relu = (await call('GET', '/api/agenda')).body.lignes.find((l) => l.id === aPrevenir);
  assert.strictEqual(relu.heure, '16:30', 'l’heure de retrait remonte, extraite de la fiche');

  // AUCUN PRIX NE VOYAGE. Cette liste repart à chaque évènement temps réel,
  // vers chaque poste, et l'écran n'affiche pas un centime.
  for (const champ of ['project_value', 'cout_revient', 'acompte_montant', 'paye', 'fiche']) {
    assert.ok(!(champ in relu), `« ${champ} » n’a pas à voyager avec l’agenda`);
  }
  assert.deepStrictEqual(Object.keys(relu).sort(),
    ['billing_company', 'client_type', 'deadline', 'flag', 'flag_reason', 'heure',
      'id', 'product', 'quantity', 'stage', 'sub_stage'],
    'la réponse ne porte QUE ce que l’agenda affiche');

  // Une commande remise passe en « Commande récupérée » : elle quitte l'agenda
  // le geste d'après, sans que personne ait à la retirer d'une liste à part.
  await call('PATCH', `/api/requests/${enProd}`, {
    stage: 'facturation', sub_stage: 'commande_recuperee',
  });
  const apres = (await call('GET', '/api/agenda')).body;
  assert.ok(!apres.lignes.some((l) => l.id === enProd),
    'remettre la commande la sort de l’agenda : une seule source de vérité, celle du planning');

  console.log('✓ agenda des retraits : ce qu’il montre, ce qu’il tait, et le jour de Saint-Martin');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
