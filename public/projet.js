// Nouveau Projet — Atelier OLDA
// LE flux comptoir : client (recherche/création) → panier (plusieurs produits,
// de types différents) → prix, façon caisse SumUp. Rendu entièrement par JS
// dans une section vide (même principe que clients.js / reglages.js), chargé
// à la demande par app.js.

import {
  wireVilleDefaults, applyCasse, formatPhoneAsTyped,
  loadSecteurs, addSecteur, SECTEURS, VILLES,
} from './clients.js';
import { groupDigits, whatsappNumber } from './whatsapp.js';

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
  // Écran « Nouveau client » (étape 1) : quel onglet est affiché. Les deux jeux
  // de champs vivent ensemble dans le DOM (on bascule sans re-rendre), donc ce
  // qui est déjà tapé reste là — pas de brouillon à tenir dans l'état.
  clientForm: null,           // null = recherche ; 'pro' | 'perso' = formulaire ouvert
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
// serveur, qui valide). Chaque face ne propose QUE ses propres emplacements :
// proposer « Dos » sous « Face avant », comme avant, faisait deux rangées
// identiques dont l'une mentait. Leur union couvre les emplacements courants,
// chacun sous la face où il se trouve vraiment.
const FACES_TEXTILE = [
  { id: 'avant', label: 'Face avant', zones: ['poitrine', 'coeur', 'manche_g', 'manche_d'] },
  { id: 'arriere', label: 'Face arrière', zones: ['dos', 'haut_dos', 'capuche'] },
];
// Comment le marquage est posé. Miroir de catalog.json → commande.techniques.
const TX_TECHNIQUES = [
  { id: 'serigraphie', label: 'Sérigraphie' },
  { id: 'broderie', label: 'Broderie' },
  { id: 'dtf', label: 'DTF' },
  { id: 'flex', label: 'Flex' },
];
// Libellés repris du catalogue partagé quand il est chargé (c'est LUI que le
// serveur valide) ; les valeurs en dur ne servent que de repli si l'appel échoue.
const TX_ZONES_REPLI = {
  poitrine: 'Poitrine', coeur: 'Cœur', manche_g: 'Manche gauche',
  manche_d: 'Manche droite', dos: 'Dos', haut_dos: 'Haut du dos', capuche: 'Capuche',
};
const txZones = (face) => face.zones.map((id) => {
  const zone = CAT.zones.find((z) => z.id === id);
  return { id, label: zone ? zone.label : (TX_ZONES_REPLI[id] || id) };
});
const txTechniques = () => (CAT.techniques && CAT.techniques.length ? CAT.techniques : TX_TECHNIQUES);
const txTypeLogos = () => (CAT.typeLogos && CAT.typeLogos.length ? CAT.typeLogos : []);

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

// L'en-tête annonce le flux. Sur « Nouveau client », l'écran porte son PROPRE
// titre (celui de la maquette) : la barre garde la marque, sans le répéter.
function renderBar() {
  const brand = $('#proj-bar-brand');
  if (!brand) return;
  const page = ROOT.querySelector('.proj-page');
  if (page) {
    page.classList.toggle('is-nouveau-client', state.page === 'client' && !!state.clientForm);
    // Écran Textile : fond de page légèrement gris, ce sont les cartes
    // blanches qui portent le contenu (même principe que Nouveau client).
    page.classList.toggle('is-textile', state.page === 'main' && state.addingType === 'textile');
  }
  brand.replaceChildren();
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

  // La maquette ouvre sur « Particulier » : c'est l'onglet actif au chargement.
  newBtn.addEventListener('click', () => {
    state.clientForm = 'perso';
    render();
  });

  body.appendChild(wrap);
  input.focus();
}

// --- Écran « Nouveau client » ----------------------------------------------------
// Transcription de la maquette validée par le patron, à l'identique : un titre
// de page, UNE carte, deux onglets (Particulier / Professionnel), les étiquettes
// en gras et l'étoile rouge sur les champs obligatoires. Les deux jeux de champs
// vivent ensemble dans le DOM et se montrent/se cachent — basculer d'un onglet à
// l'autre ne fait donc rien perdre de ce qui est déjà tapé. Les clés envoyées à
// l'API (`entreprise`, `telephone`, `referent_prenom`…) sont inchangées : c'est
// l'écran qu'on refait, pas le contrat.

// `full` = le champ prend la ligne entière (la grille en fait deux par ligne).
// `err` = la maquette réserve la place d'un message sous ce champ, et seulement
// sous celui-là : Adresse, Ville et Code postal n'en ont pas, cette absence fait
// partie du calage vertical.
const NC_CHAMPS = {
  perso: [
    { titre: 'Informations du particulier' },
    { key: 'nom_complet', label: 'Prénom Nom', requis: true, full: true, err: true, autocomplete: 'name' },
    { key: 'telephone', label: 'WhatsApp', requis: true, err: true, tel: true },
    { key: 'email', label: 'Email', type: 'email', err: true, autocomplete: 'email' },
  ],
  pro: [
    { titre: 'Informations entreprise' },
    { key: 'raison_sociale', label: 'Raison sociale EBP', requis: true, full: true, err: true },
    { key: 'adresse', label: 'Adresse', full: true, autocomplete: 'street-address' },
    { key: 'ville', label: 'Ville', autocomplete: 'address-level2' },
    { key: 'code_postal', label: 'Code postal', autocomplete: 'postal-code' },
    { key: 'secteur', label: 'Secteur d’activité', requis: true, full: true, err: true, secteur: true },
    { titre: 'Contact principal' },
    { key: 'referent_prenom', label: 'Prénom Contact', requis: true, err: true },
    { key: 'telephone', label: 'WhatsApp', requis: true, err: true, tel: true },
    { key: 'email', label: 'Email', type: 'email', full: true, err: true },
  ],
};

const NC_TEL_EXEMPLE = '06 90 47 97 88';

// --- Numéro WhatsApp -------------------------------------------------------------
// TOUS les numéros passent : 0690 des Antilles, 06/07 de métropole, fixe, +1 de
// Sint Maarten ou d'Anguilla, indicatif inconnu. Le champ reste obligatoire (son
// étoile), mais le seul refus est « ce n'est pas un numéro du tout ». Une règle
// de format plus fine bloquerait le comptoir devant un client bien réel — c'est
// arrivé, on ne le refait pas.
const ncValidPhone = (v) => /\d/.test(String(v == null ? '' : v));

// Un numéro annoncé comme international (« + » ou « 00 » en tête) est laissé
// EXACTEMENT tel qu'il a été tapé : regrouper ses chiffres par deux couperait
// l'indicatif du pays en plein milieu (« +33 14 26 85 30 0 »), illisible. Le
// comptoir recopie ce que le client lui donne, on n'y touche pas.
const ncEstInternational = (v) => /^(\+|00)/.test(String(v == null ? '' : v).trim());

// L'affichage local : « 06 90 47 97 88 ». Un numéro écrit avec l'indicatif du
// pays collé devant (590690479788) revient à sa forme locale — c'est le même
// numéro, pas un chiffre de perdu.
function ncFormatLocalPhone(value) {
  const brut = String(value == null ? '' : value).trim();
  if (ncEstInternational(brut)) return brut;
  const chiffres = brut.replace(/\D/g, '');
  if (/^590\d{9}$/.test(chiffres)) return groupDigits(`0${chiffres.slice(3)}`);
  return groupDigits(brut);
}

// Le numéro tel que WhatsApp le veut (indicatif pays compris) — sert à
// reconnaître deux fiches qui portent le MÊME numéro écrit différemment.
// `whatsappNumber` connaît déjà tous les préfixes (Antilles, Guyane, Réunion,
// métropole) et est testé ; un numéro qu'il ne sait pas lire est comparé sur
// ses chiffres bruts, ce qui suffit à repérer un doublon.
const ncNormalizeWhatsapp = (v) => whatsappNumber(v) || String(v == null ? '' : v).replace(/\D/g, '');

const ncValidEmail = (v) => !String(v).trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());

// La liste des secteurs vit en base (le patron l'ajuste depuis Base clients) :
// on la repeint à chaque ajout plutôt que de la recopier ici.
function ncPeindreSecteurs(select, selected = '') {
  select.replaceChildren(new Option('Sélectionner un secteur', ''));
  for (const s of SECTEURS) select.append(new Option(s, s, false, s === selected));
}

// Un champ de la maquette : l'étiquette (avec son étoile si le champ est
// obligatoire), le contrôle, l'aide éventuelle, puis la place du message
// d'erreur. `refs` collecte les contrôles pour la validation et l'envoi.
function ncField(f, nature, refs) {
  const wrap = el('div', `pjc-field${f.full ? ' pjc-field--full' : ''}`);
  const id = `pjc-${nature}-${f.key}`;
  const label = el('label', f.requis ? 'pjc-required' : null, f.label);
  label.htmlFor = id;
  wrap.append(label);

  let control;
  if (f.secteur) {
    control = el('select');
    ncPeindreSecteurs(control);
    const row = el('div', 'pjc-sector-row');
    const ajouter = el('button', 'pjc-secondary-btn', '+ Créer un secteur');
    ajouter.type = 'button';
    ajouter.addEventListener('click', ncOuvrirDialogSecteur);
    row.append(control, ajouter);
    wrap.append(row);
  } else {
    control = el('input');
    control.type = f.type || (f.tel ? 'tel' : 'text');
    if (f.autocomplete) control.autocomplete = f.autocomplete;
    if (f.tel) {
      control.placeholder = NC_TEL_EXEMPLE;
      // Regroupement par deux à la frappe, curseur conservé (règle partagée avec
      // Base clients). Un numéro international se tape tel quel, sans être
      // regroupé : dès le « + » ou le « 00 », on n'y touche plus.
      control.addEventListener('input', () => {
        if (!ncEstInternational(control.value)) formatPhoneAsTyped(control);
      });
      control.addEventListener('blur', () => { control.value = ncFormatLocalPhone(control.value); });
      const row = el('div', 'pjc-phone-row');
      const formater = el('button', 'pjc-secondary-btn', 'Formater');
      formater.type = 'button';
      formater.addEventListener('click', () => { control.value = ncFormatLocalPhone(control.value); });
      row.append(control, formater);
      wrap.append(row);
    } else {
      wrap.append(control);
    }
  }
  control.id = id;
  control.name = id;
  // `data-key` : la règle « une ville connue remplit le code postal » se branche
  // dessus (wireVilleDefaults), au lieu d'en recopier une deuxième ici.
  control.dataset.key = f.key;
  if (f.err) wrap.append(el('div', 'pjc-error'));
  refs[f.key] = control;
  return wrap;
}

// Un jeu de champs (Particulier ou Professionnel) : les titres de section
// coupent la grille, chaque titre en ouvre une nouvelle.
function ncBloc(nature, refs) {
  const bloc = el('div');
  let grille = null;
  for (const f of NC_CHAMPS[nature]) {
    if (f.titre) {
      bloc.append(el('h2', 'pjc-section-title', f.titre));
      grille = el('div', 'pjc-grid');
      bloc.append(grille);
      continue;
    }
    grille.append(ncField(f, nature, refs));
  }
  return bloc;
}

// Boîte « Créer un secteur » : même dialogue que la maquette, branché sur la
// vraie liste (POST /api/clients/secteurs) pour que le secteur créé ici
// apparaisse aussi dans Base clients.
function ncOuvrirDialogSecteur() {
  const dlg = $('#pjc-sector-dialog');
  const champ = $('#pjc-new-sector');
  const err = $('#pjc-new-sector-error');
  champ.value = '';
  err.textContent = '';
  dlg.showModal();
  champ.focus();
}

function ncDialogSecteur(select) {
  const dlg = el('dialog', 'pjc-dialog');
  dlg.id = 'pjc-sector-dialog';
  const corps = el('div', 'pjc-dialog-body');
  corps.append(el('h2', null, 'Créer un secteur'));
  const champWrap = el('div', 'pjc-field');
  const label = el('label', null, 'Nom du secteur');
  label.htmlFor = 'pjc-new-sector';
  const input = el('input');
  input.type = 'text';
  input.id = 'pjc-new-sector';
  const err = el('div', 'pjc-error');
  err.id = 'pjc-new-sector-error';
  champWrap.append(label, input, err);
  corps.append(champWrap);

  const actions = el('div', 'pjc-dialog-actions');
  const annuler = el('button', 'pjc-btn pjc-btn--outline', 'Annuler');
  annuler.type = 'button';
  annuler.addEventListener('click', () => dlg.close());
  const ajouter = el('button', 'pjc-btn pjc-btn--primary', 'Ajouter');
  ajouter.type = 'button';
  ajouter.addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) { err.textContent = 'Indiquez le nom du secteur.'; return; }
    if (SECTEURS.some((s) => fold(s) === fold(value))) {
      err.textContent = 'Ce secteur existe déjà.';
      return;
    }
    ajouter.disabled = true;
    try {
      await addSecteur(value);
      ncPeindreSecteurs(select, value);
      dlg.close();
    } catch (_) {
      err.textContent = 'Ajout impossible.';
    } finally {
      ajouter.disabled = false;
    }
  });
  actions.append(annuler, ajouter);
  corps.append(actions);
  dlg.append(corps);
  return dlg;
}

// Un client déjà en base porte-t-il le même numéro, le même e-mail ou la même
// société ? On prévient AVANT de créer un doublon ; un second clic sur le même
// bouton confirme (« Vérifiez avant de créer un doublon » — parfois c'est bien
// un nouveau client, et le comptoir ne doit jamais rester bloqué).
function ncDoublon({ whatsapp, email, entreprise }) {
  return CLIENTS.find((c) => {
    const memeTel = whatsapp && ncNormalizeWhatsapp(c.telephone) === whatsapp;
    const memeMail = email && c.email && c.email.toLowerCase() === email.toLowerCase();
    const memeSociete = entreprise && c.entreprise
      && c.entreprise.toLowerCase() === entreprise.toLowerCase();
    return memeTel || memeMail || memeSociete;
  });
}

function renderNouveauClient(body) {
  body.replaceChildren();
  const page = el('div', 'pjc-page');

  const entete = el('header', 'pjc-header');
  entete.append(
    el('h1', null, 'Nouveau client'),
    el('p', null, 'Création d’un client particulier ou professionnel — Atelier OLDA'),
  );
  page.append(entete);

  const card = el('section', 'pjc-card');

  const onglets = {};
  const switcher = el('div', 'pjc-type-switch');
  for (const t of [{ id: 'perso', label: 'Particulier' }, { id: 'pro', label: 'Professionnel' }]) {
    const b = el('button', 'pjc-type-button', t.label);
    b.type = 'button';
    b.addEventListener('click', () => setNature(t.id));
    onglets[t.id] = b;
    switcher.append(b);
  }
  card.append(switcher);

  const form = el('form');
  form.noValidate = true;
  const refs = { perso: {}, pro: {} };
  const blocs = {
    perso: ncBloc('perso', refs.perso),
    pro: ncBloc('pro', refs.pro),
  };
  form.append(blocs.perso, blocs.pro);
  // Choisir une ville connue remplit le code postal, sans jamais écraser une
  // valeur tapée à la main.
  wireVilleDefaults(blocs.pro, null, 'input');

  const avertissement = el('div', 'pjc-warning');
  const succes = el('div', 'pjc-success');
  form.append(avertissement, succes);

  const actions = el('div', 'pjc-actions');
  const annuler = el('button', 'pjc-btn pjc-btn--outline', 'Annuler');
  annuler.type = 'button';
  const enregistrer = el('button', 'pjc-btn pjc-btn--outline', 'Enregistrer');
  enregistrer.type = 'submit';
  const enregistrerProjet = el('button', 'pjc-btn pjc-btn--primary', 'Enregistrer et créer un projet');
  enregistrerProjet.type = 'submit';
  actions.append(annuler, enregistrer, enregistrerProjet);
  form.append(actions);
  card.append(form);
  page.append(card, ncDialogSecteur(refs.pro.secteur));

  // --- Onglets ------------------------------------------------------------
  // Le doublon déjà signalé : un second clic sur le même bouton confirme la
  // création plutôt que de re-signaler indéfiniment.
  let doublonConfirme = null;

  const effacerMessages = () => {
    for (const e of page.querySelectorAll('.pjc-error')) e.textContent = '';
    avertissement.style.display = 'none';
    succes.style.display = 'none';
    doublonConfirme = null;
  };
  function setNature(id) {
    state.clientForm = id;
    for (const [key, btn] of Object.entries(onglets)) btn.classList.toggle('is-active', key === id);
    blocs.perso.classList.toggle('pjc-hidden', id !== 'perso');
    blocs.pro.classList.toggle('pjc-hidden', id !== 'pro');
    effacerMessages();
  }

  const errFor = (control) => {
    const zone = control.closest('.pjc-field');
    return zone ? zone.querySelector('.pjc-error') : null;
  };
  const poserErreur = (control, message) => {
    const zone = errFor(control);
    if (zone) zone.textContent = message;
  };

  annuler.addEventListener('click', () => {
    state.clientForm = null;
    render();
  });

  let action = 'save';
  for (const b of [enregistrer, enregistrerProjet]) {
    b.addEventListener('click', () => { action = b === enregistrerProjet ? 'save-project' : 'save'; });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nature = state.clientForm;
    const f = refs[nature];
    const lu = (key) => String((f[key] && f[key].value) || '').trim();
    for (const zone of page.querySelectorAll('.pjc-error')) zone.textContent = '';
    avertissement.style.display = 'none';
    succes.style.display = 'none';

    const whatsapp = lu('telephone');
    const email = lu('email');
    let valide = true;
    if (!whatsapp) {
      poserErreur(f.telephone, 'Le numéro WhatsApp est obligatoire.');
      valide = false;
    } else if (!ncValidPhone(whatsapp)) {
      poserErreur(f.telephone, `Numéro WhatsApp invalide. Exemple : ${NC_TEL_EXEMPLE}.`);
      valide = false;
    }
    if (!ncValidEmail(email)) {
      poserErreur(f.email, 'Adresse e-mail invalide.');
      valide = false;
    }

    let draft = { client_type: nature, telephone: ncFormatLocalPhone(whatsapp), email };
    if (nature === 'perso') {
      const identite = lu('nom_complet');
      if (!identite) {
        poserErreur(f.nom_complet, 'Le prénom et le nom sont obligatoires.');
        valide = false;
      }
      // Le comptoir tape « Prénom Nom » ; la base garde les deux séparés (et
      // leur casse : Jean / DUPONT). Un seul mot = un nom.
      const mots = identite.split(/\s+/);
      const prenom = mots.length > 1 ? applyCasse('initiales', mots[0]) : '';
      const nom = applyCasse('majuscules', (mots.length > 1 ? mots.slice(1) : mots).join(' '));
      // `entreprise` reste la colonne obligatoire côté serveur et sert à la
      // recherche : pour un particulier, on la dérive du prénom + nom plutôt
      // que de la demander une deuxième fois.
      draft = { ...draft, prenom, nom, entreprise: `${prenom} ${nom}`.trim() };
    } else {
      const raisonSociale = lu('raison_sociale');
      if (!raisonSociale) {
        poserErreur(f.raison_sociale, 'La raison sociale EBP est obligatoire.');
        valide = false;
      }
      if (!lu('secteur')) {
        poserErreur(f.secteur, 'Sélectionnez un secteur d’activité.');
        valide = false;
      }
      if (!lu('referent_prenom')) {
        poserErreur(f.referent_prenom, 'Le prénom du contact est obligatoire.');
        valide = false;
      }
      draft = {
        ...draft,
        // La maquette ne demande qu'UN nom de société, celui d'EBP : il remplit
        // les deux colonnes (`entreprise` porte la recherche et l'affichage,
        // `raison_sociale` la facturation).
        entreprise: raisonSociale,
        raison_sociale: raisonSociale,
        adresse: lu('adresse'),
        ville: lu('ville'),
        code_postal: lu('code_postal'),
        secteur: lu('secteur'),
        referent_prenom: lu('referent_prenom'),
      };
      // Le pays ne se demande plus (il se déduit de la ville) mais il continue
      // de s'enregistrer : sans ça la colonne se viderait en silence pour tous
      // les clients créés ici.
      const villeConnue = VILLES.find((v) => fold(v.label) === fold(draft.ville));
      if (villeConnue) draft.pays = villeConnue.pays;
    }
    if (!valide) return;

    const signature = `${nature}|${draft.entreprise}|${whatsapp}|${email}`;
    if (doublonConfirme !== signature) {
      const jumeau = ncDoublon({
        whatsapp: ncNormalizeWhatsapp(whatsapp), email, entreprise: draft.entreprise,
      });
      if (jumeau) {
        const label = jumeau.client_type === 'perso' ? (jumeau.nom || jumeau.entreprise) : jumeau.entreprise;
        avertissement.textContent = `Attention : un client similaire existe déjà (${label}). Vérifiez avant de créer un doublon.`;
        avertissement.style.display = 'block';
        doublonConfirme = signature;
        return;
      }
    }

    enregistrer.disabled = true;
    enregistrerProjet.disabled = true;
    let cree;
    try {
      cree = await api('POST', '/api/clients', draft);
    } catch (err) {
      enregistrer.disabled = false;
      enregistrerProjet.disabled = false;
      window.alert(err.message || 'Création impossible');
      return;
    }
    CLIENTS.push(cree);
    succes.textContent = action === 'save-project'
      ? 'Client enregistré. Redirection vers la création d’un projet…'
      : 'Client enregistré avec succès.';
    succes.style.display = 'block';

    if (action === 'save-project') {
      setTimeout(() => goToClient({
        id: cree.id, entreprise: cree.entreprise, nom: cree.nom,
        telephone: cree.telephone, email: cree.email, type: nature,
      }), 800);
      return;
    }
    // « Enregistrer » seul : la fiche est créée, le comptoir en enchaîne une
    // autre — le formulaire repart vierge sur le même onglet.
    enregistrer.disabled = false;
    enregistrerProjet.disabled = false;
    form.reset();
    ncPeindreSecteurs(refs.pro.secteur);
    doublonConfirme = null;
  });

  setNature(state.clientForm);
  body.appendChild(page);
  const premier = refs[state.clientForm][state.clientForm === 'perso' ? 'nom_complet' : 'raison_sociale'];
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
  // L'écran Textile a sa propre mise en page : le client y est déjà, dans la
  // colonne récapitulative de droite — pas de sidebar de gauche en plus.
  if (state.addingType === 'textile') return renderTextileScreen(body);
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
    designation: '', reference: '',
    // Plusieurs coloris pour un même modèle (12 polos : 6 blancs, 6 noirs).
    // `colorisLibre` recueille les teintes hors palette, sans les imposer.
    coloris: [], colorisAutre: false, colorisLibre: '',
    // Grille de tailles : { 'M': '4', 'L': '6' }. Les tailles hors grille
    // s'ajoutent à la demande dans `taillesLibres`.
    tailles: {}, taillesLibres: [],
    faces: { avant: newFaceTextile(), arriere: newFaceTextile() },
    remarque: '', prixUnitaireTtc: '',
    erreur: null,          // clé du champ fautif, une seule à la fois
  };
}
// Une face reste vide tant qu'aucun emplacement n'est choisi : un textile livré
// vierge est un état complet, pas un formulaire à moitié rempli.
function newFaceTextile() {
  return { emplacement: '', technique: '', typeLogo: '', referenceLogo: '', couleurMarquage: '' };
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

// Quantité d'un textile : la SOMME de sa grille de tailles, sans repli. Une
// grille vide vaut 0 et l'écran l'affiche — c'est le total qui a menti jusqu'ici
// (« Quantité totale : 1 » sur un formulaire où rien n'était chiffré).
// Une taille libre CHIFFRÉE MAIS PAS NOMMÉE ne compte pas : elle ne part pas
// dans la fiche (cf. `ligneToPayload`), et un total qui la compterait afficherait
// une quantité que la commande n'enregistrerait jamais.
function quantiteTextile(l) {
  return [
    ...Object.values(l.tailles),
    ...l.taillesLibres.filter((t) => (t.taille || '').trim()).map((t) => t.quantite),
  ].reduce((s, v) => s + (Number.parseInt(v, 10) || 0), 0);
}

// Les coloris d'un textile en UNE chaîne : c'est ce que lit l'atelier, et c'est
// la forme que la fiche de production stocke.
function colorisTexte(l) {
  const libre = (l.colorisAutre ? l.colorisLibre : '').trim();
  return [...(l.coloris || []), libre].filter(Boolean).join(', ');
}
const colorisCount = (l) => (l.coloris || []).length + ((l.colorisAutre && l.colorisLibre.trim()) ? 1 : 0);
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
    const id = [item.reference && `réf. ${item.reference}`, colorisTexte(item), taillesTexte(item)]
      .filter(Boolean).join(' · ');
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

  // Panier vide : la page s'arrête aux tuiles. Demander « pour quand ? » et le
  // paiement avant de savoir QUOI produire n'a pas de sens au comptoir, et un
  // total à 0,00 € sous un bouton grisé n'apprend rien de plus que les tuiles.
  // Les trois blocs reviennent dès le premier produit ajouté.
  if (vide) return;

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
  // Textile : le motif du refus s'écrit SOUS le champ fautif (comme l'écran
  // Nouveau client), jamais dans une alerte qu'on referme sans savoir où aller.
  if (state.addingType === 'textile') {
    l.erreur = !l.designation.trim() ? 'designation'
      : (quantiteTextile(l) < 1 ? 'tailles' : null);
    if (l.erreur) { renderCurrentPage(); return; }
  } else {
    const manque = {
      tasse: () => (!l.produitId ? 'Choisis un type de tasse.' : ''),
    }[state.addingType] || (() => (!l.designation.trim() ? 'Indique la désignation du projet.' : ''));
    const message = manque();
    if (message) { window.alert(message); return; }
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
// =============================================================================
// ÉCRAN TEXTILE (étape 2 — Produits)
// Une carte blanche par bloc — Produit, Coloris, Tailles, Face avant, Face
// arrière, Remarques, Prix, Paiement — plutôt qu'un seul long formulaire à
// en-têtes gris : on sait toujours de quoi on parle. Le client et le
// récapitulatif vivent dans une colonne collante à droite, le prix et
// « Ajouter au panier » dans une barre fixe en bas. Champs et typographie
// repris de l'écran « Nouveau client » (contour permanent, étiquette en casse
// normale) : c'est le même poste, ce doit être la même main.
// =============================================================================

// Nœuds recalculés à la frappe. Re-rendre l'écran à chaque touche ferait sauter
// le curseur hors du champ ; on repeint donc les seuls textes qui dépendent de
// la saisie (quantité, récapitulatif, prix de la ligne).
const txLive = {};

const txTaux = () => 1 + (TARIFS_PARAMS.tgca || 0);

// Le HT est ce que l'employé SAISIT ; `prixUnitaireTtc` reste la valeur stockée
// (contrat serveur), le HT n'en est que la lecture.
function txPrixHt(l) {
  const ttc = Number(l.prixUnitaireTtc);
  if (l.prixUnitaireTtc === '' || l.prixUnitaireTtc == null || !Number.isFinite(ttc)) return 0;
  return ttc / txTaux();
}

function txRefresh() {
  const l = state.addingLigne;
  if (!l || state.addingType !== 'textile') return;
  const q = quantiteTextile(l);
  const ht = txPrixHt(l);
  const pieces = (n) => `${n} pièce${n > 1 ? 's' : ''}`;
  const set = (node, texte) => { if (node) node.textContent = texte; };

  set(txLive.qty, q > 0 ? pieces(q) : 'Aucune pièce');
  const nb = colorisCount(l);
  set(txLive.colorisCount, nb ? `${nb} sélectionné${nb > 1 ? 's' : ''}` : '');
  set(txLive.recapProduit, l.designation.trim() || '—');
  set(txLive.recapColoris, colorisTexte(l) || '—');
  set(txLive.recapQty, q > 0 ? pieces(q) : '—');
  if (txLive.recapMarquages) {
    const liste = txMarquagesTexte(l);
    txLive.recapMarquages.replaceChildren(
      ...(liste.length
        ? liste.map((t) => el('span', 'tx-recap__mk', t))
        : [el('span', 'tx-recap__val', 'Aucun')]),
    );
  }
  set(txLive.barAmount, `${(ht * q).toFixed(2)} €`);
  set(txLive.barTtc, `${(ht * q * txTaux()).toFixed(2)} € TTC`);
}

// « Face avant · Cœur · Broderie », pour le récapitulatif.
function txMarquagesTexte(l) {
  const techs = txTechniques();
  const logos = txTypeLogos();
  const nom = (liste, id) => (liste.find((x) => x.id === id) || {}).label || '';
  return FACES_TEXTILE
    .filter((face) => l.faces[face.id].emplacement)
    .map((face) => {
      const f = l.faces[face.id];
      return [face.label, nom(txZones(face), f.emplacement), nom(techs, f.technique), nom(logos, f.typeLogo)]
        .filter(Boolean).join(' · ');
    });
}

// --- Briques de l'écran ------------------------------------------------------
// Une carte = un bloc. `aside` reçoit le repère de droite (compteur de coloris,
// quantité totale) : l'information qui qualifie le bloc reste sur son titre.
function txCard(titre, aside, aide) {
  const card = el('section', 'tx-card');
  const head = el('div', 'tx-card__head');
  head.append(el('h4', 'tx-card__title', titre));
  if (aside) head.append(aside);
  card.append(head);
  if (aide) card.append(el('p', 'tx-card__hint', aide));
  return card;
}

// Champ texte : contour TOUJOURS visible, étiquette en casse normale,
// « — optionnel » discret, message d'erreur SOUS le champ. Pas de re-rendu à la
// frappe — l'état est posé à chaque touche, seuls les totaux se repeignent.
function txField(label, get, set, opts = {}) {
  const box = el('label', `tx-f${opts.erreur ? ' is-error' : ''}`);
  const lab = el('span', 'tx-f__label');
  lab.append(el('span', 'tx-f__labeltxt', label));
  if (opts.optionnel) lab.append(el('span', 'tx-f__opt', '— optionnel'));
  box.append(lab);
  const input = el(opts.multiline ? 'textarea' : 'input', `tx-input${opts.multiline ? ' tx-input--area' : ''}`);
  if (opts.multiline) input.rows = opts.rows || 3;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (opts.list) input.setAttribute('list', opts.list);
  if (opts.maxLength) input.maxLength = opts.maxLength;
  input.value = get() || '';
  input.addEventListener('input', () => { set(input.value); txRefresh(); });
  box.append(input);
  if (opts.erreur) box.append(txErreur(opts.erreur));
  return box;
}

function txErreur(message) {
  const p = el('p', 'tx-f__err');
  p.append(el('span', 'tx-f__err-dot', '!'), el('span', null, message));
  return p;
}

// Puce de choix : une option = un bouton de 40px, l'état sélectionné se voit
// (fond et texte bleus), pas seulement au survol.
function txChip(label, actif, onPick, dot) {
  const b = el('button', `tx-chip${actif ? ' is-on' : ''}${dot ? ' tx-chip--color' : ''}`);
  b.type = 'button';
  b.setAttribute('aria-pressed', actif ? 'true' : 'false');
  if (dot) {
    const pastille = el('span', 'tx-chip__dot');
    pastille.style.background = dot;
    b.append(pastille);
  }
  b.append(el('span', 'tx-chip__txt', label));
  b.addEventListener('click', onPick);
  return b;
}

// Groupe de puces à choix UNIQUE, sous une étiquette. Re-cliquer désélectionne :
// « je me suis trompé » ne doit pas obliger à recharger la ligne.
function txChoix(label, options, valeur, onPick) {
  const g = el('div', 'tx-f');
  g.append(el('span', 'tx-f__label', label));
  const wrap = el('div', 'tx-chips');
  for (const o of options) {
    wrap.append(txChip(o.label, valeur === o.id, () => {
      onPick(valeur === o.id ? '' : o.id);
      renderCurrentPage();
    }));
  }
  g.append(wrap);
  return g;
}

// --- Carte « Produit » -------------------------------------------------------
function txProduitCard(l) {
  const card = txCard('Produit');
  card.append(txField('Désignation produit', () => l.designation, (v) => { l.designation = v; }, {
    placeholder: 'T-shirt, Polo, Sweat…',
    list: 'proj-dl-vetements',
    maxLength: 80,
    erreur: l.erreur === 'designation' ? 'Indique la désignation du produit (T-shirt, Polo…).' : null,
  }));
  card.append(txField('Référence', () => l.reference, (v) => { l.reference = v; }, {
    placeholder: 'Référence fournisseur', optionnel: true, maxLength: 40,
  }));
  return card;
}

// --- Carte « Coloris » -------------------------------------------------------
// Multi-sélection : un même modèle part souvent en plusieurs teintes (6 blancs,
// 6 noirs). La pastille ne fait que 16px — c'est le NOM qu'on lit, la couleur
// ne sert qu'à le confirmer.
function txColorisCard(l) {
  const compteur = el('span', 'tx-card__aside');
  txLive.colorisCount = compteur;
  const card = txCard('Coloris', compteur);

  const wrap = el('div', 'tx-chips');
  for (const c of COLORIS) {
    const actif = l.coloris.includes(c.label);
    wrap.append(txChip(c.label, actif, () => {
      l.coloris = actif ? l.coloris.filter((x) => x !== c.label) : [...l.coloris, c.label];
      renderCurrentPage();
    }, c.hex));
  }
  // « Autre » n'est pas une couleur : c'est une puce texte qui ouvre la saisie
  // libre — plus de pastille dégradée qui ferait croire à une teinte.
  wrap.append(txChip('Autre', l.colorisAutre, () => {
    l.colorisAutre = !l.colorisAutre;
    if (!l.colorisAutre) l.colorisLibre = '';
    renderCurrentPage();
  }));
  card.append(wrap);

  if (l.colorisAutre) {
    card.append(txField('Coloris personnalisé', () => l.colorisLibre, (v) => { l.colorisLibre = v; }, {
      placeholder: 'Bleu roi, sable, bordeaux…', maxLength: 40,
    }));
  }
  return card;
}

// --- Carte « Tailles et quantités » ------------------------------------------
// La quantité de la ligne EST la somme de la grille : on ne redemande pas une
// « Qté » qui pourrait la contredire (c'est elle qui affichait « 1 » sur un
// formulaire où rien n'était chiffré). Le total se recalcule à la frappe.
function txTaillesCard(l) {
  const total = el('span', 'tx-card__aside tx-card__aside--fort');
  txLive.qty = total;
  const card = txCard('Tailles et quantités', total,
    'Saisis une quantité sur les tailles concernées, laisse les autres vides.');

  const grille = el('div', 'tx-sizes');
  for (const t of ['Taille unique', ...CAT.taillesGrille]) {
    grille.append(txSizeCell(t, () => l.tailles[t] || '', (v) => {
      if (v) l.tailles[t] = v; else delete l.tailles[t];
    }));
  }
  card.append(grille);

  // Tailles hors grille (« 3XL », « 8 ans ») : ajoutées à la demande, pas
  // imposées à tout le monde.
  l.taillesLibres.forEach((libre, i) => {
    const row = el('div', 'tx-size-libre');
    const nom = el('input', 'tx-input');
    nom.placeholder = 'Autre taille (3XL, 8 ans…)';
    nom.value = libre.taille;
    nom.maxLength = 20;
    nom.setAttribute('aria-label', 'Nom de cette taille');
    // Le total dépend du NOM autant que du chiffre : sans nom, la taille ne
    // part pas — l'écran doit le refléter dès la frappe.
    nom.addEventListener('input', () => { libre.taille = nom.value; txRefresh(); });
    const rm = el('button', 'tx-size-libre__del');
    rm.type = 'button';
    rm.setAttribute('aria-label', 'Retirer cette taille');
    rm.append(ic('close'));
    rm.addEventListener('click', () => { l.taillesLibres.splice(i, 1); renderCurrentPage(); });
    row.append(nom, txSizeCell(null, () => libre.quantite, (v) => { libre.quantite = v; }), rm);
    card.append(row);
  });

  const add = el('button', 'tx-add tx-add--inline');
  add.type = 'button';
  add.append(ic('add'), el('span', null, 'Autre taille'));
  add.addEventListener('click', () => { l.taillesLibres.push({ taille: '', quantite: '' }); renderCurrentPage(); });
  card.append(add);

  if (l.erreur === 'tailles') {
    card.append(txErreur('Indique au moins une quantité : c’est elle qui fait la quantité de la ligne.'));
  }
  return card;
}

// Une case de la grille : l'étiquette au-dessus, le chiffre dessous. Une case
// remplie se repère d'un coup d'œil (contour et fond bleus).
function txSizeCell(label, get, set) {
  const box = el('label', 'tx-size');
  if (label) box.append(el('span', 'tx-size__label', label));
  const input = el('input', `tx-size__qty${get() ? ' is-filled' : ''}`);
  input.inputMode = 'numeric';
  input.placeholder = '0';
  input.value = get();
  input.setAttribute('aria-label', label ? `Quantité taille ${label}` : 'Quantité de cette taille');
  input.addEventListener('input', () => {
    // Filtre numérique : une lettre tapée au comptoir ne doit jamais entrer
    // dans un champ dont dépend la quantité facturée.
    input.value = input.value.replace(/\D+/g, '').slice(0, 4);
    set(input.value);
    input.classList.toggle('is-filled', !!input.value);
    txRefresh();
  });
  box.append(input);
  return box;
}

// --- Cartes « Face avant » / « Face arrière » --------------------------------
// Le détail (technique, logo, référence, couleur) n'apparaît qu'une fois
// l'emplacement choisi : une face non marquée reste une seule ligne de puces,
// pas cinq champs vides à faire défiler.
function txFaceCard(l, face) {
  const f = l.faces[face.id];
  const etat = el('span', 'tx-card__aside');
  etat.textContent = f.emplacement ? 'Marquée' : 'Non marquée';
  const card = txCard(face.label, etat);

  card.append(txChoix('Emplacement', txZones(face), f.emplacement, (v) => { f.emplacement = v; }));

  // Rien de coché n'est PAS un oubli : on l'écrit, plutôt que de pré-cocher un
  // emplacement dont personne n'a parlé.
  if (!f.emplacement) {
    const vide = el('div', 'tx-empty');
    vide.append(
      el('p', 'tx-empty__title', 'Aucun marquage'),
      el('p', 'tx-empty__sub', `Cette face sera livrée vierge.`),
    );
    card.append(vide);
    return card;
  }

  card.append(txChoix('Technique', txTechniques(), f.technique, (v) => { f.technique = v; }));
  card.append(txChoix('Type de logo', txTypeLogos(), f.typeLogo, (v) => { f.typeLogo = v; }));
  card.append(txField('Référence logo', () => f.referenceLogo, (v) => { f.referenceLogo = v; }, {
    placeholder: 'LOGO-2024.ai, fichier client…', optionnel: true, maxLength: 200,
  }));
  card.append(txField('Couleur de marquage', () => f.couleurMarquage, (v) => { f.couleurMarquage = v; }, {
    placeholder: 'Blanc, or, noir…', optionnel: true, maxLength: 40,
  }));
  return card;
}

// --- Carte « Remarques » -----------------------------------------------------
function txRemarquesCard(l) {
  const card = txCard('Remarques');
  card.append(txField('Consignes pour l’atelier', () => l.remarque, (v) => { l.remarque = v; }, {
    multiline: true, optionnel: true, maxLength: 400,
    placeholder: 'Coutures renforcées, lavage à froid, emballage séparé…',
  }));
  return card;
}

// --- Carte « Prix » ----------------------------------------------------------
// UN seul champ libre : le HT. Le TTC s'en déduit (TGCA des Réglages) et reste
// en lecture seule — deux champs libres finissaient par se contredire.
function txPrixCard(l) {
  const card = txCard('Prix');
  const row = el('div', 'tx-prix');

  const htBox = el('label', 'tx-f');
  htBox.append(el('span', 'tx-f__label', 'Prix unitaire HT (€)'));
  const ht = el('input', 'tx-input tx-input--prix');
  ht.type = 'number'; ht.min = '0'; ht.step = '0.01'; ht.inputMode = 'decimal';
  ht.placeholder = '0,00';
  const htActuel = txPrixHt(l);
  ht.value = htActuel ? htActuel.toFixed(2) : '';
  htBox.append(ht);

  const ttcBox = el('label', 'tx-f');
  const ttcLab = el('span', 'tx-f__label');
  ttcLab.append(el('span', 'tx-f__labeltxt', 'Prix unitaire TGCA (€)'), el('span', 'tx-f__opt', 'calculé'));
  ttcBox.append(ttcLab);
  const ttc = el('input', 'tx-input tx-input--prix tx-input--ro');
  ttc.readOnly = true;
  ttc.tabIndex = -1;
  ttc.setAttribute('aria-label', 'Prix unitaire TTC, calculé automatiquement');
  ttc.value = htActuel ? (htActuel * txTaux()).toFixed(2) : '';
  ttcBox.append(ttc);

  ht.addEventListener('input', () => {
    const n = Number(ht.value);
    // On stocke le TTC EXACT (le serveur arrondit) : arrondir ici ferait
    // dériver le HT qu'on vient de taper au retour de la fiche.
    const valide = ht.value !== '' && Number.isFinite(n) && n >= 0;
    l.prixUnitaireTtc = valide ? String(n * txTaux()) : '';
    ttc.value = valide ? (n * txTaux()).toFixed(2) : '';
    txRefresh();
  });

  row.append(htBox, ttcBox);
  card.append(row);
  card.append(el('p', 'tx-card__note',
    `TGCA ${String((TARIFS_PARAMS.tgca || 0) * 100).replace('.', ',')} % — le TTC suit le HT, il ne se saisit pas.`));
  return card;
}

// --- Carte « Paiement » ------------------------------------------------------
// MÊME état que le bloc paiement du panier (`state.paiement`) : un projet =
// un encaissement, qu'on prenne 20 polos ou 20 polos + 10 tasses. La fiche
// textile le montre pour qu'on puisse tout renseigner d'un trait, sans jamais
// pouvoir contredire ce qui sera enregistré.
function txPaiementCard() {
  const p = state.paiement;
  const card = txCard('Paiement', null, 'Vaut pour tout le projet, pas seulement pour cette ligne.');

  card.append(txChoix('Statut du paiement', PAIEMENT_STATUTS, p.statut, (v) => {
    p.statut = v;
    if (p.statut !== 'acompte_recu') { p.acompteMontant = ''; p.modeAcompte = null; }
    if (p.statut !== 'paye') p.modeFinal = null;
  }));

  // La somme et le mode de l'acompte n'ont de sens qu'une fois l'acompte
  // encaissé ; le mode final, qu'une fois le solde payé.
  if (p.statut === 'acompte_recu') {
    const box = el('label', 'tx-f');
    box.append(el('span', 'tx-f__label', 'Montant TTC de l’acompte reçu (€)'));
    const montant = el('input', 'tx-input tx-input--prix');
    montant.type = 'number'; montant.min = '0'; montant.step = '0.01'; montant.inputMode = 'decimal';
    montant.placeholder = '0,00';
    montant.value = p.acompteMontant;
    montant.addEventListener('input', () => { p.acompteMontant = montant.value; });
    box.append(montant);
    card.append(box);
    card.append(txChoix('Mode de paiement de l’acompte', PAIEMENT_MODES, p.modeAcompte, (v) => { p.modeAcompte = v || null; }));
  }
  if (p.statut === 'paye') {
    card.append(txChoix('Mode de paiement final', PAIEMENT_MODES, p.modeFinal, (v) => { p.modeFinal = v || null; }));
  }
  return card;
}

// --- Colonne de droite : client + récapitulatif ------------------------------
// Le client tient en une fiche compacte (il est déjà choisi, on le rappelle),
// et le récapitulatif dit ce qui partira au panier — sans avoir à remonter le
// formulaire pour vérifier.
function txSideColumn() {
  const side = el('aside', 'tx-side');
  const c = state.client;

  const fiche = el('div', 'tx-client');
  const ligne = el('div', 'tx-client__row');
  ligne.append(el('div', 'tx-client__av', (clientLabel(c).trim()[0] || '?').toUpperCase()));
  const info = el('div', 'tx-client__info');
  info.append(el('p', 'tx-client__name', clientLabel(c)));
  const meta = [c.type === 'perso' ? 'Particulier' : 'Pro', c.telephone].filter(Boolean).join(' · ');
  if (meta) info.append(el('p', 'tx-client__meta', meta));
  ligne.append(info);
  fiche.append(ligne);
  const change = el('button', 'tx-client__change', 'Changer de client');
  change.type = 'button';
  change.addEventListener('click', changeClient);
  fiche.append(change);
  side.append(fiche);

  const recap = el('div', 'tx-recap');
  recap.append(el('p', 'tx-recap__title', 'Récapitulatif de la ligne'));
  txLive.recapProduit = txRecapRow(recap, 'Produit');
  txLive.recapColoris = txRecapRow(recap, 'Coloris');
  txLive.recapQty = txRecapRow(recap, 'Quantité');
  txLive.recapMarquages = txRecapRow(recap, 'Marquages', true);
  side.append(recap);
  return side;
}

function txRecapRow(parent, label, liste) {
  const row = el('div', 'tx-recap__row');
  row.append(el('span', 'tx-recap__key', label));
  const val = el(liste ? 'div' : 'span', liste ? 'tx-recap__mks' : 'tx-recap__val', liste ? null : '—');
  row.append(val);
  parent.append(row);
  return val;
}

// --- Barre d'action fixe -----------------------------------------------------
// Toujours visible, jamais à chercher au bas d'un formulaire long. Le contenu
// réserve la hauteur qu'elle occupe (cf. .tx-screen) — jusqu'ici elle recouvrait
// les derniers champs.
function txActionBar() {
  const bar = el('div', 'tx-bar');
  const prix = el('div', 'tx-bar__prix');
  prix.append(el('span', 'tx-bar__label', 'Prix de cette ligne'));
  const chiffres = el('div', 'tx-bar__chiffres');
  txLive.barAmount = el('span', 'tx-bar__amount', '0.00 €');
  txLive.barTtc = el('span', 'tx-bar__ttc', '0.00 € TTC');
  chiffres.append(txLive.barAmount, txLive.barTtc);
  prix.append(chiffres);
  bar.append(prix);

  const btn = el('button', 'tx-bar__btn');
  btn.type = 'button';
  btn.append(ic('add'), el('span', null, 'Ajouter au panier'));
  btn.addEventListener('click', confirmAdd);
  bar.append(btn);
  return bar;
}

// --- Montage de l'écran ------------------------------------------------------
function renderTextileScreen(body) {
  const l = state.addingLigne;
  for (const k of Object.keys(txLive)) delete txLive[k];

  const screen = el('div', 'tx-screen');
  const layout = el('div', 'tx-layout');

  const main = el('div', 'tx-main');
  const back = el('button', 'tx-back', '← Annuler');
  back.type = 'button';
  back.addEventListener('click', cancelAdding);
  main.append(back, el('h3', 'tx-title', 'Textile'));
  main.append(txProduitCard(l), txColorisCard(l), txTaillesCard(l));
  for (const face of FACES_TEXTILE) main.append(txFaceCard(l, face));
  main.append(txRemarquesCard(l), txPrixCard(l), txPaiementCard());

  layout.append(main, txSideColumn());
  screen.append(layout);
  body.replaceChildren(screen, txActionBar());
  txRefresh();
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
        emplacement: f.emplacement, technique: f.technique, typeLogo: f.typeLogo,
        referenceLogo: f.referenceLogo, couleurMarquage: f.couleurMarquage,
      };
    }
    return {
      ...base,
      designation: item.designation, reference: item.reference, coloris: colorisTexte(item),
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
  // Suggestions du catalogue partagé (vêtements, typos) : remplies par
  // `remplirCatalogueDatalists` une fois le catalogue chargé.
  const dlVetements = el('datalist');
  dlVetements.id = 'proj-dl-vetements';
  const dlTypos = el('datalist');
  dlTypos.id = 'proj-dl-typos';
  ROOT.replaceChildren(page, dlVetements, dlTypos);
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
  state.clientForm = null;
  render();
}
