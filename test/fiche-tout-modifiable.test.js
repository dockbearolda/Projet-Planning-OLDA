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
const PROD = APP.match(/function ldProduction\(r\) \{[\s\S]*?\n\}\n\nfunction ldSousTitre/);
assert.ok(PROD, 'ldProduction doit exister');
for (const cle of ['ref', 'couleur', 'marquage', 'encre']) {
  assert.ok(new RegExp(`\\['${cle}',`).test(PROD[0]),
    `« ${cle} » doit être modifiable : c’est l’identité de l’article`);
}
assert.ok(/Tailles/.test(PROD[0]) && /Faces à marquer/.test(PROD[0]),
  'les deux familles de faits ont leur sous-titre');
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

// UNE HAUTEUR EST UN JETON, JAMAIS UN NOMBRE (règle du 27/08). Le tableau ne
// redéclare aucune hauteur : ses champs héritent de `.ld-ctl`, qui porte déjà
// `--ctrl-h`. Deux écritures redeviennent deux hauteurs le jour où l'une bouge.
const REGLES = CSS.match(/\.ld-tab, \.ld-faces \{[\s\S]*?\.ld-sous \{[\s\S]*?\n\}/)[0];
assert.ok(!/min-height:\s*\d+px/.test(REGLES),
  'aucune hauteur en dur dans le tableau de production');
assert.ok(/grid-template-columns/.test(REGLES),
  'c’est une grille : la colonne des valeurs est la même sur toutes les rangées');
// UNE QUANTITÉ N'A PAS BESOIN DE TOUTE LA LIGNE : étirée, « 100 » flottait seul
// à un bout d'un champ vide et l'œil devait traverser la fiche.
assert.ok(/\.ld-tab--nombre \{ grid-template-columns: [^;]+; justify-content: start; \}/.test(CSS),
  'la colonne des nombres a sa largeur, la même pour toutes les rangées');

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
