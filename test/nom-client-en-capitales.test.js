'use strict';

// ===========================================================================
// UN NOM DE CLIENT SE LIT EN CAPITALES — PARTOUT, ET DEPUIS UN SEUL ENDROIT
// ===========================================================================
// Demande de Charlie, 31/08/2026 : « tous les noms de famille doivent
// s'AFFICHER en majuscules, partout », puis, dans la foulée : « tous les noms
// d'ailleurs, même les restaurants etc ». Un particulier COMME un restaurant,
// une boutique, une association. Six surfaces la portent — le CRM, la fiche
// client, la liste des clients, les deux écrans du comptoir, la fiche de
// production, et les deux papiers.
//
// UNE SEULE EXCEPTION : le prénom d'un particulier reste en initiales.
// « JEAN DUPONT » ne dirait plus lequel des deux mots est le nom de famille.
//
// Deux choses se cassent toutes seules ici, et ce test existe pour ça :
//
//   1. LA RÈGLE SE RECOPIE. Écrite une deuxième fois dans un écran, elle
//      diverge le jour où l'une des deux bouge — et l'écart ne se voit pas en
//      relisant un écran, seulement en comparant deux écrans.
//   2. LA RÈGLE DESCEND DANS LA VALEUR. C'est L'AFFICHAGE qui change, JAMAIS
//      la base : un nom saisi « Dupont » reste « Dupont ». Transformer à
//      l'écriture rendrait la correction d'une faute impossible (le champ
//      qu'on rouvre n'est plus celui qu'on a tapé) et casserait le
//      rapprochement des fiches, qui compare des chaînes.
//
// On lit donc les VRAIS sources, et on fait sortir les VRAIS papiers.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { chargerPapier } = require('./socle-papier');

const RACINE = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8');

const APP = lire('public/app.js');
const CLIENTS = lire('public/clients.js');
const PONT = lire('public/comptoir/pont.js');
const VENTE = lire('public/comptoir/vente-directe.html');
const DEVIS = lire('public/comptoir/demande-devis.html');

// ---------------------------------------------------------------------------
// 1. UN SEUL ENDROIT
// ---------------------------------------------------------------------------
// La règle est une fonction, pas un `toLocaleUpperCase` recopié : elle ne se
// définit que dans `public/nom-client.js`.
const PORTEURS = [
  'public/app.js', 'public/clients.js', 'public/dashboard.js', 'public/montravail.js',
  'public/pilotage.js', 'public/reglages.js', 'public/fiche-atelier.js',
  'public/ticket.js', 'public/bureau.js',
];
for (const f of [...PORTEURS, 'public/comptoir/pont.js']) {
  assert.ok(!/function nomClientAffiche/.test(lire(f)),
    `${f} redéfinit la règle : elle vit dans public/nom-client.js, une seule fois`);
}
assert.ok(/export function nomClientAffiche/.test(lire('public/nom-client.js')),
  'public/nom-client.js porte la règle');

// … et chaque écran qui peint un nom de client la lit là-bas.
for (const f of PORTEURS) {
  assert.match(lire(f), /import \{[^}]*\bnomClientAffiche\b[^}]*\} from '\.\/nom-client\.js';/,
    `${f} doit prendre la règle dans nom-client.js`);
}
// `pont.js` est un script CLASSIQUE : il la charge à la demande, et attend
// cette promesse avant de peindre la première liste de clients.
assert.match(PONT, /import\('\.\.\/nom-client\.js'\)/,
  'pont.js charge la règle pour les deux écrans du comptoir');
assert.match(PONT, /async function chargerClients\(\) \{[\s\S]{0,400}?await reglePrete;/,
  'la liste des clients attend la règle : sinon elle s’affiche, puis SAUTE en capitales');

// ---------------------------------------------------------------------------
// 2. LES DEUX PAPIERS LA SORTENT
// ---------------------------------------------------------------------------
// Pas une lecture de source : on fait sortir les deux papiers pour de vrai.
const { modeleTicket } = chargerPapier('ticket.js', ['modeleTicket']);
const { modeleBureau } = chargerPapier('bureau.js', ['modeleBureau']);

const FICHE = {
  kind: 'comptoir-v17', source: 'Vente directe', ref: '31.08.26-004',
  creeLe: '2026-08-31T14:00:00.000Z', details: [],
};
const perso = (nom) => ({
  billing_company: nom, client_type: 'perso', contact_phone: '0690 55 12 40',
  product: 'Tasse', quantity: 2, order_kind: 'commande', fiche: FICHE,
});
const pro = (nom) => ({ ...perso(nom), client_type: 'pro' });

assert.strictEqual(modeleTicket(perso('Jean Dupont')).client, 'Jean DUPONT',
  'ticket atelier : le nom de famille du particulier monte en capitales');
assert.strictEqual(modeleBureau(perso('Jean Dupont'), {}).client.nom, 'Jean DUPONT',
  'bon de commande : le nom de famille du particulier monte en capitales');

// LE PRÉNOM NE CHANGE PAS : c'est la famille qu'on cherche en balayant la pile,
// et « JEAN DUPONT » ne dirait plus lequel des deux mots elle est.
assert.ok(!/JEAN/.test(modeleTicket(perso('Jean Dupont')).client),
  'le prénom reste tel qu’il a été saisi');

// UN RESTAURANT MONTE EN ENTIER. C'est `client_type` qui tranche, jamais la
// graphie : « Sarl Le Marin » se découpe comme « Prénom Nom », et pris pour un
// particulier il sortirait « Sarl LE MARIN ».
assert.strictEqual(modeleTicket(pro('Beach Bar Orient')).client, 'BEACH BAR ORIENT',
  'ticket atelier : un restaurant monte en entier');
assert.strictEqual(modeleBureau(pro('Sarl Le Marin'), {}).client.nom, 'SARL LE MARIN',
  'bon de commande : un professionnel monte en entier');

// « Personne à contacter » N'Y PASSE PAS : champ libre, il ne porte le plus
// souvent qu'un prénom (« Mélina »), et la règle y lirait un nom de famille.
const avecContact = { ...perso('Jean Dupont'), contact_referent: 'Mélina' };
assert.strictEqual(modeleTicket(avecContact).contact, 'Mélina',
  'un prénom seul dans « Personne à contacter » ne devient pas MÉLINA');
assert.strictEqual(modeleBureau(avecContact, {}).client.contact, 'Mélina',
  'idem sur le bon de commande');

// ---------------------------------------------------------------------------
// 3. LE CRM ET LA BASE CLIENTS
// ---------------------------------------------------------------------------
// La colonne « Client » du planning : UNE SEULE GRAISSE. C'est la casse qui
// fait ressortir le nom quand on balaie la colonne, pas un gras — Charlie,
// 31/08 : « j'ai pas demandé en gras mais en majuscule ».
const cellule = APP.slice(APP.indexOf('function cellDossier'));
assert.match(cellule.slice(0, 1600), /company\.textContent = nomClientAffiche\(texte, r\.client_type\);/,
  'la colonne Client peint le nom par la règle, en un seul bloc');
assert.ok(!/paintClientName/.test(APP),
  'plus de peinture en deux graisses : la casse suffit');
assert.ok(!/\.client-company b\b/.test(lire('public/styles.css')),
  'et plus de règle de gras qui l’attendrait dans la feuille');

// La liste des clients et la fiche : le nom du dossier suit la NATURE.
assert.match(CLIENTS, /cl-card__name', nomClientAffiche\(c\.entreprise, nat\)/,
  'la carte de la liste clients affiche le nom par la règle');
assert.match(CLIENTS, /nomClientAffiche\(c\.entreprise, nature\(c\.client_type\)\)/,
  'l’en-tête de la fiche client affiche le nom par la règle');

// … mais les CHAMPS de la fiche rendent la base telle quelle : ce sont eux qui
// servent à corriger une faute, et un champ qui ne rend pas ce qu'on a tapé
// n'est plus corrigeable.
assert.ok(!/fieldRow\([^)]*nomClientAffiche/.test(CLIENTS),
  'les champs éditables de la fiche client rendent la valeur, pas l’affichage');

// ---------------------------------------------------------------------------
// 4. LE COMPTOIR : L'AFFICHAGE CHANGE, LA VALEUR NE BOUGE PAS
// ---------------------------------------------------------------------------
// `pont.js` pose le nom affiché À CÔTÉ de la valeur, il ne la remplace pas.
assert.match(PONT, /\n      name: c\.entreprise \|\| '',/,
  'pont.js garde `name` = la valeur en base, mot pour mot');
assert.match(PONT, /nomAffiche: NOM_AFFICHE \? NOM_AFFICHE\(c\.entreprise \|\| '', c\.client_type\)/,
  'pont.js pose le nom AFFICHÉ dans son propre champ');

// Le chemin INVERSE — ce qui repart en base — ne connaît pas `nomAffiche`.
const versBase = PONT.slice(PONT.indexOf('function versBase('), PONT.indexOf('// LA FICHE ENTRE EN BASE'));
assert.ok(!/nomAffiche/.test(versBase),
  'versBase n’écrit JAMAIS le nom affiché : la base garde ce qui a été saisi');

for (const [nom, src] of [['vente-directe', VENTE], ['demande-devis', DEVIS]]) {
  // Ce que les écrans AFFICHENT passe par le champ posé par le pont.
  assert.match(src, /function clientNomAffiche\(/,
    `${nom} : un seul point de lecture du nom affiché`);
  assert.match(src, /client\.nomAffiche|c\.nomAffiche/,
    `${nom} : ce point lit le champ posé par pont.js, il ne recopie pas la règle`);

  // Ce que les écrans ENVOIENT garde la valeur. Le nom du dossier au planning
  // (`billing_company`) et la fiche client repartent tels qu'ils ont été tapés.
  assert.match(src, /selected(Client)?\s*\?\s*\(?selected(Client)?\.company\|\|selected(Client)?\.name/,
    `${nom} : le dossier part au planning avec le nom SAISI`);
  assert.ok(!/clientNomAffiche\(selectedClient\)\s*,?\s*\n?\s*client_info/.test(src),
    `${nom} : client_info part au planning avec le nom saisi`);
}
// `clientInfoLines` et `recapLines` sont des DONNÉES : elles partent au
// planning (`client_info`, `details`) et finissent en base. Le nom de famille
// se met en capitales AU RENDU du ticket, pas dans ces listes.
assert.match(VENTE, /\['Nom \/ société', ?c\.company\|\|c\.name\|\|'—'\]/,
  'clientInfoLines garde la valeur : elle part au planning');
// Sur la vente directe, le nom du ticket vient du champ caché `#clientName`,
// que `clientDisplayName` remplit : la tête du ticket et le texte copié le
// lisent, et la ligne « Nom / société » du bloc client, elle, est de toute
// façon élaguée par pont.js (elle redisait la tête).
assert.match(VENTE, /getElementById\("clientName"\)\.value=clientDisplayName\(client\)/,
  'le nom porté par le ticket de la vente directe passe par la règle');
assert.match(DEVIS, /\['Client',d\(c\.name\)\]/,
  'recapLines garde la valeur : elle part au planning');

// Le formulaire de correction reprend LA VALEUR. Repris depuis l'affichage, il
// réécrirait « Jean DUPONT » en base au premier enregistrement — exactement la
// transformation à l'écriture que la règle interdit.
assert.match(DEVIS, /set\('newClientName',selectedClient\.name\)/,
  'le formulaire d’édition reprend le nom SAISI, pas le nom affiché');
assert.match(VENTE, /document\.getElementById\("newIndividualName"\)\.value=selectedClient\.name\|\|""/,
  'idem sur la vente directe');

console.log('✓ nom de client : EN CAPITALES sur les six surfaces, et la valeur en base intacte');
