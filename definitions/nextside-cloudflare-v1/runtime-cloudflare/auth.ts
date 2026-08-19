import type { IncomingRequestCfProperties } from '@cloudflare/workers-types';
import { betterAuth } from 'better-auth';
import { withCloudflare } from 'better-auth-cloudflare';
import type { AuthSession } from '../runtime';
import { createTemplateAuthOptions, type AuthMagicLinkDelivery } from '../runtime/auth';
import { createEmailAdapter, IntegrationInactiveError, isLocalEnvironment } from './email';

export type CloudflareAuthEnv = {
  DB?: D1Database;
  BETTER_AUTH_SECRET?: string;
  ENCRYPTION_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  ENVIRONMENT?: string;
  INTERNAL_SERVICE_TOKEN?: string;
};

type MagicLinkRow = { id: string; email: string; url: string; createdAt: string };

export type DomainUser = {
  id: string;
  email: string;
  role: 'user' | 'admin';
  status: 'pending_email_verification' | 'active' | 'inactive' | 'suspended';
};

type OutboxRow = {
  id: string;
  userId: string | null;
  eventType: string;
  idempotencyKey: string;
  recipient: string | null;
  token: string | null;
  url: string | null;
  recipientCiphertext: string | null;
  tokenCiphertext: string | null;
  urlCiphertext: string | null;
  subject: string;
  body: string;
};

const missingDatabase = (): never => {
  throw new Error('D1 binding DB is not rendered for this environment');
};

const database = (env: CloudflareAuthEnv): D1Database => env.DB ?? missingDatabase();

const resolveSecret = (env: CloudflareAuthEnv): string => {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not configured for auth runtime');
  return secret;
};

const cfProperties = (request: Request): IncomingRequestCfProperties =>
  ((request as Request & { cf?: IncomingRequestCfProperties }).cf ??
    {}) as IncomingRequestCfProperties;

const encodeBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

const decodeBase64Url = (value: string): Uint8Array => {
  const padded =
    value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

const encryptionKey = async (env: CloudflareAuthEnv): Promise<CryptoKey> => {
  const configured = env.ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error('ENCRYPTION_KEY is required outside local environment');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(configured));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
};

const encryptValue = async (env: CloudflareAuthEnv, value: string): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(env),
    new TextEncoder().encode(value),
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return encodeBase64Url(combined);
};

const decryptValue = async (env: CloudflareAuthEnv, value: string): Promise<string> => {
  const combined = decodeBase64Url(value);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: combined.slice(0, 12) },
    await encryptionKey(env),
    combined.slice(12),
  );
  return new TextDecoder().decode(plaintext);
};

const protect = async (
  env: CloudflareAuthEnv,
  value: string,
): Promise<{ plain: string | null; ciphertext: string | null }> => {
  if (isLocalEnvironment(env)) return { plain: value, ciphertext: null };
  return { plain: null, ciphertext: await encryptValue(env, value) };
};

const resolveProtected = async (
  env: CloudflareAuthEnv,
  plain: string | null,
  ciphertext: string | null,
): Promise<string> => {
  if (plain !== null) return plain;
  if (!ciphertext) throw new Error('protected email delivery value is missing');
  return decryptValue(env, ciphertext);
};

const createDomainUser = async (
  env: CloudflareAuthEnv,
  user: { id: string; email: string },
): Promise<void> => {
  const now = new Date().toISOString();
  await database(env)
    .prepare(
      `INSERT OR IGNORE INTO users (id, email, role, status, created_at, updated_at)
       VALUES (?, ?, 'user', 'pending_email_verification', ?, ?)`,
    )
    .bind(user.id, user.email, now, now)
    .run();
};

const promoteDomainUser = async (
  env: CloudflareAuthEnv,
  user: { id: string; email: string },
): Promise<void> => {
  const now = new Date().toISOString();
  const result = await database(env)
    .prepare(
      `UPDATE users SET status = 'active', email_verified_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending_email_verification'`,
    )
    .bind(now, now, user.id)
    .run();
  if ((result.meta?.changes ?? 0) > 0) {
    await database(env)
      .prepare(
        `INSERT INTO audit_logs (id, user_id, event_type, metadata, created_at)
         VALUES (?, ?, 'auth.email_verified', ?, ?)`,
      )
      .bind(crypto.randomUUID(), user.id, JSON.stringify({ email: user.email }), now)
      .run();
  }
};

const enqueueEmail = async (
  env: CloudflareAuthEnv,
  input: {
    userId?: string;
    kind: 'verification' | 'magic-link';
    email: string;
    token: string;
    url: string;
  },
): Promise<void> => {
  if (!isLocalEnvironment(env) && (!env.RESEND_API_KEY?.trim() || !env.RESEND_FROM?.trim())) {
    throw new IntegrationInactiveError();
  }
  const [recipient, token, url] = await Promise.all([
    protect(env, input.email),
    protect(env, input.token),
    protect(env, input.url),
  ]);
  const idempotencyKey = `auth:${input.kind}:${input.userId ?? input.email}:${input.token}`;
  const createdAt = new Date().toISOString();
  const subject = input.kind === 'verification' ? 'Verify your account' : 'Your sign-in link';
  const body = isLocalEnvironment(env)
    ? `Use this link to continue: ${input.url}`
    : 'Use the verification link in this message to continue.';
  await database(env)
    .prepare(
      `INSERT OR IGNORE INTO notifications_outbox
       (id, user_id, event_type, idempotency_key, recipient, token, url,
        recipient_ciphertext, token_ciphertext, url_ciphertext, subject, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.userId ?? null,
      `auth.${input.kind}`,
      idempotencyKey,
      recipient.plain,
      token.plain,
      url.plain,
      recipient.ciphertext,
      token.ciphertext,
      url.ciphertext,
      subject,
      body,
      createdAt,
    )
    .run();
  await database(env)
    .prepare(
      `INSERT OR IGNORE INTO auth_email_deliveries
       (id, user_id, kind, recipient, token, url, recipient_ciphertext, token_ciphertext, url_ciphertext, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `delivery:${idempotencyKey}`,
      input.userId ?? null,
      input.kind,
      recipient.plain,
      token.plain,
      url.plain,
      recipient.ciphertext,
      token.ciphertext,
      url.ciphertext,
      createdAt,
    )
    .run();
};

const createBetterAuth = (request: Request, env: CloudflareAuthEnv) => {
  const baseURL = new URL(request.url).origin;
  return betterAuth({
    ...withCloudflare(
      { cf: cfProperties(request), d1Native: database(env) },
      createTemplateAuthOptions({
        baseURL,
        secret: resolveSecret(env),
        sendMagicLink: async (delivery: AuthMagicLinkDelivery) => {
          await enqueueEmail(env, {
            kind: 'magic-link',
            email: delivery.email,
            token: delivery.token,
            url: delivery.url,
          });
        },
        sendVerificationEmail: async ({ user, token, url }) => {
          await enqueueEmail(env, {
            kind: 'verification',
            userId: user.id,
            email: user.email,
            token,
            url,
          });
        },
        onUserCreated: async (user) => createDomainUser(env, user),
        onUserEmailVerified: async (user) => promoteDomainUser(env, user),
      }),
    ),
  });
};

const transactionalPaths = new Set([
  '/api/auth/sign-up/email',
  '/api/auth/send-verification-email',
  '/api/auth/sign-in/magic-link',
  '/api/auth/forget-password',
]);

const integrationInactiveResponse = (): Response =>
  new Response(JSON.stringify({ success: false, error: 'INTEGRATION_INACTIVE' }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });

export const handleAuthRequest = async (
  request: Request,
  env: CloudflareAuthEnv,
): Promise<Response> => {
  const pathname = new URL(request.url).pathname;
  if (
    !isLocalEnvironment(env) &&
    transactionalPaths.has(pathname) &&
    (!env.RESEND_API_KEY?.trim() || !env.RESEND_FROM?.trim())
  ) {
    return integrationInactiveResponse();
  }
  try {
    return await createBetterAuth(request, env).handler(request);
  } catch (error) {
    if (error instanceof IntegrationInactiveError) return integrationInactiveResponse();
    throw error;
  }
};

export const getAuthSession = async (
  request: Request,
  env: CloudflareAuthEnv,
): Promise<AuthSession | null> => {
  const session = await createBetterAuth(request, env).api.getSession({ headers: request.headers });
  return session ? (session as AuthSession) : null;
};

export const getDomainUser = async (
  env: CloudflareAuthEnv,
  userId: string,
): Promise<DomainUser | null> =>
  (await database(env)
    .prepare('SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1')
    .bind(userId)
    .first<DomainUser>()) ?? null;

export const getLatestMagicLink = async (
  env: CloudflareAuthEnv,
  email: string,
): Promise<MagicLinkRow | null> => {
  if (!isLocalEnvironment(env)) return null;
  return (
    (await database(env)
      .prepare(
        `SELECT id, recipient AS email, url, created_at AS createdAt
       FROM auth_email_deliveries
       WHERE kind = 'magic-link' AND recipient = ?
       ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(email)
      .first<MagicLinkRow>()) ?? null
  );
};

export const hasInternalServiceToken = (request: Request, env: CloudflareAuthEnv): boolean => {
  const expected = env.INTERNAL_SERVICE_TOKEN?.trim();
  return Boolean(expected && request.headers.get('authorization') === `Bearer ${expected}`);
};

export const drainOutbox = async (
  env: CloudflareAuthEnv,
  limit = 25,
): Promise<{ processed: number; failed: number; pending: number }> => {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = (
    await database(env)
      .prepare(
        `SELECT id, user_id AS userId, event_type AS eventType, idempotency_key AS idempotencyKey,
              recipient, token, url, recipient_ciphertext AS recipientCiphertext,
              token_ciphertext AS tokenCiphertext, url_ciphertext AS urlCiphertext, subject, body
       FROM notifications_outbox
       WHERE processed_at IS NULL AND blocked_reason IS NULL
       ORDER BY created_at ASC LIMIT ?`,
      )
      .bind(boundedLimit)
      .all<OutboxRow>()
  ).results;
  let processed = 0;
  let failed = 0;
  const adapter = createEmailAdapter(env);
  for (const row of rows) {
    try {
      const [recipient, url] = await Promise.all([
        resolveProtected(env, row.recipient, row.recipientCiphertext),
        resolveProtected(env, row.url, row.urlCiphertext),
      ]);
      const result = await adapter.send({
        to: recipient,
        subject: row.subject,
        text: `${row.body}\n${url}`,
      });
      const now = new Date().toISOString();
      await database(env)
        .prepare(
          'UPDATE notifications_outbox SET processed_at = ?, attempts = attempts + 1 WHERE id = ? AND processed_at IS NULL',
        )
        .bind(now, row.id)
        .run();
      await database(env)
        .prepare(
          `INSERT INTO notification_delivery_logs (id, outbox_id, status, provider_id, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), row.id, result.status, result.providerId, now)
        .run();
      await database(env)
        .prepare(
          'UPDATE auth_email_deliveries SET status = ?, provider_id = ?, sent_at = ? WHERE id = ?',
        )
        .bind(result.status, result.providerId, now, `delivery:${row.idempotencyKey}`)
        .run();
      processed += 1;
    } catch (error) {
      failed += 1;
      const now = new Date().toISOString();
      const reason = error instanceof IntegrationInactiveError ? error.code : 'DELIVERY_FAILED';
      await database(env)
        .prepare(
          'UPDATE notifications_outbox SET blocked_reason = ?, attempts = attempts + 1 WHERE id = ?',
        )
        .bind(reason, row.id)
        .run();
      await database(env)
        .prepare(
          `INSERT INTO notification_delivery_logs (id, outbox_id, status, error, created_at)
           VALUES (?, ?, 'failed', ?, ?)`,
        )
        .bind(crypto.randomUUID(), row.id, reason, now)
        .run();
    }
  }
  const pendingRow = await database(env)
    .prepare(
      'SELECT COUNT(*) AS count FROM notifications_outbox WHERE processed_at IS NULL AND blocked_reason IS NULL',
    )
    .first<{ count: number }>();
  return { processed, failed, pending: Number(pendingRow?.count ?? 0) };
};

export const getInternalHealth = async (env: CloudflareAuthEnv) => {
  const verifiedPending = await database(env)
    .prepare("SELECT COUNT(*) AS count FROM users WHERE status = 'pending_email_verification'")
    .first<{ count: number }>();
  const outboxPending = await database(env)
    .prepare(
      'SELECT COUNT(*) AS count FROM notifications_outbox WHERE processed_at IS NULL AND blocked_reason IS NULL',
    )
    .first<{ count: number }>();
  const requiredTables = [
    'user',
    'users',
    'notifications_outbox',
    'auth_email_deliveries',
    'audit_logs',
  ];
  const migrationRows = await database(env)
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${requiredTables.map(() => '?').join(',')})`,
    )
    .bind(...requiredTables)
    .all<{ name: string }>();
  const migrationsApplied = requiredTables.every((name) =>
    migrationRows.results.some((row) => row.name === name),
  );
  return {
    status:
      migrationsApplied &&
      Number(verifiedPending?.count ?? 0) === 0 &&
      Number(outboxPending?.count ?? 0) === 0
        ? 'healthy'
        : 'degraded',
    migrationsApplied,
    verified_pending: Number(verifiedPending?.count ?? 0),
    outbox_pending: Number(outboxPending?.count ?? 0),
  };
};
