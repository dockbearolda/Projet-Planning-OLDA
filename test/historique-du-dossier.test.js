'use strict';

// L'HISTOIRE D'UN DOSSIER SE LIT (01/09/2026)
// ===========================================================================
// L'application écrivait DEUX historiques que personne ne pouvait ouvrir :
//
//   · le JOURNAL — chaque changement d'une commande, avec le poste et l'heure,
//     enregistré depuis des mois. Le tiroir qui devait le montrer a été retiré
//     le 29/08 et la fiche atelier ne l'a jamais repris ;
//   · les VERSIONS DE DOCUMENTS — chaque devis remplacé, archivé dans une table
//     que rien n'ouvrait.
//
// Un historique écrit et jamais lu est pire que pas d'historique : on croit
// pouvoir répondre à « qu'est-ce qui s'est passé sur ce dossier ? », et le jour
// où un client conteste un prix, il n'y a rien à ouvrir.
//
// CE QUE CE FICHIER TIENT :
//   1. les deux sortent par la MÊME porte, mêlés et datés ;
//   2. les valeurs se relisent en français — « Moyenne → Haute », pas « 2 → 3 » ;
//   3. le BRUT reste : une API qui travestit ce qu'elle a stocké ment à qui la relit ;
//   4. l'écran existe, et il ne recopie pas la table des libellés.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');

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

  const call = async (methode, chemin, corps, entetes) => {
    const res = await fetch(base + chemin, {
      method: methode,
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
  // 1. LES VALEURS SE RELISENT EN FRANÇAIS
  // =========================================================================
  const cree = await call('POST', '/api/requests', {
    stage: 'demande_chiffrage', sub_stage: 'a_chiffrer',
    billing_company: 'Hôtel Historique', product: 'Polos', quantity: 10,
    project_value: 648.96, priority: 2,
  });
  assert.strictEqual(cree.status, 201, JSON.stringify(cree.body));
  const id = cree.body.id;

  await call('PATCH', `/api/requests/${id}`, {
    priority: 3, project_value: 812.5, paye: true, paiement_mode: 'cb',
    stage: 'preparation', sub_stage: 'prepa_bat',
  }, { 'X-Qui': 'M%C3%A9lina' });

  const journal = (await call('GET', `/api/requests/${id}/journal`)).body;
  assert.ok(Array.isArray(journal) && journal.length, 'le journal répond une liste');
  const par = (champ) => journal.find((e) => e.field === champ);

  // Une priorité est un MOT à l'écran ; « 2 → 3 » n'est lisible par personne.
  assert.strictEqual(par('priority').avant, 'Moyenne');
  assert.strictEqual(par('priority').apres, 'Haute');
  // Une étape se dit par son libellé, jamais par son identifiant technique.
  assert.strictEqual(par('stage').avant, 'Demande & chiffrage');
  assert.strictEqual(par('stage').apres, 'Préparation du projet');
  assert.strictEqual(par('sub_stage').apres, 'Préparation du BAT');
  // Un montant s'écrit comme partout ailleurs dans l'application.
  assert.match(par('project_value').apres, /812,50\s?€/);
  // Un booléen se dit oui / non, et un mode de règlement par son libellé.
  assert.strictEqual(par('paye').apres, 'oui');
  assert.strictEqual(par('paiement_mode').apres, 'CB');
  // Et le POSTE signe : c'est ce qui distingue « hier à 16 h » de « Mélina, hier ».
  assert.strictEqual(par('priority').who, 'Mélina');

  // LE BRUT RESTE À CÔTÉ. Une API qui remplace ce qu'elle a stocké par sa mise
  // en forme du jour ment à qui la relit — et le premier qui s'en aperçoit est
  // celui qui compare deux exports à six mois d'écart.
  assert.strictEqual(par('priority').value_after, '3', 'la valeur brute est intacte');
  assert.strictEqual(par('project_value').value_after, '812.5');

  // =========================================================================
  // 2. LES DOCUMENTS ARCHIVÉS SORTENT PAR LA MÊME PORTE
  // =========================================================================
  const deposer = (nom) => fetch(`${base}/api/requests/${id}/pdf/devis?name=${nom}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf', 'X-Qui': 'Charlie' },
    body: Buffer.from(`%PDF-1.4 ${nom}`),
  });
  assert.ok((await deposer('devis-v1.pdf')).ok, 'le premier devis se dépose');
  assert.ok((await deposer('devis-v2.pdf')).ok, 'le second REMPLACE le premier');

  const avecDoc = (await call('GET', `/api/requests/${id}/journal`)).body;
  const doc = avecDoc.find((e) => e.field === 'document');
  assert.ok(doc, 'le devis remplacé figure dans l’histoire du dossier');
  assert.match(doc.label, /^Devis — version \d+$/, 'il se nomme en français, avec son rang');
  assert.strictEqual(doc.avant, 'devis-v1.pdf', 'c’est bien la version REMPLACÉE qui est gardée');
  assert.ok(doc.lien && doc.lien.includes('/versions/'), 'et elle se ROUVRE : sans lien, l’archive ne sert à rien');
  const relu = await fetch(base + doc.lien);
  assert.ok(relu.ok, 'le lien de la version archivée ouvre vraiment le document');

  // MÊLÉS ET DATÉS : c'est UNE histoire, pas deux listes à recoller à l'œil.
  const dates = avecDoc.map((e) => new Date(e.created_at).getTime());
  assert.deepStrictEqual([...dates].sort((a, b) => b - a), dates,
    'du plus récent au plus ancien, changements et documents confondus');

  // =========================================================================
  // 3. L'ÉCRAN EXISTE, ET IL NE RECOPIE PAS LES LIBELLÉS
  // =========================================================================
  const ECRAN = lire('public/historique.js');
  const FICHE = lire('public/fiche-atelier.js');
  const APP = lire('public/app.js');
  const SW = lire('public/sw.js');

  assert.match(FICHE, /ctx\.ouvrirHistorique/, 'la fiche atelier ouvre l’historique');
  assert.match(APP, /ouvrirHistorique: \(\) => import\('\.\/historique\.js'\)/,
    '… par un module chargé À LA DEMANDE : on consulte une histoire, on ne la lit pas tous les jours');
  assert.match(SW, /'\/historique\.js'/,
    '… et il est dans la coquille : c’est hors ligne qu’on cherche ce qui s’est passé');

  // LE SERVEUR NOMME, L'ÉCRAN AFFICHE. Une seconde table de libellés côté
  // navigateur diverge le jour où l'une des deux bouge.
  // ⚠ SANS LES COMMENTAIRES : l'écran EXPLIQUE d'où viennent « Moyenne » et
  // « 520,00 € », et les nommer suffisait à faire échouer ce contrôle. Même
  // piège que la sonde de code mort, trouvé le même jour.
  const codeEcran = ECRAN.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  for (const recopie of ['Moyenne', 'Basse', 'Bloquée', 'Demande & chiffrage']) {
    assert.ok(!codeEcran.includes(recopie),
      `« ${recopie} » ne se recopie pas dans l’écran : le serveur nomme, l’écran affiche`);
  }
  assert.match(ECRAN, /e\.avant/, 'l’écran lit ce que le serveur a mis en français');

  // ÉCHAP FERME, EN CAPTURE — comme partout ailleurs, sinon un champ ouvert
  // dessous avale la touche.
  assert.match(ECRAN, /addEventListener\('keydown', auClavier, true\)/,
    'Échap ferme la fenêtre, et l’écouteur est en capture');
  assert.match(ECRAN, /armerModale/, 'le focus entre dans la fenêtre et revient d’où il venait');

  // =========================================================================
  // 4. LA RANGÉE D'OUTILS DE LA FICHE N'A QU'UNE HAUTEUR
  // =========================================================================
  // Le bouton « Historique » y prenait `--fa-h-champ` (50) à côté d'une croix à
  // `--rond` (44) : six pixels d'écart dans la même rangée, exactement ce que la
  // règle du 27/08 interdit. Mesuré au rendu le 01/09, puis tenu ici.
  const CSS = lire('public/fiche-atelier.css');
  assert.match(CSS, /\.fa-outils \.fa-btn \{ height: var\(--rond\); \}/,
    'une SEULE règle donne leur hauteur aux boutons de la rangée');
  const croix = CSS.match(/\.hist__croix \{[\s\S]*?\n\}/);
  assert.ok(croix, 'la croix de l’historique a sa règle');
  assert.match(croix[0], /width: var\(--rond\); height: var\(--rond\);/,
    '… dans la boîte de toutes les croix de l’application');
  assert.match(croix[0], /border-radius: var\(--pilule\)/,
    '… avec leur forme : une croix ronde ici et carrée là se voit');
  assert.ok(!/height:\s*\d+px/.test(CSS.slice(CSS.indexOf('.hist {'))),
    'aucune hauteur écrite en dur dans la fenêtre : une hauteur est un JETON');

  console.log('✓ historique : journal et documents en une liste lisible, et la fiche l’ouvre à la bonne hauteur');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
