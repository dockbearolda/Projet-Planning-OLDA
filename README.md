# Cockpit de gestion des demandes — Atelier OLDA

Outil web interne mono-service pour piloter le flux des demandes clients d'un
atelier de personnalisation textile (DTF, pressage, laser, UV, sous-traitance).
Vue « Google Sheets amélioré » : une grille éditable au centre, une sidebar
verticale à gauche qui matérialise le pipeline.

Pile technique : **Node.js + Express** (un seul service qui sert aussi le
frontend), **PostgreSQL** via `pg`, **frontend vanilla** (HTML + CSS + JS, ES
modules natifs, aucun build, aucun framework, aucun bundler).

## Fonctionnalités

- **Vente directe** (onglet « Nouveau Projet »), la seule porte d'entrée : le
  comptoir en quatre étapes — **Articles → Client → Paiement → Ticket** — avec
  ticket numéroté à imprimer / télécharger / envoyer sur WhatsApp. Une fois le
  ticket remis, la vendeuse **pose la ligne à l'étape du planning** de son choix
  (sauf si le client repart avec sa commande : la place est alors connue).
- Sidebar pipeline : **5 familles** (Demande & chiffrage, Préparation du projet,
  Production, Facturation & remise au client, Paiement & clôture), compteurs live.
  « 1 projet = 1 seule place. » **Fiverr** et **À commander**, les deux listes
  qu'on ouvre le plus souvent, ont quitté le rail pour un **onglet** de la barre
  du haut — sans quitter le pipeline (flux, compteurs, puces inchangés).
- **Pastille WhatsApp** sur toute ligne dont le client a laissé un numéro : un
  clic ouvre la conversation avec le message « votre commande est prête » déjà
  écrit. Rien ne part tout seul, c'est l'employé qui appuie sur Envoyer. Le
  texte se règle dans l'onglet **Réglages** (jetons `{client}`, `{commande}`,
  `{date}`) ; le numéro est mis au format international selon son préfixe
  (0690/0691 → +590, 0696/0697 → +596, 0694 → +594, 0692/0693 → +262, sinon +33).
- **Sous-étape** en puce inline (précise l'action en cours) : les cinq familles
  en ont toutes. Changer de famille en glissant remet la sous-étape à zéro.
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
| GET | `/api/pipeline` | Familles et leurs sous-étapes (destination d'une commande). |
| POST | `/api/projets` | Enregistre un projet (panier multi-produits) → crée la ligne dans le planning, à la destination demandée (`stage` + `subStage`). Refuse un corps sans délai ni date précise. Champs de vente directe facultatifs : `numero`, `heureSouhaitee` (`HH:MM`), `noteInterne`, `retraitImmediat`. |
| POST | `/api/vente/numero` | Réserve le numéro du ticket de vente directe (`{ jour }` → `{ numero, jour, rang }`). Compteur par journée en `app_meta` : un numéro attribué n'est jamais réutilisé. |
| GET | `/api/settings/whatsapp` | `{ message }` — le texte « commande prête » réglé par le patron. |
| PUT | `/api/settings/whatsapp` | Remplace ce texte (`{ message }`, 1000 caractères max), diffusé en SSE. |
| GET | `/api/clients` | Base clients complète (auto-complétion + fiche). |
| GET | `/api/clients/secteurs` | Liste des secteurs d'activité proposés à la saisie. |
| POST | `/api/clients/secteurs` | Ajoute un secteur (`{ label }`), idempotent sur la casse et les accents. |
| DELETE | `/api/clients/secteurs/:label` | Retire un secteur de la liste proposée (les fiches qui le portent le gardent). |

Validation serveur : `stage` ∈ familles (+ `fiverr`) ; `sub_stage` ∈ sous-étapes
connues ou null ; `responsable` ∈ liste connue ou null ; `priority` ∈ {1,2,3} ;
`client_type` ∈ {pro, perso, asso, revendeur} ; `flag` ∈ {bloque, a_voir} ou
null ; `flag_reason` tronqué à 240 caractères. Erreurs renvoyées en JSON avec
code HTTP adapté.

**Règle du motif** : lever l'alerte (`flag: null`) efface `flag_reason`, même si
l'appelant ne l'envoie pas — jamais de motif orphelin sur une commande débloquée.

## Nouveau Projet — `/#nouveau-projet` : la vente directe

La **seule porte d'entrée** de l'application : toute commande y naît. C'est
l'écran de **vente directe** dessiné par le patron, repris à l'identique —
quatre étapes en face du client, façon caisse : **Articles → Client → Paiement →
Ticket**. La contrainte de conception est un chrono : client debout devant le
comptoir. D'où des cibles de 44 px et des champs à 16 px (en dessous, iOS zoome
sur le champ dès qu'on le touche).

Le DOM des quatre étapes est construit **une fois** puis montré / caché : aller
et venir entre les étapes ne fait rien perdre de ce qui est déjà tapé.

### 1. Articles

Un article = un nom (liste de suggestions, saisie libre), une quantité, un prix
unitaire, le sens de ce prix (**TTC** ou **HT**), la TGCA, et une **description
de production** — ce que l'atelier doit lire pour produire (« Logo cœur, logo dos
30 cm, tailles S x2 / M x5, impression DTF »). Plusieurs articles peuvent
s'empiler dans la même vente, chacun modifiable ou supprimable.

Prix saisi **HT** + TGCA cochée : le prix client est le HT majoré du taux réglé
dans Réglages. TGCA décochée : le prix saisi **est** le prix client, quel que
soit l'intitulé — c'est la règle de la maquette.

La **date** et l'**heure souhaitées** valent pour la vente entière, pas par
article. Le délai porte sa majoration, annoncée sous le champ : jour même (ou
date passée) **+20 %**, moins de trois jours **+10 %**, au-delà rien. Ce sont les
deux raccourcis du catalogue (`jour_j`, `express`) : c'est le **serveur** qui
applique la majoration, l'écran ne fait que l'annoncer — et il l'annonce au
centime près (même arrondi, appliqué au total, une seule fois), sinon le client
paierait un centime de plus que la ligne du planning n'en réclame.

La **note interne OLDA** ne part jamais sur le ticket du client : elle rejoint la
colonne Infos de la ligne du planning.

### 2. Le client — la vraie base

La recherche interroge la **base clients** (nom, société, contact, e-mail,
WhatsApp ou fragment de numéro) ; la création écrit **dedans** (`POST
/api/clients`), pas dans un coin du navigateur : le comptoir et Base clients ne
peuvent pas se contredire. Deux formulaires, comme sur la maquette —
*Particulier* (prénom + nom, WhatsApp, e-mail) ou *Professionnel* (raison
sociale, secteur, contact, coordonnées, adresse).

Trois automatismes évitent la ressaisie :

- **Ville → Code postal + Pays** : une ville connue les remplit ; une valeur
  tapée à la main n'est jamais écrasée.
- **Casse imposée** : prénom en initiales (`Jean-Marc`), nom en majuscules
  (`DUPONT`). Pour un particulier, `entreprise` porte « Prénom NOM » en un seul
  texte — c'est ce nom qui fait foi partout ailleurs, on ne réordonne jamais ses
  mots (le dédoublonnage compare cette chaîne).
- **Numéro WhatsApp** : regroupé par deux à la frappe, laissé tel quel s'il est
  international. **Tout numéro contenant un chiffre est accepté** — une règle de
  format plus fine a déjà bloqué le comptoir devant un client bien réel.

Un client déjà en base avec le même numéro, e-mail ou nom déclenche un
**avertissement**, pas un refus : un second clic crée quand même. Parfois c'est
bien un nouveau client, et le comptoir ne doit jamais rester bloqué.

### 3. Le paiement

Les cinq modes de la maquette, et ce qu'ils veulent dire pour le planning :

| Au comptoir | Statut enregistré | Mode |
|---|---|---|
| Carte bancaire | payé | `cb` |
| Espèces (+ monnaie à rendre) | payé | `especes` |
| Virement | payé | `virement` |
| Mixte (CB + espèces, réparti automatiquement) | payé | `mixte` |
| Paiement au retrait | à encaisser | — |

La case **« le client repart immédiatement avec sa commande »** décide de la
suite : rien à produire ni à faire retirer, la ligne va en *Facturation →
Facturation à faire* et **aucune question n'est posée**. Sinon l'écran du ticket
demandera où poser la ligne (voir plus bas). L'écran annonce cette étape
suivante sous le bouton de validation, pour que personne ne la découvre.

### 4. Le ticket

« Valider le paiement » **enregistre d'abord la commande au planning**
(`POST /api/projets`) et ne passe à l'écran suivant qu'une fois l'enregistrement
confirmé — sans quoi on remettrait au client un ticket dont l'atelier n'a jamais
entendu parler.

Le ticket s'**imprime** (80 mm), se **télécharge** en `.txt`, et part sur
**WhatsApp** avec le message déjà écrit — rien ne s'envoie tout seul, c'est
l'employé qui appuie sur Envoyer.

**Il n'est PAS affiché à l'écran** : il part à l'imprimante, en fichier ou sur
WhatsApp, personne ne le lit sur la tablette. Il reste dans le DOM (c'est lui
qu'imprime le navigateur, classe `.vd-print-only` : masqué à l'écran, rendu en
`@media print`), et l'écran garde ce qui sert à ce moment-là — le numéro, le
paiement avec la monnaie à rendre, le **total encaissé**, et la question du
planning ci-dessous.

### 5. Où poser la ligne dans le planning ?

**Le geste par lequel la vendeuse fait entrer la vente dans l'atelier**, et c'est
pour ça qu'il vient APRÈS le ticket : le client a son ticket en main, la ligne
existe déjà, il reste à dire à quelle étape elle attend.

La carte occupe l'écran du ticket (qui, lui, ne s'affiche pas), filet d'encre à gauche, et
propose **tout le pipeline** (familles + sous-étapes, Fiverr compris, servi par
`/api/pipeline` — une étape ajoutée en base apparaît sans retoucher le front).
*Préparation → Prêt à produire* est proposé en premier, marqué « le plus
courant » : un seul tap dans le cas habituel, rien n'est caché pour autant.

Choisir une étape **déplace la ligne** (`PATCH /api/requests/:id` avec `stage` +
`sub_stage`), puis la carte annonce où elle est posée. La commande étant déjà
enregistrée, une question laissée sans réponse ne perd rien : la ligne reste à la
place par défaut — et « Nouvelle commande » le dit avant de passer à la vente
suivante, plutôt que de laisser filer en silence.

Une seule exception, déjà dite : le client qui repart avec sa commande. Sa place
est connue, la carte se contente de l'annoncer.

### Le numéro de ticket

Format du patron : `26.07.30-001` — année, mois, jour, puis le rang de la vente
**dans la journée**. Le compteur vit côté serveur (`POST /api/vente/numero`, clé
`app_meta`), pas dans le navigateur : deux comptoirs qui encaissent en même temps
ne peuvent pas remettre le même numéro à deux clients. Le jour est celui du
**poste** (le conteneur tourne en UTC, il basculerait au lendemain dès 20 h à
Saint-Martin).

Le numéro est réservé au **premier article ajouté**, pas à l'ouverture de
l'écran : un numéro attribué n'est jamais réutilisé, et ouvrir l'onglet pour rien
ne doit pas faire un trou dans la numérotation. Si le compteur est injoignable,
le poste retombe sur son rang local plutôt que de bloquer la vente.

## Colonnes du planning — le rail de droite

Le bouton **« Colonnes »**, en haut de la grille, ouvre un rail à droite où
chacun compose son écran. Un clic retire une colonne : elle quitte la grille et
descend dans **« Retirées »**, juste en dessous — elle reste **sous les yeux**,
et le même clic la remet. C'est le point important : rien ne disparaît dans un
menu qu'il faudrait rouvrir pour savoir ce qui manque. « Tout réafficher »
remet tout d'un coup.

Trois règles :

- **« Nom du dossier client » est verrouillée** (cadenas). C'est elle qui
  identifie la ligne : sans elle, la grille n'est plus lisible.
- Le choix est **global et local au poste** (`localStorage`, clé
  `olda_cols_v1`) — c'est un réglage de poste, pas un paramètre de navigation :
  il ne suit donc pas d'un ordinateur à l'autre.
- Il se **cumule** avec les masquages automatiques par étape (« Prix TTC »
  hors chiffrage/facturation, « Sous-étape » sur les familles qui n'en ont
  pas). Une colonne cochée mais que l'étape courante ne remplit jamais porte
  la mention **« vide ici »** dans le rail, pour qu'on ne la croie pas cassée.

Le rail se replie (bouton en haut à droite du rail, ou re-clic sur
« Colonnes »), et cet état est retenu. Sous 900 px de large — tablette portrait,
téléphone — il passe **sous** la grille en bandeau horizontal plutôt que de
manger la moitié de la largeur utile.

Le plancher de largeur de la grille suit : chaque colonne retirée le baisse
d'autant (`--cols-off`), sinon le tableau continuerait de défiler
horizontalement alors qu'on vient justement de lui faire de la place.

## Navigation — une seule page, plusieurs vues

Planning, Dashboard, Nouveau Projet, Base clients et Réglages sont **des vues
d'un même document**, pas des pages. Passer de l'une à l'autre ne recharge
rien : ni requête, ni réaffichage, ni saisie perdue. Une commande à moitié
remplie survit à un aller-retour vers le planning.

Le **hash de l'URL est l'unique pilote** : `#planning`, `#dashboard`,
`#nouveau-projet`, `#clients`, `#reglages`, plus `#fiverr` et `#a-commander`. La
navigation, dans la barre du haut, n'est faite que de liens — cliquer change le
hash, le hash change la vue. Chaque écran est donc partageable par son URL et le
bouton « Retour » du navigateur fonctionne.
`#fiverr` et `#a-commander` restent des vues de **planning** : même grille, même
en-tête, seule la catégorie est imposée et le rail s'efface (l'onglet le
remplace). Revenir sur `#planning` depuis l'une d'elles repart du début du
pipeline, pour ne jamais laisser une grille sans entrée allumée en face. Ces
deux catégories ne quittent PAS le modèle : `FLOW`, les compteurs, la puce de
sous-étape et les commandes déjà posées sont inchangés — seul l'affichage du
rail les saute (`PROMOTED` dans `app.js`).

Il n'existe **aucun autre moyen de créer une ligne** que Nouveau Projet : ni
onglet de saisie, ni bouton qui ajoute une ligne vide dans une étape. Une
commande naît avec son client, son prix et sa date butoir, ou elle ne naît pas.

`/fiche` redirige (301) vers `/#nouveau-projet` : les raccourcis déjà posés sur
les écrans de l'atelier continuent de marcher. Les anciens `#demande` et
`#commande` retombent sur le planning, comme tout hash inconnu.

Le module Nouveau Projet (`projet.js`) n'est chargé qu'au **premier** passage
sur la vue : le planning ne paie rien tant qu'on ne prend pas de commande.

### Le catalogue vit dans `catalog.json`

Des listes de référence, rien d'autre. Ce que le **serveur** revalide : la
**nature** d'une ligne (demande à chiffrer / commande validée), les **délais**
raccourcis avec leur majoration, les **modes de paiement**, les **emplacements**
de marquage et les **types de logo**. Ce que **Nouveau Projet** y puise pour
proposer sans imposer : les **vêtements**, la **grille de tailles** et les
**typos** — le comptoir peut toujours taper autre chose.

Le fichier ne contient plus que ce qui a un lecteur : une entrée sans lecteur
n'est pas de la configuration, c'est du décor. C'est le seul endroit à modifier
pour ajuster ces listes, et il n'est lu qu'**au démarrage** : après une
modification, il faut redémarrer le serveur.

Les **secteurs d'activité**, eux, vivent en base
(`app_meta.client_secteurs`) et se complètent depuis Base clients, sans
redéploiement.

Le détail structuré d'un projet est conservé dans `requests.fiche` (jsonb) ;
`requests.description` en porte en parallèle un résumé lisible, donc la grille
n'a jamais besoin de lire ce JSON. Les fiches enregistrées par l'ancienne prise
de commande (supprimée) restent lisibles dans le tiroir de détail.

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

## Charte graphique

**Une seule charte pour toute l'application**, validée par la direction. Toutes
les valeurs vivent dans le `:root` de `public/styles.css` ; le reste du code
n'utilise QUE des jetons (`var(--…)`). Aucune couleur en dur, nulle part.

| Rôle | Jeton | Clair | Sombre |
| --- | --- | --- | --- |
| Fond de page | `--bg` | `#f5f6f8` | `#111827` |
| Surface (carte, ligne) | `--surface` | `#ffffff` | `#1f2937` |
| Texte principal | `--text-1` | `#1f2937` | `#f3f4f6` |
| Texte secondaire | `--text-2` | `#6b7280` | `#9ca3af` |
| Liseré | `--border` | `#d1d5db` | `#374151` |
| Accent (action) | `--primary` | `#111827` | `#f3f4f6` |
| Encre SUR l'accent | `--on-primary` | `#ffffff` | `#111827` |

Trois règles, dans cet ordre :

1. **La couleur ne signale qu'un état.** Rouge `--danger` (problème), vert
   `--success` (fait), ambre `--warning` (attention). Tout le reste est gris —
   une icône décorative colorée laisse croire à un statut.
2. **Un seul accent**, l'encre quasi noire. Jamais de couleur par famille, par
   personne ou par catégorie.
3. **Toujours passer par un jeton.** En particulier `--on-primary` : l'accent
   s'inverse en thème sombre, un `color: #fff` en dur y devient illisible. Même
   chose pour l'encre posée sur un fond sémantique → `var(--surface)`.

Le reste : police `Arial, Helvetica, sans-serif` (police système — plus aucune
webfont de texte à télécharger, seules les icônes Material Symbols restent),
cartes en `--radius-card` (14 px), champs et boutons en `--radius` (9 px), et
trois élévations (`--shadow-1` carte, `--shadow-2` flottant, `--shadow-pop`
modale).

Deux exceptions assumées, toutes deux hors interface :

- `.wall` (écran mural de l'atelier) reprend la **variante sombre** de la charte
  quel que soit le thème de l'app — c'est ce qui le rend lisible à distance.
- Les pastilles de coloris textile (`COLORIS` dans `projet.js`) sont de vraies
  couleurs de vêtement, pas du design.

## Structure

```
.
├── package.json      scripts: start = "node server.js"
├── server.js         Express, routes API, statique, Basic Auth
├── db.js             pool pg, init schéma + seed au démarrage
├── schema.sql        CREATE TABLE IF NOT EXISTS requests ...
├── catalog.json      natures, délais et modes de paiement (source unique)
├── public/
│   ├── index.html    coquille + les vues (planning, dashboard, projet, clients, réglages)
│   ├── styles.css    design system
│   ├── app.js        fetch, rendu grille, édition inline, étoiles, drag & drop
│   ├── whatsapp.js   numéro au format international + message rempli (règles pures)
│   ├── projet.css    vue Vente directe, scopée sous #nouveau-projet (.vd-*)
│   ├── projet.js     vente directe : articles, client, paiement, ticket
│   ├── clients.css   vue Base clients, scopée sous #clients
│   ├── clients.js    liste, fiche éditable, notes, secteurs, villes
│   └── reglages.js   vue Réglages (message WhatsApp « commande prête »)
├── .env.example
└── README.md
```

## Modèle de données — table `requests`

`id` (uuid), `stage` (slug de la FAMILLE, 5 valeurs + `fiverr`), `sub_stage`
(slug de la SOUS-FAMILLE ou null), `order_kind` (nature posée à la prise :
`demande` / `commande` / null pour une ligne ancienne), `responsable`
(Loïc / Mélina / Charlie / Julien / À attribuer), `priority` (1–3), `client_type`
(pro/perso/asso/revendeur), `billing_company`, `contact_referent`, `quantity`,
`product`, `project_value` (numeric — le **TTC**), `description`, `deadline`
(date), `status` (sous-statut libre, distinct du `stage`), `flag`
(`bloque` / `a_voir` / null), `flag_reason` (motif libre de l'alerte),
`position` (tri manuel), `created_at`, `updated_at`.

**Suivi du paiement** : `acompte_demande`, `acompte_verse` et `paye` (booléens à
trois états — `null` = jamais renseigné, et surtout pas « non »),
`acompte_montant` (numeric, la somme exacte encaissée) et `paiement_mode`
(`cb` / `especes` / `virement` / `cheque`).

Deux migrations non destructives se jouent au démarrage, chacune **une seule
fois** sous sa propre garde `app_meta` : le pipeline linéaire (20 étapes) vers
les 8 familles (`migrateStagesToFamilies`, garde `stage_model = 'families'`),
puis les 8 familles vers les **5** familles actuelles
(`migrateFamiliesToFive`, garde `stage_model_v3 = '1'`). Les deux gardes sont
distinctes à dessein : partager la clé ferait rejouer la première à chaque
démarrage, et son `UPDATE … WHERE stage = 'facturation'` écraserait la
sous-étape de toutes les lignes en facturation. La table de correspondance est
documentée dans `db.js` (`V2_TO_V3`) et couverte par
`test/pipeline-migration.test.js`.

`jours_restant` n'est jamais stocké : il est calculé à l'affichage
(`deadline − aujourd'hui`).
