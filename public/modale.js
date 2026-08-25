// UNE FENÊTRE MODALE EMMÈNE LE FOCUS AVEC ELLE (25/08/2026)
// ==========================================================================
// Le poste est un PC : clavier et souris. Six fenêtres de l'application se
// déclaraient modales (`aria-modal`) tout en laissant le focus DERRIÈRE elles,
// sur l'écran qu'on ne voit plus. Conséquence mesurée sur le tiroir client :
// la fiche s'ouvre, et pour atteindre sa croix de fermeture il faut tabuler à
// travers tout le planning, sous un voile opaque — donc à l'aveugle. Aucune ne
// rendait le focus à la fermeture : le clavier repartait du haut de la page à
// chaque consultation.
//
// Le modèle correct existait déjà dans le dépôt à TROIS endroits (la fiche de
// ligne du planning, la confirmation partagée, l'éditeur de ticket), recopié
// chaque fois. C'est ce modèle, extrait une bonne fois, pour que la septième
// fenêtre n'ait plus à le réécrire.
//
// CE QUE CE MODULE NE FAIT PAS : la touche Échap. Les fenêtres concernées la
// gèrent déjà, sur `document`, avec leur propre garde. La reprendre ici
// fermerait deux fois.

const FOCUSABLES = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// Les fenêtres s'EMPILENT (le panneau des secteurs s'ouvre par-dessus la fiche
// client). Seule celle du dessus retient la tabulation : deux pièges actifs se
// disputeraient le focus à chaque Tab.
const pile = [];

/**
 * Arme le piège à focus sur une fenêtre modale.
 *
 * @param {HTMLElement} carte  L'élément qui porte `role="dialog"`.
 * @param {{premier?: () => (HTMLElement|null)}} [options]
 *        `premier` : ce qui doit recevoir le focus à l'ouverture. Par défaut le
 *        premier élément atteignable de la fenêtre.
 * @returns {() => void} À appeler à la fermeture : retire le piège et REND le
 *          focus à l'élément qui l'avait avant l'ouverture.
 */
export function armerModale(carte, options = {}) {
  if (!carte) return () => {};
  const focusAvant = document.activeElement;
  const jeton = {};
  pile.push(jeton);

  // `offsetParent` écarte ce qui est masqué ; l'élément actif reste dans la
  // liste même si le navigateur le rend `null` (cas d'un `position: fixed`).
  const cibles = () => [...carte.querySelectorAll(FOCUSABLES)]
    .filter((el) => el.offsetParent !== null || el === document.activeElement);

  // Le focus entre APRÈS le rendu, et on REPASSE tant qu'il n'est pas entré.
  // Une seule tentative ne suffit pas : la fenêtre d'export du comptoir bascule
  // son `display` en ouvrant, et `focus()` sur un élément dont le style n'a pas
  // encore été recalculé ne fait RIEN, en silence. D'autres se remplissent dans
  // la foulée de leur ouverture. Trois trames suffisent, et on s'arrête dès que
  // c'est pris — ou dès que quelqu'un a cliqué ailleurs dans la fenêtre.
  let essais = 3;
  const entrer = () => {
    if (!carte.isConnected || desarme) return;
    if (carte.contains(document.activeElement)) return; // entré, par nous ou tout seul
    const voulu = typeof options.premier === 'function' ? options.premier() : null;
    const cible = voulu || cibles()[0] || carte;
    // Une fenêtre sans aucun élément atteignable prend le focus elle-même :
    // le lecteur d'écran annonce alors son titre au lieu de ne rien dire.
    if (cible === carte && !carte.hasAttribute('tabindex')) carte.tabIndex = -1;
    try { cible.focus({ preventScroll: true }); } catch (_) { /* parti du DOM */ }
    if (!carte.contains(document.activeElement) && --essais > 0) requestAnimationFrame(entrer);
  };
  requestAnimationFrame(entrer);

  // La tabulation tourne EN ROND dans la fenêtre. Sans ce filet, Tab repart
  // derrière le voile, dans un écran qu'on ne voit plus mais dont les champs
  // restent modifiables.
  const surTab = (e) => {
    if (e.key !== 'Tab') return;
    if (pile[pile.length - 1] !== jeton) return; // une fenêtre est ouverte par-dessus
    const liste = cibles();
    if (!liste.length) { e.preventDefault(); return; }
    const premier = liste[0];
    const dernier = liste[liste.length - 1];
    const dedans = carte.contains(document.activeElement);
    if (e.shiftKey && (!dedans || document.activeElement === premier)) {
      e.preventDefault(); dernier.focus();
    } else if (!e.shiftKey && (!dedans || document.activeElement === dernier)) {
      e.preventDefault(); premier.focus();
    }
  };
  // Sur `document` : le focus peut avoir glissé hors de la carte (fenêtre
  // rerendue, élément retiré), et il faut pouvoir le ramener de là aussi.
  document.addEventListener('keydown', surTab, true);

  let desarme = false;
  return function desarmerModale() {
    if (desarme) return;
    desarme = true;
    const i = pile.indexOf(jeton);
    if (i >= 0) pile.splice(i, 1);
    document.removeEventListener('keydown', surTab, true);
    // Le focus revient D'OÙ IL VENAIT. Sans ça le clavier repart du haut de la
    // page à chaque ouverture-fermeture.
    try {
      if (focusAvant && focusAvant.isConnected && focusAvant.focus) {
        focusAvant.focus({ preventScroll: true });
      }
    } catch (_) { /* parti du DOM */ }
  };
}
