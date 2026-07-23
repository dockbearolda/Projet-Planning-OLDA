'use strict';

// Vérifie le MOTEUR DE PRIORITÉ (file « À faire maintenant » du dashboard).
// Comme next-flow-step.test.js, on n'exécute pas une copie : on charge le vrai
// source public/priority.js (module ES du navigateur), on retire les `export`
// et on l'évalue dans un contexte vm. Toute régression du classement casse ici.
//
// Fuseau figé (UTC) AVANT tout usage de Date : le calcul « jours d'ici
// l'échéance » lit les composantes LOCALES de `now`, donc on rend le test
// déterministe quelle que soit la machine de CI.
process.env.TZ = 'UTC';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'priority.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  `${SRC.replace(/^export\s+/gm, '')}
   globalThis.rankRequests = rankRequests;
   globalThis.machineOf = machineOf;
   globalThis.scoreRequest = scoreRequest;
   globalThis.reasonsFor = reasonsFor;
   globalThis.daysUntil = daysUntil;`,
  sandbox,
);
const { rankRequests, machineOf, scoreRequest, reasonsFor, daysUntil } = sandbox;

// Aujourd'hui figé : 2026-07-22 (midi UTC → date locale 2026-07-22 en TZ=UTC).
const NOW = Date.parse('2026-07-22T12:00:00Z');
const FRESH = '2026-07-22T09:00:00Z';   // âge 0 j
const STALE = '2026-07-08T00:00:00Z';   // âge 14 j (≥ plafond stagnation)

let id = 0;
// Fabrique une commande de test avec des défauts neutres.
const mk = (o = {}) => ({
  id: `r${++id}`, stage: 'preparation', sub_stage: null, flag: null,
  priority: 1, deadline: null, updated_at: FRESH, created_at: FRESH, ...o,
});

const MACHINES = [
  { slug: 'trotec', name: 'Trotec', importance: 5, minutesPerUnit: null },
  { slug: 'dtf', name: 'DTF', importance: 3, minutesPerUnit: null },
];
const rank = (rows, machines = MACHINES) => rankRequests(rows, machines, { now: NOW });
// `Array.from` réimporte dans le réalm principal : les tableaux rendus par le vm
// portent un autre Array.prototype, que deepStrictEqual refuserait sinon.
const ids = (list) => Array.from(list, (x) => x.r.id);
const rids = (list) => Array.from(list, (r) => r.id);

// 0. daysUntil : bornes autour d'aujourd'hui.
assert.strictEqual(daysUntil('2026-07-22', NOW), 0, 'aujourd’hui = 0 j');
assert.strictEqual(daysUntil('2026-07-20', NOW), -2, 'passé = négatif');
assert.strictEqual(daysUntil('2026-07-25', NOW), 3, 'futur = positif');
// pg-mem (local) rend un ISO complet : la date en tête doit suffire.
assert.strictEqual(daysUntil('2026-07-25T00:00:00.000Z', NOW), 3, 'ISO complet accepté');
assert.strictEqual(daysUntil(null, NOW), null, 'pas de date = null');
assert.strictEqual(daysUntil('pas une date', NOW), null, 'date invalide = null');

// 1. Partition des candidats : terminé/archivé/fiverr écartés, bloqué et attente
//    client sortis vers leurs bacs, le reste dans la file.
{
  const rows = [
    mk({ id: 'file', stage: 'preparation' }),
    mk({ id: 'fini', stage: 'termine' }),
    mk({ id: 'arch', stage: 'archive' }),
    mk({ id: 'fiv', stage: 'fiverr' }),
    mk({ id: 'bloq', stage: 'production', flag: 'bloque' }),
    mk({ id: 'attente', stage: 'attente_client' }),
    mk({ id: 'bloq_attente', stage: 'attente_client', flag: 'bloque' }),
  ];
  const { queue, blocked, waiting } = rank(rows);
  assert.deepStrictEqual(ids(queue), ['file'], 'seule la ligne active reste dans la file');
  assert.deepStrictEqual(rids(blocked).sort(), ['bloq', 'bloq_attente'],
    'toute ligne bloquée va au bac « à débloquer », même en attente client');
  assert.deepStrictEqual(rids(waiting), ['attente'],
    'attente client (non bloquée) va au bac « à relancer »');
}

// 2. Échéance : en retard > aujourd'hui > bientôt > lointain (tout le reste égal).
{
  const rows = [
    mk({ id: 'far', deadline: '2026-08-15' }),
    mk({ id: 'today', deadline: '2026-07-22' }),
    mk({ id: 'overdue', deadline: '2026-07-19' }),
    mk({ id: 'soon', deadline: '2026-07-24' }),
  ];
  assert.deepStrictEqual(ids(rank(rows).queue), ['overdue', 'today', 'soon', 'far'],
    'l’urgence de l’échéance domine le classement');
}

// 3. Poids machine : à échéance lointaine égale, la machine « goulot » (Trotec,
//    importance 5) fait remonter sa commande au-dessus d'une sans machine.
{
  const rows = [
    mk({ id: 'plain', deadline: '2026-09-01' }),
    mk({ id: 'trotec', stage: 'production', sub_stage: 'prod_trotec', deadline: '2026-09-01' }),
  ];
  assert.deepStrictEqual(ids(rank(rows).queue), ['trotec', 'plain'],
    'la machine à forte importance remonte la commande');
}

// 3b. Importance NEUTRE (3) : aucun coup de pouce ; seul un réglage > 3 accélère.
{
  const neutral = scoreRequest(
    mk({ stage: 'production', sub_stage: 'prod_pressage', deadline: '2026-08-15' }),
    { now: NOW, machines: new Map([['presse', { slug: 'presse', name: 'Presse', importance: 3 }]]) },
  );
  assert.strictEqual(neutral.parts.machine, 0, 'importance 3 = neutre, aucun poids machine');
  const boosted = scoreRequest(
    mk({ stage: 'production', sub_stage: 'prod_pressage', deadline: '2026-08-15' }),
    { now: NOW, machines: new Map([['presse', { slug: 'presse', name: 'Presse', importance: 5 }]]) },
  );
  assert.ok(boosted.parts.machine > 0, 'importance 5 = coup de pouce');
}

// 4. Priorité : à échéance égale (aujourd'hui), 3★ passe devant 1★.
{
  const rows = [
    mk({ id: 'low', deadline: '2026-07-22', priority: 1 }),
    mk({ id: 'high', deadline: '2026-07-22', priority: 3 }),
  ];
  assert.deepStrictEqual(ids(rank(rows).queue), ['high', 'low'], 'la priorité départage à échéance égale');
}

// 5. machineOf : sous-étape de production prioritaire ; sinon technique de la
//    fiche ; sinon rien.
assert.strictEqual(machineOf(mk({ sub_stage: 'prod_dtf' })), 'dtf');
assert.strictEqual(machineOf(mk({ sub_stage: 'prod_pressage' })), 'presse');
assert.strictEqual(machineOf(mk({ sub_stage: 'prod_uv' })), 'uv');
assert.strictEqual(
  machineOf(mk({ fiche: { articles: [{ zones: [{ technique: 'laser' }] }] } })), 'trotec',
  'la gravure laser de la fiche pointe la Trotec',
);
assert.strictEqual(machineOf(mk({ stage: 'demande' })), null, 'sans machine identifiable → null');

// 6. Dégradation : sans config machine, aucune erreur, tri par échéance conservé.
{
  const rows = [
    mk({ id: 'trotec', stage: 'production', sub_stage: 'prod_trotec', deadline: '2026-09-01' }),
    mk({ id: 'urgent', deadline: '2026-07-19' }),
  ];
  const { queue } = rankRequests(rows, [], { now: NOW });
  assert.deepStrictEqual(ids(queue), ['urgent', 'trotec'],
    'sans durées ni machines, l’échéance classe quand même');
}

// 7. Stagnation : à tout égal, la commande qui n'a pas bougé depuis longtemps
//    remonte.
{
  const rows = [
    mk({ id: 'moved', updated_at: FRESH }),
    mk({ id: 'stuck', updated_at: STALE }),
  ];
  assert.deepStrictEqual(ids(rank(rows).queue), ['stuck', 'moved'], 'ce qui stagne remonte');
}

// 8. « Pourquoi » lisible : l'échéance en tête, la machine goulot mentionnée.
{
  const overdue = scoreRequest(mk({ deadline: '2026-07-20' }), { now: NOW, machines: new Map(), weights: undefined });
  assert.strictEqual(reasonsFor(overdue)[0], 'En retard de 2 j', 'le retard est le premier motif');

  const machines = new Map(MACHINES.map((m) => [m.slug, m]));
  const trot = scoreRequest(
    mk({ stage: 'production', sub_stage: 'prod_trotec', deadline: '2026-09-01' }),
    { now: NOW, machines, weights: undefined },
  );
  assert.ok(reasonsFor(trot).some((t) => t.includes('Trotec')), 'la machine goulot apparaît dans le pourquoi');
}

// 9. Bacs triés par ancienneté (le plus figé en tête).
{
  const rows = [
    mk({ id: 'recent', stage: 'production', flag: 'bloque', updated_at: FRESH }),
    mk({ id: 'old', stage: 'production', flag: 'bloque', updated_at: STALE }),
  ];
  assert.deepStrictEqual(rids(rank(rows).blocked), ['old', 'recent'],
    'le bac à débloquer met le plus ancien en premier');
}

console.log('✓ priority : partition, classement (échéance/priorité/machine/stagnation), motifs et bacs OK');
