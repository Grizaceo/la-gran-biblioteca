# Contributing to La Gran Biblioteca

## Setup

```bash
# Backend
python -m venv backend/venv
source backend/venv/bin/activate
pip install -r backend/requirements.txt

# Frontend
cd frontend && npm install
```

Run the app with both processes: `python -m backend.library_bridge` (port 3001) and `cd frontend && npm run dev` (port 5173).

## Testing

```bash
# Backend tests
cd backend && python -m pytest tests/ -v

# Frontend type check
cd frontend && npx tsc --noEmit
```

## PR workflow

1. Fork the repo and create a feature branch from `master`.
2. Keep changes focused. One feature or fix per PR.
3. Add tests for new behavior.
4. Run the full test suite before pushing.
5. Use conventional commit messages (`feat:`, `fix:`, `docs:`, `perf:`, `chore:`).

## Code style

- **Python:** Follow [ruff](https://docs.astral.sh/ruff/) rules (`ruff check backend/`).
- **TypeScript:** Strict mode is on. No `any` without good reason.
- Keep the 3D renderer WebGL-only — no React or framework dependencies.

## Architecture

See `docs/ARQUITECTURA.md` and `AGENTS.md` for the full architecture overview.
