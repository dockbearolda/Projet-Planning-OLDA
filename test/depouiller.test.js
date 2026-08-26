'use strict';

// LES COMMENTAIRES NE PARTENT PLUS SUR LE FIL (26/08/2026)
//
// 46 % du poids servi était de la prose française. On la retire au moment de
// SERVIR, la source intacte — 214 Ko de moins une fois compressé.
//
// C'est un changement qui ne pardonne pas : un `/*` mal lu à l'intérieur d'une
// chaîne, d'un gabarit ou d'une expression régulière mange du code jusqu'au
// prochain `*/`, et l'application s'ouvre sur un écran NU sans que rien ne
// prévienne (le 26/08 au matin, un seul accent grave dans un commentaire CSS a
// suffi ; `node --check` passait, les tests passaient).
//
// Ce fichier tient donc quatre promesses :
//   1. LE LECTEUR SAIT OÙ IL EST — chaînes, gabarits, expressions régulières.
//   2. LES NUMÉROS DE LIGNE NE BOUGENT PAS.
//   3. TOUT CE QUI EST SERVI SURVIT AU DÉPOUILLAGE — et se comporte pareil.
//   4. AU MOINDRE DOUTE, LA SOURCE PART TELLE QUELLE.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const { depouiller, depouillerJs, depouillerCss } = require('../depouiller.js');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const lignes = (s) => (s.match(/\n/g) || []).length;

// ---------------------------------------------------------------------------
// 1. LE LECTEUR SAIT OÙ IL EST
// ---------------------------------------------------------------------------
// Chaque cas ci-dessous a cassé un dépouilleur naïf au moins une fois.
const PIEGES = [
  // Un `/*` dans une chaîne n'ouvre RIEN.
  ["const a = '/* pas un commentaire */';", "const a = '/* pas un commentaire */';"],
  ['const b = "// pas un commentaire";', 'const b = "// pas un commentaire";'],
  // …ni dans un gabarit. C'est le cas de CSS_TICKET, plein de `/* … */`.
  ['const c = `a /* garde */ b`;', 'const c = `a /* garde */ b`;'],
  // …ni dans une expression régulière.
  ['const d = /\\/\\*/.test(x);', 'const d = /\\/\\*/.test(x);'],
  ['const e = /[/*]/g;', 'const e = /[/*]/g;'],
  // Une expression régulière après un mot-clé : `return /a/` n'est pas une division.
  ['function f() { return /a\\/b/.test(s); }', 'function f() { return /a\\/b/.test(s); }'],
  // Une VRAIE division ne doit pas être prise pour une expression régulière.
  ['const g = (a) / (b) / 2;', 'const g = (a) / (b) / 2;'],
  ['const h = tableau[0] / 2;', 'const h = tableau[0] / 2;'],
  // Le code DANS un gabarit se dépouille, le texte du gabarit non.
  ['const i = `x ${/* parti */ y} /* gardé */`;', 'const i = `x ${ y} /* gardé */`;'],
  // Un gabarit imbriqué dans une substitution.
  ['const j = `a ${`b ${c}`} d`; // parti', 'const j = `a ${`b ${c}`} d`; '],
  // Une apostrophe française dans un commentaire n'ouvre pas de chaîne.
  ["// l'atelier n'a pas d'écran\nconst k = 1;", '\nconst k = 1;'],
];

for (const [entree, attendu] of PIEGES) {
  assert.strictEqual(depouillerJs(entree), attendu,
    `dépouillage faux sur :\n${entree}\n→ ${depouillerJs(entree)}`);
}

// Le CSS : une seule forme de commentaire, mais des chaînes quand même.
assert.strictEqual(depouillerCss('.a { content: "/* gardé */"; }'), '.a { content: "/* gardé */"; }');
assert.strictEqual(depouillerCss('/* parti */\n.a { color: red; }'), '\n.a { color: red; }');

console.log('✓ dépouillage : chaînes, gabarits, expressions régulières et divisions OK');

// ---------------------------------------------------------------------------
// 2. LES NUMÉROS DE LIGNE NE BOUGENT PAS
// ---------------------------------------------------------------------------
// Sans ça, la première pile d'appels remontée d'un poste pointe la mauvaise
// ligne, et le gain de poids coûte plus cher qu'il ne rapporte.
const SERVIS = [];
for (const dossier of ['public', 'public/comptoir']) {
  for (const f of fs.readdirSync(path.join(RACINE, dossier))) {
    if (/\.(js|css)$/.test(f)) SERVIS.push(path.join(dossier, f));
  }
}
assert.ok(SERVIS.length >= 20, `on sert au moins vingt fichiers, vu ${SERVIS.length}`);

for (const f of SERVIS) {
  const src = lire(f);
  const out = depouiller(src, f.endsWith('.css') ? 'css' : 'js');
  assert.strictEqual(lignes(out), lignes(src), `${f} : les numéros de ligne ont bougé`);
}

console.log(`✓ dépouillage : ${SERVIS.length} fichiers servis, aucun numéro de ligne décalé`);

// ---------------------------------------------------------------------------
// 3. TOUT CE QUI EST SERVI SURVIT — et se comporte pareil
// ---------------------------------------------------------------------------
// a) Chaque module JS se relit toujours. Un `/*` mal lu casserait la syntaxe.
let repliés = [];
for (const f of SERVIS.filter((x) => x.endsWith('.js'))) {
  const src = lire(f);
  const out = depouiller(src, 'js');
  if (out === src) { repliés.push(f); continue; }
  // On charge le module dépouillé comme le fait le navigateur (les tests du
  // dépôt neutralisent `export` de la même façon).
  const nu = out.replace(/^export\s+/gm, '').replace(/^import[\s\S]*?from\s+'[^']*';$/gm, '');
  assert.doesNotThrow(() => new vm.Script(nu, { filename: f }),
    `${f} ne se relit plus une fois dépouillé`);
}
// Aucun fichier ne doit tomber dans le filet : s'il y en a un, c'est que le
// lecteur bute sur quelque chose et il faut savoir LEQUEL.
assert.deepStrictEqual(repliés, [], `dépouillage abandonné sur : ${repliés.join(', ')}`);

// b) LE COMPORTEMENT EST IDENTIQUE. `ticket.js` est le pire cas du dépôt : un
//    gabarit de 9 000 caractères bourré de `/* … */`, et des expressions
//    régulières juste à côté. On l'évalue deux fois et on compare.
const charger = (code) => {
  const bac = {};
  vm.createContext(bac);
  vm.runInContext(
    `${code.replace(/^export\s+/gm, '')}
     globalThis.M = modeleTicket; globalThis.T = ticketTexte; globalThis.C = CSS_TICKET;`,
    bac,
  );
  return bac;
};
const avant = charger(lire('public/ticket.js'));
const apres = charger(depouiller(lire('public/ticket.js'), 'js'));

const DOSSIER = {
  billing_company: 'Beach Bar', contact_referent: 'Yann', contact_phone: '0690 55 12 40',
  product: 'T-shirt', quantity: 24, order_kind: 'commande',
  fiche: {
    kind: 'comptoir-v17', source: 'Vente directe', ref: '26.08.26-011',
    creeLe: '2026-08-26T14:00:00.000Z',
    prod: {
      ref: 'K3025', couleur: 'Noir', marquage: 'DTF', encre: 'Blanc',
      tailles: [{ t: 'S', n: 6 }, { t: 'M', n: 10 }],
      logos: [{ face: 'Coeur', mm: '90' }],
    },
  },
};
assert.strictEqual(apres.T(apres.M(DOSSIER)), avant.T(avant.M(DOSSIER)),
  'le ticket dépouillé ne sort plus le même papier');

// LE TEXTE D'UN GABARIT NE SE TOUCHE PAS, et `CSS_TICKET` le prouve : neuf
// mille caractères bourrés de `/* … */`, qui ressortent au caractère près. Un
// dépouilleur à expression régulière les mangeait — c'est exactement la porte
// par où l'écran nu est entré. On y perd les commentaires de cette feuille-là
// (9 Ko sur 214) ; on y gagne de ne jamais amputer une chaîne.
assert.strictEqual(apres.C, avant.C, 'le texte d’un gabarit doit ressortir intact');

console.log('✓ dépouillage : tous les modules se relisent, le ticket sort le même papier');

// ---------------------------------------------------------------------------
// 4. AU MOINDRE DOUTE, LA SOURCE PART TELLE QUELLE
// ---------------------------------------------------------------------------
// Un fichier qu'on ne sait pas lire ne doit pas sortir amputé.
assert.strictEqual(depouiller('const a = `non terminé /* ', 'js').startsWith('const a = `'), true);
assert.strictEqual(depouiller('', 'js'), '');

// ---------------------------------------------------------------------------
// 5. LE GAIN EST RÉEL — sinon tout ceci ne vaut pas son risque
// ---------------------------------------------------------------------------
const gz = (s) => zlib.gzipSync(Buffer.from(s), { level: 6 }).length;
let avantKo = 0; let apresKo = 0;
for (const f of SERVIS) {
  const src = lire(f);
  avantKo += gz(src);
  apresKo += gz(depouiller(src, f.endsWith('.css') ? 'css' : 'js'));
}
const gain = Math.round((avantKo - apresKo) / 1024);
assert.ok(gain > 150, `le gain doit dépasser 150 Ko compressés, mesuré ${gain} Ko`);

console.log(`✓ dépouillage : ${Math.round(avantKo / 1024)} → ${Math.round(apresKo / 1024)} Ko gzip (${gain} Ko de moins sur le fil)`);
