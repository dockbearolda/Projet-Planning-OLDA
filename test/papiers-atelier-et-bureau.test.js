'use strict';

// ===========================================================================
// LES DEUX PAPIERS — TICKET D'ATELIER ET BON DE COMMANDE (28/08/2026)
// ===========================================================================
// Charlie, 28/08 : « il faut faire un gros effort de travail sur les 2 tickets,
// atelier et bon de commande, car actuellement les polices sont démesurées sur
// le ticket atelier et le bon de commande ne fait pas professionnel — je veux
// du haut de gamme parfaitement efficace ».
//
// Mesuré au rendu, sur trois cas réels, avant correction :
//
//   TICKET       dix tailles de police sur la même feuille (64 / 44 / 40 / 25 /
//                23 / 18 / 17 / 15 / 12 / 10) ;
//                la quantité « 60 » CASSÉE EN DEUX LIGNES, un 6 au-dessus d'un
//                0, parce que la colonne du nombre se comprimait au profit
//                d'une désignation à 44 px ;
//                la feuille textile à 1183 px pour 1123 disponibles — une
//                SECONDE page presque vide, que l'atelier perd ;
//                la date de retrait écrite deux fois.
//
//   BON DE       AUCUN ÉMETTEUR : ni nom, ni adresse, ni numéro légal. C'est
//   COMMANDE     le défaut de fond — un document qui ne dit pas de qui il vient
//                n'est pas un document, c'est une note ;
//                l'adresse et le secteur du client IMPRIMÉS DEUX FOIS, à
//                quinze lignes d'écart, sur le papier qui sert à facturer ;
//                un titre à 34 px, plus gros que le montant ;
//                la feuille à 1193 px pour 1123.
//
// Après : quatre crans par papier, quatre bords gauches devenus UN, six
// feuilles sur six qui tombent à 1123 px pile.
//
// Ce fichier tient les RÈGLES, pas les trois lignes de code qui les servent.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { chargerPapier } = require('./socle-papier.js');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');

const TICKET = lire('public/ticket.js');
const BUREAU = lire('public/bureau.js');
const PAPIER = lire('public/papier.js');

const { CSS_TICKET, dessinerTicket } = chargerPapier('ticket.js',
  ['modeleTicket', 'dessinerTicket', 'CSS_TICKET']);
const { modeleBureau, dessinerBureau, bureauTexte, CSS_BUREAU } = chargerPapier('bureau.js',
  ['modeleBureau', 'dessinerBureau', 'bureauTexte', 'CSS_BUREAU']);

// Le DOM minimal des tests du dépôt : pas de `style`, pas de mise en page — ce
// qui oblige les deux papiers à rester dessinables hors navigateur, et c'est ce
// qui permet de les vérifier sans ouvrir Chrome.
const faireDoc = () => ({
  createElement: (tag) => ({
    tag, className: '', textContent: '', enfants: [], attrs: {},
    append(...n) { this.enfants.push(...n); },
    appendChild(n) { this.enfants.push(n); return n; },
    // On RETIENT les attributs : c'est le seul moyen de vérifier qu'aucune
    // cellule ne couvre plusieurs colonnes de tailles.
    setAttribute(k, v) { this.attrs[k] = v; },
  }),
});
const tousLes = (n, cls, acc = []) => {
  if (String(n.className || '').split(' ').includes(cls)) acc.push(n);
  for (const c of n.enfants || []) tousLes(c, cls, acc);
  return acc;
};
const texteEntier = (n) => {
  let out = n.textContent ? `${n.textContent}\n` : '';
  for (const c of n.enfants || []) out += texteEntier(c);
  return out;
};

// ---------------------------------------------------------------------------
// 1. LE SOCLE EST PARTAGÉ — une seule écriture pour les deux papiers
// ---------------------------------------------------------------------------
// Les deux sortent de la MÊME ligne, à un clic l'un de l'autre : la modale
// porte les deux boutons. Ils avaient chacun leur encre, leur gris, leur filet,
// leur taille d'intitulé et leur marge de feuille — cinq valeurs identiques
// écrites deux fois, ce qui redevient deux valeurs le jour où l'une bouge.
for (const [nom, src] of [['ticket.js', TICKET], ['bureau.js', BUREAU]]) {
  assert.match(src, /import \{ JETONS_PAPIER, SOCLE_PAPIER \} from '\.\/papier\.js';/,
    `${nom} doit prendre le socle partagé, pas réécrire sa propre grammaire`);
}
for (const jeton of ['--pap-encre', '--pap-ardoise', '--pap-filet', '--pap-cap', '--pap-marge']) {
  assert.ok(PAPIER.includes(`${jeton}:`), `le socle doit poser ${jeton}`);
  // Et personne ne le redéclare chez soi : un jeton posé deux fois n'est plus
  // un jeton partagé, c'est une copie qui attend de diverger.
  for (const [nom, src] of [['ticket.js', TICKET], ['bureau.js', BUREAU]]) {
    assert.ok(!new RegExp(`${jeton}\\s*:`).test(src),
      `${nom} redéclare ${jeton} : le socle ne sert plus à rien`);
  }
}
// L'INTITULÉ EST UNE SEULE CLASSE, pour les deux papiers. Deux classes jumelles
// (`tk__cap` et `bu__cap`) sont exactement ce que la charte interdit : deux
// composants qui se ressemblent au lieu d'un seul.
assert.ok(PAPIER.includes('.pap-cap {'), 'le socle porte la classe des intitulés');
// Le socle arrive DEVANT le gabarit de chaque papier : la règle est donc dans
// les deux feuilles, et c'est ce qui garantit qu'elles ne peuvent pas diverger.
const regleCap = (CSS_TICKET.match(/\.pap-cap \{[^}]*\}/) || [])[0];
assert.ok(regleCap && CSS_BUREAU.includes(regleCap),
  'les deux feuilles portent LA MÊME règle d’intitulé, au caractère près');
for (const [nom, src] of [['ticket.js', TICKET], ['bureau.js', BUREAU]]) {
  assert.ok(!/__cap/.test(src), `${nom} garde une classe d’intitulé à lui`);
}
// LES CAPITALES SONT DANS LE TEXTE, PAS DANS LA RÈGLE : une bascule
// `text-transform` mettait aussi en capitales ce qui n'en veut pas — le
// millimètre du ticket sortait « MM », alors que mm est une unité du SI.
assert.ok(!/text-transform/.test(regleCap),
  'le socle ne force pas les capitales : « mm » n’est pas un intitulé, c’est une unité du SI');

// ---------------------------------------------------------------------------
// 2. QUATRE CRANS PAR PAPIER, PAS DIX
// ---------------------------------------------------------------------------
// Dix crans ne font pas une hiérarchie, ils font du désordre. Trois crans
// propres à chaque papier, plus celui des intitulés qui vient du socle.
// TROIS CRANS DE TEXTE, et rien d'autre ne porte de taille de police. Les
// jetons de RYTHME (le pas d'une ligne, la gouttière entre colonnes) sont d'une
// autre nature : ils ne se lisent pas, ils cadencent. Ils sont nommés ici un par
// un — c'est ce qui empêche une taille de police de se glisser parmi eux.
const CRANS = ['geant', 'cle', 'texte'];
const RYTHME = { tk: ['rang'], bu: ['rang', 'gouttiere'] };
for (const [nom, css, prefixe] of [['ticket', CSS_TICKET, 'tk'], ['bureau', CSS_BUREAU, 'bu']]) {
  const poses = [...new Set(css.match(new RegExp(`--${prefixe}-[a-z]+(?=:\\s*[\\d.]+px)`, 'g')) || [])]
    .map((j) => j.slice(prefixe.length + 3));
  assert.deepStrictEqual(poses.filter((j) => !RYTHME[prefixe].includes(j)).sort(), [...CRANS].sort(),
    `le ${nom} ne doit poser que trois crans de texte, il pose : ${poses.join(' · ')}`);
}
// ET AUCUN PAS DE LIGNE ÉCRIT EN CLAIR. Le cadre à écrire du ticket réglait ses
// lignes à 31 et 32 px en dur : une hauteur écrite se recopie de travers, et le
// rythme se casse à la troisième reprise.
for (const [nom, css] of [['CSS_TICKET', CSS_TICKET], ['CSS_BUREAU', CSS_BUREAU]]) {
  assert.ok(!/repeating-linear-gradient\([^)]*\d+px/.test(css),
    `${nom} : le pas des lignes réglées est un jeton, pas un nombre`);
}
// LE PLUS GROS CARACTÈRE D'UN DOCUMENT DU BUREAU EST LE MONTANT, jamais son
// titre. « BON DE COMMANDE » sortait à 34 px au-dessus d'un total à 30 :
// le papier criait ce qu'il est au lieu de ce qu'il dit.
const px = (css, re) => {
  const m = css.match(re);
  assert.ok(m, `${re} introuvable`);
  return parseFloat(m[1]);
};
const geantBu = px(CSS_BUREAU, /--bu-geant:\s*([\d.]+)px/);
const cleBu = px(CSS_BUREAU, /--bu-cle:\s*([\d.]+)px/);
assert.ok(geantBu > cleBu,
  `le montant (${geantBu}) doit dominer le titre (${cleBu}) sur un document du bureau`);
assert.match(CSS_BUREAU, /\.bu__ttc-v \{[^}]*font-size: var\(--bu-geant\)/,
  'et c’est bien le TTC qui porte ce cran');
assert.match(CSS_BUREAU, /\.bu__titre \{[^}]*font-size: var\(--bu-cle\)/,
  '… pendant que le titre prend celui des identifiants');

// ---------------------------------------------------------------------------
// 3. UN NOMBRE NE SE CASSE JAMAIS EN DEUX LIGNES
// ---------------------------------------------------------------------------
// Mesuré le 28/08 sur deux jeux d'essai : « 60 » sortait en 6 puis 0, et « 12 »
// en 1 puis 2. La colonne de la quantité était élastique comme celle de la
// désignation, et `overflow-wrap: anywhere` — posé pour qu'une référence longue
// puisse se couper — s'appliquait aussi au nombre.
assert.match(CSS_TICKET, /\.tk__ident-col--d \{[^}]*flex: 0 0 auto/,
  'la colonne de la quantité ne se comprime pas');
assert.match(CSS_TICKET, /\.tk__ident-qte[^{]*\{[^}]*white-space: nowrap/,
  'et son contenu ne revient jamais à la ligne');
// Le point de coupure vit sur la RÉFÉRENCE seule — un code peut se couper, un
// nombre non. Posé sur `.tk__geant` nu, il attrapait les deux.
assert.ok(!/\n\s*\.tk__geant \{[^}]*overflow-wrap/.test(CSS_TICKET),
  'le point de coupure ne doit pas être sur le cran géant nu : il attraperait la quantité');
assert.match(CSS_TICKET, /\.tk__ident-col \.tk__geant \{[^}]*overflow-wrap: anywhere/,
  '… il vit sur la colonne de gauche, celle qui porte une référence ou une phrase');

// ---------------------------------------------------------------------------
// 4. LE BON DE COMMANDE DIT DE QUI IL VIENT
// ---------------------------------------------------------------------------
// C'était LE défaut de fond. Un bon de commande sans nom, sans adresse et sans
// numéro légal ne se classe pas, ne se joint pas, ne s'oppose pas.
const MAISON = {
  nom: 'Atelier OLDA', adresse: '27 rue de Hollande', ville: '97150 Marigot',
  tel: '0590 87 12 34', email: 'contact@exemple.fr', siret: '812 345 678 00019',
  tva: '', web: '',
};
const LIGNE = {
  id: 'x', billing_company: 'Hôtel La Samanna', client_type: 'pro',
  contact_referent: 'Julie Marchand', contact_phone: '0690 55 21 08',
  responsable: 'Mélina', deadline: '2026-09-08', created_at: '2026-08-28T14:12:00Z',
  description: 'Sweats pour l’équipe', project_value: 972, cout_revient: 410,
  paye: true, paiement_mode: 'cb',
  fiche: {
    source: 'Vente directe', ref: '26.08.28-014', creeLe: '2026-08-28T14:12:00Z',
    // Le comptoir range le secteur et l'adresse dans le bloc client ET dans le
    // récapitulatif : les deux sources portent les mêmes lignes.
    client: [['Secteur', 'Hôtellerie'], ['Adresse', '12 route de Baie Longue']]
      .map(([k, v]) => ({ k, v })),
    details: [
      ['Commande', '26.08.28-014'], ['Origine', 'Vente directe'],
      ['Secteur', 'Hôtellerie'], ['Adresse', '12 route de Baie Longue'],
      ['Délai souhaité', 'Sous 10 jours ouvrés'],
      ['Note interne OLDA', 'Cliente pressée — prévenir dès que le DTF est prêt.'],
      ['Article 1 — Désignation', 'Sweat capuche molleton NS300'],
      ['Article 1 — Quantité', '24'], ['Article 1 — Prix article', '28,00 €'],
      ['Article 1 — Prix personnalisation', '12,50 €'],
      ['Article 1 — Total TTC', '972,00 €'],
    ].map(([k, v]) => ({ k, v })),
  },
};

const modele = modeleBureau(LIGNE, MAISON);
const feuille = dessinerBureau(modele, faireDoc());
const surLaFeuille = texteEntier(feuille);

for (const attendu of ['Atelier OLDA', '27 rue de Hollande', '97150 Marigot', '0590 87 12 34']) {
  assert.ok(surLaFeuille.includes(attendu),
    `le bon de commande doit porter « ${attendu} » : sans émetteur, ce n’est pas un document`);
}
// LES MENTIONS LÉGALES SONT AU PIED, là où on les cherche sur un document
// commercial — pas dans l'en-tête, où elles disputent la place à ce qui sert
// tous les jours (le nom, l'adresse, de quoi joindre la maison).
assert.ok(tousLes(feuille, 'bu__pied').length === 1
  && texteEntier(tousLes(feuille, 'bu__pied')[0]).includes('812 345 678 00019'),
  'le SIRET est au pied du document, pas dans son en-tête');
// UN CHAMP VIDE NE S'IMPRIME PAS. Rien n'est inventé : tant que les réglages
// sont vides, le papier porte le seul nom qu'on connaisse, et c'est honnête.
const nue = dessinerBureau(modeleBureau(LIGNE, { nom: 'Atelier OLDA' }), faireDoc());
assert.ok(!/TVA|SIRET/.test(texteEntier(nue)),
  'un numéro non renseigné ne sort pas : « SIRET : — » vaut moins que rien du tout');
// L'IDENTITÉ VIENT DES RÉGLAGES, JAMAIS DU CODE. Une adresse écrite en dur
// demanderait un déploiement le jour d'un déménagement — et resterait fausse
// sur tous les papiers imprimés en attendant.
assert.ok(!/\d{3}\s?\d{3}\s?\d{3}\s?\d{5}/.test(BUREAU),
  'aucun numéro légal en dur dans bureau.js : il se règle, il ne se déploie pas');
// Et le TEXTE le porte aussi : c'est ce qu'on colle dans un e-mail.
assert.ok(bureauTexte(modele).startsWith('Atelier OLDA'),
  'le document en texte dit lui aussi de qui il vient');

// DEUX NUMÉROS QUI SE LISENT, PAS QUI SE DÉCHIFFRENT. Le patron saisit ce qu'il
// a sous les yeux — « 0690479788 », « 97829695200028 » — et c'est très bien :
// on ne lui impose pas une saisie formatée qu'il faudrait réussir du premier
// coup. C'est l'AFFICHAGE qui habille, et la valeur stockée ne bouge jamais.
// Les numéros de ce jeu d'essai sont FICTIFS : ceux de l'atelier vivent en base,
// pas dans le dépôt.
const lisible = modeleBureau(LIGNE, {
  ...MAISON, tel: '0590123456', siret: '12345678900012', tva: 'FR00123456789',
}).maison;
assert.ok(lisible.contact.includes('05 90 12 34 56'),
  'un numéro français se lit par paires, pas en dix chiffres collés');
assert.ok(lisible.legal.includes('SIRET 123 456 789 00012'),
  'un SIRET s’écrit groupé : trois fois trois du SIREN, puis les cinq du NIC');
// Le n° de TVA intracommunautaire, lui, s'écrit d'un bloc : ce n'est pas un
// oubli de symétrie, c'est sa convention.
assert.ok(lisible.legal.includes('TVA FR00123456789'), 'le n° de TVA reste d’un bloc');
// ET ON NE TOUCHE QUE CE QU'ON RECONNAÎT. Un numéro international, une saisie
// déjà espacée, un SIRET incomplet ressortent TELS QUELS : mieux vaut un numéro
// brut qu'un numéro découpé de travers sur le document qui sert à facturer.
const brut = modeleBureau(LIGNE, {
  ...MAISON, tel: '+590590123456', siret: '1234567890', tva: '',
}).maison;
assert.ok(brut.contact.includes('+590590123456'),
  'un numéro international n’a pas le découpage d’un numéro national');
assert.ok(brut.legal.includes('SIRET 1234567890'),
  'un SIRET qui n’a pas ses quatorze chiffres ressort tel quel');

// ---------------------------------------------------------------------------
// 4 bis. TOUT EST DROIT — une seule grille, des rangées imposées
// ---------------------------------------------------------------------------
// Charlie, 28/08, capture à l'appui : « tout doit être bien droit sur des lignes
// parfaitement lisibles ». Les colonnes CLIENT et DOSSIER étaient deux boîtes
// indépendantes : la première rangée de gauche tombait à 194,4 px du haut de la
// feuille, celle de droite à 169,8 — 24,6 px d'écart, et les rangées suivantes
// ne se rattrapaient jamais. Deux colonnes qu'on lit ensemble et dont aucune
// ligne n'est en face de l'autre.
//
// Une SEULE grille les porte, et les cellules y sont posées en alternance :
// gauche, droite, gauche, droite. La rangée est alors imposée par la grille et
// non par le hasard des contenus — c'est structurel, pas cosmétique, et c'est
// pour ça que ça se teste ici et pas seulement à l'oeil.
const grilles = tousLes(feuille, 'bu__grille');
assert.ok(grilles.length >= 1, 'l’identité est portée par une grille, pas par deux boîtes');
const identite = grilles[0];
assert.strictEqual(identite.enfants.length % 2, 0,
  'la grille se remplit par PAIRES de cellules : un compte impair décale toute la colonne');
// Le jeu d'essai a six entrées à gauche (le nom, le type, le contact, plus le
// secteur et l'adresse recueillis) contre trois à droite. Les rangées manquantes
// sont comblées par des cellules vides QUI GARDENT LEUR FILET : un tableau à
// trous se lit comme un tableau, un tableau dont les traits s'arrêtent au milieu
// se lit comme une erreur.
assert.ok(tousLes(identite, 'bu__paire--vide').length > 0,
  'une colonne plus courte que l’autre reçoit des cellules vides, sinon la réglure se casse');
// … ET AUCUNE BOÎTE INDÉPENDANTE NE REVIENT. C'est le retour de `.bu__bloc` qui
// avait produit le décalage : deux cadres, deux rembourrages, deux rythmes.
assert.ok(!/\.bu__bloc\b/.test(CSS_BUREAU) && !/'bu__bloc'/.test(BUREAU),
  'les colonnes ne redeviennent pas deux cadres indépendants');
// UNE LIGNE, UNE HAUTEUR, et c'est un JETON — écrite en clair, elle se recopie
// de travers et le rythme se casse à la troisième reprise.
for (const regle of ['.bu__paire', '.bu__nom', '.bu__mesure']) {
  assert.match(CSS_BUREAU, new RegExp(`\\${regle} \\{[^}]*min-height: var\\(--bu-rang\\)`),
    `${regle} prend la hauteur de rangée du document`);
}
// UN DOSSIER SANS RÉFÉRENCE N'ÉCRIT PAS DE TIRET. Une ligne créée à la main dans
// la grille n'a pas de numéro de comptoir : le document affichait un tiret seul
// en 17 px sous son titre, à l'endroit le plus regardé de la feuille.
const sansRef = dessinerBureau(modeleBureau({ ...LIGNE, fiche: {} }, MAISON), faireDoc());
assert.strictEqual(tousLes(sansRef, 'bu__ref-v').length, 0,
  'pas de référence, pas de ligne — un tiret seul sous le titre ne dit rien');

// ---------------------------------------------------------------------------
// 5. AUCUNE LIGNE N'EST IMPRIMÉE DEUX FOIS
// ---------------------------------------------------------------------------
// « Adresse : 12 route de Baie Longue » sortait deux fois, à quinze lignes
// d'écart, sur le document qui sert à facturer. Une liste figée ne pouvait pas
// l'attraper : c'est le RENDU du bloc client qui décide de ce qu'il montre,
// donc c'est le rendu qu'on interroge.
for (const cle of ['Secteur', 'Adresse']) {
  const fois = surLaFeuille.split('\n').filter((l) => l.trim() === cle).length;
  assert.strictEqual(fois, 1, `« ${cle} » est imprimé ${fois} fois sur la même feuille`);
}
// Ce que l'EN-TÊTE porte maintenant ne se réécrit pas quinze lignes plus bas :
// « Commande » est la référence en haut à droite, et « Origine » dit « Vente
// directe » sous un titre qui s'appelle déjà « Bon de commande ».
const clesRecueil = modele.dossier.map((x) => x.k);
assert.ok(!clesRecueil.includes('Commande') && !clesRecueil.includes('Origine'),
  'le récapitulatif ne répète pas ce que l’en-tête vient d’écrire');
// UNE NOTE INTERNE VA DANS LE CADRE INTERNE. Elle sortait au milieu de ce que
// la vendeuse a recueilli — c'est-à-dire dans la partie qu'on montre — alors
// que le cadre pointillé juste dessous existe pour ça.
assert.ok(!clesRecueil.some((k) => /note interne/i.test(k)),
  'une note interne ne reste pas dans le bloc que le client peut lire');
const interne = tousLes(feuille, 'bu__interne')[0];
assert.ok(interne && texteEntier(interne).includes('Cliente pressée'),
  '… elle est dans le cadre « ne pas remettre au client »');

// ---------------------------------------------------------------------------
// 6. LA DATE DE RETRAIT N'EST ÉCRITE QU'UNE FOIS SUR LE TICKET
// ---------------------------------------------------------------------------
// Elle est montée en tête, à côté du titre : c'est la seule chose qui fasse
// ORDONNER le travail, et on la cherche avant tout le reste sur une pile. Elle
// restait en même temps dans la rangée du client, deux centimètres plus bas.
const tk = dessinerTicket({
  demande: false, titre: 'Ticket atelier', ref: 'X', date: '28/08/2026',
  retrait: '08/09/2026', client: 'Hôtel La Samanna', contact: 'Julie', tel: '0690',
  lot: null, lignes: [{ designation: 'Sweat capuche molleton', qte: '60', detail: '' }],
}, faireDoc());
const surLeTicket = texteEntier(tk);
assert.strictEqual(surLeTicket.split('\n').filter((l) => l.trim() === '08/09/2026').length, 1,
  'la date de retrait est écrite une fois : la carte ne dit pas deux fois la même chose');
assert.ok(surLeTicket.includes('À RETIRER LE'), 'et son intitulé dit ce qu’elle est');

// ---------------------------------------------------------------------------
// 6 bis. UN SEUL TABLEAU POUR TOUTE LA PRODUCTION DU TICKET
// ---------------------------------------------------------------------------
// Il y en avait TROIS pour un seul geste — regarder une taille et savoir quoi
// faire : la grille des quantités, les cotes du dos relistées en colonne dans sa
// carte, et un bloc de cartes pour les autres faces. Charlie, 28/08 : « ces
// tailles doivent être sous les tailles », puis, en désignant les cartes qui
// restaient : « celles-là aussi ».
assert.ok(!/tk__grille|tk__case|tk__quoi|tk__mes\b/.test(CSS_TICKET),
  'les grilles de cartes sont parties : une feuille de style qui décrit un bloc '
  + 'absent finit par le faire réapparaître');
assert.match(CSS_TICKET, /\.tk__matrice \{[^}]*table-layout: fixed/,
  'un TABLEAU et non une grille : les colonnes font la même largeur quel que '
  + 'soit leur nombre, sans que le rendu ait à compter');
// LE CONTRÔLE DE CONFORMITÉ EST PARTI (« ça, ça dégage »). C'était un cadre à
// cocher et une phrase de treize mots — deux centimètres de feuille pour une
// case que personne ne cochait. Ce qui prouve qu'une pièce a été vue, c'est
// l'étape franchie au planning, pas une signature sur le papier qui part avec.
for (const parti of ['tk__conformite', 'tk__case-a-cocher', 'CONTRÔLE DE CONFORMITÉ']) {
  assert.ok(!CSS_TICKET.includes(parti) && !TICKET.includes(`'${parti}`),
    `« ${parti} » a été retiré du ticket : le laisser, c'est le rouvrir`);
}
// ET LE TABLEAU NE S'APPELLE PAS « MARQUAGE » : ce mot est déjà l'intitulé de la
// TECHNIQUE, trois centimètres plus haut dans la boîte d'identité
// (« MARQUAGE · DTF · Blanc »). Deux fois le même intitulé pour deux choses
// différentes sur la même feuille, c'est une feuille qu'on relit.
const titresTk = (prod) => {
  const t = { demande: false, titre: 'Ticket atelier', ref: 'X', date: '28/08/2026',
    retrait: '08/09/2026', client: 'C', contact: '', tel: '', lot: null,
    lignes: [{ designation: 'A', qte: '9', detail: '', prod }] };
  return tousLes(dessinerTicket(t, faireDoc()), 'tk__bloc-titre').map((n) => n.textContent);
};
const avecTailles = titresTk({ ref: 'R', couleur: '', marquage: 'DTF', encre: 'Blanc',
  tailles: [{ t: 'S', n: '4' }], logos: [{ face: 'Dos', quoi: '', mm: '90' }] });
assert.deepStrictEqual(avecTailles, ['MARQUAGE', 'TAILLES ET FACES', 'INFORMATIONS'],
  'un seul bloc pour les tailles ET les faces, et il ne redit pas « marquage »');
const sansTailles = titresTk({ ref: '', couleur: '', marquage: 'UV', encre: '',
  tailles: [], logos: [{ face: 'Fond', quoi: 'Logo', mm: '' }] });
assert.deepStrictEqual(sansTailles, ['MARQUAGE', 'FACES À MARQUER', 'INFORMATIONS'],
  'une tasse n’ouvre aucune colonne de taille : ses faces suffisent');

// UNE COLONNE SE LIT SEULE, et c'est la règle qui gouverne tout ce tableau.
// Charlie, 28/08 : « les tailles des coeur même identique doivent apparaître
// sous les tailles ». À l'établi on prend UNE taille et on veut y lire tout ce
// qu'il faut pour elle. Une cote posée une fois en travers des colonnes — même
// juste, même économe — oblige à sortir de sa colonne pour aller la chercher, et
// c'est en revenant qu'on lit la ligne du dessus. La même valeur revient donc
// sous chaque taille, et AUCUNE cellule n'en couvre deux.
const tkCotes = dessinerTicket({
  demande: false, titre: 'Ticket atelier', ref: 'X', date: '28/08/2026',
  retrait: '08/09/2026', client: 'C', contact: '', tel: '', lot: null,
  lignes: [{ designation: 'A', qte: '9', detail: '', prod: {
    ref: 'R', couleur: '', marquage: 'DTF', encre: '',
    tailles: [{ t: 'S', n: '4' }, { t: 'M', n: '8' }, { t: 'L', n: '3' }],
    // Une cote unique, une cote par taille, et une face à mesurer : les trois
    // cas, sur la même feuille.
    logos: [{ face: 'Coeur', quoi: '', mm: '90' },
      { face: 'Dos', quoi: '', mm: 'S 240/M 260/L 280' },
      { face: 'Manche', quoi: '', mm: '' }],
  } }],
}, faireDoc());
const cases = tousLes(tkCotes, 'tk__matrice-v');
assert.strictEqual(cases.length, 4 * 3,
  'quatre lignes de trois colonnes : aucune cellule ne manque');
assert.ok(cases.every((c) => !c.attrs || !c.attrs.colspan),
  'aucune cellule ne couvre plusieurs tailles : une colonne se lit seule');
assert.deepStrictEqual(cases.slice(3, 6).map((c) => c.textContent), ['90', '90', '90'],
  'une cote unique se répète sous chaque taille — c’est la MÊME valeur, pas une absence');
assert.deepStrictEqual(cases.slice(6, 9).map((c) => c.textContent), ['240', '260', '280'],
  '… et une cote qui varie tombe sous la sienne');
assert.strictEqual(tousLes(tkCotes, 'tk__aecrire').length, 3,
  'une face à mesurer ouvre un trait PAR TAILLE : la cote peut changer de l’une à l’autre');

// ---------------------------------------------------------------------------
// 7. LES DEUX PAPIERS SE DESSINENT HORS NAVIGATEUR
// ---------------------------------------------------------------------------
// C'est cette portabilité qui permet de vérifier une feuille sans ouvrir
// Chrome — et elle se perd au premier `style.width` posé à la main. Les
// largeurs de colonnes du bon de commande l'ont cassée le jour même où elles
// ont été déclarées : le DOM minimal des tests n'a pas de propriété `style`.
const rendus = [
  ['ticket.js', TICKET.slice(TICKET.indexOf('export function dessinerTicket'))],
  ['bureau.js', BUREAU.slice(BUREAU.indexOf('export function dessinerBureau'),
    BUREAU.indexOf('export function bureauTexte'))],
];
for (const [nom, src] of rendus) {
  assert.ok(!/\.style\b/.test(src),
    `${nom} ne pose aucun style en ligne : les largeurs se déclarent en CSS`);
}

// ---------------------------------------------------------------------------
// 8. LES DEUX GABARITS RESTENT ENTIERS
// ---------------------------------------------------------------------------
// Un accent grave dans un commentaire TERMINE le littéral. Le module reste
// syntaxiquement valide, `node --check` passe, et l'écran s'ouvre NU. C'est le
// contrôle le moins cher du dépôt, et il a déjà servi trois fois.
for (const [nom, css] of [['CSS_TICKET', CSS_TICKET], ['CSS_BUREAU', CSS_BUREAU]]) {
  assert.ok(!css.includes(String.fromCharCode(96)),
    `un accent grave dans ${nom} referme le gabarit : l’écran s’affiche NU`);
  assert.ok(/width:\s*210mm/.test(css) && /min-height:\s*297mm/.test(css),
    `${nom} fait un A4 par construction`);
}
// LE BLOC ÉLASTIQUE N'A PAS DE HAUTEUR MINIMALE. Avec un plancher en pixels il
// s'ajoutait aux blocs du dessus au lieu de prendre ce qui reste, et la feuille
// partait sur une SECONDE page presque vide — mesuré à 1183 px pour 1123.
assert.match(CSS_TICKET, /\.tk__infos \{[^}]*flex: 1; min-height: 0/,
  'le cadre à écrire absorbe ce qui reste, il ne pousse pas la feuille');

console.log('✓ papiers : quatre crans par feuille, un nombre qui ne se casse pas, '
  + 'un émetteur sur le bon de commande et plus une ligne imprimée deux fois');
