> ⚠ **DOCUMENT HISTORIQUE.** Écrit avant le 01/09/2026 et jamais relu depuis.
> Il cite des fichiers qui n'existent plus (`public/projet.js`, `public/commande.js`,
> `public/guide.js`), des tables retirées (`production_sectors`) ou des décisions
> annulées depuis. Il dit ce qu'on a pensé ce jour-là, pas ce que le code fait
> aujourd'hui : pour ça, `ARCHITECTURE.md` et `README.md` font foi.

# Nouveau Projet — Design

**Date :** 2026-07-25
**Projet :** Planning OLDA
**Statut :** validé (brainstorming), prêt pour le plan d'implémentation

## Problème

Le patron a construit deux classeurs Excel qui décrivent le flux qu'il veut au comptoir :

- `CRM TASSES OLDA.xlsm` : recherche/création client → création d'un projet (type Tasse /
  T-shirt / Goodies / Signalétique / Reprise Graphique / Autre) → pour la Tasse, un
  calculateur détaillé (type de tasse, coloris, options Face 1 / Face 2 / Dessous, BAT) qui
  sort un prix TTC à recopier dans SumUp pour encaisser.
- `CRM OLDA CREATION CLIENTS.xlsm` : formulaires « Créer un particulier » / « Créer un
  pro-revendeur-association » avec des champs enrichis (ID lisible, raison sociale,
  localisation complète, secteur d'activité…).

Objectif : porter ce flux dans le CRM comme un nouvel onglet **« Nouveau Projet »**,
ultra-minimaliste (façon app de caisse), que n'importe quel employé peut remplir devant un
client en quelques taps. Cet onglet vivra à côté de « Demande » / « Commande » (qui restent
en place) mais est appelé à les remplacer à terme. Seule la Tasse a une grille de prix
détaillée pour l'instant (le patron n'a pas encore fait Textile / Autres / Signalétique) ;
ces types restent donc volontairement sommaires dans ce premier jet.

## Existant réutilisé

- **Table `requests` + colonne `fiche jsonb`** : `commande.js` /
  [server.js:1185](../../../server.js#L1185) y écrit déjà un JSON structuré avec un
  discriminant (`kind: 'commande-atelier'`). Nouveau Projet suit exactement le même
  principe (`kind: 'projet-simple'`) : **aucune nouvelle table pour les projets**, donc
  visible immédiatement dans planning/dashboard/recherche sans rien changer ailleurs.
- **Table `clients` + `POST/PATCH /api/clients`** ([server.js:577](../../../server.js#L577)) :
  la création rapide et la fiche complète réutilisent ces routes existantes, juste avec
  plus de champs whitelistés.
- **`upsertClientFromCommande`** ([server.js:694](../../../server.js#L694)) : réutilisée
  telle quelle pour créer le client depuis le formulaire rapide de Nouveau Projet.
- **Réglages en `app_meta` (JSON)** : le patron édite déjà machines, zones ajoutées au
  comptoir, message WhatsApp de cette façon
  ([db.js:538-608](../../../db.js#L538), pattern `getX`/`setX`). La grille tarifaire tasse
  suit le **même principe** plutôt qu'une nouvelle table SQL — cohérent avec le reste du
  code, pas de migration de schéma pour ça.
- **`catalog.json.commande.delais`** : majorations Jour J (+20 %) / Express (+10 %) déjà
  réglées — réutilisées telles quelles, pas de doublon dans les tarifs tasse.
- **Pattern de création rapide client** (`cmd-auto`, suggestions live, bascule Pro/Perso)
  de [commande.js](../../../public/commande.js) : repris à l'identique pour l'étape 1.

## 1. Écrans

Nouvel onglet nav `#nouveau-projet`, wizard à 3 pages effectives (pas 4 : délai/paiement
rejoint la page produit, comme un ticket de caisse).

### Page 1 — Client
Un seul champ recherche (nom / société / téléphone), suggestions live sur la base clients
existante. Tap sur un résultat → page 2. Sinon bouton **« + Nouveau client »** à côté du
champ → mini-formulaire inline (Pro/Perso, nom, WhatsApp — identique à l'existant dans
Commande), qui crée le client et enchaîne direct sur la page 2. Les champs enrichis (raison
sociale, adresse détaillée, secteur, référent, type Pro/Revendeur/Association/Particulier)
ne sont **pas** demandés ici — ils vivent dans la fiche complète de Base clients, à remplir
plus tard.

### Page 2 — Type de projet
4 tuiles tactiles : **Tasse · Textile · Autres · Plaque signalétique**. Un tap = on avance
direct (pas de bouton « suivant »).

### Page 3 — Produit + panier (une page, façon ticket de caisse)
- **Tasse** (détaillé) : type de tasse (puces, catalogue tarifs), coloris (texte +
  suggestions), quantité, Face 1 / Face 2 / Dessous (puces d'options du catalogue tarifs),
  BAT oui/non, remarque libre. « + Ajouter une autre tasse » empile plusieurs configs dans
  le même projet. Prix TTC total recalculé en direct en bas d'écran (bandeau sticky).
- **Textile / Autres / Plaque signalétique** (sommaire) : description libre + quantité +
  prix TTC saisi à la main. Pas de grille de prix (inexistante côté patron) — même
  structure de ligne que Tasse pour rester homogène niveau code, juste sans les
  sous-champs face/dessous/BAT.
- Bascule discrète « Voir marge » (icône, repliée par défaut) : déplie prix de revient /
  marge HT / taux de marge, jamais visible par défaut devant le client.
- Délai (puces Jour J / Express / 5j / 10j / 15j, réutilise `catalog.json`) + statut
  paiement (puces), sur la même page, sous le panier.
- Bouton « Enregistrer » → popup destination existante (« Où l'enregistrer ? »,
  demande/commande × famille) → écran de confirmation, identiques à Commande.

## 2. Client — champs enrichis (fiche complète, Base clients)

Nouvelles colonnes sur `clients` (migration additive `ADD COLUMN IF NOT EXISTS`, réversible
par `DROP COLUMN IF EXISTS`), remplies uniquement depuis la fiche complète (jamais à la
création rapide) :

| Colonne | Type | Origine (classeur patron) |
|---|---|---|
| `code` | text | ID lisible auto-généré `CLI-PRO-0001` / `CLI-PERSO-0001` |
| `raison_sociale` | text | « Raison sociale » |
| `code_postal` | text | « Code postal » (texte, pas numérique — préfixes 0 valides) |
| `ville` | text | « Ville » |
| `pays` | text | « Pays » |
| `secteur` | text | « Secteur d'activité » (liste des 20 valeurs du patron en suggestion,
  saisie libre autorisée — même philosophie que le reste du catalogue) |
| `referent_prenom` | text | « Référent prénom » |

`client_type` (déjà existante, déjà `'pro'/'perso'/'asso'/'revendeur'` côté `requests`,
[db.js:98](../../../db.js#L98)) porte désormais les mêmes 4 valeurs côté `clients` — la
fiche complète propose Professionnel/Revendeur/Association/Particulier ; la création
rapide continue de ne poser que Pro/Perso.

`code` généré à l'insertion : préfixe `CLI-PERSO-` si `client_type === 'perso'`, sinon
`CLI-PRO-`, suffixe = `(max existant du même préfixe) + 1`, calculé en JS sur les codes déjà
en base (robuste aux suppressions, pas de séquence SQL dédiée).

## 3. Tarifs tasse (Réglages)

Stockés dans `app_meta`, deux clés, même pattern que `machines` :

- `tarifs_tasse_articles` (JSON, liste) — une entrée par ligne du classeur « Tarifs &
  coûts » : `{ id, categorie: 'produit'|'face'|'dessous'|'bat', designation, prixAchat,
  prixVenteTtc, tempsMoMin, tempsMachineMin, actif, position }`. Pré-rempli au premier
  démarrage (seed, comme `seedClients`) avec les valeurs actuelles du classeur (3 tasses,
  6 options face, 6 options dessous, 2 BAT).
- `tarifs_tasse_parametres` (JSON, objet unique) — `{ tauxHoraireMo, tauxHoraireMachine,
  tgca }`, valeurs par défaut 25 / 25 / 0.04 (celles du classeur).

Nouvelle section Réglages : liste éditable (ajout/modif/désactivation, comme les machines),
+ un petit bloc pour les 3 paramètres globaux. Routes `GET/PUT /api/tarifs-tasse` (articles)
et `GET/PUT /api/tarifs-tasse/parametres`, même forme que `GET/PUT /api/machines`.

## 4. Calcul du prix (tasse)

Par ligne : `quantité × (prixVenteTtc(produit) + prixVenteTtc(face1) + prixVenteTtc(face2)
+ prixVenteTtc(dessous) + prixVenteTtc(bat))`, sommé sur toutes les lignes, puis
`+ majoration délai` (catalog.json), `− remise manuelle` (champ € ou %, optionnel) =
**Prix TTC** affiché en direct côté client (JS, recalcul à chaque champ modifié) et
revalidé côté serveur à l'enregistrement (le serveur recalcule depuis les IDs choisis +
`tarifs_tasse_articles` courant, ne fait jamais confiance à un total envoyé par le client).

Marge (uniquement si « Voir marge » activé, jamais imprimé/transmis) :
`prixRevientLigne = quantité × [prixAchat(produit)+prixAchat(face1)+prixAchat(face2)
+prixAchat(dessous)+prixAchat(bat) + (tempsMoMin_total/60 × tauxHoraireMo)
+ (tempsMachineMin_total/60 × tauxHoraireMachine)]` ; `venteHt = totalTtc / (1+tgca)` ;
`margeHt = venteHt − Σ prixRevientLigne` ; `tauxMarge = margeHt / venteHt`.

## 5. Fiche `requests.fiche` (Nouveau Projet)

```jsonc
{
  "kind": "projet-simple",
  "version": 1,
  "type": { "id": "tasse", "label": "Tasse" },   // tasse | textile | autres | signaletique
  "client": { /* même forme que commande-atelier */ },
  "lignes": [
    {
      "uid": 1, "quantite": 2,
      // tasse : ids catalogue + libellés résolus au moment de l'enregistrement
      "produit": { "id": "...", "label": "Tasse Céramique 350 ml", "prixTtc": 10 },
      "coloris": "TC 01 Rouge Blanc",
      "face1": { "id": "...", "label": "Logo OLDA à ajouter", "prixTtc": 8 },
      "face2": { "id": "...", "label": "Texte personnalisé simple", "prixTtc": 6 },
      "dessous": { "id": "...", "label": "Aucune", "prixTtc": 0 },
      "bat": false,
      "remarque": "",
      // textile / autres / signalétique : description + prixTtc saisi à la main à la place
      // des champs produit/face1/face2/dessous/bat.
      "description": null, "prixTtcManuel": null
    }
  ],
  "delai": { "id": "jour_j", "label": "Jour J", "majoration": 20 },
  "remise": { "type": "pourcent|montant", "valeur": 0 },
  "paiement": { "statut": "non_paye", "mode": null },
  "prixTotalTtc": 28.8,
  "margeVisible": false,          // trace si l'employé a consulté la marge, purement informatif
  "deadline": "2026-07-30",
  "priority": 1,
  "stage": "chiffrage", "subStage": "a_chiffrer",
  "createdAt": "2026-07-25T..."
}
```

`POST /api/projets` (nouvelle route, mode `buildProjet` séparé de `buildCommande` — formes
de payload trop différentes pour partager le même parseur) : recalcule le prix serveur,
insère dans `requests` avec `product`/`description` résumés pour la grille (même logique
que `buildCommande`), appelle `upsertClientFromCommande`, `broadcast`.

## Hors scope (explicite, pour ne pas dériver)

- **Remise volume par palier** (onglet « Tarifs volume », 357 lignes) : pas dans ce
  premier jet. Remise manuelle libre (€ ou %) à la place.
- **Mélanger plusieurs types dans un projet** (ex. tasses + t-shirts) : un projet = un
  type ; plusieurs projets si besoin. Peut être revu plus tard si le patron le demande.
- **Suppression de Demande/Commande** : ils restent, inchangés. Nouveau Projet vit à côté.
- **Grille de prix pour Textile/Autres/Signalétique** : sommaire (prix manuel) tant que le
  patron ne l'a pas détaillée comme la tasse.
