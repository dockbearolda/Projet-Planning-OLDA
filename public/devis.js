// ===========================================================================
// LE DEVIS — le troisième papier de la maison
// ===========================================================================
// IL SE FABRIQUE DEVANT LE CLIENT. C'est sa différence avec les deux autres :
// le ticket et le bon de commande se TIRENT d'une ligne déjà enregistrée ;
// celui-ci se COMPOSE pendant qu'on parle, et il se redessine à chaque frappe
// sur la moitié droite de l'écran. Le client voit le prix se faire.
//
// TROIS PAPIERS, UNE SEULE GRAMMAIRE. L'encre, le gris ardoise, le filet, la
// marge de feuille, la classe des intitulés et l'identité de la maison vivent
// dans `papier.js` : écrites ici une deuxième fois, elles seraient devenues
// deux grammaires le jour où l'une bouge — et cet écart-là ne se voit qu'en
// comparant deux documents IMPRIMÉS, jamais en relisant un fichier.
//
// LE MODÈLE EST PUR : mêmes entrées, mêmes sorties, aucun DOM en dehors de
// `dessinerDevis`. C'est ce qui le rend vérifiable hors navigateur, et c'est ce
// qui permet de tenir l'arithmétique de l'argent par un test.
//
// ATTENTION, DEUX PIÈGES DÉJÀ PAYÉS SUR LES DEUX AUTRES PAPIERS :
//   1. AUCUN ACCENT GRAVE — le caractère, pas la lettre. La feuille est un
//      littéral gabarit, et ce signe-là dans un commentaire le TERMINE : le
//      module reste valide, `node --check` passe, et l'écran s'ouvre NU. Les
//      lettres accentuées, elles, sont attendues — ce papier part chez le
//      client.
//   2. AUCUN JETON DE `charte.css` dans la feuille : le cadre d'impression ne
//      reçoit QUE cette chaîne. Un `var(--pas-3)` y vaut la chaîne vide, donc
//      un rembourrage à zéro SUR LE PAPIER et nulle part ailleurs — l'aperçu,
//      lui, a la charte et paraît impeccable. Tous les jetons d'ici commencent
//      par `--dv-`.

import { JETONS_PAPIER, SOCLE_PAPIER, maisonPapier } from './papier.js';
// LE NOM DU CLIENT S'IMPRIME EN CAPITALES, comme il se lit à l'écran et comme
// il sort sur les deux autres papiers : c'est le mot qu'on cherche en balayant
// une pile. La règle vit dans `nom-client.js`, une seule fois.
import { nomClientAffiche } from './nom-client.js';

const texte = (v) => String(v == null ? '' : v).trim();

const EURO = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const euro = (n) => (Number.isFinite(Number(n)) ? EURO.format(Number(n)) : '');

// L'ARGENT SE COMPTE EN CENTIMES. Une somme de flottants dérive au troisième
// article, et c'est sur le document qui engage la maison que ça se voit.
const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
// CE QUE PORTE LA COLONNE D'UN ARTICLE QU'ON N'A PAS ENCORE CHIFFRÉ. Un seul
// mot, écrit une fois : l'écran le reconnaît pour compter ses lignes en
// attente, le papier l'imprime tel quel.
export const SANS_PRIX = 'À chiffrer';

// LA DATE CIVILE DE L'ATELIER — Saint-Martin, UTC−4, sans heure d'été. Le
// conteneur de production tourne en UTC : dès 20 h locales, un `toISOString()`
// naïf date le devis du lendemain, et sa validité avec.
const JOUR_ATELIER = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'America/Marigot', day: '2-digit', month: '2-digit', year: 'numeric',
});
function dateSeule(iso) {
  const m = texte(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
// La journée de l'atelier, en aaaa-mm-jj. `sv-SE` rend exactement ce format,
// et c'est le seul intérêt de cette locale ici.
export function jourAtelier(instant) {
  const d = instant instanceof Date ? instant : new Date();
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Marigot' }).format(d);
}
// Une date civile décalée de N jours, SANS repasser par un fuseau : on
// additionne sur le calendrier, pas sur l'horloge. Midi UTC met la date à
// l'abri des deux bascules.
export function jourPlus(jour, n) {
  const m = texte(jour).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  d.setUTCDate(d.getUTCDate() + Number(n || 0));
  return d.toISOString().slice(0, 10);
}

// ===========================================================================
// CE QUE L'APPROVISIONNEMENT PROMET — et ce qu'il ne promet pas
// ===========================================================================
// LE TEXTE EST CELUI DU PATRON, mot pour mot. Ce n'est pas de la mise en forme,
// c'est un engagement commercial : ce qu'on écrit là se retrouve opposé à la
// maison si la commande prend du retard. La formulation dit toujours la même
// chose — la date se confirme APRÈS l'acompte et le BAT, jamais avant.
export const APPROS = [
  {
    id: 'stock', label: 'En stock', etat: 'ok',
    court: 'Délai généralement maîtrisable',
    texte: 'Articles annoncés en stock. Une date de retrait vous sera confirmée après réception '
      + 'de l\u2019acompte et validation du BAT.',
  },
  {
    id: 'air', label: 'Commande aérienne', etat: 'attention',
    court: 'Dépend de l\u2019approvisionnement aérien',
    texte: 'Délai estimatif selon disponibilité fournisseur et acheminement aérien. Une date de '
      + 'retrait vous sera confirmée après validation de la commande.',
  },
  {
    id: 'groupe', label: 'Commande groupée', etat: 'attention',
    court: 'Dépend de la prochaine commande groupée',
    texte: 'Selon disponibilité des articles et prochain approvisionnement groupé. Une date de '
      + 'retrait vous sera confirmée après validation de la commande.',
  },
  {
    id: 'mer', label: 'Maritime', etat: 'danger',
    court: 'Délai long, dépendant du transport',
    texte: 'Délai estimatif dépendant de l\u2019acheminement maritime. Une date de retrait vous sera '
      + 'confirmée après sécurisation de l\u2019approvisionnement.',
  },
  {
    id: 'confirmer', label: 'Délai à confirmer', etat: 'attention',
    court: 'Délai à confirmer',
    texte: 'Délai à confirmer selon disponibilité des articles, validation du BAT et '
      + 'approvisionnement.',
  },
];
const APPRO_PAR_ID = new Map(APPROS.map((a) => [a.id, a]));
export const APPRO_DEFAUT = 'groupe';

// LE BON À TIRER — la phrase qui protège la production. Elle dit que rien ne
// part sur les machines avant un accord écrit sur les visuels : c'est ce qui
// évite de refaire trente textiles pour une couleur que personne n'avait
// validée.
const TEXTE_BAT = 'Après acceptation du devis, un BAT vous sera transmis pour validation '
  + 'des visuels, couleurs, dimensions et positionnements. La production débutera après votre '
  + 'validation.';

// ===========================================================================
// LES TROIS REGLAGES D'ARGENT DU DEVIS
// ===========================================================================
// LE TAUX DE TGCA N'EST PAS UNE CONSTANTE : il vit dans les Réglages (grille
// tasse, `tgca`) comme partout ailleurs dans l'application. Ce qui se choisit
// ICI, c'est s'il s'applique — une revente et une exportation en sont exemptes,
// et la mention doit figurer sur le devis.
export const REGIMES = [
  { id: 'tgca', label: 'TGCA', taxable: true },
  { id: 'revente', label: 'TGCA non applicable — Revente', taxable: false },
  { id: 'export', label: 'TGCA non applicable — Exportation', taxable: false },
];
const REGIME_PAR_ID = new Map(REGIMES.map((r) => [r.id, r]));

export const ACOMPTES = [0, 30, 50, 100];

// L'ARRONDI COMMERCIAL PORTE SUR LE TTC, pas sur le HT : c'est le nombre que le
// client paie, c'est donc lui qu'on rend rond. Le HT s'en déduit — dans l'autre
// sens, un HT rond redonne un TTC à trois décimales, et on aurait arrondi
// exactement ce qui ne se voit pas.
export const ARRONDIS = [
  { id: 'aucun', label: 'Aucun' },
  { id: 'euro', label: 'À l\u2019euro inférieur' },
  { id: 'dix', label: 'Au 0,10 \u20AC inférieur' },
];

// LE CALCUL, UNE SEULE FOIS POUR LES DEUX MOITIÉS DE L'ÉCRAN. Le formulaire
// affiche ces nombres, le papier les imprime : deux calculs qui se ressemblent
// finissent par se contredire, et c'est le client qui trouve l'écart.
//
// L'ADDITION TOMBE JUSTE PAR CONSTRUCTION. On arrondit le TTC, puis le HT au
// centime, et la taxe est CE QUI RESTE — pas un troisième arrondi indépendant.
// Sans ça, un devis peut imprimer 100,00 + 4,00 = 104,01, et c'est ce genre de
// ligne qui fait rappeler un comptable.
export function calculerDevis(saisie) {
  const s = saisie && typeof saisie === 'object' ? saisie : {};
  const lignes = (Array.isArray(s.lignes) ? s.lignes : []).map((l) => {
    const quantite = Math.max(0, Number(l && l.quantite) || 0);
    const unitaireHt = Math.max(0, cents(l && l.unitaireHt));
    // UNE LIGNE SANS PRIX N'EST PAS UNE LIGNE À ZÉRO (02/09/2026).
    //
    // ⚠ DÉFAUT PAYÉ UNE FOIS : une tasse choisie au catalogue sortait sur le
    // papier du client à « 0,00 € », et le total du devis l'ignorait sans que
    // rien ne le dise. Un devis peut légitimement porter un article OFFERT —
    // c'est un zéro VOULU, tapé par la vendeuse. Les deux s'écrivaient pareil.
    //
    // On les sépare à la source : `unitaireHt` vaut `null` tant que personne
    // n'a posé de prix (ni le catalogue, ni la grille, ni le moteur, ni la
    // main), et `0` quand quelqu'un a décidé zéro. Le calcul, lui, ne change
    // pas — `null` compte pour zéro dans l'addition — mais le papier et
    // l'écran peuvent enfin le DIRE.
    const sansPrix = l == null || l.unitaireHt == null || l.unitaireHt === '';
    return { ...l, quantite, unitaireHt, sansPrix, totalHt: cents(quantite * unitaireHt) };
  });
  const sousTotalHt = cents(lignes.reduce((t, l) => t + l.totalHt, 0));

  const regime = REGIME_PAR_ID.get(s.regime) || REGIMES[0];
  const taux = regime.taxable ? Math.max(0, Number(s.tauxTgca) || 0) : 0;

  const vise = cents(sousTotalHt * (1 + taux));
  let ttc = vise;
  if (s.arrondi === 'euro') ttc = Math.floor(vise + 1e-9);
  else if (s.arrondi === 'dix') ttc = Math.floor(vise * 10 + 1e-9) / 10;
  ttc = cents(ttc);

  const totalHt = taux ? cents(ttc / (1 + taux)) : ttc;
  const taxe = cents(ttc - totalHt);
  const ecart = cents(totalHt - sousTotalHt);

  const pourcent = ACOMPTES.includes(Number(s.acompte)) ? Number(s.acompte) : 0;
  const acompte = cents(ttc * (pourcent / 100));

  return {
    lignes,
    sousTotalHt,
    ecart,
    totalHt,
    taxe,
    tauxTgca: taux,
    regime,
    ttc,
    acompte: { pourcent, montant: acompte, solde: cents(ttc - acompte) },
  };
}

// ===========================================================================
// LE MODELE DU PAPIER
// ===========================================================================
// `saisie` est ce que l'écran a recueilli, `entreprise` le réglage qui dit de
// qui vient le document. Rien n'est inventé : un champ vide ne s'imprime pas.
export function modeleDevis(saisie, entreprise) {
  const s = saisie && typeof saisie === 'object' ? saisie : {};
  const c = s.client && typeof s.client === 'object' ? s.client : {};
  const compte = calculerDevis(s);
  const appro = APPRO_PAR_ID.get(s.appro) || APPRO_PAR_ID.get(APPRO_DEFAUT);

  // LA RÉFÉRENCE DU VIREMENT. C'est elle que le client recopie dans son ordre,
  // et c'est par elle qu'on retrouve un versement sur le relevé : le code du
  // client, le numéro du devis, la part versée. Sans numéro de devis, pas de
  // référence — on n'en fabrique pas une qui ne renverrait à rien.
  const numero = texte(s.numero);
  const codeClient = texte(c.code).toUpperCase();
  const reference = numero
    ? [codeClient, numero, `REG${compte.acompte.pourcent}`].filter(Boolean).join('-')
    : '';

  return {
    maison: maisonPapier(entreprise),
    titre: 'DEVIS',
    numero,
    date: dateSeule(s.date) || dateSeule(jourAtelier()),
    validite: dateSeule(s.validite),
    projet: texte(s.projet),
    client: {
      nom: nomClientAffiche(texte(c.nom), c.type),
      ville: texte(c.ville),
      contact: texte(c.contact),
      tel: texte(c.tel),
      email: texte(c.email),
    },
    // CE QUI EST VENDU. Chaque ligne porte ce que le client doit relire pour
    // reconnaître sa commande : la référence, la couleur, les tailles, ce qu'on
    // imprime dessus. Une case vide ne sort pas.
    lignes: compte.lignes.map((l) => ({
      designation: texte(l.designation),
      reference: texte(l.reference),
      couleur: texte(l.couleur),
      tailles: texte(l.tailles),
      marquage: texte(l.marquage),
      // CE QU'ON IMPRIME, AVEC QUOI ET OÙ (02/09). Le client relit sa commande
      // sur ce papier : « Coeur + dos » ne dit pas la couleur de l'encre, et une
      // tasse n'a pas de tailles mais des faces. Une case vide ne sort pas —
      // c'est la règle de toutes les autres.
      encre: texte(l.encre),
      faces: texte(l.faces),
      note: texte(l.note),
      quantite: l.quantite,
      // CE QU'ON N'A PAS CHIFFRÉ SE DIT, il ne s'imprime pas « 0,00 € ». Un
      // prix manquant vu par le client est une question ; un zéro est une
      // promesse — et c'est la maison qui la tient.
      unitaireHt: l.sansPrix ? SANS_PRIX : euro(l.unitaireHt),
      totalHt: l.sansPrix ? SANS_PRIX : euro(l.totalHt),
    })).filter((l) => l.designation || l.totalHt),
    bat: TEXTE_BAT,
    delai: appro.texte,
    totaux: {
      sousTotalHt: euro(compte.sousTotalHt),
      // L'ARRONDI NE S'IMPRIME QUE S'IL EXISTE. À zéro, c'est une ligne qui
      // n'apprend rien et qui pousse le total d'un rang vers le bas.
      ecart: compte.ecart ? euro(compte.ecart) : '',
      totalHt: euro(compte.totalHt),
      taxeLabel: compte.regime.taxable
        ? `${compte.regime.label} ${(compte.tauxTgca * 100).toFixed(compte.tauxTgca * 100 % 1 ? 1 : 0)} %`
        : compte.regime.label,
      taxe: euro(compte.taxe),
      ttc: euro(compte.ttc),
    },
    // LE CADRE DE RÈGLEMENT NE SORT QUE COMPLET. Un devis qui réclame un
    // acompte sans dire où le virer fait rappeler le client — c'est pire qu'un
    // cadre absent. Et sans acompte demandé, il n'y a rien à réclamer.
    reglement: compte.acompte.pourcent > 0 ? {
      pourcent: compte.acompte.pourcent,
      montant: euro(compte.acompte.montant),
      solde: euro(compte.acompte.solde),
      reference,
    } : null,
    compte,
  };
}

// ===========================================================================
// LA FEUILLE — A4 portrait, autonome
// ===========================================================================
// TROIS CRANS DE TEXTE, plus celui des intitulés qui vient du socle. Le devis
// se lit à trente centimètres, comme le bon de commande, et pour la même
// raison : il porte tout le dossier. Le patron en avait dix ; ça se voit, et
// sur un document qu'on imprime devant le client ça coûte une réimpression.
//   --dv-geant  le TOTAL À PAYER, puis l'acompte. Ce sont les deux nombres
//               qu'on vient chercher sur un devis, et il n'y en a pas d'autres.
//   --dv-cle    ce qui identifie : le titre, le numéro, le nom du client, la
//               maison, l'intitulé d'une section.
//   --dv-texte  tout le corps.
export const CSS_DEVIS = SOCLE_PAPIER + `
  .dv {${JETONS_PAPIER}
       --dv-geant: 30px; --dv-cle: 17px; --dv-texte: 13px;
       --dv-rang: 26px; --dv-gouttiere: 26px; --dv-section: 22px;
       width: 210mm; min-height: 297mm; box-sizing: border-box; margin: 0 auto;
       display: flex; flex-direction: column;
       background: #ffffff; color: var(--pap-encre);
       font: var(--dv-texte)/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
       font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
  .dv * { box-sizing: border-box; }

  /* L'EN-TETE DIT DE QUI VIENT LE PAPIER. Un devis sans émetteur n'est pas un
     document, c'est une note : on ne le classe pas, on ne le joint pas, on ne
     s'en sert pas pour relancer. L'identité vient des Réglages, pas du code.
     Une ligne d'adresse est saisie à la main et accepte 160 signes : sans point
     de coupure, une valeur d'un seul tenant pousse le numéro HORS de la feuille. */
  .dv__tete { display: flex; align-items: flex-start; justify-content: space-between;
              gap: 28px; padding: 26px var(--pap-marge) 16px; border-bottom: 3px solid var(--pap-encre); }
  .dv__maison { display: flex; flex-direction: column; gap: 1px; min-width: 0;
                overflow-wrap: anywhere; }
  .dv__maison-nom { font-size: var(--dv-cle); font-weight: 800; letter-spacing: -.02em;
                    line-height: 1.2; margin-bottom: 3px; }
  .dv__maison-l { color: var(--pap-ardoise); line-height: 1.35; }
  .dv__ref { display: flex; flex-direction: column; align-items: flex-end; gap: 3px;
             text-align: right; flex: 0 0 auto; }
  /* LE TITRE NE CRIE PAS. Le plus gros caractère de la feuille doit être le
     MONTANT : c'est le fait qu'on vient chercher sur un devis. */
  .dv__titre { font-size: var(--dv-cle); font-weight: 800; letter-spacing: .04em;
               line-height: 1.15; white-space: nowrap; }
  .dv__num { font: 700 var(--dv-cle)/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

  .dv__corps { flex: 1; min-height: 0; display: flex; flex-direction: column;
               gap: var(--dv-section); padding: 16px var(--pap-marge) 0; }

  /* TOUT EST SUR LA MEME GRILLE, ET TOUTES LES LIGNES SONT DROITES. Deux
     cadres posés côte à côte sont deux boîtes indépendantes : leurs premières
     rangées ne tombent jamais à la même hauteur, et les suivantes ne se
     rattrapent pas. Une SEULE grille les porte, et les paires y sont posées en
     alternance — la rangée est alors imposée par la grille, pas obtenue par
     coïncidence de contenu. */
  .dv__grille { display: grid; grid-template-columns: 1fr 1fr; column-gap: var(--dv-gouttiere); }
  .dv__section-k { padding-bottom: 6px; border-bottom: 2px solid var(--pap-encre);
                   color: var(--pap-encre); font-weight: 700; }
  /* UNE LIGNE, UNE HAUTEUR : intitulé à gauche, valeur à droite, un filet en
     dessous, et la ligne suivante tombe au pas suivant. La hauteur est un
     JETON — écrite en clair, elle se recopie de travers dès la troisième
     reprise, et le rythme se casse sans que personne sache pourquoi. */
  .dv__paire { display: flex; align-items: baseline; justify-content: space-between;
               gap: 12px; min-height: var(--dv-rang); padding: 4px 0;
               border-bottom: 1px dotted var(--pap-filet); }
  .dv__k { color: var(--pap-ardoise); }
  .dv__v { font-weight: 700; text-align: right; }
  /* UNE CELLULE VIDE GARDE SON FILET : une colonne plus courte que l'autre ne
     doit pas casser la réglure. Un tableau à trous se lit comme un tableau ;
     un tableau dont les traits s'arrêtent au milieu se lit comme une erreur. */
  .dv__nom { display: flex; align-items: baseline; min-height: var(--dv-rang);
             padding: 4px 0; border-bottom: 1px dotted var(--pap-filet);
             font-size: var(--dv-cle); font-weight: 800; letter-spacing: -.02em; }

  /* LE DETAIL. Les colonnes sont FIXÉES : sans largeur déclarée, la colonne des
     prix se cale sur son contenu et bouge d'un devis à l'autre — deux documents
     de la même maison qui ne se superposent pas. */
  .dv__table { width: 100%; border-collapse: collapse; }
  .dv__table th { text-align: left; padding: 0 0 6px; border-bottom: 2px solid var(--pap-encre);
                  color: var(--pap-encre); font-weight: 700; }
  .dv__table td { padding: 7px 0; border-bottom: 1px dotted var(--pap-filet); vertical-align: top; }
  .dv__table th + th, .dv__table td + td { padding-left: 12px; }
  .dv__c-qte { width: 52px; text-align: right; }
  .dv__c-pu { width: 92px; text-align: right; }
  .dv__c-tot { width: 100px; text-align: right; }
  .dv__table th.dv__c-qte, .dv__table th.dv__c-pu, .dv__table th.dv__c-tot { text-align: right; }
  .dv__art { font-weight: 700; }
  .dv__art-d { color: var(--pap-ardoise); line-height: 1.35; }
  .dv__art-n { color: var(--pap-ardoise); font-style: italic; line-height: 1.35; }
  /* AUCUNE LIGNE NE SE COUPE ENTRE DEUX PAGES : un article dont la désignation
     reste en bas d'une feuille et le prix en haut de la suivante se relit de
     travers, et c'est sur le prix qu'on se trompe. */
  .dv__table tr { break-inside: avoid; }

  .dv__bas { display: grid; grid-template-columns: 1fr 240px; gap: var(--dv-gouttiere);
             align-items: start; }
  .dv__cadre { border: 1px solid var(--pap-filet); }
  .dv__cadre-t { padding: 6px 10px; border-bottom: 1px solid var(--pap-filet);
                 background: #f4f5f5; }
  .dv__cadre-c { padding: 9px 10px; line-height: 1.45; }
  .dv__cadre + .dv__cadre { margin-top: 12px; }

  /* LE TOTAL EST LE SEUL GEANT DE LA FEUILLE, et il est dans la colonne des
     montants qu'il additionne : l'oeil descend la colonne et tombe dessus. */
  .dv__tot-l { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0;
               border-bottom: 1px dotted var(--pap-filet); }
  .dv__tot-k { color: var(--pap-ardoise); }
  .dv__tot-v { font-weight: 700; }
  .dv__grand { display: flex; flex-direction: column; gap: 2px; margin-top: 8px;
               padding-top: 8px; border-top: 2px solid var(--pap-encre); }
  .dv__grand-v { font-size: var(--dv-geant); font-weight: 800; letter-spacing: -.02em;
                 line-height: 1.05; }

  /* LE REGLEMENT : où virer, et combien maintenant. Les deux vont ensemble —
     l'un sans l'autre fait rappeler le client. */
  .dv__pay { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--pap-filet); }
  .dv__pay > div { padding: 12px; line-height: 1.5; }
  .dv__pay > div + div { border-left: 1px solid var(--pap-filet); }
  .dv__pay-v { font-size: var(--dv-geant); font-weight: 800; letter-spacing: -.02em;
               line-height: 1.05; margin: 6px 0 4px; }
  .dv__iban { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
              overflow-wrap: anywhere; }

  .dv__pied { margin-top: auto; padding: 14px var(--pap-marge) 22px; text-align: center;
              color: var(--pap-ardoise); line-height: 1.5; }
  .dv__pied-l { border-top: 1px solid var(--pap-filet); padding-top: 8px; }

  @media print {
    .dv { box-shadow: none; }
  }
`;

// ===========================================================================
// LE RENDU
// ===========================================================================
// AUCUN STYLE EN LIGNE : les largeurs se déclarent dans la feuille. Un
// `.style.width` posé ici perd la portabilité hors navigateur — le DOM minimal
// des tests n'a pas de propriété `style` — et c'est cette portabilité qui
// permet de vérifier une feuille sans ouvrir Chrome.
export function dessinerDevis(t, doc) {
  const d = doc || document;
  const el = (tag, cls, txt) => {
    const n = d.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null && txt !== '') n.textContent = txt;
    return n;
  };
  // UN CHAMP VIDE NE S'IMPRIME PAS. « Validité : — » vaut moins que rien du
  // tout sur un document qui engage la maison.
  const paire = (k, v) => {
    const l = el('div', 'dv__paire');
    l.append(el('span', 'dv__k pap-cap', k), el('span', 'dv__v', v));
    return l;
  };
  const paires = (hote, liste) => {
    for (const [k, v] of liste) if (v) hote.append(paire(k, v));
  };

  const f = el('div', 'dv');

  // --- En-tete ---
  const tete = el('div', 'dv__tete');
  const maison = el('div', 'dv__maison');
  if (t.maison.nom) maison.append(el('div', 'dv__maison-nom', t.maison.nom));
  for (const l of t.maison.lignes) maison.append(el('div', 'dv__maison-l', l));
  for (const l of t.maison.contact) maison.append(el('div', 'dv__maison-l', l));
  const ref = el('div', 'dv__ref');
  ref.append(el('div', 'dv__titre', t.titre));
  if (t.numero) ref.append(el('div', 'dv__num', t.numero));
  ref.append(el('div', 'pap-cap', `DU ${t.date}`));
  tete.append(maison, ref);
  f.append(tete);

  const corps = el('div', 'dv__corps');

  // --- Client et dossier, sur UNE grille ---
  const grille = el('div', 'dv__grille');
  grille.append(el('div', 'dv__section-k pap-cap', 'CLIENT'),
    el('div', 'dv__section-k pap-cap', 'DOSSIER'));
  const gauche = [
    ['VILLE', t.client.ville], ['CONTACT', t.client.contact],
    ['TÉLÉPHONE', t.client.tel], ['E-MAIL', t.client.email],
  ].filter(([, v]) => v);
  const droite = [
    ['PROJET', t.projet], ['DATE', t.date], ['VALIDITÉ', t.validite],
  ].filter(([, v]) => v);
  // LE NOM DU CLIENT EST LA PREMIÈRE VALEUR DE SA COLONNE, à la place d'une
  // paire : c'est POUR QUI, et ça se lit avant tout le reste. La grille lui
  // donne la même hauteur qu'à sa voisine de droite.
  const rangs = Math.max(1 + gauche.length, droite.length);
  for (let i = 0; i < rangs; i += 1) {
    if (i === 0) grille.append(el('div', 'dv__nom', t.client.nom));
    else if (gauche[i - 1]) grille.append(paire(gauche[i - 1][0], gauche[i - 1][1]));
    else grille.append(el('div', 'dv__paire'));
    if (droite[i]) grille.append(paire(droite[i][0], droite[i][1]));
    else grille.append(el('div', 'dv__paire'));
  }
  corps.append(grille);

  // --- Le detail ---
  const table = el('table', 'dv__table');
  const thead = el('thead');
  const trh = el('tr');
  trh.append(el('th', 'pap-cap', 'DÉSIGNATION'), el('th', 'dv__c-qte pap-cap', 'QTÉ'),
    el('th', 'dv__c-pu pap-cap', 'PU HT'), el('th', 'dv__c-tot pap-cap', 'TOTAL HT'));
  thead.append(trh);
  const tbody = el('tbody');
  for (const l of t.lignes) {
    const tr = el('tr');
    const cell = el('td');
    cell.append(el('div', 'dv__art', l.designation));
    for (const [k, v] of [['Réf', l.reference], ['Couleur', l.couleur],
      ['Tailles', l.tailles], ['Marquage', l.marquage],
      ['Encre', l.encre], ['Faces', l.faces]]) {
      if (v) cell.append(el('div', 'dv__art-d', `${k} : ${v}`));
    }
    if (l.note) cell.append(el('div', 'dv__art-n', l.note));
    tr.append(cell, el('td', 'dv__c-qte', String(l.quantite)),
      el('td', 'dv__c-pu', l.unitaireHt), el('td', 'dv__c-tot', l.totalHt));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  corps.append(table);

  // --- Delai, BAT, totaux ---
  const bas = el('div', 'dv__bas');
  const cadres = el('div');
  const cadre = (titre, corpsTxt) => {
    const c = el('div', 'dv__cadre');
    c.append(el('div', 'dv__cadre-t pap-cap', titre), el('div', 'dv__cadre-c', corpsTxt));
    return c;
  };
  cadres.append(cadre('DÉLAI ESTIMATIF', t.delai), cadre('BON À TIRER (BAT)', t.bat));
  const totaux = el('div');
  const ligneTotal = (k, v) => {
    const l = el('div', 'dv__tot-l');
    l.append(el('span', 'dv__tot-k', k), el('span', 'dv__tot-v', v));
    return l;
  };
  totaux.append(ligneTotal('Sous-total HT', t.totaux.sousTotalHt));
  if (t.totaux.ecart) totaux.append(ligneTotal('Arrondi commercial', t.totaux.ecart));
  totaux.append(ligneTotal('Total HT', t.totaux.totalHt));
  totaux.append(ligneTotal(t.totaux.taxeLabel, t.totaux.taxe));
  const grand = el('div', 'dv__grand');
  grand.append(el('div', 'pap-cap', 'TOTAL À PAYER'), el('div', 'dv__grand-v', t.totaux.ttc));
  totaux.append(grand);
  bas.append(cadres, totaux);
  corps.append(bas);

  // --- Reglement ---
  if (t.reglement && t.maison.banque.iban) {
    const pay = el('div', 'dv__pay');
    const banque = el('div');
    banque.append(el('div', 'pap-cap', 'RÈGLEMENT PAR VIREMENT'));
    if (t.maison.banque.nom) banque.append(el('div', 'dv__art', t.maison.banque.nom));
    banque.append(el('div', 'dv__iban', `IBAN : ${t.maison.banque.iban}`));
    if (t.maison.banque.bic) banque.append(el('div', 'dv__iban', `BIC : ${t.maison.banque.bic}`));
    const acompte = el('div');
    acompte.append(el('div', 'pap-cap', 'ACOMPTE À VERSER MAINTENANT'));
    acompte.append(el('div', 'dv__pay-v', t.reglement.montant));
    acompte.append(el('div', 'dv__art-d', `Soit ${t.reglement.pourcent} % du montant total`));
    if (t.reglement.reference) {
      acompte.append(el('div', 'dv__iban', `Référence : ${t.reglement.reference}`));
    }
    acompte.append(el('div', 'dv__art-d', `Solde à régler avant retrait : ${t.reglement.solde}`));
    pay.append(banque, acompte);
    corps.append(pay);
  }

  f.append(corps);

  // --- Pied ---
  // LES MENTIONS LÉGALES SONT AU PIED, là où on les cherche sur un document
  // commercial — pas dans l'en-tête, où elles disputent la place à ce qui sert
  // tous les jours. Aucune n'est inventée : ce qui n'est pas réglé ne sort pas.
  if (t.maison.legal.length) {
    const pied = el('div', 'dv__pied');
    pied.append(el('div', 'dv__pied-l', t.maison.legal.join(' - ')));
    f.append(pied);
  }
  return f;
}
