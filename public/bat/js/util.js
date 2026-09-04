// Utilitaires généraux (aucune dépendance).

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const deg2rad = (d) => (d * Math.PI) / 180;

// Icônes lucide — SVG inline, héritent la couleur via currentColor, taillées
// par le CSS. Utilisées dans le « chrome » (barres d'outils, menus, listes).
// Tracé 2px (langage Material) : jamais d'emoji dans l'interface.
export const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
export const ICON_CHEVRON_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
export const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
export const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
// Silhouette de vêtement générique — repli d'une vignette produit sans photo.
export const ICON_GARMENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4 4 8l3 3 1-1v9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-9l1 1 3-3-4-4a3 3 0 0 1-6 0Z"/></svg>';
export const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
// Les trois points d'un menu d'actions. Une icône SEULE, donc posée dans un
// rond (cf. `.rond` — loi 5 : la forme dit le rôle).
export const ICON_MORE = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
export const ICON_DUPLICATE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="12" height="12" x="9" y="9" rx="2"/><path d="M5 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2"/></svg>';
// Engrenage « Réglages » — remplace l'emoji ⚙ de la barre supérieure.
export const ICON_SETTINGS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function frDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Nettoie un fragment pour le nom de fichier BAT.
export function fileSafe(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'X';
}

// Nom du fichier BAT : client, date du jour, modèle du vêtement — dans cet
// ordre, c'est ainsi que les BAT sont classés et retrouvés. La version n'est
// suffixée qu'à partir de la 2ᵉ : deux BAT du même jour pour le même client et
// le même modèle sont des révisions, ils ne doivent pas s'écraser dans
// l'historique du projet.
export function batFileName(client, dateISO, modele, version = 1) {
  const v = Number(version) > 1 ? `_v${version}` : '';
  return `${fileSafe(client)}_${dateISO}_${fileSafe(modele)}${v}.pdf`;
}

export function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(v, 16);
  if (Number.isNaN(n) || v.length !== 6) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Debounce avec `flush()` (exécute immédiatement l'appel en attente) et
// `cancel()`. `flush` sert à garantir la sauvegarde avant que la page ne parte
// (pagehide/visibilitychange) — voir BatPage.
export function debounce(fn, ms) {
  let t, lastArgs;
  const wrapped = (...args) => {
    lastArgs = args;
    clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...lastArgs); }, ms);
  };
  wrapped.flush = () => { if (t) { clearTimeout(t); t = null; return fn(...(lastArgs || [])); } };
  wrapped.cancel = () => { clearTimeout(t); t = null; };
  return wrapped;
}

// ---------------------------------------------------------------------------
// UN BAT ENVOYÉ NE SE FAIT JAMAIS ÉCRASER
// ---------------------------------------------------------------------------
// Le nom d'un BAT est « client_date_modèle_version ». La version ne bougeait
// qu'à la duplication : réexporter le même projet le même jour refabriquait le
// même nom, et le fichier déjà envoyé au client était réécrit.
// La règle du métier : une version = un BAT envoyé. Si la version courante a
// déjà produit un document, celui qu'on fabrique est le suivant.
export function prochaineVersion(project) {
  const v = project?.fiche?.version || 1;
  return (project?.history || []).some(h => h.version === v) ? v + 1 : v;
}

// Ceinture et bretelles : si un nom se répète malgré la version (historique
// vidé à la main, archive restaurée d'une sauvegarde), on suffixe plutôt que
// d'écraser. Aucun BAT déjà produit ne doit disparaître.
export function nomArchiveLibre(history, nom) {
  const pris = new Set((history || []).map(h => h.file));
  if (!pris.has(nom)) return nom;
  const point = nom.lastIndexOf('.');
  const base = point > 0 ? nom.slice(0, point) : nom;
  const ext = point > 0 ? nom.slice(point) : '';
  let n = 2;
  while (pris.has(`${base}-${n}${ext}`)) n++;
  return `${base}-${n}${ext}`;
}

export function bytesHuman(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' o';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' Ko';
  return (n / 1024 / 1024).toFixed(2) + ' Mo';
}

// Hash rapide (djb2) pour dédupliquer les fichiers logo importés.
export function hashBytes(bytes) {
  let h1 = 5381, h2 = 52711;
  const u8 = new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i++) {
    h1 = ((h1 * 33) ^ u8[i]) >>> 0;
    h2 = ((h2 * 31) ^ u8[i]) >>> 0;
  }
  return h1.toString(36) + h2.toString(36) + u8.length.toString(36);
}

// Applique {VARIABLES} d'un gabarit de texte.
export function fillTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{([A-Z_]+)\}/g, (m, k) => (vars[k] ?? m));
}

// Position (coin haut-gauche) d'une carte flottante ancrée à un rectangle
// (ex. la boîte englobante d'un logo), dans le même espace de coordonnées que
// `bounds`. Bascule à gauche si elle déborderait à droite ; sinon reste à
// droite. Toujours clampée verticalement pour rester entièrement dans
// `bounds` (pas de bascule haut/bas : la carte est verticalement centrée sur
// l'ancre par défaut, le clamp suffit à la garder visible).
export function anchorCardPosition(anchor, card, bounds, gap = 10) {
  const right = anchor.x + anchor.w + gap;
  const left = anchor.x - gap - card.w;
  const fitsRight = right + card.w <= bounds.x + bounds.w;
  const fitsLeft = left >= bounds.x;
  const x = fitsRight ? right : (fitsLeft ? left : clamp(anchor.x, bounds.x, bounds.x + bounds.w - card.w));
  const y = clamp(anchor.y + anchor.h / 2 - card.h / 2, bounds.y, bounds.y + bounds.h - card.h);
  return { x, y };
}

// ---------------------------------------------------------------------------
// CLASSEMENT PAR CLIENT
// ---------------------------------------------------------------------------
// L'index est rangé par date de modification — c'est son ordre de STOCKAGE, et
// il a ses raisons (le dernier touché en tête). Mais on ne cherche pas un
// projet par sa date : on le cherche par son CLIENT. La liste se regroupe donc
// par client, dans l'ordre alphabétique, et chaque groupe garde ses projets du
// plus récent au plus ancien.
//
// `localeCompare` en 'fr' avec `sensitivity: 'base'` : « Élan » se range à sa
// place entre « Dupont » et « Ferrand », et « ALOHA » ne part pas avant « Aloha
// Traiteur » pour une histoire de majuscules. Un tri sur les octets mettait les
// capitales en bloc devant tout le reste.
const compareClient = (a, b) =>
  String(a).localeCompare(String(b), 'fr', { sensitivity: 'base', numeric: true });

// UN CLIENT NE SE DÉDOUBLE PAS POUR UNE MAJUSCULE. « Élan » et « élan » sont le
// même dossier : on regroupe sur une clé pliée (accents retirés, minuscules,
// espaces resserrés) et on AFFICHE l'orthographe du projet le plus récent —
// c'est la dernière que la personne a voulue. Sans ce pliage, le même client
// apparaissait deux fois dans la liste, à deux endroits de l'alphabet.
const clefClient = (v) => String(v ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim().toLowerCase().replace(/\s+/g, ' ');

// Les projets sans client passent EN DERNIER, dans leur propre groupe : ce sont
// des brouillons, ils n'ont pas à s'intercaler entre deux vrais dossiers.
export function groupByClient(index) {
  const groupes = new Map();
  for (const e of index) {
    const cle = clefClient(e.client);
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(e);
  }
  for (const projets of groupes.values()) {
    projets.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }
  return [...groupes.entries()]
    .sort(([a], [b]) => (!a ? 1 : !b ? -1 : compareClient(a, b)))
    .map(([cle, projets]) => ({
      client: cle ? String(projets[0].client || '').trim() : '',
      projets,
    }));
}

// Vierge = rien saisi, rien posé. On le vérifie sur le projet CHARGÉ et pas sur
// l'index, qui ne porte ni les quantités ni les logos : un BAT sans client mais
// avec des quantités et trois logos serait passé pour vierge et se serait fait
// écraser.
export function isProjectBlank(p) {
  if (!p) return false;
  if (String(p.client || '').trim() || String(p.name || '').trim()) return false;
  for (const a of p.articles || []) {
    for (const s of a.sizes || []) if (String(s.quantite ?? '').trim()) return false;
    for (const f of Object.values(a.faces || {})) if ((f.logos || []).length) return false;
    if ((a.placements || []).length) return false;
  }
  return true;
}

// --------------------------------------------------------- la fiche du CRM
// Même contrainte que côté serveur : l'identifiant finit dans un CHEMIN. Ce qui
// ne la respecte pas est ignoré, jamais « corrigé » — deviner ce qu'un
// identifiant douteux voulait dire, c'est déposer dans la mauvaise fiche.
export function nettoyerId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : '';
}

// UNE FICHE, UN BAT. Quel projet de l'index porte la fiche `requestId` ?
//
// Répond sur l'index SEUL, qui est déjà en mémoire : c'est le tout premier
// geste au chargement quand le CRM nous monte sur une fiche, et ouvrir les
// projets un par un pour les reconnaître le mettrait sur le chemin critique.
//
// `aOuvrir` est la porte de sortie pour un index écrit par une version qui ne
// portait pas encore la fiche : seules les entrées SANS le champ peuvent
// encore cacher notre BAT — celles qui l'ont ont déjà répondu. Liste bornée :
// au pire on crée un BAT de plus, que l'index portera dès l'enregistrement.
export function batDeLaFiche(index, requestId, max = 5) {
  const id = nettoyerId(requestId);
  if (!id) return { id: null, aOuvrir: [] };
  const e = (index || []).find((x) => x && x.crmRequestId === id);
  if (e) return { id: e.id, aOuvrir: [] };
  return {
    id: null,
    aOuvrir: (index || []).filter((x) => x && x.crmRequestId === undefined).slice(0, max).map((x) => x.id),
  };
}
