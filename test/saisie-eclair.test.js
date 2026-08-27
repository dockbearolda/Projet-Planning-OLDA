'use strict';

// ===========================================================================
// LA VOIE RAPIDE — et la frontière entre l'atelier et le bureau
// ===========================================================================
// LE PROBLÈME, MESURÉ sur les 184 dossiers réels de la production (27/08/2026) :
// douze des libellés du récapitulatif sont remplis moins d'une fois sur deux,
// six moins d'une fois sur cinq — et ils sont SUR LE CHEMIN, entre le client et
// le prix. Ce n'est pas la quantité d'information qui coûte du temps, c'est la
// quantité de cases VIDES qu'il faut traverser.
//
// Ce fichier tient les quatre choses qui casseraient en silence :
//
//   1. UN SEUL MODÈLE DE DONNÉES. La voie rapide emprunte la MÊME route que les
//      deux parcours complets (`POST /api/comptoir/projet`). Deux routes, ce
//      serait un champ ajouté d'un côté et introuvable de l'autre.
//   2. LA FRONTIÈRE. Ce qui fait PRODUIRE va dans `articles[].prod` et arrive
//      sur le ticket de l'atelier ; ce qui parle d'ARGENT va dans `amount` et
//      `paiement`, et le ticket n'en voit JAMAIS rien. Une feuille qui traîne
//      sur un plan de travail n'annonce pas ce que le client a payé.
//   3. UNE DEMANDE N'A PAS DE PRIX. « Pas encore chiffré » n'est pas
//      « gratuit » : `amount` reste ABSENT plutôt que d'entrer à zéro.
//   4. LE CATALOGUE A UNE SEULE SOURCE, partagée avec l'écran du comptoir.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8');
const ECLAIR = lire('public/eclair.js');
const SHELL = lire('public/nouveau-projet.js');
const CSS = lire('public/projet.css');
const CATALOGUE = lire('public/comptoir/catalogue.js');

// --- 1. Le catalogue est partagé, pas recopié -------------------------------
assert.ok(/const CATALOGUE\s*=/.test(CATALOGUE) && /window\.catalogueAPlat/.test(CATALOGUE),
  'le catalogue vit dans son fichier et s’expose à plat pour la recherche');
assert.ok(!/const CATALOGUE\s*=/.test(ECLAIR),
  'la voie rapide LIT le catalogue, elle n’en garde pas une copie — deux copies, '
  + 'c’est un produit ajouté d’un côté et introuvable de l’autre');
assert.ok(/comptoir\/catalogue\.js/.test(SHELL),
  'l’hôte pose le catalogue avant de monter la voie rapide');

// --- 2. Une seule route, celle qui existe déjà ------------------------------
// Elle LIT (la base clients, les faces déclarées) — mais elle n'ÉCRIT nulle
// part elle-même : elle rend un dossier, l'hôte l'envoie, exactement comme les
// deux parcours du comptoir. Une seconde route d'écriture, ce serait une
// seconde façon de créer un dossier, donc deux à tenir d'accord.
// On lit le CODE, pas les commentaires : l'en-tête du fichier NOMME la route
// commune, et c'est justement ce qu'on veut qu'il dise.
const codeEclair = ECLAIR.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
assert.ok(!/method:\s*['"`]POST/i.test(codeEclair) && !/comptoir\/projet/.test(codeEclair),
  'la voie rapide n’invente aucune route d’enregistrement');
assert.ok(/fetch\('\/api\/tailles-logo'\)/.test(ECLAIR),
  'les faces viennent du MÊME tableau que le comptoir, pas d’une liste écrite ici');
assert.ok(/api\.enregistrer\(payloadDe\(etat\)\)/.test(ECLAIR),
  'et elle passe par l’enregistrement de l’hôte, donc par sa file et ses trois issues');

// --- 3. LA FRONTIÈRE, sur un dossier construit pour de vrai -----------------
// On exécute `payloadDe` : ce que le dossier porte ne se lit pas dans une
// expression régulière.
const bloc = ECLAIR.slice(ECLAIR.indexOf('const EURO'), ECLAIR.indexOf('// ---------------------------------------------------------------------------\n// LA LISTE QUI SE FILTRE'))
  + ECLAIR.slice(ECLAIR.indexOf('function etatNeuf()'), ECLAIR.indexOf('// ---------------------------------------------------------------------------\n// L’ÉCRAN'.replace('’', "'")));
const fabrique = new Function(`${bloc.replace(/^export .*$/gm, '')}
  return { payloadDe, etatNeuf, totalTtc };`);
const { payloadDe, etatNeuf } = fabrique();

const vente = etatNeuf();
vente.client = { id: 'c1', entreprise: 'Blue Martini', telephone: '0690112233' };
vente.paiement = 'cb';
vente.articles = [{
  famille: 'Tasse céramique 350 ml', label: 'Tasse céramique 350 ml TC 06',
  color: 'Noir (ext.) / Blanc (int.)', ref: '', technique: 'UV',
  qte: 24, prixTtc: 288, note: '', zones: [
    { face: 'Face avant', quoi: 'Logo Blue Martini' },
    { face: 'Fond', quoi: 'Logo OLDA' },
  ],
}];
const pv = payloadDe(vente);

// CE QUI FAIT PRODUIRE — et rien d'autre.
const prod = pv.articles[0].prod;
assert.deepStrictEqual(prod.logos, [
  { face: 'Face avant', mm: '', quoi: 'Logo Blue Martini' },
  { face: 'Fond', mm: '', quoi: 'Logo OLDA' },
], 'les faces saisies arrivent en zones de marquage, avec leur consigne');
assert.strictEqual(prod.couleur, 'Noir (ext.) / Blanc (int.)');
assert.strictEqual(prod.marquage, 'UV');
// LA COULEUR NE S'ÉCRIT PAS DEUX FOIS : elle est dans `prod`, pas dans le nom.
assert.strictEqual(pv.articles[0].label, 'Tasse céramique 350 ml TC 06',
  'l’intitulé ne recopie pas la couleur — le ticket la rend déjà sur sa ligne');
// Aucun mot d'argent dans la fiche de production : c'est ELLE que le ticket lit.
assert.deepStrictEqual(
  Object.keys(prod).filter((k) => /prix|montant|amount|paye|paiement|marge|revient/i.test(k)),
  [], 'la fiche de production ne porte AUCUN champ d’argent');

// CE QUI PARLE D'ARGENT — et qui reste au bureau.
assert.strictEqual(pv.amount, 288, 'le total TTC part au planning');
assert.strictEqual(pv.paiement.mode, 'cb');
assert.strictEqual(pv.paiement.paye, true);
assert.strictEqual(pv.articles[0].amount, 288, 'et la part de la ligne, pour découper le lot');

// --- 4. UNE DEMANDE N'A PAS DE PRIX ----------------------------------------
const devis = etatNeuf();
devis.nature = 'devis';
devis.client = { id: 'c1', entreprise: 'Blue Martini' };
devis.articles = [{ famille: 'Goodies', label: 'Porte-clés', color: '', qte: 40, prixTtc: 0, zones: [] }];
const pd = payloadDe(devis);
assert.ok(!('amount' in pd),
  '« pas encore chiffré » n’est pas « gratuit » : le montant reste ABSENT, jamais zéro');
assert.ok(!('amount' in pd.articles[0]), 'ni sur la ligne');
assert.ok(!('paiement' in pd), 'et rien n’est encaissé sur une demande');
assert.strictEqual(pd.source, 'Demande de devis');
assert.strictEqual(pd.stage, 'demande');
assert.strictEqual(pv.source, 'Vente directe');

// --- 5. Ce qui est rarement rempli n'est PAS sur le chemin ------------------
// Mesuré : e-mail 51 %, personne à contacter 47 %, note interne 15 %, canal…
// Ils existent, derrière un volet — les supprimer serait perdre le jour où le
// client les donne.
assert.ok(/<details|createElement\('details'\)|el\('details'/.test(ECLAIR),
  'les champs rarement remplis vivent derrière un volet');
for (const rare of ['ec-contact', 'ec-email', 'ec-canal', 'ec-note']) {
  assert.ok(ECLAIR.includes(rare), `« ${rare} » reste accessible, il n’est pas supprimé`);
}
// Et un champ vide ne s'écrit pas dans le récapitulatif.
assert.ok(!pd.details.some(([, v]) => String(v).trim() === ''),
  'un champ vide ne fait pas une ligne de récapitulatif');

// --- 6. La charte : aucune valeur en dur -----------------------------------
const cssEclair = CSS.slice(CSS.indexOf('.np-eclair'));
const sansCommentaires = cssEclair.replace(/\/\*[\s\S]*?\*\//g, ' ');
assert.ok(!/#[0-9a-f]{3,8}\b/i.test(sansCommentaires), 'aucune teinte écrite en clair');
assert.ok(!/font-size:\s*\d/.test(sansCommentaires), 'aucune taille de texte en dur');
assert.ok(!/transition:[^;]*\b\d+m?s\b/.test(sansCommentaires), 'aucune durée en dur');
// UNE SEULE BOÎTE : tout ce qui se clique et se remplit fait `--ctrl-h`.
assert.ok(!/(min-)?height:\s*\d+px/.test(sansCommentaires),
  'aucune hauteur de commande écrite en dur : c’est ce qui produit trois hauteurs de champ');
// PC uniquement (voir CLAUDE.md) : plus de seconde échelle tactile.
assert.ok(!/pointer:\s*coarse/.test(cssEclair), 'aucune échelle tactile : la cible est le PC');

console.log('✓ saisie éclair : une seule route, et l’argent ne descend pas à l’atelier');
