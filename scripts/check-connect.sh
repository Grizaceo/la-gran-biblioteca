#!/usr/bin/env bash
# Quick backend ↔ frontend connectivity check (run from repo root).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Backend venv"
if [ ! -f "$ROOT/backend/venv/bin/activate" ]; then
  echo "ERROR: No existe backend/venv. Crea e instala deps:"
  echo "  python3 -m venv backend/venv && source backend/venv/bin/activate && pip install -r backend/requirements.txt"
  exit 1
fi
# shellcheck source=/dev/null
. "$ROOT/backend/venv/bin/activate"

echo "==> Import API app"
python -c "import backend.library_bridge as b; print('OK routes:', len(b.app.routes))"

echo "==> HTTP (backend must be running: python -m backend.library_bridge)"
for path in /api/health /api/graph; do
  code=$(curl -s -o /tmp/lgb-curl-body.txt -w '%{http_code}' "http://127.0.0.1:3001${path}" || echo "000")
  echo "  GET ${path} -> HTTP ${code}"
  if [ "$code" = "000" ]; then
    echo "ERROR: No hay respuesta en :3001. Arranca el backend en otra terminal."
    exit 1
  fi
done

echo "==> Frontend proxy (vite must be running: cd frontend && npm run dev)"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:5173/api/health" 2>/dev/null || echo "000")
echo "  GET http://127.0.0.1:5173/api/health -> HTTP ${code}"
if [ "$code" = "000" ]; then
  echo "WARN: Vite no responde en :5173 (¿npm run dev en frontend/?)"
fi

echo "All checks done."
