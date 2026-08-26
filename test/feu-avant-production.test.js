'use strict';

// CE QUI MANQUE AVANT DE PRODUIRE — DEVIS · BAT · ARGENT (26/08/2026)
//
// Le patron : « je ne connais pas en temps réel l'état de la commande. Quand le
// projet arrive en production il doit obligatoirement avoir un devis validé, un
// BAT validé ainsi que le paiement, mais certains ont des acomptes. »
// Charlie : « il est difficile pour moi d'uniformiser tout ça. »
//
// LA RÉPONSE EST DE NE PAS UNIFORMISER. Chaque dossier déclare ce qu'il exige,
// et il le déclare TOUT SEUL — c'est la règle qui existait déjà pour le BAT
// (« déposer un BAT, c'est en avoir un »), étendue au devis et à l'argent.
//
// Quatre promesses :
//   1. LES EXIGENCES S'ARMENT SEULES — personne ne coche de case.
//   2. LA TASSE À 12 € N'EXIGE RIEN. Sa carte ne porte pas la rangée du tout.
//   3. « CERTAINS ONT DES ACOMPTES » : couvert ≠ soldé.
//   4. LE VERT SE TAIT, L'ÉCHEC PARLE (règle de la maison).

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const APP = lire('public/app.js');
const CSS = lire('public/styles.css');
const SERVEUR = lire('server.js');
const SCHEMA = lire('schema.sql');
const DB = lire('db.js');

// ---------------------------------------------------------------------------
// 1. LES EXIGENCES S'ARMENT SEULES
// ---------------------------------------------------------------------------
// Le devis était la seule des trois conditions à n'exister QUE comme
// sous-étape : rien qu'on puisse vérifier, ni dater, ni attribuer. Il prend les
// deux colonnes du BAT, et la même mécanique.
for (const col of ['devis_requis', 'devis_valide_le']) {
  assert.ok(SCHEMA.includes(col), `schema.sql doit porter ${col}`);
  assert.ok(DB.includes(col), `db.js doit migrer ${col}`);
  assert.ok(SERVEUR.includes(`'${col}'`), `la LISTE doit renvoyer ${col} — sans lui, `
    + 'la carte ne peut pas dire ce qui manque avant qu’on tente de produire');
}
// La migration se défait : c'est la règle du dépôt.
assert.match(DB, /Down : ALTER TABLE requests DROP COLUMN IF EXISTS devis_requis, devis_valide_le/,
  'toute migration porte son down');

// Trois portes d'armement, aucune n'est une case à cocher.
assert.match(SERVEUR, /const ETAPES_DEVIS = new Set\(\['chiffrage_en_cours', 'devis_envoye', 'devis_valide'\]\)/,
  'traverser le chiffrage arme l’exigence');
assert.match(SERVEUR, /if \(kind === 'devis'\) \{[\s\S]{0,200}?devis_requis = true/,
  'déposer un devis, c’est en avoir un');
assert.match(SERVEUR, /devis_valide_le = COALESCE\(devis_valide_le, now\(\)\)/,
  '« Devis validé » pose la DATE — c’est elle qui dit quand, et le journal qui dit qui');

// L'armement vaut à la CRÉATION comme à la MODIFICATION. Posé sur le seul
// PATCH, le verrou du BAT ne s'armait pas sur une ligne créée directement à une
// étape de BAT — c'est-à-dire sur tout dossier venu du comptoir. Le devis ne
// doit pas refaire le même trou.
assert.strictEqual((SERVEUR.match(/await marquerDevis\(/g) || []).length, 2,
  'marquerDevis doit être appelé à la création ET à la modification');

console.log('✓ feu : les exigences s’arment seules — devis, BAT, argent');

// ---------------------------------------------------------------------------
// 2 & 3. LA RÈGLE, DÉROULÉE SUR LES DEUX BOUTS DU PANEL DE CLIENTS
// ---------------------------------------------------------------------------
// On rejoue `FEU_FAITS` tel qu'il est écrit dans app.js : c'est la règle qui se
// teste, pas une copie qui pourrait diverger.
const bloc = APP.slice(APP.indexOf('const FEU_FAITS = ['), APP.indexOf('\n// Ce que le dossier exige'));
assert.ok(bloc.length > 400, 'FEU_FAITS doit être lisible dans app.js');

const exige = {
  devis: (r) => r.devis_requis === true,
  bat: (r) => r.bat_requis === true,
  argent: (r) => r.project_value != null,
};
const obtenu = {
  devis: (r) => !!r.devis_valide_le,
  bat: (r) => !!r.bat_valide_le,
  argent: (r) => r.paye === true || (r.acompte_demande === true && r.acompte_verse === true),
};
const feu = (r) => Object.keys(exige).filter((k) => exige[k](r))
  .map((k) => `${obtenu[k](r) ? '●' : '◌'} ${k}`);

// La règle du test doit être CELLE d'app.js, mot pour mot.
assert.match(bloc, /requis: \(r\) => r\.devis_requis === true/);
assert.match(bloc, /requis: \(r\) => r\.bat_requis === true/);
assert.match(bloc, /requis: \(r\) => r\.project_value != null/);
assert.match(bloc, /r\.paye === true \|\| \(r\.acompte_demande === true && r\.acompte_verse === true\)/);

// LA TASSE À 12 € AU COMPTOIR : payée à la caisse, ni devis ni BAT.
// Elle n'exige RIEN, donc sa carte ne porte pas la rangée. C'est le contrôle
// qui compte : ajouter trois cases à cocher sur une vente de 12 € serait un
// échec, quel que soit le reste.
const TASSE = {
  devis_requis: false, bat_requis: false,
  project_value: 12, paye: true, acompte_demande: null, acompte_verse: null,
};
assert.deepStrictEqual(feu(TASSE), ['● argent'],
  'la tasse ne montre que l’argent, déjà encaissé — rien à faire');
assert.ok(feu(TASSE).every((f) => f.startsWith('●')),
  'et RIEN ne lui manque : zéro geste ajouté au comptoir');

// LES 200 T-SHIRTS, du devis au solde. On déroule, étape par étape.
const PRO = {
  devis_requis: true, devis_valide_le: null,
  bat_requis: true, bat_valide_le: null,
  project_value: 3400, paye: null, acompte_demande: null, acompte_verse: null,
};
assert.deepStrictEqual(feu(PRO), ['◌ devis', '◌ bat', '◌ argent'],
  'au départ, les trois manquent');

PRO.devis_valide_le = '2026-08-20T10:00:00.000Z';
assert.deepStrictEqual(feu(PRO), ['● devis', '◌ bat', '◌ argent']);

// « CERTAINS ONT DES ACOMPTES » — et un acompte DEMANDÉ ne couvre rien.
PRO.acompte_demande = true;
PRO.acompte_montant = 1360;
assert.deepStrictEqual(feu(PRO), ['● devis', '◌ bat', '◌ argent'],
  'un acompte demandé mais pas versé ne couvre RIEN');

PRO.acompte_verse = true;
assert.deepStrictEqual(feu(PRO), ['● devis', '◌ bat', '● argent'],
  'acompte reçu = couvert, même sans être soldé — c’est toute la nuance du patron');

PRO.bat_valide_le = '2026-08-22T14:10:00.000Z';
assert.deepStrictEqual(feu(PRO), ['● devis', '● bat', '● argent'],
  'les trois au vert : le dossier peut partir en production');

// UN DOSSIER PAS ENCORE CHIFFRÉ n'exige pas d'argent : on ne peut pas réclamer
// ce qu'on n'a pas encore annoncé.
assert.deepStrictEqual(feu({ devis_requis: true, bat_requis: false, project_value: null }),
  ['◌ devis'], 'sans montant, aucune exigence d’argent');

console.log('✓ feu : la tasse n’exige rien, les 200 t-shirts exigent les trois');

// ---------------------------------------------------------------------------
// 4. LE VERT SE TAIT, L'ÉCHEC PARLE
// ---------------------------------------------------------------------------
// Règle de la maison. Ce qui est obtenu s'efface en gris ; ce qui manque porte
// la couleur d'état ET la graisse. Quand tout va bien, il n'y a rien à lire.
assert.match(CSS, /\.feu__pt\.is-ok \{[^}]*color: var\(--text-3\)/,
  'l’obtenu se tait');
assert.match(CSS, /\.feu__pt\.is-manque \{[^}]*color: var\(--danger\)[^}]*font-weight: var\(--graisse-forte\)/,
  'ce qui manque parle — couleur d’ÉTAT et graisse, pas une décoration');

// LE MÊME COMPOSANT DANS LES DEUX VUES : deux écrans à un clic l'un de l'autre
// doivent donner le même bloc, pas deux qui se ressemblent.
const carte = APP.match(/function buildCard\(r, options\)[\s\S]*?\n\}/);
assert.ok(carte && /blocFeu\(r\)/.test(carte[0]), 'la carte porte le feu');
const cellule = APP.match(/function cellInfos\(r\)[\s\S]*?\n\}/);
assert.ok(cellule && /blocFeu\(r\)/.test(cellule[0]), 'la cellule Infos porte LE MÊME');

// CHACUN CHOISIT : à l'atelier on veut le feu, à la boutique peut-être pas.
assert.match(APP, /key: 'feu',[^}]*surCarte: true/,
  'le feu est une case du rail « Colonnes », comme les autres faits');
assert.match(APP, /COLS_REDESSINENT = new Set\(\['price', 'feu'/,
  'et la décocher doit se VOIR — sans invalidation, la case se coche et rien ne bouge');

// IL AFFICHE, IL NE BLOQUE PAS — encore. On regarde d'abord si la règle dit
// vrai sur de vrais dossiers ; on verrouillera ensuite. Seul le BAT refuse le
// passage en production aujourd'hui, et c'était déjà le cas.
assert.match(APP, /ce feu AFFICHE, il ne bloque pas/,
  'l’intention doit être écrite : un verrou qui se trompe arrête l’atelier');

console.log('✓ feu : le vert se tait, l’échec parle — et le même bloc dans les deux vues');
