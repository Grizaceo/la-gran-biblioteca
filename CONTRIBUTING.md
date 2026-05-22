# Contributing to La Gran Biblioteca

Thanks for helping improve La Gran Biblioteca.

## Setup

```bash
python -m venv backend/venv
source backend/venv/bin/activate
pip install -r backend/requirements-dev.txt

cd frontend && npm install
```

Run the app with both processes: `python -m backend.library_bridge` (port 3001) and `cd frontend && npm run dev` (port 5173).

## Local `.env` (do not overwrite)

- `.env` is **gitignored** and may contain machine-specific paths and secrets.
- **Do not** run `cp .env.example .env` if you already have a working `.env` — you will wipe `WORKSPACE_ROOT`, API keys, and custom settings.
- For a **new** clone, copy once: `cp .env.example .env`, then edit `WORKSPACE_ROOT` to point at your local vault (e.g. `~/knowledge`).
- When `.env.example` gains new variables, merge them into your existing `.env` by hand.

## Constellation catalog

The IAU-88 catalog lives at `backend/data/constellations.json`. Regenerate after changing `backend/scripts/generate_constellation_catalog.py`:

```bash
python -m backend.scripts.generate_constellation_catalog
```

## Health checks

From the repo root:

```bash
bash scripts/health.sh
```

This runs:

- `ruff check backend/`
- `pytest` in `backend/tests/`
- `npx tsc --noEmit` in `frontend/`

Optional: `cd frontend && npm run build` before a release.

## Testing

```bash
source backend/venv/bin/activate
cd backend && WORKSPACE_ROOT=$(mktemp -d) python -m pytest tests/ -v
cd ../frontend && npx tsc --noEmit
```

CI uses a temporary `WORKSPACE_ROOT` the same way.

## PR workflow

1. Fork the repo and create a feature branch from `main`.
2. Keep changes focused — one feature or fix per PR.
3. Add tests for new behavior.
4. Run `bash scripts/health.sh` before pushing.
5. Use conventional commit messages (`feat:`, `fix:`, `docs:`, `perf:`, `chore:`).

## Code style

- **Python:** [ruff](https://docs.astral.sh/ruff/) (`ruff check backend/`), config in `pyproject.toml`
- **TypeScript:** strict mode; avoid `any` without good reason
- Keep the 3D renderer WebGL-only — no React or SPA frameworks

## Architecture

- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) — technical architecture
- [`AGENTS.md`](AGENTS.md) — agent/MCP guide and skill routing
