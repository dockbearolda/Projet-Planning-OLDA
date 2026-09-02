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
// LE MENU DÉROULANT AVEC RECHERCHE, celui des deux écrans du comptoir. Charlie,
// 01/09 : « ce input doit avoir OBLIGATOIREMENT une fonction recherche COMME
// TOUS LES INPUTS avec un menu déroulant ». Il a déménagé de `pont.js` pour
// qu'il n'en existe qu'UN — voir l'en-tête de `menu-recherche.js`.
import { menuPoser, menuRafraichir, poserStyleMenu } from './menu-recherche.js';

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

// LES SIX TAILLES, ÉCRITES UNE FOIS. Charlie, 01/09 : « des inputs par défaut
// pour chaque taille de t-shirt, de XS à 2XL ». Elles sont l'ordre d'affichage
// ET l'ordre d'écriture sur le devis — deux listes finiraient par diverger, et
// c'est le papier remis au client qui le dirait.
//
// ⚠ CE N'EST PAS LA LISTE DU MOTEUR. `textile-catalog.js` compte en
// S/M/L/XL/XXL/other, et il ne s'en sert QUE pour faire un total : le
// coefficient est dégressif sur la quantité, pas sur la répartition (voir
// `chiffrerTextile`, qui lui passe `{ other: quantité }`). Un XS de plus ici ne
// change donc rien au prix, et n'oblige à toucher à rien là-bas.
const TAILLES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

// CE QUE LES TAILLES DISENT SUR LE DEVIS : « 2 × S · 3 × M ». C'est la
// grammaire de toute la maison — la fiche de production et le ticket de
// l'atelier comptent ainsi. Le texte est DÉRIVÉ des cases : il n'y a qu'une
// source, et une répartition corrigée à l'écran ne peut pas laisser sur le
// papier celle d'avant.
function texteTailles(parTaille) {
  return TAILLES
    .filter((t) => Number((parTaille || {})[t]) > 0)
    .map((t) => `${Number(parTaille[t])} × ${t}`)
    .join(' · ');
}
function totalTailles(parTaille) {
  return TAILLES.reduce((s, t) => s + (Number((parTaille || {})[t]) || 0), 0);
}
// UN BROUILLON D'AVANT LES CASES porte ses tailles en TEXTE. On le relit plutôt
// que de le jeter : la grammaire est la nôtre, on sait la défaire.
function lireTailles(texte) {
  const par = {};
  const re = /(\d+)\s*[×x]\s*([A-Za-z0-9]+)/g;
  let m = re.exec(String(texte || ''));
  while (m) {
    const t = TAILLES.find((k) => k.toLowerCase() === m[2].toLowerCase());
    if (t) par[t] = (par[t] || 0) + Number(m[1]);
    m = re.exec(String(texte || ''));
  }
  return par;
}

let saisie = saisieNeuve();
// QUELLES CATÉGORIES SONT DÉPLIÉES. Par appareil, avec le brouillon : celui qui
// a replié la fiscalité une fois ne veut pas la replier à chaque devis.
// Absente de l'objet = ouverte : une catégorie neuve s'ouvre.
let replis = {};
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
  try { localStorage.setItem(CLE_BROUILLON, JSON.stringify({ saisie, dossierId, replis })); } catch (_) { /* plein ou refusé */ }
}
function relireBrouillon() {
  try {
    const brut = localStorage.getItem(CLE_BROUILLON);
    if (!brut) return;
    const d = JSON.parse(brut);
    if (!d || !d.saisie || typeof d.saisie !== 'object') return;
    saisie = { ...saisieNeuve(), ...d.saisie, client: { ...saisieNeuve().client, ...(d.saisie.client || {}) } };
    saisie.lignes = Array.isArray(d.saisie.lignes) ? d.saisie.lignes : [];
    // Une ligne d'avant les cases de taille garde sa répartition : on la relit
    // du texte, seule écriture qu'elle en avait.
    for (const l of saisie.lignes) {
      if (!l.parTaille || typeof l.parTaille !== 'object') l.parTaille = lireTailles(l.tailles);
    }
    dossierId = d.dossierId || null;
    replis = d.replis && typeof d.replis === 'object' ? d.replis : {};
  } catch (_) { /* un brouillon illisible vaut pas de brouillon */ }
}

// ===========================================================================
// LE SQUELETTE — posé UNE fois
// ===========================================================================
// ON NE RECONSTRUIT PAS UN CHAMP SOUS LES DOIGTS. Redessiner le formulaire à
// chaque frappe reprend le curseur à qui écrit, et c'est une saisie perdue par
// ligne. Le squelette est donc pose une fois ; seuls les TOTAUX et la FEUILLE
// se redessinent, et ni l'un ni l'autre ne porte de curseur.
// UNE CATÉGORIE SE REPLIE (01/09). Charlie : « un menu dépliant pour chaque
// catégorie ». Une carte ouverte de bout en bout, c'est quatre écrans de champs
// à franchir pour arriver aux articles — et sur un devis sur trois, le client
// est déjà en base et la fiscalité ne bouge pas.
//
// C'EST LE VOLET DE LA CHARTE, celui des deux écrans du comptoir
// (`.volet-plus`, charte.css) : un `<details>`, sa flèche, et son ouverture
// glissée. Pas un repli écrit ici qui lui ressemblerait.
//
// LE CORPS EST UN BLOC, ET C'EST STRUCTUREL : `.reg-card` est une colonne
// `flex` avec son écart ; sur un `<details>`, cette colonne ne compte que DEUX
// enfants — le résumé et la boîte de contenu — et l'écart entre les rangées de
// la carte disparaîtrait. Le corps le reprend donc à son compte.
//
// ⚠ PAS DE « i » SUR CES CARTES (retire le 02/09, Charlie : « supprime les
// points d'information »). Chaque titre en portait un, qui depliait une bulle
// de deux a quatre lignes. Le composant reste — les Reglages s'en servent — mais
// cet ecran ne le pose plus : ce qu'il expliquait, on l'apprend une fois, et
// ensuite on le franchit a chaque devis. « A egalite, celle qui montre MOINS
// gagne. »
//
// Rend `[bloc, corps]` : on empile dans le corps, jamais dans le bloc.
function carte(icone, titre, cle) {
  const c = el('details', 'reg-card dvf-cat volet-plus');
  c.open = replis[cle] !== false;
  if (cle) {
    c.dataset.cat = cle;
    c.addEventListener('toggle', () => { replis[cle] = c.open; garderBrouillon(); });
  }
  const t = el('summary', 'reg-card__head');
  t.append(ic(icone));
  t.firstChild.classList.add('reg-card__ic');
  const ligne = el('div', 'reg-card__t');
  ligne.append(el('h2', 'reg-card__title', titre));
  t.append(ligne);
  // CE QUI EXPLIQUE LA CARTE N'EST PLUS SOUS SON TITRE. Quatre paragraphes de
  // deux a quatre lignes tenaient le haut de la colonne de saisie : on les lit
  // une fois, et ensuite on les franchit a chaque devis. Ils sont dans la bulle
  // du « i » — meme fabrique que les Reglages, la carte est la leur.
  // ⚠ PAS DE RÉSUMÉ À DROITE DU TITRE NON PLUS (retiré le 02/09). Une catégorie
  // repliée portait une ligne de rappel — le nom du client, l'état du délai, le
  // total. Mesuré au rendu : « Dépend de la prochaine commande groupée » ne
  // tient pas sur la rangée, elle se replie sur deux lignes, et c'est le TITRE
  // qui rend la place (`min-width: 0`) — « Projet et délai » passait donc sur
  // deux lignes pour qu'un rappel tienne sur deux. Le volet dit déjà ce qu'il
  // faut : sa flèche, et ce qu'on voit en l'ouvrant.
  c.append(t);
  const corps = el('div', 'dvf-cat__corps');
  c.append(corps);
  return [c, corps];
}

// UNE RANGÉE DE FEUILLE DE CALCUL : l'intitulé à gauche, la case à droite, et
// rien autour. Charlie, 01/09 : « les lignes simples à remplir façon Google
// Sheet ». L'intitulé au-dessus (`.fa-case`, la grammaire du comptoir) reste
// celui du TABLEAU des articles, où il coiffe une colonne et se lit une fois
// pour toutes les lignes ; ici, où chaque rangée porte un champ différent, il
// se pose à gauche et le regard descend une seule colonne de cases.
//
// Il garde `.fa-lab` et `.fa-in` — l'intitulé et la boîte de l'application. Ce
// qui change, c'est la mise en place, pas les composants.
function rang(nom, noeud) {
  const c = el('div', 'dvf-rang');
  const lab = el('label', 'fa-lab dvf-rang__k', nom);
  const boite = el('div', 'dvf-rang__v');
  boite.append(noeud);
  if (noeud.id) lab.setAttribute('for', noeud.id);
  c.append(lab, boite);
  return c;
}

// UNE COLONNE DE RANGÉES. Les traits de séparation viennent de la grille, pas
// de chaque rangée : une bordure écrite par rangée en pose une de trop en bas.
function feuille(...rangs) {
  const g = el('div', 'dvf-grille');
  g.append(...rangs);
  return g;
}

// UN CHAMP À INTITULÉ AU-DESSUS — celui du comptoir (`.fa-case`). Il ne sert
// plus que là où l'intitulé coiffe une case isolée dans le tableau : les
// tailles et la note d'un article.
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
  // La feuille du composant de menu part avec lui, et une seule fois.
  poserStyleMenu();
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
  const [c, corps] = carte('contacts', 'Client', 'client');

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
  corps.append(cherche);

  const nom = entree('dvf-cl-nom', { valeur: saisie.client.nom, exemple: 'Nom ou société' });
  const code = entree('dvf-cl-code', { valeur: saisie.client.code, exemple: 'ALO' });
  const ville = entree('dvf-cl-ville', { valeur: saisie.client.ville, exemple: '97150 Saint-Martin' });
  const email = entree('dvf-cl-email', { type: 'email', valeur: saisie.client.email, exemple: 'facultatif' });
  const contact = entree('dvf-cl-contact', { valeur: saisie.client.contact, exemple: 'facultatif' });
  const tel = entree('dvf-cl-tel', { type: 'tel', valeur: saisie.client.tel, exemple: 'facultatif' });
  const type = menu('dvf-cl-type', [
    { id: 'professionnel', label: 'Professionnel' }, { id: 'particulier', label: 'Particulier' },
    { id: 'association', label: 'Association' }, { id: 'revendeur', label: 'Revendeur' },
  ], saisie.client.type === 'perso' ? 'particulier' : 'professionnel');
  corps.append(feuille(
    rang('Client / société', nom), rang('Code client', code),
    rang('Ville', ville), rang('E-mail', email),
    rang('Personne à contacter', contact), rang('Téléphone', tel),
    rang('Type', type),
  ));

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
  const [c, corps] = carte('event', 'Projet et délai', 'projet');

  const projet = entree('dvf-projet', { valeur: saisie.projet, exemple: 'STAFF, Terrasse, Rentrée…' });
  const appro = menu('dvf-appro', APPROS, saisie.appro);
  const due = entree('dvf-due', { type: 'date', valeur: saisie.dueDate });
  const val = entree('dvf-validite', { type: 'date', valeur: saisie.validite });
  corps.append(feuille(
    rang('Nom du projet', projet), rang('Approvisionnement', appro),
    rang('Date souhaitée client', due), rang('Validité du devis', val),
  ));

  // L'ÉTAT DU DÉLAI N'EST PAS UN CHAMP : c'est ce que l'approvisionnement choisi
  // ENTRAÎNE, et c'est une phrase. Posé dans une demi-colonne comme s'il se
  // remplissait, il montait à 117 px de haut — quatre lignes — à côté d'un menu
  // de 50 (mesuré à 1280 px, le plus petit poste). Il prend donc toute la
  // largeur de sa carte, où il tient sur une ligne, et il ne prétend plus être
  // une commande.
  const etat = el('div', 'dvf-etat');
  etat.id = 'dvf-etat';
  corps.append(etat);

  projet.addEventListener('input', () => { saisie.projet = projet.value; redessiner(); });
  due.addEventListener('change', () => { saisie.dueDate = due.value; redessiner(); });
  val.addEventListener('change', () => { saisie.validite = val.value; redessiner(); });
  appro.addEventListener('change', () => { saisie.appro = appro.value; redessiner(); });
  return c;
}

// ===========================================================================
// CARTE 3 — LES ARTICLES
// ===========================================================================
// LES COLONNES DU TABLEAU, ÉCRITES UNE FOIS. L'en-tête les pose, chaque ligne
// les remplit dans le même ordre : deux listes, ce serait un intitulé qui coiffe
// la mauvaise case le jour où l'on en insère une.
const COLONNES = ['Désignation', 'Référence', 'Qté', 'PU HT', 'Total', ''];

function carteArticles() {
  const [c, corps] = carte('local_grocery_store', 'Articles', 'articles');

  // LE TABLEAU (01/09). Charlie : « une présentation façon tableau ». Un article
  // tenait dans un bloc de cinq rangées à intitulés — huit champs, huit
  // étiquettes, et la même étiquette réécrite à chaque article. En tableau, un
  // intitulé se lit UNE fois en tête de colonne et l'œil descend une colonne de
  // cases, comme sur une feuille de calcul.
  //
  // IL DÉFILE HORIZONTALEMENT, ET LA DÉSIGNATION RESTE. C'est la seule colonne
  // qui dit DE QUOI on parle : sans elle sous les yeux, un prix corrigé à
  // droite se corrige sur la ligne d'à côté. Elle se fige donc à gauche —
  // exactement ce que fait une feuille de calcul avec sa première colonne.
  const tab = el('div', 'dvf-tab');
  const tete = el('div', 'dvf-tab__tete');
  tete.id = 'dvf-tab-tete';
  for (const nom of COLONNES) tete.append(el('span', 'fa-lab', nom));
  tab.append(tete);
  const liste = el('div', 'dvf-liste');
  liste.id = 'dvf-liste';
  tab.append(liste);
  corps.append(tab);

  // LA LISTE DES PRODUITS EST POSÉE UNE FOIS POUR TOUT L'ÉCRAN. Chaque rangée
  // la vise par son `list=` : un <datalist> par article, c'est cent trente
  // options recopiées autant de fois qu'il y a de lignes au devis.
  const produits = el('datalist');
  produits.id = ID_PRODUITS;
  corps.append(produits);

  // ⚠ LE CHOIX DU PRODUIT A QUITTÉ CETTE BARRE (01/09). Elle portait une liste
  // déroulante « Ajouter un article du catalogue » — cent trente entrées sans
  // recherche, où il fallait descendre à la molette pour trouver un t-shirt.
  // « Y'a un gros problème pour bien sélectionner le produit » (Charlie). Le
  // choix se fait maintenant DANS la ligne, là où le nom du produit s'écrit :
  // un endroit de moins, et celui qui reste est celui qu'on regarde.
  const barre = el('div', 'reg-actions');
  const bLigne = el('button', 'reg-btn reg-btn--primary', 'Ajouter un article');
  bLigne.type = 'button';
  bLigne.id = 'dvf-ajouter';
  const bTransport = el('button', 'reg-btn', 'Transport');
  bTransport.type = 'button';
  bTransport.id = 'dvf-transport';
  barre.append(bLigne, bTransport);
  corps.append(barre);

  const aide = el('p', 'dvf-aide');
  aide.id = 'dvf-aide-cat';
  corps.append(aide);

  bLigne.addEventListener('click', () => ajouterLigne({}));
  bTransport.addEventListener('click', ajouterTransport);
  return c;
}

// LE NOM D'UN PRODUIT, tel qu'il s'écrit dans la ligne et sur le devis. Une
// seule fabrique : c'est cette chaîne qui sert de CLÉ pour retrouver le produit
// quand la vendeuse en choisit un, et deux écritures qui divergent d'un tiret
// feraient un choix qui ne retrouve rien.
function nomProduit(p) {
  return [p.label || p.designation, p.variante].filter(Boolean).join(' — ');
}

function remplirCatalogue() {
  const listeProduits = document.getElementById(ID_PRODUITS);
  const aide = $('#dvf-aide-cat');
  if (!listeProduits) return;
  parNom.clear();
  const frag = document.createDocumentFragment();
  for (const p of catalogue) {
    const nom = nomProduit(p);
    if (!nom || parNom.has(nom)) continue;
    parNom.set(nom, p);
    const o = el('option');
    o.value = nom;
    // CE QUE LE COMPOSANT SAIT FAIRE D'UNE OPTION : `data-ref` se pose en JETON
    // en tête de ligne, `data-cherche` se cherche SANS s'afficher, `data-onglet`
    // range l'option dans l'un des deux métiers de la maison.
    if (p.reference) o.dataset.ref = p.reference;
    o.dataset.cherche = [p.famille, p.reference || '', p.designation, p.variante || '',
      p.prixVenteTtc != null ? String(p.prixVenteTtc) : ''].filter(Boolean).join(' ');
    o.dataset.onglet = p.famille === FAMILLE_TEXTILE ? 'Textile' : 'Boutique';
    frag.append(o);
  }
  listeProduits.replaceChildren(frag);
  // Les menus déjà posés voient la nouvelle liste : le catalogue arrive APRÈS
  // l'écran, et une rangée ouverte entre-temps resterait sur une liste vide.
  // ⚠ UN CHAMP DÉJÀ HABILLÉ N'A PLUS D'ATTRIBUT `list` : le composant le
  // débranche (sinon Chrome ouvre SA liste par-dessus la nôtre) et en retient
  // le nom dans `data-menu-liste`. Chercher sur `list=` seul ne trouvait donc
  // que les rangées posées à l'instant.
  for (const n of ROOT.querySelectorAll(
    `input[list="${ID_PRODUITS}"], input[data-menu-liste="${ID_PRODUITS}"]`)) menuRafraichir(n);
  if (!aide) return;
  const tarifes = catalogue.filter((p) => p.prixVenteTtc != null).length;
  // L'ÉCRAN DIT CE QU'IL SAIT. Un catalogue sans prix n'est pas une panne :
  // c'est un import qui n'a pas encore été fait, et le devis se compose quand
  // même — mais il faut le savoir avant de chercher un tarif qui n'existe pas.
  // CE QUI RESTE ICI EST UN COMPTE, PAS UNE PHRASE. La regle de conversion
  // TTC → HT est passee dans la bulle du « i » : elle ne change jamais, donc
  // elle n'a rien a faire sous les yeux a chaque devis. Ces deux nombres, eux,
  // changent — et un catalogue sans prix n'est pas une panne, c'est un import
  // qui n'a pas encore ete fait.
  // DEUX COMPTES, PARCE QU'IL Y A DEUX SORTES DE PRIX. Un objet se vend à un
  // prix de rayon, qui s'importe — « tarifé » veut dire qu'il l'a été. Un
  // textile n'en a pas et n'en aura jamais : il se CHIFFRE, quantité par
  // quantité. Les compter ensemble ferait lire « 130 produits, 0 tarifé » et
  // donnerait à croire qu'il manque 130 prix.
  const textiles = catalogue.filter((p) => p.famille === FAMILLE_TEXTILE).length;
  const objets = catalogue.length - textiles;
  aide.textContent = catalogue.length
    ? `${objets} objet${objets > 1 ? 's' : ''} au catalogue, ${tarifes} tarifé${tarifes > 1 ? 's' : ''}`
      + (textiles ? ` · ${textiles} textiles, chiffrés à la quantité` : '')
    : '';
}

// ===========================================================================
// LE TEXTILE — MÊME BASE, MÊME MOTEUR
// ===========================================================================
// « Les t-shirts doivent être inclus dans le devis flash ; vente, devis et
// devis flash doivent avoir exactement la même base de données de produit »
// (Charlie, 01/09). Les 48 références du fichier du patron sont descendues dans
// `catalogue_produits`, famille « Textile » : elles arrivent donc ici par le
// MÊME endpoint que les tasses et les goodies, sans rien de particulier.
//
// ⚠ MAIS UN T-SHIRT NE SE VEND PAS À UN PRIX DE RAYON — IL SE CHIFFRE. Son
// prix dépend de la quantité (coefficients dégressifs), du marquage (mètres de
// DTF, temps de presse) et du genre (la table des temps). C'est exactement ce
// que fait le moteur conforme au fichier V9, et il est déjà écrit : on
// l'APPELLE. Recopier ici la moindre de ses formules donnerait deux moteurs, et
// le jour où l'un bouge le devis et le comptoir ne diraient plus le même prix.
//
// Il se charge À LA DEMANDE — au premier t-shirt posé, pas à l'ouverture de
// l'écran : c'est 78 Ko que la plupart des devis n'ouvrent jamais.
// Le nom du rayon, écrit UNE fois : l'écran le lit pour reconnaître une ligne
// qui se chiffre, `catalogue.js` pour l'écarter du menu du comptoir (elle y a
// son propre parcours, celui qui sait faire le prix), et `db.js` pour la semer.
const FAMILLE_TEXTILE = 'Textile';
// LA LISTE DES PRODUITS, POSÉE UNE FOIS POUR TOUT L'ÉCRAN, et le chemin inverse
// — du nom écrit dans la ligne au produit du catalogue. C'est ce qui permet à
// une désignation TAPÉE à la main de valoir un choix : si elle tombe juste, la
// ligne gagne sa référence et son prix.
const ID_PRODUITS = 'dvf-produits';
const parNom = new Map();
const CHEMIN_MOTEUR = '/comptoir/textile-catalog.js';
let moteurEnRoute = null;
function moteurTextile() {
  if (window.TextileEngine) return Promise.resolve(window.TextileEngine);
  if (!moteurEnRoute) {
    moteurEnRoute = new Promise((tenu, rompu) => {
      const s = document.createElement('script');
      s.src = CHEMIN_MOTEUR;
      s.onload = () => (window.TextileEngine
        ? tenu(window.TextileEngine)
        : rompu(new Error('Moteur textile illisible')));
      s.onerror = () => rompu(new Error('Moteur textile injoignable — le prix se saisit à la main'));
      document.head.appendChild(s);
    }).catch((err) => {
      // Un échec ne se garde PAS en mémoire : le réseau revient, et le devis
      // suivant doit pouvoir réessayer.
      moteurEnRoute = null;
      throw err;
    });
  }
  return moteurEnRoute;
}

// LE MARQUAGE PAR DÉFAUT EST « AUCUN », ET C'EST UN CHOIX. Deviner « Cœur +
// Dos » donnerait un prix plausible et FAUX une fois sur deux ; « Aucun » donne
// le prix juste du vêtement nu, qui est une vente réelle. Le menu est dans la
// rangée, à côté de la quantité : on le pose en même temps qu'on pose l'article.
const MARQUAGE_AUCUN = 'Aucun';

// LE TRANSPORT NE PASSE PAS PAR LE MOTEUR, IL A SA PROPRE LIGNE. Le moteur sait
// ajouter un acheminement à la pièce (Maritime 0 €, Chronopost 1,50 €) ; l'écran
// a déjà son bouton « Transport », qui pose une ligne au tarif des Réglages et
// que le client VOIT sur le devis. Chiffrer en « Maritime » (0 €) et garder la
// ligne, c'est dire une fois ce qu'on facture une fois.
const TRANSPORT_MOTEUR = 'Maritime';

// LE MARQUAGE DEVIENT UNE LISTE LE JOUR OÙ LA LIGNE DEVIENT UN TEXTILE.
// ===========================================================================
// Il décide du prix : « coeur+dos » tapé à la main n'est plus un emplacement
// pour le moteur, il vaut zéro mètre de DTF, et la ligne sort au prix du
// vêtement nu. Les treize emplacements du fichier V9 sont donc proposés.
//
// LE CHAMP NE CHANGE PAS DE FORME POUR AUTANT. Il reste l'input qu'il était,
// à la même place, avec la même valeur : le composant l'HABILLE, il ne le
// remplace pas. Rien ne bouge sous les doigts (loi 9) — et une ligne qui n'est
// pas un textile garde un champ de texte ordinaire, sans menu vide à ouvrir.
const ID_MARQUAGES = 'dvf-marquages';
function poserMarquages(champMarq) {
  if (!champMarq || champMarq.dataset.menuListe === ID_MARQUAGES) return;
  moteurTextile().then((TE) => {
    const noms = Object.keys(TE.DB.printTypes || {});
    if (!noms.length) return;
    let liste = document.getElementById(ID_MARQUAGES);
    if (!liste) {
      liste = el('datalist');
      liste.id = ID_MARQUAGES;
      ROOT.append(liste);
    }
    if (!liste.options.length) {
      for (const nom of noms) {
        const o = el('option');
        o.value = nom;
        liste.append(o);
      }
    }
    if (champMarq.dataset.menuListe === ID_MARQUAGES) return;
    champMarq.setAttribute('list', ID_MARQUAGES);
    menuPoser(champMarq);
  }).catch(() => { /* moteur injoignable : le champ reste une saisie libre */ });
}

// Le prix d'une ligne textile, par le moteur du patron. Rend `null` si le
// moteur n'est pas joignable ou si la ligne n'a pas de quoi se chiffrer — dans
// les deux cas le prix saisi reste ce qu'il est, il ne tombe pas à zéro.
async function chiffrerTextile(ligne) {
  if (!ligne || !ligne.textile || ligne.puManuel) return null;
  const quantite = Math.max(0, Number(ligne.quantite) || 0);
  if (!quantite) return null;
  let TE;
  try { TE = await moteurTextile(); } catch (err) { dire(err.message, 'is-ko'); return null; }
  const compte = TE.calculate({
    ref: ligne.textile.ref,
    isCustom: false,
    genre: ligne.textile.genre,
    transport: TRANSPORT_MOTEUR,
    printType: ligne.marquage || MARQUAGE_AUCUN,
    // LES TAILLES DU DEVIS SONT UN TEXTE (« 2 × S · 3 × M »), le moteur compte
    // des pièces. Seule la QUANTITÉ entre dans le calcul — le coefficient est
    // dégressif sur le total, pas sur la répartition — et c'est elle qu'on lui
    // donne. La répartition reste ce que la ligne dit au client.
    sizes: { other: quantite },
    discount: '',
    manualPrice: '',
    // Les coefficients du fichier V9 portent déjà la marge : une majoration de
    // plus la compterait deux fois.
    markupPercent: 0,
  });
  if (!compte) return null;
  ligne.unitaireHt = Math.round(compte.sold * 100) / 100;
  return ligne.unitaireHt;
}

// CHOISIR UN PRODUIT SUR UNE LIGNE QUI EXISTE DÉJÀ. C'est le seul chemin depuis
// le 01/09 : la liste « Ajouter un article du catalogue » de la barre est
// partie, le choix se fait dans la DÉSIGNATION de la ligne.
//
// Il vaut aussi pour une désignation TAPÉE : si elle tombe exactement sur un
// produit du catalogue, la ligne gagne sa référence et son prix. Taper le nom
// exact d'un produit, c'est le désigner.
function choisirProduit(ligne, nom, apres) {
  const p = parNom.get(String(nom || '').trim());
  if (!p) return false;
  ligne.reference = p.reference || '';
  if (p.couleur) ligne.couleur = p.couleur;
  if (p.famille === FAMILLE_TEXTILE) {
    // UN T-SHIRT N'A PAS DE PRIX DE RAYON, il se CHIFFRE : quantité, marquage
    // et genre. `note` porte le genre du moteur — c'est lui qui choisit la
    // table des temps ; introuvable, il vaudrait zéro mètre de DTF, donc un
    // marquage facturé 2,30 € au lieu de 9,90 €.
    ligne.textile = { ref: p.reference || '', genre: p.note || '' };
    if (!ligne.marquage) ligne.marquage = MARQUAGE_AUCUN;
    chiffrerTextile(ligne).then(() => { if (apres) apres(); redessiner(); });
    return true;
  }
  ligne.textile = null;
  // UN PRIX DE CATALOGUE EST TTC (c'est le prix de rayon). Le devis compte en
  // HT : la conversion se fait ici, au taux du moment.
  //
  // ⚠ ET IL NE REMPLACE PAS UN PRIX DÉJÀ POSÉ. On négocie devant le client :
  // corriger la désignation d'une ligne dont on vient d'accorder le prix ne
  // doit pas rendre la remise. C'est la même règle qu'à la vente directe.
  if (p.prixVenteTtc != null && !ligne.unitaireHt && !ligne.puManuel) {
    ligne.unitaireHt = saisie.tauxTgca
      ? Math.round((Number(p.prixVenteTtc) / (1 + saisie.tauxTgca)) * 100) / 100
      : Number(p.prixVenteTtc);
  }
  if (apres) apres();
  return true;
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
    // `parTaille` : les six cases. `tailles` reste le TEXTE du devis, et il en
    // est dérivé — une seule source, sinon le papier dit une répartition et
    // l'écran une autre.
    parTaille: {},
    quantite: 1, unitaireHt: 0,
    // `textile` : la référence et le genre du moteur, quand la ligne se chiffre.
    // `puManuel` : le prix a été repris à la main, le moteur n'y touche plus.
    textile: null, puManuel: false,
    ...modele,
  });
  const hote = $('#dvf-liste');
  if (hote) {
    const vide = hote.querySelector('.dvf-vide');
    if (vide) vide.remove();
    hote.append(rangeeArticle(saisie.lignes[saisie.lignes.length - 1]));
  }
  majTeteTableau();
  redessiner();
  // On ouvre la frappe sur la désignation : c'est le premier mot qu'on tape
  // après avoir cliqué « Ligne libre ».
  const dernier = hote && hote.lastElementChild;
  const premier = dernier && dernier.querySelector('input');
  if (premier && !modele.designation) premier.focus();
}

// UN EN-TÊTE SANS LIGNE NE COIFFE RIEN. Six intitulés au-dessus d'un message
// « aucun article », c'est un tableau qui prétend porter des données. Une seule
// fonction pour le dire, appelée à chaque fois que le nombre de lignes bouge :
// écrit dans `poserLignes` seul, l'en-tête restait caché après le premier
// « Ajouter un article » — mesuré au rendu, le tableau sortait sans colonnes.
function majTeteTableau() {
  const tete = $('#dvf-tab-tete');
  if (tete) tete.hidden = !saisie.lignes.length;
}

function poserLignes() {
  const hote = $('#dvf-liste');
  if (!hote) return;
  hote.replaceChildren();
  majTeteTableau();
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
  // LA LIGNE PEUT DEVENIR UN TEXTILE APRÈS SA CONSTRUCTION — c'est le cas
  // normal : on ajoute une ligne, PUIS on cherche son produit. Ce drapeau ne
  // dit donc que l'état de DÉPART, celui d'un brouillon relu ; partout ailleurs
  // c'est `ligne.textile` qui fait foi, au moment où on le lit.
  const estTextile = !!(ligne.textile && ligne.textile.ref);
  if (!ligne.parTaille || typeof ligne.parTaille !== 'object') ligne.parTaille = {};

  // LA RANGÉE DU TABLEAU. Ses cases suivent `COLONNES` dans l'ordre, sans
  // intitulé : l'en-tête les nomme une fois pour toutes les lignes.
  const rangee = el('div', 'dvf-tab__rang');
  bloc.append(rangee);

  const design = entree(`dvf-a-${n}-d`, {
    valeur: ligne.designation,
    exemple: 'Cherche un produit, ou écris la désignation',
  });
  // ⚠ C'EST ICI QUE LE PRODUIT SE CHOISIT (01/09). « Y'a un gros problème pour
  // bien sélectionner le produit » (Charlie) : il fallait descendre une liste
  // de cent trente entrées, sans recherche, posée ailleurs que dans la ligne.
  // Le champ vise la liste partagée de l'écran et se fait habiller par LE menu
  // du comptoir — celui des deux autres écrans, pas un qui lui ressemble. Il
  // reste un champ LIBRE : une désignation écrite à la main est une ligne
  // valable, et c'est ce qui rend la « ligne libre » inutile en tant que bouton.
  design.setAttribute('list', ID_PRODUITS);
  design.dataset.menuFiltre = 'Cherche : NS300, tasse, magnet…';
  // PAS DE « + AJOUTER » SUR CE CHAMP-LÀ. Le composant le propose pour saisir
  // une valeur hors liste — mais ici le champ EST libre : le bouton ouvrait une
  // seconde zone de frappe pour faire ce qu'on fait déjà en tapant, et il
  // poussait la rangée des deux métiers d'un cran vers le bas.
  design.dataset.menuManuelNon = '';

  const refe = entree(`dvf-a-${n}-r`, { valeur: ligne.reference, exemple: 'NS300' });
  const coul = entree(`dvf-a-${n}-c`, { valeur: ligne.couleur, exemple: 'Light Olive Green' });
  // « Marquage » et pas « Personnalisation » : c'est le mot de l'atelier, celui
  // que la fiche de production emploie, et c'est celui qui s'imprime sur le
  // devis. Deux mots pour une chose, c'est une question de plus au comptoir.
  //
  // SUR UN TEXTILE, C'EST UN MENU, et ce sont les emplacements du moteur — pas
  // une phrase libre. Le marquage décide du prix : « Coeur + Dos » tapé
  // « coeur+dos » ne serait plus le même emplacement pour le moteur, il vaudrait
  // zéro mètre de DTF, et la ligne sortirait au prix du vêtement nu.
  const marq = entree(`dvf-a-${n}-m`, { valeur: ligne.marquage, exemple: 'Cœur + dos' });
  marq.id = `dvf-a-${n}-m`;
  const qte = entree(`dvf-a-${n}-q`, { type: 'number', valeur: ligne.quantite, classe: 'dvf-nb' });
  const pu = entree(`dvf-a-${n}-p`, { type: 'number', valeur: ligne.unitaireHt, classe: 'dvf-nb' });
  pu.step = '0.01';
  // LE TOTAL DE LA LIGNE EST UNE CASE, PAS UN CHAMP : il ne se tape pas, il se
  // lit. Il prend le rail des cases pour tomber sur elles.
  const total = el('div', 'dvf-tab__lu dvf-nb');
  const sup = el('button', 'reg-tarif-del');
  sup.type = 'button';
  sup.setAttribute('aria-label', 'Retirer cet article');
  sup.append(ic('delete'));
  rangee.append(design, refe, qte, pu, total, sup);
  // ⚠ APRÈS L'INSERTION, JAMAIS AVANT. `menuPoser` REMPLACE le champ par sa peau
  // dans la page (`hote.replaceWith(peau)`) : habillé hors de la page, le champ
  // se retrouve dans une peau détachée, et l'append suivant le sortirait de sa
  // peau — le menu existerait sans plus rien pour l'ouvrir.
  menuPoser(design);

  // --- LE DÉTAIL DE L'ARTICLE, SOUS SA LIGNE ------------------------------
  // CE QUE LA TABLE PORTE, C'EST LA LIGNE COMMERCIALE : ce qu'on vend, combien,
  // à quel prix. Le reste dit comment on le PRODUIT — la couleur, le marquage,
  // la répartition — et ça ne se lit pas en colonne d'un article à l'autre.
  //
  // ⚠ ET C'EST UNE MESURE, pas un goût. Les huit colonnes tenaient 772 px de
  // large au minimum ; la colonne de saisie en fait 574 au plus petit poste de
  // l'atelier (1280 px, mesuré dans la coquille). La table aurait défilé de
  // côté à demeure — y compris pour lire une référence.
  const detail = el('div', 'dvf-r3');

  // --- LES TAILLES --------------------------------------------------------
  // LES TAILLES SONT DES CASES, PAS UNE PHRASE (01/09). Charlie : « des inputs
  // par défaut pour chaque taille de t-shirt, de XS à 2XL ». Elles s'écrivaient
  // à la main — « 2 × S · 3 × M » — dans un champ de texte : la répartition ne
  // se comptait donc pas, elle se recopiait, et la quantité d'à côté pouvait la
  // contredire sans que rien ne le dise.
  //
  // C'EST LA GRILLE DE LA FICHE DE PRODUCTION (`.fa-tailles`, fiche-atelier.css)
  // — celle où l'atelier compte déjà ses pièces, à un clic d'ici. Pas une grille
  // qui lui ressemble.
  //
  // PAS D'INTITULÉ « TAILLES » AU-DESSUS : chaque case porte le sien, et six
  // lettres de taille sous un article ne se confondent avec rien.
  // LES TAILLES SONT DES CASES, PAS UNE PHRASE (01/09). Charlie : « des inputs
  // par défaut pour chaque taille de t-shirt, de XS à 2XL ». Elles s'écrivaient
  // à la main — « 2 × S · 3 × M » — dans un champ de texte : la répartition ne
  // se comptait donc pas, elle se recopiait, et la quantité d'à côté pouvait la
  // contredire sans que rien ne le dise.
  //
  // C'EST LA GRILLE DE LA FICHE DE PRODUCTION (`.fa-tailles`, fiche-atelier.css)
  // — celle où l'atelier compte déjà ses pièces, à un clic d'ici. Pas une grille
  // qui lui ressemble.
  //
  // ELLES SONT SOUS LA RANGÉE, PAS DEDANS. Six colonnes de plus dans le tableau
  // le poussaient à ~1220 px : il aurait défilé horizontalement à tous les
  // postes, y compris pour lire la référence. Sous la ligne, elles ne coûtent
  // rien à la largeur — et elles se lisent avec la note, qui parle du même
  // article.
  const cases = el('div', 'fa-tailles');
  const champsTaille = new Map();
  for (const t of TAILLES) {
    const boite = el('div', 'fa-taille');
    const c = entree(`dvf-a-${n}-t-${t}`, {
      type: 'number', valeur: Number(ligne.parTaille && ligne.parTaille[t]) || '', classe: 'dvf-nb',
    });
    c.placeholder = '0';
    boite.append(el('label', 'fa-lab fa-taille__k', t), c);
    boite.firstChild.setAttribute('for', c.id);
    cases.append(boite);
    champsTaille.set(t, c);
  }
  const note = entree(`dvf-a-${n}-n`, { valeur: ligne.note, exemple: 'Précision qui figurera sur le devis' });
  // « Recalculer » ne s'affiche QUE si le prix a été repris à la main : le reste
  // du temps il n'y a rien à reprendre, le moteur suit déjà la quantité et le
  // marquage. C'est le composant de la charte, celui de « Renommer » et de
  // « Retirer » — pas un bouton de plus.
  // ⚠ IL EST DANS LA RANGÉE DÈS LE DÉPART, MASQUÉ. Une ligne devient un textile
  // quand on choisit son produit — après sa construction — et une rangée ne se
  // reconstruit pas : elle reprendrait le curseur à qui écrit.
  const reprendre = el('button', 'action-ligne', 'Recalculer');
  reprendre.type = 'button';
  reprendre.hidden = true;
  const caseNote = champ('Note du devis', note);
  // Le bouton vit DANS la boîte de la note, à sa droite : c'est la seule case
  // du détail qui a de la place à revendre, et il tombe sur le rail des champs
  // plutôt que sur une rangée à lui.
  caseNote.lastChild.append(reprendre);
  detail.append(champ('Couleur', coul), champ('Marquage', marq), caseNote);
  bloc.append(detail, cases);

  // LA QUANTITÉ SE COMPTE QUAND LES TAILLES SONT REMPLIES, et elle se tape
  // sinon. Une tasse n'a pas de taille : sa case reste une saisie. Un t-shirt
  // réparti en six tailles en a une, et c'est leur somme — deux nombres qui
  // disent la même chose et qui peuvent se contredire, c'est le devis qui
  // annonce 24 pièces et en détaille 22.
  const rafraichirQte = () => {
    const somme = totalTailles(ligne.parTaille);
    qte.readOnly = somme > 0;
    qte.classList.toggle('dvf-tab__calc', somme > 0);
    if (somme > 0) {
      ligne.quantite = somme;
      if (document.activeElement !== qte) qte.value = String(somme);
    }
    ligne.tailles = texteTailles(ligne.parTaille);
  };

  const rafraichirTete = () => {
    total.textContent = euro((Number(ligne.quantite) || 0) * (Number(ligne.unitaireHt) || 0));
    reprendre.hidden = !(ligne.textile && ligne.puManuel);
  };
  // LE PRIX QUE LE MOTEUR VIENT DE POSER REDESCEND DANS LE CHAMP. C'est la
  // seule case que l'écran écrit lui-même : partout ailleurs la saisie va vers
  // l'objet, jamais l'inverse — d'où le passage par cette fonction, enregistrée
  // pour que `chiffrerTextile` puisse la rappeler de l'extérieur.
  const majPu = () => {
    // On ne reprend PAS le champ sous les doigts : si le curseur y est, c'est
    // que quelqu'un est en train d'y écrire.
    if (document.activeElement === pu) return;
    pu.value = String(ligne.unitaireHt);
  };

  const recalculer = () => {
    chiffrerTextile(ligne).then((prix) => {
      if (prix == null) return;
      majPu();
      rafraichirTete();
      redessiner();
    });
  };

  for (const [n2, cle] of [[refe, 'reference'], [coul, 'couleur'], [note, 'note']]) {
    n2.addEventListener('input', () => { ligne[cle] = n2.value; rafraichirTete(); redessiner(); });
  }

  // UNE CASE DE TAILLE ÉCRIT TROIS CHOSES : sa part, le texte du devis, et la
  // quantité. Le prix suit, parce que le coefficient est dégressif — dix
  // t-shirts et cent t-shirts n'ont pas le même prix à la pièce.
  for (const [t, c] of champsTaille) {
    c.addEventListener('input', () => {
      const v = Math.max(0, Math.round(Number(c.value) || 0));
      if (v) ligne.parTaille[t] = v;
      else delete ligne.parTaille[t];
      rafraichirQte();
      rafraichirTete();
      redessiner();
      if (ligne.textile) recalculer();
    });
  }

  // LA DÉSIGNATION ÉCRIT, ET ELLE CHOISIT. La frappe pose le texte tel quel —
  // une ligne libre reste une ligne valable. `change` arrive quand on choisit
  // dans la liste (le composant le lève) ou quand on quitte le champ : si le
  // texte tombe exactement sur un produit, la ligne prend sa référence, son
  // prix ou son chiffrage. Taper le nom exact d'un produit, c'est le désigner.
  const surDesignation = () => {
    ligne.designation = design.value;
    rafraichirTete();
    redessiner();
  };
  design.addEventListener('input', surDesignation);
  design.addEventListener('change', () => {
    ligne.designation = design.value;
    const etaitTextile = !!ligne.textile;
    choisirProduit(ligne, design.value, () => {
      refe.value = ligne.reference;
      coul.value = ligne.couleur;
      majPu();
      rafraichirTete();
    });
    // La liste des marquages n'arrive QUE sur un textile, et une seule fois.
    if (ligne.textile && !etaitTextile) poserMarquages(marq);
    // LA CASE DIT CE QUE LA LIGNE PORTE. `choisirProduit` pose « Aucun » sur un
    // textile qui n'a pas encore de marquage — sans cette ligne, le champ
    // restait VIDE pendant que le prix était bien celui d'un vêtement nu : deux
    // choses qui se contredisent à l'écran, et le devis part avec un marquage
    // qu'on croit avoir oublié de choisir.
    if (ligne.textile) marq.value = ligne.marquage || '';
    rafraichirTete();
    redessiner();
  });
  // LE MARQUAGE : une frappe, ou un choix dans la liste. Les deux évènements,
  // parce que le composant annonce un choix par `change` et la frappe par
  // `input` — écouter l'un des deux seulement, c'est perdre la moitié des
  // saisies.
  const surMarquage = () => {
    ligne.marquage = marq.value;
    rafraichirTete();
    redessiner();
    if (ligne.textile) recalculer();
  };
  marq.addEventListener('input', surMarquage);
  marq.addEventListener('change', surMarquage);
  qte.addEventListener('input', () => {
    ligne.quantite = Math.max(0, Number(qte.value) || 0);
    rafraichirTete();
    redessiner();
    // LE COEFFICIENT EST DÉGRESSIF : dix t-shirts et cent t-shirts n'ont pas le
    // même prix à la pièce. Le prix suit donc la quantité, sinon il faudrait le
    // savoir et le refaire à la main — c'est exactement ce qu'on vient
    // d'enlever.
    if (ligne.textile) recalculer();
  });
  pu.addEventListener('input', () => {
    ligne.unitaireHt = Math.max(0, Number(pu.value) || 0);
    // ON REPREND LA MAIN, ET LE MOTEUR LA REND. Un prix tapé pendant une
    // négociation ne doit pas se faire écraser au prochain changement de
    // quantité ; « Recalculer » le rend au moteur quand on a fini.
    if (ligne.textile) ligne.puManuel = true;
    rafraichirTete();
    redessiner();
  });
  reprendre.addEventListener('click', () => {
    ligne.puManuel = false;
    recalculer();
    rafraichirTete();
  });
  sup.addEventListener('click', () => {
    const i = saisie.lignes.indexOf(ligne);
    if (i >= 0) saisie.lignes.splice(i, 1);
    bloc.remove();
    if (!saisie.lignes.length) poserLignes();
    redessiner();
  });

  // Un brouillon relu porte déjà des lignes textiles : elles retrouvent leur
  // liste de marquages sans qu'on ait à rechoisir le produit.
  if (estTextile) poserMarquages(marq);

  rafraichirQte();
  rafraichirTete();
  return bloc;
}

// ===========================================================================
// CARTE 4 — FISCALITÉ, ACOMPTE, ARRONDI, ET CE QUE ÇA DONNE
// ===========================================================================
function carteArgent() {
  const [c, corps] = carte('receipt_long', 'Fiscalité et règlement', 'argent');

  const regime = menu('dvf-regime', REGIMES, saisie.regime);
  const acompte = menu('dvf-acompte', ACOMPTES.map((p) => ({ id: p, label: p ? `${p} %` : 'Aucun' })), saisie.acompte);
  const arrondi = menu('dvf-arrondi', ARRONDIS, saisie.arrondi);
  corps.append(feuille(
    rang('Régime TGCA', regime), rang('Acompte', acompte), rang('Arrondi commercial', arrondi),
  ));

  const totaux = el('div', 'dvf-totaux');
  totaux.id = 'dvf-totaux';
  corps.append(totaux);

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
//
// ⚠ IL S'ANCRE AU BOUTON QU'ON VIENT DE CLIQUER, PAS AU CORPS DE LA PAGE.
// Signalé par Charlie le 01/09 : « quand je clique sur enregistrer au planning
// rien ne s'affiche ». Le dossier partait bien — c'est le message qui était
// invisible, et TOUS l'étaient : les deux refus, la confirmation, l'échec
// d'impression. `.msg-flottant` est `position: absolute; top: 100%` et prend
// pour ancre son parent DIRECT (`:has(> .msg-flottant)`). Posé sur `<body>`,
// « 100 % » vaut donc la hauteur de la page entière : mesuré au rendu, le
// message s'affichait à 904 px dans une fenêtre de 900 — quatre pixels sous le
// pli, à chaque fois, sans que rien ne le signale.
//
// Il se pose maintenant sur la rangée des trois boutons de l'en-tête : le
// composant est fait pour s'accrocher à la commande qui le provoque, et il
// tombe juste sous celle qu'on vient de cliquer.
let minuteurMsg = 0;
function dire(texte, cls) {
  const hote = $('.ecran-tete__droite') || ROOT;
  if (!hote) return;
  let msg = document.getElementById('dvf-msg');
  // `batir()` remplace tout le contenu de l'écran : un message gardé d'un
  // montage précédent n'est plus dans la page, et le réutiliser reviendrait à
  // écrire dans le vide.
  if (!msg || msg.parentElement !== hote) {
    if (msg) msg.remove();
    msg = el('div', 'msg-flottant');
    msg.id = 'dvf-msg';
    msg.setAttribute('role', 'status');
    hote.appendChild(msg);
  }
  msg.className = `msg-flottant ${cls || ''}`.trim();
  msg.textContent = texte;
  clearTimeout(minuteurMsg);
  minuteurMsg = setTimeout(() => { msg.textContent = ''; }, 4000);
}
