'use strict';

// UN NOM D'ICÔNE ABSENT DE LA POLICE NE LÈVE RIEN (29/08/2026)
// ===========================================================================
// La police d'icônes est un sous-ensemble auto-hébergé — pas la fonte complète
// de Google. Elle porte EXACTEMENT 91 ligatures. Écrire `local_shipping` dans
// un `<span class="material-symbols-outlined">` ne provoque aucune erreur :
// le navigateur ne trouve pas la ligature, garde le texte, et
// `.material-symbols-outlined { width: 1em; overflow: hidden }` le coupe à la
// première lettre. La carte affiche le début d'un « l » à la place d'un camion.
//
// C'EST DÉJÀ ARRIVÉ TROIS FOIS :
//   · `print` / `download` / `content_copy` / `send` sur la barre de la fiche —
//     quatre boutons qui disaient « p », « d », « c », « s ». Ils sont DESSINÉS
//     depuis (LD_ICONES, app.js) ;
//   · `mail`, qui affichait « mailEmail » à côté de son libellé ;
//   · `drag_indicator` (panneau « Colonnes ») et `local_shipping` (carte
//     Transport des Réglages), trouvés le 29/08 en mesurant au rendu — 280 px
//     de contenu dans une boîte de 20.
//
// Aucun de ces trois n'a été vu en relisant le code : le nom est plausible, la
// règle CSS est correcte, et l'écran ne signale rien. Seule la POLICE sait.
// D'où ce fichier.
//
// COMMENT LA LISTE A ÉTÉ ÉTABLIE — depuis le binaire, pas depuis une mémoire :
//
//   python3 - <<'PY'
//   from fontTools.ttLib import TTFont
//   f = TTFont('public/olda-icones.woff2')
//   cmap = f.getBestCmap(); rev = {}
//   for cp, gn in cmap.items(): rev.setdefault(gn, chr(cp))
//   noms = set()
//   for lu in f['GSUB'].table.LookupList.Lookup:
//       for st in lu.SubTable:
//           sub = getattr(st, 'ExtSubTable', st)
//           for first, arr in (getattr(sub, 'ligatures', None) or {}).items():
//               for lig in arr:
//                   noms.add(rev[first] + ''.join(rev[c] for c in lig.Component))
//   print(len(noms)); print(' '.join(sorted(noms)))
//   PY
//
// À REJOUER si la police est régénérée — c'est le seul cas où cette liste bouge.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');

const POLICE = new Set(('add apartment arrow_forward badge block bolt call chat check check_box '
  + 'check_box_outline_blank chevron_right clear close contacts dark_mode dashboard delete '
  + 'delete_outline diversity_3 do_disturb do_not_disturb_alt draw email event expand_more '
  + 'flight_takeoff fmd_good free_breakfast fullscreen fullscreen_exit gavel grid_view groups '
  + 'help help_outline home_pin https insert_invitation launch light_mode local_cafe '
  + 'local_grocery_store local_phone location_city location_on location_pin lock lock_outline '
  + 'login logout mail mail_outline markunread markunread_mailbox message navigate_next '
  + 'not_interested open_in_new overview pause_circle pause_circle_filled pause_circle_outline '
  + 'perm_identity person person_filled person_outline phone phone_alt place playlist_play '
  + 'point_of_sale precision_manufacturing public receipt_long remove_red_eye request_quote '
  + 'right_panel_close room search settings shopping_cart storefront tag tune view_column '
  + 'view_kanban visibility visibility_off work work_outline').split(' '));

assert.strictEqual(POLICE.size, 91, 'la police porte 91 ligatures — pas une de plus');

// ---------------------------------------------------------------------------
// 1. QUI FABRIQUE UNE ICÔNE
// ---------------------------------------------------------------------------
// Une feuille de style ne fabrique rien : elle ne fait que styler la classe.
// Un fichier qui construit des icônes DOIT figurer ici, et l'extracteur du
// paragraphe 2 doit connaître sa façon de poser le nom. Sans cette garde, un
// nouvel écran poserait ses icônes sans que rien ne les contrôle — et on
// n'aurait aucun moyen de s'en apercevoir, puisque l'échec est muet.
const FABRIQUES = [
  'public/app.js',
  'public/clients.js',
  'public/dashboard.js',
  // La fiche atelier depuis le 29/08 : son menu des faces porte les deux cases
  // a cocher du panneau « Colonnes » et le « + » de la creation.
  'public/fiche-atelier.js',
  'public/index.html',
  'public/nouveau-projet.js',
  'public/reglages.js',
  // `public/tailles-logos.js` est sorti de cette liste le 30/08 : sa seule
  // icone etait celle de son en-tete maison, et l'en-tete de la charte n'en
  // porte pas — la barre du haut dit deja sur quel ecran on est.
];

const balaye = (dir) => fs.readdirSync(path.join(RACINE, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? balaye(path.join(dir, e.name)) : [path.join(dir, e.name)]));

const porteurs = balaye('public')
  .filter((f) => /\.(js|html)$/.test(f) && !path.basename(f).startsWith('_'))
  .filter((f) => lire(f).includes('material-symbols-outlined'))
  .sort();

assert.deepStrictEqual(porteurs, FABRIQUES,
  'un fichier de plus (ou de moins) pose des icônes : ajoute-le à FABRIQUES ET à l’extracteur');

// ---------------------------------------------------------------------------
// 2. TOUS LES NOMS POSÉS, ET D'OÙ ILS VIENNENT
// ---------------------------------------------------------------------------
// Quatre formes, ce sont les seules en service :
//   a. le gabarit de la coquille — `<span class="material-symbols-…">nom</span>`
//   b. les fabriques `ic('nom')` / `icon('nom')` / `icone('nom')`
//   c. une table de données — `icone: 'nom'` (les deux parcours du comptoir)
//   d. un `textContent` posé sur un span qu'on vient de classer, y compris en
//      ternaire (`col.locked ? 'lock' : on ? 'check_box' : '…'`)
//
// ⚠ ET LES ENVELOPPES. Le nom ne va pas toujours DIRECTEMENT à la fabrique :
// `carteSimple('flight_takeoff', …)` le transmet. C'est par ce trou que
// `local_shipping` est passé sous le premier jet de ce contrôle — la ligne
// fautive était bien dans le fichier, l'extracteur ne la lisait pas. Les
// enveloppes sont donc RECENSÉES (ENVELOPPES ci-dessous) et le paragraphe 2 bis
// vérifie qu'il n'en existe pas une de plus.
const ENVELOPPES = ['carteSimple'];

function nomsDe(fichier) {
  const src = lire(fichier);
  const trouves = new Set();
  const ajoute = (re, groupe = 1) => {
    for (const m of src.matchAll(re)) trouves.add(m[groupe]);
  };
  // a
  ajoute(/class="material-symbols-outlined[^"]*"[^>]*>([a-z0-9_]+)</g);
  // b + enveloppes
  ajoute(new RegExp(`\\b(?:ic|icon|icone|${ENVELOPPES.join('|')})\\(\\s*'([a-z0-9_]+)'`, 'g'));
  // c
  ajoute(/\bicone:\s*'([a-z0-9_]+)'/g);
  // d — on part de CHAQUE pose de la classe et on lit l'affectation qui suit.
  //     La fenêtre est large : entre les deux, il y a souvent `aria-hidden`.
  for (const m of src.matchAll(/material-symbols-outlined/g)) {
    const suite = src.slice(m.index, m.index + 320);
    const aff = suite.match(/\.textContent\s*=\s*([^;\n]+)/);
    if (!aff) continue;
    // Un ternaire porte des noms d'icônes DANS SES BRANCHES et des valeurs de
    // comparaison dans sa CONDITION (`t === 'dark' ? 'light_mode' : 'dark_mode'`).
    // Les secondes ne sont pas des icônes : on retire les opérandes de test
    // avant de lire les littéraux, sinon le contrôle signale « dark » absent de
    // la police — vrai, et sans le moindre rapport.
    const valeurs = aff[1].replace(/[=!]==?\s*'[^']*'/g, '');
    for (const lit of valeurs.matchAll(/'([a-z0-9_]+)'/g)) trouves.add(lit[1]);
  }
  return trouves;
}

// --- 2 bis. AUCUNE ENVELOPPE DE PLUS ---------------------------------------
// Une fonction qui reçoit un nom d'icône en paramètre et le passe à une
// fabrique est une enveloppe : les noms qu'on lui donne n'atteignent aucune des
// quatre formes ci-dessus, et ne seraient donc jamais contrôlés. On les repère
// à la source — une fabrique appelée avec l'un des PARAMÈTRES de la fonction
// qui l'entoure — et on exige que la liste soit à jour.
function enveloppesDe(src) {
  const vues = new Set();
  const entetes = [
    /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g,          // function nom(a, b) {
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\(([^)]*)\)\s*=>/g, // const nom = (a, b) =>
  ];
  for (const re of entetes) {
    for (const m of src.matchAll(re)) {
      const params = m[2].split(',').map((p) => p.trim().split('=')[0].trim()).filter(Boolean);
      if (!params.length) continue;
      const corps = src.slice(m.index + m[0].length, m.index + m[0].length + 2500);
      for (const appel of corps.matchAll(/\b(?:ic|icon|icone)\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
        if (params.includes(appel[1])) { vues.add(m[1]); break; }
      }
    }
  }
  return vues;
}
const enveloppes = new Set(FABRIQUES.flatMap((f) => [...enveloppesDe(lire(f))]));
assert.deepStrictEqual([...enveloppes].sort(), [...ENVELOPPES].sort(),
  'une fonction transmet un nom d’icône sans passer par les formes contrôlées : '
  + 'ajoute-la à ENVELOPPES, sinon ses noms ne sont vérifiés par personne');

const parFichier = new Map(FABRIQUES.map((f) => [f, nomsDe(f)]));
const tous = new Set([...parFichier.values()].flatMap((s) => [...s]));

// L'EXTRACTEUR DOIT TROUVER QUELQUE CHOSE. Une expression régulière cassée rend
// un ensemble vide, et un ensemble vide passe tous les contrôles du monde.
assert.ok(tous.size >= 30,
  `l’extracteur ne trouve que ${tous.size} noms : il ne lit plus le code`);
for (const [f, noms] of parFichier) {
  assert.ok(noms.size > 0, `${f} pose des icônes mais l’extracteur n’en tire aucun nom`);
}

// ---------------------------------------------------------------------------
// 3. CHAQUE NOM EXISTE DANS LA POLICE
// ---------------------------------------------------------------------------
const absents = [];
for (const [f, noms] of parFichier) {
  for (const n of noms) if (!POLICE.has(n)) absents.push(`${f} → « ${n} »`);
}
assert.deepStrictEqual(absents, [],
  'ces noms ne sont pas dans la police : ils s’afficheront EN TEXTE, coupés à la première lettre\n  '
  + absents.join('\n  '));

// ---------------------------------------------------------------------------
// 4. CE QUI EST DESSINÉ RESTE DESSINÉ
// ---------------------------------------------------------------------------
// Les quatre glyphes retirés de la barre de la fiche, plus le courriel, plus la
// poignée de glisser : ils sont au trait dans le code. Si l'un redevenait un
// nom de glyphe, le paragraphe 3 l'attraperait — mais autant dire ici pourquoi
// ils sont dessinés, à l'endroit où on viendrait « simplifier ».
const APP = lire('public/app.js');
for (const cle of ['imprimer', 'telecharger', 'dupliquer', 'envoyer', 'mail']) {
  assert.ok(new RegExp(`\\b${cle}:\\s*\\[`).test(APP),
    `« ${cle} » doit rester DESSINÉ : la police ne le porte pas`);
}
// LA POIGNÉE DE GLISSER EST LE MÊME DESSIN AUX TROIS ENDROITS où l'on saisit
// quelque chose — la ligne du tableau, la carte du planning, la rangée du
// panneau « Colonnes ». C'est `drag_indicator` qui manquait au troisième.
assert.match(APP, /function gripIcon\(\)/, 'le dessin des six points existe une fois');
assert.strictEqual((APP.match(/\.appendChild\(gripIcon\(\)\)/g) || []).length, 3,
  'et il sert aux TROIS prises : ligne du tableau, carte du planning, rangée des colonnes');
const CSS = lire('public/styles.css');
assert.match(CSS, /\.handle svg,\s*\n\.pcard__handle svg,\s*\n\.colbar-item__grip svg \{ width: var\(--ic\); height: var\(--ic\); \}/,
  '… et UNE seule règle lui donne sa boîte : elle s’écrivait 18 px deux fois');

console.log('✓ police d’icônes : 91 ligatures, et aucun nom posé qui n’y soit');
