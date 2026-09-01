> ⚠ **DOCUMENT HISTORIQUE.** Écrit avant le 01/09/2026 et jamais relu depuis.
> Il cite des fichiers qui n'existent plus (`public/projet.js`, `public/commande.js`,
> `public/guide.js`), des tables retirées (`production_sectors`) ou des décisions
> annulées depuis. Il dit ce qu'on a pensé ce jour-là, pas ce que le code fait
> aujourd'hui : pour ça, `ARCHITECTURE.md` et `README.md` font foi.

# Pipeline 5 familles · Argent · Fiche client · Porte d'entrée unique

**Date :** 2026-07-28
**Projet :** Planning OLDA
**Statut :** validé (brainstorming), prêt pour le plan d'implémentation

## Problème

Demande du patron, en un seul jet. Quatre chantiers indépendants mais livrés ensemble :

1. La barre latérale gauche ne correspond plus à la réalité de l'atelier : il veut
   **5 grandes familles** avec la liste d'étapes exacte qu'il a écrite.
2. Un projet ne porte **qu'un seul prix**, sans distinction HT / TTC, et **aucun suivi de
   paiement** (acompte demandé, acompte versé, montant, mode).
3. Le **délai** est facultatif : des lignes vivent au planning sans date butoir.
4. Trois portes d'entrée cohabitent (Nouveau Projet, Demande, Commande, plus un bouton
   « Nouvelle commande » qui crée une ligne vide). Il n'en veut plus qu'**une**.
   S'y ajoute une fiche client PRO incomplète (pas d'adresse, ville/pays/code postal
   saisis à la main, liste de secteurs figée dans le code).

## Arbitrages tranchés avec le patron

- « À commander » et « Attente marchandise » sont **conservés** dans Préparation (l'onglet
  « À commander » de la barre du haut continue de fonctionner).
- Le prix de référence est le **TTC saisi**, le **HT est calculé** (÷ 1 + TGCA).
- Nouveau Projet **reste tel qu'il est** ; Demande et Commande sont **supprimés pour de bon**.
- Le délai : raccourcis **et** date précise, aucun pré-coché, enregistrement bloqué sans choix.

---

## 1. Pipeline — 5 familles

### Nouveau modèle

`FAMILIES` (db.js + miroir app.js) :

| Ordre | slug | Libellé |
|---|---|---|
| 1 | `demande_chiffrage` | Demande & chiffrage |
| 2 | `preparation` | Préparation du projet |
| 3 | `production` | Production |
| 4 | `facturation` | Facturation & remise au client |
| 5 | `paiement` | Paiement & clôture |

`SPECIAL` : `fiverr` (inchangé, épinglé en bas, promu en onglet).

`SUB_STAGES` :

```
demande_chiffrage:
  demande_recue         Demande reçue
  demande_a_qualifier   Demande à qualifier
  a_chiffrer            À chiffrer                              (slug conservé)
  chiffrage_en_cours    Chiffrage en cours                      (slug conservé)
  devis_envoye          Tarif / Devis envoyé – Attente client
  devis_valide          Devis validé

preparation:
  prepa_produits        Préparation des produits
  prepa_bat             Préparation du BAT
  bat_envoye            BAT envoyé – Attente validation
  bat_valide            BAT validé
  validation_acompte    Validation acompte / Conditions de paiement
  a_commander           À commander                             (slug conservé, onglet)
  attente_marchandise   Attente marchandise                     (slug conservé)
  pret_a_produire       Prêt à produire                         (slug conservé)

production:
  prod_dtf              Production DTF                          (slug conservé)
  decoupe_dtf           Découpe & Contrôle DTF                  (nouveau)
  prod_pressage         Pressage                                (slug conservé)
  prod_trotec           Production Trotec                       (slug conservé)
  prod_uv               Production UV                           (slug conservé)
  montage_finition      Montage / Finition                      (slug conservé)
  controle_emballage    Contrôle & Emballage                    (slug conservé)

facturation:
  facturation_a_faire   Facturation à faire                     (slug conservé)
  client_a_prevenir     Client à prévenir
  client_prevenu        Client prévenu – Attente retrait
  commande_recuperee    Commande récupérée

paiement:
  paiement_a_controler  Paiement à contrôler
  paiement_valide       Paiement validé / Soldé
  archive               Archivé
```

`a_commander` et `attente_marchandise` se placent **entre `validation_acompte` et
`pret_a_produire`** : on valide l'acompte, on commande la marchandise, on la reçoit, on est
prêt à produire.

Contrainte de conception conservée : **les slugs de sous-étape sont globalement uniques**
(`SUB_TO_FAMILY` s'en sert pour réparer les lignes orphelines). `archive` devient une
sous-étape de `paiement` alors que c'était une famille — l'ancien slug de famille disparaît,
donc aucune collision.

### Migration des lignes existantes

Une seule exécution, garde `app_meta.stage_model_v3 = '1'` — une clé SÉPARÉE de
`stage_model`, qui doit garder la valeur `'families'` : sinon la bascule précédente se
rejouerait à chaque démarrage et son `UPDATE … WHERE stage = 'facturation'` écraserait la
sous-étape de toutes les lignes en facturation. Table de correspondance :

| Ancien `stage` / `sub_stage` | Nouveau `stage` / `sub_stage` |
|---|---|
| `demande` / (tout) | `demande_chiffrage` / `demande_recue` |
| `chiffrage` / `null` | `demande_chiffrage` / `a_chiffrer` |
| `chiffrage` / `a_chiffrer` | `demande_chiffrage` / `a_chiffrer` |
| `chiffrage` / `chiffrage_en_cours` | `demande_chiffrage` / `chiffrage_en_cours` |
| `chiffrage` / `devis_a_envoyer` | `demande_chiffrage` / `devis_envoye` |
| `attente_client` / (tout) | `demande_chiffrage` / `devis_envoye` |
| `preparation` / `prepa_fichiers` | `preparation` / `prepa_produits` |
| `preparation` / `a_commander` | inchangé |
| `preparation` / `attente_marchandise` | inchangé |
| `preparation` / `pret_a_produire` | inchangé |
| `preparation` / `null` | inchangé (« à préciser » est une position valide) |
| `production` / (toutes) | inchangé |
| `facturation` / `facturation_a_faire` | inchangé |
| `facturation` / `pret_retrait` | `facturation` / `client_prevenu` |
| `facturation` / `null` | inchangé |
| `termine` / `attente_paiement` | `paiement` / `paiement_a_controler` |
| `termine` / `solde` | `paiement` / `paiement_valide` |
| `termine` / `null` | `paiement` / `paiement_a_controler` |
| `archive` / (tout) | `paiement` / `archive` |
| `fiverr` | inchangé |

**Down** (documenté, non automatisé — comme la bascule précédente) : appliquer la table à
l'envers, `demande_chiffrage/{demande_recue, demande_a_qualifier}` → `demande/null`,
`demande_chiffrage/devis_envoye` → `attente_client/null`, puis
`DELETE FROM app_meta WHERE key = 'stage_model_v3'`.

Aucune ligne ne change de main : une ligne qui n'entre dans aucun cas garde son couple
tel quel, et la réparation des orphelines (`SUB_TO_FAMILY`) la replace à la première lecture.

### Ce qui suit le changement de slugs

- `public/app.js` : miroir `FAMILIES`/`SUB_STAGES`, `PRICE_VISIBLE_STAGES`
  (→ `demande_chiffrage`, `facturation`, `paiement`), `PROMOTED` (`a_commander` reste
  rattaché à `preparation`).
- `public/dashboard.js` : `ACTIVE_FAMILIES` (→ les 4 premières familles), libellés
  « prochaine action » par sous-étape, et le passage automatique en fin de parcours
  (`stage = 'termine'` → `stage = 'paiement'`, `sub_stage = 'paiement_a_controler'`).
- `public/guide.js` : `STEP_GUIDE` est indexé par slug — les entrées sont ré-indexées sur
  les nouveaux slugs et complétées pour les étapes créées (`demande_a_qualifier`,
  `prepa_bat`, `bat_envoye`, `bat_valide`, `validation_acompte`, `decoupe_dtf`,
  `client_a_prevenir`, `commande_recuperee`, `paiement_a_controler`, `paiement_valide`).
  Une entrée absente n'affiche simplement pas de guide : pas de régression bloquante.
- `app_meta.category_owners` / `category_referents` (pilote et référents par défaut, clé =
  slug) : les 5 sous-étapes simplement renommées voient leur réglage reporté sur le nouveau
  slug. Les anciennes FAMILLES fusionnées ne le sont pas — trois réglages ne peuvent pas
  fusionner sans en écraser deux, le patron retranche lui-même.
- Tests existants qui nomment des slugs : `test/repair-orphan-stages.test.js`,
  `test/priority.test.js`, `test/projet.test.js`, `test/dashboard-person-view.test.js`,
  `test/price-block.test.js`.

---

## 2. Prix HT / TTC

### Modèle

`requests.project_value` **est le TTC**. Aucune migration de données : c'est déjà ce que
`POST /api/projets` y écrit (`projet.prixTotalTtc`). Le HT n'est **jamais stocké** — il se
calcule à l'affichage : `HT = TTC / (1 + TGCA)`.

Le taux TGCA vient des réglages existants (`GET /api/tarifs-tasse/parametres`, `tgca`,
0,04 par défaut), jamais d'une constante en dur. `app.js` le charge une fois au démarrage
et retombe sur 0,04 si l'appel échoue.

### Affichage

- **Grille** : l'en-tête de colonne devient « Prix TTC » ; la cellule garde la saisie
  actuelle (virgule acceptée) et affiche le HT calculé en dessous, en petit et discret.
- **Tiroir de détail**, section Suivi : le champ « Prix (€) » devient « Prix TTC (€) »,
  suivi d'une ligne en lecture seule « HT : 230,77 € ».
- **Nouveau Projet**, barre de total : « Total TTC » inchangé en gros, avec « dont HT »
  en dessous. Le calcul de marge existant, qui dérivait déjà le HT du TTC, ne change pas.

---

## 3. Suivi du paiement

### Modèle

Cinq colonnes additives sur `requests`, toutes nullables, aucune valeur par défaut
contraignante :

| Colonne | Type | Sens |
|---|---|---|
| `acompte_demande` | boolean | l'acompte a été demandé au client |
| `acompte_verse` | boolean | l'acompte a été encaissé |
| `acompte_montant` | numeric(12,2) | la somme exacte encaissée |
| `paye` | boolean | projet soldé |
| `paiement_mode` | text | `cb` / `especes` / `virement` / `cheque` |

Up : `ALTER TABLE requests ADD COLUMN IF NOT EXISTS …` (boucle typée, à côté de la boucle
`text` existante). Down : `DROP COLUMN IF EXISTS` sur les cinq — aucune contrainte, aucune
dépendance, suppression sans effet de bord.

Les cinq champs rejoignent `PATCHABLE` dans `server.js` avec leur validation
(booléen strict, montant ≥ 0 arrondi au centime, mode dans la liste fermée).

`catalog.json` → `commande.paiementModes` passe de 2 à 4 entrées : CB, Espèces, Virement,
Chèque. (Rappel : `catalog.json` est lu une seule fois au démarrage du serveur.)

### Interface

Un bloc **Paiement** identique aux deux endroits :

- trois interrupteurs : *Acompte demandé* · *Acompte versé* · *Payé / soldé* ;
- un champ **montant (€)** qui n'apparaît que si « Acompte versé » est allumé ;
- le **mode** en boutons (CB / Espèces / Virement / Chèque).

Emplacements : section dédiée du tiroir de détail (juste après Suivi), et dans Nouveau
Projet à la place de l'actuel segment « Paiement » à 3 états. `POST /api/projets` accepte
et enregistre les cinq champs.

---

## 4. Délai obligatoire

Dans Nouveau Projet :

- `state.delai` démarre à `null` — **aucun raccourci pré-coché** (aujourd'hui `j5`).
- Une 6ᵉ tuile « Date précise » ouvre un `<input type="date">` (minimum : aujourd'hui).
- **« Enregistrer » reste désactivé** tant qu'aucun délai n'est choisi, au même titre qu'un
  panier vide. Le motif du blocage est écrit à l'écran, pas seulement deviné.
- Une date précise n'applique **aucune majoration** (les raccourcis Jour J / 3 jours
  gardent les leurs).

Côté serveur, `buildProjet` :

- accepte `deadline` (`aaaa-mm-jj`, validé par `isDay`) **ou** `delai` (id de raccourci) ;
- **rejette en 400** (« le délai est obligatoire ») si aucun des deux n'est fourni — le
  défaut `DELAI_DEFAUT` silencieux disparaît ;
- une date précise donne `majoration = 0` et `deadline` = la date reçue.

---

## 5. Fiche client

### 5.1 Le tiret « je n'ai pas l'info »

Dans le formulaire de création de Nouveau Projet, un champ dont la valeur est `-` compte
comme **rempli** (l'étape passe) et part **vide** au serveur (donc `null` en base).

Exception : `entreprise`, `nom`, `prenom` — l'identité ne peut pas être un tiret, sinon on
crée un client nommé « - » qu'on ne retrouvera jamais.

Le champ WhatsApp demande un traitement à part : son formateur de numéro
(`formatPhoneAsTyped`) ne garde que les chiffres et effaçait donc le tiret à la frappe,
rendant ce champ le seul impossible à marquer « je n'ai pas l'info ». Il laisse désormais
passer un tiret seul.

### 5.2 Casse automatique

Au sortir du champ (`blur`), dans le formulaire de Nouveau Projet **et** dans la fiche
Base clients :

- `prenom` et `referent_prenom` → première lettre de chaque mot en majuscule
  (`jean-marc` → `Jean-Marc`, séparateurs espace, tiret et apostrophe) ;
- `nom` → tout en majuscules (`dupont` → `DUPONT`).

Corriger à la main après coup reste possible : le formatage ne s'applique qu'en quittant le
champ, jamais pendant la frappe.

### 5.3 Champs PRO

Nouveau champ `adresse` : la colonne existe déjà en base (`schema.sql`) mais n'était ni
acceptée par l'API ni affichée. Ajout à `CLIENT_MAX` (200) dans `server.js` et à `FIELDS`
dans `clients.js`.

`raison_sociale` est ré-étiqueté « **Raison sociale EBP** ».

`PRO_FIELDS` dans l'ordre demandé :

```
entreprise · raison_sociale · adresse · ville · pays · code_postal
· zone · secteur · referent_prenom · telephone · email
```

`PERSO_FIELDS` inchangé (prenom · nom · telephone · email).

### 5.4 Ville → Pays + Code postal

`ville` devient une liste déroulante à saisie libre (input + datalist, le patron du champ
`zone`/`secteur` déjà en place) :

```
SAINT-MARTIN · SINT MAARTEN · SAINT-BARTHÉLEMY · ANGUILLA · GUADELOUPE · MARTINIQUE
```

Choisir une ville **remplit Pays et Code postal** :

| Ville | Pays | Code postal |
|---|---|---|
| SAINT-MARTIN | France | 97150 |
| SINT MAARTEN | Sint Maarten | *(vide — l'île n'utilise pas de code postal)* |
| SAINT-BARTHÉLEMY | France | 97133 |
| ANGUILLA | Anguilla | AI-2640 |
| GUADELOUPE | France | 97100 |
| MARTINIQUE | France | 97200 |

Règle de non-écrasement : le remplissage n'a lieu que si le champ cible est **vide** ou
s'il contient **encore la valeur posée automatiquement par la ville précédente**. Une
valeur tapée à la main n'est jamais écrasée. Les deux champs restent modifiables.

Une ville hors liste (saisie libre) ne déclenche aucun remplissage.

### 5.5 Secteurs d'activité modifiables

La liste `SECTEURS_SUGGERES`, aujourd'hui figée dans `clients.js`, devient une liste
**persistée et modifiable**, sur le modèle exact des emplacements de marquage
(`app_meta.commande_zones`) :

- stockage : `app_meta.client_secteurs` (tableau JSON de libellés) ;
- amorçage : à la première lecture, si la clé n'existe pas, elle est écrite avec les 20
  secteurs actuels — la liste connue n'est pas perdue ;
- API : `GET /api/clients/secteurs`, `POST /api/clients/secteurs { label }` (idempotent
  sur le libellé normalisé), `DELETE /api/clients/secteurs/:label` ;
- interface : un bouton **Secteurs** dans l'en-tête de Base clients ouvre un panneau —
  la liste en pastilles avec une croix chacune, plus un champ d'ajout. Le bouton porte sa
  propre classe (`cl-tool`) et non celle des boutons de tri : la délégation de clic teste
  `.cl-sort__btn` en premier et aurait avalé le clic ;
- les datalists des deux formulaires (Base clients et Nouveau Projet, chargés
  indépendamment) s'abonnent à la liste : un ajout apparaît dans les deux sans recharger.

Un secteur retiré de la liste **ne disparaît pas des fiches** qui le portent : la valeur est
recopiée dans `clients.secteur`, jamais relue dans la liste.

### 5.6 Pro ↔ Perso

**Déjà en place** : la fiche Base clients porte un segment « Nature »
(Professionnel / Revendeur / Association / Particulier) qui bascule le client et
re-rend le bon jeu de champs. Rien à construire — à vérifier au passage, pas à refaire.

---

## 6. Porte d'entrée unique

### Ce qui disparaît

- Onglets **Demande** (`#demande`) et **Commande** (`#commande`) de la barre du haut.
- Bouton **« Nouvelle commande »** (`#btnNew`) et `createForCurrentView()` : la création
  d'une ligne vide directement dans une étape du planning n'existe plus.
- `public/commande.js`, `public/commande.css`, les sections `#demande` / `#commande` de
  `index.html`, le routage correspondant dans `app.js`.
- Côté serveur : `POST /api/commande`, `buildCommande` et les constructeurs qui ne servent
  qu'à lui (`buildTextile`, `buildTasse`, `buildObjet`, `detailLigne`, `nomLigne`), les
  routes de zones (`POST`/`DELETE /api/commande/zones`) et leurs aides `db.js`, ainsi que
  les entrées de `catalog.json` devenues sans lecteur.
- Tests de la prise de commande supprimée (`test/commande.test.js`,
  `test/commande-zones.test.js`) ; `test/destination-whatsapp.test.js` et
  `test/price-block.test.js` sont ré-écrits sur `POST /api/projets` si leur objet de test
  survit.

`GET /fiche` (redirection historique) pointe désormais vers `#nouveau-projet`.

### Ce qui reste, impérativement

- `buildClient` : partagé avec `buildProjet`, il reste.
- Le **pipeline** servi au poste de saisie. À l'implémentation, `GET
  /api/commande/catalog` s'est révélé n'avoir plus qu'un seul lecteur (`loadPipeline` dans
  `projet.js`, qui n'en lisait que `pipeline`) : il est donc remplacé par
  `GET /api/pipeline`, qui renvoie directement les familles et leurs sous-étapes. Les
  délais et modes de paiement restent lus côté serveur depuis `catalog.json`.
- **La lecture des `fiche` déjà en base** : les commandes enregistrées par l'ancien écran
  portent un JSON produit par `buildCommande`, que le tiroir de détail reconstitue
  (`ficheItems()`). Ce code de **lecture** n'est pas touché — on supprime la saisie, pas
  l'historique.

Chaque suppression est vérifiée par recherche (`grep`) avant retrait : un module encore
référencé n'est pas supprimé, il est nettoyé.

---

## 7. Tests

- `test/projet.test.js` : délai obligatoire (400 sans délai ni date), date précise acceptée
  et sans majoration, champs de paiement enregistrés.
- `test/clients.test.js` : `adresse` acceptée par `POST`/`PATCH /api/clients` ; les trois
  routes de secteurs (lecture amorcée, ajout idempotent, retrait).
- Nouveau `test/pipeline-migration.test.js` : la table de correspondance appliquée à un jeu
  de lignes de l'ancien modèle donne exactement les couples attendus, et une deuxième
  exécution ne rebouge rien (idempotence de la garde `app_meta`).
- `test/repair-orphan-stages.test.js`, `test/priority.test.js`,
  `test/dashboard-person-view.test.js` : mis à jour sur les nouveaux slugs.
- Vérification en navigateur (serveur local, **jamais Railway avant validation du patron**) :
  les 5 familles et leurs compteurs, la migration sur une base amorcée, le blocage du délai,
  le bloc paiement, le remplissage ville → pays / code postal, et la disparition propre des
  onglets supprimés.

## 8. Livraison

Une seule branche, trois lots successifs, une seule PR :

1. **Pipeline** — 5 familles, migration, guide, dashboard, tests.
2. **Argent** — HT/TTC, bloc paiement, délai obligatoire.
3. **Client & porte d'entrée** — fiche PRO enrichie, secteurs persistés, suppression de
   Demande / Commande.

Rien n'est déployé sur Railway tant que le patron n'a pas validé en local.

## Hors scope (explicite)

- **Facturation EBP** : « Raison sociale EBP » est un libellé de champ, pas une
  intégration avec le logiciel.
- **Historique des paiements** : un projet porte l'état courant (acompte, solde, mode),
  pas un journal d'écritures multiples.
- **Fiverr** : la famille spéciale et son onglet ne sont pas touchés — absente de la liste
  du patron, mais toujours utilisée.
- **Obligation de délai sur les lignes existantes** : la règle s'applique à la création.
  Les lignes déjà au planning sans échéance ne sont pas bloquées rétroactivement.
