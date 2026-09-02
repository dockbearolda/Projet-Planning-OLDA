> ⚠ **DOCUMENT HISTORIQUE.** Écrit avant le 01/09/2026 et jamais relu depuis.
> Il cite des fichiers qui n'existent plus (`public/projet.js`, `public/commande.js`,
> `public/guide.js`), des tables retirées (`production_sectors`) ou des décisions
> annulées depuis. Il dit ce qu'on a pensé ce jour-là, pas ce que le code fait
> aujourd'hui : pour ça, `ARCHITECTURE.md` et `README.md` font foi.

# Prix planning + blocage d'entrée en Facturation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher un champ Prix éditable sur chaque ligne du planning, et refuser (avec une bulle d'avertissement) qu'une ligne sans prix entre dans la famille Facturation, que ce soit par glisser-déposer ou via la flèche « étape suivante ».

**Architecture:** Application mono-page vanilla JS (pas de build), toute la logique de grille vit dans `public/app.js`. Le champ prix existe déjà en base (`project_value`) et côté route PATCH (whitelistée + validée) — seul le frontend change. La règle de blocage est isolée dans deux fonctions pures (`hasPrice`, `blockedByPrice`) réutilisées par les trois points d'entrée en Facturation (glisser-déposer au survol, glisser-déposer au dépôt, flèche suivante).

**Tech Stack:** Vanilla ES modules (`public/app.js`, `public/styles.css`, `public/index.html`), Express (`server.js`), tests `node:assert` exécutés un par un (`npm test`).

**Spec de référence :** [docs/superpowers/specs/2026-07-24-prix-blocage-facturation-design.md](../specs/2026-07-24-prix-blocage-facturation-design.md)

---

### Task 1: Colonne « Prix » — markup et largeur

**Files:**
- Modify: `public/index.html:186-191` (colgroup + thead)
- Modify: `public/app.js:2477-2480` (COL_DEFAULTS)
- Modify: `public/styles.css:1946-1953` (largeurs de colonnes)

- [ ] **Step 1: Ajouter la colonne au `<colgroup>`**

Dans `public/index.html`, le `<colgroup>` liste une entrée `<col data-col="...">` par
colonne, dans le même ordre que les `<th>` du `<thead>` et que les `<td>` produits par
`buildRow` dans `public/app.js`. Insérer la colonne « prix » juste après « product »
(Description) et avant « sub_stage » (Sous-étape) :

```html
              <col data-col="handle" />
              <col data-col="stars" />
              <col data-col="client_type" />
              <col data-col="responsable" />
              <col data-col="flag" />
              <col data-col="client" />
              <col data-col="product" />
              <col data-col="price" />
              <col data-col="sub_stage" />
              <col data-col="next" />
              <col data-col="description" />
              <col data-col="deadline" />
              <col data-col="del" />
```

- [ ] **Step 2: Ajouter l'en-tête `<th>` correspondant**

Toujours dans `public/index.html`, même ordre, insérer entre `col-product` et `col-sub` :

```html
                <th class="col-handle" aria-label="Glisser"></th>
                <th class="col-stars sortable" data-sort="priority" aria-label="Étoiles (priorité)">★</th>
                <th class="col-type sortable" data-sort="client_type">Type</th>
                <th class="col-resp sortable" data-sort="responsable">Responsable</th>
                <th class="col-flag sortable" data-sort="flag">État</th>
                <th class="col-client sortable" data-sort="billing_company">Nom du Dossier Client</th>
                <th class="col-product sortable" data-sort="product">Description</th>
                <th class="col-price sortable num" data-sort="project_value">Prix (€)</th>
                <th class="col-sub sortable" data-sort="sub_stage">Sous-étape</th>
                <th class="col-next" aria-label="Étape suivante">→</th>
                <th class="col-infos sortable" data-sort="description">Infos</th>
                <th class="col-deadline sortable" data-sort="deadline">Date Souhaité</th>
                <th class="col-del" aria-label=""></th>
```

`data-sort="project_value"` branche directement sur le comparateur de tri existant
(`public/app.js:657-661` gère déjà `project_value` comme une clé numérique) — aucun
changement du tri n'est nécessaire.

- [ ] **Step 3: Largeur par défaut (mode réglage manuel)**

Dans `public/app.js`, `COL_DEFAULTS` (ligne 2477) doit connaître la clé `price` (sinon le
réglage manuel des largeurs de colonnes retombe sur `COL_MIN` = 36px, trop étroit pour un
prix à 4 chiffres) :

```js
const COL_DEFAULTS = {
  handle: 52, stars: 78, client_type: 96, responsable: 148, flag: 138, client: 210, product: 220,
  price: 92, sub_stage: 170, next: 56, description: 210, deadline: 136, del: 200,
};
```

- [ ] **Step 4: Largeur par défaut (mode automatique)**

Dans `public/styles.css`, le bloc « colonnes largeurs » (ligne 1946) fixe la largeur des
colonnes « puce » (numériques/courtes) — Prix en fait partie, comme `col-sub` ou
`col-deadline` :

```css
.col-handle { width: 44px; }
.col-type { width: 66px; }
.col-resp { width: 132px; }
.col-flag { width: 120px; }
.col-price { width: 92px; }
.col-sub { width: 140px; }
.col-next { width: 48px; }
.col-deadline { width: 124px; }
.col-del { width: 116px; }
```

- [ ] **Step 5: Vérifier que la page charge toujours sans erreur**

Il n'y a pas encore de cellule Prix générée par `buildRow` (Task 2) : la ligne d'en-tête
aura une colonne de plus que les lignes du corps, ce qui est attendu à ce stade
intermédiaire. Pas de commande à lancer ici — la vérification visuelle complète se fait à
la fin de la Task 2.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "Ajoute la colonne Prix (markup + largeurs), sans la cellule pour l'instant"
```

---

### Task 2: Cellule Prix éditable (`cellPrice`)

**Files:**
- Modify: `public/app.js:894` (appel dans `buildRow`)
- Modify: `public/app.js:1493` (nouvelle fonction `cellPrice`, juste après `cellDescription`)

- [ ] **Step 1: Ajouter la fonction `cellPrice`**

Dans `public/app.js`, juste après la fonction `cellDescription` (qui se termine ligne
1493, juste avant le commentaire `// Infos : notes libres...`), ajouter :

```js
// Prix : montant HT de la commande. Une ligne sans prix ne peut pas ENTRER dans la
// famille Facturation (voir blockedByPrice plus bas) — affiché ici pour que la saisie
// se fasse tôt, pas au moment du glisser-déposer.
function cellPrice(r) {
  const td = document.createElement('td');
  td.className = 'col-price-cell';

  const price = document.createElement('input');
  price.className = 'cell-input num cell-price';
  price.type = 'text';
  price.inputMode = 'decimal';
  price.value = r.project_value != null ? String(r.project_value) : '';
  price.placeholder = '—';
  bindInline(
    price, r, 'project_value',
    (raw) => {
      const t = raw.trim();
      return t === '' ? null : parseFloat(t.replace(',', '.'));
    },
    (raw) => {
      const t = raw.trim();
      if (t === '') return '';
      const n = parseFloat(t.replace(',', '.'));
      return Number.isNaN(n) ? raw : n.toFixed(2);
    },
  );

  td.appendChild(price);
  return td;
}
```

- [ ] **Step 2: Appeler `cellPrice` dans `buildRow`**

Dans `public/app.js:894`, entre l'appel à `cellDescription(r)` et celui à
`cellSubStage(r)` :

```js
  // description : ce qui est produit (ancien champ « produit »)
  tr.appendChild(cellDescription(r));
  // prix : montant HT — une ligne sans prix ne peut pas entrer en Facturation
  tr.appendChild(cellPrice(r));
  // sous-étape : puce précisant ce qui se passe maintenant dans la famille
  tr.appendChild(cellSubStage(r));
```

- [ ] **Step 3: Vérification visuelle**

Démarrer le serveur de preview (`olda`, port 3000), ouvrir le planning :
- La colonne « Prix (€) » apparaît entre Description et Sous-étape, alignée à droite,
  avec un tiret (`—`) en placeholder sur les lignes sans prix.
- Taper un prix (ex. `45,50`), appuyer Entrée ou cliquer ailleurs : la valeur se
  reformate en `45.50`, persiste après un rechargement de page (F5).
- Vider le champ (Suppr puis blur) : revient à vide, `project_value` repasse à `null`
  (vérifiable via `GET /api/requests` dans l'onglet réseau, ou en rechargeant).
- Cliquer sur l'en-tête « Prix (€) » trie la grille par prix croissant/décroissant.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "Ajoute la cellule Prix éditable sur la ligne planning"
```

---

### Task 3: Règle de blocage — `hasPrice` / `blockedByPrice` (TDD)

**Files:**
- Modify: `public/app.js:2279` (nouveau bloc, juste avant `stageAcceptsDrop`)
- Create: `test/price-block.test.js`

- [ ] **Step 1: Écrire le test (il doit échouer — le bloc source n'existe pas encore)**

Créer `test/price-block.test.js` :

```js
'use strict';

// Vérifie la règle de blocage prix à l'entrée en Facturation (glisser-déposer et
// flèche « étape suivante »). Comme test/next-flow-step.test.js, on extrait le VRAI
// bloc source de public/app.js (entre les deux bornes ci-dessous) plutôt que d'en
// recopier la logique : une régression dans app.js fait donc échouer ce test.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const START = '// --- Blocage prix : entrée en Facturation (glisser-déposer + étape suivante) ------';
const END = '// Une entrée du rail accepte-t-elle';
const from = SRC.indexOf(START);
const to = SRC.indexOf(END);
assert.ok(from >= 0 && to > from, 'bloc blocage-prix introuvable dans public/app.js');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${SRC.slice(from, to)}
globalThis.hasPrice = hasPrice;
globalThis.blockedByPrice = blockedByPrice;
globalThis.PRICE_BLOCK_MESSAGE = PRICE_BLOCK_MESSAGE;`, sandbox);
const { hasPrice, blockedByPrice, PRICE_BLOCK_MESSAGE } = sandbox;

// 1. hasPrice : seule l'absence de prix (null/undefined) compte comme « sans prix ».
assert.strictEqual(hasPrice({ project_value: null }), false, 'prix absent (null)');
assert.strictEqual(hasPrice({ project_value: undefined }), false, 'prix absent (undefined)');
assert.strictEqual(hasPrice({ project_value: 0 }), true, 'prix à 0€ est valide');
assert.strictEqual(hasPrice({ project_value: 45.5 }), true, 'prix positif valide');

// 2. Sans prix, entrer en facturation depuis une autre famille est bloqué.
assert.strictEqual(
  blockedByPrice({ stage: 'production', project_value: null }, 'facturation'),
  true,
  'sans prix, entrer en facturation depuis une autre famille est bloqué',
);

// 3. Avec un prix (même 0€), l'entrée n'est jamais bloquée.
assert.strictEqual(
  blockedByPrice({ stage: 'production', project_value: 0 }, 'facturation'),
  false,
  'un prix à 0€ ne bloque pas',
);
assert.strictEqual(
  blockedByPrice({ stage: 'production', project_value: 120 }, 'facturation'),
  false,
  'un prix positif ne bloque pas',
);

// 4. Déjà dans facturation (même sans prix) : les mouvements internes à la famille
//    (réordonnancement, bascule entre sous-étapes) ne sont jamais bloqués.
assert.strictEqual(
  blockedByPrice({ stage: 'facturation', project_value: null }, 'facturation'),
  false,
  'un mouvement interne à facturation n’est jamais bloqué',
);

// 5. Cible autre que facturation : jamais bloqué par le prix.
assert.strictEqual(
  blockedByPrice({ stage: 'demande', project_value: null }, 'production'),
  false,
  'entrer ailleurs qu’en facturation n’est jamais bloqué par le prix',
);

// 6. Le message est exposé (réutilisé par la bulle et le toast).
assert.strictEqual(typeof PRICE_BLOCK_MESSAGE, 'string');
assert.ok(PRICE_BLOCK_MESSAGE.length > 0);

console.log('✓ price-block : hasPrice/blockedByPrice couvrent prix null/0/positif et entrée vs mouvement interne');
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `node test/price-block.test.js`
Expected: `AssertionError [ERR_ASSERTION]: bloc blocage-prix introuvable dans public/app.js`

- [ ] **Step 3: Ajouter le bloc source dans `public/app.js`**

Dans `public/app.js`, juste avant le commentaire existant qui précède
`stageAcceptsDrop` (ligne 2279, `// Une entrée du rail accepte-t-elle...`), insérer :

```js
// --- Blocage prix : entrée en Facturation (glisser-déposer + étape suivante) ------
// Une commande sans prix ne peut pas ENTRER dans la famille Facturation depuis une
// autre famille (on chiffre avant de facturer). Une fois la ligne dans la famille,
// réordonner ou changer de sous-étape (Facturation à faire ↔ Prêt client / Attente
// retrait) reste toujours possible, même si le prix venait à manquer entre-temps :
// la règle ne verrouille que l'ENTRÉE, jamais les mouvements internes.
function hasPrice(r) {
  return r.project_value != null;
}

function blockedByPrice(r, targetStage) {
  return targetStage === 'facturation' && r.stage !== 'facturation' && !hasPrice(r);
}

const PRICE_BLOCK_MESSAGE = 'Sans prix, impossible de passer en Facturation.';

```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `node test/price-block.test.js`
Expected: `✓ price-block : hasPrice/blockedByPrice couvrent prix null/0/positif et entrée vs mouvement interne`

- [ ] **Step 5: Commit**

```bash
git add public/app.js test/price-block.test.js
git commit -m "Ajoute la règle de blocage prix (hasPrice/blockedByPrice) avec test"
```

---

### Task 4: Glisser-déposer — refuser le dépôt (`stageAcceptsDrop`)

**Files:**
- Modify: `public/app.js:2284-2290` (`stageAcceptsDrop`)

- [ ] **Step 1: Ajouter la condition de blocage**

```js
// Une entrée du rail accepte-t-elle qu'on y DÉPOSE la ligne `r` ?
// Un GRAND TITRE qui a des sous-catégories n'est JAMAIS une cible : la ligne doit
// atterrir sur une sous-catégorie précise, pas rester « à préciser » sur le titre.
// Les familles sans sous-catégorie (Demande, Attente Client, Archivé) et Fiverr
// restent des cibles directes — il n'y a rien de plus fin où viser.
function stageAcceptsDrop(stageEl, r) {
  const slug = stageEl.dataset.slug;
  const isSub = stageEl.dataset.sub != null;
  if (!isSub && familyHasSub(slug)) return false;          // en-tête de zone : verrouillé
  if (blockedByPrice(r, slug)) return false;                // pas de prix : entrée refusée
  const sub = isSub ? stageEl.dataset.sub : null;
  return slug !== r.stage || sub !== (r.sub_stage ?? null); // exclut la place actuelle
}
```

- [ ] **Step 2: Vérification visuelle**

Sur le planning, glisser une ligne SANS prix jusqu'à une sous-catégorie de Facturation
puis relâcher : le dépôt est refusé, la ligne revient à sa place (comportement identique
au cas « en-tête verrouillé », pas encore de bulle ni de toast à ce stade — ajoutés dans
les tasks suivantes). Glisser une ligne AVEC un prix (y compris 0) : le dépôt fonctionne
normalement.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "Bloque le dépôt en Facturation d'une ligne sans prix"
```

---

### Task 5: Bulle d'avertissement au survol pendant le glisser

**Files:**
- Modify: `public/app.js:2219` (déclaration `dragState`)
- Modify: `public/app.js:2292-2309` (`updateDragTarget`)
- Modify: `public/styles.css:479-483` (nouvelle classe `.stage.drop-blocked`)

- [ ] **Step 1: Déclarer l'état de la cible bloquée**

Dans `public/app.js`, juste après `let dragState = null;` (ligne 2219) :

```js
let dragState = null;
// Cible Facturation actuellement affichée comme refusée (classe + bulle visibles),
// pour ne rafraîchir la bulle qu'au changement de cible, pas à chaque frame de survol.
let priceBlockedEl = null;
```

- [ ] **Step 2: Détecter et afficher le blocage pendant le survol**

Remplacer `updateDragTarget` :

```js
function updateDragTarget() {
  if (!dragState) return;
  dragState.raf = 0;
  const x = dragState.lastX, y = dragState.lastY;
  const el = document.elementFromPoint(x, y);
  document.querySelectorAll('.stage.drop-target').forEach((s) => s.classList.remove('drop-target'));
  document.querySelectorAll('.stage.drop-blocked').forEach((s) => s.classList.remove('drop-blocked'));
  const stageEl = el && el.closest ? el.closest('.stage') : null;
  let blockedEl = null;
  if (stageEl) {
    if (stageAcceptsDrop(stageEl, dragState.r)) {
      stageEl.classList.add('drop-target');
    } else if (blockedByPrice(dragState.r, stageEl.dataset.slug)) {
      stageEl.classList.add('drop-blocked');
      blockedEl = stageEl;
    }
  } else {
    // réordonnancement vertical dans la grille
    const after = getDragAfterElement($rows, y);
    if (after == null) $rows.appendChild(dragState.tr);
    else if (after !== dragState.tr) $rows.insertBefore(dragState.tr, after);
    paintZebra(); // garder les bandes cohérentes pendant le réordonnancement
  }
  if (blockedEl !== priceBlockedEl) {
    priceBlockedEl = blockedEl;
    if (blockedEl) showTip(blockedEl, PRICE_BLOCK_MESSAGE);
    else hideTip();
  }
  autoScroll(y);
}
```

- [ ] **Step 3: Style visuel de la cible refusée**

Dans `public/styles.css`, juste après `.stage.drop-target` (ligne 479-483) :

```css
.stage.drop-target {
  background: var(--primary-soft);
  box-shadow: inset 0 0 0 1.5px var(--primary);
  color: var(--primary);
}
.stage.drop-blocked {
  background: color-mix(in srgb, var(--st-bloque-bg) 45%, var(--surface));
  box-shadow: inset 0 0 0 1.5px var(--st-bloque);
  color: var(--st-bloque);
  cursor: not-allowed;
}
```

- [ ] **Step 4: Vérification visuelle**

Glisser une ligne sans prix au-dessus d'une sous-catégorie de Facturation (sans lâcher) :
la cible passe en accent « bloqué » (même teinte que l'état de ligne Bloquée) et une
bulle apparaît sous/au-dessus de la cible avec le message « Sans prix, impossible de
passer en Facturation. ». Déplacer le pointeur ailleurs : la bulle et l'accent
disparaissent. Faire le même geste avec une ligne qui a un prix : accent normal
(`drop-target`), pas de bulle.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/styles.css
git commit -m "Affiche une bulle d'avertissement au survol d'une cible Facturation refusée"
```

---

### Task 6: Toast au dépôt refusé + nettoyage en fin de glisser

**Files:**
- Modify: `public/app.js:2311-2358` (`onDragEnd`)

- [ ] **Step 1: Toast si le dépôt est refusé pour cause de prix**

Dans `onDragEnd`, la branche qui gère un dépôt refusé sur le rail :

```js
  if (stageEl) {
    // Relâché sur le rail. Une cible valide (sous-catégorie, ou famille sans
    // sous-catégorie) déplace la ligne ; un grand titre À sous-catégories la
    // refuse (on guide vers une sous-catégorie) ; même place = rien à faire.
    if (stageAcceptsDrop(stageEl, ds.r)) {
      const slug = stageEl.dataset.slug;
      const sub = stageEl.dataset.sub != null ? stageEl.dataset.sub : null;
      await moveToStage(ds.r, slug, sub);
    } else {
      if (stageEl.dataset.sub == null && familyHasSub(stageEl.dataset.slug)) {
        showToast('Dépose la ligne sur une sous-catégorie, pas sur le titre.');
      } else if (blockedByPrice(ds.r, stageEl.dataset.slug)) {
        showToast(PRICE_BLOCK_MESSAGE);
      }
      applySortAndRender(); // rien n'a bougé : on rétablit l'ordre trié de la grille
    }
  } else {
    await commitReorder(ds.r); // déposé dans la grille → réordonnancement
  }
```

- [ ] **Step 2: Nettoyer la bulle/l'accent à la fin du glisser**

Dans `onDragEnd`, juste après la ligne existante qui retire `.drop-target` (avant
`dragState = null;`) :

```js
  if (ds.ghost) ds.ghost.remove();
  ds.tr.classList.remove('dragging');
  document.body.classList.remove('dragging-active');
  document.querySelectorAll('.stage.drop-target').forEach((s) => s.classList.remove('drop-target'));
  document.querySelectorAll('.stage.drop-blocked').forEach((s) => s.classList.remove('drop-blocked'));
  hideTip();
  priceBlockedEl = null;
  dragState = null;
```

Ce nettoyage couvre aussi le cas d'un abandon en cours de route (ex. `pointercancel`) :
la bulle ne reste jamais affichée après la fin du geste.

- [ ] **Step 3: Vérification visuelle**

Glisser une ligne sans prix jusqu'à une sous-catégorie de Facturation et LÂCHER : la
ligne ne bouge pas, un toast « Sans prix, impossible de passer en Facturation. » apparaît
en bas d'écran, et aucune bulle ni accent ne reste affiché sur la sidebar après le
relâchement.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "Affiche un toast et nettoie la bulle au dépôt refusé pour cause de prix"
```

---

### Task 7: Flèche « étape suivante »

**Files:**
- Modify: `public/app.js:1173-1195` (`cellNext`)

- [ ] **Step 1: Bloquer le clic quand l'étape suivante entre en Facturation sans prix**

```js
function cellNext(r) {
  const td = document.createElement('td');
  td.className = 'col-next-cell';
  if (isDraftRow(r)) return td;
  const next = nextFlowStep(r);
  if (!next) return td;

  const btn = document.createElement('button');
  btn.className = 'next-btn';
  btn.type = 'button';
  const label = flowLabel(next);
  attachTip(btn, `Étape suivante → ${label}`);
  btn.setAttribute('aria-label', `Envoyer à l'étape suivante : ${label}`);
  btn.appendChild(arrowIcon());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTip();
    if (blockedByPrice(r, next.stage)) {
      showTip(btn, PRICE_BLOCK_MESSAGE);
      showToast(PRICE_BLOCK_MESSAGE);
      return;
    }
    showToast(`→ ${label}`);
    moveToStage(r, next.stage, next.sub);
  });
  td.appendChild(btn);
  return td;
}
```

- [ ] **Step 2: Vérification visuelle**

Prendre une ligne sans prix dont l'étape suivante est « Facturation à faire » (ex. en fin
de Production) : cliquer la flèche affiche la bulle + le toast, la ligne ne bouge pas.
Lui donner un prix (même 0), recliquer la flèche : la ligne avance normalement en
Facturation, toast habituel `→ Facturation à faire`.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "Bloque la flèche étape suivante quand elle entre en Facturation sans prix"
```

---

### Task 8: Vérification finale

**Files:** aucun changement — validation de bout en bout.

- [ ] **Step 1: Suite de tests complète**

Run: `npm test`
Expected: tous les fichiers `test/*.test.js` passent, y compris le nouveau
`test/price-block.test.js` et l'existant `test/next-flow-step.test.js` (non modifié,
donc toujours vert).

- [ ] **Step 2: Parcours manuel complet (serveur de preview, port 3000)**

- Saisir un prix sur une ligne « Production », le voir persister après F5.
- Glisser cette ligne (avec prix) vers Facturation → accepté, comportement inchangé.
- Sur une autre ligne sans prix : glisser vers Facturation → bulle au survol, accent
  « bloqué », refus au dépôt + toast.
- Même ligne sans prix : cliquer la flèche « étape suivante » si elle mène en
  Facturation → bulle + toast, aucun déplacement.
- Donner un prix à 0€ à cette ligne → glisser-déposer et flèche fonctionnent normalement
  (0€ n'est pas traité comme « sans prix »).
- Une ligne déjà en Facturation (au besoin, en désactiver temporairement le prix côté
  base pour le test) : réordonnancement et bascule entre les deux sous-étapes
  (Facturation à faire ↔ Prêt client / Attente retrait) toujours possibles.
- Redimensionner la fenêtre en largeur mobile (~390-430px) : la colonne Prix reste
  utilisable (input tactile ≥ 44px de hauteur via la règle globale `.cell-input` déjà en
  place pour ce breakpoint).

- [ ] **Step 3: Relire le diff complet**

```bash
git diff main --stat
```

Confirmer que seuls `public/app.js`, `public/index.html`, `public/styles.css` et
`test/price-block.test.js` ont changé — aucun fichier backend (`server.js`, `db.js`,
`schema.sql`) n'est touché, conformément à la spec.
