> ⚠ **DOCUMENT HISTORIQUE.** Écrit avant le 01/09/2026 et jamais relu depuis.
> Il cite des fichiers qui n'existent plus (`public/projet.js`, `public/commande.js`,
> `public/guide.js`), des tables retirées (`production_sectors`) ou des décisions
> annulées depuis. Il dit ce qu'on a pensé ce jour-là, pas ce que le code fait
> aujourd'hui : pour ça, `ARCHITECTURE.md` et `README.md` font foi.

# Du devis multi-références aux lignes de planning

**Date :** 2026-08-31
**Projet :** Planning OLDA
**Statut :** organisation validée avec Charlie · modèle de données PROPOSÉ, pas tranché
**Version illustrée :** https://claude.ai/code/artifact/08a1c05d-391e-444c-8b55-b9c4ad46c1ff
(schéma présentable à l'équipe — mêmes décisions, en image)

## Problème

Le comptoir sait faire deux choses. Il lui en manque une troisième.

1. **La vente directe** marche : le client paie, on produit. Une commande de quatre
   articles entre déjà au planning en **quatre lignes** distinctes, reliées par
   `projects` + `fiche.lot`, chacune avançant à son rythme (les casquettes en
   production pendant que les mugs attendent le fournisseur).
2. **La demande à chiffrer** marche : le besoin est recueilli sans prix, le dossier
   atterrit dans `demande_chiffrage`.
3. **Le devis qui vit n'existe pas.** Il n'y a nulle part d'objet « devis » : pas de
   contenu, pas de version, pas d'historique. Juste une sous-étape `devis_envoye`
   qu'on déplace à la main, une colonne `devis_valide_le`, et un PDF qui vit dans un
   dossier de téléchargement.

Conséquence concrète, mot pour mot de Charlie : un client pro commande 10 S, 5 M,
20 L, 4 XL sur plusieurs références à des prix différents ; on lui sort un devis ;
il rappelle pour **retirer une référence et en ajouter une autre** — et là, *rien ne
bouge nulle part*. On refait le PDF à la main, on ne sait plus quelle version il a
en main, et personne ne sait à quel moment créer les lignes de production.

Trop tôt : le planning se remplit de travail qui n'existera jamais.
Trop tard : on découvre l'acompte encaissé sans qu'aucun poste ne soit au courant.

## Arbitrages tranchés avec Charlie (31/08/2026)

- **Le chiffrage se fait EN DIRECT, devant le client, en toute transparence.** Pas
  d'arrière-boutique. Voir la section 2, c'est la contrainte la plus structurante du
  lot.
- L'écran « Nouveau devis » du patron **s'ajoute derrière** la demande de devis
  existante — il ne la remplace pas.
- Les lignes de production naissent **à la validation du devis**, ni avant ni après.
- Les quatre types de retour client arrivent **tous les quatre**, souvent dans le même
  appel : retirer/ajouter une référence, changer les quantités ou les tailles,
  négocier le prix, ne garder qu'une partie du devis.
- **Mélina pilote** un dossier de bout en bout. **Loïc vise** — mais voir la
  section 2 : le visa ne peut pas bloquer avant l'impression.

## La règle qui range tout

> **Une ligne de planning, c'est un travail à produire. Tant qu'on négocie, il n'y a
> pas de travail : il y a un dossier.**

Tout le reste du document découle de cette phrase. Un devis en négociation n'est pas
de la production, c'est une tâche commerciale : relancer quelqu'un. Ça n'occupe ni une
presse, ni un opérateur, ni un mètre d'étagère.

---

## 1. Les trois temps

### Temps 1 — on négocie · **1 dossier = 1 ligne**

Le dossier arrive au planning en **une seule ligne**, avec son devis v1 attaché.
Chaque retour du client fabrique une **version de plus** : v1 → v2 → v3.

**On ne corrige jamais une version déjà remise au client.** On la duplique et on
modifie la copie. La v1 reste lisible pour toujours : c'est la preuve de ce qu'on a
promis, et le jour où un client conteste, c'est la seule chose qui compte.

La ligne du planning, elle, ne bouge pas d'un cran pendant tout ce temps.

### Temps 2 — la bascule · **le seul geste qui crée du travail**

Le client accepte. Mélina ouvre la dernière version, **coche les lignes qu'il garde**
(le oui partiel est fréquent), et clique une fois. Le dossier éclate.

C'est le seul endroit de tout le parcours qui crée des lignes de production, et il est
**irréversible par construction** : après lui, le devis est gelé.

### Temps 3 — on produit · **N lignes, 1 dossier**

Chaque ligne suit son chemin (`preparation` → `production` → `facturation` →
`paiement`). Le dossier reste au-dessus et porte ce qui appartient au **client** et non
au **produit** : le devis, l'acompte, la facture, la date de retrait. Le dossier est
clos quand sa dernière ligne est close.

---

## 2. Le chiffrage en direct — la contrainte la plus structurante

Charlie, mot pour mot : « le chiffrage, je dois pouvoir le faire en direct… devant le
client… en toute transparence ».

L'écran de devis **n'est pas un formulaire d'arrière-boutique**, c'est un **outil de
vente**. Le client est là, il voit le prix se construire référence par référence. Il
demande « et si j'en prends 50 au lieu de 30 ? » — le dégressif s'applique sous ses
yeux. Il repart avec son devis imprimé, le jour même.

Trois conséquences non négociables :

1. **Aucune validation humaine ne peut bloquer AVANT l'impression.** On ne fait pas
   patienter quelqu'un au comptoir. Le prix du moteur V9 part directement : il est
   juste par construction. Le visa de Loïc ne porte que sur **la remise** — le seul
   nombre vraiment libre — et **seulement au-delà d'un seuil** (voir « à trancher »).
2. **L'écran se lit à DEUX.** Le client regarde par-dessus le comptoir. Le prix par
   référence, la quantité et le total doivent être lisibles de l'autre côté. Le
   **coût de revient et la marge n'ont rien à faire à l'écran à ce moment-là** —
   `requests.cout_revient` existe, il ne descend pas dans la vue de chiffrage.
3. **Le dégressif se recalcule À LA FRAPPE**, sans bouton « calculer ». C'est ce qui
   fait vendre.

L'étape « à chiffrer plus tard » ne disparaît pas : elle ne sert plus qu'aux demandes
arrivées **par téléphone ou par mail**, sans client en face.

---

## 3. Quelles lignes du devis deviennent du travail

Un devis contient des produits, mais aussi du transport, de la vectorisation, des
frais. Les traiter pareil remplit le planning de faux dossiers.

**Une seule question à se poser : est-ce que quelqu'un doit FAIRE quelque chose ?**

| Genre de ligne | Exemple | Devient |
|---|---|---|
| `article` | T-shirt NS300 × 30, Mug × 50 | **une ligne de planning** chacun |
| `prestation` | Vectorisation de logo, Modification de logo | **une ligne de planning** chacun — atelier ou Fiverr, et elle passe **avant** : le BAT en dépend |
| `frais` | Transport aérien groupé, port | **aucune ligne** — un montant sur le dossier, et un délai qui devient `attente_marchandise` sur les articles qu'il retarde |

Le transport ne disparaît donc pas : il devient une **attente visible** sur les lignes
concernées, au lieu d'une ligne fantôme que personne ne sait produire.

---

## 4. Après la bascule : l'avenant

Le devis est **gelé** à la bascule. On ne revient jamais en arrière. Tout changement
postérieur est un **avenant** : un document à part qui ne dit que ce qui change,
chiffré et visé comme un devis.

- **Il ajoute une référence** → une ligne de plus **sur le dossier existant**, pas un
  nouveau dossier. Le client ne veut pas deux numéros.
- **Il retire une référence** → la ligne est **archivée** (`deleted_at`), jamais
  supprimée. Six mois plus tard on doit encore pouvoir dire ce qui est arrivé à ce
  dossier.
- **Il change une quantité** → on corrige la ligne **et on rejoue le chiffrage**.
  Corriger la quantité sans refaire le prix laisse le tarif de la commande d'origine :
  le dégressif du fichier V9 ne s'applique plus, et personne ne le voit passer.
- **Une ligne déjà en production** ne s'annule pas au comptoir. La marchandise est
  achetée, l'encre est posée : c'est une décision de Direction, pas un clic.

---

## 5. Qui fait quoi

Une seule personne pilote un dossier de bout en bout : **Mélina**. Loïc n'intervient
qu'à deux endroits — une remise au-delà du seuil, et l'argent à la fin. Le reste du
temps Mélina n'a personne à attendre : c'est exactement ce qui rend le chiffrage en
direct possible. Charlie et Julien ne voient le dossier qu'**après** la bascule.

| Étape | Ce qui se passe | Qui | Où ça se voit |
|---|---|---|---|
| Prise de besoin | Le client explique, au comptoir ou par téléphone | Mélina | `a_trier` |
| Chiffrage en direct | Devant le client, le moteur V9 sort le prix au fur et à mesure | Mélina | `chiffrage_en_cours` |
| Remise | Sous le seuil : direct. Au-dessus : un mot à Loïc | Mélina / Loïc | `devis_a_viser` — **à créer** |
| Remise du devis | Le client repart avec son PDF, le jour même | Mélina | `devis_envoye` |
| Négociation | v2, v3… sur la **même ligne** | Mélina | `devis_envoye` |
| **LA BASCULE** | Le client dit oui — le dossier éclate | Mélina | `devis_valide` |
| Acompte | Encaissement. Rien ne se commande avant | Mélina | `validation_acompte` |
| Appro & BAT | Commande fournisseur, maquette, validation client | Charlie | `a_commander` · `bat_envoye` |
| Production | DTF, pressage, Trotec, UV, montage, contrôle | Julien | `production/*` |
| Retrait | Facture, client prévenu, commande récupérée | Mélina | `facturation/*` |
| Solde | Contrôle du paiement, clôture, archive | Loïc | `paiement/*` |

---

## 6. Ce qui existe déjà et ne se réécrit pas

Vérifié dans le code au 31/08. **Le tuyau de la bascule est déjà construit** — il n'a
qu'à être branché sur le devis.

- `POST /api/comptoir/...` (server.js) transforme déjà `articles[]` en **N lignes
  `requests`**, dans une **seule transaction**, en créant le `projects` parent quand
  `nbLignes > 1`. Le rollback et la reprise sur empreinte dupliquée sont déjà traités.
- `fiche.lot {rang, total}` relie les lignes d'un même ticket ; `requests.project_id`
  porte le dossier.
- `chiffrage.js` — moteur conforme au fichier V9 du patron. `fiche.chiffrage` conserve
  déjà les **paramètres** (référence, genre, transport, emplacement, tailles, remise,
  majoration) pour **rejouer** un prix quand une quantité change côté serveur.
- `projects.action` / `action_qui` / `action_date` — la **prochaine action datée**
  existe en base. Elle n'a jamais été remplie. C'est elle qui empêche un devis envoyé
  de dormir trois semaines.
- `requests.devis_requis` / `devis_valide_le`, et la sous-étape `devis_valide`.
- `POST /api/devis/numero` — compteur du jour atomique (`app_meta`), série `DEV-`,
  déjà à l'abri de deux comptoirs qui saisissent en même temps.
- `requests.deleted_at` — l'archivage sans suppression, pour l'avenant.

---

## 7. Modèle de données PROPOSÉ (à valider)

> ⚠️ Cette section n'a **pas** été validée par Charlie. Les sections 1 à 6 le sont.

La pièce centrale manquante est un objet **devis versionné**. Sans lui, il n'y a ni
négociation traçable, ni bascule fiable.

```sql
-- Le devis, rattaché au dossier quand il existe, sinon à la ligne unique.
CREATE TABLE IF NOT EXISTS quotes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero       text,            -- DEV-26.08.31-001, du compteur existant
  project_id   uuid,            -- le dossier (null tant qu'il n'y a qu'une ligne)
  request_id   uuid,            -- la ligne unique du temps 1
  client_id    uuid,
  gele_le      timestamptz,     -- posé À LA BASCULE ; après, plus aucune version
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Une version = une PHOTO FIGÉE. On n'en modifie jamais une : on en crée la suivante.
CREATE TABLE IF NOT EXISTS quote_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id         uuid NOT NULL,
  rang             int  NOT NULL,          -- 1, 2, 3…
  auteur           text,                   -- prénom (EQUIPE)
  motif            text,                   -- « il retire les polos »
  remise_pct       numeric(5,2),
  remise_visee_par text,                   -- null = sous le seuil, personne n'a visé
  total_ttc        numeric(12,2),
  cout_revient     numeric(12,2),          -- jamais affiché au comptoir
  remise_au_client_le timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_id, rang)
);

-- Les lignes d'UNE version. `genre` est ce qui pilote la bascule (section 3).
CREATE TABLE IF NOT EXISTS quote_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id   uuid NOT NULL,
  rang         int  NOT NULL,
  genre        text NOT NULL,     -- 'article' | 'prestation' | 'frais'
  designation  text NOT NULL,
  reference    text,
  quantite     int,
  pu_ttc       numeric(12,2),
  total_ttc    numeric(12,2),
  prod         jsonb,             -- même forme que fiche.prod (tailles, zones)
  chiffrage    jsonb,             -- paramètres V9, pour REJOUER le prix
  retenue      boolean,           -- cochée à la bascule (oui partiel)
  request_id   uuid               -- la ligne de planning née d'ici (après bascule)
);
```

**`quote_lines.request_id` est la clé de tout l'après-bascule** : c'est lui qui permet
de dire « cette ligne de planning vient de cette ligne de devis », donc de faire un
avenant qui se tienne.

**Pourquoi trois tables et pas un `jsonb`** — l'habitude du dépôt serait `fiche jsonb`.
Ici ça ne tient pas : la bascule doit **relier chaque ligne de devis à une ligne de
planning**, et un blob ne se joint pas. Une alternative plus légère existe (la version
en `jsonb` figé + une table `quote_lines` seulement pour les lignes retenues) — elle
économise une table au prix d'un modèle à deux formes. À arbitrer.

### Contraintes du dépôt à respecter

- Migrations **réversibles**, jouées dans `db.js` (`init`), **chacune avec sa PROPRE
  garde `app_meta`** — deux incidents réels sont venus d'une garde partagée.
- Les index sur **expression** se créent dans `init()` derrière un `try`, jamais dans
  `schema.sql` : pg-mem ne les connaît pas.
- Rien de tout ça ne descend dans `FICHE_LISTE` : le devis **ne se lit pas** depuis la
  liste du planning, il **se rejoue** au serveur. Une ligne de liste qui traînerait le
  devis entier repartirait vers chaque poste à chaque rafraîchissement.

---

## 8. Ce qu'il reste à construire

1. **L'objet devis versionné** ci-dessus. Pièce centrale.
2. **L'écran de devis qui chiffre en direct**, branché sur le catalogue et le moteur
   V9 : le prix se remet à jour à chaque quantité tapée, sans clic de calcul, et
   l'écran reste **lisible à deux**. Il rend ses lignes à l'application, pas à un PDF
   isolé.
3. **Le bouton de bascule**, avec les cases à cocher du oui partiel et le tri
   automatique `article` / `prestation` / `frais`.
4. **Un seuil de remise** réglable par Loïc (`app_meta`), au-delà duquel le devis passe
   par `devis_a_viser`. En dessous, rien ne bloque et le client repart avec son papier.
5. **La sous-étape `devis_a_viser`**, entre `chiffrage_en_cours` et `devis_envoye`.
6. **L'avenant** : ajouter ou archiver une ligne sur un dossier déjà basculé.

---

## 9. Ce qui reste à trancher (questions posées à Charlie, sans réponse au 31/08)

1. **Le seuil de remise** — un pourcentage (au-delà de 10 %) ou un montant (au-delà de
   2 000 €) ? Ou bien Mélina est totalement libre et Loïc contrôle après coup ?
2. **L'acompte bloque-t-il la commande fournisseur ?** Le document pose « rien ne se
   commande avant l'acompte encaissé ». Si l'atelier commande parfois avant pour tenir
   un délai, il faut le dire — sinon la règle sera contournée dès la première semaine.
3. **La vectorisation de logo** est traitée ici comme une **vraie ligne de planning**
   (quelqu'un doit la faire, et le BAT en dépend), là où le transport ne devient
   aucune ligne. À confirmer que c'est bien comme ça que ça se passe.

---

## 10. Ce qui devra être tenu par des tests

Dans l'esprit du dépôt : les bugs vivent dans la concurrence et dans le réseau qui
tombe, pas dans le cas nominal.

- **Deux postes qui basculent le même devis en même temps** ne doivent produire les
  lignes **qu'une fois**. C'est le même risque que les numéros de ticket.
- **La bascule est tout ou rien** : une seule transaction, comme l'envoi du comptoir.
  Un réseau qui tombe au milieu ne doit ni perdre le dossier, ni en créer deux.
- **Un devis gelé refuse toute nouvelle version.** La garde est en base, pas seulement
  dans l'écran.
- **Le oui partiel** : cocher 3 lignes sur 5 crée exactement 3 lignes de planning, et
  les 2 autres restent lisibles dans la version.
- **Le tri par `genre`** : une ligne `frais` ne crée jamais de ligne de planning.
- **Le prix rejoué** : changer une quantité sur un avenant applique bien le dégressif
  V9, et pas le tarif d'origine.
- **pg-mem** ne verrouille rien : le test de concurrence est vert en local et faux en
  prod. Ce qui protège vraiment, c'est la contrainte en base.
