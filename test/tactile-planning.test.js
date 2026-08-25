'use strict';

// LE PLANNING SOUS LE DOIGT — audit du 18/08 au soir.
// ===========================================================================
// Mesuré d'abord, corrigé ensuite : sur 400 cartes montées, le rendu tient
// 60 images/seconde (p95 = 17 ms, aucune tâche longue) et une frappe dans la
// recherche coûte 1 à 4 ms. Ce qui manquait n'était donc pas la vitesse, mais
// la RÉPONSE — ce que l'écran fait quand un doigt se pose dessus :
//
//   1. LE SURVOL RESTAIT COLLÉ. Chrome Android applique `:hover` au tap et l'y
//      laisse jusqu'au tap suivant ailleurs : la dernière carte touchée restait
//      éclairée en permanence, et se lisait comme « celle-ci est sélectionnée »
//      alors que rien ne l'était. 119 règles de survol, aucune bornée aux
//      appareils qui ont un survol.
//   2. L'APPUI NE RÉPONDAIT PAS. Sept règles `:active` dans toute la feuille,
//      aucune sur les cartes ni sur le rail : entre le doigt et la réponse du
//      serveur, l'écran ne disait RIEN. C'est ce silence qui fait retaper — et
//      deux taps valent deux fois l'action.
//   3. LA LISTE DEMANDÉE NE COMMENÇAIT PAS EN HAUT. Changer de sous-étape passe
//      par le chemin rapide (re-filtrage sans rechargement) : la position de
//      défilement ne bougeait pas. Depuis « Production » déroulée à 2 500 px,
//      un tap sur « Production DTF » laissait la liste à 510 px — les premières
//      commandes de l'étape demandée naissaient AU-DESSUS de l'écran.
//   4. LA CARTE ÉTAIT INERTE. 146 px de haut, et seules quatre pastilles de
//      44 px tout à droite répondaient : viser le dossier lui-même ne faisait
//      rien.
//   5. L'AUTO-DÉFILEMENT DU GLISSER ALLAIT À VITESSE FIXE. 14 px par image quoi
//      qu'on fasse : sur un écran qui ne montre que trois à quatre cartes,
//      remonter une commande du bas d'une étape de cinquante demandait de tenir
//      le doigt au bord une dizaine de secondes, sans pouvoir viser.
//
// Les règles sont éprouvées sur le VRAI source — découpé dans les fichiers,
// jamais recopié ici : une copie ne prouverait que sa propre exactitude.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const APP = lire('app.js');
const CSS = lire('styles.css');

// Le source d'une fonction nommée, accolades appariées.
function fonction(src, nom) {
  const debut = src.indexOf(`function ${nom}(`);
  assert.ok(debut >= 0, `« function ${nom}( » doit rester repérable — la règle a été renommée`);
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

// Le corps d'un bloc `@media (…)`, accolades appariées : de quoi vérifier ce
// qu'une règle vaut RÉELLEMENT sur la tablette, et pas seulement qu'elle existe
// quelque part dans les 6 000 lignes de la feuille.
// `aiguille` : la feuille compte SEPT blocs `@media (pointer: coarse)`, écrits
// chacun à côté de ce qu'ils règlent. Prendre le premier venu ferait passer un
// test sur un bloc qui ne parle pas du sujet — on va donc chercher celui qui
// contient RÉELLEMENT la règle qu'on vient éprouver. La borne est l'accolade
// fermante du bloc, jamais le `@media` suivant : entre les deux s'étendent des
// centaines de lignes qui ne lui appartiennent pas.
function bloc(css, condition, aiguille) {
  const marque = `@media ${condition}`;
  for (let i = css.indexOf(marque); i >= 0; i = css.indexOf(marque, i + 1)) {
    const ouvrante = css.indexOf('{', i);
    let profondeur = 0;
    for (let j = ouvrante; j < css.length; j += 1) {
      if (css[j] === '{') profondeur += 1;
      else if (css[j] === '}') {
        profondeur -= 1;
        if (profondeur === 0) {
          const corps = css.slice(ouvrante + 1, j);
          if (!aiguille || corps.includes(aiguille)) return corps;
          break;
        }
      }
    }
  }
  throw new Error(`aucun bloc « ${marque} » ne porte « ${aiguille || '(sans repère)'} »`);
}

// ---------------------------------------------------------------------------
// 1. LE SURVOL NE RESTE PLUS COLLÉ SUR LA TABLETTE
// ---------------------------------------------------------------------------
{
  const sansSurvol = bloc(CSS, '(hover: none)');
  // Les surfaces qu'on TOUCHE toute la journée, et dont un survol resté collé
  // se lit comme un état : la carte du planning et l'étape du rail.
  for (const sel of ['.pcard:hover', '.stage:hover', '.stage.active:hover',
    '.grid tbody tr:hover', '.nav-switch-btn:hover']) {
    assert.ok(sansSurvol.includes(sel + ' '),
      `« ${sel} » doit être neutralisé au doigt — sinon la dernière ligne touchée reste éclairée`);
  }
  // Neutraliser ne veut pas dire aplatir : l'étape ACTIVE garde son fond, sinon
  // le rail ne dirait plus où l'on est dès qu'on a touché une entrée.
  // Depuis la refonte du rail (24/08), le fond d'état est celui de la PHASE
  // (--za, la couleur « actif » de sa palette), plus le gris unique d'avant.
  assert.match(sansSurvol, /\.stage\.active:hover\s*\{\s*background:\s*var\(--za\)/,
    'l’étape active doit garder son fond d’état au doigt');
  assert.match(sansSurvol, /\.grid tbody tr\.row-alt:hover\s*\{\s*background:\s*var\(--row-alt\)/,
    'le zébrage doit survivre à la neutralisation du survol');
}

// ---------------------------------------------------------------------------
// 2. L'APPUI RÉPOND — ET NE SE BAT PAS AVEC LE RÉORDONNANCEMENT
// ---------------------------------------------------------------------------
{
  for (const sel of ['.pcard:active', '.stage:active', '.pcard__open:active',
    '.pcard__ticket:active', '.pcard__del:active', '.pcard__ref-btn:active']) {
    assert.ok(CSS.includes(sel), `« ${sel} » doit exister : sans retour à l’appui, on retape`);
  }
  // LA CARTE NE PORTE PAS DE `transform` À L'APPUI. L'animation de
  // réordonnancement (FLIP) pilote `transform` sur ce même élément : les deux
  // se disputeraient la propriété, et la carte sauterait au lieu de glisser.
  const appuiCarte = CSS.slice(CSS.indexOf('.pcard:active'), CSS.indexOf('.pcard:active') + 220);
  assert.ok(!/transform/.test(appuiCarte.split('}')[0]),
    '.pcard:active ne doit pas poser de `transform` — c’est ce que le FLIP anime');
  // Un doigt qui GLISSE une carte n'appuie pas dessus.
  assert.ok(CSS.includes('body.dragging-active .pcard:active'),
    'l’appui doit se retirer pendant un glisser');
  // Mouvement réduit : l'enfoncement disparaît, la réponse (couleur) reste.
  const reduit = bloc(CSS, '(prefers-reduced-motion: reduce)', '.pcard__open:active');
  assert.ok(/\.pcard__open:active[\s\S]*transform:\s*none/.test(reduit),
    'l’enfoncement doit se retirer sous `prefers-reduced-motion`');
}

// ---------------------------------------------------------------------------
// 3. LA LISTE QU'ON VIENT DE DEMANDER COMMENCE EN HAUT
// ---------------------------------------------------------------------------
{
  const remonter = fonction(APP, 'remonterLaListe');
  assert.match(remonter, /\.grid-wrap/, 'c’est la grille qui défile, pas la page');
  assert.match(remonter, /behavior:\s*'auto'/,
    'défilement instantané : on ne fait pas voyager l’employé à travers une liste qu’il quitte');

  const select = fonction(APP, 'selectStage');
  // LE CHEMIN RAPIDE. Changer de sous-étape ne recharge rien — c'est justement
  // là que la position de défilement restait celle de l'étape précédente.
  const rapide = select.slice(select.indexOf('if (sameFamily'), select.indexOf('// « Tout afficher »'));
  assert.ok(rapide.includes('remonterLaListe()'),
    'le chemin rapide (changement de sous-étape) doit remonter la liste');
  // Et le chemin complet aussi : une relecture forcée ne vide pas la grille,
  // donc rien ne ramènerait le défilement à zéro tout seul.
  assert.match(select, /playStageEnter\(\);\s*\}\s*$|remonterLaListe\(\); playStageEnter\(\)/,
    'le chemin complet doit remonter la liste avant d’animer l’entrée');
  assert.strictEqual((select.match(/remonterLaListe\(\)/g) || []).length, 2,
    'les DEUX chemins de selectStage remontent la liste — pas un seul');
}

// ---------------------------------------------------------------------------
// 4. LA CARTE S'OUVRE QUAND ON LA TOUCHE — SAUF QUAND ON VIENT DE LA GLISSER
// ---------------------------------------------------------------------------
{
  const build = fonction(APP, 'buildCard');
  const ouverture = build.slice(build.indexOf("carte.addEventListener('click'"));
  assert.ok(ouverture.includes('ZONE_CLIQUABLE'),
    'un tap sur un bouton de la carte ne doit pas AUSSI ouvrir la fiche');
  assert.ok(ouverture.includes('glisserVientDeFinir()'),
    'la dépose d’un glisser ne doit pas ouvrir la fiche du dossier qu’on vient de ranger');
  assert.ok(ouverture.includes('openLigneDetail(r.id)'),
    'le corps de la carte ouvre SA fiche');

  // La garde ne se déclenche QUE sur un vrai glisser : un simple clic tombe
  // avant (`if (!ds.active) { … return; }`), sinon plus rien ne s'ouvrirait
  // jamais à la souris.
  const fin = fonction(APP, 'onDragEnd');
  const iRetour = fin.indexOf('if (!ds.active)');
  const iMarque = fin.indexOf('finGlisser = performance.now()');
  assert.ok(iRetour >= 0 && iMarque > iRetour,
    'l’horodatage du glisser doit se poser APRÈS la sortie « simple clic »');
}

// ---------------------------------------------------------------------------
// 5. L'AUTO-DÉFILEMENT DU GLISSER SUIT LE DOIGT
// ---------------------------------------------------------------------------
{
  // La vraie fonction, exécutée : on lui donne une grille de 500 px de haut et
  // on regarde de combien elle fait glisser la liste selon la profondeur du
  // doigt dans la marge.
  const src = [
    APP.slice(APP.indexOf('const DEFILEMENT_MIN'), APP.indexOf('function autoScroll(')),
    fonction(APP, 'autoScroll'),
  ].join('\n');
  // Un vrai conteneur BORNE son `scrollTop` : c'est ce qui fait qu'en butée la
  // fonction peut répondre « rien n'a bougé ». Un objet nu accepterait -26 et le
  // test passerait sur une fiction.
  const wrap = {
    _y: 4000,
    get scrollTop() { return this._y; },
    set scrollTop(v) { this._y = Math.max(0, Math.min(8000, v)); },
    getBoundingClientRect: () => ({ top: 100, bottom: 600 }),
  };
  const bac = { dragState: { wrap }, document: { querySelector: () => wrap }, Math };
  vm.createContext(bac);
  vm.runInContext(`${src}\nthis.autoScroll = autoScroll;`, bac);

  const pas = (y) => { wrap.scrollTop = 4000; bac.autoScroll(y); return wrap.scrollTop - 4000; };

  // Bas de la grille : marge = 72 px, donc elle commence à 528.
  const effleure = pas(534);   // à peine entré dans la marge
  const appuye = pas(598);     // doigt collé au bord
  assert.ok(effleure > 0 && effleure <= 8,
    `effleurer le bord doit faire glisser d’un cran (obtenu : ${effleure} px)`);
  assert.ok(appuye >= 24,
    `doigt collé au bord, la liste doit filer (obtenu : ${appuye} px)`);
  assert.ok(appuye > effleure * 3,
    'la vitesse doit vraiment suivre le doigt, pas varier à la marge');

  // Symétrique vers le haut, et RIEN au milieu : une carte lâchée au centre de
  // l’écran ne doit pas voir la liste partir toute seule sous elle.
  assert.ok(pas(106) <= -24, 'le bord HAUT doit défiler aussi vite que le bas');
  assert.strictEqual(pas(350), 0, 'au centre de la grille, rien ne défile');

  // Butée : arrivé en haut, la fonction doit dire que plus rien ne bouge —
  // c'est ce qui évite de recalculer la cible de dépose à chaque image.
  wrap.scrollTop = 0;
  assert.strictEqual(bac.autoScroll(106), false, 'en butée haute, autoScroll renvoie faux');
}

// ---------------------------------------------------------------------------
// 6. GARDE-FOU — NE PAS REPOSER CE QUI EST DÉJÀ FAIT PLUS HAUT
// ---------------------------------------------------------------------------
{
  // `dupliquer` / `supprimer` / `envoyer vers Fiverr` naissent invisibles et ne
  // se révèlent qu'au survol de leur ligne. Le bloc tactile les forçait visibles
  // au doigt ; il a été retiré le 25/08 (projet PC uniquement depuis le 21/08).
  // RESTE DONC UNE SEULE AUTRE PORTE : le clavier. Sans elle, trois actions
  // deviennent inatteignables pour qui tabule — et « supprimer » en fait partie.
  assert.ok(!/@media \(pointer: coarse\)/.test(CSS),
    'les règles tactiles ne doivent pas revenir : le poste est un PC');
  assert.match(CSS,
    /\.send-btn:focus-visible,\s*\.del-btn:focus-visible,\s*\.dup-btn:focus-visible \{[^}]*opacity:\s*1/,
    'le clavier révèle ces boutons : c’est la seule autre porte que le survol');
  assert.match(CSS,
    /\.send-btn:focus-visible,\s*\.del-btn:focus-visible,\s*\.dup-btn:focus-visible \{[^}]*pointer-events:\s*auto/,
    '… et ils redeviennent cliquables avec, pas seulement visibles');
}

// ---------------------------------------------------------------------------
// 6b. LE RAIL MONTRE OÙ L'ON EST, MÊME QUAND ON N'Y A PAS CLIQUÉ
// ---------------------------------------------------------------------------
{
  const montrer = fonction(APP, 'montrerEtapeActive');
  assert.match(montrer, /block:\s*'nearest'/,
    'le plus petit déplacement : une étape déjà visible ne doit pas faire bouger le rail');
  assert.ok(montrer.includes('if (dragState) return;'),
    'le rail ne coulisse JAMAIS pendant un glisser : ses entrées sont les cibles de dépose');
  assert.match(montrer, /mouvementReduit\(\)\s*\?\s*'auto'\s*:\s*'smooth'/,
    'le défilement du rail respecte prefers-reduced-motion');

  // La surbrillance et le défilement partent du MÊME endroit : sans ça, on
  // repeindrait l'entrée active sans jamais l'amener à l'écran.
  const peindre = fonction(APP, 'paintSidebarActive');
  assert.ok(peindre.includes('montrerEtapeActive(active)'),
    'paintSidebarActive doit amener l’entrée qu’elle vient d’allumer sous les yeux');
}

// ---------------------------------------------------------------------------
// 7. LA CARTE SE DÉCROCHE — ET ON LE SENT
// ---------------------------------------------------------------------------
{
  const begin = fonction(APP, 'beginDrag');
  assert.ok(begin.includes('navigator.vibrate'),
    'un tic au décrochage : au doigt, le fantôme naît CACHÉ par le doigt lui-même');
  assert.match(begin, /if \(navigator\.vibrate\)/,
    'l’appel doit être facultatif — iOS et la plupart des ordinateurs ne l’ont pas');
  assert.match(begin, /navigator\.vibrate\(\d{1,2}\)/,
    'un TIC, pas une sonnerie : quelques millisecondes');
}

console.log('✓ planning tactile : survol non collé, appui qui répond, liste en haut, carte qui s’ouvre, défilement qui suit le doigt, rail qui se montre');
