# Facture PDF + envoi WhatsApp en un clic — Design

**Date :** 2026-07-24
**Projet :** Planning OLDA
**Statut :** validé (brainstorming), prêt pour le plan d'implémentation

## Problème

Sur une ligne de planning, l'utilisateur veut pouvoir attacher la facture PDF de la
commande, puis, en fin de production, cliquer un bouton pour ouvrir WhatsApp avec la
conversation du client déjà prête (message vierge — il l'écrit lui-même avec ses
réponses rapides `/`) et la facture prête à joindre, le tout « en un clic ».

**Contrainte technique dure, actée dans ce design** : aucun lien `wa.me` ni API web
publique ne permet d'ouvrir une conversation WhatsApp **et** d'y pré-attacher un
fichier en même temps. Cette combinaison n'existe que via le partage natif mobile
(Web Share API), qui ne fonctionne pas sur Mac (WhatsApp n'y a pas d'extension de
partage) — or l'usage principal ici est PC/Mac. Le vrai zéro-clic (message + PJ envoyés
sans intervention humaine) exigerait l'API payante WhatsApp Business Cloud, incompatible
avec le fait que le message reste écrit à la main. Le design retient donc le geste le
plus proche possible d'un clic unique compte tenu de ces limites : **un clic déclenche
le téléchargement du PDF et l'ouverture de la conversation vierge simultanément** ;
glisser le fichier téléchargé dans la conversation puis Envoyer restent les deux gestes
manuels irréductibles.

## Décisions de design (issues du brainstorming)

1. **Appareil cible : PC/Mac.** Pas de Web Share API (indisponible côté WhatsApp sur Mac) ;
   le flux est téléchargement auto + ouverture de conversation vierge.
2. **Pastille séparée** de la pastille WhatsApp « commande prête » existante — comportement
   indépendant, prévisible.
3. **Icône à deux états** (trombone vide → attacher ; rempli → envoyer) plutôt que deux
   icônes côte à côte.
4. **Retrait via une petite croix au survol** de l'état rempli (pas de menu contextuel).
5. **Toujours visible** sur toutes les lignes, même sans numéro WhatsApp valide (l'état
   rempli télécharge alors seulement le PDF, sans ouvrir WhatsApp).
6. **Portée : toutes les lignes, à toutes les étapes** (pas de restriction par étape).
7. **Deux pastilles au lieu d'une** : le même mécanisme est dupliqué pour **devis** et
   **facture** (le kind `devis` existe déjà côté serveur mais n'était jamais câblé côté
   écran ; `bat` reste inutilisé, hors scope).

## Backend (server.js) — extension minimale

Le mécanisme de pièces jointes PDF existe déjà et est déjà générique : table
`attachments` (clé `(request_id, kind)`, PDF en base64 car le disque Railway est
éphémère), routes `PUT/GET/DELETE /api/requests/:id/pdf/:kind`. Seuls `devis` et `bat`
sont actuellement acceptés, et rien côté frontend ne les utilise.

Changements :

- `PDF_KINDS` ([server.js:419](../../../server.js#L419)) : `['devis', 'bat', 'facture']`.
- `SELECT` ([server.js:289-294](../../../server.js#L289)) : ajouter la jointure
  `facture_name` :
  ```sql
  SELECT r.*,
      ad.filename AS devis_name,
      ab.filename AS bat_name,
      af.filename AS facture_name
    FROM requests r
    LEFT JOIN attachments ad ON ad.request_id = r.id AND ad.kind = 'devis'
    LEFT JOIN attachments ab ON ab.request_id = r.id AND ab.kind = 'bat'
    LEFT JOIN attachments af ON af.request_id = r.id AND af.kind = 'facture'
  ```
- Messages d'erreur mentionnant `(devis|bat)` ([server.js:435](../../../server.js#L435),
  [460](../../../server.js#L460), [478](../../../server.js#L478)) : mis à jour pour
  refléter la liste réelle (`PDF_KINDS.join('|')`), sans changer la validation elle-même.
- Aucune nouvelle route : PUT/GET/DELETE fonctionnent déjà pour n'importe quel kind de
  `PDF_KINDS`.

## Frontend (public/app.js) — composant pastille PDF à deux états

Un seul composant, réutilisé avec `kind = 'devis'` et `kind = 'facture'` (label affiché
dans les infobulles : « devis » / « facture »).

### État vide

- Icône trombone dans un `<label>` enveloppant un `<input type="file" accept="application/pdf" hidden>` :
  cliquer l'icône ouvre nativement le sélecteur de fichier, sans handler JS pour le clic
  lui-même.
- `change` sur l'input → lit le fichier, `PUT /api/requests/:id/pdf/:kind?name=<nom>` avec
  le contenu brut du fichier. Après succès, on met à jour l'état local de la ligne
  (`r.<kind>_name`) et on re-rend la cellule (le SSE `update` existant rattrapera aussi
  les autres postes ouverts, comme pour les autres champs de la ligne).
- Erreur d'upload (réseau, fichier vide) : signalée via le mécanisme d'erreur déjà utilisé
  ailleurs dans l'app (pas de nouveau système à inventer).

### État rempli

- Icône trombone dans un état visuellement distinct (rempli/coloré) — infobulle : nom du
  fichier + « clic = télécharger + ouvrir WhatsApp ».
- Clic (préventDefault sur la navigation par défaut) déclenche dans le même geste :
  1. **Téléchargement** : un lien `<a>` invisible, `href="/api/requests/:id/pdf/:kind"`,
     `download="<nom du fichier>"`, cliqué puis retiré du DOM.
  2. **Ouverture WhatsApp** : si `whatsappNumber(r.contact_phone)` est lisible, ouverture
     de `https://wa.me/<numéro>` (sans `?text=` → conversation vierge) dans un nouvel
     onglet. Si aucun numéro valide : rien ne s'ouvre, seule l'infobulle le signalait déjà
     à l'avance.
- **Retrait** : une petite croix apparaît en overlay au survol de l'icône remplie ; clic
  dessus → `DELETE /api/requests/:id/pdf/:kind`, puis retour à l'état vide.

### Placement sur la ligne

Dans `.client-line` ([app.js:1276](../../../public/app.js#L1276)) : nom du dossier →
pastille WhatsApp « commande prête » (existante, inchangée) → pastille **devis** →
pastille **facture**.

### Réinitialisation lors de duplication/déplacement

Les deux endroits qui remettent `devis_name`/`bat_name` à `null` lors d'un duplicata ou
déplacement de ligne ([app.js:1897](../../../public/app.js#L1897) et
[app.js:2043](../../../public/app.js#L2043)) doivent aussi réinitialiser `facture_name` —
une facture ou un devis ne se copie pas d'une ligne à l'autre.

## Ce qui ne change pas

La pastille WhatsApp « commande prête » et son message templaté, le kind `bat` (non
câblé, hors scope), le reste du rendu de ligne, l'auth, le SSE, le stockage base64 en
base.

## Cas limites

- **Fichier non-PDF sélectionné** : le serveur accepte aujourd'hui n'importe quel buffer
  non vide sous ces routes (comportement déjà existant pour devis/bat, non modifié ici) ;
  `accept="application/pdf"` sur l'input est un filtre côté client seulement.
- **Pas de numéro WhatsApp** : la pastille facture/devis reste visible et utile pour
  l'archivage ; l'état rempli télécharge sans ouvrir WhatsApp.
- **Retrait puis ré-attachement** : repasse simplement par l'état vide, comme un premier
  upload.
- **Double-clic rapide sur l'état rempli** : chaque clic relance un téléchargement +
  une tentative d'ouverture d'onglet ; pas de verrou nécessaire, effet inoffensif
  (au pire plusieurs onglets/téléchargements).

## Vérification

Pas de framework de test lourd dans ce projet : scripts `node:assert` exécutés un par un
(`npm test` → `test/*.test.js`).

1. **`test/whatsapp.test.js`** : ajouter un cas pour `whatsappLink(num, '', {})` →
   vérifie l'absence de `?text=` (conversation vierge).
2. **Nouveau test serveur** (ou extension d'un test existant) : `PUT` puis `GET` puis
   `DELETE` sur `/api/requests/:id/pdf/facture`, et vérifier que `SELECT` expose bien
   `facture_name`.
3. **Vérification visuelle** via le serveur de preview : upload d'un vrai PDF sur une
   ligne, bascule d'état de l'icône, clic → téléchargement + onglet WhatsApp, croix de
   retrait au survol, vérification que dupliquer/déplacer la ligne ne copie pas la
   facture/devis.
