'use strict';

// CE QU'IL Y A À FAIRE, EN UNE LIGNE (26/08/2026)
//
// Le chef d'atelier ouvrait le planning et lisait ça, dans une colonne large
// de deux cents pixels :
//
//   « ATELIER OLDA — RÉCAPITULATIF DE VENTE DIRECTE / Type de dossier : Vente
//     directe / Commande : 26.08.25-002 / Date de la vente : … / Article 1 —
//     Prix personnalisation : 0,00 € / Article 1 — Supplément express : … »
//
// Quarante lignes pour ne pas savoir ce qu'on produit. Ce fichier tient les
// quatre décisions qui remplacent ce pavé :
//
//   1. LE COMPTOIR ENVOIE DES FAITS SÉPARÉS, jamais une phrase : référence,
//      couleur, nombre par taille, largeur de logo par face.
//   2. LE SERVEUR LES RANGE PAR LIGNE (`fiche.prod`) et les fait voyager dans
//      la LISTE — sinon la carte reste muette. La colonne « Infos » redevient
//      une note libre.
//   3. LE PLANNING EN COMPOSE LE MÊME BLOC dans les deux vues.
//   4. CHACUN CHOISIT CE QU'IL VOIT, et le choix suit la PERSONNE : à
//      l'atelier le prix pollue la ligne, la largeur du dos est indispensable.
//
// Plus la reprise des dossiers déjà en base — on ne recopie que ce qui se
// relit exactement, jamais ce qu'on devine.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8');
const DEVIS = lire('public/comptoir/demande-devis.html');
const APP = lire('public/app.js');
const CSS = lire('public/styles.css');
const SERVEUR = lire('server.js');

function source(texte, nom, signature) {
  const re = new RegExp(`function ${nom}\\(${signature}\\)\\{[\\s\\S]*?\\n\\}`);
  const m = texte.match(re);
  assert.ok(m, `${nom} doit exister et se terminer par une accolade en colonne 0`);
  return m[0];
}

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

// ---------------------------------------------------------------------------
// 1. LE COMPTOIR — des faits séparés, pas une phrase
// ---------------------------------------------------------------------------
function prodDe(besoin) {
  const contexte = vm.createContext({
    TE: () => ({
      SIZE_KEYS: ['S', 'M', 'L', 'XL', 'XXL', 'other'],
      SIZE_LABELS: { S: 'S', M: 'M', L: 'L', XL: 'XL', XXL: '2XL', other: 'Autres' },
    }),
    txNum: (v) => Number(v) || 0,
    TX_LOGO_ORDRE: ['Coeur', 'Poitrine', 'Avant', 'Dos', 'Manche DR', 'Manche GA'],
    window: {},
    n: besoin,
  });
  vm.runInContext(`${source(DEVIS, 'prodDuBesoin', 'n')}\nglobalThis.__r = prodDuBesoin(n);`, contexte);
  // Le bac à sable a ses propres prototypes : sans ce passage par le texte,
  // `deepStrictEqual` refuse deux objets pourtant identiques.
  return JSON.parse(JSON.stringify(contexte.__r));
}

const BESOIN_TEXTILE = {
  category: 'Textile',
  label: 'T-shirt col rond NS300',
  qty: 30,
  requestedRef: 'NS300',
  color: 'Blanc',
  productionType: 'DTF',
  comment: 'Le client fournit le logo en PDF vectoriel.',
  textile: {
    sizes: { S: '8', M: '12', L: '10', XL: '', XXL: '', other: '' },
    // Le dos change de largeur d'une taille à l'autre, le coeur non : les deux
    // formes doivent sortir différemment.
    logo: { Dos: { S: 260, M: 280, L: 300 }, Coeur: { S: 60, M: 60, L: 60 } },
  },
};

const prod = prodDe(BESOIN_TEXTILE);
assert.strictEqual(prod.ref, 'NS300');
assert.strictEqual(prod.couleur, 'Blanc');
assert.strictEqual(prod.marquage, 'DTF');
// LE NOMBRE D'ABORD, PUIS LA TAILLE. C'est l'ordre des trois autres endroits
// qui les écrivent, et il n'y en a pas deux.
assert.deepStrictEqual(prod.tailles, [{ t: 'S', n: 8 }, { t: 'M', n: 12 }, { t: 'L', n: 10 }]);
// L'ORDRE DES FACES est celui de l'intitulé de marquage (Coeur avant Dos), pas
// celui du hasard des clés.
assert.deepStrictEqual(prod.logos, [
  { face: 'Coeur', mm: '60' },
  { face: 'Dos', mm: 'S 260/M 280/L 300' },
], 'une face d’une seule largeur donne un nombre ; une face qui varie garde ses tailles');
// Les tailles d'une MÊME face se séparent à la barre — le point médian sépare
// deux FACES sur la ligne du planning. Le même signe des deux côtés faisait
// lire « Dos S 260 · M 280 » comme deux faces.
assert.doesNotMatch(prod.logos[1].mm, / · /);

// Un besoin NON textile n'a ni tailles ni logos, et ce n'est pas une panne :
// il garde sa référence, sa couleur et sa technique.
const prodObjet = prodDe({ requestedRef: 'MUG-11', color: 'Blanc', productionType: 'Sublimation' });
assert.deepStrictEqual(prodObjet, { ref: 'MUG-11', couleur: 'Blanc', marquage: 'Sublimation', tailles: [], logos: [] });

// Une case de logo vide n'est pas un zéro : elle n'ouvre pas de face.
const prodSansLogo = prodDe({ requestedRef: 'K3025', textile: { sizes: { other: '20' }, logo: { Dos: {} } } });
assert.deepStrictEqual(prodSansLogo.logos, []);
assert.deepStrictEqual(prodSansLogo.tailles, [{ t: 'Autres', n: 20 }]);

// LA LIGNE ENVOYÉE AU PLANNING ne colle plus la matière, la couleur, la
// technique, les tailles et le détail textile bout à bout dans la note libre.
const envoi = DEVIS.match(/window\.besoinsPourPlanning=function\(\)\{[\s\S]*?\n  \};/);
assert.ok(envoi, 'besoinsPourPlanning doit exister');
assert.match(envoi[0], /prod:prodDuBesoin\(n\)/, 'la ligne porte les faits séparés');
assert.match(envoi[0], /detail:n\.comment\|\|''/, 'la note libre ne porte QUE ce que le client a précisé');
assert.doesNotMatch(envoi[0], /textileResume/, 'la phrase à rallonge ne part plus au planning');

// ---------------------------------------------------------------------------
// 2. LE SERVEUR — un `prod` par ligne, borné, et qui voyage dans la liste
// ---------------------------------------------------------------------------
assert.match(
  SERVEUR,
  /const FICHE_LISTE = \[[^\]]*'prod'/,
  'sans `prod` dans FICHE_LISTE, la carte du planning reste muette',
);

(async () => {
  process.env.PORT = '0';
  const app = require('../server');
  const { prodDuRecap, recapDeLaFiche } = require('../db');
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
  const liste = async () => (await call('GET', '/api/requests')).body;

  // --- Un dossier à DEUX articles : deux lignes, deux travaux différents ---
  const deux = await call('POST', '/api/comptoir/projet', {
    source: 'Demande de devis',
    ref: '26.08.26-101',
    client: 'Hôtel Esmeralda',
    clientObj: { type: 'Professionnel', name: 'Hôtel Esmeralda', company: 'Hôtel Esmeralda' },
    name: '50 pièces', responsible: 'Charlie', due: '2026-08-29', priority: '3',
    stage: 'demande', status: 'À chiffrer',
    comment: 'Le client fournit le logo en PDF vectoriel.',
    amount: null, quantity: 50,
    details: [['Type de dossier', 'Demande de devis']],
    recap: 'ATELIER OLDA — RÉCAPITULATIF DE DEMANDE\n\nType de dossier : Demande de devis',
    articles: [
      { label: 'T-shirt col rond NS300', qty: 30, detail: '', prod: prod },
      { label: 'Casquette K3025', qty: 20, detail: '',
        prod: { ref: 'K3025', couleur: 'Noir', marquage: 'DTF', tailles: [{ t: 'Autres', n: 20 }], logos: [{ face: 'Avant', mm: '90' }] } },
    ],
  });
  assert.strictEqual(deux.status, 201, JSON.stringify(deux.body));
  assert.strictEqual(deux.body.lot.total, 2);

  const rows = await liste();
  const parId = (id) => rows.find((r) => r.id === id);
  const l1 = parId(deux.body.lot.ids[0]);
  const l2 = parId(deux.body.lot.ids[1]);
  // CHAQUE LIGNE PORTE SON PROPRE TRAVAIL. Partagé, il annoncerait la même
  // référence et les mêmes tailles sur les deux — donc un t-shirt en 90 mm.
  assert.strictEqual(l1.fiche.prod.ref, 'NS300');
  assert.strictEqual(l2.fiche.prod.ref, 'K3025');
  assert.deepStrictEqual(l1.fiche.prod.logos, [
    { face: 'Coeur', mm: '60' }, { face: 'Dos', mm: 'S 260/M 280/L 300' },
  ]);
  assert.deepStrictEqual(l2.fiche.prod.tailles, [{ t: 'Autres', n: 20 }]);
  // LA COLONNE « INFOS » EST UNE NOTE LIBRE. Un article sans précision retombe
  // sur le commentaire du dossier, jamais sur le récapitulatif imprimé.
  assert.strictEqual(l1.description, 'Le client fournit le logo en PDF vectoriel.');
  assert.doesNotMatch(String(l1.description), /RÉCAPITULATIF/);

  // --- Un dossier d'UN SEUL article a droit à la même lecture ---
  const seul = await call('POST', '/api/comptoir/projet', {
    source: 'Demande de devis', ref: '26.08.26-102', client: 'Beach Bar',
    clientObj: { type: 'Professionnel', name: 'Beach Bar', company: 'Beach Bar' },
    name: '12 polos', responsible: 'Charlie', priority: '2',
    stage: 'demande', status: 'À chiffrer', comment: '', amount: null, quantity: 12,
    details: [['Type de dossier', 'Demande de devis']],
    recap: 'ATELIER OLDA — RÉCAPITULATIF DE DEMANDE\n\nType de dossier : Demande de devis',
    articles: [{ label: 'Polo K241', qty: 12, detail: '',
      prod: { ref: 'K241', couleur: 'Marine', marquage: 'Broderie', tailles: [{ t: 'M', n: 12 }], logos: [{ face: 'Coeur', mm: '55' }] } }],
  });
  const lSeule = parId(seul.body.id) || (await liste()).find((r) => r.id === seul.body.id);
  assert.strictEqual(lSeule.fiche.prod.ref, 'K241', 'un article unique n’a pas de lot, il a bien un travail');
  assert.strictEqual(lSeule.description, null, 'sans note de la vendeuse, la colonne Infos reste VIDE et prête à en recevoir une');

  // --- Un écran sans `prod` continue de passer, exactement comme avant ---
  const vente = await call('POST', '/api/comptoir/projet', {
    source: 'Vente directe', ref: '26.08.26-103', client: 'ATELIER OLDA Sarl',
    clientObj: { type: 'Professionnel', name: 'ATELIER OLDA Sarl', company: 'ATELIER OLDA Sarl' },
    name: '1 x Panneau signalisation', responsible: 'Mélina', priority: '1',
    stage: 'preparation', status: 'Préparation des produits', comment: '', amount: 1, quantity: 1,
    details: [['Type de dossier', 'Vente directe']],
    recap: 'ATELIER OLDA — RÉCAPITULATIF DE VENTE DIRECTE\n\nType de dossier : Vente directe',
    paiement: { modeLabel: 'Espèces', mode: 'especes', paye: true },
  });
  assert.strictEqual(vente.status, 201);
  const lVente = (await liste()).find((r) => r.id === vente.body.id);
  assert.strictEqual(lVente.fiche.prod, undefined, 'pas de travail décrit = pas de bloc, et surtout pas un bloc vide');

  // --- BORNAGE. `prod` repart vers chaque poste à chaque rafraîchissement ---
  const hostile = await call('POST', '/api/comptoir/projet', {
    source: 'Demande de devis', ref: '26.08.26-104', client: 'Test',
    clientObj: { type: 'Professionnel', name: 'Test', company: 'Test' },
    name: 'Test', responsible: 'Charlie', priority: '1',
    stage: 'demande', status: 'À chiffrer', comment: '', amount: null, quantity: 1,
    details: [['Type de dossier', 'Demande de devis']],
    articles: [{ label: 'Test', qty: 1,
      prod: {
        ref: 'R'.repeat(500),
        couleur: '',
        marquage: '',
        tailles: Array.from({ length: 40 }, (_, i) => ({ t: `T${i}`, n: i + 1 })),
        logos: [{ face: 'F'.repeat(500), mm: 'M'.repeat(500) }, { face: '', mm: '10' }],
      } }],
  });
  const lHostile = (await liste()).find((r) => r.id === hostile.body.id);
  assert.ok(lHostile.fiche.prod.ref.length <= 60, 'une référence de 500 signes n’est pas une référence');
  assert.strictEqual(lHostile.fiche.prod.tailles.length, 12, '6 tailles, 6 emplacements : au-delà, ce n’est plus une saisie');
  assert.strictEqual(lHostile.fiche.prod.logos.length, 1, 'une face sans nom ne décrit rien');
  assert.ok(lHostile.fiche.prod.logos[0].mm.length <= 120);

  // -------------------------------------------------------------------------
  // 3. LA REPRISE DES DOSSIERS D'AVANT — on recopie, on ne devine pas
  // -------------------------------------------------------------------------
  const ficheAncienne = {
    kind: 'comptoir-v17',
    source: 'Demande de devis',
    commentaire: 'Le client passe jeudi.',
    details: [
      { k: 'Type de dossier', v: 'Demande de devis' },
      { k: 'Besoin 1 — Désignation', v: 'T-shirt col rond NS300' },
      { k: 'Besoin 1 — Référence', v: 'NS300' },
      { k: 'Besoin 1 — Couleur', v: 'Blanc' },
      { k: 'Besoin 1 — Production', v: 'DTF' },
      { k: 'Besoin 1 — Détail textile', v: 'Tailles : 8 × S · 12 × M • Marquage Coeur + Dos (Noir) • Transport Chronopost • Taille du logo (mm) : Coeur S 60 · M 60 / Dos S 260 · M 280' },
      { k: 'Besoin 1 — Informations importantes', v: '—' },
    ],
  };
  const repris = prodDuRecap(ficheAncienne);
  assert.strictEqual(repris.ref, 'NS300');
  assert.strictEqual(repris.couleur, 'Blanc');
  assert.deepStrictEqual(repris.tailles, [{ t: 'S', n: 8 }, { t: 'M', n: 12 }]);
  // La MÊME sortie que le comptoir produit aujourd'hui : une face d'une seule
  // largeur donne un nombre, une face qui varie garde ses tailles.
  assert.deepStrictEqual(repris.logos, [{ face: 'Coeur', mm: '60' }, { face: 'Dos', mm: 'S 260/M 280' }]);

  // La ligne 2 d'un lot lit SES rangées à elle, pas celles de la première.
  const rang2 = prodDuRecap({
    ...ficheAncienne,
    lot: { rang: 2, total: 2 },
    details: ficheAncienne.details.concat([
      { k: 'Besoin 2 — Référence', v: 'K3025' },
      { k: 'Besoin 2 — Couleur', v: 'Noir' },
    ]),
  });
  assert.strictEqual(rang2.ref, 'K3025');

  // CE QUI NE SE RELIT PAS EXACTEMENT EST ABANDONNÉ. Une série de tailles
  // amputée d'une taille est pire qu'une série absente : elle se croit complète.
  const douteux = prodDuRecap({
    ...ficheAncienne,
    details: [
      { k: 'Besoin 1 — Référence', v: 'NS300' },
      { k: 'Besoin 1 — Détail textile', v: 'Tailles : 8 × S · douze × M • Taille du logo (mm) : Dos gros' },
    ],
  });
  assert.deepStrictEqual(douteux.tailles, [], 'une rangée illisible fait abandonner la série entière');
  assert.deepStrictEqual(douteux.logos, [], 'une largeur qui n’est pas un nombre n’est pas une largeur');
  assert.strictEqual(douteux.ref, 'NS300', 'ce qui se relit, lui, est bien repris');

  // Un dossier qui ne décrit aucun travail ne reçoit pas de bloc vide.
  assert.strictEqual(prodDuRecap({ source: 'Vente directe', details: [{ k: 'Type de dossier', v: 'Vente directe' }] }), null);

  // Le récapitulatif se RECOMPOSE à l'identique : c'est ce qui autorise à le
  // retirer de la colonne « Infos » — on ne jette que ce qu'on sait réécrire.
  assert.strictEqual(
    recapDeLaFiche({ source: 'Vente directe', details: [{ k: 'Commande', v: '26.07.31-001' }] }),
    'ATELIER OLDA — RÉCAPITULATIF DE VENTE DIRECTE\n\nCommande : 26.07.31-001',
  );
  assert.match(recapDeLaFiche(ficheAncienne), /^ATELIER OLDA — RÉCAPITULATIF DE DEMANDE\n\n/);

  // --- LA MIGRATION ELLE-MÊME, sur de vraies lignes -----------------------
  // Deux dossiers d'avant : l'un intact (sa description EST le récapitulatif),
  // l'autre auquel quelqu'un a ajouté un mot à la main. Le second ne doit PAS
  // bouger — on ne jette pas du travail pour ranger.
  const { pool, reprendreProdDesLignes, libererLaColonneInfos } = require('../db');
  const poser = async (fiche, description) => {
    const { rows: r } = await pool.query(
      `INSERT INTO requests (stage, order_kind, responsable, priority, client_type,
         billing_company, product, description, fiche)
       VALUES ('a_trier', 'demande', 'Charlie', 1, 'pro', $1, $2, $3, $4) RETURNING id`,
      ['Dossier d’avant', 'T-shirt col rond NS300', description, JSON.stringify(fiche)],
    );
    return r[0].id;
  };
  const intact = await poser(ficheAncienne, recapDeLaFiche(ficheAncienne));
  const retouche = await poser(ficheAncienne, `${recapDeLaFiche(ficheAncienne)}\n\nVoir avec Loïc avant de lancer.`);

  // On relève les gardes : chacune a la SIENNE (deux incidents réels sont
  // venus d'une garde partagée), et elles se rejouent indépendamment.
  await pool.query("DELETE FROM app_meta WHERE key IN ('prod_des_lignes_v1', 'infos_sans_recap_v1')");
  await reprendreProdDesLignes();
  await libererLaColonneInfos();
  // Et la garde tient : rejouées, elles ne repassent pas sur les lignes.
  const avantRejeu = (await pool.query("SELECT value FROM app_meta WHERE key = 'infos_sans_recap_v1'")).rows[0].value;
  await libererLaColonneInfos();
  assert.strictEqual(
    (await pool.query("SELECT value FROM app_meta WHERE key = 'infos_sans_recap_v1'")).rows[0].value,
    avantRejeu, 'une migration gardée ne se rejoue pas',
  );

  const relire = async (id) => (await pool.query('SELECT description, fiche FROM requests WHERE id = $1', [id])).rows[0];
  const fIntact = await relire(intact);
  const ficheIntact = typeof fIntact.fiche === 'string' ? JSON.parse(fIntact.fiche) : fIntact.fiche;
  assert.strictEqual(ficheIntact.prod.ref, 'NS300', 'le dossier d’avant a rattrapé sa ligne de production');
  assert.deepStrictEqual(ficheIntact.prod.tailles, [{ t: 'S', n: 8 }, { t: 'M', n: 12 }]);
  assert.strictEqual(fIntact.description, 'Le client passe jeudi.',
    'la note de la vendeuse reprend la place du récapitulatif');

  const fRetouche = await relire(retouche);
  assert.match(fRetouche.description, /Voir avec Loïc avant de lancer\./,
    'une description retouchée à la main n’est PAS du récapitulatif : on n’y touche pas');
  assert.match(fRetouche.description, /RÉCAPITULATIF/,
    'et on ne la coupe pas non plus en deux — elle reste telle qu’elle a été laissée');

  // -------------------------------------------------------------------------
  // 4. LE PLANNING — le même bloc dans les deux vues, choisi par la personne
  // -------------------------------------------------------------------------
  // UN SEUL COMPOSANT. Deux vues à un clic l'une de l'autre doivent donner le
  // même bloc, pas deux qui se ressemblent.
  assert.ok(/function blocProduction\(r\)/.test(APP), 'le bloc de production est une fonction unique');
  const carte = APP.match(/function buildCard\(r\)[\s\S]*?\n\}/);
  assert.ok(carte && /blocProduction\(r\)/.test(carte[0]), 'la carte porte le bloc');
  const cellule = APP.match(/function cellInfos\(r\)[\s\S]*?\n\}/);
  assert.ok(cellule && /blocProduction\(r\)/.test(cellule[0]), 'la cellule Infos porte LE MÊME bloc');

  // TROIS FAITS, TROIS CASES. Chacun décide de ce qu'il voit.
  for (const cle of ['prod_ref', 'prod_tailles', 'prod_logos']) {
    assert.ok(new RegExp(`key: '${cle}'[^}]*surCarte: true`).test(APP),
      `${cle} doit exister dans le rail ET vivre dans les deux vues`);
  }
  // LE PRIX AUSSI : à l'atelier il n'apprend rien et prend la place de ce qu'on
  // cherche. Il vit dans les deux vues, le décocher ne doit pas rappeler le
  // tableau complet.
  assert.match(APP, /key: 'price',\s*label: 'Prix TTC', surCarte: true/);
  // MAIS LE BLOC RESTE : il porte les référents, et la carte est une grille à
  // cinq colonnes — en retirer un décalerait les actions de toutes les cartes.
  assert.match(APP, /pcardBloc\('Référent', refs, nomRef\)/,
    'sans prix, le bloc change d’intitulé ; il ne disparaît pas');

  // COCHER DOIT SE VOIR. Ces cases ne changent pas de vue : sans invalidation
  // la case se coche et rien ne bouge à l'écran.
  assert.match(APP, /COLS_REDESSINENT\.has\(col\.key\)\) invalidateRowCache\(null\)/);

  // LE CHOIX SUIT LA PERSONNE, pas l'appareil : le chef d'atelier et la
  // boutique se nomment tour à tour sur le même PC.
  assert.match(APP, /const colsKey = \(\) => \{[\s\S]*?lirePoste\(\)/);
  assert.match(APP, /for \(const cle of \[colsKey\(\), COLS_KEY\]\)/,
    'qui n’a pas encore choisi repart du réglage de la machine, pas de zéro');
  // Le réglage commun rangeait « Prix TTC » PAR DÉFAUT — ça voulait dire « pas
  // de colonne dans le tableau », pas « pas de montant sur la carte ». Le
  // relire tel quel effacerait le TTC de toutes les cartes de tous les postes.
  assert.match(APP, /cle === COLS_KEY \? garde\.filter\(\(k\) => k !== 'price'\) : garde/,
    'le prix repart allumé quand on hérite du réglage de la machine');
  assert.match(APP, /addEventListener\('olda:poste'/,
    'changer de personne change l’écran tout de suite, pas au prochain rechargement');

  // -------------------------------------------------------------------------
  // 5. LA MISE EN PAGE — deux colonnes ARRÊTÉES, et deux colonnes qui existent
  // -------------------------------------------------------------------------
  // L'intitulé a une largeur FIXE : en `max-content`, une carte qui ne montre
  // que « TAILLES » et sa voisine qui montre « RÉF. » n'alignent pas leurs
  // valeurs, et la file se lit en escalier.
  assert.match(CSS, /\.prod-fiche \{[\s\S]*?grid-template-columns: var\(--prod-cle\) minmax\(0, 1fr\)/);
  assert.match(CSS, /--prod-cle: \d+px;/);
  // 17 pour ce qui se lit, 14 pour l'intitulé : l'échelle de toute l'application.
  assert.match(CSS, /\.prod-fiche__val \{[\s\S]*?font-size: var\(--taille-texte\)/);
  assert.match(CSS, /\.prod-fiche__cle \{[\s\S]*?font-size: var\(--taille-note\)/);

  // « DESCRIPTION » ET « INFOS » ONT UNE LARGEUR. Elles étaient les seules à ne
  // pas en avoir, et `table-layout: fixed` ne lit QUE la première rangée : sur
  // les étapes qui en ouvrent une par une BANNIÈRE de lot, elles tombaient à
  // 7 px et leur contenu se déroulait sur 1 200 px de haut.
  assert.match(CSS, /\.col-product \{ width: 220px; \}/);
  assert.match(CSS, /\.col-infos \{ width: 260px; \}/);
  // COL_DEFAULTS se dit « miroir des .col-* du CSS » : qu'il le soit.
  const defauts = APP.match(/const COL_DEFAULTS = \{[\s\S]*?\};/)[0];
  assert.match(defauts, /product: 220/);
  assert.match(defauts, /description: 260/);

  console.log('✓ ligne de production : des faits séparés du comptoir à la carte, choisis par chacun');
  app.__server.close();
})().catch((e) => { console.error(e); process.exit(1); });
