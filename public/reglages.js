// Réglages — Atelier OLDA
// Ce que le patron règle UNE fois pour tous les postes. Aujourd'hui : le message
// WhatsApp « votre commande est prête », celui que la pastille verte des lignes
// du planning ouvre dans WhatsApp, déjà écrit.
//
// Rien ne part jamais tout seul : la pastille se contente d'ouvrir la
// conversation avec le texte pré-rempli, c'est l'employé qui appuie sur Envoyer.
//
// Chargé À LA DEMANDE par app.js au premier passage sur la vue ; chaque retour
// relit la valeur enregistrée (un autre poste a pu la changer entre-temps).

let ROOT = null;
const $ = (sel) => ROOT.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const ic = (name, cls) => {
  const n = el('span', `material-symbols-outlined${cls ? ` ${cls}` : ''}`, name);
  n.setAttribute('aria-hidden', 'true');
  return n;
};

const MESSAGE_MAX = 1000;      // miroir de db.js (WHATSAPP_MESSAGE_MAX)

// Les jetons remplacés à l'ouverture de WhatsApp. Le tableau sert à la fois de
// documentation à l'écran et de source des boutons « insérer ».
const JETONS = [
  { token: '{client}', label: 'Nom du dossier client', exemple: 'Hôtel Esmeralda' },
  { token: '{commande}', label: 'Description de la commande', exemple: '50 t-shirts staff' },
  { token: '{date}', label: 'Date souhaitée', exemple: '29/07/2026' },
];

// Ligne d'exemple servant à l'aperçu : ce que le client lira vraiment.
const EXEMPLE = Object.fromEntries(JETONS.map((j) => [j.token, j.exemple]));

let saved = '';          // dernier texte confirmé par le serveur

// --- Rendu ------------------------------------------------------------------
function buildStatic() {
  const page = el('div', 'reg-page');

  const head = el('header', 'reg-head');
  head.append(
    ic('settings', 'reg-head__ic'),
    (() => {
      const t = el('div', 'reg-head__titles');
      t.append(el('h2', 'reg-head__title', 'Réglages'),
        el('p', 'reg-head__sub', 'Ce que vous réglez ici vaut pour tous les postes de l’atelier.'));
      return t;
    })(),
  );
  page.appendChild(head);

  // --- Carte « message WhatsApp » -------------------------------------------
  const card = el('section', 'reg-card');
  const ch = el('header', 'reg-card__head');
  ch.append(ic('chat', 'reg-card__ic'),
    (() => {
      const t = el('div');
      t.append(el('h3', 'reg-card__title', 'Message WhatsApp « commande prête »'),
        el('p', 'reg-card__desc',
          'Sur le planning, chaque commande dont le client a laissé un numéro porte '
          + 'une pastille WhatsApp. Un clic ouvre la conversation avec CE message déjà '
          + 'écrit — vous relisez, vous appuyez sur Envoyer. Rien ne part tout seul.'));
      return t;
    })());
  card.appendChild(ch);

  const field = el('div', 'reg-field');
  const ta = el('textarea', 'reg-textarea');
  ta.id = 'reg-wa-message';
  ta.rows = 4;
  ta.maxLength = MESSAGE_MAX;
  ta.placeholder = 'Bonjour {client}, votre commande est prête…';
  ta.setAttribute('aria-label', 'Message WhatsApp envoyé au client');
  field.appendChild(ta);

  const bar = el('div', 'reg-field__bar');
  const jetons = el('div', 'reg-jetons');
  jetons.appendChild(el('span', 'reg-jetons__t', 'Insérer :'));
  for (const j of JETONS) {
    const b = el('button', 'reg-jeton', j.token);
    b.type = 'button';
    b.dataset.token = j.token;
    b.title = `${j.label} — ex. ${j.exemple}`;
    jetons.appendChild(b);
  }
  bar.append(jetons, el('span', 'reg-count', ''));
  field.appendChild(bar);
  card.appendChild(field);

  // Aperçu : le texte tel que le client le recevra, jetons remplis.
  const apercu = el('div', 'reg-apercu');
  apercu.append(el('span', 'reg-apercu__t', 'Ce que le client lira'),
    el('p', 'reg-apercu__bulle', ''));
  card.appendChild(apercu);

  const actions = el('div', 'reg-actions');
  const status = el('span', 'reg-status', '');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const reset = el('button', 'reg-btn', 'Annuler');
  reset.type = 'button';
  reset.id = 'reg-wa-reset';
  const save = el('button', 'reg-btn reg-btn--primary', 'Enregistrer');
  save.type = 'button';
  save.id = 'reg-wa-save';
  actions.append(status, reset, save);
  card.appendChild(actions);

  page.appendChild(card);
  ROOT.replaceChildren(page);
}

// Le texte du moment, jetons remplacés par l'exemple.
function apercu(text) {
  let out = text;
  for (const [token, val] of Object.entries(EXEMPLE)) out = out.split(token).join(val);
  return out.replace(/[ \t]+/g, ' ').trim();
}

// Reflète l'état de la saisie : compteur, aperçu, boutons.
function sync() {
  const ta = $('#reg-wa-message');
  const text = ta.value;
  const dirty = text !== saved;
  $('.reg-count').textContent = `${text.length} / ${MESSAGE_MAX}`;
  const bulle = $('.reg-apercu__bulle');
  bulle.textContent = apercu(text) || 'Message vide : WhatsApp s’ouvrira sans texte.';
  bulle.classList.toggle('is-vide', apercu(text) === '');
  $('#reg-wa-save').disabled = !dirty;
  $('#reg-wa-reset').disabled = !dirty;
}

// Message de statut passager (« Enregistré »), effacé tout seul.
let statusTimer = null;
function flash(text, cls = '') {
  const s = $('.reg-status');
  s.textContent = text;
  s.className = `reg-status${cls ? ` ${cls}` : ''}`;
  clearTimeout(statusTimer);
  if (text) statusTimer = setTimeout(() => { s.textContent = ''; }, 2600);
}

// Insère un jeton à l'endroit du curseur (et pas bêtement à la fin) : on écrit
// souvent « Bonjour {client}, » au milieu d'une phrase déjà tapée.
function insertToken(token) {
  const ta = $('#reg-wa-message');
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
  const pos = start + token.length;
  ta.focus();
  ta.setSelectionRange(pos, pos);
  sync();
}

async function save() {
  const ta = $('#reg-wa-message');
  const message = ta.value;
  $('#reg-wa-save').disabled = true;
  flash('Enregistrement…');
  try {
    const res = await fetch('/api/settings/whatsapp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    saved = data.message;
    ta.value = saved;
    flash('Enregistré', 'is-ok');
  } catch (err) {
    flash(err.message || 'Enregistrement impossible', 'is-ko');
  } finally {
    sync();
  }
}

function wire() {
  const ta = $('#reg-wa-message');
  ta.addEventListener('input', sync);
  // ⌘/Ctrl + Entrée enregistre sans lâcher le clavier.
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
  });
  ROOT.addEventListener('click', (e) => {
    const jeton = e.target.closest('.reg-jeton');
    if (jeton) return insertToken(jeton.dataset.token);
    if (e.target.closest('#reg-wa-save')) return save();
    if (e.target.closest('#reg-wa-reset')) { ta.value = saved; sync(); flash(''); }
  });
}

// Relit la valeur enregistrée. Une saisie EN COURS n'est jamais écrasée : on ne
// fait pas disparaître sous les doigts un texte que le patron est en train
// d'écrire parce qu'un autre poste a rafraîchi la page.
export async function refreshReglages() {
  if (!ROOT) return;
  const ta = $('#reg-wa-message');
  const dirty = ta && ta.value !== saved;
  try {
    const data = await (await fetch('/api/settings/whatsapp')).json();
    saved = typeof data.message === 'string' ? data.message : '';
  } catch (_) { /* silencieux : on garde ce qu'on affiche déjà */ }
  if (ta && !dirty) ta.value = saved;
  sync();
}

let mounted = false;
export async function initReglages(root) {
  if (mounted) return;
  ROOT = root;
  mounted = true;
  buildStatic();
  wire();
  await refreshReglages();
}
