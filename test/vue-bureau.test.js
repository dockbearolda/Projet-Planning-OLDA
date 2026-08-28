'use strict';

// ===========================================================================
// LA VUE BUREAU — et la frontière avec le papier de l'atelier
// ===========================================================================
// DEUX PAPIERS, DEUX MÉTIERS, UNE SEULE LIGNE :
//   · le TICKET part à l'établi et ne porte AUCUN argent — l'atelier n'en fait
//     rien, et une feuille sur un plan de travail n'a pas à annoncer ce que le
//     client a payé ;
//   · le BON DE COMMANDE est le document du bureau : coordonnées complètes,
//     prix unitaire, HT, taxe, TTC, règlement, coût de revient, marge, note.
//
// Ce fichier tient les six choses qui casseraient en silence.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { chargerPapier } = require('./socle-papier.js');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8');
const SRC = lire('public/bureau.js');

// On charge le VRAI source (module ES du navigateur) dans un bac à sable —
// même technique que pour le ticket : `import()` d'un `.js` sans
// « type: module » au package le lirait comme du CommonJS.
const bac = chargerPapier('bureau.js',
  ['modeleBureau', 'bureauTexte', 'dessinerBureau', 'CSS_BUREAU']);

(async () => {
  const { modeleBureau, bureauTexte, CSS_BUREAU, dessinerBureau } = bac;

  // --- 1. LA FEUILLE EST AUTONOME ------------------------------------------
  // Le cadre d'impression ne charge QUE cette chaîne : un jeton de charte.css y
  // vaut la chaîne vide, donc le rembourrage tombe à zéro SUR LE PAPIER et
  // nulle part ailleurs — l'aperçu, lui, a la charte et reste impeccable.
  const etrangers = [...new Set(
    (CSS_BUREAU.match(/var\(\s*(--[a-z0-9-]+)/gi) || [])
      .map((m) => m.replace(/var\(\s*/i, ''))
      // `--pap-` est le SOCLE PARTAGÉ avec le ticket (papier.js) : l'encre, le
      // filet, la marge de feuille et la taille des intitulés, écrits UNE fois
      // pour les deux papiers depuis le 28/08. Ils sont posés sur la feuille
      // elle-même, donc présents dans le cadre d'impression — ce ne sont pas
      // des jetons de `charte.css`, qui eux vaudraient VIDE au papier.
      .filter((j) => !j.startsWith('--bu-') && !j.startsWith('--pap-')),
  )];
  assert.strictEqual(etrangers.join(', '), '',
    'aucun jeton étranger dans la feuille : au papier il vaudrait VIDE');
  // La feuille est un littéral gabarit : un accent grave dans un commentaire le
  // TERMINE, `node --check` passe, et l'écran s'ouvre NU.
  assert.ok(!CSS_BUREAU.includes(String.fromCharCode(96)),
    'aucun accent grave dans la feuille');
  assert.ok(/width:\s*210mm/.test(CSS_BUREAU) && /min-height:\s*297mm/.test(CSS_BUREAU),
    'la feuille fait un A4 par construction');

  // --- 2. UN DOSSIER RÉEL --------------------------------------------------
  const ligne = {
    id: 'x', billing_company: 'Blue Martini', client_type: 'pro',
    contact_referent: 'Sarah', contact_phone: '0690112233', contact_email: 'c@bm.fr',
    responsable: 'Mélina', deadline: '2026-09-04', created_at: '2026-08-27T12:00:00Z',
    description: 'Prévenir avant de couper.',
    project_value: 288, cout_revient: 120, paye: true, paiement_mode: 'cb',
    acompte_demande: false, acompte_verse: false, acompte_montant: null,
    fiche: {
      source: 'Vente directe', ref: 'BUR-1', creeLe: '2026-08-27T12:00:00Z',
      heureSouhaitee: '15:00', production: 'UV',
      paiement: { modeLabel: 'Carte bancaire', mode: 'cb', paye: true },
      client: [['Client', 'Blue Martini'], ['E-mail', 'c@bm.fr'], ['Adresse', '12 rue de la Liberté']]
        .map(([k, v]) => ({ k, v })),
      details: [
        ['Type de dossier', 'Vente directe'], ['Client', 'Blue Martini'],
        ['Canal d’entrée', 'Boutique'], ['Total TTC', '288,00 €'],
        ['Article 1 — Désignation', 'Tasse céramique 350 ml TC 06'],
        ['Article 1 — Quantité', '24'], ['Article 1 — Couleur', 'Noir / Blanc'],
        ['Article 1 — Prix unitaire HT', '11,54 €'], ['Article 1 — Total TTC', '288,00 €'],
      ].map(([k, v]) => ({ k, v })),
    },
  };
  const t = modeleBureau(ligne);
  assert.strictEqual(t.titre, 'Bon de commande');
  assert.strictEqual(t.ref, 'BUR-1');
  assert.strictEqual(t.articles.length, 1);
  assert.strictEqual(t.articles[0].unitaire, '11,54 €');

  // L'ARGENT, calculé et non recopié : le HT ne se stocke jamais, il se déduit
  // du TTC et du taux du moment — figé, il mentirait le jour où le taux change.
  assert.strictEqual(t.argent.ttc, 288);
  assert.strictEqual(t.argent.ht, 276.92);
  assert.strictEqual(t.argent.taxe, 11.08);
  assert.strictEqual(t.argent.revient, 120);
  assert.strictEqual(t.argent.marge, 156.92, 'la marge se recalcule du prix et du revient');
  assert.strictEqual(t.argent.paye, true);
  assert.strictEqual(t.argent.mode, 'Carte bancaire');

  // --- 3. UN NOMBRE ABSENT N'EST PAS ZÉRO ----------------------------------
  // `Number(null)` vaut 0 : un coût de revient jamais renseigné donnait une
  // marge égale au prix de vente — une affaire à 100 % de marge, sur le
  // document qui sert à décider.
  const sansRevient = modeleBureau({ ...ligne, cout_revient: null });
  assert.strictEqual(sansRevient.argent.revient, null, '« on ne sait pas » n’est pas « 0 € »');
  assert.strictEqual(sansRevient.argent.marge, null, 'et sans revient, aucune marge inventée');
  // Ni « pas encore chiffré » n'est « gratuit ».
  const sansPrix = modeleBureau({ ...ligne, project_value: null });
  assert.strictEqual(sansPrix.argent.ttc, null);
  assert.match(bureauTexte(sansPrix), /Total : à chiffrer/,
    'un dossier non chiffré l’écrit, il n’imprime pas 0,00 € sur un document qui sert à facturer');

  // --- 4. UNE DEMANDE N'EST PAS UNE COMMANDE -------------------------------
  const demande = modeleBureau({
    ...ligne, order_kind: 'demande', project_value: null,
    fiche: { ...ligne.fiche, source: 'Demande de devis' },
  });
  assert.strictEqual(demande.titre, 'Demande de devis',
    'promettre un « bon de commande » sur un dossier que personne n’a chiffré, '
    + 'c’est le faire passer pour vendu');
  assert.ok(!/P\.U\. HT/.test(bureauTexte(demande)), 'et elle ne porte pas de prix unitaire');

  // --- 5. LA FEUILLE PARLE DE SA LIGNE -------------------------------------
  // Un panier de quatre articles fait quatre lignes, chacune avec SA part du
  // prix — mais le récapitulatif reste celui du dossier entier. Rendre les
  // quatre articles sous un total qui n'en couvre qu'un, c'est un document qui
  // se contredit.
  const enLot = modeleBureau({
    ...ligne,
    fiche: {
      ...ligne.fiche,
      lot: { rang: 2, total: 2 },
      details: [
        ...ligne.fiche.details,
        { k: 'Article 2 — Désignation', v: 'Bâche 2 m' },
        { k: 'Article 2 — Quantité', v: '2' },
      ],
    },
  });
  assert.strictEqual(enLot.lot.rang, 2);
  assert.strictEqual(enLot.lot.total, 2);
  assert.strictEqual(enLot.articles.length, 1, 'la feuille ne rend que SON article');
  assert.strictEqual(enLot.articles[0].designation, 'Bâche 2 m');
  assert.match(bureauTexte(enLot), /Article 2 sur 2/,
    'et elle DIT qu’elle ne couvre qu’une ligne de la commande');

  // --- 6. LA CARTE NE DIT PAS DEUX FOIS LA MÊME CHOSE ----------------------
  const texte = bureauTexte(t);
  assert.strictEqual((texte.match(/Blue Martini/g) || []).length, 1,
    'le nom du client s’écrit UNE fois — le bloc client de la fiche le répétait');
  assert.strictEqual((texte.match(/c@bm\.fr/g) || []).length, 1, 'l’e-mail aussi');
  assert.match(texte, /Adresse : 12 rue de la Liberté/,
    'mais ce que les colonnes ne portent pas reste, lui');

  // --- 7. LA FRONTIÈRE : aucun champ de production sur ce papier ------------
  // Le bureau lit le prix, pas la fiche de production. L'inverse est vrai pour
  // le ticket, et c'est un test de `ticket-production.test.js`.
  assert.ok(!('prod' in t) && !JSON.stringify(t).includes('logos'),
    'le document du bureau ne recopie pas la fiche de production');
  // …et l'argent est bien LÀ, lui — c'est tout l'objet de ce papier.
  for (const mot of ['Total HT', 'TGCA', 'TOTAL TTC', 'Règlement', 'Coût de revient', 'Marge']) {
    assert.ok(texte.includes(mot), `le bureau porte « ${mot} »`);
  }
  assert.match(texte, /INTERNE — ne pas remettre au client/,
    'la marge et le revient sont marqués comme internes');

  // --- 8. Le dessin, hors navigateur ---------------------------------------
  const doc = {
    createElement: (tag) => ({
      tag, className: '', textContent: '', enfants: [],
      append(...n) { this.enfants.push(...n); },
      appendChild(n) { this.enfants.push(n); return n; },
      setAttribute() {},
    }),
  };
  const noeud = dessinerBureau(t, doc);
  const tous = (n, acc = []) => { acc.push(n); (n.enfants || []).forEach((c) => tous(c, acc)); return acc; };
  const textes = tous(noeud).map((n) => n.textContent).filter(Boolean);
  assert.ok(textes.includes('Bon de commande'), 'le papier porte son titre');
  assert.ok(textes.includes('BUR-1'), 'et sa référence');
  assert.ok(textes.some((x) => /276,92/.test(x)), 'et le HT calculé');
  // Aucun style en ligne : la mise en page vit dans la feuille, celle que le
  // cadre d'impression charge — sinon l'aperçu et le papier divergent.
  assert.ok(!/\.style\./.test(SRC.replace(/\/\*[\s\S]*?\*\//g, ' ')),
    'le rendu ne pose aucun style en ligne');

  // --- 9. LE PAPIER D'UNE VRAIE VENTE DIRECTE (27/08/2026) -----------------
  //
  // Le dossier d'essai du dessus porte « Article 1 — Prix unitaire HT » : c'est
  // le libellé de la DEMANDE DE DEVIS, et il n'apparaît sur AUCUNE vente. Ce
  // dossier ne ressemblait donc à rien de ce qui existe en base, et il a caché
  // une colonne « P.U. » VIDE sur tout bon de commande d'une vente au comptoir
  // — le document le plus imprimé du bureau.
  //
  // Une vente écrit DEUX prix : l'article et la personnalisation. Le client
  // paie leur somme, et ce sont des prix TTC — l'écran en déduit le HT en
  // divisant par 1,04 (unitHT = (priceArticle + priceCustom) / 1.04).
  const vente = modeleBureau({
    ...ligne,
    description: 'Délai souhaité : Sous 10 jours ouvrés (prioritaire)',
    project_value: 191.4,
    fiche: {
      ...ligne.fiche,
      client: [['Nom / société', 'Blue Martini'], ['E-mail', 'c@bm.fr']]
        .map(([k, v]) => ({ k, v })),
      details: [
        ['Type de dossier', 'Vente directe'],
        ['Délai souhaité', 'Sous 10 jours ouvrés (prioritaire)'],
        ['Article 1 — Désignation', 'Tee-shirt NS300 noir'],
        ['Article 1 — Quantité', '12'],
        ['Article 1 — Prix article', '8,50 €'],
        ['Article 1 — Prix personnalisation', '6,00 €'],
        ['Article 1 — Total TTC', '191,40 €'],
        ['Article 1 — Description de production', 'Logo coeur 90 mm'],
      ].map(([k, v]) => ({ k, v })),
    },
  });
  // L'espace avant l'euro est une FINE INSÉCABLE (U+202F), celle que produit
  // Intl en français : une comparaison avec une espace ordinaire échoue sur
  // deux chaînes qui s'affichent pareil.
  assert.match(vente.articles[0].unitaire, /^14,50\s€$/,
    'le prix d’une pièce est la somme des deux prix que la vente écrit');
  const texteVente = bureauTexte(vente);
  assert.match(texteVente, /P\.U\. TTC 14,50/,
    'et il s’annonce TTC : c’est le sens que l’écran de vente lui donne');
  assert.ok(!/P\.U\. HT/.test(texteVente),
    'l’annoncer HT le ferait faux de 4 % sur le document qui sert à facturer');

  // « Client : Blue Martini » puis « Nom / société : Blue Martini », deux
  // lignes plus bas, sur le même papier.
  assert.strictEqual((texteVente.match(/Blue Martini/g) || []).length, 1,
    'le nom du client ne s’écrit qu’une fois');

  // La colonne `description` d'un dossier du comptoir est remplie PAR L'ÉCRAN,
  // avec une phrase qui est déjà, mot pour mot, une ligne du récapitulatif.
  assert.strictEqual(vente.note, '',
    'une note qui redit une ligne déjà imprimée n’est pas une note');
  assert.strictEqual((texteVente.match(/Sous 10 jours ouvrés/g) || []).length, 1,
    'le délai ne s’écrit qu’une fois, et pas sous un cadre « ne pas remettre au client »');
  // Ce que la vendeuse a VRAIMENT écrit reste, lui.
  assert.strictEqual(modeleBureau({ ...ligne, description: 'Prévenir avant de couper.' }).note,
    'Prévenir avant de couper.', 'une note de la main de la vendeuse ne se perd pas');

  // Sans aucun des deux libellés, la case reste VIDE : « pas de prix » et
  // « prix à zéro » ne se confondent pas sur un document qui sert à facturer.
  const sansPU = modeleBureau({
    ...ligne,
    fiche: { ...ligne.fiche, details: [{ k: 'Article 1 — Désignation', v: 'Bâche' }] },
  });
  assert.strictEqual(sansPU.articles[0].unitaire, '');

  console.log('✓ vue bureau : tout l’argent sur un papier, et rien de lui sur celui de l’atelier');
})().catch((e) => { console.error(e); process.exit(1); });
