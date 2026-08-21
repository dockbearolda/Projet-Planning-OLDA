'use strict';

// LE CHOIX DE LA RÉFÉRENCE AU COMPTOIR
//
// La liste native affichait la désignation puis la référence, et la coupait :
// la vendeuse lisait « T-shirt bio léger Premium 155 g » sans jamais voir
// « NS300 ». Le menu est maintenant une liste maison — la référence ouvre la
// ligne, dans sa colonne, la désignation suit.
//
// Ce fichier tient les trois choses qui casseraient en silence :
//   1. L'ORDRE DE LA LIGNE — référence d'abord, désignation derrière.
//   2. LA FAÇADE `.value` — tout le formulaire écrit et lit encore sur #txRef.
//   3. LES SORTIES — champ manquant, aucun résultat, reprise d'un article.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const DEVIS = fs.readFileSync(path.join(RACINE, 'public/comptoir/demande-devis.html'), 'utf8');

const bloc = (nom) => (DEVIS.match(new RegExp(`function ${nom}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`)) || [''])[0];

// --- 1. La référence ouvre la ligne -----------------------------------------

assert.ok(!/<select id="txRef"/.test(DEVIS), 'le <select> natif ne doit plus exister');
assert.ok(/id="txRef"[^>]*role="combobox"/.test(DEVIS), '#txRef est la liste maison');

// Dans le champ fermé comme dans la liste, le jeton de référence est posé AVANT
// la désignation. C'est tout l'objet du changement : si l'ordre s'inverse, on
// retombe sur la désignation qui mange la ligne et la référence tronquée.
const champ = (DEVIS.match(/<div class="tx-combo" id="txRef"[\s\S]*?<\/div>/) || [''])[0];
assert.ok(champ.indexOf('id="txRefJeton"') < champ.indexOf('id="txRefNom"'),
  'dans le champ, la référence précède la désignation');

const peindre = bloc('txRefPeindreListe');
assert.ok(peindre, 'txRefPeindreListe doit exister');
assert.ok(peindre.indexOf("className='tx-jeton'") < peindre.indexOf("className='tx-option-nom'"),
  'dans la liste, le jeton de référence est ajouté avant la désignation');

// Le tri à l'intérieur d'un groupe suit la référence : la colonne de gauche se
// lit alors d'un trait au lieu de sauter d'une marque à l'autre.
assert.ok(/\.sort\(\(a,b\)=>a\.ref\.localeCompare\(b\.ref,'fr',\{numeric:true\}\)\)/.test(DEVIS),
  'les références se rangent par référence dans leur groupe');

// --- 2. La façade `.value` ---------------------------------------------------

// #txRef n'est plus un champ de formulaire : sans ce defineProperty, TOUTES les
// lectures et écritures du formulaire (txReadForm, txApplyToForm,
// cancelTextileEdit) tomberaient sur `undefined` sans lever la moindre erreur.
const installer = bloc('txRefInstaller');
assert.ok(/Object\.defineProperty\(racine,'value'/.test(installer),
  '#txRef doit exposer `.value` : tout le formulaire écrit et lit là');
assert.ok(/get:\(\)=>txRefEtat\.valeur/.test(installer) && /set:\(v\)=>/.test(installer),
  '`.value` se lit ET s’écrit');
// Poser la valeur ne doit RIEN déclencher : les appelants enchaînent déjà
// onTextileRefChange() eux-mêmes, un appel de plus rejouerait tout deux fois.
assert.ok(!/set:\(v\)=>\{[^}]*onTextileRefChange/.test(installer),
  'écrire `.value` ne relance pas le formulaire');

['txReadForm', 'txApplyToForm', 'cancelTextileEdit'].forEach((f) => {
  assert.ok(/\$\('txRef'\)\.value/.test(bloc(f)), `${f} passe toujours par $('txRef').value`);
});

// --- 3. Les sorties ----------------------------------------------------------

// fail('txRef') met le champ en rouge, lui donne le FOCUS et pose son message
// juste dessous : il faut donc que #txRef reste focusable et que le message
// puisse s'insérer après lui.
assert.ok(/id="txRef"[^>]*tabindex="0"/.test(DEVIS),
  '#txRef doit rester focusable, sinon fail() ne montre plus où commencer');
assert.ok(/if\(!d\.ref\)return fail\('txRef'/.test(DEVIS),
  'une référence manquante marque encore le champ');

// Le rouge s'efface sur `change` — le <select> le déclenchait tout seul, la
// liste maison doit le dire.
const choisir = bloc('txRefChoisir');
assert.ok(/dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/.test(choisir),
  'choisir une référence efface le rouge du champ manquant');
assert.ok(/onTextileRefChange\(\)/.test(choisir),
  'choisir une référence recharge couleurs, genre et aperçu');

// Aucun résultat : la saisie libre reste offerte, sinon la vendeuse se retrouve
// devant une liste vide sans rien à faire.
assert.ok(/const rien=!vus\.length;\s*if\(rien&&libre\)vus=\[libre\]/.test(peindre),
  'sans résultat, « Nouvelle référence » reste la sortie de secours');
assert.ok(/__CUSTOM__/.test(DEVIS) && /libre:true/.test(DEVIS),
  'la saisie libre est une entrée de la liste');

// Le survol déplace le curseur du clavier : sinon la souris éclaire une ligne
// et Entrée en valide une autre.
assert.ok(/mousemove[\s\S]{0,220}txRefEtat\.vise=i/.test(installer),
  'le survol et le clavier visent la même ligne');

// Un clic dehors referme AVANT que le clic n'atteigne ce qu'il visait.
assert.ok(/addEventListener\('pointerdown'/.test(installer),
  'le panneau se referme sur pointerdown, pas sur click');

// La liste maison n'est utile que si elle se filtre : 48 références sur
// 13 familles ne se parcourent pas à l'œil.
assert.ok(/id="txRefFiltre"/.test(DEVIS), 'la liste se filtre');
assert.ok(/normalize\('NFD'\)/.test(bloc('txRefNorm')),
  'le filtre ignore les accents : « debardeur » doit trouver « Débardeur »');
assert.ok(/mots\.every\(m=>foin\.includes\(m\)\)/.test(bloc('txRefFiltrees')),
  'plusieurs mots se cumulent, dans n’importe quel ordre');

// Le clavier fait tout : le comptoir est un poste PC.
const touche = bloc('txRefTouche');
['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape', 'Tab'].forEach((k) => {
  assert.ok(touche.includes(`'${k}'`), `la touche ${k} doit être traitée`);
});

// La ligne d'essai du fichier du patron n'a jamais rien à faire dans le menu.
assert.ok(/db\.refs\.filter\(r=>r\.genre&&r\.designation&&r\.designation!=='TEST'\)/.test(DEVIS),
  'la ligne « TEST » reste hors du menu de la vendeuse');

console.log('✓ choix de la référence : la référence ouvre la ligne, le clavier suit, `.value` tient la façade');
