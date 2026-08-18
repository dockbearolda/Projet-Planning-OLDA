'use strict';

// LE TICKET QUE LA VENDEUSE IMPRIME POUR L'ATELIER.
// ===========================================================================
// Le papier qui sort au comptoir part à l'atelier avec le dossier. La vendeuse
// a demandé qu'il cesse d'imprimer ce que personne n'y lit :
//
//   1. « Commande : 26.08.17-004 » ne dit pas ce qu'est ce nombre → il devient
//      « Numéro de commande » — puis, depuis le 17/08, plus rien du tout : ce
//      papier va à l'établi, et un identifiant de dossier n'y fait rien
//      produire. (Ancien libellé côté devis : « Numéro de la demande »,
//      qui n'annonce aucune commande) ;
//   2. le nom du client s'imprimait DEUX FOIS — en tête (« Client : … ») puis
//      en ligne « Nom / société » juste dessous → on garde la tête ;
//   3. une adresse e-mail qu'on n'a pas s'imprimait quand même
//      (« E-mail   Non renseigné ») → la ligne disparaît ;
//   4. « Délai souhaité » redit à sa façon la « Récupération prévue » imprimée
//      en tête → il part ;
//   5. le pied « Merci pour votre confiance » n'a rien à faire sur un papier
//      d'atelier → il part.
//
// TOUT SE JOUE À L'AFFICHAGE. `clientInfoLines` alimente aussi le dossier
// envoyé au planning (`client_info`) et la carte du client à l'écran : couper à
// la source appauvrirait la fiche du CRM pour un choix de mise en page. Ce
// fichier vérifie les deux : ce qui quitte le papier, et ce qui reste en base.
//
// Et tout vit dans `pont.js`, pas dans les écrans : une nouvelle version d'un
// écran du patron se pose en REMPLAÇANT le fichier — elle réimprimerait tout.
// D'où les garde-fous de la section 3 : si un écran renommait un de ces
// repères, l'élagage mourrait sans bruit.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const PONT = lire('comptoir/pont.js');
const VENTE = lire('comptoir/vente-directe.html');
const DEVIS = lire('comptoir/demande-devis.html');

// ===========================================================================
// 1. LA RÈGLE, ÉPROUVÉE POUR DE VRAI
// ===========================================================================
// On n'exécute pas une copie de la règle : on découpe le VRAI source de
// `pont.js` (de la première ligne du papier jusqu'au bout de l'élagage) et on
// le fait tourner sur un document de comptoir en miniature. Pas de navigateur,
// mais la vraie fonction — une règle réécrite ici ne prouverait rien.
const DEBUT = PONT.indexOf('  const RIEN_A_DIRE');
const FIN = PONT.indexOf('  // On se greffe SUR le remplissage');
assert.ok(DEBUT > 0 && FIN > DEBUT, 'le bloc « papier » doit rester repérable dans pont.js');
const REGLE = PONT.slice(DEBUT, FIN);

// Une ligne du ticket, telle que les deux écrans la dessinent :
// `<div class="tl"><span>libellé</span><strong>valeur</strong></div>`.
const ligne = (k, v) => {
  const span = { textContent: k };
  const strong = { textContent: v };
  const n = {
    k, v, partie: false,
    querySelector: (sel) => (sel === 'span' ? span : (sel === 'strong' ? strong : null)),
  };
  n.remove = () => { n.partie = true; };
  return n;
};
const boite = (lignes) => ({ lignes, querySelectorAll: () => lignes.filter((l) => !l.partie) });

function comptoirEnMiniature() {
  const pied = { partie: false };
  pied.remove = () => { pied.partie = true; };
  const noeuds = {
    ticketOrder: (() => {
      const n = { textContent: 'Commande : 26.08.17-004', partie: false, style: {} };
      n.remove = () => { n.partie = true; };
      return n;
    })(),
    ticketClientDetails: boite([
      ligne('Type de client', 'Professionnel'),
      ligne('Nom / société', 'Restaurant Le Ti Coin Créole'),
      ligne('Personne à contacter', 'Jacqueline Hodge (Gérante)'),
      ligne('WhatsApp', '0690 55 12 08'),
      ligne('E-mail', 'contact@ticoincreole.example'),
      ligne('Secteur', 'Restauration'),
      ligne('Adresse', '12 rue de la République — 97150 Marigot'),
    ]),
    ticketExtraDetails: boite([
      ligne('Délai souhaité', 'Dans 15 jours'),
      ligne('Note interne OLDA', 'Cliente pressée'),
    ]),
  };
  const bac = {
    document: {
      getElementById: (id) => noeuds[id] || null,
      querySelector: (sel) => (sel === '.ticket-footer' && !pied.partie ? pied : null),
    },
    String, RegExp, Array,
  };
  vm.createContext(bac);
  vm.runInContext(`${REGLE}
    globalThis.allegerTicket = allegerTicket;
    globalThis.surLePapier = surLePapier;`, bac);
  return { bac, noeuds, pied };
}

{
  const { bac, noeuds, pied } = comptoirEnMiniature();
  bac.allegerTicket();

  // 1. Le numéro quitte le PAPIER — sans quitter la page.
  assert.strictEqual(noeuds.ticketOrder.style.display, 'none',
    'le numéro de commande ne s’imprime pas sur le papier qui part à l’atelier');
  // LE NŒUD RESTE. Les deux écrans réécrivent `#ticketOrder` à chaque
  // remplissage sans vérifier qu'il existe : le retirer tuait le deuxième
  // appel, donc « Imprimer » — qui refait un remplissage avant d'imprimer.
  assert.strictEqual(noeuds.ticketOrder.partie, false,
    'le nœud reste dans la page : les écrans le réécrivent à chaque remplissage');
  assert.ok(noeuds.ticketOrder.textContent.includes('26.08.17-004'),
    'et il garde sa valeur — c’est la référence qui part au planning');

  // 2 et 3. Le doublon du nom part, l'e-mail RENSEIGNÉ reste.
  const restant = noeuds.ticketClientDetails.querySelectorAll().map((l) => l.k);
  assert.deepStrictEqual(restant, [
    'Type de client', 'Personne à contacter', 'WhatsApp', 'E-mail', 'Secteur', 'Adresse',
  ], 'seule la ligne « Nom / société » quitte le bloc client');

  // 4. Le délai souhaité part, le reste du bloc ne bouge pas.
  assert.deepStrictEqual(
    noeuds.ticketExtraDetails.querySelectorAll().map((l) => l.k), ['Note interne OLDA'],
  );

  // 5. Le pied de page part.
  assert.strictEqual(pied.partie, true, 'le pied « Merci pour votre confiance » quitte le papier');
}

// L'E-MAIL ABSENT, dans les trois formes que les écrans savent écrire. Le
// parcours de la vente retombe sur « Non renseigné », `tl()` sur « — » quand la
// valeur est vide : les deux disent la même chose, aucune ne s'imprime.
{
  const { bac } = comptoirEnMiniature();
  for (const vide of ['', '—', 'Non renseigné']) {
    assert.strictEqual(bac.surLePapier('E-mail', vide), false, `« E-mail ${vide} » ne s’imprime pas`);
  }
  assert.strictEqual(bac.surLePapier('E-mail', 'contact@ticoincreole.example'), true);

  // CE QUI N'A PAS ÉTÉ DEMANDÉ RESTE. Le WhatsApp non renseigné s'imprime
  // encore, comme avant — c'est un choix, pas un oubli : la vendeuse n'a parlé
  // que de l'e-mail. Si elle demande la même chose pour les autres lignes, ce
  // garde-fou tombera en même temps que la règle change.
  assert.strictEqual(bac.surLePapier('WhatsApp', 'Non renseigné'), true);
  assert.strictEqual(bac.surLePapier('Type de client', 'Professionnel'), true);
  assert.strictEqual(bac.surLePapier('Note interne OLDA', 'Cliente pressée'), true);
}

// ===========================================================================
// 2. LA GREFFE — sur le remplissage des écrans, et sur les DEUX
// ===========================================================================
// L'écran de la vente annonce une commande, celui des devis une demande : le
// même mot sur les deux papiers ferait mentir l'un des deux.
assert.ok(/grefferSurLeTicket\('fillTicket'\)/.test(PONT),
  'le papier de la vente passe par l’élagage');
assert.ok(/grefferSurLeTicket\('fillFinal'\)/.test(PONT),
  'le papier du devis passe par le même élagage');

// La greffe enveloppe, elle ne réécrit pas : l'écran garde la main sur ce
// qu'il imprime, on ne fait qu'en retirer des lignes.
const GREFFE = PONT.match(/function grefferSurLeTicket\([\s\S]*?\n  \}/)[0];
assert.ok(/original\.apply\(this, args\)/.test(GREFFE),
  'le remplissage de l’écran doit tourner d’abord, entier');
assert.ok(/try \{ allegerTicket/.test(GREFFE),
  'un élagage qui casse ne doit jamais emporter l’impression avec lui');
assert.ok(/__oldaPapier/.test(GREFFE),
  'la greffe doit se reconnaître : les écrans regreffent leurs propres fonctions');

// ON RETIRE DE L'AFFICHAGE, JAMAIS DE LA SOURCE. Le dossier qui part au
// planning porte encore tout : `pont.js` ne touche pas à `clientInfoLines`.
assert.ok(!/window\.clientInfoLines\s*=/.test(PONT),
  'le pont ne doit pas réécrire clientInfoLines : la fiche du CRM en dépend');
for (const [nom, src] of [['vente-directe', VENTE], ['demande-devis', DEVIS]]) {
  assert.ok(/client_info:\s*window\.clientInfoLines\(selectedClient\)/.test(src),
    `${nom} : le dossier envoyé au planning garde toutes les lignes du client`);
}
assert.ok(/\['Nom \/ société', ?c\.company\|\|c\.name\|\|'—'\]/.test(VENTE),
  'le nom de société reste dans les données de la vente, il ne quitte que le papier');

// ===========================================================================
// 3. LE CONTRAT AVEC LES DEUX ÉCRANS
// ===========================================================================
// Ces écrans sont ceux du patron : une nouvelle version se pose en remplaçant
// le fichier. L'élagage s'accroche à des repères précis — s'ils changent de
// nom, il ne retire plus rien et personne ne le voit. On les fige ici.
for (const [nom, src] of [['vente-directe', VENTE], ['demande-devis', DEVIS]]) {
  assert.ok(/<div class="tl"><span>'\+esc2\(/.test(src),
    `${nom} : une ligne du ticket reste un .tl avec son <span> et son <strong>`);
  assert.ok(/id="ticketOrder"/.test(src) && /id="ticketClientDetails"/.test(src)
    && /id="ticketExtraDetails"/.test(src),
    `${nom} : les trois blocs du ticket gardent leur identifiant`);
  assert.ok(/<div class="ticket-footer">/.test(src),
    `${nom} : le pied de page reste reconnaissable à sa classe`);
  assert.ok(/\['E-mail', ?c\.email\|\|'Non renseigné'\]/.test(src),
    `${nom} : l’e-mail absent s’écrit toujours « Non renseigné »`);
}

// Le préfixe que l'élagage réécrit. Les deux écrans l'écrivent à la main.
assert.ok(/ticketOrder"\)\.textContent=\s*"Commande : "\+/.test(VENTE),
  'la vente écrit « Commande : » devant son numéro');
// POURQUOI L'ÉLAGAGE NE PEUT PAS RETIRER CE NŒUD. Les deux écrans l'écrivent
// SANS VÉRIFIER qu'il existe, à chaque remplissage. Le retirer une fois tuait
// tous les remplissages suivants — dont celui que fait « Imprimer » juste avant
// `window.print()`. Si un jour ces écrans se gardent d'un nœud absent, cette
// contrainte tombe ; tant qu'ils ne le font pas, on la garde sous les yeux.
for (const [nom, src] of [['vente-directe', VENTE], ['demande-devis', DEVIS]]) {
  assert.ok(/getElementById\(['"]ticketOrder['"]\)\.textContent\s*=/.test(src),
    `${nom} : le remplissage écrit ticketOrder sans garde — l’élagage doit le MASQUER, pas le retirer`);
}
assert.ok(!/ticketOrder'\);?\s*\n?\s*if \(num\) num\.remove\(\)/.test(PONT),
  'l’élagage ne retire pas le nœud du numéro : il le masque');
assert.ok(/ticketOrder'\)\.textContent='Commande : '\+reference/.test(DEVIS),
  'le devis écrit « Commande : » devant sa référence');

// Les deux remplissages doivent rester JOIGNABLES depuis window — c'est par là
// que la greffe passe. Et leurs appelants doivent les appeler sans les
// qualifier, sinon ils sauteraient la greffe.
assert.ok(/window\.fillTicket\s*=\s*function/.test(VENTE),
  'la vente doit exposer fillTicket sur window');
assert.ok(/window\.fillFinal\s*=\s*function/.test(DEVIS),
  'le devis doit exposer fillFinal sur window');
assert.ok(/function printTicket\(\)\{\s*fillTicket\(\);/.test(VENTE),
  'l’impression de la vente doit passer par le fillTicket global');
assert.ok(/if\(n===7\)fillFinal\(\)/.test(DEVIS),
  'l’écran final du devis doit passer par le fillFinal global');

// `pont.js` est chargé EN DERNIER : c'est ce qui lui permet d'envelopper les
// remplissages que les écrans se greffent eux-mêmes en cours de route.
for (const [nom, src] of [['vente-directe', VENTE], ['demande-devis', DEVIS]]) {
  const dernier = src.lastIndexOf('<script');
  assert.ok(src.slice(dernier).includes('pont.js'),
    `${nom} : pont.js doit rester le dernier script de la page`);
}

console.log('✓ ticket-comptoir-papier');
