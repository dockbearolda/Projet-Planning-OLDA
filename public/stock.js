// STOCK, FOURNISSEURS ET ACHATS (§14 à §18).
//
// Un seul écran pour les trois, parce que ce sont trois moments du même geste :
// on cherche ce qu'on a, on voit qu'il en manque, on le commande. Les séparer en
// trois onglets ferait trois clics pour une seule question.
//
// LA RECHERCHE EST EN HAUT ET ELLE EST LA PORTE D'ENTRÉE : « Le stock textile
// doit permettre une recherche rapide par référence, marque, modèle, couleur,
// taille, fournisseur » (§16). Un seul champ — on ne demande à personne de
// choisir DANS QUOI il cherche.

import { fetchBorne } from './reseau.js';

let ROOT = null;
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const euros = (n) => (Number.isFinite(Number(n)) ? EUROS.format(Number(n)) : '—');

async function api(method, chemin, corps) {
  const res = await fetchBorne(chemin, {
    method,
    headers: corps !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: corps !== undefined ? JSON.stringify(corps) : undefined,
  });
  const texte = await res.text();
  let data = null;
  try { data = texte ? JSON.parse(texte) : null; } catch (_) { data = null; }
  if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
  return data;
}

let recherche = '';
let produits = [];
let fournisseurs = [];
let achats = [];

// --- Stock ---------------------------------------------------------------------
function ligneVariante(v) {
  const l = el('div', 'stk-var');
  const nom = [v.couleur, v.taille].filter(Boolean).join(' · ') || 'Sans déclinaison';
  l.append(el('span', 'stk-var__nom', nom));
  if (v.best_seller) l.append(el('span', 'stk-var__best', 'Best-seller'));

  // TROIS CHIFFRES, ET LE TROISIÈME EST CELUI QU'ON REGARDE. « Il en reste
  // douze » et « il en reste douze mais dix sont pour l'Hôtel Esmeralda » ne
  // mènent pas à la même réponse au client.
  l.append(
    el('span', 'stk-var__n', String(v.stock_reel)),
    el('span', 'stk-var__n stk-var__n--reserve', v.stock_reserve ? `−${v.stock_reserve}` : '—'),
    el('span', `stk-var__n stk-var__dispo${v.disponible <= 0 ? ' is-vide' : ''}`, String(v.disponible)),
  );

  // Ajuster le stock est un mouvement DATÉ ET SIGNÉ, jamais une écriture en
  // place : sans ça, « il en manque trois » n'a aucune réponse.
  const moins = el('button', 'stk-pas', '−');
  const plus = el('button', 'stk-pas', '+');
  moins.type = 'button'; plus.type = 'button';
  moins.title = 'Sortie d’une pièce'; plus.title = 'Entrée d’une pièce';
  moins.addEventListener('click', () => bouger(v.id, -1));
  plus.addEventListener('click', () => bouger(v.id, +1));
  l.append(moins, plus);
  return l;
}

async function bouger(variantId, delta) {
  try {
    await api('POST', `/api/variantes/${variantId}/mouvement`, { delta, motif: 'ajustement' });
    await charger();
  } catch (err) {
    message(err.message, true);
  }
}

function carteProduit(p) {
  const c = el('article', 'stk-produit');
  const tete = el('header', 'stk-produit__tete');
  tete.append(el('span', 'stk-produit__nom', p.designation));
  const meta = [p.ref_interne, p.marque, p.fournisseur, p.famille].filter(Boolean).join(' · ');
  if (meta) tete.append(el('span', 'stk-produit__meta', meta));
  // La valeur du stock est au prix d'ACHAT, et elle n'arrive que pour la
  // Direction (le serveur la retire pour les autres). Absente, on ne l'invente pas.
  if (p.valeur != null) tete.append(el('span', 'stk-produit__valeur', euros(p.valeur)));
  c.append(tete);

  const entete = el('div', 'stk-var stk-var--entete');
  entete.append(
    el('span', 'stk-var__nom', 'Déclinaison'),
    el('span', 'stk-var__n', 'Réel'),
    el('span', 'stk-var__n', 'Réservé'),
    el('span', 'stk-var__n', 'Dispo'),
  );
  c.append(entete);
  for (const v of p.variantes) c.append(ligneVariante(v));
  return c;
}

// --- Achats ----------------------------------------------------------------------
const STATUTS = ['a_commander', 'commande', 'expedie', 'transit', 'metropole', 'recu', 'controle'];
const LABELS = {
  a_commander: 'À commander', commande: 'Commandé', expedie: 'Expédié',
  transit: 'En transit', metropole: 'En métropole', recu: 'Reçu', controle: 'Contrôlé',
};

function ligneAchat(o) {
  const l = el('div', 'stk-achat');
  l.append(
    el('span', 'stk-achat__num', o.numero || 'Sans numéro'),
    el('span', 'stk-achat__qui', o.fournisseur || 'Fournisseur non désigné'),
    el('span', 'stk-achat__n', `${o.nb_lignes} ligne${o.nb_lignes > 1 ? 's' : ''}`),
  );
  // LE TRANSPORT EST UNE INFORMATION DE DÉLAI, pas un détail : à Saint-Martin,
  // aérien ou maritime, c'est trois jours ou six semaines.
  if (o.transport) l.append(el('span', 'stk-achat__transport', o.transport === 'aerien' ? 'Aérien' : 'Maritime'));

  const choix = el('select', 'stk-statut');
  for (const s of STATUTS) {
    const opt = new Option(LABELS[s], s);
    if (s === o.statut) opt.selected = true;
    choix.append(opt);
  }
  choix.addEventListener('change', async () => {
    try { await api('PATCH', `/api/achats/${o.id}`, { statut: choix.value }); await charger(); }
    catch (err) { message(err.message, true); }
  });
  l.append(choix);
  return l;
}

// --- Créer ----------------------------------------------------------------------
// LE FORMULAIRE EST REPLIÉ, PAS ABSENT. Déplié en permanence, il pousserait les
// listes hors de l'écran pour un geste qu'on fait une fois par mois ; caché
// derrière un autre écran, on ne le trouverait pas. Il s'ouvre sur place.
function enTete(titre, libelleBouton, onClic) {
  const h = el('header', 'stk-tete');
  h.append(el('h2', 'stk-bloc__titre', titre));
  const b = el('button', 'stk-ajout', libelleBouton);
  b.type = 'button';
  b.addEventListener('click', onClic);
  h.append(b);
  return h;
}

function ouvrirFormulaire(quoi) {
  const f = ROOT.querySelector(`#stk-form-${quoi}`);
  if (!f) return;
  f.hidden = !f.hidden;
  if (!f.hidden) { const p = f.querySelector('input, select'); if (p) p.focus(); }
}

function champ(nom, placeholder, type = 'text') {
  const i = el('input', 'stk-champ');
  i.type = type;
  i.name = nom;
  i.placeholder = placeholder;
  i.setAttribute('aria-label', placeholder);
  return i;
}

// Un formulaire = une rangée de champs et UN bouton qui engage, tout à droite.
// C'est la règle déjà posée ailleurs : l'action qui valide est le dernier
// élément de la rangée, jamais au milieu.
function formulaire(id, champs, libelle, onEnvoi) {
  const f = el('form', 'stk-form');
  f.id = `stk-form-${id}`;
  f.hidden = true;
  for (const c of champs) f.append(c);
  const ok = el('button', 'stk-ajout stk-ajout--plein', libelle);
  ok.type = 'submit';
  f.append(ok);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    ok.disabled = true;
    try {
      await onEnvoi(Object.fromEntries(new FormData(f).entries()));
      f.reset();
      f.hidden = true;
      await charger();
      message('Enregistré');
    } catch (err) {
      message(err.message, true);
    }
    ok.disabled = false;
  });
  return f;
}

function formulaireFournisseur() {
  const transport = el('select', 'stk-champ');
  transport.name = 'transport';
  transport.setAttribute('aria-label', 'Transport');
  transport.append(new Option('Transport…', ''), new Option('Aérien', 'aerien'), new Option('Maritime', 'maritime'));
  return formulaire('fournisseur', [
    champ('nom', 'Nom du fournisseur'),
    champ('contact', 'Contact'),
    champ('email', 'Email', 'email'),
    champ('telephone', 'Téléphone', 'tel'),
    champ('delai_jours', 'Délai (j)', 'number'),
    transport,
  ], 'Créer', (v) => api('POST', '/api/fournisseurs', v));
}

function formulaireAchat() {
  const qui = el('select', 'stk-champ');
  qui.name = 'supplier_id';
  qui.id = 'stk-achat-fournisseur';
  qui.setAttribute('aria-label', 'Fournisseur');
  const transport = el('select', 'stk-champ');
  transport.name = 'transport';
  transport.setAttribute('aria-label', 'Transport');
  transport.append(new Option('Transport…', ''), new Option('Aérien', 'aerien'), new Option('Maritime', 'maritime'));
  return formulaire('achat', [
    champ('numero', 'Numéro'),
    qui,
    transport,
  ], 'Créer', (v) => api('POST', '/api/achats', v));
}

// --- Rendu ------------------------------------------------------------------------
let $message = null;
function message(texte, erreur) {
  if (!$message) return;
  $message.textContent = texte || '';
  $message.classList.toggle('is-ko', !!erreur);
}

function render() {
  const page = el('div', 'stk-page');
  page.append(el('h1', 'stk-titre', 'Stock'));

  const barre = el('div', 'stk-barre');
  const champ = el('input', 'stk-cherche');
  champ.type = 'search';
  champ.placeholder = 'Référence, marque, modèle, couleur, taille, fournisseur…';
  champ.value = recherche;
  champ.setAttribute('aria-label', 'Rechercher dans le stock');
  // À LA FRAPPE, mais AMORTI : une requête par touche ferait dix appels pour
  // « casquette ». 250 ms, c'est le temps d'une hésitation.
  let minuteur = null;
  champ.addEventListener('input', () => {
    recherche = champ.value;
    clearTimeout(minuteur);
    minuteur = setTimeout(() => chargerProduits().then(rendreListe), 250);
  });
  $message = el('span', 'stk-message', '');
  $message.setAttribute('role', 'status');
  barre.append(champ, $message);
  page.append(barre);

  const liste = el('div', 'stk-liste');
  liste.id = 'stk-liste';
  page.append(liste);

  // FOURNISSEURS et ACHATS suivent, sur le même écran : ce sont trois moments
  // du même geste — on cherche, on voit qu'il en manque, on commande.
  const blocF = el('section', 'stk-bloc');
  blocF.append(enTete('Fournisseurs', 'Nouveau fournisseur', () => ouvrirFormulaire('fournisseur')));
  const listeF = el('div', 'stk-fournisseurs');
  listeF.id = 'stk-fournisseurs';
  blocF.append(formulaireFournisseur(), listeF);
  page.append(blocF);

  const blocA = el('section', 'stk-bloc');
  blocA.append(enTete('Commandes fournisseur', 'Nouvelle commande', () => ouvrirFormulaire('achat')));
  const listeA = el('div', 'stk-achats');
  listeA.id = 'stk-achats';
  blocA.append(formulaireAchat(), listeA);
  page.append(blocA);

  ROOT.replaceChildren(page);
  rendreListe();
}

function rendreListe() {
  const liste = ROOT.querySelector('#stk-liste');
  if (liste) {
    liste.replaceChildren(...(produits.length
      ? produits.map(carteProduit)
      : [el('p', 'stk-vide', recherche
        ? 'Rien ne correspond. Le produit n’est peut-être pas encore au catalogue — ça ne doit jamais bloquer une vente.'
        : 'Le catalogue est vide.')]));
  }
  const lf = ROOT.querySelector('#stk-fournisseurs');
  if (lf) {
    lf.replaceChildren(...(fournisseurs.length ? fournisseurs.map((f) => {
      const l = el('div', 'stk-fourn');
      l.append(el('span', 'stk-fourn__nom', f.nom));
      const d = [f.contact, f.email, f.telephone].filter(Boolean).join(' · ');
      if (d) l.append(el('span', 'stk-fourn__meta', d));
      if (f.delai_jours != null) l.append(el('span', 'stk-fourn__delai', `${f.delai_jours} j`));
      if (f.transport) l.append(el('span', 'stk-fourn__transport', f.transport === 'aerien' ? 'Aérien' : 'Maritime'));
      return l;
    }) : [el('p', 'stk-vide', 'Aucun fournisseur enregistré.')]));
  }
  // Le choix de fournisseur du formulaire d'achat se remplit de la liste qu'on
  // vient de charger : proposer un menu vide serait proposer une impasse.
  const qui = ROOT.querySelector('#stk-achat-fournisseur');
  if (qui) {
    const garde = qui.value;
    qui.replaceChildren(new Option('Fournisseur…', ''));
    for (const f of fournisseurs) qui.append(new Option(f.nom, f.id));
    qui.value = garde;
  }
  const la = ROOT.querySelector('#stk-achats');
  if (la) {
    la.replaceChildren(...(achats.length ? achats.map(ligneAchat)
      : [el('p', 'stk-vide', 'Aucune commande fournisseur en cours.')]));
  }
}

async function chargerProduits() {
  try {
    produits = await api('GET', `/api/produits${recherche ? `?q=${encodeURIComponent(recherche)}` : ''}`);
  } catch (_) {
    produits = [];
  }
}

async function charger() {
  // Les trois lectures sont indépendantes : en série, chaque passage sur
  // l'écran paierait trois temps d'attente bout à bout.
  const [f, a] = await Promise.all([
    api('GET', '/api/fournisseurs').catch(() => []),
    api('GET', '/api/achats').catch(() => []),
    chargerProduits(),
  ]);
  fournisseurs = Array.isArray(f) ? f : [];
  achats = Array.isArray(a) ? a : [];
  rendreListe();
}

// LA RECHERCHE GLOBALE MÈNE ICI AUSSI. Même raison : arriver sur le catalogue
// entier en devant retaper la référence qu'on vient de taper serait une demi-
// réponse.
window.addEventListener('olda:chercher-produit', (e) => {
  const champ = ROOT && ROOT.querySelector('.stk-cherche');
  if (!champ) return;
  recherche = e.detail || '';
  champ.value = recherche;
  chargerProduits().then(rendreListe);
  champ.focus();
});

let monte = false;
export async function initStock(root) {
  ROOT = root;
  if (!monte) { monte = true; render(); }
  return charger();
}
export const refreshStock = () => charger();
