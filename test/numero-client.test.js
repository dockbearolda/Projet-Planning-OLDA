'use strict';

// LE NUMÉRO DU CLIENT — « CLI-PRO-0007 » / « CLI-PERSO-0007 ».
// ===========================================================================
// La table `clients` n'avait qu'un `id` UUID : rien qu'on puisse dicter au
// téléphone, rien qu'on retrouve sur un papier. Le numéro est un repère
// LISIBLE, comme dans le classeur du patron.
//
// Quatre choses tenues ici, et une cinquième qu'on ne prétend PAS tenir :
//
//   1. il est ATTRIBUÉ À LA CRÉATION — par les DEUX portes : la fiche du CRM
//      (POST /api/clients) et la prise de commande, qui crée le client toute
//      seule quand il est nouveau (étape Client des deux parcours du comptoir) ;
//   2. il est RATTRAPÉ sur tout ce qui était déjà en base, dans l'ordre de
//      création — y compris les 78 clients pros de l'import ;
//   3. il n'est JAMAIS MODIFIABLE À LA MAIN : il n'est pas dans CLIENT_FIELDS,
//      donc ni POST ni PATCH ne l'atteignent, même en l'envoyant exprès ;
//   4. il est UNIQUE EN BASE. C'est le seul point qui protège vraiment deux
//      postes qui créent une fiche dans la même fraction de seconde : la base
//      refuse le doublon, quoi que fasse le code applicatif.
//
// CE QU'ON NE TESTE PAS, ET POURQUOI : la course elle-même. La base locale est
// pg-mem, qui NE VERROUILLE RIEN. Deux écritures simultanées y passent au vert
// sans rien prouver de PostgreSQL. Un test de concurrence ici serait un test
// vert et faux. On teste donc la CONTRAINTE (§4), qui est ce qui tient debout
// en production, pas le scénario qui la solliciterait.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SRV = lire('server.js');
const DB = lire('db.js');
const SQL = lire('schema.sql');
const CLIENTS_JS = lire('public/clients.js');
const CLIENTS_CSS = lire('public/clients.css');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

(async () => {
  process.env.PORT = '0';
  const app = require('../server');
  const { pool } = require('../db');
  const base = await new Promise((resolve) => {
    const check = () => {
      const s = app && app.__server;
      if (s && s.listening) resolve(`http://127.0.0.1:${s.address().port}`);
      else setTimeout(check, 25);
    };
    check();
  });

  const j = async (method, chemin, body) => {
    const res = await fetch(`${base}${chemin}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  const CODE = /^CLI-(PRO|PERSO)-\d{4}$/;

  // -------------------------------------------------------------------------
  // 1. LE RATTRAPAGE : personne ne reste sans numéro.
  // Les 78 clients pros de l'import sont entrés SANS code (seedClients ne
  // connaît que les colonnes du fichier). `rattraperCodesClients` passe après
  // l'import, dans l'ordre de création, et n'en oublie aucun.
  // -------------------------------------------------------------------------
  const liste = await j('GET', '/api/clients');
  assert.strictEqual(liste.status, 200);
  assert.ok(liste.body.length >= 70, `base pré-remplie attendue, reçu ${liste.body.length}`);
  const sansCode = liste.body.filter((c) => !c.code);
  assert.strictEqual(sansCode.length, 0,
    `tout client en base porte un numéro (${sansCode.length} sans)`);
  for (const c of liste.body) {
    assert.match(c.code, CODE, `numéro lisible attendu sur « ${c.entreprise} », reçu « ${c.code} »`);
  }
  // …et deux fiches ne partagent jamais le même.
  const codes = liste.body.map((c) => c.code);
  assert.strictEqual(new Set(codes).size, codes.length, 'aucun numéro en double après rattrapage');

  // Dans l'ORDRE DE CRÉATION : la fiche la plus ancienne porte le plus petit
  // rang. C'est ce qui rend la série lisible — un numéro qui monte dit l'âge du
  // client, un numéro tiré au hasard ne dit rien.
  const pros = liste.body
    .filter((c) => c.code.startsWith('CLI-PRO-'))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  for (let i = 1; i < pros.length; i += 1) {
    const av = Number.parseInt(pros[i - 1].code.slice('CLI-PRO-'.length), 10);
    const ap = Number.parseInt(pros[i].code.slice('CLI-PRO-'.length), 10);
    if (pros[i - 1].created_at === pros[i].created_at) continue;
    assert.ok(ap > av, `numéros dans l'ordre de création (${pros[i - 1].code} → ${pros[i].code})`);
  }

  // -------------------------------------------------------------------------
  // 2. À LA CRÉATION, PORTE 1 : la fiche du CRM.
  // -------------------------------------------------------------------------
  const cree = await j('POST', '/api/clients', { entreprise: 'Numérotée SARL', client_type: 'pro' });
  assert.strictEqual(cree.status, 201, JSON.stringify(cree.body));
  assert.match(cree.body.code, /^CLI-PRO-\d{4}$/, 'un pro reçoit son numéro à la création');

  const creePerso = await j('POST', '/api/clients', { entreprise: 'Numéroté Particulier', client_type: 'perso' });
  assert.strictEqual(creePerso.status, 201);
  assert.match(creePerso.body.code, /^CLI-PERSO-\d{4}$/, 'un particulier a sa propre série');

  // -------------------------------------------------------------------------
  // 3. À LA CRÉATION, PORTE 2 : le comptoir crée le client TOUT SEUL.
  // C'est le cas majoritaire — la vendeuse ne passe pas par Base clients avant
  // de prendre une commande. Une fiche née là n'avait aucun numéro : le fichier
  // du patron portait deux sortes de clients.
  // -------------------------------------------------------------------------
  const societe = 'Comptoir Numéro ' + Date.now();
  // LE DOSSIER SE PREND AU COMPTOIR (01/09) : `POST /api/projets`, la route
  // sans écran, est partie. La règle vérifiée est la même — un client né d'une
  // prise de commande reçoit son numéro comme les autres.
  const { creerDossier } = require('./dossier');
  await creerDossier(j, { demande: true, societe, contact: 'Mélina', quantite: 1, montant: null });
  const neAuComptoir = (await j('GET', '/api/clients')).body.find((c) => c.entreprise === societe);
  assert.ok(neAuComptoir, 'la prise de commande a créé la fiche client');
  assert.match(neAuComptoir.code, /^CLI-PRO-\d{4}$/,
    'un client né d\'une prise de commande porte un numéro, comme les autres');

  // Un particulier pris au comptoir suit sa propre série.
  const perso = 'Comptoir Perso ' + Date.now();
  await creerDossier(j, { demande: true, perso: true, societe: perso, quantite: 1, montant: null });
  const persoComptoir = (await j('GET', '/api/clients')).body.find((c) => c.entreprise === perso);
  assert.ok(persoComptoir, 'la fiche du particulier est créée');
  assert.match(persoComptoir.code, /^CLI-PERSO-\d{4}$/, 'série PERSO au comptoir aussi');

  // -------------------------------------------------------------------------
  // 4. JAMAIS MODIFIABLE À LA MAIN. Ni en le posant à la création, ni en le
  // corrigeant ensuite : le champ n'existe pas pour l'écriture.
  // -------------------------------------------------------------------------
  const impose = await j('POST', '/api/clients', {
    entreprise: 'Numéro Imposé', client_type: 'pro', code: 'CLI-PRO-9999',
  });
  assert.strictEqual(impose.status, 201, JSON.stringify(impose.body));
  assert.notStrictEqual(impose.body.code, 'CLI-PRO-9999',
    'le numéro envoyé par le poste est ignoré : c\'est le serveur qui le tire');
  assert.match(impose.body.code, /^CLI-PRO-\d{4}$/);

  const avant = cree.body.code;
  const patch = await j('PATCH', `/api/clients/${cree.body.id}`, { code: 'CLI-PRO-0001', zone: 'Marigot' });
  assert.strictEqual(patch.status, 200, JSON.stringify(patch.body));
  assert.strictEqual(patch.body.code, avant, 'le numéro ne se corrige pas à la main');
  assert.strictEqual(patch.body.zone, 'Marigot', '…et le reste de la fiche s\'édite normalement');

  // La liste des champs écrivables ne le contient pas : c'est là que ça se joue,
  // pas dans un `delete body.code` posé dans une route et oublié dans l'autre.
  assert.ok(/const CLIENT_MAX = \{[\s\S]*?\n\};/.test(SRV), 'CLIENT_MAX trouvé dans server.js');
  const champsEcrivables = SRV.match(/const CLIENT_MAX = \{[\s\S]*?\n\};/)[0];
  assert.ok(!/\bcode\s*:/.test(champsEcrivables),
    '`code` ne doit jamais entrer dans CLIENT_MAX (il deviendrait modifiable)');

  // -------------------------------------------------------------------------
  // 5. L'UNICITÉ EST EN BASE. Le seul garde-fou qui tienne en production.
  // On l'éprouve là où elle vit : un INSERT direct, qui contourne tout le code
  // applicatif — exactement ce que ferait un import, une restauration, ou un
  // compteur `app_meta` recopié d'un autre environnement.
  // -------------------------------------------------------------------------
  const codePris = cree.body.code;
  // TÉMOIN d'abord : la même insertion, au numéro près, doit PASSER. Sans lui,
  // un refus venu d'ailleurs (la clé de rapprochement, une colonne obligatoire)
  // se ferait passer pour la preuve qu'on cherche.
  await pool.query(
    'INSERT INTO clients (entreprise, cle, code) VALUES ($1, $2, $3)',
    ['Temoin Numero Libre', 'temoin numero libre', 'CLI-PRO-9998'],
  );
  let refus = null;
  try {
    await pool.query(
      'INSERT INTO clients (entreprise, cle, code) VALUES ($1, $2, $3)',
      ['Doublon De Numéro', 'doublon de numero', codePris],
    );
  } catch (err) {
    refus = err;
  }
  assert.ok(refus, `la base doit REFUSER un second client portant ${codePris}`);
  assert.strictEqual(refus.code, '23505', `violation d'unicité attendue, reçu ${refus.code}`);

  // Et rien n'est passé : la fiche en double n'existe pas.
  const { rows: combien } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM clients WHERE code = $1', [codePris],
  );
  assert.strictEqual(combien[0].n, 1, 'un numéro, une fiche');

  // -------------------------------------------------------------------------
  // 5 bis. UNE BASE QUI PORTE DÉJÀ DES DOUBLONS. C'est le chemin qui compte
  // pour la production : elle est très en retard, et personne ne sait ce que
  // 184 dossiers de fiches recopiées à la main contiennent. La migration ne
  // doit RIEN supprimer, RIEN renuméroter, et surtout pas empêcher le service
  // de démarrer — un comptoir fermé pour une migration de confort, jamais.
  // Elle doit aussi rester REJOUABLE : une fois les fiches corrigées, l'unicité
  // se pose au démarrage suivant.
  // -------------------------------------------------------------------------
  const { poserUniciteCodeClient } = require('../db');
  await pool.query('DROP INDEX IF EXISTS idx_clients_code');
  await pool.query(
    'INSERT INTO clients (entreprise, cle, code) VALUES ($1, $2, $3)',
    ['Doublon Toléré', 'doublon tolere', codePris],
  );
  const avantMigration = (await pool.query('SELECT COUNT(*)::int AS n FROM clients')).rows[0].n;
  await poserUniciteCodeClient();   // ne doit pas lever
  const apresMigration = (await pool.query('SELECT COUNT(*)::int AS n FROM clients')).rows[0].n;
  assert.strictEqual(apresMigration, avantMigration,
    'aucune fiche supprimée : ce sont des CLIENTS, pas au démarrage du service de trancher');
  const { rows: encore } = await pool.query(
    'SELECT code FROM clients WHERE code = $1', [codePris],
  );
  assert.strictEqual(encore.length, 2, 'les deux fiches en double sont toujours là, telles quelles');

  // La migration reste REJOUABLE : au démarrage suivant, une fois les fiches
  // corrigées, l'unicité se pose. Deux choses le permettent, et elles se lisent
  // dans la source — pas ici :
  //   - le repli porte un AUTRE NOM que l'index unique (`IF NOT EXISTS`
  //     s'accorde sur le nom : un index simple appelé `idx_clients_code` ferait
  //     passer le `CREATE UNIQUE` suivant pour déjà fait, à jamais) ;
  //   - ce repli est EFFACÉ avant chaque nouvelle tentative, sinon un index
  //     simple sur la même colonne suffit à faire sauter la création.
  // CE SCÉNARIO NE SE JOUE PAS ICI, et c'est assumé : après un `CREATE UNIQUE`
  // refusé, pg-mem garde le nom à moitié enregistré — la tentative suivante
  // n'aboutit plus, et le `DROP INDEX IF EXISTS` lève au lieu de ne rien faire.
  // PostgreSQL, lui, annule la création ratée entièrement. Éprouver ça en pg-mem
  // ne dirait rien de la production : encore une fois, ce n'est pas la base
  // locale qui protège, c'est la contrainte réelle.
  const repli = DB.match(/idx_clients_code_repli/g) || [];
  assert.ok(repli.length >= 3,
    'le repli a son propre nom : effacé avant chaque tentative, posé, et documenté au down');
  const migration = DB.match(/async function poserUniciteCodeClient\(\)[\s\S]*?\n\}/)[0];
  const posDrop = migration.indexOf('DROP INDEX IF EXISTS idx_clients_code_repli');
  const posUnique = migration.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_code');
  assert.ok(posDrop >= 0 && posDrop < posUnique,
    'le repli est effacé AVANT la tentative d\'unicité, pas après');
  assert.ok(!/DELETE FROM clients|UPDATE clients SET code/.test(migration),
    'la migration ne supprime ni ne renumérote aucune fiche : ce sont des clients');

  // La contrainte est POSÉE AU DÉMARRAGE, dans `init()`, avec sa PROPRE garde
  // app_meta — pas une garde partagée : deux incidents réels sont venus de là.
  assert.ok(/await migrerColonneCodeClient\(\);/.test(DB),
    'la colonne du numéro a sa migration, jouée dans init()');
  assert.ok(/await poserUniciteCodeClient\(\);/.test(DB),
    'l\'unicité est posée dans init()');
  assert.ok(/clients_code_colonne_v1/.test(DB),
    'garde app_meta PROPRE à cette migration');
  const gardesAilleurs = (DB.match(/clients_code_colonne_v1/g) || []).length;
  assert.ok(gardesAilleurs >= 2, 'la garde est lue puis posée par la seule migration du numéro');
  // Le DOWN est écrit noir sur blanc, dans les deux fichiers.
  assert.ok(/DROP INDEX IF EXISTS idx_clients_code;/.test(DB) && /ALTER TABLE clients DROP COLUMN IF EXISTS code;/.test(DB),
    'la migration porte son down (index + colonne)');
  assert.ok(/DELETE FROM app_meta WHERE key = 'clients_code_colonne_v1';/.test(DB),
    'le down retire aussi la garde, sinon la migration ne se rejoue jamais');
  assert.ok(/^\s*code\s+text,/m.test(SQL), 'la colonne est déclarée dans schema.sql');

  // Le compteur du numéro est le MÊME atome que celui du numéro du jour
  // (`INSERT … ON CONFLICT DO UPDATE`, une seule requête) : on ne réinvente pas
  // un mécanisme qui marche, et surtout pas en lecture-puis-écriture.
  const compteur = DB.match(/async function nextClientCode[\s\S]*?\n\}/)[0];
  assert.ok(/ON CONFLICT \(key\) DO UPDATE SET value = \(\(app_meta\.value\)::int \+ 1\)::text/.test(compteur),
    'le compteur s\'incrémente en UNE requête, comme celui du numéro du jour');
  assert.ok(!/SELECT[\s\S]*FROM clients/.test(compteur),
    'le numéro n\'est JAMAIS dérivé des lignes en place : un numéro pris ne se réutilise pas');

  // -------------------------------------------------------------------------
  // 6. IL S'AFFICHE : sur la fiche, et dans la liste À CÔTÉ DU NOM.
  // -------------------------------------------------------------------------
  assert.ok(/fields\.append\(fieldRow\(codeField, c\.code\)\)/.test(CLIENTS_JS),
    'la fiche client affiche le numéro');
  assert.ok(/field\.key === 'code'\) \{ input\.readOnly = true;/.test(CLIENTS_JS),
    'et il y est en lecture seule — l\'écran dit la même chose que le serveur');
  const carte = CLIENTS_JS.match(/function card\(c\) \{[\s\S]*?\n\}/)[0];
  assert.ok(/cl-card__code/.test(carte), 'la carte de la liste porte le numéro');
  const posNom = carte.indexOf('cl-card__name');
  const posCode = carte.indexOf('cl-card__code');
  const posNature = carte.indexOf('cl-nature');
  assert.ok(posNom < posCode && posCode < posNature, 'le numéro est À CÔTÉ DU NOM, dans la rangée du nom');
  // La couleur ne dit qu'un état : un numéro n'en est pas un. Il prend l'encre
  // secondaire de la carte, et la seule taille de texte qu'elle connaît.
  const regleCode = CLIENTS_CSS.match(/\.cl-card__code \{[\s\S]*?\n\}/)[0];
  assert.ok(/font-size: var\(--taille-texte\);/.test(regleCode), 'la carte n\'a qu\'une taille de texte');
  assert.ok(/color: var\(--text-2\);/.test(regleCode), 'encre secondaire, comme le sous-titre de la même carte');
  assert.ok(!/#[0-9a-fA-F]{3,8}/.test(regleCode), 'aucune couleur en dur : le numéro ne dit pas un état');

  console.log('✓ numéro client : attribué aux deux portes, rattrapé, jamais modifiable, UNIQUE en base');
  app.__server.close();
  await pool.end();
})().catch((err) => { console.error(err); process.exit(1); });
