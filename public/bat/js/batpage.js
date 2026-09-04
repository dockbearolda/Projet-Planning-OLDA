// Écran « Bon À Tirer » : l'application EST le PDF.
// Chaque page A4 paysage est reproduite à l'échelle 1 pt = 1 px avec les
// mêmes constantes de mise en page que la génération (batlayout.js) ; tout
// s'édite directement sur la page (textes, tableaux, logos posés sur
// les visuels), et « Exporter le PDF » produit exactement ce qui est affiché.

import {
  store, FACES, FACE_ORDER, availableFaces, companyIdentityLine, companyMentionVars,
  facesByLogoId, articleCouleur, articleRef, productRef, migrateProject, newArticle, cloneArticle,
  projectFileName,
  manquesDuBat,
} from './store.js';
import { faceVisual, isOnGarment } from './mockup.js';
import {
  LOGO_EXTENSIONS, normalizeLogoFile, analyzeLogo, logoNaturalSize,
  renderLogoToCanvas, renderPdfLogoToCanvas, recolorLogo,
} from './logoasset.js';
import { flushOnUnload } from './persist.js';
import { toast, openModal, confirmModal, confirmListe, el, PALETTE } from './ui.js';
import {
  esc, uid, clamp, deg2rad, hashBytes, debounce, frDate, todayISO,
  bytesHuman, fillTemplate, anchorCardPosition, prochaineVersion, nomArchiveLibre,
  ICON_PLUS, ICON_DUPLICATE, ICON_X,
} from './util.js';
import { mountProductPicker, mountColorPicker, mountFacePicker } from './garmentpicker.js';
import { productSizeLabels, productHasSizes, applySizeLabels, sizesAreSynced, printWidthCm,
  sizeChoices, setSizeQuantity, totalQuantity, unorderedSizes, keepOrderedSizes, sizeReference,
  servedSizes } from './tailles.js';
import {
  PW, PH, M, VX, VW, V_BOTTOM,
  grid,
  TBL_FONT,
  META_COLS,
  HEX, facePages, faceLayout,
} from './batlayout.js';
import { app } from './app.js';
import { oldaSvgMarkup } from './brand.js';
import { deposerDansCrm, crmActif } from './crm.js';

const HANDLE = 9;   // taille poignée (px écran)
const SNAP = 6;     // seuil magnétisme (px écran)
// Zoom de la feuille. Poser un logo ne suffit pas à le juger : on veut y coller
// le nez pour vérifier un contour, un empattement, la netteté d'un tracé de
// 3 cm. Le zoom porte sur la FEUILLE, pas sur le logo — sur un BAT la cote en
// centimètres fait foi, agrandir le logo lui-même reste le geste des poignées
// de coin. 3× = ~4 px écran par mm imprimé, la limite utile de l'inspection.
const ZOOM_MIN = 0.4, ZOOM_MAX = 3;
const ZOOM_STEPS = [0.4, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];
// Écran tactile : poignées plus grosses et rayon de capture ≥ 44px de diamètre
// (les poignées sont dessinées au canvas, hors de portée des règles CSS).
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const fmt1 = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');
// Cotes du tableau de production : stockées en cm (fiche.placements[].dims,
// partagées avec le calcul auto-logo), affichées en mm entiers (« Cotes =
// largeur d'impression par taille (mm) »). Conversion purement d'affichage —
// rien d'autre dans l'app ne lit dims en mm.
const cmToMm = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? String(Math.round(n * 10)) : ''; };
const mmToCm = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? fmt1(n / 10) : ''; };

// Réduit le corps d'une case du bandeau d'identité jusqu'à ce que sa valeur
// tienne — exactement ce que fait fitValue() dans le PDF (batpdf.js), plancher
// compris (1 pt = 1 px sur cette page). Une couleur de fournisseur (« Washed
// Dream Blue ») dépasse sa colonne : la rogner afficherait à l'écran autre
// chose que ce que le PDF imprime.
const META_SIZE = 9, META_SIZE_MIN = 6.4;
function fitMetaValue(input) {
  input.style.fontSize = '';
  let s = META_SIZE;
  // Borne dure : le pas est de 0,25 px, la descente ne peut pas dépasser
  // (9 − 6,4) / 0,25 ≈ 11 tours, mais on ne dépend pas de l'arithmétique
  // flottante pour sortir d'une boucle qui force une mesure de mise en page.
  for (let i = 0; i < 12 && input.scrollWidth > input.clientWidth && s > META_SIZE_MIN; i++) {
    s = Math.max(META_SIZE_MIN, s - 0.25);
    input.style.fontSize = s + 'px';
  }
}

// Cote automatique d'une colonne pour une taille donnée. `auto.dims` (une cote
// par taille, depuis la grille produit) n'existe que depuis cette grille : les
// projets antérieurs n'ont que `auto.dim`, valable pour toutes les tailles.
const autoDim = (auto, sizeId) => auto?.dims?.[sizeId] ?? auto?.dim;

// Quantité totale commandée d'un article (somme des Qté de sa grille) —
// affichée sur son onglet, comme le total de la ligne « Total » de la page.
export function articleQty(article) {
  let sum = 0;
  for (const s of article.sizes || []) {
    const n = parseFloat(String(s.quantite ?? '').replace(',', '.'));
    if (Number.isFinite(n)) sum += n;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Grille fusionnée « commande + marquage » d'UN article. Lignes = tailles
// (article.sizes, { id, taille, quantite }). Colonnes = un emplacement par logo
// posé (article.placements, { id, logoId, name, color, dims:{sizeId:'largeur cm'}, auto }).
// Chaque colonne est pré-remplie automatiquement depuis le logo (nom = zone,
// couleur) ; les cellules modifiées à la main sont conservées, les autres
// suivent l'automatique.
// La COTE, elle, vient de l'app « Tailles Logo DTF » : la largeur d'impression
// prévue pour ce produit, cette face et cette taille — elle grandit donc avec
// la taille (H-001 au dos : 240 mm en XS → 320 mm en XL). À défaut (produit ou
// face absents de la grille, valeur non renseignée), on retombe sur la largeur
// du logo posé, identique sur toutes les tailles.
// ---------------------------------------------------------------------------
export function syncGrid(article) {
  const f = article;
  const product = store.product(article.productId);
  const sizes = f.sizes ??= [];
  if (!sizes.length) sizes.push({ id: uid(), taille: '', quantite: '' });
  const prev = f.placements || [];
  const byLogo = new Map(prev.filter(p => p.logoId).map(p => [p.logoId, p]));
  const detached = prev.filter(p => !p.logoId);
  const next = [];
  const seen = new Set();

  // 1re passe : logos inclus, dans l'ordre d'affichage, avec leur nom de base
  // (« Placement libre » par défaut, ou un nom saisi à la main dans le tableau).
  // Sert à repérer les noms qui se répètent (plusieurs emplacements libres) pour
  // les numéroter avant de construire les colonnes.
  const ordered = [];
  const baseCount = new Map();
  for (const faceKey of FACE_ORDER) {
    const face = article.faces[faceKey];
    if (!face?.included) continue;
    for (const l of face.logos) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      const base = l.zoneName || 'Placement libre';
      ordered.push({ l, base });
      baseCount.set(base, (baseCount.get(base) || 0) + 1);
    }
  }

  // 2e passe : construit les colonnes. Un nom partagé par plusieurs logos est
  // suffixé par un numéro d'ordre (« Manche droite 1 », « Manche droite 2 »…) ;
  // un nom unique reste tel quel (pas de « 1 » superflu).
  const idxByBase = new Map();
  for (const { l, base } of ordered) {
    let name = base;
    if (baseCount.get(base) > 1) {
      const n = (idxByBase.get(base) || 0) + 1;
      idxByBase.set(base, n);
      name = `${base} ${n}`;
    }
    // Repli quand la grille produit ne dit rien : la largeur du logo posé
    // (largeur seule, en cm ; la hauteur suit les proportions du logo).
    const fallback = fmt1(l.widthCm);
    const dims = {};
    for (const s of sizes) {
      // `base` EST LE NOM DE LA ZONE (« Coeur », « Dos »…), pas la face : c'est
      // lui que le tableau des tailles du CRM mesure. `faceKey` ne distinguait
      // pas un Coeur d'une Poitrine, qui n'ont pourtant pas la même cote.
      const cm = printWidthCm(product, base, s.taille);
      dims[s.id] = cm === null ? fallback : fmt1(cm);
    }
    const auto = {
      name,
      color: l.color ? l.color.toUpperCase()
        : (l.monochrome ? (l.colors?.[0] || '').toUpperCase() : 'Quadri'),
      dim: fallback,   // cote de repli, et référence des projets d'avant la grille
      dims,            // cote automatique par taille
    };
    let p = byLogo.get(l.id);
    if (!p) {
      p = { id: uid(), logoId: l.id, name: auto.name, color: auto.color, dims: { ...dims }, auto: { ...auto } };
    } else {
      const old = p.auto || {};
      p.dims ??= {};
      if ((p.name ?? '') === (old.name ?? '')) p.name = auto.name;
      if ((p.color ?? '') === (old.color ?? '')) p.color = auto.color;
      for (const s of sizes) {
        // `old.dim` en second : les projets antérieurs à la grille n'ont qu'une
        // cote automatique unique — sans ce repli, leurs cellules passeraient
        // pour des saisies manuelles et ne suivraient jamais la grille.
        if (p.dims[s.id] === undefined || p.dims[s.id] === autoDim(old, s.id)) p.dims[s.id] = dims[s.id];
      }
      p.auto = { ...auto };
    }
    next.push(p);
  }

  // Emplacements édités à la main mais dont le logo a disparu → conservés
  // (détachés) ; les colonnes purement automatiques disparaissent avec le logo.
  const keepDetached = (p) => {
    const old = p.auto || {};
    const manual = ((p.name ?? '') !== (old.name ?? '')) || ((p.color ?? '') !== (old.color ?? ''))
      || Object.entries(p.dims || {}).some(([sizeId, v]) => v && v !== autoDim(old, sizeId));
    return manual;
  };
  for (const p of detached) if (p.name || p.color || Object.values(p.dims || {}).some(v => v)) next.push(p);
  for (const [logoId, p] of byLogo) {
    if (seen.has(logoId)) continue;
    if (keepDetached(p)) { p.logoId = null; delete p.auto; next.push(p); }
  }

  // Purge les dimensions rattachées à une taille supprimée.
  const sizeIds = new Set(sizes.map(s => s.id));
  for (const p of next) for (const k of Object.keys(p.dims || {})) if (!sizeIds.has(k)) delete p.dims[k];
  f.placements = next;
}

// Anciens projets → grille fusionnée. On normalise d'abord les formats legacy
// (orderRows/markRows, puis order/rows séparés) vers order+rows, puis on convertit
// order → sizes (avec id stable) et rows → placements (un logo = une colonne).
// Ces formats vivaient dans `fiche` ; migrateProject (store.js) les a déplacés
// tels quels sur l'article, seul porteur de grille désormais.
function migrateGrid(article) {
  const f = article;
  if (Array.isArray(f.sizes)) return;   // déjà au format grille

  // 1) legacy orderRows/markRows → order/rows
  if (!f.rows && (f.orderRows || f.markRows)) {
    const ord = f.orderRows || [], mrk = f.markRows || [];
    f.rows = [];
    for (let i = 0; i < Math.max(ord.length, mrk.length); i++) {
      const o = ord[i] || {}, m = mrk[i] || {};
      f.rows.push({
        logoId: m.logoId || null, taille: o.taille || '', quantite: o.quantite || '',
        face: m.face || '', zone: m.zone || '', dims: m.dims || '', couleurMq: m.couleur || '',
      });
    }
    delete f.orderRows; delete f.markRows; delete f.markRowsOverride;
  }
  // 2) format « fusionné » (taille/qté dans rows) → order séparé
  const rows = Array.isArray(f.rows) ? f.rows : [];
  let order = Array.isArray(f.order) ? f.order : null;
  if (!order) {
    order = rows
      .filter(r => (r.taille ?? '') !== '' || (r.quantite ?? '') !== '')
      .map(r => ({ taille: r.taille || '', quantite: r.quantite || '' }));
  }

  // 3) order → sizes (id stable), rows → placements (dims répliquées sur chaque taille)
  const sizes = (order.length ? order : [{ taille: '', quantite: '' }])
    .map(o => ({ id: uid(), taille: o.taille || '', quantite: o.quantite || '' }));
  const placements = [];
  for (const r of rows) {
    if (!r.logoId && !r.zone && !r.face && !r.dims && !r.couleurMq) continue;
    const name = r.zone || r.face || 'Placement libre';
    const dim = r.dims || '';
    const dims = {};
    for (const s of sizes) dims[s.id] = dim;
    placements.push({
      id: uid(), logoId: r.logoId || null, name, color: r.couleurMq || '', dims,
      auto: { name: r.auto?.zone || name, color: r.auto?.couleurMq || (r.couleurMq || ''), dim: r.auto?.dims || dim },
    });
  }
  f.sizes = sizes;
  f.placements = placements;
  delete f.order; delete f.rows;
}

// Passage « largeur seule » : les dimensions de logo ne portent plus que la
// largeur (cm). Nettoie les données de l'ancienne grille « L × H » → largeur.
function migrateWidthOnly(article) {
  const wOnly = (v) => String(v ?? '').split('×')[0].trim();
  for (const p of article.placements || []) {
    if (p.dims) for (const k of Object.keys(p.dims)) p.dims[k] = wOnly(p.dims[k]);
    if (p.auto) p.auto.dim = wOnly(p.auto.dim);
  }
}

// LA COLONNE DES INTITULÉS DE TAILLE SE MESURE, ELLE NE SE DEVINE PAS.
// « 2XL » tient dans 48 px ; « 10/12 ans » en demande 78 et « 36 mois » 66.
// Une largeur fixe coupait les uns (« 10/1… », et on ne sait plus quelle taille
// on remplit) ou gaspillait la rangée pour les autres. Elle est donc calculée
// à chaque changement de SÉRIE — jamais à la frappe : la rangée ne bouge pas
// pendant qu'on la remplit.
// TOUTES les cases prennent la MÊME largeur, celle du plus long intitulé de la
// série : des cases inégales feraient des marches là où l'œil suit une ligne.
let _mesureur;
function largeurTexte(txt, police) {
  _mesureur ??= document.createElement('canvas').getContext('2d');
  _mesureur.font = police;
  return _mesureur.measureText(txt).width;
}

function ajusterColonneIntitules(cont, labels) {
  const premier = cont.querySelector('.bat-qty-lb');
  if (!premier) return;
  const cs = getComputedStyle(premier);
  // `font` en raccourci n'est pas renseigné par tous les moteurs : on le
  // recompose. Une police pas encore chargée donne une mesure de la police de
  // repli — plus large, donc jamais coupée : l'erreur est du bon côté.
  const police = cs.font || `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const large = labels.reduce((m, l) => Math.max(m, largeurTexte(String(l || ''), police)), 0);
  cont.style.setProperty('--qty-lb', Math.ceil(large) + 'px');
}

// ---------------------------------------------------------------------------
// Écran
// ---------------------------------------------------------------------------
export class BatPage {
  constructor(host) {
    this.host = host;
    this.project = null;
    this.article = null;           // article (onglet) ouvert
    this.product = null;           // vêtement de l'article ouvert
    this.visuals = {};             // articleId|faceKey → {canvas,width,height,pxPerCm,kind}
    this.logoCanvases = new Map(); // hash|couleur → canvas aperçu
    this.logoBytes = new Map();    // hash → Uint8Array
    this.sel = null;               // { faceKey, id } logo sélectionné
    this.activeFace = 'front';
    this.zoom = null;              // null = ajuster à la largeur
    this.hist = { undo: [], redo: [] };
    this.faceViews = [];           // instances FaceView des pages affichées
    this.autosave = debounce(() => store.saveProject(this.project), 700);
    this._onKey = (e) => this.onKey(e);
    window.addEventListener('keydown', this._onKey);
    // Anti-perte de données : force la sauvegarde en attente avant que la page
    // ne parte (fermeture d'onglet, bascule d'app sur mobile). L'autosave est
    // debouncé (700 ms) ; sans ce flush, la dernière modif serait perdue.
    // `flushOnUnload()` est rappelé ICI, juste après, et non laissé à l'écouteur
    // de persist.js : celui-ci est enregistré au chargement du module (donc
    // AVANT celui-ci, batpage étant importé à la demande) et s'exécuterait
    // avant que le flush n'ait mis quoi que ce soit en file.
    const leave = () => { this.autosave.flush(); flushOnUnload(); };
    this._onHide = leave;
    this._onVis = () => { if (document.visibilityState === 'hidden') leave(); };
    window.addEventListener('pagehide', this._onHide);
    document.addEventListener('visibilitychange', this._onVis);
  }

  destroy() {
    this.autosave.flush();
    // Re-rendu de zoom en attente : il travaillerait sur un DOM déjà détaché.
    this._zoomSettle?.cancel();
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('pagehide', this._onHide);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._logoUrlIsBlob && this._logoUrl) URL.revokeObjectURL(this._logoUrl);
    this.ro?.disconnect();
    this.host.innerHTML = '';
  }

  includedFaces() { return FACE_ORDER.filter(k => this.article.faces[k]?.included); }
  selected() {
    if (!this.sel) return null;
    return this.article.faces[this.sel.faceKey]?.logos.find(l => l.id === this.sel.id) || null;
  }
  // Visuels mis en cache par ARTICLE : deux onglets peuvent porter le même
  // vêtement dans deux couleurs — la clé doit distinguer les deux.
  visual(faceKey, article = this.article) { return this.visuals[article.id + '|' + faceKey]; }

  // Prépare l'article ouvert (onglet courant) : vêtement, faces réellement
  // disponibles, grille. Revalider les faces incluses est indispensable — une
  // face devenue indisponible (produit/couleur sans ce visuel) resterait cochée
  // mais absente du PDF, créant un tableau de marquages incohérent avec les
  // visuels affichés.
  // Un vêtement disparu du catalogue (ré-import entre deux ouvertures) ne
  // condamne pas l'onglet : aucune face disponible, page vide, et le sélecteur
  // de la barre du haut permet d'en choisir un autre. Renoncer ici laissait
  // l'article ouvert sans vêtement chargé — le rendu suivant (redimensionnement
  // de la fenêtre, « + ligne ») plantait alors sur product.colors.
  prepareArticle() {
    const a = this.article;
    // Articles legacy : garantir toutes les clés de face (une clé manquante
    // faisait planter changeGarment/renderFaces au rendu).
    for (const k of FACE_ORDER) a.faces[k] ??= { included: false, logos: [] };
    this.product = store.product(a.productId);
    if (!this.product) toast('Produit de l’article introuvable dans le catalogue — choisissez-en un autre.', { error: true, ms: 6000 });
    this.available = this.product ? availableFaces(this.product, a.colorSlug) : [];
    let anyIncluded = false;
    for (const k of FACE_ORDER) {
      if (!this.available.includes(k)) a.faces[k].included = false;
      if (a.faces[k].included) anyIncluded = true;
    }
    if (!anyIncluded && this.available.includes('front')) a.faces.front.included = true;
    if (!this.available.includes(this.activeFace)) this.activeFace = this.available[0] || 'front';
    migrateGrid(a);
    migrateWidthOnly(a);
    syncGrid(a);
  }

  // ------------------------------------------------------------------ setup
  async load(project) {
    this.project = migrateProject(project);
    this.article = project.articles[0];
    this.prepareArticle();

    // UNE seule carte « éditeur » regroupe tout ce qui pilote l'article : les
    // onglets (quel article), puis — sous un filet — ses réglages (vêtement,
    // couleur, faces) et l'export. Une action = un endroit, rien à rouvrir.
    // Elle vit EN BANDEAU, en haut, sur toute la largeur. Le rail gauche rendait
    // sa hauteur à la feuille mais rangeait l'article dans 320 px : une paire
    // intitulé/champ par ligne, et les quantités hors de vue dès six tailles.
    // En haut, les cinq blocs (fiche, vêtement, faces, quantités, impression)
    // se posent côte à côte et se lisent d'un seul coup d'œil.
    // Le DOM ci-dessous ne connaît pas la largeur de l'écran : sous 900 px, les
    // blocs se remettent simplement à la ligne (cf. CSS).
    this.host.replaceChildren(el(`
      <div class="bat-layout">
        <div class="bat-editor">
          <div class="bat-tabs" id="bat-tabs" role="tablist" aria-label="Articles du projet"></div>
          <div class="bat-toolbar">
            <!-- CE QUI S'IMPRIME EN TÊTE DE FEUILLE SE SAISIT ICI. Ces trois
                 champs vivaient DANS le bandeau du A4 : des cases de 10 px de
                 haut, sous la barre des 44 px que ce projet s'impose, et
                 introuvables à la souris comme au doigt. La feuille redevient
                 ce qu'elle doit être — un aperçu — et la saisie se fait là où
                 se fait déjà tout le reste. -->
            <!-- UNE SEULE GRILLE POUR TOUTE LA BARRE, et cinq paires
                 « intitulé · champ » de largeur identique. Chaque bloc a eu sa
                 propre grille pendant un temps : cinq jeux de colonnes, cinq
                 largeurs de champ, et « Faces » sous aucun intitulé. Rien
                 n'était droit, parce que rien ne PARTAGEAIT de verticale.
                 Les groupes ci-dessous s'effacent (display: contents, cf. CSS) :
                 ils cessent d'être des boîtes et laissent leurs intitulés et
                 leurs champs se poser dans la grille du parent. Il n'y a plus
                 qu'un jeu de colonnes ; il ne peut plus y en avoir deux qui
                 divergent. -->
            <div class="bat-champs" id="bat-fiche"></div>
            <div class="bat-champs" id="bat-vetement">
              <label class="bat-champ"><span class="bat-champ-lb">Vêtement</span>
                <div class="gp-combo bat-champ-in" id="bat-product"></div>
              </label>
              <label class="bat-champ"><span class="bat-champ-lb">Couleur</span>
                <div class="gp-combo bat-champ-in" id="bat-color"></div>
              </label>
              <!-- LES FACES SONT UN CHAMP comme les deux précédents : un bouton
                   qui dit « Cœur + dos », un menu où l'on coche. Elles vivent
                   dans le même groupe parce qu'elles parlent du même objet —
                   le vêtement de cet article. -->
              <label class="bat-champ"><span class="bat-champ-lb">Faces</span>
                <div class="gp-combo bat-champ-in" id="bat-faces"></div>
              </label>
            </div>
            <!-- LES QUANTITÉS PRENNENT LA RANGÉE SUIVANTE, ENTIÈRE. L'intitulé
                 se pose dans la colonne des intitulés — même verticale que
                 « Client » et « Vêtement » — et la série occupe tout ce qui
                 reste, sa première case exactement sous le premier champ. -->
            <span class="bat-champ-lb" id="bat-sizes-label">Quantités</span>
            <div class="bat-qty-zone">
              <div class="bat-qty" id="bat-sizes" role="group" aria-labelledby="bat-sizes-label"></div>
              <span class="bat-qty-total" id="bat-qty-total"></span>
              <div class="bat-outils" id="bat-sizes-outils"></div>
            </div>
          </div>
          <!-- LE PIED. Ce qui TERMINE le travail se tient à part, au bout du
               bandeau : « Exporter le PDF » est la seule action terminale de
               l'application, elle ne se cherche pas au milieu des réglages.
               En haut à droite, elle est toujours au même endroit, quel que
               soit le nombre d'articles ou de tailles. -->
          <div class="bat-pied">
            <span class="hint" id="bat-status"></span>
            <button class="btn secondaire" id="bat-history">Historique</button>
            <button class="btn primaire" id="bat-export">Exporter le PDF</button>
          </div>
        </div>
        <div class="bat-main">
          <div class="bat-scroll" id="bat-scroll"><div class="bat-pages" id="bat-pages"></div></div>
          <!-- LE ZOOM AGIT SUR LA FEUILLE, IL VIT DONC SUR LA FEUILLE. Dans le
               rail, il occupait une ligne de 50 px d'une colonne qui manque de
               hauteur, à côté de commandes qui parlent de l'ARTICLE — alors
               qu'il ne parle que de l'affichage. Posé en coin, il ne prend la
               place de rien. -->
          <div class="bat-zoom" role="group" aria-label="Zoom de la feuille">
            <button class="bz-btn" id="bat-zoom-out" aria-label="Dézoomer" title="Dézoomer (Ctrl −)">−</button>
            <button class="bz-pct" id="bat-zoom-pct"></button>
            <button class="bz-btn" id="bat-zoom-in" aria-label="Zoomer" title="Zoomer (Ctrl +) — molette Ctrl ou pincement sur la feuille">+</button>
          </div>
        </div>
      </div>`));

    this.scroll = this.host.querySelector('#bat-scroll');
    this.pagesHost = this.host.querySelector('#bat-pages');
    this.productPicker = mountProductPicker(this.host.querySelector('#bat-product'), {
      onSelect: (productId) => this.changeGarment({ productId }),
      // IMPORTER SANS QUITTER LE BAT. Le pipeline TopTex est chargé au moment
      // du clic, pas au chargement de l'écran : il tire le catalogue d'images
      // et ne sert qu'à une référence qu'on n'a pas encore.
      onImport: async (ref, { onProgress }) => {
        const { importerReference } = await import('./toptexref.js');
        const res = await importerReference(ref, { onProgress });
        toast(res.existing
          ? `« ${productRef(res.product)} » complété : ${res.product.colors.length} couleurs.`
          : `« ${productRef(res.product)} » importé — ${res.product.colors.length} couleurs.`);
        return res;
      },
    });
    this.colorPicker = mountColorPicker(this.host.querySelector('#bat-color'), {
      onSelect: (colorSlug) => this.changeGarment({ colorSlug }),
    });
    // Monté UNE fois : `renderFaces` ne fait ensuite que le remettre à jour.
    // Le reconstruire à chaque rendu fermerait le menu au premier clic, alors
    // qu'on y coche plusieurs faces d'affilée.
    this.facePicker = mountFacePicker(this.host.querySelector('#bat-faces'), {
      onToggle: (key, coche) => this.toggleFace(key, coche),
    });
    const exportBtn = this.host.querySelector('#bat-export');
    exportBtn.onclick = () => this.exportPdf();
    // Précharge le composeur au SURVOL du bouton, comme la liste précharge
    // l'éditeur au survol d'une ligne : le temps d'atteindre le bouton et de
    // choisir un nom de fichier, tout est arrivé.
    // On chauffe AUSSI les polices embarquées (1,36 Mo de .ttf, 701 Ko
    // transférés) : sans cela elles se téléchargeaient après le choix du nom de
    // fichier, c'est-à-dire pendant l'attente la plus visible de l'application.
    const precharge = () => import('./batpdf.js')
      .then((m) => m.prechargerPolices?.())
      .catch(() => {});
    exportBtn.addEventListener('mouseenter', precharge, { once: true });
    exportBtn.addEventListener('focus', precharge, { once: true });
    this.host.querySelector('#bat-history').onclick = () => this.openHistory();
    this.host.querySelector('#bat-zoom-in').onclick = () => this.stepZoom(+1);
    this.host.querySelector('#bat-zoom-out').onclick = () => this.stepZoom(-1);
    // Le pourcentage est un interrupteur : ajusté ⇄ 100 % (taille réelle).
    this.host.querySelector('#bat-zoom-pct').onclick = () => {
      if (this.zoom === null) this.setZoom(1); else this.fitZoom();
    };
    this.bindZoomGestures();
    this.scroll.addEventListener('click', (e) => {
      if (this.sel && !e.target.closest('.pdf-face-canvas') && !e.target.closest('.logo-swatches-float')) {
        this.sel = null;
        this.renderSide();
        this.faceViews.forEach(v => v.draw());
      }
    });

    // Ne re-rendre QUE si la zone a vraiment changé de taille (> 2px). Évite de
    // reconstruire la page (et donc de recalculer le scale / repositionner le
    // visuel et les logos) pour des micro-variations — barre de défilement,
    // sous-pixels — qui feraient « sauter » la cible sous le curseur.
    this._roW = 0; this._roH = 0;
    this.ro = new ResizeObserver(debounce(() => {
      if (this.zoom !== null) return;
      const w = this.scroll.clientWidth, h = this.scroll.clientHeight;
      if (Math.abs(w - this._roW) < 2 && Math.abs(h - this._roH) < 2) return;
      this._roW = w; this._roH = h;
      this.renderPages();
    }, 150));
    this.ro.observe(this.scroll);

    await this.refresh();
  }

  // Recharge visuels manquants puis re-rend tout (appelé à l'entrée d'écran).
  async refresh() {
    const a = this.article;
    // Vêtement figé avec l'article : `this.product` suit l'onglet ouvert et
    // change sous nos pieds si l'utilisateur bascule d'onglet pendant un await
    // ci-dessous. Le relire dans la boucle rangeait le visuel du NOUVEL onglet
    // sous la clé de l'ANCIEN — cache empoisonné jamais rechargé, écran qui ne
    // montre plus ce que le PDF exporte.
    const product = this.product;
    for (const key of this.includedFaces()) {
      const vk = a.id + '|' + key;
      if (this.visuals[vk] === undefined) {
        try {
          // Aperçu éditeur : variante `medium` (~4× plus légère que `full`) ;
          // l'export PDF (batpdf.js) utilise `full` pour la qualité d'impression.
          // `mask: true` : masque du vêtement, pour qu'un clic à côté du textile
          // n'ouvre pas le sélecteur de fichier (cf. FaceView.bindPointer).
          this.visuals[vk] = await faceVisual(product, a.colorSlug, key, { maxDim: 1600, variant: 'medium', mask: true });
        } catch (e) { toast(e.message, { error: true }); this.visuals[vk] = null; }
      }
      for (const l of a.faces[key].logos) await this.logoCanvas(l);
    }
    this.renderTabs();
    this.renderFiche();
    this.renderGarmentSelectors();
    this.renderFaces();
    this.renderSizeInputs();
    this.renderPages();
    this.renderSide();
  }

  // ------------------------------------------------------- onglets (articles)
  // Un projet = une commande client, donc plusieurs articles (« 2 pochettes,
  // 3 t-shirts… ») : un onglet chacun, une page de PDF chacun. Le numéro porté
  // par l'onglet EST le numéro de page du BAT exporté.
  // ------------------------------------------------- ce qui s'imprime en tête
  // Une ligne = un intitulé fixe et un champ, exactement comme les quantités
  // juste en dessous. Deux sections voisines qui font la même chose la font de
  // la même façon (loi 10) — et l'intitulé à largeur fixe garde tous les champs
  // d'aplomb, sinon « Échéance » décalerait sa ligne à lui tout seul.
  champ(hote, cle, intitule, entree) {
    const ligne = el(`<label class="bat-champ" data-cle="${cle}">
      <span class="bat-champ-lb">${intitule}</span>
    </label>`);
    entree.classList.add('champ', 'bat-champ-in');
    ligne.appendChild(entree);
    hote.appendChild(ligne);
    return entree;
  }

  // Les informations du PROJET : elles valent pour toutes les pages du BAT, pas
  // pour l'article ouvert.
  renderFiche() {
    const hote = this.host.querySelector('#bat-fiche');
    if (!hote) return;
    hote.innerHTML = '';
    const p = this.project;

    const client = el(`<input type="text" placeholder="Nom du client" value="${esc(p.client || '')}">`);
    client.onchange = () => { p.client = client.value; app.updateTopbar(); this.autosave(); this.refreshMeta(); };
    this.champ(hote, 'client', 'Client', client);

    const nom = el(`<input type="text" placeholder="Intitulé du projet" value="${esc(p.name || '')}">`);
    nom.onchange = () => { p.name = nom.value; app.updateTopbar(); this.autosave(); this.refreshMeta(); };
    this.champ(hote, 'projet', 'Projet', nom);

  }

  // RÉFÉRENCE ET COULEUR IMPRIMÉES : PLUS DE SAISIE, LE CATALOGUE FAIT FOI.
  // Elles se retouchaient à la main dans un volet « Ce qui s'imprime ». Neuf
  // fois sur dix personne n'y touchait, et le volet coûtait une place que le
  // bandeau n'a pas. `articleRef` / `articleCouleur` continuent de lire une
  // retouche déjà enregistrée — un BAT ancien imprime donc toujours ce qu'il
  // imprimait ; on ne peut simplement plus en créer de nouvelle.

  // Le bandeau de CHAQUE page relit les valeurs : le client et le projet sont
  // les mêmes sur toutes, et l'article ouvert n'est pas forcément le seul rendu.
  refreshMeta() {
    for (const n of this.host.querySelectorAll('[data-meta]')) {
      n.textContent = this.valeurMeta(n.dataset.meta, n._art) || '—';
    }
  }

  valeurMeta(cle, a) {
    const p = this.project;
    if (cle === 'client') return p.client || '';
    if (cle === 'projet') return p.name || '';
    const produit = a ? store.product(a.productId) : null;
    const couleur = produit?.colors.find((c) => c.slug === a.colorSlug);
    if (cle === 'couleur') return articleCouleur(a, couleur);
    if (cle === 'ref') return articleRef(a, produit);
    return '';
  }

  renderTabs() {
    const host = this.host.querySelector('#bat-tabs');
    if (!host) return;
    host.innerHTML = '';
    const arts = this.project.articles;

    arts.forEach((a, i) => {
      const prod = store.product(a.productId);
      const color = prod?.colors.find(c => c.slug === a.colorSlug);
      const qty = articleQty(a);
      const active = a === this.article;
      const label = `${prod?.name || 'Produit inconnu'} — ${color?.label || '—'}`;
      // UNE LIGNE, ET RIEN QUE DU TEXTE. L'onglet portait une vignette de 40 px
      // et deux lignes empilées : 72 px de bandeau pour dire « article 1 ».
      // La photo du vêtement est déjà sur la feuille, en grand, juste en
      // dessous — la redire en timbre-poste coûtait la moitié de la rangée.
      // N° de page en pastille · RÉFÉRENCE du produit · pastille de couleur et
      // son nom · quantité. La référence, pas la désignation : « NS333 » se lit
      // d'un coup d'œil là où « T-shirt écoresponsable manches longues
      // unisexe » remplit l'onglet et se coupe quand même. La désignation
      // complète reste dans l'infobulle. Les actions (dupliquer / supprimer) ne sont portées que
      // par l'onglet ACTIF (cf. CSS) : la barre reste calme et la suppression
      // n'est jamais à portée de clic distrait.
      const tab = el(`<div class="bat-tab${active ? ' active' : ''}" role="tab" tabindex="${active ? 0 : -1}"
           aria-selected="${active}" draggable="true" title="Page ${i + 1} du BAT — ${esc(label)}${qty ? ` · ${qty} ex.` : ''}">
        <span class="pastille fort bt-num">${i + 1}</span>
        <span class="bt-name">${esc(prod ? productRef(prod) : 'Produit inconnu')}</span>
        <span class="bt-dot" style="background:${esc(color?.hex || '#dadce0')}"></span>
        <span class="bt-col">${esc(color?.label || '—')}</span>
        ${qty ? `<span class="bt-qty">${qty} ex.</span>` : ''}
        <span class="bt-actions">
          <button class="bt-act" data-a="dup" title="Dupliquer cet article (logos et grille compris)" aria-label="Dupliquer l’article" tabindex="${active ? 0 : -1}">${ICON_DUPLICATE}</button>
          <button class="bt-act bt-del" data-a="del" title="Supprimer cet article" aria-label="Supprimer l’article" tabindex="${active ? 0 : -1}">${ICON_X}</button>
        </span>
      </div>`);
      tab._art = a;

      tab.addEventListener('click', (e) => {
        const act = e.target.closest('[data-a]')?.dataset.a;
        if (act === 'dup') { e.stopPropagation(); this.duplicateArticle(a); return; }
        if (act === 'del') { e.stopPropagation(); this.removeArticle(a); return; }
        this.setArticle(a);
      });
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.setArticle(a); return; }
        // Navigue d'un onglet à l'autre (le focus reste dans la barre). Les
        // deux paires de flèches sont acceptées : ← → suivent la rangée, ↑ ↓
        // font la même chose plutôt que de ne rien faire.
        const dir = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1
          : (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : 0;
        if (dir) {
          e.preventDefault();
          const next = arts[clamp(i + dir, 0, arts.length - 1)];
          if (next !== a) this.setArticle(next);
          host.querySelector('.bat-tab.active')?.focus();
        }
      });

      // Réordonner par glisser : l'ordre des onglets EST l'ordre des pages du
      // PDF. On déplace l'élément DOM pendant le geste (un re-render romprait le
      // drag natif) et on rejoue l'ordre obtenu dans le modèle au relâchement.
      tab.addEventListener('dragstart', (e) => {
        this._dragTab = tab;
        e.dataTransfer.effectAllowed = 'move';
        // Firefox exige des données pour amorcer le glisser.
        e.dataTransfer.setData('text/plain', a.id);
        requestAnimationFrame(() => tab.classList.add('dragging'));
      });
      tab.addEventListener('dragover', (e) => {
        if (!this._dragTab || this._dragTab === tab) return;
        e.preventDefault();
        const r = tab.getBoundingClientRect();
        // L'axe du glisser suit celui de la liste : verticale en rail gauche,
        // horizontale en repli étroit. On lit la direction réellement calculée
        // plutôt que de la supposer — sinon, en rail, viser le bas d'un onglet
        // insérait selon X et l'ordre des pages devenait imprévisible.
        const vertical = getComputedStyle(host).flexDirection === 'column';
        const after = vertical ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
        host.insertBefore(this._dragTab, after ? tab.nextSibling : tab);
      });
      tab.addEventListener('dragend', () => {
        tab.classList.remove('dragging');
        this._dragTab = null;
        this.commitTabOrder(host);
      });
      host.appendChild(tab);
    });

    const add = el(`<button class="bat-tab-add" title="Ajouter un article à ce projet (une page de plus au BAT)">
      ${ICON_PLUS}<span>Article</span></button>`);
    add.onclick = () => this.addArticle();
    host.appendChild(add);

    // Barre défilante : au 8e article, l'onglet ajouté ou rejoint peut être hors
    // champ. `nearest` ne bouge rien s'il est déjà visible — renderTabs() étant
    // rappelé à chaque saisie de quantité, la barre ne doit pas sauter.
    host.querySelector('.bat-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Ordre des onglets (DOM) → ordre des articles (modèle), après un glisser.
  commitTabOrder(host) {
    const order = [...host.querySelectorAll('.bat-tab')].map(t => t._art);
    if (order.length !== this.project.articles.length) return;
    if (order.every((a, i) => a === this.project.articles[i])) return;
    this.project.articles = order;
    this.autosave();
    this.renderTabs();   // numéros de page à jour
    this.renderPages();  // pied de page « n / N »
  }

  // Bascule d'onglet : chaque article a son propre vêtement, ses faces et sa
  // grille — donc sa propre pile d'annulation et sa propre sélection.
  async setArticle(a) {
    if (a === this.article) return;
    this.autosave.flush();
    this.article = a;
    this.sel = null;
    this.hist = { undo: [], redo: [] };
    this.prepareArticle();
    await this.refresh();
  }

  async addArticle() {
    const products = store.catalogue.products;
    if (!products.length) { toast('Le catalogue produit est vide.', { error: true }); return; }
    // Nouvel article sur le même vêtement que l'onglet courant : dans une
    // commande, l'article suivant est le plus souvent une variante (autre
    // couleur, autre taille) plutôt qu'un produit sans rapport. Le sélecteur
    // s'ouvre dans la foulée pour changer de produit en un geste.
    const art = newArticle({ productId: this.article.productId, colorSlug: this.article.colorSlug });
    this.project.articles.push(art);
    await this.setArticle(art);
    this.autosave();
    app.updateTopbar();
    this.productPicker?.open();
  }

  async duplicateArticle(a) {
    const copy = cloneArticle(a);
    this.project.articles.splice(this.project.articles.indexOf(a) + 1, 0, copy);
    await this.setArticle(copy);
    this.autosave();
    app.updateTopbar();
    toast('Article dupliqué — changez la couleur ou le produit dans la barre du haut.');
  }

  async removeArticle(a) {
    const arts = this.project.articles;
    if (arts.length === 1) { toast('Un projet garde au moins un article.', { error: true }); return; }
    // Un article vide part sans question ; dès qu'il porte du travail (logos
    // posés ou quantités saisies), on énonce précisément ce qui serait perdu.
    const logos = FACE_ORDER.reduce((n, k) => n + (a.faces[k]?.logos.length || 0), 0);
    const qty = articleQty(a);
    if (logos || qty) {
      const prod = store.product(a.productId);
      const porte = [
        logos ? `${logos} logo${logos > 1 ? 's' : ''} posé${logos > 1 ? 's' : ''}` : '',
        qty ? `une commande de ${qty} ex.` : '',
      ].filter(Boolean).join(' et ');
      // Tiret cadratin et non point final : le fragment se termine déjà par
      // l'abréviation « ex. » — deux points de suite sinon.
      const ok = await confirmModal('Supprimer l’article',
        `« ${prod?.name || 'Cet article'} » porte ${porte} — sa page du BAT sera supprimée définitivement.`,
        { danger: true, okLabel: 'Supprimer' });
      if (!ok) return;
    }
    const i = arts.indexOf(a);
    arts.splice(i, 1);
    for (const k of FACE_ORDER) delete this.visuals[a.id + '|' + k];
    if (this.article === a) {
      this.article = arts[clamp(i, 0, arts.length - 1)];
      this.sel = null;
      this.hist = { undo: [], redo: [] };
      this.prepareArticle();
    }
    this.autosave();
    app.updateTopbar();
    await this.refresh();
  }

  // ------------------------------------------------- produit / couleur (haut)
  // Les sélecteurs agissent sur l'ARTICLE ouvert (l'onglet courant), pas sur le
  // projet : chaque article a son propre vêtement.
  renderGarmentSelectors() {
    if (!this.productPicker || !this.colorPicker) return;
    this.productPicker.update(store.catalogue.products, this.article.productId);
    this.colorPicker.update(this.product?.colors || [], this.article.colorSlug);
  }

  // Changement de vêtement en place : recharge visuels, faces dispo, marquages.
  async changeGarment({ productId, colorSlug }) {
    const a = this.article;
    if (productId !== undefined && productId !== a.productId) {
      a.productId = productId;
      this.product = store.product(productId);
      if (!this.product) { toast('Produit introuvable.', { error: true }); return; }
      // conserver la couleur si le nouveau produit la propose, sinon la première
      if (!this.product.colors.some(c => c.slug === a.colorSlug)) {
        a.colorSlug = this.product.colors[0]?.slug || '';
      }
      // Les tailles suivent le vêtement : un enfant ne se commande pas en
      // XS…2XL, et un mug pas en XS…2XL du tout — passer à un objet sans
      // taille rend la liste vide, ce qui replie la grille sur une seule
      // ligne. Report sans perte dans les deux cas (les lignes portant une
      // quantité sont conservées), donc sans question posée — d'où l'absence
      // de confirmation ici. Changer seulement la COULEUR ne touche pas aux
      // tailles : le vêtement est le même.
      applySizeLabels(a, productSizeLabels(this.product));
    }
    if (colorSlug !== undefined) a.colorSlug = colorSlug;

    // faces réellement disponibles + purge du cache visuels de CET article
    // (les autres onglets gardent les leurs : leur vêtement n'a pas bougé).
    this.available = availableFaces(this.product, a.colorSlug);
    for (const k of FACE_ORDER) delete this.visuals[a.id + '|' + k];
    let anyIncluded = false;
    for (const k of FACE_ORDER) {
      if (!this.available.includes(k)) a.faces[k].included = false;
      if (a.faces[k].included) anyIncluded = true;
    }
    if (!anyIncluded && this.available.includes('front')) a.faces.front.included = true;
    if (!this.available.includes(this.activeFace)) this.activeFace = this.available[0] || 'front';
    this.sel = null;

    syncGrid(a);
    app.updateTopbar();
    this.autosave();
    await this.refresh();
  }

  scale() {
    if (this.zoom) return this.zoom;
    // Ajustement auto : la page (unique) tient ENTIÈREMENT dans la fenêtre,
    // largeur ET hauteur, pour supprimer le défilement. On soustrait le
    // padding de #bat-pages (PAD = 16px de chaque côté, soit 32) PLUS une marge
    // anti-barre de défilement (SB) : la page reste toujours un peu plus petite
    // que la zone, si bien qu'AUCUNE barre n'apparaît en mode auto. Sans ça, sur
    // Windows (barres classiques ~17px), une barre qui apparaît/disparaît
    // recalculait le scale → toute la page (visuel + logos) « glissait » d'~1 cm
    // sous le curseur (invisible sur macOS overlay). Plancher bas pour lisibilité.
    const PAD = 32, SB = 18;
    const w = this.scroll?.clientWidth || PW;
    const h = this.scroll?.clientHeight || PH;
    const s = Math.min((w - PAD - SB) / PW, (h - PAD - SB) / PH);
    return clamp(s, 0.4, 2.2);
  }
  // Zoom ancré sur un point de l'ÉCRAN (par défaut le logo sélectionné, sinon
  // le centre de la vue) : ce qu'on regardait reste là où on le regardait.
  // Sans cet ancrage, chaque cran de zoom fait fuir le logo hors de l'écran et
  // il faut le rattraper aux barres de défilement.
  //
  // Deux temps, pour que le geste reste fluide : la nouvelle échelle est
  // appliquée TOUT DE SUITE par transformation CSS (aucun DOM reconstruit,
  // aucun canevas redessiné), puis un renderPages() différé refait les
  // canevas à la résolution du nouveau zoom — c'est lui qui rend le tracé net,
  // et il n'a pas besoin d'être synchrone.
  setZoom(s, anchor = null) {
    const before = this.scale();
    const next = clamp(s, ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(next - before) < 0.001) { this.zoom = next; this.updateZoomUI(); return; }

    // Le point à garder fixe est mémorisé en coordonnées de PAGE (pt) : elles
    // ne dépendent ni du zoom, ni du centrage de la feuille dans la zone de
    // défilement (`.bat-pages` est centré et rembourré — raisonner en offsets
    // de défilement faisait dériver la cible à chaque cran).
    const sc = this.scroll;
    const pageEl = this.pagesHost?.querySelector('.bat-page');
    let keep = null;
    if (sc && pageEl) {
      const r = sc.getBoundingClientRect();
      const centre = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const a = anchor || this.zoomAnchor() || centre;
      const pr = pageEl.getBoundingClientRect();
      // Cible écran : là où le point se trouve déjà s'il est visible ; sinon le
      // centre de la vue — zoomer sur un logo hors champ doit le ramener sous
      // les yeux, pas le pousser plus loin.
      const visible = a.x >= r.left && a.x <= r.right && a.y >= r.top && a.y <= r.bottom;
      const target = visible ? a : centre;
      keep = { px: (a.x - pr.left) / before, py: (a.y - pr.top) / before, sx: target.x, sy: target.y };
    }

    this.zoom = next;
    this.applyZoomVisual(next);

    if (keep) {
      // Après remise à l'échelle, on décale le défilement de l'écart entre la
      // nouvelle position du point et sa cible. Le navigateur borne lui-même le
      // défilement quand la feuille est plus petite que la vue (elle est alors
      // centrée : le point ne peut de toute façon plus bouger).
      const pr = pageEl.getBoundingClientRect();
      sc.scrollLeft += pr.left + keep.px * next - keep.sx;
      sc.scrollTop += pr.top + keep.py * next - keep.sy;
    }

    // Les pastilles de couleur sont positionnées en coordonnées de page : le
    // conteneur zoomé les emmène avec lui, mais elles se replacent proprement
    // au re-rendu. On les masque en attendant plutôt que de les laisser dériver.
    this.hideLogoFloat();
    this.updateZoomUI();
    this._zoomSettle ??= debounce(() => this.renderPages(), 160);
    this._zoomSettle();
  }

  // Ajuster à la fenêtre : retour au mode automatique (this.zoom = null).
  fitZoom() {
    if (this.zoom === null) return;
    this.zoom = null;
    this.renderPages();
    this.updateZoomUI();
  }

  // Cran suivant/précédent de la réglette, à partir du zoom EFFECTIF (le mode
  // « ajusté » n'est pas rond : partir de 100 % ferait sauter la vue).
  stepZoom(dir) {
    const cur = this.scale();
    const next = dir > 0
      ? ZOOM_STEPS.find(z => z > cur + 0.001)
      : [...ZOOM_STEPS].reverse().find(z => z < cur - 0.001);
    if (next) this.setZoom(next);
  }

  // Point d'ancrage par défaut : le logo sélectionné. C'est LE cas d'usage —
  // « je viens de poser mon logo, je zoome dessus » — et il doit marcher au
  // bouton comme à la molette, sans viser quoi que ce soit.
  zoomAnchor() {
    const sel = this.selected();
    if (!sel || !this.sel) return null;
    const view = this.faceViews.find(v => v.faceKey === this.sel.faceKey);
    if (!view) return null;
    const r = view.pageRect(sel);
    const pageBox = view.pageEl.getBoundingClientRect();
    const s = this.scale();
    return { x: pageBox.left + (r.x + r.w / 2) * s, y: pageBox.top + (r.y + r.h / 2) * s };
  }

  // Application immédiate de l'échelle au DOM déjà en place : seule la
  // transformation de la feuille et la boîte qui la réserve changent.
  applyZoomVisual(s) {
    for (const wrap of this.pagesHost?.querySelectorAll('.bat-page-wrap') || []) {
      wrap.style.width = PW * s + 'px';
      wrap.style.height = PH * s + 'px';
      const page = wrap.querySelector('.bat-page');
      if (page) page.style.transform = `scale(${s})`;
    }
  }

  updateZoomUI() {
    const pct = this.host?.querySelector('#bat-zoom-pct');
    if (pct) {
      pct.textContent = Math.round(this.scale() * 100) + ' %';
      pct.classList.toggle('auto', this.zoom === null);
      pct.title = this.zoom === null
        ? 'Feuille ajustée à la fenêtre — cliquez pour revenir à 100 %'
        : 'Cliquez pour ajuster la feuille à la fenêtre';
    }
    const out = this.host?.querySelector('#bat-zoom-out');
    const inn = this.host?.querySelector('#bat-zoom-in');
    if (out) out.disabled = this.scale() <= ZOOM_MIN + 0.001;
    if (inn) inn.disabled = this.scale() >= ZOOM_MAX - 0.001;
  }

  // Gestes de zoom/panoramique sur la zone de défilement. Tous passent par
  // setZoom(), donc tous restent ancrés sur ce qu'on regarde.
  bindZoomGestures() {
    const sc = this.scroll;

    // Ctrl/⌘ + molette — et le pincement de trackpad, que les navigateurs
    // rapportent précisément comme une molette Ctrl. La molette NUE reste le
    // défilement : c'est ce qu'attend n'importe qui, et c'est le seul moyen de
    // parcourir une feuille zoomée à la souris.
    sc.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // Exponentiel : un cran donne le même RAPPORT de zoom à 40 % qu'à 300 %.
      this.setZoom(this.scale() * Math.exp(-e.deltaY * 0.0016), { x: e.clientX, y: e.clientY });
    }, { passive: false });

    // Pincement à deux doigts (tablette). Le premier doigt appartient déjà à la
    // feuille (poser/déplacer un logo) : l'arrivée du second bascule en zoom et
    // abandonne le geste en cours — cf. `_pinching`, lu par FaceView.
    const pts = new Map();
    let pinch = null;
    const mid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    sc.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, e);
      if (pts.size !== 2) return;
      const [a, b] = [...pts.values()];
      pinch = { d0: dist(a, b) || 1, z0: this.scale() };
      this._pinching = true;
    }, true);

    sc.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, e);
      if (!pinch || pts.size !== 2) return;
      e.preventDefault();
      const [a, b] = [...pts.values()];
      this.setZoom(pinch.z0 * (dist(a, b) / pinch.d0), mid(a, b));
    }, { capture: true, passive: false });

    const dropPoint = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) { pinch = null; this._pinching = false; }
    };
    sc.addEventListener('pointerup', dropPoint, true);
    sc.addEventListener('pointercancel', dropPoint, true);

    // Panoramique au bouton du milieu (souris) : le glisser de la feuille est
    // pris par les logos, et viser une barre de défilement à 300 % de zoom
    // n'est pas un geste de travail.
    let pan = null;
    sc.addEventListener('pointerdown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      pan = { x: e.clientX, y: e.clientY, l: sc.scrollLeft, t: sc.scrollTop };
      sc.setPointerCapture(e.pointerId);
      sc.classList.add('panning');
    });
    sc.addEventListener('pointermove', (e) => {
      if (!pan) return;
      sc.scrollLeft = pan.l - (e.clientX - pan.x);
      sc.scrollTop = pan.t - (e.clientY - pan.y);
    });
    const endPan = () => { pan = null; sc.classList.remove('panning'); };
    sc.addEventListener('pointerup', endPan);
    sc.addEventListener('pointercancel', endPan);
  }

  // ----------------------------------------------------------- les faces
  // Le contrôle est monté une fois pour toutes (cf. `load`) : ici on ne fait
  // que lui redonner l'état de l'article ouvert.
  renderFaces() {
    this.facePicker?.update(FACE_ORDER.map((key) => ({
      key,
      label: FACES[key].label,
      included: !!this.article.faces[key].included,
      available: this.available.includes(key),
      logos: this.article.faces[key].logos.length,
    })));
  }

  toggleFace(key, coche) {
    const f = this.article.faces[key];
    f.included = coche;
    // Un logo sélectionné sur une face qu'on vient de retirer n'a plus de
    // support : le garder ferait pointer le panneau de droite dans le vide.
    if (!f.included && this.sel?.faceKey === key) this.sel = null;
    syncGrid(this.article);
    this.autosave();
    this.refresh();
  }

  // ----------------------------------------------------- quantités au rail
  // LA QUANTITÉ EST L'INTERRUPTEUR : écrire un nombre pose la taille sur le bon
  // à tirer, effacer le champ l'en retire. Un seul geste, et l'état du document
  // se lit dans ce qu'on a écrit — au lieu d'une pastille à cocher PUIS d'une
  // case à remplir, deux moitiés de geste qu'il fallait tenir cohérentes.
  //
  // La cible passe de 9 pt (la case de la feuille, à la taille du texte imprimé)
  // à la boîte de l'application. La feuille reste saisissable : c'est la même
  // donnée, vue de deux endroits.
  renderSizeInputs() {
    const cont = this.host.querySelector('#bat-sizes');
    if (!cont) return;
    const serie = this.product ? sizeReference(this.product) : [];
    const choix = serie.length ? sizeChoices(this.article, serie) : [];
    // Objet sans taille (mug, gourde…) : il n'y a pas de série à quantifier.
    for (const id of ['#bat-sizes-label', '#bat-sizes-outils']) {
      const e = this.host.querySelector(id);
      if (e) e.style.display = choix.length ? '' : 'none';
    }
    cont.style.display = choix.length ? '' : 'none';
    this.renderSizeTools();
    if (!choix.length) return;

    // RECONSTRUIRE À CHAQUE FRAPPE REPRENDRAIT LE CHAMP SOUS LES DOIGTS — et
    // perdrait la tabulation d'une taille à la suivante. La liste ne dépend que
    // de la SÉRIE, qui ne bouge pas quand on tape : on ne la rebâtit donc que
    // si elle a réellement changé, et sinon on repousse les seules valeurs.
    // LES TAILLES PAS ENCORE NOMMÉES COMPTENT AUSSI. `sizeChoices` les écarte —
    // à raison, il apparie par intitulé et une ligne vierge n'en a pas. Mais
    // « + taille » crée exactement ça : une colonne vide à nommer. Sans cette
    // reprise, le bouton ajoutait une colonne au PDF que le rail ne montrait
    // pas, donc impossible à nommer et impossible à retirer.
    const vierges = (this.article.sizes || []).filter((sz) => !String(sz.taille ?? '').trim());
    const lignes = [
      ...choix,
      ...vierges.map((sz) => ({ label: '', quantite: sz.quantite ?? '', horsGrille: false, vierge: sz })),
    ];

    const signature = lignes.map((c, i) => c.vierge ? '\u0002' + i : c.label).join('\u0001');
    if (cont.dataset.serie === signature) {
      for (const c of choix) {
        const inp = cont.querySelector(`input[data-taille="${CSS.escape(c.label)}"]`);
        if (inp && inp !== document.activeElement) inp.value = c.quantite ?? '';
      }
      this.renderQtyTotal();
      return;
    }
    cont.dataset.serie = signature;
    cont.replaceChildren();

    // L'INTITULÉ EST UN CHAMP, PAS UNE ÉTIQUETTE. Renommer une taille (« XS »
    // en « TU ») ou en ajouter une se faisait dans le tableau de la feuille, sur
    // des cases de 16 px. La colonne du tableau et la rangée du bandeau montrent
    // la même chose ; c'est ici qu'on la modifie.
    // PLUS DE CROIX PAR TAILLE. Chaque case portait la sienne, révélée au
    // survol : douze boutons de retrait pour une série de six, posés sur le
    // bord même du champ qu'on est en train de remplir. « Seulement les
    // commandées » fait le ménage d'un geste, et ne peut rien jeter — il ne
    // retire que des lignes vides (cf. tailles.js).
    lignes.forEach((c) => {
      // Une taille et sa quantité côte à côte, et toute la série sur UNE
      // rangée : c'est la saisie la plus fréquente de l'application, elle ne
      // doit pas demander de balayer deux lignes ni de faire défiler.
      const row = el(`<div class="bat-qty-row"
        title="${c.horsGrille ? 'Taille hors de la grille du produit' : ''}">
        <input class="champ bat-qty-lb" type="text" autocomplete="off" spellcheck="false"
               value="${esc(c.label)}" aria-label="Intitulé de la taille ${esc(c.label)}">
        <span class="bat-qty-cell">
          <input class="champ bat-qty-in" type="text" inputmode="numeric" autocomplete="off"
                 data-taille="${esc(c.label)}" value="${esc(c.quantite ?? '')}" placeholder="—"
                 aria-label="Quantité pour la taille ${esc(c.label)}">
        </span>
      </div>`);
      const [lb, inp] = row.querySelectorAll('input');

      lb.onchange = () => {
        const sz = c.vierge || (this.article.sizes || []).find((x) => x.taille === c.label);
        if (!sz) { lb.value = c.label; return; }
        sz.taille = lb.value;
        syncGrid(this.article);   // la cote suit la taille, pas la colonne
        this.autosave(); this.renderPages(); this.renderSizeInputs(); this.renderTabs();
      };

      inp.onchange = () => {
        // Une ligne pas encore nommée n'a pas d'intitulé pour se faire
        // retrouver : on écrit sa quantité directement sur elle.
        if (c.vierge) { c.vierge.quantite = inp.value; }
        else setSizeQuantity(this.article, c.label, inp.value, serie);
        syncGrid(this.article);   // cotes des tailles qui viennent d'arriver
        this.autosave();
        this.renderPages();
        this.renderSizeInputs();
        this.renderTabs();
      };

      cont.appendChild(row);
    });

    // LE « + » EST AU BOUT DE LA SÉRIE, pas au bout de la rangée. Posé en lien
    // à l'autre extrémité du bandeau, il fallait traverser la barre pour
    // ajouter une taille à un tableau qu'on est en train de remplir — et rien
    // ne disait qu'il parlait des tailles plutôt que du reste. Il prend donc la
    // forme et la place de la case suivante : là où la taille va apparaître.
    const ajouter = el(`<button class="bat-qty-add" title="Ajouter une taille à ce tableau" aria-label="Ajouter une taille">+</button>`);
    ajouter.onclick = () => {
      const sz = { id: uid(), taille: '', quantite: '' };
      (this.article.sizes ??= []).push(sz);
      (this.article.placements || []).forEach((pl) => { pl.dims ??= {}; pl.dims[sz.id] = pl.auto?.dim ?? ''; });
      this.autosave(); this.renderPages(); this.renderSizeInputs();
      // Le champ neuf est vide : on y met le curseur, sinon il faut aller le
      // chercher pour se servir du bouton qu'on vient de presser.
      this.host.querySelector('#bat-sizes .bat-qty-row:last-child .bat-qty-lb')?.focus();
    };
    cont.appendChild(ajouter);

    ajusterColonneIntitules(cont, lignes.map((c) => c.label));
    this.renderQtyTotal();
  }

  // Revenir aux tailles du produit, retirer celles qu'on n'a pas commandées.
  // Les deux sont CONDITIONNELLES — proposées seulement quand elles changent
  // quelque chose, sinon elles occuperaient la place pour ne rien faire.
  // (Ajouter une taille, c'est le « + » au bout de la série, dans
  // `renderSizeInputs`.)
  renderSizeTools() {
    const hote = this.host.querySelector('#bat-sizes-outils');
    if (!hote) return;
    hote.replaceChildren();

    const ref = this.product && productHasSizes(this.product) ? productSizeLabels(this.product) : null;
    if (ref && !sizesAreSynced(this.article, ref)) {
      const sync = el(`<button class="lien-outil" title="Reprendre les tailles définies pour ce produit">tailles du produit</button>`);
      sync.onclick = () => {
        applySizeLabels(this.article, ref);
        syncGrid(this.article);
        this.autosave(); this.renderPages(); this.renderSizeInputs(); this.renderTabs();
      };
      hote.appendChild(sync);
    }

    // SANS PERTE POSSIBLE : ne retire que des colonnes vides (cf. tailles.js).
    const vides = unorderedSizes(this.article);
    if (ref && vides.length && vides.length < (this.article.sizes || []).length) {
      const menage = el(`<button class="lien-outil" title="Retirer ${vides.length === 1 ? 'la taille' : 'les tailles'} ${esc(vides.join(', '))} — aucune quantité saisie">seulement les commandées</button>`);
      menage.onclick = () => {
        keepOrderedSizes(this.article, sizeReference(this.product));
        this.autosave(); this.renderPages(); this.renderSizeInputs(); this.renderTabs();
      };
      hote.appendChild(menage);
    }
  }

  renderQtyTotal() {
    const e = this.host.querySelector('#bat-qty-total');
    if (!e) return;
    const t = totalQuantity(this.article);
    e.textContent = t === null ? '' : `${t} ex.`;
  }

  // -------------------------------------------------------------- les pages
  renderPages() {
    if (!this.pagesHost) return;
    // Préserve la position de défilement : renderPages() reconstruit tout
    // #bat-pages (y compris à chaque sélection/glisser de logo), ce qui
    // sinon ramènerait la vue en haut à chaque interaction.
    const scrollTop = this.scroll?.scrollTop || 0;
    const scrollLeft = this.scroll?.scrollLeft || 0;
    const s = this.scale();
    const included = this.includedFaces();
    const pages = included.length ? facePages(included) : [[]];
    this.faceViews = [];
    this.pagesHost.innerHTML = '';

    // L'éditeur montre la page de l'ARTICLE ouvert ; les autres articles sont à
    // un clic d'onglet. Le numéro affiché reste celui du PDF complet (un article
    // = une page), pour que l'écran ne mente pas sur le document exporté.
    const pageNum = this.project.articles.indexOf(this.article) + 1;
    const pageCount = this.project.articles.length;
    pages.forEach((faceKeys) => {
      const wrap = el(`<div class="bat-page-wrap" style="width:${PW * s}px;height:${PH * s}px"></div>`);
      const page = el(`<div class="bat-page" style="width:${PW}px;height:${PH}px;transform:scale(${s})"></div>`);
      wrap.appendChild(page);
      this.pagesHost.appendChild(wrap);
      this.buildPage(page, faceKeys, pageNum, pageCount);
    });
    if (this.scroll) { this.scroll.scrollTop = scrollTop; this.scroll.scrollLeft = scrollLeft; }
    this.updateZoomUI();
    // La carte flottante vit dans #bat-pages : renderPages() vient de la
    // supprimer, on la reconstruit si un logo reste sélectionné (idempotent,
    // no-op sinon).
    this.renderSide();
  }

  buildPage(page, faceKeys, pageNum, pageCount) {
    const p = this.project;
    const a = this.article;
    const product = this.product;   // null si le vêtement a quitté le catalogue
    const color = product?.colors.find(c => c.slug === a.colorSlug);
    const c = store.settings.company;

    // Grille fusionnée : lignes = tailles, colonnes = emplacements (logos posés).
    const allSizes = a.sizes ??= [];
    const placements = a.placements ??= [];
    // Toujours au moins une ligne de taille éditable.
    if (!allSizes.length) { allSizes.push({ id: uid(), taille: '', quantite: '' }); this.autosave(); }
    // LE DOCUMENT N'IMPRIME QUE LES TAILLES COMMANDÉES : le rail garde la série
    // complète pour continuer à saisir, la page ne montre que ce qui porte une
    // quantité (cf. servedSizes, tailles.js).
    const sizes = servedSizes(a);
    const { BUB_HEAD, labelW, sizeW, totalW, V_TOP } = grid(sizes.length, placements.length);

    // ---- Bandeau = UNE carte unifiée (identité + grille commande/marquage
    // empilées en flux normal à l'intérieur, séparateur entre les deux).
    const bubble = (box) => {
      const b = el(`<div class="pdf-bubble" style="left:${box.x}px;top:${box.top}px;width:${box.w}px;height:${box.h}px"></div>`);
      page.appendChild(b);
      return b;
    };
    const bubHead = bubble(BUB_HEAD);
    bubHead.classList.add('pdf-bub-head');

    // ---- Section identité : logo + client / projet / date + BON À TIRER + version
    const headId = el(`<div class="pdf-head-id"></div>`);
    bubHead.appendChild(headId);
    const logoSlot = el(`<div class="pdf-company-logo" title="Logo entreprise — modifiable dans Administration"></div>`);
    headId.appendChild(logoSlot);
    this.fillCompanyLogo(logoSlot, c);

    const meta = el(`<div class="pdf-meta"></div>`);
    headId.appendChild(meta);
    // Largeurs au prorata de META_COLS (batlayout.js) — mêmes proportions que le
    // PDF exporté. `flex-basis:0` : seul le poids décide, le contenu n'influe pas.
    const metaFlex = new Map(META_COLS.map(c => [c.label, c.flex]));
    const metaFields = [];
    // LA FEUILLE EST UN APERÇU, PLUS UN FORMULAIRE. Ces cinq valeurs se
    // saisissaient ici, dans des cases hautes de 10 px sur un A4 réduit — sous
    // la barre des 44 px que ce projet s'impose, et impossibles à viser au
    // doigt. Elles se saisissent maintenant dans le rail, avec tout le reste ;
    // ce qui reste ici est ce que le PDF imprimera, à la lettre près.
    // `data-meta` : c'est par lui que `refreshMeta` les rafraîchit sans
    // reconstruire la page — le client et le projet valent pour TOUTES les
    // pages, pas seulement celle de l'article ouvert.
    const metaRow = (label, cle) => {
      const r = el(`<div class="pdf-meta-cell" style="flex:${metaFlex.get(label) ?? 1} 1 0"><span class="lb">${label}</span></div>`);
      const v = el(`<span class="pdf-meta-val" data-meta="${cle}"></span>`);
      v._art = a;
      v.textContent = this.valeurMeta(cle, a) || '—';
      r.appendChild(v);
      meta.appendChild(r);
      metaFields.push(v);
    };
    metaRow('DESTINATAIRE', 'client');
    metaRow('PROJET', 'projet');
    metaRow('COULEUR', 'couleur');
    metaRow('RÉF. PRODUIT', 'ref');

    const headR = el(`<div class="pdf-head-right">
      <div class="pdf-bat-label">BON À TIRER</div>
    </div>`);
    headId.appendChild(headR);
    // Après headR : la largeur des cases dépend de l'espace que « BON À TIRER »
    // laisse au bandeau. La page est déjà dans le document (renderPages attache
    // le conteneur avant d'appeler buildPage), les mesures sont donc valides.
    for (const input of metaFields) fitMetaValue(input);

    // ---- Visuels
    const zoneH = PH - V_TOP - V_BOTTOM;
    if (!faceKeys.length) {
      page.appendChild(el(`<div class="pdf-empty" style="left:${VX}px;top:${V_TOP}px;width:${VW}px;height:${zoneH}px">
        Aucune face incluse.<br>Ouvrez « Faces » dans la barre du haut et cochez « Cœur », « Dos »…</div>`));
    }
    // Hauteur commune : mêmes ratios que le PDF (faceLayout). Un visuel
    // manquant prend un ratio textile par défaut pour ne pas casser la rangée.
    const aspects = faceKeys.map((key) => {
      const v = this.visual(key);
      return v ? v.width / v.height : 0.8;
    });
    const boxes = faceLayout(aspects, zoneH);
    faceKeys.forEach((key, i) => {
      const vis = this.visual(key);
      const box = boxes[i];
      if (!vis) {
        page.appendChild(el(`<div class="pdf-empty" style="left:${box.x}px;top:${V_TOP}px;width:${box.w}px;height:${zoneH}px">
          Visuel indisponible pour « ${FACES[key].label} ».</div>`));
        return;
      }
      const fv = new FaceView(this, key, box, vis, page, V_TOP);
      this.faceViews.push(fv);
    });

    // ---- Section tableau : grille fusionnée (Taille | Qté | un emplacement/logo)
    const colTbl = el(`<div class="pdf-col"></div>`);
    bubHead.appendChild(colTbl);
    const faceLabels = facesByLogoId(a);
    colTbl.appendChild(this.buildGrid(sizes, placements, { labelW, sizeW, totalW, faceLabels }));

    // ---- Pied de page : mentions légales (cliquer = éditer) + identité
    const mentions = fillTemplate(store.settings.mentions, companyMentionVars(c));
    const identity = esc(companyIdentityLine(c));
    const foot = el(`<div class="pdf-footer" style="left:${M}px;right:${M}px">
      <div class="pdf-mentions" title="Cliquer pour modifier les mentions légales">${esc(mentions)}</div>
      <div class="pdf-identity">
        <span title="Identité — modifiable dans Administration → Mon entreprise">${identity}</span>
        <span class="pn">${pageNum}${pageCount > 1 ? ' / ' + pageCount : ''}</span>
      </div>
    </div>`);
    page.appendChild(foot);
    foot.querySelector('.pdf-mentions').onclick = () => this.editMentions();
  }

  // « Fiche de production » — grille Material identique au PDF, cellules
  // éditables en place.
  //
  // LES TAILLES SONT EN COLONNES (cf. grid() dans batlayout.js) : l'axe long
  // s'étale sur la largeur, l'axe court descend. Colonnes : intitulé | une par
  // taille | Total. Lignes : en-tête (les tailles, éditables) | Qté | un
  // emplacement par logo posé (intitulé = face en gras + couleur · emplacement).
  buildGrid(sizes, placements, geom) {
    const { labelW, sizeW, totalW, faceLabels } = geom;
    const total = labelW + sizeW * sizes.length + totalW || 1;
    const pct = (w) => `${(w / total) * 100}%`;
    const fs = TBL_FONT;
    const page = () => t.closest('.bat-page');

    const t = el(`<div class="pdf-table pdf-grid">
      <div class="pdf-tbl-head"></div>
      <div class="pdf-tbl-body"></div>

    </div>`);
    t._grid = { sizes, placements };   // lu par refreshGridInPlace

    // ---- En-tête : coin vide · une colonne par taille (éditable) · TOTAL
    const head = t.querySelector('.pdf-tbl-head');
    head.appendChild(el(`<span class="hc hc-label" style="width:${pct(labelW)}">Taille</span>`));
    // LE TABLEAU EST UN APERÇU. Renommer une taille, en ajouter, en retirer :
    // tout cela se faisait ici, sur des cases de 16 px de haut, très loin des
    // 44 px que ce projet s'impose. Le rail porte maintenant une ligne par
    // taille — intitulé et quantité, à la hauteur des autres commandes. Ce qui
    // reste ici est ce que le PDF imprimera.
    sizes.forEach((sz) => {
      const cell = el(`<span class="hc hc-size" style="width:${pct(sizeW)}"></span>`);
      cell.appendChild(el(`<span class="hc-size-val" data-size="${esc(sz.id)}">${esc(sz.taille ?? '') || '—'}</span>`));
      head.appendChild(cell);
    });
    head.appendChild(el(`<span class="hc hc-total" style="width:${pct(totalW)}">Total</span>`));

    const body = t.querySelector('.pdf-tbl-body');

    // ---- Ligne « Qté » : une case par taille, puis la somme
    const rowQte = el(`<div class="pdf-tbl-row pdf-row-qte"></div>`);
    rowQte.appendChild(el(`<span class="cell rlabel" style="width:${pct(labelW)}">Qté</span>`));
    const qtyEls = [];
    for (const sz of sizes) {
      // La quantité se saisit dans le rail, sur une ligne à hauteur de commande.
      // Ici elle s'AFFICHE, à la place et dans le corps où le PDF l'imprimera.
      const cQ = el(`<span class="cell qte" style="width:${pct(sizeW)};font-size:${fs}px">${esc(sz.quantite ?? '') || '—'}</span>`);
      cQ.dataset.size = sz.id;
      cQ.dataset.field = 'quantite';
      qtyEls.push(cQ);
      rowQte.appendChild(cQ);
    }
    const totalQty = el(`<span class="cell total" style="width:${pct(totalW)}"></span>`);
    rowQte.appendChild(totalQty);
    body.appendChild(rowQte);

    // ---- Une ligne par emplacement : intitulé éditable, puis une cote par taille
    for (const pl of placements) {
      pl.dims ??= {};
      const row = el(`<div class="pdf-tbl-row pdf-row-place"></div>`);
      const lab = el(`<span class="cell rlabel rlabel-place" style="width:${pct(labelW)}"></span>`);
      lab.appendChild(el(`<span class="hc-zone">${esc(faceLabels.get(pl.logoId) || '')}</span>`));
      const col = el(`<input type="text" class="pdf-in hc-color" data-place="${pl.id}" data-field="color" value="${esc(pl.color || '')}" placeholder="—">`);
      col.onchange = () => { pl.color = col.value; this.autosave(); this.refreshOtherPages(page()); };
      const nm = el(`<input type="text" class="pdf-in hc-name" data-place="${pl.id}" data-field="name" value="${esc(pl.name || '')}" placeholder="—">`);
      nm.onchange = () => { pl.name = nm.value; this.autosave(); this.refreshOtherPages(page()); };
      lab.append(col, el(`<span class="hc-sep">·</span>`), nm);
      if (!pl.logoId) {   // ligne détachée (logo retiré) → suppressible à la main
        const del = el(`<button class="pdf-row-del" title="Supprimer la ligne" aria-label="Supprimer la ligne">${ICON_X}</button>`);
        del.onclick = () => { const i = placements.indexOf(pl); if (i >= 0) placements.splice(i, 1); this.autosave(); this.renderPages(); };
        lab.appendChild(del);
      }
      row.appendChild(lab);
      for (const sz of sizes) {
        const wrap = el(`<span class="cell dim dimcell" style="width:${pct(sizeW)}"></span>`);
        const inp = el(`<input type="text" class="pdf-in cell dim" style="font-size:${fs}px" value="${esc(cmToMm(pl.dims[sz.id]))}" placeholder="—">`);
        inp.dataset.size = sz.id;
        inp.dataset.place = pl.id;
        inp.dataset.field = 'dim';
        inp.onchange = () => { pl.dims[sz.id] = mmToCm(inp.value); this.autosave(); this.refreshOtherPages(page()); };
        wrap.append(inp, el(`<b class="dim-unit">mm</b>`));
        row.appendChild(wrap);
      }
      // Sommer des cotes en millimètres n'a pas de sens : la case reste vide.
      row.appendChild(el(`<span class="cell total" style="width:${pct(totalW)}"></span>`));
      body.appendChild(row);
    }

    // Le total se lit sur les CASES AFFICHÉES, pas sur le modèle : c'est ce qui
    // garantit qu'il additionne exactement les colonnes que le lecteur voit —
    // et donc que la feuille ne peut pas annoncer un total qu'elle ne montre
    // pas. Les cases sont devenues du texte : on lit leur contenu, plus leur
    // `value` (qui vaut `undefined` sur un span, d'où un total resté à « — »).
    const updateTotal = () => {
      let sum = 0, any = false;
      for (const c of qtyEls) {
        const n = parseFloat(String(c.textContent).replace(',', '.'));
        if (Number.isFinite(n)) { sum += n; any = true; }
      }
      totalQty.textContent = any ? String(sum) : '—';
    };
    updateTotal();

    // AJOUTER, SYNCHRONISER, NETTOYER LA SÉRIE : c'est le rail qui le fait
    // désormais (renderSizeTools). Ces trois commandes vivaient sous le tableau,
    // à la taille du document — donc minuscules — et redoublaient une colonne
    // qui porte déjà toute la saisie.
    return t;
  }

  // Le tableau est répété sur chaque page : après édition sur une
  // page, resynchronise les autres (sans toucher la page en cours d'édition).
  refreshOtherPages(currentPage) {
    if (this.pagesHost.querySelectorAll('.bat-page').length > 1) this.renderPages();
  }

  // Mise à jour légère après un geste (redimensionner un logo) quand la
  // STRUCTURE de la grille n'a pas changé (mêmes tailles, mêmes colonnes) : on
  // repousse les valeurs auto-remplies (nom/couleur/dimensions) dans les champs
  // existants, on redessine les canvas et on reconstruit la carte — sans
  // reconstruire tout le DOM des pages (renderPages() → micro-freeze de fin de geste).
  refreshGridInPlace() {
    for (const table of this.pagesHost.querySelectorAll('.pdf-grid')) {
      const g = table._grid;
      if (!g) continue;
      const byId = new Map(g.placements.map(p => [p.id, p]));
      table.querySelectorAll('input.pdf-in[data-field]').forEach((inp) => {
        if (inp === document.activeElement) return;   // ne pas écraser la saisie en cours
        const { field, place, size } = inp.dataset;
        const pl = place ? byId.get(place) : null;
        if (field === 'dim' && pl) inp.value = cmToMm(pl.dims?.[size]);
        else if (field === 'color' && pl) inp.value = pl.color ?? '';
        else if (field === 'name' && pl) inp.value = pl.name ?? '';
      });
    }
    this.faceViews.forEach(v => v.draw());
    this.renderSide();
  }

  editMentions() {
    const ta = el(`<textarea class="champ" rows="11">${esc(store.settings.mentions)}</textarea>`);
    const body = el(`<div class="pile" style="min-width:560px">
      <div class="hint">Variables disponibles : {RAISON_SOCIALE}, {CAPITAL}, {SIRET}, {RCS}, {APE}, {TVA}, {ADRESSE}, {EMAIL}, {TELEPHONE}, {PORTABLE} — remplacées automatiquement sur le BAT.</div>
    </div>`);
    body.prepend(ta);
    const ok = el(`<button class="btn primaire">Enregistrer</button>`);
    const cancel = el(`<button class="btn secondaire">Annuler</button>`);
    const m = openModal({ title: 'Mentions légales du BAT', content: body, footButtons: [cancel, ok], width: '680px' });
    cancel.onclick = m.close;
    ok.onclick = async () => {
      store.settings.mentions = ta.value;
      await store.saveSettings();
      m.close();
      this.renderPages();
    };
  }

  async fillCompanyLogo(slot, c) {
    if (!c.logoFile) {
      slot.appendChild(el(`<div class="pdf-company-mark" title="Logo OLDA — remplaçable dans Administration">${oldaSvgMarkup()}</div>`));
      return;
    }
    try {
      const url = await this.companyLogoUrl(c);
      if (!url) throw new Error('logo introuvable');
      slot.appendChild(el(`<img src="${esc(url)}" alt="">`));
    } catch {
      slot.appendChild(el(`<div class="pdf-company-name">${esc(c.name || 'BAT Studio')}</div>`));
    }
  }

  // URL de l'aperçu du logo entreprise, mémorisée sur l'instance : sans ce
  // cache, chaque renderPages() re-téléchargeait le fichier ET créait un
  // ObjectURL jamais révoqué (fuite mémoire). Invalidée si le logo change.
  async companyLogoUrl(c) {
    const key = c.logoFile + '|' + (c.logoType || '');
    // Mémorise la PROMESSE en vol (pas seulement l'URL résolue) : deux
    // renderPages() concurrents (ex. cocher deux faces d'affilée) partagent le
    // même chargement au lieu que le second reçoive `null` (clé déjà posée,
    // URL pas encore prête) et bascule sur le repli texte.
    if (this._logoUrlKey === key && this._logoUrlPromise) return this._logoUrlPromise;
    if (this._logoUrlIsBlob && this._logoUrl) URL.revokeObjectURL(this._logoUrl);
    this._logoUrl = null; this._logoUrlIsBlob = false; this._logoUrlKey = key;
    this._logoUrlPromise = (async () => {
      const bytes = await window.batApi.dataRead('company/' + c.logoFile);
      if (!bytes) return null;
      const u8 = new Uint8Array(bytes);
      if (c.logoType === 'pdf') {
        const cv = await renderPdfLogoToCanvas(u8, 'company|' + c.logoFile, 600);
        this._logoUrl = cv.toDataURL();
      } else {
        this._logoUrl = URL.createObjectURL(new Blob([u8], {
          type: { png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml' }[c.logoType] || 'image/png',
        }));
        this._logoUrlIsBlob = true;
      }
      return this._logoUrl;
    })();
    return this._logoUrlPromise;
  }

  // -------------------------------------------------------------- logos I/O
  // Un fichier illisible (supprimé du disque, image tronquée) ne doit pas
  // empêcher la page de se dessiner : on renvoie null et draw() trace le cadre
  // du logo à la place — l'emplacement et ses cotes restent visibles et
  // modifiables, seul l'aperçu manque.
  async logoCanvas(logo) {
    const key = logo.logoFile + '|' + (logo.color || '');
    if (this.logoCanvases.has(key)) return this.logoCanvases.get(key);
    const type = logo.logoType || 'pdf';
    try {
      let bytes = this.logoBytes.get(logo.logoFile);
      if (!bytes) {
        const buf = await store.readLogoFile(logo.logoFile, type);
        if (!buf) throw new Error('fichier introuvable');
        bytes = new Uint8Array(buf);
        this.logoBytes.set(logo.logoFile, bytes);
      }
      const render = logo.color ? await recolorLogo(bytes, type, logo.color) : { bytes, type };
      const cv = await renderLogoToCanvas(render.bytes, render.type, key, 1000);
      this.logoCanvases.set(key, cv);
      return cv;
    } catch (e) {
      console.warn('Logo « ' + (logo.name || logo.logoFile) + ' » illisible :', e);
      // Échec mémorisé : sans cela chaque redessin retenterait la lecture et le
      // décodage d'un fichier qu'on sait cassé, à chaque geste sur la page.
      this.logoCanvases.set(key, null);
      return null;
    }
  }

  // Pose un logo à l'endroit exact cliqué sur le visuel (xPct/yPct). `zone`
  // (optionnel) = emplacement standard cliqué (pastille) : pré-remplit la
  // largeur réelle et le nom d'emplacement du logo posé. Sans zone, largeur
  // par défaut ~30 % de la largeur du mockup et nom laissé vide (« Placement
  // libre » dans le tableau, cf. syncGrid) — le clic en dehors des pastilles
  // reste toujours possible, autant de fois qu'on veut.
  async promptAddLogo(faceKey, xPct, yPct, zone = null) {
    const article = this.article;   // l'onglet peut changer pendant le dialogue
    const files = await window.batApi.dialogOpen({
      title: 'Choisir un logo ou une image',
      // « Tous les fichiers » en second : un fichier grisé dans le dialogue est
      // une impasse muette (rien n'explique pourquoi il est refusé), alors qu'un
      // fichier choisi est reniflé, décodé si possible, et sinon commenté.
      filters: [
        { name: 'Logo ou image', extensions: LOGO_EXTENSIONS },
        { name: 'Tous les fichiers', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (!files?.length) return;
    // Entre le choix du fichier et le logo posé : lecture, conversion
    // éventuelle (photo de 10 Mo, HEIC…), téléversement, analyse. Plusieurs
    // secondes possibles — sans signe de vie, « rien ne se passe » = raté.
    const busy = toast('Préparation du logo…', { ms: 0 });
    let asset, info, size, hash;
    try {
      const buf = await window.batApi.fsRead(files[0]);
      if (!buf) { toast('Fichier illisible.', { error: true }); return; }

      // Le PDF part tel quel (vectoriel) ; toute image est ramenée à un PNG ou
      // un JPEG embarquable dans le BAT (cf. logoasset.js).
      try {
        asset = await normalizeLogoFile(new Uint8Array(buf), files[0]);
        info = await analyzeLogo(asset.bytes, asset.type);
      } catch (e) { toast(e.message || 'Fichier illisible.', { error: true, ms: 8000 }); return; }
      for (const w of info.warnings) toast(w, { ms: 5000 });

      const bytes = asset.bytes;
      hash = hashBytes(bytes);
      await store.saveLogoFile(hash, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), asset.type);
      this.logoBytes.set(hash, bytes);
      size = await logoNaturalSize(bytes, asset.type);
    } finally { busy.dismiss(); }
    const fileName = files[0].split(/[\\/]/).pop().replace(/\.[^.]+$/, '');

    // Course : plusieurs await ci-dessus (dialogue, lecture, analyse) laissent
    // la page interactive. Si le produit/couleur a changé entre-temps, le cache
    // des visuels a été vidé (changeGarment) → revérifier avant d'utiliser vis.
    // L'onglet, lui, a pu changer ou être supprimé : le logo va sur l'article
    // qui était ouvert au clic, jamais sur celui affiché maintenant.
    if (!this.project.articles.includes(article)) return;
    const vis = this.visual(faceKey, article);
    if (!vis || !article.faces[faceKey]?.included) {
      toast('Face devenue indisponible — logo non ajouté.', { error: true });
      return;
    }
    if (article === this.article) this.pushHist();
    const defW = Math.min(10, (vis.width / vis.pxPerCm) * 0.3);
    const widthCm = Math.round((zone?.widthCm || defW) * 10) / 10;
    const logo = {
      id: uid(), logoFile: hash, logoType: asset.type, name: fileName,
      monochrome: info.monochrome, colors: info.colors, color: null,
      xPct, yPct,
      widthCm,
      heightCm: Math.round(widthCm * (size.height / size.width) * 10) / 10,
      aspect: size.height / size.width,
      rotation: 0, zoneName: zone?.name || '',
      technique: store.settings.techniques[0] || '',
    };
    article.faces[faceKey].logos.push(logo);
    if (article === this.article) {
      this.sel = { faceKey, id: logo.id };
      this.activeFace = faceKey;
    }
    this.afterLogoChange({ article });
  }

  deleteLogo(faceKey, id) {
    this.pushHist();
    const f = this.article.faces[faceKey];
    f.logos = f.logos.filter(l => l.id !== id);
    if (this.sel?.id === id) this.sel = null;
    this.afterLogoChange();
  }

  // Après tout changement de logos : marquages resynchronisés, pages
  // redessinées, panneau latéral et sauvegarde.
  async afterLogoChange({ article = this.article, structural = true } = {}) {
    syncGrid(article);
    for (const key of FACE_ORDER) {
      if (!article.faces[key]?.included) continue;
      for (const l of article.faces[key].logos) await this.logoCanvas(l);
    }
    if (article !== this.article) { this.renderTabs(); this.autosave(); return; }
    if (structural) this.renderPages();
    else this.faceViews.forEach(v => v.draw());
    this.renderTabs();
    this.renderFaces();
    this.renderSizeInputs();
    this.renderSide();
    this.autosave();
  }

  // ------------------------------------------------------------- historique
  // Pile propre à l'article ouvert (remise à zéro au changement d'onglet, cf.
  // setArticle) : annuler ne doit jamais toucher, à l'insu de l'utilisateur, un
  // article qu'il ne regarde pas.
  pushHist() {
    this.hist.undo.push(JSON.stringify(this.article.faces));
    if (this.hist.undo.length > 60) this.hist.undo.shift();
    this.hist.redo.length = 0;
  }
  undo() {
    if (!this.hist.undo.length) return;
    this.hist.redo.push(JSON.stringify(this.article.faces));
    this.article.faces = JSON.parse(this.hist.undo.pop());
    this.sel = null;
    this.afterLogoChange();
  }
  redo() {
    if (!this.hist.redo.length) return;
    this.hist.undo.push(JSON.stringify(this.article.faces));
    this.article.faces = JSON.parse(this.hist.redo.pop());
    this.sel = null;
    this.afterLogoChange();
  }

  onKey(e) {
    if (!this.project || app.screen !== 'bat') return;
    if (e.target.matches('input, textarea, select, [contenteditable]')) return;
    // Barre d'onglets : ← / → y naviguent entre articles (cf. renderTabs), ils
    // ne doivent pas déplacer le logo sélectionné de la page en dessous.
    if (e.target.closest?.('.bat-tabs')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); return; }
    // Zoom clavier. On intercepte AVANT le navigateur : Ctrl + « + » zoome la
    // feuille, pas l'interface — zoomer l'interface désaccorderait l'aperçu du
    // PDF de sa taille réelle, ce que l'écran promet justement de respecter.
    // « = » et « _ » : mêmes touches sans Maj sur AZERTY/QWERTY.
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '+' || e.key === '=') { e.preventDefault(); this.stepZoom(+1); return; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); this.stepZoom(-1); return; }
      if (e.key === '0') { e.preventDefault(); this.fitZoom(); return; }
    }
    const sel = this.selected();
    if (!sel) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteLogo(this.sel.faceKey, sel.id); return; }
    const step = e.shiftKey ? 1 : 0.2; // en % du mockup
    let dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    if (dx || dy) {
      e.preventDefault();
      // Annulable et borné comme le glisser souris (cf. drag 'move') : une frappe
      // = un pas d'historique ; clamp identique pour ne pas pousser le logo hors
      // du visuel (il serait coupé au clip).
      this.pushHist();
      sel.xPct = clamp(sel.xPct + dx, -20, 120);
      sel.yPct = clamp(sel.yPct + dy, -20, 120);
      this.afterLogoChange({ structural: false });
    }
  }

  // ---------------------------------------------------------- pastilles logo
  // Un logo sélectionné n'affiche RIEN d'autre qu'une rangée de pastilles de
  // couleur (uniquement si le logo est recolorable), ancrée à côté de lui. La
  // rotation se fait directement sur le logo à la souris (poignée de rotation,
  // cf. draw()). Le clic sur une pastille applique la couleur aussitôt.
  renderSide() {
    this.pagesHost.querySelector('.logo-swatches-float')?.remove();
    const sel = this.selected();
    if (!sel) return;
    const view = this.faceViews.find(v => v.faceKey === this.sel.faceKey);
    if (!view) return;
    // Logo non recolorable (multicolore) : aucune pastille, seule la rotation
    // directe reste disponible.
    if (!sel.monochrome) return;

    const float = el(`<div class="logo-swatches-float"><div class="swatches"></div></div>`);
    const sw = float.querySelector('.swatches');
    const orig = el(`<div class="sw ${!sel.color ? 'selected' : ''}" title="Couleur d'origine (${esc(sel.colors?.[0] || '#000')})"
      style="background:${esc(sel.colors?.[0] || '#000')}"></div>`);
    orig.onclick = () => this.applyColor(sel, null);
    sw.appendChild(orig);
    for (const cHex of PALETTE) {
      const b = el(`<div class="sw ${sel.color === cHex ? 'selected' : ''}" style="background:${cHex}" title="${cHex}"></div>`);
      b.onclick = () => this.applyColor(sel, cHex);
      sw.appendChild(b);
    }
    view.pageEl.appendChild(float);
    this.positionCard(float, view, sel);
  }

  // Ancre les pastilles à côté du logo (bascule gauche/droite, clampe
  // verticalement — voir anchorCardPosition).
  //
  // Les pastilles vivent DANS la feuille, donc dans son échelle : à 250 % elles
  // couvraient la moitié de l'écran, à 40 % elles devenaient invisibles. Une
  // contre-échelle les fige à leur taille physique — c'est un outil, pas un
  // élément du document. Le placement, lui, se calcule dans les unités de la
  // page : la taille utile de la carte y vaut donc sa taille CSS divisée par
  // l'échelle.
  positionCard(card, view, sel) {
    const s = this.scale();
    card.style.transformOrigin = 'top left';
    card.style.transform = `scale(${1 / s})`;
    const anchor = view.pageRect(sel);
    const size = { w: card.offsetWidth / s, h: card.offsetHeight / s };
    const { x, y } = anchorCardPosition(anchor, size, { x: 0, y: 0, w: PW, h: PH }, 10);
    card.style.left = x + 'px';
    card.style.top = y + 'px';
  }

  async applyColor(sel, color) {
    this.pushHist();
    sel.color = color;
    await this.logoCanvas(sel);
    this.afterLogoChange();
  }

  // Pendant un geste (déplacer/pivoter le logo), on masque les pastilles :
  // rien ne suit la manipulation directe. Elles reviennent au relâchement via
  // renderSide() (voir la fonction `end()` de FaceView.bindPointer).
  hideLogoFloat() {
    this.pagesHost.querySelector('.logo-swatches-float')?.remove();
  }

  // ------------------------------------------------------------- export PDF
  async exportPdf() {
    const p = this.project;
    if (!(p.client || '').trim() || !(p.name || '').trim()) {
      toast('Renseignez le client et le nom du projet en haut de la feuille avant d\'exporter.', { error: true, ms: 5000 });
      return;
    }
    // Le BAT couvre TOUTE la commande : un article sans face cochée sortirait
    // une page vide. On pointe l'onglet fautif plutôt que d'exporter à moitié.
    const naked = p.articles.find(a => !FACE_ORDER.some(k => a.faces[k]?.included));
    if (naked) {
      await this.setArticle(naked);
      toast(`Article ${p.articles.indexOf(naked) + 1} : cochez au moins une face (Cœur, Dos…).`, { error: true, ms: 5000 });
      return;
    }
    // CE QUI MANQUE SE DIT AVANT, PAS APRÈS. Le BAT est le document que le
    // client signe : partir avec l'échéance vide ou sans aucune quantité est
    // parfois voulu, jamais souhaitable par inadvertance. On énumère, on ne
    // bloque pas — et rien ne s'affiche quand tout est en ordre, pour ne pas
    // ajouter un clic au geste courant.
    const manques = manquesDuBat(p);
    if (manques.length) {
      const liste = manques.map(m => `<li>${esc(m)}</li>`).join('');
      const ok = await confirmListe('Exporter malgré tout ?', liste);
      if (!ok) return;
    }

    const btn = this.host.querySelector('#bat-export');
    const status = this.host.querySelector('#bat-status');
    btn.disabled = true;
    try {
      p.fiche.date = todayISO();   // date d'établissement = jour d'export (aperçu = PDF)
      for (const a of p.articles) syncGrid(a);

      // « Enregistrer sous » AVANT la génération : en web, le sélecteur de
      // fichier du navigateur n'ouvre que sur un clic encore « frais » (≈5 s),
      // délai que la composition du PDF dépasse largement — demandé après, il
      // serait refusé et le fichier tomberait d'office dans Téléchargements.
      // Le nom ne dépend que du client, de la date et du modèle : il est déjà
      // connu ici, avant même que le document existe.
      const target = await window.batApi.dialogSave({
        title: 'Exporter le BAT',
        defaultPath: projectFileName(p),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      await store.saveProject(p);   // date + grilles synchronisées, même si l'export est annulé
      if (!target) return;          // annulé : ni génération, ni archive

      // batpdf tire pdf-lib (511 Ko) et pako : ces 201 Ko sur le réseau ne
      // servent qu'ICI, à l'export. Importés en tête de module, ils étaient
      // téléchargés dès l'ouverture de l'écran BAT — c'est-à-dire au démarrage,
      // puisque l'application s'ouvre sur la feuille.
      // L'import vient APRÈS le sélecteur de fichier, et pas avant : celui-ci
      // n'ouvre que sur un clic encore frais (≈5 s), délai qu'un téléchargement
      // de 200 Ko en 4G peut dépasser à lui seul.
      // En pratique il est déjà là : le survol du bouton l'a lancé (cf. `load`).
      // ---- UNE VERSION = UN BAT ENVOYÉ, ET AUCUN N'EN ÉCRASE UN AUTRE.
      // Le nom d'un BAT est « client_date_modèle_version ». La version ne
      // bougeait qu'à la duplication : réexporter le même projet le même jour
      // refabriquait donc EXACTEMENT le même nom, l'entrée d'historique était
      // filtrée et le fichier réécrit. Le document déjà envoyé au client — celui
      // qu'il a peut-être signé — disparaissait sans un mot.
      // La règle est maintenant celle du métier : si la version courante a déjà
      // produit un BAT, celui qu'on fabrique est le suivant.
      p.history ??= [];
      const versionVoulue = prochaineVersion(p);
      if (versionVoulue !== p.fiche.version) {
        p.fiche.version = versionVoulue;
        app.updateTopbar();       // la pastille de la barre suit
        this.renderPages();       // la feuille porte la version
      }

      status.textContent = 'Préparation…';
      const { generateBAT } = await import('./batpdf.js');
      const res = await generateBAT(p, { onProgress: (m2) => { status.textContent = m2; } });
      status.textContent = '';

      // ---- Archive dans l'historique du projet. Ceinture ET bretelles : si un
      // nom se répétait malgré la version (historique vidé à la main, fichier
      // restauré d'une sauvegarde), on suffixe plutôt que d'écraser.
      const relDir = `bat/${p.id}/`;
      const nomArchive = nomArchiveLibre(p.history, res.fileName);
      await window.batApi.dataWrite(relDir + nomArchive, res.bytes.buffer.slice(res.bytes.byteOffset, res.bytes.byteOffset + res.bytes.byteLength));
      p.history.push({
        file: nomArchive, date: p.fiche.date, version: p.fiche.version, size: res.size,
        // Horodatage complet : deux BAT du même jour ne se distinguaient que par
        // leur ordre dans la liste.
        at: new Date().toISOString(),
      });
      await store.saveProject(p);

      // écriture à l'emplacement choisi par l'utilisateur
      await window.batApi.fsWrite(target, res.bytes.buffer.slice(res.bytes.byteOffset, res.bytes.byteOffset + res.bytes.byteLength));
      toast(`BAT exporté (${bytesHuman(res.size)}) : ${res.fileName}`);

      // ---- ET DANS LA FICHE DU CRM, s'il y en a une. Le PDF est déjà produit,
      // enregistré chez le client et archivé ici : le dépôt est un PLUS, jamais
      // une condition. Un CRM injoignable se dit, il ne transforme pas un export
      // réussi en échec — et le bouton « Redéposer » de l'historique rattrape.
      if (p.crmRequestId && await crmActif()) {
        status.textContent = 'Dépôt dans le CRM…';
        const dep = await deposerDansCrm(p.crmRequestId, res.bytes, nomArchive);
        status.textContent = '';
        toast(dep.message, { error: !dep.ok, ms: dep.ok ? 4000 : 8000 });
      }
    } catch (err) {
      console.error(err);
      toast('Génération impossible : ' + err.message, { error: true, ms: 7000 });
      status.textContent = '';
    } finally {
      btn.disabled = false;
    }
  }

  openHistory() {
    const p = this.project;
    // Deux BAT du même jour ne se distinguaient que par leur rang dans la
    // liste : quand l'horodatage est là (archives récentes), on l'affiche.
    const quandArchive = (h) => {
      const jour = frDate(String(h.date || '').slice(0, 10));
      const heure = String(h.at || '').slice(11, 16);
      return heure ? `${jour} ${heure}` : jour;
    };
    const body = el(`<div class="history-list" style="min-width:520px"></div>`);
    if (!(p.history || []).length) body.appendChild(el(`<div class="hint">Aucun BAT généré pour ce projet.</div>`));
    for (const h of [...(p.history || [])].reverse()) {
      const it = el(`<div class="history-item">
        <span class="pastille">v${h.version}</span>
        <span class="grow">${esc(h.file)}</span>
        <span class="sz">${bytesHuman(h.size)} · ${esc(quandArchive(h))}</span>
        <button class="btn secondaire serre" data-a="open">Ouvrir</button>
        <button class="btn secondaire serre" data-a="folder">Enregistrer</button>
        ${p.crmRequestId ? '<button class="btn secondaire serre" data-a="crm" title="Redéposer ce BAT dans la fiche du CRM">Vers le CRM</button>' : ''}
      </div>`);
      const abs = store.appInfo.dataDir + store.appInfo.sep + 'bat' + store.appInfo.sep + p.id + store.appInfo.sep + h.file;
      it.querySelector('[data-a=open]').onclick = () => window.batApi.openPath(abs);
      // Il n'y a pas de disque à révéler : on ré-enregistre l'archive où
      // l'utilisateur veut, via le même sélecteur que l'export (destination
      // demandée sur le clic, avant toute lecture — cf. exportPdf).
      it.querySelector('[data-a=folder]').onclick = async () => {
        const target = await window.batApi.dialogSave({
          title: 'Enregistrer le BAT',
          defaultPath: h.file,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (!target) return;
        const bytes = await window.batApi.dataRead(`bat/${p.id}/${h.file}`);
        if (!bytes) { toast('BAT introuvable dans l\'historique.', { error: true }); return; }
        await window.batApi.fsWrite(target, bytes);
        toast(`BAT enregistré : ${h.file}`);
      };

      // Redéposer dans la fiche : le CRM était injoignable au moment de
      // l'export, ou la fiche n'était pas encore associée. Le PDF archivé est
      // celui qui a été envoyé au client — c'est LUI qu'on redépose, pas un
      // document recomposé aujourd'hui, qui pourrait différer.
      const versCrm = it.querySelector('[data-a=crm]');
      if (versCrm) versCrm.onclick = async () => {
        versCrm.disabled = true;
        const bytes = await window.batApi.dataRead(`bat/${p.id}/${h.file}`);
        if (!bytes) { toast('BAT introuvable dans l\'historique.', { error: true }); versCrm.disabled = false; return; }
        const dep = await deposerDansCrm(p.crmRequestId, bytes, h.file);
        toast(dep.message, { error: !dep.ok, ms: dep.ok ? 4000 : 8000 });
        versCrm.disabled = false;
      };
      body.appendChild(it);
    }
    openModal({ title: 'Historique des BAT générés', content: body, width: '720px' });
  }
}

// ---------------------------------------------------------------------------
// FaceView : un visuel de face posé sur la page, avec manipulation directe
// des logos (déplacer, redimensionner, pivoter, magnétisme, sélection).
// Même géométrie que le PDF : mockup centré dans sa boîte, échelle en cm réels.
// ---------------------------------------------------------------------------
class FaceView {
  constructor(owner, faceKey, box, vis, pageEl, vTop) {
    this.o = owner;
    this.faceKey = faceKey;
    this.vis = vis;
    this.pageEl = pageEl;
    const zoneH = PH - vTop - V_BOTTOM;
    // box.h = hauteur commune imposée par faceLayout (alignement des visuels) ;
    // fallback zoneH par prudence. On centre verticalement dans la zone.
    const boxH = box.h || zoneH;
    const s = Math.min(box.w / vis.width, boxH / vis.height);
    this.mw = vis.width * s;   // taille du mockup sur la page (pt)
    this.mh = vis.height * s;
    this.mx = box.x + (box.w - this.mw) / 2;
    this.my = vTop + (zoneH - this.mh) / 2;

    // résolution de rendu : nette au zoom courant, bornée
    const R = clamp((window.devicePixelRatio || 1) * owner.scale() * 1.3, 1, 4);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pdf-face-canvas';
    this.canvas.width = Math.round(this.mw * R);
    this.canvas.height = Math.round(this.mh * R);
    this.canvas.style.cssText = `left:0;top:0;width:${this.mw}px;height:${this.mh}px`;
    // Cliquer le VÊTEMENT pose un logo à cet endroit (autant qu'on veut) ; le
    // curseur passe en « copie » au survol du textile pour l'indiquer.
    this.canvas.title = 'Cliquez sur le vêtement pour ajouter un logo';
    this.ctx = this.canvas.getContext('2d');
    // transformation : monde = pixels du bitmap mockup
    this.k = (this.mw * R) / vis.width;

    // Conteneur du mockup (position/dimension identiques au canvas).
    this.wrap = el(`<div class="pdf-face-wrap" style="left:${this.mx}px;top:${this.my}px;width:${this.mw}px;height:${this.mh}px"></div>`);
    this.wrap.appendChild(this.canvas);
    pageEl.appendChild(this.wrap);

    this.drag = null;
    this.guides = [];
    this.zoneLayer = null;
    this.bindPointer();
    this.draw();
    this.buildZoneDots();
  }

  logos() { return this.o.article.faces[this.faceKey].logos; }
  selectedHere() {
    const s = this.o.sel;
    return (s && s.faceKey === this.faceKey) ? this.logos().find(l => l.id === s.id) || null : null;
  }

  // pixels affichés par pixel monde (dépend du zoom CSS réel)
  dispScale() {
    const r = this.canvas.getBoundingClientRect();
    return r.width / this.vis.width;
  }
  toWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    return [
      (e.clientX - r.left) / r.width * this.vis.width,
      (e.clientY - r.top) / r.height * this.vis.height,
    ];
  }

  logoRect(l) {
    const w = l.widthCm * this.vis.pxPerCm;
    const h = l.heightCm * this.vis.pxPerCm;
    return { cx: (l.xPct / 100) * this.vis.width, cy: (l.yPct / 100) * this.vis.height, w, h, rot: l.rotation || 0 };
  }

  // Rectangle englobant (axis-aligned) d'un logo, en coordonnées PAGE (pt) —
  // sert à ancrer la carte flottante des propriétés. Même espace que le
  // canevas/les tableaux (1 pt = 1 px de page), indépendant du zoom CSS
  // appliqué à .bat-page : pas de recalcul nécessaire au changement de zoom,
  // seule la transformation CSS de la page change visuellement.
  pageRect(l) {
    const { cx, cy, w, h, rot } = this.logoRect(l);
    const a = deg2rad(rot);
    const cs = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
    const bw = w * cs + h * sn, bh = w * sn + h * cs;
    const scale = this.mw / this.vis.width;
    return {
      x: this.mx + (cx - bw / 2) * scale,
      y: this.my + (cy - bh / 2) * scale,
      w: bw * scale, h: bh * scale,
    };
  }

  hitLogo(wx, wy) {
    for (let i = this.logos().length - 1; i >= 0; i--) {
      const l = this.logos()[i];
      const { cx, cy, w, h, rot } = this.logoRect(l);
      const a = -deg2rad(rot);
      const dx = wx - cx, dy = wy - cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2) return l;
    }
    return null;
  }

  // Poignées en coordonnées monde (coins de redimensionnement + rotation au-dessus).
  handles(l) {
    const { cx, cy, w, h, rot } = this.logoRect(l);
    const a = deg2rad(rot);
    const c = Math.cos(a), s = Math.sin(a);
    const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    const corners = pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
    const d = h / 2 + 26 / this.dispScale();
    return { corners, rotate: [cx + d * Math.sin(a), cy - d * Math.cos(a)] };
  }

  // Rayon de capture des poignées (monde) : élargi au doigt.
  hitR() { return (COARSE ? 22 : HANDLE + 4) / this.dispScale(); }

  // Un seul redraw par frame (coalescence rAF) — le pointeur peut émettre bien
  // plus d'événements que 60/s ; garantit la fluidité du drag/resize.
  scheduleDraw() {
    if (this._rafId) return;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
    this._rafId = raf(() => { this._rafId = 0; this.draw(); });
  }

  bindPointer() {
    const cv = this.canvas;
    // Capture du pointeur : réservée aux gestes de manipulation (déplacer /
    // redimensionner / pivoter). On ne capture JAMAIS pour un simple clic qui
    // ouvre le sélecteur de fichier : le dialogue modal du système consomme le
    // `pointerup`, donc la capture ne serait jamais relâchée et tous les clics
    // suivants dérailleraient.
    const startDrag = (e, drag) => {
      this.drag = drag;
      try { cv.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    };
    cv.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return; // clic gauche uniquement
      this._tapAdd = null;   // un nouvel appui annule une pose de logo en attente
      this.o.activeFace = this.faceKey;
      const [wx, wy] = this.toWorld(e);
      const hitR = this.hitR();
      const sel = this.selectedHere();

      if (sel) {
        const H = this.handles(sel);
        if (Math.hypot(wx - H.rotate[0], wy - H.rotate[1]) < hitR) {
          // pushHist différé au 1er mouvement réel (comme le déplacement) : un
          // simple clic sur la poignée ne crée pas de cran d'undo vide.
          const { cx, cy } = this.logoRect(sel);
          startDrag(e, { mode: 'rotate', cx, cy, start0: Math.atan2(wy - cy, wx - cx), rot0: sel.rotation || 0, pushed: false });
          return;
        }
        for (let i = 0; i < 4; i++) {
          if (Math.hypot(wx - H.corners[i][0], wy - H.corners[i][1]) < hitR) {
            const { cx, cy } = this.logoRect(sel);
            startDrag(e, { mode: 'scale', cx, cy, d0: Math.hypot(wx - cx, wy - cy), w0: sel.widthCm, h0: sel.heightCm, pushed: false });
            return;
          }
        }
      }

      const hit = this.hitLogo(wx, wy);
      if (hit) {
        const changed = this.o.sel?.id !== hit.id;
        this.o.sel = { faceKey: this.faceKey, id: hit.id };
        // pushHist différé au 1er déplacement réel (pointermove) : un simple
        // clic de sélection ne doit pas créer un cran d'undo « no-op ».
        const { cx, cy } = this.logoRect(hit);
        startDrag(e, { mode: 'move', dx: wx - cx, dy: wy - cy, pushed: false });
        if (changed) { this.o.renderSide(); this.o.faceViews.forEach(v => v.draw()); }
        else this.draw();
      } else if (isOnGarment(this.vis, wx, wy)) {
        // Clic SUR LE VÊTEMENT (hors logo) = on pose un nouveau logo à cet
        // endroit exact (autant qu'on veut). Point clé du fix Windows : on n'a
        // PAS capturé le pointeur sur ce chemin (cf. startDrag), donc même si le
        // dialogue natif « avale » le pointerup, aucune capture à relâcher →
        // plus de blocage. Dialogue ouvert de façon synchrone (le sélecteur de
        // fichier web exige une activation utilisateur vivante).
        const xPct = clamp((wx / this.vis.width) * 100, 0, 100);
        const yPct = clamp((wy / this.vis.height) * 100, 0, 100);
        // Au DOIGT, on attend le relevé : un doigt posé sur le vêtement peut
        // encore devenir un pincement (zoom) ou un glissé de défilement. Ouvrir
        // le sélecteur de fichier dès l'appui rendait ces deux gestes
        // impraticables sur tablette. Toujours aucune capture de pointeur sur
        // ce chemin (cf. startDrag), et `pointerup` reste une activation
        // utilisateur valide pour ouvrir un dialogue de fichier.
        if (e.pointerType === 'touch') { this._tapAdd = { x: e.clientX, y: e.clientY, xPct, yPct }; return; }
        this.o.promptAddLogo(this.faceKey, xPct, yPct);
      } else if (this.o.sel) {
        // Clic à côté du vêtement (fond de la feuille) : simple désélection.
        // N'ouvre JAMAIS le sélecteur de fichier — ouvrir une fenêtre modale
        // native sur un clic à côté de la cible était le principal irritant.
        this.o.sel = null;
        this.o.renderSide();
        this.o.faceViews.forEach(v => v.draw());
      }
    });

    cv.addEventListener('pointermove', (e) => {
      const [wx, wy] = this.toWorld(e);
      const sel = this.selectedHere();
      if (!this.drag) {
        // Le curseur annonce ce que fera le clic : « copie » UNIQUEMENT sur le
        // vêtement (là où un clic pose un logo), flèche normale sur le fond.
        const onGarment = isOnGarment(this.vis, wx, wy);
        let cur = onGarment ? 'copy' : 'default';
        const hitR = this.hitR();
        const hit = this.hitLogo(wx, wy);
        if (sel) {
          const H = this.handles(sel);
          if (Math.hypot(wx - H.rotate[0], wy - H.rotate[1]) < hitR) cur = 'grab';
          else if (H.corners.some(c => Math.hypot(wx - c[0], wy - c[1]) < hitR)) cur = 'nwse-resize';
          else if (hit) cur = 'move';
        } else if (hit) cur = 'move';
        cv.style.cursor = cur;
        return;
      }
      if (!sel) return;
      // Un second doigt vient de se poser : le geste devient un pincement de
      // zoom (cf. bindZoomGestures). On abandonne la manipulation en cours —
      // le logo reste où il en était, l'historique le rend annulable.
      if (this.o._pinching) { this.drag = null; this.guides = []; return; }
      const d = this.drag;
      const vis = this.vis;

      if (d.mode === 'move') {
        if (!d.pushed) { this.o.pushHist(); d.pushed = true; }
        let cx = wx - d.dx, cy = wy - d.dy;
        this.guides = [];
        if (!e.altKey) {
          // Magnétisme au centre du visuel (axe vertical/horizontal) — repère
          // d'alignement bien utile ; maintenir Alt pour le désactiver.
          const snapT = SNAP / this.dispScale();
          if (Math.abs(cx - vis.width / 2) < snapT) { cx = vis.width / 2; this.guides.push({ v: cx }); }
          if (Math.abs(cy - vis.height / 2) < snapT) { cy = vis.height / 2; this.guides.push({ h: cy }); }
          // Magnétisme aux emplacements standard : entrer dans le rayon d'une
          // zone y accroche le logo ET reprend son nom — le geste qui pose un
          // logo à la main sur « Cœur » doit produire la même colonne que le
          // clic sur la pastille. Le nom reste ensuite, même si on ressort de
          // la zone : ce n'est pas un état de position, c'est un intitulé.
          const zones = store.settings.zones?.[this.o.product?.type]?.[this.faceKey] || [];
          for (const z of zones) {
            const zx = (z.xPct / 100) * vis.width, zy = (z.yPct / 100) * vis.height;
            if (Math.abs(cx - zx) < snapT && Math.abs(cy - zy) < snapT) {
              cx = zx; cy = zy; this.guides.push({ v: zx }, { h: zy });
              sel.zoneName = z.name;
            }
          }
        }
        sel.xPct = clamp((cx / vis.width) * 100, -20, 120);
        sel.yPct = clamp((cy / vis.height) * 100, -20, 120);
      }
      if (d.mode === 'scale') {
        if (!d.pushed) { this.o.pushHist(); d.pushed = true; }
        let f = clamp(Math.hypot(wx - d.cx, wy - d.cy) / (d.d0 || 1), 0.05, 40);
        // Plancher 0,5 cm appliqué au facteur (via la plus PETITE dimension) et
        // non à chaque côté séparément : préserve le ratio d'aspect — sinon un
        // logo très allongé se déforme aux petites tailles.
        f = Math.max(f, 0.5 / (Math.min(d.w0, d.h0) || 0.5));
        sel.widthCm = Math.round(d.w0 * f * 100) / 100;
        sel.heightCm = Math.round(d.h0 * f * 100) / 100;
      }
      if (d.mode === 'rotate') {
        if (!d.pushed) { this.o.pushHist(); d.pushed = true; }
        const ang = Math.atan2(wy - d.cy, wx - d.cx);
        let deg = d.rot0 + (ang - d.start0) * 180 / Math.PI;
        deg = ((deg % 360) + 360) % 360;
        if (!e.altKey) {
          for (const t of [0, 45, 90, 135, 180, 225, 270, 315, 360]) {
            if (Math.abs(deg - t) < 3) { deg = t % 360; break; }
          }
        }
        sel.rotation = Math.round(deg * 10) / 10;
      }
      if (!d._floatHidden) { this.o.hideLogoFloat(); d._floatHidden = true; }
      this.scheduleDraw();
    });

    const end = (e) => {
      // Pose de logo différée au doigt : elle n'a lieu que si le doigt s'est
      // relevé sur place et qu'aucun second doigt n'est venu zoomer.
      const tap = this._tapAdd;
      this._tapAdd = null;
      if (tap && e?.type === 'pointerup' && !this.o._pinching
          && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 12) {
        this.o.promptAddLogo(this.faceKey, tap.xPct, tap.yPct);
      }
      if (this.drag) {
        const mode = this.drag.mode;
        this.drag = null;
        this.guides = [];
        if (this._rafId) { (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout)(this._rafId); this._rafId = 0; }
        this.draw();
        // Signature de structure : nb de tailles + liste des colonnes. Si elle
        // change (hauteur/largeur de la grille), on reconstruit ; sinon mise à
        // jour légère en place → supprime le micro-freeze de fin de geste.
        const sig = (a) => `${(a.sizes || []).length}|${(a.placements || []).map(x => x.id).join(',')}`;
        const before = sig(this.o.article);
        syncGrid(this.o.article);
        const after = sig(this.o.article);
        this.o.autosave();
        if (after !== before) this.o.renderPages();
        else {
          this.o.refreshGridInPlace();
          // Un déplacement peut avoir fait entrer/sortir le logo d'une zone
          // (magnétisme, cf. pointermove) : la pastille de cette zone doit
          // apparaître ou disparaître en conséquence — renderPages() ne
          // tourne pas sur ce chemin léger, donc personne d'autre ne le fera.
          if (mode === 'move') this.refreshZoneDots();
        }
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  // Emplacements standard du produit (Cœur, Poitrine, Dos…) matérialisés par
  // des pastilles cliquables FIXES posées sur le mockup : un clic pose un logo
  // directement à cet emplacement (largeur + nom pré-remplis). Cibles stables
  // (aucune animation, aucun zoom au survol — cf. feuille.css) pour un clic
  // fiable à la souris. Repères ÉCRAN uniquement — le PDF est régénéré
  // indépendamment (batpdf.js) et ne les contient pas. Une zone déjà occupée
  // par un logo (même zoneName) est masquée. Tailles à l'échelle ÉCRAN (var --k
  // = 1/zoom) : constantes à l'œil quel que soit le zoom de page.
  buildZoneDots() {
    const zones = store.settings.zones?.[this.o.product?.type]?.[this.faceKey] || [];
    if (!zones.length) return;
    const used = new Set(this.logos().map(l => l.zoneName).filter(Boolean));

    const layer = el(`<div class="zone-layer"></div>`);
    layer.style.setProperty('--k', String(1 / (this.o.scale() || 1)));

    let n = 0;
    zones.forEach((z) => {
      if (used.has(z.name)) return;
      // Coordonnées LOCALES au conteneur (this.wrap est déjà positionné/dimensionné
      // sur le mockup — pas besoin d'ajouter mx/my ici).
      const x = (z.xPct / 100) * this.mw;
      const y = (z.yPct / 100) * this.mh;
      const sub = z.widthCm ? ` · ${fmt1(z.widthCm)} cm` : '';
      const dot = el(`<button type="button" class="zone-dot" style="left:${x}px;top:${y}px"
        aria-label="Ajouter un logo à l'emplacement ${esc(z.name)}${esc(sub)}">
        <span class="zone-dot__ring"></span>
        <span class="zone-dot__core"></span>
        <span class="zone-dot__label">${esc(z.name)}<em>${esc(sub)}</em></span>
      </button>`);
      // pointerdown stoppé sur la pastille : le canvas (dessous) ne le voit
      // jamais et ne démarre donc aucun geste de sélection/déplacement.
      dot.addEventListener('pointerdown', (e) => e.stopPropagation());
      dot.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.o.promptAddLogo(this.faceKey, z.xPct, z.yPct, z);
      });
      layer.appendChild(dot);
      n++;
    });
    if (n) { this.wrap.appendChild(layer); this.zoneLayer = layer; }
  }

  // Reconstruit les pastilles après un geste qui a pu changer l'ensemble des
  // zones occupées (glisser un logo dedans/dehors), sans reconstruire tout le
  // reste de la page.
  refreshZoneDots() {
    if (this.zoneLayer) { this.zoneLayer.remove(); this.zoneLayer = null; }
    this.buildZoneDots();
  }

  draw() {
    const ctx = this.ctx;
    const vis = this.vis;
    const k = this.k;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, vis.width, vis.height);
    ctx.imageSmoothingQuality = 'high';
    // `vis.bitmap` quand l'ouvrier a composé (le cas normal) : le dessiner
    // directement évite de repeindre un canvas intermédiaire à chaque rendu de
    // page — donc à chaque zoom, chaque redimensionnement, chaque bascule.
    ctx.drawImage(vis.bitmap || vis.canvas, 0, 0);

    // Pastilles d'emplacement (DOM) : estompées pendant qu'on manipule un logo
    // sur cette face, pour ne pas distraire.
    if (this.zoneLayer) this.zoneLayer.classList.toggle('is-dimmed', !!this.selectedHere());

    for (const l of this.logos()) {
      const cv = this.o.logoCanvases.get(l.logoFile + '|' + (l.color || ''));
      const { cx, cy, w, h, rot } = this.logoRect(l);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(deg2rad(rot));
      if (cv) ctx.drawImage(cv, -w / 2, -h / 2, w, h);
      else { ctx.strokeStyle = HEX.ACCENT; ctx.strokeRect(-w / 2, -h / 2, w, h); }
      ctx.restore();
    }

    // guides de magnétisme
    const ds = this.dispScale() || 1;
    ctx.save();
    ctx.strokeStyle = HEX.ACCENT;
    ctx.lineWidth = 1 / ds;
    ctx.setLineDash([6 / ds, 5 / ds]);
    for (const g of this.guides) {
      ctx.beginPath();
      if (g.v != null) { ctx.moveTo(g.v, 0); ctx.lineTo(g.v, vis.height); }
      if (g.h != null) { ctx.moveTo(0, g.h); ctx.lineTo(vis.width, g.h); }
      ctx.stroke();
    }
    ctx.restore();

    // sélection + poignées + cote cm
    const sel = this.selectedHere();
    if (!sel) return;
    const { cx, cy, w, h, rot } = this.logoRect(sel);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(deg2rad(rot));
    ctx.strokeStyle = HEX.ACCENT;
    ctx.lineWidth = 1.4 / ds;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(0, -h / 2 - 26 / ds);
    ctx.stroke();
    ctx.restore();

    const H = this.handles(sel);
    const hs = (COARSE ? 15 : HANDLE) / ds;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = HEX.ACCENT;
    ctx.lineWidth = 1.6 / ds;
    for (const [hx, hy] of H.corners) {
      ctx.beginPath(); ctx.rect(hx - hs / 2, hy - hs / 2, hs, hs); ctx.fill(); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(H.rotate[0], H.rotate[1], hs / 2 + 1.5 / ds, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}
