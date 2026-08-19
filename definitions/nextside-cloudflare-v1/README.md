# nextside-cloudflare-v1

Template golden da lane greenfield VibeSDK/Cloudflare. Ele parte do `vite-reference`
pinado do catálogo Cloudflare e incorpora somente os contratos leves da Nextside:
TypeScript estrito, design tokens, runtime estável, migrations D1, proteção de
arquitetura e scripts reproduzíveis.

Este diretório é o artefato local rastreável de W2.2. O repositório público
`nextside-tech/nextside-cloudflare-v1`, o catálogo publicado e o upload R2 ficam
pendentes de autoridade externa; não coloque segredos neste checkout.

## Fonte e fronteiras

- O catálogo base é `nextside-tech/vibesdk-templates@nextside/pinned-7ea201f`.
- A definição de seleção é `vibesdk-definition.yaml` e o identificador é sempre
  `nextside-cloudflare-v1`; o usuário não escolhe a infraestrutura.
- `runtime/` e `src/components/ui/` são contratos protegidos. Código gerado usa
  `runtime-cloudflare`, nunca `env.DB` ou `env.STORAGE_SERVICE` diretamente.
- Java, Docker Compose, Neon, Clerk e o monorepo do template robusto não entram
  nesta lane.
- D1 e o provisionamento de recursos são renderizados pela plataforma. Os
  placeholders de `wrangler.jsonc` para `DB` e `STORAGE_SERVICE` são deliberados
  e fazem o deploy falhar fechado enquanto o checkout não for renderizado.
- `BETTER_AUTH_SECRET` nunca entra no bundle do cliente. Para preview local, use
  `.dev.vars` a partir de `.dev.vars.example`; deploys devem injetar o secret no
  Worker.

## Uso local

Pré-requisitos: Bun 1.3+ e Node 20+. Os comandos abaixo não precisam de tokens.

```bash
bash setup.sh --name demo-v1 --output /tmp/demo-v1 --yes
cd /tmp/demo-v1
bun install --frozen-lockfile
bun run validate
bun run typecheck
bun run test
bun run lint
bun run format:check
bun run build:template
```

`setup.sh` copia uma instância limpa, valida o slug e renderiza apenas o nome do
projeto. O `--output` deve apontar para um diretório vazio. O script não cria
conta, banco, namespace, domínio ou segredo.

## Auth por app

- `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email` e
  `POST /api/auth/sign-in/magic-link` são servidos pelo Better Auth no próprio
  worker.
- `GET /api/notes` e `POST /api/notes` exigem sessão válida e filtram dados por
  `session.user.id`.
- O transport de magic link na v1 é mockado por D1:
  `GET /api/auth/mock/links/latest?email=...` retorna o último link emitido para
  preview e testes determinísticos.
- `Clerk for Platforms` continua fora deste checkout por ser beta privado
  (`DEP_EXTERNA`). A migração futura está documentada em
  `docs/architecture/auth.md`.

## Build e deploy

```bash
bun run build:template
bun run deploy:template
```

`deploy:template` executa validação e build antes de chamar Wrangler. Ele recusa
`wrangler.jsonc` com placeholders de `DB` ou `STORAGE_SERVICE`; a plataforma deve
fornecer um checkout renderizado e uma sessão Cloudflare autorizada. WFP,
namespace, catálogo e R2 não são criados por este template.

## CRUD de preview

O worker expõe `GET /api/health`, `GET /api/notes`, `POST /api/notes` e
`/api/auth/*`. As rotas usam somente `runtime-cloudflare`; as migrations
`0001_notes.sql`, `0002_auth.sql` e `0003_auth_runtime_contract.sql` precisam
ser aplicadas ao D1 renderizado pela etapa de recursos da plataforma. O contrato
de storage local cria uma capability por `appId` e encaminha escrita para
`STORAGE_SERVICE` com prefixo `apps/<appId>/...`. Sem o binding `DB`, a rota CRUD
responde `503` de forma explícita, sem fallback silencioso.

## Verificação

`bun run validate` é o gate determinístico sem rede: confirma manifesto, pins,
arquivos protegidos, allowlist, ausência de stacks da lane robusta, isolamento
do storage no runtime, ausência de segredo no cliente e ausência de valores de
segredo persistidos. `bun run test` prova o isolamento por `appId`, o isolamento
de auth entre duas apps e o escopo de `notes` por usuário com fixture local.
Build, typecheck, lint e format-check são gates adicionais; Clerk beta real,
Cloudflare e deploy/produção permanecem provas externas e não são simulados
como sucesso.
