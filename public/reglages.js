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
import { fetchBorne } from './reseau.js';

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

async function api(method, path, body) {
  const res = await fetchBorne(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  // Le statut AVANT le corps : une page d'erreur du proxy (HTML) faisait échouer
  // l'analyse JSON d'abord, et l'écran affichait « Unexpected token < » au lieu
  // de « Erreur 502 ».
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
  return data;
}

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

  const head = el('header', 'reg-head');
  head.append(
    ic('settings', 'reg-head__ic'),
    (() => {
      const t = el('div', 'reg-head__titles');
      t.append(el('h2', 'reg-head__title', 'Réglages'),
        el('p', 'reg-head__sub', 'Ce que vous réglez ici vaut pour tous les postes de l’atelier.'));
      return t;
    })(),
  );
  page.appendChild(head);

  // --- Carte « message WhatsApp » -------------------------------------------
  const card = el('section', 'reg-card');
  const ch = el('header', 'reg-card__head');
  ch.append(ic('chat', 'reg-card__ic'),
    (() => {
      const t = el('div');
      t.append(el('h3', 'reg-card__title', 'Message WhatsApp « commande prête »'),
        el('p', 'reg-card__desc',
          'Sur le planning, chaque commande dont le client a laissé un numéro porte '
          + 'une pastille WhatsApp. Un clic ouvre la conversation avec CE message déjà '
          + 'écrit — vous relisez, vous appuyez sur Envoyer. Rien ne part tout seul.'));
      return t;
    })());
  card.appendChild(ch);

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

  // --- Carte « Tarifs tasse » -------------------------------------------------
  const tcard = el('section', 'reg-card');
  const tch = el('header', 'reg-card__head');
  tch.append(ic('local_cafe', 'reg-card__ic'),
    (() => {
      const t = el('div');
      t.append(el('h3', 'reg-card__title', 'Tarifs — Tasse'),
        el('p', 'reg-card__desc',
          'Les prix et temps utilisés par Nouveau Projet pour calculer le total TTC '
          + 'd’une tasse personnalisée. Chaque changement est immédiat pour tous les postes.'));
      return t;
    })());
  tcard.appendChild(tch);
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

  // --- Carte « Fonctions en cours » --------------------------------------------
  page.appendChild(carteSimple('settings', 'Fonctions en cours',
    'Les chantiers livrés mais pas encore allumés. Éteints, l’application se '
    + 'comporte exactement comme avant. Allumer « Connexion nominative » demandera '
    + 'à chacun de choisir son prénom et son code au prochain chargement.', 'reg-flags'));

  // --- Carte « Corbeille » ----------------------------------------------------
  // Une commande retirée du planning n'est plus détruite : elle attend ici.
  // Sans cette carte, l'archivage serait invisible — donc, pour l'employé qui
  // s'est trompé de ligne, exactement aussi définitif qu'une suppression.
  const ccard = el('section', 'reg-card');
  const cch = el('header', 'reg-card__head');
  cch.append(ic('delete', 'reg-card__ic'),
    (() => {
      const t = el('div');
      t.append(el('h3', 'reg-card__title', 'Corbeille'),
        el('p', 'reg-card__desc',
          'Les commandes retirées du planning. Rien n’est effacé : elles gardent leur '
          + 'prix, leurs documents et tout leur historique, et reviennent d’un clic à '
          + 'l’étape où elles étaient.'));
      return t;
    })());
  ccard.appendChild(cch);
  const corbList = el('div', 'reg-corbeille');
  corbList.id = 'reg-corbeille';
  ccard.appendChild(corbList);
  page.appendChild(ccard);

  ROOT.replaceChildren(page);
}

// Une carte de réglage = un en-tête + un conteneur que le rendu remplit. Les
// deux premières cartes (WhatsApp, Tarifs) sont écrites à la main parce qu'elles
// portent des contrôles particuliers ; celles-ci se ressemblent toutes.
function carteSimple(icone, titre, desc, idContenu) {
  const card = el('section', 'reg-card');
  const head = el('header', 'reg-card__head');
  head.append(ic(icone, 'reg-card__ic'), (() => {
    const t = el('div');
    t.append(el('h3', 'reg-card__title', titre), el('p', 'reg-card__desc', desc));
    return t;
  })());
  card.appendChild(head);
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
    el('span', 'reg-corb__nom', r.billing_company || 'Sans client'),
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
  ]);
  renderMarges();
  renderExpress();
  renderModeles();
  renderMachines();
  renderFlags();
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
