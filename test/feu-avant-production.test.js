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

const APRES_CHIFFRAGE = new Set(['preparation', 'production', 'facturation', 'paiement']);
const APRES_BAT = new Set(['production', 'facturation', 'paiement']);
const exige = {
  devis: (r) => r.devis_requis === true,
  bat: (r) => r.bat_requis === true,
  argent: (r) => r.stage === 'production',
};
const obtenu = {
  devis: (r) => !!r.devis_valide_le || r.sub_stage === 'devis_valide' || APRES_CHIFFRAGE.has(r.stage),
  bat: (r) => !!r.bat_valide_le || r.sub_stage === 'bat_valide' || APRES_BAT.has(r.stage),
  argent: (r) => r.paye === true || (r.acompte_demande === true && r.acompte_verse === true),
};
// Ce que la carte AFFICHE : uniquement ce qui manque. L'obtenu ne prend aucune
// place — c'est la règle « le vert se tait », appliquée jusqu'au bout.
const manque = (r) => Object.keys(exige).filter((k) => exige[k](r) && !obtenu[k](r));

// La règle du test doit être CELLE d'app.js, mot pour mot.
assert.match(bloc, /requis: \(r\) => r\.devis_requis === true/);
assert.match(bloc, /requis: \(r\) => r\.bat_requis === true/);
assert.match(bloc, /requis: \(r\) => r\.stage === 'production'/);
assert.match(bloc, /FEU_APRES_CHIFFRAGE\.has\(r\.stage\)/);
assert.match(bloc, /FEU_APRES_BAT\.has\(r\.stage\)/);
assert.match(bloc, /r\.paye === true \|\| \(r\.acompte_demande === true && r\.acompte_verse === true\)/);
assert.match(APP, /const FEU_APRES_CHIFFRAGE = new Set\(\['preparation', 'production', 'facturation', 'paiement'\]\)/);
assert.match(APP, /const FEU_APRES_BAT = new Set\(\['production', 'facturation', 'paiement'\]\)/);

// LA TASSE À 12 € AU COMPTOIR : payée à la caisse, ni devis ni BAT. Elle
// n'exige RIEN, donc sa carte ne porte pas la rangée. C'est le contrôle qui
// décide de tout : ajouter la moindre cérémonie à une vente de 12 € serait un
// échec quel que soit le reste.
assert.deepStrictEqual(manque({
  stage: 'paiement', sub_stage: 'archive', devis_requis: false, bat_requis: false,
  project_value: 12, paye: true, acompte_demande: null, acompte_verse: null,
}), [], 'la tasse ne porte AUCUNE marque');

// LES 200 T-SHIRTS, du devis au solde.
const PRO = {
  stage: 'demande_chiffrage', sub_stage: 'devis_envoye',
  devis_requis: true, devis_valide_le: null,
  bat_requis: true, bat_valide_le: null,
  project_value: 3400, paye: null, acompte_demande: null, acompte_verse: null,
};
assert.deepStrictEqual(manque(PRO), ['devis', 'bat'],
  'devis parti sans retour, et un BAT déjà armé. PAS l’argent — on n’est pas en production');

// LE DEVIS EST ACQUIS DE FAIT DÈS QUE LE DOSSIER A QUITTÉ LE CHIFFRAGE : on ne
// prépare pas une commande dont le devis a été refusé. C'est ÇA qui rend la
// règle vraie sur de vrais dossiers — la sous-étape « Devis validé » n'a jamais
// été employée une seule fois sur les 185 de l'atelier.
PRO.stage = 'preparation';
PRO.sub_stage = 'bat_envoye';
assert.deepStrictEqual(manque(PRO), ['bat'],
  'passé en préparation, le devis ne manque plus — le dossier a avancé, donc il est passé');

// LE BAT, EN MIROIR : y être en production le PROUVE, puisque le verrou de
// server.js interdit d'y entrer sans lui.
PRO.stage = 'production';
PRO.sub_stage = 'prod_dtf';
assert.deepStrictEqual(manque(PRO), ['argent'],
  'en production : le BAT est acquis, et c’est l’argent qui devient exigible');

// « CERTAINS ONT DES ACOMPTES » : couvert, ce n'est pas soldé.
PRO.acompte_demande = true;
PRO.acompte_montant = 1360;
assert.deepStrictEqual(manque(PRO), ['argent'],
  'un acompte réclamé qui n’arrive pas ne couvre rien');
PRO.acompte_verse = true;
assert.deepStrictEqual(manque(PRO), [],
  'acompte reçu = couvert, même sans être soldé — toute la nuance du patron');

// ON SIGNALE CE QUI EST ANORMAL, PAS CE QUI EST INCOMPLET — et l'étape le dit
// souvent déjà. Un dossier à « Paiement › à contrôler » n'a pas besoin d'un
// voyant « il manque l'argent » : c'est le nom de l'endroit où il est.
assert.deepStrictEqual(
  manque({ stage: 'paiement', sub_stage: 'paiement_a_controler', devis_requis: true, bat_requis: true, paye: null }),
  [], 'le feu ne répète pas ce que l’étape dit déjà');
assert.deepStrictEqual(
  manque({ stage: 'paiement', sub_stage: 'archive', devis_requis: true, bat_requis: true, paye: null }),
  [], 'et il se tait sur les dossiers archivés — le travail est fait');

// UNE COMMANDE QU'ON ENCAISSERA AU RETRAIT ne porte aucune marque d'argent
// avant la production : c'est le cas le plus courant de l'atelier.
assert.deepStrictEqual(
  manque({ stage: 'preparation', sub_stage: 'prepa_produits', devis_requis: false, bat_requis: false, project_value: 850, paye: null }),
  [], 'en préparation, « pas encore payé » n’est pas une anomalie');

// LA PORTÉE, MESURÉE SUR LES 185 DOSSIERS RÉELS (27/08). Ni muet ni mur : la
// version d'avant en allumait 0, la toute première 184 sur 307.
assert.match(APP, /28 s'allument, soit 15 %/,
  'la portée de la règle est écrite dans le code, avec sa date et son échantillon');

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
assert.match(APP, /manque: \(r\) => \(r\.acompte_demande === true \? 'Acompte' : 'Paiement'\)/,
  'la rangée nomme ce qu’on attend — « Acompte » s’il a été réclamé, sinon « Paiement »');
assert.match(APP, /Acompte de \$\{eur\(Number\(r\.acompte_montant\)\)\} demande - pas encore recu/,
  'et le survol donne le montant réclamé');

// DEPUIS QUAND. « Il manque le devis » ne dit pas s'il faut relancer ;
// « Devis 12 j » le dit, et c'est la seule chose que la ligne ajoute.
assert.match(APP, /function joursDepuis\(iso\)/,
  'le délai se calcule — il ne se devine pas au survol');
assert.match(APP, /joursDepuis\(r\.updated_at\)/,
  'on lit `updated_at` : le journal ne couvre pas le passé, il dirait MOINS');
assert.match(blocFeu, /d\.className = 'feu__depuis'/,
  'le nombre de jours s’écrit sur la ligne, collé au mot');
assert.match(CSS, /\.feu__depuis \{[\s\S]*?font-size: var\(--taille-note\)/,
  'une taille en dessous : il précise, il ne s’annonce pas');

// L'HORLOGE EST LA MÊME POUR LES TROIS FAITS (27/08/2026). Elle sort d'un seul
// `updated_at` : l'écrire après chaque mot donnait « Devis 21 j · BAT 21 j »,
// le même nombre deux fois sur la même ligne — et deux lignes de haut au lieu
// d'une dès que deux choses manquent, ce qui casse le balayage de la file.
assert.strictEqual((blocFeu.match(/feu__depuis/g) || []).length, 1,
  'le nombre de jours s’écrit UNE fois, à la fin — pas après chaque mot');
assert.ok(blocFeu.indexOf('feu__depuis') > blocFeu.indexOf('manque.forEach'),
  '… donc après la boucle qui écrit les mots, pas dedans');
assert.match(APP, /depuis: jours \? `\$\{jours\}\\u00a0j` : ''/,
  'l’espace entre le nombre et son unité est INSÉCABLE : « 21 j » ne se coupe pas');

// LA BANDE NE SORT PAS DE SA COLONNE DANS LE TABLEAU (27/08/2026).
// Le débordement de 10 px a été dessiné pour la CARTE, où il vit dans un
// rembourrage de 16 px. Le tableau est devenu la vue par défaut le 27/08 et n'a
// aucun rembourrage à emprunter : mesuré au rendu, une bande de 280 px dans une
// cellule de 260, donc 10 px peints PAR-DESSUS le prix à gauche et la date à
// droite. Une couleur d'alerte qui recouvre la colonne d'à côté n'est plus un
// état, c'est un défaut d'affichage.
assert.match(CSS, /\.grid \.infos-stack > \.feu \{ margin-inline: 0;/,
  'dans le tableau, la bande prend exactement la largeur de sa colonne');
// Et les trois choses que cette colonne empile partent du MÊME bord : la fiche
// de production, la rangée « Manque », et la note libre — qui est un CHAMP, et
// dont le texte commence au rembourrage de la boîte unique.
assert.match(CSS, /\.grid \.infos-stack > \.feu \{[^}]*padding-inline: var\(--champ-x\)/,
  'la rangée « Manque » se cale sur le rembourrage du champ, pas sur un pas d’écart');
assert.match(CSS, /\.grid \.infos-stack > \.prod-fiche \{ padding-inline: var\(--champ-x\); \}/,
  '… et la fiche de production avec elle, sinon les intitulés se décalent de 4 px');


// PARFAITEMENT LISIBLE (Charlie, 27/08) — sans cesser d'être discret : une
// bande d'état, aucun glyphe, aucun mot en plus. Et la bande ne DÉPLACE rien :
// elle déborde de 10 px de chaque côté et les reprend en rembourrage, sinon les
// cinq intitulés de la fiche ne s'alignent plus sur une colonne.
const bande = CSS.match(/\n\.feu \{[\s\S]*?\n\}/)[0];
assert.match(bande, /background: var\(--danger-bg\)/, 'la couleur dit l’état, et rien d’autre');
assert.match(bande, /box-shadow: inset 3px 0 0 var\(--danger\)/,
  '`box-shadow` et non `border-left` : une bordure décalerait la grille de 3 px');
assert.match(bande, /margin-inline: calc\(var\(--pas-2\) \* -1\)/,
  'sur la CARTE, la bande déborde de son rembourrage — c’est là qu’elle a été dessinée');
assert.match(bande, /padding: var\(--pas-1\) var\(--pas-2\)/,
  'la bande déborde exactement de ce qu’elle reprend : le texte ne bouge pas');

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

// ---------------------------------------------------------------------------
// 5. LE RATTRAPAGE — SANS LUI, LA RÈGLE EST MUETTE
// ---------------------------------------------------------------------------
// `bat_requis` et `devis_requis` s'arment vers l'AVANT. Les 185 dossiers déjà
// en base au moment où les colonnes sont apparues valent `false`, quoi qu'ils
// aient traversé — et le feu s'allumait donc sur ZÉRO carte. Le rattrapage lit
// les trois traces que le dossier porte déjà : sa sous-étape actuelle, une
// pièce jointe déposée, le journal des sous-étapes.
assert.match(DB, /async function rattraperFeu\(\)/, 'le rattrapage doit exister');
assert.match(DB, /SELECT 1 FROM app_meta WHERE key = 'feu_rattrapage'/,
  'sa PROPRE garde : deux incidents réels sont venus d’une garde partagée');
assert.match(DB, /await rattraperFeu\(\);/, 'et il doit être joué au démarrage');
assert.match(DB, /Down : UPDATE requests SET bat_requis = false, devis_requis = false/,
  'toute migration porte son down');
// LES TROIS SOURCES, aucune n'est une supposition.
assert.match(DB, /SELECT id FROM requests WHERE sub_stage IN/, '1. la sous-étape actuelle');
assert.match(DB, /SELECT request_id AS id FROM attachments WHERE kind = \$1/, '2. la pièce jointe');
assert.match(DB, /FROM request_events\s*\n?\s*WHERE field = 'sub_stage'/, '3. le journal');
// pg-mem ne rend pas `= ANY($1)` à plat : la migration passerait en prod et ne
// ferait RIEN en local — l'écart qu'on ne voit qu'une fois déployé.
assert.ok(!/sub_stage = ANY\(/.test(DB) && !/id = ANY\(/.test(DB),
  'aucun `= ANY($1)` dans le rattrapage : pg-mem ne le rend pas');
assert.match(DB, /const placeholders = /, 'les listes se posent en $1, $2, …');

console.log('✓ feu : le rattrapage rend aux 185 dossiers ce qu’ils portaient déjà');
