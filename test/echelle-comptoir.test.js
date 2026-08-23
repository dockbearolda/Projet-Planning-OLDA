'use strict';

// L'ÉCHELLE DE L'ÉCRAN DU COMPTOIR (22/08/2026)
//
// `public/comptoir/demande-devis.html` est l'écran de RÉFÉRENCE : c'est lui
// qui fixe les tailles, les graisses, les interlignes et les arrondis de
// l'application. Il en comptait vingt-cinq de texte — 10, 11, 11.5, 12, 12.5,
// 13, 13.5, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 27, 28 px, plus la
// taille par défaut d'un h3 que personne n'avait déclarée. Des écarts d'un
// demi-pixel que l'œil ne lit pas comme une hiérarchie, seulement comme du
// désordre.
//
// Ce fichier tient les quatre choses qui reviendraient en silence :
//   1. QUATRE TAILLES, déclarées une seule fois, avec de vrais écarts.
//   2. AUCUNE TAILLE EN DUR dans les règles de l'écran — le ticket imprimé
//      excepté : il compose en Courier sur du 80 mm, c'est un document.
//   3. TROIS GRAISSES. Manrope s'arrête à 800 : un « font-weight:900 » se
//      rendait EXACTEMENT comme un 800, une marche qui ne se voyait pas.
//   4. UNE SEULE BOÎTE pour tout ce qui se clique ou se remplit.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const DEVIS = fs.readFileSync(path.join(RACINE, 'public/comptoir/demande-devis.html'), 'utf8');

// Les commentaires de ce dépôt CITENT des règles, accolades et tailles
// comprises : sans les retirer d'abord, tout ce qui suit compte de travers.
const sansCommentaires = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');
const FEUILLES = [...DEVIS.matchAll(/<style>([\s\S]*?)<\/style>/g)]
  .map((m) => sansCommentaires(m[1])).join('\n');

// --- 1. L'ÉCHELLE, DÉCLARÉE UNE SEULE FOIS -----------------------------------

const echelle = {};
for (const m of FEUILLES.matchAll(/:root\s*\{([^}]*)\}/g)) {
  m[1].split(';').forEach((d) => {
    const i = d.indexOf(':');
    if (i > 0 && d.trim().startsWith('--')) echelle[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  });
}

const TAILLES = ['--taille-note', '--taille-texte', '--taille-titre', '--taille-grand'];
TAILLES.forEach((nom) => assert.ok(echelle[nom], `${nom} doit être déclarée au :root`));

const px = (nom) => Number.parseFloat(echelle[nom]);
// Quatre marches, et de vraies marches : sous 12 % d'écart, l'œil ne lit pas
// une hiérarchie, il lit une hésitation.
for (let i = 1; i < TAILLES.length; i += 1) {
  const bas = px(TAILLES[i - 1]);
  const haut = px(TAILLES[i]);
  assert.ok(haut > bas * 1.12,
    `${TAILLES[i]} (${haut}px) doit se distinguer franchement de ${TAILLES[i - 1]} (${bas}px)`);
}
// Aucune demi-taille : « 13.5px » est précisément ce qu'on vient de retirer.
TAILLES.forEach((nom) => assert.ok(/^\d+px$/.test(echelle[nom]),
  `${nom} = « ${echelle[nom] } » : une taille s'écrit en pixels entiers`));
// Ces écrans se lisent debout, à bout de bras.
assert.ok(px('--taille-note') >= 13, 'la plus petite taille ne descend pas sous 13 px');
assert.ok(px('--taille-texte') >= 15, 'le texte courant ne descend pas sous 15 px');

const GRAISSES = ['--graisse-texte', '--graisse-note', '--graisse-forte'];
GRAISSES.forEach((nom) => assert.ok(echelle[nom], `${nom} doit être déclarée au :root`));
// Manrope va de 200 à 800 : au-delà, le navigateur RABOTE et rend du 800. Une
// graisse qu'on ne voit pas n'est pas une hiérarchie.
GRAISSES.forEach((nom) => assert.ok(Number(echelle[nom]) <= 800,
  `${nom} = ${echelle[nom]} : la police s'arrête à 800, au-dessus rien ne change`));

assert.ok(/@font-face\{font-family:'Manrope';[^}]*font-weight:200 800/.test(sansCommentaires(DEVIS)),
  'la borne 800 vient du fichier de police lui-même');

// --- 2. AUCUNE TAILLE EN DUR DANS LES RÈGLES DE L'ÉCRAN ----------------------
//
// Le ticket imprimé garde les siennes : Courier, 80 mm de large, c'est un
// document, pas de l'écran. Tout le reste passe par l'échelle.
const AUTORISEES = new Set([...TAILLES.map((t) => `var(${t})`), 'var(--recap-texte)', 'var(--recap-grand)', 'inherit']);
const fautes = [];
for (const m of FEUILLES.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
  const selecteur = m[1].trim();
  if (/ticket/.test(selecteur)) continue;
  for (const d of m[2].matchAll(/font-size:\s*([^;}!]+)/g)) {
    if (!AUTORISEES.has(d[1].trim())) fautes.push(`${selecteur} → font-size:${d[1].trim()}`);
  }
}
assert.deepStrictEqual(fautes, [],
  'une taille écrite en dur revient dans l’écran : elle doit venir de l’échelle');

// Et pas non plus posée à la main dans le HTML ou dans un morceau de JS.
const HORS_FEUILLE = sansCommentaires(DEVIS.replace(/<style>[\s\S]*?<\/style>/g, ''));
[...HORS_FEUILLE.matchAll(/font-size:\s*([^;"'}]+)/g)].forEach((m) => {
  if (/ticket/i.test(HORS_FEUILLE.slice(Math.max(0, m.index - 220), m.index))) return;
  assert.ok(m[1].trim().startsWith('var(--taille-'),
    `« font-size:${m[1].trim()} » posé à la main : il doit venir de l’échelle`);
});

// --- 3. TROIS GRAISSES, PAS CINQ ---------------------------------------------
const graissesEnDur = [];
for (const m of FEUILLES.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
  const selecteur = m[1].trim();
  if (/ticket/.test(selecteur) || /@font-face/.test(selecteur)) continue;
  for (const d of m[2].matchAll(/font-weight:\s*([^;}!]+)/g)) {
    const v = d[1].trim();
    if (!/^var\(--graisse-(texte|note|forte)\)$/.test(v)) graissesEnDur.push(`${selecteur} → font-weight:${v}`);
  }
}
assert.deepStrictEqual(graissesEnDur, [],
  'une graisse écrite en dur : les trois de l’échelle suffisent');
// Le gras du navigateur vaut 700 — une quatrième graisse par la porte de
// derrière, sur chaque <b> et chaque <strong> de la page.
assert.ok(/b,strong\{font-weight:var\(--graisse-forte\)\}/.test(FEUILLES),
  'le gras par défaut du navigateur est ramené sur l’échelle');

// --- 4. UNE SEULE BOÎTE POUR CE QUI SE CLIQUE ET SE REMPLIT ------------------
//
// Sur la même rangée on trouvait 51 px pour un champ, 49,6 pour le bouton
// plein et 48,3 pour le bouton bordé. Même taille de texte, même interligne,
// même rembourrage vertical : la hauteur suit, sans qu'aucune ne soit écrite.
const regle = (selecteur) => {
  const out = {};
  for (const m of FEUILLES.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (m[1].replace(/\s+/g, '') !== selecteur.replace(/\s+/g, '')) continue;
    m[2].split(';').forEach((d) => {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).replace('!important', '').trim();
    });
  }
  return out;
};
const champ = regle('input,select,textarea');
const bouton = regle('button');
const pilule = regle('.primary,.secondary,.danger,.whatsapp');

assert.strictEqual(champ['font-size'], 'var(--taille-texte)', 'un champ écrit dans la taille du texte');
assert.strictEqual(bouton['font-size'], 'var(--taille-texte)', 'un bouton aussi');
assert.strictEqual(champ['line-height'], 'var(--ligne-champ)', 'le champ a une hauteur de ligne en rapport');
assert.strictEqual(bouton['line-height'], 'var(--ligne-champ)', '… le bouton la même');
assert.strictEqual(champ.padding.split(' ')[0], 'var(--champ-y)', 'le champ se remplit de la hauteur de l’échelle');
assert.strictEqual(pilule.padding.split(' ')[0], 'var(--champ-y)', '… la pilule de la même');
// Le bouton pleine largeur ne se distingue plus par sa taille de texte : il
// est déjà plein, encré et large.
assert.ok(!/button\.full\{[^}]*font-size/.test(FEUILLES),
  'le bouton pleine largeur n’a pas sa propre taille de texte');

// --- 5. TROIS ARRONDIS -------------------------------------------------------
['--arrondi-champ', '--arrondi-bloc', '--arrondi-carte'].forEach((nom) =>
  assert.ok(echelle[nom], `${nom} doit être déclarée au :root`));
assert.strictEqual(champ['border-radius'], 'var(--arrondi-champ)', 'un champ prend l’arrondi des champs');
assert.strictEqual(bouton['border-radius'], 'var(--arrondi-champ)', '… un bouton aussi');

console.log('✓ échelle du comptoir : quatre tailles, trois graisses, une seule boîte pour les champs et les boutons');
