'use strict';

// LE CLIQUET DE LA CHARTE (27/08/2026)
//
// « Un système atomique ne tient pas parce qu'il est écrit : il tient parce que
// quelque chose refuse ce qui en sort. Sans garde-fou, les valeurs reviennent
// une par une, et chacune paraît raisonnable prise seule. »
//
// Le vérificateur existait — il n'était branché nulle part, et le dépôt avait
// accumulé 252 écarts sans que personne le sache. Le brancher en tout-ou-rien
// ferait échouer `npm test` dès la première seconde sur un existant qu'on n'a
// pas encore nettoyé : on le débrancherait dans la semaine, et on serait revenu
// au point de départ en pire.
//
// D'OÙ LE CLIQUET. Chaque fichier porte son plafond, mesuré le jour où le
// garde-fou est arrivé. Le nombre a le droit de DESCENDRE, jamais de remonter.
//   · nettoyer un fichier → le test le dit, et on abaisse son plafond ;
//   · écrire une couleur en dur → le test échoue, en nommant le fichier.
//
// CE QUE LE VÉRIFICATEUR REFUSE : couleur en dur, taille de texte hors échelle,
// graisse hors des trois, arrondi hors des trois formes, hauteur écrite en dur
// sur une commande, `line-height: normal` sur une commande, durée en dur,
// `@media (pointer: coarse)` entretenant une seconde échelle, `!important` sur
// un sélecteur nu.
//
// LES DEUX GROS FICHIERS SONT LES ÉCRANS DU COMPTOIR (161 des 252). Le 27/08,
// leur CSS est sorti des pages : `vente-directe.css` et `demande-devis.css`,
// même ordre, même cascade. Les écarts ont suivi le fichier — 45 et 116, aux
// mêmes lignes — ce qui est la preuve que le déplacement n'a rien changé.
// C'était le préalable : tant que les règles vivaient dans dix blocs semés dans
// la page, les nettoyer demandait de retrouver lequel portait quoi. Maintenant
// elles sont à un endroit, et le plafond peut descendre.
//
// UNE PART NE DESCENDRA PAS, ET C'EST VOULU : les couleurs du TICKET. Il
// s'imprime sur du papier blanc — un jeton de charte.css y vaut vide, et le
// ticket sort nu. Ces teintes-là sont écrites en clair exprès.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RACINE = path.join(__dirname, '..');

// Plafonds relevés le 27/08/2026, RE-RÉPARTIS le 29/08 : `styles.css` a été
// découpé par écran (dashboard.css, reglages.css, montravail.css…), et ses
// écarts ont suivi leurs règles. Le TOTAL ne monte pas — il descend, parce que
// le tiroir mort est parti le même jour : 239 écarts la veille, 228 ici.
// Un fichier absent de cette table doit être à ZÉRO : c'est ce qui rend le
// cliquet valable pour les fichiers À VENIR.
const PLAFONDS = {
  'public/comptoir/demande-devis.css': 116,
  'public/comptoir/vente-directe.css': 45,
  'public/styles.css': 41,
  'public/dashboard.css': 11,
  'public/clients.css': 4,
  'public/montravail.css': 4,
  'public/reglages.css': 4,
  'public/projet.css': 3,
};

// LE TOTAL EST UN CLIQUET, LUI AUSSI. Sans lui, découper un fichier en deux
// permettrait de répartir les mêmes écarts sans qu'aucun plafond ne bouge.
const TOTAL_MAX = 228;

const res = spawnSync(process.execPath, ['outils/verifier-charte.mjs', 'public'], {
  cwd: RACINE, encoding: 'utf8',
});
assert.ok(res.stdout, 'le vérificateur doit produire un rapport');

// Le rapport est écrit pour un terminal : on lui retire ses couleurs avant de
// le lire. Un fichier ouvre un bloc, chaque écart est une ligne « numéro nom ».
const ESC = String.fromCharCode(27);
const rapport = res.stdout.split(new RegExp(`${ESC}\\[[0-9;]*m`)).join('');
const compte = {};
let fichier = null;
for (const ligne of rapport.split('\n')) {
  const entete = ligne.match(/^(public\/\S+)$/);
  if (entete) { fichier = entete[1]; compte[fichier] = 0; continue; }
  if (fichier && /^\s+\d+\s+\S/.test(ligne)) compte[fichier] += 1;
}
assert.ok(Object.keys(compte).length, 'le rapport doit se laisser lire fichier par fichier');

const trop = [];
const mieux = [];
for (const [f, n] of Object.entries(compte)) {
  const plafond = PLAFONDS[f] || 0;
  if (n > plafond) trop.push(`${f} : ${n} écarts pour un plafond de ${plafond}`);
  else if (n < plafond) mieux.push(`${f} : ${n} au lieu de ${plafond}`);
}
for (const [f, plafond] of Object.entries(PLAFONDS)) {
  if (compte[f] === undefined && plafond > 0) mieux.push(`${f} : 0 au lieu de ${plafond}`);
}

if (mieux.length) {
  // Ce n'est pas un échec : c'est un plafond à redescendre, sinon le cliquet se
  // desserre en silence et on peut réintroduire ce qu'on vient de retirer.
  console.log('  ↓ le plafond peut descendre — ' + mieux.join(' · '));
}

assert.deepStrictEqual(trop, [],
  'la charte a reculé :\n  ' + trop.join('\n  ')
  + '\n  → `node outils/verifier-charte.mjs public` dit la ligne exacte.');

// … ET LE TOTAL NE MONTE PAS. Découper un fichier en deux répartirait les mêmes
// écarts sans qu'aucun plafond par fichier ne bouge : c'est le trou que ce
// second cliquet ferme.
const total = Object.values(compte).reduce((a, b) => a + b, 0);
assert.ok(total <= TOTAL_MAX,
  `la charte a reculé au total : ${total} écarts pour un plafond de ${TOTAL_MAX}`);
if (total < TOTAL_MAX) console.log(`  ↓ le total peut descendre — ${total} au lieu de ${TOTAL_MAX}`);

// LE GARDE-FOU DOIT RESTER DANS LE DÉPÔT. Il vient d'une bibliothèque
// extérieure : s'il n'y est pas copié, il ne tourne que sur le poste de qui l'a
// installée — c'est-à-dire nulle part le jour où quelqu'un d'autre reprend.
assert.ok(fs.existsSync(path.join(RACINE, 'outils/verifier-charte.mjs')),
  'le vérificateur vit DANS le dépôt, pas sur un poste');

// ET LE CSS NE REVIENT PAS DANS LA PAGE. Un bloc `<style>` remis dans un écran
// du comptoir échappe à tout : le vérificateur ne le compte plus (il ne lit que
// les .css), le serveur ne le dépouille plus (il ne dépouille pas le HTML), et
// on serait revenu à dix endroits où chercher une règle — sans que rien ne le
// dise. C'est le genre de retour qui se fait en une ligne et se paie six mois.
for (const nom of ['vente-directe', 'demande-devis']) {
  const page = fs.readFileSync(path.join(RACINE, `public/comptoir/${nom}.html`), 'utf8');
  assert.ok(!/<style[\s>]/.test(page),
    `${nom} : les règles vivent dans ${nom}.css, pas dans la page`);
  assert.ok(page.includes(`<link rel="stylesheet" href="${nom}.css">`),
    `${nom} : la page charge sa feuille`);
  // Le @font-face a suivi la feuille : sans préchargement, Manrope n'est
  // découverte qu'une fois le CSS reçu ET analysé — la page s'affiche en entier
  // dans la police de repli, puis TOUT se recompose.
  assert.ok(/<link rel="preload" as="font"[^>]+manrope/.test(page),
    `${nom} : la police part en même temps que la feuille qui la nomme`);
}

console.log(`✓ charte : cliquet tenu — ${total} écart(s) sur ${TOTAL_MAX}, aucun fichier n'a reculé`);
