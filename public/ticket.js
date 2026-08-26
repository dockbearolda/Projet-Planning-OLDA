// ===========================================================================
// LE TICKET DE L'ATELIER — celui qui part avec le dossier à l'établi
// ===========================================================================
// La ligne du planning sortait le ticket du CLIENT : son papier, ses prix, son
// total, son mode de règlement. Or ON NE REMET AUCUN TICKET AU CLIENT — le
// papier qui sort au comptoir suit le travail jusqu'à l'établi. C'est celui-là
// qu'on doit pouvoir ressortir depuis le planning : quoi produire, combien,
// pour quand, pour qui, et ce qu'il faut savoir avant de couper.
//
// CE TICKET NE PORTE PAS D'ARGENT. Ni prix d'article, ni supplément, ni total,
// ni paiement : l'établi n'a rien à en faire, et une feuille qui traîne sur un
// plan de travail n'a pas à annoncer ce que le client a payé. Tout ça reste sur
// la ligne du planning et dans la fiche, où ça se corrige déjà.
//
// DEUX SOURCES, DEUX RÔLES :
//   - la LIGNE (`r`) fait foi pour ce qui se corrige après la vente — le nom du
//     client, la personne à joindre, la date de retrait, l'heure.
//   - la FICHE (`r.fiche`) fait foi pour ce qui a été VENDU : le détail article
//     par article, figé à la création et jamais retouché.
//
// LE TICKET SE CORRIGE. Une quantité fausse, une consigne oubliée, une taille
// qu'on précise à la dernière minute : ça se rattrape sur la ligne du planning,
// dans le ticket lui-même (cf. `dessinerTicket(t, doc, editeur)`). Le modèle
// porte donc, pour chaque valeur, l'ADRESSE où elle se réécrit — colonne de la
// ligne, clé de la fiche, ou position dans le récapitulatif du comptoir.
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

// La date civile de l'ATELIER (Saint-Martin, UTC−4). `creeLe` est un instant
// UTC : à 20 h 30 au comptoir, un affichage naïf le daterait du lendemain — et
// le ticket réimprimé ne porterait plus la date de la prise.
const JOUR_ATELIER = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'America/Marigot', day: '2-digit', month: '2-digit', year: 'numeric',
});

function dateCreation(iso) {
  const d = new Date(String(iso || ''));
  return Number.isNaN(d.getTime()) ? '' : JOUR_ATELIER.format(d);
}

// LE TRAVAIL, extrait du récapitulatif du comptoir. Tout ce qui n'est pas un
// poste — le secteur, l'adresse, les totaux, la note interne — reste où il est.
// Les postes se regroupent par NUMÉRO plutôt que par position, pour qu'une
// ligne manquante ne décale pas tout.
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

// LES ARTICLES À PRODUIRE : ce qu'on fabrique, en quelle quantité, et comment.
// Le prix unitaire, le supplément express, la taxe et le total TTC restent au
// dossier — l'établi ne les lit pas.
function articlesVente(postes) {
  return postes.map((p) => ({
    designation: vDe(p['Désignation']),
    qte: vDe(p['Quantité']),
    detail: vDe(p['Description de production']),
    // `ou` ne s'imprime pas : c'est l'adresse d'écriture de chaque valeur, pour
    // l'aperçu qui se corrige sur place.
    ou: {
      designation: ouDe(p['Désignation']),
      qte: ouDe(p['Quantité']),
      detail: ouDe(p['Description de production']),
    },
  })).filter((a) => a.designation);
}

// Les BESOINS d'une demande de devis. Rien n'est encore décidé, mais l'atelier
// peut avoir à préparer une maquette : ce qui compte, c'est ce que le client a
// demandé — la catégorie, la couleur, le mode de production.
function besoinsDemande(postes) {
  return postes.map((p) => ({
    designation: vDe(p['Désignation']),
    qte: vDe(p['Quantité']),
    detail: [p['Catégorie'], p['Couleur'], p['Production']].map(vDe).filter(Boolean).join(' · '),
    // Le détail d'un besoin est un RÉSUMÉ de trois champs (catégorie, couleur,
    // production) : il ne se réécrit pas d'un bloc. Ce qu'on a à dire à
    // l'atelier sur une demande se met dans le bloc « Pour l'atelier ».
    ou: {
      designation: ouDe(p['Désignation']),
      qte: ouDe(p['Quantité']),
      detail: null,
    },
  })).filter((b) => b.designation);
}

// CE QU'IL Y A À PRODUIRE, tel que le comptoir l'a découpé (`fiche.prod`) :
// référence, couleur, technique, nombre par taille, largeur de logo par face.
// C'est la seule partie du ticket qui décide du FICHIER d'impression et de la
// coupe — elle passe donc devant tout le reste sur le papier.
//
// Les largeurs et les quantités portent leur ADRESSE : ce sont les deux valeurs
// qu'on rectifie à l'établi (« finalement le dos en 300 »), et une rectification
// qui ne vit que sur le papier est perdue au ticket suivant.
function prodDuTicket(brut) {
  if (!brut || typeof brut !== 'object') return null;
  const tailles = (Array.isArray(brut.tailles) ? brut.tailles : [])
    .map((t, i) => ({ t: texte(t && t.t), n: texte(t && t.n), ou: { ou: 'prod', liste: 'tailles', i } }))
    .filter((t) => t.t && t.n);
  const logos = (Array.isArray(brut.logos) ? brut.logos : [])
    .map((l, i) => ({ face: texte(l && l.face), mm: texte(l && l.mm), ou: { ou: 'prod', liste: 'logos', i } }))
    .filter((l) => l.face && l.mm);
  const p = {
    ref: texte(brut.ref), couleur: texte(brut.couleur), marquage: texte(brut.marquage),
    // LA COULEUR DE L'ENCRE ne vit que sur ce papier. Elle n'est pas sur la
    // carte du planning — là on regarde une file, ici on charge un rouleau.
    encre: texte(brut.encre),
    tailles, logos,
  };
  return p.ref || p.couleur || p.marquage || p.encre || tailles.length || logos.length ? p : null;
}

// LA TÊTE DU BLOC DE PRODUCTION : ce qu'on prend dans le stock, de quelle
// couleur, marqué comment et avec quelle encre. « DTF » tout seul ne dit pas
// quel rouleau charger ; « DTF encre Blanc » si.
function teteProd(p) {
  const marquage = [p.marquage, p.encre ? `encre ${p.encre}` : ''].filter(Boolean).join(' ');
  return [p.ref, p.couleur, marquage].filter(Boolean).join(' · ');
}

// LE MODÈLE DU TICKET. Pur : mêmes entrées, mêmes sorties, aucun DOM.
// `r` est une ligne du planning avec sa fiche COMPLÈTE (celle de la liste est
// allégée du détail — voir allegerFiche côté serveur).
export function modeleTicket(r) {
  const l = r && typeof r === 'object' ? r : {};
  const f = l.fiche && typeof l.fiche === 'object' ? l.fiche : {};
  const demande = f.source === 'Demande de devis' || l.order_kind === 'demande';
  const postes = postesDuPanier(f.details);

  // UN PANIER DE QUATRE ARTICLES, C'EST QUATRE LIGNES AU PLANNING — donc quatre
  // papiers, chacun pour son établi. Celui-ci ne parle QUE de son article :
  // imprimer les quatre sur chaque papier ferait annoncer « à retirer le 28/08 »
  // au-dessus de trois articles qui ne sont pas dus ce jour-là, et l'atelier
  // emballerait une commande incomplète en la croyant finie.
  // On ne filtre que si le compte tombe juste : sur un dossier d'avant le
  // découpage, ou dont le récapitulatif ne s'aligne plus, le papier entier vaut
  // mieux qu'un papier arbitrairement amputé.
  const lotT = f.lot && typeof f.lot === 'object' ? f.lot : null;
  const rang = lotT ? Number(lotT.rang) : 0;
  const total = lotT ? Number(lotT.total) : 0;
  const seulPoste = rang >= 1 && total > 1 && postes.length === total;
  const duPoste = seulPoste ? [postes[rang - 1]] : postes;

  // Le détail figé n'existe que sur un dossier du comptoir. Une ligne créée à la
  // main dans la grille n'a pas de panier : son ticket porte alors ce que la
  // ligne sait — la description et la quantité. Mieux qu'un ticket vide.
  const lignes = demande ? besoinsDemande(duPoste) : articlesVente(duPoste);
  if (!lignes.length && texte(l.product)) {
    lignes.push({
      designation: texte(l.product),
      qte: l.quantity == null ? '' : String(l.quantity),
      detail: texte(f.production),
      // Pas de récapitulatif figé ici : la désignation et la quantité sont des
      // COLONNES de la ligne, la production vit dans la fiche. Le ticket se
      // corrige donc aussi sur un dossier saisi à la main.
      ou: {
        designation: { ou: 'ligne', col: 'product' },
        qte: { ou: 'ligne', col: 'quantity' },
        detail: { ou: 'fiche', cle: 'production' },
      },
    });
  }

  // LA FICHE DE PRODUCTION DÉCRIT UN ARTICLE. Elle se pose donc sur la ligne
  // que ce papier concerne — celle du lot, ou l'unique. Quand le papier en
  // porte plusieurs (un dossier que l'argent n'a pas permis de découper), elle
  // ne saurait pas duquel elle parle : on ne l'écrit alors nulle part plutôt
  // que d'annoncer les tailles du premier au-dessus du second.
  const prod = prodDuTicket(f.prod);
  if (prod && lignes.length === 1) {
    lignes[0].prod = prod;
    // LA LIGNE D'UN BESOIN RÉSUMAIT « Catégorie · Couleur · Production » — les
    // trois faits que le bloc de production écrit maintenant en clair, deux
    // centimètres plus bas. Sur un papier de 76 mm, deux fois la même chose
    // c'est une ligne de travail en moins.
    if (demande) lignes[0].detail = '';
  }

  return {
    demande,
    titre: 'Ticket atelier',
    // La référence est LA clé : c'est elle qui relie ce papier au dossier.
    ref: texte(f.ref),
    // « Article 2 sur 4 » — un COMPTE, pas un identifiant : la référence, elle,
    // ne s'imprime toujours pas (voir dessinerTicket). Ce compte-là fait
    // produire : il dit que la commande du client n'est pas complète avec ce
    // seul papier.
    lot: seulPoste ? { rang, total } : null,
    date: dateCreation(f.creeLe),
    // POUR QUI. Le nom sur l'établi, et de quoi joindre quelqu'un : « appeler
    // avant de couper » ne sert à rien sans le numéro.
    client: texte(l.billing_company),
    contact: texte(l.contact_referent),
    tel: texte(l.contact_phone),
    // QUOI ET COMBIEN, avec ce qu'on en fait.
    lignes,
  };
}

// Le ticket en TEXTE — ce que le téléchargement remet, et ce qu'un poste sans
// imprimante recopie. Même contenu que le papier, à la ligne près.
export function ticketTexte(t) {
  const sep = '--------------------------------';
  const out = [t.titre.toUpperCase(), sep];
  if (t.lot) out.push(`ARTICLE ${t.lot.rang} SUR ${t.lot.total} DE LA COMMANDE`);
  if (t.client) out.push(`Client : ${t.client}`);
  if (t.contact) out.push(`Contact : ${t.contact}`);
  if (t.tel) out.push(`Tél : ${t.tel}`);
  if (t.lignes.length) {
    out.push(sep);
    for (const a of t.lignes) {
      out.push(`${a.qte ? `${a.qte} x ` : ''}${a.designation}`);
      // La production d'abord, dans l'ordre du papier : ce qui décide de la
      // coupe et du fichier passe devant la précision de vive voix.
      if (a.prod) {
        const p = a.prod;
        const tete = teteProd(p);
        if (tete) out.push(`  ${tete}`);
        if (p.tailles.length) out.push(`  Tailles : ${p.tailles.map((x) => `${x.n} x ${x.t}`).join('  ')}`);
        for (const g of p.logos) out.push(`  Logo ${g.face} : ${g.mm} mm`);
      }
      if (a.detail) out.push(`  ${a.detail}`);
    }
  }
  // La date de PRISE ne fait pas produire : elle reste au pied, comme sur le
  // papier.
  if (t.date) out.push(sep, `Commande prise le ${t.date}`);
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
  /* L'ÉCHELLE DU TICKET — celle de l'écran du comptoir, moins sa taille de
     titre : le papier n'a plus d'en-tête de marque à habiller.
       fort   = ce qui DÉCIDE et qu'on ne doit pas lire de travers : le nombre
                par taille, la largeur d'un logo. Une taille mal lue coûte une
                réimpression.
       texte  = ce qui se lit : désignations, valeurs.
       note   = les intitulés, le pied. */
  .tk { --tk-fort: 15px; --tk-texte: 13px; --tk-note: 11px;
        width: 76mm; margin: 0 auto; padding: 4mm 0; color: #000;
        font: var(--tk-texte)/1.45 Arial, Helvetica, sans-serif; }
  .tk__titre { margin: 0; font-size: var(--tk-note); font-weight: 800; text-align: center;
               text-transform: uppercase; letter-spacing: .08em; }
  .tk__sep { border: 0; border-top: 1px dashed #000; margin: 7px 0; }
  /* « Article 2 sur 4 » — encadré, parce que c'est l'avertissement qui empêche
     d'emballer une commande incomplète. Noir sur blanc comme tout le reste : une
     imprimante à tickets ne connaît que le noir. */
  .tk__lot { margin: 5px auto 0; padding: 2px 6px; border: 1px solid #000;
             display: table; font-size: var(--tk-note); font-weight: 800;
             text-transform: uppercase; letter-spacing: .04em; }

  /* POUR QUI — intitulé à gauche, valeur à droite. L'intitulé est une étiquette,
     pas une phrase : petites capitales, graisse moyenne. */
  .tk__ligne { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin: 3px 0; }
  .tk__ligne > span:first-child { flex: 0 0 auto; font-size: var(--tk-note); font-weight: 600;
                                  text-transform: uppercase; letter-spacing: .04em; }
  .tk__ligne > span:last-child { text-align: right; font-weight: 600; }

  /* CE QU'ON PRODUIT ------------------------------------------------------ */
  .tk__art { margin: 8px 0 0; }
  .tk__art + .tk__art { margin-top: 12px; padding-top: 8px; border-top: 1px dashed #000; }
  .tk__art-tete { display: flex; gap: 8px; }
  .tk__art-nom { font-size: var(--tk-texte); font-weight: 800; }
  /* La précision de vive voix : elle vient APRÈS les faits de production, elle
     ne les remplace pas. */
  .tk__art-detail { margin: 4px 0 0; font-size: var(--tk-texte); white-space: pre-line; }

  .tk__prod { margin: 4px 0 0; }
  .tk__prod-titre { margin: 6px 0 2px; font-size: var(--tk-note); font-weight: 800;
                    text-transform: uppercase; letter-spacing: .08em; }
  .tk__prod-tete { font-size: var(--tk-texte); font-weight: 600; }

  /* LES TAILLES EN TABLEAU, jamais en phrase. « 6 × S · 10 × M · 6 × L · 2 × XL »
     se lit de travers dès qu'on est pressé : une colonne par taille, le nombre
     dessous, et l'erreur devient difficile. Les colonnes sont ÉGALES — une
     piste qui dépend de son contenu ferait une grille bancale d'un ticket à
     l'autre. */
  .tk__tailles { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
                 border: 1px solid #000; }
  .tk__taille { border-left: 1px solid #000; text-align: center; min-width: 0; }
  .tk__taille:first-child { border-left: 0; }
  .tk__taille-k { font-size: var(--tk-note); font-weight: 600; letter-spacing: .04em;
                  text-transform: uppercase; padding: 1px 2px; border-bottom: 1px solid #000; }
  .tk__taille-v { font-size: var(--tk-fort); font-weight: 800; padding: 2px; }

  /* LES LARGEURS DE LOGO — une face par ligne, reliée à sa mesure par un filet.
     C'est la mise en page d'un bordereau : l'œil suit le trait et ne saute pas
     d'une ligne à l'autre. */
  .tk__logo { display: flex; align-items: baseline; gap: 5px; margin: 2px 0 0; }
  .tk__logo-face { flex: 0 0 auto; font-size: var(--tk-texte); font-weight: 600; }
  .tk__logo-fil { flex: 1 1 auto; align-self: center; border-bottom: 1px dotted #000; }
  .tk__logo-mm { flex: 0 0 auto; font-size: var(--tk-fort); font-weight: 800; white-space: nowrap; }

  /* LE PIED porte ce qui NE FAIT PAS PRODUIRE : la date de prise. Elle était
     en tête, entre l'avertissement de lot et le client — trois lignes de
     contexte avant la première qui dit quoi faire. */
  .tk__pied { margin: 7px 0 0; font-size: var(--tk-note); text-align: center; }

  /* LES CHAMPS DE CORRECTION. Le ticket s'ouvre DÉJÀ modifiable depuis la
     ligne : chaque valeur est un champ, à sa place et dans la police du papier.
     Un trait pointillé dit « ça se tape » sans rien déplacer, et l'impression
     n'en pose aucun (elle n'appelle pas l'éditeur) — le ticket qu'on corrige
     est donc, à la case près, celui qui sort de l'imprimante.
     Les hauteurs confortables ne valent que dans l'aperçu (classe tk--edit) :
     une ligne de 12 px se vise mal à la souris, et le papier n'en porte pas. */
  .tk__champ {
    font: inherit; color: #000; background: transparent;
    border: 0; border-bottom: 1px dashed #8a8f98; border-radius: 0;
    padding: 1px 2px; margin: 0; width: 100%; min-width: 0;
    -webkit-appearance: none; appearance: none;
  }
  .tk__champ::placeholder { color: #9aa0a6; font-style: italic; }
  .tk__champ:focus { outline: 0; border-bottom-color: #000; background: #f0f1f3; }
  .tk--edit .tk__champ { min-height: 34px; }
  .tk--edit .tk__ligne { align-items: center; }
  .tk--edit .tk__ligne > span:first-child { flex: 0 0 62px; }
  /* La quantité : un champ court sur la même rangée que le nom de l'article. */
  .tk--edit .tk__art-tete { align-items: center; gap: 6px; }
  .tk--edit .tk__art-nom { display: flex; align-items: center; gap: 4px; flex: 1 1 auto; }
  .tk__qte { flex: 0 0 46px; text-align: center; }
  .tk__x { flex: 0 0 auto; }
  /* DANS LA GRILLE DES TAILLES ET SUR UNE LARGEUR, le champ ne porte pas de
     trait : la case et le filet du bordereau disent déjà où l'on tape. Sans
     ça, deux traits se superposaient sous chaque nombre. */
  .tk__taille-v .tk__champ, .tk__logo-mm .tk__champ {
    border-bottom: 0; text-align: center; font-weight: 800;
  }
  .tk__logo-mm .tk__champ { text-align: right; }
  .tk--edit .tk__taille-v .tk__champ { min-height: 30px; }
  .tk--edit .tk__logo-mm { flex: 0 0 96px; }
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
  // PAS D'EN-TÊTE DE MARQUE. Ce papier ne sort jamais de l'atelier : personne
  // n'a besoin qu'il rappelle le nom ni la ville de la maison où il est lu.
  tk.append(el('p', 'tk__titre', t.titre));

  // LA RÉFÉRENCE NE S'IMPRIME PAS. Elle reste dans le modèle — le titre de la
  // fenêtre d'impression et le libellé de la carte s'en servent pour dire DE
  // QUEL dossier ce papier parle — mais le papier lui-même va à l'établi, et un
  // identifiant de dossier n'y fait rien produire.
  // CE PAPIER NE FAIT PAS TOUTE LA COMMANDE. Un compte, pas un identifiant :
  // sans lui, l'atelier finit son article et emballe en croyant avoir fini.
  if (t.lot) tk.append(el('p', 'tk__lot', `Article ${t.lot.rang} sur ${t.lot.total} de la commande`));

  // POUR QUI. Le trait de séparation appartient au bloc : sans personne à
  // joindre — une ligne créée à la main, sans société — deux filets se
  // suivaient, et le papier annonçait une section vide.
  const pourQui = [];
  if (t.client || editeur) pourQui.push(duo('tk__ligne', 'Client', val('client', t.client)));
  if (t.contact || editeur) pourQui.push(duo('tk__ligne', 'Contact', val('contact', t.contact)));
  if (t.tel || editeur) pourQui.push(duo('tk__ligne', 'Tél', val('tel', t.tel)));
  if (pourQui.length) tk.append(sep(), ...pourQui);

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
      tete.append(nom);
      art.append(tete);

      // CE QU'IL Y A À PRODUIRE — la référence, la couleur, la technique, le
      // nombre par taille et la largeur de chaque logo. C'est ce qui décide du
      // fichier d'impression et de la coupe : ça passe avant la précision
      // dictée au comptoir, qui vient la compléter.
      if (a.prod) art.append(blocProd(a.prod));

      // La précision de vive voix. En correction elle est offerte même vide :
      // c'est là qu'on note ce qui n'entre dans aucune case.
      if (a.detail || (editeur && a.ou && a.ou.detail)) {
        const det = el('p', 'tk__art-detail');
        if (editeur) det.append(val('detail', a.detail, a.ou.detail));
        else det.textContent = a.detail;
        art.append(det);
      }
      tk.append(art);
    }
  }

  // LE PIED porte ce qui ne fait pas produire : quand la commande a été prise.
  // En tête, cette ligne repoussait d'autant la première qui dit quoi faire.
  if (t.date) tk.append(sep(), el('p', 'tk__pied', `Commande prise le ${t.date}`));
  return tk;

  // --- Le bloc de production, en trois temps -------------------------------
  function blocProd(p) {
    const bloc = el('div', 'tk__prod');
    const tete = teteProd(p);
    if (tete) bloc.append(el('p', 'tk__prod-tete', tete));

    // LES TAILLES EN TABLEAU, jamais en phrase : une colonne par taille, le
    // nombre dessous. « 6 × S · 10 × M · 6 × L · 2 × XL » se lit de travers dès
    // qu'on est pressé, et une taille mal lue coûte une réimpression.
    if (p.tailles.length) {
      bloc.append(el('p', 'tk__prod-titre', 'Tailles'));
      const grille = el('div', 'tk__tailles');
      for (const x of p.tailles) {
        const col = el('div', 'tk__taille');
        const v = el('div', 'tk__taille-v');
        v.append(val('prod-taille', x.n, x.ou));
        col.append(el('div', 'tk__taille-k', x.t), v);
        grille.append(col);
      }
      bloc.append(grille);
    }

    // LES LARGEURS DE LOGO — une face par ligne, reliée à sa mesure par un
    // filet : l'œil suit le trait et ne saute pas d'une ligne à l'autre.
    if (p.logos.length) {
      bloc.append(el('p', 'tk__prod-titre', 'Logos'));
      for (const g of p.logos) {
        const ligne = el('div', 'tk__logo');
        const mm = el('span', 'tk__logo-mm');
        if (editeur) mm.append(val('prod-logo', g.mm, g.ou), el('span', null, ' mm'));
        else mm.textContent = `${g.mm} mm`;
        ligne.append(el('span', 'tk__logo-face', g.face), el('span', 'tk__logo-fil'), mm);
        bloc.append(ligne);
      }
    }
    return bloc;
  }
}
