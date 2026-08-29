'use strict';

// LA BULLE « MISE À JOUR DISPONIBLE » — quand le patron publie, l'atelier
// l'apprend et recharge d'un tap.
// ===========================================================================
// Une tablette du comptoir reste ouverte des jours sur la page chargée le
// premier matin : un déploiement ne l'atteint pas, et personne sur place n'a de
// raison de deviner qu'il faudrait recharger. Le serveur annonce donc
// l'empreinte du site, le poste la compare à la sienne, et propose.
//
// Ce que ce fichier tient, là où ça casse :
//
//   1. L'EMPREINTE PORTE SUR LE CONTENU DE `public/`. Une date de build ou un
//      numéro de déploiement changerait à chaque redémarrage du conteneur :
//      tout l'atelier verrait une bulle pour un site identique, et apprendrait
//      en trois jours à l'ignorer. Le contenu, lui, ne bouge que si un fichier
//      de l'écran a vraiment changé.
//   2. LE SERVEUR ANNONCE SANS QU'ON LUI DEMANDE. L'empreinte part à
//      l'ouverture du flux temps réel — la connexion existe déjà, un
//      déploiement la fait tomber, le poste la rouvre et apprend tout seul.
//      `/api/version` n'est que le filet des postes au flux mort.
//   3. LA BULLE NE MENT PAS ET NE PART PAS SEULE. Elle ne s'allume que si la
//      version reçue n'est pas celle qui tourne à l'écran, elle s'éteint si le
//      patron republie celle-là, et aucun minuteur ne l'efface pendant que la
//      vendeuse a le dos tourné.
//   4. ON NE RECHARGE JAMAIS D'OFFICE. Rien ne recharge sans un tap ; et le tap
//      lui-même demande confirmation quand il y a une saisie à perdre — au
//      comptoir, ce qui est tapé et pas encore envoyé n'existe nulle part
//      ailleurs.
//   5. LE BRANCHEMENT. Le module est écouté par app.js ET présent dans la
//      coquille hors ligne : importé statiquement, absent du cache, c'est le
//      planning ENTIER qui ne s'ouvre plus hors ligne.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const SERVEUR = lire('server.js');
const MAJ = lire('public/maj.js');
const APP = lire('public/app.js');
const SW = lire('public/sw.js');

// Le source d'une fonction nommée, accolades appariées : on fait tourner la
// règle du fichier sans embarquer les 3 000 lignes qui l'entourent.
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

(async () => {
  // =========================================================================
  // 1. L'EMPREINTE — ce qui la fait bouger, et surtout ce qui ne la fait PAS
  //    bouger.
  // =========================================================================
  const bacEmpreinte = { require, console, module: {}, exports: {} };
  vm.createContext(bacEmpreinte);
  vm.runInContext(
    `const path = require('node:path');
     const fs = require('node:fs');
     const crypto = require('node:crypto');
     ${fonction(SERVEUR, 'empreinteDuSite')}
     globalThis.empreinteDuSite = empreinteDuSite;`,
    bacEmpreinte,
  );
  const { empreinteDuSite } = bacEmpreinte;

  const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'olda-maj-'));
  const poser = (nom, contenu) => {
    const cible = path.join(bac, nom);
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.writeFileSync(cible, contenu);
  };
  const siteA = path.join(bac, 'a');
  const siteB = path.join(bac, 'b');
  for (const site of ['a', 'b']) {
    poser(`${site}/app.js`, 'const planning = 1;\n');
    poser(`${site}/styles.css`, '.pcard { color: #111827; }\n');
    poser(`${site}/comptoir/vente-directe.html`, '<!doctype html><p>vente</p>\n');
  }

  // DEUX COPIES DU MÊME SITE, ÉCRITES À DES INSTANTS DIFFÉRENTS, DANS DES
  // DOSSIERS DIFFÉRENTS : même empreinte. C'est exactement ce qu'est un
  // redémarrage de conteneur ou un déploiement qui ne touche que le serveur —
  // et c'est le cas où la bulle ne doit surtout PAS s'allumer.
  assert.strictEqual(
    empreinteDuSite(siteA), empreinteDuSite(siteB),
    "deux copies du même site doivent avoir la même empreinte — sinon chaque redémarrage réveille l'atelier pour rien",
  );
  // Stable d'un appel à l'autre : sans ça, un poste verrait une nouvelle
  // version à chaque reconnexion de son flux.
  assert.strictEqual(empreinteDuSite(siteA), empreinteDuSite(siteA));

  // Un fichier de l'écran qui change : nouvelle empreinte.
  poser('b/app.js', 'const planning = 2;\n');
  assert.notStrictEqual(
    empreinteDuSite(siteA), empreinteDuSite(siteB),
    'un app.js modifié doit changer l’empreinte',
  );

  // LES SOUS-DOSSIERS COMPTENT. Les deux écrans du comptoir vivent dans
  // `public/comptoir/` : ce sont ceux du patron, ils changent en étant
  // REMPLACÉS, et c'est la mise à jour la plus fréquente du dépôt. Une
  // empreinte qui ne descendrait pas dans les dossiers les manquerait tous.
  poser('b/app.js', 'const planning = 1;\n');
  assert.strictEqual(empreinteDuSite(siteA), empreinteDuSite(siteB));
  poser('b/comptoir/vente-directe.html', '<!doctype html><p>vente v2</p>\n');
  assert.notStrictEqual(
    empreinteDuSite(siteA), empreinteDuSite(siteB),
    'un écran du comptoir remplacé doit changer l’empreinte',
  );

  // Un fichier AJOUTÉ compte aussi (nouveau module chargé à la demande).
  poser('b/comptoir/vente-directe.html', '<!doctype html><p>vente</p>\n');
  assert.strictEqual(empreinteDuSite(siteA), empreinteDuSite(siteB));
  poser('b/maj.js', 'export const rien = 0;\n');
  assert.notStrictEqual(empreinteDuSite(siteA), empreinteDuSite(siteB));

  // Un dossier illisible ne doit pas empêcher le serveur de démarrer, et la
  // valeur de repli est CONSTANTE : aucune fausse mise à jour, jamais.
  const absent = empreinteDuSite(path.join(bac, 'nexiste-pas'));
  assert.strictEqual(absent, empreinteDuSite(path.join(bac, 'nexiste-pas-non-plus')),
    'un repli qui varierait allumerait la bulle sur tous les postes à chaque démarrage');

  // Et c'est bien `public/` — donc le contenu des ÉCRANS — qu'on empreinte :
  // une correction qui ne touche que server.js ou db.js n'a rien à recharger.
  assert.match(
    SERVEUR,
    /empreinteDuSite\(path\.join\(__dirname, 'public'\)\)/,
    "l'empreinte doit porter sur public/ : sinon un correctif serveur réveille tout l'atelier",
  );
  fs.rmSync(bac, { recursive: true, force: true });
  console.log('✓ empreinte : le contenu des écrans, pas le déploiement');

  // =========================================================================
  // 2. LE SERVEUR ANNONCE — à l'ouverture du flux, et sur demande.
  // =========================================================================
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

  const rep = await fetch(`${base}/api/version`);
  assert.strictEqual(rep.status, 200);
  const { version } = await rep.json();
  assert.ok(typeof version === 'string' && version.length >= 8, 'une empreinte lisible');
  // `no-store` : la réponse tient en trente octets, une revalidation coûterait
  // autant — et un intermédiaire qui la garderait rendrait le filet aveugle.
  assert.match(String(rep.headers.get('cache-control')), /no-store/);

  // Le flux dit la version SANS QU'ON LUI DEMANDE, dès l'ouverture. C'est tout
  // le mécanisme : un déploiement fait tomber les flux, chaque poste rouvre le
  // sien, et reçoit l'empreinte du site qu'il vient de ne PAS recharger.
  const flux = await fetch(`${base}/api/stream`);
  const lecteur = flux.body.getReader();
  const decodeur = new TextDecoder();
  let trames = '';
  const echeance = Date.now() + 5000;
  while (!trames.includes('event: version') && Date.now() < echeance) {
    const { value, done } = await lecteur.read();
    if (done) break;
    trames += decodeur.decode(value, { stream: true });
  }
  assert.match(trames, /event: version\ndata: /,
    "le flux doit annoncer la version à l'ouverture — sans ça, aucun poste n'apprend rien");
  const annonce = JSON.parse(trames.match(/event: version\ndata: (.+)\n/)[1]);
  assert.strictEqual(annonce.version, version,
    'le flux et /api/version doivent dire la même chose, sinon le filet allume une fausse bulle');
  await lecteur.cancel();
  console.log('✓ serveur : la version part à l’ouverture du flux, et sur demande');

  // =========================================================================
  // 3-4. LA BULLE — sa décision, son dessin, et ce qu'elle refuse de faire.
  // =========================================================================
  // On charge le VRAI module (les imports remplacés par des doublures), pas une
  // copie : une copie ne prouverait que sa propre exactitude.
  const minuteurs = [];
  const rechargements = [];
  const confirmations = [];
  let reponseConfirmation = true;

  const faireNoeud = (tag) => {
    const classes = new Set();
    return {
      tag,
      className: '',
      textContent: '',
      type: '',
      disabled: false,
      attrs: {},
      enfants: [],
      ecouteurs: {},
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
      setAttribute(k, v) { this.attrs[k] = v; },
      append(...n) { this.enfants.push(...n); },
      appendChild(n) { this.enfants.push(n); return n; },
      addEventListener(t, f) { (this.ecouteurs[t] = this.ecouteurs[t] || []).push(f); },
    };
  };
  const corps = faireNoeud('body');
  const doc = {
    hidden: false,
    body: corps,
    ecouteurs: {},
    createElement: faireNoeud,
    createElementNS: (_ns, tag) => faireNoeud(tag),
    addEventListener(t, f) { (this.ecouteurs[t] = this.ecouteurs[t] || []).push(f); },
  };

  const bacMaj = {
    document: doc,
    window: { location: { reload: () => rechargements.push(1) } },
    navigator: {},           // pas de service worker : rien à rafraîchir
    console,
    // NI `requestAnimationFrame` NI RIEN QUI L'IMITE. Il est mis en pause quand
    // l'onglet n'est pas visible — la situation même d'un déploiement, tablette
    // en veille : la bulle serait posée et ne s'ouvrirait jamais. Son absence
    // ici fait tomber le test le jour où quelqu'un le réintroduit.
    setTimeout: (f, ms) => { minuteurs.push(ms); return 0; },
    clearTimeout: () => {},
    setInterval: (f, ms) => { minuteurs.push(ms); return 0; },
    confirmerAction: async (titre, texte, ok) => {
      confirmations.push({ titre, texte, ok });
      return reponseConfirmation;
    },
    fetchBorne: async () => ({ ok: false }),
  };
  vm.createContext(bacMaj);
  vm.runInContext(
    `${MAJ.replace(/^import .*$/gm, '').replace(/^export\s+/gm, '')}
     globalThis.noterVersion = noterVersion;
     globalThis.dessinerBulle = dessinerBulle;`,
    bacMaj,
  );
  const { noterVersion } = bacMaj;

  const texteDe = (n) => [n.textContent || '', ...n.enfants.map(texteDe)].join(' ');
  const chercher = (n, tag) => (n.tag === tag ? n
    : n.enfants.reduce((trouve, e) => trouve || chercher(e, tag), null));

  // LA PREMIÈRE VERSION REÇUE EST CELLE QUI TOURNE À L'ÉCRAN. Elle n'allume
  // rien : le poste vient de charger la page, il EST à jour.
  assert.strictEqual(noterVersion('aaaaaaaaaaaa'), false);
  assert.strictEqual(corps.enfants.length, 0, 'aucune bulle au chargement de la page');
  // Le flux se rouvre dix fois dans la journée sans déploiement : rien.
  assert.strictEqual(noterVersion('aaaaaaaaaaaa'), false);
  assert.strictEqual(corps.enfants.length, 0);
  // Une réponse vide ou illisible ne fabrique pas d'évènement.
  for (const bruit of [undefined, null, '', 42, {}]) {
    assert.strictEqual(noterVersion(bruit), false, 'une trame illisible n’allume rien');
  }
  assert.strictEqual(corps.enfants.length, 0);

  // Le patron publie : la bulle s'allume.
  assert.strictEqual(noterVersion('bbbbbbbbbbbb'), true);
  assert.strictEqual(corps.enfants.length, 1, 'la bulle est posée');
  const bulle = corps.enfants[0];
  assert.strictEqual(bulle.className, 'maj');
  assert.ok(bulle.classList.contains('open'), 'la bulle doit être ouverte, pas seulement posée');
  assert.strictEqual(bulle.attrs.role, 'status');

  // AUCUN MINUTEUR NE L'EFFACE. Ce n'est pas un toast : elle s'effacerait
  // pendant que la vendeuse a le dos tourné, et personne ne saurait jamais
  // qu'une version l'attendait.
  assert.deepStrictEqual(minuteurs, [],
    'la bulle ne doit armer aucun minuteur — elle attend son tap');

  // Deuxième déploiement dans la foulée : toujours UNE bulle, pas une pile.
  assert.strictEqual(noterVersion('cccccccccccc'), true);
  assert.strictEqual(corps.enfants.length, 1, 'une seule bulle, jamais deux');

  // RETOUR ARRIÈRE : le patron republie la version que ce poste exécute déjà.
  // Il n'y a plus rien à recharger — la bulle s'éteint d'elle-même plutôt que
  // de rester à mentir jusqu'au soir.
  assert.strictEqual(noterVersion('aaaaaaaaaaaa'), false);
  assert.ok(!bulle.classList.contains('open'), 'un retour arrière doit éteindre la bulle');
  assert.strictEqual(noterVersion('cccccccccccc'), true);
  assert.ok(bulle.classList.contains('open'));

  // Le texte parle à la vendeuse, pas à un développeur : ni empreinte, ni
  // « version », ni jargon de déploiement.
  const texte = texteDe(bulle);
  assert.ok(texte.includes('Mise à jour disponible'), texte);
  assert.ok(texte.includes('Mettre à jour'), texte);
  assert.ok(!texte.includes('cccccccccccc'), 'l’empreinte ne s’affiche pas à l’écran');
  assert.ok(!/déploiement|cache|service worker/i.test(texte), texte);

  // L'icône est DESSINÉE. La police de l'app est un sous-ensemble figé de 91
  // glyphes : ni `refresh`, ni `sync`, ni `update` n'y sont, et un nom absent
  // s'affiche en toutes lettres tronquées à sa première, sans la moindre erreur.
  assert.ok(chercher(bulle, 'svg'), 'la flèche doit être dessinée, pas tirée de la police');
  assert.ok(!/material-symbols/.test(MAJ),
    'aucune ligature Material dans la bulle : `refresh` et `update` sont absents de la police');

  // ON NE RECHARGE PAS D'OFFICE : la bulle est à l'écran depuis tout à l'heure
  // et rien n'a bougé.
  assert.deepStrictEqual(rechargements, [], 'afficher la bulle ne recharge rien');

  const bouton = chercher(bulle, 'button');
  assert.ok(bouton, 'la bulle porte un vrai bouton');
  assert.strictEqual(bouton.type, 'button');
  const taper = async () => {
    for (const f of bouton.ecouteurs.click || []) await f();
    await new Promise((r) => process.nextTick(r));
  };

  // Le tap recharge — c'est tout ce qu'on lui demande.
  await taper();
  assert.strictEqual(rechargements.length, 1, 'le tap recharge l’écran');
  assert.strictEqual(confirmations.length, 0, 'rien à perdre : pas de question inutile');
  assert.strictEqual(bouton.disabled, true, 'le bouton se ferme pendant le rechargement');
  console.log('✓ bulle : s’allume sur une vraie nouveauté, s’éteint sur un retour arrière');

  // =========================================================================
  // 4 bis. LA SAISIE EN COURS — le tap malheureux, au comptoir.
  // =========================================================================
  // Même module, état neuf : on refait le parcours avec une saisie ouverte.
  const bac2 = { ...bacMaj };
  const corps2 = faireNoeud('body');
  const rechargements2 = [];
  const doc2 = { ...doc, body: corps2, createElement: faireNoeud };
  bac2.document = doc2;
  bac2.window = { location: { reload: () => rechargements2.push(1) } };
  vm.createContext(bac2);
  vm.runInContext(
    `${MAJ.replace(/^import .*$/gm, '').replace(/^export\s+/gm, '')}
     globalThis.noterVersion = noterVersion;
     globalThis.surveillerMaj = surveillerMaj;`,
    bac2,
  );
  bac2.surveillerMaj({ saisieEnCours: () => true, fluxVivant: () => true });
  bac2.noterVersion('aaaaaaaaaaaa');
  bac2.noterVersion('bbbbbbbbbbbb');
  const bouton2 = chercher(corps2.enfants[0], 'button');
  const taper2 = async () => {
    for (const f of bouton2.ecouteurs.click || []) await f();
    await new Promise((r) => process.nextTick(r));
  };

  // ON DEMANDE, ET ON DIT CE QUI SE PERD. Au comptoir, ce qui est tapé et pas
  // encore envoyé n'existe nulle part ailleurs.
  reponseConfirmation = false;
  await taper2();
  assert.strictEqual(confirmations.length, 1, 'une saisie en cours doit être signalée');
  assert.ok(/enregistr/i.test(confirmations[0].texte), confirmations[0].texte);
  assert.deepStrictEqual(rechargements2, [], 'un « Annuler » ne recharge RIEN');
  assert.strictEqual(bouton2.disabled, false, 'le bouton reste tapable après un « Annuler »');

  // Et si on confirme, on recharge.
  reponseConfirmation = true;
  await taper2();
  assert.strictEqual(rechargements2.length, 1);
  console.log('✓ saisie en cours : on demande avant de jeter, et « Annuler » ne recharge rien');

  // =========================================================================
  // 5. LE BRANCHEMENT
  // =========================================================================
  assert.match(APP, /import \{[^}]*noterVersion[^}]*\} from '\.\/maj\.js'/,
    'app.js doit importer la bulle');
  assert.match(APP, /addEventListener\('version'/,
    "app.js doit écouter l'évènement `version` du flux : c'est par là qu'arrive l'annonce");
  assert.match(APP, /surveillerMaj\(\{/, 'la surveillance doit être démarrée');
  // Ce qu'on refuse de jeter sans prévenir — dont le comptoir, où se perdent
  // les dossiers.
  assert.match(APP, /saisieEnCours:[^\n]*comptoirOuvert\(\)/,
    'un parcours du comptoir ouvert doit compter comme une saisie en cours');
  assert.match(
    lire('public/nouveau-projet.js'), /export function parcoursOuvert\(\)/,
    'Nouveau Projet doit dire si un parcours est à l’écran',
  );

  // LA COQUILLE HORS LIGNE. `maj.js` est importé STATIQUEMENT par app.js :
  // absent du cache, son import échoue et c'est le planning entier qui ne
  // s'ouvre plus hors ligne — la panne la plus chère du dépôt.
  assert.match(SW, /'\/maj\.js',/,
    'maj.js doit figurer dans la coquille : un import statique absent du cache tue toute l’application hors ligne');

  // Le style existe, et la bulle passe SOUS la boîte de confirmation (1300) —
  // sinon la question s'ouvre derrière ce qui l'a posée.
  const CSS = require('./feuilles-crm').cssCrm();   // styles.css + les cinq feuilles d'ecran
  assert.match(CSS, /\.maj \{/, 'la bulle doit avoir son style');
  const zMaj = Number(CSS.match(/\.maj \{[\s\S]*?z-index: (\d+)/)[1]);
  const zAsk = Number(CSS.match(/\.ask \{[\s\S]*?z-index: (\d+)/)[1]);
  assert.ok(zMaj < zAsk, `la bulle (${zMaj}) doit passer sous la confirmation (${zAsk})`);
  // LA BOÎTE RONDE DE LA CHARTE (`--rond`). La justification a changé le
  // 26/08 sans que la valeur bouge : ce n'est plus « une cible prenable au
  // doigt sur une tablette posée à plat » — les tablettes sont au rebut depuis
  // le 21/08 — c'est la boîte de tout ce qui se clique sans porter de mot,
  // celle du bouton « revenir ». Le nombre ne s'écrit plus qu'à un endroit.
  assert.match(CSS, /\.maj__btn \{[\s\S]*?min-height: var\(--rond\)/,
    'le bouton de la bulle prend la boîte ronde de la charte');
  console.log('✓ branchement : écouté par le planning, dans la coquille, sous la confirmation');

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
