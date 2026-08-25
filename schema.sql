-- Planning OLDA — schéma de base
-- Extension nécessaire pour gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage           text NOT NULL DEFAULT 'demande_chiffrage',   -- FAMILLE (5 grandes étapes + fiverr)
  sub_stage       text,                              -- SOUS-FAMILLE (précise l'action en cours ; null si la famille n'en a pas)
  order_kind      text,                              -- NATURE tranchée à la prise : 'demande' (à chiffrer) / 'commande' (validée) ; null = ancienne ligne
  responsable     text,                              -- PILOTE : qui pilote le projet (Loïc / Charlie / Mélina / Julien / À attribuer)
  referent        text,                              -- RÉFÉRENT : 2e personne rattachée à la tâche (même liste d'employés ; null si aucun)
  priority        int  NOT NULL DEFAULT 1,
  client_type     text DEFAULT 'pro',                -- pro / perso / asso / revendeur
  billing_company text,
  contact_referent text,
  contact_phone   text,
  contact_email   text,
  quantity        int,
  product         text,
  color           text,
  project_value   numeric(12,2),
  description     text,
  deadline        date,
  -- La colonne `status` a vécu ici. Reliquat du modèle d'avant les familles :
  -- l'état d'une commande vit dans `stage` / `sub_stage`, son alerte dans
  -- `flag`. Plus personne ne l'écrivait ni ne la lisait, et elle repartait
  -- pourtant vers chaque poste, sur chaque ligne, à chaque rafraîchissement.
  -- Retirée du schéma, et supprimée au démarrage UNIQUEMENT si elle est vide
  -- partout (voir retirerColonneStatus dans db.js).
  -- Down : ALTER TABLE requests ADD COLUMN IF NOT EXISTS status text;
  -- SUIVI DU PAIEMENT (null = on ne se prononce pas). `acompte_montant` est la
  -- somme réellement encaissée ; `project_value` reste le total TTC du projet.
  acompte_demande boolean,
  acompte_verse   boolean,
  acompte_montant numeric(12,2),
  paye            boolean,
  paiement_mode   text,                              -- 'cb' / 'especes' / 'virement' / 'cheque'
  flag            text,                              -- ALERTE : null / 'bloque' / 'a_voir' (posée par n'importe quel collaborateur)
  flag_reason     text,                              -- MOTIF libre de l'alerte (« BLOQUÉE — attente BAT client »)
  position        double precision,
  fiche           jsonb,                             -- détail de la fiche vendeuse (null si créée à la main)
  -- ARCHIVAGE, pas suppression. Une commande retirée du planning garde sa ligne,
  -- son journal et ses PDF : c'est la seule façon de répondre « qu'est-ce qui
  -- est arrivé au dossier de l'Hôtel X ? » six mois plus tard. `DELETE FROM
  -- requests` détruisait la ligne ET, en cascade, tout son historique.
  -- null = vivante (le cas courant, donc pas de valeur par défaut à écrire).
  -- Down : ALTER TABLE requests DROP COLUMN IF EXISTS deleted_at;
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Clé/valeur applicative : sert de garde d'idempotence aux migrations de données
-- ponctuelles (ex. bascule du pipeline linéaire vers le modèle « familles »).
CREATE TABLE IF NOT EXISTS app_meta (
  key   text PRIMARY KEY,
  value text
);

-- Journal des modifications d'une commande : une ligne par champ suivi qui a
-- changé (étape, état, prix, échéance…). Ce que l'application NE sait PAS, c'est
-- QUI a fait le changement : elle n'a qu'un mot de passe commun, pas de compte
-- par employé. Down : DROP TABLE request_events;
CREATE TABLE IF NOT EXISTS request_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   uuid NOT NULL,
  field        text NOT NULL,             -- nom de colonne suivi (voir JOURNAL_FIELDS)
  value_before text,
  value_after  text,
  -- QUI a fait le changement. Le poste l'envoie en en-tête `X-Qui` : c'est le
  -- prénom choisi une fois par appareil (`olda.qui`), pas un compte — donc
  -- déclaratif, jamais une preuve. null = poste qui ne s'est pas nommé, ou
  -- ligne d'avant cette colonne. Le jour où les comptes existent, c'est la
  -- SOURCE qui change (l'utilisateur connecté), pas la colonne.
  -- Down : ALTER TABLE request_events DROP COLUMN IF EXISTS who;
  who          text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_request_events_request ON request_events (request_id, created_at DESC);

-- Index pour le tri/filtre par étape
CREATE INDEX IF NOT EXISTS idx_requests_stage ON requests (stage);
CREATE INDEX IF NOT EXISTS idx_requests_stage_sort ON requests (stage, priority DESC, deadline ASC);
-- `updated_at` est lu à chaque évènement temps réel, par chaque poste : c'est
-- sur lui que porte la synthèse incrémentale du Point du jour
-- (WHERE updated_at >= …) et le classement de la recherche globale. Sans index,
-- chacune de ces lectures parcourt toute la table — et la table ne fait que
-- grossir, aucune commande ne quittant jamais le planning.
-- Down : DROP INDEX IF EXISTS idx_requests_updated;
CREATE INDEX IF NOT EXISTS idx_requests_updated ON requests (updated_at);

-- La table `production_sectors` (1 commande ↔ N machines) a vécu ici. Elle
-- datait du pipeline linéaire : depuis le passage aux 5 familles, la production
-- se lit dans `sub_stage` et plus aucune requête de l'application ne la touche —
-- seule une vieille migration la consulte encore, et elle tolère son absence.
-- Retirée du schéma, et supprimée au démarrage UNIQUEMENT si elle est vide
-- (voir retirerTableProductionSectors dans db.js).
-- Down :
--   CREATE TABLE IF NOT EXISTS production_sectors (
--     request_id uuid NOT NULL, sector text NOT NULL,
--     done boolean NOT NULL DEFAULT false, position double precision,
--     created_at timestamptz NOT NULL DEFAULT now(),
--     PRIMARY KEY (request_id, sector));
--   CREATE INDEX idx_prodsec_sector  ON production_sectors (sector, done);
--   CREATE INDEX idx_prodsec_request ON production_sectors (request_id);

-- La table `statuses` (liste d'états colorés éditable) a vécu ici. Elle a été
-- créée à chaque démarrage sans qu'AUCUNE ligne de code ne l'ait jamais lue ni
-- écrite : l'état d'une commande est porté par `requests.flag` / `flag_reason`
-- depuis le passage aux 5 familles. Retirée du schéma, et supprimée au
-- démarrage UNIQUEMENT si elle est vide (voir db.js).
-- Down :
--   CREATE TABLE IF NOT EXISTS statuses (
--     id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label text NOT NULL,
--     color text NOT NULL, position double precision,
--     created_at timestamptz NOT NULL DEFAULT now());

-- Base clients professionnelle (CRM). Rapatriée de l'ancienne app « Base clients »
-- (Next.js) pour vivre DANS le planning : la prise de commande y puise ses
-- suggestions et y crée automatiquement le client absent. Éditable en place.
-- `type` = catégorie métier LIBRE (Boutique, Hôtel, Entretien…), pas le
-- client_type pro/perso des commandes. Down : DROP TABLE client_notes; DROP TABLE clients;
CREATE TABLE IF NOT EXISTS clients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise  text NOT NULL,                 -- société / marque (obligatoire)
  nom         text,                          -- personne contact
  fonction    text,                          -- son rôle (Gérante, Resp. Marketing…)
  client_type text DEFAULT 'pro',            -- NATURE du client : 'pro' / 'perso' (≠ `type` métier)
  type        text,                          -- catégorie métier libre
  zone        text,                          -- localité (Grand Case, Marigot…)
  email       text,
  telephone   text,
  adresse     text,
  -- Même règle que pour les commandes : une fiche client se DÉSACTIVE, elle ne
  -- s'efface pas. Ses commandes passées la citent, et un client « supprimé »
  -- laisserait des dossiers rattachés à un nom introuvable.
  -- Down : ALTER TABLE clients DROP COLUMN IF EXISTS deleted_at;
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clients_entreprise ON clients (entreprise);

-- Notes & historique d'un client (timeline). kind : note / appel / email / rdv.
CREATE TABLE IF NOT EXISTS client_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid NOT NULL,
  kind       text NOT NULL DEFAULT 'note',
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_notes_client ON client_notes (client_id);

-- Pièces jointes PDF par commande : 2 emplacements fixes par ligne
-- (kind = 'devis' ou 'bat'). Le PDF est stocké en base (base64) car le
-- système de fichiers Railway est éphémère. Table séparée de requests pour
-- ne jamais charger les blobs lors de la liste / du temps réel.
CREATE TABLE IF NOT EXISTS attachments (
  request_id  uuid NOT NULL,
  kind        text NOT NULL,
  filename    text NOT NULL,
  data        text NOT NULL,            -- contenu PDF encodé base64
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, kind)
);
