'use strict';

// FABRIQUER UN DOSSIER PAR LA PORTE QUE LES POSTES EMPRUNTENT
// ===========================================================================
// Huit tests avaient besoin d'« une commande au planning » pour vérifier tout
// autre chose : la synthèse, un verrou, un code client, une destination. Ils la
// fabriquaient par `POST /api/projets` — l'ancien « Nouveau Projet » interne,
// que plus aucun écran n'appelait depuis le 31/07 et qui est parti le 01/09.
//
// La leçon de ce jour-là : un test qui passe par une porte que personne
// n'emprunte finit par protéger cette porte, pas le métier. Le socle fabrique
// donc un dossier comme le comptoir en fabrique un, par la seule route vivante
// (`POST /api/comptoir/projet`). Le jour où cette route change, les huit tests
// le diront ensemble.
//
// CE QUE LE COMPTOIR NE SAIT PAS FAIRE, ET QUE L'ANCIENNE ROUTE FAISAIT :
// poser une technique de marquage dans la fiche (`fiche.lignes[].faces[]`).
// Ce n'est pas une limite du socle, c'est l'état de l'application — voir
// ARCHITECTURE.md, « la pondération machine n'est plus alimentée ».

// Un dossier de comptoir, dans la forme que les deux écrans envoient.
// `call` est la fonction d'appel du test (méthode, chemin, corps).
async function creerDossier(call, options = {}) {
  const o = options || {};
  const suffixe = Math.random().toString(36).slice(2, 8);
  const corps = {
    source: o.demande ? 'Demande de devis' : 'Vente directe',
    // La référence identifie UNE prise de commande : deux dossiers du même test
    // ne doivent pas se confondre, sinon le serveur rend le premier (c'est
    // exactement ce qu'il doit faire face à un renvoi réseau).
    ref: o.ref || `TEST-${suffixe}`,
    clientObj: o.clientObj || {
      type: o.perso ? 'Particulier' : 'Professionnel',
      company: o.societe || `Atelier Test ${suffixe}`,
      name: o.nom || null,
      email: o.email || null,
      phone: o.tel || null,
      contact: o.contact || null,
    },
    name: o.nomDossier || `Commande ${suffixe}`,
    stage: o.stage || 'Préparation du projet',
    status: o.status || '',
    amount: o.montant === undefined ? 120 : o.montant,
    quantity: o.quantite === undefined ? 3 : o.quantite,
    comment: o.description || 'Dossier fabriqué par un test',
    recap: o.recap || 'Récapitulatif de test',
    ...(o.paiement ? { paiement: o.paiement } : {}),
    ...(o.articles ? { articles: o.articles } : {}),
    ...(o.due ? { due: o.due } : {}),
    ...(o.dueTime ? { dueTime: o.dueTime } : {}),
    ...(o.enPlus || {}),
  };
  const r = await call('POST', '/api/comptoir/projet', corps);
  if (r.status !== 201) {
    throw new Error(`le dossier de test n’a pas été créé (${r.status}) : ${JSON.stringify(r.body)}`);
  }
  return r.body;   // { id, stage, subStage, destination, … }
}

module.exports = { creerDossier };
