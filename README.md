# Cockpit de gestion des demandes — Atelier OLDA

Outil web interne mono-service pour piloter le flux des demandes clients d'un
atelier de personnalisation textile (DTF, pressage, laser, UV, sous-traitance).
Vue « Google Sheets amélioré » : une grille éditable au centre, une sidebar
verticale à gauche qui matérialise le pipeline.

Pile technique : **Node.js + Express** (un seul service qui sert aussi le
frontend), **PostgreSQL** via `pg`, **frontend vanilla** (HTML + CSS + JS, ES
modules natifs, aucun build, aucun framework, aucun bundler).

## Fonctionnalités

- **Nouveau Projet**, la seule porte d'entrée, en **deux parcours** entre
  lesquels la vendeuse choisit d'un tap : la **vente directe** (Articles →
  Client → Paiement → Ticket, ticket numéroté à imprimer / télécharger / envoyer
  sur WhatsApp) et la **demande de devis** (Demande → Besoins → Projet →
  Contrôle → Client → Récapitulatif, **sans prix** — c'est ce qu'on doit
  chiffrer). Les deux écrans sont ceux du patron, repris tels quels, et versent
  au planning l'**intégralité** du dossier saisi.
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
- **Installable sur la tablette et ouverture hors ligne** (`public/sw.js`) : le
  service worker met de côté la coquille de l'application (HTML, CSS, JS,
  icônes). Le planning s'ouvre instantanément et affiche son écran même sans
  réseau, avec un message qui dit pourquoi la liste est vide et une reprise
  automatique dès le retour de la liaison. **Le réseau garde toujours la
  priorité** : le cache ne sert qu'en cas d'échec, un déploiement s'applique
  donc immédiatement (cf. l'incident du 28/07 où un poste gardait l'ancien JS).
  Rien de `/api/` n'est mis en cache — les données viennent toujours du serveur.

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

### « À faire maintenant » ≠ « à relancer »

Trois positions veulent dire **la balle est chez le client** (`WAITING_SUBS`,
`public/priority.js`) : *Tarif / Devis envoyé*, *BAT envoyé* et ***Client prévenu
– Attente retrait*** — cette dernière voulant dire que la commande est FINIE et
n'attend plus que d'être récupérée. Elles sortent de la file « À faire
maintenant » vers le bac **« À débloquer / relancer »**, chacune avec son motif
(on ne relance pas de la même façon un devis sans réponse et une commande posée
sur l'étagère).

Elles comptent en **« Attente client »**, jamais en **« En retard »** : ce
compteur-là dit que *l'atelier* est en retard. Sans cette règle, une commande
terminée dont la date promise est passée squattait la tête du point du matin —
le patron se voyait réclamer du travail fait depuis des jours.

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
| POST | `/api/requests/:id/copie` | **Recopie une commande** (« Dupliquer », « Envoyer vers Fiverr »), dans une autre famille si `{ stage }` est fourni. La copie emporte `fiche` — le récapitulatif du comptoir, donc tout ce que l'atelier doit lire pour produire. Ne se copient PAS : le numéro de ticket (`fiche.ref`, il identifie UNE prise de commande), l'alerte en cours et les pièces jointes. La copie se fait ici et non côté navigateur : la liste ne transporte qu'un résumé de `fiche`, et `fiche` n'est pas un champ écrivable par PATCH. |
| PATCH | `/api/requests/:id` | Met à jour un ou plusieurs champs. |
| DELETE | `/api/requests/:id` | Supprime une demande (avec ses PDF, ses secteurs et son journal). |
| GET | `/api/requests/:id/journal` | Ce qui a changé sur cette commande (étape, état, prix, échéance, priorité, pilote, référent, payé), du plus récent au plus ancien. La `position` en est exclue : un seul glisser en réécrit une dizaine. |
| GET | `/api/ordre-manuel` | `[<slugÉtape>, ...]` — les étapes rangées à la main. |
| PUT | `/api/ordre-manuel` | Remplace cette liste, diffusée en SSE. |
| GET | `/api/pipeline` | Familles et leurs sous-étapes (destination d'une commande). |
| POST | `/api/comptoir/projet` | **Le dossier d'un des deux parcours du comptoir** → crée la ligne dans le planning (`stage` + `sub_stage` retrouvée par son libellé), remplit la fiche client et archive le récapitulatif complet dans `fiche`. Répond `{ id, stage, subStage }`. Refuse seulement un dossier sans nom de client. |
| POST | `/api/projets` | Enregistre un projet (panier multi-produits) → crée la ligne dans le planning, à la destination demandée (`stage` + `subStage`). Refuse un corps sans délai ni date précise. Champs de vente directe facultatifs : `numero`, `heureSouhaitee` (`HH:MM`), `noteInterne`, `retraitImmediat`. **Plus appelé par l'interface** depuis le passage aux parcours du patron ; conservé le temps de confirmer qu'on n'y revient pas. |
| POST | `/api/vente/numero` | Réserve le numéro du ticket de vente directe (`{ jour }` → `{ numero, jour, rang }`). Compteur par journée en `app_meta` : un numéro attribué n'est jamais réutilisé. |
| POST | `/api/devis/numero` | Même compteur, série distincte, pour une demande de devis (`DEV-26.07.30-001`). |
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

**Cohérence étape / sous-étape** : une sous-étape n'appartient qu'à une famille.
Poser `prod_uv` sur une commande en facturation est refusé (400), que la paire
arrive ensemble ou que seule la sous-étape soit envoyée (elle est alors comparée
à l'étape en base). `sub_stage: null` — « à préciser » — reste toujours valide.

**Ordre manuel** : glisser une carte réécrit les `position` en base, donc pour
tous les postes. La décision « cette étape est rangée à la main » vit au même
endroit (`app_meta.ordre_manuel`) et non dans le localStorage d'une tablette —
sinon une vendeuse range sa liste et le poste d'à côté n'en voit rien. Un
réordonnancement renumérote **toute la famille** (1000, 2000, 3000…), pas
seulement les lignes visibles : la vue peut être filtrée par la recherche ou
restreinte à une sous-étape, et laisser les autres sur leurs anciennes valeurs
créait des positions en double.

**Journal** : l'application n'a qu'un mot de passe commun à l'atelier — elle
enregistre donc CE QUI a changé, pas QUI l'a fait. Identifier chaque employé est
un choix d'architecture (comptes, sessions), pas un correctif.

## Nouveau Projet — `/#nouveau-projet` : les deux parcours du comptoir

La **seule porte d'entrée** de l'application : toute affaire y naît. Un tap sur
l'onglet ouvre d'abord **le choix**, deux grandes tuiles, parce qu'une seule
question sépare les deux parcours — *le client paie-t-il maintenant ?*

| | Vente directe | Demande de devis |
|---|---|---|
| La situation | Le client est là, le prix est connu : il paie et repart avec son ticket. | Le client demande un prix : on note son besoin, Atelier OLDA chiffrera. |
| Les étapes | Articles → Client → Paiement → Ticket | Demande → Besoins → Projet → Contrôle → Client → Récapitulatif |
| Entre au planning | **Préparation du projet**, chiffrée et encaissée (ou **Facturation → Commande récupérée** si le client repart avec) | **Demande & chiffrage**, **sans prix**, avec tout le brief |
| Nature (`order_kind`) | `commande` | `demande` |

### Les parcours sont des pages à part

`public/comptoir/vente-directe.html` et `public/comptoir/demande-devis.html`
sont les écrans **dessinés et validés par le patron**, repris tels quels et
affichés dans un cadre (`<iframe>`) sous l'onglet. Ce n'est pas un détail
d'implémentation, c'est le choix qui tient tout le reste :

- ces écrans stylent des **balises nues** (`button`, `input`, `h2`, `hr`…) ;
  inline dans le CRM, ils déborderaient sur le planning ;
- ils se **réécrivent entièrement** d'une version à l'autre (V15, V17…) : une
  nouvelle version se pose en **remplaçant un fichier**, pas en retraduisant un
  parcours à la main — et une retraduction, c'est une occasion de perdre un
  champ à chaque fois ;
- ce que le patron a validé est **exactement** ce qui tourne.

Le parcours ne connaît **aucune adresse d'API**. Il recueille un dossier complet
et, quand la vendeuse tape **« Créer dans le planning »**, le poste à la fenêtre
parente (`postMessage` `OLDA_CREATE_PROJECT`). C'est `nouveau-projet.js` qui
écoute — en n'acceptant que ses propres cadres, sur sa propre origine —, appelle
l'API, puis **saute au planning sur la ligne qui vient de naître**.

Un échec d'enregistrement s'**affiche** au-dessus du parcours et le laisse
intact : la vendeuse a le client devant elle, elle retape sur le bouton. Un
double tap ne crée qu'une ligne.

### Ce que le CRM branche dans les parcours (`comptoir/pont.js`)

Deux choses seulement, celles qui ne peuvent pas vivre dans un écran isolé :

- **La base clients réelle.** La recherche du parcours est remplie depuis
  `GET /api/clients` : la vendeuse cherche dans les clients de l'atelier, pas
  dans un jeu d'exemple. Un client créé pendant le parcours entre dans la base
  au moment où le dossier part au planning (upsert serveur, dédoublonnage sur le
  nom).
- **Le numéro du jour.** Réservé **au premier article** (vente) ou **au premier
  besoin** (demande), jamais à l'ouverture de l'écran : un numéro attribué n'est
  jamais réutilisé, et ouvrir l'onglet pour rien ne doit pas faire un trou dans
  la numérotation des tickets remis aux clients. Tant qu'il n'est pas réservé, la
  demande affiche « — » plutôt qu'un numéro provisoire que la vendeuse pourrait
  annoncer au client. Si le compteur est injoignable, le poste retombe sur son
  rang local plutôt que de bloquer la vente.

Format du patron : `26.07.30-001` pour un ticket de vente, `DEV-26.07.30-001`
pour une demande — année, mois, jour, puis le rang **dans la journée**. Le
compteur vit côté serveur (clé `app_meta`), pas dans le navigateur : deux
comptoirs qui encaissent en même temps ne peuvent pas remettre le même numéro à
deux clients. Le jour est celui du **poste** (le conteneur tourne en UTC, il
basculerait au lendemain dès 20 h à Saint-Martin).

### Le dossier arrive ENTIER au planning (`POST /api/comptoir/projet`)

Ce qui rentre dans une colonne y va (client, prix, échéance, priorité, étape,
paiement) ; **tout le reste est archivé dans `fiche`** — le récapitulatif du
parcours, ligne à ligne, tel qu'il s'imprime. C'est lui que rouvre le tiroir de
la commande, sous « Détail produit » : articles, prix unitaires, TGCA, totaux,
mode de paiement, heure de retrait, description de production, coordonnées du
client, points à contrôler. **Rien de ce que la vendeuse a saisi ne se perd.**

| Ce que le parcours envoie | Où ça atterrit |
|---|---|
| `stage` + `status` (le libellé affiché) | `stage` (famille) + `sub_stage`, retrouvée par son libellé |
| `clientObj` | `billing_company`, `client_type`, `contact_referent`, `contact_phone`, `contact_email` — et la fiche de la base clients |
| `amount` (vente uniquement) | `project_value` (le **TTC**) |
| `paiement` | `paye` + `paiement_mode` (`cb` / `especes` / `virement` / `mixte`) |
| `recap` | colonne **Infos** de la ligne |
| `details`, `client_info`, `checks`, `budgetIndicatif`… | `fiche` (jsonb), rendu dans le tiroir |

**Une demande de devis n'a pas de prix** : `project_value` reste `null` —
surtout pas `0`, qui se lirait « gratuit » dans la colonne Prix alors que c'est
précisément ce qu'il faut chiffrer. Le **budget indicatif** annoncé par le client
est gardé à côté, dans la fiche ; il ne devient jamais un prix.

Rien de ce qui vient du parcours ne peut **bloquer** l'enregistrement, sauf un
dossier sans nom de client (la ligne serait anonyme au planning). Un libellé
d'étape qu'une nouvelle version aurait renommé pose la ligne dans sa famille,
sous-étape « à préciser » ; une date impossible retombe sur aujourd'hui. Refuser
laisserait la vendeuse avec un client encaissé et rien au planning.

### Repartir net entre deux clients

Un tap sur « Nouveau Projet » dans la barre du haut revient **toujours** au
choix, avec deux parcours vierges : les deux cadres sont rechargés, pas
seulement celui qu'on affichait. Au comptoir on ne cherche jamais un brouillon
abandonné entre deux clients. Même chose après un enregistrement réussi.

La barre de navigation principale est masquée sur cet écran
(`body.view-comptoir`) : devant le client, il ne reste que le parcours en cours
et le bouton **« Changer de parcours »**. Le logo OLDA ramène au planning.
## Le planning — fiches épurées par défaut

Le planning s'ouvre sur les **fiches** de l'écran du patron : une carte par
projet, qui ne répond qu'à quatre questions.

| | Ce qu'on lit |
|---|---|
| **Client** | le nom du dossier, et la référence du ticket dessous |
| **Projet** | la description, puis deux puces : priorité et étape courante |
| **Délai de production restant** | en **heures ouvrées** (lun–ven, 9h→18h), la remise client, et « à terminer avant … » |
| **TTC** | le montant — ou « À chiffrer » —, les initiales des quatre employés pour changer de référent d'un clic, et le référent en place |

Le **délai restant** est le seul chiffre qui n'existait nulle part avant, et
c'est celui qui décide de l'ordre de la journée. Il ne compte que les heures
ouvrées : une remise le lundi à 9h doit être **terminée le vendredi à 18h**, pas
« dans 3 jours ». Un filet coloré à gauche de la carte dit l'urgence avant même
qu'on ait lu : rouge en retard, orange sous deux jours ouvrés, encre au-delà.

Le reste — coordonnées, détail complet, paiement, documents, notes — s'ouvre
d'un clic sur le **↗** de la carte, dans la fiche projet (voir plus bas). La
carte se **glisse sur le rail des étapes** comme une ligne de tableau.

### Le rail « Colonnes » — le tableau complet est rangé, pas perdu

Le bouton **« Colonnes »** ouvre un rail à droite. Sur les fiches, toutes les
colonnes du tableau y attendent dans **« Retirées »** : en rallumer une **ramène
le tableau** avec elle. Le bouton du bas fait l'aller-retour dans les deux sens
(« Afficher le tableau complet » / « Revenir aux cartes ») : on ne se retrouve
jamais coincé dans une vue.

Une fois dans le tableau, le rail reprend son rôle habituel : un clic retire une
colonne, elle descend dans « Retirées » — elle reste **sous les yeux**, et le
même clic la remet. Rien ne disparaît dans un menu qu'il faudrait rouvrir pour
savoir ce qui manque.

Trois règles :

- **« Nom du dossier client » est verrouillée** (cadenas). C'est elle qui
  identifie la ligne : sans elle, la grille n'est plus lisible.
- Le choix est **global et local au poste** (`localStorage`, clé
  `olda_cols_v2`) — c'est un réglage de poste, pas un paramètre de navigation :
  il ne suit donc pas d'un ordinateur à l'autre. La clé porte un `v2` :
  l'ancienne (`v1`) est ignorée, pour qu'un poste qui avait réglé ses colonnes
  reparte lui aussi sur les fiches.
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

L'aiguillage Nouveau Projet (`nouveau-projet.js`) n'est chargé qu'au **premier**
passage sur la vue, et le document d'un parcours qu'au premier passage **sur ce
parcours** : le planning ne paie rien tant qu'on ne prend pas de commande, et
l'accueil à deux tuiles ne coûte rien du tout.

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

Deux exceptions assumées :

- `.wall` (écran mural de l'atelier) reprend la **variante sombre** de la charte
  quel que soit le thème de l'app — c'est ce qui le rend lisible à distance.
- Les **parcours du comptoir** (`public/comptoir/`) gardent l'habillage du
  fichier du patron : ce sont ses écrans, validés tels quels, dans leur propre
  document. La charte du CRM habille la coquille autour (accueil, barre de
  bascule), pas l'intérieur du parcours.

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
│   ├── sw.js         service worker : coquille hors ligne, réseau prioritaire
│   ├── whatsapp.js   numéro au format international + message rempli (règles pures)
│   ├── projet.css        coquille de Nouveau Projet (.np-*) : accueil, bascule, cadre
│   ├── nouveau-projet.js aiguillage des 2 parcours + pont vers le planning
│   ├── comptoir/         LES ÉCRANS DU PATRON, repris tels quels
│   │   ├── vente-directe.html   Articles → Client → Paiement → Ticket
│   │   ├── demande-devis.html   Demande → Besoins → Projet → Contrôle → Client → Récap
│   │   └── pont.js              base clients réelle + numéro du jour réservé côté serveur
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
