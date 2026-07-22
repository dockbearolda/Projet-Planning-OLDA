// Prise de commande — Atelier OLDA
// Le PREMIER PAS du client : la fiche qu'on remplit au comptoir, en face de lui.
// Juste les infos de base, sous forme de tableau simple et rapide. Aucun prix
// (le chiffrage est une étape du planning), aucune option superflue.
//
// La NATURE (demande / commande) vient de l'entrée de menu cliquée, poussée par
// app.js via setNature() — il n'y a pas de réglage de nature dans la fiche.
//   - Demande  → planning, colonne « Demande » (à chiffrer).
//   - Commande → planning, colonne « Commande » (validée par le client).
//
// Chargé À LA DEMANDE par app.js au premier passage sur la vue ; ensuite la
// bascule entre vues n'est qu'un changement de classe, sans saisie perdue.

// Recherches DOM CONFINÉES à la vue : le document porte aussi les autres écrans.
let ROOT = null;
const $ = (sel) => ROOT.querySelector(sel);
const $$ = (sel) => ROOT.querySelectorAll(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const ic = (name) => {
  const n = el('span', 'material-symbols-outlined', name);
  n.setAttribute('aria-hidden', 'true');
  return n;
};

// Date civile LOCALE : `toISOString()` bascule en UTC et ferait reculer
// l'échéance d'un jour à l'ouest de Greenwich (l'atelier est aux Antilles).
const todayPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let CAT = null;
let CLIENTS = [];
let uid = 0;

const state = {
  kind: 'demande',
  client: { societe: '', contact: '', telephone: '', type: 'pro' },
  articles: [],
  enBoite: false,
  maquette: true,
  facture: 'a_faire',
  deadline: '',
  sending: false,
};

const zoneById = (id) => CAT.zones.find((z) => z.id === id);
const typeById = (id) => CAT.types.find((t) => t.id === id);

function newArticle() {
  uid += 1;
  return { uid, vetement: '', ref: '', couleur: '', taille: '', quantite: 1, zones: [] };
}

const byUid = (u) => state.articles.find((a) => String(a.uid) === String(u));

// ---------------------------------------------------------------------------
// Ce qui manque pour enregistrer. null = la saisie est complète.
// ---------------------------------------------------------------------------
function missing() {
  if (!state.client.societe.trim()) return 'le nom du client';
  if (!state.articles.length) return 'au moins un article';
  for (let i = 0; i < state.articles.length; i += 1) {
    if (!state.articles[i].vetement.trim()) return `le vêtement de l'article ${i + 1}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Annuaire client — auto-complétion sur les clients déjà connus du planning.
// Taper « Igua » propose « Iguana (Discover) » avec son contact et son numéro.
// ---------------------------------------------------------------------------
const fold = (s) => String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

let autoIndex = -1;
let autoMatches = [];

function closeAuto() {
  autoIndex = -1;
  autoMatches = [];
  const list = $('#cmd-auto-list');
  list.hidden = true;
  list.replaceChildren();
  const champ = $('#cmd-societe');
  champ.setAttribute('aria-expanded', 'false');
  champ.removeAttribute('aria-activedescendant');
}

function renderAuto() {
  const list = $('#cmd-auto-list');
  list.replaceChildren();
  for (let i = 0; i < autoMatches.length; i += 1) {
    const c = autoMatches[i];
    const li = el('li', `cmd-auto__item${i === autoIndex ? ' is-on' : ''}`);
    li.id = `cmd-auto-${i}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === autoIndex));
    li.dataset.i = i;
    li.append(el('span', 'cmd-auto__name', c.nom));
    const meta = [c.contact, c.telephone].filter(Boolean).join(' · ');
    if (meta) li.append(el('span', 'cmd-auto__meta', meta));
    li.append(el('span', 'cmd-auto__n', c.commandes > 1 ? `${c.commandes} commandes` : '1 commande'));
    list.append(li);
  }
  list.hidden = autoMatches.length === 0;
  const champ = $('#cmd-societe');
  champ.setAttribute('aria-expanded', String(autoMatches.length > 0));
  if (autoIndex >= 0) champ.setAttribute('aria-activedescendant', `cmd-auto-${autoIndex}`);
  else champ.removeAttribute('aria-activedescendant');
}

function openAuto(query) {
  const q = fold(query).trim();
  if (!q) return closeAuto();
  autoMatches = CLIENTS.filter((c) => fold(c.nom).includes(q)).slice(0, 6);
  autoIndex = -1;
  renderAuto();
}

// Reprend une fiche connue : on ne remplit QUE les champs restés vides, pour ne
// jamais écraser ce que la personne vient de taper.
function pickClient(c) {
  state.client.societe = c.nom;
  if (!state.client.contact.trim() && c.contact) state.client.contact = c.contact;
  if (!state.client.telephone.trim() && c.telephone) state.client.telephone = c.telephone;
  if (c.type) state.client.type = c.type;

  $('#cmd-societe').value = state.client.societe;
  $('#cmd-contact').value = state.client.contact;
  $('#cmd-tel').value = state.client.telephone;
  closeAuto();
  render();
}

// ---------------------------------------------------------------------------
// Articles — reconstruits à chaque changement de STRUCTURE (ajout, retrait,
// zone cochée), jamais pendant la frappe (sinon le curseur saute).
// ---------------------------------------------------------------------------
function cell(role, a, value, placeholder, label, opts) {
  const n = el('input', `cmd-input cmd-cell cmd-cell--${role}`);
  n.type = (opts && opts.type) || 'text';
  n.value = value == null ? '' : value;
  n.placeholder = placeholder || '';
  n.autocomplete = 'off';
  n.dataset.role = role;
  n.dataset.uid = a.uid;
  n.setAttribute('aria-label', label);
  if (opts && opts.list) n.setAttribute('list', opts.list);
  if (opts && opts.min != null) n.min = opts.min;
  if (opts && opts.max != null) n.max = opts.max;
  if (opts && opts.inputmode) n.inputMode = opts.inputmode;
  return n;
}

function buildArticle(a, index) {
  const art = el('div', 'cmd-art');
  art.dataset.uid = a.uid;

  const row = el('div', 'cmd-art__row');
  row.append(
    cell('quantite', a, a.quantite, '1', `Quantité, article ${index + 1}`, { type: 'number', min: 1, max: 9999, inputmode: 'numeric' }),
    cell('vetement', a, a.vetement, 'T-shirt sans manches', `Vêtement, article ${index + 1}`, { list: 'cmd-dl-vetements' }),
    cell('ref', a, a.ref, 'K3022', `Référence, article ${index + 1}`),
    cell('couleur', a, a.couleur, 'Light Sand', `Couleur, article ${index + 1}`),
    cell('taille', a, a.taille, 'S', `Taille, article ${index + 1}`, { list: 'cmd-dl-tailles' }),
  );

  const tools = el('div', 'cmd-art__tools');
  const dup = el('button', 'cmd-icon');
  dup.type = 'button';
  dup.dataset.role = 'dup';
  dup.title = 'Dupliquer';
  dup.setAttribute('aria-label', `Dupliquer l'article ${index + 1}`);
  dup.append(ic('content_copy'));
  tools.append(dup);
  // Le dernier article ne se supprime pas : une saisie sans article n'existe pas.
  if (state.articles.length > 1) {
    const del = el('button', 'cmd-icon cmd-icon--danger');
    del.type = 'button';
    del.dataset.role = 'del';
    del.title = 'Retirer';
    del.setAttribute('aria-label', `Retirer l'article ${index + 1}`);
    del.append(ic('close'));
    tools.append(del);
  }
  row.append(tools);
  art.append(row);

  // Marquage : zones à cocher, chacune avec sa consigne (« Cœur : Les Doudous »).
  const mark = el('div', 'cmd-art__mark');
  const chips = el('div', 'cmd-chips');
  for (const z of CAT.zones) {
    const on = a.zones.some((x) => x.zone === z.id);
    const b = el('button', `cmd-chip${on ? ' is-on' : ''}`);
    b.type = 'button';
    b.dataset.role = 'zone';
    b.dataset.zone = z.id;
    b.setAttribute('aria-pressed', String(on));
    b.textContent = z.label;
    chips.append(b);
  }
  mark.append(chips);

  for (const z of a.zones) {
    const zone = zoneById(z.zone);
    const line = el('label', 'cmd-zline');
    line.append(el('span', 'cmd-zline__name', zone.label));
    const cons = el('input', 'cmd-input cmd-zline__cons');
    cons.type = 'text';
    cons.dataset.role = 'consigne';
    cons.dataset.uid = a.uid;
    cons.dataset.zone = z.zone;
    cons.maxLength = CAT.consigneMax;
    cons.autocomplete = 'off';
    cons.placeholder = zone.id === 'coeur' ? 'Les Doudous à SXM' : 'visuel, texte, taille…';
    cons.value = z.consigne;
    line.append(cons);
    mark.append(line);
  }
  art.append(mark);
  return art;
}

function renderArticles() {
  $('#cmd-arts').replaceChildren(...state.articles.map(buildArticle));
}

// ---------------------------------------------------------------------------
// Rendu (hors articles : ne touche à aucun champ en cours de frappe)
// ---------------------------------------------------------------------------
function render() {
  const t = typeById(state.kind);
  $('#cmd-title').textContent = t.label;
  $('#cmd-sub').textContent = t.hint;

  $('#cmd-boite').setAttribute('aria-checked', String(state.enBoite));
  $('#cmd-boite').classList.toggle('is-on', state.enBoite);
  $('#cmd-maquette').setAttribute('aria-checked', String(state.maquette));
  $('#cmd-maquette').classList.toggle('is-on', state.maquette);

  const known = CLIENTS.find((c) => fold(c.nom) === fold(state.client.societe.trim()));
  const badge = $('#cmd-client-known');
  badge.textContent = known ? `Client connu — ${known.commandes} commande${known.commandes > 1 ? 's' : ''} au planning` : '';
  badge.hidden = !known;

  const need = missing();
  const save = $('#cmd-save');
  save.disabled = state.sending;
  save.textContent = state.sending ? 'Enregistrement…' : `Enregistrer la ${t.label.toLowerCase()}`;
  save.title = need ? `Il manque ${need}` : 'Enregistrer et envoyer au planning';
}

let toastTimer;
function toast(msg) {
  const t = $('#cmd-toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 3400);
}

// ---------------------------------------------------------------------------
// Construction statique
// ---------------------------------------------------------------------------
function buildStatic() {
  const fact = $('#cmd-facture');
  for (const f of CAT.factureEtats) fact.append(new Option(f.label, f.id));
  fact.value = state.facture;

  $('#cmd-dl-vetements').replaceChildren(...CAT.vetements.map((v) => new Option(v)));
  $('#cmd-dl-tailles').replaceChildren(...CAT.tailles.map((t) => new Option(t)));

  state.deadline = todayPlus(CAT.delaiDefautJours);
  $('#cmd-deadline').value = state.deadline;

  state.articles = [newArticle()];
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------
function wire() {
  ROOT.addEventListener('click', (e) => {
    const auto = e.target.closest('.cmd-auto__item');
    if (auto) return pickClient(autoMatches[Number(auto.dataset.i)]);

    const t = e.target.closest('button');
    if (!t) return closeAuto();

    if (t.id === 'cmd-boite') { state.enBoite = !state.enBoite; return render(); }
    if (t.id === 'cmd-maquette') { state.maquette = !state.maquette; return render(); }
    if (t.id === 'cmd-add-art') {
      state.articles.push(newArticle());
      renderArticles();
      return render();
    }
    if (t.id === 'cmd-save') return submit();
    if (t.id === 'cmd-done-new') return reset();

    const host = t.closest('.cmd-art');
    if (!host) return;
    const a = byUid(host.dataset.uid);
    if (!a) return;

    if (t.dataset.role === 'del') {
      state.articles = state.articles.filter((x) => x.uid !== a.uid);
      renderArticles();
      return render();
    }
    if (t.dataset.role === 'dup') {
      // Le cas courant du comptoir : même marquage, autre taille / couleur.
      uid += 1;
      const copy = { ...a, uid, zones: a.zones.map((z) => ({ ...z })) };
      state.articles.splice(state.articles.indexOf(a) + 1, 0, copy);
      renderArticles();
      return render();
    }
    if (t.dataset.role === 'zone') {
      const id = t.dataset.zone;
      const i = a.zones.findIndex((z) => z.zone === id);
      if (i >= 0) a.zones.splice(i, 1);
      else a.zones.push({ zone: id, consigne: '' });
      // Ordre du catalogue : Cœur avant Dos, quel que soit l'ordre des clics.
      a.zones.sort((x, y) => CAT.zones.findIndex((z) => z.id === x.zone) - CAT.zones.findIndex((z) => z.id === y.zone));
      renderArticles();
      return render();
    }
  });

  ROOT.addEventListener('change', (e) => {
    if (e.target.id === 'cmd-facture') { state.facture = e.target.value; return; }
  });

  ROOT.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'cmd-societe') {
      state.client.societe = t.value;
      openAuto(t.value);
      return render();
    }
    if (t.id === 'cmd-contact') { state.client.contact = t.value; return; }
    if (t.id === 'cmd-tel') { state.client.telephone = t.value; return; }
    if (t.id === 'cmd-deadline') { state.deadline = t.value; return; }

    const a = t.dataset.uid ? byUid(t.dataset.uid) : null;
    if (!a) return;
    if (t.dataset.role === 'quantite') {
      const n = Number.parseInt(t.value, 10);
      a.quantite = Number.isInteger(n) && n > 0 ? Math.min(9999, n) : 1;
      return;
    }
    if (t.dataset.role === 'consigne') {
      const z = a.zones.find((x) => x.zone === t.dataset.zone);
      if (z) z.consigne = t.value;
      return;
    }
    if (['vetement', 'ref', 'couleur', 'taille'].includes(t.dataset.role)) {
      a[t.dataset.role] = t.value;
      if (t.dataset.role === 'vetement') render(); // (dé)verrouille « Enregistrer »
    }
  });

  // Auto-complétion au clavier : la liste se parcourt sans lâcher le champ.
  $('#cmd-societe').addEventListener('keydown', (e) => {
    if (!autoMatches.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      autoIndex += e.key === 'ArrowDown' ? 1 : -1;
      if (autoIndex >= autoMatches.length) autoIndex = 0;
      if (autoIndex < 0) autoIndex = autoMatches.length - 1;
      return renderAuto();
    }
    if (e.key === 'Enter' && autoIndex >= 0) { e.preventDefault(); return pickClient(autoMatches[autoIndex]); }
    if (e.key === 'Escape') return closeAuto();
  });
  // Le `blur` part au mousedown, le `click` de sélection au mouseup : on empêche
  // le champ de perdre le focus sur la liste plutôt que de courir après un délai.
  $('#cmd-auto-list').addEventListener('mousedown', (e) => e.preventDefault());
  $('#cmd-societe').addEventListener('blur', () => setTimeout(closeAuto, 120));

  // Échap ferme la confirmation en repartant sur une saisie vierge.
  ROOT.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#cmd-done').hidden) reset();
  });
}

// ---------------------------------------------------------------------------
// Envoi
// ---------------------------------------------------------------------------
async function submit() {
  const need = missing();
  if (need) return toast(`Il manque ${need}.`);

  state.sending = true;
  render();
  try {
    const res = await fetch('/api/commande', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: state.kind,
        client: state.client,
        articles: state.articles.map((a) => ({
          vetement: a.vetement, ref: a.ref, couleur: a.couleur, taille: a.taille,
          quantite: a.quantite,
          zones: a.zones.map((z) => ({ zone: z.zone, consigne: z.consigne })),
        })),
        enBoite: state.enBoite,
        maquette: state.maquette,
        facture: state.facture,
        deadline: state.deadline,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    showDone(data.commande);
    // Le client vient peut-être d'entrer dans l'annuaire : on le rafraîchit.
    loadClients();
  } catch (err) {
    toast(err.message || 'Enregistrement impossible — réessayez.');
  } finally {
    state.sending = false;
    render();
  }
}

function showDone(c) {
  const pieces = c.articles.reduce((s, a) => s + a.quantite, 0);
  $('#cmd-done-title').textContent = `${c.type.label} enregistrée`;
  $('#cmd-done-sub').textContent =
    `${c.client.societe} · ${c.articles.length} article${c.articles.length > 1 ? 's' : ''} (${pieces} pièce${pieces > 1 ? 's' : ''}) · au planning`;
  $('#cmd-done').hidden = false;
  $('#cmd-done-new').focus();
}

// Remet la fiche à zéro sans recharger la page. La nature reste celle de
// l'entrée de menu : on enchaîne souvent plusieurs saisies du même type.
function reset() {
  state.client = { societe: '', contact: '', telephone: '', type: 'pro' };
  state.articles = [newArticle()];
  state.enBoite = false;
  state.maquette = true;
  state.facture = 'a_faire';
  state.deadline = todayPlus(CAT.delaiDefautJours);
  state.sending = false;

  for (const id of ['cmd-societe', 'cmd-contact', 'cmd-tel']) $(`#${id}`).value = '';
  $('#cmd-facture').value = state.facture;
  $('#cmd-deadline').value = state.deadline;
  $('#cmd-done').hidden = true;
  closeAuto();
  renderArticles();
  render();
}

async function loadClients() {
  try {
    CLIENTS = await (await fetch('/api/clients')).json();
  } catch (_) {
    CLIENTS = [];   // l'annuaire n'est qu'une aide : son absence ne bloque rien
  }
}

// Nature poussée par app.js selon l'entrée de menu (#demande / #commande).
export function setNature(kind) {
  if (kind !== 'demande' && kind !== 'commande') return;
  state.kind = kind;
  if (ROOT) render();
}

// Montage unique, déclenché par app.js au premier affichage de la vue.
let mounted = false;
export async function initCommande(root) {
  if (mounted) return;
  ROOT = root;
  // Le drapeau n'est posé qu'APRÈS le catalogue : si le réseau lâche, l'erreur
  // remonte à app.js qui rouvrira la vue au prochain passage.
  CAT = await (await fetch('/api/commande/catalog')).json();
  mounted = true;
  buildStatic();
  renderArticles();
  wire();
  render();
  loadClients().then(render);
}
