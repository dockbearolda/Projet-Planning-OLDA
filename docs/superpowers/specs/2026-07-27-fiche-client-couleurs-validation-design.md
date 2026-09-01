> ⚠ **DOCUMENT HISTORIQUE.** Écrit avant le 01/09/2026 et jamais relu depuis.
> Il cite des fichiers qui n'existent plus (`public/projet.js`, `public/commande.js`,
> `public/guide.js`), des tables retirées (`production_sectors`) ou des décisions
> annulées depuis. Il dit ce qu'on a pensé ce jour-là, pas ce que le code fait
> aujourd'hui : pour ça, `ARCHITECTURE.md` et `README.md` font foi.

# Fiche client Pro/Perso — différenciation couleur + validation forcée

Date : 2026-07-27
Statut : approuvé

## Contexte

La création client "Nouveau Projet" ([public/projet.js](../../../public/projet.js)) et la fiche complète
"Base Clients" ([public/clients.js](../../../public/clients.js)) existent déjà (PR #83/#84) : un formulaire
Perso (4 champs) et Pro (12 champs), avec bouton de création désactivé tant que tout n'est pas rempli côté
Nouveau Projet. Mais :

- Aucune indication visuelle de **ce qui** manque (juste un bouton grisé, silencieux).
- Aucune différenciation couleur entre Pro et Perso (demande explicite : "façon SumUp", couleur légère).
- La fiche "Base Clients" affiche **tous** les champs (dont Type, Contact, Zone) peu importe la nature —
  pas de garde-fou "tout rempli" à la création.
- La liste de champs Pro actuelle (Société, Raison sociale, Contact, Référent, Type, Secteur, Zone, Code
  postal, Ville, Pays, Téléphone, Email) diverge du modèle de référence fourni par l'utilisateur (classeur
  Excel "CRÉATION D'UN CLIENT") : pas de "Type", pas de "Contact" séparé, "Localisation" au lieu de "Zone",
  "WhatsApp" au lieu de "Téléphone".

## Objectif

1. Aligner les champs Pro/Perso sur le modèle de référence, partout dans l'app (Nouveau Projet + Base Clients).
2. Différencier visuellement Pro et Perso par une couleur légère (vert Particulier / ambre Pro), en
   réutilisant la palette existante — pas de nouvelle teinte.
3. Rendre la validation "tout rempli" visible et bloquante à la création, aux deux endroits.
4. Ne rien casser côté API/DB : aucune migration, aucun changement de contrat serveur.

## Périmètre

### 1. Liste de champs partagée (`public/clients.js`)

`FIELDS` reste la source commune (clé, icône, placeholder). Deux changements de libellé uniquement (pas de
renommage de clé, pas de migration) :

- `zone` → libellé **"Localisation"** (clé `zone` inchangée).
- `telephone` → libellé **"WhatsApp"** (clé `telephone` inchangée — déjà utilisé comme WhatsApp dans le
  payload de fiche, `projet.js:709`).

Deux listes exportées, dérivées de `FIELDS`, utilisées par les DEUX écrans (Nouveau Projet et Base Clients) :

```js
export const PERSO_FIELDS = ['prenom', 'nom', 'telephone', 'email'];   // → Prénom, Nom, WhatsApp, Email
export const PRO_FIELDS = [
  'entreprise', 'raison_sociale', 'zone', 'code_postal', 'ville', 'pays',
  'referent_prenom', 'telephone', 'secteur', 'email',
];  // → Nom affiché/Entreprise, Raison sociale, Localisation, Code postal, Ville, Pays,
    //   Référent (prénom), WhatsApp, Secteur d'activité, Email
```

Le champ `type` (texte libre, redondant avec Secteur) est **retiré des deux formulaires** (création +
édition). La colonne DB et le whitelist serveur (`CLIENT_MAX`) restent inchangés : une vieille fiche qui a
déjà une valeur continue de l'afficher en lecture seule dans les sous-titres existants
(`clients.js:262`, `clients.js:377/557`) ; elle n'est simplement plus éditable depuis l'UI. Pas de risque de
perte de données, juste un champ qui devient non-éditable.

Le champ `code` (identifiant généré serveur) et `prenom`/`nom` côté Pro (Contact) sortent aussi du
formulaire Pro — `code` reste affiché en lecture seule uniquement en mode édition (comportement déjà
partiellement en place, à généraliser).

### 2. Rendu nature-aware aux deux endroits

- **Nouveau Projet** (`projet.js`) : déjà nature-aware (`renderQuickForm`), on branche juste les nouvelles
  listes `PRO_FIELDS`/`PERSO_FIELDS` importées de `clients.js` à la place des filtres locaux actuels.
- **Base Clients** (`clients.js`, tiroir de fiche) : actuellement `renderDrawer()` boucle sur `FIELDS` en
  bloc fixe (ligne 421), peu importe la nature. À changer pour boucler sur `PRO_FIELDS`/`PERSO_FIELDS` selon
  `nature(c.client_type)`, et **re-render la liste de champs** quand `setNature()` change la nature (création
  ET édition) — aujourd'hui `setNature` ne fait que basculer les classes CSS du segmented, sans re-render des
  champs.
- `createClient()` (`clients.js:590`) doit itérer sur la liste de champs affichée (pas sur `FIELDS` en
  entier) pour construire le brouillon envoyé au serveur ; pour Perso, dériver `entreprise` de
  `prénom + nom` comme le fait déjà `projet.js:263`.

### 3. Différenciation couleur — palette existante réutilisée

Aucun nouveau token. Réutilisation de la palette d'étapes déjà définie dans `styles.css` (variantes clair +
sombre déjà là) :

- **Particulier** → `--st-livree` / `--st-livree-bg` (vert doux)
- **Pro / Revendeur / Association** → `--st-cours` / `--st-cours-bg` (ambre doux)

Application : un liseré/bandeau léger autour du groupe de champs (bordure gauche colorée + fond
`*-bg` sur le conteneur, comme les badges de statut existants) + icône de section teintée. **Les champs
individuels restent sur fond `--surface` (blanc)** pour la lisibilité — seule l'enveloppe du groupe est
teintée, pas chaque case. Nouvelles classes : `.proj-quick--perso`/`.proj-quick--pro` (Nouveau Projet),
`.cl-fields--perso`/`.cl-fields--pro` (Base Clients), toggle au changement de nature.

### 4. Validation "tout rempli" visible et bloquante

Comportement identique aux deux endroits (Nouveau Projet + Base Clients, création uniquement) :

- Le bouton de création reste **désactivé** tant qu'un champ de la liste affichée est vide (déjà en place
  côté Nouveau Projet, ajouté côté Base Clients : `createClient()` bloque désormais tant que tous les champs
  affichés ne sont pas remplis, alors qu'aujourd'hui seul `entreprise` est requis).
- Une ligne d'état sous les champs indique **précisément** ce qui manque : *"Il manque : Email, Ville"*
  (liste des libellés vides), remplacée par *"Prêt à créer"* (ton succès discret) une fois complet.
- Les champs vides sont surlignés (bordure `--st-bloque`, déjà existant) **seulement** après une tentative
  de clic sur "Créer" avec des champs manquants, ou un blur sur un champ resté vide — jamais au chargement
  initial (formulaire vide par défaut, pas de faux rouge partout dès l'ouverture).
- L'édition d'un client existant (PATCH champ par champ, autosave) garde son comportement actuel — cette
  validation ne s'applique qu'à la **création**.

### 5. Hors périmètre

- Aucune migration SQL, aucun changement de `server.js`/`db.js`/`schema.sql`.
- Aucun changement du contrat `/api/clients` (toujours lenient côté serveur, seul `entreprise` requis —
  la contrainte "tout rempli" reste 100% client-side, comme le documentait déjà le design du 2026-07-27
  précédent).
- Pas de nouveau composant de design system générique (pas de lib de validation) — on suit le pattern déjà
  en place (disable + dataset.key + listeners `input`).

## Tests

- `test/clients.test.js` : vérifier que `PRO_FIELDS`/`PERSO_FIELDS` sont exportés et cohérents avec `FIELDS`
  (mêmes clés valides). Pas de nouveau test serveur nécessaire (aucun changement d'API).
- Vérification manuelle en navigateur (Nouveau Projet + Base Clients, création Pro et Perso, bascule de
  nature, thème clair/sombre, mobile 390px et desktop) avant merge.
