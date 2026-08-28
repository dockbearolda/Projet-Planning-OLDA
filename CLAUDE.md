TABLETTE: non

# Planning OLDA — règles du dépôt

Complète le `CLAUDE.md` global. Ce qui suit est propre à ce projet.

## Cibles réelles

Les Galaxy Tab A9+ 11" (SM-X210) qui tournaient au comptoir et à l'atelier ont
été **définitivement mises au rebut le 21/08/2026** et ne seront **jamais
remplacées** — d'où `TABLETTE: non`. On ne cible plus ce format, ni en
portrait ni en paysage, et les breakpoints ~800/1280px propres à cette dalle
n'ont plus lieu d'être.

**PC uniquement.** Sur ce projet, la cible n'est plus « iPhone toujours + PC
toujours » du CLAUDE.md global : c'est **PC/Desktop exclusivement**, décidé le
21/08/2026. Aucun poste (comptoir, atelier, patron) ne travaille plus sur
téléphone. Pas de contrainte tactile-doigt (44px, safe-areas, hover
indisponible) à respecter par défaut — clavier, souris, hover et focus visible
redeviennent les seules interactions à soigner.

L'atelier est à **Saint-Martin (UTC−4, pas d'heure d'été)** et le conteneur de
production tourne en **UTC** : toute date civile calculée côté serveur passe par
`America/Marigot`, jamais par `new Date()` seul. Dès 20 h locales, un
`toISOString()` naïf date du lendemain.

## Contraintes de l'application

- **Aucun build.** HTML + CSS + JS en modules ES natifs, servis tels quels. Les
  fichiers gardent le même nom d'un déploiement à l'autre : c'est pour ça que le
  statique part en `Cache-Control: no-cache` et que le service worker ne sert son
  cache **qu'en repli**, jamais en premier.
- **Rien qui vienne d'un autre domaine.** Polices, icônes, scripts : tout est
  hébergé ici. Un poste doit s'ouvrir sans dépendre d'un tiers joignable.
- **Les deux écrans du comptoir** (`public/comptoir/*.html`) viennent du patron.
  Une nouvelle version de sa part se pose en **remplaçant le fichier** — on ne
  retranscrit pas le parcours. Tout ce qui doit s'y greffer (base clients,
  numéro du jour, envoi au planning) vit dans `comptoir/pont.js`.
- **Les deux papiers** (`public/ticket.js` pour l'atelier, `public/bureau.js`
  pour le bon de commande) sortent de la **même ligne**, à un clic l'un de
  l'autre. Leur grammaire commune — encre, filet, marge de feuille, intitulés —
  vit dans `public/papier.js` et **ne se réécrit chez aucun des deux**. Chaque
  papier déclare **trois crans de texte** en propre, plus celui des intitulés :
  le ticket en avait dix, ça se voit et ça coûte une réimpression. Deux pièges
  déjà payés, tenus par les tests : **aucun accent grave** dans les gabarits (il
  les termine, l'écran s'ouvre NU) et **aucun jeton de `charte.css`** (le cadre
  d'impression ne la charge pas — le jeton y vaut VIDE au PAPIER, et nulle part
  ailleurs, donc l'aperçu paraît correct).
  L'**identité de l'atelier** qui signe le bon de commande est un **réglage**
  (`app_meta.entreprise`), jamais une constante : un déménagement ne demande pas
  un déploiement, et un champ vide ne s'imprime pas.

- **Charte unique** (depuis le 29/07) : gris `#f5f6f8`, encre `#111827`.
  La couleur dit un **état**, jamais une décoration.
  **Une seule exception, tranchée par Charlie le 26/08** : les **cinq teintes
  de phase du rail** (`[data-fam]` dans `charte.css` — `--zr` / `--zt` / `--zp`
  / `--zc` / `--za`). Une phase n'est pas un état, c'est une catégorie : la
  règle ne la couvrait donc pas, et l'écran faisait autrement depuis le 24/08.
  L'exception est **close** : elle vaut pour le rail et pour rien d'autre.
  Partout ailleurs — cartes, tableau, ticket, comptoir — une couleur qui ne dit
  pas un état est un défaut.

## Qui tranche le design (25/08/2026)

**C'est Charlie, et lui seul.** Consigne donnée le 25/08 : « oublie les
contraintes design du patron, il n'y connaît rien ». Les choix de mise en
forme du patron ne sont donc plus des contraintes à préserver — ni la densité
des écrans du comptoir, ni « ils tournent tels quels » côté apparence, ni la
largeur du rail fixée par sa spécification du 24/08. Ce qui reste intouchable,
c'est le **CHIFFRAGE** (le moteur conforme à son fichier V9) et les **règles
métier**, pas l'habillage.

**Cohérence avant tout** : deux écrans ouverts à un clic l'un de l'autre
doivent donner le même composant, pas deux qui se ressemblent. Un composant
partagé va dans `public/charte.css` — le seul fichier que le CRM et les deux
parcours du comptoir lisent tous les deux (déjà le cas du bouton « revenir »,
du message flottant et du fil des étapes).

**RÈGLE — TOUT CE QUI PEUT ÊTRE À LA MÊME HAUTEUR L'EST (27/08/2026).**
Consigne de Charlie, mot pour mot : « il est extrêmement important que tout ce
qui peut être à la même hauteur doit l'être, tu dois être ultra vigilant
là-dessus ». Elle passe avant le confort d'écriture : deux composants de la
même famille — deux rangées de menu, deux champs d'une rangée, deux boutons
d'une barre — prennent **la même hauteur, le même rembourrage, le même écart
et la même graisse**, et ils le prennent dans **une seule règle**, pas dans
deux qui se ressemblent. Deux écritures redeviennent deux hauteurs le jour où
l'une bouge.

Trois corollaires, chacun payé une fois :

- **Une hauteur est un JETON, jamais un nombre.** `min-height: var(--ctrl-h)`,
  pas `min-height: 50px` — un nombre se recopie de travers.
- **La barre du haut n'a qu'UNE hauteur** (28/08) : `--ctrl-h`, celle que la
  pilule de recherche portait déjà et que porte tout ce qui se clique et se
  remplit ailleurs. Elle en avait trois — 36 pour les onglets, 44 pour les
  boutons ronds et le poste, 50 pour la recherche. Les deux panneaux qui en
  tombent (« Colonnes », « Nouveau Projet ») la suivent. Ça coûte **14 px** de
  barre, et c'est le prix décidé. `--rond` (44) ne bouge pas : c'est la boîte
  de `.btn-retour` et des croix de tiroir, **hors** de la barre.
- **Un panneau tombe sur le RAIL de ce qui l'ouvre** : on aligne les icônes,
  pas les bords de boîte, et on **mesure** l'écart au lieu de l'écrire. Le
  menu de « Nouveau Projet » tombait 13,7 px à droite du « + » de son onglet
  parce qu'il était posé au bord du bouton.
- **Ce qui n'est pas égalisable se dit.** Deux pictogrammes dans la même boîte
  de 20 px n'ont pas la même encre (16,67 px pour `point_of_sale`, 13,33 pour
  `request_quote`) : ça se dessine dans la police, aucune règle CSS ne le
  corrige. On égalise la boîte, et on ne prétend pas avoir égalisé le reste.

Le garde-fou est `test/meme-hauteur.test.js` : il refuse un bloc dont
`.np-menu__item` est le seul sélecteur, une hauteur écrite en dur, une boîte
d'icône sans largeur **et** hauteur. Un écart de ce genre ne se voit pas en
relisant un écran, seulement en comparant deux écrans — d'où le test.

**Vérification** : ne jamais annoncer qu'un écran est bon sans l'avoir
**comparé aux autres** — mesurer le même composant sur chaque écran qui le
porte. Le 25/08, deux bulles d'étape de 41 et 47 px sont passées sous le
radar parce que chaque écran avait été contrôlé isolément.

**Tablette : n'en tenir aucun compte.** Voir « Cibles réelles » — PC
uniquement. Les restes tactiles (`@media (pointer: coarse)`, cibles 44 px
justifiées par le doigt) sont du code mort à retirer quand on passe à côté.

## Base de données

- Migrations **réversibles**, jouées au démarrage dans `db.js` (`init`), chacune
  avec sa **propre garde `app_meta`** — deux incidents réels sont venus d'une
  garde partagée.
- La base locale de test est **pg-mem** (aucune installation) : elle n'implémente
  que peu de fonctions natives. Celles dont le code se sert sont enregistrées à
  la main dans `db.js`. Un index sur **expression** n'y existe pas : on le crée
  dans `init()` derrière un `try`, pas dans `schema.sql`.

## Ce qui se teste toujours

- `npm test` doit être vert avant tout commit.
- Deux postes qui écrivent **en même temps** (numéros de ticket, codes clients,
  compteurs) : c'est là que vivent les bugs, pas dans le cas nominal.
- Le **tactile** : un geste au doigt n'est pas un clic. Scroll sur une carte,
  deuxième doigt posé à côté, `pointercancel` au milieu d'un glisser.
- Le **réseau qui tombe** au mauvais moment : une réponse avalée ne doit jamais
  faire perdre un dossier, ni en créer deux.

## Déploiement

Rien ne part sur Railway — ni code, ni migration, ni import — **tant que le
patron n'a pas validé lui-même en local**. Le service `web` est branché sur
`main` : un push déclenche le déploiement. Vérifier le hash servi via
`railway status --json` (`meta.commitHash`) : la prod est derrière un Basic Auth,
un `curl` ne prouve rien.
