// ===========================================================================
// LA VUE BUREAU — le bon de commande, et tout ce qui n'a rien à faire à l'établi
// ===========================================================================
// DEUX PAPIERS, DEUX MÉTIERS, ET C'EST LA RAISON D'ÊTRE DE CE FICHIER :
//
//   · le TICKET D'ATELIER (`ticket.js`) part avec le dossier à l'établi. Il
//     ne porte AUCUN argent — ni prix, ni supplément, ni total, ni paiement.
//     Une feuille qui traîne sur un plan de travail n'a pas à annoncer ce que
//     le client a payé, et l'atelier n'en fait rien.
//   · le BON DE COMMANDE (ici) est le document du BUREAU. Il porte tout :
//     les coordonnées complètes, le détail article par article, le prix
//     unitaire, le HT, la taxe, le TTC, l'acompte, l'état du paiement, le coût
//     de revient et la marge, la note interne. C'est lui qu'on ressort quand
//     le client conteste, quand on facture, quand on veut savoir ce qu'une
//     affaire a rapporté.
//
// LES DEUX LISENT LA MÊME LIGNE. Il n'y a pas deux saisies ni deux modèles de
// données : `fiche.prod` fait produire, les colonnes d'argent (`project_value`,
// `cout_revient`, `paye`, `paiement_mode`, `acompte_*`) et `fiche.details`
// font le bureau. Ce fichier ne fait que CHOISIR ce qu'il montre — et c'est ce
// choix, écrit une fois ici, qui garantit que l'argent ne redescende jamais à
// l'atelier par accident.
//
// LE MODÈLE EST PUR : mêmes entrées, mêmes sorties, aucun DOM en dehors de
// `dessinerBureau`. C'est ce qui le rend vérifiable hors navigateur.

import { JETONS_PAPIER, SOCLE_PAPIER, maisonPapier } from './papier.js';
// LE NOM DU CLIENT S'IMPRIME EN CAPITALES, comme il se lit à l'écran : c'est le
// mot qu'on cherche en balayant une pile de papiers. Un particulier comme un
// restaurant. La règle vit dans `nom-client.js`, une seule fois pour les six
// écrans et les deux papiers — et elle ne touche que L'AFFICHAGE, jamais la
// ligne en base.
//
// « Personne à contacter » n'y passe PAS : ce n'est pas le nom du client mais
// un champ libre, et sept fois sur dix il ne porte qu'un prénom (« Mélina »).
import { nomClientAffiche } from './nom-client.js';

const VIDE = '—';
const texte = (v) => {
  const s = String(v == null ? '' : v).trim();
  return s === '' || s === VIDE ? '' : s;
};

const EURO = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const euro = (n) => (Number.isFinite(Number(n)) ? EURO.format(Number(n)) : '');

// La date civile de l'ATELIER (Saint-Martin, UTC−4) pour un HORODATAGE, et le
// simple découpage pour une colonne `date` — qui ne porte pas d'heure et que
// reconstruire en `Date` ferait reculer d'un jour.
const JOUR_ATELIER = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'America/Marigot', day: '2-digit', month: '2-digit', year: 'numeric',
});
function dateInstant(iso) {
  const d = new Date(String(iso || ''));
  return Number.isNaN(d.getTime()) ? '' : JOUR_ATELIER.format(d);
}
function dateSeule(iso) {
  const m = String(iso || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// La TGCA de Saint-Martin. Le HT ne se stocke jamais : il se déduit du TTC et
// du taux du moment — un HT figé mentirait le jour où le taux change.
//
// ET LE TAUX LUI-MÊME EST UN RÉGLAGE (01/09). Il vivait ici en dur : le jour où
// le patron changeait le taux dans Réglages, tout l'écran suivait SAUF ce
// papier, qui continuait d'imprimer un HT à 4 %. La valeur ci-dessous n'est
// plus qu'un REPLI — celui d'un appelant qui ne dit rien — et le taux retenu
// voyage DANS le modèle (`argent.taux`), pour que la feuille, le texte copié et
// le calcul disent tous les trois la même chose.
const TGCA_REPLI = 0.04;
// On écrit « 4 », pas la longue traîne de décimales que 0,04 × 100 donne en
// virgule flottante — elle s'imprimerait telle quelle sur le papier.
const arrondiTaux = (t) => Math.round(Number(t) * 10000) / 100;

const MODES = {
  cb: 'Carte bancaire', especes: 'Espèces', virement: 'Virement', mixte: 'Mixte',
};

// Les libellés du récapitulatif qui parlent d'un ARTICLE : « Article 2 — Prix
// unitaire ». On les regroupe par numéro plutôt que par position, pour qu'une
// ligne manquante ne décale pas tout.
const RE_POSTE = /^(Article|Besoin)\s+(\d+)\s+—\s+(.+)$/;

function postesDuPanier(details) {
  const lignes = Array.isArray(details) ? details : [];
  const postes = new Map();
  for (const l of lignes) {
    if (!l || typeof l !== 'object') continue;
    const m = String(l.k || '').match(RE_POSTE);
    if (!m) continue;
    const no = Number(m[2]);
    if (!postes.has(no)) postes.set(no, { no, champs: {} });
    postes.get(no).champs[m[3]] = texte(l.v);
  }
  return [...postes.values()].sort((a, b) => a.no - b.no);
}

// Ce que les colonnes de la ligne portent déjà : inutile de le répéter depuis
// le bloc client de la fiche.
// `Nom / société` EST `billing_company` : c'est le mot que le comptoir emploie
// dans le bloc client de la fiche, et c'est déjà ce que la ligne « Client : »
// écrit deux lignes plus haut. Il manquait à cette liste — d'où « Client :
// Marie Lestrade » suivi de « Nom / société : Marie Lestrade », sur le document
// qui sert à facturer.
const DEJA_DIT = new Set(['Client', 'Nom / société', 'Type de client', 'WhatsApp',
  'E-mail', 'Téléphone', 'Personne à contacter']);

// Et ce que le bloc TOTAL écrit déjà, en gros, juste au-dessus.
// Et ce que le bloc TOTAL écrit déjà, en gros, juste au-dessus — plus ce que
// l'EN-TÊTE porte maintenant : « Commande » est la référence imprimée en haut à
// droite, et « Origine » dit « Vente directe » sous un titre qui s'appelle déjà
// « Bon de commande ». Deux lignes qui n'apprenaient rien, sur le document où
// chaque ligne coûte une seconde de lecture.
const DEJA_TOTAL = new Set(['Total TTC', 'Total HT', 'Taxe', 'Taxe 4 %', 'Paiement',
  'Nombre d’articles', 'Quantité totale', 'Récupération prévue', 'Date de la vente',
  'Commande', 'Origine']);

// UNE NOTE INTERNE VA DANS LE BLOC INTERNE, pas dans le récapitulatif. Elle
// sortait au milieu de ce que la vendeuse a recueilli, c'est-à-dire dans la
// partie du document qu'on montre — alors que le cadre pointillé juste dessous
// dit « ne pas remettre au client » et existe pour ça.
const RE_NOTE_INTERNE = /^note interne\b/i;

// Ce qui n'appartient à AUCUN article : le dossier lui-même. On le garde tel
// que le comptoir l'a écrit — c'est la trace de la prise de commande.
// `dejaRendu` porte ce que le bloc CLIENT vient d'imprimer pour CE dossier —
// il n'est pas connu d'avance : le comptoir range dans le bloc client tout ce
// qu'il a recueilli en plus (secteur, adresse, fonction du contact), et ces
// mêmes lignes vivent AUSSI dans le récapitulatif. Le document sortait donc
// « Adresse : 12 route de Baie Longue » deux fois, à quinze lignes d'écart, sur
// le papier qui sert à facturer. Une liste figée ne pouvait pas l'attraper :
// c'est le rendu qui décide, donc c'est le rendu qu'on interroge.
function dossierDuPanier(details, dejaRendu) {
  const dit = dejaRendu instanceof Set ? dejaRendu : new Set();
  return (Array.isArray(details) ? details : [])
    .filter((l) => l && typeof l === 'object' && !RE_POSTE.test(String(l.k || '')))
    .map((l) => ({ k: texte(l.k), v: texte(l.v) }))
    // Ni ce que les colonnes portent déjà (le client, ses coordonnées), ni ce
    // que le bloc TOTAL vient d'écrire, ni ce que le bloc CLIENT a rendu : un
    // document qui répète trois fois le nom du client se lit trois fois plus
    // lentement.
    .filter((l) => l.k && l.v && !DEJA_DIT.has(l.k) && !DEJA_TOTAL.has(l.k) && !dit.has(l.k));
}

// L'ARGENT DU DOSSIER, rassemblé en un endroit. C'est le bloc que le ticket
// d'atelier ne verra jamais.
// `Number(null)` vaut ZÉRO, et c'est le piège de ce bloc : un coût de revient
// jamais renseigné devenait 0 €, donc une marge égale au prix de vente — une
// affaire à 100 % de marge, sur le document qui sert à décider. « On ne sait
// pas » et « ça n'a rien coûté » ne se confondent pas.
const nombre = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function argentDe(l, fiche, taux) {
  const ttc = nombre(l.project_value);
  const aPrix = ttc != null;
  const revient = nombre(l.cout_revient);
  const aRevient = revient != null;
  const ht = aPrix ? Math.round((ttc / (1 + taux)) * 100) / 100 : null;
  const pay = (fiche && fiche.paiement) || {};
  const acompte = nombre(l.acompte_montant);
  return {
    taux,
    // « Pas encore chiffré » n'est PAS « gratuit » : sans prix, on l'écrit.
    ttc,
    ht,
    taxe: aPrix ? Math.round((ttc - ht) * 100) / 100 : null,
    revient,
    // La marge se RECALCULE du prix et du revient : figée, elle mentirait dès
    // que le prix bouge.
    marge: aPrix && aRevient ? Math.round((ht - revient) * 100) / 100 : null,
    paye: l.paye === true,
    mode: MODES[l.paiement_mode] || texte(pay.modeLabel) || '',
    acompteDemande: l.acompte_demande === true,
    acompteVerse: l.acompte_verse === true,
    acompte,
  };
}

// LE PRIX D'UNE PIÈCE, TEL QUE LE COMPTOIR L'A ÉCRIT.
//
// La colonne « P.U. » du papier était VIDE sur toute vente directe. Elle
// cherchait « Prix unitaire HT » — un libellé que seule la demande de devis
// écrit. La vente, elle, en écrit DEUX : le prix de l'article et celui de la
// personnalisation, que le client paie additionnés (`price = priceArticle +
// priceCustom`, puis `unitHT = price / 1.04`). Le bureau imprimait donc une
// colonne vide sur son document le plus utilisé.
//
// ET CE SONT DES PRIX TTC. C'est le sens que leur donne l'écran de vente : il
// en DÉDUIT le HT en divisant par 1,04. Les additionner sous un intitulé
// « P.U. HT » aurait donné un prix faux de 4 % — l'entête suit donc la source.
const MONTANT = /-?\d[\d\s\u00a0\u202f]*(?:[.,]\d+)?/;
function montant(v) {
  const m = String(v == null ? '' : v).match(MONTANT);
  if (!m) return null;
  const n = Number(m[0].replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function uniteVendue(champs) {
  // Une demande chiffrée dit son prix unitaire : il fait foi, tel quel.
  const dit = champs['Prix unitaire HT'] || champs['Prix unitaire'] || '';
  if (dit) return dit;
  const article = montant(champs['Prix article']);
  const perso = montant(champs['Prix personnalisation']);
  // « Pas de prix » et « prix à zéro » ne se confondent pas : sans aucun des
  // deux libellés, la case reste vide plutôt que d'annoncer 0,00 €.
  if (article == null && perso == null) return '';
  return euro((article || 0) + (perso || 0));
}

// Une note qui redit une ligne déjà imprimée n'est pas une note.
//
// `dejaDit` porte TOUT ce que la feuille a déjà écrit : le récapitulatif, et le
// détail de chaque article. La colonne `description` d'un dossier du comptoir
// est remplie par l'écran avec la description de production — c'est-à-dire mot
// pour mot ce que la ligne du tableau imprime sous la désignation. Le document
// la redisait donc dans le cadre « ne pas remettre au client », à dix lignes
// d'écart, sur la même feuille.
function noteUtile(note, dejaDit) {
  if (!note) return '';
  const nu = (v) => String(v).replace(/\s+/g, ' ').trim().toLowerCase();
  const dit = nu(note);
  return dejaDit.some((v) => nu(v) === dit) ? '' : note;
}

// L'ÉMETTEUR DU DOCUMENT. Il vient des réglages de l'atelier, jamais du code :
// une adresse écrite en dur demanderait un déploiement le jour d'un
// déménagement, et elle serait fausse jusque-là sur tous les papiers déjà
// imprimés.
//
// TOUT EST FACULTATIF ET RIEN N'EST INVENTÉ. Tant que le patron n'a pas rempli
// les réglages, le papier porte le seul nom qu'on connaisse — c'est déjà plus
// que rien, et c'est honnête. Une ligne vide ne s'imprime pas : « Adresse : — »
// sur un document qui sert à facturer vaut moins que pas de ligne du tout.
// DEUX NUMÉROS QUI SE LISENT, PAS QUI SE DÉCHIFFRENT.
//
// La valeur STOCKÉE ne bouge jamais : ces deux fonctions habillent l'AFFICHAGE,
// et rien d'autre. Le patron saisit ce qu'il a sous les yeux, dix chiffres
// collés pour le téléphone et quatorze pour le SIRET, et c'est très bien : on
// ne lui impose pas une saisie formatée qu'il faudrait réussir du premier coup.
// (Aucun numéro réel n'est cité ici : les vrais vivent en base, pas dans le
// dépôt — c'est ce que le garde-fou refuse, et il a servi en l'écrivant.)
//
// ET ELLES NE TOUCHENT QUE CE QU'ELLES RECONNAISSENT. Une valeur qui n'a pas la
// forme attendue (un numéro international, une saisie déjà espacée, un SIRET
// incomplet) ressort TELLE QUELLE : mieux vaut un numéro brut qu'un numéro
// découpé de travers sur le document qui sert à facturer.

// L'IDENTITÉ DE LA MAISON EST DANS LE SOCLE (`papier.js`) depuis le 01/09 :
// le DEVIS la demande mot pour mot — nom, adresse, contact, numéros légaux,
// coordonnées bancaires. Recopiée ici, elle serait devenue deux identités le
// jour où l'une bouge, et cet écart-là ne se voit qu'en comparant deux
// documents IMPRIMÉS. Les habillages du téléphone et du SIRET l'ont suivie :
// ils n'habillent que ce qu'ils reconnaissent, et la valeur stockée ne bouge
// jamais.
const maisonDe = maisonPapier;

// LE MODÈLE DU BON DE COMMANDE. `l` est une ligne du planning avec sa fiche
// COMPLÈTE (celle de la liste est allégée du détail — voir allegerFiche).
export function modeleBureau(l, entreprise, tauxTgca) {
  const r = l && typeof l === 'object' ? l : {};
  const f = r.fiche && typeof r.fiche === 'object' ? r.fiche : {};
  const demande = f.source === 'Demande de devis' || r.order_kind === 'demande';
  let postes = postesDuPanier(f.details);

  // UN PANIER DE QUATRE ARTICLES, C'EST QUATRE LIGNES AU PLANNING — et chacune
  // porte SA part du prix (`project_value`). Le récapitulatif, lui, est celui
  // du dossier ENTIER et reste identique sur les quatre lignes : rendre les
  // quatre articles à côté d'un total qui n'en couvre qu'un, c'est un document
  // qui se contredit — 438 € de détail sous un total de 288 €, sur le papier
  // qui sert à facturer.
  // On ne filtre QUE si le compte tombe juste : sur un dossier d'avant le
  // découpage, ou dont le récapitulatif ne s'aligne plus, le document entier
  // vaut mieux qu'un document arbitrairement amputé.
  const lot = f.lot && typeof f.lot === 'object' ? f.lot : null;
  const rang = lot ? Number(lot.rang) : 0;
  const total = lot ? Number(lot.total) : 0;
  const seulPoste = rang >= 1 && total >= 1 && postes.length === total;
  if (seulPoste) postes = [postes[rang - 1]];

  // Ce que le bloc CLIENT va rendre en propre, calculé UNE fois : le tri des
  // doublons se fait ici, pas dans chaque rendu — fait deux fois, il finit par
  // diverger, et c'est déjà arrivé entre le papier et le texte.
  const autresClient = (Array.isArray(f.client) ? f.client : [])
    .map((x) => ({ k: texte(x && x.k), v: texte(x && x.v) }))
    .filter((x) => x.k && x.v && !DEJA_DIT.has(x.k));
  const recueilli = dossierDuPanier(f.details, new Set(autresClient.map((x) => x.k)));
  // LE DÉTAIL, ARTICLE PAR ARTICLE. Le bureau veut le prix unitaire, la
  // quantité et ce qui a été vendu — pas la fiche de production.
  const articles = postes.map((p) => ({
    no: p.no,
    designation: p.champs['Désignation'] || '',
    quantite: p.champs['Quantité'] || '',
    categorie: p.champs['Catégorie'] || '',
    reference: p.champs['Référence'] || '',
    couleur: p.champs['Couleur'] || '',
    unitaire: uniteVendue(p.champs),
    total: p.champs['Total TTC'] || '',
    detail: p.champs['Description de production'] || p.champs['Informations importantes'] || '',
  }));
  const dossier = recueilli.filter((x) => !RE_NOTE_INTERNE.test(x.k));
  const notes = recueilli.filter((x) => RE_NOTE_INTERNE.test(x.k)).map((x) => x.v);

  return {
    // QUI ÉMET CE PAPIER.
    maison: maisonDe(entreprise),
    // CE QU'EST CE PAPIER. Une demande n'est pas une commande : promettre un
    // « bon de commande » sur un dossier que personne n'a chiffré, c'est le
    // faire passer pour vendu.
    titre: demande ? 'Demande de devis' : 'Bon de commande',
    demande,
    ref: texte(f.ref),
    // La référence portée par le ticket déjà remis au client, quand le serveur
    // a dû en changer : sans elle, plus personne ne relie les deux papiers.
    refTicket: texte(f.refTicket),
    // « Article 2 sur 4 » : ce papier ne couvre qu'une ligne de la commande, et
    // le bureau doit le savoir avant de facturer.
    lot: seulPoste && total > 1 ? { rang, total } : null,
    priseLe: dateInstant(f.creeLe) || dateInstant(r.created_at),
    retrait: dateSeule(r.deadline),
    heure: texte(f.heureSouhaitee),
    // POUR QUI, en entier — c'est un document du bureau : il sert à facturer,
    // à relancer, à retrouver.
    client: {
      nom: nomClientAffiche(texte(r.billing_company), r.client_type),
      type: r.client_type === 'perso' ? 'Particulier' : 'Professionnel',
      contact: texte(r.contact_referent),
      tel: texte(r.contact_phone),
      email: texte(r.contact_email),
      // Ce que le comptoir a recueilli en plus (adresse, secteur, fonction) :
      // il vit dans son propre bloc de la fiche, on le rend tel quel.
      // CE QUI N'EST PAS DÉJÀ DIT AU-DESSUS. Le bloc client de la fiche
      // reprend le nom et l'e-mail que les colonnes portent déjà : les rendre
      // tels quels donnait « Client : Blue Martini » deux fois, à deux lignes
      // d'intervalle. Le tri se fait ICI, une fois — fait dans chaque rendu, il
      // finit par diverger, et c'est arrivé entre le papier et le texte.
      autres: autresClient,
    },
    responsable: texte(r.responsable),
    articles,
    // Le récapitulatif du dossier, tel que la vendeuse l'a rempli. Il porte ce
    // qu'aucune colonne ne range : le canal d'entrée, l'objet du projet, le
    // délai, la note interne.
    dossier,
    // Ce que la vendeuse a noté pour nous, et pour personne d'autre.
    notes,
    argent: argentDe(r, f, Number.isFinite(Number(tauxTgca)) ? Number(tauxTgca) : TGCA_REPLI),
    // Ce que la vendeuse a écrit de sa main sur la ligne — SAUF quand elle ne
    // l'a pas écrite. La colonne `description` d'un dossier du comptoir est
    // remplie par l'écran (« Délai souhaité : Sous 10 jours ouvrés »), et cette
    // phrase est mot pour mot une ligne du récapitulatif imprimé vingt lignes
    // plus haut. Le document la disait donc deux fois, dont une sous un cadre
    // « ne pas remettre au client » où elle n'apprend rien.
    // TOUT CE QUE LA FEUILLE A DÉJÀ ÉCRIT : le récapitulatif, et le détail de
    // chaque article. Sans le second, la consigne de production sortait DEUX
    // fois — sous la désignation dans le tableau, puis dans le cadre interne.
    note: noteUtile(texte(r.description), [
      ...recueilli.map((x) => `${x.k} : ${x.v}`), ...recueilli.map((x) => x.v),
      ...articles.map((a) => a.detail),
    ]),
    production: texte(f.production),
  };
}

// ===========================================================================
// LA FEUILLE — A4 portrait, autonome
// ===========================================================================
// ATTENTION, DEUX PIÈGES DÉJÀ PAYÉS SUR LE TICKET :
//   1. AUCUN ACCENT GRAVE ici : la feuille est un littéral gabarit, un accent
//      grave dans un commentaire le TERMINE. Le module reste syntaxiquement
//      valide, `node --check` passe, et l'application s'ouvre sur un écran NU.
//   2. AUCUN JETON ÉTRANGER (`var(--pas-3)`, `var(--text-1)`…). Le cadre
//      d'impression ne charge QUE cette chaîne : un jeton de `charte.css` y
//      vaut la chaîne vide, donc le rembourrage tombe à zéro SUR LE PAPIER et
//      nulle part ailleurs — l'aperçu a la charte, il reste impeccable.
//      Tous les jetons d'ici commencent par `--bu-`.
export const CSS_BUREAU = SOCLE_PAPIER + `
  /* L'ÉCHELLE DU DOCUMENT — QUATRE CRANS.
     Le bon de commande en déclarait sept (34 / 30 / 20 / 17 / 14 / 12 / 10),
     dont un titre à 34 px qui prenait le tiers de l'en-tête pour annoncer ce
     que le document est déjà, et deux crans de corps qui ne se distinguaient
     pas à la lecture. Il en reste quatre :
       --bu-geant  le MONTANT. Un seul par feuille : c'est le fait qu'on vient
                   chercher sur un document du bureau.
       --bu-cle    ce qui identifie : le titre, le numéro, le nom du client, le
                   nom de la maison.
       --bu-texte  tout le corps du document.
       le cran des intitulés vit dans papier.js, avec le ticket.
     POURQUOI 13 ET NON 15 comme le ticket : les deux papiers ne se lisent pas
     à la même distance. Le ticket est sur un plan de travail, on le lit à bout
     de bras et il porte six faits ; celui-ci se lit à trente centimètres et
     porte tout le dossier. L'encre, le gris, le filet, les intitulés et la
     marge, eux, sont communs — ils sont dans papier.js.
     ATTENTION, DEUX PIÈGES DÉJÀ PAYÉS SUR LE TICKET :
       1. AUCUN ACCENT GRAVE ici : ce gabarit est un littéral, un accent grave
          dans un commentaire le TERMINE. Le module reste valide, node --check
          passe, et l'application s'ouvre sur un écran NU.
       2. AUCUN JETON ÉTRANGER : le cadre d'impression ne charge QUE cette
          chaîne. Un jeton de la charte y vaut la chaîne vide, donc un
          rembourrage à zéro SUR LE PAPIER et nulle part ailleurs. */
  .bu {${JETONS_PAPIER}
       --bu-geant: 30px; --bu-cle: 17px; --bu-texte: 13px;
       --bu-rang: 26px; --bu-gouttiere: 26px; --bu-section: 24px;
       width: 210mm; min-height: 297mm; box-sizing: border-box; margin: 0 auto;
       display: flex; flex-direction: column;
       background: #ffffff; color: var(--pap-encre);
       font: var(--bu-texte)/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
       font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
  .bu * { box-sizing: border-box; }

  /* L'EN-TÊTE PORTE L'ÉMETTEUR, et c'est le défaut de fond qui a été corrigé
     le 28/08 : le document ne disait pas de qui il venait. Un bon de commande
     sans nom, sans adresse et sans numéro légal n'est pas un document, c'est
     une note — on ne le classe pas, on ne le joint pas, on ne s'en sert pas
     pour relancer. L'identité vient des réglages, pas du code : un
     déménagement ne doit pas demander un déploiement. Un champ vide ne
     s'imprime pas. */
  .bu__tete { display: flex; align-items: flex-start; justify-content: space-between;
              gap: 28px; padding: 26px var(--pap-marge) 16px; border-bottom: 3px solid var(--pap-encre); }
  /* UNE LIGNE D'ADRESSE PEUT ÊTRE LONGUE, et elle est saisie à la main : le
     réglage accepte 160 signes. Sans point de coupure, une valeur d'un seul
     tenant poussait le titre et le numéro HORS de la feuille — vu au premier
     essai dans l'application, sur une saisie de contrôle. */
  .bu__maison { display: flex; flex-direction: column; gap: 1px; min-width: 0;
                overflow-wrap: anywhere; }
  .bu__maison-nom { font-size: var(--bu-cle); font-weight: 800; letter-spacing: -.02em;
                    line-height: 1.2; margin-bottom: 3px; }
  .bu__maison-l { color: var(--pap-ardoise); line-height: 1.35; }
  .bu__ref { display: flex; flex-direction: column; align-items: flex-end; gap: 3px;
             text-align: right; flex: 0 0 auto; }
  /* LE TITRE NE CRIE PLUS. À 34 px il annonçait en capitales grasses ce que le
     numéro juste dessous disait déjà, et il déséquilibrait toute la feuille :
     le plus gros caractère d'un document du bureau doit être le MONTANT. */
  .bu__titre { font-size: var(--bu-cle); font-weight: 800; letter-spacing: .04em;
               line-height: 1.15; text-transform: uppercase; white-space: nowrap; }
  .bu__ref-v { font: 700 var(--bu-cle)/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

  /* TOUT EST SUR LA MÊME GRILLE, ET TOUTES LES LIGNES SONT DROITES (28/08).
     Charlie, capture à l'appui : « tout doit être bien droit sur des lignes
     parfaitement lisibles ». Les deux cadres CLIENT et DOSSIER étaient deux
     boîtes indépendantes : la première rangée de gauche tombait à 194,4 px du
     haut de la feuille, celle de droite à 169,8 — 24,6 px de décalage, et les
     rangées suivantes ne se rattrapaient jamais. Deux colonnes qu'on lit
     ensemble et dont aucune ligne n'est en face de l'autre.
     Une SEULE grille les porte maintenant, et les paires y sont posées en
     alternance : la grille impose alors la rangée, et deux lignes voisines sont
     à la même hauteur par construction — pas par coïncidence de contenu. */
  /* L'ÉCART ENTRE DEUX SECTIONS est un jeton, et il vaut plus du double de
     l'écart entre deux lignes : c'est ce qui fait qu'on VOIT qu'on change de
     sujet avant même d'avoir lu l'intitulé. */
  .bu__corps { flex: 1; min-height: 0; display: flex; flex-direction: column;
               gap: var(--bu-section); padding: 16px var(--pap-marge) 0; }
  .bu__grille { display: grid; grid-template-columns: 1fr 1fr; column-gap: var(--bu-gouttiere); }
  /* LE TOTAL PREND TOUTE LA LARGEUR (28/08). Il a eu trois places en une
     journée, et la dernière est la bonne : une boîte de 76 mm flottant à droite
     (une largeur à elle, qui ne s'alignait sur rien), puis la colonne de gauche
     de la grille, puis toute la ligne — « tout ça doit prendre toute la longueur
     de la ligne », Charlie.
     C'est aussi ce qui met les montants du total exactement sous la colonne
     « Total TTC » du tableau qu'ils additionnent, et l'intitulé sous la
     désignation. Le document se lit alors en une seule descente : chaque ligne
     commence au bord gauche et finit au bord droit. */

  /* UNE LIGNE, UNE HAUTEUR. C'est le rythme du document entier : intitulé à
     gauche, valeur à droite, un filet en dessous, et la ligne suivante tombe au
     pas suivant. La hauteur est un JETON — écrite en clair, elle se recopie de
     travers et le rythme se casse à la troisième reprise. */
  .bu__paire { display: flex; align-items: baseline; justify-content: space-between;
               gap: 12px; min-height: var(--bu-rang); padding: 4px 0;
               border-bottom: 1px dotted var(--pap-filet); }
  .bu__k { color: var(--pap-ardoise); }
  .bu__v { font-weight: 700; text-align: right; }
  /* UNE CELLULE VIDE GARDE SON FILET : c'est ce qui fait qu'une colonne plus
     courte que l'autre ne casse pas la réglure. Un tableau à trous se lit comme
     un tableau ; un tableau dont les traits s'arrêtent au milieu se lit comme
     une erreur. */
  .bu__paire--vide { border-bottom-color: var(--pap-filet); }
  /* L'INTITULÉ D'UNE SECTION, ET LA SÉPARATION QUI VA AVEC (28/08).
     Charlie : « le bon de commande sépare chaque secteur, qu'il soit
     parfaitement visible ». Les six sections — client, dossier, détail, total,
     ce qui a été recueilli, interne — se suivaient à seize pixels d'écart, avec
     un intitulé gris ardoise et un filet de la même épaisseur que les lignes.
     Résultat : une longue coulée de pointillés où rien ne dit qu'on change de
     sujet.
     L'intitulé passe donc à l'ENCRE et prend la graisse : c'est lui qui coupe.
     Le filet passe à 2 px — le double d'une ligne — et l'espace au-dessus est
     celui d'une respiration, pas d'un interligne (jeton --bu-section, dans le
     corps). Il est DANS la grille, donc les deux intitulés de la première
     section tombent au même endroit : posés dans deux boîtes séparées, ils
     suivaient chacun le rembourrage de la sienne. */
  .bu__col-k { padding-bottom: 6px; border-bottom: 2px solid var(--pap-encre);
               color: var(--pap-encre); font-weight: 700; }
  /* LE NOM DU CLIENT est la première valeur de sa colonne, à la place d'une
     paire : c'est POUR QUI, et ça se lit avant tout le reste. La rangée reste
     la rangée — la grille lui donne la même hauteur qu'à sa voisine de droite. */
  .bu__nom { display: flex; align-items: baseline; min-height: var(--bu-rang);
             padding: 4px 0; border-bottom: 1px dotted var(--pap-filet);
             font-size: var(--bu-cle); font-weight: 800; letter-spacing: -.02em; }

  /* LE DÉTAIL. Les colonnes sont FIXÉES : sans largeur déclarée, la colonne des
     prix se calait sur son contenu et bougeait d'un document à l'autre — deux
     bons de commande côte à côte ne se comparaient plus. La désignation prend
     ce qui reste. */
  .bu__table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  /* L'EN-TÊTE DU TABLEAU EST L'INTITULÉ DE SA SECTION : même encre, même
     graisse, même filet de 2 px que « Total » ou « Interne ». */
  .bu__table th { padding: 0 8px 6px; border-bottom: 2px solid var(--pap-encre); text-align: left;
                  font: 700 var(--pap-cap)/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                  letter-spacing: .16em; color: var(--pap-encre); }
  .bu__table td { height: var(--bu-rang); padding: 4px 8px;
                  border-bottom: 1px dotted var(--pap-filet); vertical-align: top; }
  .bu__col--qte { width: 15mm; }
  .bu__col--pu { width: 25mm; }
  .bu__col--total { width: 27mm; }
  .bu__num { text-align: right; white-space: nowrap; }
  .bu__desi { font-weight: 700; }
  .bu__sous { display: block; color: var(--pap-ardoise); line-height: 1.3; }

  /* LE TOTAL. Même rythme de lignes que tout le reste, et le TTC détaché par le
     seul trait plein du bloc : c'est le chiffre qu'on vient chercher. */
  .bu__ttc { display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
             min-height: var(--bu-rang); padding: 8px 0 4px;
             border-top: 1.5px solid var(--pap-encre); border-bottom: 1.5px solid var(--pap-encre); }
  .bu__ttc-v { font-size: var(--bu-geant); font-weight: 800; letter-spacing: -.03em; line-height: 1; }
  .bu__achiffrer { display: flex; align-items: center; min-height: var(--bu-rang);
                   font-size: var(--bu-cle); font-weight: 800; }

  /* LE BLOC INTERNE. Marge, coût de revient, note : il ne sort PAS chez le
     client. Un liseré rayé le dit sans qu'on ait besoin de le lire. */
  .bu__interne { border: 1px dashed var(--pap-encre); padding: 10px 12px; }
  .bu__interne-tete { display: flex; align-items: baseline; justify-content: space-between;
                      gap: 12px; padding-bottom: 6px; border-bottom: 2px solid var(--pap-encre); }
  /* … et son intitulé coupe comme les autres. */
  .bu__interne-tete .pap-cap:first-child { color: var(--pap-encre); font-weight: 700; }
  .bu__grille3 { display: grid; grid-template-columns: repeat(3, 1fr); column-gap: var(--bu-gouttiere); }
  .bu__mesure { display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
                min-height: var(--bu-rang); padding: 4px 0;
                border-bottom: 1px dotted var(--pap-filet); }
  .bu__mesure-v { font-weight: 800; }
  .bu__libre { margin: 0; min-height: var(--bu-rang); padding: 4px 0;
               border-bottom: 1px dotted var(--pap-filet); white-space: pre-wrap; }

  /* LE CADRE À ÉCRIRE ABSORBE, IL NE POUSSE PAS. Il est le seul bloc élastique
     de la page : c'est lui qui la fait tomber sur 297 mm pile, quel que soit le
     dossier. Sans lui, un dossier peu rempli laissait un tiers de feuille
     blanche sans rien dire, et un dossier chargé partait sur une seconde page.
     Ses lignes sont AU PAS DU DOCUMENT : on écrit dessus dans le même rythme
     que ce qui est imprimé au-dessus. */
  .bu__obs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .bu__obs-lignes { flex: 1; min-height: 0;
                    background-image: repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--bu-rang) - 1px), var(--pap-filet) calc(var(--bu-rang) - 1px), var(--pap-filet) var(--bu-rang)); }

  .bu__pied { display: flex; align-items: center; justify-content: space-between; gap: 24px;
              margin-top: auto; padding: 12px var(--pap-marge) 20px; border-top: 1px dashed var(--pap-encre);
              white-space: nowrap; }
  .bu__pied .pap-cap { overflow: hidden; text-overflow: ellipsis; }
  .bu + .bu { break-before: page; page-break-before: always; }
`;

// ===========================================================================
// LE DESSIN
// ===========================================================================
// `doc` est passé en paramètre : le cadre d'impression a SON document, et
// dessiner dans celui de la page puis recopier perdrait la mise en page.
export function dessinerBureau(t, doc) {
  const el = (tag, cls, txt) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };
  const cap = (txt, cls) => el('div', cls ? `pap-cap ${cls}` : 'pap-cap', txt);
  const paire = (k, v) => {
    const p = el('div', 'bu__paire');
    p.append(el('span', 'bu__k', k), el('span', 'bu__v', v));
    return p;
  };

  const feuille = el('div', 'bu');

  // --- L'en-tête : QUI l'émet, ce que c'est, et son numéro ------------------
  // L'ÉMETTEUR EST À GAUCHE, comme sur tout document commercial : c'est la
  // première chose qu'on lit, et c'est ce qui manquait. Le document ne disait
  // pas de qui il venait — ni nom, ni adresse, ni numéro légal.
  const tete = el('div', 'bu__tete');
  const maison = el('div', 'bu__maison');
  if (t.maison.nom) maison.append(el('div', 'bu__maison-nom', t.maison.nom));
  for (const ligne of t.maison.lignes) maison.append(el('div', 'bu__maison-l', ligne));
  if (t.maison.contact.length) {
    maison.append(el('div', 'bu__maison-l', t.maison.contact.join(' · ')));
  }
  // Les numéros légaux ne sont PAS ici : ils sont au pied, là où on les cherche
  // sur un document commercial et où ils ne disputent pas la place à ce qui
  // sert tous les jours (le nom, l'adresse, de quoi joindre la maison).
  tete.append(maison);

  const bRef = el('div', 'bu__ref');
  bRef.append(el('div', 'bu__titre', t.titre));
  // PAS DE RÉFÉRENCE, PAS DE LIGNE. Un dossier créé à la main dans la grille
  // n'a pas de numéro de comptoir : le document affichait alors un tiret seul
  // en 17 px sous son titre — un trait qui ne dit rien, à l'endroit le plus
  // regardé de la feuille.
  if (t.ref) bRef.append(el('div', 'bu__ref-v', t.ref));
  // QUAND. Un document commercial porte sa date à côté de son numéro : sans
  // elle, deux versions du même dossier ne se départagent pas.
  if (t.priseLe) bRef.append(cap(`${t.demande ? 'Demande reçue le' : 'Établi le'} ${t.priseLe}`));
  // Le numéro que porte le ticket déjà remis au client, quand il diffère : sans
  // lui, le client tend un papier qu'on ne retrouve nulle part.
  if (t.refTicket) bRef.append(el('div', 'bu__sous', `ticket remis : ${t.refTicket}`));
  if (t.lot) bRef.append(el('div', 'bu__sous', `article ${t.lot.rang} sur ${t.lot.total}`));
  tete.append(bRef);
  feuille.append(tete);

  const corps = el('div', 'bu__corps');
  feuille.append(corps);

  // --- L'IDENTITÉ : le client et le dossier, SUR LA MÊME GRILLE -------------
  // Les deux colonnes étaient deux cadres indépendants : leurs rangées ne
  // tombaient jamais en face (24,6 px d'écart, mesuré). Une seule grille les
  // porte, et on y pose les cellules en ALTERNANCE — gauche, droite, gauche,
  // droite. La rangée est alors imposée par la grille, pas par le hasard des
  // contenus. Une colonne plus courte que l'autre reçoit une cellule vide, qui
  // garde son filet : un tableau à trous se lit, un tableau dont les traits
  // s'arrêtent au milieu se lit comme une erreur.
  const idt = el('div', 'bu__grille');
  const gauche = [el('div', 'pap-cap bu__col-k', 'CLIENT')];
  const droite = [el('div', 'pap-cap bu__col-k', 'DOSSIER')];

  // Le nom prend la place de la première paire de sa colonne : c'est POUR QUI,
  // et ça se lit avant tout le reste.
  gauche.push(el('div', 'bu__nom', t.client.nom || '—'));
  for (const [k, v] of [['Type', t.client.type], ['Contact', t.client.contact],
    ['Téléphone', t.client.tel], ['E-mail', t.client.email]]) {
    // UN CHAMP VIDE NE S'AFFICHE PAS. « E-mail : — » n'apprend rien et pousse
    // vers le bas ce qu'on cherche vraiment.
    if (v) gauche.push(paire(k, v));
  }
  for (const x of t.client.autres) gauche.push(paire(x.k, x.v));

  if (t.retrait) droite.push(paire('Récupération', t.heure ? `${t.retrait} à ${t.heure}` : t.retrait));
  if (t.responsable) droite.push(paire('Suivi par', t.responsable));
  if (t.production) droite.push(paire('Production', t.production));

  for (let i = 0; i < Math.max(gauche.length, droite.length); i += 1) {
    idt.append(gauche[i] || el('div', 'bu__paire bu__paire--vide'),
      droite[i] || el('div', 'bu__paire bu__paire--vide'));
  }
  corps.append(idt);

  // --- LE DÉTAIL : c'est le cœur du document du bureau ----------------------
  if (t.articles.length) {
    const bloc = el('div');
    const table = el('table', 'bu__table');
    // LES LARGEURS SONT DÉCLARÉES, ET ELLES LE SONT EN CSS. Sans largeur, la
    // colonne des prix se calait sur son contenu : un document à 1 362 € et un
    // autre à 88 € n'avaient pas la même grille, et deux bons de commande côte
    // à côte ne se comparaient plus.
    // EN CSS ET PAS EN STYLE EN LIGNE : le document se dessine aussi hors
    // navigateur — les tests le rendent dans un DOM minimal, sans propriété
    // `style`, et c'est cette portabilité qui permet de vérifier le papier sans
    // ouvrir Chrome. Même règle que la grille du ticket.
    const groupe = el('colgroup');
    const colonnesL = t.demande
      ? ['', 'bu__col--qte']
      : ['', 'bu__col--qte', 'bu__col--pu', 'bu__col--total'];
    for (const cls of colonnesL) groupe.append(el('col', cls));
    table.append(groupe);
    const thead = el('thead');
    const trh = el('tr');
    // EN CAPITALES, comme tous les autres intitulés de la feuille. Le socle ne
    // les force plus (il mettait aussi « mm » en « MM » sur le ticket) : elles
    // s'écrivent donc ici. « Désignation » en casse mixte au milieu de CLIENT,
    // DOSSIER, TOTAL et OBSERVATIONS se lisait comme un intitulé d'une autre
    // famille — alors que c'en est exactement un.
    const colonnes = t.demande
      ? ['DÉSIGNATION', 'QTÉ']
      : ['DÉSIGNATION', 'QTÉ', 'P.U. TTC', 'TOTAL TTC'];
    for (const c of colonnes) trh.append(el('th', c === 'DÉSIGNATION' ? '' : 'bu__num', c));
    thead.append(trh);
    table.append(thead);
    const tbody = el('tbody');
    for (const a of t.articles) {
      const tr = el('tr');
      const td = el('td');
      td.append(el('span', 'bu__desi', a.designation || `Article ${a.no}`));
      // Ce qui identifie la pièce, en dessous et en petit : la référence, la
      // couleur, la catégorie. Le bureau doit pouvoir recommander à l'identique.
      const sous = [a.reference, a.couleur, a.categorie].filter(Boolean).join(' · ');
      if (sous) td.append(el('span', 'bu__sous', sous));
      if (a.detail) td.append(el('span', 'bu__sous', a.detail));
      tr.append(td, el('td', 'bu__num', a.quantite || ''));
      if (!t.demande) {
        tr.append(el('td', 'bu__num', a.unitaire || ''), el('td', 'bu__num', a.total || ''));
      }
      tbody.append(tr);
    }
    table.append(tbody);
    bloc.append(table);
    corps.append(bloc);
  }

  // --- L'ARGENT. Le bloc que le ticket d'atelier ne verra jamais ------------
  // IL EST SUR LA COLONNE DE DROITE DE LA MÊME GRILLE. Il avait une largeur à
  // lui (76 mm) qui ne s'alignait sur rien : la boîte flottait à droite du vide.
  const arg = t.argent;
  const boite = el('div');
  boite.append(el('div', 'pap-cap bu__col-k', 'TOTAL'));
  if (arg.ttc == null) {
    // « Pas encore chiffré » n'est PAS « gratuit ». On l'écrit en toutes
    // lettres plutôt que d'imprimer 0,00 € sur un document qui sert à facturer.
    boite.append(el('div', 'bu__achiffrer', 'À chiffrer'));
  } else {
    boite.append(paire('Total HT', euro(arg.ht)), paire(`TGCA ${arrondiTaux(arg.taux)} %`, euro(arg.taxe)));
    const ttc = el('div', 'bu__ttc');
    ttc.append(el('span', 'bu__k', 'TTC'), el('span', 'bu__ttc-v', euro(arg.ttc)));
    boite.append(ttc);
    if (arg.acompte != null) boite.append(paire('Acompte versé', euro(arg.acompte)));
    boite.append(paire('Règlement', arg.paye ? (arg.mode || 'Payé') : 'À encaisser'));
  }
  corps.append(boite);

  // --- Ce que la vendeuse a recueilli, tel qu'elle l'a écrit ----------------
  if (t.dossier.length) {
    const bloc = el('div');
    bloc.append(el('div', 'pap-cap bu__col-k', 'CE QUI A ÉTÉ RECUEILLI'));
    for (const x of t.dossier) bloc.append(paire(x.k, x.v));
    corps.append(bloc);
  }

  // --- LE BLOC INTERNE : marge, revient, note. Ne sort pas chez le client ---
  const interne = el('div', 'bu__interne');
  const teteI = el('div', 'bu__interne-tete');
  teteI.append(cap('INTERNE'), el('span', 'bu__sous', 'ne pas remettre au client'));
  interne.append(teteI);
  const g = el('div', 'bu__grille3');
  const mesure = (k, v) => {
    const m = el('div', 'bu__mesure');
    m.append(cap(k), el('span', 'bu__mesure-v', v));
    return m;
  };
  g.append(
    mesure('COÛT DE REVIENT', arg.revient == null ? '—' : euro(arg.revient)),
    mesure('MARGE', arg.marge == null ? '—' : euro(arg.marge)),
    mesure('ACOMPTE', arg.acompteDemande ? (arg.acompteVerse ? 'versé' : 'demandé') : '—'),
  );
  interne.append(g);
  for (const n of t.notes || []) interne.append(el('p', 'bu__libre', n));
  if (t.note) interne.append(el('p', 'bu__libre', t.note));
  corps.append(interne);

  // --- CE QU'ON ÉCRIT DESSUS, et ce qui fait tomber la feuille à 297 mm -----
  // Le cadre est réglé, pas vide : un rectangle nu ne se remplit pas, des
  // lignes si. Il absorbe ce qui reste — sans lui, un dossier peu rempli
  // laissait un tiers de feuille blanche sans rien dire.
  const obs = el('div', 'bu__obs');
  obs.append(el('div', 'pap-cap bu__col-k', 'OBSERVATIONS'), el('div', 'bu__obs-lignes'));
  corps.append(obs);

  // --- Le pied -------------------------------------------------------------
  // LE PIED IDENTIFIE UNE FEUILLE DÉTACHÉE, il ne redit pas l'en-tête. Il
  // portait le nom, le titre, le numéro ET les coordonnées — tout ce qui est
  // déjà écrit vingt centimètres plus haut, sur deux lignes qui revenaient à la
  // ligne en plein milieu du numéro. Les mentions légales, elles, sont à leur
  // place ici : c'est là qu'on les cherche sur un document commercial.
  const pied = el('div', 'bu__pied');
  pied.append(cap(t.maison.legal.join(' · ')),
    cap(`${t.maison.nom}${t.ref ? ` · ${t.ref}` : ''}`));
  feuille.append(pied);
  return feuille;
}

// Le document en TEXTE — ce que le téléchargement remet, et ce qu'un poste sans
// imprimante recopie. Même contenu que le papier, à la ligne près.
export function bureauTexte(t) {
  const sep = '='.repeat(56);
  const out = [];
  // MÊME CONTENU QUE LE PAPIER. Le texte est ce qu'on colle dans un e-mail :
  // sans émetteur, le destinataire ne sait pas de qui il vient.
  for (const l of [t.maison.nom, ...t.maison.lignes, t.maison.contact.join(' · '),
    t.maison.legal.join(' · ')]) if (l) out.push(l);
  if (out.length) out.push('');
  out.push(`${t.titre.toUpperCase()}${t.ref ? ` — ${t.ref}` : ''}`, sep);
  if (t.lot) out.push(`Article ${t.lot.rang} sur ${t.lot.total} de la commande`);
  out.push(`Client : ${t.client.nom}${t.client.type ? ` (${t.client.type})` : ''}`);
  for (const [k, v] of [['Contact', t.client.contact], ['Téléphone', t.client.tel],
    ['E-mail', t.client.email]]) if (v) out.push(`${k} : ${v}`);
  for (const x of t.client.autres) out.push(`${x.k} : ${x.v}`);
  if (t.priseLe) out.push(`Pris le : ${t.priseLe}`);
  if (t.retrait) out.push(`Récupération : ${t.retrait}${t.heure ? ` à ${t.heure}` : ''}`);
  if (t.articles.length) {
    out.push(sep, 'DÉTAIL');
    for (const a of t.articles) {
      out.push(`${a.quantite ? `${a.quantite} x ` : ''}${a.designation}`);
      const sous = [a.reference, a.couleur, a.categorie].filter(Boolean).join(' · ');
      if (sous) out.push(`  ${sous}`);
      if (a.detail) out.push(`  ${a.detail}`);
      if (!t.demande && (a.unitaire || a.total)) {
        out.push(`  ${[a.unitaire && `P.U. TTC ${a.unitaire}`, a.total && `Total ${a.total}`].filter(Boolean).join(' · ')}`);
      }
    }
  }
  const arg = t.argent;
  out.push(sep);
  if (arg.ttc == null) out.push('Total : à chiffrer');
  else {
    out.push(`Total HT : ${euro(arg.ht)}`, `TGCA ${arrondiTaux(arg.taux)} % : ${euro(arg.taxe)}`, `TOTAL TTC : ${euro(arg.ttc)}`);
    out.push(`Règlement : ${arg.paye ? (arg.mode || 'payé') : 'à encaisser'}`);
  }
  if (t.dossier.length) {
    out.push(sep, 'CE QUI A ÉTÉ RECUEILLI');
    for (const x of t.dossier) out.push(`${x.k} : ${x.v}`);
  }
  out.push(sep, 'INTERNE — ne pas remettre au client');
  out.push(`Coût de revient : ${arg.revient == null ? '—' : euro(arg.revient)}`);
  out.push(`Marge : ${arg.marge == null ? '—' : euro(arg.marge)}`);
  for (const n of t.notes || []) out.push(n);
  if (t.note) out.push(t.note);
  return out.join('\n');
}
