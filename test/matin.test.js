'use strict';

// ===========================================================================
// LE BRIEFING DU MATIN — il doit dire vrai, et se taire quand il n'a rien
// ===========================================================================
// `matin.js` produit des PHRASES. C'est ce qui le rend utile et dangereux :
// une file mal triée se voit, une phrase fausse se croit. Chaque observation
// est donc rejouée ici sur un cas construit, et on vérifie autant ce qu'elle
// affirme que ce qu'elle NE dit PAS.
//
// Comme priority.test.js : on charge le vrai source (module ES du navigateur),
// on retire les `export` et on l'évalue dans un contexte vm. Fuseau figé.

process.env.TZ = 'UTC';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const lire = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const sansExport = (s) => s.replace(/^export\s+/gm, '');

// matin.js importe priority.js : on concatène les deux sources après avoir
// retiré la ligne d'import, plutôt que de simuler le moteur — une simulation
// finirait par diverger de l'original sans que rien ne le signale.
const PRIO = sansExport(lire('public/priority.js'));
const MATIN = sansExport(lire('public/matin.js')).replace(/^import .*$/m, '');

const bac = {};
vm.createContext(bac);
vm.runInContext(`${PRIO}\n${MATIN}\n
  globalThis.briefing = briefing;
  globalThis.joursPourSortir = joursPourSortir;
  globalThis.memeMotif = memeMotif;
  globalThis.JOURS_POUR_SORTIR = JOURS_POUR_SORTIR;
  globalThis.DELAI_RELANCE = DELAI_RELANCE;
  globalThis.ECART_CHARGE = ECART_CHARGE;`, bac);
const { briefing, joursPourSortir, memeMotif, DELAI_RELANCE, ECART_CHARGE } = bac;

const NOW = Date.parse('2026-08-25T12:00:00Z');
const jour = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);
const ilYA = (n) => new Date(NOW - n * 86400000).toISOString();

let seq = 0;
const mk = (o = {}) => ({
  id: ++seq, stage: 'production', sub_stage: null, flag: null, flag_reason: null,
  deadline: null, updated_at: ilYA(0), responsable: 'Loïc', referent: null,
  billing_company: `Client ${seq}`, product: 'Article', ...o,
});
const ETIQUETTE = {
  a_chiffrer: 'À chiffrer', prod_pressage: 'Pressage', prod_dtf: 'Production DTF',
  pret_a_produire: 'Prêt à produire', prepa_produits: 'Préparation des produits',
  devis_envoye: 'Tarif / Devis envoyé – Attente client',
  bat_envoye: 'BAT envoyé – Attente validation',
  client_prevenu: 'Client prévenu – Attente retrait',
  production: 'Production', demande_chiffrage: 'Demande & chiffrage',
};
const ctx = (extra = {}) => ({
  now: NOW, machines: [], employees: [], estActif: () => true,
  pilotDe: (r) => r.responsable || null,
  referentsDe: (r) => (r.referent ? [r.referent] : []),
  nomClient: (r) => r.billing_company,
  // Les vrais libellés, comme le dashboard les passe : une phrase du briefing
  // se lit à voix haute au point du matin, elle ne cite pas des slugs.
  labelEtape: (r) => ETIQUETTE[r.sub_stage] || ETIQUETTE[r.stage] || r.stage,
  ...extra,
});
const parCle = (rows, extra) => Object.fromEntries(briefing(rows, ctx(extra)).map((o) => [o.cle, o]));

// ===========================================================================
// 1. IL SE TAIT QUAND IL N'A RIEN À DIRE
// ===========================================================================
// C'est la propriété la plus importante du lot. Un briefing qui parle tous les
// matins devient un bandeau qu'on saute, et le jour où il a raison, personne
// ne le lit. Un atelier calme doit produire ZÉRO observation.
const calme = [
  mk({ deadline: jour(20), stage: 'production', sub_stage: 'prod_pressage' }),
  mk({ deadline: jour(25), stage: 'preparation', sub_stage: 'prepa_produits' }),
];
// `deepStrictEqual` sur un tableau venu du contexte `vm` échoue toujours : son
// prototype est celui de l'AUTRE realm, jamais `Array.prototype` d'ici. On
// compare donc ce qu'on veut vraiment dire — le nombre d'observations.
assert.strictEqual(briefing(calme, ctx()).length, 0,
  'un atelier sans urgence, sans blocage et sans relance ne produit AUCUNE phrase');

// ===========================================================================
// 2. « CE QUI NE PASSERA PAS » — le signal qu'aucune file triée ne donne
// ===========================================================================
// Une commande due demain, encore au chiffrage : elle n'est PAS en retard, donc
// aucun tri ne la remonte, et il faut cinq jours pour la sortir depuis là.
// C'est exactement ce qu'on découvre à midi quand personne ne le calcule.
const glisse = mk({ stage: 'demande_chiffrage', sub_stage: 'a_chiffrer', deadline: jour(1) });
const b2 = parCle([glisse]);
assert.ok(b2.glissent, 'une commande due demain et encore à chiffrer doit être signalée');
assert.match(b2.glissent.detail, /demain/, 'la phrase dit QUAND');
assert.match(b2.glissent.detail, /à chiffrer/i, '… et OÙ elle en est');
assert.deepStrictEqual([...b2.glissent.ids], [glisse.id], 'la phrase nomme le dossier qui la fonde');
assert.ok(!b2.brulent, 'elle n’est pas encore en retard : elle ne compte pas deux fois');

// Le même dossier à une étape d'où l'on sort en un jour ne glisse pas.
assert.ok(!parCle([mk({ stage: 'production', sub_stage: 'pret_a_produire', deadline: jour(1) })]).glissent,
  '« Prêt à produire » due demain passe : on ne crie pas au loup');

// Et une commande DÉJÀ en retard appartient à l'autre paragraphe, pas aux deux.
const enRetard = mk({ stage: 'demande_chiffrage', sub_stage: 'a_chiffrer', deadline: jour(-2) });
const b3 = parCle([enRetard]);
assert.ok(b3.brulent && !b3.glissent, 'un dossier en retard n’est compté qu’une fois');
assert.match(b3.brulent.detail, /2 jours de retard/, 'et son ancienneté est dite');

// La balle chez le CLIENT n'est pas notre retard : ni « brûle », ni « glisse ».
for (const sub of ['devis_envoye', 'bat_envoye', 'client_prevenu']) {
  const b = parCle([mk({ stage: 'demande_chiffrage', sub_stage: sub, deadline: jour(-3) })]);
  assert.ok(!b.brulent, `${sub} : une commande chez le client n’est pas notre retard`);
  assert.ok(!b.glissent, `${sub} : … et elle ne « glisse » pas non plus`);
}

// ===========================================================================
// 3. « UN SEUL APPEL LES DÉBLOQUE TOUTES »
// ===========================================================================
// Deux dossiers bloqués par la même cause ne sont pas deux problèmes.
const rupture = [
  mk({ flag: 'bloque', flag_reason: 'Le PVC blanc 3 mm est en rupture chez le fournisseur', updated_at: ilYA(5) }),
  mk({ flag: 'bloque', flag_reason: 'Rupture de PVC blanc chez le fournisseur', updated_at: ilYA(2) }),
];
const b4 = parCle(rupture);
assert.ok(b4.bloques, 'un blocage se signale');
assert.match(b4.bloques.detail, /Un seul appel/, 'deux motifs équivalents = un seul appel à passer');
assert.strictEqual(b4.bloques.ids.length, 2, 'et la phrase porte les deux dossiers');

// Deux causes différentes ne se regroupent pas : ce serait un conseil FAUX.
const b5 = parCle([
  mk({ flag: 'bloque', flag_reason: 'Le PVC blanc est en rupture', updated_at: ilYA(5) }),
  mk({ flag: 'bloque', flag_reason: 'Le client ne répond pas au téléphone', updated_at: ilYA(1) }),
]);
assert.ok(!/Un seul appel/.test(b5.bloques.detail),
  'deux causes distinctes ne se regroupent pas — un raccourci faux coûte plus qu’un silence');
assert.match(b5.bloques.detail, /figée depuis 5 jours/, 'on nomme alors la plus ancienne');

// Les phrases sont LUES À VOIX HAUTE au point du matin : elles doivent être en
// français. Un verbe ne se met pas au pluriel en collant un suffixe (« ne
// passeraont pas »), et un blocage posé ce matin ne dure pas « 0 jour ».
const b5b = parCle([
  mk({ stage: 'demande_chiffrage', sub_stage: 'a_chiffrer', deadline: jour(1) }),
  mk({ stage: 'demande_chiffrage', sub_stage: 'a_chiffrer', deadline: jour(2) }),
]);
assert.match(b5b.glissent.titre, /2 commandes ne passeront pas dans les temps/,
  'le verbe s’accorde vraiment');
assert.match(parCle([mk({ stage: 'demande_chiffrage', sub_stage: 'a_chiffrer', deadline: jour(1) })]).glissent.titre,
  /1 commande ne passera pas dans les temps/, '… au singulier aussi');
assert.match(parCle([mk({ flag: 'bloque', flag_reason: 'Attente du BAT', updated_at: ilYA(0) })]).bloques.detail,
  /bloquée aujourd’hui/, 'un blocage posé ce matin ne dure pas « 0 jour »');

// La comparaison de motifs, isolée : elle doit résister à l'ordre des mots et
// aux accents, sans rapprocher deux phrases qui n'ont qu'un mot en commun.
assert.ok(memeMotif('PVC blanc en rupture', 'rupture de PVC blanc'), 'ordre des mots indifférent');
assert.ok(memeMotif('Attente marchandise fournisseur', 'marchandise en attente du fournisseur'));
assert.ok(!memeMotif('Le client ne répond pas', 'Le fournisseur est en rupture'), 'deux causes ≠');
assert.ok(!memeMotif('', 'rupture de stock'), 'un motif vide ne ressemble à rien');

// ===========================================================================
// 4. LES RELANCES — chaque position a son délai
// ===========================================================================
// Un devis dort plus longtemps qu'un BAT : le client n'a pas encore engagé.
const auSeuil = (sub) => mk({ stage: 'demande_chiffrage', sub_stage: sub, updated_at: ilYA(DELAI_RELANCE[sub]) });
const soussSeuil = (sub) => mk({ stage: 'demande_chiffrage', sub_stage: sub, updated_at: ilYA(DELAI_RELANCE[sub] - 1) });
for (const sub of Object.keys(DELAI_RELANCE)) {
  assert.ok(parCle([auSeuil(sub)]).relances, `${sub} : au seuil, on relance`);
  assert.ok(!parCle([soussSeuil(sub)]).relances, `${sub} : un jour avant, on laisse le client tranquille`);
}
const b6 = parCle([
  mk({ sub_stage: 'devis_envoye', updated_at: ilYA(12) }),
  mk({ sub_stage: 'devis_envoye', updated_at: ilYA(8) }),
  mk({ sub_stage: 'bat_envoye', updated_at: ilYA(4) }),
]);
assert.match(b6.relances.titre, /^3 relances/, 'le compte est le total');
assert.match(b6.relances.detail, /2 devis sans réponse/, '… et le détail sépare les natures');
assert.match(b6.relances.detail, /1 BAT à valider/);

// ===========================================================================
// 5. LA CHARGE — et un transfert qu'on peut vraiment proposer
// ===========================================================================
// Proposer de passer un dossier à quelqu'un qui ne l'a jamais vu, ce n'est pas
// un conseil. On ne propose QUE ce que la personne suit déjà en référent.
const equipe = { employees: ['Loïc', 'Mélina'] };
const lourd = [];
for (let i = 0; i < 6; i++) lourd.push(mk({ responsable: 'Loïc', deadline: jour(10) }));
const partageable = mk({ responsable: 'Loïc', referent: 'Mélina', sub_stage: 'prod_pressage', deadline: jour(3) });
const b7 = parCle([...lourd, partageable], equipe);
assert.ok(b7.charge, `un écart de ${ECART_CHARGE} dossiers ou plus se signale`);
assert.match(b7.charge.detail, /pourrait passer à Mélina/, 'le transfert est nommé');
assert.match(b7.charge.detail, /suit déjà en référent/, '… et justifié');

// Sans candidat crédible, on le DIT plutôt que d'inventer un transfert.
const b8 = parCle(lourd.concat(mk({ responsable: 'Loïc', deadline: jour(3) })), equipe);
assert.match(b8.charge.detail, /à l’aveugle/,
  'aucun dossier partagé : on ne propose pas un transfert au hasard');

// Un écart faible n'est qu'un hasard de la semaine.
assert.ok(!parCle([mk({ responsable: 'Loïc' }), mk({ responsable: 'Mélina' })], equipe).charge,
  'deux files presque égales ne sont pas un déséquilibre');

// Dans la vue d'UNE personne, la comparaison n'a aucun sens : pas d'employés,
// pas d'observation de charge.
assert.ok(!parCle([...lourd, partageable], { employees: [] }).charge,
  'la charge ne se compare qu’à l’échelle de l’atelier');

// ===========================================================================
// 6. LE POSTE À LANCER EN PREMIER
// ===========================================================================
const machines = [
  { slug: 'presse', name: 'Presse', importance: 3 },
  { slug: 'dtf', name: 'DTF', importance: 5 },
];
const b9 = parCle([
  mk({ sub_stage: 'prod_pressage', deadline: jour(1) }),
  mk({ sub_stage: 'prod_pressage', deadline: jour(2) }),
  mk({ sub_stage: 'prod_dtf', deadline: jour(1) }),
], { machines });
assert.ok(b9.goulot, 'le poste le plus chargé sous 48 h se signale');
assert.match(b9.goulot.titre, /^Presse porte 2 commandes/, 'c’est le VOLUME qui classe d’abord');

// Une seule commande sur un poste n'est pas un goulot.
assert.ok(!parCle([mk({ sub_stage: 'prod_dtf', deadline: jour(1) })], { machines }).goulot,
  'une commande isolée ne fait pas un poste chargé');
// Et ce qui n'est pas dû sous 48 h ne compte pas.
assert.ok(!parCle([
  mk({ sub_stage: 'prod_dtf', deadline: jour(9) }),
  mk({ sub_stage: 'prod_dtf', deadline: jour(10) }),
], { machines }).goulot, 'un poste chargé la semaine prochaine n’est pas le poste du matin');

// ===========================================================================
// 7. TOUTE PHRASE SE PROUVE, ET L'ÉCRAN N'EN MONTRE PAS DIX
// ===========================================================================
const tout = briefing([
  mk({ deadline: jour(-3), sub_stage: 'prod_pressage' }),
  mk({ stage: 'demande_chiffrage', sub_stage: 'a_chiffrer', deadline: jour(1) }),
  mk({ flag: 'bloque', flag_reason: 'Rupture PVC', updated_at: ilYA(6) }),
  mk({ sub_stage: 'devis_envoye', updated_at: ilYA(9) }),
  mk({ responsable: null }),
], ctx());
for (const o of tout) {
  assert.ok(o.cle && o.titre && o.detail, `${o.cle} : une observation dit toujours quoi et pourquoi`);
  assert.ok(Array.isArray(o.ids) && o.ids.length,
    `${o.cle} : elle nomme les dossiers qui la fondent — sinon on ne peut pas la vérifier`);
  assert.ok(['urgent', 'attention', 'calme'].includes(o.ton), `${o.cle} : ton connu`);
}
assert.ok(tout.length >= 5, 'un atelier en difficulté produit plusieurs observations');
// L'ordre est celui de la journée : ce qui brûle d'abord.
assert.strictEqual(tout[0].cle, 'brulent', 'ce qui doit sortir aujourd’hui vient en tête');

// L'écran en montre CINQ au plus — au-delà, ce n'est plus un briefing.
const DASH = lire('public/dashboard.js');
assert.match(DASH, /const MATIN_MAX = 5;/, 'le briefing est borné');
assert.match(DASH, /items\.slice\(0, MATIN_MAX\)/, '… et la borne est appliquée');
assert.match(DASH, /\+ \$\{items\.length - MATIN_MAX\}/,
  'un plafond muet se lit « il n’y a que ça » : on dit ce qu’on ne montre pas');

// ===========================================================================
// 8. LE MOTEUR NE VA CHERCHER PERSONNE
// ===========================================================================
// Règle du dépôt : rien ne vient d'un autre domaine, et un poste doit s'ouvrir
// sans dépendre d'un tiers joignable. Le briefing est calculé sur le poste.
const SRC = lire('public/matin.js');
assert.ok(!/fetch\(|XMLHttpRequest|api\(|https?:\/\//.test(SRC),
  'le briefing se calcule EN LOCAL : aucun appel réseau, aucun service tiers');
assert.ok(!/\bnew Date\(\)|Date\.now\(\)/.test(SRC),
  'l’horloge est injectée (`now`) : sinon le module n’est plus rejouable');

console.log('matin.test.js OK');
