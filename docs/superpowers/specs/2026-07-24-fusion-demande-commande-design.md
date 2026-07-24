# Fusion Demande/Commande + choix d'étape obligatoire à l'enregistrement — Design

**Date :** 2026-07-24
**Projet :** Planning OLDA
**Statut :** validé (brainstorming), prêt pour le plan d'implémentation

## Problème

Aujourd'hui "Commande" désigne deux choses différentes dans l'app : une **nature** de
fiche (`order_kind`, badge "Demande"/"Commande" affiché sur la carte, choisie via deux
entrées de menu distinctes `#demande`/`#commande`) et le **libellé d'une étape du
pipeline** (`chiffrage`, affiché "Commande" dans la grille). Cette collision de nom crée
de la confusion. Par ailleurs, seul le wizard complet demande explicitement dans quelle
étape enregistrer une fiche (`openDestinations()`) — l'ajout rapide de ligne dans la
grille (bouton `+`) crée silencieusement une ligne dans l'étape de la vue courante, sans
jamais le demander.

Décision : il n'existe plus qu'un seul type de fiche, **Demande**. La notion de nature
(`order_kind`) disparaît. En contrepartie, **tout enregistrement d'une nouvelle ligne**
(wizard ou ajout rapide) doit explicitement demander dans quelle étape la sauvegarder.

## Existant réutilisé

- **Écran de destination** : `openDestinations()`/`destCarte()`
  ([public/commande.js:1230-1303](../../../public/commande.js#L1230)) — déjà l'étape où
  "on demande TOUJOURS où enregistrer" dans le wizard complet. Conservé tel quel dans son
  fonctionnement, seul le contenu affiché change (voir section 3).
- **Menu ancré générique** : `openMenu(anchor, items, current, onPick)`
  ([public/app.js:1783-1813](../../../public/app.js#L1783)) — déjà utilisé pour le picker
  de sous-étape par ligne, entre autres. Réutilisé pour le nouveau picker d'étape de
  l'ajout rapide, plutôt que de construire un nouveau composant.
- **Pattern de migration additive réversible** dans `db.js:init()`
  ([db.js:142-155](../../../db.js#L142)) — un `try { ALTER TABLE ... }` par colonne avec
  commentaire "Down :". Même pattern utilisé en sens inverse pour retirer `order_kind`.
- **Flux `POST /api/requests`** ([server.js:338-377](../../../server.js#L338)) — inchangé
  côté route ; seul le payload envoyé par le client change (étape toujours fournie
  explicitement).

## 1. Modèle de données : suppression de `order_kind`

- Colonne `order_kind text` ([schema.sql:9](../../../schema.sql#L9)) supprimée. Migration
  ajoutée dans `db.js:init()`, à la suite du bloc de migrations additives existant
  ([db.js:150-155](../../../db.js#L150)) :
  ```js
  // Down : ALTER TABLE requests ADD COLUMN IF NOT EXISTS order_kind text
  await pool.query('ALTER TABLE requests DROP COLUMN IF EXISTS order_kind');
  ```
- Suppressions corrélées :
  - `ORDER_KINDS` / export ([db.js:109](../../../db.js#L109),
    [db.js:728](../../../db.js#L728)) et `ORDER_KIND_SET`
    ([server.js:16](../../../server.js#L16), [server.js:27](../../../server.js#L27)).
  - Cas `order_kind` dans `validateField`
    ([server.js:104-110](../../../server.js#L104)).
  - `order_kind` retiré de `PATCHABLE` ([server.js:66](../../../server.js#L66)) et de la
    liste de colonnes de l'INSERT de `/api/commande`
    ([server.js:1247](../../../server.js#L1247)).
  - Assertions `order_kind` dans `test/commande.test.js` (lignes 94, 179-196) retirées.

## 2. Menu et entrée du wizard

- Les deux entrées de menu `#demande` et `#commande`
  ([public/app.js:3490](../../../public/app.js#L3490),
  [public/app.js:3497](../../../public/app.js#L3497)) fusionnent en **une seule entrée
  visible "Demande"**. `#commande` reste toléré comme alias de routage vers la même vue
  (compat liens/historique existants) mais disparaît du menu affiché.
- Suppression de `setNature()` ([public/commande.js:1385-1389](../../../public/commande.js#L1385)),
  de `state.kind` (init à [public/commande.js:48](../../../public/commande.js#L48)), de
  `typeById()` ([public/commande.js:66](../../../public/commande.js#L66)) et de ses appels
  ([public/commande.js:741](../../../public/commande.js#L741),
  [public/commande.js:1240](../../../public/commande.js#L1240),
  [public/commande.js:1287](../../../public/commande.js#L1287)).
- `catalog.json` : le tableau `commande.types`
  ([catalog.json:3-6](../../../catalog.json#L3)) est supprimé (plus de nature à choisir en
  amont de la fiche).
- Le titre de la vue ([public/app.js:3460](../../../public/app.js#L3460)) devient fixe :
  "Demande", il ne varie plus selon `#demande`/`#commande`.

## 3. Écran de destination (`openDestinations`)

Comportement inchangé sur le fond (toujours obligatoire, jamais de valeur par défaut
silencieuse). Changements :

- Titre fixe : "Où enregistrer cette demande ?" (au lieu de varier selon `t.label` issu de
  `state.kind`).
- `destHabituelle()` ([public/commande.js:1239-1254](../../../public/commande.js#L1239))
  est supprimé : plus de signal de nature pour déterminer une famille "habituelle". Les
  familles s'affichent dans l'ordre du catalogue pipeline (`CAT.pipeline`), sans tri ni tag
  "habituel" pré-sélectionné.

## 4. Ajout rapide dans la grille (bouton `+`)

- Aujourd'hui `createForCurrentView()`
  ([public/app.js:2169-2199](../../../public/app.js#L2169)) crée silencieusement une ligne
  dans `viewSlug`/`viewSub` (étape de la vue courante) au clic sur `#btnNew`.
- Nouveau comportement : le clic sur `#btnNew` ouvre un `openMenu()` ancré sur le bouton,
  listant les familles du pipeline (`FAMILIES`). Si la famille choisie possède des
  sous-étapes (`SUB_STAGES[famille]`), un second `openMenu()` s'ouvre immédiatement pour la
  sous-étape. Le `POST /api/requests` (et la création de la ligne optimiste locale) n'a
  lieu qu'une fois l'étape choisie — Échap ou clic en dehors du menu n'envoie rien et ne
  crée aucune ligne.
- Le reste du flux (`makeOptimisticRow`, `finalizeCreate`) est inchangé, seul le
  déclenchement change (étape choisie via le menu plutôt que `viewSlug`/`viewSub` de la vue
  courante).

## 5. Duplication et envoi vers une étape — inchangés

- `duplicateRow()` ([public/app.js:2261-2294](../../../public/app.js#L2261)) : conserve
  l'étape de la ligne source par défaut, sans redemander (choix implicite déjà cohérent —
  décision validée en clarification).
- `copyToStage()` ([public/app.js:2296-2307](../../../public/app.js#L2296)) : porte déjà un
  choix explicite de destination via le bouton "envoyer vers" cliqué — aucun changement.

## 6. Nettoyage

- Badge `kind-badge` (rendu [public/app.js:1296-1304](../../../public/app.js#L1296) + CSS
  associé dans `public/styles.css`) supprimé.
- `order_kind: null` retiré de `makeOptimisticRow()`
  ([public/app.js:2115](../../../public/app.js#L2115)).
- `order_kind: r.order_kind ?? null` retiré de `copyBody()`
  ([public/app.js:2241](../../../public/app.js#L2241)).

## Ce qui ne change pas

- La table `requests` reste unique (elle l'était déjà — pas de fusion de tables SQL à
  faire, seulement suppression d'une colonne de distinction devenue inutile).
- Les étapes du pipeline (`FAMILIES`, `SUB_STAGES`, `FLOW`) et leurs libellés, y compris
  "Commande" comme libellé de l'étape `chiffrage`, restent inchangés (décision validée en
  clarification : seul le badge de nature disparaît, pas le nom de l'étape).
- Le blocage prix→facturation (`hasPrice`/`blockedByPrice`) et la logique de
  glisser-déposer ne sont pas affectés.
- `PATCH /api/requests/:id` reste tel quel ; seul `order_kind` disparaît de la liste de
  champs patchables.

## Cas limites

- **Lignes existantes avec `order_kind` déjà renseigné** : perdues par la suppression de
  colonne (comportement attendu — c'est justement la donnée qu'on retire du modèle). Pas de
  migration de préservation nécessaire : aucune vue/rapport n'agrège actuellement sur
  `order_kind`.
- **`INSERT INTO requests DEFAULT VALUES`** (cas `cols.length === 0` dans
  [server.js:338-377](../../../server.js#L338)) : reste possible, la colonne `stage`
  garde son défaut DB `'demande'` ([schema.sql:7](../../../schema.sql#L7)) — ce chemin
  n'est de toute façon pas emprunté par les flux UI concernés ici (wizard et ajout rapide
  envoient désormais toujours `stage` explicitement).
- **Ancien lien/bookmark vers `#commande`** : continue de fonctionner (alias de routage
  conservé), affiche simplement la même vue "Demande".

## Vérification

Pas de framework de test lourd dans ce projet : scripts `node:assert` (`npm test` →
`test/*.test.js`).

1. **Vérification visuelle** via le serveur de preview :
   - Menu : une seule entrée "Demande" visible ; le wizard s'ouvre sans écran de choix de
     nature.
   - Wizard : remplir une fiche, vérifier que `openDestinations()` s'affiche toujours en
     fin de parcours avec le titre fixe, familles dans l'ordre catalogue, sans tag
     "habituel".
   - Grille : clic sur `+` → menu de familles apparaît, aucune ligne créée avant sélection ;
     choisir une famille avec sous-étapes → second menu ; choisir une famille sans
     sous-étape → ligne créée directement dans cette famille.
   - Grille : Échap ou clic en dehors du menu d'ajout rapide → aucune ligne créée.
   - Aucun badge "Demande"/"Commande" affiché sur les cartes existantes après migration.
   - Dupliquer une ligne : la copie atterrit dans la même étape que la source, sans prompt.
2. **Migration** : démarrer le serveur sur une base existante contenant des lignes avec
   `order_kind` renseigné, vérifier que la colonne est retirée sans erreur et que
   l'application démarre normalement.
3. **Tests serveur** (`test/commande.test.js`) : retirer les cas `order_kind`
   (set/clear/copy/invalid-value), vérifier que `POST /api/commande` et `POST
   /api/requests` fonctionnent toujours sans ce champ.
4. **Test nouveau** : couvrir que l'ajout rapide n'appelle `POST /api/requests` qu'après
   sélection d'une étape (pas d'appel réseau au simple clic sur `+`).
