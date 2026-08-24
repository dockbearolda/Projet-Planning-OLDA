'use strict';

// L'ÉTAPE CLIENT, ET CE QUI N'A PLUS À ÊTRE DIT (24/08/2026)
//
// Quatre demandes du patron, sur l'écran « Demande de devis » :
//
//   1. LE PAVÉ VERT « Informations reçues » S'EN VA. Il relisait, en vert et
//      juste sous les champs, ce qu'on venait d'y taper.
//   2. UN CLIENT CRÉÉ ICI ENTRE EN BASE. Il n'existait que dans l'onglet
//      jusqu'à ce que la demande parte au planning.
//   3. LE CHOIX DU CLIENT EST UNE LISTE DÉROULANTE — le composant des besoins,
//      chevron compris, dépliée en arrivant sur l'étape.
//   4. « SUITE SOUHAITÉE POUR CE CLIENT » S'EN VA : l'étape 4 pose déjà la
//      question. Et les deux bandeaux VERTS de l'écran de fin s'en vont aussi —
//      ce qui ne va PAS, lui, reste entier.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const DEVIS = lire('public/comptoir/demande-devis.html');
const PONT = lire('public/comptoir/pont.js');
const SERVEUR = lire('server.js');

// ===========================================================================
// 1. Le pavé « Informations reçues » n'existe plus
// ===========================================================================
assert.ok(!/id="controlBox"/.test(DEVIS), 'le pavé de relecture a disparu du HTML');
assert.ok(!/controlBox/.test(DEVIS), '… et plus aucun code ne l’écrit');

// La fonction, elle, RESTE : une vingtaine de champs l'appellent à la frappe.
// La supprimer aurait tué la saisie de l'étape 4 sur la première touche.
assert.ok(/function updateControl\(\)\{\s*updateSidebar\(\);\s*\}/.test(DEVIS),
  'updateControl reste, réduite à ce qui sert encore');
assert.ok(/oninput="updateControl\(\)"/.test(DEVIS),
  'les champs de l’étape 4 l’appellent toujours');

// ===========================================================================
// 2. Un client créé au comptoir entre en base TOUT DE SUITE
// ===========================================================================
assert.ok(/window\.oldaEnregistrerClient = enregistrerClient/.test(PONT),
  'l’écriture vit dans pont.js, jamais dans l’écran du patron');
assert.ok(/async function enregistrerClient\(fiche, idExistant\)/.test(PONT),
  'une seule porte pour créer ET pour corriger une fiche');

const bloc = (src, entete) => {
  const i = src.indexOf(entete);
  assert.ok(i > -1, `bloc introuvable : ${entete}`);
  return src.slice(i, i + 2600);
};
const ECRIRE = bloc(PONT, 'async function enregistrerClient(');

assert.ok(/idExistant \? 'PATCH' : 'POST'/.test(ECRIRE),
  'création = POST, correction = PATCH — la fiche ne se dédouble pas quand on la corrige');
assert.ok(/\/api\/clients/.test(ECRIRE), 'sur la vraie base clients du CRM');

// LE MINUTEUR. Sur un wifi d'atelier qui décroche, `fetch` n'échoue jamais : il
// attend. Le bouton resterait sur « Enregistrement… » pour la journée.
assert.ok(/fetchMinute\(url, \{/.test(ECRIRE), 'l’écriture passe par le minuteur');
assert.ok(/const fetchMinute = async \(url, options\) => \{[\s\S]*?AbortController/.test(PONT),
  'le minuteur repose sur AbortController');

// LE DOUBLON N'EST PAS UNE PANNE. Deux comptoirs qui inscrivent le même
// nouveau client en même temps, c'est le cas NORMAL ici : le serveur refuse la
// seconde écriture, on récupère la fiche qui a gagné au lieu d'en faire une
// deuxième — et surtout au lieu de laisser la vendeuse sans client.
assert.ok(/res\.status === 409/.test(ECRIRE), 'le refus pour doublon est reconnu');
assert.ok(/await chargerClients\(\)/.test(ECRIRE),
  '… la base est relue : la fiche gagnante n’est pas encore dans cet onglet');
assert.ok(/cleClient\(c\.name\) === cle/.test(ECRIRE),
  '… et retrouvée par la MÊME normalisation que la base (accents, casse, ponctuation)');

// La normalisation doit être celle de db.js, sinon « Hôtel X » et « HOTEL X »
// ne se rejoignent pas et la récupération échoue précisément quand elle sert.
const CLE = bloc(PONT, 'const cleClient =');
["normalize('NFD')", 'toLowerCase()', "replace(/[^a-z0-9]+/g, ' ')"].forEach((m) => {
  assert.ok(CLE.includes(m), `la clé de rapprochement doit contenir ${m}`);
});

// La base fait foi : on ne garde pas deux versions de la même fiche.
assert.ok(/clientDirectory\.splice\(i, 1, enregistree\)/.test(ECRIRE),
  'la fiche locale est REMPLACÉE par celle de la base (vrai identifiant, code CLI-…)');

// Le rôle du contact était perdu en silence : la colonne existe, mais elle
// n'était pas dans la liste des champs qu'une écriture a le droit de remplir.
assert.ok(/fonction: 80,/.test(SERVEUR), 'le serveur accepte d’écrire `fonction`');
assert.ok(/corps\.fonction = fiche\.contactRole/.test(PONT), '… et le comptoir la lui envoie');

// ON NE POSE RIEN SI L'ÉCRITURE A ÉCHOUÉ. Montrer le client comme sélectionné
// alors que sa fiche n'est pas en base, c'est le mensonge qui fait perdre des
// dossiers : la vendeuse continue, et il n'y a rien derrière.
assert.ok(/\.catch\(function\(err\)\{[\s\S]{0,400}?fail\('newClientName','Client NON enregistré/.test(DEVIS),
  'un échec d’écriture le DIT, et ne sélectionne pas le client');
assert.ok(/typeof window\.oldaEnregistrerClient!=='function'\)\{poser\(client,''\);return;\}/.test(DEVIS),
  'la pose sans écriture ne sert qu’à l’écran ouvert SANS son pont');
assert.strictEqual((DEVIS.match(/poser\(client,''\)/g) || []).length, 1,
  '… et c’est le SEUL endroit qui pose un client sans passer par la base');

// Deux pressions sur « Créer et sélectionner », c'est deux fiches.
assert.ok(/bouton\.disabled=true;bouton\.textContent='Enregistrement…'/.test(DEVIS),
  'le bouton se verrouille pendant l’écriture');

// ===========================================================================
// 3. Le client se choisit dans une liste déroulante, comme un besoin
// ===========================================================================
assert.ok(/<select id="clientSelect"/.test(DEVIS), 'le client est un <select>');
assert.ok(/<select id="clientSelect"[\s\S]{0,240}?data-menu-recherche/.test(DEVIS),
  '… avec la recherche DANS le panneau : 79 fiches ne se parcourent pas des yeux');
assert.ok(/<select id="clientSelect"[\s\S]{0,240}?data-menu-manuel-non/.test(DEVIS),
  '… et sans saisie libre : un client vient de la base, ou du bouton d’à côté');

// L'ancienne mécanique — un champ de recherche maison doublé d'une pile de
// cartes cliquables — n'existait QUE sur cette étape.
['clientSearch', 'clientQuickList', 'filterClientList', 'renderClientQuickList',
  'client-quick-list', 'client-item'].forEach((mort) => {
  assert.ok(!DEVIS.includes(mort), `l’ancienne liste de clients laisse « ${mort} » derrière elle`);
});

// La liste arrive DÉPLIÉE — les cartes qu'elle remplace étaient déjà à l'écran.
assert.ok(/window\.oldaOuvrirMenu\('clientSelect'\)/.test(DEVIS),
  'l’étape 5 ouvre la liste toute seule');
assert.ok(/if\(n===5&&!selectedClient\)setTimeout/.test(DEVIS),
  '… seulement tant qu’aucun client n’est choisi, et APRÈS le défilement : '
  + 'le moindre défilement referme les menus');
assert.ok(/window\.oldaOuvrirMenu = \(hote\) => \{/.test(PONT),
  'l’ouverture sans clic est servie par pont.js');

// Un <select> habillé est caché DERRIÈRE sa peau : le rougir lui ne montre rien.
assert.ok(/function peauDe\(id\)\{[\s\S]*?closest\('\.menu'\)/.test(DEVIS),
  'le rouge de validation va sur la peau du menu, pas sur le <select> invisible');

// Une valeur posée par programme ne déclenche aucun évènement : le champ fermé
// afficherait encore l'ancien choix.
assert.ok(/window\.menuRafraichir\(sel\)/.test(bloc(DEVIS, 'function renderClientOptions()')),
  'la liste repeinte à la main après réécriture des options');

// ===========================================================================
// 4. « Suite souhaitée pour ce client » : déduite, plus demandée
// ===========================================================================
['clientNextActionBlock', 'clientNextActionError', 'selectClientNextAction',
  'showClientNextAction', 'resetClientNextAction', 'client-action-card',
  'client-action-grid'].forEach((mort) => {
  assert.ok(!DEVIS.includes(mort), `« ${mort} » devait partir avec le bloc`);
});
assert.ok(!/id="clientNextAction"/.test(DEVIS), 'le champ caché aussi');

assert.ok(/function clientNextActionValue\(\)\{[\s\S]*?value==='waiting'\?'waiting':'quote'/.test(DEVIS),
  'la suite se déduit de l’état des informations (étape 4)');

// LE PIÈGE : `val('clientNextAction')` rend '' quand le champ n'existe plus —
// donc « Suite à donner : — » sur le ticket et un dossier rangé au hasard,
// SANS la moindre erreur. Aucun lecteur ne doit rester sur l'ancien champ.
assert.ok(!/val\(['"]clientNextAction['"]\)/.test(DEVIS),
  'plus aucun lecteur ne va chercher le champ disparu');
assert.ok(!/\$\('clientNextAction'\)\.value/.test(DEVIS), '… sous aucune des deux écritures');

// Les six endroits qui la LISENT passent tous par la valeur déduite : le
// récapitulatif, le texte partagé, le PDF, le ticket, et le dossier envoyé au
// planning (deux fois : la colonne `status` et la ligne `suite`).
assert.ok((DEVIS.match(/clientNextActionValue\(\)/g) || []).length >= 7,
  'tous les lecteurs passent par la valeur déduite');

// Ce que le planning reçoit ne change PAS : « en attente » range la demande
// dans « Demande à qualifier », tout le reste dans « À chiffrer ».
assert.ok(/status:window\.clientNextActionValue\(\)==='waiting'\?'Demande à qualifier':'À chiffrer'/.test(DEVIS),
  'la destination du dossier reste la même qu’avant');

// ===========================================================================
// 5. Le vert se tait. Ce qui ne va pas, jamais.
// ===========================================================================
const RECAP = bloc(DEVIS, '  function refreshRecapBanner()');
assert.ok(/box\.style\.display='none';/.test(RECAP),
  '« Dossier complet » ne s’affiche plus : les boutons au-dessus le disent déjà');
assert.ok(/Dossier incomplet — à compléter avant envoi/.test(RECAP),
  '… mais ce qui MANQUE se dit toujours, et se liste');
assert.ok(/box\.style\.display='';/.test(RECAP),
  '… et le bandeau revient quand il a de nouveau quelque chose à dire');

const ETAT = bloc(PONT, '  function peindreEtat(nouveau)');
assert.ok(/el\.style\.display = etatEnvoi === 'ok' \? 'none' : '';/.test(ETAT),
  '« ✔ Ce dossier est au planning » se tait : le bouton d’à côté le dit en devenant inactif');

// `display` et non `hidden` : les deux bandeaux portent leur PROPRE règle
// `display` (.live-check et .olda-etat), qui défait l'attribut.
assert.ok(!/el\.hidden = etatEnvoi === 'ok'/.test(PONT),
  '`hidden` serait défait par la règle `display` de .olda-etat');

// CE QUI RESTE, ET QUI DOIT RESTER : l'envoi en cours, l'échec, et le bouton
// pour réessayer. C'est par ce trou-là que des dossiers sont partis sans que
// personne ne s'en aperçoive (13/08/2026).
assert.ok(/echec: '⚠ Ce dossier n’est PAS au planning\.'/.test(PONT), 'l’échec se dit encore');
assert.ok(/attente: 'Ce dossier n’est pas encore au planning\.'/.test(PONT), 'l’attente aussi');
assert.ok(/reessai\.textContent = 'Réessayer l’enregistrement'/.test(PONT),
  'et le bouton pour réessayer est toujours là');
assert.ok(/el\.lastChild\.hidden = etatEnvoi !== 'echec' && etatEnvoi !== 'attente'/.test(PONT),
  'il ne se montre que quand il y a quelque chose à rattraper');

console.log('✓ étape client : liste déroulante, fiche en base, et le vert qui se tait');
