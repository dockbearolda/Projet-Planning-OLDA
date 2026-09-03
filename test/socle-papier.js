'use strict';

// ===========================================================================
// CHARGER UN PAPIER DANS UN BAC À SABLE
// ===========================================================================
// `ticket.js` et `bureau.js` sont des modules ES du navigateur, et depuis le
// 28/08 ils IMPORTENT tous les deux `papier.js` — le socle qui porte l'encre,
// le filet, la marge de feuille et la classe des intitulés. Les deux papiers
// sortent de la même ligne à un clic l'un de l'autre : écrites deux fois, ces
// valeurs redeviennent deux valeurs le jour où l'une bouge.
//
// Depuis le 31/08 ils importent AUSSI `nom-client.js` : le nom de famille
// s'imprime en capitales, et cette règle-là est déjà celle de la colonne
// « Client » du planning — écrite une deuxième fois pour le papier, elle aurait
// divergé le jour où l'une des deux bouge.
//
// Un contexte `vm` ne résout pas un import. On colle donc les socles DEVANT le
// module et on retire les lignes d'import — c'est exactement ce que fait le
// navigateur, et ça garde le principe de ces tests : on évalue le VRAI source,
// pas une copie.
//
// Fichier volontairement nommé sans `.test.js` : le lanceur ne prend que
// `test/*.test.js`, celui-ci est une bibliothèque, pas une épreuve.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');

const nu = (src) => src
  .replace(/^export\s+/gm, '')
  .replace(/^import[\s\S]*?from\s+'[^']*';$/gm, '');

// `fichier` : « ticket.js » ou « bureau.js ». `noms` : ce qu'on veut ressortir.
// `transformer` sert au test du dépouillage, qui doit évaluer les deux moitiés
// avec le même traitement — sinon la comparaison ne prouve rien.
// `socleExtra` : d'autres fichiers de `public/` à évaluer AVANT `fichier`,
// dans l'ordre donné — pour un papier qui importe autre chose que le socle
// commun (`facture.js` importe `calculerDevis` de `devis.js`, par exemple).
// Optionnel et rétrocompatible : aucun appelant existant n'en avait besoin.
function chargerPapier(fichier, noms, transformer, socleExtra) {
  const passe = typeof transformer === 'function' ? transformer : (x) => x;
  const bac = {};
  vm.createContext(bac);
  const fichiersSocle = ['papier.js', 'nom-client.js', ...(Array.isArray(socleExtra) ? socleExtra : [])];
  const socle = fichiersSocle
    .map((f) => nu(passe(fs.readFileSync(path.join(PUBLIC, f), 'utf8'))))
    .join('\n');
  const corps = nu(passe(fs.readFileSync(path.join(PUBLIC, fichier), 'utf8')));
  const sorties = noms.map((n) => `globalThis.${n} = ${n};`).join('\n');
  vm.runInContext(`${socle}\n${corps}\n${sorties}`, bac);
  return bac;
}

module.exports = { chargerPapier, nuPapier: nu };
