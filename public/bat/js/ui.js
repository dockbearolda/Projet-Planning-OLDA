// Petits composants UI : toasts, modales, confirmation, popover et menu
// d'actions.

import { esc, ICON_X, ICON_MORE } from './util.js';

// ---------------------------------------------------------------------------
// OÙ SE POSENT LES MESSAGES ET LES MODALES
// ---------------------------------------------------------------------------
// L'application autonome les déclare dans son document. Posée DANS un CRM, elle
// ne peut rien exiger du HTML de l'hôte : on les crée à la demande, DANS le
// conteneur `.bat-app` — jamais dans le `body` de l'hôte, sinon les jetons de
// couleur ne les atteindraient pas et un toast sortirait sans habillage.
export function racineApp() {
  return document.querySelector('.bat-app') || document.body;
}

function hote(id, attributs = {}) {
  let n = document.getElementById(id);
  if (n) return n;
  n = document.createElement('div');
  n.id = id;
  for (const [k, v] of Object.entries(attributs)) n.setAttribute(k, v);
  racineApp().appendChild(n);
  return n;
}

// `ms: 0` = toast persistant (progression, bannière) : à congédier via la
// poignée retournée, ou par l'action. `action` ajoute un bouton dans le toast.
export function toast(msg, { error = false, ms = 3200, action = null } = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  // Annonce aux lecteurs d'écran : erreurs en assertif, succès en poli.
  el.setAttribute('role', error ? 'alert' : 'status');
  el.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.onclick = action.onClick;
    el.appendChild(b);
  }
  hote('toasts', { 'aria-live': 'polite', 'aria-atomic': 'false' }).appendChild(el);
  const timer = ms > 0 ? setTimeout(() => el.remove(), ms) : null;
  return { dismiss: () => { if (timer) clearTimeout(timer); el.remove(); } };
}

let modalSeq = 0;

// Ouvre une modale. content = HTMLElement ou HTML string.
// Retourne { close, body, foot } ; onClose appelé à la fermeture.
export function openModal({ title, content, footButtons = [], width, onClose }) {
  const prevFocus = document.activeElement;
  const veil = document.createElement('div');
  veil.className = 'modal-veil';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const titleId = 'modal-title-' + (++modalSeq);
  modal.setAttribute('aria-labelledby', titleId);
  if (width) modal.style.width = width;

  const head = document.createElement('div');
  head.className = 'modal-head';
  head.innerHTML = `<span id="${titleId}">${esc(title)}</span>`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.setAttribute('aria-label', 'Fermer');
  closeBtn.innerHTML = ICON_X;
  head.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body';
  if (typeof content === 'string') body.innerHTML = content;
  else if (content) body.appendChild(content);

  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  for (const b of footButtons) foot.appendChild(b);
  if (!footButtons.length) foot.style.display = 'none';

  modal.append(head, body, foot);
  veil.appendChild(modal);
  hote('modal-root').appendChild(veil);

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    veil.remove();
    prevFocus?.focus?.();   // restaure le focus au déclencheur
    onClose?.();
  };
  // Échap ferme ; Tab est piégé à l'intérieur de la modale (accessibilité clavier).
  const onKey = (e) => {
    // Modales empilées : seule celle du dessus (dernier voile de #modal-root)
    // réagit — sinon un seul Échap fermerait toute la pile.
    if (veil.parentElement && veil !== veil.parentElement.lastElementChild) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  closeBtn.onclick = close;
  veil.addEventListener('mousedown', (e) => { if (e.target === veil) close(); });
  document.addEventListener('keydown', onKey, true);

  // Focus initial : 1er champ de saisie, sinon bouton principal, sinon fermeture.
  (body.querySelector('input, textarea, select')
    || foot.querySelector('button.primaire, button.danger')
    || closeBtn).focus?.();

  return { close, body, foot, modal };
}

export function confirmModal(title, message, { danger = false, okLabel = 'Confirmer' } = {}) {
  return new Promise((resolve) => {
    const ok = document.createElement('button');
    ok.className = 'btn primaire' + (danger ? ' danger' : '');
    ok.textContent = okLabel;
    const cancel = document.createElement('button');
    cancel.className = 'btn secondaire';
    cancel.textContent = 'Annuler';
    const m = openModal({
      title, content: `<p class="texte-modale">${esc(message)}</p>`,
      footButtons: [cancel, ok], onClose: () => resolve(false),
    });
    ok.onclick = () => { resolve(true); m.close(); };
    cancel.onclick = () => { resolve(false); m.close(); };
  });
}

// Une confirmation qui porte une LISTE de points, là où `confirmModal` ne prend
// qu'une phrase (et l'échappe, à raison). Le contenu est déjà échappé par
// l'appelant, point par point : ce qu'on assemble ici, ce sont des `<li>`.
export function confirmListe(title, itemsHtml, { okLabel = 'Exporter quand même', cancelLabel = 'Corriger' } = {}) {
  return new Promise((resolve) => {
    const ok = document.createElement('button');
    ok.className = 'btn primaire';
    ok.textContent = okLabel;
    const cancel = document.createElement('button');
    cancel.className = 'btn secondaire';
    cancel.textContent = cancelLabel;
    const m = openModal({
      title,
      content: `<ul class="liste-manques">${itemsHtml}</ul>`,
      footButtons: [cancel, ok],
      onClose: () => resolve(false),
    });
    ok.onclick = () => { resolve(true); m.close(); };
    cancel.onclick = () => { resolve(false); m.close(); };
  });
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---------------------------------------------------------------------------
// LE POPOVER — UN SEUL, POUR TOUTE L'APPLICATION
// ---------------------------------------------------------------------------
// Il vivait dans `garmentpicker.js`, donc réservé au choix du vêtement. Depuis
// que les listes ont un menu d'actions, DEUX écrans portent un menu : il
// descend donc ici (loi 10 — un composant que plus d'un écran porte n'a pas le
// droit d'exister en deux exemplaires qui se ressemblent).
//
// Un seul menu ouvert à la fois dans toute la page : ouvrir le second ferme le
// premier, et un clic ailleurs les ferme tous.
let openCombo = null;

// `trigger` : l'élément qui ouvre le menu. Par défaut un bouton — mais le
// sélecteur de vêtement fournit un CHAMP DE SAISIE, parce qu'y taper est la
// façon la plus courte d'y choisir. Le reste (un seul menu ouvert, fermeture
// au clic dehors, à Échap) ne change pas : c'est justement ce qu'on ne veut
// pas voir réécrit une deuxième fois.
export function createCombo(host, { trigger = null } = {}) {
  host.classList.add('gp-combo');
  trigger ??= el('<button type="button" class="gp-trigger"></button>');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  host.appendChild(trigger);
  let panel = null;
  let buildPanel = null;

  const close = () => {
    if (!panel) return;
    panel.remove();
    panel = null;
    trigger.setAttribute('aria-expanded', 'false');
    if (openCombo === api) openCombo = null;
  };
  const open = () => {
    if (panel || !buildPanel) return;
    if (openCombo) openCombo.close();
    panel = buildPanel(close);
    panel.classList.add('gp-panel');
    host.appendChild(panel);
    // Bascule à droite si le menu déborderait de la fenêtre (mobile inclus).
    const r = panel.getBoundingClientRect();
    if (r.right > innerWidth - 8) panel.classList.add('gp-align-right');
    trigger.setAttribute('aria-expanded', 'true');
    openCombo = api;
    (panel.querySelector('input') || panel.querySelector('.gp-row'))?.focus();
  };
  trigger.onclick = () => (panel ? close() : open());
  host.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel) { e.preventDefault(); close(); trigger.focus(); }
  });

  const api = { trigger, close, open, setPanelBuilder: (fn) => { buildPanel = fn; } };
  return api;
}

document.addEventListener('mousedown', (e) => {
  if (openCombo && !e.target.closest('.gp-combo')) openCombo.close();
}, true);

// ---------------------------------------------------------------------------
// LE MENU D'ACTIONS — LES TROIS POINTS
// ---------------------------------------------------------------------------
// UNE liste de quinze projets portait quarante-cinq boutons de même poids, dont
// quinze « Supprimer » aussi visibles que l'ouverture. Le geste courant (ouvrir)
// est déjà porté par la ligne entière ; ce qui reste est SECONDAIRE, et le
// secondaire se range. Un rond, trois points, et le menu du système.
//
// `items` : [{ label, onClick, danger }]. Un item `danger` porte l'encre du
// danger — c'est un état, pas une décoration.
export function menuActions(items, { label = 'Autres actions' } = {}) {
  const host = el('<span class="menu-actions"></span>');
  const combo = createCombo(host);
  combo.trigger.className = 'rond menu-actions-btn';
  combo.trigger.innerHTML = ICON_MORE;
  combo.trigger.setAttribute('aria-haspopup', 'menu');
  combo.trigger.setAttribute('aria-label', label);
  combo.trigger.title = label;
  // La ligne entière ouvre le projet : le menu ne doit pas déclencher ce geste
  // en même temps qu'il s'ouvre.
  host.addEventListener('click', (e) => e.stopPropagation());
  combo.setPanelBuilder((close) => {
    const panel = el('<div class="gp-list gp-menu" role="menu"></div>');
    for (const it of items) {
      const row = el(`<button type="button" class="gp-row${it.danger ? ' gp-row-danger' : ''}" role="menuitem"></button>`);
      row.textContent = it.label;
      row.onclick = () => { close(); it.onClick(); };
      panel.appendChild(row);
    }
    return panel;
  });
  return host;
}

// Nuancier proposé pour la recoloration des logos monochromes.
export const PALETTE = [
  '#000000', '#FFFFFF', '#1D3557', '#14213D', '#0D6E66', '#2A9D8F',
  '#C1121F', '#E63946', '#E76F51', '#F4A261', '#E9C46A', '#FFB703',
  '#606C38', '#283618', '#7209B7', '#3A0CA3', '#4361EE', '#4CC9F0',
  '#B5838D', '#6D6875', '#8D99AE', '#CED4DA',
];
