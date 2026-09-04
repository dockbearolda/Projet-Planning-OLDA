'use strict';

// LA FICHE ATELIER — 14 pouces, sans défilement (28/08/2026)
// ===========================================================================
// Spécification livrée en handoff (`design_handoff_fiche_commande`), recréée
// avec les composants et l'état de l'application. Ce fichier tient ce qui se
// casse en silence :
//
//   1. LA CONTRAINTE CENTRALE — rien ne défile à 1366 × 630. Elle ne se
//      mesure qu'au rendu, mais les quatre décisions de structure qui la
//      rendent possible se lisent, elles, dans la feuille ;
//   2. le panneau Détails est un CALQUE et reste MONTÉ ;
//   3. la normalisation des saisies — ce qu'on tape vite et ce qu'on relit ;
//   4. la marge, calculée et jamais stockée ;
//   5. aucun raccourci clavier, sauf Échap pour sortir ;
//   6. le module n'importe rien d'app.js : un cycle casse à l'ouverture.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const JS = lire('public/fiche-atelier.js');
const CSS = lire('public/fiche-atelier.css');
const APP = lire('public/app.js');

// Le module est un module ES du navigateur : on l'évalue dans un bac après
// avoir retiré ses `export`, comme le fait déjà `test/socle-papier.js` pour les
// deux papiers. Aucun DOM n'est touché par les fonctions qu'on éprouve ici.
const bac = { document: { createElement: () => ({ style: {}, classList: { add() {} } }) }, window: {}, console, Math, JSON, Number, String, Array, Object, Date, parseFloat, parseInt, setTimeout, clearTimeout };
vm.createContext(bac);
// Les `import` partent avec les `export` : le bac n'a pas de chargeur de
// modules, et les fonctions éprouvées ici n'en dépendent pas (le calendrier ne
// sert qu'au dessin de la rangée « Retrait »).
const NU = JS.replace(/^export /gm, '').replace(/^import[\s\S]*?from '[^']*';$/gm, '');
vm.runInContext(`${NU}\nthis.API = { normaliserMontant, normaliserTelephone, normaliserHeure, normaliserDate, texteMarge };`, bac);
const { normaliserMontant, normaliserTelephone, normaliserHeure, normaliserDate, texteMarge } = bac.API;

// ---------------------------------------------------------------------------
// 1. UNE SEULE BARRE DE DÉFILEMENT, ET C'EST CELLE DE L'ÉCRAN
// ---------------------------------------------------------------------------
// La contrainte a changé le 28/08 : « je veux pas de scroll, je veux toute la
// page, quitte à scroller la page ». Elle était « rien ne défile à 1366 × 630 »
// — ce qui obligeait chaque colonne à défiler pour elle-même, et l'écran en
// portait deux barres. Désormais la RACINE est le voile ET le conteneur qui
// défile ; la CARTE, dedans, prend sa hauteur naturelle et n'est bornée à rien.
const RACINE_CSS = CSS.match(/\.fa \{[\s\S]*?\n\}/)[0];
assert.ok(/position: fixed;/.test(RACINE_CSS) && /overflow-y: auto;/.test(RACINE_CSS),
  'la racine occupe l’écran et c’est ELLE qui défile');
assert.ok(/background: var\(--voile\);/.test(RACINE_CSS),
  'la racine EST le voile : plus d’élément séparé à monter et à retirer');
assert.ok(!/max-height/.test(RACINE_CSS),
  'la carte n’est bornée à rien : c’est tout l’intérêt de faire défiler l’écran');
const CARTE_CSS = CSS.match(/\.fa-carte \{[\s\S]*?\n\}/)[0];
assert.ok(/background: var\(--surface\);/.test(CARTE_CSS) && /box-shadow: var\(--shadow-pose\);/.test(CARTE_CSS),
  'la carte porte le fond et l’ombre — la racine, elle, est transparente au voile près');
// UNE BULLE AU MILIEU, LE PLANNING FLOU DERRIÈRE (30/08, Charlie : « je voudrais
// que ce soit une bulle en plein milieu de l'écran avec le vide et le planning
// derrière en flou »). Trois choses qui se cassent en silence :
//
//   · LE FLOU EST SUR LE VOILE, JAMAIS SUR LA CARTE. `backdrop-filter` brouille
//     ce qui est DERRIÈRE l'élément qui le porte : posé sur la carte, il
//     brouillerait le voile qu'elle couvre déjà — donc rien de visible — et le
//     planning resterait net. Mesuré au rendu : blur(8px) sur `.fa`, le planning
//     part, la fiche reste lisible.
//   · LE CENTRAGE EST UNE MARGE AUTOMATIQUE, jamais `justify-content: center`.
//     La racine DÉFILE (règle du 28/08) : sur un conteneur qui défile, un
//     centrage par `justify-content` rend le HAUT du contenu débordant
//     inatteignable — on ne peut plus remonter à l'entête de la fiche. Une marge
//     `auto` retombe à zéro quand la place manque. Mesuré à 1366 × 560, où la
//     carte déborde de 108 px : sommet ET pied atteignables.
//   · LES QUATRE COINS SONT ARRONDIS. Deux l'étaient — la carte était collée au
//     haut de l'écran, ses coins hauts n'existaient pas. Elle flotte, ils se
//     voient.
assert.ok(/backdrop-filter: blur\(/.test(RACINE_CSS),
  'le flou est sur le voile : c’est le planning DERRIÈRE qu’on brouille');
assert.ok(!/backdrop-filter/.test(CARTE_CSS),
  '… et jamais sur la carte, qui brouillerait le voile au lieu du planning');
assert.ok(/margin: auto;/.test(CARTE_CSS),
  'la carte se centre par une marge automatique — elle retombe à zéro quand la place manque');
assert.ok(!/justify-content|align-items/.test(RACINE_CSS),
  'jamais par `justify-content` sur un conteneur qui défile : le haut deviendrait inatteignable');
assert.ok(/border-radius: var\(--arrondi-carte\);/.test(CARTE_CSS)
  && !/border-bottom-left-radius/.test(CARTE_CSS),
  'les quatre coins sont arrondis : la carte ne touche plus le bord de l’écran');
assert.ok(/padding: var\(--pas-\d\);/.test(RACINE_CSS),
  'le vide autour de la bulle est un JETON, jamais un nombre');
assert.ok(/carte\.append\(tete, bandeau, scene\);/.test(JS)
  && /racine\.append\(carte, zoneToast\);/.test(JS),
  'tout le contenu vit dans la carte ; seul le message reste sur la racine');
// L'ÉCHELLE EST DÉCLARÉE SUR LA RACINE, PAS SUR LA CARTE (30/08) : le message
// est posé À CÔTÉ de la carte, donc ses `var(--fa-…)` ne résolvaient rien — son
// bouton « Annuler » sortait en 17 px au lieu de 14. Une échelle se déclare là
// où tout l'écran la lit.
{
  // Le bloc qui porte l'échelle est celui dont la liste de sélecteurs COMMENCE
  // par `.fa` — depuis le 01/09 elle en nomme deux (voir juste après).
  const RACINE_R = CSS.match(/\n\.fa,[^{]*\{[\s\S]*?\n\}/)[0];
  const CARTE_R = CSS.match(/\.fa-carte \{[\s\S]*?\n\}/)[0];
  assert.ok(/--fa-lab:/.test(RACINE_R) && /--fa-h-champ:/.test(RACINE_R),
    'les crans et les boîtes sont sur la racine');
  assert.ok(!/^\s*--fa-[a-z-]+:/m.test(CARTE_R.replace(/\/\*[\s\S]*?\*\//g, ' ')),
    '… et plus aucun sur la carte : ce qui vit à côté d’elle les lirait de travers');
  // UNE SEULE RÈGLE POUR DEUX ÉCRANS (01/09). L'écran du DEVIS reprend le même
  // composant de champ — intitulé au-dessus, boîte toujours visible, la boîte de
  // l'application. Recopier les six jetons chez lui aurait donné deux échelles
  // qui se ressemblent, et la première à bouger aurait laissé l'autre seule dans
  // son coin. Les deux racines sont donc nommées sur LA MÊME règle.
  assert.ok(/\.fa, \.devis-flash \{/.test(CSS),
    'la grammaire de champ est déclarée une fois pour la fiche ET le devis');
  // … et la géométrie du voile, elle, n'appartient qu'à la fiche : un écran
  // plein qui hériterait de `position: fixed` recouvrirait le planning.
  const VOILE = CSS.match(/\n\.fa \{[\s\S]*?\n\}/)[0];
  assert.ok(/position: fixed/.test(VOILE) && !/--fa-lab:/.test(VOILE),
    'le voile reste à la fiche seule ; l’échelle est dans la règle partagée');
}
// LA PASTILLE DE CONFIRMATION EST RETIRÉE (30/08, Charlie : « sur la validation
// c'est moche, je n'aime pas du tout »). Elle disait une TROISIÈME fois ce que
// le point de l'entête et le message du bas disaient déjà — et elle le disait
// mal : sa boîte entière était un jeton qu'elle ne pouvait pas lire.
assert.ok(!/fa-flag/.test(JS) && !/\.fa-flag\s*\{/.test(CSS),
  'plus de pastille de confirmation : deux signaux suffisent, dont un actionnable');
// … ET CE QUI RESTE EST DÉCLARÉ. En retirant la pastille, la déclaration
// d'`empiler` — la ligne d'à côté — est partie avec elle. Rien ne l'a signalé :
// la syntaxe reste valable, les 126 contrôles restaient verts, et l'écran ne
// tombait qu'au moment où l'on CHANGEAIT vraiment une valeur — le chemin
// s'arrête avant `empiler` quand rien n'a bougé. Un menu gardait alors son
// liseré, sans message ni enregistrement.
for (const nom of ['pulser', 'dire']) {
  assert.ok(new RegExp(`(const|function)\\s+${nom}\\b`).test(JS),
    `${nom} doit être DÉCLARÉ : le chemin d’enregistrement l’appelle`);
}
// LA BARRE QUI REPLIAIT LE PANNEAU EST RETIRÉE (30/08, Charlie : « supprime
// ça »). Elle pliait un panneau qui s'ouvre toujours, et pour l'annoncer elle
// recopiait sous lui les intitulés de quatre de ses six cases, en plus petit.
assert.ok(!/const barreDetails =/.test(JS) && !/fa-details__liste/.test(JS),
  'plus de barre repliable sous la bande du paiement');
// ⚠ On cherche les RÈGLES, pas les noms : le commentaire qui raconte le
// retrait les cite toutes les trois.
assert.ok(!/\.fa-details__b\s*[{:]/.test(CSS) && !/\.fa-details\[hidden\]\s*\{/.test(CSS),
  '… ni ses règles : le panneau n’a plus d’état caché');
assert.ok(!/--fa-h-barre/.test(CSS),
  '… ni son jeton de hauteur, qui ne servait qu’à elle');
// AUCUNE COLONNE NE DÉFILE POUR ELLE-MÊME : c'est exactement ce qui produisait
// les deux barres intérieures.
assert.ok(!/\.fa-col \{[\s\S]*?overflow: auto;/.test(CSS),
  'les colonnes ne défilent pas : une barre par colonne, c’est le défaut qu’on retire');
assert.ok(!/fa-voile/.test(CSS) && !/fa-voile/.test(JS) && !/ficheAtelierVoile/.test(APP),
  'l’élément voile séparé a disparu avec sa raison d’être');
// UN CLIC À CÔTÉ DE LA CARTE FERME. On ne ferme que si le clic a atteint la
// RACINE elle-même : un clic dans la carte remonte jusqu'à elle par bouillonnement.
// Sur `click` et non `mousedown` : le champ qu'on quitte doit d'abord perdre le
// focus, c'est son `blur` qui envoie ce qu'on venait d'y écrire.
assert.ok(/if \(ev\.target === ficheAtelierEl\) fermerFicheAtelier\(\);/.test(APP),
  'seul un clic SUR la racine ferme — jamais un clic qui vient de la carte');
assert.ok(/ficheAtelierEl\.addEventListener\('click'/.test(APP)
  && !/ficheAtelierEl\.addEventListener\('mousedown'/.test(APP),
  'jamais sur `mousedown` : le blur du champ n’aurait pas encore envoyé la saisie');
// La bande de l'argent ferme la scène. Elle s'appelait « Détails » jusqu'au
// 29/08 : elle mélangeait l'argent, le type de client, la provenance, le poste
// de production et les documents. Chacun est parti dans sa zone, elle ne porte
// plus que l'argent. Depuis le 30/08 elle ne se replie plus — le bouton qui la
// pliait annonçait, en plus petit, les intitulés qu'on lisait juste au-dessus.
assert.ok(/scene\.append\(travail, panneau\)|panneau\.append\(moitieG, moitieD\);/.test(JS),
  'la bande de l’argent est faite de ses deux moitiés');
// LE BLOC DE PIED EST RETIRÉ (29/08, Charlie). Il portait le nom du produit —
// déjà écrit dans l'entête, à trois centimètres, et c'est exactement le doublon
// que la règle du 26/08 interdit — et l'horodatage de création, que personne ne
// vient chercher sur une fiche d'atelier.
assert.ok(!/fa-rappel-bloc/.test(JS) && !/fa-rappel-bloc/.test(CSS) && !/rappelDossier/.test(APP),
  'le bloc de pied est parti en entier : le montage, sa règle et son contexte');
// CE QU'IL DISAIT D'UTILE MONTE DANS L'ENTÊTE. « Article 2 sur 3 du ticket … »
// n'était écrit nulle part ailleurs dans la fiche : c'est une IDENTITÉ, elle
// rejoint la référence, dans la même étiquette en capitales.
assert.ok(/el\('span', 'fa-ref', ctx\.lotDossier \|\| ''\)/.test(JS),
  'l’appartenance au lot est dans l’entête, avec la référence');
assert.ok(/lotDossier: lot \? `Article \$\{lot\.rang\} sur \$\{lot\.total\} du ticket \$\{lot\.ref\}` : '',/.test(APP),
  '… et vide sur un dossier ordinaire : `:empty` le retire de la rangée');
// LA BARRE D'ACTIONS BASSE A ÉTÉ RETIRÉE le 29/08 : cinq éléments sur une
// rangée pleine largeur, dont un champ de 700 px, pour des gestes qui vivent
// déjà ailleurs — la note dans « Informations », l'e-mail dans « Documents »,
// et « Marquer payé » qui doublait la bascule « Soldé ».
assert.ok(!/fa-bas/.test(JS) && !/'Ajouter la note'/.test(JS) && !/'Envoyer au client'/.test(JS),
  'plus de barre d’actions basse');
// La zone qui porte l'argent s'appelle « Paiement » dans le CODE, dans son
// commentaire de zone : depuis le 30/08 elle ne porte plus d'étiquette à
// l'écran — la barre qui l'annonçait a été retirée, et les six intitulés des
// cases disent déjà ce qu'on lit.
assert.ok(/ZONE 5 — PAIEMENT/.test(JS), '… et la zone de l’argent porte son nom');

// ---------------------------------------------------------------------------
// TROIS ZONES, ET ELLES NE SE MÉLANGENT PLUS (29/08/2026)
// ---------------------------------------------------------------------------
// Charlie : « il est important de bien séparer client, production et paiement ».
// Chaque fait vit dans la zone dont il parle, et le contrôle porte sur le CODE
// qui l'y pose — c'est le seul endroit où l'appartenance est écrite.
{
  const zone = (deb, fin) => {
    const i = JS.indexOf(deb); const j = JS.indexOf(fin, i);
    assert.ok(i >= 0 && j > i, `zone introuvable : ${deb}`);
    return JS.slice(i, j);
  };
  const CLIENT = zone("// ZONE 3 — CLIENT", "// ZONE 4");
  const PRODUCTION = zone("// ZONE 4", "// ZONE 5");
  const PAIEMENT = zone("// ZONE 5 — PAIEMENT", "// ZONE 6");

  // Le client : qui c'est, et quand il l'a.
  // LA RANGÉE « DOCUMENTS » A ÉTÉ RETIRÉE (30/08, Charlie : « tout ça tu
  // supprimes »). On cherche l'ÉCRITURE, pas le mot : le commentaire qui
  // explique le retrait nomme la rangée, et le test tomberait sur sa propre
  // explication — piège déjà payé deux lignes plus bas.
  for (const attendu of ["rangee('Type', selType)", "titreSection('Client')"]) {
    assert.ok(CLIENT.includes(attendu), `la zone Client doit porter ${attendu}`);
  }
  assert.ok(!/rangee\('Documents'/.test(JS) && !/fa-btn--mini/.test(JS),
    'plus de rangée « Documents » : ni le récapitulatif .txt, ni le brouillon mailto');
  // La production : ce qu'il y a à faire, et QUAND on le fait.
  assert.ok(PRODUCTION.includes("titreSection('Production')"),
    'la zone de production porte son nom');
  // « PRÉVU À L'ATELIER » EST RETIRÉE (29/08, Charlie). C'était la seule date de
  // la colonne de production, et une deuxième à tenir à jour à côté de celle
  // qu'on a promise au client. La colonne `date_prevue` reste en base.
  // On cherche l'ÉCRITURE, pas le mot : le commentaire qui explique le retrait
  // dit « la colonne `date_prevue` reste en base », et le test tomberait sur sa
  // propre explication.
  assert.ok(!/prevu\.rangee/.test(JS) && !/patchLigne\('date_prevue'/.test(JS),
    '« Prévu à l’atelier » ne se saisit plus dans la fiche');
  // LE FILET PASSE SOUS LE TITRE, DES DEUX CÔTÉS. Il séparait la DATE du détail :
  // à droite il n'y a plus de date, et laisser la règle telle quelle aurait fait
  // partir la colonne de droite 71 px au-dessus de sa voisine. Sous le titre, il
  // souligne la zone — même geste des deux côtés, et les QUATRE premières
  // rangées des deux colonnes retombent sur la même ligne (mesuré à 1440 :
  // 187,3 · 247,3 · 307,3 · 367,3 des deux côtés).
  assert.ok(PRODUCTION.includes("droite.append(titreSection('Production'), el('div', 'fa-filet'));"),
    'la colonne de production ouvre sur son titre et son filet');
  assert.ok(CLIENT.includes("gauche.append(titreSection('Client'), el('div', 'fa-filet'), blocClient);"),
    '… et celle du client sur les deux mêmes, dans le même ordre');
  // LE RETRAIT EST DANS LA GRILLE (30/08). Il vivait dans une rangée en `flex`
  // à lui : sa date s'étirait sur ce qui restait et l'heure démarrait à
  // 347,2 px, là où les trois rangées du dessous posent leur deuxième intitulé
  // à 364,5 — un rail de plus, sur la seule ligne hors grille.
  assert.ok(CLIENT.includes("rangee('Retrait', quand),")
    && CLIENT.includes("rangee('Délai', rappel),"),
    'la date de retrait et le délai restant sont deux cases de la grille du client');
  // LA DATE ET L'HEURE DANS UNE SEULE CASE : c'est un fait, pas deux. Le délai
  // restant est une déduction — il a sa case. Derrière l'heure, il n'avait plus
  // que 124 px et « 5 jours ouvrés restant » s'y cassait en deux lignes.
  assert.ok(CLIENT.includes('quand.append(remise.champ, chHeure);'),
    'la date et l’heure partagent leur case');
  assert.ok(!/remise\.rangee/.test(JS), 'plus de rangée à part pour la date');
  // ⚠ « Production » ET « Consigne » SONT PARTIS (29/08). Charlie, en désignant
  // les trois champs de texte libre de la fiche : « tout ça doit être supprimé
  // et il doit y avoir UNE SEULE note à la fin ». Ils demandaient la même chose
  // trois fois, et la vendeuse devait choisir lequel remplir.
  // Le poste de production n'est pas orphelin : le ticket de l'atelier le porte
  // et le rend modifiable, et les deux papiers l'impriment.
  assert.ok(!/chProduction|chConsigne/.test(JS),
    'ni le poste de production ni la consigne ne se saisissent plus ici');
  // Le paiement : de l'argent, et rien d'autre.
  // LE COMPTE EST EN BAS A DROITE — c'est la norme de tout devis et de toute
  // facture : le total ferme le document, calé à droite, ses lignes empilées
  // sur un même rail. À gauche, ce qui ne regarde que l'atelier.
  // TOUT L'ARGENT SUR UNE SEULE BANDE (29/08) : six cases, chacune un intitulé
  // au-dessus de sa valeur, et les deux signes qui disent la soustraction.
  for (const attendu of ["caseArgent('Coût', null, chCout)", "caseArgent('Règlement', 'fa-case--large', selReglement)",
    "caseArgent('Marge', null, valMarge)", "caseArgent('Prix TTC', null, chTtc)", "'Acompte versé le'",
    "caseArgent('Reste à payer', 'fa-case--fin', reste)"]) {
    assert.ok(PAIEMENT.includes(attendu), `la zone Paiement doit porter ${attendu}`);
  }
  // DEUX MOITIÉS, comme la fiche au-dessus : à gauche ce qui ne regarde que
  // l'atelier, à droite le compte du client — et le trait entre les deux tombe
  // sur celui qui sépare les deux colonnes.
  assert.ok(PAIEMENT.includes('panneau.append(moitieG, moitieD);'),
    'la bande est faite de deux moitiés, pas d’une file de neuf éléments');
  // RIEN NE PASSE A DROITE DU CHIFFRE. Au premier essai, la date de l'acompte
  // et le bouton « Soldé » étaient posés APRÈS le montant dans leur rangée :
  // les trois chiffres finissaient à 1 330, 1 181 et 1 268 px — trois rails.
  // Une échelle de montants qui ne s'aligne pas ne se lit pas.
  assert.ok(!/acompteCase\.append/.test(PAIEMENT) && !/resteCase\.append/.test(PAIEMENT),
    'un montant est seul dans sa case : ce qui l’accompagne va dans le libellé');
  // ET IL SE COLLE A DROITE PAR UNE MARGE AUTOMATIQUE. `justify-content:
  // flex-end` rognerait par la GAUCHE dès que le contenu déborde : c'est le
  // début de la ligne qui disparaîtrait, donc le libellé.
  // LE COMPTE EMPILÉ A ÉTÉ REMPLACÉ PAR LA BANDE, puis la bande a été posée sur
  // les rails des colonnes (29/08). `.fa-argent*` et `.fa-moins` ne sont plus
  // écrits nulle part : leurs règles sont parties avec eux.
  assert.ok(!/\.fa-argent[ .{]/.test(CSS.replace(/\/\*[\s\S]*?\*\//g, ''))
    && !/fa-argent/.test(JS) && !/fa-moins/.test(JS),
    'plus une seule règle ne vise le compte empilé');
  // ⚠ IL NE TRAVERSE PLUS LES DEUX COLONNES (29/08). Il le faisait, et ce qui
  // ne regarde que l'atelier tenait une rangée pleine largeur AU-DESSUS de lui :
  // le compte descendait donc sous elle, et il restait un rectangle vide de
  // 910 × 225 px en bas à gauche, pour 318 px de panneau. Charlie : « toute
  // cette partie doit être ensemble, et beaucoup moins haute ». Le compte tient
  // maintenant la colonne de DROITE, l'atelier celle de gauche, et le panneau
  // fait la hauteur du plus haut des deux au lieu de leur somme.
  // CHAQUE CASE PART D'UN RAIL DE LA GRILLE DU HAUT — c'est l'invariant, et il
  // ne dépend pas du nombre de pistes. Il en fallait QUATRE tant que l'intitulé
  // vivait à gauche de sa valeur (`106px 1fr 106px 1fr`) ; depuis le 31/08 il
  // est AU-DESSUS, une case porte donc les deux et n'occupe qu'une piste. Deux
  // champs par rangée dans les deux cas — ce qui compte est que les TROIS
  // grilles se définissent au même endroit, sinon ce sont trois rails qui se
  // ressemblent.
  const MOITIE = CSS.match(/\.fa-details__moitie \{[\s\S]*?\n\}/)[0];
  const GRILLES = CSS.match(/\.fa-grille-client,\n\.fa-grille-prod \{[^}]*\}/)[0];
  assert.match(GRILLES, /grid-template-columns: 1fr 1fr;/,
    'les deux grilles du haut portent EXACTEMENT la même définition');
  for (const [nom, regle] of [['la bande', MOITIE], ['les colonnes', GRILLES]]) {
    assert.match(regle, /gap: var\(--rangee\);/,
      `${nom} : la gouttière est partagée — c'est elle qui fait le rythme, pas le nombre de pistes`);
  }
  // L'INTITULÉ EST AU-DESSUS DE SA VALEUR, PARTOUT — la grammaire du comptoir
  // (31/08, Charlie). La fiche en avait trois : le rail de gauche (`.fa-row`),
  // l'alternance en pistes des deux grilles, et la case du paiement. Il ne
  // reste que la dernière, et plus rien ne doit rappeler les deux autres.
  assert.ok(!/\.fa-row[ .{,:]/.test(CSS.replace(/\/\*[\s\S]*?\*\//g, ''))
    && !/fa-row/.test(JS.replace(/\/\/.*$/gm, '')),
    'plus une seule règle ni un seul nœud ne pose l’intitulé à gauche de sa valeur');
  assert.ok(!/--fa-lab-w/.test(CSS.replace(/\/\*[\s\S]*?\*\//g, '')),
    'le rail de 106 px n’a plus d’objet : aucun intitulé ne se pose à gauche');
  assert.match(CSS, /\.fa-case--large \{ grid-column: span 2; \}/,
    'ce qui n’entre pas dans une piste en prend deux — jamais une largeur écrite');
  // LE RESTE SE DÉDUIT, IL NE SE SAISIT PAS — et « soldé » vaut zéro quoi qu'il
  // y ait dans les champs, sans quoi le mot ne veut rien dire.
  assert.ok(/majReste = \(\) => \{/.test(PAIEMENT), 'le reste se calcule');
  // ET IL SUIT LE PRIX, pas seulement l'acompte : vider le TTC laissait le
  // reste sur l'ancien montant — le seul chiffre de l'écran qui doive être
  // juste sans qu'on y pense.
  assert.ok(/apres: \(\) => \{ majMarge\(\); majReste\(\); \}/.test(JS),
    'changer le prix recalcule la marge ET le reste à payer');
  assert.ok(/if \(r\.paye === true\) \{ resteV\.textContent = euros\(0\)/.test(PAIEMENT),
    'un dossier soldé ne doit plus rien, quel que soit l’acompte saisi');
  assert.ok(/if \(ttc == null\) \{ resteV\.textContent = '—'/.test(PAIEMENT),
    'sans prix on ne déduit rien — on le dit, on n’affiche pas un montant faux');
  // LES DEUX DRAPEAUX SUIVENT LE MONTANT : laissés à la main, ils restaient à
  // NULL sur les vrais dossiers et le feu du planning se taisait (26/08 au soir).
  assert.ok(/ctx\.patchLigne\('acompte_verse', verse\)/.test(PAIEMENT)
    && /ctx\.patchLigne\('acompte_demande', verse\)/.test(PAIEMENT),
    'un acompte versé est forcément un acompte demandé : les deux se déduisent');
  for (const intrus of ['selType', 'chProduction', 'docs.append']) {
    assert.ok(!PAIEMENT.includes(intrus), `${intrus} n’a rien à faire dans la zone Paiement`);
  }
  // LE PRIX EST EN BAS, plus dans le bandeau.
  const BANDEAU = zone('// ZONE 2', '// ZONE 3');
  assert.ok(!/chTtc|valMarge/.test(BANDEAU.split('const valMarge')[0]),
    'le bandeau ne porte plus le prix');
  assert.ok(JS.includes("bandeau.append(blocEtape, el('div', 'fa-sep'), blocPrio);"),
    '… il ne porte plus que l’étape et la priorité');
  // ET PLUS DE « ÉTAPE SUIVANTE » : il doublait le menu d'à côté, qui fait la
  // même chose et permet en plus de sauter une étape.
  assert.ok(!/Étape suivante/.test(JS), 'plus de bouton « Étape suivante »');
}
// L'entête ne porte plus aucun bouton : on sort par Échap ou par un clic à côté,
// et l'annulation vit dans le message qui suit chaque modification.
// On lit le MONTAGE, pas le fichier : les deux libellés restent cités dans le
// commentaire qui explique leur retrait, et les chercher partout ferait tomber
// le garde-fou sur sa propre explication.
assert.ok(/tete\.append\(ident, outils\);/.test(JS),
  'l’entête ne porte plus le bouton « Retour au planning » ni celui d’annulation');
// LA CROIX EST LA SEULE SORTIE SOURIS. Depuis que l'écran défile, la carte
// occupe toute la largeur et toute la hauteur : il n'y a plus de « à côté » où
// cliquer. Sans elle, il ne resterait qu'Échap — un cul-de-sac à la souris,
// alors que la consigne du 26/08 est « on navigue à la souris ».
assert.ok(/outils\.append\(etatSauve, bouton\('fa-btn fa-btn--carre', '×', \(\) => ctx\.fermer\(\)\)\);/.test(JS),
  'la croix ferme la fiche : c’est la seule sortie souris qui reste');
// LE MESSAGE NE DIT PLUS LES RÉUSSITES (30/08) — donc plus de « Annuler », et
// plus de pile d'annulation : elle n'avait que cette porte-là.
assert.ok(!/'fa-toast__undo'/.test(JS) && !/const annulations/.test(JS),
  'plus de pile d’annulation : son unique porte est partie avec le message');
// (`.fa-details__b` a quitté cette liste le 30/08 avec la barre repliable.)
for (const zone of ['.fa-head', '.fa-bandeau', '.fa-details']) {
  const regle = CSS.match(new RegExp(`\\${zone} \\{[\\s\\S]*?\\n\\}`))[0];
  assert.ok(/flex-shrink: 0;/.test(regle),
    `${zone} ne se laisse pas comprimer : c'est du chrome fixe, pas de la place à prendre`);
}

// ---------------------------------------------------------------------------
// 2. LE PANNEAU DÉTAILS SE DÉPLIE DANS LE FLUX, ET IL RESTE MONTÉ
// ---------------------------------------------------------------------------
// Il a été un CALQUE tant que la fiche était forcée à 100 % de la hauteur : posé
// dans le flux, il n'avait alors nulle part où aller et comprimait les colonnes.
// La fiche fait sa taille depuis le 28/08 — il l'allonge, ce qui est la seule
// façon d'être OUVERT PAR DÉFAUT sans recouvrir le dossier qu'on vient lire.
const PANNEAU = CSS.match(/\.fa-details \{[\s\S]*?\n\}/)[0];
assert.ok(!/position: absolute;/.test(PANNEAU),
  'le panneau se déplie dans le flux : en calque, ouvert par défaut, il masquerait les deux colonnes');
// OUVERT PARTOUT, ET PLUS SEULEMENT PAR DÉFAUT. Il a fallu trois détours avant
// d'y arriver — un calque qui recouvrait les colonnes, un seuil de hauteur qui
// le fermait sous 1000 px, puis une barre repliable dont personne ne se servait.
// Depuis le 30/08 il n'a plus d'état caché du tout : ni `hidden`, ni bouton.
assert.ok(!/panneau\.hidden/.test(JS),
  'le panneau n’a plus d’état caché : il est là, tout le temps');
assert.ok(!/@media[^{]*\{\s*\.fa-details \{[\s\S]*?position: absolute;/.test(CSS),
  'et il ne redevient un calque nulle part');
// LA NOTE S'INTERCALE ENTRE LES DEUX (29/08) : on a fini de lire le dossier, on
// écrit ce qui ne rentrait dans aucune case, puis on regarde l'argent.
//
// UN QUATRIÈME BLOC S'EST GLISSÉ LE 04/09, entre la note et l'argent : la
// SAISIE DU COMPTOIR (`.fa-saisie`), l'archive de ce que la vendeuse a tapé en
// boutique. Elle arrive là et pas ailleurs pour la même raison que la note :
// on lit le dossier, on écrit ce qu'on a à dire, on va chercher le détail
// d'origine si on en a besoin, et l'argent ferme l'écran — c'est lui qu'on
// regarde en dernier, et la barre du bas est faite pour ça.
// Elle est CONDITIONNELLE : les dossiers qui ne viennent pas du comptoir n'ont
// rien à montrer, et un cadre autour de rien est un défaut.
assert.ok(/scene\.append\(travail, blocNote, \.\.\.\(saisie \? \[saisie\] : \[\]\), panneau\);/.test(JS),
  'il vit dans la scène, qu’il allonge en se dépliant — la note le précède, et la saisie du comptoir s’intercale entre les deux');
// L'ORDRE COMPTE PLUS QUE L'ÉCRITURE : si la ligne ci-dessus doit changer, ces
// trois-là disent ce qu'il faut préserver.
{
  const ligne = JS.match(/scene\.append\([\s\S]*?panneau\);/)[0];
  const rang = (nom) => ligne.indexOf(nom);
  assert.ok(rang('travail') < rang('blocNote'), 'les colonnes d’abord : on lit le dossier');
  assert.ok(rang('blocNote') < rang('saisie'), '… puis la note : on écrit ce qui ne rentrait nulle part');
  assert.ok(rang('saisie') < rang('panneau'), '… et l’argent ferme l’écran, toujours en dernier');
}
// TOUT LE FINANCIER D'UN COUP : aucune hauteur maximale, aucun défilement
// interne. Il avait `max-height: 400px; overflow: auto` du temps du calque.
assert.ok(!/max-height/.test(PANNEAU) && !/overflow: auto/.test(PANNEAU),
  'rien n’y est coupé ni renvoyé derrière une barre de défilement');

// IL N'EST JAMAIS DÉMONTÉ. Retiré du document, il emporterait les valeurs qu'on
// venait d'y saisir et fausserait les calculs qui les lisent — `majReste` lit
// `chTtc.value` et `chAcompte.value` dans le DOM.
assert.ok(!/panneau\.remove\(\)/.test(JS), 'jamais retiré du document');

// ---------------------------------------------------------------------------
// 3. CE QU'ON TAPE VITE, CE QU'ON RELIT
// ---------------------------------------------------------------------------
// À l'atelier on tape « 1430 », on veut relire « 14h30 ». Une saisie non
// reconnue est laissée TELLE QUELLE : refuser une valeur au comptoir, c'est
// perdre l'information que quelqu'un venait d'écrire.
// `toLocaleString('fr-FR')` sépare les milliers par une espace INSÉCABLE ÉTROITE
// (U+202F), pas par une espace ordinaire : comparer à l'espace du clavier fait
// échouer un test sur un format qui est le bon. On normalise les blancs.
const blancs = (s) => s.replace(/\s/g, ' ');
assert.strictEqual(normaliserMontant('648,96'), '648,96 €');
assert.strictEqual(normaliserMontant('648.96'), '648,96 €');
assert.strictEqual(normaliserMontant('648,96 €'), '648,96 €');
assert.strictEqual(blancs(normaliserMontant('1250,5')), '1 250,50 €');
assert.strictEqual(normaliserMontant(''), '');
assert.strictEqual(normaliserMontant('à voir'), 'à voir', 'ce qu’on ne sait pas lire, on le garde');

assert.strictEqual(normaliserTelephone('0690778899'), '06 90 77 88 99');
// Sous huit chiffres ce n'est pas un numéro : un poste, un début de saisie.
assert.strictEqual(normaliserTelephone('123'), '123');

// L'HEURE NE SE TAPE PLUS (30/08) : elle se choisit dans une liste de créneaux
// — 9h30 à 11h30 et 14h à 17h, toutes les demi-heures. `normaliserHeure` est
// partie avec la frappe ; ce qu'on vérifie maintenant, c'est la LISTE.
// `normaliserHeure` SERT À LA SAISIE LIBRE du menu — « Autre heure… ». Elle
// était partie le matin avec la frappe, elle revient l'après-midi avec la case
// qui s'ouvre sous cette ligne : elle accepte « 1430 » et rend « 14h30 ».
assert.strictEqual(normaliserHeure('14'), '14h00');
assert.strictEqual(normaliserHeure('1430'), '14h30');
assert.strictEqual(normaliserHeure(''), '');
assert.match(JS, /if \(lu\) poserHeure\(lu\.replace\('h', ':'\)\);/,
  '… et ce qu’elle rend se range en « HH:MM », le format de la base');
{
  const l = JS.match(/const CRENEAUX = \[([\s\S]*?)\];/);
  assert.ok(l, 'les créneaux sont une liste nommée');
  const creneaux = l[1].match(/'(\d\d:\d\d)'/g).map((x) => x.slice(1, -1));
  assert.deepStrictEqual(creneaux, ['09:30', '10:00', '10:30', '11:00', '11:30',
    '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00'],
  'de 9h30 à 11h30 et de 14h à 17h, toutes les demi-heures');
  // ⚠ UNE HEURE HORS LISTE NE SE PERD PAS : les dossiers du comptoir en portent
  // (« 06:00 »). Un menu qui ne la propose pas la rendrait VIDE à l'affichage,
  // et la première écriture du champ l'effacerait sans que rien ne le dise.
  assert.ok(/\[\.\.\.CRENEAUX, heureChoisie\]\.sort\(\)/.test(JS),
    'une heure déjà posée hors créneaux entre dans la liste, à sa place');
  // ET ON PEUT AJOUTER LA SIENNE (30/08, Charlie : « on doit pouvoir ajouter sa
  // propre heure avec "ajouter" dans l'input »). C'est le MÊME menu que celui
  // des faces, à deux rangées de là : un panneau, donc un endroit où poser une
  // création — ce qu'une liste du navigateur n'a pas.
  assert.match(JS, /'Autre heure…',/, 'le menu de l’heure porte sa ligne de création');
  assert.match(JS, /const saisirHeure = \(\) => \{/,
    '… qui ouvre une case, pas un `prompt\(\)`');
  // ⚠ SUR LE CODE NU : le commentaire qui explique pourquoi on ne l'utilise pas
  // le nomme, et le contrôle tombait sur sa propre explication.
  assert.ok(!/prompt\(/.test(JS.replace(/\/\/[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')),
    'jamais `prompt()` : il bloque la page et emmène le focus');
}

// Un jeudi 27 août 2026 pour repère.
const REPERE = new Date(2026, 7, 27, 12, 0, 0);
assert.strictEqual(normaliserDate('3/9', REPERE).texte, 'jeu. 03/09');
assert.strictEqual(normaliserDate('03/09/2026', REPERE).texte, 'jeu. 03/09');
assert.strictEqual(normaliserDate('demain', REPERE).texte, 'ven. 28/08');
assert.strictEqual(normaliserDate('auj', REPERE).texte, 'jeu. 27/08');
// UN NOM DE JOUR RENVOIE LA PROCHAINE OCCURRENCE, jamais aujourd'hui : « jeudi »
// dit un jeudi veut dire la semaine suivante.
assert.strictEqual(normaliserDate('jeudi', REPERE).texte, 'jeu. 03/09');
// « +N » = DANS N JOURS. Les quatre boutons rapides ont été retirés le 28/08 :
// ce raccourci est ce qu'ils disaient, il doit rester atteignable au clavier.
assert.strictEqual(normaliserDate('+3', REPERE).texte, 'dim. 30/08');
assert.strictEqual(normaliserDate('+7', REPERE).texte, 'jeu. 03/09');
assert.strictEqual(normaliserDate('+ 1', REPERE).texte, 'ven. 28/08');
assert.strictEqual(normaliserDate('n’importe quoi', REPERE).texte, 'n’importe quoi');
// L'ISO part en base, le texte reste à l'œil : deux choses, jamais confondues.
assert.strictEqual(normaliserDate('3/9', REPERE).iso, '2026-09-03');
assert.strictEqual(normaliserDate('à voir', REPERE).iso, null);

// ---------------------------------------------------------------------------
// 4. LA MARGE SE CALCULE, ELLE NE SE STOCKE PAS
// ---------------------------------------------------------------------------
assert.strictEqual(blancs(texteMarge(648.96, 318.17)), '330,79 € · 51 %');
// UN TTC VIDE OU NUL REND UN TIRET. Une marge sur rien n'est pas zéro pour
// cent : c'est une marge qu'on ne connaît pas, et l'écran doit le dire.
assert.strictEqual(texteMarge(null, 100), '—');
assert.strictEqual(texteMarge(0, 100), '—');
assert.strictEqual(texteMarge(500, null), '—');

// ---------------------------------------------------------------------------
// 5. AUCUN RACCOURCI CLAVIER, SAUF SORTIR
// ---------------------------------------------------------------------------
// Demande explicite : on navigue à la souris, on écrit au clavier. Ce qui se
// SAISIT se tape (les boutons de date et les steppers ont été retirés le
// 28/08) ; ce qui se NAVIGUE se clique.
assert.ok(!/key === '[a-zA-Z]'|ctrlKey|metaKey/.test(JS),
  'aucun raccourci clavier dans la fiche');
assert.ok(/if \(e\.key !== 'Escape' \|\| !ficheAtelierId\) return;/.test(APP),
  'Échap ferme — c’est le geste que tout le monde a déjà, et il ne remplace aucun bouton');
// … MAIS D'ABORD CE QUI EST POSÉ PAR-DESSUS. Le calendrier du champ « Retrait »
// vit dans le <body>, au-dessus de la fiche : sans garde, une seule touche
// fermait les deux, et renoncer à changer une date emportait l'écran.
// LA GARDE EST DANS LE COMPOSANT, EN CAPTURE — écrite du côté de la fiche
// (« y a-t-il un panneau ouvert ? ») elle ne marchait pas : le calendrier avait
// déjà retiré le sien quand on regardait.
{
  const CAL = fs.readFileSync(path.join(RACINE, 'public/calendrier.js'), 'utf8');
  assert.ok(/if\(ev\.key!=='Escape'\|\|!calOuvert\)return;\s*\n\s*ev\.stopPropagation\(\);/.test(CAL),
    'Échap referme le calendrier et s’arrête là');
  assert.ok(/calFermer\(\);\n\},true\);/.test(CAL),
    '… en capture, pour passer avant l’Échap de l’écran qui l’accueille');
}
// LE MESSAGE NE PARLE PLUS QUE DES REFUS (30/08). Charlie, en désignant la
// bande noire qui s'affichait à chaque enregistrement : « il faut supprimer
// ça ». Elle était grande PAR DÉFAUT — une accolade orpheline avalait la règle
// qui posait sa zone — mais l'arbitrage porte sur le fond : trois confirmations
// pour une frappe, il n'en reste qu'UNE, le point de l'entête.
// « Le vert se tait, l'échec parle » : le message reste, pour ce qu'on refuse.
{
  const messages = JS.match(/\bdire\(/g) || [];
  assert.strictEqual(messages.length, 1,
    `le message ne sert plus qu’aux refus (${messages.length} appels trouvés)`);
  assert.ok(/dire\('Pas de prix TTC/.test(JS),
    '… et celui qui reste est un refus, pas une réussite');
}
// ⚠ ET SA ZONE EST BIEN POSÉE. Une accolade orpheline au premier niveau d'une
// feuille n'est pas ignorée : l'analyseur la prend pour le début d'une règle et
// AVALE la suivante. C'est ce qui est arrivé à `.fa-toast-zone` — sans elle,
// plus de `position: absolute` ni de `left`, et la pastille du coin s'étalait
// sur les 1440 px de l'écran.
assert.ok(/\.fa-toast-zone \{ position: absolute; left: 20px;/.test(CSS),
  'le message se pose dans le coin, il ne barre pas l’écran');
assert.ok(!/^\}$/m.test(CSS.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[^{}\n]*\{[\s\S]*?\n\}$/gm, '')),
  'aucune accolade orpheline : elle mangerait la règle qui la suit');

// ---------------------------------------------------------------------------
// 6. LE MODULE NE DÉPEND PAS D'APP.JS
// ---------------------------------------------------------------------------
// Un cycle entre deux modules s'initialise dans un ordre qui dépend de qui
// charge qui, et le jour où il casse, il casse à l'ouverture de l'application.
// Ce que la fiche sait faire de l'application lui est passé à l'appel (`ctx`).
assert.ok(!/from '\.\/app\.js'/.test(JS), 'la fiche n’importe rien d’app.js');
assert.ok(/import \{ dessinerFicheAtelier \} from '\.\/fiche-atelier\.js'/.test(APP),
  'c’est app.js qui l’importe, dans ce sens seulement');
for (const clef of ['patchLigne', 'patchFiche', 'patchProd', 'fermer']) {
  assert.ok(new RegExp(`ctx\\.${clef}`).test(JS), `\`ctx.${clef}\` doit être fourni par l'appelant`);
}
// LA NOTE HORODATÉE NE REVIENT PAS COMME CODE MORT (29/08). `ctx.ajouterNote`
// a survécu une journée entière à la barre basse qui l'appelait : plus rien ne
// la déclenchait, et le contrôle d'à côté la trouvait quand même — dans un
// COMMENTAIRE de la fiche. Une sonde qui cherche un nom dans un fichier ne dit
// pas s'il est ATTEINT (voir la mémoire « les sondes de code mort mentent ») :
// celle-ci porte donc sur la déclaration, dans app.js, où la fonction vivait.
assert.ok(!/^\s*ajouterNote:/m.test(APP), '`ajouterNote` est partie avec la barre basse');
// LE PRIX SUIT TOUJOURS : corriger une taille passe par la même porte que le
// reste (voir chiffrage.js), la fiche ne recalcule rien elle-même.
assert.ok(/patchProd: \(patchProd\) => envoyerProduction\(r, patchProd\)/.test(APP),
  'les tailles passent par le chemin qui retarife la ligne');

// ---------------------------------------------------------------------------
// 7. DEUX PIÈGES DE MISE EN PAGE, NOMMÉS DANS LA SPEC
// ---------------------------------------------------------------------------
// `min-width: 0` sur la case de taille : la largeur intrinsèque d'un `<input>`
// (≈ 20 caractères) l'emporte sinon sur la piste de la grille, et les quatre
// cases débordent de la colonne.
const CASE = CSS.match(/\.fa-taille \{[\s\S]*?\n\}/)[0];
assert.ok(/min-width: 0;/.test(CASE), 'sans min-width:0, la grille des tailles déborde');
// Le reset : un champ en `width:100%` avec padding sort de sa colonne sans lui.
assert.ok(/\.fa \*, \.fa \*::before, \.fa \*::after \{ box-sizing: border-box; \}/.test(CSS),
  'le reset de boîte est posé sur la fiche');

// ---------------------------------------------------------------------------
// 8. LA FEUILLE ET LE MODULE PARTENT AVEC LA COQUILLE
// ---------------------------------------------------------------------------
// Hors ligne, un import qui échoue empêche TOUTE l'application de s'ouvrir.
assert.ok(lire('public/sw.js').includes("'/fiche-atelier.js'"), 'le module est dans la coquille du SW');
assert.ok(lire('public/sw.js').includes("'/fiche-atelier.css'"), 'la feuille aussi');
assert.ok(lire('public/index.html').includes('modulepreload" href="fiche-atelier.js"'));
assert.ok(lire('public/index.html').includes('href="fiche-atelier.css"'));

console.log('✓ fiche atelier : rien ne défile, le panneau est un calque, les saisies se relisent');
