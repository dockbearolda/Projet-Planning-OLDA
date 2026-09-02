'use strict';

// CE QUI EST PARTI NE REVIENT PAS
// ===========================================================================
// Chaque retrait de ce dépôt a laissé derrière lui une assertion « ce fichier
// n'existe plus », posée dans le test qui traitait du sujet du jour. Au bout
// d'un an, elles étaient six, dans six fichiers qui ne parlent de rien
// d'autre en commun : la police du texte, le briefing du matin, la
// bibliothèque de PDF, la seconde police, le client de l'ancien site.
//
// Les rassembler ici tient à une chose : ces assertions ne protègent pas le
// sujet de leur fichier d'accueil, elles protègent le POIDS SERVI. Un fichier
// remis dans `public/` par un copier-coller malheureux repart vers chaque
// poste, et personne ne le voit — c'est la même famille de défaut, elle mérite
// un seul endroit.
//
// LE POURQUOI RESTE ATTACHÉ AU FICHIER, jamais résumé en « code mort » : le
// jour où quelqu'un veut remettre l'un d'eux, il doit lire ce qu'il défait.
//
// ⚠ CE TEST NE REMPLACE PAS les assertions qui vérifient que le CODE ne parle
// plus de ces fichiers (`sw.js` ne les précache plus, `index.html` ne les
// précharge plus, l'écran n'y fait plus référence). Celles-là restent où elles
// sont : elles tiennent au sujet de leur fichier, pas au poids servi.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');

// Chaque entrée dit CE QUI est parti, QUAND, et ce qu'on défait en le remettant.
const PARTIS = [
  {
    chemin: 'public/manrope-latin-variable.woff2',
    quand: '29/08/2026',
    pourquoi: 'la police du texte est celle de la MACHINE (SF sur Mac, Segoe UI sur les '
      + 'Windows de l’atelier). Ces 24 Ko partaient à chaque ouverture à froid, et le '
      + 'texte s’affichait entier dans la police de secours avant de tout recomposer.',
  },
  {
    chemin: 'public/manrope-LICENCE.txt',
    quand: '29/08/2026',
    pourquoi: 'la licence d’une police qu’on ne sert plus ne couvre plus rien.',
  },
  {
    chemin: 'public/plus-jakarta-sans-latin-variable.woff2',
    quand: '25/08/2026',
    pourquoi: 'le rail avait sa propre police. Une seule échelle, une seule police : '
      + 'le rail écrit comme le reste de l’application.',
  },
  {
    chemin: 'public/jspdf.umd.min.js',
    quand: '25/08/2026',
    pourquoi: '364 Ko par installation hors ligne pour fabriquer un PDF que le '
      + 'navigateur sait imprimer lui-même. Le ticket s’imprime, il ne se génère pas.',
  },
  {
    chemin: 'public/jspdf-LICENCE.txt',
    quand: '01/09/2026',
    pourquoi: 'restée seule six jours après sa bibliothèque, sans plus rien à couvrir.',
  },
  {
    chemin: 'public/matin.js',
    quand: '25/08/2026',
    pourquoi: 'le briefing du matin. Le Point du jour ne porte plus que du TRAVAIL — '
      + 'le moteur est retiré, pas laissé en code mort. L’historique le garde si le '
      + 'patron le redemande.',
  },
  {
    chemin: 'tailles-logo.js',
    quand: '26/08/2026',
    pourquoi: 'le client qui allait chercher les tailles sur l’ancien site. Le tableau '
      + 'vit dans le CRM, avec son écran.',
  },
  {
    chemin: '.claude/launch.json.off',
    quand: '01/09/2026',
    pourquoi: 'une seconde configuration de lancement, versionnée et lue par rien.',
  },
  {
    chemin: 'archives/comptoir-2026-08-27',
    quand: '01/09/2026',
    pourquoi: 'les deux écrans du comptoir d’avant la simplification, huit mille lignes '
      + 'hors de `public/`. L’étiquette git `comptoir-avant-simplification` les rend '
      + 'd’un seul `git show` : le dépôt n’a pas à porter deux fois ce que git garde.',
  },
];

const revenus = PARTIS.filter((p) => fs.existsSync(path.join(RACINE, p.chemin)));
assert.deepStrictEqual(revenus, [],
  'des fichiers retirés sont revenus :\n  '
  + revenus.map((p) => `${p.chemin} (parti le ${p.quand})\n    → ${p.pourquoi}`).join('\n  ')
  + '\n  Si c’est voulu, retire l’entrée de PARTIS en disant pourquoi on revient dessus.');

// ET LA LISTE NE MENT PAS. Une entrée qui désignerait un chemin farfelu passerait
// pour une garantie sans en être une : on vérifie que chaque chemin a bien la
// forme d'un fichier du dépôt, et que son POURQUOI est écrit.
for (const p of PARTIS) {
  assert.ok(/^[\w./-]+$/.test(p.chemin), `${p.chemin} : chemin mal formé`);
  assert.ok(/^\d\d\/\d\d\/\d{4}$/.test(p.quand), `${p.chemin} : la date du retrait manque`);
  assert.ok(p.pourquoi && p.pourquoi.length > 40,
    `${p.chemin} : dis ce qu’on défait en le remettant, pas « code mort »`);
}

console.log(`✓ ce qui est parti ne revient pas : ${PARTIS.length} fichiers, chacun avec sa raison`);
