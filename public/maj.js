// ===========================================================================
// « Le patron a mis à jour » — la bulle qui propose de recharger
// ===========================================================================
// UNE TABLETTE DE L'ATELIER NE SE RECHARGE JAMAIS. Elle est allumée le matin,
// posée au comptoir, et elle reste des jours entiers sur la page ouverte au
// premier café. L'application n'a aucune étape de build : un déploiement
// remplace les fichiers en place, donc le serveur sert bien la nouvelle
// version — mais le poste, lui, continue d'exécuter celle qu'il a chargée. Rien
// ne le lui dit, et personne sur place n'a de raison de deviner qu'il faudrait
// recharger. C'est ce trou que ce module bouche : le serveur annonce l'empreinte
// du site, le poste compare avec la sienne, et propose.
//
// TROIS RÈGLES, ET ELLES TIENNENT TOUTES À CE QUI SE PERD QUAND ON RECHARGE :
//
//   1. ON NE RECHARGE JAMAIS D'OFFICE. Un rechargement automatique tomberait un
//      jour au milieu d'une vente au comptoir, et emporterait le dossier avec
//      lui. C'est un TAP qui décide, toujours.
//   2. ON PRÉVIENT SI UNE SAISIE EST EN COURS. Le tap peut être malheureux
//      aussi : on demande confirmation quand il y a quelque chose à perdre, et
//      on dit quoi.
//   3. LA BULLE NE PART PAS TOUTE SEULE. Ce n'est pas un toast : elle ne
//      s'efface pas au bout de deux secondes pendant que la vendeuse a le dos
//      tourné. Elle attend son tap — c'est le seul moyen d'être sûr que
//      l'information est arrivée à quelqu'un.
//
// Le signal arrive par le flux temps réel, sans une requête de plus : un
// déploiement redémarre le conteneur, tous les flux tombent, chaque poste rouvre
// le sien et reçoit l'empreinte à l'ouverture (voir `event: version` dans
// server.js). `/api/version` n'est là que pour les postes dont le flux est mort.

import { confirmerAction } from './confirmer.js';
import { fetchBorne } from './reseau.js';

// Le filet, pour un poste dont le flux temps réel ne revient pas : dix minutes.
// Ce n'est pas une course — un déploiement du patron n'a jamais eu à être connu
// à la seconde — et c'est 30 octets à l'heure sur six postes.
const VERIF_MS = 10 * 60 * 1000;
// Un `update()` de service worker sur un wifi qui décroche peut ne jamais
// revenir : il ne doit pas retenir le rechargement qu'on vient de promettre.
const DELAI_COQUILLE_MS = 2500;

// L'empreinte du site que CE poste exécute : la première reçue, celle qui date
// du chargement de la page. On ne la remplace jamais — c'est elle qui dit ce qui
// tourne réellement à l'écran. Comparer à la DERNIÈRE reçue plutôt qu'à la
// précédente fait tomber juste même sur un retour arrière : si le patron
// republie la version que le poste exécute déjà, la bulle s'éteint d'elle-même.
let versionChargee = null;
let bulle = null;
let enMarche = false;   // un rechargement est engagé : plus rien d'autre à faire
let saisieEnCours = () => false;
let fluxVivant = () => false;

// ---------------------------------------------------------------------------
// La décision
// ---------------------------------------------------------------------------
// Renvoie vrai quand la version reçue n'est pas celle qui tourne à l'écran.
export function noterVersion(version) {
  if (typeof version !== 'string' || !version) return false;
  if (versionChargee === null) { versionChargee = version; return false; }
  const nouvelle = version !== versionChargee;
  if (nouvelle) montrerBulle(); else cacherBulle();
  return nouvelle;
}

// Le filet : uniquement pour un poste qui ne reçoit plus rien de son flux.
async function verifierVersion() {
  try {
    const r = await fetchBorne('/api/version', { cache: 'no-store' }, 8000);
    if (!r || !r.ok) return;
    const data = await r.json();
    noterVersion(data && data.version);
  } catch (_) {
    // Réseau tombé : ce n'est pas le moment de parler de mise à jour, et de
    // toute façon il n'y aurait rien à recharger. On retentera.
  }
}

export function surveillerMaj(opts = {}) {
  if (typeof opts.saisieEnCours === 'function') saisieEnCours = opts.saisieEnCours;
  if (typeof opts.fluxVivant === 'function') fluxVivant = opts.fluxVivant;

  // AU RÉVEIL DE LA TABLETTE, ON VÉRIFIE MÊME SI LE FLUX SE CROIT VIVANT. Après
  // trois heures d'écran éteint, `streamAlive` vaut encore ce qu'il valait avant
  // la mise en veille : l'`onerror` de l'EventSource peut mettre de longues
  // secondes à arriver, et pendant ce temps le poste se croirait à jour.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) verifierVersion();
  });
  setInterval(() => {
    if (document.hidden || fluxVivant()) return;
    verifierVersion();
  }, VERIF_MS);
}

// ---------------------------------------------------------------------------
// La bulle
// ---------------------------------------------------------------------------
function montrerBulle() {
  if (enMarche) return;
  if (!bulle) {
    bulle = dessinerBulle(document, mettreAJour);
    document.body.append(bulle.racine);
  }
  // Lire une propriété de mise en page force le calcul de l'état de départ :
  // posée et ouverte dans le même lot, la transition n'en aurait aucun et la
  // bulle apparaîtrait d'un coup. On ne passe PAS par `requestAnimationFrame` —
  // il est mis en pause quand l'onglet n'est pas visible, or c'est exactement la
  // situation d'un déploiement : la tablette est en veille au moment où la
  // nouvelle version arrive, et la bulle serait posée sans jamais s'ouvrir.
  void bulle.racine.offsetHeight;
  bulle.racine.classList.add('open');
}

function cacherBulle() {
  if (!bulle) return;
  bulle.racine.classList.remove('open');
}

// `doc` en paramètre : c'est ce qui permet de vérifier le dessin de la bulle
// hors navigateur, comme le ticket (voir dessinerTicket).
export function dessinerBulle(doc, onMaj) {
  const racine = doc.createElement('div');
  racine.className = 'maj';
  // `status` et non `alert` : ça ne doit pas couper la lecture d'écran en cours
  // de phrase — l'information peut attendre la fin de ce qui se dit.
  racine.setAttribute('role', 'status');
  racine.setAttribute('aria-live', 'polite');

  const ic = doc.createElement('span');
  ic.className = 'maj__ic';
  // Dessinée, jamais tirée de la police d'icônes : son sous-ensemble ne porte
  // ni `refresh`, ni `sync`, ni `update` — un nom absent s'affiche en toutes
  // lettres, tronqué à sa première lettre, sans la moindre erreur.
  ic.append(fleche(doc));

  const texte = doc.createElement('div');
  texte.className = 'maj__txt';
  const titre = doc.createElement('strong');
  titre.className = 'maj__titre';
  titre.textContent = 'Mise à jour disponible';
  const detail = doc.createElement('span');
  detail.className = 'maj__detail';
  detail.textContent = 'Le planning a changé — recharge pour l’avoir.';
  texte.append(titre, detail);

  const bouton = doc.createElement('button');
  bouton.type = 'button';
  bouton.className = 'maj__btn';
  bouton.textContent = 'Mettre à jour';
  if (typeof onMaj === 'function') {
    bouton.addEventListener('click', () => onMaj(bouton));
  }

  racine.append(ic, texte, bouton);
  return { racine, bouton };
}

function fleche(doc) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M20.5 4v6h-6', 'M20 14a8 8 0 1 1-1.9-8.3L20.5 8']) {
    const p = doc.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

// ---------------------------------------------------------------------------
// Le rechargement
// ---------------------------------------------------------------------------
async function mettreAJour(bouton) {
  if (enMarche) return;

  // CE QUI EST À L'ÉCRAN ET PAS ENCORE EN BASE VA DISPARAÎTRE. On le dit avant,
  // pas après : une vente au comptoir à moitié saisie ne se retrouve nulle part.
  if (saisieEnCours()) {
    const ok = await confirmerAction(
      'Recharger l’écran maintenant ?',
      'Ce qui n’est pas encore enregistré sera perdu — une cellule en cours de '
      + 'saisie, un dossier du comptoir à moitié rempli.',
      'Mettre à jour quand même',
    );
    if (!ok) return;
  }

  enMarche = true;
  if (bouton) {
    bouton.disabled = true;
    bouton.textContent = 'Mise à jour…';
  }
  await rafraichirCoquille();
  // Le hash suit : on revient sur l'onglet qu'on regardait, pas sur l'accueil.
  window.location.reload();
}

// La coquille hors ligne porte une COPIE des fichiers de l'écran. Le service
// worker sert toujours le réseau d'abord — ce rafraîchissement n'est donc pas ce
// qui applique la mise à jour, le rechargement s'en charge. Il évite qu'un poste
// qui perdrait le réseau juste après reparte, lui, sur l'ancienne copie.
async function rafraichirCoquille() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    await Promise.race([
      reg.update(),
      new Promise((r) => setTimeout(r, DELAI_COQUILLE_MS)),
    ]);
  } catch (_) {
    // Le rechargement a été promis : il a lieu, coquille rafraîchie ou non.
  }
}
