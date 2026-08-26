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
  -- LE COÛT DE REVIENT de la ligne (§11, §13). Sans lui, aucune marge n'est
  -- calculable : le moteur sort un PRIX, et un prix seul ne dit pas ce qu'on
  -- gagne. Rempli automatiquement par le flux « Nouveau Projet » (qui connaît
  -- les prix d'achat et les temps de la grille tarifaire), saisissable à la main
  -- partout ailleurs. null = coût inconnu, ce qui n'est PAS zéro : une marge
  -- calculée sur un coût nul afficherait 100 % sur tout ce qu'on n'a pas chiffré.
  -- Down : ALTER TABLE requests DROP COLUMN IF EXISTS cout_revient;
  cout_revient    numeric(12,2),
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

-- LES QUATRE PERSONNES DE L'ATELIER, avec leur rôle.
--
-- L'application n'avait qu'un mot de passe commun et JETAIT l'identifiant : les
-- quatre prénoms n'étaient que des étiquettes posées sur `requests.responsable`.
-- Ils deviennent des comptes — mais la population ne change pas, ce sont les
-- mêmes quatre personnes (voir EQUIPE dans db.js).
--
-- `code_hash` : scrypt, jamais le code en clair. null = code pas encore choisi,
-- la personne le pose à sa première connexion. Le mot de passe partagé reste la
-- porte d'entrée du site : ce code-ci ne protège pas de l'extérieur, il dit
-- QUI est au poste parmi quatre personnes déjà entrées.
-- Down : DROP TABLE users;
CREATE TABLE IF NOT EXISTS users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prenom      text NOT NULL,
  role        text NOT NULL,               -- direction / chef_atelier / boutique / operateur
  code_hash   text,
  actif       boolean NOT NULL DEFAULT true,
  derniere_connexion timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Le prénom est la clé de connexion : deux « Mélina » rendraient la connexion
-- ambiguë, et c'est la base qui doit l'empêcher, pas le code.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_prenom ON users (prenom);

-- LE PROJET — le niveau que le modèle n'avait pas.
--
-- « CLIENT → PROJET → ARTICLE / LOT → TÂCHES » (§1). Le client existait, les
-- articles existaient (une ligne de `requests` = un article, depuis le travail
-- sur les lots), mais entre les deux il n'y avait RIEN : un « projet » était une
-- ligne de commande, et le regroupement d'un panier vivait à l'écran, par la
-- référence du ticket. Pas d'identifiant, pas de statut, pas de total, pas de
-- page.
--
-- Une ligne SANS projet reste parfaitement valide : c'est le cas de toutes
-- celles d'avant, et de toute commande à un seul article qu'on ne veut pas
-- habiller d'un dossier. Le projet est un REGROUPEMENT, pas un passage obligé.
-- Down : ALTER TABLE requests DROP COLUMN IF EXISTS project_id; DROP TABLE projects;
CREATE TABLE IF NOT EXISTS projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero        text,                    -- référence du ticket quand elle existe
  nom           text NOT NULL,           -- « Hôtel ABC – Uniformes été 2026 »
  client_id     uuid,                    -- fiche de la base clients (null = client libre)
  billing_company text,                  -- le nom tel qu'il s'affiche, copié pour la lecture
  -- LA PROCHAINE ACTION (§5). « L'objectif est qu'un projet ne puisse pas être
  -- oublié. » Elle ne se DÉDUIT pas de l'étape : l'étape dit où on en est, la
  -- prochaine action dit ce qu'il faut faire ensuite, et les deux ne coïncident
  -- pas — « relancer le client » n'est l'étape de personne.
  action        text,
  action_qui    text,
  action_date   date,
  action_faite  boolean NOT NULL DEFAULT false,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects (client_id);

-- LES TÂCHES — la liste d'étapes d'UN article.
--
-- Les sept sous-étapes de production sont une liste PLATE et partagée : une
-- ligne se trouve à l'une d'elles. Le patron demande l'inverse — que le T-shirt
-- porte ses sept étapes et la gourde ses cinq, chacune avec un fait/pas fait, un
-- qui et un quand (§1, §28, §30). Une checklist (§30) est la même chose : une
-- liste ordonnée de cases. On n'en fait donc qu'un seul objet.
--
-- `qte_prevue` / `qte_faite` / `perte` portent le §26 (« Prévu : 50, produit :
-- 49, perte : 1 ») ET le §27 (contrôle qualité) : l'étape « Contrôle » est une
-- tâche comme une autre, ce sont ses quantités qui disent ce qu'elle a trouvé.
-- Une ligne de production n'a pas besoin de deux mécaniques pour ça.
-- Down : DROP TABLE tasks;
CREATE TABLE IF NOT EXISTS tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL,
  ordre       int NOT NULL DEFAULT 0,
  libelle     text NOT NULL,
  fait        boolean NOT NULL DEFAULT false,
  qui         text,                      -- qui l'a terminée
  fait_at     timestamptz,
  qte_prevue  int,
  qte_faite   int,
  perte       int,
  commentaire text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_request ON tasks (request_id, ordre);

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
