'use strict';

// ===========================================================================
// BAT STUDIO, DANS LE CRM
// ---------------------------------------------------------------------------
// BAT Studio était une application à part : son serveur Express, son mot de
// passe, son disque, son domaine. Elle vit désormais ICI — un onglet de la
// barre, servi par le même processus, la même session et la même base.
//
// CE QUI A DISPARU EN ENTRANT, et pourquoi :
//
//   · SON MOT DE PASSE (`BAT_PASSWORD`, la page `/login`, le cookie signé).
//     Le CRM porte déjà son Basic Auth et ses comptes ; une seconde porte
//     devant la première, c'est une porte que personne ne ferme.
//   · SON DISQUE (`DATA_DIR`, le volume Railway, l'avertissement « données
//     éphémères »). Ses fichiers sont en base — voir `batLire` & co. dans
//     `db.js`. Le conteneur peut être effacé, la table reste.
//   · SON ALLER-RETOUR HTTP POUR DÉPOSER LE BAT (`CRM_URL`, `CRM_AUTH`, les
//     trente lignes de `crm.mjs`). Dans le même processus, c'est `deposerPdf`
//     appelée directement : plus de secret à tenir, plus de question d'origine,
//     plus de 502 quand le réseau tousse. Son propre commentaire l'annonçait :
//     « le jour où tout est dans le même processus, cette fonction devient un
//     appel direct ».
//   · SA SAUVEGARDE ZIP. Elle existait parce qu'un volume ne se sauvegarde pas
//     tout seul ; la base de Railway, si.
//   · SON THÈME. Celui du CRM, et il n'y en a qu'un (cf. `public/bat/css/phare.css`).
//
// CE QUI N'A PAS BOUGÉ : le front, ligne pour ligne. `webapi.js` continue de
// parler à `/api/data/*`, `js/base.js` déduit `/bat` de sa propre URL, et rien
// dans l'écran ne sait qu'il a changé de maison.
// ===========================================================================

const express = require('express');
const fs = require('node:fs');
const path = require('path');
const dns = require('node:dns/promises');
const net = require('node:net');

const { batLire, batEcrire, batSupprimer, batLister, batTailles, getTaillesLogo } = require('./db');

// ---------------------------------------------------------------------------
// Le proxy d'images — recopié tel quel de BAT Studio
// ---------------------------------------------------------------------------
// Garde-fous : n'autorise que http(s), refuse les cibles internes (SSRF),
// revalide CHAQUE redirection, plafonne la taille EN FLUX, et vérifie que la
// réponse est bien une image par ses octets d'en-tête (indépendant du
// Content-Type, certains CDN renvoyant application/force-download).
const MIME_IMAGE = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

function sniffImageType(b) {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  return null;
}

// Plages IP non routables publiquement : loopback, link-local (métadonnées
// cloud 169.254.169.254), RFC1918, CGNAT, ULA IPv6… Bloquer ces cibles empêche
// le proxy de servir d'oracle/relais SSRF vers le réseau interne.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;                 // link-local
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;     // 172.16/12
    if (p[0] === 192 && p[1] === 168) return true;                 // 192.168/16
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;    // CGNAT 100.64/10
    if (p[0] >= 224) return true;                                  // multicast/réservé
    return false;
  }
  const a = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (a === '::1' || a === '::') return true;
  if (a.startsWith('fe80')) return true;                           // link-local
  if (a.startsWith('fc') || a.startsWith('fd')) return true;       // ULA fc00::/7
  const m = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);              // IPv4-mapped
  if (m) return isPrivateIp(m[1]);
  return false;
}

async function exigerHotePublic(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Cible interne refusée');
    return;
  }
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); }
  catch { throw new Error('Hôte introuvable'); }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('Cible interne refusée');
}

// Lit le corps en coupant dès `maxOctets` (évite de bufferiser plusieurs Go en
// RAM avant le contrôle de taille : une taille annoncée peut mentir).
async function lirePlafonne(r, maxOctets) {
  const reader = r.body && r.body.getReader ? r.body.getReader() : null;
  if (!reader) {
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.byteLength > maxOctets) throw new Error('Image trop lourde');
    return b;
  }
  const morceaux = [];
  let recu = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    recu += value.byteLength;
    if (recu > maxOctets) { await reader.cancel(); throw new Error('Image trop lourde'); }
    morceaux.push(value);
  }
  const out = new Uint8Array(recu);
  let off = 0;
  for (const c of morceaux) { out.set(c, off); off += c.byteLength; }
  return out;
}

async function chercherImage(u, { maxOctets = 20 * 1024 * 1024, delaiMs = 15000, sauts = 4 } = {}) {
  let courant = u;
  for (let hop = 0; hop <= sauts; hop++) {
    let proto;
    try { proto = new URL(courant).protocol; } catch { throw new Error('URL non autorisée'); }
    if (proto !== 'http:' && proto !== 'https:') throw new Error('URL non autorisée');
    await exigerHotePublic(new URL(courant).hostname);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), delaiMs);
    try {
      // `redirect: 'manual'` → on revalide chaque saut contre les IP internes
      // (sinon une URL publique redirigeant vers 169.254.169.254 passerait).
      const r = await fetch(courant, { signal: ctrl.signal, redirect: 'manual' });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        courant = new URL(r.headers.get('location'), courant).toString();
        continue;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const cl = Number(r.headers.get('content-length'));
      if (cl && cl > maxOctets) throw new Error('Image trop lourde');
      const buf = await lirePlafonne(r, maxOctets);
      const genre = sniffImageType(buf);
      if (!genre) throw new Error('Pas une image');
      return { octets: Buffer.from(buf), type: MIME_IMAGE[genre] };
    } finally { clearTimeout(t); }
  }
  throw new Error('Trop de redirections');
}

// ---------------------------------------------------------------------------
// TopTex — le fournisseur
// ---------------------------------------------------------------------------
// Auth clé + login → jeton mis en cache, renouvelé sur 401. Les secrets sont
// lus dans l'environnement (`TOPTEX_API_KEY` / `_USER` / `_PASSWORD`) et ne
// descendent JAMAIS dans la page : c'est tout l'objet de ce détour serveur.
const TOPTEX_BASE = 'https://api.toptex.io/v3';
const TOPTEX_TTL = 30 * 60 * 1000;
let toptexJeton = null;
let toptexPose = 0;

function toptexIdentifiants() {
  const key = process.env.TOPTEX_API_KEY;
  const user = process.env.TOPTEX_API_USER;
  const pass = process.env.TOPTEX_API_PASSWORD;
  if (!key || !user || !pass) throw new Error('Identifiants TopTex manquants (TOPTEX_API_KEY/_USER/_PASSWORD).');
  return { key, user, pass };
}

async function toptexAuth() {
  const { key, user, pass } = toptexIdentifiants();
  const r = await fetch(`${TOPTEX_BASE}/authenticate`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new Error('Auth TopTex échouée : ' + (j.errorMessage || j.message || r.status));
  toptexJeton = j.token; toptexPose = Date.now();
  return toptexJeton;
}

// `producttype.js` est un module ES du NAVIGATEUR, et ce fichier-ci est en
// CommonJS. On le fait venir une seule fois, et c'est LE MÊME fichier que celui
// servi à la page : la normalisation d'un produit TopTex ne peut donc pas
// différer entre le serveur et l'écran — c'est tout l'intérêt.
//
// PAS UN `import()` DU CHEMIN, ET ÇA A ÉCHOUÉ AVANT D'ÊTRE ÉCRIT AINSI. Le
// `package.json` du CRM déclare `"type": "commonjs"` : Node lit alors TOUT
// fichier `.js` du dépôt comme un script classique, y compris celui-là, et
// répond « Unexpected token 'export' ». Le symptôme est trompeur — l'appel à
// TopTex a déjà réussi, c'est la mise en forme de sa réponse qui tombe.
//
// Trois sorties existaient. Recopier le fichier en `.mjs` : deux exemplaires
// qui divergent, exactement ce qu'on évite. Poser un `package.json`
// `{"type":"module"}` dans `public/bat/js/` : un fichier invisible dont rien
// ne peut expliquer la présence, JSON n'acceptant pas de commentaire. Reste
// celle-ci — on LIT la source et on l'importe telle quelle. `producttype.js`
// n'importe rien lui-même (vérifié), donc rien à résoudre autour.
let normaliserProduit = null;
async function chargerNormalisation() {
  if (!normaliserProduit) {
    const source = fs.readFileSync(path.join(__dirname, 'public', 'bat', 'js', 'producttype.js'), 'utf8');
    const mod = await import('data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64'));
    normaliserProduit = mod.normalizeToptexProduct;
  }
  return normaliserProduit;
}

async function toptexProduit(ref) {
  const { key } = toptexIdentifiants();
  const adresse = `${TOPTEX_BASE}/products?catalog_reference=${encodeURIComponent(ref)}&usage_right=b2b_b2c&language=fr`;
  let jeton = (toptexJeton && Date.now() - toptexPose < TOPTEX_TTL) ? toptexJeton : await toptexAuth();
  let r = await fetch(adresse, { headers: { 'x-api-key': key, 'x-toptex-authorization': jeton } });
  if (r.status === 401) {                       // jeton expiré → une seule réauth
    jeton = await toptexAuth();
    r = await fetch(adresse, { headers: { 'x-api-key': key, 'x-toptex-authorization': jeton } });
  }
  if (r.status === 400) throw new Error('Référence inconnue ou paramètre invalide.');
  // « API TopTex : HTTP 504 » n'apprenait rien à personne, et c'est la réponse
  // la PLUS COURANTE : mesuré le 04/09/2026, leur passerelle coupe à 29,5 s sur
  // les références à beaucoup de coloris (NS300, NS305, K3025), quand une
  // référence plus légère (BY190) répond en 10 s. Ce n'est ni la clé, ni le
  // réseau d'ici, ni la référence : c'est leur serveur qui n'a pas fini à temps.
  // Le dire évite de chercher la panne du mauvais côté.
  if (r.status === 502 || r.status === 503 || r.status === 504) {
    throw new Error('TopTex n\'a pas répondu à temps (' + r.status + '). Leur API coupe à 30 s sur les '
      + 'références à beaucoup de coloris — réessayer plus tard, ou saisir le produit à la main.');
  }
  if (!r.ok) throw new Error('API TopTex : HTTP ' + r.status);
  const normaliser = await chargerNormalisation();
  const norm = normaliser(await r.json());
  if (!norm.colors.length) throw new Error('Aucune couleur avec droits d\'affichage (b2b_b2c) pour cette référence.');
  return norm;
}

// ---------------------------------------------------------------------------
// La grille des tailles — CELLE DU CRM, ET PLUS CELLE D'UNE AUTRE APPLICATION
// ---------------------------------------------------------------------------
// BAT Studio recopiait ses tailles de l'app « Tailles Logo DTF »
// (taille-logo-app-production.up.railway.app), par un appel serveur avec cache
// de repli. DEUX RAISONS DE NE PLUS LE FAIRE, et la première suffit :
//
//   1. CETTE APPLICATION N'EXISTE PLUS. Vérifié le 04/09/2026 : Railway répond
//      « Application not found ». La grille ne se rafraîchissait donc plus
//      depuis un moment, et le BAT tournait sur un cache dont personne ne
//      savait l'âge.
//   2. LE CRM PORTE LA MÊME TABLE, écran compris (onglet « Tailles logos »,
//      `app_meta.tailles_logo`) : c'est là que l'atelier la tient à jour. Deux
//      sources pour une donnée, c'est celle qu'on ne met pas à jour qui décide.
//
// CE QU'ON Y GAGNE AU PASSAGE — LA FACE PAR SON NOM. L'ancienne grille ne
// connaissait que deux colonnes, « devant » et « dos ». Le CRM, lui, mesure
// SIX faces sur un textile : Coeur, Poitrine, Avant, Dos, Manche DR, Manche GA
// — et un Coeur fait 60 à 70 mm quand un Dos en fait 240 à 320. Les ramener à
// « devant » revenait à donner la même cote à deux marquages qui n'ont rien à
// voir. Or le BAT sait DÉJÀ sur quelle zone le logo est posé : `l.zoneName`,
// qui porte exactement ces noms-là. On sert donc les faces telles quelles, et
// c'est le nom qui apparie — aucune correspondance à deviner.
//
// Une face que le CRM ne mesure pas rend `null`, et le BAT retombe sur la
// largeur du logo posé : c'est le comportement d'avant, inchangé.
const CODE_RAYON = {
  HOMME: 'HOMME', FEMME: 'FEMME', ENFANT: 'ENFANT', BEBE: 'BEBE',
  // Le BAT devine un rayon depuis la désignation du produit (`guessSizeCategory`)
  // et il l'écrit au SINGULIER. La famille du CRM, elle, est au pluriel : sans
  // cette ligne, une pochette ne retrouvait jamais ses tailles par son nom.
  POCHETTES: 'POCHETTE', POCHETTE: 'POCHETTE',
};

// « Bébé » → « BEBE ». Le code sert de clé des deux côtés : il ne doit dépendre
// ni de la casse, ni des accents, ni du pluriel des cinq rayons connus.
function codeFamille(nom) {
  const brut = String(nom || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  return CODE_RAYON[brut] || brut;
}

// La table du CRM, dans la forme que `js/tailles.js` attend.
//   categories : le rayon → ses tailles (la série à laquelle un produit
//                incomplet a le droit de se compléter) ;
//   products   : une entrée par référence, ses tailles MESURÉES et, pour
//                chacune, la largeur de chaque face en millimètres.
function grilleDepuisCrm(table) {
  const categories = {};
  const products = [];
  for (const f of (table && table.familles) || []) {
    const code = codeFamille(f.nom);
    if (!code) continue;
    categories[code] = { label: f.nom, sizes: [...(f.tailles || [])] };

    // Les références MESURÉES : leurs tailles sont celles où au moins une face
    // porte une cote. Une référence dont la table ne connaît que « L » ne
    // propose donc que « L » en propre — et `findSizeReference` la complète
    // avec la série de son rayon, comme avant.
    for (const [reference, parFace] of Object.entries(f.refs || {})) {
      const sizes = [];
      for (const label of f.tailles || []) {
        const faces = {};
        for (const [face, parTaille] of Object.entries(parFace || {})) {
          const mm = parTaille && parTaille[label];
          if (Number.isFinite(mm) && mm > 0) faces[face] = mm;
        }
        if (Object.keys(faces).length) sizes.push({ label, faces });
      }
      products.push({ code: '', reference, category: code, sizes });
    }

    // Les références DÉCLARÉES à la main, sans aucune mesure : elles n'ont rien
    // à dire sur les largeurs, mais elles rattachent le produit à son rayon —
    // donc à ses tailles. Sans elles, un sac à dos repartait en XS…2XL.
    for (const reference of f.references || []) {
      if (f.refs && f.refs[reference]) continue;
      products.push({ code: '', reference, category: code, sizes: [] });
    }
  }
  return { source: 'crm', fetchedAt: new Date().toISOString(), categories, products };
}

// ---------------------------------------------------------------------------
// Le ménage des mockups — porté du disque à la base
// ---------------------------------------------------------------------------
// Chaque coloris importé écrit trois fichiers sous `mockups-custom/<produit>/`
// (plein, moyen, vignette). Rien ne les retire : ni la suppression d'un
// produit, ni le réimport d'une référence, qui écrit sous un nouveau nom de
// coloris et abandonne l'ancien. Mesuré chez BAT Studio sur les données
// réelles : 402 fichiers orphelins sur 438.
const MOCKUPS = 'mockups-custom';

// Tous les chemins d'image que le catalogue réclame, ramenés à la forme rangée
// en base (`<produit>/<coloris>_<vue><variante>.webp`).
function mockupsReclames(catalogue) {
  const set = new Set();
  for (const p of (catalogue && catalogue.products) || []) {
    for (const c of p.colors || []) {
      for (const v of Object.values(c.views || {})) {
        if (!v) continue;
        for (const cle of ['thumb', 'medium', 'full', 'src']) {
          const rel = v[cle];
          if (typeof rel === 'string' && rel) set.add(rel.replace(/^custom\//, ''));
        }
      }
    }
  }
  return set;
}

async function menageInventaire() {
  const tous = await batTailles(MOCKUPS);
  if (!tous.length) return { fichiers: 0, octets: 0, total: 0, totalOctets: 0, liste: [] };

  let catalogue = null;
  try {
    const brut = await batLire('catalogue.json');
    if (brut) catalogue = JSON.parse(brut.octets.toString('utf8'));
  } catch (_) { /* illisible : traité juste après */ }

  // GARDE-FOU. Un catalogue absent, illisible ou vide ferait passer TOUTES les
  // images pour orphelines — et le ménage effacerait le travail d'import de
  // plusieurs mois. Dans le doute, on ne propose rien.
  if (!catalogue || !Array.isArray(catalogue.products) || catalogue.products.length === 0) {
    return {
      fichiers: 0, octets: 0, total: tous.length, totalOctets: 0, liste: [],
      refus: 'Catalogue produit illisible ou vide : aucun ménage proposé (toutes les images passeraient pour inutilisées).',
    };
  }

  const utiles = mockupsReclames(catalogue);
  const orphelins = tous.filter((f) => !utiles.has(f.chemin));
  const poids = (l) => l.reduce((n, f) => n + f.octets, 0);
  return {
    fichiers: orphelins.length,
    octets: poids(orphelins),
    total: tous.length,
    totalOctets: poids(tous),
    liste: orphelins.map((f) => f.chemin),
  };
}

// Recalcule la liste au lieu de faire confiance à celle du client : entre
// l'inventaire et le clic, un import a pu réutiliser un fichier.
async function menageNettoyer() {
  const inv = await menageInventaire();
  if (inv.refus) return { supprimes: 0, octets: 0, refus: inv.refus };
  let supprimes = 0;
  for (const rel of inv.liste) {
    if (await batSupprimer(`${MOCKUPS}/${rel}`)) supprimes++;
  }
  // Pas de « dossier vide » à ranger derrière : en base, un dossier n'est qu'un
  // segment de chemin — il disparaît avec son dernier fichier.
  return { supprimes, octets: inv.octets };
}

// Un fichier est « lourd » s'il n'est pas WebP. C'est le seul critère sûr : un
// WebP produit par le pipeline est déjà borné à 1500 px, alors qu'un PNG ou un
// JPEG présent ici a forcément échappé au ré-encodage.
async function lourdsInventaire() {
  const tous = await batTailles(MOCKUPS);
  let octets = 0, totalOctets = 0;
  const liste = [];
  for (const f of tous) {
    totalOctets += f.octets;
    if (!/\.webp$/i.test(f.chemin)) { octets += f.octets; liste.push(f.chemin); }
  }
  return { fichiers: liste.length, octets, total: tous.length, totalOctets, liste };
}

// ---------------------------------------------------------------------------
// Les routes
// ---------------------------------------------------------------------------
const MIME = {
  '.pdf': 'application/pdf', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.svg': 'image/svg+xml',
};

// Le chemin demandé, tel qu'Express le laisse : décodé segment par segment.
// `decodeURIComponent` sur le tout laisserait passer un `%2F` déguisé en
// séparateur, et `batChemin` verrait un seul segment là où il y en a deux.
const relDepuis = (brut) => String(brut || '').split('/').map(decodeURIComponent).join('/');

/**
 * Monte BAT Studio sous `/bat`.
 * @param {import('express').Express} app
 * @param {{deposerPdf: Function, asyncH: Function, quiDemande: Function}} hote
 *        Ce que le CRM prête : le dépôt d'un PDF sur une fiche (la règle est
 *        chez lui, pas ici), son enveloppe d'erreurs async, et le nom du poste.
 */
function monterBat(app, { deposerPdf, asyncH, quiDemande }) {
  const r = express.Router();

  // --- ce que l'application demande d'elle-même -----------------------------
  r.get('/api/info', (_req, res) => {
    res.json({
      dataDir: '@data', appDir: '@app',
      examplesOut: null, version: '1.0.0', platform: 'web', sep: '/',
      build: process.env.RAILWAY_GIT_COMMIT_SHA || null,
      // Les deux avertissements de l'application autonome n'ont plus d'objet :
      // les données sont en base (rien d'éphémère) et l'accès passe par la
      // porte du CRM (jamais ouvert). On les laisse à `false` plutôt que de les
      // retirer : le front les lit, et un front inchangé est un front qu'on
      // peut resynchroniser avec son dépôt d'origine.
      donneesEphemeres: false,
      sansMotDePasse: false,
    });
  });

  // --- le magasin ----------------------------------------------------------
  r.get('/api/data/*', asyncH(async (req, res) => {
    let f;
    try { f = await batLire(relDepuis(req.params[0])); }
    catch (_) { return res.status(400).end(); }
    if (!f) return res.status(404).end();

    const ext = path.extname(req.params[0]).toLowerCase();
    if (MIME[ext]) res.type(MIME[ext]);
    // Défense en profondeur : bloque le sniffing MIME ; pour un SVG (logo
    // d'entreprise possible) ouvert en navigation directe, le CSP neutralise
    // tout script embarqué. L'affichage via <img> n'est pas affecté.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (ext === '.svg') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    if (req.query.dl) {
      const propre = path.basename(req.params[0]).replace(/["\\\r\n]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${propre}"`);
    }
    // L'EMPREINTE SUIT LA DATE DE MODIFICATION. `sendFile` donnait un 304 pour
    // un PDF ou un logo inchangé ; ici c'est `maj` qui joue ce rôle — sans quoi
    // chaque ouverture d'un projet re-téléchargerait tous ses mockups.
    const etag = `W/"b-${Date.parse(f.maj)}-${f.octets.length}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.send(f.octets);
  }));

  // ÉCRITURE CONDITIONNELLE. Deux postes qui ouvrent le même projet écrivaient
  // chacun leur version : le dernier arrivé gagnait, en silence, et le travail
  // de l'autre disparaissait sans que personne ne l'apprenne.
  //
  // Le client envoie dans `X-Bat-Base` l'`updatedAt` du fichier tel qu'il l'a
  // lu. S'il ne correspond plus à ce qui est en base, quelqu'un d'autre est
  // passé : on refuse (409) et on rend la version du serveur, pour que le
  // client puisse poser la question plutôt qu'écraser.
  // L'en-tête est FACULTATIF : sans lui, le dernier écrit gagne, comme avant.
  r.put('/api/data/*', express.raw({ type: () => true, limit: '80mb' }), asyncH(async (req, res) => {
    const rel = relDepuis(req.params[0]);
    const base = req.get('X-Bat-Base');
    try {
      if (base) {
        const actuel = await batLire(rel);
        if (actuel) {
          let horodatage = null;
          // `null` : fichier illisible ou sans horodatage — on ne bloque pas
          // sur une comparaison qu'on ne sait pas faire.
          try { horodatage = JSON.parse(actuel.octets.toString('utf8')).updatedAt; } catch (_) { /* pas un JSON daté */ }
          if (typeof horodatage === 'string' && horodatage !== base) {
            return res.status(409).type('application/json').send(actuel.octets);
          }
        }
      }
      await batEcrire(rel, req.body);
      res.json({ ok: true });
    } catch (e) {
      res.status(e.statut || 400).json({ error: e.message });
    }
  }));

  r.delete('/api/data/*', asyncH(async (req, res) => {
    try { await batSupprimer(relDepuis(req.params[0])); res.json({ ok: true }); }
    catch (e) { res.status(e.statut || 400).json({ error: e.message }); }
  }));

  r.get('/api/list/*', asyncH(async (req, res) => {
    try { res.json(await batLister(relDepuis(req.params[0] || ''))); }
    catch (_) { res.json([]); }
  }));

  // LE CATALOGUE DE MOCKUPS. Servi du même magasin que le reste — c'est de la
  // donnée de référence, pas du code, et elle n'a donc rien à faire dans le
  // dépôt. Cache long : ces images ne changent pas sous leur nom.
  r.get('/catalogue/*', asyncH(async (req, res) => {
    let f;
    try { f = await batLire(`catalogue/${relDepuis(req.params[0])}`); }
    catch (_) { return res.status(400).end(); }
    if (!f) return res.status(404).end();
    const ext = path.extname(req.params[0]).toLowerCase();
    if (MIME[ext]) res.type(MIME[ext]);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.send(f.octets);
  }));

  // --- le dépôt du BAT sur la fiche ---------------------------------------
  r.get('/api/crm', (_req, res) => {
    // Le CRM n'est plus « configuré » : il est là, c'est lui qui sert la page.
    res.json({ actif: true });
  });

  r.put('/api/crm/bat/:id', express.raw({ type: () => true, limit: '13mb' }), asyncH(async (req, res) => {
    const id = String(req.params.id || '').trim();
    // L'identifiant décide DANS QUELLE FICHE le BAT sera déposé : on ne devine
    // jamais ce qu'un identifiant douteux voulait dire.
    if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      return res.status(400).json({ error: 'Identifiant de fiche invalide.' });
    }
    const kind = req.query.kind || 'bat';
    const { statut, corps } = await deposerPdf({
      id, kind, buf: req.body, nom: req.query.name || 'bat.pdf', qui: quiDemande(req),
    });
    if (statut === 200) console.log(`BAT déposé dans la fiche ${id}.`);
    res.status(statut).json(corps);
  }));

  // --- entretien des images ------------------------------------------------
  r.get('/api/menage/mockups', asyncH(async (_req, res) => res.json(await menageInventaire())));

  // POST et pas DELETE : l'action porte sur un ENSEMBLE calculé par le serveur,
  // pas sur une ressource nommée par le client.
  r.post('/api/menage/mockups', asyncH(async (_req, res) => {
    const out = await menageNettoyer();
    if (out.supprimes) console.log(`Ménage BAT : ${out.supprimes} image(s) inutilisée(s) supprimée(s).`);
    res.json(out);
  }));

  // Lecture seule : le ré-encodage se fait dans le navigateur, seul endroit qui
  // sache décoder un PNG et écrire du WebP sans dépendance native de plus.
  r.get('/api/lourds/mockups', asyncH(async (_req, res) => {
    const inv = await lourdsInventaire();
    // La liste complète ne sert à rien au client — il rejoue le catalogue, pas
    // le magasin — et pèse pour rien sur la réponse.
    res.json({ ...inv, liste: undefined });
  }));

  // --- le monde extérieur --------------------------------------------------
  r.get('/api/fetch-image', asyncH(async (req, res) => {
    const u = req.query.url;
    if (!u || typeof u !== 'string') return res.status(400).json({ error: 'url manquante' });
    try {
      const { octets, type } = await chercherImage(u);
      res.type(type).send(octets);
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  }));

  r.post('/api/toptex/product', express.json(), asyncH(async (req, res) => {
    const ref = ((req.body && req.body.ref) || '').trim();
    if (!ref) return res.status(400).json({ error: 'Référence manquante.' });
    try { res.json(await toptexProduit(ref)); }
    catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  }));

  r.get('/api/tailles', asyncH(async (_req, res) => {
    // PAS DE CACHE, ET IL N'EN FAUT PLUS : ce n'est plus un appel réseau vers
    // une autre application, c'est UNE ligne d'`app_meta`. Le cache existait
    // pour survivre à une panne distante ; il ne servirait plus qu'à servir
    // des tailles périmées le lendemain d'une correction de l'atelier.
    const table = await getTaillesLogo();
    const grille = grilleDepuisCrm(table);
    // 404 quand la table est vide → le BAT garde ses tailles par défaut sans
    // afficher d'erreur. C'est le contrat d'avant, mot pour mot.
    if (!Object.keys(grille.categories).length) {
      return res.status(404).json({ error: 'aucune famille dans le tableau des tailles' });
    }
    res.set('Cache-Control', 'no-cache').json(grille);
  }));

  app.use('/bat', r);
}

module.exports = { monterBat, isPrivateIp, sniffImageType, grilleDepuisCrm, codeFamille, mockupsReclames };
