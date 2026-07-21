'use strict';

// Vérifie le flux linéaire du bouton « étape suivante » (flèche de la grille).
// On n'exécute PAS une copie de la logique : on extrait le vrai bloc source de
// public/app.js (entre les deux bornes ci-dessous) et on l'évalue avec les
// familles / sous-étapes de db.js. Une divergence entre les deux fichiers, ou
// une régression dans nextFlowStep(), fait donc échouer ce test.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { FAMILIES, SUB_STAGES } = require('../db');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const START = '// --- Flux linéaire du pipeline (bouton « étape suivante ») ---';
const END = 'const flowLabel =';
const from = SRC.indexOf(START);
const to = SRC.indexOf(END);
assert.ok(from >= 0 && to > from, 'bloc FLOW introuvable dans public/app.js');

const sandbox = {
  FAMILIES,
  SUB_STAGES,
  familyHasSub: (slug) => Array.isArray(SUB_STAGES[slug]) && SUB_STAGES[slug].length > 0,
};
vm.createContext(sandbox);
// Les `const` de haut niveau d'un script vm restent dans sa portée lexicale et
// n'apparaissent pas sur l'objet de contexte : on les y republie explicitement.
vm.runInContext(`${SRC.slice(from, to)}
globalThis.FLOW = FLOW;
globalThis.nextFlowStep = nextFlowStep;`, sandbox);
const { FLOW, nextFlowStep } = sandbox;

// Les objets nés dans le contexte vm ont un autre Object.prototype : deepStrictEqual
// les refuserait malgré un contenu identique. On compare donc des copies simples.
const plain = (v) => JSON.parse(JSON.stringify(v ?? null));

// 1. Le flux couvre toutes les familles et toutes leurs sous-étapes, dans l'ordre.
const expected = FAMILIES.flatMap((f) => (
  sandbox.familyHasSub(f.slug)
    ? SUB_STAGES[f.slug].map((s) => ({ stage: f.slug, sub: s.slug }))
    : [{ stage: f.slug, sub: null }]
));
assert.deepStrictEqual(plain(FLOW), expected, 'le flux ne suit pas l’ordre des familles');

const next = (stage, sub = null) => nextFlowStep({ stage, sub_stage: sub });

// 2. Famille sans sous-étape → première position de la famille suivante.
assert.deepStrictEqual(plain(next('demande')), { stage: 'chiffrage', sub: 'a_chiffrer' });
assert.deepStrictEqual(plain(next('attente_client')), { stage: 'preparation', sub: 'prepa_fichiers' });

// 3. Sous-étape → sous-étape suivante DANS la même famille.
assert.deepStrictEqual(plain(next('chiffrage', 'a_chiffrer')), { stage: 'chiffrage', sub: 'chiffrage_en_cours' });
assert.deepStrictEqual(plain(next('production', 'prod_dtf')), { stage: 'production', sub: 'prod_pressage' });

// 4. DERNIÈRE sous-étape d'une famille → première position de la famille d'après.
assert.deepStrictEqual(plain(next('chiffrage', 'devis_a_envoyer')), { stage: 'attente_client', sub: null });
assert.deepStrictEqual(plain(next('preparation', 'pret_a_produire')), { stage: 'production', sub: 'prod_dtf' });
assert.deepStrictEqual(plain(next('production', 'controle_emballage')), { stage: 'facturation', sub: 'facturation_a_faire' });
assert.deepStrictEqual(plain(next('termine', 'solde')), { stage: 'archive', sub: null });

// 5. Famille à sous-étapes mais commande « à préciser » → 1re sous-étape de SA famille
//    (elle n'a pas encore commencé : on ne la pousse pas à la famille suivante).
assert.deepStrictEqual(plain(next('production', null)), { stage: 'production', sub: 'prod_dtf' });

// 6. Bout de flux et hors flux → pas de flèche.
assert.strictEqual(next('archive'), null, 'Archivé est la fin du flux');
assert.strictEqual(next('fiverr'), null, 'Fiverr est hors flux');

// 7. Aucune position n'est un cul-de-sac inattendu : depuis n'importe où on
//    atteint « archive » en un nombre fini de sauts (pas de boucle).
let cur = { stage: 'demande', sub: null };
let hops = 0;
while (cur && hops <= FLOW.length + 1) { cur = next(cur.stage, cur.sub); hops++; }
assert.strictEqual(hops, FLOW.length, 'le parcours complet ne fait pas exactement le tour du flux');

console.log(`✓ next-flow-step : flux de ${FLOW.length} positions, transitions et bornes OK`);
