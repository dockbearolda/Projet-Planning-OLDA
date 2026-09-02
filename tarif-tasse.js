'use strict';

// LE PRIX D'UNE TASSE, ET RIEN D'AUTRE
// ===========================================================================
// Une tasse se vend par ASSEMBLAGE : le contenant, ce qu'on marque sur la face
// avant, sur l'autre face, sous le fond, et le BAT s'il en faut un. Chacun de
// ces cinq morceaux est une ligne de la grille tarifaire du patron (Réglages →
// « Grille tarifaire tasse »), avec son prix d'achat, son prix de vente TTC et
// ses deux temps. Le prix de la tasse est la somme de ses morceaux ; son coût
// de revient, la somme de leurs achats plus le temps passé.
//
// POURQUOI CE FICHIER EXISTE (01/09/2026)
// ---------------------------------------------------------------------------
// Ce calcul vivait au milieu des neuf cents lignes de `POST /api/projets` —
// l'ancien « Nouveau Projet » interne, que plus aucun écran n'appelle depuis le
// 31/07. L'audit du 01/09 voulait supprimer ce bloc et a dû s'arrêter : c'était
// le SEUL endroit du serveur qui savait chiffrer une tasse, et le seul par où
// un test pouvait prouver qu'une tasse sort bien à 16 €. On ne retire pas la
// seule preuve qu'un prix est juste — on la déplace d'abord.
//
// LES PRIX QUE CE CALCUL DOIT RENDRE, dits par le patron le 01/09 :
//   · tasse céramique 350 ml ....... 16 €     (le prix de rayon)
//   · tasse expresso 180 ml ........ 14 €
//   · tasse en bois ................ 22 €
//   · le logo du client sur l'autre face .... +6 €
// Le prix de rayon est celui de la tasse AVEC une face, pas du contenant nu :
// c'est ce qui avait été mal lu, et la grille sous-tarifait de 6 € par tasse.
//
// PUR, comme `chiffrage.js` : aucune base, aucun réseau, aucune horloge. On lui
// donne la grille et un choix, il rend des nombres. C'est ce qui permet de le
// mettre à l'épreuve sans monter un serveur.
//
// ⚠ AUCUNE ROUTE NE L'APPELLE AUJOURD'HUI, ET C'EST UN CONSTAT, PAS UN OUBLI.
// La route qui chiffrait est partie avec le reste de l'ancien « Nouveau
// Projet » ; le comptoir, lui, envoie un prix DÉJÀ calculé à l'écran, que le
// serveur se contente de valider (`prixComptoir`). Ce module sert donc
// aujourd'hui à une seule chose, et elle compte : prouver que la GRILLE réglée
// par le patron sort bien les prix de rayon (voir
// `test/tarif-tasse-prix-magasin.test.js`). C'est une vérification de DONNÉES.
//
// La suite naturelle serait que le serveur revérifie le prix d'une tasse au
// lieu de croire l'écran sur parole — un poste qui envoie un montant faux
// n'est refusé par personne aujourd'hui. Ça se décide avec Charlie : le
// comptoir a le droit de négocier, et un serveur qui refuse une vente est un
// serveur qu'on contourne sur un papier.

// Les cinq morceaux d'une tasse, dans l'ordre où ils s'additionnent, avec la
// catégorie de la grille où chacun se cherche.
const MORCEAUX = [
  { cle: 'produitId', categorie: 'produit', quoi: 'type de tasse', requis: true },
  { cle: 'face1Id', categorie: 'face', quoi: 'option face 1' },
  { cle: 'face2Id', categorie: 'face', quoi: 'option face 2' },
  { cle: 'dessousId', categorie: 'dessous', quoi: 'option dessous' },
  { cle: 'batId', categorie: 'bat', quoi: 'BAT' },
];

const centimes = (v) => Math.round(v * 100) / 100;

// Choisit les cinq morceaux dans la grille. Rend `{ error }` au premier
// identifiant inconnu — un morceau qu'on ne trouve pas ne vaut pas zéro, il
// veut dire qu'on ne sait pas ce qu'on vend.
function choisirMorceaux(choix, parId, ou) {
  const c = choix && typeof choix === 'object' ? choix : {};
  const parts = {};
  for (const { cle, categorie, quoi, requis } of MORCEAUX) {
    const id = c[cle];
    if (id == null || id === '') {
      if (requis) return { error: `${ou} : le ${quoi} est requis` };
      parts[cle] = null;
      continue;
    }
    const article = parId.get(id);
    if (!article || article.categorie !== categorie) return { error: `${ou} : ${quoi} inconnu` };
    parts[cle] = article;
  }
  return { parts };
}

// LE PRIX DE LA GRILLE, pour UNE tasse. C'est un prix PROPOSÉ : le comptoir
// garde le droit de le remplacer (remise négociée, cas particulier). Le coût de
// revient, lui, ne se négocie pas — il reste celui de la grille.
function chiffrerTasse(choix, articles, taux, ou = 'Tasse') {
  const parId = new Map((Array.isArray(articles) ? articles : []).map((a) => [a.id, a]));
  const trouve = choisirMorceaux(choix, parId, ou);
  if (trouve.error) return { error: trouve.error };

  const parts = MORCEAUX.map(({ cle }) => trouve.parts[cle]).filter(Boolean);
  const nombre = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const somme = (champ) => parts.reduce((s, a) => s + nombre(a[champ]), 0);

  const tauxMo = nombre(taux && taux.tauxHoraireMo);
  const tauxMachine = nombre(taux && taux.tauxHoraireMachine);

  return {
    morceaux: trouve.parts,
    // Ce que la grille dit qu'une tasse vaut, TTC.
    prixUnitaireTtc: centimes(somme('prixVenteTtc')),
    // Ce qu'elle coûte à produire : la matière, plus le temps de l'atelier.
    // Les temps sont en MINUTES et les taux à l'heure — d'où les soixantièmes.
    coutUnitaire: centimes(
      somme('prixAchat')
      + (somme('tempsMoMin') / 60) * tauxMo
      + (somme('tempsMachineMin') / 60) * tauxMachine,
    ),
  };
}

module.exports = { MORCEAUX, chiffrerTasse, centimes };
