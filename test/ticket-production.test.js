'use strict';

// LE TICKET DIT CE QU'IL Y A À PRODUIRE (26/08/2026)
//
// Charlie : « toutes ces infos doivent apparaître dans le ticket ». Le papier
// de l'établi portait le client, la date et la désignation — puis une phrase du
// comptoir où la référence, les tailles et les largeurs de logo étaient noyées.
// Or c'est exactement ce qui décide de la coupe et du FICHIER d'impression.
//
// Ce fichier tient la structure du papier :
//
//   1. LA PRODUCTION EST SUR LE TICKET, en faits séparés — et la fiche de
//      production décrit UN article : elle ne s'écrit pas sur un papier qui en
//      porte plusieurs, elle ne saurait pas duquel elle parle.
//   2. RIEN N'EST DIT DEUX FOIS : le résumé « Catégorie · Couleur · Production »
//      d'un besoin s'efface quand le bloc écrit les trois en clair.
//   3. LES TAILLES SE LISENT EN TABLEAU, jamais en phrase.
//   4. CE QUI SE RECTIFIE À L'ÉTABLI s'enregistre — par POSITION, et rien
//      d'autre ne passe par cette porte.
//   5. TOUJOURS PAS UN EURO.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chargerPapier } = require('./socle-papier.js');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const APP = lire('public/app.js');

// On charge le VRAI source (module ES du navigateur) dans un bac à sable, avec
// le socle des deux papiers collé devant — voir test/socle-papier.js.
const bac = chargerPapier('ticket.js',
  ['modeleTicket', 'ticketTexte', 'dessinerTicket', 'CSS_TICKET']);
const { modeleTicket, ticketTexte, dessinerTicket, CSS_TICKET } = bac;

const PROD = {
  ref: 'K3008', couleur: 'Rouge', marquage: 'DTF', encre: 'Blanc',
  tailles: [{ t: 'S', n: 12 }, { t: 'M', n: 20 }],
  logos: [{ face: 'Coeur', mm: '80' }, { face: 'Dos', mm: 'S 300/M 320' }],
};

const DEMANDE = {
  id: 'd1',
  order_kind: 'demande',
  billing_company: 'AS Sandy Ground',
  contact_referent: 'Michel Fleming',
  contact_phone: '06 90 63 55 18',
  product: 'Maillots supporters',
  deadline: '2026-09-04',
  fiche: {
    kind: 'comptoir-v17', source: 'Demande de devis', ref: '26.08.26-014',
    creeLe: '2026-08-26T14:00:00.000Z', heureSouhaitee: '10:00',
    prod: PROD,
    details: [
      { k: 'Besoin 1 — Désignation', v: 'T-shirt unisexe Oversize épais 220 g' },
      { k: 'Besoin 1 — Quantité', v: '32' },
      { k: 'Besoin 1 — Catégorie', v: 'Textile' },
      { k: 'Besoin 1 — Couleur', v: 'Rouge' },
      { k: 'Besoin 1 — Production', v: 'DTF' },
    ],
  },
};

// ---------------------------------------------------------------------------
// 1. LA PRODUCTION EST SUR LE TICKET
// ---------------------------------------------------------------------------
const t = modeleTicket(DEMANDE);
assert.strictEqual(t.lignes.length, 1);
const p = t.lignes[0].prod;
assert.ok(p, 'la ligne du ticket doit porter ce qu’il y a à produire');
assert.strictEqual(p.ref, 'K3008');
assert.strictEqual(p.couleur, 'Rouge');
assert.strictEqual(p.encre, 'Blanc');
assert.strictEqual(p.tailles.length, 2);
assert.strictEqual(p.logos.length, 2);

// 2. RIEN N'EST DIT DEUX FOIS. Le résumé « Textile · Rouge · DTF » d'un besoin
// répétait mot pour mot ce que le bloc écrit deux centimètres plus bas.
assert.strictEqual(t.lignes[0].detail, '',
  'le résumé du besoin s’efface quand le bloc de production dit la même chose');

const papier = ticketTexte(t);
// LES QUATRE FAITS QU'ON CHERCHE DU REGARD (Charlie, 26/08), dans cet ordre :
// la RÉFÉRENCE et la QUANTITÉ ensemble, puis la COULEUR DU MARQUAGE, puis les
// tailles, puis la LARGEUR DE CHAQUE LOGO.
assert.match(papier, /^K3008 — 32 pièces$/m);
// La couleur du VÊTEMENT et la désignation confirment qu'on a la bonne boîte :
// elles se lisent après, jamais à la place.
assert.match(papier, /^ {2}Rouge · T-shirt unisexe Oversize épais 220 g$/m);
// LA COULEUR DU MARQUAGE N'EST PAS CELLE DU VÊTEMENT. « DTF » tout seul ne dit
// pas quel rouleau charger ; sur un t-shirt rouge, blanc ou noir change tout.
// La technique NOMME, la couleur DÉCIDE — et le mot « encre » ne s'écrit nulle
// part, la clé de la fiche s'appelle ainsi mais pas l'écran.
assert.match(papier, /^ {2}Marquage : DTF · Blanc$/m);
// L'INTITULÉ NE VARIE PAS avec la technique : « SÉRIGRAPHIE » puis « DTF » sur
// la carte d'à côté, c'était une colonne d'intitulés à largeur variable.
const serigraphie = ticketTexte(modeleTicket({
  ...DEMANDE, fiche: { ...DEMANDE.fiche, prod: { ...PROD, marquage: 'Sérigraphie', encre: 'Or' } },
}));
assert.match(serigraphie, /^ {2}Marquage : Sérigraphie · Or$/m);
// Sans couleur connue, la rangée dit au moins la technique — jamais un trou.
const sansCouleur = ticketTexte(modeleTicket({
  ...DEMANDE, fiche: { ...DEMANDE.fiche, prod: { ...PROD, encre: '' } },
}));
assert.match(sansCouleur, /^ {2}Marquage : DTF$/m);
assert.ok(!/encre/i.test(papier), `le papier ne dit plus « encre » :\n${papier}`);
assert.match(papier, /Tailles : 12 x S {2}20 x M/);
// « ZONE », plus « Logo » : une face de tasse ou une zone de gravure n'accueille
// pas forcément un logo, et le mot décidait de ce qu'on croyait pouvoir y mettre.
assert.match(papier, /Zone Coeur : 80 mm/);
assert.match(papier, /Zone Dos : S 300\/M 320 mm/);
// 5. TOUJOURS PAS UN EURO — le contrôle qui tient tout seul.
assert.ok(!papier.includes('€'), `aucun montant sur un ticket d’atelier :\n${papier}`);

// LA DATE DE PRISE NE FAIT PAS PRODUIRE : elle est descendue au pied, avec la
// signature. En tête, elle repoussait d'autant la première ligne utile.
const lignesPapier = papier.split('\n');
assert.ok(lignesPapier.indexOf('Commande prise le 26/08/2026')
  > lignesPapier.findIndex((x) => x.includes('T-shirt')),
  'la date de prise se lit APRÈS le travail, pas avant');

// ---------------------------------------------------------------------------
// 2 bis. UN PAPIER QUI PORTE PLUSIEURS ARTICLES NE PORTE PAS LA FICHE
// ---------------------------------------------------------------------------
// `fiche.prod` décrit UN article. Sur un dossier que l'argent n'a pas permis de
// découper, l'écrire annoncerait les tailles du premier au-dessus du second.
const DEUX = {
  ...DEMANDE,
  fiche: {
    ...DEMANDE.fiche,
    details: [
      ...DEMANDE.fiche.details,
      { k: 'Besoin 2 — Désignation', v: 'Casquette K3025' },
      { k: 'Besoin 2 — Quantité', v: '20' },
    ],
  },
};
const t2 = modeleTicket(DEUX);
assert.strictEqual(t2.lignes.length, 2);
assert.strictEqual(t2.lignes[0].prod, undefined,
  'deux articles sur un papier : la fiche de production ne saurait pas duquel elle parle');
assert.ok(!ticketTexte(t2).includes('K3008'));

// Une fiche sans production ne fabrique pas un bloc vide.
const t3 = modeleTicket({ ...DEMANDE, fiche: { ...DEMANDE.fiche, prod: null } });
assert.strictEqual(t3.lignes[0].prod, undefined);
assert.strictEqual(t3.lignes[0].detail, 'Textile · Rouge · DTF',
  'sans bloc de production, le résumé du besoin reprend sa place — il est tout ce qu’on a');

// UNE ZONE SANS MESURE RESTE UNE ZONE À MARQUER (règle inversée le 26/08).
//
// L'ancienne règle — « une largeur vide n'ouvre pas de ligne » — se tenait tant
// que le ticket ne parlait que de textile, où la largeur arrive du catalogue.
// Hors textile elle faisait disparaître le travail : les trois faces d'une
// tasse (les deux flancs et le fond) arrivent NOMMÉES et SANS largeur, parce
// qu'on les mesure à l'établi. La face effacée, l'atelier ne savait même plus
// qu'il y avait un fond à marquer — et un fond oublié, c'est une tasse à refaire.
//
// On garde donc la zone, et le papier sort un trait pour écrire la mesure.
const t4 = modeleTicket({
  ...DEMANDE,
  fiche: { ...DEMANDE.fiche, prod: { ...PROD, logos: [{ face: 'Dos', mm: '' }], tailles: [] } },
});
assert.strictEqual(t4.lignes[0].prod.logos.length, 1, 'la zone survit à l’absence de mesure');
assert.strictEqual(t4.lignes[0].prod.logos[0].face, 'Dos');
assert.strictEqual(t4.lignes[0].prod.logos[0].mm, '');
assert.strictEqual(t4.lignes[0].prod.tailles.length, 0, 'une taille sans nombre, elle, ne dit rien');

// UNE TASSE : une seule taille, trois faces. Le papier ne doit pas lui sortir de
// grille de tailles — « Taille unique » occupe une colonne pour ne rien
// apprendre, la quantité est déjà écrite en 64 px juste au-dessus.
const TASSE = {
  ...DEMANDE,
  fiche: {
    ...DEMANDE.fiche,
    prod: {
      ref: 'TC 06', couleur: 'Noir (ext.) / Blanc (int.)', marquage: 'UV', encre: 'Quadri',
      tailles: [{ t: 'Taille unique', n: 24 }],
      logos: [{ face: 'Face A', mm: '' }, { face: 'Face B', mm: '' }, { face: 'Fond', mm: '' }],
    },
  },
};
const tTasse = modeleTicket(TASSE).lignes[0].prod;
assert.strictEqual(tTasse.logos.length, 3, 'les deux flancs et le fond');
assert.deepStrictEqual(tTasse.logos.map((z) => z.face), ['Face A', 'Face B', 'Fond']);
const papierTasse = ticketTexte(modeleTicket(TASSE));
assert.match(papierTasse, /Zone Fond : à préciser/,
  'une zone sans rien s’annonce quand même — c’est le fond qu’on oublie ; et le '
  + 'mot dit bien ce qui manque : PAS seulement une mesure, la consigne aussi');

// ---------------------------------------------------------------------------
// 3. LA MISE EN PAGE DU PAPIER
// ---------------------------------------------------------------------------
// QUATRE CRANS, ET PAS UN DE PLUS (28/08).
// Le papier en déclarait DIX : 64 / 44 / 40 / 25 / 23 / 18 / 17 / 15 / 12 / 10.
// Charlie, capture à l'appui : « les polices sont démesurées sur le ticket
// atelier ». Dix crans ne font pas une hiérarchie, ils font du désordre — et
// sur un papier d'établi le désordre coûte une réimpression.
//   --tk-geant  ce qu'on cherche du regard sur une pile : la référence et la
//               quantité. DEUX faits, une taille.
//   --tk-cle    ce qui décide : client, date de retrait, marquage, nombre par
//               taille, cote par face.
//   --tk-texte  ce qui se lit.
// Le quatrième (les intitulés) vit dans le socle partagé avec le bon de
// commande. Ce test tient le NOMBRE de crans, pas les valeurs : c'est le
// nombre qui dérive au troisième ajout.
for (const jeton of ['--tk-geant: 52px', '--tk-cle: 24px', '--tk-texte: 15px']) {
  assert.ok(CSS_TICKET.includes(jeton), `l’échelle du ticket doit poser ${jeton}`);
}
const cransTicket = [...new Set((CSS_TICKET.match(/--tk-[a-z]+:\s*[\d.]+px/g) || []))];
assert.strictEqual(cransTicket.length, 3,
  `le ticket ne déclare que trois crans de texte en propre, il en a ${cransTicket.length} : ${cransTicket.join(' · ')}`);
for (const parti of ['--tk-titre', '--tk-nombre', '--tk-fort', '--tk-mes', '--tk-note', '--tk-etiq']) {
  assert.ok(!CSS_TICKET.includes(parti),
    `« ${parti} » a été fondu dans les trois crans : le laisser, c'est le rouvrir`);
}
assert.ok(!/font(?:-size)?:[^;]*?\d+px/.test(CSS_TICKET.replace(/\/\*[\s\S]*?\*\//g, ' ')),
  'aucune taille en dur : tout passe par les jetons');
// LA PLUS GRANDE TAILLE NE PORTE QUE LA RÉFÉRENCE ET LA QUANTITÉ — les deux
// seuls faits qu'on cherche du regard sur une pile de papiers.
assert.strictEqual((CSS_TICKET.match(/var\(--tk-geant\)/g) || []).length, 1,
  'le plus grand corps n’habille qu’une seule règle');
// … ET IL NE CASSE JAMAIS UN NOMBRE. La colonne de la quantité était élastique
// comme celle de la désignation : sur « Tasse céramique 350 ml », la phrase
// prenait toute la largeur et le 60 sortait en DEUX LIGNES, un 6 au-dessus d'un
// 0 — mesuré le 28/08 sur deux jeux d'essai, dont une demande de devis (« 12 »).
assert.match(CSS_TICKET, /\.tk__ident-col--d \{[^}]*flex: 0 0 auto/,
  'la colonne de la quantité ne se comprime pas : c’est la phrase qui s’enroule');
assert.match(CSS_TICKET, /\.tk__ident-qte[^{]*\{[^}]*white-space: nowrap/,
  'un nombre ne revient jamais à la ligne');
// LA FEUILLE DE STYLE EST UN LITTÉRAL GABARIT : un accent grave dans un
// commentaire CSS le TERMINE. Le module reste syntaxiquement valide (le
// morceau suivant devient un gabarit étiqueté), `node --check` passe, et
// l'application s'ouvre sur un écran NU — « .tk__champ is not a function ».
// Arrivé le 26/08 en citant un nom de classe entre accents graves, et REVENU le
// même jour en citant « style » de la même façon. C'est le contrôle le moins
// cher du dépôt.
assert.ok(!CSS_TICKET.includes('`'), 'aucun accent grave dans la feuille du ticket');

// AUCUN JETON ÉTRANGER. Le cadre d'impression ne charge QUE cette feuille :
// `charte.css` n'y est pas. Un `var(--pas-2)` emprunté à la charte y vaut la
// chaîne vide — le rembourrage tombe à zéro sur le PAPIER, et nulle part
// ailleurs, donc l'aperçu à l'écran (qui, lui, a la charte) paraît correct.
// C'est le même genre de panne que l'accent grave : invisible là où on regarde.
const jetonsEtrangers = [...new Set(
  (CSS_TICKET.match(/var\(\s*(--[a-z0-9-]+)/gi) || [])
    .map((m) => m.replace(/var\(\s*/i, ''))
    // `--pap-` est le SOCLE PARTAGÉ (papier.js) : l'encre, le filet, la marge
    // et la taille des intitulés, écrits une fois pour le ticket ET pour le bon
    // de commande. Ils sont posés sur la feuille elle-même, donc présents dans
    // le cadre d'impression — ce ne sont pas des jetons de `charte.css`.
    .filter((j) => !j.startsWith('--tk-') && !j.startsWith('--pap-')),
)];
assert.deepStrictEqual(jetonsEtrangers, [],
  `la feuille du ticket ne doit dépendre que de ses propres jetons : ${jetonsEtrangers.join(', ')}`);

// LE CADRE D'IDENTITÉ est le seul trait plein du papier : c'est là que l'œil
// tombe. La référence à gauche, la quantité à droite, sur la même ligne de base.
assert.match(CSS_TICKET, /\.tk__ident \{[^}]*border: 2px solid/);
assert.match(CSS_TICKET, /\.tk__ident-tete \{[^}]*justify-content: space-between/);
// La couleur du marquage porte la graisse forte, son intitulé reste une étiquette.
assert.match(CSS_TICKET, /\.tk__ident-mq-v \{[^}]*font-size: var\(--tk-cle\)/);

// LES DEUX GRILLES SONT LA MÊME GRILLE, à une largeur de case près : tailles et
// zones sont deux AXES INDÉPENDANTS. La maquette rangeait la largeur du dos
// DANS la carte de la taille — ça se tient pour un t-shirt et ça ne veut rien
// dire pour une tasse, qui a trois faces et une seule taille.
assert.match(CSS_TICKET, /\.tk__grille \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(/);
assert.match(CSS_TICKET, /\.tk__grille--zones \{[^}]*minmax\(/);
// ELLE COMPTE SES COLONNES EN CSS. Poser le nombre de colonnes en style EN LIGNE
// obligeait le rendu à connaître la largeur du papier, et rendait le ticket
// indessinable dans un DOM minimal — les tests le dessinent sans « style ».
const SRC_TICKET = lire('public/ticket.js');
const rendu = SRC_TICKET.slice(SRC_TICKET.indexOf('export function dessinerTicket'));
assert.ok(!/\.style\b/.test(rendu),
  'le rendu du ticket ne pose aucun style en ligne : la grille se compte en CSS');
// LE NOMBRE PAR TAILLE ET LA COTE PAR FACE SONT LE MÊME FAIT : ils sortent au
// même cran. Ils sortaient à 40 et 18 px dans deux cartes voisines du même rang.
assert.match(CSS_TICKET, /\.tk__case-v \{[^}]*font-size: var\(--tk-cle\)/);
assert.match(CSS_TICKET, /\.tk__mes-n \{[^}]*font-size: var\(--tk-cle\)/);
// UNE ZONE SANS MESURE SORT AVEC UN TRAIT POUR L'ÉCRIRE, pas avec un blanc :
// un blanc ne se remplit pas.
assert.match(CSS_TICKET, /\.tk__aecrire \{[^}]*border-bottom: 1px solid/);
// UN ARTICLE PAR FEUILLE : sans ça, deux tickets d'une même commande se suivent
// sur la même page et l'établi en perd un.
assert.match(CSS_TICKET, /\.tk \+ \.tk \{[^}]*break-before: page/);
assert.match(CSS_TICKET, /\.tk \+ \.tk \{[^}]*page-break-before: always/);

// CE QUE CHARLIE A FAIT RETIRER DU PAPIER LE 26/08, écran par écran. Rien de
// tout cela ne doit revenir par une règle laissée derrière : une feuille de
// style qui décrit un bloc absent finit par le faire réapparaître.
for (const parti of ['.tk__nom', '.tk__lieu', '.tk__remise', '.tk__atelier',
  '.tk__jour', '.tk__heure', '.tk__logo-fil', '.tk__tailles']) {
  assert.ok(!CSS_TICKET.includes(parti), `« ${parti} » n’habille plus rien`);
}
// Le projet est PC uniquement : plus une règle justifiée par le doigt.
assert.ok(!CSS_TICKET.includes('pointer: coarse'), 'plus d’échelle tactile sur le ticket');

// LE PAPIER N'A QUE DES DENSITÉS D'ENCRE. La charte réserve la couleur aux
// ÉTATS — cette règle parle de l'ÉCRAN, où une couleur se lit comme un signal.
// Sur du papier, le gris ardoise ne signale rien : il fait reculer un intitulé
// derrière sa valeur. Trois encres, pas une de plus, et aucune qui code un état.
const couleurs = CSS_TICKET.replace(/\/\*[\s\S]*?\*\//g, ' ')
  .match(/#[0-9a-f]{3,6}/gi) || [];
for (const c of couleurs) {
  // `#f2f4f5` est le fond de la consigne : une surface, pas un signal.
  assert.ok(['#fff', '#202930', '#4a6274', '#adb8b9', '#f2f4f5'].includes(c.toLowerCase()),
    `le ticket ne porte pas de couleur : ${c}`);
}

// ---------------------------------------------------------------------------
// 3 bis. LA CARTE S'ADAPTE À L'ARTICLE — au RENDU, pas seulement au modèle
// ---------------------------------------------------------------------------
// C'est la demande de Charlie du 26/08 : « du mug au couteau à graver, une carte
// adaptée à chaque article ». La réponse tient en une phrase : LES TAILLES ET
// LES ZONES SONT DEUX AXES INDÉPENDANTS. La maquette rangeait la largeur du dos
// DANS la carte de la taille — ça se tient pour un t-shirt et ça ne veut rien
// dire pour une tasse, qui a trois faces et une seule taille.
//
// Aucune famille n'est écrite en dur dans le rendu : ce sont les faces du
// dossier qui décident, et le dossier les tient de la table des tailles de logo.
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
const papierDe = (prod, qte) => dessinerTicket({
  demande: false, titre: 'Ticket atelier', ref: 'X', date: '26/08/2026', retrait: '30/08/2026',
  client: 'Coco Beach', contact: 'Mélina', tel: '0690', lot: null,
  lignes: [{ designation: 'Article', qte: String(qte), detail: '', prod }],
}, faireDoc());

// UN T-SHIRT : deux grilles. Les tailles distinguent, les zones aussi.
const pTextile = modeleTicket({ ...DEMANDE, fiche: { ...DEMANDE.fiche, prod: PROD } }).lignes[0].prod;
const nTextile = papierDe(pTextile, 32);
assert.strictEqual(tousLes(nTextile, 'tk__grille').length, 2,
  'un textile sort ses tailles ET ses zones');
assert.strictEqual(tousLes(nTextile, 'tk__grille--zones').length, 1);
assert.strictEqual(tousLes(nTextile, 'tk__aecrire').length, 0,
  'toutes ses largeurs sont connues : aucun trait à remplir');

// TOUT ARTICLE N'A PAS DE RÉFÉRENCE, et le papier doit rester lisible sans.
// Un textile en a une (elle sort du catalogue) ; une tasse, une gravure, un
// besoin saisi à la main n'en ont pas — la vendeuse n'a rien à recopier. Le
// papier affichait alors un tiret de 64 px : une BARRE NOIRE à l'endroit exact
// où l'atelier cherche ce qu'il doit produire. C'est la DÉSIGNATION qui prend
// la place — elle identifie la pièce, ce qu'un tiret ne fera jamais — et elle
// cesse alors de se répéter deux centimètres plus bas.
const PROD_TASSE = { ...TASSE.fiche.prod };
const nSansRef = papierDe({ ...PROD_TASSE, ref: '' }, 24);
const capsSansRef = tousLes(nSansRef, 'pap-cap').map((n) => n.textContent);
assert.ok(capsSansRef.includes('ARTICLE'), 'l’intitulé dit ce que la case porte vraiment');
assert.ok(!capsSansRef.includes('RÉFÉRENCE'),
  'et il ne promet pas une référence qui n’existe pas');
const geantSansRef = tousLes(nSansRef, 'tk__geant');
assert.strictEqual(geantSansRef[0].textContent, 'Article',
  'la désignation prend la place, jamais un tiret géant');
assert.ok(geantSansRef[0].className.includes('tk__geant--texte'),
  'une désignation est une phrase : elle prend le cran en dessous, sinon elle déborde');
// La couleur, elle, reste : elle confirme qu'on a pris la bonne boîte. C'est la
// DÉSIGNATION qui s'en va, puisqu'elle est déjà l'identité juste au-dessus.
assert.strictEqual(tousLes(nSansRef, 'tk__ident-nom')[0].textContent,
  'Noir (ext.) / Blanc (int.)',
  'la ligne de confirmation garde la couleur et lâche la désignation devenue identité');

// Avec une référence, rien ne bouge : c'est elle l'identité, et la désignation
// reste la ligne qui confirme qu'on a pris la bonne boîte.
const nAvecRef = papierDe(PROD_TASSE, 24);
assert.ok(tousLes(nAvecRef, 'pap-cap').map((n) => n.textContent).includes('RÉFÉRENCE'));
assert.strictEqual(tousLes(nAvecRef, 'tk__geant')[0].textContent, 'TC 06');
assert.strictEqual(tousLes(nAvecRef, 'tk__geant')[0].className, 'tk__geant',
  'une référence tient en six signes : elle garde le plus grand corps');
assert.strictEqual(tousLes(nAvecRef, 'tk__ident-nom').length, 1);

// UNE TASSE : une seule grille. « Taille unique » n'ouvre AUCUNE colonne — elle
// occuperait toute une case pour ne rien apprendre, la quantité est déjà écrite
// en 64 px juste au-dessus. Restent les trois faces, chacune avec son trait.
const pTasse = modeleTicket(TASSE).lignes[0].prod;
const nTasse = papierDe(pTasse, 24);
assert.strictEqual(tousLes(nTasse, 'tk__grille').length, 1,
  '« Taille unique » ne doit ouvrir aucune grille de tailles');
assert.strictEqual(tousLes(nTasse, 'tk__grille--zones').length, 1);
assert.strictEqual(tousLes(nTasse, 'tk__case').length, 3,
  'les deux flancs et le fond, pas un de moins');
assert.strictEqual(tousLes(nTasse, 'tk__aecrire').length, 3,
  'une zone sans mesure sort un TRAIT pour l’écrire — un blanc ne se remplit pas');

// CE QU'ON MARQUE TRAVERSE JUSQU'AU PAPIER (26/08). Charlie : « dessus c'est
// pas des mm mais des noms de logo, des phrases — elle me dit quoi graver ».
// Sur un textile la largeur vient du catalogue et suffit ; sur une tasse, la
// CONSIGNE est tout le travail, et la mesure se prend à l'établi.
const GRAVE = { ...pTasse, logos: [
  { face: 'Face avant', mm: '', quoi: 'Logo client + « Coco Beach »' },
  { face: 'Fond', mm: '', quoi: 'Logo OLDA' },
] };
const nGrave = papierDe(GRAVE, 24);
const quoiRendus = tousLes(nGrave, 'tk__quoi').map((n) => n.textContent);
assert.deepStrictEqual(quoiRendus, ['Logo client + « Coco Beach »', 'Logo OLDA'],
  'la carte de zone porte CE QU’ON MARQUE');
// Une consigne se suffit : pas de trait vide sous elle. Un trait qui ne demande
// rien finit par être rempli de n’importe quoi.
assert.strictEqual(tousLes(nGrave, 'tk__aecrire').length, 0,
  'une zone qui dit déjà quoi graver n’ouvre pas de trait à remplir');
// Et elle s'écrit aussi sur le ticket en TEXTE, la consigne AVANT la cote.
const texteGrave = ticketTexte({ ...modeleTicket(TASSE),
  lignes: [{ ...modeleTicket(TASSE).lignes[0], prod: GRAVE }] });
assert.match(texteGrave, /Zone Face avant : Logo client/);
assert.match(texteGrave, /Zone Fond : Logo OLDA/);

// UNE SEULE TAILLE QUI DIT QUELQUE CHOSE, elle, reste : « XL » dit quelle boîte
// ouvrir. On ne retire que les libellés qui SONT le mot « unique ».
const nXL = papierDe({ ...pTasse, tailles: [{ t: 'XL', n: 5 }] }, 5);
assert.strictEqual(tousLes(nXL, 'tk__grille').length, 2,
  '« XL » n’est pas une taille muette : elle garde sa colonne');

// UN ARTICLE SANS AUCUNE ZONE ne sort aucun bloc de zones — une bâche ne se
// marque pas, et un cadre vide finit par être rempli de n’importe quoi.
const nNu = papierDe({ ...pTasse, tailles: [], logos: [] }, 40);
assert.strictEqual(tousLes(nNu, 'tk__grille').length, 0,
  'ni tailles ni zones : aucune grille');

// ---------------------------------------------------------------------------
// 4. CE QUI SE RECTIFIE À L'ÉTABLI
// ---------------------------------------------------------------------------
// Chaque nombre et chaque largeur porte l'ADRESSE où il se réécrit : une
// rectification qui ne vit que sur le papier est perdue au ticket suivant.
assert.deepStrictEqual(JSON.parse(JSON.stringify(p.tailles[1].ou)), { ou: 'prod', liste: 'tailles', i: 1 });
assert.deepStrictEqual(JSON.parse(JSON.stringify(p.logos[1].ou)), { ou: 'prod', liste: 'logos', i: 1 });
// … et elle part PAR POSITION, comme le récapitulatif : la correction du poste
// d'à côté tient toujours quand la nôtre arrive.
const corps = APP.slice(APP.indexOf('function corpsTicket('), APP.indexOf('\n}', APP.indexOf('function corpsTicket(')));
assert.match(corps, /cases\[cible\.i\] = cible\.liste === 'tailles'/);
assert.match(corps, /corps: \{ prod: \{ \[cible\.liste\]: cases \} \}/);

(async () => {
  process.env.PORT = '0';
  const app = require('../server');
  const base = await new Promise((resolve) => {
    const check = () => {
      const s = app && app.__server;
      if (s && s.listening) resolve(`http://127.0.0.1:${s.address().port}`);
      else setTimeout(check, 25);
    };
    check();
  });
  const call = async (m, chemin, body) => {
    const res = await fetch(base + chemin, {
      method: m,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  const cree = await call('POST', '/api/comptoir/projet', {
    source: 'Demande de devis', ref: '26.08.26-900', client: 'AS Sandy Ground',
    clientObj: { type: 'Association', name: 'AS Sandy Ground', company: 'AS Sandy Ground' },
    name: 'Maillots', responsible: 'Charlie', priority: '2',
    stage: 'demande', status: 'À chiffrer', comment: '', amount: null, quantity: 32,
    details: [['Type de dossier', 'Demande de devis']],
    articles: [{ label: 'T-shirt', qty: 32, prod: PROD }],
  });
  assert.strictEqual(cree.status, 201);
  const id = cree.body.id;

  // UNE LARGEUR RECTIFIÉE, et elle seule : « finalement le dos en 340 ».
  const maj = await call('PATCH', `/api/requests/${id}/fiche`, { prod: { logos: [null, { mm: '340' }] } });
  assert.strictEqual(maj.status, 200);
  const apres = (await call('GET', `/api/requests/${id}`)).body.fiche.prod;
  assert.strictEqual(apres.logos[1].mm, '340');
  assert.strictEqual(apres.logos[0].mm, '80', 'la face d’à côté ne bouge pas');
  assert.strictEqual(apres.tailles[0].n, 12, 'ni les tailles');

  // UN NOMBRE DE PIÈCES, de même.
  await call('PATCH', `/api/requests/${id}/fiche`, { prod: { tailles: [{ n: 14 }] } });
  const apres2 = (await call('GET', `/api/requests/${id}`)).body.fiche.prod;
  assert.strictEqual(apres2.tailles[0].n, 14);
  assert.strictEqual(apres2.tailles[1].n, 20);
  assert.strictEqual(apres2.logos[1].mm, '340', 'la correction précédente tient');

  // CE QUI NE PASSE PAS PAR CETTE PORTE. La référence, la couleur et la
  // technique sont l'IDENTITÉ de l'article : elles se corrigent au dossier.
  // Et un nombre de pièces ne descend pas à zéro — retirer une taille décale
  // toutes les positions suivantes, donc la correction d'à côté.
  await call('PATCH', `/api/requests/${id}/fiche`, {
    prod: { ref: 'PIRATE', couleur: 'PIRATE', tailles: [{ n: 0 }], logos: [{ mm: '' }] },
  });
  const apres3 = (await call('GET', `/api/requests/${id}`)).body.fiche.prod;
  assert.strictEqual(apres3.ref, 'K3008');
  assert.strictEqual(apres3.couleur, 'Rouge');
  assert.strictEqual(apres3.tailles[0].n, 14, 'zéro pièce n’est pas une correction');
  assert.strictEqual(apres3.logos[0].mm, '80', 'une largeur vidée n’efface rien');

  console.log('✓ ticket : ce qu’il y a à produire est sur le papier, et se rectifie à l’établi');
  app.__server.close();
})().catch((e) => { console.error(e); process.exit(1); });
