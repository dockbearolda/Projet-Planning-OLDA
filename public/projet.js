// Nouveau Projet — Atelier OLDA
// LE flux comptoir : client (recherche/création) → type de projet → produit +
// prix, façon caisse SumUp. Rendu entièrement par JS dans une section vide
// (même principe que clients.js / reglages.js), chargé à la demande par app.js.

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
const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// --- État --------------------------------------------------------------------
// `page` pilote QUEL écran est affiché : 'client' (plein écran, pas de client
// choisi) | 'main' (client épinglé dans la colonne de gauche ; la colonne de
// droite montre les tuiles de type si `type` est vide, sinon la config produit).
// Un client peut commander plusieurs produits différents dans la même visite :
// rester sur 'main' en vidant juste `type`/`lignes` évite de le rechercher
// deux fois (voir resetType()/showConfirmation()).
const state = {
  page: 'client',
  client: null,          // { id, entreprise, nom, telephone, email, type: 'pro'|'perso' } choisi ou créé
  type: null,            // 'textile' | 'tasse' | 'signaletique' | 'autres'
  lignes: [],
  delai: 'j5',
  paiement: 'non_paye',
  margeVisible: false,
};

let CLIENTS = [];
let TARIFS = [];
let TARIFS_PARAMS = { tauxHoraireMo: 25, tauxHoraireMachine: 25, tgca: 0.04 };
let PIPELINE = null;   // chargé à la demande (familles + sous-étapes)

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
  return data;
}

const TYPES = [
  { id: 'textile', label: 'Textile', icon: 'checkroom' },
  { id: 'tasse', label: 'Tasse', icon: 'local_cafe' },
  { id: 'signaletique', label: 'Plaque signalétique', icon: 'signpost' },
  { id: 'autres', label: 'Autres', icon: 'category' },
];

const DELAIS = [
  { id: 'jour_j', label: 'Jour J', majoration: 20 },
  { id: 'express', label: 'Sous 3 jours', majoration: 10 },
  { id: 'j5', label: '5 jours', majoration: 0 },
  { id: 'j10', label: '10 jours', majoration: 0 },
  { id: 'j15', label: '15 jours', majoration: 0 },
];

const PAIEMENT_STATUTS = [
  { id: 'non_paye', label: 'Non payé' },
  { id: 'acompte', label: 'Acompte payé' },
  { id: 'paye', label: 'Payé' },
];

// --- Rendu : dispatcher --------------------------------------------------------
const STEPS = [
  { id: 'client', label: 'Client' },
  { id: 'type', label: 'Type' },
  { id: 'produit', label: 'Produit' },
];

// 1 = choix du client, 2 = choix du type, 3 = configuration du produit.
function currentStepIndex() {
  if (state.page === 'client') return 0;
  return state.type ? 2 : 1;
}

// Barre de progression visuelle (3 puces reliées), remplace le fil texte
// « Client → type → produit » — l'employé voit d'un coup d'œil où il en est.
function renderStepper() {
  const box = $('#proj-stepper');
  if (!box) return;
  box.replaceChildren();
  const current = currentStepIndex();
  STEPS.forEach((s, i) => {
    if (i > 0) {
      const line = el('span', `proj-stepper__line${i <= current ? ' is-done' : ''}`);
      box.appendChild(line);
    }
    const status = i < current ? 'is-done' : i === current ? 'is-current' : 'is-todo';
    const step = el('span', `proj-stepper__step ${status}`);
    const dot = el('span', 'proj-stepper__dot');
    dot.append(i < current ? ic('check') : document.createTextNode(String(i + 1)));
    step.append(dot, el('span', 'proj-stepper__label', s.label));
    box.appendChild(step);
  });
}

function render() {
  renderStepper();
  const body = $('#proj-body');
  if (!body) return;
  if (state.page === 'client') return renderClientPage(body);
  return renderMainPage(body);
}
function renderCurrentPage() { render(); }

function clientLabel(c) {
  if (!c) return '—';
  return c.type === 'perso' ? ([c.nom].filter(Boolean).join(' ') || c.entreprise) : c.entreprise;
}

// --- Page 1 : client ------------------------------------------------------------
function matchClients(query) {
  const q = fold(query).trim();
  if (!q) return [];
  return CLIENTS.filter((c) => fold(c.client_type === 'perso' ? c.nom : c.entreprise).includes(q)
      || fold(c.entreprise).includes(q) || fold(c.telephone).includes(q))
    .slice(0, 8);
}

function goToClient(client) {
  state.client = client;
  state.page = 'main';
  state.type = null;
  state.lignes = [];
  render();
}

// Repart chercher un AUTRE client : sort de 'main' complètement.
function changeClient() {
  state.page = 'client'; state.client = null; state.type = null; state.lignes = [];
  state.delai = 'j5'; state.paiement = 'non_paye'; state.margeVisible = false;
  render();
}

// Même client, produit suivant : un client commande souvent plusieurs types
// différents (tasses ET textile) dans la même visite — pas besoin de le
// rechercher une deuxième fois, seule la colonne de droite se réinitialise.
function resetType() {
  state.type = null; state.lignes = [];
  state.delai = 'j5'; state.paiement = 'non_paye'; state.margeVisible = false;
  render();
}

function renderClientPage(body) {
  body.replaceChildren();
  const wrap = el('div', 'proj-client');
  wrap.append(el('h3', 'proj-step__title', 'Quel client ?'));

  const searchRow = el('div', 'proj-client__row');
  const searchWrap = el('div', 'proj-search');
  searchWrap.append(ic('search', 'proj-search__ic'));
  const input = el('input', 'proj-search__input');
  input.type = 'text';
  input.placeholder = 'Nom, société ou téléphone…';
  input.autocomplete = 'off';
  searchWrap.append(input);
  searchRow.append(searchWrap);

  const newBtn = el('button', 'proj-btn proj-btn--ghost');
  newBtn.type = 'button';
  newBtn.append(ic('person_add'), el('span', null, 'Nouveau client'));
  searchRow.append(newBtn);
  wrap.append(searchRow);

  const results = el('div', 'proj-client__results');
  wrap.append(results);

  const quickForm = el('div', 'proj-quick');
  quickForm.hidden = true;
  wrap.append(quickForm);

  const renderResults = () => {
    results.replaceChildren();
    for (const c of matchClients(input.value)) {
      const item = el('button', 'proj-client__item');
      item.type = 'button';
      const nature = c.client_type === 'perso' ? 'perso' : 'pro';
      item.append(
        el('span', 'proj-client__name', c.client_type === 'perso' ? (c.nom || c.entreprise) : c.entreprise),
        el('span', 'proj-client__meta', [c.telephone, nature === 'perso' ? 'Particulier' : 'Pro'].filter(Boolean).join(' · ')),
      );
      item.addEventListener('click', () => goToClient({
        id: c.id, entreprise: c.entreprise, nom: c.nom, telephone: c.telephone,
        email: c.email, type: nature,
      }));
      results.appendChild(item);
    }
  };
  input.addEventListener('input', renderResults);

  const renderQuickForm = (nature) => {
    quickForm.hidden = false;
    quickForm.replaceChildren();
    const seg = el('div', 'proj-seg');
    for (const n of [{ id: 'pro', label: 'Pro' }, { id: 'perso', label: 'Perso' }]) {
      const b = el('button', `proj-seg__btn${n.id === nature ? ' is-on' : ''}`, n.label);
      b.type = 'button';
      b.addEventListener('click', () => renderQuickForm(n.id));
      seg.appendChild(b);
    }
    quickForm.appendChild(seg);

    const nameField = el('input', 'proj-input');
    nameField.placeholder = nature === 'perso' ? 'Prénom Nom' : 'Nom de facturation';
    const phoneField = el('input', 'proj-input');
    phoneField.placeholder = 'WhatsApp';
    phoneField.type = 'tel';
    quickForm.append(nameField, phoneField);

    const createBtn = el('button', 'proj-btn proj-btn--primary', 'Créer et continuer');
    createBtn.type = 'button';
    createBtn.addEventListener('click', async () => {
      const nom = nameField.value.trim();
      if (!nom) { nameField.focus(); return; }
      createBtn.disabled = true;
      try {
        const draft = nature === 'perso'
          ? { entreprise: nom, nom, client_type: 'perso', telephone: phoneField.value.trim() }
          : { entreprise: nom, client_type: 'pro', telephone: phoneField.value.trim() };
        const created = await api('POST', '/api/clients', draft);
        CLIENTS.push(created);
        goToClient({
          id: created.id, entreprise: created.entreprise, nom: created.nom,
          telephone: created.telephone, email: created.email, type: nature,
        });
      } catch (err) {
        createBtn.disabled = false;
        window.alert(err.message || 'Création impossible');
      }
    });
    quickForm.appendChild(createBtn);
    nameField.focus();
  };
  newBtn.addEventListener('click', () => renderQuickForm('pro'));

  body.appendChild(wrap);
  input.focus();
}

// --- Page 2 (colonne de gauche) : client épinglé ---------------------------------
// Un client peut avoir plusieurs produits différents dans la même visite : il
// reste visible dans cette colonne tant qu'on ne clique pas « Changer de client »,
// pour ne jamais avoir à le rechercher deux fois.
function renderClientSidebar() {
  const c = state.client;
  const box = el('aside', 'proj-sidebar');
  const av = el('div', 'proj-sidebar__av', (clientLabel(c).trim()[0] || '?').toUpperCase());
  const info = el('div', 'proj-sidebar__info');
  info.append(el('p', 'proj-sidebar__name', clientLabel(c)));
  const meta = [c.type === 'perso' ? 'Particulier' : 'Pro', c.telephone].filter(Boolean).join(' · ');
  if (meta) info.append(el('p', 'proj-sidebar__meta', meta));
  box.append(av, info);
  const change = el('button', 'proj-sidebar__change', '');
  change.type = 'button';
  change.append(ic('sync_alt'), el('span', null, 'Changer de client'));
  change.addEventListener('click', changeClient);
  box.append(change);
  return box;
}

function renderMainPage(body) {
  body.replaceChildren();
  const layout = el('div', 'proj-layout');
  layout.append(renderClientSidebar());
  const main = el('div', 'proj-main');
  if (!state.type) {
    renderTypeTiles(main);
  } else {
    if (!state.lignes.length) state.lignes.push(state.type === 'tasse' ? newTasseLigne() : newSommaireLigne());
    if (state.type === 'tasse') renderTasseProduit(main);
    else renderSommaireProduit(main);
  }
  layout.append(main);
  body.append(layout);
}

// --- Colonne de droite : tuiles de type ------------------------------------------
function renderTypeTiles(main) {
  // Une seule question à l'écran, centrée dans la colonne de droite (le
  // client reste visible dans la sidebar, mais la question, elle, est seule).
  const center = el('div', 'proj-center');
  center.append(el('h3', 'proj-step__title', 'Quel type de projet ?'));
  const grid = el('div', 'proj-type__grid');
  for (const t of TYPES) {
    const tile = el('button', 'proj-tile');
    tile.type = 'button';
    tile.append(ic(t.icon, 'proj-tile__ic'), el('span', 'proj-tile__label', t.label));
    tile.addEventListener('click', () => { state.type = t.id; state.lignes = []; render(); });
    grid.appendChild(tile);
  }
  center.append(grid);
  main.append(center);
}

// --- Colonne de droite : produit ------------------------------------------------
function tarifsByCat(cat) { return TARIFS.filter((t) => t.categorie === cat && t.actif); }
function tarifById(id) { return TARIFS.find((t) => t.id === id); }

function newTasseLigne() {
  return {
    uid: Math.random().toString(36).slice(2), quantite: 1,
    produitId: '', coloris: '', face1Id: '', face2Id: '', dessousId: '', batId: '', remarque: '',
  };
}
function newSommaireLigne() {
  return { uid: Math.random().toString(36).slice(2), quantite: 1, description: '', prixTtcManuel: '' };
}

function calcLigneTasseTtc(l) {
  const ids = [l.produitId, l.face1Id, l.face2Id, l.dessousId, l.batId];
  const total = ids.reduce((s, id) => { const a = tarifById(id); return s + (a ? a.prixVenteTtc : 0); }, 0);
  return (Number(l.quantite) || 0) * total;
}
function calcLigneTasseRevient(l) {
  const ids = [l.produitId, l.face1Id, l.face2Id, l.dessousId, l.batId];
  let achat = 0; let moMin = 0; let machineMin = 0;
  for (const id of ids) {
    const a = tarifById(id);
    if (!a) continue;
    achat += a.prixAchat; moMin += a.tempsMoMin; machineMin += a.tempsMachineMin;
  }
  const q = Number(l.quantite) || 0;
  return q * (achat + (moMin / 60) * TARIFS_PARAMS.tauxHoraireMo + (machineMin / 60) * TARIFS_PARAMS.tauxHoraireMachine);
}

function totalTtc() {
  const base = state.type === 'tasse'
    ? state.lignes.reduce((s, l) => s + calcLigneTasseTtc(l), 0)
    : state.lignes.reduce((s, l) => s + (Number(l.prixTtcManuel) || 0), 0);
  const delai = DELAIS.find((d) => d.id === state.delai) || DELAIS[2];
  return Math.round(base * (1 + delai.majoration / 100) * 100) / 100;
}
function totalRevient() {
  if (state.type !== 'tasse') return 0;
  return state.lignes.reduce((s, l) => s + calcLigneTasseRevient(l), 0);
}

function selectField(value, onChange, options, placeholder) {
  const select = el('select', 'proj-select');
  const empty = el('option', null, placeholder);
  empty.value = '';
  select.appendChild(empty);
  for (const o of options) {
    const opt = el('option', null, `${o.designation}${o.prixVenteTtc ? ` (+${o.prixVenteTtc.toFixed(2)} €)` : ''}`);
    opt.value = o.id;
    if (o.id === value) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function renderTasseLigne(l, index) {
  const card = el('div', 'proj-ligne');
  const row1 = el('div', 'proj-ligne__row');
  const qty = el('input', 'proj-qty');
  qty.type = 'number'; qty.min = '1'; qty.inputMode = 'numeric'; qty.value = String(l.quantite);
  qty.addEventListener('input', () => { l.quantite = Math.max(1, Number.parseInt(qty.value, 10) || 1); renderCurrentPage(); });
  row1.append(qty, selectField(l.produitId, (v) => { l.produitId = v; renderCurrentPage(); }, tarifsByCat('produit'), 'Type de tasse…'));
  const coloris = el('input', 'proj-input proj-input--sm');
  coloris.placeholder = 'Coloris';
  coloris.value = l.coloris;
  coloris.addEventListener('input', () => { l.coloris = coloris.value; });
  row1.append(coloris);
  if (state.lignes.length > 1) {
    const rm = el('button', 'proj-ligne__del');
    rm.type = 'button';
    rm.append(ic('close'));
    rm.addEventListener('click', () => { state.lignes.splice(index, 1); renderCurrentPage(); });
    row1.append(rm);
  }
  card.append(row1);

  const row2 = el('div', 'proj-ligne__row');
  row2.append(
    selectField(l.face1Id, (v) => { l.face1Id = v; renderCurrentPage(); }, tarifsByCat('face'), 'Face 1 (anse à droite)…'),
    selectField(l.face2Id, (v) => { l.face2Id = v; renderCurrentPage(); }, tarifsByCat('face'), 'Face 2 (anse à gauche)…'),
  );
  card.append(row2);

  const row3 = el('div', 'proj-ligne__row');
  row3.append(
    selectField(l.dessousId, (v) => { l.dessousId = v; renderCurrentPage(); }, tarifsByCat('dessous'), 'Dessous…'),
    selectField(l.batId, (v) => { l.batId = v; renderCurrentPage(); }, tarifsByCat('bat'), 'BAT avant production…'),
  );
  card.append(row3);

  card.append(el('div', 'proj-ligne__prix', `${calcLigneTasseTtc(l).toFixed(2)} €`));
  return card;
}

function renderTasseProduit(main) {
  const back = el('button', 'proj-back', '← Changer de type');
  back.type = 'button';
  back.addEventListener('click', resetType);
  main.append(back, el('h3', 'proj-step__title', 'Tasse — configuration'));

  const list = el('div', 'proj-lignes');
  state.lignes.forEach((l, i) => list.appendChild(renderTasseLigne(l, i)));
  main.append(list);

  const addBtn = el('button', 'proj-btn proj-btn--ghost');
  addBtn.type = 'button';
  addBtn.append(ic('add'), el('span', null, 'Ajouter une autre tasse'));
  addBtn.addEventListener('click', () => { state.lignes.push(newTasseLigne()); renderCurrentPage(); });
  main.append(addBtn);

  main.append(renderDelaiPaiement());
  main.append(renderTotalBar());
}

function renderSommaireProduit(main) {
  const back = el('button', 'proj-back', '← Changer de type');
  back.type = 'button';
  back.addEventListener('click', resetType);
  const titre = TYPES.find((t) => t.id === state.type).label;
  main.append(back, el('h3', 'proj-step__title', `${titre} — description`));

  const list = el('div', 'proj-lignes');
  state.lignes.forEach((l, i) => {
    const card = el('div', 'proj-ligne');
    const row = el('div', 'proj-ligne__row');
    const desc = el('textarea', 'proj-textarea');
    desc.placeholder = '5 polos brodés équipe, taille M à XL…';
    desc.value = l.description;
    desc.rows = 2;
    desc.addEventListener('input', () => { l.description = desc.value; });
    row.append(desc);

    const qty = el('input', 'proj-qty');
    qty.type = 'number'; qty.min = '1'; qty.inputMode = 'numeric'; qty.value = String(l.quantite);
    qty.addEventListener('input', () => { l.quantite = Math.max(1, Number.parseInt(qty.value, 10) || 1); });
    row.append(qty);

    const prix = el('input', 'proj-input proj-input--sm');
    prix.type = 'number'; prix.min = '0'; prix.step = '0.01'; prix.inputMode = 'decimal';
    prix.placeholder = 'Prix TTC €';
    prix.value = l.prixTtcManuel;
    prix.addEventListener('input', () => { l.prixTtcManuel = prix.value; renderTotalOnly(); });
    row.append(prix);

    if (state.lignes.length > 1) {
      const rm = el('button', 'proj-ligne__del');
      rm.type = 'button';
      rm.append(ic('close'));
      rm.addEventListener('click', () => { state.lignes.splice(i, 1); render(); });
      row.append(rm);
    }
    card.append(row);
    list.appendChild(card);
  });
  main.append(list);

  const addBtn = el('button', 'proj-btn proj-btn--ghost');
  addBtn.type = 'button';
  addBtn.append(ic('add'), el('span', null, 'Ajouter une ligne'));
  addBtn.addEventListener('click', () => { state.lignes.push(newSommaireLigne()); render(); });
  main.append(addBtn);

  main.append(renderDelaiPaiement());
  main.append(renderTotalBar());
}

// Les champs texte perdraient le focus à un render() complet à chaque frappe :
// seul le total en bas se recalcule pour un changement de prix manuel.
function renderTotalOnly() {
  const val = $('.proj-total__value');
  if (val) val.textContent = `${totalTtc().toFixed(2)} €`;
}

function renderDelaiPaiement() {
  const box = el('div', 'proj-delai');
  const delaiRow = el('div', 'proj-delai__row');
  delaiRow.append(el('span', 'proj-delai__label', 'Pour le'));
  const chips = el('div', 'proj-chips');
  for (const d of DELAIS) {
    const chip = el('button', `proj-chip${d.id === state.delai ? ' is-on' : ''}`, d.label);
    chip.type = 'button';
    chip.addEventListener('click', () => { state.delai = d.id; renderCurrentPage(); });
    chips.appendChild(chip);
  }
  delaiRow.append(chips);
  box.append(delaiRow);

  const payRow = el('div', 'proj-delai__row');
  payRow.append(el('span', 'proj-delai__label', 'Paiement'));
  const payChips = el('div', 'proj-chips');
  for (const p of PAIEMENT_STATUTS) {
    const chip = el('button', `proj-chip${p.id === state.paiement ? ' is-on' : ''}`, p.label);
    chip.type = 'button';
    chip.addEventListener('click', () => { state.paiement = p.id; renderCurrentPage(); });
    payChips.appendChild(chip);
  }
  payRow.append(payChips);
  box.append(payRow);
  return box;
}

function renderTotalBar() {
  const bar = el('div', 'proj-total');
  const margeBtn = el('button', 'proj-marge-toggle');
  margeBtn.type = 'button';
  margeBtn.append(ic('visibility', 'proj-marge-toggle__ic'), el('span', null, 'Voir marge'));
  margeBtn.addEventListener('click', () => { state.margeVisible = !state.margeVisible; renderCurrentPage(); });
  bar.append(margeBtn);

  if (state.margeVisible && state.type === 'tasse') {
    const venteHt = totalTtc() / (1 + TARIFS_PARAMS.tgca);
    const marge = Math.round((venteHt - totalRevient()) * 100) / 100;
    const margeBox = el('div', 'proj-marge');
    margeBox.append(
      el('span', null, `Prix de revient : ${totalRevient().toFixed(2)} €`),
      el('span', null, `Marge HT : ${marge.toFixed(2)} €`),
    );
    bar.append(margeBox);
  }

  bar.append(el('span', 'proj-total__label', 'Total TTC'));
  bar.append(el('span', 'proj-total__value', `${totalTtc().toFixed(2)} €`));

  const saveBtn = el('button', 'proj-btn proj-btn--primary proj-btn--save', 'Enregistrer');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', () => { openDestinationPopup(); });
  bar.append(saveBtn);
  return bar;
}

// --- Destination + enregistrement --------------------------------------------
async function loadPipeline() {
  if (PIPELINE) return PIPELINE;
  const catalog = await api('GET', '/api/commande/catalog');
  PIPELINE = catalog.pipeline;
  return PIPELINE;
}

function buildPayload(kind, dest) {
  const isTasse = state.type === 'tasse';
  const nomParts = (state.client.nom || state.client.entreprise || '').split(' ');
  return {
    kind,
    type: state.type,
    client: state.client.type === 'perso'
      ? { type: 'perso', prenom: nomParts[0] || '', nom: nomParts.slice(1).join(' '), societe: state.client.entreprise, whatsapp: state.client.telephone, email: state.client.email }
      : { type: 'pro', facturation: state.client.entreprise, contact: state.client.nom, whatsapp: state.client.telephone, email: state.client.email },
    lignes: state.lignes.map((l) => (isTasse
      ? { quantite: l.quantite, produitId: l.produitId, coloris: l.coloris, face1Id: l.face1Id, face2Id: l.face2Id, dessousId: l.dessousId, batId: l.batId, remarque: l.remarque }
      : { quantite: l.quantite, description: l.description, prixTtcManuel: Number(l.prixTtcManuel) || 0 })),
    delai: state.delai,
    paiement: { statut: state.paiement },
    stage: dest ? dest.stage : undefined,
    subStage: dest ? dest.subStage : undefined,
  };
}

async function openDestinationPopup() {
  let pipeline;
  try {
    pipeline = await loadPipeline();
  } catch (err) {
    window.alert(err.message || 'Impossible de charger les destinations');
    return;
  }
  const overlay = el('div', 'proj-overlay');
  const card = el('div', 'proj-dest-card');
  card.append(el('p', 'proj-dest__eyebrow', 'Dernière étape'), el('h3', 'proj-dest__title', 'Où l’enregistrer ?'));

  const list = el('div', 'proj-dest__list');
  const choose = async (kind, stage, subStage) => {
    overlay.remove();
    try {
      const created = await api('POST', '/api/projets', buildPayload(kind, { stage, subStage }));
      showConfirmation(created);
    } catch (err) {
      window.alert(err.message || 'Enregistrement impossible');
    }
  };

  const demandeBtn = el('button', 'proj-dest__item', 'Demande — à chiffrer');
  demandeBtn.type = 'button';
  demandeBtn.addEventListener('click', () => choose('demande', 'demande', null));
  list.appendChild(demandeBtn);

  for (const fam of pipeline) {
    if (fam.subs && fam.subs.length) {
      for (const sub of fam.subs) {
        const b = el('button', 'proj-dest__item', `${fam.label} — ${sub.label}`);
        b.type = 'button';
        b.addEventListener('click', () => choose('commande', fam.slug, sub.slug));
        list.appendChild(b);
      }
    } else {
      const b = el('button', 'proj-dest__item', fam.label);
      b.type = 'button';
      b.addEventListener('click', () => choose('commande', fam.slug, null));
      list.appendChild(b);
    }
  }
  card.append(list);

  const close = el('button', 'proj-dest__close');
  close.type = 'button';
  close.append(ic('close'));
  close.addEventListener('click', () => overlay.remove());
  card.append(close);

  overlay.append(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  ROOT.appendChild(overlay);
}

function showConfirmation(created) {
  const overlay = el('div', 'proj-overlay');
  const card = el('div', 'proj-done-card');
  const checkWrap = el('div', 'proj-done__check');
  checkWrap.append(ic('check'));
  card.append(
    checkWrap,
    el('p', 'proj-done__title', 'Projet enregistré'),
    el('p', 'proj-done__sub', `${created.projet.prixTotalTtc.toFixed(2)} € TTC — ${created.projet.client.societe}`),
  );
  // Action la PLUS fréquente au comptoir : le même client repart sur un
  // produit différent (tasses ET textile dans la même visite) — mise en avant,
  // le client reste épinglé dans la colonne de gauche.
  const addAnother = el('button', 'proj-btn proj-btn--primary proj-btn--wide', '');
  addAnother.type = 'button';
  addAnother.append(ic('add'), el('span', null, 'Ajouter un produit pour ce client'));
  addAnother.addEventListener('click', () => { overlay.remove(); resetType(); });
  card.append(addAnother);

  const actions = el('div', 'proj-done__actions');
  const planning = el('a', 'proj-btn', 'Voir le planning');
  planning.href = '#planning';
  planning.addEventListener('click', () => overlay.remove());
  const nouveauClient = el('button', 'proj-btn', 'Nouveau client');
  nouveauClient.type = 'button';
  nouveauClient.addEventListener('click', () => { overlay.remove(); changeClient(); });
  actions.append(planning, nouveauClient);
  card.append(actions);
  overlay.append(card);
  ROOT.appendChild(overlay);
}

// --- Montage -------------------------------------------------------------------
function buildStatic() {
  const page = el('div', 'proj-page');
  const head = el('header', 'proj-bar');
  head.append(ic('bolt', 'proj-bar__ic'));
  head.append(el('h2', 'proj-bar__title', 'Nouveau Projet'));
  const stepper = el('div', 'proj-stepper');
  stepper.id = 'proj-stepper';
  head.append(stepper);
  const bodyEl = el('div', 'proj-body', '');
  bodyEl.id = 'proj-body';
  page.append(head, bodyEl);
  ROOT.replaceChildren(page);
}

let mounted = false;
export async function initProjet(root) {
  if (mounted) return;
  ROOT = root;
  mounted = true;
  buildStatic();
  try {
    [CLIENTS, TARIFS, TARIFS_PARAMS] = await Promise.all([
      api('GET', '/api/clients'), api('GET', '/api/tarifs-tasse'), api('GET', '/api/tarifs-tasse/parametres'),
    ]);
  } catch (_) { /* silencieux : les pages suivantes gèrent une liste vide */ }
  render();
}

// Un tap sur « Nouveau Projet » dans la nav ouvre TOUJOURS « Quel client ? »,
// même si un poste avait laissé une fiche en cours — comptoir = on repart net,
// on ne cherche jamais un brouillon abandonné entre deux clients.
export function resetProjet() {
  if (!mounted) return;
  state.page = 'client'; state.client = null; state.type = null; state.lignes = [];
  state.delai = 'j5'; state.paiement = 'non_paye'; state.margeVisible = false;
  render();
}
