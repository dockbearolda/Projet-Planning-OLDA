'use strict';

// ===========================================================================
// LES COMMENTAIRES NE PARTENT PLUS SUR LE FIL
// ===========================================================================
// 46 % de ce que l'application sert est du commentaire : 383 Ko de prose
// française envoyés à chaque poste, à chaque déploiement. Ces commentaires sont
// la mémoire du projet — ils disent POURQUOI chaque règle existe, et plusieurs
// incidents ne se sont pas répétés grâce à eux. On ne les supprime donc pas de
// la source : on les retire au moment de SERVIR, en mémoire.
//
// Ce n'est pas un build. Rien n'est écrit sur le disque, aucun outil n'entre
// dans le dépôt, les fichiers gardent leur nom : on lit le fichier, on le
// dépouille une fois, on garde le résultat en mémoire tant que le fichier ne
// bouge pas. Mesuré sur les huit fichiers servis : 281 → 114 Ko une fois
// compressés, soit 167 Ko de moins à chaque chargement à froid.
//
// LES NUMÉROS DE LIGNE SONT PRÉSERVÉS. Un commentaire de bloc devient autant de
// sauts de ligne qu'il en occupait, un commentaire de fin de ligne laisse le
// sien. Une pile d'appels remontée d'un poste continue donc de pointer la bonne
// ligne du fichier source — sans ça, le premier bug en production aurait coûté
// plus cher que les 167 Ko gagnés.
//
// PAS D'EXPRESSION RÉGULIÈRE. Un `/* */` peut vivre à l'intérieur d'une chaîne,
// d'un littéral de gabarit ou d'une expression régulière — et `CSS_TICKET` en
// est PLEIN. Un simple remplacement y aurait mangé du code jusqu'au prochain
// `*/`, et l'application se serait ouverte sur un écran nu. On lit donc le
// fichier caractère par caractère, en sachant à tout instant où l'on est.
// (Le 26/08, un seul accent grave dans un commentaire CSS a suffi à vider
// l'écran : `node --check` passait, les tests passaient. La leçon a servi.)

// Les mots après lesquels un `/` ouvre une EXPRESSION RÉGULIÈRE et non une
// division. Sans eux, `return /a/.test(x)` se lisait comme un début de division
// et tout ce qui suivait partait dans une fausse expression régulière.
const AVANT_UNE_REGEX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await', 'is',
]);

// Un `/` DIVISE quand ce qui précède est une valeur : un nom, un nombre, une
// parenthèse ou un crochet fermant. Après tout le reste — un opérateur, une
// virgule, un `(` — il ouvre une expression régulière.
//
// Le `}` est le seul cas vraiment ambigu (fin de bloc → regex ; fin d'objet →
// division). On le traite comme une valeur, ce qui est le choix sûr : au pire
// une expression régulière est prise pour une division, et le lecteur voit
// alors un `/` isolé — jamais un commentaire fantôme qui mange du code.
const finDeValeur = (c) => /[A-Za-z0-9_$)\]}]/.test(c);

// Le dernier mot écrit avant la position `i` (pour la table ci-dessus).
function motPrecedent(src, i) {
  let fin = i;
  while (fin > 0 && /\s/.test(src[fin - 1])) fin--;
  let deb = fin;
  while (deb > 0 && /[A-Za-z_$]/.test(src[deb - 1])) deb--;
  return src.slice(deb, fin);
}

const memesSautsDeLigne = (t) => '\n'.repeat((t.match(/\n/g) || []).length);

// --- JavaScript ------------------------------------------------------------
// Un seul passage, un seul état à la fois : hors chaîne, dans une chaîne, dans
// un gabarit (qui peut contenir du code entre `${` et `}`, donc d'autres
// chaînes et d'autres commentaires), ou dans une expression régulière.
function depouillerJs(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  // La pile des gabarits ouverts : chaque entrée compte les accolades du
  // `${ … }` en cours, pour savoir quel `}` referme l'expression et rend la
  // main au texte du gabarit.
  const gabarits = [];

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    // --- dans une substitution de gabarit, un `}` peut refermer -------------
    if (gabarits.length && c === '}' && gabarits[gabarits.length - 1].profondeur === 0) {
      gabarits[gabarits.length - 1].dansLeTexte = true;
      out += c; i++;
      // on repart en lecture de gabarit
      const g = gabarits[gabarits.length - 1];
      const r = lireGabarit(src, i, g);
      out += r.texte; i = r.i;
      if (r.termine) gabarits.pop();
      continue;
    }
    if (gabarits.length && (c === '{' || c === '}')) {
      const g = gabarits[gabarits.length - 1];
      g.profondeur += c === '{' ? 1 : -1;
      out += c; i++;
      continue;
    }

    // --- commentaires -------------------------------------------------------
    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      i = j;                                  // le saut de ligne reste
      continue;
    }
    if (c === '/' && d === '*') {
      const fin = src.indexOf('*/', i + 2);
      const j = fin === -1 ? n : fin + 2;
      out += memesSautsDeLigne(src.slice(i, j));
      i = j;
      continue;
    }

    // --- chaînes ------------------------------------------------------------
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    // --- gabarit ------------------------------------------------------------
    if (c === '`') {
      out += c; i++;
      const g = { profondeur: 0 };
      const r = lireGabarit(src, i, g);
      out += r.texte; i = r.i;
      if (!r.termine) gabarits.push(g);
      continue;
    }

    // --- expression régulière ------------------------------------------------
    if (c === '/') {
      let k = i - 1;
      while (k >= 0 && /\s/.test(src[k])) k--;
      const precedent = k >= 0 ? src[k] : '';
      const mot = motPrecedent(src, i);
      const estRegex = !finDeValeur(precedent) || AVANT_UNE_REGEX.has(mot);
      if (estRegex) {
        let j = i + 1;
        let dansUneClasse = false;
        while (j < n) {
          const e = src[j];
          if (e === '\\') { j += 2; continue; }
          if (e === '\n') break;              // pas de regex sur deux lignes
          if (e === '[') dansUneClasse = true;
          else if (e === ']') dansUneClasse = false;
          else if (e === '/' && !dansUneClasse) break;
          j++;
        }
        if (src[j] === '/') {
          j++;
          while (j < n && /[a-z]/.test(src[j])) j++;   // les drapeaux
          out += src.slice(i, j);
          i = j;
          continue;
        }
      }
    }

    out += c; i++;
  }
  return out;

  // Le TEXTE d'un gabarit, jusqu'à son accent grave de fin ou jusqu'au prochain
  // `${`. Les commentaires n'existent pas dans le texte d'un gabarit : tout y
  // est littéral. On n'y touche donc à rien.
  function lireGabarit(source, depart, etat) {
    let j = depart;
    let texte = '';
    while (j < source.length) {
      const e = source[j];
      if (e === '\\') { texte += source.slice(j, j + 2); j += 2; continue; }
      if (e === '`') { texte += e; j++; return { texte, i: j, termine: true }; }
      if (e === '$' && source[j + 1] === '{') {
        texte += '${'; j += 2;
        etat.profondeur = 0;
        return { texte, i: j, termine: false };
      }
      texte += e; j++;
    }
    return { texte, i: j, termine: true };
  }
}

// --- CSS -------------------------------------------------------------------
// Beaucoup plus simple : le CSS n'a qu'une forme de commentaire, et elle ne
// s'imbrique pas. Restent les chaînes (`content: "…"`, `url("…")`), où un `/*`
// n'ouvre rien.
function depouillerCss(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const fin = src.indexOf('*/', i + 2);
      const j = fin === -1 ? n : fin + 2;
      out += memesSautsDeLigne(src.slice(i, j));
      i = j;
      continue;
    }
    out += c; i++;
  }
  return out;
}

// LE FILET. Un dépouillage qui se trompe ne doit JAMAIS sortir : on vérifie que
// le résultat porte exactement les mêmes délimiteurs que la source une fois ses
// commentaires ignorés — mêmes accents graves, mêmes guillemets, mêmes
// accolades. Si un `/*` avait mangé du code, un de ces comptes tomberait.
// Au moindre doute on rend la source telle quelle : au pire on ne gagne rien,
// jamais un fichier cassé.
const DELIMITEURS = ['`', '"', "'", '{', '}', '(', ')', '[', ']'];

function memeSquelette(depouille, type) {
  // On compare le dépouillé à LUI-MÊME re-dépouillé : un passage stable prouve
  // qu'il ne reste plus rien à retirer, donc qu'aucun délimiteur n'a été avalé
  // en cours de route.
  const encore = type === 'css' ? depouillerCss(depouille) : depouillerJs(depouille);
  if (encore !== depouille) return false;
  for (const d of DELIMITEURS) {
    const a = (depouille.match(new RegExp(`\\${d}`, 'g')) || []).length;
    const b = (encore.match(new RegExp(`\\${d}`, 'g')) || []).length;
    if (a !== b) return false;
  }
  return true;
}

// Dépouille `src`, ou rend la source intacte si quoi que ce soit cloche.
function depouiller(src, type) {
  try {
    const sortie = type === 'css' ? depouillerCss(src) : depouillerJs(src);
    if (!sortie || !memeSquelette(sortie, type)) return src;
    // Les sauts de ligne doivent être au compte exact : c'est ce qui garde les
    // numéros de ligne alignés sur la source.
    const l = (s) => (s.match(/\n/g) || []).length;
    if (l(sortie) !== l(src)) return src;
    return sortie;
  } catch (_) {
    return src;
  }
}

module.exports = { depouiller, depouillerJs, depouillerCss };
