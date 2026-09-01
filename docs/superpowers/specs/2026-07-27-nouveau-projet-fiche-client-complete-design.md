> ⚠ **DOCUMENT HISTORIQUE.** Écrit avant le 01/09/2026 et jamais relu depuis.
> Il cite des fichiers qui n'existent plus (`public/projet.js`, `public/commande.js`,
> `public/guide.js`), des tables retirées (`production_sectors`) ou des décisions
> annulées depuis. Il dit ce qu'on a pensé ce jour-là, pas ce que le code fait
> aujourd'hui : pour ça, `ARCHITECTURE.md` et `README.md` font foi.

# Nouveau Projet — fiche client complète à la création

**Date :** 2026-07-27
**Projet :** Planning OLDA
**Statut :** validé (brainstorming), prêt pour le plan d'implémentation

## Problème

Le formulaire rapide "Nouveau client" de l'onglet **Nouveau Projet**
([projet.js:212](../../../public/projet.js#L212)) ne demande que 2 champs (nom, téléphone)
quel que soit le type de client. Le patron veut que la création capture directement
l'information utile, avec un niveau de détail différent selon la nature du client :

- **Particulier** : Prénom, Nom, Téléphone, Email.
- **Pro** : tous les champs de la fiche complète Base Clients (Société, Raison sociale,
  Contact, Référent, Fonction, Type, Secteur, Zone, Code postal, Ville, Pays, Téléphone,
  Email, Adresse), sauf l'identifiant auto-généré.

Ceci **remplace** la décision prise dans
[2026-07-25-nouveau-projet-design.md](2026-07-25-nouveau-projet-design.md) (page 1 : "les
champs enrichis ne sont pas demandés ici, à remplir plus tard dans Base Clients"). Le
patron veut désormais tout capturer dès la création dans Nouveau Projet.

## Existant réutilisé

- **`FIELDS` + `fieldRow`** ([clients.js:29](../../../public/clients.js#L29) et
  [clients.js:322](../../../public/clients.js#L322)) : liste des champs de la fiche
  complète et son rendu (label, icône, type d'input, formatage téléphone). Exportés et
  réutilisés tels quels dans `projet.js`, pas de duplication de markup.
- **`POST /api/clients`** ([server.js:659](../../../server.js#L659)) : route inchangée,
  seule la société reste obligatoire côté serveur (voir "Validation" ci-dessous).
- **Pattern de migration additive** ([db.js:180](../../../db.js#L180)) : `ADD COLUMN IF
  NOT EXISTS ... text`, réversible par `DROP COLUMN IF EXISTS`.

## 1. Modèle de données

Nouvelle colonne `prenom` (text, nullable) sur `clients` :

- Migration dans `db.js` (même boucle que `code`/`raison_sociale`/etc., ligne 180) :
  up `ALTER TABLE clients ADD COLUMN IF NOT EXISTS prenom text`, down `DROP COLUMN IF
  EXISTS prenom`.
- Ajoutée à `schema.sql` pour les installs neuves.
- Ajoutée à `CLIENT_MAX`/`CLIENT_FIELDS` dans `server.js` (`prenom: 80`) pour être
  acceptée par `POST/PATCH /api/clients`.
- Ajoutée à `FIELDS` dans `clients.js` (label "Prénom", juste avant `nom`) : un prénom
  saisi à la création reste visible et éditable ensuite dans la fiche complète Base
  Clients — ce n'est pas un champ caché au quick-form.

`entreprise` (toujours requis en base) reste alimenté automatiquement pour un particulier
avec `${prenom} ${nom}`.trim(), comme aujourd'hui — préserve recherche, affichage liste et
rapprochement facturation qui reposent dessus.

## 2. Formulaire "Nouveau client" (Nouveau Projet)

Dans `renderQuickForm(nature)` ([projet.js:212](../../../public/projet.js#L212)) :

- **Perso** : 4 champs — Prénom, Nom, Téléphone, Email — rendus via `fieldRow` importé de
  `clients.js`, sous-ensemble `FIELDS.filter(f => ['prenom','nom','telephone','email']
  .includes(f.key))`.
- **Pro** : tous les champs de `FIELDS` sauf `code` (généré automatiquement, jamais saisi
  à la création — `FIELDS.filter(f => f.key !== 'code')`).
- Le bouton "Créer et continuer" construit le payload en lisant `input.dataset.key` sur
  chaque champ rendu (générique, pas de liste de champs codée en dur dans le handler de
  clic).

### Mise en page

`.proj-quick` passe d'un flex-wrap (pensé pour 2 champs) à une grille responsive :
1 colonne en dessous de 720px (mobile, tablette portrait), 2 colonnes au-dessus (desktop,
tablette paysage). Cibles tactiles ≥44px conservées.

## 3. Validation

**Tous les champs affichés sont obligatoires**, pour les deux natures (perso comme pro,
comme validé) :

- Bouton "Créer et continuer" **désactivé** tant qu'un champ requis affiché est vide.
  Recalculé à chaque `input` sur le formulaire.
- Cette règle est **uniquement côté client, dans le quick-form de Nouveau Projet**. La
  validation serveur de `POST /api/clients` n'est **pas** durcie : elle reste "société
  obligatoire, reste optionnel", parce que cette même route sert aussi le "Nouveau client"
  de l'onglet Base Clients ([clients.js:602](../../../public/clients.js#L602)), qui doit
  continuer à permettre une fiche partielle créée à la main.
- Email : format déjà validé côté serveur (regex existante) — pas de nouvelle règle, le
  message d'erreur serveur remonte via le `window.alert` déjà en place en cas de rejet.

## 4. Tests

- `test/clients.test.js` : cas ajouté couvrant la colonne `prenom` (acceptée par `POST
  /api/clients`, relue telle quelle).
- Vérification manuelle en navigateur (dev server) des deux parcours (perso, pro) : champs
  affichés, bouton désactivé/activé selon remplissage, client créé visible avec tous ses
  champs dans la fiche complète Base Clients.

## Hors scope (explicite)

- **Validation serveur stricte** ("tout obligatoire" appliqué aussi à `POST /api/clients`
  lui-même, donc aussi à la création depuis Base Clients) : pas dans ce jet, à revoir si le
  patron le demande explicitement plus tard.
- **Champ `prenom` pour le référent pro** : `referent_prenom` existe déjà et reste
  inchangé ; `prenom` est un champ distinct, réservé à l'identité du particulier.
