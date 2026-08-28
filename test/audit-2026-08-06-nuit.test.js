'use strict';

// Audit du 06/08/2026, nuit — ce qui se perd À DEUX POSTES, et ce qui reste
// suspendu quand le réseau décroche sans tomber.
//
//   1. DEUX CORRECTIONS DE FICHE EN MÊME TEMPS : UNE DISPARAÎT. La fiche est un
//      seul `jsonb`, relu puis réécrit EN ENTIER à chaque correction. Hors
//      transaction, l'atelier qui rectifie l'heure de retrait et le comptoir qui
//      rectifie une quantité partent tous deux de la fiche d'AVANT : le dernier
//      enregistré remet l'autre correction à sa valeur initiale. Aucun message,
//      aucune ligne au journal — la correction avait bien été « enregistrée ».
//   2. RANGER UNE ÉTAPE DÉ-RANGEAIT CELLE DU VOISIN. Chaque poste publiait la
//      LISTE ENTIÈRE des étapes rangées à la main, telle qu'il la connaissait.
//      Deux vendeuses qui rangent deux étapes dans la même minute : la seconde
//      efface la décision de la première, dont l'étape retombe en tri
//      automatique sous ses yeux — alors que ses `position` sont bien en base.
//   3. LE POINT DU JOUR SE TAISAIT SUR UNE BORNE ILLISIBLE. `?depuis=` part
//      droit dans une comparaison de timestamp : mal formée, Postgres lève et
//      l'écran reçoit « Erreur serveur ». Ne plus savoir depuis quand n'est pas
//      une panne : c'est une raison de tout renvoyer, pas de ne rien renvoyer.
//   4. AUCUNE REQUÊTE N'AVAIT DE FIN. `fetch` n'abandonne pas : sur un wifi qui
//      décroche à mi-chemin, rien ne revient et rien n'échoue. Les écrans se
//      protègent du double envoi avec un drapeau « en cours » baissé au retour —
//      une requête sans retour, c'est un bouton mort. Le Point du jour fait
//      pareil (`refreshing`) : un seul appel suspendu et il ne se rafraîchit
//      plus de la journée, réseau revenu ou non.
//   5. LE TEMPS RÉEL NE REVENAIT PAS APRÈS UN REFUS DU SERVEUR. Sur coupure
//      réseau, le navigateur rouvre le flux tout seul. Mais quand le serveur
//      répond AUTRE CHOSE qu'un flux — 503 du plafond de connexions, 401 quand
//      le mot de passe n'est plus envoyé, page d'erreur d'un proxy — il passe en
//      CLOSED et renonce définitivement. Personne ne rouvrait : la tablette
//      (qui ne se recharge jamais) finissait sur le filet de sécurité à 8 s.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

const racine = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8');

// Découpe une fonction dans un source : de sa signature jusqu'à l'accolade
// fermante posée à la MÊME indentation.
function bloc(src, signature) {
  const from = src.indexOf(signature);
  assert.ok(from >= 0, `bloc introuvable : ${signature}`);
  const indent = signature.match(/^\s*/)[0];
  const to = src.indexOf(`\n${indent}}`, from);
  assert.ok(to > from, `fin de bloc introuvable : ${signature}`);
  return src.slice(from, to + indent.length + 2);
}

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
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };

  // =========================================================================
  // 1. La fiche se corrige sous verrou — deux postes, deux corrections gardées
  // =========================================================================
  // CE QUI SE VÉRIFIE ICI ET CE QUI NE PEUT PAS L'ÊTRE. La base locale est
  // pg-mem : `pool.connect()` y rend toujours le MÊME client et `FOR UPDATE`
  // n'y verrouille rien. Une course écrite ici ne prouverait donc rien — elle
  // passerait avec ou sans le correctif. On vérifie donc deux choses distinctes :
  // que le verrou est bien posé (lecture du source), et que la correction se
  // comporte toujours correctement de bout en bout (appels réels).
  const SRV = lire('server.js');
  // La signature s'est enrichie d'une garde de permission : on repère la route
  // par son CHEMIN, pas par la ligne entière — sinon toute permission ajoutée
  // demain fait échouer une garde qui ne parle pas de permissions.
  const handlerFiche = bloc(SRV, "app.patch('/api/requests/:id/fiche',");
  assert.match(
    handlerFiche, /BEGIN/,
    'la correction de fiche s’ouvre dans une transaction',
  );
  // Ce qui compte, c'est que la ligne soit PRISE — pas la lettre exacte de la
  // requête. La clause s'est enrichie deux fois depuis (le filtre d'archivage,
  // puis le prix relu pour savoir s'il a été posé à la main) : on garde donc le
  // verrou sous surveillance, sans figer les colonnes lues.
  assert.match(
    handlerFiche, /SELECT fiche[^`']*FROM requests WHERE id = \$1[^`']*FOR UPDATE/,
    'la ligne est PRISE pendant qu’on la relit : sans ça, deux corrections '
    + 'simultanées partent de la même fiche d’avant et la seconde efface la première',
  );
  assert.match(handlerFiche, /COMMIT/, 'et la transaction se referme');
  assert.match(
    handlerFiche, /ROLLBACK/,
    'toute sortie anticipée (404, saisie refusée, panne) relâche la ligne — '
    + 'sinon un poste garderait le verrou et bloquerait tous les autres',
  );
  // Le verrou ne doit pas être pris pour rien : une saisie invalide se refuse
  // AVANT, sans faire patienter le poste d'à côté.
  assert.ok(
    handlerFiche.indexOf('heure souhaitée invalide') < handlerFiche.indexOf('BEGIN'),
    'une heure mal formée est refusée avant de prendre le verrou',
  );

  const projet = await call('POST', '/api/projets', {
    kind: 'commande',
    delai: 'j5',
    client: { type: 'pro', societe: 'Audit Verrou Fiche' },
    lignes: [{
      type: 'textile', quantite: 2, designation: 'Polo', prixUnitaireTtc: 25,
      faces: { avant: { emplacement: 'coeur', technique: 'dtf' } },
      tailles: { M: 2 },
    }],
    paiement: { mode: 'cb', paye: true },
  });
  assert.strictEqual(projet.status, 201, JSON.stringify(projet.body));
  const idProjet = projet.body.id;

  // Deux corrections qui se suivent, sur des champs différents : la seconde
  // part de la fiche DÉJÀ corrigée, donc les deux tiennent.
  assert.strictEqual(
    (await call('PATCH', `/api/requests/${idProjet}/fiche`, { heureSouhaitee: '15:30' })).status, 200,
  );
  assert.strictEqual(
    (await call('PATCH', `/api/requests/${idProjet}/fiche`, { production: 'dtf' })).status, 200,
  );
  const corrigee = (await call('GET', `/api/requests/${idProjet}`)).body;
  assert.strictEqual(corrigee.fiche.heureSouhaitee, '15:30', 'l’heure de retrait est enregistrée');
  assert.strictEqual(corrigee.fiche.production, 'dtf', 'et le secteur de production aussi');

  // Le journal a bien vu passer la correction d'heure.
  const journal = (await call('GET', `/api/requests/${idProjet}/journal`)).body;
  assert.ok(
    journal.some((e) => e.field === 'fiche_heure' && e.value_after === '15:30'),
    'la correction laisse sa trace dans l’Historique',
  );

  // Une heure mal formée reste refusée (et n'efface rien).
  const mauvaise = await call('PATCH', `/api/requests/${idProjet}/fiche`, { heureSouhaitee: '14h00' });
  assert.strictEqual(mauvaise.status, 400, 'une heure mal formée est refusée');
  assert.strictEqual(
    (await call('GET', `/api/requests/${idProjet}`)).body.fiche.heureSouhaitee, '15:30',
    'et surtout : elle n’efface pas l’heure déjà enregistrée',
  );

  // Une commande introuvable rend 404 sans laisser la transaction ouverte : la
  // requête suivante doit passer normalement.
  const absente = await call('PATCH', '/api/requests/00000000-0000-0000-0000-000000000000/fiche', { production: 'x' });
  assert.strictEqual(absente.status, 404, 'commande introuvable → 404');
  assert.strictEqual(
    (await call('PATCH', `/api/requests/${idProjet}/fiche`, { production: 'uv' })).status, 200,
    'et le serveur répond toujours ensuite — la ligne n’est pas restée verrouillée',
  );

  // =========================================================================
  // 2. Ranger une étape ne dé-range plus celle du voisin
  // =========================================================================
  // Poste A range « Production », poste B range « Demande & chiffrage ».
  // Chacun n'envoie QUE son étape ; le serveur fusionne.
  await call('PUT', '/api/ordre-manuel', []); // on part d'une ardoise propre
  const posteA = await call('PUT', '/api/ordre-manuel', { etape: 'production', range: true });
  assert.strictEqual(posteA.status, 200, JSON.stringify(posteA.body));
  const posteB = await call('PUT', '/api/ordre-manuel', { etape: 'demande_chiffrage', range: true });
  assert.strictEqual(posteB.status, 200, JSON.stringify(posteB.body));

  const ranges = (await call('GET', '/api/ordre-manuel')).body;
  assert.deepStrictEqual(
    [...ranges].sort(), ['demande_chiffrage', 'production'],
    'LES DEUX étapes restent rangées à la main — c’est tout l’objet du correctif',
  );
  assert.deepStrictEqual(
    [...posteB.body].sort(), ['demande_chiffrage', 'production'],
    'et le serveur rend la liste fusionnée, que le poste adopte au lieu de garder la sienne',
  );

  // Le retour au tri automatique ne retire QUE l'étape nommée.
  const retire = await call('PUT', '/api/ordre-manuel', { etape: 'production', range: false });
  assert.deepStrictEqual(
    retire.body, ['demande_chiffrage'],
    'dé-ranger « Production » laisse « Demande & chiffrage » rangée',
  );

  // Ce que le serveur refuse : une étape inconnue, un « range » qui n'est pas
  // un booléen (sans quoi `{ etape, range: undefined }` dé-rangerait en silence).
  assert.strictEqual(
    (await call('PUT', '/api/ordre-manuel', { etape: 'nawak', range: true })).status, 400,
    'étape inconnue refusée',
  );
  assert.strictEqual(
    (await call('PUT', '/api/ordre-manuel', { etape: 'production' })).status, 400,
    '« range » manquant refusé : un booléen absent vaut « faux » et dé-rangerait sans le dire',
  );

  // L'ancienne forme (liste entière) reste acceptée : le fichier JS garde son
  // nom d'un déploiement à l'autre, un onglet resté ouvert peut encore l'envoyer.
  const ancienne = await call('PUT', '/api/ordre-manuel', ['production']);
  assert.strictEqual(ancienne.status, 200);
  assert.deepStrictEqual(ancienne.body, ['production'], 'l’ancienne forme remplace toujours tout');

  // Côté écran : on n'envoie plus jamais la liste entière.
  const APP = lire('public/app.js');
  const save = bloc(APP, 'function saveOrdreManuel(etape, range) {');
  assert.match(
    save, /'\/api\/ordre-manuel', \{ etape, range \}/,
    'l’écran n’envoie que l’étape qu’il vient de ranger',
  );
  assert.doesNotMatch(
    save, /\[\.\.\.ordreManuel\]\s*\)/,
    'et surtout plus la liste entière : c’est elle qui écrasait la décision du voisin',
  );
  assert.match(
    save, /ordreManuel = new Set\(/,
    'il adopte la liste fusionnée que le serveur lui rend',
  );

  // =========================================================================
  // 3. Une borne illisible ne fait plus taire le Point du jour
  // =========================================================================
  const complete = (await call('GET', '/api/requests/synthese')).body;
  const cassee = await call('GET', '/api/requests/synthese?depuis=nimportequoi');
  assert.strictEqual(
    cassee.status, 200,
    'une borne illisible ne rend plus « Erreur serveur » — l’écran ne se met pas à jour du tout dans ce cas',
  );
  assert.strictEqual(
    cassee.body.ids.length, complete.body ? complete.body.ids.length : complete.ids.length,
    'elle est traitée comme un premier chargement : tout repart',
  );
  assert.strictEqual(
    cassee.body.lignes.length, complete.lignes.length,
    'toutes les lignes, pas seulement les identifiants',
  );
  // La forme normale, elle, reste incrémentale.
  const bonneBorne = await call('GET', `/api/requests/synthese?depuis=${encodeURIComponent(new Date(Date.now() + 60000).toISOString())}`);
  assert.strictEqual(bonneBorne.status, 200);
  assert.strictEqual(
    bonneBorne.body.lignes.length, 0,
    'une borne dans le futur ne rend rien : la synthèse reste bien incrémentale',
  );

  // =========================================================================
  // 4. Toute requête a une fin
  // =========================================================================
  const RESEAU = lire('public/reseau.js');
  assert.match(RESEAU, /AbortController/, 'le minuteur repose sur AbortController');
  const delai = Number((RESEAU.match(/DELAI_DEFAUT = (\d+)/) || [])[1]);
  assert.ok(delai >= 5000 && delai <= 60000, `délai par défaut hors bornes : ${delai}`);
  const envoi = Number((RESEAU.match(/DELAI_ENVOI = (\d+)/) || [])[1]);
  assert.ok(envoi > delai, 'l’envoi d’un PDF a droit à plus de temps qu’un appel court');

  // Aucun `fetch(` nu ne subsiste dans les modules de l'application. Deux
  // exceptions assumées, et elles seules :
  //   - reseau.js, qui EST le minuteur ;
  //   - le `keepalive` de pagehide (réglages), qui part pendant que la page se
  //     ferme : l'interrompre, c'est perdre l'enregistrement qu'il sauve.
  const modules = ['public/app.js', 'public/clients.js', 'public/reglages.js',
    'public/dashboard.js', 'public/nouveau-projet.js', 'public/comptoir/pont.js'];
  for (const f of modules) {
    const src = lire(f);
    const lignes = src.split('\n');
    lignes.forEach((ligne, i) => {
      if (!/[^.\w]fetch\(/.test(ligne)) return;
      const contexte = lignes.slice(Math.max(0, i - 6), i + 6).join('\n');
      assert.ok(
        /signal:/.test(contexte) || /keepalive: true/.test(contexte),
        `${f}:${i + 1} — un fetch sans minuteur peut rester suspendu pour la journée :\n${ligne.trim()}`,
      );
    });
  }

  // Le Point du jour est le plus exposé : son drapeau `refreshing` ne se baisse
  // qu'au retour de la requête. Il passe par `api`, donc par le minuteur.
  const DASH = lire('public/dashboard.js');
  assert.match(bloc(DASH, '  async function refresh() {'), /await api\('GET'/,
    'le Point du jour passe par `api` (donc par le minuteur) : sinon `refreshing` '
    + 'reste levé et l’écran ne se rafraîchit plus jamais');

  // Un serveur qui ne répond pas se dit comme un réseau tombé, pas comme un bug.
  assert.match(
    bloc(APP, 'function estPanneReseau(err) {'), /serveur ne répond pas/,
    'le dépassement de délai est rangé avec les pannes réseau : même conduite à tenir',
  );

  // Le nouveau module fait partie de la coquille hors ligne — sans lui, l'import
  // échoue et c'est l'application entière qui ne s'ouvre plus.
  assert.match(lire('public/sw.js'), /'\/reseau\.js'/,
    'reseau.js est dans la coquille du service worker');

  // =========================================================================
  // 5. Le temps réel se rouvre quand le serveur a refusé le flux
  // =========================================================================
  const connect = bloc(APP, 'function connectStream() {');
  assert.match(
    connect, /EventSource\.CLOSED/,
    'on distingue « le navigateur retente » de « le navigateur a renoncé »',
  );
  assert.match(
    connect, /reprendreStream\(\)/,
    'et sur un renoncement, on rouvre nous-mêmes le flux',
  );
  assert.match(
    connect, /stream\.close\(\)/,
    'l’ancien flux est fermé avant d’en ouvrir un autre : jamais deux à la fois',
  );
  const reprise = bloc(APP, 'function reprendreStream() {');
  assert.match(
    reprise, /if \(streamReprise\) return;/,
    'une seule reprise programmée à la fois',
  );
  assert.match(
    reprise, /Math\.min\(3000 \* \(2 \*\* /,
    'l’espacement grandit : un serveur qui refuse ne s’aide pas d’un poste qui insiste',
  );
  // Le plafond de connexions du serveur est précisément le cas qui mettait le
  // flux en CLOSED : il doit toujours répondre par un refus net.
  assert.match(SRV, /Trop de connexions temps réel/,
    'le serveur refuse toujours au-delà du plafond — c’est ce refus qu’on sait maintenant encaisser');

  console.log('✓ audit 06/08 nuit : fiche corrigée sous verrou, ordre manuel fusionné par étape, '
    + 'borne illisible sans panne, toute requête bornée dans le temps, temps réel repris après refus');
  app.__server.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
