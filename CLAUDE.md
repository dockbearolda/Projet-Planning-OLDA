TABLETTE: oui

# Planning OLDA — règles du dépôt

Complète le `CLAUDE.md` global. Ce qui suit est propre à ce projet.

## Cibles réelles

L'outil tourne toute la journée sur une **Galaxy Tab A9+ 11" (SM-X210)** posée au
comptoir et dans l'atelier — d'où `TABLETTE: oui`. Les deux orientations comptent,
le paysage (≈ 1280 × 800 CSS) étant le mode d'usage principal. Le desktop sert au
patron ; l'iPhone, ponctuellement.

L'atelier est à **Saint-Martin (UTC−4, pas d'heure d'été)** et le conteneur de
production tourne en **UTC** : toute date civile calculée côté serveur passe par
`America/Marigot`, jamais par `new Date()` seul. Dès 20 h locales, un
`toISOString()` naïf date du lendemain.

## Contraintes de l'application

- **Aucun build.** HTML + CSS + JS en modules ES natifs, servis tels quels. Les
  fichiers gardent le même nom d'un déploiement à l'autre : c'est pour ça que le
  statique part en `Cache-Control: no-cache` et que le service worker ne sert son
  cache **qu'en repli**, jamais en premier.
- **Rien qui vienne d'un autre domaine.** Polices, icônes, scripts : tout est
  hébergé ici. Un poste doit s'ouvrir sans dépendre d'un tiers joignable.
- **Les deux écrans du comptoir** (`public/comptoir/*.html`) sont ceux du patron
  et tournent **tels quels**. Une nouvelle version se pose en **remplaçant le
  fichier** — on ne retranscrit pas le parcours. Tout ce qui doit s'y greffer
  (base clients, numéro du jour, envoi au planning) vit dans `comptoir/pont.js`.
- **Charte unique** (depuis le 29/07) : gris `#f5f6f8`, encre `#111827`, Arial.
  La couleur dit un **état**, jamais une décoration.

## Base de données

- Migrations **réversibles**, jouées au démarrage dans `db.js` (`init`), chacune
  avec sa **propre garde `app_meta`** — deux incidents réels sont venus d'une
  garde partagée.
- La base locale de test est **pg-mem** (aucune installation) : elle n'implémente
  que peu de fonctions natives. Celles dont le code se sert sont enregistrées à
  la main dans `db.js`. Un index sur **expression** n'y existe pas : on le crée
  dans `init()` derrière un `try`, pas dans `schema.sql`.

## Ce qui se teste toujours

- `npm test` doit être vert avant tout commit.
- Deux postes qui écrivent **en même temps** (numéros de ticket, codes clients,
  compteurs) : c'est là que vivent les bugs, pas dans le cas nominal.
- Le **tactile** : un geste au doigt n'est pas un clic. Scroll sur une carte,
  deuxième doigt posé à côté, `pointercancel` au milieu d'un glisser.
- Le **réseau qui tombe** au mauvais moment : une réponse avalée ne doit jamais
  faire perdre un dossier, ni en créer deux.

## Déploiement

Rien ne part sur Railway — ni code, ni migration, ni import — **tant que le
patron n'a pas validé lui-même en local**. Le service `web` est branché sur
`main` : un push déclenche le déploiement. Vérifier le hash servi via
`railway status --json` (`meta.commitHash`) : la prod est derrière un Basic Auth,
un `curl` ne prouve rien.
