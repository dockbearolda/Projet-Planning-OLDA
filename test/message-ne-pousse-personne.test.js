'use strict';

const { ecran } = require('./ecran-comptoir');

// UN MESSAGE NE POUSSE PERSONNE (24/08/2026) — RÈGLE NUCLÉAIRE
//
// « Quand j'oublie de rentrer un produit ça décale l'input en haut. Ça ne doit
//   jamais arriver, ce genre de chose : tous les inputs sur cette app doivent
//   rester fixes. »
//
// Le cas, mesuré dans le navigateur avant correctif : « Ajouter à la demande »
// sans produit choisi posait « Choisis un produit dans la liste. » SOUS le
// champ, dans le flux. La cellule gagnait 48,5 px ; comme la rangée du
// catalogue colle ses cellules en bas (`align-items:end`), l'input Quantité
// descendait de 48,5 px, le bloc grandissait d'autant, et tout ce qui suivait
// glissait. Après correctif : 0 px, sur les six étapes de l'écran, hauteur de
// page inchangée.
//
// POURQUOI PAS UNE LIGNE RÉSERVÉE SOUS CHAQUE CHAMP — c'était la réponse
// évidente, elle ne tient pas : le message s'enroule. Celui du catalogue prend
// déjà deux lignes dans la colonne de gauche, celui de l'adresse e-mail en
// prend trois dans une colonne de tiers. Une hauteur figée est un PARI sur la
// longueur d'un texte, et une règle nucléaire n'en prend pas.
//
// Le message sort donc du flux. Il ne mesure rien, il ne pousse rien — quelle
// que soit sa longueur, quelle que soit la largeur de la colonne.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8');

const CHARTE = lire('public/charte.css');
const DEVIS = ecran('demande-devis');
const VENTE = ecran('vente-directe');
const PONT = lire('public/comptoir/pont.js');

// --- 1. La règle vit dans la charte, une seule fois -------------------------
// Les deux parcours du comptoir sont des DOCUMENTS À PART : la charte est le
// seul fichier qu'eux et le CRM lisent tous les deux. Écrite ailleurs, elle
// serait à tenir en trois exemplaires — et c'est comme ça qu'une règle se perd.
assert.ok(/\.msg-flottant\s*\{[^}]*position:\s*absolute/.test(CHARTE),
  'le message flottant est défini dans charte.css et sort du flux');
assert.ok(/:has\(>\s*\.msg-flottant\)\s*\{[^}]*position:\s*relative/.test(CHARTE),
  '… et son parent DIRECT lui sert d’ancre, quel qu’il soit');

for (const [nom, src] of [['demande-devis.html', DEVIS], ['vente-directe.html', VENTE], ['pont.js', PONT]]) {
  assert.ok(!/\.msg-flottant\s*\{[^}]*position\s*:/.test(src),
    `${nom} ne redéfinit pas la règle : elle n’a qu’une seule source, charte.css`);
}

// --- 2. Ce qu'il recouvre reste utilisable ---------------------------------
// C'est le prix du hors-flux, et il est payé : le champ qui passe dessous
// reste cliquable, et le message s'efface dès que le champ fautif est rempli.
assert.ok(/\.msg-flottant\s*\{[^}]*pointer-events:\s*none/.test(CHARTE),
  'le message ne vole pas le clic du champ qu’il recouvre');

// Vide, il ne laisse pas une pastille posée sur le champ du dessous : les
// contrôles de numéro et d'adresse effacent en remettant le texte à ''.
assert.ok(/\.msg-flottant:empty\s*\{\s*display:\s*none/.test(CHARTE),
  'un message vide ne laisse aucune pastille derrière lui');

// `hidden` doit rester plus fort que l'affichage : les deux messages écrits en
// dur (priorité, suite à donner) vivent masqués dans la page.
assert.ok(/\.msg-flottant\.hidden\s*\{\s*display:\s*none/.test(CHARTE),
  'un message masqué ne recouvre rien');

// --- 3. Le fond est COMPOSÉ, pas translucide -------------------------------
// En thème sombre --danger-bg vaut rgba(185,28,28,.2) : posé seul sur un
// élément hors flux, le texte de la page se lirait AU TRAVERS du message.
// Il est donc empilé sur --surface, qui est opaque dans les deux thèmes.
const rougeur = CHARTE.match(/\.error\.msg-flottant,\s*\.field-error\.msg-flottant\s*\{[^}]*\}/);
assert.ok(rougeur, 'le rouge du message est défini une fois, pour les deux classes');
assert.ok(/linear-gradient\(var\(--danger-bg\),\s*var\(--danger-bg\)\),\s*var\(--surface\)/.test(rougeur[0]),
  'le fond rouge est composé sur --surface : sinon illisible en thème sombre');

// --- 4. AUCUN message ne se pose sans la classe ----------------------------
// C'est le vrai garde-fou : la règle CSS ne sert à rien si un nouveau message
// est créé sans elle. On vérifie chaque endroit qui en fabrique un.

// Le message d'erreur de validation (marquer()) — le cas signalé.
assert.ok(/d\.className\s*=\s*'error msg-flottant'/.test(DEVIS),
  'marquer() pose un message qui flotte');

// Les messages écrits en dur dans la page. Il n'en reste aucun sur l'écran de
// la demande : `clientNextActionError` est parti avec le bloc « Suite
// souhaitée », et `projectPriorityError` le 27/08 avec la question de la
// priorité — seize réponses identiques sur vingt-deux. Ce qui reste se
// fabrique à la volée, et c'est vérifié juste au-dessus et juste en dessous.
for (const div of DEVIS.match(/<div class="[^"]*" id="\w*(Error|Msg)">/g) || []) {
  assert.ok(/\bmsg-flottant\b/.test(div), `un message écrit en dur ne flotte pas : ${div}`);
}

// L'avis « ce client était déjà dans la base » se pose sous le champ Client,
// à la volée : lui aussi doit flotter, sinon il pousse tout le formulaire.
assert.ok(/avis\.className\s*=\s*'help msg-flottant'/.test(DEVIS),
  'l’avis client se pose avec msg-flottant');

// Les contrôles d'adresse et de numéro : la ligne naît VIDE et se remplit à la
// frappe — de 0 à 22 px au premier caractère si elle reste dans le flux.
const creations = [
  ['demande-devis.html (e-mail)', DEVIS],
  ['vente-directe.html (e-mail + numéro)', VENTE],
];
for (const [nom, src] of creations) {
  const poses = src.match(/help\.className\s*=\s*'[^']*'/g) || [];
  assert.ok(poses.length > 0, `${nom} : au moins une ligne d’aide dynamique`);
  for (const p of poses) {
    assert.ok(/msg-flottant/.test(p), `${nom} : une aide dynamique posée sans flotter — ${p}`);
  }
}

// pont.js reprend parfois la ligne d'aide de l'écran au lieu d'en poser une :
// la classe doit être ajoutée dans LES DEUX cas, sinon le numéro international
// pousse le champ suivant sur le seul chemin de la réutilisation.
assert.ok(/aide\.classList\.add\('msg-flottant'\)/.test(PONT),
  'pont.js fait flotter la ligne d’aide qu’il pose ET celle qu’il reprend');

// --- 5. Plus une seule marge dans le flux ----------------------------------
// Une marge posée en style EN LIGNE bat la charte : c'est exactement comme ça
// que les lignes d'aide gardaient leurs 5 px de poussée.
for (const [nom, src] of [['demande-devis.html', DEVIS], ['vente-directe.html', VENTE]]) {
  assert.ok(!/help\.style\.marginTop/.test(src),
    `${nom} : aucune marge en ligne sur une aide — elle battrait la charte`);
}
assert.ok(!/\.error\{[^}]*margin-top/.test(DEVIS),
  '.error ne porte plus de marge : sa position vient de la charte');
assert.ok(!/\.field-error\{[^}]*margin-top/.test(DEVIS),
  '.field-error non plus');

// --- 6. Le message peut être plus large que son ancre ----------------------
// « Renseigne au moins une taille. » s'accroche à la cellule « S », large de
// 60 px : borné à la largeur de l'ancre, il y tomberait en colonne d'un mot.
const regle = CHARTE.match(/\.msg-flottant\s*\{[^}]*\}/)[0];
assert.ok(/min-width:\s*100%/.test(regle) && /width:\s*max-content/.test(regle),
  'le message fait au moins la largeur du champ, sinon celle de son texte');
assert.ok(/max-width:\s*min\(/.test(regle),
  '… et reste plafonné : un message pleine page ne se lit pas non plus');

console.log('✓ un message ne pousse personne : hors flux, ancré, opaque, et personne ne peut en poser un sans');
