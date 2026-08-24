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
// Retire un bloc `@media print{…}` en comptant les accolades : sans ça, le
// `#fff` du papier compte comme une couleur en dur de l'écran.
function sansImpression(css) {
  let out = '', i = 0;
  while (i < css.length) {
    const d = css.indexOf('@media print', i);
    if (d < 0) { out += css.slice(i); break; }
    out += css.slice(i, d);
    let j = css.indexOf('{', d), n = 0;
    for (; j < css.length; j += 1) {
      if (css[j] === '{') n += 1;
      else if (css[j] === '}' && (n -= 1) === 0) { j += 1; break; }
    }
    i = j;
  }
  return out;
}

const FEUILLES = [...DEVIS.matchAll(/<style>([\s\S]*?)<\/style>/g)]
  .map((m) => sansCommentaires(m[1])).join('\n');
// LE PAPIER N'A PAS DE THÈME. Ce qui s'imprime part en noir sur blanc, écrit en
// toutes lettres : les jetons de la charte suivent le poste, et un poste en
// thème sombre imprimerait un pavé anthracite pleine page. Les blocs
// `@media print` sortent donc du contrôle des couleurs.
const FEUILLES_ECRAN = sansImpression(FEUILLES);

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
// L'ÉCRAN DE LA DEMANDE A REÇU SA PROPRE DENSITÉ LE 24/08/2026 (7 points du
// patron) : valeur 14, intitulé 12,5, aide 12, mention 11. Quatre tailles DE
// PLUS, mais toujours NOMMÉES et déclarées une seule fois — dans charte.css,
// sous `.ecran-comptoir`. La règle ne change pas : rien en dur, tout se nomme.
const DD_TAILLES = ['--dd-taille-valeur', '--dd-taille-label', '--dd-taille-aide', '--dd-taille-mention'];
const AUTORISEES = new Set([...TAILLES, ...DD_TAILLES].map((t) => `var(${t})`).concat(['var(--recap-texte)', 'var(--recap-grand)', 'inherit']));
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
    if (!/^var\(--(?:graisse-(?:texte|note|forte)|dd-graisse-(?:douce|appuyee))\)$/.test(v)) graissesEnDur.push(`${selecteur} → font-weight:${v}`);
  }
}
assert.deepStrictEqual(graissesEnDur, [],
  'une graisse écrite en dur : les trois de l’échelle suffisent');
// Le gras du navigateur vaut 700 — une quatrième graisse par la porte de
// derrière, sur chaque <b> et chaque <strong> de la page.
assert.ok(/b,strong\{font-weight:var\(--graisse-forte\)\}/.test(FEUILLES),
  'le gras par défaut du navigateur est ramené sur l’échelle');

// --- 3 bis. DEUX TAILLES SUR CET ÉCRAN, PAS QUATRE ---------------------------
//
// La charte en propose quatre ; cet écran-ci n'en prend que DEUX. Le bloc d'un
// article donnait deux écritures au MÊME rôle, à vingt pixels d'écart l'une de
// l'autre : « Remise % » en 13 gras encre, et juste dessous « Prix HT / pièce »
// en 15 demi-gras gris. Ce sont tous les deux le nom d'une valeur. Deux pixels
// d'écart ne se lisent pas comme une hiérarchie, seulement comme du désordre.
const employees = new Set();
for (const m of FEUILLES.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
  if (/ticket/.test(m[1].trim())) continue;
  for (const d of m[2].matchAll(/font-size:\s*var\((--(?:dd-)?taille-[\w-]+)\)/g)) employees.add(d[1]);
}
// Depuis le 24/08 : les quatre tailles de la densité du comptoir, plus la
// taille du texte pour ce que les autres étapes lisent. Les chiffres annoncés
// au client passent par l'affectation `--recap-grand:var(--taille-grand)` —
// une affectation n'est pas une taille en dur, et on la tient juste dessous.
assert.deepStrictEqual([...employees].sort(),
  ['--dd-taille-aide', '--dd-taille-label', '--dd-taille-mention', '--dd-taille-valeur', '--taille-texte'],
  'cet écran écrit dans les tailles de sa densité, et dans rien d’autre');
assert.ok(/--recap-grand:var\(--taille-grand\)/.test(FEUILLES),
  'les chiffres annoncés au client gardent la grande taille de l’échelle');

// --- 4. AUCUNE COULEUR EN DUR ------------------------------------------------
//
// L'écran en comptait 107 : un bleu marine pour l'action, un bleu vif au
// focus, le vert de la marque WhatsApp, et une quinzaine de gris à un point
// d'écart les uns des autres. La couleur ne s'écrit plus : elle se nomme.
// Le TICKET IMPRIMÉ garde les siennes — noir sur papier blanc, c'est un
// document, pas de l'écran.
const teintes = [];
for (const m of FEUILLES_ECRAN.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
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

// DEPUIS LE 24/08, LA BOÎTE SE NOMME AU LIEU DE SE DÉDUIRE : 44 px
// (`--dd-champ-h`, charte.css), portés par le champ en `height` et par le
// bouton en `min-height` — un bouton centre son contenu tout seul. Le principe
// qui compte n'a pas bougé : UNE seule boîte pour tout ce qui se clique ou se
// remplit, et aucune hauteur locale — les deux la lisent au même endroit.
assert.strictEqual(champ['font-size'], 'var(--dd-taille-valeur)', 'un champ écrit dans la taille des valeurs');
assert.strictEqual(bouton['font-size'], 'var(--dd-taille-valeur)', 'un bouton aussi');
assert.strictEqual(champ['line-height'], 'var(--ligne-champ)', 'le champ a une hauteur de ligne en rapport');
assert.strictEqual(bouton['line-height'], 'var(--ligne-champ)', '… le bouton la même');
assert.ok(/input,select\{height:var\(--dd-champ-h\)\}/.test(FEUILLES),
  'le champ fait la boîte nommée de la charte');
assert.strictEqual(bouton['min-height'], 'var(--dd-champ-h)',
  '… le bouton la même : une seule boîte, lue au même endroit');
assert.strictEqual(champ.padding.split(' ')[0], '0',
  'la hauteur du champ ne doit plus rien à son rembourrage vertical');
assert.strictEqual(pilule.padding.split(' ')[0], '0',
  '… celle de la pilule non plus');
// Le bouton pleine largeur ne se distingue plus par sa taille de texte : il
// est déjà plein, encré et large.
assert.ok(!/button\.full\{[^}]*font-size/.test(FEUILLES),
  'le bouton pleine largeur n’a pas sa propre taille de texte');

// AUCUNE HAUTEUR DE COMMANDE ÉCRITE EN DUR. Elle se calcule : taille du texte
// + interligne + rembourrage. Deux boîtes seulement — la normale, et la serrée
// d'une action posée dans une ligne de liste (le panier n'a que 380 px).
assert.ok(echelle['--champ-y'] && echelle['--champ-y-serre'],
  'les deux rembourrages verticaux sont déclarés dans la charte');
const hauteurs = [];
for (const m of FEUILLES.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
  const selecteur = m[1].trim();
  // Une zone de texte fait exception : sa hauteur minimale dit COMBIEN DE
  // LIGNES elle montre, ce n'est pas la boîte d'une commande. Les tuiles et
  // les cartes cliquables non plus — ce sont des cibles, pas des champs.
  if (/ticket|textarea|besoin-tuile|priority-card|client-action-card|dp-|menu-liste|client-quick/.test(selecteur)) continue;
  for (const d of m[2].matchAll(/min-height:\s*(\d+(?:\.\d+)?px)/g)) hauteurs.push(`${selecteur.slice(0, 40)} → min-height:${d[1]}`);
}
assert.deepStrictEqual(hauteurs, [],
  'une hauteur de commande écrite en dur : elle doit sortir du rembourrage de la charte');

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

// --- 8. LA RANGÉE DE FIN NE PORTE PLUS D'ENJEU -------------------------------
//
// HISTOIRE DE CETTE RANGÉE, parce qu'elle a coûté un dossier (13/08) :
//   — elle portait l'encre sur « Nouvelle demande », qui EFFACE, et laissait en
//     simple trait « Enregistrer », qui envoie. On a inversé l'accent.
//   — collée à droite le 24/08, le point chaud est passé du premier au DERNIER
//     bouton : l'ordre s'est inversé pour garder celui qui efface le plus loin
//     possible de la main.
//   — le 24/08 au soir, le patron a fait retirer « Enregistrer » : le dossier
//     part dans « À trier » TOUT SEUL en arrivant sur l'écran. Un geste qu'on
//     ne demande plus ne peut plus être oublié — c'est la vraie correction, et
//     elle rend la question de l'accent sans objet.
//
// Ce qui se vérifie désormais : il ne reste QU'UN bouton, et rien de ce qu'il
// peut faire ne perd un dossier en silence.
assert.ok(!/onclick="saveDraft\(\)"/.test(DEVIS),
  'plus rien n’attend un geste pour enregistrer');
const rangeeFin = DEVIS.match(/<div class="actions a-droite"[^>]*>\s*(?:<!--[\s\S]*?-->\s*)*<button[\s\S]*?<\/div>/g)
  .filter((r) => /newRequest/.test(r));
assert.strictEqual(rangeeFin.length, 1, 'une seule rangée de fin');
assert.strictEqual((rangeeFin[0].match(/<button/g) || []).length, 1,
  'et elle ne porte qu’un bouton : celui qui passe au client suivant');
assert.ok(/<button class="secondary" onclick="newRequest\(\)">/.test(DEVIS),
  'il n’a pas l’encre : il n’enregistre rien, il efface l’écran');

// LE FILET QUI REMPLACE L'ACCENT. « Nouvelle demande » recharge la page : tant
// que le dossier n'est pas au planning, il le perd. pont.js l'intercepte et
// demande confirmation — c'est ce qui autorise à le laisser seul dans la rangée.
const PONT_FIN = fs.readFileSync(path.join(RACINE, 'public/comptoir/pont.js'), 'utf8');
assert.ok(/\[onclick\^="newRequest"\]/.test(PONT_FIN),
  '« Nouvelle demande » reste surveillé par le garde-fou');
assert.ok(/etatEnvoi === 'ok'/.test(PONT_FIN),
  '… qui ne se tait que lorsque le dossier est vraiment au planning');

console.log('✓ charte du comptoir : quatre tailles, trois graisses, aucune couleur en dur, une seule boîte pour les champs et les boutons');

// ===========================================================================
// 9. LE SECOND PARCOURS DU COMPTOIR — vente-directe.html (23/08/2026)
// ---------------------------------------------------------------------------
// Le 22/08, l'écran de demande de devis est entré dans la charte. Celui-ci est
// resté en arrière — et les deux tournent SUR LE MÊME POSTE, à un clic l'un de
// l'autre : bleu marine #142e54 pour l'action ici, encre #111827 à côté.
// Il comptait DIX-NEUF tailles de texte, SIX graisses et QUATRE-VINGT-NEUF
// teintes, empilées dans neuf feuilles successives (« V10 », « V10.1 »,
// « V10.2 », « V10.3 ») qui se corrigeaient l'une l'autre à coups de
// !important.
//
// LE TICKET FAIT EXCEPTION, et lui seul : il s'imprime et part avec le client.
// Son échelle est déclarée en UN endroit (--tk-*) et ne déborde pas sur la
// page ; ses noirs et ses blancs d'impression sont écrits en toutes lettres,
// parce que c'est le papier qui les impose — un poste en thème sombre
// imprimait sinon un pavé anthracite pleine page.
// ===========================================================================
const VENTE = fs.readFileSync(path.join(RACINE, 'public/comptoir/vente-directe.html'), 'utf8');

const FEUILLES_V = sansImpression([...VENTE.matchAll(/<style>([\s\S]*?)<\/style>/g)]
  .map((m) => sansCommentaires(m[1])).join('\n'));

assert.ok(/<link rel="stylesheet" href="\.\.\/charte\.css">/.test(VENTE),
  'l’écran de vente charge la charte, le même fichier que le planning et que l’écran d’à côté');
assert.ok(!/<link[^>]+href="https?:/.test(VENTE) && !/<script[^>]+src="https?:/.test(VENTE),
  '… et rien ne vient d’un autre domaine');

// Plus un seul jeton à lui : les « --vd-* » (encre marine, fond, trait, rouge)
// étaient sa charte privée.
const jetonsVente = [];
for (const m of FEUILLES_V.matchAll(/:root\s*\{([^}]*)\}/g)) {
  m[1].split(';').forEach((d) => {
    if (d.trim().startsWith('--')) jetonsVente.push(d.slice(0, d.indexOf(':')).trim());
  });
}
assert.deepStrictEqual(jetonsVente, [], 'l’écran de vente n’a plus de charte à lui');
assert.ok(!/--vd-/.test(VENTE), 'et plus une seule trace de l’ancienne palette');

// DEUX TAILLES SUR CET ÉCRAN, comme sur celui d'à côté : ce qui se lit, et les
// chiffres qu'on annonce. Le ticket a les siennes, et ne s'en sert que là.
const taillesVente = new Set();
const taillesTicket = new Set();
for (const m of FEUILLES_V.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
  const sel = m[1].trim();
  for (const d of m[2].matchAll(/font-size:\s*([^;}!]+)/g)) {
    const v = d[1].trim();
    if (/ticket/.test(sel)) { taillesTicket.add(v); continue; }
    assert.ok(/^var\(--taille-[\w-]+\)$/.test(v),
      `${sel.slice(0, 44)} → font-size:${v} : une taille doit venir de l’échelle`);
    taillesVente.add(v);
  }
}
assert.deepStrictEqual([...taillesVente].sort(), ['var(--taille-grand)', 'var(--taille-texte)'],
  'l’écran de vente n’a droit qu’à la taille du texte et à celle des chiffres qu’on annonce');
// Le ticket ne pioche PAS dans l'échelle de l'écran, et l'écran ne pioche pas
// dans la sienne : deux échelles qui se mélangent, c'est vingt-cinq tailles qui
// reviennent par la bande.
[...taillesTicket].forEach((v) => assert.ok(/^var\(--tk-[\w-]+\)$/.test(v),
  `le ticket compose dans SON échelle, pas dans « ${v} »`));
// … et elle est déclarée en UN endroit.
const echelleTicket = VENTE.match(/\.ticket\{\s*((?:\s*--tk-[\w-]+:[^;]+;\s*(?:\/\*[\s\S]*?\*\/)?)+)/);
assert.ok(echelleTicket, 'l’échelle du ticket est déclarée sur .ticket, en un seul bloc');
assert.strictEqual((VENTE.match(/--tk-texte\s*:/g) || []).length, 1,
  '… une seule fois : elle était réglée dans quatre blocs « V10.x » successifs');

// Le ticket ne suit PAS le thème : il montre le papier. On le vérifie plutôt
// que de le laisser au hasard d'un jeton oublié.
assert.ok(/\.ticket\{[^}]*background:#fff/.test(FEUILLES_V),
  'le ticket de la vente est une feuille blanche, en clair comme en sombre');
assert.ok(!/\.ticket\{[^}]*background:var\(--surface\)/.test(FEUILLES_V),
  '… il ne prend pas la surface du thème, sinon l’aperçu ne dit rien du papier');

// TROIS GRAISSES. Manrope s'arrête à 800 : la page en déclarait 900 et 950,
// rendus l'un comme l'autre EXACTEMENT comme un 800.
const graissesVente = [];
for (const m of FEUILLES_V.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
  if (/@font-face/.test(m[1])) continue;
  for (const d of m[2].matchAll(/font-weight:\s*([^;}!]+)/g)) {
    const v = d[1].trim();
    if (!/^var\(--graisse-(texte|note|forte)\)$/.test(v)) graissesVente.push(`${m[1].trim().slice(0, 40)} → ${v}`);
  }
}
assert.deepStrictEqual(graissesVente, [], 'une graisse écrite en dur sur l’écran de vente');
assert.ok(/b,strong\{font-weight:var\(--graisse-forte\)\}/.test(FEUILLES_V),
  'le gras par défaut du navigateur y est aussi ramené sur l’échelle');

// AUCUNE COULEUR EN DUR. Le voile d'une modale fait exception (du noir
// transparent), et l'impression aussi — elle est déjà retirée plus haut.
const teintesVente = [];
for (const m of FEUILLES_V.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
  const sel = m[1].trim();
  // LE TICKET GARDE LES SIENNES, comme sur l'écran de référence : c'est une
  // FEUILLE DE PAPIER. Ce qu'on montre est un aperçu de ce qui va sortir de
  // l'imprimante — il reste blanc à l'encre noire même en thème sombre, sinon
  // l'aperçu ne dit rien du papier.
  if (/ticket/.test(sel)) continue;
  if (/@font-face|@keyframes/.test(sel)) continue;
  for (const d of m[2].matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
    if (d[0].includes('var(')) continue;
    if (/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,/.test(d[0])) continue;
    teintesVente.push(`${sel.slice(0, 44)} → ${d[0]}`);
  }
}
assert.deepStrictEqual([...new Set(teintesVente)], [],
  'une couleur écrite en dur sur l’écran de vente : elle doit venir d’un jeton');

// UNE SEULE BOÎTE, la même que sur l'écran d'à côté.
const regleV = (selecteur) => {
  const out = {};
  for (const m of FEUILLES_V.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (m[1].replace(/\s+/g, '') !== selecteur.replace(/\s+/g, '')) continue;
    m[2].split(';').forEach((d) => {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).replace('!important', '').trim();
    });
  }
  return out;
};
const champV = regleV('input,select,textarea');
const boutonV = regleV('button');
assert.strictEqual(champV.padding.split(' ')[0], 'var(--champ-y)', 'un champ de la vente se remplit de la hauteur de l’échelle');
assert.strictEqual(boutonV.padding.split(' ')[0], 'var(--champ-y)', '… un bouton de la même');
assert.strictEqual(champV['border-radius'], 'var(--arrondi-champ)', 'et ils prennent l’arrondi des champs');
assert.strictEqual(boutonV['border-radius'], 'var(--arrondi-champ)', '… tous les deux');
// Chrome compose la valeur d'un champ de date dans une boîte interne qui porte
// SON rembourrage : le champ sortait 2 px plus haut que ses voisins.
[DEVIS, VENTE].forEach((src, i) => assert.ok(
  /input\[type=date\]::-webkit-datetime-edit,input\[type=time\]::-webkit-datetime-edit\{line-height:var\(--ligne-champ\)/.test(src),
  `${i ? 'la vente' : 'le devis'} : un champ de date fait la hauteur des autres`));

// ===========================================================================
// 10. LE THÈME DE L'HÔTE DESCEND DANS LE CADRE
// ---------------------------------------------------------------------------
// Les deux écrans du comptoir sont des documents à part, affichés dans un
// cadre du CRM. Ils lisent la charte, thème sombre compris — mais un cadre ne
// connaît pas le `data-theme` de son hôte : le poste basculait en sombre et
// gardait un rectangle blanc en plein milieu.
// ===========================================================================
[['devis', DEVIS], ['vente', VENTE]].forEach(([nom, src]) => {
  assert.ok(/URLSearchParams\(location\.search\)\.get\('theme'\)/.test(src),
    `${nom} : le thème d’ouverture arrive par l’adresse du cadre`);
  assert.ok(src.indexOf("get('theme')") < src.indexOf('charte.css'),
    `${nom} : … et il est posé AVANT la charte, donc avant le premier pixel`);
  assert.ok(/localStorage\.getItem\('olda_theme'\)/.test(src),
    `${nom} : ouvert seul, il retombe sur le choix mémorisé du poste`);
});

const PONT = fs.readFileSync(path.join(RACINE, 'public/comptoir/pont.js'), 'utf8');
assert.ok(/e\.data\.type === 'OLDA_THEME'/.test(PONT),
  'le pont écoute la bascule de l’hôte : l’interrupteur se clique aussi parcours ouvert');
// Le composant de menu posait un fond BLANC en dur : en thème sombre, le champ
// restait blanc au milieu d'un écran anthracite, et sa valeur — écrite à
// l'encre claire — devenait invisible.
assert.ok(!/background:#fff|color:#fff/.test(PONT),
  'le composant de menu ne peint plus en blanc en dur');
// Et une valeur choisie ne se lit pas comme un placeholder : les deux états
// pointaient sur le même jeton.
assert.ok(/\.menu-texte\{[^}]*color:var\(--text-1/.test(PONT),
  'une valeur choisie prend l’encre du texte');
assert.ok(/\.menu-texte\.est-vide\{color:var\(--text-2/.test(PONT),
  '… et un menu vide garde le gris des placeholders');

const NP = fs.readFileSync(path.join(RACINE, 'public/nouveau-projet.js'), 'utf8');
assert.ok(/\$\{f\.src\}\?theme=\$\{themeActuel\(\)\}/.test(NP),
  'l’hôte passe son thème dans l’adresse du parcours');
assert.ok(/postMessage\(\{ type: 'OLDA_THEME', theme \}/.test(NP),
  '… et prévient les cadres déjà ouverts');
assert.ok(/attributeFilter: \['data-theme'\]/.test(NP),
  '… en observant l’attribut, sans se mettre dans le chemin de l’interrupteur');
// La coquille range sous le CHEMIN : avec le thème dans l'adresse, deux copies
// du même fichier seraient entrées en cache, et aucune ne répondrait à l'autre
// thème le jour où le poste est hors ligne.
assert.ok(/c\.put\(url\.pathname, copie\)/.test(SW),
  'la coquille range un parcours sous son chemin, sans sa query');
assert.ok(/caches\.match\(req, \{ ignoreSearch: true \}\)/.test(SW),
  '… et le ressort quelle que soit la query');

// ===========================================================================
// 11. LE MODULE PDF EST CHEZ NOUS
// ---------------------------------------------------------------------------
// Il venait de cdnjs.cloudflare.com, avec jsdelivr et unpkg en secours : trois
// domaines tiers pour un écran qui doit s'ouvrir sans dépendre de personne — et
// aucune chance que « Télécharger le PDF » fonctionne hors ligne.
// ===========================================================================
assert.ok(!/(?:src|href)\s*=\s*["']https?:\/\//.test(DEVIS.replace(/<!--[\s\S]*?-->/g, '')),
  'plus une seule adresse d’un autre domaine dans l’écran de devis');
[/cdnjs\.cloudflare\.com/, /cdn\.jsdelivr\.net/, /unpkg\.com/].forEach((rx) =>
  assert.ok(!rx.test(DEVIS.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')),
    `${rx.source} ne sert plus rien à cet écran`));
assert.ok(fs.existsSync(path.join(RACINE, 'public/jspdf.umd.min.js')),
  'le module PDF est servi par nous');
assert.ok(/loadScriptOnce\(new URL\('\.\.\/jspdf\.umd\.min\.js',location\.href\)\.href\)/.test(DEVIS),
  '… et chargé depuis notre origine, au premier clic seulement');
assert.ok(!/<script[^>]+jspdf/.test(DEVIS),
  '… pas posé en balise : 364 Ko qu’on ne paie plus à chaque ouverture du comptoir');
assert.ok(/'\/jspdf\.umd\.min\.js'/.test(SW),
  '… et dans la coquille, sinon hors ligne le bouton ne peut par construction rien faire');
assert.ok(/'\/comptoir\/textile-catalog\.js'/.test(SW),
  'le catalogue textile aussi : sans lui, hors ligne, tout le chiffrage tombe sans un mot');

console.log('✓ charte du comptoir : les DEUX écrans, thème sombre compris, et plus rien qui vienne d’ailleurs');

// ===========================================================================
// 12. UNE RANGÉE RESTE UNE RANGÉE (23/08/2026)
// ---------------------------------------------------------------------------
// « Quand un input est vide et s'entoure en rouge pour validation il se décale
// et n'est plus centré avec les autres input. » Deux causes, et la plus grosse
// n'était pas celle qu'on voit.
// ===========================================================================
[['devis', DEVIS], ['vente', VENTE]].forEach(([nom, src]) => {
  const css = sansCommentaires(src);
  // 1. LE TRAIT NE CHANGE PLUS DE LARGEUR. De 1,5 à 2 px, le champ gagnait 1 px
  //    de haut : sur une rangée de trois, celui qui manque sortait du rang.
  const inval = css.match(/(?:input\.invalid,select\.invalid,textarea\.invalid|\.invalid)\{([^}]*)\}/);
  assert.ok(inval, `${nom} : la règle du champ en erreur doit rester repérable`);
  assert.ok(!/border(?:-width)?:\s*2px/.test(inval[1]),
    `${nom} : un champ en erreur ne change pas la largeur de son trait — il se décalerait de 1 px`);
  if (nom === 'devis') {
    // DEPUIS LE 24/08 (7 points du patron) : le champ fautif se SOULIGNE —
    // un trait intérieur de 2 px, là où l'œil descend chercher le message.
    // Toujours en ombre : elle ne prend pas de place, rien ne bouge.
    assert.ok(/box-shadow:inset 0 -2px 0 0 var\(--danger\)/.test(inval[1]),
      `${nom} : le champ fautif se souligne, d'un trait qui ne prend pas de place`);
  } else {
    assert.ok(/box-shadow:0 0 0 1px var\(--danger\)/.test(inval[1]),
      `${nom} : … l'épaisseur qu'on voit vient d'un anneau, qui ne prend pas de place`);
    assert.ok(/border-color:var\(--danger\)/.test(inval[1]),
      `${nom} : … et le trait dit l'erreur par sa couleur`);
  }

  // 2. LE MESSAGE NE REMONTE PLUS LE CHAMP. Les grilles collaient leurs
  //    cellules en bas : une ligne de texte ajoutée SOUS un champ le faisait
  //    remonter de 27 px au-dessus de ses voisins de rangée.
  assert.ok(/@supports \(grid-template-rows:subgrid\)\{/.test(css),
    `${nom} : les rangées partagent leurs lignes, pour que rien ne déplace une commande`);
  assert.ok(/>\.field\{display:grid;grid-template-rows:subgrid;grid-row:span 3/.test(css),
    `${nom} : … chaque cellule reprend les trois lignes de sa rangée`);
  assert.ok(/>\.field>\.error,[^{]*>\.field>\.help\{grid-row:3\}/.test(css.replace(/\n\s*/g, '')),
    `${nom} : … et les messages vivent sur la troisième, jamais dans la boîte du champ`);
  // Un champ qui porte tout un empilement (une date, ses raccourcis, son barème
  // ET une heure avec son propre intitulé) déborde des trois lignes : sa rangée
  // renonce au partage plutôt que de se démonter.
  assert.ok(/:has\(>\.field label~label\)\{grid-template-rows:none\}/.test(css),
    `${nom} : une rangée qui porte un champ à deux intitulés se range normalement`);
});

// ===========================================================================
// 13. CHAQUE GROUPE DE CHAMPS DANS SA BULLE
// ---------------------------------------------------------------------------
// Demande du patron : « je veux aussi que ce genre de bulle grise entoure bien
// chaque étape que tout soit bien lisible. » Une étape était un long ruban de
// champs mis bout à bout dans une carte blanche — rien ne disait où un sujet
// finissait et où le suivant commençait.
// ===========================================================================
// DEPUIS LE 24/08, LES DEUX ÉCRANS DIVERGENT ICI, et c'est un choix du patron
// (7 points) : sur l'écran de la demande, TROIS NIVEAUX et jamais plus — fond
// de page gris, carte blanche, champ blanc. La bulle grise du 23/08 faisait un
// quatrième niveau : chaque groupe devient une carte blanche de PREMIER niveau
// (liseré de carte, arrondi de carte), et le conteneur de l'étape s'efface.
// L'écran de vente, lui, garde la bulle du 23/08 — à réaligner quand le patron
// tranchera pour lui.
[['devis', DEVIS], ['vente', VENTE]].forEach(([nom, src]) => {
  const css = sansCommentaires(src);
  const regle = css.match(/\.bloc(?:,\.article-bloc)?\{([^}]*)\}/);
  assert.ok(regle, `${nom} : la bulle d'un groupe doit exister`);
  const attendu = nom === 'devis'
    ? ['background:var(--surface)', 'border-radius:var(--arrondi-carte)', 'border:1px solid var(--card-border)']
    : ['background:var(--zone-bg)', 'border-radius:var(--arrondi-bloc)'];
  attendu.forEach((d) =>
    assert.ok(regle[1].includes(d), `${nom} : le groupe porte « ${d} »`));
  if (nom === 'devis') {
    assert.ok(/#step2>\.card\{background:transparent;border:0;/.test(css),
      `${nom} : le conteneur de l'étape n'est plus une carte — pas d'arrondi dans un arrondi`);
  }
  assert.ok(/\.bloc>:first-child\{margin-top:0\}/.test(css) && /\.bloc>:last-child\{margin-bottom:0\}/.test(css),
    `${nom} : la bulle porte son rembourrage, ses bords n'ajoutent pas une deuxième marge`);
  // Elle n'ajoute AUCUN intitulé : c'est un cadre, pas un titre.
  assert.ok(!/<div class="bloc"><h[23]/.test(src.replace(/\n\s*/g, '')) || /<div class="bloc"><h3>Familles/.test(src),
    `${nom} : la bulle n'invente pas d'intitulé — seuls les titres qui existaient déjà y entrent`);
  assert.ok((src.match(/class="bloc"/g) || []).length >= 4,
    `${nom} : les groupes de champs sont bien tous emballés`);
});
// Sur l'écran de devis, chaque étape du parcours porte ses bulles.
['step2', 'step3', 'step4', 'step5'].forEach((etape) => {
  const m = DEVIS.match(new RegExp(`<section id="${etape}"[\\s\\S]*?</section>`));
  assert.ok(m && /class="bloc"/.test(m[0]), `l'étape ${etape} a au moins un groupe emballé`);
});
// Sur l'écran de vente, les groupes qui vivent dans un panneau à eux portent la
// bulle EUX-MÊMES — deux d'entre eux étaient des `.card` blanches posées dans
// une `.card` blanche, qui ne se voyaient qu'à leur trait.
['individualForm', 'professionalForm', 'cashZone', 'mixZone'].forEach((id) => {
  const m = VENTE.match(new RegExp(`<div id="${id}"[^>]*>`));
  assert.ok(m && /class="[^"]*\bbloc\b/.test(m[0]), `${id} porte la bulle`);
  assert.ok(m && !/class="[^"]*\bcard\b/.test(m[0]), `${id} n'est plus une carte blanche dans une carte blanche`);
});
// Une bulle posée dans un encadré repasse en blanc, et l'inverse : deux fonds
// gris l'un sur l'autre ne se distinguent pas.
[['devis', DEVIS], ['vente', VENTE]].forEach(([nom, src]) => {
  assert.ok(/\.notice \.bloc\{background:var\(--surface\)\}/.test(sansCommentaires(src).replace(/,\s*/g, ',').replace(/\.bloc \.notice,[^{]*/, '')) ||
            /\.notice \.bloc/.test(sansCommentaires(src)),
    `${nom} : une bulle dans un encadré ne se confond pas avec lui`);
});
// Le numéro qui titre une bulle prend l'air d'une rangée : posé seul, il
// collait son premier intitulé — « Besoin n°1 » et « Catégorie » se touchaient.
assert.ok(/\.bloc>\.form-num,\.article-bloc>\.form-num\{margin-bottom:var\(--pas-3\)\}/.test(DEVIS),
  'un numéro de bloc posé seul ne colle pas son premier intitulé');

console.log('✓ comptoir : une rangée reste une rangée, et chaque groupe de champs a sa bulle');
