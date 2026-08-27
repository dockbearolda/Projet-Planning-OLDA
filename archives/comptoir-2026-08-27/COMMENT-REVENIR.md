# Les deux écrans du comptoir, tels qu'ils étaient le 27/08/2026 au matin

Charlie, 27/08 : « je te fais 100 % confiance, par contre tu conserves un backup
actuel car c'est plutôt bien actuellement, mais là j'ai besoin de simplifier. »

Ce dossier garde les deux écrans **avant** la simplification. Ils ne sont pas
servis (ils sont hors de `public/`) : ils sont là pour être relus, comparés, ou
remis en place.

## Remettre un écran comme il était

```bash
cp archives/comptoir-2026-08-27/vente-directe.html public/comptoir/
cp archives/comptoir-2026-08-27/demande-devis.html public/comptoir/
```

Puis `npm test` — les tests diront ce qui, dans le reste de l'application,
comptait sur la version simplifiée.

## Revenir au dépôt entier

Le commit d'avant porte une étiquette :

```bash
git checkout comptoir-avant-simplification
```

Et pour ne récupérer que les deux écrans depuis cette étiquette :

```bash
git checkout comptoir-avant-simplification -- public/comptoir/
```

## Ce qui a été retiré, et où c'est parti

Rien n'a été supprimé de la base de données. Chaque question retirée du parcours
est partie à l'un de ces quatre endroits :

| Question | Où elle est maintenant |
|---|---|
| Secteur, adresse, ville, code postal, fonction du contact, second contact | **Base clients** — la fiche se complète à froid |
| Majorations « dans 5 / 10 / 15 jours » | **Réglages** — c'est un réglage, pas une vente |
| Note interne, montant donné, paiement mixte, ajustement tarifaire | **un volet**, un clic pour l'ouvrir |
| Points à contrôler, informations attendues, transmission prévue par, éléments reçus, informations transmises par, décisions et contraintes | **une seule case « Notes »** |
| Type de logo, statut du logo, maquette | **dans l'article** — c'est le logo de cet article-là |

Quatre choses seulement ont disparu, parce qu'elles ne disaient rien :

- **Client repart immédiatement** — l'écran répondait « Non » tout seul, 18 fois sur 18.
- **Priorité du projet** — 16 réponses identiques sur 22, et le planning a déjà la sienne.
- **État des informations** et **Reprise de vectorisation** — 16 réponses identiques sur 22.
- **Budget indicatif** (18 fois sur 22 : « À chiffrer ») et **Description générale**
  (écrite par la machine : « Le client souhaite 1 Trophée »).

Les chiffres viennent des 55 dossiers réels du comptoir en production
(33 ventes directes, 22 demandes de devis), mesurés le 27/08/2026.
