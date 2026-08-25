// QUI EST AU POSTE — connexion nominative et rôles.
//
// Demande du patron (§3, §39) : quatre rôles, et des permissions « contrôlées
// côté serveur, pas seulement en cachant les boutons ». Le serveur les contrôle
// bien (voir CAPACITES dans server.js) ; ce fichier ne fait que rendre l'écran
// honnête — montrer ce qu'on peut faire, et demander qui vous êtes.
//
// Le mot de passe partagé RESTE la porte du site. Cette connexion-ci ne protège
// pas de l'extérieur : elle dit qui est au poste PARMI les quatre personnes déjà
// entrées. D'où un code court, et une liste de prénoms plutôt qu'un champ à
// remplir — on ne fait pas taper son nom à quelqu'un qu'on connaît.
//
// Tout dort tant que l'interrupteur `comptes` est éteint : `etat.comptes` vaut
// alors `false`, aucun voile ne s'affiche, et `puisJe()` rend `true` partout.

import { fetchBorne } from './reseau.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// L'état connu du poste. `comptes: false` = comportement d'avant, en tout point.
let etat = { comptes: false, moi: null, capacites: null, equipe: [] };
const abonnes = new Set();

export const moi = () => etat.moi;
export const comptesActifs = () => etat.comptes;

// LA question que pose le reste de l'application. Sans comptes, tout est permis
// — c'est exactement ce que fait le serveur, et les deux doivent dire pareil.
export function puisJe(capacite) {
  if (!etat.comptes || !etat.capacites) return true;
  return etat.capacites.includes(capacite);
}

// Prévenir les écrans quand l'identité change : la barre, le rail et le
// planning se recomposent sans qu'on ait à recharger la page.
export function surChangement(fn) {
  abonnes.add(fn);
  return () => abonnes.delete(fn);
}
const prevenir = () => { for (const fn of abonnes) { try { fn(etat); } catch (_) { /* un abonné cassé n'en casse pas d'autres */ } } };

export async function relireSession() {
  try {
    const res = await fetchBorne('/api/session');
    if (!res.ok) return etat;
    const data = await res.json();
    etat = {
      comptes: !!data.comptes,
      moi: data.moi || null,
      capacites: data.capacites || null,
      equipe: Array.isArray(data.equipe) ? data.equipe : [],
    };
  } catch (_) {
    // Réseau coupé : on garde ce qu'on savait. Basculer sur « déconnecté »
    // ferait surgir le voile de connexion au milieu du travail, pour une
    // coupure de deux secondes.
    return etat;
  }
  prevenir();
  if (etat.comptes && !etat.moi) montrerConnexion();
  else retirerConnexion();
  return etat;
}

// --- Le voile de connexion ----------------------------------------------------
let voile = null;

function montrerConnexion() {
  if (voile) return;
  voile = el('div', 'connexion');
  const carte = el('form', 'connexion__carte');
  carte.append(
    el('h1', 'connexion__titre', 'Qui est au poste ?'),
    el('p', 'connexion__sous', 'Choisis ton prénom, puis tape ton code.'),
  );

  const grille = el('div', 'connexion__equipe');
  let choisi = null;
  const champCode = el('input', 'connexion__code');
  champCode.type = 'password';
  champCode.inputMode = 'numeric';
  champCode.autocomplete = 'off';
  champCode.placeholder = 'Code';
  champCode.setAttribute('aria-label', 'Code personnel');

  const aide = el('p', 'connexion__aide', '');
  const erreur = el('p', 'connexion__erreur', '');
  erreur.setAttribute('role', 'alert');
  const valider = el('button', 'connexion__ok', 'Entrer');
  valider.type = 'submit';
  valider.disabled = true;

  for (const membre of etat.equipe) {
    const b = el('button', 'connexion__qui');
    b.type = 'button';
    b.dataset.prenom = membre.prenom;
    b.append(
      el('span', 'connexion__prenom', membre.prenom),
      el('span', 'connexion__role', membre.label),
    );
    b.addEventListener('click', () => {
      choisi = membre;
      for (const autre of grille.children) autre.classList.toggle('is-moi', autre === b);
      // PREMIÈRE CONNEXION : la personne CHOISIT son code, elle ne le devine
      // pas. Sans cette phrase, un champ « Code » vide devant quelqu'un qui n'en
      // a jamais eu, c'est une porte fermée sans serrure visible.
      aide.textContent = membre.aUnCode
        ? ''
        : 'Première connexion : le code que tu tapes maintenant devient le tien.';
      champCode.placeholder = membre.aUnCode ? 'Code' : 'Choisis un code';
      erreur.textContent = '';
      valider.disabled = false;
      champCode.focus();
    });
    grille.appendChild(b);
  }

  carte.append(grille, champCode, aide, erreur, valider);
  carte.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!choisi) return;
    erreur.textContent = '';
    valider.disabled = true;
    valider.textContent = 'Un instant…';
    try {
      const res = await fetchBorne('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prenom: choisi.prenom, code: champCode.value }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
      etat.moi = data.moi;
      etat.capacites = data.capacites;
      retirerConnexion();
      prevenir();
      // On RELIT tout : le poste vient peut-être de changer de personne, donc
      // de droits, et ce qui est affiché derrière le voile date d'avant.
      window.location.reload();
    } catch (err) {
      erreur.textContent = err.message || 'Connexion impossible.';
      valider.disabled = false;
      valider.textContent = 'Entrer';
      champCode.select();
    }
  });

  voile.appendChild(carte);
  document.body.appendChild(voile);
  // Le voile prend le focus : sans ça, la tabulation continue de promener le
  // curseur dans le planning qu'on ne peut plus utiliser, derrière.
  const premier = grille.querySelector('button');
  if (premier) premier.focus();
  document.body.classList.add('a-connecter');
}

function retirerConnexion() {
  if (voile) { voile.remove(); voile = null; }
  document.body.classList.remove('a-connecter');
}

export async function seDeconnecter() {
  await fetchBorne('/api/session', { method: 'DELETE' }).catch(() => {});
  window.location.reload();
}

// UN 401 EN PLEIN TRAVAIL veut dire que la session a expiré (trente jours) ou
// que les comptes viennent d'être allumés depuis un autre poste. On redemande
// qui est là plutôt que d'afficher « Erreur 401 » sur un écran vide.
export function signalerNonConnecte() {
  if (voile) return;
  relireSession();
}
