'use strict';

// Catalogue tarifs TASSE (réglages du patron) : produits, options face/dessous,
// BAT, avec prix d'achat / vente / temps MO / temps machine. Stocké en app_meta,
// même principe que les machines. Pré-rempli au premier démarrage avec les
// valeurs du classeur patron.

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

  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };

  // 1. Seed par défaut : 3 tasses, 6 options face, 6 options dessous, 2 BAT.
  let r = await call('GET', '/api/tarifs-tasse');
  assert.strictEqual(r.status, 200);
  const produits = r.body.filter((a) => a.categorie === 'produit');
  const faces = r.body.filter((a) => a.categorie === 'face');
  const dessous = r.body.filter((a) => a.categorie === 'dessous');
  const bat = r.body.filter((a) => a.categorie === 'bat');
  assert.strictEqual(produits.length, 3, 'trois tasses par défaut');
  assert.strictEqual(faces.length, 7, 'sept options face par défaut');
  assert.strictEqual(dessous.length, 6, 'six options dessous par défaut');
  assert.strictEqual(bat.length, 2, 'BAT oui/non par défaut');
  const tasse350 = produits.find((a) => a.designation === 'Tasse Céramique 350 ml');
  assert.ok(tasse350, 'la tasse céramique 350ml est dans le seed');
  assert.strictEqual(tasse350.prixVenteTtc, 10);
  assert.strictEqual(tasse350.prixAchat, 1.78);

  const r0 = r.body;   // la grille du seed, avant que l'étape 3 ne la remplace

  // 2. Paramètres par défaut : taux horaires + TGCA du classeur.
  r = await call('GET', '/api/tarifs-tasse/parametres');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.tauxHoraireMo, 25);
  assert.strictEqual(r.body.tauxHoraireMachine, 25);
  assert.strictEqual(r.body.tgca, 0.04);

  // 2 bis. LE PRIX QUE LA GRILLE SORT EST CELUI DU MAGASIN (01/09/2026).
  // ==========================================================================
  // Le composant de la grille est la tasse NUE ; le prix de rayon, c'est elle
  // PLUS une face (« Logo OLDA existant », 6 €). Les deux ne se lisent pas au
  // même endroit, et rien à l'écran ne rapproche l'un de l'autre : la grille
  // sortait 13 € pour l'expresso et 16 € pour la tasse en bois là où le
  // comptoir les vend 14 € et 22 €. SIX EUROS perdus sur chaque devis d'une
  // tasse en bois, et personne ne pouvait le voir — le nombre affiché avait
  // l'air juste.
  //
  // Charlie, 01/09 : « les tasses en magasin c'est 16 euros, par contre si le
  // client veut ajouter son propre logo ou autre perso c'est 6 euros en plus »,
  // puis « TASSE en bois 22euro, expresso 14euros ».
  //
  // LE CHIFFRAGE SE PROUVE AILLEURS DEPUIS LE 01/09. On ne contrôle pas le
  // composant, on fait CHIFFRER une tasse et on exige le prix du comptoir — un
  // composant retouché sans regarder le total ferait repartir l'écart, et
  // c'est exactement comme ça qu'il est né. Mais ce chiffrage passait par
  // `POST /api/projets`, une route sans écran : la preuve d'un prix tenait à
  // une porte que personne n'empruntait. Le calcul vit maintenant dans
  // `tarif-tasse.js`, seul et pur, et c'est `tarif-tasse-prix-magasin.test.js`
  // qui exige les 16 / 14 / 22 € et le +6 € — en lisant la MÊME grille, par
  // la même route de Réglages que ce fichier vérifie juste au-dessus.
  //
  // Ce qui reste ici est la GRILLE : qu'elle porte les trois tasses et l'option
  // de face, sans quoi l'autre test n'aurait rien à chiffrer.
  const parCat = (cat, designation) => {
    const a = r0.find((x) => x.categorie === cat && x.designation === designation);
    assert.ok(a, `« ${designation} » doit être dans la grille`);
    return a.id;
  };
  for (const t of ['Tasse Céramique 350 ml', 'Tasse Expresso 180 ml', 'Tasse en Bois']) parCat('produit', t);
  for (const o of ['Aucune', 'Logo OLDA existant', 'Logo client vectorisé']) parCat('face', o);
  parCat('dessous', 'Aucune');
  parCat('bat', 'Non');

  // 3. PUT articles : remplace la liste, valide la forme, filtre les entrées vides.
  r = await call('PUT', '/api/tarifs-tasse', [
    { categorie: 'produit', designation: 'Tasse Test', prixAchat: 1, prixVenteTtc: 12, tempsMoMin: 1, tempsMachineMin: 0, actif: true },
    { categorie: 'produit', designation: '   ' },   // désignation vide → écartée
    { categorie: 'zzz', designation: 'Mauvaise catégorie' },   // catégorie invalide → écartée
  ]);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.length, 1, 'seule l\'entrée valide est conservée');
  assert.strictEqual(r.body[0].designation, 'Tasse Test');
  assert.strictEqual(r.body[0].prixVenteTtc, 12);
  assert.ok(r.body[0].id, 'un id est attribué');
  assert.strictEqual(r.body[0].actif, true);

  r = await call('GET', '/api/tarifs-tasse');
  assert.strictEqual(r.body.length, 1, 'le GET reflète le dernier PUT');

  r = await call('PUT', '/api/tarifs-tasse', { not: 'an array' });
  assert.strictEqual(r.status, 400, 'un corps non-tableau est refusé');

  // 4. PUT paramètres : bornage numérique simple.
  r = await call('PUT', '/api/tarifs-tasse/parametres', { tauxHoraireMo: 30, tauxHoraireMachine: 28, tgca: 0.05 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.tauxHoraireMo, 30);
  assert.strictEqual(r.body.tgca, 0.05);

  r = await call('PUT', '/api/tarifs-tasse/parametres', { tauxHoraireMo: 'pas un nombre' });
  assert.strictEqual(r.status, 400);

  // 5. LA MIGRATION DES DEUX PRIX, pour une base qui a DÉJÀ enregistré la grille.
  // ==========================================================================
  // Corriger les valeurs du code suffit à une base qui n'a jamais écrit la clé
  // — c'est le cas de la production, vérifié le 01/09. Mais un poste qui a
  // ouvert Réglages et enregistré une fois porte la clé : sans cette migration,
  // il garderait ses anciens prix, et personne ne s'en apercevrait.
  const db = require('../db');
  const poserGrille = async (liste) => {
    await db.pool.query("DELETE FROM app_meta WHERE key = 'tarifs_tasse_prix_magasin_v1'");
    await db.pool.query(
      "INSERT INTO app_meta (key, value) VALUES ('tarifs_tasse_articles', $1) "
      + 'ON CONFLICT (key) DO UPDATE SET value = $1', [JSON.stringify(liste)],
    );
  };
  const relire = async () => JSON.parse(
    (await db.pool.query("SELECT value FROM app_meta WHERE key = 'tarifs_tasse_articles'")).rows[0].value,
  );

  await poserGrille([
    { id: 'a', categorie: 'produit', designation: 'Tasse Expresso 180 ml', prixVenteTtc: 7, actif: true },
    { id: 'b', categorie: 'produit', designation: 'Tasse en Bois', prixVenteTtc: 10, actif: true },
    { id: 'c', categorie: 'face', designation: 'Logo OLDA existant', prixVenteTtc: 6, actif: true },
  ]);
  await db.corrigerTarifsTasseMagasin();
  let grille = await relire();
  assert.strictEqual(grille.find((a) => a.designation === 'Tasse Expresso 180 ml').prixVenteTtc, 8);
  assert.strictEqual(grille.find((a) => a.designation === 'Tasse en Bois').prixVenteTtc, 16);
  assert.strictEqual(grille.find((a) => a.designation === 'Logo OLDA existant').prixVenteTtc, 6,
    'le reste de la grille n’est pas touché');

  // ⚠ ON NE TOUCHE QU'À CE QUI PORTE ENCORE L'ANCIEN CHIFFRE. Un prix posé
  // délibérément à 25 € n'est pas une erreur à réparer : c'est une décision, et
  // l'écraser serait exactement le défaut qu'on corrige.
  await poserGrille([
    { id: 'a', categorie: 'produit', designation: 'Tasse en Bois', prixVenteTtc: 25, actif: true },
  ]);
  await db.corrigerTarifsTasseMagasin();
  grille = await relire();
  assert.strictEqual(grille[0].prixVenteTtc, 25, 'un prix choisi à la main ne se fait pas écraser');

  // Et la garde tient : rejouée, la migration ne repasse pas.
  await db.pool.query(
    "UPDATE app_meta SET value = $1 WHERE key = 'tarifs_tasse_articles'",
    [JSON.stringify([{ id: 'a', categorie: 'produit', designation: 'Tasse en Bois', prixVenteTtc: 10, actif: true }])],
  );
  await db.corrigerTarifsTasseMagasin();
  grille = await relire();
  assert.strictEqual(grille[0].prixVenteTtc, 10,
    'la garde app_meta empêche la migration de rejouer — elle ne vaut qu’une fois');

  console.log('✓ tarifs tasse : seed, GET/PUT articles et paramètres OK');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
