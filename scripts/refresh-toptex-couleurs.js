#!/usr/bin/env node
'use strict';

// REMPLIT LES COLORIS DU CATALOGUE TEXTILE DEPUIS L'API TOPTEX.
//
// À lancer À LA MAIN, depuis un poste, quand le fournisseur sort de nouvelles
// teintes :
//     node scripts/refresh-toptex-couleurs.js            (toutes les refs)
//     node scripts/refresh-toptex-couleurs.js NS300 K357 (quelques-unes)
//     node scripts/refresh-toptex-couleurs.js --essai    (n'écrit rien)
//
// Le résultat est FIGÉ dans public/comptoir/textile-catalog.js : le comptoir ne
// parle jamais à TopTex (cf. CLAUDE.md — un poste doit s'ouvrir sans dépendre
// d'un tiers joignable, et la clé API ne descend pas au navigateur).
//
// Les refs partent EN SÉQUENCE avec 250 ms d'écart : TopTex limite par IP, et
// un envoi en parallèle fait tomber la moitié des réponses.

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const CATALOGUE = path.join(RACINE, 'public/comptoir/textile-catalog.js');

// Même chargeur .env que server.js — zéro dépendance.
try {
  for (const ligne of fs.readFileSync(path.join(RACINE, '.env'), 'utf8').split('\n')) {
    const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch (_) { /* pas de .env : les variables viennent de l'environnement */ }

const toptex = require(path.join(RACINE, 'toptex.js'));

// --- Lecture / écriture du bloc DB sans toucher au reste du fichier ---------

// `const DB = {…};` est une seule ligne de JSON. On ne réécrit QUE la clé
// "colors" : re-sérialiser tout le bloc réécrirait aussi les nombres du patron
// (0.0 → 0) et noierait la relecture du diff.
function bornesCle(blob, cle) {
  const debut = blob.indexOf(`"${cle}":`);
  if (debut < 0) return null;
  let i = blob.indexOf('{', debut);
  let profondeur = 0, dansTexte = false, echappe = false;
  for (; i < blob.length; i++) {
    const c = blob[i];
    if (dansTexte) {
      if (echappe) echappe = false;
      else if (c === '\\') echappe = true;
      else if (c === '"') dansTexte = false;
      continue;
    }
    if (c === '"') dansTexte = true;
    else if (c === '{') profondeur++;
    else if (c === '}' && --profondeur === 0) return { debut, fin: i + 1 };
  }
  return null;
}

function lireCatalogue() {
  const source = fs.readFileSync(CATALOGUE, 'utf8');
  const m = source.match(/const DB = (\{[\s\S]*?\});/);
  if (!m) throw new Error('Bloc `const DB = {…};` introuvable dans textile-catalog.js.');
  return { source, blob: m[1], DB: JSON.parse(m[1]) };
}

function ecrireCouleurs(source, blob, couleurs) {
  const bornes = bornesCle(blob, 'colors');
  if (!bornes) throw new Error('Clé "colors" introuvable dans le bloc DB.');
  const neuf = blob.slice(0, bornes.debut) + '"colors":' + JSON.stringify(couleurs) + blob.slice(bornes.fin);
  fs.writeFileSync(CATALOGUE, source.replace(blob, neuf), 'utf8');
}

// --- Récupération ------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const essai = args.includes('--essai');
  const demandees = args.filter((a) => !a.startsWith('--'));

  const { source, blob, DB } = lireCatalogue();
  // La référence du patron fait foi dans le catalogue (elle est dans les
  // dossiers déjà envoyés) ; `toptex` porte celle du fournisseur quand il a
  // renommé le produit de son côté.
  const catalogue = DB.refs
    .map((r) => ({ ref: String(r.ref || '').trim(), chezToptex: String(r.toptex || r.ref || '').trim() }))
    .filter((r) => r.ref);
  const refs = demandees.length
    ? demandees.map((d) => catalogue.find((r) => r.ref === d) || { ref: d, chezToptex: d })
    : catalogue;

  // Les coloris saisis à la main par le patron étaient de simples noms. On les
  // remet à la forme { n, h } pour que le catalogue n'ait qu'UNE seule forme —
  // un tableau mixte casserait silencieusement l'affichage de la pastille.
  const couleurs = {};
  for (const [ref, liste] of Object.entries(DB.colors || {})) {
    couleurs[ref] = (liste || []).map((c) => (typeof c === 'string' ? { n: c, h: null } : c));
  }

  const vides = [];
  let posees = 0;

  for (let i = 0; i < refs.length; i++) {
    const { ref, chezToptex } = refs[i];
    if (i) await toptex.pause(toptex.REGLAGES.pauseRefMs);
    let liste = [];
    try {
      liste = await toptex.getCouleurs(chezToptex);
    } catch (e) {
      console.log(`  ${ref.padEnd(14)} ✗ ${e.message}`);
      vides.push(ref);
      continue;
    }
    // Référence inconnue chez TopTex : l'API répond 200 avec une liste vide.
    // On NE touche pas à ce que le patron avait saisi à la main pour elle.
    if (!liste.length) {
      console.log(`  ${ref.padEnd(14)} — aucune couleur (référence inconnue chez TopTex)`);
      vides.push(ref);
      continue;
    }
    couleurs[ref] = liste.map((c) => ({ n: c.label, h: c.hex || null }));
    posees += liste.length;
    console.log(`  ${ref.padEnd(14)} ${String(liste.length).padStart(3)} coloris`);
  }

  // Passe complète : on jette les clés qui ne désignent plus aucun produit
  // (essais « AAAA »/« BBBB » et coquilles héritées du fichier du patron).
  if (!demandees.length) {
    const connues = new Set(catalogue.map((r) => r.ref));
    for (const ref of Object.keys(couleurs)) {
      if (!connues.has(ref)) { delete couleurs[ref]; console.log(`  ${ref.padEnd(14)} ↩ clé orpheline, retirée`); }
    }
  }

  console.log(`\n${refs.length - vides.length}/${refs.length} références servies, ${posees} coloris au total.`);
  if (vides.length) console.log(`Sans réponse : ${vides.join(', ')}`);

  if (essai) { console.log('\n--essai : rien n’a été écrit.'); return; }
  ecrireCouleurs(source, blob, couleurs);
  console.log(`\nÉcrit dans ${path.relative(RACINE, CATALOGUE)}.`);
}

main().catch((e) => { console.error('\nÉCHEC :', e.message); process.exit(1); });
