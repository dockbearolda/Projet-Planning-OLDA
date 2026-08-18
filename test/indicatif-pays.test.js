'use strict';

// L'INDICATIF DU PAYS, AU COMPTOIR.
// ===========================================================================
// Saint-Martin est une île frontière : le côté français (+590) et le côté
// néerlandais (+1721) se croisent au comptoir toute la journée, et les clients
// de passage arrivent des États-Unis, d'Anguilla ou de métropole.
//
// Les deux écrans du patron ne savaient écrire qu'un plan français à dix
// chiffres : ils TRONQUAIENT au-delà et réclamaient « des chiffres manquants »
// sur un numéro de Philipsburg parfaitement valide. L'indicatif se choisit
// désormais devant le numéro, et c'est `pont.js` qui le greffe — un écran
// remplacé par une nouvelle version du patron le retrouve tout seul.
//
// On n'exécute pas une copie des règles : on découpe le VRAI source de
// `pont.js` et on le fait tourner. Une règle réécrite ici ne prouverait rien.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const PONT = lire('comptoir/pont.js');

const DEBUT = PONT.indexOf('  const PAYS_TEL = [');
const FIN = PONT.indexOf('  // --- fin des règles du téléphone');
assert.ok(DEBUT > 0 && FIN > DEBUT, 'le bloc « téléphone » doit rester repérable dans pont.js');

const bac = { module: {} };
vm.createContext(bac);
vm.runInContext(
  `${PONT.slice(DEBUT, FIN)}
   globalThis.PAYS_TEL = PAYS_TEL;
   globalThis.telAssembler = telAssembler;
   globalThis.telDecouper = telDecouper;
   globalThis.telComplet = telComplet;
   globalThis.telGrouper = telGrouper;`,
  bac,
);
const { PAYS_TEL, telAssembler, telDecouper, telComplet, telGrouper } = bac;

// `telDecouper` rend un objet NÉ DANS LE BAC : son prototype vient d'un autre
// contexte, et `deepStrictEqual` les compare. On le ramène côté test.
const decouper = (v) => ({ ...telDecouper(v) });

// ===========================================================================
// 1. LE CATALOGUE DIT L'ÎLE
// ===========================================================================
const codes = PAYS_TEL.map((p) => p.code);
assert.strictEqual(codes[0], '590', 'le côté français vient en tête : c’est le cas courant');
for (const attendu of ['590', '1721', '33', '1']) {
  assert.ok(codes.includes(attendu), `l’indicatif +${attendu} doit être proposé`);
}
assert.strictEqual(new Set(codes).size, codes.length, 'aucun indicatif en double');

// ===========================================================================
// 2. CE QUI PART EN BASE
// ===========================================================================
// DEUX RÉGIMES, ET C'EST VOULU.
//
// Un numéro au plan français s'écrit COMME AVANT — « 06 90 66 24 00 ». Les
// fiches déjà en base sont toutes à ce format, et c'est sur les CHIFFRES du
// numéro que les deux écrans reconnaissent un client qu'on connaît déjà : les
// passer tous à l'international faisait échouer ce rapprochement en silence
// (« 06 42 26 69 49 » en base contre « +590 642 26 69 49 » au comptoir), et la
// même personne repartait avec une SECONDE fiche. Les deux formes désignent de
// toute façon le même abonné pour wa.me — `whatsappNumber` déduit l'indicatif
// du préfixe mobile (section 5).
//
// Le « + » reste à ce pour quoi il a été ajouté : les numéros réellement
// étrangers, que l'ancien plan à dix chiffres tronquait. Il n'y est pas
// décoratif — `whatsappNumber()` y lit « c'est déjà international, ne devine
// pas l'indicatif au préfixe mobile ».
assert.strictEqual(telAssembler('590', '690662400'), '06 90 66 24 00');
assert.strictEqual(telAssembler('33', '612345678'), '06 12 34 56 78');
assert.strictEqual(telAssembler('596', '696123456'), '06 96 12 34 56');
assert.strictEqual(telAssembler('1721', '5201234'), '+1721 520 1234');
assert.strictEqual(telAssembler('1', '3055550142'), '+1 305 555 0142');
assert.strictEqual(telAssembler('31', '612345678'), '+31 6 12 34 56 78');
assert.strictEqual(telAssembler('590', ''), '', 'sans numéro, pas d’indicatif tout seul en base');
// Une frappe INCOMPLÈTE ne prend pas la forme nationale : elle n'a pas encore
// le compte, et l'écrire « 06 90 66 » la ferait passer pour un numéro local.
assert.strictEqual(telAssembler('590', '69066'), '+590 690 66');

// Un numéro en cours de frappe se groupe sans se compléter de blancs.
assert.strictEqual(telGrouper('590', '690'), '690');
assert.strictEqual(telGrouper('590', '69066'), '690 66');

// ===========================================================================
// 3. ROUVRIR UNE FICHE DÉJÀ ENREGISTRÉE
// ===========================================================================
// LE PLUS LONG INDICATIF GAGNE. « 1721 » commence par « 1 » : pris dans l'ordre
// du catalogue, un numéro de Sint Maarten repartirait en américain avec quatre
// chiffres de trop dans sa partie locale.
assert.deepStrictEqual(decouper('+1721 520 1234'), { code: '1721', local: '5201234' });
assert.deepStrictEqual(decouper('+1 305 555 0142'), { code: '1', local: '3055550142' });
assert.deepStrictEqual(decouper('+590 690 66 24 00'), { code: '590', local: '690662400' });

// Les fiches d'AVANT sont au format local français : l'indicatif s'y devine au
// préfixe mobile, exactement comme le fait déjà le planning.
assert.deepStrictEqual(decouper('0690 66 24 00'), { code: '590', local: '690662400' });
assert.deepStrictEqual(decouper('0696 12 34 56'), { code: '596', local: '696123456' });
assert.deepStrictEqual(decouper('06 12 34 56 78'), { code: '33', local: '612345678' });
// LES FIXES COMPTENT AUTANT que les mobiles au comptoir : « 05 90 87 12 34 »
// est un fixe de Guadeloupe / Saint-Martin. Lu au seul préfixe mobile, il
// rouvrait la fiche du voisin d'en face en « France métropole ».
assert.deepStrictEqual(decouper('05 90 87 12 34'), { code: '590', local: '590871234' });
assert.deepStrictEqual(decouper('05 96 71 23 45'), { code: '596', local: '596712345' });
assert.deepStrictEqual(decouper('05 94 29 12 34'), { code: '594', local: '594291234' });

// Rien de lisible : on retombe sur le côté français, sans rien perdre de ce qui
// était écrit — la vendeuse voit le numéro et corrige le pays d'un geste.
assert.deepStrictEqual(decouper(''), { code: '590', local: '' });
assert.deepStrictEqual(decouper(null), { code: '590', local: '' });

// Un aller-retour ne doit rien abîmer : c'est ce que fait la fiche qu'on rouvre.
for (const numero of ['06 90 66 24 00', '05 90 87 12 34', '06 12 34 56 78',
  '+1721 520 1234', '+1 305 555 0142', '+31 6 12 34 56 78']) {
  const { code, local } = decouper(numero);
  assert.strictEqual(telAssembler(code, local), numero, `aller-retour intact pour ${numero}`);
}

// ===========================================================================
// 4. COMPLET SE DIT PAR PAYS
// ===========================================================================
// C'est tout l'objet du sélecteur : dix chiffres n'est pas une vérité
// universelle. Sint Maarten en a sept après son indicatif, les États-Unis dix.
assert.ok(telComplet('590', '690662400'), '9 chiffres : un mobile antillais est complet');
assert.ok(!telComplet('590', '69066240'), '8 : il en manque un');
assert.ok(telComplet('1721', '5201234'), '7 chiffres : un numéro de Sint Maarten est complet');
assert.ok(!telComplet('1721', '5201234567'), 'et 10 en font trois de trop');
assert.ok(telComplet('1', '3055550142'));
assert.ok(!telComplet('zzz', '690662400'), 'un pays inconnu ne valide rien');

// ===========================================================================
// 5. LE NUMÉRO RESTE LISIBLE PAR WHATSAPP
// ===========================================================================
// La chaîne produite ici traverse `whatsappNumber()` pour devenir une adresse
// wa.me. Si les deux ne s'accordaient pas, la pastille du planning ouvrirait une
// conversation avec un inconnu — on l'éprouve pour de vrai.
(async () => {
  // Même méthode que test/whatsapp.test.js : le dépôt est en CommonJS, on
  // charge le vrai module du navigateur en lui retirant ses `export`.
  const WA = lire('whatsapp.js');
  const bacWa = {};
  vm.createContext(bacWa);
  vm.runInContext(`${WA.replace(/^export\s+/gm, '')}
     globalThis.whatsappNumber = whatsappNumber;`, bacWa);
  const { whatsappNumber } = bacWa;
  assert.strictEqual(whatsappNumber(telAssembler('590', '690662400')), '590690662400');
  assert.strictEqual(whatsappNumber(telAssembler('1721', '5201234')), '17215201234');
  assert.strictEqual(whatsappNumber(telAssembler('1', '3055550142')), '13055550142');
  assert.strictEqual(whatsappNumber(telAssembler('33', '612345678')), '33612345678');

  // ===========================================================================
  // 6. LA GREFFE TIENT AUX MÊMES REPÈRES QUE LE RESTE
  // ===========================================================================
  assert.ok(/const CHAMPS_TEL = \[/.test(PONT), 'les champs greffés restent listés en un seul endroit');
  for (const champ of ['newCompanyPhone', 'newIndividualPhone', 'newClientPhone']) {
    assert.ok(PONT.includes(`'${champ}'`), `${champ} doit rester greffé`);
    const ecran = champ.startsWith('newClient') ? 'demande-devis.html' : 'vente-directe.html';
    assert.ok(lire(`comptoir/${ecran}`).includes(`id="${champ}"`),
      `${champ} doit exister sur ${ecran} — sinon la greffe ne trouve rien et se tait`);
  }
  // Le champ d'origine est CLONÉ, pas réutilisé : un clone n'emporte aucun des
  // écouteurs que l'écran a posés pour son plan français à dix chiffres.
  assert.ok(/cloneNode\(false\)/.test(PONT), 'la greffe doit remplacer le champ par un clone');
  assert.ok(/relais\.__oldaTel = true/.test(PONT),
    'un relais ne doit s’installer qu’une fois');

  // ===========================================================================
  // 7. LES TROIS FONCTIONS QUI TRONQUAIENT
  // ===========================================================================
  // `phoneDigits` de l'écran des devis coupe à DIX CHIFFRES — l'hypothèse
  // française, enfouie. Trois fonctions en héritent, et chacune casse autrement
  // sur un numéro international. Elles doivent TOUTES être relayées : en oublier
  // une suffit à écrire un numéro faux en base ou à ouvrir la conversation
  // WhatsApp d'un inconnu.
  const DEVIS = lire('comptoir/demande-devis.html');
  assert.ok(/slice\(0, ?10\)/.test(DEVIS),
    'la troncature à dix chiffres est bien la prémisse : si elle disparaît de '
    + 'l’écran, ces relais n’ont plus lieu d’être');
  // `normalizePhone` est relayée SANS CONDITION (relayerToujours) : elle collait
  // « 590 » devant tout numéro français à dix chiffres, y compris un portable
  // de métropole. Les deux autres ne se déclenchent que sur l'international.
  for (const nom of ['isValidLocalPhone', 'formatFrenchPhone', 'normalizePhone']) {
    assert.ok(new RegExp(`relayer(Toujours)?\\('${nom}'`).test(PONT),
      `${nom} doit être relayée : sans elle, un numéro international est tronqué`);
    assert.ok(DEVIS.includes(`function ${nom}(`),
      `${nom} doit exister sur l’écran des devis — sinon le relais ne relaie rien`);
  }
  // Le relais ne s'applique QU'À l'international : les fiches d'avant sont
  // toutes au format local français et ne doivent rien changer.
  assert.ok(/const estInternational = \(v\) => String\(v == null \? '' : v\)\.trim\(\)\.startsWith\('\+'\)/.test(PONT),
    'c’est le « + » qui distingue les deux régimes, rien d’autre');

  console.log('✓ indicatif : catalogue, format international, relecture des fiches d’avant et accord avec wa.me OK');
})();
