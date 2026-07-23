# Stock — Socle (fiche article, variantes, niveaux, alertes) — Design

**Date :** 2026-07-23
**Projet :** Planning OLDA
**Statut :** validé (brainstorming), prêt pour le plan d'implémentation
**Phase :** 1/7 du module Stock (le Socle). Les phases suivantes ont leurs propres specs.

## Problème / contexte

L'atelier veut « ne jamais être en rupture tout en immobilisant le moins de stock
possible ». Aujourd'hui le CRM Planning OLDA **n'a aucun référentiel article/stock** :
les produits sont du texte libre sur les commandes (`requests.product` + `requests.fiche`)
et `catalog.json` n'est que du vocabulaire.

Il existe une app séparée **`catalogue-olda`** (projet Railway `Projet-Stock-OLDA`) qui gère
un stock, mais :
- elle ne contient **que des objets/tasses** (168 produits : accessoires, mugs, coques,
  porte-clés, gourdes, emballages, consommables) — **aucun textile** ;
- son modèle est **plat** : `couleur` = texte souvent vide, **aucune notion de taille** ;
- ses features avancées (commandes fournisseur, mouvements, inventaire) sont **échafaudées
  mais inutilisées** (4 commandes en brouillon, 0 mouvement, 0 inventaire).

Or le cœur du besoin est **textile** : une référence (ex. NS300) déclinée en **couleurs**
(Noir, Blanc, Navy…) puis en **tailles** (S → 5XL), chaque taille ayant son prix, son
fournisseur, son code-barres, son stock. `catalogue-olda` ne sait pas faire ça.

**Décision (voir mémoire projet `stock-unification`) :** construire **un seul système de
stock unifié dans le CRM**, avec un **modèle variant universel** qui couvre le textile
(grille couleur×taille) **et** les objets/tasses (variante unique), puis **importer** les
données de `catalogue-olda` dedans et retirer `catalogue-olda` à terme (comme la Base
clients l'a été).

## Décisions de design (issues du brainstorming)

1. **Modèle variant universel** : `article → variantes`. Une variante = article × couleur
   × taille (couleur et/ou taille peuvent être absentes). Textile → grille ; mug → variante
   unique. Un seul modèle, aucune refonte quand on ajoute un type de produit.
2. **Attributs « par taille » sur la variante** : prix d'achat, prix moyen, prix de vente,
   fournisseur/code fournisseur, code-barres, poids, emplacement, actif/arrêté, **et tous
   les niveaux de stock** vivent sur la **variante** (chaque taille peut différer, comme le
   demande le cahier des charges §2 & §4).
3. **Consommables dans le même modèle** (`type = 'consommable'`, variante unique) ; leurs
   champs spécifiques (machine, unité, largeur/longueur) dans `attributs` (jsonb).
4. **Périmètre autonome** : pas de branchement sur la prise de commande / passage en prod
   au socle (réservation/déduction = phase finale). `qte_reservee` existe mais reste à 0.
5. **Jamais de mutation de stock sans trace** : toute variation de `qte_stock` passe par un
   **mouvement** (`stock_moves`), qui sert aussi de base au prix moyen pondéré (PMP) et à
   l'historique.
6. **Champs dérivés jamais stockés** : disponibilités et alertes sont **calculées** à la
   volée par l'API (jamais dénormalisées en base).

## Modèle de données

Conventions du CRM respectées : **PK `uuid`** (`gen_random_uuid()`), `timestamptz` avec
`now()`, tables ajoutées à `schema.sql` (idempotent `CREATE TABLE IF NOT EXISTS`), colonnes
ajoutées via la boucle `ADD COLUMN IF NOT EXISTS` de `db.js init()`, **compatible pg-mem**
(pas de `array_agg`/`json_agg` : on regroupe en JavaScript ; pas d'index d'expression).

### `stock_articles` — la référence, créée une seule fois

```sql
CREATE TABLE IF NOT EXISTS stock_articles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference     text,                              -- ex. NS300 ; peut être vide (objet)
  designation   text NOT NULL,
  type          text NOT NULL DEFAULT 'objet',     -- textile | objet | consommable
  marque        text,
  famille       text,
  sous_famille  text,
  genre         text,                              -- homme | femme | enfant | unisexe (textile)
  fournisseur   text,                              -- fournisseur par défaut de l'article
  collection    text,
  matiere       text,
  grammage      text,
  note          text,
  best_seller   smallint NOT NULL DEFAULT 0,       -- 0..3 étoiles (pilote le réappro, phase 5)
  actif         boolean  NOT NULL DEFAULT true,    -- false = produit arrêté (§10)
  photo         bytea,  photo_mime text,           -- photo par défaut de l'article
  photo_thumb   bytea,  photo_thumb_mime text,     -- miniature (listes)
  attributs     jsonb   NOT NULL DEFAULT '{}',     -- extras selon type (consommable: machine, unite, largeur_cm, longueur_m)
  position      double precision,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_articles_type    ON stock_articles (type);
CREATE INDEX IF NOT EXISTS idx_stock_articles_famille ON stock_articles (famille);
CREATE INDEX IF NOT EXISTS idx_stock_articles_marque  ON stock_articles (marque);
```

### `stock_variants` — la SKU (article × couleur × taille)

```sql
CREATE TABLE IF NOT EXISTS stock_variants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id       uuid NOT NULL,                 -- -> stock_articles.id (cascade applicative)
  couleur          text NOT NULL DEFAULT '',      -- '' si non décliné (voir « dimensions vides »)
  taille           text NOT NULL DEFAULT '',
  code_fournisseur text,
  code_barre       text,
  poids            numeric,                        -- grammes
  prix_achat       numeric,                        -- dernier prix d'achat connu
  prix_moyen       numeric,                        -- PMP, recalculé par stock_moves
  prix_vente       numeric,
  emplacement      text,                           -- rayon / étagère / bac
  actif            boolean NOT NULL DEFAULT true,  -- variante arrêtée
  photo            bytea, photo_mime text,         -- override optionnel de la photo article
  qte_stock        numeric NOT NULL DEFAULT 0,     -- stock physique (modifié UNIQUEMENT via un mouvement)
  qte_reservee     numeric NOT NULL DEFAULT 0,     -- réservé (phase 7 ; 0 au socle)
  stock_min        numeric NOT NULL DEFAULT 0,
  stock_ideal      numeric NOT NULL DEFAULT 0,
  stock_max        numeric NOT NULL DEFAULT 0,
  position         double precision,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_variant UNIQUE (article_id, couleur, taille)
);
CREATE INDEX IF NOT EXISTS idx_stock_variants_article ON stock_variants (article_id);
```

**Dimensions vides :** couleur/taille absentes sont stockées `''` (chaîne vide), **jamais
`NULL`** — sinon la contrainte `UNIQUE` ne détecte pas les doublons (`NULL != NULL` en SQL)
et pg-mem gère mal les index d'expression. La validation d'entrée normalise `null`/absent → `''`.

### `stock_lists` — listes éditables (vocabulaire)

Reprend le principe des `param_lists` de `catalogue-olda`.

```sql
CREATE TABLE IF NOT EXISTS stock_lists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL,          -- marque|famille|sous_famille|genre|fournisseur|collection|matiere|taille|couleur|emplacement|transport
  value      text NOT NULL,
  parent     text,                   -- ex. sous_famille rattachée à une famille
  position   double precision NOT NULL DEFAULT 0,
  hidden     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_stock_list UNIQUE (kind, value)
);
CREATE INDEX IF NOT EXISTS idx_stock_lists_kind ON stock_lists (kind);
```

### `stock_moves` — journal des mouvements

```sql
CREATE TABLE IF NOT EXISTS stock_moves (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id       uuid NOT NULL,                 -- -> stock_variants.id (cascade applicative)
  sens             text NOT NULL,                 -- entree | sortie | ajustement | inventaire | import
  qte              numeric NOT NULL,              -- quantité du mouvement (toujours > 0 ; le sens porte le signe)
  prix_unitaire    numeric,                        -- prix d'achat unitaire (sens=entree/import) pour le PMP
  personne         text,
  note             text,
  stock_avant      numeric,
  stock_apres      numeric,
  prix_moyen_avant numeric,
  prix_moyen_apres numeric,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_moves_variant ON stock_moves (variant_id, created_at);
```

**Recalcul du PMP** (sur `entree`/`import` avec `prix_unitaire`) :
`pmp_apres = (stock_avant × pmp_avant + qte × prix_unitaire) / (stock_avant + qte)`, en se
protégeant du dénominateur nul (si `stock_avant + qte = 0` → PMP inchangé). Une `sortie`/`ajustement`
ne change pas le PMP. Le mouvement écrit toujours `stock_avant/apres` et `prix_moyen_avant/apres`
pour un historique auto-portant.

## Champs calculés (API, jamais stockés)

Exposés sur chaque variante, et agrégés au niveau article :

- `dispo_immediat = qte_stock − qte_reservee`
- `en_commande`, `en_transit` : **0 au socle**, alimentés par l'Approvisionnement (phase 2)
  en sommant les lignes de commandes fournisseur non encore reçues.
- `dispo_futur = dispo_immediat + en_commande + en_transit` (le « 5 aujourd'hui + 40 en
  bateau = 45 » du §7).
- `valeur_stock = qte_stock × (prix_moyen | prix_achat | 0)`

### Alerte (§5) — fonction pure, par ordre de précédence

```
1. article.actif = false  OU  variant.actif = false   → ⚫ Arrêté       (arrete)
2. (dispo_immediat ≤ 0 OU dispo_immediat < stock_min) ET (en_commande + en_transit) > 0
                                                       → 🔵 Déjà commandé (commande)
3. dispo_immediat ≤ 0                                  → 🔴 Rupture      (rupture)
4. dispo_immediat < stock_min                          → 🟠 À commander  (a_commander)
5. sinon                                               → 🟢 Suffisant    (suffisant)
```

Au socle (sans appro, `en_commande = en_transit = 0`), seuls ⚫/🔴/🟠/🟢 apparaissent ; le
🔵 s'active en phase 2. Couleurs alignées sur les tokens (`--primary` etc.) — définies en CSS,
pas en base. L'**alerte d'un article** = la plus grave de ses variantes actives.

## API

Base `/api/stock/*`. Handlers `asyncH`, validateurs whitelist, SQL **paramétré**, `broadcast({ kind: 'stock', ... })` après chaque mutation. Suppressions = **cascade applicative** (enfants d'abord), comme `attachments`/`production_sectors`.

**Articles**
- `GET  /api/stock/articles` — filtres `?search=&type=&famille=&marque=&genre=&alerte=&actif=`.
  Réponse : liste d'articles avec **résumé variantes** (nb variantes, `qte_stock` total,
  `valeur_stock` total, `alerte` la plus grave). Regroupement variantes→articles **en JS**.
- `GET  /api/stock/articles/:id` — article **+ toutes ses variantes** (avec champs calculés).
- `POST /api/stock/articles` — crée l'article (+ variantes initiales optionnelles dans le
  même corps ; pour le textile, possibilité de générer la grille couleurs×tailles d'un coup).
- `PATCH  /api/stock/articles/:id`
- `DELETE /api/stock/articles/:id` — supprime variantes + mouvements puis l'article.

**Variantes**
- `POST   /api/stock/articles/:id/variants` — ajoute une variante (couleur/taille).
- `PATCH  /api/stock/variants/:id` — édite prix, mini/idéal/maxi, emplacement, code-barres,
  poids, actif… **mais pas `qte_stock` ni `prix_moyen`** (dérivés des mouvements).
- `DELETE /api/stock/variants/:id` — supprime la variante + ses mouvements.
- `POST   /api/stock/variants/:id/move` — **seul** moyen de changer le stock. Corps
  `{ sens, qte, prix_unitaire?, note?, personne? }` : écrit un `stock_move`, met à jour
  `qte_stock` (+ `prix_moyen` si entrée), renvoie la variante recalculée.

**Photos** (bytea, comme `catalogue-olda`)
- `PUT|GET|DELETE /api/stock/articles/:id/photo` (+ génération miniature).
- `PUT|GET|DELETE /api/stock/variants/:id/photo`.
- Upload en `express.raw` (limite ~12 Mo, comme les PDF), stocké binaire + `photo_mime`.

**Listes**
- `GET /api/stock/lists` — toutes les entrées, groupées par `kind`.
- `POST /api/stock/lists` · `PATCH /api/stock/lists/:id` · `DELETE /api/stock/lists/:id`.

## Import depuis `catalogue-olda`

**Mécanisme :** un script one-shot **`scripts/import-catalogue-olda.js`** (Node + `pg`),
idempotent (garde-fou via `app_meta.stock_imported`), lancé **une fois au moment de la
bascule**. Il lit la base source via `CATALOGUE_OLDA_DATABASE_URL` (URL publique du proxy
Railway) et écrit dans la base cible `DATABASE_URL`. Les photos (`bytea`) sont copiées
binaire — **pas** de fichier seed JSON (éviterait de gonfler le repo avec des Mo de photos).

Pour le dev/tests (pg-mem, base vide), une petite fonction `seedStock()` insère **quelques
articles de démo** dont au moins une **grille textile** (ex. NS300 en 3 couleurs × 6 tailles)
et un mug mono-variante — même esprit que le `seed()` existant.

### Correspondance des champs

| `catalogue-olda`.`products` | → | Socle |
|---|---|---|
| `reference` | → | `stock_articles.reference` |
| `designation` | → | `stock_articles.designation` |
| `categorie`='Consommables' | → | `type='consommable'`, sinon `type='objet'` |
| `categorie` / `famille` | → | `stock_articles.famille` (+ upsert dans `stock_lists`) |
| `sous_famille` | → | `stock_articles.sous_famille` |
| `fournisseur`, `matiere` | → | idem (article) |
| `etat` ∈ {`a_arreter`,`archive`} | → | `actif=false` |
| `etat`=`best_seller` | → | `best_seller=3` |
| `etat`=`nouveaute` | → | `attributs.nouveaute=true` |
| `photo`,`photo_mime`,`photo_thumb` | → | photos article |
| `conditionnement`,`transport`,`delai_appro`,`lien_commande` | → | `attributs.*` |
| **variante unique** : `couleur` | → | `stock_variants.couleur` (souvent `''`) ; `taille=''` |
| `prix_achat`,`prix_moyen`,`prix_vente` | → | idem (variante) |
| `qte_stock` | → | `qte_stock` **via un mouvement `sens='import'`** (traçabilité) |
| `stock_min`,`stock_ideal`,`emplacement` | → | idem (variante) |
| `catalogue-olda`.`consommables` (30) | → | articles `type='consommable'` ; `machine`,`unite`,`largeur_cm`,`longueur_m` → `attributs` |
| `catalogue-olda`.`param_lists` | → | `stock_lists` (kinds `famille`,`sous_famille`,`emplacement`,`transport`,`technique`,`machine`) |

**Amorçage textile :** créer dans `stock_lists` les nouveaux `kind` absents de la source —
`marque` (Native Spirit, Kariban, ProAct…), `genre` (homme/femme/enfant/unisexe), `taille`
(S, M, L, XL, 2XL, 3XL, 4XL, 5XL, Taille unique), `couleur` (Noir, Blanc, Navy, Sand,
Paprika…), `collection`. Aucun article textile n'est importé (il n'en existe pas).

## Frontend

SPA vanilla, tokens existants (`--primary #5b83c9`, thème sombre, Material Symbols).

- **Routing** : ajouter `#stock` à `VIEWS` (`app.js`) ; bouton d'onglet dans la barre du
  haut (`index.html`) ; module **lazy-loadé** `public/stock.js` + `public/stock.css`.
- **Liste articles** : barre de recherche + filtres (type, famille, marque, genre, alerte,
  actif). Chaque ligne : désignation, référence, famille/marque, **stock total**, **pastille
  d'alerte** (la plus grave), valeur. Clic → fiche.
- **Fiche article** :
  - En-tête éditable (classement §3, best-seller, actif/arrêté, photo).
  - **type=textile** → **grille couleur (lignes) × taille (colonnes)** ; chaque cellule =
    une variante, montre `qte_stock` colorée par alerte ; clic → panneau d'édition
    (stock via mouvement, mini/idéal/maxi, prix, code-barres, poids, emplacement, actif).
    Boutons « ajouter une couleur » / « ajouter une taille » (génèrent les variantes).
  - **type=objet/consommable** → **liste de variantes** (souvent une seule), mêmes champs.
- **Édition du stock** : toute saisie de quantité ouvre un mouvement (`sens`, qté, prix,
  note) — jamais d'écriture directe. Feedback optimiste puis confirmation SSE.
- **Réglages listes** : sous-page pour éditer `stock_lists` (ajout/masquage/réordonnancement).
- **Temps réel** : à réception d'un `change` de `kind: 'stock'`, recharger la vue courante.

Cibles responsive habituelles (iPhone 390–430, desktop, Galaxy Tab A9+ 2 orientations),
cibles tactiles ≥ 44 px, champs à `font-size ≥ 16px`.

## Styles (`stock.css` + tokens globaux)

Pastilles d'alerte (5 états), grille couleur×taille (cellules tactiles, en-têtes collants),
panneau d'édition de variante, badges best-seller (⭐), état arrêté (grisé). Réutiliser les
variables ; ne rien coder en dur.

## Hors Socle (phases suivantes, specs dédiées)

Commandes fournisseur & états « en mer » + alerte délai maritime (2) · import factures PDF +
historique prix fournisseur (2) · tableau de bord stock (3) · inventaire & scan (4) ·
best-seller → réappro conseillé + prévision saisonnière (5) · produits arrêtés → remises/soldes
(6) · réservation auto (devis/acompte) + déduction au passage en prod (7).

## Cas limites

- **Doublon de variante** (même article/couleur/taille) → rejeté par `uq_variant` → `400`.
- **Dimensions vides** normalisées `''` (voir modèle) ; un article mono-variante a
  `couleur='' , taille=''`.
- **Stock négatif** : une `sortie` supérieure au stock est autorisée mais l'API renvoie la
  variante avec `dispo_immediat < 0` (alerte 🔴) ; pas de blocage dur au socle.
- **Réservé > stock** → `dispo_immediat` négatif → 🔴 Rupture.
- **PMP sans historique** : `prix_moyen` = `prix_achat` (fallback) tant qu'aucune entrée
  chiffrée n'a eu lieu.
- **Suppression article** → supprime variantes + mouvements (cascade applicative).
- **Import relancé** → sans effet (garde-fou `app_meta.stock_imported`).

## Vérification

Pas de framework de tests ; on suit le motif `test/*.test.js` (pg-mem + `fetch` sur l'API réelle).

1. **`test/stock.test.js`** : créer un article textile + grille de variantes ; ajouter un
   mouvement d'entrée chiffré et vérifier `qte_stock` **et** le PMP ; vérifier les champs
   calculés (`dispo_immediat`, `alerte`) sur les 4 états socle ; filtres de liste ;
   unicité de variante ; suppression en cascade ; CRUD `stock_lists`.
2. **Vérification visuelle** via le serveur de preview : liste, fiche textile (grille),
   fiche objet, édition stock, pastilles d'alerte, réglages listes — iPhone + desktop + tablette.
3. **Import** : exécuter `scripts/import-catalogue-olda.js` contre une copie/inspection de la
   base `catalogue-olda`, vérifier 168 articles + 30 consommables + listes, photos présentes,
   idempotence au second passage.
