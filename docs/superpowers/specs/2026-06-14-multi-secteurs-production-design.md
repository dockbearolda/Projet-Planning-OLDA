# Multi-secteurs de production — Design

**Date :** 2026-06-14
**Projet :** Planning OLDA
**Statut :** validé (brainstorming), prêt pour le plan d'implémentation

## Problème

Aujourd'hui chaque commande vit dans **une seule** étape (`stage`). Les 6 secteurs de
production (DTF, Pressage, Trotec, Roland UV, Sous-traitance, Autre) sont des étapes
mutuellement exclusives : une commande ne peut être que dans **un** secteur à la fois.

Or une même commande passe souvent par **plusieurs machines** — ex. découpe sur la
Trotec **puis** impression sur la Roland UV. Avec le modèle actuel, impossible de
l'afficher dans les deux secteurs. Le bouton « → Fiverr/Toptex » fait une *copie
indépendante* (deux cartes séparées à gérer), ce qui ne convient pas ici.

**Objectif :** qu'une **seule** commande puisse être affectée à **plusieurs secteurs de
prod** en même temps, de façon ultra simple, pour que rien ne soit oublié quand on
clique sur un secteur.

## Décisions de design (issues du brainstorming)

1. **Modèle « multi-secteurs » (option A)** : la commande apparaît **simultanément** dans
   chaque secteur qui lui reste à faire — pas un parcours séquentiel.
2. **Cocher « fait » fait disparaître la carte de la colonne** de cette machine (option 2) :
   chaque colonne ne montre que ce qui **reste à faire** sur cette machine. Compteur à jour.
3. **Fin de prod = déplacement manuel** : quand toutes les machines sont cochées, la
   commande arrive dans une ligne **« Prête à facturer »**, et l'utilisateur la **glisse
   lui-même** vers Facturation (pas d'auto-déplacement).
4. **Affectation par glisser** : on glisse la carte sur une colonne machine pour lui
   **ajouter** ce secteur. Pas de menu « + secteur ».

## Modèle de données

La production devient **une phase unique** (`stage = 'production'`) ; les machines
deviennent des **secteurs** rattachés à la commande via une table de liaison.

### Nouvelle table

```sql
CREATE TABLE IF NOT EXISTS production_sectors (
  request_id  uuid    NOT NULL,
  sector      text    NOT NULL,           -- un des 6 slugs machine
  done        boolean NOT NULL DEFAULT false,
  position    double precision,           -- ordre d'affichage dans la colonne
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, sector)
);
CREATE INDEX IF NOT EXISTS idx_prodsec_sector  ON production_sectors (sector, done);
CREATE INDEX IF NOT EXISTS idx_prodsec_request ON production_sectors (request_id);
```

Le `PRIMARY KEY (request_id, sector)` empêche d'affecter deux fois la même machine.

### Étapes (phases) vs secteurs

- **Phases** (valeurs possibles de `requests.stage`) :
  `demande`, `devis_en_cours`, `devis_accepte`, **`production`**, `facturation`,
  `archive`, `maquette_fiverr`, `toptex`.
  → Les 6 `prod_*` **ne sont plus** des phases.
- **Secteurs** (`SECTOR_SLUGS`, valeurs possibles de `production_sectors.sector`) :
  `prod_dtf`, `prod_pressage`, `prod_trotec`, `prod_roland_uv`, `prod_sous_traitance`,
  `prod_autre`.

### États dérivés d'une commande en production

- **En attente sur la machine X** : ligne `production_sectors` avec `sector = X` et
  `done = false`.
- **Prête à facturer** : `stage = 'production'` et **aucune** ligne `done = false`
  (toutes les machines faites, ou plus aucun secteur).

### Migration automatique (au démarrage, dans `db.js init()`)

Idempotente. Pour chaque commande dont `stage` est un ancien slug `prod_*` :
1. insérer une ligne `production_sectors (request_id, sector = <ce slug>, done = false)`
   si elle n'existe pas ;
2. passer `stage = 'production'`.

Cela convertit les commandes déjà en prod sans rien perdre, en local (pg-mem) comme sur
Railway.

### Seed (démo)

Mettre à jour le seed pour le nouveau modèle et **illustrer le cas multi-secteurs** :
la commande « Brasserie du Coin » entre en `production` avec **deux** secteurs
(`prod_trotec` + `prod_roland_uv`, non faits). Les autres commandes prod du seed entrent
en `production` avec un seul secteur.

## Comportement côté écran

### Barre latérale (bloc production)

- Les **6 lignes machines** restent visibles, mais deviennent des **vues filtrées** :
  « Prod Trotec » liste les commandes ayant `prod_trotec` **encore à faire**.
  Compteur = nombre de commandes en attente sur cette machine.
- **Nouvelle ligne « Prête à facturer »** juste après les machines : liste les commandes
  `production` dont toutes les machines sont faites. Compteur associé.
- Les lignes hors-prod (Demande, Devis…, Facturation, Archivé, Fiverr, Toptex) :
  inchangées (`WHERE stage = slug`).

### Carte (commande en production)

- Affiche des **chips de secteurs** (ex. `Trotec` `Roland UV`).
  - Chip **bleue** = à faire, chip **verte cochée** = fait.
  - **Tap/clic sur la coche** d'une chip → bascule `done` (la carte quitte la colonne de
    cette machine si on la marque faite depuis cette colonne).
  - Petit **✕** sur la chip → retire ce secteur de la commande.
- Le reste de la ligne (société, produit, couleur, qté, échéance, état, contact, PDF…)
  est inchangé.

### Affecter / glisser

- **Glisser** une carte sur une **colonne machine** → ajoute ce secteur
  (`POST /sectors`) et, si la commande n'était pas encore en production, passe son
  `stage` à `'production'`. La glisser ensuite sur une autre machine ajoute un 2ᵉ secteur.
- **Glisser** une carte sur une **phase** (Facturation, Archivé, Devis…) → comportement
  actuel (`PATCH stage`). En quittant la production, les lignes `production_sectors`
  sont **conservées** (historique) mais n'influencent plus l'affichage (puisque
  `stage != 'production'`).
- Glisser sur la **même** machine deux fois → sans effet (clé primaire).

### Cocher « fait » et fin de prod

- Cocher Trotec → la carte **disparaît de la colonne Trotec** (compteur −1), reste dans
  Roland UV tant que celle-ci n'est pas faite.
- Toutes les machines cochées → la carte apparaît dans **« Prête à facturer »**.
  L'utilisateur la **glisse vers Facturation** quand il veut.
- **Option (phase 2, discrète)** : bouton **« Voir les terminés »** dans l'en-tête d'une
  colonne machine pour réafficher les cartes déjà faites (masquées par défaut). Non
  bloquant pour la v1.

## API

Les endpoints existants restent ; on étend `GET /api/requests`, `GET /api/counts`, et on
ajoute la gestion des secteurs.

- `GET /api/requests?stage=<phase>` — inchangé (phases non-prod).
- `GET /api/requests?sector=<machine>` — commandes `production` ayant ce secteur
  `done = false`, triées par `position`. (`?sector=<machine>&done=1` pour « Voir les
  terminés », phase 2.)
- `GET /api/requests?bucket=ready_billing` — commandes `production` sans aucun secteur
  `done = false` (prêtes à facturer).
- Toutes les réponses `requests` **incluent les secteurs** de chaque commande
  (`sectors: [{ sector, done }]`) pour afficher les chips.
- `GET /api/counts` — réponse restructurée :
  ```json
  {
    "stages":  { "demande": n, "devis_en_cours": n, "...": n,
                 "facturation": n, "archive": n, "maquette_fiverr": n, "toptex": n },
    "sectors": { "prod_dtf": nEnAttente, "prod_trotec": nEnAttente, "...": 0 },
    "ready_billing": n
  }
  ```
- `POST   /api/requests/:id/sectors`        body `{ sector }` → ajoute le secteur
  (+ `stage='production'` si nécessaire).
- `PATCH  /api/requests/:id/sectors/:sector` body `{ done }` → coche / décoche.
- `DELETE /api/requests/:id/sectors/:sector` → retire le secteur.

Chaque opération **diffuse** un événement SSE `change` (temps réel conservé). À la
suppression d'une commande, supprimer aussi ses lignes `production_sectors` (cascade
applicative, comme pour les `attachments`).

### Compatibilité pg-mem

Ne pas dépendre de `array_agg` / `json_agg` (support pg-mem limité). Pour attacher les
secteurs aux commandes : charger les commandes, puis lire les lignes
`production_sectors` concernées et les **regrouper en JavaScript** par `request_id`.
Vu la volumétrie (atelier), c'est négligeable.

## Frontend (app.js)

- `STAGE_GROUPS` : le bloc du milieu liste les 6 **secteurs** (type `sector`) +
  la ligne **« Prête à facturer »** (type `bucket`). Marquer le type de chaque ligne.
- `selectStage` / chargement : router selon le type de ligne — `?stage=`, `?sector=`,
  ou `?bucket=ready_billing`.
- Rendu des compteurs : utiliser la nouvelle structure `counts`.
- Rendu carte : afficher les chips de secteurs (coche + ✕) pour les commandes
  `production`.
- Glisser-déposer (`onDragEnd`) : si la cible est une ligne **secteur** → `addSector` ;
  si c'est une **phase** → `moveToStage` (existant) ; réordonnancement vertical inchangé.
- SSE : à réception d'un `change`, recharger la vue courante + les compteurs (logique
  existante, adaptée aux nouvelles vues).

## Styles (styles.css)

- Chips de secteurs (état à faire / fait), bouton coche, ✕ de retrait.
- Ligne « Prête à facturer » dans la barre latérale.
- (Phase 2) bouton « Voir les terminés ».

## Ce qui ne change pas

Demande / Devis en cours / Devis accepté / Facturation / Archivé / Fiverr / Toptex,
la dictée vocale, les pièces jointes PDF (Devis/BAT), les contacts, le tri par colonnes,
les largeurs de colonnes par catégorie, le glisser-déposer entre phases, l'auth, le SSE.

## Cas limites

- **Entrée en prod sans secteur** : impossible par glisser (le glisser ajoute toujours
  ≥ 1 secteur). Si tous les secteurs sont **retirés** via ✕, la commande reste
  `production` avec 0 secteur → elle apparaît dans « Prête à facturer » (rien à produire).
- **Décocher** un secteur fait → la carte réapparaît dans la colonne machine.
- **Déplacement manuel vers Facturation** alors que des secteurs sont en attente :
  autorisé (l'humain décide) ; les secteurs sont conservés mais n'influencent plus
  l'affichage.
- **Glisser deux fois la même machine** → sans effet (clé primaire).

## Vérification

Le projet n'a pas de framework de tests. Vérification pragmatique :

1. **Smoke tests API** (curl) : créer une commande, l'envoyer en production sur 2
   secteurs, vérifier qu'elle remonte dans les deux vues `?sector=`, cocher un secteur,
   vérifier le retrait + les compteurs, cocher le second, vérifier `?bucket=ready_billing`.
2. **Vérification visuelle** via le serveur de preview (déjà en place) : board, chips,
   colonnes, compteurs, glisser-déposer, ligne « Prête à facturer ».
3. **Migration** : démarrer avec des données contenant d'anciens `stage = 'prod_*'` et
   confirmer la conversion sans perte.
