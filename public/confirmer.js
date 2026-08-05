// ===========================================================================
// Demander confirmation — la boîte de l'application, jamais celle du système
// ===========================================================================
// `window.confirm()` ouvre la boîte grise du navigateur : hors charte, minuscule
// au doigt sur la tablette, et elle GÈLE le thread — le planning ne se
// rafraîchit plus tant qu'elle est à l'écran. On pose la même question avec les
// composants de l'app : grandes cibles, Échap / fond pour annuler, focus sur
// « Annuler » (on ne confirme jamais une suppression par inadvertance en tapant
// Entrée), tabulation retenue dans la boîte.
//
// Module à part parce que DEUX écrans en ont besoin — le planning et la Base
// clients — et que la Base clients est chargée à la demande par le planning :
// lui faire importer app.js aurait bouclé.

export function confirmerAction(titre, texte, libelleOk = 'Supprimer') {
  return new Promise((resolve) => {
    const focusAvant = document.activeElement;
    const fond = document.createElement('div');
    fond.className = 'ask';
    const carte = document.createElement('div');
    carte.className = 'ask__card';
    carte.setAttribute('role', 'alertdialog');
    carte.setAttribute('aria-modal', 'true');

    const h = document.createElement('h2');
    h.className = 'ask__title';
    h.textContent = titre;
    const p = document.createElement('p');
    p.className = 'ask__text';
    p.textContent = texte;
    carte.setAttribute('aria-label', `${titre}. ${texte}`);

    const actions = document.createElement('div');
    actions.className = 'ask__actions';
    const annuler = document.createElement('button');
    annuler.type = 'button';
    annuler.className = 'ask__btn';
    annuler.textContent = 'Annuler';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'ask__btn ask__btn--danger';
    ok.textContent = libelleOk;
    actions.append(annuler, ok);
    carte.append(h, p, actions);
    fond.append(carte);
    document.body.append(fond);

    let fini = false;
    const fermer = (reponse) => {
      if (fini) return;
      fini = true;
      document.removeEventListener('keydown', onKey, true);
      fond.remove();
      if (focusAvant && focusAvant.isConnected && focusAvant.focus) focusAvant.focus();
      resolve(reponse);
    };
    // Tabulation retenue dans la boîte : sans ça, le focus repart derrière le
    // voile et on répond à une question qu'on ne voit plus.
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(false); return; }
      if (e.key !== 'Tab') return;
      e.preventDefault();
      (document.activeElement === annuler ? ok : annuler).focus();
    }
    document.addEventListener('keydown', onKey, true);
    annuler.addEventListener('click', () => fermer(false));
    ok.addEventListener('click', () => fermer(true));
    fond.addEventListener('click', (e) => { if (e.target === fond) fermer(false); });
    requestAnimationFrame(() => { fond.classList.add('open'); annuler.focus(); });
  });
}
