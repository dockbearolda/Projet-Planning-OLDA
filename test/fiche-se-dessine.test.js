'use strict';

// ===========================================================================
// LA FICHE SE DESSINE POUR DE VRAI (30/08/2026)
// ===========================================================================
// Tous les autres contrôles de la fiche LISENT son texte : ils vérifient qu'une
// règle est écrite, qu'un appel a la bonne forme, qu'un nom a disparu. Aucun ne
// l'EXÉCUTE — et c'est ce trou qui a laissé passer DEUX fois le même défaut
// dans la même journée :
//
//   · en retirant la pastille de confirmation, la déclaration d'`empiler` — la
//     ligne d'à côté — est partie avec elle. Plus rien ne s'enregistrait dès
//     qu'une valeur changeait vraiment ;
//   · en remplaçant le champ de l'heure par un menu, l'appel qui construit la
//     date du retrait (`ligneDate('Retrait par le client', …)`) est parti de la
//     même façon. La fiche ne s'ouvrait plus du tout.
//
// Dans les deux cas la syntaxe restait valable, `node --check` passait, et les
// 126 contrôles restaient verts. C'est un DESSIN qu'il fallait, pas une lecture.
//
// CE QUE CE CONTRÔLE FAIT : il monte un document minuscule — juste ce que la
// fiche touche — et il appelle `dessinerFicheAtelier` sur un dossier complet
// puis sur un dossier NU. Toute erreur de référence, tout appel à quelque chose
// qui n'existe plus, tombe ici. Il ne juge pas l'apparence : c'est le travail
// des autres.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(RACINE, 'public/fiche-atelier.js'), 'utf8');

// --- UN DOCUMENT MINUSCULE -------------------------------------------------
// Il ne simule pas un navigateur : il rend des objets qui acceptent ce que la
// fiche leur demande. Un membre oublié se voit tout de suite — le dessin jette.
function faireElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    attributs: {},
    value: '',
    textContent: '',
    className: '',
    hidden: false,
    options: [],
    classList: {
      add() {}, remove() {}, toggle() {}, contains() { return false; },
    },
    append(...n) { for (const x of n) if (x && typeof x === 'object') el.children.push(x); },
    appendChild(n) { el.append(n); return n; },
    replaceChildren(...n) { el.children = []; el.append(...n); },
    replaceWith() {},
    remove() {},
    setAttribute(k, v) { el.attributs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attributs, k) ? el.attributs[k] : null; },
    removeAttribute(k) { delete el.attributs[k]; },
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    blur() {},
    click() {},
    contains() { return false; },
    getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    insertBefore(n) { el.append(n); return n; },
  };
  return el;
}

const doc = {
  createElement: (t) => faireElement(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
  addEventListener() {},
  removeEventListener() {},
  body: faireElement('body'),
  head: faireElement('head'),
  documentElement: faireElement('html'),
  activeElement: null,
};

const bac = {
  document: doc,
  window: { addEventListener() {}, removeEventListener() {}, innerWidth: 1440, innerHeight: 900 },
  console,
  Math,
  JSON,
  Number,
  String,
  Array,
  Object,
  Date,
  Set,
  Map,
  Promise,
  Error,
  parseFloat,
  parseInt,
  isNaN,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: (f) => setTimeout(f, 0),
  CustomEvent: function CustomEvent() {},
  Event: function Event() {},
  KeyboardEvent: function KeyboardEvent() {},
  PointerEvent: function PointerEvent() {},
};
vm.createContext(bac);

// Le module est un module ES du navigateur : on l'évalue après avoir neutralisé
// ses `export` et ses `import`, comme le fait déjà `test/fiche-atelier.test.js`.
// Le calendrier est le seul import, et il ne sert qu'au clic sur la date.
const NU = JS.replace(/^export /gm, '').replace(/^import[\s\S]*?from '[^']*';$/gm, 'const calendrierOuvrir = () => {};');
vm.runInContext(`${NU}\nthis.dessiner = dessinerFicheAtelier;`, bac);
const dessiner = bac.dessiner;
assert.strictEqual(typeof dessiner, 'function', 'le module rend bien sa fonction de dessin');

// --- LE CONTEXTE, tel que app.js le passe ---------------------------------
const ctx = {
  patchLigne: () => Promise.resolve(),
  patchFiche: () => Promise.resolve(),
  patchProd: () => Promise.resolve(),
  fermer: () => {},
  ouvrirClient: () => {},
  confirmer: () => Promise.resolve(true),
  creerFace: () => Promise.resolve(true),
  rafraichir: () => {},
  rappelDelai: () => '5 jours ouvrés restant',
  aujourdhui: () => new Date(2026, 7, 30, 12, 0, 0),
  etapes: [{ value: 'a|b', label: 'À chiffrer', groupe: 'Demande' }],
  employes: ['Mélina', 'Charlie'],
  provenances: ['Passage', 'Instagram'],
  reglements: [{ value: '', label: 'Non défini' }, { value: 'cb', label: 'CB' }],
  types: [{ value: 'pro', label: 'Pro' }],
  facesProposees: () => ['Coeur', 'Dos'],
  familleDesFaces: () => ({ nom: 'T-shirt', faces: ['Coeur', 'Dos'] }),
  marquage: { tarifable: true, connus: ['Coeur', 'Dos'], actuels: ['Coeur'], ecarts: { Dos: 492.96 } },
  lotDossier: 'DEMO-1000',
};

// --- 1. UN DOSSIER COMPLET -------------------------------------------------
{
  const r = {
    id: 1,
    billing_company: 'Beach Bar Orient',
    product: 'T-shirt unisexe léger Pro 145 g',
    contact_phone: '0690778899',
    contact_referent: 'Nathalie R.',
    responsable: 'Mélina',
    client_type: 'pro',
    provenance: '',
    deadline: '2026-09-05',
    project_value: 1399.32,
    cout_revient: 605.55,
    acompte_montant: null,
    acompte_date: null,
    paiement_mode: 'cb',
    paye: false,
    priority: 2,
    stage: 'a',
    sub_stage: 'b',
    description: 'Devis parti le 15',
    fiche: {
      ref: 'DEMO-1000',
      heureSouhaitee: '14:30',
      prod: {
        ref: 'K3025',
        couleur: 'Bleu marine',
        marquage: 'DTF',
        encre: '',
        tailles: [{ t: 'S', n: 5 }, { t: 'M', n: 25 }, { t: 'L', n: 15 }],
        logos: [{ face: 'Coeur' }],
      },
    },
  };
  assert.doesNotThrow(() => dessiner(r, ctx),
    'la fiche se dessine sur un dossier complet');
}

// --- 2. UN DOSSIER NU ------------------------------------------------------
// `fiche.prod` n'existe sur AUCUN des dossiers de la production (mesuré le
// 29/08 : 0 sur 187). C'est le cas NORMAL, pas le cas limite.
{
  const nu = { id: 2, billing_company: '', product: '', stage: 'a', sub_stage: null, fiche: {} };
  assert.doesNotThrow(() => dessiner(nu, { ...ctx, marquage: null, lotDossier: '' }),
    'la fiche se dessine sur un dossier nu — ni production, ni prix, ni faces');
}

// --- 3. ET SANS LES CROCHETS FACULTATIFS DU CONTEXTE -----------------------
// `app.js` les pose tous, mais la fiche les garde tous derrière un `&&` ou un
// `?` : ce contrôle vérifie que c'est encore vrai.
{
  const minimal = {
    patchLigne: () => Promise.resolve(),
    patchFiche: () => Promise.resolve(),
    patchProd: () => Promise.resolve(),
    fermer: () => {},
    etapes: [],
    employes: [],
    provenances: [],
    reglements: [],
    types: [],
  };
  const r = { id: 3, stage: 'a', sub_stage: null, fiche: { prod: { tailles: [], logos: [] } } };
  assert.doesNotThrow(() => dessiner(r, minimal),
    'la fiche se dessine même quand le contexte ne porte que ses trois écritures');
}

console.log('✓ fiche atelier : elle se DESSINE — dossier complet, dossier nu, contexte minimal');
