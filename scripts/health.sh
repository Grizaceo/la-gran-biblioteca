#!/usr/bin/env bash
# Unified health check for La Gran Biblioteca
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> ruff check backend/"
ruff check backend/

echo "==> pytest backend/tests/"
cd backend && python -m pytest tests/ -v && cd ..

echo "==> tsc --noEmit (frontend)"
cd frontend && npx tsc --noEmit && cd ..

echo "All health checks passed."
