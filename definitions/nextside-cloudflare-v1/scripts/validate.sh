#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

fail() { echo "VALIDATE_FAIL: $1" >&2; exit 1; }

node -e 'for (const file of ["package.json", "SOURCE-MANIFEST.json", ".donttouch_files.json", ".important_files.json", ".redacted_files.json", "architecture/allowed-packages.json", "architecture/template-rules.json"]) JSON.parse(require("fs").readFileSync(file, "utf8"));'
node -e 'const p=require("./package.json"); if(p.name!=="nextside-cloudflare-v1") process.exit(1); for(const key of ["setup","build:template","deploy:template","validate","typecheck","format:check"]) if(typeof p.scripts[key]!=="string") process.exit(1);'
node -e 'const m=require("./SOURCE-MANIFEST.json"); const r=require("./architecture/template-rules.json"); const sha=/^[0-9a-f]{40}$/; if(m.base.forkCommit!=="594df891d2a2b1843250aa483cb59ff1ddf7aab7" || m.base.upstreamCommit!=="7ea201fafdef44f5dcc5bc05f03b36e3198cebe5" || m.effectiveMergeSource.commit!=="34f2e0b22327834f7f399bc278e43a75ddea000b" || m.templateRules?.path!=="architecture/template-rules.json" || m.templateRules?.version!==r.version || !sha.test(m.base.forkCommit) || !sha.test(m.base.upstreamCommit) || !sha.test(m.effectiveMergeSource.commit)) process.exit(1);'

for path in wrangler.jsonc runtime runtime-cloudflare migrations src/components/ui .donttouch_files.json .important_files.json SOURCE-MANIFEST.json .dev.vars.example scripts/auth-schema.config.mjs; do
  [ -e "$path" ] || fail "arquivo protegido ausente: $path"
done

[ ! -e docker-compose.yml ] || fail 'docker-compose.yml não pertence à lane greenfield'
[ ! -e pnpm-workspace.yaml ] || fail 'pnpm-workspace.yaml não pertence à lane greenfield'
[ ! -e apps/api-java ] || fail 'Java não pertence à lane greenfield'
[ ! -e apps/api-node ] || fail 'api-node da lane robusta não pertence à lane greenfield'
[ ! -e packages/db ] || fail 'pacotes da lane robusta não pertencem à lane greenfield'
[ ! -e packages/auth ] || fail 'pacotes da lane robusta não pertencem à lane greenfield'

if rg -n --glob '*.ts' --glob '*.tsx' --glob '!runtime/**' --glob '!runtime-cloudflare/**' 'env\.DB|D1Database' worker src; then
  fail 'acesso direto a D1 fora do runtime'
fi
if rg -n --glob '*.ts' --glob '*.tsx' --glob '!runtime/**' --glob '!runtime-cloudflare/**' 'env\.STORAGE_SERVICE|STORAGE_SERVICE|R2Bucket' worker src; then
  fail 'acesso direto a storage fora do runtime'
fi
if rg -n --glob '*.ts' --glob '*.tsx' 'BETTER_AUTH_SECRET|import\.meta\.env\.[A-Z_]*AUTH' src; then
  fail 'segredo de auth não pode entrar no bundle do cliente'
fi
grep -q "requireEmailVerification: true" runtime/auth.ts || fail 'requireEmailVerification precisa permanecer true'
if rg -n --glob '*.ts' --glob '*.tsx' --glob '!runtime/**' --glob '!runtime-cloudflare/**' 'emailVerified\s*=' worker src; then
  fail 'emailVerified não pode ser marcado manualmente fora do runtime'
fi
if rg -n --glob '*.ts' --glob '*.tsx' 'email[^[:space:]]*\.(replace|split)\([^)]*\+' worker src; then
  fail 'alias Gmail não pode ser normalizado no worker ou na UI'
fi
node -e 'const source=require("fs").readFileSync("worker/userRoutes.ts", "utf8"); if(!source.includes("isLocalEnvironment") || !source.includes("/api/auth/mock/links/latest")) process.exit(1);'
if rg -n --glob '!bun.lock' --glob '!SOURCE-MANIFEST.json' --glob '!*.md' '(sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|-----BEGIN (RSA|OPENSSH|EC|PRIVATE) KEY-----)' .; then
  fail 'possível valor de segredo persistido'
fi

for file in setup.sh scripts/*.sh; do bash -n "$file" || fail "shell inválido: $file"; done
for file in scripts/*.mjs; do node --check "$file" || fail "JavaScript inválido: $file"; done
grep -q 'binding.*DB' wrangler.jsonc || fail 'binding DB ausente'
grep -q 'binding.*STORAGE_SERVICE' wrangler.jsonc || fail 'binding STORAGE_SERVICE ausente'
grep -q 'BETTER_AUTH_SECRET' .dev.vars.example || fail 'exemplo de secret auth ausente'
grep -q 'migrations/' .donttouch_files.json || fail 'migrations não protegidas'
grep -q 'src/main.tsx' .donttouch_files.json || fail 'providers raiz do cliente não protegidos'
grep -q 'src/components/ErrorBoundary.tsx' .donttouch_files.json || fail 'ErrorBoundary raiz não protegido'
grep -q 'src/components/RouteErrorBoundary.tsx' .donttouch_files.json || fail 'RouteErrorBoundary raiz não protegido'
grep -q 'src/components/ErrorFallback.tsx' .donttouch_files.json || fail 'ErrorFallback raiz não protegido'
grep -q 'src/lib/errorReporter.ts' .donttouch_files.json || fail 'errorReporter raiz não protegido'
grep -q 'QueryClientProvider' src/main.tsx || fail 'QueryClientProvider raiz ausente'
grep -q "import HomePage from '@/pages/HomePage'" src/main.tsx || fail 'bootstrap precisa aceitar página gerada com export default'
grep -q 'nodejs_compat' wrangler.jsonc || fail 'runtime Worker precisa de nodejs_compat para better-auth'
grep -Fq '"/internal/*"' wrangler.jsonc || fail 'rotas internas precisam executar o Worker antes do fallback SPA'
echo 'validate PASS: manifest, protection, lane boundary, auth/storage boundary, secret scan and syntax'
