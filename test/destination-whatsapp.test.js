'use strict';

// Vérifie deux ajouts, sur le vrai serveur Express + base en mémoire :
//   1. la DESTINATION choisie au comptoir (« Où l'enregistrer ? ») est bien celle
//      qui atterrit dans le planning, et une sous-étape étrangère à la famille
//      est refusée plutôt que silencieusement rangée n'importe où ;
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

  const fiche = (extra) => ({
    kind: 'commande',
    client: { type: 'pro', facturation: 'Hôtel Mercure', whatsapp: '0690 66 24 00' },
    objet: '30 polos brodés',
    ...extra,
  });

  // === 1. Destination ======================================================

  // 1.1 Le catalogue sert le pipeline : sans lui, le poste de saisie ne pourrait
  // pas proposer les destinations.
  let r = await call('GET', '/api/commande/catalog');
  assert.strictEqual(r.status, 200);
  const prepa = r.body.pipeline.find((f) => f.slug === 'preparation');
  assert.ok(prepa, 'le catalogue expose le pipeline');
  assert.ok(prepa.subs.some((s) => s.slug === 'a_commander'),
    'chaque famille porte ses sous-étapes');
  assert.ok(r.body.pipeline.some((f) => f.slug === 'fiverr'),
    'Fiverr reste une destination possible');

  // 1.2 Sans destination (ancien corps) : celle du catalogue, comme avant.
  r = await call('POST', '/api/commande', fiche());
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.commande.stage, 'demande_chiffrage');
  assert.strictEqual(r.body.commande.subStage, 'a_chiffrer');

  // 1.3 Destination choisie : c'est elle qui l'emporte sur l'habitude.
  r = await call('POST', '/api/commande', fiche({ stage: 'preparation', subStage: 'a_commander' }));
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.commande.stage, 'preparation');
  assert.strictEqual(r.body.commande.subStage, 'a_commander');
  let rows = (await call('GET', '/api/requests?stage=preparation')).body;
  assert.ok(rows.some((x) => x.billing_company === 'Hôtel Mercure' && x.sub_stage === 'a_commander'),
    'la ligne est bien rangée où on l\'a demandé');

  // 1.4 Famille SANS préciser la sous-étape : position valide (« à préciser »).
  r = await call('POST', '/api/commande', fiche({ stage: 'preparation', subStage: null }));
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.commande.subStage, null);

  // 1.5 Une famille visée sans préciser sa sous-étape : « à préciser » est valide.
  r = await call('POST', '/api/commande', fiche({ stage: 'demande_chiffrage' }));
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.commande.stage, 'demande_chiffrage');

  // 1.6 Refus : étape inconnue, et sous-étape étrangère à la famille visée.
  r = await call('POST', '/api/commande', fiche({ stage: 'nulle_part' }));
  assert.strictEqual(r.status, 400, 'étape inconnue refusée');
  r = await call('POST', '/api/commande', fiche({ stage: 'demande_chiffrage', subStage: 'a_commander' }));
  assert.strictEqual(r.status, 400, 'sous-étape étrangère à la famille refusée');
  r = await call('POST', '/api/commande', fiche({ stage: 'preparation', subStage: 'prod_uv' }));
  assert.strictEqual(r.status, 400, 'sous-étape d\'une autre famille refusée');

  // 1.7 Le numéro saisi au comptoir arrive sur la ligne : c'est lui qui décide
  // si la pastille WhatsApp s'affiche.
  rows = (await call('GET', '/api/requests?stage=demande_chiffrage')).body;
  const ligne = rows.find((x) => x.billing_company === 'Hôtel Mercure');
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

  console.log('✓ destination + WhatsApp : choix de l\'étape, refus des destinations incohérentes, message réglable OK');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
