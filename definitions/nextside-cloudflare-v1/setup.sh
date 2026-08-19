#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME=""
OUTPUT=""
YES=0

usage() {
  cat <<'EOF'
Usage: bash setup.sh --name <slug> [--output <empty-dir>] [--yes]

Creates a clean project copy without creating remote resources or secrets.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME="${2:-}"; shift 2 ;;
    --output) OUTPUT="${2:-}"; shift 2 ;;
    --yes) YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 64 ;;
  esac
done

if [[ ! "$NAME" =~ ^[a-z][a-z0-9-]{2,62}$ ]]; then
  echo "FAIL: --name must be a lowercase slug with 3-63 characters" >&2
  exit 64
fi

if [ "$YES" -ne 1 ] && [ ! -t 0 ]; then
  echo "FAIL: non-interactive setup requires --yes" >&2
  exit 64
fi

if [ -z "$OUTPUT" ]; then
  OUTPUT="$PWD/$NAME"
fi
OUTPUT="$(cd "$(dirname "$OUTPUT")" && pwd)/$(basename "$OUTPUT")"
if [ "$OUTPUT" = "$ROOT_DIR" ]; then
  echo "FAIL: --output cannot be the template directory" >&2
  exit 64
fi
if [ -e "$OUTPUT" ] && [ -n "$(find "$OUTPUT" -mindepth 1 -print -quit 2>/dev/null)" ]; then
  echo "FAIL: --output must be empty: $OUTPUT" >&2
  exit 64
fi

mkdir -p "$OUTPUT"
rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude '.wrangler' --exclude '.eslintcache' "$ROOT_DIR/" "$OUTPUT/"
node "$ROOT_DIR/scripts/setup-project.mjs" "$OUTPUT" "$NAME"
printf 'setup PASS: %s\n' "$OUTPUT"
