'use strict';

// LE RAIL DIT LA MÊME CHOSE QUE LA BASE, ET IL SE LIT D'UN COUP (26/08/2026)
//
// Deux problèmes trouvés le même jour, et le second explique le premier.
//
// 1. UNE SOUS-ÉTAPE AVALAIT DES DOSSIERS. `bat_modif` — « BAT – Modification
//    demandée » — vivait dans db.js, le serveur la validait, /api/counts la
//    comptait… et elle n'était PAS dans le SUB_STAGES de public/app.js. Une
//    commande posée là existait en base, était comptée dans le rail, et
//    n'avait aucune ligne où s'afficher : la carte annonçait « à préciser ».
//    Et c'est justement le cas où quelqu'un attend — un BAT que le client
//    renvoie à corriger.
//    Personne ne l'avait vu parce que le rail porte 28 sous-étapes : une
//    structure que personne ne peut tenir en tête a déjà dérivé toute seule.
//
// 2. LE RAIL DÉBORDE DE L'ÉCRAN, ET LES DEUX TIERS NE PORTENT RIEN. Mesuré au
//    rendu : 33 lignes, 1 362 px, dont 899 px (66 %) de lignes VIDES — sur un
//    écran de 1 043 px. On ne supprime rien (le patron veut la structure
//    complète, et il a raison) : les étapes vides d'une phase se REPLIENT
//    derrière une ligne, dans l'ordre, à un clic.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RACINE, 'public/app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(RACINE, 'public/styles.css'), 'utf8');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;
const db = require('../db.js');

// ---------------------------------------------------------------------------
// 1. LES DEUX LISTES NE PEUVENT PLUS DIVERGER
// ---------------------------------------------------------------------------
// `db.js` fait foi (c'est lui que le serveur consulte pour valider une
// sous-étape) ; `public/app.js` doit en être la copie exacte, slug ET libellé,
// DANS LE MÊME ORDRE — l'ordre est le pipeline, il n'est pas décoratif.
function listesDeLEcran() {
  const debut = APP.indexOf('const SUB_STAGES = {');
  assert.ok(debut > 0, 'public/app.js doit déclarer SUB_STAGES');
  const bloc = APP.slice(debut, APP.indexOf('\n};', debut));
  const out = {};
  let famille = null;
  for (const ligne of bloc.split('\n')) {
    const f = ligne.match(/^ {2}([a-z_]+): \[/);
    if (f) { famille = f[1]; out[famille] = []; continue; }
    const m = ligne.match(/slug: '([a-z_]+)', label: '([^']*)'/);
    if (m && famille) out[famille].push({ slug: m[1], label: m[2] });
  }
  return out;
}

const ecran = listesDeLEcran();
const base = db.SUB_STAGES;

assert.deepStrictEqual(Object.keys(ecran).sort(), Object.keys(base).sort(),
  'les mêmes familles des deux côtés');

for (const famille of Object.keys(base)) {
  const attendues = base[famille].map((s) => `${s.slug} — ${s.label}`);
  const vues = (ecran[famille] || []).map((s) => `${s.slug} — ${s.label}`);
  assert.deepStrictEqual(vues, attendues,
    `« ${famille} » : le rail doit porter EXACTEMENT les sous-étapes de db.js, `
    + 'dans le même ordre. Un écart rend des dossiers invisibles à l’écran '
    + 'alors qu’ils sont comptés dans le rail.');
}

// Le cas nommé, pour que la régression ait un nom si elle revient.
assert.ok(APP.includes("slug: 'bat_modif'"),
  '« BAT – Modification demandée » doit exister à l’écran : le serveur la valide');

console.log(`✓ rail : ${Object.values(base).reduce((n, l) => n + l.length, 0)} sous-étapes, `
  + 'écran et base identiques — plus aucune ne peut avaler un dossier');

// ---------------------------------------------------------------------------
// 2. LES ÉTAPES VIDES SE REPLIENT — ET RIEN N'EST SUPPRIMÉ
// ---------------------------------------------------------------------------
// La règle, en trois points :
//   · l'ORDRE ne change jamais (c'est le pipeline) ;
//   · l'étape OUVERTE ne se replie jamais, même vide — on doit voir où on est ;
//   · un repli isolé ne gagne rien : on ne replie qu'à partir de DEUX étapes.
assert.match(APP, /function replierLesVides/,
  'le repli est une fonction nommée, pas une condition perdue dans le rendu');
assert.match(APP, /REPLI_MINIMUM = 2/,
  'replier UNE ligne derrière UNE ligne ne gagne rien');
assert.match(APP, /railDeplie/, 'l’état déplié doit être nommé');
// L'ÉTAPE OUVERTE ÉCHAPPE AU REPLI. Sans cette exception, cliquer sur une
// étape vide la faisait disparaître sous le doigt : on ne voyait plus où on
// était, et le rail semblait avoir avalé le clic.
const corpsRepli = APP.slice(APP.indexOf('function replierLesVides'),
  APP.indexOf('function ligneDeRepli'));
assert.match(corpsRepli, /ne se replie pas, même vide/,
  'la règle doit être écrite là où elle s’applique');
assert.match(corpsRepli, /currentStage === famille && currentSub === sub\.slug/,
  'et elle doit vraiment exclure l’étape ouverte');
// L'ORDRE NE CHANGE JAMAIS : on filtre la liste d'origine, on ne la réordonne
// pas. Les étapes repliées reviennent à LEUR place, pas en bas de la phase.
assert.match(corpsRepli, /sousEtapes\.filter\(/,
  'le repli FILTRE la liste, il ne la réordonne pas — l’ordre est le pipeline');

// LE CHOIX SUIT LA PERSONNE, pas la machine — même règle que les colonnes du
// planning : le chef d'atelier et la boutique se relaient sur le même PC.
assert.match(APP, /RAIL_DEPLIE_KEY|rail-deplie/,
  'le choix de déplier se retient');
assert.match(APP, /lirePoste\(\)/, 'et il suit la personne au poste');

// La ligne de repli est un VRAI bouton (le rail est la navigation principale).
assert.match(APP, /class(Name)?\s*=\s*'stage stage-repli'|'stage stage-repli'/,
  'la ligne de repli porte sa propre classe');
assert.match(CSS, /\.stage-repli\s*\{/, 'et sa règle de style');

// ELLE NE DÉPLACE RIEN. La ligne reste au même endroit dépliée ou repliée :
// c'est la règle de la maison (une bascule = un seul mouvement).
assert.match(CSS, /\.stage-repli[\s\S]{0,400}?min-height|\.stage-repli[\s\S]{0,400}?height/,
  'la ligne de repli garde sa hauteur dans les deux états');

console.log('✓ rail : les étapes vides se replient, l’ordre tient, l’étape ouverte reste');
