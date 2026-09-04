'use strict';

// LE BANC DE DESSIN DE LA FICHE ATELIER — partagé (04/09/2026)
// ===========================================================================
// Il montait un document minuscule et appelait `dessinerFicheAtelier` dessus,
// dans `fiche-se-dessine.test.js`. Un DEUXIÈME contrôle en a eu besoin le
// 04/09 — celui qui vérifie que la prise de commande du comptoir se retrouve
// dans la fiche. Recopié, le banc serait devenu deux bancs le jour où la fiche
// demande une méthode de plus au faux document : l'un des deux tests se serait
// mis à mentir sans que personne le voie.
//
// IL NE SIMULE PAS UN NAVIGATEUR : il rend des objets qui acceptent ce que la
// fiche leur demande. Un membre oublié se voit tout de suite — le dessin jette.

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
// Deux imports : le calendrier, qui ne sert qu'au clic sur la date et qu'on
// bouchonne — et `nom-client.js`, dont on colle le VRAI source devant, parce
// que c'est lui qui décide comment le nom du client s'affiche.
const NOM_CLIENT = fs.readFileSync(path.join(__dirname, '..', 'public', 'nom-client.js'), 'utf8')
  .replace(/^export /gm, '');
const NU = JS.replace(/^export /gm, '').replace(/^import[\s\S]*?from '[^']*';$/gm, '');
vm.runInContext(
  `const calendrierOuvrir = () => {};\n${NOM_CLIENT}\n${NU}\nthis.dessiner = dessinerFicheAtelier;`,
  bac,
);
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


// CE QUE LA FICHE A ÉCRIT, À PLAT. Le faux document n'a pas d'`innerText` : on
// descend l'arbre et on ramasse tout ce qui se lit — textes, valeurs de champs,
// et les attributs qui PORTENT du sens (`title`, `aria-label`), parce qu'une
// information posée là est une information affichée.
function texteRendu(noeud, vus) {
  const dejaVus = vus || new Set();
  if (!noeud || typeof noeud !== 'object' || dejaVus.has(noeud)) return '';
  dejaVus.add(noeud);
  let out = '';
  if (noeud.nodeType === 3) return String(noeud.textContent || '') + ' ';
  if (noeud.textContent) out += String(noeud.textContent) + ' ';
  if (noeud.value) out += String(noeud.value) + ' ';
  for (const k of ['title', 'aria-label', 'placeholder']) {
    const v = noeud.attributs && noeud.attributs[k];
    if (v) out += v + ' ';
  }
  for (const opt of noeud.options || []) out += texteRendu(opt, dejaVus);
  for (const enfant of noeud.children || []) out += texteRendu(enfant, dejaVus);
  return out;
}

module.exports = { dessiner, ctx, faireElement, doc, texteRendu };
