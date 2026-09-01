> ⚠ **DOCUMENT HISTORIQUE.** Écrit avant le 01/09/2026 et jamais relu depuis.
> Il cite des fichiers qui n'existent plus (`public/projet.js`, `public/commande.js`,
> `public/guide.js`), des tables retirées (`production_sectors`) ou des décisions
> annulées depuis. Il dit ce qu'on a pensé ce jour-là, pas ce que le code fait
> aujourd'hui : pour ça, `ARCHITECTURE.md` et `README.md` font foi.

# Prix sur la ligne planning + blocage d'entrée en Facturation sans prix — Design

**Date :** 2026-07-24
**Projet :** Planning OLDA
**Statut :** validé (brainstorming), prêt pour le plan d'implémentation

## Problème

Aujourd'hui aucune ligne du planning n'affiche de prix, et rien n'empêche une commande
sans prix de passer en Facturation. Le patron veut pouvoir saisir le prix directement sur
la ligne, et si une ligne arrive en Facturation sans prix, une bulle doit prévenir que le
glissement est refusé.

## Existant réutilisé

- **Champ prix** : `project_value numeric(12,2)` existe déjà en base
  ([schema.sql:21](../../../schema.sql#L21)), déjà whitelisté et validé côté serveur
  ([server.js:68](../../../server.js#L68), [server.js:130-133](../../../server.js#L130)).
  Il n'est simplement affiché nulle part côté grille. **Aucun changement backend.**
- **Édition inline** : le pattern `bindInline` ([app.js:1936](../../../public/app.js#L1936))
  déjà utilisé pour la Description ([app.js:1477](../../../public/app.js#L1477)) — saisie
  optimiste, sauvegarde au blur, Entrée valide, Échap annule.
- **Bulle maison** : `showTip(anchor, text)` / `hideTip()`
  ([app.js:1628](../../../public/app.js#L1628), [app.js:1623](../../../public/app.js#L1623)),
  déjà utilisée pour les infobulles devis/facture — même charte, pas de nouveau composant.
- **Toast** : `showToast(...)` déjà utilisé pour le refus de dépôt sur un en-tête de zone
  ([app.js:2350-2352](../../../public/app.js#L2350)) — même mécanisme pour le refus prix.
- **Couleur « bloqué »** : token `--st-bloque` déjà utilisé pour l'état ligne « Bloquée »
  ([styles.css:1395](../../../public/styles.css#L1395)) — réutilisé pour l'accent visuel de
  la cible de dépôt refusée, plutôt qu'une nouvelle couleur.

## 1. Colonne Prix sur la ligne

Nouvelle cellule `cellPrice(r)`, insérée dans `buildRow`
([app.js:843](../../../public/app.js#L843)) juste après `cellDescription(r)` et avant
`cellSubStage(r)` : la ligne se lit « ce qu'on produit → son prix → où ça en est ».

- Input texte compact (`.cell-input.cell-price`), suffixe visuel « € » à côté (pas dans la
  valeur tapée, pour ne pas complexifier le parsing).
- Liée à `project_value` via `bindInline` :
  - `transform` : chaîne vide → `null` ; sinon `parseFloat` après avoir remplacé une
    virgule par un point ; si le résultat n'est pas un nombre, `bindInline` annule déjà
    automatiquement (revert à la valeur précédente).
  - `normalize` : au blur, formatte la valeur affichée à 2 décimales (`12` → `12.00`) si
    c'est un nombre valide.
- Placeholder `"prix"` quand vide, comme les autres champs texte de la grille.
- PATCH déjà géré par la route existante ; pas de nouvelle route.

## 2. Règle de blocage

- `hasPrice(r)` : `r.project_value != null` (un prix à **0€ est valide** — seule l'absence
  de prix bloque).
- Le blocage s'applique uniquement au moment où une ligne **entre** dans la famille
  `facturation` **depuis une autre famille**, sans prix :
  ```
  bloqué = (famille cible === 'facturation') && (r.stage !== 'facturation') && !hasPrice(r)
  ```
- Une fois la ligne dans `facturation`, réordonner ou basculer entre les deux sous-étapes
  (`facturation_a_faire` ↔ `pret_retrait`) **n'est jamais bloqué** — la règle ne s'applique
  qu'à l'entrée, pas aux mouvements internes à la famille. Choix explicite : ça évite qu'une
  ligne reste coincée si son prix est modifié après coup.
- Message unique, réutilisé partout : **« Sans prix, impossible de passer en Facturation. »**

## 3. Glisser-déposer (`public/app.js`)

- `stageAcceptsDrop(stageEl, r)` ([app.js:2284](../../../public/app.js#L2284)) : ajoute la
  condition de blocage ci-dessus à celles déjà présentes (en-tête verrouillé, même place).
- `updateDragTarget()` ([app.js:2292](../../../public/app.js#L2292)), à chaque frame de
  survol pendant le drag :
  - Cible facturation acceptée → comportement actuel (`.drop-target`).
  - Cible facturation refusée **spécifiquement à cause du prix** (pas à cause du
    verrouillage d'en-tête, qui garde son comportement actuel sans bulle) → classe
    `.stage.drop-blocked` (nouvel accent visuel, token `--st-bloque`) + `showTip(stageEl,
    "Sans prix, impossible de passer en Facturation.")`, appelés une seule fois à l'entrée
    sur la cible (pas à chaque frame) pour éviter de recréer la bulle en boucle.
  - Dès que le pointeur quitte cette cible (ou qu'un autre élément est survolé), retirer
    `.drop-blocked` et appeler `hideTip()`.
- `onDragEnd()` ([app.js:2311](../../../public/app.js#L2311)) : si la cible relâchée est
  refusée pour cause de prix, ne pas déplacer la ligne (`applySortAndRender()` seul, comme
  le cas en-tête verrouillé) et `showToast("Sans prix, impossible de passer en
  Facturation.")` — sert de filet pour le tactile, où la bulle de survol est moins fiable.
- `hideTip()` systématique dans `onDragEnd` (fin de drag) pour ne jamais laisser une bulle
  orpheline si le drag se termine pendant qu'elle est affichée.

## 4. Flèche « étape suivante » (`cellNext`, [app.js:1173](../../../public/app.js#L1173))

Même règle, pour ne pas laisser un contournement évident : si `nextFlowStep(r)` renvoie une
étape dans `facturation` alors que `r.stage !== 'facturation'`, et que la ligne n'a pas de
prix :

- Le clic sur la flèche **ne déplace pas** la ligne (pas d'appel à `moveToStage`).
- Affiche la même bulle, ancrée sur le bouton (`showTip(btn, "Sans prix, impossible de
  passer en Facturation.")`) et le même `showToast(...)`.
- Le bouton reste visible et cliquable dans tous les cas (pas de désactivation visuelle a
  priori) — l'utilisateur découvre le blocage au clic, comme pour le glisser-déposer.

## Ce qui ne change pas

- `cellSubStage` (sélecteur de sous-étape) : ne liste que les sous-étapes de la famille
  **courante** de la ligne, donc ne peut déjà pas servir à entrer dans `facturation` depuis
  une autre famille — aucun changement nécessaire.
- Aucune vérification rétroactive sur des lignes déjà présentes en `facturation` sans prix
  (données existantes laissées telles quelles).
- Aucun changement backend/schéma — `project_value` existe et est déjà validé.

## Cas limites

- **Prix à 0€** : valide, n'entrave jamais le passage en Facturation.
- **Prix effacé après coup sur une ligne déjà en Facturation** : n'affecte pas ses
  mouvements internes à la famille (voir règle de blocage ci-dessus) ; seul un futur retour
  en arrière puis re-tentative d'entrée depuis une autre famille serait bloqué.
- **Saisie invalide dans le champ Prix** (texte non numérique) : `bindInline` revert déjà
  automatiquement à la valeur précédente, comportement identique aux autres champs.
- **Ligne brouillon (draft)** : pas de drag possible sur une ligne brouillon (pas de poignée
  affichée, voir `buildRow`), donc la règle de blocage ne s'applique qu'aux lignes réelles.

## Vérification

Pas de framework de test lourd dans ce projet : scripts `node:assert` (`npm test` →
`test/*.test.js`).

1. **Vérification visuelle** via le serveur de preview :
   - Saisir un prix sur une ligne, vérifier la sauvegarde (PATCH, persistance au reload).
   - Glisser une ligne sans prix vers Facturation : bulle au survol, refus au dépôt, toast.
   - Glisser une ligne avec un prix (y compris 0) vers Facturation : accepté normalement.
   - Cliquer la flèche « étape suivante » sur une ligne sans prix dont la prochaine étape
     est Facturation : refusé, bulle + toast, ligne inchangée.
   - Ligne déjà en Facturation sans prix (cas limite manuel en base) : réordonnancement et
     bascule entre les deux sous-étapes toujours possibles.
2. Pas de nouveau test serveur nécessaire (aucune route backend touchée).
3. **Test unitaire de la règle de blocage** : suivre le pattern déjà utilisé par
   [test/next-flow-step.test.js](../../../test/next-flow-step.test.js) (extraction du vrai
   bloc source de `public/app.js` via `vm`, plutôt qu'une copie de la logique) pour couvrir
   `hasPrice` et la condition de blocage : prix `null` bloque l'entrée en facturation depuis
   une autre famille, prix `0` ne bloque pas, mouvement interne à `facturation` jamais
   bloqué même sans prix.
