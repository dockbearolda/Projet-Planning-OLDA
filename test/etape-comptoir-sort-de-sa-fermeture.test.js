'use strict';

// ===========================================================================
// LE CONTRÔLE EN DIRECT DU COMPTOIR REGARDAIT LA MAUVAISE ÉTAPE (27/08/2026)
// ===========================================================================
// L'écran de vente directe affiche, sous le bouton « continuer », ce qu'il
// reste à remplir — ou un bandeau vert quand tout y est. Il n'a jamais rien
// contrôlé au-delà de l'étape 1.
//
// `refreshLive()` vit dans son propre bloc de script et lisait l'étape ainsi :
//
//     var step = (typeof currentSaleStep !== 'undefined') ? currentSaleStep : 1;
//
// Or `currentSaleStep` est déclaré dans un AUTRE bloc, lui-même enveloppé dans
// une fonction anonyme appelée aussitôt. La variable n'en sort pas : `typeof`
// la trouvait toujours indéfinie, et le repli — l'étape 1 — s'appliquait pour
// toujours. La garde, écrite pour être prudente, a rendu la panne muette.
//
// Ce que ça donnait, vérifié au navigateur avant correction :
//   étape 2, aucun client choisi   → « ✓ Toutes les informations obligatoires
//                                     de cette étape sont renseignées »,
//                                     bouton armé — et un `alert()` au clic
//                                     qui disait le contraire du bandeau ;
//   étape 3, aucun mode de paiement → même bandeau vert ;
//   étape 3, espèces sans montant   → jamais contrôlé (de l'argent) ;
//   étape 3, mixte sans répartition → jamais contrôlé (de l'argent) ;
//   étape 4, vente terminée         → le bandeau devait DISPARAÎTRE, il restait.
//
// La règle qu'on tient ici : ce qui traverse deux blocs de script s'EXPOSE.
// Un identifiant nu sous une garde `typeof` est un pari sur la portée, et le
// pari se perd en silence.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');

// --- Les blocs de script d'une page, et lesquels sont des fermetures --------
function blocs(src) {
  const out = [];
  for (const m of src.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\ssrc=/.test(m[1] || '')) continue;          // un fichier à part
    out.push({
      ligne: src.slice(0, m.index).split('\n').length,
      code: m[2],
      // `(function(){ … })();` ou `(() => { … })();` : ce qui s'y déclare
      // n'existe que là.
      ferme: /^\s*\(\s*(?:function\s*\(|\(\s*\)\s*=>)/.test(m[2]),
    });
  }
  return out;
}

// Commentaires et chaînes retirés : un nom cité dans un texte n'est pas une
// lecture, et un `//` peut contenir n'importe quoi.
const sansTexte = (c) => c
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``');

// Ce qu'un bloc OUVERT déclare en tête de fichier : ces noms-là sont vraiment
// partagés entre blocs (portée lexicale globale).
function declarationsDePremierNiveau(code) {
  const noms = new Set();
  for (const m of code.matchAll(/^(?:let|const|var)\s+([A-Za-z_$][\w$]*)/gm)) noms.add(m[1]);
  for (const m of code.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)) noms.add(m[1]);
  return noms;
}

for (const page of ['vente-directe', 'demande-devis']) {
  const src = lire(`public/comptoir/${page}.html`);
  const bs = blocs(src).map((b) => ({ ...b, propre: sansTexte(b.code) }));

  // Les noms réellement partageables : déclarés au premier niveau d'un bloc
  // qui n'est PAS une fermeture.
  const partages = new Set();
  for (const b of bs) {
    if (b.ferme) continue;
    for (const n of declarationsDePremierNiveau(b.propre)) partages.add(n);
  }

  // Toute garde `typeof NOM` sur un identifiant nu doit porter sur un de
  // ceux-là. Sinon elle retombe TOUJOURS sur son repli.
  for (const b of bs) {
    for (const m of b.propre.matchAll(/typeof\s+([A-Za-z_$][\w$]*)\s*[!=]==?\s*''/g)) {
      const nom = m[1];
      if (nom === 'window' || nom === 'undefined') continue;
      // `typeof window.X` est la façon honnête de poser la question : le nom
      // capté est alors `window`, déjà écarté ci-dessus.
      const declareIci = declarationsDePremierNiveau(b.propre).has(nom)
        || new RegExp(`\\b(?:let|const|var|function)\\s+${nom}\\b`).test(b.propre);
      assert.ok(partages.has(nom) || declareIci,
        `${page}.html, bloc ligne ${b.ligne} : « typeof ${nom} » porte sur un nom `
        + 'qui n’est déclaré au premier niveau d’aucun bloc ouvert — il est enfermé '
        + 'dans une fonction anonyme, la garde retombera TOUJOURS sur son repli, '
        + 'en silence. Exposer la valeur (window.…) et la lire par là.');
    }
  }
}

// --- Et la correction elle-même, nommée -----------------------------------
const VENTE = lire('public/comptoir/vente-directe.html');
assert.match(VENTE, /window\.etapeVenteCourante\s*=\s*function\s*\(\)\s*\{\s*return currentSaleStep;/,
  'le parcours doit EXPOSER son étape courante hors de sa fermeture');
assert.match(VENTE, /var step\s*=\s*\(typeof window\.etapeVenteCourante\s*===\s*'function'\)\s*\?\s*window\.etapeVenteCourante\(\)\s*:\s*1;/,
  'le contrôle en direct doit lire l’étape par l’accesseur exposé, pas sur un identifiant nu');
// Les quatre contrôles qui n'avaient jamais tourné : ils doivent exister.
for (const attendu of ['Client associé à la vente', 'Mode de paiement',
  'Montant donné par le client', 'Répartition carte / espèces']) {
  assert.ok(VENTE.includes(attendu), `le contrôle « ${attendu} » doit rester dans missingForStep`);
}

console.log('✓ comptoir : l’étape sort de sa fermeture, et les contrôles des étapes 2 et 3 tournent enfin');
