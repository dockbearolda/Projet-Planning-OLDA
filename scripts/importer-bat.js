'use strict';

// ===========================================================================
// IMPORTER LES DONNÉES DE BAT STUDIO
// ---------------------------------------------------------------------------
// BAT Studio rangeait ses fichiers sur un disque (son `DATA_DIR`, un volume
// Railway) : projets, logos, mockups importés, BAT archivés, réglages — et, à
// côté, le CATALOGUE de mockups, 5 100 images de vêtements servies en lecture
// seule. Dans le CRM il n'y a pas de disque : tout ça vit dans `bat_fichiers`.
//
// Ce script fait le passage, une fois. Il est IDEMPOTENT : un fichier déjà
// rangé sous le même chemin est réécrit à l'identique, donc on peut le relancer
// sans rien salir — et le relancer est justement ce qu'on fait quand le
// catalogue change.
//
//   node scripts/importer-bat.js <répertoire> [--sous <préfixe>] [--essai]
//
//   <répertoire>   l'arborescence à ranger (ex. le `data/` de BAT Studio)
//   --sous <préf>  la ranger sous ce préfixe (ex. `catalogue` pour le
//                  catalogue de mockups, que BAT sert sous `/bat/catalogue/`)
//   --essai        n'écrit RIEN : dit ce qui serait rangé, et ce que ça pèse
//
// EXEMPLES
//   # les données de travail, à la racine du magasin
//   DATABASE_URL=… node scripts/importer-bat.js ~/bat-studio/data
//   # le catalogue de mockups, sous son préfixe
//   DATABASE_URL=… node scripts/importer-bat.js ~/bat-studio/catalogue --sous catalogue
//
// SANS `DATABASE_URL`, LE SCRIPT REFUSE DE PARTIR. La base locale de test
// (pg-mem) vit dans le processus du serveur : y importer depuis un autre
// processus rangerait onze mégaoctets dans une base qui disparaît à la seconde
// où le script se termine. Mieux vaut le dire que le laisser croire.
// ===========================================================================

const fs = require('fs');
const path = require('path');

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL absente.\n' +
    '  Ce script écrit dans une VRAIE base. Sans elle, le serveur tourne sur\n' +
    '  pg-mem — une base en mémoire, propre au processus du serveur : ce qui\n' +
    '  serait importé ici ne serait lu par personne.\n' +
    '  En local : DATABASE_URL=postgresql://…/olda_dev node scripts/importer-bat.js <répertoire>',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const essai = args.includes('--essai');
const iSous = args.indexOf('--sous');
const sous = iSous === -1 ? '' : String(args[iSous + 1] || '').replace(/^\/+|\/+$/g, '');
const racine = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--sous');

if (!racine) {
  console.error('Usage : node scripts/importer-bat.js <répertoire> [--sous <préfixe>] [--essai]');
  process.exit(1);
}

// Ce qu'on ne range JAMAIS, quelle que soit l'arborescence donnée.
// `.DS_Store` : le Finder en sème un par dossier, et il n'a rien à faire en
// base. Les `.tmp` : BAT Studio écrivait ses fichiers par « temporaire puis
// renommage » — un `.tmp` qui traîne est le reste d'une écriture interrompue.
const IGNORE = /(^|\/)(\.DS_Store|\.git|node_modules)(\/|$)|\.tmp$/;

function* parcourir(base, prefixe = '') {
  for (const e of fs.readdirSync(path.join(base, prefixe), { withFileTypes: true })) {
    const rel = prefixe ? `${prefixe}/${e.name}` : e.name;
    if (IGNORE.test(rel)) continue;
    if (e.isDirectory()) yield* parcourir(base, rel);
    else if (e.isFile()) yield rel;
  }
}

const humain = (o) => (o < 1024 ? `${o} o`
  : o < 1024 * 1024 ? `${(o / 1024).toFixed(1)} Ko`
    : `${(o / 1024 / 1024).toFixed(1)} Mo`);

(async () => {
  const { batEcrire } = require('../db');

  const base = path.resolve(racine);
  if (!fs.existsSync(base)) {
    console.error(`Répertoire introuvable : ${base}`);
    process.exit(1);
  }

  const fichiers = [...parcourir(base)];
  let octets = 0;
  for (const rel of fichiers) octets += fs.statSync(path.join(base, rel)).size;

  console.log(`${fichiers.length} fichier(s), ${humain(octets)} — depuis ${base}`);
  console.log(`Rangés sous : ${sous ? `${sous}/` : '(la racine du magasin)'}`);
  if (essai) {
    // On montre les dix premiers : de quoi vérifier que le préfixe tombe juste
    // sans dérouler cinq mille lignes.
    for (const rel of fichiers.slice(0, 10)) console.log(`  ${sous ? `${sous}/` : ''}${rel}`);
    if (fichiers.length > 10) console.log(`  … et ${fichiers.length - 10} autre(s)`);
    console.log('\nEssai : rien n\'a été écrit.');
    process.exit(0);
  }

  let faits = 0, refuses = 0;
  const debut = Date.now();
  for (const rel of fichiers) {
    const chemin = sous ? `${sous}/${rel}` : rel;
    try {
      await batEcrire(chemin, fs.readFileSync(path.join(base, rel)));
      faits++;
    } catch (e) {
      // UN CHEMIN REFUSÉ NE DOIT PAS ARRÊTER L'IMPORT. Un seul nom de fichier
      // exotique bloquerait les cinq mille autres — et c'est en fin de course
      // qu'on s'en apercevrait.
      refuses++;
      console.error(`  ✗ ${chemin} — ${e.message}`);
    }
    if (faits % 250 === 0) console.log(`  … ${faits}/${fichiers.length}`);
  }
  console.log(`\n${faits} rangé(s), ${refuses} refusé(s), en ${((Date.now() - debut) / 1000).toFixed(1)} s.`);
  process.exit(refuses ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
