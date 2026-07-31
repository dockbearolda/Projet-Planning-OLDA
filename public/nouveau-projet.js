// Nouveau Projet — l'aiguillage des DEUX flux du comptoir
// ===========================================================================
// « Nouveau Projet » est LA porte d'entrée : toute affaire y naît. Il y a deux
// façons d'entrer, et une seule question les sépare — le client paie-t-il
// maintenant ?
//
//   VENTE DIRECTE : le client est devant le comptoir, on connaît le prix, il
//     paie, il repart avec son ticket. La commande entre au planning déjà
//     chiffrée et encaissée.
//   DEMANDE DE DEVIS : le client demande un prix. Rien n'est chiffré, rien
//     n'est encaissé. La demande entre au planning en « Demande & chiffrage »
//     avec tout le brief, pour que celui qui chiffrera n'ait pas à rappeler le
//     client.
//
// Un tap sur l'onglet ouvre donc D'ABORD le CHOIX : deux grandes tuiles, une
// par flux. Rien ne s'ouvre tant que la vendeuse n'a pas dit ce qu'elle fait —
// c'est la première question qu'elle pose au client, l'écran la pose avec elle.
//
// LES DEUX PARCOURS SONT DES PAGES À PART (public/comptoir/*.html), affichées
// ici dans un cadre. Ce sont les écrans validés par le patron, repris tels
// quels : ils stylent des balises nues (button, input, h2…) et se réécrivent
// entièrement d'une version à l'autre. Les isoler dans leur propre document,
// c'est garantir qu'ils ne débordent jamais sur le CRM et qu'une nouvelle
// version se pose en remplaçant un fichier — pas en retraduisant un parcours.
//
// Ce module ne fait donc QUE trois choses :
//   1. l'accueil (les deux tuiles) et la bascule d'un flux à l'autre ;
//   2. l'écoute du message que le parcours envoie quand la vendeuse tape
//      « Créer dans le planning » ;
//   3. l'appel à l'API et le saut vers la ligne fraîchement créée.
// Le parcours, lui, ne connaît aucune adresse d'API : il produit un dossier
// complet, l'hôte l'enregistre.

const FLUX = [
  {
    id: 'vente',
    label: 'Vente directe',
    icone: 'point_of_sale',
    src: 'comptoir/vente-directe.html',
    // Ce que la vendeuse doit reconnaître en un coup d'œil : la SITUATION, pas
    // la mécanique de l'écran.
    quand: 'Le client est là, le prix est connu : il paie et repart avec son ticket.',
    etapes: 'Articles → Client → Paiement → Ticket',
  },
  {
    id: 'devis',
    label: 'Demande de devis',
    icone: 'request_quote',
    src: 'comptoir/demande-devis.html',
    quand: 'Le client demande un prix : on note son besoin, Atelier OLDA chiffrera.',
    etapes: 'Demande → Besoins → Projet → Contrôle → Client → Récapitulatif',
  },
];

let ROOT = null;
let courant = null;        // id du flux affiché, null sur l'accueil
let enCours = false;       // un enregistrement est en vol : on n'en lance pas deux

const cadreDe = (id) => ROOT.querySelector(`#np-frame-${id}`);

function icone(nom) {
  const i = document.createElement('span');
  i.className = 'material-symbols-outlined';
  i.setAttribute('aria-hidden', 'true');
  i.textContent = nom;
  return i;
}

// --- Affichage ---------------------------------------------------------------
// `id` vaut null sur l'accueil : aucun parcours ouvert, aucune barre de flux.
function afficher(id) {
  const flux = FLUX.find((f) => f.id === id) || null;
  courant = flux ? flux.id : null;
  ROOT.querySelector('#np-home').hidden = !!flux;
  ROOT.querySelector('#np-bar').hidden = !flux;
  ROOT.querySelector('#np-frames').hidden = !flux;
  masquerErreur();

  for (const f of FLUX) {
    const cadre = cadreDe(f.id);
    cadre.hidden = !flux || f.id !== flux.id;
    // Chargement à la demande : tant qu'un parcours n'a pas été ouvert, son
    // document n'est même pas téléchargé.
    if (!cadre.hidden && !cadre.src) cadre.src = f.src;
    const b = ROOT.querySelector(`#np-switch-${f.id}`);
    b.classList.toggle('is-active', !!flux && f.id === flux.id);
    b.setAttribute('aria-pressed', String(!!flux && f.id === flux.id));
  }
  // Le parcours réaffiché a pu rester ouvert pendant qu'un client était créé
  // depuis l'onglet Base clients : sa recherche doit connaître le nouveau.
  if (flux) rafraichirClients(flux.id);
}

function rafraichirClients(id) {
  const cadre = cadreDe(id);
  const w = cadre && cadre.contentWindow;
  if (w && typeof w.oldaRafraichirClients === 'function') w.oldaRafraichirClients();
}

// Repartir de zéro sur un parcours : on recharge son document. Un formulaire à
// moitié rempli par le client précédent n'a rien à faire devant le suivant.
// `location.replace` plutôt que `reload` : le parcours réserve un numéro de
// ticket à chaque chargement, on ne veut pas non plus qu'un « Précédent » du
// navigateur ramène le dossier du client d'avant. Un parcours jamais ouvert n'a
// pas de document : rien à recharger.
function reinitialiser(id) {
  const cadre = cadreDe(id);
  if (!cadre || !cadre.getAttribute('src')) return;
  try {
    cadre.contentWindow.location.replace(cadre.src);
  } catch (err) {
    cadre.src = cadre.getAttribute('src');
  }
}

// --- Erreur d'enregistrement -------------------------------------------------
// Un dossier qui ne part pas au planning ne doit JAMAIS disparaître en silence :
// la vendeuse a le client devant elle. On le dit, et on laisse le parcours
// intact pour qu'elle retape sur le bouton une fois le problème passé.
function montrerErreur(message) {
  const box = ROOT.querySelector('#np-erreur');
  box.textContent = `Enregistrement impossible : ${message}. Le dossier est intact — réessaie.`;
  box.hidden = false;
}
function masquerErreur() {
  const box = ROOT.querySelector('#np-erreur');
  if (box) box.hidden = true;
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
    etapes.textContent = f.etapes;

    tuile.append(rond, nom, quand, etapes);
    tuile.addEventListener('click', () => afficher(f.id));
    grille.append(tuile);
  }
  home.append(grille);
  return home;
}

// --- Barre de flux : la seule commande de l'hôte au-dessus du parcours -------
// Volontairement mince : le parcours porte déjà son propre en-tête noir avec son
// titre. Cette barre ne sert qu'à changer d'avis — on ne la fait pas concurrencer
// l'écran de saisie.
function construireBarre() {
  const barre = document.createElement('div');
  barre.className = 'np-bar';
  barre.id = 'np-bar';
  barre.hidden = true;

  const retour = document.createElement('button');
  retour.type = 'button';
  retour.className = 'np-bar-home';
  retour.id = 'np-home-btn';
  retour.append(icone('grid_view'));
  retour.append(document.createTextNode('Changer de parcours'));
  retour.addEventListener('click', () => afficher(null));

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

  barre.append(retour, bascule);
  return barre;
}

function construire() {
  const shell = document.createElement('div');
  shell.className = 'np-shell';

  const erreur = document.createElement('p');
  erreur.className = 'np-erreur';
  erreur.id = 'np-erreur';
  erreur.setAttribute('role', 'alert');
  erreur.hidden = true;

  const cadres = document.createElement('div');
  cadres.className = 'np-frames';
  cadres.id = 'np-frames';
  cadres.hidden = true;
  for (const f of FLUX) {
    const cadre = document.createElement('iframe');
    cadre.className = 'np-frame';
    cadre.id = `np-frame-${f.id}`;
    cadre.title = f.label;
    cadre.hidden = true;
    cadres.append(cadre);
  }

  shell.append(construireAccueil(), construireBarre(), erreur, cadres);
  ROOT.replaceChildren(shell);
}

// --- Le pont avec le planning ------------------------------------------------
// Le parcours poste `OLDA_CREATE_PROJECT` avec TOUT ce qu'il a recueilli. On ne
// fait confiance qu'à un message venant de NOS cadres, sur NOTRE origine : le
// reste est ignoré sans bruit (une page tierce ne crée pas de commande).
function estUnDesNotres(source) {
  return FLUX.some((f) => {
    const cadre = cadreDe(f.id);
    return cadre && cadre.contentWindow === source;
  });
}

async function enregistrer(payload) {
  // Double tap sur « Créer dans le planning » = une seule ligne au planning.
  if (enCours) return;
  enCours = true;
  masquerErreur();
  try {
    const res = await fetch('/api/comptoir/projet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `erreur ${res.status}`);

    // On file au planning, SUR la ligne qui vient de naître. Le parcours, lui,
    // reste EN L'ÉTAT : son écran de fin porte encore le ticket à imprimer, à
    // télécharger ou à envoyer sur WhatsApp, et la vendeuse y revient parfois
    // après avoir vérifié la ligne. La remise à neuf attend le prochain passage
    // sur l'onglet (resetProjet), c'est-à-dire le client suivant.
    window.dispatchEvent(new CustomEvent('olda:projet-cree', {
      detail: { stage: data.stage, sub: data.subStage || null },
    }));
  } catch (err) {
    montrerErreur(err.message);
  } finally {
    enCours = false;
  }
}

function auMessage(e) {
  if (e.origin !== window.location.origin) return;
  if (!estUnDesNotres(e.source)) return;
  const msg = e.data;
  if (!msg || msg.type !== 'OLDA_CREATE_PROJECT' || !msg.payload) return;
  enregistrer(msg.payload);
}

// --- Montage -----------------------------------------------------------------
let monte = false;
export async function initProjet(root) {
  if (monte) return;
  ROOT = root;
  monte = true;
  construire();
  afficher(null);
  window.addEventListener('message', auMessage);
}

// Un tap sur « Nouveau Projet » dans la nav revient TOUJOURS au choix, avec deux
// parcours vierges : comptoir = on repart net, on ne cherche jamais un brouillon
// abandonné entre deux clients. Les DEUX sont remis à zéro, pas seulement celui
// qu'on affichait — celui qu'on laisse derrière ne doit pas ressurgir à moitié
// rempli au prochain passage.
export async function resetProjet() {
  if (!monte) return;
  afficher(null);
  for (const f of FLUX) reinitialiser(f.id);
}
