// Administration : entreprise, catalogue produits (import, produits
// personnalisés, association des mockups, calibration), listes éditables,
// réglages PDF.

import { store, defaultCalibration } from './store.js';
import { toast, openModal, el } from './ui.js';
import { mimeOf } from './mockup.js';
import { mountCalibrator } from './calibrator.js';

const fmt1 = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');

let section = 'company';

// CE FICHIER N'A PLUS D'ECRAN NON PLUS (04/09/2026).
//
// Il portait l'ecran « Reglages » du BAT : identite de l'entreprise, listes,
// zones de placement, reglages PDF. L'onglet est parti avec la liste des
// projets — l'identite qui signe le PDF est deja un reglage du CRM, et le reste
// se decidait une fois pour toutes.
//
// NE RESTE QUE LA CALIBRATION, appelee depuis l'ecran Produits : c'est elle qui
// garantit des tailles de logo exactes en centimetres, et elle n'a jamais eu sa
// place dans un ecran de reglages — elle appartient au produit qu'on calibre.

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

