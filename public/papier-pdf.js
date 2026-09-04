// ===========================================================================
// LE PAPIER, EN PDF — le troisième rendu du même modèle
// ===========================================================================
// Charlie, 04/09/2026 : la ligne du planning doit PORTER son devis et sa
// facture, pour qu'on puisse les envoyer (WhatsApp, Dropbox) sans repasser par
// l'écran qui les a composés.
//
// LES ÉCRANS IMPRIMENT, ILS NE FABRIQUENT AUCUN OCTET. `window.print()` dans un
// cadre hors écran donne une feuille au navigateur ; rien ne revient au code.
// Et jsPDF a quitté le dépôt le 25/08.
//
// CE N'EST PAS UN SECOND PAPIER, C'EST UN SECOND RENDU.
// ---------------------------------------------------------------------------
//   modeleDevis(saisie) / modeleFacture(saisie)   ← objet PUR, aucun DOM
//            │
//            ├── dessinerDevis / dessinerFacture  ──→ HTML  (l'écran, l'impression)
//            └── ecrirePapierPdf                  ──→ PDF   (ce qu'on dépose et envoie)
//
// La grammaire — les intitulés, l'encre, le filet, la marge de feuille, les
// crans de texte — reste dans `papier.js` et ne se réécrit PAS ici : ce fichier
// ne décide de rien, il MET EN PAGE ce que le modèle a déjà tranché. Un montant
// n'y est jamais recalculé : il arrive formaté (`euro()`), exactement comme
// dans la feuille HTML. C'est ce qui fait que les deux rendus ne peuvent pas
// dire deux chiffres différents.
//
// UN SEUL FICHIER POUR LES DEUX DOCUMENTS, et c'est la règle des deux papiers
// de l'atelier : le devis et la facture sont de la même famille, ils ont le
// même en-tête, le même cadre client, le même tableau, les mêmes totaux. Ce qui
// les distingue tient en trois blocs, passés en `extra`.
//
// ⚠ TROIS PIÈGES DÉJÀ PAYÉS, ET ILS SONT TOUS DANS L'ENCODAGE :
//
//   1. LES ESPACES D'`Intl`. `euro(1234.5)` rend « 1 234,50 € » avec une
//      ESPACE FINE INSÉCABLE (U+202F) et parfois une insécable ordinaire
//      (U+00A0). Ni l'une ni l'autre n'existe dans WinAnsi : `drawText` LÈVE,
//      et le PDF ne sort pas du tout. On les ramène à l'espace ordinaire.
//   2. LES LIGATURES ET LES SIGNES TYPOGRAPHIQUES. « œ », « — », « … », les
//      apostrophes courbes : la moitié passe, l'autre non selon la police. On
//      les replie sur leurs équivalents ASCII plutôt que de perdre la feuille.
//   3. LA LARGEUR SE MESURE, ELLE NE SE DEVINE PAS. `widthOfTextAtSize` existe :
//      couper à un nombre de caractères donnerait des colonnes qui débordent
//      sur les désignations longues, et c'est exactement ce qu'une facture ne
//      doit pas faire.

// ⚠ CE MODULE TIRE 511 Ko (pdf-lib). Il ne s'importe donc JAMAIS en tête d'un
// écran : `pdfDevis` et `pdfFacture` le chargent au moment d'en fabriquer un.
// Le dépôt du fichier sur la ligne, lui, vit dans `reseau.js` — il n'a pas
// besoin d'une bibliothèque de PDF pour envoyer des octets, et l'y laisser
// aurait fait descendre pdf-lib a l'ouverture de l'ecran.
import { PDFLib } from './bat/js/vendor.js';

// --- A4 portrait, en points PostScript (72 par pouce) ----------------------
const PAGE_L = 595.28;
const PAGE_H = 841.89;
// La marge de feuille du papier HTML (`--pap-marge`, 18 mm) en points.
const MARGE = 51;
const UTILE = PAGE_L - MARGE * 2;

// Les crans de texte, dans le même esprit que le papier HTML : un géant pour le
// total, une clé pour les intitulés, un texte pour le reste, un petit pour les
// mentions. QUATRE, pas dix — c'est la règle des deux papiers.
const GEANT = 20;
const CLE = 11;
const TEXTE = 9;
const PETIT = 7.5;
const INTER = 1.35;

// ---------------------------------------------------------------------------
// CE QU'UNE POLICE STANDARD SAIT ÉCRIRE
// ---------------------------------------------------------------------------
// Helvetica est encodée en WinAnsi : les lettres accentuées du français y sont,
// et l'euro aussi. Le reste — espaces fines, tirets cadratins, points de
// suspension, apostrophes courbes, ligatures — ne l'est pas, et `drawText` ne
// se contente pas de l'ignorer : elle LÈVE. Une feuille perdue pour une espace.
//
// ⚠ ET L'EURO EN FAIT PARTIE. Premier essai : tous les montants sortaient
// « 20,80 » au lieu de « 20,80 € » — le signe vaut U+20AC, au-dessus de
// Latin-1, et un filtre « jusqu'a U+00FF » le jetait avec le reste. Une
// facture sans devise, et rien pour le dire. Vu en REGARDANT la feuille, pas
// en relisant le code.
const REMPLACEMENTS = [
  // Les espaces fines et insécables : ABSENTES de WinAnsi, et `Intl` en met
  // une avant chaque « € ».
  [/[    ]/g, ' '],
  [/[‘‛]/g, "'"],
  [/[×]/g, 'x'],
];
// CE QUE WINANSI SAIT ÉCRIRE EN PLUS DE LATIN-1 : la plage 0x80-0x9F de CP1252.
// L'euro, les points de suspension, les tirets longs, les guillemets courbes et
// la ligature « oe » en font partie — les replier serait appauvrir le document
// pour rien.
const EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹Œ'
  + 'Ž’“”•–—˜™š›œžŸ';
const HORS_JEU = new RegExp(`[^\\u0020-\\u00ff${EXTRAS}]`, 'g');
function lisible(v) {
  let s = String(v == null ? '' : v);
  for (const [re, par] of REMPLACEMENTS) s = s.replace(re, par);
  // Tout ce qui resterait hors WinAnsi est retiré plutôt que de faire échouer
  // la feuille entière : un caractère perdu se voit, une facture absente coûte
  // une réimpression et un appel.
  return s.replace(HORS_JEU, '');
}

// ---------------------------------------------------------------------------
// LA PLUME — tout ce qui écrit passe par ici
// ---------------------------------------------------------------------------
// Elle tient la page courante, le curseur vertical, et sait en ouvrir une
// nouvelle quand le bas approche. Sans elle, chaque bloc referait la même
// arithmétique et le premier oubli donnerait du texte hors de la feuille.
function plume(doc, polices) {
  let page = doc.addPage([PAGE_L, PAGE_H]);
  let y = PAGE_H - MARGE;
  const encre = PDFLib.rgb(0.067, 0.094, 0.153);        // l'encre de la charte
  const gris = PDFLib.rgb(0.42, 0.45, 0.50);
  const filet = PDFLib.rgb(0.80, 0.82, 0.85);

  const police = (gras) => (gras ? polices.gras : polices.normal);
  const largeur = (s, taille, gras) => police(gras).widthOfTextAtSize(lisible(s), taille);

  // Coupe un texte à la largeur disponible, en MESURANT — jamais en comptant
  // des caractères : « Tableau photo contrecollé sur Dibond » et « IIIIIIII »
  // n'occupent pas la même place.
  function couper(s, max, taille, gras) {
    const t = lisible(s);
    if (largeur(t, taille, gras) <= max) return t;
    let bas = 0; let haut = t.length;
    while (bas < haut) {
      const mi = Math.ceil((bas + haut) / 2);
      if (largeur(`${t.slice(0, mi)}...`, taille, gras) <= max) bas = mi; else haut = mi - 1;
    }
    return `${t.slice(0, bas)}...`;
  }

  // Découpe en lignes à la largeur donnée, aux espaces. Rend un tableau : c'est
  // l'appelant qui décide combien il en garde.
  function envelopper(s, max, taille, gras) {
    const mots = lisible(s).split(/\s+/).filter(Boolean);
    const out = [];
    let courante = '';
    for (const m of mots) {
      const essai = courante ? `${courante} ${m}` : m;
      if (largeur(essai, taille, gras) <= max) { courante = essai; continue; }
      if (courante) out.push(courante);
      courante = largeur(m, taille, gras) <= max ? m : couper(m, max, taille, gras);
    }
    if (courante) out.push(courante);
    return out;
  }

  const api = {
    get y() { return y; },
    set y(v) { y = v; },
    // Reste-t-il la place ? Sinon on tourne la page. Rendu `true` si on a tourné.
    place(h) {
      if (y - h >= MARGE + 28) return false;
      page = doc.addPage([PAGE_L, PAGE_H]);
      y = PAGE_H - MARGE;
      return true;
    },
    texte(s, x, opts = {}) {
      const taille = opts.taille || TEXTE;
      const t = opts.max ? couper(s, opts.max, taille, opts.gras) : lisible(s);
      if (!t) return;
      const l = largeur(t, taille, opts.gras);
      const gauche = opts.droite ? x - l : (opts.centre ? x - l / 2 : x);
      page.drawText(t, {
        x: gauche,
        y: y - taille,
        size: taille,
        font: police(opts.gras),
        color: opts.gris ? gris : encre,
      });
    },
    // Une ligne de texte, puis on descend : le cas courant.
    ligne(s, x, opts = {}) {
      api.texte(s, x, opts);
      y -= (opts.taille || TEXTE) * INTER;
    },
    filet(epaisseur = 0.7, couleur) {
      page.drawRectangle({
        x: MARGE, y, width: UTILE, height: epaisseur, color: couleur || filet,
      });
      y -= epaisseur;
    },
    cadre(h, teinte) {
      page.drawRectangle({
        x: MARGE, y: y - h, width: UTILE, height: h, color: teinte,
      });
    },
    saut(n) { y -= n; },
    largeur, envelopper, couper,
  };
  return api;
}

// ---------------------------------------------------------------------------
// LES BLOCS
// ---------------------------------------------------------------------------
function enTete(p, t) {
  const m = t.maison || {};
  const colonne = UTILE * 0.55;
  const hautDepart = p.y;

  p.ligne(m.nom || '', MARGE, { taille: CLE, gras: true, max: colonne });
  for (const l of m.lignes || []) p.ligne(l, MARGE, { taille: PETIT, gris: true, max: colonne });
  for (const l of m.contact || []) p.ligne(l, MARGE, { taille: PETIT, gris: true, max: colonne });
  const basMaison = p.y;

  // LE TITRE ET LE NUMÉRO, À DROITE. On revient en haut : les deux colonnes de
  // l'en-tête partent de la même ligne, comme sur la feuille.
  p.y = hautDepart;
  const droite = PAGE_L - MARGE;
  p.ligne(t.titre || '', droite, { taille: GEANT, gras: true, droite: true });
  if (t.numero) p.ligne(t.numero, droite, { taille: CLE, gras: true, droite: true });
  if (t.date) p.ligne(`Date : ${t.date}`, droite, { taille: PETIT, gris: true, droite: true });
  if (t.validite) p.ligne(`Validité : ${t.validite}`, droite, { taille: PETIT, gris: true, droite: true });

  p.y = Math.min(basMaison, p.y) - 6;
  p.filet(2, PDFLib.rgb(0.067, 0.094, 0.153));
  p.saut(12);

  // LES MENTIONS LÉGALES SOUS LE FILET : elles signent la maison, et une
  // facture sans SIRET n'est pas opposable.
  if ((m.legal || []).length) {
    p.ligne((m.legal || []).join('  ·  '), MARGE, { taille: PETIT, gris: true, max: UTILE });
    p.saut(4);
  }
}

function blocClient(p, t) {
  const c = t.client || {};
  p.ligne('CLIENT', MARGE, { taille: PETIT, gras: true, gris: true });
  p.ligne(c.nom || '', MARGE, { taille: CLE, gras: true, max: UTILE * 0.6 });
  for (const l of [c.adresse, c.ville, c.contact, c.tel, c.email].filter(Boolean)) {
    p.ligne(l, MARGE, { taille: TEXTE, gris: true, max: UTILE * 0.6 });
  }
  if (t.projet) {
    p.saut(2);
    p.ligne(`Projet : ${t.projet}`, MARGE, { taille: TEXTE, gras: true, max: UTILE });
  }
  p.saut(10);
}

// LES COLONNES DU TABLEAU. Écrites une fois, en fractions de la largeur utile :
// un nombre en dur se recopie de travers, et la colonne des montants doit
// rester alignée d'un document à l'autre.
const COL = { qte: 0.60, pu: 0.74, total: 0.90 };
const X = (f) => MARGE + UTILE * f;

function teteTableau(p) {
  p.ligne('DESIGNATION', MARGE, { taille: PETIT, gras: true, gris: true });
  p.y += PETIT * INTER;                     // les quatre intitulés sur LA MÊME ligne
  p.texte('QTÉ', X(COL.qte), { taille: PETIT, gras: true, gris: true, droite: true });
  p.texte('PU HT', X(COL.pu), { taille: PETIT, gras: true, gris: true, droite: true });
  p.texte('TOTAL HT', X(COL.total) + UTILE * 0.10, { taille: PETIT, gras: true, gris: true, droite: true });
  p.y -= PETIT * INTER;
  p.filet();
  p.saut(6);
}

// CE QUI SE LIT SOUS UNE DÉSIGNATION : la référence, le coloris, les tailles,
// le marquage, l'encre, les faces, la note. Dans CET ordre — c'est celui de la
// feuille HTML, et c'est celui dans lequel l'atelier les cherche.
function detailDeLigne(l) {
  return [
    l.reference && `Réf ${l.reference}`,
    l.couleur,
    l.tailles,
    l.marquage,
    l.encre && `Encre ${l.encre}`,
    l.faces,
    l.note,
  ].filter(Boolean).join('  ·  ');
}

function tableau(p, t) {
  teteTableau(p);
  const largeurDesignation = UTILE * COL.qte - 14;
  for (const l of t.lignes || []) {
    const titres = p.envelopper(l.designation || '', largeurDesignation, TEXTE, true).slice(0, 2);
    const detail = detailDeLigne(l);
    const detailsLignes = detail ? p.envelopper(detail, largeurDesignation, PETIT, false).slice(0, 3) : [];
    const hauteur = titres.length * TEXTE * INTER + detailsLignes.length * PETIT * INTER + 8;
    // UNE LIGNE NE SE COUPE PAS EN DEUX PAGES : sa désignation et ses montants
    // se lisent ensemble, sinon le total d'un article se retrouve orphelin en
    // tête de la page suivante.
    if (p.place(hauteur)) teteTableau(p);

    const hautLigne = p.y;
    for (const s of titres) p.ligne(s, MARGE, { taille: TEXTE, gras: true });
    for (const s of detailsLignes) p.ligne(s, MARGE, { taille: PETIT, gris: true });

    // Les montants s'alignent sur la PREMIÈRE ligne du titre.
    const bas = p.y;
    p.y = hautLigne;
    if (l.quantite != null && l.quantite !== '') {
      p.texte(String(l.quantite), X(COL.qte), { taille: TEXTE, droite: true });
    }
    p.texte(l.unitaireHt || '', X(COL.pu), { taille: TEXTE, droite: true });
    p.texte(l.totalHt || '', X(COL.total) + UTILE * 0.10, { taille: TEXTE, gras: true, droite: true });
    p.y = bas;

    p.saut(4);
    p.filet(0.4);
    p.saut(6);
  }
}

function totaux(p, t) {
  if (!t.totaux) return;
  const to = t.totaux;
  const droite = PAGE_L - MARGE;
  const cle = droite - UTILE * 0.22;
  const rangs = [['Sous-total HT', to.sousTotalHt]];
  if (to.ajustement) rangs.push(['Ajustement', to.ajustement]);
  if (to.ecart) rangs.push(['Arrondi commercial', to.ecart]);
  // LA BASCULE VEDETTE : le total mis en avant devient le géant, l'autre reste
  // une ligne. Le calcul ne change pas — c'est le modèle qui l'a déjà tranché.
  if (to.vedette === 'ht') rangs.push([to.taxeLabel, to.taxe]);
  else rangs.push(['Total HT', to.totalHt], [to.taxeLabel, to.taxe]);

  const hauteur = rangs.length * TEXTE * INTER + GEANT * INTER + 22;
  p.place(hauteur);
  p.saut(6);
  for (const [k, v] of rangs) {
    p.texte(k, cle, { taille: TEXTE, gris: true, droite: true });
    p.ligne(v, droite, { taille: TEXTE, droite: true });
  }
  p.saut(4);
  p.filet(1.2, PDFLib.rgb(0.067, 0.094, 0.153));
  p.saut(8);
  const geantK = to.vedette === 'ht' ? 'TOTAL HT' : 'TOTAL À PAYER';
  const geantV = to.vedette === 'ht' ? to.totalHt : to.ttc;
  p.texte(geantK, cle, { taille: CLE, gras: true, droite: true });
  p.ligne(geantV, droite, { taille: GEANT, gras: true, droite: true });
  p.saut(10);
}

function pied(p, t, extra) {
  const blocs = [];
  if (extra.reglement) blocs.push(extra.reglement);
  if (t.mentionRegime) blocs.push(t.mentionRegime);
  if (t.bat) blocs.push(t.bat);
  if (t.delai) blocs.push(t.delai);
  for (const m of Array.isArray(t.mentions) ? t.mentions : []) blocs.push(m);

  for (const b of blocs) {
    const lignes = p.envelopper(b, UTILE, PETIT, false);
    p.place(lignes.length * PETIT * INTER + 6);
    for (const s of lignes) p.ligne(s, MARGE, { taille: PETIT, gris: true });
    p.saut(4);
  }
}

// ---------------------------------------------------------------------------
// L'ÉCRITURE
// ---------------------------------------------------------------------------
/**
 * @param {object} t      le modèle rendu par `modeleDevis` ou `modeleFacture`
 * @param {object} [extra]
 * @param {string} [extra.reglement]  la phrase de règlement, propre à chaque
 *                                    document (un acompte n'est pas un mode de
 *                                    paiement). Composée par l'appelant, qui
 *                                    seul sait ce que son modèle porte.
 * @returns {Promise<Uint8Array>}
 */
export async function ecrirePapierPdf(t, extra = {}) {
  const doc = await PDFLib.PDFDocument.create();
  const polices = {
    normal: await doc.embedFont(PDFLib.StandardFonts.Helvetica),
    gras: await doc.embedFont(PDFLib.StandardFonts.HelveticaBold),
  };
  // CE QUE LE FICHIER DIT DE LUI-MÊME : un PDF qui s'ouvre sans titre dans un
  // onglet ne se reconnaît pas dans une pile de six.
  doc.setTitle(`${t.titre || 'Document'} ${t.numero || ''}`.trim());
  doc.setProducer('Planning OLDA');
  doc.setCreationDate(new Date());

  const p = plume(doc, polices);
  enTete(p, t);
  blocClient(p, t);
  tableau(p, t);
  totaux(p, t);
  pied(p, t, extra);

  return doc.save();
}

// LE NOM DU FICHIER. Il se lit dans une Dropbox six mois plus tard : le type,
// le numéro, le client. Rien qu'un navigateur ou un système de fichiers refuse.
export function nomDuPapier(t) {
  // LES ACCENTS SE REPLIENT, ILS NE SE PERDENT PAS. « HÔTEL » doit rester
  // « HOTEL » et pas « H-TEL » : un nom de fichier se lit en balayant un
  // dossier, et un tiret au milieu d'un mot le rend méconnaissable. Un accent
  // dans un nom de fichier voyage mal (Dropbox, Windows, un lien WhatsApp) —
  // on le retire, on ne le remplace pas par du bruit.
  const plat = (s) => lisible(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const bouts = [t.titre || 'document', t.numero || '', (t.client && t.client.nom) || '']
    .map(plat).filter(Boolean);
  return `${bouts.join(' ').replace(/[^A-Za-z0-9 .\-_]+/g, ' ').replace(/\s+/g, '-')}.pdf`;
}
