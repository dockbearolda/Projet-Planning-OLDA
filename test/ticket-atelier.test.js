'use strict';

// LE TICKET DE L'ATELIER — celui qui part avec le dossier à l'établi.
//
// La ligne du planning sortait le ticket du CLIENT : son papier, ses prix, son
// total, son mode de règlement. Personne ne s'en sert — le client repart avec
// le sien, imprimé au comptoir. Ce qu'on ressort depuis le planning, c'est le
// papier qui suit le travail : quoi produire, combien, pour quand, pour qui, et
// ce qu'il faut savoir avant de couper.
//
// Ce fichier vérifie, là où elles vivent :
//   1. LE MODÈLE DU TICKET (public/ticket.js, fonctions pures) — ce qu'il
//      garde, et surtout ce qu'il JETTE : à commencer par TOUT L'ARGENT.
//   2. LA LIGNE FAIT FOI pour ce qui se corrige après la vente (le retrait, le
//      client, la personne à joindre) ; la FICHE fait foi pour ce qui a été
//      vendu.
//   3. LA RECHERCHE PAR NUMÉRO DE TICKET — le seul repère que le client
//      rapporte au comptoir, et le seul champ qu'aucune recherche ne regardait.
//   4. LE BRANCHEMENT dans l'écran : le bouton d'impression sort le TICKET, la
//      pastille est sur la ligne, et le module part avec la coquille hors ligne.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

// Comme whatsapp.test.js : on n'exécute pas une copie, on charge le VRAI source
// (module ES du navigateur), on retire les `export` et on l'évalue dans un vm.
const SRC = lire('ticket.js');
const bac = {};
vm.createContext(bac);
vm.runInContext(
  `${SRC.replace(/^export\s+/gm, '')}
   globalThis.modeleTicket = modeleTicket;
   globalThis.ticketTexte = ticketTexte;`,
  bac,
);
const { modeleTicket, ticketTexte } = bac;

// Une vente directe telle que le comptoir l'enregistre : la fiche porte le
// récapitulatif ligne à ligne, exactement dans la forme produite par
// `saleRecapLines()` de public/comptoir/vente-directe.html.
const VENTE = {
  id: 'v1',
  order_kind: 'commande',
  billing_company: 'Coco Beach',
  contact_referent: 'Mélina',
  contact_phone: '0690 66 24 00',
  contact_email: 'contact@cocobeach.example',
  product: '2 x Polo brodé • 1 x Tasse',
  quantity: 3,
  project_value: 148.5,
  deadline: '2026-08-07',
  paye: true,
  paiement_mode: 'cb',
  fiche: {
    kind: 'comptoir-v17',
    source: 'Vente directe',
    ref: '26.08.06-003',
    creeLe: '2026-08-07T01:12:00.000Z',   // 06/08 à 21 h 12 à Saint-Martin
    heureSouhaitee: '16:30',
    production: 'Broderie poitrine',
    client: [
      { k: 'Type de client', v: 'Professionnel' },
      { k: 'Secteur', v: 'Restauration' },
    ],
    details: [
      { k: 'Type de dossier', v: 'Vente directe' },
      { k: 'Commande', v: '26.08.06-003' },
      { k: 'Date de la vente', v: '06/08/2026 21:12:00' },
      { k: 'Client', v: 'Coco Beach' },
      { k: 'Type de client', v: 'Professionnel' },
      { k: 'Personne à contacter', v: 'Mélina' },
      { k: 'Fonction du contact', v: 'Gérante' },
      { k: 'WhatsApp', v: '0690 66 24 00' },
      { k: 'E-mail', v: 'contact@cocobeach.example' },
      { k: 'Secteur', v: 'Restauration' },
      { k: 'Adresse', v: '12 rue de la Liberté — 97150 Marigot' },
      { k: 'Récupération prévue', v: '07/08/2026 à 14:00' },
      { k: 'Délai souhaité', v: 'Sous 5 jours' },
      { k: 'Nombre d’articles', v: '2' },
      { k: 'Quantité totale', v: '3' },
      { k: 'Article 1 — Désignation', v: 'Polo brodé' },
      { k: 'Article 1 — Quantité', v: '2' },
      { k: 'Article 1 — Prix unitaire', v: '55,00 € HT' },
      { k: 'Article 1 — Taxe 4 %', v: 'Appliquée' },
      { k: 'Article 1 — Supplément express', v: '12,00 €' },
      { k: 'Article 1 — Total TTC', v: '126,40 €' },
      { k: 'Article 1 — Description de production', v: 'Broderie poitrine, fil or' },
      { k: 'Article 1 — Récupération', v: '07/08/2026 à 14:00' },
      { k: 'Article 2 — Désignation', v: 'Tasse personnalisée' },
      { k: 'Article 2 — Quantité', v: '1' },
      { k: 'Article 2 — Prix unitaire', v: '22,10 € TTC' },
      { k: 'Article 2 — Taxe 4 %', v: 'Non appliquée' },
      { k: 'Article 2 — Supplément express', v: '0,00 €' },
      { k: 'Article 2 — Total TTC', v: '22,10 €' },
      { k: 'Article 2 — Description de production', v: 'Sublimation logo' },
      { k: 'Total HT', v: '132,60 €' },
      { k: 'Taxe', v: '3,80 €' },
      { k: 'Suppléments', v: '12,00 €' },
      { k: 'Total TTC', v: '148,50 €' },
      { k: 'Paiement', v: 'Carte bancaire' },
      { k: 'Client repart immédiatement', v: 'Non' },
      { k: 'Note interne OLDA', v: 'Client difficile, ne rien promettre avant le BAT' },
    ],
  },
};

// Une demande de devis, telle que `recapLines()` de demande-devis.html l'émet.
const DEMANDE = {
  id: 'd1',
  order_kind: 'demande',
  billing_company: 'Mairie de Marigot',
  contact_referent: 'M. Alexis',
  contact_phone: '0590 87 00 00',
  product: 'Signalétique du marché',
  quantity: 40,
  project_value: null,
  deadline: '2026-08-20',
  paye: null,
  paiement_mode: null,
  fiche: {
    kind: 'comptoir-v17',
    source: 'Demande de devis',
    ref: 'DEV-26.08.06-002',
    creeLe: '2026-08-06T14:02:00.000Z',
    heureSouhaitee: null,
    details: [
      { k: 'Type de dossier', v: 'Demande de devis' },
      { k: 'Référence', v: 'DEV-26.08.06-002' },
      { k: 'Demande prise par', v: 'Sarah' },
      { k: 'Canal d’entrée', v: 'Téléphone' },
      { k: 'Client', v: 'Mairie de Marigot' },
      { k: 'Adresse', v: 'Hôtel de ville — 97150' },
      { k: 'Titre du projet', v: 'Signalétique du marché' },
      { k: 'Budget indicatif', v: 'À chiffrer' },
      { k: 'Décisions / contraintes', v: 'Passage en commission le 18' },
      { k: 'Besoin 1 — Désignation', v: 'Panneau dibond' },
      { k: 'Besoin 1 — Quantité', v: '40' },
      { k: 'Besoin 1 — Catégorie', v: 'Signalétique' },
      { k: 'Besoin 1 — Référence', v: '—' },
      { k: 'Besoin 1 — Couleur', v: 'Blanc' },
      { k: 'Besoin 1 — Production', v: 'Impression UV' },
      { k: 'Besoin 1 — Informations importantes', v: 'Fixation par œillets' },
      { k: 'Besoin 1 — Prix unitaire HT', v: 'À chiffrer' },
      { k: 'Statut du logo', v: 'Reçu' },
      { k: 'Vectorisation', v: 'À faire' },
      { k: 'Points à contrôler', v: 'Vérifier la charte de la mairie' },
      { k: 'Suite à donner', v: 'Devis à faire' },
    ],
  },
};

(async () => {
  // =========================================================================
  // 1. LE TICKET NE PORTE QUE CE QUI SERT À PRODUIRE
  // =========================================================================
  const tv = modeleTicket(VENTE);

  assert.strictEqual(tv.demande, false);
  assert.strictEqual(tv.titre, 'Ticket atelier');
  assert.strictEqual(tv.ref, '26.08.06-003');
  assert.strictEqual(tv.client, 'Coco Beach');
  assert.strictEqual(tv.contact, 'Mélina');
  assert.strictEqual(tv.tel, '0690 66 24 00');

  // Les articles à PRODUIRE, dans l'ordre, avec ce que l'établi lit : la
  // désignation, la quantité, ce qu'on en fait. Rien d'autre.
  assert.strictEqual(tv.lignes.length, 2);
  // `plat` : les objets nés dans le vm ont un autre `Object.prototype` que
  // celui du test, et `deepStrictEqual` refuse de les comparer.
  const plat = (o) => JSON.parse(JSON.stringify(o));
  // `ou` n'est pas du contenu : c'est l'ADRESSE d'écriture de chaque valeur,
  // vérifiée à part (voir ticket-edition.test.js). Le papier, lui, ne porte que
  // ce qui suit.
  const sansAdresse = (a) => { const { ou, ...reste } = plat(a); return reste; };
  assert.deepStrictEqual(sansAdresse(tv.lignes[0]), {
    designation: 'Polo brodé',
    qte: '2',
    detail: 'Broderie poitrine, fil or',
  });
  assert.strictEqual(tv.lignes[1].designation, 'Tasse personnalisée');
  // Le prix et le supplément express ne sont plus des CHAMPS du modèle : pas
  // « vides », absents. Un champ vide se remplit un jour par mégarde.
  assert.strictEqual(tv.lignes[0].prix, undefined);
  assert.strictEqual(tv.lignes[0].supplement, undefined);

  // CE QUI DOIT AVOIR DISPARU. On le vérifie sur le TEXTE du ticket, seul
  // endroit où tout ce qu'il porte est réuni.
  const papier = ticketTexte(tv);
  for (const interdit of [
    'Note interne',            // la note du dossier, jamais sur un papier d'atelier
    'Client difficile',        // son contenu, tout autant
    'Secteur',                 // le secteur d'activité
    'Restauration',
    'Adresse',                 // l'adresse de facturation
    'Marigot',
    'Total',                   // l'argent, sous toutes ses formes
    'Taxe',
    'Prix unitaire',
    'Supplément',
    'Paiement',
    'Carte bancaire',
    '148,50',
    '126,40',
    'E-mail',
    'contact@cocobeach.example',
    'Fonction du contact',
    'Gérante',
    'repart immédiatement',
  ]) {
    assert.ok(!papier.includes(interdit), `le ticket ne doit plus porter « ${interdit} » :\n${papier}`);
  }
  // PAS UN SEUL EURO. Le contrôle qui tient tout seul : peu importe par où
  // l'argent essaierait de revenir, il porte ce signe.
  assert.ok(!papier.includes('€'), `aucun montant ne doit figurer sur le ticket :\n${papier}`);

  // …et ce qui DOIT y être : quoi, combien, pour quand, pour qui, comment.
  for (const attendu of ['ATELIER OLDA', 'TICKET ATELIER', '26.08.06-003', 'Coco Beach',
    'Mélina', '0690 66 24 00', 'À RETIRER LE 07/08/2026 à 16h30',
    '2 x Polo brodé', 'Broderie poitrine, fil or', '1 x Tasse personnalisée']) {
    assert.ok(papier.includes(attendu), `le ticket doit porter « ${attendu} » :\n${papier}`);
  }

  // LA CONSIGNE DE L'ATELIER, dans son cadre — la raison d'être du papier.
  const avecConsigne = modeleTicket({
    ...VENTE, fiche: { ...VENTE.fiche, atelier: 'Logo poitrine gauche 8 cm — appeler avant de couper' },
  });
  assert.strictEqual(avecConsigne.atelier, 'Logo poitrine gauche 8 cm — appeler avant de couper');
  const avecCadre = ticketTexte(avecConsigne);
  assert.ok(avecCadre.includes("POUR L'ATELIER"));
  assert.ok(avecCadre.includes('appeler avant de couper'));

  // =========================================================================
  // 2. LA LIGNE FAIT FOI pour ce qui se corrige après la vente
  // =========================================================================
  // Le récapitulatif figé annonce une récupération le 07/08 à 14:00 ; la ligne,
  // elle, a été corrigée depuis (16:30). Un ticket réimprimé doit porter la
  // correction, sinon l'atelier produit pour une heure que personne ne tiendra.
  assert.strictEqual(tv.remiseLabel, 'À retirer le');
  assert.strictEqual(tv.remise, '07/08/2026 à 16h30');

  const corrigee = modeleTicket({
    ...VENTE, deadline: '2026-08-11', billing_company: 'Coco Beach Bar', contact_phone: '0690 00 11 22',
  });
  assert.strictEqual(corrigee.remise, '11/08/2026 à 16h30');
  // Le récapitulatif figé dit encore « Coco Beach » et l'ancien numéro : c'est
  // la LIGNE qui fait foi pour tout ce qui se corrige après la vente.
  assert.strictEqual(corrigee.client, 'Coco Beach Bar');
  assert.strictEqual(corrigee.tel, '0690 00 11 22');

  // L'ARGENT N'EST PLUS UN CHAMP DU MODÈLE. Le montant de la ligne ne remonte
  // nulle part sur ce papier, même quand il existe.
  assert.strictEqual(tv.total, undefined);
  assert.strictEqual(tv.totalLabel, undefined);
  assert.strictEqual(tv.paiement, undefined);

  // LA DATE DE LA VENTE EST CELLE DE L'ATELIER. `creeLe` est un instant UTC :
  // pris à 21 h 12 à Saint-Martin, il tombe au 07/08 en UTC. Un ticket daté du
  // lendemain ne correspondrait plus à celui que le client a en main.
  assert.strictEqual(tv.date, '06/08/2026');

  // =========================================================================
  // 3. LA DEMANDE DE DEVIS N'EST PAS UNE VENTE
  // =========================================================================
  const td = modeleTicket(DEMANDE);
  assert.strictEqual(td.demande, true);
  // Même papier, même titre : ce qui change, c'est la PROMESSE — on ne retire
  // pas une demande, on y répond.
  assert.strictEqual(td.titre, 'Ticket atelier');
  assert.strictEqual(td.ref, 'DEV-26.08.06-002');
  assert.strictEqual(td.remiseLabel, 'Réponse souhaitée');
  assert.strictEqual(td.remise, '20/08/2026');
  assert.ok(!ticketTexte(td).includes('€'), 'un devis non chiffré n’annonce surtout aucun montant');

  assert.strictEqual(td.lignes.length, 1);
  assert.strictEqual(td.lignes[0].designation, 'Panneau dibond');
  assert.strictEqual(td.lignes[0].qte, '40');
  assert.strictEqual(td.lignes[0].detail, 'Signalétique · Blanc · Impression UV');

  const devis = ticketTexte(td);
  for (const interdit of ['Points à contrôler', 'Vectorisation', 'Suite à donner',
    'Demande prise par', 'Canal', 'Statut du logo', 'commission']) {
    assert.ok(!devis.includes(interdit), `le ticket de devis ne doit pas porter « ${interdit} »`);
  }

  // =========================================================================
  // 4. CE QUI N'EST PAS UN DOSSIER DU COMPTOIR
  // =========================================================================
  // Une ligne saisie à la main dans la grille n'a pas de panier figé : son
  // ticket porte alors ce que la ligne sait, plutôt que d'être vide.
  const main = modeleTicket({
    billing_company: 'Passage rapide', product: 'Bâche 2 m', quantity: 1,
    project_value: 60, deadline: '2026-08-09', paye: false, fiche: null,
  });
  assert.strictEqual(main.lignes.length, 1);
  assert.strictEqual(main.lignes[0].designation, 'Bâche 2 m');
  assert.strictEqual(main.ref, '');

  // Le placeholder « — » du comptoir ne se recopie pas : un ticket qui annonce
  // « Contact : — » n'apprend rien à personne.
  const sansContact = modeleTicket({
    ...VENTE, contact_referent: '—', contact_phone: '', deadline: null,
  });
  assert.strictEqual(sansContact.contact, '');
  assert.strictEqual(sansContact.tel, '');
  assert.strictEqual(sansContact.remise, '');
  assert.ok(!ticketTexte(sansContact).includes('Contact'));

  // ON NE REMET AUCUN TICKET AU CLIENT. Les vieux dossiers portent encore un
  // `refTicket` — le numéro du papier remis à l'époque où on en remettait un.
  // Le ticket de l'atelier ne le sort pas : il ne parle qu'à l'établi, et une
  // ligne de plus sur un papier de travail est une question de plus.
  const ancien = modeleTicket({
    ...VENTE,
    fiche: { ...VENTE.fiche, ref: '26.08.06-004', refTicket: '26.08.06-003' },
  });
  assert.strictEqual(ancien.ref, '26.08.06-004');
  assert.strictEqual(ancien.refTicket, undefined, 'le modèle ne porte plus ce champ du tout');
  const papierAncien = ticketTexte(ancien);
  assert.ok(!papierAncien.includes('remis au client'));
  assert.ok(!papierAncien.includes('26.08.06-003'), 'l’ancien numéro de papier ne s’imprime nulle part');
  assert.ok(papierAncien.includes('26.08.06-004'), 'la référence du dossier, elle, reste en tête')

  // Rien ne casse sur une entrée absurde : l'aperçu doit s'ouvrir, toujours.
  for (const vide of [null, undefined, {}, { fiche: 'pas un objet' }]) {
    const t = modeleTicket(vide);
    assert.strictEqual(typeof ticketTexte(t), 'string');
    assert.strictEqual(t.lignes.length, 0);   // (deepStrictEqual refuse un tableau né dans le vm)
  }

  console.log('✓ ticket atelier : ce qui sert à produire, l’argent en moins, ligne qui fait foi OK');

  // =========================================================================
  // 5. LA RECHERCHE TROUVE UN DOSSIER PAR SON NUMÉRO DE TICKET
  // =========================================================================
  // C'est le seul repère que le client rapporte au comptoir — et c'était le
  // seul champ qu'aucune recherche ne regardait : taper le numéro lu sur son
  // papier ne rendait rien.
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

  const cree = await call('POST', '/api/comptoir/projet', {
    source: 'Vente directe',
    ref: '26.08.06-777',
    client: 'Sun Bar',
    clientObj: { type: 'Professionnel', company: 'Sun Bar', phone: '0690 11 22 33' },
    name: '2 x Polo brodé',
    amount: 148.5,
    due: '2026-08-07',
    dueTime: '16:30',
    stage: 'preparation',
    status: 'Préparation des produits',
    client_info: [['Type de client', 'Professionnel']],
    details: [['Article 1 — Désignation', 'Polo brodé'], ['Article 1 — Quantité', '2']],
    recap: 'ATELIER OLDA — RÉCAPITULATIF DE VENTE DIRECTE',
  });
  assert.strictEqual(cree.status, 201);

  const parNumero = await call('GET', '/api/requests/recherche?q=26.08.06-777');
  assert.strictEqual(parNumero.status, 200);
  assert.strictEqual(parNumero.body.length, 1, 'le numéro du ticket doit retrouver le dossier');
  assert.strictEqual(parNumero.body[0].id, cree.body.id);
  // La référence voyage dans la liste allégée : sans elle, le résultat trouvé
  // ne pourrait pas afficher le numéro qu'on vient de taper.
  assert.strictEqual(parNumero.body[0].fiche.ref, '26.08.06-777');

  // Un fragment suffit — on tape rarement le numéro entier au comptoir.
  const parFragment = await call('GET', '/api/requests/recherche?q=06-777');
  assert.strictEqual(parFragment.body.length, 1);

  // La recherche par nom n'a pas régressé au passage.
  const parNom = await call('GET', '/api/requests/recherche?q=sun bar');
  assert.ok(parNom.body.some((x) => x.id === cree.body.id));

  // Un numéro qui n'existe pas ne rend rien (et surtout pas tout le planning).
  const introuvable = await call('GET', '/api/requests/recherche?q=26.08.06-999');
  assert.deepStrictEqual(introuvable.body, []);

  console.log('✓ ticket : la recherche retrouve un dossier par le numéro du ticket OK');

  // =========================================================================
  // 6. LE BRANCHEMENT DANS L'ÉCRAN
  // =========================================================================
  const APP = lire('app.js');

  // Le bouton « Imprimer » de la fiche sort le TICKET, plus le récapitulatif.
  assert.ok(/ldActionBtn\('imprimer', 'Imprimer', \(\) => imprimerTicket\(r\)\)/.test(APP),
    'la fiche doit imprimer le ticket, pas le récapitulatif complet');
  // Le récapitulatif complet reste accessible — mais en téléchargement : c'est
  // un document de travail, il n'a jamais eu à sortir sur l'imprimante.
  assert.ok(/ldActionBtn\('telecharger', 'Récap complet', \(\) => telechargerRecap\(r\)\)/.test(APP));
  assert.ok(!/imprimerRecap/.test(APP), 'imprimerRecap ne doit plus exister');

  // Le ticket s'atteint depuis LA LIGNE, dans les deux vues.
  assert.ok(/carte\.append|pcard__ticket/.test(APP));
  assert.ok(/tk\.className = 'pcard__ticket'/.test(APP), 'la carte doit porter le bouton ticket');
  assert.ok(/tr\.appendChild\(cellTicket\(r\)\)/.test(APP),
    'la ligne du tableau doit porter sa colonne ticket');

  // Le bouton n'agit que là où un ticket a réellement existé.
  assert.ok(/function aUnTicket\(r\)/.test(APP));
  assert.ok(/if \(aUnTicket\(r\)\) \{/.test(APP));

  // -------------------------------------------------------------------------
  // 6 bis. LE TICKET EN COLONNE — affichable ou non, et sans décaler le reste
  // -------------------------------------------------------------------------
  const HTML = lire('index.html');
  const CSS = lire('styles.css');

  // Une VRAIE colonne du tableau : <col>, <th> et <td> au même rang. L'ordre
  // compte — un <col> agit sur la colonne de même rang, pas sur son data-col.
  const rangCol = (cle) => HTML.indexOf(`<col data-col="${cle}"`);
  assert.ok(rangCol('ticket') > rangCol('client') && rangCol('ticket') < rangCol('product'),
    'le <col> ticket doit se placer entre client et product');
  const thead = HTML.match(/<thead>[\s\S]*?<\/thead>/)[0];
  assert.ok(thead.indexOf('col-ticket') > thead.indexOf('col-client')
    && thead.indexOf('col-ticket') < thead.indexOf('col-product'),
  'le <th> ticket doit suivre le même ordre que le colgroup');
  const corps = APP.match(/function buildRow\(r\)[\s\S]*?\n\}/)[0];
  assert.ok(corps.indexOf('cellTicket(r)') > corps.indexOf('cellDossier(r)')
    && corps.indexOf('cellTicket(r)') < corps.indexOf('cellDescription(r)'),
  'buildRow doit poser la cellule ticket au même rang que son <col>');

  // Elle se retire depuis le rail « Colonnes », comme les autres.
  assert.ok(/\{ key: 'ticket',\s+label: '[^']+', surCarte: true \}/.test(APP),
    'le ticket doit figurer dans PLANNING_COLS');
  assert.ok(/\.grid\.off-ticket\s+col\[data-col="ticket"\]/.test(CSS),
    'la règle de masquage off-ticket doit exister');

  // …mais SANS faire basculer les cartes vers le tableau : le ticket vit dans
  // les deux vues, c'est ce que dit `surCarte` (cf. COLS_TABLEAU).
  assert.ok(/const COLS_TABLEAU = new Set\(\s*\n\s*PLANNING_COLS\.filter\(\(c\) => !c\.locked && !c\.surCarte\)/.test(APP),
    'COLS_TABLEAU doit exclure les colonnes présentes sur la carte');
  assert.ok(/const modeCartes = \(\) => COLS_TABLEAU\.size > 0/.test(APP),
    'la bascule cartes/tableau ne doit regarder que les colonnes du tableau');
  assert.ok(/cards-off-ticket/.test(APP) && /body\.cards-off-ticket \.pcard__ticket \{ display: none/.test(CSS),
    'retirer la colonne doit aussi ranger le bouton de la carte');

  // ALIGNEMENT. La carte est sa propre grille : une colonne dimensionnée par
  // son CONTENU décale toutes les autres d'une ligne à l'autre. La colonne
  // d'actions a donc une largeur arrêtée, et la place du ticket est tenue même
  // sur une ligne qui n'en a pas.
  assert.ok(/--pcard-actions: 200px;/.test(CSS), 'la colonne d’actions doit avoir une largeur fixe');
  assert.ok(!/grid-template-columns:[^;]*\bauto;/.test(CSS.match(/\.pcard \{[\s\S]*?\n\}/)[0]),
    'aucune piste `auto` dans la grille de la carte : elle dépendrait du contenu');
  assert.ok(/pcard__ticket pcard__ticket--vide/.test(APP),
    'une ligne sans ticket doit garder l’emplacement réservé');
  assert.ok(/body\.cards-off-ticket \.pcard \{ --pcard-actions: 148px; \}/.test(CSS),
    'ticket rangé : la colonne d’actions se resserre pour toutes les cartes ensemble');

  // UN SEUL APERÇU À LA FOIS. La fiche complète s'attend (un aller-retour
  // réseau) : au doigt on tape deux fois avant qu'elle n'arrive, et deux
  // aperçus s'empilaient — il fallait fermer deux fois pour revenir à la
  // grille. Le verrou se relâche à la fermeture ET si le chargement échoue,
  // sinon un réseau tombé condamnerait le bouton pour la journée.
  assert.ok(/if \(ticketOuvert\) return;\s*\n\s*ticketOuvert = true;/.test(APP));
  assert.ok(/fini = true;\s*\n\s*ticketOuvert = false;/.test(APP));

  // ET L'ÉCHEC SE DIT. Le verrou se relâchait bien, mais l'erreur repartait en
  // `throw` — or aucun appelant n'attend cette promesse (pastille du tableau,
  // pastille de la carte, bouton de la fiche sont tous des gestionnaires de
  // clic). Taper sur le ticket ne produisait alors RIEN du tout : ni papier, ni
  // message. On le rapporte.
  const ouvre = APP.match(/async function ouvrirTicket\(r\) \{[\s\S]*?\n\}/);
  assert.ok(ouvre, 'ouvrirTicket est introuvable');
  assert.ok(/catch \(err\) \{[\s\S]*?ticketOuvert = false;[\s\S]*?reportError\(err\);[\s\S]*?return;/.test(ouvre[0]),
    'un ticket qui ne peut pas s’ouvrir doit relâcher le verrou ET le dire');
  assert.ok(!/throw err;/.test(ouvre[0]), 'plus de promesse rejetée que personne n’attrape');

  // L'aperçu et l'impression partagent la MÊME feuille de style : ce qu'on voit
  // à l'écran est ce qui sort de l'imprimante.
  assert.ok(/s\.textContent = CSS_TICKET;/.test(APP));
  assert.ok(/style\.textContent = `@page\{margin:8mm\}body\{margin:0;background:#fff\}\$\{CSS_TICKET\}`/.test(APP));
  // Pas de `size` dans le @page du cadre d'impression : forcer un format de
  // 80 mm ferait mettre le ticket à l'échelle du A4 par le navigateur — un
  // ticket géant sur toute la largeur de la feuille.
  const regleImpression = APP.match(/style\.textContent = `(@page[^`]*)`/);
  assert.ok(regleImpression, 'la feuille du cadre d’impression est introuvable');
  assert.ok(!/size\s*:/.test(regleImpression[1]), `@page ne doit pas forcer de format : ${regleImpression[1]}`);

  // La recherche de la grille regarde aussi le numéro du ticket.
  assert.ok(/refsTicket\(r\)\.includes\(q\)/.test(APP));
  assert.ok(/function refsTicket\(r\)/.test(APP));

  // Les icônes de la barre d'actions sont DESSINÉES : `print`, `download`,
  // `content_copy` et `send` ne sont pas dans la police auto-hébergée, et un
  // nom absent s'affiche en texte, tronqué à sa première lettre par
  // `.material-symbols-outlined` (width: 1em; overflow: hidden).
  const LIGATURES = new Set(['add', 'apartment', 'arrow_forward', 'badge', 'block', 'bolt', 'call',
    'chat', 'check', 'close', 'contacts', 'dark_mode', 'dashboard', 'delete', 'draw', 'email',
    'event', 'expand_more', 'fullscreen', 'gavel', 'groups', 'help', 'home_pin', 'https', 'launch',
    'location_city', 'location_on', 'lock', 'login', 'logout', 'mail', 'markunread_mailbox',
    'message', 'open_in_new', 'overview', 'person', 'phone', 'place', 'point_of_sale', 'public',
    'receipt_long', 'request_quote', 'right_panel_close', 'room', 'search', 'settings',
    'shopping_cart', 'storefront', 'tag', 'tune', 'view_column', 'view_kanban', 'visibility',
    'work']);
  const DESSINS = new Set(Object.keys({
    imprimer: 1, telecharger: 1, dupliquer: 1, envoyer: 1, ticket: 1,
  }));
  for (const [, nom] of APP.matchAll(/ldActionBtn\('([a-z_]+)'/g)) {
    assert.ok(DESSINS.has(nom) || LIGATURES.has(nom),
      `ldActionBtn('${nom}') : ni dessin maison, ni glyphe de la police auto-hébergée`);
  }
  for (const cle of DESSINS) {
    assert.ok(new RegExp(`^\\s{2}${cle}: \\[`, 'm').test(APP), `LD_ICONES.${cle} manquant`);
  }

  // Hors ligne, un import qui échoue empêche TOUTE l'application de s'ouvrir :
  // le module doit partir avec la coquille.
  assert.ok(lire('sw.js').includes("'/ticket.js'"), 'ticket.js doit être dans la coquille du SW');
  assert.ok(lire('index.html').includes('modulepreload" href="ticket.js"'));

  console.log('✓ ticket : branché sur la fiche, sur la ligne, dans la coquille hors ligne OK');
  app.__server.close();
})().catch((e) => { console.error(e); process.exit(1); });
