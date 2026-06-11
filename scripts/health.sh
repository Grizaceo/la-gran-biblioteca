#!/usr/bin/env bash
# Unified health check for La Gran Biblioteca
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f "$ROOT/backend/venv/bin/activate" ]; then
  # shellcheck source=/dev/null
  . "$ROOT/backend/venv/bin/activate"
fi

export WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(mktemp -d)}"

echo "==> ruff check backend/"
ruff check backend/

echo "==> pytest backend/tests/"
(cd "$ROOT/backend" && python -m pytest tests/ -v)

echo "==> tsc --noEmit (frontend)"
(cd "$ROOT/frontend" && npx tsc --noEmit)

echo "All health checks passed."
