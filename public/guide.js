// ===========================================================================
// Guide des étapes — texte du patron (feuille « Descriptif Étapes » du CRM).
// Pour chaque famille et sous-catégorie : à quoi sert l'étape, qui agit, quand
// y mettre le projet, quand le sortir. Affiché en clair dans l'app pour que
// chaque employé comprenne immédiatement quoi faire. Clé = slug (famille ou
// sous-étape), identique à db.js / app.js.
// ===========================================================================
export const STEP_GUIDE = {
  demande: {
    desc: 'Point d’entrée de toutes les nouvelles demandes. On classe immédiatement l’intérêt commercial pour éviter de traiter uniquement les dossiers les plus faciles.',
    who: 'Mélina / Loïc / personne qui reçoit la demande',
    whenIn: 'Dès qu’une nouvelle demande arrive par boutique, WhatsApp, e-mail ou téléphone.',
    whenOut: 'Quand la demande est suffisamment claire pour être chiffrée.',
  },
  chiffrage: {
    desc: 'Étape où OLDA travaille sur le prix, la faisabilité et le devis. Tant que le devis n’est pas envoyé, l’action est chez nous.',
    who: 'Mélina / Loïc / Charlie selon besoin technique',
    whenIn: 'Quand la demande est suffisamment claire pour calculer un prix.',
    whenOut: 'Dès que le devis est envoyé au client → Attente Client.',
  },
  a_chiffrer: {
    desc: 'La demande est suffisamment claire, mais il faut calculer le prix : produits, fournisseurs, marquage, transport, temps de production, marge, etc.',
    who: 'Commercial / chiffrage',
    whenIn: 'Dès que la demande est exploitable.',
    whenOut: 'Quand quelqu’un commence réellement le travail ou que le devis est prêt.',
  },
  chiffrage_en_cours: {
    desc: 'Quelqu’un travaille réellement dessus, notamment si le projet nécessite recherche fournisseur, test ou calcul particulier.',
    who: 'Responsable du chiffrage',
    whenIn: 'Dès qu’une personne prend le dossier en main.',
    whenOut: 'Quand le prix est validé et le devis prêt à être envoyé.',
  },
  devis_a_envoyer: {
    desc: 'Le prix est terminé et validé ; il reste simplement à créer ou finaliser le devis puis à l’envoyer.',
    who: 'Mélina / administratif',
    whenIn: 'Quand tous les éléments de prix sont prêts.',
    whenOut: 'Dès que le devis est envoyé → Attente Client.',
  },
  attente_client: {
    desc: 'Projet en attente d’une réponse, validation, information, fichier ou paiement du client avant de pouvoir poursuivre.',
    who: 'Client ; OLDA suit et relance',
    whenIn: 'Dès qu’OLDA ne peut plus avancer sans une action du client.',
    whenOut: 'Dès que l’élément attendu est reçu. Le projet revient dans l’étape appropriée.',
  },
  preparation: {
    desc: 'Le projet est validé. On transforme le dossier commercial en dossier réellement exécutable : stock, commandes, fichiers, produits et instructions.',
    who: 'Charlie / Mélina / atelier selon tâche',
    whenIn: 'Dès que le client a validé le projet et que le lancement est autorisé.',
    whenOut: 'Quand tout est prêt → Production.',
  },
  prepa_fichiers: {
    desc: 'Projet validé à prendre en charge : vérifier les besoins et le stock, puis préparer les produits, fichiers et éléments nécessaires à la production.',
    who: 'Charlie / atelier / Mélina',
    whenIn: 'Porte d’entrée normale d’un projet validé.',
    whenOut: 'Vers À commander si manque de stock, ou Prêt à produire si tout est prêt.',
  },
  a_commander: {
    desc: 'Un ou plusieurs produits nécessaires au projet doivent être commandés.',
    who: 'Personne responsable des achats',
    whenIn: 'Quand un manque de stock ou de matière est identifié.',
    whenOut: 'Dès que la commande fournisseur est passée → Attente marchandise.',
  },
  attente_marchandise: {
    desc: 'La commande fournisseur est passée. Le projet attend la réception des produits pour avancer.',
    who: 'Fournisseur ; OLDA suit la réception',
    whenIn: 'Dès que la commande fournisseur est passée.',
    whenOut: 'À réception → retour Préparation fichiers & produits.',
  },
  pret_a_produire: {
    desc: 'Tout est disponible, vérifié et préparé. La production peut démarrer sans information manquante.',
    who: 'Charlie / atelier',
    whenIn: 'Quand produits, fichiers et instructions sont complets.',
    whenOut: 'Dès qu’un opérateur commence réellement la fabrication → Production.',
  },
  production: {
    desc: 'L’atelier réalise physiquement le projet. Un même projet peut nécessiter plusieurs opérations successives.',
    who: 'Charlie / opérateur de production',
    whenIn: 'Quand un projet est réellement prêt et qu’une opération de fabrication commence.',
    whenOut: 'Après contrôle & emballage → Facturation / Retrait.',
  },
  prod_dtf: {
    desc: 'Fichiers à imprimer en DTF avant pressage.',
    who: 'Opérateur DTF',
    whenIn: 'Quand le projet nécessite une impression DTF.',
    whenOut: 'Quand les DTF nécessaires sont produits ; passer à l’opération suivante.',
  },
  prod_pressage: {
    desc: 'Produits à personnaliser à la presse avec les DTF préparés.',
    who: 'Opérateur pressage',
    whenIn: 'Quand DTF + produits sont prêts.',
    whenOut: 'Quand tous les pressages sont terminés.',
  },
  prod_trotec: {
    desc: 'Projet nécessitant une gravure ou découpe laser.',
    who: 'Opérateur Trotec',
    whenIn: 'Quand fichiers, supports et paramètres sont prêts.',
    whenOut: 'Quand gravure/découpe est terminée.',
  },
  prod_uv: {
    desc: 'Projet nécessitant une impression UV.',
    who: 'Opérateur UV',
    whenIn: 'Quand fichiers et supports sont prêts.',
    whenOut: 'Quand l’impression UV est terminée.',
  },
  montage_finition: {
    desc: 'Assemblage, collage, nettoyage ou finition nécessaire après fabrication.',
    who: 'Atelier',
    whenIn: 'Quand une étape de finition reste à faire.',
    whenOut: 'Quand le produit est physiquement finalisé.',
  },
  controle_emballage: {
    desc: 'La production est terminée. Vérifier la qualité, les quantités et la conformité de la commande, puis nettoyer, regrouper et emballer les produits avant transmission.',
    who: 'Charlie / atelier',
    whenIn: 'Quand toutes les opérations de fabrication sont terminées.',
    whenOut: 'Quand la commande est complète, conforme et emballée → Facturation / Retrait.',
  },
  facturation: {
    desc: 'La commande physique est terminée. On finalise l’administratif et on prépare la sortie de la commande vers le client.',
    who: 'Mélina / boutique / administratif',
    whenIn: 'Quand l’atelier a terminé contrôle & emballage.',
    whenOut: 'Quand la commande est remise/livrée/expédiée → Terminé.',
  },
  facturation_a_faire: {
    desc: 'La production, le contrôle et l’emballage sont terminés. La facture finale doit être préparée et le solde vérifié.',
    who: 'Mélina / administratif',
    whenIn: 'Dès transmission par l’atelier.',
    whenOut: 'Quand la facture est prête et le client peut être informé.',
  },
  pret_retrait: {
    desc: 'La commande est terminée et facturée. Le client a été prévenu et la commande attend d’être récupérée.',
    who: 'Boutique / administratif',
    whenIn: 'Quand la commande est disponible pour le client.',
    whenOut: 'Dès que la commande est remise/livrée/expédiée.',
  },
  termine: {
    desc: 'Le projet est terminé opérationnellement. Il ne reste éventuellement qu’un suivi financier avant archivage.',
    who: 'Administratif / direction',
    whenIn: 'Dès que la commande a quitté OLDA.',
    whenOut: 'Quand tout est payé et clôturé → Archivé.',
  },
  attente_paiement: {
    desc: 'La commande a été remise, livrée ou expédiée, mais un règlement client reste à recevoir.',
    who: 'Administratif / comptabilité',
    whenIn: 'Quand le client a reçu la commande mais n’a pas encore soldé.',
    whenOut: 'Dès réception du règlement → Soldé.',
  },
  solde: {
    desc: 'La commande est remise/livrée et entièrement payée. Aucune action restante.',
    who: 'Administratif',
    whenIn: 'Quand tout est terminé et payé.',
    whenOut: 'Quand le dossier est définitivement classé → Archivé.',
  },
  archive: {
    desc: 'Dossier entièrement clôturé : commande terminée, remise/livrée, facturation finalisée, paiement reçu et aucune action restante. Conservé uniquement dans l’historique.',
    who: 'Aucune action opérationnelle',
    whenIn: 'Quand le projet est soldé et qu’aucune action ne reste.',
    whenOut: 'Ne sort plus : historique uniquement.',
  },
};
