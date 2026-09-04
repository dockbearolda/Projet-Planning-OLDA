// Administration : entreprise, catalogue produits (import, produits
// personnalisés, association des mockups, calibration), listes éditables,
// réglages PDF.

import { store, MENTIONS_DEFAUT, defaultCalibration, FACES, FACE_ORDER } from './store.js';
import { toast, openModal, confirmModal, el } from './ui.js';
import { esc, clamp, hashBytes, uid, debounce, ICON_X } from './util.js';
import { mimeOf, faceVisual } from './mockup.js';
import { LOGO_EXTENSIONS, normalizeLogoFile } from './logoasset.js';
import { mountCalibrator } from './calibrator.js';

const fmt1 = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');

let section = 'company';

export async function renderReglages(host) {
  host.innerHTML = `
    <div class="admin-layout">
      <div class="admin-nav" id="ad-nav">
        <button data-s="company"><span>Mon entreprise</span></button>
        <button data-s="lists" title="Types de produits et techniques de marquage"><span>Listes</span></button>
        <button data-s="zones" title="Emplacements proposés sur le mockup, par type de produit"><span>Zones de placement</span></button>
        <button data-s="pdf"><span>Réglages PDF</span></button>
      </div>
      <div class="admin-body"><div class="inner" id="ad-body"></div></div>
    </div>`;
  const nav = host.querySelector('#ad-nav');
  nav.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.s === section);
    b.onclick = () => { section = b.dataset.s; renderReglages(host); };
  });
  const body = host.querySelector('#ad-body');
  if (section === 'company') renderCompany(body);
  if (section === 'lists') renderLists(body);
  if (section === 'zones') renderZones(body);
  if (section === 'pdf') renderPdfSettings(body);
}

// ---------------------------------------------------------------------------
// Mon entreprise
// ---------------------------------------------------------------------------
function renderCompany(body) {
  const c = store.settings.company;
  body.innerHTML = '';
  const card = el(`<div class="carte">
    <h2 class="section">Identité</h2>
    <div class="admin-grid2">
      <div class="field"><label>Raison sociale</label><input id="c-name" class="champ" type="text" value="${esc(c.name)}"></div>
      <div class="field"><label>Capital social</label><input id="c-capital" class="champ" type="text" value="${esc(c.capital)}"></div>
      <div class="field"><label>SIRET</label><input id="c-siret" class="champ" type="text" value="${esc(c.siret)}"></div>
      <div class="field"><label>N° TVA</label><input id="c-tva" class="champ" type="text" value="${esc(c.tva)}"></div>
      <div class="field"><label>RCS</label><input id="c-rcs" class="champ" type="text" value="${esc(c.rcs)}"></div>
      <div class="field"><label>Code APE</label><input id="c-ape" class="champ" type="text" value="${esc(c.ape)}"></div>
      <div class="field" style="grid-column:1/-1"><label>Adresse</label><input id="c-address" class="champ" type="text" value="${esc(c.address)}"></div>
      <div class="field"><label>E-mail</label><input id="c-email" class="champ" type="text" value="${esc(c.email)}"></div>
      <div class="field"><label>Téléphone fixe</label><input id="c-phone" class="champ" type="text" value="${esc(c.phone)}"></div>
      <div class="field"><label>Portable</label><input id="c-mobile" class="champ" type="text" value="${esc(c.phoneMobile)}"></div>
    </div>
    <div style="margin-top:16px" class="field"><label>Logo (PDF vectoriel recommandé — toute image est acceptée)</label>
      <div class="rang">
        <button class="btn secondaire" id="c-logo-btn">Choisir le logo…</button>
        <span class="hint" id="c-logo-name">${c.logoFile ? esc(c.logoFile) : 'Aucun logo — la raison sociale sera affichée en texte.'}</span>
      </div>
    </div>
  </div>`);
  body.appendChild(card);

  const save = () => store.saveSettings();
  const bind = (id, k) => { card.querySelector(id).onchange = (e) => { c[k] = e.target.value.trim(); save(); }; };
  bind('#c-name', 'name'); bind('#c-capital', 'capital'); bind('#c-siret', 'siret');
  bind('#c-tva', 'tva'); bind('#c-rcs', 'rcs'); bind('#c-ape', 'ape');
  bind('#c-address', 'address'); bind('#c-email', 'email');
  bind('#c-phone', 'phone'); bind('#c-mobile', 'phoneMobile');

  card.querySelector('#c-logo-btn').onclick = async () => {
    const files = await window.batApi.dialogOpen({
      title: 'Logo de l\'entreprise',
      filters: [
        { name: 'Logo ou image', extensions: LOGO_EXTENSIONS },
        { name: 'Tous les fichiers', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (!files?.length) return;
    const path = files[0];
    const buf = await window.batApi.fsRead(path);
    if (!buf) { toast('Fichier illisible.', { error: true }); return; }
    // Même pipeline que les logos posés sur le vêtement : le PDF reste
    // vectoriel, tout le reste devient un PNG/JPEG embarquable. Se fier à
    // l'extension laissait entrer des types que l'export ne savait pas
    // embarquer (WebP, HEIC…), et l'absence de logo n'apparaissait qu'au BAT.
    let asset;
    try {
      asset = await normalizeLogoFile(new Uint8Array(buf), path);
    } catch (e) { toast(e.message || 'Fichier illisible.', { error: true, ms: 8000 }); return; }
    const type = asset.type;
    // Nom versionné par hash du contenu : un remplacement de logo change le nom
    // de fichier, ce qui invalide automatiquement les caches d'aperçu (indexés
    // sur `logoFile` : instance BatPage + renderPdfLogoToCanvas au niveau
    // module). Sans cela, l'aperçu resterait figé sur l'ancien logo alors que
    // le PDF exporté embarquerait le nouveau — divergence WYSIWYG.
    const out = asset.bytes;
    const fname = 'logo-' + hashBytes(out) + '.' + type;
    const oldFile = c.logoFile;
    await window.batApi.dataWrite('company/' + fname, out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
    if (oldFile && oldFile !== fname) {
      await window.batApi.dataDelete('company/' + oldFile).catch(() => {});
    }
    c.logoFile = fname; c.logoType = type;
    await save();
    card.querySelector('#c-logo-name').textContent = fname;
    toast('Logo enregistré.');
  };

  const mentions = el(`<div class="carte">
    <h2 class="section">Mentions légales du BAT</h2>
    <div class="hint" style="margin-bottom:10px">Variables disponibles : {RAISON_SOCIALE}, {CAPITAL}, {SIRET}, {RCS}, {APE}, {TVA}, {ADRESSE}, {EMAIL}, {TELEPHONE}, {PORTABLE}. Ce texte apparaît en pied de page de chaque BAT.</div>
    <textarea class="champ" id="c-mentions" rows="8">${esc(store.settings.mentions)}</textarea>
    <div style="margin-top:16px"><button class="btn secondaire serre" id="c-mentions-reset">Rétablir le texte par défaut</button></div>
  </div>`);
  body.appendChild(mentions);
  mentions.querySelector('#c-mentions').onchange = (e) => { store.settings.mentions = e.target.value; save(); };
  mentions.querySelector('#c-mentions-reset').onclick = async () => {
    if (!await confirmModal('Mentions légales', 'Remplacer le texte actuel par le texte par défaut ?')) return;
    store.settings.mentions = MENTIONS_DEFAUT;
    await save();
    mentions.querySelector('#c-mentions').value = MENTIONS_DEFAUT;
  };
}

// --- calibration --------------------------------------------------------------
export async function calibrationModal(p) {
  const views = [];
  for (const v of ['front', 'back', 'sleeve']) {
    const c = p.colors.find(cc => cc.views[v]?.full);
    if (c) views.push({ view: v, rel: c.views[v].full });
  }
  if (!views.length) { toast('Aucun mockup à calibrer pour ce produit.', { error: true }); return; }

  let current = views[0];
  const body = el(`<div class="pile" style="min-width:620px">
    <div class="rang">
      <select class="champ" id="cal-view">${views.map(v => `<option value="${v.view}">${{ front: 'Avant', back: 'Arrière', sleeve: 'Côté / manche' }[v.view]}</option>`).join('')}</select>
    </div>
    <div class="hint">Placez les deux repères verticaux sur les bords du vêtement (ex. d'une couture latérale à l'autre), puis indiquez la largeur réelle correspondante. C'est ce qui garantit des tailles de logo exactes en cm.</div>
    <div id="cal-host"></div>
  </div>`);

  const ok = el(`<button class="btn primaire">Enregistrer la calibration</button>`);
  let calObjUrl = null; // ObjectURL courant de l'aperçu (révoqué à chaque vue / fermeture)
  const m = openModal({
    title: `Calibration — ${p.name}`, content: body, footButtons: [ok], width: '760px',
    onClose: () => { if (calObjUrl) URL.revokeObjectURL(calObjUrl); },
  });

  const calib = mountCalibrator(body.querySelector('#cal-host'), {});

  async function loadView() {
    const buf = await store.readCatalogueFile(current.rel);
    if (!buf) { toast('Mockup illisible.', { error: true }); return; }
    if (calObjUrl) URL.revokeObjectURL(calObjUrl); // libère l'aperçu précédent
    calObjUrl = URL.createObjectURL(new Blob([new Uint8Array(buf)], { type: mimeOf(current.rel) }));
    const c0 = p.calibration?.[current.view] || defaultCalibration(p.type, current.view);
    if (!await calib.setImage(calObjUrl, c0)) toast('Aperçu du mockup indisponible.', { error: true });
  }

  body.querySelector('#cal-view').onchange = (e) => {
    current = views.find(v => v.view === e.target.value);
    loadView();
  };

  ok.onclick = async () => {
    const res = calib.read();
    if (!res) { toast('Calibration invalide.', { error: true }); return; }
    p.calibration ??= {};
    p.calibration[current.view] = res;
    await store.saveCatalogue();
    toast(`Calibration « ${current.view} » enregistrée (${res.widthCm} cm ↔ ${res.widthPct.toFixed(1)} %).`);
  };

  loadView();
}

// ---------------------------------------------------------------------------
// Zones de placement — emplacements standard proposés au clic sur le mockup
// (Cœur, Poitrine, Dos…), par type de produit et par face. Chaque pastille se
// glisse sur le visuel réel du produit (position en %) et se règle au chiffre
// près dans les lignes qui suivent (nom, position, largeur cible en cm — la
// cote reprise automatiquement quand on pose un logo sur la zone).
// ---------------------------------------------------------------------------
let zoneType = null;   // type sélectionné (persistant entre rendus)
let zoneFace = 'front';

// Produit représentatif d'un type : le premier du catalogue de ce type qui
// possède au moins un mockup exploitable (sinon n'importe lequel du type).
function repProductFor(type) {
  const list = store.catalogue?.products || [];
  return list.find(p => p.type === type && p.colors?.some(c => c.views?.front?.full || c.views?.back?.full))
    || list.find(p => p.type === type)
    || null;
}
function repColorFor(product) {
  if (!product?.colors?.length) return null;
  return product.colors.find(c => c.views?.front?.full || c.views?.back?.full) || product.colors[0];
}

function renderZones(body) {
  body.innerHTML = '';
  const types = store.settings.productTypes;
  if (zoneType == null || !types.includes(zoneType)) zoneType = types[0];

  const card = el(`<div class="carte">
    <h2 class="section">Zones de placement prédéfinies</h2>
    <div class="hint" style="margin-bottom:var(--pas-3)">Par type de produit et par vue. Glissez les pastilles sur le mockup pour positionner chaque emplacement (le centre du logo). La largeur cible est en cm réels — reprise automatiquement quand on pose un logo sur la zone. Les lignes en dessous permettent la saisie fine.</div>
    <div class="field" style="max-width:280px;margin-bottom:var(--pas-4)"><label>Type de produit (référence)</label>
      <select class="champ" id="z-type">${types.map(t => `<option${t === zoneType ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
    </div>
    <div class="zone-edit">
      <div class="segmente" id="z-faces-tabs"></div>
      <div class="zone-edit-stage" id="z-stage"></div>
    </div>
    <div id="z-rows"></div>
  </div>`);
  body.appendChild(card);

  const sel = card.querySelector('#z-type');
  const tabsHost = card.querySelector('#z-faces-tabs');
  const stage = card.querySelector('#z-stage');
  const rowsHost = card.querySelector('#z-rows');
  const saveDeb = debounce(() => store.saveSettings(), 300);

  let stageToken = 0; // annule les chargements de mockup obsolètes

  const zonesOf = (face) => {
    store.settings.zones[zoneType] ??= { front: [], back: [], sideLeft: [], sideRight: [] };
    store.settings.zones[zoneType][face] ??= [];
    return store.settings.zones[zoneType][face];
  };

  // Reflète les coordonnées d'une zone dans sa ligne (drag → ligne).
  const syncRow = (z) => {
    const row = rowsHost.querySelector(`[data-zid="${z.id}"]`);
    if (!row) return;
    const xi = row.querySelector('[data-k="xPct"]'), yi = row.querySelector('[data-k="yPct"]');
    if (xi) xi.value = z.xPct;
    if (yi) yi.value = z.yPct;
  };
  // Reflète la position d'une zone sur sa pastille (ligne → drag).
  const syncDot = (z) => {
    const dot = stage.querySelector(`.zone-dot[data-zid="${z.id}"]`);
    if (dot) { dot.style.left = z.xPct + '%'; dot.style.top = z.yPct + '%'; }
  };

  // ---- pastilles glissables sur le mockup --------------------------------
  const buildDots = () => {
    const layer = stage.querySelector('.zone-edit-layer');
    if (!layer) return;
    layer.innerHTML = '';
    for (const z of zonesOf(zoneFace)) {
      const sub = z.widthCm ? ` · ${fmt1(z.widthCm)} cm` : '';
      const dot = el(`<button type="button" class="zone-dot zone-dot--edit" data-zid="${z.id}"
        style="left:${z.xPct}%;top:${z.yPct}%" aria-label="Déplacer l'emplacement ${esc(z.name)}">
        <span class="zone-dot__ring"></span>
        <span class="zone-dot__core"></span>
        <span class="zone-dot__label">${esc(z.name)}<em>${esc(sub)}</em></span>
      </button>`);
      let drag = null;
      dot.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        stage.querySelectorAll('.zone-dot--edit.is-active').forEach(d => d.classList.remove('is-active'));
        dot.classList.add('is-active');
        try { dot.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
        drag = { r: layer.getBoundingClientRect(), moved: false };
      });
      dot.addEventListener('pointermove', (e) => {
        if (!drag) return;
        drag.moved = true;
        const x = clamp(((e.clientX - drag.r.left) / drag.r.width) * 100, 0, 100);
        const y = clamp(((e.clientY - drag.r.top) / drag.r.height) * 100, 0, 100);
        z.xPct = Math.round(x * 2) / 2;
        z.yPct = Math.round(y * 2) / 2;
        dot.style.left = z.xPct + '%';
        dot.style.top = z.yPct + '%';
        syncRow(z);
        saveDeb();
      });
      const endDrag = (e) => {
        if (!drag) return;
        try { dot.releasePointerCapture(e.pointerId); } catch { /* déjà relâché */ }
        if (drag.moved) store.saveSettings();
        drag = null;
      };
      dot.addEventListener('pointerup', endDrag);
      dot.addEventListener('pointercancel', endDrag);
      layer.appendChild(dot);
    }
  };

  // ---- mockup de fond (visuel réel du produit, ou repli neutre) -----------
  const loadStage = async () => {
    const token = ++stageToken;
    stage.innerHTML = `<div class="zone-edit-loading">Chargement du mockup…</div>`;
    const product = repProductFor(zoneType);
    const color = repColorFor(product);
    let vis = null;
    if (product && color) {
      try { vis = await faceVisual(product, color.slug, zoneFace, { variant: 'medium', maxDim: 560, whiteBg: true }); }
      catch { vis = null; }
    }
    if (token !== stageToken) return; // rendu obsolète (type/face a changé)
    stage.innerHTML = '';
    const frame = el(`<div class="zone-edit-frame"></div>`);
    if (vis?.canvas) {
      vis.canvas.className = 'zone-edit-img';
      frame.appendChild(vis.canvas);
    } else {
      // Repli : aucune image → grille 0-100 % neutre, l'édition reste possible.
      frame.classList.add('is-blank');
      frame.appendChild(el(`<div class="zone-edit-blank"><span>${product ? 'Mockup indisponible' : 'Aucun produit « ' + esc(zoneType) + ' » dans le catalogue'}</span><small>Positionnement en % — repère 0 à 100</small></div>`));
    }
    frame.appendChild(el(`<div class="zone-edit-layer"></div>`));
    stage.appendChild(frame);
    buildDots();
  };

  // ---- lignes de saisie fine ----------------------------------------------
  const renderRows = () => {
    const zones = zonesOf(zoneFace);
    rowsHost.innerHTML = '';
    for (const z of zones) {
      const row = el(`<div class="zone-row" data-zid="${z.id}">
        <input class="champ zr-name" type="text" value="${esc(z.name)}" data-k="name" aria-label="Nom de la zone">
        <input class="champ zr-num" type="number" value="${z.xPct}" step="0.5" data-k="xPct" aria-label="Position X en pourcent">
        <input class="champ zr-num" type="number" value="${z.yPct}" step="0.5" data-k="yPct" aria-label="Position Y en pourcent">
        <input class="champ zr-num" type="number" value="${z.widthCm}" step="0.5" min="0.5" data-k="widthCm" aria-label="Largeur cible en centimètres">
        <button class="cr-del" aria-label="Supprimer la zone">${ICON_X}</button>
      </div>`);
      row.querySelectorAll('input').forEach((inp) => {
        const commit = () => {
          const k = inp.dataset.k;
          z[k] = k === 'name' ? inp.value : clamp(parseFloat(inp.value) || 0, k === 'widthCm' ? 0.5 : 0, k === 'widthCm' ? 999 : 100);
          if (k === 'xPct' || k === 'yPct') syncDot(z);
          if (k === 'name' || k === 'widthCm') {
            const label = stage.querySelector(`.zone-dot[data-zid="${z.id}"] .zone-dot__label`);
            if (label) label.innerHTML = `${esc(z.name)}<em>${z.widthCm ? ' · ' + fmt1(z.widthCm) + ' cm' : ''}</em>`;
          }
          store.saveSettings();
        };
        inp.onchange = commit;
        if (inp.dataset.k === 'xPct' || inp.dataset.k === 'yPct') {
          inp.oninput = () => { z[inp.dataset.k] = clamp(parseFloat(inp.value) || 0, 0, 100); syncDot(z); };
        }
      });
      row.querySelector('.cr-del').onclick = () => {
        store.settings.zones[zoneType][zoneFace] = zones.filter(x => x !== z);
        store.saveSettings();
        renderRows(); buildDots(); renderTabs();
      };
      rowsHost.appendChild(row);
    }
    if (!zones.length) rowsHost.appendChild(el(`<div class="hint">Aucune zone — ajoutez-en une, elle apparaîtra au centre du mockup.</div>`));
    const ajouter = el(`<button class="btn secondaire" style="margin-top:var(--pas-2)">+ Zone</button>`);
    ajouter.onclick = () => {
      zones.push({ id: uid(), name: 'Nouvelle zone', xPct: 50, yPct: 35, widthCm: 10 });
      store.saveSettings();
      renderRows(); buildDots(); renderTabs();
    };
    rowsHost.appendChild(ajouter);
  };

  // ---- onglets de face -----------------------------------------------------
  const renderTabs = () => {
    tabsHost.innerHTML = '';
    for (const fk of FACE_ORDER) {
      const n = zonesOf(fk).length;
      const b = el(`<button type="button" class="segmente__btn${fk === zoneFace ? ' is-on' : ''}">${esc(FACES[fk].label)}${n ? ` <span class="zone-face-count">${n}</span>` : ''}</button>`);
      b.onclick = () => { if (zoneFace === fk) return; zoneFace = fk; renderTabs(); loadStage(); renderRows(); };
      tabsHost.appendChild(b);
    }
  };

  const renderAll = () => { renderTabs(); loadStage(); renderRows(); };
  sel.onchange = () => { zoneType = sel.value; renderAll(); };
  renderAll();
}

// ---------------------------------------------------------------------------
// Listes éditables
// ---------------------------------------------------------------------------
function renderLists(body) {
  body.innerHTML = '';
  const mk = (title, arr, hint, onChange) => {
    const card = el(`<div class="carte">
      <h2 class="section">${esc(title)}</h2>
      <div class="hint" style="margin-bottom:10px">${esc(hint)}</div>
      <div class="chips"></div>
      <div class="rang" style="margin-top:16px;max-width:340px">
        <input class="champ" type="text" placeholder="Ajouter…"><button class="btn secondaire">Ajouter</button>
      </div>
    </div>`);
    const chips = card.querySelector('.chips');
    const render = () => {
      chips.innerHTML = '';
      for (const v of arr) {
        const chip = el(`<span class="chip">${esc(v)}<button title="Supprimer" aria-label="Supprimer">${ICON_X}</button></span>`);
        chip.querySelector('button').onclick = async () => {
          if (!await confirmModal('Supprimer', `Retirer « ${v} » de la liste ?`, { danger: true, okLabel: 'Retirer' })) return;
          arr.splice(arr.indexOf(v), 1);
          onChange(); render();
        };
        chips.appendChild(chip);
      }
    };
    const input = card.querySelector('input');
    card.querySelector('.btn').onclick = () => {
      const v = input.value.trim();
      if (!v || arr.includes(v)) return;
      arr.push(v);
      input.value = '';
      onChange(); render();
    };
    render();
    return card;
  };
  body.appendChild(mk('Types de produit', store.settings.productTypes,
    'Utilisés pour classer le catalogue et rattacher les calibrations par défaut.',
    () => store.saveSettings()));
  body.appendChild(mk('Techniques de marquage', store.settings.techniques,
    'Proposées dans l\'éditeur et le tableau des marquages (sérigraphie, broderie, DTF, flex…).',
    () => store.saveSettings()));
}

// ---------------------------------------------------------------------------
// Réglages PDF
// ---------------------------------------------------------------------------
function renderPdfSettings(body) {
  const s = store.settings.pdf;
  body.innerHTML = '';
  const card = el(`<div class="carte">
    <h2 class="section">Réglages du PDF BAT</h2>
    <div class="admin-grid2" style="max-width:560px">
      <div class="field"><label>Résolution utile des mockups (dpi)</label>
        <input class="champ" id="pdf-dpi" type="number" min="100" max="300" step="10" value="${s.targetDpi}"></div>
      <div class="field"><label>Qualité JPEG initiale (0,5 – 0,95)</label>
        <input class="champ" id="pdf-q" type="number" min="0.5" max="0.95" step="0.05" value="${s.jpegQuality}"></div>
      <div class="field"><label>Poids maximum garanti (Mo)</label>
        <input class="champ" id="pdf-max" type="number" min="1" max="10" step="0.5" value="${(s.maxBytes / 1048576).toFixed(1)}"></div>
    </div>
    <div class="hint" style="margin-top:16px">Si un BAT dépasse le poids maximum, il est automatiquement recompressé par paliers (jusqu'à 120 dpi) sans toucher aux logos, qui restent vectoriels. 200 dpi / 3 Mo sont les valeurs recommandées.</div>
  </div>`);
  body.appendChild(card);
  card.querySelector('#pdf-dpi').onchange = (e) => { s.targetDpi = clamp(parseInt(e.target.value) || 200, 100, 300); store.saveSettings(); };
  card.querySelector('#pdf-q').onchange = (e) => { s.jpegQuality = clamp(parseFloat(e.target.value) || 0.85, 0.5, 0.95); store.saveSettings(); };
  card.querySelector('#pdf-max').onchange = (e) => { s.maxBytes = Math.round(clamp(parseFloat(e.target.value) || 3, 1, 10) * 1048576); store.saveSettings(); };
}
