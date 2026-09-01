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
import { ecranTete } from './ecran-tete.js';
// UN NOM DE CLIENT SE LIT EN CAPITALES — règle unique, voir nom-client.js.
import { nomClientAffiche } from './nom-client.js';

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
  haut.append(el('span', 'mt-carte__client',
    nomClientAffiche(l.billing_company, l.client_type) || 'Sans client'));
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

  // LES ÉTAPES DE CET ARTICLE. C'est ici que se coche le travail : sans elles,
  // l'écran dirait « Polos brodés » et il faudrait ouvrir la fiche pour savoir
  // laquelle des sept étapes revient à qui — exactement le clic que cet écran
  // supprime. C'est la SEULE saisie qu'on tolère sur une carte : une case, pas
  // un formulaire (voir « une carte se relit, elle ne se remplit pas »).
  if (Array.isArray(l.taches) && l.taches.length) c.append(listeEtapes(l));
  return c;
}

// L'étape EN COURS est la première non faite : c'est elle qu'on met en avant,
// les autres se lisent comme un chemin parcouru et un chemin restant.
function listeEtapes(l) {
  const box = el('div', 'mt-etapes');
  const enCours = l.taches.find((t) => !t.fait);
  l.taches.forEach((t, i) => {
    const derniere = i === l.taches.length - 1;
    const ligne = el('div', 'mt-etape');
    if (t.fait) ligne.classList.add('is-faite');
    if (enCours && t.id === enCours.id) ligne.classList.add('is-en-cours');

    const etiquette = el('label', 'mt-etape__label');
    const case_ = el('input', 'mt-etape__case');
    case_.type = 'checkbox';
    case_.checked = !!t.fait;
    case_.dataset.tache = t.id;
    case_.addEventListener('change', () => cocher(l, t, case_, derniere, ligne));
    etiquette.append(case_, el('span', 'mt-etape__nom', t.libelle));
    ligne.append(etiquette);
    if (t.fait && t.qui) ligne.append(el('span', 'mt-etape__qui', t.qui));

    // LE COMPTE NE SE DEMANDE QU'À LA DERNIÈRE ÉTAPE, et seulement une fois
    // faite. Le poser sur chacune, ce serait sept questions pour une commande
    // qui n'en pose aucune ; le poser avant, ce serait demander un chiffre
    // qu'on n'a pas encore.
    if (derniere && t.fait) ligne.append(champCompte(l, t));

    // On n'ouvre pas le dossier quand on coche : le clic reste dans la rangée.
    ligne.addEventListener('click', (e) => e.stopPropagation());
    box.append(ligne);
  });
  return box;
}

// LE CAS NORMAL NE DEMANDE RIEN. Cocher la dernière étape déclare d'office que
// tout est bon — c'est ce qui arrive presque toujours, et poser la question à
// chaque fois ferait taper le même nombre cent fois par semaine.
//
// Le champ reste là, rempli, pour le jour où ce n'est PAS le cas : on corrige
// 50 en 49, la perte se calcule seule. C'est une correction, pas une saisie —
// d'où un seul champ, déjà juste, et aucune validation à cliquer.
function champCompte(l, t) {
  const box = el('span', 'mt-compte');
  const bon = el('input', 'mt-compte__n');
  bon.type = 'number';
  bon.min = '0';
  bon.value = t.qte_faite == null ? '' : String(t.qte_faite);
  bon.setAttribute('aria-label', 'Pièces bonnes');
  const total = t.qte_prevue == null ? '' : ` / ${t.qte_prevue}`;
  const suite = el('span', 'mt-compte__total', `${total} bonnes`);

  // À LA PERTE DU FOCUS, jamais à la frappe : un `renderMonTravail()` déclenché
  // à chaque touche reprendrait le champ sous les doigts et perdrait le curseur
  // — le piège est déjà documenté ailleurs dans ce dépôt.
  bon.addEventListener('change', async () => {
    const n = Number.parseInt(bon.value, 10);
    if (!Number.isInteger(n) || n < 0) { bon.value = t.qte_faite == null ? '' : String(t.qte_faite); return; }
    const prevu = t.qte_prevue;
    await ecrireTache(t.id, {
      qte_faite: n,
      ...(prevu != null ? { perte: Math.max(0, prevu - n) } : {}),
    });
    refreshMonTravail();
  });

  if (t.perte) box.append(el('span', 'mt-compte__perte', `${t.perte} perdue${t.perte > 1 ? 's' : ''}`));
  box.prepend(suite);
  box.prepend(bon);
  return box;
}

async function ecrireTache(id, corps) {
  const res = await fetchBorne(`/api/taches/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  });
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  return res.json();
}

async function cocher(l, t, case_, derniere) {
  const fait = case_.checked;
  const corps = { fait };
  // Tout est bon par défaut : c'est le cas courant, et le champ qui apparaît
  // juste après permet de dire le contraire en un chiffre.
  if (fait && derniere && t.qte_prevue != null && t.qte_faite == null) {
    corps.qte_faite = t.qte_prevue;
    corps.perte = 0;
  }
  case_.disabled = true;
  try {
    await ecrireTache(t.id, corps);
  } catch (_) {
    // On REMET la case comme elle était : laisser une case cochée qui n'a rien
    // enregistré, c'est faire croire que le travail est déclaré.
    case_.checked = !fait;
    case_.disabled = false;
    return;
  }
  case_.disabled = false;
  refreshMonTravail();
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
  const tete = ecranTete({ titre: data.qui ? `Bonjour ${data.qui}` : 'Mon travail' });
  const page = el('div', 'mt-page');

  page.append(bloc('À faire', data.aFaire || [], 'Rien ne t’attend. Va voir le planning.'));
  page.append(bloc('En attente', data.enAttente || [],
    'Rien en attente — aucune de tes commandes ne dépend de quelqu’un d’autre.'));
  page.append(bloc('Terminé aujourd’hui', (data.finiAujourdhui || []).map((f) => ({
    ...f, sub_stage: f.sub_stage,
  })), 'Rien de terminé aujourd’hui, pour l’instant.'));

  ROOT.replaceChildren(tete, page);
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
