#!/usr/bin/env node
/* ===========================================================================
   PHAREDESIGN — LE GARDE-FOU
   ---------------------------------------------------------------------------
   Un système atomique ne tient pas parce qu'il est écrit : il tient parce que
   quelque chose refuse ce qui en sort. Sans ce fichier, les valeurs reviennent
   une par une, et chacune paraît raisonnable prise seule.

   Usage :
     node verifier.mjs <fichier|dossier> [...]     # défaut : le dossier courant
     node verifier.mjs src --exclure vendor,dist

   Il lit le CSS des .css et les blocs <style> des .html/.htm, retire les
   commentaires et les blocs @media print (le papier n'a pas de thème : ce qui
   s'imprime s'écrit en toutes lettres, noir sur blanc).

   Sortie : liste des écarts, fichier:ligne, puis code 1 s'il en reste.

   ---------------------------------------------------------------------------
   POSÉ DANS LE DÉPÔT LE 27/08/2026, à la demande de Charlie. Il ne peut pas
   sortir en code 1 tel quel : il reste 252 écarts au moment où il arrive, et
   faire échouer `npm test` sur un existant qu'on n'a pas encore nettoyé, c'est
   la garantie qu'on le débranchera dans la semaine.

   Il est donc branché en CLIQUET — voir `test/charte-cliquet.test.js` : le
   nombre d'écarts par fichier a le droit de descendre, jamais de remonter.
   Un fichier nettoyé abaisse son plafond ; une valeur en dur ajoutée fait
   échouer le test à l'endroit exact où elle a été écrite.
   =========================================================================== */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename, relative } from 'node:path';

/* --- L'ÉCHELLE, telle que phare.css la pose ------------------------------ */
const TAILLES   = new Set(['14px', '17px', '21px', '32px']);
const GRAISSES  = new Set(['400', '600', '800', 'inherit', 'normal', 'bold', 'bolder', 'lighter']);
const ARRONDIS  = new Set(['10px', '16px', '999px', '0', '0px', '50%', '2px', '4px', '1px']);
const PAS       = new Set(['6px', '10px', '16px', '24px', '0', '0px', 'auto']);
const ICONES    = new Set(['16px', '20px', '24px', '40px']);

/* Les fichiers qui ONT LE DROIT de poser des valeurs : ce sont eux, la source. */
const SOURCES = /^(phare|phare-composants|charte)\.css$/;

/* --- Lecture ------------------------------------------------------------- */
const sansCommentaires = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/* Retire un bloc `@media print{…}` en COMPTANT les accolades. Sans ça le #fff
   d'une feuille de papier compte comme une couleur en dur de l'écran. */
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
    out += css.slice(d, j).replace(/[^\n]/g, ' ');   // on garde les retours à la ligne
    i = j;
  }
  return out;
}

function cssDuFichier(p) {
  const brut = readFileSync(p, 'utf8');
  if (extname(p) === '.css') return sansImpression(sansCommentaires(brut));
  // .html : on garde les positions de ligne en blanchissant tout hors <style>
  let out = brut.replace(/[^\n]/g, ' ').split('');
  for (const m of brut.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const debut = m.index + m[0].indexOf(m[1]);
    for (let k = 0; k < m[1].length; k += 1) out[debut + k] = m[1][k];
  }
  return sansImpression(sansCommentaires(out.join('')));
}

/* --- Les règles ---------------------------------------------------------- */
const REGLES = [
  {
    nom: 'couleur en dur',
    // Une teinte qui n'est pas un jeton. `--x: #fff` dans un fichier source est
    // permis ; ailleurs, tout hexadécimal / rgb() / hsl() est un écart.
    re: /(#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\()/g,
    pourquoi: 'toute teinte passe par un jeton var(--…) — sinon le thème sombre ne suit pas',
    permis: (ligne) => /\bvar\(\s*--/.test(ligne) && /rgba?\s*\(\s*var\(/.test(ligne),
  },
  {
    nom: 'taille de texte hors échelle',
    re: /font-size\s*:\s*([^;}]+)/g,
    valeur: 1,
    pourquoi: 'quatre tailles seulement (14 / 17 / 21 / 32) — un écart d’un demi-pixel ne se lit pas comme une hiérarchie',
    ok: (v) => v.includes('var(--') || v.includes('inherit') || TAILLES.has(v.trim()) || v.includes('em') || v.includes('%'),
  },
  {
    nom: 'graisse hors échelle',
    re: /font-weight\s*:\s*([^;}]+)/g,
    valeur: 1,
    pourquoi: 'trois graisses (400 / 600 / 800) — 500 et 700 sont des marches qui ne se voient pas',
    ok: (v) => v.includes('var(--') || GRAISSES.has(v.trim()),
  },
  {
    nom: 'arrondi hors des trois formes',
    re: /border-radius\s*:\s*([^;}]+)/g,
    valeur: 1,
    pourquoi: 'trois formes : rectangle (ça agit) / rond (une icône) / pilule (une étiquette)',
    ok: (v) => v.includes('var(--') || v.trim().split(/\s+/).every((t) => ARRONDIS.has(t)),
  },
  {
    nom: 'hauteur écrite en dur sur une commande',
    re: /(?:min-)?height\s*:\s*(\d+(?:\.\d+)?px)/g,
    valeur: 1,
    pourquoi: 'la boîte SORT du texte, de l’interligne et du rembourrage — elle ne s’écrit jamais',
    ok: (v) => ['1px', '2px', '22px', '0px'].includes(v),
  },
  {
    nom: 'interligne `normal` sur une commande',
    re: /line-height\s*:\s*normal/g,
    pourquoi: '`normal` laisse le contenu décider de la hauteur : cinq boutons identiques, cinq hauteurs',
  },
  {
    nom: 'durée écrite en dur',
    re: /transition[^;}]*?\b(\d+m?s)\b/g,
    valeur: 1,
    pourquoi: 'la durée dit le GENRE de changement : --dur-1 répond, --dur-2 déplace',
    ok: (v) => ['0s', '0ms'].includes(v),
  },
  {
    // UNE COMMANDE ÉTEINTE À L'OPACITÉ DEVIENT ILLISIBLE, et c'est arithmétique :
    // l'opacité rapproche l'encre DU FOND. Le 27/08, six règles éteignaient de
    // cette façon — « Enregistrer » à 2,67:1, « + référent » à 1,85:1, et les
    // deux actions « Appeler / Écrire » d'une fiche client à 2,2:1. Chacune
    // s'éteignait au moment précis où l'on cherche ce qu'il faut faire.
    // La sortie est --inactif / --inactif-encre : le fond s'éclaircit, l'encre
    // passe au secondaire, et l'écart avec une commande armée reste évident.
    nom: 'commande éteinte à l’opacité',
    re: /^[^{}]*(?::disabled|\[disabled\]|\[aria-disabled|\.is-off|\.blocked)[^{}]*\{[^}]*opacity\s*:/gm,
    pourquoi: 'l’opacité rapproche l’encre du fond : le libellé s’éteint — passer par --inactif / --inactif-encre',
  },
  {
    nom: 'cible tactile / seconde échelle',
    re: /@media[^{]*pointer\s*:\s*coarse/g,
    pourquoi: 'une seule échelle — un bloc tactile en entretient une deuxième en silence',
  },
  {
    nom: '!important sur un sélecteur nu',
    re: /^\s*(?:button|input|select|textarea|a|div|span)\s*(?:,[^{]*)?\{[^}]*!important/gm,
    pourquoi: 'un !important sur un sélecteur nu bat n’importe quelle classe, y compris celles d’un composant partagé',
  },
];

/* --- Parcours ------------------------------------------------------------ */
const args = process.argv.slice(2);
const iEx = args.indexOf('--exclure');
const exclus = new Set(['node_modules', '.git', 'dist', 'build', 'vendor',
  ...(iEx >= 0 ? (args[iEx + 1] || '').split(',').filter(Boolean) : [])]);
const cibles = (iEx >= 0 ? args.slice(0, iEx) : args);
if (!cibles.length) cibles.push('.');

const fichiers = [];
/* LES PAGES D'ESSAI NE SE NOTENT PAS. Le prefixe `_` est deja le motif que le
   depot ignore (`public/_*` dans .gitignore) : ce sont des pages posees le temps
   d'une mesure — un apercu de papier, une maquette de handoff a regarder a cote
   de l'ecran. Les compter faisait RECULER la charte le temps qu'elles trainent,
   donc echouer `npm test`, qui doit etre vert avant tout commit : le controle
   se mettait a interdire le fait meme de comparer deux ecrans. */
const explorer = (p) => {
  if (basename(p).startsWith('_')) return;
  const st = statSync(p);
  if (st.isDirectory()) {
    if (exclus.has(basename(p))) return;
    for (const e of readdirSync(p)) explorer(join(p, e));
  } else if (/\.(css|html?)$/i.test(p) && !SOURCES.test(basename(p))) {
    fichiers.push(p);
  }
};
for (const c of cibles) explorer(c);

let ecarts = 0;
for (const f of fichiers) {
  const css = cssDuFichier(f);
  if (!css.trim()) continue;
  const lignes = css.split('\n');
  const trouves = [];

  for (const r of REGLES) {
    r.re.lastIndex = 0;
    for (const m of css.matchAll(r.re)) {
      const val = r.valeur != null ? (m[r.valeur] || '').trim() : null;
      const avant = css.slice(0, m.index);
      const noLigne = avant.split('\n').length;
      const ligne = lignes[noLigne - 1] || '';
      // Sur une feuille minifiée, une règle tient sur une seule ligne de 4 000
      // caractères : cadrer l'extrait AUTOUR de la faute, pas au début de la
      // ligne — sinon on montre le voisin et jamais le coupable.
      const col = m.index - (avant.lastIndexOf('\n') + 1);
      const d0 = Math.max(0, col - 38);
      const extrait = (d0 > 0 ? '…' : '') + ligne.slice(d0, col + Math.max(m[0].length, 20) + 38).trim()
                    + (col + m[0].length + 38 < ligne.length ? '…' : '');
      if (r.ok && r.ok(val)) continue;
      if (r.permis && r.permis(ligne)) continue;
      // une déclaration de jeton dans un :root local reste un écart (on ne
      // redéclare pas un jeton) — mais on la nomme autrement, c'est plus clair
      const nom = /^\s*--/.test(ligne) && r.nom === 'couleur en dur'
        ? 'jeton redéclaré hors de la source' : r.nom;
      trouves.push({ noLigne, nom, extrait, pourquoi: r.pourquoi });
    }
  }

  if (trouves.length) {
    ecarts += trouves.length;
    console.log(`\n\x1b[1m${relative(process.cwd(), f) || f}\x1b[0m`);
    trouves.sort((a, b) => a.noLigne - b.noLigne);
    for (const t of trouves) {
      console.log(`  \x1b[31m${String(t.noLigne).padStart(5)}\x1b[0m  ${t.nom}`);
      console.log(`         ${t.extrait}`);
      console.log(`         \x1b[2m→ ${t.pourquoi}\x1b[0m`);
    }
  }
}

console.log(
  ecarts === 0
    ? `\n\x1b[32m✓ PHAREDESIGN tenu\x1b[0m — ${fichiers.length} fichier(s), aucun écart.`
    : `\n\x1b[31m✗ ${ecarts} écart(s)\x1b[0m sur ${fichiers.length} fichier(s).`
);
process.exit(ecarts === 0 ? 0 : 1);
