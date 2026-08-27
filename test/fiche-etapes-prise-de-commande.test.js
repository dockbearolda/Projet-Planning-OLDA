'use strict';

// LA FICHE REND LES ÉTAPES DE LA PRISE DE COMMANDE (26/08/2026)
//
// « Lorsque je clique sur le dossier, je dois retrouver toutes les étapes de ma
// prise de commande, à ce moment-là je peux cliquer dessus et naviguer dans les
// étapes déjà remplies. » (Charlie)
//
// Le détail archivé s'affichait en UNE liste de cinquante-sept champs à la
// file, sous « Détail complet — tout est modifiable » : on y trouvait tout et
// on n'y repérait rien. Or ces lignes ont été saisies EN ÉTAPES, celles de
// l'écran du comptoir. Ce fichier tient les trois choses qui font que le
// regroupement ne coûte rien :
//
//   1. CHAQUE LIGNE VA DANS SON ÉTAPE, et la dernière ramasse le reste — un
//      libellé qui change chez le patron ne fait disparaître aucune ligne.
//   2. L'INDEX D'ORIGINE SUIT LE CHAMP : le récapitulatif se réécrit par
//      POSITION, regrouper à l'écran ne doit renuméroter personne.
//   3. C'EST LE COMPOSANT DU COMPTOIR, pas un cousin : `.stepper` / `.step` de
//      charte.css, avec ses trois états.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RACINE, 'public/app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(RACINE, 'public/styles.css'), 'utf8');
const CHARTE = fs.readFileSync(path.join(RACINE, 'public/charte.css'), 'utf8');
const DEVIS = fs.readFileSync(path.join(RACINE, 'public/comptoir/demande-devis.html'), 'utf8');
const VENTE = fs.readFileSync(path.join(RACINE, 'public/comptoir/vente-directe.html'), 'utf8');

function morceau(nom, ouverture, fermeture) {
  const i = APP.indexOf(ouverture);
  assert.ok(i >= 0, `${nom} doit exister dans app.js`);
  const j = APP.indexOf(fermeture, i);
  assert.ok(j > i, `${nom} doit se refermer`);
  return APP.slice(i, j + fermeture.length);
}

// --- Le bac à sable : le rangement seul, sans écran --------------------------
const contexte = vm.createContext({});
vm.runInContext([
  morceau('LD_ETAPE_CLIENT', 'const LD_ETAPE_CLIENT = new Set(', ']);'),
  morceau('LD_ETAPES', 'const LD_ETAPES = {', '\n};'),
  morceau('ldEtapesDuRecap', 'function ldEtapesDuRecap(', '\n}'),
].join('\n'), contexte);
// Le bac à sable a ses propres prototypes : sans ce passage par le texte,
// `deepStrictEqual` refuse deux tableaux pourtant identiques. Les fonctions de
// tri (`porte`) disparaissent au passage, et c'est très bien : on éprouve le
// RANGEMENT, pas les règles qui l'ont produit.
const ranger = (source, client, details) => JSON.parse(JSON.stringify(vm.runInContext(
  'ldEtapesDuRecap(__s, __c, __d)',
  Object.assign(contexte, { __s: source, __c: client, __d: details }),
)));

// ---------------------------------------------------------------------------
// 1. LES ÉTAPES SONT CELLES DE L'ÉCRAN, mot pour mot
// ---------------------------------------------------------------------------
// Si le patron renomme une étape sur son écran, le libellé de la fiche doit
// suivre — sinon la vendeuse dit « à l'étape Contrôle » et le chef d'atelier
// cherche un onglet qui n'existe pas.
for (const titre of ['1. Besoins', '2. Projet', '3. Client', '4. Récapitulatif']) {
  assert.ok(DEVIS.includes(`>${titre}<`), `« ${titre} » doit être une étape de demande-devis.html`);
  assert.ok(APP.includes(`'${titre}'`), `« ${titre} » doit être reprise dans la fiche`);
}
for (const titre of ['1. Articles', '2. Client', '3. Paiement', '4. Ticket']) {
  assert.ok(VENTE.includes(`>${titre}<`), `« ${titre} » doit être une étape de vente-directe.html`);
  assert.ok(APP.includes(`'${titre}'`), `« ${titre} » doit être reprise dans la fiche`);
}

// ---------------------------------------------------------------------------
// 2. CHAQUE LIGNE TROUVE SON ÉTAPE — et rien ne se perd
// ---------------------------------------------------------------------------
const DETAILS_DEMANDE = [
  { k: 'Type de dossier', v: 'Demande de devis' },
  { k: 'Référence', v: '26.08.26-201' },
  { k: 'Client', v: 'Hôtel Esmeralda' },
  { k: 'WhatsApp', v: '06 90 11 22 33' },
  { k: 'Titre du projet', v: 'Tenues staff' },
  { k: 'Date souhaitée', v: '29/08/2026' },
  { k: 'Nombre de besoins', v: '2' },
  { k: 'Besoin 1 — Désignation', v: 'T-shirt col rond NS300' },
  { k: 'Besoin 1 — Couleur', v: 'Blanc' },
  { k: 'Besoin 2 — Désignation', v: 'Casquette K3025' },
  { k: 'Statut du logo', v: 'Reçu' },
  { k: 'Suite à donner', v: 'Devis à faire' },
  { k: 'Un libellé que personne n’a prévu', v: 'valeur' },
];
const CLIENT_INFO = [{ k: 'Type de client', v: 'Professionnel' }];

const etapes = ranger('Demande de devis', CLIENT_INFO, DETAILS_DEMANDE);
const parTitre = Object.fromEntries(etapes.map((e) => [e.titre, e.lignes.map((l) => l.k)]));
assert.deepStrictEqual(parTitre['1. Besoins'], ['Nombre de besoins', 'Besoin 1 — Désignation', 'Besoin 1 — Couleur', 'Besoin 2 — Désignation']);
// L'ÉTAPE « CONTRÔLE » A DISPARU LE 27/08 : le logo est descendu dans
// « Projet », avec le reste du dossier. Ses libellés restent RECONNUS — les
// dossiers d'avant les portent, et une ligne qui ne trouve pas son étape
// tomberait dans le ramasse-tout.
assert.deepStrictEqual(parTitre['2. Projet'],
  ['Titre du projet', 'Date souhaitée', 'Statut du logo', 'Suite à donner']);
// Le bloc `fiche.client` rejoint l'étape Client : c'est là qu'il a été saisi.
assert.deepStrictEqual(parTitre['3. Client'], ['Type de client', 'Client', 'WhatsApp']);
// LA DERNIÈRE ÉTAPE RAMASSE LE RESTE. Un libellé inconnu — parce que le patron
// a renommé un champ sur son écran — ne doit pas s'évaporer en silence.
assert.deepStrictEqual(parTitre['4. Récapitulatif'],
  ['Type de dossier', 'Référence', 'Un libellé que personne n’a prévu']);

// RIEN NE SE PERD, RIEN NE SE DÉDOUBLE.
const rendues = etapes.flatMap((e) => e.lignes);
assert.strictEqual(rendues.length, DETAILS_DEMANDE.length + CLIENT_INFO.length);

// ---------------------------------------------------------------------------
// 3. L'INDEX D'ORIGINE SUIT LE CHAMP — c'est ce qui empêche d'écrire la
//    couleur du besoin 2 dans la désignation du besoin 1
// ---------------------------------------------------------------------------
for (const l of rendues) {
  const origine = l.groupe === 'client' ? CLIENT_INFO : DETAILS_DEMANDE;
  assert.strictEqual(origine[l.i].k, l.k, `« ${l.k} » doit garder sa position d’origine`);
}
// Et la case où le champ se range est indexée par cette position, pas par
// l'ordre d'affichage.
assert.match(APP, /champs\[l\.groupe\]\[l\.i\] = champ/);
assert.match(APP, /ldSuivi\(`detail:\$\{l\.groupe\}:\$\{l\.i\}`/);

// Une vente directe se range dans SES étapes à elle.
const vente = ranger('Vente directe', [], [
  { k: 'Type de dossier', v: 'Vente directe' },
  { k: 'Article 1 — Désignation', v: 'Panneau signalisation' },
  { k: 'Total TTC', v: '1,00 €' },
  { k: 'Paiement', v: 'Espèces' },
  { k: 'Client', v: 'ATELIER OLDA Sarl' },
]);
assert.deepStrictEqual(vente.map((e) => e.titre), ['1. Articles', '2. Client', '3. Paiement', '4. Ticket']);
assert.deepStrictEqual(vente.find((e) => e.titre === '3. Paiement').lignes.map((l) => l.k), ['Total TTC', 'Paiement']);

// Une étape sans une seule ligne ne s'affiche pas : un onglet vide n'est pas
// une étape, c'est une impasse.
const maigre = ranger('Demande de devis', [], [{ k: 'Référence', v: '26.08.26-999' }]);
assert.deepStrictEqual(maigre.map((e) => e.titre), ['4. Récapitulatif']);

// ---------------------------------------------------------------------------
// 4. C'EST LE COMPOSANT DU COMPTOIR, pas un cousin
// ---------------------------------------------------------------------------
// Le fil vit dans charte.css — le seul fichier que le CRM et les deux parcours
// lisent tous les deux. La fiche s'y branche, elle ne le recopie pas.
assert.match(CHARTE, /\n\.stepper \{/);
assert.match(CHARTE, /\n\.step \{/);
assert.match(APP, /fil\.className = 'stepper ld-fil'/);
assert.match(APP, /'step ld-etape'/);
assert.doesNotMatch(CSS, /\.ld-etape \{[^}]*font-size/,
  'la bulle prend sa taille du composant partagé, elle ne la redéclare pas');
// `font-family` et NON le raccourci `font` : celui-ci annulerait l'interligne
// que .step vient de poser (défaut déjà payé ailleurs).
assert.match(CSS, /\.ld-etape \{[^}]*font-family: inherit/);
assert.doesNotMatch(CSS, /\.ld-etape \{[^}]*font: inherit/);
// Un panneau masqué porte `hidden` ET sa règle : une classe qui déclare son
// propre `display` défait `hidden` en silence.
assert.match(CSS, /\.ld-etape-panneau\[hidden\] \{ display: none; \}/);
// Les bulles gardent la même HAUTEUR d'un écran à l'autre : à parts égales,
// « 4. Récapitulatif » passait à la ligne et sa bulle faisait une tête de plus
// que les autres.
assert.match(CSS, /\.ld-fil \.step \{ flex: 0 1 auto; white-space: nowrap; \}/);
// Trois états, ceux du parcours : franchie (done), courante (active), à venir.
assert.match(APP, /' done' : ''/);
assert.match(APP, /classList\.toggle\('active', i === n\)/);
// Le clavier parcourt le fil : c'est un PC, pas une tablette.
assert.match(APP, /ArrowRight[\s\S]{0,120}ArrowLeft/);

console.log('✓ fiche : les étapes de la prise de commande se retrouvent et se cliquent');
