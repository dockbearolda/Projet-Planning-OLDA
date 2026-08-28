'use strict';

// LA LIGNE S'OUVRE AU CLIC, ET TOUT S'Y MODIFIE (28/08/2026)
// ===========================================================================
// Charlie, en désignant les trois pastilles d'une ligne — « ouvrir la fiche »,
// le ticket d'atelier, le bon de commande : « ces 3 choses doivent être
// supprimées définitivement, je clique sur la ligne, elle s'ouvre façon tableau
// et je peux tout modifier ».
//
// Trois portes pour une seule intention, pendant que la ligne elle-même — la
// cible la plus large de l'écran — ne faisait rien quand on la cliquait.
//
// CE QUI REND LE RETRAIT POSSIBLE : le ticket était la SEULE porte pour
// corriger une taille, une face ou une référence. La fiche porte maintenant
// « Ce qu'il y a à produire ». D'où l'ordre suivi — construire, puis retirer.
//
// Ce fichier tient :
//
//   1. plus aucune des trois portes, ni dans la ligne, ni sur la carte, ni
//      dans la fiche, ni en CSS ;
//   2. la ligne et la carte s'ouvrent par LA MÊME fonction ;
//   3. le bloc de production existe, et il est modifiable de bout en bout ;
//   4. une valeur quittée est une valeur enregistrée — plus de bouton
//      « Enregistrer », et un seul écouteur pour toute la fiche ;
//   5. la note garde son geste à elle : elle s'AJOUTE, et deux fois ne se
//      retire pas ;
//   6. côté serveur, l'identité de l'article s'écrit, une face s'ajoute et se
//      retire, et le prix suit.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const APP = lire('public/app.js');
const CSS = lire('public/styles.css');
const HTML = lire('public/index.html');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

// ---------------------------------------------------------------------------
// 1. LES TROIS PORTES ONT DISPARU
// ---------------------------------------------------------------------------
for (const [motif, quoi] of [
  ["'open-btn'", 'le bouton « ouvrir » de la ligne'],
  ["'pcard__open'", 'celui de la carte'],
  ['boutonsPapiers', 'le composant des deux pastilles de papier'],
  ['cellTicket(', 'la cellule « Documents »'],
]) {
  assert.ok(!APP.includes(motif), `${quoi} ne doit plus exister dans l’écran`);
}
assert.ok(!/ldActionBtn\('(ticket|bureau|imprimer)'/.test(APP),
  'ni bouton de papier dans la fiche');
for (const mort of ['open-btn', 'pcard__open', 'pcard__ticket', 'ticket-cell', 'col-ticket', 'off-ticket']) {
  assert.ok(!CSS.includes(mort), `.${mort} est du style pour un élément qui n’existe plus`);
}
assert.ok(!HTML.includes('data-col="ticket"') && !HTML.includes('col-ticket'),
  'la colonne quitte aussi le colgroup et l’en-tête');
assert.ok(!/\{ key: 'ticket'/.test(APP), 'et le rail « Colonnes »');
// UNE COLONNE RETIRÉE SORT DU PLANCHER. `--cols-off` ne retranche que les
// colonnes RANGÉES, celles qui existent encore : sans ça la grille garde
// 116 px qu'aucune colonne n'occupe et défile de côté pour rien.
assert.ok(!/ticket: 116/.test(APP), 'COL_DEFAULTS oublie la colonne retirée');
for (const px of [1300, 1250, 1390]) {
  assert.ok(CSS.includes(`min-width: calc(${px}px - var(--cols-off, 0px))`),
    `le plancher ${px} doit avoir suivi le retrait de la colonne`);
}

// ---------------------------------------------------------------------------
// 2. LA LIGNE ET LA CARTE S'OUVRENT PAR LA MÊME FONCTION
// ---------------------------------------------------------------------------
// Deux vues à un clic l'une de l'autre doivent donner le même geste, pas deux
// qui se ressemblent.
const AUCLIC = APP.match(/function ouvrirAuClic\(el, r\) \{[\s\S]*?\n\}/);
assert.ok(AUCLIC, 'une seule fonction ouvre la fiche');
assert.ok(/ouvrirAuClic\(tr, r\)/.test(APP), 'la ligne du tableau s’ouvre au clic');
assert.ok(/ouvrirAuClic\(carte, r\)/.test(APP), 'la carte aussi');
// CE QUI NE DOIT PAS OUVRIR : tout ce qui se manipule DANS la ligne. Une ligne
// entière cliquable avale les gestes qu'elle porte déjà.
assert.ok(/ZONE_CLIQUABLE/.test(AUCLIC[0]),
  'un clic sur un contrôle de la ligne ne doit pas AUSSI ouvrir la fiche');
assert.ok(/\.handle/.test(APP.match(/const ZONE_CLIQUABLE = '[^']+'/)[0]),
  'la poignée de glissement en fait partie : l’attraper n’ouvre pas la fiche');
assert.ok(/glisserVientDeFinir\(\)/.test(AUCLIC[0]),
  'la dépose d’un glisser n’ouvre pas le dossier qu’on vient de ranger');
assert.ok(/getSelection\(\)/.test(AUCLIC[0]),
  'copier un texte à la souris finit par un relâchement sur la ligne : ça n’ouvre pas');

// ---------------------------------------------------------------------------
// 3. LE BLOC DE PRODUCTION EST MODIFIABLE DE BOUT EN BOUT
// ---------------------------------------------------------------------------
const PROD = APP.match(/function ldProduction\(r\) \{[\s\S]*?\n\}\n\n\/\/ UN BANDEAU/);
assert.ok(PROD, 'ldProduction doit exister');
for (const cle of ['ref', 'couleur', 'marquage', 'encre']) {
  assert.ok(new RegExp(`\\['${cle}',`).test(PROD[0]),
    `« ${cle} » doit être modifiable : c’est l’identité de l’article`);
}
assert.ok(/ldBande\('Tailles'\)/.test(PROD[0]) && /ldBande\('Faces à marquer'\)/.test(PROD[0]),
  'les deux familles de faits ont leur bandeau');
// LA LISTE DES TAILLES PART ENTIÈRE ET NOMMÉE. Le serveur lit une taille absente
// comme un zéro : c'est ce qui permet d'en retirer une, et la seule lecture qui
// tienne puisque la ligne ne garde pas les tailles vides.
assert.ok(/tailles\.map\(\(t\) => \(\{ t: String\(t\.t\), n: Number\(t\.n\) \|\| 0 \}\)\)/.test(PROD[0]),
  'les tailles partent nommées, la liste entière');
// LA RANGÉE VIDE AJOUTE. Le comptoir ne pose que les tailles commandées :
// « finalement il en veut aussi 20 en XL » n'avait aucune porte.
assert.ok(/Nouvelle taille/.test(PROD[0]), 'une rangée vide doit permettre d’ajouter une taille');
assert.ok(/Nouvelle face/.test(PROD[0]), 'et une face');
// CE QU'ON MARQUE se corrige : sur une tasse ou une gravure il n'y a pas de
// cote, et c'était la seule valeur de la ligne qu'on ne pouvait pas rectifier.
assert.ok(/envoyerFaces\(i, \{ quoi: v \}\)/.test(PROD[0]),
  'la consigne d’une face doit se corriger');
assert.ok(/envoyerFaces\(i, \{ mm: v \}\)/.test(PROD[0]) && /envoyerFaces\(i, \{ face: v \}\)/.test(PROD[0]),
  'sa cote et son nom aussi');

// ---------------------------------------------------------------------------
// 3 bis. LA FICHE EST UN TABLEAU, PAS VINGT CARTES (28/08)
// ---------------------------------------------------------------------------
// Charlie : « pour que ce soit simple je veux que ça s'ouvre façon tableau,
// presque comme un tableau Excel, pour modifier rapidement les valeurs ».
// C'étaient vingt encadrés blancs sur deux colonnes, chacun portant son
// intitulé AU-DESSUS de son champ : rien ne s'alignait d'un encadré à l'autre.
const CORPS = CSS.match(/\.ld-body \{[\s\S]*?\n\}/)[0];
// DEUX PAIRES PAR LIGNE. Trente-cinq rangées sur une seule colonne, c'était une
// liste qu'il fallait faire défiler pour voir la moitié du dossier : « toutes
// les valeurs apparaissent » veut dire tout voir d'un coup.
assert.ok(/grid-template-columns: repeat\(2, minmax\([^;]+\) minmax\(0, 1fr\)\);/.test(CORPS),
  'le corps est une grille de DEUX paires intitulé/valeur par ligne');
// …et une seule paire quand l'écran ne suit plus : deux paires y donneraient
// des colonnes trop étroites pour une date ou un nom de dossier.
assert.ok(/@media \(max-width: 1200px\) \{\s*\.ld-body \{ grid-template-columns: minmax\([^;]+\) minmax\(0, 1fr\); \}/.test(CSS),
  'sous 1200 px, une seule paire par ligne');
assert.ok(/gap: 0;/.test(CORPS),
  'aucun écart : ce sont les filets qui séparent, comme dans un tableur');
// `display: contents` sur la rangée : ses deux cellules deviennent des cellules
// de la grille du corps. Dans une sous-grille par rangée, chaque largeur se
// calculerait sur son propre contenu — vingt alignements différents.
assert.ok(/\.ld-rang \{ display: contents; \}/.test(CSS),
  'une rangée ne fabrique pas sa propre grille : elle donne ses cellules à celle du corps');
// UNE HAUTEUR EST UN JETON, JAMAIS UN NOMBRE (règle du 27/08), et toutes les
// cellules la prennent dans UNE règle.
const CELLULES = CSS.match(/\.ld-k, \.ld-cell, \.ld-k-champ \{[\s\S]*?\n\}/)[0];
assert.ok(/min-height: var\(--ligne-h\);/.test(CELLULES),
  'toutes les cellules ont la même hauteur, et c’est un jeton');
assert.ok(!/min-height:\s*\d+px/.test(CELLULES), 'jamais une hauteur en dur');
// UNE RANGÉE DE TABLEAU N'EST PAS UNE COMMANDE ISOLÉE. Trente rangées à
// `--ctrl-h` (50 px), c'est un formulaire qu'on fait défiler : on en voyait
// huit à l'écran. Le jeton a son rôle écrit dans la charte, et il est DÉCLARÉ
// une seule fois — un nombre se recopie de travers.
const CHARTE = lire('public/charte.css');
assert.strictEqual((CHARTE.match(/^\s*--ligne-h:/gm) || []).length, 1,
  '--ligne-h se déclare une seule fois, dans la charte');
// LES INTITULÉS SE LISENT COMME DES MOTS. En capitales espacées, « Couleur du
// marquage » tombait sur deux lignes et cassait la rangée : dans un tableur, un
// en-tête n'est pas un titre. Les capitales vivent sur le BANDEAU, une fois par
// famille de faits.
const INTITULES = CSS.match(/\.ld-k, \.ld-k-champ \{[\s\S]*?\n\}/)[0];
assert.ok(/text-transform: none;/.test(INTITULES),
  'un intitulé de rangée n’est pas en capitales');
assert.ok(!/background:/.test(INTITULES),
  'ni sur un fond de colonne : deux blocs de couleur côte à côte, ce n’est pas un tableau');
assert.ok(/border-right: 1px solid var\(--border-soft\);/.test(INTITULES),
  'le quadrillage est vertical AUSSI — c’est lui qui dit que deux valeurs sont dans la même colonne');
const BANDE = CSS.match(/\.ld-bande \{[\s\S]*?\n\}/)[0];
assert.ok(/text-transform: uppercase/.test(BANDE), 'les capitales vivent sur le bandeau');
assert.ok(/grid-column: 1 \/ -1;/.test(BANDE), 'et il traverse les deux colonnes');
// LE CHAMP EST LA CELLULE : une bordure par champ DANS une cellule qui en a
// déjà une, c'était une boîte dans une boîte, vingt fois.
const CTL = CSS.match(/\n\.ld-ctl \{[\s\S]*?\n\}/)[0];
assert.ok(/border: 0;/.test(CTL), 'le champ n’a pas de contour propre : la cellule en a un');
assert.ok(/outline-offset: -2px/.test(CSS),
  'le focus se pose EN DEDANS, sinon il déborde sur les cellules voisines');

// LE RETRAIT VIT SUR LA CELLULE, une seule fois. Il était porté par CHAQUE
// contenu — et seulement par ceux qui y avaient pensé : les champs commençaient
// à 231 px, les valeurs dépouillées (« PRO », « Mélina », le duo date/heure) à
// 221. Dix pixels d'écart dans la même colonne, sur une rangée sur trois.
const HAUTE_ALIGN = CSS.match(/\.ld-rang--haut > \.ld-cell \{[^}]*\}/)[0];
const CELL = CSS.match(/\n\.ld-cell \{[\s\S]*?\n\}/)[0];
assert.ok(/padding: 0 0 0 10px;/.test(CELL), 'la cellule porte le retrait');
const CTL2 = CSS.match(/\n\.ld-ctl \{[\s\S]*?\n\}/)[0];
assert.ok(/padding: 0;/.test(CTL2), 'et le champ n’en porte plus : sinon il s’ajoute au premier');
// LE FOCUS S'ALLUME SUR LA CELLULE. Posé sur le champ, dont la boîte commence
// dix pixels plus loin, il laissait une bande claire à gauche.
assert.ok(/\.ld-cell:focus-within \{ outline: 2px solid var\(--primary\); outline-offset: -2px; \}/.test(CSS),
  'c’est la case qui s’allume, comme dans un tableur');
// UNE MARGE DE COMPOSANT NE SUIT PAS DANS UNE CELLULE. `.sub-chip` porte
// `margin: 8px 12px` pour vivre dans une ligne du planning : ces 12 px la
// décalaient de la colonne (243 px quand tout le reste tombe à 231).
// La règle se lit sur SON bloc : `[\s\S]*?` traversait les accolades et
// trouvait le `margin: 0` d'une règle voisine — le contrôle passait sur un
// défaut qu'il était censé voir.
assert.ok(/\.ld-cell :is\(\.ld-toggle[^{]*\{[^}]*margin: 0;/.test(CSS),
  'une pastille perd la marge qu’elle porte pour le planning');
// `align-items: center` VAUT CENTRAGE HORIZONTAL dans une colonne flex : hérité
// de la règle des cellules, il posait les trois pastilles de documents au milieu
// de la largeur (533 px) au lieu du bord.
assert.ok(/align-items: stretch;/.test(HAUTE_ALIGN),
  'une rangée à pavé aligne ses blocs à gauche, pas au centre');

// DEUX PIÈGES DE GRILLE, PAYÉS LE 28/08 ET TENUS ICI.
//
// 1. UNE RANGÉE EST EN `display: contents` : on ne lui ajoute RIEN après coup.
//    Un troisième enfant devient une cellule de grille à lui seul, posée
//    n'importe où dans le tableau. Trois blocs le faisaient — le fil du
//    comptoir, l'historique du client, le message « aucune commande » — et
//    partaient se ranger au milieu des autres rangées.
assert.ok(/rangee\.cellule = v;/.test(APP),
  'ldBox doit exposer sa cellule : c’est là que les ajouts tardifs vont');
assert.ok(!/\bsection\.append(Child)?\(/.test(APP),
  'plus aucun ajout posé SUR la rangée — il irait dans la grille, pas dans la cellule');
//
// 2. UN `min-height` SUR UN ITEM DE GRILLE ÉTIRÉ PLAFONNE SA PISTE. Le suivi
//    du paiement mesurait 206 px dans une cellule figée à 38 et débordait
//    par-dessus les rangées du dessous ; `min-height: auto` la rend à sa vraie
//    taille. C'est l'intitulé, à côté, qui garde la hauteur minimale.
const HAUTE = CSS.match(/\.ld-rang--haut > \.ld-cell \{[^}]*\}/)[0];
assert.ok(/min-height: auto;/.test(HAUTE),
  'une rangée à pavé perd son min-height, sinon sa piste plafonne et le contenu déborde');

// AUCUNE BULLE DANS UN TABLEAU. Charlie, en désignant les « Non » du paiement :
// « enlève ces bulles, un tableau je veux ». Sept pastilles arrondies vivaient
// dans les cellules — type de client, état, pilote, référent, les trois
// bascules de paiement, le mode. Une pilule au milieu d'une cellule, c'est un
// bouton posé sur une valeur : dans un tableur on lit la valeur, on clique
// dessus, elle change.
const SANSBULLE = CSS.match(/\.ld-cell :is\(\.ld-toggle[^{]*\{[^}]*\}/)[0];
for (const mort of ['border-radius: 0', 'border: 0', 'background: none']) {
  assert.ok(SANSBULLE.includes(mort), `dans une cellule, une valeur perd sa bulle (${mort})`);
}
// C'est le SURVOL qui dit qu'elle se change, pas une bulle qui le dit tout le
// temps.
assert.ok(/\.ld-cell :is\([^)]*\):hover \{[^}]*text-decoration: underline/.test(CSS),
  'le survol dit qu’une valeur se change');
// ⚠ ET SEULEMENT DANS LE TABLEAU : sur la ligne du planning et sur la carte,
// ces mêmes pastilles gardent leur forme — là, rien d'autre ne dirait qu'on
// peut les toucher.
assert.ok(/\n\.ld-toggle \{[\s\S]*?border-radius: var\(--pilule\)/.test(CSS)
  || /\n\.resp-chip \{[\s\S]*?border-radius: var\(--pilule\)/.test(CSS),
  'hors du tableau, la pastille reste une pastille');

// ---------------------------------------------------------------------------
// 4. UNE VALEUR QUITTÉE EST UNE VALEUR ENREGISTRÉE
// ---------------------------------------------------------------------------
assert.ok(!/Enregistrer les modifications/.test(APP),
  'plus de bouton « Enregistrer » : on vient rectifier UNE chose, vite');
// UN SEUL ÉCOUTEUR, et il se pose UNE FOIS. La carte du tiroir survit à tous
// les rendus : un abonnement par rendu enverrait le champ autant de fois que la
// fiche a été redessinée.
const ENSURE = APP.match(/function ensureLigneDrawer\(\) \{[\s\S]*?\n\}/)[0];
assert.ok(/ligneDrawerCard\.addEventListener\('change'/.test(ENSURE),
  'l’écouteur d’enregistrement se pose à la construction du tiroir');
assert.strictEqual((APP.match(/ligneDrawerCard\.addEventListener\('change'/g) || []).length, 1,
  'et une seule fois dans tout le fichier');
// …mais il lit la fonction du rendu COURANT, jamais une fonction figée à la
// première ouverture — c'est le piège qui avait déjà écrasé une fiche client.
assert.ok(/ldCommettre = commettre;/.test(APP),
  'le rendu courant repose sa fonction d’enregistrement');
assert.ok(/if \(ldCommettre\) ldCommettre\(\);/.test(ENSURE),
  'l’écouteur appelle la version du moment');
// CE QUI AVAIT LE FOCUS DOIT LE RETROUVER : l'enregistrement reconstruit la
// fiche, et sans repère le clavier retombait sur <body>.
assert.ok(/dataset\.ldKey/.test(APP.match(/const commettre = async \(\) => \{[\s\S]*?\n  \};/)[0]),
  'le champ qui avait le focus doit le retrouver après reconstruction');

// 5. LA NOTE GARDE SON GESTE : elle s'AJOUTE aux informations, et une note
// ajoutée deux fois ne se retire pas.
assert.ok(/ajouterNote\.textContent = 'Ajouter la note';/.test(APP), 'la note a son bouton');
assert.ok(/cible\.classList\.contains\('ld-note'\)/.test(ENSURE),
  'et elle ne part pas toute seule en quittant le champ');

// ---------------------------------------------------------------------------
// 6. LE SERVEUR : l'identité s'écrit, une face s'ajoute et se retire
// ---------------------------------------------------------------------------
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
  const call = async (methode, chemin, corps) => {
    const res = await fetch(base + chemin, {
      method: methode,
      headers: corps !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  // Un dossier du semis : il porte une fiche de production complète.
  const courte = (await call('GET', '/api/requests')).body
    .find((r) => r.billing_company === 'Hôtel Esmeralda');
  assert.ok(courte, 'le semis doit poser un dossier travaillable');
  const id = courte.id;

  // L'IDENTITÉ DE L'ARTICLE S'ÉCRIT. Elle ne s'écrivait pas — « ça se corrige au
  // dossier », disait la règle, sauf que le dossier n'avait aucun endroit pour
  // ça et que la seule porte, le ticket, a été retirée.
  const idt = await call('PATCH', `/api/requests/${id}/fiche`, {
    prod: { couleur: 'Bordeaux', marquage: 'Sérigraphie', encre: 'Or' },
  });
  assert.strictEqual(idt.status, 200);
  assert.strictEqual(idt.body.fiche.prod.couleur, 'Bordeaux');
  assert.strictEqual(idt.body.fiche.prod.marquage, 'Sérigraphie');
  assert.strictEqual(idt.body.fiche.prod.encre, 'Or');

  // UNE FACE S'AJOUTE. Le comptoir ne pose que les faces que la famille
  // déclare, et la plupart n'en déclarent aucune : sans cette porte, une tasse
  // arrivée sans face reste à jamais sans face.
  const avant = idt.body.fiche.prod.logos.length;
  const ajout = await call('PATCH', `/api/requests/${id}/fiche`, {
    prod: { logos: [...Array(avant).fill({}), { face: 'Manche gauche', quoi: 'Initiales' }] },
  });
  const faces = ajout.body.fiche.prod.logos;
  assert.strictEqual(faces.length, avant + 1, 'la face ajoutée doit entrer');
  assert.strictEqual(faces[avant].face, 'Manche gauche');
  assert.strictEqual(faces[avant].quoi, 'Initiales');

  // ET ELLE SE RETIRE en effaçant son nom : une face sans nom n'est pas une
  // face, c'est la règle que le comptoir applique déjà à l'entrée.
  const retrait = await call('PATCH', `/api/requests/${id}/fiche`, {
    prod: { logos: [...Array(avant).fill({}), { face: '' }] },
  });
  assert.strictEqual(retrait.body.fiche.prod.logos.length, avant,
    'effacer le nom d’une face la retire');

  // ET LE PRIX SUIT TOUJOURS. C'est le geste que tout ce panneau sert à faire.
  const tailles = retrait.body.fiche.prod.tailles.map((t) => ({ t: t.t, n: t.n }));
  const prixAvant = Number(retrait.body.project_value);
  tailles[0].n += 60;
  const maj = await call('PATCH', `/api/requests/${id}/fiche`, { prod: { tailles } });
  assert.ok(Number(maj.body.project_value) > prixAvant,
    'corriger une quantité depuis le panneau doit refaire le prix');
  assert.strictEqual(Number(maj.body.quantity),
    tailles.reduce((s, t) => s + t.n, 0),
    'et la quantité de la ligne vaut la somme des tailles');

  console.log('✓ la ligne s’ouvre au clic, et tout s’y modifie — les trois portes sont parties');
  app.__server.close();
})().catch((e) => { console.error(e); process.exit(1); });
