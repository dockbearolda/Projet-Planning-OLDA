// Point d'entrée du renderer : init, navigation, contexte projet ouvert.

import './webapi.js'; // installe batApi : tout l'accès fichiers passe par lui
import { store, importOldaCatalogue } from './store.js';
import { onSaveState, resumePending, onConflit, resoudreConflit } from './persist.js';
import { toast, confirmModal, el } from './ui.js';
import { attacherContexte, contexteOuverture } from './crm.js';
import { renderProjects, startNewProject, ouvrirPourFiche } from './projects.js';
import { loadTailles } from './tailles.js';
import { ICON_SETTINGS, ICON_GARMENT } from './util.js';
import { chemin } from './base.js';

// Modules lourds chargés à la demande (import dynamique) : l'écran d'accueil
// « Projets » n'a pas besoin de l'éditeur BAT ni de l'administration. batpage
// tire pdf-lib + pako (via vendor.js) ; les différer allège nettement le JS
// initial et le LCP. Chaque module n'est téléchargé qu'à sa première utilisation.
let _BatPage = null;
const loadBatPage = async () => (_BatPage ??= (await import('./batpage.js')).BatPage);

// Voile de chargement discret le temps d'un import lourd / d'un rendu (évite un
// écran vide perçu, surtout en 4G). Retiré dès que le contenu est prêt.
function showLoading(host) {
  const l = document.createElement('div');
  l.className = 'screen-loading';
  l.innerHTML = '<div class="spinner" aria-hidden="true"></div>';
  host.appendChild(l);
  return () => l.remove();
}

export const app = {
  screen: 'projects',
  project: null,       // projet ouvert
  batPage: null,       // instance BatPage (l'écran-PDF)

  // Précharge (sans bloquer) le module éditeur — appelé au survol de « Ouvrir ».
  preloadEditor() { loadBatPage().catch(() => {}); },

  async openProject(p) {
    // LE CRM MÈNE : s'il nous a ouverts sur une fiche (?request=…), le projet
    // la retient. Rouvrir ce BAT trois jours plus tard, depuis la liste et sans
    // paramètre, déposera quand même au bon endroit.
    if (attacherContexte(p)) store.saveProject(p);
    this.project = p;
    document.getElementById('nav-bat').disabled = false;
    this.updateTopbar();
    await this.go('bat');
  },

  // Chip Material « projet ouvert » : client · projet · N articles · version.
  // Segments séparés par des points médians, la version en pastille tonale.
  updateTopbar() {
    const p = this.project;
    const box = document.getElementById('topbar-project');
    box.replaceChildren();
    box.classList.toggle('on', !!p);
    if (!p) return;
    // Un projet porte toute la commande : on résume le nombre d'articles plutôt
    // qu'un vêtement, qui n'en désignerait qu'un seul.
    const n = (p.articles || []).length;
    const arts = n > 1 ? `${n} articles` : (store.product(p.articles?.[0]?.productId)?.name || '?');
    const seg = (txt, cls) => {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = txt;
      return s;
    };
    const dot = () => seg('·', 'tp-sep');
    const badge = seg('v' + p.fiche.version, 'pastille');

    // NI CLIENT NI PROJET : c'est un BAT qu'on vient d'ouvrir, pas un dossier
    // dont deux champs manqueraient. « — · — » le faisait passer pour incomplet
    // alors qu'il n'y a rien à compléter encore — et depuis que l'application
    // s'ouvre là-dessus, c'est le premier état que l'on voit à chaque
    // démarrage. On le NOMME.
    const vierge = !String(p.client || '').trim() && !String(p.name || '').trim();
    if (vierge) {
      box.append(seg('Nouveau BAT', 'tp-client'), dot(), seg(arts, 'tp-arts'), badge);
      box.title = `Nouveau BAT · ${arts} (v${p.fiche.version})`;
      return;
    }

    box.append(
      seg(p.client || '—', 'tp-client'), dot(),
      seg(p.name || '—', 'tp-name'), dot(),
      seg(arts, 'tp-arts'), badge,
    );
    box.title = `${p.client || '—'} · ${p.name || '—'} · ${arts} (v${p.fiche.version})`; // texte complet au survol (le libellé est tronqué)
  },

  closeProject() {
    this.project = null;
    this.batPage?.destroy();
    this.batPage = null;
    document.getElementById('nav-bat').disabled = true;
    this.updateTopbar();
  },

  async saveProject() {
    if (!this.project) return;
    await store.saveProject(this.project);
  },

  async go(screen) {
    this.screen = screen;
    for (const b of document.querySelectorAll('.nav-btn')) {
      b.classList.toggle('active', b.dataset.screen === screen);
    }
    for (const s of document.querySelectorAll('.screen')) {
      s.classList.toggle('active', s.id === 'screen-' + screen);
    }
    const host = document.getElementById('screen-' + screen);
    if (screen === 'projects') await renderProjects(host);
    if (screen === 'produits') {
      const done = showLoading(host);
      try {
        const { renderProduits } = await import('./produits.js');
        await renderProduits(host);
      } finally { done(); }
    }
    if (screen === 'reglages') {
      const done = showLoading(host);
      try {
        const { renderReglages } = await import('./reglages.js');
        await renderReglages(host);
      } finally { done(); }
    }
    if (screen === 'bat' && this.project) {
      if (!this.batPage) {
        const done = showLoading(host);
        try {
          const BatPage = await loadBatPage();
          this.batPage = new BatPage(host);
          await this.batPage.load(this.project);
        } finally { done(); }
      } else {
        // reprend les changements faits ailleurs (réglages : zones, mentions…)
        await this.batPage.refresh();
      }
    }
  },
};

window.app = app;     // debug + mode captures
window.store = store; // idem

// Barre supérieure : les deux onglets qui portent une icône (jamais d'emoji).
function fillTopbar() {
  const reglages = document.querySelector('.nav-reglages');
  const label = document.createElement('span');
  label.textContent = 'Réglages';
  reglages.replaceChildren(el(ICON_SETTINGS), label);
  reglages.setAttribute('aria-label', 'Réglages');

  const produits = document.querySelector('.nav-produits');
  const labelP = document.createElement('span');
  labelP.textContent = 'Produits';
  produits.replaceChildren(el(ICON_GARMENT), labelP);
  produits.setAttribute('aria-label', 'Produits');
}

// Indicateur de sauvegarde. Le seul état qui compte vraiment est 'pending' :
// une modification n'est pas encore chez le serveur. On l'affiche alors en
// clair et sans disparaître, avec la seule chose que l'utilisateur ait besoin
// de savoir — c'est gardé sur l'appareil, rien n'est perdu. « Enregistré »
// n'apparaît qu'un instant après une écriture : un badge permanent qui répète
// que tout va bien devient invisible, et ne rassure donc plus quand il compte.
const SAVE_LABEL = {
  saving: 'Enregistrement…',
  pending: 'Modifications en attente',
  saved: 'Enregistré',
  conflit: 'Modifié ailleurs',
};
const SAVE_HINT = {
  pending: 'Le réseau ou le serveur est injoignable. Vos modifications sont conservées sur cet appareil et repartiront automatiquement — vous pouvez fermer l\'onglet.',
  conflit: 'Ce projet a été enregistré depuis un autre appareil. Vos modifications sont gardées ici en attendant que vous choisissiez laquelle garder.',
};

// ---------------------------------------------------------------------------
// LE CONFLIT ENTRE DEUX APPAREILS
// ---------------------------------------------------------------------------
// L'atelier et le commercial ouvrent le même projet : le dernier à enregistrer
// écrasait l'autre, en silence. Le serveur refuse maintenant l'écriture quand
// le fichier a bougé depuis sa lecture — et ici, on POSE LA QUESTION. Les deux
// versions existent au moment où elle est posée : celle qu'on vient de faire
// (gardée en local) et celle du serveur. Aucune ne se perd tant qu'on n'a pas
// répondu.
function mountConflitHandler() {
  const dejaPose = new Set();
  onConflit((rel) => {
    if (dejaPose.has(rel)) return;   // une seule question par fichier
    dejaPose.add(rel);
    const t = toast('Ce projet a été modifié sur un autre appareil.', {
      error: true, ms: 0,
      action: {
        label: 'Choisir',
        onClick: async () => {
          t.dismiss();
          const garder = await confirmModal(
            'Deux versions de ce projet',
            'Quelqu\'un a enregistré ce projet depuis un autre appareil pendant que vous y travailliez. '
            + 'Gardez votre version (elle remplacera l\'autre), ou reprenez celle de l\'autre appareil '
            + '(vos modifications non enregistrées seront perdues).',
            { okLabel: 'Garder ma version' });
          dejaPose.delete(rel);
          if (garder) {
            resoudreConflit(rel, 'local');
            toast('Votre version est enregistrée.');
          } else {
            resoudreConflit(rel, 'serveur');
            location.reload();
          }
        },
      },
    });
  });
}

function mountSaveIndicator() {
  const box = document.getElementById('save-state');
  const dot = document.createElement('span');
  dot.className = 'ss-dot';
  dot.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  // Au téléphone la barre n'a pas la place du mot : c'est le POINT qui reste et
  // l'infobulle qui parle. Le libellé porte donc sa propre classe pour pouvoir
  // se retirer sans emporter le point avec lui.
  label.className = 'ss-txt';
  box.append(dot, label);
  let hideTimer = null;
  onSaveState((s) => {
    clearTimeout(hideTimer);
    box.className = 'save-state on ' + s;
    label.textContent = SAVE_LABEL[s] || '';
    box.title = SAVE_HINT[s] || SAVE_LABEL[s] || '';
    if (s === 'saved') hideTimer = setTimeout(() => { box.className = 'save-state'; }, 2200);
  });
  // Modifications restées en attente d'une session précédente (onglet fermé
  // hors-ligne) : le store les a déjà relues pour l'affichage, il reste à
  // rattraper le serveur.
  const n = resumePending();
  if (n) console.info(`${n} modification(s) en attente reprise(s) de la session précédente.`);
}

// Un onglet ouvert ne reçoit jamais les déploiements : il tourne sur le code
// d'avant jusqu'à rechargement — un bug « corrigé et déployé » y reste visible
// indéfiniment, sans que rien ne le signale. On compare donc l'identité de
// build du serveur (SHA Railway, cf. /api/info) au retour de focus et toutes
// les 5 minutes, et on propose UN rechargement. Jamais d'auto-reload : un
// dialogue d'export ou une saisie en cours ne doivent pas sauter.
function watchForNewVersion() {
  // L'identité de build est DÉJÀ lue par `store.init()` : la redemander ici
  // faisait deux `/api/info` au démarrage, dont un pour ne rien apprendre. On
  // part de ce qui est en mémoire ; le sondage suivant est le premier vrai.
  let initial = store.appInfo?.build || null;
  let offered = false;
  let waiting = null;   // worker installé qui attend de prendre la main

  const offer = () => {
    if (offered) return;
    offered = true;
    toast('Une mise à jour de BAT Studio est en ligne.', {
      ms: 0,
      action: {
        label: 'Recharger',
        onClick: () => {
          // Le nouveau worker n'a pas pris la main tout seul (cf. sw.js) : il
          // attend ce feu vert, donné par l'utilisateur et jamais au milieu
          // d'un export. `controllerchange` suit, et c'est LUI qui recharge —
          // recharger avant laisserait la page sur l'ancien cache.
          if (waiting) waiting.postMessage('SKIP_WAITING');
          else location.reload();
        },
      },
    });
  };

  let premierSondage = true;
  const check = async () => {
    if (offered) return;
    try {
      // Le premier tour ne redemande rien : `store.init()` vient de lire
      // /api/info, et le redemander une seconde plus tard n'apprend rien —
      // c'était un aller-retour de plus sur le chemin de démarrage.
      const info = premierSondage && store.appInfo ? store.appInfo : await window.batApi.appInfo();
      premierSondage = false;
      const { build } = info;
      if (!build) return;                    // dev local ou desktop : inactif
      if (!initial) { initial = build; return; }
      if (build === initial) return;
      offer();
    } catch { /* hors-ligne passager : on retentera */ }
  };

  // Le service worker détecte les mises à jour de façon bien plus fiable que ce
  // sondage : le fichier /sw.js change à chaque déploiement. Le sondage reste
  // en secours pour les navigateurs sans worker (et sur un onglet en http).
  const sw = navigator.serviceWorker;
  const registerSW = async () => {
    if (!sw) return null;
    // POSÉE DANS UN CRM, ELLE N'ENREGISTRE RIEN. Un worker s'enregistre à la
    // portée de son chemin : depuis « / », il intercepterait TOUTES les requêtes
    // de l'hôte, y compris les siennes — un cache hors-ligne posé sur une
    // application qui n'a rien demandé. L'hôte pose `window.BAT_EMBARQUE = true`
    // et le sujet est clos ; c'est alors à LUI de décider de son hors-ligne.
    if (window.BAT_EMBARQUE) return null;
    try {
      // LE PIÈGE DU PREMIER CHARGEMENT. `controllerchange` se déclenche aussi
      // quand le TOUT PREMIER worker prend la main (`clients.claim()` dans son
      // activation) : recharger là, c'est recharger l'application entière une
      // seconde après son ouverture, à chaque première visite et après chaque
      // vidage de cache — mesuré, deux navigations pour une ouverture. Ce qui
      // justifie un rechargement, c'est un worker qui en REMPLACE un autre.
      const avaitUnControleur = !!sw.controller;
      let rechargement = false;
      sw.addEventListener('controllerchange', () => {
        if (!avaitUnControleur || rechargement) return;
        rechargement = true;
        location.reload();
      });
      const reg = await sw.register(chemin('/sw.js'));
      const track = (worker) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          // « installed » avec un contrôleur déjà en place = une VERSION
          // PRÉCÉDENTE tourne dans cet onglet. Sans contrôleur, c'est la toute
          // première installation : rien à annoncer.
          if (worker.state === 'installed' && sw.controller) { waiting = worker; offer(); }
        });
      };
      if (reg.waiting && sw.controller) { waiting = reg.waiting; offer(); }
      track(reg.installing);
      reg.addEventListener('updatefound', () => track(reg.installing));
      return reg;
    } catch (e) {
      // Contexte non sécurisé (http hors localhost), stockage refusé : l'app
      // fonctionne exactement comme avant, simplement sans hors-ligne.
      console.info('Mode hors-ligne indisponible :', e?.message || e);
      return null;
    }
  };

  registerSW().then((reg) => {
    check();
    const tick = () => { reg?.update().catch(() => {}); check(); };
    setInterval(tick, 5 * 60_000);
    window.addEventListener('focus', tick);
  });
}

export async function demarrer() {
  await store.init();
  fillTopbar();
  mountSaveIndicator();
  mountConflitHandler();
  watchForNewVersion();

  // DONNÉES ÉPHÉMÈRES : le serveur a détecté que le répertoire de données vit
  // dans le conteneur — le prochain déploiement les efface. C'est le seul cas
  // où l'application ouvre sur un avertissement : il n'y a pas de « plus tard »
  // pour une donnée qui va disparaître.
  if (store.appInfo?.donneesEphemeres) {
    toast('Les données ne survivront pas au prochain déploiement (aucun volume monté).', {
      error: true, ms: 0,
      action: { label: 'Sauvegarder', onClick: () => { window.location.href = chemin('/api/backup'); } },
    });
  }

  // Grille des tailles produit : chargée en fond dès le démarrage pour être
  // prête quand un article sera créé. Sans attente ici — l'écran « Projets »
  // ne s'ouvre pas plus tard à cause d'elle, et son échec est déjà silencieux.
  loadTailles();

  // En version web, le catalogue produits est intégré à l'app : chargement
  // automatique au premier démarrage (aucun import à faire).
  if (!store.catalogue.products.length) {
    try {
      await importOldaCatalogue('@server-catalogue');
    } catch (e) {
      console.error('Catalogue intégré indisponible :', e);
    }
  }

  document.querySelectorAll('.nav-btn').forEach(b => {
    b.addEventListener('click', () => app.go(b.dataset.screen));
  });

  window.addEventListener('error', (e) => {
    console.error(e.error || e.message);
    toast('Erreur : ' + (e.error?.message || e.message), { error: true, ms: 6000 });
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error(e.reason);
    toast('Erreur : ' + (e.reason?.message || e.reason), { error: true, ms: 6000 });
  });

  // UN ÉCRAN IMPOSÉ PAR L'HÔTE l'emporte sur l'ouverture par défaut (cf.
  // l'option `ecran` de monterBatStudio). Monté dans les réglages du CRM, on ne
  // veut pas d'un BAT : on veut le catalogue produits, ou les réglages.
  const impose = window.BAT_ECRAN;
  if (impose && impose !== 'bat') { await app.go(impose); return; }

  // Sans catalogue produit, il n'y a pas de vêtement à poser : on retombe sur
  // l'écran Projets, qui est justement celui qui explique comment l'importer.
  if (!store.catalogue.products.length) { await app.go('projects'); return; }

  // L'APPLICATION S'OUVRE SUR LA FEUILLE, pas sur la liste : on vient y faire un
  // BAT, pas consulter un catalogue de projets.
  try {
    // LE CRM MÈNE. Ouvert sur une fiche, on rouvre LE BAT de cette fiche —
    // jamais un neuf, sinon chaque passage sur la fiche en empile un de plus.
    // Hors CRM, `startNewProject` reprend le BAT vierge s'il en existe un, donc
    // l'ouverture n'en empile pas non plus.
    if (contexteOuverture.requestId) await ouvrirPourFiche(contexteOuverture.requestId);
    else await startNewProject();
  } catch (e) {
    console.error('Ouverture du BAT impossible :', e);
    await app.go('projects');
  }
}

// L'APPLICATION AUTONOME SE LANCE SEULE ; MONTÉE DANS UN CRM, ELLE ATTEND.
// `monterBatStudio()` pose l'ossature dans son conteneur AVANT d'appeler
// `demarrer()` — se lancer à l'import chercherait un `#topbar` qui n'existe pas
// encore.
if (!window.BAT_EMBARQUE) demarrerAvecFilet();

// Un échec de `demarrer()` survient AVANT que les gardes globaux (error /
// unhandledrejection) ne soient posés : sans ce filet, l'utilisateur n'a qu'une
// page blanche et aucune indication de quoi faire. Le message reste dans le
// document lui-même — à ce stade, ni les toasts ni les écrans n'existent.
export function demarrerAvecFilet() {
  return demarrer().catch((err) => {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'boot-error';
  box.setAttribute('role', 'alert');
  const h = document.createElement('h1');
  h.textContent = 'BAT Studio n\'a pas pu démarrer';
  const p = document.createElement('p');
  p.textContent = 'Rechargez la page. Si le problème persiste, repartez d\'une copie propre : '
    + 'cela vide le cache hors-ligne et retélécharge l\'application. Vos projets ne sont pas touchés — '
    + 'ils vivent sur le serveur.';
  const d = document.createElement('p');
  d.className = 'boot-error-detail';
  d.textContent = String(err?.message || err);
  box.append(h, p, d);

  // LA SORTIE DE SECOURS. Un démarrage qui échoue laissait l'utilisateur devant
  // un mur : la seule issue était un rechargement forcé au clavier, que
  // personne ne connaît, et qui ne suffit pas toujours — un service worker
  // périmé continue de répondre après un simple F5.
  // Ce bouton retire le worker et vide les caches, puis recharge. Il ne touche
  // à AUCUNE donnée : projets, logos et BAT vivent sur le serveur, et la file
  // d'écriture garde son miroir dans localStorage, auquel on ne touche pas non
  // plus.
  if ('serviceWorker' in navigator) {
    const b = document.createElement('button');
    b.className = 'btn primaire';
    b.textContent = 'Repartir d\'une copie propre';
    b.onclick = async () => {
      b.disabled = true;
      b.textContent = 'Nettoyage…';
      try {
        for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
        for (const k of await caches.keys()) await caches.delete(k);
      } catch { /* on recharge quand même : c'est déjà mieux que rien */ }
      // `location.replace` et non `reload` : un rechargement peut être servi
      // depuis le cache mémoire de l'onglet, une navigation neuve non.
      location.replace(location.pathname + '?neuf=' + Date.now());
    };
    box.appendChild(b);
  }

  document.getElementById('screens')?.replaceChildren(box);
  });
}
