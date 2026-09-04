'use strict';

// ===========================================================================
// CLIQUER SUR UNE COMMANDE DU COMPTOIR REND CE QUE LA VENDEUSE A SAISI
// (04/09/2026)
// ===========================================================================
// Charlie, 04/09 : « il est primordial que sur les commandes que la vendeuse
// rentre en boutique, elle puisse en cliquant dessus retrouver toutes les
// informations — actuellement il n'y a rien, c'est complètement vide quand on
// clique dessus. Les références, couleurs, etc. doivent rester dessus, c'est
// obligatoire. »
//
// CE N'ÉTAIT PAS UNE PERTE DE DONNÉES. Tout est en base, intact : le serveur
// archive la prise de commande ENTIÈRE dans `requests.fiche`
// (`kind: 'comptoir-v17'`) — deux blocs de paires libellé/valeur (`client` et
// `details`) plus `production`, la ligne qui porte les références et les
// couleurs de marquage. Mesuré en production le 04/09 :
//
//     215 dossiers, dont 82 venus du comptoir ;
//     82 sur 82 portent `details` (21 à 55 paires, 36 en moyenne) ;
//     82 sur 82 portent `production` ;
//     84 portent `client`.
//
// PERSONNE NE LES AFFICHAIT. Le tiroir qui les rouvrait « ligne à ligne » — le
// commentaire de `server.js` le dit encore — a été retiré le 29/08 (`6ba6d0f`,
// « le tiroir mort est retiré »). Il était mort au sens strict : plus rien
// n'appelait `openLigneDrawer` depuis que la fiche atelier avait pris sa place
// la veille. Mais il était le SEUL à lire `fiche.details` et `fiche.client`, et
// la fiche atelier ne les a jamais repris. L'écran a continué de s'ouvrir,
// simplement vide de tout ce que la vendeuse avait tapé.
//
// `fiche.production` avait sa propre justification, écrite dans le module :
// « zéro dossier sur 187 le portait en production ». C'était vrai le 29/08.
// Le comptoir a commencé à le remplir ensuite : 82 sur 215 aujourd'hui. Un
// chiffre qui a servi à retirer du code doit se remesurer avant qu'on s'appuie
// dessus une deuxième fois.
//
// CE CONTRÔLE DESSINE LA FICHE POUR DE VRAI et lit ce qu'elle a écrit. Une
// assertion sur le source (« le module cite fiche.details ») aurait passé le
// jour où quelqu'un lit la valeur sans jamais l'afficher.

const assert = require('node:assert');
const { dessiner, ctx, texteRendu } = require('./fiche-dessin.js');

// --- UN DOSSIER DU COMPTOIR, dans la forme EXACTE que le serveur archive ----
// Reprise d'un dossier réel de la production (04/09, « Nicolas B ») : mêmes
// clés, mêmes intitulés, mêmes formes. Les valeurs sont maquillées.
const DOSSIER = {
  id: 42,
  billing_company: 'Nicolas B',
  product: 'Sweat capuche',
  client_type: 'perso',
  stage: 'preparation',
  sub_stage: 'prepa_produits',
  description: 'Délai souhaité : Sous 5 jours ouvrés (urgent)',
  project_value: 35,
  fiche: {
    kind: 'comptoir-v17',
    source: 'Vente directe',
    ref: '26.09.04-002',
    creeLe: '2026-09-04T15:25:02.239Z',
    heureSouhaitee: '14:00',
    // CE QUE CHARLIE NOMME « les références couleurs » : la ligne que le
    // parcours écrit pour l'atelier, marquage par marquage.
    production: 'H-016 - Wet sand - L \nAR = SUR-07 Noir\nAV = FLE-pi Noir',
    commentaire: 'Délai souhaité : Sous 5 jours ouvrés (urgent)',
    destination: { stage: 'preparation', subStage: 'prepa_produits' },
    client: [
      { k: 'Type de client', v: 'Particulier' },
      { k: 'Nom / société', v: 'Nicolas B' },
      { k: 'WhatsApp', v: '06 78 98 69 03' },
      { k: 'E-mail', v: 'Non renseigné' },
    ],
    details: [
      { k: 'Type de dossier', v: 'Vente directe' },
      { k: 'Commande', v: '26.09.04-002' },
      { k: 'Date de la vente', v: '04/09/2026 11:25:16' },
      { k: 'Récupération prévue', v: '11/09/2026 à 14:00' },
      { k: 'Délai souhaité', v: 'Sous 5 jours ouvrés (urgent)' },
      { k: 'Nombre d’articles', v: '1' },
      { k: 'Article 1 — Désignation', v: 'Sweat capuche H-016 Wet sand' },
      { k: 'Article 1 — Quantité', v: '1' },
      { k: 'Article 1 — Prix article', v: '35,00 €' },
      { k: 'Article 1 — Description de production', v: 'AR = SUR-07 Noir / AV = FLE-pi Noir' },
      { k: 'Total TTC', v: '35,00 €' },
      { k: 'Paiement', v: 'Paiement au retrait' },
    ],
  },
};

const rendu = (() => {
  let sortie;
  assert.doesNotThrow(() => { sortie = dessiner(DOSSIER, ctx); },
    'la fiche se dessine sur un dossier venu du comptoir');
  return texteRendu(sortie);
})();

// --- 1. LES RÉFÉRENCES ET LES COULEURS, EN TOUTES LETTRES ------------------
// C'est la demande, mot pour mot. Elles vivent dans `fiche.production`, et
// c'est ce qu'il y a À PRODUIRE : elles ne se replient pas.
for (const attendu of ['H-016', 'Wet sand', 'SUR-07 Noir', 'FLE-pi Noir']) {
  assert.ok(rendu.includes(attendu),
    `« ${attendu} » doit se lire dans la fiche : c'est une référence ou une couleur de marquage, `
    + 'et la vendeuse la retrouve en cliquant sur sa commande');
}

// --- 2. ET TOUT LE RESTE DE LA PRISE DE COMMANDE ---------------------------
// « toutes les informations » : chaque paire archivée se retrouve, libellé ET
// valeur. Une seule paire perdue et le contrôle le dit — on ne choisit pas à
// la place de la vendeuse ce qui mérite d'être relu.
for (const paire of [...DOSSIER.fiche.details, ...DOSSIER.fiche.client]) {
  assert.ok(rendu.includes(paire.k),
    `l’intitulé « ${paire.k} » doit se lire dans la fiche`);
  assert.ok(rendu.includes(paire.v),
    `la valeur « ${paire.v} » (${paire.k}) doit se lire dans la fiche`);
}

// --- 3. UN DOSSIER QUI N'EN VIENT PAS NE GAGNE RIEN ------------------------
// Les 133 dossiers qui ne viennent pas du comptoir n'ont ni `details` ni
// `client` : la fiche ne doit pas leur poser un bloc vide. Un cadre autour de
// rien est exactement ce que la charte du dépôt appelle un défaut.
{
  const nu = { id: 43, billing_company: 'Sans comptoir', stage: 'a', sub_stage: null, fiche: {} };
  let sortie;
  assert.doesNotThrow(() => { sortie = dessiner(nu, { ...ctx, marquage: null, lotDossier: '' }); },
    'la fiche se dessine encore sur un dossier sans prise de commande archivée');
  const texte = texteRendu(sortie);
  assert.ok(!texte.includes('Saisi au comptoir'),
    'aucun bloc « Saisi au comptoir » sur un dossier qui n’en vient pas');
}

console.log('✓ fiche : cliquer sur une commande du comptoir rend les références, les couleurs et toute la saisie');
