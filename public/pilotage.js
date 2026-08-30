// PILOTAGE — l'écran de la Direction (§24).
//
// « La Direction ouvre son tableau de bord et voit immédiatement : ce qui rentre,
//   ce qui doit être chiffré, ce qui attend le client, ce qu'il faut commander,
//   ce qui est en production, ce qui bloque, ce qui est en retard, ce qui est
//   prêt, ce qui reste à encaisser, la marge générée. »
//
// IL NE REMPLACE PAS LE POINT DU JOUR, et c'est l'arbitrage central de cet
// écran. Le Point du jour est un écran d'ÉQUIPE, vidé exprès le 25/08 de tout
// ce qui n'est pas du travail — son en-tête est passé de 195 à 57 px en
// retirant précisément ce genre de chiffre. Le patron veut y voir le CA et la
// marge ; les deux ont raison, mais pas sur le même écran. D'où un SECOND
// écran, réservé, et le premier qui ne bouge pas d'un pixel.
//
// Réservé à la capacité `marge`, côté serveur comme côté barre : l'atelier et
// la boutique ne le voient pas, et l'API le refuse.

import { fetchBorne } from './reseau.js';
import { ecranTete } from './ecran-tete.js';

let ROOT = null;
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// Les montants s'écrivent en entier, sans centimes : sur un écran de pilotage on
// regarde des ordres de grandeur, et « 7 180 € » se lit d'un coup d'œil quand
// « 7 179,84 € » demande à être déchiffré.
const EUROS = new Intl.NumberFormat('fr-FR', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
});
const euros = (n) => (Number.isFinite(Number(n)) ? EUROS.format(Number(n)) : '—');

// Une tuile = UN chiffre et ce qu'il veut dire. Pas de flèche de tendance, pas
// de comparaison au mois dernier : on n'a pas l'historique pour ça, et un
// indicateur inventé est pire qu'un indicateur absent.
function tuile(titre, valeur, note, etat) {
  const t = el('article', `pil-tuile${etat ? ` is-${etat}` : ''}`);
  t.append(
    el('span', 'pil-tuile__titre', titre),
    el('span', 'pil-tuile__n', valeur),
  );
  if (note) t.append(el('span', 'pil-tuile__note', note));
  return t;
}

// Depuis combien de temps, en clair. « il y a 6 jours » se compare d'un coup
// d'œil quand une date demande de compter.
function depuis(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const j = Math.floor((Date.now() - t) / 86400000);
  if (j <= 0) return 'aujourd’hui';
  if (j === 1) return 'depuis hier';
  return `depuis ${j} jours`;
}

export function renderPilotage(d) {
  if (!ROOT) return;
  const tete = ecranTete({ titre: 'Pilotage' });
  const page = el('div', 'pil-page');

  const grille = el('div', 'pil-grille');
  const c = d.enCours || {};
  grille.append(tuile('Ce qui rentre', euros(c.ca), `${c.lignes || 0} commandes en cours`));

  // LA MARGE NE S'AFFICHE QUE SI ELLE VEUT DIRE QUELQUE CHOSE. Sur huit lignes
  // dont une seule porte un coût, la différence prix − coût n'est pas une marge.
  // On dit donc sur COMBIEN de lignes elle porte — et si aucune n'est chiffrée,
  // on dit ça plutôt qu'un chiffre.
  if (c.chiffrees) {
    const sous = c.chiffrees === c.lignes
      ? 'sur toutes les commandes'
      : `sur ${c.chiffrees} des ${c.lignes} commandes — les autres n’ont pas de coût saisi`;
    const etat = c.margePct != null && d.marges && c.margePct < d.marges.minimum ? 'alerte' : null;
    grille.append(tuile('Marge', `${c.margePct != null ? `${c.margePct} %` : '—'}`, sous, etat));
    grille.append(tuile('Marge en euros', euros(c.marge), `coût de revient : ${euros(c.cout)}`));
  } else {
    grille.append(tuile('Marge', '—',
      'Aucune commande ne porte de coût de revient. Sans coût, il n’y a pas de marge à calculer.'));
  }

  const enc = d.aEncaisser || {};
  grille.append(tuile('Reste à encaisser', euros(enc.montant),
    `${enc.lignes || 0} commandes non soldées`, enc.montant > 0 ? 'attention' : null));
  grille.append(tuile('En retard', String(d.retards || 0),
    'échéance dépassée, pas encore facturées', d.retards ? 'alerte' : null));
  grille.append(tuile('À débloquer', String(d.bloques || 0),
    'quelqu’un attend une décision', d.bloques ? 'alerte' : null));
  page.append(grille);

  // À DÉBLOQUER, EN PREMIER ET EN ENTIER (§6). « La Direction doit avoir un
  // écran qui montre IMMÉDIATEMENT les projets nécessitant une intervention. »
  // Une tuile qui dit « 4 » ne montre rien : il faudrait aller les chercher, et
  // c'est le geste que cet écran existe pour supprimer.
  const bloques = Array.isArray(d.aDebloquer) ? d.aDebloquer : [];
  if (bloques.length) {
    const bloc = el('section', 'pil-bloc');
    bloc.append(el('h2', 'pil-bloc__titre', 'À débloquer'));
    const liste = el('div', 'pil-bloques');
    for (const b of bloques) {
      const l = el('article', 'pil-bloque');
      const haut = el('div', 'pil-bloque__haut');
      haut.append(el('span', 'pil-bloque__client', b.billing_company || 'Sans client'));
      // DEPUIS QUAND. C'est la seule chose qui hiérarchise : un dossier bloqué
      // depuis six jours n'est pas le même problème qu'un dossier bloqué ce matin.
      haut.append(el('span', 'pil-bloque__depuis', depuis(b.updated_at)));
      l.append(haut);
      // LE MOTIF est ce qu'on vient lire : sans lui, la liste dit qu'il y a un
      // problème sans dire lequel — donc elle n'aide à rien décider.
      l.append(el('p', 'pil-bloque__motif', b.flag_reason || 'Motif non précisé'));
      l.append(el('p', 'pil-bloque__quoi', [
        b.product, b.etape, b.responsable,
      ].filter(Boolean).join(' · ')));
      liste.append(l);
    }
    bloc.append(liste);
    page.append(bloc);
  }

  // LA CHARGE DE L'ATELIER : ce qu'il reste à produire, par poste. C'est la
  // question « est-ce que ça va passer cette semaine ? », et elle ne se répond
  // pas avec un total — elle se répond poste par poste, parce que c'est le
  // poste saturé qui décide.
  const atelier = Array.isArray(d.atelier) ? d.atelier.filter((a) => a.sousEtape) : [];
  const bloc = el('section', 'pil-bloc');
  bloc.append(el('h2', 'pil-bloc__titre', 'Charge de l’atelier'));
  if (!atelier.length) {
    bloc.append(el('p', 'pil-vide', 'Rien en production.'));
  } else {
    const liste = el('div', 'pil-charge');
    for (const a of atelier) {
      const l = el('div', 'pil-poste');
      l.append(
        el('span', 'pil-poste__nom', a.libelle),
        el('span', 'pil-poste__n', `${a.pieces} pièces`),
        el('span', 'pil-poste__lignes', `${a.lignes} commande${a.lignes > 1 ? 's' : ''}`),
      );
      liste.append(l);
    }
    bloc.append(liste);
  }
  page.append(bloc);
  ROOT.replaceChildren(tete, page);
}

export async function refreshPilotage() {
  if (!ROOT) return;
  try {
    const res = await fetchBorne('/api/pilotage');
    if (!res.ok) throw new Error(`Erreur ${res.status}`);
    renderPilotage(await res.json());
  } catch (_) {
    ROOT.replaceChildren(el('p', 'pil-vide', 'Pilotage indisponible — vérifie la connexion.'));
  }
}

export async function initPilotage(root) {
  ROOT = root;
  return refreshPilotage();
}
