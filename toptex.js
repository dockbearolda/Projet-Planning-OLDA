'use strict';

// CLIENT API TOPTEX — CÔTÉ SERVEUR UNIQUEMENT.
//
// Porté depuis bat-studio/server/toptex.mjs, déjà éprouvé sur l'autre app.
// Ce fichier vit à la racine, JAMAIS dans public/ : la clé et le mot de passe
// ne doivent en aucun cas partir au navigateur. Rien de ce module n'est servi
// au comptoir — la liste des coloris est figée dans le catalogue par
// scripts/refresh-toptex-couleurs.js, hors ligne (cf. CLAUDE.md : un poste
// s'ouvre sans dépendre d'un tiers joignable).
//
// Secrets lus dans l'environnement : TOPTEX_API_KEY / _USER / _PASSWORD.

const BASE = 'https://api.toptex.io/v3';

// L'API est instable en rafale : une même référence peut répondre 200 avec un
// contenu vide, puis complet 500 ms plus tard. On réessaie donc aussi sur une
// réponse vide, pas seulement sur une erreur HTTP.
const REGLAGES = {
  tentatives: 4,
  attenteMs: 500,        // doublée à chaque échec : 500, 1000, 2000
  ttlJetonMs: 55 * 60 * 1000,  // le jeton vaut ~1 h, on le renouvelle avant
  pauseRefMs: 250,       // rate limit par IP : les refs passent EN SÉQUENCE
};

let jeton = null;
let jetonPoseA = 0;

function identifiants() {
  const key = process.env.TOPTEX_API_KEY;
  const user = process.env.TOPTEX_API_USER;
  const pass = process.env.TOPTEX_API_PASSWORD;
  if (!key || !user || !pass) {
    throw new Error('Identifiants TopTex manquants (TOPTEX_API_KEY / _USER / _PASSWORD dans .env).');
  }
  return { key, user, pass };
}

function pause(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function authentifier() {
  const { key, user, pass } = identifiants();
  const r = await fetch(`${BASE}/authenticate`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) {
    throw new Error('Authentification TopTex refusée : ' + (j.errorMessage || j.message || r.status));
  }
  jeton = j.token;
  jetonPoseA = Date.now();
  return jeton;
}

async function jetonValide() {
  if (jeton && Date.now() - jetonPoseA < REGLAGES.ttlJetonMs) return jeton;
  return authentifier();
}

// Une réponse « vide » n'est pas la preuve que la référence n'existe pas :
// c'est le symptôme n°1 de l'API en rafale. On la traite comme un échec
// réessayable, et seule la DERNIÈRE tentative fait foi.
function reponseVide(raw) {
  const couleurs = Array.isArray(raw && raw.colors) ? raw.colors : [];
  if (!couleurs.length) return true;
  return couleurs.every((c) => !c || !c.packshots || !Object.keys(c.packshots).length);
}

// Réponse BRUTE de l'API pour une référence catalogue (les deux en-têtes sont
// obligatoires). Réessaie sur erreur réseau, 429, 5xx et réponse vide.
async function produitBrut(ref) {
  const { key } = identifiants();
  const url = `${BASE}/products?catalog_reference=${encodeURIComponent(ref)}&usage_right=b2b_b2c&language=fr`;
  let dernier = null;
  let attente = REGLAGES.attenteMs;

  for (let essai = 1; essai <= REGLAGES.tentatives; essai++) {
    if (essai > 1) { await pause(attente); attente *= 2; }
    try {
      let tk = await jetonValide();
      let r = await fetch(url, { headers: { 'x-api-key': key, 'x-toptex-authorization': tk } });
      if (r.status === 401) {          // jeton expiré → on réauthentifie une fois
        tk = await authentifier();
        r = await fetch(url, { headers: { 'x-api-key': key, 'x-toptex-authorization': tk } });
      }
      if (r.status === 400) throw new Error(`Référence « ${ref} » invalide ou paramètre refusé.`);
      if (r.status === 429 || r.status >= 500) { dernier = new Error('API TopTex : HTTP ' + r.status); continue; }
      if (!r.ok) throw new Error('API TopTex : HTTP ' + r.status);

      const raw = await r.json().catch(() => null);
      if (raw && !reponseVide(raw)) return raw;
      dernier = raw;                   // vide : on garde et on retente
    } catch (e) {
      if (/invalide ou paramètre refusé/.test(e.message)) throw e;
      dernier = e;                     // réseau / JSON : réessayable
    }
  }
  if (dernier instanceof Error) throw dernier;
  return dernier || { colors: [] };    // vide jusqu'au bout : l'appelant tranche
}

const VUES = { FACE: 'face', 'FACE CAP': 'face', BACK: 'dos', SIDE: 'cote' };

function vuePackshot(cle) {
  return VUES[String(cle || '').toUpperCase()] || null;
}

function hexPropre(h) {
  if (!h) return null;
  const s = String(h).trim();
  return s.startsWith('#') ? s : '#' + s;   // colorsHexa arrive SANS le « # »
}

// Forme exploitable d'une réponse brute. Fonction pure : testable sans réseau.
//
// `label` = colors.fr — le nom SPÉCIFIQUE du coloris (« Ash Heather »), stable
// et unique. On n'identifie JAMAIS une couleur par colorsDominant (famille
// générique « Bleu », pleine de doublons) : deux teintes distinctes y
// deviendraient indiscernables. La famille n'est gardée que pour information.
//
// `vues` porte les URLs de packshot. Elles embarquent un jeton en query et
// EXPIRENT : à consommer immédiatement (téléchargement de l'image), jamais à
// stocker en base ni dans un fichier.
function normaliserProduit(raw) {
  const src = raw || {};
  const nom = (src.designation && (src.designation.fr || src.designation.en)) || src.catalogReference || '';
  const couleurs = (Array.isArray(src.colors) ? src.colors : []).map((c) => {
    const vues = {};
    for (const [cle, v] of Object.entries((c && c.packshots) || {})) {
      const vue = vuePackshot(cle);
      if (vue && v && v.url) vues[vue] = v.url;
    }
    const dominante = (c && c.colorsDominant && c.colorsDominant[0]) || null;
    return {
      label: (c && c.colors && (c.colors.fr || c.colors.en)) || '',
      hex: hexPropre(c && c.colorsHexa && c.colorsHexa[0]),
      famille: (dominante && (dominante.fr || dominante.en)) || '',
      // « active » ou « discontinued_item » : un coloris arrêté reste dans la
      // réponse. On le garde ici pour ne rien perdre, mais getCouleurs l'écarte.
      etat: (c && c.saleState) || '',
      vues,
    };
  }).filter((c) => c.label);
  return {
    ref: src.catalogReference || '',
    nom,
    marque: src.brand || '',
    couleurs,
  };
}

// Produit normalisé pour une référence. Une référence inconnue ne lève PAS
// d'erreur côté TopTex : elle revient avec `couleurs: []` — c'est à l'appelant
// de tester la longueur.
async function getProduit(ref) {
  return normaliserProduit(await produitBrut(ref));
}

// Les coloris VENDABLES d'une référence, dédoublonnés, dans l'ordre TopTex.
// Un coloris arrêté (`discontinued_item`) est écarté : le comptoir ne doit pas
// proposer une teinte que le fournisseur ne livre plus.
async function getCouleurs(ref) {
  const { couleurs } = await getProduit(ref);
  const vus = new Set();
  return couleurs
    .filter((c) => c.etat !== 'discontinued_item')
    .filter((c) => !vus.has(c.label) && vus.add(c.label))
    .map(({ label, hex }) => ({ label, hex }));
}

module.exports = {
  REGLAGES, pause,
  authentifier, produitBrut, getProduit, getCouleurs,
  normaliserProduit, vuePackshot, hexPropre, reponseVide,
};
