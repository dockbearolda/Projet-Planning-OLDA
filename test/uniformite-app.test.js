'use strict';

// UNIFORMITÉ DE TOUTE L'APPLICATION (25/08/2026)
//
// Ce fichier est né d'un audit : neuf écrans mesurés dans le navigateur, un
// composant à la fois, puis comparés ENTRE EUX. C'est ce dernier mot qui
// compte — chaque écran avait déjà été vérifié isolément, et rien n'était
// sorti. Ce qu'on avait trouvé en les comparant :
//
//   · TROIS hauteurs pour un champ de saisie — 40 px au CRM, 50 sur l'écran de
//     la demande, 52,4 sur la vente. Et le CRM n'était pas d'accord avec
//     lui-même : son champ faisait 40 et son bouton 44, si bien que sur une
//     rangée où les deux se côtoient, l'un dépassait l'autre.
//   · QUATRE traitements de carte (arrondis 12 / 14 / 16, rembourrages
//     12-14 / 20 / 24), dont deux à l'intérieur du seul CRM.
//   · 98 graisses hors des trois de la charte — 500 (48 fois) et 700 (50) —
//     alors que les deux parcours du comptoir n'en écrivaient aucune en dur.
//   · SEPT textes en 16 px, une taille qui n'existe pas dans l'échelle.
//   · SEPT blocs `@media (pointer: coarse)` entretenant une seconde échelle de
//     tailles, sur un projet PC uniquement depuis le 21/08.
//
// Rien de tout ça ne s'était vu au fil de l'eau : chaque valeur, prise seule,
// paraissait raisonnable. C'est l'écart ENTRE écrans qui se lit, et c'est donc
// lui qu'on tient ici.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const sansCommentaires = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const CHARTE = lire('public/charte.css');
const CRM = lire('public/styles.css');
const DEVIS = lire('public/comptoir/demande-devis.html');
const VENTE = lire('public/comptoir/vente-directe.html');

// Les règles d'une page : ses blocs <style>, sans les commentaires, sans le
// papier (un ticket a sa propre échelle, il s'imprime).
function reglesDePage(src) {
  let css = sansCommentaires([...src.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'));
  let out = '', i = 0;
  while (true) {
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

// ===========================================================================
// 1. UNE SEULE BOÎTE, ET ELLE SE NOMME
// ===========================================================================
const boite = CHARTE.match(/--ctrl-h:\s*(\d+)px/);
assert.ok(boite, '`--ctrl-h` doit être déclarée dans la charte : c’est LA boîte');
assert.ok(Number(boite[1]) >= 44,
  `--ctrl-h = ${boite[1]}px : sous 44, la commande redevient petite sur le 15,4 pouces du poste`);

// Le comptoir ne garde pas une boîte à lui : son jeton POINTE sur celle-ci.
assert.ok(/--dd-champ-h:\s*var\(--ctrl-h\)/.test(CHARTE),
  'la boîte du comptoir doit pointer sur celle de l’application, pas la redire');

// Et le CRM la lit, au lieu d'écrire ses propres hauteurs.
const parJeton = (CRM.match(/min-height:\s*var\(--ctrl-h\)/g) || []).length;
assert.ok(parJeton >= 15,
  `seulement ${parJeton} commandes du CRM prennent la boîte nommée — il y en avait 21 le 25/08`);

// ===========================================================================
// 2. LE TACTILE NE REVIENT PAS
// ---------------------------------------------------------------------------
// Les Galaxy Tab sont au rebut depuis le 21/08 et le projet est PC uniquement
// (CLAUDE.md). Les sept blocs tactiles ne servaient plus personne — mais
// surtout, leurs cibles de 44 px tenaient une DEUXIÈME échelle de tailles à
// côté de celle de la charte, et c'est ça qui coûtait cher.
// ===========================================================================
// Onze au total : sept dans styles.css le matin, trois dans clients.css
// l'après-midi, et un dernier `@media (hover: none)` — le seul qui interrogeait
// le SURVOL et pas le pointeur, ce qui lui avait valu de passer entre les
// mailles. On lit le CODE, pas les commentaires : ceux-ci racontent ce qui a
// été retiré, et la garde se déclenchait sur leur propre récit.
const sansCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
for (const [nom, src] of [['styles.css', CRM], ['clients.css', lire('public/clients.css')],
  ['projet.css', lire('public/projet.css')], ['demande-devis', DEVIS], ['vente-directe', VENTE]]) {
  const code = sansCom(src);
  assert.ok(!/@media\s*\(\s*pointer:\s*coarse/.test(code),
    `${nom} : plus de règles tactiles, le poste est un PC`);
  assert.ok(!/@media\s*\(\s*hover:\s*none/.test(code),
    `${nom} : plus de règles « sans survol », tout poste a une souris`);
}

// ===========================================================================
// 3. TROIS GRAISSES, ET AUCUNE ÉCRITE EN DUR
// ---------------------------------------------------------------------------
// Manrope s'arrête à 800 : au-delà, le navigateur rabote et rend du 800 — une
// marche qui ne se voit pas. En dessous, 500 et 700 ne se distinguaient pas
// assez de 400 et 600 pour valoir une quatrième et une cinquième valeur.
// ===========================================================================
{
  const css = sansCommentaires(CRM);
  const enDur = [];
  for (const [sel, corps] of [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => [m[1], m[2]])) {
    if (/@font-face/.test(sel)) continue;   // « 200 800 » y est la PLAGE du fichier
    for (const m of corps.matchAll(/font-weight:\s*(\d+)/g)) enDur.push(`${sel.trim().slice(0, 34)} → ${m[1]}`);
  }
  assert.deepStrictEqual(enDur, [],
    'une graisse écrite en dur dans le CRM : les trois jetons de la charte suffisent');
}

// ===========================================================================
// 4. LES TROIS SURFACES DISENT LA MÊME CHOSE
// ---------------------------------------------------------------------------
// Le vrai garde-fou de cet audit : ce n'est pas qu'un écran soit propre, c'est
// que les trois soient d'accord. Aucune page ne redéclare un jeton de forme,
// de taille ou de boîte — sinon elle repart, seule, dans sa direction.
// ===========================================================================
for (const [nom, src] of [['demande-devis', DEVIS], ['vente-directe', VENTE]]) {
  const regles = reglesDePage(src);
  const redits = [];
  for (const m of regles.matchAll(/:root\s*\{([^}]*)\}/g)) {
    m[1].split(';').forEach((d) => { if (d.trim().startsWith('--')) redits.push(d.split(':')[0].trim()); });
  }
  assert.deepStrictEqual(redits, [],
    `${nom} : la page ne redéclare aucun jeton — ils vivent tous dans la charte`);
}

// L'arrondi d'un champ et celui d'une carte n'existent qu'À UN endroit : le
// comptoir avait le sien (10 px contre 9), un pixel d'écart entre deux écrans
// ouverts à un clic l'un de l'autre.
assert.ok(!/--arrondi-champ:\s*\d+px/.test(CHARTE.split('.ecran-comptoir')[1] || ''),
  'l’écran du comptoir ne garde pas un arrondi de champ à lui');
assert.ok(/--arrondi-bloc:\s*var\(--arrondi-carte\)/.test(CHARTE),
  'un bloc interne prend la forme d’une carte, il n’en invente pas une');

// ===========================================================================
// 5. LA DURÉE DIT LE GENRE DE CHANGEMENT
// ---------------------------------------------------------------------------
// Quatorze règles faisaient répondre un SURVOL en 200 ms — la durée d'un
// panneau qui s'ouvre. Le poste paraissait mou alors que rien n'était lent :
// une vue se peint en 3 à 9 ms, mesuré au navigateur. Ce qui traînait, c'était
// l'accusé de réception.
//   --dur-1 : ce qui RÉPOND (fond, trait, couleur, ombre)
//   --dur-2 : ce qui ENTRE ou SORT (transform, opacity)
// ===========================================================================
{
  const RETOUR = new Set(['background', 'background-color', 'border-color', 'color', 'box-shadow', 'filter']);
  const lents = [];
  for (const m of sansCommentaires(CRM).matchAll(/transition:([^;}]*)/g)) {
    for (const seg of m[1].split(',')) {
      const prop = seg.trim().split(/\s+/)[0];
      if (RETOUR.has(prop) && /var\(--dur-2/.test(seg)) lents.push(seg.trim().slice(0, 46));
    }
  }
  assert.deepStrictEqual(lents, [],
    'un retour de survol ou de focus en 200 ms : il doit répondre en --dur-1');
}

// ===========================================================================
// 6. TROIS BOUTONS RESTENT ATTEIGNABLES AU CLAVIER
// ---------------------------------------------------------------------------
// « dupliquer », « supprimer » et « envoyer vers Fiverr » ne se montrent qu'au
// survol de leur ligne. Le bloc tactile les forçait visibles au doigt ; il est
// parti. Il ne reste donc QU'UNE autre porte, et « supprimer » est derrière.
// ===========================================================================
assert.match(CRM,
  /\.send-btn:focus-visible,\s*\.del-btn:focus-visible,\s*\.dup-btn:focus-visible \{[^}]*opacity:\s*1[^}]*pointer-events:\s*auto/,
  'le clavier révèle ces trois boutons ET les rend cliquables');

// ===========================================================================
// 7. LE GRIS ATTÉNUÉ NE PORTE PLUS DE TEXTE QU'ON LIT
// ---------------------------------------------------------------------------
// La charte définit son troisième gris comme « atténué — repères, pas du texte
// à lire ». 54 règles s'en servaient pourtant comme couleur de texte : 2,54:1
// sur le blanc d'une carte, là où un texte courant en demande 4,5.
// ON NE L'ASSOMBRIT PAS : la valeur qui passerait le seuil sur les trois fonds
// où la charte le pose vaut #656c7a, et le deuxième gris vaut #5f6774 — les
// deux se confondent. Un troisième cran ne peut pas être à la fois lisible et
// discret ; c'est arithmétique. Il reste donc là où l'effacement EST le
// message, et nulle part ailleurs.
// ===========================================================================
const CLIENTS_CSS = lire('public/clients.css');

assert.match(CRM, /--pj-ink-4:\s*var\(--text-2\)/,
  'la quatrième encre du Point du jour porte du texte : elle se lit');
assert.match(CRM, /--pj-muet:\s*var\(--text-3\)/,
  '… et le gris atténué garde son propre nom, pour les endroits où il est assumé');

// L'état zéro était la SEULE exception assumée : un compteur à zéro s'éteignait
// en gris atténué, c'était le message.
//
// Ces compteurs n'existent PLUS : le patron a retiré de l'écran, le 25/08, tout
// ce qui n'était pas le travail lui-même — les quatre alarmes, la jauge de
// charge, le briefing, la recherche. L'exception disparaît donc avec eux, mais
// la DOCTRINE ne bouge pas : le gris atténué garde ses emplois, ceux où
// l'effacement EST le message, et rien d'autre.
assert.ok(!/\.pj-stat\b|\.pj-al\b/.test(CRM.replace(/\/\*[\s\S]*?\*\//g, ' ')),
  'les compteurs du Point du jour ont été retirés de l’écran');
for (const sel of ['.pj-col-load-fill', '.dd-pos-sep']) {
  // TOUTES les règles qui portent ce sélecteur, pas la première : un sélecteur
  // apparaît souvent d'abord dans un groupe (`.a, .b { … }`) qui pose la forme,
  // puis seul pour sa couleur. Ne regarder que la première déclare un manque
  // qui n'existe pas.
  const motif = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{]*\\{[^}]*\\}', 'g');
  const regles = CRM.match(motif) || [];
  assert.ok(regles.some((r) => /var\(--pj-muet\)/.test(r)),
    `${sel} : le gris atténué reste là où l’effacement est le message`);
}

// Les règles que l'audit avait nommées une à une.
for (const [fichier, src, sel] of [
  ['styles.css', CRM, '.cell-price-ht'], ['styles.css', CRM, '.reg-count'],
  ['styles.css', CRM, '.menu-item.muted'], ['styles.css', CRM, '.colbar-empty'],
  ['clients.css', CLIENTS_CSS, '.cl-f__label'], ['clients.css', CLIENTS_CSS, '.cl-note__time'],
  ['clients.css', CLIENTS_CSS, '.cl-card__time'],
]) {
  const bloc = new RegExp(`${sel.replace(/[.]/g, '\\.')}[^{}]*\\{[^}]*\\}`);
  const m = src.match(bloc);
  assert.ok(m && !/var\(--text-3\)/.test(m[0]),
    `${fichier} ${sel} ne porte plus le gris atténué`);
}

// Une étape à venir dit où l'on va : c'est de la navigation, pas du décor.
assert.ok(/\.step \{[^}]*color: var\(--text-2\)/.test(CHARTE),
  'une étape non franchie du parcours se lit');
// Le seul état de la charte qui échouait (4,39:1 sur son propre fond).
assert.match(CHARTE, /--st-archive: #676e7b/,
  'la teinte « archive » passe le seuil sur son fond');
// Une action qu'on ne peut pas encore faire dit quand même ce qu'elle fera.
assert.ok(!/button:disabled[^}]*color:var\(--surface\)/.test(DEVIS),
  'un bouton désactivé ne porte plus du blanc sur un gris pâle');

// ===========================================================================
// 8. AUCUN ÉCOUTEUR NE FIGE UNE FONCTION QUE LA PAGE REDÉFINIT ENSUITE
// ---------------------------------------------------------------------------
// LA GARDE LA PLUS CHÈRE DE CE FICHIER. `addEventListener(evt, uneFonction)`
// capture l'OBJET fonction tel qu'il est à l'inscription. Les deux écrans du
// comptoir sont corrigés par des greffes qui redéfinissent `window.X` plus bas
// dans la page : un `onclick` du balisage les voit (il résout au moment du
// clic), un écouteur inscrit avec une référence nue ne les voit JAMAIS.
// Quatre boutons de la fiche client étaient dans ce cas. Conséquence
// reproduite en base le 25/08 : « Modifier les informations » d'un client,
// « Annuler », puis « + Créer un nouveau client » — le drapeau d'édition
// restait armé, et l'enregistrement ÉCRASAIT la fiche du premier. Une fiche
// détruite, un client jamais créé, le code CLI-… passé au mauvais nom.
// ===========================================================================
for (const [nom, src] of [['demande-devis', DEVIS], ['vente-directe', VENTE]]) {
  const redefinies = new Set(
    [...src.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=\s*function/g)].map((m) => m[1]),
  );
  const figees = [...src.matchAll(
    /addEventListener\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_$][\w$]*)\s*[,)]/g,
  )].filter((m) => redefinies.has(m[2])).map((m) => `${m[1]} → ${m[2]}`);
  assert.deepStrictEqual(figees, [],
    `${nom} : un écouteur fige une fonction que la page redéfinit plus bas`);
}

// ===========================================================================
// 9. UN INDEX D'ÉDITION EST UN INDEX DANS LA LISTE : IL SUIT LA SUPPRESSION
// ---------------------------------------------------------------------------
// `deleteNeed` réindexait soigneusement la mémoire d'AFFICHAGE — son
// commentaire le dit — mais pas `editingNeed`, le seul index qui ÉCRIT.
// Modifier CCC, supprimer AAA, enregistrer : DDD écrasé, CCC inchangé, aucun
// message. Même oubli sur la vente (`editIndex`).
// ===========================================================================
assert.match(DEVIS, /function deleteNeed\([^)]*\)\{[\s\S]{0,400}?suivreSuppressionEdition\(i\)/,
  'supprimer un besoin fait suivre l’index d’édition');
assert.match(DEVIS, /function suivreSuppressionEdition[\s\S]{0,600}?editingTextile/,
  '… les DEUX index, le manuel et le textile');
assert.match(VENTE, /function deleteProduct\([\s\S]{0,700}?editIndex!==null && editIndex>index\) editIndex--/,
  'supprimer un article fait suivre l’index d’édition de la vente');

// ===========================================================================
// 10. CE QUI N'AVAIT AUCUN CHEMIN CLAVIER EN A UN
// ---------------------------------------------------------------------------
// Le poste est un PC : clavier et souris. Quatre actions n'étaient pas
// « pénibles » au clavier — elles étaient IMPOSSIBLES.
// ===========================================================================
const APP = lire('public/app.js');

// Attacher un PDF : un <label> n'est jamais dans l'ordre de tabulation, et le
// <input type="file"> qu'il contient en est sorti par `hidden`.
assert.match(APP, /lbl\.tabIndex = 0;[\s\S]{0,200}?lbl\.setAttribute\('role', 'button'\)/,
  'le trombone est atteignable au clavier');
assert.match(APP, /lbl\.addEventListener\('keydown'[\s\S]{0,220}?input\.click\(\)/,
  '… et Entrée/Espace y ouvrent le sélecteur de fichier');

// Retirer un PDF : `display: none` le sortait de la tabulation ET de l'arbre
// d'accessibilité. C'était la seule porte de l'écran pour détacher un fichier.
assert.ok(!/\.pdf-slot:hover \.pdf-btn__remove \{ display: inline-flex; \}/.test(CRM),
  'la croix de retrait n’est plus révélée par le seul display');
assert.match(CRM,
  /\.pdf-slot:hover \.pdf-btn__remove,\s*\.pdf-slot:focus-within \.pdf-btn__remove,\s*\.pdf-btn__remove:focus-visible \{[^}]*opacity: 1[^}]*pointer-events: auto/,
  '… le focus la montre et la rend cliquable');

// Ouvrir un article : c'était le dernier <div onclick> du dépôt.
assert.match(DEVIS, /<button type="button" class="need-titre" aria-expanded="\$\{i===articleOuvert\}"/,
  'le titre d’une ligne de la demande est un vrai bouton');

// Les fenêtres modales emmènent le focus avec elles, et le rendent en partant.
const MODALE = lire('public/modale.js');
assert.match(MODALE, /export function armerModale/, 'le piège à focus est un composant partagé');
assert.match(MODALE, /focusAvant\.focus\(\{ preventScroll: true \}\)/,
  '… il REND le focus à la fermeture');
for (const [nom, chemin] of [['clients.js', 'public/clients.js'], ['dashboard.js', 'public/dashboard.js']]) {
  assert.match(lire(chemin), /import \{ armerModale \} from '\.\/modale\.js'/,
    `${nom} se sert du composant partagé plutôt que d’en recopier un`);
}
assert.match(DEVIS, /<div class="ticket-export-dialog" role="dialog" aria-modal="true"/,
  'la fenêtre d’export du comptoir se déclare enfin modale');
assert.match(DEVIS, /window\.oldaArmerModale\(carte,/,
  '… et elle emmène le focus, par la passerelle vers le module du CRM');
// Un fichier importé qui manque à la coquille, c'est un écran mort hors ligne.
assert.match(lire('public/sw.js'), /'\/modale\.js'/,
  'modale.js est dans la coquille hors ligne');

// ===========================================================================
// 11. UNE ÉTIQUETTE EST RELIÉE À SON CHAMP
// ---------------------------------------------------------------------------
// 63 des 68 étiquettes de l'écran de la demande ne visaient AUCUN champ.
// Conséquence à la souris autant qu'au clavier : cliquer sur « Taille M » ne
// plaçait pas le curseur dans la case. Celles qui ne coiffent pas une case mais
// un ENSEMBLE (les six tailles, les trois priorités) nomment leur groupe par
// `aria-labelledby` — le `for=` n'y aurait rien à viser.
// ===========================================================================
for (const [nom, src] of [['demande-devis', DEVIS], ['vente-directe', VENTE]]) {
  const etiquettes = [...src.matchAll(/<label(\s[^>]*)?>([\s\S]*?)<\/label>/g)];
  const orphelines = etiquettes.filter((m) => {
    if (/\sfor=/.test(m[1] || '')) return false;               // reliée
    if (/<(input|select|textarea)\b/.test(m[2])) return false;  // elle enveloppe son champ
    if (/\sid="/.test(m[1] || '')) return false;                // elle nomme un groupe
    return true;
  }).map((m) => m[2].replace(/<[^>]*>/g, '').trim().slice(0, 30));
  assert.deepStrictEqual(orphelines, [],
    `${nom} : une étiquette ne vise ni un champ, ni un groupe`);
}
// Les deux groupes nommés, et le champ dont le nom vivait dans un titre.
assert.match(DEVIS, /<div class="tx-sizes" role="group" aria-labelledby="txSizesLabel">/,
  'les six tailles forment un groupe nommé');
assert.match(DEVIS, /id="projectPriorityGroup" role="group" aria-labelledby="projectPriorityLabel"/,
  'les trois priorités aussi');
assert.match(VENTE, /<textarea id="internalNote" aria-labelledby="internalNoteTitle"/,
  'la note interne porte le nom de son bloc');

// ===========================================================================
// 12. LE RAIL PARLE LA LANGUE DE L'APPLICATION
// ---------------------------------------------------------------------------
// Il avait CINQ tailles à lui (13, 14, 15, 16, 17) dont trois hors de
// l'échelle, et sa propre police — trois caractères se rendaient donc sur le
// planning, dans la colonne la plus lue de l'écran. Mesuré avant de trancher :
// à 320 px de rail, la police de la maison replie exactement les MÊMES quatre
// libellés et le plus large mesure 239 px contre 240.
// ===========================================================================
// (Le CODE, pas les commentaires : celui de la charte NOMME les jetons retirés
//  pour dire pourquoi ils sont partis — la garde se déclenchait dessus.)
const CHARTE_CODE = sansCom(CHARTE);
assert.ok(!/--rail-taille-titre|--rail-taille-forte|--rail-muet/.test(CHARTE_CODE),
  'les jetons du rail devenus inutiles avec l’en-tête ne traînent plus');
for (const jeton of ['--rail-taille-note', '--rail-taille-etape', '--rail-taille-compte']) {
  const m = CHARTE.match(new RegExp(`${jeton}:\\s*([^;]+);`));
  assert.ok(m && /var\(--taille-(note|texte)\)/.test(m[1]),
    `${jeton} vient de l’échelle de la charte, il n’a plus de valeur à lui`);
}
assert.ok(!/font-family:\s*'Plus Jakarta Sans'/.test(sansCom(CRM)),
  'une seule police : le rail écrit comme le reste');
assert.ok(!fs.existsSync(path.join(__dirname, '..', 'public/plus-jakarta-sans-latin-variable.woff2')),
  '… et le fichier de la seconde police ne dort plus dans public/');
// Chrome impose Arial aux champs et aux boutons : sans cette règle, « Colonnes »
// — le seul bouton d'icône à porter un mot — sortait en Arial 17 px.
assert.match(CRM, /button, input, select, textarea \{ font-family: inherit; \}/,
  'les contrôles héritent de la police du corps');

// ===========================================================================
// 13. UN JETON, UNE VALEUR
// ---------------------------------------------------------------------------
// « Bloc dans une carte » valait 12 px au socle et 16 sur l'écran de référence
// du comptoir : le même objet, deux formes selon l'écran où on le regardait.
// ===========================================================================
assert.match(CHARTE, /--arrondi-bloc: var\(--arrondi-carte\)/,
  'un bloc dans une carte EST une carte, partout');
assert.strictEqual((CHARTE.match(/^\s*--arrondi-bloc:/gm) || []).length, 1,
  'et il n’est déclaré qu’UNE fois dans toute la charte');

// ===========================================================================
// 14. LE CODE MORT NE REVIENT PAS
// ---------------------------------------------------------------------------
// Vingt-et-une classes sans aucun porteur, dont quinze formaient l'ANCIEN
// tiroir de fiche, remplacé mais jamais retiré de la feuille.
// La sonde qui les a trouvées s'est trompée deux fois avant d'être juste : elle
// avait d'abord donné `c-due`, `c-pos`, `c-why` pour mortes, alors qu'elles
// sont fabriquées par `'pj-row-head-c c-' + c.k` — un préfixe en FIN de chaîne
// concaténée. Chacune des vingt-et-une a ensuite été vérifiée au rendu, la
// fiche de ligne OUVERTE : elle en porte 35, aucune de cette liste.
// ===========================================================================
for (const morte of ['ld-input', 'ld-section', 'ld-value', 'ld-notes', 'ld-reason',
  'ld-stage-chip', 'ld-resp-chip', 'ld-detail-save', 'ld-head__badges',
  'cell-display', 'empty-field', 'density-compact', 'btn-primary-label', 'reg-tarif-params']) {
  assert.ok(!new RegExp(`\\.${morte.replace(/[-]/g, '[-]')}\\b`).test(sansCom(CRM)),
    `.${morte} n’a aucun porteur : sa règle ne revient pas dans la feuille`);
}

// ===========================================================================
// 15. LES DEUX ÉCRANS DU COMPTOIR SONT LE MÊME ÉCRAN
// ---------------------------------------------------------------------------
// La divergence du 24/08 tenait à UNE CLASSE MANQUANTE, pas à une règle
// oubliée : `.ecran-comptoir` est la couche de jetons de l'écran de référence
// (palette, échelle, boîte unique) et la vente ne l'avait jamais portée. Douze
// couleurs y différaient d'un demi-ton — l'encre, les quatre traits, le fond de
// page, le rouge de validation.
// Et « TROIS NIVEAUX, JAMAIS PLUS » : la vente était restée sur la bulle GRISE
// du 23/08, abandonnée dès le lendemain sur l'écran de la demande parce qu'elle
// faisait un quatrième niveau — bulle grise arrondie dans une carte blanche
// arrondie, elle-même sur le fond gris de la page.
// Mesuré au rendu, les deux écrans côte à côte : la signature du groupe de
// champs est identique au caractère près.
// ===========================================================================
assert.match(VENTE, /<body class="ecran-comptoir">/,
  'la vente porte la couche de jetons de l’écran de référence');
assert.match(DEVIS, /<body class="ecran-comptoir">/,
  '… la demande aussi, évidemment');
for (const [nom, src] of [['demande-devis', DEVIS], ['vente-directe', VENTE]]) {
  const m = sansCom(src).match(/(^|[\n;}])\.(bloc|article-bloc)[^{}\n]*\{([^}]*)\}/);
  assert.ok(m, `${nom} : le groupe de champs a bien une règle`);
  assert.match(m[3], /background:var\(--surface\)/,
    `${nom} : un groupe de champs est une carte BLANCHE, pas une bulle grise`);
  assert.match(m[3], /border:1px solid var\(--card-border\)/,
    `${nom} : … avec le trait d’une carte`);
  assert.match(m[3], /padding:var\(--pas-4\)/,
    `${nom} : … et le rembourrage d’une carte`);
}
// La carte qui ne porte QUE des groupes redevient un empilement, sinon on
// retrouve un arrondi dans un arrondi.
assert.match(DEVIS, /#step2>\.card\{background:transparent;border:0/,
  'la demande aplatit la carte qui contient ses groupes');
assert.match(VENTE, /\.card:has\(> \.bloc\)\{background:transparent;border:0/,
  'la vente aussi');
assert.ok(!/(^|[\n;}])\.card\{[^}]*!important/.test(sansCom(VENTE)),
  '… et aucun `.card` en !important ne vient la lui rendre de force');

console.log('✓ uniformité : une boîte, trois graisses, le gris qui se lit, et tout atteignable au clavier');
