# Instruções do template nextside-cloudflare-v1

Este é o template da lane greenfield VibeSDK/Cloudflare. Não o trate como o
`app-template` da lane robusta: projetos existentes ou legados seguem para
waitlist, e a jornada do usuário não exibe preço, estimativa ou prazo.

## Regras de arquitetura

- Use TypeScript estrito e React/Vite somente nesta superfície.
- Leia e escreva dados através de `runtime-cloudflare`; nunca importe `DB` ou
  `D1Database` em código de produto fora de `runtime-cloudflare/`.
- Componentes em `src/components/ui/` são protegidos. Componha-os; não os edite
  durante geração.
- `wrangler.jsonc`, migrations aplicadas, pipeline, runtime e manifestos de
  proteção são protegidos. Alterações exigem uma mudança dedicada do template.
- Não adicione Java, Docker Compose, Neon, credenciais, `.env` ou tokens ao app.
- Rotas novas entram em `worker/userRoutes.ts`; mantenha CORS e handlers centrais.

## Regras duras de auth/e-mail

Fonte canônica: `architecture/template-rules.json`. Esta seção é gerada por
`scripts/generate-template-rules.mjs`; não edite o texto gerado manualmente.

<!-- TEMPLATE_RULES:START -->

Versão: 1

- **auth.d1-dedicado** — Usuário Better Auth, users de domínio, outbox e logs persistem no D1 do app; acesso só via runtime-cloudflare (enforcement: code; âncoras: runtime-cloudflare/, migrations/; origem: NEX-587)
- **auth.cifra-outbox** — Fora de local, destinatário, token e URL cifrados (AES-GCM, ENCRYPTION_KEY) no outbox e em auth_email_deliveries (enforcement: code; âncoras: runtime-cloudflare/auth.ts, migrations/; origem: NEX-587)
- **auth.status-promotion** — emailVerification.afterEmailVerification promove users.status pending_email_verification→active idempotentemente (WHERE status='pending_email_verification'), com auditoria (enforcement: code; âncoras: runtime/auth.ts, runtime-cloudflare/auth.ts; origem: NEX-587)
- **auth.reconciliacao** — Migration de reconciliação para contas com emailVerified=1 e status pendente incluída no template (idempotente; 0 linhas em app novo) (enforcement: code; âncoras: migrations/; origem: NEX-587)
- **auth.nunca-relaxar** — Nunca relaxar requireEmailVerification nem marcar e-mail verificado manualmente (enforcement: gate; âncoras: runtime/auth.ts, scripts/validate.sh; origem: NEX-587)
- **auth.envio-worker** — E-mail sai pelo Resend via drain do outbox (cron da plataforma); rota interna POST /internal/outbox/drain protegida por token; validação de entrega = migration aplicada, verified_pending=0, outbox drenado, health, login + rota RBAC protegida (enforcement: code+gate; âncoras: runtime-cloudflare/email.ts, runtime-cloudflare/auth.ts, worker/userRoutes.ts; origem: NEX-587)
- **auth.email-literal** — Endereço submetido é literal — nunca normalizar alias Gmail (+tag); conta pendente reenvia somente via POST /api/auth/send-verification-email para o mesmo endereço cadastrado (enforcement: code+gate; âncoras: runtime/auth.ts, runtime-cloudflare/auth.ts, worker/userRoutes.ts; origem: NEX-587)

<!-- TEMPLATE_RULES:END -->

## Loop local

```bash
bun install --frozen-lockfile
bun run validate
bun run typecheck
bun run lint
bun run format:check
bun run build:template
```

`bun run deploy:template` é somente para um checkout já renderizado pela
plataforma. Ele não cria namespaces WFP, D1, buckets ou segredos.

## Contratos externos

O `SOURCE-MANIFEST.json` é a fonte de verdade dos pins. Se upstream mudar, atualize
o pin e repita os gates em uma tarefa dedicada; não use `main` móvel no catálogo.
