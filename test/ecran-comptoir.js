'use strict';

// UN ÉCRAN DU COMPTOIR SE LIT EN DEUX FICHIERS (27/08/2026)
//
// Jusqu'ici, `vente-directe.html` et `demande-devis.html` portaient tout : le
// balisage, le script ET dix blocs `<style>` semés dans la page. Les tests
// lisaient donc un seul fichier et y cherchaient indifféremment une fonction ou
// une règle CSS.
//
// Les feuilles sont sorties dans `vente-directe.css` et `demande-devis.css` —
// même ordre, même cascade, mais deux fichiers. Les tests, eux, parlent de
// « l'écran » : c'est ici que les deux morceaux se recollent, une fois, plutôt
// que dans trente fichiers de test.

const fs = require('node:fs');
const path = require('node:path');

const DOSSIER = path.join(__dirname, '..', 'public', 'comptoir');

function ecran(nom) {
  const base = path.join(DOSSIER, nom.replace(/\.(html|css)$/, ''));
  return `${fs.readFileSync(`${base}.html`, 'utf8')}\n${fs.readFileSync(`${base}.css`, 'utf8')}`;
}

// La page seule (balisage + script), et la feuille seule. Recoller les deux
// convient à la plupart des contrôles ; ceux qui vérifient « rien en dur DANS
// LE BALISAGE » ont besoin de les séparer.
const page = (nom) => fs.readFileSync(path.join(DOSSIER, nom.replace(/\.(html|css)$/, "") + ".html"), "utf8");
const feuille = (nom) => fs.readFileSync(path.join(DOSSIER, nom.replace(/\.(html|css)$/, "") + ".css"), "utf8");

module.exports = { ecran, page, feuille };
