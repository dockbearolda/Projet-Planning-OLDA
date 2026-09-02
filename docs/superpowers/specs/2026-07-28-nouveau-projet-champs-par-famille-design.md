> ⚠ **DOCUMENT HISTORIQUE.** Écrit avant le 01/09/2026 et jamais relu depuis.
> Il cite des fichiers qui n'existent plus (`public/projet.js`, `public/commande.js`,
> `public/guide.js`), des tables retirées (`production_sectors`) ou des décisions
> annulées depuis. Il dit ce qu'on a pensé ce jour-là, pas ce que le code fait
> aujourd'hui : pour ça, `ARCHITECTURE.md` et `README.md` font foi.

# Nouveau Projet — champs détaillés par famille

**Date :** 2026-07-28
**Projet :** Planning OLDA
**Statut :** validé (brainstorming), prêt pour le plan d'implémentation

## Problème

Dans l'onglet **Nouveau Projet**, seule la **Tasse** a un vrai formulaire (grille tarifaire,
faces, dessous, BAT). **Textile**, **Autres** et **Plaque signalétique** se saisissent en
« description libre + quantité + prix » ([projet.js:622](../../../public/projet.js#L622)) :
l'atelier reçoit une phrase, pas une fiche de production. Le patron a écrit la liste exacte
des champs qu'il veut par famille — c'est ce que ce jet implémente.

## Arbitrages tranchés avec le patron

1. **Le paiement reste au niveau du projet** (un seul bloc, en bas), pas par produit : on
   encaisse une fois pour tout le panier, et c'est ce que les colonnes `requests.paye` /
   `acompte_*` / `paiement_mode` savent stocker.
2. **Prix : la grille tarifaire pré-remplit, l'employé peut écraser.** La tasse propose son
   prix calculé, modifiable à la main ; Textile / Autres / Signalétique sont en saisie
   manuelle. On tape le HT ou le TGCA, l'autre se calcule seul.
3. **Tailles : grille chiffrable** (Taille unique · XS · S · M · L · XL · 2XL · Autre), comme
   la Saisie détaillée existante. La quantité de la ligne = la somme de la grille.
4. **4 tuiles conservées** : « Plaque signalétique » reste séparée, avec le même jeu de
   champs qu'« Autres ».

## Existant réutilisé

- **`GET /api/commande/catalog`** ([server.js:886](../../../server.js#L886)) : sert déjà
  `vetements`, `taillesGrille`, `zones` (emplacements, y compris ceux ajoutés au comptoir),
  `typos`. `projet.js` le charge au démarrage **au lieu de recopier ces listes** — un
  emplacement ajouté depuis la Saisie détaillée apparaît aussitôt dans Nouveau Projet.
- **`colorSwatches`** ([projet.js:534](../../../public/projet.js#L534)) : les pastilles de
  coloris de la tasse servent telles quelles au textile.
- **`choiceChips` / `groupBox` / `qtyStepper` / `segBar`** : toutes les briques tactiles du
  formulaire existent, rien de neuf côté UI de base.
- **`fiche jsonb`** : aucun changement de schéma SQL. Les nouveaux champs vivent dans le
  JSON déjà stocké, `version` passe de 3 à 4.
- **`readTexte` / `trimOrNull` / bornes `TEXTE_MAX` / `REMARQUE_MAX`**
  ([server.js:849](../../../server.js#L849)) : validation des nouveaux textes.

## 1. Champs par famille

### TEXTILE (`type: 'textile'`) — nouveau formulaire détaillé

| Champ | Saisie |
|---|---|
| Désignation produit | texte + suggestions `catalog.vetements` (T-shirt, Polo, Sweat…) |
| Référence | texte libre |
| Couleurs | pastilles `COLORIS` + « Autre » (texte libre) |
| Tailles | **grille chiffrable** : Taille unique, XS, S, M, L, XL, 2XL, + « Autre » (libellé libre + qté) |
| Qté | **déduite** de la grille (somme), affichée en lecture seule |
| Face Avant | Emplacement · Type de logo · Référence logo · Couleur de marquage |
| Face Arrière | les 4 mêmes champs |
| Remarques | zone de texte |
| Prix unitaire HT / TGCA | 2 champs liés (cf. §3) |

- **Emplacement** : puces `catalog.zones`. Seuls les emplacements courants
  (`principal` : Cœur, Dos, Avant, Manches, Poitrine) sont montrés ; les 6 autres
  attendent derrière « ⋯ Autres emplacements ». Sans ce repli, une saisie textile
  ouvre sur 24 puces (12 × 2 faces) avant même la première décision.
- **Type de logo** : puces `catalog.typeLogos` — **nouvelle liste dans `catalog.json`** :
  Logo client · Logo OLDA · Texte · QR code · Photo · Autre.
- **Référence logo** et **Couleur de marquage** : textes libres.
- Une face dont l'emplacement n'est pas choisi n'est pas enregistrée (pas de face vide dans
  la fiche de production).

### TASSE (`type: 'tasse'`) — enrichie, l'existant est conservé

Conservé tel quel : quantité, type de tasse, coloris, puces tarifées Face 1 / Face 2 /
Dessous, BAT. **Ajouté** :

| Champ | Saisie |
|---|---|
| Face 01 (anse à droite) — Logo ou texte à graver | texte libre, sous la puce tarifée |
| Face 02 (anse à gauche) — Logo ou texte à graver | texte libre |
| Dessous — Logo à graver | texte libre |
| Typo utilisée | texte + suggestions `catalog.typos` |
| Remarques | zone de texte (le champ `remarque` existe déjà dans le modèle mais n'était pas affiché) |

Les puces tarifées disent **ce qu'on facture** (« Texte personnalisé simple », 6 €), les
nouveaux textes disent **ce qu'on grave** (« OLDA — Grand Case »). Les deux sont utiles :
l'une pour le prix, l'autre pour la machine.

Le bloc marquage (faces / dessous / BAT / typo) reste replié par défaut derrière
« Ajouter un marquage », comme aujourd'hui.

### AUTRES et PLAQUE SIGNALÉTIQUE (`type: 'autres' | 'signaletique'`) — nouveau formulaire

| Champ | Saisie |
|---|---|
| Désignation projet | texte libre (**obligatoire**) |
| Explication du projet | zone de texte |
| Matière à utiliser | texte libre |
| Format | texte libre |
| Méthode de production | texte libre |
| Qté | stepper `− 1 +` |
| Prix unitaire HT / TGCA | 2 champs liés (cf. §3) |

Remplace l'unique champ « Description ». Les deux types partagent le même formulaire.

## 2. Paiement (projet, une seule fois)

Le bloc à 3 interrupteurs (`acompteDemande` / `acompteVerse` / `paye`) est remplacé par
**un statut à 5 valeurs**, plus les montants et modes associés :

| Statut (`id`) | Libellé |
|---|---|
| `non_demande` | Non demandé |
| `acompte_demande` | Acompte demandé |
| `acompte_recu` | Acompte reçu |
| `a_encaisser` | Paiement à encaisser |
| `paye` | Payé |

Champs conditionnels, affichés seulement quand ils ont un sens :

- **Montant TTC de l'acompte reçu** : si statut = `acompte_recu`.
- **Mode de paiement acompte reçu** (CB / Espèces / Virement bancaire) : si statut = `acompte_recu`.
- **Mode de paiement final** (CB / Espèces / Virement bancaire) : si statut = `paye`.

### Projection sur les colonnes du planning

La fiche garde le statut exact ; les colonnes existantes en reçoivent la projection, pour
que grille, dashboard et tiroir continuent de fonctionner sans rien changer :

| Statut | `acompte_demande` | `acompte_verse` | `paye` |
|---|---|---|---|
| `non_demande` | `null` | `null` | `null` |
| `acompte_demande` | `true` | `false` | `false` |
| `acompte_recu` | `true` | `true` | `false` |
| `a_encaisser` | `false` | `false` | `false` |
| `paye` | `null` | `null` | `true` |

`null` = « on ne se prononce pas », convention déjà en place
([schema.sql](../../../schema.sql), `readPaiement` [server.js:1321](../../../server.js#L1321)).
`acompte_montant` ← montant de l'acompte reçu. `paiement_mode` ← **mode final s'il existe,
sinon mode de l'acompte** : la colonne est unique, elle porte le mode le plus récent ; les
deux modes restent intacts dans la fiche.

## 3. Prix unitaire HT ↔ TGCA

Deux champs côte à côte sur chaque ligne, quel que soit le type :

- Taper le **HT** calcule le **TGCA** (`× (1 + tgca)`), taper le **TGCA** calcule le **HT**
  (`÷ (1 + tgca)`), avec le taux des Réglages (`tarifs_tasse_parametres.tgca`, 4 % par défaut).
- Le **TTC reste la référence stockée** (`prixUnitaireTtc`) : c'est déjà l'invariant du
  projet (« le prix de référence est le TTC saisi, le HT est calculé »,
  [spec pipeline 5 familles](2026-07-28-pipeline-5-familles-argent-client-design.md)). Le HT
  envoyé par le client n'est jamais cru : le serveur le recalcule depuis le TTC.
- **Tasse** : les deux champs sont pré-remplis depuis la grille tarifaire et se
  remettent à jour tant que l'employé n'y a pas touché. Dès qu'il saisit un prix, c'est le
  sien qui compte (un petit « ↺ Prix du catalogue » permet de revenir au calcul).
- **Total ligne** = `quantité × prixUnitaireTtc`. Le total projet et la majoration de délai
  ne changent pas de formule.
- La **marge** continue de s'appuyer sur la grille (`prixAchat`, temps MO/machine) : un prix
  écrasé change la vente, pas le coût de revient. Une ligne sans grille (textile, autres)
  garde un coût de revient nul, comme aujourd'hui.

## 4. Ce que voit l'atelier (tiroir de détail)

`ficheItemsProjetSimple` ([app.js:1974](../../../public/app.js#L1974)) n'affiche
aujourd'hui que `produit`/`coloris`/options ou `quantité × description`. Il est étendu pour
rendre les nouveaux champs — sans quoi la saisie ne servirait à rien en production :

- **Textile** : `10 × Polo — réf. PL-450 · Noir · M×4 · L×6`, puis une sous-ligne par face
  (`Avant · Logo client · LOGO-2024.ai · Blanc`), puis la remarque.
- **Tasse** : les textes gravés (`Face 1 : OLDA Grand Case`), la typo, la remarque.
- **Autres / Signalétique** : explication, matière, format, méthode.

Le serveur continue de construire `description` (résumé lisible d'une ligne) pour chaque
type : c'est ce que lisent la grille (`product`), la recherche et les fiches v3 déjà en
base. Les fiches enregistrées avant ce changement restent lisibles telles quelles.

## 5. Modèle `requests.fiche` — version 4

```jsonc
{
  "kind": "projet-simple",
  "version": 4,                     // v3 = suivi paiement ; v4 = champs détaillés par famille
  "lignes": [
    { "type": { "id": "textile", "label": "Textile" }, "quantite": 10,
      "designation": "Polo", "reference": "PL-450", "coloris": "Noir",
      "tailles": [ { "taille": "M", "quantite": 4 }, { "taille": "L", "quantite": 6 } ],
      "faces": [
        { "face": "avant", "faceLabel": "Face avant",
          "emplacement": { "id": "coeur", "label": "Cœur" },
          "typeLogo": { "id": "logo_client", "label": "Logo client" },
          "referenceLogo": "LOGO-2024.ai", "couleurMarquage": "Blanc" }
      ],
      "remarque": "Coutures renforcées",
      "prixUnitaireTtc": 18.72, "prixUnitaireHt": 18,
      "description": "10 × Polo — réf. PL-450 · Noir · M×4 · L×6" },

    { "type": { "id": "tasse", "label": "Tasse" }, "quantite": 2,
      "produit": { "id": "…", "label": "Tasse Céramique 350 ml", "prixTtc": 10 },
      "coloris": "Blanc",
      "face1": { "id": "…", "label": "Texte personnalisé", "prixTtc": 6 },
      "face1Texte": "OLDA — Grand Case",
      "face2": null, "face2Texte": null,
      "dessous": null, "dessousTexte": null,
      "typo": "Bebas Neue", "bat": true, "remarque": null,
      "prixUnitaireTtc": 16, "prixUnitaireHt": 15.38, "prixCatalogue": true },

    { "type": { "id": "autres", "label": "Autres" }, "quantite": 1,
      "designation": "Enseigne vitrine", "explication": "Lettrage découpé, pose comprise",
      "matiere": "PVC 5 mm", "format": "120 × 40 cm", "methode": "Découpe laser + peinture",
      "prixUnitaireTtc": 260, "prixUnitaireHt": 250,
      "description": "1 × Enseigne vitrine" }
  ],
  "paiement": {
    "statut": { "id": "acompte_recu", "label": "Acompte reçu" },
    "acompteMontant": 50,
    "modeAcompte": { "id": "especes", "label": "Espèces" },
    "modeFinal": null,
    "acompteDemande": true, "acompteVerse": true, "paye": false,   // projection, cf. §2
    "mode": { "id": "especes", "label": "Espèces" }                // = modeFinal ?? modeAcompte
  }
}
```

`buildLigneSommaire` est remplacé par deux constructeurs — `buildLigneTextile` et
`buildLigneAutres` — à côté de `buildLigneTasse`, choisis sur `type.id`. Le champ `detaille`
de `PROJET_TYPES` disparaît (les trois familles ont désormais leur propre constructeur).

## 6. Tests

- `test/projet.test.js` : une ligne textile complète (grille de tailles → quantité, faces
  résolues, prix unitaire), une ligne autres, une tasse avec prix écrasé, les 5 statuts de
  paiement et leur projection sur les colonnes, le refus d'une ligne textile sans taille et
  d'une ligne autres sans désignation.
- Vérification navigateur (dev server local, jamais Railway avant validation du patron) :
  saisie des 3 familles, contrôle du tiroir de détail, iPhone 390 px + Galaxy Tab A9+ en
  1280×800 et 800×1280.

## Hors scope (explicite)

- **Grille tarifaire pour le textile / les autres** (l'équivalent des tarifs tasse) : le
  patron ne l'a pas écrite, la saisie reste manuelle.
- **Édition de ces champs depuis le tiroir de la grille** : le tiroir les **affiche** ;
  les modifier se fait en reprenant le projet, comme pour l'existant.
- **Modes de paiement en colonnes séparées** (`paiement_mode_acompte` / `_final`) : les deux
  vivent dans la fiche, la colonne unique garde le mode le plus récent. À revoir si le
  patron veut filtrer le planning là-dessus.
