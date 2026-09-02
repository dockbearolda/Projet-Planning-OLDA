// Réglages — Atelier OLDA
// Ce que le patron règle UNE fois pour tous les postes. Aujourd'hui : le message
// WhatsApp « votre commande est prête », celui que la pastille verte des lignes
// du planning ouvre dans WhatsApp, déjà écrit.
//
// Rien ne part jamais tout seul : la pastille se contente d'ouvrir la
// conversation avec le texte pré-rempli, c'est l'employé qui appuie sur Envoyer.
//
// Chargé À LA DEMANDE par app.js au premier passage sur la vue ; chaque retour
// relit la valeur enregistrée (un autre poste a pu la changer entre-temps).

// Sans minuteur, un enregistrement de réglage parti sur un réseau qui décroche
// laisse le bouton désactivé et « Enregistrement… » à l'écran, indéfiniment.
import { fetchBorne, api } from './reseau.js';
import { ecranTete } from './ecran-tete.js';
// L'AIDE D'UNE CARTE SE DEMANDE, elle ne s'ecrit plus dessous (01/09).
import { poserAide } from './aide-bulle.js';
// UN NOM DE CLIENT SE LIT EN CAPITALES — règle unique, voir nom-client.js.
import { nomClientAffiche } from './nom-client.js';

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


const MESSAGE_MAX = 1000;      // miroir de db.js (WHATSAPP_MESSAGE_MAX)

let tarifsArticles = [];
let tarifsParams = { tauxHoraireMo: 25, tauxHoraireMachine: 25, tgca: 0.04 };
const TARIFS_CATEGORIES = [
  { id: 'produit', label: 'Tasses' },
  { id: 'face', label: 'Options Face 1 / Face 2' },
  { id: 'dessous', label: 'Options Dessous' },
  { id: 'bat', label: 'BAT' },
];

// Les jetons remplacés à l'ouverture de WhatsApp. Le tableau sert à la fois de
// documentation à l'écran et de source des boutons « insérer ».
const JETONS = [
  { token: '{client}', label: 'Nom du dossier client', exemple: 'Hôtel Esmeralda' },
  { token: '{commande}', label: 'Description de la commande', exemple: '50 t-shirts staff' },
  { token: '{date}', label: 'Date souhaitée', exemple: '29/07/2026' },
];

// Ligne d'exemple servant à l'aperçu : ce que le client lira vraiment.
const EXEMPLE = Object.fromEntries(JETONS.map((j) => [j.token, j.exemple]));

let saved = '';          // dernier texte confirmé par le serveur

// --- Rendu ------------------------------------------------------------------
function buildStatic() {
  const page = el('div', 'reg-page');

  page.appendChild(ecranTete({ niveau: 'h2', titre: 'Réglages' }));
  // La phrase qui prévient que ces réglages valent PARTOUT : dans la page, pas
  // dans l'en-tête — voir la note de `.ecran-tete__compte` dans charte.css.
  page.appendChild(el('p', 'reg-intro', 'Ce que vous réglez ici vaut pour tous les postes de l’atelier.'));

  // --- Carte « message WhatsApp » -------------------------------------------
  const card = el('section', 'reg-card');
  card.appendChild(teteCarte('chat', 'Message WhatsApp « commande prête »',
    'Sur le planning, chaque commande dont le client a laissé un numéro porte '
    + 'une pastille WhatsApp. Un clic ouvre la conversation avec CE message déjà '
    + 'écrit — vous relisez, vous appuyez sur Envoyer. Rien ne part tout seul.'));

  const field = el('div', 'reg-field');
  const ta = el('textarea', 'reg-textarea');
  ta.id = 'reg-wa-message';
  ta.rows = 4;
  ta.maxLength = MESSAGE_MAX;
  ta.placeholder = 'Bonjour {client}, votre commande est prête…';
  ta.setAttribute('aria-label', 'Message WhatsApp envoyé au client');
  field.appendChild(ta);

  const bar = el('div', 'reg-field__bar');
  const jetons = el('div', 'reg-jetons');
  jetons.appendChild(el('span', 'reg-jetons__t', 'Insérer :'));
  for (const j of JETONS) {
    const b = el('button', 'reg-jeton', j.token);
    b.type = 'button';
    b.dataset.token = j.token;
    b.title = `${j.label} — ex. ${j.exemple}`;
    jetons.appendChild(b);
  }
  bar.append(jetons, el('span', 'reg-count', ''));
  field.appendChild(bar);
  card.appendChild(field);

  // Aperçu : le texte tel que le client le recevra, jetons remplis.
  const apercu = el('div', 'reg-apercu');
  apercu.append(el('span', 'reg-apercu__t', 'Ce que le client lira'),
    el('p', 'reg-apercu__bulle', ''));
  card.appendChild(apercu);

  const actions = el('div', 'reg-actions');
  const status = el('span', 'reg-status', '');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const reset = el('button', 'reg-btn', 'Annuler');
  reset.type = 'button';
  reset.id = 'reg-wa-reset';
  const save = el('button', 'reg-btn reg-btn--primary', 'Enregistrer');
  save.type = 'button';
  save.id = 'reg-wa-save';
  actions.append(status, reset, save);
  card.appendChild(actions);

  page.appendChild(card);

  // --- Carte « Identité de l'atelier » ----------------------------------------
  // CE QUI SIGNE LE BON DE COMMANDE. Le document sortait sans émetteur : ni
  // nom, ni adresse, ni numéro légal — donc un papier qu'on ne peut ni classer,
  // ni joindre, ni opposer. L'identité vit ici et non dans le code : un
  // déménagement ne doit pas demander un déploiement.
  // `storefront` et pas `store` : la police est un sous-ensemble figé de 91
  // glyphes, et un nom absent ne lève RIEN — il s'affiche en texte tronqué.
  // Mesuré au canevas le 28/08 : `store` sort à 100 px (cinq lettres à 20),
  // `storefront` à 20 (la ligature existe).
  page.appendChild(carteSimple('storefront', 'Identité de l’atelier',
    'Le nom, l’adresse et les numéros qui s’impriment en haut et en bas du bon '
    + 'de commande. Ce qui est laissé vide ne s’imprime pas : le papier sort '
    + 'avec ce qu’on sait, jamais avec une ligne à trou.', 'reg-entreprise'));

  // --- Carte « Tarifs tasse » -------------------------------------------------
  const tcard = el('section', 'reg-card');
  tcard.appendChild(teteCarte('local_cafe', 'Tarifs — Tasse',
    'Les prix et temps utilisés par Nouveau Projet pour calculer le total TTC '
    + 'd’une tasse personnalisée. Chaque changement est immédiat pour tous les postes.'));
  const tarifsList = el('div', 'reg-tarifs-list');
  tarifsList.id = 'reg-tarifs-list';
  tcard.appendChild(tarifsList);
  const tarifsParamsEl = el('div', 'reg-tarifs-params');
  tarifsParamsEl.id = 'reg-tarifs-params';
  tcard.appendChild(tarifsParamsEl);
  page.appendChild(tcard);

  // --- Carte « Marge » --------------------------------------------------------
  // §13 : « marge cible, marge minimum, alerte marge faible ». Deux nombres, et
  // c'est tout — la troisième ligne du patron (l'alerte) n'est pas un réglage,
  // c'est ce que le serveur fait de ces deux-là.
  // `receipt_long` et pas `percent` : la police est un sous-ensemble figé de
  // 91 glyphes, et un nom absent ne lève RIEN — il s'affiche en texte tronqué à
  // sa première lettre. On ne prend que des noms déjà en service ailleurs.
  page.appendChild(carteSimple('receipt_long', 'Marge',
    'En dessous du minimum, une vente reste ENREGISTRÉE mais l’écran prévient. '
    + 'On alerte, on n’interdit pas : un logiciel qui refuse une vente au comptoir '
    + 'est un logiciel qu’on contourne sur un papier.', 'reg-marges'));

  // --- Carte « Modèles d'étapes » ---------------------------------------------
  page.appendChild(carteSimple('work', 'Modèles d’étapes',
    'Les listes toutes faites qu’on pose sur un article : « T-shirt DTF » et ses '
    + 'cinq étapes, « Tasse UV » et ses trois. Sans modèle, il faudrait ressaisir '
    + 'les étapes à chaque commande — et personne ne le ferait deux fois.', 'reg-modeles'));

  // --- Carte « Machines » ------------------------------------------------------
  page.appendChild(carteSimple('settings', 'Coût des machines',
    'Le coût horaire et les consommables de chaque poste. Vide ne veut pas dire '
    + 'zéro : une machine non chiffrée retombe sur le taux machine général '
    + 'ci-dessus, elle ne coûte pas « rien ».', 'reg-machines'));

  // --- Carte « Suppléments express » ------------------------------------------
  // ILS ONT QUITTÉ L'ÉCRAN DE VENTE LE 27/08. Trois pourcentages d'atelier :
  // ils valent pour tous les postes, ils changent une fois par an, et ils
  // n'avaient rien à faire sous les yeux d'une vendeuse qui a un client devant
  // elle. Même API (`/api/supplements-express`), même effet immédiat sur les
  // deux parcours du comptoir.
  page.appendChild(carteSimple('bolt', 'Suppléments express',
    'La majoration appliquée quand le client veut sa commande vite. Elle se '
    + 'calcule sur les jours OUVRÉS et vaut pour tous les postes : le comptoir '
    + 'l’applique à la commande suivante, sans rien recharger.', 'reg-express'));

  // --- Carte « Transport » ------------------------------------------------------
  // IL VIVAIT FIGÉ DANS LE CATALOGUE TEXTILE. Le changer demandait un
  // déploiement, alors qu'un tarif de transporteur bouge — et ne fait
  // qu'augmenter. Le catalogue garde la LISTE des transports (c'est elle qui
  // remplit le menu du comptoir) ; c'est ici qu'on pose leur PRIX.
  // ⚠ PAS `local_shipping` : la police est un sous-ensemble figé de 91
  // ligatures, et le camion n'en fait pas partie. Un nom absent ne lève rien —
  // il s'écrit en toutes lettres, coupé à 1 em, et la carte portait le début
  // d'un « l » là où l'œil cherche un pictogramme. `flight_takeoff` y est, et
  // il nomme la seule ligne qui porte un prix : le Chronopost. Le maritime est
  // compris dans le prix d'achat et reste à zéro.
  page.appendChild(carteSimple('flight_takeoff', 'Transport',
    'Le coût du transport d’une pièce, en euros HT. Il entre dans le prix '
    + 'd’achat avant le coefficient : le changer rechiffre tout ce qui part '
    + 'ensuite. Le maritime est compris dans le prix d’achat, il reste à zéro.',
    'reg-transport'));

  // --- Carte « Chiffrage du devis » --------------------------------------------
  // LES SIX RÉGLAGES DU MOTEUR TEXTILE, ENFIN DANS LES RÉGLAGES (02/09/2026).
  // Charlie : « les 6 réglages du chiffrage doivent être réglables directement
  // dans une catégorie dédiée à devis flash dans réglage ».
  //
  // ⚠ ILS EXISTAIENT DÉJÀ EN BASE (`app_meta.textile_settings`) et le comptoir
  // les corrigeait depuis SON écran — un formulaire de six cases posé au milieu
  // de la prise de commande. Un barème d'atelier n'a rien à faire là : c'est un
  // réglage, il se règle une fois, et il vaut pour les trois écrans qui
  // chiffrent.
  page.appendChild(carteSimple('request_quote', 'Chiffrage du devis',
    'Les coûts et cadences de l’atelier qui font le prix d’un textile : le DTF, '
    + 'le pressage, l’heure d’atelier, l’arrondi et le palier de coefficient. '
    + 'Ils valent pour le devis, la vente et la demande de devis — deux postes '
    + 'ne peuvent pas annoncer deux prix pour le même article.',
    'reg-chiffrage'));

  // --- Carte « Fonctions en cours » --------------------------------------------
  page.appendChild(carteSimple('settings', 'Fonctions en cours',
    'Les chantiers livrés mais pas encore allumés. Éteints, l’application se '
    + 'comporte exactement comme avant. Allumer « Connexion nominative » demandera '
    + 'à chacun de choisir son prénom et son code au prochain chargement.', 'reg-flags'));

  // --- Carte « Catalogue produits » -------------------------------------------
  // Ce que la boutique vend, rayon par rayon. Il vivait EN DUR dans
  // `public/comptoir/catalogue.js` : tant qu'un catalogue est du code, aucun
  // prix ne peut s'y importer — il aurait fallu redéployer pour changer un
  // tarif. Il est en base depuis le 01/09, le comptoir l'y lit, et c'est ce qui
  // ouvre la porte à la carte juste en dessous.
  page.appendChild(carteSimple('local_grocery_store', 'Catalogue produits',
    'Les produits que le comptoir propose au menu, et ce qu’ils coûtent. Ils '
    + 'sont en base : le comptoir les y lit à chaque ouverture, et un prix '
    + 'importé ici vaut aussitôt pour tous les postes. Les commandes déjà '
    + 'passées, elles, ne bougent pas — leur prix est figé au moment de la prise.',
    'reg-catalogue'));

  // --- Carte « Import de prix » -----------------------------------------------
  // DEUX TEMPS, ET LE PREMIER N'ÉCRIT RIEN. On lit le fichier ENTIER, on dit ce
  // qu'on ferait — combien créées, combien mises à jour, combien refusées et
  // POURQUOI — et c'est seulement au second clic que la base bouge.
  const icard = el('section', 'reg-card');
  icard.appendChild(teteCarte('view_column', 'Import de prix',
    'Un fichier CSV, exporté d’Excel par « Enregistrer sous » (choisir '
    + '« CSV UTF-8 »). Les intitulés de SumUp — Category, Item name, Price — '
    + 'sont reconnus tels quels. Rien ne s’écrit avant que vous n’ayez lu ce '
    + 'que l’import va faire.'));
  const ibox = el('div', 'reg-import');
  ibox.id = 'reg-import';
  icard.appendChild(ibox);
  page.appendChild(icard);

  // --- Carte « Corbeille » ----------------------------------------------------
  // Une commande retirée du planning n'est plus détruite : elle attend ici.
  // Sans cette carte, l'archivage serait invisible — donc, pour l'employé qui
  // s'est trompé de ligne, exactement aussi définitif qu'une suppression.
  const ccard = el('section', 'reg-card');
  ccard.appendChild(teteCarte('delete', 'Corbeille',
    'Les commandes retirées du planning. Rien n’est effacé : elles gardent leur '
    + 'prix, leurs documents et tout leur historique, et reviennent d’un clic à '
    + 'l’étape où elles étaient.'));
  const corbList = el('div', 'reg-corbeille');
  corbList.id = 'reg-corbeille';
  ccard.appendChild(corbList);
  page.appendChild(ccard);

  ROOT.replaceChildren(page);
}

// L'EN-TETE D'UNE CARTE, ET IL N'Y EN A QU'UN. Il etait ecrit CINQ fois dans ce
// fichier — cinq fois la meme rangee, cinq fois le meme paragraphe sous le
// titre. Depuis le 01/09 l'explication est dans la bulle du « i » : une seule
// fabrique, sinon la prochaine carte reecrira la sienne.
function teteCarte(icone, titre, aide) {
  const head = el('header', 'reg-card__head');
  const ligne = el('div', 'reg-card__t');
  ligne.append(el('h3', 'reg-card__title', titre));
  head.append(ic(icone, 'reg-card__ic'), ligne);
  poserAide(head, ligne, aide);
  return head;
}

// Une carte de réglage = un en-tête + un conteneur que le rendu remplit. Les
// deux premières cartes (WhatsApp, Tarifs) sont écrites à la main parce qu'elles
// portent des contrôles particuliers ; celles-ci se ressemblent toutes.
function carteSimple(icone, titre, desc, idContenu) {
  const card = el('section', 'reg-card');
  card.appendChild(teteCarte(icone, titre, desc));
  const box = el('div', 'reg-liste');
  box.id = idContenu;
  card.appendChild(box);
  return card;
}

// --- Marge, modèles, machines, interrupteurs ---------------------------------
let marges = { cible: 60, minimum: 35 };
// Les mêmes valeurs par défaut que le comptoir : si la lecture échoue, les deux
// écrans racontent la même chose plutôt que deux barèmes différents.
let express = { j5: 0, j10: 0, j15: 0 };
let modeles = [];
let machines = [];
let flags = { flags: {}, connus: {} };

// Un champ de nombre qui s'enregistre à la PERTE DU FOCUS, jamais à la frappe :
// un enregistrement par touche ferait un appel par chiffre tapé.
function champNombre(valeur, suffixe, onSave) {
  const wrap = el('label', 'reg-champ');
  const input = el('input', 'reg-tarif-input reg-tarif-input--num');
  input.type = 'number';
  input.value = valeur == null ? '' : String(valeur);
  input.addEventListener('change', () => onSave(input.value, input));
  wrap.append(input);
  if (suffixe) wrap.append(el('span', 'reg-champ__unite', suffixe));
  return wrap;
}

// LE TARIF DE TRANSPORT. La liste des transports vient du serveur, pas d'une
// liste écrite ici : en ajouter un demain ne doit pas demander de retoucher cet
// écran.
let transports = {};

function renderTransport() {
  const hote = $('#reg-transport');
  if (!hote) return;
  const noms = Object.keys(transports).sort();
  if (!noms.length) {
    hote.replaceChildren(el('p', 'reg-vide', 'Aucun transport au catalogue.'));
    return;
  }
  hote.replaceChildren(...noms.map((nom) => {
    const l = el('div', 'reg-ligne');
    l.append(el('span', 'reg-ligne__nom', nom));
    l.append(el('span', 'reg-ligne__aide',
      nom === 'Maritime' ? 'compris dans le prix d’achat' : 'par pièce, avant coefficient'));
    l.append(champNombre(transports[nom], '€ HT', async (v) => {
      const n = Number(String(v).replace(',', '.'));
      // LE SERVEUR REFUSE HORS DE [0, 100] : on le dit ici plutôt que de laisser
      // partir un appel qui reviendra avec un message technique.
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        flash('Un prix de transport s’écrit en euros, entre 0 et 100.', 'is-ko');
        renderTransport();
        return;
      }
      try {
        transports = await api('PUT', '/api/tarifs-transport', { ...transports, [nom]: n });
        renderTransport();
        flash('Enregistré — le prochain chiffrage en tient compte', 'is-ok');
      } catch (err) {
        // Jamais d'échec muet : sinon on chiffre au tarif d'avant en croyant
        // l'avoir changé.
        flash(err.message, 'is-ko');
        renderTransport();
      }
    }));
    return l;
  }));
}

function renderMarges() {
  const hote = $('#reg-marges');
  if (!hote) return;
  const ligne = (cle, label, aide) => {
    const l = el('div', 'reg-ligne');
    l.append(el('span', 'reg-ligne__nom', label));
    l.append(el('span', 'reg-ligne__aide', aide));
    l.append(champNombre(marges[cle], '%', async (v) => {
      try {
        marges = await api('PUT', '/api/marges', { ...marges, [cle]: Number(v) });
        renderMarges();
        flash('Enregistré', 'is-ok');
      } catch (err) { flash(err.message, 'is-ko'); }
    }));
    return l;
  };
  hote.replaceChildren(
    ligne('cible', 'Marge cible', 'ce qu’on vise'),
    // Un minimum au-dessus de la cible rendrait l'alerte permanente : le
    // serveur remonte alors la cible, et l'écran le montre tout de suite.
    ligne('minimum', 'Marge minimum', 'en dessous, l’écran prévient'),
  );
}

// Les trois paliers, dans l'ordre où le délai les traverse. Les intitulés sont
// ceux du comptoir, mot pour mot : deux écrans qui nomment différemment le même
// réglage, c'est deux réglages pour qui les lit.
const EXPRESS_PALIERS = [
  ['j5', 'Sous 5 jours ouvrés', 'la commande la plus urgente'],
  ['j10', 'Sous 10 jours ouvrés', 'le palier intermédiaire'],
  ['j15', 'Au-delà', 'le délai standard — le plus souvent 0 %'],
];

function renderExpress() {
  const hote = $('#reg-express');
  if (!hote) return;
  hote.replaceChildren(...EXPRESS_PALIERS.map(([cle, nom, aide]) => {
    const l = el('div', 'reg-ligne');
    l.append(el('span', 'reg-ligne__nom', nom));
    l.append(el('span', 'reg-ligne__aide', aide));
    l.append(champNombre(express[cle], '%', async (v) => {
      const n = Number(String(v).replace(',', '.'));
      // LE SERVEUR REFUSE HORS DE [0, 100] : on le dit ici plutôt que de laisser
      // partir un appel qui reviendra en erreur avec un message technique.
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        flash('Chaque palier attend un pourcentage entre 0 et 100.', 'is-ko');
        renderExpress();
        return;
      }
      try {
        express = await api('PUT', '/api/supplements-express', { ...express, [cle]: n });
        renderExpress();
        flash('Enregistré — vaut pour tous les postes', 'is-ok');
      } catch (err) {
        // Jamais d'échec muet : sinon la vendeuse applique un barème qui n'a
        // pas changé, en croyant le contraire.
        flash(err.message, 'is-ko');
        renderExpress();
      }
    }));
    return l;
  }));
}

// LES SIX RÉGLAGES DU CHIFFRAGE. Le nom, l'unité et l'aide sont écrits ICI et
// nulle part ailleurs : les bornes, elles, appartiennent au serveur (`db.js`,
// TEXTILE_BORNES) — il refuse ce qui sort, on ne le devine pas deux fois.
const CHIFFRAGE_LIGNES = [
  ['dtfCost', 'Coût du DTF', '€ / m', 'le mètre linéaire de film, prix d’achat'],
  ['dtfSpeed', 'Débit du DTF', 'm / h', 'ce que la machine sort en une heure'],
  ['pressMin', 'Pressage', 'min / impression', 'le temps d’une pièce sous la presse'],
  ['hourlyCost', 'Coût d’atelier', '€ / h', 'ce que coûte une heure de poste'],
  ['roundStep', 'Arrondi supérieur', '€', 'le prix de vente monte au multiple suivant'],
  ['maxCoefQty', 'Palier de coefficient', 'pièces', 'au-delà, le coefficient ne descend plus'],
];
let chiffrage = {};

function renderChiffrage() {
  const hote = $('#reg-chiffrage');
  if (!hote) return;
  hote.replaceChildren(...CHIFFRAGE_LIGNES.map(([cle, nom, unite, aide]) => {
    const l = el('div', 'reg-ligne');
    l.append(el('span', 'reg-ligne__nom', nom));
    l.append(el('span', 'reg-ligne__aide', aide));
    l.append(champNombre(chiffrage[cle], unite, async (v) => {
      const n = Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) {
        flash('Ce réglage attend un nombre positif.', 'is-ko');
        renderChiffrage();
        return;
      }
      try {
        // ⚠ LE SERVEUR IGNORE UNE VALEUR HORS BORNES, il ne la refuse pas : il
        // renvoie donc ce qu'il a RETENU, et c'est ça qu'on réaffiche. Garder la
        // valeur tapée ferait croire à un enregistrement qui n'a pas eu lieu.
        chiffrage = await api('PUT', '/api/settings/textile', { ...chiffrage, [cle]: n });
        renderChiffrage();
        flash('Enregistré — vaut pour tous les postes', 'is-ok');
      } catch (err) {
        flash(err.message, 'is-ko');
        renderChiffrage();
      }
    }));
    return l;
  }));
}

function renderModeles() {
  const hote = $('#reg-modeles');
  if (!hote) return;
  hote.replaceChildren(...modeles.map((m) => {
    const l = el('div', 'reg-ligne');
    l.append(el('span', 'reg-ligne__nom', m.nom));
    // Les étapes se lisent d'un coup, séparées par des flèches : c'est un
    // CHEMIN, et une liste à puces ne le dirait pas.
    l.append(el('span', 'reg-ligne__aide', (m.etapes || []).join(' → ')));
    return l;
  }));
  if (!modeles.length) hote.append(el('p', 'reg-corb__vide', 'Aucun modèle.'));
}

// L'IDENTITÉ DE L'ATELIER. Huit lignes de texte libre, enregistrées à la PERTE
// DU FOCUS : un enregistrement par touche ferait un appel par caractère tapé.
// L'ordre est celui du papier — le nom d'abord, les mentions légales en
// dernier, comme elles sortent au pied du document.
let entreprise = {};
const ENTREPRISE_LIGNES = [
  ['nom', 'Nom', 'Atelier OLDA'],
  ['adresse', 'Adresse', '27 rue de Hollande'],
  ['ville', 'Code postal et ville', '97150 Marigot, Saint-Martin'],
  ['tel', 'Téléphone', '0590 87 12 34'],
  ['email', 'E-mail', 'contact@exemple.fr'],
  ['web', 'Site', 'exemple.fr'],
  ['siret', 'SIRET', '812 345 678 00019'],
  ['ape', 'Code APE', '1813Z'],
  ['rcs', 'RCS', '812 345 678'],
  ['tva', 'N° de TVA', 'FR00 812345678'],
  ['capital', 'Capital', '500,00 €'],
  // OÙ LE CLIENT VERSE SON ACOMPTE. Trois lignes, et elles vont ensemble : le
  // devis n'imprime son cadre de règlement que si les trois sont là — un devis
  // qui réclame un acompte sans dire où le virer fait rappeler le client, et
  // c'est pire qu'un cadre absent.
  ['banque', 'Banque', 'Credit Mutuel'],
  ['iban', 'IBAN', 'FR76 1234 5678 9012 3456 7890 123'],
  ['bic', 'BIC', 'CMCIFR2A'],
];

function renderEntreprise() {
  const hote = $('#reg-entreprise');
  if (!hote) return;
  // TOUS LES CHAMPS COMMENCENT AU MÊME ENDROIT. Sans cette classe, chaque
  // intitulé pousse son champ de sa propre largeur — huit lignes, huit bords
  // gauches, sur une carte qui se lit en colonne (voir styles.css).
  hote.classList.add('reg-liste--paires');
  hote.replaceChildren(...ENTREPRISE_LIGNES.map(([cle, nom, exemple]) => {
    const l = el('div', 'reg-ligne');
    l.append(el('span', 'reg-ligne__nom', nom));
    const champ = el('input', 'reg-tarif-input reg-tarif-input--nom');
    champ.type = 'text';
    champ.value = entreprise[cle] == null ? '' : String(entreprise[cle]);
    champ.placeholder = exemple;
    champ.setAttribute('aria-label', nom);
    champ.addEventListener('change', async () => {
      try {
        entreprise = await api('PUT', '/api/settings/entreprise', { [cle]: champ.value });
        // On ne redessine pas : le serveur a pu nettoyer la valeur (espaces,
        // longueur), et remplacer le champ SOUS LES DOIGTS ferait perdre le
        // curseur à qui enchaîne deux lignes à la tabulation.
        flash('Enregistré', 'is-ok');
      } catch (err) { flash(err.message, 'is-ko'); }
    });
    l.append(champ);
    return l;
  }));
}

function renderMachines() {
  const hote = $('#reg-machines');
  if (!hote) return;
  hote.replaceChildren(...machines.map((m, i) => {
    const l = el('div', 'reg-ligne');
    l.append(el('span', 'reg-ligne__nom', m.name));
    l.append(el('span', 'reg-ligne__aide', 'coût horaire · consommables'));
    const sauver = async (champ, v) => {
      machines[i] = { ...machines[i], [champ]: v === '' ? null : Number(v) };
      try {
        machines = await api('PUT', '/api/machines', machines);
        flash('Enregistré', 'is-ok');
      } catch (err) { flash(err.message, 'is-ko'); }
    };
    l.append(champNombre(m.coutHoraire, '€/h', (v) => sauver('coutHoraire', v)));
    l.append(champNombre(m.consommables, '€', (v) => sauver('consommables', v)));
    return l;
  }));
}

function renderFlags() {
  const hote = $('#reg-flags');
  if (!hote) return;
  const noms = Object.keys(flags.connus || {});
  hote.replaceChildren(...noms.map((nom) => {
    const l = el('div', 'reg-ligne');
    l.append(el('span', 'reg-ligne__nom', flags.connus[nom]));
    const inter = el('input', 'reg-inter');
    inter.type = 'checkbox';
    inter.checked = !!(flags.flags || {})[nom];
    inter.setAttribute('aria-label', flags.connus[nom]);
    inter.addEventListener('change', async () => {
      try {
        flags = await api('PUT', '/api/flags', { [nom]: inter.checked });
        // ALLUMER LES COMPTES CHANGE L'ÉCRAN ENTIER : la barre, les droits, la
        // connexion. On recharge plutôt que de laisser une moitié d'écran
        // d'avant cohabiter avec une moitié d'après.
        if (nom === 'comptes') window.location.reload();
        renderFlags();
      } catch (err) {
        inter.checked = !inter.checked;
        flash(err.message, 'is-ko');
      }
    });
    l.append(inter);
    return l;
  }));
}

// --- Corbeille ----------------------------------------------------------------
// Chargée à chaque passage sur les Réglages : elle n'a pas besoin d'être en
// temps réel, et personne ne la regarde en continu.
let corbeille = [];

function corbeilleRow(r) {
  const row = el('div', 'reg-corb');
  const quoi = el('div', 'reg-corb__quoi');
  quoi.append(
    el('span', 'reg-corb__nom', nomClientAffiche(r.billing_company, r.client_type) || 'Sans client'),
    el('span', 'reg-corb__detail', [
      r.product,
      r.quantity ? `${r.quantity} pièce${r.quantity > 1 ? 's' : ''}` : null,
      // La référence du ticket est ce que le client a en main : c'est par elle
      // qu'il rappelle, et c'est donc elle qui permet de retrouver la ligne.
      r.fiche && r.fiche.ref ? `nº ${r.fiche.ref}` : null,
    ].filter(Boolean).join(' · ')),
  );
  const quand = el('span', 'reg-corb__quand', dateCourte(r.updated_at));
  const btn = el('button', 'reg-btn', 'Remettre au planning');
  btn.type = 'button';
  btn.dataset.restaurer = r.id;
  row.append(quoi, quand, btn);
  return row;
}

// `deleted_at` n'est pas dans la projection de liste (voir COLONNES_REQUEST) :
// la corbeille est déjà triée du plus récent au plus ancien par le serveur, et
// c'est le seul ordre qu'on affiche. On date donc sur `updated_at`, que
// l'archivage vient justement de poser.
const dateCourte = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR');
};

function renderCorbeille() {
  const hote = $('#reg-corbeille');
  if (!hote) return;
  if (!corbeille.length) {
    hote.replaceChildren(el('p', 'reg-corb__vide', 'Rien n’a été retiré du planning.'));
    return;
  }
  hote.replaceChildren(...corbeille.map(corbeilleRow));
}

async function chargerCorbeille() {
  try {
    const lignes = await api('GET', '/api/requests/corbeille');
    corbeille = Array.isArray(lignes) ? lignes : [];
  } catch (_) {
    // Une corbeille injoignable ne doit pas empêcher de régler le reste : la
    // carte le dit et les autres cartes continuent de fonctionner.
    corbeille = [];
    const hote = $('#reg-corbeille');
    if (hote) hote.replaceChildren(el('p', 'reg-corb__vide', 'Corbeille indisponible — vérifie la connexion.'));
    return;
  }
  renderCorbeille();
}

async function restaurer(id, bouton) {
  bouton.disabled = true;
  bouton.textContent = 'Remise en cours…';
  try {
    await api('POST', `/api/requests/${encodeURIComponent(id)}/restaurer`);
  } catch (err) {
    bouton.disabled = false;
    bouton.textContent = 'Remettre au planning';
    flash(err.message || 'Remise impossible', 'is-ko');
    return;
  }
  // On retire la ligne de la liste locale plutôt que de tout recharger : la
  // carte ne bouge pas sous les doigts de celui qui vient de cliquer.
  corbeille = corbeille.filter((r) => r.id !== id);
  renderCorbeille();
}

// Le texte du moment, jetons remplacés par l'exemple.
function apercu(text) {
  let out = text;
  for (const [token, val] of Object.entries(EXEMPLE)) out = out.split(token).join(val);
  return out.replace(/[ \t]+/g, ' ').trim();
}

// Reflète l'état de la saisie : compteur, aperçu, boutons.
function sync() {
  const ta = $('#reg-wa-message');
  const text = ta.value;
  const dirty = text !== saved;
  $('.reg-count').textContent = `${text.length} / ${MESSAGE_MAX}`;
  const bulle = $('.reg-apercu__bulle');
  bulle.textContent = apercu(text) || 'Message vide : WhatsApp s’ouvrira sans texte.';
  bulle.classList.toggle('is-vide', apercu(text) === '');
  $('#reg-wa-save').disabled = !dirty;
  $('#reg-wa-reset').disabled = !dirty;
}

// Message de statut passager (« Enregistré »), effacé tout seul.
let statusTimer = null;
function flash(text, cls = '') {
  // Une sauvegarde différée peut aboutir alors que l'écran n'est plus monté :
  // il n'y a alors plus rien à informer, et surtout rien à faire tomber.
  const s = ROOT && $('.reg-status');
  if (!s) return;
  s.textContent = text;
  s.className = `reg-status${cls ? ` ${cls}` : ''}`;
  clearTimeout(statusTimer);
  if (text) statusTimer = setTimeout(() => { s.textContent = ''; }, 2600);
}

// Insère un jeton à l'endroit du curseur (et pas bêtement à la fin) : on écrit
// souvent « Bonjour {client}, » au milieu d'une phrase déjà tapée.
function insertToken(token) {
  const ta = $('#reg-wa-message');
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
  const pos = start + token.length;
  ta.focus();
  ta.setSelectionRange(pos, pos);
  sync();
}

async function save() {
  const ta = $('#reg-wa-message');
  const message = ta.value;
  $('#reg-wa-save').disabled = true;
  flash('Enregistrement…');
  try {
    const res = await fetchBorne('/api/settings/whatsapp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    saved = data.message;
    ta.value = saved;
    flash('Enregistré', 'is-ok');
  } catch (err) {
    flash(err.message || 'Enregistrement impossible', 'is-ko');
  } finally {
    sync();
  }
}

// --- Tarifs tasse -------------------------------------------------------------
let tarifsSaveTimer = null;

// Le serveur renvoie SES objets (normalisés) après enregistrement. Les remplacer
// d'un bloc laissait les lignes déjà affichées accrochées aux ANCIENS objets :
// la correction suivante partait dans le vide (l'écran montrait pourtant la
// nouvelle valeur), le bouton supprimer ne trouvait plus sa ligne, et le
// bouton actif/inactif revenait en arrière tout seul. On réconcilie donc EN
// PLACE tant que la liste a la même forme.
function reconcilierTarifs(recu) {
  if (!Array.isArray(recu)) return false;
  if (recu.length !== tarifsArticles.length) {
    tarifsArticles = recu;
    return true; // forme différente : il faut re-dessiner la liste
  }
  recu.forEach((neuf, i) => Object.assign(tarifsArticles[i], neuf));
  return false;
}

async function saveTarifs() {
  clearTimeout(tarifsSaveTimer);
  tarifsSaveTimer = setTimeout(envoyerTarifs, 400);
}

async function envoyerTarifs() {
  clearTimeout(tarifsSaveTimer);
  tarifsSaveTimer = null;
  try {
    const recu = await api('PUT', '/api/tarifs-tasse', tarifsArticles);
    if (reconcilierTarifs(recu)) renderTarifs();
    flash('Tarifs enregistrés', 'is-ok');
  } catch (_) {
    // Un échec muet laissait le patron partir en croyant son prix enregistré —
    // et la vente directe continuait à calculer avec l'ancien.
    flash('Tarifs NON enregistrés — vérifie la connexion', 'is-ko');
  }
}

async function saveTarifsParams() {
  try {
    tarifsParams = await api('PUT', '/api/tarifs-tasse/parametres', tarifsParams);
    flash('Réglages enregistrés', 'is-ok');
  } catch (_) {
    flash('Réglages NON enregistrés — vérifie la connexion', 'is-ko');
  }
}

// Quitter la page pendant les 400 ms d'attente perdait la dernière correction
// sans le dire. `sendBeacon` est l'outil prévu pour ça : l'envoi survit à la
// fermeture de l'onglet ET n'a pas de promesse à rejeter — le `fetch` nu
// d'avant levait un « Uncaught (in promise) » à chaque pagehide hors ligne.
function flusherTarifs() {
  if (tarifsSaveTimer == null) return;
  clearTimeout(tarifsSaveTimer);
  tarifsSaveTimer = null;
  const corps = JSON.stringify(tarifsArticles);
  try {
    const blob = new Blob([corps], { type: 'application/json' });
    if (navigator.sendBeacon && navigator.sendBeacon('/api/tarifs-tasse', blob)) return;
  } catch (_) { /* on retombe sur le fetch keepalive ci-dessous */ }
  try {
    fetch('/api/tarifs-tasse', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: corps,
      keepalive: true,
    }).catch(() => { /* dernier recours : rien de plus à faire l'onglet fermé */ });
  } catch (_) { /* idem */ }
}
window.addEventListener('pagehide', flusherTarifs);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flusherTarifs();
});

function tarifRow(a) {
  const row = el('div', 'reg-tarif-row');
  // CHAQUE CASE DIT CE QU'ELLE EST. Trois champs nus par ligne, sur une
  // trentaine de lignes : deux montants qui se ressemblent, un intitulé, une
  // bascule et une corbeille — tous SANS nom. Rien n'annonçait lequel des deux
  // nombres était l'achat, et la corbeille (une icône seule, avec son glyphe
  // marqué `aria-hidden`) n'avait aucun nom du tout. On les nomme, et on les
  // nomme AVEC l'article : « Supprimer » seul, trente fois de suite, ne dit pas
  // quelle ligne on va perdre.
  const quoi = () => (String(a.designation || '').trim() || 'cet article');
  const desig = el('input', 'reg-tarif-input reg-tarif-input--nom');
  desig.value = a.designation; desig.placeholder = 'Désignation';
  desig.setAttribute('aria-label', 'Désignation de l’article');
  desig.addEventListener('change', () => { a.designation = desig.value; saveTarifs(); });
  const achat = el('input', 'reg-tarif-input reg-tarif-input--num');
  achat.type = 'number'; achat.step = '0.01'; achat.min = '0'; achat.value = a.prixAchat;
  achat.title = 'Prix d’achat';
  achat.setAttribute('aria-label', `Prix d’achat — ${quoi()}`);
  achat.addEventListener('change', () => { a.prixAchat = Number(achat.value) || 0; saveTarifs(); });
  const prix = el('input', 'reg-tarif-input reg-tarif-input--num');
  prix.type = 'number'; prix.step = '0.01'; prix.min = '0'; prix.value = a.prixVenteTtc;
  prix.title = 'Prix de vente TTC';
  prix.setAttribute('aria-label', `Prix de vente TTC — ${quoi()}`);
  prix.addEventListener('change', () => { a.prixVenteTtc = Number(prix.value) || 0; saveTarifs(); });
  const actif = el('button', `reg-tarif-toggle${a.actif ? ' is-on' : ''}`);
  actif.type = 'button';
  actif.title = a.actif ? 'Actif — cliquer pour désactiver' : 'Inactif — cliquer pour activer';
  actif.setAttribute('aria-label',
    `${quoi()} : ${a.actif ? 'actif, appuyer pour désactiver' : 'inactif, appuyer pour activer'}`);
  actif.append(ic(a.actif ? 'visibility' : 'visibility_off'));
  actif.addEventListener('click', () => { a.actif = !a.actif; saveTarifs(); renderTarifs(); });
  const del = el('button', 'reg-tarif-del');
  del.type = 'button';
  del.title = 'Supprimer cette ligne de tarif';
  del.setAttribute('aria-label', `Supprimer ${quoi()}`);
  del.append(ic('delete'));
  del.addEventListener('click', () => {
    tarifsArticles = tarifsArticles.filter((x) => x !== a);
    saveTarifs(); renderTarifs();
  });
  row.append(desig, achat, prix, actif, del);
  return row;
}

function renderTarifs() {
  const box = $('#reg-tarifs-list');
  if (!box) return;
  box.replaceChildren();
  for (const cat of TARIFS_CATEGORIES) {
    box.appendChild(el('h4', 'reg-tarif-cat', cat.label));
    const rows = tarifsArticles.filter((a) => a.categorie === cat.id);
    for (const a of rows) box.appendChild(tarifRow(a));
    const addBtn = el('button', 'reg-tarif-add');
    addBtn.type = 'button';
    addBtn.append(ic('add'), el('span', null, `Ajouter (${cat.label.toLowerCase()})`));
    addBtn.addEventListener('click', () => {
      tarifsArticles.push({
        id: `tmp-${Date.now()}`, categorie: cat.id, designation: '', prixAchat: 0, prixVenteTtc: 0,
        tempsMoMin: 0, tempsMachineMin: 0, actif: true, position: tarifsArticles.length * 1000,
      });
      renderTarifs();
    });
    box.appendChild(addBtn);
  }

  const p = $('#reg-tarifs-params');
  p.replaceChildren();
  const field = (key, label) => {
    const wrap = el('label', 'reg-tarif-param');
    wrap.append(el('span', null, label));
    const input = el('input', 'reg-tarif-input reg-tarif-input--num');
    input.type = 'number'; input.step = key === 'tgca' ? '0.001' : '0.5'; input.min = '0';
    input.value = tarifsParams[key];
    input.addEventListener('change', () => {
      tarifsParams[key] = Number(input.value) || 0;
      saveTarifsParams();
    });
    wrap.appendChild(input);
    return wrap;
  };
  p.append(field('tauxHoraireMo', 'Taux horaire MO (€)'), field('tauxHoraireMachine', 'Taux horaire machine (€)'), field('tgca', 'TGCA (ex. 0.04 = 4 %)'));
}

// --- LE CATALOGUE ET SON IMPORT (01/09/2026) ---------------------------------
// Le catalogue du comptoir vit en base depuis le 01/09. Ces deux cartes sont ce
// que le patron en voit : ce qu'elle contient, et la porte par où les prix
// entrent.
let catalogue = [];
let importCsv = '';        // le texte du fichier choisi, tel qu'il a été lu
let importNom = '';        // son nom, pour que l'écran dise SUR QUOI il parle
let importRapport = null;  // le dernier aperçu rendu par le serveur

const NB = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Un montant ABSENT n'est pas zéro : « — » le dit, « 0,00 € » mentirait.
const euros = (v) => (v == null ? '—' : `${NB.format(v)} €`);

// Combien de produits, dans combien de rayons, et combien portent un prix.
// C'est la seule question qu'on se pose devant cette carte : que reste-t-il à
// tarifer ?
function renderCatalogue() {
  const box = $('#reg-catalogue');
  if (!box) return;
  box.replaceChildren();
  if (!catalogue.length) {
    box.appendChild(el('p', 'reg-corb__vide',
      'Aucun produit en base. Une base neuve se sème toute seule au démarrage ; '
      + 'sinon, l’import ci-dessous les créera.'));
    return;
  }
  const familles = [];
  const par = new Map();
  for (const p of catalogue) {
    let f = par.get(p.famille);
    if (!f) { f = { nom: p.famille, total: 0, tarifes: 0, eteints: 0 }; par.set(p.famille, f); familles.push(f); }
    f.total += 1;
    if (p.prixVenteTtc != null) f.tarifes += 1;
    if (!p.actif) f.eteints += 1;
  }
  const tarifes = familles.reduce((n, f) => n + f.tarifes, 0);
  const tete = el('div', 'reg-ligne');
  tete.append(el('span', 'reg-ligne__nom', `${catalogue.length} produits · ${familles.length} familles`),
    el('span', 'reg-ligne__aide',
      tarifes === catalogue.length
        ? 'tous ont un prix de vente'
        : `${catalogue.length - tarifes} sans prix de vente`));
  box.appendChild(tete);
  for (const f of familles) {
    const row = el('div', 'reg-ligne');
    const detail = [`${f.tarifes}/${f.total} tarifés`];
    if (f.eteints) detail.push(`${f.eteints} éteints`);
    row.append(el('span', 'reg-ligne__nom', f.nom), el('span', 'reg-ligne__aide', detail.join(' · ')));
    box.appendChild(row);
  }
}

// LE FICHIER SE LIT EN UTF-8, PUIS EN WINDOWS-1252 À DÉFAUT. Excel sait
// enregistrer un CSV dans les deux ; sans ce repli, « Décapsuleur » revenait
// « D?capsuleur » et l'import créait un doublon au lieu de retrouver la ligne.
async function lireFichierCsv(fichier) {
  const octets = await fichier.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(octets);
  } catch (_) {
    return new TextDecoder('windows-1252').decode(octets);
  }
}

async function choisirFichierImport(fichier) {
  if (!fichier) return;
  importRapport = null;
  importNom = fichier.name || 'fichier.csv';
  renderImport('Lecture du fichier…');
  try {
    importCsv = await lireFichierCsv(fichier);
  } catch (_) {
    importCsv = '';
    return renderImport('Fichier illisible.', 'is-ko');
  }
  await demanderApercu();
}

// L'APERÇU N'ÉCRIT RIEN. C'est le serveur qui analyse — le même code que celui
// qui écrira ensuite, sinon l'aperçu ne prouverait rien.
async function demanderApercu() {
  if (!importCsv) return;
  renderImport('Analyse du fichier…');
  try {
    importRapport = await api('POST', '/api/catalogue-produits/import/apercu', { csv: importCsv });
    renderImport('');
  } catch (err) {
    importRapport = null;
    renderImport(err.message, 'is-ko');
  }
}

// L'ÉCRITURE, avec la SIGNATURE de l'aperçu. Si elle ne correspond plus, c'est
// que la base a bougé entre les deux : le serveur refuse, et il a raison.
async function appliquerImport(bouton) {
  if (!importRapport || !importRapport.signature) return;
  bouton.disabled = true;
  try {
    const fait = await api('POST', '/api/catalogue-produits/import',
      { csv: importCsv, signature: importRapport.signature });
    importRapport = fait;
    catalogue = await api('GET', '/api/catalogue-produits');
    renderCatalogue();
    const r = fait.resume;
    renderImport(`Importé : ${r.creees} créés, ${r.majs} mis à jour.`, 'is-ok');
  } catch (err) {
    // « Le vert se tait, l'échec parle » : un import qui échoue doit le DIRE,
    // sinon le patron repart en croyant ses prix posés.
    renderImport(err.message, 'is-ko');
    bouton.disabled = false;
  }
}

// LE RAPPORT, EN CLAIR. Les refus se regroupent par RAISON — cinquante lignes
// qui disent la même chose n'apprennent rien de plus que la raison et la liste
// des numéros, et elles noieraient les autres.
function renderRefus(box, lignes, ecartees) {
  const parRaison = new Map();
  for (const l of lignes) {
    const raison = ecartees ? String(l.ecarte || '') : l.refus.join(' · ');
    if (!parRaison.has(raison)) parRaison.set(raison, []);
    parRaison.get(raison).push(l.numero);
  }
  for (const [raison, numeros] of parRaison) {
    const row = el('div', `reg-import__refus${ecartees ? ' est-ecartee' : ''}`);
    const ou = numeros.length > 6
      ? `lignes ${numeros.slice(0, 6).join(', ')} … (+${numeros.length - 6})`
      : `ligne${numeros.length > 1 ? 's' : ''} ${numeros.join(', ')}`;
    row.append(el('span', 'reg-import__ou', ou), el('span', 'reg-import__pourquoi', raison));
    box.appendChild(row);
  }
}

function renderImport(message, cls) {
  const box = $('#reg-import');
  if (!box) return;
  box.replaceChildren();

  // La porte : un vrai `<input type="file">`, caché derrière le bouton qui le
  // déclenche — l'habillage natif ne prend pas la boîte des autres commandes de
  // l'écran, et deux boutons sur une même barre ont la même hauteur.
  const barre = el('div', 'reg-actions');
  const champ = el('input');
  champ.type = 'file';
  champ.accept = '.csv,text/csv,text/plain';
  champ.id = 'reg-import-fichier';
  champ.className = 'reg-import__fichier';
  champ.addEventListener('change', () => choisirFichierImport(champ.files && champ.files[0]));
  const choisir = el('label', 'reg-btn');
  choisir.setAttribute('for', 'reg-import-fichier');
  choisir.append(ic('add'), el('span', null, importNom ? 'Choisir un autre fichier' : 'Choisir un fichier CSV…'));

  const etat = el('span', `reg-status${cls ? ` ${cls}` : ''}`,
    message || (importNom ? importNom : 'Aucun fichier choisi.'));
  barre.append(etat, choisir, champ);
  box.appendChild(barre);

  if (!importRapport) return;

  if (importRapport.erreur) {
    const boite = el('div', 'reg-import__refus');
    boite.append(el('span', 'reg-import__ou', 'Fichier refusé'),
      el('span', 'reg-import__pourquoi', importRapport.erreur));
    box.appendChild(boite);
    return;
  }

  const r = importRapport.resume;
  const resume = el('div', 'reg-import__resume');
  const compte = (n, mot, alerte) => {
    const c = el('span', `reg-import__compte${alerte && n ? ' est-refus' : ''}`);
    c.append(el('b', null, String(n)), el('span', null, ` ${mot}`));
    return c;
  };
  resume.append(compte(r.lues, 'lues'), compte(r.creees, 'à créer'), compte(r.majs, 'à mettre à jour'),
    compte(r.inchangees, 'inchangées'), compte(r.refusees, 'refusées', true));
  // ÉCARTÉES ≠ REFUSÉES. Une ligne écartée n'est pas une erreur : c'est une
  // décision (un rayon traité ailleurs dans le logiciel) ou une ligne
  // d'ouverture de produit qui ne portait aucune valeur. Les confondre ferait
  // lire « 64 refusées » là où il y a onze problèmes et cinquante-trois choix.
  if (r.ecartees) resume.append(compte(r.ecartees, 'écartées'));
  box.appendChild(resume);

  if (importRapport.inconnues && importRapport.inconnues.length) {
    box.appendChild(el('p', 'reg-import__note',
      `Colonnes ignorées (aucun sens connu) : ${importRapport.inconnues.join(', ')}.`));
  }

  const refusees = importRapport.lignes.filter((l) => l.action === 'refus');
  if (refusees.length) renderRefus(box, refusees);
  // Les écartées se disent aussi, et par la même grammaire : une règle qui agit
  // en silence est une règle que personne ne relit.
  const ecartees = importRapport.lignes.filter((l) => l.action === 'ecartee');
  if (ecartees.length) renderRefus(box, ecartees, true);

  // CE QUI VA CHANGER, PRIX PAR PRIX. « 4 mises à jour » ne dit pas si un prix
  // passe de 6 à 6,50 ou de 6 à 600 : ce sont les deux nombres qui le disent.
  const majs = importRapport.lignes.filter((l) => l.action === 'maj');
  for (const l of majs.slice(0, 40)) {
    const row = el('div', 'reg-import__maj');
    row.append(el('span', 'reg-import__quoi', `${l.famille} / ${l.designation}${l.variante ? ` / ${l.variante}` : ''}`));
    const quoi = l.changements.map((c) => {
      const nom = { prixVenteTtc: 'vente', prixAchat: 'achat', tempsMoMin: 'MO', tempsMachineMin: 'machine', reference: 'réf.', actif: 'état' }[c.champ] || c.champ;
      const val = (v) => (c.champ.startsWith('prix') ? euros(v) : String(v == null ? '—' : v));
      return `${nom} ${val(c.avant)} → ${val(c.apres)}`;
    }).join(' · ');
    row.append(el('span', 'reg-import__delta', quoi));
    box.appendChild(row);
  }
  if (majs.length > 40) {
    box.appendChild(el('p', 'reg-import__note', `… et ${majs.length - 40} autres mises à jour.`));
  }

  // CE QU'UNE RÈGLE A DÉPLACÉ. Un produit qui change de rayon en silence, c'est
  // un produit qu'on cherchera au mauvais endroit au comptoir.
  const rangees = importRapport.lignes.filter((l) => l.rangeDepuis);
  if (rangees.length) {
    const paires = [...new Set(rangees.map((l) => `${l.rangeDepuis} → ${l.famille}`))];
    box.appendChild(el('p', 'reg-import__note',
      `${rangees.length} lignes rangées dans un autre rayon : ${paires.join(', ')}.`));
  }
  const nommees = importRapport.lignes.filter((l) => l.varianteNommee).length;
  if (nommees) {
    box.appendChild(el('p', 'reg-import__note',
      `${nommees} variantes nommées par une règle (le fichier ne les nomme pas).`));
  }

  if (importRapport.ecrit) return;   // déjà importé : plus rien à déclencher

  const actions = el('div', 'reg-actions');
  const go = el('button', 'reg-btn reg-btn--primary');
  go.type = 'button';
  go.append(ic('check'), el('span', null, `Importer (${r.creees + r.majs} lignes)`));
  go.disabled = (r.creees + r.majs) === 0;
  go.addEventListener('click', () => appliquerImport(go));
  actions.append(el('span', 'reg-status', 'Rien n’est encore écrit.'), go);
  box.appendChild(actions);
}

function wire() {
  const ta = $('#reg-wa-message');
  ta.addEventListener('input', sync);
  // ⌘/Ctrl + Entrée enregistre sans lâcher le clavier.
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
  });
  ROOT.addEventListener('click', (e) => {
    const jeton = e.target.closest('.reg-jeton');
    if (jeton) return insertToken(jeton.dataset.token);
    if (e.target.closest('#reg-wa-save')) return save();
    if (e.target.closest('#reg-wa-reset')) { ta.value = saved; sync(); flash(''); }
    const remise = e.target.closest('[data-restaurer]');
    if (remise) return restaurer(remise.dataset.restaurer, remise);
  });
}

// Relit la valeur enregistrée. Une saisie EN COURS n'est jamais écrasée : on ne
// fait pas disparaître sous les doigts un texte que le patron est en train
// d'écrire parce qu'un autre poste a rafraîchi la page.
export async function refreshReglages() {
  if (!ROOT) return;
  const ta = $('#reg-wa-message');
  const dirty = ta && ta.value !== saved;
  let messageRelu = false;
  // Les trois lectures sont indépendantes : en série, chaque retour sur
  // l'onglet payait trois temps d'attente réseau bout à bout.
  // La corbeille part dans le MÊME lot : une lecture de plus en série, c'est un
  // temps d'attente de plus à chaque retour sur l'onglet.
  const [resMessage, articles, params] = await Promise.all([
    fetchBorne('/api/settings/whatsapp').catch(() => null),
    api('GET', '/api/tarifs-tasse').catch(() => null),
    api('GET', '/api/tarifs-tasse/parametres').catch(() => null),
    chargerCorbeille(),
    api('GET', '/api/marges').then((d) => { if (d) marges = d; }).catch(() => {}),
    api('GET', '/api/modeles').then((d) => { if (Array.isArray(d)) modeles = d; }).catch(() => {}),
    api('GET', '/api/machines').then((d) => { if (Array.isArray(d)) machines = d; }).catch(() => {}),
    api('GET', '/api/flags').then((d) => { if (d) flags = d; }).catch(() => {}),
    api('GET', '/api/supplements-express').then((d) => { if (d) express = d; }).catch(() => {}),
    api('GET', '/api/catalogue-produits').then((d) => { if (Array.isArray(d)) catalogue = d; }).catch(() => {}),
    api('GET', '/api/tarifs-transport').then((d) => { if (d) transports = d; }).catch(() => {}),
    api('GET', '/api/settings/entreprise').then((d) => { if (d) entreprise = d; }).catch(() => {}),
    api('GET', '/api/settings/textile').then((d) => { if (d) chiffrage = d; }).catch(() => {}),
  ]);
  renderMarges();
  renderExpress();
  renderChiffrage();
  renderTransport();
  renderModeles();
  renderMachines();
  renderFlags();
  renderCatalogue();
  // UN APERÇU EN COURS DE LECTURE N'EST PAS ÉCRASÉ. Revenir sur l'onglet
  // pendant qu'on relit un rapport de 55 refus le ferait disparaître sous les
  // yeux — même règle que le message WhatsApp et l'identité de l'atelier.
  if (!importRapport) renderImport('');
  // UNE SAISIE EN COURS N'EST JAMAIS ÉCRASÉE. Redessiner l'identité pendant que
  // le patron tape son adresse lui reprendrait le champ sous les doigts — le
  // même piège que le message WhatsApp juste en dessous.
  if (!ROOT.contains(document.activeElement) || !document.activeElement.closest('#reg-entreprise')) {
    renderEntreprise();
  }
  // L'état d'un clic précédent ne survit pas à un retour sur l'onglet : ce
  // qu'on relit fait foi.
  try {
    // Sans le contrôle de `res.ok`, une réponse d'erreur (500, 401 derrière le
    // mot de passe) donnait `data.message === undefined` → le textarea se
    // VIDAIT, et le patron croyait son message perdu.
    if (resMessage && resMessage.ok) {
      const data = await resMessage.json();
      if (typeof data.message === 'string') { saved = data.message; messageRelu = true; }
    }
  } catch (_) { /* silencieux : on garde ce qu'on affiche déjà */ }
  if (ta && !dirty && messageRelu) ta.value = saved;
  sync();

  // Un échec laisse ce qui est déjà affiché, comme avant.
  if (Array.isArray(articles)) tarifsArticles = articles;
  if (params && typeof params === 'object') tarifsParams = params;
  if (articles || params) renderTarifs();
}

let mounted = false;
export async function initReglages(root) {
  if (mounted) return;
  ROOT = root;
  mounted = true;
  buildStatic();
  wire();
  await refreshReglages();
}
