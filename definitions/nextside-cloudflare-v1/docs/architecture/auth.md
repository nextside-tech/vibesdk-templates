# Auth runtime

## Current contract

The template now mounts `Better Auth` on `/api/auth/*` through `runtime.auth`.
The generated client keeps the same-origin contract and never reads the auth
secret from the browser bundle.

- Runtime binding: `DB` stores users, sessions, accounts, verification tokens
  and the mock magic-link delivery log.
- Secret boundary: `BETTER_AUTH_SECRET` stays server-side only. Local preview may
  load it from `.dev.vars`; deploy environments must inject it as a Worker secret.
- User boundary: `GET /api/notes` and `POST /api/notes` now require a real
  session and scope note data by `session.user.id`.

## Magic link v1

The lane still has no email provider or Clerk Platform API access, so the
template uses a **mock delivery transport** for magic links:

- `POST /api/auth/sign-in/magic-link` creates the Better Auth verification entry
  and stores the generated URL in `auth_magic_link_deliveries`.
- `GET /api/auth/mock/links/latest?email=...` exposes the latest generated URL
  for preview and automated checks. This is temporary transport plumbing, not a
  production inbox strategy.

The auth/session contract is real; only the delivery channel is mocked.

## Future Clerk adapter

`Clerk for Platforms` remains `DEP_EXTERNA`: beta privado, no real API access in
this worker. The migration seam is intentionally narrow:

1. Keep generated code on `runtime.auth` and same-origin session semantics.
2. Replace `runtime-cloudflare/auth.ts` with a Clerk-per-app adapter once the
   beta is available.
3. Migrate app-local users/sessions out of D1 as a dedicated follow-up; do not
   mix it with this Better Auth fallback.
