'use strict';

// UN DOSSIER, PLUSIEURS TRAVAUX — le découpage d'une commande par article.
// ===========================================================================
// Demande de Charlie, 25/08 : « un client peut me prendre 10 mugs, 3 tee-shirts,
// 4 décapsuleurs et 10 casquettes ; je peux produire les casquettes mais pas les
// mugs, qui sont en commande. »
//
// C'était impossible, et pour une raison de MODÈLE : l'étape appartient à la
// LIGNE (« À commander » est une sous-étape de Préparation), et le comptoir
// n'envoyait qu'une ligne par dossier — le panier était aplati en texte
// (« 10 x Mug • 3 x T-shirt • … ») avant de partir. Le dossier était donc tout
// entier en attente, ou tout entier en production, jamais les deux.
//
// Un dossier à plusieurs articles entre désormais en autant de lignes, reliées
// par `fiche.lot = { ref, rang, total }`. Ce que ce fichier garde :
//
//   1. quatre articles → quatre lignes, contiguës, sous le même ticket ;
//   2. LA SOMME DES LIGNES VAUT LE TICKET — sinon la colonne Prix ment, et
//      toute somme faite dessus ment avec elle ;
//   3. chaque ligne porte SON article : désignation, quantité, sa date ;
//   4. elles avancent SÉPARÉMENT (c'est tout l'objet du découpage) ;
//   5. un renvoi du même dossier ne crée pas huit lignes ;
//   6. un dossier d'UN article reste exactement ce qu'il était (aucune
//      régression sur le cas courant) ;
//   7. une demande de devis se découpe SANS PRIX (null, jamais 0 €) ;
//   8. un montant illisible ne se découpe PAS : une ligne juste vaut mieux
//      que quatre fausses ;
//   9. `lot` survit à l'allègement de la fiche — sans lui, plus de bannière
//      ni de « 2/4 », et les lignes se dispersent sans que rien ne les relie ;
//  10. les deux écrans du comptoir envoient bien leurs articles.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { chargerPapier } = require('./socle-papier.js');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

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

  const call = async (method, chemin, body) => {
    const res = await fetch(base + chemin, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const toutes = async () => (await call('GET', '/api/requests')).body;
  const lignesDuTicket = async (ref) => (await toutes())
    .filter((r) => r.fiche && r.fiche.ref === ref)
    .sort((a, b) => (a.fiche.lot ? a.fiche.lot.rang : 0) - (b.fiche.lot ? b.fiche.lot.rang : 0));

  // Le panier réel de la demande : quatre articles, quatre travaux différents.
  const PANIER = [
    { label: 'Mug céramique blanc', qty: 10, detail: 'Sublimation recto', due: '2026-09-04', heure: '10:00', amount: 120 },
    { label: 'Tee-shirt coton 180g', qty: 3, detail: 'DTF dos + cœur', due: '2026-09-01', heure: '14:00', amount: 75.5 },
    { label: 'Décapsuleur métal', qty: 4, detail: 'Gravure laser', due: '2026-09-01', heure: '14:00', amount: 32 },
    { label: 'Casquette 5 panneaux', qty: 10, detail: 'Broderie frontale', due: '2026-08-28', heure: '09:00', amount: 210 },
  ];
  const TOTAL = 437.5;   // = 120 + 75,5 + 32 + 210

  const venteDe = (ref, articles, amount) => ({
    source: 'Vente directe',
    ref,
    client: 'Marina Royale',
    clientObj: { type: 'Professionnel', company: 'Marina Royale', contact: 'Paul Riva', phone: '0690445566' },
    name: articles.map((a) => `${a.qty} x ${a.label}`).join(' • '),
    responsible: 'Loïc',
    due: '2026-09-04',
    dueTime: '14:00',
    priority: '2',
    stage: 'preparation',
    status: 'Préparation des produits',
    amount,
    articles,
    recap: `TICKET ${ref}`,
    details: articles.flatMap((a, i) => [
      [`Article ${i + 1} — Désignation`, a.label],
      [`Article ${i + 1} — Quantité`, String(a.qty)],
      [`Article ${i + 1} — Description de production`, a.detail],
    ]),
    paiement: { modeLabel: 'CB', mode: 'cb', paye: true },
  });

  // =========================================================================
  // 1. QUATRE ARTICLES → QUATRE LIGNES, sous le même ticket
  // =========================================================================
  const REF = 'LOT-26.08.25-001';
  const vente = await call('POST', '/api/comptoir/projet', venteDe(REF, PANIER, TOTAL));
  assert.strictEqual(vente.status, 201, 'la vente doit être enregistrée');
  assert.strictEqual(vente.body.lot && vente.body.lot.total, 4,
    'la réponse doit ANNONCER les quatre lignes : sans ça la vendeuse croit à un doublon et en supprime trois');
  assert.strictEqual(vente.body.lot.ids.length, 4);

  const lot = await lignesDuTicket(REF);
  assert.strictEqual(lot.length, 4, 'quatre articles = quatre lignes au planning');
  for (const l of lot) {
    assert.strictEqual(l.stage, 'a_trier', 'tout le comptoir attend dans le sur-dossier');
    assert.strictEqual(l.fiche.lot.total, 4);
    assert.strictEqual(l.fiche.lot.ref, REF, 'le numéro de ticket est ce qui relie les lignes');
  }
  assert.deepStrictEqual(lot.map((l) => l.fiche.lot.rang), [1, 2, 3, 4],
    'les rangs se suivent : c’est par eux qu’on retrouve l’article dans le récapitulatif');

  // CONTIGUËS. La bannière de « À trier » regroupe des lignes VOISINES : des
  // rangs entrelacés avec ceux d'un autre ticket la couperaient en morceaux.
  const positions = lot.map((l) => Number(l.position));
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1],
      'les lignes d’un même ticket doivent se suivre dans l’ordre du panier');
  }
  const autres = (await toutes())
    .filter((r) => r.stage === 'a_trier' && !(r.fiche && r.fiche.ref === REF))
    .map((r) => Number(r.position));
  for (const p of autres) {
    const dedans = p > positions[0] && p < positions[positions.length - 1];
    assert.ok(!dedans, 'aucune ligne étrangère ne doit s’intercaler dans un lot');
  }

  // =========================================================================
  // 2. L'ARGENT — la somme des lignes vaut le ticket, à l'euro près
  // =========================================================================
  const somme = lot.reduce((t, l) => t + Number(l.project_value), 0);
  assert.ok(Math.abs(somme - TOTAL) < 0.005,
    `les quatre lignes doivent totaliser le ticket (${somme} ≠ ${TOTAL})`);
  assert.deepStrictEqual(lot.map((l) => Number(l.project_value)), [120, 75.5, 32, 210],
    'chaque ligne porte le prix de SON article');
  for (const l of lot) {
    assert.strictEqual(l.paye, true, 'le client a payé le ticket : les quatre lignes le disent');
    assert.strictEqual(l.paiement_mode, 'cb');
  }

  // L'ÉCART D'ARROND SE POSE SUR LA PREMIÈRE LIGNE, il ne se dilue pas. Un
  // ticket arrondi à la caisse (remise, arrondi espèces) ne doit pas laisser
  // quatre lignes qui totalisent autre chose que ce qui a été encaissé.
  const REF_ARR = 'LOT-26.08.25-002';
  const arrondi = await call('POST', '/api/comptoir/projet', venteDe(REF_ARR, PANIER, 430));
  assert.strictEqual(arrondi.status, 201);
  const lotArr = await lignesDuTicket(REF_ARR);
  const sommeArr = lotArr.reduce((t, l) => t + Number(l.project_value), 0);
  assert.ok(Math.abs(sommeArr - 430) < 0.005,
    `la remise de caisse doit se retrouver dans la somme des lignes (${sommeArr} ≠ 430)`);
  assert.strictEqual(Number(lotArr[0].project_value), 112.5,
    'l’écart se pose sur la première ligne, en entier');

  // =========================================================================
  // 3. CHAQUE LIGNE PORTE SON ARTICLE
  // =========================================================================
  assert.deepStrictEqual(lot.map((l) => l.product), PANIER.map((a) => a.label),
    'l’objet de la ligne est la désignation de l’article : c’est ce que l’atelier lit dans la grille');
  assert.deepStrictEqual(lot.map((l) => l.quantity), PANIER.map((a) => a.qty),
    'la quantité est celle de l’article, pas la somme du panier');
  assert.deepStrictEqual(lot.map((l) => String(l.deadline).slice(0, 10)), PANIER.map((a) => a.due),
    'chaque article garde SA date de retrait — les mugs vendredi, les casquettes mardi');
  assert.ok(lot[3].description.includes('Broderie'),
    'la colonne Infos dit ce qu’il y a à faire SUR CETTE LIGNE');
  assert.ok(!lot[3].description.includes('Sublimation'),
    'et rien de ce qu’il y a à faire sur les autres');

  // =========================================================================
  // 4. ELLES AVANCENT SÉPARÉMENT — la raison d'être du découpage
  // =========================================================================
  const casquettes = lot[3];
  const mugs = lot[0];
  await call('PATCH', `/api/requests/${casquettes.id}`, { stage: 'production', sub_stage: 'prod_pressage' });
  await call('PATCH', `/api/requests/${mugs.id}`, { stage: 'preparation', sub_stage: 'a_commander' });

  const apres = await lignesDuTicket(REF);
  const parRang = Object.fromEntries(apres.map((l) => [l.fiche.lot.rang, l]));
  assert.strictEqual(parRang[4].stage, 'production',
    'on produit les casquettes…');
  assert.strictEqual(parRang[1].sub_stage, 'a_commander',
    '…pendant que les mugs attendent le fournisseur');
  assert.strictEqual(parRang[2].stage, 'a_trier',
    'et déplacer une ligne n’emmène pas ses voisines');
  assert.strictEqual(parRang[2].fiche.lot.total, 4,
    'dispersées dans le pipeline, les lignes savent toujours qu’elles vont ensemble');

  // =========================================================================
  // 5. IDEMPOTENCE — un renvoi ne double pas le lot
  // =========================================================================
  const renvoi = await call('POST', '/api/comptoir/projet', venteDe(REF, PANIER, TOTAL));
  assert.strictEqual(renvoi.body.dejaEnregistre, true,
    'le même dossier renvoyé doit être reconnu, pas recréé');
  assert.strictEqual((await lignesDuTicket(REF)).length, 4,
    'un renvoi ne crée pas huit lignes');

  // =========================================================================
  // 6. UN SEUL ARTICLE : RIEN NE CHANGE
  // =========================================================================
  const REF_SEUL = 'LOT-26.08.25-003';
  const seul = await call('POST', '/api/comptoir/projet',
    venteDe(REF_SEUL, [PANIER[3]], 210));
  assert.strictEqual(seul.status, 201);
  assert.strictEqual(seul.body.lot, undefined,
    'un dossier d’un seul article n’est pas un lot : rien à annoncer');
  const unSeul = await lignesDuTicket(REF_SEUL);
  assert.strictEqual(unSeul.length, 1);
  assert.strictEqual(unSeul[0].fiche.lot, undefined,
    'et sa fiche ne porte aucune marque de lot — pas de « 1/1 » sur l’écran');
  assert.strictEqual(Number(unSeul[0].project_value), 210);

  // Un écran qui n'envoie AUCUN article (ancienne version en cache) doit
  // continuer à créer sa ligne unique : on ne casse pas un poste pas rechargé.
  const REF_VIEUX = 'LOT-26.08.25-004';
  const vieux = await call('POST', '/api/comptoir/projet',
    { ...venteDe(REF_VIEUX, PANIER, TOTAL), articles: undefined });
  assert.strictEqual(vieux.status, 201);
  assert.strictEqual((await lignesDuTicket(REF_VIEUX)).length, 1,
    'sans `articles`, le dossier entre en une ligne — comme avant');

  // =========================================================================
  // 7. UNE DEMANDE DE DEVIS SE DÉCOUPE SANS PRIX
  // =========================================================================
  const REF_DEV = 'DEV-26.08.25-001';
  const demande = await call('POST', '/api/comptoir/projet', {
    source: 'Demande de devis',
    ref: REF_DEV,
    client: 'Karibuni Plage',
    clientObj: { type: 'Professionnel', company: 'Karibuni Plage', phone: '0690778899' },
    name: 'Demande de devis',
    responsible: 'Mélina',
    priority: '2',
    stage: 'demande',
    status: 'À chiffrer',
    amount: null,
    articles: [
      { label: 'Gobelet réutilisable', qty: 200, detail: 'Verre · Blanc · Sérigraphie' },
      { label: 'Parasol imprimé', qty: 6, detail: 'Toile · Bleu · Sublimation' },
    ],
    recap: `TICKET ${REF_DEV}`,
  });
  assert.strictEqual(demande.status, 201);
  assert.strictEqual(demande.body.lot.total, 2);
  const lotDev = await lignesDuTicket(REF_DEV);
  assert.strictEqual(lotDev.length, 2);
  for (const l of lotDev) {
    assert.strictEqual(l.project_value, null,
      'une demande n’a pas de prix : NULL (« À chiffrer »), jamais 0 € qui se lirait « gratuit »');
    assert.strictEqual(l.order_kind, 'demande');
    assert.strictEqual(l.paye, null, 'une demande ne se prononce pas sur le paiement');
  }

  // =========================================================================
  // 8. UN MONTANT ILLISIBLE NE SE DÉCOUPE PAS
  // =========================================================================
  // Quatre lignes au mauvais prix, c'est une caisse fausse et personne pour le
  // voir. Une ligne au bon prix se range à la main en dix secondes.
  const REF_FLOU = 'LOT-26.08.25-005';
  const flou = await call('POST', '/api/comptoir/projet', venteDe(REF_FLOU, [
    { ...PANIER[0], amount: 120 },
    { ...PANIER[1], amount: 'je sais plus' },
  ], TOTAL));
  assert.strictEqual(flou.status, 201, 'le dossier entre quand même : on ne perd JAMAIS une vente');
  const lotFlou = await lignesDuTicket(REF_FLOU);
  assert.strictEqual(lotFlou.length, 1,
    'un article dont le montant ne se lit pas empêche le découpage — une ligne juste plutôt que deux fausses');
  assert.ok(Math.abs(Number(lotFlou[0].project_value) - TOTAL) < 0.005,
    'et cette ligne unique porte le total du ticket');

  // =========================================================================
  // 9. `lot` SURVIT À L'ALLÈGEMENT DE LA FICHE
  // =========================================================================
  // La liste ne transporte qu'un résumé de la fiche (elle repart vers chaque
  // poste à chaque rafraîchissement). `lot` absent de ce résumé : les lignes se
  // dispersent dans le pipeline sans que RIEN ne les relie, en silence.
  const enListe = (await toutes()).find((r) => r.id === parRang[2].id);
  assert.ok(enListe.fiche && enListe.fiche.lot,
    'le lot doit voyager dans la LISTE, pas seulement dans le détail');
  assert.strictEqual(enListe.fiche.lot.total, 4);

  const SERVEUR = lire('server.js');
  const liste = SERVEUR.match(/const FICHE_LISTE = \[([^\]]*)\]/)[1];
  assert.ok(/'lot'/.test(liste), 'FICHE_LISTE doit contenir `lot`');

  // =========================================================================
  // 10. LES DEUX ÉCRANS DU COMPTOIR ENVOIENT LEURS ARTICLES
  // =========================================================================
  // Le serveur sait découper ; encore faut-il qu'on lui donne de quoi. Les deux
  // parcours ont chacun DEUX endroits qui postent (le bouton naît avec un
  // payload minimal, un correctif pose le vrai) : les deux doivent l'envoyer,
  // sinon le découpage marche un jour sur deux sans qu'on comprenne pourquoi.
  for (const [f, cle] of [
    ['public/comptoir/vente-directe.html', 'articlesPourPlanning'],
    ['public/comptoir/demande-devis.html', 'besoinsPourPlanning'],
  ]) {
    const src = lire(f);
    assert.ok(src.includes(`window.${cle}=function`), `${f} : le constructeur d’articles doit exister`);
    const postes = src.split(/articles:/).length - 1;
    assert.ok(postes >= 2, `${f} : les DEUX payloads doivent porter \`articles\` (vu ${postes})`);
  }

  // Le pont et l'hôte disent tous deux combien de lignes sont nées.
  for (const f of ['public/comptoir/pont.js', 'public/nouveau-projet.js']) {
    assert.ok(/lot\b[\s\S]{0,120}total/.test(lire(f)),
      `${f} : l’écran doit annoncer le nombre de lignes créées`);
  }

  // =========================================================================
  // 11. LA BANNIÈRE : DEUX LIGNES VOISINES, PAS UNE
  // =========================================================================
  // On EXÉCUTE le regroupement, on ne relit pas sa forme : c'est le résultat
  // qui compte, et il survivra à la prochaine refonte de l'écran.
  const vm = require('node:vm');
  const APP = lire('public/app.js');
  const bloc = (src, signature) => {
    const from = src.indexOf(signature);
    assert.ok(from >= 0, `bloc introuvable : ${signature}`);
    const to = src.indexOf('\n}', from);
    assert.ok(to > from, `fin de bloc introuvable : ${signature}`);
    return src.slice(from, to + 2);
  };
  const sable = {};
  vm.createContext(sable);
  vm.runInContext(
    `${bloc(APP, 'function lotDe(r) {')}\n${bloc(APP, 'function bandesDeLot(data) {')}`
    + `\n${bloc(APP, 'function regrouperLots(liste) {')}`
    + '\nglobalThis.grouper = bandesDeLot;\nglobalThis.lire = lotDe;'
    + '\nglobalThis.rassembler = regrouperLots;',
    sable,
  );

  const L = (ref, rang, total) => ({ id: `${ref}-${rang}`, fiche: { ref, lot: { ref, rang, total } } });
  const SEUL = { id: 'x', fiche: { ref: 'AUTRE' } };

  let bandes = sable.grouper([L('A', 1, 4), L('A', 2, 4), L('A', 3, 4), L('A', 4, 4)]);
  assert.strictEqual(bandes.length, 1, 'quatre lignes voisines du même ticket = une bannière');
  assert.strictEqual(bandes[0].debut, 0);
  assert.strictEqual(Array.from(bandes[0].lignes).length, 4);

  bandes = sable.grouper([SEUL, L('A', 1, 4), L('A', 2, 4), SEUL, L('B', 1, 2), L('B', 2, 2)]);
  assert.strictEqual(bandes.length, 2, 'deux tickets, deux bannières');
  // `Array.from` : le tableau vient du bac à sable `vm`, il n'a pas le même
  // `Array.prototype` que celui d'ici — deepStrictEqual le refuserait alors
  // que le contenu est identique.
  assert.deepStrictEqual(Array.from(bandes.map((b) => b.debut)), [1, 4],
    'chaque bannière se pose AVANT la première ligne de son groupe');

  // Une ligne isolée n'a pas de bannière : un en-tête au-dessus d'une seule
  // ligne n'apprend rien, et c'est le « 2/4 » qui porte l'information là.
  assert.strictEqual(sable.grouper([L('A', 1, 4), SEUL, L('A', 2, 4)]).length, 0,
    'deux lignes du même ticket SÉPARÉES ne se coiffent pas d’une bannière commune');
  assert.strictEqual(sable.grouper([SEUL, L('A', 2, 4), SEUL]).length, 0,
    'une ligne seule de son lot n’a pas de bannière');

  // Un dossier d'UN article ne porte pas de lot : jamais de « 1/1 » à l'écran.
  assert.strictEqual(sable.lire({ fiche: { ref: 'A', lot: { ref: 'A', rang: 1, total: 1 } } }), null,
    'un lot d’une seule ligne n’en est pas un');
  assert.strictEqual(sable.lire({ fiche: { ref: 'A' } }), null);
  assert.strictEqual(sable.lire({}), null, 'une ligne créée à la main n’a pas de fiche du tout');

  // =========================================================================
  // 12. LE TRI NE DOIT PAS ÉPARPILLER UN LOT
  // =========================================================================
  // Le tri automatique classe par urgence, et chaque article d'un panier a SA
  // date de retrait : les quatre lignes se retrouvaient dispersées, un dossier
  // étranger au milieu — la bannière, qui coiffe des lignes VOISINES, se
  // cassait alors en morceaux. Constaté au rendu avant d'être corrigé.
  const melange = [
    L('A', 4, 4),          // les casquettes, les plus urgentes
    SEUL,                  // un dossier étranger, au milieu du lot
    L('A', 2, 4),
    L('A', 3, 4),
    L('B', 2, 2),
    L('A', 1, 4),          // les mugs, les plus lointains
    L('B', 1, 2),
  ];
  const range = Array.from(sable.rassembler(melange)).map((r) => r.id);
  assert.deepStrictEqual(range, ['A-1', 'A-2', 'A-3', 'A-4', 'x', 'B-1', 'B-2'],
    'le lot prend la place de son article le plus urgent, et ses lignes suivent l’ordre DU TICKET');
  assert.strictEqual(Array.from(sable.grouper(sable.rassembler(melange))).length, 2,
    'après regroupement, chaque ticket a de nouveau sa bannière');
  // Rien à regrouper = la liste ressort telle quelle (pas de coût sur les
  // milliers de lignes qui ne sont pas des lots).
  const sansLot = [SEUL, { id: 'y' }, { id: 'z', fiche: {} }];
  assert.deepStrictEqual(Array.from(sable.rassembler(sansLot)).map((r) => r.id), ['x', 'y', 'z']);

  // =========================================================================
  // 13. LE PAPIER QUI PART À L'ÉTABLI NE PARLE QUE DE SON ARTICLE
  // =========================================================================
  // Le ticket atelier s'imprime DEPUIS UNE LIGNE. Sur un lot, imprimer les
  // quatre articles sur chaque papier ferait annoncer « à retirer le 28/08 »
  // au-dessus de trois articles qui ne sont pas dus ce jour-là — et l'atelier
  // emballerait une commande incomplète en la croyant finie.
  // On charge le VRAI source (module ES du navigateur) dans un `vm`, sans ses
  // `export` — même idiome que ticket-atelier.test.js : pas une copie, l'original.
  const bacTicket = chargerPapier('ticket.js', ['modeleTicket', 'ticketTexte']);
  const { modeleTicket, ticketTexte } = bacTicket;
  const detailLot = await call('GET', `/api/requests/${parRang[4].id}`);
  const tk = modeleTicket(detailLot.body);
  assert.strictEqual(Array.from(tk.lignes).length, 1,
    'le papier d’une ligne de lot ne porte QUE son article');
  assert.strictEqual(tk.lignes[0].designation, 'Casquette 5 panneaux');
  assert.deepStrictEqual(tk.lot && { ...tk.lot }, { rang: 4, total: 4 },
    'et il annonce qu’il est le 4e sur 4 : sinon on emballe une commande incomplète');
  assert.ok(/ARTICLE 4 SUR 4/.test(ticketTexte(tk)),
    'la version texte le dit aussi — c’est elle que recopie un poste sans imprimante');
  // La RÉFÉRENCE, elle, ne s'imprime toujours pas : un identifiant de dossier ne
  // fait rien produire (règle du ticket atelier). Un COMPTE, si.
  assert.ok(!ticketTexte(tk).includes(REF),
    'la référence reste hors du papier');

  // Un dossier d'UN article : papier inchangé, aucune mention de lot.
  const tkSeul = modeleTicket((await call('GET', `/api/requests/${unSeul[0].id}`)).body);
  assert.strictEqual(tkSeul.lot, null, 'pas de « 1 sur 1 » sur un dossier d’un seul article');
  assert.strictEqual(Array.from(tkSeul.lignes).length, 1);

  // =========================================================================
  // 14. CE QUE L'ÉCRAN DOIT PORTER
  // =========================================================================
  // La bannière SUIT ses lignes quand la recherche en masque : sans cette
  // passe, un en-tête resté seul coiffe les lignes du ticket suivant — il
  // désignerait le mauvais client, ce qui est pire que pas de bannière.
  const filtre = bloc(APP, 'function applySearchAndCounts() {');
  assert.ok(/bandEls/.test(filtre),
    'le filtre de recherche doit décider aussi du sort des bannières');

  // Le « 2/4 » vit dans les DEUX vues : le tableau et les cartes. Une seule des
  // deux, et la moitié des postes ne verrait jamais qu’une ligne a des sœurs.
  for (const [fn, ou] of [['function buildCard(r, options) {', 'la carte'], ['function cellDescription(r) {', 'le tableau']]) {
    assert.ok(/lotChip\(r\)/.test(bloc(APP, fn)), `${ou} doit porter la marque « 2/4 »`);
  }
  // SOUS UNE BANNIÈRE, la marque devient le bloc en toutes lettres : la
  // bannière nomme déjà le client et le ticket, la colonne dit alors QUEL
  // article on lit — « 1 sur 2 ». L'information ne disparaît jamais, elle
  // change de forme selon qu'un en-tête la coiffe ou non.
  assert.ok(/pcardBloc\('Article'/.test(bloc(APP, 'function buildCard(r, options) {')),
    'une carte coiffée par la bannière doit dire quel article elle est');

  const CSS = lire('public/styles.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const cls of ['lot-band', 'lot-band__nom', 'lot-chip', 'product-lot']) {
    assert.ok(new RegExp('\\.' + cls + '(?![\\w-])').test(CSS),
      `${cls} : la bannière et sa marque doivent être habillées`);
  }
  // Un enfant de flex ne rétrécit pas sous la largeur de son contenu : sans
  // `min-width:0`, un nom de client long pousse le compteur et le bouton hors
  // du bandeau au lieu de se laisser couper.
  assert.ok(/\.lot-band__nom\s*\{[^}]*min-width:\s*0/.test(CSS),
    'le nom du client doit pouvoir se couper dans la bannière');

  console.log('✓ lot d’articles : un dossier à N articles devient N lignes, la somme vaut le ticket, et chacune avance seule');
  app.__server.close();
})().catch((e) => { console.error(e); process.exit(1); });
