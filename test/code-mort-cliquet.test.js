'use strict';

// LE CLIQUET DU CODE MORT (01/09/2026)
// ===========================================================================
// L'audit du 01/09 a trouvé, dans un dépôt que personne n'avait laissé filer :
// six fonctions jamais appelées, quarante-cinq règles CSS sans porteur,
// quarante-sept `export` que plus aucun écran n'importait, deux routes sans
// écran, un fichier orphelin. Rien de tout ça ne se voit en relisant un
// fichier — ça ne se voit qu'en comparant DEUX fichiers, et personne ne
// compare cinquante fichiers à la main.
//
// Même forme que `charte-cliquet.test.js`, pour la même raison : un garde-fou
// qu'on branche en tout-ou-rien sur un existant non nettoyé se débranche dans
// la semaine. Chaque catégorie porte son plafond. Le nombre a le droit de
// DESCENDRE, jamais de remonter.
//
// LA DIFFÉRENCE AVEC LA CHARTE : ici on part de presque zéro, parce que le
// nettoyage a eu lieu le jour même. Le cliquet ne sert donc pas à résorber une
// dette, il sert à ce qu'elle ne se reforme pas — et elle se reforme toujours
// de la même façon : on retire l'écran qui appelait, on garde ce qu'il
// appelait « au cas où », et six mois plus tard personne ne sait plus si ça
// sert.
//
// QUAND CE TEST ÉCHOUE, IL Y A TROIS RÉPONSES POSSIBLES, dans cet ordre :
//   1. c'est vraiment mort → on le retire, et le plafond descend ;
//   2. c'est vivant mais la sonde ne le voit pas → on le dit ICI, dans les
//      exceptions, avec la raison ; jamais en désarmant la catégorie ;
//   3. c'est prêt mais jamais branché → c'est un manque, pas un déchet : on
//      branche, ou on l'écrit dans les exceptions. On ne le retire pas en
//      croyant nettoyer.
//
// ⚠ LA SONDE N'EST PAS UNE PREUVE. Elle dit « personne ne le nomme », ce qui
// est un fait. « Personne ne s'en sert » reste une lecture humaine : le 01/09,
// une fonction donnée pour morte s'est révélée redéfinie plus bas dans le même
// fichier (`window.editSelectedClient`), et un test l'épinglait au mauvais
// endroit depuis. Vérifier avant de retirer.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RACINE = path.join(__dirname, '..');

// Plafonds relevés le 01/09/2026, APRÈS le premier lot de nettoyage.
// Une catégorie absente de cette table doit être à ZÉRO : c'est ce qui rend le
// cliquet valable pour ce qui n'existe pas encore.
const PLAFONDS = {
  // `seDeconnecter` (public/session.js). Ce n'est PAS un déchet : les comptes
  // sont livrés sans aucune porte de sortie, et cette fonction est la sortie.
  // Elle n'est branchée nulle part parce que le bouton n'existe pas — et il ne
  // peut pas aller dans le menu du poste, qui désigne la MACHINE (`olda.qui`),
  // pas la personne connectée. Le retirer fermerait la porte ; l'inventer est
  // un écran à décider. Elle attend donc, comptée et nommée.
  exports: 1,
  classes: 0,
  routes: 0,
  orphelins: 0,
};

const res = spawnSync(process.execPath, ['outils/chercher-code-mort.mjs', '--json'], {
  cwd: RACINE, encoding: 'utf8',
});
assert.strictEqual(res.status, 0, `le chercheur doit tourner :\n${res.stderr}`);
const trouve = JSON.parse(res.stdout);

const trop = [];
const mieux = [];
for (const categorie of Object.keys(trouve)) {
  const n = trouve[categorie].length;
  const plafond = PLAFONDS[categorie] || 0;
  if (n > plafond) {
    trop.push(`${categorie} : ${n} pour un plafond de ${plafond}\n      ${trouve[categorie].join('\n      ')}`);
  } else if (n < plafond) {
    mieux.push(`${categorie} : ${n} au lieu de ${plafond}`);
  }
}

if (mieux.length) {
  // Ce n'est pas un échec : c'est un plafond à redescendre, sinon le cliquet se
  // desserre en silence et on peut réintroduire ce qu'on vient de retirer.
  console.log(`  ↓ le plafond peut descendre — ${mieux.join(' · ')}`);
}

assert.deepStrictEqual(trop, [],
  'du code mort est apparu :\n  ' + trop.join('\n  ')
  + '\n  → `node outils/chercher-code-mort.mjs` donne le détail.'
  + '\n  → si c’est vivant et que la sonde se trompe, dis-le dans PLAFONDS avec la raison.');

// LE CHERCHEUR VIT DANS LE DÉPÔT. Un outil posé sur un poste ne tourne que sur
// ce poste, c'est-à-dire nulle part le jour où quelqu'un d'autre reprend.
assert.ok(fs.existsSync(path.join(RACINE, 'outils/chercher-code-mort.mjs')),
  'le chercheur vit DANS le dépôt, pas sur une machine');

// ET IL SAIT ENCORE VOIR. Une sonde qu'on affaiblit pour faire passer le test
// rend le cliquet décoratif : on lui donne du code mort fabriqué, et il doit le
// trouver. Sans cette vérification, remplacer le corps du chercheur par
// `console.log('{}')` laisserait tout passer, vert.
const bacASable = path.join(RACINE, 'public', '_sonde-temoin.css');
// LE NOM DU TÉMOIN SE CONSTRUIT, il ne s'écrit pas : ce fichier fait partie du
// foin où la sonde cherche, et un témoin écrit en clair ici se verrait
// « porté » par le test qui le fabrique. C'est exactement le piège qu'il est
// censé détecter.
const temoin = ['classe', 'temoin', Date.now().toString(36)].join('-');
fs.writeFileSync(bacASable, `.${temoin} { color: red; }\n`);
try {
  const controle = spawnSync(process.execPath, ['outils/chercher-code-mort.mjs', '--json'], {
    cwd: RACINE, encoding: 'utf8',
  });
  const vu = JSON.parse(controle.stdout);
  assert.ok(vu.classes.some((l) => l.includes(temoin)),
    'le chercheur doit encore trouver une classe que personne ne porte — sinon le cliquet ne garde rien');
} finally {
  fs.unlinkSync(bacASable);
}

console.log('✓ code mort : rien de neuf sans porteur — exports, classes, routes et fichiers');
