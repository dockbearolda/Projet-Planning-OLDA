// L'ACCÈS AUX FICHIERS, EN UN SEUL ENDROIT. Tout le reste de l'application lit
// et écrit par `window.batApi` : projets, logos, mockups, BAT archivés. Ici, et
// nulle part ailleurs, ces appels deviennent du HTTP.
//
// Ce n'est pas une indirection gratuite : c'est le point où l'on branche autre
// chose sans toucher au reste. Le jour où BAT Studio partagera le processus du
// CRM, c'est ce fichier — et lui seul — qui change.

import { bytesHuman } from './util.js';
import { chemin } from './base.js';

{
  // Pseudo-chemin → ArrayBuffer des fichiers choisis. BORNÉ : sans plafond,
  // une session qui importe vingt logos de 8 Mo garde 160 Mo d'octets vivants
  // jusqu'au rechargement de l'onglet — l'app rame puis se fige. Les octets ne
  // sont utiles qu'entre le choix du fichier et son analyse ; on garde les
  // derniers (et non le seul dernier) pour tolérer une relecture du fichier
  // en cours dans un chemin d'import qui en ferait deux.
  const uploads = new Map(); // pseudo-chemin → ArrayBuffer (fichiers choisis)
  const UPLOAD_KEEP = 3;
  let uploadSeq = 0;

  function rememberUpload(key, buf) {
    uploads.set(key, buf);
    while (uploads.size > UPLOAD_KEEP) uploads.delete(uploads.keys().next().value);
  }

  const fetchBuf = async (u) => {
    const r = await fetch(u);
    return r.ok ? await r.arrayBuffer() : null;
  };

  // Fait choisir un fichier local et le garde en mémoire sous un pseudo-chemin.
  function pickFile(opts) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      const exts = opts?.filters?.flatMap(f => f.extensions || []) || [];
      // Un filtre « * » (Tous les fichiers) l'emporte : sans `accept`, rien
      // n'est grisé et l'utilisateur peut soumettre le fichier qu'il sait bon.
      // C'est le pipeline d'import qui décide, pas l'extension.
      if (exts.length && !exts.includes('*')) input.accept = exts.map(e => '.' + e).join(',');
      let chosen = false;
      input.onchange = async () => {
        chosen = true;
        const f = input.files?.[0];
        if (!f) return resolve(null);
        const key = `@upload/${uploadSeq++}/${f.name}`;
        rememberUpload(key, await f.arrayBuffer());
        resolve([key]);
      };
      // Annulation : `cancel` est l'événement fait pour ça (Chrome 113+,
      // Safari 16.4+, Firefox 109+, tous acquis depuis 2023 — la base de cette
      // appli, déjà tout en modules/async) — immédiat et sans ambiguïté. C'est
      // donc LUI qui détecte une annulation, plus le délai ci-dessous.
      input.oncancel = () => { if (!chosen) resolve(null); };
      input.click();
      // FILET DE SÉCURITÉ, PAS UNE DÉTECTION D'ANNULATION. Sans lui, un
      // navigateur qui ne déclenche jamais `cancel` (cas résiduel, ou dialogue
      // qui échoue autrement) bloquerait la promesse pour toujours — aucun
      // signe de vie, pose de logo hors service jusqu'au rechargement.
      // LE PIÈGE DÉJÀ TOMBÉ DEUX FOIS : un délai qui essaie aussi de deviner
      // une annulation rapide se fait rattraper par un fichier légitime mais
      // lent à matérialiser (disque réseau, volume monté, PIÈCE ICLOUD/DRIVE
      // PAS ENCORE TÉLÉCHARGÉE LOCALEMENT) — 1 s ne suffisait pas, 3 s non
      // plus : le clic ne faisait « rien » sans le moindre message, `cancel`
      // ayant déjà fait le travail entre-temps. Ce filet n'a donc plus qu'un
      // rôle : ne jamais rester bloqué. Une minute est large exprès — aucun
      // fichier qu'on choisit à la main ne prend ça à charger, un filet qui
      // se déclenche encore serait juste un filet trop court.
      window.addEventListener('focus', () => setTimeout(() => { if (!chosen) resolve(null); }, 60000), { once: true });
    });
  }

  function download(name, bytes) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  // « Enregistrer sous » du navigateur (File System Access API) : l'utilisateur
  // choisit le dossier ET le nom, comme en bureau. Le handle retenu est gardé
  // sous un pseudo-chemin, écrit ensuite par fsWrite.
  // Firefox/Safari n'implémentent pas l'API → repli sur le téléchargement
  // classique, qui atterrit sans question dans le dossier Téléchargements.
  const saveTargets = new Map(); // pseudo-chemin → FileSystemFileHandle
  let saveSeq = 0;

  async function pickSaveTarget(opts) {
    const name = (opts?.defaultPath || 'export.pdf').split(/[\\/]/).pop();
    if (!window.showSaveFilePicker) return '@download/' + name;
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        // `id` : le sélecteur se rouvre dans le dernier dossier utilisé pour
        // les BAT — un export après l'autre, plus rien à re-naviguer.
        id: 'bat-export',
        startIn: 'downloads',
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
      });
      const key = `@savefile/${saveSeq++}`;
      saveTargets.set(key, handle);
      return key;
    } catch (e) {
      if (e?.name === 'AbortError') return null;   // annulé par l'utilisateur
      // Sélecteur refusé (geste utilisateur expiré, iframe, permission) : on
      // télécharge plutôt que de perdre le document déjà généré.
      console.warn('Sélecteur d\'enregistrement indisponible :', e);
      return '@download/' + name;
    }
  }

  async function writeSaveTarget(key, bytes) {
    const handle = saveTargets.get(key);
    saveTargets.delete(key);   // usage unique : un dialogue = un fichier
    if (!handle) throw new Error('Destination d\'enregistrement expirée.');
    const w = await handle.createWritable();
    await w.write(bytes);
    await w.close();
  }

  const dataUrl = (p) => chemin('/api/data/') + p.split('/').map(encodeURIComponent).join('/');

  window.batApi = {
    // --- stockage serveur -------------------------------------------------
    dataRead: (rel) => fetchBuf(dataUrl(rel)),
    // `base` = l'`updatedAt` du fichier tel qu'il a été lu. Le serveur refuse
    // l'écriture (409) si le disque a bougé depuis : c'est ce qui empêche un
    // second poste d'effacer le travail du premier sans que personne ne le sache.
    dataWrite: async (rel, bytes, base = null) => {
      const headers = { 'Content-Type': 'application/octet-stream' };
      if (base) headers['X-Bat-Base'] = base;
      const r = await fetch(dataUrl(rel), { method: 'PUT', headers, body: bytes });
      if (r.status === 409) {
        // Le contenu du serveur voyage AVEC l'erreur : celui qui la reçoit peut
        // proposer un choix au lieu d'un simple constat d'échec.
        const err = new Error('Ce projet a été modifié sur un autre appareil.');
        err.conflit = true;
        try { err.serveur = await r.json(); } catch { err.serveur = null; }
        throw err;
      }
      // « Écriture refusée : bat/xxx/… » n'apprenait rien à personne. Les deux
      // causes réelles méritent leur phrase : le fichier dépasse la limite du
      // serveur (80 Mo), ou la session a expiré et il faut se reconnecter.
      if (r.status === 413) {
        throw new Error(`Fichier trop volumineux (${bytesHuman(bytes.byteLength)}) — 80 Mo maximum.`);
      }
      if (r.status === 401) throw new Error('Session expirée : reconnectez-vous pour enregistrer.');
      if (!r.ok) throw new Error(`Enregistrement refusé par le serveur (${r.status}).`);
      return true;
    },
    dataDelete: async (rel) => {
      const r = await fetch(dataUrl(rel), { method: 'DELETE' });
      if (!r.ok) throw new Error('Suppression refusée : ' + rel);
      return true;
    },
    dataList: async (rel) => {
      const r = await fetch(chemin('/api/list/') + (rel || ''));
      return r.ok ? r.json() : [];
    },

    // --- pseudo-système de fichiers ----------------------------------------
    fsRead: async (p) => {
      if (uploads.has(p)) return uploads.get(p);
      if (p.startsWith('@server-catalogue/')) return fetchBuf(chemin('/catalogue/') + p.slice('@server-catalogue/'.length).split('/').map(encodeURIComponent).join('/'));
      if (p.startsWith('@app/')) return fetchBuf(chemin('/' + p.slice(5)));
      if (p.startsWith('@data/')) return fetchBuf(dataUrl(p.slice(6)));
      return null;
    },
    fsStat: async (p) => {
      const buf = await window.batApi.fsRead(p);
      return buf ? { size: buf.byteLength, dir: false, mtime: 0 } : null;
    },
    fsReaddir: async () => null,
    fsWrite: async (p, bytes) => {
      if (p.startsWith('@savefile/')) { await writeSaveTarget(p, bytes); return true; }
      if (p.startsWith('@download/')) { download(p.slice(10), bytes); return true; }
      throw new Error('Écriture non autorisée : ' + p);
    },

    // --- dialogues & ouverture ---------------------------------------------
    dialogOpen: async (opts) => {
      if (opts?.properties?.includes('openDirectory')) return ['@server-catalogue'];
      return pickFile(opts);
    },
    dialogSave: pickSaveTarget,
    openPath: (p) => {
      if (p.startsWith('@data/')) window.open(dataUrl(p.slice(6)), '_blank');
      return Promise.resolve('');
    },
    showInFolder: (p) => {
      if (p.startsWith('@data/')) window.open(dataUrl(p.slice(6)) + '?dl=1', '_blank');
      return Promise.resolve(true);
    },

    // --- infos & mode exemples ----------------------------------------------
    appInfo: () => fetch(chemin('/api/info')).then(r => r.json()),
  };
}
