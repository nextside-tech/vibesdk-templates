CREATE TABLE IF NOT EXISTS notifications_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  recipient TEXT,
  token TEXT,
  url TEXT,
  recipient_ciphertext TEXT,
  token_ciphertext TEXT,
  url_ciphertext TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  blocked_reason TEXT,
  processed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS notifications_outbox_pending_idx
  ON notifications_outbox (processed_at, blocked_reason, created_at);

CREATE TABLE IF NOT EXISTS notification_delivery_logs (
  id TEXT PRIMARY KEY NOT NULL,
  outbox_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'mocked')),
  provider_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS notification_delivery_logs_outbox_idx
  ON notification_delivery_logs (outbox_id, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_email_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('verification', 'magic-link')),
  recipient TEXT,
  recipient_ciphertext TEXT,
  token_ciphertext TEXT,
  url_ciphertext TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'mocked')),
  provider_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS auth_email_deliveries_recipient_idx
  ON auth_email_deliveries (recipient, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  event_type TEXT NOT NULL,
  metadata TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  user_id TEXT,
  success INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_login_attempts_email_idx
  ON auth_login_attempts (email, created_at DESC);
