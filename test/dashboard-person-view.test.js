'use strict';

// L'onglet d'une personne doit porter LES DEUX facettes de son travail — ce
// qu'elle PILOTE et ce qu'elle ÉPAULE en tant que référente.
//
// Régression corrigée ici : la liste « Mes projets où je suis référent » avait
// été retirée (commit 569dc06). Or « Ma journée » ne retenait que l'urgent
// (retard / échéance proche / à planifier / à commander). Résultat : une
// commande où l'on n'est QUE référent et qui est « Sans date » (bande 4)
// n'apparaissait NULLE PART dans l'onglet — cas typique de Julien, qui ne pilote
// que « Contrôle & emballage » (souvent vide) et suit la production en référent.
//
// La refonte du 25/08 a supprimé le panneau latéral qui la portait : la file
// d'une personne et celle de l'atelier sont désormais le même rendu, à un
// filtre près. La garde ne peut donc plus nommer une fonction de mise en page,
// elle vérifie LE RÉSULTAT — la commande est-elle dans la file de Julien.
//
// Comme dans next-flow-step.test.js, on n'exécute pas une copie de la logique :
// on extrait les vrais blocs source de public/dashboard.js et on les évalue.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.js'), 'utf8');

// --- 1. Extraction des dérivations pilote / référent ------------------------
const DERIV_FROM = SRC.indexOf('const isActive = (r) => ACTIVE_SET.has');
const DERIV_MARK = SRC.indexOf('const isManualReferent =');
const DERIV_TO = SRC.indexOf('\n', DERIV_MARK);
assert.ok(DERIV_FROM >= 0 && DERIV_MARK > DERIV_FROM, 'bloc dérivations pilote/référent introuvable');

const PILO_FROM = SRC.indexOf('const piloting = (who)');
const REF_MARK = SRC.indexOf('const refereeing = (who)');
const PILO_TO = SRC.indexOf('\n', REF_MARK);
assert.ok(PILO_FROM >= 0 && REF_MARK > PILO_FROM, 'blocs piloting/refereeing introuvables');

const sandbox = {
  ACTIVE_SET: new Set(['demande_chiffrage', 'preparation', 'production', 'facturation']),
  EMPLOYEES: ['Loïc', 'Charlie', 'Mélina', 'Julien'],
  owners: {},
  catRefs: {},
  rows: [],
};
vm.createContext(sandbox);
vm.runInContext(
  `${SRC.slice(DERIV_FROM, DERIV_TO)}\n${SRC.slice(PILO_FROM, PILO_TO)}\n`
  + 'globalThis.effectivePilot = effectivePilot;'
  + 'globalThis.effectiveReferents = effectiveReferents;'
  + 'globalThis.piloting = piloting;'
  + 'globalThis.refereeing = refereeing;',
  sandbox,
);

// Config atelier : Charlie pilote le pressage, Julien est référent PAR DÉFAUT de
// toute la production (comme en prod → « RÉFÉRENT · AUTO » sur la fiche).
sandbox.owners = { prod_pressage: 'Charlie' };
sandbox.catRefs = { production: ['Julien'] };

// Une commande en production, au pressage, SANS date, sans pilote/référent manuel
// (= « Anne Mode Concept » de la capture).
const anneModeConcept = {
  id: 1, stage: 'production', sub_stage: 'prod_pressage',
  responsable: null, referent: null, deadline: null,
  billing_company: 'Anne Mode Concept', product: 'T-Shirt NS300 WET SAND',
};
sandbox.rows = [anneModeConcept];

const { effectivePilot, effectiveReferents, piloting, refereeing } = sandbox;

// Le pilote effectif est Charlie (attribution du pressage), pas Julien.
assert.strictEqual(effectivePilot(anneModeConcept), 'Charlie', 'pilote effectif attendu = Charlie');
// Julien en est le référent effectif (config de catégorie, référent AUTO).
assert.deepStrictEqual(effectiveReferents(anneModeConcept), ['Julien'], 'référent effectif attendu = Julien');

// Côté Julien : il ne PILOTE rien, mais la commande est bien dans ses projets
// EN RÉFÉRENT. C'est cette liste, et elle seule, qui peut la faire apparaître —
// « Ma journée » l'exclut car elle est « Sans date » (non urgente).
assert.deepStrictEqual(piloting('Julien').map((r) => r.id), [], 'Julien ne pilote pas cette commande');
assert.deepStrictEqual(refereeing('Julien').map((r) => r.id), [1], 'la commande doit être dans les projets référent de Julien');

// --- 2. L'onglet d'une personne DOIT porter ses dossiers de RÉFÉRENT --------
// C'est LA régression à empêcher, et elle ne dépend d'aucune mise en page :
// une commande où l'on n'est que référent, et qui n'est pas urgente, doit
// apparaître dans l'onglet de cette personne.
//
// Elle était protégée jusqu'au 25/08 par une assertion sur `buildPersonView`
// — une fonction qui posait, à droite de la file, deux listes « Je pilote » et
// « J'épaule » relistant dossier pour dossier ce que la file montrait déjà.
// La refonte a fusionné les trois en une seule liste : la garde ne peut plus
// nommer la fonction, elle doit vérifier LE RÉSULTAT. On exécute donc le vrai
// `rankFor` du dashboard, alimenté par le vrai moteur `rankRequests`.
const PRIO = fs.readFileSync(path.join(__dirname, '..', 'public', 'priority.js'), 'utf8');

const RANK_FROM = SRC.indexOf('  function rankFor(who) {');
const RANK_TO = SRC.indexOf('\n  }', RANK_FROM);
assert.ok(RANK_FROM >= 0 && RANK_TO > RANK_FROM, 'rankFor introuvable');

const bac = {
  ACTIVE_SET: sandbox.ACTIVE_SET,
  EMPLOYEES: sandbox.EMPLOYEES,
  owners: sandbox.owners,
  catRefs: sandbox.catRefs,
  rows: sandbox.rows,
  machines: [],
  classementsParPersonne: new Map(),
  Date,
};
vm.createContext(bac);
vm.runInContext(
  `${PRIO.replace(/^export\s+/gm, '')}\n`
  + `${SRC.slice(DERIV_FROM, DERIV_TO)}\n`
  + `${SRC.slice(RANK_FROM, RANK_TO)}\n  }\n`
  + 'globalThis.rankFor = rankFor;',
  bac,
);

const ids = (who) => Array.from(bac.rankFor(who).queue, (x) => x.r.id);
const fileDeJulien = ids('Julien');
assert.deepStrictEqual(fileDeJulien, [1],
  'une commande où l’on est SEULEMENT référent, et sans date, doit rester dans '
  + 'la file de cette personne — c’est le cas de Julien, qui ne pilote que '
  + '« Contrôle & emballage » (souvent vide) et suit la production en référent');

// Et elle y est bien AU MÊME TITRE que pour son pilote : le même dossier
// apparaît dans les deux files, une fois chacune.
assert.deepStrictEqual(ids('Charlie'), [1],
  'le pilote la voit aussi');
assert.strictEqual(bac.rankFor('Mélina').queue.length, 0,
  'et personne d’autre ne la voit');

// --- 3. La file d'une personne ne se dédouble plus --------------------------
// « Ma file » à gauche et « Je pilote / J'épaule » à droite montraient les
// mêmes dossiers côte à côte, sur le même écran. La vue d'une personne et la
// file commune sont désormais LE MÊME rendu à un filtre près.
assert.ok(!/function buildPersonView/.test(SRC),
  'la vue personne dédoublée ne doit pas revenir : une seule liste par onglet');
assert.ok(/buildTodoView\(activeTab === 'todo' \? null : activeTab\)/.test(SRC),
  'l’onglet d’une personne passe par le MÊME constructeur que la file commune');

console.log('dashboard-person-view.test.js OK');
