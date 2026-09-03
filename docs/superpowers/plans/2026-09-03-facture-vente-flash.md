# Facture Vente Flash — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer un document Facture immuable et numéroté sans trou, et un écran
« Vente Flash » (`#vente-flash`) qui le compose devant le client — jumeau du
devis flash, à côté de l'écran comptoir existant sans le remplacer.

**Architecture:** Nouveau papier `public/facture.js` (modèle pur + rendu pur +
CSS autonome, posé sur le socle `papier.js`, réutilisant le moteur d'argent
`calculerDevis` de `devis.js`). Nouvelle table `invoices` en base, ledger
immuable, numérotation continue par année réservée et insérée dans LA MÊME
transaction. Nouvel écran `public/vente-flash.js`, porté depuis
`public/devis-flash.js` (copie + modifications ciblées, pas d'extraction de
module partagé — décision du 03/09, voir spec §1). L'écran appelle la route
existante `POST /api/comptoir/projet` pour créer le dossier (routage
production inchangé), puis `POST /api/factures` pour émettre le document.

**Tech Stack:** Node.js/Express (`server.js`), PostgreSQL (`schema.sql`, pool
`pg`/pg-mem en local), modules ES natifs côté client (aucun build), tests
lancés en scripts autonomes `node fichier.test.js` (`npm test` les enchaîne
tous, voir `package.json`), `node:assert`, bootstrap serveur réel pour les
routes, bac-à-sable `vm` pour les modules papier.

**Spec:** [docs/superpowers/specs/2026-09-03-facture-vente-flash-design.md](../specs/2026-09-03-facture-vente-flash-design.md)

## Global Constraints

- `npm test` doit rester vert après CHAQUE tâche — jamais de commit avec des
  tests rouges.
- Aucun build : les fichiers `public/*.js` sont des modules ES natifs, chargés
  tels quels par le navigateur. Pas de bundler, pas de transpileur.
- Aucun accent grave dans un gabarit de papier (`CSS_FACTURE`, tout template
  literal de `facture.js`) — le caractère referme le gabarit, `node --check`
  passe quand même, l'écran s'ouvre nu.
- Aucun jeton `charte.css` (`var(--...)`) dans `CSS_FACTURE` — le cadre
  d'impression ne charge que cette chaîne, un jeton non résolu y vaut la
  chaîne vide.
- Toute date civile calculée côté serveur passe par `America/Marigot`
  (Saint-Martin, UTC−4, pas d'heure d'été) — jamais `new Date()` seul.
- Aucune route PUT/PATCH/DELETE sur `invoices`, jamais, dans ce lot.
- Aucune modification du comportement de `POST /api/comptoir/projet`, de
  `public/comptoir/vente-directe.html` ni de `public/comptoir/pont.js`.
- Pas d'extraction du sélecteur d'article catalogue en module partagé dans ce
  lot — `vente-flash.js` porte sa propre copie, modifiée. C'est un choix
  déjà tranché (spec §1), pas une question ouverte.
- Suivre les conventions déjà en place : pas de contrainte `REFERENCES`
  (foreign key) dans `schema.sql` — aucune table du dépôt n'en porte,
  `client_id` sur `projects` est un `uuid` nu par exemple.

---

## Task 1: La table `invoices`

**Files:**
- Modify: `schema.sql`

**Interfaces:**
- Produces: table `invoices(id, numero, annee, rang, dossier_id, client_nom, montant_ttc, emise_le, emise_par, document, created_at)` — consommée par Task 5 (routes serveur).

- [ ] **Step 1: Ajouter la table à `schema.sql`**

À la fin du fichier (après la table `catalogue_produits` et son index), ajouter :

```sql
-- LA FACTURE — ledger immuable, jamais réécrit après émission (03/09/2026).
--
-- Une facture Vente Flash naît TOUJOURS d'un dossier déjà créé par
-- POST /api/comptoir/projet — d'où `dossier_id NOT NULL UNIQUE` : au plus une
-- facture par dossier en v1 (les avoirs, hors scope, seront un second lot).
--
-- `document` porte le modèle ENTIER tel qu'imprimé (sortie de modeleFacture),
-- identité de la maison comprise : un changement plus tard dans Réglages ne
-- doit jamais réécrire une facture déjà sortie. Même principe que
-- `fiche.devis`, qui fige le prix d'un devis déjà remis au client.
--
-- AUCUNE ROUTE D'ÉCRITURE APRÈS CRÉATION, jamais. Une facture émise ne se
-- corrige pas — elle se conteste par un avoir (hors scope ici).
-- Down : DROP TABLE invoices; DELETE FROM app_meta WHERE key LIKE 'facture_seq_%';
CREATE TABLE IF NOT EXISTS invoices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero       text NOT NULL UNIQUE,        -- "FA-2026-0001"
  annee        int  NOT NULL,               -- retrouver l'année sans parser numero
  rang         int  NOT NULL,               -- rang dans l'année
  dossier_id   uuid NOT NULL UNIQUE,        -- pas de REFERENCES : aucune table du dépôt n'en porte
  client_nom   text NOT NULL,               -- dénormalisé pour lister/chercher, jamais relu pour recalculer
  montant_ttc  numeric(12,2) NOT NULL,
  emise_le     timestamptz NOT NULL DEFAULT now(),
  emise_par    text,                        -- le poste, comme fiche.poste ailleurs
  document     jsonb NOT NULL,              -- le modèle COMPLET tel qu'imprimé
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_dossier ON invoices (dossier_id);
```

Cette table est neuve (pas d'ALTER sur une table existante) : `CREATE TABLE IF
NOT EXISTS` dans `schema.sql`, rejoué tel quel à chaque démarrage
(`db.js#init` fait `pool.query(schema)`), suffit — pas besoin d'une garde
`app_meta` séparée dans `db.js` (celles-ci ne servent qu'aux migrations qui
altèrent une table déjà peuplée).

- [ ] **Step 2: Vérifier que le serveur démarre toujours en local (pg-mem)**

Run: `npm test -- test/comptoir.test.js`
Expected: PASS (la table se crée sans erreur au boot ; ce test existant sert
juste de canari — il démarre le serveur comme tous les tests API).

- [ ] **Step 3: Commit**

```bash
git add schema.sql
git commit -m "$(cat <<'EOF'
feat(db): table invoices, ledger immuable

Aucune colonne mutable après création, aucune route d'écriture ne
sera ajoutée dessus. dossier_id est UNIQUE : une facture par dossier
en v1, pas de contrainte REFERENCES (convention du dépôt).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Exporter les petits formatteurs partagés de `devis.js`

**Files:**
- Modify: `public/devis.js:37-44` (fonctions privées `texte`, `EURO`/`euro`, `cents`), `public/devis.js:56-58` (`dateSeule`)

**Interfaces:**
- Produces: `texte(v)`, `euro(n)`, `cents(n)`, `dateSeule(iso)` — désormais exportés, consommés par Task 3 (`facture.js` les importe au lieu de les redéclarer).

**Pourquoi** : `facture.js` va importer `calculerDevis` de `devis.js` (un seul
moteur d'arithmétique pour les deux documents). Le test de `facture.js`
(Task 4) évalue les DEUX fichiers dans le MÊME bac à sable `vm` — si
`facture.js` redéclarait ses propres `const texte = ...`/`const euro = ...`,
ce serait une redéclaration de l'identifiant déjà posé par `devis.js` dans ce
même script concaténé → `SyntaxError`. Exporter ces quatre helpers et les
importer résout le problème à la racine, et c'est aussi la bonne architecture
(un `13,50 €` doit se formater identiquement sur les deux papiers).

- [ ] **Step 1: Ajouter `export` sur les quatre déclarations**

Dans `public/devis.js`, ligne 37 :
```js
const texte = (v) => String(v == null ? '' : v).trim();
```
devient :
```js
export const texte = (v) => String(v == null ? '' : v).trim();
```

Ligne 39-40 :
```js
const EURO = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const euro = (n) => (Number.isFinite(Number(n)) ? EURO.format(Number(n)) : '');
```
devient :
```js
const EURO = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
export const euro = (n) => (Number.isFinite(Number(n)) ? EURO.format(Number(n)) : '');
```

Ligne 44 :
```js
const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
```
devient :
```js
export const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
```

Ligne 56-58 :
```js
function dateSeule(iso) {
  const m = texte(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
```
devient :
```js
export function dateSeule(iso) {
  const m = texte(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
```

- [ ] **Step 2: Vérifier que la suite existante reste verte**

Run: `npm test -- test/devis-flash.test.js`
Expected: PASS — `export` ajouté sur une const déjà utilisée localement ne
change aucun comportement, seulement la surface exportée.

- [ ] **Step 3: Commit**

```bash
git add public/devis.js
git commit -m "$(cat <<'EOF'
refactor(devis): exporte texte/euro/cents/dateSeule

La facture va réutiliser ces quatre formatteurs plutôt que les
redéclarer — un seul moteur d'arithmétique et de mise en forme pour
les deux documents.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Le module `chargerPapier` accepte des dépendances supplémentaires

**Files:**
- Modify: `test/socle-papier.js`

**Interfaces:**
- Consumes: rien de nouveau (signature actuelle : `chargerPapier(fichier, noms, transformer)`).
- Produces: `chargerPapier(fichier, noms, transformer, socleExtra)` — `socleExtra` est un tableau optionnel de noms de fichiers (dans `public/`) à évaluer AVANT `fichier`, dans l'ordre donné, après le socle par défaut (`papier.js`, `nom-client.js`). Consommé par Task 4 (`test/facture.test.js` charge `facture.js` avec `devis.js` en dépendance supplémentaire).

- [ ] **Step 1: Étendre la signature, rétrocompatible**

Dans `test/socle-papier.js`, remplacer :
```js
function chargerPapier(fichier, noms, transformer) {
  const passe = typeof transformer === 'function' ? transformer : (x) => x;
  const bac = {};
  vm.createContext(bac);
  const socle = ['papier.js', 'nom-client.js']
    .map((f) => nu(passe(fs.readFileSync(path.join(PUBLIC, f), 'utf8'))))
    .join('\n');
  const corps = nu(passe(fs.readFileSync(path.join(PUBLIC, fichier), 'utf8')));
  const sorties = noms.map((n) => `globalThis.${n} = ${n};`).join('\n');
  vm.runInContext(`${socle}\n${corps}\n${sorties}`, bac);
  return bac;
}
```
par :
```js
// `socleExtra` : d'autres fichiers de `public/` à évaluer AVANT `fichier`,
// dans l'ordre donné — pour un papier qui importe autre chose que le socle
// commun (`facture.js` importe `calculerDevis` de `devis.js`, par exemple).
// Optionnel et rétrocompatible : aucun appelant existant n'en avait besoin.
function chargerPapier(fichier, noms, transformer, socleExtra) {
  const passe = typeof transformer === 'function' ? transformer : (x) => x;
  const bac = {};
  vm.createContext(bac);
  const fichiersSocle = ['papier.js', 'nom-client.js', ...(Array.isArray(socleExtra) ? socleExtra : [])];
  const socle = fichiersSocle
    .map((f) => nu(passe(fs.readFileSync(path.join(PUBLIC, f), 'utf8'))))
    .join('\n');
  const corps = nu(passe(fs.readFileSync(path.join(PUBLIC, fichier), 'utf8')));
  const sorties = noms.map((n) => `globalThis.${n} = ${n};`).join('\n');
  vm.runInContext(`${socle}\n${corps}\n${sorties}`, bac);
  return bac;
}
```

- [ ] **Step 2: Vérifier que tous les appelants existants restent verts**

Run: `npm test -- test/devis-flash.test.js test/ticket-atelier.test.js test/vue-bureau.test.js test/papiers-atelier-et-bureau.test.js`
Expected: PASS (aucun de ces fichiers ne passe `socleExtra` — comportement identique).

- [ ] **Step 3: Commit**

```bash
git add test/socle-papier.js
git commit -m "$(cat <<'EOF'
test: chargerPapier accepte des dépendances supplémentaires

facture.js importera calculerDevis de devis.js — le bac à sable doit
pouvoir charger devis.js en socle, en plus de papier.js/nom-client.js.
Rétrocompatible : paramètre optionnel, aucun appelant existant ne
change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Le document — `public/facture.js`

**Files:**
- Create: `public/facture.js`
- Test: `test/facture.test.js`

**Interfaces:**
- Consumes: `JETONS_PAPIER`, `SOCLE_PAPIER`, `maisonPapier` (`papier.js`) ; `texte`, `euro`, `cents`, `dateSeule`, `jourAtelier`, `calculerDevis`, `REGIMES`, `ARRONDIS`, `AJUSTEMENT_UNITES`, `VEDETTES` (`devis.js`, Task 2 pour les quatre premiers) ; `nomClientAffiche` (`nom-client.js`).
- Produces: `MODES_PAIEMENT` (array `{id,label}`), `modeleFacture(saisie, entreprise)`, `dessinerFacture(t, doc)`, `CSS_FACTURE` (string) — consommés par Task 6 (screen `vente-flash.js`) et Task 5 (route serveur, pour valider `mode`).

- [ ] **Step 1: Écrire `public/facture.js`**

```js
// ===========================================================================
// LA FACTURE — le quatrième papier de la maison, et le seul qui ne se
// réimprime jamais autrement qu'à l'identique
// ===========================================================================
// ELLE NAÎT D'UNE VENTE SOLDÉE, PAS D'UNE PROMESSE. Contrairement au devis
// (`devis.js`), elle ne porte ni acompte ni solde : le mode de règlement est
// obligatoire et le montant réglé est TOUJOURS le TTC — décidé le 03/09/2026.
// Une commande avec acompte reste un DEVIS tant qu'elle n'est pas soldée.
//
// LE MOTEUR D'ARGENT EST CELUI DU DEVIS. `calculerDevis` (HT, TTC, taxe,
// régime, arrondi commercial, ajustement global) vit une seule fois dans
// `devis.js` — en écrire un second ici serait le genre d'écart qui finit par
// se contredire sur le document qui sert à facturer.
//
// ELLE EST IMMUABLE. Le modèle qui sort d'ici est celui qu'on archive tel
// quel (voir `POST /api/factures`, server.js) : une fois émise, une facture
// ne se recalcule plus jamais — ni si le taux de TGCA change, ni si
// l'identité de l'atelier change.
//
// ⚠ DEUX PIÈGES DÉJÀ PAYÉS SUR LES TROIS AUTRES PAPIERS (voir `papier.js`,
// `devis.js`) :
//   1. AUCUN ACCENT GRAVE dans un gabarit — le caractère referme le littéral,
//      `node --check` passe quand même, l'écran s'ouvre NU.
//   2. AUCUN JETON DE `charte.css` dans `CSS_FACTURE` — le cadre d'impression
//      ne charge QUE cette chaîne, un `var(--pas-3)` y vaut la chaîne vide.
//
// ⚠️ LES MENTIONS LÉGALES CI-DESSOUS NE SONT PAS UNE VALIDATION JURIDIQUE.
// Saint-Martin a son propre régime fiscal (TGCA, distinct de la TVA
// métropolitaine). Le texte reste générique sur le régime — il reprend le
// libellé déjà choisi par la vendeuse (TGCA / Revente / Export) sans inventer
// de citation d'article. À faire relire avant de s'appuyer dessus en cas de
// contrôle.

import { JETONS_PAPIER, SOCLE_PAPIER, maisonPapier } from './papier.js';
import {
  texte, euro, cents, dateSeule, jourAtelier, calculerDevis,
  REGIMES, ARRONDIS, AJUSTEMENT_UNITES, VEDETTES,
} from './devis.js';
import { nomClientAffiche } from './nom-client.js';

// LES MODES DE RÈGLEMENT — miroir de catalog.json → commande.paiementModes,
// que le serveur valide (PAIEMENT_MODE_SET, server.js). Une facture Vente
// Flash EXIGE un mode : voir §4 du spec, réglé le 03/09.
export const MODES_PAIEMENT = [
  { id: 'cb', label: 'Carte bancaire' },
  { id: 'especes', label: 'Espèces' },
  { id: 'virement', label: 'Virement' },
  { id: 'cheque', label: 'Chèque' },
  { id: 'mixte', label: 'Mixte' },
];
const MODE_PAR_ID = new Map(MODES_PAIEMENT.map((m) => [m.id, m]));

// LES MENTIONS LÉGALES — texte fixe, comme le BAT et le délai sur le devis :
// ce n'est pas de la mise en forme, c'est ce qui rend le document opposable.
// Voir l'avertissement en tête de fichier.
const MENTIONS_REGLEMENT = 'Facture réglée en totalité à la remise. Aucun escompte pour paiement '
  + 'anticipé. En cas de retard de paiement sur une facture à échéance : pénalité au taux légal en '
  + 'vigueur, exigible sans qu’un rappel soit nécessaire, et indemnité forfaitaire de recouvrement '
  + 'de 40 € (articles L441-10 et D441-5 du code de commerce).';

// ===========================================================================
// LE MODÈLE
// ===========================================================================
// `saisie` porte les mêmes champs de calcul que le devis (lignes, régime,
// arrondi, ajustement, vedette) plus `mode` (le règlement, obligatoire).
// `entreprise` est le réglage qui dit de qui vient le document — figé dans
// `document` au moment de l'émission (voir server.js), jamais relu ensuite.
export function modeleFacture(saisie, entreprise) {
  const s = saisie && typeof saisie === 'object' ? saisie : {};
  const c = s.client && typeof s.client === 'object' ? s.client : {};
  const compte = calculerDevis(s);
  const mode = MODE_PAR_ID.get(s.mode) || null;

  return {
    maison: maisonPapier(entreprise),
    titre: 'FACTURE',
    numero: texte(s.numero),
    date: dateSeule(s.date) || dateSeule(jourAtelier()),
    projet: texte(s.projet),
    client: {
      nom: nomClientAffiche(texte(c.nom), c.type),
      ville: texte(c.ville),
      contact: texte(c.contact),
      tel: texte(c.tel),
      email: texte(c.email),
    },
    lignes: compte.lignes.map((l) => ({
      designation: texte(l.designation),
      reference: texte(l.reference),
      couleur: texte(l.couleur),
      tailles: texte(l.tailles),
      marquage: texte(l.marquage),
      encre: texte(l.encre),
      faces: texte(l.faces),
      note: texte(l.note),
      quantite: l.quantite,
      unitaireHt: euro(l.unitaireHt),
      totalHt: euro(l.totalHt),
    })).filter((l) => l.designation || l.totalHt),
    totaux: {
      sousTotalHt: euro(compte.sousTotalHt),
      ajustement: compte.ajustement.montant ? euro(compte.ajustement.montant) : '',
      ecart: compte.ecart ? euro(compte.ecart) : '',
      totalHt: euro(compte.totalHt),
      taxeLabel: compte.regime.taxable
        ? `${compte.regime.label} ${(compte.tauxTgca * 100).toFixed(compte.tauxTgca * 100 % 1 ? 1 : 0)} %`
        : compte.regime.label,
      taxe: euro(compte.taxe),
      ttc: euro(compte.ttc),
      vedette: compte.vedette,
    },
    // LE RÈGLEMENT N'EST JAMAIS NULL sur une facture émise : le mode est
    // obligatoire côté écran ET côté serveur (voir server.js). `null` ne peut
    // apparaître que si un appelant construit un modèle hors du parcours
    // normal — le papier l'affiche alors sans bloc de règlement plutôt que de
    // planter, pour rester lisible en cas d'anomalie amont.
    reglement: mode ? { mode: mode.label, montant: euro(compte.ttc) } : null,
    mentions: MENTIONS_REGLEMENT,
    compte,
  };
}

// ===========================================================================
// LA FEUILLE — A4 portrait, autonome
// ===========================================================================
// MÊME GRAMMAIRE QUE LE DEVIS (dv-geant/dv-cle/dv-texte) : ce sont les mêmes
// crans de lecture, sur un document de la même famille. Les classes portent
// leur propre préfixe (`fa-`, comme « facture ») pour ne jamais capter les
// styles écrits pour `.dv`.
export const CSS_FACTURE = SOCLE_PAPIER + `
  .fa {${JETONS_PAPIER}
       --fa-geant: 30px; --fa-cle: 17px; --fa-texte: 13px;
       --fa-rang: 26px; --fa-gouttiere: 26px; --fa-section: 22px;
       width: 210mm; min-height: 297mm; box-sizing: border-box; margin: 0 auto;
       display: flex; flex-direction: column;
       background: #ffffff; color: var(--pap-encre);
       font: var(--fa-texte)/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
       font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
  .fa * { box-sizing: border-box; }

  .fa__tete { display: flex; align-items: flex-start; justify-content: space-between;
              gap: 28px; padding: 26px var(--pap-marge) 16px; border-bottom: 3px solid var(--pap-encre); }
  .fa__maison { display: flex; flex-direction: column; gap: 1px; min-width: 0;
                overflow-wrap: anywhere; }
  .fa__maison-nom { font-size: var(--fa-cle); font-weight: 800; letter-spacing: -.02em;
                    line-height: 1.2; margin-bottom: 3px; }
  .fa__maison-l { color: var(--pap-ardoise); line-height: 1.35; }
  .fa__ref { display: flex; flex-direction: column; align-items: flex-end; gap: 3px;
             text-align: right; flex: 0 0 auto; }
  .fa__titre { font-size: var(--fa-cle); font-weight: 800; letter-spacing: .04em;
               line-height: 1.15; white-space: nowrap; }
  .fa__num { font: 700 var(--fa-cle)/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

  .fa__corps { flex: 1; min-height: 0; display: flex; flex-direction: column;
               gap: var(--fa-section); padding: 16px var(--pap-marge) 0; }

  .fa__grille { display: grid; grid-template-columns: 1fr 1fr; column-gap: var(--fa-gouttiere); }
  .fa__section-k { padding-bottom: 6px; border-bottom: 2px solid var(--pap-encre);
                   color: var(--pap-encre); font-weight: 700; }
  .fa__paire { display: flex; align-items: baseline; justify-content: space-between;
               gap: 12px; min-height: var(--fa-rang); padding: 4px 0;
               border-bottom: 1px dotted var(--pap-filet); }
  .fa__k { color: var(--pap-ardoise); }
  .fa__v { font-weight: 700; text-align: right; }
  .fa__nom { display: flex; align-items: baseline; min-height: var(--fa-rang);
             padding: 4px 0; border-bottom: 1px dotted var(--pap-filet);
             font-size: var(--fa-cle); font-weight: 800; letter-spacing: -.02em; }

  .fa__table { width: 100%; border-collapse: collapse; }
  .fa__table th { text-align: left; padding: 0 0 6px; border-bottom: 2px solid var(--pap-encre);
                  color: var(--pap-encre); font-weight: 700; }
  .fa__table td { padding: 7px 0; border-bottom: 1px dotted var(--pap-filet); vertical-align: top; }
  .fa__table th + th, .fa__table td + td { padding-left: 12px; }
  .fa__c-qte { width: 52px; text-align: right; }
  .fa__c-pu { width: 92px; text-align: right; }
  .fa__c-tot { width: 100px; text-align: right; }
  .fa__table th.fa__c-qte, .fa__table th.fa__c-pu, .fa__table th.fa__c-tot { text-align: right; }
  .fa__art { font-weight: 700; }
  .fa__art-d { color: var(--pap-ardoise); line-height: 1.35; }
  .fa__art-n { color: var(--pap-ardoise); font-style: italic; line-height: 1.35; }
  .fa__table tr { break-inside: avoid; }

  .fa__bas { display: grid; grid-template-columns: 1fr 240px; gap: var(--fa-gouttiere);
             align-items: start; }
  .fa__tot-l { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0;
               border-bottom: 1px dotted var(--pap-filet); }
  .fa__tot-k { color: var(--pap-ardoise); }
  .fa__tot-v { font-weight: 700; }
  .fa__grand { display: flex; flex-direction: column; gap: 2px; margin-top: 8px;
               padding-top: 8px; border-top: 2px solid var(--pap-encre); }
  .fa__grand-v { font-size: var(--fa-geant); font-weight: 800; letter-spacing: -.02em;
                 line-height: 1.05; }

  .fa__pay { border: 1px solid var(--pap-filet); padding: 12px; line-height: 1.5; }
  .fa__pay-v { font-size: var(--fa-geant); font-weight: 800; letter-spacing: -.02em;
               line-height: 1.05; margin: 6px 0 4px; }

  .fa__mentions { padding: 10px var(--pap-marge) 0; color: var(--pap-ardoise);
                  line-height: 1.5; font-size: 11px; }

  .fa__pied { margin-top: auto; padding: 14px var(--pap-marge) 22px; text-align: center;
              color: var(--pap-ardoise); line-height: 1.5; }
  .fa__pied-l { border-top: 1px solid var(--pap-filet); padding-top: 8px; }

  @media print {
    .fa { box-shadow: none; }
  }
`;

// ===========================================================================
// LE RENDU
// ===========================================================================
export function dessinerFacture(t, doc) {
  const d = doc || document;
  const el = (tag, cls, txt) => {
    const n = d.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null && txt !== '') n.textContent = txt;
    return n;
  };
  const paire = (k, v) => {
    const l = el('div', 'fa__paire');
    l.append(el('span', 'fa__k pap-cap', k), el('span', 'fa__v', v));
    return l;
  };

  const f = el('div', 'fa');

  // --- En-tete ---
  const tete = el('div', 'fa__tete');
  const maison = el('div', 'fa__maison');
  if (t.maison.nom) maison.append(el('div', 'fa__maison-nom', t.maison.nom));
  for (const l of t.maison.lignes) maison.append(el('div', 'fa__maison-l', l));
  for (const l of t.maison.contact) maison.append(el('div', 'fa__maison-l', l));
  const ref = el('div', 'fa__ref');
  ref.append(el('div', 'fa__titre', t.titre));
  if (t.numero) ref.append(el('div', 'fa__num', t.numero));
  ref.append(el('div', 'pap-cap', `DU ${t.date}`));
  tete.append(maison, ref);
  f.append(tete);

  const corps = el('div', 'fa__corps');

  // --- Client et dossier ---
  const grille = el('div', 'fa__grille');
  grille.append(el('div', 'fa__section-k pap-cap', 'CLIENT'),
    el('div', 'fa__section-k pap-cap', 'DOSSIER'));
  const gauche = [
    ['VILLE', t.client.ville], ['CONTACT', t.client.contact],
    ['TÉLÉPHONE', t.client.tel], ['E-MAIL', t.client.email],
  ].filter(([, v]) => v);
  const droite = [['PROJET', t.projet], ['DATE', t.date]].filter(([, v]) => v);
  const rangs = Math.max(1 + gauche.length, droite.length);
  for (let i = 0; i < rangs; i += 1) {
    if (i === 0) grille.append(el('div', 'fa__nom', t.client.nom));
    else if (gauche[i - 1]) grille.append(paire(gauche[i - 1][0], gauche[i - 1][1]));
    else grille.append(el('div', 'fa__paire'));
    if (droite[i]) grille.append(paire(droite[i][0], droite[i][1]));
    else grille.append(el('div', 'fa__paire'));
  }
  corps.append(grille);

  // --- Le detail ---
  const table = el('table', 'fa__table');
  const thead = el('thead');
  const trh = el('tr');
  trh.append(el('th', 'pap-cap', 'DÉSIGNATION'), el('th', 'fa__c-qte pap-cap', 'QTÉ'),
    el('th', 'fa__c-pu pap-cap', 'PU HT'), el('th', 'fa__c-tot pap-cap', 'TOTAL HT'));
  thead.append(trh);
  const tbody = el('tbody');
  for (const l of t.lignes) {
    const tr = el('tr');
    const cell = el('td');
    cell.append(el('div', 'fa__art', l.designation));
    for (const [k, v] of [['Réf', l.reference], ['Couleur', l.couleur],
      ['Tailles', l.tailles], ['Marquage', l.marquage],
      ['Encre', l.encre], ['Faces', l.faces]]) {
      if (v) cell.append(el('div', 'fa__art-d', `${k} : ${v}`));
    }
    if (l.note) cell.append(el('div', 'fa__art-n', l.note));
    tr.append(cell, el('td', 'fa__c-qte', String(l.quantite)),
      el('td', 'fa__c-pu', l.unitaireHt), el('td', 'fa__c-tot', l.totalHt));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  corps.append(table);

  // --- Totaux, réglement ---
  const bas = el('div', 'fa__bas');
  const pay = el('div');
  if (t.reglement) {
    const cadre = el('div', 'fa__pay');
    cadre.append(el('div', 'pap-cap', 'RÈGLEMENT'));
    cadre.append(el('div', 'fa__pay-v', t.reglement.montant));
    cadre.append(el('div', 'fa__art-d', t.reglement.mode));
    pay.append(cadre);
  }
  bas.append(pay);

  const totaux = el('div');
  const ligneTotal = (k, v) => {
    const l = el('div', 'fa__tot-l');
    l.append(el('span', 'fa__tot-k', k), el('span', 'fa__tot-v', v));
    return l;
  };
  totaux.append(ligneTotal('Sous-total HT', t.totaux.sousTotalHt));
  if (t.totaux.ajustement) totaux.append(ligneTotal('Ajustement', t.totaux.ajustement));
  if (t.totaux.ecart) totaux.append(ligneTotal('Arrondi commercial', t.totaux.ecart));
  const grand = el('div', 'fa__grand');
  if (t.totaux.vedette === 'ht') {
    totaux.append(ligneTotal(t.totaux.taxeLabel, t.totaux.taxe));
    totaux.append(ligneTotal('TTC', t.totaux.ttc));
    grand.append(el('div', 'pap-cap', 'TOTAL HT'), el('div', 'fa__grand-v', t.totaux.totalHt));
  } else {
    totaux.append(ligneTotal('Total HT', t.totaux.totalHt));
    totaux.append(ligneTotal(t.totaux.taxeLabel, t.totaux.taxe));
    grand.append(el('div', 'pap-cap', 'TOTAL TTC'), el('div', 'fa__grand-v', t.totaux.ttc));
  }
  totaux.append(grand);
  bas.append(totaux);
  corps.append(bas);

  f.append(corps);

  // --- Mentions légales ---
  if (t.mentions) {
    f.append(el('div', 'fa__mentions', t.mentions));
  }

  // --- Pied ---
  if (t.maison.legal.length) {
    const pied = el('div', 'fa__pied');
    pied.append(el('div', 'fa__pied-l', t.maison.legal.join(' - ')));
    f.append(pied);
  }
  return f;
}
```

- [ ] **Step 2: Écrire `test/facture.test.js`**

```js
'use strict';

// ===========================================================================
// LA FACTURE — le quatrième papier (03/09/2026)
// ===========================================================================
// Trois choses qui coûtent cher si elles dérivent, comme pour le devis
// (voir test/devis-flash.test.js) :
//   1. L'ARITHMÉTIQUE — le même moteur que le devis (calculerDevis), jamais
//      un second qui finirait par diverger.
//   2. LE PAPIER — mêmes pièges que les trois autres : accent grave, jeton
//      charte.css.
//   3. L'IMMUABILITÉ — une facture sort TOUJOURS soldée (mode + montant TTC),
//      jamais avec un solde dû.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { chargerPapier } = require('./socle-papier');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const FACTURE_SRC = lire('public/facture.js');

const {
  CSS_FACTURE, modeleFacture, dessinerFacture, MODES_PAIEMENT,
} = chargerPapier('facture.js',
  ['CSS_FACTURE', 'modeleFacture', 'dessinerFacture', 'MODES_PAIEMENT'],
  undefined, ['devis.js']);

function faireDoc() {
  const mk = () => ({
    className: '', textContent: '', children: [],
    append(...n) { this.children.push(...n); },
  });
  return { createElement: mk };
}
const texteEntier = (n) => (n.textContent || '') + n.children.map(texteEntier).join(' ');

const MAISON = {
  nom: 'Atelier OLDA', adresse: '27 rue de Hollande', ville: '97150 Marigot',
  tel: '0690123456', email: 'contact@olda.fr',
  siret: '81234567800019', banque: 'Crédit Mutuel', iban: 'FR7612345678901234567890123', bic: 'CMCIFR2A',
};

const SAISIE = {
  numero: 'FA-2026-0001', date: '2026-09-03', projet: 'Comptoir',
  client: { nom: 'Restaurant Le Flamboyant', ville: 'Marigot', contact: 'Mélina', tel: '0690112233', type: 'pro' },
  lignes: [
    { designation: 'T-shirt logo coeur', reference: 'TS-01', couleur: 'Blanc', tailles: '2 × M', quantite: 2, unitaireHt: 15 },
    { designation: 'Tasse céramique', reference: 'TC-01', quantite: 1, unitaireHt: 8.5 },
  ],
  regime: 'tgca', tauxTgca: 0.04, arrondi: 'aucun', vedette: 'ttc',
  ajustement: { unite: 'eur', valeur: 0 },
  mode: 'cb',
};

// --- Aucun piège des trois autres papiers -----------------------------------
assert.ok(!CSS_FACTURE.includes(String.fromCharCode(96)),
  'un accent grave dans CSS_FACTURE referme le gabarit : l’écran s’affiche NU');
assert.deepStrictEqual(CSS_FACTURE.match(/var\(--(?!pap-|fa-)[\w-]+\)/g) || [],
  [], 'CSS_FACTURE ne doit lire AUCUN jeton de charte.css : le cadre d’impression ne la charge pas');
assert.ok(/width:\s*210mm/.test(CSS_FACTURE) && /min-height:\s*297mm/.test(CSS_FACTURE),
  'la feuille doit être une A4 portrait autonome');
assert.ok(!FACTURE_SRC.includes(String.fromCharCode(96) + String.fromCharCode(96) + 'X'),
  'garde-fou trivial : le fichier source ne doit pas contenir de gabarit corrompu');

// --- Le moteur d'argent est celui du devis, pas un second ------------------
assert.ok(/import\s*\{[^}]*calculerDevis[^}]*\}\s*from\s*'\.\/devis\.js'/.test(FACTURE_SRC),
  'facture.js doit importer calculerDevis de devis.js, pas le réécrire');

// --- L'addition tombe juste ---------------------------------------------------
const t = modeleFacture(SAISIE, MAISON);
assert.strictEqual(t.titre, 'FACTURE');
assert.strictEqual(t.numero, 'FA-2026-0001');
// 2×15 + 1×8,5 = 38,5 HT ; TGCA 4% = 1,54 ; TTC = 40,04
assert.strictEqual(t.totaux.totalHt, '38,50 €');
assert.strictEqual(t.totaux.taxe, '1,54 €');
assert.strictEqual(t.totaux.ttc, '40,04 €');

// --- Le règlement est TOUJOURS le TTC, jamais un solde ----------------------
assert.ok(t.reglement, 'une facture émise porte toujours un bloc règlement');
assert.strictEqual(t.reglement.montant, t.totaux.ttc,
  'le montant réglé doit être EXACTEMENT le TTC — une facture Vente Flash sort toujours soldée');
assert.strictEqual(t.reglement.mode, 'Carte bancaire');
assert.ok(!('acompte' in t), 'la facture ne porte pas de concept d’acompte/solde, contrairement au devis');
assert.ok(!('appro' in t) && !('delai' in t) && !('bat' in t),
  'pas de bloc délai/BAT sur une facture : elle documente une vente déjà réglée, pas une promesse');

// --- Un champ vide ne s'imprime pas -----------------------------------------
const feuille = dessinerFacture(t, faireDoc());
const rendu = texteEntier(feuille);
assert.ok(rendu.includes('Restaurant Le Flamboyant'));
assert.ok(!rendu.includes('undefined') && !rendu.includes('null'));

// --- Les mentions légales sont toujours présentes ---------------------------
assert.ok(rendu.includes('40'), 'l’indemnité forfaitaire de recouvrement doit figurer sur toute facture');
assert.ok(/p[ée]nalit[ée]/i.test(rendu), 'la mention de pénalité de retard doit figurer sur toute facture');

// --- Un mode de paiement inconnu ne casse pas le rendu ----------------------
const sansMode = modeleFacture({ ...SAISIE, mode: 'inconnu' }, MAISON);
assert.strictEqual(sansMode.reglement, null);
assert.doesNotThrow(() => dessinerFacture(sansMode, faireDoc()));

// --- MODES_PAIEMENT couvre les cinq modes validés par le serveur -----------
assert.deepStrictEqual(MODES_PAIEMENT.map((m) => m.id).sort(),
  ['cb', 'cheque', 'especes', 'mixte', 'virement']);

console.log('✓ facture : arithmétique, règlement toujours soldé, pièges accent/jeton évités');
```

- [ ] **Step 3: Lancer le test et vérifier qu'il passe**

Run: `node test/facture.test.js`
Expected: PASS. En cas d'échec sur l'arithmétique, vérifier l'arrondi des
centimes (`cents`) et l'ordre HT→TTC dans `calculerDevis` (déjà testé côté
devis — un échec ici indique presque toujours un mauvais champ passé dans
`SAISIE`, pas un bug du moteur partagé).

- [ ] **Step 4: Ajouter au script `npm test`**

Vérifier que `package.json` lance bien tous les `test/*.test.js` (probablement
déjà le cas via un glob) — sinon ajouter `test/facture.test.js` explicitement.
Run: `npm test`
Expected: PASS, `facture` apparaît dans la sortie.

- [ ] **Step 5: Commit**

```bash
git add public/facture.js test/facture.test.js
git commit -m "$(cat <<'EOF'
feat(facture): le document — modèle, rendu, feuille A4

Quatrième papier de la maison, posé sur le socle papier.js et le
moteur d'argent de devis.js (calculerDevis, un seul pour les deux
documents). Toujours soldée : pas d'acompte, mode de règlement
obligatoire, montant réglé = TTC. Mentions légales fixes en pied de
page — texte à faire valider par Charlie avant tout contrôle.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Le serveur — numérotation, émission, relecture

**Files:**
- Modify: `server.js` (ajouter après `reserverNumeroDuJour`, ~ligne 4760)
- Test: `test/factures-api.test.js`

**Interfaces:**
- Consumes: `pool` (module-level, déjà présent), `asyncH`, `exige`, `borner`, `trimOrNull`, `isDay`, `PAIEMENT_MODE_SET`, `unDossierALaFois` — tous déjà définis dans `server.js`.
- Produces: `POST /api/factures` → `{ id, numero, document }` ; `GET /api/requests/:id/facture` → `{ id, numero, document }` ou 404.

- [ ] **Step 1: Écrire le test (il échouera — les routes n'existent pas encore)**

```js
'use strict';

// ===========================================================================
// LA FACTURE — numérotation continue, immuabilité, idempotence (03/09/2026)
// ===========================================================================
// Ce que ce fichier tient, dans l'esprit du dépôt : les bugs vivent dans la
// concurrence et le réseau qui tombe, pas dans le cas nominal.
//   1. La numérotation ne laisse JAMAIS de trou : un rejet ne consomme pas de
//      rang, une resoumission après perte de réponse réseau retombe sur la
//      ligne déjà créée au lieu d'en brûler un second.
//   2. Deux émissions concurrentes pour le MÊME dossier ne créent qu'une
//      seule ligne et ne consomment qu'un seul numéro.
//   3. Aucune route d'écriture n'existe après création — l'immutabilité est
//      un FAIT d'API, pas une convention qu'on espère respectée.

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

  const dossier = () => fetch(`${base}/api/comptoir/projet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'Vente directe',
      clientObj: { name: 'Client Facture Test', type: 'pro' },
      amount: 40.04,
      articles: [{ label: 'T-shirt logo coeur', qty: 2, amount: 30 }, { label: 'Tasse céramique', qty: 1, amount: 8.5 }],
      paiement: { mode: 'cb' },
    }),
  }).then((r) => r.json());

  const factureBody = (dossierId) => ({
    dossierId,
    client: { nom: 'Client Facture Test', ville: 'Marigot', type: 'pro' },
    mode: 'cb',
    regime: 'tgca', tauxTgca: 0.04, arrondi: 'aucun', vedette: 'ttc',
    ajustement: { unite: 'eur', valeur: 0 },
    lignes: [
      { designation: 'T-shirt logo coeur', quantite: 2, unitaireHt: 15 },
      { designation: 'Tasse céramique', quantite: 1, unitaireHt: 8.5 },
    ],
  });

  // --- Émission nominale ------------------------------------------------------
  const d1 = await dossier();
  assert.ok(d1.id, 'le dossier doit se créer');
  const r1 = await fetch(`${base}/api/factures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(factureBody(d1.id)),
  });
  assert.strictEqual(r1.status, 201);
  const f1 = await r1.json();
  assert.match(f1.numero, /^FA-\d{4}-\d{4}$/, `numéro mal formé : ${f1.numero}`);
  assert.strictEqual(f1.document.reglement.montant, '40,04 €');

  // --- Un dossier sans article ou sans mode est rejeté, SANS consommer de numéro
  const d2 = await dossier();
  const avantRejet = await fetch(`${base}/api/factures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...factureBody(d2.id), mode: 'inconnu' }),
  });
  assert.strictEqual(avantRejet.status, 400);
  const okApresRejet = await fetch(`${base}/api/factures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(factureBody(d2.id)),
  });
  assert.strictEqual(okApresRejet.status, 201);
  const f2 = await okApresRejet.json();
  // Les deux numéros doivent être CONSÉCUTIFS : le rejet n'a pas brûlé de rang.
  const rangDe = (n) => Number(n.split('-')[2]);
  assert.strictEqual(rangDe(f2.numero), rangDe(f1.numero) + 1,
    `un rejet a consommé un numéro : ${f1.numero} puis ${f2.numero}`);

  // --- Resoumission (réseau qui avale la réponse) : pas de doublon, pas de second numéro
  const d3 = await dossier();
  const body3 = factureBody(d3.id);
  const [ra, rb] = await Promise.all([
    fetch(`${base}/api/factures`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body3) }),
    fetch(`${base}/api/factures`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body3) }),
  ]);
  const [fa, fb] = await Promise.all([ra.json(), rb.json()]);
  assert.strictEqual(fa.id, fb.id, 'deux émissions concurrentes pour le même dossier doivent rendre LA MÊME facture');
  assert.strictEqual(fa.numero, fb.numero);

  // --- Un dossier déjà facturé refuse une SECONDE facture distincte ----------
  const encore = await fetch(`${base}/api/factures`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(factureBody(d1.id)),
  });
  const encoreJson = await encore.json();
  assert.strictEqual(encoreJson.id, f1.id, 'redemander une facture pour un dossier déjà facturé rend l’EXISTANTE');
  assert.strictEqual(encoreJson.numero, f1.numero);

  // --- Relecture depuis la fiche -----------------------------------------------
  const relue = await fetch(`${base}/api/requests/${d1.id}/facture`);
  assert.strictEqual(relue.status, 200);
  const relueJson = await relue.json();
  assert.strictEqual(relueJson.numero, f1.numero);
  assert.deepStrictEqual(relueJson.document, f1.document, 'la relecture ne recalcule rien : elle rend le document archivé tel quel');

  const introuvable = await fetch(`${base}/api/requests/00000000-0000-0000-0000-000000000000/facture`);
  assert.strictEqual(introuvable.status, 404);

  // --- Aucune route d'écriture n'existe ----------------------------------------
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const rep = await fetch(`${base}/api/factures/${f1.id}`, { method });
    assert.ok([404, 405].includes(rep.status), `${method} /api/factures/:id doit être refusé (reçu ${rep.status})`);
  }

  console.log('✓ factures-api : numérotation sans trou, idempotence, immutabilité, relecture');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `node test/factures-api.test.js`
Expected: FAIL — `404` sur `POST /api/factures` (route inexistante).

- [ ] **Step 3: Ajouter les routes dans `server.js`**

Juste après la fonction `reserverNumeroDuJour` (donc après le bloc
`POST /api/devis/numero`, ~ligne 4760), ajouter :

```js
// ---------------------------------------------------------------------------
// LA FACTURE — numérotation continue, émission immuable (03/09/2026)
// ---------------------------------------------------------------------------
// DIFFÉRENCE VOLONTAIRE AVEC LE NUMÉRO DE DEVIS : celui-là se réserve CÔTÉ
// ÉCRAN, avant même d'enregistrer (voir imprimer(), devis-flash.js) — un
// devis imprimé puis abandonné laisse un trou, tolérable pour un document
// sans valeur comptable. Une facture ne peut pas se permettre ce trou : la
// réservation du numéro et l'insertion de la ligne se font dans LA MÊME
// transaction. Un rejet (validation, coupure réseau avant écriture) annule
// les deux ensemble.
async function reserverNumeroFacture(cx, annee) {
  const metaKey = `facture_seq_${annee}`;
  const { rows } = await cx.query(
    `INSERT INTO app_meta (key, value) VALUES ($1, '1')
     ON CONFLICT (key) DO UPDATE SET value = ((app_meta.value)::int + 1)::text
     RETURNING value`,
    [metaKey],
  );
  const rang = Number.parseInt(rows[0].value, 10);
  return { numero: `FA-${annee}-${String(rang).padStart(4, '0')}`, rang };
}

// POST /api/factures → émet une facture pour un dossier déjà créé par
// POST /api/comptoir/projet. IDEMPOTENT sur `dossierId` : une resoumission
// après perte de réponse réseau (le grand classique du comptoir — voir
// comptoir-dossiers-perdus-silence) retombe sur la ligne déjà créée au lieu
// de brûler un second numéro.
app.post('/api/factures', exige('clients'), asyncH(async (req, res) => unDossierALaFois(async () => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};

  const dossierId = trimOrNull(b.dossierId);
  if (!dossierId) return res.status(400).json({ error: 'dossierId requis' });

  // RETOMBÉE IDEMPOTENTE — AUCUN numéro consommé sur ce chemin.
  const { rows: existante } = await pool.query(
    'SELECT id, numero, document, montant_ttc FROM invoices WHERE dossier_id = $1', [dossierId],
  );
  if (existante.length) {
    return res.status(201).json({
      id: existante[0].id, numero: existante[0].numero, montantTtc: Number(existante[0].montant_ttc), document: existante[0].document,
    });
  }

  const cl = b.client && typeof b.client === 'object' ? b.client : {};
  const nomClient = borner(cl.nom, 120);
  if (!nomClient) return res.status(400).json({ error: 'le nom du client est requis' });
  const client = {
    nom: nomClient,
    ville: borner(cl.ville, 80),
    contact: borner(cl.contact, 120),
    tel: borner(cl.tel, 40),
    email: borner(cl.email, 160),
    type: cl.type === 'perso' ? 'perso' : 'pro',
  };

  const mode = b.mode;
  if (!PAIEMENT_MODE_SET.has(mode)) return res.status(400).json({ error: `mode de paiement invalide : ${mode}` });

  const lignes = (Array.isArray(b.lignes) ? b.lignes : [])
    .filter((l) => l && typeof l === 'object' && trimOrNull(l.designation))
    .slice(0, 60)
    .map((l) => ({
      designation: borner(l.designation, 200),
      reference: borner(l.reference, 60),
      couleur: borner(l.couleur, 80),
      tailles: borner(l.tailles, 120),
      marquage: borner(l.marquage, 120),
      encre: borner(l.encre, 80),
      faces: borner(l.faces, 160),
      note: borner(l.note, 400),
      quantite: Math.max(0, Math.round(Number(l.quantite) || 0)),
      unitaireHt: Math.max(0, Math.round((Number(l.unitaireHt) || 0) * 100) / 100),
    }));
  if (!lignes.length) return res.status(400).json({ error: 'une facture sans article ne s’émet pas' });
  // UNE FACTURE NE PORTE JAMAIS DE LIGNE SANS PRIX : contrairement au devis,
  // une vente déjà réglée connaît tous ses prix. Un zéro ici est un article
  // OFFERT (voulu), pas une case oubliée.
  if (lignes.some((l) => l.unitaireHt == null)) {
    return res.status(400).json({ error: 'toutes les lignes doivent porter un prix' });
  }

  const jour = isDay(b.jour) ? b.jour : todayPlus(0);
  const annee = Number(jour.slice(0, 4));

  // L'ADDITION EST REJOUÉE ICI, PAS IMPORTÉE. `calculerDevis` vit dans
  // public/devis.js — un module ES pensé pour le navigateur (`import`/
  // `export`) que `server.js` (CommonJS) n'exécute pas. Le serveur est
  // pourtant la SEULE autorité sur le total archivé : il ne fait pas
  // confiance à un TTC calculé côté client et simplement recopié. Même
  // arithmétique que `calculerDevis` (arrondi TTC, puis HT au centime, la
  // taxe est ce qui reste) — voir devis.js si les deux doivent un jour être
  // unifiées (hors scope de ce lot).
  const sousTotalHt = Math.round(lignes.reduce((t, l) => t + l.quantite * l.unitaireHt, 0) * 100) / 100;
  const ajustementUnite = b.ajustement && b.ajustement.unite === 'pct' ? 'pct' : 'eur';
  const ajustementValeur = Number(b.ajustement && b.ajustement.valeur) || 0;
  const ajustementMontant = Math.round((ajustementUnite === 'pct'
    ? sousTotalHt * (ajustementValeur / 100) : ajustementValeur) * 100) / 100;
  const sousTotalAjuste = Math.round((sousTotalHt + ajustementMontant) * 100) / 100;
  const taux = b.regime === 'tgca' ? Math.max(0, Number(b.tauxTgca) || 0) : 0;
  const vise = Math.round(sousTotalAjuste * (1 + taux) * 100) / 100;
  let ttc = vise;
  if (b.arrondi === 'euro') ttc = Math.floor(vise + 1e-9);
  else if (b.arrondi === 'dix') ttc = Math.floor(vise * 10 + 1e-9) / 10;
  ttc = Math.round(ttc * 100) / 100;

  // ⚠ CE QUI EST ARCHIVÉ EST LA DONNÉE BRUTE, PAS UN RENDU. Le serveur ne
  // formate rien (pas d'euro(), pas de maisonPapier()) : `modeleFacture` /
  // `dessinerFacture` (public/facture.js) sont les SEULS à savoir composer un
  // papier, et ils tournent CÔTÉ CLIENT — c'est la séparation déjà en place
  // pour les trois autres papiers (« cet écran ne dessine aucun document »,
  // voir devis-flash.js). `document.saisie` porte donc exactement la forme
  // que `modeleFacture(saisie, entreprise)` attend en entrée ; `document.
  // entreprise` fige l'identité de l'atelier TELLE QU'ELLE ÉTAIT à l'émission
  // — un changement plus tard dans Réglages ne doit jamais réécrire une
  // facture déjà sortie. La relecture (GET ci-dessous) rend cette paire telle
  // quelle ; c'est `ouvrirFacture` (app.js) qui rappelle `modeleFacture` avec,
  // exactement comme le fait l'écran de composition pour l'aperçu vivant.
  const entreprise = await getEntreprise();

  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    const { numero, rang } = await reserverNumeroFacture(cx, annee);
    const document = {
      saisie: {
        numero,
        date: jour,
        projet: borner(b.projet, 160),
        client,
        lignes,
        regime: b.regime === 'revente' || b.regime === 'export' ? b.regime : 'tgca',
        tauxTgca: Number(b.tauxTgca) || 0,
        arrondi: ['euro', 'dix'].includes(b.arrondi) ? b.arrondi : 'aucun',
        ajustement: { unite: ajustementUnite, valeur: ajustementValeur },
        vedette: b.vedette === 'ht' ? 'ht' : 'ttc',
        mode,
      },
      entreprise,
    };
    const { rows } = await cx.query(
      `INSERT INTO invoices (numero, annee, rang, dossier_id, client_nom, montant_ttc, emise_par, document)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, numero, document, montant_ttc`,
      [numero, annee, rang, dossierId, nomClient, ttc, borner(req.headers['x-qui'] ? decodeURIComponent(req.headers['x-qui']) : null, 80), document],
    );
    await cx.query('COMMIT');
    return res.status(201).json({
      id: rows[0].id, numero: rows[0].numero, montantTtc: Number(rows[0].montant_ttc), document: rows[0].document,
    });
  } catch (err) {
    await cx.query('ROLLBACK');
    // UN AUTRE APPEL A GAGNÉ LA COURSE entre notre lecture d'idempotence et
    // notre écriture (contrainte UNIQUE(dossier_id)) : on rend SA facture,
    // pas une erreur — c'est le même dossier, la même intention.
    if (err && err.code === '23505') {
      const { rows: apres } = await pool.query(
        'SELECT id, numero, document, montant_ttc FROM invoices WHERE dossier_id = $1', [dossierId],
      );
      if (apres.length) {
        return res.status(201).json({
          id: apres[0].id, numero: apres[0].numero, montantTtc: Number(apres[0].montant_ttc), document: apres[0].document,
        });
      }
    }
    throw err;
  } finally {
    cx.release();
  }
})));

// GET /api/requests/:id/facture → relit la facture d'un dossier, TELLE QUE
// STOCKÉE. Aucun recalcul, aucune lecture des Réglages courants : `document`
// porte déjà tout ce qu'il faut (saisie + entreprise figées à l'émission)
// pour que `modeleFacture`/`dessinerFacture` (côté client) recomposent
// EXACTEMENT le même papier qu'au premier jour.
app.get('/api/requests/:id/facture', exige('clients'), asyncH(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, numero, document, montant_ttc FROM invoices WHERE dossier_id = $1', [req.params.id],
  );
  if (!rows.length) return res.status(404).json({ error: 'Aucune facture pour ce dossier' });
  res.json({
    id: rows[0].id, numero: rows[0].numero, montantTtc: Number(rows[0].montant_ttc), document: rows[0].document,
  });
}));
```

**Note pour l'exécutant** : le total envoyé par l'écran (`saisie`/`compte`
côté `vente-flash.js`, voir Task 6) n'est PAS relu ici — il ne sert qu'à
l'aperçu et à l'impression côté client. Le serveur recalcule intégralement à
partir des `lignes` reçues et les DEUX seuls réglages qui influent sur le
calcul (`regime`/`tauxTgca`, `ajustement`, `arrondi`) : c'est ce calcul-là,
et lui seul, qui est archivé dans `document`. Un désaccord entre ce que
l'écran affichait et ce que le serveur archive n'est pas possible tant que
les deux implémentent la même arithmétique (voir Task 4 pour celle du
client, via `calculerDevis`) — s'assurer que les deux blocs de calcul
restent en phase est couvert par le test de Step 1 (les montants attendus y
sont écrits en dur, pas recopiés d'un des deux calculs).

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `node test/factures-api.test.js`
Expected: PASS.

- [ ] **Step 5: `npm test` complet**

Run: `npm test`
Expected: PASS, toute la suite (aucune route existante ne doit avoir changé
de comportement).

- [ ] **Step 6: Commit**

```bash
git add server.js test/factures-api.test.js
git commit -m "$(cat <<'EOF'
feat(api): émission de facture — numérotation sans trou, immuable

POST /api/factures réserve le numéro et insère la ligne dans LA MÊME
transaction (contrairement au numéro de devis, réservé côté écran) :
un rejet ne consomme aucun rang. Idempotent sur dossierId
(UNIQUE(dossier_id)) — une resoumission après perte de réponse réseau
retombe sur la facture déjà créée. Aucune route d'écriture après
création. GET /api/requests/:id/facture relit le document archivé tel
quel, sans recalcul.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: L'écran — `public/vente-flash.js`

**Files:**
- Create: `public/vente-flash.js` (point de départ : copie de `public/devis-flash.js`)
- Test: `test/vente-flash.test.js`

**Interfaces:**
- Consumes: `MODES_PAIEMENT`, `modeleFacture`, `dessinerFacture`, `CSS_FACTURE` (`facture.js`, Task 4) ; `menuPoser`, `menuRafraichir`, `poserStyleMenu` (`menu-recherche.js`, inchangé) ; `api` (`reseau.js`, inchangé).
- Produces: `initVenteFlash(root)`, `refreshVenteFlash()` — consommés par Task 7 (nav wiring dans `app.js`).

**⚠ Ceci est le plus gros morceau du lot.** La stratégie : partir d'une copie
FIDÈLE de `public/devis-flash.js` (2335 lignes, testé, en production), puis
appliquer une série de modifications CIBLÉES et documentées ci-dessous — pas
une réécriture. Chaque bloc « GARDER TEL QUEL » n'a besoin d'aucune
modification ; seuls les blocs « MODIFIER » et « SUPPRIMER » listés doivent
changer.

- [ ] **Step 1: Copier le fichier**

```bash
cp public/devis-flash.js public/vente-flash.js
```

- [ ] **Step 2: Remplacer l'en-tête du fichier**

Remplacer les lignes 1-32 (le grand commentaire d'en-tête) par :

```js
// ===========================================================================
// L'ÉCRAN DE VENTE FLASH — la facture qui se compose DEVANT le client
// ===========================================================================
// JUMEAU DU DEVIS FLASH (public/devis-flash.js), dont ce fichier est une
// copie modifiée — décision du 03/09/2026 : le bloc catalogue/chiffrage V9/
// chiffrage tasse fait ~1000 lignes couplées à l'état interne de l'écran, un
// chantier aussi gros que le reste de la facture à lui seul. Pas d'extraction
// en module partagé dans ce lot — deux implémentations qui se ressemblent, le
// temps de voir Vente Flash tourner. Voir
// docs/superpowers/specs/2026-09-03-facture-vente-flash-design.md §1.
//
// CE QUI CHANGE PAR RAPPORT AU DEVIS :
//   · Le papier est la FACTURE (facture.js), pas le devis : voir ce fichier
//     pour ce qui distingue les deux documents.
//   · PAS DE REPRISE / VERSION : une facture émise est immuable, il n'existe
//     pas de « V2 » — une nouvelle vente est un nouveau dossier.
//   · PAS D'ACOMPTE : le mode de règlement est obligatoire, le montant réglé
//     est TOUJOURS le TTC (§4 du spec).
//   · L'ÉMISSION APPELLE DEUX ROUTES EN SÉQUENCE : POST /api/comptoir/projet
//     (créer le dossier — INCHANGÉ, c'est la route de vente-directe.html)
//     PUIS POST /api/factures (émettre le document, immuable).
//
// LA FEUILLE DE STYLE EST PARTAGÉE avec le devis flash (`devis-flash.css`,
// posée via poserFeuille dans app.js) : c'est la MÊME grammaire — coupe en
// deux moitiés, rangée d'un article — et les deux écrans doivent rester
// visuellement cohérents (RÈGLE : tout ce qui peut être à la même hauteur
// l'est). Les classes internes gardent donc leur préfixe `dvf-` d'origine :
// ce n'est pas un oubli, c'est documenté ici pour que ça ne surprenne pas à
// la relecture. SEULS les cinq identifiants DOM lus par
// `document.getElementById` (portée GLOBALE, pas celle de `ROOT`) ont été
// renommés avec un préfixe `vf-` pour ne jamais collisionner avec le devis
// flash si les deux écrans sont montés dans la même page (voir chaque
// occurrence ci-dessous, marquée « ⚠ ID GLOBAL »).
//
// AUCUN COMPOSANT NEUF : mêmes cartes que le devis flash (reglages.css,
// fiche-atelier.css, charte.css), sauf « Fiscalité et règlement » qui perd
// son champ Acompte au profit d'un menu Mode de règlement obligatoire.

import {
  MODES_PAIEMENT, modeleFacture, dessinerFacture, CSS_FACTURE,
} from './facture.js';
import { REGIMES, ARRONDIS, AJUSTEMENT_UNITES, VEDETTES, jourAtelier } from './devis.js';
import { menuPoser, menuRafraichir, poserStyleMenu } from './menu-recherche.js';
import { api } from './reseau.js';
```

- [ ] **Step 3: Renommer les cinq identifiants DOM à portée globale**

Ces cinq occurrences sont lues via `document.getElementById(...)` (portée
DOCUMENT ENTIER, pas `ROOT.querySelector`) — si le devis flash et Vente Flash
sont tous deux montés au moins une fois dans la page (chacun reste dans le
DOM, seulement `hidden`, une fois ouvert), un `id` partagé entre les deux
écrans devient ambigu et `document.getElementById` peut renvoyer l'élément du
MAUVAIS écran. Renommer, dans `public/vente-flash.js` SEULEMENT (ne pas
toucher `devis-flash.js`) :

| Ligne (dans la copie) | Avant | Après |
|---|---|---|
| `poserStyleDevis` (style tag id) | `'dv-style'` | `'fa-style'` |
| `poserStyleDevis` (nom de fonction) | `poserStyleDevis` | `poserStyleFacture` |
| `ID_PRODUITS` (déclaration + toutes les références) | valeur `'dvf-produits'` (vérifier la valeur exacte dans le fichier copié) | `'vf-produits'` |
| `ID_MARQUAGES` | `'dvf-marquages'` | `'vf-marquages'` |
| `ID_ENCRES` | `'dvf-encres'` | `'vf-encres'` |
| `ID_FACES` | `'dvf-faces'` | `'vf-faces'` |
| message flottant (`dire`) | `'dvf-msg'` | `'vf-msg'` |

Concrètement (fonction `poserStyleDevis`, en tête de fichier après les
imports) :
```js
function poserStyleFacture() {
  if (document.getElementById('fa-style')) return;
  const s = document.createElement('style');
  s.id = 'fa-style';
  s.textContent = CSS_FACTURE;
  document.head.appendChild(s);
}
```
Et dans `initVenteFlash` (voir Step 6), l'appel devient `poserStyleFacture()`
au lieu de `poserStyleDevis()`.

Pour les trois `ID_*` et `dvf-msg`, un remplacement textuel simple de la
CHAÎNE (pas du préfixe `dvf-` en général — voir Step 2 de l'en-tête, les
autres `dvf-` restent des noms de CLASSE partagés avec la feuille de style et
ne doivent PAS être touchés) suffit : chercher les définitions `const
ID_PRODUITS = ...`, `const ID_MARQUAGES = ...`, `const ID_ENCRES = ...`,
`const ID_FACES = ...`, et la ligne `msg.id = 'dvf-msg';` dans `dire()`, et
changer uniquement la valeur de la chaîne comme indiqué dans le tableau.

- [ ] **Step 4: Supprimer le concept de reprise/version**

Supprimer entièrement :
- La fonction exportée `reprendreDevis` (bloc complet, du commentaire
  `// REPRENDRE UN DEVIS...` jusqu'à la fermeture de la fonction).
- La fonction `valeurClient` SI elle n'est utilisée que par `reprendreDevis`
  (vérifier avec `grep -n "valeurClient" public/vente-flash.js` après la
  suppression — si plus aucun appel ne subsiste hormis la déclaration, la
  retirer aussi).
- Les variables `let repriseDe = null;` et `let version = 1;`.
- Dans `saisieNeuve()` : rien à retirer ici (ces variables sont externes à
  l'objet `saisie`).
- Toute lecture de `repriseDe`/`version` dans `peindre()` (le texte d'état du
  compteur — voir Step 8) et dans `enregistrer()`/`repartirDeZero()` (voir
  Steps 9 et 10).
- Le bouton « Reprendre » n'existe pas dans `devis-flash.js` lui-même (la
  reprise se déclenche depuis la fiche ailleurs) — rien à retirer côté UI
  pour ça spécifiquement, seulement l'export et son usage interne.

- [ ] **Step 5: Retirer le concept d'acompte et de validité/approvisionnement, ajouter le mode de règlement**

Dans `saisieNeuve()` :
```js
    numero: '',
    date: jour,
    validite: jourPlus(jour, VALIDITE_JOURS),
    projet: '',
```
devient :
```js
    numero: '',
    date: jour,
    projet: '',
```
(retirer aussi la constante `VALIDITE_JOURS` si elle n'est plus utilisée
ailleurs, et `jourPlus`/`APPRO_DEFAUT`/`APPROS` de l'import de `devis.js` —
Vente Flash n'importe QUE `REGIMES, ARRONDIS, AJUSTEMENT_UNITES, VEDETTES,
jourAtelier` de `devis.js`, comme posé au Step 2).

Retirer `appro: APPRO_DEFAUT,` de `saisieNeuve()`.

Remplacer :
```js
    acompte: 50,
    arrondi: 'euro',
```
par :
```js
    mode: '',
    arrondi: 'euro',
```

Dans `carteProjet()` (renommer en conservant la structure, retirer le rang
`Approvisionnement` et `Validité du devis` — la fonction `menu('dvf-appro',
APPROS, saisie.appro)` et son `rang(...)`, et `entree('dvf-validite', ...)`
et son `rang(...)`), garder Nom du projet / Date souhaitée / Heure souhaitée /
Maquette à faire / Note interne tels quels.

Dans `carteArgent()` : remplacer le champ Acompte
```js
  const acompte = entree('dvf-acompte', { type: 'number', valeur: saisie.acompte, classe: 'dvf-nb' });
  acompte.max = '100';
  acompte.placeholder = '0';
```
par un menu Mode de règlement, obligatoire :
```js
  const mode = menu('vf-mode', MODES_PAIEMENT, saisie.mode);
```
(la fonction `menu(id, options, valeur)` existe déjà dans le fichier — même
usage que `regime`/`arrondi` juste au-dessus).

Remplacer la rangée :
```js
    rang('Acompte %', acompte),
```
par :
```js
    rang('Mode de règlement', mode),
```

Remplacer l'écouteur :
```js
  acompte.addEventListener('input', () => {
    saisie.acompte = Math.min(100, Math.max(0, Number(acompte.value) || 0));
    redessiner();
  });
```
par :
```js
  mode.addEventListener('change', () => { saisie.mode = mode.value; redessiner(); });
```

- [ ] **Step 6: Renommer les exports et l'appel de style**

```js
export async function initDevisFlash(root) {
  ROOT = root;
  root.classList.add('devis-flash');
  poserStyleDevis();
```
devient :
```js
export async function initVenteFlash(root) {
  ROOT = root;
  root.classList.add('devis-flash');   // même classe : c'est la même feuille de style (devis-flash.css)
  poserStyleFacture();
```

```js
export async function refreshDevisFlash() {
```
devient :
```js
export async function refreshVenteFlash() {
```

- [ ] **Step 7: Retirer `sansPrix` — une facture ne porte jamais de ligne sans prix**

Le devis flash distingue un article « à chiffrer » (`sansPrix`) d'un article
offert (prix à 0 VOULU) — voir `calculerDevis`/`modeleDevis` dans `devis.js`.
Une facture ne connaît PAS cette distinction : à l'émission, TOUT est déjà
chiffré (§4 du spec). `calculerDevis` (importé indirectement via
`modeleFacture`, dans `facture.js`) gère déjà `sansPrix` en interne — rien à
changer dans le MOTEUR. Ce qui change ici, c'est le BOUTON D'ÉMISSION (voir
Step 9) : il doit rester désactivé tant qu'UNE ligne n'a pas de prix, alors
que « Enregistrer » du devis l'autorisait.

Dans `peindre()`, la ligne :
```js
    const manquants = compte.lignes.filter((l) => l.sansPrix).length;
    const reste = manquants ? ` · ${manquants} à chiffrer` : '';
```
reste identique — elle sert toujours à l'affichage informatif du compteur
(« 2 articles · 3 à chiffrer »), utile pendant la SAISIE. C'est uniquement la
condition d'activation du bouton (Step 9) qui change.

- [ ] **Step 8: Adapter `peindre()` — titre de l'en-tête, feuille, état**

Dans `batir()`, remplacer :
```js
  titres.append(el('h1', 'ecran-tete__titre', 'Devis'));
```
par :
```js
  titres.append(el('h1', 'ecran-tete__titre', 'Vente flash'));
```

Et les trois boutons de l'en-tête :
```js
  const bNeuf = el('button', 'reg-btn', 'Nouveau devis');
  bNeuf.type = 'button';
  bNeuf.id = 'dvf-neuf';
  const bImp = el('button', 'reg-btn', 'Imprimer / PDF');
  bImp.type = 'button';
  bImp.id = 'dvf-imprimer';
  const bSave = el('button', 'reg-btn reg-btn--primary', 'Enregistrer au planning');
  bSave.type = 'button';
  bSave.id = 'dvf-enregistrer';
```
deviennent (UN SEUL bouton d'action — pas de « Imprimer » séparé, l'émission
imprime automatiquement, comme décrit dans le spec §6) :
```js
  const bNeuf = el('button', 'reg-btn', 'Nouvelle vente');
  bNeuf.type = 'button';
  bNeuf.id = 'dvf-neuf';
  const bSave = el('button', 'reg-btn reg-btn--primary', 'Émettre la facture');
  bSave.type = 'button';
  bSave.id = 'dvf-enregistrer';
```
et plus bas dans `batir()` :
```js
  bNeuf.addEventListener('click', repartirDeZero);
  bImp.addEventListener('click', imprimer);
  bSave.addEventListener('click', enregistrer);
```
devient :
```js
  bNeuf.addEventListener('click', repartirDeZero);
  bSave.addEventListener('click', emettreFacture);
```
et
```js
  d.append(bNeuf, bImp, bSave);
```
devient :
```js
  d.append(bNeuf, bSave);
```

Dans `peindre()`, remplacer le bloc du compteur d'état :
```js
    const etatDevis = repriseDe ? `reprise du dossier — version ${version + 1}`
      : (dossierId ? 'au planning' : 'brouillon local');
```
par :
```js
    const etatDevis = dossierId ? 'facture émise' : 'brouillon local';
```

Et le texte du bouton :
```js
    bSave.textContent = repriseDe ? `Enregistrer la version ${version + 1}`
      : (dossierId ? 'Enregistré' : 'Enregistrer');
```
par :
```js
    bSave.textContent = dossierId ? 'Facture émise' : 'Émettre la facture';
```

Et sa condition de désactivation — `compte` est DÉJÀ calculé en tête de
`peindre()` (`const compte = calculerDevis(saisie);`, tout au début de la
fonction, dans le fichier copié) : la nouvelle condition le réutilise
directement, sans second appel. AJOUT DE DEUX CONDITIONS par rapport au
devis : un mode de règlement choisi, et AUCUNE ligne sans prix (voir Step 7) :
```js
  if (bSave) {
    bSave.disabled = (!!dossierId && !repriseDe) || !saisie.lignes.length
      || !String(saisie.client.nom || '').trim();
```
devient :
```js
  if (bSave) {
    bSave.disabled = !!dossierId || !saisie.lignes.length
      || !String(saisie.client.nom || '').trim()
      || !saisie.mode
      || compte.lignes.some((l) => l.sansPrix);
```

Enfin, remplacer le rendu de la feuille :
```js
  const feuille = $('#dvf-feuille');
  if (feuille) {
    feuille.replaceChildren(dessinerDevis(modeleDevis(saisie, entreprise), document));
    mettreALEchelle();
  }
```
par :
```js
  const feuille = $('#dvf-feuille');
  if (feuille) {
    feuille.replaceChildren(dessinerFacture(modeleFacture(saisie, entreprise), document));
    mettreALEchelle();
  }
```

- [ ] **Step 9: Remplacer `imprimer()` + `enregistrer()` par `emettreFacture()`**

Supprimer les deux fonctions `imprimer()` et `enregistrer()` en entier
(du commentaire `// IMPRIMER` jusqu'à la fin de `enregistrer()`, juste avant
`function repartirDeZero()`), et les remplacer par :

```js
// ===========================================================================
// ÉMETTRE LA FACTURE
// ===========================================================================
// DEUX APPELS EN SÉQUENCE, JAMAIS UN SEUL :
//   1. POST /api/comptoir/projet crée le DOSSIER — route INCHANGÉE, c'est
//      celle de vente-directe.html/pont.js : idempotence par empreinte,
//      découpe en lot, routage production (textile V9, gravure) préservés
//      sans y toucher.
//   2. POST /api/factures émet le DOCUMENT, une fois le dossier créé —
//      idempotent sur son id (voir server.js) : une resoumission après perte
//      de réponse réseau ne double jamais la facture.
// Puis IMPRESSION AUTOMATIQUE, dans un cadre hors écran — même mécanique que
// `imprimer()` sur le devis, mais un seul clic fait tout : composer un devis
// se discute avec le client avant d'imprimer ; une vente flash conclut une
// vente déjà décidée.
let emissionEnCours = false;
async function emettreFacture() {
  if (emissionEnCours || dossierId) return;
  const nom = String(saisie.client.nom || '').trim();
  if (!nom) return dire('Le nom du client est requis', 'is-ko');
  if (!saisie.lignes.length) return dire('Une vente sans article ne s’émet pas', 'is-ko');
  if (!saisie.mode) return dire('Le mode de règlement est requis', 'is-ko');
  const compte = calculerDevis(saisie);
  if (compte.lignes.some((l) => l.sansPrix)) return dire('Chaque article doit porter un prix', 'is-ko');

  emissionEnCours = true;
  const bouton = $('#dvf-enregistrer');
  if (bouton) bouton.disabled = true;
  try {
    // --- 1. Le dossier, par la route du comptoir --------------------------
    // TOUT EST EN TTC ICI, PAS EN HT. `partsDuTicket` (server.js) compare la
    // somme des `amount` d'articles au montant TTC du dossier (voir
    // `rDossier` plus bas, `amount: compte.ttc`) — un article envoyé en HT
    // ferait un écart de la taxe entière, absorbé dans le premier article. Le
    // taux effectif vient de `compte.tauxTgca` (déjà résolu par
    // `calculerDevis` selon le régime — 0 sur Revente/Export), jamais de
    // `saisie.tauxTgca` brut qui ignorerait le régime.
    const articles = compte.lignes.map((l) => ({
      label: l.designation,
      qty: l.quantite,
      amount: Math.round(l.totalHt * (1 + compte.tauxTgca) * 100) / 100,
      prod: { ref: l.reference, couleur: l.couleur, marquage: l.marquage, encre: l.encre },
      // MOTEUR « UNITAIRE » : le prix est déjà tranché à l'émission (par le
      // moteur V9 ou le catalogue), on l'archive tel quel plutôt que de
      // rejouer une chiffrage textile complexe server-side pour ce lot. Une
      // correction de quantité plus tard au planning recalcule linéairement
      // sur ce prix — pas le dégressif V9 d'origine. Limite connue, acceptée
      // pour ce lot (voir spec).
      chiffrage: {
        moteur: 'unitaire',
        unitTTC: Math.round(l.unitaireHt * (1 + compte.tauxTgca) * 100) / 100,
        rate: 0,
      },
      detail: l.note || null,
    }));
    const rDossier = await api('POST', '/api/comptoir/projet', {
      source: 'Vente directe',
      clientObj: {
        name: saisie.client.nom, company: saisie.client.nom, type: saisie.client.type,
      },
      amount: compte.ttc,
      // `name`/`quantity` NE SERVENT QUE SUR UN PANIER D'UN SEUL ARTICLE :
      // server.js (POST /api/comptoir/projet) ne construit un « lot » multi-
      // lignes qu'à partir de deux articles ou plus — sur un seul, il retombe
      // sur CES DEUX CHAMPS RACINE pour la désignation et la quantité, et
      // ignore `articles[0].label`/`articles[0].qty` pour ça (seuls
      // `articles[0].prod`/`articles[0].chiffrage` sont repris dans ce cas).
      // Les poser inconditionnellement est sans effet quand il y a plusieurs
      // articles (le serveur les ignore alors).
      name: articles.length === 1 ? articles[0].label : `${articles.length} articles`,
      quantity: articles.length === 1 ? articles[0].qty : undefined,
      articles,
      paiement: { mode: saisie.mode },
      dueDate: saisie.dueDate, dueTime: saisie.dueHeure,
      comment: saisie.noteInterne,
      client_info: [
        ['Client', saisie.client.nom], ['Type de client', saisie.client.type === 'perso' ? 'Particulier' : 'Professionnel'],
        ['Ville', saisie.client.ville], ['Téléphone', saisie.client.tel], ['E-mail', saisie.client.email],
      ].filter(([, v]) => v),
      details: articles.flatMap((a, i) => [
        [`Article ${i + 1} — Désignation`, a.label],
        a.prod.couleur ? [`Article ${i + 1} — Couleur`, a.prod.couleur] : null,
        a.prod.marquage ? [`Article ${i + 1} — Marquage`, a.prod.marquage] : null,
      ].filter(Boolean)),
    });
    dossierId = rDossier && rDossier.id ? rDossier.id : null;
    if (!dossierId) throw new Error('Le dossier n’a pas pu être créé');

    // --- 2. La facture, immuable --------------------------------------------
    const rFacture = await api('POST', '/api/factures', {
      dossierId,
      client: saisie.client,
      mode: saisie.mode,
      regime: saisie.regime,
      tauxTgca: saisie.tauxTgca,
      arrondi: saisie.arrondi,
      vedette: saisie.vedette,
      ajustement: { unite: compte.ajustement.unite, valeur: compte.ajustement.valeur },
      lignes: compte.lignes,
      jour: jourAtelier(),
    });
    saisie.numero = (rFacture && rFacture.numero) || '';

    // --- 3. Impression automatique -------------------------------------------
    const t = modeleFacture(saisie, entreprise);
    const cadre = document.createElement('iframe');
    cadre.setAttribute('aria-hidden', 'true');
    cadre.style.cssText = 'position:fixed;left:-9999px;top:0;width:820px;height:1200px;border:0';
    document.body.appendChild(cadre);
    const d = cadre.contentDocument;
    d.title = `Facture ${t.numero || ''}`.trim();
    const style = d.createElement('style');
    style.textContent = `@page{size:A4 portrait;margin:0}body{margin:0;background:#fff}${CSS_FACTURE}`;
    d.head.appendChild(style);
    d.body.appendChild(dessinerFacture(t, d));
    cadre.contentWindow.focus();
    cadre.contentWindow.print();
    setTimeout(() => cadre.remove(), 1000);

    dire(`Facture ${t.numero} émise`, 'is-ok');
    peindre();
  } catch (err) {
    dire(err.message || 'Émission impossible', 'is-ko');
  } finally {
    emissionEnCours = false;
    peindre();
  }
}
```

- [ ] **Step 10: Simplifier `repartirDeZero()`**

Retirer toute référence à `repriseDe` dans cette fonction (elle n'existe
plus). Le reste (confirmation avant de vider un brouillon non émis) reste
identique.

- [ ] **Step 11: Vérifier qu'aucune référence morte ne subsiste**

Run: `grep -n "repriseDe\|reprendreDevis\|dvf-appro\|dvf-validite\|dvf-acompte\|modeleDevis\|dessinerDevis\|CSS_DEVIS\|imprimer()\|enregistrer()" public/vente-flash.js`
Expected: aucune occurrence (hormis, éventuellement, dans des commentaires
explicatifs qui COMPARENT au devis flash — à relire au cas par cas, ce ne
sont pas des bugs).

Run: `node --check public/vente-flash.js`
Expected: le fichier est syntaxiquement valide (`node --check` ne résout pas
les imports ES mais valide la syntaxe).

- [ ] **Step 12: Écrire `test/vente-flash.test.js`**

Sur le modèle de `test/devis-flash.test.js` (assertions statiques sur le
texte source — cet écran n'est pas évalué dans un bac à sable, il pilote trop
de DOM/réseau pour ça) :

```js
'use strict';

// ===========================================================================
// L'ÉCRAN VENTE FLASH (03/09/2026)
// ===========================================================================
// Assertions statiques sur le SOURCE, comme test/devis-flash.test.js pour
// l'écran devis (ECRAN) : ce fichier pilote trop de DOM et de réseau pour
// être évalué dans un bac à sable vm, on vérifie donc sa forme.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const ECRAN = lire('public/vente-flash.js');

// --- Aucun piège d'accent grave dans un template literal du fichier --------
// (vente-flash.js n'a pas de gabarit de papier à lui — CSS_FACTURE vit dans
// facture.js, déjà couvert par test/facture.test.js — mais un accent grave
// resté dans un template literal copié depuis devis-flash.js romprait quand
// même la construction de chaîne : vérification de sûreté.)
assert.ok(!/`[^`]*` \+ CSS_FACTURE/.test(ECRAN) || !ECRAN.includes(String.fromCharCode(96) + String.fromCharCode(96)),
  'pas de gabarit corrompu dans vente-flash.js');

// --- Les exports attendus existent, ceux du devis flash ont disparu --------
assert.ok(/export\s+async\s+function\s+initVenteFlash/.test(ECRAN), 'initVenteFlash doit être exporté');
assert.ok(/export\s+async\s+function\s+refreshVenteFlash/.test(ECRAN), 'refreshVenteFlash doit être exporté');
assert.ok(!/export\s+.*reprendreDevis/.test(ECRAN), 'pas de reprise/version : une facture émise est immuable');
assert.ok(!ECRAN.includes('initDevisFlash') && !ECRAN.includes('refreshDevisFlash'),
  'les noms d’export du devis flash ne doivent pas traîner dans la copie');

// --- Le papier importé est la facture, pas le devis -------------------------
assert.ok(/from\s+'\.\/facture\.js'/.test(ECRAN), 'vente-flash.js doit importer facture.js');
assert.ok(!/modeleDevis|dessinerDevis|CSS_DEVIS/.test(ECRAN),
  'aucune trace du papier devis ne doit rester dans l’écran de vente');

// --- Pas d'acompte, un mode de règlement obligatoire ------------------------
assert.ok(!/saisie\.acompte/.test(ECRAN), 'pas de concept d’acompte sur une facture');
assert.ok(/saisie\.mode/.test(ECRAN), 'le mode de règlement doit être un champ de la saisie');
assert.ok(/MODES_PAIEMENT/.test(ECRAN), 'le menu du mode de règlement doit venir de MODES_PAIEMENT (facture.js)');

// --- Le bouton d'émission est bloqué sans mode de règlement -----------------
assert.ok(/!saisie\.mode/.test(ECRAN),
  'le bouton "Émettre la facture" doit être désactivé tant qu’aucun mode de règlement n’est choisi');
assert.ok(/l\.sansPrix/.test(ECRAN),
  'le bouton doit rester désactivé tant qu’une ligne n’a pas de prix — contrairement au devis');

// --- Les cinq identifiants DOM globaux ne collisionnent pas avec le devis --
for (const idGlobal of ['fa-style', 'vf-produits', 'vf-marquages', 'vf-encres', 'vf-faces', 'vf-msg']) {
  assert.ok(ECRAN.includes(idGlobal), `l’identifiant ${idGlobal} doit exister — voir Task 6 Step 3 du plan`);
}
for (const idDevis of ["'dv-style'", "'dvf-produits'", "'dvf-marquages'", "'dvf-encres'", "'dvf-faces'", "'dvf-msg'"]) {
  assert.ok(!ECRAN.includes(idDevis),
    `${idDevis} (identifiant global du devis flash) ne doit pas réapparaître dans vente-flash.js — collision de DOM possible`);
}

// --- L'émission enchaîne bien les deux appels réseau, dans l'ordre ---------
const idxProjet = ECRAN.indexOf("api('POST', '/api/comptoir/projet'");
const idxFacture = ECRAN.indexOf("api('POST', '/api/factures'");
assert.ok(idxProjet > -1 && idxFacture > -1, 'les deux appels doivent exister');
assert.ok(idxProjet < idxFacture, '/api/comptoir/projet doit être appelé AVANT /api/factures — le dossier doit exister avant la facture');

// --- Le panier d'UN SEUL article envoie name/quantity à la racine ----------
// (voir server.js, POST /api/comptoir/projet : sur un seul article, il lit
// produit/quantité dans CES CHAMPS RACINE, pas dans articles[0] — un piège
// déjà tombé une fois en écrivant ce plan, voir la task correspondante).
assert.ok(/name:\s*articles\.length\s*===\s*1/.test(ECRAN),
  'le payload doit poser `name` à la racine pour le cas d’un seul article');
assert.ok(/quantity:\s*articles\.length\s*===\s*1/.test(ECRAN),
  'le payload doit poser `quantity` à la racine pour le cas d’un seul article');

console.log('✓ vente-flash : exports, papier, mode de règlement obligatoire, ids sans collision, ordre des appels, panier à un article');
```

- [ ] **Step 13: Lancer le test**

Run: `node test/vente-flash.test.js`
Expected: PASS. Si un assert échoue, c'est le signe d'une étape de portage
(Steps 2-11) incomplète — corriger `public/vente-flash.js`, ne pas affaiblir
le test.

- [ ] **Step 14: `npm test` complet**

Run: `npm test`
Expected: PASS — en particulier `test/meme-hauteur.test.js` (Vente Flash
n'est pas encore monté dans `index.html`/`app.js` à ce stade, donc ce test ne
peut pas encore l'auditer ; il doit néanmoins rester vert sur l'existant).

- [ ] **Step 15: Commit**

```bash
git add public/vente-flash.js test/vente-flash.test.js
git commit -m "$(cat <<'EOF'
feat(vente-flash): l'écran — porté depuis devis-flash.js

Copie modifiée, pas une extraction (décision du 03/09, voir spec §1).
Pas de reprise/version (une facture émise est immuable), pas
d'acompte (mode de règlement obligatoire, montant réglé = TTC).
Un seul bouton d'action : Émettre la facture appelle
POST /api/comptoir/projet (dossier, route inchangée) PUIS
POST /api/factures (document immuable), puis imprime automatiquement.

Cinq identifiants DOM à portée document (document.getElementById)
renommés en vf-*/fa-style pour ne jamais collisionner avec le devis
flash si les deux écrans sont montés dans la même page.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Le nouvel onglet — nav, montage, hash

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `initVenteFlash`, `refreshVenteFlash` (`vente-flash.js`, Task 6).
- Produces: onglet `#vente-flash` cliquable, section montée à la demande.

- [ ] **Step 1: `public/index.html` — le bouton d'onglet**

Après le bloc de `viewDevisFlash` (juste après sa fermeture `</a>`, avant
`viewMonTravail`), ajouter :

```html
        <!-- LA VENTE FLASH (03/09/2026) : jumeau du devis flash, pour la
             facture. Elle ne remplace PAS l'onglet « Vente » — celui-là reste
             l'écran comptoir existant (vente-directe.html), inchangé. Voir
             docs/superpowers/specs/2026-09-03-facture-vente-flash-design.md. -->
        <a class="nav-switch-btn" id="viewVenteFlash" href="#vente-flash">
          <span class="nav-switch-label">Vente flash</span>
        </a>
```

- [ ] **Step 2: `public/index.html` — la section**

Après la section `#devis-flash` (ligne ~440), ajouter :

```html
        <!-- Onglet Vente flash : la facture qui se compose DEVANT le client —
             saisie à gauche, feuille A4 vivante à droite, impression et
             émission immuable. Rendu par vente-flash.js, chargé au premier
             affichage. -->
        <section class="devis-flash" id="vente-flash" hidden aria-label="Vente flash"></section>
```

(⚠ la classe reste `devis-flash` — c'est la classe qui porte la feuille de
style partagée, voir Task 6 Step 2 ; seul l'`id` change.)

- [ ] **Step 3: `public/app.js` — la constante d'élément**

Juste après :
```js
const $viewDevisFlash = document.getElementById('viewDevisFlash');
```
ajouter :
```js
const $viewVenteFlash = document.getElementById('viewVenteFlash');
```

Juste après :
```js
const $devisflash = document.getElementById('devis-flash');
```
ajouter :
```js
const $venteflash = document.getElementById('vente-flash');
```

- [ ] **Step 4: `public/app.js` — le montage paresseux**

Juste après la fonction `mountDevisFlash()` (voir server.js Task 5 pour le
style de commentaire équivalent — ici c'est `app.js`), ajouter :

```js
// LA VENTE FLASH — même montage paresseux que le devis flash, et la MÊME
// feuille de style (`devis-flash.css` : c'est la grammaire partagée, voir
// vente-flash.js en tête de fichier).
let vfLoading = null;
let vfModule = null;
function mountVenteFlash() {
  if (!$venteflash) return;
  if (!vfLoading) {
    vfLoading = Promise.all([
      poserFeuille('reglages.css'), poserFeuille('devis-flash.css'), import('./vente-flash.js'),
    ])
      .then(([, , m]) => { vfModule = m; return m.initVenteFlash($venteflash); })
      .catch((err) => { vfLoading = null; vfModule = null; reportError(err); });
  } else if (vfModule && vfModule.refreshVenteFlash) {
    vfModule.refreshVenteFlash();
  }
}
```

- [ ] **Step 5: `public/app.js` — `VIEWS`, `setViewMode`, `rafraichirLaVue`**

Dans la map `VIEWS` (après `'#devis-flash': 'devisflash',`) :
```js
  '#vente-flash': 'venteflash',
```

Dans `setViewMode`, après :
```js
  if ($viewDevisFlash) $viewDevisFlash.classList.toggle('active', mode === 'devisflash');
```
ajouter :
```js
  if ($viewVenteFlash) $viewVenteFlash.classList.toggle('active', mode === 'venteflash');
```

Après :
```js
  const devisflash = mode === 'devisflash';
```
ajouter :
```js
  const venteflash = mode === 'venteflash';
```

Après :
```js
  if ($devisflash) $devisflash.hidden = !devisflash;
```
ajouter :
```js
  if ($venteflash) $venteflash.hidden = !venteflash;
```

Après :
```js
  if (devisflash) mountDevisFlash();
```
ajouter :
```js
  if (venteflash) mountVenteFlash();
```

Dans `rafraichirLaVue()`, après :
```js
  if (viewMode === 'devisflash') return mountDevisFlash();
```
ajouter :
```js
  if (viewMode === 'venteflash') return mountVenteFlash();
```

- [ ] **Step 6: Vérifier au navigateur**

Run (démarrer le serveur local comme d'habitude pour ce dépôt, ou utiliser le
`run`/preview du projet), puis dans le navigateur :
1. Ouvrir l'application, cliquer sur l'onglet « Vente flash ».
2. Vérifier que l'écran se monte (même mise en page que « Devis flash », en-tête
   « Vente flash », bouton « Émettre la facture »).
3. Vérifier dans les DevTools qu'aucune erreur console n'apparaît au montage.
4. Aller-retour entre « Devis flash » et « Vente flash » : vérifier que les
   DEUX restent accessibles et que rien ne casse (test de non-collision des
   ids en situation réelle, complément du test statique de Task 6).

- [ ] **Step 7: `npm test` complet, y compris `meme-hauteur`**

Run: `npm test -- test/meme-hauteur.test.js`
Expected: PASS. Si ce test échoue en signalant `.nav-switch-btn` ou une
hauteur écrite en dur dans `vente-flash.js`/`index.html`, corriger la source
— ne jamais affaiblir ce test (garde-fou de la règle « même hauteur »).

Run: `npm test`
Expected: PASS, suite complète.

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/app.js
git commit -m "$(cat <<'EOF'
feat(nav): onglet Vente flash, à côté de Vente et Devis flash

Montage paresseux comme les autres écrans lourds, même feuille de
style que le devis flash (grammaire partagée : coupe en deux, rangée
d'article). Ne touche à rien de l'écran Vente existant.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Rouvrir une facture émise depuis la fiche

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `GET /api/requests/:id/facture` (Task 5), `dessinerFacture`, `CSS_FACTURE` (`facture.js`, Task 4).
- Produces: bouton « Facture » dans la modale Ticket/Bon de commande existante, visible uniquement si le dossier porte une facture.

- [ ] **Step 1: Charger `facture.js` à la demande, comme `bureau.js`**

Chercher dans `public/app.js` la ligne (environ ligne 40) :
```js
  : import('./bureau.js').then((m) => { bureauMod = m; return m; }));
```
et le début de ce bloc (chargement paresseux de `bureau.js`, quelques lignes
au-dessus — `chargerBureau`). Ajouter juste après un bloc symétrique pour la
facture :

```js
// LA FACTURE, chargée à la demande comme le bon de commande — un poste qui
// n'ouvre jamais de facture ne télécharge jamais ce module.
let factureMod = null;
let factureModPromesse = null;
function chargerFacture() {
  return factureModPromesse || (factureModPromesse = import('./facture.js')
    .then((m) => { factureMod = m; return m; }));
}
```

- [ ] **Step 2: La fonction `ouvrirFacture(r)`**

Juste après la fonction `ouvrirBureau` (après sa fermeture, avant le
commentaire `// L'IDENTITÉ DE L'ATELIER`), ajouter :

```js
// ===========================================================================
// LA FACTURE — relecture d'un document déjà émis, jamais recalculé
// ===========================================================================
// CONTRAIREMENT AU TICKET ET AU BON DE COMMANDE (qui se recomposent à partir
// de la ligne courante), la facture ne se reconstruit JAMAIS depuis `fiche` :
// elle se RELIT depuis `invoices.document`.
//
// ⚠ CE QUE LE SERVEUR ARCHIVE EST LA DONNÉE BRUTE, PAS UN RENDU (voir Task 5,
// server.js n'importe pas facture.js — CommonJS contre module ES — et ne
// formate donc rien lui-même). `document.saisie` porte exactement ce que
// `modeleFacture` attend en entrée, `document.entreprise` fige l'identité de
// l'atelier TELLE QU'ELLE ÉTAIT à l'émission. Rouvrir une facture appelle
// donc `modeleFacture(document.saisie, document.entreprise)` — la MÊME
// fonction pure que l'écran de composition utilise pour l'aperçu vivant — et
// c'est CE résultat qui va à `dessinerFacture`. Un changement de taux de
// TGCA ou d'identité de l'atelier depuis l'émission ne change donc rien :
// `document.entreprise` est figé, pas relu depuis les Réglages courants.
let factureOuverte = false;
async function ouvrirFacture(r) {
  if (factureOuverte) return;
  factureOuverte = true;
  let mod;
  let doc;
  try {
    mod = await chargerFacture();
    const rep = await fetchBorne(`/api/requests/${r.id}/facture`);
    if (rep.status === 404) throw new Error('Aucune facture pour ce dossier');
    if (!rep.ok) throw new Error(`Erreur ${rep.status}`);
    const data = await rep.json();
    doc = mod.modeleFacture(data.document.saisie, data.document.entreprise);
  } catch (err) {
    factureOuverte = false;
    reportError(err);
    return;
  }
  poserStyleBureau(mod.CSS_FACTURE);   // même mécanique de <style> singleton que poserStyleBureau, id différent — voir Step 3

  const focusAvant = document.activeElement;
  const fond = document.createElement('div');
  fond.className = 'tk-modal';
  const carte = document.createElement('div');
  carte.className = 'tk-modal__card';
  carte.setAttribute('role', 'dialog');
  carte.setAttribute('aria-modal', 'true');
  carte.setAttribute('aria-label', `${doc.titre}${doc.numero ? ` ${doc.numero}` : ''}`);

  const feuille = document.createElement('div');
  feuille.className = 'tk-modal__paper';
  feuille.appendChild(mod.dessinerFacture(doc, document));

  const actions = document.createElement('div');
  actions.className = 'tk-modal__actions';
  const bouton = (label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ask__btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };
  const fermer = () => {
    fond.remove();
    document.removeEventListener('keydown', auClavier);
    factureOuverte = false;
    if (focusAvant && focusAvant.focus) focusAvant.focus();
  };
  const auClavier = (e) => { if (e.key === 'Escape') fermer(); };
  document.addEventListener('keydown', auClavier);

  actions.append(
    bouton('Fermer', fermer),
    bouton('Imprimer', () => {
      const cadre = document.createElement('iframe');
      cadre.setAttribute('aria-hidden', 'true');
      cadre.style.cssText = 'position:fixed;left:-9999px;top:0;width:820px;height:1200px;border:0';
      document.body.appendChild(cadre);
      const d = cadre.contentDocument;
      d.title = `${doc.titre} ${doc.numero || ''}`.trim();
      const style = d.createElement('style');
      style.textContent = `@page{size:A4 portrait;margin:0}body{margin:0;background:#fff}${mod.CSS_FACTURE}`;
      d.head.appendChild(style);
      d.body.appendChild(mod.dessinerFacture(doc, d));
      cadre.contentWindow.focus();
      cadre.contentWindow.print();
      setTimeout(() => cadre.remove(), 1000);
    }),
  );

  carte.append(feuille, actions);
  fond.append(carte);
  fond.addEventListener('click', (e) => { if (e.target === fond) fermer(); });
  document.body.append(fond);
  requestAnimationFrame(() => {
    fond.classList.add('open');
    const premier = actions.querySelector('button');
    if (premier) premier.focus();
  });
}
```

**Note pour l'exécutant** : `poserStyleBureau(mod.CSS_FACTURE)` ci-dessus est
un EMPRUNT DE COMMODITÉ — vérifier la signature réelle de `poserStyleBureau`
dans le fichier (elle pose un `<style>` singleton par id fixe, voir
`poserStyleTicket`/`poserStyleBureau` déjà dans `app.js`). Si cette fonction
est câblée EN DUR sur un id `bu-style` (spécifique au bon de commande) plutôt
que de recevoir l'id en paramètre, NE PAS la réutiliser telle quelle : écrire
une petite fonction jumelle `poserStyleFacturePapier(css)` pose un
`<style id="fa-papier-style">` — même schéma que `poserStyleBureau`, un id
différent pour ne pas se marcher dessus si les deux modales existent dans la
même session.

- [ ] **Step 3: Ajouter le bouton « Facture » dans la modale existante**

Chercher le bloc `actions.append(` de `ouvrirBureau` (celui qui pose
`bouton('Ticket atelier', ...)`, `bouton('Copier', ...)`,
`bouton('Imprimer', ...)`). Ajouter un bouton « Facture », affiché
UNIQUEMENT si une facture existe pour ce dossier — la présence se vérifie en
tentant `GET /api/requests/:id/facture` (léger, déjà mis en cache par le
navigateur si rejoué) OU, plus simple et sans appel réseau supplémentaire, en
ajoutant `facture_numero` à la réponse de liste des commandes (`SELECT ...`)
comme c'est déjà fait pour `facture_name` (pièce jointe PDF, voir
`server.js:1377-1380`). **Pour ce lot**, prendre l'option la plus simple :
afficher le bouton INCONDITIONNELLEMENT (comme « Ticket atelier ») et laisser
`ouvrirFacture` afficher un message d'erreur clair (« Aucune facture pour ce
dossier ») via `reportError` si la requête rend 404 — cohérent avec le
comportement déjà existant de `ouvrirTicket`/`ouvrirBureau` sur un dossier
incomplet (`TICKET_SANS_DETAIL`).

```js
  actions.append(
    bouton('Fermer', fermer),
    bouton('Ticket atelier', () => { fermer(); ouvrirTicket(r); }),
    bouton('Facture', () => { fermer(); ouvrirFacture(r); }),
    bouton('Copier', () => {
```
(insérer la ligne `bouton('Facture', ...)` juste après `bouton('Ticket
atelier', ...)`, avant `bouton('Copier', ...)` — le reste du bloc ne change
pas).

- [ ] **Step 4: Vérifier manuellement au navigateur**

1. Émettre une facture depuis l'onglet « Vente flash » (Task 6/7).
2. Ouvrir la fiche du dossier créé (recherche globale ou planning → « À
   trier » / « Préparation »).
3. Ouvrir la modale existante (bouton qui ouvre `ouvrirBureau` aujourd'hui),
   cliquer « Facture ».
4. Vérifier que le document s'affiche, avec le bon numéro et le bon montant.
5. Cliquer « Imprimer », vérifier que l'aperçu d'impression s'ouvre.
6. Sur un dossier SANS facture (créé par l'écran Vente existant), cliquer
   « Facture » et vérifier qu'un message d'erreur clair s'affiche plutôt
   qu'un plantage silencieux.

- [ ] **Step 5: `npm test` complet**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "$(cat <<'EOF'
feat(fiche): rouvrir une facture émise, sans jamais la recalculer

Bouton Facture dans la modale existante (à côté de Ticket atelier /
Bon de commande / Imprimer). Relit invoices.document tel qu'archivé —
un changement de taux ou d'identité de l'atelier depuis l'émission ne
change jamais un document déjà sorti.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Vérification finale et revue de cohérence

**Files:** aucun (tâche de vérification uniquement)

- [ ] **Step 1: Suite complète**

Run: `npm test`
Expected: 100% vert, y compris `test/meme-hauteur.test.js`,
`test/comptoir.test.js`, `test/comptoir-simplifie.test.js` (aucune régression
sur `POST /api/comptoir/projet`).

- [ ] **Step 2: Vérifier qu'aucune référence morte au devis ne traîne dans l'écran de vente**

Run: `grep -n "repriseDe\|reprendreDevis\|modeleDevis\|dessinerDevis\|CSS_DEVIS\|saisie\.acompte" public/vente-flash.js`
Expected: aucune occurrence (déjà vérifié à la fin de la Task 6, ce Step le
reconfirme après les Tasks 7 et 8 qui ont pu toucher des fichiers voisins).

- [ ] **Step 3: Vérifier la couverture du spec, section par section**

Relire `docs/superpowers/specs/2026-09-03-facture-vente-flash-design.md` et
cocher mentalement : §2 (document) → Task 4 ; §3 (base, numérotation sans
trou) → Tasks 1 et 5 ; §4 (règlement complet) → Tasks 4, 5, 6 ; §5 (routes) →
Task 5 ; §6 (écran) → Tasks 6-7 ; §7 (ce qui ne change pas) → vérifié par les
tests existants qui restent verts ; §9 (tests) → Tasks 4, 5, 6, 7.

- [ ] **Step 4: Test manuel de bout en bout**

1. Onglet Vente flash → composer une vente avec 2 articles (un catalogue, un
   textile personnalisé si le catalogue de test en propose) → choisir un mode
   de règlement → Émettre la facture.
2. Vérifier : impression déclenchée, message « Facture FA-... émise »,
   bouton passé à « Facture émise » et désactivé.
3. Retrouver le dossier au planning (« À trier » ou « Préparation »).
4. Ouvrir la fiche → bouton Facture → vérifier le document, réimprimer.
5. Émettre une SECONDE facture depuis Vente flash (nouveau client) → vérifier
   que le numéro suit immédiatement le premier (`FA-2026-0002` après
   `FA-2026-0001`, aucun trou même si des tests ont tourné entre les deux —
   les tests utilisent une base pg-mem ÉPHÉMÈRE en local donc n'affectent pas
   la série de la session manuelle).

- [ ] **Step 5: Rapport final**

Résumer ce qui a été livré, ce qui reste explicitement hors scope (avoirs,
règlement partiel, conversion devis→facture, extraction du sélecteur
d'article, retrait de vente-directe.html), et rappeler que le texte des
mentions légales (`facture.js`) doit être relu par Charlie avant toute
utilisation en contrôle réel.
