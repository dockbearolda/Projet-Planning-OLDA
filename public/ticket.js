// ===========================================================================
// LE TICKET — celui qu'on remet au client, réimprimable depuis le planning
// ===========================================================================
// Une vente directe et une demande de devis naissent au comptoir
// (public/comptoir/*.html), où la vendeuse imprime un ticket et le remet au
// client. Le planning, lui, n'en gardait aucune trace imprimable : son bouton
// « Imprimer » sortait le RÉCAPITULATIF COMPLET — une feuille A4 portant le
// secteur d'activité, l'adresse de facturation, la taxe de 4 %, le total HT,
// les points à contrôler et jusqu'à la note interne OLDA. Autrement dit : le
// dossier de travail de l'atelier, pas le ticket du client.
//
// Ce module reconstruit LE TICKET, et rien d'autre. Il ne lit pas le
// récapitulatif tel quel : il en extrait les seules lignes qui figurent sur le
// papier remis au comptoir, et laisse tomber tout le reste.
//
// DEUX SOURCES, DEUX RÔLES :
//   - la LIGNE (`r`) fait foi pour ce qui se corrige après la vente — le nom du
//     client, la date de retrait, l'heure, le montant, le paiement. Un ticket
//     réimprimé porte donc les corrections, jamais l'état du jour de la prise.
//   - la FICHE (`r.fiche`) fait foi pour ce qui a été VENDU : le détail article
//     par article, figé à la création et jamais retouché.
//
// Aucun DOM ici en dehors de `dessinerTicket` : le modèle est une fonction
// pure, c'est ce qui le rend testable hors navigateur.

// Le placeholder du comptoir pour « pas renseigné ». Il arrive tel quel dans la
// fiche : le recopier sur un ticket afficherait « Personne à contacter : — ».
const VIDE = '—';

const texte = (v) => {
  const s = String(v == null ? '' : v).trim();
  return s === '' || s === VIDE ? '' : s;
};

// Les libellés d'article / de besoin du comptoir : « Article 2 — Quantité ».
// Le tiret est un tiret CADRATIN (—), celui que produisent les deux écrans.
const RE_POSTE = /^(Article|Besoin)\s+(\d+)\s+—\s+(.+)$/;

// Un euro déjà formaté par le comptoir (« 48,00 € ») se recopie tel quel ; un
// nombre de la ligne se formate ici. Même rendu dans les deux cas.
export const euroTicket = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;

// Un montant du comptoir qui ne vaut rien : « 0,00 € » sur un supplément
// absent, c'est une ligne de plus sur le ticket pour dire qu'il ne s'est rien
// passé.
const montantNul = (s) => !texte(s) || /^0([.,]0+)?\s*€?$/.test(texte(s));

// La date civile de l'ATELIER (Saint-Martin, UTC−4). `creeLe` est un instant
// UTC : à 20 h 30 au comptoir, un affichage naïf le daterait du lendemain — et
// le ticket réimprimé ne porterait plus la date de celui remis au client.
const JOUR_ATELIER = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'America/Marigot', day: '2-digit', month: '2-digit', year: 'numeric',
});

function dateCreation(iso) {
  const d = new Date(String(iso || ''));
  return Number.isNaN(d.getTime()) ? '' : JOUR_ATELIER.format(d);
}

// « aaaa-mm-jj » → « jj/mm/aaaa ». Une échéance est une date CIVILE, sans
// heure ni fuseau : on la découpe, on ne la fait pas passer par un Date.
function dateFr(iso) {
  const m = String(iso || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

const heureFr = (h) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || '')) ? String(h).replace(':', 'h') : '');

// LE PANIER, extrait du récapitulatif du comptoir. Tout ce qui n'est pas un
// poste — le secteur, l'adresse, le total HT, la note interne — reste où il
// est : c'est le dossier de travail, il n'a rien à faire sur le papier client.
// Les postes se regroupent par NUMÉRO plutôt que par position, pour qu'une
// ligne manquante ne décale pas tout le panier.
function postesDuPanier(details) {
  const postes = new Map();
  for (const l of Array.isArray(details) ? details : []) {
    if (!l || typeof l !== 'object') continue;
    const m = String(l.k || '').match(RE_POSTE);
    if (!m) continue;
    const no = Number(m[2]);
    if (!postes.has(no)) postes.set(no, {});
    postes.get(no)[m[3]] = texte(l.v);
  }
  return [...postes.keys()].sort((a, b) => a - b).map((n) => postes.get(n));
}

// Les articles VENDUS, tels qu'ils figurent sur le ticket : la désignation, la
// quantité, ce qu'on va produire, le prix. Ni le prix unitaire, ni la taxe, ni
// la mention « Taxe 4 % appliquée » — le client lit un total, pas un calcul.
function articlesVente(postes) {
  return postes.map((p) => ({
    designation: p['Désignation'] || '',
    qte: p['Quantité'] || '',
    detail: p['Description de production'] || '',
    prix: p['Total TTC'] || '',
    supplement: montantNul(p['Supplément express']) ? '' : p['Supplément express'],
  })).filter((a) => a.designation);
}

// Les BESOINS d'une demande de devis. Rien n'est encore chiffré : ce qui compte
// sur le papier, c'est ce que le client a demandé, pas ce qu'on en fera.
function besoinsDemande(postes) {
  return postes.map((p) => ({
    designation: p['Désignation'] || '',
    qte: p['Quantité'] || '',
    detail: [p['Catégorie'], p['Couleur'], p['Production']].map(texte).filter(Boolean).join(' · '),
    prix: '',
    supplement: '',
  })).filter((b) => b.designation);
}

// Le paiement tel que la LIGNE le porte, et elle seule. Le comptoir le pose à
// la création (colonnes `paye` / `paiement_mode`), le planning le corrige
// ensuite : retomber sur le mode figé dans le récapitulatif ferait réapparaître
// sur le ticket un règlement que quelqu'un venait justement d'effacer.
const MODE_LABEL = {
  cb: 'Carte bancaire', especes: 'Espèces', virement: 'Virement',
  cheque: 'Chèque', mixte: 'Mixte (CB + espèces)',
};

function paiementTicket(r) {
  const mode = MODE_LABEL[r.paiement_mode] || '';
  if (r.paye === true) return mode ? `${mode} — payé` : 'Payé';
  return mode ? `${mode} — à régler` : 'À régler au retrait';
}

// LE MODÈLE DU TICKET. Pur : mêmes entrées, mêmes sorties, aucun DOM.
// `r` est une ligne du planning avec sa fiche COMPLÈTE (celle de la liste est
// allégée du détail — voir allegerFiche côté serveur).
export function modeleTicket(r) {
  const l = r && typeof r === 'object' ? r : {};
  const f = l.fiche && typeof l.fiche === 'object' ? l.fiche : {};
  const demande = f.source === 'Demande de devis' || l.order_kind === 'demande';
  const postes = postesDuPanier(f.details);

  // Le détail figé n'existe que sur un dossier du comptoir. Une ligne créée à
  // la main dans la grille n'a pas de panier : son ticket porte alors ce que la
  // ligne sait — la description et la quantité. Mieux qu'un ticket vide.
  const lignes = demande ? besoinsDemande(postes) : articlesVente(postes);
  if (!lignes.length && texte(l.product)) {
    lignes.push({
      designation: texte(l.product),
      qte: l.quantity == null ? '' : String(l.quantity),
      detail: texte(f.production),
      prix: '', supplement: '',
    });
  }

  const heure = heureFr(f.heureSouhaitee);
  const jour = dateFr(l.deadline);

  return {
    demande,
    titre: demande ? 'Demande de devis' : 'Ticket de commande',
    // La référence est LA clé : c'est ce que le client lit sur son papier et ce
    // qu'on retape pour retrouver le dossier.
    ref: texte(f.ref),
    // Quand deux postes hors réseau se sont donné la même référence, le dossier
    // a été enregistré sous une AUTRE : le ticket déjà remis porte l'ancienne,
    // et sans ce rappel plus personne ne peut relier les deux.
    refTicket: texte(f.refTicket),
    date: dateCreation(f.creeLe),
    client: texte(l.billing_company),
    contact: texte(l.contact_referent),
    tel: texte(l.contact_phone),
    // Sur une vente c'est le RETRAIT ; sur une demande, la date de réponse
    // souhaitée. Deux promesses différentes, deux libellés.
    remiseLabel: demande ? 'Réponse souhaitée' : 'À retirer le',
    remise: jour ? `${jour}${heure ? ` à ${heure}` : ''}` : '',
    lignes,
    totalLabel: demande ? 'Montant' : 'Total TTC',
    total: l.project_value == null ? 'À chiffrer' : euroTicket(Number(l.project_value)),
    // Une demande n'encaisse rien : afficher « À régler au retrait » sur un
    // devis promettrait un retrait que personne n'a convenu.
    paiement: demande ? '' : paiementTicket(l),
  };
}

// Le ticket en TEXTE — ce que le téléchargement remet, et ce qu'un poste sans
// imprimante recopie. Même contenu que le papier, à la ligne près.
export function ticketTexte(t) {
  const sep = '--------------------------------';
  const out = ['ATELIER OLDA', 'Saint-Martin', t.titre.toUpperCase(), sep];
  if (t.ref) out.push(`${t.demande ? 'Référence' : 'Commande'} : ${t.ref}`);
  if (t.refTicket) out.push(`Ticket remis au client : ${t.refTicket}`);
  if (t.date) out.push(`Le ${t.date}`);
  if (t.client) out.push(`Client : ${t.client}`);
  if (t.contact) out.push(`Contact : ${t.contact}`);
  if (t.tel) out.push(`Tél : ${t.tel}`);
  if (t.remise) out.push(sep, `${t.remiseLabel.toUpperCase()} ${t.remise}`);
  if (t.lignes.length) {
    out.push(sep);
    for (const a of t.lignes) {
      out.push(`${a.qte ? `${a.qte} x ` : ''}${a.designation}${a.prix ? `   ${a.prix}` : ''}`);
      if (a.detail) out.push(`  ${a.detail}`);
      if (a.supplement) out.push(`  Supplément express   ${a.supplement}`);
    }
  }
  out.push(sep, `${t.totalLabel.toUpperCase()} : ${t.total}`);
  if (t.paiement) out.push(`Paiement : ${t.paiement}`);
  out.push(sep, 'Merci pour votre confiance', "L'équipe Atelier OLDA");
  return out.join('\n');
}

// La feuille de style du ticket. Partagée par l'aperçu à l'écran et par
// l'impression : ce qu'on voit est ce qui sort de l'imprimante.
//
// LARGEUR 80 mm — le format d'un rouleau de caisse, et celui qu'imprime déjà
// l'écran du comptoir. Sur une imprimante A4 ordinaire, le ticket sort en haut
// de la feuille, étroit et découpable ; sur une imprimante à tickets, il occupe
// toute la laize. Dans les deux cas c'est UN ticket, pas un dossier.
//
// Tout est en noir sur blanc : la charte réserve la couleur aux ÉTATS, et une
// imprimante à tickets ne connaît de toute façon que le noir.
export const CSS_TICKET = `
  .tk { width: 76mm; margin: 0 auto; padding: 4mm 0; color: #000;
        font: 12px/1.45 Arial, Helvetica, sans-serif; }
  .tk__nom { margin: 0; font-size: 17px; font-weight: 800; letter-spacing: .06em; text-align: center; }
  .tk__lieu { margin: 2px 0 0; font-size: 11px; text-align: center; }
  .tk__titre { margin: 2px 0 0; font-size: 12px; font-weight: 700; text-align: center;
               text-transform: uppercase; letter-spacing: .08em; }
  .tk__sep { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
  .tk__ref { font-size: 15px; font-weight: 800; text-align: center; letter-spacing: .02em; }
  .tk__note { margin: 3px 0 0; font-size: 11px; text-align: center; font-weight: 700; }
  .tk__ligne { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
  .tk__ligne span:first-child { color: #000; }
  .tk__remise { margin: 0; font-size: 13px; font-weight: 800; text-align: center;
                text-transform: uppercase; }
  .tk__art { margin: 7px 0; }
  .tk__art-tete { display: flex; justify-content: space-between; gap: 8px; }
  .tk__art-nom { font-weight: 700; }
  .tk__art-prix { font-weight: 700; white-space: nowrap; }
  .tk__art-detail { margin: 2px 0 0; font-size: 11px; white-space: pre-line; }
  .tk__art-sup { display: flex; justify-content: space-between; gap: 8px;
                 margin: 2px 0 0 8px; font-size: 11px; }
  .tk__total { display: flex; justify-content: space-between; gap: 8px;
               font-size: 15px; font-weight: 800; }
  .tk__paiement { display: flex; justify-content: space-between; gap: 8px; margin: 4px 0 0; }
  .tk__pied { margin: 8px 0 0; font-size: 11px; text-align: center; }
`;

// Le ticket en DOM, dans le document qu'on lui donne — la page pour l'aperçu,
// le cadre d'impression pour le papier. `doc` est explicite : au moment
// d'imprimer, les nœuds doivent naître dans le document du cadre, pas dans
// celui de l'application.
export function dessinerTicket(t, doc) {
  const el = (tag, cls, txt) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };
  const duo = (cls, gauche, droite) => {
    const d = el('div', cls);
    d.append(el('span', null, gauche), el('span', null, droite));
    return d;
  };
  const sep = () => el('hr', 'tk__sep');

  const tk = el('div', 'tk');
  tk.append(
    el('p', 'tk__nom', 'ATELIER OLDA'),
    el('p', 'tk__lieu', 'Saint-Martin'),
    el('p', 'tk__titre', t.titre),
    sep(),
  );

  if (t.ref) tk.append(el('div', 'tk__ref', t.ref));
  if (t.refTicket) tk.append(el('p', 'tk__note', `Ticket remis au client : ${t.refTicket}`));
  if (t.date) tk.append(el('p', 'tk__note', `Le ${t.date}`));
  tk.append(sep());

  if (t.client) tk.append(duo('tk__ligne', 'Client', t.client));
  if (t.contact) tk.append(duo('tk__ligne', 'Contact', t.contact));
  if (t.tel) tk.append(duo('tk__ligne', 'Tél', t.tel));

  if (t.remise) {
    tk.append(sep(), el('p', 'tk__remise', `${t.remiseLabel} ${t.remise}`));
  }

  if (t.lignes.length) {
    tk.append(sep());
    for (const a of t.lignes) {
      const art = el('div', 'tk__art');
      const tete = el('div', 'tk__art-tete');
      tete.append(
        el('div', 'tk__art-nom', `${a.qte ? `${a.qte} × ` : ''}${a.designation}`),
        el('div', 'tk__art-prix', a.prix),
      );
      art.append(tete);
      if (a.detail) art.append(el('p', 'tk__art-detail', a.detail));
      if (a.supplement) art.append(duo('tk__art-sup', 'Supplément express', a.supplement));
      tk.append(art);
    }
  }

  tk.append(sep(), duo('tk__total', t.totalLabel, t.total));
  if (t.paiement) tk.append(duo('tk__paiement', 'Paiement', t.paiement));
  tk.append(
    sep(),
    el('p', 'tk__pied', 'Merci pour votre confiance'),
    el('p', 'tk__pied', "L'équipe Atelier OLDA"),
  );
  return tk;
}
