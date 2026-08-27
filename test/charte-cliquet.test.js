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
// LES DEUX GROS FICHIERS SONT LES ÉCRANS DU PATRON (161 des 252). Ils sont
// remplacés EN BLOC quand il en envoie une nouvelle version : les nettoyer là
// est du travail qui s'efface. Le durable, pour eux, est de vider leur <style>
// et de les faire lire `charte.css` — c'est un chantier à part, et le plafond
// est là pour qu'ils n'empirent pas d'ici là.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RACINE = path.join(__dirname, '..');

// Plafonds relevés le 27/08/2026. Un fichier absent de cette table doit être
// à ZÉRO : c'est ce qui rend le cliquet valable pour les fichiers À VENIR.
const PLAFONDS = {
  'public/comptoir/demande-devis.html': 116,
  'public/styles.css': 84,
  'public/comptoir/vente-directe.html': 45,
  'public/clients.css': 4,
  'public/projet.css': 3,
};

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

// LE GARDE-FOU DOIT RESTER DANS LE DÉPÔT. Il vient d'une bibliothèque
// extérieure : s'il n'y est pas copié, il ne tourne que sur le poste de qui l'a
// installée — c'est-à-dire nulle part le jour où quelqu'un d'autre reprend.
assert.ok(fs.existsSync(path.join(RACINE, 'outils/verifier-charte.mjs')),
  'le vérificateur vit DANS le dépôt, pas sur un poste');

const total = Object.values(compte).reduce((s, n) => s + n, 0);
console.log(`✓ charte : cliquet tenu — ${total} écart(s), aucun fichier n'a reculé`);
