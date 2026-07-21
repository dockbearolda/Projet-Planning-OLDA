'use strict';

// Vérifie la fiche vendeuse de bout en bout sur le vrai serveur Express.
// L'enjeu est l'argent : le total est RECALCULÉ côté serveur à partir du
// catalogue, jamais repris du corps de la requête. Le cas de référence est le
// reçu papier du patron (Loïc OULED, 28 € + 10 % express = 30,80 €).

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
    priority: 1, vendeuse: 'Loïc',
    product: 'tasse350', color: 'Blanc', quantity: 1,
    faces: {
      face1: { option: 'texte', texte: "Je t'aime Maman", typo: 'TYPO-01' },
      face2: { option: 'logo_olda_face', logo: 'BEA-16' },
      dessous: { option: 'logo_olda_dessous', logo: 'HAV-01' },
    },
    delai: 'express', paiement: 'cb',
  };

  // 1. Le cas de référence reproduit le reçu papier au centime près.
  const ok = await post(reference);
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
  assert.deepStrictEqual(ok.body.fiche.prix, {
    unitaire: 28, sousTotal: 28, supplement: 2.8, total: 30.8,
  });

  // 2. La commande atterrit dans le planning, à l'étape « demande ».
  const list = await (await fetch(`${base}/api/requests?stage=demande`)).json();
  const created = list.find((r) => r.id === ok.body.id);
  assert.ok(created, 'la commande doit apparaître à l\'étape demande');
  assert.strictEqual(Number(created.project_value), 30.8);
  assert.match(created.description, /Je t'aime Maman/);

  // 3. Un total falsifié par la tablette est ignoré : seul le catalogue compte.
  const forged = await post({ ...reference, prix: { total: 1 }, project_value: 1 });
  assert.strictEqual(Number(forged.body.fiche.prix.total), 30.8);

  // 4. La quantité multiplie le prix unitaire AVANT la majoration de délai.
  const trois = await post({ ...reference, quantity: 3 });
  assert.deepStrictEqual(trois.body.fiche.prix, {
    unitaire: 28, sousTotal: 84, supplement: 8.4, total: 92.4,
  });

  // 5. Le logo OLDA vaut 6 € sur un flanc et 2 € sous la tasse : une fiche qui
  //    tente le tarif « dessous » sur une face doit être rejetée par le front,
  //    mais le serveur, lui, applique le tarif de l'option demandée sans jamais
  //    descendre en dessous du barème.
  const dessousPartout = await post({
    ...reference,
    faces: { face1: { option: 'logo_olda_dessous', logo: 'BEA-16' }, face2: {}, dessous: {} },
  });
  assert.strictEqual(dessousPartout.body.fiche.prix.unitaire, 12);

  // 6. Refus explicites : chaque manque a son message.
  const cases = [
    [{ ...reference, prenom: '', nom: '' }, /nom du client/i],
    [{ ...reference, product: 'inexistant' }, /produit inconnu/i],
    [{ ...reference, delai: 'jamais' }, /délai inconnu/i],
    [{ ...reference, quantity: 0 }, /quantité invalide/i],
    [{ ...reference, faces: { face1: { option: 'texte', typo: 'TYPO-01' } } }, /texte personnalisé est vide/i],
    [{ ...reference, faces: { face1: { option: 'texte', texte: 'x' } } }, /typographie manquante/i],
    [{ ...reference, faces: { face2: { option: 'logo_olda_face', logo: 'PAS-UN-LOGO' } } }, /logo OLDA manquante/i],
    [{ ...reference, faces: {} }, /fiche est vide/i],
  ];
  for (const [body, re] of cases) {
    const res = await post(body);
    assert.strictEqual(res.status, 400, `attendu 400 pour ${JSON.stringify(body).slice(0, 60)}`);
    assert.match(res.body.error, re);
  }

  console.log('✓ fiche : barème, recalcul serveur, arrivée au planning et refus OK');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
