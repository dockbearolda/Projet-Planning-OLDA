'use strict';

// ===========================================================================
// LA COQUILLE HORS LIGNE NE PERD PERSONNE EN ROUTE (27/08/2026)
// ===========================================================================
// `sw.js` porte la liste des fichiers mis en cache à l'installation. Un module
// importé STATIQUEMENT par une page de cette liste et absent du cache ne coûte
// pas cette fonction-là : son import échoue, et c'est la page ENTIÈRE qui ne
// s'ouvre plus hors ligne. C'est la panne la plus chère du dépôt, et elle ne
// se voit jamais en développement — le réseau est toujours là.
//
// LA LISTE SE TENAIT À LA MAIN, avec un commentaire par fichier expliquant
// pourquoi il y était. Ces commentaires restent : ils disent le POURQUOI. Ce
// qui manquait, c'est ce qui dit qu'on n'a rien oublié — et le 27/08, en
// sortant la feuille des deux écrans du comptoir et deux modules de `app.js`,
// QUATRE fichiers sont entrés dans l'application sans entrer dans la coquille.
//
// On ne relit donc plus la liste : on suit les imports depuis les pages de la
// coquille, et on compare. Ce test ne connaît aucun nom de fichier par cœur.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const PUBLIC = path.join(RACINE, 'public');
const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8');

const SW = lire('public/sw.js');

// La liste, telle qu'elle est écrite. LES COMMENTAIRES PARTENT D'ABORD : ils
// disent pourquoi chaque fichier est là, en français, et « l'import » y met une
// apostrophe droite. Lue telle quelle, la liste perdait six entrées bien
// présentes — deux apostrophes de commentaire faisaient une fausse chaîne qui
// avalait le nom suivant.
const bloc = SW.match(/const COQUILLE = \[([\s\S]*?)\n\];/);
assert.ok(bloc, 'la coquille doit rester repérable dans sw.js');
const COQUILLE = new Set(
  [...bloc[1].replace(/^\s*\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((m) => m[1]),
);
assert.ok(COQUILLE.size > 10, 'la coquille doit contenir de quoi ouvrir l’application');

// --- Ce qu'un fichier tire derrière lui ------------------------------------
//
// UNIQUEMENT LES IMPORTS STATIQUES. Un `import()` dynamique échoue tout seul,
// dans son coin, et ne coûte que la fonction qu'il sert : `montravail.js` est
// volontairement hors coquille. Un `import … from` en tête de fichier, lui,
// empêche le module de s'évaluer — donc la page de ne pas s'ouvrir.
const RE_IMPORT = /^\s*import\s(?:[\s\S]*?\sfrom\s)?['"]([^'"]+)['"]/gm;
// Et ce qu'une page charge d'elle-même : sa feuille, ses scripts non modules.
const RE_CSS = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g;
const RE_SCRIPT = /<script[^>]+src="([^"]+)"/g;

const sansComs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

// Une adresse relative, résolue depuis le fichier qui l'écrit, rendue sous la
// forme que la coquille emploie : « /comptoir/pont.js ».
function resoudre(depuis, cible) {
  if (/^https?:|^data:|^#/.test(cible)) return null;
  const abs = path.resolve(path.dirname(path.join(PUBLIC, depuis)), cible);
  if (!abs.startsWith(PUBLIC + path.sep)) return null;
  return `/${path.relative(PUBLIC, abs).split(path.sep).join('/')}`;
}

// --- On part des pages de la coquille et on suit ---------------------------
const aVoir = [...COQUILLE].filter((u) => /\.(html|js)$/.test(u)).map((u) => u.slice(1));
// « / » est index.html : c'est par là que tout commence.
if (COQUILLE.has('/')) aVoir.push('index.html');

const vus = new Set();
const manquants = [];

while (aVoir.length) {
  const rel = aVoir.pop();
  if (vus.has(rel)) continue;
  vus.add(rel);
  const chemin = path.join(PUBLIC, rel);
  if (!fs.existsSync(chemin)) continue;          // une entrée morte se dit ailleurs
  const src = sansComs(fs.readFileSync(chemin, 'utf8'));

  const tirees = [];
  if (rel.endsWith('.js')) {
    for (const m of src.matchAll(RE_IMPORT)) tirees.push([m[1], 'import statique']);
  } else if (rel.endsWith('.html')) {
    for (const m of src.matchAll(RE_CSS)) tirees.push([m[1], 'feuille de style']);
    for (const m of src.matchAll(RE_SCRIPT)) tirees.push([m[1], 'script']);
    // Les modules d'une page se suivent aussi : `<script type="module">import …`
    for (const m of src.matchAll(RE_IMPORT)) tirees.push([m[1], 'import statique']);
  }

  for (const [cible, quoi] of tirees) {
    const url = resoudre(rel, cible);
    if (!url) continue;
    if (!fs.existsSync(path.join(PUBLIC, url.slice(1)))) continue;  // pas un fichier à nous
    if (!COQUILLE.has(url)) manquants.push(`${url} — ${quoi} de /${rel}`);
    if (/\.(html|js)$/.test(url)) aVoir.push(url.slice(1));
  }
}

assert.deepStrictEqual(manquants, [],
  'des fichiers entrent dans l’application sans entrer dans la coquille :\n  '
  + manquants.join('\n  ')
  + '\n  → hors ligne, la page qui les tire ne s’ouvre pas du tout.');

// --- Et l'inverse : une entrée qui ne pointe sur rien ----------------------
// Un fichier renommé laisse son ancien nom dans la liste. `cache.add` échoue
// alors sur cette entrée — l'installation est écrite pour survivre à ça (elle
// compte les manquants au lieu de tout annuler), mais une coquille qui rate
// une entrée à chaque installation ne se distingue plus d'une qui en rate une
// pour de bon.
const morts = [...COQUILLE].filter((u) => u !== '/' && !fs.existsSync(path.join(PUBLIC, u.slice(1))));
assert.deepStrictEqual(morts, [],
  'la coquille demande des fichiers qui n’existent pas : ' + morts.join(', '));

console.log(`✓ coquille : ${COQUILLE.size} entrées, tout ce qui s’importe statiquement y est`);
