#!/usr/bin/env node
'use strict';

// REMPLIT L'INSTANTANÉ DES TAILLES DE LOGO DEPUIS LE SITE DE L'ATELIER.
//
// À lancer À LA MAIN, quand on veut que le fichier livré avec le code reparte
// du tableau à jour :
//     node scripts/refresh-tailles-logo.js            (écrit l'instantané)
//     node scripts/refresh-tailles-logo.js --essai    (n'écrit rien, compte)
//
// L'instantané (tailles-logo-seed.json) est ce qu'une base NEUVE reçoit au
// premier démarrage : sans lui, le comptoir n'aurait rien à proposer tant que
// personne n'a cliqué « Mettre à jour » dans les Réglages — et une fonction
// qu'il faut aller allumer est une fonction qui n'existe pas.
//
// Ce n'est PAS le chemin de mise à jour courant : celui-là passe par les
// Réglages, en un clic, sans déploiement (le tableau se remplit au fur et à
// mesure à l'atelier). Voir tailles-logo.js.

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const INSTANTANE = path.join(RACINE, 'tailles-logo-seed.json');

// Même chargeur .env que server.js — zéro dépendance.
try {
  for (const ligne of fs.readFileSync(path.join(RACINE, '.env'), 'utf8').split('\n')) {
    const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch (_) { /* pas de .env : les variables viennent de l'environnement */ }

const { lireTaillesLogo, BASE_PAR_DEFAUT } = require(path.join(RACINE, 'tailles-logo.js'));

const essai = process.argv.includes('--essai');

lireTaillesLogo().then((lu) => {
  const familles = Object.keys(lu.familles).sort();
  console.log(`Site : ${lu.source || BASE_PAR_DEFAUT}`);
  console.log(`Familles : ${familles.join(', ') || '(aucune)'}`);
  console.log(`${lu.refs} référence(s), ${lu.mesures} largeur(s).`);

  if (!lu.refs) {
    // UN TABLEAU VIDE N'ÉCRASE RIEN. Le site peut répondre 200 avec un contenu
    // incomplet le temps qu'il se réveille ; écrire dans ce cas remplacerait un
    // instantané bon par un instantané vide, et personne ne le verrait avant le
    // prochain démarrage d'une base neuve.
    console.error('Aucune largeur lue : l’instantané n’est PAS réécrit.');
    process.exit(1);
  }
  if (essai) {
    console.log('--essai : rien n’a été écrit.');
    return;
  }

  // Les clés sont triées : sans ça, deux relevés identiques donnent deux
  // fichiers différents et le diff devient illisible.
  const trie = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const familleTriees = {};
  for (const f of familles) {
    const parRef = {};
    for (const ref of Object.keys(lu.familles[f]).sort()) parRef[ref] = trie(lu.familles[f][ref]);
    familleTriees[f] = parRef;
  }

  fs.writeFileSync(INSTANTANE, `${JSON.stringify({
    source: lu.source,
    familles: familleTriees,
  }, null, 2)}\n`);
  console.log(`Écrit : ${path.relative(RACINE, INSTANTANE)}`);
}).catch((err) => {
  console.error(`Échec : ${err.message}`);
  process.exit(1);
});
