'use strict';

// Vérifie la fiche « Commande Express » de bout en bout sur le vrai serveur.
// L'enjeu est l'argent : le total est RECALCULÉ côté serveur à partir du
// catalogue, jamais repris du corps de la requête. Le cas de référence est le
// reçu papier de l'atelier (Loïc OULED, 28 € + 10 % = 30,80 €).

const assert = require('node:assert');

delete process.env.DATABASE_URL;
delete process.env.APP_PASSWORD;

const iso = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

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

  const post = async (body) => {
    const res = await fetch(`${base}/api/fiche`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  const reference = {
    prenom: 'Loïc', nom: 'OULED', whatsapp: '0690479788',
    priority: 1, vendeuse: 'Loïc', referent: 'Julien', stage: 'demande',
    product: 'tasse350', color: 'Blanc', quantity: 1,
    elements: [
      { face: 'face1', option: 'texte', texte: "Je t'aime Maman", typo: 'TYPO-01', encre: 'noir', placement: 'centre', taille: 'moyenne' },
      { face: 'face2', option: 'logo_olda', logo: 'BEA-16', placement: 'centre', taille: 'moyenne' },
      { face: 'dessous', option: 'logo_olda', logo: 'HAV-01', placement: 'centre', taille: 'petite' },
    ],
    delai: 'express', deadline: iso(1), heure: '15:00',
    paiementMode: 'cb', paiementStatut: 'paye',
  };

  // 1. Le cas de référence reproduit le reçu papier au centime près.
  const ok = await post(reference);
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
  assert.deepStrictEqual(ok.body.fiche.prix, {
    unitaire: 28, produit: 10, personnalisation: 18, sousTotal: 28, supplement: 2.8, total: 30.8,
  });

  // 2. La commande atterrit dans le planning, à l'étape demandée.
  const list = await (await fetch(`${base}/api/requests?stage=demande`)).json();
  const created = list.find((r) => r.id === ok.body.id);
  assert.ok(created, 'la commande doit apparaître à l\'étape demande');
  assert.strictEqual(Number(created.project_value), 30.8);
  assert.match(created.description, /Je t'aime Maman/);
  assert.strictEqual(created.referent, 'Julien');

  // 3. Un total falsifié par le poste de vente est ignoré : seul le catalogue
  //    compte.
  const forged = await post({ ...reference, prix: { total: 1 }, project_value: 1 });
  assert.strictEqual(forged.body.fiche.prix.total, 30.8);

  // 4. La quantité multiplie le prix unitaire AVANT la majoration de délai.
  const trois = await post({ ...reference, quantity: 3 });
  assert.deepStrictEqual(trois.body.fiche.prix, {
    unitaire: 28, produit: 30, personnalisation: 54, sousTotal: 84, supplement: 8.4, total: 92.4,
  });

  // 5. Le tarif du logo OLDA est porté par la FACE, pas par le choix envoyé :
  //    6 € sur un flanc, 2 € sous la tasse. Un client qui réclamerait le tarif
  //    « dessous » sur une face reçoit quand même le tarif du flanc.
  const flanc = await post({ ...reference, elements: [{ face: 'face1', option: 'logo_olda_dessous', logo: 'BEA-16' }] });
  assert.strictEqual(flanc.body.fiche.prix.unitaire, 16, 'flanc = tasse 10 + logo 6');
  const dessous = await post({ ...reference, elements: [{ face: 'dessous', option: 'logo_olda', logo: 'BEA-16' }] });
  assert.strictEqual(dessous.body.fiche.prix.unitaire, 12, 'dessous = tasse 10 + logo 2');

  // 6. « Date précise » n'a pas de taux propre : il se déduit de la date, avec
  //    les mêmes seuils. Sans ça, « date précise = demain » offrirait l'express.
  const precise = [
    [iso(0), 0.2], [iso(1), 0.1], [iso(2), 0.1], [iso(3), 0], [iso(30), 0],
  ];
  for (const [deadline, rate] of precise) {
    const r = await post({ ...reference, delai: 'precise', deadline });
    assert.strictEqual(r.body.fiche.delai.rate, rate, `taux attendu ${rate} pour ${deadline}`);
  }

  // 7. Refus explicites : chaque manque a son message.
  const long = 'x'.repeat(61);
  const cases = [
    [{ ...reference, prenom: '', nom: '' }, /nom du client/i],
    [{ ...reference, product: 'inexistant' }, /produit inconnu/i],
    [{ ...reference, delai: 'jamais' }, /délai inconnu/i],
    [{ ...reference, paiementMode: 'troc' }, /mode de paiement inconnu/i],
    [{ ...reference, paiementStatut: 'peut-être' }, /statut de paiement inconnu/i],
    [{ ...reference, quantity: 0 }, /quantité invalide/i],
    [{ ...reference, elements: [{ face: 'face1', option: 'texte', typo: 'TYPO-01' }] }, /texte est vide/i],
    [{ ...reference, elements: [{ face: 'face1', option: 'texte', texte: long, typo: 'TYPO-01' }] }, /texte trop long/i],
    [{ ...reference, elements: [{ face: 'face1', option: 'texte', texte: 'x' }] }, /police manquante/i],
    [{ ...reference, elements: [{ face: 'face1', option: 'logo_olda', logo: 'PAS-UN-LOGO' }] }, /visuel OLDA manquante/i],
    [{ ...reference, elements: [{ face: 'nulle-part', option: 'texte' }] }, /emplacement inconnu/i],
    [{ ...reference, elements: [] }, /fiche est vide/i],
  ];
  for (const [body, re] of cases) {
    const res = await post(body);
    assert.strictEqual(res.status, 400, `attendu 400 pour ${JSON.stringify(body).slice(0, 70)}`);
    assert.match(res.body.error, re);
  }

  console.log('✓ fiche : barème, tarif par face, date précise, recalcul serveur et refus OK');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
