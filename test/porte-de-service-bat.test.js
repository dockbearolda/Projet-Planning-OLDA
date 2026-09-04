'use strict';

// LA PORTE DE SERVICE — `/bat/api/*` N'EST PAS UN COULOIR SANS SERRURE.
// ===========================================================================
// BAT Studio est entré dans le CRM le 04/09 sous son propre préfixe : `/bat`.
// Deux gardes du CRM raisonnent sur le chemin, et toutes deux le manquaient.
//
//   1. LA PORTE DE SESSION (`PREFIXES_PROTEGES`, server.js) ne regardait que
//      `/api/`. Comptes allumés et personne de connecté, mesuré le 04/09 :
//        · `PUT /api/requests/<id>/pdf/bat`  → 401
//        · `PUT /bat/api/crm/bat/<id>`       → 200, le PDF entre dans la fiche
//      La même écriture, sur la même fiche, par la porte de service. Et
//      `POST /bat/api/menage/mockups`, qui EFFACE des images de production,
//      s'ouvrait pareillement à qui n'avait pas dit qui il était.
//
//   2. LES CAPACITÉS. Aucune route de `bat.js` ne portait `exige(...)`, là où
//      celle qu'elles appellent en porte une. Un opérateur pouvait donc écrire
//      sur n'importe quelle fiche en passant par `/bat`.
//
// CE QUE CE FICHIER TIENT, et pourquoi il est à part : un préfixe n'est pas une
// frontière, c'est une CONVENTION. Le jour où un deuxième écran arrive avec son
// propre préfixe, la faute se refait à l'identique — et elle ne se voit pas en
// relisant la route, seulement en comparant les deux chemins vers la même
// écriture. D'où un test qui les compare.
//
// ⚠ ON NE TESTE PAS QUE LE REFUS. La moitié qui coûte, c'est que la garde
// n'enferme personne dehors : « Préparation du BAT » est une sous-étape de
// l'ATELIER, donc le chef d'atelier doit pouvoir déposer son BAT — par les DEUX
// chemins. Une garde posée sur `clients` l'aurait renvoyé à faire cliquer
// quelqu'un d'autre, ce que personne ne fait : on rouvre alors la porte qu'on
// vient de fermer.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

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

  // Un « navigateur » par personne : chacun garde son cookie, comme quatre
  // postes de l'atelier.
  const postes = new Map();
  async function call(qui, method, p, { body, brut } = {}) {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(postes.get(qui) ? { Cookie: postes.get(qui) } : {}),
      },
      body: brut !== undefined ? brut : (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const set = res.headers.get('set-cookie');
    if (set) postes.set(qui, set.split(';')[0]);
    let corps = null;
    if (res.status !== 204) {
      const texte = await res.text();
      try { corps = texte ? JSON.parse(texte) : null; } catch (_) { corps = texte; }
    }
    return { status: res.status, body: corps };
  }

  // =========================================================================
  // 0. LE DOSSIER SUR LEQUEL ON VA ESSAYER D'ÉCRIRE
  // =========================================================================
  // Créé comptes ÉTEINTS : à ce moment-là tout le monde peut tout, et c'est
  // exactement le comportement qu'on veut préserver au point 1.
  const cree = await call('x', 'POST', '/api/requests', {
    body: {
      stage: 'preparation', billing_company: 'Hôtel Porte De Service',
      product: 'T-shirts', quantity: 10,
    },
  });
  assert.strictEqual(cree.status, 201, `dossier de travail créé : ${JSON.stringify(cree.body)}`);
  const id = cree.body.id;

  // =========================================================================
  // 1. COMPTES ÉTEINTS : RIEN NE CHANGE, Y COMPRIS SOUS `/bat`
  // =========================================================================
  // La même exigence que pour le reste de l'application : la garde ne doit rien
  // fermer tant que l'interrupteur dort, sinon on ne peut plus livrer par
  // morceaux.
  assert.strictEqual((await call('x', 'GET', '/bat/api/info')).status, 200,
    'comptes éteints, BAT Studio répond sans qu’on ait dit qui on est');
  assert.strictEqual(
    (await call('x', 'PUT', `/bat/api/crm/bat/${id}?name=eteint.pdf`, { brut: PDF })).status, 200,
    'comptes éteints, le dépôt passe — c’est le comportement d’avant, et il ne bouge pas');

  // =========================================================================
  // 2. ON ALLUME : LES DEUX CHEMINS RÉPONDENT LA MÊME CHOSE
  // =========================================================================
  const allume = await call('x', 'PUT', '/api/flags', { body: { comptes: true } });
  assert.strictEqual(allume.body && allume.body.flags && allume.body.flags.comptes, true,
    'l’interrupteur est bien allumé — sans ça, tout ce qui suit passerait pour vert');

  const parLaFiche = await call('y', 'PUT', `/api/requests/${id}/pdf/bat?name=anonyme.pdf`, { brut: PDF });
  const parLeBat = await call('y', 'PUT', `/bat/api/crm/bat/${id}?name=anonyme.pdf`, { brut: PDF });
  assert.strictEqual(parLaFiche.status, 401, 'la porte de la fiche demande qui on est');
  assert.strictEqual(parLeBat.status, parLaFiche.status,
    'LE défaut du 04/09 : la porte de service répondait 200 pendant que l’autre répondait 401');

  assert.strictEqual((await call('y', 'GET', '/bat/api/info')).status, 401,
    'même les lectures de `/bat/api` attendent qu’on se soit connecté');
  assert.strictEqual((await call('y', 'POST', '/bat/api/menage/mockups')).status, 401,
    'le ménage EFFACE des images : il ne s’ouvre pas à un anonyme');

  // LE STATIQUE, LUI, RESTE OUVERT. C'est la moitié qu'une garde trop large
  // casse : sans les modules et les feuilles, l'écran de connexion lui-même ne
  // se dessine plus.
  const statique = await fetch(`${base}/bat/js/monter.js`);
  assert.strictEqual(statique.status, 200,
    'les modules et les feuilles de `/bat` ne sont pas des routes d’API : ils restent servis');

  // =========================================================================
  // 3. QUI A LE DROIT DE COMPOSER UN BAT
  // =========================================================================
  for (const [prenom, code] of [['Loïc', '3333'], ['Charlie', '4444'], ['Mélina', '2222'], ['Julien', '1111']]) {
    const r = await call(prenom, 'POST', '/api/session', { body: { prenom, code } });
    assert.strictEqual(r.status, 200, `${prenom} se connecte : ${JSON.stringify(r.body)}`);
  }

  // L'OPÉRATEUR EXÉCUTE, IL NE S'ENGAGE PAS AUPRÈS DU CLIENT. Un BAT est ce
  // qu'on soumet à sa signature : ce n'est pas « travailler ».
  assert.strictEqual(
    (await call('Julien', 'PUT', `/bat/api/crm/bat/${id}?name=julien.pdf`, { brut: PDF })).status, 403,
    'l’opérateur n’a pas la capacité `bat` — et la porte de service ne la lui donne pas');
  assert.strictEqual((await call('Julien', 'GET', '/bat/api/info')).status, 200,
    'il peut RELIRE : un BAT se consulte à l’établi, c’est écrire qui se garde');

  // LE CHEF D'ATELIER, LUI, EST CELUI DONT C'EST L'ÉTAPE.
  for (const chemin of [`/bat/api/crm/bat/${id}?name=charlie.pdf`, `/api/requests/${id}/pdf/bat?name=charlie.pdf`]) {
    assert.strictEqual((await call('Charlie', 'PUT', chemin, { brut: PDF })).status, 200,
      `le chef d’atelier dépose son BAT par ${chemin.startsWith('/bat') ? 'BAT Studio' : 'la fiche'}`);
  }
  // ET IL PEUT LE REPRENDRE. Poser sans pouvoir retirer, c'est une pastille
  // qu'on remplit une fois pour toutes.
  assert.strictEqual((await call('Charlie', 'DELETE', `/api/requests/${id}/pdf/bat`)).status, 204,
    'qui pose le BAT peut le retirer — même capacité des deux côtés');

  // MAIS LE BAT N'EST PAS UN LAISSEZ-PASSER SUR LES AUTRES DOCUMENTS. Le devis
  // et la facture restent à la boutique et à la Direction.
  assert.strictEqual(
    (await call('Charlie', 'PUT', `/api/requests/${id}/pdf/devis?name=charlie.pdf`, { brut: PDF })).status, 403,
    'la capacité suit le DOCUMENT : `bat` n’ouvre pas l’emplacement du devis');

  // LA BOUTIQUE COMPOSE AUSSI — c'est elle qui prend la commande du client, et
  // c'est de sa ligne que le BAT doit pouvoir naître.
  assert.strictEqual(
    (await call('Mélina', 'PUT', `/bat/api/crm/bat/${id}?name=melina.pdf`, { brut: PDF })).status, 200,
    'la boutique compose le BAT de la commande qu’elle vient de saisir');

  // LE MÉNAGE RESTE UN RÉGLAGE : il efface des images pour tous les postes.
  assert.strictEqual((await call('Charlie', 'POST', '/bat/api/menage/mockups')).status, 403,
    'effacer des images de production n’est pas une opération d’atelier');
  assert.strictEqual((await call('Loïc', 'POST', '/bat/api/menage/mockups')).status, 200,
    'la Direction, elle, peut lancer le ménage');

  // =========================================================================
  // 4. CE QUI DOIT RESTER ÉCRIT
  // =========================================================================
  // La faute n'était pas dans une route, elle était dans une LISTE de préfixes.
  // C'est cette liste qu'on tient, sinon le prochain écran monté sous son
  // propre chemin la refera sans qu'une seule route ait l'air fausse.
  const SRV = lire('server.js');
  assert.ok(/PREFIXES_PROTEGES\s*=\s*\[[^\]]*'\/bat\/api\/'/.test(SRV),
    'la porte de session nomme `/bat/api/` — un préfixe oublié est une porte ouverte');
  const BAT = lire('bat.js');
  for (const route of ["r.put('/api/data/*', exigeBat", "r.delete('/api/data/*', exigeBat",
    "r.put('/api/crm/bat/:id', exigeBat", "r.post('/api/menage/mockups', exigeReglages"]) {
    assert.ok(BAT.includes(route), `bat.js garde sa route : ${route}`);
  }
  assert.ok(!/r\.(put|post|delete)\('\/api\/[^']*',\s*(express|asyncH)/.test(BAT),
    'aucune écriture de `/bat` ne part sans garde — la prochaine non plus');

  console.log('✓ porte de service : `/bat/api` suit la même porte et les mêmes capacités que le CRM');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
