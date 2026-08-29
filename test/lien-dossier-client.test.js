'use strict';

// UN DOSSIER MÈNE À SON CLIENT — et aucun hash ne mène dans le vide (29/08/2026)
// ===========================================================================
// Le nom du client, en tête de la fiche atelier, ouvre la Base clients sur CE
// client. C'est ce qui remplace l'historique du client que portait le tiroir
// retiré le 29/08 : un LIEN vers la fiche qui le tient déjà, pas une deuxième
// copie à tenir à jour.
//
// LE DÉFAUT QUI A DONNÉ CE FICHIER. Le geste existait déjà et ne marchait pas :
// `ouvrirClient` écrivait `location.hash = '#/clients'`, avec une barre qui
// n'existe dans aucune clé de `VIEWS`. `applyHash` n'y trouvait rien, retombait
// sur son défaut ('planning'), et le clic sur le nom du client refermait la
// fiche pour rouvrir la grille. Rien dans la console, rien dans les tests :
// l'onglet était simplement MORT. C'est le symptôme décrit par la mémoire
// « vue et hash doivent rester alignés », et il ne se voit qu'en cliquant.
//
// Ce fichier tient les deux bouts :
//   1. TOUT hash écrit par le code — et tout onglet du HTML — mène à une vue
//      connue. C'est le contrôle qui aurait attrapé la barre en trop ;
//   2. le lien se fait par le NOM, et n'ouvre une fiche que si elle est SEULE :
//      `requests` ne porte aucun `client_id`, deux homonymes existent.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const APP = lire('public/app.js');
const CLIENTS = lire('public/clients.js');
const HTML = lire('public/index.html');

// ---------------------------------------------------------------------------
// 1. AUCUN HASH NE MÈNE DANS LE VIDE
// ---------------------------------------------------------------------------
// Les vues connues se lisent dans la SOURCE, jamais recopiées ici : une liste
// tenue à la main dans un test dérive, et c'est alors le test qui ment.
const blocViews = APP.match(/const VIEWS = \{[\s\S]*?\n\};/);
assert.ok(blocViews, 'la table VIEWS doit se lire dans app.js');
const hashConnus = new Set([...blocViews[0].matchAll(/'(#[a-z-]+)'/g)].map((m) => m[1]));
// Une vue peut entrer dans la table par une CONSTANTE plutôt que par une chaîne
// (clé calculée) : c'est le cas de la Base clients depuis que son hash s'écrivait
// à deux endroits. On résout donc les `const HASH_… = '#…'` que VIEWS référence.
for (const m of APP.matchAll(/const (HASH_[A-Z_]+) = '(#[a-z-]+)';/g)) {
  if (new RegExp(`\\[${m[1]}\\]`).test(blocViews[0])) hashConnus.add(m[2]);
}
// Les onglets promus (Fiverr, À commander) entrent dans VIEWS par un `spread`
// sur PROMOTED : leurs hash se lisent là où ils sont écrits.
for (const m of APP.matchAll(/\{ hash: '(#[a-z-]+)', view:/g)) hashConnus.add(m[1]);
// `#planning` n'est PAS une clé de VIEWS : c'est le défaut de `applyHash`, et
// c'est délibéré — tout ce qui n'est pas une vue à part entière est le planning.
hashConnus.add('#planning');

assert.ok(hashConnus.has('#clients'), 'la Base clients doit être une vue connue');
assert.ok(hashConnus.size >= 8, `VIEWS paraît vide (${hashConnus.size} hash lus)`);

// Tout hash ÉCRIT par le code doit atterrir quelque part.
const ecrits = [...APP.matchAll(/location\.hash = '(#[^']*)'/g)].map((m) => m[1]);
assert.ok(ecrits.length >= 4, 'aucune écriture de hash trouvée — la sonde est cassée');
for (const h of ecrits) {
  assert.ok(hashConnus.has(h),
    `\`location.hash = '${h}'\` ne mène à aucune vue : l'onglet serait MORT`);
}

// Et tout onglet du HTML aussi : un `href="#..."` mal orthographié est le même
// défaut, du côté de la barre de navigation.
const onglets = [...HTML.matchAll(/href="(#[a-z-]+)"/g)].map((m) => m[1]);
assert.ok(onglets.length >= 8, 'les onglets de la nav doivent se lire dans le HTML');
for (const h of onglets) {
  assert.ok(hashConnus.has(h), `l'onglet \`${h}\` ne mène à aucune vue`);
}

// ---------------------------------------------------------------------------
// 2. LE HASH DE LA BASE CLIENTS NE SE RECOPIE PLUS À LA MAIN
// ---------------------------------------------------------------------------
// La barre en trop est passée parce que la chaîne était écrite deux fois, à
// 4 000 lignes d'écart. Une constante ne se tape qu'une fois.
assert.match(APP, /const HASH_CLIENTS = '#clients';/,
  'le hash de la Base clients est une constante');
assert.match(APP, /location\.hash = HASH_CLIENTS;/,
  '`ouvrirClient` passe par la constante, pas par une chaîne');
assert.ok(!/'#\/clients'/.test(APP), 'plus une seule trace du hash avec la barre');

// ---------------------------------------------------------------------------
// 3. LE LIEN SE FAIT PAR LE NOM, ET LA CIBLE TRAVERSE LE MONTAGE PARESSEUX
// ---------------------------------------------------------------------------
// La vue Base clients est un module chargé au premier passage : au moment du
// clic il n'existe pas encore. La cible doit donc attendre `initClients`, sinon
// elle est perdue exactement la première fois — celle qu'on essaie.
assert.match(APP, /\.then\(\(\) => viserDansClients\(vise\)\)/,
  'la cible attend le chargement du module au premier passage');
assert.match(APP, /const vise = clientVise;\s*\n\s*clientVise = null;/,
  'la cible se consomme UNE fois : sinon le prochain passage rouvre la même fiche');
assert.match(APP, /clientVise = cible\.billing_company \|\| cible\.contact_referent \|\| '';/,
  'le nom cherché est celui que la ligne affiche, société ou particulier');

// ---------------------------------------------------------------------------
// 4. UNE SEULE FICHE S'OUVRE — JAMAIS « LA PREMIÈRE DE LA LISTE »
// ---------------------------------------------------------------------------
// `requests` n'a pas de `client_id` : le rapprochement est une RECHERCHE, pas
// une résolution. Ouvrir le premier résultat ouvrirait la fiche d'un homonyme
// sans rien dire — et la vendeuse écrirait dedans.
assert.match(CLIENTS, /export function viserClient\(nom\)/,
  'le module expose de quoi viser un client');
assert.match(CLIENTS, /if \(trouves\.length === 1\) openClient\(trouves\[0\]\.id\);/,
  'une seule fiche trouvée s’ouvre ; plusieurs laissent la recherche à l’écran');
// Le filtre de nature cache un particulier quand il est resté sur « Pro » : la
// recherche paraîtrait vide alors que la fiche existe.
assert.match(CLIENTS, /natureFilter = 'all';/,
  'viser un client remet le filtre de nature sur « Tous »');

// ---------------------------------------------------------------------------
// 5. LE COMPORTEMENT DE LA RECHERCHE, POUR DE VRAI
// ---------------------------------------------------------------------------
// `filtered()` est la fonction qui décide si UNE fiche s'ouvre. On rejoue sa
// règle sur les cas qui comptent : accents, casse, homonymes.
const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const cherche = (liste, q) => {
  const parts = fold(q).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return liste;
  return liste.filter((c) => {
    const hay = fold([c.entreprise, c.nom].filter(Boolean).join(' '));
    return parts.every((p) => hay.includes(p));
  });
};
const BASE = [
  { id: '1', entreprise: 'Beach Bar Orient', nom: 'Nathalie R.' },
  { id: '2', entreprise: 'Saint-Barth Store', nom: '' },
  { id: '3', entreprise: 'Café du Port', nom: '' },
  { id: '4', entreprise: 'Café du Port', nom: 'Marigot' },
];
assert.strictEqual(cherche(BASE, 'Beach Bar Orient').length, 1,
  'un nom exact et unique ouvre sa fiche');
assert.strictEqual(cherche(BASE, 'Cafe du Port').length, 2,
  'deux homonymes : la recherche reste posée, rien ne s’ouvre');
assert.strictEqual(cherche(BASE, 'Café du Port')[0].id, '3',
  'l’accent ne fait pas rater la fiche — la recherche est repliée');
assert.strictEqual(cherche(BASE, 'Client Inconnu').length, 0,
  'un client absent de la base ne fait rien ouvrir du tout');

console.log('✓ lien dossier → client : aucun hash dans le vide, et une seule fiche s’ouvre');
