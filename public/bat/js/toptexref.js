// L'IMPORT PAR RÉFÉRENCE TOPTEX, SANS ÉCRAN.
//
// Ce fichier ne connaît ni modale ni bouton : il sait aller chercher une
// référence chez TopTex, comparer ce qui revient à ce que le catalogue a déjà,
// télécharger les packshots manquants et ranger le produit. Rien d'autre.
//
// Il vivait DANS l'écran Produits, mêlé à sa modale de confirmation. Depuis que
// le champ « Vêtement » du BAT sait importer une référence qu'il ne connaît
// pas, deux écrans en ont besoin — et un import qui existe en deux exemplaires
// finit par diverger sur le point qui compte : ne pas créer de doublon.
import { store, defaultCalibration, productByRef } from './store.js';
import { uid } from './util.js';
import { saveMockup } from './imgimport.js';
import { guessProductType, guessSizeCategory } from './producttype.js';
import { chemin } from './base.js';

export const colorSlug = (label, i) =>
  label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_') || ('c' + i);

// Ce que TopTex sait de cette référence. Lève avec le message du serveur : une
// référence inconnue doit se dire, pas se deviner.
export async function chercherReference(ref) {
  const r = await fetch(chemin('/api/toptex/product'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref }),
  });
  const norm = await r.json();
  if (!r.ok) throw new Error(norm.error || 'Import impossible');
  return norm;
}

// LE PLAN, COLORIS PAR COLORIS. Le produit est-il déjà au catalogue ? On
// compare vue par vue pour n'annoncer — et ne télécharger — que ce qui manque
// vraiment : récupérer deux nouveaux coloris ne doit pas reprendre les cent
// trente-six autres images.
export function planifierImport(norm) {
  const existing = productByRef(norm.ref);
  const plan = norm.colors.map((c, i) => {
    const slug = colorSlug(c.label, i);
    const old = existing?.colors.find((x) => x.slug === slug) || null;
    const views = Object.entries(c.views);
    return { c, slug, old, views, missing: old ? views.filter(([v]) => !old.views?.[v]) : views };
  });
  const nouveaux = plan.filter((p) => !p.old);
  const completes = plan.filter((p) => p.old && p.missing.length);
  return {
    existing, plan, nouveaux, completes,
    aJour: plan.length - nouveaux.length - completes.length,
    rienAFaire: !!existing && !nouveaux.length && !completes.length,
  };
}

// Le téléchargement et le rangement. `onProgress(faits, total)` est appelé à
// chaque image : c'est le seul lien avec un écran, et il est facultatif.
export async function executerImport({ norm, plan, existing, type, nom, toutReprendre = false, onProgress }) {
  // Compléter : on écrit DANS le produit existant — même id, donc mêmes
  // dossiers de mockups, mêmes projets, calibration et réf interne conservées.
  // Créer : produit neuf.
  const typeFinal = type || existing?.type || guessProductType(norm.name);
  const product = existing || {
    id: 'toptex-' + norm.ref.toLowerCase().replace(/[^a-z0-9]+/g, '') + '-' + uid(),
    name: nom || norm.name,
    // LA CATÉGORIE EST UN RAYON, PAS UNE MARQUE : c'est elle qui décide des
    // tailles (cf. tailles.js). La marque garde son champ.
    refInternal: '', refSupplier: norm.ref,
    category: guessSizeCategory(nom || norm.name) || 'AUTRE',
    brand: norm.brand || '',
    type: typeFinal,
    sleeveType: (typeFinal === 'Pochette' || typeFinal === 'Tote bag') ? 'none' : 'short',
    colors: [],
    calibration: {
      front: defaultCalibration(typeFinal, 'front'),
      back: defaultCalibration(typeFinal, 'back'),
      sleeve: defaultCalibration(typeFinal, 'sleeve'),
    },
  };
  const id = product.id;

  // Une tâche par image. Un produit comme le NS300 en compte 135 (46 coloris ×
  // 3 vues) : en séquentiel, à ~1 s l'image, l'import prenait plus de deux
  // minutes. On les mène de front, mais de façon BORNÉE — le CDN TopTex limite
  // le débit et 135 requêtes simultanées se feraient jeter.
  const cibles = new Map();
  const jobs = [];
  for (const p of plan) {
    const cible = p.old || { slug: p.slug, label: p.c.label, hex: p.c.hex, views: {} };
    cible.views ??= {};
    cibles.set(p.slug, cible);
    for (const [view, url] of (toutReprendre ? p.views : p.missing)) jobs.push({ color: cible, view, url });
  }

  let faits = 0, echecs = 0;
  const total = jobs.length;
  onProgress?.(faits, total);

  const traiter = async (job) => {
    // 3 tentatives, attente croissante : une image ratée ne doit pas amputer le
    // produit d'un coloris pour un simple à-coup réseau.
    for (let essai = 1; essai <= 3; essai++) {
      try {
        const rr = await fetch(chemin('/api/fetch-image?url=') + encodeURIComponent(job.url));
        if (!rr.ok) throw new Error('HTTP ' + rr.status);
        const ct = rr.headers.get('content-type') || '';
        const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
        job.color.views[job.view] = await saveMockup(id, job.color.slug, job.view, await rr.arrayBuffer(), ext);
        return;
      } catch {
        if (essai === 3) { echecs++; return; }   // vue indisponible → on saute, sans casser l'import
        await new Promise((r) => setTimeout(r, 400 * essai * essai));
      }
    }
  };

  const CONC = 6;
  const file = jobs.slice();
  await Promise.all([...Array(Math.min(CONC, file.length))].map(async () => {
    for (;;) {
      const job = file.shift();
      if (!job) return;
      await traiter(job);
      faits++;
      onProgress?.(faits, total);
    }
  }));

  // Un coloris dont aucune vue n'a pu être récupérée n'a rien à faire au
  // catalogue : il produirait un vêtement sans visuel dans le BAT. Les coloris
  // DÉJÀ présents restent, eux, en place quoi qu'il arrive — même ceux que
  // TopTex ne renvoie plus : des BAT passés s'y réfèrent.
  const neufs = [...cibles.values()].filter((c) => !product.colors.includes(c) && Object.keys(c.views).length > 0);
  product.colors.push(...neufs);
  if (!product.colors.length) throw new Error('Aucune image n\'a pu être téléchargée.');
  if (nom) product.name = nom;
  product.type = typeFinal;
  if (!existing) store.catalogue.products.push(product);
  await store.saveCatalogue();
  return { product, existing: !!existing, neufs, faits, echecs, total };
}

// TOUT D'UN COUP, SANS RIEN DEMANDER. C'est ce que le champ « Vêtement » du BAT
// appelle : on tape une référence, on clique, toutes les couleurs arrivent. Le
// type et le rayon sont déduits de la désignation — les deux seules questions
// que posait la modale, et les deux auxquelles le nom du produit répond déjà.
export async function importerReference(ref, { onProgress } = {}) {
  const norm = await chercherReference(ref);
  const { existing, plan } = planifierImport(norm);
  return executerImport({ norm, plan, existing, onProgress });
}
