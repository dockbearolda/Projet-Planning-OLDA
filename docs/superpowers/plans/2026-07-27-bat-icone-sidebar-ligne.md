# BAT Icon + Side Bar Détail de Ligne — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une icône BAT (upload/aperçu/suppression PDF, comme devis/facture) sur chaque ligne de la grille de planning, et une side bar de détails à droite qui s'ouvre via une icône dédiée dans le même cluster, sans toucher au comportement d'édition inline existant.

**Architecture:** Backend inchangé (déjà prêt : `bat` est déjà un kind de pièce jointe valide, `fiche` jsonb déjà renvoyé au client). Frontend uniquement, dans `public/app.js` : extension du composant pastille PDF déjà générique pour le BAT, et nouveau composant "tiroir" (`.ligne-drawer`) calqué sur `.cl-drawer` de `clients.js`, qui se synchronise depuis `rows` par id (jamais une référence figée) à chaque rendu de la grille.

**Tech Stack:** Vanilla JS (DOM API, pas de framework), Express + PostgreSQL (pg-mem en local), `node:assert` pour les tests.

---

## Référence : spec validée

Ce plan implémente `docs/superpowers/specs/2026-07-27-bat-icone-sidebar-ligne-design.md`. Le lire avant de commencer aide à comprendre le *pourquoi* de chaque décision — ce plan se concentre sur le *comment*, fichier par fichier.

## Contexte technique qui affecte plusieurs tâches (lire avant de commencer)

- **`rows` est remplacé, pas muté, à chaque poll/SSE** ([public/app.js:521-531](../../../public/app.js#L521), [public/app.js:2736-2748](../../../public/app.js#L2736)) : `renderRows()` reconstruit un `<tr>` via `buildRow(r)` dès que `r.updated_at` change ([public/app.js:706-764](../../../public/app.js#L706)). La side bar ne doit donc **jamais** garder une référence à un objet `r` : elle stocke l'**id** (`ligneDrawerId`, string) et refait `rows.find(...)` à chaque rendu — exactement comme `detailId`/`renderDetailIfOpen()` dans `dashboard.js` ([public/dashboard.js:668-705](../../../public/dashboard.js#L668)).
- **`invalidateRowCache(id)` + `applySortAndRender()`** ([public/app.js:697-704](../../../public/app.js#L697)) est le mécanisme déjà utilisé partout ailleurs (ex. upload PDF, [public/app.js:1368-1369](../../../public/app.js#L1368)) pour forcer la reconstruction d'une ligne après une modification locale. La side bar l'utilise après la sauvegarde des Notes.
- **Deux champs à ne pas confondre** : la colonne visuelle « Description » édite en fait `r.product` ([public/app.js:1477-1494](../../../public/app.js#L1477)) ; la colonne visuelle « Infos » édite `r.description` ([public/app.js:1529](../../../public/app.js#L1529)). La side bar utilise `r.product` pour le sous-titre d'en-tête et `r.description` pour la section Notes.
- **Aucun popover contact n'existe actuellement** : malgré un commentaire dans le code qui l'évoque ([public/app.js:1215](../../../public/app.js#L1215)), `contact_referent`/`contact_phone`/`contact_email` n'ont aujourd'hui aucune UI d'affichage dédiée dans la grille (seul `contact_phone` est lu en interne pour construire le lien WhatsApp). La section Contact de la side bar est donc la première vraie surface de lecture pour ces champs — en lecture seule, conformément à la spec.
- **Pas d'`innerHTML` avec du contenu dynamique** : tous les glyphes de ce plan (y compris la croix de fermeture) sont construits via `strokeIcon()` (déjà utilisé par `whatsappIcon()`/`devisIcon()`/`factureIcon()`, [public/app.js:1252-1270](../../../public/app.js#L1252)), pas via `innerHTML`.

---

### Task 1: Test de régression serveur — pièce jointe BAT

Ce test ne pilote aucun développement (le backend ne change pas dans ce plan) : il **prouve** que `bat` fonctionne déjà de bout en bout via `PDF_KINDS` ([server.js:459](../../../server.js#L459)) et le `SELECT` existant ([server.js:327-334](../../../server.js#L327)), avant qu'on construise l'icône frontend dessus.

**Files:**
- Create: `test/bat-pdf.test.js`

- [ ] **Step 1: Écrire le test (calqué sur `test/facture-pdf.test.js`)**

```javascript
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
```

- [ ] **Step 2: Lancer le test — doit déjà PASSER (aucun code backend à écrire)**

Run: `node test/bat-pdf.test.js`
Expected: `✓ bat-pdf : upload, filename dans la liste, consultation, suppression OK`, code de sortie 0.

Si ce test échoue, ne pas continuer ce plan : cela voudrait dire que la spec s'est trompée sur l'état du backend — retourner vérifier `PDF_KINDS` et le `SELECT` dans `server.js` avant toute chose.

- [ ] **Step 3: Lancer toute la suite pour vérifier l'absence de régression**

Run: `npm test`
Expected: tous les fichiers `test/*.test.js` passent.

- [ ] **Step 4: Commit**

```bash
git add test/bat-pdf.test.js
git commit -m "test: preuve que le kind BAT fonctionne déjà côté serveur"
```

---

### Task 2: Icône BAT sur la ligne (frontend)

Extension du composant pastille PDF déjà générique — le backend ne bouge pas (task 1 vient de le prouver).

**Files:**
- Modify: `public/app.js:1280-1304`, `public/app.js:1336`, `public/app.js:1236-1237`

- [ ] **Step 1: Ajouter le glyphe `batIcon()` après `factureIcon()`**

Dans `public/app.js`, juste après la fonction `factureIcon()` (se termine ligne 1298, juste avant le commentaire `// Libellés pour les infobulles...`), ajouter :

```javascript
// BAT (Bon À Tirer) : un sceau avec un check — la validation avant production.
function batIcon() {
  return strokeIcon([
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
    'M8 12l2.5 2.5L16 9',
  ]);
}
```

- [ ] **Step 2: Déclarer le 3ᵉ emplacement dans `PDF_SLOT_LABELS` et `PDF_SLOT_ICON`**

Remplacer ([public/app.js:1301-1304](../../../public/app.js#L1301)) :

```javascript
const PDF_SLOT_LABELS = {
  devis: { noun: 'devis', withArticle: 'le devis' },
  facture: { noun: 'facture', withArticle: 'la facture' },
};
```

par :

```javascript
const PDF_SLOT_LABELS = {
  devis: { noun: 'devis', withArticle: 'le devis' },
  facture: { noun: 'facture', withArticle: 'la facture' },
  bat: { noun: 'BAT', withArticle: 'le BAT' },
};
```

Remplacer ([public/app.js:1336](../../../public/app.js#L1336)) :

```javascript
const PDF_SLOT_ICON = { devis: devisIcon, facture: factureIcon };
```

par :

```javascript
const PDF_SLOT_ICON = { devis: devisIcon, facture: factureIcon, bat: batIcon };
```

- [ ] **Step 3: Câbler la pastille dans `cellDossier()`**

Remplacer ([public/app.js:1234-1239](../../../public/app.js#L1234)) :

```javascript
  line.appendChild(company);
  line.appendChild(cellWhatsapp(r));
  line.appendChild(cellPdfSlot(r, 'devis'));
  line.appendChild(cellPdfSlot(r, 'facture'));
  const pdfWa = cellPdfWhatsapp(r);
  if (pdfWa) line.appendChild(pdfWa);
```

par :

```javascript
  line.appendChild(company);
  line.appendChild(cellWhatsapp(r));
  line.appendChild(cellPdfSlot(r, 'devis'));
  line.appendChild(cellPdfSlot(r, 'facture'));
  line.appendChild(cellPdfSlot(r, 'bat'));
  const pdfWa = cellPdfWhatsapp(r);
  if (pdfWa) line.appendChild(pdfWa);
```

- [ ] **Step 4: Vérification visuelle**

Utiliser l'outil de preview du navigateur (`preview_start` avec `name: "olda"` — config déjà présente dans `.claude/launch.json` — puis `navigate`/`read_page`/`computer`) :
1. Ouvrir le planning, repérer une ligne existante.
2. Vérifier que 3 pastilles apparaissent maintenant dans la cellule Dossier (devis, facture, BAT), le BAT étant la dernière, dans le style neutre `pdf-btn--empty`.
3. Cliquer la pastille BAT vide → sélecteur de fichier natif s'ouvre ; sélectionner un PDF → la pastille passe en style `pdf-btn--filled`.
4. Cliquer la pastille remplie → le PDF s'ouvre dans un nouvel onglet.
5. Survoler la pastille remplie → une croix apparaît ; cliquer dessus → retour à l'état vide.
6. Vérifier qu'aucune des deux autres pastilles (devis/facture) n'a changé de comportement.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: ajoute l'icône BAT sur la ligne (upload/aperçu/suppression PDF)"
```

---

### Task 3: Side bar — squelette (CSS, ouverture/fermeture, déclencheur)

Panneau vide (en-tête seulement) pour valider la mécanique d'ouverture/fermeture et la synchronisation avant d'y ajouter du contenu. Inclut **tout** le CSS du composant (les tâches suivantes réutiliseront ces classes sans y retoucher).

**Files:**
- Modify: `public/styles.css` (ajout en fin de fichier)
- Modify: `public/app.js` (nouvelle section + hook + bouton déclencheur)

- [ ] **Step 1: Ajouter le CSS complet du tiroir en fin de `public/styles.css`**

```css

/* --- Side bar détail de ligne (planning) -----------------------------------
   Calqué sur .cl-drawer de clients.css (même recette : scrim + carte glissante
   à droite, mêmes durées/easing), mais classes dédiées : deux fonctionnalités
   indépendantes qui ne doivent pas partager leurs noms de classe. */
.ligne-drawer { position: fixed; inset: 0; z-index: 70; }
.ligne-drawer[hidden] { display: none; }
.ligne-drawer__scrim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, .42);
  animation: ldScrim var(--dur-2, .18s) var(--ease, ease) both;
}
@keyframes ldScrim { from { opacity: 0; } to { opacity: 1; } }
.ligne-drawer__card {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  width: min(468px, 100vw);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: -18px 0 48px rgba(0, 0, 0, .22);
  animation: ldSlide var(--dur-3, .24s) var(--ease, ease) both;
}
@keyframes ldSlide { from { transform: translateX(24px); opacity: .4; } to { transform: translateX(0); opacity: 1; } }

.ld-head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--border); }
.ld-head__titles { flex: 1; min-width: 0; }
.ld-head__title { margin: 0; font-size: 18px; font-weight: 600; color: var(--text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ld-head__sub { margin: 2px 0 0; font-size: 12.5px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ld-head__badges { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.ld-badge { font-size: 10.5px; padding: 3px 9px; border-radius: 999px; background: var(--border-soft); color: var(--text-2); }
.ld-close { flex-shrink: 0; display: grid; place-items: center; width: 36px; height: 36px; border: 0; background: transparent; color: var(--text-2); border-radius: 10px; cursor: pointer; }
.ld-close:hover { background: var(--state-hover); color: var(--text-1); }

.ld-body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 18px 24px; -webkit-overflow-scrolling: touch; }
.ld-section { margin: 16px 0; }
.ld-section-title { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-3); margin: 0 0 8px; }
.ld-kv { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; padding: 4px 0; color: var(--text-1); }
.ld-kv span:first-child { color: var(--text-2); }
.ld-docs { display: flex; gap: 6px; }
.ld-empty { font-size: 12.5px; color: var(--text-3); font-style: italic; }

.ld-fiche-item { padding: 8px 10px; border-radius: 8px; background: var(--border-soft); margin-bottom: 8px; }
.ld-fiche-item__title { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-1); }
.ld-fiche-item__sub { margin: 3px 0 0; font-size: 12px; color: var(--text-2); padding-left: 10px; }

.ld-notes {
  width: 100%;
  min-height: 140px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  font: inherit;
  font-size: 13.5px;
  color: var(--text-1);
  background: var(--surface);
  resize: vertical;
  box-sizing: border-box;
}
.ld-notes:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }

/* Bouton « voir détails », dans le cluster documents de la cellule Dossier. */
.ligne-detail-btn { color: var(--primary); background: color-mix(in srgb, var(--primary) 16%, transparent); }
.ligne-detail-btn:hover { background: color-mix(in srgb, var(--primary) 26%, transparent); }

@media (max-width: 720px) {
  .ligne-drawer__card { width: 100vw; }
}
```

- [ ] **Step 2: Ajouter le glyphe `detailIcon()` (chevron), à côté de `batIcon()`**

Dans `public/app.js`, juste après `batIcon()` :

```javascript
// Détail : chevron — « voir le détail complet de cette ligne ».
function detailIcon() {
  return strokeIcon(['M9 6l6 6-6 6']);
}
```

- [ ] **Step 3: Ajouter la section « Side bar détail de ligne » dans `public/app.js`**

Juste après la fin de `cellDeadline()` (ligne 1646, avant le commentaire `// --- Infobulles maison ---`), ajouter toute cette nouvelle section :

```javascript
// --- Side bar détail de ligne -----------------------------------------------
// Panneau à droite, calqué sur le tiroir de clients.js (.cl-drawer) : mêmes
// jetons CSS que la grille, classes dédiées (.ligne-drawer) pour ne pas
// mélanger deux fonctionnalités indépendantes. Une seule instance, montée au
// premier clic ; son contenu est entièrement reconstruit à chaque ouverture
// ou re-synchronisation — jamais de référence figée à un objet `r` : `rows`
// est remplacé (pas muté) à chaque poll/SSE (cf. renderRows), donc on stocke
// seulement l'id et on refait `rows.find(...)` à chaque rendu.
let ligneDrawerEl = null;
let ligneDrawerCard = null;
let ligneDrawerId = null; // id (string) de la ligne affichée, ou null si fermé

function ensureLigneDrawer() {
  if (ligneDrawerEl) return;
  ligneDrawerEl = document.createElement('div');
  ligneDrawerEl.className = 'ligne-drawer';
  ligneDrawerEl.hidden = true;
  const scrim = document.createElement('div');
  scrim.className = 'ligne-drawer__scrim';
  scrim.addEventListener('click', closeLigneDetail);
  ligneDrawerCard = document.createElement('aside');
  ligneDrawerCard.className = 'ligne-drawer__card';
  ligneDrawerCard.setAttribute('role', 'dialog');
  ligneDrawerCard.setAttribute('aria-modal', 'true');
  ligneDrawerCard.setAttribute('aria-label', 'Détail de la commande');
  ligneDrawerEl.append(scrim, ligneDrawerCard);
  document.body.appendChild(ligneDrawerEl);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ligneDrawerId) closeLigneDetail();
  });
}

function openLigneDetail(id) {
  ensureLigneDrawer();
  ligneDrawerId = String(id);
  ligneDrawerEl.hidden = false;
  renderLigneDetail();
}

function closeLigneDetail() {
  if (!ligneDrawerEl) return;
  ligneDrawerId = null;
  ligneDrawerEl.hidden = true;
}

// Rappelée après CHAQUE (re)rendu de la grille (poll, SSE, tri, sauvegarde
// locale) : la side bar se re-synchronise depuis `rows`, et se ferme si la
// ligne a quitté la vue courante (déplacée vers une autre étape, supprimée).
function renderLigneDetailIfOpen() {
  if (!ligneDrawerId) return;
  const r = rows.find((x) => String(x.id) === ligneDrawerId);
  if (!r) { closeLigneDetail(); return; }
  renderLigneDetail();
}

function renderLigneDetail() {
  const r = rows.find((x) => String(x.id) === ligneDrawerId);
  if (!r) { closeLigneDetail(); return; }
  ligneDrawerCard.replaceChildren();

  const head = document.createElement('header');
  head.className = 'ld-head';

  const titles = document.createElement('div');
  titles.className = 'ld-head__titles';
  const title = document.createElement('h2');
  title.className = 'ld-head__title';
  title.textContent = r.billing_company || r.contact_referent || '— sans dossier';
  const sub = document.createElement('p');
  sub.className = 'ld-head__sub';
  sub.textContent = r.product || '—';
  const badges = document.createElement('div');
  badges.className = 'ld-head__badges';
  const typeBadge = document.createElement('span');
  typeBadge.className = 'ld-badge';
  typeBadge.textContent = CLIENT_TYPE_LABEL[r.client_type] || CLIENT_TYPES[0].label;
  const prioBadge = document.createElement('span');
  prioBadge.className = 'ld-badge';
  prioBadge.textContent = PRIORITY_LEVELS[prioBand(r)].label;
  badges.append(typeBadge, prioBadge);
  titles.append(title, sub, badges);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ld-close';
  close.setAttribute('aria-label', 'Fermer le détail');
  close.appendChild(strokeIcon(['M18 6L6 18', 'M6 6l12 12']));
  close.addEventListener('click', closeLigneDetail);

  head.append(titles, close);
  ligneDrawerCard.appendChild(head);

  const body = document.createElement('div');
  body.className = 'ld-body';
  ligneDrawerCard.appendChild(body);
}

// Bouton « voir détails » : rejoint le cluster documents de la cellule
// Dossier. Son propre `stopPropagation` suffit — aucun handler n'est posé
// sur <tr>, donc le reste de la ligne garde exactement son comportement
// d'édition inline actuel.
function cellLigneDetailButton(r) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pdf-btn ligne-detail-btn';
  attachTip(btn, 'Voir le détail de la ligne');
  btn.setAttribute('aria-label', 'Voir le détail de la ligne');
  btn.appendChild(detailIcon());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openLigneDetail(r.id);
  });
  return btn;
}
```

- [ ] **Step 4: Brancher le hook de synchronisation dans `applySortAndRender()`**

Remplacer ([public/app.js:583-586](../../../public/app.js#L583)) :

```javascript
  lastRendered = sorted;
  renderRows(sorted);
  applySearchAndCounts();
}
```

par :

```javascript
  lastRendered = sorted;
  renderRows(sorted);
  applySearchAndCounts();
  renderLigneDetailIfOpen();
}
```

- [ ] **Step 5: Ajouter le bouton déclencheur dans `cellDossier()`**

Remplacer la ligne ajoutée à la Task 2 ([public/app.js:1234-1240](../../../public/app.js#L1234)) :

```javascript
  line.appendChild(company);
  line.appendChild(cellWhatsapp(r));
  line.appendChild(cellPdfSlot(r, 'devis'));
  line.appendChild(cellPdfSlot(r, 'facture'));
  line.appendChild(cellPdfSlot(r, 'bat'));
  const pdfWa = cellPdfWhatsapp(r);
  if (pdfWa) line.appendChild(pdfWa);
```

par :

```javascript
  line.appendChild(company);
  line.appendChild(cellWhatsapp(r));
  line.appendChild(cellPdfSlot(r, 'devis'));
  line.appendChild(cellPdfSlot(r, 'facture'));
  line.appendChild(cellPdfSlot(r, 'bat'));
  line.appendChild(cellLigneDetailButton(r));
  const pdfWa = cellPdfWhatsapp(r);
  if (pdfWa) line.appendChild(pdfWa);
```

- [ ] **Step 6: Vérification visuelle**

Via l'outil de preview navigateur :
1. Recharger le planning. Une nouvelle icône chevron (bleutée) apparaît après le BAT dans la cellule Dossier.
2. Cliquer dessus → le panneau glisse depuis la droite, scrim semi-transparent derrière, en-tête affiche le nom du dossier, le produit (`r.product`), le type et la priorité.
3. Cliquer le scrim → le panneau se ferme. Rouvrir, appuyer sur Échap → se ferme. Rouvrir, cliquer la croix → se ferme.
4. Ouvrir le détail d'une ligne, puis cliquer une AUTRE cellule de la même ligne (ex. le prix) → l'édition inline fonctionne normalement, le panneau reste inchangé (toujours ouvert sur la même ligne).
5. Redimensionner la fenêtre sous 720px de large → le panneau passe en plein écran.

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/styles.css
git commit -m "feat: squelette de la side bar détail de ligne (ouverture/fermeture)"
```

---

### Task 4: Side bar — sections Contact et Documents

**Files:**
- Modify: `public/app.js` (dans `renderLigneDetail()`, après la création de `body`)

- [ ] **Step 1: Ajouter les deux sections après `ligneDrawerCard.appendChild(body);`**

Dans `renderLigneDetail()` (ajoutée Task 3), juste avant la ligne finale `ligneDrawerCard.appendChild(body);`, insérer :

```javascript
  // --- Contact ---------------------------------------------------------------
  const contactSection = document.createElement('section');
  contactSection.className = 'ld-section';
  const contactTitle = document.createElement('p');
  contactTitle.className = 'ld-section-title';
  contactTitle.textContent = 'Contact';
  contactSection.appendChild(contactTitle);
  const contactRows = [
    ['Référent', r.contact_referent],
    ['Téléphone', r.contact_phone],
    ['Email', r.contact_email],
  ];
  let hasContact = false;
  for (const [label, value] of contactRows) {
    if (!value) continue;
    hasContact = true;
    const kv = document.createElement('div');
    kv.className = 'ld-kv';
    const k = document.createElement('span'); k.textContent = label;
    const v = document.createElement('span'); v.textContent = value;
    kv.append(k, v);
    contactSection.appendChild(kv);
  }
  if (!hasContact) {
    const empty = document.createElement('p');
    empty.className = 'ld-empty';
    empty.textContent = 'Aucun contact renseigné.';
    contactSection.appendChild(empty);
  }
  body.appendChild(contactSection);

  // --- Documents ---------------------------------------------------------------
  const docsSection = document.createElement('section');
  docsSection.className = 'ld-section';
  const docsTitle = document.createElement('p');
  docsTitle.className = 'ld-section-title';
  docsTitle.textContent = 'Documents';
  const docsRow = document.createElement('div');
  docsRow.className = 'ld-docs';
  docsRow.append(cellPdfSlot(r, 'devis'), cellPdfSlot(r, 'facture'), cellPdfSlot(r, 'bat'));
  docsSection.append(docsTitle, docsRow);
  body.appendChild(docsSection);
```

- [ ] **Step 2: Vérification visuelle**

Via l'outil de preview navigateur :
1. Ouvrir le détail d'une ligne dont le contact (référent/téléphone/email) est renseigné → les 3 lignes s'affichent.
2. Ouvrir le détail d'une ligne SANS contact renseigné → « Aucun contact renseigné. » s'affiche à la place.
3. Section Documents : les 3 mêmes pastilles que sur la ligne (devis/facture/BAT), fonctionnelles (upload/aperçu/retrait) — uploader un PDF depuis la side bar, fermer le panneau, vérifier que la pastille de la LIGNE (dans le tableau) reflète bien le nouveau fichier.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: side bar — sections Contact et Documents"
```

---

### Task 5: Side bar — section Détail produit (reconstruit depuis `fiche`)

La section la plus dense : deux formats de `fiche` à gérer (`commande-atelier` et `projet-simple`), repli silencieux si absent/inconnu.

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Ajouter les fonctions de reconstruction, avant `renderLigneDetail()`**

Juste avant la fonction `renderLigneDetail()` (ajoutée Task 3), ajouter :

```javascript
// Détail produit : reconstruit un affichage lisible depuis `r.fiche` (le JSON
// archivé à la création de la commande, jamais retouché après). Deux formats
// possibles selon le flux de création — cf. server.js buildCommande/buildProjet.
// Retourne `null` si `fiche` est absent ou d'un format non reconnu (ligne créée
// à la main dans la grille, ou ancienne fiche v1) : la section est alors
// masquée, sans erreur.
function ficheLigneEl(titre, sousLignes) {
  const box = document.createElement('div');
  box.className = 'ld-fiche-item';
  const t = document.createElement('p');
  t.className = 'ld-fiche-item__title';
  t.textContent = titre;
  box.appendChild(t);
  for (const s of sousLignes) {
    if (!s) continue;
    const p = document.createElement('p');
    p.className = 'ld-fiche-item__sub';
    p.textContent = s;
    box.appendChild(p);
  }
  return box;
}

// Flux « Commande » (tasses / textiles / objets), fiche.kind = 'commande-atelier'.
// Mêmes champs que detailLigne() côté serveur (server.js:1115-1153), rendus en
// HTML structuré plutôt qu'en texte à flèches « ↳ ».
function ficheItemsCommandeAtelier(fiche) {
  const items = [];
  for (const l of fiche.tasses || []) {
    items.push(ficheLigneEl(
      `${l.quantite} × ${l.ref}${l.couleur ? ` — ${l.couleur}` : ''}`,
      [
        ...(l.faces || []).map((f) => `${f.label} (${f.hint}) : ${f.visuel}`),
        (l.options || []).length ? l.options.map((o) => o.label).join(' · ') : null,
        l.typo ? `Typo : ${l.typo}` : null,
        l.infos || null,
        l.remarque ? `Remarque : ${l.remarque}` : null,
      ],
    ));
  }
  for (const l of fiche.textiles || []) {
    const tailleTxt = (l.tailles && l.tailles.length)
      ? l.tailles.map((t) => `${t.taille}×${t.quantite}`).join(' · ')
      : (l.taille ? `taille ${l.taille}` : '');
    const id = [l.ref && `réf. ${l.ref}`, l.couleur, tailleTxt].filter(Boolean).join(' · ');
    items.push(ficheLigneEl(
      `${l.quantite} × ${l.vetement}${id ? ` — ${id}` : ''}`,
      [
        l.note || null,
        ...(l.zones || []).map((z) => {
          const tech = z.technique === 'a_definir' ? '' : ` [${z.techniqueLabel}]`;
          const detail = [z.logo, z.couleur, z.largeur ? `${z.largeur} cm` : null].filter(Boolean).join(' · ') || z.consigne || '';
          return `${z.zoneLabel}${tech}${detail ? ` : ${detail}` : ''}`;
        }),
      ],
    ));
  }
  for (const l of fiche.objets || []) {
    items.push(ficheLigneEl(
      `${l.quantite} × ${l.ref}`,
      [l.techniqueLabel ? `${l.techniqueLabel}${l.infos ? ` : ${l.infos}` : ''}` : (l.infos || null)],
    ));
  }
  return items;
}

// Flux « Nouveau Projet » (panier multi-type), fiche.kind = 'projet-simple'.
// `l.bat` est l'option catalogue tarifée (server.js:1206, 1226) — à NE PAS
// confondre avec la pièce jointe BAT (documents) : badge texte distinct.
function ficheItemsProjetSimple(fiche) {
  return (fiche.lignes || []).map((l) => {
    if (l.produit) {
      const opts = [l.face1, l.face2, l.dessous].filter((o) => o && o.label !== 'Aucune').map((o) => o.label);
      return ficheLigneEl(
        `${l.quantite} × ${l.produit.label}${l.coloris ? ` (${l.coloris})` : ''}`,
        [
          opts.length ? opts.join(', ') : null,
          l.remarque ? `Remarque : ${l.remarque}` : null,
          l.bat ? '★ BAT inclus (option catalogue)' : null,
        ],
      );
    }
    return ficheLigneEl(`${l.quantite} × ${l.description}`, []);
  });
}

function ficheItems(fiche) {
  if (!fiche || typeof fiche !== 'object') return null;
  if (fiche.kind === 'commande-atelier') return ficheItemsCommandeAtelier(fiche);
  if (fiche.kind === 'projet-simple') return ficheItemsProjetSimple(fiche);
  return null;
}
```

- [ ] **Step 2: Insérer la section dans `renderLigneDetail()`**

Dans `renderLigneDetail()`, juste après la section Documents ajoutée à la Task 4 (donc juste avant `ligneDrawerCard.appendChild(body);`), insérer :

```javascript
  // --- Détail produit (structuré, depuis fiche) -------------------------------
  const items = ficheItems(r.fiche);
  if (items && items.length) {
    const ficheSection = document.createElement('section');
    ficheSection.className = 'ld-section';
    const ficheTitle = document.createElement('p');
    ficheTitle.className = 'ld-section-title';
    ficheTitle.textContent = 'Détail produit';
    ficheSection.appendChild(ficheTitle);
    for (const it of items) ficheSection.appendChild(it);
    body.appendChild(ficheSection);
  }
```

- [ ] **Step 3: Vérification visuelle (les 3 provenances de lignes)**

Via l'outil de preview navigateur :
1. Créer une commande via le formulaire « Commande » (onglet dédié) avec au moins une tasse ET un textile → ouvrir son détail de ligne dans le planning → la section « Détail produit » affiche un bloc par article, avec faces/zones/tailles lisibles.
2. Créer un panier via « Nouveau Projet » avec un produit catalogue (tasse) → ouvrir son détail → bloc avec coloris/faces, et si l'option BAT catalogue était cochée, le badge « ★ BAT inclus (option catalogue) » apparaît — bien distinct visuellement de la pastille BAT (documents) juste au-dessus.
3. Créer une ligne à la main dans la grille (bouton « + Ajouter ») → ouvrir son détail → section « Détail produit » **absente**, aucune erreur dans la console.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: side bar — section Détail produit reconstruite depuis fiche"
```

---

### Task 6: Side bar — section Suivi (lecture seule)

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Insérer la section dans `renderLigneDetail()`**

Juste après la section Détail produit (Task 5), avant `ligneDrawerCard.appendChild(body);`, insérer :

```javascript
  // --- Suivi -------------------------------------------------------------------
  const suiviSection = document.createElement('section');
  suiviSection.className = 'ld-section';
  const suiviTitle = document.createElement('p');
  suiviTitle.className = 'ld-section-title';
  suiviTitle.textContent = 'Suivi';
  suiviSection.appendChild(suiviTitle);

  const addSuiviKv = (label, value) => {
    const kv = document.createElement('div');
    kv.className = 'ld-kv';
    const k = document.createElement('span'); k.textContent = label;
    const v = document.createElement('span'); v.textContent = value;
    kv.append(k, v);
    suiviSection.appendChild(kv);
  };
  addSuiviKv('Prix', r.project_value != null ? `${Number(r.project_value).toFixed(2)} €` : '—');
  const dd = parseDeadline(r.deadline);
  addSuiviKv('Échéance', dd ? dd.toLocaleDateString('fr-FR') : '—');
  const subs = SUB_STAGES[r.stage];
  if (subs && subs.length) {
    addSuiviKv('Sous-étape', (r.sub_stage && SUB_LABEL[r.sub_stage]) || 'à préciser');
  }
  if (FLAG_BY_VALUE[r.flag]) {
    addSuiviKv('État', FLAG_BY_VALUE[r.flag].label + (r.flag_reason ? ` — ${r.flag_reason}` : ''));
  }
  body.appendChild(suiviSection);
```

- [ ] **Step 2: Vérification visuelle**

1. Ouvrir le détail d'une ligne avec prix, échéance, sous-étape et un flag (BLOQUÉE/À VOIR) posés → les 4 lignes s'affichent avec les mêmes libellés/valeurs que dans le tableau.
2. Ouvrir le détail d'une ligne sans sous-étape possible (famille sans sous-étapes, ex. « Termine ») → la ligne « Sous-étape » n'apparaît pas (comme la colonne du tableau, masquée dans ce cas).
3. Ouvrir le détail d'une ligne sans flag → la ligne « État » n'apparaît pas.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: side bar — section Suivi (prix, échéance, sous-étape, état)"
```

---

### Task 7: Side bar — section Notes (éditable)

Seul champ éditable depuis la side bar (décision de design n°3) : le même champ que la colonne « Infos » (`r.description`), sauvegardé avec le même mécanisme (`patchRow`), puis la ligne du tableau est resynchronisée via `invalidateRowCache` + `applySortAndRender` — qui redéclenche aussi `renderLigneDetailIfOpen()` (Task 3), donc la side bar elle-même reste cohérente.

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Insérer la section dans `renderLigneDetail()`**

Juste après la section Suivi (Task 6), avant `ligneDrawerCard.appendChild(body);`, insérer :

```javascript
  // --- Notes (= colonne Infos, éditée ici plus confortablement) ---------------
  const notesSection = document.createElement('section');
  notesSection.className = 'ld-section';
  const notesTitle = document.createElement('p');
  notesTitle.className = 'ld-section-title';
  notesTitle.textContent = 'Notes';
  const notes = document.createElement('textarea');
  notes.className = 'ld-notes';
  notes.value = r.description ?? '';
  notes.placeholder = '+ Ajouter une note';
  let lastSentNotes = r.description ?? '';
  notes.addEventListener('blur', () => {
    const val = notes.value === '' ? null : notes.value;
    if ((val ?? '') === (lastSentNotes ?? '')) return;
    const prev = r.description;
    r.description = val;
    lastSentNotes = notes.value;
    patchRow(r, { description: val })
      .then(() => { invalidateRowCache(r.id); applySortAndRender(); })
      .catch((err) => {
        r.description = prev;
        notes.value = prev ?? '';
        lastSentNotes = prev ?? '';
        reportError(err);
      });
  });
  notesSection.append(notesTitle, notes);
  body.appendChild(notesSection);
```

- [ ] **Step 2: Vérification visuelle (synchronisation table ↔ side bar)**

1. Ouvrir le détail d'une ligne, écrire un long texte dans Notes, cliquer ailleurs (blur) → fermer la side bar → la cellule Infos du tableau affiche le nouveau texte.
2. Modifier directement la cellule Infos dans le tableau (sans passer par la side bar) → rouvrir le détail de cette même ligne → la section Notes affiche le texte à jour.
3. Couper le réseau (ou simuler une erreur serveur) puis modifier Notes → un message d'erreur apparaît (mécanisme `reportError` existant) et le texte revient à sa valeur précédente.
4. Vérifier qu'éditer Notes ne referme PAS la side bar et ne perd pas le focus de façon surprenante après sauvegarde.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: side bar — section Notes éditable (= champ Infos)"
```

---

### Task 8: Vérification manuelle bout-en-bout

Dernière passe : rejoue le scénario complet de la spec, sur le serveur de preview, avant de considérer la fonctionnalité terminée.

**Files:** aucun (vérification uniquement)

- [ ] **Step 1: Suite de tests complète**

Run: `npm test`
Expected: tous les tests passent (aucune régression sur les autres fonctionnalités).

- [ ] **Step 2: Scénario complet via le navigateur de preview**

1. Icône BAT : upload, aperçu, retrait sur une ligne — toujours correct après tous les changements de cette Task list.
2. Icône « voir détails » toujours au bon endroit (cluster documents, à côté de BAT), clic ouvre la side bar.
3. Cliquer n'importe où ailleurs sur une ligne (prix, sous-étape, flag, responsable, type) pendant que la side bar est fermée ET pendant qu'elle est ouverte sur une autre ligne → édition inline toujours fonctionnelle, aucune régression.
4. Side bar complète : en-tête, Contact, Documents, Détail produit (ou absent selon la provenance), Suivi, Notes — dans cet ordre, un seul scroll vertical.
5. Dupliquer une ligne qui a un BAT attaché → le duplicata n'a pas de BAT (déjà couvert par le code existant, [public/app.js:2074](../../../public/app.js#L2074) / [public/app.js:2220](../../../public/app.js#L2220)) — non-régression à confirmer visuellement.
6. Redimensionner en dessous de 720px de large → side bar plein écran, reste utilisable.
7. Ouvrir la side bar, puis dans un AUTRE onglet/poste modifier ou déplacer cette même commande vers une autre étape → la side bar se ferme automatiquement (ou, si testé sur le même poste, forcer via `applySortAndRender()` après avoir changé `currentStage` manuellement) — confirme `renderLigneDetailIfOpen()`.

- [ ] **Step 3: Rapport final**

Si tout est vert, la fonctionnalité est prête à passer en revue (`superpowers:requesting-code-review` si applicable) puis à suivre le workflow habituel du projet (PR → merge → déploiement), selon les règles globales du dépôt.
