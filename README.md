# Cockpit de gestion des demandes — Atelier OLDA

Outil web interne mono-service pour piloter le flux des demandes clients d'un
atelier de personnalisation textile (DTF, pressage, laser, UV, sous-traitance).
Vue « Google Sheets amélioré » : une grille éditable au centre, une sidebar
verticale à gauche qui matérialise le pipeline.

Pile technique : **Node.js + Express** (un seul service qui sert aussi le
frontend), **PostgreSQL** via `pg`, **frontend vanilla** (HTML + CSS + JS, ES
modules natifs, aucun build, aucun framework, aucun bundler).

## Fonctionnalités

- Sidebar pipeline : **8 familles** (grandes étapes) + Fiverr épinglé, compteurs
  live. « 1 projet = 1 seule place. »
- **Sous-étape** en puce inline (précise l'action en cours), affichée uniquement
  pour les familles qui en ont (Chiffrage, Préparation, Production, Facturation,
  Terminé). Changer de famille en glissant remet la sous-étape à zéro.
- **Espace Responsable** sur chaque ligne : le PILOTE et le RÉFÉRENT du projet.
  Les deux affichent le nom EFFECTIF — celui posé à la main, sinon le nom « de
  base » de la catégorie (puce en pointillés). N'importe quel collaborateur peut
  en changer à tout moment, ou revenir au nom de base via « Par défaut ».
- **Colonne État** : l'alerte que n'importe qui pose sur une commande —
  **BLOQUÉE** (avec un **motif** libre : pourquoi ça n'avance plus) ou
  **À VOIR**. La ligne entière se teinte et porte un liseré, le motif est
  cherchable, et le Point du jour compte les bloquées.
- **Bouton « étape suivante »** (colonne `→`) : un clic pousse la commande à la
  position suivante du flux — sous-étape suivante, ou 1re sous-étape de la
  famille d'après. Rien à afficher en bout de flux (Archivé) ni hors flux (Fiverr).
- Grille type tableur, poignée de glisser, en-tête collant.
- Édition inline avec persistance optimiste (PATCH immédiat, rollback si échec).
- Priorité par étoiles (1–3), type client pro / perso / asso / revendeur.
- « Jours restant » calculé et coloré (vert > 7 j, orange 1–7 j, rouge ≤ 0 j).
- Glisser-déposer d'une ligne sur une étape de la sidebar → change le `stage`,
  compteurs mis à jour sans rechargement. Réordonnancement vertical (position).
  Fonctionne à la souris **et au doigt** (Pointer Events, compatible tablette).
- **Temps réel façon Google Sheets** : push instantané via SSE (Server-Sent
  Events). Dès qu'une personne crée/modifie/déplace une demande, tous les écrans
  connectés se mettent à jour en ~150 ms, sans rechargement. Filet de sécurité
  par polling si le flux est coupé ; reconnexion automatique.
- **Optimisé tactile** pour Chrome et la tablette Samsung Galaxy Tab A9+ 11" :
  cibles de toucher agrandies, contrôles toujours visibles, scroll fluide,
  saisie sans zoom intempestif, mises en page adaptées paysage/portrait.
- Tri par défaut (priorité desc, échéance asc) + tri par en-têtes cliquables.
- Création / suppression de demandes.
- Accès protégé par mot de passe partagé (Basic Auth).

## Dashboard « Point du jour »

Onglet lu chaque matin au point d'équipe (et affiché sur la tablette murale de
l'atelier). C'est une **projection temps réel du planning** : aucune donnée
propre, tout vient de `/api/requests` + `/api/category-owners`, et toute action
(envoi de catégorie, « Marquer traité », étoiles) écrit via la même API — le SSE
resynchronise Planning et Dashboard.

Composants (`public/dashboard.js`, styles scopés `.pj-*` / `.dd-*` / `.wall`) :
header sticky avec 5 KPI cliquables dont « Bloquées » (filtre par estompage), vue Équipe en
4 colonnes / vue perso (« Je suis »), panneau détail avec « Envoyer vers »,
fil d'activité « Ce qui a bougé », mode Écran mural (rotation A/B 20 s).

### Routage catégorie → pilote

Le **pilote effectif** d'une commande est calculé ainsi :

1. `responsable` posé à la main sur la ligne (un vrai employé) → **prioritaire,
   jamais écrasé** ;
2. sinon le propriétaire de sa **sous-étape** dans la config « Attribution des
   catégories » (`app_meta.category_owners`) ;
3. sinon le propriétaire de sa **famille** ;
4. sinon « À attribuer ».

« Envoyer vers » ne PATCH que `stage`/`sub_stage` : le pilote suit tout seul
l'attribution (la commande change de colonne), sauf pilote manuel qui reste.
Une commande **« Sans date » créée depuis ≥ 7 jours** devient « À planifier »
(badge orange, remonte dans le tri, jamais comptée en retard).

Une commande **BLOQUÉE / À VOIR** porte son bandeau d'alerte (motif compris) sur
sa carte, et l'alerte se **lève d'un tap** depuis le panneau détail : c'est la
manœuvre du point du matin. La poser (avec motif) se fait depuis le Planning.

## Démarrage local

Prérequis : Node 18+. **Aucune installation de PostgreSQL n'est nécessaire pour
tester.**

```bash
npm install
npm start
```

Puis ouvre http://localhost:3000.

Sans variable `DATABASE_URL`, l'application démarre sur une **base en mémoire**
(via `pg-mem`, en devDependency) avec des demandes d'exemple déjà chargées. C'est
idéal pour tester l'interface immédiatement. Les données sont réinitialisées à
chaque redémarrage. L'accès est ouvert tant que `APP_PASSWORD` n'est pas défini.

Pour tester contre un vrai PostgreSQL local, définis simplement `DATABASE_URL` :

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres npm start
```

> Base jetable via Docker :
> `docker run --name olda-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres`

## Déploiement Railway

1. **Initialise le projet** puis ajoute le plugin PostgreSQL (il fournit
   automatiquement la variable `DATABASE_URL`) :

   ```bash
   railway init
   railway add            # choisis PostgreSQL
   ```

2. **Variables d'environnement** du service :
   - `APP_PASSWORD` — le mot de passe d'accès partagé.
   - `PORT` — géré automatiquement par Railway (ne pas définir à la main).
   - `DATABASE_URL` — fournie par le plugin PostgreSQL.

   ```bash
   railway variables set APP_PASSWORD="un-mot-de-passe-solide"
   ```

3. **Déploiement automatique** : le service `web` est branché sur ce dépôt
   GitHub, branche `main`. Tout merge sur `main` déclenche un build et une mise
   en ligne — rien à lancer à la main.

   Pour forcer un déploiement depuis la machine locale (dépannage, ou pour
   pousser un état non commité) :

   ```bash
   railway up --service web
   ```

4. Le schéma se crée automatiquement au premier démarrage — aucune commande
   manuelle de migration n'est nécessaire.

En production, la connexion `pg` active `ssl: { rejectUnauthorized: false }`, et
le serveur fait confiance au proxy Railway (`trust proxy`). La Basic Auth
s'applique à toutes les routes dès que `APP_PASSWORD` est défini.

## API REST

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/requests?stage=<slug>` | Liste d'une étape (priorité desc, échéance asc). |
| GET | `/api/requests` | Toutes les demandes. |
| GET | `/api/counts` | `{ <slug>: <nombre>, ... }` pour les compteurs. |
| GET | `/api/stages` | Liste ordonnée des étapes (libellé + slug). |
| POST | `/api/requests` | Crée une demande (corps partiel autorisé). |
| PATCH | `/api/requests/:id` | Met à jour un ou plusieurs champs. |
| DELETE | `/api/requests/:id` | Supprime une demande. |
| GET | `/api/fiche/catalog` | Catalogue Commande Express (produits, options, délais, polices, visuels, encres, placements). |
| POST | `/api/fiche` | Enregistre une Commande Express → crée la demande dans le planning. |

Validation serveur : `stage` ∈ familles (+ `fiverr`) ; `sub_stage` ∈ sous-étapes
connues ou null ; `responsable` ∈ liste connue ou null ; `priority` ∈ {1,2,3} ;
`client_type` ∈ {pro, perso, asso, revendeur} ; `flag` ∈ {bloque, a_voir} ou
null ; `flag_reason` tronqué à 240 caractères. Erreurs renvoyées en JSON avec
code HTTP adapté.

**Règle du motif** : lever l'alerte (`flag: null`) efface `flag_reason`, même si
l'appelant ne l'envoie pas — jamais de motif orphelin sur une commande débloquée.

## Commande Express — `/#express`

La prise de commande au comptoir, sur la trame validée par la direction :
menu latéral, en-tête d'action, colonne de synthèse, **aperçu visuel de la
tasse**, panneaux par face, bandeau de pilotage en bas. La commande validée
part dans le planning et apparaît sur tous les écrans ouverts en ~150 ms.

- **Aperçu en direct** : le texte s'affiche dans sa vraie police et sa vraie
  couleur d'encre, le visuel OLDA à sa taille et à sa place, sur un dessin de
  tasse (anse à droite / à gauche, plus une vue de dessous si elle sert).
- **2 faces par défaut + éléments libres** : « Ajouter un élément » pose un
  visuel de plus, sur n'importe quelle face — y compris le dessous.
- **Par élément** : visuel ou texte, police, couleur d'encre, emplacement
  (gauche / centré / droite), taille, remarque atelier. Texte borné à
  60 caractères, avec compteur.
- **Total live**, recalculé à chaque geste sans aller-retour réseau.
- **Reçu imprimable** après validation.

## Navigation — une seule page, trois vues

Planning, Dashboard et Commande Express sont **trois vues d'un même
document**, pas trois pages. Passer de l'une à l'autre ne recharge rien : ni
requête, ni réaffichage, ni saisie perdue. Une commande à moitié remplie
survit à un aller-retour vers le planning.

Le **hash de l'URL est l'unique pilote** : `#planning`, `#dashboard`,
`#express`. La navigation, dans le rail de gauche, n'est faite que de liens —
cliquer change le hash, le hash change la vue. Chaque écran est donc
partageable par son URL et le bouton « Retour » du navigateur fonctionne.

`/fiche` redirige (301) vers `/#express` : les raccourcis déjà posés sur les
écrans de l'atelier continuent de marcher.

Le module de la Commande Express (`express.js`, catalogue + aperçu de la
tasse) n'est chargé qu'au **premier** passage sur la vue : le planning ne paie
rien tant qu'on ne prend pas de commande. Sa feuille de style est entièrement
scopée sous `#express`, pour qu'aucune règle ne puisse fuir sur les deux
autres vues.

### Le barème vit dans `catalog.json`

C'est le SEUL endroit à modifier quand les tarifs changent : prix des tasses,
prix de chaque option, taux de majoration, références de visuels, polices,
encres, placements, tailles. Le front l'affiche, le serveur s'en ressert pour
**recalculer** le total — le montant envoyé par le poste de vente n'est jamais
cru sur parole.

Deux règles de prix que le serveur applique quoi qu'il arrive :

- **Le tarif du logo OLDA est porté par la face**, pas par le choix reçu :
  6 € sur un flanc, 2 € sous la tasse. Réclamer le tarif « dessous » sur une
  face ne change rien.
- **« Date précise » n'a pas de taux propre** : il se déduit de la date
  choisie, avec les mêmes seuils que les délais nommés (jour même → +20 %,
  moins de 3 jours → +10 %, au-delà → 0 %). Sinon « date précise = demain »
  offrirait l'express au tarif standard.

Le détail structuré est conservé dans `requests.fiche` (jsonb) ;
`requests.description` en porte en parallèle un résumé lisible, donc la grille
n'a jamais besoin de lire ce JSON.

## Structure

```
.
├── package.json      scripts: start = "node server.js"
├── server.js         Express, routes API, statique, Basic Auth
├── db.js             pool pg, init schéma + seed au démarrage
├── schema.sql        CREATE TABLE IF NOT EXISTS requests ...
├── catalog.json      barème + catalogue Commande Express (source unique des prix)
├── public/
│   ├── index.html    coquille + les 3 vues (planning, dashboard, express)
│   ├── styles.css    design system
│   ├── app.js        fetch, rendu grille, édition inline, étoiles, drag & drop
│   ├── express.css   vue Commande Express, scopée sous #express
│   └── express.js    état, aperçu tasse, calcul du total, envoi
├── .env.example
└── README.md
```

## Modèle de données — table `requests`

`id` (uuid), `stage` (slug de la FAMILLE, 8 valeurs + `fiverr`), `sub_stage`
(slug de la SOUS-FAMILLE ou null), `responsable` (Loïc / Mélina / Charlie /
Opérateur / À attribuer), `priority` (1–3), `client_type`
(pro/perso/asso/revendeur), `billing_company`, `contact_referent`, `quantity`,
`product`, `project_value` (numeric), `description`, `deadline` (date), `status`
(sous-statut libre, distinct du `stage`), `flag` (`bloque` / `a_voir` / null),
`flag_reason` (motif libre de l'alerte), `position` (tri manuel), `created_at`,
`updated_at`.

Le passage de l'ancien pipeline linéaire (20 étapes) au modèle « familles » se
fait par une migration non destructive au démarrage (`migrateStagesToFamilies`
dans `db.js`), protégée par un flag `app_meta.stage_model = 'families'` pour ne
s'exécuter qu'une fois. Le détail des anciennes étapes est conservé dans
`sub_stage`, ce qui rend la bascule réversible.

`jours_restant` n'est jamais stocké : il est calculé à l'affichage
(`deadline − aujourd'hui`).
