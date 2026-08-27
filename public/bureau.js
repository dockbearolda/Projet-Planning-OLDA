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
const TGCA = 0.04;

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
const DEJA_TOTAL = new Set(['Total TTC', 'Total HT', 'Taxe', 'Taxe 4 %', 'Paiement',
  'Nombre d’articles', 'Quantité totale', 'Récupération prévue', 'Date de la vente']);

// Ce qui n'appartient à AUCUN article : le dossier lui-même. On le garde tel
// que le comptoir l'a écrit — c'est la trace de la prise de commande.
function dossierDuPanier(details) {
  return (Array.isArray(details) ? details : [])
    .filter((l) => l && typeof l === 'object' && !RE_POSTE.test(String(l.k || '')))
    .map((l) => ({ k: texte(l.k), v: texte(l.v) }))
    // Ni ce que les colonnes portent déjà (le client, ses coordonnées), ni ce
    // que le bloc TOTAL vient d'écrire : un document qui répète trois fois le
    // nom du client se lit trois fois plus lentement.
    .filter((l) => l.k && l.v && !DEJA_DIT.has(l.k) && !DEJA_TOTAL.has(l.k));
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

function argentDe(l, fiche) {
  const ttc = nombre(l.project_value);
  const aPrix = ttc != null;
  const revient = nombre(l.cout_revient);
  const aRevient = revient != null;
  const ht = aPrix ? Math.round((ttc / (1 + TGCA)) * 100) / 100 : null;
  const pay = (fiche && fiche.paiement) || {};
  const acompte = nombre(l.acompte_montant);
  return {
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
function noteUtile(note, dossier) {
  if (!note) return '';
  const nu = (v) => String(v).replace(/\s+/g, ' ').trim().toLowerCase();
  const dit = nu(note);
  return dossier.some((x) => nu(`${x.k} : ${x.v}`) === dit || nu(x.v) === dit) ? '' : note;
}

// LE MODÈLE DU BON DE COMMANDE. `l` est une ligne du planning avec sa fiche
// COMPLÈTE (celle de la liste est allégée du détail — voir allegerFiche).
export function modeleBureau(l) {
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

  return {
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
      nom: texte(r.billing_company),
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
      autres: (Array.isArray(f.client) ? f.client : [])
        .map((x) => ({ k: texte(x && x.k), v: texte(x && x.v) }))
        .filter((x) => x.k && x.v && !DEJA_DIT.has(x.k)),
    },
    responsable: texte(r.responsable),
    // LE DÉTAIL, ARTICLE PAR ARTICLE. Le bureau veut le prix unitaire, la
    // quantité et ce qui a été vendu — pas la fiche de production.
    articles: postes.map((p) => ({
      no: p.no,
      designation: p.champs['Désignation'] || '',
      quantite: p.champs['Quantité'] || '',
      categorie: p.champs['Catégorie'] || '',
      reference: p.champs['Référence'] || '',
      couleur: p.champs['Couleur'] || '',
      unitaire: uniteVendue(p.champs),
      total: p.champs['Total TTC'] || '',
      detail: p.champs['Description de production'] || p.champs['Informations importantes'] || '',
    })),
    // Le récapitulatif du dossier, tel que la vendeuse l'a rempli. Il porte ce
    // qu'aucune colonne ne range : le canal d'entrée, l'objet du projet, le
    // délai, la note interne.
    dossier: dossierDuPanier(f.details),
    argent: argentDe(r, f),
    // Ce que la vendeuse a écrit de sa main sur la ligne — SAUF quand elle ne
    // l'a pas écrite. La colonne `description` d'un dossier du comptoir est
    // remplie par l'écran (« Délai souhaité : Sous 10 jours ouvrés »), et cette
    // phrase est mot pour mot une ligne du récapitulatif imprimé vingt lignes
    // plus haut. Le document la disait donc deux fois, dont une sous un cadre
    // « ne pas remettre au client » où elle n'apprend rien.
    note: noteUtile(texte(r.description), dossierDuPanier(f.details)),
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
export const CSS_BUREAU = `
.bu {
  --bu-encre: #202930; --bu-ardoise: #4A6274; --bu-filet: #ADB8B9;
  --bu-titre: 34px; --bu-nombre: 30px; --bu-cle: 20px; --bu-fort: 17px;
  --bu-texte: 14px; --bu-note: 12px; --bu-cap: 10px;
  width: 210mm; min-height: 297mm; box-sizing: border-box;
  display: flex; flex-direction: column;
  background: #ffffff; color: var(--bu-encre);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-variant-numeric: tabular-nums; font-feature-settings: "tnum";
  font-size: var(--bu-texte); line-height: 1.4;
}
.bu * { box-sizing: border-box; }
.bu__cap {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--bu-cap); font-weight: 500; letter-spacing: .16em;
  color: var(--bu-ardoise); text-transform: uppercase;
}
.bu__tete {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 24px;
  padding: 26px 40px 12px; border-bottom: 3px solid var(--bu-encre);
}
.bu__titre {
  font-size: var(--bu-titre); font-weight: 800; letter-spacing: -.04em;
  line-height: .98; text-transform: uppercase;
}
.bu__ref { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.bu__ref-v {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--bu-cle); font-weight: 700;
}
.bu__corps { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 16px; padding: 18px 40px 0; }
.bu__deux { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.bu__bloc { border: 1px solid var(--bu-filet); padding: 12px 14px; }
.bu__bloc--fort { border: 2px solid var(--bu-encre); }
.bu__bloc-titre { margin-bottom: 8px; }
.bu__paire { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; }
.bu__paire + .bu__paire { border-top: 1px dotted var(--bu-filet); }
.bu__k { color: var(--bu-ardoise); }
.bu__v { font-weight: 700; text-align: right; }
.bu__nom { font-size: var(--bu-cle); font-weight: 800; letter-spacing: -.02em; line-height: 1.15; }

.bu__table { width: 100%; border-collapse: collapse; }
.bu__table th {
  padding: 6px 8px; border-bottom: 2px solid var(--bu-encre); text-align: left;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--bu-cap); font-weight: 500; letter-spacing: .14em;
  color: var(--bu-ardoise); text-transform: uppercase;
}
.bu__table td { padding: 8px; border-bottom: 1px solid var(--bu-filet); vertical-align: top; }
.bu__num { text-align: right; white-space: nowrap; }
.bu__desi { font-weight: 700; }
.bu__sous { display: block; font-size: var(--bu-note); color: var(--bu-ardoise); }

.bu__totaux { display: flex; justify-content: flex-end; }
.bu__totaux-boite { min-width: 74mm; border: 2px solid var(--bu-encre); padding: 12px 14px; }
.bu__ttc { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-top: 8px; padding-top: 8px; border-top: 2px solid var(--bu-encre); }
.bu__ttc-v { font-size: var(--bu-nombre); font-weight: 800; letter-spacing: -.03em; }
.bu__achiffrer { font-size: var(--bu-cle); font-weight: 800; }

/* LE BLOC INTERNE. Marge, coût de revient, note : il ne sort PAS chez le
   client. Un liseré rayé le dit sans qu'on ait besoin de le lire. */
.bu__interne { border: 1px dashed var(--bu-encre); padding: 12px 14px; }
.bu__interne-tete { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.bu__grille3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.bu__mesure { display: flex; flex-direction: column; gap: 2px; }
.bu__mesure-v { font-size: var(--bu-fort); font-weight: 800; }
.bu__libre { margin: 0; white-space: pre-wrap; }

.bu__pied {
  display: flex; align-items: center; justify-content: space-between; gap: 24px;
  margin-top: auto; padding: 12px 40px 20px; border-top: 1px dashed var(--bu-encre);
}
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
  const cap = (txt, cls) => el('div', cls ? `bu__cap ${cls}` : 'bu__cap', txt);
  const paire = (k, v) => {
    const p = el('div', 'bu__paire');
    p.append(el('span', 'bu__k', k), el('span', 'bu__v', v));
    return p;
  };

  const feuille = el('div', 'bu');

  // --- L'en-tête : ce que c'est, et son numéro ------------------------------
  const tete = el('div', 'bu__tete');
  tete.append(el('div', 'bu__titre', t.titre));
  const bRef = el('div', 'bu__ref');
  bRef.append(cap(t.demande ? 'Demande' : 'Commande'), el('div', 'bu__ref-v', t.ref || '—'));
  // Le numéro que porte le ticket déjà remis au client, quand il diffère : sans
  // lui, le client tend un papier qu'on ne retrouve nulle part.
  if (t.refTicket) bRef.append(el('div', 'bu__sous', `ticket remis : ${t.refTicket}`));
  if (t.lot) bRef.append(el('div', 'bu__sous', `article ${t.lot.rang} sur ${t.lot.total}`));
  tete.append(bRef);
  feuille.append(tete);

  const corps = el('div', 'bu__corps');
  feuille.append(corps);

  // --- Le client, en entier, et les dates ----------------------------------
  const deux = el('div', 'bu__deux');
  const bClient = el('div', 'bu__bloc');
  bClient.append(cap('Client', 'bu__bloc-titre'), el('div', 'bu__nom', t.client.nom || '—'));
  for (const [k, v] of [['Type', t.client.type], ['Contact', t.client.contact],
    ['Téléphone', t.client.tel], ['E-mail', t.client.email]]) {
    // UN CHAMP VIDE NE S'AFFICHE PAS. « E-mail : — » n'apprend rien et pousse
    // vers le bas ce qu'on cherche vraiment.
    if (v) bClient.append(paire(k, v));
  }
  for (const x of t.client.autres) bClient.append(paire(x.k, x.v));

  const bDates = el('div', 'bu__bloc');
  bDates.append(cap('Dossier', 'bu__bloc-titre'));
  if (t.priseLe) bDates.append(paire(t.demande ? 'Demande prise le' : 'Commande prise le', t.priseLe));
  if (t.retrait) bDates.append(paire('Récupération', t.heure ? `${t.retrait} à ${t.heure}` : t.retrait));
  if (t.responsable) bDates.append(paire('Suivi par', t.responsable));
  if (t.production) bDates.append(paire('Production', t.production));
  deux.append(bClient, bDates);
  corps.append(deux);

  // --- LE DÉTAIL : c'est le cœur du document du bureau ----------------------
  if (t.articles.length) {
    const bloc = el('div', 'bu__bloc');
    bloc.append(cap('Détail', 'bu__bloc-titre'));
    const table = el('table', 'bu__table');
    const thead = el('thead');
    const trh = el('tr');
    const colonnes = t.demande
      ? ['Désignation', 'Qté']
      : ['Désignation', 'Qté', 'P.U. TTC', 'Total TTC'];
    for (const c of colonnes) {
      const th = el('th', c === 'Désignation' ? '' : 'bu__num', c);
      trh.append(th);
    }
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
  const arg = t.argent;
  const totaux = el('div', 'bu__totaux');
  const boite = el('div', 'bu__totaux-boite');
  boite.append(cap('Total', 'bu__bloc-titre'));
  if (arg.ttc == null) {
    // « Pas encore chiffré » n'est PAS « gratuit ». On l'écrit en toutes
    // lettres plutôt que d'imprimer 0,00 € sur un document qui sert à facturer.
    boite.append(el('div', 'bu__achiffrer', 'À chiffrer'));
  } else {
    boite.append(paire('Total HT', euro(arg.ht)), paire(`TGCA ${TGCA * 100} %`, euro(arg.taxe)));
    const ttc = el('div', 'bu__ttc');
    ttc.append(el('span', 'bu__k', 'TTC'), el('span', 'bu__ttc-v', euro(arg.ttc)));
    boite.append(ttc);
    if (arg.acompte != null) boite.append(paire('Acompte versé', euro(arg.acompte)));
    boite.append(paire('Règlement', arg.paye ? (arg.mode || 'Payé') : 'À encaisser'));
  }
  totaux.append(boite);
  corps.append(totaux);

  // --- Ce que la vendeuse a recueilli, tel qu'elle l'a écrit ----------------
  if (t.dossier.length) {
    const bloc = el('div', 'bu__bloc');
    bloc.append(cap('Ce qui a été recueilli', 'bu__bloc-titre'));
    for (const x of t.dossier) bloc.append(paire(x.k, x.v));
    corps.append(bloc);
  }

  // --- LE BLOC INTERNE : marge, revient, note. Ne sort pas chez le client ---
  const interne = el('div', 'bu__interne');
  const teteI = el('div', 'bu__interne-tete');
  teteI.append(cap('Interne'), el('span', 'bu__sous', 'ne pas remettre au client'));
  interne.append(teteI);
  const g = el('div', 'bu__grille3');
  const mesure = (k, v) => {
    const m = el('div', 'bu__mesure');
    m.append(cap(k), el('span', 'bu__mesure-v', v));
    return m;
  };
  g.append(
    mesure('Coût de revient', arg.revient == null ? '—' : euro(arg.revient)),
    mesure('Marge', arg.marge == null ? '—' : euro(arg.marge)),
    mesure('Acompte', arg.acompteDemande ? (arg.acompteVerse ? 'versé' : 'demandé') : '—'),
  );
  interne.append(g);
  if (t.note) interne.append(el('p', 'bu__libre', t.note));
  corps.append(interne);

  // --- Le pied -------------------------------------------------------------
  const pied = el('div', 'bu__pied');
  pied.append(cap(`Atelier OLDA · ${t.titre}${t.ref ? ` ${t.ref}` : ''}`),
    cap(t.priseLe || ''));
  feuille.append(pied);
  return feuille;
}

// Le document en TEXTE — ce que le téléchargement remet, et ce qu'un poste sans
// imprimante recopie. Même contenu que le papier, à la ligne près.
export function bureauTexte(t) {
  const sep = '='.repeat(56);
  const out = [`${t.titre.toUpperCase()}${t.ref ? ` — ${t.ref}` : ''}`, sep];
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
    out.push(`Total HT : ${euro(arg.ht)}`, `TGCA ${TGCA * 100} % : ${euro(arg.taxe)}`, `TOTAL TTC : ${euro(arg.ttc)}`);
    out.push(`Règlement : ${arg.paye ? (arg.mode || 'payé') : 'à encaisser'}`);
  }
  if (t.dossier.length) {
    out.push(sep, 'CE QUI A ÉTÉ RECUEILLI');
    for (const x of t.dossier) out.push(`${x.k} : ${x.v}`);
  }
  out.push(sep, 'INTERNE — ne pas remettre au client');
  out.push(`Coût de revient : ${arg.revient == null ? '—' : euro(arg.revient)}`);
  out.push(`Marge : ${arg.marge == null ? '—' : euro(arg.marge)}`);
  if (t.note) out.push(t.note);
  return out.join('\n');
}
