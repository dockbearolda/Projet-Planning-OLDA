'use strict';

// ===========================================================================
// LE CHIFFRAGE, REJOUÉ CÔTÉ SERVEUR
// ===========================================================================
// Charlie, 28/08 : « extrêmement important et obligatoire que le prix suive ».
// Le client ne veut plus 30 S mais 100 : on corrige la quantité sur la ligne du
// planning, et le prix doit suivre le dégressif du fichier V9 — pas rester
// celui de 30 pièces.
//
// POURQUOI ICI ET PAS DANS LE NAVIGATEUR. Le moteur vit dans le comptoir
// (`public/comptoir/textile-catalog.js`, chargé en <script> classique par les
// deux écrans du patron). Trois raisons de le rejouer au serveur plutôt que de
// l'importer dans le planning :
//
//   1. UN SEUL ENDROIT FAIT FOI. Deux postes qui corrigent la même ligne
//      doivent obtenir le même prix ; un calcul par poste, ce sont deux
//      vérités qui se battent au prochain rafraîchissement.
//   2. LES ÉCRANS DU PATRON NE BOUGENT PAS. Le fichier reste un script
//      classique posant `window.TextileEngine` : on le charge dans un bac
//      (`vm`), exactement comme le font déjà les tests de conformité. Aucune
//      ligne du moteur n'est réécrite, donc aucune chance de s'écarter du V9.
//   3. LES RÉGLAGES SONT EN BASE. Coût DTF, coût horaire, arrondi, tarifs de
//      transport : le serveur les a sous la main, le navigateur devrait aller
//      les chercher avant chaque calcul.
//
// CE QUI N'EST PAS ICI : la négociation. Elle se décide au comptoir, devant le
// client, et son résultat est un PRIX — il arrive dans `manualPrice` et le
// recalcul le respecte (voir `recalculer`).

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// La TGCA de Saint-Martin, telle que le comptoir l'applique : 4 %, décidés
// PAR ARTICLE (`d.tgca`), jamais en taux global sur le panier.
const TGCA = 0.04;

const CHEMIN_MOTEUR = path.join(__dirname, 'public', 'comptoir', 'textile-catalog.js');

let moteur = null;

// LE MOTEUR SE CHARGE UNE FOIS. Le fichier fait 65 Ko dont l'essentiel est le
// catalogue produits : le relire à chaque correction de quantité, c'est un
// accès disque et une compilation par frappe.
//
// Le bac ne reçoit QUE ce dont le moteur se sert. Pas de `require`, pas de
// `process`, pas de `fetch` : ce fichier est du code à nous, mais il est servi
// au navigateur — le jour où quelqu'un y colle une ligne de trop, elle ne doit
// pas s'exécuter avec les droits du serveur.
function TE() {
  if (moteur) return moteur;
  const bac = {
    window: {}, console, Math, JSON, Number, String, Array, Object, Date, parseFloat, Intl,
  };
  vm.createContext(bac);
  vm.runInContext(fs.readFileSync(CHEMIN_MOTEUR, 'utf8'), bac);
  moteur = bac.window.TextileEngine;
  return moteur;
}

// Le moteur tourne dans un autre « royaume » : ses objets n'ont pas notre
// `Object.prototype`. Tout ce qui sort d'ici repasse donc par des valeurs
// simples — un objet étranger rangé dans la fiche se sérialise mal et se
// compare encore plus mal.
const nombre = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const centime = (v) => Math.round(nombre(v) * 100) / 100;
const mot = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

// --- CE QU'ON GARDE D'UN ARTICLE CHIFFRÉ ------------------------------------
// Exactement les entrées du moteur (`calculate`), et rien d'autre. La
// référence, la couleur, la note et les tailles sont DÉJÀ dans `fiche.prod`,
// qui est ce que la ligne affiche : les réécrire ici, ce serait deux vérités
// pour une même valeur, et c'est toujours la mauvaise qu'on lit.
//
// Tout est borné : ça vient d'un corps de requête, donc d'un navigateur, donc
// potentiellement de n'importe quoi. Une borne haute large sur les prix — elle
// écarte l'absurde, elle n'arbitre pas un tarif.
const PRIX_MAX = 100000;
const QTE_MAX = 100000;

// DEUX MOTEURS, UNE SEULE PORTE. La demande de devis chiffre au fichier V9 (le
// dégressif par quantité, les coefficients, les temps de marquage) ; la vente
// directe, elle, n'a pas de moteur : la vendeuse tape un prix à la pièce, et le
// total en découle. Ce sont deux calculs, mais c'est le même besoin — « il en
// veut 100, pas 30 » — et donc la même clé dans la fiche.
//
// Le comptoir envoie le bloc textile TEL QU'IL EST (`n.textile`), sans nom de
// moteur : l'absence de `moteur` vaut donc « textile ». C'est ce qui évite de
// toucher à l'écran du patron pour y ajouter une étiquette.
function bornerChiffrage(brut) {
  if (!brut || typeof brut !== 'object') return null;
  if (brut.moteur === 'unitaire') return bornerUnitaire(brut);
  return bornerTextile(brut);
}

// LE PRIX À LA PIÈCE DE LA VENTE DIRECTE. `unitTTC` est ce que la vendeuse a
// tapé (l'objet plus le travail dessus), `rate` la majoration du délai express.
// La TGCA y est toujours comprise : l'écran a figé « prix TTC, taxe de 4 % »
// comme seule pratique du comptoir.
function bornerUnitaire(brut) {
  const unitTTC = centime(brut.unitTTC);
  if (!(unitTTC > 0) || unitTTC > PRIX_MAX) return null;
  const rate = nombre(brut.rate);
  return {
    moteur: 'unitaire',
    unitTTC,
    rate: rate > 0 && rate <= 10 ? rate : 0,
  };
}

function bornerTextile(brut) {
  const te = TE();
  const sizes = {};
  let total = 0;
  for (const k of te.SIZE_KEYS) {
    const n = Math.round(nombre((brut.sizes || {})[k]));
    sizes[k] = n > 0 && n <= QTE_MAX ? n : 0;
    total += sizes[k];
  }
  // SANS UNE PIÈCE, IL N'Y A RIEN À CHIFFRER. `calculate` rend `null` sur une
  // quantité nulle : garder l'objet ferait croire à la ligne qu'elle est
  // tarifable alors qu'aucun recalcul n'aboutira jamais.
  if (total <= 0) return null;
  const prix = (v) => {
    const n = nombre(v);
    return n > 0 && n <= PRIX_MAX ? centime(n) : 0;
  };
  const ch = {
    ref: mot(brut.ref, 60),
    isCustom: brut.isCustom === true,
    genre: mot(brut.genre, 40),
    transport: mot(brut.transport, 40),
    printType: mot(brut.printType, 60),
    sizes,
    // La remise est un pourcentage, le prix manuel un montant : deux bornes
    // différentes, et le moteur les traite différemment (voir `calculate`).
    discount: Math.min(100, Math.max(0, nombre(brut.discount))),
    manualPrice: prix(brut.manualPrice),
    markupPercent: Math.min(1000, Math.max(0, nombre(brut.markupPercent))),
    // La TGCA se décide par article, et son défaut est COCHÉE : `false` est la
    // seule valeur qui la retire, comme au comptoir (`d.tgca !== false`).
    tgca: brut.tgca !== false,
  };
  if (ch.isCustom) {
    ch.customRef = mot(brut.customRef, 60);
    ch.customDesignation = mot(brut.customDesignation, 120);
    ch.customPurchase = prix(brut.customPurchase);
    // Un produit libre SANS prix d'achat ne se chiffre pas — le moteur rend
    // `null` (`resolveItem`). Autant ne rien garder : la ligne dira qu'elle
    // n'est pas tarifable au lieu d'échouer à chaque correction.
    if (!ch.customPurchase) return null;
  } else if (!ch.ref) {
    return null;
  }
  return ch;
}

// --- REJOUER LE CALCUL ------------------------------------------------------
// `reglages` = ce que la base porte (coût DTF, débit, pressage, coût horaire,
// arrondi, palier de coefficient) PLUS les tarifs de transport. Ils sont posés
// à chaque appel : `calculate` est synchrone, donc deux requêtes concurrentes
// ne peuvent pas s'échanger leurs réglages entre la pose et le calcul.
//
// On repart des valeurs d'usine avant de poser les nôtres. `setSettings` est un
// patch : sans ce retour à zéro, un réglage retiré de la base garderait la
// valeur laissée par l'appel précédent — et le prix bougerait sans que rien
// n'ait changé.
function recalculer(ch, reglages, qte) {
  if (!ch) return null;
  if (ch.moteur === 'unitaire') {
    const n = Math.round(nombre(qte));
    if (!(n > 0) || n > QTE_MAX) return null;
    // Le total de l'écran, refait à l'identique : prix TTC à la pièce, fois la
    // quantité, plus la majoration du délai. (Le passage par le HT et le retour
    // par la taxe s'annulent — c'est la même formule, écrite une fois.)
    const ttc = centime(ch.unitTTC * n * (1 + ch.rate));
    const ht = centime(ttc / (1 + TGCA));
    return { qte: n, unitHT: centime(ch.unitTTC / (1 + TGCA)), ht, taxe: centime(ttc - ht), ttc, revient: null };
  }
  const te = TE();
  te.resetSettings();
  te.setSettings(reglages || {});
  const c = te.calculate(ch);
  if (!c) return null;
  const ht = centime(c.total);
  const taxe = ch.tgca === false ? 0 : centime(ht * TGCA);
  return {
    qte: Math.round(nombre(c.qty)),
    unitHT: centime(c.sold),
    ht,
    taxe,
    ttc: centime(ht + taxe),
    // Le coût de revient de la SÉRIE, pas de la pièce : c'est ce que la ligne
    // du planning porte dans `cout_revient`, et une fiche l'avait déjà payé
    // une fois en marge de 98 % sur un ticket d'essai.
    revient: centime(c.costSeries),
  };
}

// --- ÉCRIRE UNE QUANTITÉ DANS LE CHIFFRAGE ----------------------------------
// La ligne affiche les tailles par LIBELLÉ (« 2 × S », « 12 × 2XL ») parce que
// c'est ce qui se lit à l'établi ; le moteur, lui, travaille sur des CLÉS
// (S/M/L/XL/XXL/other). La correspondance vient du moteur (`SIZE_LABELS`) et
// n'est recopiée nulle part : un libellé recopié de travers, et « 2XL » devient
// une taille que personne ne chiffre.
function cleDeTaille(libelle) {
  const te = TE();
  const cherche = mot(libelle, 40).toLowerCase();
  for (const k of te.SIZE_KEYS) {
    if (String(te.SIZE_LABELS[k]).toLowerCase() === cherche) return k;
  }
  return null;
}

// Les tailles telles que la ligne les affiche, dans l'ordre du moteur.
// UNE TAILLE À ZÉRO EN FAIT PARTIE quand la ligne est tarifable : c'est ce qui
// permet de passer de 0 XL à 20 XL. Le comptoir, lui, ne pose que les tailles
// commandées — il n'a pas à montrer six cases vides sur une tasse.
function taillesDuChiffrage(ch) {
  if (!ch) return null;
  const te = TE();
  return te.SIZE_KEYS.map((k) => ({ t: String(te.SIZE_LABELS[k]), n: nombre(ch.sizes[k]) }));
}

// La liste passée est CELLE DE LA LIGNE EN ENTIER, pas un patch : une taille
// qui n'y figure pas vaut zéro. C'est la seule lecture qui tienne, parce que la
// ligne du planning ne garde pas les tailles à zéro (« 0 × XL » n'est pas un
// fait à produire). Sans ça, ramener les XL à zéro les laissait dans le calcul
// et le prix ne descendait jamais.
//
// Rend un NOUVEAU chiffrage — on ne touche pas à celui qui est en base avant de
// savoir que le calcul aboutit.
//
// AUCUNE TAILLE RECONNUE = ON NE TOUCHE À RIEN. Une gravure « 33 cl », un
// couteau, une tasse : ces libellés-là ne sont pas ceux du moteur. Tout remettre
// à zéro reviendrait à effacer le chiffrage d'une ligne qu'on ne sait pas lire.
function poserTailles(ch, tailles) {
  if (!ch || !Array.isArray(tailles)) return ch;
  const te = TE();
  const sizes = {};
  for (const k of te.SIZE_KEYS) sizes[k] = 0;
  let connue = false;
  for (const x of tailles) {
    if (!x || typeof x !== 'object') continue;
    const k = cleDeTaille(x.t);
    if (!k) continue;
    const n = Math.round(nombre(x.n));
    if (n < 0 || n > QTE_MAX) continue;
    sizes[k] = n;
    connue = true;
  }
  return connue ? { ...ch, sizes } : ch;
}

module.exports = {
  TGCA,
  bornerChiffrage,
  recalculer,
  poserTailles,
  taillesDuChiffrage,
  cleDeTaille,
  // Exposé pour les tests et pour le serveur : il faut les mêmes clés des deux
  // côtés, et elles ne se recopient pas.
  cles: () => [...TE().SIZE_KEYS],
  libelles: () => ({ ...TE().SIZE_LABELS }),
};
