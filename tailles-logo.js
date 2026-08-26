'use strict';

// LE TABLEAU DES TAILLES DE LOGO — lu sur le site « Tailles Logo DTF ».
//
// L'atelier tient un second site (Projet-Taille-Logo) où chaque référence
// textile porte, POUR CHAQUE TAILLE DE VÊTEMENT, la largeur du logo à
// imprimer : un petit devant (55 à 80 mm) et un grand dos (200 à 340 mm). Ce
// n'est pas une constante par référence — sur NS300, le dos passe de 240 mm en
// XS à 320 mm en XL. C'est précisément ce que le site existe pour éviter de
// retenir de tête.
//
// Ses familles portent EXACTEMENT les noms des genres de saisie du comptoir
// (Homme / Femme / Enfant / Bébé), et ses références celles du catalogue
// textile : le rapprochement se fait sans table de correspondance.
//
// POURQUOI PAS FIGÉ DANS LE CATALOGUE, comme les coloris TopTex : le tableau
// se remplit AU FUR ET À MESURE, à la main, dès qu'une référence entre à
// l'atelier. Le figer obligerait à un commit et un déploiement à chaque
// nouvelle ligne. Il est donc rangé en base et se rafraîchit depuis les
// Réglages, en un clic.
//
// CE MODULE NE PARLE QU'AU SERVEUR. Le comptoir, lui, lit la copie rangée en
// base (`GET /api/tailles-logo`) : un poste doit s'ouvrir sans dépendre d'un
// tiers joignable (cf. CLAUDE.md).

const BASE_PAR_DEFAUT = 'https://taille-logo-app-production.up.railway.app';

function racine() {
  return String(process.env.TAILLE_LOGO_URL || BASE_PAR_DEFAUT).trim().replace(/\/+$/, '');
}

// Une case vide du tableau n'est pas un zéro : elle veut dire « pas encore
// mesuré ». Elle ne doit jamais descendre au comptoir comme une largeur de 0.
function largeur(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

async function lireJson(url, timeoutMs) {
  const r = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

// Rend { source, familles, refs, mesures } avec
//   familles = { "Homme": { "NS300": { "S": { avant: 60, dos: 260 } } } }
//
// Les catégories partent EN SÉQUENCE : elles sont cinq, et une rafale sur un
// service Railway qui vient de se réveiller coûte plus qu'elle ne rapporte.
async function lireTaillesLogo({ timeoutMs = 15000 } = {}) {
  const base = racine();
  const categories = await lireJson(`${base}/api/categories`, timeoutMs);
  if (!Array.isArray(categories)) throw new Error('Réponse inattendue : liste de familles attendue.');

  const familles = {};
  let mesures = 0;
  const refs = new Set();

  for (const cat of categories) {
    const code = String(cat && cat.code ? cat.code : '').trim();
    const famille = String((cat && (cat.label || cat.code)) || '').trim();
    if (!code || !famille) continue;

    const grille = await lireJson(`${base}/api/categories/${encodeURIComponent(code)}/grid`, timeoutMs);
    const tailleParId = {};
    for (const t of grille.sizes || []) tailleParId[String(t.id)] = String(t.label || '').trim();

    for (const p of grille.products || []) {
      // SANS RÉFÉRENCE, RIEN À RAPPROCHER. Le site autorise un produit
      // identifié par son seul code interne (H-012) : il vit pour l'atelier,
      // mais le comptoir ne le retrouvera jamais — on ne le descend pas.
      const ref = String((p && p.reference) || '').trim();
      if (!ref) continue;

      for (const [id, v] of Object.entries((p && p.measurements) || {})) {
        const taille = tailleParId[id];
        if (!taille || !v) continue;
        const avant = largeur(v.devant);
        const dos = largeur(v.dos);
        if (avant === null && dos === null) continue;

        if (!familles[famille]) familles[famille] = {};
        if (!familles[famille][ref]) familles[famille][ref] = {};
        // Deux lignes du site peuvent porter la même référence dans la même
        // famille (un doublon de saisie). On complète plutôt que d'écraser :
        // une case vide ne doit pas effacer une case remplie.
        const dessus = familles[famille][ref][taille] || {};
        familles[famille][ref][taille] = {
          avant: avant === null ? (dessus.avant ?? null) : avant,
          dos: dos === null ? (dessus.dos ?? null) : dos,
        };
        refs.add(ref);
        mesures++;
      }
    }
  }

  return { source: base, familles, refs: refs.size, mesures };
}

module.exports = { lireTaillesLogo, BASE_PAR_DEFAUT };
