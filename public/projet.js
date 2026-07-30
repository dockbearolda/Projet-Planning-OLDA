// Nouveau Projet — Atelier OLDA : VENTE DIRECTE
// ===========================================================================
// Transcription de la maquette du patron (« Atelier OLDA — Vente directe »,
// flux complet), à l'identique : quatre étapes, Articles → Client → Paiement →
// Ticket, et un ticket de caisse à imprimer / télécharger / envoyer.
//
// Ce qui change par rapport au fichier de la maquette, et pourquoi :
//   - CLIENTS : la maquette gardait ses fiches dans le localStorage du poste.
//     Ici la recherche interroge la VRAIE base clients (/api/clients) et la
//     création écrit dedans (POST /api/clients) : le comptoir et la Base clients
//     ne peuvent pas se contredire.
//   - PLANNING : « Valider le paiement » enregistre la commande dans le planning
//     (POST /api/projets) — sans quoi l'atelier ne verrait jamais la vente.
//     L'écran ne montre le ticket qu'une fois l'enregistrement confirmé.
//   - NUMÉRO : le compteur du jour vit côté serveur (POST /api/vente/numero),
//     pas dans le navigateur : deux comptoirs ne peuvent pas remettre le même
//     numéro à deux clients différents.
//   - TÉLÉPHONE : tout numéro contenant un chiffre est accepté (règle maison, un
//     format plus fin a déjà bloqué le comptoir devant un client bien réel).
//   - COULEUR : l'accent est l'encre noire de la charte, pas le vert.
//
// Rendu entièrement par JS dans une section vide (même principe que clients.js /
// reglages.js), chargé à la demande par nouveau-projet.js. Le DOM des quatre
// étapes est construit UNE fois puis montré / caché comme dans la maquette : ce
// qui est tapé dans un champ y reste quand on va et vient entre les étapes.
//
// L'en-tête noir n'est PAS construit ici : il appartient à nouveau-projet.js,
// qui coiffe les deux flux du comptoir (vente directe / demande de devis) et
// porte le sélecteur qui passe de l'un à l'autre.

import {
  el, champ, input, select, carte, bouton, titreEtape,
  effacerErreurs as effacerErreursDe, erreurChamp as erreurChampDe, effacerErreurALaFrappe,
  cents, money, todayISO, formatDate, heureTexte, api,
  metaClient, payloadClient, creerSelecteurClient,
} from './comptoir.js';
import { whatsappNumber } from './whatsapp.js';

let ROOT = null;
let CLIENT = null;    // sélecteur de client partagé (comptoir.js)
const $ = (sel) => ROOT.querySelector(sel);

// --- Catalogue et paramètres ------------------------------------------------
// Le taux de TGCA vient des réglages du patron (le serveur recalcule TOUT avec
// le taux du moment) ; 4 % n'est qu'un repli si l'appel échoue.
let TGCA = 0.04;
// « Appliquer la TGCA de 4 % » — le taux affiché est celui des réglages, pas une
// constante recopiée dans le texte du bouton.
const texteTgca = () => `Appliquer la TGCA de ${String(Math.round(TGCA * 1000) / 10).replace('.', ',')} %`;
// Familles + sous-étapes du planning, chargées à la demande pour la question
// « où l'enregistrer ? ». C'est le serveur qui les sert (/api/pipeline) : une
// étape ajoutée en base apparaît sans retoucher le front.
let PIPELINE = null;
// Suggestions de la maquette, complétées par le catalogue partagé (vêtements) :
// une liste déroulante ne contraint rien, elle fait gagner des frappes.
const ARTICLES_SUGGERES = [
  'Tee-shirt personnalisé', 'Sweat personnalisé', 'Casquette personnalisée',
  'Tasse personnalisée', 'Gourde personnalisée', 'Porte-clés personnalisé', 'Plaque gravée',
];
let SUGGESTIONS = [...ARTICLES_SUGGERES];

const HEURES = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'];

// Les cinq modes de la maquette, et ce qu'ils veulent dire pour le planning.
// `statut` alimente le suivi de l'argent (colonnes Acompte / Payé de la grille) ;
// `mode` est l'id du catalogue (catalog.json → commande.paiementModes).
const MODES_PAIEMENT = [
  { label: 'Carte bancaire', statut: 'paye', mode: 'cb' },
  { label: 'Espèces', statut: 'paye', mode: 'especes' },
  { label: 'Virement', statut: 'paye', mode: 'virement' },
  { label: 'Mixte', statut: 'paye', mode: 'mixte' },
  { label: 'Paiement au retrait', statut: 'a_encaisser', mode: null },
];
const modeParLabel = (label) => MODES_PAIEMENT.find((m) => m.label === label) || MODES_PAIEMENT[0];

// Où la vente atterrit dans le planning. Le comptoir a déjà chiffré et encaissé :
// il n'y a rien à chiffrer, la commande part directement en préparation. Si le
// client repart avec sa marchandise, il n'y a plus rien à produire non plus —
// reste la facture à établir.
const DEST_A_PRODUIRE = { stage: 'preparation', subStage: 'pret_a_produire', label: 'Préparation — Prêt à produire' };
const DEST_EMPORTEE = { stage: 'facturation', subStage: 'facturation_a_faire', label: 'Facturation — Facturation à faire' };

// --- État -------------------------------------------------------------------
const ETAPES = ['articles', 'client', 'paiement', 'ticket'];
const state = {
  etape: 'articles',
  articles: [],          // { nom, quantite, prixSaisi, typePrix, taxe, unitTtc, totalTtc, description }
  enEdition: -1,         // index de l'article en cours de modification, -1 = aucun
  client: null,          // fiche retenue, telle que la rend le sélecteur partagé
  paiementTexte: '',     // « Espèces — donné 30,00 €, monnaie 4,70 € »
  numero: '',            // numéro du ticket, réservé au premier article
  ligneId: null,         // id de la ligne créée au planning (pour la déplacer)
  destination: null,     // où elle est posée : { stage, subStage, label }
  destinationPosee: false, // la vendeuse a-t-elle tranché l'étape ?
  emportee: false,       // le client est-il reparti avec sa commande ?
};

// ===========================================================================
// Étapes
// ===========================================================================
function afficherEtape(nom) {
  state.etape = nom;
  const courant = ETAPES.indexOf(nom);
  ETAPES.forEach((id, i) => {
    $(`#vd-section-${id}`).classList.toggle('vd-hidden', id !== nom);
    const pas = $(`#vd-step-${id}`);
    pas.classList.toggle('is-active', i === courant);
    pas.classList.toggle('is-done', i < courant);
  });
  $('#vd-container').scrollTo({ top: 0, behavior: 'smooth' });
}

// Messages d'erreur : le champ passe en rouge, le message se pose dessous
// (implémentation partagée, cf. comptoir.js).
const effacerErreurs = () => effacerErreursDe(ROOT);
const erreurChamp = (id, message) => erreurChampDe(ROOT, id, message);

// ===========================================================================
// Étape 1 — Articles
// ===========================================================================
// Majoration du délai, exactement la règle de la maquette : le jour même (ou une
// date déjà passée) +20 %, moins de trois jours +10 %, au-delà rien. Ce sont les
// deux raccourcis du catalogue (`jour_j`, `express`) : c'est le SERVEUR qui
// applique la majoration au moment d'enregistrer, l'écran ne fait que l'annoncer.
function tauxMajoration() {
  const commande = $('#vd-order-date').value;
  const souhaitee = $('#vd-delivery-date').value;
  if (!commande || !souhaitee) return 0;
  const jours = Math.ceil((new Date(`${souhaitee}T12:00`) - new Date(`${commande}T12:00`)) / 86400000);
  if (jours <= 0) return 0.20;
  if (jours < 3) return 0.10;
  return 0;
}
const delaiId = (taux) => (taux === 0.20 ? 'jour_j' : taux === 0.10 ? 'express' : null);
const majorationLabel = (taux) => (taux === 0.20 ? 'Supplément urgence (+20 %)' : 'Supplément express (+10 %)');

function totaux() {
  const articlesTtc = cents(state.articles.reduce((s, a) => s + a.totalTtc, 0));
  const taux = tauxMajoration();
  // Même calcul que le serveur (buildProjet) : on majore le total, on arrondit
  // une seule fois. Le supplément est la différence — jamais un second arrondi.
  const total = cents(articlesTtc * (1 + taux));
  return { articlesTtc, taux, supplement: cents(total - articlesTtc), total };
}

function majAideDelai() {
  const taux = tauxMajoration();
  $('#vd-deadline-info').textContent = taux === 0.20
    ? 'Urgence jour même : supplément de 20 %.'
    : taux === 0.10
      ? 'Délai inférieur à 3 jours : supplément express de 10 %.'
      : 'Délai standard : aucun supplément.';
  peindreResume();
}

function validerFormulaireArticle() {
  effacerErreurs();
  if (!$('#vd-name').value.trim()) return erreurChamp('vd-name', 'Renseigne l’article.');
  if (Number($('#vd-qty').value) <= 0) return erreurChamp('vd-qty', 'La quantité doit être supérieure à 0.');
  if ($('#vd-price').value === '' || Number($('#vd-price').value) < 0) {
    return erreurChamp('vd-price', 'Renseigne le prix unitaire.');
  }
  if (!$('#vd-desc').value.trim()) return erreurChamp('vd-desc', 'Renseigne la description de production.');
  if (!$('#vd-delivery-date').value) return erreurChamp('vd-delivery-date', 'Choisis la date souhaitée.');
  if (!$('#vd-delivery-time').value) return erreurChamp('vd-delivery-time', 'Choisis l’heure souhaitée.');
  return true;
}

function enregistrerArticle() {
  if (!validerFormulaireArticle()) return;
  // Il y a une vente : on lui donne son numéro de ticket (sans attendre la
  // réponse, la saisie continue — le numéro se pose dès qu'il arrive).
  reserverNumero();
  const quantite = Number($('#vd-qty').value);
  const prixSaisi = Number($('#vd-price').value);
  const taxe = $('#vd-tax').checked;
  const typePrix = $('#vd-price-type').value;
  // Prix saisi HT et TGCA appliquée : le prix client est le HT majoré du taux.
  // Sans TGCA cochée, le prix saisi EST le prix client, quel que soit l'intitulé
  // — c'est la règle de la maquette, on ne la corrige pas.
  const unitTtc = cents(typePrix === 'HT' && taxe ? prixSaisi * (1 + TGCA) : prixSaisi);
  const article = {
    nom: $('#vd-name').value.trim(),
    quantite,
    prixSaisi,
    typePrix,
    taxe,
    unitTtc,
    totalTtc: cents(unitTtc * quantite),
    description: $('#vd-desc').value.trim(),
  };
  if (state.enEdition >= 0) state.articles[state.enEdition] = article;
  else state.articles.push(article);
  sortirDeLEdition();
  $('#vd-name').value = '';
  $('#vd-price').value = '';
  $('#vd-desc').value = '';
  $('#vd-qty').value = '1';
  peindreArticles();
  peindreResume();
  $('#vd-name').focus();
}

function sortirDeLEdition() {
  state.enEdition = -1;
  $('#vd-add').textContent = 'Ajouter l’article';
  $('#vd-cancel-edit').classList.add('vd-hidden');
}

function modifierArticle(index) {
  const a = state.articles[index];
  state.enEdition = index;
  $('#vd-name').value = a.nom;
  $('#vd-qty').value = a.quantite;
  $('#vd-price').value = a.prixSaisi;
  $('#vd-price-type').value = a.typePrix;
  $('#vd-tax').checked = a.taxe;
  $('#vd-desc').value = a.description;
  $('#vd-add').textContent = 'Enregistrer la modification';
  $('#vd-cancel-edit').classList.remove('vd-hidden');
  $('#vd-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function supprimerArticle(index) {
  state.articles.splice(index, 1);
  if (state.enEdition === index) sortirDeLEdition();
  peindreArticles();
  peindreResume();
}

function peindreArticles() {
  const box = $('#vd-item-list');
  box.replaceChildren();
  if (!state.articles.length) {
    box.append(el('p', 'vd-help', 'Aucun article ajouté.'));
    return;
  }
  state.articles.forEach((a, i) => {
    const carte = el('div', 'vd-item');
    const tete = el('div', 'vd-item-head');
    const gauche = el('div');
    gauche.append(
      el('b', null, a.nom),
      el('div', 'vd-help', a.description),
      el('div', 'vd-help', `${a.quantite} × ${money(a.unitTtc)} TTC`),
    );
    tete.append(gauche, el('b', null, money(a.totalTtc)));
    const actions = el('div', 'vd-actions');
    actions.style.marginTop = '10px';
    const modifier = el('button', 'vd-btn', 'Modifier');
    modifier.type = 'button';
    modifier.addEventListener('click', () => modifierArticle(i));
    const supprimer = el('button', 'vd-btn', 'Supprimer');
    supprimer.type = 'button';
    supprimer.addEventListener('click', () => supprimerArticle(i));
    actions.append(modifier, supprimer);
    carte.append(tete, actions);
    box.append(carte);
  });
}

function peindreResume() {
  const t = totaux();
  const lignes = $('#vd-summary-lines');
  lignes.replaceChildren();
  if (!state.articles.length) {
    lignes.append(el('p', 'vd-help', 'Les articles ajoutés apparaîtront ici.'));
  } else {
    for (const a of state.articles) {
      const row = el('div', 'vd-summary-row');
      row.append(el('span', null, `${a.nom} × ${a.quantite}`), el('span', null, money(a.totalTtc)));
      lignes.append(row);
    }
  }
  $('#vd-surcharge-row').classList.toggle('vd-hidden', t.taux === 0);
  $('#vd-surcharge-label').textContent = majorationLabel(t.taux);
  $('#vd-surcharge').textContent = money(t.supplement);
  $('#vd-total').textContent = money(t.total);
}

function validerAvantClient() {
  effacerErreurs();
  if (!state.articles.length) return erreurChamp('vd-name', 'Ajoute au moins un article avant de continuer.');
  if (!$('#vd-delivery-date').value) return erreurChamp('vd-delivery-date', 'Choisis la date souhaitée.');
  if (!$('#vd-delivery-time').value) return erreurChamp('vd-delivery-time', 'Choisis l’heure souhaitée.');
  return true;
}

// ===========================================================================
// Étape 2 — Client (vraie base clients)
// ===========================================================================
// Toute la recherche / création vit dans comptoir.js : c'est le MÊME sélecteur
// que la demande de devis, donc la même façon de chercher, le même
// avertissement de doublon et le même format de numéro d'un flux à l'autre.
function surChangementClient(client) {
  state.client = client;
  $('#vd-to-payment').classList.toggle('vd-hidden', !client);
}

// ===========================================================================
// Étape 3 — Paiement
// ===========================================================================
function ouvrirPaiement() {
  effacerErreurs();
  if (!state.client) return erreurChamp('vd-client-search', 'Sélectionne ou crée le client de cette commande.');
  const t = totaux();
  $('#vd-amount-due').textContent = money(t.total);
  const box = $('#vd-pay-client');
  box.replaceChildren(
    el('b', null, 'Client de la commande : '),
    el('span', null, state.client.nom),
    el('div', 'vd-help', metaClient(state.client)),
  );
  afficherEtape('paiement');
  return true;
}

const modeChoisi = () => (ROOT.querySelector('input[name="vd-pay"]:checked') || {}).value || 'Carte bancaire';

function majZonesPaiement() {
  const mode = modeChoisi();
  $('#vd-cash-zone').classList.toggle('vd-hidden', mode !== 'Espèces');
  $('#vd-mix-zone').classList.toggle('vd-hidden', mode !== 'Mixte');
}

function majMonnaie() {
  const du = totaux().total;
  const donne = Number($('#vd-cash-given').value) || 0;
  $('#vd-cash-change').textContent = money(Math.max(0, donne - du));
}

// Saisir un montant calcule l'autre : au comptoir on tape ce que le client donne
// en carte, le reste est en espèces (ou l'inverse).
let mixEnCours = false;
function majMixte(source) {
  if (mixEnCours) return;
  mixEnCours = true;
  const du = totaux().total;
  if (source === 'cb') {
    const cb = Math.max(0, Number($('#vd-mix-card').value) || 0);
    $('#vd-mix-cash').value = Math.max(0, cents(du - cb)).toFixed(2);
  } else {
    const especes = Math.max(0, Number($('#vd-mix-cash').value) || 0);
    $('#vd-mix-card').value = Math.max(0, cents(du - especes)).toFixed(2);
  }
  const somme = (Number($('#vd-mix-card').value) || 0) + (Number($('#vd-mix-cash').value) || 0);
  $('#vd-mix-total').textContent = money(somme);
  mixEnCours = false;
}

// ===========================================================================
// Enregistrement au planning, puis ticket
// ===========================================================================
// Une ligne de la maquette (nom + quantité + prix + description de production)
// est une ligne « autres » côté serveur : désignation = l'article, explication =
// la description que l'atelier doit lire pour produire.
function articleVersLigne(a) {
  return {
    type: 'autres',
    quantite: a.quantite,
    designation: a.nom,
    explication: a.description,
    prixUnitaireTtc: a.unitTtc,
  };
}

function payloadCommande(dest) {
  const t = totaux();
  const mode = modeParLabel(modeChoisi());
  const emportee = $('#vd-instant').checked;
  return {
    kind: 'commande',
    numero: state.numero,
    client: payloadClient(state.client),
    lignes: state.articles.map(articleVersLigne),
    // La date précise l'emporte pour l'échéance ; le raccourci ne sert qu'à
    // porter la majoration, que le serveur applique lui-même.
    deadline: $('#vd-delivery-date').value,
    delai: delaiId(t.taux) || undefined,
    heureSouhaitee: $('#vd-delivery-time').value,
    noteInterne: $('#vd-note').value.trim() || undefined,
    retraitImmediat: emportee,
    // Une vente du jour passe devant : c'est la majoration qui dit l'urgence.
    priority: t.taux === 0.20 ? 3 : t.taux === 0.10 ? 2 : 1,
    paiement: {
      statut: mode.statut,
      modeFinal: mode.mode || undefined,
    },
    stage: dest.stage,
    subStage: dest.subStage,
  };
}

async function validerPaiement() {
  effacerErreurs();
  const label = modeChoisi();
  const du = totaux().total;

  if (label === 'Espèces') {
    const donne = Number($('#vd-cash-given').value);
    if (!Number.isFinite(donne) || donne < du) {
      return erreurChamp('vd-cash-given', 'Le montant donné doit couvrir le total à encaisser.');
    }
    state.paiementTexte = `Espèces — donné ${money(donne)}, monnaie ${money(donne - du)}`;
  } else if (label === 'Mixte') {
    const cb = Number($('#vd-mix-card').value) || 0;
    const especes = Number($('#vd-mix-cash').value) || 0;
    if (Math.abs(cb + especes - du) > 0.01) {
      return erreurChamp('vd-mix-card', 'La répartition CB + espèces doit correspondre exactement au total.');
    }
    state.paiementTexte = `Mixte : CB ${money(cb)} + Espèces ${money(especes)}`;
  } else {
    state.paiementTexte = label;
  }
  return enregistrerCommande();
}

// La commande entre au planning AVANT que le ticket s'affiche : sans ça on
// remettrait au client un ticket dont l'atelier n'a jamais entendu parler. Elle
// se pose d'abord à la place la plus probable ; la vendeuse dit ensuite, sur
// l'écran du ticket, où elle doit vraiment aller.
// Le client repart avec sa commande → rien à produire ni à faire retirer, la
// place est connue (Facturation à faire) et la question ne se pose pas.
async function enregistrerCommande() {
  const emportee = $('#vd-instant').checked;
  const dest = emportee ? DEST_EMPORTEE : DEST_A_PRODUIRE;
  const bouton = $('#vd-validate-pay');
  bouton.disabled = true;
  let cree;
  try {
    cree = await api('POST', '/api/projets', payloadCommande(dest));
  } catch (err) {
    window.alert(err.message || 'Enregistrement impossible');
    return false;
  } finally {
    bouton.disabled = false;
  }
  state.ligneId = cree.id;
  state.destination = dest;
  state.emportee = emportee;
  state.destinationPosee = emportee;   // emportée : la place est déjà la bonne

  // Le ticket n'étant plus affiché, le montant encaissé se lit ICI : c'est le
  // dernier endroit où l'écran le rappelle, monnaie à rendre comprise.
  const total = el('p', 'vd-pay-total');
  total.append(document.createTextNode('Total encaissé : '), el('b', null, money(totaux().total)));
  $('#vd-pay-status').replaceChildren(
    document.createTextNode('Paiement enregistré pour la commande '),
    el('b', null, state.numero),
    document.createTextNode(` — ${state.paiementTexte}.`),
    total,
  );
  peindreDestination();
  remplirTicket();
  afficherEtape('ticket');
  return true;
}

// L'annonce sur l'écran Paiement : la vendeuse sait qu'après le ticket il lui
// restera à poser la ligne. Le client repart avec sa commande → la place est
// connue, la question ne se pose pas, l'annonce disparaît.
function majAnnonceDestination() {
  const champ = $('#vd-instant');
  const annonce = $('#vd-dest-hint');
  if (!champ || !annonce) return;
  annonce.classList.toggle('vd-hidden', champ.checked);
}

// --- « Où poser la ligne dans le planning ? » ---------------------------------
// LE geste par lequel la vendeuse fait entrer la vente dans l'atelier. Il vient
// APRÈS le ticket : le client a son ticket en main, la ligne existe déjà, il
// reste à dire à quelle étape elle attend. Tout le pipeline (familles +
// sous-étapes) vient du serveur (/api/pipeline) : une étape ajoutée en base
// apparaît ici sans retoucher le front.
async function chargerPipeline() {
  if (PIPELINE) return PIPELINE;
  PIPELINE = await api('GET', '/api/pipeline');
  return PIPELINE;
}

function peindreDestination() {
  const carteDest = $('#vd-dest-card');
  // Commande emportée : aucune question, on annonce juste où elle est partie.
  if (state.destinationPosee) {
    carteDest.classList.add('vd-dest-card--done');
    carteDest.replaceChildren(
      el('p', 'vd-dest__eyebrow', 'Ligne posée au planning'),
      el('p', 'vd-dest__title', state.destination.label),
      el('p', 'vd-dest__hint', state.emportee
        ? 'Le client est reparti avec sa commande : il n’y a plus rien à produire, il reste la facture.'
        : 'La commande attend à cette étape. Elle se déplace ensuite depuis le planning, comme n’importe quelle ligne.'),
    );
    return;
  }

  carteDest.classList.remove('vd-dest-card--done');
  carteDest.replaceChildren(
    el('p', 'vd-dest__eyebrow', 'Dernière étape — obligatoire'),
    el('p', 'vd-dest__title', 'Où poser cette ligne dans le planning ?'),
    el('p', 'vd-dest__hint', `La commande est enregistrée en « ${DEST_A_PRODUIRE.label} ». Choisis l’étape où elle doit attendre.`),
  );
  const liste = el('div', 'vd-dest__list');
  carteDest.append(liste);
  liste.append(el('p', 'vd-dest__loading', 'Chargement des étapes…'));

  chargerPipeline().then((pipeline) => {
    liste.replaceChildren();
    const item = (label, dest, defaut) => {
      const b = el('button', `vd-dest__item${defaut ? ' is-default' : ''}`);
      b.type = 'button';
      b.append(el('span', null, label));
      if (defaut) b.append(el('span', 'vd-dest__badge', 'Le plus courant'));
      b.addEventListener('click', () => poserLigne(dest));
      return b;
    };
    liste.append(item(DEST_A_PRODUIRE.label, DEST_A_PRODUIRE, true));
    for (const fam of pipeline) {
      if (fam.subs && fam.subs.length) {
        liste.append(el('p', 'vd-dest__family', fam.label));
        for (const sub of fam.subs) {
          liste.append(item(sub.label, { stage: fam.slug, subStage: sub.slug, label: `${fam.label} — ${sub.label}` }));
        }
      } else {
        liste.append(el('p', 'vd-dest__family', fam.label));
        liste.append(item(fam.label, { stage: fam.slug, subStage: null, label: fam.label }));
      }
    }
  }).catch(() => {
    liste.replaceChildren(el('p', 'vd-dest__loading',
      `Liste des étapes injoignable. La commande reste en « ${DEST_A_PRODUIRE.label} » — déplace-la depuis le planning.`));
  });
}

// La ligne existe déjà : on la DÉPLACE à l'étape choisie (stage + sous-étape).
async function poserLigne(dest) {
  if (dest.stage === state.destination.stage && dest.subStage === state.destination.subStage) {
    state.destinationPosee = true;
    peindreDestination();
    return;
  }
  const boutons = [...ROOT.querySelectorAll('#vd-dest-card .vd-dest__item')];
  for (const b of boutons) b.disabled = true;
  try {
    await api('PATCH', `/api/requests/${state.ligneId}`, { stage: dest.stage, sub_stage: dest.subStage });
  } catch (err) {
    window.alert(err.message || 'Déplacement impossible');
    for (const b of boutons) b.disabled = false;
    return;
  }
  state.destination = dest;
  state.destinationPosee = true;
  peindreDestination();
}

// ===========================================================================
// Étape 4 — Ticket
// ===========================================================================
function remplirTicket() {
  const t = totaux();
  const c = state.client;
  $('#vd-ticket-order').textContent = state.numero;
  $('#vd-ticket-date').textContent = formatDate($('#vd-order-date').value);
  $('#vd-ticket-client').textContent = c ? c.nom : '—';
  $('#vd-ticket-phone').textContent = (c && c.telephone) || '—';
  $('#vd-ticket-delivery').textContent = `${formatDate($('#vd-delivery-date').value)} à ${heureTexte($('#vd-delivery-time').value)}`;

  const box = $('#vd-ticket-products');
  box.replaceChildren();
  for (const a of state.articles) {
    const bloc = el('div', 'vd-ticket-product');
    const ligne = el('div', 'vd-ticket-product-line');
    ligne.append(el('b', null, a.nom), el('b', null, money(a.totalTtc)));
    bloc.append(ligne, el('div', null, `${a.quantite} × ${money(a.unitTtc)}`), el('div', null, a.description));
    box.append(bloc);
  }
  $('#vd-ticket-surcharge-row').classList.toggle('vd-hidden', t.taux === 0);
  $('#vd-ticket-surcharge-label').textContent = majorationLabel(t.taux);
  $('#vd-ticket-surcharge').textContent = money(t.supplement);
  $('#vd-ticket-total').textContent = money(t.total);
  $('#vd-ticket-payment').textContent = state.paiementTexte;
}

function imprimerTicket() {
  remplirTicket();
  // La classe dit à la feuille d'impression de ne garder QUE le ticket ; elle
  // repart dès la boîte de dialogue fermée, même si l'impression est annulée.
  document.body.classList.add('vd-print');
  const nettoyer = () => document.body.classList.remove('vd-print');
  window.addEventListener('afterprint', nettoyer, { once: true });
  window.print();
  setTimeout(nettoyer, 1000);
}

function texteTicket() {
  const t = totaux();
  const c = state.client;
  return [
    'ATELIER OLDA',
    'Saint-Martin',
    'TICKET DE COMMANDE',
    '',
    `Commande : ${state.numero}`,
    `Date : ${formatDate($('#vd-order-date').value)}`,
    `Client : ${c ? c.nom : ''}`,
    `WhatsApp : ${(c && c.telephone) || ''}`,
    `Livraison souhaitée : ${formatDate($('#vd-delivery-date').value)} à ${heureTexte($('#vd-delivery-time').value)}`,
    '',
    ...state.articles.flatMap((a) => [
      `${a.nom} — ${a.quantite} × ${money(a.unitTtc)} = ${money(a.totalTtc)}`,
      a.description,
    ]),
    '',
    ...(t.taux ? [`${majorationLabel(t.taux)} : ${money(t.supplement)}`] : []),
    `TOTAL TTC : ${money(t.total)}`,
    `Paiement : ${state.paiementTexte}`,
    '',
    'Merci pour votre confiance',
    'L’équipe Atelier OLDA',
  ].join('\n');
}

function telechargerTicket() {
  remplirTicket();
  const blob = new Blob([texteTicket()], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Ticket_${state.numero.replaceAll('.', '-')}.txt`;
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
  const t = totaux();
  const texte = [
    `Bonjour ${c.nom},`,
    '',
    'Voici le récapitulatif de votre commande Atelier OLDA :',
    `Référence : ${state.numero}`,
    `Livraison souhaitée : ${formatDate($('#vd-delivery-date').value)} à ${heureTexte($('#vd-delivery-time').value)}`,
    '',
    ...state.articles.map((a) => `• ${a.nom} — ${a.quantite} × ${money(a.unitTtc)} = ${money(a.totalTtc)}`),
    ...(t.taux ? [`• ${majorationLabel(t.taux)} : ${money(t.supplement)}`] : []),
    '',
    `Total TTC : ${money(t.total)}`,
    `Paiement : ${state.paiementTexte}`,
    '',
    'Merci pour votre confiance.',
    'L’équipe Atelier OLDA',
  ].join('\n');
  window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texte)}`, '_blank', 'noopener');
}

// ===========================================================================
// Numéro du ticket
// ===========================================================================
// Repli si le compteur du serveur est injoignable : le comptoir ne s'arrête pas
// pour ça. Le numéro reste au format du patron, il peut juste retomber sur un
// rang déjà pris par un autre poste — c'est écrit au dos du ticket, pas perdu.
function numeroLocal() {
  const [y, m, d] = todayISO().split('-');
  const cle = `olda-vente-seq-${y}${m}${d}`;
  const rang = (Number(localStorage.getItem(cle)) || 0) + 1;
  try { localStorage.setItem(cle, String(rang)); } catch (_) { /* navigation privée */ }
  return `${y.slice(2)}.${m}.${d}-${String(rang).padStart(3, '0')}`;
}

function peindreNumero() {
  for (const id of ['vd-ref-articles', 'vd-ref-client', 'vd-ref-paiement']) {
    $(`#${id}`).textContent = state.numero || '—';
  }
}

// Le numéro est réservé au PREMIER article, pas à l'ouverture de l'écran : un
// numéro attribué n'est jamais réutilisé, et ouvrir l'onglet pour rien ne doit
// pas faire un trou dans la numérotation des tickets remis aux clients.
async function reserverNumero() {
  if (state.numero) return state.numero;
  try {
    const r = await api('POST', '/api/vente/numero', { jour: todayISO() });
    state.numero = r.numero;
  } catch (_) {
    state.numero = numeroLocal();
  }
  peindreNumero();
  return state.numero;
}

// ===========================================================================
// Remise à zéro (« Nouvelle commande », ou retour sur l'onglet)
// ===========================================================================
function nouvelleVente() {
  state.articles = [];
  state.client = null;
  state.paiementTexte = '';
  state.numero = '';
  state.ligneId = null;
  state.destination = null;
  state.destinationPosee = false;
  state.emportee = false;
  peindreNumero();
  majAnnonceDestination();
  sortirDeLEdition();
  effacerErreurs();
  $('#vd-name').value = '';
  $('#vd-qty').value = '1';
  $('#vd-price').value = '';
  $('#vd-price-type').value = 'TTC';
  $('#vd-tax').checked = true;
  $('#vd-desc').value = '';
  $('#vd-order-date').value = todayISO();
  $('#vd-delivery-date').value = '';
  $('#vd-delivery-time').value = '';
  $('#vd-note').value = '';
  $('#vd-cash-given').value = '';
  $('#vd-mix-card').value = '';
  $('#vd-mix-cash').value = '';
  $('#vd-instant').checked = false;
  ROOT.querySelector('input[name="vd-pay"][value="Carte bancaire"]').checked = true;
  CLIENT.reset();
  majZonesPaiement();
  majMonnaie();
  majAideDelai();
  peindreArticles();
  peindreResume();
  afficherEtape('articles');
}

// ===========================================================================
// Construction du DOM (une fois) — briques communes dans comptoir.js
// ===========================================================================
function sectionArticles() {
  const section = el('section');
  section.id = 'vd-section-articles';

  const dl = el('datalist');
  dl.id = 'vd-articles-list';
  const nom = input('vd-name', 'text', 'Ex. Tee-shirt personnalisé');
  nom.setAttribute('list', 'vd-articles-list');
  nom.autocomplete = 'off';

  const grille1 = el('div', 'vd-grid-3');
  grille1.append(
    champ('Article *', nom),
    champ('Quantité *', input('vd-qty', 'number', null, { min: '1', step: '1', value: '1' })),
    champ('Prix unitaire *', input('vd-price', 'number', '0,00', { min: '0', step: '0.01', inputMode: 'decimal' })),
  );

  const taxeWrap = el('div', 'vd-field');
  taxeWrap.append(el('label', null, 'Taxe'));
  const taxeLabel = el('label', 'vd-inline-check');
  const taxe = input('vd-tax', 'checkbox', null, { checked: true });
  const taxeTexte = el('span', null, texteTgca());
  taxeTexte.id = 'vd-tax-text';
  taxeLabel.append(taxe, taxeTexte);
  taxeWrap.append(taxeLabel);

  const grille2 = el('div', 'vd-grid');
  grille2.append(champ('Prix saisi', select('vd-price-type', ['TTC', 'HT'])), taxeWrap);

  const desc = el('textarea');
  desc.id = 'vd-desc';
  desc.placeholder = 'Ex. Logo cœur, logo dos 30 cm, tailles S x2 / M x5, impression DTF...';

  const grille3 = el('div', 'vd-grid-3');
  grille3.append(
    champ('Date de commande', input('vd-order-date', 'date', null, { readOnly: true })),
    champ('Date souhaitée *', input('vd-delivery-date', 'date'), { aide: 'vd-deadline-info' }),
    champ('Heure souhaitée *', select(
      'vd-delivery-time',
      ['Choisir une heure', ...HEURES.map(heureTexte)],
      ['', ...HEURES],
    )),
  );

  const actions = el('div', 'vd-actions');
  const annuler = bouton('vd-cancel-edit', 'Annuler la modification');
  annuler.classList.add('vd-hidden');
  actions.append(bouton('vd-add', 'Ajouter l’article', 'vd-btn vd-btn--primary'), annuler);

  section.append(carte(
    titreEtape('1. Articles', 'vd-ref-articles'),
    grille1, grille2, champ('Description de production *', desc), grille3, actions, dl,
  ));

  // Articles de la commande | Résumé TTC
  const liste = el('div');
  liste.id = 'vd-item-list';
  const lignesResume = el('div');
  lignesResume.id = 'vd-summary-lines';
  const suppRow = el('div', 'vd-summary-row vd-hidden');
  suppRow.id = 'vd-surcharge-row';
  const suppLabel = el('span', null, 'Supplément');
  suppLabel.id = 'vd-surcharge-label';
  const suppVal = el('span', null, '0,00 €');
  suppVal.id = 'vd-surcharge';
  suppRow.append(suppLabel, suppVal);
  const totalRow = el('div', 'vd-summary-row vd-summary-total');
  const totalVal = el('span', null, '0,00 €');
  totalVal.id = 'vd-total';
  totalRow.append(el('span', null, 'TOTAL À ENCAISSER'), totalVal);

  const duo = el('div', 'vd-grid');
  duo.append(
    carte(el('h2', null, 'Articles de la commande'), liste),
    carte(el('h2', null, 'Résumé TTC'), lignesResume, suppRow, totalRow),
  );
  section.append(duo);

  // Note interne
  const note = el('textarea');
  note.id = 'vd-note';
  note.placeholder = 'Informations internes non visibles par le client.';
  const tete = el('div', 'vd-internal-head');
  tete.append(el('h2', null, 'Note interne OLDA'), el('span', 'vd-lock', '🔒 Interne uniquement'));
  const interne = carte(tete, note);
  interne.classList.add('vd-internal');
  section.append(interne);

  section.append(carte(bouton('vd-goto-client', 'Valider les articles et renseigner le client →', 'vd-btn vd-btn--primary vd-btn--full')));
  return section;
}

function sectionClient() {
  const section = el('section', 'vd-hidden');
  section.id = 'vd-section-client';

  CLIENT = creerSelecteurClient({
    prefix: 'vd',
    labelAjouter: 'Ajouter à la commande',
    labelCreer: 'Créer et ajouter à cette commande',
    onChange: surChangementClient,
  });

  const bas = el('div', 'vd-actions');
  bas.style.marginTop = '18px';
  const versPaiement = bouton('vd-to-payment', 'Client validé — Passer au paiement →', 'vd-btn vd-btn--primary');
  versPaiement.classList.add('vd-hidden');
  bas.append(versPaiement, bouton('vd-back-articles', '← Retour aux articles'));

  section.append(carte(titreEtape('2. Client', 'vd-ref-client'), CLIENT.element, bas));
  return section;
}

function sectionPaiement() {
  const section = el('section', 'vd-hidden');
  section.id = 'vd-section-paiement';

  const client = el('div', 'vd-notice');
  client.id = 'vd-pay-client';
  client.style.marginBottom = '15px';

  const du = el('div', 'vd-summary-row vd-summary-total');
  const montant = el('span', null, '0,00 €');
  montant.id = 'vd-amount-due';
  du.append(el('span', null, 'À encaisser'), montant);

  const options = el('div');
  MODES_PAIEMENT.forEach((m, i) => {
    const lab = el('label', 'vd-pay-option');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'vd-pay';
    radio.value = m.label;
    if (i === 0) radio.checked = true;
    lab.append(radio, el('span', null, m.label));
    options.append(lab);
  });

  const zoneEspeces = carte(
    champ('Montant donné par le client *', input('vd-cash-given', 'number', null, { min: '0', step: '0.01', inputMode: 'decimal' })),
  );
  zoneEspeces.id = 'vd-cash-zone';
  zoneEspeces.classList.add('vd-hidden');
  const rendu = el('div', 'vd-summary-row');
  const monnaie = el('b', null, '0,00 €');
  monnaie.id = 'vd-cash-change';
  rendu.append(el('span', null, 'Monnaie à rendre'), monnaie);
  zoneEspeces.append(rendu);

  const duoMixte = el('div', 'vd-grid');
  duoMixte.append(
    champ('Carte bancaire', input('vd-mix-card', 'number', '0,00', { min: '0', step: '0.01', inputMode: 'decimal' })),
    champ('Espèces', input('vd-mix-cash', 'number', '0,00', { min: '0', step: '0.01', inputMode: 'decimal' })),
  );
  const zoneMixte = carte(duoMixte, el('div', 'vd-help', 'Saisis un montant : l’autre est calculé automatiquement.'));
  zoneMixte.id = 'vd-mix-zone';
  zoneMixte.classList.add('vd-hidden');
  const totalMixte = el('div', 'vd-summary-row');
  const totalMixteVal = el('b', null, '0,00 €');
  totalMixteVal.id = 'vd-mix-total';
  totalMixte.append(el('span', null, 'Total réparti'), totalMixteVal);
  zoneMixte.append(totalMixte);

  const emportee = el('label', 'vd-inline-check');
  emportee.style.margin = '14px 0';
  emportee.append(input('vd-instant', 'checkbox'), el('span', null, 'Le client repart immédiatement avec sa commande'));

  // La vendeuse sait AVANT de valider qu'il lui restera à dire où la ligne se
  // pose dans le planning : c'est ce geste qui la fait entrer dans l'atelier.
  // L'annonce disparaît quand le client repart avec sa commande — la place est
  // alors connue, la question ne se pose pas.
  const annonce = el('p', 'vd-help vd-next-step');
  annonce.id = 'vd-dest-hint';
  annonce.append(document.createTextNode('Après le ticket : '), el('b', null, 'où poser la ligne dans le planning ?'));

  const actions = el('div', 'vd-actions');
  actions.append(
    bouton('vd-validate-pay', 'Valider le paiement', 'vd-btn vd-btn--primary vd-btn--full'),
    bouton('vd-back-client', '← Retour au client'),
  );

  section.append(carte(
    titreEtape('3. Paiement', 'vd-ref-paiement'),
    client, du, options, zoneEspeces, zoneMixte, emportee, annonce, actions,
  ));
  return section;
}

function ligneTicket(label, valeurId, gras) {
  const row = el('div', 'vd-ticket-row');
  const val = el(gras ? 'b' : 'span', null, '');
  val.id = valeurId;
  row.append(el('span', null, label), val);
  return row;
}

function sectionTicket() {
  const section = el('section', 'vd-hidden');
  section.id = 'vd-section-ticket';

  const etat = el('p');
  etat.id = 'vd-pay-status';
  const actions = el('div', 'vd-footer-actions');
  actions.append(
    bouton('vd-print', '🖨️ Imprimer'),
    bouton('vd-download', '⬇️ Télécharger'),
    bouton('vd-whatsapp', '💬 Envoyer sur WhatsApp'),
    bouton('vd-new-sale', '➕ Nouvelle commande', 'vd-btn vd-btn--primary'),
  );
  // « ✔ » et non l'émoji ✅ de la maquette : c'est le seul vert qui restait, et
  // le caractère prend la couleur du texte (encre de la charte).
  const entete = carte(el('h2', null, '✔ Commande terminée'), etat, actions);
  entete.classList.add('vd-success', 'vd-no-print');
  section.append(entete);

  // La question du planning vient APRÈS le ticket : le client a son ticket en
  // main, la vendeuse pose alors la ligne à l'étape où elle doit attendre.
  // Remplie par peindreDestination().
  const dest = carte();
  dest.id = 'vd-dest-card';
  dest.classList.add('vd-dest-card', 'vd-no-print');
  section.append(dest);

  const ticket = el('div', 'vd-ticket');
  ticket.id = 'vd-ticket';
  ticket.append(
    el('h2', null, 'ATELIER OLDA'),
    el('div', 'vd-center', 'Saint-Martin'),
    el('div', 'vd-center', 'Ticket de commande'),
    el('hr'),
    ligneTicket('Commande', 'vd-ticket-order', true),
    ligneTicket('Date', 'vd-ticket-date'),
    ligneTicket('Client', 'vd-ticket-client'),
    ligneTicket('WhatsApp', 'vd-ticket-phone'),
    ligneTicket('Livraison souhaitée', 'vd-ticket-delivery'),
    el('hr'),
  );
  const produits = el('div');
  produits.id = 'vd-ticket-products';
  ticket.append(produits, el('hr'));
  const suppRow = el('div', 'vd-ticket-row vd-hidden');
  suppRow.id = 'vd-ticket-surcharge-row';
  const suppLabel = el('span', null, '');
  suppLabel.id = 'vd-ticket-surcharge-label';
  const suppVal = el('span', null, '');
  suppVal.id = 'vd-ticket-surcharge';
  suppRow.append(suppLabel, suppVal);
  const totalRow = el('div', 'vd-ticket-row vd-summary-total');
  const totalVal = el('span', null, '');
  totalVal.id = 'vd-ticket-total';
  totalRow.append(el('span', null, 'Total TTC'), totalVal);
  ticket.append(suppRow, totalRow, ligneTicket('Paiement', 'vd-ticket-payment'), el('hr'));
  ticket.append(
    el('div', 'vd-center', 'Merci pour votre confiance'),
    el('div', 'vd-center', 'L’équipe Atelier OLDA'),
  );
  // Le ticket n'est PAS affiché à l'écran : il part à l'imprimante, en fichier ou
  // sur WhatsApp, et personne ne le lit sur la tablette. Il reste donc dans le
  // DOM (c'est lui qu'imprime le navigateur, et `remplirTicket` le remplit),
  // mais visible uniquement à l'impression. L'écran garde ce qui sert vraiment à
  // ce moment-là : la commande est passée, et où poser la ligne au planning.
  const carteTicket = carte(ticket);
  carteTicket.classList.add('vd-ticket-card', 'vd-print-only');
  section.append(carteTicket);
  return section;
}

function construire() {
  const page = el('div', 'vd-page');

  const container = el('div', 'vd-container');
  container.id = 'vd-container';

  const stepper = el('div', 'vd-stepper');
  ['1. Articles', '2. Client', '3. Paiement', '4. Ticket'].forEach((label, i) => {
    const pas = el('div', `vd-step${i === 0 ? ' is-active' : ''}`, label);
    pas.id = `vd-step-${ETAPES[i]}`;
    stepper.append(pas);
  });
  stepper.classList.add('vd-no-print');

  container.append(stepper, sectionArticles(), sectionClient(), sectionPaiement(), sectionTicket());
  page.append(container);
  ROOT.replaceChildren(page);
}

function brancher() {
  // Étape 1
  $('#vd-add').addEventListener('click', enregistrerArticle);
  $('#vd-cancel-edit').addEventListener('click', () => {
    sortirDeLEdition();
    $('#vd-name').value = '';
    $('#vd-price').value = '';
    $('#vd-desc').value = '';
    $('#vd-qty').value = '1';
  });
  $('#vd-delivery-date').addEventListener('change', majAideDelai);
  $('#vd-goto-client').addEventListener('click', () => {
    if (!validerAvantClient()) return;
    afficherEtape('client');
    CLIENT.focus();
  });

  // Étape 2 — la recherche / création est câblée par le sélecteur partagé.
  $('#vd-to-payment').addEventListener('click', ouvrirPaiement);
  $('#vd-back-articles').addEventListener('click', () => afficherEtape('articles'));

  // Étape 3
  for (const radio of ROOT.querySelectorAll('input[name="vd-pay"]')) {
    radio.addEventListener('change', majZonesPaiement);
  }
  $('#vd-cash-given').addEventListener('input', majMonnaie);
  $('#vd-mix-card').addEventListener('input', () => majMixte('cb'));
  $('#vd-mix-cash').addEventListener('input', () => majMixte('especes'));
  $('#vd-validate-pay').addEventListener('click', validerPaiement);
  $('#vd-back-client').addEventListener('click', () => afficherEtape('client'));
  $('#vd-instant').addEventListener('change', majAnnonceDestination);

  // Étape 4
  $('#vd-print').addEventListener('click', imprimerTicket);
  $('#vd-download').addEventListener('click', telechargerTicket);
  $('#vd-whatsapp').addEventListener('click', envoyerWhatsApp);
  // Passer à la vente suivante sans avoir posé la ligne la laisserait à la place
  // par défaut : on le dit, plutôt que de le laisser filer en silence.
  $('#vd-new-sale').addEventListener('click', () => {
    if (state.ligneId && !state.destinationPosee) {
      const ok = window.confirm(`Tu n’as pas choisi l’étape du planning : la commande ${state.numero} reste en « ${DEST_A_PRODUIRE.label} ». Continuer quand même ?`);
      if (!ok) return;
    }
    nouvelleVente();
  });

  effacerErreurALaFrappe(ROOT);
}

function peindreSuggestions() {
  $('#vd-articles-list').replaceChildren(...SUGGESTIONS.map((s) => new Option(s)));
}

let monte = false;
export async function initProjet(root) {
  if (monte) return;
  ROOT = root;
  monte = true;
  construire();
  brancher();
  $('#vd-order-date').value = todayISO();
  majAideDelai();
  peindreArticles();
  peindreResume();
  peindreSuggestions();
  try {
    const [parametres, catalogue] = await Promise.all([
      api('GET', '/api/tarifs-tasse/parametres'),
      api('GET', '/api/commande/catalog'),
      CLIENT.charger(),
    ]);
    if (parametres && Number.isFinite(Number(parametres.tgca))) TGCA = Number(parametres.tgca);
    const vetements = (catalogue && catalogue.vetements) || [];
    SUGGESTIONS = [...new Set([...ARTICLES_SUGGERES, ...vetements])];
    peindreSuggestions();
    $('#vd-tax-text').textContent = texteTgca();
  } catch (_) { /* silencieux : la recherche part d'une liste vide, la saisie reste possible */ }
}

// Un tap sur « Nouveau Projet » dans la nav ouvre TOUJOURS une vente vierge,
// même si un poste avait laissé une fiche en cours — comptoir = on repart net,
// on ne cherche jamais un brouillon abandonné entre deux clients. La base
// clients est relue au passage : un autre poste a pu créer une fiche entre-temps.
export async function resetProjet() {
  if (!monte) return;
  nouvelleVente();
  try {
    await CLIENT.charger();
  } catch (_) { /* la liste précédente reste utilisable */ }
}
