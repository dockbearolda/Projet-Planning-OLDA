'use strict';

// ===========================================================================
// LA FICHE SE DESSINE POUR DE VRAI (30/08/2026)
// ===========================================================================
// Tous les autres contrôles de la fiche LISENT son texte : ils vérifient qu'une
// règle est écrite, qu'un appel a la bonne forme, qu'un nom a disparu. Aucun ne
// l'EXÉCUTE — et c'est ce trou qui a laissé passer DEUX fois le même défaut
// dans la même journée :
//
//   · en retirant la pastille de confirmation, la déclaration d'`empiler` — la
//     ligne d'à côté — est partie avec elle. Plus rien ne s'enregistrait dès
//     qu'une valeur changeait vraiment ;
//   · en remplaçant le champ de l'heure par un menu, l'appel qui construit la
//     date du retrait (`ligneDate('Retrait par le client', …)`) est parti de la
//     même façon. La fiche ne s'ouvrait plus du tout.
//
// Dans les deux cas la syntaxe restait valable, `node --check` passait, et les
// 126 contrôles restaient verts. C'est un DESSIN qu'il fallait, pas une lecture.
//
// CE QUE CE CONTRÔLE FAIT : il monte un document minuscule — juste ce que la
// fiche touche — et il appelle `dessinerFicheAtelier` sur un dossier complet
// puis sur un dossier NU. Toute erreur de référence, tout appel à quelque chose
// qui n'existe plus, tombe ici. Il ne juge pas l'apparence : c'est le travail
// des autres.

const assert = require('node:assert');

// LE BANC EST PARTAGÉ depuis le 04/09 : `test/fiche-dessin.js`. Un deuxième
// contrôle en a eu besoin, et un banc recopié devient deux bancs.
const { dessiner, ctx } = require('./fiche-dessin.js');

// --- 1. UN DOSSIER COMPLET -------------------------------------------------
{
  const r = {
    id: 1,
    billing_company: 'Beach Bar Orient',
    product: 'T-shirt unisexe léger Pro 145 g',
    contact_phone: '0690778899',
    contact_referent: 'Nathalie R.',
    responsable: 'Mélina',
    client_type: 'pro',
    provenance: '',
    deadline: '2026-09-05',
    project_value: 1399.32,
    cout_revient: 605.55,
    acompte_montant: null,
    acompte_date: null,
    paiement_mode: 'cb',
    paye: false,
    priority: 2,
    stage: 'a',
    sub_stage: 'b',
    description: 'Devis parti le 15',
    fiche: {
      ref: 'DEMO-1000',
      heureSouhaitee: '14:30',
      prod: {
        ref: 'K3025',
        couleur: 'Bleu marine',
        marquage: 'DTF',
        encre: '',
        tailles: [{ t: 'S', n: 5 }, { t: 'M', n: 25 }, { t: 'L', n: 15 }],
        logos: [{ face: 'Coeur' }],
      },
    },
  };
  assert.doesNotThrow(() => dessiner(r, ctx),
    'la fiche se dessine sur un dossier complet');
}

// --- 2. UN DOSSIER NU ------------------------------------------------------
// `fiche.prod` n'existe sur AUCUN des dossiers de la production (mesuré le
// 29/08 : 0 sur 187). C'est le cas NORMAL, pas le cas limite.
{
  const nu = { id: 2, billing_company: '', product: '', stage: 'a', sub_stage: null, fiche: {} };
  assert.doesNotThrow(() => dessiner(nu, { ...ctx, marquage: null, lotDossier: '' }),
    'la fiche se dessine sur un dossier nu — ni production, ni prix, ni faces');
}

// --- 3. ET SANS LES CROCHETS FACULTATIFS DU CONTEXTE -----------------------
// `app.js` les pose tous, mais la fiche les garde tous derrière un `&&` ou un
// `?` : ce contrôle vérifie que c'est encore vrai.
{
  const minimal = {
    patchLigne: () => Promise.resolve(),
    patchFiche: () => Promise.resolve(),
    patchProd: () => Promise.resolve(),
    fermer: () => {},
    etapes: [],
    employes: [],
    provenances: [],
    reglements: [],
    types: [],
  };
  const r = { id: 3, stage: 'a', sub_stage: null, fiche: { prod: { tailles: [], logos: [] } } };
  assert.doesNotThrow(() => dessiner(r, minimal),
    'la fiche se dessine même quand le contexte ne porte que ses trois écritures');
}

console.log('✓ fiche atelier : elle se DESSINE — dossier complet, dossier nu, contexte minimal');
