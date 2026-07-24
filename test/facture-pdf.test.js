'use strict';

// Vérifie l'upload / consultation / suppression de la facture PDF sur une
// commande, et que son nom de fichier remonte bien dans la liste des
// commandes (SELECT ... facture_name), comme devis/bat.

const assert = require('node:assert');

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

  // Une commande vierge pour y accrocher la facture.
  const created = await (await fetch(`${base}/api/requests`, { method: 'POST' })).json();
  const id = created.id;

  const pdfBytes = Buffer.from('%PDF-1.4 test facture', 'utf8');

  // --- Upload --------------------------------------------------------------
  const put = await fetch(
    `${base}/api/requests/${id}/pdf/facture?name=${encodeURIComponent('Facture 2026-001.pdf')}`,
    { method: 'PUT', body: pdfBytes },
  );
  assert.strictEqual(put.status, 200);
  const putBody = await put.json();
  assert.strictEqual(putBody.kind, 'facture');
  assert.strictEqual(putBody.filename, 'Facture 2026-001.pdf');

  // --- Le nom de fichier remonte dans la liste des commandes ---------------
  const list = await (await fetch(`${base}/api/requests?stage=demande`)).json();
  const row = list.find((r) => r.id === id);
  assert.ok(row, 'la commande créée doit apparaître dans /api/requests?stage=demande');
  assert.strictEqual(row.facture_name, 'Facture 2026-001.pdf');

  // --- Consultation : contenu identique, servi en PDF -----------------------
  const get = await fetch(`${base}/api/requests/${id}/pdf/facture`);
  assert.strictEqual(get.status, 200);
  assert.strictEqual(get.headers.get('content-type'), 'application/pdf');
  const gotBytes = Buffer.from(await get.arrayBuffer());
  assert.ok(gotBytes.equals(pdfBytes), 'le PDF relu doit être identique à celui envoyé');

  // --- Kind invalide toujours rejeté -----------------------------------------
  const bad = await fetch(`${base}/api/requests/${id}/pdf/inconnu`);
  assert.strictEqual(bad.status, 400);

  // --- Suppression -----------------------------------------------------------
  const del = await fetch(`${base}/api/requests/${id}/pdf/facture`, { method: 'DELETE' });
  assert.strictEqual(del.status, 204);
  const getAfter = await fetch(`${base}/api/requests/${id}/pdf/facture`);
  assert.strictEqual(getAfter.status, 404);

  console.log('✓ facture-pdf : upload, filename dans la liste, consultation, kind invalide, suppression OK');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
