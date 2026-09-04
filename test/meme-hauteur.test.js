'use strict';

// TOUT CE QUI PEUT ÊTRE À LA MÊME HAUTEUR L'EST — ET C'EST TESTÉ
//
// Consigne de Charlie, 27/08/2026, mot pour mot : « il est extrêmement
// important que tout ce qui peut être à la même hauteur doit l'être, tu dois
// être ultra vigilant là-dessus, coder en dur sur l'importance de ça. »
//
// Ce qui l'a déclenchée : le menu de « + Nouveau Projet » et le panneau
// « Colonnes » tombent de la MÊME barre, à un clic l'un de l'autre, et
// s'écrivaient chacun leur rangée — 50 px contre 44, 0/14 de rembourrage
// contre 6/10, graisse 800 contre 600. Et le menu tombait 13,7 px à droite du
// « + » qui l'ouvre. Deux composants qui se ressemblent au lieu d'un seul :
// c'est le défaut que la charte du dépôt nomme en toutes lettres.
//
// Un écart pareil ne se voit pas en relisant un écran : il se voit en
// COMPARANT deux écrans. C'est pour ça qu'il vit dans un test et pas dans une
// bonne intention.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(RACINE, 'public/styles.css'), 'utf8');
const APP = fs.readFileSync(path.join(RACINE, 'public/app.js'), 'utf8');
const PROJET = fs.readFileSync(path.join(RACINE, 'public/nouveau-projet.js'), 'utf8');
const PONT = fs.readFileSync(path.join(RACINE, 'public/comptoir/pont.js'), 'utf8');

// Les commentaires portent les anciennes valeurs (« 50 px contre 44 ») : les
// chercher dans le CSS commenté ferait passer le test pour de mauvaises
// raisons, ou le ferait échouer sur une phrase.
const cssNu = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

// ---------------------------------------------------------------------------
// 1. UNE RANGÉE DE PANNEAU, UNE SEULE ÉCRITURE
// ---------------------------------------------------------------------------
// LE MENU DE « NOUVEAU PROJET » N'EXISTE PLUS (29/08). Il partageait cette règle
// avec le panneau « Colonnes » — c'est ce qui l'avait fait entrer dans ce
// fichier : ils tombaient de la MÊME barre, à un clic l'un de l'autre, et
// s'écrivaient chacun leur rangée (44 px contre 50, 6/10 de rembourrage contre
// 0/14, graisse 600 contre 800). Les deux parcours sont devenus deux ONGLETS et
// le panneau est parti en entier.
// Ce qui reste vrai, et qui se vérifie encore : la rangée du panneau qui SUBSISTE
// prend la boîte de la barre dont il tombe.
assert.ok(!/np-menu/.test(CSS) && !/np-menu/.test(APP) && !/menuProjet/.test(APP),
  'le menu de « Nouveau Projet » est parti en entier : feuille, panneau et écouteurs');
const regleRangee = cssNu.match(/\n\.colbar-item\s*\{([^}]*)\}/);
assert.ok(regleRangee, 'la rangée du panneau « Colonnes » garde sa règle');
assert.ok(/min-height:\s*var\(--ctrl-h\)/.test(regleRangee[1]),
  '… et sa hauteur est un JETON (--ctrl-h), pas un nombre : un nombre se recopie de travers');
assert.ok(/padding:\s*6px 10px/.test(regleRangee[1]) && /gap:\s*8px/.test(regleRangee[1]),
  '… avec son rembourrage et son écart : la hauteur seule ne suffit pas à faire une rangée');
assert.ok(/font-weight:\s*var\(--graisse-note\)/.test(regleRangee[1]),
  '… et sa graisse');

// ---------------------------------------------------------------------------
// 1 bis. UNE SEULE HAUTEUR DANS LA BARRE DU HAUT (28/08/2026)
// ---------------------------------------------------------------------------
// « Je veux voir avec 1 seul. » La barre en portait QUATRE : 36 px pour les
// onglets, 44 pour les boutons ronds et le poste, 50 pour la pilule de
// recherche. Tout est ramené sur `--ctrl-h` — la boîte que la recherche portait
// déjà, et que porte tout ce qui se clique et se remplit ailleurs. Descendre la
// recherche à 44 aurait fait de la barre une exception de plus.
const boiteDe = (selecteur) => {
  const m = cssNu.match(new RegExp(`\\n${selecteur.replace(/[.\-]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
};
for (const [sel, mot] of [['.icon-btn', 'width'], ['.poste', 'height'], ['.nav-switch-btn', 'min-height']]) {
  const bloc = boiteDe(sel);
  assert.ok(bloc, `la règle ${sel} existe toujours`);
  assert.ok(new RegExp(`${mot}:\\s*var\\(--ctrl-h\\)`).test(bloc),
    `${sel} prend la boîte de l’application (--ctrl-h) : la barre du haut n’a plus qu’UNE hauteur`);
  assert.ok(!/var\(--rond\)/.test(bloc),
    `${sel} ne garde aucun reste de --rond : c’est par là que la deuxième hauteur revient`);
}
assert.ok(/\.champ-recherche\s*\{[^}]*height:\s*var\(--ctrl-h\)/.test(
  fs.readFileSync(path.join(RACINE, 'public/charte.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')),
  '… et la pilule de recherche, qui la portait déjà, ne bouge pas');

// ---------------------------------------------------------------------------
// 2. L'ICÔNE D'UNE RANGÉE A UNE BOÎTE, ET ELLE EST ÉCRITE
// ---------------------------------------------------------------------------
const regleIcone = cssNu.match(/\n\.colbar-item__ic\s*\{([^}]*)\}/);
assert.ok(regleIcone, 'l’icône d’une rangée de panneau a sa règle');
assert.ok(/width:\s*var\(--ic\)/.test(regleIcone[1]) && /height:\s*var\(--ic\)/.test(regleIcone[1]),
  '… avec une largeur ET une hauteur écrites : sans elles la boîte sort de la police, et elle change avec le glyphe');

// ---------------------------------------------------------------------------
// 3. IL N'Y A PLUS DE PANNEAU À CALER : DEUX ONGLETS, DEUX ADRESSES (29/08)
// ---------------------------------------------------------------------------
// Le menu était le seul panneau de l'application à devoir se poser au pixel sur
// le rail de son onglet — 13,7 px d'écart au premier essai, corrigés en deux
// passes de mesure. Le calage disparaît avec lui : un onglet n'a rien à caler.
// Ce qui le remplace se vérifie autrement — l'adresse dit QUEL parcours, sinon
// un rechargement retombe sur l'accueil à deux tuiles.
assert.ok(/const HASH_VENTE = '#vente';/.test(APP) && /const HASH_DEVIS = '#devis';/.test(APP),
  'chaque parcours a son hash, et c’est une CONSTANTE : la chaîne sert de clé ET d’écriture');
assert.ok(/const PARCOURS_PAR_HASH = \{ \[HASH_VENTE\]: 'vente', \[HASH_DEVIS\]: 'devis' \};/.test(APP),
  '… et une seule table dit lequel : `mountProjet` la lit, il ne se fait plus passer l’identifiant');
assert.ok(/\[HASH_VENTE\]: 'projet', \[HASH_DEVIS\]: 'projet',/.test(APP),
  '… les deux mènent à la MÊME vue : c’est le même onglet, le même cadre');
// TROIS HASH POUR UNE SEULE VUE : `setViewMode` ne fait rien quand la vue ne
// change pas. Sans cet appel, passer de « Vente » à « Devis » laissait le
// premier parcours à l'écran, onglet allumé sur le second — vérifié au rendu.
assert.ok(/if \(mode === 'projet'\) mountProjet\(\);/.test(APP),
  'le parcours se demande dans `applyHash`, pas dans la bascule de vue');

// ---------------------------------------------------------------------------
// 4. UN CLIC NE VAUT QU'UNE SEULE REMISE À ZÉRO
// ---------------------------------------------------------------------------
assert.ok(/let ouvertureParcours = false;/.test(APP),
  'un verrou dit à `mountProjet` de ne rien remettre à zéro pendant qu’on ouvre');
assert.ok(/if \(voulu && !ouvertureParcours && projetModule\) projetModule\.ouvrirParcoursNeuf\(voulu\);/.test(APP),
  '… et `mountProjet` le respecte : sans lui, `applyHash` et `allerAuParcours` ouvrent DEUX fois');
assert.ok(/projetModule\.ouvrirParcoursNeuf\(id\)/.test(APP) && !/projetModule\.ouvrirParcours\(/.test(APP),
  'on passe par `ouvrirParcoursNeuf` : un seul mouvement, un seul parcours touché');
assert.ok(/export function ouvrirParcoursNeuf/.test(PROJET),
  '… et la fonction existe côté parcours');
const neuf = PROJET.match(/export function ouvrirParcoursNeuf[\s\S]*?\n\}/)[0];
assert.ok(!/afficher\(null\)/.test(neuf),
  'ouvrir un parcours ne passe JAMAIS par l’accueil à deux tuiles : c’est un écran qu’on ne voulait pas voir');
assert.ok(/aRafraichir\.add\(f\.id\)/.test(neuf),
  '… et le parcours d’à côté est seulement NOTÉ : le recharger maintenant, c’est 120 Ko pour un écran que personne ne regarde');

// ---------------------------------------------------------------------------
// 5. ON NE RECHARGE PAS UN ÉCRAN ENCORE VIERGE
// ---------------------------------------------------------------------------
assert.ok(/typeof w\.oldaParcoursVierge === 'function' && w\.oldaParcoursVierge\(\)/.test(PROJET),
  'avant de recharger, on demande au cadre s’il y a quelque chose à jeter');
assert.ok(/window\.oldaParcoursVierge = \(\) => !saisieCommencee && !ecranFinal\(\)/.test(PONT),
  '… et le cadre sait répondre');
assert.ok(/document\.addEventListener\('input', marquerSaisie, true\)/.test(PONT)
  && /document\.addEventListener\('change', marquerSaisie, true\)/.test(PONT),
  '… le drapeau se lève à la PREMIÈRE frappe, en capture : un champ ajouté plus tard le lève aussi');
const reinit = PROJET.match(/function reinitialiser\(id\) \{[\s\S]*?\n\}/)[0];
assert.ok(/catch \(err\) \{ \/\* on ne sait pas : on recharge \*\/ \}/.test(reinit),
  'en cas de doute on RECHARGE : le formulaire du client précédent devant le suivant, jamais');

console.log('✓ même hauteur : une seule rangée de panneau, une boîte d’icône écrite, deux onglets au lieu d’un menu');


// ---------------------------------------------------------------------------
// LA FICHE ATELIER PREND LA MÊME BOÎTE (29/08/2026)
// ---------------------------------------------------------------------------
// Elle s'ouvre à UN CLIC du planning, et elle était le seul écran à ne pas
// prendre `--ctrl-h`. Elle en déclarait QUATRE, en nombres — 34, 40, 42, 44 —
// pour dire une densité : un champ dans une bulle, un champ de colonne, un
// contrôle de bandeau, un contrôle de barre. C'est exactement ce que la règle
// du 27/08 interdit : ce qui peut être à la même hauteur l'est, et une hauteur
// est un jeton, jamais un nombre.
//
// ELLE NE REDÉCLARE PAS L'ÉCHELLE NON PLUS. `--fa-lab: 14px`, `--fa-val: 17px`,
// `--fa-titre: 21px` valaient exactement `--taille-note`, `--taille-texte` et
// `--taille-titre` : trois nombres recopiés. Le jour où l'échelle bouge, un
// écran recopié reste seul dans son coin — et ça ne se voit pas en le relisant,
// seulement en le comparant à l'écran d'à côté.
{
  const FICHE = fs.readFileSync(path.join(RACINE, 'public/fiche-atelier.css'), 'utf8');
  const jetons = FICHE.match(/^\s+--fa-[\w-]+:[^;]+;/gm) || [];
  assert.ok(jetons.length, 'la fiche atelier déclare bien ses jetons');

  for (const j of jetons.filter((x) => /--fa-h-/.test(x))) {
    assert.match(j, /var\(--ctrl-h\)/,
      `la fiche atelier écrit une hauteur de commande à la main : ${j.trim()}`);
  }
  // (`--fa-lab-w`, la LARGEUR de la colonne des intitulés, était l'exception de
  // cette boucle : ce n'était pas un cran de texte. Elle a disparu le 31/08 avec
  // le rail lui-même — l'intitulé se pose désormais AU-DESSUS de sa valeur,
  // comme au comptoir, et aucune colonne n'a plus à lui être réservée.)
  for (const j of jetons.filter((x) => /--fa-(lab|val|fort|titre|min)\s*:/.test(x))) {
    assert.match(j, /var\(--taille-/,
      `la fiche atelier recopie un cran de l’échelle : ${j.trim()}`);
  }
  // Et elle n'en invente pas un cinquième : trois crans à l'écran, pas quatre.
  const crans = new Set((FICHE.match(/--fa-\w+: var\((--taille-[\w-]+)\)/g) || [])
    .map((m) => m.match(/--taille-[\w-]+/)[0]));
  assert.ok(crans.size <= 3,
    `la fiche atelier prend ${crans.size} crans de texte — deux par surface, trois au grand maximum`);
}

// ---------------------------------------------------------------------------
// … ET SES DEUX COLONNES BATTENT LE MÊME RYTHME (29/08/2026)
// ---------------------------------------------------------------------------
// Les rangées 3 et 4 de la fiche tombaient 4 px plus haut à droite qu'à gauche.
// Cause : deux jetons d'écart pour un seul rythme. Les grilles espaçaient leurs
// rangées de `--pas-1` (6 px), la colonne espaçait ses blocs de `--pas-2` (10).
// La colonne de droite quitte sa grille une rangée plus tôt que celle de
// gauche : elle prenait donc le grand écart au moment où l'autre prenait encore
// le petit, et le décalage se reportait sur tout ce qui suit.
//
// Ça ne se voit pas en relisant la fiche — les deux colonnes sont correctes
// prises séparément. Ça se voit en mesurant l'une CONTRE l'autre : les cinq
// rangées tombent à 0 px depuis, mesuré au rendu à 1440 px.
{
  const FICHE = fs.readFileSync(path.join(RACINE, 'public/fiche-atelier.css'), 'utf8');
  const nu = FICHE.replace(/\/\*[\s\S]*?\*\//g, '');
  const grilles = nu.match(/\.fa-grille-client,\s*\n\.fa-grille-prod \{([^}]*)\}/);
  assert.ok(grilles,
    'les deux grilles de la fiche partagent UNE règle : écrites deux fois, elles divergent');
  // ⚠ LE JETON A CHANGÉ DE NOM LE 31/08, PAS DE RÔLE : `--pas-2` (10 px) →
  // `--rangee` (20 px), celui du comptoir. L'écart de 10 px suffisait quand
  // l'intitulé était à GAUCHE et qu'une rangée tenait sur une ligne ; l'intitulé
  // étant passé AU-DESSUS, 10 px séparaient la valeur d'une case de l'intitulé
  // de la suivante presque aussi peu (10) que cet intitulé de sa propre valeur
  // (8) — et l'œil ne savait plus quel libellé allait avec quel champ.
  // Ce que ce contrôle tient est INCHANGÉ : les grilles et la colonne battent le
  // même rythme, et elles le lisent au MÊME endroit.
  assert.match(grilles[1], /gap: var\(--rangee\);/,
    'leur écart de rangée est celui de la colonne — un seul rythme, un seul jeton');
  // Et la colonne garde le sien : c'est le même.
  const colonnes = nu.match(/\.fa-col--g \{([^}]*)\}/);
  assert.ok(colonnes && /gap: var\(--rangee\)/.test(colonnes[1]),
    '… celui-là même que la colonne applique entre deux blocs');
}

console.log('✓ fiche atelier : la boîte de l’app, et deux colonnes au même rythme');

// ---------------------------------------------------------------------------
// 5. LES HUIT ÉCRANS S'OUVRENT DE LA MÊME FAÇON (30/08/2026)
// ---------------------------------------------------------------------------
// Le titre d'écran était écrit SIX fois dans CINQ fichiers : `.mt-head__titre`
// et `.pil-titre` (identiques au caractère près, 32 px), `.work-title h1` (17),
// `.cl-brand__title` (17), `.reg-head__title` (17 plus une icône de 24) — et le
// Point du jour n'en avait aucun. Mesuré au rendu : TROIS tailles, QUATRE
// abscisses (349 / 371 / 389 / 425) et CINQ ordonnées.
//
// C'est le défaut que ce fichier existe pour refuser, dans sa forme la plus
// large : chaque écran était correct relu seul.
{
  const CHARTE = fs.readFileSync(path.join(RACINE, 'public/charte.css'), 'utf8');
  const nu = CHARTE.replace(/\/\*[\s\S]*?\*\//g, '');

  const tete = nu.match(/\.ecran-tete \{([^}]*)\}/);
  assert.ok(tete, 'l’en-tête d’écran vit dans la charte : c’est le seul fichier que le CRM et le comptoir lisent tous les deux');

  // SA HAUTEUR EST UN CALCUL, JAMAIS UN NOMBRE — même règle que partout
  // ailleurs dans ce fichier : un nombre se recopie de travers.
  assert.match(tete[1], /min-height: calc\(var\(--ctrl-h\)/,
    'la hauteur de l’en-tête sort de la boîte de l’application, elle ne s’écrit pas');
  assert.ok(!/min-height:\s*[0-9]/.test(tete[1]),
    'aucune hauteur d’en-tête écrite en dur');

  // ET SA VERTICALE AUSSI. Les quatre abscisses mesurées venaient de quatre
  // rembourrages écrits à la main dans quatre feuilles.
  // Le pas VERTICAL est passé de `--pas-3` à `--pas-2` le 01/09 (Charlie :
  // « cette barre est beaucoup trop grosse ») : 83 px de rangée deviennent 71,
  // sur les huit écrans à la fois. Ce qui est tenu ici, c'est que les deux
  // restent des JETONS — l'horizontal est la verticale commune à tout l'écran.
  assert.match(tete[1], /padding: var\(--pas-[0-9]\) var\(--ecran-pad-x\)/,
    'l’en-tête démarre sur la verticale commune, par son jeton');
  // ET IL NE SE PLIE PAS. Sur le devis flash à 1 280 il passait à 122 px :
  // 937 px de contenu pour 918. Un en-tête qui double de hauteur selon l'écran
  // est le défaut même que ce fichier refuse.
  assert.match(tete[1], /flex-wrap: nowrap/,
    'l’en-tête tient sur UNE rangée : c’est le compteur qui s’abrège, pas la hauteur qui double');
  assert.match(nu, /--ecran-pad-x:\s*\d+px;/,
    '… et ce jeton est déclaré une fois, dans la charte');

  // LE TITRE PREND LE CRAN QUE LA CHARTE LUI RÉSERVE. `--taille-titre` était
  // déclaré « titre d'une carte, d'une section » et ne servait qu'à UN endroit
  // de toute l'application : c'est pour ça que les titres d'écran improvisaient
  // entre 17 et 32.
  const titre = nu.match(/\.ecran-tete__titre \{([^}]*)\}/);
  assert.ok(titre, 'le titre d’écran a sa règle, dans la charte');
  assert.match(titre[1], /font-size: var\(--taille-titre\)/,
    'le titre d’écran prend `--taille-titre`, pas le cran des chiffres qu’on annonce');

  // AUCUN ÉCRAN NE SE REFAIT LE SIEN. C'est la garde qui compte : la règle
  // ci-dessus peut être parfaite pendant qu'un écran la double en silence.
  const FEUILLES = require('./feuilles-crm');
  for (const f of [...FEUILLES.FEUILLES_CRM, 'public/clients.css']) {
    const nuf = FEUILLES.lireFeuille(f).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const perdue of ['.mt-head__titre', '.pil-titre', '.work-title', '.cl-brand__title',
      '.reg-head__title', '.reg-head__ic', '.cl-head', '.work-head-left', '.pj-head-row']) {
      assert.ok(!nuf.includes(perdue),
        `${f} : « ${perdue} » réécrit l’en-tête de la charte — il n’y en a qu’un`);
    }
  }

  // ET TOUS LE CONSTRUISENT PAR LE MÊME MODULE : une forme partagée avec six
  // markups redevient six en-têtes le jour où l'un d'eux ajoute une ligne.
  for (const f of ['montravail', 'pilotage', 'dashboard', 'clients', 'reglages', 'tailles-logos',
    'agenda']) {
    const js = fs.readFileSync(path.join(RACINE, `public/${f}.js`), 'utf8');
    assert.match(js, /import \{ ecranTete \} from '\.\/ecran-tete\.js'/,
      `public/${f}.js doit bâtir son en-tête avec celui de la charte`);
  }

  // L'ACTION POSÉE DANS UNE LIGNE, elle aussi, n'a plus qu'une écriture — et
  // elle ne prend PAS la pilule : la charte la réserve à une étiquette, et
  // `.ordre-reset` la prenait pour une action.
  const action = nu.match(/\.action-ligne \{([^}]*)\}/);
  assert.ok(action, '« Renommer », « Retirer », « revenir au tri » : un seul objet');
  assert.match(action[1], /min-height: var\(--ctrl-h-serre\)/,
    'sa hauteur est la boîte serrée de la charte, pas un nombre');
  assert.ok(!/border-radius: var\(--pilule\)/.test(action[1]),
    'une action ne prend jamais la pilule — sinon rien ne la distingue d’une étiquette');
}

// ---------------------------------------------------------------------------
// 9. LES DEUX ÉCRANS QUI SE REPLIENT PORTENT LE MÊME VOLET (02/09/2026)
// ---------------------------------------------------------------------------
// Charlie : « je veux que mon onglet vente soit pareil que flash devis avec les
// menus dépliables repliables, ils sont fermés par défaut et doivent être
// fermés à chaque nouveau devis. »
//
// C'est exactement la situation que ce fichier existe pour tenir : deux écrans
// du même poste, à un clic l'un de l'autre, qui replient chacun leurs cartes.
// Écrites deux fois, les deux poignées redeviennent deux hauteurs le jour où
// l'une bouge — et un écart pareil ne se voit qu'en COMPARANT les deux écrans.
{
  const CHARTE = fs.readFileSync(path.join(RACINE, 'public/charte.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const VENTE = fs.readFileSync(path.join(RACINE, 'public/comptoir/vente-directe.html'), 'utf8');
  const VENTE_CSS = fs.readFileSync(path.join(RACINE, 'public/comptoir/vente-directe.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const DEVIS = fs.readFileSync(path.join(RACINE, 'public/devis-flash.js'), 'utf8');

  // UNE SEULE ÉCRITURE, DANS LA CHARTE, ET C'EST UN JETON.
  assert.ok(/\.volet-carte > summary \{ min-height: var\(--ctrl-h\); padding-block: 0; \}/.test(CHARTE),
    'la poignée d’une carte qui se replie prend la boîte de l’application, et elle est écrite dans la charte');
  assert.ok(!/min-height:\s*[0-9]/.test(VENTE_CSS.match(/\.vd-corps[\s\S]{0,400}/)?.[0] || ''),
    '… l’écran de vente n’en réécrit aucune en dur autour de son volet');

  // ET LES DEUX ÉCRANS LA PORTENT, SUR LE MÊME NŒUD QUE LEUR CARTE.
  assert.ok(/'reg-card dvf-cat volet-plus volet-carte'/.test(DEVIS),
    'le devis flash pose le volet de la charte sur sa carte');
  // … ET LA VENTE FLASH AUSSI (04/09). Elle est NÉE APRÈS la branche qui a posé
  // ce volet : elle repliait donc ses cartes avec sa propre poignée, et les deux
  // écrans — à un clic l'un de l'autre, le même geste — donnaient 50 px pour le
  // devis et 44,6 pour la vente. Mesuré au rendu, pas relu.
  const VENTE_FLASH = fs.readFileSync(path.join(RACINE, 'public/vente-flash.js'), 'utf8');
  assert.ok(/'reg-card dvf-cat volet-plus volet-carte'/.test(VENTE_FLASH),
    'la vente flash pose le MÊME volet que le devis — pas un qui lui ressemble');
  const volets = VENTE.match(/<details class="card[^"]*volet-plus volet-carte"/g) || [];
  assert.ok(volets.length >= 5,
    `les cartes de l’écran de vente sont des volets (${volets.length} trouvé(s), 5 attendus au moins)`);
  assert.ok(!/<details[^>]*volet-carte[^>]*\sopen[\s>]/.test(VENTE),
    'aucun volet n’est écrit `open` : « ils sont fermés par défaut »');
  // … ET FERMÉS À CHAQUE NOUVELLE VENTE. Une nouvelle vente recharge la page,
  // mais un rechargement n'est pas toujours une page neuve : le navigateur peut
  // restaurer l'état de la précédente.
  assert.ok(/querySelectorAll\("details\.volet-carte"\)[\s\S]{0,80}open=false/.test(VENTE),
    '… et l’écran les referme au chargement plutôt que de parier sur le navigateur');

  // UN CHAMP REPLIÉ QU'ON APPELLE OUVRE SON VOLET. Sans ça, `focus()` sur le
  // premier champ obligatoire qui manque échoue SANS RIEN DIRE : le champ passe
  // en rouge dans une carte fermée, et le défaut ne se voit pas.
  assert.ok(/HTMLElement\.prototype\.focus\s*=/.test(VENTE)
    && /closest\("details"\)/.test(VENTE),
    'un champ qu’on appelle ouvre son volet, par une seule règle et non douze appels');

  // LA CARTE REPREND LE CADRE QUE LE GROUPE LUI AVAIT PRIS. Un titre nu posé
  // sur le fond gris ne se lit pas comme une carte, et l'écran d'à côté en
  // montre une : le carve-out `:has(> .bloc)` n'a plus lieu d'être.
  assert.ok(!/:has\(> \.bloc\)/.test(VENTE_CSS),
    'plus aucune carte ne s’efface derrière ses groupes : c’est le volet qu’on lit fermé');
}

console.log('✓ écrans : un seul en-tête, une seule verticale, une seule action de ligne, un seul volet');

// ===========================================================================
// LA LIGNE DU PLANNING : TROIS CHIPS, UNE SEULE BOÎTE (04/09/2026)
// ---------------------------------------------------------------------------
// Mesurés à 1 280 px sur la ligne, les trois jetons cliquables donnaient TROIS
// hauteurs : `.ref-chip` 27,4 px, `.deadline-badge` 33,4 et `.resp-chip` 39,4.
// Même famille — un texte court, dans une cellule de la grille, qu'on clique
// pour changer une valeur — et trois rembourrages écrits à la main. Un écart de
// 1,4 px entre l'échéance et le pilote ne se lit pas comme une hiérarchie.
// Et les TROIS portaient la pilule alors que les trois AGISSENT.
{
  const chips = ['.resp-chip', '.ref-chip', '.deadline-badge'];
  for (const c of chips) {
    const bloc = CSS.match(new RegExp('\\' + c + ' \\{([^}]*)\\}'));
    assert.ok(bloc, `${c} a sa règle dans styles.css`);
    assert.match(bloc[1], /min-height: var\(--ctrl-h-serre\)/,
      `${c} prend la boîte serrée de la charte — une hauteur est un jeton, jamais un nombre`);
    assert.ok(!/border-radius: var\(--pilule\)/.test(bloc[1]),
      `${c} agit (assigner, ajouter, modifier une date) : une action ne prend jamais la pilule`);
    assert.match(bloc[1], /border-radius: var\(--arrondi-champ\)/,
      `${c} prend le rectangle arrondi — la forme dit le rôle`);
  }
}

// ===========================================================================
// LE RAIL : UNE SEULE BOÎTE POUR TOUTES SES LIGNES (04/09/2026)
// ---------------------------------------------------------------------------
// Elle s'écrivait à TROIS endroits : `.stage` posait `min-height: 38px` (un
// NOMBRE), `.stage-repli` recopiait le même 38, et `.stage.zone-head` défaisait
// les deux (`min-height: auto`, 7 px de rembourrage, `gap: 10`). Résultat : un
// titre de phase sur une ligne faisait 33,3 px quand la sous-étape juste
// dessous en faisait 39,4 — le TITRE plus court que ce qu'il coiffe.
{
  const stage = CSS.match(/\n\.stage \{([^}]*)\}/);
  assert.ok(stage, '`.stage` a sa règle');
  assert.match(stage[1], /min-height: var\(--ctrl-h-serre\)/,
    'la boîte du rail est la boîte serrée de la charte, et elle se dit ICI');
  for (const [sel, re] of [['.stage-repli', /\.stage-repli \{([^}]*)\}/],
                           ['.stage.zone-head', /\.stage\.zone-head \{([^}]*)\}/]]) {
    const bloc = CSS.match(re);
    assert.ok(bloc, `${sel} a sa règle`);
    /* LES COMMENTAIRES SORTENT D'ABORD : celui de `.zone-head` cite les
       valeurs qu'il a perdues (« le `gap: 10` d'ici »), et une sonde qui lit le
       bloc brut se déclenche sur le récit de la correction au lieu du code. */
    const code = bloc[1].replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/min-height:/.test(code),
      `${sel} ne réécrit pas la hauteur du rail — deux écritures redeviennent deux hauteurs`);
    assert.ok(!/\bpadding:/.test(code) && !/\bgap:/.test(code),
      `${sel} ne réécrit ni le rembourrage ni l’écart de \`.stage\``);
  }
}

// ===========================================================================
// L'APERÇU DU TICKET DU COMPTOIR : QUATRE CRANS, PAS ONZE (04/09/2026)
// ---------------------------------------------------------------------------
// C'était le SEUL fichier du dépôt qui écrivait encore une taille de texte en
// clair : onze crans à l'écran (11, 12, 12.5, 13, 14, 15, 16, 18, 19, 24, 28)
// et cinq de plus à l'impression, dont un 12 contre 12,5 qui ne se lit que
// comme de la négligence. Le ticket de l'atelier avait la même maladie — dix
// crans — et il en a été guéri ; son aperçu au comptoir ne l'avait pas été.
// Un papier garde ses PROPRES crans (l'échelle de l'écran ne le regarde pas),
// mais il n'en a que trois, plus celui des intitulés.
{
  const DD = fs.readFileSync(path.join(RACINE, 'public/comptoir/demande-devis.css'), 'utf8');
  assert.ok(!/font-size:\s*[0-9.]+px/.test(DD),
    'aucune taille de texte en clair dans demande-devis.css : le papier passe par ses jetons');
  for (const j of ['--tkc-geant', '--tkc-cle', '--tkc-texte', '--tkc-cap']) {
    assert.ok(DD.includes(j + ':'), `le papier du comptoir déclare ${j}`);
  }
  // QUATRE, ET PAS UN DE PLUS : un cinquième jeton, c'est le désordre qui
  // revient par la porte des jetons.
  const crans = new Set((DD.match(/--tkc-[a-z]+(?=:)/g) || []));
  assert.strictEqual(crans.size, 4,
    `le papier du comptoir a ${crans.size} crans : trois, plus celui des intitulés`);
}

console.log('✓ ligne du planning, rail et papier du comptoir : une seule boîte, quatre crans');
