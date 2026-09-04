'use strict';

// CE QUE LA VENDEUSE TAPE ARRIVE JUSQU'AU DOSSIER.
// ===========================================================================
// Elle remplit six cases de taille, ouvre des bulles pour un 3XL ou un enfant,
// écrit « Coeur, Dos » dans les faces — et rien de tout ça ne parvenait au
// dossier. Les deux écrans flash n'envoyaient que quatre champs plats :
// référence, couleur, marquage, encre.
//
// Le détail survivait ailleurs : sur le PAPIER (`devis.lignes[].tailles`, en
// texte, « 12 × M · 18 × L ») et dans la facture archivée. Jamais dans
// `fiche.prod` — la seule forme que la fiche atelier, le ticket, le bon de
// commande et le BAT sachent lire. Mesuré en production le 29/08 :
// `fiche.prod` présent sur **0 dossier de 187**.
//
// CE FICHIER TIENT LES DEUX MOITIÉS :
//   1. LA TRADUCTION est pure et vit dans `devis.js`, le module que les DEUX
//      écrans importent déjà. Écrite deux fois, elle deviendrait deux
//      traductions le jour où l'une gagne une taille — et cet écart-là ne se
//      voit pas en relisant un écran, seulement en comparant les deux.
//   2. LE VOYAGE : ce que l'écran envoie ressort bien du serveur, sur CHAQUE
//      ligne d'une vente à plusieurs articles.
//
// ⚠ ET IL TIENT UNE NON-RÉGRESSION QUI COÛTE PLUS CHER QUE LE RESTE : remplir
// `prod.tailles` ne doit JAMAIS faire bouger un prix déjà annoncé au client.
// Le chiffrage d'une vente flash est « unitaire » et suit la QUANTITÉ ; c'est
// la grille de tailles qui commande ailleurs. Les deux chemins se croisent
// dans `retarifer`, et c'est exactement le genre d'endroit où un champ
// nouvellement rempli change un montant sans que personne l'ait demandé.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { chargerPapier } = require('./socle-papier');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const DEVIS = lire('public/devis.js');
const VENTE = lire('public/vente-flash.js');
const DEVIS_FLASH = lire('public/devis-flash.js');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

// ---------------------------------------------------------------------------
// 1. LA TRADUCTION, HORS NAVIGATEUR
// ---------------------------------------------------------------------------
// `devis.js` est un module ES du navigateur et le dépôt est en CommonJS : on
// l'évalue dans le bac à sable des papiers (`chargerPapier`), qui colle ses
// socles devant et retire les lignes d'import — exactement ce que fait le
// navigateur. C'est le VRAI source qui est évalué, pas une copie.
(async () => {
  const bac = chargerPapier('devis.js', ['prodDeLigne', 'TAILLES']);
  // ⚠ LE BAC EST UN AUTRE MONDE. Un tableau qui en sort n'a pas le
  // `Array.prototype` d'ici, et `deepStrictEqual` compare les prototypes : la
  // comparaison échoue sur des valeurs pourtant identiques. On rapatrie donc ce
  // qu'on compare — c'est aussi ce que fait le réseau, qui est le vrai chemin
  // de cette donnée.
  const clair = (v) => JSON.parse(JSON.stringify(v));
  const prodDeLigne = (l) => clair(bac.prodDeLigne(l));
  const TAILLES = clair(bac.TAILLES);

  assert.deepStrictEqual(TAILLES, ['XS', 'S', 'M', 'L', 'XL', '2XL'],
    'les six tailles, dans l’ordre où elles se lisent');

  // --- les cases, puis les bulles ------------------------------------------
  const t = prodDeLigne({
    reference: 'K3025', couleur: 'Light Olive Green',
    marquage: 'Coeur + Dos', encre: 'Blanc',
    parTaille: { M: 12, L: 18, XS: 0 },
    taillesLibres: [{ nom: '3XL', qte: 4 }, { nom: '', qte: 9 }, { nom: '4XL', qte: 0 }],
    faces: 'Coeur, Dos',
  });
  assert.deepStrictEqual(t.tailles, [{ t: 'M', n: 12 }, { t: 'L', n: 18 }, { t: '3XL', n: 4 }],
    'les cases dans l’ordre du tableau, puis les bulles dans l’ordre où on les a ouvertes');
  assert.deepStrictEqual(t.logos, [{ face: 'Coeur' }, { face: 'Dos' }],
    'deux faces nommées, et aucune cote inventée — le comptoir ne mesure pas');
  assert.strictEqual(t.ref, 'K3025');
  assert.strictEqual(t.encre, 'Blanc', 'l’encre est la couleur du MARQUAGE, pas celle du vêtement');

  // UNE CASE À ZÉRO N'EST PAS UNE TAILLE. C'est la même règle que « pas de
  // prix n'est pas prix zéro » : une case qu'on n'a pas remplie ne doit pas
  // arriver à l'atelier comme une commande de zéro pièce.
  assert.ok(!t.tailles.some((x) => x.n === 0), 'une case à zéro ne descend pas au dossier');
  assert.ok(!t.tailles.some((x) => !x.t), 'une bulle sans nom non plus');

  // --- une tasse s'écrit toute seule, avec des consignes -------------------
  const tasse = prodDeLigne({
    reference: 'TC 01', couleur: 'Rouge / Blanc',
    faces: 'Face 1 : Logo client · Dessous : Merci · BAT',
  });
  assert.deepStrictEqual(tasse.logos, [
    { face: 'Face 1', quoi: 'Logo client' },
    { face: 'Dessous', quoi: 'Merci' },
    { face: 'BAT' },
  ], 'une zone porte une CONSIGNE quand il y en a une — « dessus c’est pas des mm, c’est quoi graver »');
  // `quoi` N'EXISTE QUE S'IL EXISTE : cette structure repart vers chaque poste
  // à chaque rafraîchissement du planning.
  assert.ok(!('quoi' in tasse.logos[2]), 'une face sans consigne ne porte pas un « quoi » vide');

  // --- une ligne de transport ne décrit aucune production ------------------
  const rien = prodDeLigne({ designation: 'Transport', simple: true });
  assert.deepStrictEqual(rien.tailles, []);
  assert.deepStrictEqual(rien.logos, []);
  assert.strictEqual(rien.ref, '', 'rien à produire : c’est le serveur qui décidera d’écrire ou non');

  // --- on n'explose sur rien ----------------------------------------------
  for (const cas of [null, undefined, {}, { parTaille: 'oui', taillesLibres: 'non', faces: 42 }]) {
    const p = prodDeLigne(cas);
    assert.ok(Array.isArray(p.tailles) && Array.isArray(p.logos),
      `une ligne mal formée rend des listes vides, pas une erreur : ${JSON.stringify(cas)}`);
  }

  // -------------------------------------------------------------------------
  // 2. UNE SEULE ÉCRITURE, POUR LES DEUX ÉCRANS
  // -------------------------------------------------------------------------
  assert.ok(/export const TAILLES = \[/.test(DEVIS) && /export function prodDeLigne\(/.test(DEVIS),
    'la liste et la traduction vivent dans le module que les deux écrans importent');
  for (const [nom, src] of [['vente flash', VENTE], ['devis flash', DEVIS_FLASH]]) {
    assert.ok(/TAILLES, prodDeLigne,/.test(src), `${nom} les importe`);
    assert.ok(!/const TAILLES = \[/.test(src), `${nom} ne redéclare pas la liste`);
    assert.ok(/prodDeLigne\(/.test(src), `${nom} s’en sert vraiment`);
  }
  // Les entrailles restent dedans : un export de plus est une surface de plus.
  assert.ok(!/export function (taillesDeLigne|facesDeLigne)/.test(DEVIS),
    'les deux moitiés de la traduction ne sont pas exportées — on les atteint par prodDeLigne');

  // -------------------------------------------------------------------------
  // 3. LE VOYAGE JUSQU'AU DOSSIER
  // -------------------------------------------------------------------------
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
    const txt = res.status === 204 ? '' : await res.text();
    let corps = null;
    try { corps = txt ? JSON.parse(txt) : null; } catch (_) { corps = txt; }
    return { status: res.status, body: corps };
  };
  const ligneDe = async (id) => (await call('GET', `/api/requests/${id}`)).body;

  // --- UNE VENTE À DEUX ARTICLES : DEUX LIGNES, CHACUNE LA SIENNE ----------
  // C'est le cas qui compte. Une seule ligne masquerait le vrai risque : que
  // les deux articles se retrouvent avec la production du premier.
  const vente = await call('POST', '/api/comptoir/projet', {
    source: 'Vente directe',
    clientObj: { name: 'HOTEL DES TAILLES', company: 'HOTEL DES TAILLES', type: 'Professionnel' },
    amount: 900, name: '2 articles',
    articles: [
      {
        label: 'T-shirt unisexe léger Pro 145 g', qty: 30, amount: 600,
        prod: prodDeLigne({
          reference: 'K3025', couleur: 'Light Olive Green',
          marquage: 'Coeur + Dos', encre: 'Blanc',
          parTaille: { M: 12, L: 18 }, taillesLibres: [], faces: 'Coeur, Dos',
        }),
        chiffrage: { moteur: 'unitaire', unitTTC: 20, rate: 0 },
      },
      {
        label: 'Casquette brodée', qty: 10, amount: 300,
        prod: prodDeLigne({
          reference: 'KP035', couleur: 'Navy', marquage: 'Avant', encre: 'Or',
          parTaille: {}, taillesLibres: [{ nom: 'Unique', qte: 10 }], faces: 'Avant',
        }),
        chiffrage: { moteur: 'unitaire', unitTTC: 30, rate: 0 },
      },
    ],
    paiement: { mode: 'cb' },
  });
  assert.strictEqual(vente.status, 201, `vente créée : ${JSON.stringify(vente.body)}`);

  const toutes = (await call('GET', '/api/requests')).body;
  const liste = Array.isArray(toutes) ? toutes : (Object.values(toutes).find(Array.isArray) || []);
  const duDossier = liste.filter((r) => r.billing_company === 'HOTEL DES TAILLES');
  assert.strictEqual(duDossier.length, 2, 'un panier de deux articles fait deux lignes de production');

  const tshirt = duDossier.find((r) => (r.fiche.prod || {}).ref === 'K3025');
  const casquette = duDossier.find((r) => (r.fiche.prod || {}).ref === 'KP035');
  assert.ok(tshirt && casquette, 'chaque ligne porte SA référence, pas celle de sa voisine');
  assert.deepStrictEqual(tshirt.fiche.prod.tailles, [{ t: 'M', n: 12 }, { t: 'L', n: 18 }],
    'les douze M et les dix-huit L sont arrivés jusqu’au dossier');
  assert.deepStrictEqual(tshirt.fiche.prod.logos.map((z) => z.face), ['Coeur', 'Dos'],
    'les deux faces à marquer aussi');
  assert.strictEqual(tshirt.fiche.prod.encre, 'Blanc');
  assert.deepStrictEqual(casquette.fiche.prod.tailles, [{ t: 'Unique', n: 10 }],
    'une bulle créée à la main voyage comme une case du tableau');

  // --- LE PRIX NE BOUGE PAS PARCE QUE LES TAILLES SONT LÀ ------------------
  // La non-régression qui coûte le plus cher. `retarifer` ne se déclenche que
  // sur une correction de la fiche ; sur un chiffrage « unitaire » il suit la
  // QUANTITÉ, jamais la grille de tailles. Remplir `prod.tailles` ne doit donc
  // rien changer — on le VÉRIFIE plutôt que de le déduire.
  const avant = (await ligneDe(tshirt.id)).project_value;
  const patch = await call('PATCH', `/api/requests/${tshirt.id}/fiche`, {
    prod: { tailles: [{ t: 'M', n: 12 }, { t: 'L', n: 18 }] },
  });
  assert.strictEqual(patch.status, 200, `la fiche se corrige : ${JSON.stringify(patch.body)}`);
  assert.strictEqual((await ligneDe(tshirt.id)).project_value, avant,
    'corriger les tailles à l’identique ne retarife rien — un prix annoncé au client ne bouge pas tout seul');

  // --- UN DEVIS À UN SEUL ARTICLE PORTE SA PRODUCTION ----------------------
  const unSeul = prodDeLigne({
    reference: 'NS300', couleur: 'Ocean Blue', marquage: 'Poitrine', encre: 'Noir',
    parTaille: { S: 5, M: 5 }, taillesLibres: [], faces: 'Poitrine',
  });
  const devis1 = await call('POST', '/api/devis', {
    client: { nom: 'ASSOCIATION DU PORT' }, jour: '2026-09-04', ttc: 250,
    lignes: [{ designation: 'T-shirt bio léger', quantite: 10, unitaireHt: 24, totalHt: 240 }],
    prod: [unSeul],
  });
  assert.strictEqual(devis1.status, 201, `devis créé : ${JSON.stringify(devis1.body)}`);
  const lDevis = await ligneDe(devis1.body.id);
  assert.deepStrictEqual(lDevis.fiche.prod.tailles, [{ t: 'S', n: 5 }, { t: 'M', n: 5 }],
    'un devis à UN article pose sa production sur la ligne — la fiche atelier n’est plus vide');
  assert.strictEqual(lDevis.fiche.prod.ref, 'NS300');

  // --- UN DEVIS À PLUSIEURS ARTICLES : UNE LIGNE PAR ARTICLE --------------
  // Depuis le lot 2, un devis découpe comme une vente : chaque article a SA
  // ligne, donc SA production. La réserve du lot 1 (« à plusieurs sur une seule
  // ligne, on n'écrit rien ») n'a plus d'objet — il n'y a plus de ligne qui
  // porterait trois articles.
  const troisProd = [
    prodDeLigne({ reference: 'NS300', couleur: 'Ocean Blue', parTaille: { S: 30 }, faces: 'Poitrine' }),
    prodDeLigne({ reference: 'KP035', couleur: 'Navy', taillesLibres: [{ nom: 'Unique', qte: 10 }], faces: 'Avant' }),
    prodDeLigne({ reference: 'SAC01', couleur: 'Naturel', taillesLibres: [{ nom: 'Unique', qte: 10 }], faces: 'Recto' }),
  ];
  const devis3 = await call('POST', '/api/devis', {
    client: { nom: 'HOTEL TROIS ARTICLES' }, jour: '2026-09-04', ttc: 900,
    lignes: [
      { designation: 'T-shirts', quantite: 30, unitaireHt: 20, totalHt: 600 },
      { designation: 'Casquettes', quantite: 10, unitaireHt: 15, totalHt: 150 },
      { designation: 'Sacs', quantite: 10, unitaireHt: 15, totalHt: 150 },
    ],
    prod: troisProd,
  });
  assert.strictEqual(devis3.status, 201);
  assert.strictEqual(devis3.body.lot.total, 3, 'trois articles font trois lignes');

  const trois = await Promise.all(devis3.body.lot.ids.map(ligneDe));
  assert.deepStrictEqual(trois.map((r) => r.product), ['T-shirts', 'Casquettes', 'Sacs'],
    'chaque ligne porte SA désignation, pas « T-shirts + 2 autres »');
  assert.deepStrictEqual(trois.map((r) => r.fiche.prod.ref), ['NS300', 'KP035', 'SAC01'],
    'et SA production — trois références, trois séries de tailles');
  assert.deepStrictEqual(trois.map((r) => r.fiche.devisArticle), [0, 1, 2],
    'le rang dit quelle ligne du devis cette ligne du planning représente');

  console.log('✓ ce que la vendeuse tape arrive : tailles, bulles et faces jusqu’au dossier, sans toucher au prix');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
