# Facture PDF + envoi WhatsApp en un clic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an employee attach a devis/facture PDF to a planning row, then send it with one click that downloads the PDF and opens a blank WhatsApp conversation with the client, ready to attach and send.

**Architecture:** The backend already has a generic PDF-attachment mechanism (`attachments` table keyed by `(request_id, kind)`, base64-in-Postgres, `PUT/GET/DELETE /api/requests/:id/pdf/:kind`) used today only for `devis`/`bat`, and never wired to the frontend. We add `facture` as a third kind, then build one reusable two-state icon component in `app.js` (empty = attach via file picker, filled = download + open blank `wa.me` chat), instantiated twice per row (`devis`, `facture`), next to the existing WhatsApp "commande prête" icon.

**Tech Stack:** Node/Express + `pg` backend (`server.js`, `db.js`), vanilla ES module frontend (`public/app.js`), no build step, no frontend test framework (manual verification via the preview browser); backend tests are plain `node:assert` scripts run against the real server (`test/*.test.js`, `npm test`).

---

### Task 1: Backend — add `facture` as a third PDF kind

**Files:**
- Modify: `server.js:289-294` (SELECT join), `server.js:415-419` (comment + `PDF_KINDS`), `server.js:435`, `server.js:460`, `server.js:478` (error messages)
- Test: `test/facture-pdf.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `test/facture-pdf.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/facture-pdf.test.js`
Expected: FAIL — the `PUT .../pdf/facture` call returns `400 { error: 'type invalide (devis|bat)' }` because `facture` isn't in `PDF_KINDS` yet, so the assertion `assert.strictEqual(put.status, 200)` throws.

- [ ] **Step 3: Add `facture` to `PDF_KINDS` and update the comment**

In `server.js`, replace (around line 415-419):

```js
// ---------------------------------------------------------------------------
// Pièces jointes PDF (Devis / BAT) — 2 emplacements fixes par commande.
// Stockées en base (base64) ; servies inline pour consultation immédiate.
// ---------------------------------------------------------------------------
const PDF_KINDS = ['devis', 'bat'];
```

with:

```js
// ---------------------------------------------------------------------------
// Pièces jointes PDF (Devis / BAT / Facture) — 3 emplacements fixes par commande.
// Stockées en base (base64) ; servies inline pour consultation immédiate.
// ---------------------------------------------------------------------------
const PDF_KINDS = ['devis', 'bat', 'facture'];
```

- [ ] **Step 4: Add the `facture_name` join to `SELECT`**

In `server.js`, replace (around line 289-294):

```js
const SELECT = `SELECT r.*,
    ad.filename AS devis_name,
    ab.filename AS bat_name
  FROM requests r
  LEFT JOIN attachments ad ON ad.request_id = r.id AND ad.kind = 'devis'
  LEFT JOIN attachments ab ON ab.request_id = r.id AND ab.kind = 'bat'`;
```

with:

```js
const SELECT = `SELECT r.*,
    ad.filename AS devis_name,
    ab.filename AS bat_name,
    af.filename AS facture_name
  FROM requests r
  LEFT JOIN attachments ad ON ad.request_id = r.id AND ad.kind = 'devis'
  LEFT JOIN attachments ab ON ab.request_id = r.id AND ab.kind = 'bat'
  LEFT JOIN attachments af ON af.request_id = r.id AND af.kind = 'facture'`;
```

- [ ] **Step 5: Update the three hardcoded error messages to reflect all kinds**

In `server.js`, there are three identical lines (PUT at line 435, GET at line 460, DELETE at line 478):

```js
    if (!PDF_KINDS.includes(kind)) return res.status(400).json({ error: 'type invalide (devis|bat)' });
```

Replace **each of the three occurrences** with:

```js
    if (!PDF_KINDS.includes(kind)) return res.status(400).json({ error: `type invalide (${PDF_KINDS.join('|')})` });
```

(Use the surrounding route — PUT / GET / DELETE handler — to target each occurrence individually, since the line is identical in all three.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `node test/facture-pdf.test.js`
Expected: `✓ facture-pdf : upload, filename dans la liste, consultation, kind invalide, suppression OK`

- [ ] **Step 7: Run the full test suite to check nothing else broke**

Run: `npm test`
Expected: all `test/*.test.js` scripts print their `✓ ...` line and exit 0.

- [ ] **Step 8: Commit**

```bash
git add server.js test/facture-pdf.test.js
git commit -m "$(cat <<'EOF'
Ajoute la facture comme 3e pièce jointe PDF (devis/bat/facture)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Frontend — reusable two-state PDF-slot icon (attach / send+download)

**Files:**
- Modify: `public/app.js` (new functions, placed right after `cellWhatsapp` / `whatsappIcon`, around line 1341)

- [ ] **Step 1: Add the paperclip icon builder, right after `whatsappIcon()` (app.js:1302-1314), before `cellWhatsapp`**

```js
// Trombone construit en DOM (même trait que arrowIcon/whatsappIcon, pas
// d'innerHTML) : icône neutre de l'app, pas une icône de marque.
function pdfClipIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute(
    'd',
    'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
  );
  svg.appendChild(path);
  return svg;
}
```

- [ ] **Step 2: Add the upload/send helpers right after `pdfClipIcon()`**

```js
// Libellés pour les infobulles des deux emplacements PDF de la ligne.
const PDF_SLOT_LABELS = { devis: 'devis', facture: 'facture' };

// PUT brut (pas de JSON) : `api()` ne convient pas, il JSON.stringify toujours
// le corps. Le serveur lit le corps quel que soit son Content-Type.
async function uploadPdf(requestId, kind, file) {
  const url = `/api/requests/${requestId}/pdf/${kind}?name=${encodeURIComponent(file.name)}`;
  const res = await fetch(url, { method: 'PUT', body: await file.arrayBuffer() });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).error || detail; } catch (_) {}
    throw new Error(detail);
  }
  return res.json(); // { kind, filename }
}

// Clic sur la pastille remplie : télécharge le PDF ET ouvre la conversation
// WhatsApp du client VIERGE (aucun texte pré-rempli — le patron/employé tape
// son message à la main avec ses réponses rapides « / »). Glisser le fichier
// téléchargé dans la conversation puis Envoyer restent deux gestes manuels :
// aucun lien wa.me ne peut porter une pièce jointe.
function sendPdf(r, kind, filename) {
  const a = document.createElement('a');
  a.href = `/api/requests/${r.id}/pdf/${kind}`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  const lien = whatsappLink(r.contact_phone, '', {});
  if (lien) window.open(lien, '_blank', 'noopener,noreferrer');
}
```

- [ ] **Step 3: Add the `cellPdfSlot` component right after `sendPdf()`**

```js
// Pastille PDF à deux états, pour `devis` et `facture` (mêmes règles) :
//  - vide   : trombone neutre, clic → sélecteur de fichier → upload immédiat.
//  - remplie : trombone accentué, clic → sendPdf() (téléchargement + WhatsApp
//    vierge) ; une petite croix apparaît au survol pour retirer le fichier.
// Toujours rendue (contrairement à cellWhatsapp) : une facture s'archive même
// sans numéro client lisible — dans ce cas l'état rempli télécharge sans
// ouvrir WhatsApp (whatsappLink renvoie null, sendPdf n'ouvre alors rien).
function cellPdfSlot(r, kind) {
  const label = PDF_SLOT_LABELS[kind];
  const filename = r[`${kind}_name`];
  const wrap = document.createElement('span');
  wrap.className = 'pdf-slot';

  if (!filename) {
    const lbl = document.createElement('label');
    lbl.className = 'pdf-btn pdf-btn--empty';
    attachTip(lbl, `Attacher le ${label}`);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf';
    input.hidden = true;
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      uploadPdf(r.id, kind, file)
        .then(({ filename: name }) => {
          r[`${kind}_name`] = name;
          invalidateRowCache(r.id);
          applySortAndRender();
        })
        .catch(reportError);
    });
    lbl.appendChild(input);
    lbl.appendChild(pdfClipIcon());
    wrap.appendChild(lbl);
    return wrap;
  }

  const btn = document.createElement('a');
  btn.className = 'pdf-btn pdf-btn--filled';
  btn.href = `/api/requests/${r.id}/pdf/${kind}`;
  const labelCap = label.charAt(0).toUpperCase() + label.slice(1);
  attachTip(btn, `${labelCap} : ${filename} — clic = télécharger + ouvrir WhatsApp`);
  btn.appendChild(pdfClipIcon());
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    sendPdf(r, kind, filename);
  });
  wrap.appendChild(btn);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'pdf-btn__remove';
  remove.setAttribute('aria-label', `Retirer le ${label}`);
  remove.textContent = '×';
  remove.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    api('DELETE', `/api/requests/${r.id}/pdf/${kind}`)
      .then(() => {
        r[`${kind}_name`] = null;
        invalidateRowCache(r.id);
        applySortAndRender();
      })
      .catch(reportError);
  });
  wrap.appendChild(remove);
  return wrap;
}
```

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "$(cat <<'EOF'
Ajoute le composant pastille PDF à deux états (attacher / envoyer via WhatsApp)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wire the devis/facture icons into the row, and stop them leaking across duplicate/create

**Files:**
- Modify: `public/app.js:1276-1281` (`cellDossier`), `public/app.js:1897` (`makeOptimisticRow`), `public/app.js:2043` (`duplicateRow`)

- [ ] **Step 1: Append the two icons in `cellDossier`, after the existing WhatsApp icon**

In `public/app.js`, replace (around line 1276-1281):

```js
  const line = document.createElement('div');
  line.className = 'client-line';
  line.appendChild(company);
  const wa = cellWhatsapp(r);
  if (wa) line.appendChild(wa);
  stack.appendChild(line);
```

with:

```js
  const line = document.createElement('div');
  line.className = 'client-line';
  line.appendChild(company);
  const wa = cellWhatsapp(r);
  if (wa) line.appendChild(wa);
  line.appendChild(cellPdfSlot(r, 'devis'));
  line.appendChild(cellPdfSlot(r, 'facture'));
  stack.appendChild(line);
```

- [ ] **Step 2: Reset `facture_name` alongside `devis_name`/`bat_name` in `makeOptimisticRow`**

In `public/app.js`, replace (around line 1897):

```js
    devis_name: null, bat_name: null,
```

with:

```js
    devis_name: null, bat_name: null, facture_name: null,
```

- [ ] **Step 3: Reset `facture_name` alongside `devis_name`/`bat_name` in `duplicateRow`**

In `public/app.js`, replace (around line 2043):

```js
    ...r, id: tmpId, devis_name: null, bat_name: null,
```

with:

```js
    ...r, id: tmpId, devis_name: null, bat_name: null, facture_name: null,
```

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "$(cat <<'EOF'
Affiche les pastilles devis/facture sur la ligne, sans copie au duplicata

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Styles for the PDF-slot icon states

**Files:**
- Modify: `public/styles.css` (add after the `.wa-btn` rules, around line 1149)

- [ ] **Step 1: Add the CSS rules**

In `public/styles.css`, right after the `.wa-btn:focus-visible` rule (line 1149), add:

```css
/* Pastille PDF (devis / facture) : même gabarit que .wa-btn (24 px visuel,
   44 px de zone tactile via ::after). Toujours visible, contrairement à
   .wa-btn : une facture s'archive même sans numéro client. */
.pdf-slot { position: relative; display: inline-flex; align-items: center; flex: 0 0 auto; }
.pdf-btn {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px; height: 24px;
  margin-right: 6px;
  border-radius: 50%;
  text-decoration: none;
  cursor: pointer;
  transition: background var(--dur-1) var(--ease), transform var(--dur-1) var(--ease);
}
.pdf-btn::after {
  content: '';
  position: absolute;
  inset: -10px;             /* 24 + 2×10 = 44 px de zone tactile */
}
.pdf-btn:active { transform: scale(.92); }
.pdf-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

/* Vide : trombone neutre, discret tant qu'aucun PDF n'est attaché. */
.pdf-btn--empty {
  color: var(--text-3);
  background: color-mix(in srgb, var(--text-3) 12%, transparent);
}
.pdf-btn--empty:hover { background: color-mix(in srgb, var(--text-3) 22%, transparent); }

/* Remplie : accent de l'app (pas le vert WhatsApp, réservé à la pastille de
   marque) — signale un PDF prêt à partir. */
.pdf-btn--filled {
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 16%, transparent);
}
.pdf-btn--filled:hover { background: color-mix(in srgb, var(--primary) 28%, transparent); }

/* Croix de retrait : cachée par défaut, révélée au survol du slot (souris
   uniquement — comme les infobulles, la tablette n'a pas de survol ; sur
   tablette le retrait se fait en rattachant un nouveau PDF n'est pas possible
   tant qu'un fichier est présent : ce cas reste un usage PC/Mac assumé,
   cf. spec). */
.pdf-btn__remove {
  position: absolute;
  top: -6px; right: -2px;
  width: 16px; height: 16px;
  display: none;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: var(--text-1);
  color: var(--surface-1, #fff);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
.pdf-slot:hover .pdf-btn__remove { display: inline-flex; }
```

- [ ] **Step 2: Commit**

```bash
git add public/styles.css
git commit -m "$(cat <<'EOF'
Styles des pastilles devis/facture (états vide/rempli + croix de retrait)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Manual verification in the browser

**Files:** none (verification only)

- [ ] **Step 1: Start the app and open the planning view**

Use the preview browser tool to start the app's dev server (see `.claude/launch.json` / `npm start`) and navigate to the planning page.

- [ ] **Step 2: Verify the empty state**

Open a row that has no devis/facture attached. Confirm two neutral trombone icons appear next to the company name (and next to the WhatsApp icon if the row has a phone number).

- [ ] **Step 3: Verify upload**

Click the facture trombone, pick a small PDF file from disk. Confirm: the icon switches to the "filled" (accented) state, and the tooltip on hover shows the filename.

- [ ] **Step 4: Verify send**

Set the row's contact phone to a valid number (e.g. `06 90 66 24 00`). Click the filled facture icon. Confirm: a PDF download starts (check `read_network_requests` or the browser's download indicator) AND a new tab opens to `https://wa.me/590690662400` with a blank conversation (no `?text=`).

- [ ] **Step 5: Verify send without a phone number**

Clear the row's contact phone. Click the filled facture icon again. Confirm: only the download happens, no new tab opens (no crash, no error toast).

- [ ] **Step 6: Verify remove**

Hover the filled facture icon. Confirm a small "×" appears in the top-right corner. Click it. Confirm the icon reverts to the empty (trombone) state.

- [ ] **Step 7: Verify duplicate doesn't copy attachments**

Attach a devis to a row, then duplicate that row (existing duplicate feature). Confirm the new row shows both devis and facture as empty, even though the source row has a devis attached.

- [ ] **Step 8: Verify the devis icon independently**

Repeat steps 3-4 for the **devis** icon on the same row, confirming it behaves identically and independently from the facture icon (uploading one does not affect the other).

- [ ] **Step 9: Run the full test suite one more time**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 10: Report to the user**

Summarize what was verified and any screenshot/network evidence gathered, per the project's verification-before-completion requirement.
