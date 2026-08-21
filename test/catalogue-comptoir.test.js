'use strict';

// LE CATALOGUE DU COMPTOIR — un produit, une quantité, à la demande.
// ===========================================================================
// L'étape « Recueil des besoins » n'offrait qu'un formulaire : catégorie,
// désignation, quantité, référence, couleur, production, commentaire. Pour
// vendre un porte-clés en bois, la vendeuse remplissait six champs — debout,
// au comptoir, le client en face. Les objets que l'atelier a EN RAYON sont
// désormais des LIGNES dans une liste déroulante rangée par famille : elle
// prend le produit, pose la quantité, ajoute à la demande, recommence.
//
// CE FICHIER GARDE CE QUI TOMBERAIT EN SILENCE :
//
//   1. LE PRODUIT FANTÔME. `Number('')` vaut ZÉRO : « Ajouter à la demande »
//      sans rien choisir posait la PREMIÈRE ligne du catalogue dans le devis
//      — vu en cliquant, jamais en lisant.
//   2. LE MÊME PRODUIT REPRIS. Il ajoute ses unités à la ligne qui existe,
//      il n'en ouvre pas une deuxième : un devis ne part pas avec deux fois
//      le même article.
//   3. LA FORME DU BESOIN. Le besoin posé par le catalogue est celui du
//      formulaire, aux mêmes clés — tout ce qui vit en aval le lit sans rien
//      savoir du catalogue. Son prix reste ABSENT (`NaN`, pas 0) : une
//      demande de devis sans prix ne doit pas s'afficher « 0 € ».
//   4. LA VARIANTE DANS LA LIGNE. Bois/liège, clair/foncé, taille, coloris de
//      tasse : chaque variante est SA propre ligne du menu. Aucun deuxième
//      choix à faire, et deux variantes ne se confondent jamais à la demande.
//   5. LA SAISIE MANUELLE. Elle reste EN HAUT : le catalogue ne couvre pas
//      tout (un textile, une commande spéciale) et rien de ce qui se faisait
//      avant ne doit devenir plus long à faire. « Modifier » doit rouvrir ce
//      formulaire replié, sinon le bouton de la liste ne fait rien de visible.
//
// Tout se lit dans les sources : ces écrans n'ont ni build ni DOM de test, et
// une nouvelle version d'un écran du patron se pose en REMPLAÇANT le fichier.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const DEVIS = lire('public/comptoir/demande-devis.html');
const step2 = (DEVIS.match(/<section id="step2">[\s\S]*?<\/section>/) || [''])[0];

// --- 1. Le bandeau qui expliquait l'étape a disparu -------------------------

assert.ok(!/Renseigne ce que le client demande/.test(DEVIS),
  'le bandeau explicatif de l’étape des besoins doit avoir disparu');

// --- 2. Une ligne : produit, quantité, demande ------------------------------

assert.ok(/<select id="catProduit"[^>]*><\/select>/.test(step2),
  'le catalogue est une LISTE DÉROULANTE, remplie par le script');
assert.ok(/id="catQte"[^>]*type="number"[^>]*min="1"/.test(step2),
  'la quantité se pose à côté du produit');
assert.ok(/onclick="ajouterALaDemande\(\)"/.test(step2),
  '« Ajouter à la demande » met la ligne dans le devis');
assert.ok(!/catStatus/.test(DEVIS),
  'aucun message ne répète l’ajout : la ligne qui apparaît dans la demande EST la confirmation');

// LA SAISIE MANUELLE EST LA PREMIÈRE LIGNE DU MENU — elle se prend au même
// endroit que les produits, et son formulaire s'ouvre dessous.
assert.ok(/<option value="__manuel">\+ Saisie manuelle/.test(DEVIS),
  'la saisie manuelle se choisit dans la liste, en tête');
assert.ok(/let html='<option value=""[^']*'\+\n\s*'<option value="__manuel"/.test(DEVIS),
  '… juste après le choix vide, avant la première famille');
assert.ok(/<select id="catProduit" onchange="choisirProduitCatalogue\(\)">/.test(step2),
  'la choisir doit faire quelque chose tout de suite');
assert.ok(/function choisirProduitCatalogue\(\)\{[\s\S]*?sel\.value='';[\s\S]*?basculerSaisieManuelle\(true\)/.test(DEVIS),
  'elle ouvre le formulaire ET rend la liste à vide : ce n’est pas un produit');
const iSelect = step2.indexOf('id="catProduit"');
const iForm = step2.indexOf('id="besoinManuel"');
assert.ok(iSelect > -1 && iForm > iSelect,
  'le formulaire détaillé s’ouvre SOUS la ligne où on vient de le choisir');
assert.ok(!/catManuelBtn|cat-manuel|cat-top/.test(DEVIS),
  'le bouton « Saisie manuelle » et son explication ont disparu de l’écran');
// Le repli ne dépend plus d'un bouton : « Modifier » doit encore rouvrir le
// formulaire, sinon le bouton de la liste ne fait plus rien de visible.
assert.ok(/function basculerSaisieManuelle\(force\)\{\n\s*const box=\$\('besoinManuel'\);if\(!box\)return;/.test(DEVIS),
  'le repli ne doit plus exiger un bouton qui n’existe plus');
assert.ok(/function cancelNeedEdit\(\)\{[\s\S]*?basculerSaisieManuelle\(false\)\}/.test(DEVIS),
  '« Fermer » et « Annuler » referment le formulaire');
assert.ok(/<div id="besoinAutreForm" class="hidden">[\s\S]*id="needFormTitle"[\s\S]*id="saveNeedBtn"/.test(step2),
  'le formulaire entier reste dans l’enveloppe « Autre » — titre et bouton compris');
assert.ok(/<div id="besoinManuel" class="hidden">[\s\S]*id="needFormTitle"/.test(step2),
  'le formulaire détaillé est REPLIÉ, pas supprimé');
// Une ligne TEXTILE se remodifie dans son propre formulaire : la router vers
// « Autre » perdrait tailles, marquage et négociation.
assert.ok(/function editNeed\(i\)\{if\(needs\[i\]&&needs\[i\]\.textile\)return editTextileNeed\(i\);choisirTypeBesoin\('autre'\);basculerSaisieManuelle\(true\);/.test(DEVIS),
  '« Modifier » doit rouvrir le formulaire replié — celui qui correspond à la ligne');
assert.ok(/function editNeed[\s\S]*?scrollIntoView/.test(DEVIS),
  '… et l’amener sous les yeux : il s’ouvre en haut, le bouton est en bas de la liste');
// Depuis le 21/08 la tuile TEXTILE s'ouvre en premier : `catProduit` vit dans
// « Autre » et se retrouve alors masqué. Le champ visé suit donc l'onglet
// affiché — l'exigence n'a pas changé, son application couvre un cas de plus.
assert.ok(/n===2&&!needs\.length\)return fail\(\$\('besoinAutreForm'\)\.classList\.contains\('hidden'\)\?'txRef':'catProduit'/.test(DEVIS),
  'l’erreur « ajoute au moins un besoin » doit pointer sur un élément VISIBLE, pas sur un champ replié ou masqué');
assert.ok(/if\(editingNeed<0\)\$\('needFormTitle'\)\.textContent/.test(DEVIS),
  'un ajout à la demande ne doit pas effacer « Modifier le besoin n°X »');

// Le doigt : ces trois-là se prennent debout, au comptoir.
assert.ok(/\.cat-ligne select,\.cat-ligne input,\.cat-ligne button\{min-height:52px\}/.test(DEVIS),
  'produit, quantité et bouton gardent une cible tactile pleine');
assert.ok(/@media\(max-width:700px\)\{\.cat-ligne\{grid-template-columns:1fr\}/.test(DEVIS),
  'sur un téléphone la ligne se déplie en trois rangées');

// La demande se lit en LIGNES, pas en cartes : dix articles tenaient sur trois
// écrans et la vendeuse ne voyait plus ce qu'elle venait d'ajouter.
const renderNeedsSrc = (DEVIS.match(/function renderNeeds\(\)\{[\s\S]*?\n/) || [''])[0];
assert.ok(/need-ligne/.test(renderNeedsSrc) && !/need-card/.test(renderNeedsSrc),
  'chaque article de la demande tient sur une ligne');
assert.ok(/need-qte[\s\S]*?need-nom/.test(renderNeedsSrc),
  'la quantité vient AVANT le nom : c’est elle qu’on relit');
assert.ok(/editNeed\(\$\{i\}\)/.test(renderNeedsSrc) && /deleteNeed\(\$\{i\}\)/.test(renderNeedsSrc),
  'modifier et supprimer restent sur la ligne');
assert.ok(/\.need-actions button\{min-height:44px/.test(DEVIS),
  'les deux boutons gardent leur cible tactile malgré la ligne serrée');

// CHAQUE ARTICLE PORTE SA PERSONNALISATION, sur sa ligne : c'est ce que
// l'atelier grave, brode ou imprime, et ça change d'un article à l'autre dans
// la même demande. Le texte va dans `comment` — le champ que la fiche, le
// devis, le ticket de l'atelier et le message au client lisent DÉJÀ ligne par
// ligne. Un champ neuf serait mort en silence.
assert.ok(/class="need-perso"[^>]*oninput="setNeedPerso\(\$\{i\}/.test(renderNeedsSrc),
  'chaque article de la demande porte son champ de personnalisation');
assert.ok(/value="\$\{esc\(n\.comment\|\|''\)\}"/.test(renderNeedsSrc),
  'ce champ montre ce qui est déjà écrit pour cet article');
assert.ok(!/n\.comment\]/.test(renderNeedsSrc),
  'le détail en petit ne répète plus la personnalisation : elle a son champ');
assert.ok(/function setNeedPerso\(i,valeur\)\{[^}]*needs\[i\]\.comment=valeur/.test(DEVIS),
  'la frappe va dans le besoin, à l’indice de sa ligne');
assert.ok(!/function setNeedPerso[^}]*renderNeeds\(\)/.test(DEVIS),
  'écrire ne REDESSINE PAS la liste : la ligne reprise sous les doigts perdrait le curseur');
assert.ok(/\.need-perso\{[^}]*min-height:44px/.test(DEVIS),
  'le champ de personnalisation se prend au doigt');
// Celui qui chiffre doit voir ce qu'il chiffre : une gravure ne se devine pas.
assert.ok(/Personnalisation :<\/b> \$\{esc\(n\.comment\)\}/.test(DEVIS),
  'la personnalisation se relit à l’étape des prix');

// --- La colonne de droite est partie ---------------------------------------
// La carte « PROJET » répétait la référence (elle est sur l'étape), le statut
// (le fil des étapes le dit) et la liste de ce qui manque (chaque étape la
// donne au-dessus de son bouton). Elle enfermait la saisie dans un couloir de
// 320 px et s'échappait dès qu'on descendait. Le résumé rapide qui vivait à
// côté est retiré lui aussi — on verra plus tard où il se pose.

assert.ok(!/<aside class="sidebar">/.test(DEVIS),
  'la colonne de droite a disparu : la saisie prend toute la largeur');
// Retirer un bloc à la main laisse vite un `<` de trop ou de moins : la page
// affichait « /div › » en clair, en bas, sans la moindre erreur.
assert.ok(!/(^|[^<])\/div>/.test(DEVIS), 'aucune balise fermante amputée ne traîne dans la page');
assert.ok(/\.layout\{grid-template-columns:minmax\(0,1fr\)\}/.test(DEVIS),
  'il n’y a plus de colonne à réserver');
['sideTitle', 'sideStatus', 'sidePrise', 'progressText', 'progressBar', 'missingList',
  'getMissing', 'completion(', 'barre-bas'].forEach((mort) => {
  assert.ok(!DEVIS.includes(mort),
    `« ${mort} » ne doit laisser ni élément ni code mort derrière lui`);
});

// LE PIÈGE : `pont.js` appelle `window.updateSidebar()` par son nom, et une
// quinzaine d'endroits la déclenchent à chaque frappe. Sans support à l'écran
// elle ne doit RIEN casser — sinon l'amorçage s'arrête derrière (menu de
// produits vide, aucun écouteur posé), ce qui s'est produit pour de vrai.
const majSrc = (DEVIS.match(/function updateSidebar\(\)\{[\s\S]*?\n/) || [''])[0];
assert.ok(majSrc, 'le résumé doit rester une fonction nommée : pont.js l’appelle');
const majFn = new Function('ctx', `with(ctx){${majSrc}
  return updateSidebar}`)({
  $: () => null, needs: [], categories: () => [], selectedClient: null,
  clientName: () => '', quoteTotals: () => ({ ttc: 0 }), rollInt() {}, rollMoney() {},
});
assert.doesNotThrow(majFn, 'sans support à l’écran, le résumé ne doit pas casser');

// --- Ce qui manque se dit dans le champ, pas dans un panneau ---------------
// Le panneau « ✓ Toutes les informations obligatoires… / ⚠ À compléter avant
// de continuer » répétait en vert ce qu'on venait de faire, et surtout il
// DÉSACTIVAIT le bouton : on ne pouvait donc jamais cliquer pour découvrir
// quel champ manquait. Le bouton reste actif, et les champs manquants virent
// au rouge avec leur message dessous.

assert.ok(!/Toutes les informations obligatoires de cette étape/.test(DEVIS),
  'le panneau vert qui répétait le travail fait a disparu');
assert.ok(!/liveCheck/.test(DEVIS), 'le panneau par étape ne se construit plus');
assert.ok(!/btn\.disabled\s*=\s*true/.test(DEVIS),
  'le bouton « suivant » ne se désactive plus : c’est le clic qui révèle ce qui manque');
assert.ok(!/button\.blocked\{/.test(DEVIS), 'le style du bouton bloqué part avec lui');

assert.ok(/function failAll\(manques\)/.test(DEVIS),
  'les manques se marquent TOUS d’un coup, pas un clic par champ');
assert.strictEqual((DEVIS.match(/return failAll\(m\)/g) || []).length, 3,
  'les étapes Projet, Contrôle et Tarification marquent chacune tous leurs manques');
assert.ok(/function marquer\(id,msg,premier\)\{[^}]*classList\.add\('invalid'\)/.test(DEVIS),
  'un champ qui manque devient rouge');
assert.ok(/if\(premier\)\{[^}]*scrollIntoView/.test(DEVIS),
  'seul le premier manque prend le focus et le défilement');
assert.ok(/if\(premier!==false\)\$\('projectPriorityGroup'\)\.scrollIntoView/.test(DEVIS),
  'la rangée de priorité ne ramène plus la page à elle quand le focus est ailleurs');
assert.ok(/\['input','change'\]\.forEach\(ev=>document\.addEventListener/.test(DEVIS),
  'le rouge s’efface dès que le champ est rempli : le garder ferait douter');

// --- 3. Le catalogue du patron, produit par produit -------------------------

const ATTENDU = {
  'Art de la table': {
    'Bouchon Bois': [], 'Coffret à Vin': [], 'Couteau Multi': ['Bois', 'Liège'],
    'Décapsuleur Bois': [], 'Flasque Bois': ['Clair', 'Foncé'],
    'Limonadier Bois': ['Clair', 'Foncé'], 'Service à Whisky': [], 'Shaker inox': [],
    'Dessous de plat Liège': [], 'Dessous de verre Liège': [], 'Plateau Liège': [],
    'Pelle Bois Aulne': [], 'Planche à découper Aulne': ['Grande', 'Petite'],
    'Planche bois Acacia': ['Petite', 'Carré', 'Rectangle'],
  },
  'Du quotidien': {
    'Cendrier Liège': [], 'Lot brosse et peigne bois': [], 'Miroir Liège': ['XL', 'Petit'],
    'Pince à billet': ['Argent', 'Or'], 'Porte Carte Liège': [], 'Porte Monnaie Liège': [],
    'Porte sac': [], 'Sabot veilleuse bois': [],
  },
  Voyage: {
    'Etui à Passeport Cuir PU': ['Bleu Brume', 'Brun', 'Noir', 'Rose'],
    'Identificateur Valise Cuir PU': ['Bleu Brume', 'Brun', 'Noir', 'Rose'],
    'Identificateur Valise Liège': [], 'Identificateur Valise Métal': [],
  },
  Gourdes: {
    'Gourde 500 ml Métal': ['Blanc', 'Noir'],
    'Gourde 800 ml Métal': ['Blanc', 'Noir', 'Inox'],
  },
  'Jeux & loisirs': {
    Dominos: [], 'Jeux de Cartes': [], Mikado: [], Morpion: [], Yoyo: [], Puzzle: [],
    'Raquette Bois': [],
  },
  Papeterie: {
    'Bloc Note Liège': ['A5', 'A6'], 'Crayon papier bois': [],
    'Grand Bloc Note Similicuir A5': ['Bleu'], 'Stylo à bille en bois': [],
  },
  'Porte-clés': {
    'Porte-Clés Bois Tir Bouchon': [], 'Porte-Clés Bois vintage': ['rectangle', 'rond'],
    'Porte-Clés Décapsuleur': ['Bois', 'Similicuir', 'Acrylique'],
    'Porte-Clés Flotteur Liège': ['Bleu', 'Marron'],
  },
};

// Le bloc du catalogue s'exécute pour de vrai : ce que fait « Ajouter au
// demande » ne se lit pas dans une expression régulière.
function bacASable() {
  const bloc = (DEVIS.match(/\/\* CATALOGUE-COMPTOIR[\s\S]*?\/\* \/CATALOGUE-COMPTOIR \*\//) || [''])[0];
  assert.ok(bloc, 'le bloc du catalogue doit être délimité dans la page');
  const faux = (extra) => Object.assign({
    value: '', innerHTML: '', textContent: '',
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, focus() {}, scrollIntoView() {},
  }, extra || {});
  const els = { catProduit: faux(), catQte: faux({ value: '1' }) };
  const echecs = [];
  const ctx = {
    needs: [],
    $: (id) => (els[id] || (els[id] = faux())),
    esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    clearErrors() {},
    fail(id, msg) { echecs.push({ id, msg }); return false; },
    renderNeeds() {}, updateSidebar() {},
  };
  const fabrique = new Function('ctx', `with(ctx){${bloc}
    return {CATALOGUE,ajouterALaDemande,catCle,lignesCatalogue,remplirSelectCatalogue};}`);
  return Object.assign(fabrique(ctx), { needs: ctx.needs, els, echecs });
}

const cat = bacASable();
const parFamille = new Map(cat.CATALOGUE.map((f) => [f.famille, f]));

for (const [famille, produits] of Object.entries(ATTENDU)) {
  const f = parFamille.get(famille);
  assert.ok(f, `la famille « ${famille} » doit être au catalogue`);
  for (const [nom, variantes] of Object.entries(produits)) {
    const it = f.items.find((o) => o.n === nom);
    assert.ok(it, `« ${nom} » doit être au catalogue (${famille})`);
    assert.deepStrictEqual(it.v || [], variantes,
      `les variantes de « ${nom} » sont celles du patron`);
  }
}

// Les 17 tasses : la couleur du DEHORS, puis celle du DEDANS.
const tasses = parFamille.get('Tasse céramique 350 ml');
assert.ok(tasses, 'la famille des tasses doit exister');
assert.strictEqual(tasses.items.length, 17, 'TC 01 à TC 17 — les dix-sept');
assert.strictEqual(tasses.items[0].note, 'Rouge / Blanc', 'TC 01 : rouge dehors, blanc dedans');
assert.strictEqual(tasses.items[16].note, 'Noir / Orange', 'TC 17 : noir dehors, orange dedans');
assert.ok(tasses.items.every((t) => /^Tasse céramique 350 ml TC \d\d$/.test(t.label)),
  'la ligne du devis dit « Tasse céramique 350 ml TC 0X » : « TC 0X » seul ne dit rien à l’atelier');
assert.ok(tasses.items.every((t) => /\(ext\.\).*\(int\.\)/.test(t.color)),
  'la couleur d’une tasse dit lequel des deux tons est dehors');
assert.strictEqual(new Set(tasses.items.map((t) => t.color)).size, 17,
  'deux tasses ne doivent pas porter la même couleur');

// --- 4. Le menu déroulant : des lignes, rangées par famille -----------------

const groupes = cat.lignesCatalogue();
assert.deepStrictEqual(groupes.map((g) => g.famille),
  Object.keys(ATTENDU).concat(['Tasse céramique 350 ml']),
  'les familles du menu sont celles du patron, dans son ordre');

const plat = groupes.flatMap((g) => g.lignes);
assert.strictEqual(new Set(plat.map((l) => l.famille + '|' + l.texte)).size, plat.length,
  'deux lignes du menu ne doivent pas porter le même intitulé dans la même famille');
['Couteau Multi — Bois', 'Couteau Multi — Liège', 'Flasque Bois — Foncé',
  'Gourde 800 ml Métal — Inox', 'TC 01 — Rouge / Blanc', 'Shaker inox'].forEach((t) => {
  assert.ok(plat.some((l) => l.texte === t), `« ${t} » doit être une ligne du menu`);
});

cat.remplirSelectCatalogue();
const html = cat.els.catProduit.innerHTML;
assert.ok(/^<option value="">Choisir un produit/.test(html),
  'le menu s’ouvre sur un choix VIDE : sinon un produit part sans avoir été choisi');
assert.strictEqual((html.match(/<optgroup /g) || []).length, groupes.length,
  'chaque famille est un groupe du menu — la vendeuse cherche par famille');
assert.strictEqual((html.match(/<option value="\d+"/g) || []).length, plat.length,
  'chaque ligne vendable est une ligne du menu');
assert.ok(html.includes('<optgroup label="TASSE CÉRAMIQUE 350 ML (extérieur / intérieur)">'),
  'le groupe des tasses dit lequel des deux tons est le dehors');
// Sur macOS, Chrome dessine le menu avec le contrôle du système et IGNORE le
// CSS : la famille ne se distingue que par son TEXTE.
assert.ok(/label="[A-ZÀ-Ý0-9 '’&-]+(\([^)]*\))?"/.test(html),
  'la famille s’écrit en capitales : c’est ce qui se lit dans un menu natif');
assert.strictEqual(cat.CATALOGUE[0].famille, 'Art de la table',
  '… mais la catégorie posée sur la ligne garde sa casse normale');

// Chrome écrit l'intitulé d'un `<optgroup>` en gris italique : au comptoir, à
// bout de bras, la famille ne se lisait pas. Elle passe en gras à l'encre, le
// produit reste en écriture normale.
assert.ok(/#catProduit optgroup\{[^}]*font-weight:800/.test(DEVIS),
  'la famille se lit en gras dans le menu');
assert.ok(/#catProduit optgroup\{[^}]*font-style:normal/.test(DEVIS),
  '… et droite, pas en italique');
assert.ok(/#catProduit optgroup\{[^}]*color:var\(--text\)/.test(DEVIS),
  '… à l’encre, pas en gris');
assert.ok(/#catProduit option\{[^}]*font-weight:400/.test(DEVIS),
  'le produit, lui, reste en écriture normale');

// --- 5. Ajouter à la demande ---------------------------------------------------

const index = (texte) => {
  const i = plat.findIndex((l) => l.texte === texte);
  assert.ok(i >= 0, `« ${texte} » doit exister`);
  return String(i);
};
const { catProduit, catQte } = cat.els;

// a) Rien de choisi : rien ne part. `Number('')` vaut zéro — sans garde,
//    c'est « Bouchon Bois » qui se serait invité dans le devis.
catProduit.value = '';
cat.ajouterALaDemande();
assert.strictEqual(cat.needs.length, 0,
  'sans produit choisi, la première ligne du catalogue ne doit PAS s’ajouter');
assert.deepStrictEqual(cat.echecs.map((e) => e.id), ['catProduit'],
  '… et la vendeuse doit voir pourquoi');

// b) Un produit, une quantité.
catProduit.value = index('Flasque Bois — Clair');
catQte.value = '3';
cat.ajouterALaDemande();
assert.strictEqual(cat.needs.length, 1, 'un produit ajouté = une ligne');
assert.strictEqual(cat.needs[0].qty, 3, '… avec la quantité demandée');
assert.strictEqual(catProduit.value, '', 'le menu repart à vide : reprendre la ligne d’avant est le geste qui double un article');
assert.strictEqual(catQte.value, '1', '… et la quantité repart à 1');

// c) Le même produit repris : des unités, pas une deuxième ligne.
catProduit.value = index('Flasque Bois — Clair');
catQte.value = '2';
cat.ajouterALaDemande();
assert.strictEqual(cat.needs.length, 1, 'le même produit repris ne rouvre pas de ligne');
assert.strictEqual(cat.needs[0].qty, 5, '… il ajoute ses unités à la sienne');

// d) Une autre variante est un autre article.
catProduit.value = index('Flasque Bois — Foncé');
catQte.value = '1';
cat.ajouterALaDemande();
assert.strictEqual(cat.needs.length, 2, 'clair et foncé sont deux lignes');
assert.deepStrictEqual(cat.needs.map((n) => n.color), ['Clair', 'Foncé'],
  'la variante choisie est celle qui part sur la ligne');

// e) Quantité effacée d'un doigt : une unité, pas un blocage.
catProduit.value = index('Shaker inox');
catQte.value = '';
cat.ajouterALaDemande();
assert.strictEqual(cat.needs[2].qty, 1, 'une quantité vide vaut une unité');

// --- 6. Le besoin du catalogue est celui du formulaire ----------------------

const CLES = ['category', 'label', 'qty', 'requestedRef', 'color', 'productionType',
  'comment', 'solution', 'reference', 'unitHT'];
assert.deepStrictEqual(Object.keys(cat.needs[0]).sort(), [...CLES].sort(),
  'le besoin posé par le catalogue a exactement les clés de celui du formulaire');
const saveNeed = (DEVIS.match(/function saveNeed\(\)\{[\s\S]*?\n/) || [''])[0];
CLES.forEach((k) => assert.ok(saveNeed.includes(k),
  `« ${k} » doit rester une clé du besoin écrit à la main`));

assert.ok(Number.isNaN(cat.needs[0].unitHT),
  'une demande de devis part SANS prix : NaN, jamais 0 — sinon la fiche affiche « 0 € »');
assert.strictEqual(cat.needs[0].category, 'Art de la table',
  'la famille sert de catégorie : elle dit plus que « Goodies » trois jours plus tard');
assert.strictEqual(cat.needs[0].label, 'Flasque Bois', 'la ligne porte le nom du produit');

// La catégorie posée par le catalogue doit exister dans la liste du formulaire,
// sinon « Modifier » renvoie la vendeuse sur « + Nouvelle catégorie ».
groupes.forEach((g) => {
  const opt = g.famille.replace(/&/g, '&amp;');
  assert.ok(step2.includes(`<option>${opt}</option>`),
    `« ${g.famille} » doit être une catégorie du formulaire manuel`);
});

// Rien ne doit venir d'un autre domaine : un poste s'ouvre sans dépendre d'un
// tiers joignable.
const ligne = (step2.match(/<div class="cat-ligne">[\s\S]*?ajouterALaDemande[\s\S]*?<\/div><\/div>/) || [''])[0];
assert.ok(ligne && !/<img|fonts\.googleapis|material-symbols/.test(ligne),
  'la ligne du catalogue ne charge rien d’un autre domaine');

console.log('✓ catalogue comptoir : un produit, une quantité, à la demande — et rien qui parte tout seul');
