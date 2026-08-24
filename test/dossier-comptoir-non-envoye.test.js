'use strict';

// LE DOSSIER QUI N'ARRIVE JAMAIS AU PLANNING.
// ===========================================================================
// Plainte de la vendeuse, le 14/08 : « des clients qui rentrent dans le
// planning disparaissent — une Jacqueline, introuvable avec la recherche ».
//
// Elle n'a jamais existé. La recherche fonctionne (elle trouve le nom, le
// référent, le numéro du ticket, sans casse ni accent) ; c'est le DOSSIER qui
// n'est jamais arrivé. En base de production : `app_meta.devis_seq_20260813 = 1`
// — un numéro de devis réservé le 13/08 — et AUCUNE ligne portant
// « DEV-26.08.13-001 ».
//
// La cause tient en trois faits, tous dans l'écran de fin des parcours :
//
//   1. il annonce « ✅ Demande enregistrée » / « ✅ Commande enregistrée »
//      ALORS QUE RIEN n'est parti : à cet instant le dossier n'existe que dans
//      l'onglet. Depuis le 17/08, l'écran de VENTE ne l'annonce plus — le
//      bandeau du pont y est seul à parler, et il ne parle qu'après le
//      serveur. L'écran de devis, lui, l'annonce toujours ;
//   2. la seule action qui l'enregistre — « 📅 Créer dans le planning » — est
//      greffée EN DERNIER, après « Nouvelle demande » / « Nouvelle vente », qui
//      rechargent la page et effacent tout ;
//   3. côté devis, « 💾 Enregistrer » écrivait un brouillon dans le navigateur
//      que RIEN ne relit jamais, en annonçant « Brouillon enregistré ».
//
// Une vendeuse qui imprime le ticket, le remet au client et enchaîne perdait
// donc le dossier, sans un mot. Ce fichier vérifie le filet posé dans
// `pont.js` : le dossier part TOUT SEUL dès que l'écran de fin s'affiche,
// l'écran dit où il en est, et rien ne l'efface en silence.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const PONT = lire('comptoir/pont.js');
const HOTE = lire('nouveau-projet.js');
const DEVIS = lire('comptoir/demande-devis.html');
const VENTE = lire('comptoir/vente-directe.html');

// ===========================================================================
// 1. LA PRÉMISSE : l'écran promet un enregistrement qu'il ne fait pas
// ===========================================================================
// Ces écrans sont ceux du patron et tournent tels quels : on ne les corrige
// pas, on constate ce qu'ils annoncent — c'est ce qui rend l'envoi automatique
// légitime plutôt qu'inventé.
assert.ok(/✅ Demande enregistrée/.test(DEVIS), 'l’écran devis annonce un enregistrement');
// L'écran de vente s'est tu depuis : plus de titre « ✅ Commande enregistrée »
// ni de phrase d'état. Ce qui rendait l'envoi automatique légitime tient
// toujours — le dossier n'existe que dans l'onglet tant que rien n'est parti —
// mais la promesse mensongère, elle, a disparu. On le fige : la réintroduire
// remettrait un « c'est enregistré » AVANT tout enregistrement.
assert.ok(!/✅ Commande enregistrée/.test(VENTE),
  'l’écran vente ne doit plus annoncer un enregistrement qu’il ne fait pas');
assert.ok(!/id="paymentStatus"/.test(VENTE),
  'ni le doubler d’une phrase d’état écrite avant l’envoi');

// LE CONTRAT AVEC LES DEUX ÉCRANS. Le filet ne retranscrit pas le parcours : il
// presse le bouton que la page se greffe, celui qui construit le dossier
// COMPLET. Si une nouvelle version des écrans renommait l'un des deux repères,
// l'envoi automatique mourrait sans bruit — d'où ce garde-fou.
for (const [nom, src] of [['demande-devis', DEVIS], ['vente-directe', VENTE]]) {
  assert.ok(/id="oldaCreatePlanningBtn"|btn\.id="oldaCreatePlanningBtn"/.test(src),
    `${nom} : le bouton d’envoi doit garder l’identifiant oldaCreatePlanningBtn`);
  assert.ok(/window\.patchPlanningButton\s*=\s*patchPlanningButton/.test(src),
    `${nom} : le constructeur du dossier complet doit rester exposé`);
}
assert.ok(/id="step7"/.test(DEVIS) && /id="paymentSuccess"/.test(VENTE),
  'les deux écrans de fin gardent leur identifiant');
assert.ok(/const ECRANS_FINAUX = \['step7', 'paymentSuccess'\]/.test(PONT),
  'le filet doit guetter les DEUX écrans de fin');

// ===========================================================================
// 2. LE DOSSIER PART TOUT SEUL
// ===========================================================================
assert.ok(/function guetterEcranFinal\(\)[\s\S]*?envoyerAuPlanning\(true\)/.test(PONT),
  'l’écran de fin qui s’affiche doit déclencher l’envoi au planning');

// Il presse le bouton de la page ; il ne rebâtit pas le dossier. Retranscrire
// le parcours, c'est exactement ce que le dépôt interdit : une nouvelle version
// des écrans repartirait avec une fiche appauvrie sans que rien ne le dise.
const ENVOI = PONT.match(/function envoyerAuPlanning\(auto\)[\s\S]*?\n  \}/)[0];
assert.ok(/btn\.click\(\)/.test(ENVOI), 'l’envoi doit presser le bouton du parcours');
assert.ok(/patchPlanningButton/.test(ENVOI),
  'le dossier COMPLET doit être greffé avant l’envoi, pas le dossier minimal');
assert.ok(!/source:|payload\s*=|client_info/.test(ENVOI),
  'le filet ne doit PAS reconstruire le dossier : il appartient au parcours');

// Un envoi automatique n'emporte pas la vendeuse au planning : elle a le ticket
// du client à l'écran, et il lui reste à l'imprimer.
assert.ok(/OLDA_ENVOI_AUTOMATIQUE/.test(PONT) && /OLDA_ENVOI_AUTOMATIQUE/.test(HOTE),
  'le parcours doit pouvoir dire à l’hôte que l’envoi est automatique');
assert.ok(/if \(auto\) return;/.test(HOTE),
  'un envoi automatique ne doit pas sauter sur la ligne du planning');
assert.ok(/if \(!auto\) montrerEnvoi\(\)/.test(HOTE),
  'un envoi automatique ne doit pas afficher le bandeau d’attente de l’hôte');

// Le drapeau ne vaut QUE pour l'envoi qui suit : resté armé, il priverait le
// prochain envoi — tapé, celui-là — de son saut vers la ligne créée.
assert.ok(/prochainEnvoiAutomatique = false;\s*\}, 0\)/.test(HOTE),
  'le drapeau « envoi automatique » doit retomber de lui-même');

// ===========================================================================
// 3. L'ÉCRAN DIT OÙ EN EST LE DOSSIER
// ===========================================================================
// Le message d'échec de l'hôte vit AU-DESSUS du cadre : sur la tablette du
// comptoir, en paysage, il est hors de vue. Le bandeau, lui, est posé en tête
// de l'écran de fin — c'est la première chose lue.
assert.ok(/ecran\.insertBefore\(el, ecran\.firstChild\)/.test(PONT),
  'le bandeau d’état doit être posé EN TÊTE de l’écran de fin');
assert.ok(/OLDA_PROJET_RESULT/.test(PONT) && /OLDA_PROJET_RESULT/.test(HOTE),
  'l’hôte doit renvoyer au parcours ce que le serveur a répondu');
assert.ok(/repondreAuParcours\(source, false, raison\)/.test(HOTE),
  'un échec doit redescendre jusqu’à l’écran de la vendeuse');
assert.ok(/repondreAuParcours\(source, true/.test(HOTE),
  'un succès doit redescendre jusqu’à l’écran de la vendeuse');

// Trois états, trois couleurs : la couleur dit un ÉTAT, jamais une décoration.
for (const etat of ['envoi', 'ok', 'echec']) {
  assert.ok(new RegExp(`\\.olda-etat--${etat}\\{`).test(PONT), `l’état « ${etat} » doit avoir sa teinte`);
}
assert.ok(/⚠ Ce dossier n’est PAS au planning\./.test(PONT),
  'un dossier qui n’est pas parti doit le dire en toutes lettres');

// Tablette : le bouton de reprise se tape au doigt.
assert.ok(/\.olda-etat__reessai\{[^}]*min-height:44px/.test(PONT),
  'le bouton « Réessayer » doit faire 44 px de haut');

// ===========================================================================
// 4. PLUS RIEN N'EFFACE LE DOSSIER EN SILENCE
// ===========================================================================
// « 💾 Enregistrer » écrivait `oldaDraft-<ref>` dans le navigateur et annonçait
// « Brouillon enregistré » : rien, nulle part, ne relit jamais cette clé. La
// vendeuse repartait convaincue d'avoir sauvegardé. `pont.js` l'avait rebranché
// sur le vrai envoi ; le 24/08/2026 le bouton a été RETIRÉ, et le rebranchement
// avec lui. Un geste qu'on ne demande plus ne peut plus être oublié.
assert.ok(!/localStorage\.setItem\(`oldaDraft-/.test(DEVIS),
  'plus rien n’écrit un brouillon que personne ne relit');
assert.ok(!/saveDraft/.test(DEVIS), 'le bouton qui l’écrivait est parti avec');
assert.ok(!/rebrancherBoutonBrouillon/.test(PONT),
  '… et le rebranchement n’a plus d’objet');

// CE QUI LE REMPLACE : le dossier part TOUT SEUL dès que l'écran de fin
// s'affiche. C'est la seule raison pour laquelle on peut se passer du bouton.
const GUET = PONT.match(/function guetterEcranFinal\(\)[\s\S]*?\n  \}/)[0];
assert.ok(/envoyerAuPlanning\(true\)/.test(GUET),
  'l’écran de fin envoie le dossier de lui-même');

// LA MÉCANIQUE RESTE DANS LE DOCUMENT, invisible. C'est elle qui porte la fiche
// complète, et pont.js l'envoie en la CLIQUANT : la retirer tue l'envoi.
assert.ok(/btn\.style\.display="none";/.test(DEVIS),
  'le bouton d’envoi ne se montre plus');
assert.ok(!/btn\.hidden\s*=\s*true/.test(DEVIS),
  '`hidden` serait défait par la règle d’affichage que la rangée impose aux boutons');
assert.ok(/btn\.click\(\)/.test(PONT), 'l’envoi passe toujours par un clic sur elle');

// UN `.click()` SUR UN BOUTON DÉSACTIVÉ NE FAIT RIEN, ET NE LÈVE RIEN. Le
// bandeau restait sur « Enregistrement… » puis annonçait « Aucune réponse — le
// réseau a peut-être décroché » alors que RIEN n'était parti : de quoi chercher
// une panne de réseau qui n'a jamais existé. L'envoi ne doit dépendre de l'état
// d'aucun bouton.
assert.ok(/btn\.disabled = false;\s*\n\s*btn\.click\(\);/.test(PONT),
  'la mécanique est réarmée avant d’être cliquée');
assert.ok(!/btn\.disabled = true/.test(PONT),
  'plus rien ne désactive la mécanique d’envoi');
// Ce qui empêche le double envoi, c'est la garde d'état — pas un bouton grisé.
const ENVOI_FN = PONT.match(/function envoyerAuPlanning\(auto\)[\s\S]*?\n  \}/)[0];
assert.ok(/if \(etatEnvoi === 'envoi' \|\| etatEnvoi === 'ok'\) return;/.test(ENVOI_FN),
  'un dossier déjà parti ne repart pas');

// Et la rangée de fin ne porte plus qu'un bouton : celui qui passe au client
// suivant. Il EFFACE le dossier — mais à ce moment-là le dossier est déjà
// parti, et s'il ne l'est pas, le garde-fou ci-dessous demande confirmation.
assert.ok(!/<button[^>]*>💾/.test(DEVIS), 'plus de bouton « Enregistrer » sur l’écran de fin');
assert.ok(/<button class="secondary" onclick="newRequest\(\)">Nouvelle demande<\/button>\s*<\/div>/.test(DEVIS),
  '… la rangée de fin ne porte plus que « Nouvelle demande »');

// Les brouillons déjà écrits dorment dans les tablettes : ce sont peut-être des
// dossiers perdus. On les montre au lieu de les laisser mourir avec le cache.
assert.ok(/montrerBrouillonsOublies/.test(PONT) && /startsWith\('oldaDraft-'\)/.test(PONT),
  'les brouillons oubliés doivent être remontés à la vendeuse');

// Les boutons qui rechargent la page emportent le dossier avec eux.
assert.ok(/const DESTRUCTEURS = '#newSaleBtn, #homeBtn, \[onclick\^="newRequest"\]'/.test(PONT),
  'les trois boutons qui effacent le dossier doivent être gardés');
assert.ok(/stopImmediatePropagation\(\)/.test(PONT),
  'le garde-fou doit passer AVANT le geste destructeur');
// On ne bloque pas : une vendeuse doit pouvoir abandonner un dossier. On lui
// dit ce qu'elle fait, et le geste assumé passe.
assert.ok(/abandonAssume = true;\s*\n\s*cible\.click\(\);/.test(PONT),
  'le geste assumé doit passer, pas rester bloqué');
assert.ok(/beforeunload/.test(PONT), 'fermer l’onglet doit prévenir aussi');

// ===========================================================================
// 5. CE QUE L'ENVOI AUTOMATIQUE NE DOIT SURTOUT PAS FAIRE : DOUBLER LA LIGNE
// ===========================================================================
// Le dossier part tout seul, puis la vendeuse tape quand même sur « Créer dans
// le planning » (ou sur « Réessayer ») : il ne doit en rester QU'UNE. C'est
// l'empreinte du dossier qui le garantit, pas la référence.

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

(async () => {
  process.env.PORT = '0';
  const app = require('../server');
  const base = await new Promise((resolve) => {
    const check = () => {
      const s = app && app.__server;
      if (s && s.listening) resolve(`http://127.0.0.1:${s.address().port}`);
      else setTimeout(check, 25);
    };
    check();
  });

  const call = async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  // Le dossier de la cliente perdue, tel que le parcours devis le poste.
  const dossier = {
    source: 'Demande de devis',
    ref: 'DEV-26.08.13-001',
    clientObj: { name: 'Jacqueline Perrin', type: 'Particulier', phone: '0690112233' },
    client: 'Jacqueline Perrin',
    name: '20 t-shirts brodés',
    responsible: 'Mélina',
    stage: 'demande',
    status: 'À chiffrer',
    recap: '20 x T-shirt blanc — broderie poitrine',
    client_info: [['Nom', 'Jacqueline Perrin']],
    details: [['Besoin', '20 t-shirts brodés']],
    quantity: 20,
  };

  // 1er envoi : automatique, à l'affichage de l'écran de fin.
  const auto = await call('POST', '/api/comptoir/projet', dossier);
  assert.strictEqual(auto.status, 201, 'l’envoi automatique doit créer la ligne');
  assert.ok(auto.body.id, 'la ligne doit avoir un identifiant');
  assert.ok(!auto.body.dejaEnregistre, 'le premier envoi crée bien quelque chose');

  // 2e envoi : la vendeuse tape le bouton (ou « Réessayer ») sur le MÊME dossier.
  const tape = await call('POST', '/api/comptoir/projet', dossier);
  assert.strictEqual(tape.body.dejaEnregistre, true, 'le second envoi doit être reconnu comme un renvoi');
  assert.strictEqual(tape.body.id, auto.body.id, 'il doit rendre LA MÊME ligne');

  // Et il n'y en a qu'une, sous ce nom, dans tout le planning.
  const trouve = await call('GET', '/api/requests/recherche?q=jacqueline');
  assert.strictEqual(trouve.body.length, 1, 'une seule ligne pour une seule cliente');
  assert.strictEqual(trouve.body[0].billing_company, 'Jacqueline Perrin');

  // La recherche la retrouve par TOUT ce que la vendeuse a sous les yeux : le
  // nom, sans casse ni accent, et le numéro lu sur le ticket du client.
  for (const q of ['JACQUELINE', 'perrin', 'jacqueline perrin', 'DEV-26.08.13-001', '26.08.13-001']) {
    const r = await call('GET', `/api/requests/recherche?q=${encodeURIComponent(q)}`);
    assert.strictEqual(r.body.length, 1, `« ${q} » doit retrouver la cliente`);
  }

  // Un envoi qui ÉCHOUE ne laisse rien derrière lui : ni ligne à moitié créée,
  // ni référence consommée. C'est ce qui permet à « Réessayer » d'exister.
  const vide = await call('POST', '/api/comptoir/projet', { ...dossier, clientObj: null, client: '' });
  assert.strictEqual(vide.status, 400, 'un dossier sans client doit être refusé');
  const apres = await call('GET', '/api/requests/recherche?q=jacqueline');
  assert.strictEqual(apres.body.length, 1, 'un refus ne doit rien avoir créé');

  console.log('✔ dossier-comptoir-non-envoye : le dossier part tout seul, une fois, et se retrouve');
  process.exit(0);
})();
