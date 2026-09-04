'use strict';

// LE JAVASCRIPT SERVI AUX POSTES DOIT AU MOINS S'ANALYSER (21/08/2026)
//
// Aucun build sur ce projet : les fichiers de `public/` partent tels quels.
// Personne ne les compile, donc personne ne dit qu'ils sont cassés — une
// simple parenthèse en trop, et le poste ouvre un écran qui a l'air normal
// mais dont la moitié ne répond plus. Le jour où ce garde-fou a été écrit,
// une accent grave posée dans un COMMENTAIRE de `pont.js` refermait le texte
// à rallonge qui porte la feuille de style du composant : les menus des deux
// écrans du comptoir redevenaient des listes brutes, sans une erreur visible
// nulle part.
//
// On ne juge rien d'autre ici que la syntaxe : le fichier s'analyse, ou non.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RACINE = path.join(__dirname, '..');
const PUBLIC = path.join(RACINE, 'public');

function fichiers(dossier, ext) {
  return fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) return fichiers(p, ext);
    return e.name.endsWith(ext) ? [p] : [];
  });
}

// `node --check` analyse sans exécuter. Le mode compte : un module et un
// script n'ont pas la même grammaire, et analyser l'un pour l'autre invente une
// faute là où il n'y en a pas.
//
// TROIS SIGNES, PAS UN SEUL. La règle était « `import`/`export` en tête de
// ligne » ; elle marchait tant que tout le JavaScript du dépôt était écrit à la
// main. Les bibliothèques arrivées avec BAT Studio sont MINIFIÉES : tout le
// fichier tient sur une ligne, et son `export{…}` final est précédé de
// quarante mille caractères. `pdf-lib.esm.min.js` passait donc pour un script
// classique, et le test annonçait cassé un fichier parfaitement valide.
//   · `import`/`export` en tête de ligne — le code écrit à la main ;
//   · le même, précédé d'un `;` ou d'un `}` — le code minifié ;
//   · `.esm.` ou `.mjs` dans le nom — ce que le paquet dit de lui-même.
function analyser(source, nom) {
  const module = /^[ \t]*(import|export)[ \t{*]/m.test(source)
    || /[;}]\s*export\s*[{*]/.test(source)
    || /\.esm\.|\.mjs$/.test(nom);
  try {
    execFileSync(process.execPath,
      module ? ['--check', '--input-type=module'] : ['--check', '--input-type=commonjs'],
      { input: source, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    const detail = String(err.stderr || err.message).split('\n').slice(0, 6).join('\n');
    assert.fail(`${nom} ne s’analyse pas — le navigateur s’arrêtera au même endroit :\n${detail}`);
  }
}

// --- 1. Les fichiers .js servis aux postes -----------------------------------
const js = fichiers(PUBLIC, '.js');
assert.ok(js.length >= 15, 'les modules de public/ doivent tous être passés en revue');
js.forEach((f) => analyser(fs.readFileSync(f, 'utf8'), path.relative(RACINE, f)));

// --- 2. Le JavaScript écrit À L'INTÉRIEUR des pages --------------------------
// Les deux écrans du comptoir portent l'essentiel de leur code dans la page
// elle-même : un `<script>` cassé y coûte exactement aussi cher.
const pages = fichiers(PUBLIC, '.html');
let blocs = 0;
pages.forEach((f) => {
  const html = fs.readFileSync(f, 'utf8');
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (/\ssrc\s*=/i.test(attrs)) continue;                     // chargé d'ailleurs
    if (/\stype\s*=/i.test(attrs) && !/type\s*=\s*["']?(text\/javascript|module)/i.test(attrs)) continue;
    if (!m[2].trim()) continue;
    blocs += 1;
    const ligne = html.slice(0, m.index).split('\n').length;
    analyser(m[2], `${path.relative(RACINE, f)}:${ligne} (<script>)`);
  }
});
assert.ok(blocs >= 2, 'les scripts écrits dans les pages doivent être passés en revue');

console.log(`✓ javascript servi : ${js.length} fichiers et ${blocs} blocs de page s’analysent`);
