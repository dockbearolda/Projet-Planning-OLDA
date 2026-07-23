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
// Base clients — auto-complétion sur les clients de la base pro (/api/clients).
// Taper « Igua » propose « Iguana (Discover) » avec son contact et son numéro.
// Un client absent de la base y est créé automatiquement à l'enregistrement.
// Forme d'un client : { entreprise, nom (contact), telephone, email, commandes }.
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
    li.append(el('span', 'cmd-auto__name', c.entreprise));
    const meta = [c.nom, c.telephone].filter(Boolean).join(' · ');
    if (meta) li.append(el('span', 'cmd-auto__meta', meta));
    // Compteur de commandes seulement s'il y en a : un client de la base pas
    // encore commandé ne doit pas afficher « 1 commande » à tort.
    if (c.commandes > 0) {
      li.append(el('span', 'cmd-auto__n', c.commandes > 1 ? `${c.commandes} commandes` : '1 commande'));
    }
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
  // On propose sur le nom de société ET le contact : « Jérôme » retrouve Iguana.
  autoMatches = CLIENTS
    .filter((c) => fold(c.entreprise).includes(q) || (c.nom && fold(c.nom).includes(q)))
    .slice(0, 6);
  autoIndex = -1;
  renderAuto();
}

// Reprend une fiche connue : on ne remplit QUE les champs restés vides, pour ne
// jamais écraser ce que la personne vient de taper. Le `type` de la base est une
// catégorie métier (Boutique, Hôtel…) qu'on ne recopie pas ; en revanche la
// NATURE pro/perso de la fiche (client_type) suit le client à sa nouvelle commande.
function pickClient(c) {
  state.client.societe = c.entreprise;
  if (!state.client.contact.trim() && c.nom) state.client.contact = c.nom;
  if (!state.client.telephone.trim() && c.telephone) state.client.telephone = c.telephone;
  if (c.client_type === 'pro' || c.client_type === 'perso') state.client.type = c.client_type;

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
// Une cellule du tableau des articles. Toujours un `text` : un `number` sort
// ses flèches au survol et refuse la frappe libre — au comptoir on clique et on
// écrit, comme dans un tableur. Le contrôle se fait à la saisie (voir wire()).
function cell(role, a, value, placeholder, label, opts) {
  const n = el('input', `cmd-input cmd-cell cmd-cell--${role}`);
  n.type = 'text';
  n.value = value == null ? '' : value;
  n.placeholder = placeholder || '';
  n.autocomplete = 'off';
  n.dataset.role = role;
  n.dataset.uid = a.uid;
  n.setAttribute('aria-label', label);
  if (opts && opts.list) n.setAttribute('list', opts.list);
  if (opts && opts.inputmode) n.inputMode = opts.inputmode;
  return n;
}

function buildArticle(a, index) {
  const art = el('div', 'cmd-art');
  art.dataset.uid = a.uid;

  const row = el('div', 'cmd-art__row');
  row.append(
    cell('quantite', a, a.quantite, '1', `Quantité, article ${index + 1}`, { inputmode: 'numeric' }),
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
    b.append(z.label);
    // Un emplacement ajouté au comptoir se retire (faute de frappe) ; ceux du
    // catalogue, jamais. Les commandes déjà enregistrées gardent leur marquage.
    if (z.custom) {
      const x = el('span', 'cmd-chip__x material-symbols-outlined', 'close');
      x.dataset.zone = z.id;
      x.title = `Retirer l'emplacement « ${z.label} »`;
      x.setAttribute('aria-hidden', 'true');
      b.append(x);
    }
    chips.append(b);
  }
  // Le catalogue ne peut pas tout prévoir : on crée l'emplacement manquant sur
  // place, il rejoint la liste de tous les postes.
  const add = el('button', 'cmd-chip cmd-chip--add');
  add.type = 'button';
  add.dataset.role = 'zone-add';
  add.setAttribute('aria-label', `Ajouter un emplacement, article ${index + 1}`);
  add.append(ic('add'), el('span', null, 'Emplacement'));
  chips.append(add);
  mark.append(chips);

  for (const z of a.zones) {
    const zone = zoneById(z.zone);
    if (!zone) continue;                 // emplacement retiré entre-temps
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
// Emplacements d'impression — le catalogue de base, plus ceux ajoutés ici.
// Tout est OPTIMISTE : la zone s'affiche et se coche tout de suite, le serveur
// suit. S'il refuse, on la retire et on le dit.
// ---------------------------------------------------------------------------
// Même règle d'identifiant que le serveur (db.js) : « Avant gauche » → avant_gauche.
const zoneSlug = (s) => fold(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// Ordre du catalogue : Cœur avant Dos, quel que soit l'ordre des clics.
const sortZones = (a) => a.zones.sort(
  (x, y) => CAT.zones.findIndex((z) => z.id === x.zone) - CAT.zones.findIndex((z) => z.id === y.zone),
);

function toggleZone(a, id) {
  const i = a.zones.findIndex((z) => z.zone === id);
  if (i >= 0) a.zones.splice(i, 1);
  else a.zones.push({ zone: id, consigne: '' });
  sortZones(a);
}

// Pose le curseur sur la consigne de la zone qu'on vient de cocher : on tape
// le visuel dans la foulée, sans repasser par la souris.
function focusConsigne(a, id) {
  const line = $(`.cmd-art[data-uid="${a.uid}"] .cmd-zline__cons[data-zone="${id}"]`);
  if (line) line.focus();
}

// Remplace un identifiant de zone par un autre dans TOUS les articles : sert à
// se raccrocher à l'identifiant que le serveur a tranché.
function remapZone(from, to) {
  for (const a of state.articles) {
    for (const z of a.zones) if (z.zone === from) z.zone = to;
    // Un doublon peut apparaître si la zone visée était déjà posée.
    a.zones = a.zones.filter((z, i) => a.zones.findIndex((y) => y.zone === z.zone) === i);
    sortZones(a);
  }
}

async function addZone(label, a) {
  const clean = String(label || '').trim().slice(0, 40);
  const id = zoneSlug(clean);
  if (!clean || !id) return;

  // Zone déjà là ? On la rapproche par identifiant ET par libellé, comme le
  // serveur : retaper « Avant gauche » coche la zone du catalogue.
  const known = CAT.zones.find((z) => z.id === id || zoneSlug(z.label) === id);
  if (known) {
    if (!a.zones.some((z) => z.zone === known.id)) toggleZone(a, known.id);
    renderArticles();
    return focusConsigne(a, known.id);
  }

  CAT.zones = [...CAT.zones, { id, label: clean, custom: true }];
  toggleZone(a, id);
  renderArticles();
  focusConsigne(a, id);

  try {
    const res = await fetch('/api/commande/zones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: clean }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.zone) throw new Error(data.error || `Erreur ${res.status}`);
    CAT.zones = data.zones;              // la base fait foi
    if (data.zone.id !== id) {
      remapZone(id, data.zone.id);
      renderArticles();
      focusConsigne(a, data.zone.id);
    }
  } catch (err) {
    CAT.zones = CAT.zones.filter((z) => z.id !== id);
    for (const art of state.articles) {
      const i = art.zones.findIndex((z) => z.zone === id);
      if (i >= 0) art.zones.splice(i, 1);
    }
    renderArticles();
    toast(`« ${clean} » non enregistré — réessayez.`);
  }
}

async function removeZone(id) {
  const before = CAT.zones;
  const beforeArticles = state.articles.map((a) => a.zones.map((z) => ({ ...z })));
  CAT.zones = CAT.zones.filter((z) => z.id !== id);
  for (const a of state.articles) {
    const i = a.zones.findIndex((z) => z.zone === id);
    if (i >= 0) a.zones.splice(i, 1);
  }
  renderArticles();

  try {
    const res = await fetch(`/api/commande/zones/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    CAT.zones = data.zones;
  } catch (err) {
    CAT.zones = before;
    state.articles.forEach((a, i) => { a.zones = beforeArticles[i]; });
    renderArticles();
    toast('Emplacement non retiré — réessayez.');
  }
}

// Saisie du nom : la puce « + Emplacement » devient un champ, sur place.
// Entrée valide, Échap (ou la perte du focus) annule.
function openZoneInput(btn, a) {
  const input = el('input', 'cmd-input cmd-chip cmd-chip--new');
  input.type = 'text';
  input.maxLength = 40;
  input.placeholder = 'Nom de l\'emplacement';
  input.setAttribute('aria-label', 'Nom du nouvel emplacement');
  input.autocomplete = 'off';
  btn.replaceWith(input);
  input.focus();

  const close = () => { if (input.isConnected) input.replaceWith(btn); };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addZone(input.value, a); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
}

// ---------------------------------------------------------------------------
// Rendu (hors articles : ne touche à aucun champ en cours de frappe)
// ---------------------------------------------------------------------------
function render() {
  const t = typeById(state.kind);
  $('#cmd-title').textContent = t.label;
  $('#cmd-sub').textContent = t.hint;

  // Nature pro / perso : segmented + adapte le libellé du champ « société ».
  const perso = state.client.type === 'perso';
  for (const b of $$('#cmd-nature .cmd-seg__btn')) {
    const on = b.dataset.nature === state.client.type;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  }
  $('#cmd-societe-label').textContent = perso ? 'Client — nom du particulier' : 'Client — société / marque';
  $('#cmd-societe').placeholder = perso ? 'Marie Dupont' : 'Iguana (Discover)';

  $('#cmd-boite').setAttribute('aria-checked', String(state.enBoite));
  $('#cmd-boite').classList.toggle('is-on', state.enBoite);
  $('#cmd-maquette').setAttribute('aria-checked', String(state.maquette));
  $('#cmd-maquette').classList.toggle('is-on', state.maquette);

  const known = CLIENTS.find((c) => fold(c.entreprise) === fold(state.client.societe.trim()));
  const badge = $('#cmd-client-known');
  const n = known ? (known.commandes || 0) : 0;
  badge.textContent = known
    ? (n > 0 ? `Client connu — ${n} commande${n > 1 ? 's' : ''} au planning` : 'Client connu — base pro')
    : '';
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

    // La croix d'un emplacement ajouté : elle vit DANS la puce, on la traite
    // avant le clic de la puce (qui, lui, coche / décoche).
    const x = e.target.closest('.cmd-chip__x');
    if (x) return removeZone(x.dataset.zone);

    const t = e.target.closest('button');
    if (!t) return closeAuto();

    if (t.dataset.nature) { state.client.type = t.dataset.nature; return render(); }
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
    if (t.dataset.role === 'zone-add') return openZoneInput(t, a);
    if (t.dataset.role === 'zone') {
      const id = t.dataset.zone;
      const posee = a.zones.some((z) => z.zone === id);
      toggleZone(a, id);
      renderArticles();
      if (!posee) focusConsigne(a, id);   // cochée : on enchaîne sur la consigne
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
      // Champ texte : on filtre les chiffres à la frappe (pas de flèches, pas
      // de « e » ni de moins). On ne réécrit la valeur QUE si elle change,
      // sinon le curseur saute en fin de champ à chaque touche.
      const digits = t.value.replace(/\D+/g, '').replace(/^0+(?=\d)/, '').slice(0, 4);
      if (digits !== t.value) t.value = digits;
      const n = Number.parseInt(digits, 10);
      a.quantite = Number.isInteger(n) && n > 0 ? n : 1;
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

  wireCells();
}

// ---------------------------------------------------------------------------
// Le tableau des articles se tient au clavier comme un tableur : on clique, la
// cellule est sélectionnée, on écrit par-dessus ; Entrée ou ↓ descendent d'une
// ligne (et en créent une au bout), ↑ remonte. Tab reste le déplacement natif
// d'une colonne à l'autre.
// ---------------------------------------------------------------------------
function cellAt(article, role) {
  return $(`.cmd-art[data-uid="${article.uid}"] .cmd-cell--${role}`);
}

function moveCell(from, step) {
  const role = from.dataset.role;
  const i = state.articles.findIndex((a) => String(a.uid) === String(from.dataset.uid));
  if (i < 0) return;
  let j = i + step;
  if (j < 0) return;
  if (j >= state.articles.length) {
    // Entrée sur la dernière ligne : on en ouvre une nouvelle, comme un tableur.
    state.articles.push(newArticle());
    renderArticles();
    render();
    j = state.articles.length - 1;
  }
  const next = cellAt(state.articles[j], role);
  if (next) { next.focus(); next.select(); }
}

function wireCells() {
  // Le focus sélectionne la cellule entière ; encore faut-il que le clic ne la
  // désélectionne pas juste après. On annule donc le `mouseup` — SAUF si la
  // cellule était déjà active (deuxième clic : on vise un endroit précis) ou si
  // le pointeur a glissé (l'utilisateur sélectionne un morceau à la main).
  let reclick = false;
  let downAt = null;
  ROOT.addEventListener('pointerdown', (e) => {
    const c = e.target.closest && e.target.closest('.cmd-cell');
    reclick = !!c && document.activeElement === c;
    downAt = c ? { x: e.clientX, y: e.clientY } : null;
  });
  ROOT.addEventListener('mouseup', (e) => {
    const c = e.target.closest && e.target.closest('.cmd-cell');
    if (!c || reclick || !downAt) return;
    const glisse = Math.abs(e.clientX - downAt.x) > 4 || Math.abs(e.clientY - downAt.y) > 4;
    if (!glisse) e.preventDefault();
  });
  ROOT.addEventListener('focusin', (e) => {
    if (e.target.classList && e.target.classList.contains('cmd-cell')) e.target.select();
  });
  // Quantité vidée puis quittée : on réaffiche celle qui fait foi (jamais de
  // case vide dans une commande).
  ROOT.addEventListener('focusout', (e) => {
    const t = e.target;
    if (!t.dataset || t.dataset.role !== 'quantite' || t.value !== '') return;
    const a = byUid(t.dataset.uid);
    if (a) t.value = a.quantite;
  });

  ROOT.addEventListener('keydown', (e) => {
    const c = e.target.closest && e.target.closest('.cmd-cell');
    if (!c) return;
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); moveCell(c, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveCell(c, -1); }
    else if (e.key === 'Escape') c.blur();
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
