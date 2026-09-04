// ===========================================================================
// L'OUVRIER QUI COMPOSE LES FACES
// ---------------------------------------------------------------------------
// Composer une face coûte ~141 ms pour une image de 1200 × 1200, et changer de
// couleur en recompose trois ou quatre. Sur le fil principal, c'est un demi-
// seconde d'interface figée — près d'une seconde sur une tablette. Or rien de
// ce travail ne touche au DOM : c'est du pixel, et le pixel n'a pas besoin
// d'une fenêtre.
//
// L'ouvrier reçoit les OCTETS de l'image, pas un chemin : la lecture reste au
// fil principal, qui a le `store` et le cache
// HTTP. L'ouvrier ne sait rien du catalogue — il décode, compose, et rend une
// image transférée (donc sans copie).
import { composerFace } from './mockuppixels.js';

self.onmessage = async (e) => {
  const { id, bytes, spec } = e.data;
  try {
    const bmp = await createImageBitmap(new Blob([bytes]));
    const r = composerFace(bmp, spec);
    bmp.close?.();
    // `transferToImageBitmap` vide le canvas : il n'est plus réutilisable
    // ensuite, ce qui n'a aucune importance — il vient d'être créé pour ça.
    // L'EXPORT PDF VEUT DU JPEG, PAS UN CANVAS. Le lui rendre encodé ici évite
    // au fil principal de repeindre l'image puis de l'encoder — c'est-à-dire la
    // dernière tranche de travail pixel qui restait de son côté pendant un
    // export. `convertToBlob` est l'équivalent de `toBlob` hors écran.
    // ATTENTION à l'ordre : `transferToImageBitmap` VIDE le canvas, donc
    // l'encodage doit se faire AVANT.
    const octetsJpeg = spec.jpegQ
      ? new Uint8Array(await (await r.canvas.convertToBlob({ type: 'image/jpeg', quality: spec.jpegQ })).arrayBuffer())
      : null;
    const bitmap = r.canvas.transferToImageBitmap();
    // Le masque et le JPEG partent avec leur tampon : les transférer évite de
    // recopier des centaines de kilo-octets par face.
    const transferts = [bitmap];
    if (r.mask?.data) transferts.push(r.mask.data.buffer);
    if (octetsJpeg) transferts.push(octetsJpeg.buffer);
    self.postMessage({ id, ok: true, bitmap, mask: r.mask, jpeg: octetsJpeg,
      width: r.width, height: r.height, scale: r.scale }, transferts);
  } catch (err) {
    // Jamais de silence : le fil principal doit pouvoir retomber sur son
    // propre chemin, et savoir pourquoi.
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
