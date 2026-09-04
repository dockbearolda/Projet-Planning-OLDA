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
  APPROS, APPRO_DEFAUT, ARRONDIS, REGIMES, AJUSTEMENT_UNITES, VEDETTES,
  calculerDevis, modeleDevis, dessinerDevis, CSS_DEVIS, jourAtelier, jourPlus,
  SANS_PRIX,
} from './devis.js';
// LE MENU DÉROULANT AVEC RECHERCHE, celui des deux écrans du comptoir. Charlie,
// 01/09 : « ce input doit avoir OBLIGATOIREMENT une fonction recherche COMME
// TOUS LES INPUTS avec un menu déroulant ». Il a déménagé de `pont.js` pour
// qu'il n'en existe qu'UN — voir l'en-tête de `menu-recherche.js`.
import { menuPoser, menuRafraichir, poserStyleMenu } from './menu-recherche.js';
import { api } from './reseau.js';

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
    // L'HEURE SOUHAITÉE (02/09). Une date sans heure, sur une commande qu'on
    // vient chercher, laisse la question entière — « jeudi » ne dit pas si
    // c'est avant midi. Le comptoir la demandait déjà, pas le devis.
    dueHeure: '',
    // « ON DOIT JUSTE INDIQUER SI UNE MAQUETTE EST À FAIRE » (Charlie, 02/09).
    // Le comptoir en fait trois champs — type de logo, statut du logo, maquette.
    // Ici c'est OUI ou NON : ce que l'atelier a besoin de savoir, c'est s'il y a
    // du travail de PAO devant lui.
    maquette: false,
    // LA NOTE INTERNE NE S'IMPRIME PAS. C'est ce qu'on se dit entre nous — une
    // remise accordée de vive voix, un client qui paie toujours en retard. Elle
    // suit le dossier au planning, jamais le papier remis au client.
    noteInterne: '',
    client: {
      nom: '', code: '', adresse: '', ville: '', contact: '', tel: '', email: '', type: 'pro',
      // LE WHATSAPP N'EST PAS LE TÉLÉPHONE. À Saint-Martin, c'est par là qu'on
      // relance : le planning en fait une pastille cliquable (`whatsapp.js`).
      whatsapp: '',
    },
    appro: APPRO_DEFAUT,
    lignes: [],
    regime: 'tgca',
    tauxTgca: 0.04,
    acompte: 50,
    arrondi: 'euro',
    // L'AJUSTEMENT GLOBAL (03/09/2026) — une remise ou une majoration
    // négociée sur l'ensemble du devis, en plus des remises par article.
    // Vide par défaut : rien n'est ajusté tant que personne ne le décide.
    ajustement: { unite: 'eur', valeur: 0 },
    // LA BASCULE VEDETTE (03/09/2026) — quel total est le géant de la
    // feuille. TTC par défaut : c'est ce que le client paie.
    vedette: 'ttc',
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
// ⚠ « AUTRES » A DISPARU (03/09/2026). C'était un bac générique — un 3XL, un
// enfant, une coupe femme comptaient tous pareil, sous le même mot, et le
// devis ne disait plus lequel. Remplacé par les TAILLES LIBRES ci-dessous :
// Charlie voulait pouvoir « créer sa bulle » et lui donner un nom (« 4XL »),
// autant de fois que nécessaire sur une même ligne.
const TAILLES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

// CE QUE LES TAILLES DISENT SUR LE DEVIS : « 2 × S · 3 × M · 3 × 4XL ». C'est
// la grammaire de toute la maison — la fiche de production et le ticket de
// l'atelier comptent ainsi. Le texte est DÉRIVÉ des cases (fixes ET libres) :
// il n'y a qu'une source, et une répartition corrigée à l'écran ne peut pas
// laisser sur le papier celle d'avant.
//
// `taillesLibres` : `[{ nom, qte }, …]` — les bulles créées à la main sur
// CETTE ligne. Un nom vide ou une quantité à zéro ne compte pas : une bulle
// qu'on vient d'ouvrir et qu'on n'a pas encore remplie ne doit ni s'imprimer
// ni peser dans le total.
function texteTailles(parTaille, taillesLibres) {
  const fixes = TAILLES
    .filter((t) => Number((parTaille || {})[t]) > 0)
    .map((t) => `${Number(parTaille[t])} × ${t}`);
  const libres = (Array.isArray(taillesLibres) ? taillesLibres : [])
    .filter((l) => l && String(l.nom || '').trim() && Number(l.qte) > 0)
    .map((l) => `${Number(l.qte)} × ${String(l.nom).trim()}`);
  return [...fixes, ...libres].join(' · ');
}
function totalTailles(parTaille, taillesLibres) {
  const fixes = TAILLES.reduce((s, t) => s + (Number((parTaille || {})[t]) || 0), 0);
  const libres = (Array.isArray(taillesLibres) ? taillesLibres : [])
    .filter((l) => l && String(l.nom || '').trim())
    .reduce((s, l) => s + (Number(l.qte) || 0), 0);
  return fixes + libres;
}
// UN BROUILLON D'AVANT LES CASES porte ses tailles en TEXTE. On le relit plutôt
// que de le jeter : la grammaire est la nôtre, on sait la défaire. Les tailles
// LIBRES n'existaient pas à l'époque de ce format texte : rien à en relire ici,
// `taillesLibres` part toujours d'un tableau vide sur un brouillon ancien.
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
// LA REPRISE D'UN DEVIS EXISTANT (02/09). Charlie : « ce devis pourra être
// modifié directement depuis la ligne pour créer la v2, 3, 4… dans le cas où le
// client souhaite une modification ». `repriseDe` porte l'id du dossier tant que
// la nouvelle version n'est pas enregistrée ; `version` dit à l'écran laquelle
// on est en train d'écrire.
let repriseDe = null;
let version = 1;

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
    // du texte, seule écriture qu'elle en avait. Une ligne d'avant les tailles
    // LIBRES (03/09) n'en a simplement aucune.
    for (const l of saisie.lignes) {
      if (!l.parTaille || typeof l.parTaille !== 'object') l.parTaille = lireTailles(l.tailles);
      if (!Array.isArray(l.taillesLibres)) l.taillesLibres = [];
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
  const c = el('details', 'reg-card dvf-cat volet-plus volet-carte');
  // FERMÉES AU DÉPART (02/09, Charlie : « par défaut ces bulles doivent être
  // fermé »). Quatre catégories dépliées, c'est trois écrans à franchir avant
  // d'arriver aux articles — et sur un devis sur trois, le client est déjà en
  // base et la fiscalité ne bouge pas. Ce qu'on a ouvert reste ouvert : le pli
  // part avec le brouillon, par appareil.
  c.open = replis[cle] === true;
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
  const c = el('div', 'rang');
  // L'INTITULÉ NE PORTE PLUS `fa-lab` (02/09) : `.rang__k` déclare lui-même le
  // cran, la graisse et l'encre du comptoir, dans `charte.css`. L'écran de
  // vente, qui porte la même rangée, ne charge pas `fiche-atelier.css` — une
  // police écrite dans deux fichiers pour un seul composant, c'est deux polices
  // le jour où l'un des deux bouge.
  const lab = el('label', 'rang__k', nom);
  const boite = el('div', 'rang__v');
  boite.append(noeud);
  if (noeud.id) lab.setAttribute('for', noeud.id);
  c.append(lab, boite);
  return c;
}

// UNE COLONNE DE RANGÉES. Les traits de séparation viennent de la grille, pas
// de chaque rangée : une bordure écrite par rangée en pose une de trop en bas.
function feuille(...rangs) {
  const g = el('div', 'rangs');
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

// LE SÉLECTEUR SEGMENTÉ DE LA CHARTE (`.segmente`, `public/charte.css`) — deux
// à quatre choix qui tiennent sur une ligne, dont un seul est actif. C'est
// déjà celui de la fiche client (nature pro/perso) : un composant partagé,
// pas un qui lui ressemble.
function segmente(id, options, valeur, onChange) {
  const n = el('div', 'segmente');
  n.id = id;
  n.setAttribute('role', 'radiogroup');
  for (const o of options) {
    const on = String(o.id) === String(valeur);
    const b = el('button', `segmente__btn${on ? ' is-on' : ''}`, o.label);
    b.type = 'button';
    b.dataset.valeur = String(o.id);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    n.append(b);
  }
  n.addEventListener('click', (e) => {
    const b = e.target.closest('.segmente__btn');
    if (!b || !n.contains(b)) return;
    segmenteRegle(n, b.dataset.valeur);
    onChange(b.dataset.valeur);
  });
  return n;
}
// LE SEGMENTÉ REPREND UNE VALEUR POSÉE PAR PROGRAMME (reprise d'un devis,
// devis vierge) — les boutons ne le voient pas tout seuls, contrairement à un
// `<select>` dont `remettreChamps()` pose `.value`.
function segmenteRegle(n, valeur) {
  if (!n) return;
  for (const b of n.querySelectorAll('.segmente__btn')) {
    const on = b.dataset.valeur === String(valeur);
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  }
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

// ===========================================================================
// REPRENDRE UN DEVIS — la V2, la V3 (02/09/2026)
// ===========================================================================
// « Ce devis pourra être modifié directement depuis la ligne pour créer la v2,
// 3, 4… dans le cas où le client souhaite une modification » (Charlie).
//
// ON RELIT L'ARCHIVE, PAS UN RÉSUMÉ. `fiche.devis` porte le devis TEL QU'IL A
// ÉTÉ IMPRIMÉ — ses lignes, ses prix, son régime, son acompte. C'est ce qu'il
// faut pour repartir de ce que le client a en main : une V2 qui ne reprendrait
// que le client et le projet obligerait à retaper les articles, et c'est
// exactement là qu'on se trompe d'un chiffre.
//
// ⚠ ELLE N'ÉCRASE PAS UN BROUILLON SANS LE DIRE. Le poste peut être en train de
// composer un autre devis : on demande.
export async function reprendreDevis(id) {
  if (!ROOT || !id) return false;
  let ligne;
  try { ligne = await api('GET', `/api/requests/${id}`); } catch (err) {
    dire(err.message || 'Dossier illisible', 'is-ko');
    return false;
  }
  const fiche = ligne && ligne.fiche && typeof ligne.fiche === 'object' ? ligne.fiche : null;
  const dv = fiche && fiche.devis && typeof fiche.devis === 'object' ? fiche.devis : null;
  if (!dv) {
    dire('Ce dossier ne porte pas de devis à reprendre', 'is-ko');
    return false;
  }
  if (!dossierId && saisie.lignes.length && repriseDe !== id
    && !window.confirm('Un devis est en cours sur ce poste. Le remplacer par la reprise de celui-ci ?')) {
    return false;
  }

  const neuve = saisieNeuve();
  saisie = {
    ...neuve,
    // LE NUMÉRO NE SE REPREND PAS : le serveur en pose un neuf, « …-V2 ». Garder
    // celui de la V1 ferait deux feuilles au même numéro pour deux montants.
    numero: '',
    date: neuve.date,
    validite: dv.validite || neuve.validite,
    projet: dv.projet || '',
    dueDate: ligne.deadline ? String(ligne.deadline).slice(0, 10) : '',
    dueHeure: fiche.dueHeure || '',
    maquette: fiche.maquette === true,
    noteInterne: fiche.noteInterne || '',
    appro: dv.appro || neuve.appro,
    regime: dv.regime || neuve.regime,
    tauxTgca: Number(dv.tauxTgca) || neuve.tauxTgca,
    arrondi: dv.arrondi || neuve.arrondi,
    acompte: dv.acompte && dv.acompte.pourcent != null ? Number(dv.acompte.pourcent) : neuve.acompte,
    ajustement: dv.ajustement && typeof dv.ajustement === 'object'
      ? { unite: dv.ajustement.unite === 'pct' ? 'pct' : 'eur', valeur: Number(dv.ajustement.valeur) || 0 }
      : neuve.ajustement,
    vedette: dv.vedette === 'ht' ? 'ht' : neuve.vedette,
    client: {
      ...neuve.client,
      nom: ligne.billing_company || '',
      code: valeurClient(fiche, 'Code client'),
      ville: valeurClient(fiche, 'Ville'),
      contact: ligne.contact_referent || '',
      tel: ligne.contact_phone || '',
      whatsapp: valeurClient(fiche, 'WhatsApp') || ligne.contact_phone || '',
      email: ligne.contact_email || '',
      type: ligne.client_type === 'perso' ? 'perso' : 'pro',
    },
    lignes: (Array.isArray(dv.lignes) ? dv.lignes : []).map((l) => ({
      designation: l.designation || '', reference: l.reference || '', couleur: l.couleur || '',
      tailles: l.tailles || '', marquage: l.marquage || '', encre: l.encre || '',
      faces: l.faces || '', note: l.note || '',
      parTaille: lireTailles(l.tailles),
      remise: Number(l.remise) || 0,
      quantite: Number(l.quantite) || 0,
      // UNE V2 REPART DES PRIX DE LA V1 — y compris de ce qui n'en avait pas.
      // Un article resté « à chiffrer » ne doit pas devenir zéro en changeant
      // de version : ce serait la promesse de le donner.
      unitaireHt: l.sansPrix || l.unitaireHt == null || l.unitaireHt === ''
        ? null : (Number(l.unitaireHt) || 0),
      // ⚠ LE PRIX REPRIS EST TENU POUR MANUEL. Il a été remis au client sur une
      // feuille : le moteur ne doit pas le refaire tout seul parce qu'un tarif a
      // bougé depuis. « Recalculer » le rend, article par article, quand on veut.
      puManuel: true,
      textile: null, tasse: null, libre: null, simple: false,
    })),
  };
  repriseDe = id;
  version = Math.max(1, Math.round(Number(fiche.version) || 1));
  dossierId = null;
  remettreChamps();
  poserLignes();
  redessiner();
  dire(`Devis ${dv.numero || ''} repris — vous écrivez la version ${version + 1}`.trim(), 'is-ok');
  return true;
}

// Le client d'une fiche est une liste de paires : c'est le format d'archive, et
// il n'y a pas de raison de le changer pour une lecture.
function valeurClient(fiche, cle) {
  const l = Array.isArray(fiche.client) ? fiche.client : [];
  const p = l.find((x) => x && x.k === cle);
  return p ? String(p.v || '') : '';
}

// LES CHAMPS SE REMPLISSENT DEPUIS LA SAISIE. Le squelette est posé une fois et
// ne se reconstruit pas (il reprendrait le curseur) : quand la saisie change en
// bloc — une reprise, un devis vierge — c'est à l'écran de redescendre dedans.
function remettreChamps() {
  for (const [id, v] of [
    ['#dvf-cl-nom', saisie.client.nom], ['#dvf-cl-code', saisie.client.code],
    ['#dvf-cl-ville', saisie.client.ville], ['#dvf-cl-email', saisie.client.email],
    ['#dvf-cl-contact', saisie.client.contact], ['#dvf-cl-tel', saisie.client.tel],
    ['#dvf-cl-wa', saisie.client.whatsapp], ['#dvf-cherche', saisie.client.nom],
    ['#dvf-projet', saisie.projet], ['#dvf-due', saisie.dueDate],
    ['#dvf-heure', saisie.dueHeure], ['#dvf-validite', saisie.validite],
    ['#dvf-note-interne', saisie.noteInterne], ['#dvf-appro', saisie.appro],
    ['#dvf-regime', saisie.regime], ['#dvf-arrondi', saisie.arrondi],
    ['#dvf-acompte', String(saisie.acompte)],
    ['#dvf-ajustement-unite', saisie.ajustement.unite],
    ['#dvf-ajustement-valeur', saisie.ajustement.valeur ? String(saisie.ajustement.valeur) : ''],
    ['#dvf-maquette', saisie.maquette ? 'oui' : 'non'],
  ]) {
    const n = $(id);
    if (n) n.value = v == null ? '' : v;
  }
  // Les menus déjà habillés ne voient pas une valeur posée par programme.
  for (const id of ['#dvf-appro', '#dvf-regime', '#dvf-arrondi', '#dvf-ajustement-unite', '#dvf-maquette']) {
    const n = $(id);
    if (n) menuRafraichir(n);
  }
  // LE SEGMENTÉ N'A PAS DE `.value` : ses boutons se règlent à part.
  segmenteRegle($('#dvf-vedette'), saisie.vedette);
}

async function rechargerReglages() {
  const [cl, cat, ent, par, tr, tex, logos, grilleTasse] = await Promise.all([
    api('GET', '/api/clients').catch(() => []),
    api('GET', '/api/catalogue-produits').catch(() => []),
    api('GET', '/api/settings/entreprise').catch(() => ({})),
    api('GET', '/api/tarifs-tasse/parametres').catch(() => null),
    api('GET', '/api/tarifs-transport').catch(() => ({})),
    api('GET', '/api/settings/textile').catch(() => null),
    api('GET', '/api/tailles-logo').catch(() => null),
    api('GET', '/api/tarifs-tasse').catch(() => []),
  ]);
  clients = Array.isArray(cl) ? cl : [];
  catalogue = Array.isArray(cat) ? cat : [];
  entreprise = ent && typeof ent === 'object' ? ent : {};
  transports = tr && typeof tr === 'object' ? tr : {};
  if (par && Number.isFinite(Number(par.tgca))) saisie.tauxTgca = Number(par.tgca);
  reglagesTextile = tex && typeof tex === 'object' ? tex : null;
  rangerTarifsTasse(grilleTasse);
  // LES FACES DE TOUTES LES FAMILLES, dédoublonnées et dans l'ordre du tableau.
  // Une face qui n'existe que pour la tasse doit rester proposable : le devis ne
  // sait pas encore quelle famille porte la ligne.
  const familles = logos && Array.isArray(logos.familles) ? logos.familles : [];
  facesConnues = [...new Set(familles.flatMap((f) => (Array.isArray(f.faces) ? f.faces : [])))];
  // ⚠ DÉFAUT CORRIGÉ LE 02/09 : le devis chiffrait avec les réglages PAR DÉFAUT
  // du moteur (7,56 € le mètre de DTF, 25 € l'heure…), pendant que le comptoir
  // chiffrait avec ceux de l'atelier, gardés en base depuis toujours
  // (`app_meta.textile_settings`). Deux écrans à un clic l'un de l'autre, deux
  // prix pour le même t-shirt — et rien à l'écran ne le disait.
  //
  // Le moteur peut arriver APRÈS ces réglages (il se charge au premier textile
  // posé) : on les garde donc, et `moteurTextile()` les repose à chaque fois.
  poserReglagesMoteur();
  remplirCatalogue();
}

// LES RÉGLAGES DE L'ATELIER, DANS LE MOTEUR. Une seule écriture, appelée aussi
// bien quand les réglages arrivent que quand le moteur arrive : lequel des deux
// est là en premier ne se décide pas, il se constate.
let reglagesTextile = null;
function poserReglagesMoteur() {
  if (!reglagesTextile || !window.TextileEngine) return;
  try { window.TextileEngine.setSettings(reglagesTextile); } catch (_) { /* moteur d'une autre version */ }
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
  deux.append(saisieCol, poignee(deux), apercu);
  ROOT.append(deux);
  deux.style.setProperty('--dvf-gauche', partGauche());

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

// ===========================================================================
// LA POIGNÉE — la coupe se règle à la main (02/09/2026)
// ===========================================================================
// Charlie : « entre ça et ça doit y avoir une barre réglable verticalement à la
// main ». Le partage était écrit une fois pour tous les postes ; ce qu'on
// regarde, lui, change avec le devis — une désignation longue veut de la
// saisie, une relecture avant impression veut du papier.
//
// LA PART EST RETENUE PAR LE POSTE, pas par le devis : c'est un réglage
// d'écran, pas une donnée. Elle ne part donc PAS dans le brouillon — un devis
// repris sur une autre machine ne doit pas y déplacer la coupe.
const CLE_PART = 'olda.devis.part';
// Les bornes : en deçà, la saisie ne montre plus une rangée d'article entière ;
// au-delà, la feuille n'est plus lisible à deux. Ce sont des pourcentages,
// parce que c'est ce que la grille attend.
const PART_MIN = 30;
const PART_MAX = 78;
const PART_DEFAUT = 57;
const borner = (n) => Math.min(PART_MAX, Math.max(PART_MIN, n));

function partGauche() {
  const brut = Number(String(localStorage.getItem(CLE_PART) || '').replace('%', ''));
  return `${Number.isFinite(brut) && brut ? borner(brut) : PART_DEFAUT}%`;
}

function poignee(deux) {
  const b = el('div', 'dvf-poignee');
  b.id = 'dvf-poignee';
  b.tabIndex = 0;
  b.setAttribute('role', 'separator');
  b.setAttribute('aria-orientation', 'vertical');
  b.setAttribute('aria-label', 'Largeur de la saisie');

  const poser = (pct) => {
    const v = borner(pct);
    deux.style.setProperty('--dvf-gauche', `${v}%`);
    b.setAttribute('aria-valuenow', String(Math.round(v)));
    try { localStorage.setItem(CLE_PART, String(v)); } catch (_) { /* plein ou refusé */ }
    // La feuille se remet à l'échelle de sa nouvelle moitié. Le ResizeObserver
    // s'en charge aussi, mais il arrive à l'image suivante : appelé ici, le
    // papier suit la poignée au lieu de la rattraper.
    mettreALEchelle();
  };
  const partDe = (x) => {
    const r = deux.getBoundingClientRect();
    return r.width ? ((x - r.left) / r.width) * 100 : PART_DEFAUT;
  };

  // ⚠ LE GLISSER SE SUIT SUR LA FENÊTRE, PAS SUR LA POIGNÉE. Elle fait 9 px de
  // large : le pointeur en sort à la première image, et des écouteurs posés sur
  // elle ne verraient que le premier mouvement. `setPointerCapture` répond à ça
  // — mais il n'est pas garanti (un pointeur déjà relâché le refuse), et un
  // glisser qui dépend de lui reste planté là où on l'a lâché. On prend donc
  // les deux : la capture quand elle veut bien, la fenêtre dans tous les cas.
  let tire = false;
  const bouger = (e) => { if (tire) poser(partDe(e.clientX)); };
  const lacher = () => {
    if (!tire) return;
    tire = false;
    window.removeEventListener('pointermove', bouger);
    window.removeEventListener('pointerup', lacher);
    // `pointercancel` : un geste interrompu (une autre fenêtre qui prend la
    // main) ne doit pas laisser l'écran en « je tire » — plus rien ne se
    // sélectionnerait.
    window.removeEventListener('pointercancel', lacher);
    b.classList.remove('est-tiree');
    ROOT.classList.remove('est-tiree');
  };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    tire = true;
    try { b.setPointerCapture(e.pointerId); } catch (_) { /* la fenêtre suffit */ }
    b.classList.add('est-tiree');
    ROOT.classList.add('est-tiree');
    window.addEventListener('pointermove', bouger);
    window.addEventListener('pointerup', lacher);
    window.addEventListener('pointercancel', lacher);
  });

  // AU CLAVIER AUSSI. Le PC est la seule cible de ce projet : ce qui s'attrape
  // à la souris s'atteint aux flèches.
  b.addEventListener('keydown', (e) => {
    const pas = e.shiftKey ? 10 : 2;
    const actuel = parseFloat(getComputedStyle(deux).getPropertyValue('--dvf-gauche')) || PART_DEFAUT;
    if (e.key === 'ArrowLeft') poser(actuel - pas);
    else if (e.key === 'ArrowRight') poser(actuel + pas);
    else if (e.key === 'Home') poser(PART_MIN);
    else if (e.key === 'End') poser(PART_MAX);
    else return;
    e.preventDefault();
  });
  // Un double-clic remet la coupe d'origine : c'est le geste attendu d'une
  // poignée, et ça évite de la chercher au pixel quand on l'a trop tirée.
  b.addEventListener('dblclick', () => poser(PART_DEFAUT));

  b.setAttribute('aria-valuemin', String(PART_MIN));
  b.setAttribute('aria-valuemax', String(PART_MAX));
  b.setAttribute('aria-valuenow', String(parseFloat(partGauche())));
  return b;
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
  // L'ADRESSE DU CLIENT EST UNE MENTION OBLIGATOIRE DE LA FACTURE (03/09/2026)
  // — pas une coordonnée de confort comme le WhatsApp. Elle est ici, et pas
  // seulement dans l'écran de vente, parce que les deux cartes client sont le
  // MÊME composant à un clic l'une de l'autre : un champ posé dans une seule
  // des deux en refait deux cartes différentes dès que l'une bouge.
  const adresse = entree('dvf-cl-adresse', { valeur: saisie.client.adresse, exemple: 'Numéro et rue' });
  const ville = entree('dvf-cl-ville', { valeur: saisie.client.ville, exemple: '97150 Saint-Martin' });
  const email = entree('dvf-cl-email', { type: 'email', valeur: saisie.client.email, exemple: 'facultatif' });
  const contact = entree('dvf-cl-contact', { valeur: saisie.client.contact, exemple: 'facultatif' });
  const tel = entree('dvf-cl-tel', { type: 'tel', valeur: saisie.client.tel, exemple: 'facultatif' });
  const wa = entree('dvf-cl-wa', { type: 'tel', valeur: saisie.client.whatsapp, exemple: '0690 12 34 56' });
  // ⚠ PAS DE « TYPE DE CLIENT » ICI (retiré le 02/09, Charlie : « c'est en
  // automatique à la création du client »). Un client choisi dans la base
  // apporte le sien ; un client inconnu le reçoit quand il entre en base. Une
  // case de plus à remplir pour une valeur que personne ne corrigeait.
  // `saisie.client.type` ne bouge pas pour autant : il voyage jusqu'au planning.
  corps.append(feuille(
    rang('Client / société', nom), rang('Code client', code),
    rang('Adresse', adresse), rang('Ville', ville),
    rang('E-mail', email), rang('Personne à contacter', contact),
    rang('Téléphone', tel), rang('WhatsApp', wa),
  ));

  for (const [n, cle] of [[nom, 'nom'], [code, 'code'], [adresse, 'adresse'], [ville, 'ville'],
    [email, 'email'], [contact, 'contact'], [tel, 'tel'], [wa, 'whatsapp']]) {
    n.addEventListener('input', () => { saisie.client[cle] = n.value; redessiner(); });
  }

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
    adresse: cl.adresse || '',
    // `zone` EN REPLI DE `ville` : la fiche client porte les deux, et c'est
    // `zone` qui est remplie (76 fiches sur 168 le 03/09, contre 5 pour
    // `ville`). Sans ce repli, la localité existe en base et le papier sort
    // quand même sans elle.
    ville: cl.ville || cl.zone || '',
    contact: cl.nom || '',
    tel: cl.telephone || '',
    // La base clients ne tient qu'UN numéro : il sert des deux côtés tant que
    // personne n'en a saisi un second ici.
    whatsapp: cl.whatsapp || cl.telephone || '',
    email: cl.email || '',
    type: cl.type === 'perso' ? 'perso' : 'pro',
  };
  for (const [id, v] of [['#dvf-cl-nom', saisie.client.nom], ['#dvf-cl-code', saisie.client.code],
    ['#dvf-cl-adresse', saisie.client.adresse],
    ['#dvf-cl-ville', saisie.client.ville], ['#dvf-cl-email', saisie.client.email],
    ['#dvf-cl-contact', saisie.client.contact], ['#dvf-cl-tel', saisie.client.tel],
    ['#dvf-cl-wa', saisie.client.whatsapp]]) {
    const n = $(id);
    if (n) n.value = v;
  }
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
  const heure = entree('dvf-heure', { type: 'time', valeur: saisie.dueHeure });
  const val = entree('dvf-validite', { type: 'date', valeur: saisie.validite });
  const maq = menu('dvf-maquette', [
    { id: 'non', label: 'Non — le client fournit son visuel' },
    { id: 'oui', label: 'Oui — maquette à créer' },
  ], saisie.maquette ? 'oui' : 'non');
  const interne = entree('dvf-note-interne', { valeur: saisie.noteInterne, exemple: 'Ne figure pas sur le devis' });
  corps.append(feuille(
    rang('Nom du projet', projet), rang('Approvisionnement', appro),
    rang('Date souhaitée client', due), rang('Heure souhaitée', heure),
    rang('Validité du devis', val),
    rang('Maquette à faire', maq),
    rang('Note interne', interne),
  ));

  // ⚠ L'ÉTAT DU DÉLAI EST RETIRÉ (02/09, Charlie : « on s'en fout »). Une bande
  // colorée redisait, sous le menu, ce que le menu venait de dire — « Commande
  // groupée » → « Dépend de la prochaine commande groupée ». Le texte
  // commercial du délai, lui, reste : il est SUR LE DEVIS, où il sert.

  projet.addEventListener('input', () => { saisie.projet = projet.value; redessiner(); });
  due.addEventListener('change', () => { saisie.dueDate = due.value; redessiner(); });
  heure.addEventListener('change', () => { saisie.dueHeure = heure.value; redessiner(); });
  maq.addEventListener('change', () => { saisie.maquette = maq.value === 'oui'; redessiner(); });
  // LA NOTE INTERNE NE REDESSINE PAS LA FEUILLE : elle n'y figure pas. Elle
  // n'écrit que dans la saisie — et le brouillon la garde.
  interne.addEventListener('input', () => { saisie.noteInterne = interne.value; garderBrouillon(); });
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
const COLONNES = ['Désignation', 'Qté', 'PU HT', 'PU TTC', 'Total', ''];

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
  const tab = el('div', 'lignes');
  const tete = el('div', 'lignes__tete');
  tete.id = 'dvf-tab-tete';
  for (const nom of COLONNES) tete.append(el('span', 'fa-lab', nom));
  tab.append(tete);
  const liste = el('div', 'lignes__corps');
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
  if (!listeProduits) return;
  parNom.clear();
  const frag = document.createDocumentFragment();
  for (const p of catalogue) {
    // UN PRODUIT ÉTEINT NE SE PROPOSE PAS — c'est la règle du menu du comptoir
    // (`catalogue.js`) et de la vente directe (`pont.js`) ; trois écrans, une
    // seule base, et donc la même liste.
    if (p.actif === false) continue;
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
  // ⚠ LES RÉGLAGES SE REPOSENT À CHAQUE APPEL, pas seulement au chargement du
  // moteur. Il vit sur `window` : il survit à un changement d'onglet, alors que
  // les réglages, eux, sont relus à chaque montage de l'écran. Posés au seul
  // `onload`, un moteur déjà chargé gardait les valeurs de la fois d'avant —
  // et un coût de DTF corrigé aux Réglages ne prenait qu'au rechargement de la
  // page. Les reposer coûte une affectation d'objet.
  poserReglagesMoteur();
  if (window.TextileEngine) return Promise.resolve(window.TextileEngine);
  if (!moteurEnRoute) {
    moteurEnRoute = new Promise((tenu, rompu) => {
      const s = document.createElement('script');
      s.src = CHEMIN_MOTEUR;
      s.onload = () => {
        if (!window.TextileEngine) return rompu(new Error('Moteur textile illisible'));
        // Le moteur arrive avec SES valeurs par défaut : les réglages de
        // l'atelier se posent AVANT le premier calcul, jamais après.
        poserReglagesMoteur();
        return tenu(window.TextileEngine);
      };
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
// LES COULEURS D'ENCRE ET LES FACES — deux listes posées UNE fois pour tout
// l'écran, comme celle des produits. Les encres viennent du moteur (elles
// décident du rendu, pas du prix), les faces du tableau des tailles de logo,
// qui les déclare par famille : c'est la source de la fiche de l'atelier et du
// ticket, pas une liste réécrite ici.
const ID_ENCRES = 'dvf-encres';
const ID_FACES = 'dvf-faces';
function poserListe(id, valeurs) {
  if (!valeurs.length) return false;
  let liste = document.getElementById(id);
  if (!liste) {
    liste = el('datalist');
    liste.id = id;
    ROOT.append(liste);
  }
  if (liste.options.length) return true;
  for (const v of valeurs) {
    const o = el('option');
    o.value = v;
    liste.append(o);
  }
  return true;
}
// Habiller un champ APRÈS coup : le composant remplace le champ dans la page,
// il faut donc qu'il y soit déjà — et une seule fois, sinon on empile les peaux.
function habiller(champLa, id, valeurs) {
  if (!champLa || champLa.dataset.menuListe === id) return;
  if (!poserListe(id, valeurs)) return;
  champLa.setAttribute('list', id);
  menuPoser(champLa);
}
let facesConnues = [];
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
  // Une référence libre sans prix d'achat ne se chiffre pas : le moteur rendrait
  // `null` et le prix saisi resterait ce qu'il est — c'est ce qu'on veut.
  const quantite = Math.max(0, Number(ligne.quantite) || 0);
  if (!quantite) return null;
  let TE;
  try { TE = await moteurTextile(); } catch (err) { dire(err.message, 'is-ko'); return null; }
  const compte = TE.calculate({
    ref: ligne.textile.ref,
    // UNE RÉFÉRENCE LIBRE SE CHIFFRE COMME LES AUTRES (02/09). Le moteur sait le
    // faire depuis toujours — il lui faut un prix d'achat, et il refuse
    // poliment (rend `null`) s'il n'en a pas. C'est ce qui permet de chiffrer un
    // article qu'on n'a jamais vendu sans l'entrer d'abord au catalogue.
    isCustom: !!ligne.libre,
    customRef: ligne.libre ? ligne.libre.ref : '',
    customPurchase: ligne.libre ? ligne.libre.achat : '',
    customDesignation: ligne.libre ? ligne.libre.designation : '',
    genre: ligne.textile.genre,
    transport: TRANSPORT_MOTEUR,
    printType: ligne.marquage || MARQUAGE_AUCUN,
    // LES TAILLES DU DEVIS SONT UN TEXTE (« 2 × S · 3 × M »), le moteur compte
    // des pièces. Seule la QUANTITÉ entre dans le calcul — le coefficient est
    // dégressif sur le total, pas sur la répartition — et c'est elle qu'on lui
    // donne. La répartition reste ce que la ligne dit au client.
    sizes: { other: quantite },
    // LA REMISE EST CELLE DE LA LIGNE. Le moteur l'applique AVANT l'arrondi
    // commercial — c'est l'ordre du fichier V9, et l'inverse rendrait des prix
    // qui ne tombent pas sur le pas d'arrondi.
    discount: ligne.remise || '',
    manualPrice: '',
    // Les coefficients du fichier V9 portent déjà la marge : une majoration de
    // plus la compterait deux fois.
    markupPercent: 0,
  });
  if (!compte) return null;
  ligne.unitaireHt = Math.round(compte.sold * 100) / 100;
  return ligne.unitaireHt;
}

// ===========================================================================
// LA TASSE — MÊME BASE, SA PROPRE GRILLE
// ===========================================================================
// ⚠ DÉFAUT DU 02/09 : UNE TASSE SORTAIT À 0,00 € SUR LE PAPIER DU CLIENT.
// L'écran connaissait deux prix — celui du moteur textile et le prix de rayon
// du catalogue — et la maison en a TROIS. Une tasse n'a pas de prix de rayon
// (les dix-sept lignes « TC 01 … TC 17 » du catalogue sont des DÉCORS, pas des
// tarifs) et elle ne passe pas par le moteur V9. Elle s'ADDITIONNE, depuis la
// grille que le comptoir emploie déjà : la tasse nue, plus chaque face, plus le
// dessous, plus le BAT.
//
// C'EST LA GRILLE QUI FAIT FOI, PAS UN NOMBRE RECOPIÉ ICI. Le prix de rayon
// d'une tasse (16 €) est la tasse nue (10 €) plus une face (6 €) : l'écrire en
// dur, c'est le jour où le patron corrige sa grille avoir deux prix pour une
// tasse — et le devis dirait celui d'avant. Même règle que le tarif de
// transport et que les six réglages du moteur.
//
// LE JOINT ENTRE LES DEUX TABLES EST LE NOM DE LA FAMILLE. Le catalogue range
// ses décors sous « Tasse céramique 350 ml » ; la grille nomme son produit
// « Tasse Céramique 350 ml ». C'est le même objet à une majuscule près : on
// compare donc À PLAT (sans casse, sans accent). Une famille qui ne tombe sur
// aucun produit de la grille reste un article de rayon ordinaire — c'est ce qui
// laisse « Tasses » et « Mug », vendues toutes faites et tarifées à l'import,
// suivre le chemin des goodies.
let tarifsTasse = [];
const tasseParId = new Map();
// Deux noms qui ne diffèrent que par une majuscule ou un accent désignent la
// même chose. Une seule écriture de cette mise à plat : deux qui se ressemblent
// finiraient par ne plus s'accorder.
const aPlat = (v) => String(v == null ? '' : v)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

function rangerTarifsTasse(liste) {
  tarifsTasse = (Array.isArray(liste) ? liste : []).filter((a) => a && a.actif !== false);
  tasseParId.clear();
  for (const a of tarifsTasse) tasseParId.set(String(a.id), a);
}
const optionsTasse = (categorie) => tarifsTasse.filter((a) => a.categorie === categorie);
// LES PUCES D'UNE CATÉGORIE, DANS LA FORME QUE LE MENU ATTEND. `menu()` lit
// `label` ; la grille du patron écrit `designation`. Sans cette traduction les
// sept options sortaient VIDES — le prix était juste, la liste illisible.
const puces = (categorie) => optionsTasse(categorie).map((a) => ({ id: a.id, label: a.designation }));
// LA CASE « RIEN » D'UNE CATÉGORIE. La grille la nomme « Aucune » pour les faces
// et le dessous, « Non » pour le BAT : c'est celle qui ne coûte rien et qui ne
// s'imprime pas sur le devis.
const estRien = (a) => !a || /^(aucun|aucune|non)$/.test(aPlat(a.designation));
const idRien = (categorie) => {
  const a = optionsTasse(categorie).find(estRien);
  return a ? a.id : '';
};

// UNE TASSE ARRIVE MARQUÉE D'UNE FACE, PAS NUE. « Le composant est la tasse
// NUE, le prix de rayon c'est elle plus une face » (01/09) : posée sans face,
// elle sortirait à 10 € quand le magasin la vend 16, et c'est exactement
// l'écart de six euros déjà payé une fois sur la grille.
//
// LA FACE CHOISIE EST CELLE DU CAS COURANT — un client qui demande un devis
// veut SON logo dessus. Si le patron la renomme, on retombe sur la première
// face de sa grille qui coûte quelque chose : le prix reste juste, seul
// l'intitulé change, et il est sous les yeux de la vendeuse.
const FACE_DEVIS = 'Logo client vectorisé';
function faceParDefaut() {
  const faces = optionsTasse('face');
  const voulue = faces.find((a) => aPlat(a.designation) === aPlat(FACE_DEVIS));
  const payante = faces.find((a) => !estRien(a) && Number(a.prixVenteTtc) > 0);
  return (voulue || payante || faces[0] || { id: '' }).id;
}

// Le produit de la grille qui correspond à une famille du catalogue, ou `null`.
function produitTasse(famille) {
  const f = aPlat(famille);
  if (!f) return null;
  return optionsTasse('produit').find((a) => aPlat(a.designation) === f) || null;
}

// LE PRIX D'UNE TASSE — une addition, et rien d'autre. C'est la formule du
// comptoir (`buildLigneTasse`, server.js) : produit + face 1 + face 2 + dessous
// + BAT, en TTC, converti au HT du devis.
//
// LA REMISE EST DEDANS, comme sur un textile : le moteur l'applique lui-même,
// et une ligne qui se chiffre ne doit pas voir son prix retouché par ailleurs —
// deux mains sur le même nombre, ce sont deux remises composées.
function chiffrerTasse(ligne) {
  if (!ligne || !ligne.tasse || ligne.puManuel) return null;
  const t = ligne.tasse;
  const parts = [t.produitId, t.face1Id, t.face2Id, t.dessousId, t.batId]
    .map((id) => tasseParId.get(String(id)))
    .filter(Boolean);
  if (!parts.length) return null;
  const ttc = parts.reduce((somme, a) => somme + (Number(a.prixVenteTtc) || 0), 0);
  const ht = saisie.tauxTgca ? ttc / (1 + saisie.tauxTgca) : ttc;
  const remise = ligne.remise ? ht * (1 - ligne.remise / 100) : ht;
  ligne.unitaireHt = Math.round(remise * 100) / 100;
  return ligne.unitaireHt;
}

// CE QUE LE CLIENT RELIT SUR SON DEVIS. Les faces d'une tasse sont ce qu'on lui
// vend : elles vont dans la colonne `faces`, celle que le papier imprime déjà
// pour les autres articles. Une option « Aucune » ne s'écrit pas — c'est la
// règle de toutes les cases du document.
function texteFacesTasse(ligne) {
  const t = ligne && ligne.tasse;
  if (!t) return '';
  const bouts = [];
  for (const [cle, quoi] of [['face1Id', 'Face 1'], ['face2Id', 'Face 2'], ['dessousId', 'Dessous']]) {
    const a = tasseParId.get(String(t[cle]));
    if (a && !estRien(a)) bouts.push(`${quoi} : ${a.designation}`);
  }
  const bat = tasseParId.get(String(t.batId));
  if (bat && !estRien(bat)) bouts.push('BAT');
  return bouts.join(' · ');
}

// CHOISIR UN PRODUIT SUR UNE LIGNE QUI EXISTE DÉJÀ. C'est le seul chemin depuis
// le 01/09 : la liste « Ajouter un article du catalogue » de la barre est
// partie, le choix se fait dans la DÉSIGNATION de la ligne.
//
// Il vaut aussi pour une désignation TAPÉE : si elle tombe exactement sur un
// produit du catalogue, la ligne gagne sa référence et son prix. Taper le nom
// exact d'un produit, c'est le désigner.
//
// CHOISIR UN PRODUIT, C'EST EN CHANGER — ET LE PRIX SUIT, TOUJOURS.
// ⚠ DÉFAUT DU 02/09 (Charlie : « peu importe où je clique, c'est toujours le
// même prix »). Le prix de rayon ne se posait que sur une ligne SANS prix, au nom
// d'une remise négociée à protéger : une ligne qui avait été une tasse à
// 15,38 € restait à 15,38 € en devenant une planche à 18,27 € — avec la teinte
// du décor et la face de la tasse en prime, mesuré sur sa capture d'écran. Ce
// que la règle protégeait arrive une fois par mois ; ce qu'elle empêchait,
// c'est de changer d'article. Un prix négocié se retape après, comme sur toute
// ligne — et une désignation corrigée qui ne tombe sur AUCUN produit du
// catalogue ne passe pas par ici : elle ne touche à rien.
function choisirProduit(ligne, nom, apres) {
  const p = parNom.get(String(nom || '').trim());
  if (!p) return false;
  const etaitTasse = !!ligne.tasse;
  const etaitTextile = !!ligne.textile;
  // CE QUI APPARTENAIT À L'ARTICLE D'AVANT NE SUIT PAS : le prix repris à la
  // main (le moteur et la grille reprennent la main), la référence libre, et
  // pour une tasse la teinte de son décor et les faces de sa grille.
  ligne.puManuel = false;
  ligne.libre = null;
  ligne.reference = p.reference || '';
  if (p.couleur) ligne.couleur = p.couleur;
  else if (etaitTasse) ligne.couleur = '';
  if (etaitTasse) ligne.faces = '';
  if (p.famille === FAMILLE_TEXTILE) {
    // UN T-SHIRT N'A PAS DE PRIX DE RAYON, il se CHIFFRE : quantité, marquage
    // et genre. `note` porte le genre du moteur — c'est lui qui choisit la
    // table des temps ; introuvable, il vaudrait zéro mètre de DTF, donc un
    // marquage facturé 2,30 € au lieu de 9,90 €.
    ligne.textile = { ref: p.reference || '', genre: p.note || '' };
    ligne.tasse = null;
    if (!ligne.marquage) ligne.marquage = MARQUAGE_AUCUN;
    // Tant que le moteur n'a pas répondu, la ligne est « à chiffrer » — pas au
    // prix de l'article d'avant. Moteur injoignable : elle le reste, et le dit.
    ligne.unitaireHt = null;
    ligne.pleinHt = null;
    chiffrerTextile(ligne).then(() => { if (apres) apres(); redessiner(); });
    return true;
  }
  // « Aucun » avait été posé pour le moteur : un objet de rayon n'a pas
  // d'emplacement de marquage, la case redevient libre.
  if (etaitTextile && ligne.marquage === MARQUAGE_AUCUN) ligne.marquage = '';
  // UNE TASSE NON PLUS N'A PAS DE PRIX DE RAYON — elle s'additionne. Voir la
  // section « LA TASSE » : le joint avec la grille du comptoir est le nom de la
  // famille, et une famille inconnue de la grille retombe sur le rayon.
  const prodTasse = produitTasse(p.famille);
  if (prodTasse) {
    ligne.textile = null;
    ligne.tasse = {
      produitId: prodTasse.id,
      face1Id: faceParDefaut(),
      face2Id: idRien('face'),
      dessousId: idRien('dessous'),
      batId: idRien('bat'),
    };
    // LE DÉCOR EST CE QUE LE CLIENT RELIT. « TC 01 » ne dit pas que la tasse est
    // rouge : le catalogue le range dans la note du produit (« Rouge / Blanc »,
    // extérieur / intérieur), et c'est la couleur de la ligne — celle de CE
    // décor, pas de celui d'avant.
    if (p.note) ligne.couleur = p.note;
    ligne.faces = texteFacesTasse(ligne);
    chiffrerTasse(ligne);
    if (apres) apres();
    return true;
  }
  ligne.textile = null;
  ligne.tasse = null;
  // UN PRIX DE CATALOGUE EST TTC (c'est le prix de rayon). Le devis compte en
  // HT : la conversion se fait ici, au taux du moment. LA REMISE DE LA LIGNE
  // RESTE : elle s'applique au prix du nouvel article, depuis son prix plein —
  // c'est la même mécanique que la case « Remise % ».
  if (p.prixVenteTtc != null) {
    const ht = saisie.tauxTgca
      ? Math.round((Number(p.prixVenteTtc) / (1 + saisie.tauxTgca)) * 100) / 100
      : Number(p.prixVenteTtc);
    ligne.pleinHt = ht;
    ligne.unitaireHt = ligne.remise ? Math.round(ht * (1 - ligne.remise / 100) * 100) / 100 : ht;
  } else {
    // UN PRODUIT SANS PRIX SE DIT « À CHIFFRER » — pas au prix de l'article
    // d'avant, qui n'a plus rien à voir avec lui.
    ligne.pleinHt = null;
    ligne.unitaireHt = null;
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
    // PAS DE TARIF DE TRANSPORT AUX RÉGLAGES = PAS DE PRIX, pas un transport
    // gratuit. C'est la même règle que pour un article du catalogue sans prix :
    // la ligne dit « à chiffrer » et la vendeuse pose le montant.
    unitaireHt: prix > 0 ? prix : null,
    // ⚠ UNE LIGNE SIMPLE (02/09, Charlie : « ça crée une bulle comme un
    // article, ça prend trop de place »). Un acheminement n'a ni couleur, ni
    // marquage, ni tailles : il sortait pourtant avec les trois rangées d'un
    // t-shirt, soit quatre fois la place de ce qu'il dit. Sa NOTE reste — elle
    // s'imprime sur le devis — elle ne se saisit simplement plus.
    simple: true,
  });
}

function ajouterLigne(modele) {
  saisie.lignes.push({
    designation: '', reference: '', couleur: '', tailles: '', marquage: '', note: '',
    // `encre` : la COULEUR du marquage — le mot de l'atelier, celui de la fiche
    // de production. « Marquage » dit OÙ, « encre » dit avec quoi.
    encre: '',
    // `faces` : ce qu'on marque, face par face. Un objet n'a pas de tailles, il
    // a des emplacements — et c'est le tableau des tailles de logo qui les
    // déclare, famille par famille.
    faces: '',
    // `remise` : un pourcentage accordé sur CETTE ligne. Le moteur le connaît
    // (`discount`) et l'applique avant l'arrondi ; sur une ligne qui ne se
    // chiffre pas, il s'applique au prix saisi.
    remise: 0,
    // `libre` : une référence qui n'est pas au catalogue — sa ref, son prix
    // d'achat et sa désignation, que le moteur chiffre comme les autres.
    libre: null,
    // `simple` : la ligne n'a pas de détail de production (le transport). Elle
    // tient sur sa rangée de tableau, et rien dessous.
    simple: false,
    // `parTaille` : les six cases. `tailles` reste le TEXTE du devis, et il en
    // est dérivé — une seule source, sinon le papier dit une répartition et
    // l'écran une autre.
    parTaille: {},
    // `taillesLibres` : les bulles créées à la main (03/09) — `[{ nom, qte }]`.
    // Même principe que `parTaille` : `tailles` (le texte imprimé) en est
    // dérivé, jamais tapé séparément.
    taillesLibres: [],
    // ⚠ `null`, PAS `0`. Une ligne neuve n'a pas de prix ; un zéro serait un
    // prix — celui d'un article offert. Les deux s'écrivaient pareil, et une
    // tasse sans tarif sortait sur le papier du client à « 0,00 € ». Voir
    // `calculerDevis` : c'est là que la distinction est tenue.
    quantite: 1, unitaireHt: null,
    // `textile` : la référence et le genre du moteur, quand la ligne se chiffre.
    // `tasse` : les cinq puces de la grille du comptoir (produit, deux faces,
    // dessous, BAT) quand la ligne EST une tasse. Les deux ne cohabitent
    // jamais : un article se chiffre d'UNE façon.
    // `puManuel` : le prix a été repris à la main, le moteur n'y touche plus.
    textile: null, tasse: null, puManuel: false,
    ...modele,
  });
  const hote = $('#dvf-liste');
  if (hote) {
    const vide = hote.querySelector('.lignes__vide');
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
    hote.append(el('div', 'lignes__vide', 'Aucun article. Pioche dans le catalogue, ou ajoute une ligne libre.'));
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
  const bloc = el('div', 'lignes__art');
  // LA LIGNE PEUT DEVENIR UN TEXTILE APRÈS SA CONSTRUCTION — c'est le cas
  // normal : on ajoute une ligne, PUIS on cherche son produit. Ce drapeau ne
  // dit donc que l'état de DÉPART, celui d'un brouillon relu ; partout ailleurs
  // c'est `ligne.textile` qui fait foi, au moment où on le lit.
  const estTextile = !!(ligne.textile && ligne.textile.ref);
  if (!ligne.parTaille || typeof ligne.parTaille !== 'object') ligne.parTaille = {};

  // LA RANGÉE DU TABLEAU. Ses cases suivent `COLONNES` dans l'ordre, sans
  // intitulé : l'en-tête les nomme une fois pour toutes les lignes.
  const rangee = el('div', 'lignes__rang');
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
  // LE BOUTON « RÉFÉRENCE LIBRE » EST DANS LE MENU (02/09, Charlie : « je dois
  // pouvoir ajouter Référence libre via un bouton ajouter à l'intérieur de ce
  // input »). Le composant sait poser cette ligne au pied de sa liste et lève
  // `menu-action` : la page décide de la suite.
  //
  // ⚠ CE N'EST PAS « SAISIR UNE VALEUR HORS LISTE » — le champ est DÉJÀ libre,
  // on peut y écrire n'importe quoi. C'est autre chose : un article qui n'est
  // pas au catalogue mais qu'on veut CHIFFRER, donc dont il faut le prix
  // d'achat et le genre. Le moteur sait le faire (`isCustom`), il lui manquait
  // seulement un endroit où le demander.
  design.dataset.menuAction = 'Référence libre — à chiffrer';
  // ⚠ ET TOUJOURS PAS DE « + AJOUTER » GÉNÉRIQUE. Le composant en propose un
  // pour ranger dans la liste ce qu'on vient de taper — mais ici le champ EST
  // libre : ce bouton-là ouvrait une seconde zone de frappe pour faire ce qu'on
  // fait déjà en tapant. Deux lignes « + » au même endroit, dont une qui ne sert
  // à rien, c'est une hésitation de plus au comptoir.
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
  const qte = entree(`dvf-a-${n}-q`, { type: 'number', valeur: ligne.quantite, classe: 'nb' });
  // LE PRIX SE TAPE, OU IL SE CHIFFRE — et tant qu'il n'existe ni l'un ni
  // l'autre, la case reste VIDE et le dit. Un « 0 » affiché est un prix : il
  // laisse partir un devis à zéro euro sans que personne ne le remarque.
  const pu = entree(`dvf-a-${n}-p`, {
    type: 'number', valeur: ligne.unitaireHt == null ? '' : ligne.unitaireHt, classe: 'nb',
  });
  pu.step = '0.01';
  pu.placeholder = SANS_PRIX;
  // LE PU TTC, LIÉ AU PU HT (03/09/2026). Charlie : « pouvoir modifier l'un ou
  // l'autre mais qu'il reste lié ». Le HT reste la valeur qui COMPTE — c'est
  // elle qui nourrit `calculerDevis` et la feuille — le TTC n'est qu'une
  // commodité de saisie : au comptoir, on pense souvent au prix que le client
  // voit, pas au prix hors taxe.
  // ⚠ LIMITE ACCEPTÉE : si le régime TGCA change APRÈS avoir tapé un prix, ce
  // champ ne se recalcule pas tout seul (rien ne le relie en continu à la
  // carte Fiscalité) — mais le total réel de la feuille, lui, reste toujours
  // juste, puisqu'il part du HT et du taux COURANT, pas de ce champ.
  const tauxEffectif = () => (saisie.regime === 'tgca' ? (Number(saisie.tauxTgca) || 0) : 0);
  const puTtc = entree(`dvf-a-${n}-ptc`, {
    type: 'number',
    valeur: ligne.unitaireHt == null ? '' : Math.round(ligne.unitaireHt * (1 + tauxEffectif()) * 100) / 100,
    classe: 'dvf-nb',
  });
  puTtc.step = '0.01';
  puTtc.placeholder = SANS_PRIX;
  // LE TOTAL DE LA LIGNE EST UNE CASE, PAS UN CHAMP : il ne se tape pas, il se
  // lit. Il prend le rail des cases pour tomber sur elles.
  const total = el('div', 'lignes__lu nb');
  const sup = el('button', 'reg-tarif-del');
  sup.type = 'button';
  sup.setAttribute('aria-label', 'Retirer cet article');
  sup.append(ic('delete'));
  rangee.append(design, qte, pu, puTtc, total, sup);
  // ⚠ APRÈS L'INSERTION, JAMAIS AVANT. `menuPoser` REMPLACE le champ par sa peau
  // dans la page (`hote.replaceWith(peau)`) : habillé hors de la page, le champ
  // se retrouve dans une peau détachée, et l'append suivant le sortirait de sa
  // peau — le menu existerait sans plus rien pour l'ouvrir.
  menuPoser(design);

  // --- LE DÉTAIL DE L'ARTICLE, SOUS SA LIGNE ------------------------------
  // CE QUE LA TABLE PORTE, C'EST LA LIGNE COMMERCIALE : ce qu'on vend, combien,
  // à quel prix. Le reste dit comment on le PRODUIT — la référence, la couleur,
  // le marquage, la répartition — et ça ne se lit pas en colonne d'un article à
  // l'autre.
  //
  // ⚠ ET C'EST UNE MESURE, pas un goût. Les huit colonnes tenaient 772 px de
  // large au minimum ; la colonne de saisie en fait 574 au plus petit poste de
  // l'atelier (1280 px, mesuré dans la coquille). La table aurait défilé de
  // côté à demeure — y compris pour lire une référence.
  //
  // TROIS RANGÉES, PAS DEUX (02/09, Charlie : « ces 2 lignes là peuvent tenir
  // sur 3 lignes pour aérer »). La RÉFÉRENCE descend ici : à six colonnes elle
  // sortait à 50 px de large — deux caractères de « NS300 » — et son intitulé
  // chevauchait celui de « Qté ». La note prend la rangée suivante, en entier :
  // c'est une phrase, elle ne tient pas dans un tiers de colonne.
  const detail = el('div', 'dvf-r3');
  const detail2 = el('div', 'dvf-r3');
  // LA COULEUR DU MARQUAGE — c'est `encre` sur la fiche de production, et les
  // teintes sont celles du moteur (`DB.markingColorsHex`), pas une liste écrite
  // ici : en ajouter une demain ne doit pas demander de retoucher cet écran.
  const encre = entree(`dvf-a-${n}-e`, { valeur: ligne.encre, exemple: 'Blanc, Or, Multi couleur…' });
  // LES FACES — ce qu'on marque, face par face. Elles viennent du tableau des
  // tailles de logo, qui les déclare par FAMILLE : c'est la même source que la
  // fiche de l'atelier et que le ticket.
  const faces = entree(`dvf-a-${n}-f`, { valeur: ligne.faces, exemple: 'Coeur, Dos…' });
  const remise = entree(`dvf-a-${n}-rm`, { type: 'number', valeur: ligne.remise || '', classe: 'nb' });
  remise.max = '100';
  remise.placeholder = '0';

  // --- LES QUATRE PUCES D'UNE TASSE ---------------------------------------
  // Elles FONT le prix (produit + face 1 + face 2 + dessous + BAT), et elles
  // sortent de la grille des Réglages — pas d'une liste écrite ici.
  //
  // ⚠ ELLES SONT POSÉES DÈS LA CONSTRUCTION, MASQUÉES. Une ligne devient une
  // tasse quand on choisit son produit — après sa construction — et une rangée
  // ne se reconstruit pas : elle reprendrait le curseur à qui écrit. C'est
  // exactement la raison qui vaut déjà pour « Recalculer ».
  const t0 = ligne.tasse || {};
  const face1 = menu(`dvf-a-${n}-tf1`, puces('face'), t0.face1Id || '');
  const face2 = menu(`dvf-a-${n}-tf2`, puces('face'), t0.face2Id || '');
  const dessous = menu(`dvf-a-${n}-td`, puces('dessous'), t0.dessousId || '');
  const bat = menu(`dvf-a-${n}-tb`, puces('bat'), t0.batId || '');

  // LES DEUX RANGÉES PORTENT LES DEUX FAMILLES, ET N'EN MONTRENT QU'UNE. Trois
  // cases visibles par rangée dans les deux cas — c'est la grille de `.dvf-r3`,
  // et deux articles de familles différentes gardent donc la même hauteur.
  //
  // Ce qui tombe pour une tasse : la RÉFÉRENCE (elle n'en a pas), le MARQUAGE
  // (ce sont les emplacements du moteur textile), la COULEUR DU MARQUAGE (une
  // sublimation est en quadrichromie) et les FACES À MARQUER — ces dernières
  // parce que la rangée du dessus les NOMME déjà, une par une et tarifées.
  const caseRef = champ('Référence', refe);
  const caseCoul = champ('Couleur', coul);
  const caseMarq = champ('Marquage', marq);
  const caseFace1 = champ('Face 1', face1);
  const caseFace2 = champ('Face 2', face2);
  const caseEncre = champ('Couleur du marquage', encre);
  const caseFacesA = champ('Faces à marquer', faces);
  const caseDessous = champ('Dessous', dessous);
  const caseBat = champ('BAT', bat);
  detail2.append(caseEncre, caseFacesA, caseDessous, caseBat, champ('Remise %', remise));

  // LE VOLET DE LA RÉFÉRENCE LIBRE. Il n'existe que quand on l'a demandé : trois
  // cases de plus sur chaque article, pour un cas sur vingt, c'est exactement ce
  // que la règle du volet interdit.
  const libre = el('div', 'dvf-r3');
  libre.hidden = !ligne.libre;
  const lRef = entree(`dvf-a-${n}-lr`, { valeur: ligne.libre ? ligne.libre.ref : '', exemple: 'SWEAT-XL' });
  const lAchat = entree(`dvf-a-${n}-la`, {
    type: 'number', valeur: ligne.libre ? ligne.libre.achat : '', classe: 'nb',
  });
  lAchat.step = '0.01';
  lAchat.placeholder = '12.50';
  const lGenre = entree(`dvf-a-${n}-lg`, { valeur: ligne.libre ? ligne.libre.genre : '', exemple: 'Unisexe' });
  libre.append(champ('Référence libre', lRef), champ('Prix d’achat HT', lAchat),
    champ('Genre (table des temps)', lGenre));

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
      type: 'number', valeur: Number(ligne.parTaille && ligne.parTaille[t]) || '', classe: 'nb',
    });
    c.placeholder = '0';
    boite.append(el('label', 'fa-lab fa-taille__k', t), c);
    boite.firstChild.setAttribute('for', c.id);
    cases.append(boite);
    champsTaille.set(t, c);
  }

  // --- LES TAILLES LIBRES — « je crée ma bulle » (03/09/2026) -------------
  // Charlie : un client demande un 4XL, qui n'est ni dans les six cases ni un
  // « Autres » anonyme — il veut créer SA bulle et lui donner un nom. Répétable
  // : rien n'empêche une ligne de porter un 4XL ET un « enfant 8 ans ».
  //
  // POSÉES DANS LEUR PROPRE CONTENEUR, PAS DANS `cases` (`.fa-tailles`) : cette
  // classe est celle de la fiche de production (fiche-atelier.css), lue par
  // l'écran de l'atelier — y ajouter un nombre variable de bulles la
  // déborderait sans qu'on l'ait décidé pour elle. `dvf-libres` est propre à
  // cet écran (devis-flash.css).
  const libres = el('div', 'dvf-libres');
  function redessinerLibres() {
    libres.replaceChildren();
    (ligne.taillesLibres || []).forEach((tl, i) => {
      const bulle = el('div', 'dvf-taille-libre');
      const champNom = entree(`dvf-a-${n}-tl-${i}-nom`, { valeur: tl.nom, exemple: '4XL' });
      const champQte = entree(`dvf-a-${n}-tl-${i}-qte`, { type: 'number', valeur: tl.qte || '', classe: 'dvf-nb' });
      champQte.placeholder = '0';
      const retirer = el('button', 'reg-tarif-del');
      retirer.type = 'button';
      retirer.setAttribute('aria-label', 'Retirer cette taille');
      retirer.append(ic('delete'));
      champNom.addEventListener('input', () => {
        tl.nom = champNom.value;
        rafraichirQte();
        redessiner();
      });
      champQte.addEventListener('input', () => {
        tl.qte = Math.max(0, Number(champQte.value) || 0);
        rafraichirQte();
        redessiner();
      });
      retirer.addEventListener('click', () => {
        ligne.taillesLibres.splice(i, 1);
        rafraichirQte();
        redessinerLibres();
        redessiner();
      });
      bulle.append(champNom, champQte, retirer);
      libres.append(bulle);
    });
  }
  redessinerLibres();
  const ajouterTaille = el('button', 'action-ligne', '+ Taille');
  ajouterTaille.type = 'button';
  ajouterTaille.addEventListener('click', () => {
    if (!Array.isArray(ligne.taillesLibres)) ligne.taillesLibres = [];
    ligne.taillesLibres.push({ nom: '', qte: 0 });
    redessinerLibres();
    // LE NOM DE LA BULLE QU'ON VIENT D'OUVRIR REÇOIT LE FOCUS. Elle est vide,
    // donc silencieuse (ni imprimée ni comptée) tant qu'on n'a rien tapé —
    // pas la peine de cliquer une seconde fois pour commencer à écrire.
    const dernier = libres.lastElementChild;
    const champ = dernier && dernier.firstElementChild;
    if (champ) champ.focus();
  });
  const cadreLibres = el('div', 'dvf-libres-cadre');
  cadreLibres.append(libres, ajouterTaille);

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
  // Le bouton vit DANS la boîte de la note, à sa droite : c'est la case qui a
  // de la place à revendre, et il tombe sur le rail des champs plutôt que sur
  // une rangée à lui.
  caseNote.lastChild.append(reprendre);
  detail.append(caseRef, caseCoul, caseMarq, caseFace1, caseFace2);
  // ⚠ UNE LIGNE SIMPLE S'ARRÊTE À SA RANGÉE. Un transport n'a ni référence, ni
  // couleur, ni marquage, ni tailles, et sa note est écrite d'avance.
  if (!ligne.simple) bloc.append(detail, detail2, libre, caseNote, cases, cadreLibres);

  // LA QUANTITÉ SE COMPTE QUAND LES TAILLES SONT REMPLIES, et elle se tape
  // sinon. Une tasse n'a pas de taille : sa case reste une saisie. Un t-shirt
  // réparti en six tailles en a une, et c'est leur somme — deux nombres qui
  // disent la même chose et qui peuvent se contredire, c'est le devis qui
  // annonce 24 pièces et en détaille 22.
  const rafraichirQte = () => {
    const somme = totalTailles(ligne.parTaille, ligne.taillesLibres);
    qte.readOnly = somme > 0;
    qte.classList.toggle('lignes__calc', somme > 0);
    if (somme > 0) {
      ligne.quantite = somme;
      if (document.activeElement !== qte) qte.value = String(somme);
    }
    ligne.tailles = texteTailles(ligne.parTaille, ligne.taillesLibres);
  };

  // CE QUE LA LIGNE MONTRE DÉPEND DE CE QU'ELLE EST. Une seule écriture, appelée
  // à la construction ET à chaque changement de produit : deux qui se
  // ressemblent laisseraient un jour une tasse afficher une grille de tailles.
  const majFamille = () => {
    const estTasse = !!ligne.tasse;
    for (const [c, pourTasse] of [[caseRef, false], [caseMarq, false], [caseEncre, false],
      [caseFacesA, false], [caseFace1, true], [caseFace2, true],
      [caseDessous, true], [caseBat, true]]) {
      c.hidden = pourTasse !== estTasse;
    }
    // UNE TASSE N'A PAS DE TAILLES — ni fixes, ni libres. Six cases vides sous
    // chaque tasse, c'est six occasions d'y écrire un nombre qui ne veut rien
    // dire, et la quantité en deviendrait la somme.
    cases.hidden = estTasse;
    cadreLibres.hidden = estTasse;
  };

  const rafraichirTete = () => {
    // CE QU'ON N'A PAS CHIFFRÉ SE DIT, ici comme sur le papier — et c'est le
    // MÊME mot, celui de `devis.js` : deux écritures finiraient par ne plus se
    // ressembler, et l'écran dirait autre chose que la feuille.
    const sansPrix = ligne.unitaireHt == null;
    total.textContent = sansPrix
      ? SANS_PRIX
      : euro((Number(ligne.quantite) || 0) * (Number(ligne.unitaireHt) || 0));
    total.classList.toggle('lignes__attente', sansPrix);
    reprendre.hidden = !((ligne.textile || ligne.tasse) && ligne.puManuel);
  };
  // LE PRIX QUE LE MOTEUR VIENT DE POSER REDESCEND DANS LE CHAMP. C'est la
  // seule case que l'écran écrit lui-même : partout ailleurs la saisie va vers
  // l'objet, jamais l'inverse — d'où le passage par cette fonction, enregistrée
  // pour que `chiffrerTextile` puisse la rappeler de l'extérieur.
  const majPu = () => {
    // On ne reprend PAS le champ sous les doigts : si le curseur y est, c'est
    // que quelqu'un est en train d'y écrire.
    if (document.activeElement === pu) return;
    pu.value = ligne.unitaireHt == null ? '' : String(ligne.unitaireHt);
    // LE TTC SUIT LE HT que le moteur vient de poser — même garde : on ne
    // reprend pas cette case-là non plus si quelqu'un y écrit.
    if (document.activeElement === puTtc) return;
    puTtc.value = ligne.unitaireHt == null ? ''
      : String(Math.round(ligne.unitaireHt * (1 + tauxEffectif()) * 100) / 100);
  };

  // REFAIRE LE PRIX — par la grille de la tasse, ou par le moteur du textile.
  // Une ligne se chiffre d'UNE façon : c'est ce qu'elle porte qui décide, pas
  // l'endroit d'où l'on appelle.
  const recalculer = () => {
    if (ligne.tasse) {
      ligne.faces = texteFacesTasse(ligne);
      faces.value = ligne.faces;
      if (chiffrerTasse(ligne) == null) return;
      majPu();
      rafraichirTete();
      redessiner();
      return;
    }
    chiffrerTextile(ligne).then((prix) => {
      if (prix == null) return;
      majPu();
      rafraichirTete();
      redessiner();
    });
  };

  // LES QUATRE PUCES REFONT LE PRIX. C'est tout ce qu'elles font — et c'est
  // pour ça qu'elles sont sur la ligne plutôt que dans un volet : on change la
  // face devant le client, et le montant bouge sous ses yeux.
  for (const [n4, cle] of [[face1, 'face1Id'], [face2, 'face2Id'],
    [dessous, 'dessousId'], [bat, 'batId']]) {
    n4.addEventListener('change', () => {
      if (!ligne.tasse) return;
      ligne.tasse[cle] = n4.value;
      // ⚠ UNE PUCE CHANGÉE REND LA MAIN AU CALCUL. Sans ça, une tasse dont on
      // a négocié le prix garderait ce prix en ajoutant une face à 6 € : on
      // aurait vendu la face pour rien.
      ligne.puManuel = false;
      recalculer();
    });
  }

  for (const [n2, cle] of [[refe, 'reference'], [coul, 'couleur'], [note, 'note'],
    [encre, 'encre'], [faces, 'faces']]) {
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
    // LA LIGNE VIENT PEUT-ÊTRE DE CHANGER DE FAMILLE — un t-shirt corrigé en
    // tasse, ou l'inverse. Ce sont ses cases qui changent, pas sa hauteur — et
    // TOUTES se relisent, pas seulement celles de la tasse : une planche qui
    // succède à une tasse ne garde ni sa teinte, ni ses faces, ni son « Aucun ».
    if (ligne.tasse) {
      for (const [n5, cle] of [[face1, 'face1Id'], [face2, 'face2Id'],
        [dessous, 'dessousId'], [bat, 'batId']]) n5.value = String(ligne.tasse[cle] || '');
    }
    marq.value = ligne.marquage || '';
    faces.value = ligne.faces || '';
    coul.value = ligne.couleur || '';
    majFamille();
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
    // UNE TASSE NE SUIT PAS LA QUANTITÉ : sa grille n'a pas de dégressif, le
    // prix à la pièce est le même pour une tasse et pour cent.
    // LE COEFFICIENT EST DÉGRESSIF : dix t-shirts et cent t-shirts n'ont pas le
    // même prix à la pièce. Le prix suit donc la quantité, sinon il faudrait le
    // savoir et le refaire à la main — c'est exactement ce qu'on vient
    // d'enlever.
    if (ligne.textile) recalculer();
  });
  // LA REMISE REFAIT LE PRIX. Sur un textile, le moteur l'applique avant
  // l'arrondi ; sur une ligne saisie à la main, elle s'applique au prix tapé —
  // et dans ce cas c'est l'écran qui la pose, une seule fois, sur la valeur de
  // départ retenue à la première remise.
  remise.addEventListener('input', () => {
    ligne.remise = Math.min(100, Math.max(0, Number(remise.value) || 0));
    if (ligne.textile || ligne.tasse) { recalculer(); return; }
    // ⚠ ON NE REMISE PAS CE QU'ON N'A PAS CHIFFRÉ. Sans ce garde-fou, taper une
    // remise sur une ligne « à chiffrer » lui posait un prix de 0,00 € — la
    // ligne cessait de réclamer son prix, et le devis partait avec.
    if (ligne.unitaireHt == null) { rafraichirTete(); redessiner(); return; }
    // ⚠ ON GARDE LE PRIX PLEIN. Sans lui, deux remises successives se
    // composeraient (10 % puis 10 % feraient 19 %), et revenir à 0 ne rendrait
    // jamais le prix de départ.
    if (ligne.pleinHt == null) ligne.pleinHt = Number(ligne.unitaireHt) || 0;
    ligne.unitaireHt = Math.round(ligne.pleinHt * (1 - ligne.remise / 100) * 100) / 100;
    majPu();
    rafraichirTete();
    redessiner();
  });

  // --- LA RÉFÉRENCE LIBRE ------------------------------------------------
  // Le composant lève `menu-action` quand on clique sa ligne : on ouvre le
  // volet, et la ligne devient un textile à chiffrer.
  const ouvrirLibre = () => {
    ligne.libre = ligne.libre || { ref: '', achat: '', designation: '', genre: 'Unisexe' };
    ligne.textile = { ref: '', genre: ligne.libre.genre || 'Unisexe' };
    if (!ligne.marquage) { ligne.marquage = MARQUAGE_AUCUN; marq.value = MARQUAGE_AUCUN; }
    libre.hidden = false;
    lGenre.value = ligne.libre.genre || 'Unisexe';
    poserMarquages(marq);
    lRef.focus();
  };
  design.addEventListener('menu-action', ouvrirLibre);
  for (const [n3, cle] of [[lRef, 'ref'], [lAchat, 'achat'], [lGenre, 'genre']]) {
    n3.addEventListener('input', () => {
      if (!ligne.libre) return;
      ligne.libre[cle] = n3.value;
      // La désignation du devis reste celle qu'on a tapée dans la ligne : c'est
      // elle que le client lit. Le moteur, lui, prend la sienne.
      ligne.libre.designation = ligne.designation || n3.value;
      if (cle === 'genre') ligne.textile = { ref: '', genre: n3.value || 'Unisexe' };
      recalculer();
    });
  }

  pu.addEventListener('input', () => {
    // VIDE ET ZÉRO NE DISENT PAS LA MÊME CHOSE. Vider la case, c'est retirer le
    // prix (la ligne repart « à chiffrer ») ; taper 0, c'est décider que
    // l'article est offert — et ça s'imprime « 0,00 € », comme il se doit.
    ligne.unitaireHt = String(pu.value).trim() === '' ? null : Math.max(0, Number(pu.value) || 0);
    // Un prix tapé à la main devient le nouveau prix PLEIN : la remise repartira
    // de lui, pas de celui d'avant.
    ligne.pleinHt = ligne.remise ? null : ligne.unitaireHt;
    // ON REPREND LA MAIN, ET LE MOTEUR LA REND. Un prix tapé pendant une
    // négociation ne doit pas se faire écraser au prochain changement de
    // quantité ; « Recalculer » le rend au moteur quand on a fini.
    if (ligne.textile || ligne.tasse) ligne.puManuel = true;
    // LE TTC SUIT LE HT qu'on vient de taper — c'est lui qui reste la valeur
    // qui compte, le TTC n'en est que le reflet.
    puTtc.value = ligne.unitaireHt == null ? ''
      : String(Math.round(ligne.unitaireHt * (1 + tauxEffectif()) * 100) / 100);
    rafraichirTete();
    redessiner();
  });
  puTtc.addEventListener('input', () => {
    // LE SENS INVERSE : on tape le TTC, le HT s'en déduit — c'est TOUJOURS lui
    // qui repart vers `calculerDevis`, jamais le TTC directement.
    const brutTtc = String(puTtc.value).trim();
    const taux = tauxEffectif();
    ligne.unitaireHt = brutTtc === '' ? null : Math.max(0, Math.round((Number(puTtc.value) || 0) / (1 + taux) * 100) / 100);
    ligne.pleinHt = ligne.remise ? null : ligne.unitaireHt;
    if (ligne.textile || ligne.tasse) ligne.puManuel = true;
    pu.value = ligne.unitaireHt == null ? '' : String(ligne.unitaireHt);
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

  // LES DEUX LISTES S'HABILLENT TOUT DE SUITE : elles ne dépendent d'aucun choix
  // de produit, contrairement aux emplacements de marquage. Les faces peuvent
  // manquer (tableau des tailles de logo injoignable) — le champ reste alors une
  // saisie libre, ce qui est exactement ce qu'il faut.
  habiller(faces, ID_FACES, facesConnues);
  moteurTextile()
    .then((TE) => habiller(encre, ID_ENCRES, Object.keys(TE.DB.markingColorsHex || {})))
    .catch(() => { /* moteur injoignable : la couleur se tape */ });

  // Un brouillon relu porte déjà des lignes textiles : elles retrouvent leur
  // liste de marquages sans qu'on ait à rechoisir le produit.
  if (estTextile) poserMarquages(marq);

  majFamille();
  rafraichirQte();
  rafraichirTete();
  return bloc;
}

// ===========================================================================
// CARTE 4 — FISCALITÉ, ACOMPTE, ARRONDI, ET CE QUE ÇA DONNE
// ===========================================================================
function carteArgent() {
  const [c, corps] = carte('receipt_long', 'Fiscalité et règlement', 'argent');

  // LA BASCULE VEDETTE (03/09/2026) : quel total est le géant de la feuille.
  // Elle ne change aucun montant, juste ce qui est mis en avant.
  const vedette = segmente('dvf-vedette', VEDETTES, saisie.vedette, (v) => { saisie.vedette = v; redessiner(); });
  const regime = menu('dvf-regime', REGIMES, saisie.regime);
  // L'ACOMPTE EST UN POURCENTAGE LIBRE (03/09/2026) — plus un menu figé à
  // 0/30/50/100 %. Le patron tape ce qu'il négocie.
  const acompte = entree('dvf-acompte', { type: 'number', valeur: saisie.acompte, classe: 'dvf-nb' });
  acompte.max = '100';
  acompte.placeholder = '0';
  const arrondi = menu('dvf-arrondi', ARRONDIS, saisie.arrondi);
  // L'AJUSTEMENT GLOBAL (03/09/2026) : une remise (négatif) ou une majoration
  // (positif) sur l'ensemble, en euros ou en pourcentage du sous-total HT.
  const ajustementUnite = menu('dvf-ajustement-unite', AJUSTEMENT_UNITES, saisie.ajustement.unite);
  const ajustementValeur = entree('dvf-ajustement-valeur', {
    type: 'number', valeur: saisie.ajustement.valeur || '', classe: 'dvf-nb',
  });
  ajustementValeur.removeAttribute('min');
  ajustementValeur.step = '0.01';
  ajustementValeur.placeholder = '0';
  const ajustementWrap = el('div', 'dvf-ajustement');
  ajustementWrap.append(ajustementValeur, ajustementUnite);

  corps.append(feuille(
    rang('Total mis en avant', vedette),
    rang('Régime TGCA', regime),
    rang('Ajustement', ajustementWrap),
    rang('Arrondi commercial', arrondi),
    rang('Acompte %', acompte),
  ));

  const totaux = el('div', 'totaux');
  totaux.id = 'totaux';
  corps.append(totaux);

  regime.addEventListener('change', () => { saisie.regime = regime.value; redessiner(); });
  acompte.addEventListener('input', () => {
    saisie.acompte = Math.min(100, Math.max(0, Number(acompte.value) || 0));
    redessiner();
  });
  arrondi.addEventListener('change', () => { saisie.arrondi = arrondi.value; redessiner(); });
  ajustementUnite.addEventListener('change', () => {
    saisie.ajustement.unite = ajustementUnite.value;
    redessiner();
  });
  ajustementValeur.addEventListener('input', () => {
    saisie.ajustement.valeur = Number(ajustementValeur.value) || 0;
    redessiner();
  });
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

  const totaux = $('#totaux');
  // LES DEUX MOITIÉS DE L'ÉCRAN DISENT LA MÊME CHOSE. Rien de chiffré, pas de
  // totaux — ni ici, ni sur la feuille (voir `calculerDevis`). Le volet garde
  // ses trois réglages : c'est l'addition qui disparaît, pas la fiscalité.
  if (totaux && compte.aucunPrix) totaux.replaceChildren();
  else if (totaux) {
    const lignes = [['Sous-total HT', compte.sousTotalHt]];
    if (compte.ajustement.montant) lignes.push(['Ajustement', compte.ajustement.montant]);
    if (compte.ecart) lignes.push(['Arrondi commercial', compte.ecart]);
    const taxeLigne = [compte.regime.taxable
      ? `${compte.regime.label} ${(compte.tauxTgca * 100).toFixed(compte.tauxTgca * 100 % 1 ? 1 : 0)} %`
      : compte.regime.label, compte.taxe];
    // LA BASCULE VEDETTE : le total mis en avant devient le géant en bas de
    // carte, l'autre reste une ligne normale ici — le calcul ne change pas.
    if (compte.vedette === 'ht') {
      lignes.push(taxeLigne, ['TTC', compte.ttc]);
    } else {
      lignes.push(['Total HT', compte.totalHt], taxeLigne);
    }
    totaux.replaceChildren();
    for (const [k, v] of lignes) {
      const l = el('div', 'tot');
      l.append(el('span', null, k), el('b', null, euro(v)));
      totaux.append(l);
    }
    // LA CLASSE EST CELLE DE LA CHARTE (`.tot`), LA BASCULE EST CELLE DU DEVIS.
    // Deux branches se sont croisées ici : l'une a promu le total dans
    // `charte.css` pour que la vente et le devis donnent le même composant,
    // l'autre a ajouté la vedette HT/TTC. Prendre un seul côté perdait l'autre.
    const grand = el('div', 'tot tot--grand');
    grand.append(el('span', null, compte.vedette === 'ht' ? 'TOTAL HT' : 'TOTAL À PAYER'),
      el('b', null, euro(compte.vedette === 'ht' ? compte.totalHt : compte.ttc)));
    totaux.append(grand);
    if (compte.acompte.pourcent) {
      const a = el('div', 'tot');
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
    const etatDevis = repriseDe ? `reprise du dossier — version ${version + 1}`
      : (dossierId ? 'au planning' : 'brouillon local');
    // CE QUI MANQUE SE COMPTE ICI, une fois pour tout le devis. Une ligne « à
    // chiffrer » se voit dans le tableau — mais le tableau se replie, et c'est
    // justement replié qu'on clique « Imprimer ». Le compte, lui, est toujours
    // sous les yeux.
    const manquants = compte.lignes.filter((l) => l.sansPrix).length;
    const reste = manquants ? ` · ${manquants} à chiffrer` : '';
    // ET LE COMPTEUR NE PORTE UN MONTANT QUE S'IL EN EXISTE UN : « 0 article ·
    // 0,00 € · brouillon local » annonçait un devis à zéro euro dès l'ouverture.
    const montant = compte.aucunPrix ? '' : ` · ${euro(compte.ttc)}`;
    compteur.textContent = `${n} article${n > 1 ? 's' : ''}${montant}${reste} · ${etatDevis}`;
  }
  const bSave = $('#dvf-enregistrer');
  if (bSave) {
    bSave.disabled = (!!dossierId && !repriseDe) || !saisie.lignes.length
      || !String(saisie.client.nom || '').trim();
    // LE BOUTON DIT CE QU'IL FERA, pas ce qu'il est. « Enregistrer » sur une
    // reprise laisserait croire qu'on ouvre un second dossier.
    // ⚠ COURT. « Enregistrer dans « À trier » » faisait 267 px à lui seul et
    // poussait la rangée des trois boutons sous le titre — mesuré au rendu :
    // 902 px de contenu dans 918 de barre, l'écart de la gouttière suffisait à
    // la faire s'enrouler, et l'en-tête passait de 82 à 122 px. Où va le devis,
    // le message le dit après le clic ; le bouton n'a qu'à dire ce qu'il fait.
    bSave.textContent = repriseDe ? `Enregistrer la version ${version + 1}`
      : (dossierId ? 'Enregistré' : 'Enregistrer');
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
      // LA REPRISE. Présent, le serveur écrit sur CE dossier et range la version
      // d'avant ; absent, il en ouvre un neuf.
      dossierId: repriseDe,
      numero: saisie.numero,
      jour: jourAtelier(),
      date: saisie.date,
      validite: saisie.validite,
      projet: saisie.projet,
      dueDate: saisie.dueDate,
      // CE QUI SUIT LE DOSSIER MAIS PAS LE PAPIER (02/09) : l'heure de retrait,
      // le travail de maquette à prévoir, et ce qu'on se dit entre nous. Un
      // serveur d'une version antérieure les ignore — ils n'empêchent rien.
      dueHeure: saisie.dueHeure,
      maquette: saisie.maquette,
      noteInterne: saisie.noteInterne,
      client: saisie.client,
      appro: saisie.appro,
      regime: saisie.regime,
      tauxTgca: saisie.tauxTgca,
      arrondi: saisie.arrondi,
      vedette: saisie.vedette,
      ajustementUnite: compte.ajustement.unite,
      ajustementValeur: compte.ajustement.valeur,
      ajustementMontant: compte.ajustement.montant,
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
    if (r && r.version) version = r.version;
    // La reprise est FAITE : un second clic ne doit pas fabriquer une V3 de la
    // même modification.
    repriseDe = null;
    dire(r && r.reprise
      ? `Version ${r.version} enregistrée sur le dossier`
      : (r && r.dejaEnregistre ? 'Ce devis était déjà au planning' : 'Devis enregistré — dans « À trier »'),
    'is-ok');
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
  // UN DEVIS NEUF S'OUVRE REPLIÉ (02/09). Charlie : « ils sont fermés par
  // défaut et doivent être fermés à chaque nouveau devis. » Le pli suivait le
  // brouillon — celui qui avait déplié la fiscalité la retrouvait dépliée sur
  // le devis d'après, et l'écran ne repartait donc jamais du même endroit. Le
  // squelette est posé UNE fois : on referme les volets rendus, on ne les
  // reconstruit pas.
  replis = {};
  for (const v of (ROOT ? ROOT.querySelectorAll('details.dvf-cat') : [])) v.open = false;
  // `#dvf-cl-adresse` FAIT PARTIE DE LA LISTE : l'adresse du client est arrivée
  // avec la facture opposable, et un devis neuf doit la vider comme les autres —
  // sinon le devis suivant part avec l'adresse du précédent.
  for (const [id, v] of [['#dvf-cl-nom', ''], ['#dvf-cl-code', ''], ['#dvf-cl-adresse', ''],
    ['#dvf-cl-ville', ''],
    ['#dvf-cl-email', ''], ['#dvf-cl-contact', ''], ['#dvf-cl-tel', ''], ['#dvf-cl-wa', ''],
    ['#dvf-cherche', ''],
    ['#dvf-projet', ''], ['#dvf-due', ''], ['#dvf-heure', ''], ['#dvf-note-interne', ''],
    ['#dvf-validite', saisie.validite],
    // LA CARTE FISCALITÉ REPART À ZÉRO ELLE AUSSI : `saisie` retrouve ses
    // valeurs neuves, les champs à l'écran doivent les suivre — sinon le
    // devis vierge calcule sur des réglages neufs pendant que l'écran affiche
    // encore ceux du devis précédent.
    ['#dvf-regime', saisie.regime], ['#dvf-arrondi', saisie.arrondi],
    ['#dvf-acompte', String(saisie.acompte)],
    ['#dvf-ajustement-unite', saisie.ajustement.unite], ['#dvf-ajustement-valeur', '']]) {
    const n = $(id);
    if (n) n.value = v;
  }
  const appro = $('#dvf-appro');
  if (appro) appro.value = saisie.appro;
  const maquette = $('#dvf-maquette');
  if (maquette) maquette.value = 'non';
  segmenteRegle($('#dvf-vedette'), saisie.vedette);
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
