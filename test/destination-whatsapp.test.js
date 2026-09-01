'use strict';

// Vérifie deux ajouts, sur le vrai serveur Express + base en mémoire :
//   1. la DESTINATION choisie au comptoir (« Où l'enregistrer ? ») est bien celle
//      qui atterrit dans le planning, et une sous-étape étrangère à la famille
//      est refusée plutôt que silencieusement rangée n'importe où (Nouveau
//      Projet est la seule porte d'entrée depuis la suppression de Commande) ;
//   2. le MESSAGE WhatsApp « commande prête », réglé par le patron : valeur par
//      défaut, enregistrement, message vidé assumé et refus des corps invalides.

const assert = require('node:assert');
const { DEFAULT_WHATSAPP_MESSAGE, WHATSAPP_MESSAGE_MAX } = require('../db');

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

  // === 1. LA DESTINATION CHOISIE AU COMPTOIR ==============================

  // CE QUI A CHANGÉ LE 01/09. Cette section passait par `POST /api/projets`,
  // qui rangeait le dossier DIRECTEMENT à la famille demandée et refusait une
  // sous-étape étrangère. Cette route n'avait plus d'écran depuis le 31/07 et
  // la production le confirmait — huit dossiers, aucun depuis. Elle est partie.
  //
  // La règle qui la remplace est plus stricte, et c'est le comptoir qui la
  // porte : TOUT ce que la vendeuse enregistre tombe dans « À trier », et la
  // destination voyage DANS la fiche pour que le rangement se fasse d'un seul
  // geste. Le refus d'une sous-étape incohérente vit désormais sur `PATCH
  // /api/requests/:id`, au moment où quelqu'un range vraiment la ligne.
  // Le détail du tri est tenu par `a-trier.test.js` ; ici on garde ce qui
  // touche à WhatsApp : le numéro du client doit arriver sur la ligne.

  // 1.1 Le serveur sert le pipeline : sans lui, aucun écran ne pourrait
  // proposer les destinations.
  let r = await call('GET', '/api/pipeline');
  assert.strictEqual(r.status, 200);
  const prepa = r.body.find((f) => f.slug === 'preparation');
  assert.ok(prepa, 'le serveur expose le pipeline');
  assert.ok(prepa.subs.some((s) => s.slug === 'a_commander'),
    'chaque famille porte ses sous-étapes');
  assert.ok(r.body.some((f) => f.slug === 'fiverr'),
    'Fiverr reste une destination possible');

  // 1.2 Un dossier pris au comptoir garde sa destination, et son numéro.
  const { creerDossier } = require('./dossier');
  const pris = await creerDossier(call, {
    societe: 'Hôtel Mercure', tel: '0690 66 24 00', quantite: 30, montant: 600,
    stage: 'Préparation du projet', status: 'À commander',
  });
  assert.strictEqual(pris.stage, 'a_trier', 'tout passe par le tri');
  assert.deepStrictEqual(pris.destination, { stage: 'preparation', subStage: 'a_commander' },
    '… en gardant la famille désignée au comptoir');

  // 1.3 Le numéro saisi au comptoir arrive sur la ligne : c'est lui qui décide
  // si la pastille WhatsApp s'affiche.
  const rows = (await call('GET', '/api/requests?stage=a_trier')).body;
  const ligne = rows.find((x) => x.id === pris.id);
  assert.ok(ligne, 'la ligne est au planning');
  assert.strictEqual(ligne.contact_phone, '0690 66 24 00',
    'le WhatsApp du client suit la commande');

  // === 2. Message WhatsApp =================================================

  // 2.1 Jamais réglé → le texte par défaut, jetons compris.
  r = await call('GET', '/api/settings/whatsapp');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.message, DEFAULT_WHATSAPP_MESSAGE);
  assert.match(r.body.message, /\{client\}/);
  assert.match(r.body.message, /\{commande\}/);

  // 2.2 Le patron écrit le sien : enregistré tel quel, relu tel quel.
  const perso = 'Bonjour {client}, {commande} est prêt le {date}. — OLDA';
  r = await call('PUT', '/api/settings/whatsapp', { message: perso });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.message, perso);
  assert.strictEqual((await call('GET', '/api/settings/whatsapp')).body.message, perso);

  // 2.3 Message VIDÉ : c'est un choix (on écrira à la main), pas un oubli — on
  // ne lui remet pas le texte par défaut au prochain chargement.
  r = await call('PUT', '/api/settings/whatsapp', { message: '' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await call('GET', '/api/settings/whatsapp')).body.message, '',
    'un message vidé le reste');

  // 2.4 Refus : mauvais type et texte hors gabarit.
  assert.strictEqual((await call('PUT', '/api/settings/whatsapp', { message: 12 })).status, 400);
  assert.strictEqual((await call('PUT', '/api/settings/whatsapp', {})).status, 400);
  assert.strictEqual(
    (await call('PUT', '/api/settings/whatsapp', { message: 'x'.repeat(WHATSAPP_MESSAGE_MAX + 1) })).status,
    400, 'message trop long refusé',
  );

  console.log('✓ destination + WhatsApp : le dossier garde sa destination par le tri, et le message est réglable');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
