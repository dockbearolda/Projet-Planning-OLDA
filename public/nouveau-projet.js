// Nouveau Projet — l'aiguillage des DEUX flux du comptoir
// ===========================================================================
// « Nouveau Projet » est LA porte d'entrée : toute affaire y naît. Il y a deux
// façons d'entrer, et une seule question les sépare — le client paie-t-il
// maintenant ?
//
//   VENTE DIRECTE (projet.js) : le client est devant le comptoir, on connaît le
//     prix, il paie, il repart avec un ticket. La commande entre au planning
//     déjà chiffrée et encaissée.
//   DEMANDE DE DEVIS (devis.js) : le client demande un prix. Rien n'est chiffré,
//     rien n'est encaissé. La demande entre au planning en « Demande &
//     chiffrage » avec tout le brief, pour que celui qui chiffrera n'ait pas à
//     rappeler le client.
//
// Ce module ne fait QUE l'aiguillage : l'en-tête noir (titre + sous-titre du
// flux courant), le sélecteur, et le chargement à la demande du module
// correspondant. La barre de navigation principale est masquée sur cet écran
// (body.view-comptoir) : ce sélecteur est la seule façon de passer d'un flux à
// l'autre, il ne peut donc pas être discret.

const FLUX = [
  {
    id: 'vente',
    label: 'Vente directe',
    titre: 'ATELIER OLDA — Vente directe',
    sous: 'Articles → Client → Paiement → Ticket',
    charger: () => import('./projet.js'),
    init: 'initProjet',
    reset: 'resetProjet',
  },
  {
    id: 'devis',
    label: 'Demande de devis',
    titre: 'ATELIER OLDA — Demande de devis',
    sous: 'Demande → Besoins → Projet → Contrôle → Client → Récapitulatif',
    charger: () => import('./devis.js'),
    init: 'initDevis',
    reset: 'resetDevis',
  },
];

let ROOT = null;
let courant = FLUX[0];
// Un module par flux, chargé au premier affichage et monté une seule fois —
// même principe que Base clients / Réglages. Tant qu'un flux n'a pas été ouvert,
// son JS n'est même pas téléchargé.
const charges = new Map();   // id → { module, pret: Promise }

function paneDe(flux) {
  return ROOT.querySelector(`#np-pane-${flux.id}`);
}

function monter(flux) {
  if (charges.has(flux.id)) return charges.get(flux.id).pret;
  const entree = { module: null, pret: null };
  entree.pret = flux.charger()
    .then((m) => { entree.module = m; return m[flux.init](paneDe(flux)); })
    .catch((err) => {
      charges.delete(flux.id);
      console.error(`Nouveau Projet : chargement de « ${flux.label} » impossible`, err);
    });
  charges.set(flux.id, entree);
  return entree.pret;
}

function afficherFlux(id) {
  const flux = FLUX.find((f) => f.id === id) || FLUX[0];
  courant = flux;
  ROOT.querySelector('#np-title').textContent = flux.titre;
  ROOT.querySelector('#np-subtitle').textContent = flux.sous;
  for (const f of FLUX) {
    ROOT.querySelector(`#np-switch-${f.id}`).classList.toggle('is-active', f.id === flux.id);
    ROOT.querySelector(`#np-switch-${f.id}`).setAttribute('aria-pressed', String(f.id === flux.id));
    paneDe(f).hidden = f.id !== flux.id;
  }
  monter(flux);
}

function construire() {
  const shell = document.createElement('div');
  shell.className = 'np-shell';

  const entete = document.createElement('header');
  entete.className = 'vd-header np-header';

  const textes = document.createElement('div');
  const titre = document.createElement('h1');
  titre.id = 'np-title';
  const sous = document.createElement('p');
  sous.id = 'np-subtitle';
  textes.append(titre, sous);

  const bascule = document.createElement('div');
  bascule.className = 'np-switch';
  bascule.setAttribute('role', 'group');
  bascule.setAttribute('aria-label', 'Type de fiche à créer');
  for (const f of FLUX) {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = `np-switch-${f.id}`;
    b.className = 'np-switch-btn';
    b.textContent = f.label;
    b.addEventListener('click', () => afficherFlux(f.id));
    bascule.append(b);
  }
  entete.append(textes, bascule);

  const panes = document.createElement('div');
  panes.className = 'np-panes';
  for (const f of FLUX) {
    const pane = document.createElement('div');
    pane.className = 'np-pane';
    pane.id = `np-pane-${f.id}`;
    pane.hidden = true;
    panes.append(pane);
  }

  shell.append(entete, panes);
  ROOT.replaceChildren(shell);
}

let monteShell = false;
export async function initProjet(root) {
  if (monteShell) return;
  ROOT = root;
  monteShell = true;
  construire();
  afficherFlux(FLUX[0].id);
}

// Un tap sur « Nouveau Projet » dans la nav ouvre TOUJOURS une fiche vierge, et
// sur le flux d'entrée (vente directe) : comptoir = on repart net, on ne cherche
// jamais un brouillon abandonné entre deux clients. Les deux flux sont remis à
// zéro, pas seulement celui qu'on affiche — celui qu'on laisse derrière ne doit
// pas ressurgir à moitié rempli au prochain passage.
export async function resetProjet() {
  if (!monteShell) return;
  afficherFlux(FLUX[0].id);
  for (const flux of FLUX) {
    const entree = charges.get(flux.id);
    if (!entree) continue;
    await entree.pret;
    if (entree.module && entree.module[flux.reset]) entree.module[flux.reset]();
  }
}
