-- Planning OLDA — schéma de base
-- Extension nécessaire pour gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage           text NOT NULL DEFAULT 'demande',
  priority        int  NOT NULL DEFAULT 1,
  client_type     text DEFAULT 'pro',
  billing_company text,
  contact_referent text,
  contact_phone   text,
  contact_email   text,
  quantity        int,
  product         text,
  project_value   numeric(12,2),
  description     text,
  deadline        date,
  status          text,
  position        double precision,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Index pour le tri/filtre par étape
CREATE INDEX IF NOT EXISTS idx_requests_stage ON requests (stage);
CREATE INDEX IF NOT EXISTS idx_requests_stage_sort ON requests (stage, priority DESC, deadline ASC);

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
