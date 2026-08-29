'use strict';

// TOUT CE QUI PEUT ÊTRE À LA MÊME HAUTEUR L'EST — ET C'EST TESTÉ
//
// Consigne de Charlie, 27/08/2026, mot pour mot : « il est extrêmement
// important que tout ce qui peut être à la même hauteur doit l'être, tu dois
// être ultra vigilant là-dessus, coder en dur sur l'importance de ça. »
//
// Ce qui l'a déclenchée : le menu de « + Nouveau Projet » et le panneau
// « Colonnes » tombent de la MÊME barre, à un clic l'un de l'autre, et
// s'écrivaient chacun leur rangée — 50 px contre 44, 0/14 de rembourrage
// contre 6/10, graisse 800 contre 600. Et le menu tombait 13,7 px à droite du
// « + » qui l'ouvre. Deux composants qui se ressemblent au lieu d'un seul :
// c'est le défaut que la charte du dépôt nomme en toutes lettres.
//
// Un écart pareil ne se voit pas en relisant un écran : il se voit en
// COMPARANT deux écrans. C'est pour ça qu'il vit dans un test et pas dans une
// bonne intention.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(RACINE, 'public/styles.css'), 'utf8');
const APP = fs.readFileSync(path.join(RACINE, 'public/app.js'), 'utf8');
const PROJET = fs.readFileSync(path.join(RACINE, 'public/nouveau-projet.js'), 'utf8');
const PONT = fs.readFileSync(path.join(RACINE, 'public/comptoir/pont.js'), 'utf8');

// Les commentaires portent les anciennes valeurs (« 50 px contre 44 ») : les
// chercher dans le CSS commenté ferait passer le test pour de mauvaises
// raisons, ou le ferait échouer sur une phrase.
const cssNu = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

// ---------------------------------------------------------------------------
// 1. UNE RANGÉE DE PANNEAU, UNE SEULE ÉCRITURE
// ---------------------------------------------------------------------------
const regleRangee = cssNu.match(/\.colbar-item,\s*\n\s*\.np-menu__item\s*\{([^}]*)\}/);
assert.ok(regleRangee,
  'le panneau « Colonnes » et le menu de « Nouveau Projet » partagent UNE seule règle : deux écritures redeviennent deux hauteurs');
assert.ok(/min-height:\s*var\(--ctrl-h\)/.test(regleRangee[1]),
  '… et leur hauteur est un JETON (--ctrl-h), pas un nombre : un nombre se recopie de travers');
assert.ok(/padding:\s*6px 10px/.test(regleRangee[1]) && /gap:\s*8px/.test(regleRangee[1]),
  '… même rembourrage et même écart : la hauteur seule ne suffit pas à faire la même rangée');
assert.ok(/font-weight:\s*var\(--graisse-note\)/.test(regleRangee[1]),
  '… et la même graisse : 800 d’un côté, 600 de l’autre, ça se lit comme deux composants');

// La règle propre au menu ne doit plus rien redéclarer de la boîte : un bloc
// dont `.np-menu__item` est le SEUL sélecteur, c’est la deuxième hauteur qui
// revient par la porte de derrière.
const blocs = [...cssNu.matchAll(/([^{}]+)\{([^}]*)\}/g)];
const soloItem = blocs.filter((b) => b[1].trim() === '.np-menu__item');
assert.strictEqual(soloItem.length, 0,
  'plus aucun bloc dont « .np-menu__item » est le seul sélecteur : la boîte se déclare avec celle du panneau Colonnes');
const soloIcone = blocs.filter((b) => b[1].trim() === '.np-menu__ic');
assert.strictEqual(soloIcone.length, 0,
  '… ni pour son icône, pour la même raison');

// ---------------------------------------------------------------------------
// 1 bis. UNE SEULE HAUTEUR DANS LA BARRE DU HAUT (28/08/2026)
// ---------------------------------------------------------------------------
// « Je veux voir avec 1 seul. » La barre en portait QUATRE : 36 px pour les
// onglets, 44 pour les boutons ronds et le poste, 50 pour la pilule de
// recherche. Tout est ramené sur `--ctrl-h` — la boîte que la recherche portait
// déjà, et que porte tout ce qui se clique et se remplit ailleurs. Descendre la
// recherche à 44 aurait fait de la barre une exception de plus.
const boiteDe = (selecteur) => {
  const m = cssNu.match(new RegExp(`\\n${selecteur.replace(/[.\-]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
};
for (const [sel, mot] of [['.icon-btn', 'width'], ['.poste', 'height'], ['.nav-switch-btn', 'min-height']]) {
  const bloc = boiteDe(sel);
  assert.ok(bloc, `la règle ${sel} existe toujours`);
  assert.ok(new RegExp(`${mot}:\\s*var\\(--ctrl-h\\)`).test(bloc),
    `${sel} prend la boîte de l’application (--ctrl-h) : la barre du haut n’a plus qu’UNE hauteur`);
  assert.ok(!/var\(--rond\)/.test(bloc),
    `${sel} ne garde aucun reste de --rond : c’est par là que la deuxième hauteur revient`);
}
assert.ok(/\.champ-recherche\s*\{[^}]*height:\s*var\(--ctrl-h\)/.test(
  fs.readFileSync(path.join(RACINE, 'public/charte.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')),
  '… et la pilule de recherche, qui la portait déjà, ne bouge pas');

// ---------------------------------------------------------------------------
// 2. L'ICÔNE D'UNE RANGÉE A UNE BOÎTE, ET ELLE EST ÉCRITE
// ---------------------------------------------------------------------------
const regleIcone = cssNu.match(/\.colbar-item__ic,\s*\n\s*\.np-menu__ic\s*\{([^}]*)\}/);
assert.ok(regleIcone,
  'les icônes des deux panneaux partagent une règle : sinon elles ne tombent pas sur le même rail');
assert.ok(/width:\s*var\(--ic\)/.test(regleIcone[1]) && /height:\s*var\(--ic\)/.test(regleIcone[1]),
  '… avec une largeur ET une hauteur écrites : sans elles la boîte sort de la police, et elle change avec le glyphe');

// ---------------------------------------------------------------------------
// 3. LE MENU TOMBE SUR LE RAIL DE CE QUI L'OUVRE
// ---------------------------------------------------------------------------
assert.ok(/const icOnglet = \$viewProjet\.querySelector/.test(APP)
  && /const icRangee = pan\.querySelector\('\.np-menu__ic'\)/.test(APP),
  'le menu s’aligne sur l’ICÔNE de son onglet, pas sur le bord du bouton');
assert.ok(/const ecart = icRangee\.getBoundingClientRect\(\)\.left - icOnglet\.getBoundingClientRect\(\)\.left/.test(APP),
  '… et l’écart se MESURE : écrit en dur, il ment le jour où un rembourrage bouge');
assert.ok(/pan\.style\.left = `\$\{gauche\.toFixed\(2\)\}px`/.test(APP),
  '… au sous-pixel : l’onglet est posé à 403,34 px, arrondir laissait 0,66 px entre les deux icônes');
assert.ok(/for \(let passe = 0; passe < 2; passe \+= 1\)/.test(APP)
  && /if \(Math\.abs\(ecart\) < 0\.05\) break;/.test(APP),
  '… et en DEUX passes : une seule correction laissait 0,32 px, la rangée se recomposant sur sa nouvelle position');
assert.ok(/large - pan\.offsetWidth - 8/.test(APP),
  '… sans jamais sortir de l’écran : la barre finit à droite sur un écran étroit');

// ---------------------------------------------------------------------------
// 4. UN CLIC NE VAUT QU'UNE SEULE REMISE À ZÉRO
// ---------------------------------------------------------------------------
assert.ok(/let ouvertureParcours = false;/.test(APP),
  'un verrou dit à `mountProjet` de ne rien remettre à zéro pendant que le menu ouvre');
assert.ok(/\} else if \(!ouvertureParcours && projetModule && projetModule\.resetProjet\)/.test(APP),
  '… et `mountProjet` le respecte : sans lui, `applyHash` et notre appel font DEUX remises à zéro');
assert.ok(/projetModule\.ouvrirParcoursNeuf\(id\)/.test(APP) && !/projetModule\.ouvrirParcours\(/.test(APP),
  'le menu passe par `ouvrirParcoursNeuf` : un seul mouvement, un seul parcours touché');
assert.ok(/export function ouvrirParcoursNeuf/.test(PROJET),
  '… et la fonction existe côté parcours');
const neuf = PROJET.match(/export function ouvrirParcoursNeuf[\s\S]*?\n\}/)[0];
assert.ok(!/afficher\(null\)/.test(neuf),
  'ouvrir un parcours ne passe JAMAIS par l’accueil à deux tuiles : c’est un écran qu’on ne voulait pas voir');
assert.ok(/aRafraichir\.add\(f\.id\)/.test(neuf),
  '… et le parcours d’à côté est seulement NOTÉ : le recharger maintenant, c’est 120 Ko pour un écran que personne ne regarde');

// ---------------------------------------------------------------------------
// 5. ON NE RECHARGE PAS UN ÉCRAN ENCORE VIERGE
// ---------------------------------------------------------------------------
assert.ok(/typeof w\.oldaParcoursVierge === 'function' && w\.oldaParcoursVierge\(\)/.test(PROJET),
  'avant de recharger, on demande au cadre s’il y a quelque chose à jeter');
assert.ok(/window\.oldaParcoursVierge = \(\) => !saisieCommencee && !ecranFinal\(\)/.test(PONT),
  '… et le cadre sait répondre');
assert.ok(/document\.addEventListener\('input', marquerSaisie, true\)/.test(PONT)
  && /document\.addEventListener\('change', marquerSaisie, true\)/.test(PONT),
  '… le drapeau se lève à la PREMIÈRE frappe, en capture : un champ ajouté plus tard le lève aussi');
const reinit = PROJET.match(/function reinitialiser\(id\) \{[\s\S]*?\n\}/)[0];
assert.ok(/catch \(err\) \{ \/\* on ne sait pas : on recharge \*\/ \}/.test(reinit),
  'en cas de doute on RECHARGE : le formulaire du client précédent devant le suivant, jamais');

console.log('✓ même hauteur : une seule rangée de panneau, une boîte d’icône écrite, le menu sur le rail de son onglet');


// ---------------------------------------------------------------------------
// LA FICHE ATELIER PREND LA MÊME BOÎTE (29/08/2026)
// ---------------------------------------------------------------------------
// Elle s'ouvre à UN CLIC du planning, et elle était le seul écran à ne pas
// prendre `--ctrl-h`. Elle en déclarait QUATRE, en nombres — 34, 40, 42, 44 —
// pour dire une densité : un champ dans une bulle, un champ de colonne, un
// contrôle de bandeau, un contrôle de barre. C'est exactement ce que la règle
// du 27/08 interdit : ce qui peut être à la même hauteur l'est, et une hauteur
// est un jeton, jamais un nombre.
//
// ELLE NE REDÉCLARE PAS L'ÉCHELLE NON PLUS. `--fa-lab: 14px`, `--fa-val: 17px`,
// `--fa-titre: 21px` valaient exactement `--taille-note`, `--taille-texte` et
// `--taille-titre` : trois nombres recopiés. Le jour où l'échelle bouge, un
// écran recopié reste seul dans son coin — et ça ne se voit pas en le relisant,
// seulement en le comparant à l'écran d'à côté.
{
  const FICHE = fs.readFileSync(path.join(RACINE, 'public/fiche-atelier.css'), 'utf8');
  const jetons = FICHE.match(/^\s+--fa-[\w-]+:[^;]+;/gm) || [];
  assert.ok(jetons.length, 'la fiche atelier déclare bien ses jetons');

  for (const j of jetons.filter((x) => /--fa-h-/.test(x))) {
    assert.match(j, /var\(--ctrl-h\)/,
      `la fiche atelier écrit une hauteur de commande à la main : ${j.trim()}`);
  }
  for (const j of jetons.filter((x) => /--fa-(lab|val|fort|titre|min)\b/.test(x))) {
    assert.match(j, /var\(--taille-/,
      `la fiche atelier recopie un cran de l’échelle : ${j.trim()}`);
  }
  // Et elle n'en invente pas un cinquième : trois crans à l'écran, pas quatre.
  const crans = new Set((FICHE.match(/--fa-\w+: var\((--taille-[\w-]+)\)/g) || [])
    .map((m) => m.match(/--taille-[\w-]+/)[0]));
  assert.ok(crans.size <= 3,
    `la fiche atelier prend ${crans.size} crans de texte — deux par surface, trois au grand maximum`);
}
