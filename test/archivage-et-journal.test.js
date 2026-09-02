'use strict';

// ON N'EFFACE PLUS, ET LE JOURNAL DIT QUI.
// ===========================================================================
// Demande du patron (§37 « historique / audit », §38 « suppressions ») :
//
//   « Éviter les suppressions définitives. Utiliser archivage / désactivation /
//     soft delete pour conserver l'historique. »
//   « Chaque action importante doit laisser une trace : utilisateur, date,
//     ancienne valeur, nouvelle valeur. »
//
// Ce que faisait le code avant : `DELETE FROM requests` détruisait la ligne,
// PUIS ses pièces jointes (devis, BAT, facture), PUIS son journal entier. Une
// main qui glisse sur la corbeille, et le dossier n'avait jamais existé —
// impossible de dire ce qui avait été commandé, ni pour combien, ni quand. Et le
// journal, lui, ne portait AUCUN nom : le schéma l'écrivait noir sur blanc.
//
// Ce fichier garde les trois pièces du lot :
//   1. l'archivage (rien ne s'efface, la ligne quitte les écrans, elle revient)
//   2. le « qui » (déclaratif, borné, et il ne casse jamais un appel)
//   3. les interrupteurs de fonctionnalité (§41)

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SRV = lire('server.js');
const DB = lire('db.js');
const SQL = lire('schema.sql');
const APP = lire('public/app.js');
const PONT = lire('public/comptoir/pont.js');
const RESEAU = lire('public/reseau.js');
const CLIENTS = lire('public/clients.js');
const REGLAGES = lire('public/reglages.js');
const TAILLES = lire('public/tailles-logos.js');
const DEVIS_FLASH = lire('public/devis-flash.js');

// Base en mémoire, accès ouvert : mêmes conditions que les autres tests.
delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

(async () => {
  process.env.PORT = '0';
  const app = require('../server');
  // `app` est l'application Express ; le serveur HTTP est accroché dessus, et
  // il n'écoute pas encore quand `require` rend la main.
  const base = await new Promise((resolve) => {
    const check = () => {
      const s = app && app.__server;
      if (s && s.listening) resolve(`http://127.0.0.1:${s.address().port}`);
      else setTimeout(check, 25);
    };
    check();
  });

  const call = async (method, chemin, corps, entetes) => {
    const res = await fetch(base + chemin, {
      method,
      headers: {
        ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(entetes || {}),
      },
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
    const brut = res.status === 204 ? '' : await res.text();
    let body = null;
    try { body = brut ? JSON.parse(brut) : null; } catch (_) { body = brut; }
    return { status: res.status, body };
  };

  // =========================================================================
  // 1. RETIRER UNE COMMANDE N'EFFACE RIEN
  // =========================================================================
  const cree = await call('POST', '/api/requests', {
    stage: 'preparation', sub_stage: 'prepa_bat',
    billing_company: 'Hôtel Archivage', product: 'Polos brodés',
    quantity: 12, project_value: 480,
  });
  assert.strictEqual(cree.status, 201);
  const id = cree.body.id;

  // De quoi remplir un journal, et une pièce jointe à ne pas perdre.
  await call('PATCH', `/api/requests/${id}`, { project_value: 520, quantity: 14 });
  const depot = await fetch(`${base}/api/requests/${id}/pdf/devis?name=devis.pdf`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: Buffer.from('%PDF-1.4 faux devis'),
  });
  assert.ok(depot.ok, 'le devis PDF se dépose');

  const retrait = await call('DELETE', `/api/requests/${id}`);
  assert.strictEqual(retrait.status, 204, 'retirer une commande répond toujours 204');

  // La ligne a quitté TOUS les écrans…
  assert.strictEqual((await call('GET', `/api/requests/${id}`)).status, 404,
    'la commande retirée n’a plus de fiche à ouvrir');
  const liste = await call('GET', '/api/requests?stage=preparation');
  assert.ok(!liste.body.some((l) => l.id === id), '… ni de place dans sa famille');
  const toutes = await call('GET', '/api/requests');
  assert.ok(!toutes.body.some((l) => l.id === id), '… ni dans la liste complète');

  // … les compteurs du rail ne la comptent plus…
  const compteurs = await call('GET', '/api/counts');
  const apresRetrait = compteurs.body.prepa_bat;

  // … la recherche globale ne la trouve plus…
  const cherche = await call('GET', '/api/requests/recherche?q=Archivage');
  assert.ok(!cherche.body.some((l) => l.id === id),
    'la recherche globale ne ressuscite pas une commande retirée');

  // … et le Point du jour l'a lâchée.
  const synth = await call('GET', '/api/requests/synthese');
  assert.ok(!synth.body.ids.includes(id), 'le Point du jour ne la porte plus');

  // MAIS TOUT EST LÀ. C'est l'inverse exact de ce que faisait le code avant.
  const journal = await call('GET', `/api/requests/${id}/journal`);
  assert.strictEqual(journal.status, 200);
  assert.ok(journal.body.some((l) => l.field === 'project_value' && l.value_after === '520'),
    'le prix passé se relit encore APRÈS le retrait');
  assert.ok(journal.body.some((l) => l.field === 'quantity'),
    'la quantité aussi — elle n’était pas suivie du tout avant ce lot');
  const geste = journal.body.find((l) => l.field === 'archive');
  assert.ok(geste && geste.value_after === 'Retirée du planning',
    '… et le retrait lui-même laisse sa ligne');

  const doc = await call('GET', `/api/requests/${id}/pdf/devis`);
  assert.strictEqual(doc.status, 200, 'le devis PDF survit au retrait');

  // =========================================================================
  // 2. LA CORBEILLE, ET LE CHEMIN DE RETOUR
  // =========================================================================
  // Sans retour, l'archivage serait plus doux pour l'historique et tout aussi
  // définitif pour l'employé qui s'est trompé de ligne.
  const corbeille = await call('GET', '/api/requests/corbeille');
  assert.strictEqual(corbeille.status, 200,
    '/corbeille doit être déclarée AVANT /:id, sinon Express la lit comme un identifiant');
  assert.ok(corbeille.body.some((l) => l.id === id), 'la commande retirée attend dans la corbeille');

  assert.strictEqual((await call('POST', `/api/requests/${id}/restaurer`)).status, 204);
  const revenue = await call('GET', `/api/requests/${id}`);
  assert.strictEqual(revenue.status, 200, 'remise au planning, elle se rouvre');
  assert.strictEqual(revenue.body.stage, 'preparation', '… dans SA famille');
  assert.strictEqual(revenue.body.sub_stage, 'prepa_bat', '… et à SA sous-étape');
  assert.strictEqual(Number(revenue.body.project_value), 520, '… avec son prix');

  const compteurs2 = await call('GET', '/api/counts');
  assert.strictEqual(compteurs2.body.prepa_bat, apresRetrait + 1,
    'le compteur du rail la reprend');

  // Restaurer deux fois n'est pas une erreur silencieuse : la seconde ne trouve
  // rien à restaurer et le dit.
  assert.strictEqual((await call('POST', `/api/requests/${id}/restaurer`)).status, 404,
    'restaurer une commande vivante ne fait pas semblant de réussir');

  // =========================================================================
  // 3. LE « QUI »
  // =========================================================================
  await call('PATCH', `/api/requests/${id}`, { priority: 3 }, { 'X-Qui': 'M%C3%A9lina' });
  const signe = await call('GET', `/api/requests/${id}/journal`);
  const ligneSignee = signe.body.find((l) => l.field === 'priority');
  assert.strictEqual(ligneSignee.who, 'Mélina',
    'le prénom arrive ENCODÉ et se range décodé : un « é » ne passe pas nu dans un en-tête HTTP');

  // Un poste qui ne s'est pas nommé écrit quand même — il ne se tait pas.
  await call('PATCH', `/api/requests/${id}`, { priority: 1 });
  const anonyme = await call('GET', `/api/requests/${id}/journal`);
  const derniere = anonyme.body.find((l) => l.field === 'priority' && l.value_after === '1');
  assert.ok(derniere, 'un poste anonyme journalise quand même');
  assert.strictEqual(derniere.who, null, '… sans nom, plutôt que pas de ligne du tout');

  // Un en-tête abîmé (proxy, poste ancien) ne doit pas faire échouer l'écriture
  // qu'on est en train de journaliser : c'est le journal qui est décoratif, pas
  // la modification.
  const casse = await call('PATCH', `/api/requests/${id}`, { priority: 2 }, { 'X-Qui': '%E0%A4%A' });
  assert.strictEqual(casse.status, 200, 'un « qui » illisible ne casse pas la modification');

  // Et il est borné : un en-tête n'est pas un champ de saisie contrôlé.
  await call('PATCH', `/api/requests/${id}`, { priority: 3 }, { 'X-Qui': 'x'.repeat(300) });
  const long = await call('GET', `/api/requests/${id}/journal`);
  const bornee = long.body.find((l) => l.field === 'priority' && l.who && l.who.startsWith('xxx'));
  assert.ok(bornee && bornee.who.length <= 40, 'le « qui » est borné à 40 caractères');

  await call('DELETE', `/api/requests/${id}`);

  // =========================================================================
  // 4. UN CLIENT SE DÉSACTIVE, SES NOTES RESTENT
  // =========================================================================
  const cl = await call('POST', '/api/clients', { entreprise: 'Bar du Port ARCHIVE', nom: 'Test' });
  assert.strictEqual(cl.status, 201);
  const cid = cl.body.id;
  await call('POST', `/api/clients/${cid}/notes`, { kind: 'appel', body: 'Rappelé pour le devis' });

  assert.strictEqual((await call('DELETE', `/api/clients/${cid}`)).status, 204);
  assert.strictEqual((await call('GET', `/api/clients/${cid}`)).status, 404,
    'la fiche désactivée n’est plus consultable');
  const clients = await call('GET', '/api/clients');
  assert.ok(!clients.body.some((c) => c.id === cid), '… ni dans la base clients');

  // Ses notes n'ont pas été détruites : c'est tout l'objet de la désactivation.
  const { pool } = require('../db.js');
  const { rows: notes } = await pool.query('SELECT 1 FROM client_notes WHERE client_id = $1', [cid]);
  assert.strictEqual(notes.length, 1, 'l’historique du client survit à sa désactivation');

  // =========================================================================
  // 5. INTERRUPTEURS DE FONCTIONNALITÉ (§41)
  // =========================================================================
  // IL N'EN RESTE QU'UN, ET C'EST VOULU (01/09). Ils étaient trois ; deux ne
  // commandaient rien — on les cochait dans Réglages et rien ne changeait. Le
  // seul qui décide de quelque chose est `comptes`. Ce qui se vérifie ici est
  // la MÉCANIQUE : la liste est déclarée, tout part éteint, un nom inconnu
  // n'entre pas, et un corps qui n'est pas un objet est refusé.
  const f0 = await call('GET', '/api/flags');
  assert.strictEqual(f0.status, 200);
  assert.ok(f0.body.connus && f0.body.connus.comptes,
    'la liste des interrupteurs est DÉCLARÉE, pas devinée');
  for (const [nom, valeur] of Object.entries(f0.body.flags)) {
    assert.strictEqual(valeur, false, `« ${nom} » part éteint : au pire on n’a pas la nouveauté, jamais un écran cassé`);
  }

  // ON N'ALLUME PAS `comptes` ICI, ET C'EST LE SUJET : il commande vraiment
  // quelque chose. L'allumer exigerait une session de tous les appels qui
  // suivent, y compris celui qui le rééteint. Le test se ferait tomber lui-même.
  // C'est aussi pourquoi la mécanique se vérifiait sur deux interrupteurs
  // inoffensifs — retirés le 01/09 parce qu'ils ne commandaient rien.

  // Un nom inconnu est ignoré, pas rangé : sinon une faute de frappe crée un
  // drapeau fantôme que personne ne lit et qui ne s'éteint jamais. C'est aussi
  // ce qui fait qu'un interrupteur RETIRÉ du code disparaît de la réponse même
  // s'il traîne encore en base — le cas de `projets` et `marges` depuis le 01/09.
  const f3 = await call('PUT', '/api/flags', { projets: true, comptess: true });
  assert.strictEqual(f3.body.flags.projets, undefined, 'un interrupteur retiré ne revient pas');
  assert.strictEqual(f3.body.flags.comptess, undefined, 'une faute de frappe n’entre pas en base');
  assert.strictEqual(f3.body.flags.comptes, false, '… et rien d’autre n’a bougé au passage');
  assert.strictEqual((await call('PUT', '/api/flags', [1, 2])).status, 400, 'un tableau n’est pas un objet');

  // FUSION, PAS REMPLACEMENT — deux postes ouverts sur les réglages ne doivent
  // pas s'effacer l'un l'autre. Avec un seul interrupteur déclaré, ça ne se
  // montre plus par un aller-retour : ça se lit dans `setFlags`, qui repart de
  // l'état COURANT et n'écrase que les noms reçus.
  const setFlags = DB.match(/async function setFlags\(patch\) \{[\s\S]*?\n\}/);
  assert.ok(setFlags, 'setFlags se lit dans db.js');
  assert.match(setFlags[0], /\{ \.\.\.\(await getFlags\(\)\) \}/,
    'setFlags repart de ce qui est en place : un envoi partiel ne remet rien à zéro');
  assert.match(setFlags[0], /for \(const s of FLAGS_SLUGS\) if \(s in src\)/,
    '… et n’écrit que les interrupteurs CONNUS et effectivement reçus');

  // =========================================================================
  // 6. LE FILTRE EST POSÉ PARTOUT — LU DANS LE SOURCE
  // =========================================================================
  // Une lecture qui l'oublie ne casse RIEN : elle ressuscite une ligne archivée
  // au milieu du planning, sans erreur ni message. C'est exactement le genre de
  // trou qu'aucun appel de test ne trouve par hasard.
  const sansCommentaire = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '');
  const SRV_NU = sansCommentaire(SRV);

  // Toute lecture d'écran passe par SELECT/SELECT_COMPLET : chacune porte le
  // filtre, sauf celle de la corbeille (c'est son objet).
  for (const m of SRV_NU.matchAll(/\$\{SELECT(?:_COMPLET)?\}([^`]*)`/g)) {
    const suite = m[1];
    assert.ok(
      /VIVANTES|deleted_at IS NOT NULL/.test(suite),
      `une lecture d’écran oublie le filtre d’archivage : « ${suite.trim().slice(0, 70)} »`,
    );
  }

  // Les deux exceptions sont VOULUES et doivent le rester : sans elles, un
  // numéro de ticket pourrait se réutiliser et un dossier déjà saisi se recréer.
  for (const requete of ["WHERE fiche->>'ref' = $1", "WHERE fiche->>'empreinte' = $1"]) {
    assert.ok(SRV_NU.includes(requete),
      `la recherche par ${requete.includes('ref') ? 'référence' : 'empreinte'} doit voir l’archive`);
  }
  assert.ok(!/cle = \$1 LIMIT 1[^;]*deleted_at/.test(SRV_NU),
    'le doublon client se cherche dans TOUTE la table : `idx_clients_cle` est UNIQUE, '
    + 'une fiche désactivée occupe toujours sa clé');

  // =========================================================================
  // 7. LES GARDE-FOUS DE STRUCTURE
  // =========================================================================
  // La colonne existe dans le schéma ET dans la migration : une base déjà en
  // service ne rejoue pas `schema.sql`, elle ne reçoit que la migration.
  assert.ok(/deleted_at\s+timestamptz/.test(SQL), 'la colonne est au schéma');
  assert.ok(/ALTER TABLE \$\{table\} ADD COLUMN IF NOT EXISTS deleted_at timestamptz/.test(DB),
    '… et ajoutée aux bases déjà en service');
  assert.ok(/ALTER TABLE request_events ADD COLUMN IF NOT EXISTS who text/.test(DB),
    'le « qui » aussi');
  // Index PARTIEL : l'archive n'y entre jamais, il reste donc petit à vie.
  assert.ok(/idx_requests_vivantes[\s\S]{0,140}WHERE deleted_at IS NULL/.test(DB),
    'le filtre porte sur toutes les lectures : il lui faut son index, et partiel');

  // Le poste signe, des DEUX côtés, et toujours encodé.
  // CÔTÉ CRM, LA SIGNATURE EST DANS `reseau.js` DEPUIS LE 01/09 : les cinq
  // écrans avaient chacun leur copie de `api()`, et celle du devis flash ne
  // signait rien — ses écritures arrivaient au journal sans nom. Une seule
  // fonction, donc une seule signature, donc plus d'écran qui l'oublie.
  assert.ok(/opts\.headers\['X-Qui'\] = encodeURIComponent\(qui\)/.test(RESEAU),
    'le CRM signe ses appels — encodés, sinon `fetch` lève sur un prénom hors latin-1');
  assert.ok(!/async function api\(/.test(APP),
    '… et le planning ne se refait pas la sienne à côté');
  for (const [nom, src] of [['clients', CLIENTS], ['réglages', REGLAGES],
    ['tailles de logos', TAILLES], ['devis flash', DEVIS_FLASH]]) {
    assert.ok(/import \{[^}]*\bapi\b[^}]*\} from '\.\/reseau\.js'/.test(src),
      `l’écran « ${nom} » prend l’appel commun, il n’en réécrit pas un`);
  }
  assert.ok(/'X-Qui': encodeURIComponent\(nom\)/.test(PONT),
    'le comptoir aussi : c’est là que naissent les dossiers');

  // La note de l'Historique vivait dans le TIROIR, retiré le 29/08 : la fiche
  // atelier ne montre pas le journal (voir le compte rendu de ce jour-là — c'est
  // l'une des quatre choses qu'elle ne reprend pas). Ce qui compte reste vrai et
  // se contrôle côté serveur, plus haut : le journal enregistre le « qui ».
  assert.ok(!/enregistre ce qui a changé, pas qui l’a fait/.test(APP),
    'plus une ligne de l’application n’affirme le contraire de ce que fait le code');

  console.log('✓ archivage : rien ne s’efface, tout revient, et le journal dit qui');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
