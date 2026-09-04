// File d'écriture des JSON de l'application (projets, index, réglages).
//
// Le chemin de sauvegarde du web n'a AUCUNE des garanties du bureau : une
// requête part sur le réseau, l'onglet peut se fermer avant qu'elle n'arrive,
// deux requêtes peuvent se doubler, et hors-ligne il n'y a personne au bout.
// Ce module rend l'enregistrement sûr en trois temps :
//
//  1. la modification est recopiée en localStorage AVANT de partir sur le
//     réseau. C'est une écriture SYNCHRONE : elle survit à la fermeture de
//     l'onglet, au crash, à la mise en arrière-plan d'iOS — trois cas où un
//     `fetch()` en vol est purement et simplement annulé par le navigateur ;
//  2. deux écritures du même fichier ne partent jamais en parallèle : elles
//     sont sérialisées, et une écriture en attente est remplacée par la plus
//     récente (inutile d'envoyer trois états intermédiaires). Sans cela, sur
//     un réseau lent, la réponse la plus lente arrive en dernier et REMET
//     l'ancien état — la modification est perdue alors que tout semblait bien ;
//  3. tant que le serveur n'a pas confirmé, la copie locale reste. Elle est
//     rejouée au retour du réseau et relue au prochain démarrage.
//
// est conservé (un seul code) et le miroir local n'y coûte rien.

import { chemin } from './base.js';

const enc = new TextEncoder();

// Au-delà de cette taille, on ne fait pas de miroir local : le quota
// localStorage (~5 Mo) est une ressource partagée, et les gros JSON (catalogue
// importé, ~550 Ko) ne s'écrivent que sur une action explicite avec son propre
// écran de progression — jamais au fil de la frappe. Les projets font 1 à 2 Ko.
const MIRROR_MAX = 256 * 1024;
const KEY = (rel) => 'bat:pending:' + rel;

// Dernière copie SERVEUR connue de chaque JSON, conservée pour pouvoir ouvrir
// l'application sans réseau. Le service worker met la coquille et les mockups
// en cache, mais jamais /api/ : servir un projet périmé serait précisément la
// perte de modification que ce module combat. Les données, elles, sont donc
// gardées ici — et toujours écrasées par la copie serveur dès qu'elle répond.
//
// Plafond plus haut que le miroir d'écriture : le catalogue produits (~550 Ko)
// doit en faire partie, sans lui un projet ouvert hors-ligne ne saurait pas
// quel vêtement afficher. L'ensemble tient sous le mégaoctet, loin du quota.
const CACHE_MAX = 2 * 1024 * 1024;
const CKEY = (rel) => 'bat:last:' + rel;

function cacheServerCopy(rel, text) {
  try {
    if (text.length > CACHE_MAX) localStorage.removeItem(CKEY(rel));
    else localStorage.setItem(CKEY(rel), text);
  } catch {
    // Quota atteint : le hors-ligne sera partiel, l'application en ligne reste
    // entière. On ne fait pas échouer une lecture réussie pour un cache.
  }
}

// Dernière copie serveur connue, ou null. Utilisée quand le réseau ne répond
// pas — jamais autrement : la copie serveur fraîche a toujours la priorité.
export function lastServerJSON(rel) {
  try {
    const text = localStorage.getItem(CKEY(rel));
    return text ? JSON.parse(text) : null;
  } catch { return null; }
}

export function rememberServerJSON(rel, obj) {
  try { cacheServerCopy(rel, JSON.stringify(obj)); } catch { /* objet non sérialisable */ }
}

export function forgetServerJSON(rel) {
  try { localStorage.removeItem(CKEY(rel)); } catch { /* stockage indisponible */ }
}

// ------------------------------------------------------------- les conflits
// Un fichier qu'un AUTRE appareil a modifié pendant qu'on travaillait dessus.
// Ni une panne (réessayer n'y changerait rien) ni une perte (la copie locale
// est gardée) : une question, à laquelle seul l'utilisateur peut répondre.
const conflits = new Map();      // rel → { local, serveur, base }
const surConflit = new Set();

export function onConflit(cb) { surConflit.add(cb); return () => surConflit.delete(cb); }
export function conflitsEnCours() { return [...conflits.keys()]; }
export function copieLocaleEnConflit(rel) {
  const c = conflits.get(rel);
  if (!c) return null;
  try { return JSON.parse(c.local); } catch { return null; }
}

// Résolution. 'local' : ma version gagne — on repart de l'horodatage du serveur
// comme base, donc l'écriture passe. 'serveur' : j'abandonne ma version — la
// copie locale est jetée et l'appelant rechargera.
export function resoudreConflit(rel, choix) {
  const c = conflits.get(rel);
  if (!c) return false;
  conflits.delete(rel);
  if (choix === 'local') {
    enfiler(rel, c.local, null, c.serveur?.updatedAt ?? null);
    setState('saving');
    pump();
  } else {
    unmirror(rel);
    setState(conflits.size ? 'conflit' : (pendingPaths().length ? 'pending' : 'saved'));
  }
  return true;
}

// --------------------------------------------------------------------- état
// 'saved' : tout est sur le serveur · 'saving' : écriture en vol ·
// 'pending' : au moins une modification attend le réseau (hors-ligne, erreur) ·
// 'conflit' : un autre appareil a modifié un fichier qu'on enregistrait.
let state = 'saved';
const listeners = new Set();

function setState(s) {
  if (s === state) return;
  state = s;
  for (const cb of listeners) { try { cb(s); } catch { /* un écouteur ne casse pas la sauvegarde */ } }
}

export function onSaveState(cb) {
  listeners.add(cb);
  cb(state);
  return () => listeners.delete(cb);
}

export const saveState = () => state;

// ------------------------------------------------------------ miroir local
function mirror(rel, text) {
  if (text.length > MIRROR_MAX) return;
  try {
    localStorage.setItem(KEY(rel), text);
  } catch {
    // Quota plein ou stockage refusé (navigation privée) : on continue sans
    // filet local plutôt que d'empêcher la sauvegarde réseau, qui reste la
    // voie normale. L'indicateur suffit alors à alerter.
  }
}

function unmirror(rel) {
  try { localStorage.removeItem(KEY(rel)); } catch { /* idem */ }
}

// Copie locale non confirmée d'un fichier, ou null. Lue au démarrage pour
// rattraper une modification que le serveur n'a jamais reçue.
export function pendingJSON(rel) {
  try {
    const text = localStorage.getItem(KEY(rel));
    return text ? JSON.parse(text) : null;
  } catch { return null; }
}

export function pendingPaths() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('bat:pending:')) out.push(k.slice('bat:pending:'.length));
    }
  } catch { /* stockage indisponible */ }
  return out;
}

// ------------------------------------------------------- file d'écriture
// Une entrée par chemin : { text, attentes }. `text` est TOUJOURS le dernier
// état voulu — une écriture qui attend est écrasée, pas empilée. `attentes`
// porte les promesses des appelants qui veulent SAVOIR (import de catalogue,
// suppression) : elles se règlent quand cet état-là est chez le serveur.
const queue = new Map();
let pumping = false;

// Met (ou remplace) l'état voulu d'un fichier dans la file. Les attentes déjà
// posées sont reprises : un appelant qui attend la confirmation de « catalogue »
// veut savoir que LE catalogue est enregistré, pas telle version intermédiaire.
function enfiler(rel, text, attente = null, base = null) {
  const precedent = queue.get(rel);
  const attentes = precedent?.attentes || [];
  if (attente) attentes.push(attente);
  // La BASE est celle de la PREMIÈRE modification non encore partie : c'est
  // l'état du serveur que l'utilisateur avait sous les yeux quand il a commencé
  // à travailler. Une modification qui en écrase une autre, toujours en file,
  // ne redéfinit pas ce point de départ.
  queue.set(rel, { text, attentes, base: precedent?.base ?? base });
}

// Réessai automatique à intervalle croissant. `online` ne suffit pas : il ne se
// déclenche que si la CARTE réseau retombe, pas si c'est le serveur qui ne
// répond plus (redéploiement Railway, wifi capté sans Internet). Sans ce
// minuteur, l'app resterait « en attente » jusqu'à la modification suivante.
let retryTimer = null;
let retryDelay = 0;
const RETRY_MIN = 3_000, RETRY_MAX = 60_000;

function scheduleRetry() {
  if (retryTimer) return;
  retryDelay = retryDelay ? Math.min(retryDelay * 2, RETRY_MAX) : RETRY_MIN;
  retryTimer = setTimeout(() => { retryTimer = null; pump(); }, retryDelay);
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.size) {
      const [rel, entry] = queue.entries().next().value;
      queue.delete(rel);
      // Les attentes sont SORTIES de l'entrée avant l'écriture : qu'elle
      // réussisse ou échoue, chacune est réglée exactement une fois, et une
      // entrée remise en file pour réessai ne les traîne pas une seconde fois.
      const attentes = entry.attentes;
      entry.attentes = [];
      setState('saving');
      try {
        await window.batApi.dataWrite(rel, enc.encode(entry.text).buffer, entry.base);
        // Confirmé par le serveur : le filet local n'a plus lieu d'être — SAUF
        // si une modification plus récente est déjà en file pour ce fichier,
        // auquel cas son propre miroir doit rester.
        if (!queue.has(rel)) unmirror(rel);
        for (const a of attentes) a.resolve();
      } catch (e) {
        // CONFLIT : quelqu'un d'autre a écrit ce fichier entre-temps. Ce n'est
        // pas une panne — réessayer ne servirait qu'à écraser son travail, ou
        // à boucler indéfiniment. On sort le fichier de la file, on GARDE la
        // copie locale (c'est le travail de l'utilisateur, il ne se perd pas)
        // et on remonte la question à l'interface.
        if (e?.conflit) {
          conflits.set(rel, { local: entry.text, serveur: e.serveur, base: entry.base });
          for (const a of attentes) a.reject(e);
          setState('conflit');
          for (const cb of surConflit) { try { cb(rel, e.serveur); } catch { /* un écouteur ne casse rien */ } }
          continue;   // les autres fichiers de la file, eux, doivent partir
        }
        // Hors-ligne ou serveur en erreur : la copie locale reste, on remet le
        // fichier en file et on rend la main.
        console.warn('Sauvegarde différée (' + rel + ') :', e?.message || e);
        if (!queue.has(rel)) queue.set(rel, entry);
        // L'échec REMONTE à qui attendait (« import interrompu ») ; la file, elle,
        // continue de réessayer en fond.
        for (const a of attentes) a.reject(e);
        setState('pending');
        scheduleRetry();
        return;
      }
    }
    // File vidée : le réseau est revenu, on repart d'un délai court.
    retryDelay = 0;
    // UN CONFLIT PRIME SUR « EN ATTENTE ». Le fichier en conflit garde sa copie
    // locale, donc il figure toujours dans `pendingPaths()` — et l'état
    // retombait sur « en attente », qui promet un envoi automatique. Or ce
    // fichier n'attend pas le réseau : il attend une réponse.
    setState(conflits.size ? 'conflit' : (pendingPaths().length ? 'pending' : 'saved'));
  } finally {
    pumping = false;
  }
  // UNE ÉCRITURE ARRIVÉE PENDANT LE DERNIER TOUR RESTERAIT COINCÉE. `saveJSON`
  // appelle `pump()`, qui retourne aussitôt si `pumping` est encore vrai : si
  // cela se produit entre la sortie de la boucle et la remise à zéro de
  // `pumping`, plus personne ne relance — le fichier attend indéfiniment
  // pendant que la barre affiche « Enregistré ». On revérifie donc APRÈS.
  if (queue.size) pump();
}

// Enregistre un objet JSON : miroir local immédiat puis écriture réseau
// sérialisée. Ne rejette jamais — une panne réseau ne doit pas remonter en
// « Erreur » dans l'interface, elle est signalée par l'état 'pending'.
export function saveJSON(rel, obj, base = null) {
  const text = JSON.stringify(obj, null, 1);
  mirror(rel, text);
  enfiler(rel, text, null, base);
  setState('saving');
  pump();
}

// Écriture attendue (import de catalogue, suppression…) : MÊME FILE, et c'est
// tout l'intérêt — on rend une promesse pour que l'appelant puisse enchaîner et
// voir l'échec, sans jamais court-circuiter la sérialisation.
// L'ancienne version écrivait EN DIRECT : si la file traitait déjà le même
// fichier, deux PUT partaient en parallèle et c'était l'ordre d'arrivée des
// réponses qui décidait du contenu final — exactement la course que ce module
// existe pour empêcher.
export function saveJSONNow(rel, obj) {
  const text = JSON.stringify(obj, null, 1);
  mirror(rel, text);
  return new Promise((resolve, reject) => {
    enfiler(rel, text, { resolve, reject });
    setState('saving');
    pump();
  });
}

// Oublie la copie locale non confirmée d'un fichier ET son écriture en attente.
// Sans cela, un projet modifié hors-ligne puis SUPPRIMÉ ressuscitait : le
// miroir survivait à la suppression, `resumePending()` le renvoyait au serveur
// au démarrage suivant, et le fichier revenait sur le disque.
export function forgetPending(rel) {
  queue.delete(rel);
  conflits.delete(rel);
  unmirror(rel);
}

// ------------------------------------------------- départ de la page
// Dernier recours avant que l'onglet ne parte : `keepalive` demande au
// navigateur de mener la requête à son terme MÊME si le document est détruit.
// Les JSON concernés font 1 à 3 Ko, très loin du plafond de 64 Ko imposé aux
// requêtes keepalive. On n'attend rien : le document ne sera plus là.
// Le miroir localStorage, lui, est déjà écrit — c'est la vraie garantie, ceci
// n'est que l'optimisation qui évite d'avoir à rejouer au redémarrage.
// Plafond imposé par les navigateurs à l'ensemble des requêtes `keepalive`.
// Au-delà, la requête est rejetée : inutile de la tenter, la copie
// localStorage a déjà fait le travail et la file la renverra au retour.
const KEEPALIVE_MAX = 60 * 1024;

export function flushOnUnload() {
  for (const [rel, entry] of queue) {
    if (entry.text.length > KEEPALIVE_MAX) continue;
    try {
      fetch(chemin('/api/data/') + rel.split('/').map(encodeURIComponent).join('/'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: enc.encode(entry.text),
        keepalive: true,
      }).catch(() => {});
    } catch { /* le document part : rien à rattraper ici */ }
  }
}

// Retour du réseau : on rejoue ce qui attend.
export function retryPending() {
  if (queue.size) pump();
}

// Démarrage : remet en file les modifications qu'une session précédente n'a
// jamais réussi à envoyer (onglet fermé hors-ligne, serveur en redéploiement).
// La file vit en mémoire — sans cette reprise, le miroir local servirait bien
// l'application au rechargement, mais le serveur ne serait jamais rattrapé et
// la copie de référence resterait en arrière indéfiniment.
export function resumePending() {
  let n = 0;
  for (const rel of pendingPaths()) {
    if (queue.has(rel)) continue;
    let text;
    try { text = localStorage.getItem(KEY(rel)); } catch { text = null; }
    if (!text) continue;
    enfiler(rel, text);
    n++;
  }
  if (n) { setState('saving'); pump(); }
  return n;
}

// `typeof … === 'function'` et non la seule présence de `window` : les tests du
// cœur (tests/run-tests.mjs) tournent sous Node avec un `window` réduit à
// `{ batApi }` pour importer les modules métier sans navigateur.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', retryPending);
  window.addEventListener('pagehide', flushOnUnload);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnUnload();
  });
}
