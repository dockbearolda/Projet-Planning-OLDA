// Écran « Projets » : liste, création, duplication, suppression.

import { store, availableFaces, trouverProduitParRef, FACE_ORDER } from './store.js';
import { toast } from './ui.js';
import { loadTailles } from './tailles.js';
import { isProjectBlank, nettoyerId, batDeLaFiche } from './util.js';
import { contexteOuverture } from './crm.js';
import { app } from './app.js';

// CE FICHIER N'A PLUS D'ECRAN (04/09/2026).
//
// Il portait la liste des projets — cartes par client, recherche, « + Nouveau
// projet » — et le flux « Ouvrir un BAT (PDF) » avec son glisser-deposer. Cet
// ecran-la a disparu quand Charlie a ramene l'onglet BAT a ce qu'il demande :
// « nom, projet, reference, couleur, les faces, et les quantites, rien
// d'autre ». Sont partis avec lui `renderProjects`, `ligneProjet`, la reprise
// d'un PDF exporte et `importCatalogueFlow` — plus rien ne les appelait.
//
// CE QUI RESTE EST CE QUI OUVRE UN BAT, et rien d'autre : `startNewProject`
// (le bouton « Nouveau » de l'en-tete) et `ouvrirPourFiche` (le CRM ouvert sur
// une fiche). Les BAT deja faits n'ont pas bouge : ils sont en base et sur
// leurs fiches, c'est seulement l'ecran qui ne les liste plus.

// ---------------------------------------------------------------------------
// OUVRIR SUR UN BAT NEUF
// ---------------------------------------------------------------------------
// L'application s'ouvre sur la feuille, prête à travailler — c'est le geste de
// tous les jours. Mais créer un projet à chaque démarrage laisserait un
// « Projet sans nom » derrière chaque ouverture, et l'écran Projets deviendrait
// le cimetière de ces brouillons.
//
// On REPREND donc le BAT vierge s'il en existe un, au lieu d'en empiler un de
// plus. Il ne peut ainsi jamais y en avoir plus d'un.

// Combien de candidats on accepte de charger avant de renoncer. L'index est
// rangé du plus récemment touché au plus ancien : un BAT vierge laissé par la
// dernière ouverture est en tête, on le trouve au premier essai. La borne
// existe pour le cas dégradé — un fonds de tiroir de vieux brouillons NOMMÉS
// « sans client » qu'il ne faut pas relire un par un au démarrage. Au pire on
// crée un vierge de plus, que l'ouverture suivante reprendra.
const CANDIDATS_MAX = 5;

export async function startNewProject() {
  // L'INDEX SAIT DÉJÀ LEQUEL EST VIERGE (drapeau `vierge`, posé à
  // l'enregistrement — cf. store.indexEntry). On ouvre donc LE bon fichier, et
  // un seul. Avant, il fallait charger les candidats un par un pour les
  // reconnaître : jusqu'à cinq allers-retours réseau EN SÉRIE avant le premier
  // affichage, sur le chemin de démarrage.
  // Le drapeau est une indication, pas une preuve : on revérifie sur le projet
  // chargé (un index écrit par une version antérieure, un fichier modifié
  // ailleurs). S'il ment, on retombe sur le balayage borné d'avant.
  const marques = store.projectsIndex.filter(e => e.vierge === true);
  for (const e of marques.slice(0, CANDIDATS_MAX)) {
    const p = await store.loadProject(e.id).catch(() => null);
    if (!isProjectBlank(p)) continue;
    app.closeProject();
    await app.openProject(p);
    return;
  }

  // Index hérité : aucune entrée ne porte le drapeau. On reprend le balayage,
  // borné comme avant — au pire on crée un vierge de plus, que l'ouverture
  // suivante reprendra (et qui, lui, sera marqué).
  if (!marques.length) {
    let essais = 0;
    for (const e of store.projectsIndex) {
      if (e.vierge !== undefined) continue;
      if (String(e.client || '').trim() || String(e.name || '').trim()) continue;
      if (++essais > CANDIDATS_MAX) break;
      const p = await store.loadProject(e.id).catch(() => null);
      if (!isProjectBlank(p)) continue;
      app.closeProject();
      await app.openProject(p);
      return;
    }
  }
  await createProject();
}

// ------------------------------------------ ouvrir LE BAT d'une fiche du CRM
// Monté dans le CRM, on n'ouvre pas « un BAT neuf » : on ouvre CELUI de la
// fiche sur laquelle le CRM nous a ouverts.
//
// Sans ça, chaque passage sur la fiche en empile un de plus : le premier a été
// rempli, donc il n'est plus vierge, donc `startNewProject` en crée un autre.
// Au bout d'une semaine la fiche en porte cinq et personne ne sait lequel fait
// foi. UNE fiche, UN BAT, et c'est celui-là qu'on rouvre.
export async function ouvrirPourFiche(requestId) {
  if (!nettoyerId(requestId)) { await startNewProject(); return; }

  // Le choix se fait sur l'index SEUL (cf. batDeLaFiche) : déjà en mémoire,
  // zéro requête, et on charge LE bon fichier du premier coup.
  const { id, aOuvrir } = batDeLaFiche(store.projectsIndex, requestId, CANDIDATS_MAX);
  const ouvrir = async (pid) => {
    const p = await store.loadProject(pid).catch(() => null);
    if (!p) return false;
    app.closeProject();
    await app.openProject(p);
    return true;
  };

  if (id && await ouvrir(id)) return;

  // Index hérité : les entrées qui ne portaient pas encore la fiche sont les
  // seules à pouvoir cacher notre BAT. On les ouvre pour vérifier, bornées.
  const cible = nettoyerId(requestId);
  for (const pid of aOuvrir) {
    const p = await store.loadProject(pid).catch(() => null);
    if (!p || p.crmRequestId !== cible) continue;
    app.closeProject();
    await app.openProject(p);
    return;
  }

  // CETTE FICHE N'A PAS ENCORE DE BAT.
  //
  // ⚠ ON NE REPREND PAS UN VIERGE QUAND LA FICHE DIT CE QU'ELLE PRODUIT. Un
  // vierge est vierge : le reprendre donnerait un BAT au premier produit du
  // catalogue, dans la premiere couleur, sans une quantite — exactement ce que
  // le pre-remplissage existe pour eviter. On en cree un, et il naitra rempli.
  // Sans production connue, le comportement d'avant tient : on reprend le
  // vierge plutot que d'en empiler un de plus.
  if (contexteOuverture.prod) await createProject();
  else await startNewProject();
}

// ===========================================================================
// UN BAT QUI S'OUVRE DEJA REMPLI
// ===========================================================================
// Charlie, 04/09/2026 : « quand Melina rentre les informations sur une commande
// de t-shirts, le BAT doit deja etre pre-rempli avec les t-shirts, la bonne
// couleur, etc., qu'on n'ait plus qu'a ajouter les logos, avant, arriere ou
// autre ».
//
// CE QU'ON REMPLIT, ET CE QU'ON NE REMPLIT PAS. Le vetement, son coloris, les
// quantites par taille et les FACES a marquer : tout ce que la vendeuse a deja
// tape, et rien d'autre. Les logos restent a poser — c'est le travail, et le
// deviner donnerait un BAT plausible et faux.
//
// LE RAPPROCHEMENT SE FAIT SANS CASSE NI ACCENT, la regle du reste de
// l'application. Deux catalogues qui se sont formes separement ne se sont mis
// d'accord ni sur les majuscules ni sur « Coeur » contre « Cœur ».
//
// ⚠ LES LIGATURES NE SE DECOMPOSENT PAS. `normalize('NFD')` separe un « é » en
// « e » + accent, mais « œ » est UN caractere a lui seul (U+0153) : il en
// ressort intact. Les zones du BAT s'ecrivent « Cœur », le tableau des tailles
// de logo et la vendeuse ecrivent « Coeur » — deux chaines qui se ressemblent a
// l'oeil et ne sont jamais egales. Trouve en jouant le parcours de bout en
// bout : le pre-remplissage cochait le DOS et pas l'avant, sur une commande qui
// disait « Coeur, Dos ».
const LIGATURES = /[œŒ]/g;
const reduire = (v) => String(v == null ? '' : v).trim().toLowerCase()
  .replace(LIGATURES, 'oe').replace(/[æÆ]/g, 'ae')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// LE CRM ET LE BAT NE NOMMENT PAS LES MANCHES PAREIL. Le tableau des tailles de
// logo dit « Manche DR » et « Manche GA » ; les zones d'ici disent « Manche
// droite » et « Manche gauche ». Deux noms pour la meme manche, et aucun des
// deux n'a tort — on les rapproche plutot que d'en renommer un.
const ALIAS_FACES = {
  'manche dr': 'manche droite', 'manche d': 'manche droite',
  'manche ga': 'manche gauche', 'manche g': 'manche gauche',
  arriere: 'dos', devant: 'avant',
};
const cleFace = (v) => { const c = reduire(v); return ALIAS_FACES[c] || c; };

// De quel COTE du vetement se trouve cette zone ? Les zones portent les noms du
// CRM (« Coeur », « Poitrine », « Dos », « Manche droite »…) et vivent par type
// de produit ; c'est par elles qu'on sait s'il faut montrer l'avant, l'arriere
// ou une manche.
function faceDeLaZone(product, nom) {
  const zones = (store.settings && store.settings.zones && store.settings.zones[product?.type]) || {};
  const cible = cleFace(nom);
  if (!cible) return null;
  for (const faceKey of FACE_ORDER) {
    if ((zones[faceKey] || []).some((z) => cleFace(z.name) === cible)) return faceKey;
  }
  return null;
}

// Le coloris du catalogue qui porte CE nom-la. Rend `null` plutot qu'un
// a-peu-pres : un BAT dans la mauvaise couleur est pire qu'un BAT sans couleur,
// parce qu'il a l'air juste.
function colorisDe(product, nom) {
  const cible = reduire(nom);
  if (!cible) return null;
  const c = (product.colors || []).find((x) => reduire(x.label) === cible || reduire(x.slug) === cible);
  return c ? c.slug : null;
}

// LES QUANTITES PAR TAILLE. La grille de l'article est deja posee avec les
// libelles du produit ; on n'y ecrit que les nombres, sur les lignes qui
// correspondent. Une taille que le produit ne connait pas s'AJOUTE plutot que
// de disparaitre : « Unique » sur une casquette, un « 3XL » commande a part.
function poserLesTailles(article, tailles) {
  for (const { t, n } of Array.isArray(tailles) ? tailles : []) {
    if (!t || !(n > 0)) continue;
    const ligne = (article.sizes || []).find((s) => reduire(s.taille) === reduire(t));
    if (ligne) ligne.quantite = String(n);
    else article.sizes.push({ id: `t${Date.now()}${article.sizes.length}`, taille: String(t), quantite: String(n) });
  }
  // Une grille ou personne n'a rien commande garde ses lignes vides : c'est un
  // BAT visuel, et il en existe.
}

// LES FACES A MONTRER. On coche les cotes du vetement que la commande reclame,
// et SEULEMENT ceux dont le catalogue a une image : cocher un dos sans
// packshot de dos donnerait une feuille avec un trou.
function poserLesFaces(article, product, colorSlug, faces) {
  const dispo = availableFaces(product, colorSlug);
  const voulues = new Set();
  for (const nom of Array.isArray(faces) ? faces : []) {
    const k = faceDeLaZone(product, nom);
    if (k && dispo.includes(k)) voulues.add(k);
  }
  // Rien de reconnu : on retombe sur l'avant, comme un projet neuf ordinaire.
  if (!voulues.size) voulues.add(dispo.includes('front') ? 'front' : dispo[0]);
  for (const k of Object.keys(article.faces)) article.faces[k].included = voulues.has(k);
}

// `prod` = ce que la ligne du CRM porte, ou `null`. Rend le produit du
// catalogue et le coloris a ouvrir — et dit ce qu'il n'a PAS trouve, parce
// qu'un BAT muet qui a l'air d'avoir marche est le pire des deux.
function produitDeLaFiche(prod) {
  const products = store.catalogue.products;
  const ref = prod && String(prod.refFournisseur || '').trim();
  // ⚠ ON NE COMPARE PAS DEUX CHAINES, ON CHERCHE. « K3025 » au comptoir,
  // « K3025IC » chez TopTex : c'est la meme reference, et personne ne les tape
  // deux fois pareil. Voir `trouverProduitParRef` — et quand elle hesite, elle
  // PROPOSE plutot que de choisir a notre place.
  const { produit: trouve, propositions } = ref
    ? trouverProduitParRef(ref) : { produit: null, propositions: [] };
  if (ref && !trouve) {
    const noms = propositions.slice(0, 3).map((p) => p.name || p.refSupplier).join(', ');
    toast(noms
      ? `${ref} : plusieurs vetements y repondent — ${noms}. Choisis lequel.`
      : `${ref} n'est pas au catalogue du BAT — choisis le vetement, ou importe la reference dans Produits.`,
    { ms: 7000 });
  }
  const product = trouve || products[0];
  const colorSlug = (trouve && colorisDe(trouve, prod && prod.couleur)) || product.colors[0]?.slug || '';
  if (trouve && prod && prod.couleur && !colorisDe(trouve, prod.couleur)) {
    toast(`Coloris « ${prod.couleur} » inconnu de ${ref} — a choisir.`, { ms: 6000 });
  }
  return { product, colorSlug, reconnu: !!trouve };
}

async function createProject() {
  const products = store.catalogue.products;
  if (!products.length) { toast('Le catalogue produit est vide.', { error: true }); return; }
  // OUVERT SUR UNE FICHE, ON PART DE CE QU'ELLE PORTE. Hors CRM (ou sur une
  // fiche qui ne dit rien de sa production), c'est le premier produit du
  // catalogue, exactement comme avant.
  const prod = contexteOuverture.prod;
  const { product, colorSlug } = prod
    ? produitDeLaFiche(prod)
    : { product: products[0], colorSlug: products[0].colors[0]?.slug || '' };

  // Les tailles du premier article viennent de la grille produit : on s'assure
  // qu'elle est là (préchargée au démarrage, donc déjà résolue en pratique)
  // avant de créer l'article, sinon il naîtrait avec les tailles par défaut.
  await loadTailles();

  // Un projet démarre avec UN article ; les suivants s'ajoutent depuis la barre
  // d'onglets de l'éditeur (« + Article »).
  // LE CLIENT ET LE PROJET VIENNENT DE LA FICHE quand elle les porte :
  // `attacherContexte` ne les pose que sur un projet qui n'en a pas, et on
  // evite ainsi de les faire retaper sous les yeux du client.
  const project = store.newProject({
    client: (prod && contexteOuverture.client) || '',
    name: (prod && contexteOuverture.projet) || '',
    productId: product.id,
    colorSlug,
  });
  // COULEUR / RÉF. PRODUIT ne sont PAS initialisés : laissés absents, ils suivent
  // le vêtement choisi (cf. articleCouleur/articleRef). Les forcer à '' les figeait
  // sur un override vide — le bandeau affichait « — » et le PDF sortait une case
  // vide alors que le vêtement était bien sélectionné.
  if (prod) {
    // CE QUE LA VENDEUSE A DEJA TAPE : les quantites par taille et les faces a
    // marquer. Il ne reste que les logos a poser — et c'est le travail.
    poserLesTailles(project.articles[0], prod.tailles);
    poserLesFaces(project.articles[0], product, colorSlug, prod.faces);
  } else {
    // n'inclure par défaut que les faces réellement disponibles
    const av = availableFaces(product, colorSlug);
    const faces = project.articles[0].faces;
    for (const k of Object.keys(faces)) faces[k].included = k === 'front' && av.includes('front');
  }
  await store.saveProject(project);

  app.closeProject();
  await app.openProject(project);
}
