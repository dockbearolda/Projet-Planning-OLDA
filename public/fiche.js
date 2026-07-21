// Commande Express — Atelier OLDA
// Un seul état, un seul rendu. Le prix se recalcule localement à chaque geste ;
// le serveur ne voit la fiche qu'à l'enregistrement, et refait le calcul.

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const eur = (n) => `${n.toFixed(2).replace('.', ',')} €`;
const euro = (n) => Math.round(n * 100) / 100;
const todayPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const DAY = 86400000;
function daysUntil(day) {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = day.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - today) / DAY);
}

// Menu : les trois écrans qui existent, rien d'autre.
const NAV = [
  { icon: 'grid_view', label: 'Planning', href: '/#planning' },
  { icon: 'speed', label: 'Dashboard', href: '/#dashboard' },
  { icon: 'bolt', label: 'Commande Express', href: '/fiche', active: true },
];

let CAT = null;
let uid = 0;
const state = {
  prenom: '', nom: '', whatsapp: '',
  priority: 1,
  product: null, color: null, quantity: 1,
  elements: [],
  delai: null, deadline: '', heure: '15:00', deadlineTouched: false,
  paiementMode: null, paiementStatut: null,
  vendeuse: '', referent: '', stage: 'demande',
  sending: false,
};

const optionById = (id) => CAT.options.find((o) => o.id === id);
const faceById = (id) => CAT.faces.find((f) => f.id === id);
const placementById = (id) => CAT.placements.find((p) => p.id === id);
const tailleById = (id) => CAT.tailles.find((t) => t.id === id);
const encreById = (id) => CAT.encres.find((e) => e.id === id);
const logoByRef = (ref) => CAT.logosOlda.find((l) => l.ref === ref);

// L'option réellement facturée : le logo OLDA vaut 6 € sur un flanc et 2 € sous
// la tasse, c'est la face qui tranche. Même règle que le serveur.
function resolvedOption(e) {
  const face = faceById(e.face);
  return optionById(e.option === 'logo_olda' ? face.logoOption : e.option);
}

function newElement(face) {
  uid += 1;
  return {
    uid, face, option: 'aucune',
    texte: '', typo: CAT.typos[0].id, encre: 'noir',
    logo: null, placement: 'centre', taille: 'moyenne', remarque: '',
  };
}

// ---------------------------------------------------------------------------
// Prix — miroir exact de buildFiche() côté serveur.
// ---------------------------------------------------------------------------
function rateFor() {
  if (!state.delai) return 0;
  if (state.delai.rate !== null && state.delai.rate !== undefined) return state.delai.rate;
  const d = state.deadline ? daysUntil(state.deadline) : 7;
  if (d <= 0) return 0.2;
  if (d < 3) return 0.1;
  return 0;
}

function compute() {
  const base = state.product ? state.product.price : 0;
  const used = state.elements.filter((e) => e.option !== 'aucune');
  const perso = used.reduce((s, e) => s + resolvedOption(e).price, 0);
  const produit = euro(base * state.quantity);
  const personnalisation = euro(perso * state.quantity);
  const sousTotal = euro(produit + personnalisation);
  const rate = rateFor();
  const supplement = euro(sousTotal * rate);
  return { produit, personnalisation, sousTotal, rate, supplement, total: euro(sousTotal + supplement) };
}

// Ce qui manque pour enregistrer. null = la fiche est complète.
function missing() {
  if (!state.prenom.trim() && !state.nom.trim()) return 'le nom du client';
  const used = state.elements.filter((e) => e.option !== 'aucune');
  if (!used.length) return 'au moins une personnalisation';
  for (const e of used) {
    const face = faceById(e.face);
    const opt = resolvedOption(e);
    if (opt.needs === 'texte') {
      if (!e.texte.trim()) return `le texte de ${face.label}`;
      if (e.texte.length > CAT.texteMax) return `un texte plus court sur ${face.label} (${CAT.texteMax} max)`;
    }
    if (opt.needs === 'logo_olda' && !e.logo) return `le visuel de ${face.label}`;
    if (opt.needs === 'logo_client' && !String(e.logo || '').trim()) return `le fichier client de ${face.label}`;
  }
  if (!state.deadline) return 'la date promise';
  return null;
}

// ---------------------------------------------------------------------------
// Dessin de la tasse. Fond en SVG, contenu imprimé en HTML par-dessus : le
// texte se répartit tout seul sur plusieurs lignes et reprend la vraie police.
// ---------------------------------------------------------------------------
const MUG_ZONES = {
  side: { left: 52, top: 54, width: 106, height: 88 },
  none: { left: 58, top: 64, width: 94, height: 66 },
};
const MUG_STROKE = '#cfd6e2';

function mugSvg(handle) {
  const root = svg('svg', { viewBox: '0 0 210 190', 'aria-hidden': 'true' });

  if (handle === 'none') {
    // Vue de dessous : un simple disque.
    root.append(
      svg('circle', { cx: 105, cy: 96, r: 68, fill: '#fff', stroke: MUG_STROKE, 'stroke-width': 2 }),
      svg('circle', { cx: 105, cy: 96, r: 56, fill: 'none', stroke: '#eef1f6', 'stroke-width': 2 }),
    );
    return root;
  }

  const anse = handle === 'right'
    ? 'M166 64 C198 64 202 80 202 96 C202 112 198 128 166 128'
    : 'M44 64 C12 64 8 80 8 96 C8 112 12 128 44 128';
  root.append(
    svg('path', { d: anse, fill: 'none', stroke: MUG_STROKE, 'stroke-width': 9, 'stroke-linecap': 'round' }),
    svg('path', {
      d: 'M45 32 L45 150 Q45 174 105 174 Q165 174 165 150 L165 32 Z',
      fill: '#fff', stroke: MUG_STROKE, 'stroke-width': 2,
    }),
    svg('ellipse', { cx: 105, cy: 32, rx: 60, ry: 12, fill: '#fff', stroke: MUG_STROKE, 'stroke-width': 2 }),
    svg('ellipse', { cx: 105, cy: 32, rx: 49, ry: 8, fill: '#f2f5f9' }),
  );
  return root;
}

function renderMugs() {
  const host = $('#mugs');
  host.replaceChildren();

  // Face 1 et Face 2 sont toujours montrées ; le dessous n'apparaît que s'il
  // porte quelque chose (sinon on afficherait un disque vide en permanence).
  const shown = CAT.faces.filter((f) => (
    f.id !== 'dessous' || state.elements.some((e) => e.face === f.id && e.option !== 'aucune')
  ));

  for (const face of shown) {
    const wrap = el('div', 'mug');
    const label = el('p', 'mug__label');
    label.append(el('span', 'mug__name', face.label.toUpperCase()), el('span', 'mug__hint', `(${face.hint})`));

    const scene = el('div', 'mug__scene');
    scene.append(mugSvg(face.handle));

    const z = MUG_ZONES[face.handle === 'none' ? 'none' : 'side'];
    const zone = el('div', 'mug__zone');
    Object.assign(zone.style, {
      left: `${z.left}px`, top: `${z.top}px`, width: `${z.width}px`, height: `${z.height}px`,
    });

    const stack = el('div', 'mug__stack');
    for (const e of state.elements.filter((x) => x.face === face.id && x.option !== 'aucune')) {
      const opt = resolvedOption(e);
      const scale = tailleById(e.taille).scale;
      const item = el('div', `mug__el mug__el--${placementById(e.placement).id}`);
      if (opt.needs === 'texte') {
        item.textContent = e.texte;
        item.style.fontFamily = CAT.typos.find((t) => t.id === e.typo).css;
        item.style.color = encreById(e.encre).hex;
        item.style.fontSize = `${Math.round(15 * scale)}px`;
      } else if (opt.needs === 'logo_olda') {
        const logo = logoByRef(e.logo);
        if (logo) {
          const img = el('img');
          img.src = logo.src;
          img.alt = '';
          img.style.width = `${Math.round(72 * scale)}px`;
          item.append(img);
        }
      } else {
        item.textContent = e.logo || 'fichier client';
        item.style.fontSize = `${Math.round(12 * scale)}px`;
        item.style.color = '#5b6b85';
      }
      stack.append(item);
    }
    if (!stack.childElementCount) {
      stack.append(el('div', 'mug__el mug__el--centre mug__el--vide', 'Aucun visuel'));
    }
    zone.append(stack);
    scene.append(zone);
    wrap.append(label, scene);
    host.append(wrap);
  }
}

// ---------------------------------------------------------------------------
// Panneaux de face. Reconstruits quand le visuel change, jamais pendant la
// frappe (sinon le curseur saute).
// ---------------------------------------------------------------------------
// Valeur du menu « choix du visuel » : un logo OLDA porte sa référence.
const visualValue = (e) => (e.option === 'logo_olda' ? `olda:${e.logo || ''}` : e.option);

function visualSelect(e) {
  const sel = el('select', 'select');
  sel.dataset.role = 'visual';
  sel.dataset.uid = e.uid;
  sel.append(new Option('Aucun visuel', 'aucune'));

  const gOlda = el('optgroup');
  gOlda.label = 'Visuels OLDA';
  for (const l of CAT.logosOlda) gOlda.append(new Option(`${l.ref} — ${l.label}`, `olda:${l.ref}`));
  sel.append(gOlda);

  const gAutre = el('optgroup');
  gAutre.label = 'Personnalisé';
  for (const id of ['texte', 'logo_client_vecto', 'logo_client_reprise']) {
    gAutre.append(new Option(optionById(id).label, id));
  }
  sel.append(gAutre);

  sel.value = visualValue(e);
  return sel;
}

let fieldSeq = 0;
function labelled(label, node) {
  const f = el('div', 'field');
  fieldSeq += 1;
  node.id = `fld-${fieldSeq}`;
  const l = el('label', 'field__label', label);
  l.htmlFor = node.id;
  f.append(l, node);
  return f;
}

function selectOf(list, value, role, uidv) {
  const s = el('select', 'select');
  s.dataset.role = role;
  s.dataset.uid = uidv;
  for (const o of list) s.append(new Option(o.label, o.id));
  s.value = value;
  return s;
}

function buildPanel(e, index) {
  const face = faceById(e.face);
  const opt = resolvedOption(e);
  const panel = el('section', 'panel');
  panel.dataset.uid = e.uid;

  const head = el('div', 'panel__head');
  head.append(el('span', 'ms', 'crop_square'), el('span', 'panel__name', `${face.label} — ${face.hint}`));
  // Les 2 premiers panneaux sont les faces fixes de la tasse ; seuls les
  // éléments ajoutés ensuite peuvent être retirés ou déplacés.
  const extra = index >= 2;
  if (extra) {
    const drop = el('button', 'panel__drop');
    drop.type = 'button';
    drop.dataset.role = 'remove';
    drop.title = 'Retirer cet élément';
    drop.setAttribute('aria-label', `Retirer l'élément sur ${face.label}`);
    drop.append(el('span', 'ms', 'close'));
    head.append(drop);
  }
  panel.append(head);

  if (extra) panel.append(labelled('Emplacement sur la tasse', selectOf(CAT.faces, e.face, 'face', e.uid)));
  panel.append(labelled('Choix du visuel', visualSelect(e)));

  if (opt.id === 'aucune') return panel;

  if (opt.needs === 'logo_olda') {
    const cols = el('div', 'panel__cols');
    const left = el('div');
    const row = el('div', 'panel__row');
    row.append(
      labelled('Emplacement sur la face', selectOf(CAT.placements, e.placement, 'placement', e.uid)),
      labelled('Taille', selectOf(CAT.tailles, e.taille, 'taille', e.uid)),
    );
    left.append(row);

    const logo = logoByRef(e.logo);
    const fig = el('figure', 'thumb');
    if (logo) {
      const img = el('img');
      img.src = logo.src;
      img.alt = `Visuel ${logo.ref}`;
      fig.append(img, el('figcaption', null, logo.ref));
    }
    cols.append(left, fig);
    panel.append(cols);

    if (logo) {
      const ok = el('div', 'ok');
      ok.append(el('span', 'ms', 'check_circle'), el('span', null, `Visuel sélectionné : ${logo.ref} — ${logo.label}`));
      panel.append(ok);
    }
  } else if (opt.needs === 'texte') {
    const ta = el('textarea', 'input');
    ta.dataset.role = 'texte';
    ta.dataset.uid = e.uid;
    ta.maxLength = CAT.texteMax;
    ta.placeholder = 'Texte à imprimer';
    ta.value = e.texte;
    const field = labelled('Texte à inscrire', ta);
    const count = el('span', 'count', `${e.texte.length} / ${CAT.texteMax}`);
    count.dataset.count = e.uid;
    field.append(count);
    panel.append(field);

    const sw = el('div', 'swatches');
    sw.dataset.uid = e.uid;
    for (const c of CAT.encres) {
      const b = el('button', `swatch${c.id === e.encre ? ' is-on' : ''}`);
      b.type = 'button';
      b.dataset.role = 'encre';
      b.dataset.encre = c.id;
      b.style.background = c.hex;
      b.title = c.label;
      b.setAttribute('aria-label', `Couleur ${c.label}`);
      sw.append(b);
    }
    const swField = el('div', 'field field--swatches');
    swField.append(el('span', 'field__label', 'Couleur du texte'), sw);

    const row = el('div', 'panel__row');
    row.append(
      labelled('Police', selectOf(CAT.typos, e.typo, 'typo', e.uid)),
      swField,
      labelled('Emplacement', selectOf(CAT.placements, e.placement, 'placement', e.uid)),
      labelled('Taille', selectOf(CAT.tailles, e.taille, 'taille', e.uid)),
    );
    panel.append(row);
  } else {
    const inp = el('input', 'input');
    inp.type = 'text';
    inp.dataset.role = 'fichier';
    inp.dataset.uid = e.uid;
    inp.placeholder = 'Nom du fichier / référence client';
    inp.value = e.logo || '';
    panel.append(labelled('Fichier fourni par le client', inp));

    const row = el('div', 'panel__row');
    row.append(
      labelled('Emplacement sur la face', selectOf(CAT.placements, e.placement, 'placement', e.uid)),
      labelled('Taille', selectOf(CAT.tailles, e.taille, 'taille', e.uid)),
    );
    panel.append(row);
  }

  const rem = el('input', 'input');
  rem.type = 'text';
  rem.dataset.role = 'remarque';
  rem.dataset.uid = e.uid;
  rem.placeholder = 'Remarque atelier (facultatif)';
  rem.value = e.remarque || '';
  panel.append(labelled('Remarque', rem));

  return panel;
}

function renderPanels() {
  $('#panels').replaceChildren(...state.elements.map(buildPanel));
}

// ---------------------------------------------------------------------------
// Construction statique
// ---------------------------------------------------------------------------
function buildStatic() {
  const nav = $('#nav');
  for (const item of NAV) {
    const li = el('li');
    const a = el('a');
    a.href = item.href;
    if (item.active) a.classList.add('is-active');
    a.append(el('span', 'ms', item.icon), el('span', null, item.label));
    li.append(a);
    nav.append(li);
  }

  const prod = $('#product');
  for (const p of CAT.products) prod.append(new Option(`${p.short} — ${eur(p.price)}`, p.sku));
  state.product = CAT.products[0];
  prod.value = state.product.sku;
  $('#product-thumb').append(mugSvg('right'));

  const col = $('#color');
  for (const c of CAT.colors) col.append(new Option(c, c));
  state.color = CAT.colors[0];
  col.value = state.color;

  const st = $('#pay-statut');
  for (const s of CAT.paiementStatuts) st.append(new Option(s.label, s.id));
  state.paiementStatut = CAT.paiementStatuts[CAT.paiementStatuts.length - 1];
  st.value = state.paiementStatut.id;

  const mode = $('#pay-mode');
  for (const m of CAT.paiementModes) mode.append(new Option(m.label, m.id));
  state.paiementMode = CAT.paiementModes[0];
  mode.value = state.paiementMode.id;

  const delais = $('#delais');
  const icons = { urgent: 'bolt', express: 'schedule', standard: 'schedule', precise: 'event' };
  for (const d of CAT.delais) {
    const b = el('button', 'delai');
    b.type = 'button';
    b.dataset.delai = d.id;
    b.setAttribute('role', 'radio');
    b.append(el('span', 'ms', icons[d.id] || 'schedule'), el('span', null, d.label));
    if (d.rate) b.append(el('span', 'delai__rate', `+${d.rate * 100}%`));
    delais.append(b);
  }
  state.delai = CAT.delais.find((d) => d.id === 'express');
  state.deadline = todayPlus(state.delai.days);

  const vend = $('#vendeuse');
  for (const v of CAT.vendeuses) vend.append(new Option(v, v));
  state.vendeuse = CAT.vendeuses[0];
  vend.value = state.vendeuse;

  const ref = $('#referent');
  for (const v of CAT.vendeuses) ref.append(new Option(v, v));
  ref.value = CAT.vendeuses.includes('À attribuer') ? 'À attribuer' : CAT.vendeuses[0];
  state.referent = ref.value;

  const stage = $('#stage');
  for (const s of CAT.stages) stage.append(new Option(s.label, s.slug));
  stage.value = 'demande';

  state.elements = [newElement('face1'), newElement('face2')];
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------
function render() {
  $('#wa-badge').hidden = !state.whatsapp.trim();

  const stock = !!(state.product && state.product.stock);
  $('#stock-dot').className = `dot ${stock ? 'dot--ok' : 'dot--ko'}`;
  $('#stock-label').textContent = stock ? 'Disponible' : 'Rupture';
  $('#appbar-sub').textContent = state.product ? state.product.label : 'Tasse personnalisée';

  for (const b of document.querySelectorAll('#priority .star')) {
    b.classList.toggle('is-on', Number(b.dataset.v) <= state.priority);
    b.setAttribute('aria-checked', String(Number(b.dataset.v) === state.priority));
  }
  for (const b of document.querySelectorAll('#delais .delai')) {
    const on = !!state.delai && b.dataset.delai === state.delai.id;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  }
  $('#deadline').value = state.deadline;
  $('#heure').value = state.heure;

  const pill = $('#pay-pill');
  pill.textContent = state.paiementStatut ? state.paiementStatut.label : '—';
  pill.classList.toggle('is-paid', !!state.paiementStatut && state.paiementStatut.id === 'paye');

  renderMugs();

  const p = compute();
  const sum = $('#sum');
  sum.replaceChildren();
  const line = (label, value, cls) => {
    const row = el('div', `sum__row${cls ? ` ${cls}` : ''}`);
    row.append(el('dt', null, label), el('dd', null, eur(value)));
    sum.append(row);
  };
  line('Produit', p.produit);
  line('Personnalisation', p.personnalisation);
  if (state.delai) {
    line(
      `${state.delai.label}${p.rate ? ` (+${Math.round(p.rate * 100)} %)` : ''}`,
      p.supplement,
      p.supplement ? 'sum__row--sup' : null,
    );
  }
  $('#total').textContent = eur(p.total);

  const need = missing();
  const save = $('#save');
  save.disabled = state.sending;
  save.textContent = state.sending ? 'Enregistrement…' : 'Enregistrer la commande';
  save.title = need ? `Il manque ${need}` : 'Enregistrer et envoyer au planning';
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 3400);
}

const byUid = (u) => state.elements.find((e) => String(e.uid) === String(u));

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------
function wire() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;

    if (t.dataset.v) { state.priority = Number(t.dataset.v); return render(); }
    if (t.dataset.delai) {
      state.delai = CAT.delais.find((d) => d.id === t.dataset.delai);
      // « Date précise » laisse la main : on ne réécrit pas la date choisie.
      if (state.delai.id !== 'precise' && !state.deadlineTouched) {
        state.deadline = todayPlus(state.delai.days);
      }
      return render();
    }
    if (t.id === 'add-el') {
      state.elements.push(newElement('dessous'));
      renderPanels();
      return render();
    }
    if (t.dataset.role === 'remove') {
      const u = t.closest('.panel').dataset.uid;
      state.elements = state.elements.filter((x) => String(x.uid) !== String(u));
      renderPanels();
      return render();
    }
    if (t.dataset.role === 'encre') {
      byUid(t.closest('.swatches').dataset.uid).encre = t.dataset.encre;
      for (const s of t.parentElement.children) s.classList.toggle('is-on', s === t);
      return render();
    }
    if (t.id === 'save') return submit();
    if (t.id === 'done-print') return window.print();
    if (t.id === 'done-new') return window.location.reload();
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'product') { state.product = CAT.products.find((p) => p.sku === t.value); return render(); }
    if (t.id === 'color') { state.color = t.value; return render(); }
    if (t.id === 'pay-statut') { state.paiementStatut = CAT.paiementStatuts.find((s) => s.id === t.value); return render(); }
    if (t.id === 'pay-mode') { state.paiementMode = CAT.paiementModes.find((m) => m.id === t.value); return render(); }
    if (t.id === 'vendeuse') { state.vendeuse = t.value; return; }
    if (t.id === 'referent') { state.referent = t.value; return; }
    if (t.id === 'stage') { state.stage = t.value; return; }

    const item = t.dataset.uid ? byUid(t.dataset.uid) : null;
    if (!item) return;
    if (t.dataset.role === 'visual') {
      if (t.value.startsWith('olda:')) {
        item.option = 'logo_olda';
        item.logo = t.value.slice(5);
      } else {
        item.option = t.value;
        item.logo = null;
      }
      renderPanels();
      return render();
    }
    if (t.dataset.role === 'face') { item.face = t.value; renderPanels(); return render(); }
    if (t.dataset.role === 'placement') { item.placement = t.value; return render(); }
    if (t.dataset.role === 'taille') { item.taille = t.value; return render(); }
    if (t.dataset.role === 'typo') { item.typo = t.value; return render(); }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'prenom' || t.id === 'nom' || t.id === 'whatsapp') { state[t.id] = t.value; return render(); }
    if (t.id === 'qty') {
      const n = Number.parseInt(t.value, 10);
      state.quantity = Number.isInteger(n) && n > 0 ? Math.min(999, n) : 1;
      return render();
    }
    if (t.id === 'deadline') { state.deadline = t.value; state.deadlineTouched = true; return render(); }
    if (t.id === 'heure') { state.heure = t.value; return; }

    const item = t.dataset.uid ? byUid(t.dataset.uid) : null;
    if (!item) return;
    if (t.dataset.role === 'texte') {
      item.texte = t.value;
      const c = document.querySelector(`[data-count="${item.uid}"]`);
      if (c) {
        c.textContent = `${item.texte.length} / ${CAT.texteMax}`;
        c.classList.toggle('is-full', item.texte.length >= CAT.texteMax);
      }
      return render();
    }
    if (t.dataset.role === 'fichier') { item.logo = t.value; return render(); }
    if (t.dataset.role === 'remarque') { item.remarque = t.value; }
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
    const res = await fetch('/api/fiche', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prenom: state.prenom, nom: state.nom, whatsapp: state.whatsapp,
        priority: state.priority,
        vendeuse: state.vendeuse, referent: state.referent, stage: state.stage,
        product: state.product.sku, color: state.color, quantity: state.quantity,
        elements: state.elements.filter((x) => x.option !== 'aucune'),
        delai: state.delai.id, deadline: state.deadline, heure: state.heure,
        paiementMode: state.paiementMode.id, paiementStatut: state.paiementStatut.id,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    showDone(data.fiche);
  } catch (err) {
    toast(err.message || 'Enregistrement impossible — réessayez.');
  } finally {
    state.sending = false;
    render();
  }
}

function showDone(fiche) {
  const nom = [fiche.client.prenom, fiche.client.nom].filter(Boolean).join(' ');
  $('#done-sub').textContent = `${nom} · ${eur(fiche.prix.total)} · ajoutée au planning`;
  buildReceipt(fiche);
  $('#done').hidden = false;
}

function buildReceipt(f) {
  const detail = (x) => {
    const quoi = x.texte ? ` : « ${x.texte} » (${x.typoLabel}, ${x.encreLabel})` : x.logo ? ` : ${x.logo}` : '';
    return `${x.faceLabel} — ${x.optionLabel}${quoi} · ${x.placementLabel.toLowerCase()}, ${x.tailleLabel.toLowerCase()}`;
  };
  const rows = [
    [`${f.quantity} × ${f.product.label} — ${f.color}`, eur(f.prix.produit)],
    ...f.elements.map((x) => [detail(x), eur(euro(x.price * f.quantity))]),
    ['Sous-total', eur(f.prix.sousTotal)],
  ];
  if (f.prix.supplement) rows.push([`${f.delai.label} (+${Math.round(f.delai.rate * 100)} %)`, eur(f.prix.supplement)]);

  const r = $('#receipt');
  r.replaceChildren();
  r.append(el('h2', null, 'Reçu client — Atelier OLDA'));
  r.append(el('p', null, `${[f.client.prenom, f.client.nom].filter(Boolean).join(' ')}${f.client.whatsapp ? ` · ${f.client.whatsapp}` : ''}`));
  r.append(el('p', null, `Reçu par ${f.vendeuse} · à retirer le ${f.deadline.split('-').reverse().join('/')}${f.heure ? ` à ${f.heure}` : ''} · ${f.paiement.modeLabel} (${f.paiement.statutLabel})`));

  const table = el('table');
  for (const [label, price] of rows) {
    const tr = el('tr');
    tr.append(el('td', null, label), el('td', null, price));
    table.append(tr);
  }
  const grand = el('tr', 'grand');
  grand.append(el('td', null, 'TOTAL'), el('td', null, eur(f.prix.total)));
  table.append(grand);
  r.append(table);
}

// ---------------------------------------------------------------------------
(async function start() {
  CAT = await (await fetch('/api/fiche/catalog')).json();
  buildStatic();
  renderPanels();
  wire();
  render();
}());
