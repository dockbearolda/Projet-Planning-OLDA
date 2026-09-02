> ⚠ **DOCUMENT HISTORIQUE.** Écrit avant le 01/09/2026 et jamais relu depuis.
> Il cite des fichiers qui n'existent plus (`public/projet.js`, `public/commande.js`,
> `public/guide.js`), des tables retirées (`production_sectors`) ou des décisions
> annulées depuis. Il dit ce qu'on a pensé ce jour-là, pas ce que le code fait
> aujourd'hui : pour ça, `ARCHITECTURE.md` et `README.md` font foi.

# Icône BAT + side bar de détails sur une ligne — Design

**Date :** 2026-07-27
**Projet :** Planning OLDA
**Statut :** validé (brainstorming), prêt pour le plan d'implémentation

## Problème

Sur une ligne de la grille de planning (`#grid`), l'utilisateur veut :
1. Pouvoir attacher/consulter le BAT (Bon À Tirer) de la commande, comme il le fait déjà
   pour le devis et la facture.
2. Cliquer sur une ligne pour ouvrir une side bar à droite qui affiche toutes les infos
   de la commande — certaines lignes ont besoin de beaucoup plus d'informations
   (détail produit, notes longues) que ce que les colonnes compactes du tableau peuvent
   raisonnablement montrer, sans pour autant élargir/déformer la ligne du tableau.

## Décisions de design (issues du brainstorming)

1. **BAT = même comportement que devis/facture** (upload PDF / aperçu / suppression),
   pas un simple booléen ni un statut de workflow.
2. **Icône « voir détails »** placée dans le même cluster que WhatsApp/devis/facture/BAT
   (cellule Dossier), **pas** en fin de ligne, **pas** sur toute la ligne — le reste de
   la ligne garde son édition inline actuelle, intacte.
3. **Rôle de la side bar : consultation + un point d'édition confortable** — le champ
   Notes (= `description`, colonne « Infos » actuelle), rien d'autre n'est éditable
   depuis la side bar.
4. **Contenu en un seul scroll vertical** (pas d'onglets) : en-tête, contact, documents,
   détail produit structuré, suivi, notes.
5. **Détail produit affiché en clair, reconstruit depuis `requests.fiche`** (le JSON déjà
   stocké en base), pas fusionné avec les notes libres — accepté malgré le risque de
   décalage si le texte Infos a été modifié à la main depuis la création.

## Backend — aucun changement requis

Tout ce dont ce projet a besoin existe déjà :

- **Pièces jointes BAT** : `PDF_KINDS` ([server.js:459](../../../server.js#L459)) contient
  déjà `'bat'`, la table `attachments` l'accepte déjà (contrainte `kind IN ('devis','bat','facture')`,
  [schema.sql:104-111](../../../schema.sql#L104)), et les routes `PUT/GET/DELETE
  /api/requests/:id/pdf/:kind` ([server.js:470-521](../../../server.js#L470)) sont déjà
  génériques sur `kind`. Le `SELECT` principal ([server.js:327-334](../../../server.js#L327))
  joint déjà `bat_name`. Seul le frontend n'exploite pas ce 3ᵉ emplacement.
- **Données pour la side bar** : `GET /api/requests` fait `SELECT r.*` — chaque ligne reçue
  par le client porte déjà `r.fiche` (jsonb complet), `r.description`, `r.project_value`,
  `r.flag`/`r.flag_reason`, etc. Aucune nouvelle route, aucun nouveau champ.
- **Sauvegarde des notes** : `patchRow(r, body)` ([app.js:2047](../../../public/app.js#L2047))
  fait déjà un `PATCH` générique — la side bar l'appelle avec `{ description: val }`,
  exactement comme `cellInfos` aujourd'hui.
- **Réinitialisation à la duplication** : `bat_name` est déjà remis à `null` aux deux
  endroits qui dupliquent/déplacent une ligne ([app.js:2074](../../../public/app.js#L2074),
  [app.js:2220](../../../public/app.js#L2220)) — rien à changer ici, c'est déjà symétrique
  avec devis/facture.

## Frontend — 1. Icône BAT

Extension du composant pastille PDF déjà générique
([app.js:1346-1408](../../../public/app.js#L1346), `cellPdfSlot(r, kind)`) :

- Nouvelle fonction `batIcon()` (même famille de glyphes au trait que `devisIcon()`/
  `factureIcon()`, [app.js:1280-1298](../../../public/app.js#L1280)) — un glyphe distinct
  (ex. tampon/coche) pour ne pas être confondu avec devis/facture au premier coup d'œil.
- `PDF_SLOT_LABELS` ([app.js:1301](../../../public/app.js#L1301)) : ajouter
  `bat: { noun: 'BAT', withArticle: 'le BAT' }`.
- `PDF_SLOT_ICON` ([app.js:1336](../../../public/app.js#L1336)) : ajouter `bat: batIcon`.
- `cellDossier()` ([app.js:1216-1243](../../../public/app.js#L1216)) : ajouter
  `line.appendChild(cellPdfSlot(r, 'bat'))` après l'appel `facture`, avant
  `cellPdfWhatsapp(r)`.

Comportement identique à devis/facture : case vide → clic ouvre le sélecteur de fichier
et upload immédiat ; case remplie → clic ouvre le PDF dans un nouvel onglet, croix au
survol pour retirer.

## Frontend — 2. Déclencheur de la side bar

Un nouveau bouton (icône chevron/points) ajouté dans `.client-line`, dans le même cluster,
après la pastille BAT (et après `cellPdfWhatsapp` si présente). Clic → ouvre la side bar
pour cette ligne (`openLigneDetail(r.id)`). Comme tous les boutons voisins du cluster,
`e.stopPropagation()` sur son propre clic — mais surtout, **aucun handler de clic n'est
ajouté sur `<tr>` lui-même** : toutes les cellules existantes gardent exactement leur
comportement actuel, zéro risque de régression sur l'édition inline.

## Frontend — 3. Side bar (nouveau composant)

### Structure et style

Nouveau composant dans `app.js`, calqué sur le tiroir existant `.cl-drawer` de
[clients.js:219-228](../../../public/clients.js#L219) /
[clients.css:269-292](../../../public/clients.css#L269) (scrim + carte glissante à droite,
`min(468px, 100vw)`, plein écran sous 720px) — **mêmes tokens que la grille**
(`--surface`, `--border`, `--primary`, `--dur-2/3`, `--ease`), contrairement au tiroir de
`dashboard.js` qui utilise des tokens `--pj-*` scopés à cette autre vue. `role="dialog"`,
fermeture par scrim, croix, ou touche Échap (même pattern que les deux tiroirs existants).

Une seule instance montée une fois dans le DOM (comme `.cl-drawer`), son contenu est
re-rendu à chaque ouverture pour la ligne `r` demandée.

### Contenu (un seul scroll, dans l'ordre)

1. **En-tête** : nom du dossier (`billing_company`), badge type (`client_type`, mêmes
   libellés que `CLIENT_TYPES`, [app.js:987](../../../public/app.js#L987)), étoiles de
   priorité (`priority`), bouton fermer.
2. **Contact** : `contact_referent` / `contact_phone` / `contact_email` — lecture seule
   (l'édition reste dans le popover contact existant, hors scope ici).
3. **Documents** : les 3 pastilles devis/facture/BAT, réutilisation directe de
   `cellPdfSlot(r, kind)` — gérables depuis la side bar comme depuis la ligne (même
   fonction, donc même code, pas de duplication).
4. **Détail produit** *(masqué si absent — voir Cas limites)* : reconstruction lisible à
   partir de `r.fiche`, avec deux branches selon `r.fiche.kind` :
   - `'commande-atelier'` ([server.js:1434](../../../server.js#L1434)) : parcourir
     `fiche.tasses[]` / `fiche.textiles[]` / `fiche.objets[]`, un bloc par article,
     champs comme dans `detailLigne()` ([server.js:1115-1153](../../../server.js#L1115)) —
     produit/coloris/faces pour une tasse, vêtement/tailles/zones pour un textile — mais
     rendu en HTML structuré (titres + sous-lignes), pas en texte à flèches `↳`.
   - `'projet-simple'` ([server.js:1316](../../../server.js#L1316)) : parcourir
     `fiche.lignes[]`, un bloc par article — `produit`/`coloris`/`face1`/`face2`/`dessous`
     + petit badge « BAT inclus » si `l.bat === true` (option catalogue tarifée, distincte
     de la pièce jointe BAT — à ne pas confondre visuellement : badge texte, pas la même
     icône), ou `description` simple si pas de produit catalogue.
5. **Suivi** : prix (`project_value`), échéance (`deadline`), sous-étape (`sub_stage`,
   libellé via les mêmes tables que `cellSubStage`), état (`flag`/`flag_reason`, mêmes
   libellés/couleurs que `FLAG_BY_VALUE`, [app.js:1121](../../../public/app.js#L1121)) —
   tout en lecture seule.
6. **Notes** : `<textarea>` grand format liée à `description`. Sauvegarde au blur via
   `patchRow(r, { description: val })` — même valeur, même endpoint que `cellInfos`
   ([app.js:1579-1588](../../../public/app.js#L1579)). Après sauvegarde, la cellule Infos
   de la ligne dans le tableau (si montée) est resynchronisée pour ne jamais afficher un
   texte périmé pendant que la side bar est ouverte.

### Synchronisation table ↔ side bar

`r` est le même objet JS partagé entre la ligne du tableau et la side bar (pas de copie).
Modifier `r.description` depuis la side bar et re-rendre juste la cellule Infos concernée
suffit à garder les deux vues cohérentes sans re-render de grille complet.

## Cas limites

- **`fiche` absent ou `null`** (ligne créée à la main dans la grille via le bouton
  « + Ajouter », très anciennes lignes) : section « Détail produit » masquée entièrement,
  seule la section Notes reste (elle contient déjà tout ce qui existe pour cette ligne).
- **`fiche.kind` inconnu** (format futur, ou absence du champ `kind` sur des fiches très
  anciennes) : même repli — section masquée, pas d'erreur affichée.
- **Notes modifiées à la main depuis la création** : le détail produit structuré peut
  diverger du texte Infos (ex. une couleur changée dans Infos ne se répercute pas dans
  `fiche`) — accepté sciemment (décision de design n°5), le détail structuré est un
  instantané de la commande telle que saisie à l'origine.
- **BAT (pièce jointe) vs `bat` (option catalogue « projet-simple »)** : deux concepts
  distincts qui peuvent coexister sur une même ligne. Le badge « BAT inclus » dans le
  détail produit ne doit jamais être confondu visuellement avec la pastille BAT
  (documents) — vocabulaire clair dans les infobulles des deux.
- **Ligne supprimée/déplacée pendant que sa side bar est ouverte** : fermeture automatique
  de la side bar (même logique que `closeDetail()` dans `dashboard.js` quand la ligne
  active disparaît de la vue courante).

## Vérification

Pas de framework de test lourd dans ce projet : scripts `node:assert` (`npm test` →
`test/*.test.js`).

1. **Test serveur** : `PUT` puis `GET` puis `DELETE` sur `/api/requests/:id/pdf/bat`
   (symétrique aux tests devis/facture existants s'ils existent déjà).
2. **Vérification visuelle** via le serveur de preview :
   - Upload d'un PDF sur l'icône BAT d'une ligne, bascule d'état, aperçu, retrait.
   - Clic sur l'icône « voir détails » → side bar s'ouvre avec les bonnes infos ; clic
     ailleurs sur la même ligne (ex. prix, sous-étape) → toujours l'édition inline
     normale, la side bar ne s'ouvre pas par erreur.
   - Une ligne créée via le formulaire « Commande » (tasses/textiles/objets) → section
     Détail produit visible et correcte.
   - Une ligne créée via « Nouveau Projet » → section Détail produit visible avec le bon
     format (`lignes[]`), badge BAT si applicable.
   - Une ligne créée à la main dans la grille (bouton + Ajouter, sans passer par un
     formulaire) → section Détail produit absente, pas d'erreur JS.
   - Modifier les Notes depuis la side bar → la cellule Infos du tableau se met à jour ;
     modifier Infos dans le tableau pendant que la side bar est fermée, puis rouvrir la
     side bar → texte à jour.
   - Dupliquer une ligne qui a un BAT attaché → le duplicata n'a pas de BAT (déjà couvert
     par le code existant, à vérifier non régressé).
