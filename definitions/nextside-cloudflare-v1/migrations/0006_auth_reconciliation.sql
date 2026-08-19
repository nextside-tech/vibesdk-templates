UPDATE users
SET status = 'active',
    email_verified_at = COALESCE(email_verified_at, datetime('now')),
    updated_at = datetime('now')
WHERE status = 'pending_email_verification'
  AND id IN (
    SELECT id FROM "user" WHERE emailVerified = 1
  );
