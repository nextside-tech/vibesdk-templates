ALTER TABLE notes ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS notes_user_id_created_at_idx ON notes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_magic_link_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  token TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_magic_link_deliveries_email_created_at_idx
  ON auth_magic_link_deliveries (email, created_at DESC);

UPDATE notes
SET user_id = 'legacy-anonymous'
WHERE user_id IS NULL;
