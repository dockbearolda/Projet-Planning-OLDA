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
  argent: (r) => r.acompte_demande === true,
};
const obtenu = {
  devis: (r) => !!r.devis_valide_le,
  bat: (r) => !!r.bat_valide_le,
  argent: (r) => r.paye === true || (r.acompte_demande === true && r.acompte_verse === true),
};
// Ce que la carte AFFICHE : uniquement ce qui manque. L'obtenu ne prend aucune
// place — c'est la règle « le vert se tait », appliquée jusqu'au bout.
const manque = (r) => Object.keys(exige).filter((k) => exige[k](r) && !obtenu[k](r));

// La règle du test doit être CELLE d'app.js, mot pour mot.
assert.match(bloc, /requis: \(r\) => r\.devis_requis === true/);
assert.match(bloc, /requis: \(r\) => r\.bat_requis === true/);
assert.match(bloc, /requis: \(r\) => r\.acompte_demande === true/);
assert.match(bloc, /r\.paye === true \|\| \(r\.acompte_demande === true && r\.acompte_verse === true\)/);

// LA TASSE À 12 € AU COMPTOIR : payée à la caisse, ni devis ni BAT, aucun
// acompte réclamé. Elle n'exige RIEN, donc sa carte ne porte pas la rangée.
// C'est le contrôle qui décide de tout : ajouter la moindre cérémonie à une
// vente de 12 € serait un échec quel que soit le reste.
assert.deepStrictEqual(manque({
  devis_requis: false, bat_requis: false,
  project_value: 12, paye: true, acompte_demande: null, acompte_verse: null,
}), [], 'la tasse ne porte AUCUNE marque');

// LES 200 T-SHIRTS, du devis au solde.
const PRO = {
  devis_requis: true, devis_valide_le: null,
  bat_requis: true, bat_valide_le: null,
  project_value: 3400, paye: null, acompte_demande: null, acompte_verse: null,
};
assert.deepStrictEqual(manque(PRO), ['devis', 'bat'],
  'au départ : le devis et le BAT. PAS l’argent — personne n’a encore rien réclamé');

PRO.devis_valide_le = '2026-08-20T10:00:00.000Z';
assert.deepStrictEqual(manque(PRO), ['bat'], 'le devis validé disparaît de la rangée');

// ON SIGNALE CE QUI EST ANORMAL, PAS CE QUI EST INCOMPLET.
// « Pas encore payé » en préparation n'est pas une anomalie : à l'atelier on
// encaisse au retrait. Ce qui est anormal, c'est d'avoir RÉCLAMÉ un acompte et
// de ne pas l'avoir vu arriver — quelqu'un attend, et personne ne le sait.
// Mesuré sur 307 dossiers de préparation : la règle « dès qu'il y a un montant »
// marquait 184 cartes (60 % à elle seule, 73 % avec le BAT), la règle
// « acompte réclamé et pas reçu » en marque 32. Un signal qui s'allume sur
// trois cartes sur quatre n'est plus un signal : on l'éteint au bout d'une
// semaine, et on perd les deux autres avec.
PRO.acompte_demande = true;
PRO.acompte_montant = 1360;
assert.deepStrictEqual(manque(PRO), ['bat', 'argent'],
  'l’acompte est réclamé et n’arrive pas : ÇA, c’est anormal');

PRO.acompte_verse = true;
assert.deepStrictEqual(manque(PRO), ['bat'],
  'acompte reçu = couvert, même sans être soldé — toute la nuance du patron');

PRO.bat_valide_le = '2026-08-22T14:10:00.000Z';
assert.deepStrictEqual(manque(PRO), [],
  'plus rien ne manque : la carte ne porte plus de rangée du tout');

// UNE COMMANDE QU'ON ENCAISSERA AU RETRAIT ne porte aucune marque d'argent :
// c'est le cas le plus courant de l'atelier, et il est parfaitement normal.
assert.deepStrictEqual(
  manque({ devis_requis: false, bat_requis: false, project_value: 850, paye: null }),
  [], 'pas d’acompte réclamé = rien à signaler');

console.log('✓ feu : la tasse n’exige rien, les 200 t-shirts exigent les trois');

// ---------------------------------------------------------------------------
// 4. LE VERT SE TAIT — JUSQU'AU BOUT
// ---------------------------------------------------------------------------
// Première version : « ● Devis ◌ BAT ◌ Argent » sur chaque carte. Charlie
// (26/08) : « je n'aime pas du tout le design du feu, il faut qu'il soit bien
// visible. Quelque chose de haut de gamme et de discret. » Les trois adjectifs
// ne se contredisent pas — ils disent : ne montre QUE ce qui manque, et
// montre-le dans le rythme du reste.
//
// L'OBTENU NE S'ÉCRIT PLUS DU TOUT : `feuDuDossier` ne rend que le manquant.
assert.match(APP, /FEU_FAITS\.filter\(\(f\) => f\.requis\(r\) && !f\.obtenu\(r\)\)/,
  'seul ce qui manque s’affiche — l’obtenu ne prend aucune place');

// AUCUN GLYPHE. « ● » et « ◌ » sont des caractères de police : ils changent de
// dessin d'un poste à l'autre et se lisent comme du texte, pas comme un repère.
const blocFeu = APP.slice(APP.indexOf('function blocFeu'), APP.indexOf('function blocProduction'));
assert.ok(!/[●◌○◉]/.test(blocFeu), 'plus un seul glyphe dans le feu');

// LA MÊME GRILLE QUE LA FICHE DE PRODUCTION : c'est ce qui la fait lire comme
// sa cinquième ligne au lieu d'une pastille rapportée.
assert.match(blocFeu, /bloc\.className = 'prod-fiche feu'/,
  'la rangée emprunte la grille de la fiche de production');
assert.match(blocFeu, /cle\.className = 'prod-fiche__cle feu__cle'/,
  'et son intitulé');
assert.match(blocFeu, /s\.className = 'prod-fiche__fort'/,
  'les valeurs prennent la graisse forte, comme les quatre faits au-dessus');

// UN SEUL MOT PORTE LA COULEUR — l'intitulé. La couleur dit un ÉTAT, il n'y en
// a qu'une par carte, et elle ne décore rien.
assert.match(CSS, /\.prod-fiche__cle\.feu__cle \{ color: var\(--danger\); \}/,
  'seul l’intitulé « Manque » porte la couleur d’état — et DEUX classes, sinon '
  + '`.prod-fiche__cle` (déclarée après) lui repose son gris');
assert.ok(!/\.feu__val|\.feu__pt/.test(CSS),
  'aucune règle de couleur sur les valeurs : elles sont à l’encre comme le reste');

// ON NOMME CE QU'ON ATTEND, pas la catégorie. « Argent » ne dit pas quoi faire ;
// « Acompte » dit qu'il a été réclamé et qu'il n'est pas rentré.
assert.match(APP, /manque: \(\) => 'Acompte'/,
  'la rangée nomme l’acompte, pas « l’argent »');
assert.match(APP, /Acompte de \$\{eur\(Number\(r\.acompte_montant\)\)\} demandé — pas encore reçu/,
  'et le survol donne le montant réclamé');

// LE MÊME COMPOSANT DANS LES DEUX VUES : deux écrans à un clic l'un de l'autre
// doivent donner le même bloc, pas deux qui se ressemblent.
const carte = APP.match(/function buildCard\(r, options\)[\s\S]*?\n\}/);
assert.ok(carte && /blocFeu\(r\)/.test(carte[0]), 'la carte porte le feu');
const cellule = APP.match(/function cellInfos\(r\)[\s\S]*?\n\}/);
assert.ok(cellule && /blocFeu\(r\)/.test(cellule[0]), 'la cellule Infos porte LE MÊME');
// …ET DANS LE MÊME ORDRE : « Manque » est la CINQUIÈME ligne de la fiche, pas
// une rangée posée devant. On lit ce qu'il y a à produire, puis ce qui empêche
// de le faire — et c'est ce qui aligne les cinq intitulés dans une colonne.
assert.ok(carte[0].indexOf('blocProduction(r)') < carte[0].indexOf('blocFeu(r)'),
  'sur la carte, « Manque » vient APRÈS la fiche de production');
assert.ok(cellule[0].indexOf('blocProduction(r)') < cellule[0].indexOf('blocFeu(r)'),
  'et dans la cellule Infos aussi');

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

// ET SUR UN DOSSIER OÙ RIEN NE MANQUE, IL N'Y A PAS DE RANGÉE. C'est là qu'est
// la discrétion — et c'est aussi ce qui rend les autres visibles.
assert.match(blocFeu, /if \(!manque\.length\) return null;/,
  'rien ne manque = rien ne s’affiche');

console.log('✓ feu : le vert se tait, l’échec parle — et le même bloc dans les deux vues');
