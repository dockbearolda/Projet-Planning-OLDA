// ===========================================================================
// Service worker — la coquille de l'application, disponible hors ligne
// ===========================================================================
// Ce que ce fichier apporte, et rien de plus : l'atelier ouvre le planning en
// une fraction de seconde même sur un Wi-Fi capricieux, et Chrome accepte enfin
// d'INSTALLER l'application sur la tablette (un manifeste seul ne suffit pas :
// il faut un service worker qui réponde aux requêtes).
//
// RÈGLE ABSOLUE : LE RÉSEAU GAGNE TOUJOURS.
// L'application n'a aucune étape de build — un déploiement remplace les
// fichiers en place. Un cache qui servirait d'abord sa copie rejouerait
// exactement l'incident du 28/07 : un poste gardait l'ancien JS et la grille
// paraissait vide. On ne sert donc le cache que lorsque le réseau a ÉCHOUÉ, et
// on remplace la copie à chaque réponse fraîche.
//
// Ce qui n'est JAMAIS mis en cache :
//   - tout /api/ (données vivantes, et /api/stream est un flux qui ne se ferme
//     pas — le mettre en cache bloquerait le temps réel) ;
//   - tout ce qui n'est pas un GET ;
//   - toute réponse qui n'est pas un 200 de notre propre origine (la prod est
//     derrière un Basic Auth : mémoriser un 401 condamnerait le poste).

// LE NOM NE CHANGE PAS QUAND ON AJOUTE UN FICHIER À LA COQUILLE. `activate`
// supprime tout cache portant un autre nom : renommer alors qu'un poste est
// hors ligne effacerait la coquille complète pour la remplacer par une coquille
// vide (l'installation ne peut rien télécharger), et l'application ne s'ouvrirait
// plus du tout. En gardant le nom, l'installation se contente d'AJOUTER le
// fichier manquant quand le réseau est là, et ne casse rien quand il ne l'est pas.
const CACHE = 'olda-coquille-v2';

// La coquille : ce qu'il faut pour AFFICHER l'application. Les données, elles,
// viennent du réseau — hors ligne, on montre l'écran et son message d'erreur,
// jamais un planning inventé.
//
// TOUT ce que l'écran peut demander doit y figurer. Il y manquait les trois
// modules chargés à la demande (Nouveau Projet, Base clients, Réglages) et les
// deux écrans du comptoir : hors ligne, l'application s'ouvrait bien… mais ces
// onglets-là étaient morts — dont Nouveau Projet, la seule porte d'entrée.
const COQUILLE = [
  '/',
  '/index.html',
  '/styles.css',
  '/clients.css',
  '/projet.css',
  '/app.js',
  '/dashboard.js',
  '/guide.js',
  '/priority.js',
  '/whatsapp.js',
  // Importé statiquement par app.js (glisser un document vers WhatsApp) : absent
  // du cache, l'import échoue hors ligne et le planning ne s'ouvre plus.
  '/documents.js',
  '/nom-client.js',
  '/confirmer.js',
  // Importé par app.js, clients.js ET reglages.js : absent du cache, l'import
  // échoue hors ligne et c'est l'application ENTIÈRE qui ne s'ouvre plus.
  '/reseau.js',
  // Le ticket du client, importé statiquement par app.js — même règle : absent
  // du cache, l'import échoue et le planning ne s'ouvre plus hors ligne.
  '/ticket.js',
  // Chargés à la demande depuis app.js (import dynamique) : le réseau peut être
  // tombé entre l'ouverture de l'application et le tap sur l'onglet.
  '/nouveau-projet.js',
  '/clients.js',
  '/reglages.js',
  // Les deux parcours du comptoir, affichés dans un cadre par Nouveau Projet.
  '/comptoir/vente-directe.html',
  '/comptoir/demande-devis.html',
  '/comptoir/pont.js',
  '/olda-logo.svg',
  // La police d'icônes : sans elle, toute la barre de navigation se réduit à la
  // première lettre de chaque icône.
  '/olda-icones.woff2',
  '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  // `addAll` échoue en bloc si UN fichier manque : on met en cache un par un
  // pour qu'un renommage n'empêche pas l'installation de tout le reste.
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(COQUILLE.map((url) => cache.add(url).catch(() => {})));
    // La nouvelle version prend la main tout de suite : on ne laisse pas un
    // ancien worker servir l'ancienne coquille jusqu'à la fermeture des onglets.
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith((async () => {
    try {
      const reseau = await fetch(req);
      // On ne mémorise qu'une vraie réponse à nous. Un 401 (Basic Auth), une
      // redirection ou une erreur serveur ne doivent jamais être resservis.
      if (reseau && reseau.status === 200 && reseau.type === 'basic') {
        const copie = reseau.clone();
        caches.open(CACHE).then((c) => c.put(req, copie)).catch(() => {});
      }
      return reseau;
    } catch (_) {
      // Réseau tombé : on sert la dernière coquille connue.
      const enCache = await caches.match(req);
      if (enCache) return enCache;
      // Une navigation sans correspondance exacte (un #hash, une sous-route)
      // retombe sur la page d'accueil, qui EST l'application.
      if (req.mode === 'navigate') {
        const accueil = await caches.match('/index.html') || await caches.match('/');
        if (accueil) return accueil;
      }
      return new Response('Hors ligne', { status: 503, statusText: 'Hors ligne' });
    }
  })());
});
