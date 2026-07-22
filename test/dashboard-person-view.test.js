'use strict';

// Vue personne du Dashboard : elle doit montrer LES DEUX facettes du travail
// d'un employé — ce qu'il PILOTE et ce qu'il ÉPAULE en tant que référent.
//
// Régression corrigée ici : la liste « Mes projets où je suis référent » avait
// été retirée (commit 569dc06). Or « Ma journée » ne retient que l'urgent
// (retard / échéance proche / à planifier / à commander). Résultat : une
// commande où l'on n'est QUE référent et qui est « Sans date » (bande 4)
// n'apparaissait NULLE PART dans l'onglet — cas typique de Julien, qui ne pilote
// que « Contrôle & emballage » (souvent vide) et suit la production en référent.
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
  ACTIVE_SET: new Set(['demande', 'chiffrage', 'attente_client', 'preparation', 'production', 'facturation']),
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

// --- 2. La vue personne DOIT rendre la liste des projets en référent --------
// Garde-fou contre la re-suppression : buildPersonView doit alimenter le
// panneau latéral avec refereeing(who), en plus de piloting(who).
const VIEW_FROM = SRC.indexOf('function buildPersonView');
const VIEW_TO = SRC.indexOf('\n  // --- Corps', VIEW_FROM);
assert.ok(VIEW_FROM >= 0 && VIEW_TO > VIEW_FROM, 'buildPersonView introuvable');
const viewSrc = SRC.slice(VIEW_FROM, VIEW_TO);

assert.ok(/refereeing\(who\)/.test(viewSrc), 'la vue personne doit rendre refereeing(who) (liste des projets en référent)');
assert.ok(/piloting\(who\)/.test(viewSrc), 'la vue personne doit rendre piloting(who) (liste des projets en pilotage)');

console.log('dashboard-person-view.test.js OK');
