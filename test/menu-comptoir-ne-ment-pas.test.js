'use strict';

// UN CHAMP FERMÉ NE MONTRE JAMAIS AUTRE CHOSE QUE SA VALEUR (29/08/2026)
// ===========================================================================
// Les listes du comptoir ne sont plus des `<select>` natifs : `pont.js` les
// habille d'un menu à chevron, et ce menu peint le champ fermé LUI-MÊME, à
// partir de `hote.value`, au moment où on choisit.
//
// D'où le piège, écrit noir sur blanc dans pont.js au-dessus de
// `menuRafraichir` : « le formulaire pose des `.value` par programme — une
// écriture directe ne déclenche AUCUN évènement. Le champ fermé doit donc être
// repeint à la main. » Oublier l'appel ne casse rien, ne lève rien, ne rougit
// aucun test : le champ garde simplement l'ancien libellé, avec une valeur
// vide derrière.
//
// CE QUE ÇA DONNAIT, mesuré au rendu avant correction :
//
//   1. « Produit du catalogue ». On clique « + Produit hors catalogue » dans le
//      panneau. Le formulaire manuel s'ouvre — et le champ reste sur
//      « + Saisie manuelle — produit hors catalogue », valeur vide. Cliquer
//      « Ajouter à la demande » répond « Choisis un produit dans la liste. »
//      juste sous un champ qui en montre un.
//   2. Le besoin manuel, pire parce qu'il revient à CHAQUE besoin. On ajoute
//      « Signalétique / TROTEC ». `cancelNeedEdit` vide les deux champs pour le
//      suivant, l'écran continue d'afficher les deux. On remplit la
//      désignation, on valide : « Choisis une catégorie. » sur un champ qui
//      affiche « Signalétique », encadré de rouge. Il fallait rouvrir le menu et
//      rechoisir ce qu'on avait sous les yeux.
//
// Les deux se voient à l'écran et ne se voient pas dans le code : le seul
// endroit où l'oubli est visible, c'est la comparaison entre ce qu'un champ
// AFFICHE et ce qu'il VAUT. C'est ce que ce fichier vérifie, statiquement.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const PAGES = ['public/comptoir/demande-devis.html', 'public/comptoir/vente-directe.html'];

// Les trois façons de repeindre : la fonction du pont, sa version « tous », et
// les regroupements que les pages se donnent (une par écran, pas davantage).
const REPEINT = /menuRafraichir|menusRafraichirTous|repeindreMenusDuBesoin/;

// Découpe un fichier en fonctions nommées, par comptage d'accolades. Grossier
// mais suffisant ici — et le compte total sert de garde : si la découpe casse,
// le test doit échouer, pas passer sur un ensemble vide.
function fonctionsDe(src) {
  const out = [];
  const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const debut = m.index + m[0].length - 1;
    let prof = 0, i = debut;
    for (; i < src.length; i++) {
      if (src[i] === '{') prof += 1;
      else if (src[i] === '}') { prof -= 1; if (prof === 0) break; }
    }
    out.push({ nom: m[1], corps: src.slice(debut, i + 1) });
  }
  return out;
}

let totalFonctions = 0;
const fautes = [];

for (const page of PAGES) {
  const src = fs.readFileSync(path.join(RACINE, page), 'utf8');
  const selects = new Set([...src.matchAll(/<select[^>]*\bid="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(selects.size >= 2, `${page} : aucune liste trouvée — le test ne lit plus la page`);

  const fonctions = fonctionsDe(src);
  totalFonctions += fonctions.length;

  for (const f of fonctions) {
    // `.value =` et non `.value ==` : une comparaison ne repeint rien.
    const ecrits = [...f.corps.matchAll(/\$\('([A-Za-z0-9_]+)'\)\.value\s*=(?!=)/g)]
      .map((m) => m[1]).filter((id) => selects.has(id));
    if (!ecrits.length || REPEINT.test(f.corps)) continue;
    fautes.push(`${page} → ${f.nom}() écrit ${[...new Set(ecrits)].join(', ')} sans repeindre le menu`);
  }
}

assert.ok(totalFonctions > 200,
  `seulement ${totalFonctions} fonctions découpées : le comptage d’accolades ne suit plus le fichier`);

assert.deepStrictEqual(fautes, [],
  'un champ va montrer autre chose que sa valeur :\n  ' + fautes.join('\n  '));

// ---------------------------------------------------------------------------
// LA PORTE DE LA SAISIE MANUELLE EST DÉCLARÉE, pas devinée
// ---------------------------------------------------------------------------
// `menuRenvoiManuel` cherche d'abord `data-menu-manuel`, et retombe sinon sur
// la première option dont la valeur figure dans `MENU_VALEURS_LIBRES`. La liste
// du catalogue marchait par ce SECOND chemin — par coïncidence, parce qu'elle
// porte une option `__manuel`. Le jour où cette option change de nom, le « + »
// du panneau se remettrait à proposer d'inventer un produit : or ici une valeur
// est un INDICE dans `CAT_LIGNES`, et un texte tapé n'en sera jamais un.
const DEVIS = fs.readFileSync(path.join(RACINE, 'public/comptoir/demande-devis.html'), 'utf8');
assert.match(DEVIS, /<select id="catProduit"[^>]*data-menu-manuel="__manuel"/,
  'la liste du catalogue déclare où mène son « + » : sa valeur est un indice, pas un texte');

const PONT = fs.readFileSync(path.join(RACINE, 'public/comptoir/pont.js'), 'utf8');
assert.match(PONT, /window\.menuRafraichir = function menuRafraichir\(hote\)/,
  'la fonction de repeinture reste exposée : les pages en dépendent');

console.log('✓ menus du comptoir : aucun champ ne montre autre chose que sa valeur');
