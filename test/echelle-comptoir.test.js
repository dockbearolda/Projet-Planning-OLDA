'use strict';

// LA CHARTE SUR L'ÉCRAN DU COMPTOIR (22/08/2026)
//
// `public/comptoir/demande-devis.html` est l'écran de RÉFÉRENCE du comptoir.
// Il vivait sur SA PROPRE charte : un bleu marine #142e54 pour l'action, un
// bleu vif #3064e8 au focus, un vert de marque pour WhatsApp, 107 teintes en
// tout, et vingt-cinq tailles de texte. Le planning, lui, tourne depuis le
// 29/07 sur une charte arrêtée par la direction — gris #f5f6f8, accent encre
// #111827, la couleur pour dire un état et rien d'autre.
//
// Les deux ne font plus qu'une : `public/charte.css` porte les jetons, le
// planning et le comptoir le chargent tous les deux.
//
// Ce fichier tient les six choses qui reviendraient en silence :
//   1. LA CHARTE EST CHARGÉE, et l'écran ne redéclare aucun jeton à lui.
//   2. QUATRE TAILLES, avec de vrais écarts, et aucune taille en dur dans les
//      règles de l'écran — le ticket imprimé excepté : il compose en Courier
//      sur du 80 mm, c'est un document.
//   3. TROIS GRAISSES. Manrope s'arrête à 800 : un « font-weight:900 » se
//      rendait EXACTEMENT comme un 800, une marche qui ne se voyait pas.
//   4. AUCUNE COULEUR EN DUR : pas une teinte qui ne vienne d'un jeton.
//   5. UNE SEULE BOÎTE pour tout ce qui se clique ou se remplit.
//   6. TROIS ARRONDIS, TROIS ÉLÉVATIONS.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const DEVIS = fs.readFileSync(path.join(RACINE, 'public/comptoir/demande-devis.html'), 'utf8');
const CHARTE = fs.readFileSync(path.join(RACINE, 'public/charte.css'), 'utf8');

// Les commentaires de ce dépôt CITENT des règles, accolades et tailles
// comprises : sans les retirer d'abord, tout ce qui suit compte de travers.
const sansCommentaires = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');
const FEUILLES = [...DEVIS.matchAll(/<style>([\s\S]*?)<\/style>/g)]
  .map((m) => sansCommentaires(m[1])).join('\n');

// --- 1. LA CHARTE EST CHARGÉE, ET L'ÉCRAN N'A PLUS DE JETONS À LUI ----------

assert.ok(/<link[^>]+href="\.\.\/charte\.css"/.test(DEVIS),
  'l’écran charge la charte de l’application, le même fichier que le planning');
assert.ok(!/<link[^>]+href="https?:/.test(DEVIS),
  '… servie par nous : rien ne vient d’un autre domaine');

const jetonsDeLaPage = [];
for (const m of FEUILLES.matchAll(/:root\s*\{([^}]*)\}/g)) {
  m[1].split(';').forEach((d) => {
    if (d.trim().startsWith('--')) jetonsDeLaPage.push(d.slice(0, d.indexOf(':')).trim());
  });
}
assert.deepStrictEqual(jetonsDeLaPage, [],
  'l’écran ne redéclare aucun jeton : il n’a plus de charte à lui');

const echelle = {};
for (const m of CHARTE.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/:root\s*\{([^}]*)\}/g)) {
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

// --- 4. AUCUNE COULEUR EN DUR ------------------------------------------------
//
// L'écran en comptait 107 : un bleu marine pour l'action, un bleu vif au
// focus, le vert de la marque WhatsApp, et une quinzaine de gris à un point
// d'écart les uns des autres. La couleur ne s'écrit plus : elle se nomme.
// Le TICKET IMPRIMÉ garde les siennes — noir sur papier blanc, c'est un
// document, pas de l'écran.
const teintes = [];
for (const m of FEUILLES.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
  const selecteur = m[1].trim();
  if (/ticket/.test(selecteur) || /@font-face|@keyframes/.test(selecteur)) continue;
  for (const d of m[2].matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
    if (d[0].includes('var(')) continue;                     // rgba(var(--primary-rgb), …)
    if (/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,/.test(d[0])) continue;  // le voile d'une modale
    teintes.push(`${selecteur.slice(0, 44)} → ${d[0]}`);
  }
}
assert.deepStrictEqual([...new Set(teintes)], [],
  'une couleur écrite en dur revient dans l’écran : elle doit venir d’un jeton');

// Et pas davantage posée à la main dans le HTML ou dans un morceau de JS.
[...HORS_FEUILLE.matchAll(/style="[^"]*?(#[0-9a-fA-F]{3,8})/g)].forEach((m) => {
  if (/ticket/i.test(HORS_FEUILLE.slice(Math.max(0, m.index - 220), m.index))) return;
  assert.fail(`« ${m[1]} » posé à la main dans le balisage : il doit venir d’un jeton`);
});

// --- 5. UNE SEULE BOÎTE POUR CE QUI SE CLIQUE ET SE REMPLIT ------------------
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

// --- 6. TROIS ARRONDIS, TROIS ÉLÉVATIONS -------------------------------------
['--arrondi-champ', '--arrondi-bloc', '--arrondi-carte'].forEach((nom) =>
  assert.ok(echelle[nom], `${nom} doit être déclarée au :root`));
// Les deux formes que le planning nommait déjà ne sont pas redites : l'arrondi
// d'un champ EST « --radius », celui d'une carte EST « --radius-card ».
assert.strictEqual(echelle['--arrondi-champ'].replace(/\s*\/\*[\s\S]*$/, ''), 'var(--radius)',
  'l’arrondi d’un champ est celui que le planning nomme déjà');
assert.strictEqual(echelle['--arrondi-carte'].replace(/\s*\/\*[\s\S]*$/, ''), 'var(--radius-card)',
  'l’arrondi d’une carte aussi');
assert.strictEqual(champ['border-radius'], 'var(--arrondi-champ)', 'un champ prend l’arrondi des champs');
assert.strictEqual(bouton['border-radius'], 'var(--arrondi-champ)', '… un bouton aussi');

// --- 7. LE PLANNING ET LE COMPTOIR CHARGENT LE MÊME FICHIER -----------------
const INDEX = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');
assert.ok(/<link rel="stylesheet" href="charte\.css"/.test(INDEX),
  'le planning charge la charte, et AVANT sa propre feuille');
assert.ok(INDEX.indexOf('charte.css') < INDEX.indexOf('styles.css'),
  '… devant styles.css : les jetons d’abord, les règles ensuite');
const STYLES = fs.readFileSync(path.join(RACINE, 'public/styles.css'), 'utf8');
assert.ok(!/:root\s*\{[^}]*--bg\s*:/.test(STYLES),
  'styles.css ne redéclare pas les jetons : ils n’existent qu’à un seul endroit');
const SW = fs.readFileSync(path.join(RACINE, 'public/sw.js'), 'utf8');
assert.ok(/'\/charte\.css'/.test(SW),
  'la charte est dans la coquille : hors ligne, sans elle, tout s’ouvre sans une couleur');

// --- 8. L'ACCENT VA À CE QUI ENREGISTRE --------------------------------------
//
// La rangée de fin portait l'encre sur « Nouvelle demande » — un bouton qui
// EFFACE le dossier — et laissait en simple trait celui qui l'envoie au
// planning. C'est la rangée qui a coûté le dossier de Jacqueline le 13/08.
assert.ok(/<button class="primary" onclick="saveDraft\(\)">/.test(DEVIS),
  'le bouton qui enregistre porte l’accent');
assert.ok(/<button class="secondary" onclick="newRequest\(\)">/.test(DEVIS),
  '… et celui qui efface le dossier n’est qu’un trait');
assert.ok(DEVIS.indexOf('onclick="saveDraft()"') < DEVIS.indexOf('onclick="newRequest()"'),
  '… et il passe devant lui dans la rangée');

console.log('✓ charte du comptoir : quatre tailles, trois graisses, aucune couleur en dur, une seule boîte pour les champs et les boutons');
