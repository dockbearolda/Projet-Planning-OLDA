# Chaque ligne porte son BAT, son devis et sa facture — 04/09/2026

> Cahier. **Rien n'est codé** : ce document dit ce qui existe, ce qui manque
> (mesuré, pas supposé), ce que Charlie a tranché le 04/09, et dans quel ordre
> construire. Il se lit avant d'écrire une ligne.

---

## 1. Ce qui est demandé

Charlie, 04/09 :

> « Lorsque ma vendeuse crée une nouvelle ligne, que ce soit dans vente flash ou
> devis flash, la ligne créée contienne automatiquement le devis ou la facture à
> l'intérieur. À l'intérieur de chaque ligne je dois pouvoir rapidement créer un
> BAT, un devis ou une facture. Il faut de la simplicité et de l'efficacité.
> Chaque ligne a son propre BAT, sa facture et son devis. Quand Mélina rentre
> les informations sur une commande de t-shirts, le BAT doit déjà être
> pré-rempli avec les t-shirts, la bonne couleur, etc., qu'on n'ait plus qu'à
> ajouter les logos, avant, arrière ou autre. »

Trois exigences, et elles ne coûtent pas la même chose :

| | Exigence | État |
|---|---|---|
| **A** | La ligne PORTE ses documents | La plomberie existe, personne ne dépose |
| **B** | Depuis la ligne, en créer un rapidement | Le BAT est **injoignable** ; devis/facture sont ailleurs |
| **C** | Le BAT arrive **pré-rempli** | Impossible aujourd'hui : la donnée n'atteint pas le dossier |

C'est **C** qui commande tout. Un BAT ne peut pas se pré-remplir avec des
tailles et des couleurs que le dossier ne porte pas — et il ne les porte pas.

---

## 2. Ce qui existe déjà, et qui n'est pas branché

Le travail fait le 04/09 (PR #207 → #209) a posé **toute la chaîne** « une fiche,
un BAT ». Elle est écrite, elle est testée, et **elle n'a pas d'allumage**.

```
CRM                                   BAT Studio
───                                   ──────────
mountBat()  ──── monterBatStudio($bat, { chrome: true })
                                      │
                        options.requestId  ✗ jamais passé
                                      ↓
                        contexteOuverture.requestId = ''
                                      ↓
              app.js:423  if (contexteOuverture.requestId) …   ✗ faux, toujours
                                      ↓
                        ouvrirPourFiche(id)      ← jamais appelée
                        batDeLaFiche(index, id)  ← jamais appelée
                        attacherContexte(projet) ← rend false, toujours
                                      ↓
                        projet.crmRequestId = ''
                                      ↓
              deposerDansCrm() → « Aucune fiche CRM associée à ce projet. »
```

**Vérifié** : zéro occurrence de `request=` dans `public/` hors `public/bat/`,
et `public/app.js:8068` appelle `monterBatStudio($bat, { chrome: true })` — sans
`requestId`, sans `client`, sans `projet`.

Conséquence : **tout BAT composé depuis le CRM est orphelin.** Il ne se rattache
à aucune ligne, et son PDF ne peut pas être déposé. L'écran fonctionne
parfaitement et ne sert à rien.

Ce qui est donc **déjà là et qu'il ne faut pas réécrire** :

- `monterBatStudio(el, { requestId, client, projet, ecran })` — les options sont
  déclarées et lues (`monter.js:206-212`).
- `ouvrirPourFiche(requestId)` — ouvre LE BAT de la fiche, ou en crée un ;
  `projects.js:87`. Son commentaire dit exactement le défaut qu'elle évite :
  « sans ça, chaque passage sur la fiche en empile un de plus ».
- `batDeLaFiche(index, requestId)` — répond sur l'index en mémoire, zéro requête.
- `deposerDansCrm(requestId, bytes, nom)` → `PUT /bat/api/crm/bat/:id?kind=` →
  `deposerPdf` → `attachments` + `bat_requis = true` + temps réel.
  **`kind` est déjà un paramètre** : la même route peut déposer un `devis` ou
  une `facture`.
- `attachments(request_id, kind)` — trois emplacements par ligne (`devis`,
  `bat`, `facture`), versionnés dans `attachment_versions` à chaque
  remplacement.
- `PDF_SLOT_LABELS` / `cellPdfSlot` (`app.js:2884`) — les trois pastilles sont
  déjà sur chaque ligne du planning, avec leur icône et leur infobulle.

---

## 3. Ce qui manque, mesuré

### 3.1 Le devis et la facture ne sont jamais attachés

`vente-flash.js` `emettreFacture()` : crée le dossier, émet la facture,
**imprime** — et s'arrête là. `devis-flash.js` `imprimer()` : compose le papier
dans un cadre hors écran, imprime, retire le cadre.

Aucun des deux n'appelle `PUT /api/requests/:id/pdf/…`. Les trois pastilles de
la ligne sont donc **des emplacements de dépôt manuel** : elles n'ont jamais rien
d'automatique. La vendeuse imprime, et la ligne reste vide.

### 3.2 `fiche.prod` — la structure que tout le monde lit, que personne n'écrit

`prodDuComptoir()` (server.js:4514) définit exactement ce dont le BAT a besoin :

```js
prod = {
  ref:      'K3025',            // la référence de l'article
  couleur:  'Light Olive Green',
  marquage: 'Coeur + Dos',      // l'emplacement V9
  encre:    'Blanc',
  tailles:  [{ t: 'M', n: 12 }, { t: 'L', n: 8 }],   // ≤ 12 entrées
  logos:    [{ face: 'Coeur', mm: '90', quoi: '…' }] // ≤ 12 entrées
}
```

C'est la structure lue par la fiche atelier, le ticket, le bon de commande,
`familleDuDossier()`, `facesProposees()`. Elle est dans `FICHE_LISTE` : elle
repart vers chaque poste à chaque rafraîchissement.

**Elle est vide.** Mesuré en production le 29/08 sur 187 dossiers :
`fiche.prod.ref` 0/187, `couleur` 0/187, `marquage` 0/187, `encre` 0/187.
Rien n'a changé depuis : la vente flash n'envoie que **quatre champs plats** —

```js
prod: { ref: l.reference, couleur: l.couleur, marquage: l.marquage, encre: l.encre }
```

— **sans `tailles`, sans `logos`**, alors que la vendeuse vient de remplir les
six cases de taille (`ligne.parTaille`), les tailles libres
(`ligne.taillesLibres`) et les faces (`ligne.faces`). Et le devis flash
n'envoie **aucun `prod`** : `POST /api/devis` écrit `fiche.devis` (le papier
archivé) et rien d'autre.

Autrement dit : **ce que Mélina tape ne parvient pas au dossier.** Il survit sur
le PAPIER (`fiche.devis.lignes[].tailles`, en texte : « 12 × M, 8 × L ») et dans
`invoices.document`, jamais dans une forme que l'atelier ou le BAT sachent lire.

C'est là, et nulle part ailleurs, que se joue le pré-remplissage.

### 3.3 Les deux écrans ne découpent pas pareil

| Écran | 3 articles → | Où vit le détail |
|---|---|---|
| Vente flash | **3 lignes** (`partsDuTicket`, la somme = le TTC payé) | `fiche.prod` par ligne + `fiche.lot` |
| Devis flash | **1 ligne** | `fiche.devis.lignes[]` seulement |

Deux formes pour les mêmes faits, deux chemins pour la même saisie.

### 3.4 « Facture » veut dire deux choses sur la même ligne

- la **pastille** `facture` = un PDF déposé à la main (`attachments`) ;
- le **bouton** « Facture FA-2026-0001 » de la fiche = la relecture du document
  archivé (`invoices.document`).

Rien ne les relie. Une ligne peut porter l'un, l'autre, les deux ou aucun.

---

## 4. Ce que Charlie a tranché le 04/09

| Question | Décision |
|---|---|
| Granularité | **1 article = 1 ligne partout.** Le devis flash découpe comme la vente flash. |
| Les documents dans la ligne | **Les deux** : le PDF déposé (pour l'envoyer) *et* la réouverture du modèle (pour le relire et le corriger). |
| Naissance du BAT | **À la création de la ligne**, automatiquement. |
| Périmètre du BAT | **Le textile seulement** — « casquette, t-shirt, sweat, pochette, sac, etc. Le reste, on fait encore les BAT sur Illustrator. » |
| Fin de vie du BAT | Le projet **disparaît** : le PDF part sur la Dropbox du client, les anciens BAT pèsent pour rien. **Ligne archivée = BAT effacé.** |

### Ce que la combinaison des deux dernières donne

« Auto à la création » **et** « textile seulement » se lisent ensemble :
**un BAT naît tout seul sur une ligne textile, et sur aucune autre.** Une vente
de tasses ou un article de rayon n'en fabrique pas.

C'est aussi ce qui rend la décision tenable côté magasin : sans le filtre
textile, chaque vente au comptoir poserait un projet vide, et le magasin BAT est
**à 3,07 Go sur 5**.

### Ce que la décision « 1 article = 1 ligne » coûte, et qu'il faut résoudre

C'est le point cher, et il était annoncé : **la reprise V2/V3 d'un devis ne sait
plus sur quel dossier écrire.** Aujourd'hui `POST /api/devis` reçoit
`dossierId` et réécrit CE dossier. Avec N lignes, il n'y a plus un dossier, il y
a un **groupe**.

La solution est écrite au §5.2 : le groupe s'identifie par le **numéro du devis**
(`DEV-26.09.04-003`), pas par un identifiant de ligne. C'est la seule chose que
le client a en main, et c'est déjà `fiche.ref`.

---

## 5. Le modèle cible

### 5.1 Une seule fabrique de lignes, pour les deux écrans

Aujourd'hui `POST /api/comptoir/projet` sait déjà tout faire : découper N
articles en N lignes, répartir le montant de sorte que la somme vaille
EXACTEMENT le TTC (`partsDuTicket`), écrire `fiche.prod` par ligne, tenir
l'idempotence par empreinte, ranger dans « À trier ». `POST /api/devis` refait
la moitié de ça, autrement, pour une seule ligne.

**On extrait la fabrique**, et les deux routes l'appellent :

```
creerLignesDuComptoir({ client, articles, montant, nature, destination, … })
        │
        ├── POST /api/comptoir/projet   (vente directe, demande de devis)
        └── POST /api/devis             (devis flash — nouveau)
```

`nature` prend trois valeurs, et c'est elle qui décide du prix :

| `nature` | `order_kind` | `project_value` | famille d'arrivée |
|---|---|---|---|
| `vente` | `commande` | le TTC réparti | `a_trier` → destination |
| `demande` | `demande` | **null** (« pas de prix » ≠ « prix zéro ») | `a_trier` → `demande_chiffrage` |
| `devis` | `demande` | **le TTC réparti** | `a_trier` → `demande_chiffrage` |

`devis` est la valeur qui manque aujourd'hui : la route du comptoir ne connaît
que « une demande n'a pas de prix », alors qu'un devis flash est chiffré. Sans
elle, un devis découpé arriverait avec une colonne Prix vide — ce que le
commentaire de `POST /api/devis` interdit explicitement.

> **Pourquoi une fabrique et pas deux routes qui se ressemblent** : c'est la
> règle du dépôt, appliquée au serveur. Deux écritures redeviennent deux
> comportements le jour où l'une bouge — et c'est exactement ce qui a produit
> les deux découpages du §3.3.

### 5.2 Le groupe d'un devis

Chaque ligne née d'un devis porte, dans sa `fiche` :

```js
{
  kind: 'devis-v1',
  ref: 'DEV-26.09.04-003',   // ← LE GROUPE. Déjà présent aujourd'hui.
  version: 2,                //   le rang de la version remise au client
  devis: { … },              //   le papier ENTIER, identique sur les N lignes
  devisArticle: 0,           // ← NOUVEAU : l'index de l'article que CETTE ligne porte
  prod: { … },               //   ce qu'il y a à produire, pour CETTE ligne
}
```

Deux choix à justifier :

- **`devis` est recopié entier sur chaque ligne.** C'est le papier remis au
  client ; il ne se découpe pas. Le recopier rend chaque ligne relisible seule —
  ouvrir n'importe laquelle rouvre le devis complet. Coût mesuré : un devis à 4
  articles pèse ~3 Ko de JSON ; sur 4 lignes, 12 Ko. Le contre-exemple existe
  déjà et coûte plus cher : `fiche.lot` obligeait à retrouver la ligne-mère.
- **`devisArticle` est un INDEX, pas une copie de l'article.** L'article
  lui-même est dans `prod` ; l'index dit seulement quelle entrée de
  `devis.lignes` cette ligne représente, pour la reprise.

**La reprise** (`Reprendre — version N+1`) devient :

1. l'écran envoie `numero` (`DEV-…`), pas `dossierId` ;
2. le serveur lit toutes les lignes vivantes portant `fiche.ref = numero` ;
3. il apparie par `devisArticle` :
   - article présent des deux côtés → la ligne est **mise à jour** ;
   - article retiré en V2 → la ligne est **archivée** (`deleted_at`), jamais
     supprimée ;
   - article ajouté en V2 → une ligne **naît** ;
4. `fiche.devisPassees` reçoit la version d'avant, sur chaque ligne, comme
   aujourd'hui ;
5. le journal (`request_events`) reçoit une entrée par ligne touchée.

> ⚠ **Un identifiant de dossier est une chaîne, pas un nombre.** Le piège est
> déjà écrit dans `POST /api/devis` (un `Number(uuid)` rendait `NaN`, la reprise
> passait pour absente, et l'écran ouvrait un SECOND dossier). Le numéro de
> devis est une chaîne lui aussi : la comparaison se fait sur la chaîne exacte,
> jamais réduite ni recasée.

### 5.3 Les trois documents d'une ligne

| Document | La vérité | Le PDF | Comment on le rouvre |
|---|---|---|---|
| **Devis** | `fiche.devis` (modèle) | `attachments(id,'devis')` | `reprendreDevis` → V2 |
| **Facture** | `invoices.document` (immuable) | `attachments(id,'facture')` | `ouvrirFacture` → avoir |
| **BAT** | le projet BAT (`bat_fichiers`) | `attachments(id,'bat')` | l'onglet BAT sur la ligne |

**Règle** : le PDF n'est jamais la source. Il est l'IMAGE de la source, déposée
pour être envoyée (WhatsApp, mail, Dropbox) et pour s'ouvrir depuis n'importe
quel poste sans recharger un écran de composition. La source reste le modèle —
c'est elle qu'on rouvre, corrige et reprend.

Ce qui règle le §3.4 : la pastille et le bouton ne disent plus deux choses. La
pastille est **remplie automatiquement** à l'émission, et cliquer dessus ouvre
le PDF ; le bouton de la fiche rouvre le modèle pour agir dessus.

### 5.4 Le pré-remplissage du BAT — la jointure, en détail

C'est le cœur, et c'est là que les fautes coûtent le plus cher, parce qu'elles
donnent un BAT **plausible et faux**.

```
LIGNE DU CRM                          PROJET BAT
────────────                          ──────────
fiche.prod.ref      'K3025'    ──┐
catalogue textile   toptex:'K3025IC' ├─→  productByRef('K3025IC')  → product
                                 ─┘         (indexé sur `refSupplier`)

fiche.prod.couleur  'Light Olive Green' ─→ product.colors[].label   → colorSlug
                                           repli : matchToptexColor (distance hex)

fiche.prod.tailles  [{t:'M',n:12},…]    ─→ article.sizes { M: 12, … }

fiche.prod.logos    [{face:'Coeur',…}]  ─→ article.placements (zones)
                                           appariées par NOM de face

billing_company                          ─→ project.client
description / fiche.devis.projet         ─→ project.name
```

**Le piège numéro un — la référence n'est pas la même des deux côtés.**
Le comptoir range la référence du catalogue textile (`NS300`, `K3025`,
`CGTU01T`). BAT Studio indexe sur `refSupplier`, la référence **fournisseur**.
Elles coïncident souvent — et pas toujours : `K3025` a `toptex: "K3025IC"` dans
`catalogue-textile-seed.json`.

> La clé de jointure est **`toptex || ref`, jamais `ref` seul.** Sur `K3025`,
> chercher `ref` seul ne trouve rien, le BAT s'ouvre vide, et personne ne
> comprend pourquoi ça marche pour NS300 et pas pour K3025.

**Le piège numéro deux — la face porte la cote, pas la famille.** Déjà payé le
04/09 : c'est `l.zoneName` qui est passé à `printWidthCm`, pas `faceKey`.
L'ancienne grille n'avait que « devant »/« dos » et donnait la même largeur à un
Cœur (60-70 mm) et à une Poitrine ; sur NS300 le Dos fait 240-320 mm. Les zones
du BAT (`store.js`, `defaultZones`) portent déjà les noms du CRM — Cœur,
Poitrine, Avant, Dos, Manche DR/GA — et c'est **par le nom** qu'on apparie.

**Le piège numéro trois — un produit absent du catalogue BAT.** Le catalogue BAT
est celui de BAT Studio (`catalogue-export.json` dans `bat_fichiers`), pas
`catalogue_produits`. Une référence textile vendue au comptoir peut ne pas y
être. Deux conduites, et une seule est acceptable :
- ✗ ouvrir un BAT vide sans rien dire — le pré-remplissage a « marché » et le
  BAT est faux ;
- ✓ ouvrir le BAT en **nommant le manque** (« NS352 n'est pas au catalogue du
  BAT ») et en proposant l'import TopTex, qui existe déjà dans l'écran Produits.

### 5.5 Quelles lignes méritent un BAT

« Textile » au sens de Charlie ≠ `famille === 'Textile'` dans le catalogue.
Compté en base ce jour :

| Famille | Produits | BAT ? |
|---|---:|---|
| Textile *(chiffré au moteur V9)* | 48 | **oui** |
| Vêtements — Unisexe / Femme / Enfant *(t-shirts FINIS, prix magasin)* | 25 | **oui** |
| Casquettes | 1 | **oui** |
| Pochettes | 8 | **oui** |
| Sacs | 4 | **oui** |
| | **86** | |
| Art de la table, Tasse céramique 350 ml, Tasses, Mug, Verre, Gourdes, Papeterie, Porte-clés, Voyage, Du quotidien, Jeux & loisirs, Goodies, Packs, Tableaux, Sous-traitance | 134 | non — Illustrator |

> ⚠ **« Chiffré au V9 » et « mérite un BAT » sont deux questions différentes.**
> Les 25 « Vêtements — … » sont des t-shirts finis vendus au prix magasin : ils
> ne passent pas par le moteur V9, et on imprime dessus. Tester `famille ===
> 'Textile'` — la tentation évidente, parce que c'est le test que les deux
> écrans font déjà pour l'onglet Textile/Boutique — priverait de BAT **25
> produits sur 86**.

La liste des familles à BAT est donc **un réglage** (`app_meta.familles_bat`),
semé avec les six valeurs ci-dessus. Une famille neuve au catalogue ne doit pas
demander un déploiement pour recevoir des BAT — même raison que
`app_meta.entreprise` pour l'identité de l'atelier.

### 5.6 Le cycle de vie du BAT

```
ligne textile créée
        │
        ├─→ projet BAT créé, pré-rempli, VIDE DE LOGOS
        │
   [Mélina/Charlie posent les logos]
        │
        ├─→ PDF exporté ──→ attachments(id,'bat')  +  bat_requis = true
        │                   (le PDF part sur la Dropbox du client)
        │
        └─→ ligne ARCHIVÉE (deleted_at)
                    │
                    └─→ PURGE : le projet BAT et SES IMAGES PROPRES
                        Le PDF reste sur la ligne archivée.
```

**Ce qu'il faut purger, et ce n'est pas ce qu'on croit.** Mesuré sur le volume
en ligne le 04/09 :

| | fichiers | poids |
|---|---:|---:|
| projets (le JSON de travail) | 85 | **1,1 Mo** |
| logos | 148 | 170,9 Mo |
| `mockups-custom` | 3 011 | **845,6 Mo** |
| BAT archivés | 74 | 182,7 Mo |

> Effacer les 85 projets rendrait **1,1 Mo**. Ce qui pèse, ce sont les IMAGES
> qu'ils réclament. La purge doit donc suivre `mockupsReclames()` — la fonction
> existe déjà, c'est celle du « Ménage » — et retirer les images qu'aucun projet
> vivant ne réclame plus. Purger le JSON seul donnerait le sentiment d'avoir
> nettoyé sans rendre un mégaoctet.

**Ce qui n'est pas purgé à l'export du PDF, et pourquoi.** Charlie : « une fois
le PDF téléchargé [les projets] doivent disparaître ». Le déclencheur retenu est
l'**archivage**, pas l'export, pour une raison : un BAT existe pour être
**corrigé**. Le client renvoie ses remarques, on fait une V2 — c'est même une
sous-étape du pipeline (`bat_modif`, « BAT – Modification demandée »). Effacer le
projet à l'export obligerait à tout recomposer depuis zéro à chaque aller-retour.

Le compromis proposé : l'export **marque** le projet « sorti » et purgeable ; la
ligne archivée **purge**. Un bouton « Purger les BAT sortis » dans Réglages, à
côté du Ménage, rend la place quand on la veut sans jamais l'arracher sous les
doigts de quelqu'un qui prépare une V2. **À confirmer par Charlie** (§8).

---

## 6. Les lots, dans l'ordre

L'ordre n'est pas négociable : chaque lot a besoin du précédent.

### Lot 1 — `fiche.prod` arrive enfin rempli *(le socle)*

Les deux écrans flash envoient `prod` COMPLET : `tailles` depuis `parTaille` +
`taillesLibres`, `logos` depuis `faces`.

- Aucun écran nouveau. Aucune migration.
- Bénéfice immédiat et indépendant du BAT : la fiche atelier et le ticket
  cessent d'être vides sur les dossiers du comptoir (mesuré 0/187).
- ⚠ `PROD_ENTREES_MAX = 12`. Six cases + les tailles libres peuvent dépasser :
  décider si l'on tronque (et on perd des pièces en silence) ou si l'on remonte
  le plafond. **Remonter** — une commande de staff à 9 tailles existe.

**Ce qui se teste** : une vente flash à 3 articles, tailles et faces remplies →
les 3 lignes portent `prod.tailles` et `prod.logos`. Et le ticket atelier les
imprime.

### Lot 2 — Une seule fabrique de lignes, le devis découpe

`creerLignesDuComptoir` extraite, `nature: 'devis'` ajoutée, `POST /api/devis`
branché dessus, reprise par numéro de devis (§5.2).

- ⚠ **Migration nécessaire** : les devis existants sont des lignes uniques
  portant N articles. Réversible et non destructive — on ne découpe PAS le
  passé, on marque les anciennes lignes `fiche.devisArticle = null` et la
  reprise sait lire les deux formes. Découper rétroactivement changerait des
  montants déjà annoncés.
- ⚠ **Effet sur l'agenda des retraits** : « un retrait = un passage
  (client + jour) » regroupe déjà plusieurs lignes en une. Un devis découpé en 3
  ne doit pas produire 3 passages. À vérifier, le regroupement existe.

**Ce qui se teste** : un devis à 3 articles → 3 lignes, somme = TTC exact ; une
V2 qui retire un article → 2 lignes vivantes, 1 archivée, 0 doublon ; deux
postes qui enregistrent le même devis en même temps → 3 lignes, pas 6.

### Lot 3 — Le PDF se dépose tout seul

À l'impression du devis / à l'émission de la facture, l'écran dépose aussi le
PDF sur chaque ligne du groupe.

- ⚠ **C'est le lot le plus cher, et il faut le dire.** Les écrans IMPRIMENT
  (un cadre hors écran, `window.print()`) ; ils ne fabriquent aucun octet de
  PDF. jsPDF a été retiré du dépôt le 25/08.
- Ce qui reste, et qui est déjà là : **`pdf-lib` est vendorisé**
  (`public/bat/vendor/pdf-lib.esm.min.js`, 523 Ko) et `batpdf.js` écrit déjà une
  feuille A4 avec.
- La forme qui respecte la règle des deux papiers : **un troisième consommateur
  du MÊME modèle**. `modeleDevis(saisie)` rend un objet pur ; `dessinerDevis`
  l'écrit en HTML ; on ajoute `pdfDevis(modele)` qui l'écrit en PDF. La
  grammaire (intitulés, encre, filets, crans) reste dans `papier.js` et ne se
  réécrit pas — ce sont deux RENDUS d'un modèle, pas deux papiers.
- Le garde-fou : un test qui compare les deux rendus sur le même modèle —
  mêmes lignes, mêmes totaux, mêmes intitulés, même numéro.
- Poids : un devis A4 par pdf-lib ≈ 40-80 Ko, +33 % en base64. Sur 200 dossiers
  par an, ~20 Mo. Négligeable devant les 3,07 Go du magasin BAT.

**Ce qui se teste** : émettre une facture → la pastille `facture` de chaque
ligne est remplie, le PDF s'ouvre, et son total est celui du papier imprimé.

### Lot 4 — La ligne ouvre SON BAT

Le bouton BAT sur les lignes textile ; `mountBat` accepte un dossier.

- `mountBat()` est mémoïsé (`batLoading`) et ne garde pas le module : il faut
  garder la référence comme le fait `mountDevisFlash` (`dfModule`), et exposer
  `ouvrirPourFiche` pour rouvrir sur une AUTRE ligne sans remonter l'écran.
- ⚠ **Ne pas démonter en changeant de ligne** : `demonter()` appelle
  `closeProject()`. Passer d'une ligne à l'autre doit fermer proprement le
  projet courant (il s'enregistre tout seul) et ouvrir l'autre.
- Le bouton n'apparaît QUE sur une ligne dont la famille est dans
  `app_meta.familles_bat` (§5.5).

**Ce qui se teste** : deux passages sur la même ligne ouvrent LE MÊME projet
(c'est le défaut que `ouvrirPourFiche` existe pour éviter) ; une ligne de tasses
n'a pas de bouton.

### Lot 5 — Le pré-remplissage, et la fin de vie

La jointure du §5.4, la création automatique à la naissance d'une ligne textile,
la purge à l'archivage.

**Ce qui se teste** : une vente de 30 K3025 Light Olive Green, 12 M / 18 L,
Cœur + Dos → le BAT s'ouvre sur le bon produit (**par `K3025IC`**), la bonne
couleur, 12 M et 18 L, deux zones nommées Cœur et Dos, **aucun logo** — il ne
reste qu'à les poser. Et une ligne archivée ne laisse plus ni projet ni images
orphelines.

---

## 7. Les pièges déjà payés, à ne pas repayer

1. **`ref` seul ne joint pas** — `toptex || ref` (§5.4).
2. **La zone porte la cote par son NOM**, pas par une clé de face.
3. **« Pas de prix » n'est pas « prix zéro »** — `project_value` reste `null` sur
   une demande, et le drapeau `sansPrix` distingue un article à chiffrer d'un
   article offert.
4. **Un identifiant de dossier est une chaîne** — jamais `Number()`.
5. **pg-mem n'a pas d'opérateur `jsonb ||`** — la fusion de `fiche` se fait en
   JS, comme le fait déjà `POST /api/factures`.
6. **Un module ES de `public/` ne s'importe pas par chemin côté serveur**
   (`"type": "commonjs"`) — on lit la source et on l'importe par une URL `data:`,
   comme `bat.js` prend `producttype.js`.
7. **Une police d'icônes à 91 glyphes** — un nom absent ne lève rien, la boîte
   coupe le texte à la première lettre.
8. **La couleur ne dit qu'un ÉTAT** — une pastille de document remplie n'est pas
   une décoration : plein = le document existe, vide = il manque.
9. **Tout ce qui peut être à la même hauteur l'est** — les trois pastilles et le
   futur bouton BAT sont la même famille : une seule règle, un jeton de hauteur,
   jamais un nombre.
10. **Vérifier en comparant les écrans, pas isolément** — la ligne du planning,
    la fiche atelier et l'onglet BAT portent le même composant de document.

---

## 8. Ce qui reste à trancher

1. **La purge à l'export du PDF.** Le §5.6 propose « marqué purgeable à
   l'export, effacé à l'archivage », parce qu'un BAT existe pour être corrigé
   (`bat_modif` est une sous-étape du pipeline). Si Charlie veut vraiment
   l'effacement à l'export, une V2 repartira d'une feuille blanche à chaque
   aller-retour client — c'est jouable, il faut juste le vouloir.

2. **Le sort des devis existants.** Le lot 2 propose de **ne pas découper le
   passé**. À confirmer : les dossiers de devis déjà au planning gardent leur
   forme d'une ligne pour N articles.

3. **Le plafond de `PROD_ENTREES_MAX`** (12 aujourd'hui). Remonter à combien ?
   Une commande de staff peut avoir 9 tailles ET 6 emplacements.

4. **Les 3,07 Go du magasin BAT.** Ce cahier ajoute des projets ; il n'enlève
   rien tant que le ménage (821 orphelins, 101,6 Mo) et le ré-encodage des 449
   packshots bruts (705,5 Mo) ne sont pas faits. Les deux transforment ou
   effacent des images de production : c'est l'affaire de Charlie, pas une passe
   d'entretien.

---

## 9. Ce qui a déjà été corrigé en préparant ce cahier

Trois défauts trouvés pendant l'état des lieux, corrigés et testés :

- **`/bat/api/*` échappait à la porte de session et aux capacités.** Comptes
  allumés, personne connecté : `PUT /api/requests/<id>/pdf/bat` répondait 401
  pendant que `PUT /bat/api/crm/bat/<id>` déposait le PDF et répondait 200.
  `POST /bat/api/menage/mockups`, qui efface des images, était ouvert de même.
  → `test/porte-de-service-bat.test.js`, et la capacité `bat` (Direction, chef
  d'atelier, boutique).
- **La vente flash annonçait « Facture émise » quand elle ne l'était pas.**
  L'émission passe par deux appels ; le second qui échoue laissait un écran qui
  ment, un bouton grisé et un garde qui rendait muet tout nouveau clic.
  → trois états au compteur, reprise sans second dossier.
- **Trois commentaires décrivaient les quatre onglets du BAT.** Il y en a deux
  depuis la PR #209.
