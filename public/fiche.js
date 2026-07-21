// Fiche vendeuse — Atelier OLDA
// Un seul écran, un seul état, un seul rendu. Tout est recalculé localement à
// chaque geste (aucun aller-retour réseau pendant la saisie) ; le serveur ne
// voit la fiche qu'au moment de « Valider », et recalcule le total lui-même.

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const eur = (n) => `${n.toFixed(2).replace('.', ',')} €`;
const todayPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

let CAT = null;
const state = {
  prenom: '', nom: '', whatsapp: '',
  priority: 1,
  vendeuse: '',
  product: null,
  color: null,
  quantity: 1,
  faces: {},                    // faceId → { option, texte, typo, logo, remarque }
  delai: null,
  deadline: '',
  paiement: null,
  deadlineTouched: false,       // la vendeuse a posé une date à la main
  sending: false,
};

// ---------------------------------------------------------------------------
// Calcul du prix — miroir exact de buildFiche() côté serveur.
// ---------------------------------------------------------------------------
const optionById = (id) => CAT.options.find((o) => o.id === id);
const euro = (n) => Math.round(n * 100) / 100;

// Options proposées sur une face : le tarif du logo OLDA diffère entre les
// flancs (6 €) et le dessous (2 €), d'où le `logoOption` porté par la face.
function optionsFor(faceDef) {
  return CAT.options.filter((o) => (
    o.id === 'aucune'
    || o.id === 'texte'
    || o.id === faceDef.logoOption
    || o.id === 'logo_client_vecto'
    || o.id === 'logo_client_reprise'
  ));
}

function compute() {
  const base = state.product ? state.product.price : 0;
  const lines = [];
  let faceSum = 0;
  for (const def of CAT.faces) {
    const f = state.faces[def.id];
    if (!f || !f.option || f.option === 'aucune') continue;
    const opt = optionById(f.option);
    faceSum += opt.price;
    lines.push({ label: `${def.label} · ${opt.label}`, price: opt.price });
  }
  const unitaire = euro(base + faceSum);
  const sousTotal = euro(unitaire * state.quantity);
  const rate = state.delai ? state.delai.rate : 0;
  const supplement = euro(sousTotal * rate);
  return { lines, unitaire, sousTotal, supplement, total: euro(sousTotal + supplement) };
}

// Ce qui manque pour pouvoir valider. Renvoie null si la fiche est complète.
function missing() {
  if (!state.prenom.trim() && !state.nom.trim()) return 'Nom du client';
  if (!state.product) return 'Produit';
  const filled = CAT.faces.filter((d) => {
    const f = state.faces[d.id];
    return f && f.option && f.option !== 'aucune';
  });
  if (filled.length === 0) return 'Au moins une personnalisation';
  for (const def of filled) {
    const f = state.faces[def.id];
    const opt = optionById(f.option);
    if (opt.needs === 'texte' && !String(f.texte || '').trim()) return `${def.label} : le texte`;
    if (opt.needs === 'texte' && !f.typo) return `${def.label} : la typographie`;
    if (opt.needs === 'logo_olda' && !f.logo) return `${def.label} : la référence du logo`;
    if (opt.needs === 'logo_client' && !String(f.logo || '').trim()) return `${def.label} : le nom du fichier`;
  }
  if (!state.paiement) return 'Mode de paiement';
  return null;
}

// ---------------------------------------------------------------------------
// Construction du DOM (une fois) — puis on ne fait plus que basculer des
// classes et écrire du texte. Aucun re-render destructif : les champs texte
// gardent leur focus et leur curseur pendant que le client parle.
// ---------------------------------------------------------------------------
function buildStatic() {
  const vend = $('#vendeuse');
  for (const v of CAT.vendeuses) vend.append(new Option(v, v));
  state.vendeuse = CAT.vendeuses[0];
  vend.value = state.vendeuse;

  const products = $('#products');
  for (const p of CAT.products) {
    const b = el('button', 'tile');
    b.type = 'button';
    b.dataset.sku = p.sku;
    b.setAttribute('role', 'radio');
    b.append(el('span', 'ms', 'local_cafe'), el('span', 'tile__name', p.short), el('span', 'tile__price', eur(p.price)));
    products.append(b);
  }

  const colors = $('#colors');
  for (const c of CAT.colors) {
    const b = el('button', 'chip', c);
    b.type = 'button';
    b.dataset.color = c;
    b.setAttribute('role', 'radio');
    colors.append(b);
  }

  const faces = $('#faces');
  for (const def of CAT.faces) {
    const card = el('div', 'card face');
    card.dataset.face = def.id;

    const head = el('h2', 'card__title face__head');
    head.append(el('span', 'ms', 'crop_square'), el('span', null, def.label), el('span', 'face__hint', def.hint), el('span', 'face__price'));
    card.append(head);

    const chips = el('div', 'chips');
    chips.setAttribute('role', 'radiogroup');
    chips.setAttribute('aria-label', `Personnalisation ${def.label}`);
    for (const o of optionsFor(def)) {
      const b = el('button', 'chip');
      b.type = 'button';
      b.dataset.option = o.id;
      b.setAttribute('role', 'radio');
      b.append(el('span', 'ms', o.icon), el('span', null, o.label));
      if (o.price) b.append(el('span', 'chip__sub', `+${o.price} €`));
      chips.append(b);
    }
    card.append(chips, el('div', 'face__body'));
    faces.append(card);

    state.faces[def.id] = { option: 'aucune', texte: '', typo: null, logo: null, remarque: '' };
  }

  const delais = $('#delais');
  for (const d of CAT.delais) {
    const b = el('button', 'chip');
    b.type = 'button';
    b.dataset.delai = d.id;
    b.setAttribute('role', 'radio');
    b.append(el('span', null, d.label), el('span', 'chip__sub', d.rate ? `${d.hint} · +${d.rate * 100}%` : d.hint));
    delais.append(b);
  }

  const pays = $('#paiements');
  for (const p of CAT.paiements) {
    const b = el('button', 'chip');
    b.type = 'button';
    b.dataset.paiement = p.id;
    b.setAttribute('role', 'radio');
    b.append(el('span', 'ms', p.icon), el('span', null, p.label));
    pays.append(b);
  }

  // Valeurs de départ : le cas le plus fréquent, déjà posé.
  state.product = CAT.products[0];
  state.color = CAT.colors[0];
  state.delai = CAT.delais.find((d) => d.id === 'standard') || CAT.delais[0];
  state.deadline = todayPlus(state.delai.days);
}

// Corps d'une face : ce qui dépend de l'option choisie. Reconstruit seulement
// quand l'option change (pas à chaque frappe), pour ne pas perdre le curseur.
function buildFaceBody(def) {
  const card = document.querySelector(`.face[data-face="${def.id}"]`);
  const body = card.querySelector('.face__body');
  const f = state.faces[def.id];
  const opt = optionById(f.option);
  body.replaceChildren();
  if (!opt.needs) return;

  if (opt.needs === 'texte') {
    const preview = el('div', 'preview');
    const input = el('input', 'input');
    input.type = 'text';
    input.placeholder = 'Texte à imprimer';
    input.value = f.texte || '';
    input.dataset.role = 'texte';
    input.setAttribute('enterkeyhint', 'done');

    const typos = el('div', 'typos');
    for (const t of CAT.typos) {
      const b = el('button', 'typo', t.label);
      b.type = 'button';
      b.dataset.typo = t.id;
      b.style.fontFamily = t.css;
      typos.append(b);
    }
    body.append(preview, input, typos);
  } else if (opt.needs === 'logo_olda') {
    const grid = el('div', 'logos');
    for (const ref of CAT.logosOlda) {
      const b = el('button', 'logo', ref);
      b.type = 'button';
      b.dataset.logo = ref;
      grid.append(b);
    }
    body.append(grid);
  } else if (opt.needs === 'logo_client') {
    const input = el('input', 'input');
    input.type = 'text';
    input.placeholder = 'Nom du fichier / référence client';
    input.value = f.logo || '';
    input.dataset.role = 'logo-libre';
    body.append(input);
  }

  const rem = el('input', 'input');
  rem.type = 'text';
  rem.placeholder = 'Remarque (facultatif)';
  rem.value = f.remarque || '';
  rem.dataset.role = 'remarque';
  body.append(rem);
}

// ---------------------------------------------------------------------------
// Rendu : reflète l'état sur le DOM déjà construit.
// ---------------------------------------------------------------------------
function render() {
  const on = (node, yes) => node.classList.toggle('is-on', yes);

  for (const b of document.querySelectorAll('#priority .star')) {
    on(b, Number(b.dataset.v) <= state.priority);
    b.setAttribute('aria-checked', String(Number(b.dataset.v) === state.priority));
  }
  for (const b of document.querySelectorAll('#products .tile')) {
    const yes = state.product && b.dataset.sku === state.product.sku;
    on(b, yes); b.setAttribute('aria-checked', String(!!yes));
  }
  for (const b of document.querySelectorAll('#colors .chip')) {
    const yes = b.dataset.color === state.color;
    on(b, yes); b.setAttribute('aria-checked', String(yes));
  }
  $('#qty').textContent = String(state.quantity);
  $('#qty-minus').disabled = state.quantity <= 1;

  for (const def of CAT.faces) {
    const card = document.querySelector(`.face[data-face="${def.id}"]`);
    const f = state.faces[def.id];
    const opt = optionById(f.option);
    for (const b of card.querySelectorAll('.chips .chip')) {
      const yes = b.dataset.option === f.option;
      on(b, yes); b.setAttribute('aria-checked', String(yes));
    }
    card.querySelector('.face__price').textContent = opt.price ? `+${eur(opt.price)}` : '';

    const preview = card.querySelector('.preview');
    if (preview) {
      const typo = CAT.typos.find((t) => t.id === f.typo);
      preview.style.fontFamily = typo ? typo.css : '';
      preview.textContent = f.texte || '';
    }
    for (const b of card.querySelectorAll('.typo')) on(b, b.dataset.typo === f.typo);
    for (const b of card.querySelectorAll('.logo')) on(b, b.dataset.logo === f.logo);
  }

  for (const b of document.querySelectorAll('#delais .chip')) {
    const yes = state.delai && b.dataset.delai === state.delai.id;
    on(b, yes); b.setAttribute('aria-checked', String(!!yes));
  }
  for (const b of document.querySelectorAll('#paiements .chip')) {
    const yes = state.paiement && b.dataset.paiement === state.paiement.id;
    on(b, yes); b.setAttribute('aria-checked', String(!!yes));
  }
  $('#deadline').value = state.deadline;

  // Récapitulatif + totaux
  const p = compute();
  const recap = $('#recap');
  recap.replaceChildren();
  if (state.product) {
    const li = el('li');
    li.append(el('span', null, `${state.quantity} × ${state.product.short} · ${state.color}`), el('b', null, eur(euro(state.product.price * state.quantity))));
    recap.append(li);
  }
  for (const line of p.lines) {
    const li = el('li');
    li.append(el('span', null, line.label), el('b', null, eur(euro(line.price * state.quantity))));
    recap.append(li);
  }
  if (!p.lines.length) recap.append(el('li', 'recap__empty', 'Aucune personnalisation choisie.'));

  $('#t-sous').textContent = eur(p.sousTotal);
  $('#t-sup-row').hidden = !p.supplement;
  $('#t-sup-lbl').textContent = `Supplément ${state.delai ? state.delai.label.toLowerCase() : ''}`;
  $('#t-sup').textContent = eur(p.supplement);
  $('#t-total').textContent = eur(p.total);

  // Le bouton reste toujours actif : un bouton grisé n'explique rien au doigt.
  // Ce qui manque s'affiche juste au-dessus, et un appui le rappelle en toast.
  const need = missing();
  $('#hint').textContent = need ? `Il reste à renseigner : ${need.toLowerCase()}` : '';
  $('#validate').disabled = state.sending;
  $('#validate-label').textContent = state.sending ? 'Enregistrement…' : 'Valider la commande';
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 3200);
}

// ---------------------------------------------------------------------------
// Interactions — délégation unique sur le document.
// ---------------------------------------------------------------------------
function wire() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;

    if (t.dataset.v) { state.priority = Number(t.dataset.v); return render(); }
    if (t.dataset.sku) { state.product = CAT.products.find((p) => p.sku === t.dataset.sku); return render(); }
    if (t.dataset.color) { state.color = t.dataset.color; return render(); }
    if (t.id === 'qty-plus') { state.quantity = Math.min(999, state.quantity + 1); return render(); }
    if (t.id === 'qty-minus') { state.quantity = Math.max(1, state.quantity - 1); return render(); }

    const faceCard = t.closest('.face');
    if (faceCard) {
      const def = CAT.faces.find((d) => d.id === faceCard.dataset.face);
      const f = state.faces[def.id];
      if (t.dataset.option) {
        if (t.dataset.option === f.option) return;
        // Changer d'option remet le détail à zéro : on ne traîne pas un texte
        // saisi pour une face qui porte désormais un logo.
        state.faces[def.id] = { option: t.dataset.option, texte: '', typo: null, logo: null, remarque: '' };
        buildFaceBody(def);
        return render();
      }
      if (t.dataset.typo) { f.typo = t.dataset.typo; return render(); }
      if (t.dataset.logo) { f.logo = t.dataset.logo; return render(); }
    }

    if (t.dataset.delai) {
      state.delai = CAT.delais.find((d) => d.id === t.dataset.delai);
      if (!state.deadlineTouched) state.deadline = todayPlus(state.delai.days);
      return render();
    }
    if (t.dataset.paiement) { state.paiement = CAT.paiements.find((p) => p.id === t.dataset.paiement); return render(); }

    if (t.id === 'validate') return submit();
    if (t.id === 'done-print') return window.print();
    if (t.id === 'done-new') return window.location.reload();
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'prenom' || t.id === 'nom' || t.id === 'whatsapp') { state[t.id] = t.value; return render(); }
    if (t.id === 'deadline') { state.deadline = t.value; state.deadlineTouched = true; return; }
    if (t.id === 'vendeuse') { state.vendeuse = t.value; return; }
    const faceCard = t.closest('.face');
    if (!faceCard) return;
    const f = state.faces[faceCard.dataset.face];
    if (t.dataset.role === 'texte') f.texte = t.value;
    else if (t.dataset.role === 'logo-libre') f.logo = t.value;
    else if (t.dataset.role === 'remarque') { f.remarque = t.value; return; }
    render();
  });

  $('#vendeuse').addEventListener('change', (e) => { state.vendeuse = e.target.value; });
}

// ---------------------------------------------------------------------------
// Envoi
// ---------------------------------------------------------------------------
async function submit() {
  const need = missing();
  if (need) return toast(`Il manque : ${need.toLowerCase()}`);

  state.sending = true;
  render();
  try {
    const res = await fetch('/api/fiche', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prenom: state.prenom, nom: state.nom, whatsapp: state.whatsapp,
        priority: state.priority, vendeuse: state.vendeuse,
        product: state.product.sku, color: state.color, quantity: state.quantity,
        faces: state.faces,
        delai: state.delai.id, deadline: state.deadline, paiement: state.paiement.id,
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

// Reçu papier : le même contenu, mis en page pour l'impression.
function buildReceipt(f) {
  const rows = [
    [`${f.quantity} × ${f.product.label} — ${f.color}`, eur(euro(f.product.price * f.quantity))],
    ...f.faces.map((x) => [
      `${x.label} — ${x.optionLabel}${x.texte ? ` : « ${x.texte} » (${x.typoLabel})` : x.logo ? ` : ${x.logo}` : ''}`,
      eur(euro(x.price * f.quantity)),
    ]),
    ['Sous-total', eur(f.prix.sousTotal)],
  ];
  if (f.prix.supplement) rows.push([`Supplément ${f.delai.label.toLowerCase()} (${f.delai.hint})`, eur(f.prix.supplement)]);

  const r = $('#receipt');
  r.replaceChildren();
  r.append(el('h2', null, 'Reçu client — Atelier OLDA'));
  r.append(el('p', null, `${[f.client.prenom, f.client.nom].filter(Boolean).join(' ')}${f.client.whatsapp ? ` · ${f.client.whatsapp}` : ''}`));
  r.append(el('p', null, `Reçu par ${f.vendeuse} · à retirer le ${f.deadline.split('-').reverse().join('/')} · ${f.paiement.label}`));

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
  const res = await fetch('/api/fiche/catalog');
  CAT = await res.json();
  buildStatic();
  for (const def of CAT.faces) buildFaceBody(def);
  wire();
  render();
}());
