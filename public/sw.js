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
const CACHE = 'olda-coquille-v4';

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
  // Les jetons de la charte : sans eux, hors ligne, l'application s'ouvre sans
  // une seule couleur — tout est en var() non résolue.
  '/charte.css',
  '/styles.css',
  '/clients.css',
  '/projet.css',
  '/app.js',
  '/dashboard.js',
  '/priority.js',
  '/whatsapp.js',
  '/nom-client.js',
  '/confirmer.js',
  // La bulle « mise à jour disponible », importée statiquement par app.js :
  // absente du cache, son import échoue hors ligne et le planning ne s'ouvre
  // plus du tout — la même règle que reseau.js et ticket.js juste dessous.
  '/maj.js',
  // Importé par app.js, clients.js ET reglages.js : absent du cache, l'import
  // échoue hors ligne et c'est l'application ENTIÈRE qui ne s'ouvre plus.
  '/reseau.js',
  // Importé statiquement par app.js : absent du cache, l'import échoue hors
  // ligne et le planning ne s'ouvre plus.
  '/poste.js',
  // Le piège à focus des fenêtres modales, importé par clients.js, dashboard.js
  // ET l'écran de la demande — même règle : absent du cache, l'import échoue et
  // l'écran concerné ne s'ouvre plus hors ligne.
  '/modale.js',
  // Le ticket de l'atelier, importé statiquement par app.js — même règle : absent
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
  // Le catalogue textile, chargé par une balise <script> de l'écran de devis :
  // absent de la coquille, hors ligne `window.TextileEngine` n'existe pas et
  // tout le chiffrage textile tombe — sans la moindre erreur à l'écran.
  '/comptoir/textile-catalog.js',
  // Le module PDF. Il venait de cdnjs (avec jsdelivr et unpkg en secours) :
  // hors ligne, « Télécharger le PDF » ne pouvait par construction pas
  // fonctionner. Il n'est chargé qu'au clic sur le bouton — la coquille est
  // justement ce qui rend ce chargement-là possible sans réseau.
  '/jspdf.umd.min.js',
  '/olda-logo.svg',
  // La police d'icônes : sans elle, toute la barre de navigation se réduit à la
  // première lettre de chaque icône.
  '/olda-icones.woff2',
  // La police de texte. Absente, tout retombe sur Arial : lisible, mais le
  // poste n'a plus la même tête d'une ouverture à l'autre.
  '/manrope-latin-variable.woff2',
  '/plus-jakarta-sans-latin-variable.woff2',
  '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  // `addAll` échoue en bloc si UN fichier manque : on met en cache un par un
  // pour qu'un renommage n'empêche pas l'installation de tout le reste.
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const resultats = await Promise.all(
      COQUILLE.map((url) => cache.add(url).then(() => null, () => url)),
    );
    // Un trou dans la coquille ne se voit que le jour où le poste est hors
    // ligne — c'est-à-dire au pire moment. On le dit au moins dans la console.
    const manquants = resultats.filter(Boolean);
    if (manquants.length) {
      console.warn(`Coquille hors ligne incomplète — ${manquants.length} fichier(s) non mis de côté :`, manquants.join(', '));
    }
    // La nouvelle version prend la main tout de suite : on ne laisse pas un
    // ancien worker servir l'ancienne coquille jusqu'à la fermeture des onglets.
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    // Ménage des entrées HORS coquille accumulées par les versions qui
    // mémorisaient toute réponse 200 : elles ne seront plus jamais resservies
    // ni rafraîchies, autant rendre la place.
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) {
      const chemin = new URL(req.url).pathname;
      if (!COQUILLE.includes(chemin)) await cache.delete(req);
    }
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
      // On ne mémorise qu'une vraie réponse à nous — ET seulement un fichier de
      // la coquille. Sans cette liste, TOUTE réponse 200 de l'origine entrait
      // dans un cache qui ne se purge jamais (le nom ne change pas, voir plus
      // haut) : sur une tablette jamais réinstallée, il dérivait vers le quota,
      // après quoi chaque écriture échouait en silence — la coquille cessait de
      // se rafraîchir sans que rien ne le signale.
      if (reseau && reseau.status === 200 && reseau.type === 'basic'
          && COQUILLE.includes(url.pathname)) {
        const copie = reseau.clone();
        // ON RANGE SOUS LE CHEMIN, SANS SA QUERY. Les deux écrans du comptoir
        // sont ouverts avec le thème de l'hôte dans leur adresse
        // (`?theme=dark`) : rangés sous l'adresse complète, on aurait DEUX
        // copies du même fichier — et aucune des deux ne répondrait à l'autre
        // thème le jour où le poste est hors ligne. Le ménage de `activate`
        // compare lui aussi des chemins nus.
        // `waitUntil` : sans lui, Chrome peut endormir le worker dès la réponse
        // rendue et abandonner l'écriture — la copie de secours restait vieille.
        e.waitUntil(caches.open(CACHE).then((c) => c.put(url.pathname, copie)).catch(() => {}));
      }
      // Le proxy devant la prod peut répondre 502/503 SANS que `fetch` ne lève :
      // sur une navigation, on préfère la dernière coquille connue à sa page
      // d'erreur — l'application, elle, sait dire « hors ligne » proprement.
      if (req.mode === 'navigate' && reseau && reseau.status >= 500) {
        const secours = await caches.match('/index.html') || await caches.match('/');
        if (secours) return secours;
      }
      return reseau;
    } catch (_) {
      // Réseau tombé : on sert la dernière coquille connue.
      // `ignoreSearch` : un parcours du comptoir est demandé avec le thème dans
      // son adresse, la coquille le connaît sous son chemin nu.
      const enCache = await caches.match(req, { ignoreSearch: true });
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
