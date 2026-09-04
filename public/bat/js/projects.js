// Écran « Projets » : liste, création, duplication, suppression.

import { store, availableFaces } from './store.js';
import { toast } from './ui.js';
import { loadTailles } from './tailles.js';
import { isProjectBlank, nettoyerId, batDeLaFiche } from './util.js';
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

  // Cette fiche n'a pas encore de BAT : on reprend le vierge s'il y en a un,
  // et `attacherContexte` (dans app.openProject) y colle la fiche.
  await startNewProject();
}

async function createProject() {
  const products = store.catalogue.products;
  if (!products.length) { toast('Le catalogue produit est vide.', { error: true }); return; }
  const product = products[0];
  const colorSlug = product.colors[0]?.slug || '';

  // Les tailles du premier article viennent de la grille produit : on s'assure
  // qu'elle est là (préchargée au démarrage, donc déjà résolue en pratique)
  // avant de créer l'article, sinon il naîtrait avec les tailles par défaut.
  await loadTailles();

  // Un projet démarre avec UN article ; les suivants s'ajoutent depuis la barre
  // d'onglets de l'éditeur (« + Article »).
  const project = store.newProject({ client: '', name: '', productId: product.id, colorSlug });
  // COULEUR / RÉF. PRODUIT ne sont PAS initialisés : laissés absents, ils suivent
  // le vêtement choisi (cf. articleCouleur/articleRef). Les forcer à '' les figeait
  // sur un override vide — le bandeau affichait « — » et le PDF sortait une case
  // vide alors que le vêtement était bien sélectionné.
  // n'inclure par défaut que les faces réellement disponibles
  const av = availableFaces(product, colorSlug);
  const faces = project.articles[0].faces;
  for (const k of Object.keys(faces)) faces[k].included = k === 'front' && av.includes('front');
  await store.saveProject(project);

  app.closeProject();
  await app.openProject(project);
}
