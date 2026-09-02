> ⚠ **DOCUMENT HISTORIQUE.** Écrit avant le 01/09/2026 et jamais relu depuis.
> Il cite des fichiers qui n'existent plus (`public/projet.js`, `public/commande.js`,
> `public/guide.js`), des tables retirées (`production_sectors`) ou des décisions
> annulées depuis. Il dit ce qu'on a pensé ce jour-là, pas ce que le code fait
> aujourd'hui : pour ça, `ARCHITECTURE.md` et `README.md` font foi.

# Largeur des colonnes réglable par catégorie — design

Date : 2026-06-11

## Besoin

Chaque catégorie de la sidebar affiche un tableau de commandes. L'utilisateur veut
régler manuellement la largeur de chaque colonne, catégorie par catégorie.

## Approches envisagées

- **A. Largeurs sur les `<col>` + `table-layout: fixed` (retenue)** — poignées de
  redimensionnement dans les `<th>`, largeurs posées sur un `<colgroup>`. Précis,
  aucun « saut » des autres colonnes, fonctionne souris + tactile via Pointer Events
  (cohérent avec le drag-and-drop existant).
- B. Largeurs CSS sur les classes `.col-*` en layout auto — rejetée : en layout
  auto, `width` n'est qu'une indication, impossible de rétrécir sous la largeur du
  contenu, le drag « ne suit pas le curseur ».
- C. Refonte en CSS grid — rejetée : refonte lourde du tableau, hors de proportion.

## Décisions

- **Persistance** : `localStorage` (`olda_col_widths_v1`), structure
  `{ [stage]: { [colonne]: px } }`. Par appareil : les écrans (tablette atelier,
  poste fixe) ont des tailles différentes, partager via le serveur serait nuisible.
- **Mode automatique = absence de réglage** : tant qu'une catégorie n'a pas été
  réglée, le tableau garde la répartition native du navigateur (comportement
  d'avant). Un bouton « Colonnes auto » de remise à zéro globale a été livré puis
  retiré le jour même à la demande de l'utilisateur (jugé inutile).
- **Premier drag** : les largeurs rendues sont figées sur les `<col>` (capture des
  `offsetWidth`), puis seule la colonne saisie bouge ; la largeur du tableau devient
  la somme des colonnes (défilement horizontal si besoin).
- **Plancher** : 36 px par colonne. Colonne actions (`del`) non réglable.
- **Tactile** : Pointer Events + `touch-action: none`, zone de prise élargie à
  18 px sur écrans tactiles (`pointer: coarse`).
- **Impression** : les réglages écran sont ignorés (`table-layout: auto`,
  `col { width: auto }`), le papier garde sa répartition automatique.

## Fichiers touchés

- `public/index.html` : `<colgroup>` (13 colonnes nommées) + bouton `#btnAutoFit`.
- `public/app.js` : section « Largeur des colonnes » (apply/ensure/resizers/bouton),
  appel dans `selectStage()` et `start()`.
- `public/styles.css` : `.grid.manual-cols`, `.col-resizer`, garde-fous impression.
