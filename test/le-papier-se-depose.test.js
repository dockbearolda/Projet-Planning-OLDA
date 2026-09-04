'use strict';

// LE PAPIER SE DÉPOSE SUR LA LIGNE — et c'est un vrai PDF.
// ===========================================================================
// Charlie, 04/09/2026 : « la ligne créée contienne automatiquement le devis ou
// la facture à l'intérieur ». Les trois emplacements existaient depuis
// toujours ; personne n'y déposait rien. Les deux écrans IMPRIMAIENT — un cadre
// hors écran, `window.print()` — et aucun octet ne revenait au code.
//
// CE N'EST PAS UN SECOND PAPIER, C'EST UN SECOND RENDU. `modeleFacture` et
// `modeleDevis` ont déjà tranché tous les montants et toutes les phrases ;
// `dessiner*` les met en HTML, `ecrirePapierPdf` les met en PDF. Aucune règle
// ne se réécrit — sinon les deux rendus finiraient par dire deux chiffres.
//
// ⚠ CE FICHIER EXERCE LE VRAI RENDU, pas une imitation. `papier-pdf.js` est un
// module ES qui tire pdf-lib, et le dépôt est en `"type": "commonjs"` : Node
// lirait donc son `export` comme une erreur de syntaxe. On recopie les quatre
// fichiers dans un bac qui se déclare module — c'est le MÊME code que celui
// servi au navigateur, pas une copie retouchée.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const PAPIER = lire('public/papier-pdf.js');
const VENTE = lire('public/vente-flash.js');
const DEVIS_FLASH = lire('public/devis-flash.js');
const RESEAU = lire('public/reseau.js');
const SW = lire('public/sw.js');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

function bacModuleEs() {
  const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'olda-papier-'));
  fs.writeFileSync(path.join(bac, 'package.json'), '{"type":"module"}');
  for (const rel of ['public/papier-pdf.js', 'public/bat/js/vendor.js',
    'public/bat/vendor/pdf-lib.esm.min.js', 'public/bat/vendor/pako.mjs']) {
    const cible = path.join(bac, rel);
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.copyFileSync(path.join(RACINE, rel), cible);
  }
  return bac;
}

// Un modèle de facture complet — la sortie de `modeleFacture`, telle quelle.
const MODELE = {
  maison: {
    nom: 'Atelier OLDA SARL',
    lignes: ['1 rue Opale', '97150 Grand-Case, Saint-Martin'],
    contact: ['05 90 77 13 04', 'atelierolda@gmail.com'],
    legal: ['SIRET 978 296 952 00028', 'APE 1813Z'],
  },
  titre: 'FACTURE',
  numero: 'FA-2026-0001',
  date: '04/09/2026',
  projet: 'STAFF ÉTÉ',
  client: {
    nom: 'HÔTEL RÉSIDENCE DES ÎLES', adresse: '3 baie Nettlé',
    ville: '97150 Saint-Martin', contact: 'Mme Cœur', tel: '0690 00 00 00', email: 'x@y.fr',
  },
  lignes: [{
    designation: 'T-shirt unisexe léger Pro 145 g',
    reference: 'K3025', couleur: 'Light Olive Green', tailles: '12 × M · 18 × L',
    marquage: 'Cœur + Dos', encre: 'Blanc', faces: 'Cœur, Dos', note: '',
    // ⚠ CES ESPACES-LÀ VIENNENT D'`Intl` ET NE SONT PAS DES ESPACES. Une fine
    // insécable (U+202F) avant le « € », une insécable ordinaire dans les
    // milliers : ni l'une ni l'autre n'existe dans WinAnsi.
    quantite: 30, unitaireHt: '20,80 €', totalHt: '1 234,00 €',
  }],
  totaux: {
    sousTotalHt: '1 234,00 €', ajustement: '', ecart: '',
    totalHt: '1 234,00 €', taxeLabel: 'TGCA 4 %', taxe: '49,36 €',
    ttc: '1 283,36 €', vedette: 'ttc',
  },
  mentions: ['Règlement à réception.'],
};

(async () => {
  const bac = bacModuleEs();
  const { ecrirePapierPdf, nomDuPapier } = await import(
    pathToFileURL(path.join(bac, 'public/papier-pdf.js')).href);
  // pdf-lib sert ici à RELIRE ce qu'on vient d'écrire. Compter les pages en
  // cherchant « /Type /Page » dans les octets ne marche pas : les objets sont
  // compressés, et la sonde rendait zéro sur un PDF de deux pages. On demande
  // donc au même outil que celui qui l'a écrit.
  const { PDFLib } = await import(pathToFileURL(path.join(bac, 'public/bat/js/vendor.js')).href);

  // =========================================================================
  // 1. C'EST UN VRAI PDF, ET IL SORT
  // =========================================================================
  const bytes = await ecrirePapierPdf(MODELE, { reglement: 'RÈGLEMENT — 1 283,36 € — par Carte bancaire' });
  assert.ok(bytes instanceof Uint8Array && bytes.length > 800, 'un PDF, pas une promesse vide');
  assert.strictEqual(Buffer.from(bytes.slice(0, 5)).toString('latin1'), '%PDF-',
    'l’en-tête que `deposerPdf` (server.js) exige — sans elle, le dépôt est refusé');

  // ⚠ L'EURO SURVIT. Premier essai : tous les montants sortaient « 20,80 » au
  // lieu de « 20,80 € ». Le signe vaut U+20AC, au-dessus de Latin-1, et un
  // filtre « jusqu'à U+00FF » le jetait avec les espaces fines. Une facture
  // sans devise, et rien pour le dire — vu en REGARDANT la feuille, pas en
  // relisant le code.
  //
  // On rejoue LA RÈGLE écrite dans le fichier : ce qui est admis au-delà de
  // Latin-1, et ce qui doit être replié.
  const extras = /const EXTRAS = '([^']*)'\s*\+\s*'([^']*)'/.exec(PAPIER);
  assert.ok(extras, 'la liste des caractères hors Latin-1 admis est écrite dans le fichier');
  const admis = extras[1] + extras[2];
  assert.ok(admis.includes('€'), 'l’euro est admis — une facture sans devise n’est pas une facture');
  assert.ok(admis.includes('œ'), 'et la ligature « oe » aussi : « Cœur » s’écrit tel quel');
  assert.ok(/espaces fines et insécables/.test(PAPIER) && /REMPLACEMENTS/.test(PAPIER),
    'les espaces fines d’`Intl` se replient : elles n’existent pas dans WinAnsi, et `drawText` lève dessus');

  // =========================================================================
  // 2. LES CARACTÈRES QUI FAISAIENT ÉCHOUER LA FEUILLE ENTIÈRE
  // =========================================================================
  // `drawText` ne se contente pas d'ignorer un caractère hors WinAnsi : elle
  // LÈVE. Une feuille perdue pour une espace fine, et la facture ne sort pas du
  // tout. On ne cherche donc pas à savoir si le rendu est joli — on vérifie
  // qu'il NE LÈVE PAS sur ce que les vraies données contiennent.
  const hostile = {
    ...MODELE,
    client: { ...MODELE.client, nom: 'CŒUR & ŒUVRE — « GUILLEMETS » … ÉÀÙÇ' },
    lignes: [{
      ...MODELE.lignes[0],
      designation: 'Tasse 🎨 émoji · flèche → · math ∑ · cyrillique Дом',
      note: 'Une note très longue '.repeat(30),
    }],
  };
  const b2 = await ecrirePapierPdf(hostile, {});
  assert.ok(b2.length > 800, 'un émoji, une flèche ou du cyrillique ne coûtent pas la facture');

  // =========================================================================
  // 3. UNE LONGUE FACTURE TIENT SUR PLUSIEURS PAGES
  // =========================================================================
  // Et une ligne ne se coupe pas en deux : sa désignation et ses montants se
  // lisent ensemble, sinon le total d'un article se retrouve orphelin en tête
  // de la page suivante.
  const longue = { ...MODELE, lignes: Array.from({ length: 40 }, () => MODELE.lignes[0]) };
  const b3 = await ecrirePapierPdf(longue, {});
  const pages = (await PDFLib.PDFDocument.load(b3)).getPageCount();
  assert.ok(pages >= 2, `quarante articles ne tiennent pas sur une page (mesuré : ${pages})`);
  assert.strictEqual((await PDFLib.PDFDocument.load(bytes)).getPageCount(), 1,
    'et une facture d’un article n’en fait pas deux');
  assert.ok(/DESIGNATION/.test(PAPIER) && /if \(p\.place\(hauteur\)\) teteTableau\(p\);/.test(PAPIER),
    'et l’en-tête du tableau se répète sur la page suivante');

  // =========================================================================
  // 4. LE NOM DU FICHIER SE LIT DANS UNE DROPBOX SIX MOIS PLUS TARD
  // =========================================================================
  const nom = nomDuPapier(MODELE);
  assert.match(nom, /\.pdf$/);
  assert.ok(nom.includes('FA-2026-0001'), 'le numéro y est : c’est par lui qu’on retrouve un document');
  // LES ACCENTS SE REPLIENT, ILS NE SE PERDENT PAS. « HÔTEL » doit rester
  // « HOTEL » et pas « H-TEL » : un tiret au milieu d'un mot le rend
  // méconnaissable quand on balaie un dossier.
  assert.ok(nom.includes('HOTEL'), `« HÔTEL » se lit encore : ${nom}`);
  assert.ok(!/[^A-Za-z0-9.\-_]/.test(nom), `rien qu’un système de fichiers refuse : ${nom}`);

  // =========================================================================
  // 5. LE DÉPÔT — SUR TOUTES LES LIGNES, ET SANS JAMAIS FAIRE ÉCHOUER LA VENTE
  // =========================================================================
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
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };

  // Une vente à deux articles : deux lignes, et LE MÊME papier sur les deux —
  // c'est un seul document, celui que le client tient.
  const vente = await call('POST', '/api/comptoir/projet', {
    source: 'Vente directe',
    clientObj: { name: 'CLIENT DU PAPIER', company: 'CLIENT DU PAPIER', type: 'Professionnel' },
    amount: 300, name: '2 articles',
    articles: [
      { label: 'Mug', qty: 10, amount: 120 },
      { label: 'Planche', qty: 5, amount: 180 },
    ],
    paiement: { mode: 'cb' },
  });
  assert.strictEqual(vente.status, 201);
  const ids = vente.body.lot.ids;
  assert.strictEqual(ids.length, 2);

  for (const id of ids) {
    const r = await fetch(`${base}/api/requests/${id}/pdf/facture?name=${encodeURIComponent(nom)}`,
      { method: 'PUT', body: bytes });
    assert.strictEqual(r.status, 200, 'le PDF que nous produisons est accepté par le serveur');
  }
  const apres = await call('GET', '/api/requests');
  const liste = Array.isArray(apres.body) ? apres.body : (Object.values(apres.body).find(Array.isArray) || []);
  const notre = liste.filter((l) => l.billing_company === 'CLIENT DU PAPIER');
  assert.strictEqual(notre.length, 2);
  assert.ok(notre.every((l) => l.facture_name === nom),
    'les DEUX lignes portent le papier : le déposer sur la première en laisserait une vide sur le même dossier');

  // =========================================================================
  // 6. CE QUI DOIT RESTER ÉCRIT
  // =========================================================================
  // ⚠ LE DÉPÔT NE VIT PAS AVEC LE RENDU. Envoyer des octets n'a besoin d'aucune
  // bibliothèque de PDF — et `papier-pdf.js` en tire 511 Ko. Importé en tête
  // des deux écrans pour cette seule fonction, il descendait à CHAQUE ouverture
  // et il aurait fallu le mettre dans la coquille hors ligne. Le garde-fou
  // `test/coquille-complete.test.js` l'a dit avant qu'on le livre.
  assert.ok(/export async function deposerPapier/.test(RESEAU),
    'le dépôt vit dans `reseau.js`, avec la discipline du réseau');
  assert.ok(!/deposerPapier/.test(PAPIER), 'et pas dans le module qui tire pdf-lib');
  for (const [nomEcran, src] of [['vente flash', VENTE], ['devis flash', DEVIS_FLASH]]) {
    assert.ok(!/^import .*papier-pdf/m.test(src),
      `${nomEcran} n’importe PAS pdf-lib en tête : 511 Ko à chaque ouverture d’écran`);
    assert.ok(/deposerPapier\(/.test(src), `${nomEcran} dépose son papier`);
  }
  assert.ok(!/papier-pdf\.js/.test(SW),
    'et pdf-lib n’entre pas dans la coquille hors ligne : elle pèse 109 Ko, c’est un budget');
  // L'IMPORT EST PARESSEUX DES DEUX CÔTÉS : composer un devis n'est pas
  // l'imprimer, et la plupart des ouvertures d'écran n'émettent rien.
  assert.ok(/await import\('\.\/papier-pdf\.js'\)/.test(lire('public/facture.js')));
  assert.ok(/await import\('\.\/papier-pdf\.js'\)/.test(lire('public/devis.js')));
  // ET C'EST UN CONFORT : `allSettled`, jamais de rejet — la facture est déjà
  // émise et archivée quand on arrive là.
  assert.ok(/Promise\.allSettled/.test(RESEAU),
    'une ligne qui refuse n’empêche pas les autres, et rien ne fait échouer la vente');

  console.log('✓ le papier se dépose : un vrai PDF, l’euro survit, plusieurs pages, '
    + 'toutes les lignes du dossier — et pdf-lib ne descend qu’à l’émission');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
