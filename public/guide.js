// ===========================================================================
// Guide des étapes — texte du patron (feuille « Descriptif Étapes » du CRM).
// Pour chaque famille et sous-catégorie : à quoi sert l'étape, qui agit, quand
// y mettre le projet, quand le sortir. Affiché en clair dans l'app pour que
// chaque employé comprenne immédiatement quoi faire. Clé = slug (famille ou
// sous-étape), identique à db.js / app.js.
// ===========================================================================
export const STEP_GUIDE = {
  demande_chiffrage: {
    desc: 'Tout le commercial, de la demande reçue au devis validé. Tant que le client n’a pas dit oui, le dossier vit ici.',
    who: 'Mélina / Loïc / personne qui reçoit la demande',
    whenIn: 'Dès qu’une nouvelle demande arrive par boutique, WhatsApp, e-mail ou téléphone.',
    whenOut: 'Quand le client a validé le devis → Préparation du projet.',
  },
  demande_recue: {
    desc: 'Point d’entrée de toutes les nouvelles demandes. Rien n’est encore trié : on note ce que le client veut.',
    who: 'Personne qui reçoit la demande',
    whenIn: 'À l’instant où la demande arrive.',
    whenOut: 'Dès qu’on prend le temps de la regarder sérieusement.',
  },
  demande_a_qualifier: {
    desc: 'On classe immédiatement l’intérêt commercial, pour éviter de traiter uniquement les dossiers les plus faciles. On complète ce qui manque pour pouvoir chiffrer.',
    who: 'Mélina / Loïc',
    whenIn: 'Quand la demande est lue mais encore floue ou incomplète.',
    whenOut: 'Quand la demande est suffisamment claire pour être chiffrée.',
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
    whenOut: 'Quand le prix est validé et le devis envoyé au client.',
  },
  devis_envoye: {
    desc: 'Le tarif ou le devis est parti chez le client. L’action n’est plus chez nous : on suit et on relance.',
    who: 'Client ; OLDA suit et relance',
    whenIn: 'Dès que le tarif ou le devis est envoyé.',
    whenOut: 'Dès que le client répond — accord → Devis validé, refus → dossier clos.',
  },
  devis_valide: {
    desc: 'Le client a dit oui. Le dossier commercial est bouclé, le projet peut être lancé en atelier.',
    who: 'Mélina / administratif',
    whenIn: 'À la validation du client (mail, WhatsApp, signature, accord au comptoir).',
    whenOut: 'Dès que la préparation démarre → Préparation du projet.',
  },
  preparation: {
    desc: 'Le projet est validé. On transforme le dossier commercial en dossier réellement exécutable : stock, commandes, fichiers, BAT, produits et instructions.',
    who: 'Charlie / Mélina / atelier selon tâche',
    whenIn: 'Dès que le client a validé le projet et que le lancement est autorisé.',
    whenOut: 'Quand tout est prêt → Production.',
  },
  prepa_produits: {
    desc: 'Vérifier les besoins et le stock, puis préparer les produits, fichiers et éléments nécessaires à la production.',
    who: 'Charlie / atelier / Mélina',
    whenIn: 'Porte d’entrée normale d’un projet validé.',
    whenOut: 'Vers À commander si manque de stock, ou vers la préparation du BAT.',
  },
  prepa_bat: {
    desc: 'Réalisation du bon à tirer : visuel, placement, dimensions et couleurs, tels que le client les verra sur le produit fini.',
    who: 'Charlie / graphiste (ou sous-traitance Fiverr)',
    whenIn: 'Quand les produits et les fichiers sources sont réunis.',
    whenOut: 'Dès que le BAT est envoyé au client.',
  },
  bat_envoye: {
    desc: 'Le BAT est parti chez le client, qui doit le valider avant toute production. Rien ne se lance sans son accord écrit.',
    who: 'Client ; OLDA suit et relance',
    whenIn: 'Dès l’envoi du BAT.',
    whenOut: 'À la réponse du client — accord → BAT validé, correction → retour Préparation du BAT.',
  },
  bat_valide: {
    desc: 'Le client a validé le visuel. Ce qui sera produit est désormais figé et opposable.',
    who: 'Mélina / administratif',
    whenIn: 'À la validation écrite du client.',
    whenOut: 'Vers la validation de l’acompte et des conditions de paiement.',
  },
  validation_acompte: {
    desc: 'On s’assure que les conditions de paiement sont posées et l’acompte encaissé avant d’engager la matière et les machines.',
    who: 'Mélina / Loïc',
    whenIn: 'Dès que le BAT est validé.',
    whenOut: 'Quand l’acompte est versé (ou l’encours accordé) → commande fournisseur ou production.',
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
    whenOut: 'À réception → Prêt à produire.',
  },
  pret_a_produire: {
    desc: 'Tout est disponible, vérifié et préparé. La production peut démarrer sans information manquante.',
    who: 'Charlie / atelier',
    whenIn: 'Quand produits, fichiers, BAT validé et instructions sont complets.',
    whenOut: 'Dès qu’un opérateur commence réellement la fabrication → Production.',
  },
  production: {
    desc: 'L’atelier réalise physiquement le projet. Un même projet peut nécessiter plusieurs opérations successives.',
    who: 'Charlie / opérateur de production',
    whenIn: 'Quand un projet est réellement prêt et qu’une opération de fabrication commence.',
    whenOut: 'Après contrôle & emballage → Facturation & remise au client.',
  },
  prod_dtf: {
    desc: 'Fichiers à imprimer en DTF avant pressage.',
    who: 'Opérateur DTF',
    whenIn: 'Quand le projet nécessite une impression DTF.',
    whenOut: 'Quand les DTF nécessaires sont imprimés → Découpe & contrôle.',
  },
  decoupe_dtf: {
    desc: 'Découpe des transferts imprimés et contrôle avant pressage : netteté, couleurs, dimensions, absence de manque.',
    who: 'Opérateur DTF',
    whenIn: 'Dès que l’impression DTF est sortie.',
    whenOut: 'Quand les transferts sont découpés et conformes → Pressage.',
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
    whenOut: 'Quand la commande est complète, conforme et emballée → Facturation & remise au client.',
  },
  facturation: {
    desc: 'La commande physique est terminée. On finalise l’administratif et on prépare la sortie de la commande vers le client.',
    who: 'Mélina / boutique / administratif',
    whenIn: 'Quand l’atelier a terminé contrôle & emballage.',
    whenOut: 'Quand la commande est récupérée par le client → Paiement & clôture.',
  },
  facturation_a_faire: {
    desc: 'La production, le contrôle et l’emballage sont terminés. La facture finale doit être préparée et le solde vérifié.',
    who: 'Mélina / administratif',
    whenIn: 'Dès transmission par l’atelier.',
    whenOut: 'Quand la facture est prête et le client peut être informé.',
  },
  client_a_prevenir: {
    desc: 'La commande est prête et facturée : il reste à prévenir le client qu’il peut venir la chercher.',
    who: 'Boutique / administratif',
    whenIn: 'Dès que la facture est prête.',
    whenOut: 'Dès que le client a été prévenu (WhatsApp, appel, mail).',
  },
  client_prevenu: {
    desc: 'Le client a été prévenu ; la commande attend d’être récupérée en boutique.',
    who: 'Client ; boutique suit et relance',
    whenIn: 'Une fois le message ou l’appel passé.',
    whenOut: 'Dès que la commande est remise, livrée ou expédiée.',
  },
  commande_recuperee: {
    desc: 'La commande a quitté OLDA. Il ne reste que le volet financier.',
    who: 'Boutique / administratif',
    whenIn: 'À la remise, la livraison ou l’expédition.',
    whenOut: 'Dès le contrôle du règlement → Paiement & clôture.',
  },
  paiement: {
    desc: 'Le projet est terminé opérationnellement. Il ne reste que le suivi financier, puis l’archivage.',
    who: 'Administratif / direction',
    whenIn: 'Dès que la commande a quitté OLDA.',
    whenOut: 'Quand tout est payé et classé → Archivé.',
  },
  paiement_a_controler: {
    desc: 'La commande a été remise, livrée ou expédiée, mais un règlement client reste à recevoir ou à vérifier.',
    who: 'Administratif / comptabilité',
    whenIn: 'Quand le client a reçu la commande mais n’a pas encore soldé.',
    whenOut: 'Dès réception et contrôle du règlement → Paiement validé / Soldé.',
  },
  paiement_valide: {
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
