// Point d'import unique des bibliothèques tierces.
// Fonctionne dans le navigateur ET en Node (tests).

import * as PDFLib from '../vendor/pdf-lib.esm.min.js';
import * as pakoMod from '../vendor/pako.mjs';

export { PDFLib };
export const pako = pakoMod.default ?? pakoMod;

// ---------------------------------------------------------------------- fontkit
// 740 Ko de source, 317 Ko sur le réseau — et une seule utilisation dans toute
// l'application : `doc.registerFontkit()`, au moment de composer le PDF. Il
// était pourtant chargé par une balise `<script defer>` du document, donc à
// CHAQUE ouverture, y compris pour consulter la liste des projets.
//
// Il n'est plus chargé qu'à l'export. Le build ES importe « pako » en
// spécificateur nu (impossible dans le navigateur sans bundler) : on utilise
// donc le build UMD autonome, qu'un `<script>` posé à la volée exécute — la CSP
// l'autorise, c'est une ressource du site. En Node (tests), `require` suffit.
let _fontkit = null;

export async function loadFontkit() {
  if (_fontkit) return _fontkit;
  if (globalThis.fontkit) return (_fontkit = globalThis.fontkit);
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { createRequire } = await import('node:module');
    return (_fontkit = createRequire(import.meta.url)('@pdf-lib/fontkit'));
  }
  const src = new URL('../vendor/fontkit.umd.min.js', import.meta.url).toString();
  await new Promise((res, rej) => {
    // Déjà posé par un export précédent qui n'a pas abouti : on réutilise la
    // balise plutôt que d'en empiler une par tentative.
    const dejaLa = document.querySelector(`script[data-lib="fontkit"]`);
    if (dejaLa) { dejaLa.addEventListener('load', res, { once: true }); dejaLa.addEventListener('error', rej, { once: true }); return; }
    const s = document.createElement('script');
    s.src = src;
    s.dataset.lib = 'fontkit';
    s.onload = res;
    s.onerror = () => rej(new Error('fontkit n\'a pas pu être chargé.'));
    document.head.appendChild(s);
  });
  if (!globalThis.fontkit) throw new Error('fontkit n\'a pas pu être chargé.');
  return (_fontkit = globalThis.fontkit);
}
