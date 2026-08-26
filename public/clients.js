// Base clients (CRM) — Atelier OLDA
// La fiche client PRO de référence, rapatriée de l'ancienne app « Base clients ».
// Liste cherchable + fiche éditable EN PLACE + notes/historique. Cette base
// alimente la prise de commande (auto-complétion) et se remplit toute seule
// quand un nouveau client est saisi au comptoir.
//
// Chargé À LA DEMANDE par app.js au premier passage sur la vue ; ensuite chaque
// retour ne fait que rafraîchir les données (un client a pu naître d'une commande).

import { groupDigits } from './whatsapp.js';
// La boîte de confirmation de l'application. `window.confirm()` ouvrait la boîte
// grise du système : hors charte, minuscule au doigt sur la tablette, et elle
// GÈLE le thread — le planning ne se rafraîchit plus tant qu'elle est à l'écran.
import { confirmerAction } from './confirmer.js';
// Un enregistrement de fiche client ne doit pas rester en suspens : sans
// minuteur, le bouton « Enregistrer » se désarme et ne se réarme jamais.
import { fetchBorne } from './reseau.js';
// Le focus suit la fenêtre qui s'ouvre, et revient d'où il venait à la
// fermeture. Le tiroir se déclarait modal en laissant le clavier DERRIÈRE lui.
import { armerModale } from './modale.js';

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
const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// Champs éditables de la fiche (ordre d'affichage). `list` = suggestions
// (datalist) construites depuis les valeurs déjà présentes dans la base.
export const FIELDS = [
  { key: 'entreprise', label: 'Nom entreprise', icon: 'apartment', ph: '', required: true },
  { key: 'raison_sociale', label: 'Raison sociale EBP', icon: 'gavel', ph: '' },
  { key: 'code', label: 'Identifiant', icon: 'tag', ph: '—' },
  { key: 'nom', label: 'Nom', icon: 'person', ph: '', casse: 'majuscules' },
  { key: 'prenom', label: 'Prénom', icon: 'badge', ph: '', casse: 'initiales' },
  { key: 'referent_prenom', label: 'Référent (prénom)', icon: 'badge', ph: '', casse: 'initiales' },
  { key: 'secteur', label: 'Secteur d’activité', icon: 'work', ph: '', list: 'cl-dl-secteurs' },
  { key: 'adresse', label: 'Adresse', icon: 'home_pin', ph: '' },
  { key: 'zone', label: 'Localisation', icon: 'location_on', ph: '', list: 'cl-dl-zones' },
  { key: 'ville', label: 'Ville', icon: 'location_city', ph: '', list: 'cl-dl-villes' },
  { key: 'pays', label: 'Pays', icon: 'public', ph: '' },
  { key: 'code_postal', label: 'Code postal', icon: 'markunread_mailbox', ph: '' },
  { key: 'telephone', label: 'WhatsApp', icon: 'call', ph: '', type: 'tel', inputmode: 'tel' },
  { key: 'email', label: 'E-mail', icon: 'mail', ph: '', type: 'email', inputmode: 'email' },
];

// Territoires desservis par l'atelier. Liste déroulante à SAISIE LIBRE (input +
// datalist) : ce sont les six qui reviennent tous les jours, pas une liste
// fermée — on peut taper n'importe quelle autre ville.
// Choisir l'une d'elles remplit Pays et Code postal (voir `applyVilleDefaults`).
// Sint Maarten n'utilise pas de code postal : le champ reste vide, pas rempli
// d'une valeur inventée.
export const VILLES = [
  { label: 'SAINT-MARTIN', pays: 'France', code_postal: '97150' },
  { label: 'SINT MAARTEN', pays: 'Sint Maarten', code_postal: '' },
  { label: 'SAINT-BARTHÉLEMY', pays: 'France', code_postal: '97133' },
  { label: 'ANGUILLA', pays: 'Anguilla', code_postal: 'AI-2640' },
  { label: 'GUADELOUPE', pays: 'France', code_postal: '97100' },
  { label: 'MARTINIQUE', pays: 'France', code_postal: '97200' },
];
const villeByLabel = (v) => VILLES.find((x) => fold(x.label) === fold(String(v || '').trim())) || null;

// Casse imposée à la saisie : « DUPONT » pour un nom, « Jean-Marc » pour un
// prénom. Appliquée au blur seulement — jamais pendant la frappe, sinon le
// curseur saute et corriger devient pénible.
export function applyCasse(mode, raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (s === '') return '';
  if (mode === 'majuscules') return s.toLocaleUpperCase('fr-FR');
  // Initiales : chaque mot, y compris après un tiret ou une apostrophe
  // (« jean-marc o'brien » → « Jean-Marc O'Brien »).
  return s.toLocaleLowerCase('fr-FR').replace(
    /(^|[\s\-'’])(\p{L})/gu,
    (_, sep, letter) => sep + letter.toLocaleUpperCase('fr-FR'),
  );
}

// Le TIRET veut dire « je n'ai pas l'info » : il fait passer l'étape et part
// vide au serveur.
export const estTiret = (v) => String(v == null ? '' : v).trim() === '-';
// Sur l'IDENTITÉ, le tiret ne vaut pas davantage : il ne reste pas non plus
// tel quel. Il partait en base, et « - » (ou « - - » pour un particulier)
// devenait le nom du dossier — clé de rapprochement vide, fiche impossible à
// retrouver, auto-complétion polluée.
export const valeurSaisie = (key, v) => (estTiret(v) ? '' : String(v == null ? '' : v).trim());
// Un champ d'identité rempli d'un tiret est donc VIDE au regard de la saisie :
// c'est ce que voit la validation, qui le surligne comme manquant.
export const champVide = (key, v) => valeurSaisie(key, v) === '';

// Champs affichés à la CRÉATION (et à l'édition) selon la nature du client.
// `code` (identifiant serveur) est géré à part : jamais dans ces listes, montré
// en lecture seule uniquement en édition. `type` (texte libre "Boutique,
// Hôtel…") n'est plus proposé dans les formulaires — redondant avec Secteur —
// mais la colonne reste lisible pour les fiches qui en ont déjà une.
export const PERSO_FIELDS = ['prenom', 'nom', 'telephone', 'email'];
// Ordre demandé par le patron : l'identité, puis l'adresse complète (la ville
// entraîne pays et code postal), puis le contact.
export const PRO_FIELDS = [
  'entreprise', 'raison_sociale', 'adresse', 'ville', 'pays', 'code_postal',
  'zone', 'secteur', 'referent_prenom', 'telephone', 'email',
];

export function fieldsForNature(nat) {
  const keys = nat === 'perso' ? PERSO_FIELDS : PRO_FIELDS;
  return keys.map((k) => FIELDS.find((f) => f.key === k));
}

// Secteurs d'activité : la liste vit EN BASE (app_meta.client_secteurs), le
// patron l'ajuste depuis Base clients. Ce cache est partagé avec Nouveau Projet
// pour que les deux formulaires proposent exactement la même chose. La valeur
// de départ est le repli quand l'appel échoue — pas la référence.
export let SECTEURS = [
  'Hôtel / Restaurant', 'Hôtel', 'Restaurant', 'Bar', 'Boutique', 'Agence immobilière',
  'Conciergerie', 'Villa de location', 'Nautisme', 'BTP', 'Artisan', 'Événementiel',
  'Association', 'École', 'Salle de sport', 'Santé', 'Tourisme', 'Transport',
  'Administration', 'Autre',
];

// Tous les datalists « secteur » montés dans la page (Base clients ET Nouveau
// Projet, chargés indépendamment) : un ajout doit apparaître dans les deux sans
// recharger l'application.
const SECTEUR_DATALISTS = new Set();

export function registerSecteurDatalist(dl) {
  SECTEUR_DATALISTS.add(dl);
  dl.replaceChildren(...SECTEURS.map((s) => new Option(s)));
}

function paintSecteurs() {
  for (const dl of SECTEUR_DATALISTS) {
    if (dl.isConnected) dl.replaceChildren(...SECTEURS.map((s) => new Option(s)));
    else SECTEUR_DATALISTS.delete(dl);
  }
}

export async function loadSecteurs() {
  try {
    const list = await api('GET', '/api/clients/secteurs');
    if (Array.isArray(list) && list.length) SECTEURS = list;
  } catch (_) { /* silencieux : on garde la liste connue */ }
  paintSecteurs();
  return SECTEURS;
}

export async function addSecteur(label) {
  const list = await api('POST', '/api/clients/secteurs', { label });
  if (Array.isArray(list)) SECTEURS = list;
  paintSecteurs();
  return SECTEURS;
}

export async function removeSecteur(label) {
  const list = await api('DELETE', `/api/clients/secteurs/${encodeURIComponent(label)}`);
  if (Array.isArray(list)) SECTEURS = list;
  paintSecteurs();
  return SECTEURS;
}

const NOTE_KINDS = [
  { id: 'note', label: 'Note', icon: 'sticky_note_2' },
  { id: 'appel', label: 'Appel', icon: 'call' },
  { id: 'email', label: 'Email', icon: 'mail' },
  { id: 'rdv', label: 'RDV', icon: 'event' },
];
const KIND_BY_ID = new Map(NOTE_KINDS.map((k) => [k.id, k]));

// Nature du client : pro (société) / perso (particulier). Axe DISTINCT du `type`
// métier libre (Boutique, Hôtel…). Filtre de liste + segmented dans la fiche.
const NATURES = [
  { id: 'pro', label: 'Professionnel', icon: 'apartment' },
  { id: 'revendeur', label: 'Revendeur', icon: 'storefront' },
  { id: 'asso', label: 'Association', icon: 'groups' },
  { id: 'perso', label: 'Particulier', icon: 'person' },
];
const NATURE_IDS = new Set(NATURES.map((n) => n.id));
const nature = (v) => (NATURE_IDS.has(v) ? v : 'pro');
const natureLabel = (v) => (NATURES.find((n) => n.id === nature(v)) || NATURES[0]).label;

// --- État ------------------------------------------------------------------
let LIST = [];             // clients (forme /api/clients, enrichie)
let query = '';
let sort = 'nom';          // 'nom' | 'recent'
let natureFilter = 'all';  // 'all' | 'pro' | 'perso'
let drawer = null;         // { id | null, mode, draft?, notes? }
let noteKind = 'note';

// --- API -------------------------------------------------------------------
async function api(method, path, body) {
  const res = await fetchBorne(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  // Le statut AVANT le corps : une page d'erreur du proxy (HTML) faisait échouer
  // l'analyse JSON d'abord, et le message affiché devenait « Unexpected token
  // '<' » au lieu de « Erreur 502 ».
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
  return data;
}

// --- Petits utilitaires d'affichage ---------------------------------------
function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return String(name || '?').replace(/\s+/g, '').slice(0, 2).toUpperCase() || '?';
}

// « il y a 3 j », « aujourd'hui », « il y a 2 h ». Repère de fraîcheur discret.
// Les montants s'écrivent en entier : sur une fiche client on regarde un ordre
// de grandeur, et « 12 450 € » se lit d'un coup quand « 12 449,80 € » se déchiffre.
const EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const euros = (n) => (Number.isFinite(Number(n)) ? EUROS.format(Number(n)) : '—');
const dateCourte = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
};

function ago(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'hier';
  if (d < 31) return `il y a ${d} j`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `il y a ${mo} mois`;
  return `il y a ${Math.floor(mo / 12)} an${mo >= 24 ? 's' : ''}`;
}

let toastTimer;
function toast(msg) {
  const t = $('#cl-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 3200);
}

// --- Construction statique (une fois) --------------------------------------
function buildStatic() {
  ROOT.replaceChildren();

  const view = el('div', 'cl');

  // En-tête : marque + recherche + tri + Nouveau.
  const head = el('header', 'cl-head');
  const brand = el('div', 'cl-brand');
  brand.append(el('span', 'cl-brand__av', 'O'));
  const bt = el('div', 'cl-brand__text');
  bt.append(el('h2', 'cl-brand__title', 'Base clients'));
  bt.append(el('p', 'cl-brand__sub', ''));
  brand.append(bt);

  const search = el('div', 'cl-search');
  search.append(ic('search', 'cl-search__ic'));
  const input = el('input', 'cl-search__input');
  input.type = 'text';
  input.placeholder = 'Rechercher un client, une zone, un type…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Rechercher un client');
  input.id = 'cl-q';
  search.append(input);
  const clear = el('button', 'cl-search__clear', '×');
  clear.type = 'button';
  clear.id = 'cl-q-clear';
  clear.hidden = true;
  clear.setAttribute('aria-label', 'Effacer la recherche');
  search.append(clear);

  const natWrap = el('div', 'cl-filter');
  natWrap.setAttribute('role', 'group');
  natWrap.setAttribute('aria-label', 'Filtrer par nature');
  for (const f of [{ id: 'all', label: 'Tous' }, ...NATURES]) {
    const b = el('button', `cl-filter__btn${natureFilter === f.id ? ' is-on' : ''}`, f.label);
    b.type = 'button';
    b.dataset.nature = f.id;
    natWrap.append(b);
  }

  const sortWrap = el('div', 'cl-sort');
  for (const s of [{ id: 'nom', label: 'Nom' }, { id: 'recent', label: 'Récent' }]) {
    const b = el('button', `cl-sort__btn${sort === s.id ? ' is-on' : ''}`, s.label);
    b.type = 'button';
    b.dataset.sort = s.id;
    sortWrap.append(b);
  }

  const nw = el('button', 'cl-new');
  nw.type = 'button';
  nw.id = 'cl-new';
  nw.append(ic('add'), el('span', null, 'Nouveau'));

  // Gestion de la liste des secteurs d'activité : elle vit en base, on l'ajuste
  // ici plutôt que dans le code.
  // Classe DISTINCTE de .cl-sort__btn : le tri capte tous les clics de sa
  // classe en premier, il aurait avalé celui-ci (et posé sort = undefined).
  const secBtn = el('button', 'cl-tool');
  secBtn.type = 'button';
  secBtn.id = 'cl-secteurs-btn';
  secBtn.append(ic('work'), el('span', null, 'Secteurs'));

  head.append(brand, search, natWrap, sortWrap, secBtn, nw);

  const list = el('div', 'cl-list');
  list.id = 'cl-list';
  const empty = el('div', 'cl-empty', 'Aucun client.');
  empty.id = 'cl-empty';
  empty.hidden = true;

  view.append(head, list, empty);

  // Suggestions type / zone (remplies au rendu), secteur (liste modifiable en
  // base) et ville (les six territoires desservis, saisie libre autorisée).
  const dlT = el('datalist'); dlT.id = 'cl-dl-types';
  const dlZ = el('datalist'); dlZ.id = 'cl-dl-zones';
  const dlS = el('datalist'); dlS.id = 'cl-dl-secteurs';
  registerSecteurDatalist(dlS);
  const dlV = el('datalist'); dlV.id = 'cl-dl-villes';
  dlV.append(...VILLES.map((v) => new Option(v.label)));

  // Tiroir (fiche), overlay plein écran.
  const drawerEl = el('div', 'cl-drawer');
  drawerEl.id = 'cl-drawer';
  drawerEl.hidden = true;
  const scrim = el('div', 'cl-drawer__scrim');
  scrim.id = 'cl-drawer-scrim';
  const card = el('aside', 'cl-drawer__card');
  card.id = 'cl-drawer-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  drawerEl.append(scrim, card);

  const toastEl = el('div', 'cl-toast');
  toastEl.id = 'cl-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');

  // Panneau des secteurs (overlay), monté une fois, rempli à l'ouverture.
  const secPanel = el('div', 'cl-secteurs');
  secPanel.id = 'cl-secteurs';
  secPanel.hidden = true;

  ROOT.append(view, dlT, dlZ, dlS, dlV, drawerEl, secPanel, toastEl);
}

// --- Liste -----------------------------------------------------------------
// Un SEUL comparateur français, construit une fois : `localeCompare(…, 'fr')`
// re-instancie la collation Intl à chaque comparaison — sur un tri complet de
// la base à chaque frappe, c'était la ligne la plus chaude de l'onglet.
const COLLATEUR_FR = new Intl.Collator('fr');

// Les datalists (types, zones) ne bougent qu'avec les DONNÉES, pas avec la
// frappe : elles se refaisaient pourtant à chaque rendu — deux Set sur toute la
// base et deux tris Intl par caractère tapé. On les reconstruit sur demande
// explicite (chargement, enregistrement), voir majSuggestions().
function suggestions() {
  const types = [...new Set(LIST.map((c) => c.type).filter(Boolean))].sort(COLLATEUR_FR.compare);
  const zones = [...new Set(LIST.map((c) => c.zone).filter(Boolean))].sort(COLLATEUR_FR.compare);
  $('#cl-dl-types').replaceChildren(...types.map((t) => new Option(t)));
  $('#cl-dl-zones').replaceChildren(...zones.map((z) => new Option(z)));
}

function filtered() {
  const needle = fold(query).trim();
  let list = LIST;
  if (natureFilter !== 'all') list = list.filter((c) => nature(c.client_type) === natureFilter);
  if (needle) {
    const parts = needle.split(/\s+/);
    list = list.filter((c) => {
      const hay = fold([c.entreprise, c.nom, c.fonction, natureLabel(c.client_type), c.type, c.zone, c.telephone, c.email].filter(Boolean).join(' '));
      return parts.every((p) => hay.includes(p));
    });
  }
  list = [...list];
  if (sort === 'recent') list.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  else list.sort((a, b) => COLLATEUR_FR.compare(a.entreprise, b.entreprise));
  return list;
}

function card(c) {
  const b = el('button', 'cl-card');
  b.type = 'button';
  b.dataset.id = c.id;
  if (drawer && drawer.id === c.id) b.classList.add('is-active');

  b.append(el('span', 'cl-av', initials(c.entreprise)));

  const body = el('div', 'cl-card__body');
  const nameRow = el('div', 'cl-card__namerow');
  nameRow.append(el('span', 'cl-card__name', c.entreprise));
  const nat = nature(c.client_type);
  nameRow.append(el('span', `cl-nature cl-nature--${nat}`, natureLabel(nat)));
  body.append(nameRow);
  const sub = [c.nom, c.type, c.zone].filter(Boolean).join(' · ');
  body.append(el('div', 'cl-card__sub', sub || '—'));
  b.append(body);

  const meta = el('div', 'cl-card__meta');
  const badges = el('div', 'cl-card__badges');
  if (c.commandes > 0) {
    const cmd = el('span', 'cl-badge cl-badge--cmd');
    cmd.append(ic('receipt_long'), el('span', null, String(c.commandes)));
    cmd.title = `${c.commandes} commande${c.commandes > 1 ? 's' : ''} au planning`;
    badges.append(cmd);
  }
  if (c.notes_count > 0) {
    const nt = el('span', 'cl-badge cl-badge--note');
    nt.append(ic('chat'), el('span', null, String(c.notes_count)));
    nt.title = `${c.notes_count} note${c.notes_count > 1 ? 's' : ''}`;
    badges.append(nt);
  }
  meta.append(badges);
  meta.append(el('span', 'cl-card__time', ago(c.updated_at)));
  meta.append(ic('chevron_right', 'cl-card__chev'));
  b.append(meta);
  return b;
}

function renderList() {
  const list = filtered();
  $('#cl-list').replaceChildren(...list.map(card));
  $('#cl-empty').hidden = list.length > 0;
  const clear = $('#cl-q-clear');
  if (clear) clear.hidden = !query;

  // Sous-titre : total, ou « filtrés / total » quand une recherche est active.
  const brandSub = $('.cl-brand__sub');
  if (brandSub) {
    brandSub.textContent = query
      ? `${list.length} / ${LIST.length} clients`
      : `OLDA · ${LIST.length} client${LIST.length > 1 ? 's' : ''}`;
  }
}

// Reformate un champ téléphone à la frappe (chiffres groupés par deux, comme
// « 06 90 66 24 00 ») en conservant la position du curseur, pour ne pas gêner
// la saisie en cours de numéro.
export function formatPhoneAsTyped(input) {
  // Le tiret « je n'ai pas l'info » n'est pas un numéro : le groupeur de
  // chiffres l'effacerait, et le champ ne pourrait jamais être marqué comme
  // volontairement vide.
  if (estTiret(input.value)) return;
  const pos = input.selectionStart ?? input.value.length;
  const digitsBefore = input.value.slice(0, pos).replace(/\D/g, '').length;
  input.value = groupDigits(input.value);
  let seen = 0, i = 0;
  while (i < input.value.length && seen < digitsBefore) {
    if (/\d/.test(input.value[i])) seen++;
    i++;
  }
  input.setSelectionRange(i, i);
}

// --- Fiche (tiroir) --------------------------------------------------------
export function fieldRow(field, value, opts) {
  const row = el('div', 'cl-f');
  const lab = el('label', 'cl-f__label');
  lab.append(ic(field.icon, 'cl-f__ic'), el('span', null, field.label));
  const input = el('input', 'cl-f__input');
  input.type = field.type || 'text';
  if (field.inputmode) input.inputMode = field.inputmode;
  if (field.list) input.setAttribute('list', field.list);
  input.value = value == null ? '' : value;
  input.placeholder = field.ph || '';
  input.autocomplete = 'off';
  input.dataset.key = field.key;
  const id = `cl-f-${field.key}`;
  input.id = id;
  lab.setAttribute('for', id);
  if (field.type === 'tel') input.addEventListener('input', () => formatPhoneAsTyped(input));
  // Casse imposée en quittant le champ (NOM en majuscules, Prénom en initiales).
  // Un tiret « je n'ai pas l'info » traverse tel quel, sans être transformé.
  if (field.casse) {
    input.addEventListener('blur', () => {
      if (estTiret(input.value)) return;
      const next = applyCasse(field.casse, input.value);
      if (next !== input.value) {
        input.value = next;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }
  row.append(lab, input);
  if (field.key === 'entreprise') input.classList.add('cl-f__input--strong');
  // Identifiant lisible : généré par le serveur à la création, jamais modifiable.
  if (field.key === 'code') { input.readOnly = true; input.classList.add('cl-f__input--readonly'); }
  return row;
}

// Choisir une ville remplit Pays et Code postal. Règle de NON-ÉCRASEMENT : on
// n'écrit que dans un champ vide, ou qui contient encore ce que la ville
// PRÉCÉDENTE y avait mis. Une valeur tapée à la main n'est jamais perdue, et les
// deux champs restent modifiables ensuite.
// Branché sur un jeu de champs déjà rendu (fiche complète ou formulaire de
// création) ; `onFilled` prévient l'appelant pour qu'il enregistre, s'il
// enregistre en place. `sel` laisse un formulaire au balisage différent (Nouveau
// Projet) réutiliser la règle de non-écrasement plutôt que d'en recopier une
// deuxième, forcément divergente à la longue.
export function wireVilleDefaults(fieldsWrap, onFilled, sel = '.cl-f__input') {
  const byKey = (k) => fieldsWrap.querySelector(`${sel}[data-key="${k}"]`);
  const ville = byKey('ville');
  if (!ville) return;
  // Ce que la ville a rempli la dernière fois : la seule chose qu'on s'autorise
  // à écraser, en plus du vide.
  let pose = villeByLabel(ville.value);

  const apply = () => {
    const v = villeByLabel(ville.value);
    if (!v) { pose = null; return; }   // ville libre : on ne devine rien
    let touched = false;
    for (const key of ['pays', 'code_postal']) {
      const champ = byKey(key);
      if (!champ) continue;
      const actuel = champ.value.trim();
      const ancien = pose ? pose[key] : '';
      if (actuel !== '' && actuel !== ancien) continue;   // saisie manuelle : intouchable
      if (actuel === v[key]) continue;
      champ.value = v[key];
      champ.classList.remove('cl-f__input--missing');
      champ.dispatchEvent(new Event('change', { bubbles: true }));
      touched = true;
    }
    pose = v;
    if (touched && onFilled) onFilled();
  };

  // `change` couvre le clic dans la liste déroulante, `blur` la saisie au clavier.
  ville.addEventListener('change', apply);
  ville.addEventListener('blur', apply);
}

// Validation partagée par le tiroir Base Clients ET le quick-form Nouveau
// Projet : les champs vides restent surlignés au blur (jamais au chargement)
// pour que tout continue à se lire comme obligatoire, mais le bouton ne
// bloque jamais la création. Un 1er clic avec des champs vides arme une
// confirmation (le bouton change de libellé/couleur quelques secondes) ;
// un 2e clic — ou le même clic une fois tout rempli — déclenche `onSubmit`.
export function wireCreateValidation(fieldsWrap, submitBtn, onSubmit) {
  const inputs = [...fieldsWrap.querySelectorAll('.cl-f__input')];
  const idleLabel = submitBtn.textContent;
  let armed = false;
  let armTimer = null;

  const disarm = () => {
    if (!armed) return;
    armed = false;
    clearTimeout(armTimer);
    submitBtn.textContent = idleLabel;
    submitBtn.classList.remove('is-confirm');
  };

  // `champVide` et pas `value.trim()` : un tiret dans un champ d'identité ne
  // remplit rien, il doit se surligner comme un champ laissé vide.
  const vide = (i) => champVide(i.dataset.key || '', i.value);

  for (const i of inputs) {
    i.addEventListener('input', () => {
      disarm();
      if (!vide(i)) i.classList.remove('cl-f__input--missing');
    });
    i.addEventListener('blur', () => {
      if (vide(i)) i.classList.add('cl-f__input--missing');
    });
  }

  submitBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const missing = inputs.filter(vide);
    if (missing.length === 0 || armed) { disarm(); onSubmit(); return; }
    for (const i of missing) i.classList.add('cl-f__input--missing');
    armed = true;
    submitBtn.textContent = 'Créer quand même';
    submitBtn.classList.add('is-confirm');
    armTimer = setTimeout(disarm, 5000);
  });
}

function noteEl(n) {
  const k = KIND_BY_ID.get(n.kind) || KIND_BY_ID.get('note');
  const item = el('div', `cl-note cl-note--${k.id}`);
  const head = el('div', 'cl-note__head');
  const badge = el('span', 'cl-note__kind');
  badge.append(ic(k.icon), el('span', null, k.label));
  head.append(badge, el('span', 'cl-note__time', ago(n.created_at)));
  const del = el('button', 'cl-note__del');
  del.type = 'button';
  del.dataset.noteId = n.id;
  del.title = 'Supprimer la note';
  del.setAttribute('aria-label', 'Supprimer la note');
  del.append(ic('close'));
  head.append(del);
  item.append(head, el('p', 'cl-note__body', n.body));
  return item;
}

// Le piège à focus du tiroir. Armé à l'OUVERTURE seulement : `renderDrawer` se
// rappelle à chaque frappe enregistrée, et le réarmer reprendrait le focus sous
// les doigts de qui est en train de taper.
let desarmerDrawer = null;

function renderDrawer() {
  const card = $('#cl-drawer-card');
  const box = $('#cl-drawer');
  if (!drawer) {
    box.hidden = true;
    if (desarmerDrawer) { desarmerDrawer(); desarmerDrawer = null; }
    return;
  }
  box.hidden = false;
  // La croix d'abord, jamais « Supprimer » : c'est la première chose
  // atteignable de l'en-tête, et on n'ouvre pas une fiche sur son bouton rouge.
  if (!desarmerDrawer) {
    desarmerDrawer = armerModale(card, { premier: () => card.querySelector('#cl-close') });
  }
  card.replaceChildren();

  const creating = drawer.mode === 'create';
  const c = drawer.draft;

  // En-tête : avatar + titre + supprimer + fermer.
  const head = el('header', 'cl-dh');
  head.append(el('span', 'cl-dh__av', initials(c.entreprise) || '+'));
  const titles = el('div', 'cl-dh__titles');
  titles.append(el('h2', 'cl-dh__title', creating ? 'Nouveau client' : (c.entreprise || 'Client')));
  const sub = [c.type, c.zone].filter(Boolean).join(' · ');
  titles.append(el('p', 'cl-dh__sub', creating ? 'Renseignez au moins la société' : (sub || '—')));
  head.append(titles);
  const tools = el('div', 'cl-dh__tools');
  if (!creating) {
    const del = el('button', 'cl-dh__btn cl-dh__btn--danger');
    del.type = 'button';
    del.id = 'cl-del';
    del.title = 'Supprimer le client';
    del.setAttribute('aria-label', 'Supprimer le client');
    del.append(ic('delete'));
    tools.append(del);
  }
  const close = el('button', 'cl-dh__btn');
  close.type = 'button';
  close.id = 'cl-close';
  close.title = 'Fermer';
  close.setAttribute('aria-label', 'Fermer la fiche');
  close.append(ic('close'));
  tools.append(close);
  head.append(tools);
  card.append(head);

  const bodyScroll = el('div', 'cl-dbody');

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
  // Choisir une ville remplit pays et code postal. En mode édition, le `change`
  // émis par le remplissage passe par l'écouteur de la fiche : les deux champs
  // s'enregistrent tout seuls, sans code de sauvegarde en double ici.
  wireVilleDefaults(fieldGroup);
  fields.append(fieldGroup);
  bodyScroll.append(fields);

  // Actions rapides : appeler / écrire (fiche existante seulement).
  if (!creating) {
    const acts = el('div', 'cl-acts');
    const call = el('a', `cl-act${c.telephone ? '' : ' is-off'}`);
    call.append(ic('call'), el('span', null, 'Appeler'));
    if (c.telephone) call.href = `tel:${String(c.telephone).replace(/\s+/g, '')}`;
    const mail = el('a', `cl-act${c.email ? '' : ' is-off'}`);
    mail.append(ic('mail'), el('span', null, 'Écrire'));
    if (c.email) mail.href = `mailto:${c.email}`;
    acts.append(call, mail);
    bodyScroll.append(acts);

    // Méta + timeline.
    const meta = el('p', 'cl-meta');
    const parts = [];
    if (c.commandes > 0) parts.push(`${c.commandes} commande${c.commandes > 1 ? 's' : ''} au planning`);
    parts.push(`créé ${ago(c.created_at)}`);
    if (c.updated_at && c.updated_at !== c.created_at) parts.push(`modifié ${ago(c.updated_at)}`);
    meta.textContent = parts.join(' · ');
    bodyScroll.append(meta);

    // CE QUE LE CLIENT PÈSE (§9). La fiche disait QUI il est ; elle ne disait
    // pas s'il représente 200 € ou 12 000 €. En le rappelant au téléphone, c'est
    // la première chose qu'on voudrait savoir — et la seule qui n'y était pas.
    //
    // `ca` n'arrive QUE pour qui a le droit de voir l'argent : le serveur le
    // retire pour l'atelier. Absent, on n'affiche pas une case vide, on n'en
    // parle pas du tout.
    const poids = [];
    if (drawer.ca != null) poids.push({ n: euros(drawer.ca), t: 'chiffre d’affaires' });
    if (drawer.projets) poids.push({ n: String(drawer.projets), t: `dossier${drawer.projets > 1 ? 's' : ''}` });
    if (drawer.derniere_commande) poids.push({ n: dateCourte(drawer.derniere_commande), t: 'dernière commande' });
    if (poids.length) {
      const bloc = el('div', 'cl-poids');
      for (const x of poids) {
        const b = el('div', 'cl-poids__x');
        b.append(el('span', 'cl-poids__n', x.n), el('span', 'cl-poids__t', x.t));
        bloc.append(b);
      }
      bodyScroll.append(bloc);
    }

    // SES DERNIÈRES COMMANDES. Cinq suffisent : la fiche se lit au téléphone,
    // pas en réunion — au-delà, personne ne descend.
    if (Array.isArray(drawer.dernieres) && drawer.dernieres.length) {
      const liste = el('section', 'cl-dernieres');
      liste.append(el('h3', 'cl-notes__title', 'Dernières commandes'));
      for (const l of drawer.dernieres) {
        const ligne = el('div', 'cl-derniere');
        ligne.append(el('span', 'cl-derniere__quoi', l.product || 'Sans désignation'));
        if (l.project_value != null) ligne.append(el('span', 'cl-derniere__prix', euros(l.project_value)));
        ligne.append(el('span', 'cl-derniere__quand', dateCourte(l.created_at)));
        liste.append(ligne);
      }
      bodyScroll.append(liste);
    }

    const notes = el('section', 'cl-notes');
    const nh = el('header', 'cl-notes__head');
    nh.append(el('h3', 'cl-notes__title', 'Notes & historique'));
    nh.append(el('span', 'cl-notes__count', String((drawer.notes || []).length)));
    notes.append(nh);

    // Saisie d'une note (type + texte + ajouter).
    const composer = el('div', 'cl-composer');
    const ta = el('textarea', 'cl-composer__input');
    ta.id = 'cl-note-input';
    ta.rows = 2;
    ta.placeholder = 'Ajouter une note, un appel, un email, un rdv…';
    composer.append(ta);
    const bar = el('div', 'cl-composer__bar');
    const kinds = el('div', 'cl-kinds');
    for (const k of NOTE_KINDS) {
      const kb = el('button', `cl-kind${k.id === noteKind ? ' is-on' : ''}`);
      kb.type = 'button';
      kb.dataset.kind = k.id;
      kb.append(ic(k.icon), el('span', null, k.label));
      kinds.append(kb);
    }
    const add = el('button', 'cl-composer__add');
    add.type = 'button';
    add.id = 'cl-note-add';
    add.append(ic('add'), el('span', null, 'Ajouter'));
    bar.append(kinds, add);
    composer.append(bar);
    notes.append(composer);

    const timeline = el('div', 'cl-timeline');
    if ((drawer.notes || []).length === 0) {
      timeline.append(el('p', 'cl-timeline__empty', 'Aucune note pour ce client.'));
    } else {
      for (const n of drawer.notes) timeline.append(noteEl(n));
    }
    notes.append(timeline);
    bodyScroll.append(notes);
  }

  card.append(bodyScroll);

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
    wireCreateValidation(fieldGroup, create, createClient);
    setTimeout(() => {
      const first = fieldGroup.querySelector('.cl-f__input');
      if (first) first.focus();
    }, 40);
  }
}

// --- Ouverture / fermeture -------------------------------------------------
async function openClient(id) {
  // Optimiste : on ouvre tout de suite avec ce qu'on a, puis on complète (notes).
  const known = LIST.find((c) => c.id === id);
  drawer = { id, mode: 'edit', draft: { ...(known || { entreprise: '' }) }, notes: [] };
  renderDrawer();
  renderList();
  try {
    const full = await api('GET', `/api/clients/${id}`);
    if (drawer && drawer.id === id) {
      drawer.draft = { ...full };
      drawer.notes = full.notes || [];
      renderDrawer();
    }
  } catch (err) {
    toast(err.message || 'Fiche indisponible.');
  }
}

function openNew() {
  drawer = {
    id: null, mode: 'create',
    draft: {
      entreprise: '', raison_sociale: '', nom: '', prenom: '', referent_prenom: '',
      client_type: 'pro', type: '', secteur: '', zone: '', adresse: '',
      code_postal: '', ville: '', pays: '', telephone: '', email: '',
    },
    notes: [],
  };
  renderDrawer();
}

function closeDrawer() {
  drawer = null;
  renderDrawer();
  renderList();
}

// --- Mutations -------------------------------------------------------------
// Édition en place : PATCH d'un champ à la validation. Optimiste avec repli.
async function saveField(key, raw) {
  if (!drawer || drawer.mode !== 'edit') return;
  const value = String(raw).trim();
  const prev = drawer.draft[key] == null ? '' : String(drawer.draft[key]);
  if (value === prev) return;
  try {
    const updated = await api('PATCH', `/api/clients/${drawer.id}`, { [key]: value });
    drawer.draft = { ...drawer.draft, ...updated };
    // Reflète dans la liste locale sans tout recharger.
    const i = LIST.findIndex((c) => c.id === drawer.id);
    if (i >= 0) LIST[i] = { ...LIST[i], ...updated };
    // Un type ou une zone modifiés alimentent l'auto-complétion des fiches.
    if (key === 'type' || key === 'zone') suggestions();
    renderList();
    // Met à jour l'en-tête du tiroir (titre/sous-titre) sans casser le focus.
    const av = $('.cl-dh__av'); if (av) av.textContent = initials(drawer.draft.entreprise) || '+';
    const t = $('.cl-dh__title'); if (t) t.textContent = drawer.draft.entreprise || 'Client';
    const s = $('.cl-dh__sub'); if (s) s.textContent = [drawer.draft.type, drawer.draft.zone].filter(Boolean).join(' · ') || '—';
  } catch (err) {
    // Repli : on remet la valeur d'avant dans le champ.
    const input = $(`#cl-f-${key}`);
    if (input) input.value = prev;
    toast(err.message || 'Modification refusée.');
  }
}

// Nature pro/perso : posée par le segmented (bouton, pas champ texte). En
// édition on PATCH aussitôt ; en création on ne fait que mémoriser le choix.
async function setNature(value) {
  if (!drawer) return;
  const nat = nature(value);
  const avant = nature(drawer.draft.client_type);
  const unchanged = avant === nat;
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
    // La nature avait été posée à l'écran AVANT le PATCH (elle commande la
    // liste des champs). Si le serveur refuse, on revient à celle d'avant :
    // sinon la fiche affichait des champs « Particulier » sur un client resté
    // « Professionnel » en base, et l'édition suivante partait de ce mensonge.
    drawer.draft.client_type = avant;
    renderDrawer();
    toast(err.message || 'Modification refusée.');
  }
}

async function createClient() {
  if (!drawer || drawer.mode !== 'create') return;
  const nat = nature(drawer.draft.client_type);
  const draft = { client_type: nat };
  const shown = fieldsForNature(nat);
  for (const f of shown) {
    const input = $(`#cl-f-${f.key}`);
    if (input) draft[f.key] = valeurSaisie(f.key, input.value);
  }
  // `entreprise` reste la colonne obligatoire côté serveur : pour un
  // particulier, on la dérive du prénom + nom plutôt que de la demander une
  // deuxième fois (même logique que le quick-form Nouveau Projet).
  if (nat === 'perso') draft.entreprise = `${draft.prenom} ${draft.nom}`.trim();
  // Dernier verrou avant l'envoi : sans nom, la fiche n'a pas d'identité et
  // rien ne permettra plus de la rapprocher d'une commande.
  if (!draft.entreprise) {
    toast(nat === 'perso' ? 'Il faut au moins un prénom ou un nom.' : 'Il faut le nom de la société.');
    return;
  }
  const btn = $('#cl-create');
  if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }
  try {
    const created = await api('POST', '/api/clients', draft);
    LIST.push({ ...created, notes_count: 0, commandes: 0 });
    suggestions();
    // La réponse du POST EST la fiche : on ouvre avec elle, sans repasser par
    // `openClient` qui redemandait au serveur ce qu'il venait de nous rendre
    // (une fiche neuve n'a encore ni note ni commande à aller chercher).
    drawer = { id: created.id, mode: 'edit', draft: { ...created }, notes: [] };
    renderDrawer();
    renderList();
    toast('Client créé.');
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Créer le client'; }
    toast(err.message || 'Création impossible.');
  }
}

async function deleteClient() {
  if (!drawer || drawer.mode !== 'edit') return;
  const c = drawer.draft;
  const ok = await confirmerAction(
    'Supprimer cette fiche client ?',
    `« ${c.entreprise} » et tout son historique de notes seront retirés définitivement.`,
  );
  if (!ok) return;
  try {
    await api('DELETE', `/api/clients/${drawer.id}`);
    LIST = LIST.filter((x) => x.id !== drawer.id);
    closeDrawer();
    toast('Client supprimé.');
  } catch (err) {
    toast(err.message || 'Suppression impossible.');
  }
}

async function addNote() {
  if (!drawer || drawer.mode !== 'edit') return;
  const ta = $('#cl-note-input');
  const body = ta ? ta.value.trim() : '';
  if (!body) { if (ta) ta.focus(); return; }
  try {
    const note = await api('POST', `/api/clients/${drawer.id}/notes`, { kind: noteKind, body });
    drawer.notes = [note, ...(drawer.notes || [])];
    const i = LIST.findIndex((c) => c.id === drawer.id);
    if (i >= 0) LIST[i] = { ...LIST[i], notes_count: (LIST[i].notes_count || 0) + 1 };
    renderDrawer();
    renderList();
  } catch (err) {
    toast(err.message || 'Note non enregistrée.');
  }
}

async function deleteNote(noteId) {
  if (!drawer || drawer.mode !== 'edit') return;
  try {
    await api('DELETE', `/api/clients/${drawer.id}/notes/${noteId}`);
    drawer.notes = (drawer.notes || []).filter((n) => n.id !== noteId);
    const i = LIST.findIndex((c) => c.id === drawer.id);
    if (i >= 0) LIST[i] = { ...LIST[i], notes_count: Math.max(0, (LIST[i].notes_count || 0) - 1) };
    renderDrawer();
    renderList();
  } catch (err) {
    toast(err.message || 'Suppression impossible.');
  }
}

// --- Câblage ---------------------------------------------------------------
function wire() {
  // Clics (délégués).
  ROOT.addEventListener('click', (e) => {
    const t = e.target;

    const cardBtn = t.closest('.cl-card');
    if (cardBtn) return openClient(cardBtn.dataset.id);

    const sortBtn = t.closest('.cl-sort__btn');
    if (sortBtn) {
      sort = sortBtn.dataset.sort;
      for (const b of ROOT.querySelectorAll('.cl-sort__btn')) b.classList.toggle('is-on', b === sortBtn);
      return renderList();
    }

    const filterBtn = t.closest('.cl-filter__btn');
    if (filterBtn) {
      natureFilter = filterBtn.dataset.nature;
      for (const b of ROOT.querySelectorAll('.cl-filter__btn')) b.classList.toggle('is-on', b === filterBtn);
      return renderList();
    }

    const segBtn = t.closest('.cl-seg__btn');
    if (segBtn) return setNature(segBtn.dataset.nature);

    if (t.closest('#cl-new')) return openNew();
    if (t.closest('#cl-secteurs-btn')) return openSecteurs();
    if (t.closest('#cl-q-clear')) { query = ''; $('#cl-q').value = ''; $('#cl-q').focus(); return renderList(); }
    if (t.closest('#cl-close') || t.closest('#cl-close-2') || t.closest('#cl-drawer-scrim')) return closeDrawer();
    if (t.closest('#cl-del')) return deleteClient();
    if (t.closest('#cl-note-add')) return addNote();

    const kindBtn = t.closest('.cl-kind');
    if (kindBtn) {
      noteKind = kindBtn.dataset.kind;
      for (const b of ROOT.querySelectorAll('.cl-kind')) b.classList.toggle('is-on', b === kindBtn);
      return;
    }

    const delNote = t.closest('.cl-note__del');
    if (delNote) return deleteNote(delNote.dataset.noteId);
  });

  // Recherche. Le rendu est différé de quelques dizaines de millisecondes : à
  // chaque caractère, `renderList()` refabrique TOUTES les cartes de la base
  // (plusieurs centaines), ce qui hachait la frappe sur la tablette.
  let rechercheTimer = null;
  ROOT.addEventListener('input', (e) => {
    if (e.target.id === 'cl-q') {
      query = e.target.value;
      clearTimeout(rechercheTimer);
      rechercheTimer = setTimeout(renderList, 120);
    }
  });

  // Édition en place : on enregistre à la validation (blur ou Entrée).
  ROOT.addEventListener('change', (e) => {
    if (e.target.classList && e.target.classList.contains('cl-f__input') && drawer && drawer.mode === 'edit') {
      saveField(e.target.dataset.key, valeurSaisie(e.target.dataset.key, e.target.value));
    }
  });
  ROOT.addEventListener('keydown', (e) => {
    const secOuvert = $('#cl-secteurs') && !$('#cl-secteurs').hidden;
    if (e.key === 'Escape' && secOuvert) { e.preventDefault(); return closeSecteurs(); }
    if (e.key === 'Escape' && drawer) { e.preventDefault(); return closeDrawer(); }
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('cl-f__input')) {
      e.preventDefault();
      e.target.blur();
    }
  });
}

// --- Secteurs d'activité : gestion de la liste -----------------------------
// Un panneau simple : la liste, une croix par secteur, un champ pour en ajouter.
// Retirer un secteur ne touche AUCUNE fiche — la valeur y est recopiée, pas
// référencée : les clients « Boutique » restent « Boutique ».
function renderSecteursPanel() {
  const panel = $('#cl-secteurs');
  if (!panel || panel.hidden) return;
  panel.replaceChildren();

  const scrim = el('div', 'cl-secteurs__scrim');
  scrim.addEventListener('click', closeSecteurs);

  const card = el('div', 'cl-secteurs__card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Secteurs d’activité');

  const head = el('div', 'cl-secteurs__head');
  head.append(el('h3', 'cl-secteurs__title', 'Secteurs d’activité'));
  const close = el('button', 'cl-secteurs__close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Fermer');
  close.append(ic('close'));
  close.addEventListener('click', closeSecteurs);
  head.append(close);
  card.append(head);

  card.append(el('p', 'cl-secteurs__hint',
    'Ces secteurs sont proposés à la saisie d’une fiche. En retirer un ne change aucune fiche déjà remplie.'));

  const list = el('div', 'cl-secteurs__list');
  for (const sec of SECTEURS) {
    const chip = el('span', 'cl-secteurs__chip');
    chip.append(el('span', null, sec));
    const del = el('button', 'cl-secteurs__del');
    del.type = 'button';
    del.setAttribute('aria-label', `Retirer ${sec}`);
    del.append(ic('close'));
    del.addEventListener('click', async () => {
      del.disabled = true;
      try {
        await removeSecteur(sec);
        renderSecteursPanel();
      } catch (err) {
        del.disabled = false;
        toast(err.message || 'Suppression impossible.');
      }
    });
    chip.append(del);
    list.append(chip);
  }
  card.append(list);

  const addRow = el('form', 'cl-secteurs__add');
  const input = el('input', 'cl-f__input');
  input.type = 'text';
  input.placeholder = 'Ajouter un secteur…';
  input.setAttribute('aria-label', 'Nouveau secteur d’activité');
  const addBtn = el('button', 'cl-btn cl-btn--primary', 'Ajouter');
  addBtn.type = 'submit';
  addRow.append(input, addBtn);
  addRow.addEventListener('submit', async (e) => {
    e.preventDefault();
    const label = input.value.trim();
    if (!label) return;
    addBtn.disabled = true;
    try {
      await addSecteur(label);
      renderSecteursPanel();
      $('#cl-secteurs .cl-secteurs__add .cl-f__input').focus();
    } catch (err) {
      addBtn.disabled = false;
      toast(err.message || 'Ajout impossible.');
    }
  });
  card.append(addRow);

  panel.append(scrim, card);
}

let desarmerSecteurs = null;

function openSecteurs() {
  const panel = $('#cl-secteurs');
  if (!panel) return;
  panel.hidden = false;
  renderSecteursPanel();
  const card = panel.querySelector('.cl-secteurs__card');
  if (card && !desarmerSecteurs) {
    desarmerSecteurs = armerModale(card, { premier: () => card.querySelector('.cl-secteurs__close') });
  }
}

function closeSecteurs() {
  const panel = $('#cl-secteurs');
  if (!panel) return;
  if (desarmerSecteurs) { desarmerSecteurs(); desarmerSecteurs = null; }
  panel.hidden = true;
  panel.replaceChildren();
}

// --- Chargement ------------------------------------------------------------
async function load() {
  let recue = null;
  try {
    recue = await api('GET', '/api/clients');
  } catch (err) {
    toast('Base clients indisponible.');
  }
  // Un échec réseau ne doit RIEN effacer : `load()` est rappelé à chaque retour
  // sur la vue, et vider la liste faisait aussi disparaître la fiche en cours
  // d'édition (elle n'était plus trouvée dans une liste vide).
  if (!recue) {
    if (LIST.length === 0) renderList(); // rien n'a jamais été chargé : état vide assumé
    return;
  }
  LIST = recue;
  suggestions();   // les datalists suivent les données, pas la frappe
  renderList();
  // Si une fiche est ouverte, on la resynchronise avec la liste rechargée.
  if (drawer && drawer.id) {
    const fresh = LIST.find((c) => c.id === drawer.id);
    if (fresh) { drawer.draft = { ...drawer.draft, ...fresh }; }
    else closeDrawer();
  }
}

let mounted = false;
export async function initClients(root) {
  if (mounted) return;
  ROOT = root;
  buildStatic();
  wire();
  mounted = true;
  await Promise.all([load(), loadSecteurs()]);
}

// Rappelé par app.js à chaque retour sur la vue : un client a pu être créé
// depuis une prise de commande, ou modifié depuis un autre poste.
// Garde en vol + petit délai de grâce : basculer d'onglet en aller-retour
// rapide ne retélécharge pas deux fois toute la base.
let refreshEnVol = null;
let dernierLoad = 0;
export async function refreshClients() {
  if (!mounted) return;
  if (refreshEnVol) return refreshEnVol;
  if (Date.now() - dernierLoad < 3000) return;
  refreshEnVol = load().finally(() => {
    refreshEnVol = null;
    dernierLoad = Date.now();
  });
  return refreshEnVol;
}
