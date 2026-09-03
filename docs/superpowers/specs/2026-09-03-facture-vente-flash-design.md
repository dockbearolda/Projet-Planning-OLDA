# Facture — Vente Flash

Décidé avec Charlie le 03/09/2026, via `#vente` (l'onglet Vente actuel) : le devis
flash produit déjà un document de qualité, chiffré en direct devant le client. La
demande est d'obtenir la même chose pour une **facture professionnelle, reconnue
comptablement** — un document qui engage la maison, pas un bon de commande qui en
tient lieu faute de mieux.

## 1. Ce que ce lot livre, et ce qu'il ne livre pas

**Livré** :
- Le document **Facture** — quatrième papier de la maison, quatrième module après
  ticket/bureau/devis, posé sur le même socle `papier.js`.
- Un nouvel écran de composition, **« Vente Flash »** (`#vente-flash`), jumeau du
  devis flash : catalogue, base clients, feuille A4 vivante à droite.
- Une **table `invoices`**, ledger immuable, numérotation continue par année
  (`FA-2026-0001`), jamais de trou, jamais de ligne modifiée après émission.

**Pas livré, noté pour plus tard** :
- Les avoirs (annulation/correction d'une facture déjà émise).
- Le règlement partiel sur une facture (une facture Vente Flash sort toujours
  soldée — voir §4).
- La conversion d'un devis déjà accepté en facture.
- Le retrait de `public/comptoir/vente-directe.html` — il continue de tourner tel
  quel, sans y toucher. Vente Flash s'installe À CÔTÉ, exactement le chemin suivi
  par le devis flash avant de remplacer `#devis` (voir mémoire
  `devis-flash-remplace-devis`) : on compare, on complète les champs manquants au
  fil de l'usage réel, on ne bascule que quand la parité est là.

**Pourquoi ce découpage** : `vente-directe.html` + `pont.js` + la route
`POST /api/comptoir/projet` portent une mécanique déjà éprouvée — idempotence par
empreinte, découpe d'un panier en plusieurs lignes de planning, routage vers la
production (textile V9, gravure), et **55 dossiers réels** ont déjà buté dessus une
fois (comptoir-simplifie-2026-08-27). La réécrire au premier lot pour livrer une
facture serait le mauvais chantier au mauvais moment. Vente Flash **appelle** cette
route, elle ne la remplace pas.

## 2. Le document — `public/facture.js`

Même construction que `devis.js` (modèle pur `modeleFacture`, rendu pur
`dessinerFacture`, feuille autonome `CSS_FACTURE`), posée sur le socle
`papier.js` (`JETONS_PAPIER`, `SOCLE_PAPIER`, `maisonPapier`) — même encre, même
filet, même marge, même règle « un champ vide ne s'imprime pas » que les trois
autres papiers.

**⚠️ Deux pièges déjà payés, à reporter ici aussi** (voir `papier.js`, `devis.js`) :
1. Aucun accent grave dans `CSS_FACTURE` — le caractère termine le gabarit,
   `node --check` passe quand même, l'écran s'ouvre nu.
2. Aucun jeton `charte.css` dans la feuille — le cadre d'impression ne reçoit que
   cette chaîne, un `var(--pas-3)` y vaut la chaîne vide.

**Le calcul d'argent réutilise `calculerDevis` de `devis.js` telle quelle** — HT,
TTC, taxe, régime (TGCA / revente / export), arrondi commercial, ajustement
global. Un seul moteur d'arithmétique commerciale pour les deux documents ; en
écrire un second serait le genre d'écart qui finit par se contredire sur le
document qui sert à facturer (voir §10, tests).

**Ce qui distingue la facture du devis** :
- Titre `FACTURE`, numéro continu `FA-2026-0001` (voir §3), jamais réinitialisé
  dans l'année.
- Pas de bloc acompte/solde. Un bloc **règlement** : mode de paiement (CB /
  espèces / virement / mixte — même `MODES` que `bureau.js`), montant réglé =
  TTC. Le §4 explique pourquoi c'est une contrainte, pas une simplification
  d'affichage.
- Un pied **mentions légales fixe**, en plus des mentions déjà réglées (SIRET,
  APE, RCS, TVA, capital, déjà portées par `maisonPapier`) : conditions de
  règlement, pénalité de retard, indemnité forfaitaire de recouvrement (40 €).
  Texte codé en dur dans `facture.js`, comme le texte du BAT et du délai sur le
  devis — pas un réglage.

  **⚠️ Ce texte n'est PAS une validation juridique.** Je ne suis pas comptable,
  et Saint-Martin a son propre régime fiscal (TGCA, distinct de la TVA
  métropolitaine et de ses citations légales comme l'article 293 B du CGI). Le
  texte posé ici est un standard raisonnable pour un document commercial, formulé
  en restant générique sur le régime de taxe (il reprend le libellé du `régime`
  déjà choisi par la vendeuse — TGCA / Revente / Export — sans inventer de
  citation d'article). **Charlie doit le relire avant de s'appuyer dessus en cas
  de contrôle.**

## 3. La base — `invoices`, un ledger, jamais réécrit

```sql
CREATE TABLE IF NOT EXISTS invoices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero       text NOT NULL UNIQUE,        -- "FA-2026-0001"
  annee        int  NOT NULL,               -- pour retrouver l'année sans parser numero
  rang         int  NOT NULL,               -- rang dans l'année
  dossier_id   uuid NOT NULL UNIQUE REFERENCES requests(id),
  client_nom   text NOT NULL,               -- dénormalisé, pour lister/chercher — jamais relu pour recalculer
  montant_ttc  numeric(12,2) NOT NULL,
  emise_le     timestamptz NOT NULL DEFAULT now(),
  emise_par    text,                        -- le poste, comme fiche.poste ailleurs
  document     jsonb NOT NULL,              -- le modèle COMPLET tel qu'imprimé (sortie de modeleFacture)
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_dossier_idx ON invoices (dossier_id);
```

**Aucune route PUT/PATCH/DELETE n'existe sur cette table, jamais.** Une facture
émise ne se corrige pas — elle se conteste par un avoir (hors scope, §1).

**`document` porte le modèle entier**, identité de la maison comprise, TELLE
QU'ELLE ÉTAIT à l'émission : un changement plus tard dans Réglages › Identité de
l'atelier ne doit jamais réécrire une facture déjà sortie. Même principe que « le
prix est figé » sur `fiche.devis` (voir mémoire
`prix-catalogue-ne-retarife-rien`). Le `GET` de relecture ne recalcule rien, il
formate `document` tel quel.

**`dossier_id` est `UNIQUE` et `NOT NULL`** : une facture Vente Flash naît
toujours d'un dossier déjà créé par `/api/comptoir/projet` (§4), et un dossier ne
porte au plus qu'une facture en v1 — pas de réémission partielle.

### Numérotation, sans trou

`app_meta.facture_seq_<année>`, incrément atomique, même mécanique que
`reserverNumeroDuJour` (`ON CONFLICT ... DO UPDATE SET value = (value::int+1)`).

**Différence volontaire avec le numéro de devis** : le devis réserve son numéro
CÔTÉ ÉCRAN, avant même d'enregistrer le dossier — un devis imprimé puis abandonné
laisse un trou dans la série, et c'est tolérable pour un document sans valeur
comptable. Une facture ne peut pas se permettre ce trou : **la réservation du
numéro et l'insertion de la ligne `invoices` se font dans LA MÊME transaction**
côté serveur. Un rejet (données invalides, coupure avant écriture) annule les
deux ensemble. Une resoumission après perte de réponse réseau (le grand classique
du dépôt — voir `comptoir-dossiers-perdus-silence`) retombe sur la ligne déjà
créée via `UNIQUE(dossier_id)` au lieu de brûler un second numéro :

```
1. SELECT * FROM invoices WHERE dossier_id = $1    -- retombée idempotente
   → si trouvé : renvoyer tel quel, AUCUN numéro consommé
2. sinon : BEGIN
     réserver le numéro (app_meta, même transaction)
     INSERT INTO invoices (...)
   COMMIT   -- ou ROLLBACK complet si l'insertion échoue : le numéro n'est pas perdu
```

Comme `/api/devis` et `/api/comptoir/projet`, la route passe par
`unDossierALaFois` pour fermer la fenêtre de concurrence entre l'étape 1 et
l'étape 2 (deux requêtes simultanées pour le même dossier).

## 4. Pourquoi le règlement complet, sans solde

Une facture Vente Flash sort TOUJOURS soldée : mode de paiement obligatoire,
montant réglé = TTC. Une commande avec acompte reste un **devis** tant qu'elle
n'est pas soldée — la facture n'arrive qu'au règlement final, exactement comme un
commerce le ferait : on ne facture pas ce qui reste dû, on facture ce qui a été
payé. C'était la question posée à Charlie, tranchée le 03/09.

## 5. Le serveur — routes

- **`POST /api/comptoir/projet`** — inchangé. Vente Flash construit le même
  payload que `pont.js` (client, `articles[]` avec `label`/`qty`/`prod`/
  `chiffrage`, `amount`, `paiement.mode`) pour créer le dossier. Tout le routage
  production, l'idempotence par empreinte, la découpe en plusieurs lignes de
  planning : préservés sans y toucher.
- **`POST /api/factures`** — reçoit `{ dossierId, client, lignes, calcul, mode }`
  (le modèle composé côté écran). Valide, applique la séquence idempotente du
  §3, répond `{ id, numero, document }`.
- **`GET /api/requests/:id/facture`** — relit la facture d'un dossier (404 si
  aucune) pour réaffichage/réimpression depuis la fiche. Lecture seule du JSON
  stocké, aucun recalcul, aucun appel à `identiteAtelier()`.

## 6. L'écran — `public/vente-flash.js`

Jumeau du devis flash : même coupe en deux (saisie à gauche, feuille vivante à
droite), même client picker (base clients via `/api/clients`), même sélecteur
d'articles catalogue (produits + textile chiffré au moteur V9), même grammaire de
champ partagée (`.fa`, `.devis-flash` dans `fiche-atelier.css` — voir mémoire
`fiche-prend-la-grammaire-du-comptoir`).

**Extraction plutôt que troisième copie** : le bloc « choisir un article au
catalogue » (recherche, ajout, quantité, remise, sous-champs de marquage) existe
déjà en substance dans `devis-flash.js` et dans le comptoir. L'implémentation
extrait ce bloc dans un module partagé (nom et découpe précis à trancher au
moment du plan) importé par `devis-flash.js` ET `vente-flash.js` — pas une
troisième version qui diverge à la première correction.

**Bouton final « Émettre la facture »** :
1. `POST /api/comptoir/projet` → `dossierId`.
2. `POST /api/factures` avec ce `dossierId` et le modèle composé.
3. Impression automatique du papier (même mécanique que `imprimer()` dans
   `devis-flash.js` : cadre `<iframe>` hors écran, `CSS_FACTURE` injecté,
   `print()`).

**Nouvel onglet** dans la barre du haut, `#vente-flash`, à côté de
« Devis Flash » (`viewDevisFlash`) — même hauteur `--ctrl-h`, même grammaire de
`nav-switch-btn` (voir CLAUDE.md, « TOUT CE QUI PEUT ÊTRE À LA MÊME HAUTEUR
L'EST »).

## 7. Ce qui ne change pas

- `public/comptoir/vente-directe.html`, `public/comptoir/pont.js` : intacts.
- `public/bureau.js` (bon de commande) : intact. Il continue de servir sur les
  dossiers qui n'ont pas de facture (devis, commandes anciennes).
- `public/ticket.js` : intact.
- Le taux de TGCA, le tarif de transport, l'identité de l'atelier : lus depuis
  les Réglages existants, comme le devis.

## 8. Migration

Réversible, garde `app_meta` propre à elle (`invoices_table_v1` ou équivalent),
jouée dans `db.js` (`init`), comme toutes les autres. Pas d'index sur expression
ici — `dossier_id` et `numero` suffisent en index/contrainte ordinaires,
compatibles pg-mem sans détour.

## 9. Ce qui devra être tenu par des tests

Dans l'esprit du dépôt : les bugs vivent dans la concurrence et le réseau qui
tombe, pas dans le cas nominal.

- **L'addition tombe juste** sur `modeleFacture`, par construction (héritée de
  `calculerDevis` — déjà tenu côté devis, à rejouer côté facture pour vérifier
  que le nouveau modèle ne recalcule rien en double).
- **Aucun accent grave / aucun jeton `charte.css`** dans `CSS_FACTURE` — les deux
  pièges déjà payés sur les trois autres papiers.
- **Champ vide ne s'imprime pas**, comme les trois autres papiers.
- **Deux émissions concurrentes pour le même dossier** ne consomment qu'un seul
  numéro et ne créent qu'une seule ligne `invoices` (le test de concurrence
  reste vert en local par accident — pg-mem ne verrouille rien — donc c'est la
  contrainte `UNIQUE(dossier_id)` en base qui protège vraiment, pas le test).
- **Un rejet (validation) ne consomme pas de numéro** : deux tentatives, la
  seconde valide, portent un numéro consécutif sans trou.
- **Immutabilité** : aucune route d'écriture après création ; changer
  `app_meta.entreprise` après coup ne modifie pas une facture déjà émise
  (`document` stocké reste identique).
- **`test/meme-hauteur.test.js`** reste vert sur le nouvel onglet et le nouvel
  écran.
- **`POST /api/comptoir/projet` n'est pas altéré** : les tests existants sur
  cette route (idempotence, découpe en lot, routage production) restent verts
  sans modification.

## 10. Ce qui reste à trancher (au moment du plan)

1. Le nom et la découpe exacts du module extrait pour le choix d'article
   catalogue.
2. Le texte exact des mentions légales (Charlie à valider — voir §2).
3. Où, dans la fiche (modale Ticket/Bon de commande existante), le bouton
   « Facture » vient se greffer pour rouvrir une facture déjà émise.
