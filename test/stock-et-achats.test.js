'use strict';

// STOCK, FOURNISSEURS, CATALOGUE, ACHATS.
// ===========================================================================
// §14 (catalogue), §15 (produit à la volée), §16 (stock), §17 (fournisseurs),
// §18 (achats).
//
// POINT DE DÉPART : le mot « stock » n'apparaissait NULLE PART dans le code
// applicatif. Pas de table produit non plus — `catalog.json` proposait des
// familles et des libellés, rien de plus. Et le seul fournisseur que le code
// connaissait était TopTex, comme source de couleurs textile.
//
// LES DEUX CHOIX QUI STRUCTURENT TOUT :
//   1. le stock vit sur la VARIANTE (réf × couleur × taille), pas sur le
//      produit — on ne commande pas « des T-shirts », on commande des T-shirts
//      noirs en L ;
//   2. le disponible ne se range pas, il se déduit du réel et du réservé —
//      rangé, il se désynchronise au premier des deux qui bouge, et c'est LUI
//      qu'on regarde pour dire oui ou non à un client.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SRV = lire('server.js');
const SQL = lire('schema.sql');

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

  const postes = new Map();
  const call = async (qui, method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(postes.get(qui) ? { Cookie: postes.get(qui) } : {}),
        'X-Qui': encodeURIComponent(qui),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) postes.set(qui, set.split(';')[0]);
    const brut = res.status === 204 ? '' : await res.text();
    let corps = null;
    try { corps = brut ? JSON.parse(brut) : null; } catch (_) { corps = brut; }
    return { status: res.status, body: corps };
  };

  // =========================================================================
  // 1. FOURNISSEURS (§17)
  // =========================================================================
  const f = await call('Charlie', 'POST', '/api/fournisseurs', {
    nom: 'TopTex', contact: 'Service pro', email: 'pro@toptex.fr',
    delai_jours: 21, transport: 'maritime',
  });
  assert.strictEqual(f.status, 201);
  assert.strictEqual(f.body.delai_jours, 21, 'le délai moyen permet de répondre « quand ? » sans appeler');
  assert.strictEqual(f.body.transport, 'maritime',
    'aérien ou maritime : à Saint-Martin, c’est trois jours ou six semaines');
  assert.strictEqual((await call('Charlie', 'POST', '/api/fournisseurs', { nom: '' })).status, 400,
    'un fournisseur sans nom ne se range pas');
  const inconnu = await call('Charlie', 'POST', '/api/fournisseurs', { nom: 'X', transport: 'pigeon' });
  assert.strictEqual(inconnu.body.transport, null, 'un transport inconnu vaut « rien », pas « pigeon »');

  // =========================================================================
  // 2. LE CATALOGUE NE BLOQUE JAMAIS (§14, §15)
  // =========================================================================
  // « Le système ne doit jamais me bloquer parce qu'un produit n'existe pas
  //   encore dans le catalogue. » Une désignation suffit — tout le reste est
  //   facultatif.
  const minimal = await call('Charlie', 'POST', '/api/produits', { designation: 'Objet inconnu' });
  assert.strictEqual(minimal.status, 201, 'une désignation suffit à créer un produit');

  const p = await call('Charlie', 'POST', '/api/produits', {
    designation: 'T-shirt NS300', famille: 'T-shirt', marque: 'Native Spirit',
    ref_interne: 'OLDA-TS-001', supplier_id: f.body.id, prix_achat: 3.2, prix_vente: 18,
    technique: 'dtf',
    variantes: [
      { couleur: 'Noir', taille: 'M', stock_reel: 12, best_seller: true },
      { couleur: 'Noir', taille: 'L', stock_reel: 8 },
      { couleur: 'Blanc', taille: 'M', stock_reel: 0 },
    ],
  });
  assert.strictEqual(p.status, 201);

  // UN PRODUIT SANS VARIANTE EN REÇOIT UNE, neutre : sans elle il n'aurait aucun
  // endroit où porter du stock, et il faudrait y penser plus tard — jamais.
  const seul = await call('Charlie', 'GET', '/api/produits?q=Objet inconnu');
  assert.strictEqual(seul.body[0].variantes.length, 1,
    'même sans déclinaison, un produit a où porter son stock');

  // =========================================================================
  // 3. UN SEUL CHAMP DE RECHERCHE (§16)
  // =========================================================================
  // « Recherche rapide par référence, marque, modèle, couleur, taille,
  //   fournisseur. » On ne demande à personne de choisir DANS QUOI il cherche.
  for (const [q, attendu] of [
    ['OLDA-TS-001', 'par référence interne'],
    ['native', 'par marque'],
    ['toptex', 'par fournisseur'],
    ['noir', 'par couleur'],
  ]) {
    const r = await call('Charlie', 'GET', `/api/produits?q=${encodeURIComponent(q)}`);
    assert.ok(r.body.some((x) => x.designation === 'T-shirt NS300'), `recherche ${attendu}`);
  }
  // Sans accent ni casse : « melina » trouve « Mélina » partout ailleurs, ici
  // « CERAMIQUE » doit trouver « céramique ».
  await call('Charlie', 'POST', '/api/produits', {
    designation: 'Mug céramique 350 ml', famille: 'Tasse', prix_achat: 1.78,
    variantes: [{ couleur: 'Blanc', stock_reel: 48 }],
  });
  const sansAccent = await call('Charlie', 'GET', '/api/produits?q=CERAMIQUE');
  assert.ok(sansAccent.body.length, 'la recherche ignore accents et casse');

  // =========================================================================
  // 4. RÉEL, RÉSERVÉ, DISPONIBLE
  // =========================================================================
  const tshirt = (await call('Charlie', 'GET', '/api/produits?q=NS300')).body[0];
  assert.strictEqual(tshirt.stock_reel, 20, 'le stock du produit est la somme de ses déclinaisons');
  // La VALEUR est au prix d'ACHAT : au prix de vente, ce serait un chiffre
  // d'affaires espéré, pas ce qu'on a immobilisé.
  assert.strictEqual(tshirt.valeur, 64, '20 pièces à 3,20 € d’achat');

  const noirM = tshirt.variantes.find((v) => v.couleur === 'Noir' && v.taille === 'M');
  assert.strictEqual(noirM.disponible, 12);
  assert.strictEqual(noirM.best_seller, true, '« ce qu’on remet en rayon sans réfléchir »');

  // RÉSERVER NE SORT RIEN : la marchandise est là, elle est promise. C'est la
  // différence entre « il en reste douze » et « il en reste douze mais dix sont
  // pour l'Hôtel Esmeralda ».
  const res = await call('Charlie', 'POST', `/api/variantes/${noirM.id}/reserver`, { quantite: 10 });
  assert.strictEqual(res.body.stock_reel, 12, 'le réel ne bouge pas');
  assert.strictEqual(res.body.disponible, 2, '… mais il ne reste que deux de libres');

  // LIBÉRER PLUS QUE RÉSERVÉ ne doit jamais donner un « réservé négatif » : le
  // disponible dépasserait le réel, et on promettrait de la marchandise qui
  // n'existe pas.
  const trop = await call('Charlie', 'POST', `/api/variantes/${noirM.id}/reserver`, { quantite: -99 });
  assert.strictEqual(trop.body.stock_reserve, 0);
  assert.strictEqual(trop.body.disponible, 12, 'le disponible ne dépasse jamais le réel');

  // =========================================================================
  // 5. LE STOCK NE CHANGE QUE PAR UN MOUVEMENT DATÉ ET SIGNÉ
  // =========================================================================
  // Sans journal, « il en manque trois » n'a aucune réponse : casse ? sortie
  // oubliée ? erreur de comptage ?
  const bouge = await call('Julien', 'POST', `/api/variantes/${noirM.id}/mouvement`, { delta: -3, motif: 'sortie' });
  assert.strictEqual(bouge.body.stock_reel, 9);
  const { pool } = require('../db.js');
  const { rows: moves } = await pool.query(
    'SELECT * FROM stock_moves WHERE variant_id = $1 ORDER BY created_at DESC', [noirM.id],
  );
  assert.strictEqual(moves[0].delta, -3);
  assert.strictEqual(moves[0].motif, 'sortie');
  assert.strictEqual(moves[0].qui, 'Julien', 'le mouvement dit QUI l’a fait');

  // ON LAISSE LE STOCK DESCENDRE SOUS ZÉRO. Refuser une sortie parce que le
  // compteur dit 0 alors que la pièce est dans la main de l'opérateur, c'est lui
  // apprendre à ne plus rien saisir. Un négatif se VOIT et se corrige à
  // l'inventaire ; une saisie refusée ne se voit jamais.
  const bas = await call('Julien', 'POST', `/api/variantes/${noirM.id}/mouvement`, { delta: -50, motif: 'sortie' });
  assert.strictEqual(bas.body.stock_reel, -41, 'un négatif est un signal, pas une erreur à cacher');
  await call('Julien', 'POST', `/api/variantes/${noirM.id}/mouvement`, { delta: 50, motif: 'inventaire' });

  assert.strictEqual((await call('Julien', 'POST', `/api/variantes/${noirM.id}/mouvement`, { delta: 0 })).status, 400,
    'un mouvement de zéro n’est pas un mouvement');

  // =========================================================================
  // 6. ACHATS (§18) — REGROUPER, SUIVRE, RECEVOIR
  // =========================================================================
  const o = await call('Charlie', 'POST', '/api/achats', {
    numero: 'AC-2026-014', supplier_id: f.body.id, transport: 'maritime',
  });
  assert.strictEqual(o.status, 201);

  // Une ligne peut citer LE DOSSIER qui l'a demandée : c'est ce qui permet de
  // regrouper les besoins de plusieurs projets, et de savoir quel dossier
  // débloquer à la réception.
  const dossier = await call('Charlie', 'POST', '/api/requests', {
    stage: 'preparation', sub_stage: 'a_commander', billing_company: 'Hôtel Attente',
  });
  const l1 = await call('Charlie', 'POST', `/api/achats/${o.body.id}/lignes`, {
    designation: 'T-shirt NS300 Noir M', quantite: 24, prix_unitaire: 3.2,
    variant_id: noirM.id, request_id: dossier.body.id,
  });
  assert.strictEqual(l1.status, 201);
  assert.strictEqual(l1.body.request_id, dossier.body.id);

  const liste = await call('Charlie', 'GET', '/api/achats');
  assert.strictEqual(liste.status, 200,
    'la liste des achats doit répondre EN LOCAL aussi : pg-mem ne gère pas les sous-requêtes corrélées');
  assert.strictEqual(liste.body[0].nb_lignes, 1);
  assert.strictEqual(liste.body[0].statut_label, 'À commander', 'les statuts se lisent en français');

  // Les DATES se posent AVEC le statut : une commande passée « commandé » sans
  // date de commande ne permet de calculer aucun délai, et c'est le délai qu'on
  // regarde.
  const cmd = await call('Charlie', 'PATCH', `/api/achats/${o.body.id}`, { statut: 'commande' });
  assert.ok(cmd.body.commande_le, 'passer « commandé » date la commande');
  assert.strictEqual((await call('Charlie', 'PATCH', `/api/achats/${o.body.id}`, { statut: 'perdu' })).status, 400,
    'un statut hors liste se refuse');

  // RÉCEPTION PARTIELLE : c'est le cas NORMAL — le fournisseur envoie ce qu'il a.
  const partielle = await call('Charlie', 'POST', `/api/achats/${o.body.id}/reception`, {
    lignes: [{ id: l1.body.id, recu: 10 }],
  });
  assert.strictEqual(partielle.body.statut, 'commande',
    'la commande ne passe pas « reçue » tant qu’il manque quelque chose');
  const apres10 = (await call('Charlie', 'GET', '/api/produits?q=NS300')).body[0]
    .variantes.find((v) => v.id === noirM.id);
  assert.strictEqual(apres10.stock_reel, 19, 'la réception fait monter le stock de la variante');

  const reste = await call('Charlie', 'POST', `/api/achats/${o.body.id}/reception`, {
    lignes: [{ id: l1.body.id, recu: 14 }],
  });
  assert.strictEqual(reste.body.statut, 'recu', 'tout reçu : la commande se clôt seule');
  assert.ok(reste.body.recu_le, '… et se date');

  // Chaque réception laisse sa trace, avec le dossier qu'elle débloque.
  const { rows: recus } = await pool.query(
    "SELECT * FROM stock_moves WHERE variant_id = $1 AND motif = 'reception'", [noirM.id],
  );
  assert.strictEqual(recus.length, 2, 'deux réceptions, deux mouvements');
  assert.ok(recus.every((m) => m.request_id === dossier.body.id),
    '… et chacun sait quel dossier attendait cette marchandise');

  // =========================================================================
  // 7. LE PRIX D'ACHAT NE SORT PAS DE LA DIRECTION
  // =========================================================================
  await call('x', 'PUT', '/api/flags', { comptes: true });
  for (const [prenom, code] of [['Loïc', '3333'], ['Mélina', '2222']]) {
    await call(prenom, 'POST', '/api/session', { prenom, code });
  }
  const vueDirection = (await call('Loïc', 'GET', '/api/produits?q=NS300')).body[0];
  assert.ok(vueDirection.prix_achat != null && vueDirection.valeur != null,
    'la Direction voit le prix d’achat et la valeur du stock');
  const vueBoutique = (await call('Mélina', 'GET', '/api/produits?q=NS300')).body[0];
  assert.strictEqual(vueBoutique.prix_achat, undefined, 'la boutique ne voit pas ce qu’on paie');
  assert.strictEqual(vueBoutique.valeur, undefined, '… ni ce que vaut le stock');
  assert.ok(vueBoutique.variantes.length, '… mais elle voit les quantités : c’est son métier');

  // =========================================================================
  // 8. CE QUI SE LIT DANS LE SOURCE
  // =========================================================================
  assert.ok(/stock_reel\s+int NOT NULL DEFAULT 0/.test(SQL) && /stock_reserve\s+int/.test(SQL),
    'réel et réservé sont deux colonnes ; le disponible n’en est pas une');
  assert.ok(!/disponible\s+int/.test(SQL),
    'le disponible ne se RANGE pas : il se désynchroniserait au premier des deux qui bouge');
  assert.ok(/FROM variants WHERE id = \$1 FOR UPDATE/.test(SRV),
    'deux réceptions saisies en même temps ne doivent pas partir du même stock d’avant');
  assert.ok(/GREATEST\(0, stock_reserve/.test(SRV),
    'une réservation ne descend jamais sous zéro');
  assert.ok(!/UPDATE variants SET stock_reel = \$/.test(SRV),
    'on n’écrit JAMAIS un stock en valeur absolue : chaque changement est un mouvement');

  console.log('✓ stock : réel, réservé, disponible — et rien ne bouge sans laisser de trace');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
