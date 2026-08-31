'use strict';

// Audit du 17/08/2026 — ce que l'audit complet a trouvé, et où le correctif vit.
//
//   1. LE TICKET NE S'IMPRIME PLUS AMPUTÉ. La liste ne transporte qu'un résumé
//      de la fiche : sans le détail, le modèle retombait sur la description de
//      la ligne et sortait un ticket à UN article, sans date, sans prix ligne à
//      ligne. L'appel qui va chercher ce détail avalait son échec — donc sur un
//      wifi qui décroche, la vendeuse remettait au client un papier FAUX, et
//      rien à l'écran ne le disait.
//   2. LES CORRECTIONS DU TICKET S'ÉCRIVENT DANS L'ORDRE OÙ ON LES TAPE. Chaque
//      réponse rapporte la ligne entière : deux écritures en vol ensemble, et
//      c'est la dernière ARRIVÉE qui gagnait, pas la dernière écrite.
//   3. « RIEN À SIGNALER » NE LAISSE PLUS DE BOUTON DERRIÈRE LUI. `display`
//      écrasait l'attribut `hidden` : chaque ligne sans alerte portait un bouton
//      vide, sans nom, focusable — 32 px de zone morte au doigt.
//   4. LA GRILLE DIT CE QU'ELLE DEMANDE. Nom du dossier, projet et prix
//      n'avaient aucun nom accessible — et l'indication de saisie du prix était
//      un tiret.
//   5. LE CLAVIER A DROIT AU MÊME HALO QUE LE DOIGT. Les puces confirmaient
//      l'enregistrement, les champs texte non.
//   6. UNE VALEUR INCHANGÉE N'ÉCRIT PLUS. La comparaison portait sur le texte
//      tapé, pas sur la valeur : traverser la colonne des prix à la tabulation
//      partait en un PATCH par ligne, relu par tous les postes connectés.
//   7. LE MONTANT S'ÉCRIT EN FRANÇAIS dans la grille comme partout ailleurs.
//   8. LE FIL D'ACTIVITÉ NE GARDE PLUS CE QUI N'A PAS EU LIEU.
//   9. LES RÉGLAGES SE TOUCHENT ET SE NOMMENT (44 px, noms accessibles).
//  10. UN PORT DÉJÀ PRIS SE DIT EN UNE PHRASE, pas en vingt lignes de pile.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const racine = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8');

const APP = lire('public/app.js');
const CSS = require('./feuilles-crm').cssCrm();   // styles.css + les cinq feuilles d'ecran
const DASH = lire('public/dashboard.js');
const REG = lire('public/reglages.js');
const SERVER = lire('server.js');

// Découpe une fonction : de sa signature jusqu'à l'accolade fermante posée à la
// MÊME indentation.
function bloc(src, signature) {
  const from = src.indexOf(signature);
  assert.ok(from >= 0, `bloc introuvable : ${signature}`);
  const indent = signature.match(/^\s*/)[0];
  const to = src.indexOf(`\n${indent}}`, from);
  assert.ok(to > from, `fin de bloc introuvable : ${signature}`);
  return src.slice(from, to + indent.length + 2);
}

// ===========================================================================
// 1. Le ticket : jamais amputé, jamais muet
// ===========================================================================
{
  const b = bloc(APP, 'async function ticketDeLaLigne(r)');
  assert.ok(!/\.catch\(\(\) => \{\}\)/.test(b),
    'le chargement du détail ne doit plus avaler son échec : un ticket sans ses '
    + 'articles part chez le client et rien ne le dit');
  assert.ok(/throw new Error\(TICKET_SANS_DETAIL\)/.test(b),
    'sans le détail, on refuse d’imprimer');
  assert.ok(/r\.fiche\.fichePartielle/.test(b),
    'un résumé de fiche (fichePartielle) ne fait pas un ticket');
  // Le message dit QUOI REFAIRE : « Connexion perdue — on réessaie tout seul »
  // serait faux, rien ne rouvrira le ticket.
  assert.ok(/const TICKET_SANS_DETAIL = '[^']*rouvre le ticket/.test(APP),
    'le message doit dire quoi refaire, pas promettre une reprise qui n’aura pas lieu');

  const o = bloc(APP, 'async function ouvrirTicket(r)');
  assert.ok(/ticketOuvert = false;[\s\S]{0,400}?reportError\(err\);[\s\S]{0,80}?return;/.test(o),
    'un ticket qui ne peut pas s’ouvrir relâche son verrou ET le dit');
  assert.ok(!/throw err;/.test(o),
    'aucun appelant n’attend cette promesse : la rejeter ne produit RIEN à l’écran');

  // LE RÉCAPITULATIF EN .TXT N'EXISTE PLUS (30/08) : sa seule porte était la
  // rangée « Documents » de la fiche atelier, retirée sur demande de Charlie
  // (« tout ça tu supprimes »). L'exigence, elle, ne bouge pas — elle passe sur
  // ce qui reste, le ticket : rien ne sort du poste sans son détail.
  // ⚠ On cherche la DÉFINITION, pas le nom : le commentaire qui raconte le
  // retrait cite les deux fonctions, et un test qui trébuche sur son propre
  // commentaire est un test qu'on désarme au lieu de le lire.
  assert.ok(!/function telechargerRecap\(/.test(APP) && !/function recapTexte\(/.test(APP),
    'le récapitulatif .txt est retiré, fonction comprise — plus rien ne l’appelait');
  assert.ok(!/function envoyerParEmail\(/.test(APP) && !/const EMAIL_MAX =/.test(APP),
    'le brouillon mailto aussi : son bouton est parti avec la rangée');
}

// ===========================================================================
// 2. Les corrections du ticket partent dans l'ordre de la frappe
// ===========================================================================
{
  const e = bloc(APP, 'function editeurTicket(r, champs)');
  assert.ok(/let file = Promise\.resolve\(\);/.test(e) && /const aLaSuite = \(travail\)/.test(e),
    'les écritures du ticket passent par une file');
  assert.ok(/return aLaSuite\(\(\) => envoyerTicket\(r, cible, v\)\)/.test(e),
    'chaque enregistrement s’enchaîne au précédent — sinon la dernière réponse '
    + 'ARRIVÉE écrase la dernière valeur ÉCRITE, et le papier sort périmé');
  assert.ok(/file = suite\.catch\(\(\) => \{\}\)/.test(e),
    'un échec ne doit pas bloquer la correction suivante');
}

// ===========================================================================
// 3. « Rien à signaler » : le motif n'occupe plus de place
// ===========================================================================
{
  assert.ok(/\.flag-reason\[hidden\] \{ display: none; \}/.test(CSS),
    '`display: -webkit-box` écrase l’attribut `hidden` posé par flagControl : '
    + 'sans cette règle, chaque ligne sans alerte porte un bouton vide, sans nom '
    + 'accessible, focusable — et haut de 32 px au doigt');
  // Le chevron des notes, lui, garde sa place EXPRÈS : deux intentions
  // opposées, il ne faut pas confondre les deux en « corrigeant » l'autre.
  assert.ok(/\.desc-toggle\[hidden\] \{ display: flex; visibility: hidden; \}/.test(CSS),
    'le chevron des notes réserve sa place volontairement — ne pas l’aligner sur flag-reason');
}

// ===========================================================================
// 4. La grille dit ce qu'elle demande
// ---------------------------------------------------------------------------
// DÉPASSÉ LE 30/08 : nom du dossier, article et prix n'ÉDITENT plus rien dans
// la grille — ils se lisent, un clic ouvre la fiche (voir
// test/prix-vide-ouvre-la-fiche.test.js). Un nom accessible réparait un champ
// muet ; ces trois cellules ne sont plus des champs du tout, la question ne
// se pose plus. Ce qui reste à garantir : aucune des trois ne recrée
// discrètement un `<input>`/`<textarea>`.
// ===========================================================================
{
  const dossier = bloc(APP, 'function cellDossier(r)');
  const description = bloc(APP, 'function cellDescription(r)');
  for (const [nom, b] of [['cellDossier', dossier], ['cellDescription', description]]) {
    assert.ok(!/createElement\('input'\)/.test(b) && !/createElement\('textarea'\)/.test(b),
      `${nom} ne doit plus créer aucun champ de saisie`);
  }
}

// ===========================================================================
// 5 + 6 + 7. bindInline : halo, pas d'écriture à vide, montant en français
// ---------------------------------------------------------------------------
// DÉPASSÉ LE 30/08 : `bindInline` n'a plus d'appelant et a été retiré avec la
// dernière cellule qu'il servait (voir ci-dessus). Le halo au clavier et la
// garde anti-PATCH-inutile ne se posent plus pour ces champs — il n'y a plus
// de clavier à brancher dessus. Le montant en français, lui, survit : c'est
// désormais un fait d'AFFICHAGE, testé dans test/prix-vide-ouvre-la-fiche.test.js.
// ===========================================================================
{
  assert.ok(!APP.includes('function bindInline('),
    'bindInline n’a plus d’appelant depuis que la ligne n’édite plus rien en place — code mort retiré');
}

// ===========================================================================
// 8. L'ÉCRAN NE GARDE RIEN QUI N'A PAS EU LIEU
// ---------------------------------------------------------------------------
// Les trois gestes du panneau détail sont OPTIMISTES : ils modifient la ligne à
// l'écran, puis écrivent au serveur. Si l'écriture échoue, tout doit revenir en
// arrière — sinon le poste affiche un état que la base ne connaît pas, et c'est
// exactement le genre de mensonge qui fait perdre un dossier.
//
// La garde portait aussi, jusqu'au 25/08, sur le retrait de la ligne du fil
// d'activité. Le fil a été retiré de l'écran ce jour-là ; ce qui compte — le
// retour en arrière des DONNÉES — n'a pas bougé d'un pouce.
// ===========================================================================
{
  for (const [geste, champs] of [
    ['function sendTo(r, stage, sub)', ['stage', 'sub_stage']],
    ['function clearFlag(r)', ['flag', 'flag_reason']],
    ['function markDone(r)', ['stage', 'sub_stage']],
  ]) {
    const b = bloc(DASH, `  ${geste}`);
    for (const champ of champs) {
      assert.ok(new RegExp(`${champ}: r\\.${champ}`).test(b),
        `${geste} : l’état d’avant doit être retenu (${champ}) — sans lui, pas de retour possible`);
    }
    assert.ok(/\.catch\(\(\) => \{[\s\S]*?Object\.assign\(r, prev\);/.test(b),
      `${geste} : un échec d’écriture doit REMETTRE la ligne comme elle était`);
    assert.ok(/\.catch\(\(\) => \{[\s\S]*?renderAll\(\);/.test(b),
      `${geste} : … et repeindre, sinon l’écran garde l’état optimiste`);
    assert.ok(/\.catch\(\(\) => \{[\s\S]*?showToast\(/.test(b),
      `${geste} : … et le DIRE. Un échec silencieux est pire qu’un échec`);
    assert.ok(/\.catch\(\(\) => \{[\s\S]*?refresh\(\);/.test(b),
      `${geste} : … et redemander la vérité au serveur`);
  }
}

// ===========================================================================
// 9. Les Réglages se touchent et se nomment
// ===========================================================================
{
  const b = bloc(REG, 'function tarifRow(a)');
  assert.ok(/achat\.setAttribute\('aria-label', `Prix d’achat — \$\{quoi\(\)\}`\)/.test(b),
    'deux montants voisins qui se ressemblent doivent dire lequel est lequel');
  assert.ok(/prix\.setAttribute\('aria-label', `Prix de vente TTC — \$\{quoi\(\)\}`\)/.test(b));
  assert.ok(/del\.setAttribute\('aria-label', `Supprimer \$\{quoi\(\)\}`\)/.test(b),
    'la corbeille n’avait AUCUN nom — et il y a une suppression au bout');
  assert.ok(/desig\.setAttribute\('aria-label', 'Désignation de l’article'\)/.test(b));
  assert.ok(/actif\.setAttribute\('aria-label',\s*\n\s*`\$\{quoi\(\)\} : /.test(b),
    'la bascule dit DE QUOI elle parle avant de dire son état');

  // LE PLANCHER TACTILE A ÉTÉ RETIRÉ LE 25/08 : projet PC uniquement depuis le
  // 21/08 (Galaxy Tab au rebut), et ces cibles de 44 px tenaient une deuxième
  // échelle de tailles à côté de celle de la charte. Ce qui compte désormais,
  // c'est que ces trois commandes prennent la boîte unique de l'application.
  for (const regle of ['.reg-tarif-input', '.reg-tarif-add', '.reg-jeton']) {
    const m = CSS.match(new RegExp(`\\${regle}\\s*\\{([^}]*)\\}`));
    assert.ok(m, `la règle ${regle} doit exister`);
    assert.ok(/min-height:\s*var\(--ctrl-h\)/.test(m[1]),
      `${regle} doit prendre la boîte unique (--ctrl-h), pas une hauteur à elle`);
  }
}

// ===========================================================================
// 10. Un port déjà pris se dit en une phrase
// ===========================================================================
{
  assert.ok(/app\.__server\.on\('error', \(err\) => \{/.test(SERVER),
    'sans écouteur, Node relance l’évènement en exception : vingt lignes de pile '
    + 'pour dire « tu l’as déjà lancé »');
  assert.ok(/err\.code === 'EADDRINUSE'/.test(SERVER));
  assert.ok(/PORT=3001 npm start/.test(SERVER), 'on dit quoi faire, pas seulement ce qui ne va pas');
}

console.log('✓ audit 17/08 : ticket entier ou rien, écritures ordonnées, grille nommée, gestes optimistes qui savent revenir en arrière');
