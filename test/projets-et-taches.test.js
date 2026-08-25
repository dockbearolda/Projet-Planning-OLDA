'use strict';

// CLIENT → PROJET → ARTICLE → TÂCHES : les deux niveaux qui manquaient.
// ===========================================================================
// Demande du patron, §1 :
//
//   « Un client peut avoir plusieurs projets. Un projet peut contenir plusieurs
//     articles. CHAQUE ARTICLE PEUT AVOIR SON PROPRE PROCESSUS DE PRODUCTION. »
//     T-shirt : validation → commande textile → fichier → DTF → pressage →
//     contrôle. Gourde : validation → fichier → UV → contrôle.
//
// Ce que le modèle savait faire : le client (table `clients`) et l'article (une
// ligne de `requests`, depuis le travail sur les lots). Entre les deux, RIEN :
// un « projet » était une ligne de commande, et le regroupement d'un panier
// vivait à l'écran, par la référence du ticket. En dessous, rien non plus : les
// sept sous-étapes de production sont une liste PLATE et partagée — une ligne se
// trouve à l'une d'elles, elle n'a pas de liste à elle.
//
// Ce fichier garde les deux niveaux ajoutés, et surtout les choix qui les
// rendent utilisables : le projet est un REGROUPEMENT et pas un passage obligé,
// le total se RECALCULE, changer de modèle ne perd pas le travail fait, et une
// copie repart de zéro.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SRV = lire('server.js');
const SQL = lire('schema.sql');
const DB = lire('db.js');
const MT = lire('public/montravail.js');

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

  const call = async (method, p, body, qui) => {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(qui ? { 'X-Qui': encodeURIComponent(qui) } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const brut = res.status === 204 ? '' : await res.text();
    let corps = null;
    try { corps = brut ? JSON.parse(brut) : null; } catch (_) { corps = brut; }
    return { status: res.status, body: corps };
  };

  // =========================================================================
  // 1. UN PANIER DE 4 ARTICLES DEVIENT UN DOSSIER
  // =========================================================================
  const vente = await call('POST', '/api/comptoir/projet', {
    kind: 'vente', name: 'Uniformes été', amount: '430', ref: '26.08.25-901',
    clientObj: { company: 'Hôtel Esmeralda', name: 'Esmeralda' },
    articles: [
      { label: 'Mugs', qty: 10, amount: '120' },
      { label: 'T-shirts', qty: 3, amount: '90' },
      { label: 'Décapsuleurs', qty: 4, amount: '40' },
      { label: 'Casquettes', qty: 10, amount: '180' },
    ],
    payment: { paid: true, mode: 'cb' },
  }, 'Mélina');
  assert.strictEqual(vente.status, 201, JSON.stringify(vente.body));
  assert.strictEqual(vente.body.lot.total, 4);

  const premier = await call('GET', `/api/requests/${vente.body.lot.ids[0]}`);
  const projetId = premier.body.project_id;
  assert.ok(projetId, 'les quatre lignes appartiennent à un DOSSIER, pas seulement à une bannière');

  const projet = await call('GET', `/api/projets/${projetId}`);
  assert.strictEqual(projet.status, 200);
  assert.strictEqual(projet.body.nom, 'Hôtel Esmeralda — 26.08.25-901',
    'le nom s’assemble de ce qu’on a — un dossier sans référence ne s’appelle pas « Client — null »');
  assert.strictEqual(projet.body.numero, '26.08.25-901');
  assert.strictEqual(projet.body.articles.length, 4);

  // LE TOTAL SE RECALCULE, il ne se range pas : rangé, il se désynchronise au
  // premier article modifié ailleurs — et un total faux est pire que pas de total.
  assert.strictEqual(projet.body.total, 430, 'la somme des articles vaut le ticket');
  await call('PATCH', `/api/requests/${projet.body.articles[0].id}`, { project_value: 150 });
  const relu = await call('GET', `/api/projets/${projetId}`);
  assert.strictEqual(relu.body.total, 460, '… et elle suit, sans qu’on ait à la mettre à jour');
  await call('PATCH', `/api/requests/${projet.body.articles[0].id}`, { project_value: 120 });

  // UN SEUL ARTICLE NE FAIT PAS DE DOSSIER. Le niveau ne dirait plus rien s'il y
  // avait autant de projets que de commandes.
  const simple = await call('POST', '/api/comptoir/projet', {
    kind: 'vente', name: 'Un mug', amount: '25', ref: '26.08.25-902',
    clientObj: { company: 'Client Simple' },
    articles: [{ label: 'Mug', qty: 1, amount: '25' }],
    payment: { paid: true, mode: 'cb' },
  }, 'Mélina');
  assert.strictEqual(simple.status, 201);
  const ligneSeule = await call('GET', `/api/requests/${simple.body.id}`);
  assert.strictEqual(ligneSeule.body.project_id, null,
    'une commande d’un seul article n’a pas besoin d’un dossier');

  // =========================================================================
  // 2. LA PROCHAINE ACTION (§5)
  // =========================================================================
  // « C'est une notion très importante. L'objectif est qu'un projet ne puisse
  //   pas être oublié. » Elle ne se DÉDUIT pas de l'étape : « relancer le
  //   client » n'est l'étape de personne.
  assert.strictEqual(projet.body.action, null, 'un dossier neuf n’a pas encore d’action — et il le dit');
  const pa = await call('PATCH', `/api/projets/${projetId}`, {
    action: 'Commander les mugs chez le fournisseur', action_qui: 'Mélina', action_date: '2026-09-01',
  });
  assert.strictEqual(pa.status, 200);
  assert.strictEqual(pa.body.action, 'Commander les mugs chez le fournisseur');
  assert.strictEqual(pa.body.action_qui, 'Mélina');
  // Un pilote hors équipe ne s'écrit pas : sinon la liste des responsables ne
  // veut plus rien dire, et personne ne se sent visé.
  const faux = await call('PATCH', `/api/projets/${projetId}`, { action_qui: 'Quelqu’un' });
  assert.strictEqual(faux.body.action_qui, null);

  // =========================================================================
  // 3. LES ÉTAPES D'UN ARTICLE (§1, §28, §30)
  // =========================================================================
  const idMug = projet.body.articles[0].id;
  const modeles = await call('GET', '/api/modeles');
  assert.ok(modeles.body.find((m) => m.id === 'tshirt_dtf'), 'les modèles sont livrés d’origine');

  const posees = await call('POST', `/api/requests/${idMug}/taches`, { modele: 'tshirt_dtf' }, 'Charlie');
  assert.strictEqual(posees.status, 201);
  assert.deepStrictEqual(
    posees.body.map((t) => t.libelle),
    ['Préparation du fichier', 'Impression DTF', 'Découpe', 'Pressage', 'Contrôle'],
    'le modèle pose SA liste, dans SON ordre',
  );
  assert.strictEqual(posees.body[0].qte_prevue, 10, 'chaque étape sait combien de pièces sont attendues');

  // On coche les deux premières, signées.
  for (const t of posees.body.slice(0, 2)) {
    const r = await call('PATCH', `/api/taches/${t.id}`, { fait: true }, 'Julien');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.qui, 'Julien', 'l’heure et le nom se posent AVEC la case');
    assert.ok(r.body.fait_at, '… et pas à côté');
  }

  // CHANGER DE MODÈLE NE PERD PAS LE TRAVAIL FAIT. C'est le premier réflexe de
  // quelqu'un qui s'est trompé de modèle ; effacer sa matinée serait la pire
  // réponse possible. Et poser deux fois ne doit pas donner dix étapes.
  const rechange = await call('POST', `/api/requests/${idMug}/taches`, { modele: 'textile_commande' }, 'Charlie');
  assert.strictEqual(rechange.body.length, 6, 'la liste REMPLACE, elle ne s’ajoute pas');
  const gardees = rechange.body.filter((t) => t.fait).map((t) => t.libelle);
  assert.deepStrictEqual(gardees, ['Préparation du fichier', 'Impression DTF'],
    'ce qui portait le même nom reste FAIT — changer de modèle n’efface pas la matinée');
  assert.ok(rechange.body.every((t) => !t.fait || t.qui === 'Julien'), '… avec son signataire');

  assert.strictEqual((await call('POST', `/api/requests/${idMug}/taches`, { modele: 'inconnu' })).status, 400,
    'un modèle inconnu se refuse au lieu de poser une liste vide');

  // =========================================================================
  // 4. QUANTITÉS ET PERTES (§26), CONTRÔLE (§27)
  // =========================================================================
  // « Prévu : 50, produit : 49, perte : 1. » L'étape « Contrôle » est une tâche
  // comme une autre — ce sont ses quantités qui disent ce qu'elle a trouvé.
  // Une ligne de production n'a pas besoin de deux mécaniques pour ça.
  const controle = rechange.body[rechange.body.length - 1];
  assert.strictEqual(controle.libelle, 'Contrôle');
  const compte = await call('PATCH', `/api/taches/${controle.id}`, {
    fait: true, qte_faite: 9, perte: 1, commentaire: 'Un mug fêlé à la sortie du four',
  }, 'Julien');
  assert.strictEqual(compte.body.qte_faite, 9);
  assert.strictEqual(compte.body.perte, 1);
  assert.strictEqual(compte.body.commentaire, 'Un mug fêlé à la sortie du four');
  assert.strictEqual((await call('PATCH', `/api/taches/${controle.id}`, { qte_faite: 'beaucoup' })).status, 400,
    'un compte doit être un nombre : « beaucoup » ne se range pas');

  // COCHER UNE ÉTAPE TOUCHE LA LIGNE. Sans ça, `updated_at` ne bouge pas, le
  // temps réel ne dit rien, et l'écran d'à côté garde une case décochée.
  const avantCoche = (await call('GET', `/api/requests/${idMug}`)).body.updated_at;
  await new Promise((r) => setTimeout(r, 20));
  await call('PATCH', `/api/taches/${rechange.body[2].id}`, { fait: true }, 'Julien');
  const apresCoche = (await call('GET', `/api/requests/${idMug}`)).body.updated_at;
  assert.notStrictEqual(apresCoche, avantCoche, 'la ligne est touchée : le temps réel a de quoi prévenir');

  // =========================================================================
  // 5. DUPLIQUER UN DOSSIER (§29) — SANS SON AVANCEMENT
  // =========================================================================
  const copie = await call('POST', `/api/projets/${projetId}/copie`, {}, 'Mélina');
  assert.strictEqual(copie.status, 201);
  assert.strictEqual(copie.body.articles.length, 4, 'les quatre articles suivent');
  assert.match(copie.body.nom, /\(copie\)$/);
  assert.strictEqual(copie.body.numero, null,
    'la copie n’emporte PAS la référence du ticket : c’est la clé du dossier d’origine');
  assert.strictEqual(copie.body.taches.length, 0,
    'et surtout PAS l’avancement — une copie qui se croit à moitié faite fait livrer une caisse vide');
  const copieUn = copie.body.articles[0];
  assert.strictEqual(copieUn.deadline, null, 'ni la date : c’est une nouvelle commande');
  assert.ok(!copieUn.fiche || !copieUn.fiche.ref, 'ni la référence dans la fiche');

  // =========================================================================
  // 6. CE QUI SE LIT DANS LE SOURCE
  // =========================================================================
  // La liste d'étapes se REMPLACE dans une transaction : à mi-chemin, l'article
  // se retrouverait sans aucune étape — donc sans travail à faire, aux yeux de
  // celui qui regarde son écran.
  const posage = SRV.slice(SRV.indexOf("app.post('/api/requests/:id/taches'"));
  assert.ok(/BEGIN[\s\S]{0,900}DELETE FROM tasks[\s\S]{0,900}COMMIT/.test(posage),
    'poser une liste d’étapes est tout ou rien');
  assert.ok(/ROLLBACK/.test(posage.slice(0, 2600)), '… et une panne remet tout en place');

  // Le dossier naît dans la MÊME transaction que ses articles : créé avant, il
  // resterait en base tout seul si l'insertion échouait.
  const comptoir = SRV.slice(SRV.indexOf("app.post('/api/comptoir/projet'"));
  const posBegin = comptoir.indexOf("cx.query('BEGIN')");
  const posProjet = comptoir.indexOf('INSERT INTO projects');
  assert.ok(posBegin > 0 && posProjet > posBegin,
    'le projet se crée DANS la transaction — sinon un échec laisse un dossier vide en base');

  // Le total ne se range nulle part.
  assert.ok(!/ALTER TABLE projects[\s\S]{0,80}total/.test(DB) && !/\btotal\b\s+numeric/.test(SQL),
    'le total du dossier ne se RANGE pas : il se recalcule, sinon il se désynchronise');

  // La migration des lots existants a sa PROPRE garde (deux incidents réels sont
  // venus d'une garde partagée).
  assert.ok(/lots_en_projets_v1/.test(DB), 'la reprise des lots déjà en base a sa garde à elle');

  // Le compte ne se demande QU'À la dernière étape, et seulement une fois faite.
  assert.ok(/derniere && t\.fait/.test(MT),
    'le compte se demande à la dernière étape faite — pas sur chacune, pas avant');
  assert.ok(/addEventListener\('change'/.test(MT) && !/addEventListener\('input'/.test(MT),
    'le champ s’écrit à la PERTE DU FOCUS : à la frappe, un rendu reprendrait le champ sous les doigts');

  console.log('✓ projets : le dossier et ses étapes existent, le total se recalcule, la copie repart de zéro');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
