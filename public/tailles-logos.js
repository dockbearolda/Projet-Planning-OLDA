// TAILLES DES LOGOS — la largeur du logo à imprimer, en millimètres.
//
// Par référence, par EMPLACEMENT et par taille de vêtement. Ce n'est pas une
// constante par référence : sur NS300 le dos va de 240 mm en XS à 320 mm en XL,
// et c'est précisément ce qu'on ne retient pas de tête.
//
// Le tableau vivait sur un second site que le CRM recopiait — deux applications
// pour une même donnée, donc une copie qui pouvait dater et un bouton qu'il
// fallait avoir trouvé. Il est rentré ici le 26/08 : c'est la même donnée que le
// comptoir lit dans l'article textile, pas une copie de plus.
//
// UNE FAMILLE À LA FOIS, UN EMPLACEMENT À LA FOIS. Six emplacements × six
// tailles feraient trente-six colonnes, et un tableau de trente-six colonnes ne
// se lit pas.
//
// Chargé À LA DEMANDE par app.js au premier passage sur l'onglet.

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

async function api(method, chemin, corps) {
  const res = await fetchBorne(chemin, {
    method,
    headers: corps !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: corps !== undefined ? JSON.stringify(corps) : undefined,
  });
  const texte = await res.text();
  // Le statut AVANT le corps : une page d'erreur du proxy (HTML) ferait échouer
  // l'analyse JSON d'abord, et l'écran afficherait « Unexpected token < » au
  // lieu de « Erreur 502 ».
  let data = null;
  try { data = texte ? JSON.parse(texte) : null; } catch (_) { data = null; }
  if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
  return data;
}

let table = { familles: {}, emplacements: [], tailles: {} };
let famille = 'Homme';
let emplacement = 'Coeur';
let etat = '';                 // ce que la dernière écriture a donné, dit DANS l'écran

// Les familles sont celles que la vendeuse peut choisir au comptoir
// (textile-catalog.js — GENRES_SAISIE et FAMILLES_ACCESSOIRE). Une famille
// qu'elle ne peut pas choisir serait une colonne que personne ne lira jamais.
const FAMILLES = ['Homme', 'Femme', 'Enfant', 'Bébé', 'Tote Bag', 'Casquettes', 'Pochettes'];
const EMPLACEMENTS_DEFAUT = ['Coeur', 'Poitrine', 'Avant', 'Dos', 'Manche DR', 'Manche GA'];

// LE CATALOGUE TEXTILE, chargé à la demande. Les lignes du tableau sont les
// références du catalogue : les taper à la main laisserait passer une faute de
// frappe qui rendrait la mesure introuvable au comptoir, sans rien signaler.
// C'est un script classique (il se pose sur `window`), pas un module : on
// l'injecte plutôt que de l'importer.
let cataloguePret = null;
function chargerCatalogue() {
  if (cataloguePret) return cataloguePret;
  cataloguePret = new Promise((resolve) => {
    if (window.TextileEngine) return resolve(window.TextileEngine);
    const sc = document.createElement('script');
    sc.src = '/comptoir/textile-catalog.js';
    sc.onload = () => resolve(window.TextileEngine || null);
    sc.onerror = () => resolve(null);
    document.head.appendChild(sc);
  });
  return cataloguePret;
}

// Les références d'une famille : celles du catalogue, PLUS celles déjà mesurées
// qui n'y sont pas rangées. Sans elles, une mesure devenue orpheline
// disparaîtrait de l'écran sans disparaître de la base — invisible et
// indéboulonnable.
function lignesDeLaFamille(nom) {
  const TE = window.TextileEngine;
  const lignes = [];
  const vues = new Set();
  if (TE) {
    for (const r of TE.DB.refs) {
      if (TE.genreSaisie(r.genre) !== nom) continue;
      lignes.push({ ref: r.ref, nom: r.designation || '' });
      vues.add(r.ref);
    }
  }
  for (const ref of Object.keys((table.familles || {})[nom] || {})) {
    if (vues.has(ref)) continue;
    // LA DÉSIGNATION SE CHERCHE DANS TOUT LE CATALOGUE, pas dans la famille : le
    // body K831 est rangé « Enfant » au catalogue et mesuré « Bébé » à
    // l'atelier. Il est bien au catalogue — dire « hors catalogue » serait faux.
    const au = TE && (TE.getRef(ref) || TE.DB.refs.find((r) => r.toptex === ref));
    lignes.push({ ref, nom: au ? (au.designation || '') : 'hors catalogue' });
  }
  return lignes;
}

function largeurEnBase(ref, taille) {
  const v = ((((table.familles || {})[famille] || {})[ref] || {})[emplacement] || {})[taille];
  return v == null ? '' : String(v);
}

function compter() {
  let refs = 0;
  let mesures = 0;
  for (const parRef of Object.values(table.familles || {})) {
    for (const parEmplacement of Object.values(parRef)) {
      refs += 1;
      for (const t of Object.values(parEmplacement)) mesures += Object.keys(t).length;
    }
  }
  return { refs, mesures };
}

// --- Rendu -------------------------------------------------------------------

// Deux rangées de choix, jamais un menu : on passe d'un emplacement à l'autre en
// remplissant, et un menu demanderait deux gestes à chaque fois. C'est LE
// sélecteur segmenté de la charte, celui de la Base clients — pas un sosie.
function segmente(liste, actif, groupe, aria) {
  const b = el('div', 'segmente');
  b.setAttribute('role', 'group');
  b.setAttribute('aria-label', aria);
  for (const nom of liste) {
    const bt = el('button', `segmente__btn${nom === actif ? ' is-on' : ''}`, nom);
    bt.type = 'button';
    bt.dataset[groupe] = nom;
    bt.setAttribute('aria-pressed', nom === actif ? 'true' : 'false');
    b.appendChild(bt);
  }
  return b;
}

function render() {
  if (!ROOT) return;
  const emplacements = table.emplacements && table.emplacements.length
    ? table.emplacements : EMPLACEMENTS_DEFAUT;
  if (!emplacements.includes(emplacement)) [emplacement] = emplacements;
  const tailles = (table.tailles || {})[famille] || ['Taille unique'];

  const page = el('div', 'reg-page tl-page');

  const tete = el('header', 'reg-head');
  tete.append(ic('draw', 'reg-head__ic'), (() => {
    const t = el('div', 'reg-head__titles');
    t.append(el('h2', 'reg-head__title', 'Tailles des logos'),
      el('p', 'reg-head__sub',
        'La largeur du logo à imprimer, en millimètres. Au comptoir, elle se pose '
        + 'toute seule dans l’article textile — et la vendeuse peut la changer pour '
        + 'un client. Une case vide veut dire « pas encore mesuré » : elle ne propose rien.'));
    return t;
  })());
  page.appendChild(tete);

  const carte = el('section', 'reg-card');
  const barres = el('div', 'tl-barres');
  barres.append(segmente(FAMILLES, famille, 'famille', 'Famille'),
    segmente(emplacements, emplacement, 'emplacement', 'Emplacement du marquage'));
  carte.appendChild(barres);

  const lignes = lignesDeLaFamille(famille);
  if (!lignes.length) {
    carte.appendChild(el('p', 'tl-vide', window.TextileEngine
      ? 'Aucune référence de cette famille dans le catalogue textile.'
      : 'Catalogue textile indisponible — impossible de lister les références.'));
    page.appendChild(carte);
    ROOT.replaceChildren(page);
    return;
  }

  // La grille défile dans SA boîte : la page, elle, ne part jamais de côté et ne
  // s'allonge pas de deux mille pixels parce qu'une famille compte vingt-six
  // références.
  const cadre = el('div', 'tl-cadre');
  const grille = el('div', 'tl-grille');
  grille.style.setProperty('--tl-cols', String(tailles.length));
  grille.append(el('span', 'tl-coin', 'Référence'));
  for (const t of tailles) grille.appendChild(el('span', 'tl-tete', t));
  for (const ligne of lignes) {
    const nom = el('span', 'tl-ref');
    nom.append(el('b', null, ligne.ref));
    if (ligne.nom) nom.append(el('span', 'tl-nom', ligne.nom));
    grille.appendChild(nom);
    for (const t of tailles) {
      const input = el('input', 'tl-champ');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.value = largeurEnBase(ligne.ref, t);
      input.dataset.ref = ligne.ref;
      input.dataset.taille = t;
      input.setAttribute('aria-label', `${ligne.ref}, ${emplacement}, ${t}, en millimètres`);
      grille.appendChild(input);
    }
  }
  cadre.appendChild(grille);
  carte.appendChild(cadre);
  carte.appendChild(el('p', 'tl-pied', ''));
  page.appendChild(carte);
  ROOT.replaceChildren(page);
  pied();
}

// Ce que le tableau porte à l'instant. Se relit après CHAQUE case écrite : sans
// ça, le compte reste celui de l'ouverture de l'écran et rien ne dit que la
// saisie est partie.
function pied() {
  const p = $('.tl-pied');
  if (!p) return;
  if (etat) { p.textContent = etat; return; }
  const { refs, mesures } = compter();
  p.textContent = `${refs} référence${refs > 1 ? 's' : ''} renseignée${refs > 1 ? 's' : ''}, `
    + `${mesures} largeur${mesures > 1 ? 's' : ''} au total. `
    + 'Une case vide veut dire « pas encore mesuré ».';
}

// --- Écriture ----------------------------------------------------------------

// UNE CASE À LA FOIS, À LA PERTE DU FOCUS. Enregistrer à la frappe ferait un
// appel par chiffre tapé — et « 260 » commencerait par écrire 2, puis 26.
async function enregistrer(input) {
  const avant = input.value;
  try {
    const recu = await api('PATCH', '/api/tailles-logo', {
      famille,
      reference: input.dataset.ref,
      emplacement,
      taille: input.dataset.taille,
      largeur: input.value,
    });
    // Le serveur rend le tableau entier ; les listes qu'il ne renvoie pas
    // (emplacements, tailles) ne changent pas, on les garde.
    if (recu && recu.familles) table = { ...table, familles: recu.familles };
    etat = '';
    input.classList.remove('est-ko');
  } catch (err) {
    // LA CASE GARDE CE QUI EST À L'ÉCRAN et le dit : la remettre à sa valeur
    // d'avant ferait disparaître la saisie sous les doigts, et on croirait
    // avoir mal tapé.
    etat = `${err.message} — la largeur ${avant || '(vide)'} n’est pas enregistrée.`;
    input.classList.add('est-ko');
  }
  // LE PIED SEUL EST RÉÉCRIT : refaire la grille reprendrait le champ sous les
  // doigts au moment où l'on passe au suivant par la touche de tabulation.
  pied();
}

function wire() {
  // UN SEUL ÉCOUTEUR pour toute la grille : ses champs sont refaits à chaque
  // changement de famille ou d'emplacement.
  ROOT.addEventListener('change', (e) => {
    const champ = e.target.closest('.tl-champ');
    if (champ) enregistrer(champ);
  });
  ROOT.addEventListener('click', (e) => {
    const f = e.target.closest('[data-famille]');
    if (f) { famille = f.dataset.famille; etat = ''; return render(); }
    const p = e.target.closest('[data-emplacement]');
    if (p) { emplacement = p.dataset.emplacement; etat = ''; return render(); }
    return undefined;
  });
}

export async function refreshTaillesLogos() {
  if (!ROOT) return;
  const [recu] = await Promise.all([
    api('GET', '/api/tailles-logo').catch(() => null),
    chargerCatalogue(),
  ]);
  if (recu && recu.familles) table = recu;
  etat = '';
  render();
}

let monte = false;
export async function initTaillesLogos(root) {
  if (monte) return;
  ROOT = root;
  monte = true;
  wire();
  await refreshTaillesLogos();
}
