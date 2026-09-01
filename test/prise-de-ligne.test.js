'use strict';

// ON ATTRAPE UNE LIGNE PAR LES SIX POINTS (01/09/2026)
// ===========================================================================
// Charlie : « il y a un bug qui fait qu'il est difficile d'attraper une ligne
// à gauche (sur les 6 petits points) pour la déplacer dans la bonne ligne. »
//
// Ce n'était pas « difficile », c'était IMPOSSIBLE — et la mesure le dit mieux
// que le ressenti : viser le centre du pictogramme ne déplaçait jamais rien,
// viser 3 px à côté déplaçait la ligne du premier coup.
//
// LA CAUSE. Le 28/08, la ligne du tableau est devenue cliquable (un clic ouvre
// sa fiche). Pour qu'attraper la poignée n'ouvre pas le dossier, `.handle` est
// entré dans `ZONE_CLIQUABLE`. Mais cette liste servait DEUX gestes à la fois :
// « ce clic n'ouvre pas la fiche » ET « cet appui n'est pas une prise ». Le
// second l'a donc refusée aussi. Appuyer sur les six points vise le `<svg>` du
// pictogramme — un élément qui n'EST pas la poignée, mais dont
// `closest('.handle')` la trouve : la garde « ce n'est pas une prise » se
// déclenchait sur la prise elle-même. Restaient les 4 px de marge autour du
// dessin, seul endroit où le glisser répondait encore.
//
// CE QUE CE FICHIER TIENT. Pas l'orthographe d'une liste : le GESTE. Il exécute
// le vrai `attachDrag`, découpé dans `public/app.js`, sur un document minuscule
// — une ligne, sa cellule, sa poignée, le pictogramme dedans — et il appuie sur
// le pictogramme. Une garde qui relirait le source aurait laissé passer le bug
// d'origine : le source était juste, c'est la LISTE qu'il consultait qui ne
// l'était pas.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
// Le fichier à éprouver peut être imposé : c'est ainsi qu'on vérifie qu'un
// contrôle échoue bien sur la version d'AVANT le correctif.
const CHEMIN_APP = process.env.APP_JS || path.join(RACINE, 'public/app.js');
const APP = fs.readFileSync(CHEMIN_APP, 'utf8');
const CSS = fs.readFileSync(path.join(RACINE, 'public/styles.css'), 'utf8');

// Le source d'une fonction nommée, accolades appariées (même utilitaire que
// test/tactile-planning.test.js).
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

// --- UN DOCUMENT MINUSCULE -------------------------------------------------
// Juste ce qu'`attachDrag` touche. `closest` y comprend les quatre formes que
// les deux listes emploient : un nom de balise, une classe, `[role="button"]`,
// et la liste séparée par des virgules.
const correspond = (n, selecteur) => selecteur.split(',').map((s) => s.trim()).some((t) => (
  t.startsWith('.') ? n.classes.has(t.slice(1))
    : t === '[role="button"]' ? n.role === 'button'
      : t.toUpperCase() === n.tagName));

function element(tag, { classe = '', role = null, parent = null } = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    classes: new Set(classe ? classe.split(' ') : []),
    role,
    parent,
    ecoutes: {},
    captures: 0,
    classList: {
      add: (c) => el.classes.add(c),
      remove: (c) => el.classes.delete(c),
      contains: (c) => el.classes.has(c),
      toggle: () => {},
    },
    addEventListener: (t, fn) => { el.ecoutes[t] = fn; },
    setPointerCapture: () => { el.captures += 1; },
    releasePointerCapture: () => {},
    closest(selecteur) {
      for (let n = el; n; n = n.parent) if (correspond(n, selecteur)) return n;
      return null;
    },
  };
  return el;
}

// --- LE VRAI `attachDrag`, EXÉCUTÉ -----------------------------------------
function monterPrise() {
  const zones = APP.match(/const ZONE_(SANS_PRISE|CLIQUABLE) = [\s\S]*?const ZONE_CLIQUABLE = [^;]+;/)
    || APP.match(/const ZONE_CLIQUABLE = [^;]+;/);
  assert.ok(zones, 'les listes de sélecteurs restent repérables');
  const src = [
    'let dragState = null;',
    'const onDragMove = () => {}; const onDragEnd = () => {};',
    'const toucheGlisser = () => {}; const annulerGlisser = () => {};',
    'const poses = [];',
    'const window = { addEventListener: (t) => poses.push(t), removeEventListener: () => {} };',
    zones[0],
    fonction(APP, 'attachDrag'),
    '({ attachDrag, poses, etat: () => dragState })',
  ].join('\n');
  return vm.runInNewContext(src);
}

const appui = (cible, extra = {}) => ({
  pointerType: 'mouse',
  button: 0,
  target: cible,
  clientX: 120,
  clientY: 340,
  pointerId: 1,
  preventDefault: () => {},
  ...extra,
});

// ---------------------------------------------------------------------------
// 1. LE PICTOGRAMME EST LA PRISE — c'est le bug, et c'est la seule chose qui
//    compte : on vise les six points parce qu'ils sont dessinés là pour ça.
// ---------------------------------------------------------------------------
{
  const { attachDrag, etat } = monterPrise();
  const tr = element('tr');
  const td = element('td', { classe: 'col-handle', parent: tr });
  const poignee = element('div', { classe: 'handle', parent: td });
  const points = element('svg', { parent: poignee }); // les six points
  attachDrag(poignee, tr, { id: 'ligne-1' });

  poignee.ecoutes.pointerdown(appui(points));
  assert.ok(etat(), 'appuyer SUR LES SIX POINTS doit prendre la ligne');
  assert.ok(tr.classes.has('prise-en-cours'),
    '… et la ligne est marquée « prise » dès l’appui, avant même le seuil');
  assert.strictEqual(etat().tr, tr, '… et c’est bien SA ligne qui est prise');
}

// ---------------------------------------------------------------------------
// 2. LA POIGNÉE ELLE-MÊME AUSSI — la marge autour du dessin ne perd rien.
// ---------------------------------------------------------------------------
{
  const { attachDrag, etat } = monterPrise();
  const tr = element('tr');
  const poignee = element('div', { classe: 'handle', parent: tr });
  attachDrag(poignee, tr, { id: 'ligne-2' });
  poignee.ecoutes.pointerdown(appui(poignee));
  assert.ok(etat(), 'appuyer sur la poignée elle-même prend la ligne');
}

// ---------------------------------------------------------------------------
// 3. UN VRAI CONTRÔLE N'EST TOUJOURS PAS UNE PRISE. C'est la raison d'être de
//    la garde : sur une CARTE, toute la surface est saisissable — ses boutons
//    (référent, supprimer) doivent rester cliquables.
// ---------------------------------------------------------------------------
for (const [tag, options, quoi] of [
  ['button', {}, 'un bouton'],
  ['input', {}, 'un champ'],
  ['div', { role: 'button' }, 'une fausse commande (role=button)'],
]) {
  const { attachDrag, etat } = monterPrise();
  const carte = element('article', { classe: 'pcard' });
  const commande = element(tag, { ...options, parent: carte });
  attachDrag(carte, carte, { id: 'carte-1' });
  carte.ecoutes.pointerdown(appui(commande));
  assert.strictEqual(etat(), null, `${quoi} posé sur une carte n’est pas une prise`);
  assert.ok(!carte.classes.has('prise-en-cours'),
    `… et la carte ne se marque pas « prise » pour ${quoi}`);
}

// ---------------------------------------------------------------------------
// 4. LES DEUX LISTES DISENT DEUX CHOSES DIFFÉRENTES
// ---------------------------------------------------------------------------
{
  const src = APP.match(/const ZONE_SANS_PRISE = [\s\S]*?const ZONE_CLIQUABLE = [^;]+;/);
  assert.ok(src, 'la liste du glisser et celle du clic sont deux constantes');
  const zones = vm.runInNewContext(`${src[0]}\n({ ZONE_SANS_PRISE, ZONE_CLIQUABLE })`);
  assert.ok(!zones.ZONE_SANS_PRISE.includes('.handle'),
    'la poignée n’est PAS dans la liste du glisser : elle EST la prise');
  assert.ok(zones.ZONE_CLIQUABLE.includes('.handle'),
    '… et elle EST dans celle du clic : l’attraper n’ouvre pas la fiche');
  // La seconde se construit sur la première : deux littéraux qui se ressemblent
  // redeviennent deux listes le jour où l'une bouge.
  assert.match(APP, /const ZONE_CLIQUABLE = `\$\{ZONE_SANS_PRISE\}[^`]*`;/,
    'la liste du clic se construit sur celle du glisser, elle ne se recopie pas');
}

// ---------------------------------------------------------------------------
// 5. LA ZONE DE PRISE REMPLIT SA CELLULE
// ---------------------------------------------------------------------------
// Elle mesurait 28 px de large dans une colonne de 44, et `--row-h` de haut
// dans une cellule qui grandit avec son contenu : 8 px de vide inerte à gauche,
// 8 à droite, jusqu'à 18 en bas. On vise la colonne, pas un dessin de 20 px.
{
  const cssNu = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const regle = cssNu.match(/\n\.handle\s*\{([^}]*)\}/);
  assert.ok(regle, 'la poignée garde sa règle');
  assert.match(regle[1], /width:\s*100%/, 'la poignée prend toute la largeur de sa cellule');
  assert.match(regle[1], /height:\s*100%/, '… et toute sa hauteur, y compris sur une ligne haute');
  assert.match(regle[1], /min-height:\s*var\(--row-h\)/,
    '… avec un plancher en JETON, jamais un nombre');
  assert.ok(!/28px/.test(regle[1]), 'plus aucune largeur en dur : c’est la colonne qui décide');
  // Le nom survit dans les commentaires — c'est là qu'on explique pourquoi il
  // est parti. Ce qui doit avoir disparu, c'est la boîte : plus personne ne la
  // pose, plus personne ne l'habille.
  assert.ok(!/\.handle-cell\s*[,{]/.test(cssNu) && !/'handle-cell'/.test(APP),
    'la boîte qui enveloppait la poignée servait un second contenu retiré depuis');
}

// ---------------------------------------------------------------------------
// 6. L'ÉTIQUETTE NE MASQUE PAS CE QU'ON VISE
// ---------------------------------------------------------------------------
// Le fantôme prenait la LARGEUR DE LA LIGNE (1 308 px mesurés) et se posait
// sous le curseur : il recouvrait la ligne visée, débordait sur le panneau des
// colonnes et sortait de la fenêtre. On ne voyait plus où l'on déposait.
{
  const begin = fonction(APP, 'beginDrag');
  assert.ok(!/ghost\.style\.width/.test(begin),
    'l’étiquette se dimensionne sur son texte, pas sur la largeur de la ligne');
  const move = fonction(APP, 'onDragMove');
  assert.match(move, /translate\(14px, -50%\)/,
    'elle se pose À CÔTÉ du curseur, jamais dessous : on regarde la ligne visée');
  const cssNu = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const regle = cssNu.match(/\n\.drag-ghost\s*\{([^}]*)\}/);
  assert.ok(regle && /max-width:\s*\d+px/.test(regle[1]),
    '… et elle reste bornée : un nom de dossier long ne barre pas l’écran');
  assert.match(regle[1], /pointer-events:\s*none/,
    '… sans jamais intercepter le hit-test qui calcule la dépose');
}

// ---------------------------------------------------------------------------
// 7. UN GESTE LÂCHÉ SE RELÂCHE VRAIMENT — Windows sert les trois cas
// ---------------------------------------------------------------------------
// Échap (on s'aperçoit qu'on tient la mauvaise ligne), Alt+Tab qui emporte la
// fenêtre, le clic droit qui pose le menu du système par-dessus : aucun n'émet
// de `pointerup`. Sans sortie, l'étiquette restait collée à l'écran et la ligne
// figée en transparence jusqu'au rechargement.
{
  const prise = fonction(APP, 'attachDrag');
  const relache = fonction(APP, 'relacherGlisser');
  const poses = [...prise.matchAll(/window\.addEventListener\('([^']+)'/g)].map((m) => m[1]);
  const rendus = [...relache.matchAll(/window\.removeEventListener\('([^']+)'/g)].map((m) => m[1]);
  for (const t of ['keydown', 'blur', 'contextmenu']) {
    assert.ok(poses.includes(t), `le geste écoute « ${t} » : c’est une sortie sans dépose`);
  }
  assert.deepStrictEqual([...poses].sort(), [...rendus].sort(),
    'CHAQUE écouteur posé à la prise est retiré au relâchement — pas un de plus, pas un de moins');
  const annule = fonction(APP, 'annulerGlisser');
  assert.match(annule, /finGlisser = performance\.now\(\)/,
    'un geste abandonné n’ouvre pas la fiche au relâchement du bouton');
  assert.match(annule, /applySortAndRender\(\)/,
    '… et la grille reprend l’ordre qu’elle avait : rien ne se dépose');
  const touche = fonction(APP, 'toucheGlisser');
  assert.match(touche, /e\.stopPropagation\(\)/,
    'Échap sert d’abord le geste en cours : la fiche et le calendrier passent après');
  assert.match(prise, /window\.addEventListener\('keydown', toucheGlisser, true\)/,
    '… et il l’écoute en CAPTURE, sinon un autre Échap le devance');
}

console.log('✓ prise de ligne : on attrape par les six points, la colonne entière prend, '
  + 'l’étiquette ne masque rien, et un geste lâché se relâche');
