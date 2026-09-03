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
- **Le ticket du client, retrouvable ET corrigeable sur la ligne.** Une vente
  directe et une demande de devis remettent un ticket au comptoir. Toute ligne
  née là-bas porte une **pastille ticket** (carte et tableau) : un appui le
  réaffiche à l'identique — **déjà modifiable** — un autre l'imprime. On corrige
  dedans, à l'endroit exact où la valeur s'imprimera : le **numéro de téléphone**
  faux, la date et l'heure de retrait, le montant, le paiement, la désignation,
  la quantité et **ce qu'on produit**, article par article. Pas de bouton
  « Enregistrer » : un champ quitté est un champ enregistré, comme dans la
  grille — et « Fermer » comme « Imprimer » commettent d'abord ce qui est encore
  en cours de frappe. Seule la **référence** ne se retape pas (c'est la clé du
  dossier) : à côté d'elle, un champ note le **numéro du papier** quand il en
  porte un autre.
- **« Pour l'atelier », sur le ticket.** Un cadre en bas du ticket porte la
  consigne de production — « logo poitrine gauche 8 cm », « appeler avant de
  couper ». Elle **s'imprime avec le ticket**, c'est-à-dire sur le papier qui
  suit le dossier jusqu'à la machine ; elle se relit dans la fiche ; elle laisse
  une ligne d'**historique** ; et un **point** sur la pastille dit, d'un coup
  d'œil sur la grille, quels dossiers en portent une. Elle ne se confond pas avec
  la **note interne OLDA** du comptoir, qui reste au dossier de travail et
  n'atteint jamais le papier. Il se cherche aussi par son **numéro** —
  celui que le client rapporte sur son papier — dans la recherche de la grille
  comme dans la recherche globale. Le ticket est **reconstruit** depuis la ligne
  et sa fiche : la ligne fait foi pour ce qui se corrige après la vente (heure de
  retrait, montant, paiement), la fiche pour ce qui a été vendu. Il ne porte que
  ce qui figure sur le papier du client — ni secteur, ni adresse de facturation,
  ni total HT, ni taxe, ni **note interne OLDA**. Le récapitulatif complet, lui,
  reste à disposition dans la fiche, en **téléchargement** : c'est un document de
  travail, il n'a jamais eu à sortir sur l'imprimante.
- **Devis flash** : le devis se compose DEVANT le client — on saisit à gauche,
  la feuille A4 se refait à droite à chaque frappe, on imprime, et le dossier
  part au planning à « Tarif / Devis envoyé – Attente client ». Clients,
  catalogue, taux de TGCA, tarif de transport, identité de l'atelier et numéro
  de devis viennent tous de l'application — rien n'est écrit dans le code.
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

### La mise à jour arrive JUSQU'AUX POSTES — la bulle « Mise à jour disponible »

Déployer ne suffit pas. Une tablette du comptoir est allumée le matin et reste
des jours entiers sur la page ouverte au premier café : le serveur sert bien la
nouvelle version, mais le poste continue d'exécuter celle qu'il a chargée, et
personne sur place n'a de raison de deviner qu'il faudrait recharger. Depuis le
18/08, on le lui dit :

- **Le serveur calcule une empreinte du contenu de `public/`** au démarrage
  (`empreinteDuSite`, SHA-1 tronqué). C'est le CONTENU, pas la date de build :
  un redémarrage de conteneur, ou un correctif qui ne touche que `server.js`,
  donne la même empreinte — aucun poste n'est dérangé pour un écran identique.
  Corollaire : un correctif purement serveur n'allume aucune bulle, et c'est
  voulu, il n'y a rien à recharger.
- **Elle part à l'ouverture du flux temps réel** (`event: version` sur
  `/api/stream`). Un déploiement redémarre le conteneur, tous les flux tombent,
  chaque poste rouvre le sien et reçoit l'empreinte du site qu'il vient de NE PAS
  recharger. Aucun sondage, aucune requête de plus. `GET /api/version` n'est là
  que pour les postes dont le flux est mort (503 du plafond, proxy qui a coupé)
  et pour le réveil d'une tablette.
- **Le poste propose, il ne décide pas** (`public/maj.js`). Une bulle s'affiche
  en bas à gauche ; c'est un tap qui recharge. Jamais de rechargement d'office :
  il tomberait un jour au milieu d'une vente et emporterait le dossier. Si une
  saisie est en cours — cellule en cours d'édition, tiroir ouvert, parcours du
  comptoir affiché — le tap demande d'abord confirmation et dit ce qui se perd.
- La bulle **ne s'efface pas toute seule** (ce n'est pas un toast : il
  s'effacerait pendant que la vendeuse a le dos tourné) et **s'éteint** si le
  patron republie la version que le poste exécute déjà.

## API REST

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/requests?stage=<slug>` | Liste d'une étape (priorité desc, échéance asc). |
| GET | `/api/requests` | Toutes les demandes. |
| GET | `/api/counts` | `{ <slug>: <nombre>, ... }` pour les compteurs. |
| GET | `/api/version` | Empreinte du contenu de `public/`, calculée au démarrage. Le filet de la bulle « mise à jour disponible » pour un poste dont le flux temps réel est mort — le chemin normal est l'évènement `version` envoyé à l'ouverture de `/api/stream`. |
| POST | `/api/requests` | Crée une demande (corps partiel autorisé). |
| POST | `/api/requests/:id/copie` | **Recopie une commande** (« Dupliquer », « Envoyer vers Fiverr »), dans une autre famille si `{ stage }` est fourni. La copie emporte `fiche` — le récapitulatif du comptoir, donc tout ce que l'atelier doit lire pour produire. Ne se copient PAS : le numéro de ticket (`fiche.ref`, il identifie UNE prise de commande), l'alerte en cours et les pièces jointes. La copie se fait ici et non côté navigateur : la liste ne transporte qu'un résumé de `fiche`, et `fiche` n'est pas un champ écrivable par PATCH. |
| PATCH | `/api/requests/:id` | Met à jour un ou plusieurs champs. |
| PATCH | `/api/requests/:id/fiche` | **Corrige la fiche** : le récapitulatif du comptoir par **position** (`{ client: [], details: [] }` — les libellés viennent du parcours et ne se réécrivent pas ; une case non remplie n'est pas touchée, donc deux postes qui corrigent deux articles ne s'effacent pas), l'heure de retrait, le secteur de production, la **consigne pour l'atelier** (`atelier`, 500 caractères) et le **numéro du papier remis au client** (`refTicket`). La ligne est prise `FOR UPDATE` le temps de la relire et de la réécrire. `fiche.ref` n'est **jamais** modifiable par cette porte. |
| DELETE | `/api/requests/:id` | **Archive** la demande — elle ne s'efface pas. La ligne quitte tous les écrans (`deleted_at`), garde son journal et ses PDF, et se retrouve dans la corbeille des Réglages, d'où elle revient à sa famille et à sa sous-étape. |
| GET | `/api/agenda` | **L'agenda des retraits** : `{ lignes: [{ id, stage, sub_stage, billing_company, client_type, quantity, product, deadline, flag, flag_reason, heure }], sansDate }`, du plus proche au plus lointain. Ne rend que ce qu'il reste à **remettre au client** — tout sauf « Paiement & clôture » (le dossier est parti), « Commande récupérée » (il vient d'être remis), Fiverr (sous-traitance) et l'archive. `heure` sort de `fiche.heureSouhaitee` (`retrait_creneau` est mesurée vide sur les 205 dossiers de production). **Aucun prix ne voyage** : l'écran n'en affiche pas, et cette liste repart à chaque évènement temps réel vers chaque poste. Les dossiers sans date ne sont pas rendus — ils ne se rangent sous aucun jour — mais ils sont **comptés** (`sansDate`), parce que les taire ferait lire l'agenda comme complet. |
| GET | `/api/requests/recherche?q=…` | **La recherche globale**, faite par le serveur (une page de résultats, pas tout le planning). Tous les jetons doivent apparaître, sans distinction de casse ni d'accent. Cherche dans le dossier, le référent, la description, les contacts, l'alerte — **et le numéro du ticket** (`fiche.ref`, plus `fiche.refTicket` quand le papier remis au client porte un autre numéro) : c'est le seul repère que le client rapporte au comptoir. |
| GET | `/api/requests/:id/journal` | Ce qui a changé sur cette commande (étape, état, prix, échéance, priorité, pilote, référent, payé), du plus récent au plus ancien. La `position` en est exclue : un seul glisser en réécrit une dizaine. |
| GET | `/api/ordre-manuel` | `[<slugÉtape>, ...]` — les étapes rangées à la main. |
| PUT | `/api/ordre-manuel` | `{ etape, range }` — ne touche QUE cette étape, le serveur fusionne avec ce que les autres postes ont décidé et rend la liste à jour. Diffusé en SSE. Envoyer la liste entière (ancienne forme, toujours acceptée pour un onglet resté ouvert sur le JS d'avant) impose aux autres la vision qu'on avait AVANT leur geste : deux vendeuses rangeant deux étapes dans la même minute, et la seconde effaçait la décision de la première. |
| GET | `/api/pipeline` | Familles et leurs sous-étapes (destination d'une commande). |
| POST | `/api/comptoir/projet` | **Le dossier d'un des deux parcours du comptoir** → crée la ligne dans le planning (`stage` + `sub_stage` retrouvée par son libellé), remplit la fiche client et archive le récapitulatif complet dans `fiche`. Répond `{ id, stage, subStage }`. Refuse seulement un dossier sans nom de client. |
| POST | `/api/vente/numero` | Réserve le numéro du ticket de vente directe (`{ jour }` → `{ numero, jour, rang }`). Compteur par journée en `app_meta` : un numéro attribué n'est jamais réutilisé. |
| POST | `/api/devis/numero` | Même compteur, série distincte, pour une demande de devis (`DEV-26.07.30-001`). |
| POST | `/api/devis` | **Le devis chiffré** de l'onglet « Devis flash » → crée la ligne à `demande_chiffrage / devis_envoye`, nature `demande` (le client n'a rien signé), `project_value` = le TTC annoncé, et archive dans `fiche.devis` le devis TEL QU'IL A ÉTÉ IMPRIMÉ. Réserve le numéro si l'écran n'a rien imprimé. Idempotent sur le numéro : renvoyer deux fois le même dossier rend la ligne existante. Refuse un devis sans client, sans article, ou dont le montant est illisible. |
| GET | `/api/catalogue-produits` | **Le catalogue du comptoir** : `[{ id, famille, familleNote, designation, variante, note, label, couleur, reference, prixAchat, prixVenteTtc, tempsMoMin, tempsMachineMin, actif, position }]`. Ouvert en lecture — les deux écrans du comptoir sont des documents à part qui le lisent au chargement pour remplir leur menu produits. |
| PUT | `/api/catalogue-produits` | Remplace la liste (corps = tableau), comme la grille tarifaire tasse. Réservé à `reglages`. Deux lignes de même clé (famille + désignation + variante, réduites) n'en font qu'une : la première gagne. |
| POST | `/api/catalogue-produits/import/apercu` | `{ csv }` → **ce que l'import ferait, sans rien écrire** : `{ resume: { lues, creees, majs, inchangees, refusees }, lignes: [...], plan, signature }`. Un fichier illisible (guillemet non refermé, colonne obligatoire absente) est refusé EN ENTIER en 400. |
| POST | `/api/catalogue-produits/import` | `{ csv, signature }` → écrit, en UNE transaction. La `signature` est celle de l'aperçu : si le fichier ou la base ont bougé entre les deux, l'écriture est refusée (409) et rien n'est écrit. |
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

Sur un dossier né au comptoir, un bouton de plus précède le **↗** : le **ticket
du client**, celui qu'il a en main. Un appui l'affiche tel qu'il s'imprimera —
et **déjà corrigeable**, champ par champ, avec le cadre « Pour l'atelier » en
bas. Un **point** sur la pastille signale qu'une consigne y a été écrite. Sur le
tableau, le ticket a sa propre **colonne**, réglable depuis le rail.

### L'agenda des retraits — le planning par JOUR (03/09/2026)

Demande de Charlie : « un agenda par jours, avec juste les noms des clients et
les jours de retrait, pour que ma vendeuse en 1 regard puisse voir qui vient
chercher quoi pour aujourd'hui, demain… ».

Le rail range le planning par **étape** — où en est le travail. L'agenda le
range par **jour** — qui passe le prendre, et quand. C'est la même liste vue par
l'autre bout : aucune donnée propre, aucune saisie. Sa porte est **en tête du
rail**, là où la vendeuse choisit déjà ses listes, et son adresse est `#agenda`.

| | Ce qu'une rangée dit |
|---|---|
| **Quand** | l'heure du retrait (`fiche.heureSouhaitee`) — vide veut dire « dans la journée », et la colonne se tait plutôt que d'aligner des tirets |
| **Qui** | le nom du dossier, en capitales pour un particulier |
| **Quoi** | `25 × T-shirts blancs DTF` — la quantité colle à l'article, c'est ce qu'on vérifie en le donnant |
| **Est-ce prêt** | la **sous-étape** en « Facturation & remise » (à facturer / client à prévenir / client prévenu), la **famille** partout ailleurs. Sur une commande bloquée, le **motif** prend sa place : sans lui, on promet un retrait qui n'aura pas lieu |

Un bloc par jour, dans l'ordre du calendrier, et rien pour les jours sans
retrait. « Aujourd'hui » et « Demain » sont nommés et datés ; les autres jours
se datent. **Le retard est un seul bloc, en tête** — un bloc par jour passé
donnerait dix en-têtes avant « Aujourd'hui », et le mettre en bas reviendrait à
ranger sous le tapis les clients qui attendent depuis le plus longtemps ; ses
rangées portent leur **date** à la place de leur heure. L'en-tête d'une journée
reste **sous les yeux** pendant qu'on parcourt ses lignes.

Le compteur de l'écran dit aussi combien de dossiers **n'ont pas de date de
retrait** : ils ne peuvent se ranger sous aucun jour, mais les taire ferait lire
l'agenda comme complet.

Un clic sur une rangée **ouvre la fiche**, par-dessus l'agenda : ce qu'on veut
d'un dossier depuis cette liste, c'est le dossier — appeler le client, corriger
l'heure, passer la commande en « récupérée ». Elle quitte alors l'agenda toute
seule, sans qu'il y ait la moindre liste à part à tenir à jour.

**Le jour civil est celui de l'atelier** (`America/Marigot`), jamais celui de la
machine : le conteneur tourne en UTC, et dès 20 h locales « Aujourd'hui » se
viderait tout seul — à l'heure des derniers retraits. L'écran suit le temps réel
comme le reste, et repeint au **changement de jour** : un poste ne se recharge
jamais, et passé minuit ses étiquettes désigneraient la veille.

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
`#nouveau-projet`, `#clients`, `#reglages`, `#agenda`, plus `#fiverr` et
`#a-commander`. La
navigation, dans la barre du haut, n'est faite que de liens — cliquer change le
hash, le hash change la vue. Chaque écran est donc partageable par son URL et le
bouton « Retour » du navigateur fonctionne.
`#agenda` est le seul écran dont la porte n'est PAS dans cette barre : elle est
pleine (mesuré le 03/09 à 1 280 px — 868 px de rangée pour 868 disponibles, et
déjà resserrée), et un onglet qu'on ne voit pas est un écran qui n'existe pas.
Son entrée est **en tête du rail des étapes**, qui est de toute façon la
navigation propre au planning — et l'agenda EST le planning, rangé par jour.
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

### `catalog.json` : les modes de paiement, et plus rien d'autre (01/09/2026)

Il portait huit listes de référence : la nature d'une ligne, les délais
raccourcis avec leur majoration, les emplacements de marquage, les types de
logo, les vêtements, la grille de tailles, les typos, et les modes de paiement.

**Sept sont parties le 01/09.** Elles n'étaient lues que par `POST /api/projets`,
l'ancien « Nouveau Projet » interne, remplacé le 31/07 par les deux parcours du
patron et retiré ce jour-là. Une entrée sans lecteur n'est pas de la
configuration, c'est du décor — et un décor qu'on croit encore appliqué : le
barème d'urgence du patron (jour J +20 %, express +10 %) était dans ce fichier
et n'était plus appliqué nulle part. **Ce qui majore aujourd'hui, ce sont les
suppléments express réglables** (dans 5 / 10 / 15 jours), en base, modifiables
depuis Réglages.

Reste donc les **modes de paiement**, que le serveur revalide à chaque prise de
commande. Le planning en garde un miroir en clair (`PAIEMENT_MODES` dans
`app.js`) parce qu'un écran ne peut pas lire un JSON du serveur sans un appel de
plus au démarrage ; `test/paiement-modes-miroir.js` empêche les deux listes de
diverger. Le fichier est lu **au démarrage** : après modification, redémarrer.

Les **secteurs d'activité**, eux, vivent en base
(`app_meta.client_secteurs`) et se complètent depuis Base clients, sans
redéploiement.

### Le catalogue PRODUITS, lui, vit en base (01/09/2026)

À ne pas confondre avec `catalog.json` ci-dessus : ce sont les **objets que la
boutique vend**, rayon par rayon — ceux du menu déroulant de la demande de
devis. Ils vivaient en dur dans `public/comptoir/catalogue.js`, et **aucun prix
ne pouvait s'y importer** : il aurait fallu redéployer pour changer un tarif.
C'était ça, le verrou.

Ils sont dans la table **`catalogue_produits`**, aux **mêmes colonnes que la
grille tarifaire tasse** : prix d'achat, prix de vente TTC, temps de
main-d'œuvre, temps machine. Les prix sont **nullables** — le catalogue
d'aujourd'hui n'en porte aucun, et les semer à `0` ferait annoncer « 0 € » en
rayon sur quatre-vingts produits.

`public/comptoir/catalogue.js` est devenu le **lecteur** de cette table ; sa
liste de produits est partie dans `catalogue-produits-seed.json`, la **semence**
d'une base neuve — comme `tailles-logo-seed.json`, et **plus une source lue à
chaud**. Le dernier catalogue lu reste sur le poste (`localStorage`) : un wifi
qui décroche ne rend pas un menu vide au client qui est devant. Si rien n'a
jamais été lu, le menu le **dit** et renvoie vers la saisie manuelle.

**Un prix qui change ne retarife JAMAIS une commande déjà passée.** Le chiffrage
d'une ligne est figé dans `fiche.chiffrage` au moment de la prise, et le moteur
(conforme au fichier V9 du patron) ne lit pas cette table. C'est tenu par
`test/catalogue-produits-base.test.js`, qui joue la scène en entier : une vente
à 6 €, le tarif qui triple, la quantité corrigée — le dossier reste à son prix.

### Le devis flash — il se compose DEVANT le client (01/09/2026)

Onglet **« Devis flash »**. On saisit à gauche, **la feuille A4 se refait à
droite à chaque frappe** : le client voit le prix se faire, et le papier qu'il
regarde est exactement celui qui sortira de l'imprimante — l'aperçu et le cadre
d'impression reçoivent la MÊME chaîne de style (`CSS_DEVIS`).

Ce n'est **pas** l'onglet « Devis » d'à côté : celui-là est la *demande* prise au
comptoir, **sans prix** — c'est ce qu'on doit chiffrer. Celui-ci **est** le
chiffrage.

L'écran vient du patron ; ce qui a été repris, c'est son **parcours** (client,
projet, délai, articles, fiscalité) et ses **textes commerciaux** — la phrase du
délai et celle du bon à tirer, mot pour mot : ce n'est pas de la mise en forme,
c'est ce qu'on peut opposer à la maison si la commande prend du retard. Tout le
reste vient de l'application :

| Il avait | Il a maintenant |
|---|---|
| trois clients écrits en dur | la **base clients** (`/api/clients`), et un client inconnu y entre à l'enregistrement |
| trois articles pré-remplis | le **catalogue produits**, qui vit en base et se tarife par import |
| une adresse et un IBAN dans le code | l'**identité de l'atelier**, un réglage — un déménagement ne demande pas un déploiement |
| `TGCA 4 %` écrit dans le calcul | le **taux des Réglages** |
| `1,80 €` de transport en dur | le **tarif de transport des Réglages** |
| `DE0681` écrit dans le gabarit | le **compteur du serveur** — deux postes qui impriment ensemble ne peuvent pas remettre le même numéro |
| un brouillon dans le navigateur | le brouillon **et** le dépôt au planning |

**Le numéro se réserve au premier papier**, pas à l'ouverture de l'écran : un
poste ouvert le matin et laissé là brûlerait un numéro par jour, et la série
aurait des trous que personne ne saurait expliquer.

**« Enregistrer au planning »** dépose le dossier à *Demande & chiffrage › Tarif /
Devis envoyé – Attente client*, avec son montant : l'étape dit qu'on a chiffré,
une colonne Prix vide la contredirait. Sa **nature reste `demande`** — le client
n'a rien signé. Un devis imprimé qui n'est nulle part n'existe pas : personne ne
le relance.

**L'addition tombe juste par construction.** On arrondit le TTC (c'est le nombre
que le client paie), puis le HT au centime, et la taxe est *ce qui reste* — pas
un troisième arrondi indépendant. Sans ça un devis peut imprimer
`100,00 + 4,00 = 104,01`, et c'est le genre de ligne qui fait rappeler un
comptable. `test/devis-flash.test.js` le vérifie sur les trois arrondis, quatre
prix unitaires et trois quantités.

**Et le prix est figé** : `fiche.devis` archive le devis tel qu'il a été
imprimé. Un tarif de catalogue qui change demain ne retarife jamais un devis
déjà remis — joué de bout en bout dans `test/devis-au-planning.test.js`.

L'écran **n'invente aucun composant** : la carte, la barre et le bouton viennent
de `reglages.css` ; le champ (intitulé au-dessus, boîte toujours visible, 50 px)
de `fiche-atelier.css`, qui le tient du comptoir — et les jetons de cette
grammaire sont déclarés sur **une seule règle**, `.fa, .devis-flash` ; l'en-tête
et la pilule de recherche de `charte.css`. Mesuré dans la coquille : 38
commandes, **toutes à 50,0 px**, et quatre tailles de texte rendues — 14 / 17 /
21 / 32, et rien d'autre.

#### Le produit se cherche DANS la ligne, et les deux métiers se basculent (01/09/2026)

« Y'a un gros problème pour bien sélectionner le produit. Ya 2 parties dans mon
entreprise, Textiles et le reste : dans le menu déroulant je veux pouvoir switch
entre les 2 familles. Ce input doit avoir **obligatoirement** une fonction
recherche **comme tous les inputs** avec un menu déroulant. »

La barre des Articles portait une liste de **130 entrées sans recherche**, posée
ailleurs que dans la ligne : pour trouver un t-shirt il fallait descendre à la
molette. Elle est partie. Le produit se choisit maintenant dans la
**Désignation** de la ligne — là où son nom s'écrit. Un endroit de moins, et
celui qui reste est celui qu'on regarde.

**« Comme tous les inputs » est une consigne d'architecture**, pas un souhait
d'apparence. Le menu déroulant avec recherche existait depuis le 27/08, mais il
vivait dans `comptoir/pont.js` — 920 lignes, le fichier des deux écrans du
comptoir, que le CRM ne lit pas. Le recopier aurait donné deux menus qui se
ressemblent et divergent au premier correctif. Il déménage donc dans
**`public/menu-recherche.js`**, comme `calendrier.js` avant lui, pour la même
raison et de la même façon : pont.js n'est pas un module, il le charge par
`import()` et garde ses trois `window.*` à l'identique — ils sont écrits dans les
`onchange` des écrans du patron, et un écran remplacé ne doit rien avoir à
apprendre. ⚠ Ils rendent la main **tout de suite**, module ou pas :
`menusPoserTous` est appelé par un MutationObserver plusieurs fois par seconde,
le faire attendre bloquerait le guet de l'écran de fin, donc l'envoi du dossier.

**Les deux métiers.** Une option porte `data-onglet` ; le composant en fait une
rangée de bascules en tête du panneau, et le filtre travaille dans le métier
actif. Moins de deux métiers, pas de rangée — un seul bouton est un bouton qui
ne fait rien, et c'est pourquoi les menus du comptoir n'ont pas changé d'un
pixel. **Une impasse se dit** : chercher « NS300 » depuis « Boutique » ne rendait
rien alors que la réponse était à un clic — le panneau propose maintenant
« 5 dans « Textile » », et le clic bascule. On ne bascule jamais tout seul : un
menu qui change de métier sous les doigts est pire que le trou qu'il comble.

Mesuré au rendu, à 1 440 px : la désignation **619,2 × 50 px** comme ses
voisines, le panneau exactement à sa largeur, les bascules à **39,4 px** (la
boîte serrée de la charte), zéro débordement horizontal. Et sur les écrans du
comptoir : cinq menus à **246,7 × 50 px**, 48 références, **0 bascule** — rien
n'a bougé.

#### Une seule base produits pour les trois écrans (01/09/2026)

« Les t-shirts doivent être inclus dans le devis flash ; vente, devis et devis
flash doivent avoir exactement la même base de données de produit. »

Il y avait **deux catalogues** et **trois écrans** qui n'en voyaient pas les
mêmes morceaux :

| écran | ce qu'il voyait |
|---|---|
| Vente directe | **rien** — sept intitulés écrits en dur dans la page (« Tee-shirt personnalisé »…), sans référence ni prix |
| Demande de devis | la table `catalogue_produits` (82 objets) **plus** les 49 références du moteur textile, dans deux endroits |
| Devis flash | la table seule — donc pas un seul t-shirt |

Les références du moteur descendent dans la **même table**, famille
« Textile » : **130 lignes, un seul endpoint**, les trois écrans y lisent.

**⚠ Ce qui ne descend pas : l'argent.** La table porte l'*identité* du produit —
famille, désignation, référence, genre — pas son prix. Un t-shirt ne se vend pas
à un prix de rayon : il se **chiffre**, quantité par quantité et marquage par
marquage. Un prix d'achat posé au catalogue serait une case qu'on corrige et qui
ne change rien au devis : le pire des deux mondes.

**La semence ne peut pas dériver du moteur.** `test/catalogue-textile-base.test.js`
compare les deux référence par référence, et applique **exactement** la règle
d'exclusion que l'écran du comptoir applique déjà (`r.genre && r.designation !==
'TEST'`) — pas une deuxième qui lui ressemble. Une référence ajoutée au fichier
du patron sans l'être au catalogue fait échouer le test : sans ça on aurait un
t-shirt qu'on sait chiffrer et qu'on ne trouve pas, et un catalogue ne signale
jamais ce qu'il ne contient pas.

**Le devis flash chiffre le textile avec LE moteur, pas avec une copie.** Il le
charge à la demande — 78 Ko qu'un devis de tasses n'ouvre jamais — et appelle
`TextileEngine.calculate`. La rangée d'un textile porte le **menu des treize
emplacements** du fichier V9 à la place du champ libre : « coeur+dos » tapé à la
main ne serait plus un emplacement pour le moteur, il vaudrait zéro mètre de DTF
et la ligne sortirait au prix du vêtement nu. Le prix **suit la quantité**, parce
que le coefficient est dégressif — mesuré à l'écran contre le moteur : 12,20 € à
1 pièce, 23,30 € à 10 avec Cœur + Dos, 17,60 € à 50, au centime près sur cinq
combinaisons. Un prix tapé pendant une négociation **tient** ; « Recalculer » le
rend au moteur.

Deux paramètres qui se paieraient s'ils étaient faux, et qui sont tenus par le
test : `markupPercent: 0` (les coefficients du V9 portent déjà la marge) et
`transport: 'Maritime'` (0 €/pièce — le transport a sa **propre ligne** sur le
devis, au tarif des Réglages ; le compter aussi dans le prix à la pièce le
facturerait deux fois).

**Le comptoir écarte le textile de sa liste « Autre »**, et c'est voulu : il a sa
tuile Textile, celle qui sait faire le prix. La base est unique — c'est ce que
chaque écran en *montre* qui diffère, et chacun montre le chemin qui sait
chiffrer.

**La vente directe reçoit le catalogue par le pont**, jamais dans la page : les
écrans du comptoir viennent du patron et se remplacent en entier, une greffe
écrite dedans partirait avec le fichier. Le prix de rayon se pose **seulement si
la case est vide** — on remise et on arrondit au comptoir, un prix qui écrase un
prix négocié est une remise perdue à chaque article.

#### Le message tombait quatre pixels sous le pli (01/09/2026)

« Quand je clique sur enregistrer au planning rien ne s'affiche. » Le dossier
partait bien : c'est le **message** qui ne se voyait pas — et tous l'étaient,
les deux refus, la confirmation et l'échec d'impression.

`.msg-flottant` est `position: absolute; top: 100%` et prend pour ancre **son
parent direct** (`:has(> .msg-flottant)`, `charte.css`). L'écran le posait sur
`<body>` : « 100 % » y vaut la hauteur de la **page entière**. Mesuré au rendu :
**904 px dans une fenêtre de 900**. Le défaut ne se voit ni en relisant l'écran
(la classe est la bonne) ni en relisant la charte (la règle est la bonne) — il
naît de leur rencontre. Il s'ancre désormais à la rangée des boutons de
l'en-tête, c'est-à-dire à la commande qui le provoque, et
`test/devis-flash.test.js` refuse le retour à `<body>`.

Au passage, `is-ok` / `is-ko` — les deux noms que `.reg-status` emploie déjà aux
Réglages — sont devenus de vrais états du message flottant. L'écran les écrivait
sur un composant qui ne les connaissait pas : son refus sortait en gris. Le
rouge garde **une seule écriture**, il n'en ouvre pas une seconde qui lui
ressemble.

#### L'aide se demande, elle ne tient plus le haut de l'écran (01/09/2026)

« Supprime les phrases de ce genre, et mettre à côté du titre un petit i dans
une bulle qui nous affiche les infos quand on clique dessus. »

Chaque carte du Devis et des Réglages portait sous son titre un paragraphe de
deux à quatre lignes. **Seize cartes** : de la prose à franchir avant le premier
champ, relue zéro fois après la première ouverture. Le texte n'est pas perdu —
il est dans la bulle du « i » (`public/aide-bulle.js`, `.aide-b` / `.aide-bulle`
dans `charte.css`), **une seule fabrique pour les deux écrans**.

La bulle **ne pousse personne** (loi 8) : elle sort du flux et se pose sur la
largeur de son **hôte**, pas sur celle du « i » — ancrée au bouton, elle
déborderait de la colonne de saisie du devis, qui défile, donc dont
l'`overflow-y: auto` contamine l'autre axe et rognerait ce qui dépasse. Mesuré
au rendu, seize cartes ouvertes une à une : **0 px de déplacement**, 0 px de
débordement, une seule bulle ouverte à la fois. Le « i » prend la boîte de
l'icône qui lui fait face — **20 × 20**, et les trois centres (icône, titre,
« i ») tombent au même pixel sur les seize.

### L'import de prix — on lit tout, on dit tout, PUIS on écrit

Un écran dans **Réglages** avale un **CSV UTF-8** (« Enregistrer sous » depuis
Excel). Le format est du CSV et pas du `.xlsx` : le dépôt n'a que trois
dépendances (express, pg, compression) et lire un `.xlsx` natif — un ZIP, du
XML, la table des chaînes partagées et celle des styles pour savoir si « 35 »
est un prix ou une date — en demanderait une quatrième.

Les intitulés de **SumUp** (`Category`, `Item name`, `Price`) sont reconnus tels
quels, en plus des noms français ; le séparateur (`;`, `,`, tabulation) est
deviné sur la ligne des intitulés, le BOM d'Excel retiré, et les nombres se
lisent à la française (`12,50 €`, `1 234,56`). Un montant qu'on ne sait pas lire
est **refusé**, jamais ramené à zéro.

**Rien ne s'écrit sur un import à moitié lu.** Le fichier est analysé en entier
d'abord ; un guillemet jamais refermé ou une colonne obligatoire absente refuse
le **fichier**, pas ses quatre-vingts premières lignes. L'aperçu rend les quatre
comptes — créées / mises à jour / inchangées / refusées — et **la raison de
chaque refus avec son numéro de ligne**. L'écriture réclame la **signature** de
cet aperçu : on n'écrit que ce qui a été montré.

SumUp répète la ligne d'un produit **une fois par variante**, la première sans
prix, sans jamais nommer la variante. Deux lignes du même produit se **fondent**
tant qu'elles sont d'accord (une case vide ne contredit rien) ; dès qu'elles se
contredisent, **aucune** n'est retenue et le refus dit quoi faire — ajouter une
colonne « Variante ». Deviner poserait un prix faux en rayon.

Une colonne **absente du fichier n'efface rien** : un export à trois colonnes ne
remet pas les temps machine à zéro.

#### Les règles d'import — `catalogue-import-regles.json`

Ce que l'export ne dit pas, et qu'on ne devine pas. Des **données**, pas du
code : un rayon qui change ne doit pas demander un déploiement. Quatre sortes,
appliquées dans cet ordre, et **toutes lues sur le rayon d'origine** — celui que
le patron a sous les yeux dans son tableur :

1. **`ecartes`** — ce qui ne doit pas entrer, à **trois portées** : un RAYON qui
   n'est pas un produit (`Express` est un réglage, `Perso` / `perso textile` sont
   du travail graphique), un PRODUIT (les trois tasses que la grille tarife
   déjà), ou une **seule LIGNE** visée par son prix (`+ prix`) — « pas de
   porte-clés à 9 € ». La plus précise l'emporte. Ces lignes sont comptées
   **`ecartees`**, jamais confondues avec un refus : ce n'est pas une erreur,
   c'est une décision, et elle porte sa raison écrite.
2. **`variantes`** — le nom d'une variante, retrouvé par son **prix**, seul
   repère que l'export laisse. Une variante déjà écrite dans le fichier gagne
   toujours sur la règle.
3. **`produits`** — une ligne du fichier → **le produit du comptoir qu'elle
   désigne**. C'est la règle qui manquait le 02/09/2026 : le fichier de caisse
   a été importé en prod sans elle, et « Accessoires / Couteau Multi » est entré
   à côté de « Art de la table / Couteau Multi / Bois » — cent treize produits
   créés, une quarantaine de doublons, le même t-shirt dans deux onglets du devis
   flash à deux prix. `de` vise un rayon + un produit (+ un prix pour ne viser
   qu'une ligne), `vers` pose le rayon, la désignation, et s'il est écrit le nom
   de variante. **Un prix donné au produit vaut pour toutes ses variantes** en
   base (Couteau Multi : Bois et Liège) — ce que SumUp fait déjà de son côté en
   répétant le prix par variante —, mais **seulement** pour une ligne passée par
   une règle `produits` : quelqu'un a regardé le catalogue avant de l'écrire.
   `vers` peut être une **liste** (« Identificateur Valise » vaut pour les trois
   identificateurs du comptoir).
4. **`familles`** — le rayon SumUp → le rayon du comptoir, pour ce qu'aucune
   règle `produits` n'a déjà rangé. Les t-shirts **finis** de la boutique
   (« 0 UNISEXE / H001… », 35 €) entrent sous « Vêtements — Unisexe / Femme /
   Enfant » : ce ne sont pas les références **nues** du rayon « Textile », que le
   devis chiffre au moteur. Les deux existent et ne disent pas la même chose.

**Le fichier de caisse du patron est livré avec le dépôt**
(`catalogue-sumup-2026-08-26.csv`, l'export SumUp du 26/08) et **rangé au
démarrage** par `rangerCatalogueSumup` (db.js) : les résidus de l'import du
02/09 retirés — reconnus par leur rayon et leur désignation de caisse, hors des
deux semences, donc jamais un produit ajouté à la main —, puis le fichier rejoué
par les mêmes fonctions que l'écran de Réglages. Une base neuve ressort
identique à la production ; `test/catalogue-sumup-reel.test.js` le tient sur le
fichier réel : aucun rayon de caisse, aucun doublon, chaque prix sur son produit.

**Nommer une variante coupe le produit en deux, et c'est le piège.** Tant
qu'aucune ligne n'est nommée, la ligne « d'ouverture » de SumUp — celle qui
ouvre le produit **sans prix** — se fond avec les autres. Dès qu'une règle nomme
les lignes tarifées, elle reste seule et fabrique un **produit fantôme** sans
variante et sans prix, posé au menu du comptoir à côté de ses propres variantes.
Elle est donc **absorbée** ; et une ligne qui porte un prix mais qu'aucune règle
n'a su nommer, alors que ses sœurs l'ont été, est **refusée** plutôt que posée
au menu sans nom.

**Deux variantes peuvent partager un prix**, et c'est le cas du Magnet comme du
Porte-clés : quatre lignes tarifées pour trois montants (7, 5, 9 et encore 7).
Le prix ne les distingue plus — mais on sait qu'il y en a deux et on sait leurs
noms (« Magnet acrylique et bois 7 euros », Charlie, 01/09). Une règle porte
alors une **liste** (`variantes: ["Acrylique", "Bois"]`) au lieu d'un nom, et
les lignes de ce prix les prennent **dans l'ordre où elles se présentent** — les
deux lignes étant par ailleurs identiques, seule l'étiquette s'échange. **Un nom
déjà pris n'est jamais réutilisé** : deux lignes du même nom se *fondent* en un
produit, et une variante disparaîtrait en silence. Une ligne de plus que de noms
reste donc sans nom, et se fait refuser avec sa raison.

Chaque ligne du rapport dit **ce qu'une règle lui a fait** — le rayon d'où elle
vient, le nom posé sur sa variante. Une règle qui agit en silence est une règle
qu'on ne relit jamais. Le fichier est **relu à chaque import** (aucun
redémarrage) et sa cohérence est tenue par `test/import-regles.test.js` : pas
deux règles pour un même prix, pas de rayon à la fois écarté et remappé, pas
d'exclusion sans raison écrite.

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
├── catalog.json      les modes de paiement, et rien d'autre. Il portait aussi
│                     natures, délais, zones, typos, techniques et logos : ces
│                     listes n'étaient lues que par POST /api/projets, partie le
│                     01/09. Le planning garde un miroir des modes de paiement,
│                     tenu par test/paiement-modes-miroir.js
├── tarif-tasse.js    LE PRIX D'UNE TASSE : la somme de ses morceaux dans la
│                     grille du patron, et son coût de revient. Pur, sans base
├── catalogue-csv.js  lecture du CSV de prix + rapport d'import (pur, sans base)
├── catalogue-produits-seed.json  la SEMENCE du catalogue du comptoir (82 lignes vendables)
├── catalogue-import-regles.json  rayons écartés, variantes nommées, correspondance des PRODUITS et des rayons
├── catalogue-sumup-2026-08-26.csv  le fichier de caisse du patron (export SumUp), rangé au démarrage
├── catalogue-textile-seed.json   les 48 références du moteur, semées dans la MÊME table
│                                 que les objets — identité seule, jamais l'argent
├── public/
│   ├── index.html    coquille + les vues (planning, dashboard, projet, clients, réglages)
│   ├── styles.css    design system
│   ├── app.js        fetch, rendu grille, édition inline, étoiles, drag & drop
│   ├── sw.js         service worker : coquille hors ligne, réseau prioritaire
│   ├── maj.js        la bulle « mise à jour disponible » : compare l'empreinte du site et propose de recharger
│   ├── ticket.js     le TICKET du client, reconstruit depuis la ligne (règles pures)
│   ├── papier.js     LE SOCLE DES TROIS PAPIERS : encre, filet, marge, intitulés,
│   │                 et l'identité de la maison (un RÉGLAGE, jamais du code)
│   ├── devis.js      le DEVIS : le calcul de l'argent, et la feuille A4 (règles pures)
│   ├── devis-flash.js  l'écran du devis : saisie à gauche, feuille vivante à droite
│   ├── devis-flash.css la coupe en deux moitiés et la rangée d'article — rien d'autre
│   ├── aide-bulle.js   le « i » à côté d'un titre : l'aide se demande, elle ne s'affiche
│   │                 pas d'office — Réglages et Devis, une seule fabrique
│   ├── menu-recherche.js  LE menu déroulant avec recherche des TROIS écrans : il habille
│   │                 un <select> ou un <input list>, filtre, et bascule entre les
│   │                 deux métiers de la maison (Textile / Boutique)
│   ├── whatsapp.js   numéro au format international + message rempli (règles pures)
│   ├── projet.css        coquille de Nouveau Projet (.np-*) : accueil, bascule, cadre
│   ├── nouveau-projet.js aiguillage des 2 parcours + pont vers le planning
│   ├── comptoir/         LES ÉCRANS DU PATRON, repris tels quels
│   │   ├── vente-directe.html   Articles → Client → Paiement → Ticket
│   │   ├── demande-devis.html   Demande → Besoins → Projet → Contrôle → Client → Récap
│   │   ├── catalogue.js         LIT le catalogue produits en base (repli localStorage)
│   │   └── pont.js              base clients réelle + numéro du jour réservé côté serveur
│   ├── clients.css   vue Base clients, scopée sous #clients
│   ├── clients.js    liste, fiche éditable, notes, secteurs, villes
│   ├── reglages.js   vue Réglages (WhatsApp, tarifs, catalogue produits, import de prix)
│   ├── reseau.js     TOUTE REQUÊTE A UNE FIN — et l'appel à l'API n'existe
│   │                 qu'ici : délai, signature du poste (X-Qui), corps du refus
│   │                 rapporté avec l'erreur. Les cinq écrans en avaient chacun
│   │                 une copie jusqu'au 01/09 ; celle du devis flash ne signait
│   │                 rien et n'avait pas de délai.
│   ├── session.js    qui est connecté, ce qu'il peut, le voile de connexion
│   ├── poste.js      le prénom choisi une fois par appareil (olda.qui)
│   ├── dashboard.js  le Point du jour + dashboard.css · priority.js le classement
│   ├── montravail.js « Mon travail » + montravail.css
│   ├── agenda.js     L'AGENDA DES RETRAITS + agenda.css : le planning rangé par
│   │                 JOUR — qui vient chercher quoi aujourd'hui, demain, après
│   ├── pilotage.js   la marge, réservée à la Direction, + pilotage.css
│   ├── tailles-logos.js  le tableau de l'atelier + tailles-logos.css
│   ├── fiche-atelier.js  le dossier ouvert en grand + fiche-atelier.css
│   ├── ligne-faits.js    ce qu'une ligne du planning dit d'elle-même
│   ├── bureau.js     LE BON DE COMMANDE (tout l'argent), sur le socle papier.js
│   ├── calendrier.js · modale.js · ecran-tete.js · confirmer.js · nom-client.js
│   │                 · format.js  les composants partagés par plusieurs écrans
│   └── manifest.webmanifest · olda-logo.svg · olda-icones.woff2 (91 glyphes)
├── outils/verifier-charte.mjs   le garde-fou de la charte, en cliquet
├── scripts/refresh-toptex-couleurs.js  les coloris textile, À LA MAIN
├── ARCHITECTURE.md   l'audit du 01/09 : ce qui vit, ce qui est mort, le plan
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
