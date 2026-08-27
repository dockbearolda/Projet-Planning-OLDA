'use strict';

const { ecran } = require('./ecran-comptoir');

// AUDIT DU 18/08 — ce que le comptoir facturait, écrivait et dédoublonnait de
// travers depuis les évolutions des 17 et 18/08.
// ===========================================================================
// Cinq défauts, tous dans le chemin « la vendeuse prend une commande » :
//
//   1. LE PALIER EXPRESS SE CALCULAIT SUR LA VEILLE. `businessDaysBetween`
//      lisait ses deux dates à sec (`new Date("2026-08-24")` = minuit UTC,
//      soit dimanche 20 h à Saint-Martin). Le jour de la semaine lu était
//      celui de la veille : sur 5 000 couples de dates, 228 (4,6 %) tombaient
//      dans le mauvais palier — donc le mauvais SUPPLÉMENT facturé au client
//      et la mauvaise priorité au planning. `saveProduct` avait été corrigé
//      le 17/08, pas ce comptage.
//   2. LES RACCOURCIS POSAIENT UNE DATE DE WEEK-END. « Dans 5 jours » un mardi
//      donne un dimanche : l'écran affichait aussitôt son propre bandeau rouge
//      « l'atelier est fermé le week-end » sous une date qu'il venait de poser.
//   3. « DÉLAI SOUHAITÉ » DÉCRIVAIT LE FORMULAIRE, PAS LE DOSSIER. `due` et
//      `priority` partent du PREMIER ARTICLE depuis le 17/08 ; la phrase du
//      récapitulatif, elle, lisait encore ce qui était tapé à l'instant.
//   4. LE FORMAT INTERNATIONAL CASSAIT LA DÉTECTION DE DOUBLON. Les fiches en
//      base sont au format français (« 06 42 26 69 49 ») ; depuis l'indicatif
//      pays, le comptoir écrivait « +590 642 26 69 49 » — mêmes chiffres pour
//      un humain, aucun rapprochement pour les écrans, une SECONDE fiche pour
//      le même client.
//   5. UN NUMÉRO ÉTRANGER TRONQUÉ PASSAIT LA VALIDATION. Le relais posait un
//      plancher de huit chiffres au lieu de la longueur du pays : « +1721 520
//      12 » était accepté et partait en base.
//
// Les règles sont éprouvées sur le VRAI source — découpé dans les fichiers,
// jamais recopié ici : une copie ne prouverait que sa propre exactitude.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const VENTE = ecran('vente-directe');
const PONT = lire('comptoir/pont.js');

// Le source d'une fonction nommée, accolades appariées : c'est ce qui permet
// de faire tourner la règle du fichier sans embarquer les 3 000 lignes qui
// l'entourent (et leur DOM).
function fonction(src, nom) {
  const debut = src.indexOf(`function ${nom}(`);
  assert.ok(debut >= 0, `« function ${nom}( » doit rester repérable — la règle a été renommée`);
  const ouvrante = src.indexOf('{', debut);
  let profondeur = 0;
  for (let i = ouvrante; i < src.length; i += 1) {
    if (src[i] === '{') profondeur += 1;
    else if (src[i] === '}') {
      profondeur -= 1;
      if (profondeur === 0) return src.slice(debut, i + 1);
    }
  }
  throw new Error(`accolades non appariées pour ${nom}`);
}

// L'atelier est à Saint-Martin. C'est LE fuseau où le défaut se voit : à l'est
// de Greenwich, minuit UTC tombe le bon jour et tout paraît juste.
assert.strictEqual(process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
  Intl.DateTimeFormat().resolvedOptions().timeZone);

// ===========================================================================
// 1. LE PALIER EXPRESS — le supplément que paie le client
// ===========================================================================
const bacDates = vm.createContext({ Date, Number, String, Math });
vm.runInContext(
  `${fonction(VENTE, 'jourCivil')}\n${fonction(VENTE, 'businessDaysBetween')}\n`
  + 'function palier(a,b){const n=businessDaysBetween(a,b);return n<=5?"j5":n<=10?"j10":"j15";}',
  bacDates,
);
const joursOuvres = (a, b) => vm.runInContext(`businessDaysBetween(${JSON.stringify(a)},${JSON.stringify(b)})`, bacDates);
const palier = (a, b) => vm.runInContext(`palier(${JSON.stringify(a)},${JSON.stringify(b)})`, bacDates);

// La référence, écrite ici à la main : du lendemain de la commande jusqu'au
// jour de récupération inclus, samedis et dimanches exclus.
function joursOuvresAttendus(a, b) {
  const d = new Date(`${a}T12:00:00Z`);
  const fin = new Date(`${b}T12:00:00Z`);
  let n = 0;
  while (d < fin) {
    d.setUTCDate(d.getUTCDate() + 1);
    const j = d.getUTCDay();
    if (j !== 0 && j !== 6) n += 1;
  }
  return n;
}

// Le cas d'école : mardi 18/08 → dimanche 23/08. Trois jours ouvrés (mer, jeu,
// ven), pas quatre — l'ancien code lisait lundi 17 → samedi 22 et en comptait
// quatre, week-end décalé compris.
assert.strictEqual(joursOuvres('2026-08-18', '2026-08-23'), 3,
  'un dimanche ne se compte pas, et la veille non plus');

// Balayage : 200 jours de commande × 25 délais. AUCUN écart toléré, ni sur le
// compte ni sur le palier — c'est de l'argent.
{
  const depart = new Date('2026-08-01T12:00:00Z');
  let vus = 0;
  let ecarts = 0;
  let exemple = null;
  for (let i = 0; i < 200; i += 1) {
    const a = new Date(depart);
    a.setUTCDate(a.getUTCDate() + i);
    const isoA = a.toISOString().slice(0, 10);
    for (let k = 1; k <= 25; k += 1) {
      const b = new Date(a);
      b.setUTCDate(b.getUTCDate() + k);
      const isoB = b.toISOString().slice(0, 10);
      vus += 1;
      const attendu = joursOuvresAttendus(isoA, isoB);
      if (joursOuvres(isoA, isoB) !== attendu) {
        ecarts += 1;
        if (!exemple) exemple = `${isoA} → ${isoB} : ${joursOuvres(isoA, isoB)} au lieu de ${attendu}`;
      }
    }
  }
  assert.strictEqual(vus, 5000, 'le balayage doit couvrir ce qu\'il annonce');
  assert.strictEqual(ecarts, 0, `jours ouvrés comptés de travers (${ecarts} cas) — ex. ${exemple}`);
}

// Et le défaut lui-même, rejoué : la version « à sec » DOIT échouer, sinon ce
// test ne prouve rien (il passerait aussi bien sur du code non corrigé).
{
  const bacAncien = vm.createContext({ Date, Number, String });
  vm.runInContext(
    'function ancien(start,end){const a=new Date(start),b=new Date(end);'
    + 'let c=0,d=new Date(a);while(d<b){d.setDate(d.getDate()+1);'
    + 'if(d.getDay()!==0&&d.getDay()!==6)c++;}return c;}',
    bacAncien,
  );
  const ancien = vm.runInContext('ancien("2026-08-18","2026-08-23")', bacAncien);
  assert.notStrictEqual(ancien, 3,
    'l\'ancien comptage doit rester faux ici : sinon le fuseau de la machine '
    + 'masque le défaut et ce test ne garde plus rien');
}

// Les trois paliers, sur des couples choisis à la main.
assert.strictEqual(palier('2026-08-18', '2026-08-24'), 'j5');   // 4 jours ouvrés
assert.strictEqual(palier('2026-08-18', '2026-09-01'), 'j10');  // 10 jours ouvrés
assert.strictEqual(palier('2026-08-18', '2026-09-08'), 'j15');  // 15 jours ouvrés

// ===========================================================================
// 2. LES RACCOURCIS NE POSENT PLUS DE WEEK-END
// ===========================================================================
{
  const champs = { orderDate: { value: '' }, deliveryDate: { value: '' } };
  const bac = vm.createContext({
    Date,
    Number,
    String,
    document: { getElementById: (id) => champs[id] },
    updateDeadlineInfo() {},
    window: {},
  });
  vm.runInContext(
    `${fonction(VENTE, 'jourCivil')}\n${fonction(VENTE, 'isoDate')}\n${fonction(VENTE, 'setDeliveryInDays')}`,
    bac,
  );

  // Chaque jour de commande de l'année, chaque raccourci : jamais un samedi,
  // jamais un dimanche. C'est la seule règle — l'écran refuse tout le reste.
  const depart = new Date('2026-01-01T12:00:00Z');
  let poses = 0;
  for (let i = 0; i < 365; i += 1) {
    const a = new Date(depart);
    a.setUTCDate(a.getUTCDate() + i);
    champs.orderDate.value = a.toISOString().slice(0, 10);
    for (const jours of [5, 10, 15]) {
      vm.runInContext(`setDeliveryInDays(${jours})`, bac);
      const pose = champs.deliveryDate.value;
      const j = new Date(`${pose}T12:00:00Z`).getUTCDay();
      assert.ok(j !== 0 && j !== 6,
        `« Dans ${jours} jours » depuis le ${champs.orderDate.value} pose le ${pose}, `
        + 'un jour de week-end que l\'écran refuse aussitôt');
      // Le raccourci reste un raccourci : il ne s'éloigne jamais de plus de
      // deux jours de ce qu'il annonce.
      const ecart = Math.round(
        (new Date(`${pose}T12:00:00Z`) - new Date(`${champs.orderDate.value}T12:00:00Z`)) / 86400000,
      );
      assert.ok(ecart >= jours && ecart <= jours + 2,
        `« Dans ${jours} jours » a posé une date à ${ecart} jours`);
      poses += 1;
    }
  }
  assert.strictEqual(poses, 365 * 3);
}

// ===========================================================================
// 3. « DÉLAI SOUHAITÉ » DÉCRIT LE DOSSIER, PAS LA FRAPPE EN COURS
// ===========================================================================
{
  const champs = { orderDate: { value: '2026-08-18' }, deliveryDate: { value: '2026-09-08' } };
  const bac = vm.createContext({
    Date,
    Number,
    String,
    document: { getElementById: (id) => champs[id] },
    window: {},
    products: [],
  });
  vm.runInContext(
    `${fonction(VENTE, 'jourCivil')}\n${fonction(VENTE, 'businessDaysBetween')}\n`
    + `${fonction(VENTE, 'palierDeDates')}\n`
    + 'const LIBELLE_PALIER={j5:"Sous 5 jours ouvrés (urgent)",'
    + 'j10:"Sous 10 jours ouvrés (prioritaire)",j15:"Au-delà de 10 jours ouvrés (standard)"};\n'
    + `${fonction(VENTE, 'datesDuDossier')}\n${fonction(VENTE, 'deliveryDelayLabel')}`,
    bac,
  );
  const libelle = () => vm.runInContext('deliveryDelayLabel()', bac);

  // Panier vide : c'est bien le formulaire qui parle.
  assert.strictEqual(libelle(), 'Au-delà de 10 jours ouvrés (standard)');

  // L'article est enregistré en standard, puis la vendeuse commence un second
  // article en urgence SANS l'enregistrer (ou corrige la date du formulaire).
  // Le dossier part avec l'échéance du premier : la phrase doit la décrire.
  bac.products.push({ orderDate: '2026-08-18', deliveryDate: '2026-09-08' });
  champs.deliveryDate.value = '2026-08-20';
  assert.strictEqual(libelle(), 'Au-delà de 10 jours ouvrés (standard)',
    'la phrase du récapitulatif suivait le formulaire : elle annonçait « urgent » '
    + 'sous une échéance standard, et le supplément facturé disait le contraire');
}

// ===========================================================================
// 4 & 5. LE TÉLÉPHONE — doublons de fiches et numéros tronqués
// ===========================================================================
// Les règles pures de `pont.js`, découpées du fichier et jouées telles quelles.
{
  const DEBUT = PONT.indexOf('  const PAYS_TEL = [');
  const FIN = PONT.indexOf('  // --- fin des règles du téléphone');
  assert.ok(DEBUT > 0 && FIN > DEBUT, 'le bloc « téléphone » doit rester repérable dans pont.js');
  const bac = vm.createContext({ String, Number, Set, Array });
  vm.runInContext(PONT.slice(DEBUT, FIN), bac);
  const appel = (expr) => vm.runInContext(expr, bac);

  // --- 4. Le même abonné, des deux côtés du comptoir -----------------------
  // Ce que la base contient déjà (78 fiches importées), et ce que la vendeuse
  // saisit maintenant avec le sélecteur de pays. Les deux doivent donner les
  // MÊMES chiffres, sinon aucun doublon n'est jamais signalé.
  const memeAbonne = [
    ['06 42 26 69 49', '33', '642266949'],      // métropole
    ['06 90 66 24 00', '590', '690662400'],     // Saint-Martin · Guadeloupe
    ['05 90 87 12 34', '590', '590871234'],     // fixe Guadeloupe
    ['06 96 12 34 56', '596', '696123456'],     // Martinique
  ];
  for (const [enBase, code, local] of memeAbonne) {
    const saisi = appel(`telAssembler(${JSON.stringify(code)},${JSON.stringify(local)})`);
    const chiffres = (s) => String(s).replace(/\D/g, '');
    assert.strictEqual(chiffres(saisi), chiffres(enBase),
      `« ${enBase} » en base contre « ${saisi} » au comptoir : le même client `
      + 'repartirait avec une seconde fiche');
    // …et la saisie se relit : rouvrir la fiche doit retrouver le même pays.
    const decoupe = appel(`JSON.stringify(telDecouper(${JSON.stringify(enBase)}))`);
    assert.deepStrictEqual(JSON.parse(decoupe), { code, local },
      `« ${enBase} » ne se relit pas dans le bon pays`);
  }

  // Le « + » reste à ce pour quoi il a été ajouté : les numéros que l'ancien
  // plan à dix chiffres tronquait.
  assert.strictEqual(appel('telAssembler("1721","5201234")'), '+1721 520 1234');
  assert.strictEqual(appel('telAssembler("1","3055551234")'), '+1 305 555 1234');
  assert.strictEqual(appel('telAssembler("1264","4971234")'), '+1264 497 1234');
  assert.strictEqual(appel('telAssembler("31","612345678")'), '+31 6 12 34 56 78');

  // --- 5. La longueur exigée est celle du PAYS -----------------------------
  const valide = (v) => appel(
    `(function(){const r=telDecouper(${JSON.stringify(v)});`
    + 'return telPays(r.code)?telComplet(r.code,r.local):telChiffres(' + JSON.stringify(v) + ').length>=8;})()',
  );
  assert.strictEqual(valide('+1721 520 1234'), true, 'un numéro de Sint Maarten complet passe');
  assert.strictEqual(valide('+1721 520 12'), false,
    'un numéro de Sint Maarten amputé passait le plancher de huit chiffres et '
    + 'partait en base : il n\'appelle personne');
  assert.strictEqual(valide('+590 690 66 2'), false, 'neuf chiffres attendus pour le 590');
  assert.strictEqual(valide('06 90 66 24 00'), true, 'les fiches déjà en base restent valides');
  assert.strictEqual(valide('+1 305 555 1234'), true);
  assert.strictEqual(valide('+1 305 555'), false);

  // Le relais lui-même est bien branché sur cette règle (et pas resté sur le
  // plancher) : on relit la ligne de `relayerValidation`.
  const relais = PONT.slice(PONT.indexOf('function relayerValidation'), PONT.indexOf('function grefferLesIndicatifs'));
  assert.ok(/telComplet\(code, local\)/.test(relais),
    'isValidLocalPhone doit exiger la longueur du pays, pas un plancher');

  // --- 5 bis. wa.me n'ouvre plus la conversation d'un inconnu -------------
  // Les deux écrans collent « 590 » devant TOUT numéro français à dix chiffres
  // (`waHref` côté vente, `normalizePhone` côté devis) : un portable de
  // métropole ouvrait donc « wa.me/590642266949 » — un abonné guadeloupéen qui
  // n'a rien demandé. Le relais s'applique désormais à tous les numéros, pas
  // seulement à ceux qui portent un « + ».
  vm.runInContext(fonction(PONT, 'telInternational'), bac);
  const wa = (v) => appel(`telInternational(${JSON.stringify(v)})`);
  assert.strictEqual(wa('06 42 26 69 49'), '33642266949', 'un portable de métropole part en +33');
  assert.strictEqual(wa('06 90 66 24 00'), '590690662400', 'un portable de Saint-Martin part en +590');
  assert.strictEqual(wa('06 96 12 34 56'), '596696123456', 'et un portable de Martinique en +596');
  assert.strictEqual(wa('+1721 520 1234'), '17215201234');
  assert.strictEqual(wa('06 42 26 69'), null, 'un numéro qu\'on ne sait pas lire n\'ouvre aucune conversation');
  assert.strictEqual(wa(''), null);

  // La même règle que le planning : les deux doivent s'accorder, sinon la
  // pastille de la ligne et le bouton du comptoir n'appellent pas le même monde.
  {
    const WA = lire('whatsapp.js');
    const bacWa = vm.createContext({ String, Number });
    vm.runInContext(`${WA.replace(/^export\s+/gm, '')}\nglobalThis.whatsappNumber = whatsappNumber;`, bacWa);
    for (const numero of ['06 42 26 69 49', '06 90 66 24 00', '06 96 12 34 56', '+1721 520 1234']) {
      assert.strictEqual(wa(numero), bacWa.whatsappNumber(numero),
        `le comptoir et le planning doivent lire « ${numero} » pareil`);
    }
  }

  // Et le branchement : sans relais inconditionnel, la correction ne sort pas
  // de ce fichier de test.
  assert.ok(/relayerToujours\('normalizePhone', telInternational\)/.test(relais)
    && /relayerToujours\('waHref'/.test(relais),
  'les deux fonctions des écrans doivent être relayées POUR TOUS les numéros');
}

// ===========================================================================
// 6. CE QUI NE DOIT PAS REVENIR
// ===========================================================================
// La règle de la date civile, élargie : le contrôle du 17/08 ne regardait que
// les `new Date(...)` dont l'argument nommait `deliveryDate`, `orderDate` ou
// `.value` — c'est exactement par là que `businessDaysBetween(start,end)` est
// passé. On interdit désormais TOUT `new Date(x)` à un seul argument qui n'est
// ni un littéral horodaté, ni une Date, ni un nombre.
{
  // Les commentaires CITENT le défaut (« new Date("2026-08-24") est minuit
  // UTC ») : c'est du texte, pas du code. On les retire avant de lire.
  const src = VENTE
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
  const argDeNewDate = (s, ouvrante) => {
    let profondeur = 0;
    for (let j = ouvrante; j < s.length; j += 1) {
      if (s[j] === '(') profondeur += 1;
      else if (s[j] === ')') {
        profondeur -= 1;
        if (profondeur === 0) return s.slice(ouvrante + 1, j);
      }
    }
    return '';
  };
  // Ce qui a le droit d'entrer dans un `new Date(…)` sans heure : une autre
  // Date, un nombre d'année/mois/jour (plusieurs arguments), un instant déjà
  // horodaté, ou une valeur qu'on vient de construire à midi.
  const SUR = /^(\s*)$|T\d{2}:|getTime\(\)|,|^\s*(d|a|b|x|date|remise|curseur|target|prev|first|dt)\s*$|^\s*new Date/;
  let controles = 0;
  for (const m of src.matchAll(/new Date\s*\(/g)) {
    const arg = argDeNewDate(src, m.index + m[0].length - 1);
    if (SUR.test(arg)) continue;
    controles += 1;
    assert.fail(
      `vente-directe.html : « new Date(${arg.trim()}) » lit une date civile à minuit UTC, `
      + 'soit la veille à Saint-Martin. Passer par jourCivil().',
    );
  }
  assert.strictEqual(controles, 0);
}

// L'astérisque ne réclame plus deux prix quand un seul suffit.
assert.ok(!/for="articlePrice">Prix article \*/.test(VENTE)
  && !/for="customPrice">Prix personnalisation \*/.test(VENTE),
'les deux parts du prix ne sont pas obligatoires chacune : l\'astérisque mentait');
assert.ok(/Prix obligatoire \* — l’un des deux, ou les deux/.test(VENTE),
  'la règle du prix doit être écrite à l\'écran, là où elle s\'applique');

// Le code mort ne revient pas : `addBusinessDays` n'avait plus d'appelant et
// portait la même lecture de date à sec.
assert.ok(!/function addBusinessDays/.test(VENTE),
  'addBusinessDays n\'a aucun appelant — et rejouait le défaut de fuseau');

console.log('✓ audit 18/08 : palier express au bon jour, raccourcis ouvrés, délai du dossier, doublons clients et numéros complets OK');
