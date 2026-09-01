> ⚠ **DOCUMENT HISTORIQUE.** Écrit avant le 01/09/2026 et jamais relu depuis.
> Il cite des fichiers qui n'existent plus (`public/projet.js`, `public/commande.js`,
> `public/guide.js`), des tables retirées (`production_sectors`) ou des décisions
> annulées depuis. Il dit ce qu'on a pensé ce jour-là, pas ce que le code fait
> aujourd'hui : pour ça, `ARCHITECTURE.md` et `README.md` font foi.

# Nouveau Projet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new, ultra-minimal "Nouveau Projet" tab (client search/create → project type →
product + live price → save) that writes into the existing `requests`/`clients` tables, plus a
tasse pricing catalog editable from Réglages, and enriched client fields in Base clients.

**Architecture:** Backend follows the exact patterns already in `db.js`/`server.js` for
`commande-atelier`: a new `fiche.kind = 'projet-simple'` JSON on `requests`, a new
`buildProjet()` pure builder reusing `buildClient`/`buildDestination`, and a tasse price
catalog stored as JSON in `app_meta` (same pattern as `machines`). Frontend follows the
`clients.js`/`reglages.js`/`dashboard.js` pattern: a new ES module (`projet.js`) fully
JS-rendered into an empty `<section>`, lazy-loaded by `app.js` on first visit.

**Tech Stack:** Node/Express, `pg` (Postgres) with `pg-mem` fallback for local/tests, vanilla
JS ES modules (no framework, no build step), plain CSS.

---

## Reference material

- Design doc: [docs/superpowers/specs/2026-07-25-nouveau-projet-design.md](../specs/2026-07-25-nouveau-projet-design.md)
- Existing patterns to mirror:
  - `buildCommande`/`buildClient`/`buildDestination` in [server.js:1109](../../../server.js#L1109), [server.js:1003](../../../server.js#L1003), [server.js:1095](../../../server.js#L1095)
  - `getMachines`/`setMachines` app_meta pattern in [db.js:581](../../../db.js#L581)
  - Client CRUD in [server.js:577-662](../../../server.js#L577)
  - View wiring (`mountCommande`, `setViewMode`) in [public/app.js:3379-3514](../../../public/app.js#L3379)
  - `FIELDS`-driven fiche in [public/clients.js:29](../../../public/clients.js#L29)

---

### Task 1: Clients — nouvelles colonnes, nature étendue, code lisible

**Files:**
- Modify: `db.js` (migration loop, ~line 171)
- Modify: `server.js` (`CLIENT_MAX`, `validateClientField`, `POST /api/clients`, ~lines 533-626)
- Test: `test/clients.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/clients.test.js`, just before the final `console.log('✓ base clients ...')` line:

```javascript
  // 7. Champs enrichis (fiche complète) + nature étendue (pro/perso/asso/revendeur)
  //    + identifiant lisible généré côté serveur.
  const proEnrichi = await j('POST', '/api/clients', {
    entreprise: 'SARL Evelyne', raison_sociale: 'SARL EVELYNE', code_postal: '97150',
    ville: 'Saint-Martin', pays: 'Saint-Martin', secteur: 'Hôtel / Restaurant',
    referent_prenom: 'Cédric', client_type: 'revendeur',
  });
  assert.strictEqual(proEnrichi.status, 201, JSON.stringify(proEnrichi.body));
  assert.strictEqual(proEnrichi.body.raison_sociale, 'SARL EVELYNE');
  assert.strictEqual(proEnrichi.body.code_postal, '97150');
  assert.strictEqual(proEnrichi.body.secteur, 'Hôtel / Restaurant');
  assert.strictEqual(proEnrichi.body.client_type, 'revendeur', 'nature étendue acceptée');
  assert.match(proEnrichi.body.code, /^CLI-PRO-\d{4}$/, 'code lisible CLI-PRO-xxxx généré');

  const persoEnrichi = await j('POST', '/api/clients', { entreprise: 'Grégory Lacroix', client_type: 'perso' });
  assert.strictEqual(persoEnrichi.status, 201);
  assert.match(persoEnrichi.body.code, /^CLI-PERSO-\d{4}$/, 'code lisible CLI-PERSO-xxxx pour un perso');

  const assoEnrichi = await j('POST', '/api/clients', { entreprise: 'Asso Test', client_type: 'asso' });
  assert.strictEqual(assoEnrichi.status, 201, JSON.stringify(assoEnrichi.body));
  assert.strictEqual(assoEnrichi.body.client_type, 'asso');

  const natureInvalide = await j('POST', '/api/clients', { entreprise: 'X2', client_type: 'zzz' });
  assert.strictEqual(natureInvalide.status, 400);

  // Les codes s'incrémentent, jamais réutilisés (robuste aux suppressions).
  const proEnrichi2 = await j('POST', '/api/clients', { entreprise: 'Deuxième Pro', client_type: 'pro' });
  const n1 = Number.parseInt(proEnrichi.body.code.slice('CLI-PRO-'.length), 10);
  const n2 = Number.parseInt(proEnrichi2.body.code.slice('CLI-PRO-'.length), 10);
  assert.ok(n2 > n1, 'le code suivant est strictement supérieur');

  await j('DELETE', `/api/clients/${proEnrichi2.body.id}`);
  const proEnrichi3 = await j('POST', '/api/clients', { entreprise: 'Troisième Pro', client_type: 'pro' });
  const n3 = Number.parseInt(proEnrichi3.body.code.slice('CLI-PRO-'.length), 10);
  assert.ok(n3 > n2, 'le code n\'est jamais réutilisé après suppression');

```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/clients.test.js`
Expected: FAIL — `proEnrichi.body.raison_sociale` is `undefined` (column doesn't exist yet), or a
500 error inserting an unknown column.

- [ ] **Step 3: Migrate `clients` columns in `db.js`**

In `db.js`, right after the existing block that adds `client_type` (the block ending with
`await pool.query("UPDATE clients SET client_type = 'pro' WHERE client_type IS NULL");`
around line 173), add:

```javascript
  // Migration : champs enrichis de la fiche client (venus du classeur patron
  // « CRM OLDA CREATION CLIENTS ») — identifiant lisible, raison sociale,
  // adresse détaillée, secteur d'activité, référent. Tous nullable : une fiche
  // créée avant cette migration reste valide, juste incomplète.
  // Down : ALTER TABLE clients DROP COLUMN IF EXISTS <col> pour chacune.
  for (const col of ['code', 'raison_sociale', 'code_postal', 'ville', 'pays', 'secteur', 'referent_prenom']) {
    try {
      await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS ${col} text`);
    } catch (_) { /* pg-mem local : colonne déjà présente via le schéma */ }
  }
```

- [ ] **Step 4: Extend `CLIENT_TYPES` usage for clients (not just requests) in `server.js`**

In `server.js`, find (around line 533-543):

```javascript
const CLIENT_MAX = {
  entreprise: 120, nom: 80, fonction: 80, type: 60, zone: 60,
  email: 160, telephone: 40, adresse: 200,
};
const CLIENT_FIELDS = [...Object.keys(CLIENT_MAX), 'client_type'];
// La base clients ne tranche qu'entre pro et perso ; les nuances asso/revendeur
// restent au niveau de la commande (requests.client_type).
const CLIENT_NATURE = new Set(['pro', 'perso']);
```

Replace with:

```javascript
const CLIENT_MAX = {
  entreprise: 120, nom: 80, fonction: 80, type: 60, zone: 60,
  email: 160, telephone: 40, adresse: 200,
  raison_sociale: 120, code_postal: 12, ville: 80, pays: 60, secteur: 60, referent_prenom: 80,
};
const CLIENT_FIELDS = [...Object.keys(CLIENT_MAX), 'client_type'];
// La nature du client (pro/perso/asso/revendeur) partage désormais la MÊME liste
// que requests.client_type — la fiche patron distingue Professionnel/Revendeur/
// Association/Particulier (classeur « CRM OLDA CREATION CLIENTS »).
```

Then find `validateClientField` (a few lines below) and change:

```javascript
    if (s !== '' && !CLIENT_NATURE.has(s)) return { ok: false, error: `nature invalide : ${value}` };
```

to:

```javascript
    if (s !== '' && !CLIENT_TYPE_SET.has(s)) return { ok: false, error: `nature invalide : ${value}` };
```

(`CLIENT_TYPE_SET` already exists at the top of `server.js`, line 25, built from `CLIENT_TYPES`
imported from `db.js` — same set already used for `requests.client_type`.)

- [ ] **Step 5: Generate the readable client code on creation**

In `server.js`, just above `app.post('/api/clients', ...)` (around line 605), add:

```javascript
// Identifiant lisible « CLI-PRO-0007 » / « CLI-PERSO-0007 » : un repère visuel
// pour le patron (comme dans son classeur), pas un UUID. Calculé sur le plus
// haut suffixe déjà utilisé pour CE préfixe — robuste aux suppressions, jamais
// de numéro réutilisé.
const clientCodePrefix = (clientType) => (clientType === 'perso' ? 'CLI-PERSO-' : 'CLI-PRO-');
function nextClientCode(existingCodes, prefix) {
  let max = 0;
  for (const code of existingCodes) {
    if (!code || !code.startsWith(prefix)) continue;
    const n = Number.parseInt(code.slice(prefix.length), 10);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}
```

Then, inside `app.post('/api/clients', ...)`, after the existing loop that builds
`cols`/`vals`/`params` from `CLIENT_FIELDS` and before the `INSERT`, add:

```javascript
  const clientType = cols.includes('client_type') ? params[cols.indexOf('client_type')] : 'pro';
  const prefix = clientCodePrefix(clientType);
  const { rows: existingCodes } = await pool.query('SELECT code FROM clients WHERE code LIKE $1', [`${prefix}%`]);
  cols.push('code'); vals.push(`$${i++}`); params.push(nextClientCode(existingCodes.map((r) => r.code), prefix));
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node test/clients.test.js`
Expected: PASS — `✓ base clients : seed, CRUD, notes, création auto à la commande et dédoublonnage OK`

- [ ] **Step 7: Run full suite + commit**

Run: `npm test`
Expected: all `test/*.test.js` PASS.

```bash
git add db.js server.js test/clients.test.js
git commit -m "$(cat <<'EOF'
Enrichit la fiche client (raison sociale, adresse, secteur, code lisible)

Champs venus du classeur du patron (CRM OLDA CREATION CLIENTS) : la fiche
complète peut maintenant les porter, et la nature client s'aligne sur celle
déjà utilisée côté commandes (pro/perso/asso/revendeur). Un identifiant
lisible CLI-PRO-/CLI-PERSO- est généré à la création.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Catalogue tarifs tasse (app_meta) + routes API

**Files:**
- Modify: `db.js` (constants + get/set helpers + seed + exports)
- Modify: `server.js` (import + routes)
- Test: `test/tarifs-tasse.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/tarifs-tasse.test.js`:

```javascript
'use strict';

// Catalogue tarifs TASSE (réglages du patron) : produits, options face/dessous,
// BAT, avec prix d'achat / vente / temps MO / temps machine. Stocké en app_meta,
// même principe que les machines. Pré-rempli au premier démarrage avec les
// valeurs du classeur patron.

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

  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };

  // 1. Seed par défaut : 3 tasses, 6 options face, 6 options dessous, 2 BAT.
  let r = await call('GET', '/api/tarifs-tasse');
  assert.strictEqual(r.status, 200);
  const produits = r.body.filter((a) => a.categorie === 'produit');
  const faces = r.body.filter((a) => a.categorie === 'face');
  const dessous = r.body.filter((a) => a.categorie === 'dessous');
  const bat = r.body.filter((a) => a.categorie === 'bat');
  assert.strictEqual(produits.length, 3, 'trois tasses par défaut');
  assert.strictEqual(faces.length, 6, 'six options face par défaut');
  assert.strictEqual(dessous.length, 6, 'six options dessous par défaut');
  assert.strictEqual(bat.length, 2, 'BAT oui/non par défaut');
  const tasse350 = produits.find((a) => a.designation === 'Tasse Céramique 350 ml');
  assert.ok(tasse350, 'la tasse céramique 350ml est dans le seed');
  assert.strictEqual(tasse350.prixVenteTtc, 10);
  assert.strictEqual(tasse350.prixAchat, 1.78);

  // 2. Paramètres par défaut : taux horaires + TGCA du classeur.
  r = await call('GET', '/api/tarifs-tasse/parametres');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.tauxHoraireMo, 25);
  assert.strictEqual(r.body.tauxHoraireMachine, 25);
  assert.strictEqual(r.body.tgca, 0.04);

  // 3. PUT articles : remplace la liste, valide la forme, filtre les entrées vides.
  r = await call('PUT', '/api/tarifs-tasse', [
    { categorie: 'produit', designation: 'Tasse Test', prixAchat: 1, prixVenteTtc: 12, tempsMoMin: 1, tempsMachineMin: 0, actif: true },
    { categorie: 'produit', designation: '   ' },   // désignation vide → écartée
    { categorie: 'zzz', designation: 'Mauvaise catégorie' },   // catégorie invalide → écartée
  ]);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.length, 1, 'seule l\'entrée valide est conservée');
  assert.strictEqual(r.body[0].designation, 'Tasse Test');
  assert.strictEqual(r.body[0].prixVenteTtc, 12);
  assert.ok(r.body[0].id, 'un id est attribué');
  assert.strictEqual(r.body[0].actif, true);

  r = await call('GET', '/api/tarifs-tasse');
  assert.strictEqual(r.body.length, 1, 'le GET reflète le dernier PUT');

  r = await call('PUT', '/api/tarifs-tasse', { not: 'an array' });
  assert.strictEqual(r.status, 400, 'un corps non-tableau est refusé');

  // 4. PUT paramètres : bornage numérique simple.
  r = await call('PUT', '/api/tarifs-tasse/parametres', { tauxHoraireMo: 30, tauxHoraireMachine: 28, tgca: 0.05 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.tauxHoraireMo, 30);
  assert.strictEqual(r.body.tgca, 0.05);

  r = await call('PUT', '/api/tarifs-tasse/parametres', { tauxHoraireMo: 'pas un nombre' });
  assert.strictEqual(r.status, 400);

  console.log('✓ tarifs tasse : seed, GET/PUT articles et paramètres OK');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
```

Add to `package.json`'s test script implicitly by virtue of the `test/*.test.js` glob — no
change needed there.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/tarifs-tasse.test.js`
Expected: FAIL — `404` on `GET /api/tarifs-tasse` (route doesn't exist yet).

- [ ] **Step 3: Add the app_meta store to `db.js`**

In `db.js`, after the `--- Registre des MACHINES ---` block (after `setMachines`, before the
`--- Emplacements d'impression ---` section, i.e. right after line 608 `}`), add:

```javascript
// --- Catalogue TARIFS TASSE (réglages du patron) -----------------------------
// Reprend l'onglet « Tarifs & coûts » du classeur CRM TASSES OLDA : une ligne
// par tasse / option face / option dessous / BAT, avec prix d'achat, prix de
// vente TTC, temps main-d'œuvre et temps machine. Stocké en app_meta (2 clés),
// même principe que les machines — pas de table dédiée, le patron l'édite
// depuis Réglages.
const TARIFS_TASSE_CATEGORIES = new Set(['produit', 'face', 'dessous', 'bat']);

// Valeurs du classeur patron au 2026-07-25 (onglet « Tarifs & coûts »).
const DEFAULT_TARIFS_TASSE_ARTICLES = [
  { categorie: 'produit', designation: 'Tasse Céramique 350 ml', prixAchat: 1.78, prixVenteTtc: 10, tempsMoMin: 0.5, tempsMachineMin: 0 },
  { categorie: 'produit', designation: 'Tasse Expresso 180 ml', prixAchat: 0, prixVenteTtc: 7, tempsMoMin: 0.5, tempsMachineMin: 0 },
  { categorie: 'produit', designation: 'Tasse en Bois', prixAchat: 0, prixVenteTtc: 10, tempsMoMin: 0.5, tempsMachineMin: 0 },
  { categorie: 'face', designation: 'Aucune', prixAchat: 0, prixVenteTtc: 0, tempsMoMin: 0, tempsMachineMin: 0 },
  { categorie: 'face', designation: 'Logo OLDA existant', prixAchat: 0, prixVenteTtc: 6, tempsMoMin: 0, tempsMachineMin: 0 },
  { categorie: 'face', designation: 'Logo OLDA à ajouter', prixAchat: 0, prixVenteTtc: 8, tempsMoMin: 3, tempsMachineMin: 3 },
  { categorie: 'face', designation: 'Texte personnalisé simple', prixAchat: 0, prixVenteTtc: 6, tempsMoMin: 3, tempsMachineMin: 3 },
  { categorie: 'face', designation: 'Logo client vectorisé', prixAchat: 0, prixVenteTtc: 6, tempsMoMin: 3, tempsMachineMin: 3 },
  { categorie: 'face', designation: 'Logo client non vectorisé', prixAchat: 0, prixVenteTtc: 10, tempsMoMin: 5, tempsMachineMin: 3 },
  { categorie: 'face', designation: 'Création graphique OLDA', prixAchat: 0, prixVenteTtc: 10, tempsMoMin: 6, tempsMachineMin: 3 },
  { categorie: 'dessous', designation: 'Aucune', prixAchat: 0, prixVenteTtc: 0, tempsMoMin: 0, tempsMachineMin: 0 },
  { categorie: 'dessous', designation: 'Logo Client Vectorisé', prixAchat: 0, prixVenteTtc: 4, tempsMoMin: 3, tempsMachineMin: 3 },
  { categorie: 'dessous', designation: 'Logo Client Non Vectorisé', prixAchat: 0, prixVenteTtc: 5, tempsMoMin: 5, tempsMachineMin: 3 },
  { categorie: 'dessous', designation: 'Logo OLDA dessous', prixAchat: 0, prixVenteTtc: 3, tempsMoMin: 1, tempsMachineMin: 3 },
  { categorie: 'dessous', designation: 'Texte personnalisé dessous', prixAchat: 0, prixVenteTtc: 6, tempsMoMin: 3, tempsMachineMin: 3 },
  { categorie: 'dessous', designation: 'QR Code dessous', prixAchat: 0, prixVenteTtc: 5, tempsMoMin: 5, tempsMachineMin: 3 },
  { categorie: 'bat', designation: 'Oui', prixAchat: 0, prixVenteTtc: 2, tempsMoMin: 5, tempsMachineMin: 0 },
  { categorie: 'bat', designation: 'Non', prixAchat: 0, prixVenteTtc: 0, tempsMoMin: 0, tempsMachineMin: 0 },
].map((a, i) => ({ ...a, id: `seed-${i + 1}`, actif: true, position: (i + 1) * 1000 }));

const DEFAULT_TARIFS_TASSE_PARAMETRES = { tauxHoraireMo: 25, tauxHoraireMachine: 25, tgca: 0.04 };

let tarifsTasseUid = 0;

// Normalise une entrée reçue du client (défensif : édition à la main dans
// Réglages). Renvoie null si inexploitable (désignation vide ou catégorie
// inconnue).
function cleanTarifTasseArticle(a, index) {
  if (!a || typeof a !== 'object') return null;
  const designation = String(a.designation == null ? '' : a.designation).trim().slice(0, 80);
  if (!designation) return null;
  if (!TARIFS_TASSE_CATEGORIES.has(a.categorie)) return null;
  const num = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : def; };
  tarifsTasseUid += 1;
  return {
    id: typeof a.id === 'string' && a.id ? a.id : `tt-${Date.now()}-${tarifsTasseUid}`,
    categorie: a.categorie,
    designation,
    prixAchat: Math.round(num(a.prixAchat) * 100) / 100,
    prixVenteTtc: Math.round(num(a.prixVenteTtc) * 100) / 100,
    tempsMoMin: Math.round(num(a.tempsMoMin) * 10) / 10,
    tempsMachineMin: Math.round(num(a.tempsMachineMin) * 10) / 10,
    actif: a.actif !== false,
    position: Number.isFinite(Number(a.position)) ? Number(a.position) : (index + 1) * 1000,
  };
}

async function getTarifsTasseArticles() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'tarifs_tasse_articles'");
  if (!rows[0]) return DEFAULT_TARIFS_TASSE_ARTICLES.map((a) => ({ ...a }));
  try {
    const parsed = JSON.parse(rows[0].value);
    return Array.isArray(parsed) ? parsed : DEFAULT_TARIFS_TASSE_ARTICLES.map((a) => ({ ...a }));
  } catch (_) {
    return DEFAULT_TARIFS_TASSE_ARTICLES.map((a) => ({ ...a }));
  }
}

async function setTarifsTasseArticles(list) {
  const raw = Array.isArray(list) ? list : [];
  const clean = raw.map(cleanTarifTasseArticle).filter(Boolean);
  const value = JSON.stringify(clean);
  await pool.query("DELETE FROM app_meta WHERE key = 'tarifs_tasse_articles'");
  await pool.query("INSERT INTO app_meta (key, value) VALUES ('tarifs_tasse_articles', $1)", [value]);
  return clean;
}

async function getTarifsTasseParametres() {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'tarifs_tasse_parametres'");
  if (!rows[0]) return { ...DEFAULT_TARIFS_TASSE_PARAMETRES };
  try {
    const parsed = JSON.parse(rows[0].value);
    return parsed && typeof parsed === 'object' ? { ...DEFAULT_TARIFS_TASSE_PARAMETRES, ...parsed } : { ...DEFAULT_TARIFS_TASSE_PARAMETRES };
  } catch (_) {
    return { ...DEFAULT_TARIFS_TASSE_PARAMETRES };
  }
}

async function setTarifsTasseParametres(p) {
  const src = p && typeof p === 'object' ? p : {};
  const num = (v, def) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : def; };
  const clean = {
    tauxHoraireMo: num(src.tauxHoraireMo, DEFAULT_TARIFS_TASSE_PARAMETRES.tauxHoraireMo),
    tauxHoraireMachine: num(src.tauxHoraireMachine, DEFAULT_TARIFS_TASSE_PARAMETRES.tauxHoraireMachine),
    tgca: num(src.tgca, DEFAULT_TARIFS_TASSE_PARAMETRES.tgca),
  };
  const value = JSON.stringify(clean);
  await pool.query("DELETE FROM app_meta WHERE key = 'tarifs_tasse_parametres'");
  await pool.query("INSERT INTO app_meta (key, value) VALUES ('tarifs_tasse_parametres', $1)", [value]);
  return clean;
}
```

Then add these four functions + the two default constants to the `module.exports` block at the
bottom of `db.js`:

```javascript
  getTarifsTasseArticles, setTarifsTasseArticles,
  getTarifsTasseParametres, setTarifsTasseParametres,
  DEFAULT_TARIFS_TASSE_ARTICLES, DEFAULT_TARIFS_TASSE_PARAMETRES,
```

- [ ] **Step 4: Add validation note — reject non-numeric parametres body strictly**

Numeric fields already default silently via `num()` above (a non-numeric value falls back to
the current default rather than erroring) — but the test expects a `400` for
`{ tauxHoraireMo: 'pas un nombre' }`. Fix `setTarifsTasseParametres`'s caller instead: validate
in the route (Step 6 below), not in the store function (the store stays permissive/defensive,
matching `cleanMachine`'s style; the route is where user-facing 400s belong, matching how
`PUT /api/machines` validates the top-level shape before calling `setMachines`).

- [ ] **Step 5: Add routes to `server.js`**

Add `getTarifsTasseArticles, setTarifsTasseArticles, getTarifsTasseParametres,
setTarifsTasseParametres` to the destructured `require('./db')` at the top of `server.js`
(same import block as `getMachines, setMachines`).

Then, right after the existing `app.put('/api/machines', ...)` block (around line 264), add:

```javascript
// Catalogue tarifs TASSE (réglages du patron : prix + temps par produit/option).
// GET  → [ { id, categorie, designation, prixAchat, prixVenteTtc, tempsMoMin,
//            tempsMachineMin, actif, position }, ... ]
// PUT  → remplace la liste (corps = tableau), diffusé en SSE pour que Nouveau
//        Projet et Réglages voient le même catalogue partout sans recharger.
app.get('/api/tarifs-tasse', asyncH(async (req, res) => {
  res.json(await getTarifsTasseArticles());
}));

app.put('/api/tarifs-tasse', asyncH(async (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Tableau d\'articles attendu' });
  }
  const saved = await setTarifsTasseArticles(req.body);
  broadcast({ kind: 'tarifs-tasse' });
  res.json(saved);
}));

// Paramètres globaux du calcul (taux horaires MO/machine, TGCA).
app.get('/api/tarifs-tasse/parametres', asyncH(async (req, res) => {
  res.json(await getTarifsTasseParametres());
}));

app.put('/api/tarifs-tasse/parametres', asyncH(async (req, res) => {
  const body = req.body || {};
  for (const key of ['tauxHoraireMo', 'tauxHoraireMachine', 'tgca']) {
    if (key in body && !Number.isFinite(Number(body[key]))) {
      return res.status(400).json({ error: `${key} doit être numérique` });
    }
  }
  const saved = await setTarifsTasseParametres(body);
  broadcast({ kind: 'tarifs-tasse' });
  res.json(saved);
}));
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node test/tarifs-tasse.test.js`
Expected: PASS — `✓ tarifs tasse : seed, GET/PUT articles et paramètres OK`

- [ ] **Step 7: Run full suite + commit**

Run: `npm test`
Expected: all tests PASS.

```bash
git add db.js server.js test/tarifs-tasse.test.js
git commit -m "$(cat <<'EOF'
Ajoute le catalogue tarifs tasse (app_meta) + routes API

Reprend l'onglet « Tarifs & coûts » du classeur patron (3 tasses, 6 options
face, 6 options dessous, 2 BAT + taux horaires/TGCA), stocké en app_meta comme
les machines. Sert de base au calcul de prix de Nouveau Projet et sera édité
depuis Réglages.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `POST /api/projets` — calcul prix + enregistrement

**Files:**
- Modify: `server.js` (`buildProjet`, route, catalog endpoint)
- Test: `test/projet.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/projet.test.js`:

```javascript
'use strict';

// Nouveau Projet — le flux comptoir ultra-minimal : client → type → produit.
// On vérifie ici la route POST /api/projets de bout en bout : calcul du prix
// SERVEUR (jamais confiance dans un total envoyé par le client), lignes tasse
// détaillées, lignes sommaires (textile/autres/signalétique), destination,
// et création automatique du client.

const assert = require('node:assert');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

const jour = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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
    return { status: res.status, body: await res.json() };
  };

  const tarifs = (await call('GET', '/api/tarifs-tasse')).body;
  const produit = tarifs.find((a) => a.categorie === 'produit' && a.designation === 'Tasse Céramique 350 ml');
  const faceLogoAjout = tarifs.find((a) => a.categorie === 'face' && a.designation === 'Logo OLDA à ajouter');
  const faceTexte = tarifs.find((a) => a.categorie === 'face' && a.designation === 'Texte personnalisé simple');
  const dessousAucune = tarifs.find((a) => a.categorie === 'dessous' && a.designation === 'Aucune');
  const batNon = tarifs.find((a) => a.categorie === 'bat' && a.designation === 'Non');

  // 1. Une tasse, Jour J (+20%) : prix TTC = (10+8+6+0+0) × 1 × 1.20 = 28.8.
  const tasseBody = {
    kind: 'commande',
    type: 'tasse',
    client: { societe: 'Le Temps des Cerises', contact: 'Cédric', whatsapp: '0690479788', type: 'pro' },
    lignes: [{
      quantite: 1, produitId: produit.id, coloris: 'TC 01 Rouge Blanc',
      face1Id: faceLogoAjout.id, face2Id: faceTexte.id, dessousId: dessousAucune.id, batId: batNon.id,
    }],
    delai: 'jour_j',
  };
  let r = await call('POST', '/api/projets', tasseBody);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.projet.prixTotalTtc, 28.8, 'prix recalculé serveur : (10+8+6)×1.2');
  assert.strictEqual(r.body.projet.stage, 'chiffrage');
  assert.strictEqual(r.body.projet.subStage, 'a_chiffrer');
  assert.strictEqual(r.body.projet.client.societe, 'Le Temps des Cerises');
  assert.strictEqual(r.body.projet.lignes[0].produit.label, 'Tasse Céramique 350 ml');

  // Le total envoyé par le client (s'il y en avait un) est IGNORÉ : le serveur
  // recalcule toujours depuis les ids de catalogue.
  const triche = await call('POST', '/api/projets', { ...tasseBody, prixTotalTtc: 1 });
  assert.strictEqual(triche.body.projet.prixTotalTtc, 28.8, 'le total client est ignoré, jamais fait confiance');

  // 2. Deux lignes tasse dans le même projet : le total s'additionne.
  const deuxLignes = await call('POST', '/api/projets', {
    ...tasseBody,
    lignes: [
      { quantite: 2, produitId: produit.id, face1Id: dessousAucune.id === faceLogoAjout.id ? faceLogoAjout.id : faceLogoAjout.id, face2Id: dessousAucune.id, dessousId: dessousAucune.id, batId: batNon.id },
      { quantite: 1, produitId: produit.id, face1Id: dessousAucune.id, face2Id: dessousAucune.id, dessousId: dessousAucune.id, batId: batNon.id },
    ],
    delai: 'j5',
  });
  assert.strictEqual(deuxLignes.status, 201, JSON.stringify(deuxLignes.body));
  // Ligne 1 : qty 2 × (10+8+0) = 36 ; ligne 2 : qty 1 × 10 = 10 ; pas de majoration (j5) → 46.
  assert.strictEqual(deuxLignes.body.projet.prixTotalTtc, 46);

  // 3. Type textile/autres/signalétique : ligne sommaire, prix saisi à la main.
  const textile = await call('POST', '/api/projets', {
    kind: 'demande',
    type: 'textile',
    client: { societe: 'Client Textile', type: 'pro' },
    lignes: [{ quantite: 5, description: '5 polos brodés équipe', prixTtcManuel: 150 }],
    delai: 'j10',
  });
  assert.strictEqual(textile.status, 201, JSON.stringify(textile.body));
  assert.strictEqual(textile.body.projet.prixTotalTtc, 150);
  assert.strictEqual(textile.body.projet.stage, 'demande');

  // 4. Sans lignes → refusé (un projet vide n'a pas de sens).
  const vide = await call('POST', '/api/projets', { kind: 'commande', type: 'tasse', client: { societe: 'X' }, lignes: [] });
  assert.strictEqual(vide.status, 400);

  // 5. Type inconnu → refusé.
  const typeInconnu = await call('POST', '/api/projets', { kind: 'commande', type: 'zzz', client: { societe: 'X' }, lignes: [{ quantite: 1, description: 'x', prixTtcManuel: 1 }] });
  assert.strictEqual(typeInconnu.status, 400);

  // 6. Id de catalogue inconnu (tasse) → refusé, pas un crash silencieux à 0€.
  const idInconnu = await call('POST', '/api/projets', {
    kind: 'commande', type: 'tasse', client: { societe: 'X' },
    lignes: [{ quantite: 1, produitId: 'nimporte-quoi', face1Id: dessousAucune.id, face2Id: dessousAucune.id, dessousId: dessousAucune.id, batId: batNon.id }],
  });
  assert.strictEqual(idInconnu.status, 400);

  // 7. La ligne atterrit dans le planning, lisible sans ouvrir le JSON.
  const list = await (await fetch(`${base}/api/requests?stage=chiffrage`)).json();
  const row = list.find((x) => x.id === r.body.id);
  assert.ok(row, 'le projet doit apparaître à l\'étape chiffrage');
  assert.strictEqual(row.project_value, 28.8);
  assert.match(row.product, /Tasse Céramique 350 ml/);

  // 8. Le client est créé automatiquement (comme pour Commande).
  const clients = await (await fetch(`${base}/api/clients`)).json();
  assert.ok(clients.some((c) => c.entreprise === 'Le Temps des Cerises'), 'le client du projet est créé');

  console.log('✓ nouveau projet : calcul prix serveur, lignes multiples, sommaire, refus et planning OK');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/projet.test.js`
Expected: FAIL — `404` on `POST /api/projets`.

- [ ] **Step 3: Write `buildProjet` in `server.js`**

Add the four `PROJET_TYPES`, right after `const COM = CATALOG.commande;` block (near line 734,
alongside the other `COM_*_BY_ID` maps):

```javascript
// Les 4 types de projet (classeur « CRM TASSES OLDA », onglet Création Projet :
// Tasse / T-shirt / Goodies / Signalétique / Reprise Graphique / Autre, réduits
// aux 4 que le patron a validés pour Nouveau Projet). Seule la tasse a une
// grille de prix détaillée ; les autres restent sommaires (prix manuel).
const PROJET_TYPES = [
  { id: 'tasse', label: 'Tasse', detaille: true },
  { id: 'textile', label: 'Textile', detaille: false },
  { id: 'autres', label: 'Autres', detaille: false },
  { id: 'signaletique', label: 'Plaque signalétique', detaille: false },
];
const PROJET_TYPE_BY_ID = new Map(PROJET_TYPES.map((t) => [t.id, t]));
const PROJET_LIGNES_MAX = 30;
```

Then, right after `buildDestination` (after line 1105, before `function buildCommande`), add:

```javascript
// --- NOUVEAU PROJET -----------------------------------------------------------
// Le flux comptoir ultra-minimal : client → type de projet → lignes → prix.
// Contrairement à buildCommande (familles mélangées, options en chips), un
// projet a UN SEUL type, et pour la tasse chaque ligne référence des ids du
// catalogue tarifs (jamais un prix envoyé par le client — toujours recalculé
// depuis `tarifsById` chargé juste avant l'appel).

// Ligne TASSE : résout produit/face1/face2/dessous/bat depuis le catalogue.
// Renvoie { ligne, prixRevient } ou { error }.
function buildLigneTasse(raw, index, tarifsById) {
  const where = `Tasse ${index + 1}`;
  const l = raw && typeof raw === 'object' ? raw : {};
  const q = readQuantite(l.quantite, where);
  if (q.error) return { error: q.error };

  const resolve = (id, champ, categorie) => {
    if (id == null || id === '') return { article: null };
    const a = tarifsById.get(id);
    if (!a || a.categorie !== categorie) return { error: `${where} : ${champ} inconnu` };
    return { article: a };
  };
  const produit = resolve(l.produitId, 'type de tasse', 'produit');
  if (produit.error) return { error: produit.error };
  if (!produit.article) return { error: `${where} : le type de tasse est requis` };
  const face1 = resolve(l.face1Id, 'option face 1', 'face');
  if (face1.error) return { error: face1.error };
  const face2 = resolve(l.face2Id, 'option face 2', 'face');
  if (face2.error) return { error: face2.error };
  const dessous = resolve(l.dessousId, 'option dessous', 'dessous');
  if (dessous.error) return { error: dessous.error };
  const bat = resolve(l.batId, 'BAT', 'bat');
  if (bat.error) return { error: bat.error };

  const coloris = trimOrNull(l.coloris);
  if (coloris && coloris.length > TEXTE_MAX) return { error: `${where} : coloris trop long` };
  const remarque = trimOrNull(l.remarque);
  if (remarque && remarque.length > REMARQUE_MAX) return { error: `${where} : remarque trop longue` };

  const parts = [produit.article, face1.article, face2.article, dessous.article, bat.article].filter(Boolean);
  const prixUnitaireTtc = parts.reduce((s, a) => s + a.prixVenteTtc, 0);
  const prixAchatUnitaire = parts.reduce((s, a) => s + a.prixAchat, 0);
  const tempsMoUnitaire = parts.reduce((s, a) => s + a.tempsMoMin, 0);
  const tempsMachineUnitaire = parts.reduce((s, a) => s + a.tempsMachineMin, 0);

  const asRef = (a) => (a ? { id: a.id, label: a.designation, prixTtc: a.prixVenteTtc } : null);
  return {
    ligne: {
      quantite: q.quantite,
      produit: asRef(produit.article), coloris,
      face1: asRef(face1.article), face2: asRef(face2.article), dessous: asRef(dessous.article),
      bat: bat.article ? bat.article.designation === 'Oui' : false,
      remarque,
      description: null, prixTtcManuel: null,
    },
    prixLigneTtc: q.quantite * prixUnitaireTtc,
    prixRevientLigne: q.quantite * (prixAchatUnitaire + (tempsMoUnitaire / 60) * PROJET_TAUX_MO
      + (tempsMachineUnitaire / 60) * PROJET_TAUX_MACHINE),
  };
}

// Ligne SOMMAIRE (textile / autres / signalétique) : description + prix manuel.
function buildLigneSommaire(raw, index) {
  const where = `Ligne ${index + 1}`;
  const l = raw && typeof raw === 'object' ? raw : {};
  const q = readQuantite(l.quantite, where);
  if (q.error) return { error: q.error };
  const description = trimOrNull(l.description);
  if (!description) return { error: `${where} : la description est vide` };
  if (description.length > DESCRIPTION_MAX) return { error: `${where} : description trop longue` };
  const prix = Number(l.prixTtcManuel);
  if (!Number.isFinite(prix) || prix < 0) return { error: `${where} : prix TTC invalide` };

  return {
    ligne: {
      quantite: q.quantite, description, prixTtcManuel: Math.round(prix * 100) / 100,
      produit: null, coloris: null, face1: null, face2: null, dessous: null, bat: false, remarque: null,
    },
    prixLigneTtc: Math.round(prix * 100) / 100,
    prixRevientLigne: 0,
  };
}

// Variables de calcul (taux horaires, TGCA) injectées avant chaque appel à
// buildProjet — évite de faire de buildProjet une fonction async (elle reste
// pure/testable comme buildCommande), tout en lisant les tarifs réglés par le
// patron plutôt que des constantes figées dans le code.
let PROJET_TAUX_MO = 25;
let PROJET_TAUX_MACHINE = 25;
let PROJET_TGCA = 0.04;

function buildProjet(body, tarifsById) {
  const b = body && typeof body === 'object' ? body : {};

  const type = PROJET_TYPE_BY_ID.get(b.type);
  if (!type) return { error: `type de projet inconnu : ${b.type}` };

  const orderType = COM_TYPE_BY_ID.get(b.kind);
  if (!orderType) return { error: `nature inconnue : ${b.kind} (demande ou commande)` };
  const dest = buildDestination(b, orderType);
  if (dest.error) return { error: dest.error };

  const who = buildClient(b.client);
  if (who.error) return { error: who.error };
  const { client } = who;

  const rawLignes = Array.isArray(b.lignes) ? b.lignes : [];
  if (rawLignes.length === 0) return { error: 'un projet doit contenir au moins une ligne' };
  if (rawLignes.length > PROJET_LIGNES_MAX) return { error: `trop de lignes (${PROJET_LIGNES_MAX} maximum)` };

  const lignes = [];
  let prixTotalTtc = 0;
  let prixRevientTotal = 0;
  for (let i = 0; i < rawLignes.length; i += 1) {
    const built = type.detaille
      ? buildLigneTasse(rawLignes[i], i, tarifsById)
      : buildLigneSommaire(rawLignes[i], i);
    if (built.error) return { error: built.error };
    lignes.push(built.ligne);
    prixTotalTtc += built.prixLigneTtc;
    prixRevientTotal += built.prixRevientLigne;
  }

  const delaiChoisi = COM_DELAI_BY_ID.get(b.delai) || null;
  const delai = delaiChoisi || DELAI_DEFAUT;
  prixTotalTtc = prixTotalTtc * (1 + (delai.majoration || 0) / 100);
  prixTotalTtc = Math.round(prixTotalTtc * 100) / 100;

  const deadline = todayPlus(delai.jours);
  const priority = Math.min(3, Math.max(1, Number.parseInt(b.priority, 10) || 1));
  const quantite = lignes.reduce((s, l) => s + l.quantite, 0);

  const venteHt = prixTotalTtc / (1 + PROJET_TGCA);
  const margeHt = Math.round((venteHt - prixRevientTotal) * 100) / 100;

  const projet = {
    kind: 'projet-simple',
    version: 1,
    type: { id: type.id, label: type.label },
    client,
    lignes,
    delai: { id: delai.id, label: delai.label, majoration: delai.majoration || 0 },
    prixTotalTtc,
    margeHt,
    deadline,
    priority,
    stage: dest.stage,
    subStage: dest.subStage,
    quantite,
    createdAt: new Date().toISOString(),
  };

  const noms = lignes.map((l) => l.produit ? l.produit.label : l.description);
  const produitResume = lignes.length === 1
    ? `${lignes[0].quantite} × ${noms[0]}`
    : `${quantite} pièces — ${[...new Set(noms)].slice(0, 3).join(', ')}${new Set(noms).size > 3 ? '…' : ''}`;

  const detailLigneTexte = (l) => {
    if (l.produit) {
      const opts = [l.face1, l.face2, l.dessous].filter((o) => o && o.label !== 'Aucune').map((o) => o.label);
      return `${l.quantite} × ${l.produit.label}${l.coloris ? ` (${l.coloris})` : ''}${opts.length ? ` — ${opts.join(', ')}` : ''}`;
    }
    return `${l.quantite} × ${l.description}`;
  };
  const resume = [
    `${type.label.toUpperCase()} — ${client.societe}${client.type === 'perso' ? ' (perso)' : ''}`,
    ...lignes.map(detailLigneTexte),
    `Délai : ${delai.label}${delai.majoration ? ` (+${delai.majoration} %)` : ''}`,
    `Prix TTC : ${prixTotalTtc.toFixed(2)} €`,
  ].join('\n');

  return { projet, resume, produit: produitResume };
}
```

- [ ] **Step 4: Add the route**

Right after `app.post('/api/commande', ...)` (after line 1301), add:

```javascript
// POST /api/projets → crée un Nouveau Projet (comptoir ultra-minimal). Recharge
// systématiquement le catalogue tarifs + paramètres AVANT de construire, pour
// ne jamais calculer avec des prix périmés.
app.post('/api/projets', asyncH(async (req, res) => {
  const [articles, parametres] = await Promise.all([getTarifsTasseArticles(), getTarifsTasseParametres()]);
  PROJET_TAUX_MO = parametres.tauxHoraireMo;
  PROJET_TAUX_MACHINE = parametres.tauxHoraireMachine;
  PROJET_TGCA = parametres.tgca;
  const tarifsById = new Map(articles.filter((a) => a.actif).map((a) => [a.id, a]));

  const built = buildProjet(req.body || {}, tarifsById);
  if (built.error) return res.status(400).json({ error: built.error });
  const { projet, resume, produit } = built;

  const { rows: posRows } = await pool.query(
    'SELECT COALESCE(MAX(position), 0) + 1000 AS pos FROM requests WHERE stage = $1', [projet.stage],
  );

  const { rows } = await pool.query(
    `INSERT INTO requests
       (stage, sub_stage, order_kind, priority, client_type, billing_company, contact_referent,
        contact_phone, contact_email, quantity, product, description, deadline, position, fiche, project_value)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      projet.stage, projet.subStage, 'commande', projet.priority, projet.client.type,
      projet.client.societe, projet.client.contact, projet.client.telephone, projet.client.email,
      projet.quantite, produit, resume, projet.deadline, posRows[0].pos,
      JSON.stringify(projet), projet.prixTotalTtc,
    ],
  );

  await upsertClientFromCommande(projet.client);

  broadcast({ kind: 'create', stages: [projet.stage] });
  res.status(201).json({ id: rows[0].id, projet });
}));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node test/projet.test.js`
Expected: PASS — `✓ nouveau projet : calcul prix serveur, lignes multiples, sommaire, refus et planning OK`

- [ ] **Step 6: Run full suite + commit**

Run: `npm test`
Expected: all tests PASS.

```bash
git add server.js test/projet.test.js
git commit -m "$(cat <<'EOF'
Ajoute POST /api/projets — calcul prix serveur pour Nouveau Projet

buildProjet() recalcule toujours le prix depuis les ids de catalogue tarifs
tasse (jamais confiance dans un total envoyé par le client), gère les lignes
sommaires pour textile/autres/signalétique, et réutilise buildClient /
buildDestination / upsertClientFromCommande déjà éprouvés par Commande.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Squelette du nouvel onglet (nav + montage du module)

**Files:**
- Modify: `public/index.html`
- Create: `public/projet.css`
- Create: `public/projet.js`
- Modify: `public/app.js`

- [ ] **Step 1: Add the stylesheet link + nav button + empty section in `index.html`**

In `<head>`, right after `<link rel="stylesheet" href="clients.css" />` (line 27), add:

```html
  <link rel="stylesheet" href="projet.css" />
```

In `<nav class="nav-switch" ...>`, as the very FIRST child (before `viewDemande`), add:

```html
        <a class="nav-switch-btn nav-switch-btn--projet" id="viewProjet" href="#nouveau-projet">
          <span class="material-symbols-outlined" aria-hidden="true">bolt</span>
          <span class="nav-switch-label">Nouveau Projet</span>
        </a>
```

Right after the `</section>` that closes `<section class="cmd" id="commande" ...>` (the closing
tag right before `</main>`, i.e. right after the existing Prise de commande section), add the
new empty section — fully JS-rendered, same pattern as `#clients`/`#reglages`:

```html
        <!-- Onglet Nouveau Projet : LE flux comptoir (client → type → produit →
             prix), ultra-minimal, façon caisse. Entièrement rendu par JS
             (projet.js, chargé au premier affichage) — même principe que
             Base clients / Réglages. -->
        <section class="proj" id="nouveau-projet" hidden aria-label="Nouveau projet"></section>
```

- [ ] **Step 2: Create `public/projet.css` (empty shell, filled in later tasks)**

```css
/* Nouveau Projet — Atelier OLDA
   Flux comptoir ultra-minimal : client → type → produit → prix. Rempli au fil
   des tâches suivantes (page client, tuiles type, panier tasse, réglages). */
```

- [ ] **Step 3: Create `public/projet.js` (mount only, pages added in later tasks)**

```javascript
// Nouveau Projet — Atelier OLDA
// LE flux comptoir : client (recherche/création) → type de projet → produit +
// prix, façon caisse SumUp. Rendu entièrement par JS dans une section vide
// (même principe que clients.js / reglages.js), chargé à la demande par app.js.

let ROOT = null;
const $ = (sel) => ROOT.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const ic = (name, cls) => {
  const n = el('span', `material-symbols-outlined${cls ? ` ${cls}` : ''}`, name);
  n.setAttribute('aria-hidden', 'true');
  return n;
};

// --- État --------------------------------------------------------------------
// `page` pilote QUEL écran est affiché : 'client' | 'type' | 'produit'.
const state = {
  page: 'client',
  client: null,          // { id, entreprise/nom, type: 'pro'|'perso', ... } choisi ou créé
  type: null,            // 'tasse' | 'textile' | 'autres' | 'signaletique'
};

let CLIENTS = [];
let TARIFS = [];

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
  return data;
}

function render() {
  const body = $('#proj-body');
  if (!body) return;
  body.replaceChildren(el('p', 'proj-todo', `Page « ${state.page} » — à venir dans les prochaines tâches.`));
}

function buildStatic() {
  const page = el('div', 'proj-page');
  const head = el('header', 'proj-bar');
  head.append(ic('bolt', 'proj-bar__ic'));
  const titles = el('div', 'proj-bar__titles');
  titles.append(el('h2', 'proj-bar__title', 'Nouveau Projet'), el('p', 'proj-bar__sub', 'Client → type → produit'));
  head.append(titles);
  page.append(head, el('div', 'proj-body', ''));
  ROOT.replaceChildren(page);
  // `proj-body` doit être identifiable par id pour `render()` — on le pose après coup.
  ROOT.querySelector('.proj-body').id = 'proj-body';
}

let mounted = false;
export async function initProjet(root) {
  if (mounted) return;
  ROOT = root;
  mounted = true;
  buildStatic();
  try {
    [CLIENTS, TARIFS] = await Promise.all([api('GET', '/api/clients'), api('GET', '/api/tarifs-tasse')]);
  } catch (_) { /* silencieux : les pages suivantes gèrent une liste vide */ }
  render();
}
```

- [ ] **Step 4: Wire the module + view mode in `public/app.js`**

Right after the block defining `$reglages` (around line 3331), add:

```javascript
const $viewProjet = document.getElementById('viewProjet');
const $projet = document.getElementById('nouveau-projet');
```

Right after `mountReglages()`'s closing `}` (around line 3433), add:

```javascript
// Nouveau Projet : même principe que Base clients / Réglages (module lourd,
// chargé au premier passage, monté une bonne fois).
let projetLoading = null;
let projetModule = null;
function mountProjet() {
  if (!$projet) return;
  if (!projetLoading) {
    projetLoading = import('./projet.js')
      .then((m) => { projetModule = m; return m.initProjet($projet); })
      .catch((err) => {
        projetLoading = null;
        projetModule = null;
        console.error('Nouveau Projet : chargement impossible', err);
      });
  }
}
```

In `setViewMode(mode)`, add the toggle alongside the existing ones (near
`if ($viewReglages) $viewReglages.classList.toggle('active', mode === 'reglages');`):

```javascript
  if ($viewProjet) $viewProjet.classList.toggle('active', mode === 'projet');
```

and alongside `const reglages = mode === 'reglages';` / `if ($reglages) $reglages.hidden = !reglages;`:

```javascript
  const projet = mode === 'projet';
  if ($projet) $projet.hidden = !projet;
```

and alongside `if (reglages) mountReglages();`:

```javascript
  if (projet) mountProjet();
```

Finally, in the `VIEWS` map, add the new hash:

```javascript
const VIEWS = {
  '#dashboard': 'dashboard', '#demande': 'commande', '#commande': 'commande',
  '#nouveau-projet': 'projet',
  '#clients': 'clients', '#reglages': 'reglages',
  ...Object.fromEntries(PROMOTED.map((p) => [p.hash, p.view])),
};
```

- [ ] **Step 5: Add the nav button styling in `public/styles.css`**

Right after the `.nav-switch-btn--intake` block and its `#viewCommande` filet rule (around line
2491), add:

```css
/* « Nouveau Projet » est LA feature principale de l'outil : rempli d'un aplat
   de couleur, pas juste teinté, pour qu'il saute aux yeux avant tout le reste
   de la barre — le geste qu'on fait le plus souvent doit être le plus visible. */
.nav-switch-btn--projet {
  background: var(--primary);
  color: #fff;
  margin-right: 6px;
  padding-right: 14px;
  border-right: 1px solid var(--border-soft);
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.nav-switch-btn--projet .material-symbols-outlined { color: #fff; }
.nav-switch-btn--projet:hover { background: var(--primary); filter: brightness(1.08); color: #fff; }
.nav-switch-btn--projet.active { background: var(--primary); color: #fff; }
```

- [ ] **Step 6: Verify in browser**

Run: `node server.js` (or use the preview tool), open the app, click « Nouveau Projet » in the
top nav.
Expected: the tab activates (filled accent button), URL becomes `#nouveau-projet`, and the
panel shows "Page « client » — à venir dans les prochaines tâches." with no console errors.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/projet.css public/projet.js public/app.js public/styles.css
git commit -m "$(cat <<'EOF'
Ajoute le squelette de l'onglet Nouveau Projet

Nouvelle entrée de nav (bouton plein, en tête de barre — la feature
principale), section vide rendue par un nouveau module projet.js, monté à la
demande comme Base clients / Réglages. Les pages du wizard arrivent dans les
tâches suivantes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Page 1 — Client (recherche + création rapide)

**Files:**
- Modify: `public/projet.js`
- Modify: `public/projet.css`

- [ ] **Step 1: Replace the placeholder `render()` with a page dispatcher, and implement the client page**

In `public/projet.js`, replace the `function render() { ... }` stub with:

```javascript
function render() {
  const body = $('#proj-body');
  if (!body) return;
  if (state.page === 'client') return renderClientPage(body);
  if (state.page === 'type') return renderTypePage(body);
  return renderProduitPage(body);
}

const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function clientLabel(c) {
  return c.client_type === 'perso' ? [c.nom].filter(Boolean).join(' ') || c.entreprise : c.entreprise;
}

function matchClients(query) {
  const q = fold(query).trim();
  if (!q) return [];
  return CLIENTS.filter((c) => fold(clientLabel(c)).includes(q) || fold(c.telephone).includes(q))
    .slice(0, 8);
}

function goToClient(client) {
  state.client = client;
  state.page = 'type';
  render();
}

function renderClientPage(body) {
  body.replaceChildren();
  const wrap = el('div', 'proj-client');
  wrap.append(el('h3', 'proj-step__title', 'Quel client ?'));

  const searchRow = el('div', 'proj-client__row');
  const searchWrap = el('div', 'proj-search');
  searchWrap.append(ic('search', 'proj-search__ic'));
  const input = el('input', 'proj-search__input');
  input.type = 'text';
  input.placeholder = 'Nom, société ou téléphone…';
  input.autocomplete = 'off';
  searchWrap.append(input);
  searchRow.append(searchWrap);

  const newBtn = el('button', 'proj-btn proj-btn--ghost');
  newBtn.type = 'button';
  newBtn.append(ic('person_add'), el('span', null, 'Nouveau client'));
  searchRow.append(newBtn);
  wrap.append(searchRow);

  const results = el('div', 'proj-client__results');
  wrap.append(results);

  const quickForm = el('div', 'proj-quick');
  quickForm.hidden = true;
  wrap.append(quickForm);

  const renderResults = () => {
    results.replaceChildren();
    for (const c of matchClients(input.value)) {
      const item = el('button', 'proj-client__item');
      item.type = 'button';
      item.append(
        el('span', 'proj-client__name', clientLabel(c)),
        el('span', 'proj-client__meta', [c.telephone, c.type].filter(Boolean).join(' · ')),
      );
      item.addEventListener('click', () => goToClient({
        id: c.id, entreprise: c.entreprise, nom: c.nom, telephone: c.telephone,
        email: c.email, type: c.client_type === 'perso' ? 'perso' : 'pro',
      }));
      results.appendChild(item);
    }
  };
  input.addEventListener('input', renderResults);

  const renderQuickForm = (nature) => {
    quickForm.hidden = false;
    quickForm.replaceChildren();
    const seg = el('div', 'proj-seg');
    for (const n of [{ id: 'pro', label: 'Pro' }, { id: 'perso', label: 'Perso' }]) {
      const b = el('button', `proj-seg__btn${n.id === nature ? ' is-on' : ''}`, n.label);
      b.type = 'button';
      b.addEventListener('click', () => renderQuickForm(n.id));
      seg.appendChild(b);
    }
    quickForm.appendChild(seg);

    const nameField = el('input', 'proj-input');
    nameField.placeholder = nature === 'perso' ? 'Prénom Nom' : 'Nom de facturation';
    const phoneField = el('input', 'proj-input');
    phoneField.placeholder = 'WhatsApp';
    phoneField.type = 'tel';
    quickForm.append(nameField, phoneField);

    const createBtn = el('button', 'proj-btn proj-btn--primary', 'Créer et continuer');
    createBtn.type = 'button';
    createBtn.addEventListener('click', async () => {
      const nom = nameField.value.trim();
      if (!nom) { nameField.focus(); return; }
      createBtn.disabled = true;
      try {
        const draft = nature === 'perso'
          ? { entreprise: nom, nom, client_type: 'perso', telephone: phoneField.value.trim() }
          : { entreprise: nom, client_type: 'pro', telephone: phoneField.value.trim() };
        const created = await api('POST', '/api/clients', draft);
        CLIENTS.push(created);
        goToClient({
          id: created.id, entreprise: created.entreprise, nom: created.nom,
          telephone: created.telephone, email: created.email, type: nature,
        });
      } catch (err) {
        createBtn.disabled = false;
        window.alert(err.message || 'Création impossible');
      }
    });
    quickForm.appendChild(createBtn);
    nameField.focus();
  };
  newBtn.addEventListener('click', () => renderQuickForm('pro'));

  body.appendChild(wrap);
  input.focus();
}
```

- [ ] **Step 2: Stub `renderTypePage`/`renderProduitPage` so the page dispatcher doesn't crash**

```javascript
function renderTypePage(body) {
  body.replaceChildren(el('p', 'proj-todo', `Client choisi : ${state.client ? clientLabel({ entreprise: state.client.entreprise, nom: state.client.nom, client_type: state.client.type }) : '—'}. Page type — tâche suivante.`));
}
function renderProduitPage(body) {
  body.replaceChildren(el('p', 'proj-todo', 'Page produit — tâche suivante.'));
}
```

- [ ] **Step 3: Basic styles in `public/projet.css`**

```css
.proj-page { display: flex; flex-direction: column; height: 100%; }
.proj-bar { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border-soft); }
.proj-bar__ic { font-size: 22px; color: var(--primary); }
.proj-bar__title { margin: 0; font-size: 17px; font-weight: 700; }
.proj-bar__sub { margin: 0; font-size: 13px; color: var(--text-2); }
.proj-body { flex: 1; overflow-y: auto; padding: 20px; max-width: 640px; margin: 0 auto; width: 100%; }
.proj-step__title { margin: 0 0 16px; font-size: 20px; font-weight: 700; }

.proj-client__row { display: flex; gap: 10px; margin-bottom: 14px; }
.proj-search { flex: 1; display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: var(--radius); padding: 0 12px; background: var(--surface); }
.proj-search__ic { color: var(--text-2); font-size: 20px; }
.proj-search__input { flex: 1; border: 0; background: transparent; padding: 14px 0; font: inherit; font-size: 16px; color: var(--text-1); outline: none; }
.proj-client__results { display: flex; flex-direction: column; gap: 6px; }
.proj-client__item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 12px 14px; min-height: 44px; border: 1px solid var(--border-soft); border-radius: var(--radius); background: var(--surface); cursor: pointer; text-align: left; }
.proj-client__item:hover { background: var(--surface-hover); }
.proj-client__name { font-weight: 600; font-size: 15px; color: var(--text-1); }
.proj-client__meta { font-size: 12.5px; color: var(--text-2); }

.proj-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text-1); font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; }
.proj-btn--ghost { color: var(--primary); border-color: var(--primary-soft); }
.proj-btn--primary { background: var(--primary); border-color: var(--primary); color: #fff; }
.proj-btn:disabled { opacity: .6; cursor: default; }

.proj-quick { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; padding: 14px; border: 1px dashed var(--border); border-radius: var(--radius); align-items: center; }
.proj-input { flex: 1 1 180px; min-height: 44px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--radius); font: inherit; font-size: 16px; background: var(--surface); color: var(--text-1); }
.proj-seg { display: flex; gap: 4px; border: 1px solid var(--border); border-radius: var(--radius); padding: 3px; }
.proj-seg__btn { min-height: 38px; padding: 0 14px; border: 0; border-radius: calc(var(--radius) - 3px); background: transparent; font: inherit; font-weight: 600; cursor: pointer; color: var(--text-2); }
.proj-seg__btn.is-on { background: var(--primary-soft); color: var(--primary); }

.proj-todo { color: var(--text-2); font-style: italic; }
```

- [ ] **Step 4: Verify in browser**

Open `#nouveau-projet`. Type a known client's name (e.g. one from the seed) into the search
box → a result appears → click it → the placeholder page shows the chosen client's name.
Then reload, click « Nouveau client » → fill Pro/Perso + name → « Créer et continuer » → new
client appears in Base clients (`#clients`) after switching tabs.

- [ ] **Step 5: Commit**

```bash
git add public/projet.js public/projet.css
git commit -m "$(cat <<'EOF'
Nouveau Projet — page 1 : recherche/création client

Recherche live sur la base clients existante, ou création rapide (Pro/Perso +
nom + WhatsApp) qui enchaîne directement sur la suite — les champs enrichis de
la fiche complète restent réservés à Base clients.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Page 2 — Type de projet (tuiles)

**Files:**
- Modify: `public/projet.js`
- Modify: `public/projet.css`

- [ ] **Step 1: Replace `renderTypePage` stub**

```javascript
const TYPES = [
  { id: 'tasse', label: 'Tasse', icon: 'local_cafe' },
  { id: 'textile', label: 'Textile', icon: 'checkroom' },
  { id: 'autres', label: 'Autres', icon: 'category' },
  { id: 'signaletique', label: 'Plaque signalétique', icon: 'signpost' },
];

function goToType(typeId) {
  state.type = typeId;
  state.lignes = [];
  state.page = 'produit';
  render();
}

function renderTypePage(body) {
  body.replaceChildren();
  const wrap = el('div', 'proj-type');
  const back = el('button', 'proj-back', '← Changer de client');
  back.type = 'button';
  back.addEventListener('click', () => { state.page = 'client'; render(); });
  wrap.append(back);
  wrap.append(el('h3', 'proj-step__title', `${clientLabel({ entreprise: state.client.entreprise, nom: state.client.nom, client_type: state.client.type })} — Quel type de projet ?`));

  const grid = el('div', 'proj-type__grid');
  for (const t of TYPES) {
    const tile = el('button', 'proj-tile');
    tile.type = 'button';
    tile.append(ic(t.icon, 'proj-tile__ic'), el('span', 'proj-tile__label', t.label));
    tile.addEventListener('click', () => goToType(t.id));
    grid.appendChild(tile);
  }
  wrap.append(grid);
  body.appendChild(wrap);
}
```

- [ ] **Step 2: Update `renderProduitPage` stub to reflect the chosen type (still a stub)**

```javascript
function renderProduitPage(body) {
  body.replaceChildren(el('p', 'proj-todo', `Type choisi : ${state.type}. Page produit — tâche suivante.`));
}
```

- [ ] **Step 3: Styles**

Append to `public/projet.css`:

```css
.proj-back { align-self: flex-start; margin-bottom: 10px; border: 0; background: none; color: var(--text-2); font: inherit; font-size: 13px; cursor: pointer; padding: 6px 0; }
.proj-back:hover { color: var(--primary); }
.proj-type__grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
@media (min-width: 560px) { .proj-type__grid { grid-template-columns: repeat(4, 1fr); } }
.proj-tile { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 28px 12px; min-height: 120px; border: 1px solid var(--border); border-radius: calc(var(--radius) + 4px); background: var(--surface); cursor: pointer; }
.proj-tile:hover { background: var(--surface-hover); border-color: var(--primary-soft); }
.proj-tile__ic { font-size: 34px; color: var(--primary); }
.proj-tile__label { font-weight: 700; font-size: 14px; text-align: center; color: var(--text-1); }
```

- [ ] **Step 4: Verify in browser**

Pick a client → 4 tiles appear → tapping one shows "Type choisi : <id>" → "← Changer de client"
returns to page 1 with the search cleared.

- [ ] **Step 5: Commit**

```bash
git add public/projet.js public/projet.css
git commit -m "$(cat <<'EOF'
Nouveau Projet — page 2 : tuiles type de projet

Tasse / Textile / Autres / Plaque signalétique, un tap = on avance direct
(pas de bouton suivant), façon caisse.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Page 3 — Tasse (config + prix live + marge)

**Files:**
- Modify: `public/projet.js`
- Modify: `public/projet.css`

- [ ] **Step 1: Add tasse line state helpers + price calc (mirrors server `buildLigneTasse`)**

```javascript
function tarifsByCat(cat) { return TARIFS.filter((t) => t.categorie === cat && t.actif); }

function newTasseLigne() {
  return {
    uid: Math.random().toString(36).slice(2), quantite: 1,
    produitId: '', coloris: '', face1Id: '', face2Id: '', dessousId: '', batId: '', remarque: '',
  };
}

function tarifById(id) { return TARIFS.find((t) => t.id === id); }

function calcLigneTasseTtc(l) {
  const ids = [l.produitId, l.face1Id, l.face2Id, l.dessousId, l.batId];
  const total = ids.reduce((s, id) => { const a = tarifById(id); return s + (a ? a.prixVenteTtc : 0); }, 0);
  return (Number(l.quantite) || 0) * total;
}
function calcLigneTasseRevient(l, params) {
  const ids = [l.produitId, l.face1Id, l.face2Id, l.dessousId, l.batId];
  let achat = 0, moMin = 0, machineMin = 0;
  for (const id of ids) {
    const a = tarifById(id);
    if (!a) continue;
    achat += a.prixAchat; moMin += a.tempsMoMin; machineMin += a.tempsMachineMin;
  }
  const q = Number(l.quantite) || 0;
  return q * (achat + (moMin / 60) * params.tauxHoraireMo + (machineMin / 60) * params.tauxHoraireMachine);
}

const DELAIS = [
  { id: 'jour_j', label: 'Jour J', majoration: 20 },
  { id: 'express', label: 'Sous 3 jours', majoration: 10 },
  { id: 'j5', label: '5 jours', majoration: 0 },
  { id: 'j10', label: '10 jours', majoration: 0 },
  { id: 'j15', label: '15 jours', majoration: 0 },
];
let TARIFS_PARAMS = { tauxHoraireMo: 25, tauxHoraireMachine: 25, tgca: 0.04 };
```

- [ ] **Step 2: Extend `state` and load params on mount**

In `public/projet.js`, replace the `state` object declared in Task 4 (`{ page: 'client',
client: null, type: null }`) with:

```javascript
const state = {
  page: 'client',
  client: null,
  type: null,
  lignes: [],
  delai: 'j5',
  paiement: 'non_paye',
  margeVisible: false,
};
```

In `initProjet`, extend the `Promise.all` to also fetch tarifs parametres:

```javascript
  try {
    [CLIENTS, TARIFS, TARIFS_PARAMS] = await Promise.all([
      api('GET', '/api/clients'), api('GET', '/api/tarifs-tasse'), api('GET', '/api/tarifs-tasse/parametres'),
    ]);
  } catch (_) { /* silencieux : les pages suivantes gèrent une liste vide */ }
```

(Adjust the `let CLIENTS = []; let TARIFS = [];` declaration above to also declare
`let TARIFS_PARAMS = { tauxHoraireMo: 25, tauxHoraireMachine: 25, tgca: 0.04 };` — remove the
duplicate declared in Step 1 if written twice; keep exactly one.)

- [ ] **Step 3: Implement the tasse branch of `renderProduitPage`**

Replace `renderProduitPage` with a dispatcher + the tasse UI:

```javascript
function renderProduitPage(body) {
  if (!state.lignes.length && state.type === 'tasse') state.lignes.push(newTasseLigne());
  if (!state.lignes.length && state.type !== 'tasse') state.lignes.push({ uid: Math.random().toString(36).slice(2), quantite: 1, description: '', prixTtcManuel: '' });
  return state.type === 'tasse' ? renderTasseProduit(body) : renderSommaireProduit(body);
}

function totalTtc() {
  const base = state.type === 'tasse'
    ? state.lignes.reduce((s, l) => s + calcLigneTasseTtc(l), 0)
    : state.lignes.reduce((s, l) => s + (Number(l.prixTtcManuel) || 0), 0);
  const delai = DELAIS.find((d) => d.id === state.delai) || DELAIS[2];
  return Math.round(base * (1 + delai.majoration / 100) * 100) / 100;
}
function totalRevient() {
  if (state.type !== 'tasse') return 0;
  return state.lignes.reduce((s, l) => s + calcLigneTasseRevient(l, TARIFS_PARAMS), 0);
}

function selectField(value, onChange, options, placeholder) {
  const select = el('select', 'proj-select');
  const empty = el('option', null, placeholder);
  empty.value = '';
  select.appendChild(empty);
  for (const o of options) {
    const opt = el('option', null, `${o.designation}${o.prixVenteTtc ? ` (+${o.prixVenteTtc.toFixed(2)} €)` : ''}`);
    opt.value = o.id;
    if (o.id === value) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function renderTasseLigne(l, index) {
  const card = el('div', 'proj-ligne');
  const row1 = el('div', 'proj-ligne__row');
  const qty = el('input', 'proj-qty');
  qty.type = 'number'; qty.min = '1'; qty.inputMode = 'numeric'; qty.value = String(l.quantite);
  qty.addEventListener('input', () => { l.quantite = Math.max(1, Number.parseInt(qty.value, 10) || 1); renderCurrentPage(); });
  row1.append(qty, selectField(l.produitId, (v) => { l.produitId = v; renderCurrentPage(); }, tarifsByCat('produit'), 'Type de tasse…'));
  const coloris = el('input', 'proj-input proj-input--sm');
  coloris.placeholder = 'Coloris';
  coloris.value = l.coloris;
  coloris.addEventListener('input', () => { l.coloris = coloris.value; });
  row1.append(coloris);
  if (state.lignes.length > 1) {
    const rm = el('button', 'proj-ligne__del');
    rm.type = 'button';
    rm.append(ic('close'));
    rm.addEventListener('click', () => { state.lignes.splice(index, 1); renderCurrentPage(); });
    row1.append(rm);
  }
  card.append(row1);

  const row2 = el('div', 'proj-ligne__row');
  row2.append(
    selectField(l.face1Id, (v) => { l.face1Id = v; renderCurrentPage(); }, tarifsByCat('face'), 'Face 1 (anse à droite)…'),
    selectField(l.face2Id, (v) => { l.face2Id = v; renderCurrentPage(); }, tarifsByCat('face'), 'Face 2 (anse à gauche)…'),
  );
  card.append(row2);

  const row3 = el('div', 'proj-ligne__row');
  row3.append(
    selectField(l.dessousId, (v) => { l.dessousId = v; renderCurrentPage(); }, tarifsByCat('dessous'), 'Dessous…'),
    selectField(l.batId, (v) => { l.batId = v; renderCurrentPage(); }, tarifsByCat('bat'), 'BAT avant production…'),
  );
  card.append(row3);

  const prix = el('div', 'proj-ligne__prix', `${calcLigneTasseTtc(l).toFixed(2)} €`);
  card.append(prix);
  return card;
}

function renderTasseProduit(body) {
  body.replaceChildren();
  const wrap = el('div', 'proj-produit');
  const back = el('button', 'proj-back', '← Changer de type');
  back.type = 'button';
  back.addEventListener('click', () => { state.page = 'type'; render(); });
  wrap.append(back, el('h3', 'proj-step__title', 'Tasse — configuration'));

  const list = el('div', 'proj-lignes');
  state.lignes.forEach((l, i) => list.appendChild(renderTasseLigne(l, i)));
  wrap.append(list);

  const addBtn = el('button', 'proj-btn proj-btn--ghost', '');
  addBtn.type = 'button';
  addBtn.append(ic('add'), el('span', null, 'Ajouter une autre tasse'));
  addBtn.addEventListener('click', () => { state.lignes.push(newTasseLigne()); renderCurrentPage(); });
  wrap.append(addBtn);

  wrap.append(renderDelaiPaiement());
  wrap.append(renderTotalBar());

  body.appendChild(wrap);
}

// Ré-affiche la page courante SANS reconstruire tout `state` (les selects
// perdent le focus de toute façon à chaque frappe de select — acceptable ici,
// contrairement à un champ texte où on isolerait le repaint).
function renderCurrentPage() { render(); }

function renderDelaiPaiement() {
  const box = el('div', 'proj-delai');
  box.append(el('span', 'proj-delai__label', 'Pour le'));
  const chips = el('div', 'proj-chips');
  for (const d of DELAIS) {
    const chip = el('button', `proj-chip${d.id === state.delai ? ' is-on' : ''}`, d.label);
    chip.type = 'button';
    chip.addEventListener('click', () => { state.delai = d.id; renderCurrentPage(); });
    chips.appendChild(chip);
  }
  box.append(chips);
  return box;
}

function renderTotalBar() {
  const bar = el('div', 'proj-total');
  const margeBtn = el('button', 'proj-marge-toggle');
  margeBtn.type = 'button';
  margeBtn.append(ic('visibility', 'proj-marge-toggle__ic'), el('span', null, 'Voir marge'));
  margeBtn.addEventListener('click', () => { state.margeVisible = !state.margeVisible; renderCurrentPage(); });
  bar.append(margeBtn);

  if (state.margeVisible && state.type === 'tasse') {
    const venteHt = totalTtc() / (1 + TARIFS_PARAMS.tgca);
    const marge = Math.round((venteHt - totalRevient()) * 100) / 100;
    const margeBox = el('div', 'proj-marge');
    margeBox.append(
      el('span', null, `Prix de revient : ${totalRevient().toFixed(2)} €`),
      el('span', null, `Marge HT : ${marge.toFixed(2)} €`),
    );
    bar.append(margeBox);
  }

  bar.append(el('span', 'proj-total__label', 'Total TTC'));
  bar.append(el('span', 'proj-total__value', `${totalTtc().toFixed(2)} €`));

  const saveBtn = el('button', 'proj-btn proj-btn--primary proj-btn--save', 'Enregistrer');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', () => window.alert('Destination + enregistrement : tâche suivante.'));
  bar.append(saveBtn);
  return bar;
}
```

- [ ] **Step 2: Stub `renderSommaireProduit` so the dispatcher doesn't crash (implemented Task 8)**

```javascript
function renderSommaireProduit(body) {
  body.replaceChildren(el('p', 'proj-todo', 'Page sommaire (textile/autres/signalétique) — tâche suivante.'));
}
```

- [ ] **Step 3: Styles**

Append to `public/projet.css`:

```css
.proj-lignes { display: flex; flex-direction: column; gap: 12px; margin-bottom: 14px; }
.proj-ligne { border: 1px solid var(--border-soft); border-radius: var(--radius); padding: 14px; display: flex; flex-direction: column; gap: 8px; background: var(--surface); }
.proj-ligne__row { display: flex; gap: 8px; flex-wrap: wrap; }
.proj-ligne__row > * { flex: 1 1 160px; }
.proj-qty { flex: 0 0 64px !important; min-height: 44px; border: 1px solid var(--border); border-radius: var(--radius); text-align: center; font: inherit; font-size: 16px; }
.proj-select { min-height: 44px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius); font: inherit; font-size: 14px; background: var(--surface); color: var(--text-1); }
.proj-input--sm { min-height: 44px; }
.proj-ligne__del { flex: 0 0 36px !important; border: 0; background: none; color: var(--text-2); cursor: pointer; }
.proj-ligne__del:hover { color: var(--danger, #d33); }
.proj-ligne__prix { align-self: flex-end; font-weight: 700; color: var(--primary); }

.proj-delai { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 16px 0; }
.proj-delai__label { font-weight: 600; color: var(--text-2); font-size: 13px; }
.proj-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.proj-chip { min-height: 40px; padding: 0 14px; border: 1px solid var(--border); border-radius: 20px; background: var(--surface); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; color: var(--text-2); }
.proj-chip.is-on { background: var(--primary-soft); color: var(--primary); border-color: var(--primary-soft); }

.proj-total { position: sticky; bottom: 0; display: flex; align-items: center; gap: 12px; padding: 16px; margin: 0 -20px -20px; background: var(--surface); border-top: 1px solid var(--border-soft); flex-wrap: wrap; }
.proj-total__label { color: var(--text-2); font-size: 13px; margin-left: auto; }
.proj-total__value { font-size: 22px; font-weight: 800; color: var(--text-1); }
.proj-marge-toggle { display: inline-flex; align-items: center; gap: 5px; border: 0; background: none; color: var(--text-2); font-size: 12px; cursor: pointer; opacity: .7; }
.proj-marge-toggle:hover { opacity: 1; }
.proj-marge-toggle__ic { font-size: 16px; }
.proj-marge { display: flex; gap: 12px; font-size: 12px; color: var(--text-2); }
.proj-btn--save { min-width: 140px; justify-content: center; }
```

- [ ] **Step 4: Verify in browser**

Pick a client → Tasse → the config card appears. Choose type de tasse, face 1, face 2 → total
updates live at the bottom. Add a second ligne → total sums both. Tap the délai chips → total
recalculates with the majoration. Tap the small "Voir marge" toggle → prix de revient / marge
appear; tap again → they hide.

- [ ] **Step 5: Commit**

```bash
git add public/projet.js public/projet.css
git commit -m "$(cat <<'EOF'
Nouveau Projet — page 3 (tasse) : configuration + prix live + marge discrète

Type de tasse, coloris, faces 1/2, dessous, BAT, plusieurs lignes par projet ;
prix TTC recalculé en direct côté client (miroir du calcul serveur), délai
avec majoration, bascule discrète pour la marge — jamais visible par défaut.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Page 3 — Textile / Autres / Plaque signalétique (sommaire)

**Files:**
- Modify: `public/projet.js`
- Modify: `public/projet.css`

- [ ] **Step 1: Implement `renderSommaireProduit`**

```javascript
function renderSommaireProduit(body) {
  body.replaceChildren();
  const wrap = el('div', 'proj-produit');
  const back = el('button', 'proj-back', '← Changer de type');
  back.type = 'button';
  back.addEventListener('click', () => { state.page = 'type'; render(); });
  const titre = TYPES.find((t) => t.id === state.type).label;
  wrap.append(back, el('h3', 'proj-step__title', `${titre} — description`));

  const list = el('div', 'proj-lignes');
  state.lignes.forEach((l, i) => {
    const card = el('div', 'proj-ligne');
    const row = el('div', 'proj-ligne__row');
    const desc = el('textarea', 'proj-textarea');
    desc.placeholder = '5 polos brodés équipe, taille M à XL…';
    desc.value = l.description;
    desc.rows = 2;
    desc.addEventListener('input', () => { l.description = desc.value; });
    row.append(desc);

    const qty = el('input', 'proj-qty');
    qty.type = 'number'; qty.min = '1'; qty.inputMode = 'numeric'; qty.value = String(l.quantite);
    qty.addEventListener('input', () => { l.quantite = Math.max(1, Number.parseInt(qty.value, 10) || 1); });
    row.append(qty);

    const prix = el('input', 'proj-input proj-input--sm');
    prix.type = 'number'; prix.min = '0'; prix.step = '0.01'; prix.inputMode = 'decimal';
    prix.placeholder = 'Prix TTC €';
    prix.value = l.prixTtcManuel;
    prix.addEventListener('input', () => { l.prixTtcManuel = prix.value; renderTotalOnly(); });
    row.append(prix);

    if (state.lignes.length > 1) {
      const rm = el('button', 'proj-ligne__del');
      rm.type = 'button';
      rm.append(ic('close'));
      rm.addEventListener('click', () => { state.lignes.splice(i, 1); render(); });
      row.append(rm);
    }
    card.append(row);
    list.appendChild(card);
  });
  wrap.append(list);

  const addBtn = el('button', 'proj-btn proj-btn--ghost', '');
  addBtn.type = 'button';
  addBtn.append(ic('add'), el('span', null, 'Ajouter une ligne'));
  addBtn.addEventListener('click', () => {
    state.lignes.push({ uid: Math.random().toString(36).slice(2), quantite: 1, description: '', prixTtcManuel: '' });
    render();
  });
  wrap.append(addBtn);

  wrap.append(renderDelaiPaiement());
  wrap.append(renderTotalBar());
  body.appendChild(wrap);
}

// Les champs texte perdraient le focus à un render() complet à chaque frappe :
// seul le total en bas se recalcule pour un changement de prix manuel.
function renderTotalOnly() {
  const val = $('.proj-total__value');
  if (val) val.textContent = `${totalTtc().toFixed(2)} €`;
}
```

- [ ] **Step 2: Styles**

Append to `public/projet.css`:

```css
.proj-textarea { flex: 1 1 260px; min-height: 44px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius); font: inherit; font-size: 15px; resize: vertical; background: var(--surface); color: var(--text-1); }
```

- [ ] **Step 3: Verify in browser**

Pick a client → Textile → a card with description/quantity/price appears → typing a price
updates the total at the bottom without losing focus on the textarea. « Ajouter une ligne »
adds a second card; the total sums both prices.

- [ ] **Step 4: Commit**

```bash
git add public/projet.js public/projet.css
git commit -m "$(cat <<'EOF'
Nouveau Projet — page 3 (sommaire) : textile / autres / plaque signalétique

Pas de grille de prix pour ces types (le patron ne l'a pas encore détaillée
comme la tasse) : description libre + quantité + prix TTC saisi à la main,
plusieurs lignes possibles.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Enregistrement — destination, paiement, sauvegarde, confirmation

**Files:**
- Modify: `public/projet.js`
- Modify: `public/projet.css`

- [ ] **Step 1: Add paiement chips to `renderDelaiPaiement`**

Replace `renderDelaiPaiement` with a version that also renders payment status chips (reusing
`state.paiement`, already declared with default `'non_paye'` in Task 7 Step 2):

```javascript
const PAIEMENT_STATUTS = [
  { id: 'non_paye', label: 'Non payé' },
  { id: 'acompte', label: 'Acompte payé' },
  { id: 'paye', label: 'Payé' },
];

function renderDelaiPaiement() {
  const box = el('div', 'proj-delai');
  const delaiRow = el('div', 'proj-delai__row');
  delaiRow.append(el('span', 'proj-delai__label', 'Pour le'));
  const chips = el('div', 'proj-chips');
  for (const d of DELAIS) {
    const chip = el('button', `proj-chip${d.id === state.delai ? ' is-on' : ''}`, d.label);
    chip.type = 'button';
    chip.addEventListener('click', () => { state.delai = d.id; renderCurrentPage(); });
    chips.appendChild(chip);
  }
  delaiRow.append(chips);
  box.append(delaiRow);

  const payRow = el('div', 'proj-delai__row');
  payRow.append(el('span', 'proj-delai__label', 'Paiement'));
  const payChips = el('div', 'proj-chips');
  for (const p of PAIEMENT_STATUTS) {
    const chip = el('button', `proj-chip${p.id === state.paiement ? ' is-on' : ''}`, p.label);
    chip.type = 'button';
    chip.addEventListener('click', () => { state.paiement = p.id; renderCurrentPage(); });
    payChips.appendChild(chip);
  }
  payRow.append(payChips);
  box.append(payRow);
  return box;
}
```

- [ ] **Step 2: Add the destination popup + confirmation screen**

Add near the bottom of `public/projet.js`, before `export async function initProjet`:

```javascript
// --- Destination + enregistrement --------------------------------------------
let PIPELINE = null;   // chargé à la demande (familles + sous-étapes)

async function loadPipeline() {
  if (PIPELINE) return PIPELINE;
  const catalog = await api('GET', '/api/commande/catalog');
  PIPELINE = catalog.pipeline;
  return PIPELINE;
}

function buildPayload(kind, dest) {
  const isTasse = state.type === 'tasse';
  return {
    kind, type: state.type,
    client: state.client.type === 'perso'
      ? { type: 'perso', prenom: (state.client.nom || state.client.entreprise || '').split(' ')[0], nom: (state.client.nom || '').split(' ').slice(1).join(' '), societe: state.client.entreprise, whatsapp: state.client.telephone, email: state.client.email }
      : { type: 'pro', facturation: state.client.entreprise, contact: state.client.nom, whatsapp: state.client.telephone, email: state.client.email },
    lignes: state.lignes.map((l) => (isTasse
      ? { quantite: l.quantite, produitId: l.produitId, coloris: l.coloris, face1Id: l.face1Id, face2Id: l.face2Id, dessousId: l.dessousId, batId: l.batId, remarque: l.remarque }
      : { quantite: l.quantite, description: l.description, prixTtcManuel: Number(l.prixTtcManuel) || 0 })),
    delai: state.delai,
    paiement: { statut: state.paiement },
    stage: dest ? dest.stage : undefined,
    subStage: dest ? dest.subStage : undefined,
  };
}

async function openDestinationPopup() {
  const pipeline = await loadPipeline();
  const overlay = el('div', 'proj-overlay');
  const card = el('div', 'proj-dest-card');
  card.append(el('p', 'proj-dest__eyebrow', 'Dernière étape'), el('h3', 'proj-dest__title', 'Où l’enregistrer ?'));

  const list = el('div', 'proj-dest__list');
  const choose = async (kind, stage, subStage) => {
    overlay.remove();
    try {
      const created = await api('POST', '/api/projets', buildPayload(kind, { stage, subStage }));
      showConfirmation(created);
    } catch (err) {
      window.alert(err.message || 'Enregistrement impossible');
    }
  };

  const demandeBtn = el('button', 'proj-dest__item', 'Demande — à chiffrer');
  demandeBtn.type = 'button';
  demandeBtn.addEventListener('click', () => choose('demande', 'demande', null));
  list.appendChild(demandeBtn);

  for (const fam of pipeline) {
    if (fam.subs && fam.subs.length) {
      for (const sub of fam.subs) {
        const b = el('button', 'proj-dest__item', `${fam.label} — ${sub.label}`);
        b.type = 'button';
        b.addEventListener('click', () => choose('commande', fam.slug, sub.slug));
        list.appendChild(b);
      }
    } else {
      const b = el('button', 'proj-dest__item', fam.label);
      b.type = 'button';
      b.addEventListener('click', () => choose('commande', fam.slug, null));
      list.appendChild(b);
    }
  }
  card.append(list);

  const close = el('button', 'proj-dest__close', '');
  close.type = 'button';
  close.append(ic('close'));
  close.addEventListener('click', () => overlay.remove());
  card.append(close);

  overlay.append(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  ROOT.appendChild(overlay);
}

function showConfirmation(created) {
  const overlay = el('div', 'proj-overlay');
  const card = el('div', 'proj-done-card');
  card.append(
    (() => { const c = el('div', 'proj-done__check'); c.append(ic('check')); return c; })(),
    el('p', 'proj-done__title', 'Projet enregistré'),
    el('p', 'proj-done__sub', `${created.projet.prixTotalTtc.toFixed(2)} € TTC — ${created.projet.client.societe}`),
  );
  const actions = el('div', 'proj-done__actions');
  const planning = el('a', 'proj-btn', 'Voir le planning');
  planning.href = '#planning';
  const again = el('button', 'proj-btn proj-btn--primary', 'Nouveau projet');
  again.type = 'button';
  again.addEventListener('click', () => {
    overlay.remove();
    state.page = 'client'; state.client = null; state.type = null; state.lignes = [];
    state.delai = 'j5'; state.paiement = 'non_paye'; state.margeVisible = false;
    render();
  });
  actions.append(planning, again);
  card.append(actions);
  overlay.append(card);
  ROOT.appendChild(overlay);
}
```

- [ ] **Step 3: Wire the save button in `renderTotalBar`**

Replace the placeholder:

```javascript
  saveBtn.addEventListener('click', () => window.alert('Destination + enregistrement : tâche suivante.'));
```

with:

```javascript
  saveBtn.addEventListener('click', () => { openDestinationPopup(); });
```

- [ ] **Step 4: Styles**

Append to `public/projet.css`:

```css
.proj-delai__row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }

.proj-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 20px; }
.proj-dest-card, .proj-done-card { position: relative; background: var(--surface); border-radius: calc(var(--radius) + 6px); padding: 28px; max-width: 420px; width: 100%; max-height: 80vh; overflow-y: auto; }
.proj-dest__eyebrow { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); }
.proj-dest__title { margin: 4px 0 16px; font-size: 19px; font-weight: 800; }
.proj-dest__list { display: flex; flex-direction: column; gap: 6px; }
.proj-dest__item { min-height: 44px; padding: 0 14px; border: 1px solid var(--border-soft); border-radius: var(--radius); background: var(--surface); text-align: left; font: inherit; font-size: 14px; cursor: pointer; }
.proj-dest__item:hover { background: var(--surface-hover); }
.proj-dest__close { position: absolute; top: 14px; right: 14px; border: 0; background: none; color: var(--text-2); cursor: pointer; }

.proj-done-card { text-align: center; }
.proj-done__check { width: 56px; height: 56px; border-radius: 50%; background: var(--primary-soft); color: var(--primary); display: flex; align-items: center; justify-content: center; margin: 0 auto 14px; font-size: 30px; }
.proj-done__title { font-size: 19px; font-weight: 800; margin: 0 0 4px; }
.proj-done__sub { color: var(--text-2); margin: 0 0 20px; }
.proj-done__actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
```

- [ ] **Step 5: Verify in browser**

Complete a full tasse projet (client → tasse → config) → « Enregistrer » → destination popup
lists Demande + every famille/sous-étape → pick « Commande — À chiffrer » → confirmation screen
shows the price and client → « Voir le planning » lands on the planning with the new row
visible in the Commande column. Repeat for a textile projet.

- [ ] **Step 6: Commit**

```bash
git add public/projet.js public/projet.css
git commit -m "$(cat <<'EOF'
Nouveau Projet — enregistrement : destination, paiement, confirmation

Puces paiement à côté du délai, popup « Où l'enregistrer ? » alimentée par le
pipeline réel (POST /api/projets), écran de confirmation avec le prix et un
raccourci pour enchaîner un nouveau projet. Le flux comptoir est complet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Réglages — édition des tarifs tasse

**Files:**
- Modify: `public/reglages.js`

- [ ] **Step 1: Add the tarifs section to `buildStatic()` and its data/wiring**

In `public/reglages.js`, add module-level state near the top (after `let saved = '';`):

```javascript
let tarifsArticles = [];
let tarifsParams = { tauxHoraireMo: 25, tauxHoraireMachine: 25, tgca: 0.04 };
const TARIFS_CATEGORIES = [
  { id: 'produit', label: 'Tasses' },
  { id: 'face', label: 'Options Face 1 / Face 2' },
  { id: 'dessous', label: 'Options Dessous' },
  { id: 'bat', label: 'BAT' },
];
```

At the end of `buildStatic()`, right before `page.appendChild(card);` is called for the
WhatsApp card... actually right after that line (so the tarifs card comes second), add:

```javascript
  // --- Carte « Tarifs tasse » -------------------------------------------------
  const tcard = el('section', 'reg-card');
  const tch = el('header', 'reg-card__head');
  tch.append(ic('local_cafe', 'reg-card__ic'),
    (() => {
      const t = el('div');
      t.append(el('h3', 'reg-card__title', 'Tarifs — Tasse'),
        el('p', 'reg-card__desc',
          'Les prix et temps utilisés par Nouveau Projet pour calculer le total TTC '
          + 'd’une tasse personnalisée. Chaque changement est immédiat pour tous les postes.'));
      return t;
    })());
  tcard.appendChild(tch);
  tcard.appendChild(el('div', 'reg-tarifs-list', ''));
  tcard.querySelector('.reg-tarifs-list').id = 'reg-tarifs-list';

  const params = el('div', 'reg-tarifs-params');
  params.id = 'reg-tarifs-params';
  tcard.appendChild(params);
  page.appendChild(tcard);
```

- [ ] **Step 2: Render + wire the tarifs list**

Add these functions (near `sync()`/`save()`):

```javascript
function tarifRow(a) {
  const row = el('div', 'reg-tarif-row');
  const desig = el('input', 'reg-tarif-input reg-tarif-input--nom');
  desig.value = a.designation; desig.placeholder = 'Désignation';
  desig.addEventListener('change', () => { a.designation = desig.value; saveTarifs(); });
  const prix = el('input', 'reg-tarif-input reg-tarif-input--num');
  prix.type = 'number'; prix.step = '0.01'; prix.min = '0'; prix.value = a.prixVenteTtc;
  prix.title = 'Prix de vente TTC';
  prix.addEventListener('change', () => { a.prixVenteTtc = Number(prix.value) || 0; saveTarifs(); });
  const achat = el('input', 'reg-tarif-input reg-tarif-input--num');
  achat.type = 'number'; achat.step = '0.01'; achat.min = '0'; achat.value = a.prixAchat;
  achat.title = 'Prix d’achat';
  achat.addEventListener('change', () => { a.prixAchat = Number(achat.value) || 0; saveTarifs(); });
  const actif = el('button', `reg-tarif-toggle${a.actif ? ' is-on' : ''}`);
  actif.type = 'button';
  actif.title = a.actif ? 'Actif — cliquer pour désactiver' : 'Inactif — cliquer pour activer';
  actif.append(ic(a.actif ? 'visibility' : 'visibility_off'));
  actif.addEventListener('click', () => { a.actif = !a.actif; saveTarifs(); renderTarifs(); });
  const del = el('button', 'reg-tarif-del');
  del.type = 'button';
  del.append(ic('delete'));
  del.addEventListener('click', () => {
    tarifsArticles = tarifsArticles.filter((x) => x !== a);
    saveTarifs(); renderTarifs();
  });
  row.append(desig, achat, prix, actif, del);
  return row;
}

function renderTarifs() {
  const box = $('#reg-tarifs-list');
  if (!box) return;
  box.replaceChildren();
  for (const cat of TARIFS_CATEGORIES) {
    box.appendChild(el('h4', 'reg-tarif-cat', cat.label));
    const rows = tarifsArticles.filter((a) => a.categorie === cat.id);
    for (const a of rows) box.appendChild(tarifRow(a));
    const addBtn = el('button', 'reg-tarif-add', '');
    addBtn.type = 'button';
    addBtn.append(ic('add'), el('span', null, `Ajouter (${cat.label.toLowerCase()})`));
    addBtn.addEventListener('click', () => {
      tarifsArticles.push({ id: `tmp-${Date.now()}`, categorie: cat.id, designation: '', prixAchat: 0, prixVenteTtc: 0, tempsMoMin: 0, tempsMachineMin: 0, actif: true, position: tarifsArticles.length * 1000 });
      renderTarifs();
    });
    box.appendChild(addBtn);
  }
  const p = $('#reg-tarifs-params');
  p.replaceChildren();
  const field = (key, label) => {
    const wrap = el('label', 'reg-tarif-param');
    wrap.append(el('span', null, label));
    const input = el('input', 'reg-tarif-input reg-tarif-input--num');
    input.type = 'number'; input.step = key === 'tgca' ? '0.001' : '0.5'; input.min = '0';
    input.value = tarifsParams[key];
    input.addEventListener('change', () => {
      tarifsParams[key] = Number(input.value) || 0;
      saveTarifsParams();
    });
    wrap.appendChild(input);
    return wrap;
  };
  p.append(field('tauxHoraireMo', 'Taux horaire MO (€)'), field('tauxHoraireMachine', 'Taux horaire machine (€)'), field('tgca', 'TGCA (ex. 0.04 = 4 %)'));
}
```

- [ ] **Step 3: Add a small `api()` helper (this module doesn't have one yet) and the save functions**

At the top of `public/reglages.js`, after the `ic` helper, add:

```javascript
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
  return data;
}

let tarifsSaveTimer = null;
async function saveTarifs() {
  clearTimeout(tarifsSaveTimer);
  tarifsSaveTimer = setTimeout(async () => {
    try { tarifsArticles = await api('PUT', '/api/tarifs-tasse', tarifsArticles); } catch (_) { /* réessayé au prochain changement */ }
  }, 400);
}
async function saveTarifsParams() {
  try { tarifsParams = await api('PUT', '/api/tarifs-tasse/parametres', tarifsParams); } catch (_) { /* réessayé au prochain changement */ }
}
```

(`renderTarifs()` in Step 2 calls both `saveTarifs()` — via `tarifRow()`'s field listeners — and
`saveTarifsParams()` — via `field()`'s listener — so declare all of the above before the first
call to `renderTarifs()`, i.e. above it in the file. `saveTarifs` is also referenced by
`tarifRow()` and the per-category "Ajouter" button in Step 2 needs no explicit save call — it
mutates `tarifsArticles` in memory and re-renders; the save happens on the next field `change`.)

- [ ] **Step 4: Load tarifs on mount + refresh**

In `initReglages`, after `await refreshReglages();`, add:

```javascript
  try {
    [tarifsArticles, tarifsParams] = await Promise.all([api('GET', '/api/tarifs-tasse'), api('GET', '/api/tarifs-tasse/parametres')]);
  } catch (_) { /* silencieux : listes vides, éditables quand même */ }
  renderTarifs();
```

Also add the same block (without re-declaring `let`) at the top of `refreshReglages()`, so
revisiting the tab picks up changes made from Nouveau Projet's price calc side (defensive —
tarifs rarely change from elsewhere, but keeps the two screens honest):

```javascript
  try {
    tarifsArticles = await api('GET', '/api/tarifs-tasse');
    tarifsParams = await api('GET', '/api/tarifs-tasse/parametres');
    renderTarifs();
  } catch (_) { /* on garde ce qui est déjà affiché */ }
```

- [ ] **Step 5: Minimal styles**

Add to `public/styles.css`, right after the existing `.reg-*` rules (search for `.reg-card`
to find the block and append at its end):

```css
.reg-tarif-cat { margin: 18px 0 8px; font-size: 13px; font-weight: 700; color: var(--text-2); text-transform: uppercase; letter-spacing: .03em; }
.reg-tarif-cat:first-child { margin-top: 4px; }
.reg-tarif-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.reg-tarif-input { min-height: 40px; border: 1px solid var(--border); border-radius: var(--radius); padding: 0 10px; font: inherit; font-size: 13.5px; background: var(--surface); color: var(--text-1); }
.reg-tarif-input--nom { flex: 1 1 220px; }
.reg-tarif-input--num { flex: 0 0 90px; text-align: right; }
.reg-tarif-toggle, .reg-tarif-del { flex: 0 0 36px; min-height: 36px; border: 1px solid var(--border-soft); border-radius: var(--radius); background: var(--surface); color: var(--text-2); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.reg-tarif-toggle.is-on { color: var(--primary); }
.reg-tarif-del:hover { color: var(--danger, #d33); }
.reg-tarif-add { display: inline-flex; align-items: center; gap: 6px; margin: 4px 0 2px; border: 1px dashed var(--border); border-radius: var(--radius); min-height: 38px; padding: 0 12px; background: none; color: var(--primary); font: inherit; font-size: 13px; cursor: pointer; }
.reg-tarif-params { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border-soft); }
.reg-tarif-param { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--text-2); }
```

- [ ] **Step 6: Verify in browser**

Open `#reglages` → the « Tarifs — Tasse » card lists the 3 tasses, 6 faces, 6 dessous, 2 BAT,
grouped by category, with editable price/name fields, an active toggle, and delete. Change a
price → switch to `#nouveau-projet` → Tasse → the new price shows in the live total. Change
the taux horaire MO → the marge toggle (Task 7) reflects it after reopening.

- [ ] **Step 7: Commit**

```bash
git add public/reglages.js public/styles.css
git commit -m "$(cat <<'EOF'
Réglages — édition des tarifs tasse

Le patron édite prix d'achat/vente, active/désactive et ajoute des lignes
(tasses, options face/dessous, BAT) directement depuis Réglages, plus les 3
paramètres globaux (taux horaires, TGCA) — Nouveau Projet lit ce même
catalogue pour son calcul de prix.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Base clients — champs enrichis (fiche complète)

**Files:**
- Modify: `public/clients.js`

- [ ] **Step 1: Extend `NATURES` to the 4 values and relabel helpers**

Replace:

```javascript
const NATURES = [
  { id: 'pro', label: 'Pro', icon: 'apartment' },
  { id: 'perso', label: 'Perso', icon: 'person' },
];
const nature = (v) => (v === 'perso' ? 'perso' : 'pro');
const natureLabel = (v) => (nature(v) === 'perso' ? 'Perso' : 'Pro');
```

with:

```javascript
const NATURES = [
  { id: 'pro', label: 'Professionnel', icon: 'apartment' },
  { id: 'revendeur', label: 'Revendeur', icon: 'storefront' },
  { id: 'asso', label: 'Association', icon: 'groups' },
  { id: 'perso', label: 'Particulier', icon: 'person' },
];
const NATURE_IDS = new Set(NATURES.map((n) => n.id));
const nature = (v) => (NATURE_IDS.has(v) ? v : 'pro');
const natureLabel = (v) => (NATURES.find((n) => n.id === nature(v)) || NATURES[0]).label;
```

(The list/filter `natureFilter` in the module already compares against `nature(...)`, and the
existing `'all' | 'pro' | 'perso'` filter UI keeps working unchanged — it just won't filter on
the two new values yet, which is fine: out of scope for this task, not a regression.)

- [ ] **Step 2: Add the new fields to `FIELDS`**

Replace the `FIELDS` array with:

```javascript
const FIELDS = [
  { key: 'entreprise', label: 'Société', icon: 'apartment', ph: 'Nom de la société', required: true },
  { key: 'raison_sociale', label: 'Raison sociale', icon: 'gavel', ph: 'SARL Evelyne' },
  { key: 'code', label: 'Identifiant', icon: 'tag', ph: '—' },
  { key: 'nom', label: 'Contact', icon: 'person', ph: 'Personne à contacter' },
  { key: 'referent_prenom', label: 'Référent (prénom)', icon: 'badge', ph: 'Cédric' },
  { key: 'fonction', label: 'Fonction', icon: 'badge', ph: 'Gérante, Resp. Marketing…' },
  { key: 'type', label: 'Type', icon: 'sell', ph: 'Boutique, Hôtel, Entretien…', list: 'cl-dl-types' },
  { key: 'secteur', label: 'Secteur d’activité', icon: 'work', ph: 'Hôtel / Restaurant, Boutique…', list: 'cl-dl-secteurs' },
  { key: 'zone', label: 'Zone', icon: 'location_on', ph: 'Grand Case, Marigot…', list: 'cl-dl-zones' },
  { key: 'code_postal', label: 'Code postal', icon: 'markunread_mailbox', ph: '97150' },
  { key: 'ville', label: 'Ville', icon: 'location_city', ph: 'Saint-Martin' },
  { key: 'pays', label: 'Pays', icon: 'public', ph: 'Saint-Martin' },
  { key: 'telephone', label: 'Téléphone', icon: 'call', ph: '06 90 …', type: 'tel', inputmode: 'tel' },
  { key: 'email', label: 'E-mail', icon: 'mail', ph: 'contact@…', type: 'email', inputmode: 'email' },
  { key: 'adresse', label: 'Adresse', icon: 'home', ph: 'Ajouter…' },
];
```

`code` is server-generated (never editable) — make its input read-only. In `fieldRow(field,
value, opts)`, right after `input.dataset.key = field.key;`, add:

```javascript
  if (field.key === 'code') { input.readOnly = true; input.classList.add('cl-f__input--readonly'); }
```

- [ ] **Step 3: Add the secteur suggestion list (datalist) — 20 sectors from the patron's sheet**

Near the top of the file, alongside any existing datalist constants (search for
`cl-dl-types`/`cl-dl-zones` usage in `buildStatic()` to find where datalists are appended —
they're built from `suggestions()` reading existing client values, not a fixed list. Add a
fixed constant instead, since "secteur" needs the patron's 20-item reference list even before
any client uses them):

```javascript
const SECTEURS_SUGGERES = [
  'Hôtel / Restaurant', 'Hôtel', 'Restaurant', 'Bar', 'Boutique', 'Agence immobilière',
  'Conciergerie', 'Villa de location', 'Nautisme', 'BTP', 'Artisan', 'Événementiel',
  'Association', 'École', 'Salle de sport', 'Santé', 'Tourisme', 'Transport',
  'Administration', 'Autre',
];
```

Find the `suggestions()` function and its `datalist` wiring in `buildStatic()` (search
`cl-dl-types`), then add a matching `<datalist id="cl-dl-secteurs">` populated from
`SECTEURS_SUGGERES` alongside the existing ones — mirror exactly how `cl-dl-types`/`cl-dl-zones`
datalists are created and appended (same function, same pattern), just with a fixed source list
instead of `suggestions()`'s derived-from-data list.

- [ ] **Step 4: Update `openNew()`'s initial draft**

Replace:

```javascript
function openNew() {
  drawer = { id: null, mode: 'create', draft: { entreprise: '', nom: '', fonction: '', client_type: 'pro', type: '', zone: '', telephone: '', email: '', adresse: '' }, notes: [] };
  renderDrawer();
}
```

with:

```javascript
function openNew() {
  drawer = {
    id: null, mode: 'create',
    draft: {
      entreprise: '', raison_sociale: '', nom: '', referent_prenom: '', fonction: '',
      client_type: 'pro', type: '', secteur: '', zone: '', code_postal: '', ville: '', pays: '',
      telephone: '', email: '', adresse: '',
    },
    notes: [],
  };
  renderDrawer();
}
```

`createClient()` already iterates `FIELDS` generically to build the payload — no change needed
there, and `code` being read-only just submits its (empty) value, which the server ignores
since `code` isn't in `CLIENT_FIELDS`.

- [ ] **Step 5: Small style for the read-only code field**

Append to `public/styles.css` near other `.cl-f` rules (search `.cl-f__input` to find the
block):

```css
.cl-f__input--readonly { color: var(--text-2); background: var(--surface-hover); cursor: default; }
```

- [ ] **Step 6: Verify in browser**

Open `#clients` → open an existing client → the fiche now shows Raison sociale, Identifiant
(read-only), Référent, Secteur (with the 20-item suggestion list), Code postal, Ville, Pays.
Create a new client, pick "Revendeur" in the nature segmented control → save → the created
client shows `client_type: revendeur` and a generated `code` starting `CLI-PRO-`.

- [ ] **Step 7: Run full suite + commit**

Run: `npm test`
Expected: all tests still PASS (no backend change in this task, but confirms nothing broke).

```bash
git add public/clients.js public/styles.css
git commit -m "$(cat <<'EOF'
Base clients — champs enrichis + nature Pro/Revendeur/Association/Particulier

Fiche complète : raison sociale, identifiant lisible (lecture seule),
référent, secteur d'activité (20 valeurs suggérées), adresse détaillée
(code postal/ville/pays). La création rapide dans Nouveau Projet reste
minimale — ces champs se remplissent ici, entre deux clients.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Vérification finale + revue

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: every `test/*.test.js` prints its `✓` line, exit code 0.

- [ ] **Step 2: Full manual browser walkthrough**

Using the preview tool (`node server.js` or `preview_start`):
1. Click « Nouveau Projet » → search an existing seeded client → select it.
2. Pick « Tasse » → configure 2 lignes with different faces/dessous → toggle « Voir marge » →
   confirm the numbers move together (price, marge) as fields change.
3. Change délai to « Jour J » → confirm total jumps by the majoration.
4. « Enregistrer » → pick « Commande — À chiffrer » → confirmation screen → « Voir le planning »
   → the new row appears in the Commande column with the right price.
5. Repeat quickly for « Textile » (sommaire) and « Plaque signalétique ».
6. Open `#reglages` → change a tasse price → go back to `#nouveau-projet` → Tasse → confirm the
   new price is reflected in a fresh line.
7. Open `#clients` → confirm the enriched fields are present and a `code` was generated for
   clients created during this walkthrough.
8. Resize to mobile width (390px) and to the Galaxy Tab breakpoints (800×1280 / 1280×800 if
   `TABLETTE: oui` is flagged for this repo — check the root `CLAUDE.md`; if absent/`non`, skip
   tablet sizes) — confirm tap targets stay ≥44px and nothing overflows horizontally.

- [ ] **Step 3: Report findings**

If any step in Step 2 fails, fix it (small, targeted patch — not a new task) and re-verify
before moving on. Do not report the feature complete until the full walkthrough passes clean.

---

## Out of scope (do not implement here — see design doc)

- Remise volume par palier (357-row "Tarifs volume" sheet).
- Mixing multiple project types in a single "Nouveau Projet".
- Removing/replacing the existing Demande/Commande tabs.
- Detailed pricing grids for Textile/Autres/Signalétique.
