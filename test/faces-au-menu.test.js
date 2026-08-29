'use strict';

// ON COCHE LES FACES, ON NE LES TAPE PAS (29/08/2026)
// ===========================================================================
// Charlie, en désignant la rangée « Faces » de la fiche atelier : « pour les
// textiles ici les faces doivent être sélectionnables via un menu, et cocher ce
// que le client souhaite : avant, coeur, dos etc. »
//
// Le bouton « + Face » demandait un NOM LIBRE. Or sur un textile les six
// emplacements sont connus : ils sont déclarés par la famille dans Réglages →
// Tailles de logo, et c'est déjà par ce nom que la largeur du logo se retrouve
// (`refs[REF][FACE][TAILLE]`). Taper « coeur » là où le tableau dit « Coeur »,
// c'est perdre la mesure sans que rien ne le signale.
//
// Ce fichier tient quatre choses :
//
//   1. LA CASCADE, rejouée sur le VRAI instantané des familles — et sur le vrai
//      code, extrait d'app.js, jamais recopié ici ;
//   2. LE MENU : ce qu'il liste, où vit la création, et de qui il tient sa
//      rangée ;
//   3. LES DEUX PIÈGES payés en le construisant (la liste qui se dépliait à
//      l'horizontale, Échap qui fermait le dossier) ;
//   4. CÔTÉ SERVEUR : une fiche SANS `prod` accepte sa première écriture —
//      sans quoi la colonne Production est en lecture seule sur les 187
//      dossiers de la production, où `fiche.prod` n'existe sur aucun.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const APP = lire('public/app.js');
const FICHE = lire('public/fiche-atelier.js');
const CSS = lire('public/fiche-atelier.css');
const CSS_CRM = lire('public/styles.css');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

// ---------------------------------------------------------------------------
// 1. LA CASCADE, SUR LE VRAI CODE ET LE VRAI TABLEAU
// ---------------------------------------------------------------------------
// On EXTRAIT `cleFamille` + `facesProposees` d'app.js et on les exécute : une
// copie de la règle dans le test dérive, et c'est alors le test qui ment. Le
// tableau, lui, est l'instantané semé en base (`tailles-logo-seed.json`).
const deb = APP.indexOf('const cleFamille = ');
assert.ok(deb > 0, 'la clé de rapprochement doit se lire dans app.js');
const fin = APP.indexOf('\n}\n', APP.indexOf('function facesProposees(r) {')) + 3;
assert.ok(fin > deb, 'la cascade doit se lire dans app.js');

const bac = vm.createContext({});
vm.runInContext(
  `let taillesLogo = null;\n${APP.slice(deb, fin)}\n`
  + 'this.API = { facesProposees, poser: (t) => { taillesLogo = t; } };',
  bac,
);
const { facesProposees, poser } = bac.API;
poser(JSON.parse(lire('tailles-logo-seed.json')));

const TEXTILE = ['Coeur', 'Poitrine', 'Avant', 'Dos', 'Manche DR', 'Manche GA'];

// LA RÉFÉRENCE D'ABORD. K3025 est rangée « Homme » dans le tableau, et c'est
// cette famille qui porte les six emplacements — c'est le cas du textile, celui
// que Charlie désignait.
assert.deepStrictEqual(facesProposees({ fiche: { prod: { ref: 'K3025' } } }), TEXTILE,
  'une référence textile ramène les six emplacements de sa famille');
assert.deepStrictEqual(facesProposees({ fiche: { prod: { ref: ' k3025 ' } } }), TEXTILE,
  '… quelle que soit la casse et les espaces : le tableau et le catalogue ne se sont jamais mis d’accord');
assert.deepStrictEqual(facesProposees({ fiche: { prod: { ref: 'W101' } } }),
  ['Face Optimisée 205 x 205 mm', 'Face Classique 250 x 250 mm'],
  'un tote bag a SES deux faces, pas celles d’un t-shirt');

// L'ARTICLE ENSUITE, et les pluriels sont tolérés — « Casquette » au catalogue,
// « Casquettes » au tableau.
assert.deepStrictEqual(facesProposees({ product: 'Casquettes' }), ['Avant'],
  'une casquette n’a qu’un emplacement');
assert.deepStrictEqual(facesProposees({ product: 'Casquette' }), ['Avant'],
  '… et le pluriel ne le fait pas rater');

// ET LA RÉFÉRENCE PASSE AVANT L'ARTICLE : un couteau et une planche vivent tous
// deux dans « Art de la table » et ne se gravent pas au même endroit.
assert.deepStrictEqual(
  facesProposees({ product: 'Casquettes', fiche: { prod: { ref: 'K3025' } } }), TEXTILE,
  'la référence l’emporte sur le nom de l’article');

// LE REPLI EN DERNIER, et c'est une DONNÉE — la famille « Par défaut » du
// tableau. La vider rend le comportement d'avant, au pixel près.
assert.deepStrictEqual(facesProposees({ product: 'Tableau photo contrecollé' }),
  ['Face à marquer'], 'ce que personne n’a déclaré tient au repli');
assert.deepStrictEqual(facesProposees({}), ['Face à marquer'],
  '… y compris un dossier qui ne dit rien du tout');
// TABLEAU VIDE (ou injoignable) : rien à proposer, et la saisie libre reprend la
// main — exactement l'écran d'avant. ⚠ On compare la LONGUEUR : le tableau
// vide est fabriqué DANS le bac à sable, et `deepStrictEqual` refuse deux
// tableaux vides qui ne viennent pas du même realm.
poser({ familles: [] });
assert.strictEqual(facesProposees({ product: 'Casquettes' }).length, 0,
  'tableau vide : rien à proposer');
poser(JSON.parse(lire('tailles-logo-seed.json')));

// LE TABLEAU SE LIT UNE FOIS PAR SESSION, et il se périme quand un réglage bouge.
assert.match(APP, /Promise\.all\(\[chargerFicheComplete\(id\)\.catch\(\(\) => \{\}\), chargerTaillesLogo\(\)\]\)/,
  'il part avec la fiche, jamais au démarrage');
assert.match(APP, /taillesLogo = null;\s*\n\s*taillesLogoEnVol = null;/,
  '… et un `settings` du flux le périme : quelqu’un vient peut-être d’ajouter une face');

// ---------------------------------------------------------------------------
// 2. LE MENU : CE QU'IL LISTE, ET OÙ VIT LA CRÉATION
// ---------------------------------------------------------------------------
assert.match(FICHE, /const ajoutF = bouton\('fa-ajout', '\+ Face', ouvrirMenuF\);/,
  'le bouton OUVRE le menu — il ne demande plus de taper un nom');
// ⚠ ON CHERCHE L'APPEL, PAS LE MOT : le commentaire qui explique pourquoi il n'y
// en a pas dit « PAS DE `prompt()` », et le contrôle tombait sur sa propre
// explication.
const FICHE_NUE = FICHE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
assert.ok(!/\bprompt\(/.test(FICHE_NUE),
  'et toujours pas de `prompt()` : il gèle la page et sort le focus de l’écran');

// LA LISTE = CE QUE LA FAMILLE DÉCLARE + CE QUE LE DOSSIER PORTE DÉJÀ. Sans le
// second morceau, une face ajoutée à la main — ou héritée d'une famille qui a
// changé depuis — ne pourrait plus se décocher : elle est à l'écran, et absente
// du seul endroit d'où on la retire.
assert.match(FICHE, /const choixF = Array\.isArray\(ctx\.facesProposees\) \? \[\.\.\.ctx\.facesProposees\] : \[\];/,
  'le menu part de ce que la famille déclare');
assert.match(FICHE, /if \(z\.face && !choixF\.some\(\(n\) => cleF\(n\) === cleF\(z\.face\)\)\) choixF\.push\(z\.face\);/,
  '… et ajoute ce que le dossier porte déjà, sinon on ne peut plus le décocher');
assert.match(FICHE, /if \(!choixF\.length\) \{ saisirFace\(\); return; \}/,
  'rien de déclaré nulle part : la saisie libre reprend la main, un menu vide ne dit rien à personne');

// LA CRÉATION N'EST PAS UN CHOIX DE LA LISTE (même règle qu'au comptoir, où une
// option `__new__` avait été refusée) : elle vit sous un filet, avec sa propre
// icône. Posée comme une ligne parmi les autres, elle se coche par erreur — et
// ce qu'elle ouvre n'est pas une face, c'est un champ.
const bloc = FICHE.slice(FICHE.indexOf('const ouvrirMenuF'), FICHE.indexOf('const ajoutF = bouton'));
assert.ok(bloc.indexOf("el('div', 'fa-filet')") < bloc.indexOf("'Autre face…'"),
  'la création vient APRÈS un filet : elle ne se mélange pas aux choix');
assert.match(bloc, /liste\.append\(el\('div', 'fa-filet'\)\);/,
  '… et c’est le filet de la fiche, pas un trait redessiné pour l’occasion');

// UNE FACE SE RETIRE EN EFFAÇANT SON NOM, et les places en trop s'effacent avec
// elle : sans ça, retirer la face du MILIEU laisse la dernière en double (le
// patch est positionnel, la liste se compacte, la dernière entrée retombe sur
// une place déjà occupée).
assert.match(FICHE, /\.\.\.faces\.slice\(voulues\.length\)\.map\(\(\) => \(\{ face: '' \}\)\)/,
  'les places en trop s’effacent : le patch des faces est positionnel');
assert.match(FICHE, /if \(ctx\.rafraichir\) ctx\.rafraichir\(\);/,
  'une face de plus ou de moins change la STRUCTURE : la fiche se redessine');
assert.ok(!/setTimeout\(\(\) => ctx\.rafraichir\(\), \d+\)/.test(FICHE),
  '… au retour du serveur, pas après un délai deviné');

// DÉCOCHER UNE FACE QUI PORTE QUELQUE CHOSE, C'EST LE PERDRE : la cote et la
// consigne partent avec elle, et le redessin qui suit vide la pile
// d'annulation. On demande — jamais pour une face vide, ou décocher deviendrait
// un clic sur deux.
assert.match(FICHE, /if \(\(z\.mm \|\| z\.quoi\) && ctx\.confirmer\) \{/,
  'une face qui porte une cote ou une consigne demande confirmation');
assert.match(APP, /confirmer: \(titre, texte, libelle\) => confirmerAction\(titre, texte, libelle\),/,
  '… avec la boîte de l’application, passée par le contexte (la fiche n’importe rien elle-même)');
// LE MENU SE FERME AVANT LA QUESTION. Laissé ouvert, il se refermait de toute
// façon au premier clic dans la boîte — l'écouteur « dehors » voit ce clic — et
// annuler ne rendait donc pas l'écran d'avant.
const basc = FICHE.slice(FICHE.indexOf('const basculerFace'), FICHE.indexOf('const saisirFace'));
assert.ok(basc.indexOf('fermerMenuF();') < basc.indexOf('ctx.confirmer'),
  'le menu se ferme AVANT la question, jamais après');

// ---------------------------------------------------------------------------
// 3. LES DEUX PIÈGES PAYÉS EN LE CONSTRUISANT
// ---------------------------------------------------------------------------
// a. LA RANGÉE EST CELLE DU PANNEAU « COLONNES » — deux listes à cocher dans la
//    même application ne s'écrivent pas deux fois.
assert.match(FICHE, /bouton\(`colbar-item \$\{on \? 'is-on' : 'is-off'\}`/,
  'la rangée du menu est celle du panneau « Colonnes »');
assert.match(CSS_CRM.replace(/\/\*[\s\S]*?\*\//g, ''), /\n\.colbar-item \{[^}]*min-height: var\(--ctrl-h\)/,
  '… dont la hauteur reste le jeton de l’application');

// b. MAIS PAS `.colbar-list`. Elle porte un repli `flex-flow: wrap` sous 900 px
//    qui a du sens dans un tiroir pleine hauteur et aucun ici : le menu se
//    dépliait à l'HORIZONTALE, six cases en escalier sur 837 px de large.
//    C'est `.fa-menu` qui empile — et c'est SON flex qui étire les rangées,
//    parce que `.colbar-item` fait `width: 100%` et qu'un pourcentage contre un
//    conteneur en `max-content` vaut `auto` (81 à 141 px mesurés sans lui).
assert.ok(!/colbar-list/.test(FICHE_NUE),
  '`.colbar-list` n’entre pas dans la fiche : son repli sous 900 px couche le menu');
const REPLI = CSS_CRM.slice(CSS_CRM.indexOf('@media (max-width: 900px)'));
assert.match(REPLI.slice(0, REPLI.indexOf('\n}\n')), /\.colbar-list \{[^}]*flex-wrap: wrap/,
  '… et ce repli existe bien : c’est lui qu’on évite');
const MENU = CSS.match(/\.fa-menu \{[\s\S]*?\n\}/)[0];
assert.match(MENU, /display: flex; flex-direction: column;/,
  '`.fa-menu` empile lui-même, et étire ses rangées');
assert.match(MENU, /width: max-content; max-width: 100%;/,
  'sa largeur suit son contenu — « Face Optimisée 205 x 205 mm » comme « Avant » — sans sortir de la colonne');

// c. IL VIT DANS LA RANGÉE, EN ABSOLU. Posé sur le document en `fixed`, il
//    resterait accroché à l'écran pendant que la fiche défile sous lui — et la
//    fiche défile depuis le 28/08.
assert.match(MENU, /position: absolute;/, 'le menu est ancré à sa rangée');
assert.ok(!/position: fixed/.test(MENU), '… jamais à l’écran');
assert.match(CSS, /\.fa-row--ancre \{ position: relative; \}/,
  '… et c’est la rangée qui porte l’ancre');
assert.match(FICHE, /rangee\('Faces', bandeF, ajoutF, 'fa-row--empile fa-row--ancre'\)/,
  '… celle des faces');

// d. ÉCHAP FERME LE MENU, PAS LE DOSSIER. `app.js` écoute Échap pour fermer la
//    fiche : sans capture ni arrêt, refermer le menu refermait le dossier
//    derrière — et ce qu'on venait y chercher avec.
assert.match(FICHE, /document\.addEventListener\('keydown', clavierF, true\);/,
  'l’écouteur du menu passe en CAPTURE : celui de la fiche est sur le document');
assert.match(FICHE, /ev\.stopPropagation\(\);\s*\n\s*fermerMenuF\(\);/,
  '… et il arrête là : sinon Échap ferme les deux d’un coup');
assert.match(FICHE, /document\.removeEventListener\('keydown', clavierF, true\);/,
  'et les deux écouteurs se retirent à la fermeture : la fiche se redessine sans arrêt');

// ---------------------------------------------------------------------------
// 4. LE SERVEUR : UNE FICHE SANS `prod` ACCEPTE SA PREMIÈRE ÉCRITURE
// ---------------------------------------------------------------------------
// Mesuré en lecture seule sur la production le 29/08 : `fiche.prod` n'existe sur
// AUCUN des 187 dossiers — la structure est postérieure au comptoir qui les a
// créés. `corrigerProd` exigeait pourtant que les listes existent DÉJÀ pour
// accepter d'y écrire, et `corrigerProd(undefined, …)` rendait `undefined`.
// Résultat : la colonne Production de la fiche s'affichait, et rien de ce qu'on
// y tapait n'arrivait. Sans erreur, sans message.
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
  const call = async (methode, chemin, corps) => {
    const res = await fetch(base + chemin, {
      method: methode,
      headers: corps !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  // Un dossier saisi à la main : aucune fiche, donc aucun `prod`. C'est la
  // forme des 187.
  const nu = await call('POST', '/api/requests', {
    billing_company: 'Dossier sans production', stage: 'demande_chiffrage',
  });
  assert.strictEqual(nu.status, 201, 'le dossier de contrôle doit naître');
  const id = nu.body.id;
  assert.ok(!nu.body.fiche || !nu.body.fiche.prod, 'et il n’a pas de production');

  // UNE FACE S'AJOUTE QUAND MÊME — c'est le geste que le menu déclenche.
  const face = await call('PATCH', `/api/requests/${id}/fiche`, {
    prod: { logos: [{ face: 'Face à marquer' }] },
  });
  assert.strictEqual(face.status, 200);
  assert.ok(face.body.fiche && face.body.fiche.prod,
    '`corrigerProd` doit CRÉER la production : sans repli il rendait `undefined`, '
    + 'et la colonne restait en lecture seule sur tout le passé');
  assert.ok(Array.isArray(face.body.fiche.prod.logos),
    '… et la liste des faces se crée avec : les deux blocs exigeaient qu’elle EXISTE '
    + 'déjà pour accepter d’y écrire, donc rien n’arrivait jamais sur un dossier nu');
  assert.deepStrictEqual(face.body.fiche.prod.logos.map((z) => z.face), ['Face à marquer'],
    'une fiche sans production accepte sa première face');

  // L'IDENTITÉ AUSSI, et une taille NOMMÉE : c'est tout ce que la colonne porte.
  const idt = await call('PATCH', `/api/requests/${id}/fiche`, {
    prod: { ref: 'K3025', couleur: 'Bleu marine', tailles: [{ t: 'XL', n: 12 }] },
  });
  assert.strictEqual(idt.body.fiche.prod.ref, 'K3025');
  assert.strictEqual(idt.body.fiche.prod.couleur, 'Bleu marine');
  assert.deepStrictEqual(idt.body.fiche.prod.tailles, [{ t: 'XL', n: 12 }],
    'et la première taille entre elle aussi');
  // La face posée d'abord n'a pas été emportée par l'écriture suivante.
  assert.deepStrictEqual(idt.body.fiche.prod.logos.map((z) => z.face), ['Face à marquer'],
    'chaque écriture corrige la sienne et laisse le reste en place');

  // ET ELLE SE RETIRE en effaçant son nom, places en trop comprises.
  const vide = await call('PATCH', `/api/requests/${id}/fiche`, { prod: { logos: [{ face: '' }] } });
  assert.deepStrictEqual(vide.body.fiche.prod.logos, [],
    'décocher la dernière face la retire');

  // ⚠ ET LA COLONNE EXISTE À L'ÉCRAN. Elle était conditionnée à `fiche.prod` :
  // sur un dossier réel elle se résumait à la date « Prévu à l'atelier », et le
  // jour où celle-ci est retirée il ne restait qu'un titre et un filet.
  assert.match(FICHE, /const prod = fiche\.prod && typeof fiche\.prod === 'object' \? fiche\.prod : \{\};/,
    'la colonne Production se dessine même sans `fiche.prod`');
  assert.ok(!/\n  if \(prod\) \{/.test(FICHE),
    '… elle n’est plus conditionnée à sa présence');

  console.log('✓ faces au menu : la famille propose, on coche, et une fiche sans production accepte sa première écriture');
  if (app.__server) app.__server.close();
})().catch((e) => { console.error(e); process.exit(1); });
