'use strict';

// LE BAT S'OUVRE DÉJÀ REMPLI — et il meurt avec le dossier soldé.
// ===========================================================================
// Charlie, 04/09/2026 : « quand Mélina rentre les informations sur une commande
// de t-shirts, le BAT doit déjà être pré-rempli avec les t-shirts, la bonne
// couleur, etc., qu'on n'ait plus qu'à ajouter les logos, avant, arrière ou
// autre. »
//
// LE PIÈGE QUI COÛTE LE PLUS CHER EST UNE RÉFÉRENCE. Le comptoir range
// « K3025 » ; TopTex — et donc le catalogue de BAT Studio, qui indexe sur
// `refSupplier` — l'appelle « K3025IC ». HUIT références sur quarante-neuf sont
// dans ce cas. Chercher la référence nue marche sur NS300 et échoue sur K3025 :
// le BAT s'ouvre vide, une fois sur deux, sans un message nulle part.
//
// ET LE SECOND PIÈGE EST UNE FACE. Le tableau des tailles de logo dit « Manche
// DR » ; les zones du BAT disent « Manche droite ». Deux noms pour la même
// manche, et aucun des deux n'a tort.
//
// LA FIN DE VIE, ENFIN. « Dès que le dossier est dans paiement et clôture, le
// BAT est supprimé de la ligne, inutile de le conserver pour rien. » Ce qui
// pèse n'est PAS le fichier de travail — 85 projets font 1,1 Mo — ce sont les
// logos, 170,9 Mo, et ils sont PARTAGÉS entre projets : on compte avant
// d'effacer.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const PROJECTS = lire('public/bat/js/projects.js');
const APP = lire('public/app.js');
const SRV = lire('server.js');
const chiffrage = require('../chiffrage');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

// Le plus petit fichier que `deposerPdf` accepte : il exige « %PDF- » en tête.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1');

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
  const call = async (method, p, { body, brut } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: brut !== undefined ? brut : (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const txt = res.status === 204 ? '' : await res.text();
    let corps = null;
    try { corps = txt ? JSON.parse(txt) : null; } catch (_) { corps = txt; }
    return { status: res.status, body: corps };
  };
  const ecrireBat = (rel, obj) => call('PUT', `/bat/api/data/${rel}`,
    { brut: Buffer.from(JSON.stringify(obj), 'utf8') });
  const lireBat = async (rel) => (await call('GET', `/bat/api/data/${rel}`)).body;

  // =========================================================================
  // 1. LA RÉFÉRENCE DU FOURNISSEUR N'EST PAS LA NÔTRE
  // =========================================================================
  const table = chiffrage.refsFournisseur();
  assert.strictEqual(table.K3025, 'K3025IC',
    'K3025 s’appelle K3025IC chez TopTex — c’est CE nom que le catalogue du BAT indexe');
  assert.strictEqual(table.NS300, 'NS300',
    'et NS300 s’appelle NS300 : la table ne renomme que ce qui doit l’être');
  const differentes = Object.entries(table).filter(([k, v]) => k !== v);
  assert.ok(differentes.length >= 8,
    `au moins huit références portent deux noms (mesuré : ${differentes.length})`);

  const r = await call('GET', '/api/settings/bat-produits');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.fournisseur.k3025, 'K3025IC',
    'la table part au navigateur, réduite comme les autres clés');
  assert.ok(!('ns300' in r.body.fournisseur),
    'et elle ne porte QUE les références où les deux noms diffèrent — le reste n’a rien à traduire');

  // LE CRM TRADUIT AVANT D'ENVOYER : le BAT reçoit la référence sur laquelle
  // SON catalogue est indexé, il n'a pas à connaître la nôtre.
  assert.ok(/refFournisseur: batFournisseur\[cleBatProduit\(ref\)\] \|\| ref/.test(APP),
    'la traduction se fait dans le CRM, et la référence nue reste le repli');

  // =========================================================================
  // 2. CE QUE LE BAT REMPLIT, ET CE QU'IL NE REMPLIT PAS
  // =========================================================================
  // LES LOGOS RESTENT À POSER. C'est le travail, et le deviner donnerait un BAT
  // plausible et FAUX — c'est exactement ce que Charlie demande d'éviter :
  // « qu'on n'ait plus qu'à ajouter les logos ».
  assert.ok(/poserLesTailles\(project\.articles\[0\], prod\.tailles\)/.test(PROJECTS));
  assert.ok(/poserLesFaces\(project\.articles\[0\], product, colorSlug, prod\.faces\)/.test(PROJECTS));
  assert.ok(!/logos\s*=\s*\[/.test(PROJECTS.slice(PROJECTS.indexOf('function poserLesFaces'))),
    'aucun logo n’est posé : c’est le travail qui reste');

  // LES DEUX NOMS D'UNE MANCHE. « Manche DR » (le tableau des tailles de logo)
  // et « Manche droite » (les zones du BAT) sont la même manche.
  assert.ok(/'manche dr': 'manche droite'/.test(PROJECTS) && /'manche ga': 'manche gauche'/.test(PROJECTS),
    'les deux vocabulaires se rapprochent, on n’en renomme aucun');

  // ⚠ ET « CŒUR » N'EST PAS « COEUR » POUR UNE MACHINE. `normalize('NFD')`
  // sépare un « é » en « e » + accent, mais « œ » est UN caractère (U+0153) : il
  // en ressort intact. Les zones du BAT s'écrivent « Cœur », la vendeuse tape
  // « Coeur ». Trouvé en jouant le parcours de bout en bout — le BAT cochait le
  // DOS et pas l'avant, sur une commande qui disait « Coeur, Dos ».
  assert.ok(/replace\(LIGATURES, 'oe'\)/.test(PROJECTS),
    'les ligatures se replient avant la comparaison, sinon la face avant manque');
  // La preuve par la règle elle-même, jouée ici : deux écritures, une seule clé.
  const LIG = /[œŒ]/g;
  const red = (v) => String(v == null ? '' : v).trim().toLowerCase()
    .replace(LIG, 'oe').replace(/[æÆ]/g, 'ae')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  assert.strictEqual(red('Cœur'), red('Coeur'), '« Cœur » et « Coeur » sont la même face');
  assert.strictEqual(red('Dos'), red('dos'));

  // ⚠ ON NE COCHE QUE LES FACES DONT LE CATALOGUE A UNE IMAGE : cocher un dos
  // sans packshot de dos donnerait une feuille avec un trou.
  assert.ok(/if \(k && dispo\.includes\(k\)\) voulues\.add\(k\)/.test(PROJECTS));

  // UN PRODUIT INCONNU SE DIT. Un BAT muet qui a l'air d'avoir marché est le
  // pire des deux — la règle du §5.4 du cahier.
  assert.ok(/n'est pas au catalogue du BAT/.test(PROJECTS),
    'une référence absente du catalogue du BAT se nomme, elle ne s’avale pas');
  assert.ok(/Coloris .* inconnu/.test(PROJECTS), 'un coloris introuvable aussi');

  // ⚠ ET ON NE REPREND PAS UN VIERGE QUAND LA FICHE DIT CE QU'ELLE PRODUIT :
  // un vierge est vierge, le reprendre donnerait le premier produit du
  // catalogue dans la première couleur, sans une quantité.
  assert.ok(/if \(contexteOuverture\.prod\) await createProject\(\);/.test(PROJECTS));

  // =========================================================================
  // 3. LE BAT MEURT AVEC LE DOSSIER SOLDÉ — ET LE PDF RESTE
  // =========================================================================
  const dossier = await call('POST', '/api/requests', {
    body: {
      stage: 'production', billing_company: 'HOTEL QUI SOLDE',
      product: 'T-shirts', quantity: 30,
    },
  });
  assert.strictEqual(dossier.status, 201);
  const id = dossier.body.id;
  const autre = (await call('POST', '/api/requests', {
    body: { stage: 'production', billing_company: 'HOTEL QUI CONTINUE', product: 'T-shirts', quantity: 10 },
  })).body.id;

  // Deux projets : celui du dossier qu'on va solder, et un voisin qui reste.
  // Ils PARTAGENT un logo (les logos sont dédupliqués par empreinte) et chacun
  // a le sien.
  const faceAvec = (hashs) => ({ front: { included: true, logos: hashs.map((h) => ({ id: h, hash: h, type: 'pdf' })) } });
  await ecrireBat('projects/p-solde.json', { id: 'p-solde', crmRequestId: id, articles: [{ faces: faceAvec(['commun', 'sien']) }] });
  await ecrireBat('projects/p-voisin.json', { id: 'p-voisin', crmRequestId: autre, articles: [{ faces: faceAvec(['commun']) }] });
  await ecrireBat('projects-index.json', [
    { id: 'p-solde', crmRequestId: id }, { id: 'p-voisin', crmRequestId: autre },
  ]);
  for (const h of ['commun', 'sien']) {
    await call('PUT', `/bat/api/data/logos/${h}.pdf`, { brut: PDF });
  }
  // Le BAT sorti est depose sur la ligne : c'est la trace, et c'est ce que le
  // client a signe.
  assert.strictEqual((await call('PUT', `/api/requests/${id}/pdf/bat?name=bat.pdf`, { brut: PDF })).status, 200);

  // ON PASSE PAR TOUTES LES ETAPES SAUF LA DERNIERE : rien ne doit bouger.
  await call('PATCH', `/api/requests/${id}`, { body: { stage: 'facturation' } });
  await new Promise((f) => setTimeout(f, 200));
  assert.ok(await lireBat('projects/p-solde.json'),
    'tant que le dossier n’est pas soldé, son BAT se modifie autant qu’on veut');

  // ET MAINTENANT LA PORTE.
  const solde = await call('PATCH', `/api/requests/${id}`, { body: { stage: 'paiement' } });
  assert.strictEqual(solde.status, 200, 'solder un dossier ne peut pas échouer sur une histoire de magasin');
  await new Promise((f) => setTimeout(f, 600));

  assert.strictEqual(await lireBat('projects/p-solde.json'), null, 'le projet du dossier soldé est parti');
  assert.ok(await lireBat('projects/p-voisin.json'), 'celui du voisin n’a pas bougé');
  const index = await lireBat('projects-index.json');
  assert.deepStrictEqual(index.map((e) => e.id), ['p-voisin'], 'et l’index ne le liste plus');

  // ⚠ LE COMPTE DES LOGOS. Ils sont dédupliqués par empreinte : le logo commun
  // sert encore au voisin, on ne l'efface pas. Effacer le seul JSON rendrait
  // treize kilo-octets ; c'est ici que se trouvent les mégaoctets.
  assert.strictEqual((await call('GET', '/bat/api/data/logos/sien.pdf')).status, 404,
    'le logo que plus personne ne réclame est libéré');
  assert.strictEqual((await call('GET', '/bat/api/data/logos/commun.pdf')).status, 200,
    'celui que le voisin réclame encore reste — les logos sont partagés, on compte avant d’effacer');

  // LE PDF N'EST JAMAIS TOUCHÉ.
  assert.strictEqual((await call('GET', `/api/requests/${id}/pdf/bat`)).status, 200,
    'le PDF déposé sur la ligne survit à la purge : c’est ce que le client a signé');

  // ON NE PURGE QU'AU PASSAGE DE LA PORTE : corriger un dossier DÉJÀ soldé ne
  // relance pas un balayage complet du magasin à chaque frappe.
  assert.ok(/rows\[0\]\.stage === 'paiement' && avant\[0\]\.stage !== 'paiement'/.test(SRV));
  // ET LA PURGE EST UN CONFORT : sans `await`, après le `broadcast`.
  const zone = SRV.slice(SRV.indexOf('purgerBatDuDossier(req.params.id)'));
  assert.ok(zone.slice(0, 400).includes('.catch('), 'un magasin qui tousse n’empêche pas de solder');
  assert.ok(!/await purgerBatDuDossier/.test(SRV), 'et elle ne retarde pas la réponse');

  console.log('✓ BAT pré-rempli : la référence du fournisseur, les deux noms d’une manche, '
    + 'et un dossier soldé qui rend ses logos sans perdre son PDF');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
