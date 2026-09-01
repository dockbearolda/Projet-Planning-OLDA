// ===========================================================================
// L'ÉCRAN DU DEVIS — on saisit à gauche, le papier se fait à droite
// ===========================================================================
// C'EST L'ÉCRAN DU PATRON, RENTRÉ DANS LE CRM (01/09/2026). Il l'avait écrit
// d'un bloc, avec sa propre échelle, ses propres boîtes, sa propre base
// clients (trois noms en dur) et son propre document. Ce qui est repris, c'est
// ce qui lui appartient — le PARCOURS (client, projet, délai, articles,
// fiscalité), la coupe en deux moitiés, et les textes commerciaux du délai et
// du BAT, mot pour mot. Ce qui tombe, c'est tout ce que l'application faisait
// déjà :
//
//   · les CLIENTS viennent de la base (`/api/clients`), pas d'un tableau ;
//   · les ARTICLES se piochent dans le catalogue produits, qui vit en base
//     depuis le 01/09 et se tarife par import ;
//   · l'IDENTITÉ DE LA MAISON et les coordonnées bancaires sont un RÉGLAGE :
//     un déménagement ne demande pas un déploiement ;
//   · le TAUX DE TGCA est celui des Réglages, pas un 0,04 recopié ;
//   · le TARIF DE TRANSPORT est celui des Réglages ;
//   · le NUMÉRO vient du compteur du serveur — deux postes qui impriment en
//     même temps ne peuvent pas remettre le même numéro à deux clients ;
//   · le DEVIS S'ENREGISTRE AU PLANNING, à « Tarif / Devis envoyé — Attente
//     client » : sans ça, un devis imprimé n'existe nulle part et personne ne
//     le relance.
//
// LE PAPIER EST DANS `devis.js`, avec les deux autres. Cet écran ne dessine
// aucun document : il appelle `dessinerDevis`, exactement comme le fera le
// cadre d'impression. L'aperçu ne peut donc pas dériver de ce qui sort.
//
// AUCUN COMPOSANT NEUF. La carte et le bouton viennent de `reglages.css`, le
// champ de `fiche-atelier.css` (`.fa-case` / `.fa-lab` / `.fa-in`, la grammaire
// du comptoir), l'en-tête et la pilule de recherche de `charte.css`. Ce qui
// reste dans `devis-flash.css`, c'est la coupe en deux et la rangée d'article.

import {
  APPROS, APPRO_DEFAUT, ACOMPTES, ARRONDIS, REGIMES,
  calculerDevis, modeleDevis, dessinerDevis, CSS_DEVIS, jourAtelier, jourPlus,
} from './devis.js';

let ROOT = null;
const $ = (sel) => ROOT && ROOT.querySelector(sel);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};
// La fabrique d'icônes de l'écran. Tout nom posé ici doit figurer dans
// `olda-icones.woff2` (91 glyphes) : un nom absent ne lève RIEN, le navigateur
// garde le texte et la boîte le coupe à la première lettre.
const ic = (nom) => {
  const n = el('span', 'material-symbols-outlined', nom);
  n.setAttribute('aria-hidden', 'true');
  return n;
};

const EURO = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const euro = (n) => EURO.format(Number(n) || 0);

async function api(method, chemin, corps) {
  const r = await fetch(chemin, {
    method,
    headers: corps ? { 'Content-Type': 'application/json' } : undefined,
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const t = await r.text();
  let d = null;
  try { d = t ? JSON.parse(t) : null; } catch (_) { d = null; }
  if (!r.ok) throw new Error((d && (d.error || d.erreur)) || `${method} ${chemin} : ${r.status}`);
  return d;
}

// ===========================================================================
// CE QUE L'ÉCRAN TIENT
// ===========================================================================
// UNE SEULE SOURCE, ET ELLE EST PLATE. Le formulaire écrit dedans, le calcul le
// lit, le papier le lit. Rien n'est recopié d'une moitié à l'autre : c'est ce
// qui garantit que la feuille dit exactement ce que l'écran affiche.
const VALIDITE_JOURS = 30;

function saisieNeuve() {
  const jour = jourAtelier();
  return {
    numero: '',
    date: jour,
    validite: jourPlus(jour, VALIDITE_JOURS),
    projet: '',
    dueDate: '',
    client: { nom: '', code: '', ville: '', contact: '', tel: '', email: '', type: 'pro' },
    appro: APPRO_DEFAUT,
    lignes: [],
    regime: 'tgca',
    tauxTgca: 0.04,
    acompte: 50,
    arrondi: 'euro',
  };
}

let saisie = saisieNeuve();
let clients = [];
let catalogue = [];
let entreprise = {};
let transports = {};
// Un devis DÉJÀ enregistré ne se réenregistre pas en double : on garde son id.
let dossierId = null;

// LE BROUILLON EST PAR APPAREIL. Un devis se compose devant le client, en
// quelques minutes, et un poste qui se ferme au milieu ne doit pas faire tout
// retaper. Il ne remplace pas l'enregistrement : tant qu'on n'a pas cliqué
// « Enregistrer au planning », ce devis n'existe que sur cette machine, et
// l'écran le DIT.
const CLE_BROUILLON = 'olda.devis.brouillon';
function garderBrouillon() {
  try { localStorage.setItem(CLE_BROUILLON, JSON.stringify({ saisie, dossierId })); } catch (_) { /* plein ou refusé */ }
}
function relireBrouillon() {
  try {
    const brut = localStorage.getItem(CLE_BROUILLON);
    if (!brut) return;
    const d = JSON.parse(brut);
    if (!d || !d.saisie || typeof d.saisie !== 'object') return;
    saisie = { ...saisieNeuve(), ...d.saisie, client: { ...saisieNeuve().client, ...(d.saisie.client || {}) } };
    saisie.lignes = Array.isArray(d.saisie.lignes) ? d.saisie.lignes : [];
    dossierId = d.dossierId || null;
  } catch (_) { /* un brouillon illisible vaut pas de brouillon */ }
}

// ===========================================================================
// LE SQUELETTE — posé UNE fois
// ===========================================================================
// ON NE RECONSTRUIT PAS UN CHAMP SOUS LES DOIGTS. Redessiner le formulaire à
// chaque frappe reprend le curseur à qui écrit, et c'est une saisie perdue par
// ligne. Le squelette est donc pose une fois ; seuls les TOTAUX et la FEUILLE
// se redessinent, et ni l'un ni l'autre ne porte de curseur.
function carte(icone, titre, aide) {
  const c = el('section', 'reg-card');
  const t = el('div', 'reg-card__head');
  t.append(ic(icone));
  t.firstChild.classList.add('reg-card__ic');
  const bloc = el('div');
  bloc.append(el('h2', 'reg-card__title', titre));
  if (aide) bloc.append(el('p', 'reg-card__desc', aide));
  t.append(bloc);
  c.append(t);
  return c;
}

// UN CHAMP, ET C'EST CELUI DU COMPTOIR : intitulé au-dessus, boîte toujours
// visible. Une seule fabrique — écrit à la main quinze fois, il finirait par
// exister en quinze versions.
function champ(nom, noeud) {
  const c = el('div', 'fa-case');
  const lab = el('label', 'fa-lab', nom);
  const boite = el('div', 'fa-case__v');
  boite.append(noeud);
  if (noeud.id) lab.setAttribute('for', noeud.id);
  c.append(lab, boite);
  return c;
}

function entree(id, { type = 'text', valeur = '', exemple = '', classe = '' } = {}) {
  const n = el('input', `fa-in${classe ? ` ${classe}` : ''}`);
  n.type = type;
  n.id = id;
  n.value = valeur == null ? '' : String(valeur);
  if (exemple) n.placeholder = exemple;
  if (type === 'number') { n.min = '0'; n.inputMode = 'decimal'; }
  n.autocomplete = 'off';
  return n;
}

function menu(id, options, valeur) {
  const n = el('select', 'fa-in');
  n.id = id;
  for (const o of options) {
    const opt = el('option', null, o.label);
    opt.value = String(o.id);
    n.append(opt);
  }
  n.value = String(valeur);
  return n;
}

// ===========================================================================
// LE MONTAGE
// ===========================================================================
export async function initDevisFlash(root) {
  ROOT = root;
  root.classList.add('devis-flash');
  poserStyleDevis();
  relireBrouillon();
  batir();
  // Les quatre réglages que l'écran lit. Aucun n'est bloquant : un devis se
  // compose même si le catalogue tarde, il porte seulement moins de raccourcis.
  await rechargerReglages();
  poserLignes();
  redessiner();
}

export async function refreshDevisFlash() {
  if (!ROOT) return;
  await rechargerReglages();
  redessiner();
}

async function rechargerReglages() {
  const [cl, cat, ent, par, tr] = await Promise.all([
    api('GET', '/api/clients').catch(() => []),
    api('GET', '/api/catalogue-produits').catch(() => []),
    api('GET', '/api/settings/entreprise').catch(() => ({})),
    api('GET', '/api/tarifs-tasse/parametres').catch(() => null),
    api('GET', '/api/tarifs-transport').catch(() => ({})),
  ]);
  clients = Array.isArray(cl) ? cl : [];
  catalogue = Array.isArray(cat) ? cat : [];
  entreprise = ent && typeof ent === 'object' ? ent : {};
  transports = tr && typeof tr === 'object' ? tr : {};
  if (par && Number.isFinite(Number(par.tgca))) saisie.tauxTgca = Number(par.tgca);
  remplirCatalogue();
}

function batir() {
  ROOT.replaceChildren();

  // --- L'en-tête, celui de la charte, commun aux huit écrans ---
  const tete = el('header', 'ecran-tete');
  const g = el('div', 'ecran-tete__gauche');
  const titres = el('div', 'ecran-tete__titres');
  titres.append(el('h1', 'ecran-tete__titre', 'Devis'));
  g.append(titres);
  const compte = el('span', 'ecran-tete__compte');
  compte.id = 'dvf-compte';
  g.append(compte);
  const d = el('div', 'ecran-tete__droite');
  const bNeuf = el('button', 'reg-btn', 'Nouveau devis');
  bNeuf.type = 'button';
  bNeuf.id = 'dvf-neuf';
  const bImp = el('button', 'reg-btn', 'Imprimer / PDF');
  bImp.type = 'button';
  bImp.id = 'dvf-imprimer';
  const bSave = el('button', 'reg-btn reg-btn--primary', 'Enregistrer au planning');
  bSave.type = 'button';
  bSave.id = 'dvf-enregistrer';
  d.append(bNeuf, bImp, bSave);
  tete.append(g, d);
  ROOT.append(tete);

  const deux = el('div', 'dvf-deux');
  const saisieCol = el('div', 'dvf-saisie');
  const apercu = el('div', 'dvf-apercu');
  deux.append(saisieCol, apercu);
  ROOT.append(deux);

  saisieCol.append(carteClient(), carteProjet(), carteArticles(), carteArgent());

  const cadre = el('div', 'dvf-cadre');
  const feuille = el('div', 'dvf-feuille');
  feuille.id = 'dvf-feuille';
  cadre.append(feuille);
  apercu.append(cadre);

  bNeuf.addEventListener('click', repartirDeZero);
  bImp.addEventListener('click', imprimer);
  bSave.addEventListener('click', enregistrer);

  // LA FEUILLE GARDE SES PROPORTIONS quelle que soit la largeur de sa moitié :
  // on la met à l'échelle plutôt que de la rogner — rogner montrerait autre
  // chose que ce qui sortira de l'imprimante.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(mettreALEchelle).observe(apercu);
  }
}

// LA FEUILLE DE STYLE DU PAPIER EST POSÉE DANS LA PAGE, une seule fois. C'est
// EXACTEMENT la chaîne que reçoit le cadre d'impression (voir `imprimer`) :
// recopiée dans `devis-flash.css`, elle aurait donné un aperçu qui dérive de ce
// qui sort de l'imprimante — et on ne s'en apercevrait qu'une fois le papier
// remis au client. Elle n'est pas dans une feuille non plus parce qu'elle ne
// doit PAS lire la charte : le cadre d'impression ne la charge pas.
function poserStyleDevis() {
  if (document.getElementById('dv-style')) return;
  const s = document.createElement('style');
  s.id = 'dv-style';
  s.textContent = CSS_DEVIS;
  document.head.appendChild(s);
}

// 210 mm à 96 points par pouce. C'est la largeur que la feuille fait par
// construction (voir CSS_DEVIS) : le facteur d'échelle en sort, il ne se règle
// pas à la main.
const LARGEUR_A4 = 794;
function mettreALEchelle() {
  const cadre = $('.dvf-cadre');
  const feuille = $('#dvf-feuille');
  if (!cadre || !feuille) return;
  const dispo = cadre.clientWidth;
  if (!dispo) return;
  const k = Math.min(1, dispo / LARGEUR_A4);
  feuille.style.setProperty('--dvf-echelle', String(k));
  // `transform` ne réserve aucune place : sans cette hauteur rendue au
  // conteneur, la moitié droite ne défilerait pas jusqu'au bas de la feuille.
  const h = feuille.firstElementChild ? feuille.firstElementChild.offsetHeight : 0;
  cadre.style.height = h ? `${Math.ceil(h * k)}px` : '';
}

// ===========================================================================
// CARTE 1 — LE CLIENT
// ===========================================================================
// LA RECHERCHE TAPE DANS LA BASE, pas dans un tableau écrit en dur. Un client
// choisi remplit les quatre champs ; un client inconnu se tape à la main et
// entre en base à l'enregistrement — c'est la règle de tous les parcours.
function carteClient() {
  const c = carte('contacts', 'Client',
    'Cherche dans la base clients. Un client inconnu se saisit ici et entre en base '
    + 'quand le devis part au planning.');

  const cherche = el('div', 'dvf-cherche');
  const pilule = el('div', 'champ-recherche');
  const loupe = ic('search');
  loupe.classList.add('grid-search-ic');
  const champCh = el('input', 'grid-search-input');
  champCh.type = 'text';
  champCh.id = 'dvf-cherche';
  champCh.placeholder = 'Nom, société, ville, téléphone ou e-mail…';
  champCh.autocomplete = 'off';
  champCh.setAttribute('aria-label', 'Chercher un client');
  pilule.append(loupe, champCh);
  const props = el('div', 'dvf-props');
  props.id = 'dvf-props';
  props.hidden = true;
  cherche.append(pilule, props);
  c.append(cherche);

  const r2 = el('div', 'dvf-r2');
  const nom = entree('dvf-cl-nom', { valeur: saisie.client.nom, exemple: 'Nom ou société' });
  const code = entree('dvf-cl-code', { valeur: saisie.client.code, exemple: 'ALO' });
  const ville = entree('dvf-cl-ville', { valeur: saisie.client.ville, exemple: '97150 Saint-Martin' });
  const email = entree('dvf-cl-email', { type: 'email', valeur: saisie.client.email, exemple: 'facultatif' });
  r2.append(champ('Client / société', nom), champ('Code client', code),
    champ('Ville', ville), champ('E-mail', email));
  c.append(r2);

  const r3 = el('div', 'dvf-r3');
  const contact = entree('dvf-cl-contact', { valeur: saisie.client.contact, exemple: 'facultatif' });
  const tel = entree('dvf-cl-tel', { type: 'tel', valeur: saisie.client.tel, exemple: 'facultatif' });
  const type = menu('dvf-cl-type', [
    { id: 'professionnel', label: 'Professionnel' }, { id: 'particulier', label: 'Particulier' },
    { id: 'association', label: 'Association' }, { id: 'revendeur', label: 'Revendeur' },
  ], saisie.client.type === 'perso' ? 'particulier' : 'professionnel');
  r3.append(champ('Personne à contacter', contact), champ('Téléphone', tel), champ('Type', type));
  c.append(r3);

  for (const [n, cle] of [[nom, 'nom'], [code, 'code'], [ville, 'ville'],
    [email, 'email'], [contact, 'contact'], [tel, 'tel']]) {
    n.addEventListener('input', () => { saisie.client[cle] = n.value; redessiner(); });
  }
  type.addEventListener('change', () => {
    saisie.client.type = type.value === 'particulier' ? 'perso' : type.value;
    redessiner();
  });

  champCh.addEventListener('input', () => proposer(champCh.value));
  // ÉCHAP FERME LA LISTE, PAS L'ÉCRAN. Sans ça, la touche remonte au planning
  // et on perd le devis en cours.
  champCh.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !props.hidden) { e.stopPropagation(); fermerPropositions(); }
  });
  document.addEventListener('click', (e) => {
    if (!cherche.contains(e.target)) fermerPropositions();
  });
  return c;
}

function fermerPropositions() {
  const props = $('#dvf-props');
  if (props) { props.hidden = true; props.replaceChildren(); }
}

function proposer(texte) {
  const props = $('#dvf-props');
  if (!props) return;
  const q = String(texte || '').trim().toLowerCase();
  if (q.length < 2) return fermerPropositions();
  const trouves = clients.filter((cl) => [cl.entreprise, cl.nom, cl.prenom, cl.code, cl.ville,
    cl.telephone, cl.email].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 20);
  props.replaceChildren();
  if (!trouves.length) {
    const rien = el('div', 'dvf-prop');
    rien.append(el('span', 'dvf-prop__qui', 'Aucun client de ce nom — saisis-le ci-dessous, il entrera en base'));
    props.append(rien);
    props.hidden = false;
    return;
  }
  for (const cl of trouves) {
    const b = el('button', 'dvf-prop');
    b.type = 'button';
    b.append(el('span', 'dvf-prop__qui', cl.entreprise || ''),
      el('span', 'dvf-prop__ou', [cl.code, cl.ville].filter(Boolean).join(' · ')));
    b.addEventListener('click', () => { prendreClient(cl); fermerPropositions(); });
    props.append(b);
  }
  props.hidden = false;
}

function prendreClient(cl) {
  saisie.client = {
    nom: cl.entreprise || '',
    code: cl.code || '',
    ville: cl.ville || '',
    contact: cl.nom || '',
    tel: cl.telephone || '',
    email: cl.email || '',
    type: cl.type === 'perso' ? 'perso' : 'pro',
  };
  for (const [id, v] of [['#dvf-cl-nom', saisie.client.nom], ['#dvf-cl-code', saisie.client.code],
    ['#dvf-cl-ville', saisie.client.ville], ['#dvf-cl-email', saisie.client.email],
    ['#dvf-cl-contact', saisie.client.contact], ['#dvf-cl-tel', saisie.client.tel]]) {
    const n = $(id);
    if (n) n.value = v;
  }
  const t = $('#dvf-cl-type');
  if (t) t.value = saisie.client.type === 'perso' ? 'particulier' : 'professionnel';
  const ch = $('#dvf-cherche');
  if (ch) ch.value = saisie.client.nom;
  redessiner();
}

// ===========================================================================
// CARTE 2 — LE PROJET ET CE QU'ON PEUT PROMETTRE
// ===========================================================================
function carteProjet() {
  const c = carte('event', 'Projet et délai',
    'La date demandée par le client reste indicative tant que l’acompte, le BAT et '
    + 'l’approvisionnement ne sont pas sécurisés.');

  const rA = el('div', 'dvf-r2');
  const projet = entree('dvf-projet', { valeur: saisie.projet, exemple: 'STAFF, Terrasse, Rentrée…' });
  const appro = menu('dvf-appro', APPROS, saisie.appro);
  rA.append(champ('Nom du projet', projet), champ('Approvisionnement', appro));
  c.append(rA);

  const rB = el('div', 'dvf-r2');
  const due = entree('dvf-due', { type: 'date', valeur: saisie.dueDate });
  const val = entree('dvf-validite', { type: 'date', valeur: saisie.validite });
  rB.append(champ('Date souhaitée client', due), champ('Validité du devis', val));
  c.append(rB);

  // L'ÉTAT DU DÉLAI N'EST PAS UN CHAMP : c'est ce que l'approvisionnement choisi
  // ENTRAÎNE, et c'est une phrase. Posé dans une demi-colonne comme s'il se
  // remplissait, il montait à 117 px de haut — quatre lignes — à côté d'un menu
  // de 50 (mesuré à 1280 px, le plus petit poste). Il prend donc toute la
  // largeur de sa carte, où il tient sur une ligne, et il ne prétend plus être
  // une commande.
  const etat = el('div', 'dvf-etat');
  etat.id = 'dvf-etat';
  c.append(etat);

  projet.addEventListener('input', () => { saisie.projet = projet.value; redessiner(); });
  due.addEventListener('change', () => { saisie.dueDate = due.value; redessiner(); });
  val.addEventListener('change', () => { saisie.validite = val.value; redessiner(); });
  appro.addEventListener('change', () => { saisie.appro = appro.value; redessiner(); });
  return c;
}

// ===========================================================================
// CARTE 3 — LES ARTICLES
// ===========================================================================
function carteArticles() {
  const c = carte('local_grocery_store', 'Articles',
    'Pioche dans le catalogue produits, ou saisis une ligne libre. Les prix sont HT : '
    + 'le devis est le seul document de la maison qui les affiche ainsi.');

  const liste = el('div', 'dvf-liste');
  liste.id = 'dvf-liste';
  c.append(liste);

  const barre = el('div', 'reg-actions');
  const depuis = el('select', 'reg-tarif-input reg-tarif-input--nom');
  depuis.id = 'dvf-catalogue';
  depuis.setAttribute('aria-label', 'Ajouter un article du catalogue');
  const bLibre = el('button', 'reg-btn', 'Ligne libre');
  bLibre.type = 'button';
  const bTransport = el('button', 'reg-btn', 'Transport');
  bTransport.type = 'button';
  bTransport.id = 'dvf-transport';
  barre.append(depuis, bLibre, bTransport);
  c.append(barre);

  const aide = el('p', 'dvf-aide');
  aide.id = 'dvf-aide-cat';
  c.append(aide);

  depuis.addEventListener('change', () => {
    const i = Number(depuis.value);
    if (Number.isInteger(i) && catalogue[i]) ajouterDuCatalogue(catalogue[i]);
    depuis.value = '';
  });
  bLibre.addEventListener('click', () => ajouterLigne({}));
  bTransport.addEventListener('click', ajouterTransport);
  return c;
}

function remplirCatalogue() {
  const sel = $('#dvf-catalogue');
  const aide = $('#dvf-aide-cat');
  if (!sel) return;
  sel.replaceChildren();
  const vide = el('option', null,
    catalogue.length ? 'Ajouter un article du catalogue…' : 'Catalogue injoignable — passe par « Ligne libre »');
  vide.value = '';
  sel.append(vide);
  catalogue.forEach((p, i) => {
    const o = el('option', null, [p.label || p.designation, p.variante].filter(Boolean).join(' — ')
      + (p.prixVenteTtc != null ? ` · ${euro(p.prixVenteTtc)} TTC` : ''));
    o.value = String(i);
    sel.append(o);
  });
  if (!aide) return;
  const tarifes = catalogue.filter((p) => p.prixVenteTtc != null).length;
  // L'ÉCRAN DIT CE QU'IL SAIT. Un catalogue sans prix n'est pas une panne :
  // c'est un import qui n'a pas encore été fait, et le devis se compose quand
  // même — mais il faut le savoir avant de chercher un tarif qui n'existe pas.
  aide.textContent = catalogue.length
    ? `${catalogue.length} produits au catalogue, ${tarifes} tarifés. `
      + 'Un prix de catalogue est TTC : il est converti en HT au taux en vigueur, et reste modifiable.'
    : '';
}

function ajouterDuCatalogue(p) {
  // UN PRIX DE CATALOGUE EST TTC (c'est le prix de rayon). Le devis compte en
  // HT : la conversion se fait ici, au taux du moment, et le montant reste
  // modifiable — le prix affiché sur le devis engage la maison, pas le rayon.
  const ht = p.prixVenteTtc != null && saisie.tauxTgca
    ? Math.round((Number(p.prixVenteTtc) / (1 + saisie.tauxTgca)) * 100) / 100
    : (p.prixVenteTtc != null ? Number(p.prixVenteTtc) : 0);
  ajouterLigne({
    designation: [p.label || p.designation, p.variante].filter(Boolean).join(' — '),
    reference: p.reference || '',
    couleur: p.couleur || '',
    quantite: 1,
    unitaireHt: ht,
  });
}

function ajouterTransport() {
  // LE TARIF DE TRANSPORT EST UN RÉGLAGE, jamais un nombre recopié : il se
  // renégocie, et le jour où il bouge il ne doit bouger qu'à un endroit.
  const noms = Object.keys(transports);
  const nom = noms.find((n) => Number(transports[n]) > 0) || noms[0] || 'Transport';
  const prix = Number(transports[nom]) || 0;
  // Le transport se compte à la pièce : il suit la quantité des articles déjà
  // posés, pas une unité arbitraire.
  const qte = saisie.lignes.reduce((t, l) => t + (Number(l.quantite) || 0), 0) || 1;
  ajouterLigne({
    designation: `Transport ${nom}`,
    note: 'Acheminement à Saint-Martin.',
    quantite: qte,
    unitaireHt: prix,
  });
}

function ajouterLigne(modele) {
  saisie.lignes.push({
    designation: '', reference: '', couleur: '', tailles: '', marquage: '', note: '',
    quantite: 1, unitaireHt: 0, ...modele,
  });
  const hote = $('#dvf-liste');
  if (hote) {
    const vide = hote.querySelector('.dvf-vide');
    if (vide) vide.remove();
    hote.append(rangeeArticle(saisie.lignes[saisie.lignes.length - 1]));
  }
  redessiner();
  // On ouvre la frappe sur la désignation : c'est le premier mot qu'on tape
  // après avoir cliqué « Ligne libre ».
  const dernier = hote && hote.lastElementChild;
  const premier = dernier && dernier.querySelector('input');
  if (premier && !modele.designation) premier.focus();
}

function poserLignes() {
  const hote = $('#dvf-liste');
  if (!hote) return;
  hote.replaceChildren();
  if (!saisie.lignes.length) {
    hote.append(el('div', 'dvf-vide', 'Aucun article. Pioche dans le catalogue, ou ajoute une ligne libre.'));
    return;
  }
  for (const l of saisie.lignes) hote.append(rangeeArticle(l));
}

// UNE RANGÉE SE CONSTRUIT UNE FOIS. Ses champs écrivent dans l'objet de la
// ligne, et rien ne la reconstruit tant qu'on n'a pas supprimé un article :
// une rangée refaite à chaque frappe reprendrait le curseur, et la saisie
// suivante partirait dans le vide.
function rangeeArticle(ligne) {
  const n = Math.random().toString(36).slice(2, 8);
  const bloc = el('div', 'dvf-art');

  const tete = el('div', 'dvf-art__tete');
  const nom = el('span', 'dvf-art__nom');
  const total = el('span', 'dvf-art__total');
  const sup = el('button', 'reg-tarif-del');
  sup.type = 'button';
  sup.setAttribute('aria-label', 'Retirer cet article');
  sup.append(ic('delete'));
  tete.append(nom, total, sup);
  bloc.append(tete);

  // LA DÉSIGNATION PREND SA PROPRE LIGNE. Elle porte une phrase — « T-shirt
  // Unisexe Bio Léger Premium 155 g » — quand tout le reste porte une référence
  // ou deux chiffres. Sur la même rangée qu'eux, elle tombait à 59 px de large
  // au plus petit poste de l'atelier (mesuré à 1280 px).
  const design = entree(`dvf-a-${n}-d`, { valeur: ligne.designation, exemple: 'T-shirt coton bio' });
  bloc.append(champ('Désignation', design));

  const rA = el('div', 'dvf-r3');
  const refe = entree(`dvf-a-${n}-r`, { valeur: ligne.reference, exemple: 'NS300' });
  const qte = entree(`dvf-a-${n}-q`, { type: 'number', valeur: ligne.quantite, classe: 'dvf-nb' });
  const pu = entree(`dvf-a-${n}-p`, { type: 'number', valeur: ligne.unitaireHt, classe: 'dvf-nb' });
  pu.step = '0.01';
  rA.append(champ('Référence', refe), champ('Qté', qte), champ('PU HT', pu));
  bloc.append(rA);

  const r3 = el('div', 'dvf-r3');
  const coul = entree(`dvf-a-${n}-c`, { valeur: ligne.couleur, exemple: 'Light Olive Green' });
  const tail = entree(`dvf-a-${n}-t`, { valeur: ligne.tailles, exemple: '2 × S · 3 × M' });
  // « Marquage » et pas « Personnalisation » : c'est le mot de l'atelier, celui
  // que la fiche de production emploie, et c'est celui qui s'imprime sur le
  // devis. Deux mots pour une chose, c'est une question de plus au comptoir.
  const marq = entree(`dvf-a-${n}-m`, { valeur: ligne.marquage, exemple: 'Cœur + dos' });
  r3.append(champ('Couleur', coul), champ('Tailles', tail), champ('Marquage', marq));
  bloc.append(r3);

  const note = entree(`dvf-a-${n}-n`, { valeur: ligne.note, exemple: 'Précision qui figurera sur le devis' });
  bloc.append(champ('Note du devis', note));

  const rafraichirTete = () => {
    const vide = !String(ligne.designation || '').trim();
    nom.textContent = vide ? 'Article sans désignation' : ligne.designation;
    nom.classList.toggle('dvf-art__vide', vide);
    total.textContent = euro((Number(ligne.quantite) || 0) * (Number(ligne.unitaireHt) || 0));
  };
  for (const [n2, cle] of [[design, 'designation'], [refe, 'reference'], [coul, 'couleur'],
    [tail, 'tailles'], [marq, 'marquage'], [note, 'note']]) {
    n2.addEventListener('input', () => { ligne[cle] = n2.value; rafraichirTete(); redessiner(); });
  }
  for (const [n2, cle] of [[qte, 'quantite'], [pu, 'unitaireHt']]) {
    n2.addEventListener('input', () => {
      ligne[cle] = Math.max(0, Number(n2.value) || 0);
      rafraichirTete();
      redessiner();
    });
  }
  sup.addEventListener('click', () => {
    const i = saisie.lignes.indexOf(ligne);
    if (i >= 0) saisie.lignes.splice(i, 1);
    bloc.remove();
    if (!saisie.lignes.length) poserLignes();
    redessiner();
  });

  rafraichirTete();
  return bloc;
}

// ===========================================================================
// CARTE 4 — FISCALITÉ, ACOMPTE, ARRONDI, ET CE QUE ÇA DONNE
// ===========================================================================
function carteArgent() {
  const c = carte('receipt_long', 'Fiscalité et règlement',
    'Le taux de TGCA vient des Réglages. L’arrondi commercial porte sur le TTC — '
    + 'c’est le nombre que le client paie.');

  const r3 = el('div', 'dvf-r3');
  const regime = menu('dvf-regime', REGIMES, saisie.regime);
  const acompte = menu('dvf-acompte', ACOMPTES.map((p) => ({ id: p, label: p ? `${p} %` : 'Aucun' })), saisie.acompte);
  const arrondi = menu('dvf-arrondi', ARRONDIS, saisie.arrondi);
  r3.append(champ('Régime TGCA', regime), champ('Acompte', acompte), champ('Arrondi commercial', arrondi));
  c.append(r3);

  const totaux = el('div', 'dvf-totaux');
  totaux.id = 'dvf-totaux';
  c.append(totaux);

  regime.addEventListener('change', () => { saisie.regime = regime.value; redessiner(); });
  acompte.addEventListener('change', () => { saisie.acompte = Number(acompte.value); redessiner(); });
  arrondi.addEventListener('change', () => { saisie.arrondi = arrondi.value; redessiner(); });
  return c;
}

// ===========================================================================
// LE REDESSIN — les totaux, l'état du délai, et la feuille
// ===========================================================================
// UN SEUL REDESSIN PAR IMAGE. Frapper vingt caractères déclenche vingt appels ;
// sans ce report, on reconstruit vingt feuilles A4 dont dix-neuf ne seront
// jamais vues, et la frappe se met à traîner sur la quatrième ligne d'articles.
let attendu = 0;
function redessiner() {
  if (attendu) return;
  attendu = requestAnimationFrame(() => { attendu = 0; peindre(); });
}

function peindre() {
  const compte = calculerDevis(saisie);

  // L'état du délai : la seule couleur de l'écran, et elle dit un ÉTAT.
  const appro = APPROS.find((a) => a.id === saisie.appro) || APPROS[0];
  const etat = $('#dvf-etat');
  if (etat) {
    etat.className = `dvf-etat dvf-etat--${appro.etat}`;
    etat.textContent = appro.court;
  }

  const totaux = $('#dvf-totaux');
  if (totaux) {
    const lignes = [['Sous-total HT', compte.sousTotalHt]];
    if (compte.ecart) lignes.push(['Arrondi commercial', compte.ecart]);
    lignes.push(['Total HT', compte.totalHt]);
    lignes.push([compte.regime.taxable
      ? `${compte.regime.label} ${(compte.tauxTgca * 100).toFixed(compte.tauxTgca * 100 % 1 ? 1 : 0)} %`
      : compte.regime.label, compte.taxe]);
    totaux.replaceChildren();
    for (const [k, v] of lignes) {
      const l = el('div', 'dvf-tot');
      l.append(el('span', null, k), el('b', null, euro(v)));
      totaux.append(l);
    }
    const grand = el('div', 'dvf-tot dvf-tot--grand');
    grand.append(el('span', null, 'TOTAL À PAYER'), el('b', null, euro(compte.ttc)));
    totaux.append(grand);
    if (compte.acompte.pourcent) {
      const a = el('div', 'dvf-tot');
      a.append(el('span', null, `Acompte ${compte.acompte.pourcent} % à verser`),
        el('b', null, euro(compte.acompte.montant)));
      totaux.append(a);
    }
  }

  // CE QUE L'EN-TÊTE DIT : où en est ce devis. « Brouillon » n'est pas une
  // décoration — tant qu'il n'est pas au planning, personne ne le relancera.
  const compteur = $('#dvf-compte');
  if (compteur) {
    const n = saisie.lignes.length;
    const etatDevis = dossierId ? 'au planning' : 'brouillon local';
    compteur.textContent = `${n} article${n > 1 ? 's' : ''} · ${euro(compte.ttc)} · ${etatDevis}`;
  }
  const bSave = $('#dvf-enregistrer');
  if (bSave) {
    bSave.disabled = !!dossierId || !saisie.lignes.length || !String(saisie.client.nom || '').trim();
    bSave.textContent = dossierId ? 'Enregistré au planning' : 'Enregistrer au planning';
  }

  const feuille = $('#dvf-feuille');
  if (feuille) {
    feuille.replaceChildren(dessinerDevis(modeleDevis(saisie, entreprise), document));
    mettreALEchelle();
  }
  garderBrouillon();
}

// ===========================================================================
// IMPRIMER
// ===========================================================================
// LE NUMÉRO SE RÉSERVE AU PREMIER PAPIER, pas à l'ouverture de l'écran : un
// poste qu'on ouvre le matin et qu'on laisse là brûlerait un numéro par jour, et
// la série aurait des trous que personne ne saurait expliquer. Deux impressions
// du même devis gardent donc le même numéro.
//
// ON N'IMPRIME PAS L'APPLICATION : on compose une page propre dans un cadre hors
// écran, on l'imprime, on le retire. Un cadre plutôt qu'une fenêtre — aucun
// bloqueur de fenêtres ne peut l'empêcher. Et c'est la MÊME chaîne de style que
// l'aperçu, donc l'aperçu ne peut pas dériver de ce qui sort.
let impressionEnCours = false;
async function imprimer() {
  if (impressionEnCours) return;
  impressionEnCours = true;
  const bouton = $('#dvf-imprimer');
  if (bouton) bouton.disabled = true;
  try {
    if (!saisie.numero) {
      const r = await api('POST', '/api/devis/numero', { jour: jourAtelier() });
      saisie.numero = (r && r.numero) || '';
      peindre();
    }
    const t = modeleDevis(saisie, entreprise);
    const cadre = document.createElement('iframe');
    cadre.setAttribute('aria-hidden', 'true');
    // Assez large pour une feuille de 210 mm : dans un cadre trop étroit, les
    // colonnes du détail se calculent sur la mauvaise largeur.
    cadre.style.cssText = 'position:fixed;left:-9999px;top:0;width:820px;height:1200px;border:0';
    document.body.appendChild(cadre);
    const d = cadre.contentDocument;
    d.title = `Devis ${t.numero || ''}`.trim();
    const style = d.createElement('style');
    style.textContent = `@page{size:A4 portrait;margin:0}body{margin:0;background:#fff}${CSS_DEVIS}`;
    d.head.appendChild(style);
    d.body.appendChild(dessinerDevis(t, d));
    cadre.contentWindow.focus();
    cadre.contentWindow.print();
    setTimeout(() => cadre.remove(), 1000);
  } catch (err) {
    dire(err.message || 'Impression impossible', 'is-ko');
  } finally {
    impressionEnCours = false;
    if (bouton) bouton.disabled = false;
  }
}

// ===========================================================================
// ENREGISTRER AU PLANNING
// ===========================================================================
// UN DEVIS IMPRIMÉ QUI N'EST NULLE PART N'EXISTE PAS : personne ne le relance,
// et c'est exactement l'étape que le pipeline appelle « Tarif / Devis envoyé —
// Attente client ». Le prix part avec — l'étape dit qu'on a chiffré, une
// colonne Prix vide la contredirait.
let envoiEnCours = false;
async function enregistrer() {
  if (envoiEnCours || dossierId) return;
  const nom = String(saisie.client.nom || '').trim();
  if (!nom) return dire('Le nom du client est requis', 'is-ko');
  if (!saisie.lignes.length) return dire('Un devis sans article ne s’enregistre pas', 'is-ko');
  envoiEnCours = true;
  const bouton = $('#dvf-enregistrer');
  if (bouton) bouton.disabled = true;
  try {
    const compte = calculerDevis(saisie);
    const r = await api('POST', '/api/devis', {
      numero: saisie.numero,
      jour: jourAtelier(),
      date: saisie.date,
      validite: saisie.validite,
      projet: saisie.projet,
      dueDate: saisie.dueDate,
      client: saisie.client,
      appro: saisie.appro,
      regime: saisie.regime,
      tauxTgca: saisie.tauxTgca,
      arrondi: saisie.arrondi,
      lignes: compte.lignes,
      sousTotalHt: compte.sousTotalHt,
      totalHt: compte.totalHt,
      taxe: compte.taxe,
      ttc: compte.ttc,
      acomptePourcent: compte.acompte.pourcent,
      acompteMontant: compte.acompte.montant,
    });
    dossierId = r && r.id ? r.id : null;
    if (r && r.numero) saisie.numero = r.numero;
    dire(r && r.dejaEnregistre ? 'Ce devis était déjà au planning' : 'Devis enregistré au planning', 'is-ok');
    peindre();
  } catch (err) {
    dire(err.message || 'Enregistrement impossible', 'is-ko');
  } finally {
    envoiEnCours = false;
    peindre();
  }
}

function repartirDeZero() {
  // ON NE VIDE PAS UN DEVIS QU'ON N'A PAS ENREGISTRÉ SANS LE DIRE. Un
  // brouillon perdu, c'est un client qu'on fait attendre pendant qu'on retape.
  if (!dossierId && saisie.lignes.length
    && !window.confirm('Ce devis n’est pas au planning. Le remplacer par un devis vierge ?')) return;
  saisie = saisieNeuve();
  dossierId = null;
  for (const [id, v] of [['#dvf-cl-nom', ''], ['#dvf-cl-code', ''], ['#dvf-cl-ville', ''],
    ['#dvf-cl-email', ''], ['#dvf-cl-contact', ''], ['#dvf-cl-tel', ''], ['#dvf-cherche', ''],
    ['#dvf-projet', ''], ['#dvf-due', ''], ['#dvf-validite', saisie.validite]]) {
    const n = $(id);
    if (n) n.value = v;
  }
  const appro = $('#dvf-appro');
  if (appro) appro.value = saisie.appro;
  poserLignes();
  redessiner();
}

// LE MESSAGE NE POUSSE PERSONNE. Il sort du flux (`.msg-flottant`, charte.css) :
// posé dans la colonne, il descendrait tous les champs sous les doigts au moment
// précis où l'on vient de cliquer.
let minuteurMsg = 0;
function dire(texte, cls) {
  let msg = document.getElementById('dvf-msg');
  if (!msg) {
    msg = el('div', 'msg-flottant');
    msg.id = 'dvf-msg';
    msg.setAttribute('role', 'status');
    document.body.appendChild(msg);
  }
  msg.className = `msg-flottant ${cls || ''}`.trim();
  msg.textContent = texte;
  clearTimeout(minuteurMsg);
  minuteurMsg = setTimeout(() => { msg.textContent = ''; }, 4000);
}
