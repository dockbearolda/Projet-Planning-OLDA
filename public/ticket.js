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

import { JETONS_PAPIER, SOCLE_PAPIER } from './papier.js';

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
export const CSS_TICKET = SOCLE_PAPIER + `
  /* L'ÉCHELLE DU PAPIER — QUATRE CRANS, PAS DIX.
     Le ticket en déclarait dix : 64 / 44 / 40 / 25 / 23 / 18 / 17 / 15 / 12 /
     10. Charlie, 28/08 : « les polices sont démesurées sur le ticket atelier ».
     Dix crans ne font pas une hiérarchie, ils font du désordre — et sur un
     papier d'établi le désordre coûte une réimpression. Il en reste quatre, et
     chacun a UN rôle :
       --tk-geant  ce qu'on cherche du regard sur une pile : la référence et la
                   quantité. Deux faits, une taille, rien d'autre ne la prend.
       --tk-cle    ce qui décide : le client, la date de retrait, le marquage,
                   le nombre par taille, la cote par face.
       --tk-texte  ce qui se lit : les consignes, la désignation, la conformité.
     L'encre, le gris, le filet, la taille des intitulés et la MARGE de la
     feuille ne sont pas ici : ils sont dans papier.js, avec le bon de
     commande, parce que les deux papiers sortent de la même ligne à un clic
     l'un de l'autre. La marge, en particulier, valait 46 px en tête, 46 au
     corps et 24 au cadre de conformité : trois bords gauches sur la même
     feuille, ce qui se voit sans qu'on sache le nommer.
     ATTENTION : aucun accent grave dans ce gabarit, il le terminerait. */
  .tk {${JETONS_PAPIER}
        --tk-geant: 52px; --tk-cle: 24px; --tk-texte: 15px;
        --tk-rang: 31px;
        width: 210mm; min-height: 297mm; box-sizing: border-box; margin: 0 auto;
        display: flex; flex-direction: column; background: #fff; color: var(--pap-encre);
        font: var(--tk-texte)/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }
  .tk * { box-sizing: border-box; }

  /* L'EN-TÊTE DIT DEUX CHOSES : ce qu'est ce papier, et POUR QUAND.
     Le mot « TICKET ATELIER » sortait à 44 px — le plus gros caractère de la
     feuille pour le seul mot qui ne fait rien produire : tous les tickets
     d'atelier portent ce titre. La place qu'il prenait revient à la date de
     retrait, qui est la seule chose qui fasse ORDONNER le travail sur une pile. */
  .tk__tete { display: flex; align-items: center; justify-content: space-between;
              gap: 24px; padding: 22px var(--pap-marge) 14px; border-bottom: 3px solid var(--pap-encre); }
  .tk__tete-g { display: flex; align-items: center; gap: 12px; }
  .tk__titre { margin: 0; font-size: var(--tk-cle); font-weight: 800; letter-spacing: -.02em;
               line-height: 1; text-transform: uppercase; }
  /* LE COMPTE D'ARTICLES ne s'affiche QUE si la commande en a plusieurs :
     « 1/1 » n'apprend rien et occuperait le coin de l'oeil que le compte réel
     doit occuper seul. */
  .tk__no { display: flex; align-items: baseline; gap: 5px; padding: 5px 10px;
            border: 1px solid var(--pap-encre); }
  .tk__no-n { font: 700 var(--tk-texte)/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .tk__no-t { font: 400 var(--pap-cap)/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
              color: var(--pap-ardoise); }
  /* LA DATE DE RETRAIT, en tête et à droite. Elle ne revient jamais à la ligne :
     une date coupée en deux ne se lit plus. */
  .tk__quand { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
  .tk__quand-v { font-size: var(--tk-cle); font-weight: 800; letter-spacing: -.02em;
                 line-height: 1; white-space: nowrap; }

  .tk__qui { display: flex; align-items: flex-end; justify-content: space-between;
             gap: 24px; padding: 14px var(--pap-marge); border-bottom: 1px solid var(--pap-filet); }
  .tk__client-nom { font-size: var(--tk-cle); font-weight: 800; letter-spacing: -.02em; line-height: 1.1; }
  .tk__champs { display: flex; gap: 26px; }
  .tk__champ-bloc { display: flex; flex-direction: column; gap: 3px; }
  .tk__champ-val { font-size: var(--tk-texte); font-weight: 700; }

  .tk__corps { flex: 1; min-height: 0; display: flex; flex-direction: column;
               gap: 14px; padding: 16px var(--pap-marge) 0; }

  /* L'IDENTITÉ DE L'ARTICLE. La référence et la quantité sont les deux seules
     choses qu'on cherche sur une pile de papiers, et elles sont seules à cette
     taille. */
  .tk__ident { border: 2px solid var(--pap-encre); }
  .tk__ident-tete { display: flex; align-items: flex-start; justify-content: space-between;
                    gap: 20px; padding: 16px 24px 12px; }
  .tk__ident-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  /* LA COLONNE DE LA QUANTITÉ NE SE COMPRIME PAS. Elle était élastique comme
     celle de gauche : sur « Tasse céramique 350 ml », la désignation prenait
     toute la place et le nombre 60 se cassait en DEUX LIGNES, un 6 au-dessus
     d'un 0 — mesuré le 28/08, sur les deux jeux d'essai. Le nombre passe donc
     avant le texte : il garde sa largeur, et c'est la phrase qui s'enroule. */
  .tk__ident-col--d { align-items: flex-end; flex: 0 0 auto; }
  .tk__geant { font-size: var(--tk-geant); font-weight: 800; letter-spacing: -.045em;
               line-height: .95; }
  /* UNE RÉFÉRENCE peut se couper (c'est un code, pas une phrase) ; un NOMBRE,
     jamais. Le point de coupure vit donc sur la référence seule. */
  .tk__ident-col .tk__geant { overflow-wrap: anywhere; }
  .tk__ident-qte, .tk__ident-qte .tk__geant { white-space: nowrap; overflow-wrap: normal; }
  /* UNE DÉSIGNATION prend la place de la référence quand l'article n'en a pas
     (tasse, gravure, besoin saisi à la main). C'est une phrase, pas un code de
     six signes : elle prend le cran des valeurs qui décident, où elle tient sur
     une ligne au lieu de deux. */
  .tk__geant--texte { font-size: var(--tk-cle); line-height: 1.15; }
  .tk__ident-qte { display: flex; align-items: baseline; gap: 6px; line-height: .95; }
  .tk__ident-unite { font-size: var(--tk-texte); font-weight: 500; color: var(--pap-ardoise); }
  /* 26 ET NON 24 : la boîte d'identité porte un trait de 2 px que cette ligne
     n'a pas. À rembourrage égal, les deux textes ne tombent pas au même endroit
     — deux pixels, c'est trop peu pour être une hiérarchie et bien assez pour
     se voir. */
  .tk__ident-nom { margin: 0; padding: 0 26px 14px; font-size: var(--tk-texte); font-weight: 700;
                   line-height: 1.3; }
  .tk__ident-mq { display: flex; align-items: center; justify-content: space-between; gap: 20px;
                  padding: 10px 24px; border-top: 1px solid var(--pap-filet); }
  .tk__ident-mq-v { font-size: var(--tk-cle); font-weight: 800; letter-spacing: -.02em;
                    text-align: right; min-width: 0; overflow-wrap: anywhere; }

  .tk__bloc { display: flex; flex-direction: column; gap: 8px; }
  .tk__bloc-titre { letter-spacing: .18em; }

  /* LE TABLEAU DE PRODUCTION — LA TAILLE EN COLONNE, CE QU'ON EN FAIT EN LIGNE.
     Il y avait TROIS dessins pour un seul geste : une grille pour les
     quantités, une liste de cotes en colonne dans la carte du dos, et un bloc
     de cartes pour les autres faces. Neuf classes et deux grilles pour dire ce
     qu'une ligne par face dit maintenant. Ce qui les habillait est parti avec
     elles — une feuille de style qui décrit un bloc absent finit par le faire
     réapparaître.
     Un TABLEAU et non une grille : les colonnes doivent faire la même largeur
     quel que soit leur nombre, et table-layout: fixed le fait sans que le rendu
     ait à compter quoi que ce soit — donc sans style en ligne, donc en restant
     dessinable hors navigateur.
     Elle ne s'appelle pas « tailles » : ce nom a désigné, jusqu'au 26/08, la
     PHRASE que Charlie a fait retirer (« 6 x S · 10 x M · 6 x L »), et un
     garde-fou veille à ce qu'elle ne revienne pas. Deux choses différentes ne
     partagent pas un nom. */
  .tk__matrice { width: 100%; border-collapse: collapse; table-layout: fixed; }
  /* LA COLONNE DES INTITULÉS porte le nom de la face ET ce qu'on y marque :
     sur une tasse ou une gravure, la consigne est tout le travail, et elle doit
     rester collée à la face qu'elle concerne. D'où sa largeur. */
  .tk__matrice-col-k { width: 46mm; }
  .tk__matrice th, .tk__matrice td { border: 1.5px solid var(--pap-encre); }
  /* Le coin haut-gauche ne porte rien : lui donner un cadre fabriquerait une
     case vide, c'est-à-dire une case qu'on cherche à remplir. */
  .tk__matrice-coin { border: 0; }
  .tk__matrice-t { padding: 5px 4px; text-align: center; text-transform: uppercase;
                   font: 600 var(--pap-cap)/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                   letter-spacing: .16em; color: var(--pap-ardoise); overflow-wrap: anywhere; }
  .tk__matrice-k { padding: 7px 10px; text-align: left; vertical-align: middle; }
  .tk__matrice-nom { font: 600 var(--pap-cap)/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                     letter-spacing: .16em; color: var(--pap-ardoise); overflow-wrap: anywhere; }
  /* Le nom d'une face vient du dossier, il arrive dans la casse de la vendeuse.
     Ici c'est un INTITULÉ, il prend les capitales des autres — mais l'unité qui
     le suit reste en minuscules : mm ne s'écrit pas « MM ». */
  .tk__matrice-face { text-transform: uppercase; }
  .tk__matrice-u { margin-left: 5px; }
  /* CE QU'ON MARQUE SUR CETTE FACE. Ça se LIT, donc ça prend le corps de
     lecture et non celui des nombres — un nom de logo au cran des cotes
     déborderait de sa colonne dès le deuxième mot. */
  .tk__matrice-quoi { margin-top: 3px; font-size: var(--tk-texte); font-weight: 700;
                      line-height: 1.25; color: var(--pap-encre); overflow-wrap: anywhere; }
  .tk__matrice-v { padding: 7px 6px; text-align: center; font-size: var(--tk-cle);
                   font-weight: 800; letter-spacing: -.03em; line-height: 1.1; }
  /* En correction, la ligne d'une face porte UN champ pour toute la chaîne : le
     comptoir la compose d'un bloc, la découper ferait écrire cinq fois dans une
     case qui n'en attend qu'une. */
  .tk__matrice-v--libre { text-align: left; padding-left: 10px; font-size: var(--tk-texte); }
  /* CE QUE LA VENDEUSE A ÉCRIT SUR CETTE FACE, quand il n'y a pas de cote à
     lire. Ça se LIT, donc ça prend le corps de lecture et non celui des
     nombres : un nom de logo au cran des cotes déborderait de sa cellule dès le
     deuxième mot. */
  .tk__matrice-v--texte { text-align: left; padding-left: 12px; font-size: var(--tk-texte);
                          font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
  /* UNE FACE SANS COTE N'EST PAS UNE FACE VIDE : c'est une mesure à prendre.
     Elle sort donc avec un trait pour l'écrire, pas avec un blanc — un blanc ne
     se remplit pas. */
  .tk__aecrire { display: block; width: 100%; border-bottom: 1px solid var(--pap-encre); height: 20px; }

  .tk__bloc--infos { flex: 1; min-height: 0; }

  /* CE QU'ON PRÉCISE DE VIVE VOIX. Cette phrase sortait en 23 px gras, posée
     entre deux blocs sans cadre ni intitulé : la seule chose de la feuille qui
     n'appartenait à rien, et la plus grosse après la référence. Elle a
     maintenant son bloc, son intitulé, et le corps de lecture. */
  .tk__consigne { padding: 10px 14px; border-left: 3px solid var(--pap-encre);
                  background: #f2f4f5; font-size: var(--tk-texte); font-weight: 600;
                  line-height: 1.35; white-space: pre-line; }

  /* LE CADRE À ÉCRIRE ABSORBE, IL NE POUSSE PAS. Avec un plancher en pixels il
     s'ajoutait aux blocs du dessus au lieu de prendre ce qui reste, et la
     feuille partait sur une SECONDE page presque vide. Il n'a donc pas de
     hauteur minimale : il est le seul bloc élastique de la page, et c'est lui
     qui la fait tomber sur 297 mm pile. */
  .tk__infos { flex: 1; min-height: 0; padding: 12px 20px 14px; border: 1.5px solid var(--pap-encre);
               background-image: repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--tk-rang) - 1px), var(--pap-filet) calc(var(--tk-rang) - 1px), var(--pap-filet) var(--tk-rang));
               background-position: 0 8px; background-clip: content-box; white-space: pre-line; }

  .tk__pied { display: flex; align-items: center; justify-content: space-between; gap: 24px;
              padding: 12px var(--pap-marge) 20px; border-top: 1px dashed var(--pap-encre); }
  .tk__pied-fort { font-weight: 700; color: var(--pap-encre); }

  /* UN ARTICLE PAR FEUILLE. Sans ça, deux tickets d'une même commande se
     suivent sur la même page et l'établi en perd un. */
  .tk + .tk { break-before: page; page-break-before: always; }

  /* EN CORRECTION, un champ garde exactement la place et le dessin du texte
     qu'il remplace : le papier ne doit pas se réorganiser quand on l'ouvre. */
  .tk__champ { font: inherit; color: inherit; letter-spacing: inherit; line-height: inherit;
               background: none; border: 0; border-bottom: 1px dotted var(--pap-ardoise);
               padding: 0; margin: 0; min-width: 0; width: 100%; }
  /* UN CHAMP D'UNE LIGNE NE REVIENT JAMAIS À LA LIGNE — c'est la nature d'un
     champ input : son contenu défile à l'intérieur, invisible, et rien ne le
     dit. Ce qui peut être long (la désignation) est donc une ZONE DE TEXTE, qui
     s'enroule et grandit avec ce qu'on y met. On lui retire la poignée de
     redimensionnement : la feuille garde ses proportions. */
  textarea.tk__champ { resize: none; overflow: hidden; display: block; }
  /* LA QUANTITÉ SE MESURE À SON NOMBRE. À 100 % de sa colonne, deux chiffres
     tiraient un trait pointillé de 308 px jusqu'au mot « pièces » : on lisait
     un champ vide plutôt qu'une quantité. field-sizing rend la boîte à la
     taille du contenu ; les navigateurs qui l'ignorent gardent le trait long,
     ce qui reste lisible. */
  .tk__qte { field-sizing: content; width: auto; min-width: 2ch; }
  .tk--edit .tk__matrice-v .tk__champ { text-align: center; }
  .tk__champ:focus { outline: 2px solid var(--pap-encre); outline-offset: 2px; }
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
  const cap = (txt, cls) => el('div', cls ? 'pap-cap ' + cls : 'pap-cap', txt);
  // UN CHAMP VIDE NE S'IMPRIME PAS. « CONTACT — » n'apprend rien et occupe une
  // colonne de la rangée du client : c'est déjà la règle du bon de commande, et
  // les deux papiers sortent de la même ligne à un clic l'un de l'autre.
  // EN CORRECTION, IL RESTE : c'est là qu'on ajoute le contact qui manquait.
  const champ = (label, valeur, cle, fort) => {
    if (!valeur && !editeur) return null;
    const b = el('div', 'tk__champ-bloc');
    const v = el('div', 'tk__champ-val' + (fort ? ' tk__champ-val--fort' : ''));
    if (editeur && cle) v.append(val(cle, valeur));
    else v.textContent = valeur;
    b.append(cap(label), v);
    return b;
  };

  const tk = el('div', editeur ? 'tk tk--edit' : 'tk');

  // L'EN-TÊTE. Pas de marque, pas d'adresse : ce papier ne sort jamais de
  // l'atelier, personne n'a besoin qu'il rappelle le nom de la maison où il est
  // lu. La référence du dossier ne s'imprime pas non plus en tête — elle ne fait
  // rien produire ; elle revient au pied, là où on la cherche pour classer.
  //
  // LE TITRE NE CRIE PLUS. Il sortait à 44 px : le plus gros caractère de la
  // feuille pour le seul mot qui ne fait rien produire — tous les tickets
  // d'atelier s'appellent « ticket atelier ». La place qu'il prenait revient à
  // la DATE DE RETRAIT, montée ici : c'est la seule chose qui fasse ordonner le
  // travail, et on la cherche avant tout le reste sur une pile.
  const tete = el('header', 'tk__tete');
  const teteG = el('div', 'tk__tete-g');
  teteG.append(el('h1', 'tk__titre', t.titre));
  // CE PAPIER NE FAIT PAS TOUTE LA COMMANDE. Un compte, pas un identifiant :
  // sans lui, l'atelier finit son article et emballe en croyant avoir fini.
  if (t.lot) {
    const no = el('div', 'tk__no');
    no.append(cap('NO.'), el('span', 'tk__no-n', String(t.lot.rang)),
      el('span', 'tk__no-t', '/' + t.lot.total));
    teteG.append(no);
  }
  const quand = el('div', 'tk__quand');
  quand.append(cap('À RETIRER LE'), el('div', 'tk__quand-v', t.retrait || '—'));
  tete.append(teteG, quand);
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
  // La date de retrait n'est plus ici : elle est en tête, à côté du titre. Elle
  // y était écrite une deuxième fois — la carte ne dit pas deux fois la même
  // chose, et c'est vrai du papier aussi.
  champs.append(...[
    champ('CONTACT', t.contact, 'contact'),
    champ('TÉL', t.tel, 'tel'),
  ].filter(Boolean));
  qui.append(gauche, champs);
  tk.append(qui);

  const corps = el('main', 'tk__corps');
  for (const a of t.lignes) {
    if (a.prod) blocsProduction(a.prod, a);
    else corps.append(teteArticle(a));
    // LA PRÉCISION DE VIVE VOIX — ce que la vendeuse a noté et qui n'entre dans
    // aucune case. Elle sortait en 23 px gras, posée entre deux blocs sans
    // cadre ni intitulé : la seule chose de la feuille qui n'appartenait à rien,
    // et la plus grosse après la référence. Elle a maintenant son bloc.
    // En correction elle est offerte même vide : c'est là qu'on écrit.
    if (a.detail || (editeur && a.ou && a.ou.detail)) {
      const bloc = el('div', 'tk__bloc');
      bloc.append(cap('CONSIGNE', 'tk__bloc-titre'));
      const det = el('p', 'tk__consigne');
      if (editeur) det.append(val('detail', a.detail, a.ou.detail));
      else det.textContent = a.detail;
      bloc.append(det);
      corps.append(bloc);
    }
  }

  // CE QU'ON ÉCRIT À L'ÉTABLI. Le cadre est réglé, pas vide : un rectangle nu
  // ne se remplit pas, des lignes si. C'est là que finit ce qui n'entre dans
  // aucune case — et c'est la moitié du travail d'un atelier.
  const infos = el('div', 'tk__bloc tk__bloc--infos');
  infos.append(cap('INFORMATIONS', 'tk__bloc-titre'), el('div', 'tk__infos'));
  corps.append(infos);
  tk.append(corps);

  // LE CONTRÔLE DE CONFORMITÉ A ÉTÉ RETIRÉ (Charlie, 28/08 : « ça, ça dégage »).
  // C'était un cadre à cocher et une phrase de treize mots — deux centimètres de
  // feuille pour une case que personne ne cochait. Ce qui prouve qu'une pièce a
  // été vue, c'est l'étape franchie au planning, pas une signature sur le papier
  // qui part avec elle.

  // LE PIED porte ce qui ne fait pas produire : quand la commande a été prise,
  // et de quel dossier ce papier parle — pour le reclasser, pas pour le faire.
  const pied = el('footer', 'tk__pied');
  const g = el('div', 'pap-cap');
  // Aucun nœud de texte nu : le ticket se dessine aussi hors navigateur (les
  // tests le rendent dans un DOM minimal, et c'est cette portabilité qui permet
  // de vérifier le papier sans ouvrir Chrome). Tout passe par un élément.
  if (t.date) g.append(el('span', null, 'COMMANDE PRISE LE '), el('span', 'tk__pied-fort', t.date));
  // À DROITE, DE QUOI RECONNAÎTRE UNE FEUILLE ISOLÉE — la référence de
  // l'ARTICLE, celle qu'on va chercher au stock, jamais celle du DOSSIER.
  // La clé du dossier ne s'imprime pas : ce papier va à l'établi, pas au
  // classement, et un identifiant de dossier n'y fait rien produire.
  const article = t.lignes.find((x) => x.prod && x.prod.ref);
  const d = el('div', 'pap-cap');
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
    // MÊME RÈGLE QUE PLUS BAS (blocsProduction) : ce qu'on écrit ici est
    // TOUJOURS une désignation — une phrase, jamais un code de six signes,
    // puisque cette tête-ci sert précisément aux lignes sans fiche. Elle prend
    // donc le cran en dessous. Sans ça « Sweat capuche molleton » sortait à
    // 64 px dans une colonne de 450 : mesuré 677 px de texte, coupé net en
    // plein mot, et sur la seule chose que l'atelier cherche du regard.
    const nom = el('div', 'tk__geant tk__geant--texte');
    if (editeur) nom.append(val('designation', a.designation, a.ou && a.ou.designation));
    else nom.textContent = a.designation;
    cg.append(cap('ARTICLE'), nom);
    const cd = el('div', 'tk__ident-col tk__ident-col--d');
    const q = el('div', 'tk__ident-qte');
    // LE NOMBRE EST DANS LA BOÎTE GÉANTE, PAS À CÔTÉ. En correction, le champ
    // était posé en VOISIN d'un `tk__geant` vide : il n'héritait donc de rien
    // et la quantité sortait à 17 px — la taille du texte courant — alors que
    // c'est, avec la référence, l'un des deux seuls faits qu'on cherche du
    // regard sur une pile de papiers. Elle se nichait en plus derrière un trait
    // de 139 px pour deux chiffres.
    if (editeur) {
      const n = el('span', 'tk__geant');
      n.append(val('qte', a.qte, a.ou && a.ou.qte));
      q.append(n);
    } else {
      q.append(el('span', 'tk__geant', a.qte || ''));
    }
    q.append(el('span', 'tk__ident-unite', Number(a.qte) > 1 ? 'pièces' : 'pièce'));
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

    // 2. UN SEUL TABLEAU POUR TOUTE LA PRODUCTION.
    //    La taille en COLONNE, ce qu'on en fait en LIGNE : les pièces d'abord,
    //    puis une ligne par face à marquer.
    //
    //    Il y avait TROIS dessins pour un seul geste — regarder une taille et
    //    savoir quoi faire. La grille des quantités, les cotes du dos relistées
    //    en colonne dans sa carte, et un bloc de cartes pour les autres faces.
    //    Charlie, 28/08 : « ces tailles doivent être sous les tailles », puis,
    //    en désignant les cartes restantes : « celles-là aussi ».
    //
    //    TROIS SORTES DE LIGNES DE FACE, et la ligne dit laquelle par sa forme :
    //      · la cote CHANGE d'une taille à l'autre : une cellule par colonne,
    //        chaque cote sous sa taille ;
    //      · la cote est UNIQUE : une seule cellule sur toute la largeur. La
    //        répéter sous chaque taille n'apprend rien et fait lire cinq fois ;
    //      · pas de cote : un trait sur toute la largeur. C'est une mesure à
    //        prendre a l'établi, et un blanc ne se remplit pas.
    //
    //    LA CONSIGNE VIT DANS L'INTITULÉ DE SA LIGNE, sous le nom de la face :
    //    sur une tasse ou une gravure c'est elle tout le travail, et elle doit
    //    rester collée à la face qu'elle concerne.
    const tailles = taillesParlantes(p.tailles);
    if (tailles.length || p.logos.length) {
      const bloc = el('div', 'tk__bloc');
      // PAS « MARQUAGE » : ce mot est déjà l'intitulé de la TECHNIQUE, trois
      // centimètres plus haut dans la boîte d'identité (« MARQUAGE · DTF ·
      // Blanc »). Deux fois le même intitulé pour deux choses différentes sur
      // la même feuille, c'est une feuille qu'on relit. Ici ce sont les FACES.
      bloc.append(cap(tailles.length ? 'TAILLES ET FACES' : 'FACES À MARQUER', 'tk__bloc-titre'));
      const table = el('table', 'tk__matrice');
      // LES COLONNES SE COMPTENT EN CSS, pas en style en ligne : le ticket se
      // dessine aussi hors navigateur (les tests le rendent dans un DOM minimal,
      // sans propriété style), et c'est cette portabilité qui permet de vérifier
      // le papier sans ouvrir Chrome.
      const groupe = el('colgroup');
      groupe.append(el('col', 'tk__matrice-col-k'));
      for (let i = 0; i < Math.max(1, tailles.length); i += 1) groupe.append(el('col'));
      table.append(groupe);

      // L'EN-TÊTE N'EXISTE QUE S'IL Y A DES TAILLES. Une tasse a trois faces et
      // une seule taille : une ligne d'en-tête vide au-dessus de ses faces ne
      // dirait rien et prendrait la place de ce qui en dit.
      if (tailles.length) {
        const thead = el('thead');
        const trT = el('tr');
        // Le coin haut-gauche ne porte rien : lui donner un cadre fabriquerait
        // une case vide, c'est-à-dire une case qu'on cherche à remplir.
        trT.append(el('th', 'tk__matrice-coin'));
        for (const x of tailles) trT.append(el('th', 'tk__matrice-t', x.t));
        thead.append(trT);
        table.append(thead);
      }

      const tbody = el('tbody');
      if (tailles.length) {
        const trQ = el('tr');
        trQ.append(el('th', 'tk__matrice-k', 'PIÈCES'));
        for (const x of tailles) {
          const c = el('td', 'tk__matrice-v');
          c.append(val('prod-taille', x.n, x.ou));
          trQ.append(c);
        }
        tbody.append(trQ);
      }

      // L'INTITULÉ D'UNE LIGNE DE FACE : son nom, et l'unité SEULEMENT s'il y a
      // une cote à lire dans la ligne.
      //
      // « Pour les tasses ce n'est pas des tailles que je reçois à l'atelier
      // mais des logos, donc pas de mm » (Charlie, 28/08). Une tasse, une
      // gravure, un panneau : on ne mesure rien, on marque ce que la vendeuse a
      // écrit. Annoncer « mm » au-dessus d'une cellule qui n'en portera jamais,
      // c'est promettre une cote — et une cote promise finit par être inventée.
      const intituleFace = (zone, avecCote) => {
        const k = el('th', 'tk__matrice-k');
        const nom = el('div', 'tk__matrice-nom');
        // LE NOM DE LA FACE EST UN INTITULÉ, il prend donc les capitales de tous
        // les autres — mais PAS l'unité qui le suit : mm est une unité du
        // système international et s'écrit en minuscules.
        nom.append(el('span', 'tk__matrice-face', zone.face));
        // … ET PAS DEUX FOIS. Certains noms de face portent déjà leur cote et
        // leur unité — « Face Optimisée 205 x 205 mm », dans la table des
        // tailles de logo. L'intitulé sortait alors « FACE OPTIMISÉE 205 X 205
        // MM mm ». On n'ajoute l'unité que si le nom ne la dit pas déjà.
        if (avecCote && !/\bmm\b/i.test(zone.face)) nom.append(el('span', 'tk__matrice-u', 'mm'));
        k.append(nom);
        // LA CONSIGNE NE RESTE DANS L'INTITULÉ QUE SI LA CELLULE EST PRISE par
        // les cotes. Sans cote, c'est ELLE l'information de la ligne : elle va
        // à sa place, dans la colonne des valeurs.
        if (zone.quoi && avecCote) k.append(el('div', 'tk__matrice-quoi', zone.quoi));
        return k;
      };
      // Une cellule qui couvre toutes les colonnes de tailles.
      const surToute = (cls) => {
        const c = el('td', cls);
        if (tailles.length > 1) c.setAttribute('colspan', String(tailles.length));
        return c;
      };

      // LA COTE D'UNE FACE POUR UNE TAILLE DONNÉE. Une cote unique vaut pour
      // toutes les tailles : c'est la MÊME valeur, pas une absence.
      const coteDe = (mesures, taille) => {
        if (!mesures.length) return '';
        if (mesures.length === 1 && !mesures[0].t) return mesures[0].mm;
        const trouve = mesures.find((x) => x.t === taille);
        // UNE TAILLE SANS COTE N'EST PAS UNE CASE OUBLIÉE : c'est une cote à
        // prendre. Un tiret le dit ; un blanc laisserait croire à un zéro.
        return trouve ? trouve.mm : '—';
      };

      for (const zone of p.logos) {
        const mesures = mesuresDeFace(zone.mm);
        const tr = el('tr');
        tr.append(intituleFace(zone, mesures.length > 0));
        if (editeur) {
          // EN CORRECTION, LA CHAÎNE SE RÉÉCRIT D'UN BLOC. Le comptoir compose
          // « S 240/M 260/… » en une seule valeur : la découper en cinq champs
          // ferait écrire cinq fois dans une case qui n'en attend qu'une. La
          // LIGNE reste à sa place — c'est son grain qui change, pas la feuille
          // qui se réorganise quand on l'ouvre.
          const c = surToute('tk__matrice-v tk__matrice-v--libre');
          c.append(val('prod-logo', zone.mm, zone.ou));
          tr.append(c);
        } else if (!mesures.length && zone.quoi) {
          // PAS DE COTE, MAIS UNE CONSIGNE : c'est ELLE l'information de la
          // ligne, et elle occupe la colonne des valeurs. « Ma vendeuse peut
          // sous chaque logo rentrer des informations et me donner des
          // informations complémentaires ici » (Charlie, 28/08, en désignant
          // cette cellule).
          //
          // ELLE COUVRE LES COLONNES, et c'est la seule chose qui en ait le
          // droit : la règle « une colonne se lit seule » vaut pour ce qui
          // DÉPEND de la taille. Une phrase n'en dépend pas — la répéter cinq
          // fois ne dirait rien de plus et ferait lire cinq fois.
          const c = surToute('tk__matrice-v tk__matrice-v--texte');
          c.textContent = zone.quoi;
          tr.append(c);
        } else {
          // UNE COLONNE SE LIT SEULE. Charlie, 28/08 : « les tailles des coeur
          // même identique doivent apparaître sous les tailles ». À l'établi on
          // prend une taille et on veut y lire TOUT ce qu'il faut pour elle —
          // une cote posée une fois en travers des colonnes oblige à sortir de
          // la sienne pour aller la chercher, et c'est là qu'on lit la ligne du
          // dessus. La même valeur revient donc sous chaque taille.
          const colonnes = tailles.length ? tailles.map((x) => x.t) : [''];
          for (const t of colonnes) {
            const c = el('td', 'tk__matrice-v');
            const cote = coteDe(mesures, t);
            if (cote) c.textContent = cote;
            // NI COTE NI CONSIGNE : un trait pour écrire ce qu'on aura mesuré.
            else c.append(el('span', 'tk__aecrire'));
            tr.append(c);
          }
        }
        tbody.append(tr);
      }
      table.append(tbody);
      bloc.append(table);
      corps.append(bloc);
    }
  }
}
