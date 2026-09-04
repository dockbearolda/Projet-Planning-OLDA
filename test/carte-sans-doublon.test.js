'use strict';

// LA CARTE NE DIT PAS DEUX FOIS LA MÊME CHOSE (26/08/2026)
//
// Charlie : « je trouve qu'il y a beaucoup trop de choses et j'ai l'impression
// qu'il y a des doublons. » Il y en avait cinq. Ce fichier les tient fermés —
// chacun est revenu une fois par une bonne intention, ils reviendront.
//
//   1. L'ÉCHÉANCE ÉCRITE TROIS FOIS, avec DEUX dates différentes (« 2 jours
//      ouvrés et 4 heures » / « Remise client : 29/08 » / « À terminer avant
//      ven. 28/08 18h00 ») et rien pour dire laquelle compte.
//   2. LE RÉFÉRENT ÉCRIT DEUX FOIS : la pastille noircie, et son nom dessous.
//   3. LE CLIENT ET LE TICKET ÉCRITS TROIS FOIS sur un lot : la bannière, puis
//      chaque carte.
//   4. « RANGER » PROPOSÉ TROIS FOIS pour un seul geste utile.
//   5. LA RÉFÉRENCE PRODUIT ÉCRITE DEUX FOIS : dans la désignation, puis dans
//      la ligne de production juste dessous.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RACINE, 'public/app.js'), 'utf8');
// La fiche de production et la rangée « Manque » ont quitté app.js le 27/08 :
// deux blocs sortables, mesurés avant de couper (voir ligne-faits.js).
const FAITS = fs.readFileSync(path.join(RACINE, 'public/ligne-faits.js'), 'utf8');
const CSS = fs.readFileSync(path.join(RACINE, 'public/styles.css'), 'utf8');
const FICHE = fs.readFileSync(path.join(RACINE, 'public/fiche-atelier.js'), 'utf8');

// Le corps d'une fonction, accolades comptées à partir de celle qui suit la
// parenthèse fermante — et NON de la première rencontrée : une valeur par
// défaut dans la signature (`opts = {}`) refermerait le compte aussitôt.
function corps(nom) {
  const debut = APP.indexOf(`function ${nom}(`);
  assert.ok(debut >= 0, `« function ${nom}( » doit rester repérable`);
  const ouvrante = APP.indexOf('{', APP.indexOf(')', debut));
  let profondeur = 0;
  for (let i = ouvrante; i < APP.length; i += 1) {
    if (APP[i] === '{') profondeur += 1;
    else if (APP[i] === '}' && (profondeur -= 1) === 0) return APP.slice(debut, i + 1);
  }
  throw new Error(`${nom} ne se referme pas`);
}

const CARTE = corps('buildCard');

// ---------------------------------------------------------------------------
// 1. UNE SEULE ÉCHÉANCE — le décompte, et la promesse au client
// ---------------------------------------------------------------------------
// « À terminer avant … » est le MÊME instant que le décompte, écrit en absolu.
// Il portait en plus une seconde date à côté de la promesse client, sans qu'un
// mot n'explique laquelle des deux compte.
assert.match(CARTE, /pcardBloc\('Délai restant', delaiEl, remise\)/,
  'le bloc du délai ne porte que le décompte et la remise au client');
assert.doesNotMatch(CARTE, /cible\.textContent/,
  '« À terminer avant » ne s’écrit plus sur la carte');
// Elle n'est pas PERDUE pour autant : elle se lit au survol du décompte, et en
// clair dans la fiche.
assert.match(CARTE, /attachTip\(delaiEl, `À terminer avant \$\{d\.echeanceTexte\}`\)/);
// La fiche, elle, l'écrit en toutes lettres — dans fiche-atelier.js depuis que
// le tiroir a été retiré (29/08) : le champ « Remise au client » porte la date
// en clair, et se corrige sur place.
// Depuis le 29/08 la date porte le nom du geste qu'elle décrit : le RETRAIT.
// Il y avait deux heures côte à côte — l'heure de remise et le créneau de
// retrait — pour le même fait : quand le client passe prendre sa commande.
assert.match(FICHE, /ligneDate\('Retrait par le client'/,
  'la fiche, elle, l’écrit en toutes lettres — et elle se corrige');
// Deux `.pcard__sub` au plus dans une carte : la remise, et le motif d'alerte
// n'en est pas un. Trois, c'était l'empilement d'avant.
assert.strictEqual((CARTE.match(/'pcard__sub'/g) || []).length, 1);

// ---------------------------------------------------------------------------
// 2. LE NOM DU RÉFÉRENT NE S'ÉCRIT QUE SI AUCUNE PASTILLE NE LE DIT
// ---------------------------------------------------------------------------
assert.match(CARTE, /nomRef\.hidden = allumee/,
  'une initiale noircie et le nom dessous, c’est deux fois la même chose');
// Il RESTE quand il vient du réglage de la catégorie : là aucune pastille n'est
// allumée, et la carte serait muette sur la seule question qui compte.
assert.match(CARTE, /nomRef\.textContent = allumee \? '' : `Référent : \$\{eff\.qui\}`/);
// `hidden` ne masque rien tout seul quand une classe voisine porte son propre
// `display` : la règle est écrite en clair.
assert.match(CSS, /\.pcard__ref-name\[hidden\] \{ display: none; \}/);

// ---------------------------------------------------------------------------
// 3 et 4. SOUS UNE BANNIÈRE, LA CARTE SE TAIT
// ---------------------------------------------------------------------------
// La bannière nomme le client et le ticket : la colonne dit alors QUEL article
// on lit — la seule chose que la bannière ne peut pas dire à sa place.
assert.match(CARTE, /opts\.coiffee && lot/);
assert.match(CARTE, /pcardBloc\('Article'/);
// Ni bouton « Ranger », ni puce d'étape : la bannière porte le geste ET la
// destination. Et « À trier » répété sur l'écran « À trier » n'apprend rien.
assert.match(CARTE, /if \(!opts\.rangeParLeGroupe\) \{/);
assert.match(APP, /btn\.textContent = `Ranger les \$\{n\} dans \$\{STAGE_LABEL\[dest\.stage\]\}`/,
  'la destination est SUR le bouton de la bannière, plus seulement dans l’infobulle');

// UNE SEULE RÈGLE, lue par la bannière (qui pose le bouton) et par les cartes
// (qui ne posent pas le leur). Deux règles qui se ressemblent finissent par
// diverger — et alors plus personne ne peut ranger.
assert.match(APP, /function bandeRangeable\(bande\)/);
assert.strictEqual((APP.match(/bandeRangeable\(/g) || []).length, 3,
  'bandeRangeable : sa définition, la bannière, les cartes — pas une de plus');

// LA SIGNATURE PORTE L'APPARTENANCE AU GROUPE. Sans elle, une carte sortie de
// son lot garderait l'en-tête d'un groupe qu'elle vient de quitter jusqu'au
// prochain aller-retour serveur — la signature ne suit que `updated_at`.
assert.match(APP, /const sig = `\$\{r\.id\}:\$\{r\.updated_at\}:\$\{coiffee \? 'b' : ''\}/);

// ---------------------------------------------------------------------------
// 5. LA RÉFÉRENCE PRODUIT NE S'ÉCRIT PAS DEUX FOIS
// ---------------------------------------------------------------------------
// « T-shirt col rond NS300 » puis « RÉF. NS300 · Blanc » : deux fois NS300 sur
// trois centimètres. La ligne de production ne répète pas ce que la
// désignation dit déjà.
const faits = FAITS.slice(FAITS.indexOf('const PROD_FAITS = ['), FAITS.indexOf('\n];', FAITS.indexOf('const PROD_FAITS = [')));
assert.match(faits, /nom\.includes\(p\.ref\) \? '' : p\.ref/);
// LA COULEUR A QUITTÉ LA RANGÉE DE LA RÉFÉRENCE LE 04/09 : elle a la sienne,
// entre la référence et les tailles — l'ordre que Charlie demande, et un
// interrupteur par chose. Ce n'est pas un doublon de plus : elle ne s'écrit
// toujours qu'à UN endroit.
assert.match(faits, /key: 'prod_couleur'/);
assert.strictEqual((faits.match(/p\.couleur/g) || []).length, 1,
  'la couleur du vêtement ne s’écrit qu’une fois dans le bloc');
assert.match(faits, /key: 'prod_dtf'/);
// ET LA TAILLE DU LOGO A QUITTÉ CELLE DU LOGO, pour la même raison : on ne
// pouvait pas la masquer sans masquer la face qu'elle mesure.
assert.match(faits, /key: 'prod_logo_mm'/);

console.log('✓ carte : cinq doublons fermés — une échéance, un référent, un en-tête de lot, un bouton, une référence');
