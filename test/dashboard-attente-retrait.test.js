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

// --- La dérivation « en retard » du dashboard -------------------------------
// Les quatre compteurs d'alarme ont été retirés de l'écran le 25/08 sur ordre
// du patron. La règle qu'ils portaient, elle, ne bouge pas : elle alimente
// maintenant le POINT ROUGE de l'onglet d'une personne et le « N en retard »
// sous le nom d'une colonne d'équipe. Même dérivation, mêmes conséquences si
// elle se trompe — un « 3 en retard » gonflé de commandes finies envoie
// quelqu'un courir après du travail déjà fait.
const SRC = pub('dashboard.js');
const FROM = SRC.indexOf('  const isWaitingClient = (r) =>');
const MARK = SRC.indexOf('  const isLate = (r) =>');
const TO = SRC.indexOf('\n', MARK);
assert.ok(FROM >= 0 && MARK > FROM, 'les dérivations « attente client » / « en retard » sont introuvables');

// Bande d'urgence réduite à ce qu'on lit ici : 0 = en retard, 1 = échéance
// proche (le vrai `urgency` ajoute « à planifier » / « sans date », hors sujet).
const sandbox = {
  WAITING_SUBS: prio.WAITING_SUBS,
  urgency: (r) => ({ band: r._band }),
};
vm.createContext(sandbox);
vm.runInContext(`${SRC.slice(FROM, TO)}
  globalThis.isLate = isLate; globalThis.isWaitingClient = isWaitingClient;`, sandbox);

const { isLate, isWaitingClient } = sandbox;

// Le matin type qui a fait remonter le bug : du vrai retard d'atelier, une
// commande finie qui attend son retrait depuis 6 jours, un devis parti.
const fini = { id: 'fini', stage: 'facturation', sub_stage: 'client_prevenu', _band: 0 };
const atelier = { id: 'atelier', stage: 'production', sub_stage: 'prod_pressage', _band: 0 };
const devis = { id: 'devis', stage: 'demande_chiffrage', sub_stage: 'devis_envoye', _band: 0 };
const bat = { id: 'bat', stage: 'preparation', sub_stage: 'bat_envoye', _band: 0 };

assert.strictEqual(isLate(fini), false, 'une commande finie qui attend son retrait n’est pas un retard atelier');
assert.strictEqual(isLate(devis), false, 'un devis parti n’est pas un retard atelier');
assert.strictEqual(isLate(bat), false, 'un BAT parti non plus');
assert.strictEqual(isLate(atelier), true, 'du pressage en retard, ça, c’est un vrai retard');
assert.strictEqual(isWaitingClient(fini), true, 'elle est comptée en attente client');
assert.strictEqual(isWaitingClient(atelier), false, 'le pressage est à NOUS');

// Le BAC « à relancer » du dashboard et le compte d'une colonne d'équipe
// lisent la MÊME dérivation que le moteur de priorité : une commande rangée
// « attente client » d'un côté et « en retard » de l'autre, c'est le dossier
// qui apparaît deux fois avec deux verdicts opposés.
for (const sub of [...prio.WAITING_SUBS]) {
  assert.strictEqual(isWaitingClient({ sub_stage: sub, _band: 0 }), true,
    `${sub} : le dashboard et priority.js doivent parler des mêmes lignes`);
  assert.strictEqual(isLate({ sub_stage: sub, _band: 0 }), false,
    `${sub} : … et ce qui attend le client n'est jamais notre retard`);
}

// Le motif du bac « à relancer » doit dire la vérité : « en attente d'une
// réponse » serait faux pour une commande qui n'attend qu'à être récupérée.
assert.match(prio.WAITING_REASON.client_prevenu, /récupérer/,
  'le motif affiché parle de retrait, pas de réponse du client');

console.log('✓ dashboard : « En retard » = retard atelier, la commande finie attend son retrait OK');
