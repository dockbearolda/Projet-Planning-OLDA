'use strict';

// QUI EST AU POSTE — et l'étape « Demande » qui disparaît.
// ===========================================================================
// Le parcours « Demande de devis » s'ouvrait sur une étape entière qui ne
// posait aucune vraie question :
//
//   · la DATE du jour — c'est aujourd'hui, le champ était déjà en lecture
//     seule et rempli par le script ;
//   · « DEMANDE PRISE PAR » — la même personne, toute la journée, reposée à
//     chaque dossier ;
//   · le CANAL D'ENTRÉE — un élément de contexte de l'affaire, qui se décide
//     avec le reste du projet.
//
// La personne se nomme désormais UNE fois sur l'appareil (`public/poste.js`,
// « Qui est au poste ? », nom affiché en haut à droite), le canal est passé à
// l'étape « Projet », et l'étape d'ouverture n'existe plus.
//
// CE FICHIER GARDE TROIS CHOSES QUI TOMBERAIENT EN SILENCE :
//
//   1. LA COLLISION DE CLÉ. `olda.poste` était DÉJÀ pris : c'est l'identifiant
//      à trois caractères de la MACHINE, celui qui empêche deux tablettes hors
//      réseau de se donner la même référence de secours (des dossiers ont été
//      perdus comme ça). Y écrire un prénom lui fait échouer son
//      `/^[A-Z0-9]{3}$/` : il tire un nouvel identifiant à chaque chargement
//      ET efface le prénom au passage. Les deux clés doivent rester distinctes,
//      et celle que `pont.js` LIT doit être celle que `poste.js` ÉCRIT — sinon
//      le champ reste vide sans la moindre erreur.
//   2. LE FIL DES ÉTAPES. Les bulles portent leur numéro d'étape (`data-step`)
//      au lieu d'être comptées dans l'ordre du DOM : sans ça, retirer une étape
//      décale toutes les suivantes et le fil désigne la mauvaise bulle.
//   3. LES CHAMPS QUE LE PARCOURS LIT ENCORE. `#salesperson`, `#requestDate` et
//      `#source` alimentent toujours le récapitulatif, le ticket de l'atelier
//      et la fiche envoyée au planning. Ils changent de place, jamais de nom.
//
// Tout se lit dans les sources : ces écrans n'ont ni build ni DOM de test, et
// une nouvelle version d'un écran du patron se pose en REMPLAÇANT le fichier.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const POSTE = lire('public/poste.js');
const PONT = lire('public/comptoir/pont.js');
const DEVIS = lire('public/comptoir/demande-devis.html');
const INDEX = lire('public/index.html');
const APP = lire('public/app.js');
const SW = lire('public/sw.js');
const STYLES = lire('public/styles.css');
// Les écrans du patron portent leur style dans le document lui-même.
const STYLES_DEVIS = DEVIS;

// --- 1. Les deux clés du poste ne se marchent pas dessus --------------------

const cleQui = (POSTE.match(/CLE_POSTE\s*=\s*'([^']+)'/) || [])[1];
assert.ok(cleQui, 'poste.js doit déclarer la clé de stockage du nom');

const cleMachine = (PONT.match(/POSTE_KEY\s*=\s*'([^']+)'/) || [])[1];
assert.strictEqual(cleMachine, 'olda.poste',
  'l’identifiant de MACHINE garde sa clé historique (des références de secours en dépendent)');

assert.notStrictEqual(cleQui, cleMachine,
  'le nom de la personne ne peut pas partager la clé de l’identifiant machine : '
  + 'un prénom échoue au /^[A-Z0-9]{3}$/ du poste, qui se regénère et efface le prénom');

const cleLuePontJs = (PONT.match(/QUI_KEY\s*=\s*'([^']+)'/) || [])[1];
assert.strictEqual(cleLuePontJs, cleQui,
  'pont.js doit LIRE exactement la clé que poste.js ÉCRIT — sinon le champ reste vide sans erreur');

// --- 2. Le nom se reporte dans le champ, et suit la relève ------------------

assert.ok(/getElementById\('salesperson'\)/.test(PONT),
  'pont.js doit reporter le nom du poste dans le champ que le parcours connaît');
assert.ok(/if\s*\(!champ\)\s*return/.test(PONT),
  'la greffe doit s’abstenir sur la vente directe, qui n’a pas ce champ');
assert.ok(/updateSidebar\?\.\(\)/.test(PONT),
  'le panneau latéral doit réapprendre le nom : sinon le dossier est signé mais affiche « personne au poste »');
assert.ok(/e\.data\.type === 'OLDA_POSTE'/.test(PONT) && /addEventListener\('storage'/.test(PONT),
  'la relève en cours de journée doit arriver au cadre : message du CRM ET évènement storage');
assert.ok(/e\.origin !== location\.origin/.test(PONT),
  'un message venu d’ailleurs ne doit pas pouvoir renommer la personne au poste');

// --- 3. L'étape « Demande » ne pose plus ses trois questions ----------------

assert.ok(!/<select id="salesperson"/.test(DEVIS),
  '« Demande prise par » ne se choisit plus à la main : le nom vient du poste');
assert.ok(!/Recueillir les besoins →/.test(DEVIS),
  'l’étape d’ouverture n’a plus de bouton : on n’y passe plus');
assert.ok(!/onclick="goStep\(2\)"/.test(DEVIS),
  'plus personne ne doit valider l’étape 1');
assert.ok(!/onclick="showStep\(1\)"/.test(DEVIS),
  'plus de « Retour » vers une étape qui n’existe plus');

const step1 = (DEVIS.match(/<section id="step1"[^>]*>([\s\S]*?)<\/section>/) || [])[1];
assert.ok(step1 !== undefined, 'la section step1 doit rester : showStep parcourt step1..step7');
assert.ok(/class="hidden"/.test(DEVIS.match(/<section id="step1"[^>]*>/)[0]),
  'la section step1 ne doit plus jamais s’afficher');
assert.ok(!/<label>/.test(step1),
  'la section step1 ne porte plus aucun champ à remplir');
for (const id of ['requestDate', 'requestDateDisplay', 'salesperson']) {
  assert.ok(new RegExp(`id="${id}"[^>]*type="hidden"`).test(step1),
    `#${id} reste dans le document (le récapitulatif, le ticket et la fiche le lisent)`);
}

// --- 4. Le canal d'entrée a bien déménagé dans « Projet » -------------------

const step3 = (DEVIS.match(/<section id="step3"[\s\S]*?<\/section>/) || [''])[0];
assert.ok(/<select id="source"/.test(step3),
  'le canal d’entrée doit vivre dans l’étape « Construction du projet »');
assert.strictEqual((DEVIS.match(/<select id="source"/g) || []).length, 1,
  'un seul canal d’entrée dans le document, sinon $(\'source\') désigne le mauvais');
// Depuis le 21/08 l'étape ramasse TOUS ses manques avant de rendre la main
// (les champs virent au rouge ensemble) : le contrôle du canal a changé de
// forme, pas d'étape.
assert.ok(/if\(!\$\('source'\)\.value\)m\.push\(\['source'/.test(DEVIS),
  'le canal se contrôle désormais avec le projet');
assert.ok(!/if\(n===1\)\{/.test(DEVIS),
  'validateStep n’a plus d’étape 1 à valider');
// Le SECOND contrôle — la liste `STEPS` du bandeau « Dossier incomplet » — a
// disparu avec le bandeau le 24/08. Il doublait celui-ci et pouvait s'en
// écarter sans que rien ne le dise. Le canal d'entrée n'est plus réclamé qu'à
// un seul endroit : l'étape elle-même, au moment où on peut y répondre.
assert.ok(!/var STEPS=/.test(DEVIS), 'plus de seconde liste des champs obligatoires');
assert.strictEqual((DEVIS.match(/!\$\('source'\)\.value/g) || []).length, 1,
  'le canal d’entrée n’est CONTRÔLÉ qu’à un seul endroit');
assert.ok(!/m\.push\('Canal d’entrée'\)/.test(DEVIS),
  '… les mentions qui restent sont des libellés du récapitulatif, pas des contrôles');

// --- 5. Le fil des étapes : renuméroté, et piloté par data-step -------------

const stepper = (DEVIS.match(/<div class="stepper[\s\S]*?<\/div>\s*<\/div>/) || [''])[0];
const bulles = [...stepper.matchAll(/<div class="step([^"]*)"\s+data-step="(\d+)">([^<]*)<\/div>/g)]
  .map((m) => ({ cache: m[1].includes('hidden'), etape: Number(m[2]), texte: m[3] }));
assert.strictEqual(bulles.length, 6, 'les six bulles doivent toutes porter leur numéro d’étape');

const visibles = bulles.filter((b) => !b.cache);
assert.deepStrictEqual(visibles.map((b) => b.texte),
  ['1. Besoins', '2. Projet', '3. Contrôle', '4. Client', '5. Récapitulatif'],
  'le fil visible repart de 1 sur les besoins : plus d’étape « Demande »');
assert.deepStrictEqual(visibles.map((b) => b.etape), [2, 3, 4, 5, 7],
  'chaque bulle garde le numéro INTERNE de son étape (le parcours, lui, n’a pas été renuméroté)');

assert.ok(/const s=Number\(el\.dataset\.step\);el\.classList\.toggle\('active',s===n\);el\.classList\.toggle\('done',s<n\)/.test(DEVIS),
  'showStep doit allumer la bulle par son data-step, pas par sa position dans le DOM');
assert.ok(/let currentStep=2/.test(DEVIS),
  'le parcours s’ouvre sur les besoins');
assert.ok(/<section id="step2">/.test(DEVIS),
  'l’étape des besoins doit être visible dès l’ouverture (sinon un écran vide avant que le script tourne)');

// Le fil ne tient plus par un nombre de colonnes : deux bulles masquées sur
// une grille de 7 laissaient deux colonnes vides.
assert.ok(!/\.stepper\{display:grid/.test(DEVIS),
  'le fil des étapes ne doit plus dépendre d’un nombre de colonnes figé');
assert.ok(/\.stepper\{display:flex;flex-wrap:wrap/.test(DEVIS),
  'seules les bulles VISIBLES se partagent la ligne');

// --- 6. Une bulle franchie passe au vert ------------------------------------

const done = (DEVIS.match(/\.step\.done\{([^}]*)\}/) || [])[1];
assert.ok(done, 'la règle .step.done doit exister');
assert.ok(/background:var\(--success\)/.test(done),
  'une étape validée passe au VERT : c’est un état, pas un gris de plus');
// Depuis le 22/08 le vert ne vient plus d'un jeton propre à cet écran : c'est
// celui de la charte (« --success », #166534), déclaré dans charte.css.
const CHARTE = lire('public/charte.css');
assert.ok(/--success:\s*#166534/.test(CHARTE),
  'le vert de validation est celui de la charte, pas une teinte de cet écran');
assert.ok(!/\.step\.done\{background:#e2e8f0/.test(DEVIS),
  'l’ancien gris bleuté ne doit plus traîner');

// --- 7. Le nom s'affiche en haut à droite, et survit hors ligne -------------

assert.ok(/id="posteBtn"/.test(INDEX),
  'le nom de la personne au poste s’affiche en haut à droite');
assert.ok(!/class="avatar"/.test(INDEX),
  'la pastille décorative « O » cède la place — sinon deux pastilles côte à côte');
assert.ok(!/^\.avatar \{/m.test(STYLES),
  'le style de l’ancienne pastille ne doit pas rester en place sans personne pour le porter');
assert.ok(/monterPoste\(EMPLOYEES\)/.test(APP),
  'la liste des employés reste unique : app.js la passe au module, il ne la recopie pas');
assert.ok(/'\/poste\.js'/.test(SW),
  'poste.js est importé statiquement par app.js : absent du cache, le planning ne s’ouvre plus hors ligne');
assert.ok(/modulepreload" href="poste\.js"/.test(INDEX),
  'poste.js s’annonce avec les autres modules (un aller-retour de moins en 4G)');

// L'écran ne se referme pas tant que personne ne s'est nommé : un dossier
// signé « » ne se rattrape pas après coup.
assert.ok(/if \(!lirePoste\(\)\) return; \/\/ l'écran ne se franchit pas sans nom/.test(POSTE),
  'l’écran « Qui est au poste ? » ne doit pas se fermer sans nom');
assert.ok(/if \(!lirePoste\(\)\) ouvrir\(\);/.test(POSTE),
  'un appareil qui ne s’est jamais nommé doit poser la question tout seul');

// `hidden` posé en JS ne masque rien quand la classe porte son propre
// `display` : l'écran resterait affiché ET focusable (piège maison).
assert.ok(/\.poste-ecran:not\(\[hidden\]\) \{\s*\n\s*display: grid;/.test(STYLES),
  'le display de l’écran doit rester attaché à :not([hidden])');
assert.ok(!/^\.poste-ecran \{[^}]*display:/m.test(STYLES),
  '.poste-ecran ne doit pas porter un display nu, il défairait hidden');

// Tablette et téléphone : la cible reste prenable au doigt.
assert.ok(/\.poste \{[\s\S]*?height: 44px;/.test(STYLES),
  'le bouton du poste garde une cible de 44 px');
assert.ok(/\.poste-choix-btn \{[\s\S]*?min-height: 64px;/.test(STYLES),
  'les quatre noms se tapent au doigt');

// --- 8. Les deux familles de besoin -----------------------------------------
// Le formulaire de recueil est celui d'« AUTRE » — le seul qui ait jamais
// existé, et il porte désormais le catalogue du rayon. Le TEXTILE a le sien
// depuis le 21/08 : il chiffre tout seul, c'est lui qui s'ouvre en premier.

const step2 = (DEVIS.match(/<section id="step2">[\s\S]*?<\/section>/) || [''])[0];
assert.ok(/id="besoinTuileTextile"[^>]*data-type="textile"/.test(step2),
  'l’étape des besoins doit offrir une entrée Textile');
assert.ok(/id="besoinTuileAutre"[^>]*data-type="autre"/.test(step2),
  'et une entrée Autre — celle du catalogue et de la saisie libre');
assert.ok(/id="besoinTuileTextile"[^>]*class="besoin-tuile is-on"|class="besoin-tuile is-on"[^>]*id="besoinTuileTextile"/.test(step2),
  '« Textile » est allumé par défaut : c’est le parcours qui chiffre');
assert.ok(/<div id="besoinAutreForm" class="hidden">[\s\S]*id="needFormTitle"[\s\S]*id="saveNeedBtn"/.test(step2),
  'le formulaire entier reste dans l’enveloppe « Autre » — titre et bouton compris');
assert.ok(/<div id="besoinTextileForm">[\s\S]*id="txSaveBtn"/.test(step2),
  'la tuile Textile ne mène plus à un panneau muet : elle ouvre le formulaire qui chiffre');
// Le catalogue du rayon (PR #151) vit dans « Autre » et n'a pas bougé.
assert.ok(/id="catProduit"/.test(step2) && /id="catQte"/.test(step2),
  'le catalogue du rayon reste dans l’onglet « Autre »');

// Les icônes sont dessinées dans la page. Rien ne vient d'un autre domaine :
// un poste doit s'ouvrir sans dépendre d'un tiers joignable.
const tuiles = (step2.match(/<div class="besoin-type"[\s\S]*?<\/div>\s*<div id="besoinTextileForm">/) || [''])[0];
assert.strictEqual((tuiles.match(/<svg /g) || []).length, 2,
  'chaque tuile porte son icône en SVG dans la page');
assert.ok(!/<img|fonts\.googleapis|material-symbols/.test(tuiles),
  'aucune icône ne doit venir d’un autre domaine ni d’une police externe');

// Basculer sur Textile en pleine modification laisserait « Enregistrer la
// modification » armé dans un formulaire masqué : le besoin serait réécrit
// bien plus tard, sans que personne l'ait demandé.
assert.ok(/if\(textile&&editingNeed>=0\)cancelNeedEdit\(\);/.test(DEVIS),
  'basculer sur Textile doit rendre une modification en cours à son besoin');
// Chaque ligne se remodifie dans SON formulaire : une ligne « Autre » ramène
// à l'onglet Autre, une ligne textile à celui qui porte tailles et marquage.
assert.ok(/function editNeed\(i\)\{if\(needs\[i\]&&needs\[i\]\.textile\)return editTextileNeed\(i\);choisirTypeBesoin\('autre'\);/.test(DEVIS),
  '« Modifier » depuis la liste doit rouvrir le formulaire correspondant à la ligne');
assert.ok(/function editTextileNeed\(i\)\{\n\s*choisirTypeBesoin\('textile'\);/.test(DEVIS),
  '… et la ligne textile rouvre bien l’onglet Textile');
assert.ok(/b\.setAttribute\('aria-pressed',String\(on\)\)/.test(DEVIS),
  'la tuile choisie doit s’annoncer, pas seulement se colorer');

// À spécificité égale, c'est la DERNIÈRE règle déclarée qui gagne : la règle
// étroite doit vivre APRÈS la règle de base, sinon les deux tuiles restent
// côte à côte à 133 px sur un téléphone.
const base = STYLES_DEVIS.indexOf('.besoin-type{display:grid');
const etroit = STYLES_DEVIS.indexOf('@media(max-width:700px){.besoin-type{grid-template-columns:1fr}}');
assert.ok(base > -1 && etroit > base,
  'la règle étroite des tuiles doit être déclarée APRÈS la règle de base');
assert.ok(/\.besoin-tuile\{[^}]*min-height:76px/.test(STYLES_DEVIS),
  'la tuile est le premier geste de l’étape : elle se prend au doigt');

console.log('✓ poste : le nom du poste signe les dossiers, l’étape « Demande » a disparu, le besoin se choisit');
