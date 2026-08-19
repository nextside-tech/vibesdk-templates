// Making changes to this file is **STRICTLY** forbidden. Please add your routes in `userRoutes.ts` file.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Env } from './core-utils';
export * from './core-utils';

type UserRoutesModule = { userRoutes: (app: Hono<{ Bindings: Env }>) => void };

const USER_ROUTES_MODULE = './userRoutes';
const RETRY_MS = 750;
let nextRetryAt = 0;
let userRoutesLoaded = false;
let userRoutesLoadError: string | null = null;
let userRoutesLoadPromise: Promise<void> | null = null;
let userRoutesApp: Hono<{ Bindings: Env }> | null = null;

const createUserRoutesApp = () => {
  const routes = new Hono<{ Bindings: Env }>();
  routes.use('*', logger());
  routes.use('/api/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] }));
  routes.notFound((c) => c.json({ success: false, error: 'Not Found' }, 404));
  routes.onError((err, c) => { console.error(`[ERROR] ${err}`); return c.json({ success: false, error: 'Internal Server Error' }, 500); });
  return routes;
};

const safeLoadUserRoutes = async () => {
  if (userRoutesLoaded) return;
  if (userRoutesLoadPromise) return userRoutesLoadPromise;

  const now = Date.now();
  const shouldRetry = userRoutesLoadError !== null;
  if (shouldRetry && now < nextRetryAt) return;
  nextRetryAt = now + RETRY_MS;

  userRoutesLoadPromise = (async () => {
    const bust = shouldRetry && import.meta.env?.DEV ? `?t=${now}` : '';
    const spec = `${USER_ROUTES_MODULE}${bust}`;

    try {
      const mod = (await import(/* @vite-ignore */ spec)) as UserRoutesModule;
      const routes = createUserRoutesApp();
      mod.userRoutes(routes);
      userRoutesApp = routes;
      userRoutesLoaded = true;
      userRoutesLoadError = null;
    } catch (e) {
      userRoutesLoadError = e instanceof Error ? e.message : String(e);
    } finally {
      userRoutesLoadPromise = null;
    }
  })();
  return userRoutesLoadPromise;
};

export type ClientErrorReport = { message: string; url: string; timestamp: string } & Record<string, unknown>;

const app = new Hono<{ Bindings: Env }>();

app.use('*', logger());

app.use('/api/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] }));

app.get('/api/health', (c) => c.json({ success: true, data: { status: 'healthy', timestamp: new Date().toISOString() }}));

app.post('/api/client-errors', async (c) => {
  try {
    const e = await c.req.json<ClientErrorReport>();
    console.error('[CLIENT ERROR]', JSON.stringify({ timestamp: e.timestamp || new Date().toISOString(), message: e.message, url: e.url, stack: e.stack, componentStack: e.componentStack, errorBoundary: e.errorBoundary }, null, 2));
    return c.json({ success: true });
  } catch (error) {
    console.error('[CLIENT ERROR HANDLER] Failed:', error);
    return c.json({ success: false, error: 'Failed to process' }, 500);
  }
});

app.notFound((c) => c.json({ success: false, error: 'Not Found' }, 404));
app.onError((err, c) => { console.error(`[ERROR] ${err}`); return c.json({ success: false, error: 'Internal Server Error' }, 500); });

console.log(`Server is running`)

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;

    if ((pathname.startsWith('/api/') || pathname.startsWith('/internal/')) && pathname !== '/api/health' && pathname !== '/api/client-errors') {
      await safeLoadUserRoutes();
      if (userRoutesLoadError || !userRoutesApp) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Worker routes failed to load',
            detail: userRoutesLoadError,
          }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        );
      }
      return userRoutesApp.fetch(request, env, ctx);
    }

    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
