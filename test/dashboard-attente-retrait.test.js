'use strict';

// KPI du Dashboard : « En retard » doit dire L'ATELIER EST EN RETARD.
//
// Régression corrigée ici (30/07/2026). « Client prévenu – Attente retrait »
// veut dire : c'est fabriqué, emballé, le client a été prévenu, ça attend sur
// l'étagère. Cette position n'était comptée NULLE PART comme attente client, et
// comme son échéance était depuis longtemps dépassée, elle gonflait « En
// retard » — 3 des 10 retards affichés en prod ce matin-là étaient des
// commandes terminées. Le patron lisait donc un compteur de retards faux, et la
// file du matin lui réclamait du travail déjà fait.
//
// Comme dashboard-person-view.test.js, on n'exécute pas une copie de la
// logique : on extrait le vrai bloc source de public/dashboard.js et on
// l'évalue, avec le VRAI WAITING_SUBS de public/priority.js.

process.env.TZ = 'UTC';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

// --- La liste « la balle est chez le client », depuis le moteur de priorité ---
const prio = {};
vm.createContext(prio);
vm.runInContext(`${pub('priority.js').replace(/^export\s+/gm, '')}
  globalThis.WAITING_SUBS = WAITING_SUBS; globalThis.WAITING_REASON = WAITING_REASON;`, prio);

assert.ok(prio.WAITING_SUBS.has('client_prevenu'),
  '« Client prévenu – Attente retrait » : la balle est chez le client, pas à l’atelier');

// --- Le bloc KPI du dashboard ----------------------------------------------
const SRC = pub('dashboard.js');
const FROM = SRC.indexOf('  const isWaitingClient = (r) =>');
const MARK = SRC.indexOf('const KPI_LABEL =');
const TO = SRC.indexOf('\n', MARK);
assert.ok(FROM >= 0 && MARK > FROM, 'bloc KPI du dashboard introuvable');

// Bande d'urgence réduite à ce que les KPI lisent : 0 = en retard, 1 = échéance
// proche (le vrai `urgency` ajoute « à planifier » / « sans date », hors sujet ici).
const sandbox = {
  WAITING_SUBS: prio.WAITING_SUBS,
  rows: [],
  isActive: (r) => ['demande_chiffrage', 'preparation', 'production', 'facturation'].includes(r.stage),
  urgency: (r) => ({ band: r._band }),
};
vm.createContext(sandbox);
vm.runInContext(`${SRC.slice(FROM, TO)}
  globalThis.kpis = kpis; globalThis.isLate = isLate;
  globalThis.isWaitingClient = isWaitingClient; globalThis.KPI_PRED = KPI_PRED;`, sandbox);

const { kpis, isLate, isWaitingClient, KPI_PRED } = sandbox;

// Le matin type qui a fait remonter le bug : du vrai retard d'atelier, une
// commande finie qui attend son retrait depuis 6 jours, un devis parti.
const fini = { id: 'fini', stage: 'facturation', sub_stage: 'client_prevenu', _band: 0 };
const atelier = { id: 'atelier', stage: 'production', sub_stage: 'prod_pressage', _band: 0 };
const devis = { id: 'devis', stage: 'demande_chiffrage', sub_stage: 'devis_envoye', _band: 0 };
const proche = { id: 'proche', stage: 'preparation', sub_stage: 'prepa_produits', _band: 1 };
const soldee = { id: 'soldee', stage: 'paiement', sub_stage: 'paiement_valide', _band: 0 };
sandbox.rows = [fini, atelier, devis, proche, soldee];

assert.strictEqual(isLate(fini), false, 'une commande finie qui attend son retrait n’est pas un retard atelier');
assert.strictEqual(isLate(devis), false, 'un devis parti n’est pas un retard atelier');
assert.strictEqual(isLate(atelier), true, 'du pressage en retard, ça, c’est un vrai retard');
assert.strictEqual(isWaitingClient(fini), true, 'elle est comptée en attente client');

const k = kpis();
assert.strictEqual(k.late, 1, 'un seul vrai retard (le pressage) — pas trois');
assert.strictEqual(k.waiting, 2, 'le devis parti ET la commande à retirer sont en attente client');
assert.strictEqual(k.soon, 1, 'une seule échéance proche');
assert.strictEqual(k.active, 4, 'la commande soldée sort des commandes actives');

// Le filtre du KPI doit sélectionner EXACTEMENT ce que le compteur annonce :
// cliquer « En retard » et compter les cartes restantes doit redonner le chiffre.
assert.strictEqual(sandbox.rows.filter((r) => sandbox.isActive(r) && KPI_PRED.late(r)).length, k.late,
  'le filtre « En retard » sélectionne exactement les lignes comptées');
assert.strictEqual(sandbox.rows.filter((r) => sandbox.isActive(r) && KPI_PRED.waiting(r)).length, k.waiting,
  'le filtre « Attente client » sélectionne exactement les lignes comptées');

// Le motif du bac « à relancer » doit dire la vérité : « en attente d'une
// réponse » serait faux pour une commande qui n'attend qu'à être récupérée.
assert.match(prio.WAITING_REASON.client_prevenu, /récupérer/,
  'le motif affiché parle de retrait, pas de réponse du client');

console.log('✓ dashboard : « En retard » = retard atelier, la commande finie attend son retrait OK');
