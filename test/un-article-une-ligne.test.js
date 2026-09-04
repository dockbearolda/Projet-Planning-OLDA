'use strict';

// UN ARTICLE = UNE LIGNE, DES DEUX CÔTÉS DU COMPTOIR.
// ===========================================================================
// Charlie, 04/09 : « 1 article = 1 ligne partout ». Une vente à trois articles
// ouvrait trois lignes au planning ; le MÊME panier passé en devis n'en ouvrait
// qu'une, « T-shirts + 2 autres ». Deux formes pour les mêmes faits.
//
// CE N'EST PAS UNE QUESTION D'ESTHÉTIQUE. Une étape appartient à la LIGNE :
// « À commander » est une sous-étape de Préparation. Tant qu'un devis tient sur
// une seule ligne, il est tout entier en attente ou tout entier en production,
// jamais les deux — alors que les casquettes peuvent très bien partir en
// production pendant que les sacs attendent le fournisseur.
//
// CE QUE CE FICHIER TIENT :
//   1. LE DÉCOUPAGE, et surtout l'ARGENT : la somme des lignes vaut EXACTEMENT
//      le montant du devis. Sinon la colonne Prix du planning ment, et toute
//      somme faite dessus ment avec elle.
//   2. LE GROUPE, qui relie les N lignes ET leurs versions. Le NUMÉRO ne peut
//      pas servir de lien : il gagne un « -V2 » à chaque reprise, donc il
//      change là où le lien doit tenir.
//   3. LA REPRISE, qui est le vrai sujet. Une V2 doit faire coïncider le groupe
//      avec la nouvelle version SANS qu'une ligne se mette à décrire un autre
//      article — elle garderait son étape, son BAT et ses pièces jointes.
//      C'est le genre d'erreur qu'on ne découvre qu'à la production.

const assert = require('node:assert');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

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
  const call = async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const txt = res.status === 204 ? '' : await res.text();
    let corps = null;
    try { corps = txt ? JSON.parse(txt) : null; } catch (_) { corps = txt; }
    return { status: res.status, body: corps };
  };
  const ligne = async (id) => (await call('GET', `/api/requests/${id}`)).body;
  const groupeDe = async (rep) => Promise.all((rep.body.lot ? rep.body.lot.ids : [rep.body.id]).map(ligne));

  const TROIS = {
    jour: '2026-09-04', projet: 'RENTREE',
    client: { nom: 'HOTEL TROIS', type: 'professionnel' },
    regime: 'tgca', tauxTgca: 0.04, arrondi: 'aucun',
    lignes: [
      { designation: 'T-shirts', quantite: 30, unitaireHt: 20, totalHt: 600 },
      { designation: 'Casquettes', quantite: 10, unitaireHt: 15, totalHt: 150 },
      { designation: 'Sacs', quantite: 10, unitaireHt: 15, totalHt: 150 },
    ],
    sousTotalHt: 900, totalHt: 900, taxe: 36, ttc: 936,
  };

  // =========================================================================
  // 1. TROIS ARTICLES, TROIS LIGNES, ET L'ARGENT TOMBE JUSTE
  // =========================================================================
  const r1 = await call('POST', '/api/devis', TROIS);
  assert.strictEqual(r1.status, 201, JSON.stringify(r1.body));
  assert.strictEqual(r1.body.lot.total, 3, 'trois articles font trois lignes');
  const g1 = await groupeDe(r1);

  assert.deepStrictEqual(g1.map((l) => l.product), ['T-shirts', 'Casquettes', 'Sacs'],
    'chaque ligne porte SA désignation — « T-shirts + 2 autres » ne disait à personne ce qu’il avait à faire');
  assert.deepStrictEqual(g1.map((l) => l.quantity), [30, 10, 10], 'et SA quantité');

  const somme = g1.reduce((t, l) => t + Number(l.project_value), 0);
  assert.strictEqual(Math.round(somme * 100) / 100, 936,
    'LA SOMME DES LIGNES VAUT LE DEVIS, au centime — sinon la colonne Prix ment');
  // Au prorata du HT, pas de la quantité : un devis porte un ajustement global
  // et un arrondi commercial qui ne se répartissent pas à la pièce.
  assert.strictEqual(Number(g1[0].project_value), 624);
  assert.strictEqual(Number(g1[1].project_value), 156);

  // LES TROIS SONT CONTIGUËS dans « À trier » : on les range d'un geste.
  const pos = g1.map((l) => Number(l.position));
  assert.deepStrictEqual(pos, [pos[0], pos[0] + 1, pos[0] + 2], 'les lignes d’un devis se suivent');

  // LE GROUPE LES RELIE, et le rang dit laquelle est laquelle.
  const groupe = g1[0].fiche.devisGroupe;
  assert.ok(groupe, 'chaque ligne porte le groupe');
  assert.ok(g1.every((l) => l.fiche.devisGroupe === groupe), 'le même pour les trois');
  assert.deepStrictEqual(g1.map((l) => l.fiche.devisArticle), [0, 1, 2]);
  assert.ok(g1.every((l) => l.fiche.devis.lignes.length === 3),
    'le PAPIER, lui, ne se découpe pas : chaque ligne porte le devis entier — c’est ce que le client a en main');

  // =========================================================================
  // 2. UN SEUL ARTICLE RESTE UNE SEULE LIGNE
  // =========================================================================
  // Le cas courant du comptoir ne doit gagner aucun chemin nouveau.
  const r2 = await call('POST', '/api/devis', {
    ...TROIS, client: { nom: 'CLIENT UN SEUL' },
    lignes: [{ designation: 'T-shirts', quantite: 30, unitaireHt: 20, totalHt: 600 }],
    sousTotalHt: 600, totalHt: 600, taxe: 24, ttc: 624,
  });
  assert.strictEqual(r2.status, 201);
  assert.ok(!r2.body.lot, 'un seul article ne fait pas de lot');
  const seule = await ligne(r2.body.id);
  assert.strictEqual(Number(seule.project_value), 624);
  assert.ok(!seule.fiche.lot, 'et sa fiche ne prétend pas en avoir un');

  // =========================================================================
  // 3. LA REPRISE — LE GROUPE SUIT LA NOUVELLE VERSION
  // =========================================================================
  // On retire l'article DU MILIEU. C'est le cas qui casse un appariement par
  // rang : les sacs prendraient la ligne des casquettes, avec son étape et son
  // BAT, et personne ne le verrait avant la production.
  {
    const V2 = {
      ...TROIS, dossierId: g1[1].id, numero: '',
      lignes: [
        { designation: 'T-shirts', quantite: 30, unitaireHt: 20, totalHt: 600 },
        { designation: 'Sacs', quantite: 10, unitaireHt: 15, totalHt: 150 },
      ],
      sousTotalHt: 750, totalHt: 750, taxe: 30, ttc: 780,
    };
    const v = await call('POST', '/api/devis', V2);
    assert.strictEqual(v.status, 200, JSON.stringify(v.body));
    assert.strictEqual(v.body.reprise, true);
    assert.strictEqual(v.body.version, 2);
    assert.strictEqual(v.body.lot.total, 2, 'la V2 a deux articles, donc deux lignes');
    assert.strictEqual(v.body.archivees, 1, 'et celle qu’on retire quitte le planning');

    const g2 = await groupeDe(v);
    assert.deepStrictEqual(g2.map((l) => l.product), ['T-shirts', 'Sacs']);
    // ⚠ LE CŒUR DU TEST : les deux lignes qui restent sont les MÊMES qu'en V1.
    assert.strictEqual(g2[0].id, g1[0].id, 'la ligne des t-shirts est restée la sienne');
    assert.strictEqual(g2[1].id, g1[2].id,
      'et celle des sacs AUSSI — l’appariement se fait par la désignation, pas par le rang');
    assert.notStrictEqual(g2[1].id, g1[1].id,
      'les sacs n’ont surtout pas hérité de la ligne des casquettes');

    // La ligne retirée est ARCHIVÉE, pas supprimée : le client a eu une feuille
    // avec cet article dessus.
    const corbeille = (await call('GET', '/api/requests/corbeille')).body;
    const jetees = Array.isArray(corbeille) ? corbeille : (corbeille.lignes || corbeille.items || []);
    assert.ok(jetees.some((l) => l.id === g1[1].id),
      'la ligne des casquettes est dans la corbeille : archivée, jamais supprimée — elle garde son journal et ses PDF');

    // La somme suit la nouvelle version, au centime.
    const s2 = g2.reduce((t, l) => t + Number(l.project_value), 0);
    assert.strictEqual(Math.round(s2 * 100) / 100, 780);
    // Le rang est renuméroté sur la V2 : deux articles, rangs 0 et 1.
    assert.deepStrictEqual(g2.map((l) => l.fiche.devisArticle), [0, 1]);
    // LE GROUPE NE BOUGE PAS — c'est lui qui tient les versions ensemble, là où
    // le numéro gagne un « -V2 ».
    assert.ok(g2.every((l) => l.fiche.devisGroupe === groupe),
      'le groupe survit à la version, le numéro non');
    assert.match(v.body.numero, /-V2$/);
    // ET LA VERSION D'AVANT EST RANGÉE SUR CHAQUE LIGNE.
    assert.ok(g2.every((l) => l.fiche.devisPassees.length === 1 && l.fiche.devisPassees[0].version === 1),
      'chaque ligne peut dire ce qu’on avait chiffré la fois d’avant');
  }

  // =========================================================================
  // 4. UNE V3 QUI AJOUTE — LA LIGNE NAÎT, LES AUTRES RESTENT
  // =========================================================================
  {
    const V3 = {
      ...TROIS, dossierId: g1[0].id, numero: '',
      lignes: [
        { designation: 'T-shirts', quantite: 30, unitaireHt: 20, totalHt: 600 },
        { designation: 'Sacs', quantite: 10, unitaireHt: 15, totalHt: 150 },
        { designation: 'Tote bags', quantite: 20, unitaireHt: 5, totalHt: 100 },
      ],
      sousTotalHt: 850, totalHt: 850, taxe: 34, ttc: 884,
    };
    const v = await call('POST', '/api/devis', V3);
    assert.strictEqual(v.status, 200, JSON.stringify(v.body));
    assert.strictEqual(v.body.version, 3);
    assert.strictEqual(v.body.lot.total, 3);
    assert.ok(!v.body.archivees, 'rien n’est retiré : on a seulement ajouté');
    const g3 = await groupeDe(v);
    assert.deepStrictEqual(g3.map((l) => l.product), ['T-shirts', 'Sacs', 'Tote bags']);
    assert.strictEqual(g3[0].id, g1[0].id, 'les deux articles d’avant gardent leur ligne');
    assert.strictEqual(g3[1].id, g1[2].id);
    assert.ok(![g1[0].id, g1[1].id, g1[2].id].includes(g3[2].id),
      'le nouvel article naît sur une ligne neuve, il ne se greffe pas sur une archivée');
    assert.strictEqual(Math.round(g3.reduce((t, l) => t + Number(l.project_value), 0) * 100) / 100, 884);
  }

  // =========================================================================
  // 5. CE QUI NE DOIT PAS ARRIVER
  // =========================================================================
  // UN DEVIS QU'ON NE SAIT PAS DÉCOUPER RESTE ENTIER. « Une ligne juste vaut
  // mieux que quatre fausses » — c'est la règle du comptoir, et elle vaut ici.
  // Des montants qui ne décrivent pas ce devis (un HT nul face à un TTC réel)
  // ne doivent pas produire trois lignes fantaisistes.
  {
    const r = await call('POST', '/api/devis', {
      ...TROIS, client: { nom: 'CLIENT SANS PRIX' },
      lignes: [
        { designation: 'À chiffrer 1', quantite: 1, unitaireHt: 0, totalHt: 0, sansPrix: true },
        { designation: 'À chiffrer 2', quantite: 1, unitaireHt: 0, totalHt: 0, sansPrix: true },
      ],
      sousTotalHt: 0, totalHt: 0, taxe: 0, ttc: 0,
    });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const g = await groupeDe(r);
    assert.strictEqual(Math.round(g.reduce((t, l) => t + Number(l.project_value), 0) * 100) / 100, 0,
      'deux articles à chiffrer valent zéro à eux deux, et pas un centime de plus');
    assert.ok(g.every((l) => l.fiche.devis.lignes.every((x) => x.sansPrix)),
      'et l’archive se souvient qu’ils n’étaient pas chiffrés — sinon la V2 les offrirait');
  }

  // DEUX POSTES QUI ENREGISTRENT LE MÊME DEVIS EN MÊME TEMPS n'ouvrent pas six
  // lignes. C'est là que vivent les bugs, pas dans le cas nominal.
  {
    const memeNumero = (await call('POST', '/api/devis', { ...TROIS, client: { nom: 'DOUBLE ENVOI' } })).body.numero;
    const [x, y] = await Promise.all([
      call('POST', '/api/devis', { ...TROIS, client: { nom: 'DOUBLE ENVOI' }, numero: memeNumero }),
      call('POST', '/api/devis', { ...TROIS, client: { nom: 'DOUBLE ENVOI' }, numero: memeNumero }),
    ]);
    assert.ok(x.body.dejaEnregistre && y.body.dejaEnregistre,
      'le même numéro rend le dossier existant — la réponse avalée ne double rien');
    const toutes = (await call('GET', '/api/requests')).body;
    const liste = Array.isArray(toutes) ? toutes : (Object.values(toutes).find(Array.isArray) || []);
    assert.strictEqual(liste.filter((l) => l.billing_company === 'DOUBLE ENVOI').length, 3,
      'trois lignes, pas neuf');
  }

  console.log('✓ un article = une ligne : le devis découpe, la somme tombe juste, '
    + 'et une V2 garde à chaque article SA ligne');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
