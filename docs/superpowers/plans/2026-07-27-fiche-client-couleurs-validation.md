# Fiche client Pro/Perso — couleurs + validation forcée — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aligner les champs Pro/Perso de la fiche client (Nouveau Projet + Base Clients) sur le modèle de
référence de l'utilisateur, avec une différenciation couleur légère (vert Particulier / ambre Pro) et une
validation "tout rempli" visible et bloquante à la création, aux deux endroits.

**Architecture:** `public/clients.js` reste la source commune (`FIELDS`) ; on y ajoute deux listes de clés
(`PRO_FIELDS`/`PERSO_FIELDS`), un helper `fieldsForNature()`, et un helper de validation
`wireCreateValidation()` réutilisés tels quels par `public/projet.js`. Aucun changement serveur/DB.

**Tech Stack:** JS vanilla (ES modules navigateur), CSS avec custom properties existantes (`styles.css`),
tests Node natifs (`node:assert`, `node:test`-free scripts) pour le serveur uniquement.

**Référence :** design doc [docs/superpowers/specs/2026-07-27-fiche-client-couleurs-validation-design.md](../specs/2026-07-27-fiche-client-couleurs-validation-design.md).

---

### Task 1: `FIELDS` — relabellisation + retrait de `type`

**Files:**
- Modify: `public/clients.js:29-44`

- [ ] **Step 1: Modifier le tableau `FIELDS`**

Remplacer les lignes 29-44 actuelles par :

```js
export const FIELDS = [
  { key: 'entreprise', label: 'Société', icon: 'apartment', ph: 'Nom de la société', required: true },
  { key: 'raison_sociale', label: 'Raison sociale', icon: 'gavel', ph: 'SARL Evelyne' },
  { key: 'code', label: 'Identifiant', icon: 'tag', ph: '—' },
  { key: 'nom', label: 'Nom', icon: 'person', ph: 'Nom de famille' },
  { key: 'prenom', label: 'Prénom', icon: 'badge', ph: 'Evelyne' },
  { key: 'referent_prenom', label: 'Référent (prénom)', icon: 'badge', ph: 'Cédric' },
  { key: 'secteur', label: 'Secteur d’activité', icon: 'work', ph: 'Hôtel / Restaurant, Boutique…', list: 'cl-dl-secteurs' },
  { key: 'zone', label: 'Localisation', icon: 'location_on', ph: 'Grand Case, Marigot…', list: 'cl-dl-zones' },
  { key: 'code_postal', label: 'Code postal', icon: 'markunread_mailbox', ph: '97150' },
  { key: 'ville', label: 'Ville', icon: 'location_city', ph: 'Saint-Martin' },
  { key: 'pays', label: 'Pays', icon: 'public', ph: 'Saint-Martin' },
  { key: 'telephone', label: 'WhatsApp', icon: 'call', ph: '06 90 …', type: 'tel', inputmode: 'tel' },
  { key: 'email', label: 'E-mail', icon: 'mail', ph: 'contact@…', type: 'email', inputmode: 'email' },
];

// Champs affichés à la CRÉATION (et à l'édition) selon la nature du client.
// `code` (identifiant serveur) est géré à part : jamais dans ces listes, montré
// en lecture seule uniquement en édition. `type` (texte libre "Boutique,
// Hôtel…") n'est plus proposé dans les formulaires — redondant avec Secteur —
// mais la colonne reste lisible pour les fiches qui en ont déjà une.
export const PERSO_FIELDS = ['prenom', 'nom', 'telephone', 'email'];
export const PRO_FIELDS = [
  'entreprise', 'raison_sociale', 'zone', 'code_postal', 'ville', 'pays',
  'referent_prenom', 'telephone', 'secteur', 'email',
];

export function fieldsForNature(nat) {
  const keys = nat === 'perso' ? PERSO_FIELDS : PRO_FIELDS;
  return keys.map((k) => FIELDS.find((f) => f.key === k));
}
```

Le champ `type` disparaît du tableau `FIELDS` : il n'est plus référencé par aucune liste de rendu. Les
usages existants de `c.type`/`drawer.draft.type` (sous-titres `clients.js:262`, `clients.js:377`,
`clients.js:557`) continuent de fonctionner tels quels — ils lisent la donnée brute du client, pas `FIELDS`.

- [ ] **Step 2: Vérifier qu'aucun autre fichier ne référence l'ancien libellé "Contact"**

```bash
grep -rn "'Contact'\|\"Contact\"" public/
```

Attendu : aucune occurrence (le seul était `FIELDS`, déjà changé).

- [ ] **Step 3: Commit**

```bash
git add public/clients.js
git commit -m "Aligne les champs client sur le modèle de référence (Localisation, WhatsApp, retrait Type)"
```

---

### Task 2: Helper de validation partagé `wireCreateValidation`

**Files:**
- Modify: `public/clients.js` (ajouter après `fieldRow`, ligne ~342)

- [ ] **Step 1: Ajouter la fonction exportée**

Insérer juste après la fermeture de `export function fieldRow(...) { ... }` (après la ligne `342` actuelle,
`return row; }`) :

```js
// Validation "tout rempli" partagée par le tiroir Base Clients ET le
// quick-form Nouveau Projet : bouton bloqué tant qu'il manque un champ,
// ligne d'état qui nomme précisément ce qui manque, et surlignage d'un champ
// laissé vide au blur (jamais au chargement — le formulaire est vide par
// défaut, on ne veut pas tout voir rouge à l'ouverture).
export function wireCreateValidation(fieldsWrap, submitBtn, hintEl) {
  const inputs = [...fieldsWrap.querySelectorAll('.cl-f__input')];
  const labelOf = (input) => {
    const row = input.closest('.cl-f');
    const labelSpan = row && row.querySelector('.cl-f__label').lastElementChild;
    return labelSpan ? labelSpan.textContent : '';
  };
  const refresh = () => {
    const missing = inputs.filter((i) => !i.value.trim());
    submitBtn.disabled = missing.length > 0;
    for (const i of inputs) {
      if (i.value.trim()) i.classList.remove('cl-f__input--missing');
    }
    if (missing.length === 0) {
      hintEl.textContent = 'Prêt à créer.';
      hintEl.className = 'cl-fields__hint cl-fields__hint--ok';
    } else {
      hintEl.textContent = `Il manque : ${missing.map(labelOf).join(', ')}`;
      hintEl.className = 'cl-fields__hint cl-fields__hint--warn';
    }
  };
  for (const i of inputs) {
    i.addEventListener('input', refresh);
    i.addEventListener('blur', () => {
      if (!i.value.trim()) i.classList.add('cl-f__input--missing');
    });
  }
  refresh();
}
```

- [ ] **Step 2: Commit**

```bash
git add public/clients.js
git commit -m "Ajoute wireCreateValidation, validation partagée pour la création client"
```

---

### Task 3: CSS — teinte nature + hint + champ manquant

**Files:**
- Modify: `public/clients.css` (ajouter après la règle `.cl-nature--perso`, ligne 215)

- [ ] **Step 1: Ajouter les nouvelles règles**

Insérer après `.cl-nature--perso { color: var(--st-archive); background: var(--st-archive-bg); }` (ligne 215) :

```css
/* Teinte légère façon SumUp autour du GROUPE de champs (pas la puce Nature
   elle-même, pas chaque case) — vert Particulier, ambre Pro/Revendeur/Asso.
   Réutilise la palette d'étapes existante, aucune nouvelle couleur. */
.cl-fields__group {
  display: flex;
  flex-direction: column;
  border-radius: var(--radius);
  padding: 2px 12px;
  border-left: 3px solid transparent;
}
.cl-fields__group--pro { border-left-color: var(--st-cours); background: var(--st-cours-bg); }
.cl-fields__group--perso { border-left-color: var(--st-livree); background: var(--st-livree-bg); }

.cl-fields__hint {
  margin: 10px 2px 0;
  font-size: 13px;
  color: var(--text-2);
}
.cl-fields__hint--warn { color: var(--st-cours); font-weight: 600; }
.cl-fields__hint--ok { color: var(--st-livree); font-weight: 600; }

.cl-f__input--missing {
  border-color: var(--st-bloque);
  background: var(--st-bloque-bg);
}
```

- [ ] **Step 2: Commit**

```bash
git add public/clients.css
git commit -m "Ajoute les styles de teinte nature + validation (vert/ambre, hint, champ manquant)"
```

---

### Task 4: `renderDrawer()` — champs nature-aware + validation + focus corrigé

**Files:**
- Modify: `public/clients.js:400-421` (bloc champs) et `public/clients.js:487-499` (pied de page création)

- [ ] **Step 1: Remplacer le bloc de rendu des champs**

Remplacer (lignes 400-421 actuelles) :

```js
  // Champs éditables. La NATURE pro/perso ouvre la fiche : segmented, pas texte.
  const fields = el('div', 'cl-fields');
  const natRow = el('div', 'cl-f cl-f--nature');
  const natLab = el('span', 'cl-f__label');
  natLab.append(ic('badge', 'cl-f__ic'), el('span', null, 'Nature'));
  const seg = el('div', 'cl-seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Nature du client');
  const cur = nature(c.client_type);
  for (const n of NATURES) {
    const nb = el('button', `cl-seg__btn${n.id === cur ? ' is-on' : ''}`, n.label);
    nb.type = 'button';
    nb.dataset.nature = n.id;
    nb.setAttribute('role', 'radio');
    nb.setAttribute('aria-checked', String(n.id === cur));
    seg.append(nb);
  }
  natRow.append(natLab, seg);
  fields.append(natRow);
  for (const f of FIELDS) fields.append(fieldRow(f, c[f.key]));
  bodyScroll.append(fields);
```

par :

```js
  // Champs éditables. La NATURE pro/perso ouvre la fiche : segmented, pas texte.
  const fields = el('div', 'cl-fields');
  const natRow = el('div', 'cl-f cl-f--nature');
  const natLab = el('span', 'cl-f__label');
  natLab.append(ic('badge', 'cl-f__ic'), el('span', null, 'Nature'));
  const seg = el('div', 'cl-seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Nature du client');
  const cur = nature(c.client_type);
  for (const n of NATURES) {
    const nb = el('button', `cl-seg__btn${n.id === cur ? ' is-on' : ''}`, n.label);
    nb.type = 'button';
    nb.dataset.nature = n.id;
    nb.setAttribute('role', 'radio');
    nb.setAttribute('aria-checked', String(n.id === cur));
    seg.append(nb);
  }
  natRow.append(natLab, seg);
  fields.append(natRow);
  // Identifiant : lecture seule, uniquement utile une fois le client créé.
  if (!creating) {
    const codeField = FIELDS.find((f) => f.key === 'code');
    fields.append(fieldRow(codeField, c.code));
  }
  const tintClass = cur === 'perso' ? 'cl-fields__group--perso' : 'cl-fields__group--pro';
  const fieldGroup = el('div', `cl-fields__group ${tintClass}`);
  for (const f of fieldsForNature(cur)) fieldGroup.append(fieldRow(f, c[f.key]));
  fields.append(fieldGroup);
  let hint = null;
  if (creating) {
    hint = el('p', 'cl-fields__hint');
    fields.append(hint);
  }
  bodyScroll.append(fields);
```

- [ ] **Step 2: Brancher la validation et corriger le focus du premier champ**

Remplacer (lignes 487-499 actuelles) :

```js
  // Pied : en création, bouton Créer.
  if (creating) {
    const foot = el('footer', 'cl-dfoot');
    const cancel = el('button', 'cl-btn', 'Annuler');
    cancel.type = 'button';
    cancel.id = 'cl-close-2';
    const create = el('button', 'cl-btn cl-btn--primary', 'Créer le client');
    create.type = 'button';
    create.id = 'cl-create';
    foot.append(cancel, create);
    card.append(foot);
    setTimeout(() => { const e = $('#cl-f-entreprise'); if (e) e.focus(); }, 40);
  }
```

par :

```js
  // Pied : en création, bouton Créer.
  if (creating) {
    const foot = el('footer', 'cl-dfoot');
    const cancel = el('button', 'cl-btn', 'Annuler');
    cancel.type = 'button';
    cancel.id = 'cl-close-2';
    const create = el('button', 'cl-btn cl-btn--primary', 'Créer le client');
    create.type = 'button';
    create.id = 'cl-create';
    foot.append(cancel, create);
    card.append(foot);
    wireCreateValidation(fieldGroup, create, hint);
    setTimeout(() => {
      const first = fieldGroup.querySelector('.cl-f__input');
      if (first) first.focus();
    }, 40);
  }
```

Note : `fieldsForNature` doit être importable — elle est définie et exportée dans le même fichier
(`clients.js`), donc directement utilisable sans import.

- [ ] **Step 3: Commit**

```bash
git add public/clients.js
git commit -m "Rend le tiroir client nature-aware (champs filtrés, teinte, validation)"
```

---

### Task 5: `setNature()` — re-render des champs au changement de nature

**Files:**
- Modify: `public/clients.js:566-588`

- [ ] **Step 1: Remplacer `setNature`**

Remplacer (lignes 568-588 actuelles) :

```js
async function setNature(value) {
  if (!drawer) return;
  const nat = nature(value);
  const unchanged = nature(drawer.draft.client_type) === nat;
  drawer.draft.client_type = nat;
  for (const b of ROOT.querySelectorAll('.cl-seg__btn')) {
    const on = b.dataset.nature === nat;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  }
  if (drawer.mode !== 'edit' || unchanged) return;   // création, ou rien à changer
  try {
    const updated = await api('PATCH', `/api/clients/${drawer.id}`, { client_type: nat });
    drawer.draft = { ...drawer.draft, ...updated };
    const i = LIST.findIndex((c) => c.id === drawer.id);
    if (i >= 0) LIST[i] = { ...LIST[i], ...updated };
    renderList();
  } catch (err) {
    toast(err.message || 'Modification refusée.');
  }
}
```

par :

```js
async function setNature(value) {
  if (!drawer) return;
  const nat = nature(value);
  const unchanged = nature(drawer.draft.client_type) === nat;
  drawer.draft.client_type = nat;
  // La liste de champs affichée dépend de la nature : on re-render tout de
  // suite (création ET édition), avant même le PATCH réseau en édition.
  if (!unchanged) renderDrawer();
  if (drawer.mode !== 'edit' || unchanged) return;   // création, ou rien à changer
  try {
    const updated = await api('PATCH', `/api/clients/${drawer.id}`, { client_type: nat });
    drawer.draft = { ...drawer.draft, ...updated };
    const i = LIST.findIndex((c) => c.id === drawer.id);
    if (i >= 0) LIST[i] = { ...LIST[i], ...updated };
    renderList();
  } catch (err) {
    toast(err.message || 'Modification refusée.');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add public/clients.js
git commit -m "Re-render les champs de la fiche client au changement de nature"
```

---

### Task 6: `createClient()` — n'envoyer/valider que les champs affichés

**Files:**
- Modify: `public/clients.js:590-610`

- [ ] **Step 1: Remplacer `createClient`**

Remplacer (lignes 590-610 actuelles) :

```js
async function createClient() {
  if (!drawer || drawer.mode !== 'create') return;
  const draft = { client_type: nature(drawer.draft.client_type) };
  for (const f of FIELDS) {
    const input = $(`#cl-f-${f.key}`);
    if (input) draft[f.key] = input.value.trim();
  }
  if (!draft.entreprise) { toast('Le nom de la société est requis.'); const e = $('#cl-f-entreprise'); if (e) e.focus(); return; }
  const btn = $('#cl-create');
  if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }
  try {
    const created = await api('POST', '/api/clients', draft);
    LIST.push({ ...created, notes_count: 0, commandes: 0 });
    await openClient(created.id);
    renderList();
    toast('Client créé.');
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Créer le client'; }
    toast(err.message || 'Création impossible.');
  }
}
```

par :

```js
async function createClient() {
  if (!drawer || drawer.mode !== 'create') return;
  const nat = nature(drawer.draft.client_type);
  const draft = { client_type: nat };
  const shown = fieldsForNature(nat);
  for (const f of shown) {
    const input = $(`#cl-f-${f.key}`);
    if (input) draft[f.key] = input.value.trim();
  }
  const missing = shown.find((f) => !draft[f.key]);
  if (missing) {
    toast('Merci de remplir tous les champs.');
    const e = $(`#cl-f-${missing.key}`);
    if (e) e.focus();
    return;
  }
  // `entreprise` reste la colonne obligatoire côté serveur : pour un
  // particulier, on la dérive du prénom + nom plutôt que de la demander une
  // deuxième fois (même logique que le quick-form Nouveau Projet).
  if (nat === 'perso') draft.entreprise = `${draft.prenom} ${draft.nom}`.trim();
  const btn = $('#cl-create');
  if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }
  try {
    const created = await api('POST', '/api/clients', draft);
    LIST.push({ ...created, notes_count: 0, commandes: 0 });
    await openClient(created.id);
    renderList();
    toast('Client créé.');
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Créer le client'; }
    toast(err.message || 'Création impossible.');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add public/clients.js
git commit -m "createClient() ne valide/envoie que les champs affichés selon la nature"
```

---

### Task 7: `projet.js` — brancher les mêmes listes/validation/teinte

**Files:**
- Modify: `public/projet.js:1-34` (imports + retrait des listes locales)
- Modify: `public/projet.js:226-277` (`renderQuickForm`)

- [ ] **Step 1: Mettre à jour les imports et retirer les listes locales**

Remplacer (lignes 1-34 actuelles, du commentaire d'en-tête jusqu'à la fin de `PERSO_FIELDS`) :

```js
// Nouveau Projet — Atelier OLDA
// LE flux comptoir : client (recherche/création) → panier (plusieurs produits,
// de types différents) → prix, façon caisse SumUp. Rendu entièrement par JS
// dans une section vide (même principe que clients.js / reglages.js), chargé
// à la demande par app.js.

import { FIELDS, fieldRow } from './clients.js';
```

... jusqu'à ...

```js
// Quick-form "Nouveau client" (page Client) : un particulier ne demande que son
// identité + contact ; un pro demande TOUTE la fiche Base Clients (sauf
// `code`, généré côté serveur, et `prenom`, réservé au particulier — un pro
// n'a pas de prénom propre, seulement un référent).
const PRO_FIELDS = FIELDS.filter((f) => f.key !== 'code' && f.key !== 'prenom');
// Le champ `nom` porte le libellé « Contact » dans la fiche pro (personne à
// contacter chez le client) — pour un particulier c'est son propre nom de
// famille, donc on relabellise juste pour ce contexte.
const PERSO_FIELDS = ['prenom', 'nom', 'telephone', 'email']
  .map((k) => FIELDS.find((f) => f.key === k))
  .map((f) => (f.key === 'nom' ? { ...f, label: 'Nom', ph: 'Nom de famille' } : f));
```

par :

```js
// Nouveau Projet — Atelier OLDA
// LE flux comptoir : client (recherche/création) → panier (plusieurs produits,
// de types différents) → prix, façon caisse SumUp. Rendu entièrement par JS
// dans une section vide (même principe que clients.js / reglages.js), chargé
// à la demande par app.js.

import { fieldRow, fieldsForNature, wireCreateValidation } from './clients.js';
```

(Le reste du fichier, à partir de `let ROOT = null;`, ne change pas — seule la ligne d'import et le bloc
`PRO_FIELDS`/`PERSO_FIELDS` disparaissent : la logique vit maintenant dans `clients.js`.)

- [ ] **Step 2: Mettre à jour `renderQuickForm`**

Remplacer (lignes 226-277 actuelles) :

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
  newBtn.addEventListener('click', () => renderQuickForm('pro'));
```

par :

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

    // Teinte légère façon SumUp : vert Particulier, ambre Pro — même palette
    // que la fiche complète (Base Clients).
    quickForm.classList.toggle('proj-quick--perso', nature === 'perso');
    quickForm.classList.toggle('proj-quick--pro', nature !== 'perso');

    const fieldsWrap = el('div', 'proj-quick__fields');
    for (const f of fieldsForNature(nature)) fieldsWrap.appendChild(fieldRow(f, ''));
    quickForm.appendChild(fieldsWrap);
    const inputs = [...fieldsWrap.querySelectorAll('.cl-f__input')];

    const hint = el('p', 'cl-fields__hint');
    quickForm.appendChild(hint);

    const createBtn = el('button', 'proj-btn proj-btn--primary', 'Créer et continuer');
    createBtn.type = 'button';
    quickForm.appendChild(createBtn);

    // Tous les champs affichés sont obligatoires : le bouton reste désactivé
    // et la ligne d'état nomme précisément ce qui manque (perso comme pro).
    wireCreateValidation(fieldsWrap, createBtn, hint);

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
  newBtn.addEventListener('click', () => renderQuickForm('pro'));
```

- [ ] **Step 3: Commit**

```bash
git add public/projet.js
git commit -m "Nouveau Projet : champs/validation/teinte partagés avec Base Clients"
```

---

### Task 8: CSS — teinte nature pour `.proj-quick`

**Files:**
- Modify: `public/projet.css:118-124`

- [ ] **Step 1: Ajouter les variantes de teinte**

Remplacer (ligne 118 actuelle) :

```css
.proj-quick { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; margin-top: 6px; padding: 14px; border: 1px dashed var(--border); border-radius: var(--radius-lg); }
```

par :

```css
.proj-quick { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; margin-top: 6px; padding: 14px; border: 1px solid var(--border); border-left: 3px solid transparent; border-radius: var(--radius-lg); }
/* Teinte légère façon SumUp : vert Particulier, ambre Pro/Revendeur/Asso —
   même palette que la fiche complète (Base Clients), zéro nouvelle couleur. */
.proj-quick--perso { border-left-color: var(--st-livree); background: var(--st-livree-bg); }
.proj-quick--pro { border-left-color: var(--st-cours); background: var(--st-cours-bg); }
```

(Le fond dashed d'origine devient un liseré plein neutre par défaut ; la couleur n'apparaît qu'une fois une
nature choisie, ce qui est systématique puisque `renderQuickForm` pose toujours l'une des deux classes.)

- [ ] **Step 2: Commit**

```bash
git add public/projet.css
git commit -m "Teinte nature (vert/ambre) sur le quick-form Nouveau Projet"
```

---

### Task 9: Vérification — suite de tests existante

**Files:** aucun changement, vérification uniquement.

- [ ] **Step 1: Lancer la suite de tests serveur**

```bash
npm test
```

Expected: tous les tests passent (aucun changement serveur/DB n'a été fait ; cette étape confirme
l'absence de régression côté API).

---

### Task 10: Vérification manuelle en navigateur

**Files:** aucun changement, vérification uniquement.

- [ ] **Step 1: Démarrer le serveur en local et ouvrir l'app**

Utiliser l'outil de preview du navigateur (pas de commande manuelle) pour lancer le serveur local et
naviguer vers l'app.

- [ ] **Step 2: Nouveau Projet — Perso**

Aller sur "Nouveau Projet" → "Nouveau client" → onglet "Perso". Vérifier :
- 4 champs affichés (Prénom, Nom, WhatsApp, Email), tous vides par défaut.
- Bandeau vert doux autour des champs.
- Bouton "Créer et continuer" désactivé, ligne "Il manque : …" à jour à chaque saisie.
- Laisser un champ vide puis cliquer/quitter (blur) → bordure rouge sur ce champ.
- Remplir les 4 → ligne devient "Prêt à créer.", bouton actif, création OK.

- [ ] **Step 3: Nouveau Projet — Pro**

Même parcours sur l'onglet "Pro". Vérifier les 10 champs exacts (Nom affiché/Entreprise, Raison sociale,
Localisation, Code postal, Ville, Pays, Référent (prénom), WhatsApp, Secteur d'activité, Email), bandeau
ambre, mêmes comportements de validation.

- [ ] **Step 4: Base Clients — création + édition**

Ouvrir "Base Clients" → "Nouveau client" : vérifier la même liste de champs/teinte/validation que Nouveau
Projet selon la nature choisie dans le segmented, et que basculer Pro ↔ Perso change bien la liste de champs
affichée en direct. Ouvrir une fiche existante : vérifier que l'Identifiant (code) est visible en lecture
seule, que la nature affiche le bon jeu de champs, et que passer un client existant de Pro à Perso (ou
inverse) dans le segmented change bien l'affichage sans tout casser.

- [ ] **Step 5: Thème sombre + mobile**

Basculer le thème sombre (vérifier lisibilité des teintes vert/ambre) et réduire la fenêtre à ~390px
(vérifier que le formulaire reste lisible en une colonne).

- [ ] **Step 6: Capture d'écran de preuve**

Prendre une capture des deux formulaires (Pro et Perso) en clair, à joindre au rapport final.

---

## Déploiement

Une fois toutes les tâches ci-dessus vertes (tests + vérification manuelle), merger sur `main` — le
déploiement Railway est automatique sur push (`main` branché sur GitHub).
