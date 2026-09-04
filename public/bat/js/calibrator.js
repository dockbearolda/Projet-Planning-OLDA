// Widget de calibration : une image, deux repères verticaux à glisser, et la
// largeur réelle en cm entre les deux. C'est ce qui convertit les pixels d'un
// packshot en centimètres imprimés — sans lui, une cote de BAT est une
// devinette.
//
// Le module ne connaît NI le store NI les produits : il reçoit une URL
// d'image et deux nombres, il rend deux nombres. Deux consommateurs :
// l'écran Réglages et l'éditeur produit.

import { clamp } from './util.js';
import { el } from './ui.js';

// Gabarit figé — aucune donnée n'y est interpolée.
const TPL = `<div class="calib-root">
  <div class="calib-stage">
    <img alt="">
    <div class="calib-handle" data-h="1"><div class="grip"></div></div>
    <div class="calib-handle" data-h="2"><div class="grip"></div></div>
    <div class="calib-span"></div>
  </div>
  <div class="calib-foot">
    <label>Largeur réelle entre les deux repères :</label>
    <input class="champ calib-cm" type="number" step="0.5" min="1"> cm
    <span class="hint calib-readout"></span>
  </div>
</div>`;

// host    : élément qui reçoit le widget (son contenu est remplacé)
// imgUrl  : URL de l'image à calibrer (peut être null au montage)
// widthCm / widthPct : valeurs initiales
// onChange: appelé à chaque geste, reçoit le résultat de read()
export function mountCalibrator(host, { imgUrl = null, widthCm = 0, widthPct = 60, onChange } = {}) {
  const root = el(TPL);
  host.replaceChildren(root);

  const img = root.querySelector('img');
  const h1 = root.querySelector('[data-h="1"]');
  const h2 = root.querySelector('[data-h="2"]');
  const span = root.querySelector('.calib-span');
  const cmInput = root.querySelector('.calib-cm');
  const readout = root.querySelector('.calib-readout');

  let pct1 = clamp(50 - widthPct / 2, 0, 100);
  let pct2 = clamp(50 + widthPct / 2, 0, 100);
  cmInput.value = widthCm || '';

  // Lecture : null si la saisie est inexploitable (pas de cm, ou repères
  // confondus). L'appelant décide alors quoi faire — refuser, ou retomber sur
  // un défaut.
  function read() {
    const cm = parseFloat(cmInput.value);
    const pct = Math.abs(pct2 - pct1);
    if (!cm || cm < 1 || pct < 2) return null;
    return { widthCm: cm, widthPct: Math.round(pct * 10) / 10 };
  }

  function place() {
    h1.style.left = pct1 + '%';
    h2.style.left = pct2 + '%';
    span.style.left = Math.min(pct1, pct2) + '%';
    span.style.width = Math.abs(pct2 - pct1) + '%';
    span.style.top = '50%';
    readout.textContent = `Repères : ${Math.abs(pct2 - pct1).toFixed(1)} % de la largeur de l'image ↔ ${cmInput.value || '?'} cm réels.`;
    onChange?.(read());
  }

  function dragHandle(h, setter) {
    h.addEventListener('pointerdown', (e) => {
      h.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const r = img.getBoundingClientRect();
        if (!r.width) return;
        setter(clamp(((ev.clientX - r.left) / r.width) * 100, 0, 100));
        place();
      };
      const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
    });
  }
  dragHandle(h1, v => { pct1 = v; });
  dragHandle(h2, v => { pct2 = v; });
  cmInput.oninput = place;

  function setValues(cal) {
    if (!cal) return;
    cmInput.value = cal.widthCm;
    pct1 = clamp(50 - cal.widthPct / 2, 0, 100);
    pct2 = clamp(50 + cal.widthPct / 2, 0, 100);
    place();
  }

  // Change l'image affichée et réinitialise les repères sur `cal`. Résout à
  // false si l'image ne décode pas — l'appelant ne doit jamais rester figé.
  async function setImage(url, cal) {
    if (!url) { img.removeAttribute('src'); return false; }
    img.src = url;
    const ok = await new Promise(r => { img.onload = () => r(true); img.onerror = () => r(false); });
    if (!ok) return false;
    setValues(cal);
    place();
    return true;
  }

  place();
  if (imgUrl) setImage(imgUrl, { widthCm, widthPct });

  return { read, setImage, setValues };
}
