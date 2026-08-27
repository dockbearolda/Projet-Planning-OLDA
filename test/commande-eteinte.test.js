'use strict';

// ===========================================================================
// UNE COMMANDE ÉTEINTE DIT QUAND MÊME CE QU'ELLE FERA (27/08/2026)
// ===========================================================================
// Six règles éteignaient une commande à l'`opacity`, de .45 à .75. C'est une
// impasse arithmétique : l'opacité rapproche l'encre DU FOND, donc elle efface
// le libellé exactement au moment où l'on cherche ce qu'il faut faire. Mesuré
// au rendu, en thème clair : « Enregistrer » 2,67:1, « Annuler » 2,67:1,
// « Appeler / Écrire » d'une fiche client 2,2:1, et « + référent » 1,85:1 —
// celui-là soixante-deux fois sur le seul planning.
//
// Le comptoir avait déjà tranché pour son propre bouton le 25/08 (--dd-inactif).
// La charte porte maintenant la paire pour toute l'application, et le comptoir
// pointe dessus : les deux moitiés éteignent de la même façon.
//
// Ce fichier tient les trois bouts : le vérificateur refuse le retour de
// l'opacité, la paire de jetons se lit dans les DEUX thèmes, et les libellés
// qui disent une action ne repassent pas sur l'encre atténuée.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RACINE = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8');

// --- 1. Plus une seule commande éteinte à l'opacité ------------------------
const res = spawnSync(process.execPath, ['outils/verifier-charte.mjs', 'public'],
  { cwd: RACINE, encoding: 'utf8' });
const ESC = String.fromCharCode(27);
const rapport = res.stdout.split(new RegExp(`${ESC}\\[[0-9;]*m`)).join('');
const eteintes = rapport.split('\n').filter((l) => /commande éteinte à l’opacité/.test(l));
assert.deepStrictEqual(eteintes, [],
  `une commande s'éteint encore à l'opacité :\n${eteintes.join('\n')}`);

// --- 2. La paire de jetons se lit, de jour comme de nuit -------------------
// Le contraste est une propriété des JETONS, pas du DOM : on le calcule depuis
// la source. Mesuré au navigateur, il dépend de l'instant où l'on regarde —
// une animation d'entrée en cours rend « opacity: 0 » et fausse tout.
const charte = lire('public/charte.css');

function jetonsDe(bloc) {
  const m = charte.match(new RegExp(`${bloc}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `bloc ${bloc} introuvable dans charte.css`);
  const out = {};
  for (const j of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[j[1]] = j[2].trim();
  return out;
}
const rgb = (h) => {
  const c = h.replace('#', '');
  const p = c.length === 3 ? [...c].map((x) => x + x) : c.match(/../g);
  return p.map((x) => parseInt(x, 16));
};
const lum = (h) => {
  const [r, g, b] = rgb(h).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

for (const bloc of [':root', ':root\\[data-theme="dark"\\]']) {
  const j = jetonsDe(bloc);
  assert.ok(j['--inactif'] && j['--inactif-encre'],
    `${bloc} : la charte doit porter --inactif ET --inactif-encre`);
  const r = ratio(j['--inactif-encre'], j['--inactif']);
  assert.ok(r >= 4.5,
    `${bloc} : --inactif-encre sur --inactif ne donne que ${r.toFixed(2)}:1, il en faut 4,5`);
}

// --- 3. Le comptoir ne redéfinit plus sa valeur, il pointe sur la charte ---
// Deux valeurs pour un même rôle, c'est deux moitiés qui dérivent au premier
// réglage — et l'écran de la vendeuse est à un clic de celui du planning.
for (const nom of ['--dd-inactif', '--dd-inactif-encre']) {
  const decls = [...charte.matchAll(new RegExp(`${nom}\\s*:\\s*([^;]+);`, 'g'))].map((m) => m[1].trim());
  assert.ok(decls.length >= 2, `${nom} doit être posé pour les deux thèmes`);
  for (const v of decls) {
    assert.ok(/^var\(--inactif/.test(v),
      `${nom} vaut « ${v} » : il doit reprendre le jeton de la charte, pas une teinte à lui`);
  }
}

// --- 4. Les libellés qui disent une ACTION ne portent pas l'encre atténuée --
// `--text-3` se décrit lui-même dans la charte : « repères, pas du texte à
// lire ». Un intitulé qui dit ce qu'il faut faire n'en est pas un.
const styles = lire('public/styles.css');
const A_LIRE = [
  ['.ref-chip.empty', '« + référent » : c’est ce qu’il faut faire, pas un repère'],
  ['.flag-chip.empty', 'la pastille d’état vide propose une alerte'],
  ['.flag-reason.empty', 'le motif vide propose d’écrire un motif'],
  ['.colbar-item__ic', 'la case du panneau Colonnes porte un ÉTAT (sur l’écran / retirée)'],
  ['.ld-k', 'l’intitulé d’un champ de la fiche dit ce qu’on regarde'],
  ['.ld-volet__chevron', 'le chevron dit si le volet est ouvert'],
];
for (const [sel, pourquoi] of A_LIRE) {
  const re = new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*(?:,[^{]*)?\\{([^}]*)\\}`);
  const m = styles.match(re);
  assert.ok(m, `${sel} : règle introuvable dans styles.css`);
  assert.ok(!/var\(--text-3\)/.test(m[1]), `${sel} — ${pourquoi} : var(--text-3) s’y lit à moins de 2,5:1`);
  assert.ok(!/opacity\s*:/.test(m[1]), `${sel} — ${pourquoi} : une opacité l’éteint`);
}

// --- 5. Au comptoir, l'extinction doit être DANS LA COUCHE QUI GAGNE ------
// Les deux écrans du patron portent une couche de reprise en `!important` —
// c'est elle qui leur donne la boîte de la charte. Une règle d'extinction posée
// AILLEURS dans la feuille perd contre `.primary{background:…!important}` : le
// bouton reste plein encre alors qu'il refuse le clic. C'est arrivé le 27/08,
// et ça ne se voit sur aucun autre écran — seul le comptoir a cette couche.
//
// La règle : toute classe que la couche peint avec un fond `!important` doit
// avoir son extinction dans la même couche, elle aussi en `!important`.
for (const ecran of ['vente-directe', 'demande-devis']) {
  const css = lire(`public/comptoir/${ecran}.css`);
  assert.ok(/--dd-inactif\b/.test(css) && /--dd-inactif-encre\b/.test(css),
    `${ecran} : l'extinction passe par les jetons, pas par une teinte à elle`);

  // Les classes peintes en !important par la couche de reprise.
  const peintes = new Set();
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/background\s*:[^;]*!important/.test(m[2])) continue;
    for (const c of m[1].matchAll(/\.([a-z][\w-]*)/g)) peintes.add(c[1]);
  }
  // Celles qui portent une ACTION : les seules qu'on peut éteindre.
  const actions = [...peintes].filter((c) => ['primary', 'secondary', 'danger', 'whatsapp'].includes(c));
  assert.ok(actions.length, `${ecran} : la couche de reprise ne peint aucun bouton ?`);

  for (const classe of actions) {
    const eteinte = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].some(([, sel, corps]) =>
      new RegExp(`\\.${classe}(?:\\.blocked|:disabled)`).test(sel)
      && /background\s*:[^;]*!important/.test(corps)
      && /--dd-inactif\b/.test(corps));
    assert.ok(eteinte,
      `${ecran} — « .${classe} » se peint en !important mais ne s'éteint pas dans la même couche : `
      + 'désactivé, il gardera l’aspect d’un bouton armé qui refuse le clic');
  }
}

console.log('✓ commande éteinte : elle s’éclaircit, elle ne s’efface pas — et les deux thèmes tiennent');
