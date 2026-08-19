#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

bash scripts/validate.sh
if grep -q '{{D1_DATABASE_\|{{STORAGE_SERVICE_NAME}}' wrangler.jsonc; then
  echo 'BLOCKED: wrangler.jsonc ainda não foi renderizado pela plataforma' >&2
  exit 2
fi

bash scripts/build.sh
bunx --bun wrangler@4.105.0 deploy --config wrangler.jsonc
