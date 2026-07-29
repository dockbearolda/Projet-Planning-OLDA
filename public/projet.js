// Nouveau Projet — Atelier OLDA
// LE flux comptoir : client (recherche/création) → panier (plusieurs produits,
// de types différents) → prix, façon caisse SumUp. Rendu entièrement par JS
// dans une section vide (même principe que clients.js / reglages.js), chargé
// à la demande par app.js.

import {
  wireVilleDefaults, applyCasse, formatPhoneAsTyped,
  registerSecteurDatalist, loadSecteurs, valeurSaisie, VILLES,
} from './clients.js';

// Secteurs prédéfinis (Base Clients) : le champ `secteur` référence le
// datalist `cl-dl-secteurs`, construit par clients.js dans SON propre DOM.
// Nouveau Projet est chargé indépendamment (et peut être visité avant Base
// Clients) : sans ce datalist local, l'attribut `list` pointe dans le vide et
// aucune suggestion n'apparaît. Id distinct pour ne pas dupliquer `cl-dl-secteurs`
// si les deux vues finissent montées en même temps.
const PROJ_SECTEURS_DL_ID = 'proj-dl-secteurs';
const PROJ_VILLES_DL_ID = 'proj-dl-villes';

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
  // Écran « Nouveau client » (étape 1). Le brouillon et l'état du bloc replié
  // vivent ICI, pas dans le DOM : basculer Pro ↔ Particulier re-rend le
  // formulaire, et ce qui est déjà tapé ne doit pas partir avec.
  clientForm: null,           // null = recherche ; 'pro' | 'perso' = formulaire ouvert
  clientDraft: {},            // { [clé envoyée à l'API]: valeur tapée }
  clientErreur: null,         // clé du champ en erreur, une seule à la fois
  // DÉLAI OBLIGATOIRE : rien n'est pré-coché, l'enregistrement est bloqué tant
  // qu'on n'a pas tranché — c'est ce qui garantit une date butoir sur CHAQUE
  // ligne du planning. Soit un raccourci (`delai`), soit une date précise
  // (`deadline`, « aaaa-mm-jj ») ; jamais les deux.
  delai: null,
  deadline: '',
  paiement: newPaiement(),
  margeVisible: false,
};

// Suivi du paiement d'un projet : UN statut, plus ce qu'il implique. `null` =
// pas encore renseigné — au comptoir on ne sait pas toujours, et « on ne sait
// pas » ne doit pas s'enregistrer comme « non ».
function newPaiement() {
  return { statut: null, acompteMontant: '', modeAcompte: null, modeFinal: null };
}

let CLIENTS = [];
let TARIFS = [];
let TARIFS_PARAMS = { tauxHoraireMo: 25, tauxHoraireMachine: 25, tgca: 0.04 };
let PIPELINE = null;   // chargé à la demande (familles + sous-étapes)

// Catalogue partagé avec la Saisie détaillée (vêtements, tailles, emplacements,
// typos, types de logo) : on s'y branche plutôt que de recopier ces listes, pour
// qu'un emplacement ajouté au comptoir apparaisse ici aussitôt. Valeurs de repli
// pour que le formulaire reste utilisable si l'appel échoue.
let CAT = {
  vetements: [], taillesGrille: ['XS', 'S', 'M', 'L', 'XL', '2XL'], zones: [], typos: [], typeLogos: [],
};

// Les deux faces marquables d'un textile (miroir de PROJET_FACES_TEXTILE côté
// serveur, qui valide).
const FACES_TEXTILE = [
  { id: 'avant', label: 'Face avant' },
  { id: 'arriere', label: 'Face arrière' },
];

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

// Modes de paiement (miroir de catalog.json → commande.paiementModes, que le
// serveur valide).
const PAIEMENT_MODES = [
  { id: 'cb', label: 'CB' },
  { id: 'especes', label: 'Espèces' },
  { id: 'virement', label: 'Virement' },
  { id: 'cheque', label: 'Chèque' },
];

// Où en est l'argent, en UN choix (miroir de PROJET_PAY_STATUTS côté serveur,
// qui en fait la projection sur les colonnes du planning).
const PAIEMENT_STATUTS = [
  { id: 'non_demande', label: 'Non demandé' },
  { id: 'acompte_demande', label: 'Acompte demandé' },
  { id: 'acompte_recu', label: 'Acompte reçu' },
  { id: 'a_encaisser', label: 'À encaisser' },
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

// L'en-tête annonce l'écran courant. Sur « Nouveau client », le titre prend la
// place de la marque (avec un sur-titre discret qui rappelle le flux) et le
// stepper file à droite : on lit d'abord ce qu'on est en train de faire.
function renderBar() {
  const brand = $('#proj-bar-brand');
  if (!brand) return;
  const nc = state.page === 'client' && !!state.clientForm;
  const page = ROOT.querySelector('.proj-page');
  if (page) page.classList.toggle('is-nouveau-client', nc);
  brand.replaceChildren();
  if (nc) {
    brand.append(
      el('p', 'proj-bar__over', 'NOUVEAU PROJET'),
      el('h2', 'proj-bar__title proj-bar__title--nc', 'Nouveau client'),
    );
    return;
  }
  brand.append(ic('bolt', 'proj-bar__ic'), el('h2', 'proj-bar__title', 'Nouveau Projet'));
}

function render() {
  renderBar();
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
  state.delai = null; state.deadline = ''; state.paiement = newPaiement(); state.margeVisible = false;
  render();
}

// Même client, panier vidé (après enregistrement) : un client commande
// souvent plusieurs types différents dans la même visite — pas besoin de le
// rechercher une deuxième fois.
function resetPanier() {
  state.panier = []; state.addingType = null; state.addingLigne = null;
  state.delai = null; state.deadline = ''; state.paiement = newPaiement(); state.margeVisible = false;
  render();
}

function renderClientPage(body) {
  if (state.clientForm) return renderNouveauClient(body);
  return renderClientSearch(body);
}

function renderClientSearch(body) {
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

  newBtn.addEventListener('click', () => {
    state.clientForm = 'pro';
    state.clientDraft = {};
    state.clientErreur = null;
    render();
  });

  body.appendChild(wrap);
  input.focus();
}

// --- Écran « Nouveau client » ----------------------------------------------------
// UNE colonne, trois champs à l'ouverture, le reste replié : le comptoir crée
// une fiche en trois frappes et complète l'adresse plus tard s'il l'a. Les clés
// (`entreprise`, `telephone`, `referent_prenom`…) sont celles que l'API attend,
// inchangées — c'est l'écran qu'on refait, pas le contrat.
const NC_IDENTITE = {
  pro: { key: 'entreprise', label: 'Nom de l’entreprise', ph: '100% Villas' },
  // Le particulier saisit son nom en UNE ligne (trois champs à l'écran, pas
  // quatre) ; `prenom` et `nom` sont reconstitués à l'enregistrement.
  perso: { key: 'nom_complet', label: 'Nom et prénom', ph: 'Jean Dupont' },
};
const NC_CONTACT = [
  { key: 'telephone', label: 'Téléphone (WhatsApp)', ph: '06 42 26 69 49', type: 'tel', inputmode: 'tel' },
  { key: 'email', label: 'E-mail', ph: 'contact@entreprise.fr', type: 'email', inputmode: 'email' },
];
// Section « Adresse et détails » : toujours visible, jamais bloquante. `pleine`
// = le champ prend la largeur de la carte (une adresse ou une raison sociale
// n'a rien à faire dans une demi-colonne).
const NC_DETAILS = [
  { key: 'adresse', label: 'Adresse', ph: '12 rue de la République', pleine: true },
  { key: 'ville', label: 'Ville', ph: 'Saint-Martin', list: PROJ_VILLES_DL_ID, demi: true },
  { key: 'code_postal', label: 'Code postal', ph: '97150', demi: true },
  { key: 'secteur', label: 'Secteur d’activité', ph: 'Hôtellerie, BTP…', list: PROJ_SECTEURS_DL_ID },
  { key: 'referent_prenom', label: 'Référent', ph: 'Marie', casse: 'initiales' },
  { key: 'raison_sociale', label: 'Raison sociale EBP', ph: 'SARL 100 % Villas' },
];

// Les clés que la nature courante a le droit d'envoyer. Le brouillon, lui,
// garde TOUT ce qui a été tapé (basculer Pro ↔ Particulier ne doit rien faire
// perdre) : sans ce filtre, une adresse saisie côté Pro partirait sur la fiche
// d'un particulier qui n'en a jamais eu.
function ncKeys(nature) {
  const contact = NC_CONTACT.map((f) => f.key);
  if (nature === 'perso') return new Set(contact);
  return new Set([NC_IDENTITE.pro.key, ...contact, ...NC_DETAILS.map((f) => f.key)]);
}

// Un champ = son étiquette (casse normale, pas d'icône), son champ toujours
// bordé, et la place du message d'erreur juste dessous.
function ncField(f, { requis = false } = {}) {
  const row = el('div', 'pjc-f');
  const lab = el('label', 'pjc-f__label');
  lab.append(el('span', null, f.label));
  if (!requis) lab.append(el('span', 'pjc-f__opt', ' — optionnel'));
  const input = el('input', 'pjc-input');
  input.type = f.type || 'text';
  if (f.inputmode) input.inputMode = f.inputmode;
  if (f.list) input.setAttribute('list', f.list);
  input.placeholder = f.ph || '';
  input.autocomplete = 'off';
  input.dataset.key = f.key;
  input.value = state.clientDraft[f.key] || '';
  input.id = `pjc-f-${f.key}`;
  lab.setAttribute('for', input.id);

  // Le brouillon suit la frappe : basculer Pro ↔ Particulier ou déplier les
  // détails re-rend le formulaire sans rien perdre.
  input.addEventListener('input', () => {
    // Le regroupement des chiffres passe AVANT la mise au brouillon : c'est le
    // numéro affiché qu'on garde, pas celui d'avant reformatage.
    if (f.type === 'tel') formatPhoneAsTyped(input);
    state.clientDraft[f.key] = input.value;
    // « L'erreur s'efface dès la première frappe » : on ne laisse jamais un
    // cadre rouge sur un champ qu'on est en train de corriger.
    if (state.clientErreur === f.key) {
      state.clientErreur = null;
      row.classList.remove('is-error');
      const msg = row.querySelector('.pjc-f__err');
      if (msg) msg.remove();
    }
  });
  // Le code postal posé par le choix d'une ville arrive par `change`, pas par
  // la frappe : sans ça il s'afficherait sans jamais rejoindre le brouillon.
  input.addEventListener('change', () => { state.clientDraft[f.key] = input.value; });
  if (f.casse) {
    input.addEventListener('blur', () => {
      const next = applyCasse(f.casse, input.value);
      if (next !== input.value) { input.value = next; state.clientDraft[f.key] = next; }
    });
  }

  row.append(lab, input);
  if (f.pleine) row.classList.add('pjc-f--pleine');
  if (state.clientErreur === f.key) {
    row.classList.add('is-error');
    const err = el('p', 'pjc-f__err');
    err.append(el('span', 'pjc-f__err-dot', '!'), el('span', null, `${f.label} est obligatoire.`));
    row.append(err);
  }
  return row;
}

function renderNouveauClient(body) {
  const nature = state.clientForm;
  body.replaceChildren();
  const screen = el('div', 'pjc-screen');
  const card = el('form', 'pjc-card');
  card.noValidate = true;
  const champs = el('div', 'pjc-card__body');

  // Pro / Particulier : deux jeux de champs, pas deux formulaires. Seule
  // l'identité change de nom.
  const seg = el('div', 'pjc-seg');
  for (const n of [{ id: 'pro', label: 'Pro' }, { id: 'perso', label: 'Particulier' }]) {
    const b = el('button', `pjc-seg__btn${n.id === nature ? ' is-on' : ''}`, n.label);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (state.clientForm === n.id) return;
      state.clientForm = n.id;
      state.clientErreur = null;
      render();
    });
    seg.appendChild(b);
  }
  champs.append(seg);

  const identite = NC_IDENTITE[nature];
  const idRow = ncField(identite, { requis: true });
  idRow.classList.add('pjc-f--pleine');
  champs.append(idRow);
  // Téléphone et e-mail côte à côte : deux coordonnées courtes, une seule ligne.
  for (const f of NC_CONTACT) champs.append(ncField(f));

  // Le particulier n'a ni adresse ni facturation dans sa fiche : rien à lui
  // montrer ici, la section resterait vide.
  if (nature === 'pro') {
    const bloc = el('section', 'pjc-more');
    const tete = el('div', 'pjc-more__head');
    tete.append(
      el('h3', 'pjc-more__title', 'Adresse et détails'),
      el('p', 'pjc-more__sub', 'Adresse, secteur, référent, facturation.'),
    );
    bloc.append(tete);

    const grille = el('div', 'pjc-more__fields');
    // Ville et code postal partagent une ligne : deux informations d'une même
    // adresse, la seconde tient en 150px.
    let paire = null;
    for (const f of NC_DETAILS) {
      const row = ncField(f);
      if (f.demi) {
        if (!paire) { paire = el('div', 'pjc-pair'); grille.append(paire); }
        paire.append(row);
      } else {
        paire = null;
        grille.append(row);
      }
    }
    bloc.append(grille);
    // Choisir une ville connue remplit le code postal, sans jamais écraser
    // une valeur tapée à la main.
    wireVilleDefaults(grille, null, '.pjc-input');
    champs.append(bloc);
  }

  card.append(champs);

  const actions = el('div', 'pjc-actions');
  const createBtn = el('button', 'pjc-btn pjc-btn--primary', 'Créer et continuer');
  createBtn.type = 'submit';
  const annuler = el('button', 'pjc-btn pjc-btn--ghost', 'Annuler');
  annuler.type = 'button';
  annuler.addEventListener('click', () => {
    state.clientForm = null;
    state.clientErreur = null;
    render();
  });
  actions.append(createBtn, annuler);
  card.append(actions);

  card.addEventListener('submit', async (e) => {
    e.preventDefault();
    const identiteSaisie = String(state.clientDraft[identite.key] || '').trim();
    if (!identiteSaisie) {
      state.clientErreur = identite.key;
      render();
      const champ = $(`#pjc-f-${identite.key}`);
      if (champ) champ.focus();
      return;
    }
    createBtn.disabled = true;
    const autorisees = ncKeys(nature);
    const draft = { client_type: nature };
    for (const [key, val] of Object.entries(state.clientDraft)) {
      if (autorisees.has(key)) draft[key] = valeurSaisie(key, val);
    }
    // Le pays ne se demande plus (il se déduit de la ville) mais il continue
    // de s'enregistrer : sans ça la colonne se viderait en silence pour tous
    // les clients créés ici, et la fiche complète s'ouvrirait incomplète.
    const villeConnue = VILLES.find((v) => fold(v.label) === fold(draft.ville || ''));
    if (villeConnue) draft.pays = villeConnue.pays;
    if (nature === 'perso') {
      // Un particulier tape « Prénom Nom » ; la base, elle, garde les deux
      // séparés (et leur casse : Jean / DUPONT). Un seul mot = un nom.
      const mots = identiteSaisie.split(/\s+/);
      draft.prenom = mots.length > 1 ? applyCasse('initiales', mots[0]) : '';
      draft.nom = applyCasse('majuscules', (mots.length > 1 ? mots.slice(1) : mots).join(' '));
      // `entreprise` reste la colonne obligatoire côté serveur et sert à la
      // recherche/l'affichage : pour un particulier, on la dérive du prénom +
      // nom plutôt que de la demander une deuxième fois.
      draft.entreprise = `${draft.prenom} ${draft.nom}`.trim();
    }
    try {
      const created = await api('POST', '/api/clients', draft);
      CLIENTS.push(created);
      state.clientForm = null;
      state.clientDraft = {};
        goToClient({
        id: created.id, entreprise: created.entreprise, nom: created.nom,
        telephone: created.telephone, email: created.email, type: nature,
      });
    } catch (err) {
      createBtn.disabled = false;
      window.alert(err.message || 'Création impossible');
    }
  });

  screen.append(card);
  body.appendChild(screen);
  const premier = $(`#pjc-f-${identite.key}`);
  if (premier) premier.focus();
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

// Chaque famille a sa propre fiche de production. `prixUnitaireTtc` vide = « pas
// encore saisi » : pour la tasse, la grille tarifaire fait alors foi.
const uid = () => Math.random().toString(36).slice(2);

function newTasseLigne() {
  return {
    uid: uid(), quantite: 1,
    produitId: '', coloris: '', face1Id: '', face2Id: '', dessousId: '', batId: '',
    face1Texte: '', face2Texte: '', dessousTexte: '', typo: '', remarque: '',
    prixUnitaireTtc: '',
  };
}
function newTextileLigne() {
  return {
    uid: uid(), quantite: 1,
    designation: '', reference: '', coloris: '', colorisAutre: false,
    // Grille de tailles : { 'M': '4', 'L': '6' }. Les tailles hors grille
    // s'ajoutent à la demande dans `taillesLibres`.
    tailles: {}, taillesLibres: [],
    faces: { avant: newFaceTextile(), arriere: newFaceTextile() },
    remarque: '', prixUnitaireTtc: '',
  };
}
// `plus` : les emplacements secondaires sont-ils dépliés ? Replié par défaut —
// 12 puces par face noieraient les 6 emplacements réellement courants.
function newFaceTextile() {
  return { emplacement: '', typeLogo: '', referenceLogo: '', couleurMarquage: '', plus: false };
}
function newAutresLigne() {
  return {
    uid: uid(), quantite: 1,
    designation: '', explication: '', matiere: '', format: '', methode: '',
    prixUnitaireTtc: '',
  };
}
function newLigne(typeId) {
  if (typeId === 'tasse') return newTasseLigne();
  if (typeId === 'textile') return newTextileLigne();
  return newAutresLigne();
}

// Quantité d'un textile : la SOMME de sa grille de tailles. Sans aucune taille
// chiffrée, la ligne garde sa quantité saisie au stepper.
function quantiteTextile(l) {
  const total = [...Object.values(l.tailles), ...l.taillesLibres.map((t) => t.quantite)]
    .reduce((s, v) => s + (Number.parseInt(v, 10) || 0), 0);
  return total > 0 ? total : (Number(l.quantite) || 1);
}
function quantiteItem(item) {
  return item.type === 'textile' ? quantiteTextile(item) : (Number(item.quantite) || 1);
}

// Prix unitaire PROPOSÉ par la grille tarifaire (tasse uniquement) : produit +
// options retenues. Les autres familles n'ont pas de grille — le comptoir saisit.
function catalogueUnitaireTtc(l) {
  const ids = [l.produitId, l.face1Id, l.face2Id, l.dessousId, l.batId];
  return ids.reduce((s, id) => { const a = tarifById(id); return s + (a ? a.prixVenteTtc : 0); }, 0);
}

// Prix unitaire RETENU : celui que l'employé a saisi s'il en a saisi un, sinon
// celui de la grille. Écrire un prix à la main l'emporte toujours (remise
// négociée, cas particulier) — le coût de revient, lui, reste celui de la grille.
function prixUnitaireTtc(item) {
  if (item.prixUnitaireTtc !== '' && item.prixUnitaireTtc != null) {
    const n = Number(item.prixUnitaireTtc);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return item.type === 'tasse' ? catalogueUnitaireTtc(item) : 0;
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
  return Math.round(quantiteItem(item) * prixUnitaireTtc(item) * 100) / 100;
}
function calcItemRevient(item) {
  return item.type === 'tasse' ? calcLigneTasseRevient(item) : 0;
}

// Les tailles d'un textile, en une ligne : « M×4 · L×6 ».
function taillesTexte(l) {
  const cases = CAT.taillesGrille
    .map((t) => ({ taille: t, quantite: Number.parseInt(l.tailles[t], 10) || 0 }))
    .filter((t) => t.quantite > 0);
  const libres = l.taillesLibres
    .map((t) => ({ taille: (t.taille || '').trim(), quantite: Number.parseInt(t.quantite, 10) || 0 }))
    .filter((t) => t.taille && t.quantite > 0);
  return [...cases, ...libres].map((t) => `${t.taille}×${t.quantite}`).join(' · ');
}

function describeItem(item) {
  const q = quantiteItem(item);
  if (item.type === 'tasse') {
    const produit = tarifById(item.produitId);
    const opts = [item.face1Id, item.face2Id, item.dessousId].map(tarifById)
      .filter((a) => a && a.designation !== 'Aucune').map((a) => a.designation);
    return `${q} × ${produit ? produit.designation : 'Tasse'}${item.coloris ? ` (${item.coloris})` : ''}${opts.length ? ` — ${opts.join(', ')}` : ''}`;
  }
  if (item.type === 'textile') {
    const id = [item.reference && `réf. ${item.reference}`, item.coloris, taillesTexte(item)].filter(Boolean).join(' · ');
    return `${q} × ${item.designation || 'Textile'}${id ? ` — ${id}` : ''}`;
  }
  return `${q} × ${item.designation || '—'}`;
}

// Un délai est choisi dès qu'un raccourci OU une date précise est posé.
const delaiChoisi = () => !!state.delai || !!state.deadline;

function totalTtc() {
  const base = state.panier.reduce((s, item) => s + calcItemTtc(item), 0);
  // Une date précise ne majore rien : on ne facture pas l'urgence d'une date
  // que le client a lui-même fixée au large.
  const delai = DELAIS.find((d) => d.id === state.delai);
  return Math.round(base * (1 + (delai ? delai.majoration : 0) / 100) * 100) / 100;
}

// Le HT se déduit du TTC (taux TGCA des réglages), il n'est jamais saisi.
function totalHt() {
  return Math.round((totalTtc() / (1 + TARIFS_PARAMS.tgca)) * 100) / 100;
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

  const delaiBox = el('div', 'proj-delai');
  delaiBox.append(renderDelai());
  main.append(delaiBox);
  main.append(renderPaiement());
  main.append(renderTotalBar());
}

// --- Formulaire d'ajout d'un produit au panier ------------------------------------
function startAdding(typeId) {
  state.addingType = typeId;
  state.addingLigne = newLigne(typeId);
  state.customOpen = false;
  render();
}
function cancelAdding() {
  state.addingType = null; state.addingLigne = null;
  render();
}
function confirmAdd() {
  const l = state.addingLigne;
  const manque = {
    tasse: () => (!l.produitId ? 'Choisis un type de tasse.' : ''),
    textile: () => (!l.designation.trim() ? 'Indique la désignation du produit (T-shirt, Polo…).' : ''),
  }[state.addingType] || (() => (!l.designation.trim() ? 'Indique la désignation du projet.' : ''));
  const message = manque();
  if (message) { window.alert(message); return; }
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

// Champ texte étiqueté. Pas de re-rendu à la frappe (le curseur sauterait) :
// l'état est posé à chaque touche, l'écran se recalcule au blur si besoin.
function textField(label, get, set, opts = {}) {
  const box = el('label', 'proj-field');
  box.append(el('span', 'proj-field__label', label));
  const input = el(opts.multiline ? 'textarea' : 'input', `proj-input${opts.multiline ? ' proj-input--area' : ''}`);
  if (opts.multiline) input.rows = opts.rows || 3;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (opts.list) input.setAttribute('list', opts.list);
  if (opts.maxLength) input.maxLength = opts.maxLength;
  input.value = get() || '';
  input.addEventListener('input', () => set(input.value));
  box.append(input);
  return box;
}

// Prix unitaire : HT et TGCA côte à côte, liés par le taux des Réglages. Taper
// dans l'un remplit l'autre en direct — sans re-rendu, pour ne pas éjecter le
// curseur du champ en cours de frappe. Le TTC reste la valeur stockée ; le HT
// n'est qu'une vue.
function prixFields(l, type) {
  const taux = 1 + (TARIFS_PARAMS.tgca || 0);
  const cents = (v) => Math.round(v * 100) / 100;
  const g = groupBox('Prix unitaire');
  const row = el('div', 'proj-prix');

  const champ = (label, cls) => {
    const box = el('label', `proj-field proj-field--prix${cls ? ` ${cls}` : ''}`);
    box.append(el('span', 'proj-field__label', label));
    const input = el('input', 'proj-input proj-input--lg');
    input.type = 'number'; input.min = '0'; input.step = '0.01'; input.inputMode = 'decimal';
    input.placeholder = '0,00';
    box.append(input);
    return { box, input };
  };
  const ht = champ('HT (€)');
  const ttc = champ('TGCA — TTC (€)', 'proj-field--prix-ttc');

  const unitaire = prixUnitaireTtc({ ...l, type });
  const saisi = l.prixUnitaireTtc !== '' && l.prixUnitaireTtc != null;
  // Tasse : tant que rien n'est saisi, les champs MONTRENT le prix du catalogue
  // (grisé) plutôt que de rester vides — l'employé voit ce qu'il va facturer.
  ttc.input.value = saisi ? l.prixUnitaireTtc : (unitaire ? unitaire.toFixed(2) : '');
  ht.input.value = unitaire ? cents(unitaire / taux).toFixed(2) : '';
  if (!saisi && unitaire) { ttc.input.classList.add('is-catalogue'); ht.input.classList.add('is-catalogue'); }

  ttc.input.addEventListener('input', () => {
    l.prixUnitaireTtc = ttc.input.value;
    const n = Number(ttc.input.value);
    ht.input.value = Number.isFinite(n) && ttc.input.value !== '' ? cents(n / taux).toFixed(2) : '';
    ttc.input.classList.remove('is-catalogue'); ht.input.classList.remove('is-catalogue');
  });
  ht.input.addEventListener('input', () => {
    const n = Number(ht.input.value);
    const val = Number.isFinite(n) && ht.input.value !== '' ? cents(n * taux) : '';
    l.prixUnitaireTtc = val === '' ? '' : String(val);
    ttc.input.value = val === '' ? '' : val.toFixed(2);
    ttc.input.classList.remove('is-catalogue'); ht.input.classList.remove('is-catalogue');
  });
  // Le total de la ligne ne se recalcule qu'une fois la frappe terminée.
  ttc.input.addEventListener('change', renderCurrentPage);
  ht.input.addEventListener('change', renderCurrentPage);

  row.append(ht.box, ttc.box);
  g.append(row);

  // Retour au prix du catalogue, seulement quand il y a un catalogue et qu'on
  // s'en est écarté : sinon le bouton n'a rien à défaire.
  if (type === 'tasse' && saisi && catalogueUnitaireTtc(l)) {
    const reset = el('button', 'proj-prix__reset');
    reset.type = 'button';
    reset.append(ic('undo'), el('span', null, `Prix du catalogue (${catalogueUnitaireTtc(l).toFixed(2)} €)`));
    reset.addEventListener('click', () => { l.prixUnitaireTtc = ''; renderCurrentPage(); });
    g.append(reset);
  }
  return g;
}

// GRILLE DE TAILLES : une case chiffrable par taille, la quantité de la ligne en
// est la somme. Les tailles hors grille (« 3XL », « 8 ans ») s'ajoutent à la
// demande. Comme dans la Saisie détaillée : on ne redemande pas un « Qté » qui
// pourrait contredire la grille.
function sizeGrid(l) {
  const g = groupBox('Tailles');
  const grille = el('div', 'proj-sizes');
  for (const t of ['Taille unique', ...CAT.taillesGrille]) {
    const box = el('label', 'proj-size');
    box.append(el('span', 'proj-size__label', t));
    const input = el('input', 'proj-size__qty');
    input.inputMode = 'numeric';
    input.value = l.tailles[t] || '';
    input.setAttribute('aria-label', `Quantité taille ${t}`);
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D+/g, '').slice(0, 4);
      input.value = digits;
      if (digits) l.tailles[t] = digits; else delete l.tailles[t];
    });
    input.addEventListener('change', renderCurrentPage);
    box.append(input);
    grille.append(box);
  }
  g.append(grille);

  l.taillesLibres.forEach((libre, i) => {
    const row = el('div', 'proj-size-libre');
    const nom = el('input', 'proj-input');
    nom.placeholder = 'Autre taille (3XL, 8 ans…)';
    nom.value = libre.taille;
    nom.maxLength = 20;
    nom.addEventListener('input', () => { libre.taille = nom.value; });
    const qty = el('input', 'proj-size__qty');
    qty.inputMode = 'numeric';
    qty.value = libre.quantite;
    qty.setAttribute('aria-label', 'Quantité de cette taille');
    qty.addEventListener('input', () => { libre.quantite = qty.value.replace(/\D+/g, '').slice(0, 4); });
    qty.addEventListener('change', renderCurrentPage);
    const rm = el('button', 'proj-size-libre__del');
    rm.type = 'button';
    rm.setAttribute('aria-label', 'Retirer cette taille');
    rm.append(ic('close'));
    rm.addEventListener('click', () => { l.taillesLibres.splice(i, 1); renderCurrentPage(); });
    row.append(nom, qty, rm);
    g.append(row);
  });

  const add = el('button', 'proj-choice proj-choice--add');
  add.type = 'button';
  add.append(ic('add'), el('span', 'proj-choice__txt', 'Autre taille'));
  add.addEventListener('click', () => { l.taillesLibres.push({ taille: '', quantite: '' }); renderCurrentPage(); });
  g.append(add);

  g.append(el('p', 'proj-sizes__total', `Quantité totale : ${quantiteTextile(l)}`));
  return g;
}

// UNE FACE marquée : où, quoi, quelle référence, quelle couleur. Repliée tant
// qu'aucun emplacement n'est choisi — un textile sans marquage reste une saisie
// de 3 champs, pas un formulaire de 11.
function faceFields(l, face) {
  const f = l.faces[face.id];
  const g = groupBox(face.label);
  // Les emplacements courants d'abord (`principal`), le reste derrière un tap :
  // au comptoir on vise Cœur ou Dos neuf fois sur dix. Un emplacement déjà
  // choisi reste visible même s'il est secondaire.
  const visibles = CAT.zones.filter((z) => z.principal || f.plus || z.id === f.emplacement);
  const zones = visibles.map((z) => ({ id: z.id, designation: z.label }));
  const chips = choiceChips([{ id: '', designation: 'Aucun marquage' }, ...zones], f.emplacement, (v) => {
    f.emplacement = f.emplacement === v ? '' : v;
  }, { none: true, noneDesign: 'Aucun marquage' });
  if (visibles.length < CAT.zones.length) {
    const plus = el('button', 'proj-choice proj-choice--plus');
    plus.type = 'button';
    plus.append(ic('more_horiz'), el('span', 'proj-choice__txt', 'Autres emplacements'));
    plus.addEventListener('click', () => { f.plus = true; renderCurrentPage(); });
    chips.append(plus);
  }
  g.append(chips);

  if (f.emplacement) {
    const detail = el('div', 'proj-face');
    const types = CAT.typeLogos.map((t) => ({ id: t.id, designation: t.label }));
    const gType = el('div', 'proj-field');
    gType.append(el('span', 'proj-field__label', 'Type de logo'));
    gType.append(choiceChips(types, f.typeLogo, (v) => { f.typeLogo = f.typeLogo === v ? '' : v; }));
    detail.append(gType);
    detail.append(textField('Référence logo', () => f.referenceLogo, (v) => { f.referenceLogo = v; },
      { placeholder: 'LOGO-2024.ai, fichier client…' }));
    detail.append(textField('Couleur de marquage', () => f.couleurMarquage, (v) => { f.couleurMarquage = v; },
      { placeholder: 'Blanc, or, noir…' }));
    g.append(detail);
  }
  return g;
}

function renderTextileFields(l) {
  const card = el('div', 'proj-form');

  const gDes = groupBox('Produit');
  gDes.append(textField('Désignation produit', () => l.designation, (v) => { l.designation = v; },
    { placeholder: 'T-shirt, Polo, Sweat…', list: 'proj-dl-vetements' }));
  gDes.append(textField('Référence', () => l.reference, (v) => { l.reference = v; },
    { placeholder: 'Référence fournisseur' }));
  card.append(gDes);

  const gCol = groupBox('Couleurs');
  gCol.append(colorSwatches(l));
  card.append(gCol);

  card.append(sizeGrid(l));

  for (const face of FACES_TEXTILE) card.append(faceFields(l, face));

  const gRem = groupBox('Remarques');
  gRem.append(textField('', () => l.remarque, (v) => { l.remarque = v; },
    { multiline: true, placeholder: 'Coutures renforcées, lavage à froid…' }));
  card.append(gRem);

  card.append(prixFields(l, 'textile'));
  return card;
}

function renderAutresFields(l, type) {
  const card = el('div', 'proj-form');

  const gDes = groupBox('Projet');
  gDes.append(textField('Désignation projet', () => l.designation, (v) => { l.designation = v; },
    { placeholder: 'Enseigne vitrine, trophée gravé…' }));
  gDes.append(textField('Explication du projet', () => l.explication, (v) => { l.explication = v; },
    { multiline: true, placeholder: 'Ce que le client veut, en clair…' }));
  card.append(gDes);

  const gFab = groupBox('Fabrication');
  gFab.append(textField('Matière à utiliser', () => l.matiere, (v) => { l.matiere = v; },
    { placeholder: 'PVC 5 mm, bois, alu…' }));
  gFab.append(textField('Format', () => l.format, (v) => { l.format = v; },
    { placeholder: '120 × 40 cm, A4…' }));
  gFab.append(textField('Méthode de production', () => l.methode, (v) => { l.methode = v; },
    { placeholder: 'Découpe laser, UV, gravure…' }));
  card.append(gFab);

  const gQty = groupBox('Quantité');
  gQty.append(qtyStepper(() => l.quantite, (n) => { l.quantite = n; }));
  card.append(gQty);

  card.append(prixFields(l, type));
  return card;
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
    // Les puces disent ce qu'on FACTURE (l'option tarifée), le champ texte dit
    // ce qu'on GRAVE (le contenu exact à passer en machine).
    const gF1 = groupBox('Face 01 · anse à droite');
    gF1.append(choiceChips(tarifsByCat('face'), l.face1Id, (v) => { l.face1Id = v; }, { none: true }));
    gF1.append(textField('Logo ou texte à graver', () => l.face1Texte, (v) => { l.face1Texte = v; },
      { placeholder: 'OLDA — Grand Case' }));
    card.append(gF1);

    const gF2 = groupBox('Face 02 · anse à gauche');
    gF2.append(choiceChips(tarifsByCat('face'), l.face2Id, (v) => { l.face2Id = v; }, { none: true }));
    gF2.append(textField('Logo ou texte à graver', () => l.face2Texte, (v) => { l.face2Texte = v; },
      { placeholder: 'Logo client, prénom…' }));
    card.append(gF2);

    const gDs = groupBox('Dessous');
    gDs.append(choiceChips(tarifsByCat('dessous'), l.dessousId, (v) => { l.dessousId = v; }, { none: true }));
    gDs.append(textField('Logo à graver', () => l.dessousTexte, (v) => { l.dessousTexte = v; },
      { placeholder: 'Petit logo, date…' }));
    card.append(gDs);

    const gTypo = groupBox('Typo utilisée');
    gTypo.append(textField('', () => l.typo, (v) => { l.typo = v; },
      { placeholder: 'Bebas Neue, typo du logo…', list: 'proj-dl-typos' }));
    card.append(gTypo);

    const gBat = groupBox('BAT à confirmer avant production');
    gBat.append(choiceChips(tarifsByCat('bat'), l.batId, (v) => { l.batId = v; }, { none: true, noneDesign: 'Non', duo: true }));
    card.append(gBat);
  }

  const gRem = groupBox('Remarques');
  gRem.append(textField('', () => l.remarque, (v) => { l.remarque = v; },
    { multiline: true, placeholder: 'Emballage cadeau, livraison sur place…' }));
  card.append(gRem);

  card.append(prixFields(l, 'tasse'));
  return card;
}

function renderAddForm(main) {
  const back = el('button', 'proj-back', '← Annuler');
  back.type = 'button';
  back.addEventListener('click', cancelAdding);
  main.append(back, el('h3', 'proj-step__title', typeLabel(state.addingType)));

  const l = state.addingLigne;
  if (state.addingType === 'tasse') main.append(renderTasseFields(l));
  else if (state.addingType === 'textile') main.append(renderTextileFields(l));
  else main.append(renderAutresFields(l, state.addingType));

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

// Date civile LOCALE du jour, « aaaa-mm-jj ». `toISOString()` bascule en UTC :
// à l'ouest de Greenwich (l'atelier est aux Antilles) il rend déjà la date du
// lendemain en soirée. Le serveur calcule pareil.
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Délai OBLIGATOIRE : aucun raccourci n'est pré-coché, et une 6ᵉ tuile ouvre un
// calendrier pour viser un jour exact (« le 14, pour le mariage »). Choisir
// l'un efface l'autre : une commande a une seule date butoir.
function renderDelai() {
  const g = groupBox('Pour quand ? (obligatoire)');
  const options = [...DELAIS, { id: 'date', label: 'Date précise' }];
  const actif = state.deadline ? 'date' : state.delai;
  g.append(segBar(options, actif, (id) => {
    if (id === 'date') {
      state.delai = null;
      if (!state.deadline) state.deadline = todayISO();
    } else {
      state.delai = id;
      state.deadline = '';
    }
  }, 6));

  if (state.deadline) {
    const input = el('input', 'proj-input proj-input--lg');
    input.type = 'date';
    input.min = todayISO();
    input.value = state.deadline;
    input.setAttribute('aria-label', 'Date butoir du projet');
    input.addEventListener('change', () => {
      state.deadline = input.value;
      renderCurrentPage();
    });
    g.append(input);
  }
  return g;
}

// Bloc paiement : ce qu'on sait de l'argent au moment de la prise, pour TOUT le
// panier — on encaisse une fois. Un seul statut, et seulement les champs qu'il
// rend pertinents : demander le mode du solde alors que rien n'est payé n'a
// pas de sens au comptoir.
function renderPaiement() {
  const p = state.paiement;
  const box = el('div', 'proj-delai');

  const g = groupBox('Statut du paiement');
  g.append(segBar(PAIEMENT_STATUTS, p.statut, (id) => {
    p.statut = p.statut === id ? null : id;   // re-cliquer revient à « non renseigné »
    if (p.statut !== 'acompte_recu') { p.acompteMontant = ''; p.modeAcompte = null; }
    if (p.statut !== 'paye') p.modeFinal = null;
  }, 5));
  box.append(g);

  // La somme exacte et le mode de l'acompte n'ont de sens qu'une fois l'acompte
  // encaissé.
  if (p.statut === 'acompte_recu') {
    const gAc = groupBox('Montant TTC de l’acompte reçu');
    const montant = el('input', 'proj-input proj-input--lg');
    montant.type = 'number'; montant.min = '0'; montant.step = '0.01'; montant.inputMode = 'decimal';
    montant.placeholder = 'Somme reçue (€)';
    montant.setAttribute('aria-label', 'Montant TTC de l’acompte reçu, en euros');
    montant.value = p.acompteMontant;
    montant.addEventListener('input', () => { p.acompteMontant = montant.value; });
    gAc.append(montant);
    box.append(gAc);

    const gMode = groupBox('Mode de paiement de l’acompte');
    gMode.append(segBar(PAIEMENT_MODES, p.modeAcompte, (id) => {
      p.modeAcompte = p.modeAcompte === id ? null : id;
    }, 4));
    box.append(gMode);
  }

  if (p.statut === 'paye') {
    const gFinal = groupBox('Mode de paiement final');
    gFinal.append(segBar(PAIEMENT_MODES, p.modeFinal, (id) => {
      p.modeFinal = p.modeFinal === id ? null : id;
    }, 4));
    box.append(gFinal);
  }
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

  // Le HT sous le total : la distinction que le patron veut voir, sans jamais
  // avoir à la saisir deux fois.
  bar.append(el('p', 'proj-total__ht', `dont ${totalHt().toFixed(2)} € HT`));

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

  // Enregistrer est bloqué tant qu'il manque le panier OU le délai. Le motif
  // s'écrit à l'écran : un bouton grisé sans explication se lit comme un bug.
  const manque = state.panier.length === 0
    ? 'Ajoute au moins un produit.'
    : (!delaiChoisi() ? 'Choisis un délai ou une date précise.' : '');

  const saveBtn = el('button', 'proj-btn proj-btn--primary proj-btn--cta', 'Enregistrer');
  saveBtn.type = 'button';
  saveBtn.disabled = !!manque;
  saveBtn.addEventListener('click', () => { openDestinationPopup(); });
  bar.append(saveBtn);
  if (manque) bar.append(el('p', 'proj-total__manque', manque));
  return bar;
}

// --- Destination + enregistrement --------------------------------------------
async function loadPipeline() {
  if (PIPELINE) return PIPELINE;
  PIPELINE = await api('GET', '/api/pipeline');
  return PIPELINE;
}

// Une ligne du panier → ce que le serveur attend. Le prix unitaire n'est envoyé
// que s'il a été saisi : sans lui, le serveur applique la grille tarifaire
// (tasse) plutôt qu'un zéro venu du client.
function ligneToPayload(item) {
  const base = { type: item.type, quantite: quantiteItem(item) };
  if (item.prixUnitaireTtc !== '' && item.prixUnitaireTtc != null) {
    base.prixUnitaireTtc = Number(item.prixUnitaireTtc);
  }
  if (item.type === 'tasse') {
    return {
      ...base,
      produitId: item.produitId, coloris: item.coloris,
      face1Id: item.face1Id, face2Id: item.face2Id, dessousId: item.dessousId, batId: item.batId,
      face1Texte: item.face1Texte, face2Texte: item.face2Texte, dessousTexte: item.dessousTexte,
      typo: item.typo, remarque: item.remarque,
    };
  }
  if (item.type === 'textile') {
    const tailles = [
      ...CAT.taillesGrille.concat('Taille unique')
        .map((t) => ({ taille: t, quantite: Number.parseInt(item.tailles[t], 10) || 0 })),
      ...item.taillesLibres.map((t) => ({ taille: (t.taille || '').trim(), quantite: Number.parseInt(t.quantite, 10) || 0 })),
    ].filter((t) => t.taille && t.quantite > 0);
    const faces = {};
    for (const face of FACES_TEXTILE) {
      const f = item.faces[face.id];
      if (!f.emplacement) continue;   // une face sans emplacement n'est pas une consigne
      faces[face.id] = {
        emplacement: f.emplacement, typeLogo: f.typeLogo,
        referenceLogo: f.referenceLogo, couleurMarquage: f.couleurMarquage,
      };
    }
    return {
      ...base,
      designation: item.designation, reference: item.reference, coloris: item.coloris,
      tailles, faces, remarque: item.remarque,
    };
  }
  return {
    ...base,
    designation: item.designation, explication: item.explication,
    matiere: item.matiere, format: item.format, methode: item.methode,
  };
}

function buildPayload(kind, dest) {
  const nomParts = (state.client.nom || state.client.entreprise || '').split(' ');
  return {
    kind,
    client: state.client.type === 'perso'
      ? { type: 'perso', prenom: nomParts[0] || '', nom: nomParts.slice(1).join(' '), societe: state.client.entreprise, whatsapp: state.client.telephone, email: state.client.email }
      : { type: 'pro', facturation: state.client.entreprise, contact: state.client.nom, whatsapp: state.client.telephone, email: state.client.email },
    lignes: state.panier.map(ligneToPayload),
    // Un seul des deux part : un raccourci OU une date précise.
    delai: state.delai || undefined,
    deadline: state.deadline || undefined,
    paiement: {
      statut: state.paiement.statut,
      acompteMontant: state.paiement.acompteMontant === '' ? null : Number(state.paiement.acompteMontant),
      modeAcompte: state.paiement.modeAcompte,
      modeFinal: state.paiement.modeFinal,
    },
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
    el('p', 'proj-done__sub', `${created.projet.prixTotalTtc.toFixed(2)} € TTC (${created.projet.prixTotalHt.toFixed(2)} € HT) — ${created.projet.client.societe}`),
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
  const brand = el('div', 'proj-bar__brand');
  brand.id = 'proj-bar-brand';
  head.append(brand);
  const stepper = el('div', 'proj-stepper');
  stepper.id = 'proj-stepper';
  head.append(stepper);
  const bodyEl = el('div', 'proj-body', '');
  bodyEl.id = 'proj-body';
  page.append(head, bodyEl);
  const dlSecteurs = el('datalist');
  dlSecteurs.id = PROJ_SECTEURS_DL_ID;
  // La liste des secteurs vit en base : on s'abonne plutôt que de la recopier,
  // pour qu'un secteur ajouté depuis Base clients apparaisse ici aussitôt.
  registerSecteurDatalist(dlSecteurs);
  const dlVilles = el('datalist');
  dlVilles.id = PROJ_VILLES_DL_ID;
  dlVilles.append(...VILLES.map((v) => new Option(v.label)));
  // Suggestions du catalogue partagé (vêtements, typos) : remplies par
  // `remplirCatalogueDatalists` une fois le catalogue chargé.
  const dlVetements = el('datalist');
  dlVetements.id = 'proj-dl-vetements';
  const dlTypos = el('datalist');
  dlTypos.id = 'proj-dl-typos';
  ROOT.replaceChildren(page, dlSecteurs, dlVilles, dlVetements, dlTypos);
}

function remplirCatalogueDatalists() {
  $('#proj-dl-vetements').replaceChildren(...CAT.vetements.map((v) => new Option(v)));
  $('#proj-dl-typos').replaceChildren(...CAT.typos.map((t) => new Option(t)));
}

let mounted = false;
export async function initProjet(root) {
  if (mounted) return;
  ROOT = root;
  mounted = true;
  buildStatic();
  try {
    let cat;
    [CLIENTS, TARIFS, TARIFS_PARAMS, cat] = await Promise.all([
      api('GET', '/api/clients'), api('GET', '/api/tarifs-tasse'), api('GET', '/api/tarifs-tasse/parametres'),
      api('GET', '/api/commande/catalog'),
    ]);
    CAT = { ...CAT, ...cat };
    remplirCatalogueDatalists();
    await loadSecteurs();
  } catch (_) { /* silencieux : les pages suivantes gèrent une liste vide */ }
  render();
}

// Un tap sur « Nouveau Projet » dans la nav ouvre TOUJOURS « Quel client ? »,
// même si un poste avait laissé une fiche en cours — comptoir = on repart net,
// on ne cherche jamais un brouillon abandonné entre deux clients.
export function resetProjet() {
  if (!mounted) return;
  state.page = 'client'; state.client = null; state.panier = []; state.addingType = null; state.addingLigne = null;
  state.delai = null; state.deadline = ''; state.paiement = newPaiement(); state.margeVisible = false;
  state.clientForm = null; state.clientDraft = {}; state.clientErreur = null;
  render();
}
