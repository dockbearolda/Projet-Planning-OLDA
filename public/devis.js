// Nouveau Projet — Atelier OLDA : DEMANDE DE DEVIS
// ===========================================================================
// Transcription de la maquette du patron (« Atelier OLDA — Demande de devis »,
// V20) : le client exprime ses BESOINS, Atelier OLDA construit ensuite le projet
// et choisira les articles adaptés. Six étapes :
//   Demande → Besoins → Projet → Contrôle du dossier → Client → Récapitulatif.
//
// Ce qui change par rapport au fichier de la maquette, et pourquoi :
//   - CLIENTS : la maquette avait un annuaire en dur (« Coco Beach », « Etika »…)
//     dans le navigateur. Ici c'est la VRAIE base clients (/api/clients), avec le
//     même sélecteur que la vente directe (comptoir.js) : même recherche, même
//     avertissement de doublon, même format de numéro.
//   - PLANNING : « Voir le récapitulatif » ENREGISTRE la demande dans le planning
//     (POST /api/projets, nature « demande ») — sans quoi personne à l'atelier ne
//     saurait qu'il y a un devis à faire. La « suite souhaitée » de la maquette
//     dit à quelle sous-étape elle se pose :
//         Devis à faire                        → Demande & chiffrage / À chiffrer
//         Attendre les informations du client  → Demande & chiffrage / Demande à qualifier
//   - NUMÉRO : le compteur du jour vit côté serveur (POST /api/devis/numero), pas
//     dans le localStorage du poste : deux postes ne peuvent pas donner la même
//     référence à deux demandes différentes.
//   - PRIX : la maquette avait une étape « Chiffrage » qu'elle a elle-même mise
//     de côté (son étape 6 est vide et masquée). On ne la remet pas : une demande
//     n'a PAS de prix, c'est justement ce qu'on doit chiffrer. La ligne entre au
//     planning avec une colonne Prix TTC vide — pas à 0,00 €.
//   - PDF : la maquette téléchargeait un PDF via une librairie chargée depuis un
//     CDN. L'application n'a aucune dépendance externe (et le comptoir n'est pas
//     toujours en ligne) : « Imprimer » puis « Enregistrer au format PDF » fait
//     le même travail, et le TXT reste téléchargeable.
//   - COULEUR : l'accent est l'encre noire de la charte, pas le vert.

import {
  el, champ, input, select, textarea, carte, bouton, titreEtape,
  effacerErreurs as effacerErreursDe, erreurChamp as erreurChampDe, effacerErreurALaFrappe,
  todayISO, formatDate, heureTexte, dansNJours, api,
  payloadClient, creerSelecteurClient,
} from './comptoir.js';
import { whatsappNumber } from './whatsapp.js';

let ROOT = null;
let CLIENT = null;   // sélecteur de client partagé (comptoir.js)
const $ = (sel) => ROOT.querySelector(sel);
const effacerErreurs = () => effacerErreursDe(ROOT);
const erreurChamp = (id, message) => erreurChampDe(ROOT, id, message);

// --- Listes de la maquette ---------------------------------------------------
// Le catalogue du serveur les complète quand il répond (employés réels) ; ces
// valeurs sont le repli, pour que l'écran reste utilisable hors ligne.
let EMPLOYES = ['Loïc', 'Mélina', 'Charlie', 'Julien'];
const CANAUX = ['WhatsApp', 'Boutique', 'Téléphone', 'Instagram', 'Facebook',
  'E-mail', 'Site internet', 'Recommandation', 'Autre'];
const CATEGORIES = ['Textile', 'Casquette', 'Goodies', 'Signalétique', 'Impression DTF',
  'Impression UV', 'Gravure / découpe laser', 'Broderie', 'Rubber Label'];
const PRODUCTIONS = ['DTF', 'TROTEC', 'TROTEC + UV', 'UV', 'AUTRE'];
const OBJETS = ['Équiper le personnel', 'Créer des produits à revendre', 'Préparer un événement',
  'Communiquer sur l’entreprise', 'Aménager / signaler un lieu', 'Offrir des cadeaux'];
const LOGO_TYPES = ['Pas de besoin', 'Logo OLDA', 'Logo client vectorisé', 'Logo client non vectorisé'];
const LOGO_STATUTS = ['Reçu', 'En attente de réception', 'En cours de création client'];
const VECTORISATIONS = ['Pas de besoin', 'À chiffrer', 'À faire'];
const MAQUETTES = ['Non nécessaire', 'À prévoir', 'À faire', 'En cours', 'Terminée'];
const TRANSMISSIONS = ['WhatsApp', 'Email'];
const HEURES = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'];
// Valeur du menu qui ouvre un champ libre : « + Nouvelle catégorie », etc. La
// liste propose, elle ne contraint pas — un métier absent ne bloque personne.
const AUTRE = '__autre__';

const PRIORITES = [
  { niveau: '1', etoiles: '⭐', titre: 'Projet simple', aide: 'Petit projet, faible montant ou peu d’enjeu.' },
  { niveau: '2', etoiles: '⭐⭐', titre: 'Projet intéressant', aide: 'Bon potentiel, à suivre rapidement.' },
  { niveau: '3', etoiles: '⭐⭐⭐', titre: 'Projet prioritaire', aide: 'Projet urgent, stratégique ou à fort potentiel.' },
];

// L'état du dossier, tel que la maquette le pose. Seul « attente » ouvre le bloc
// des informations encore attendues.
const ETATS_DOSSIER = [
  { id: 'recu', label: 'Informations reçues' },
  { id: 'partiel', label: 'Informations reçues partiellement' },
  { id: 'attente', label: 'En attente d’informations' },
];

// LA question qui décide de la place au planning. Deux réponses, deux
// sous-étapes de « Demande & chiffrage » : le dossier est complet et il n'y a
// plus qu'à chiffrer, ou il manque des éléments et la demande attend d'être
// qualifiée.
const SUITES = [
  {
    id: 'devis', titre: 'Devis à faire',
    aide: 'Le dossier est assez complet pour préparer le devis.',
    stage: 'demande_chiffrage', subStage: 'a_chiffrer',
    label: 'Demande & chiffrage — À chiffrer',
  },
  {
    id: 'attente', titre: 'Attendre les informations du client',
    aide: 'Il manque encore des éléments avant de pouvoir chiffrer.',
    stage: 'demande_chiffrage', subStage: 'demande_a_qualifier',
    label: 'Demande & chiffrage — Demande à qualifier',
  },
];
const suiteParId = (id) => SUITES.find((s) => s.id === id) || null;

// --- État -------------------------------------------------------------------
const ETAPES = ['demande', 'besoins', 'projet', 'controle', 'client', 'recap'];
const TITRES_ETAPES = ['1. Demande', '2. Besoins', '3. Projet', '4. Contrôle', '5. Client', '6. Récapitulatif'];

const state = {
  etape: 'demande',
  besoins: [],        // { categorie, label, quantite, reference, couleur, production, infos }
  enEdition: -1,      // index du besoin en cours de modification, -1 = aucun
  client: null,
  priorite: '',       // '1' | '2' | '3'
  suite: '',          // 'devis' | 'attente'
  numero: '',         // référence de la demande, réservée au premier besoin
  enregistree: false, // la demande est-elle déjà partie au planning ?
};

// ===========================================================================
// Étapes
// ===========================================================================
function afficherEtape(nom) {
  state.etape = nom;
  const courant = ETAPES.indexOf(nom);
  ETAPES.forEach((id, i) => {
    $(`#dv-section-${id}`).classList.toggle('vd-hidden', id !== nom);
    const pas = $(`#dv-step-${id}`);
    pas.classList.toggle('is-active', i === courant);
    pas.classList.toggle('is-done', i < courant);
  });
  $('#dv-container').scrollTo({ top: 0, behavior: 'smooth' });
}

// Un menu « + Nouveau … » et son champ libre : le champ n'apparaît que si on a
// choisi de créer, et c'est lui qui fait foi dans ce cas.
function brancherAutre(selectId, inputId) {
  const liste = $(`#${selectId}`);
  liste.addEventListener('change', () => {
    const ouvert = liste.value === AUTRE;
    $(`#${inputId}`).classList.toggle('vd-hidden', !ouvert);
    if (ouvert) $(`#${inputId}`).focus();
  });
}
function valeurAvecAutre(selectId, inputId) {
  return $(`#${selectId}`).value === AUTRE ? $(`#${inputId}`).value.trim() : $(`#${selectId}`).value;
}

// ===========================================================================
// Étape 1 — Nouvelle demande
// ===========================================================================
function validerDemande() {
  effacerErreurs();
  if (!$('#dv-salesperson').value) return erreurChamp('dv-salesperson', 'Choisis qui prend la demande.');
  if (!valeurAvecAutre('dv-source', 'dv-source-autre')) {
    return erreurChamp($('#dv-source').value === AUTRE ? 'dv-source-autre' : 'dv-source', 'Choisis le canal d’entrée.');
  }
  return true;
}

// ===========================================================================
// Étape 2 — Recueil des besoins
// ===========================================================================
function validerFormulaireBesoin() {
  effacerErreurs();
  if (!valeurAvecAutre('dv-need-cat', 'dv-need-cat-autre')) {
    return erreurChamp($('#dv-need-cat').value === AUTRE ? 'dv-need-cat-autre' : 'dv-need-cat', 'Choisis une catégorie.');
  }
  if (!$('#dv-need-label').value.trim()) return erreurChamp('dv-need-label', 'Renseigne la désignation du besoin.');
  if (Number($('#dv-need-qty').value) <= 0) return erreurChamp('dv-need-qty', 'La quantité doit être supérieure à 0.');
  return true;
}

function enregistrerBesoin() {
  if (!validerFormulaireBesoin()) return;
  // Il y a une demande : on lui donne sa référence (sans attendre la réponse, la
  // saisie continue — la référence se pose dès qu'elle arrive).
  reserverNumero();
  const besoin = {
    categorie: valeurAvecAutre('dv-need-cat', 'dv-need-cat-autre'),
    label: $('#dv-need-label').value.trim(),
    quantite: Number($('#dv-need-qty').value),
    reference: $('#dv-need-ref').value.trim(),
    couleur: $('#dv-need-color').value.trim(),
    production: $('#dv-need-prod').value,
    infos: $('#dv-need-infos').value.trim(),
  };
  if (state.enEdition >= 0) state.besoins[state.enEdition] = besoin;
  else state.besoins.push(besoin);
  sortirDeLEdition();
  peindreBesoins();
}

function sortirDeLEdition() {
  state.enEdition = -1;
  $('#dv-need-cat').value = '';
  $('#dv-need-cat-autre').value = '';
  $('#dv-need-cat-autre').classList.add('vd-hidden');
  $('#dv-need-label').value = '';
  $('#dv-need-qty').value = '1';
  $('#dv-need-ref').value = '';
  $('#dv-need-color').value = '';
  $('#dv-need-prod').value = '';
  $('#dv-need-infos').value = '';
  $('#dv-save-need').textContent = 'Ajouter ce besoin';
  $('#dv-cancel-need').classList.add('vd-hidden');
}

function modifierBesoin(index) {
  const b = state.besoins[index];
  state.enEdition = index;
  const connue = CATEGORIES.includes(b.categorie);
  $('#dv-need-cat').value = connue ? b.categorie : AUTRE;
  $('#dv-need-cat-autre').value = connue ? '' : b.categorie;
  $('#dv-need-cat-autre').classList.toggle('vd-hidden', connue);
  $('#dv-need-label').value = b.label;
  $('#dv-need-qty').value = b.quantite;
  $('#dv-need-ref').value = b.reference;
  $('#dv-need-color').value = b.couleur;
  $('#dv-need-prod').value = b.production;
  $('#dv-need-infos').value = b.infos;
  $('#dv-save-need').textContent = 'Enregistrer la modification';
  $('#dv-cancel-need').classList.remove('vd-hidden');
  $('#dv-need-label').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function supprimerBesoin(index) {
  state.besoins.splice(index, 1);
  if (state.enEdition === index) sortirDeLEdition();
  peindreBesoins();
}

function peindreBesoins() {
  const n = state.besoins.length;
  $('#dv-need-count').textContent = `${n} besoin${n > 1 ? 's' : ''}`;
  $('#dv-need-form-title').textContent = state.enEdition >= 0
    ? `Modifier le besoin n°${state.enEdition + 1}`
    : `Besoin n°${n + 1}`;

  const box = $('#dv-need-list');
  box.replaceChildren();
  if (!n) {
    box.append(el('p', 'vd-help', 'Aucun besoin ajouté.'));
    return;
  }
  state.besoins.forEach((b, i) => {
    const item = el('div', 'vd-item');
    const tete = el('div', 'vd-item-head');
    const gauche = el('div');
    gauche.append(el('span', 'vd-badge vd-badge--on', b.categorie), el('h3', null, b.label));
    const details = [
      b.reference ? `Réf. ${b.reference}` : null,
      b.couleur || null,
      b.production ? `Production ${b.production}` : null,
    ].filter(Boolean).join(' • ');
    if (details) gauche.append(el('div', 'vd-help', details));
    if (b.infos) gauche.append(el('div', 'vd-help', b.infos));
    tete.append(gauche, el('b', null, `${b.quantite} u.`));

    const actions = el('div', 'vd-actions');
    actions.style.marginTop = '10px';
    const modifier = bouton(null, 'Modifier');
    modifier.addEventListener('click', () => modifierBesoin(i));
    const supprimer = bouton(null, 'Supprimer');
    supprimer.addEventListener('click', () => supprimerBesoin(i));
    actions.append(modifier, supprimer);

    item.append(tete, actions);
    box.append(item);
  });
}

const categories = () => [...new Set(state.besoins.map((b) => b.categorie))];

function titrePropose() {
  const c = categories();
  if (!c.length) return '';
  if (c.length === 1) return `Projet ${c[0]}`;
  if (c.length === 2) return `${c[0]} + ${c[1]}`;
  return `Projet multi-produits — ${c.slice(0, 3).join(', ')}`;
}

function validerBesoins() {
  effacerErreurs();
  if (!state.besoins.length) return erreurChamp('dv-need-label', 'Ajoute au moins un besoin avant de continuer.');
  return true;
}

// ===========================================================================
// Étape 3 — Construction du projet
// ===========================================================================
// Le projet se construit À PARTIR des besoins : la liste des familles et le
// titre proposé se remplissent seuls, mais restent modifiables.
function preparerProjet() {
  const pills = $('#dv-cat-pills');
  pills.replaceChildren(...categories().map((c) => el('span', 'vd-badge', c)));
  if (!$('#dv-project-title').value.trim()) $('#dv-project-title').value = titrePropose();
  if (!$('#dv-project-desc').value.trim()) {
    $('#dv-project-desc').value = `Le client souhaite ${state.besoins.map((b) => `${b.quantite} ${b.label}`).join(', ')}.`;
  }
}

function choisirPriorite(niveau) {
  state.priorite = niveau;
  for (const b of ROOT.querySelectorAll('#dv-priority-group .dv-card-choice')) {
    b.classList.toggle('is-active', b.dataset.priorite === niveau);
  }
  $('#dv-priority-field').classList.remove('dv-choice-error');
}

// Date souhaitée : les raccourcis de la maquette (5 / 10 / 15 jours) remplissent
// le calendrier, « Choisir une date » l'ouvre. C'est TOUJOURS la date qui part au
// serveur — le raccourci n'est qu'une façon rapide de la poser.
function majDateSouhaitee() {
  const choix = $('#dv-delay').value;
  $('#dv-desired-date').classList.toggle('vd-hidden', choix !== 'custom');
  if (['5', '10', '15'].includes(choix)) $('#dv-desired-date').value = dansNJours(choix);
  else if (choix === '') $('#dv-desired-date').value = '';
}

function validerProjet() {
  effacerErreurs();
  if (!$('#dv-project-title').value.trim()) return erreurChamp('dv-project-title', 'Renseigne le titre du projet.');
  if (!valeurAvecAutre('dv-goal', 'dv-goal-autre')) {
    return erreurChamp($('#dv-goal').value === AUTRE ? 'dv-goal-autre' : 'dv-goal', 'Choisis l’objet du projet.');
  }
  if (!state.priorite) {
    $('#dv-priority-field').classList.add('dv-choice-error');
    $('#dv-priority-group').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  if (!$('#dv-project-desc').value.trim()) return erreurChamp('dv-project-desc', 'Décris le projet.');
  return true;
}

// ===========================================================================
// Étape 4 — Contrôle du dossier
// ===========================================================================
function majControle() {
  const etat = $('#dv-control-status').value;
  // « En attente d'informations » : ce n'est plus ce qu'on a reçu qui compte,
  // c'est ce qu'on attend et par quel canal il doit arriver.
  $('#dv-waiting-box').classList.toggle('vd-hidden', etat !== 'attente');
  $('#dv-received-via-field').classList.toggle('vd-hidden', etat === 'attente');

  const details = [
    $('#dv-logo-type').value ? `Type de logo : ${$('#dv-logo-type').value}` : null,
    $('#dv-logo-status').value ? `Statut du logo : ${$('#dv-logo-status').value}` : null,
    $('#dv-vector').value ? `Vectorisation : ${$('#dv-vector').value}` : null,
    $('#dv-mockup').value ? `Maquette / fichier numérique : ${$('#dv-mockup').value}` : null,
    etat !== 'attente' && valeurAvecAutre('dv-received-via', 'dv-received-via-autre')
      ? `Transmission : ${valeurAvecAutre('dv-received-via', 'dv-received-via-autre')}` : null,
    etat === 'attente' && valeurAvecAutre('dv-expected-via', 'dv-expected-via-autre')
      ? `Transmission prévue : ${valeurAvecAutre('dv-expected-via', 'dv-expected-via-autre')}` : null,
    etat === 'attente' && $('#dv-expected').value.trim()
      ? `À recevoir : ${$('#dv-expected').value.trim()}` : null,
  ].filter(Boolean);

  const box = $('#dv-control-box');
  box.replaceChildren();
  if (!etat) {
    box.append(el('span', null, 'Renseigne l’état des informations reçues.'));
    return;
  }
  box.append(el('b', null, (ETATS_DOSSIER.find((e) => e.id === etat) || {}).label));
  if (details.length) {
    const ul = el('ul', 'dv-control-list');
    for (const d of details) ul.append(el('li', null, d));
    box.append(ul);
  }
}

function validerControle() {
  effacerErreurs();
  if (!$('#dv-control-status').value) {
    return erreurChamp('dv-control-status', 'Indique l’état des informations du client.');
  }
  if ($('#dv-control-status').value === 'attente') {
    if (!valeurAvecAutre('dv-expected-via', 'dv-expected-via-autre')) {
      return erreurChamp(
        $('#dv-expected-via').value === AUTRE ? 'dv-expected-via-autre' : 'dv-expected-via',
        'Indique comment le client doit transmettre les informations.',
      );
    }
    if (!$('#dv-expected').value.trim()) {
      return erreurChamp('dv-expected', 'Indique les informations encore attendues.');
    }
  }
  return true;
}

// ===========================================================================
// Étape 5 — Client et suite à donner
// ===========================================================================
function surChangementClient(client) {
  state.client = client;
  // La suite à donner ne se pose qu'une fois le client connu : c'est la dernière
  // décision, et elle décide de la place au planning.
  $('#dv-next-action-block').classList.toggle('vd-hidden', !client);
  $('#dv-to-recap').classList.toggle('vd-hidden', !client);
}

function choisirSuite(id) {
  state.suite = id;
  for (const b of ROOT.querySelectorAll('#dv-next-action-grid .dv-card-choice')) {
    b.classList.toggle('is-active', b.dataset.suite === id);
  }
  $('#dv-next-action-block').classList.remove('dv-choice-error');
}

function validerClient() {
  effacerErreurs();
  if (!state.client) return erreurChamp(CLIENT.champRechercheId, 'Sélectionne ou crée le client de cette demande.');
  if (!state.suite) {
    $('#dv-next-action-block').classList.add('dv-choice-error');
    $('#dv-next-action-block').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  return true;
}

// ===========================================================================
// Enregistrement au planning
// ===========================================================================
// Un besoin est une ligne « autres » côté serveur : la désignation est ce que le
// client demande, l'explication ce qu'il a précisé. Aucun prix — c'est
// exactement ce que le chiffrage devra poser.
function besoinVersLigne(b) {
  return {
    type: 'autres',
    quantite: b.quantite,
    designation: b.label,
    explication: b.infos || undefined,
    categorie: b.categorie || undefined,
    reference: b.reference || undefined,
    couleur: b.couleur || undefined,
    methode: b.production || undefined,
  };
}

// Une demande n'a pas toujours de date : le client veut un prix, pas encore une
// livraison. Le planning, lui, refuse une ligne sans échéance — sans date, on
// pose J+15, l'horizon par défaut d'une demande à chiffrer.
const DELAI_PAR_DEFAUT = 15;
function dateSouhaitee() {
  return $('#dv-desired-date').value || dansNJours(DELAI_PAR_DEFAUT);
}

function payloadDemande() {
  const suite = suiteParId(state.suite);
  const etat = $('#dv-control-status').value;
  const budget = $('#dv-budget').value.trim();
  return {
    kind: 'demande',
    numero: state.numero,
    client: payloadClient(state.client),
    lignes: state.besoins.map(besoinVersLigne),
    deadline: dateSouhaitee(),
    heureSouhaitee: $('#dv-desired-time').value || undefined,
    // La priorité du patron (⭐ à ⭐⭐⭐) EST celle du planning.
    priority: Number(state.priorite) || 1,
    // Celle qui a pris la demande la pilote jusqu'au devis.
    responsable: $('#dv-salesperson').value || undefined,
    // Pas de `noteInterne` : les contraintes du projet sont déjà dans le brief
    // ci-dessous, les répéter les afficherait deux fois dans le résumé.
    stage: suite.stage,
    subStage: suite.subStage,
    demande: {
      priseLe: $('#dv-request-date').value,
      prisePar: $('#dv-salesperson').value,
      canal: valeurAvecAutre('dv-source', 'dv-source-autre'),
      objet: valeurAvecAutre('dv-goal', 'dv-goal-autre'),
      budget: budget || undefined,
      description: $('#dv-project-desc').value.trim(),
      contraintes: $('#dv-project-constraints').value.trim(),
      etat: etat || undefined,
      logoType: $('#dv-logo-type').value,
      logoStatut: $('#dv-logo-status').value,
      vectorisation: $('#dv-vector').value,
      maquette: $('#dv-mockup').value,
      transmisPar: etat === 'attente' ? '' : valeurAvecAutre('dv-received-via', 'dv-received-via-autre'),
      attenduPar: etat === 'attente' ? valeurAvecAutre('dv-expected-via', 'dv-expected-via-autre') : '',
      attendu: etat === 'attente' ? $('#dv-expected').value.trim() : '',
      recus: $('#dv-received').value.trim(),
      aVerifier: $('#dv-to-check').value.trim(),
      suite: state.suite,
    },
  };
}

// La demande entre au planning AVANT que le récapitulatif s'affiche : sans ça on
// remettrait au client une fiche dont l'atelier n'a jamais entendu parler.
async function ouvrirRecapitulatif() {
  if (!validerClient()) return;
  if (!state.enregistree) {
    const btn = $('#dv-to-recap');
    btn.disabled = true;
    try {
      // La référence a pu ne pas être réservée (serveur injoignable au premier
      // besoin) : on retente ici, c'est le dernier moment utile.
      await reserverNumero();
      await api('POST', '/api/projets', payloadDemande());
      state.enregistree = true;
    } catch (err) {
      window.alert(err.message || 'Enregistrement impossible');
      return;
    } finally {
      btn.disabled = false;
    }
  }
  remplirRecapitulatif();
  afficherEtape('recap');
}

// ===========================================================================
// Étape 6 — Récapitulatif
// ===========================================================================
function texteDateSouhaitee() {
  if (!$('#dv-desired-date').value) return 'Non précisée';
  return `${formatDate($('#dv-desired-date').value)}${$('#dv-desired-time').value ? ` à ${heureTexte($('#dv-desired-time').value)}` : ''}`;
}

function remplirRecapitulatif() {
  const suite = suiteParId(state.suite);
  const priorite = PRIORITES.find((p) => p.niveau === state.priorite);

  $('#dv-final-ref').textContent = state.numero || '—';
  $('#dv-final-date').textContent = formatDate($('#dv-request-date').value);

  const infos = [
    ['Projet', $('#dv-project-title').value || '—'],
    ['Client', state.client ? state.client.nom : '—'],
    ['Demande prise par', `${$('#dv-salesperson').value} — ${valeurAvecAutre('dv-source', 'dv-source-autre')}`],
    ['Date souhaitée', texteDateSouhaitee()],
    ['Priorité', priorite ? `${priorite.etoiles} ${priorite.titre}` : '—'],
    ['Objet du projet', valeurAvecAutre('dv-goal', 'dv-goal-autre') || '—'],
  ];
  const budget = $('#dv-budget').value.trim();
  if (budget) infos.push(['Budget indicatif', `${Number(budget).toFixed(2)} €`]);
  infos.push(['Suite à donner', suite ? suite.titre : '—']);

  const grille = $('#dv-final-infos');
  grille.replaceChildren();
  for (const [label, valeur] of infos) {
    const bloc = el('div', 'dv-info');
    bloc.append(el('span', null, label), el('strong', null, valeur));
    grille.append(bloc);
  }

  const besoins = $('#dv-final-needs');
  besoins.replaceChildren();
  for (const b of state.besoins) {
    const carteBesoin = el('div', 'dv-final-card');
    carteBesoin.append(el('b', null, `${b.quantite} × ${b.label}`));
    const details = [
      b.categorie, b.reference ? `Réf. ${b.reference}` : null, b.couleur || null,
      b.production ? `Production ${b.production}` : null,
    ].filter(Boolean).join(' • ');
    if (details) carteBesoin.append(el('div', 'vd-help', details));
    if (b.infos) carteBesoin.append(el('div', null, b.infos));
    besoins.append(carteBesoin);
  }

  const controle = $('#dv-final-control');
  controle.replaceChildren();
  const etat = ETATS_DOSSIER.find((e) => e.id === $('#dv-control-status').value);
  for (const [label, valeur] of [
    ['État du dossier', etat ? etat.label : '—'],
    ['Logo', $('#dv-logo-type').value],
    ['Statut du logo', $('#dv-logo-status').value],
    ['Vectorisation', $('#dv-vector').value],
    ['Maquette', $('#dv-mockup').value],
    ['Éléments reçus', $('#dv-received').value.trim()],
    ['Informations attendues', $('#dv-expected').value.trim()],
    ['À contrôler', $('#dv-to-check').value.trim()],
  ]) {
    if (!valeur) continue;
    const ligne = el('div', 'vd-ticket-row');
    ligne.append(el('span', null, label), el('span', null, valeur));
    controle.append(ligne);
  }

  $('#dv-placed').replaceChildren(
    document.createTextNode('Demande enregistrée au planning sous '),
    el('b', null, state.numero || '—'),
    document.createTextNode(` — ${suite ? suite.label : ''}.`),
  );
}

function texteRecapitulatif() {
  const suite = suiteParId(state.suite);
  const priorite = PRIORITES.find((p) => p.niveau === state.priorite);
  const c = state.client;
  const budget = $('#dv-budget').value.trim();
  return [
    'ATELIER OLDA — RÉCAPITULATIF DE DEMANDE',
    '',
    `Référence : ${state.numero}`,
    `Date : ${formatDate($('#dv-request-date').value)}`,
    `Demande prise par : ${$('#dv-salesperson').value} (${valeurAvecAutre('dv-source', 'dv-source-autre')})`,
    `Projet : ${$('#dv-project-title').value || '—'}`,
    `Client : ${c ? c.nom : '—'}`,
    `WhatsApp : ${(c && c.telephone) || '—'}`,
    `Date souhaitée : ${texteDateSouhaitee()}`,
    `Priorité : ${priorite ? `${priorite.etoiles} ${priorite.titre}` : '—'}`,
    `Objet du projet : ${valeurAvecAutre('dv-goal', 'dv-goal-autre') || '—'}`,
    budget ? `Budget indicatif : ${Number(budget).toFixed(2)} €` : null,
    `Suite à donner : ${suite ? suite.titre : '—'}`,
    '',
    'BESOINS EXPRIMÉS',
    ...state.besoins.flatMap((b) => [
      `- ${b.quantite} × ${b.label} (${b.categorie})${b.reference ? ` — Réf. ${b.reference}` : ''}${b.couleur ? ` — ${b.couleur}` : ''}${b.production ? ` — Production ${b.production}` : ''}`,
      b.infos ? `  Informations : ${b.infos}` : null,
    ].filter(Boolean)),
    '',
    'PROJET',
    $('#dv-project-desc').value.trim(),
    $('#dv-project-constraints').value.trim() ? `À garder en tête : ${$('#dv-project-constraints').value.trim()}` : null,
    '',
    'CONTRÔLE DU DOSSIER',
    `État : ${(ETATS_DOSSIER.find((e) => e.id === $('#dv-control-status').value) || {}).label || '—'}`,
    $('#dv-logo-type').value ? `Logo : ${$('#dv-logo-type').value}` : null,
    $('#dv-logo-status').value ? `Statut du logo : ${$('#dv-logo-status').value}` : null,
    $('#dv-vector').value ? `Vectorisation : ${$('#dv-vector').value}` : null,
    $('#dv-mockup').value ? `Maquette : ${$('#dv-mockup').value}` : null,
    $('#dv-received').value.trim() ? `Éléments reçus : ${$('#dv-received').value.trim()}` : null,
    $('#dv-expected').value.trim() ? `Informations attendues : ${$('#dv-expected').value.trim()}` : null,
    $('#dv-to-check').value.trim() ? `À contrôler : ${$('#dv-to-check').value.trim()}` : null,
  ].filter((l) => l !== null).join('\n');
}

function imprimerRecapitulatif() {
  // La classe dit à la feuille d'impression de ne garder QUE la fiche ; elle
  // repart dès la boîte de dialogue fermée, même si l'impression est annulée.
  document.body.classList.add('vd-print');
  const nettoyer = () => document.body.classList.remove('vd-print');
  window.addEventListener('afterprint', nettoyer, { once: true });
  window.print();
  setTimeout(nettoyer, 1000);
}

function telechargerRecapitulatif() {
  // Le BOM ouvre le fichier correctement dans les éditeurs Windows du bureau.
  const blob = new Blob([`﻿${texteRecapitulatif()}`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Demande_${(state.numero || 'Atelier_OLDA').replaceAll('.', '-')}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Ouvre WhatsApp avec le message DÉJÀ ÉCRIT : rien ne part tout seul, c'est
// l'employé qui appuie sur Envoyer.
function envoyerWhatsApp() {
  const c = state.client;
  const numero = whatsappNumber(c && c.telephone);
  if (!numero) {
    window.alert('Ce client n’a pas de numéro WhatsApp lisible : le message ne peut pas être préparé.');
    return;
  }
  const texte = [
    `Bonjour ${c.nom},`,
    '',
    'Nous avons bien enregistré votre demande :',
    '',
    texteRecapitulatif(),
    '',
    'Nous revenons vers vous avec le devis.',
    'L’équipe Atelier OLDA',
  ].join('\n');
  window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texte)}`, '_blank', 'noopener');
}

// ===========================================================================
// Référence de la demande
// ===========================================================================
// Repli si le compteur du serveur est injoignable : le comptoir ne s'arrête pas
// pour ça. La référence garde le format du patron, elle peut juste retomber sur
// un rang déjà pris par un autre poste.
function numeroLocal() {
  const [y, m, d] = todayISO().split('-');
  const cle = `olda-devis-seq-${y}${m}${d}`;
  const rang = (Number(localStorage.getItem(cle)) || 0) + 1;
  try { localStorage.setItem(cle, String(rang)); } catch (_) { /* navigation privée */ }
  return `DEV-${y.slice(2)}.${m}.${d}-${String(rang).padStart(3, '0')}`;
}

function peindreNumero() {
  for (const id of ETAPES) {
    const ref = $(`#dv-ref-${id}`);
    if (ref) ref.textContent = state.numero || '—';
  }
}

// La référence est réservée au PREMIER besoin, pas à l'ouverture de l'écran :
// une référence attribuée n'est jamais réutilisée, et ouvrir l'onglet pour rien
// ne doit pas faire un trou dans la numérotation.
async function reserverNumero() {
  if (state.numero) return state.numero;
  try {
    const r = await api('POST', '/api/devis/numero', { jour: todayISO() });
    state.numero = r.numero;
  } catch (_) {
    state.numero = numeroLocal();
  }
  peindreNumero();
  return state.numero;
}

// ===========================================================================
// Remise à zéro (« Nouvelle demande », ou retour sur l'onglet)
// ===========================================================================
function nouvelleDemande() {
  state.besoins = [];
  state.client = null;
  state.priorite = '';
  state.suite = '';
  state.numero = '';
  state.enregistree = false;
  effacerErreurs();
  sortirDeLEdition();
  peindreNumero();

  $('#dv-request-date').value = todayISO();
  for (const id of ['dv-salesperson', 'dv-source', 'dv-source-autre', 'dv-project-title',
    'dv-goal', 'dv-goal-autre', 'dv-budget', 'dv-project-desc', 'dv-project-constraints',
    'dv-delay', 'dv-desired-date', 'dv-control-status', 'dv-logo-status',
    'dv-received-via', 'dv-received-via-autre', 'dv-expected-via', 'dv-expected-via-autre',
    'dv-expected', 'dv-received', 'dv-to-check']) {
    $(`#${id}`).value = '';
  }
  $('#dv-desired-time').value = '14:00';
  $('#dv-logo-type').value = LOGO_TYPES[0];
  $('#dv-vector').value = VECTORISATIONS[0];
  $('#dv-mockup').value = MAQUETTES[0];
  for (const id of ['dv-source-autre', 'dv-goal-autre', 'dv-desired-date',
    'dv-received-via-autre', 'dv-expected-via-autre']) {
    $(`#${id}`).classList.add('vd-hidden');
  }
  choisirPriorite('');
  choisirSuite('');
  $('#dv-priority-field').classList.remove('dv-choice-error');
  $('#dv-next-action-block').classList.remove('dv-choice-error');
  CLIENT.reset();
  majControle();
  peindreBesoins();
  afficherEtape('demande');
}

// ===========================================================================
// Construction du DOM (une fois)
// ===========================================================================
// Un menu déroulant qui peut aussi accueillir une valeur libre : la liste, puis
// le champ caché qui n'apparaît que sur « + Nouveau … ».
function champAvecAutre(label, selectId, options, inputId, placeholder, libelleAutre) {
  const liste = select(selectId, ['Choisir', ...options, libelleAutre], ['', ...options, AUTRE]);
  const libre = input(inputId, 'text', placeholder);
  libre.classList.add('vd-hidden');
  libre.style.marginTop = '8px';
  const wrap = champ(label, liste);
  wrap.append(libre);
  return wrap;
}

// Une grande cible tactile plutôt qu'un menu : priorité et suite à donner sont
// des décisions, elles méritent d'être lisibles d'un coup d'œil.
function carteChoix(dataset, valeur, chapeau, titre, aide) {
  const b = el('button', 'dv-card-choice');
  b.type = 'button';
  b.dataset[dataset] = valeur;
  if (chapeau) b.append(el('span', 'dv-card-choice__mark', chapeau));
  b.append(el('strong', null, titre), el('small', null, aide));
  return b;
}

function sectionDemande() {
  const section = el('section');
  section.id = 'dv-section-demande';

  const grille = el('div', 'vd-grid-3');
  grille.append(
    champ('Date du jour', input('dv-request-date', 'date', null, { readOnly: true })),
    champ('Demande prise par *', select('dv-salesperson', ['Choisir'], [''])),
    champAvecAutre('Canal d’entrée *', 'dv-source', CANAUX, 'dv-source-autre',
      'Nom du canal d’entrée', '+ Nouveau canal'),
  );

  section.append(carte(
    titreEtape('1. Nouvelle demande', 'dv-ref-demande'),
    el('div', 'vd-notice', 'Le client exprime ses besoins ; Atelier OLDA construit ensuite le projet et choisira les articles adaptés.'),
    grille,
    bouton('dv-goto-besoins', 'Recueillir les besoins →', 'vd-btn vd-btn--primary vd-btn--full'),
  ));
  return section;
}

function sectionBesoins() {
  const section = el('section', 'vd-hidden');
  section.id = 'dv-section-besoins';

  const titre = el('h3', null, 'Besoin n°1');
  titre.id = 'dv-need-form-title';

  const grille1 = el('div', 'vd-grid-3');
  grille1.append(
    champAvecAutre('Catégorie *', 'dv-need-cat', CATEGORIES, 'dv-need-cat-autre',
      'Nom de la nouvelle catégorie', '+ Nouvelle catégorie'),
    champ('Désignation du besoin *', input('dv-need-label', 'text', 'Ex. Tee-shirts manches courtes')),
    champ('Quantité estimée *', input('dv-need-qty', 'number', null, { min: '1', step: '1', value: '1' })),
  );
  const grille2 = el('div', 'vd-grid-3');
  grille2.append(
    champ('Référence demandée', input('dv-need-ref', 'text', 'Ex. NS300')),
    champ('Couleur', input('dv-need-color', 'text', 'Ex. Noir')),
    champ('Type de production', select('dv-need-prod', ['Non précisé', ...PRODUCTIONS], ['', ...PRODUCTIONS])),
  );
  const infos = textarea('dv-need-infos',
    'Ex. tailles, dimensions, emplacement du logo, type de marquage, qualité souhaitée, délai impératif…', 5);

  const actions = el('div', 'vd-actions');
  const annuler = bouton('dv-cancel-need', 'Annuler la modification');
  annuler.classList.add('vd-hidden');
  actions.append(bouton('dv-save-need', 'Ajouter ce besoin', 'vd-btn vd-btn--primary'), annuler);

  section.append(carte(
    titreEtape('2. Recueil des besoins', 'dv-ref-besoins'),
    el('div', 'vd-notice', 'Note ce que le client demande. Ce qui manque encore se complètera plus tard.'),
    titre, grille1, grille2, champ('Informations importantes', infos), actions,
  ));

  const tete = el('div', 'vd-item-head');
  const compteur = el('span', 'vd-badge', '0 besoin');
  compteur.id = 'dv-need-count';
  tete.append(el('h2', null, 'Besoins enregistrés'), compteur);
  const liste = el('div');
  liste.id = 'dv-need-list';
  section.append(carte(tete, liste));

  const bas = el('div', 'vd-actions');
  bas.append(
    bouton('dv-goto-projet', 'Construire le projet →', 'vd-btn vd-btn--primary'),
    bouton('dv-back-demande', '← Retour'),
  );
  section.append(carte(bas));
  return section;
}

function sectionProjet() {
  const section = el('section', 'vd-hidden');
  section.id = 'dv-section-projet';

  const pills = el('div', 'dv-pills');
  pills.id = 'dv-cat-pills';

  const priorites = el('div', 'dv-choice-grid dv-choice-grid--3');
  priorites.id = 'dv-priority-group';
  for (const p of PRIORITES) {
    const b = carteChoix('priorite', p.niveau, p.etoiles, p.titre, p.aide);
    b.addEventListener('click', () => choisirPriorite(p.niveau));
    priorites.append(b);
  }
  const champPriorite = el('div', 'vd-field');
  champPriorite.id = 'dv-priority-field';
  champPriorite.append(el('label', null, 'Priorité du projet *'), priorites);

  const dateWrap = champ('Date souhaitée', select(
    'dv-delay',
    ['Non précisée', 'Dans 5 jours', 'Dans 10 jours', 'Dans 15 jours', 'Choisir une date'],
    ['', '5', '10', '15', 'custom'],
  ));
  const dateChoisie = input('dv-desired-date', 'date');
  dateChoisie.classList.add('vd-hidden');
  dateChoisie.style.marginTop = '8px';
  dateWrap.append(dateChoisie);
  dateWrap.append(el('div', 'vd-help', `Sans date précisée, la demande est posée au planning à J+${DELAI_PAR_DEFAUT}.`));

  const grilleDate = el('div', 'vd-grid');
  grilleDate.append(dateWrap, champ('Heure souhaitée', select('dv-desired-time', HEURES.map(heureTexte), HEURES)));

  const grilleObjet = el('div', 'vd-grid');
  grilleObjet.append(
    champAvecAutre('Objet du projet *', 'dv-goal', OBJETS, 'dv-goal-autre',
      'Saisir le nouvel objet du projet', '+ Nouvel objet du projet'),
    champ('Budget indicatif', input('dv-budget', 'number', 'Facultatif', { min: '0', step: '0.01', inputMode: 'decimal' })),
  );

  section.append(carte(
    titreEtape('3. Construction du projet', 'dv-ref-projet'),
    el('div', 'vd-notice', 'Le projet est construit à partir des besoins enregistrés. Le titre proposé reste modifiable.'),
    el('h3', null, 'Familles concernées'), pills,
    champ('Titre du projet *', input('dv-project-title', 'text', 'Titre proposé automatiquement')),
    champPriorite,
    grilleDate,
    grilleObjet,
    champ('Description générale du projet *', textarea('dv-project-desc', null, 4)),
    champ('Décisions ou contraintes à garder en tête', textarea('dv-project-constraints',
      'Ex. le client valide toujours par WhatsApp, ne pas commander avant l’acompte…', 3)),
  ));

  const bas = el('div', 'vd-actions');
  bas.append(
    bouton('dv-goto-controle', 'Contrôler le dossier →', 'vd-btn vd-btn--primary'),
    bouton('dv-back-besoins', '← Retour'),
  );
  section.append(carte(bas));
  return section;
}

function sectionControle() {
  const section = el('section', 'vd-hidden');
  section.id = 'dv-section-controle';

  const etat = champ('État des informations du client *', select(
    'dv-control-status',
    ['Sélectionner une option', ...ETATS_DOSSIER.map((e) => e.label)],
    ['', ...ETATS_DOSSIER.map((e) => e.id)],
  ));

  const grilleLogo = el('div', 'vd-grid');
  grilleLogo.append(
    champ('Type de logo', select('dv-logo-type', LOGO_TYPES)),
    champ('Statut du logo', select('dv-logo-status', ['Sélectionner une option', ...LOGO_STATUTS], ['', ...LOGO_STATUTS])),
  );

  const grilleMaquette = el('div', 'vd-grid');
  const recuPar = champAvecAutre('Informations transmises par', 'dv-received-via', TRANSMISSIONS,
    'dv-received-via-autre', 'Nom du mode de transmission', '+ Créer un nouveau');
  recuPar.id = 'dv-received-via-field';
  grilleMaquette.append(champ('Maquette / fichier numérique', select('dv-mockup', MAQUETTES)), recuPar);

  const attente = el('div', 'vd-notice vd-hidden');
  attente.id = 'dv-waiting-box';
  const grilleAttente = el('div', 'vd-grid');
  grilleAttente.append(
    champAvecAutre('Transmission prévue par *', 'dv-expected-via', TRANSMISSIONS,
      'dv-expected-via-autre', 'Nom du mode de transmission', '+ Créer un nouveau'),
    champ('Informations que le client doit transmettre *', textarea('dv-expected',
      'Ex. logo, texte exact, photos, tailles, dimensions, quantité définitive…', 3)),
  );
  attente.append(el('h3', null, 'Informations encore attendues'), grilleAttente);

  const resume = el('div', 'vd-notice');
  resume.id = 'dv-control-box';

  section.append(carte(
    titreEtape('4. Contrôle du dossier', 'dv-ref-controle'),
    etat, grilleLogo,
    champ('Reprise de vectorisation', select('dv-vector', VECTORISATIONS)),
    grilleMaquette, attente,
    champ('Éléments reçus du client', textarea('dv-received',
      'Ex. logo PNG reçu par WhatsApp, texte du dos confirmé, photo du modèle…', 4)),
    champ('Points à contrôler ou à compléter', textarea('dv-to-check',
      'Ex. vérifier la qualité du logo, confirmer les tailles, demander le texte exact…', 4)),
    resume,
  ));

  const bas = el('div', 'vd-actions');
  bas.append(
    bouton('dv-goto-client', 'Renseigner le client →', 'vd-btn vd-btn--primary'),
    bouton('dv-back-projet', '← Retour'),
  );
  section.append(carte(bas));
  return section;
}

function sectionClient() {
  const section = el('section', 'vd-hidden');
  section.id = 'dv-section-client';

  CLIENT = creerSelecteurClient({
    prefix: 'dv',
    labelAjouter: 'Rattacher à la demande',
    labelCreer: 'Créer et rattacher à cette demande',
    onChange: surChangementClient,
  });

  const grilleSuite = el('div', 'dv-choice-grid');
  grilleSuite.id = 'dv-next-action-grid';
  for (const s of SUITES) {
    const b = carteChoix('suite', s.id, null, s.titre, s.aide);
    b.addEventListener('click', () => choisirSuite(s.id));
    grilleSuite.append(b);
  }
  const blocSuite = el('div', 'vd-field vd-hidden');
  blocSuite.id = 'dv-next-action-block';
  blocSuite.style.marginTop = '16px';
  blocSuite.append(el('label', null, 'Suite souhaitée pour cette demande *'), grilleSuite);

  const bas = el('div', 'vd-actions');
  bas.style.marginTop = '18px';
  const versRecap = bouton('dv-to-recap', 'Enregistrer et voir le récapitulatif →', 'vd-btn vd-btn--primary');
  versRecap.classList.add('vd-hidden');
  bas.append(versRecap, bouton('dv-back-controle', '← Retour'));

  section.append(carte(titreEtape('5. Client', 'dv-ref-client'), CLIENT.element, blocSuite, bas));
  return section;
}

function sectionRecap() {
  const section = el('section', 'vd-hidden');
  section.id = 'dv-section-recap';

  const placee = el('p');
  placee.id = 'dv-placed';
  const actions = el('div', 'vd-footer-actions');
  actions.append(
    bouton('dv-print', '🖨️ Imprimer'),
    bouton('dv-download', '⬇️ Télécharger'),
    bouton('dv-whatsapp', '💬 Envoyer sur WhatsApp'),
    bouton('dv-new-request', '➕ Nouvelle demande', 'vd-btn vd-btn--primary'),
  );
  const entete = carte(el('h2', null, '✔ Demande enregistrée'), placee, actions);
  entete.classList.add('vd-success', 'vd-no-print');
  section.append(entete);

  // La fiche : c'est elle, et elle seule, qui part à l'imprimante. Elle reste
  // visible à l'écran — contrairement au ticket de caisse, elle se relit (c'est
  // le brief que l'équipe reprendra pour chiffrer).
  const fiche = el('div', 'dv-sheet');
  fiche.id = 'dv-sheet';

  const teteFiche = el('div', 'dv-sheet__head');
  const marque = el('div');
  marque.append(el('h2', null, 'ATELIER OLDA'), el('p', null, 'Fiche récapitulative de demande client'));
  const ref = el('div', 'dv-sheet__ref');
  const refValeur = el('strong', null, '—');
  refValeur.id = 'dv-final-ref';
  const refDate = el('span', null, '—');
  refDate.id = 'dv-final-date';
  ref.append(refValeur, refDate);
  teteFiche.append(marque, ref);

  const infos = el('div', 'dv-info-grid');
  infos.id = 'dv-final-infos';
  const besoins = el('div');
  besoins.id = 'dv-final-needs';
  const controle = el('div');
  controle.id = 'dv-final-control';

  const bloc = (titre, contenu) => {
    const s = el('div', 'dv-sheet__section');
    s.append(el('h3', null, titre), contenu);
    return s;
  };
  fiche.append(
    teteFiche,
    bloc('Informations générales', infos),
    bloc('Besoins exprimés', besoins),
    bloc('Contrôle du dossier', controle),
    el('div', 'dv-sheet__foot', 'Document interne Atelier OLDA — suivi de la demande et préparation du devis'),
  );

  const carteFiche = carte(fiche);
  carteFiche.classList.add('dv-sheet-card');
  section.append(carteFiche);
  return section;
}

function construire() {
  const page = el('div', 'vd-page');
  const container = el('div', 'vd-container');
  container.id = 'dv-container';

  const stepper = el('div', 'vd-stepper dv-stepper');
  TITRES_ETAPES.forEach((label, i) => {
    const pas = el('div', `vd-step${i === 0 ? ' is-active' : ''}`, label);
    pas.id = `dv-step-${ETAPES[i]}`;
    stepper.append(pas);
  });
  stepper.classList.add('vd-no-print');

  container.append(
    stepper,
    sectionDemande(), sectionBesoins(), sectionProjet(),
    sectionControle(), sectionClient(), sectionRecap(),
  );
  page.append(container);
  ROOT.replaceChildren(page);
}

function brancher() {
  for (const [selectId, inputId] of [['dv-source', 'dv-source-autre'], ['dv-need-cat', 'dv-need-cat-autre'],
    ['dv-goal', 'dv-goal-autre'], ['dv-received-via', 'dv-received-via-autre'],
    ['dv-expected-via', 'dv-expected-via-autre']]) {
    brancherAutre(selectId, inputId);
  }

  // Étape 1
  $('#dv-goto-besoins').addEventListener('click', () => {
    if (!validerDemande()) return;
    afficherEtape('besoins');
    $('#dv-need-label').focus();
  });

  // Étape 2
  $('#dv-save-need').addEventListener('click', enregistrerBesoin);
  $('#dv-cancel-need').addEventListener('click', () => { sortirDeLEdition(); peindreBesoins(); });
  $('#dv-back-demande').addEventListener('click', () => afficherEtape('demande'));
  $('#dv-goto-projet').addEventListener('click', () => {
    if (!validerBesoins()) return;
    preparerProjet();
    afficherEtape('projet');
  });

  // Étape 3
  $('#dv-delay').addEventListener('change', majDateSouhaitee);
  $('#dv-back-besoins').addEventListener('click', () => afficherEtape('besoins'));
  $('#dv-goto-controle').addEventListener('click', () => {
    if (!validerProjet()) return;
    afficherEtape('controle');
  });

  // Étape 4
  for (const id of ['dv-control-status', 'dv-logo-type', 'dv-logo-status', 'dv-vector', 'dv-mockup',
    'dv-received-via', 'dv-expected-via']) {
    $(`#${id}`).addEventListener('change', majControle);
  }
  for (const id of ['dv-received-via-autre', 'dv-expected-via-autre', 'dv-expected']) {
    $(`#${id}`).addEventListener('input', majControle);
  }
  $('#dv-back-projet').addEventListener('click', () => afficherEtape('projet'));
  $('#dv-goto-client').addEventListener('click', () => {
    if (!validerControle()) return;
    afficherEtape('client');
    CLIENT.focus();
  });

  // Étape 5
  $('#dv-back-controle').addEventListener('click', () => afficherEtape('controle'));
  $('#dv-to-recap').addEventListener('click', ouvrirRecapitulatif);

  // Étape 6
  $('#dv-print').addEventListener('click', imprimerRecapitulatif);
  $('#dv-download').addEventListener('click', telechargerRecapitulatif);
  $('#dv-whatsapp').addEventListener('click', envoyerWhatsApp);
  $('#dv-new-request').addEventListener('click', nouvelleDemande);

  effacerErreurALaFrappe(ROOT);
}

function peindreEmployes() {
  const liste = $('#dv-salesperson');
  const garde = liste.value;
  liste.replaceChildren(new Option('Choisir', ''));
  for (const e of EMPLOYES) liste.append(new Option(e, e, false, e === garde));
}

let monte = false;
export async function initDevis(root) {
  if (monte) return;
  ROOT = root;
  monte = true;
  construire();
  brancher();
  $('#dv-request-date').value = todayISO();
  $('#dv-desired-time').value = '14:00';
  peindreEmployes();
  peindreBesoins();
  majControle();
  try {
    const [catalogue] = await Promise.all([
      api('GET', '/api/commande/catalog'),
      CLIENT.charger(),
    ]);
    // « À attribuer » n'a pas de sens ici : quelqu'un a forcément pris la demande.
    const employes = ((catalogue && catalogue.employes) || []).filter((e) => e && e !== 'À attribuer');
    if (employes.length) {
      EMPLOYES = employes;
      peindreEmployes();
    }
  } catch (_) { /* silencieux : la saisie reste possible, la recherche part d'une liste vide */ }
}

// Un tap sur « Nouveau Projet » repart TOUJOURS d'une demande vierge (même règle
// que la vente directe). La base clients est relue au passage : un autre poste a
// pu créer une fiche entre-temps.
export async function resetDevis() {
  if (!monte) return;
  nouvelleDemande();
  try {
    await CLIENT.charger();
  } catch (_) { /* la liste précédente reste utilisable */ }
}
