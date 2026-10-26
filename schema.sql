-- Schéma de la base Habit Tracker (exécuté au démarrage, sans rien effacer)

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;  -- ajoutée pour la page admin
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;  -- donné par le code admin

-- un mois d'un utilisateur ("2026-10")
CREATE TABLE IF NOT EXISTS months (
  id      SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month   CHAR(7) NOT NULL,
  title   TEXT NOT NULL,
  goal    INTEGER,                    -- NULL = automatique (habitudes × jours)
  notes   TEXT NOT NULL DEFAULT '',
  UNIQUE (user_id, month)
);

CREATE TABLE IF NOT EXISTS habits (
  id       SERIAL PRIMARY KEY,
  month_id INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS habits_month_idx ON habits (month_id);

-- une case cochée (✓) ou ratée (✗) ; une case vide n'a pas de ligne
CREATE TABLE IF NOT EXISTS checks (
  habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  day      DATE NOT NULL,
  value    TEXT NOT NULL CHECK (value IN ('done', 'miss')),
  PRIMARY KEY (habit_id, day)
);

CREATE TABLE IF NOT EXISTS moods (
  month_id INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  day      DATE NOT NULL,
  value    SMALLINT NOT NULL CHECK (value BETWEEN 1 AND 3),  -- 1 triste, 2 neutre, 3 content
  PRIMARY KEY (month_id, day)
);

-- sessions de connexion (format attendu par connect-pg-simple)
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    VARCHAR NOT NULL PRIMARY KEY,
  "sess"   JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- poids d'une semaine, rangé au premier jour de la semaine
CREATE TABLE IF NOT EXISTS weights (
  month_id INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  day      DATE NOT NULL,
  kg       NUMERIC(4, 1) NOT NULL,
  PRIMARY KEY (month_id, day)
);
