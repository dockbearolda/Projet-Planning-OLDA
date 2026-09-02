'use strict';

// ===========================================================================
// LE DEVIS ENTRE AU PLANNING — et il y reste tel qu'il a été imprimé
// ===========================================================================
// UN DEVIS IMPRIMÉ QUI N'EST NULLE PART N'EXISTE PAS : personne ne le relance,
// et c'est exactement l'étape que le pipeline appelle « Tarif / Devis envoyé —
// Attente client ».
//
// CE N'EST PAS UNE DEMANDE DE DEVIS. Celle-là entre par le comptoir et vaut
// « à chiffrer » — `project_value` NULL, surtout pas 0, qui se lirait
// « gratuit ». Celui-ci EST le chiffrage : le prix est annoncé au client et le
// papier est imprimé. Il porte donc son montant, et sa NATURE reste `demande` :
// le client n'a rien signé, et le planning ne doit pas le compter comme vendu.
//
// ET LE PRIX EST FIGÉ. Un tarif de catalogue qui change demain ne retarife
// jamais un devis déjà remis. C'est la même règle que pour `fiche.chiffrage`,
// jouée ici de bout en bout contre le vrai serveur.

const assert = require('node:assert');

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

  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };

  const DEVIS = {
    date: '2026-09-01', validite: '2026-10-01', jour: '2026-09-01',
    projet: 'STAFF',
    client: { nom: 'Aloha Beach', code: 'ALO', ville: '97150 Saint-Martin', tel: '0690000000', type: 'professionnel' },
    appro: 'groupe', regime: 'tgca', tauxTgca: 0.04, arrondi: 'euro',
    lignes: [
      { designation: 'T-shirt Unisexe Bio', reference: 'NS300', couleur: 'Olive', tailles: '2 x S', marquage: 'Coeur', quantite: 30, unitaireHt: 14.3, totalHt: 429 },
      { designation: 'Transport Chronopost', quantite: 30, unitaireHt: 1.8, totalHt: 54 },
    ],
    sousTotalHt: 483, totalHt: 482.69, taxe: 19.31, ttc: 502,
    acomptePourcent: 50, acompteMontant: 251,
  };

  // -------------------------------------------------------------------------
  // 1. LE DOSSIER NAÎT À LA BONNE PLACE, AVEC SON MONTANT
  // -------------------------------------------------------------------------
  let r = await call('POST', '/api/devis', DEVIS);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const id = r.body.id;
  // ⚠ LE DEVIS ENTRE PAR « À TRIER » DEPUIS LE 02/09 (Charlie). Il allait droit
  // à « Demande & chiffrage / Devis envoyé — Attente client » : ça répondait à
  // la question « qui le relance ? », mais ça présumait de la précédente — un
  // devis composé devant un client n'est pas forcément un devis PARTI. « À
  // trier » est la corbeille d'entrée de l'atelier, celle qu'on vide le matin,
  // et c'est de là qu'il se range.
  assert.strictEqual(r.body.stage, 'a_trier');
  assert.strictEqual(r.body.subStage, null,
    '« À trier » n’a pas de sous-étape : c’est le sur-dossier, pas une phase');
  // LE NUMÉRO VIENT DU COMPTEUR DU SERVEUR quand l'écran n'a rien imprimé : un
  // dossier de devis sans référence ne se retrouve pas.
  assert.match(r.body.numero, /^DEV-26\.09\.01-\d{3}$/, `numéro inattendu : ${r.body.numero}`);
  const numero = r.body.numero;

  r = await call('GET', `/api/requests/${id}`);
  const ligne = r.body;
  assert.strictEqual(ligne.order_kind, 'demande',
    'la nature reste « demande » : le client n’a rien signé');
  assert.strictEqual(Number(ligne.project_value), 502,
    'l’étape dit qu’on a chiffré — une colonne Prix vide la contredirait');
  assert.strictEqual(ligne.billing_company, 'Aloha Beach');
  assert.strictEqual(ligne.quantity, 60, 'la quantité est celle de toutes les lignes');
  // CE QU'ON PRODUIT, EN UN MOT : la colonne « Article » du planning fait deux
  // cents pixels — y déverser quatre désignations n'y rend rien lisible, et le
  // détail complet est de toute façon dans la fiche.
  assert.strictEqual(ligne.product, 'T-shirt Unisexe Bio + 1 autre');
  assert.strictEqual(ligne.description, 'STAFF');
  // UNE DATE SOUHAITÉE N'EST PAS UNE PROMESSE : sans elle, pas d'échéance —
  // sinon le dossier paraît en retard dès le lendemain alors que personne n'a
  // rien promis au client.
  assert.strictEqual(ligne.deadline, null);

  // -------------------------------------------------------------------------
  // 2. LE DEVIS EST ARCHIVÉ TEL QU'IL A ÉTÉ IMPRIMÉ
  // -------------------------------------------------------------------------
  const archive = ligne.fiche.devis;
  assert.strictEqual(ligne.fiche.kind, 'devis-v1');
  assert.strictEqual(ligne.fiche.ref, numero);
  assert.strictEqual(archive.lignes.length, 2);
  assert.strictEqual(archive.lignes[0].unitaireHt, 14.3);
  assert.strictEqual(archive.lignes[0].tailles, '2 x S');
  assert.strictEqual(archive.ttc, 502);
  assert.strictEqual(archive.acompte.montant, 251);
  assert.strictEqual(archive.tauxTgca, 0.04,
    'le taux appliqué est archivé : sans lui, un devis d’avant un changement de taux se relit faux');

  // -------------------------------------------------------------------------
  // 3. LE CLIENT ENTRE EN BASE — comme à toutes les portes de l'application
  // -------------------------------------------------------------------------
  r = await call('GET', '/api/clients');
  assert.ok(r.body.some((c) => c.entreprise === 'Aloha Beach'),
    'un client inconnu entre en base quand le devis part au planning');

  // -------------------------------------------------------------------------
  // 4. IDEMPOTENCE — le réseau peut avaler la réponse d'un envoi qui a abouti
  // -------------------------------------------------------------------------
  // L'écran annonce alors un échec, on réessaie, et le devis entrerait une
  // seconde fois sous le même numéro. On rend la ligne existante.
  r = await call('POST', '/api/devis', { ...DEVIS, numero });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.id, id, 'le même numéro rend le même dossier');
  assert.strictEqual(r.body.dejaEnregistre, true);

  // -------------------------------------------------------------------------
  // 5. DEUX DEVIS DU MÊME JOUR NE SE DISPUTENT PAS UN RANG
  // -------------------------------------------------------------------------
  // C'est là que vivent les bugs : deux postes qui impriment en même temps ne
  // peuvent pas remettre le même numéro à deux clients.
  const [a, b] = await Promise.all([
    call('POST', '/api/devis', { ...DEVIS, client: { nom: 'Client A' } }),
    call('POST', '/api/devis', { ...DEVIS, client: { nom: 'Client B' } }),
  ]);
  assert.strictEqual(a.status, 201);
  assert.strictEqual(b.status, 201);
  assert.notStrictEqual(a.body.numero, b.body.numero,
    'deux devis pris en même temps portent deux numéros');
  assert.notStrictEqual(a.body.id, b.body.id, 'et deux dossiers');

  // -------------------------------------------------------------------------
  // 6. CE QUI EST REFUSÉ, ET POURQUOI
  // -------------------------------------------------------------------------
  // Un devis sans ligne n'est pas un devis : on refuse plutôt que d'ouvrir un
  // dossier vide au planning, que personne ne saurait relire.
  r = await call('POST', '/api/devis', { ...DEVIS, lignes: [] });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /sans article/);
  r = await call('POST', '/api/devis', { ...DEVIS, client: {} });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /nom du client/);
  // UN MONTANT ILLISIBLE N'EST PAS « PAS DE PRIX » : c'est une faute de frappe.
  // On la renvoie à l'écran plutôt que d'enregistrer un devis sans montant, que
  // personne ne remarque avant la relance.
  r = await call('POST', '/api/devis', { ...DEVIS, ttc: 'quatre cents' });
  assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/devis', { ...DEVIS, ttc: null });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /montant/);

  // -------------------------------------------------------------------------
  // 7. UN PRIX DE CATALOGUE QUI CHANGE NE RETARIFE PAS UN DEVIS DÉJÀ PARTI
  // -------------------------------------------------------------------------
  // C'est LA règle du dépôt sur les prix, et elle se joue en entier : on
  // enregistre un devis, on remonte le tarif du catalogue, on relit le devis.
  // Il vaut ce qu'il valait — c'est ce que le client a sur son papier.
  r = await call('GET', '/api/catalogue-produits');
  const catalogue = r.body;
  assert.ok(catalogue.length, 'le catalogue est semé');
  const cible = catalogue[0];
  r = await call('PUT', '/api/catalogue-produits',
    catalogue.map((p) => (p.id === cible.id ? { ...p, prixVenteTtc: 999 } : p)));
  assert.strictEqual(r.status, 200);

  r = await call('GET', `/api/requests/${id}`);
  assert.strictEqual(Number(r.body.project_value), 502,
    'le montant du devis ne bouge pas quand un tarif de catalogue change');
  assert.deepStrictEqual(r.body.fiche.devis.lignes, archive.lignes,
    'et son détail non plus : le devis est figé dans sa fiche');

  // … et la grille de la tasse non plus ne le touche pas.
  r = await call('GET', '/api/tarifs-tasse');
  await call('PUT', '/api/tarifs-tasse',
    r.body.map((t) => (t.categorie === 'produit' ? { ...t, prixVenteTtc: 77 } : t)));
  r = await call('GET', `/api/requests/${id}`);
  assert.strictEqual(Number(r.body.project_value), 502,
    'ni un tarif tasse : ce qui est chiffré est chiffré');

  // -------------------------------------------------------------------------
  // 5. LA REPRISE — V2, V3, ET UN SEUL DOSSIER (02/09/2026)
  // -------------------------------------------------------------------------
  // « Ce devis pourra être modifié directement depuis la ligne pour créer la v2,
  // 3, 4… dans le cas où le client souhaite une modification » (Charlie).
  //
  // CE QUI COÛTE CHER SI ÇA DÉRIVE : un DEUXIÈME dossier pour le même client et
  // le même projet. Il faudrait les rapprocher à la main, et on relancerait le
  // mauvais. C'est ce qui est arrivé en le jouant la première fois — `id` est un
  // UUID, `Number(id)` rend NaN, la reprise passait pour absente.
  {
    const avant = (await call('GET', '/api/requests')).body.length;
    const V2 = {
      ...DEVIS,
      dossierId: id,
      numero: '',                     // le serveur en pose un neuf, « …-V2 »
      lignes: [{ designation: 'T-shirt STAFF', quantite: 80, unitaireHt: 13, totalHt: 1040 }],
      sousTotalHt: 1040, totalHt: 1040, taxe: 41.6, ttc: 1081,
    };
    let v = await call('POST', '/api/devis', V2);
    assert.strictEqual(v.status, 200, JSON.stringify(v.body));
    assert.strictEqual(v.body.reprise, true, 'le serveur dit qu’il a repris, pas créé');
    assert.strictEqual(v.body.id, id, 'et c’est le MÊME dossier');
    assert.strictEqual(v.body.version, 2);
    assert.match(v.body.numero, /-V2$/, 'le numéro garde sa racine et gagne son rang');

    const apres = (await call('GET', '/api/requests')).body.length;
    assert.strictEqual(apres, avant, 'une reprise n’ouvre AUCUN dossier de plus');

    const f = (await call('GET', `/api/requests/${id}`)).body;
    assert.strictEqual(f.fiche.version, 2);
    assert.strictEqual(f.fiche.devis.ttc, 1081, 'la version courante est la nouvelle');
    assert.strictEqual(Number(f.project_value), 1081, 'et la ligne du planning porte son montant');
    assert.strictEqual(f.quantity, 80);
    // LA VERSION D'AVANT EST RANGÉE, PAS PERDUE : le client a une feuille en
    // main, il faut pouvoir dire ce qu'on lui avait chiffré.
    assert.strictEqual(f.fiche.devisPassees.length, 1);
    assert.strictEqual(f.fiche.devisPassees[0].version, 1);
    assert.strictEqual(f.fiche.devisPassees[0].devis.ttc, 502);

    // UNE TROISIÈME EMPILE, elle n'écrase pas la deuxième.
    v = await call('POST', '/api/devis', { ...V2, ttc: 900, totalHt: 900, sousTotalHt: 900 });
    assert.strictEqual(v.body.version, 3);
    assert.match(v.body.numero, /-V3$/, 'la racine ne se dédouble pas : jamais « -V2-V3 »');
    const f3 = (await call('GET', `/api/requests/${id}`)).body;
    assert.deepStrictEqual(f3.fiche.devisPassees.map((x) => x.version), [2, 1],
      'de la plus récente à la plus ancienne');

    // UN DOSSIER QUI N'EST PAS UN DEVIS NE SE REPREND PAS.
    const ko = await call('POST', '/api/devis', { ...V2, dossierId: 'inexistant' });
    assert.strictEqual(ko.status, 404, 'un dossier introuvable se dit, il ne crée pas un devis orphelin');
  }

  // --- « PAS DE PRIX » SURVIT À L'ARCHIVE (02/09/2026) --------------------
  // Le montant se range à 0 — c'est ce que la ligne vaut dans l'addition — mais
  // un article resté « à chiffrer » ne doit pas revenir OFFERT à la reprise en
  // V2 : le devis suivant partirait avec la promesse de le donner.
  {
    const r = await call('POST', '/api/devis', {
      ...DEVIS,
      numero: '',
      lignes: [
        { designation: 'Tasse à chiffrer', quantite: 3, unitaireHt: 0, totalHt: 0, sansPrix: true },
        { designation: 'Goodie offert', quantite: 1, unitaireHt: 0, totalHt: 0, sansPrix: false },
      ],
    });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const f = (await call('GET', `/api/requests/${r.body.id}`)).body;
    const [aChiffrer, offert] = f.fiche.devis.lignes;
    assert.strictEqual(aChiffrer.sansPrix, true, 'l’archive se souvient de ce qui n’était pas chiffré');
    assert.strictEqual(aChiffrer.unitaireHt, 0, '… et le montant reste zéro dans l’addition');
    assert.strictEqual(offert.sansPrix, false, 'un article offert reste un article offert');
  }

  console.log('✓ devis au planning : « À trier », nature demande, numéro unique, '
    + 'reprise en V2/V3 sur UN seul dossier, et un prix qui ne se retarife jamais');
  process.exit(0);
})();
