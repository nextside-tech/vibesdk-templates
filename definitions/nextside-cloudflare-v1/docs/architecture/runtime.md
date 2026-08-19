# Runtime contract

`runtime/` define a porta estável que o código gerado conhece. A implementação
`runtime-cloudflare/` adapta essa porta para Cloudflare e é a única superfície
que conhece `D1Database`.

| Port        | W2.2 implementation                          | Boundary                                           |
| ----------- | -------------------------------------------- | -------------------------------------------------- |
| `auth`      | Better Auth + D1 + mock magic link transport | Clerk Platform remains a later lane item           |
| `db`        | D1 notes CRUD                                | binding and resource lifecycle belong to W2.3/W2.4 |
| `storage`   | app-scoped service capability                | W2.3 owns app isolation and Storage Service wiring |
| `files`     | explicit unsupported capability              | generated code must not bypass `storage`           |
| `jobs`      | explicit unsupported capability              | queue/workflow belongs to the platform             |
| `telemetry` | structured console event                     | provider wiring is outside this template           |
| `email`     | explicit unsupported capability              | provider is outside this template                  |

The separation is intentional: generated code keeps a stable contract while the
platform can replace Cloudflare bindings later. `storage` derives a capability
from `appId`, scopes object keys under `apps/<appId>/...` and requires the
`STORAGE_SERVICE` binding to exist. A missing capability fails explicitly; it
does not silently fall back to an in-memory or cross-tenant store.

`auth` follows the same philosophy: the runtime owns provider-specific state.
The current adapter mounts Better Auth under `/api/auth/*`, keeps
`BETTER_AUTH_SECRET` server-side, stores auth state in the app D1 database and
offers a temporary mock transport for magic-link delivery. Generated UI and
routes consume same-origin auth endpoints only; they do not embed provider
secrets or Clerk-specific assumptions.
