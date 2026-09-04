// ===========================================================================
// MONTER BAT STUDIO DANS UNE PAGE QUI NE LUI APPARTIENT PAS
// ---------------------------------------------------------------------------
// Point d'entrée unique de l'intégration dans le CRM. En une ligne :
//
//   import { monterBatStudio } from '/bat/js/monter.js';
//   await monterBatStudio(document.getElementById('zone-bat'), { requestId: 'req-42' });
//
// DEUX ÉCRANS, ET PLUS QUATRE (04/09/2026). Charlie : « je veux que ça me
// demande nom, projet, référence, couleur, les faces, et les quantités, rien
// d'autre ». La FEUILLE est l'application ; PRODUITS reste, parce que c'est par
// lui qu'on ajoute une référence qu'on n'a pas encore.
//
// Sont partis : la liste des projets (son bouton « + Nouveau projet » est
// devenu le « Nouveau » de l'en-tête) et les réglages (l'identité qui signe le
// PDF est déjà un réglage du CRM). Les BAT déjà faits restent en base et sur
// leurs fiches — l'écran ne les liste simplement plus.
//
// Le conteneur reçoit la classe `.bat-app` : c'est elle qui porte les jetons et
// sous laquelle TOUT l'habillage est enfermé (cf. l'entête de app.css). Rien ne
// sort : ni les titres, ni les champs, ni le fond, ni les jetons.
//
// TROIS CHOSES QUE L'HÔTE GARDE POUR LUI, et que ce montage ne touche pas :
//   · le service worker — un worker enregistré depuis « / » intercepterait
//     TOUTES les requêtes du CRM ; `BAT_EMBARQUE` le désactive ;
//   · le thème du document — l'attribut `data-theme` va sur notre conteneur,
//     pas sur `<html>` ;
//   · la hauteur de la page — c'est l'hôte qui donne sa taille au conteneur,
//     `autonome.css` n'est pas chargé.
//
// LA MÊME OSSATURE QU'EN AUTONOME. Elle est écrite ICI et nulle part ailleurs :
// `index.html` la reprend telle quelle. Deux squelettes qui se ressemblent, ce
// sont deux squelettes qui divergent à la première retouche.

// L'EN-TÊTE EST CELUI DU CRM, PAS LE NÔTRE (04/09/2026).
//
// Cette ossature portait sa propre barre : un rond marqué « B », le nom
// « BAT Studio », et quatre onglets. Dans le CRM, la marque est un DOUBLON —
// l'application dit déjà où l'on est, l'onglet « BAT » de sa barre est allumé —
// et la rangée était une SEPTIÈME façon de coiffer un écran, à 62 px quand les
// huit autres écrans en font 71 par `.ecran-tete`.
//
// On reprend donc le composant du CRM (`public/ecran-tete.js` +
// `.ecran-tete` dans `charte.css`) et on lui donne nos onglets. Deux écrans à
// un clic l'un de l'autre doivent donner le même composant, pas deux qui se
// ressemblent — c'est la règle du 25/08, et c'est exactement ce cas-là.
//
// LES CROCHETS DU CODE NE BOUGENT PAS : `#mainnav`, `.nav-btn[data-screen]`,
// `#nav-bat`, `#topbar-project` et `#save-state` sont cherchés par identifiant
// depuis quatre fichiers. La rangée change de forme, pas de prises.
export const ONGLETS = `
  <nav id="mainnav" aria-label="Écrans du bon à tirer">
    <button data-screen="bat" class="nav-btn active" id="nav-bat" type="button">Feuille</button>
    <button data-screen="produits" class="nav-btn nav-produits" type="button">Produits</button>
  </nav>
`;

export const OSSATURE = `
  <main id="screens">
    <section id="screen-bat" class="screen active"></section>
    <section id="screen-produits" class="screen"></section>
  </main>
`;

const FEUILLES = [
  'css/phare.css',
  'css/charte.css',
  'css/phare-composants.css',
  'css/app.css',
  'css/feuille/feuille.css',
  // `css/autonome.css` n'est PAS de la liste : il parle de la page, et la page
  // est celle de l'hôte.
];

// Le graphe STATIQUE de modules — la même liste que les `modulepreload` du
// document autonome, et pour la même raison : sans elle, le navigateur découvre
// `store.js` après `app.js`, `mockup.js` après `store.js`, `batlayout.js` après
// `mockup.js`. Quatre vagues de requêtes en série avant la première ligne
// exécutée. `npm run budget` refuse toute divergence entre cette liste et le
// graphe réel.
const MODULES = [
  'js/base.js', 'js/store.js', 'js/persist.js', 'js/webapi.js', 'js/ui.js',
  'js/crm.js', 'js/projects.js', 'js/tailles.js', 'js/util.js',
  'js/producttype.js', 'js/mockup.js', 'js/mockuppixels.js', 'js/batlayout.js',
];

// Les écrans, tels que `app.go()` les nomme et tels que l'ossature les pose
// (`#screen-<id>`). Écrit ici parce que c'est ici que l'hôte les nomme — et
// cette liste EST le contrat : elle en portait quatre jusqu'à la PR #209, elle
// en porte deux, et `options.ecran` refuse tout nom qui n'y figure pas.
const ECRANS = new Set(['bat', 'produits']);

function precharger(base) {
  for (const rel of MODULES) {
    const href = new URL(rel, base).toString();
    if (document.querySelector(`link[rel="modulepreload"][href="${CSS.escape(href)}"]`)) continue;
    const l = document.createElement('link');
    l.rel = 'modulepreload';
    l.href = href;
    document.head.appendChild(l);
  }
}

// Les feuilles ne peuvent pas vivre dans un shadow DOM tant que les `@font-face`
// y sont : une police déclarée dans une racine d'ombre n'habille pas le
// document. Elles sont donc posées dans le `<head>`, une seule fois — et c'est
// sans risque puisque tout est enfermé sous `.bat-app`.
function poserFeuilles(base) {
  const dejaLa = new Set([...document.styleSheets].map((f) => f.href || ''));
  for (const rel of FEUILLES) {
    const href = new URL(rel, base).toString();
    if (dejaLa.has(href) || document.querySelector(`link[href="${CSS.escape(href)}"]`)) continue;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }
}

/**
 * @param {HTMLElement} conteneur  l'élément du CRM qui accueille l'application
 * @param {object} [options]
 * @param {string}  [options.requestId]  la fiche du CRM sur laquelle on travaille
 * @param {string}  [options.client]     nom du client, si la fiche le porte
 * @param {string}  [options.projet]     intitulé du projet, si la fiche le porte
 * @param {boolean} [options.chrome]     `false` masque la barre d'onglets : l'hôte
 *                                       a déjà sa navigation. L'état de sauvegarde
 *                                       reste visible, en coin.
 * @param {'bat'|'produits'} [options.ecran]
 *                                       l'écran sur lequel ouvrir. Défaut : `bat`.
 *                                       C'est ce qui permet de monter LE MÊME code
 *                                       à plusieurs endroits du CRM — la feuille sur
 *                                       une fiche, le catalogue ailleurs — sans le
 *                                       dupliquer. La liste fait foi : `ECRANS`.
 * @param {string}  [options.base]       racine des ressources (défaut : ce module)
 * @returns {Promise<{app: object, demonter: () => void}>}
 */
export async function monterBatStudio(conteneur, options = {}) {
  if (!conteneur) throw new Error('monterBatStudio : aucun conteneur fourni.');

  // Posé AVANT tout import : `theme.js` et l'enregistrement du worker le lisent
  // à leur exécution, et les modules s'exécutent dès qu'ils sont importés.
  window.BAT_EMBARQUE = true;

  const base = options.base || new URL('../', import.meta.url).toString();
  // Les modules AVANT les feuilles : ils sont sur le chemin critique, elles
  // arrivent de toute façon avant le premier rendu.
  precharger(base);
  poserFeuilles(base);

  // L'ÉCRAN D'OUVERTURE, lu par `demarrer()`. Posé sur `window` et non passé en
  // argument : `demarrer()` est aussi le point d'entrée de l'application
  // autonome, qui n'a personne pour lui passer quoi que ce soit. Une valeur
  // inconnue est IGNORÉE, jamais devinée — ouvrir « le plus ressemblant » des
  // écrans quand l'hôte s'est trompé de nom, c'est masquer sa faute de frappe.
  if (options.ecran) {
    if (ECRANS.has(options.ecran)) window.BAT_ECRAN = options.ecran;
    else console.warn(`monterBatStudio : écran « ${options.ecran} » inconnu, ignoré. Attendu : ${[...ECRANS].join(', ')}.`);
  }

  conteneur.classList.add('bat-app');
  // `chrome: false` : l'hôte a sa propre navigation, la nôtre la répéterait en
  // plus petit — et coûterait 70 px à la feuille A4, qui manque de hauteur et
  // non de largeur. Cf. l'entête de la règle `.sans-chrome` dans app.css.
  if (options.chrome === false) conteneur.classList.add('sans-chrome');
  conteneur.innerHTML = OSSATURE;

  // L'en-tête du CRM, garni de nos onglets. Il n'est pas dans `OSSATURE` parce
  // qu'il ne s'écrit pas : il se DEMANDE au CRM, qui le construit pour ses huit
  // autres écrans de la même façon. Un en-tête recopié serait le neuvième.
  if (options.chrome !== false) {
    const { ecranTete } = await import('../../ecran-tete.js');
    const onglets = document.createElement('div');
    onglets.innerHTML = ONGLETS;
    const etat = document.createElement('div');
    etat.id = 'save-state';
    etat.className = 'save-state';
    etat.setAttribute('role', 'status');
    etat.setAttribute('aria-live', 'polite');
    const projet = document.createElement('div');
    projet.id = 'topbar-project';
    projet.className = 'topbar-project';
    // « NOUVEAU » EST LA SEULE COMMANDE DE CET EN-TÊTE, et elle y est parce que
    // la liste des projets n'existe plus : c'était elle qui portait « + Nouveau
    // projet ». Sans ce bouton, l'écran serait à un coup — le BAT sorti, revenir
    // sur l'onglet rouvrirait le même, rempli.
    // Elle ne DÉTRUIT rien : `startNewProject` reprend le BAT vierge s'il en
    // existe un, et n'en crée un qu'à défaut. Cliquer deux fois de suite
    // n'empile donc pas deux brouillons.
    const neuf = document.createElement('button');
    neuf.type = 'button';
    neuf.id = 'bat-neuf';
    neuf.className = 'btn primaire';
    neuf.textContent = 'Nouveau';
    conteneur.prepend(ecranTete({
      titre: 'Bon à tirer',
      gauche: [onglets.firstElementChild],
      droite: [projet, etat, neuf],
    }));
  } else {
    // Sans chrome, l'hôte a déjà sa navigation — mais l'état de sauvegarde reste
    // la seule chose de cette rangée qui dise ce que l'hôte ignore.
    const etat = document.createElement('div');
    etat.id = 'save-state';
    etat.className = 'save-state';
    etat.setAttribute('role', 'status');
    etat.setAttribute('aria-live', 'polite');
    conteneur.prepend(etat);
  }

  // La fiche du CRM peut être annoncée par l'appelant plutôt que par l'adresse :
  // dans un CRM en une seule page, l'URL est celle du CRM, pas la nôtre.
  if (options.requestId) {
    const { contexteOuverture, nettoyerId } = await import('./crm.js');
    const id = nettoyerId(options.requestId);
    if (id) contexteOuverture.requestId = id;
    if (options.client) contexteOuverture.client = String(options.client);
    if (options.projet) contexteOuverture.projet = String(options.projet);
  }

  // LE THÈME EST CELUI DU CRM, ET IL N'Y EN A QU'UN. `theme.js` est parti avec
  // l'écran « Apparence » des réglages : le CRM porte déjà son bouton lune, et
  // deux commandes pour un seul réglage, c'est la deuxième qui ment.
  // Les jetons du thème sombre descendent de `charte.css` (cf. phare.css), donc
  // basculer le CRM bascule cet écran — sans une ligne de plus.
  // Au passage, ça corrige un défaut réel : embarqué, `theme.js` posait
  // `data-theme` SUR `.bat-app`, que le sélecteur `[data-theme="dark"] .bat-app`
  // ne pouvait pas atteindre — le thème sombre n'existait pas une fois monté.

  const { demarrer, app } = await import('./app.js');
  await demarrer();

  return {
    app,
    // Démonter rend la page à l'hôte : l'éditeur relâche ses écouteurs de
    // fenêtre et ses images, et le conteneur redevient un div ordinaire.
    demonter() {
      app.closeProject();
      conteneur.classList.remove('bat-app', 'sans-chrome');
      conteneur.replaceChildren();
      document.getElementById('toasts')?.remove();
      document.getElementById('modal-root')?.remove();
    },
  };
}
