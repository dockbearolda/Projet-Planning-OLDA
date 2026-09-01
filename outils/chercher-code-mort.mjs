#!/usr/bin/env node
/* ===========================================================================
   LE CHERCHEUR DE CODE MORT
   ---------------------------------------------------------------------------
   Posé le 01/09/2026, au lendemain d'un audit qui a trouvé six fonctions
   jamais appelées, quarante-cinq règles CSS sans porteur, quarante-sept
   `export` que personne n'importait et deux routes sans écran. Rien de tout ça
   ne se voit en relisant un fichier : ça ne se voit qu'en comparant DEUX
   fichiers, et personne ne compare cinquante fichiers à la main.

   Usage :
     node outils/chercher-code-mort.mjs            # rapport lisible
     node outils/chercher-code-mort.mjs --json     # même chose, en JSON

   Il regarde quatre choses :
     1. exports       un `export` que plus aucun écran n'importe
     2. classes       une classe CSS qu'aucun HTML ni JS ne pose
     3. routes        une route du serveur que personne n'appelle
     4. orphelins     un fichier de `public/` que rien ne cite

   ---------------------------------------------------------------------------
   CE QU'IL SAIT, PARCE QU'IL S'EST TROMPÉ AVANT
   ---------------------------------------------------------------------------
   Une sonde naïve ment, et elle ment dans les deux sens. Les quatre pièges
   déjà payés, chacun corrigé ici :

   · `window.editSelectedClient = function` — l'écran de vente DÉCLARE une
     fonction en haut de page et la REDÉFINIT en bas ; le bouton appelle la
     seconde. Compter les occurrences du nom nu donnait « morte » pour une
     fonction bien vivante, et « vivante » pour la déclaration que personne
     n'exécute. On regarde donc aussi `window.<nom>`.

   · `'pcard--' + etat` et `` `u-${jour}` `` — une classe construite par
     morceaux n'apparaît jamais en entier. On cherche donc chaque PRÉFIXE
     coupé sur un tiret, suivi d'une concaténation ou d'un `${`.

   · `/api/requests/:id/journal` — côté écran c'est
     `/api/requests/${id}/journal`. On compare avec le paramètre remplacé par
     un joker, pas avec le texte de la route.

   · un `export` peut n'avoir aucun importeur et être quand même exercé par un
     test qui lit le module. Un nom cité dans `test/` compte comme vivant.

   CE QU'IL NE SAIT PAS, ET NE PRÉTEND PAS SAVOIR : dire si le code TROUVÉ est
   vraiment atteint à l'exécution. Il dit « personne ne le nomme », ce qui est
   un fait ; « personne ne s'en sert » reste une lecture humaine.
   =========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(RACINE, 'public');

const lire = (p) => fs.readFileSync(p, 'utf8');
const relatif = (p) => path.relative(RACINE, p).split(path.sep).join('/');

function arbre(dir, acc = []) {
  for (const nom of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, nom);
    if (fs.statSync(p).isDirectory()) arbre(p, acc);
    else acc.push(p);
  }
  return acc;
}

// Un commentaire ne POSE rien : ni classe, ni appel. Le laisser dans le foin
// rendrait vivant tout ce dont on a expliqué la disparition — c'est exactement
// ce que ce dépôt fait, longuement, à chaque retrait.
const sansCommentaires = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  .replace(/<!--[\s\S]*?-->/g, ' ');

const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const fichiers = arbre(PUBLIC);
const codePublic = fichiers.filter((f) => /\.(js|html)$/.test(f));
const cssPublic = fichiers.filter((f) => f.endsWith('.css'));
const tests = fs.existsSync(path.join(RACINE, 'test'))
  ? arbre(path.join(RACINE, 'test')).filter((f) => f.endsWith('.js')) : [];

const source = new Map(codePublic.map((f) => [f, sansCommentaires(lire(f))]));
// LES COMMENTAIRES DES TESTS NE COMPTENT PAS NON PLUS, et ça s'est vu tout de
// suite : ce fichier-ci explique pourquoi tel export survit, et le nommer
// suffisait à le rendre vivant aux yeux de la sonde. Un test qui EXPLIQUE une
// disparition ne l'annule pas.
const foinTests = tests.map((f) => sansCommentaires(lire(f))).join('\n');

const resultat = { exports: [], classes: [], routes: [], orphelins: [] };

// --- 1. LES EXPORTS -------------------------------------------------------
// Vivant si un AUTRE module l'importe nommément, si quelqu'un importe le
// module en bloc (`import * as x`), ou si un test le nomme.
const foinCode = codePublic.map((f) => source.get(f)).join('\n');
const modules = codePublic.filter((f) => f.endsWith('.js'));
// Le code de tous les AUTRES fichiers : un module qui s'appelle lui-même par
// `.nom` ne prouve rien sur son utilité au-dehors.
const memoAutres = new Map();
function foinCodeAutres(fichier) {
  if (!memoAutres.has(fichier)) {
    memoAutres.set(fichier, codePublic.filter((g) => g !== fichier).map((g) => source.get(g)).join('\n'));
  }
  return memoAutres.get(fichier);
}
const importesEnBloc = new Set();
const importesNommement = new Set();          // « fichier|nom »

for (const f of codePublic) {
  const s = source.get(f);
  for (const m of s.matchAll(/import\s+\*\s+as\s+\w+\s+from\s+['"]([^'"]+)['"]/g)) {
    importesEnBloc.add(path.resolve(path.dirname(f), m[1]));
  }
  for (const m of s.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const cible = path.resolve(path.dirname(f), m[2]);
    for (const brut of m[1].split(',')) {
      const nom = brut.trim().split(/\s+as\s+/)[0].trim();
      if (nom) importesNommement.add(`${cible}|${nom}`);
    }
  }
}

for (const f of modules) {
  if (importesEnBloc.has(f)) continue;
  const s = source.get(f);
  const noms = new Set();
  for (const m of s.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) noms.add(m[1]);
  for (const m of s.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const brut of m[1].split(',')) {
      const nom = brut.trim().split(/\s+as\s+/).pop().trim();
      if (nom) noms.add(nom);
    }
  }
  for (const nom of [...noms].sort()) {
    if (importesNommement.has(`${f}|${nom}`)) continue;
    // UN ÉCRAN NE S'IMPORTE PAS, IL SE CHARGE À LA DEMANDE. `import('./x.js')`
    // rend un objet dont on appelle les fonctions par leur nom
    // (`m.initReglages(...)`) : le nom n'apparaît alors JAMAIS dans un
    // `import { … }`. Sans cette règle, la sonde donnait pour morts les dix-neuf
    // points d'entrée des écrans — c'est-à-dire tout ce qui s'ouvre d'un clic.
    if (new RegExp(`\\.${echapper(nom)}(?![\\w$])`).test(foinCodeAutres(f))) continue;
    if (new RegExp(`(?<![\\w$])${echapper(nom)}(?![\\w$])`).test(foinTests)) continue;
    resultat.exports.push(`${relatif(f)}  ${nom}`);
  }
}

// --- 2. LES CLASSES CSS ---------------------------------------------------

// Une classe peut être POSÉE par morceaux. On coupe son nom à chaque tiret et
// on demande si l'un des préfixes est suivi d'une concaténation ou d'un `${`.
function poseeParMorceaux(classe) {
  const coupes = [...classe.matchAll(/-/g)].map((m) => m.index);
  for (const i of coupes) {
    const prefixe = echapper(classe.slice(0, i + 1));
    if (new RegExp(`${prefixe}(?:\\$\\{|['"\`]\\s*\\+)`).test(foinCode)) return true;
  }
  return false;
}

for (const f of cssPublic) {
  const css = sansCommentaires(lire(f));
  const selecteurs = css.replace(/\{[^{}]*\}/g, '{}');
  const classes = new Set();
  for (const m of selecteurs.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(m[1]);
  for (const c of [...classes].sort()) {
    if (new RegExp(`(?<![\\w-])${echapper(c)}(?![\\w-])`).test(foinCode)) continue;
    if (poseeParMorceaux(c)) continue;
    if (new RegExp(`(?<![\\w-])${echapper(c)}(?![\\w-])`).test(foinTests)) continue;
    resultat.classes.push(`${relatif(f)}  .${c}`);
  }
}

// --- 3. LES ROUTES --------------------------------------------------------
// `:id` côté serveur devient `${quelqueChose}` côté écran : on compare avec un
// joker, jamais avec le texte de la route.
const serveur = sansCommentaires(lire(path.join(RACINE, 'server.js')));
const foinAppelants = `${foinCode}\n${foinTests}`;
for (const m of serveur.matchAll(/^app\.(get|post|put|patch|delete)\('(\/api\/[^']*)'/gm)) {
  const [, verbe, chemin] = m;
  const motif = chemin.split('/').map((seg) => (seg.startsWith(':') ? '[^\'"`/\\s]+' : echapper(seg))).join('/');
  if (new RegExp(motif).test(foinAppelants)) continue;
  resultat.routes.push(`server.js  ${verbe.toUpperCase()} ${chemin}`);
}

// --- 4. LES FICHIERS ORPHELINS -------------------------------------------
// Un fichier de `public/` que ni un autre fichier servi, ni le serveur, ni un
// test ne nomme : personne ne peut l'atteindre autrement qu'en tapant son
// adresse.
const foinTotal = `${fichiers.filter((f) => /\.(js|html|css|webmanifest)$/.test(f)).map((f) => lire(f)).join('\n')}
${lire(path.join(RACINE, 'server.js'))}\n${foinTests}`;
for (const f of fichiers) {
  const nom = path.basename(f);
  if (nom === 'index.html' || nom === 'sw.js') continue;      // les deux portes d'entrée
  const ailleurs = foinTotal.split(lire(f)).join('\n');       // le fichier ne se cite pas lui-même
  if (new RegExp(echapper(nom)).test(ailleurs)) continue;
  resultat.orphelins.push(relatif(f));
}

// --- SORTIE ---------------------------------------------------------------
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(resultat, null, 2));
} else {
  let total = 0;
  for (const [categorie, lignes] of Object.entries(resultat)) {
    total += lignes.length;
    console.log(`${categorie} (${lignes.length})`);
    for (const l of lignes) console.log(`  ${l}`);
  }
  console.log(`total ${total}`);
}
