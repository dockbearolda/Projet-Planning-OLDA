// Prise de commande — Atelier OLDA
// La saisie d'un besoin client reçu au téléphone ou par mail. Deux choses la
// distinguent de la Commande Express (comptoir, tasse, tarif) :
//   - on tranche DEMANDE (à chiffrer) ou COMMANDE (validée) dès la 1re ligne ;
//   - on saisit N articles, chacun avec ses zones d'impression et leur consigne
//     (« Cœur : Les Doudous à SXM »).
// Aucun prix ici : le chiffrage est une étape du pipeline, pas de la prise.
//
// Ce module est chargé À LA DEMANDE par app.js, au premier passage sur la vue.
// Une fois monté, basculer d'une vue à l'autre n'est qu'un changement de classe
// — aucun rechargement, aucune saisie perdue.

// Toutes les recherches DOM restent CONFINÉES à la vue : le document porte
// aussi le planning, le dashboard et la Commande Express.
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
  client: { societe: '', contact: '', telephone: '', email: '', type: 'pro' },
  articles: [],
  enBoite: false,
  maquette: true,
  facture: 'a_faire',
  remarque: '',
  deadline: '',
  deadlineTouched: false,
  priority: 1,
  vendeuse: '',
  referent: 'À attribuer',
  sending: false,
};

const zoneById = (id) => CAT.zones.find((z) => z.id === id);
const techById = (id) => CAT.techniques.find((t) => t.id === id);
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
    if (!state.articles[i].vetement.trim()) return `le type de vêtement de l'article ${i + 1}`;
  }
  if (!state.deadline) return 'la date souhaitée';
  return null;
}

// ---------------------------------------------------------------------------
// Annuaire client — auto-complétion sur les clients déjà connus du planning.
// Taper « Igua » propose « Iguana (Discover) » avec son contact et son
// téléphone : on ne resaisit pas un client connu, et on n'en crée pas un
// doublon mal orthographié.
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
  // Sans aria-activedescendant, un lecteur d'écran n'annonce rien quand on
  // parcourt les suggestions aux flèches : le focus, lui, ne bouge pas.
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

// Reprend une fiche connue : on ne remplace QUE les champs restés vides, pour
// ne jamais écraser ce que la personne vient de taper.
function pickClient(c) {
  state.client.societe = c.nom;
  if (!state.client.contact.trim() && c.contact) state.client.contact = c.contact;
  if (!state.client.telephone.trim() && c.telephone) state.client.telephone = c.telephone;
  if (!state.client.email.trim() && c.email) state.client.email = c.email;
  if (c.type) state.client.type = c.type;

  $('#cmd-societe').value = state.client.societe;
  $('#cmd-contact').value = state.client.contact;
  $('#cmd-tel').value = state.client.telephone;
  $('#cmd-email').value = state.client.email;
  $('#cmd-type').value = state.client.type;
  closeAuto();
  render();
}

// ---------------------------------------------------------------------------
// Articles — reconstruits à chaque changement de STRUCTURE (ajout, retrait,
// zone cochée), jamais pendant la frappe (sinon le curseur saute).
// ---------------------------------------------------------------------------
function labelled(label, node, cls) {
  const f = el('div', `cmd-field${cls ? ` ${cls}` : ''}`);
  const l = el('label', 'cmd-label', label);
  l.htmlFor = node.id;
  f.append(l, node);
  return f;
}

let fieldSeq = 0;
function input(role, a, value, placeholder, opts) {
  const n = el('input', 'cmd-input');
  fieldSeq += 1;
  n.id = `cmd-f${fieldSeq}`;
  n.type = (opts && opts.type) || 'text';
  n.value = value == null ? '' : value;
  n.placeholder = placeholder || '';
  n.autocomplete = 'off';
  n.dataset.role = role;
  n.dataset.uid = a.uid;
  if (opts && opts.list) n.setAttribute('list', opts.list);
  if (opts && opts.min != null) n.min = opts.min;
  if (opts && opts.max != null) n.max = opts.max;
  return n;
}

function buildArticle(a, index) {
  const art = el('article', 'cmd-art');
  art.dataset.uid = a.uid;

  const head = el('div', 'cmd-art__head');
  head.append(el('span', 'cmd-art__n', `Article ${index + 1}`));
  const tools = el('div', 'cmd-art__tools');

  const dup = el('button', 'cmd-icon');
  dup.type = 'button';
  dup.dataset.role = 'dup';
  dup.title = 'Dupliquer cet article';
  dup.setAttribute('aria-label', `Dupliquer l'article ${index + 1}`);
  dup.append(ic('content_copy'));
  tools.append(dup);

  // Le dernier article ne se supprime pas : une commande sans article n'existe pas.
  if (state.articles.length > 1) {
    const del = el('button', 'cmd-icon cmd-icon--danger');
    del.type = 'button';
    del.dataset.role = 'del';
    del.title = 'Retirer cet article';
    del.setAttribute('aria-label', `Retirer l'article ${index + 1}`);
    del.append(ic('close'));
    tools.append(del);
  }
  head.append(tools);
  art.append(head);

  const grid = el('div', 'cmd-art__grid');
  grid.append(
    labelled('Type de vêtement', input('vetement', a, a.vetement, 'T-shirt sans manches', { list: 'cmd-dl-vetements' }), 'cmd-field--wide'),
    labelled('Référence', input('ref', a, a.ref, 'K3022')),
    labelled('Couleur', input('couleur', a, a.couleur, 'Light Sand')),
    labelled('Taille', input('taille', a, a.taille, 'S', { list: 'cmd-dl-tailles' })),
    labelled('Quantité', input('quantite', a, a.quantite, '1', { type: 'number', min: 1, max: 9999 }), 'cmd-field--qty'),
  );
  art.append(grid);

  const zwrap = el('div', 'cmd-zones');
  zwrap.append(el('span', 'cmd-label', 'Zones d\'impression / broderie'));
  const chips = el('div', 'cmd-chips');
  for (const z of CAT.zones) {
    const on = a.zones.some((x) => x.zone === z.id);
    const b = el('button', `cmd-chip${on ? ' is-on' : ''}`);
    b.type = 'button';
    b.dataset.role = 'zone';
    b.dataset.zone = z.id;
    b.setAttribute('aria-pressed', String(on));
    b.append(el('span', null, z.label));
    chips.append(b);
  }
  zwrap.append(chips);

  for (const z of a.zones) {
    const zone = zoneById(z.zone);
    const row = el('div', 'cmd-zrow');
    row.append(el('span', 'cmd-zrow__name', zone.label));

    const tech = el('select', 'cmd-input cmd-select cmd-zrow__tech');
    tech.dataset.role = 'tech';
    tech.dataset.uid = a.uid;
    tech.dataset.zone = z.zone;
    tech.setAttribute('aria-label', `Technique pour ${zone.label}`);
    for (const t of CAT.techniques) tech.append(new Option(t.label, t.id));
    tech.value = z.technique;

    const cons = el('input', 'cmd-input cmd-zrow__cons');
    cons.type = 'text';
    cons.dataset.role = 'consigne';
    cons.dataset.uid = a.uid;
    cons.dataset.zone = z.zone;
    cons.maxLength = CAT.consigneMax;
    cons.autocomplete = 'off';
    cons.placeholder = zone.id === 'coeur' ? 'Les Doudous à SXM — 6 cm' : 'Visuel, texte, taille…';
    cons.setAttribute('aria-label', `Consigne pour ${zone.label}`);
    cons.value = z.consigne;

    row.append(tech, cons);
    zwrap.append(row);
  }

  art.append(zwrap);
  return art;
}

function renderArticles() {
  $('#cmd-arts').replaceChildren(...state.articles.map(buildArticle));
}

// ---------------------------------------------------------------------------
// Aperçu — miroir du résumé construit par le serveur, pour que la personne qui
// saisit voie EXACTEMENT ce qui atterrira dans la colonne « Infos » du planning.
// ---------------------------------------------------------------------------
function recapText() {
  const t = typeById(state.kind);
  const c = state.client;
  const lignes = state.articles.map((a) => {
    const id = [a.ref && `réf. ${a.ref}`, a.couleur, a.taille && `taille ${a.taille}`]
      .filter(Boolean).join(' · ');
    const tete = `• ${a.quantite} × ${a.vetement || '…'}${id ? ` — ${id}` : ''}`;
    const zs = a.zones.map((z) => {
      const tech = z.technique === 'a_definir' ? '' : ` [${techById(z.technique).label}]`;
      return `   ↳ ${zoneById(z.zone).label}${tech}${z.consigne.trim() ? ` : ${z.consigne.trim()}` : ''}`;
    });
    return [tete, ...zs].join('\n');
  });
  const facture = CAT.factureEtats.find((f) => f.id === state.facture);
  const etats = [
    `Article en boîte : ${state.enBoite ? 'oui' : 'non'}`,
    state.maquette ? 'Maquette à faire' : 'Maquette : non',
    `Facture : ${facture.label.toLowerCase()}`,
  ].join(' · ');
  return [
    `${t.label.toUpperCase()} — ${c.societe || '…'}${c.contact ? ` (${c.contact})` : ''}`,
    ...lignes,
    etats,
    ...(state.remarque.trim() ? [`Remarque : ${state.remarque.trim()}`] : []),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Rendu (hors articles : ne touche à aucun champ en cours de frappe)
// ---------------------------------------------------------------------------
function render() {
  for (const b of $$('#cmd-nature .cmd-nature__opt')) {
    const on = b.dataset.kind === state.kind;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  }
  const t = typeById(state.kind);
  $('#cmd-sub').textContent = `${t.label} — ${t.hint}`;

  for (const b of $$('#cmd-priority .cmd-star')) {
    const on = Number(b.dataset.v) <= state.priority;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(Number(b.dataset.v) === state.priority));
  }

  $('#cmd-boite').setAttribute('aria-checked', String(state.enBoite));
  $('#cmd-boite').classList.toggle('is-on', state.enBoite);
  $('#cmd-maquette').setAttribute('aria-checked', String(state.maquette));
  $('#cmd-maquette').classList.toggle('is-on', state.maquette);

  const n = state.articles.length;
  const pieces = state.articles.reduce((s, a) => s + (Number(a.quantite) || 0), 0);
  $('#cmd-art-count').textContent = n === 1 ? `1 article · ${pieces} pièce${pieces > 1 ? 's' : ''}` : `${n} articles · ${pieces} pièces`;

  const hint = $('#cmd-delai-hint');
  hint.textContent = state.deadlineTouched
    ? ''
    : `Par défaut : ${CAT.delaiDefautJours} jours.`;
  hint.hidden = state.deadlineTouched;

  const known = CLIENTS.find((c) => fold(c.nom) === fold(state.client.societe.trim()));
  const badge = $('#cmd-client-known');
  badge.textContent = known ? `Client connu — ${known.commandes} commande${known.commandes > 1 ? 's' : ''} au planning` : '';
  badge.hidden = !known;

  $('#cmd-recap').textContent = recapText();

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
  const nature = $('#cmd-nature');
  for (const t of CAT.types) {
    const b = el('button', 'cmd-nature__opt');
    b.type = 'button';
    b.dataset.kind = t.id;
    b.setAttribute('role', 'radio');
    b.append(ic(t.id === 'demande' ? 'help' : 'task_alt'));
    const body = el('span', 'cmd-nature__body');
    body.append(el('span', 'cmd-nature__label', t.label), el('span', 'cmd-nature__hint', t.hint));
    b.append(body);
    nature.append(b);
  }

  const type = $('#cmd-type');
  for (const c of CAT.clientTypes) type.append(new Option(c.charAt(0).toUpperCase() + c.slice(1), c));
  type.value = state.client.type;

  const fact = $('#cmd-facture');
  for (const f of CAT.factureEtats) fact.append(new Option(f.label, f.id));
  fact.value = state.facture;

  const vend = $('#cmd-vendeuse');
  for (const v of CAT.employes) vend.append(new Option(v, v));
  state.vendeuse = CAT.employes[0];
  vend.value = state.vendeuse;

  const ref = $('#cmd-referent');
  for (const v of CAT.employes) ref.append(new Option(v, v));
  ref.value = CAT.employes.includes('À attribuer') ? 'À attribuer' : CAT.employes[0];
  state.referent = ref.value;

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

    if (t.dataset.kind) { state.kind = t.dataset.kind; return render(); }
    if (t.dataset.v) { state.priority = Number(t.dataset.v); return render(); }
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
      // Le cas courant du mail d'atelier : le même marquage sur une autre
      // taille / couleur. On duplique tout, la personne corrige la variante.
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
      else a.zones.push({ zone: id, technique: CAT.techniques[0].id, consigne: '' });
      // On garde l'ordre du catalogue : Cœur avant Dos, quel que soit l'ordre des clics.
      a.zones.sort((x, y) => CAT.zones.findIndex((z) => z.id === x.zone) - CAT.zones.findIndex((z) => z.id === y.zone));
      renderArticles();
      return render();
    }
  });

  ROOT.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'cmd-type') { state.client.type = t.value; return; }
    if (t.id === 'cmd-facture') { state.facture = t.value; return render(); }
    if (t.id === 'cmd-vendeuse') { state.vendeuse = t.value; return; }
    if (t.id === 'cmd-referent') { state.referent = t.value; return; }
    if (t.dataset.role === 'tech') {
      const a = byUid(t.dataset.uid);
      const z = a && a.zones.find((x) => x.zone === t.dataset.zone);
      if (z) z.technique = t.value;
      return render();
    }
  });

  ROOT.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'cmd-societe') {
      state.client.societe = t.value;
      openAuto(t.value);
      return render();
    }
    if (t.id === 'cmd-contact') { state.client.contact = t.value; return render(); }
    if (t.id === 'cmd-tel') { state.client.telephone = t.value; return; }
    if (t.id === 'cmd-email') { state.client.email = t.value; return; }
    if (t.id === 'cmd-remarque') { state.remarque = t.value; return render(); }
    if (t.id === 'cmd-deadline') { state.deadline = t.value; state.deadlineTouched = true; return render(); }

    const a = t.dataset.uid ? byUid(t.dataset.uid) : null;
    if (!a) return;
    if (t.dataset.role === 'quantite') {
      const n = Number.parseInt(t.value, 10);
      a.quantite = Number.isInteger(n) && n > 0 ? Math.min(9999, n) : 1;
      return render();
    }
    if (t.dataset.role === 'consigne') {
      const z = a.zones.find((x) => x.zone === t.dataset.zone);
      if (z) z.consigne = t.value;
      return render();
    }
    if (['vetement', 'ref', 'couleur', 'taille'].includes(t.dataset.role)) {
      a[t.dataset.role] = t.value;
      return render();
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
  // Le `blur` du champ part au MOUSEDOWN, alors que le `click` qui choisit la
  // suggestion n'arrive qu'au mouseup : un appui un peu appuyé (> 120 ms, très
  // courant) fermait la liste avant d'avoir été cliquée. On empêche donc le
  // champ de perdre le focus sur la liste — plus de course, plus de délai.
  $('#cmd-auto-list').addEventListener('mousedown', (e) => e.preventDefault());
  $('#cmd-societe').addEventListener('blur', () => setTimeout(closeAuto, 120));

  // Échap ferme la confirmation en repartant sur une saisie vierge — le seul
  // geste qui ait un sens une fois la commande partie au planning.
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
          zones: a.zones.map((z) => ({ zone: z.zone, technique: z.technique, consigne: z.consigne })),
        })),
        enBoite: state.enBoite,
        maquette: state.maquette,
        facture: state.facture,
        remarque: state.remarque,
        deadline: state.deadline,
        priority: state.priority,
        vendeuse: state.vendeuse,
        referent: state.referent,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    showDone(data.commande);
    // Le client vient peut-être d'entrer dans l'annuaire : on le rafraîchit pour
    // que la saisie suivante le propose déjà.
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
    `${c.client.societe} · ${c.articles.length} article${c.articles.length > 1 ? 's' : ''} (${pieces} pièce${pieces > 1 ? 's' : ''}) · pour le ${c.deadline.split('-').reverse().join('/')}`;
  $('#cmd-done').hidden = false;
  // Le geste suivant est toujours « saisie suivante » : on y pose le focus pour
  // que le clavier enchaîne sans chercher, et que le lecteur d'écran annonce
  // la confirmation.
  $('#cmd-done-new').focus();
}

// Remet la vue à zéro sans recharger la page. La nature, la personne qui saisit
// et le référent restent en place : on enchaîne souvent plusieurs saisies.
function reset() {
  state.client = { societe: '', contact: '', telephone: '', email: '', type: 'pro' };
  state.articles = [newArticle()];
  state.enBoite = false;
  state.maquette = true;
  state.facture = 'a_faire';
  state.remarque = '';
  state.priority = 1;
  state.deadlineTouched = false;
  state.deadline = todayPlus(CAT.delaiDefautJours);
  state.sending = false;

  for (const id of ['cmd-societe', 'cmd-contact', 'cmd-tel', 'cmd-email', 'cmd-remarque']) $(`#${id}`).value = '';
  $('#cmd-type').value = state.client.type;
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

// Montage unique, déclenché par app.js au premier affichage de la vue.
let mounted = false;
export async function initCommande(root) {
  if (mounted) return;
  ROOT = root;
  // Le drapeau n'est posé qu'APRÈS le catalogue : si le réseau lâche, l'erreur
  // remonte à app.js qui rouvrira la vue au prochain passage. Le poser avant
  // condamnait l'écran jusqu'au rechargement de la page.
  CAT = await (await fetch('/api/commande/catalog')).json();
  mounted = true;
  buildStatic();
  renderArticles();
  wire();
  render();
  loadClients().then(render);
}
