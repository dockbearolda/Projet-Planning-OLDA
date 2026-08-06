'use strict';

// Audit du 06/08/2026 au soir — ce que la journée d'optimisation avait cassé,
// et ce qu'elle avait laissé passer.
//
//   1. LA SYNTHÈSE DU POINT DU JOUR NE TRANSPORTAIT NI LES TECHNIQUES DE
//      MARQUAGE NI L'ADRESSE E-MAIL. Le matin même, la liste avait appris à
//      porter les techniques à plat pour que la pondération « machine » compte
//      dès le chiffrage — mais le Point du jour a basculé, dans le même
//      commit, sur /api/requests/synthese, qui ne rend pas `fiche` du tout. La
//      pondération est donc restée morte, et chercher une adresse e-mail
//      trouvait la commande au planning et rien sur le Point du jour.
//   2. UNE COMMANDE TROUVÉE PAR LA RECHERCHE GLOBALE POUVAIT ÊTRE INJOIGNABLE.
//      Le serveur ne rend que les 400 dernières lignes d'une étape ; « Paiement
//      & clôture » garde tout l'historique. Cliquer un résultat plus ancien
//      ouvrait la bonne étape… sans la ligne, sans surbrillance et sans un mot.
//   3. UN ÉVÈNEMENT TEMPS RÉEL FAISAIT RETÉLÉCHARGER SA LISTE À TOUS LES POSTES,
//      y compris ceux qui regardaient une autre famille. Le serveur nomme les
//      étapes touchées dans l'évènement ; personne ne les lisait — et il n'en
//      nommait aucune quand une ligne changeait de famille ou disparaissait.
//   4. LA FILE « À FAIRE MAINTENANT » N'AVAIT AUCUN PLAFOND : elle montait
//      autant de cartes que le planning compte de commandes actives, toutes
//      reconstruites à chaque évènement. La vue perso plafonne à 10, la grille
//      du planning à 400 ; celle-ci à rien.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

// Découpe une fonction dans un source : de sa signature jusqu'à l'accolade
// fermante posée à la MÊME indentation.
function bloc(src, signature) {
  const from = src.indexOf(signature);
  assert.ok(from >= 0, `bloc introuvable : ${signature}`);
  const indent = signature.match(/^\s*/)[0];
  const to = src.indexOf(`\n${indent}}`, from);
  assert.ok(to > from, `fin de bloc introuvable : ${signature}`);
  return src.slice(from, to + indent.length + 2);
}

(async () => {
  process.env.PORT = '0';
  const app = require('../server');
  const base = await new Promise((resolve) => {
    const check = () => {
      const s = app && app.__server;
      if (s && s.listening) resolve(`http://127.0.0.1:${s.address().port}`);
      else setTimeout(check, 25);
    };
    check();
  });

  const call = async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return {
      status: res.status,
      tronque: res.headers.get('X-Liste-Tronquee'),
      body: res.status === 204 ? null : await res.json(),
    };
  };

  // =========================================================================
  // 1. La synthèse porte ce que le Point du jour lit vraiment
  // =========================================================================
  // Une commande de polos marqués en DTF, prise par Nouveau Projet : elle entre
  // au chiffrage, donc bien AVANT la production — c'est tout l'enjeu de la
  // pondération « machine ».
  const projet = await call('POST', '/api/projets', {
    kind: 'commande',
    delai: 'j5',
    client: { type: 'pro', societe: 'Audit Synthèse', email: 'contact@audit-synthese.sx' },
    lignes: [{
      type: 'textile', quantite: 3, designation: 'Polo', prixUnitaireTtc: 30,
      faces: { avant: { emplacement: 'coeur', technique: 'dtf' } },
      tailles: { M: 3 },
    }],
    paiement: { mode: 'cb', paye: true },
  });
  assert.strictEqual(projet.status, 201, JSON.stringify(projet.body));
  const idProjet = projet.body.id;

  const synthese = (await call('GET', '/api/requests/synthese')).body;
  const ligne = synthese.lignes.find((l) => l.id === idProjet);
  assert.ok(ligne, 'la commande figure dans la synthèse');
  assert.deepStrictEqual(
    ligne.fiche && ligne.fiche.techniques, ['dtf'],
    'la synthèse transporte la technique de marquage — sans elle, la pondération machine est morte',
  );
  assert.strictEqual(
    ligne.contact_email, 'contact@audit-synthese.sx',
    'la synthèse transporte l’e-mail : la recherche du Point du jour le cherche',
  );

  // Ce qu'elle ne transporte PAS : le récapitulatif complet du comptoir, qui
  // pèse plusieurs kilo-octets PAR commande et n'a rien à faire ici.
  assert.ok(
    !ligne.fiche.client && !ligne.fiche.details && !ligne.fiche.paiement,
    'la synthèse reste un résumé : elle ne remonte pas la fiche entière',
  );
  const ordinaire = synthese.lignes.find((l) => l.id !== idProjet && !l.fiche);
  assert.ok(ordinaire !== undefined || synthese.lignes.length === 1,
    'une ligne sans technique connue ne se voit pas inventer de fiche');

  // La forme incrémentale rend exactement la même chose.
  const depuis = new Date(Date.now() - 60000).toISOString();
  const incr = (await call('GET', `/api/requests/synthese?depuis=${encodeURIComponent(depuis)}`)).body;
  const ligneIncr = incr.lignes.find((l) => l.id === idProjet);
  assert.deepStrictEqual(
    ligneIncr.fiche && ligneIncr.fiche.techniques, ['dtf'],
    'la synthèse incrémentale porte les mêmes champs que la première',
  );

  // Et le moteur de priorité sait s'en servir.
  const PRIORITY = lire('priority.js');
  const bacPrio = {};
  vm.createContext(bacPrio);
  vm.runInContext(
    `${PRIORITY.replace(/^export /gm, '')}\n globalThis.machineOf = machineOf;`,
    bacPrio,
  );
  assert.strictEqual(
    bacPrio.machineOf(ligne), 'dtf',
    'une commande au chiffrage est rattachée à sa machine par ce que la synthèse transporte',
  );

  // =========================================================================
  // 2. Une commande hors des 400 dernières reste joignable
  // =========================================================================
  // On dépasse volontairement le plafond de l'étape la plus chargée.
  const vieille = await call('POST', '/api/requests', {
    stage: 'paiement', billing_company: 'ZZZ Archive 2025', product: 'Tasse gravée',
  });
  assert.strictEqual(vieille.status, 201);
  const idVieille = vieille.body.id;

  const paquet = [];
  for (let i = 0; i < 410; i += 1) {
    paquet.push(call('POST', '/api/requests', {
      stage: 'paiement', billing_company: `Récente ${i}`, product: `Commande ${i}`,
    }));
    if (paquet.length >= 30) await Promise.all(paquet.splice(0));
  }
  await Promise.all(paquet);

  const liste = await call('GET', '/api/requests?stage=paiement');
  assert.strictEqual(liste.body.length, 400, 'la liste reste plafonnée');
  assert.strictEqual(liste.tronque, '400', 'et l’écran est prévenu qu’elle est coupée');
  assert.ok(
    !liste.body.some((r) => r.id === idVieille),
    'la commande ancienne est bien HORS de la liste servie par défaut — c’est le piège',
  );
  const trouvee = await call('GET', '/api/requests/recherche?q=ZZZ%20Archive');
  assert.ok(
    trouvee.body.some((r) => r.id === idVieille),
    'la recherche globale, elle, la trouve : c’est de là que vient le clic',
  );
  const complete = await call('GET', '/api/requests?stage=paiement&tout=1');
  assert.ok(
    complete.body.some((r) => r.id === idVieille),
    'et « tout afficher » la ramène — c’est le repli que le saut doit déclencher',
  );

  // L'écran : le saut lève le plafond quand la ligne visée n'est pas montée.
  const APP = lire('app.js');
  const contexte = {
    SUB_LABEL: { prod_uv: 'Production UV' },
    PROMOTED: [],
    journal: [],
    rows: [{ id: 'deja-la' }],
    toutAfficher: false,
    showToast: (t) => contexte.journal.push(`toast:${t}`),
    // La liste se monte par tranches : le saut attend qu'elle soit posée avant
    // de conclure quoi que ce soit (voir TRANCHE_RENDU dans app.js). Ici elle
    // l'est toujours — ce test-ci porte sur le plafond, pas sur le rendu.
    listeMontee: Promise.resolve(),
  };
  contexte.setViewMode = (m) => { contexte.journal.push(`vue:${m}`); };
  contexte.selectStage = async (slug, sub) => { contexte.journal.push(`etape:${slug}|${sub || ''}`); };
  contexte.loadRows = async () => {
    contexte.journal.push(`liste:${contexte.toutAfficher ? 'tout' : 'plafonnee'}`);
    contexte.rows = [...contexte.rows, { id: 'hors-plafond' }];
  };
  contexte.revealRow = (rid) => {
    contexte.journal.push(`pointe:${rid}`);
    return contexte.rows.some((r) => String(r.id) === String(rid));
  };
  contexte.location = { hash: '#planning' };
  contexte.history = { replaceState: (_a, _b, h) => { contexte.location.hash = h; } };
  vm.createContext(contexte);
  vm.runInContext(
    `${bloc(APP, 'async function ouvrirCommandeAuPlanning(')}
     globalThis.ouvrir = ouvrirCommandeAuPlanning;`,
    contexte,
  );

  // Ligne déjà montée : rien de plus à charger.
  await contexte.ouvrir({ id: 'deja-la', stage: 'production', sub: 'prod_uv' });
  assert.ok(
    !contexte.journal.some((l) => l.startsWith('liste:')),
    'une ligne déjà à l’écran ne déclenche aucun rechargement',
  );

  // Ligne hors du plafond : on lève le plafond, une fois, puis on la pointe.
  contexte.journal.length = 0;
  contexte.toutAfficher = false;
  contexte.rows = [{ id: 'deja-la' }];
  await contexte.ouvrir({ id: 'hors-plafond', stage: 'paiement', sub: null });
  assert.deepStrictEqual(
    contexte.journal,
    // On tente d'abord la grille en place — c'est gratuit et c'est le cas
    // courant. C'est l'ÉCHEC de cette tentative qui lève le plafond.
    ['vue:planning', 'etape:paiement|', 'pointe:hors-plafond', 'liste:tout', 'pointe:hors-plafond'],
    'la commande introuvable dans la liste plafonnée déclenche la lecture complète, puis le saut',
  );
  assert.strictEqual(contexte.toutAfficher, true, 'le plafond est levé pour cette étape');

  // Introuvable même après tout avoir chargé : on le DIT, on ne laisse pas
  // l'employé devant une grille muette (c'est là qu'on ressaisit un dossier).
  contexte.journal.length = 0;
  contexte.toutAfficher = false;
  contexte.rows = [{ id: 'deja-la' }];
  contexte.loadRows = async () => { contexte.journal.push('liste:tout'); };
  await contexte.ouvrir({ id: 'disparue', stage: 'paiement', sub: null });
  assert.ok(
    contexte.journal.some((l) => l.startsWith('toast:')),
    'une commande introuvable jusqu’au bout est signalée à l’écran',
  );

  // =========================================================================
  // 3. Le temps réel dit QUELLE étape a bougé — et l'écran l'écoute
  // =========================================================================
  // Le serveur : une ligne qui change de famille concerne les DEUX.
  const bougee = await call('POST', '/api/requests', {
    stage: 'production', sub_stage: 'prod_uv', billing_company: 'Audit Diffusion',
  });
  const flux = await fetch(`${base}/api/stream`);
  const lecteur = flux.body.getReader();
  const decodeur = new TextDecoder();
  const evenements = [];
  const lecture = (async () => {
    let tampon = '';
    while (evenements.length < 3) {
      const { value, done } = await lecteur.read();
      if (done) break;
      tampon += decodeur.decode(value, { stream: true });
      for (const trame of tampon.split('\n\n')) {
        const m = trame.match(/^event: change\ndata: (.*)$/m);
        if (m) evenements.push(JSON.parse(m[1]));
      }
      tampon = tampon.slice(tampon.lastIndexOf('\n\n') + 2);
    }
  })();

  await call('PATCH', `/api/requests/${bougee.body.id}`, { stage: 'facturation' });
  await call('PATCH', `/api/requests/${bougee.body.id}`, { priority: 3 });
  await call('DELETE', `/api/requests/${bougee.body.id}`);
  await Promise.race([lecture, new Promise((r) => setTimeout(r, 3000))]);
  await lecteur.cancel().catch(() => {});

  assert.ok(evenements.length >= 3, `3 évènements attendus, reçus : ${evenements.length}`);
  assert.deepStrictEqual(
    [...evenements[0].stages].sort(), ['facturation', 'production'],
    'un déplacement nomme l’étape quittée ET l’étape rejointe — sinon le poste qui '
    + 'regardait l’ancienne garde la ligne à l’écran',
  );
  assert.deepStrictEqual(evenements[1].stages, ['facturation'], 'une modification sur place n’en nomme qu’une');
  assert.deepStrictEqual(
    evenements[2].stages, ['facturation'],
    'une suppression nomme l’étape où la ligne vivait',
  );

  // L'écran : la rafale d'évènements se CUMULE, elle ne se remplace pas.
  const bacFlux = {};
  vm.createContext(bacFlux);
  vm.runInContext(
    `${bloc(APP, 'function noterEvenement(')}
     ${bloc(APP, 'function viderRafale(')}
     ${APP.match(/^const rafale = .*$/m)[0]}
     globalThis.noterEvenement = noterEvenement;
     globalThis.viderRafale = viderRafale;`,
    bacFlux,
  );

  bacFlux.noterEvenement({ kind: 'update', stages: ['production'] });
  bacFlux.noterEvenement({ kind: 'update', stages: ['facturation'] });
  let vue = bacFlux.viderRafale();
  assert.ok(
    vue.etapes.has('production') && vue.etapes.has('facturation'),
    'deux évènements dans la même rafale : les deux étapes comptent, pas seulement la dernière',
  );
  assert.strictEqual(vue.toutes, false, 'aucune raison de tout relire ici');
  // `[...]` : les tableaux nés dans le bac à sable n'ont pas le prototype de
  // ce module, et `deepStrictEqual` compare aussi les prototypes.
  assert.deepStrictEqual(
    [...vue.natures].sort(), ['update'],
    'la nature des évènements de la rafale est retenue',
  );

  // Un réglage du patron coalescé derrière une commande déplacée ne se perd pas.
  bacFlux.noterEvenement({ kind: 'machines' });
  bacFlux.noterEvenement({ kind: 'update', stages: ['production'] });
  vue = bacFlux.viderRafale();
  assert.ok(vue.natures.includes('machines'), 'le réglage du patron survit à la coalescence');
  assert.strictEqual(
    vue.toutes, true,
    'un évènement qui ne nomme aucune étape ne dit pas « aucune » : il dit « on ne sait pas »',
  );

  vue = bacFlux.viderRafale();
  assert.strictEqual(vue.etapes.size, 0, 'la rafale est vidée après lecture');
  assert.strictEqual(vue.toutes, false);

  // poll() sait ne rafraîchir QUE les compteurs.
  const poll = bloc(APP, 'async function poll(');
  assert.match(
    poll, /listeAussi/,
    'poll sait se limiter aux compteurs quand la famille affichée n’est pas concernée',
  );
  assert.match(
    APP, /poll\(\{ listeAussi:/,
    'le temps réel lui passe la décision',
  );

  // =========================================================================
  // 4. La file « À faire maintenant » a un plafond
  // =========================================================================
  const DASH = lire('dashboard.js');
  const todo = bloc(DASH, '  function buildTodoView(');
  assert.match(
    todo, /TODO_MAX/,
    'la file plafonne le nombre de cartes montées — sinon elle monte tout le planning actif',
  );
  const max = Number((DASH.match(/const TODO_MAX = (\d+)/) || [])[1]);
  assert.ok(max > 0 && max <= 100, `plafond attendu entre 1 et 100, trouvé : ${max}`);
  assert.match(
    todo, /queue\.slice\(0, TODO_MAX\)/,
    'seules les premières cartes sont construites',
  );
  assert.match(
    todo, /queue\.length > TODO_MAX/,
    'et l’écran dit combien de commandes il ne montre pas — un plafond muet se lit « il n’y a que ça »',
  );

  console.log('✓ audit 06/08 soir : synthèse complète (techniques + e-mail), commande '
    + 'hors plafond joignable, temps réel ciblé par étape, file du Point du jour plafonnée');
  app.__server.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
