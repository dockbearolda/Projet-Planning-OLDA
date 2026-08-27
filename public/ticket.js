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

// UNE COLONNE `date` NE PASSE PAS PAR UN FUSEAU. Elle ne porte pas d'heure :
// la reconstruire en `Date` lui en invente une (minuit UTC), et l'afficher dans
// le fuseau de l'atelier la fait alors reculer d'un jour. On la découpe.
function dateSeule(iso) {
  const m = String(iso || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
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
  // UNE FACE SANS MESURE RESTE UNE ZONE À MARQUER. Filtrer sur la mesure
  // faisait disparaître du papier toute zone qu'on mesure à l'établi — c'est
  // le cas normal hors textile : les trois faces d'une tasse arrivent nommées
  // et sans largeur. La face disparue, l'atelier ne savait même plus qu'il y
  // avait un fond à marquer. On garde la zone, on laisse la mesure à écrire.
  const logos = (Array.isArray(brut.logos) ? brut.logos : [])
    .map((l, i) => ({
      face: texte(l && l.face),
      // CE QU'ON MARQUE — « Logo client », « QR code vers le site », une phrase
      // à graver. C'est la CONSIGNE, et sur une tasse ou une gravure c'est la
      // seule chose qui fasse produire : la mesure, elle, se prend à l'établi.
      quoi: texte(l && l.quoi),
      mm: texte(l && l.mm),
      ou: { ou: 'prod', liste: 'logos', i },
    }))
    .filter((l) => l.face);
  const p = {
    ref: texte(brut.ref), couleur: texte(brut.couleur), marquage: texte(brut.marquage),
    // LA COULEUR DU MARQUAGE. La clé s'appelle encore `encre` — c'est ce que
    // le comptoir envoie et ce que la base porte, on ne renomme pas un champ
    // stocké pour un mot d'écran. RIEN NE L'AFFICHE SOUS CE NOM (Charlie,
    // 26/08) : à l'écran c'est la couleur DU DTF, et l'intitulé est la
    // technique elle-même.
    encre: texte(brut.encre),
    tailles, logos,
  };
  return p.ref || p.couleur || p.marquage || p.encre || tailles.length || logos.length ? p : null;
}

// LE MARQUAGE — la technique, puis SA COULEUR, et c'est la couleur qui porte la
// graisse : « DTF » tout seul ne dit pas quel rouleau charger. Le mot « encre »
// ne s'écrit nulle part (Charlie, 26/08) ; la clé de la fiche s'appelle encore
// ainsi, on ne renomme pas un champ stocké pour un mot d'écran.
//
// L'INTITULÉ NE VARIE PAS. Mettre la technique en intitulé donnait « DTF » sur
// un dossier et « SÉRIGRAPHIE » sur le suivant : une colonne d'intitulés à
// largeur variable, et la file ne se balaye plus du regard.
function marquageProd(p) {
  if (!p.marquage && !p.encre) return null;
  return { cle: 'Marquage', tech: p.marquage, val: p.encre };
}

// L'IDENTITÉ DE L'ARTICLE : la référence, ce qu'on en fait sortir du stock, et
// combien. La référence et la quantité sont les deux seules choses qu'on
// cherche du regard sur une pile de tickets — elles ont leur propre taille.
function identiteProd(p, a) {
  const qte = texte(a && a.qte);
  const designation = texte(a && a.designation);
  // TOUT ARTICLE N'A PAS DE RÉFÉRENCE. Un textile en a une (elle sort du
  // catalogue) ; une tasse, une gravure, un besoin saisi à la main n'en ont
  // pas — la vendeuse n'a rien à recopier. Le papier affichait alors un tiret
  // de 64 px, c'est-à-dire une barre noire là où l'atelier cherche ce qu'il
  // doit produire. C'est donc la DÉSIGNATION qui prend la place : elle
  // identifie la pièce, ce qu'un tiret ne fera jamais.
  const parRef = Boolean(p.ref);
  return {
    cle: parRef ? 'RÉFÉRENCE' : 'ARTICLE',
    parRef,
    ref: parRef ? p.ref : designation,
    qte: qte ? `${qte} pièce${Number(qte) > 1 ? 's' : ''}` : '',
    // La couleur et la désignation CONFIRMENT qu'on a pris la bonne boîte : on
    // les lit une fois, après avoir trouvé la référence. Quand la désignation
    // EST déjà l'identité, elle ne se répète pas deux centimètres plus bas —
    // la carte ne dit pas deux fois la même chose.
    nom: [p.couleur, parRef ? designation : ''].filter(Boolean).join(' · '),
  };
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
    // QUAND LE CLIENT VIENT LE CHERCHER. C'est la seule date qui fasse
    // ORDONNER le travail : « prise le 26 » ne dit pas quoi faire en premier.
    //
    // `deadline` est une colonne `date`, pas un horodatage : on la découpe en
    // CHAÎNE, sans jamais construire de `Date`. Minuit UTC reformaté en
    // America/Marigot (UTC-4) reculerait d'un jour, et le papier annoncerait un
    // retrait la veille. `dateCreation` reste réservée à `creeLe`, qui est un
    // vrai horodatage et doit, lui, passer par le fuseau de l'atelier.
    retrait: dateSeule(l.deadline),
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
  if (t.retrait) out.push(`Retrait : ${t.retrait}`);
  if (t.lignes.length) {
    out.push(sep);
    for (const a of t.lignes) {
      // AVEC UNE FICHE DE PRODUCTION, l'identité prend la tête : la référence
      // et la quantité d'abord, la couleur et la désignation en confirmation.
      // Sans elle, la ligne garde sa forme d'avant — « 40 x Bâche 2 m ».
      if (a.prod) {
        const p = a.prod;
        const id = identiteProd(p, a);
        out.push([id.ref, id.qte].filter(Boolean).join(' — '));
        if (id.nom) out.push(`  ${id.nom}`);
        const mq = marquageProd(p);
        if (mq) out.push(`  ${mq.cle} : ${[mq.tech, mq.val].filter(Boolean).join(' · ')}`);
        if (p.tailles.length) out.push(`  Tailles : ${p.tailles.map((x) => `${x.n} x ${x.t}`).join('  ')}`);
        // UNE ZONE SANS MESURE RESTE ANNONCÉE. « à mesurer » dit qu'il y a
        // quelque chose à marquer là ; l'omettre laisserait croire qu'il n'y a
        // rien — c'est le fond de la tasse qu'on oublie.
        // LA CONSIGNE D'ABORD, la cote ensuite. « Dos : 300 mm » dit où et
        // combien ; « Face avant : Logo client » dit QUOI — et sans le quoi, il
        // n'y a rien à graver.
        for (const g of p.logos) {
          const dit = [g.quoi, g.mm ? `${g.mm} mm` : ''].filter(Boolean).join(' — ');
          out.push(`  Zone ${g.face} : ${dit || 'à préciser'}`);
        }
      } else {
        out.push(`${a.qte ? `${a.qte} x ` : ''}${a.designation}`);
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
// A4 PORTRAIT (210 x 297 mm), depuis le 26/08. Le ticket était un rouleau de
// caisse de 76 mm — le format de l'écran du comptoir, hérité de la vente. Ce
// papier-ci ne va pas au client : il va à l'établi, il y reste toute la durée
// du travail, on écrit dessus et on le signe. Un rouleau ne porte ni un plan de
// marquage, ni un cadre où noter ce qu'on a mesuré.
//
// ⚠️ CHANGEMENT D'IMPRIMANTE. Une imprimante à tickets ne sort pas de l'A4 :
// ce papier suppose la laser/jet d'encre de l'atelier.
//
// Les trois encres sont celles de la maquette de Charlie. Sur du papier ce sont
// des DENSITÉS D'ENCRE, pas des états : la règle de la charte (« la couleur dit
// un état ») parle de l'écran, où une couleur se lit comme un signal. Ici le
// gris ardoise ne signale rien, il recule un intitulé derrière sa valeur.
export const CSS_TICKET = `
  /* L'ÉCHELLE DU TICKET. Deux tailles PORTENT (la référence et la quantité,
     les deux seuls faits qu'on cherche du regard sur une pile), une taille
     DÉCIDE (mesures, nombres par taille), deux tailles ACCOMPAGNENT. */
  .tk { --tk-encre: #202930; --tk-ardoise: #4A6274; --tk-filet: #ADB8B9;
        --tk-geant: 64px; --tk-titre: 44px; --tk-nombre: 40px; --tk-cle: 25px;
        --tk-fort: 23px; --tk-mes: 18px; --tk-texte: 17px; --tk-note: 15px;
        --tk-etiq: 12px; --tk-cap: 10px;
        width: 210mm; min-height: 297mm; box-sizing: border-box; margin: 0 auto;
        display: flex; flex-direction: column; background: #fff; color: var(--tk-encre);
        font: var(--tk-texte)/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }

  /* LES INTITULÉS. Une seule classe, partout : capitales espacées, gris
     ardoise, petites. Un intitulé ne se lit pas, il se saute — c'est la valeur
     qu'on vient chercher. */
  .tk__cap { font: 500 var(--tk-cap)/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
             letter-spacing: .16em; color: var(--tk-ardoise); }

  .tk__tete { display: flex; align-items: flex-end; justify-content: space-between;
              gap: 24px; padding: 30px 46px 14px; border-bottom: 3px solid var(--tk-encre); }
  .tk__titre { margin: 0; font-size: var(--tk-titre); font-weight: 800; letter-spacing: -.05em;
               line-height: .95; text-transform: uppercase; }
  /* LE COMPTE D'ARTICLES, encadré. Il ne s'affiche QUE si la commande en a
     plusieurs : « 1/1 » n'apprend rien et occuperait le coin de l'oeil que le
     compte réel doit occuper seul. */
  .tk__no { display: flex; align-items: baseline; gap: 6px; padding: 7px 14px;
            border: 1px solid var(--tk-encre); }
  .tk__no-n { font: 700 var(--tk-fort)/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .tk__no-t { font: 400 var(--tk-etiq)/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
              color: var(--tk-ardoise); }

  .tk__qui { display: flex; align-items: flex-end; justify-content: space-between;
             gap: 28px; padding: 16px 46px; border-bottom: 1px solid var(--tk-filet); }
  .tk__client-nom { font-size: var(--tk-cle); font-weight: 800; letter-spacing: -.02em; line-height: 1.1; }
  .tk__champs { display: flex; gap: 28px; }
  .tk__champ-bloc { display: flex; flex-direction: column; gap: 4px; }
  .tk__champ-val { font-size: var(--tk-texte); font-weight: 700; }
  .tk__champ-val--fort { font-weight: 800; }

  .tk__corps { flex: 1; min-height: 0; display: flex; flex-direction: column;
               gap: 18px; padding: 20px 46px 0; }

  /* L'IDENTITÉ DE L'ARTICLE. Référence et quantité en 64 px : ce sont les deux
     choses qu'on cherche sur une pile de papiers, et elles sont seules à cette
     taille. */
  .tk__ident { border: 2px solid var(--tk-encre); }
  .tk__ident-tete { display: flex; align-items: flex-start; justify-content: space-between;
                    gap: 24px; padding: 22px 28px 16px; }
  .tk__ident-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .tk__ident-col--d { align-items: flex-end; }
  .tk__geant { font-size: var(--tk-geant); font-weight: 800; letter-spacing: -.045em;
               line-height: .95; overflow-wrap: anywhere; }
  /* ATTENTION : aucun accent grave ici, il fermerait le gabarit.
     Une DESIGNATION prend la place de la reference quand l'article n'en a pas
     (tasse, gravure, besoin saisi a la main). C'est une phrase, pas un code de
     six signes : a 64 px elle deborde la colonne. Elle prend le cran en
     dessous, qui reste le plus gros caractere de la feuille apres le nombre. */
  .tk__geant--texte { font-size: var(--tk-titre); line-height: 1.02; }
  .tk__ident-qte { display: flex; align-items: baseline; gap: 8px; line-height: .95; }
  .tk__ident-unite { font-size: var(--tk-fort); font-weight: 500; color: var(--tk-ardoise); }
  .tk__ident-nom { margin: 0; padding: 0 28px 18px; font-size: var(--tk-fort); font-weight: 700;
                   letter-spacing: -.01em; line-height: 1.3; }
  .tk__ident-mq { display: flex; align-items: center; justify-content: space-between; gap: 24px;
                  padding: 14px 28px; border-top: 1px solid var(--tk-filet); }
  .tk__ident-mq-v { font-size: var(--tk-fort); font-weight: 800; letter-spacing: -.02em;
                    text-align: right; min-width: 0; overflow-wrap: anywhere; }

  .tk__bloc { display: flex; flex-direction: column; gap: 10px; }
  .tk__bloc-titre { letter-spacing: .18em; }

  /* LES TAILLES ET LES ZONES SONT DEUX AXES INDÉPENDANTS, jamais imbriqués.
     La maquette rangeait la largeur du dos DANS la carte de la taille : ça se
     tient pour un t-shirt et ça ne veut rien dire pour une tasse, qui a trois
     faces et une seule taille. Deux grilles séparées s'adaptent aux deux. */
  /* LA GRILLE COMPTE SES COLONNES TOUTE SEULE. Le nombre de tailles et le
     nombre de zones changent d'un article à l'autre : les poser en style EN
     LIGNE obligeait le rendu à connaître la largeur du papier, et rendait le
     ticket indessinable hors navigateur (les tests le dessinent dans un DOM
     minimal, sans propriete style). auto-fit fait le calcul en CSS : une zone
     occupe toute la laize, six se rangent en deux rangs.
     ATTENTION : aucun accent grave ici, il terminerait le gabarit. */
  .tk__grille { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(76px, 1fr)); }
  /* LES ZONES TIENNENT SUR UN SEUL RANG jusqu'à six. À 150 px de large minimum,
     un vetement marque a six emplacements passait a DEUX rangs et la feuille
     sortait a 311 mm — un second papier presque vide, que l'atelier perd.
     A 104 px, les six tiennent sur un rang et la feuille retombe a 297 mm.
     Deux zones occupent toujours toute la laize : c'est 1fr qui repartit. */
  .tk__grille--zones { grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); }
  .tk__bloc--infos { flex: 1; min-height: 0; }
  .tk__case { border: 1.5px solid var(--tk-encre); overflow: hidden; }
  .tk__case-k { padding: 6px 0; text-align: center; border-bottom: 1px solid var(--tk-filet);
                font: 600 var(--tk-etiq)/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                letter-spacing: .2em; color: var(--tk-ardoise); overflow-wrap: anywhere; }
  .tk__case-v { padding: 12px 0; text-align: center; font-size: var(--tk-nombre); font-weight: 800;
                letter-spacing: -.04em; line-height: 1; }
  /* LA MESURE D'UNE ZONE, quand elle change d'une taille à l'autre : une ligne
     par taille, reliée à sa mesure. Sur NS300 le dos va de 240 mm en XS à 320 en
     XL — un seul chiffre enverrait trois pièces sur quatre au mauvais fichier. */
  /* LA CONSIGNE : ce qu'il y a a marquer sur cette face. Elle se LIT, donc
     elle prend le corps de lecture et non celui des nombres — un nom de logo
     en 40 px deborderait de sa carte des le deuxieme mot. */
  .tk__quoi { padding: 10px 10px 6px; text-align: center;
              font-size: var(--tk-texte); font-weight: 700; line-height: 1.25;
              overflow-wrap: anywhere; }
  .tk__mes { display: flex; align-items: center; justify-content: space-between; gap: 6px;
             padding: 6px 12px; border-top: 1px dotted var(--tk-filet); }
  .tk__mes-v { display: flex; align-items: baseline; gap: 3px; }
  .tk__mes-n { font-size: var(--tk-mes); font-weight: 800; letter-spacing: -.02em; }
  /* UNE ZONE SANS MESURE N'EST PAS UNE ZONE VIDE : c'est une mesure à prendre.
     Elle sort donc avec un trait pour l'écrire, pas avec un blanc. */
  .tk__aecrire { display: block; margin: 14px 12px 12px; border-bottom: 1px solid var(--tk-encre); height: 22px; }
  .tk__aecrire-k { display: block; padding: 0 12px 10px; text-align: center; }

  /* LE CADRE À ÉCRIRE ABSORBE, IL NE POUSSE PAS. Avec un plancher de 250 px il
     s'ajoutait aux blocs du dessus au lieu de prendre ce qui reste : un ticket
     textile (deux grilles) sortait à 324 mm et partait sur une SECONDE feuille
     presque vide — mesuré le 26/08. Il n'a donc plus de hauteur minimale : il
     est le seul bloc élastique de la page, et c'est lui qui fait tomber la
     feuille sur 297 mm pile. */
  .tk__infos { flex: 1; min-height: 0; padding: 14px 24px 16px; border: 1.5px solid var(--tk-encre);
               background-image: repeating-linear-gradient(to bottom, transparent 0, transparent 35px, var(--tk-filet) 35px, var(--tk-filet) 36px);
               background-position: 0 8px; background-clip: content-box; white-space: pre-line; }

  .tk__conformite { display: flex; align-items: center; gap: 18px; margin: 18px 46px 20px;
                    padding: 14px 18px; border: 1.5px solid var(--tk-encre); }
  .tk__case-a-cocher { flex: none; width: 24px; height: 24px; border: 1.5px solid var(--tk-encre); }
  .tk__conformite-txt { font-size: var(--tk-note); font-weight: 500; line-height: 1.35; }

  .tk__pied { display: flex; align-items: center; justify-content: space-between; gap: 24px;
              padding: 14px 46px 24px; border-top: 1px dashed var(--tk-encre); }
  .tk__pied-fort { font-weight: 700; color: var(--tk-encre); }

  /* UN ARTICLE PAR FEUILLE. Sans ça, deux tickets d'une même commande se
     suivent sur la même page et l'établi en perd un. */
  .tk + .tk { break-before: page; page-break-before: always; }

  /* EN CORRECTION, un champ garde exactement la place et le dessin du texte
     qu'il remplace : le papier ne doit pas se réorganiser quand on l'ouvre. */
  .tk__champ { font: inherit; color: inherit; letter-spacing: inherit; line-height: inherit;
               background: none; border: 0; border-bottom: 1px dotted var(--tk-ardoise);
               padding: 0; margin: 0; min-width: 0; width: 100%; }
  .tk--edit .tk__case-v .tk__champ, .tk--edit .tk__mes-n .tk__champ { text-align: center; }
  .tk__champ:focus { outline: 2px solid var(--tk-encre); outline-offset: 2px; }
`;

// LES MESURES D'UNE ZONE. Le comptoir envoie soit une largeur unique (« 260 »),
// soit une largeur PAR TAILLE quand elle change (« S 260/M 280/L 300 ») — sur
// 76 mm il n'y avait pas la place de faire autrement. On la redéploie ici :
// une ligne par taille, chacune reliée à sa mesure.
//
// Une chaîne vide ne rend pas une liste vide « par erreur » : c'est le cas
// NORMAL hors textile, et il a son propre dessin (un trait pour écrire).
function mesuresDeFace(mm) {
  const brut = String(mm == null ? '' : mm).trim();
  if (!brut) return [];
  if (brut.indexOf('/') < 0) return [{ t: '', mm: brut }];
  return brut.split('/').map((part) => {
    const m = part.trim().match(/^(.*\S)\s+(\S+)$/);
    return m ? { t: m[1], mm: m[2] } : { t: '', mm: part.trim() };
  });
}

// UNE TAILLE QUI NE DISTINGUE RIEN NE S'IMPRIME PAS. « Taille unique » occupe
// une colonne entière pour ne rien apprendre — la quantité est déjà écrite en
// 64 px juste au-dessus. « XL » tout seul, lui, dit quelle boîte ouvrir : on le
// garde. On ne retire donc que les libellés qui SONT le mot « unique ».
const TAILLE_MUETTE = /^(taille\s+)?unique$|^tu$|^[-—]$/i;
function taillesParlantes(tailles) {
  if (tailles.length === 1 && TAILLE_MUETTE.test(tailles[0].t)) return [];
  return tailles;
}

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
  const cap = (txt, cls) => el('div', cls ? 'tk__cap ' + cls : 'tk__cap', txt);
  const champ = (label, valeur, cle, fort) => {
    const b = el('div', 'tk__champ-bloc');
    const v = el('div', 'tk__champ-val' + (fort ? ' tk__champ-val--fort' : ''));
    if (editeur && cle) v.append(val(cle, valeur));
    else v.textContent = valeur || '—';
    b.append(cap(label), v);
    return b;
  };

  const tk = el('div', editeur ? 'tk tk--edit' : 'tk');

  // L'EN-TÊTE. Pas de marque, pas d'adresse : ce papier ne sort jamais de
  // l'atelier, personne n'a besoin qu'il rappelle le nom de la maison où il est
  // lu. La référence du dossier ne s'imprime pas non plus en tête — elle ne fait
  // rien produire ; elle revient au pied, là où on la cherche pour classer.
  const tete = el('header', 'tk__tete');
  tete.append(el('h1', 'tk__titre', t.titre));
  // CE PAPIER NE FAIT PAS TOUTE LA COMMANDE. Un compte, pas un identifiant :
  // sans lui, l'atelier finit son article et emballe en croyant avoir fini.
  if (t.lot) {
    const no = el('div', 'tk__no');
    no.append(cap('NO.'), el('span', 'tk__no-n', String(t.lot.rang)),
      el('span', 'tk__no-t', '/' + t.lot.total));
    tete.append(no);
  }
  tk.append(tete);

  // POUR QUI, ET POUR QUAND. Le nom porte la taille ; le reste sert quand
  // quelque chose cloche — « appeler avant de couper » ne sert à rien sans le
  // numéro. La date de RETRAIT est la seule qui fasse ordonner le travail.
  const qui = el('div', 'tk__qui');
  const gauche = el('div', 'tk__ident-col');
  const nomClient = el('div', 'tk__client-nom');
  if (editeur) nomClient.append(val('client', t.client));
  else nomClient.textContent = t.client || '—';
  gauche.append(cap('CLIENT'), nomClient);
  const champs = el('div', 'tk__champs');
  champs.append(
    champ('CONTACT', t.contact, 'contact'),
    champ('TÉL', t.tel, 'tel'),
    champ('DATE DE RETRAIT', t.retrait, null, true),
  );
  qui.append(gauche, champs);
  tk.append(qui);

  const corps = el('main', 'tk__corps');
  for (const a of t.lignes) {
    if (a.prod) blocsProduction(a.prod, a);
    else corps.append(teteArticle(a));
    // La précision de vive voix. En correction elle est offerte même vide :
    // c'est là qu'on note ce qui n'entre dans aucune case.
    if (a.detail || (editeur && a.ou && a.ou.detail)) {
      const det = el('p', 'tk__ident-nom');
      if (editeur) det.append(val('detail', a.detail, a.ou.detail));
      else det.textContent = a.detail;
      corps.append(det);
    }
  }

  // CE QU'ON ÉCRIT À L'ÉTABLI. Le cadre est réglé, pas vide : un rectangle nu
  // ne se remplit pas, des lignes si. C'est là que finit ce qui n'entre dans
  // aucune case — et c'est la moitié du travail d'un atelier.
  const infos = el('div', 'tk__bloc tk__bloc--infos');
  infos.append(cap('INFORMATIONS', 'tk__bloc-titre'), el('div', 'tk__infos'));
  corps.append(infos);
  tk.append(corps);

  // LA SIGNATURE DE CONFORMITÉ. Elle n'existait pas sur le rouleau : on ne
  // signe pas un ticket de caisse. Sur ce papier-ci, elle dit que quelqu'un a
  // regardé la pièce avant qu'elle parte — et elle nomme ce quelqu'un par sa
  // main, pas par un champ de plus.
  const conf = el('div', 'tk__conformite');
  const txt = el('div', 'tk__ident-col');
  txt.append(cap('CONTRÔLE DE CONFORMITÉ', 'tk__bloc-titre'),
    el('div', 'tk__conformite-txt',
      'Je certifie que l’article a été réalisé et vérifié, et qu’il est conforme à la demande.'));
  conf.append(el('span', 'tk__case-a-cocher'), txt);
  tk.append(conf);

  // LE PIED porte ce qui ne fait pas produire : quand la commande a été prise,
  // et de quel dossier ce papier parle — pour le reclasser, pas pour le faire.
  const pied = el('footer', 'tk__pied');
  const g = el('div', 'tk__cap');
  // Aucun nœud de texte nu : le ticket se dessine aussi hors navigateur (les
  // tests le rendent dans un DOM minimal, et c'est cette portabilité qui permet
  // de vérifier le papier sans ouvrir Chrome). Tout passe par un élément.
  if (t.date) g.append(el('span', null, 'COMMANDE PRISE LE '), el('span', 'tk__pied-fort', t.date));
  // À DROITE, DE QUOI RECONNAÎTRE UNE FEUILLE ISOLÉE — la référence de
  // l'ARTICLE, celle qu'on va chercher au stock, jamais celle du DOSSIER.
  // La clé du dossier ne s'imprime pas : ce papier va à l'établi, pas au
  // classement, et un identifiant de dossier n'y fait rien produire.
  const article = t.lignes.find((x) => x.prod && x.prod.ref);
  const d = el('div', 'tk__cap');
  d.textContent = [article ? article.prod.ref : '',
    t.lot ? t.lot.rang + '/' + t.lot.total : ''].filter(Boolean).join(' · ');
  pied.append(g, d);
  tk.append(pied);
  return tk;

  // La tête d'un article SANS fiche de production : « 40 × Bâche 2 m ». Une
  // ligne créée à la main dans la grille n'a pas de panier : le papier porte
  // alors ce que la ligne sait. Mieux qu'un papier vide.
  function teteArticle(a) {
    const boite = el('div', 'tk__ident');
    const tete2 = el('div', 'tk__ident-tete');
    const cg = el('div', 'tk__ident-col');
    const nom = el('div', 'tk__geant');
    if (editeur) nom.append(val('designation', a.designation, a.ou && a.ou.designation));
    else nom.textContent = a.designation;
    cg.append(cap('ARTICLE'), nom);
    const cd = el('div', 'tk__ident-col tk__ident-col--d');
    const q = el('div', 'tk__ident-qte');
    if (editeur) q.append(el('span', 'tk__geant', ''), val('qte', a.qte, a.ou && a.ou.qte));
    else q.append(el('span', 'tk__geant', a.qte || ''));
    q.append(el('span', 'tk__ident-unite', 'pièces'));
    cd.append(cap('QUANTITÉ'), q);
    tete2.append(cg, cd);
    boite.append(tete2);
    return boite;
  }

  // --- L'ARTICLE, EN TROIS BLOCS QUI S'ADAPTENT À LUI ---------------------
  // 1. son identité (toujours), 2. ses tailles (si elles distinguent quelque
  // chose), 3. ses zones de marquage (autant que l'article en a).
  function blocsProduction(p, a) {
    const id = identiteProd(p, a);

    const boite = el('div', 'tk__ident');
    const tete2 = el('div', 'tk__ident-tete');
    const cg = el('div', 'tk__ident-col');
    // Une désignation est une PHRASE, pas un code de six signes : à 64 px elle
    // déborde. Elle prend donc le cran en dessous, qui reste le plus gros
    // caractère de la feuille après la quantité.
    const identite = el('div', 'tk__geant' + (id.parRef ? '' : ' tk__geant--texte'));
    if (!id.parRef && editeur) identite.append(val('designation', a.designation, a.ou && a.ou.designation));
    else identite.textContent = id.ref || '—';
    cg.append(cap(id.cle), identite);
    const cd = el('div', 'tk__ident-col tk__ident-col--d');
    const q = el('div', 'tk__ident-qte');
    if (editeur) {
      const n = el('span', 'tk__geant');
      n.append(val('qte', a.qte, a.ou && a.ou.qte));
      q.append(n);
    } else {
      q.append(el('span', 'tk__geant', String(a.qte || '')));
    }
    q.append(el('span', 'tk__ident-unite', Number(a.qte) > 1 ? 'pièces' : 'pièce'));
    cd.append(cap('QUANTITÉ'), q);
    tete2.append(cg, cd);
    boite.append(tete2);

    // La couleur de l'article et sa désignation CONFIRMENT qu'on a pris la
    // bonne boîte : on les lit une fois, après avoir trouvé la référence.
    if (editeur && id.parRef) {
      const nom = el('p', 'tk__ident-nom');
      if (p.couleur) nom.append(el('span', null, p.couleur + ' · '));
      nom.append(val('designation', a.designation, a.ou && a.ou.designation));
      boite.append(nom);
    } else if (id.nom) {
      boite.append(el('p', 'tk__ident-nom', id.nom));
    }

    // CE QU'ON CHARGE DANS LA MACHINE — la technique, puis SA COULEUR, et c'est
    // la couleur qui porte la graisse : « DTF » tout seul ne dit pas quel
    // rouleau charger. L'intitulé, lui, ne varie jamais.
    const mq = marquageProd(p);
    if (mq) {
      const rang = el('div', 'tk__ident-mq');
      rang.append(cap(mq.cle.toUpperCase(), 'tk__bloc-titre'),
        el('div', 'tk__ident-mq-v', [mq.tech, mq.val].filter(Boolean).join(' · ')));
      boite.append(rang);
    }
    corps.append(boite);

    // 2. LES TAILLES — une colonne par taille, le nombre dessous. Jamais en
    //    phrase : « 6 × S · 10 × M · 6 × L » se lit de travers dès qu'on est
    //    pressé, et une taille mal lue coûte une réimpression.
    const tailles = taillesParlantes(p.tailles);
    if (tailles.length) {
      const bloc = el('div', 'tk__bloc');
      bloc.append(cap('TAILLES', 'tk__bloc-titre'));
      const grille = el('div', 'tk__grille');
      for (const x of tailles) {
        const c = el('div', 'tk__case');
        const v = el('div', 'tk__case-v');
        v.append(val('prod-taille', x.n, x.ou));
        c.append(el('div', 'tk__case-k', x.t), v);
        grille.append(c);
      }
      bloc.append(grille);
      corps.append(bloc);
    }

    // 3. LES ZONES DE MARQUAGE — une carte par face, quel que soit son nom.
    //    C'EST LE BLOC QUI ADAPTE LE PAPIER À L'ARTICLE : six faces pour un
    //    t-shirt, trois pour une tasse (les deux flancs et le fond), une pour
    //    une casquette, deux pour un couteau gravé. Aucune famille n'est écrite
    //    en dur ici — les faces viennent du dossier, et le dossier les tient de
    //    la table des tailles de logo, que Charlie remplit dans le CRM.
    if (p.logos.length) {
      const bloc = el('div', 'tk__bloc');
      bloc.append(cap('ZONES DE MARQUAGE', 'tk__bloc-titre'));
      const grille = el('div', 'tk__grille tk__grille--zones');
      for (const zone of p.logos) {
        const c = el('div', 'tk__case');
        c.append(el('div', 'tk__case-k', zone.face));
        // CE QU'ON MARQUE, en tête de la carte. Sur un textile la case reste
        // vide (la largeur suffit, le fichier est au catalogue) ; sur une tasse
        // ou une gravure c'est TOUT le travail, et ça passe donc avant la cote.
        if (zone.quoi) c.append(el('div', 'tk__quoi', zone.quoi));
        const mesures = mesuresDeFace(zone.mm);
        if (zone.quoi && !mesures.length) {
          // Une consigne sans cote se suffit : l'atelier sait quoi graver et
          // décide de la taille sur la pièce. Pas de trait vide sous le texte —
          // un trait qui ne demande rien finit par être rempli de n'importe quoi.
        } else if (!mesures.length) {
          // ZONE À MESURER À L'ÉTABLI. Un trait, pas un blanc : un blanc ne se
          // remplit pas. En correction, c'est le champ lui-même qui prend la
          // place du trait — la mesure prise revient alors au dossier.
          if (editeur) {
            const v = el('div', 'tk__case-v');
            v.append(val('prod-logo', '', zone.ou));
            c.append(v);
          } else {
            c.append(el('span', 'tk__aecrire'), cap('mm', 'tk__aecrire-k'));
          }
        } else if (mesures.length === 1 && !mesures[0].t) {
          const v = el('div', 'tk__case-v');
          if (editeur) v.append(val('prod-logo', zone.mm, zone.ou));
          else v.append(el('span', null, mesures[0].mm));
          c.append(v, cap('mm', 'tk__aecrire-k'));
        } else if (editeur) {
          // En correction on réécrit la CHAÎNE telle que le comptoir l'a
          // composée : la découper en champs par taille écrirait quatre valeurs
          // dans une case qui n'en attend qu'une.
          const v = el('div', 'tk__case-v');
          v.append(val('prod-logo', zone.mm, zone.ou));
          c.append(v);
        } else {
          for (const m of mesures) {
            const r = el('div', 'tk__mes');
            const vv = el('span', 'tk__mes-v');
            vv.append(el('span', 'tk__mes-n', m.mm), cap('mm'));
            r.append(cap(m.t), vv);
            c.append(r);
          }
        }
        grille.append(c);
      }
      bloc.append(grille);
      corps.append(bloc);
    }
  }
}
