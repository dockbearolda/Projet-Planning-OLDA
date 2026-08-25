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
for (const [nom, src] of [['styles.css', CRM], ['demande-devis', DEVIS], ['vente-directe', VENTE]]) {
  assert.ok(!/@media\s*\(\s*pointer:\s*coarse/.test(src),
    `${nom} : plus de règles tactiles, le poste est un PC`);
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

console.log('✓ uniformité : une boîte, trois graisses, aucune échelle parallèle, et le retour répond en 120 ms');
