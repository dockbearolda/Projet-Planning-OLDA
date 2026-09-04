'use strict';

// ===========================================================================
// RAPATRIER LES DONNÉES DE BAT STUDIO DEPUIS SON SERVICE EN LIGNE
// ---------------------------------------------------------------------------
// `importer-bat.js` range une arborescence de DISQUE. Celui-ci va chercher la
// même chose sur le service BAT Studio encore en ligne, et pour une raison
// qu'on a failli payer cher : LE DOSSIER LOCAL EST UNE COPIE PÉRIMÉE.
// Mesuré le 04/09/2026 — 19 projets en local, arrêtés au 31/08 ; 85 sur le
// service, le dernier de la veille au soir. Importer la copie aurait publié un
// onglet BAT qui « marche » en ayant perdu soixante-six dossiers, sans que rien
// ne le dise.
//
// Le service expose exactement ce qu'il faut : `/api/list/<dossier>` liste,
// `/api/data/<chemin>` rend le fichier. On le parcourt, on range, et c'est
// tout. IDEMPOTENT : un fichier déjà rangé sous le même chemin est réécrit à
// l'identique, donc le script se relance sans rien salir — et se relancer est
// justement ce qu'on fait quand le réseau a lâché au milieu.
//
//   node scripts/reprendre-bat-en-ligne.js [dossiers…] [--essai]
//
//   dossiers   ceux à reprendre (défaut : projects logos bat). Les quatre
//              fichiers de la racine sont toujours repris : ils sont petits et
//              l'application ne s'ouvre pas sans eux.
//   --essai    ne range RIEN : dit ce qui serait repris, et ce que ça pèse.
//
// LA RACINE NE SE LISTE PAS, et ce n'est pas un oubli : côté BAT Studio,
// `/api/list/` demande le répertoire de données lui-même, que `resolveData`
// refuse — sans quoi un `DELETE /api/data/.` effacerait tout. Les quatre
// fichiers du dessus sont donc nommés ici.
// ===========================================================================

const SOURCE = String(process.env.BAT_SOURCE || 'https://bat-studio-production.up.railway.app').replace(/\/+$/, '');
const RACINE = ['settings.json', 'catalogue.json', 'projects-index.json', 'tailles-cache.json'];

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL absente.\n' +
    '  Ce script écrit dans une VRAIE base. Sans elle, le serveur tourne sur\n' +
    '  pg-mem — une base en mémoire, propre au processus du serveur : ce qui\n' +
    '  serait repris ici ne serait lu par personne.',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const essai = args.includes('--essai');
const dossiers = args.filter((a) => !a.startsWith('--'));
const voulus = dossiers.length ? dossiers : ['projects', 'logos', 'bat'];

const humain = (o) => (o < 1024 ? `${o} o`
  : o < 1024 * 1024 ? `${(o / 1024).toFixed(1)} Ko`
    : `${(o / 1024 / 1024).toFixed(1)} Mo`);

// Un appel qui réessaie : reprendre trois cents fichiers sur un réseau qui
// tousse ne doit pas s'arrêter au premier hoquet. Trois essais, puis on rend
// la main en nommant le fichier — le script est idempotent, on le relance.
async function avecReprises(url, opts, essais = 3) {
  let derniere;
  for (let i = 0; i < essais; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.ok) return r;
      derniere = new Error(`HTTP ${r.status}`);
    } catch (e) { derniere = e; }
    await new Promise((ok) => setTimeout(ok, 500 * (i + 1)));
  }
  throw derniere;
}

const lister = async (rel) => {
  try { return await (await avecReprises(`${SOURCE}/api/list/${rel}`)).json(); }
  catch { return []; }
};

// Tous les chemins de fichiers sous `rel`, en descendant.
async function parcourir(rel) {
  const out = [];
  for (const e of await lister(rel)) {
    const sous = `${rel}/${e.name}`;
    if (e.dir) out.push(...await parcourir(sous));
    else out.push(sous);
  }
  return out;
}

(async () => {
  const { batEcrire } = require('../db');

  console.log(`Source : ${SOURCE}`);
  const chemins = [...RACINE];
  for (const d of voulus) {
    const l = await parcourir(d);
    console.log(`  ${d} : ${l.length} fichier(s)`);
    chemins.push(...l);
  }
  console.log(`  racine : ${RACINE.length} fichier(s)`);
  console.log(`TOTAL : ${chemins.length} fichier(s)`);

  if (essai) {
    // On PÈSE sans rapatrier : `HEAD` rend la taille sans le corps, donc un
    // essai sur neuf cents mégaoctets ne télécharge rien.
    let octets = 0;
    for (const c of chemins) {
      try {
        const r = await avecReprises(`${SOURCE}/api/data/${c}`, { method: 'HEAD' });
        octets += Number(r.headers.get('content-length') || 0);
      } catch { /* un fichier illisible ne fausse qu'une estimation */ }
    }
    console.log(`Poids : ${humain(octets)} — ${humain(Math.round(octets * 4 / 3))} une fois en base64.`);
    console.log('\nEssai : rien n\'a été écrit.');
    process.exit(0);
  }

  let faits = 0, refuses = 0, octets = 0;
  const debut = Date.now();
  for (const c of chemins) {
    try {
      const r = await avecReprises(`${SOURCE}/api/data/${c}`);
      const buf = Buffer.from(await r.arrayBuffer());
      await batEcrire(c, buf);
      faits++; octets += buf.length;
    } catch (e) {
      // UN FICHIER MANQUANT N'ARRÊTE PAS LA REPRISE : trois cents autres
      // attendent, et c'est en fin de course qu'on veut la liste des ratés.
      refuses++;
      console.error(`  ✗ ${c} — ${e.message}`);
    }
    if (faits % 25 === 0) console.log(`  … ${faits}/${chemins.length}  (${humain(octets)})`);
  }
  console.log(`\n${faits} repris (${humain(octets)}), ${refuses} raté(s), en ${((Date.now() - debut) / 1000).toFixed(0)} s.`);
  process.exit(refuses ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
