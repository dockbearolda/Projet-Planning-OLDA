'use strict';

// Vérifie l'upload / consultation / suppression du BAT (Bon À Tirer) PDF sur
// une commande, et que son nom de fichier remonte bien dans la liste des
// commandes (SELECT ... bat_name), comme devis/facture. Ce test ne pilote
// aucun développement : PDF_KINDS et le SELECT supportent déjà `bat`, ce
// test le prouve avant qu'on construise l'icône frontend dessus.

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

  // Une commande vierge pour y accrocher le BAT.
  const created = await (await fetch(`${base}/api/requests`, { method: 'POST' })).json();
  const id = created.id;

  const pdfBytes = Buffer.from('%PDF-1.4 test bat', 'utf8');

  // --- Upload --------------------------------------------------------------
  const put = await fetch(
    `${base}/api/requests/${id}/pdf/bat?name=${encodeURIComponent('BAT 2026-001.pdf')}`,
    { method: 'PUT', body: pdfBytes },
  );
  assert.strictEqual(put.status, 200);
  const putBody = await put.json();
  assert.strictEqual(putBody.kind, 'bat');
  assert.strictEqual(putBody.filename, 'BAT 2026-001.pdf');

  // --- Le nom de fichier remonte dans la liste des commandes ---------------
  const list = await (await fetch(`${base}/api/requests?stage=demande`)).json();
  const row = list.find((r) => r.id === id);
  assert.ok(row, 'la commande créée doit apparaître dans /api/requests?stage=demande');
  assert.strictEqual(row.bat_name, 'BAT 2026-001.pdf');

  // --- Consultation : contenu identique, servi en PDF -----------------------
  const get = await fetch(`${base}/api/requests/${id}/pdf/bat`);
  assert.strictEqual(get.status, 200);
  assert.strictEqual(get.headers.get('content-type'), 'application/pdf');
  const gotBytes = Buffer.from(await get.arrayBuffer());
  assert.ok(gotBytes.equals(pdfBytes), 'le PDF relu doit être identique à celui envoyé');

  // --- Suppression -----------------------------------------------------------
  const del = await fetch(`${base}/api/requests/${id}/pdf/bat`, { method: 'DELETE' });
  assert.strictEqual(del.status, 204);
  const getAfter = await fetch(`${base}/api/requests/${id}/pdf/bat`);
  assert.strictEqual(getAfter.status, 404);

  console.log('✓ bat-pdf : upload, filename dans la liste, consultation, suppression OK');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
