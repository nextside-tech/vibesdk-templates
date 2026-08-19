#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${E2E_URL:-http://127.0.0.1:8787}"
if [ -z "${E2E_URL:-}" ]; then
  echo 'SKIP: E2E_URL não informado; use um preview renderizado com D1.'
  exit 0
fi

health_status="$(curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}' "$BASE_URL/api/health")"
[ "$health_status" = 200 ] || { echo "FAIL: /api/health returned $health_status" >&2; exit 1; }

create_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  -X POST -H 'content-type: application/json' -d '{"title":"W2.2 deterministic note"}' "$BASE_URL/api/notes")"
[ "$create_status" = 201 ] || { echo "FAIL: POST /api/notes returned $create_status" >&2; exit 1; }

list_status="$(curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}' "$BASE_URL/api/notes")"
[ "$list_status" = 200 ] || { echo "FAIL: GET /api/notes returned $list_status" >&2; exit 1; }
echo 'E2E PASS: health + D1 CRUD'
