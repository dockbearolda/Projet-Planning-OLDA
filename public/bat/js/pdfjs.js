// ===========================================================================
// pdf.js — CHARGÉ SEULEMENT QUAND UN PDF DOIT ÊTRE LU
// ---------------------------------------------------------------------------
// Il était chargé par une balise `<script type="module">` dans le document,
// donc à CHAQUE ouverture de l'application : 444 Ko de source, 127 Ko sur le
// réseau, plus 1,2 Mo de worker à la première utilisation. Or il ne sert qu'à
// trois choses, toutes rares et toutes explicites : un logo au format PDF, un
// mockup au format PDF, et la relecture d'un BAT exporté.
//
// Ici, il n'arrive qu'au premier de ces trois gestes. L'écran BAT, l'écran
// Projets et l'écran Produits n'en téléchargent pas un octet.
//
// Le module s'installe lui-même en global (`globalThis.pdfjsLib`) : c'est ce
// qui permet de le charger par `import()` sans avoir à faire circuler l'objet.
// La promesse est mémorisée — deux logos PDF déposés d'affilée ne provoquent
// qu'un seul chargement, et deux dépôts SIMULTANÉS attendent la même.
let chargement = null;

export function pdfjs() {
  if (globalThis.pdfjsLib) return Promise.resolve(globalThis.pdfjsLib);
  chargement ??= import('../vendor/pdf.min.mjs')
    .then(() => {
      const lib = globalThis.pdfjsLib;
      if (!lib) throw new Error('pdf.js n\'a pas pu être chargé.');
      // Le worker fait le décodage hors du fil principal. Si le navigateur
      // refuse le worker de type module,
      // pdf.js retombe de lui-même sur un « faux worker » dans le fil
      // principal — plus lent, mais fonctionnel.
      lib.GlobalWorkerOptions.workerSrc =
        new URL('../vendor/pdf.worker.min.mjs', import.meta.url).toString();
      return lib;
    })
    .catch((e) => { chargement = null; throw e; });   // un échec réseau doit pouvoir se rejouer
  return chargement;
}
