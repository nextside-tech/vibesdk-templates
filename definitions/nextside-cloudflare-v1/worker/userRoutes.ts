import { Hono } from "hono";
import { Env } from './core-utils';
import { createCloudflareRuntime, type CloudflareRuntimeEnv } from '../runtime-cloudflare';
import {
    drainOutbox,
    getDomainUser,
    getInternalHealth,
    getLatestMagicLink,
    hasInternalServiceToken,
    type CloudflareAuthEnv,
} from '../runtime-cloudflare/auth';
import { isLocalEnvironment } from '../runtime-cloudflare/email';

const invalidEmail = (email: string): boolean => {
    return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

export function userRoutes(app: Hono<{ Bindings: Env }>) {
    // Add more routes like this. **DO NOT MODIFY CORS OR OVERRIDE ERROR HANDLERS**
    app.get('/api/test', (c) => c.json({ success: true, data: { name: 'this works' }}));

    app.post('/internal/outbox/drain', async (c) => {
        const env = c.env as CloudflareAuthEnv;
        if (!hasInternalServiceToken(c.req.raw, env)) {
            return c.json({ success: false, error: 'authentication required' }, 401);
        }
        const requestedLimit = Number(c.req.query('limit') ?? '25');
        try {
            return c.json({ success: true, data: await drainOutbox(env, Number.isFinite(requestedLimit) ? requestedLimit : 25) });
        } catch {
            return c.json({ success: false, error: 'outbox drain is unavailable' }, 503);
        }
    });

    app.get('/internal/health', async (c) => {
        const env = c.env as CloudflareAuthEnv;
        if (!hasInternalServiceToken(c.req.raw, env)) {
            return c.json({ success: false, error: 'authentication required' }, 401);
        }
        try {
            const health = await getInternalHealth(env);
            return c.json({ success: true, data: health }, health.status === 'healthy' ? 200 : 503);
        } catch {
            return c.json({ success: false, error: 'health check is unavailable' }, 503);
        }
    });

    app.get('/api/auth/mock/links/latest', async (c) => {
        if (!isLocalEnvironment(c.env as CloudflareAuthEnv)) {
            return c.notFound();
        }
        const email = c.req.query('email') ?? '';
        if (!email || invalidEmail(email)) {
            return c.json({ success: false, error: 'email must be valid' }, 400);
        }

        try {
            const latest = await getLatestMagicLink(c.env as CloudflareRuntimeEnv, email);
            if (!latest) {
                return c.json({ success: false, error: 'magic link not found for email' }, 404);
            }
            return c.json({
                success: true,
                data: {
                    email: latest.email,
                    url: latest.url,
                    createdAt: latest.createdAt,
                    mode: 'mock',
                },
            });
        } catch (error) {
            console.error('[AUTH MOCK LINK]', error);
            return c.json({ success: false, error: 'auth mock delivery is unavailable' }, 503);
        }
    });

    app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
        const runtime = createCloudflareRuntime(c.env as CloudflareRuntimeEnv);
        return runtime.auth.handle(c.req.raw);
    });

    app.get('/api/notes', async (c) => {
        try {
            const runtime = createCloudflareRuntime(c.env as CloudflareRuntimeEnv);
            const session = await runtime.auth.getSession(c.req.raw);
            const domainUser = session ? await getDomainUser(c.env as CloudflareAuthEnv, session.user.id) : null;
            if (!session || !domainUser || domainUser.status !== 'active') {
                return c.json({ success: false, error: 'authentication required' }, 401);
            }
            return c.json({ success: true, data: await runtime.db.listNotes(session.user.id) });
        } catch {
            return c.json({ success: false, error: 'D1 binding is unavailable' }, 503);
        }
    });

    app.post('/api/notes', async (c) => {
        let body: { title?: unknown };
        try {
            body = await c.req.json<{ title?: unknown }>();
        } catch {
            return c.json({ success: false, error: 'request body must be valid JSON' }, 400);
        }
        if (typeof body.title !== 'string' || body.title.trim().length === 0 || body.title.length > 160) {
            return c.json({ success: false, error: 'title must contain 1-160 characters' }, 400);
        }

        try {
            const runtime = createCloudflareRuntime(c.env as CloudflareRuntimeEnv);
            const session = await runtime.auth.getSession(c.req.raw);
            const domainUser = session ? await getDomainUser(c.env as CloudflareAuthEnv, session.user.id) : null;
            if (!session || !domainUser || domainUser.status !== 'active') {
                return c.json({ success: false, error: 'authentication required' }, 401);
            }
            const note = await runtime.db.createNote(session.user.id, { title: body.title.trim() });
            return c.json({ success: true, data: note }, 201);
        } catch {
            return c.json({ success: false, error: 'D1 binding is unavailable' }, 503);
        }
    });

    app.get('/api/rbac/protected', async (c) => {
        try {
            const runtime = createCloudflareRuntime(c.env as CloudflareRuntimeEnv);
            const session = await runtime.auth.getSession(c.req.raw);
            const domainUser = session ? await getDomainUser(c.env as CloudflareAuthEnv, session.user.id) : null;
            if (!session || !domainUser || domainUser.status !== 'active') {
                return c.json({ success: false, error: 'authentication required' }, 401);
            }
            return c.json({ success: true, data: { userId: session.user.id, role: domainUser.role } });
        } catch {
            return c.json({ success: false, error: 'D1 binding is unavailable' }, 503);
        }
    });
}
