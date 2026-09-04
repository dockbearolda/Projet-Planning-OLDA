// ===========================================================================
// RAMENER LES VIEUX MOCKUPS AU PIPELINE À TROIS TAILLES
// ---------------------------------------------------------------------------
// Le catalogue porte des vues importées AVANT `imgimport.js` : le packshot brut
// est stocké tel quel, et `full`, `medium`, `thumb` pointent tous les trois
// dessus. La vignette de 40 px du sélecteur tire alors le fichier entier —
// 2,6 Mo, 4,2 Mpx, ~17 Mo de mémoire pour peindre un carré de 40 px.
//
// Ce module rejoue ces vues dans `saveMockup`, qui est LE pipeline : même code,
// mêmes réglages, même convention de nommage que pour un import du jour. Rien
// n'est réécrit ici — c'est ce qui garantit qu'une image migrée est
// indiscernable d'une image importée aujourd'hui.
//
// SÛRETÉ. Le catalogue n'est enregistré qu'APRÈS l'écriture des nouveaux
// fichiers, et les anciens ne sont supprimés qu'APRÈS l'enregistrement du
// catalogue. Une interruption à n'importe quel moment laisse donc un catalogue
// cohérent : au pire des fichiers en trop, que le ménage (menage.mjs) sait
// retrouver — jamais une vue qui pointe dans le vide.
import { store } from './store.js';
import { saveMockup } from './imgimport.js';

// Une vue est à reprendre si son fichier `full` n'est pas un WebP — c'est-à-dire
// s'il a échappé au pipeline. Le cas « les trois déclinaisons sur le même
// fichier » est couvert : elles pointent alors toutes sur ce même non-WebP.
const AREPRENDRE = (v) => typeof v?.full === 'string' && !/\.webp$/i.test(v.full);

/**
 * Les vues du catalogue à reprendre. Pure, sans accès disque.
 * @returns {{productId:string, produit:string, slug:string, view:string, rel:string}[]}
 */
export function vuesAReprendre(catalogue) {
  const out = [];
  for (const p of catalogue?.products || []) {
    for (const c of p.colors || []) {
      for (const [view, v] of Object.entries(c.views || {})) {
        if (AREPRENDRE(v)) out.push({ productId: p.id, produit: p.name || p.id, slug: c.slug, view, rel: v.full });
      }
    }
  }
  return out;
}

// Extension portée par un chemin, pour dire à `saveMockup` ce qu'il décode.
const extDe = (rel) => (rel.split('.').pop() || 'png').toLowerCase();

/**
 * Reprend toutes les vues concernées.
 * @param {(n:number, total:number, quoi:string) => void} [avance]
 * @returns {Promise<{reprises:number, echecs:string[], anciens:number}>}
 */
export async function reprendreLesVues(avance) {
  const vues = vuesAReprendre(store.catalogue);
  const echecs = [];
  const aSupprimer = new Set();
  let reprises = 0;

  for (let i = 0; i < vues.length; i++) {
    const v = vues[i];
    avance?.(i, vues.length, `${v.produit} · ${v.slug} · ${v.view}`);
    try {
      const buf = await store.readCatalogueFile(v.rel);
      if (!buf) throw new Error('fichier introuvable');
      // `saveMockup` écrit les trois déclinaisons et purge les caches d'image
      // indexés sur les chemins réécrits.
      const views = await saveMockup(v.productId, v.slug, v.view, new Uint8Array(buf), extDe(v.rel));
      // Le produit est relu DANS le catalogue vivant : `vuesAReprendre` a rendu
      // une photographie, et `store.catalogue` peut avoir bougé entre-temps.
      const c = store.product(v.productId)?.colors?.find((x) => x.slug === v.slug);
      if (!c?.views?.[v.view]) throw new Error('vue disparue du catalogue');
      const anciens = new Set(Object.values(c.views[v.view]).filter((x) => typeof x === 'string'));
      c.views[v.view] = views;
      // Un ancien chemin réécrit à l'identique par le pipeline ne se supprime
      // évidemment pas : il EST le nouveau fichier.
      for (const a of anciens) if (!Object.values(views).includes(a)) aSupprimer.add(a);
      reprises++;
    } catch (e) {
      echecs.push(`${v.produit} · ${v.slug} · ${v.view} : ${e.message || e}`);
    }
  }

  // Le catalogue AVANT la suppression : tant qu'il n'est pas enregistré, les
  // anciens fichiers restent la seule vérité sur disque.
  if (reprises) await store.saveCatalogue();

  let anciens = 0;
  for (const rel of aSupprimer) {
    try { await store.deleteCatalogueFile(rel); anciens++; } catch { /* le ménage le reprendra */ }
  }

  avance?.(vues.length, vues.length, '');
  return { reprises, echecs, anciens };
}
