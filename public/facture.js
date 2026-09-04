// ===========================================================================
// LA FACTURE — le quatrième papier de la maison, et le seul qui ne se
// réimprime jamais autrement qu'à l'identique
// ===========================================================================
// ELLE NAÎT D'UNE VENTE SOLDÉE, PAS D'UNE PROMESSE. Contrairement au devis
// (`devis.js`), elle ne porte ni acompte ni solde : le mode de règlement est
// obligatoire et le montant réglé est TOUJOURS le TTC — décidé le 03/09/2026.
// Une commande avec acompte reste un DEVIS tant qu'elle n'est pas soldée.
//
// LE MOTEUR D'ARGENT EST CELUI DU DEVIS. `calculerDevis` (HT, TTC, taxe,
// régime, arrondi commercial, ajustement global) vit une seule fois dans
// `devis.js` — en écrire un second ici serait le genre d'écart qui finit par
// se contredire sur le document qui sert à facturer.
//
// ELLE EST IMMUABLE. Le modèle qui sort d'ici est celui qu'on archive tel
// quel (voir `POST /api/factures`, server.js) : une fois émise, une facture
// ne se recalcule plus jamais — ni si le taux de TGCA change, ni si
// l'identité de l'atelier change.
//
// ⚠ DEUX PIÈGES DÉJÀ PAYÉS SUR LES TROIS AUTRES PAPIERS (voir `papier.js`,
// `devis.js`) :
//   1. AUCUN ACCENT GRAVE dans un gabarit — le caractère referme le littéral,
//      `node --check` passe quand même, l'écran s'ouvre NU.
//   2. AUCUN JETON DE `charte.css` dans `CSS_FACTURE` — le cadre d'impression
//      ne charge QUE cette chaîne, un `var(--pas-3)` y vaut la chaîne vide.
//
// ⚠️ LES MENTIONS LÉGALES CI-DESSOUS NE SONT PAS UNE VALIDATION JURIDIQUE.
// Saint-Martin a son propre régime fiscal (TGCA, distinct de la TVA
// métropolitaine). Le texte reste générique sur le régime — il reprend le
// libellé déjà choisi par la vendeuse (TGCA / Revente / Export) sans inventer
// de citation d'article. À faire relire avant de s'appuyer dessus en cas de
// contrôle.

import { JETONS_PAPIER, SOCLE_PAPIER, maisonPapier } from './papier.js';
import { texte, euro, dateSeule, jourAtelier, calculerDevis } from './devis.js';
import { nomClientAffiche } from './nom-client.js';

// LES MODES DE RÈGLEMENT — miroir de catalog.json → commande.paiementModes,
// que le serveur valide (PAIEMENT_MODE_SET, server.js). Une facture Vente
// Flash EXIGE un mode : voir §4 du spec, réglé le 03/09.
export const MODES_PAIEMENT = [
  { id: 'cb', label: 'Carte bancaire' },
  { id: 'especes', label: 'Espèces' },
  { id: 'virement', label: 'Virement' },
  { id: 'cheque', label: 'Chèque' },
  { id: 'mixte', label: 'Mixte' },
];
const MODE_PAR_ID = new Map(MODES_PAIEMENT.map((m) => [m.id, m]));

// LES MENTIONS LÉGALES — texte fixe, comme le BAT et le délai sur le devis :
// ce n'est pas de la mise en forme, c'est ce qui rend le document opposable.
// Voir l'avertissement en tête de fichier.
// LE TAUX EST CELUI DES CGV DE LA MAISON, pas un taux inventé ici : trois fois
// le taux d'intérêt légal, tel que publié sur myolda.com (fiche d'identité de
// l'entreprise, 03/09/2026). Le document qui réclame et celui qui engage
// doivent dire le MÊME chiffre — un écart entre les deux se retourne contre
// celui qui réclame.
const MENTIONS_REGLEMENT = 'Facture réglée en totalité à la remise. Aucun escompte pour paiement '
  + 'anticipé. En cas de retard de paiement sur une facture à échéance : pénalité égale à trois fois '
  + 'le taux d’intérêt légal en vigueur, exigible sans qu’un rappel soit nécessaire, et indemnité '
  + 'forfaitaire de recouvrement de 40 € (articles L441-10 et D441-5 du code de commerce).';

// UN AVOIR NE RÉCLAME RIEN — IL REND. Lui laisser les mentions de la facture
// (« réglée en totalité à la remise », pénalités de retard, indemnité de 40 €)
// faisait dire au document exactement le contraire de ce qu'il fait. Trouvé en
// rendant le premier avoir, le 03/09.
const MENTIONS_AVOIR = 'Avoir émis en rectification de la facture citée ci-dessus, qu’il annule '
  + 'à hauteur du montant indiqué. Il vient en déduction des sommes dues ou donne lieu à '
  + 'remboursement. La facture d’origine reste acquise et n’est ni modifiée ni annulée par '
  + 'ailleurs.';

// ===========================================================================
// LE MODÈLE
// ===========================================================================
// `saisie` porte les mêmes champs de calcul que le devis (lignes, régime,
// arrondi, ajustement, vedette) plus `mode` (le règlement, obligatoire).
// `entreprise` est le réglage qui dit de qui vient le document — figé dans
// `document` au moment de l'émission (voir server.js), jamais relu ensuite.
export function modeleFacture(saisie, entreprise) {
  const s = saisie && typeof saisie === 'object' ? saisie : {};
  const c = s.client && typeof s.client === 'object' ? s.client : {};
  const compte = calculerDevis(s);
  const mode = MODE_PAR_ID.get(s.mode) || null;

  // L'AVOIR EST LE MÊME PAPIER, au titre et à trois lignes près. Un second
  // fichier de rendu à 95 % identique aurait dérivé du premier au premier
  // changement — c'est la règle des deux papiers de l'atelier (`papier.js`),
  // tenue ici entre la facture et son avoir.
  const av = s.avoir && typeof s.avoir === 'object' ? s.avoir : null;

  return {
    maison: maisonPapier(entreprise),
    titre: av ? 'AVOIR' : 'FACTURE',
    avoir: av ? {
      surFacture: texte(av.surFacture),
      surDate: dateSeule(av.surDate),
      motif: texte(av.motif),
    } : null,
    numero: texte(s.numero),
    date: dateSeule(s.date) || dateSeule(jourAtelier()),
    projet: texte(s.projet),
    client: {
      nom: nomClientAffiche(texte(c.nom), c.type),
      adresse: texte(c.adresse),
      ville: texte(c.ville),
      contact: texte(c.contact),
      tel: texte(c.tel),
      email: texte(c.email),
    },
    lignes: compte.lignes.map((l) => ({
      designation: texte(l.designation),
      reference: texte(l.reference),
      couleur: texte(l.couleur),
      tailles: texte(l.tailles),
      marquage: texte(l.marquage),
      encre: texte(l.encre),
      faces: texte(l.faces),
      note: texte(l.note),
      quantite: l.quantite,
      unitaireHt: euro(l.unitaireHt),
      totalHt: euro(l.totalHt),
    })).filter((l) => l.designation || l.totalHt),
    // TANT QU'AUCUNE LIGNE N'A DE PRIX, IL N'Y A PAS DE TOTAL (même règle que
    // le devis, 02/09 : « par défaut je ne veux pas de prix, ça doit être
    // vierge »). Une facture VIERGE ne doit pas afficher « TOTAL TTC 0,00 € »
    // en géant — c'est un montant que personne n'a décidé, et sur ce
    // document-ci, réclamer 0,00 € serait en plus une fausse promesse de
    // règlement. Trouvé en vérifiant l'écran vide (03/09).
    totaux: compte.aucunPrix ? null : {
      sousTotalHt: euro(compte.sousTotalHt),
      ajustement: compte.ajustement.montant ? euro(compte.ajustement.montant) : '',
      ecart: compte.ecart ? euro(compte.ecart) : '',
      totalHt: euro(compte.totalHt),
      taxeLabel: compte.regime.taxable
        ? `${compte.regime.label} ${(compte.tauxTgca * 100).toFixed(compte.tauxTgca * 100 % 1 ? 1 : 0)} %`
        : compte.regime.label,
      taxe: euro(compte.taxe),
      ttc: euro(compte.ttc),
      vedette: compte.vedette,
    },
    // LE RÈGLEMENT NE S'IMPRIME QUE SUR UNE FACTURE CHIFFRÉE. Même logique
    // que `totaux` ci-dessus : sans prix, il n'y a rien à régler.
    // SUR UN AVOIR, LE CADRE NE DIT PAS COMMENT ON A PAYÉ MAIS CE QU'ON REND.
    // Y laisser « Carte bancaire » ferait croire que le remboursement part sur
    // la carte, ce que ce document ne décide pas.
    reglement: compte.aucunPrix ? null
      : (av ? { titre: 'AVOIR', montant: euro(compte.ttc), mode: '' }
        : (mode ? { titre: 'RÈGLEMENT', montant: euro(compte.ttc), mode: mode.label } : null)),
    // LA PHRASE QUI JUSTIFIE L'EXONÉRATION, figée à l'émission par le serveur
    // (`document.saisie.mentionRegime`). Vide = rien ne s'imprime : nous
    // n'inventons aucune citation d'article — voir l'avertissement en tête.
    mentionRegime: texte(s.mentionRegime),
    mentions: av ? MENTIONS_AVOIR : MENTIONS_REGLEMENT,
    compte,
  };
}

// LE MÊME DOCUMENT, EN PDF — pour le déposer sur la ligne et l'envoyer.
// ---------------------------------------------------------------------------
// TROISIÈME CONSOMMATEUR DU MÊME MODÈLE, et rien de plus : `modeleFacture` a
// déjà tranché tous les montants et toutes les phrases, `dessinerFacture` les
// met en HTML, celui-ci les met en PDF. Aucune règle ne se réécrit ici — sinon
// les deux rendus finiraient par dire deux choses.
//
// L'IMPORT EST PARESSEUX : pdf-lib pèse 511 Ko, et la plupart des ouvertures de
// l'écran n'émettent aucune facture. Il ne part du serveur qu'au moment où l'on
// en fabrique une.
export async function pdfFacture(t) {
  const { ecrirePapierPdf, nomDuPapier } = await import('./papier-pdf.js');
  // LE RÈGLEMENT EST PROPRE À CE DOCUMENT : un mode de paiement n'est pas un
  // acompte. C'est pour ça que la phrase se compose ici et pas dans le rendu.
  const r = t.reglement;
  const reglement = r
    ? [r.titre, r.montant, r.mode ? `par ${r.mode}` : ''].filter(Boolean).join(' — ')
    : '';
  return { bytes: await ecrirePapierPdf(t, { reglement }), nom: nomDuPapier(t) };
}

// ===========================================================================
// LA FEUILLE — A4 portrait, autonome
// ===========================================================================
// MÊME GRAMMAIRE QUE LE DEVIS (dv-geant/dv-cle/dv-texte) : ce sont les mêmes
// crans de lecture, sur un document de la même famille. Les classes portent
// leur propre préfixe (`fa-`, comme « facture ») pour ne jamais capter les
// styles écrits pour `.dv`.
export const CSS_FACTURE = SOCLE_PAPIER + `
  .fa {${JETONS_PAPIER}
       --fa-geant: 30px; --fa-cle: 17px; --fa-texte: 13px;
       --fa-rang: 26px; --fa-gouttiere: 26px; --fa-section: 22px;
       width: 210mm; min-height: 297mm; box-sizing: border-box; margin: 0 auto;
       display: flex; flex-direction: column;
       background: #ffffff; color: var(--pap-encre);
       font: var(--fa-texte)/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
       font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
  .fa * { box-sizing: border-box; }

  .fa__tete { display: flex; align-items: flex-start; justify-content: space-between;
              gap: 28px; padding: 26px var(--pap-marge) 16px; border-bottom: 3px solid var(--pap-encre); }
  .fa__maison { display: flex; flex-direction: column; gap: 1px; min-width: 0;
                overflow-wrap: anywhere; }
  .fa__maison-nom { font-size: var(--fa-cle); font-weight: 800; letter-spacing: -.02em;
                    line-height: 1.2; margin-bottom: 3px; }
  .fa__maison-l { color: var(--pap-ardoise); line-height: 1.35; }
  .fa__ref { display: flex; flex-direction: column; align-items: flex-end; gap: 3px;
             text-align: right; flex: 0 0 auto; }
  .fa__titre { font-size: var(--fa-cle); font-weight: 800; letter-spacing: .04em;
               line-height: 1.15; white-space: nowrap; }
  .fa__num { font: 700 var(--fa-cle)/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

  .fa__corps { flex: 1; min-height: 0; display: flex; flex-direction: column;
               gap: var(--fa-section); padding: 16px var(--pap-marge) 0; }

  .fa__grille { display: grid; grid-template-columns: 1fr 1fr; column-gap: var(--fa-gouttiere); }
  .fa__section-k { padding-bottom: 6px; border-bottom: 2px solid var(--pap-encre);
                   color: var(--pap-encre); font-weight: 700; }
  .fa__paire { display: flex; align-items: baseline; justify-content: space-between;
               gap: 12px; min-height: var(--fa-rang); padding: 4px 0;
               border-bottom: 1px dotted var(--pap-filet); }
  .fa__k { color: var(--pap-ardoise); }
  .fa__v { font-weight: 700; text-align: right; }
  .fa__nom { display: flex; align-items: baseline; min-height: var(--fa-rang);
             padding: 4px 0; border-bottom: 1px dotted var(--pap-filet);
             font-size: var(--fa-cle); font-weight: 800; letter-spacing: -.02em; }

  .fa__table { width: 100%; border-collapse: collapse; }
  .fa__table th { text-align: left; padding: 0 0 6px; border-bottom: 2px solid var(--pap-encre);
                  color: var(--pap-encre); font-weight: 700; }
  .fa__table td { padding: 7px 0; border-bottom: 1px dotted var(--pap-filet); vertical-align: top; }
  .fa__table th + th, .fa__table td + td { padding-left: 12px; }
  .fa__c-qte { width: 52px; text-align: right; }
  .fa__c-pu { width: 92px; text-align: right; }
  .fa__c-tot { width: 100px; text-align: right; }
  .fa__table th.fa__c-qte, .fa__table th.fa__c-pu, .fa__table th.fa__c-tot { text-align: right; }
  .fa__art { font-weight: 700; }
  .fa__art-d { color: var(--pap-ardoise); line-height: 1.35; }
  .fa__art-n { color: var(--pap-ardoise); font-style: italic; line-height: 1.35; }
  .fa__table tr { break-inside: avoid; }

  .fa__bas { display: grid; grid-template-columns: 1fr 240px; gap: var(--fa-gouttiere);
             align-items: start; }
  .fa__tot-l { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0;
               border-bottom: 1px dotted var(--pap-filet); }
  .fa__tot-k { color: var(--pap-ardoise); }
  .fa__tot-v { font-weight: 700; }
  .fa__grand { display: flex; flex-direction: column; gap: 2px; margin-top: 8px;
               padding-top: 8px; border-top: 2px solid var(--pap-encre); }
  .fa__grand-v { font-size: var(--fa-geant); font-weight: 800; letter-spacing: -.02em;
                 line-height: 1.05; }

  .fa__pay { border: 1px solid var(--pap-filet); padding: 12px; line-height: 1.5; }
  .fa__pay-v { font-size: var(--fa-geant); font-weight: 800; letter-spacing: -.02em;
               line-height: 1.05; margin: 6px 0 4px; }

  .fa__mentions { padding: 10px var(--pap-marge) 0; color: var(--pap-ardoise);
                  line-height: 1.5; font-size: 11px; }
  /* MÊME CRAN DE TEXTE que les autres mentions — la lisibilité d'une mention
     légale ne se hiérarchise pas — mais l'encre pleine et la graisse : celle-ci
     JUSTIFIE le montant taxé juste au-dessus, elle n'accompagne pas. */
  .fa__mentions--regime { padding-bottom: 0; color: var(--pap-encre); font-weight: 700; }

  .fa__pied { margin-top: auto; padding: 14px var(--pap-marge) 22px; text-align: center;
              color: var(--pap-ardoise); line-height: 1.5; }
  .fa__pied-l { border-top: 1px solid var(--pap-filet); padding-top: 8px; }

  @media print {
    .fa { box-shadow: none; }
  }
`;

// ===========================================================================
// LE RENDU
// ===========================================================================
export function dessinerFacture(t, doc) {
  const d = doc || document;
  const el = (tag, cls, txt) => {
    const n = d.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null && txt !== '') n.textContent = txt;
    return n;
  };
  const paire = (k, v) => {
    const l = el('div', 'fa__paire');
    l.append(el('span', 'fa__k pap-cap', k), el('span', 'fa__v', v));
    return l;
  };

  const f = el('div', 'fa');

  // --- En-tete ---
  const tete = el('div', 'fa__tete');
  const maison = el('div', 'fa__maison');
  if (t.maison.nom) maison.append(el('div', 'fa__maison-nom', t.maison.nom));
  for (const l of t.maison.lignes) maison.append(el('div', 'fa__maison-l', l));
  for (const l of t.maison.contact) maison.append(el('div', 'fa__maison-l', l));
  const ref = el('div', 'fa__ref');
  ref.append(el('div', 'fa__titre', t.titre));
  if (t.numero) ref.append(el('div', 'fa__num', t.numero));
  ref.append(el('div', 'pap-cap', `DU ${t.date}`));
  tete.append(maison, ref);
  f.append(tete);

  const corps = el('div', 'fa__corps');

  // --- Client et dossier ---
  const grille = el('div', 'fa__grille');
  grille.append(el('div', 'fa__section-k pap-cap', 'CLIENT'),
    el('div', 'fa__section-k pap-cap', 'DOSSIER'));
  // L'ADRESSE PASSE DEVANT, ET ELLE EST OBLIGATOIRE SUR UNE FACTURE : le nom
  // et l'adresse des deux parties sont ce qui rend le document opposable
  // (art. L441-9 du code de commerce). Elle reste soumise à la même règle que
  // le reste — un champ vide ne s'imprime pas — mais son absence est un
  // MANQUE, pas un choix : voir le compteur d'émission de vente-flash.js.
  const gauche = [
    ['ADRESSE', t.client.adresse], ['VILLE', t.client.ville],
    ['CONTACT', t.client.contact],
    ['TÉLÉPHONE', t.client.tel], ['E-MAIL', t.client.email],
  ].filter(([, v]) => v);
  // « DATE DE VENTE », PAS « DATE » : l'en-tête porte déjà la date d'ÉMISSION
  // (« DU … »), et une facture doit dire les deux. Au comptoir elles tombent
  // le même jour — le libellé est ce qui distingue les deux lignes, et il ne
  // coûte rien de le poser juste maintenant plutôt que le jour où une vente
  // se facturera en différé.
  // UN AVOIR CITE LA FACTURE QU'IL CORRIGE, et il la cite en haut : c'est la
  // première chose que cherche celui qui classe le papier. Sans ce lien, un
  // avoir est un document qui rend de l'argent sans dire pourquoi.
  const droite = [
    ['PROJET', t.projet],
    ...(t.avoir ? [['SUR FACTURE', t.avoir.surFacture], ['FACTURE DU', t.avoir.surDate]] : []),
    // SUR UN AVOIR, CE N'EST PAS UNE VENTE. Le mot compte à côté de « FACTURE
    // DU » juste au-dessus : les deux dates diffèrent dès que l'avoir sort un
    // autre jour, et « DATE DE VENTE » désignerait alors la mauvaise.
    [t.avoir ? 'DATE DE L’AVOIR' : 'DATE DE VENTE', t.date],
  ].filter(([, v]) => v);
  const rangs = Math.max(1 + gauche.length, droite.length);
  for (let i = 0; i < rangs; i += 1) {
    if (i === 0) grille.append(el('div', 'fa__nom', t.client.nom));
    else if (gauche[i - 1]) grille.append(paire(gauche[i - 1][0], gauche[i - 1][1]));
    else grille.append(el('div', 'fa__paire'));
    if (droite[i]) grille.append(paire(droite[i][0], droite[i][1]));
    else grille.append(el('div', 'fa__paire'));
  }
  corps.append(grille);

  // --- Le detail ---
  const table = el('table', 'fa__table');
  const thead = el('thead');
  const trh = el('tr');
  trh.append(el('th', 'pap-cap', 'DÉSIGNATION'), el('th', 'fa__c-qte pap-cap', 'QTÉ'),
    el('th', 'fa__c-pu pap-cap', 'PU HT'), el('th', 'fa__c-tot pap-cap', 'TOTAL HT'));
  thead.append(trh);
  const tbody = el('tbody');
  for (const l of t.lignes) {
    const tr = el('tr');
    const cell = el('td');
    cell.append(el('div', 'fa__art', l.designation));
    for (const [k, v] of [['Réf', l.reference], ['Couleur', l.couleur],
      ['Tailles', l.tailles], ['Marquage', l.marquage],
      ['Encre', l.encre], ['Faces', l.faces]]) {
      if (v) cell.append(el('div', 'fa__art-d', `${k} : ${v}`));
    }
    if (l.note) cell.append(el('div', 'fa__art-n', l.note));
    tr.append(cell, el('td', 'fa__c-qte', String(l.quantite)),
      el('td', 'fa__c-pu', l.unitaireHt), el('td', 'fa__c-tot', l.totalHt));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  corps.append(table);

  // --- Totaux, réglement ---
  const bas = el('div', 'fa__bas');
  const pay = el('div');
  if (t.reglement) {
    const cadre = el('div', 'fa__pay');
    cadre.append(el('div', 'pap-cap', t.reglement.titre));
    cadre.append(el('div', 'fa__pay-v', t.reglement.montant));
    if (t.reglement.mode) cadre.append(el('div', 'fa__art-d', t.reglement.mode));
    // LE MOTIF EST DANS LE CADRE, pas en note de bas de page : c'est la seule
    // phrase qui explique pourquoi cet argent repart, et elle se lit avec le
    // montant, pas dix centimètres plus bas.
    if (t.avoir && t.avoir.motif) cadre.append(el('div', 'fa__art-n', t.avoir.motif));
    pay.append(cadre);
  }
  bas.append(pay);

  // PAS DE BLOC DE TOTAUX SUR UNE FACTURE VIERGE (voir modeleFacture) : la
  // colonne de droite reste réservée par la grille, le premier prix posé la
  // remplit sans rien décaler — même principe que le devis.
  if (t.totaux) {
    const totaux = el('div');
    const ligneTotal = (k, v) => {
      const l = el('div', 'fa__tot-l');
      l.append(el('span', 'fa__tot-k', k), el('span', 'fa__tot-v', v));
      return l;
    };
    totaux.append(ligneTotal('Sous-total HT', t.totaux.sousTotalHt));
    if (t.totaux.ajustement) totaux.append(ligneTotal('Ajustement', t.totaux.ajustement));
    if (t.totaux.ecart) totaux.append(ligneTotal('Arrondi commercial', t.totaux.ecart));
    const grand = el('div', 'fa__grand');
    if (t.totaux.vedette === 'ht') {
      totaux.append(ligneTotal(t.totaux.taxeLabel, t.totaux.taxe));
      totaux.append(ligneTotal('TTC', t.totaux.ttc));
      grand.append(el('div', 'pap-cap', 'TOTAL HT'), el('div', 'fa__grand-v', t.totaux.totalHt));
    } else {
      totaux.append(ligneTotal('Total HT', t.totaux.totalHt));
      totaux.append(ligneTotal(t.totaux.taxeLabel, t.totaux.taxe));
      grand.append(el('div', 'pap-cap', t.avoir ? 'MONTANT DE L’AVOIR' : 'TOTAL TTC'),
        el('div', 'fa__grand-v', t.totaux.ttc));
    }
    totaux.append(grand);
    bas.append(totaux);
  }
  corps.append(bas);

  f.append(corps);

  // --- Mentions légales ---
  // LA JUSTIFICATION DE L'EXONÉRATION D'ABORD, et sur sa propre ligne : c'est
  // celle qu'un comptable cherche, et la noyer dans le paragraphe des
  // pénalités de retard reviendrait à ne pas l'écrire.
  if (t.mentionRegime) {
    f.append(el('div', 'fa__mentions fa__mentions--regime', t.mentionRegime));
  }
  if (t.mentions) {
    f.append(el('div', 'fa__mentions', t.mentions));
  }

  // --- Pied ---
  if (t.maison.legal.length) {
    const pied = el('div', 'fa__pied');
    pied.append(el('div', 'fa__pied-l', t.maison.legal.join(' - ')));
    f.append(pied);
  }
  return f;
}
