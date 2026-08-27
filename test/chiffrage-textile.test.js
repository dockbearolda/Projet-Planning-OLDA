'use strict';

const { ecran } = require('./ecran-comptoir');

// LE CHIFFRAGE TEXTILE DU COMPTOIR
//
// Le moteur vient du fichier de calcul du patron
// (OLDA_Chiffrage_Rapide_Tshirts_Windows_V5.html) : mêmes produits, mêmes
// coefficients dégressifs, mêmes seuils de marge. Il est porté tel quel dans
// public/comptoir/textile-catalog.js.
//
// Ce fichier vérifie :
//   1. LE CALCUL — les chiffres du patron, aux bornes comprises.
//   2. CE QUI RESTE À L'ÉCRAN — la marge et le temps de production ne doivent
//      PAS partir dans le texte envoyé au client.
//   3. LES RÉGLAGES D'ATELIER — bornés en base, partagés par tous les postes.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const DEVIS = ecran('demande-devis');

// Le moteur s'écrit pour le navigateur : on lui pose un `window` et on le lit.
global.window = global.window || {};
require(path.join(RACINE, 'public/comptoir/textile-catalog.js'));
const TE = global.window.TextileEngine;

// --- 1. Le calcul du patron --------------------------------------------------

assert.ok(TE && TE.DB, 'le moteur doit s’exposer sur window.TextileEngine');
assert.ok(TE.DB.refs.length > 40, 'la base produits du patron doit être complète');

const cinquante = TE.calculate({
  ref: 'K3025', isCustom: false, genre: 'Unisexe', transport: 'Maritime',
  printType: 'Coeur + Dos', sizes: { M: 20, L: 20, XL: 10 },
  discount: '', manualPrice: '', markupPercent: 0,
});
// Valeurs relevées dans le fichier du patron pour cette saisie exacte.
assert.strictEqual(cinquante.qty, 50, 'la quantité est la somme des tailles');
assert.strictEqual(Number(cinquante.sold.toFixed(2)), 15.30, 'prix HT unitaire du patron');
assert.strictEqual(Number(cinquante.total.toFixed(2)), 765.00, 'total HT du patron');
assert.strictEqual(cinquante.avis, 'BON — VALIDÉ', 'le verdict suit les seuils par quantité');

// Un devis sans ligne chiffrable ne doit pas inventer un prix : c'est ce qui
// avait produit des « HT : 0 € » sur des demandes non chiffrées.
assert.strictEqual(TE.calculate({ ref: 'K3025', genre: 'Unisexe', transport: 'Maritime', printType: 'Aucun', sizes: {} }), null,
  'sans quantité, aucun calcul');
assert.strictEqual(TE.calculate({ isCustom: true, customRef: 'X', genre: 'Unisexe', transport: 'Maritime', printType: 'Aucun', sizes: { S: 5 } }), null,
  'un produit libre sans prix d’achat ne se chiffre pas');

// La grille du patron s'arrête à 150 : au-delà, elle ne se prolonge pas toute
// seule — la remise supplémentaire est une décision, pas une extrapolation.
assert.strictEqual(TE.coefFor(300).textile, TE.coefFor(150).textile,
  'au-delà de la grille, le coefficient reste celui du dernier palier');
assert.strictEqual(TE.coefFor(0).textile, TE.coefFor(1).textile,
  'une quantité nulle retombe sur le premier palier, jamais sur undefined');

// Les seuils se durcissent quand la quantité monte : la même marge de 50 %
// n'a pas le même verdict sur 5 pièces et sur 200.
assert.strictEqual(TE.classify(0.5, 1)[0], 'CORRECT — MAINTENIR');
assert.strictEqual(TE.classify(0.5, 200)[0], 'TRÈS BON — VALIDÉ');

// --- 1 bis. Le vocabulaire du comptoir ne doit pas casser le calcul ----------
// Au comptoir on dit Homme / Femme / Enfant / Bébé. Le fichier du patron range
// ses temps de marquage sous « Unisexe » et ignore « Bébé ». Un genre que la
// table des temps ne connaît pas ne lève AUCUNE erreur : il rend simplement
// zéro mètre de DTF, donc un marquage à 2,30 € au lieu de 9,90 €. Le prix est
// faux et rien ne le dit — d'où ce garde-fou.
TE.GENRES_SAISIE.forEach((g) => {
  assert.ok(TE.DB.times[TE.genreMoteur(g)],
    `le genre « ${g} » doit retomber sur une table de temps existante`);
});
TE.FAMILLES_ACCESSOIRE.forEach((f) => {
  assert.strictEqual(TE.genreMoteur(f), f,
    `la famille « ${f} » garde sa propre table de temps, on ne la traduit pas`);
});

// Renommer « Unisexe » en « Homme » ne doit RIEN changer au prix.
const saisieHomme = { ref: 'K3025', transport: 'Maritime', printType: 'Coeur + Dos', sizes: { M: 20, L: 20, XL: 10 }, markupPercent: 0 };
assert.strictEqual(
  TE.calculate({ ...saisieHomme, genre: 'Homme' }).sold,
  TE.calculate({ ...saisieHomme, genre: 'Unisexe' }).sold,
  '« Homme » et « Unisexe » chiffrent le même prix : le libellé change, le calcul non');
assert.strictEqual(TE.calculate({ ...saisieHomme, genre: 'Homme' }).basePrint, 9.9,
  'le marquage reste celui du fichier du patron');

// Une ligne enregistrée avant ce changement porte encore « Unisexe » : elle
// doit se rouvrir sur « Homme », pas sur un champ vide.
assert.strictEqual(TE.genreSaisie('Unisexe'), 'Homme');
assert.strictEqual(TE.genreSaisie('Femme'), 'Femme');

// La liste des couleurs est celle de l'atelier, pas celle du fichier.
assert.ok(TE.DB.markingColors.includes('Rose bébé') && TE.DB.markingColors.includes('Bleu royal'),
  'les couleurs relevées au comptoir remplacent celles du fichier');
assert.ok(/id="txMarkColor"[^>]*list="txMarkColorList"/.test(DEVIS),
  'la couleur de marquage se choisit OU se saisit : le champ reste libre');

// --- 1 ter. Le champ rougi doit être un champ VISIBLE ---------------------
// Un manque se signale en rouge sur le champ (mécanique arrivée par la PR
// #151). L'étape « Besoins » visait `catProduit`, qui vit dans l'onglet
// « Autre » : pendant que Textile est à l'écran, ce champ est MASQUÉ — le
// rouge et le focus tombent dans le vide et le bouton semble mort.
assert.ok(!/btn\.disabled\s*=\s*true/.test(DEVIS),
  'aucun bouton d’étape ne se grise : c’est le clic qui déclenche le rouge');
assert.ok(/function marquer\(id,msg,premier\)/.test(DEVIS),
  'le marquage en rouge reste celui du parcours, on ne le double pas');
assert.ok(/if\(n===2&&!needs\.length\)return fail\(\$\('besoinAutreForm'\)\.classList\.contains\('hidden'\)\?'txRef':'catProduit'/.test(DEVIS),
  'le champ à rougir suit l’onglet affiché — jamais un champ masqué');

// --- 2. La marge reste à l'écran ---------------------------------------------
// `recapLines()` alimente le récapitulatif PDF **et** le message WhatsApp
// envoyé au client. Tout ce qu'on range dans `n.comment` part donc au client :
// la marge, le coût de revient et le temps de production n'y ont pas leur
// place. Ils restent affichés au comptoir, où seule la vendeuse les lit.
const txComment = (DEVIS.match(/function txComment\(d\)\{[\s\S]*?\n\}/) || [''])[0];
// Le champ « personnalisation » de la ligne (PR #151) appartient à la
// VENDEUSE : y déposer le récapitulatif textile le lui confisquerait, et sa
// première frappe effacerait tailles et marquage du devis.
assert.ok(/textileResume:txComment\(d\)/.test(DEVIS) && !/comment:txComment/.test(DEVIS),
  'le détail textile vit à part, jamais dans le champ de personnalisation');
assert.ok(/if\(n\.textileResume\)out\.push\(\[no\+'Détail textile'/.test(DEVIS),
  '… et descend au récapitulatif sur sa propre ligne');
// Sans valeur posée, le marquage partait au client en « Coeur + Dos () ». Les
// champs de l'article arrivent VIERGES depuis le 21/08 : ce n'est donc plus une
// valeur par défaut qui protège, c'est le refus d'ajouter l'article. Trois de
// ces quatre champs sont en plus des CLÉS DE BARÈME — vides, `DB.transports`,
// `DB.times` et `DB.printTypes` rendent 0 et {}, et le devis part sous-facturé
// sans la moindre erreur.
assert.ok(/const TX_OBLIGATOIRES=\[[\s\S]*?'txTransport'[\s\S]*?'txGenre'[\s\S]*?'txPrintType'[\s\S]*?'txMarkColor'[\s\S]*?\];/.test(DEVIS),
  'transport, genre, emplacement et couleur de marquage sont obligatoires');
assert.ok(/const manque=txManquants\(\);\s*if\(manque\.length\)return fail\(manque\[0\]\[0\],manque\[0\]\[1\]\);/.test(DEVIS),
  '… l’article ne s’ajoute pas tant qu’il en manque un');
assert.ok(/const c=txManquants\(\)\.length\?null:txCalc\(d\);/.test(DEVIS),
  '… et AUCUN prix ne s’affiche avant : un marquage à 0 € ne doit jamais se voir');
assert.ok(!/new Option\(x,x,false,x==='Coeur \+ Dos'\)/.test(DEVIS) && !/value=db\.markingColors\[0\]/.test(DEVIS),
  'plus aucune valeur posée d’office dans l’article');
assert.ok(txComment, 'txComment doit exister et ne prendre que la saisie');
assert.ok(!/c\.mark|txPct|prodHours|c\.margin|c\.sold|costSeries/.test(txComment),
  'le texte envoyé au client ne doit porter ni marge, ni coût, ni temps de production');
assert.ok(/Tailles|Marquage/.test(txComment),
  'il porte en revanche ce que le client a commandé : tailles et marquage');

// --- 3. La négociation -------------------------------------------------------
// Le client annonce son prix ; on lui pose des sorties, classées par ce
// qu'elles laissent VRAIMENT à l'atelier.

const negociable = TE.calculate({
  ref: 'K3025', genre: 'Unisexe', transport: 'Maritime', printType: 'Coeur + Dos',
  sizes: { M: 20, L: 20, XL: 10 }, markupPercent: 0,
});
const CIBLE = 12;
const solutions = TE.defaultNegotiationSolutions(negociable, CIBLE);
assert.ok(solutions.length >= 4, 'plusieurs sorties, jamais un seul « oui / non »');

const classees = TE.rankedScenarios(negociable, solutions, CIBLE);
for (let i = 1; i < classees.length; i++) {
  assert.ok(classees[i - 1].m.margin >= classees[i].m.margin - 0.01,
    'les solutions sont classées par ce qui reste à l’atelier, la meilleure en tête');
}

// Une pièce offerte n'est pas une pièce vendue : elle coûte sa production et
// ne rapporte rien. C'est toute la différence entre offrir et remiser.
const cadeau = classees.find((r) => r.m.freeQty > 0);
assert.ok(cadeau, 'offrir des pièces doit faire partie des sorties proposées');
assert.strictEqual(Number(cadeau.m.revenue.toFixed(2)), Number((cadeau.m.paidQty * cadeau.m.unitPrice).toFixed(2)),
  'le chiffre d’affaires ne compte QUE les pièces payées');
assert.strictEqual(Number(cadeau.m.cost.toFixed(2)), Number((cadeau.m.delivered * negociable.unitProductionCost).toFixed(2)),
  'le coût compte TOUTES les pièces produites, offertes comprises');

// Le point de comparaison est toujours le même : ce que l'atelier garderait en
// disant simplement oui, sur la quantité d'aujourd'hui.
const direct = negociable.qty * CIBLE - negociable.qty * negociable.unitProductionCost;
classees.forEach((r) => {
  assert.strictEqual(Number(r.m.vsDemand.toFixed(2)), Number((r.m.margin - direct).toFixed(2)),
    'l’écart annoncé se mesure contre l’acceptation directe du prix demandé');
});

// Sans prix demandé, aucune proposition : on n'invente pas une négociation.
assert.deepStrictEqual(TE.defaultNegotiationSolutions(negociable, 0), []);
assert.deepStrictEqual(TE.defaultNegotiationSolutions(negociable, NaN), []);

// RETENIR POSE UN ACCORD — LES TROIS NOMBRES DU V9 (23/08/2026) : quantité
// FACTURÉE, prix à la pièce, pièces OFFERTES. La solution retenue écrivait
// avant les pièces manquantes dans « Autres » : choisir « 70 à 15,55 € » sur
// une saisie de 55 faisait entrer quinze vêtements que personne n'avait
// commandés — sans taille, sans qu'on l'ait tapé — et une deuxième négociation
// en rajoutait encore.
const retenir = (DEVIS.match(/function negRetenir\(i,\s*m\)\{[\s\S]*?\n\}/) || [''])[0];
assert.ok(retenir, 'negRetenir doit exister');
assert.ok(/paidQty:m\.paidQty, freeQty:m\.freeQty, unitPrice:m\.unitPrice/.test(retenir),
  'l’accord porte les trois nombres du fichier du patron');
assert.ok(!/sizes|manualPrice/.test(retenir),
  'retenir une offre n’écrit NI dans les tailles NI dans le prix manuel : l’accord fait le devis');
// C'est `txAvecAccord` qui applique l'accord — et il ne facture QUE ce qui est
// saisi : la quantité facturée de l'offre sert de rappel, pas de quantité.
const accord = (DEVIS.match(/function txAvecAccord\(c,d\)\{[\s\S]*?\n\}/) || [''])[0];
assert.ok(accord, 'txAvecAccord doit exister');
assert.ok(/scenarioMetrics\(c,\{paidQty:c\.qty,unitPrice:txNum\(a\.unitPrice\),freeQty:offertes\}/.test(accord),
  'on ne facture que les pièces saisies ; les offertes s’ajoutent aux livrées');
assert.ok(/qty:m\.delivered/.test(accord) && /sold:m\.effective/.test(accord) && /total:m\.revenue/.test(accord),
  'l’accord décide des pièces livrées, du prix moyen et du total');
// UN GESTE NE BAISSE PAS LE PRIX, UN VOLUME NE DONNE RIEN : c'est le modèle du
// V9, et les quatre sorties le respectent déjà.
const sorties = TE.defaultNegotiationSolutions(negociable, CIBLE);
const parGenre = Object.fromEntries(sorties.map((s) => [s.kind, s]));
['small_gift', 'full_gift'].forEach((k) => {
  assert.strictEqual(parGenre[k].unitPrice, negociable.sold, `${k} : le tarif ne bouge pas`);
  assert.strictEqual(parGenre[k].paidQty, negociable.qty, `${k} : la quantité facturée non plus`);
  assert.ok(parGenre[k].freeQty > 0, `${k} : c’est le nombre de pièces offertes qui change`);
});
['volume_target', 'volume_mid'].forEach((k) => {
  assert.strictEqual(parGenre[k].freeQty, 0, `${k} : rien n’est offert`);
  assert.ok(parGenre[k].unitPrice < negociable.sold, `${k} : c’est le prix qui baisse`);
  assert.ok(parGenre[k].paidQty >= negociable.qty, `${k} : … contre du volume`);
});
// ON REVIENT AU TARIF D'UN CLIC : rien n'ayant été écrit ailleurs que dans
// l'accord, y renoncer suffit.
const retirer = (DEVIS.match(/function negRetirerAccord\(i\)\{[\s\S]*?\n\}/) || [''])[0];
assert.ok(retirer && /delete TX_NEG\.negotiation/.test(retirer) && /delete t\.negotiation/.test(retirer),
  'retirer l’accord le supprime, des deux côtés');

// LE PRIX DEMANDÉ SE TAPE EN ENTIER. `renderNeeds` remplace tout
// `needsDisplay` : tant que la frappe le rappelait, le champ repartait à zéro
// au premier chiffre, le curseur tombait et « 23 » restait bloqué sur « 2 »
// pendant que les solutions s'ouvraient comme si on avait validé.
const poser = (DEVIS.match(/function negPoserTarget\(i,\s*valeur\)\{[\s\S]*?\n\}/) || [''])[0];
assert.ok(poser, 'negPoserTarget doit exister');
assert.ok(/negResultats-\$\{i\}/.test(poser),
  'une frappe ne réécrit que les solutions, jamais la ligne qui porte le champ');
assert.ok(!/^\s*renderNeeds\(\);?$/m.test(poser),
  'negPoserTarget ne doit pas redessiner la liste à chaque chiffre tapé');

// Le champ se construit UNE fois, les solutions se réécrivent à part : les
// deux ne peuvent pas vivre dans la même fonction sans reprendre le curseur.
const panneau = (DEVIS.match(/function negPanneau\(i\)\{[\s\S]*?\n\}/) || [''])[0];
const resultats = (DEVIS.match(/function negRemplirResultats\(hote,\s*i\)\{[\s\S]*?\n\}/) || [''])[0];
assert.ok(resultats, 'les solutions doivent se rendre dans leur propre bloc');
assert.ok(/negResultats-\$\{i\}/.test(panneau) && /negRemplirResultats\(/.test(panneau),
  'le panneau accroche un conteneur de solutions identifié par la ligne');
assert.ok(!/negTarget-\$\{i\}/.test(resultats) && !/createElement\('input'\)/.test(resultats),
  'le champ ne doit jamais être reconstruit par le rendu des solutions');
assert.ok(/rankedScenarios/.test(resultats) && !/rankedScenarios/.test(panneau),
  'seul le bloc des solutions dépend du prix demandé');

// La molette sur un champ nombre change la valeur sans qu'on l'ait tapée : on
// fait défiler les solutions et le prix demandé bouge tout seul.
assert.ok(/'wheel'[\s\S]{0,60}blur\(\)/.test(panneau),
  'la molette ne doit pas modifier le prix demandé');

// Le geste commercial se dit au client ; la marge, non.
assert.ok(/Geste commercial/.test(DEVIS),
  'les pièces offertes doivent apparaître sur le récapitulatif du client');

// --- 4. Les réglages d'atelier -----------------------------------------------
// Un coût horaire corrigé sur un poste doit valoir pour les autres : sinon deux
// PC annoncent deux prix pour le même article. Ils vivent donc en base.
assert.ok(/fetch\('\/api\/settings\/textile'/.test(DEVIS),
  'les réglages de production se lisent au serveur, pas dans le navigateur');
assert.ok(!/localStorage[^\n]*textile/i.test(DEVIS),
  'aucun réglage de chiffrage ne doit rester dans le localStorage d’un poste');

const DB_JS = fs.readFileSync(path.join(RACINE, 'db.js'), 'utf8');
const nettoyage = (DB_JS.match(/function nettoyerReglagesTextile[\s\S]*?\n\}/) || [''])[0];
assert.ok(nettoyage, 'les réglages reçus doivent passer par un nettoyage');
assert.ok(/TEXTILE_BORNES/.test(nettoyage),
  'une valeur hors bornes est écartée : un débit DTF à 0 diviserait par zéro');

console.log('✓ chiffrage textile : les chiffres du patron, la marge qui reste au comptoir, les réglages en base');
