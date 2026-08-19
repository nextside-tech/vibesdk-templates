import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { betterAuth } from 'better-auth';
import { createTemplateAuthOptions } from '../runtime/auth.ts';
import { handleAuthRequest } from '../runtime-cloudflare/auth.ts';

const authMigration = (
  await Promise.all(
    [
      '0001_notes.sql',
      '0002_auth.sql',
      '0003_auth_runtime_contract.sql',
      '0004_domain_users.sql',
      '0005_auth_delivery_outbox.sql',
      '0006_auth_reconciliation.sql',
    ].map((file) => readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')),
  )
).join('\n');

const noteEnvelope = (data, status = 200) =>
  new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const errorEnvelope = (error, status) =>
  new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function extractCookie(response) {
  return response.headers.get('set-cookie')?.split(';', 1)[0] ?? null;
}

function createAuthSandbox(appId) {
  const baseURL = `https://${appId}.example.test`;
  const sqlite = new Database(':memory:');
  sqlite.exec(authMigration);

  const notesByUser = new Map();
  const deliveries = [];
  const verificationDeliveries = [];

  const auth = betterAuth({
    database: sqlite,
    ...createTemplateAuthOptions({
      baseURL,
      secret: `secret-for-${appId}-better-auth-preview-contract`,
      sendMagicLink: async (delivery) => {
        deliveries.push(delivery);
      },
      sendVerificationEmail: async (delivery) => {
        verificationDeliveries.push(delivery);
      },
      onUserCreated: async (user) => {
        sqlite
          .prepare(
            `INSERT OR IGNORE INTO users (id, email, role, status, created_at, updated_at) VALUES (?, ?, 'user', 'pending_email_verification', ?, ?)`,
          )
          .run(user.id, user.email, new Date().toISOString(), new Date().toISOString());
      },
      onUserEmailVerified: async (user) => {
        sqlite
          .prepare(
            `UPDATE users SET status = 'active', email_verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'pending_email_verification'`,
          )
          .run(user.id);
      },
    }),
  });

  const app = new Hono();

  app.get('/api/auth/mock/links/latest', (c) => {
    const email = c.req.query('email') ?? '';
    const latest = [...deliveries].reverse().find((delivery) => delivery.email === email);
    if (!latest) {
      return errorEnvelope('magic link not found for email', 404);
    }
    return noteEnvelope({
      email: latest.email,
      url: latest.url,
      createdAt: latest.createdAt,
      mode: 'mock',
    });
  });

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  app.get('/api/notes', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const domainUser = session?.user
      ? sqlite.query('SELECT status FROM users WHERE id = ?').get(session.user.id)
      : null;
    if (!session?.user || domainUser?.status !== 'active') {
      return errorEnvelope('authentication required', 401);
    }
    return noteEnvelope(notesByUser.get(session.user.id) ?? []);
  });

  app.post('/api/notes', async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const domainUser = session?.user
      ? sqlite.query('SELECT status FROM users WHERE id = ?').get(session.user.id)
      : null;
    if (!session?.user || domainUser?.status !== 'active') {
      return errorEnvelope('authentication required', 401);
    }
    const body = await c.req.json();
    const note = {
      id: crypto.randomUUID(),
      title: String(body.title),
      createdAt: new Date().toISOString(),
    };
    const bucket = notesByUser.get(session.user.id) ?? [];
    bucket.unshift(note);
    notesByUser.set(session.user.id, bucket);
    return noteEnvelope(note, 201);
  });

  return { app, baseURL, sqlite, deliveries, verificationDeliveries };
}

async function request(app, baseURL, path, init = {}) {
  return app.request(`${baseURL}${path}`, init);
}

describe('auth contract', () => {
  it('keeps pending users blocked, promotes after verification, and isolates two apps', async () => {
    const alpha = createAuthSandbox('alpha-app');
    const beta = createAuthSandbox('beta-app');

    const signUp = await request(alpha.app, alpha.baseURL, '/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alpha@example.com',
        password: 'builderpass123',
        name: 'Alpha Builder',
      }),
    });
    expect(signUp.status).toBe(200);
    const alphaPendingCookie = extractCookie(signUp);
    expect(alphaPendingCookie).toBeFalsy();

    const pendingDomainUser = alpha.sqlite
      .query('SELECT email, status FROM users WHERE email = ?')
      .get('alpha@example.com');
    expect(pendingDomainUser).toEqual({
      email: 'alpha@example.com',
      status: 'pending_email_verification',
    });

    const unauthenticatedNotes = await request(alpha.app, alpha.baseURL, '/api/notes');
    expect(unauthenticatedNotes.status).toBe(401);

    const verification = alpha.verificationDeliveries.find(
      (delivery) => delivery.user.email === 'alpha@example.com',
    );
    expect(verification).toBeTruthy();
    const verified = await request(
      alpha.app,
      alpha.baseURL,
      new URL(verification.url).pathname + new URL(verification.url).search,
    );
    expect([200, 302, 303].includes(verified.status)).toBe(true);
    expect(
      alpha.sqlite.query('SELECT status FROM users WHERE email = ?').get('alpha@example.com'),
    ).toEqual({ status: 'active' });

    const signIn = await request(alpha.app, alpha.baseURL, '/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alpha@example.com', password: 'builderpass123' }),
    });
    expect(signIn.status).toBe(200);
    const alphaCookie = extractCookie(signIn);
    expect(alphaCookie).toBeTruthy();

    const createNote = await request(alpha.app, alpha.baseURL, '/api/notes', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: alphaCookie,
      },
      body: JSON.stringify({ title: 'private alpha note' }),
    });
    expect(createNote.status).toBe(201);

    const alphaNotes = await request(alpha.app, alpha.baseURL, '/api/notes', {
      headers: { cookie: alphaCookie },
    });
    expect(alphaNotes.status).toBe(200);
    const alphaPayload = await alphaNotes.json();
    expect(alphaPayload.data).toHaveLength(1);
    expect(alphaPayload.data[0].title).toBe('private alpha note');

    const betaNotesWithAlphaCookie = await request(beta.app, beta.baseURL, '/api/notes', {
      headers: { cookie: alphaCookie },
    });
    expect(betaNotesWithAlphaCookie.status).toBe(401);

    const magicLink = await request(alpha.app, alpha.baseURL, '/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'magic@example.com',
        name: 'Magic Builder',
        callbackURL: '/',
      }),
    });
    expect(magicLink.status).toBe(200);

    const alphaLatestLink = await request(
      alpha.app,
      alpha.baseURL,
      '/api/auth/mock/links/latest?email=magic%40example.com',
    );
    expect(alphaLatestLink.status).toBe(200);
    const alphaLinkPayload = await alphaLatestLink.json();
    expect(alphaLinkPayload.data.url.startsWith(alpha.baseURL)).toBe(true);

    const betaLatestLink = await request(
      beta.app,
      beta.baseURL,
      '/api/auth/mock/links/latest?email=magic%40example.com',
    );
    expect(betaLatestLink.status).toBe(404);
  });

  it('treats a Gmail alias as a distinct literal account and resends to the exact address', async () => {
    const sandbox = createAuthSandbox('literal-app');
    for (const email of ['user@example.com', 'user+tag@example.com']) {
      const response = await request(sandbox.app, sandbox.baseURL, '/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'builderpass123', name: 'Literal User' }),
      });
      expect(response.status).toBe(200);
    }
    expect(
      sandbox.sqlite
        .query('SELECT COUNT(*) AS count FROM users WHERE email IN (?, ?)')
        .get('user@example.com', 'user+tag@example.com'),
    ).toEqual({ count: 2 });

    const aliasVerification = sandbox.verificationDeliveries.find(
      (delivery) => delivery.user.email === 'user+tag@example.com',
    );
    const verifiedAlias = await request(
      sandbox.app,
      sandbox.baseURL,
      new URL(aliasVerification.url).pathname + new URL(aliasVerification.url).search,
    );
    expect([200, 302, 303].includes(verifiedAlias.status)).toBe(true);
    expect(
      sandbox.sqlite
        .query('SELECT email, status FROM users WHERE email IN (?, ?) ORDER BY email')
        .all('user@example.com', 'user+tag@example.com'),
    ).toEqual([
      { email: 'user+tag@example.com', status: 'active' },
      { email: 'user@example.com', status: 'pending_email_verification' },
    ]);

    const resend = await request(
      sandbox.app,
      sandbox.baseURL,
      '/api/auth/send-verification-email',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', callbackURL: '/' }),
      },
    );
    expect(resend.status).toBe(200);
    expect(sandbox.verificationDeliveries.at(-1).user.email).toBe('user@example.com');
  });

  it('fails closed with 503 when a non-local transactional email provider is absent', async () => {
    const response = await handleAuthRequest(
      new Request('https://production.example.test/api/auth/sign-up/email', { method: 'POST' }),
      { ENVIRONMENT: 'production', BETTER_AUTH_SECRET: 'test-secret' },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ success: false, error: 'INTEGRATION_INACTIVE' });
  });
});
