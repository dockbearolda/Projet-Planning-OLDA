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
// LE TICKET SE CORRIGE. Un numéro faux, une info oubliée, une consigne pour
// l'atelier : ça se rattrape sur la ligne du planning, dans le ticket lui-même
// (cf. `dessinerTicket(t, doc, editeur)`). Le modèle porte donc, pour chaque
// valeur, l'ADRESSE où elle se réécrit — colonne de la ligne, clé de la fiche,
// ou position dans le récapitulatif du comptoir.
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
// Chaque valeur garde l'INDICE de sa ligne dans `fiche.details`. Sans lui, un
// ticket corrigé à l'écran ne saurait pas OÙ réécrire ce qu'on vient de taper :
// le récapitulatif du comptoir se rectifie par POSITION (PATCH …/fiche), jamais
// par libellé — les libellés viennent du parcours et ne se réécrivent pas.
function postesDuPanier(details) {
  const lignes = Array.isArray(details) ? details : [];
  const postes = new Map();
  for (let i = 0; i < lignes.length; i += 1) {
    const l = lignes[i];
    if (!l || typeof l !== 'object') continue;
    const m = String(l.k || '').match(RE_POSTE);
    if (!m) continue;
    const no = Number(m[2]);
    if (!postes.has(no)) postes.set(no, {});
    postes.get(no)[m[3]] = { v: texte(l.v), i };
  }
  return [...postes.keys()].sort((a, b) => a - b).map((n) => postes.get(n));
}

// La valeur d'un poste, et l'endroit où elle s'écrit quand on la corrige.
// `null` = rien à corriger ici (le libellé n'existe pas sur ce dossier).
const vDe = (c) => (c ? c.v : '');
const ouDe = (c) => (c ? { ou: 'details', i: c.i } : null);

// Les articles VENDUS, tels qu'ils figurent sur le ticket : la désignation, la
// quantité, ce qu'on va produire, le prix. Ni le prix unitaire, ni la taxe, ni
// la mention « Taxe 4 % appliquée » — le client lit un total, pas un calcul.
function articlesVente(postes) {
  return postes.map((p) => ({
    designation: vDe(p['Désignation']),
    qte: vDe(p['Quantité']),
    detail: vDe(p['Description de production']),
    prix: vDe(p['Total TTC']),
    supplement: montantNul(vDe(p['Supplément express'])) ? '' : vDe(p['Supplément express']),
    // `ou` ne s'imprime pas : c'est l'adresse d'écriture de chaque valeur, pour
    // l'aperçu qui se corrige sur place. Le supplément express n'y figure pas —
    // il est CALCULÉ par le comptoir, il se corrige par le prix, pas à la main.
    ou: {
      designation: ouDe(p['Désignation']),
      qte: ouDe(p['Quantité']),
      detail: ouDe(p['Description de production']),
      prix: ouDe(p['Total TTC']),
    },
  })).filter((a) => a.designation);
}

// Les BESOINS d'une demande de devis. Rien n'est encore chiffré : ce qui compte
// sur le papier, c'est ce que le client a demandé, pas ce qu'on en fera.
function besoinsDemande(postes) {
  return postes.map((p) => ({
    designation: vDe(p['Désignation']),
    qte: vDe(p['Quantité']),
    detail: [p['Catégorie'], p['Couleur'], p['Production']].map(vDe).filter(Boolean).join(' · '),
    prix: '',
    supplement: '',
    // Le détail d'un besoin est un RÉSUMÉ de trois champs (catégorie, couleur,
    // production) : il ne se réécrit pas d'un bloc. Ce qu'on a à dire à
    // l'atelier sur une demande se met dans le bloc « Pour l'atelier ».
    ou: {
      designation: ouDe(p['Désignation']),
      qte: ouDe(p['Quantité']),
      detail: null,
      prix: null,
    },
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
      // Pas de récapitulatif figé ici : la désignation et la quantité sont des
      // COLONNES de la ligne, la production vit dans la fiche. Le ticket se
      // corrige donc aussi sur un dossier saisi à la main.
      ou: {
        designation: { ou: 'ligne', col: 'product' },
        qte: { ou: 'ligne', col: 'quantity' },
        detail: { ou: 'fiche', cle: 'production' },
        prix: null,
      },
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
    // POUR L'ATELIER — la consigne de production, écrite après coup depuis le
    // planning. Elle ne vient PAS du comptoir : ni la note interne OLDA
    // (« client difficile »), ni les points à contrôler ne la remplissent — ces
    // deux-là restent au dossier de travail. C'est ce qu'un collègue ajoute
    // pour celui qui va produire : « logo poitrine gauche 8 cm », « appeler
    // avant de couper ». Elle s'imprime avec le ticket, dans son propre cadre.
    atelier: texte(f.atelier),
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
  if (t.atelier) out.push(sep, "POUR L'ATELIER", t.atelier);
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

  /* POUR L'ATELIER — un cadre plein, qu'on ne confond avec aucun article.
     Noir sur blanc comme le reste : une imprimante à tickets ne connaît que ça,
     et la charte réserve la couleur aux états. */
  .tk__atelier { padding: 5px 7px; border: 1px solid #000; }
  .tk__atelier-titre { margin: 0 0 3px; font-size: 11px; font-weight: 800;
                       letter-spacing: .08em; text-transform: uppercase; }
  .tk__atelier-txt { margin: 0; font-size: 12px; white-space: pre-line; }

  /* LES CHAMPS DE CORRECTION. Le ticket s'ouvre DÉJÀ modifiable depuis la
     ligne : chaque valeur est un champ, à sa place et dans la police du papier.
     Un trait pointillé dit « ça se tape » sans rien déplacer, et l'impression
     n'en pose aucun (elle n'appelle pas l'éditeur) — le ticket qu'on corrige
     est donc, à la case près, celui qui sort de l'imprimante.
     Les hauteurs confortables ne valent que dans l'aperçu (classe tk--edit) :
     au doigt, sur la tablette du comptoir, une ligne de 12 px ne se vise pas. */
  .tk__champ {
    font: inherit; color: #000; background: transparent;
    border: 0; border-bottom: 1px dashed #8a8f98; border-radius: 0;
    padding: 1px 2px; margin: 0; width: 100%; min-width: 0;
    -webkit-appearance: none; appearance: none;
  }
  .tk__champ::placeholder { color: #9aa0a6; font-style: italic; }
  .tk__champ:focus { outline: 0; border-bottom-color: #000; background: #f0f1f3; }
  .tk--edit .tk__champ { min-height: 34px; }
  .tk--edit .tk__ligne, .tk--edit .tk__total, .tk--edit .tk__paiement { align-items: center; }
  .tk--edit .tk__ligne span:first-child { flex: 0 0 62px; }
  /* La quantité, le prix : deux champs courts sur la même rangée que le nom de
     l'article. Ils gardent une cible d'au moins 44 px de large au doigt. */
  .tk--edit .tk__art-tete { align-items: center; gap: 6px; }
  .tk--edit .tk__art-nom { display: flex; align-items: center; gap: 4px; flex: 1 1 auto; }
  .tk__qte { flex: 0 0 46px; text-align: center; }
  .tk__x { flex: 0 0 auto; }
  .tk--edit .tk__art-prix { flex: 0 0 88px; }
  .tk--edit .tk__art-prix .tk__champ { text-align: right; }
  /* La remise, c'est UNE promesse : le jour et l'heure se lisent côte à côte,
     comme ils s'impriment (« À retirer le 20/08/2026 à 16h30 »). */
  .tk__remise-champs { display: flex; align-items: center; gap: 6px; }
  .tk__jour { flex: 1 1 auto; }
  .tk__heure { flex: 0 0 84px; }
  .tk__euro { display: flex; align-items: center; gap: 3px; flex: 0 0 auto; }
  .tk--edit .tk__total .tk__euro { flex: 0 0 116px; }
  .tk--edit .tk__total .tk__euro .tk__champ { text-align: right; }
  /* Le paiement tient sur SA ligne : le mode s'étire, « payé » garde sa place.
     Sans borne, la case à cocher sortait du ticket par la droite. */
  .tk__paie { display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0; }
  .tk__paie select { flex: 1 1 auto; min-width: 0; }
  .tk__paye { display: flex; align-items: center; gap: 4px; white-space: nowrap;
              font-size: 11px; }
  .tk__paye input { width: 20px; height: 20px; margin: 0; accent-color: #000; }
  .tk--edit .tk__atelier { padding: 6px 7px; }
  .tk__atelier-txt .tk__champ { resize: vertical; }
  .tk--edit .tk__atelier-txt .tk__champ { min-height: 66px; }

  /* AU DOIGT (la tablette du comptoir, le téléphone). Deux règles de la maison :
     tout champ fait au moins 16 px — en dessous, iOS zoome à la mise au point et
     la page reste décalée ensuite — et toute cible fait au moins 44 px. Le
     ticket s'allonge donc quand on le corrige, et il défile ; le papier, lui, ne
     bouge pas d'un millimètre : il ne porte aucun champ. */
  @media (pointer: coarse) {
    .tk__champ { font-size: 16px; }
    .tk--edit .tk__champ { min-height: 44px; }
    .tk--edit .tk__heure { flex: 0 0 108px; }
    .tk__paye { min-height: 44px; padding: 0 4px; font-size: 12px; }
    .tk__paye input { width: 24px; height: 24px; }
  }
`;

// Le ticket en DOM, dans le document qu'on lui donne — la page pour l'aperçu,
// le cadre d'impression pour le papier. `doc` est explicite : au moment
// d'imprimer, les nœuds doivent naître dans le document du cadre, pas dans
// celui de l'application.
export function dessinerTicket(t, doc, editeur) {
  const el = (tag, cls, txt) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };
  // UNE VALEUR DU TICKET. Sur le papier : du texte. Dans l'aperçu ouvert depuis
  // la ligne : le champ que fabrique `editeur`, à la même place, dans la même
  // police et sous la même classe. `cible` dit OÙ la valeur s'écrit quand elle
  // vient d'un article du récapitulatif (cf. `ou` dans le modèle).
  const val = (cle, txt, cible) => (editeur ? editeur(cle, txt, cible) : el('span', null, txt));
  const duo = (cls, gauche, droite) => {
    const d = el('div', cls);
    d.append(el('span', null, gauche), typeof droite === 'string' ? el('span', null, droite) : droite);
    return d;
  };
  const sep = () => el('hr', 'tk__sep');

  const tk = el('div', editeur ? 'tk tk--edit' : 'tk');
  tk.append(
    el('p', 'tk__nom', 'ATELIER OLDA'),
    el('p', 'tk__lieu', 'Saint-Martin'),
    el('p', 'tk__titre', t.titre),
    sep(),
  );

  // LA RÉFÉRENCE NE SE RETAPE PAS : c'est la clé du dossier (recherche,
  // idempotence de la prise au comptoir). Ce qui se corrige, c'est le numéro du
  // PAPIER que le client a en main quand il ne correspond pas — le seul repère
  // qu'il rapporte au comptoir. Sa ligne n'apparaît sur le papier que si elle
  // est remplie ; en correction, elle est toujours offerte.
  if (t.ref) tk.append(el('div', 'tk__ref', t.ref));
  if (t.refTicket || editeur) {
    const p = el('p', 'tk__note');
    p.append(el('span', null, 'Ticket remis au client : '), val('refTicket', t.refTicket));
    tk.append(p);
  }
  if (t.date) tk.append(el('p', 'tk__note', `Le ${t.date}`));
  tk.append(sep());

  if (t.client || editeur) tk.append(duo('tk__ligne', 'Client', val('client', t.client)));
  if (t.contact || editeur) tk.append(duo('tk__ligne', 'Contact', val('contact', t.contact)));
  if (t.tel || editeur) tk.append(duo('tk__ligne', 'Tél', val('tel', t.tel)));

  if (t.remise || editeur) {
    const p = el('p', 'tk__remise');
    p.append(el('span', null, `${t.remiseLabel} `), val('remise', t.remise));
    tk.append(sep(), p);
  }

  if (t.lignes.length) {
    tk.append(sep());
    for (const a of t.lignes) {
      const art = el('div', 'tk__art');
      const tete = el('div', 'tk__art-tete');
      const nom = el('div', 'tk__art-nom');
      if (editeur) {
        nom.append(
          val('qte', a.qte, a.ou && a.ou.qte),
          el('span', 'tk__x', '×'),
          val('designation', a.designation, a.ou && a.ou.designation),
        );
      } else {
        nom.textContent = `${a.qte ? `${a.qte} × ` : ''}${a.designation}`;
      }
      const prix = el('div', 'tk__art-prix');
      if (editeur) prix.append(val('prix', a.prix, a.ou && a.ou.prix));
      else prix.textContent = a.prix;
      tete.append(nom, prix);
      art.append(tete);
      // CE QU'ON PRODUIT, article par article — la ligne que l'atelier lit en
      // premier. En correction elle est offerte même vide : c'est là qu'on
      // précise un emplacement de logo ou une taille oubliée à la prise.
      if (a.detail || (editeur && a.ou && a.ou.detail)) {
        const det = el('p', 'tk__art-detail');
        if (editeur) det.append(val('detail', a.detail, a.ou.detail));
        else det.textContent = a.detail;
        art.append(det);
      }
      if (a.supplement) art.append(duo('tk__art-sup', 'Supplément express', a.supplement));
      tk.append(art);
    }
  }

  // POUR L'ATELIER — entre ce qu'on produit et ce que ça coûte. Celui qui
  // fabrique lit le panier puis la consigne : il n'a pas à descendre sous le
  // total, ni à retourner le papier, pour savoir ce qu'on attend de lui.
  if (t.atelier || editeur) {
    const box = el('div', 'tk__atelier');
    const txt = el('p', 'tk__atelier-txt');
    txt.append(val('atelier', t.atelier));
    box.append(el('p', 'tk__atelier-titre', "Pour l'atelier"), txt);
    tk.append(sep(), box);
  }

  tk.append(sep(), duo('tk__total', t.totalLabel, val('total', t.total)));
  // Une demande de devis n'encaisse rien : pas de ligne de paiement, pas même
  // un champ pour en poser une.
  if (t.paiement || (editeur && !t.demande)) {
    tk.append(duo('tk__paiement', 'Paiement', val('paiement', t.paiement)));
  }
  tk.append(
    sep(),
    el('p', 'tk__pied', 'Merci pour votre confiance'),
    el('p', 'tk__pied', "L'équipe Atelier OLDA"),
  );
  return tk;
}
