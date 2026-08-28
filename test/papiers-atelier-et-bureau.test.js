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
    tag, className: '', textContent: '', enfants: [],
    append(...n) { this.enfants.push(...n); },
    appendChild(n) { this.enfants.push(n); return n; },
    setAttribute() {},
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
for (const [nom, css, prefixe] of [['ticket', CSS_TICKET, 'tk'], ['bureau', CSS_BUREAU, 'bu']]) {
  const crans = [...new Set(css.match(new RegExp(`--${prefixe}-[a-z]+:\\s*[\\d.]+px`, 'g')) || [])];
  assert.strictEqual(crans.length, 3,
    `le ${nom} déclare ${crans.length} crans de texte au lieu de 3 : ${crans.join(' · ')}`);
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
