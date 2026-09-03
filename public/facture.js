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
import {
  texte, euro, cents, dateSeule, jourAtelier, calculerDevis,
  REGIMES, ARRONDIS, AJUSTEMENT_UNITES, VEDETTES,
} from './devis.js';
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
const MENTIONS_REGLEMENT = 'Facture réglée en totalité à la remise. Aucun escompte pour paiement '
  + 'anticipé. En cas de retard de paiement sur une facture à échéance : pénalité au taux légal en '
  + 'vigueur, exigible sans qu’un rappel soit nécessaire, et indemnité forfaitaire de recouvrement '
  + 'de 40 € (articles L441-10 et D441-5 du code de commerce).';

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

  return {
    maison: maisonPapier(entreprise),
    titre: 'FACTURE',
    numero: texte(s.numero),
    date: dateSeule(s.date) || dateSeule(jourAtelier()),
    projet: texte(s.projet),
    client: {
      nom: nomClientAffiche(texte(c.nom), c.type),
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
    totaux: {
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
    // LE RÈGLEMENT N'EST JAMAIS NULL sur une facture émise : le mode est
    // obligatoire côté écran ET côté serveur (voir server.js). `null` ne peut
    // apparaître que si un appelant construit un modèle hors du parcours
    // normal — le papier l'affiche alors sans bloc de règlement plutôt que de
    // planter, pour rester lisible en cas d'anomalie amont.
    reglement: mode ? { mode: mode.label, montant: euro(compte.ttc) } : null,
    mentions: MENTIONS_REGLEMENT,
    compte,
  };
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
  const gauche = [
    ['VILLE', t.client.ville], ['CONTACT', t.client.contact],
    ['TÉLÉPHONE', t.client.tel], ['E-MAIL', t.client.email],
  ].filter(([, v]) => v);
  const droite = [['PROJET', t.projet], ['DATE', t.date]].filter(([, v]) => v);
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
    cadre.append(el('div', 'pap-cap', 'RÈGLEMENT'));
    cadre.append(el('div', 'fa__pay-v', t.reglement.montant));
    cadre.append(el('div', 'fa__art-d', t.reglement.mode));
    pay.append(cadre);
  }
  bas.append(pay);

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
    grand.append(el('div', 'pap-cap', 'TOTAL TTC'), el('div', 'fa__grand-v', t.totaux.ttc));
  }
  totaux.append(grand);
  bas.append(totaux);
  corps.append(bas);

  f.append(corps);

  // --- Mentions légales ---
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
