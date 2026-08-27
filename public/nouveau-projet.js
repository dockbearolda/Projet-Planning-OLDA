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

// LA VOIE RAPIDE, à côté des deux parcours complets (27/08/2026).
// Mesuré sur les 184 dossiers réels : douze champs sont remplis moins d'une
// fois sur deux, six moins d'une fois sur cinq — et ils sont SUR LE CHEMIN,
// entre le client et le prix. `eclair.js` les range derrière un volet et laisse
// sur la route ce qui est toujours rempli. Ce n'est pas un second modèle de
// données : même route, même fiche, même ticket d'atelier.
//
// Elle n'est PAS un cadre : elle vit dans ce document, avec la charte du CRM et
// son thème. Un cadre lui aurait coûté un pont de messages pour rien — les deux
// parcours du patron, eux, sont des documents à part parce qu'ils se REMPLACENT
// d'une version à l'autre.
const ECLAIR = { id: 'eclair', label: 'Saisie éclair', icone: 'bolt' };

const FLUX = [
  {
    id: 'vente',
    label: 'Vente directe',
    icone: 'point_of_sale',
    src: 'comptoir/vente-directe.html',
  },
  {
    id: 'devis',
    label: 'Demande de devis',
    icone: 'request_quote',
    src: 'comptoir/demande-devis.html',
  },
];

// --- LE THÈME DE L'HÔTE, PASSÉ AUX PARCOURS ---------------------------------
// Les deux écrans du comptoir sont des documents à part, affichés dans un
// cadre. Ils lisent la même charte que le planning, thème sombre compris — mais
// un cadre ne connaît pas le `data-theme` de son hôte.
// DEUX CHEMINS, ET LES DEUX SONT NÉCESSAIRES :
//   · l'ADRESSE porte le thème d'ouverture — le cadre l'applique avant son
//     premier pixel, sinon il s'ouvre en clair puis bascule sous les yeux ;
//   · un MESSAGE porte les basculements suivants — l'interrupteur du planning
//     se clique très bien pendant qu'un parcours est ouvert derrière.
function themeActuel() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function urlDuFlux(f) {
  return `${f.src}?theme=${themeActuel()}`;
}

let ROOT = null;
let enCours = false;       // un enregistrement est en vol : on n'en lance pas deux
let fluxAffiche = null;    // le parcours SOUS LES YEUX, s'il y en a un

const cadreDe = (id) => ROOT.querySelector(`#np-frame-${id}`);

// Le cadre a pu être ouvert avant la bascule : on prévient ceux qui existent.
// Un cadre jamais ouvert n'a pas de document — il prendra le thème par son
// adresse le jour où on l'ouvre. Tant que l'onglet n'a pas été construit,
// `ROOT` est nul : il n'y a personne à prévenir.
function diffuserTheme() {
  if (!ROOT) return;
  const theme = themeActuel();
  for (const f of FLUX) {
    const cadre = cadreDe(f.id);
    const w = cadre && cadre.getAttribute('src') && cadre.contentWindow;
    if (w) w.postMessage({ type: 'OLDA_THEME', theme }, window.location.origin);
  }
}

// On observe l'attribut plutôt que d'appeler depuis `applyTheme` : ce module est
// chargé à la demande, il n'a rien à faire dans le chemin de l'interrupteur — et
// n'importe qui d'autre peut changer le thème sans avoir à le savoir.
new MutationObserver(diffuserTheme).observe(document.documentElement, {
  attributes: true, attributeFilter: ['data-theme'],
});


function icone(nom) {
  const i = document.createElement('span');
  i.className = 'material-symbols-outlined';
  i.setAttribute('aria-hidden', 'true');
  i.textContent = nom;
  return i;
}

// --- Affichage ---------------------------------------------------------------
// `id` vaut null sur l'accueil : aucun parcours ouvert, seulement les tuiles.
function afficher(id) {
  const eclair = id === ECLAIR.id;
  const flux = FLUX.find((f) => f.id === id) || null;
  fluxAffiche = eclair ? ECLAIR.id : (flux ? flux.id : null);
  ROOT.querySelector('#np-home').hidden = Boolean(flux) || eclair;
  ROOT.querySelector('#np-frames').hidden = !flux;
  const paneEclair = ROOT.querySelector('#np-eclair');
  if (paneEclair) {
    paneEclair.hidden = !eclair;
    // MONTÉE À LA DEMANDE, comme les cadres : tant que personne n'a ouvert la
    // voie rapide, ni son module ni le catalogue ne sont téléchargés.
    if (eclair) monterVoieRapide(paneEclair);
  }
  /* PLUS DE BARRE DE SORTIE ICI. L'hôte en posait une au-dessus du cadre :
     61 px pour une seule flèche, au-dessus d'une rangée d'étapes qui en prenait
     94. La flèche vit désormais DANS la rangée d'étapes du parcours (voir
     `grefferSortieDuParcours` dans comptoir/pont.js), et c'est le message
     `OLDA_PARCOURS_RETOUR` qui remonte jusqu'ici.
     Sur l'accueil à deux tuiles, il n'y a rien à porter : les onglets et le
     rail sont à l'écran, et « revenir » depuis un écran où l'on vient
     d'arriver n'aurait rien voulu dire. */
  masquerErreur();

  for (const f of FLUX) {
    const cadre = cadreDe(f.id);
    cadre.hidden = !flux || f.id !== flux.id;
    // Chargement à la demande : tant qu'un parcours n'a pas été ouvert, son
    // document n'est même pas téléchargé.
    if (!cadre.hidden && !cadre.src) cadre.src = urlDuFlux(f);
  }
  // Le parcours réaffiché a pu rester ouvert pendant qu'un client était créé
  // depuis l'onglet Base clients : sa recherche doit connaître le nouveau.
  if (flux) {
    fluxTouches.add(flux.id);
    rafraichirClients(flux.id);
  }
}

// Les parcours AFFICHÉS depuis la dernière remise à neuf : eux seuls ont pu
// être salis par une saisie. Les autres sont restés vierges — les recharger
// quand même coûtait, à CHAQUE tap sur l'onglet, ~120 Ko de HTML re-analysé et
// un téléchargement complet de la base clients pour un écran que personne
// n'avait ouvert.
const fluxTouches = new Set();

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
  // On recalcule l'adresse : le thème a pu changer depuis l'ouverture, et
  // recharger l'ancienne rallumerait l'écran en clair le temps d'un message.
  const flux = FLUX.find((f) => f.id === id);
  const url = flux ? urlDuFlux(flux) : cadre.getAttribute('src');
  cadre.setAttribute('src', url);
  try {
    cadre.contentWindow.location.replace(url);
  } catch (err) {
    cadre.src = url;
  }
}

// --- LA VOIE RAPIDE ----------------------------------------------------------
// Elle n'a besoin que de deux choses de l'hôte : de quoi ENREGISTRER (la même
// route, la même file, le même traitement des trois issues), et de quoi PASSER
// LA MAIN au parcours complet quand elle ne sait pas faire.
let eclairPromesse = null;
let eclairEcran = null;

// Le catalogue est un script CLASSIQUE : les deux écrans du comptoir le
// chargent par balise, sans build. On le pose de la même façon, une seule fois.
function poserCatalogue() {
  if (typeof window.catalogueAPlat === 'function') return Promise.resolve();
  return new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = 'comptoir/catalogue.js';
    s.onload = ok;
    s.onerror = () => ko(new Error('catalogue injoignable'));
    document.head.append(s);
  });
}

function monterVoieRapide(hote) {
  if (eclairPromesse) return eclairPromesse;
  eclairPromesse = Promise.all([poserCatalogue(), import('./eclair.js')])
    .then(([, mod]) => {
      eclairEcran = mod.monterEclair(hote, {
        // L'ERREUR REMONTE À LA VOIE RAPIDE, elle ne s'affiche pas au-dessus :
        // l'écran de saisie a son propre message, à côté du bouton qu'on vient
        // de taper. Un message hors de vue est un dossier perdu en silence.
        enregistrer: async (payload) => {
          const data = await enregistrer(payload, { rendreErreur: true });
          const avis = avisEnregistrement(data);
          if (avis) montrerAvis(avis);
          return data;
        },
        ouvrirParcours: (nature) => afficher(nature === 'devis' ? 'devis' : 'vente'),
      });
      return eclairEcran;
    })
    .catch((err) => {
      eclairPromesse = null;
      hote.replaceChildren(Object.assign(document.createElement('p'), {
        className: 'np-erreur',
        textContent: `Saisie éclair indisponible : ${err.message}. Les deux parcours complets restent ouverts.`,
      }));
      return null;
    });
  return eclairPromesse;
}

// --- Erreur d'enregistrement -------------------------------------------------
// Un dossier qui ne part pas au planning ne doit JAMAIS disparaître en silence :
// la vendeuse a le client devant elle. On le dit, et on laisse le parcours
// intact pour qu'elle retape sur le bouton une fois le problème passé.
function montrerErreur(message) {
  const box = ROOT.querySelector('#np-erreur');
  box.textContent = `Enregistrement impossible : ${message}. Le dossier est intact — réessaie.`;
  box.classList.remove('np-erreur--info');
  box.hidden = false;
}
function masquerErreur() {
  const box = ROOT.querySelector('#np-erreur');
  if (box) box.hidden = true;
}
// Une issue qui n'est PAS un échec, mais qui n'est pas non plus le simple
// « c'est enregistré » : le message reste à l'écran, sans l'habit d'une erreur.
function montrerAvis(message) {
  const box = ROOT.querySelector('#np-erreur');
  if (!box) return;
  box.textContent = message;
  box.classList.add('np-erreur--info');
  box.hidden = false;
}

// Ce que le serveur a réellement fait. Trois issues, trois phrases :
//   - la ligne est née → rien à dire, on file au planning ;
//   - c'était le MÊME dossier renvoyé (le réseau avait avalé la réponse d'un
//     envoi abouti) → rien n'a été créé en double, et c'est très bien ;
//   - une AUTRE commande portait déjà cette référence → celle-ci en a pris une
//     autre, donc le ticket déjà remis au client ne dit plus la vérité.
// Annoncer les trois de la même façon, c'était laisser croire à un
// enregistrement là où, dans le troisième cas, on sautait sur la ligne d'une
// collègue et le dossier de la vendeuse n'existait nulle part.
function avisEnregistrement(data) {
  if (data.dejaEnregistre) {
    return 'Ce dossier était déjà au planning : l’envoi précédent avait bien abouti. Rien n’a été créé en double.';
  }
  if (data.refModifiee) {
    return `Enregistré — mais la référence du ticket était déjà prise par une AUTRE commande. `
      + `Ce dossier porte désormais « ${data.refModifiee} » : corrige le numéro sur le ticket remis au client.`;
  }
  // UN DOSSIER À PLUSIEURS ARTICLES DEVIENT PLUSIEURS LIGNES. Le dire, sinon la
  // vendeuse croit avoir enregistré une commande, en trouve quatre au planning,
  // conclut au doublon et en supprime trois.
  const n = data.lot && Number(data.lot.total) > 1 ? Number(data.lot.total) : 0;
  if (n) {
    return `Enregistré — ${n} articles, donc ${n} lignes au planning, regroupées sous le même ticket. `
      + `Chacune avance à son rythme : on peut produire les unes pendant que les autres attendent le fournisseur.`;
  }
  return null;
}
// Pendant l'envoi, la vendeuse doit voir qu'il se passe quelque chose : sans
// ce signe, un réseau lent donnait un écran muet, elle retapait sur le bouton
// et croyait le dossier perdu.
function montrerEnvoi() {
  const box = ROOT.querySelector('#np-erreur');
  if (!box) return;
  box.textContent = 'Enregistrement au planning…';
  box.hidden = false;
}

// --- Accueil : les deux tuiles -----------------------------------------------
function construireAccueil() {
  const home = document.createElement('div');
  home.className = 'np-home';
  home.id = 'np-home';

  /* PAS DE TITRE. « Nouveau projet » répétait mot pour mot l'onglet qui vient
     d'être cliqué, juste au-dessus, et le seul contenu de l'écran est les deux
     tuiles : elles se lisent sans qu'on les annonce. */
  const grille = document.createElement('div');
  grille.className = 'np-home__grid';
  // LA VOIE RAPIDE EN PREMIER : c'est celle qui sert au client courant. Les
  // deux parcours complets restent à côté, pour ce qu'elle ne sait pas faire.
  for (const f of [ECLAIR, ...FLUX]) {
    const tuile = document.createElement('button');
    tuile.type = 'button';
    tuile.className = 'np-tile';
    tuile.id = `np-tile-${f.id}`;

    const rond = document.createElement('span');
    rond.className = 'np-tile__icon';
    rond.append(icone(f.icone));

    const nom = document.createElement('strong');
    nom.textContent = f.label;

    tuile.append(rond, nom);
    tuile.addEventListener('click', () => afficher(f.id));
    grille.append(tuile);
  }
  home.append(grille);
  return home;
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

  // La voie rapide vit ICI, dans le document du CRM : pas de cadre, donc pas de
  // pont de messages ni de thème à repasser.
  const pane = document.createElement('div');
  pane.className = 'np-eclair';
  pane.id = 'np-eclair';
  pane.hidden = true;

  /* LA BARRE EN PREMIER, pas entre l'accueil et les cadres : elle est visible
     aussi sur les tuiles (c'est la sortie du poste) et un `flex: 1` sur
     l'accueil l'aurait poussée tout en bas de l'écran. */
  shell.append(construireAccueil(), erreur, pane, cadres);
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

// Renvoie au parcours ce que le serveur a répondu. Sans ce retour, l'écran de
// la vendeuse ne peut RIEN dire de son propre dossier : le message d'échec vit
// ici, AU-DESSUS du cadre, donc hors de vue sur la tablette — et c'est par ce
// trou que des dossiers sont partis sans que personne ne s'en aperçoive.
function repondreAuParcours(source, ok, message) {
  if (!source || typeof source.postMessage !== 'function') return;
  source.postMessage({ type: 'OLDA_PROJET_RESULT', ok, message }, window.location.origin);
}

// `auto` : l'envoi n'est pas un geste de la vendeuse, c'est le parcours qui
// enregistre son dossier dès qu'il est complet (voir le filet de pont.js). On
// ne l'emporte donc PAS sur la ligne du planning : elle a le ticket à l'écran,
// et il lui reste à l'imprimer.
async function enregistrer(payload, { auto = false, source = null, rendreErreur = false } = {}) {
  // Double tap sur « Créer dans le planning » = une seule ligne au planning.
  // MAIS ON RÉPOND : jeter le message sans un mot laissait l'écran émetteur
  // sur « Enregistrement au planning… » pour toujours — sans bouton Réessayer,
  // et avec le garde-fou de fermeture armé. Le dossier qu'on protégeait
  // restait prisonnier de sa protection.
  if (enCours) {
    const dit = 'un envoi est déjà en cours — réessaie dans un instant';
    repondreAuParcours(source, false, dit);
    // La voie rapide n'a pas de cadre à qui répondre : sans cette levée, elle
    // se remettrait à neuf en croyant le dossier parti.
    if (rendreErreur) throw new Error(dit);
    return;
  }
  enCours = true;
  if (!auto) montrerEnvoi();
  // Une requête sans limite de temps peut rester en suspens indéfiniment sur un
  // wifi d'atelier capricieux : l'écran restait muet, sans erreur ni succès.
  const minuteur = new AbortController();
  const stop = setTimeout(() => minuteur.abort(), 20000);
  try {
    const res = await fetch('/api/comptoir/projet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: minuteur.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `erreur ${res.status}`);
    const avis = avisEnregistrement(data);
    if (avis) montrerAvis(avis); else masquerErreur();
    repondreAuParcours(source, true, avis || '');

    // La voie rapide reste sur son écran : la vendeuse enchaîne les clients,
    // sauter au planning à chaque vente lui coûterait deux gestes de retour.
    if (rendreErreur) return data;

    // Envoi automatique : la ligne est née, le parcours l'affiche lui-même. On
    // laisse la vendeuse sur son ticket.
    if (auto) return;

    // LA RÉFÉRENCE A CHANGÉ : le ticket déjà remis au client ne porte plus le bon
    // numéro, et c'est à corriger maintenant. On reste donc sur l'écran, message
    // affiché — sauter au planning emporterait l'avertissement hors de vue, et
    // c'est exactement le genre de détail qu'on ne retrouve plus après.
    if (data.refModifiee) return;

    // On file au planning, SUR la ligne qui vient de naître. Le parcours, lui,
    // reste EN L'ÉTAT : son écran de fin porte encore le ticket à imprimer, à
    // télécharger ou à envoyer sur WhatsApp, et la vendeuse y revient parfois
    // après avoir vérifié la ligne. La remise à neuf attend le prochain passage
    // sur l'onglet (resetProjet), c'est-à-dire le client suivant.
    window.dispatchEvent(new CustomEvent('olda:projet-cree', {
      detail: { id: data.id, stage: data.stage, sub: data.subStage || null, avis },
    }));
  } catch (err) {
    const raison = err.name === 'AbortError' ? 'le serveur ne répond pas' : err.message;
    repondreAuParcours(source, false, raison);
    // L'appelant qui vit dans ce document affiche l'échec LÀ OÙ ON VIENT DE
    // TAPER. Le bandeau de l'hôte, lui, est au-dessus d'un cadre : pour la voie
    // rapide il serait hors de vue, et c'est par ce trou que des dossiers sont
    // partis sans que personne ne s'en aperçoive.
    if (rendreErreur) throw new Error(raison);
    montrerErreur(raison);
  } finally {
    clearTimeout(stop);
    enCours = false;
  }
}

// Le parcours annonce un envoi AUTOMATIQUE juste avant de poster son dossier :
// deux messages, dans cet ordre, vers la même fenêtre. Le drapeau ne vaut que
// pour l'envoi qui suit — un envoi tapé par la vendeuse, lui, saute au planning
// comme avant.
let prochainEnvoiAutomatique = false;

function auMessage(e) {
  if (e.origin !== window.location.origin) return;
  if (!estUnDesNotres(e.source)) return;
  const msg = e.data;
  if (!msg) return;
  /* La flèche de la rangée d'étapes, dans le cadre : le parcours ne connaît
     aucune adresse, il dit seulement qu'on veut en sortir. L'hôte, lui, sait
     qu'il y a deux tuiles derrière. */
  if (msg.type === 'OLDA_PARCOURS_RETOUR') { afficher(null); return; }
  if (msg.type === 'OLDA_ENVOI_AUTOMATIQUE') {
    prochainEnvoiAutomatique = true;
    // Le dossier suit dans la foulée (même tâche). S'il ne venait pas, le
    // drapeau ne doit pas rester armé et priver le PROCHAIN envoi — tapé par la
    // vendeuse, celui-là — de son saut vers la ligne.
    setTimeout(() => { prochainEnvoiAutomatique = false; }, 0);
    return;
  }
  if (msg.type !== 'OLDA_CREATE_PROJECT' || !msg.payload) return;
  const auto = prochainEnvoiAutomatique;
  prochainEnvoiAutomatique = false;
  enregistrer(msg.payload, { auto, source: e.source });
}

// Un parcours ouvert = une vente ou une demande peut-être en cours de saisie
// dans le cadre. Le planning s'en sert avant de recharger l'écran pour une mise
// à jour : ce qui est tapé au comptoir et pas encore parti n'existe nulle part
// ailleurs. On ne peut pas lire DANS le cadre (il a son propre document) — on
// répond donc à la seule question qu'on sait trancher d'ici : y a-t-il un
// parcours à l'écran ?
export function parcoursOuvert() {
  // La voie rapide vit dans CE document : on sait, elle, ce qu'elle contient.
  // Un écran vide n'est pas une saisie en cours — inutile de retenir une mise à
  // jour pour un formulaire que personne n'a touché.
  if (fluxAffiche === ECLAIR.id) return Boolean(eclairEcran && eclairEcran.enSaisie());
  return fluxAffiche !== null;
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
// abandonné entre deux clients. Sont remis à zéro TOUS les parcours affichés
// depuis la dernière remise à neuf (voir fluxTouches) — un parcours resté
// caché n'a pas pu être sali, le recharger ne ferait que payer deux fois.
export async function resetProjet() {
  if (!monte) return;
  afficher(null);
  for (const f of FLUX) {
    if (fluxTouches.has(f.id)) reinitialiser(f.id);
  }
  fluxTouches.clear();
  // La voie rapide se vide elle aussi : comptoir = on repart net d'un client à
  // l'autre. Jamais montée, il n'y a rien à vider.
  if (eclairEcran) eclairEcran.reinitialiser();
}
