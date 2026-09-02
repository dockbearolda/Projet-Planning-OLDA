// L'HISTOIRE D'UN DOSSIER, ENFIN LISIBLE (01/09/2026)
// ===========================================================================
// L'application écrivait deux historiques que PERSONNE ne pouvait ouvrir.
//
//   · Le JOURNAL : depuis des mois, chaque changement d'une commande laisse sa
//     ligne — le prix passé de 480 à 520 €, l'étape déplacée, l'acompte marqué
//     reçu, avec le nom du poste et l'heure. Aucun écran ne le montrait. Le
//     tiroir qui devait le porter a été retiré le 29/08, et la fiche atelier
//     ne l'a jamais repris.
//   · Les VERSIONS DE DOCUMENTS : chaque devis remplacé partait dans une table
//     d'archive, elle aussi sans lecteur.
//
// Un historique écrit et jamais lu est pire que pas d'historique : on croit
// pouvoir répondre à « qu'est-ce qui s'est passé sur ce dossier ? », et le jour
// où la question se pose — un client conteste un prix, un acompte a disparu —
// il n'y a rien à ouvrir.
//
// CE QUE CET ÉCRAN NE FAIT PAS : proposer de revenir en arrière. Il RACONTE.
// Défaire un changement se fait là où on l'a fait, sur le champ lui-même, avec
// la trace que ça laisse à son tour.
//
// LE SERVEUR NOMME, L'ÉCRAN AFFICHE. Les libellés (« Prix TTC », « Devis —
// version 2 ») viennent avec les données : les recopier ici ferait deux tables
// à tenir et une divergence le jour où l'une bouge.

import { api } from './reseau.js';
import { armerModale } from './modale.js';

const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

// « le 30/08 à 16 h 05 ». Pas de secondes : personne ne cherche une seconde, et
// elles allongent chaque ligne d'un tiers.
const QUAND = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
});
const quand = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : QUAND.format(d).replace(', ', ' à ');
};

// UNE VALEUR VIDE SE DIT, elle ne s'efface pas : « (vide) » explique pourquoi la
// ligne existe. Sans ça, « Motif : → » ne veut rien dire.
const valeur = (v) => {
  const t = String(v == null ? '' : v).trim();
  if (!t) return '(vide)';
  if (t === 'true') return 'oui';
  if (t === 'false') return 'non';
  return t;
};

let fermerCourant = null;

/**
 * Ouvre l'historique d'un dossier.
 * @param {string} id       l'identifiant de la commande
 * @param {object} dossier  de quoi titrer la fenêtre : { ref, client }
 */
export async function ouvrirHistorique(id, dossier = {}) {
  if (fermerCourant) fermerCourant();

  const fond = el('div', 'hist');
  const carte = el('section', 'hist__carte');
  carte.setAttribute('role', 'dialog');
  carte.setAttribute('aria-modal', 'true');
  carte.setAttribute('aria-label', 'Historique du dossier');

  const tete = el('header', 'hist__tete');
  const titres = el('div', 'hist__titres');
  titres.append(el('h2', 'hist__titre', 'Historique'));
  const sous = [dossier.ref, dossier.client].filter(Boolean).join(' · ');
  if (sous) titres.append(el('p', 'hist__sous', sous));
  const croix = el('button', 'hist__croix', '×');
  croix.type = 'button';
  croix.setAttribute('aria-label', 'Fermer l’historique');
  tete.append(titres, croix);

  const corps = el('div', 'hist__corps');
  corps.append(el('p', 'hist__attente', 'Lecture…'));
  carte.append(tete, corps);
  fond.append(carte);
  document.body.append(fond);

  const desarmer = armerModale(carte, { premier: () => croix });
  const auClavier = (e) => { if (e.key === 'Escape') fermer(); };

  function fermer() {
    document.removeEventListener('keydown', auClavier, true);
    desarmer();
    fond.remove();
    fermerCourant = null;
  }
  fermerCourant = fermer;
  croix.addEventListener('click', fermer);
  // Le fond ferme, la carte non : un clic à côté est le geste attendu.
  fond.addEventListener('click', (e) => { if (e.target === fond) fermer(); });
  // EN CAPTURE, comme partout ailleurs : sans ça, un champ ouvert dessous
  // avalerait la touche.
  document.addEventListener('keydown', auClavier, true);

  let evenements;
  try {
    evenements = await api('GET', `/api/requests/${encodeURIComponent(id)}/journal`);
  } catch (err) {
    corps.replaceChildren(el('p', 'hist__vide', `Historique illisible : ${err.message}`));
    return;
  }
  if (!fond.isConnected) return;   // fermé pendant la lecture

  if (!Array.isArray(evenements) || !evenements.length) {
    // RIEN N'EST ARRIVÉ N'EST PAS UNE PANNE. Un dossier pris ce matin et pas
    // encore touché n'a pas d'histoire, et c'est une réponse.
    corps.replaceChildren(el('p', 'hist__vide',
      'Rien n’a changé sur ce dossier depuis sa création.'));
    return;
  }

  const liste = el('ol', 'hist__liste');
  for (const e of evenements) {
    const ligne = el('li', 'hist__ligne');

    const entete = el('div', 'hist__quoi');
    entete.append(el('span', 'hist__champ', e.label || e.field));
    // QUI est déclaratif — c'est le prénom choisi sur le poste, pas une preuve.
    // On l'écrit tel quel plutôt que d'inventer « inconnu » : une ligne sans nom
    // vient d'un poste qui ne s'est pas nommé, et le dire serait faux.
    const signature = [quand(e.created_at), e.who].filter(Boolean).join(' · ');
    entete.append(el('span', 'hist__quand', signature));
    ligne.append(entete);

    if (e.lien) {
      // Un document archivé se ROUVRE : c'est tout l'intérêt de l'avoir gardé.
      const lien = el('a', 'hist__doc', e.avant || 'ouvrir');
      lien.href = e.lien;
      lien.target = '_blank';
      lien.rel = 'noopener noreferrer';
      ligne.append(lien);
    } else {
      // `avant` / `apres` sont les valeurs mises en français PAR LE SERVEUR
      // (« Moyenne » et non « 2 », « 520,00 € » et non « 520 »). L'écran ne les
      // recalcule pas : la table des libellés vit d'un seul côté.
      const passage = el('div', 'hist__valeurs');
      passage.append(
        el('span', 'hist__avant', valeur(e.avant)),
        el('span', 'hist__fleche', '→'),
        el('span', 'hist__apres', valeur(e.apres)),
      );
      ligne.append(passage);
    }
    liste.append(ligne);
  }
  corps.replaceChildren(liste);
}
