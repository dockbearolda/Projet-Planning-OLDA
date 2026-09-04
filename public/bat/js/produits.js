// Écran Produits : liste (cartes), import par référence TopTex, éditeur manuel.
import { store, defaultCalibration, productUsage, productProjects, refKey } from './store.js';
import { toast, openModal, confirmModal, el, menuActions } from './ui.js';
import { esc, uid, ICON_X, ICON_SEARCH, ICON_GARMENT } from './util.js';
import { mimeOf } from './mockup.js';
import { saveMockup, deriveSwatchHex } from './imgimport.js';
import { calibrationModal } from './reglages.js';
import { mountCalibrator } from './calibrator.js';
import { objectDefaults } from './producttype.js';
import { LOGO_EXTENSIONS } from './logoasset.js';
import { chemin } from './base.js';
import { chercherReference, planifierImport, executerImport } from './toptexref.js';

export async function renderProduits(host) {
  host.innerHTML = '';
  const wrap = el(`<div class="produits-wrap"></div>`);
  host.appendChild(wrap);

  // Barre d'actions : import réf TopTex + nouveau produit manuel
  const bar = el(`<div class="produits-bar">
    <div class="import-ref">
      <input class="champ" id="pr-ref" type="text" placeholder="Référence TopTex (NS333)" autocomplete="off">
      <button class="btn primaire" id="pr-import">Importer</button>
    </div>
    <button class="btn secondaire" id="pr-new">+ Nouveau produit (manuel)</button>
  </div>`);
  wrap.appendChild(bar);

  const grid = el(`<div class="produits-grid"></div>`);
  wrap.appendChild(grid);

  const rerender = () => renderProduits(host);

  bar.querySelector('#pr-import').onclick = () => importByRef(bar.querySelector('#pr-ref').value.trim(), rerender);
  bar.querySelector('#pr-ref').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') bar.querySelector('#pr-import').click();
  });
  bar.querySelector('#pr-new').onclick = () => openEditor(null, rerender);

  const products = store.catalogue.products;
  if (!products.length) {
    grid.appendChild(el(`<div class="hint" style="padding:24px">Aucun produit. Importez une référence TopTex ou créez-en un manuellement.</div>`));
    return;
  }

  // Doublons hérités : deux fiches pour une même référence fournisseur. Les
  // imports TopTex d'avant la fusion automatique en ont laissé ; on les répare
  // ici plutôt que de laisser deux vêtements identiques dans le sélecteur.
  wrap.insertBefore(buildDuplicateBanner(products, rerender), grid);

  // LA RECHERCHE. Trente-cinq fiches dans une grille à deux colonnes, c'est
  // dix-huit rangs à parcourir pour en retrouver une. Le champ est CELUI de
  // l'écran Projets — même composant, même place, même compteur : les deux
  // écrans sont à un clic l'un de l'autre.
  const outils = el(`<div class="liste-outils">
    <label class="champ-recherche">
      ${ICON_SEARCH}
      <input type="search" id="pd-q" autocomplete="off" spellcheck="false"
             placeholder="Rechercher un produit ou une référence…"
             aria-label="Rechercher un produit">
    </label>
    <span class="lo-compte" id="pd-compte" role="status" aria-live="polite"></span>
  </div>`);
  wrap.insertBefore(outils, grid);
  const champ = outils.querySelector('#pd-q');
  const compte = outils.querySelector('#pd-compte');
  champ.addEventListener('input', () => peupler(champ.value));

  const clefRecherche = (p) => [p.name, p.refSupplier, p.refInternal, p.type, p.category]
    .filter(Boolean).join(' ').toLowerCase();

  const peupler = (requete) => {
    const q = requete.trim().toLowerCase();
    const vus = q ? products.filter(p => clefRecherche(p).includes(q)) : products;
    grid.replaceChildren(...vus.map(p => carteProduit(p, rerender)));
    compte.textContent = q
      ? `${vus.length} sur ${products.length}`
      : `${products.length} produit${products.length > 1 ? 's' : ''}`;
    if (!vus.length) grid.appendChild(el(`<div class="liste-vide">Aucun produit ne correspond à « ${esc(requete.trim())} ».</div>`));
  };
  peupler('');
}

// ---------------------------------------------------------------------------
// UNE FICHE PRODUIT
// ---------------------------------------------------------------------------
// MÊME carte qu'un projet, au caractère près : une vignette de vêtement, un nom,
// une ligne de méta. Les deux écrans sont à un clic l'un de l'autre — deux
// composants qui se ressemblent s'y lisent comme un défaut, et divergent à la
// première retouche.
//
// LA CARTE OUVRE LA FICHE, comme la ligne ouvre le projet. Les quatre boutons
// d'avant faisaient cent quarante commandes de même poids sur un écran de
// trente-cinq produits, dont trente-cinq « Supprimer » aussi visibles que
// « Modifier ». Ce qui reste se range derrière les trois points.
function carteProduit(p, rerender) {
  const card = el(`<div class="carte-objet produit-card" tabindex="0" role="button"
       title="Modifier « ${esc(p.name)} »">
    <div class="pc-body">
      <div class="pc-thumb">${ICON_GARMENT}</div>
      <div class="pc-text">
        <div class="pc-titleline">
          <h3>${esc(p.name)}</h3>
          ${p.sized === false && !p.calibrated ? '<span class="pastille cours pc-more">à calibrer</span>' : ''}
        </div>
        <div class="pc-meta">${esc(p.refSupplier || p.refInternal || '—')} · ${esc(p.type)} · ${p.colors.length} couleur${p.colors.length > 1 ? 's' : ''}</div>
      </div>
      <span class="pc-menu"></span>
    </div>
  </div>`);

  // vignette : 1re vue front dispo. La silhouette tient la place en attendant,
  // et RESTE si le produit n'a pas d'image — un carré gris vide, au milieu
  // d'une grille de photos, se lit comme une image cassée.
  const firstView = p.colors.map(c => c.views?.front?.thumb).find(Boolean);
  if (firstView) {
    store.readCatalogueFile(firstView).then(buf => {
      if (!buf) return;
      const url = URL.createObjectURL(new Blob([new Uint8Array(buf)], { type: mimeOf(firstView) }));
      const im = new Image();
      im.onload = () => URL.revokeObjectURL(url);
      im.src = url;
      card.querySelector('.pc-thumb').replaceChildren(im);
    });
  }

  const ouvrir = () => openEditor(p, rerender);
  // Le menu vit DANS la carte : ouvrir le menu n'ouvre pas la fiche.
  card.addEventListener('click', (e) => { if (!e.target.closest('.menu-actions')) ouvrir(); });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrir(); }
  });

  card.querySelector('.pc-menu').appendChild(menuActions([
    { label: 'Modifier', onClick: ouvrir },
    // L'échelle des vues arrière et côté n'a pas sa place dans la modale de
    // création (qui ne calibre que l'avant) : elle vit ici, sur la fiche.
    { label: 'Calibrer', onClick: async () => { await calibrationModal(p); rerender(); } },
    {
      label: 'Dupliquer',
      onClick: async () => {
        const copy = JSON.parse(JSON.stringify(p));
        copy.id = 'custom-' + uid();
        copy.name = p.name + ' (copie)';
        store.catalogue.products.push(copy);
        await store.saveCatalogue();
        rerender();
      },
    },
    {
      label: 'Supprimer',
      danger: true,
      onClick: async () => {
        if (!await confirmModal('Supprimer le produit', `Retirer « ${p.name} » du catalogue ? Les projets existants qui l'utilisent ne pourront plus générer de BAT.`, { danger: true, okLabel: 'Retirer' })) return;
        store.catalogue.products = store.catalogue.products.filter(x => x !== p);
        await store.saveCatalogue();
        // LES IMAGES PARTENT AVEC LA FICHE. Chaque coloris importé a écrit trois
        // fichiers ; personne ne les retirait jamais. Mesuré avant correction :
        // 402 fichiers orphelins sur 438. Le catalogue est enregistré D'ABORD —
        // si la suppression des images échoue, la fiche est quand même partie et
        // le ménage de Réglages › Données rattrapera le reste.
        try { await window.batApi.dataDelete('mockups-custom/' + p.id); } catch { /* rien à retirer */ }
        rerender();
      },
    },
  ], { label: `Autres actions — ${p.name}` }));

  return card;
}

// ---------------------------------------------------------------------------
// Doublons de référence
// ---------------------------------------------------------------------------

// Le « principal » d'un groupe est la fiche qu'on garde : celle dont des BAT
// dépendent d'abord, sinon celle du catalogue OLDA (elle porte la référence
// interne, clé de la grille de tailles), sinon la plus fournie en coloris.
function pickPrincipal(group) {
  return [...group].sort((a, b) =>
    productUsage(b.id) - productUsage(a.id)
    || (b.refInternal ? 1 : 0) - (a.refInternal ? 1 : 0)
    || b.colors.length - a.colors.length)[0];
}

function buildDuplicateBanner(products, done) {
  const groups = new Map();
  for (const p of products) {
    const k = refKey(p.refSupplier);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const host = el(`<div class="dup-banners"></div>`);
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    const principal = pickPrincipal(group);
    const autres = group.filter(p => p !== principal);
    const bloques = autres.filter(p => productUsage(p.id) > 0);

    const banner = el(`<div class="dup-banner">
      <div class="dup-text">
        <b>Réf. ${esc(principal.refSupplier)} en double</b> — ${group.length} fiches pour le même vêtement :
        ${group.map(p => `« ${esc(p.name)} » (${p.colors.length} couleurs)`).join(' et ')}.
        <div class="hint">Les coloris manquants sont repris dans « ${esc(principal.name)} », les autres fiches sont retirées du catalogue.</div>
      </div>
    </div>`);
    const btn = el(`<button class="btn primaire serre">Fusionner dans « ${esc(principal.name)} »</button>`);
    banner.appendChild(btn);

    if (bloques.length) {
      // Retirer une fiche utilisée casserait la génération des BAT concernés :
      // on ne le fait pas dans le dos de l'utilisateur. On nomme les projets à
      // reprendre — sans ça, « sert encore dans des projets » laisse chercher.
      const projets = [...new Set(bloques.flatMap(p => productProjects(p.id)))];
      btn.disabled = true;
      btn.title = 'Fiche encore utilisée par : ' + projets.join(' · ');
      banner.querySelector('.hint').textContent =
        `Fusion en attente : ${projets.length > 1 ? 'ces projets utilisent' : 'ce projet utilise'} encore la fiche en trop — ${projets.map(t => `« ${t} »`).join(', ')}. `
        + `Ouvrez-${projets.length > 1 ? 'les' : 'le'}, choisissez « ${principal.name} » comme vêtement, puis revenez ici.`;
    } else {
      btn.onclick = async () => {
        const repris = autres.flatMap(p => p.colors.filter(c => !principal.colors.some(x => x.slug === c.slug)));
        const plur = autres.length > 1;
        const noms = autres.map(p => `« ${p.name} »`).join(', ');
        const ok = await confirmModal('Fusionner les doublons',
          (repris.length
            ? `${repris.length} coloris manquants repris dans « ${principal.name} » (${principal.colors.length} → ${principal.colors.length + repris.length} couleurs), puis ${noms} `
            : `« ${principal.name} » a déjà tous les coloris : ${noms} ${plur ? 'sont' : 'est'} simplement `)
          + `${plur ? 'retirées' : 'retirée'} du catalogue. Aucun projet n'utilise ${plur ? 'ces fiches' : 'cette fiche'}.`,
          { okLabel: 'Fusionner' });
        if (!ok) return;
        // Les images des coloris repris restent où elles sont (mockups-custom
        // de la fiche d'origine) : leurs chemins sont recopiés tels quels, donc
        // rien à re-télécharger et aucun visuel cassé.
        principal.colors.push(...repris);
        store.catalogue.products = store.catalogue.products.filter(p => !autres.includes(p));
        await store.saveCatalogue();
        toast(`Fusion faite : « ${principal.name} » a ${principal.colors.length} couleurs.`);
        done?.();
      };
    }
    host.appendChild(banner);
  }
  return host;
}

// Éditeur produit manuel. product=null → création. Une couleur = avant + arrière.
function openEditor(product, done) {
  const creating = !product;
  const p = product || {
    id: 'custom-' + uid(), name: '', refInternal: '', refSupplier: '',
    category: 'PERSONNALISÉ', type: 'T-shirt', sleeveType: 'short', colors: [],
    calibration: {
      front: defaultCalibration('T-shirt', 'front'),
      back: defaultCalibration('T-shirt', 'back'),
      sleeve: defaultCalibration('T-shirt', 'sleeve'),
    },
  };

  const body = el(`<div class="editor" tabindex="0" style="min-width:640px;max-height:70vh;overflow:auto">
    <div class="admin-grid2">
      <div class="field"><label>Nom</label><input class="champ" id="e-name" type="text" value="${esc(p.name)}" placeholder="Ex. T-shirt col rond"></div>
      <div class="field"><label>Référence</label><input class="champ" id="e-ref" type="text" value="${esc(p.refSupplier)}"></div>
      <div class="field"><label>Type</label>
        <input class="champ" id="e-type" type="text" list="e-type-list" value="${esc(p.type)}" placeholder="T-shirt, Mug, Gourde…" autocomplete="off">
        <datalist id="e-type-list">${store.settings.productTypes.map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist>
      </div>
    </div>
    <label class="e-objet"><input type="checkbox" id="e-sized"> <span>Objet sans taille (mug, gourde…) — le BAT ne demande qu'une quantité</span></label>
    <div class="hint" style="margin:10px 0">Cliquez une case pour choisir la photo sur votre ordinateur — ou glissez-la, collez-la (Cmd/Ctrl+V), ou collez une URL d'image. La pastille se déduit de la photo avant.</div>
    <div class="colors-list" id="e-colors"></div>
    <button class="btn secondaire serre" id="e-addcolor">+ Ajouter une couleur</button>
    <div class="e-calib" id="e-calib" hidden>
      <h3 class="section">Échelle</h3>
      <div class="hint">Posez les deux repères sur les bords de l'objet, puis donnez sa largeur réelle. Sans ça, les cotes du BAT sont fausses.</div>
      <div id="e-calib-host"></div>
    </div>
  </div>`);

  let calibUrl = null;   // ObjectURL de l'aperçu de calibration (révoqué à la fermeture)

  const ok = el(`<button class="btn primaire">${creating ? 'Créer' : 'Enregistrer'}</button>`);
  const cancel = el(`<button class="btn secondaire">Annuler</button>`);
  const m = openModal({
    title: creating ? 'Nouveau produit' : `Modifier ${p.name}`, content: body,
    footButtons: [cancel, ok], width: '760px',
    onClose: () => { if (calibUrl) URL.revokeObjectURL(calibUrl); },
  });
  cancel.onclick = m.close;

  const colorsHost = body.querySelector('#e-colors');
  // Branché par la calibration inline ; déclaré ici pour que le gestionnaire
  // de type puisse l'appeler sans ReferenceError.
  let onTypeChanged = null;

  // Vêtements à tailles : tout le reste (mug, gourde, pochette, « Autre »…)
  // est un objet par défaut. La pré-coche suit le type TANT QUE l'utilisateur
  // n'a pas touché la case — après quoi son choix prime.
  const GARMENTS = ['t-shirt', 'sweat', 'polo', 'débardeur', 'debardeur'];
  const isGarment = (t) => GARMENTS.includes(String(t || '').trim().toLowerCase());
  const sizedBox = body.querySelector('#e-sized');
  let sizedTouched = !creating;   // produit existant : on respecte sa valeur
  sizedBox.checked = creating ? !isGarment(p.type) : p.sized === false;
  sizedBox.onchange = () => { sizedTouched = true; };

  const typeInput = body.querySelector('#e-type');
  typeInput.oninput = () => {
    p.type = typeInput.value.trim();
    if (!sizedTouched) sizedBox.checked = !isGarment(p.type);
    onTypeChanged?.();
  };

  const ensureColor = () => {
    const slug = 'c' + uid();
    const c = { slug, label: '', hex: '#ffffff', views: {} };
    p.colors.push(c);
    return c;
  };

  // pose une image (Uint8Array + ext) dans (color, view)
  const applyImage = async (color, view, bytes, ext) => {
    color.views[view] = await saveMockup(p.id, color.slug, view, bytes, ext);
    if (view === 'front') {
      const hex = await deriveSwatchHex(bytes, ext);
      if (hex) color.hex = hex;
    }
    renderColors();
    if (view === 'front') refreshCalib();
  };

  // récupère les octets d'une URL d'image via le proxy serveur
  const fetchUrlBytes = async (url) => {
    const r = await fetch(chemin('/api/fetch-image?url=') + encodeURIComponent(url));
    if (!r.ok) throw new Error('URL refusée');
    const ct = r.headers.get('content-type') || '';
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
    return { bytes: new Uint8Array(await r.arrayBuffer()), ext };
  };

  // Ouvre le sélecteur de fichiers du système et pose l'image choisie dans la
  // case. Le filtre est LARGE et doublé de « Tous les fichiers » : le format
  // réel se lit dans les octets, pas dans l'extension (cf. normalizeImageBytes),
  // et un fichier grisé dans le dialogue est une impasse muette.
  const pickImageInto = async (color, view) => {
    const files = await window.batApi.dialogOpen({
      title: view === 'front' ? 'Photo avant' : 'Photo arrière',
      filters: [
        { name: 'Image', extensions: LOGO_EXTENSIONS },
        { name: 'Tous les fichiers', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (!files?.length) return;                     // annulé : la case reste sélectionnée
    const buf = await window.batApi.fsRead(files[0]);
    if (!buf) { toast('Fichier illisible.', { error: true }); return; }
    try {
      await applyImage(color, view, buf, files[0].split('.').pop().toLowerCase());
    } catch (e) {
      toast(e.message || 'Image illisible.', { error: true });
    }
  };

  let focusedSlot = null;
  const slotHandlers = (slotEl, color, view) => {
    slotEl.addEventListener('dragover', (e) => { e.preventDefault(); slotEl.classList.add('drag'); });
    slotEl.addEventListener('dragleave', () => slotEl.classList.remove('drag'));
    slotEl.addEventListener('drop', async (e) => {
      e.preventDefault(); slotEl.classList.remove('drag');
      const f = e.dataTransfer.files?.[0];
      if (f) { const ext = f.name.split('.').pop().toLowerCase(); await applyImage(color, view, await f.arrayBuffer(), ext); return; }
      const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (url) { try { const { bytes, ext } = await fetchUrlBytes(url); await applyImage(color, view, bytes, ext); } catch { toast('Image URL illisible.', { error: true }); } }
    });
    // Un clic sur la case va chercher la photo sur le disque — le geste que
    // tout le monde essaie en premier. La case reste sélectionnée si le
    // dialogue est annulé, pour qu'un Cmd+V juste après atterrisse au bon
    // endroit.
    slotEl.onclick = async () => {
      focusedSlot = { color, view };
      slotEl.focus();
      await pickImageInto(color, view);
    };
  };

  const renderColors = () => {
    colorsHost.innerHTML = '';
    for (const c of p.colors) {
      const row = el(`<div class="color-row">
        <span class="cr-swatch" style="background:${esc(c.hex)}"></span>
        <input class="champ cr-name" type="text" value="${esc(c.label)}" placeholder="Couleur">
        <button class="slot" data-view="front" tabindex="0">${c.views.front ? 'Avant ✓' : 'Avant'}</button>
        <button class="slot" data-view="back" tabindex="0">${c.views.back ? 'Arrière ✓' : 'Arrière'}</button>
        <button class="cr-del" aria-label="Supprimer la couleur">${ICON_X}</button>
      </div>`);
      row.querySelector('.cr-name').onchange = (e) => { c.label = e.target.value; };
      row.querySelectorAll('.slot').forEach(s => slotHandlers(s, c, s.dataset.view));
      row.querySelector('.cr-del').onclick = () => { p.colors = p.colors.filter(x => x !== c); renderColors(); };
      colorsHost.appendChild(row);
    }
  };
  renderColors();

  // Calibration inline : montée dès qu'une vue avant est posée, pré-remplie
  // selon le type. Elle vit dans la modale de création pour que le produit
  // soit utilisable IMMÉDIATEMENT — un mug calibré à 53 cm donne des cotes
  // fausses sans rien signaler.
  const calibBox = body.querySelector('#e-calib');
  const calibHost = body.querySelector('#e-calib-host');
  const calib = mountCalibrator(calibHost, {});
  // Deux notions distinctes, à ne pas confondre :
  // - `calibSuitType` : l'échelle se recale sur le type à chaque changement.
  //   Vrai tant qu'on crée sans y avoir touché ; un produit existant garde la
  //   sienne dès l'ouverture.
  // - `calibPoseeMain` : quelqu'un a vraiment posé les repères. C'est LUI qui
  //   décide du badge « à calibrer » — accepter le défaut d'un type ne vaut
  //   pas calibration, la photo n'a été regardée par personne.
  let calibSuitType = creating;
  let calibPoseeMain = false;

  const calFor = (type) => objectDefaults(type) || defaultCalibration(type || 'Autre', 'front');

  async function refreshCalib() {
    const front = p.colors.map(c => c.views?.front?.full).find(Boolean);
    calibBox.hidden = !front;
    if (!front) return;
    const buf = await store.readCatalogueFile(front);
    if (!buf) { calibBox.hidden = true; return; }
    if (calibUrl) URL.revokeObjectURL(calibUrl);
    calibUrl = URL.createObjectURL(new Blob([new Uint8Array(buf)], { type: mimeOf(front) }));
    // Un produit neuf est pré-amorcé avec la calibration d'un T-shirt : tant
    // qu'on n'a pas touché aux repères, c'est le TYPE qui décide, sinon un mug
    // s'ouvrirait à 53 cm. Un produit existant, lui, garde la sienne.
    const c0 = calibSuitType ? calFor(p.type) : (p.calibration?.front || calFor(p.type));
    if (!await calib.setImage(calibUrl, c0)) calibBox.hidden = true;
  }

  // Changer de type re-pré-remplit l'échelle, tant que l'utilisateur n'y a pas
  // touché : passer de « Mug » à « Gourde » doit suivre.
  onTypeChanged = () => { if (calibSuitType) calib.setValues(calFor(p.type)); };
  const calibMain = () => { calibSuitType = false; calibPoseeMain = true; };
  calibHost.addEventListener('pointerdown', calibMain, true);
  calibHost.addEventListener('input', calibMain, true);

  refreshCalib();

  body.querySelector('#e-addcolor').onclick = () => { ensureColor(); renderColors(); };

  function firstEmptySlot() {
    for (const c of p.colors) {
      if (!c.views.front) return { color: c, view: 'front' };
      if (!c.views.back) return { color: c, view: 'back' };
    }
    // aucune couleur / toutes remplies → crée une couleur
    const c = ensureColor(); renderColors();
    return { color: c, view: 'front' };
  }

  // Coller (image du presse-papier → slot focus, sinon 1er slot vide) ou URL
  body.addEventListener('paste', async (e) => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    const target = focusedSlot || firstEmptySlot();
    if (!target) return;
    if (item) {
      e.preventDefault();
      const f = item.getAsFile();
      const ext = f.type.includes('png') ? 'png' : f.type.includes('webp') ? 'webp' : 'jpg';
      await applyImage(target.color, target.view, await f.arrayBuffer(), ext);
    } else {
      const txt = e.clipboardData?.getData('text');
      if (txt && /^https?:\/\//.test(txt.trim())) {
        e.preventDefault();
        try { const { bytes, ext } = await fetchUrlBytes(txt.trim()); await applyImage(target.color, target.view, bytes, ext); }
        catch { toast('Image URL illisible.', { error: true }); }
      }
    }
  });

  ok.onclick = async () => {
    p.name = body.querySelector('#e-name').value.trim();
    p.refSupplier = body.querySelector('#e-ref').value.trim();
    p.type = typeInput.value.trim() || 'Autre';
    if (!p.name) { toast('Le nom est requis.', { error: true }); return; }
    // `sized` n'est écrit que quand il vaut false : son ABSENCE est la valeur
    // par défaut « produit à tailles », et c'est elle qui dispense de migrer
    // les produits déjà au catalogue.
    if (sizedBox.checked) p.sized = false; else delete p.sized;
    // Un type saisi à la main rejoint la liste : plus besoin d'un aller-retour
    // par Réglages pour créer un mug.
    if (p.type && !store.settings.productTypes.includes(p.type)) {
      store.settings.productTypes.push(p.type);
      await store.saveSettings();
    }
    // Un objet n'a ni manches ni côtés : pas de vue « sleeve » à emprunter.
    p.sleeveType = (sizedBox.checked || p.type === 'Pochette' || p.type === 'Tote bag') ? 'none' : 'short';
    // slugs uniques + labels par défaut
    p.colors.forEach((c, i) => { if (!c.label) c.label = 'Couleur ' + (i + 1); });
    // Calibration : la saisie prime, sinon le défaut du type. On ne bloque
    // JAMAIS la création là-dessus — un produit à moitié fait vaut mieux
    // qu'une modale qui refuse de se fermer, et la carte portera le badge
    // « à calibrer ».
    if (!calibBox.hidden) {
      const res = calib.read();
      p.calibration ??= {};
      // Sur un produit neuf, TOUTES les vues suivent le type retenu : le
      // pré-amorçage T-shirt de la fiche vierge ne doit pas survivre à un mug,
      // sinon une photo d'arrière ajoutée plus tard hériterait de 53 cm.
      if (creating) {
        p.calibration.back = calFor(p.type);
        p.calibration.sleeve = defaultCalibration(p.type, 'sleeve');
      }
      p.calibration.front = res || calFor(p.type);
      // Le badge tombe seulement quand les repères ont été posés à la main.
      // Un produit déjà calibré le reste.
      if (res && calibPoseeMain) p.calibrated = true;
      else if (creating) delete p.calibrated;
    }
    if (creating) store.catalogue.products.push(p);
    await store.saveCatalogue();
    m.close();
    done?.();
  };
}

// Slug de coloris : même règle à l'import TopTex et dans le catalogue de base,
// c'est ce qui permet de reconnaître un coloris déjà présent lors d'un
// ré-import (« Adriatic Blue » → adriatic_blue des deux côtés). Il vit
// désormais avec le reste du pipeline, dans toptexref.js.

const VIEW_LABEL = { front: 'Av', back: 'Ar', sleeve: 'Cô' };

// Import par référence TopTex : appelle le serveur, montre une confirmation,
// télécharge les packshots (via le proxy) et crée le produit — ou COMPLÈTE
// celui qui porte déjà cette référence. Ré-importer pour récupérer les
// nouveaux coloris ne doit pas laisser deux fiches pour le même vêtement.
async function importByRef(ref, done) {
  if (!ref) { toast('Entrez une référence.', { error: true }); return; }
  let norm;
  const loading = openModal({ title: 'Import TopTex', content: el(`<div class="pad">Recherche de « ${esc(ref)} »…</div>`), footButtons: [] });
  try {
    norm = await chercherReference(ref);
  } catch (e) {
    loading.close();
    toast('Import : ' + e.message, { error: true });
    return;
  }
  loading.close();

  const { existing, plan, nouveaux, completes, aJour, rienAFaire } = planifierImport(norm);

  // Écran de confirmation
  const body = el(`<div class="import-confirm" style="min-width:640px;max-height:70vh;overflow:auto">
    <div class="admin-grid2">
      <div class="field"><label>Nom</label><input class="champ" id="ic-name" type="text" value="${esc(existing ? existing.name : norm.name)}"></div>
      <div class="field"><label>Type</label><select class="champ" id="ic-type">${store.settings.productTypes.map(t => `<option ${t === (existing?.type ?? norm.type) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
    </div>
    <div class="hint" style="margin:10px 0">${existing
      ? `« ${esc(existing.name)} » porte déjà la réf ${esc(norm.ref)} : le produit est <b>complété</b>, pas dupliqué.
         ${nouveaux.length} nouveau${nouveaux.length > 1 ? 'x' : ''} coloris · ${completes.length} à compléter · ${aJour} déjà à jour.
         Calibration, référence interne et projets existants ne bougent pas.`
      : `${norm.colors.length} couleur(s) — ${esc(norm.brand)} · réf ${esc(norm.ref)}. Avant / Arrière / Côté récupérés automatiquement.`}</div>
    ${existing ? `<label class="ic-refresh rang" style="margin-bottom:10px">
      <input type="checkbox" id="ic-refresh"> <span>Re-télécharger aussi les images déjà présentes</span>
    </label>` : ''}
    <div class="ic-grid" id="ic-colors"></div>
  </div>`);
  const ok = el(`<button class="btn primaire">${existing ? 'Compléter le produit' : 'Créer le produit'}</button>`);
  const cancel = el(`<button class="btn secondaire">Annuler</button>`);
  const m = openModal({
    title: existing ? `Compléter ${esc(existing.name)}` : `Importer ${esc(norm.ref)}`,
    content: body, footButtons: [cancel, ok], width: '780px',
  });
  cancel.onclick = m.close;

  const refresh = body.querySelector('#ic-refresh');
  // Rien à ajouter : on le dit plutôt que de relancer 138 téléchargements pour
  // ré-écrire les mêmes images. La case « re-télécharger » rouvre la porte.
  const syncOk = () => { ok.disabled = rienAFaire && !refresh?.checked; };
  if (refresh) refresh.onchange = syncOk;
  syncOk();
  if (rienAFaire) body.querySelector('.hint').insertAdjacentHTML('beforeend', ' <b>Ce produit est déjà à jour.</b>');

  const grid = body.querySelector('#ic-colors');
  for (const p of plan) {
    const etat = !p.old ? '<span class="pastille ok">nouveau</span>'
      : p.missing.length ? `<span class="pastille">+${p.missing.map(([v]) => VIEW_LABEL[v] || v).join(' ')}</span>`
        : '<span class="pastille eteint done">à jour</span>';
    grid.appendChild(el(`<div class="ic-color${p.old ? ' is-known' : ''}">
      <span class="cr-swatch" style="background:${esc(p.c.hex)}"></span>
      <span class="ic-label">${esc(p.c.label)}</span>
      <span class="ic-views">${p.views.map(([v]) => VIEW_LABEL[v] || v).join(' · ')}</span>
      ${existing ? etat : ''}
    </div>`));
  }

  ok.onclick = async () => {
    ok.disabled = true; ok.textContent = 'Téléchargement…';
    try {
      const res = await executerImport({
        norm, plan, existing,
        type: body.querySelector('#ic-type').value,
        nom: body.querySelector('#ic-name').value.trim(),
        toutReprendre: !!refresh?.checked,
        onProgress: (faits, total) => { ok.textContent = `Téléchargement ${faits}/${total}…`; },
      });
      if (res.echecs) toast(`${res.echecs} image(s) indisponible(s) — coloris incomplets ignorés.`, { ms: 5000 });
      m.close();
      const ajoutees = res.faits - res.echecs;
      toast(existing
        ? `« ${res.product.name} » complété : ${res.neufs.length} nouveau${res.neufs.length > 1 ? 'x' : ''} coloris, ${ajoutees} image${ajoutees > 1 ? 's' : ''} ajoutée${ajoutees > 1 ? 's' : ''} — ${res.product.colors.length} couleurs au total.`
        : `Produit « ${res.product.name} » importé (${res.product.colors.length} couleurs).`);
      done?.();
    } catch (e) {
      toast((existing ? 'Mise à jour : ' : 'Création : ') + e.message, { error: true });
      ok.disabled = false; ok.textContent = existing ? 'Compléter le produit' : 'Créer le produit';
    }
  };
}
