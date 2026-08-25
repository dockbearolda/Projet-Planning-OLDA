// MON TRAVAIL — l'écran de celui qui produit.
//
// « Il voit principalement : À faire / En attente / Terminé aujourd'hui.
//   L'objectif : ouvrir le logiciel le matin et savoir immédiatement quoi
//   faire. » (§25)
//
// Donc trois listes et RIEN d'autre. Pas de compteur en haut, pas de graphique,
// pas de rappel de ce qui va bien : c'est la règle déjà tranchée pour le Point
// du jour — l'écran ne porte que du travail.
//
// L'opérateur ne reçoit pas les colonnes d'argent (le serveur les retire de la
// réponse, pas seulement de l'affichage) : il n'y a donc aucun prix à cacher
// ici, il n'arrive tout simplement pas.

import { fetchBorne } from './reseau.js';

let ROOT = null;
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let SUB_LABEL = {};
export function poserLibelles(sousEtapes) { SUB_LABEL = sousEtapes || {}; }

// Une carte = une commande. Deux tailles de texte, deux lignes : le nom du
// client se lit de loin, le reste se lit quand on s'approche. C'est la règle
// « une carte se relit, elle ne se remplit pas » — aucun champ de saisie ici,
// on ouvre la fiche pour agir.
function carte(l, avecEtape = true) {
  const c = el('article', 'mt-carte');
  c.dataset.id = l.id;
  c.tabIndex = 0;
  c.setAttribute('role', 'button');
  const haut = el('div', 'mt-carte__haut');
  haut.append(el('span', 'mt-carte__client', l.billing_company || 'Sans client'));
  if (l.priority === 3) haut.append(el('span', 'mt-carte__urgent', 'Urgent'));
  c.append(haut);

  const bas = [
    l.product,
    l.quantity ? `${l.quantity} pièce${l.quantity > 1 ? 's' : ''}` : null,
    avecEtape && l.sub_stage ? (SUB_LABEL[l.sub_stage] || l.sub_stage) : null,
  ].filter(Boolean).join(' · ');
  c.append(el('p', 'mt-carte__quoi', bas));

  // LE MOTIF DU BLOCAGE EST LA SEULE CHOSE QUI COMPTE sur une ligne bloquée :
  // sans lui, « En attente » est une liste qu'on regarde sans savoir quoi faire.
  if (l.flag === 'bloque') {
    c.classList.add('is-bloque');
    c.append(el('p', 'mt-carte__motif', l.flag_reason || 'Bloquée — motif non précisé'));
  }
  if (l.deadline) {
    const j = joursRestants(l.deadline);
    const t = el('span', 'mt-carte__quand', libelleDelai(j));
    if (j !== null && j < 0) t.classList.add('is-retard');
    else if (j !== null && j <= 1) t.classList.add('is-proche');
    c.append(t);
  }
  return c;
}

// Le jour civil de l'ATELIER. En UTC, « aujourd'hui » bascule à 20 h locales et
// une commande du jour s'afficherait « Retard 1 j » en pleine soirée.
const JOUR_ATELIER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Marigot', year: 'numeric', month: '2-digit', day: '2-digit',
});
function joursRestants(iso) {
  const jour = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return null;
  const a = Date.parse(`${jour}T12:00:00Z`);
  const b = Date.parse(`${JOUR_ATELIER.format(new Date())}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86400000);
}
function libelleDelai(j) {
  if (j === null) return '';
  if (j < 0) return `Retard ${-j} j`;
  if (j === 0) return 'Aujourd’hui';
  if (j === 1) return 'Demain';
  return `Dans ${j} j`;
}

function bloc(titre, lignes, vide, avecEtape = true) {
  const s = el('section', 'mt-bloc');
  const h = el('header', 'mt-bloc__head');
  h.append(el('h2', 'mt-bloc__titre', titre));
  // Le compte est un REPÈRE, pas une performance : il dit s'il reste du travail,
  // il ne se compare à rien.
  h.append(el('span', 'mt-bloc__n', String(lignes.length)));
  s.append(h);
  if (!lignes.length) {
    s.append(el('p', 'mt-bloc__vide', vide));
    return s;
  }
  const liste = el('div', 'mt-liste');
  for (const l of lignes) liste.append(carte(l, avecEtape));
  s.append(liste);
  return s;
}

let dernier = null;

export function renderMonTravail(data) {
  if (!ROOT) return;
  dernier = data;
  const page = el('div', 'mt-page');
  const head = el('header', 'mt-head');
  head.append(el('h1', 'mt-head__titre', data.qui ? `Bonjour ${data.qui}` : 'Mon travail'));
  page.append(head);

  page.append(bloc('À faire', data.aFaire || [], 'Rien ne t’attend. Va voir le planning.'));
  page.append(bloc('En attente', data.enAttente || [],
    'Rien en attente — aucune de tes commandes ne dépend de quelqu’un d’autre.'));
  page.append(bloc('Terminé aujourd’hui', (data.finiAujourdhui || []).map((f) => ({
    ...f, sub_stage: f.sub_stage,
  })), 'Rien de terminé aujourd’hui, pour l’instant.'));

  ROOT.replaceChildren(page);
}

export async function refreshMonTravail() {
  if (!ROOT) return;
  try {
    const res = await fetchBorne('/api/mon-travail');
    if (!res.ok) throw new Error(`Erreur ${res.status}`);
    renderMonTravail(await res.json());
  } catch (_) {
    // Un écran vide sans explication se lit comme « je n'ai rien à faire » :
    // c'est exactement le contresens à ne pas laisser passer sur CET écran-là.
    if (dernier) return;
    ROOT.replaceChildren(el('p', 'mt-bloc__vide',
      'Liste indisponible — vérifie la connexion. Ne pars pas du principe qu’il n’y a rien à faire.'));
  }
}

let monte = false;
export async function initMonTravail(root) {
  ROOT = root;
  if (monte) return refreshMonTravail();
  monte = true;
  return refreshMonTravail();
}
