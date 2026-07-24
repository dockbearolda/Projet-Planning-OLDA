# Cockpit de gestion des demandes — Atelier OLDA

Outil web interne mono-service pour piloter le flux des demandes clients d'un
atelier de personnalisation textile (DTF, pressage, laser, UV, sous-traitance).
Vue « Google Sheets amélioré » : une grille éditable au centre, une sidebar
verticale à gauche qui matérialise le pipeline.

Pile technique : **Node.js + Express** (un seul service qui sert aussi le
frontend), **PostgreSQL** via `pg`, **frontend vanilla** (HTML + CSS + JS, ES
modules natifs, aucun build, aucun framework, aucun bundler).

## Fonctionnalités

- Sidebar pipeline : **8 familles** (grandes étapes), compteurs live.
  « 1 projet = 1 seule place. » **Fiverr** et **À commander**, les deux listes
  qu'on ouvre le plus souvent, ont quitté le rail pour un **onglet** de la barre
  du haut — sans quitter le pipeline (flux, compteurs, puces inchangés).
- **Pastille WhatsApp** sur toute ligne dont le client a laissé un numéro : un
  clic ouvre la conversation avec le message « votre commande est prête » déjà
  écrit. Rien ne part tout seul, c'est l'employé qui appuie sur Envoyer. Le
  texte se règle dans l'onglet **Réglages** (jetons `{client}`, `{commande}`,
  `{date}`) ; le numéro est mis au format international selon son préfixe
  (0690/0691 → +590, 0696/0697 → +596, 0694 → +594, 0692/0693 → +262, sinon +33).
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
| GET | `/api/commande/catalog` | Catalogue Prise de commande (natures, familles, délais, vêtements, tailles, tasses, objets, typos, zones, techniques, options de tasse, statuts et modes de paiement) **+ `pipeline`** : familles et sous-étapes, pour le choix de la destination. |
| POST | `/api/commande` | Enregistre une prise de commande atelier → crée la ligne dans le planning, à la destination demandée (`stage` + `subStage`). |
| GET | `/api/settings/whatsapp` | `{ message }` — le texte « commande prête » réglé par le patron. |
| PUT | `/api/settings/whatsapp` | Remplace ce texte (`{ message }`, 1000 caractères max), diffusé en SSE. |
| POST | `/api/commande/zones` | Ajoute un emplacement d'impression (`{ label }`) et renvoie la liste complète. |
| DELETE | `/api/commande/zones/:id` | Retire un emplacement ajouté au comptoir (ceux du catalogue sont figés). |
| GET | `/api/clients` | Annuaire client déduit des commandes déjà saisies (auto-complétion). |

Validation serveur : `stage` ∈ familles (+ `fiverr`) ; `sub_stage` ∈ sous-étapes
connues ou null ; `responsable` ∈ liste connue ou null ; `priority` ∈ {1,2,3} ;
`client_type` ∈ {pro, perso, asso, revendeur} ; `flag` ∈ {bloque, a_voir} ou
null ; `flag_reason` tronqué à 240 caractères. Erreurs renvoyées en JSON avec
code HTTP adapté.

**Règle du motif** : lever l'alerte (`flag: null`) efface `flag_reason`, même si
l'appelant ne l'envoie pas — jamais de motif orphelin sur une commande débloquée.

## Prise de commande — `/#demande` et `/#commande`

Le **premier pas du client** : la fiche qu'on remplit au comptoir, EN FACE DE
LUI. La contrainte de conception est un chrono — **30 à 45 secondes**, client
debout devant le comptoir. Tout en découle : des puces de 44 px qu'on tape au
lieu de menus qu'on déroule, des valeurs par défaut déjà justes, et rien à
l'écran tant qu'on n'en a pas besoin. Aucun prix (le chiffrage est une étape du
planning).

Deux entrées **en tête du menu**, l'une pour une *Demande* (à chiffrer), l'autre
pour une *Commande* (déjà validée par le client). Elles ouvrent la **même fiche**
— la nature est décidée par le lien cliqué, pas par un réglage dans l'écran.

La nature est conservée dans `requests.order_kind` et rappelée par un badge sur
la ligne du planning. La fiche se lit dans l'ordre où ça se dit.

### La dernière question : où l'enregistrer ?

« Enregistrer » n'envoie rien tout seul : il **demande d'abord où la fiche
atterrit**, à chaque saisie. Tout le pipeline s'affiche (familles + sous-étapes,
Fiverr compris) ; la destination habituelle de la nature choisie — Demande →
*Demande*, Commande → *Commande · À chiffrer* — est marquée **habituel** et
placée en tête. **Taper une destination enregistre aussitôt** : un seul geste,
comme le reste de la fiche, mais un geste conscient. L'écran de confirmation
redit où la commande est partie.

Le serveur revalide : une sous-étape étrangère à la famille visée est refusée
(400) plutôt que rangée n'importe où. Un corps sans destination retombe sur
celle du catalogue — les appels existants continuent de marcher.

### La page ne défile pas

Deux zones, pas deux colonnes :

- **en haut, un bandeau** qui se lit de gauche à droite — qui, quoi, pour quand,
  payé comment. Ses champs sont courts : trois rangées suffisent ;
- **en bas, les produits, sur toute la largeur**, parce que leurs lignes ont six
  colonnes à aligner. C'est la **seule zone qui défile**.

On empile donc autant de produits qu'on veut sans jamais perdre de vue le nom du
client, l'échéance ni le bouton d'enregistrement. Sous 900 px (tablette
portrait, téléphone) le bandeau s'empile et la page redevient défilante, comme
n'importe quel formulaire mobile.

Une ligne de produit = **une rangée de champs**, sans aucun libellé : la rangée
d'en-tête nomme les colonnes une fois pour toute la famille, comme dans un
tableur. Le bouton d'ajout vit dans le bandeau de la famille plutôt qu'en pied
de tableau : une rangée gagnée par famille. Un **emplacement d'impression
choisi perd sa puce et prend sa ligne** (son étiquette, puis sa consigne), et
le « ＋ » qui en ajoute un second se loge en bout de la dernière consigne —
rien n'occupe de la hauteur tant qu'on ne l'a pas demandé.

Repère : sur un Galaxy Tab A9+ en paysage (1280×800), **une tasse et un textile
entièrement remplis tiennent sans défiler du tout**.

Quand le panneau devient trop étroit pour aligner six colonnes (**requête de
conteneur**, pas de média : le seuil porte sur la largeur du panneau, pas de la
fenêtre), la ligne se replie et les placeholders reprennent le relais. D'où leur
formulation : « anse à droite : logo… » redit la convention au lieu de donner un
simple exemple.

### 1 — Contact : PRO ou PERSO

Deux jeux de champs **exclusifs**, pour ne jamais demander un « prénom » à un
hôtel ni une « société » à un particulier :

| PRO | PERSO |
|---|---|
| Nom de facturation · Contact · WhatsApp · Email | Prénom · Nom · WhatsApp |

Le nom qui fait foi partout ailleurs (colonne « Client » du planning, base
clients) est le **nom de facturation** pour un pro, **« Prénom Nom »** pour un
particulier. La nature suit le client dans sa fiche (`clients.client_type`).

**Auto-complétion** : taper « Igua » propose « Iguana (Discover) » avec son
contact et son numéro ; l'annuaire ne propose que des pros en mode pro, que des
particuliers en mode perso. Rapprochement insensible à la casse, aux accents et
à la ponctuation. La reprise ne remplit que les champs restés vides, puis pose
le curseur sur l'objet — le client identifié, la suite c'est ce qu'il vient
chercher. Un client absent est **créé automatiquement** à l'enregistrement.

### 2 — La demande

**Objet** (le titre du dossier), **description** libre facultative, et le
**délai d'un seul tap** : *Sous 3 jours (+10 %)* · *5 jours* · *10 jours* ·
*15 jours*, plus un champ date pour viser un jour précis. Par défaut **5 jours**,
jamais « sans échéance ». La majoration du délai express voyage dans la fiche,
donc le chiffrage la voit.

À ce stade la fiche est déjà enregistrable : c'est la **demande simple**, celle
qui suffit quand le client est pressé (« Devis 40 polos brodés, il repasse
mardi »). Les produits ne sont détaillés que si on les détaille.

### 3 — Produits : trois familles, dépliées à la demande

| Famille | Ce qu'on saisit |
|---|---|
| **Tasses** | Qté · référence · coloris · **Face 1 (anse à droite)** et **Face 2 (anse à gauche)** · options (*Logo OLDA*, *Texte personnalisé*, *Logo client*) · infos de personnalisation · typo · remarques |
| **Textile** | Qté · vêtement · réf. OLDA ou fournisseur · coloris · taille · **placements** (Cœur, Dos, Avant, Manche Dr, Manche Ga, Poitrine — les six sur une rangée, les autres derrière « ＋ 6 ») avec la **consigne libre** de chacun |
| **Objets** | Qté · réf. objet · **TROTEC / UV / Autres** · info sur la personnalisation |

Les puces de placement portent un libellé **court** (« Manche Dr ») pour tenir
sur une seule rangée ; la fiche, elle, garde le nom entier (« Manche droite »).
La convention d'anse des tasses est **dans l'en-tête de colonne et dans le
placeholder** : c'est elle qui évite d'imprimer le visuel du mauvais côté. Une
fiche peut mêler les trois
familles ; le total de pièces les additionne. « Dupliquer » reprend la ligne ET
son marquage : la même impression sur une autre taille, en un tap. Une ligne
qu'on n'a pas remplie part en silence à l'enregistrement — un tap de trop sur
« Ajouter » ne réclame rien. La technique d'impression du textile est une
décision de production, pas de la prise : on ne la demande pas ici.

### 4 — Paiement

Sur la rangée du bas du bandeau, à côté de l'échéance :
**Non payé / Acompte payé / Payé**, puis le **mode** (CB / Espèces) — qui
n'apparaît qu'une fois quelque chose à encaisser, et qui s'efface si on
repasse à « non payé » (jamais de « CB » trompeur sur une commande impayée).
Sur la même ligne, les deux réflexes d'atelier : *Article en boîte*,
*Maquette à faire*.

Le détail structuré est conservé dans `requests.fiche` (jsonb, discriminant
`kind: 'commande-atelier'`, `version: 2`) ; `requests.description` en porte le
résumé lisible — contact, objet, chaque famille, délai, paiement — donc la
grille n'a jamais besoin de lire ce JSON. Le catalogue vit dans `catalog.json`,
section `commande` — seul endroit à modifier pour ajouter un vêtement, une
taille, un délai ou une option de tasse.

## Navigation — une seule page, plusieurs vues

Planning, Dashboard, Prise de commande, Base clients et Réglages sont **des vues
d'un même document**, pas des pages. Passer de l'une à l'autre ne recharge
rien : ni requête, ni réaffichage, ni saisie perdue. Une commande à moitié
remplie survit à un aller-retour vers le planning.

Le **hash de l'URL est l'unique pilote** : `#planning`, `#dashboard`, `#demande`,
`#commande`, `#clients`, `#reglages`, plus `#fiverr` et `#a-commander`. La
navigation, dans la barre du haut, n'est faite que de liens — cliquer change le
hash, le hash change la vue. Chaque écran est donc partageable par son URL et le
bouton « Retour » du navigateur fonctionne.
`#demande` et `#commande` ouvrent la même vue de saisie, seule la nature diffère
(poussée au module par `setNature`) — d'où deux liens distincts en tête du menu.

`#fiverr` et `#a-commander` restent des vues de **planning** : même grille, même
en-tête, seule la catégorie est imposée et le rail s'efface (l'onglet le
remplace). Revenir sur `#planning` depuis l'une d'elles repart du début du
pipeline, pour ne jamais laisser une grille sans entrée allumée en face. Ces
deux catégories ne quittent PAS le modèle : `FLOW`, les compteurs, la puce de
sous-étape et les commandes déjà posées sont inchangés — seul l'affichage du
rail les saute (`PROMOTED` dans `app.js`).

Le bouton « Nouvelle commande » de la barre du haut ne crée une ligne que dans
la grille : il est donc masqué hors du Planning, où son résultat serait
invisible.

`/fiche` redirige (301) vers `/#commande` : les raccourcis déjà posés sur les
écrans de l'atelier continuent de marcher.

Le module de la Prise de commande (`commande.js`, catalogue produits + annuaire
client) n'est chargé qu'au **premier** passage sur la vue : le planning ne paie
rien tant qu'on ne prend pas de commande. Sa feuille de style est entièrement
scopée sous `#commande`, pour qu'aucune règle ne puisse fuir sur les autres
vues.

### Le catalogue vit dans `catalog.json`

C'est le SEUL endroit à modifier pour ajouter un vêtement, une taille, une
référence de tasse, un délai, une option de tasse ou une technique. Les
**emplacements d'impression**, eux, se
complètent aussi depuis la fiche (« + Emplacement ») : la zone créée est
stockée en base (`app_meta.commande_zones`) et rejoint la liste de tous les
postes, sans redéploiement. Les zones du catalogue restent figées ; seules
celles ajoutées au comptoir se retirent.

Le détail structuré est conservé dans `requests.fiche` (jsonb) ;
`requests.description` en porte en parallèle un résumé lisible, donc la grille
n'a jamais besoin de lire ce JSON.

## Réglages — `/#reglages`

Ce que le patron règle **une fois pour tous les postes**. Aujourd'hui : le
**message WhatsApp « commande prête »**.

Sur le planning, toute ligne dont le client a laissé un numéro porte une
**pastille WhatsApp** verte, toujours visible (la tablette de l'atelier n'a pas
de survol) et taillée pour le doigt (44 px de zone tactile). Un clic ouvre la
conversation — application sur la tablette, WhatsApp Web sur le PC — avec le
message **déjà écrit**. **Rien ne part tout seul** : l'employé relit et appuie
sur Envoyer lui-même.

Le texte s'écrit dans cet onglet, avec trois jetons remplis à l'ouverture —
`{client}` (nom du dossier), `{commande}` (description), `{date}` (date
souhaitée) — et un aperçu de ce que le client lira. Il est stocké en base
(`app_meta.whatsapp_message`) et diffusé en SSE : les autres postes utilisent le
nouveau texte sans recharger. Un message **vidé** est un choix (on écrira à la
main), pas un oubli : il le reste.

Le numéro est mis au format international par `public/whatsapp.js` — l'atelier
est à Saint-Martin, on y croise autant de `0690` que de `06` métropole, donc
l'indicatif se déduit du préfixe (`0690`/`0691` → +590, `0696`/`0697` → +596,
`0694` → +594, `0692`/`0693` → +262, sinon +33). Un numéro déjà international
(`+590…`, `00590…`) passe tel quel ; un numéro illisible **n'affiche pas de
pastille** du tout, plutôt que d'ouvrir une conversation avec un inconnu.

## Structure

```
.
├── package.json      scripts: start = "node server.js"
├── server.js         Express, routes API, statique, Basic Auth
├── db.js             pool pg, init schéma + seed au démarrage
├── schema.sql        CREATE TABLE IF NOT EXISTS requests ...
├── catalog.json      catalogue Prise de commande (source unique)
├── public/
│   ├── index.html    coquille + les vues (planning, dashboard, commande, clients, réglages)
│   ├── styles.css    design system
│   ├── app.js        fetch, rendu grille, édition inline, étoiles, drag & drop
│   ├── whatsapp.js   numéro au format international + message rempli (règles pures)
│   ├── commande.css  vue Prise de commande, scopée sous #commande
│   ├── commande.js   état, articles, zones, annuaire client, destination, envoi
│   ├── clients.css   vue Base clients, scopée sous #clients
│   ├── clients.js    liste, fiche éditable, notes
│   └── reglages.js   vue Réglages (message WhatsApp « commande prête »)
├── .env.example
└── README.md
```

## Modèle de données — table `requests`

`id` (uuid), `stage` (slug de la FAMILLE, 8 valeurs + `fiverr`), `sub_stage`
(slug de la SOUS-FAMILLE ou null), `order_kind` (nature posée à la prise :
`demande` / `commande` / null pour une ligne créée à la main), `responsable`
(Loïc / Mélina / Charlie / Opérateur / À attribuer), `priority` (1–3), `client_type`
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
