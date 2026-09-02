'use strict';

// LES PRIX DE RAYON DE LA TASSE, PROUVÉS SANS PASSER PAR UN ÉCRAN
// ===========================================================================
// Le patron, le 01/09/2026 : « la tasse céramique c'est 16 euros, si le client
// veut ajouter son propre logo ou autre perso c'est 6 euros en plus », puis
// « TASSE en bois 22 euros, expresso 14 euros ».
//
// CE QUI EST VÉRIFIÉ ICI, ET POURQUOI CE FICHIER EXISTE
// ---------------------------------------------------------------------------
// Ces quatre nombres étaient déjà tenus par `tarifs-tasse.test.js` — mais à
// travers `POST /api/projets`, l'ancien « Nouveau Projet » interne que plus
// aucun écran n'appelle depuis le 31/07. La preuve d'un prix tenait donc à une
// route morte : impossible de retirer neuf cents lignes sans perdre la seule
// chose qui disait qu'une tasse sort à 16 €.
//
// Le calcul vit maintenant dans `tarif-tasse.js`, seul et pur. Ce test l'attaque
// EN DIRECT, avec la vraie grille du patron lue par la vraie route de Réglages.
// Deux choses en sortent :
//   · les prix de rayon sont tenus, quelle que soit la porte d'entrée ;
//   · la route morte peut partir sans emporter la preuve.
//
// ON NE CONTRÔLE PAS LE COMPOSANT, ON CHIFFRE UNE TASSE. C'est tout le sujet :
// le prix de rayon, c'est le contenant AVEC une face, pas le contenant nu. La
// grille avait été lue de travers sur ce point précis et sous-tarifait de 6 €
// par tasse. Contrôler « le composant tasse vaut 10 € » aurait laissé passer
// l'erreur ; exiger « la tasse vendue vaut 16 € » l'attrape.

const assert = require('node:assert');
const path = require('node:path');

const { chiffrerTasse } = require(path.join(__dirname, '..', 'tarif-tasse.js'));

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
  const lire = async (chemin) => (await fetch(base + chemin)).json();

  // La grille telle que l'atelier l'a réglée, et les taux horaires qui vont
  // avec : ce sont les deux seules entrées du calcul.
  const articles = await lire('/api/tarifs-tasse');
  const taux = await lire('/api/tarifs-tasse/parametres');
  assert.ok(Array.isArray(articles) && articles.length, 'la grille tarifaire répond');

  const parCat = (categorie, designation) => {
    const a = articles.find((x) => x.categorie === categorie && x.designation === designation);
    assert.ok(a, `« ${designation} » doit être dans la grille (${categorie})`);
    return a.id;
  };

  const chiffrer = (produit, faces) => {
    const r = chiffrerTasse({
      produitId: parCat('produit', produit),
      face1Id: parCat('face', faces[0] || 'Aucune'),
      face2Id: faces[1] ? parCat('face', faces[1]) : '',
      dessousId: parCat('dessous', 'Aucune'),
      batId: parCat('bat', 'Non'),
    }, articles, taux);
    assert.ok(!r.error, r.error);
    return r;
  };

  // ---------------------------------------------------------------------
  // 1. LES TROIS PRIX DE RAYON, ET LE LOGO DU CLIENT
  // ---------------------------------------------------------------------
  for (const [tasse, magasin] of [
    ['Tasse Céramique 350 ml', 16],
    ['Tasse Expresso 180 ml', 14],
    ['Tasse en Bois', 22],
  ]) {
    const seule = chiffrer(tasse, ['Logo OLDA existant']).prixUnitaireTtc;
    assert.strictEqual(seule, magasin,
      `« ${tasse} » doit se chiffrer au prix du comptoir (${magasin} €), pas ${seule} €`);

    const avecPerso = chiffrer(tasse, ['Logo OLDA existant', 'Logo client vectorisé']).prixUnitaireTtc;
    assert.strictEqual(avecPerso - seule, 6,
      `le logo du client sur l’autre face vaut +6 € (obtenu : +${avecPerso - seule} €)`);
  }

  // ---------------------------------------------------------------------
  // 2. LE COÛT DE REVIENT N'EST PAS LE PRIX
  // ---------------------------------------------------------------------
  // Sans lui, aucune marge n'est calculable — et une marge fausse est pire
  // qu'une marge absente, parce qu'on décide dessus. Il compte la matière ET le
  // temps : deux taux horaires, des temps en minutes.
  const ceramique = chiffrer('Tasse Céramique 350 ml', ['Logo OLDA existant']);
  assert.ok(ceramique.coutUnitaire > 0, 'une tasse produite coûte quelque chose');
  assert.ok(ceramique.coutUnitaire < ceramique.prixUnitaireTtc,
    'et elle se vend plus cher qu’elle ne coûte, sinon la grille est à revoir');

  // Le temps compte VRAIMENT : doubler les deux taux horaires doit faire monter
  // le coût. Une erreur de soixantième (minutes prises pour des heures) passe
  // inaperçue sur un total, jamais sur cette comparaison.
  const tauxDouble = {
    tauxHoraireMo: Number(taux.tauxHoraireMo) * 2,
    tauxHoraireMachine: Number(taux.tauxHoraireMachine) * 2,
  };
  const cher = chiffrerTasse({
    produitId: parCat('produit', 'Tasse Céramique 350 ml'),
    face1Id: parCat('face', 'Logo OLDA existant'),
    face2Id: '', dessousId: parCat('dessous', 'Aucune'), batId: parCat('bat', 'Non'),
  }, articles, tauxDouble);
  assert.ok(cher.coutUnitaire > ceramique.coutUnitaire,
    'le temps d’atelier entre dans le coût : doubler les taux le fait monter');
  assert.strictEqual(cher.prixUnitaireTtc, ceramique.prixUnitaireTtc,
    '… et il ne touche pas au prix de vente, qui vient de la grille');

  // ---------------------------------------------------------------------
  // 3. CE QU'ON NE SAIT PAS NE VAUT PAS ZÉRO
  // ---------------------------------------------------------------------
  // Un identifiant inconnu doit REFUSER. S'il valait zéro, une tasse mal
  // désignée se vendrait au prix d'une autre — en silence.
  const inconnu = chiffrerTasse({
    produitId: 'ceci-n-existe-pas',
    face1Id: '', face2Id: '', dessousId: '', batId: '',
  }, articles, taux);
  assert.ok(inconnu.error && /type de tasse/.test(inconnu.error),
    'un type de tasse inconnu est refusé, il ne vaut pas 0 €');

  const sansProduit = chiffrerTasse({ produitId: '' }, articles, taux);
  assert.ok(sansProduit.error && /requis/.test(sansProduit.error),
    'et une tasse sans contenant n’est pas une tasse');

  // Une face dont l'identifiant désigne un DESSOUS est refusée aussi : les
  // catégories ne sont pas décoratives, elles disent où le morceau se pose.
  const melange = chiffrerTasse({
    produitId: parCat('produit', 'Tasse Céramique 350 ml'),
    face1Id: parCat('dessous', 'Aucune'),
    face2Id: '', dessousId: '', batId: '',
  }, articles, taux);
  assert.ok(melange.error && /face 1/.test(melange.error),
    'un morceau ne se pose pas dans la catégorie d’un autre');

  console.log('✓ tasse : 16 / 14 / 22 € au rayon, +6 € pour le logo du client, et le coût compte le temps');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
