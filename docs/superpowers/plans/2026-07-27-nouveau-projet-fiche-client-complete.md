# Nouveau Projet — fiche client complète à la création — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le formulaire "Nouveau client" de l'onglet Nouveau Projet demande Prénom/Nom/Téléphone/Email pour un particulier, et tous les champs de la fiche Base Clients (sauf l'identifiant auto-généré) pour un pro — tous obligatoires.

**Architecture:** Ajout d'une colonne `prenom` sur `clients` (migration additive). `public/clients.js` exporte sa liste `FIELDS` et son rendu `fieldRow` ; `public/projet.js` les importe et les réutilise pour construire dynamiquement le quick-form selon la nature (perso/pro), avec un bouton de création désactivé tant qu'un champ n'est pas rempli. Aucun changement de la validation serveur (`POST /api/clients` reste "société obligatoire" pour ne pas casser la création depuis Base Clients).

**Tech Stack:** Node.js + Express + PostgreSQL (driver `pg`, pas d'ORM), JS vanilla en ES modules natifs côté front (pas de bundler), tests par scripts `node` sous `test/*.test.js`.

Référence : [docs/superpowers/specs/2026-07-27-nouveau-projet-fiche-client-complete-design.md](../specs/2026-07-27-nouveau-projet-fiche-client-complete-design.md)

**Correction par rapport au spec :** le spec mentionnait un ajout dans `schema.sql`. En lisant `db.js`, les colonnes additives précédentes (`code`, `raison_sociale`, `code_postal`, `ville`, `pays`, `secteur`, `referent_prenom`) n'ont **jamais** été ajoutées à `schema.sql` — uniquement à la boucle de migration (`db.js:180`), qui tourne à chaque démarrage y compris sur une base neuve (elle s'exécute juste après la création des tables de `schema.sql`). `prenom` suit exactement le même chemin : pas de changement dans `schema.sql`.

---

### Task 1: Migration — colonne `prenom` sur `clients`

**Files:**
- Modify: `db.js:180`

- [ ] **Step 1: Ajouter `prenom` à la boucle de migration existante**

Dans `db.js`, la boucle qui ajoute les colonnes enrichies ressemble à ceci (ligne 180) :

```js
  for (const col of ['code', 'raison_sociale', 'code_postal', 'ville', 'pays', 'secteur', 'referent_prenom']) {
```

Remplacer par :

```js
  for (const col of ['code', 'raison_sociale', 'code_postal', 'ville', 'pays', 'secteur', 'referent_prenom', 'prenom']) {
```

Le commentaire juste au-dessus (ligne 179, "Down : ALTER TABLE clients DROP COLUMN IF EXISTS <col> pour chacune.") reste valable tel quel — `prenom` suit la même règle de réversibilité (down = `ALTER TABLE clients DROP COLUMN IF EXISTS prenom`).

- [ ] **Step 2: Démarrer le serveur en local pour vérifier que la migration s'applique sans erreur**

Run: `node server.js`
Expected: le serveur démarre normalement (log de démarrage habituel), aucune erreur SQL dans la sortie. Arrêter avec Ctrl+C une fois le démarrage confirmé.

- [ ] **Step 3: Commit**

```bash
git add db.js
git commit -m "$(cat <<'EOF'
Ajoute la colonne prenom sur clients (migration réversible)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Serveur — accepter `prenom` dans `POST`/`PATCH /api/clients`

**Files:**
- Modify: `server.js:573-577`
- Test: `test/clients.test.js:171-175`

- [ ] **Step 1: Écrire le test qui échoue**

Dans `test/clients.test.js`, le bloc "7. Champs enrichis" (ligne 171) ressemble à ceci :

```js
  const proEnrichi = await j('POST', '/api/clients', {
    entreprise: 'SARL Evelyne', raison_sociale: 'SARL EVELYNE', code_postal: '97150',
    ville: 'Saint-Martin', pays: 'Saint-Martin', secteur: 'Hôtel / Restaurant',
    referent_prenom: 'Cédric', client_type: 'revendeur',
  });
  assert.strictEqual(proEnrichi.status, 201, JSON.stringify(proEnrichi.body));
  assert.strictEqual(proEnrichi.body.raison_sociale, 'SARL EVELYNE');
  assert.strictEqual(proEnrichi.body.code_postal, '97150');
  assert.strictEqual(proEnrichi.body.secteur, 'Hôtel / Restaurant');
```

Ajouter `prenom: 'Cédric'` au payload et l'assertion correspondante :

```js
  const proEnrichi = await j('POST', '/api/clients', {
    entreprise: 'SARL Evelyne', raison_sociale: 'SARL EVELYNE', code_postal: '97150',
    ville: 'Saint-Martin', pays: 'Saint-Martin', secteur: 'Hôtel / Restaurant',
    referent_prenom: 'Cédric', prenom: 'Evelyne', client_type: 'revendeur',
  });
  assert.strictEqual(proEnrichi.status, 201, JSON.stringify(proEnrichi.body));
  assert.strictEqual(proEnrichi.body.raison_sociale, 'SARL EVELYNE');
  assert.strictEqual(proEnrichi.body.code_postal, '97150');
  assert.strictEqual(proEnrichi.body.secteur, 'Hôtel / Restaurant');
  assert.strictEqual(proEnrichi.body.prenom, 'Evelyne');
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `node test/clients.test.js`
Expected: FAIL — `AssertionError` sur `proEnrichi.body.prenom` (`undefined` reçu au lieu de `'Evelyne'`), parce que `prenom` n'est pas encore dans `CLIENT_FIELDS` donc silencieusement ignoré par `POST /api/clients`.

- [ ] **Step 3: Ajouter `prenom` aux champs acceptés**

Dans `server.js`, `CLIENT_MAX` (ligne 573) :

```js
const CLIENT_MAX = {
  entreprise: 120, nom: 80, fonction: 80, type: 60, zone: 60,
  email: 160, telephone: 40, adresse: 200,
  raison_sociale: 120, code_postal: 12, ville: 80, pays: 60, secteur: 60, referent_prenom: 80,
};
```

Remplacer par :

```js
const CLIENT_MAX = {
  entreprise: 120, nom: 80, fonction: 80, type: 60, zone: 60,
  email: 160, telephone: 40, adresse: 200,
  raison_sociale: 120, code_postal: 12, ville: 80, pays: 60, secteur: 60, referent_prenom: 80,
  prenom: 80,
};
```

`CLIENT_FIELDS` (ligne 578, `[...Object.keys(CLIENT_MAX), 'client_type']`) inclut automatiquement `prenom` — aucun autre changement nécessaire, `POST` et `PATCH /api/clients` le valident et le persistent tous les deux via cette même liste.

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `node test/clients.test.js`
Expected: PASS — se termine par `✓ base clients : seed, CRUD, notes, création auto à la commande et dédoublonnage OK`.

- [ ] **Step 5: Lancer toute la suite de tests**

Run: `npm test`
Expected: tous les fichiers de `test/*.test.js` passent (aucune régression sur les autres suites).

- [ ] **Step 6: Commit**

```bash
git add server.js test/clients.test.js
git commit -m "$(cat <<'EOF'
Accepte le champ prenom sur POST/PATCH /api/clients

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `clients.js` — exporter `FIELDS`/`fieldRow`, ajouter le champ `prenom`

**Files:**
- Modify: `public/clients.js:29-45` (FIELDS), `public/clients.js:322` (fieldRow), `public/clients.js:522-532` (openNew)

- [ ] **Step 1: Ajouter `prenom` à `FIELDS` et exporter `FIELDS`/`fieldRow`**

`FIELDS` (ligne 29) actuel :

```js
const FIELDS = [
  { key: 'entreprise', label: 'Société', icon: 'apartment', ph: 'Nom de la société', required: true },
  { key: 'raison_sociale', label: 'Raison sociale', icon: 'gavel', ph: 'SARL Evelyne' },
  { key: 'code', label: 'Identifiant', icon: 'tag', ph: '—' },
  { key: 'nom', label: 'Contact', icon: 'person', ph: 'Personne à contacter' },
  { key: 'referent_prenom', label: 'Référent (prénom)', icon: 'badge', ph: 'Cédric' },
```

Remplacer les 2 premières lignes par (export ajouté + nouveau champ juste après `nom`) :

```js
export const FIELDS = [
  { key: 'entreprise', label: 'Société', icon: 'apartment', ph: 'Nom de la société', required: true },
  { key: 'raison_sociale', label: 'Raison sociale', icon: 'gavel', ph: 'SARL Evelyne' },
  { key: 'code', label: 'Identifiant', icon: 'tag', ph: '—' },
  { key: 'nom', label: 'Contact', icon: 'person', ph: 'Personne à contacter' },
  { key: 'prenom', label: 'Prénom', icon: 'badge', ph: 'Evelyne' },
  { key: 'referent_prenom', label: 'Référent (prénom)', icon: 'badge', ph: 'Cédric' },
```

(le reste du tableau, lignes 35-45, ne change pas)

- [ ] **Step 2: Exporter `fieldRow`**

`fieldRow` (ligne 322) actuel :

```js
function fieldRow(field, value, opts) {
```

Remplacer par :

```js
export function fieldRow(field, value, opts) {
```

- [ ] **Step 3: Ajouter `prenom` aux valeurs par défaut de `openNew()`**

`openNew()` (ligne 522) actuel :

```js
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

Remplacer par :

```js
function openNew() {
  drawer = {
    id: null, mode: 'create',
    draft: {
      entreprise: '', raison_sociale: '', nom: '', prenom: '', referent_prenom: '', fonction: '',
      client_type: 'pro', type: '', secteur: '', zone: '', code_postal: '', ville: '', pays: '',
      telephone: '', email: '', adresse: '',
    },
    notes: [],
  };
  renderDrawer();
}
```

- [ ] **Step 4: Lancer la suite de tests serveur (non-régression)**

Run: `npm test`
Expected: tous les tests passent toujours (ce fichier n'a pas de test dédié DOM, mais on vérifie qu'on n'a rien cassé côté serveur/build).

- [ ] **Step 5: Commit**

```bash
git add public/clients.js
git commit -m "$(cat <<'EOF'
Ajoute le champ Prénom à la fiche client, exporte FIELDS/fieldRow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `projet.js` — quick-form dynamique (perso = 4 champs, pro = fiche complète)

**Files:**
- Modify: `public/projet.js:1-20` (import), `public/projet.js:212-254` (`renderQuickForm`)

- [ ] **Step 1: Importer `FIELDS`/`fieldRow` et définir les deux listes de champs**

En tête de `public/projet.js` (avant la ligne 1, qui est le commentaire de fichier — l'import doit être la toute première instruction JS du module, donc juste après le bloc de commentaire d'en-tête et avant `let ROOT = null;` ligne 7) :

```js
// Nouveau Projet — Atelier OLDA
// LE flux comptoir : client (recherche/création) → panier (plusieurs produits,
// de types différents) → prix, façon caisse SumUp. Rendu entièrement par JS
// dans une section vide (même principe que clients.js / reglages.js), chargé
// à la demande par app.js.

import { FIELDS, fieldRow } from './clients.js';

let ROOT = null;
```

Juste après le bloc `fold` (ligne 20, avant la section "--- État ---"), ajouter les deux listes de champs du quick-form :

```js
const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// Quick-form "Nouveau client" (page Client) : un particulier ne demande que son
// identité + contact ; un pro demande TOUTE la fiche Base Clients (sauf
// `code`, généré côté serveur, et `prenom`, réservé au particulier — un pro
// n'a pas de prénom propre, seulement un référent).
const PRO_FIELDS = FIELDS.filter((f) => f.key !== 'code' && f.key !== 'prenom');
const PERSO_FIELDS = ['prenom', 'nom', 'telephone', 'email'].map((k) => FIELDS.find((f) => f.key === k));
```

- [ ] **Step 2: Réécrire `renderQuickForm`**

Le bloc actuel (ligne 212-254) :

```js
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
```

Remplacer par :

```js
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

    const fields = nature === 'perso' ? PERSO_FIELDS : PRO_FIELDS;
    const fieldsWrap = el('div', 'proj-quick__fields');
    for (const f of fields) fieldsWrap.appendChild(fieldRow(f, ''));
    quickForm.appendChild(fieldsWrap);
    const inputs = [...fieldsWrap.querySelectorAll('.cl-f__input')];

    const createBtn = el('button', 'proj-btn proj-btn--primary', 'Créer et continuer');
    createBtn.type = 'button';
    quickForm.appendChild(createBtn);

    // Tous les champs affichés sont obligatoires : le bouton reste désactivé
    // tant qu'il en manque un (perso comme pro).
    const updateCreateBtn = () => { createBtn.disabled = inputs.some((i) => !i.value.trim()); };
    for (const i of inputs) i.addEventListener('input', updateCreateBtn);
    updateCreateBtn();

    createBtn.addEventListener('click', async () => {
      const missing = inputs.find((i) => !i.value.trim());
      if (missing) { missing.focus(); return; }
      createBtn.disabled = true;
      const draft = { client_type: nature };
      for (const i of inputs) draft[i.dataset.key] = i.value.trim();
      // `entreprise` reste la colonne obligatoire côté serveur et sert à la
      // recherche/l'affichage : pour un particulier, on la dérive du prénom +
      // nom plutôt que de la demander une deuxième fois.
      if (nature === 'perso') draft.entreprise = `${draft.prenom} ${draft.nom}`.trim();
      try {
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
    inputs[0].focus();
  };
```

- [ ] **Step 3: Lancer la suite de tests serveur (non-régression)**

Run: `npm test`
Expected: tous les tests passent (ce changement est front-end pur, aucun test serveur ne l'exerce directement — la vérification visuelle se fait au Task 6).

- [ ] **Step 4: Commit**

```bash
git add public/projet.js
git commit -m "$(cat <<'EOF'
Quick-form Nouveau Projet : fiche complète pro, 4 champs perso

Réutilise FIELDS/fieldRow de clients.js, bouton désactivé tant qu'un
champ obligatoire est vide.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: CSS — grille responsive pour le quick-form élargi

**Files:**
- Modify: `public/projet.css:118-119`

- [ ] **Step 1: Passer `.proj-quick` en colonne et ajouter la grille des champs**

Actuel (ligne 118-119) :

```css
.proj-quick { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; padding: 14px; border: 1px dashed var(--border); border-radius: var(--radius-lg); align-items: center; }
.proj-quick[hidden] { display: none; }
```

Remplacer par :

```css
.proj-quick { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; margin-top: 6px; padding: 14px; border: 1px dashed var(--border); border-radius: var(--radius-lg); }
.proj-quick[hidden] { display: none; }
/* Une colonne (mobile, tablette portrait) ; 2 colonnes au-dessus de 720px
   (desktop, tablette paysage) — même breakpoint que `.cl-f` dans clients.css,
   qui bascule déjà label-au-dessus/label-à-côté au même seuil. */
.proj-quick__fields { align-self: stretch; display: grid; grid-template-columns: 1fr; gap: 4px 20px; }
@media (min-width: 720px) { .proj-quick__fields { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
```

- [ ] **Step 2: Commit**

```bash
git add public/projet.css
git commit -m "$(cat <<'EOF'
Grille responsive pour le quick-form Nouveau Projet élargi

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Vérification manuelle en navigateur

**Files:** aucun (vérification uniquement)

- [ ] **Step 1: Lancer le serveur en local**

Run: `node server.js`
Expected: démarrage sans erreur, port affiché dans les logs (généralement `http://localhost:3000`).

- [ ] **Step 2: Parcours Particulier**

Dans le navigateur : onglet **Nouveau Projet** → **+ Nouveau client** → nature **Perso**.
Vérifier :
- 4 champs affichés : Prénom, Nom, Téléphone, Email.
- Bouton "Créer et continuer" grisé/désactivé tant qu'un champ est vide.
- Une fois les 4 champs remplis, le bouton s'active ; cliquer crée le client et enchaîne sur l'étape suivante (type de projet).
- Rouvrir le client créé dans l'onglet **Base Clients** : le Prénom saisi est bien visible et éditable dans la fiche complète.

- [ ] **Step 3: Parcours Pro**

Depuis **Nouveau Projet** → **+ Nouveau client** → nature **Pro** (par défaut).
Vérifier :
- Tous les champs de la fiche complète sont affichés (Société, Raison sociale, Contact, Référent (prénom), Fonction, Type, Secteur, Zone, Code postal, Ville, Pays, Téléphone, Email, Adresse), et **pas** de champ Identifiant, **pas** de champ Prénom.
- Bouton désactivé tant qu'un champ manque ; activé une fois tout rempli.
- Layout : sur une largeur desktop (≥720px), les champs s'affichent sur 2 colonnes ; en réduisant la fenêtre sous 720px (ou vue mobile), ils passent en 1 colonne, chaque label au-dessus de son champ.
- Le client créé apparaît avec tous ses champs dans la fiche complète de **Base Clients**.

- [ ] **Step 4: Non-régression Base Clients**

Dans l'onglet **Base Clients**, cliquer sur **Nouveau** (son propre flux de création, distinct du quick-form) : vérifier qu'il reste possible de créer un client en ne renseignant **que** la Société (comportement inchangé — la validation stricte ne s'applique qu'au quick-form de Nouveau Projet).

- [ ] **Step 5: Lancer la suite de tests complète une dernière fois**

Run: `npm test`
Expected: tous les tests passent.
