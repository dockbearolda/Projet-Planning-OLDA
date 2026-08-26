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

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const APP = lire('public/app.js');

// On charge le VRAI source (module ES du navigateur) dans un bac à sable.
const bac = {};
vm.createContext(bac);
vm.runInContext(
  `${lire('public/ticket.js').replace(/^export\s+/gm, '')}
   globalThis.modeleTicket = modeleTicket;
   globalThis.ticketTexte = ticketTexte;
   globalThis.CSS_TICKET = CSS_TICKET;`,
  bac,
);
const { modeleTicket, ticketTexte, CSS_TICKET } = bac;

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
// LA COULEUR DE L'ENCRE N'EST PAS CELLE DU VÊTEMENT. « DTF » tout seul ne dit
// pas quel rouleau charger ; sur un t-shirt rouge, blanc ou noir change tout.
assert.match(papier, /K3008 · Rouge · DTF encre Blanc/);
assert.match(papier, /Tailles : 12 x S {2}20 x M/);
assert.match(papier, /Logo Coeur : 80 mm/);
assert.match(papier, /Logo Dos : S 300\/M 320 mm/);
// 5. TOUJOURS PAS UN EURO — le contrôle qui tient tout seul.
assert.ok(!papier.includes('€'), `aucun montant sur un ticket d’atelier :\n${papier}`);

// LA DATE DE PRISE NE FAIT PAS PRODUIRE : elle est descendue au pied, avec la
// signature. En tête, elle repoussait d'autant la première ligne utile.
const lignesPapier = papier.split('\n');
assert.ok(lignesPapier.indexOf('Commande prise le 26/08/2026')
  > lignesPapier.findIndex((x) => x.startsWith('60 x') || x.includes('T-shirt')),
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

// Une largeur vide n'est pas une largeur : elle n'ouvre pas de ligne.
const t4 = modeleTicket({
  ...DEMANDE,
  fiche: { ...DEMANDE.fiche, prod: { ...PROD, logos: [{ face: 'Dos', mm: '' }], tailles: [] } },
});
assert.deepStrictEqual(t4.lignes[0].prod.logos.length, 0);
assert.deepStrictEqual(t4.lignes[0].prod.tailles.length, 0);

// ---------------------------------------------------------------------------
// 3. LA MISE EN PAGE DU PAPIER
// ---------------------------------------------------------------------------
// UNE ÉCHELLE — celle de l'écran du comptoir, moins sa taille de titre : le
// papier n'a plus d'en-tête de marque à habiller (retiré le 26/08). Elle ne se
// choisit pas au cas par cas : les valeurs sont des jetons, lus partout.
for (const jeton of ['--tk-fort: 15px', '--tk-texte: 13px', '--tk-note: 11px']) {
  assert.ok(CSS_TICKET.includes(jeton), `l’échelle du ticket doit poser ${jeton}`);
}
assert.ok(!CSS_TICKET.includes('--tk-titre'), 'le jeton de titre n’a plus rien à habiller');
assert.ok(!/font-size: 1[0247]px/.test(CSS_TICKET),
  'aucune taille en dur : tout passe par les trois jetons');
// LES TAILLES EN TABLEAU, à colonnes ÉGALES : une piste qui dépend de son
// contenu ferait une grille bancale d'un ticket à l'autre.
assert.match(CSS_TICKET, /\.tk__tailles \{[^}]*grid-auto-columns: 1fr/);
assert.match(CSS_TICKET, /\.tk__taille-v \{[^}]*font-size: var\(--tk-fort\)/);
// La largeur d'un logo se lit au bout d'un filet, comme sur un bordereau.
assert.match(CSS_TICKET, /\.tk__logo-fil \{[^}]*border-bottom: 1px dotted/);
assert.match(CSS_TICKET, /\.tk__logo-mm \{[^}]*font-size: var\(--tk-fort\)/);
// DANS LA CASE ET AU BOUT DU FILET, le champ ne pose pas de trait de plus :
// sans ça deux traits se superposaient sous chaque nombre.
assert.match(CSS_TICKET, /\.tk__taille-v \.tk__champ, \.tk__logo-mm \.tk__champ \{[^}]*border-bottom: 0/);
// CE QUE CHARLIE A FAIT RETIRER DU PAPIER LE 26/08, écran par écran. Rien de
// tout cela ne doit revenir par une règle laissée derrière : une feuille de
// style qui décrit un bloc absent finit par le faire réapparaître.
for (const parti of ['.tk__nom', '.tk__lieu', '.tk__remise', '.tk__atelier',
  '.tk__jour', '.tk__heure']) {
  assert.ok(!CSS_TICKET.includes(parti), `« ${parti} » n’habille plus rien`);
}
// Le projet est PC uniquement : plus une règle justifiée par le doigt.
assert.ok(!CSS_TICKET.includes('pointer: coarse'), 'plus d’échelle tactile sur le ticket');
// Le papier reste en NOIR SUR BLANC : la charte réserve la couleur aux états,
// et une imprimante à tickets ne connaît que le noir.
const couleurs = CSS_TICKET.replace(/\/\*[\s\S]*?\*\//g, ' ')
  .match(/#[0-9a-f]{3,6}/gi) || [];
for (const c of couleurs) {
  assert.ok(['#000', '#fff', '#8a8f98', '#9aa0a6', '#f0f1f3'].includes(c.toLowerCase()),
    `le ticket ne porte pas de couleur : ${c}`);
}

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
