-- Planning OLDA — schéma de base
-- Extension nécessaire pour gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage           text NOT NULL DEFAULT 'demande',   -- FAMILLE (8 grandes étapes + fiverr)
  sub_stage       text,                              -- SOUS-FAMILLE (précise l'action en cours ; null si la famille n'en a pas)
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
  status          text,
  position        double precision,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Clé/valeur applicative : sert de garde d'idempotence aux migrations de données
-- ponctuelles (ex. bascule du pipeline linéaire vers le modèle « familles »).
CREATE TABLE IF NOT EXISTS app_meta (
  key   text PRIMARY KEY,
  value text
);

-- Index pour le tri/filtre par étape
CREATE INDEX IF NOT EXISTS idx_requests_stage ON requests (stage);
CREATE INDEX IF NOT EXISTS idx_requests_stage_sort ON requests (stage, priority DESC, deadline ASC);

-- Secteurs de production rattachés à une commande (relation 1 commande ↔ N machines).
-- Une commande en production (stage = 'production') porte une ligne par secteur
-- qu'elle doit traverser ; « done » = cette machine a fait sa part.
CREATE TABLE IF NOT EXISTS production_sectors (
  request_id  uuid    NOT NULL,
  sector      text    NOT NULL,
  done        boolean NOT NULL DEFAULT false,
  position    double precision,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, sector)
);
CREATE INDEX IF NOT EXISTS idx_prodsec_sector  ON production_sectors (sector, done);
CREATE INDEX IF NOT EXISTS idx_prodsec_request ON production_sectors (request_id);

-- États de commande (liste éditable : créés / supprimés depuis le menu d'état).
-- Le champ requests.status stocke le LIBELLÉ ; la couleur est retrouvée ici par
-- libellé. Une commande dont l'état a été supprimé garde son texte (sans couleur).
CREATE TABLE IF NOT EXISTS statuses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL,
  color      text NOT NULL,                 -- couleur hex « #rrggbb »
  position   double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

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
