'use strict';

// QUATRE PERSONNES, QUATRE RÔLES, ET LE SERVEUR QUI TRANCHE.
// ===========================================================================
// Demande du patron, §3 et §39 :
//
//   « Construire les permissions proprement dès le départ. NE PAS SIMPLEMENT
//     CACHER LES BOUTONS CÔTÉ INTERFACE. Les permissions doivent également être
//     contrôlées côté serveur. »
//   « L'opérateur ne doit pas avoir accès aux données financières sensibles. »
//
// Attribution donnée par Charlie le 25/08 : Loïc = Direction, Charlie = Chef
// d'atelier, Mélina = Boutique, Julien = Opérateur.
//
// Ce que faisait le code avant : UN mot de passe partagé, et `server.js` jetait
// l'identifiant. Les quatre prénoms n'étaient que des étiquettes sur une
// colonne. Il n'y avait donc ni rôle, ni permission, ni « qui ».
//
// LE PIÈGE PRINCIPAL, ET C'EST LUI QUI JUSTIFIE LA MOITIÉ DE CE FICHIER :
// `peut(null, …)` doit rendre `true` — c'est le comportement d'avant, celui
// qu'on garde tant que les comptes dorment. Mais alors, comptes ALLUMÉS, un
// poste qui se contente de NE PAS se connecter aurait tous les droits.
// L'interrupteur n'afficherait qu'un écran de connexion qu'on peut ignorer.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SRV = lire('server.js');
const APP = lire('public/app.js');
const SESSION = lire('public/session.js');
const SW = lire('public/sw.js');
const HTML = lire('public/index.html');

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

  // Un « navigateur » par personne : chacun garde son propre cookie, comme
  // quatre postes de l'atelier.
  const postes = new Map();
  const call = async (qui, method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(postes.get(qui) ? { Cookie: postes.get(qui) } : {}),
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
  const seConnecter = (prenom, code) => call(prenom, 'POST', '/api/session', { prenom, code });

  // =========================================================================
  // 1. COMPTES ÉTEINTS : RIEN NE CHANGE
  // =========================================================================
  // C'est la condition pour livrer ce chantier sans toucher au comptoir qui
  // tourne tous les jours. S'il fallait allumer les comptes pour déployer, on
  // ne pourrait pas livrer par morceaux.
  assert.strictEqual((await call('x', 'GET', '/api/requests')).status, 200,
    'comptes éteints, la liste s’ouvre sans se connecter');
  const dort = await call('x', 'GET', '/api/session');
  assert.strictEqual(dort.body.comptes, false);
  assert.strictEqual(dort.body.moi, null);
  assert.deepStrictEqual(dort.body.equipe, [],
    'on ne publie pas la liste des prénoms tant que la connexion ne sert à rien');
  assert.strictEqual((await call('x', 'POST', '/api/session', { prenom: 'Loïc', code: '1234' })).status, 409,
    'se connecter n’a pas de sens quand les comptes dorment — et on le DIT');

  // =========================================================================
  // 2. ON ALLUME : LA PORTE SE FERME
  // =========================================================================
  await call('x', 'PUT', '/api/flags', { comptes: true });

  const ferme = await call('y', 'GET', '/api/requests');
  assert.strictEqual(ferme.status, 401,
    'LE trou à ne pas laisser : sans cette porte, ne PAS se connecter donnerait tous les droits');
  assert.strictEqual(ferme.body.connexion, true,
    '401 et pas 403 : ce n’est pas « interdit à vous », c’est « dis-moi qui tu es »');

  // Trois portes restent ouvertes, et seulement trois.
  assert.strictEqual((await call('y', 'GET', '/api/session')).status, 200,
    'la route qui dit s’il faut se connecter reste ouverte');
  assert.strictEqual((await call('y', 'GET', '/api/version')).status, 200,
    'le numéro de version aussi : la bulle « mise à jour » l’interroge en boucle');

  const equipe = (await call('y', 'GET', '/api/session')).body.equipe;
  assert.deepStrictEqual(
    equipe.map((u) => `${u.prenom}=${u.role}`),
    ['Loïc=direction', 'Charlie=chef_atelier', 'Mélina=boutique', 'Julien=operateur'],
    'les quatre personnes, dans l’ordre, avec les rôles donnés par Charlie le 25/08',
  );
  assert.ok(equipe.every((u) => u.aUnCode === false),
    'personne n’a encore de code : la première connexion le pose');

  // =========================================================================
  // 3. LE CODE : POSÉ À LA PREMIÈRE CONNEXION, EXIGÉ ENSUITE
  // =========================================================================
  for (const [prenom, code] of [['Loïc', '3333'], ['Charlie', '4444'], ['Mélina', '2222'], ['Julien', '1111']]) {
    const r = await seConnecter(prenom, code);
    assert.strictEqual(r.status, 200, `${prenom} se connecte : ${JSON.stringify(r.body)}`);
    assert.strictEqual(r.body.moi.prenom, prenom);
  }
  assert.strictEqual((await call('z', 'POST', '/api/session', { prenom: 'Julien', code: '9999' })).status, 401,
    'le code posé est ensuite EXIGÉ — sinon la première connexion ne servirait à rien');
  assert.strictEqual((await call('z', 'POST', '/api/session', { prenom: 'Jean-Michel', code: '1111' })).status, 404,
    'un prénom hors équipe n’ouvre rien');
  assert.strictEqual((await call('z', 'POST', '/api/session', { prenom: 'Charlie', code: '12' })).status, 401,
    'un code trop court sur un compte QUI EN A DÉJÀ UN est un code faux, pas une création');

  // =========================================================================
  // 4. L'ARGENT N'ARRIVE PAS CHEZ L'OPÉRATEUR
  // =========================================================================
  // « Ne pas simplement cacher les boutons » : la différence se mesure DANS LA
  // RÉPONSE RÉSEAU. Un opérateur qui ouvre les outils de son navigateur ne doit
  // pas y trouver le prix.
  const ARGENT = ['project_value', 'acompte_demande', 'acompte_verse', 'acompte_montant', 'paye', 'paiement_mode'];
  const cree = await call('Mélina', 'POST', '/api/requests', {
    stage: 'production', sub_stage: 'prod_uv', billing_company: 'Hôtel Permission',
    product: 'Gourdes gravées', quantity: 30, project_value: 690,
  });
  assert.strictEqual(cree.status, 201);
  const id = cree.body.id;

  const vueOperateur = await call('Julien', 'GET', `/api/requests/${id}`);
  assert.strictEqual(vueOperateur.status, 200, 'l’opérateur voit bien la commande…');
  for (const champ of ARGENT) {
    assert.ok(!(champ in vueOperateur.body), `… mais « ${champ} » n’est même pas dans la réponse`);
  }
  assert.strictEqual(vueOperateur.body.product, 'Gourdes gravées', 'il voit ce qu’il doit produire');

  const vueBoutique = await call('Mélina', 'GET', `/api/requests/${id}`);
  assert.strictEqual(Number(vueBoutique.body.project_value), 690, 'la boutique, elle, voit le prix');

  // La liste, la recherche et le Point du jour passent par le même filtre : une
  // route ajoutée demain sans y penser rouvrirait le trou.
  const liste = await call('Julien', 'GET', '/api/requests?stage=production');
  const fuite = liste.body.find((l) => ARGENT.some((c) => c in l));
  assert.ok(!fuite, 'la LISTE ne fuit pas non plus');
  const cherche = await call('Julien', 'GET', '/api/requests/recherche?q=Permission');
  assert.ok(!cherche.body.some((l) => ARGENT.some((c) => c in l)), 'la recherche non plus');
  const synth = await call('Julien', 'GET', '/api/requests/synthese');
  assert.ok(!(synth.body.lignes || []).some((l) => ARGENT.some((c) => c in l)), 'la synthèse non plus');

  // =========================================================================
  // 5. ÉCRITURE : CHAMP PAR CHAMP, PAS ROUTE PAR ROUTE
  // =========================================================================
  // Le même PATCH sert à faire avancer une tâche, à changer un pilote et à
  // marquer un acompte reçu. Refuser la route entière à l'opérateur
  // l'empêcherait de terminer son travail ; la lui ouvrir lui donnerait les prix.
  const patch = (qui, corps) => call(qui, 'PATCH', `/api/requests/${id}`, corps);

  assert.strictEqual((await patch('Julien', { sub_stage: 'montage_finition' })).status, 200,
    'l’opérateur AVANCE sa tâche — c’est tout l’objet de son écran');
  assert.strictEqual((await patch('Julien', { flag: 'bloque', flag_reason: 'Presse en panne' })).status, 200,
    '… et il signale un blocage : le patron l’écrit noir sur blanc');
  assert.strictEqual((await patch('Julien', { project_value: 1 })).status, 403,
    '… mais il ne touche pas au prix');
  assert.strictEqual((await patch('Julien', { responsable: 'Charlie' })).status, 403,
    '… ni à l’attribution');

  assert.strictEqual((await patch('Mélina', { project_value: 720 })).status, 200, 'la boutique fixe le prix');
  assert.strictEqual((await patch('Mélina', { acompte_verse: true })).status, 200, '… et enregistre l’acompte');
  assert.strictEqual((await patch('Mélina', { priority: 3 })).status, 403,
    '… mais l’organisation de la production ne lui appartient pas');

  assert.strictEqual((await patch('Charlie', { priority: 3, responsable: 'Julien' })).status, 200,
    'le chef d’atelier attribue et priorise');
  assert.strictEqual((await patch('Charlie', { project_value: 1 })).status, 403,
    '… sans voir ni toucher l’argent');
  assert.strictEqual((await patch('Loïc', { priority: 2, project_value: 700 })).status, 200,
    'la direction peut tout, en un seul geste');

  // UN PATCH MIXTE EST REFUSÉ EN ENTIER. Appliquer les champs permis et taire
  // les autres serait pire : le poste croirait avoir enregistré, et la moitié
  // seulement serait passée.
  const avant = (await call('Loïc', 'GET', `/api/requests/${id}`)).body;
  const mixte = await patch('Julien', { sub_stage: 'prod_uv', project_value: 5 });
  assert.strictEqual(mixte.status, 403, 'un PATCH mi-permis mi-interdit est refusé EN ENTIER');
  const apres = (await call('Loïc', 'GET', `/api/requests/${id}`)).body;
  assert.strictEqual(apres.sub_stage, avant.sub_stage, '… et rien n’est passé à moitié');
  assert.strictEqual(Number(apres.project_value), Number(avant.project_value));

  // =========================================================================
  // 6. LES RÉGLAGES SONT À LA DIRECTION
  // =========================================================================
  for (const qui of ['Julien', 'Mélina', 'Charlie']) {
    assert.strictEqual((await call(qui, 'PUT', '/api/flags', { projets: true })).status, 403,
      `${qui} ne règle pas ce qui vaut pour tous les postes`);
  }
  assert.strictEqual((await call('Loïc', 'PUT', '/api/flags', { projets: false })).status, 200,
    'la direction, si');

  // Retirer une commande du planning relève de la production, pas du travail.
  assert.strictEqual((await call('Julien', 'DELETE', `/api/requests/${id}`)).status, 403);
  assert.strictEqual((await call('Charlie', 'DELETE', `/api/requests/${id}`)).status, 204);
  await call('Charlie', 'POST', `/api/requests/${id}/restaurer`);

  // =========================================================================
  // 7. MON TRAVAIL (§25)
  // =========================================================================
  await call('Charlie', 'PATCH', `/api/requests/${id}`, { responsable: 'Julien', flag: null, flag_reason: null });
  const mt = await call('Julien', 'GET', '/api/mon-travail');
  assert.strictEqual(mt.status, 200);
  assert.strictEqual(mt.body.qui, 'Julien', 'l’écran sait de qui il parle');
  assert.ok(mt.body.aFaire.some((l) => l.id === id), 'la commande qui lui est attribuée est à faire');
  for (const champ of ARGENT) {
    assert.ok(!mt.body.aFaire.some((l) => champ in l), `« ${champ} » n’arrive pas non plus par cet écran`);
  }

  // EN ATTENTE ≠ À FAIRE. Une commande bloquée n'est pas du travail : la mettre
  // dans « à faire » ferait une liste qu'on ne peut pas finir, donc une liste
  // qu'on cesse de regarder.
  await call('Julien', 'PATCH', `/api/requests/${id}`, { flag: 'bloque', flag_reason: 'Attente textile' });
  const mt2 = await call('Julien', 'GET', '/api/mon-travail');
  assert.ok(mt2.body.enAttente.some((l) => l.id === id), 'une commande bloquée passe en attente');
  assert.ok(!mt2.body.aFaire.some((l) => l.id === id), '… et quitte « à faire »');

  // TERMINÉ AUJOURD'HUI se lit dans le JOURNAL, pas dans l'état des lignes :
  // l'état dit où elles sont, pas ce que cette personne a fait.
  assert.ok(
    mt2.body.finiAujourdhui.some((f) => f.id === id),
    'ce que Julien a poussé aujourd’hui figure dans « terminé », signé par le journal',
  );

  // =========================================================================
  // 8. CE QUI SE LIT DANS LE SOURCE
  // =========================================================================
  // Le jeton est SIGNÉ et le cookie est fermé au JavaScript : sans HttpOnly,
  // n'importe quel script de la page peut l'emporter.
  assert.ok(/HttpOnly/.test(SRV) && /SameSite=Lax/.test(SRV), 'le cookie de session est HttpOnly et SameSite');
  assert.ok(/SUR_HTTPS \? \['Secure'\] : \[\]/.test(SRV),
    '`Secure` seulement en production : en local le cookie ne serait jamais posé, et on se reconnecterait en boucle');
  assert.ok(/timingSafeEqual/.test(SRV), 'le sceau se compare à temps constant');
  assert.ok(/sceau\.length !== attendu\.length/.test(SRV),
    'un jeton tronqué doit DÉCONNECTER proprement : `timingSafeEqual` LÈVE sur deux longueurs différentes');
  assert.ok(/scrypt/.test(lire('db.js')), 'le code personnel est haché, jamais rangé en clair');

  // Le middleware de session ne doit PAS passer par `asyncH` : il rend
  // `(req, res) => …` et laisse tomber le `next`. La chaîne ne repartirait
  // jamais — toutes les requêtes resteraient en attente, sans erreur.
  assert.ok(!/app\.use\(asyncH\(/.test(SRV),
    '`asyncH` avale le `next` : jamais en middleware');

  // On relit l'utilisateur en base à chaque requête : un rôle changé, ou un
  // compte désactivé, doit valoir tout de suite — pas dans trente jours.
  assert.ok(/const u = await getUtilisateur\(charge\.u\)/.test(SRV),
    'le jeton n’est pas cru sur parole : le rôle se relit en base');

  // Le défaut de la table champ→capacité est PRUDENT : un champ ajouté demain
  // sans y penser est refusé à l'opérateur, jamais offert.
  assert.ok(/CAPACITE_PAR_CHAMP\[champ\] \|\| 'clients'/.test(SRV),
    'un champ inconnu de la table exige `clients` — le défaut refuse, il n’ouvre pas');

  // Côté écran : c'est un confort, et le fichier doit le dire.
  assert.ok(/puisJe\('reglages'\)/.test(APP) && /puisJe\('clients'\)/.test(APP),
    'la barre ne propose pas de portes fermées');
  assert.ok(/if \(!etat\.comptes \|\| !etat\.capacites\) return true;/.test(SESSION),
    'comptes éteints, `puisJe()` rend vrai partout — l’écran est exactement celui d’avant');
  assert.ok(/session\.js/.test(SW),
    'session.js est importé STATIQUEMENT par app.js : absent de la coquille, le planning ne s’ouvre plus hors ligne');
  assert.ok(/id="viewMonTravail"[^>]*hidden/.test(HTML),
    'l’onglet Mon travail part caché : sans comptes, « mon » ne veut rien dire');

  // DEUX DÉFAUTS TROUVÉS À L'ÉCRAN, pas dans les appels — les deux invisibles
  // pour un test d'API, et les deux gardés ici.
  const CSS = lire('public/styles.css');
  // 1. `hidden` DÉFAIT PAR `display`. L'attribut vaut `display: none` par la
  //    feuille du navigateur ; la règle de classe pose `display: flex`, plus
  //    spécifique, et gagne. Les six onglets réservés restaient donc à l'écran,
  //    cliquables, et menaient à un « Réservé ».
  assert.ok(/\.nav-switch-btn\[hidden\] \{ display: none; \}/.test(CSS),
    'un onglet réservé doit VRAIMENT disparaître : `hidden` seul est écrasé par `display: flex`');
  // 2. `.grid-area` porte `flex: 1`. Vidée de ses deux enfants elle restait une
  //    boîte invisible qui prenait tout l'espace libre — 231 px poussés
  //    au-dessus de « Bonjour Julien », sur l'écran dont le premier mot doit se
  //    lire tout de suite.
  assert.ok(/body\.view-plein \.grid-area,/.test(CSS),
    'hors planning, c’est le CONTENEUR de la grille qui s’efface, pas seulement son contenu');

  console.log('✓ comptes : quatre rôles, le serveur tranche, et l’argent n’arrive pas chez l’opérateur');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
