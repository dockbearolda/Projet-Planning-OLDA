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
// Un tap sur l'onglet ouvre donc D'ABORD le CHOIX : deux grandes tuiles, une par
// flux. Rien ne s'ouvre tant que la vendeuse n'a pas dit ce qu'elle fait — c'est
// la première question qu'elle pose au client, l'écran la pose avec elle.
// Une fois dans un flux, le sélecteur de l'en-tête permet de passer à l'autre
// sans repasser par l'accueil ; « Changer » y ramène.
//
// Ce module ne fait QUE l'aiguillage : l'accueil, l'en-tête noir (titre +
// sous-titre du flux courant), le sélecteur, et le chargement à la demande du
// module correspondant. La barre de navigation principale est masquée sur cet
// écran (body.view-comptoir) : ces commandes sont les seules à disposition.

const FLUX = [
  {
    id: 'vente',
    label: 'Vente directe',
    icone: 'point_of_sale',
    titre: 'ATELIER OLDA — Vente directe',
    sous: 'Articles → Client → Paiement → Ticket',
    // Ce que la vendeuse doit reconnaître en un coup d'œil : la SITUATION, pas
    // la mécanique de l'écran.
    quand: 'Le client est là, le prix est connu : il paie et repart avec son ticket.',
    charger: () => import('./projet.js'),
    init: 'initProjet',
    reset: 'resetProjet',
  },
  {
    id: 'devis',
    label: 'Demande de devis',
    icone: 'request_quote',
    titre: 'ATELIER OLDA — Demande de devis',
    sous: 'Demande → Besoins → Projet → Contrôle → Client → Récapitulatif',
    quand: 'Le client demande un prix : on note son besoin, Atelier OLDA chiffrera.',
    charger: () => import('./devis.js'),
    init: 'initDevis',
    reset: 'resetDevis',
  },
];

let ROOT = null;
// Un module par flux, chargé au premier affichage et monté une seule fois —
// même principe que Base clients / Réglages. Tant qu'un flux n'a pas été ouvert,
// son JS n'est même pas téléchargé : l'accueil, lui, ne coûte rien.
const charges = new Map();   // id → { module, pret: Promise }

const paneDe = (flux) => ROOT.querySelector(`#np-pane-${flux.id}`);

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

// `id` vaut null sur l'accueil : aucun flux ouvert, aucun en-tête de flux.
function afficher(id) {
  const flux = FLUX.find((f) => f.id === id) || null;
  ROOT.querySelector('#np-home').hidden = !!flux;
  ROOT.querySelector('#np-header').hidden = !flux;
  ROOT.querySelector('#np-panes').hidden = !flux;
  for (const f of FLUX) paneDe(f).hidden = !flux || f.id !== flux.id;
  if (!flux) return;

  ROOT.querySelector('#np-title').textContent = flux.titre;
  ROOT.querySelector('#np-subtitle').textContent = flux.sous;
  for (const f of FLUX) {
    const b = ROOT.querySelector(`#np-switch-${f.id}`);
    b.classList.toggle('is-active', f.id === flux.id);
    b.setAttribute('aria-pressed', String(f.id === flux.id));
  }
  monter(flux);
}

function icone(nom) {
  const i = document.createElement('span');
  i.className = 'material-symbols-outlined';
  i.setAttribute('aria-hidden', 'true');
  i.textContent = nom;
  return i;
}

// --- Accueil : les deux tuiles -----------------------------------------------
function construireAccueil() {
  const home = document.createElement('div');
  home.className = 'np-home';
  home.id = 'np-home';

  const titre = document.createElement('h1');
  titre.textContent = 'Nouveau projet';
  const sous = document.createElement('p');
  sous.className = 'np-home__lead';
  sous.textContent = 'Que fait le client aujourd’hui ?';
  home.append(titre, sous);

  const grille = document.createElement('div');
  grille.className = 'np-home__grid';
  for (const f of FLUX) {
    const tuile = document.createElement('button');
    tuile.type = 'button';
    tuile.className = 'np-tile';
    tuile.id = `np-tile-${f.id}`;

    const rond = document.createElement('span');
    rond.className = 'np-tile__icon';
    rond.append(icone(f.icone));

    const nom = document.createElement('strong');
    nom.textContent = f.label;
    const quand = document.createElement('small');
    quand.textContent = f.quand;
    const etapes = document.createElement('span');
    etapes.className = 'np-tile__steps';
    etapes.textContent = f.sous;

    tuile.append(rond, nom, quand, etapes);
    tuile.addEventListener('click', () => afficher(f.id));
    grille.append(tuile);
  }
  home.append(grille);
  return home;
}

function construireEntete() {
  const entete = document.createElement('header');
  entete.className = 'vd-header np-header';
  entete.id = 'np-header';
  entete.hidden = true;

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
    b.addEventListener('click', () => afficher(f.id));
    bascule.append(b);
  }
  // Retour à l'accueil : la vendeuse s'est trompée de flux, ou elle veut juste
  // revoir les deux choix. Rien n'est perdu — chaque flux garde sa saisie.
  const retour = document.createElement('button');
  retour.type = 'button';
  retour.className = 'np-switch-btn np-switch-btn--home';
  retour.id = 'np-home-btn';
  retour.append(icone('grid_view'));
  retour.append(document.createTextNode('Changer'));
  retour.addEventListener('click', () => afficher(null));
  bascule.append(retour);

  entete.append(textes, bascule);
  return entete;
}

function construire() {
  const shell = document.createElement('div');
  shell.className = 'np-shell';

  const panes = document.createElement('div');
  panes.className = 'np-panes';
  panes.id = 'np-panes';
  panes.hidden = true;
  for (const f of FLUX) {
    const pane = document.createElement('div');
    pane.className = 'np-pane';
    pane.id = `np-pane-${f.id}`;
    pane.hidden = true;
    panes.append(pane);
  }

  shell.append(construireAccueil(), construireEntete(), panes);
  ROOT.replaceChildren(shell);
}

let monteShell = false;
export async function initProjet(root) {
  if (monteShell) return;
  ROOT = root;
  monteShell = true;
  construire();
  afficher(null);
}

// Un tap sur « Nouveau Projet » dans la nav revient TOUJOURS au choix, avec deux
// fiches vierges : comptoir = on repart net, on ne cherche jamais un brouillon
// abandonné entre deux clients. Les deux flux sont remis à zéro, pas seulement
// celui qu'on affichait — celui qu'on laisse derrière ne doit pas ressurgir à
// moitié rempli au prochain passage.
export async function resetProjet() {
  if (!monteShell) return;
  afficher(null);
  for (const flux of FLUX) {
    const entree = charges.get(flux.id);
    if (!entree) continue;
    await entree.pret;
    if (entree.module && entree.module[flux.reset]) entree.module[flux.reset]();
  }
}
