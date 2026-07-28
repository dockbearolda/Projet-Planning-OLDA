// Nouveau Projet — Atelier OLDA
// LE flux comptoir : client (recherche/création) → panier (plusieurs produits,
// de types différents) → prix, façon caisse SumUp. Rendu entièrement par JS
// dans une section vide (même principe que clients.js / reglages.js), chargé
// à la demande par app.js.

import { fieldRow, fieldsForNature, wireCreateValidation, SECTEURS_SUGGERES } from './clients.js';

// Secteurs prédéfinis (Base Clients) : le champ `secteur` référence le
// datalist `cl-dl-secteurs`, construit par clients.js dans SON propre DOM.
// Nouveau Projet est chargé indépendamment (et peut être visité avant Base
// Clients) : sans ce datalist local, l'attribut `list` pointe dans le vide et
// aucune suggestion n'apparaît. Id distinct pour ne pas dupliquer `cl-dl-secteurs`
// si les deux vues finissent montées en même temps.
const PROJ_SECTEURS_DL_ID = 'proj-dl-secteurs';

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
// droite montre le panier + les tuiles d'ajout, ou le formulaire d'un produit
// en cours de configuration si `addingType` est posé).
// Un projet est un PANIER : plusieurs produits, de types DIFFÉRENTS (une
// tasse, un polo…), pour le même client et le même enregistrement — façon
// caisse SumUp, on encaisse tout d'un coup.
const state = {
  page: 'client',
  client: null,          // { id, entreprise, nom, telephone, email, type: 'pro'|'perso' } choisi ou créé
  panier: [],             // [{ uid, type, quantite, ...champs selon le type }]
  addingType: null,       // type en cours de configuration (formulaire ouvert), null = fermé
  addingLigne: null,      // brouillon de la ligne en cours d'ajout
  customOpen: false,      // marquage (faces/dessous/BAT) déplié ? réduit la densité par défaut
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
const typeLabel = (id) => (TYPES.find((t) => t.id === id) || {}).label || id;

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
  { id: 'produits', label: 'Produits' },
];

function currentStepIndex() { return state.page === 'client' ? 0 : 1; }

// Barre de progression visuelle (puces reliées), remplace le fil texte
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
  state.panier = [];
  state.addingType = null;
  state.addingLigne = null;
  render();
}

// Repart chercher un AUTRE client : sort de 'main' complètement.
function changeClient() {
  state.page = 'client'; state.client = null; state.panier = []; state.addingType = null; state.addingLigne = null;
  state.delai = 'j5'; state.paiement = 'non_paye'; state.margeVisible = false;
  render();
}

// Même client, panier vidé (après enregistrement) : un client commande
// souvent plusieurs types différents dans la même visite — pas besoin de le
// rechercher une deuxième fois.
function resetPanier() {
  state.panier = []; state.addingType = null; state.addingLigne = null;
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

  const pick = (c) => {
    const nature = c.client_type === 'perso' ? 'perso' : 'pro';
    goToClient({
      id: c.id, entreprise: c.entreprise, nom: c.nom, telephone: c.telephone,
      email: c.email, type: nature,
    });
  };

  const renderResults = () => {
    results.replaceChildren();
    if (!input.value.trim()) return;
    for (const c of matchClients(input.value)) {
      const item = el('button', 'proj-client__item');
      item.type = 'button';
      const nature = c.client_type === 'perso' ? 'perso' : 'pro';
      item.append(
        el('span', 'proj-client__name', c.client_type === 'perso' ? (c.nom || c.entreprise) : c.entreprise),
        el('span', 'proj-client__meta', [c.telephone, nature === 'perso' ? 'Particulier' : 'Pro'].filter(Boolean).join(' · ')),
      );
      item.addEventListener('click', () => pick(c));
      results.appendChild(item);
    }
  };
  input.addEventListener('input', renderResults);
  renderResults();

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

    // Teinte légère façon SumUp : vert Particulier, ambre Pro — même palette
    // que la fiche complète (Base Clients).
    quickForm.classList.toggle('proj-quick--perso', nature === 'perso');
    quickForm.classList.toggle('proj-quick--pro', nature !== 'perso');

    const fieldsWrap = el('div', 'proj-quick__fields');
    for (const f of fieldsForNature(nature)) {
      const field = f.key === 'secteur' ? { ...f, list: PROJ_SECTEURS_DL_ID } : f;
      fieldsWrap.appendChild(fieldRow(field, ''));
    }
    quickForm.appendChild(fieldsWrap);
    const inputs = [...fieldsWrap.querySelectorAll('.cl-f__input')];

    const createBtn = el('button', 'proj-btn proj-btn--primary', 'Créer et continuer');
    createBtn.type = 'button';
    quickForm.appendChild(createBtn);

    // Le bouton reste cliquable même incomplet : wireCreateValidation gère la
    // confirmation « créer quand même » (voir clients.js) plutôt que de
    // bloquer purement et simplement la création.
    wireCreateValidation(fieldsWrap, createBtn, async () => {
      createBtn.disabled = true;
      const draft = { client_type: nature };
      for (const i of inputs) draft[i.dataset.key] = i.value.trim();
      // `entreprise` reste la colonne obligatoire côté serveur et sert à la
      // recherche/l'affichage : pour un particulier, on la dérive du prénom +
      // nom plutôt que de la demander une deuxième fois.
      if (nature === 'perso') draft.entreprise = `${draft.prenom} ${draft.nom}`.trim();
      try {
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
    inputs[0].focus();
  };
  newBtn.addEventListener('click', () => renderQuickForm('pro'));

  body.appendChild(wrap);
  input.focus();
}

// --- Colonne de gauche : client épinglé ------------------------------------------
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
  if (state.addingType) renderAddForm(main);
  else renderPanier(main);
  layout.append(main);
  body.append(layout);
}

// --- Catalogue tarifs tasse : accès rapide ---------------------------------------
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

// --- Panier : prix, description, rendu -------------------------------------------
function calcItemTtc(item) {
  return item.type === 'tasse' ? calcLigneTasseTtc(item) : (Number(item.prixTtcManuel) || 0);
}
function calcItemRevient(item) {
  return item.type === 'tasse' ? calcLigneTasseRevient(item) : 0;
}
function describeItem(item) {
  if (item.type === 'tasse') {
    const produit = tarifById(item.produitId);
    const opts = [item.face1Id, item.face2Id, item.dessousId].map(tarifById)
      .filter((a) => a && a.designation !== 'Aucune').map((a) => a.designation);
    return `${item.quantite} × ${produit ? produit.designation : 'Tasse'}${item.coloris ? ` (${item.coloris})` : ''}${opts.length ? ` — ${opts.join(', ')}` : ''}`;
  }
  return `${item.quantite} × ${item.description || '—'}`;
}

function totalTtc() {
  const base = state.panier.reduce((s, item) => s + calcItemTtc(item), 0);
  const delai = DELAIS.find((d) => d.id === state.delai) || DELAIS[2];
  return Math.round(base * (1 + delai.majoration / 100) * 100) / 100;
}
function totalRevient() {
  return state.panier.reduce((s, item) => s + calcItemRevient(item), 0);
}

function renderPanierItem(item) {
  const row = el('div', 'proj-cart-item');
  const info = el('div', 'proj-cart-item__info');
  info.append(el('span', 'proj-cart-item__type', typeLabel(item.type)));
  info.append(el('span', 'proj-cart-item__desc', describeItem(item)));
  row.append(info);
  row.append(el('span', 'proj-cart-item__prix', `${calcItemTtc(item).toFixed(2)} €`));
  const rm = el('button', 'proj-cart-item__del');
  rm.type = 'button';
  rm.append(ic('close'));
  rm.addEventListener('click', () => {
    state.panier = state.panier.filter((x) => x.uid !== item.uid);
    render();
  });
  row.append(rm);
  return row;
}

// --- Colonne de droite : panier + tuiles d'ajout ---------------------------------
function renderPanier(main) {
  const vide = state.panier.length === 0;

  if (!vide) {
    main.append(el('h3', 'proj-step__title', 'Panier'));
    const list = el('div', 'proj-lignes');
    state.panier.forEach((item) => list.appendChild(renderPanierItem(item)));
    main.append(list);
  }

  const tilesWrap = vide ? el('div', 'proj-center') : el('div');
  tilesWrap.append(el('h3', vide ? 'proj-step__title' : 'proj-addmore__title', vide ? 'Quel type de projet ?' : 'Ajouter un autre produit'));
  const grid = el('div', 'proj-type__grid');
  for (const t of TYPES) {
    const tile = el('button', 'proj-tile');
    tile.type = 'button';
    const circle = el('span', 'proj-tile__circle');
    circle.append(ic(t.icon, 'proj-tile__ic'));
    tile.append(circle, el('span', 'proj-tile__label', t.label));
    tile.addEventListener('click', () => startAdding(t.id));
    grid.appendChild(tile);
  }
  tilesWrap.append(grid);
  main.append(tilesWrap);

  main.append(renderDelaiPaiement());
  main.append(renderTotalBar());
}

// --- Formulaire d'ajout d'un produit au panier ------------------------------------
function startAdding(typeId) {
  state.addingType = typeId;
  state.addingLigne = typeId === 'tasse' ? newTasseLigne() : newSommaireLigne();
  state.customOpen = false;
  render();
}
function cancelAdding() {
  state.addingType = null; state.addingLigne = null;
  render();
}
function confirmAdd() {
  const l = state.addingLigne;
  if (state.addingType === 'tasse') {
    if (!l.produitId) { window.alert('Choisis un type de tasse.'); return; }
  } else if (!l.description.trim()) {
    window.alert('Ajoute une description.'); return;
  }
  state.panier.push({ ...l, type: state.addingType });
  state.addingType = null; state.addingLigne = null;
  render();
}

// --- Briques tactiles du formulaire produit ----------------------------------
// Le comptoir se pilote au doigt : pas de <select>, que des gros boutons.
function groupBox(label) {
  const g = el('div', 'proj-group');
  g.append(el('p', 'proj-group__label', label));
  return g;
}

// Stepper « − 1 + » : gros boutons tactiles, saisie directe possible au centre
// (validée au blur/Entrée pour ne pas perdre le focus à chaque chiffre).
function qtyStepper(get, set) {
  const box = el('div', 'proj-stepq');
  const commit = (n) => { set(Math.max(1, n || 1)); renderCurrentPage(); };
  const minus = el('button', 'proj-stepq__btn');
  minus.type = 'button';
  minus.setAttribute('aria-label', 'Diminuer la quantité');
  minus.append(ic('remove'));
  minus.addEventListener('click', () => commit(get() - 1));
  const val = el('input', 'proj-stepq__val');
  val.type = 'number'; val.min = '1'; val.inputMode = 'numeric'; val.value = String(get());
  val.addEventListener('change', () => commit(Number.parseInt(val.value, 10)));
  const plus = el('button', 'proj-stepq__btn');
  plus.type = 'button';
  plus.setAttribute('aria-label', 'Augmenter la quantité');
  plus.append(ic('add'));
  plus.addEventListener('click', () => commit(get() + 1));
  box.append(minus, val, plus);
  return box;
}

// Rangée de chips : une option = un gros bouton, prix affiché dessus.
// `none` : l'option « Aucune » (ou `noneDesign`) est montrée active tant que
// rien n'est choisi — l'état par défaut se voit, pas de case vide ambiguë.
function choiceChips(options, value, onPick, opts = {}) {
  const wrap = el('div', `proj-choices${opts.duo ? ' proj-choices--duo' : ''}`);
  const noneName = opts.noneDesign || 'Aucune';
  for (const o of options) {
    const isNone = o.designation === noneName;
    const on = value === o.id || (opts.none && isNone && !value);
    const b = el('button', `proj-choice${on ? ' is-on' : ''}`);
    b.type = 'button';
    b.append(el('span', 'proj-choice__txt', o.designation));
    if (o.prixVenteTtc) b.append(el('span', 'proj-choice__prix', `+${o.prixVenteTtc.toFixed(2)} €`));
    b.addEventListener('click', () => { onPick(o.id); renderCurrentPage(); });
    wrap.appendChild(b);
  }
  return wrap;
}

// Coloris en pastilles cliquables ; « Autre » ouvre une saisie libre — le champ
// texte reste disponible pour les teintes hors palette, jamais imposé.
const COLORIS = [
  { label: 'Blanc', hex: '#f5f5f0' }, { label: 'Noir', hex: '#1f1f1f' },
  { label: 'Rouge', hex: '#d64541' }, { label: 'Bleu', hex: '#3b82f6' },
  { label: 'Vert', hex: '#10b981' }, { label: 'Jaune', hex: '#f4c542' },
  { label: 'Rose', hex: '#ec6fa9' }, { label: 'Orange', hex: '#f08a24' },
];
function colorSwatches(l) {
  const box = el('div');
  const wrap = el('div', 'proj-swatches');
  const known = COLORIS.some((c) => c.label === l.coloris);
  for (const c of COLORIS) {
    const b = el('button', `proj-swatch${l.coloris === c.label ? ' is-on' : ''}`);
    b.type = 'button';
    const dot = el('span', 'proj-swatch__dot');
    dot.style.background = c.hex;
    b.append(dot, el('span', 'proj-swatch__label', c.label));
    b.addEventListener('click', () => { l.coloris = c.label; l.colorisAutre = false; renderCurrentPage(); });
    wrap.appendChild(b);
  }
  const autreOn = l.colorisAutre || (!!l.coloris && !known);
  const autre = el('button', `proj-swatch${autreOn ? ' is-on' : ''}`);
  autre.type = 'button';
  autre.append(el('span', 'proj-swatch__dot proj-swatch__dot--autre'), el('span', 'proj-swatch__label', 'Autre'));
  autre.addEventListener('click', () => { l.colorisAutre = true; if (known) l.coloris = ''; renderCurrentPage(); });
  wrap.appendChild(autre);
  box.append(wrap);
  if (autreOn) {
    const input = el('input', 'proj-input proj-swatch-input');
    input.placeholder = 'Coloris personnalisé…';
    input.value = known ? '' : l.coloris;
    input.addEventListener('input', () => { l.coloris = input.value; });
    box.append(input);
  }
  return box;
}

function renderTasseFields(l) {
  const card = el('div', 'proj-form');

  const gQty = groupBox('Quantité');
  gQty.append(qtyStepper(() => l.quantite, (n) => { l.quantite = n; }));
  card.append(gQty);

  const gProd = groupBox('Type de tasse');
  gProd.append(choiceChips(tarifsByCat('produit'), l.produitId, (v) => { l.produitId = v; }));
  card.append(gProd);

  const gCol = groupBox('Coloris');
  gCol.append(colorSwatches(l));
  card.append(gCol);

  // Personnalisation (faces, dessous, BAT) repliée par défaut : un objectif à
  // la fois — la quantité, le modèle et le coloris d'abord, le marquage
  // seulement pour qui en a besoin. Toujours calculée dans le prix même
  // fermée (les valeurs restent posées sur `l` si l'employé rouvre puis
  // referme sans toucher — rien n'est perdu).
  if (!state.customOpen) {
    const gToggle = groupBox('');
    const openBtn = el('button', 'proj-choice proj-choice--add');
    openBtn.type = 'button';
    openBtn.append(ic('add'), el('span', 'proj-choice__txt', 'Ajouter un marquage (logo, texte, QR code…)'));
    openBtn.addEventListener('click', () => { state.customOpen = true; renderCurrentPage(); });
    gToggle.append(openBtn);
    card.append(gToggle);
  } else {
    const gF1 = groupBox('Face 1 · anse à droite');
    gF1.append(choiceChips(tarifsByCat('face'), l.face1Id, (v) => { l.face1Id = v; }, { none: true }));
    card.append(gF1);

    const gF2 = groupBox('Face 2 · anse à gauche');
    gF2.append(choiceChips(tarifsByCat('face'), l.face2Id, (v) => { l.face2Id = v; }, { none: true }));
    card.append(gF2);

    const gDs = groupBox('Dessous');
    gDs.append(choiceChips(tarifsByCat('dessous'), l.dessousId, (v) => { l.dessousId = v; }, { none: true }));
    card.append(gDs);

    const gBat = groupBox('BAT avant production');
    gBat.append(choiceChips(tarifsByCat('bat'), l.batId, (v) => { l.batId = v; }, { none: true, noneDesign: 'Non', duo: true }));
    card.append(gBat);
  }

  return card;
}

function renderAddForm(main) {
  const back = el('button', 'proj-back', '← Annuler');
  back.type = 'button';
  back.addEventListener('click', cancelAdding);
  main.append(back, el('h3', 'proj-step__title', typeLabel(state.addingType)));

  const l = state.addingLigne;
  if (state.addingType === 'tasse') {
    main.append(renderTasseFields(l));
  } else {
    const card = el('div', 'proj-form');
    const gDesc = groupBox('Description');
    const desc = el('textarea', 'proj-textarea');
    desc.placeholder = '5 polos brodés équipe, taille M à XL…';
    desc.value = l.description;
    desc.rows = 3;
    desc.addEventListener('input', () => { l.description = desc.value; });
    gDesc.append(desc);
    card.append(gDesc);

    const gQty = groupBox('Quantité');
    gQty.append(qtyStepper(() => l.quantite, (n) => { l.quantite = n; }));
    card.append(gQty);

    const gPrix = groupBox('Prix TTC (€)');
    const prix = el('input', 'proj-input proj-input--lg');
    prix.type = 'number'; prix.min = '0'; prix.step = '0.01'; prix.inputMode = 'decimal';
    prix.placeholder = '0,00';
    prix.value = l.prixTtcManuel;
    prix.addEventListener('input', () => { l.prixTtcManuel = prix.value; });
    prix.addEventListener('change', renderCurrentPage);
    gPrix.append(prix);
    card.append(gPrix);
    main.append(card);
  }

  // CTA façon caisse : barre collée en bas, prix de la ligne + gros bouton
  // pleine largeur — jamais un petit bouton perdu sous le formulaire.
  const bar = el('div', 'proj-total');
  const row = el('div', 'proj-total__row');
  row.append(
    el('span', 'proj-total__label', 'Prix de cette ligne'),
    el('span', 'proj-total__value', `${calcItemTtc({ ...l, type: state.addingType }).toFixed(2)} €`),
  );
  bar.append(row);
  const addBtn = el('button', 'proj-btn proj-btn--primary proj-btn--cta', '');
  addBtn.type = 'button';
  addBtn.append(ic('add'), el('span', null, 'Ajouter au panier'));
  addBtn.addEventListener('click', confirmAdd);
  bar.append(addBtn);
  main.append(bar);
}

// Segments pleine largeur : un choix = un gros bouton, l'option active se voit
// de loin — remplace les petites pilules serrées.
function segBar(items, activeId, onPick, cols) {
  const seg = el('div', `proj-segbar proj-segbar--cols${cols}`);
  for (const it of items) {
    const b = el('button', `proj-segbar__btn${it.id === activeId ? ' is-on' : ''}`);
    b.type = 'button';
    b.append(el('span', 'proj-segbar__txt', it.label));
    if (it.majoration) b.append(el('span', 'proj-segbar__sub', `+${it.majoration} %`));
    b.addEventListener('click', () => { onPick(it.id); renderCurrentPage(); });
    seg.appendChild(b);
  }
  return seg;
}

function renderDelaiPaiement() {
  const box = el('div', 'proj-delai');
  const gD = groupBox('Pour le');
  gD.append(segBar(DELAIS, state.delai, (id) => { state.delai = id; }, 5));
  box.append(gD);
  const gP = groupBox('Paiement');
  gP.append(segBar(PAIEMENT_STATUTS, state.paiement, (id) => { state.paiement = id; }, 3));
  box.append(gP);
  return box;
}

function renderTotalBar() {
  const bar = el('div', 'proj-total');
  const row = el('div', 'proj-total__row');

  // Marge cachée par défaut (info interne, pas pour les yeux du client au
  // comptoir) : une simple icône œil discrète, sans libellé qui attire l'œil.
  const margeBtn = el('button', 'proj-marge-toggle');
  margeBtn.type = 'button';
  margeBtn.setAttribute('aria-label', state.margeVisible ? 'Masquer la marge' : 'Afficher la marge (interne)');
  margeBtn.title = state.margeVisible ? 'Masquer la marge' : 'Marge (interne)';
  margeBtn.append(ic(state.margeVisible ? 'visibility_off' : 'visibility', 'proj-marge-toggle__ic'));
  margeBtn.addEventListener('click', () => { state.margeVisible = !state.margeVisible; renderCurrentPage(); });
  row.append(margeBtn);

  row.append(el('span', 'proj-total__label', 'Total TTC'));
  row.append(el('span', 'proj-total__value', `${totalTtc().toFixed(2)} €`));
  bar.append(row);

  if (state.margeVisible) {
    const venteHt = totalTtc() / (1 + TARIFS_PARAMS.tgca);
    const marge = Math.round((venteHt - totalRevient()) * 100) / 100;
    const margeBox = el('div', 'proj-marge');
    margeBox.append(
      el('span', null, `Prix de revient : ${totalRevient().toFixed(2)} €`),
      el('span', null, `Marge HT : ${marge.toFixed(2)} €`),
    );
    bar.append(margeBox);
  }

  const saveBtn = el('button', 'proj-btn proj-btn--primary proj-btn--cta', 'Enregistrer');
  saveBtn.type = 'button';
  saveBtn.disabled = state.panier.length === 0;
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
  const nomParts = (state.client.nom || state.client.entreprise || '').split(' ');
  return {
    kind,
    client: state.client.type === 'perso'
      ? { type: 'perso', prenom: nomParts[0] || '', nom: nomParts.slice(1).join(' '), societe: state.client.entreprise, whatsapp: state.client.telephone, email: state.client.email }
      : { type: 'pro', facturation: state.client.entreprise, contact: state.client.nom, whatsapp: state.client.telephone, email: state.client.email },
    lignes: state.panier.map((item) => (item.type === 'tasse'
      ? { type: item.type, quantite: item.quantite, produitId: item.produitId, coloris: item.coloris, face1Id: item.face1Id, face2Id: item.face2Id, dessousId: item.dessousId, batId: item.batId, remarque: item.remarque }
      : { type: item.type, quantite: item.quantite, description: item.description, prixTtcManuel: Number(item.prixTtcManuel) || 0 })),
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
  // nouveau panier (tasses ET textile dans la même visite) — mise en avant,
  // le client reste épinglé dans la colonne de gauche.
  const addAnother = el('button', 'proj-btn proj-btn--primary proj-btn--wide', '');
  addAnother.type = 'button';
  addAnother.append(ic('add'), el('span', null, 'Nouveau panier pour ce client'));
  addAnother.addEventListener('click', () => { overlay.remove(); resetPanier(); });
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
  const dlSecteurs = el('datalist');
  dlSecteurs.id = PROJ_SECTEURS_DL_ID;
  dlSecteurs.append(...SECTEURS_SUGGERES.map((s) => new Option(s)));
  ROOT.replaceChildren(page, dlSecteurs);
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
  state.page = 'client'; state.client = null; state.panier = []; state.addingType = null; state.addingLigne = null;
  state.delai = 'j5'; state.paiement = 'non_paye'; state.margeVisible = false;
  render();
}
