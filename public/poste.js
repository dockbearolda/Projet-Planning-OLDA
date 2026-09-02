// POSTE — qui est devant l'écran
// ===========================================================================
// L'atelier n'a pas de comptes utilisateurs : une tablette au comptoir, une
// autre à l'atelier, un PC pour le patron. La porte d'entrée reste le mot de
// passe partagé du serveur (Basic Auth). Ce module ne rejoue donc PAS une
// authentification — il pose la seule question qui manquait : QUI saisit sur
// cet appareil.
//
// POURQUOI. Le parcours « Demande de devis » ouvrait sur une étape entière
// (date du jour + « Demande prise par » + canal d'entrée) dont la seule vraie
// question était le nom de la vendeuse — reposée à CHAQUE dossier. Demandé une
// fois au poste, ce nom signe toute la journée et l'étape disparaît.
//
// SANS MOT DE PASSE, volontairement : c'est une signature, pas une barrière. Un
// mot de passe par personne, ce serait une table, une migration et une
// procédure de réinitialisation — pour zéro protection en plus, la porte étant
// déjà fermée par le Basic Auth.
//
// OÙ VIT LE NOM. Dans `localStorage`, donc par APPAREIL : c'est exactement la
// granularité voulue (la tablette du comptoir n'est pas le PC du patron).
// `comptoir/pont.js` le relit depuis le cadre du parcours — même origine, même
// stockage. La clé y est réécrite en toutes lettres : pont.js est un script
// classique servi tel quel aux écrans du patron, il ne peut pas importer ce
// module. Les deux copies portent la même note.
//
// ⚠ LA CLÉ N'EST PAS `olda.poste` : celle-là est PRISE. C'est l'identifiant à
// trois caractères de la MACHINE, qui empêche deux tablettes hors réseau de se
// donner la même référence de secours (pont.js, « Le POSTE »). Y écrire un
// prénom, c'est lui faire échouer son `/^[A-Z0-9]{3}$/`, donc lui faire tirer
// un nouvel identifiant à chaque chargement — et effacer le prénom au passage.
// Les deux se ressemblent, elles ne disent pas la même chose : `olda.poste` =
// quelle machine, `olda.qui` = quelle personne.

export const CLE_POSTE = 'olda.qui';

// Un `localStorage` peut être refusé (navigation privée, quota plein). Le poste
// garde alors son nom le temps de la session plutôt que de bloquer l'ouverture
// de l'application sur un écran qu'on ne peut pas franchir.
let secours = null;

export function lirePoste() {
  try { return localStorage.getItem(CLE_POSTE) || secours; } catch (_) { return secours; }
}

function poserPoste(nom) {
  secours = nom || null;
  try {
    if (nom) localStorage.setItem(CLE_POSTE, nom);
    else localStorage.removeItem(CLE_POSTE);
  } catch (_) { /* la session courante garde le nom, l'appareil l'oubliera */ }
}

const initialeDe = (nom) => (nom ? [...nom][0].toUpperCase() : '?');

// --- L'écran « Qui est au poste ? » -----------------------------------------
// Un seul écran pour les deux usages — la première ouverture et le changement
// de personne en cours de journée. Tant que personne ne s'est nommé, il ne se
// referme pas : un dossier signé « » ne se rattrape pas après coup.
//
// `hidden` ne masque rien tout seul quand la classe porte son propre `display`
// (piège maison, trois cas dans ce dépôt) : la règle CSS est écrite en
// `:not([hidden])`, jamais en `display:flex` nu.
function construireEcran(employes, choisir) {
  const fond = document.createElement('div');
  fond.className = 'poste-ecran';
  fond.id = 'posteEcran';
  fond.hidden = true;
  fond.setAttribute('role', 'dialog');
  fond.setAttribute('aria-modal', 'true');
  fond.setAttribute('aria-label', 'Qui est au poste ?');

  const carte = document.createElement('div');
  carte.className = 'poste-carte';

  const choix = document.createElement('div');
  choix.className = 'poste-choix';
  for (const nom of employes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'poste-choix-btn';
    b.dataset.poste = nom;
    const pastille = document.createElement('span');
    pastille.className = 'poste-choix-pastille';
    pastille.setAttribute('aria-hidden', 'true');
    pastille.textContent = initialeDe(nom);
    const label = document.createElement('span');
    label.className = 'poste-choix-nom';
    label.textContent = nom;
    b.append(pastille, label);
    b.addEventListener('click', () => choisir(nom));
    choix.append(b);
  }

  const fermer = document.createElement('button');
  fermer.type = 'button';
  fermer.className = 'poste-fermer';
  fermer.textContent = 'Annuler';

  carte.append(choix, fermer);
  fond.append(carte);
  return { fond, choix, fermer };
}

// --- Montage ----------------------------------------------------------------
// `employes` vient de app.js : une seule liste dans l'application, pas deux.
export function monterPoste(employes) {
  const btn = document.getElementById('posteBtn');
  if (!btn) return;
  const pastille = btn.querySelector('.poste-pastille');
  const nomEl = btn.querySelector('.poste-nom');
  let ecran = null;
  let rendreLeFocus = null;

  function refleter() {
    const nom = lirePoste();
    pastille.textContent = initialeDe(nom);
    nomEl.textContent = nom || 'Se nommer';
    btn.classList.toggle('is-vide', !nom);
    btn.setAttribute('aria-label', nom
      ? `Poste : ${nom} — changer de personne`
      : 'Dire qui est au poste');
    if (ecran) {
      // Le nom en place se lit d'un coup d'œil quand on rouvre l'écran.
      for (const b of ecran.choix.children) b.classList.toggle('is-on', b.dataset.poste === nom);
      ecran.fermer.hidden = !nom; // pas de sortie tant que personne ne s'est nommé
    }
  }

  function fermer() {
    if (!ecran || ecran.fond.hidden) return;
    if (!lirePoste()) return; // l'écran ne se franchit pas sans nom
    ecran.fond.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (rendreLeFocus) { try { rendreLeFocus.focus(); } catch (_) { /* parti du DOM */ } }
    rendreLeFocus = null;
  }

  function ouvrir() {
    if (!ecran) {
      ecran = construireEcran(employes, (nom) => { poserPoste(nom); refleter(); annoncer(nom); fermer(); });
      ecran.fermer.addEventListener('click', fermer);
      // Le fond ferme, la carte non : un tap à côté est le geste attendu au
      // doigt, mais il ne doit pas partir d'un tap DANS la carte.
      ecran.fond.addEventListener('click', (e) => { if (e.target === ecran.fond) fermer(); });
      document.body.append(ecran.fond);
    }
    rendreLeFocus = document.activeElement;
    ecran.fond.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    refleter();
    const cible = ecran.choix.querySelector('.is-on') || ecran.choix.firstElementChild;
    if (cible) cible.focus();
  }

  // Le parcours du comptoir vit dans un cadre : il écoute `storage`, qui ne se
  // déclenche PAS dans le document qui écrit. On le prévient donc directement.
  function annoncer(nom) {
    document.dispatchEvent(new CustomEvent('olda:poste', { detail: { nom } }));
    for (const cadre of document.querySelectorAll('iframe')) {
      try { cadre.contentWindow.postMessage({ type: 'OLDA_POSTE', nom }, location.origin); } catch (_) { /* cadre d'un autre domaine */ }
    }
  }

  btn.addEventListener('click', () => {
    if (ecran && !ecran.fond.hidden) fermer(); else ouvrir();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermer(); });
  // Deux onglets ouverts sur le même poste : celui qui n'a pas changé le nom
  // l'apprend par `storage`.
  window.addEventListener('storage', (e) => { if (e.key === CLE_POSTE) refleter(); });

  refleter();
  if (!lirePoste()) ouvrir();
}
