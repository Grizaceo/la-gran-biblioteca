# La Gran Biblioteca

Visualizador 3D de grafo de conocimiento sobre un vault local de Markdown, código y notas.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/TU_USUARIO/la-gran-biblioteca/actions/workflows/ci.yml/badge.svg)](https://github.com/TU_USUARIO/la-gran-biblioteca/actions/workflows/ci.yml)
[![Security](SECURITY.md)](SECURITY.md)
[![Contributing](CONTRIBUTING.md)](CONTRIBUTING.md)

> **Screenshot:** add `docs/images/graph-hero.png` after your first public release and link it here.

## Stack

- **Backend:** Python + FastAPI + SQLite + watchdog (puerto 3001)
- **Frontend:** TypeScript + Vite + Three.js + 3d-force-graph (puerto 5173 en dev)
- **Agentes:** MCP stdio server (`backend/mcp_server.py`)
- **Sin:** React, Neo4j

## Quick start (new users)

```bash
git clone https://github.com/TU_USUARIO/la-gran-biblioteca.git
cd la-gran-biblioteca
mkdir -p ~/knowledge    # or any vault path you prefer

cp .env.example .env    # first-time setup only — see warning below
# Edit .env: set WORKSPACE_ROOT=~/knowledge (default in .env.example)

python -m venv backend/venv && source backend/venv/bin/activate
pip install -r backend/requirements.txt
python -m backend.library_bridge   # http://127.0.0.1:3001/api/health

cd frontend && npm install && npm run dev   # http://localhost:5173
```

Abre **http://localhost:5173** (no solo :3001 — ahí está solo la API).

### Existing Hermes / `.env` users

If you already have a working `.env` pointing at `~/.hermes/workspaces`, **keep it**. Do not overwrite `.env` with `.env.example`.

For reference only, `.env.example` documents the Hermes profile as a commented line:

```bash
# WORKSPACE_ROOT=~/.hermes/workspaces
```

The backend still defaults to `~/.hermes/workspaces` when `WORKSPACE_ROOT` is unset (`backend/constants.py`).

## Configuration profiles

| Profile | `WORKSPACE_ROOT` | When to use |
|---------|------------------|-------------|
| **Generic vault** | `~/knowledge` (in `.env.example`) | New clones, open-source quick start |
| **Hermes** | `~/.hermes/workspaces` | Existing Agent OS / RepoCiv workspaces |

**Important:** `.env` is gitignored and local. Never run `cp .env.example .env` on top of an existing `.env` — merge new variables by hand. See [CONTRIBUTING.md](CONTRIBUTING.md).

If constellation features fail at runtime, generate the catalog once: `python -m backend.scripts.generate_constellation_catalog`.

## Estructura

```
la-gran-biblioteca/
├── backend/          # FastAPI, scan, GraphEngine, MCP
├── frontend/         # Vite + WebGL 3D
├── docs/             # ARQUITECTURA.md, ecosystem-hermes.md, images/
├── scripts/health.sh # ruff + pytest + tsc
└── docker-compose.yml
```

## Uso

### Backend (solo API)
```bash
# Desde la raíz del repo
source backend/venv/bin/activate
python -m backend.library_bridge   # http://127.0.0.1:3001/api/health
```

### Frontend (visualizador 3D)
```bash
cd frontend
npm run dev   # proxy /api → :3001
```

**WSL:** el proxy de Vite debe apuntar a `127.0.0.1:3001` (ver `.env.example` → `VITE_API_TARGET`). Comprueba:

```bash
curl -s http://127.0.0.1:5173/api/health
```

### Docker
```bash
mkdir -p vault          # or set WORKSPACE_ROOT in .env
cp .env.example .env    # first time only
docker compose up --build
```

Compose mounts `${WORKSPACE_ROOT:-./vault}` — no hardcoded `~/.hermes` paths.

### Health checks
```bash
bash scripts/health.sh
```

### Export estático
```bash
cd backend && python export_html.py   # export/library.html
```

## Variables de entorno

Ver [`.env.example`](.env.example). Principales: `WORKSPACE_ROOT`, `DB_PATH`, `CORS_ORIGINS`, `LGB_API_KEY`, `LGB_ARXIV_USER_AGENT` (contact URL for arXiv ToU).

## Endpoints API

- `GET /api/overview` — resumen compacto
- `GET /api/graph` — grafo (cap en respuesta)
- `GET /api/node/{id}` — nodo
- `GET /api/node/{id}/content` — contenido
- `POST /api/study` — registrar estudio
- `GET /api/stream` — SSE (watchdog)
- `POST /api/rescan` — re-escaneo
- `GET /api/health` — health check

## Uso desde agentes (MCP)

```bash
claude mcp add la-gran-biblioteca -- python -m backend.mcp_server
```

Ver [`AGENTS.md`](AGENTS.md) para tools y flujos.

## Publicar en GitHub (manual)

1. Replace `TU_USUARIO` in README, `SECURITY.md`, `.env.example`, and `frontend/package.json` `repository.url`.
2. Create the repo on GitHub (empty, no README) and push: `git remote add origin …`, `git push -u origin main`.
3. Add `docs/images/graph-hero.png` and update the screenshot line in this README.
4. Tag first release: `git tag v0.1.0 && git push origin v0.1.0` (see [CHANGELOG.md](CHANGELOG.md)).

## Seguridad

[`SECURITY.md`](SECURITY.md) — modelo local-first, reporte vía GitHub Security Advisories.

## Desarrollo

[`CONTRIBUTING.md`](CONTRIBUTING.md) — setup, `scripts/health.sh`, PRs a `main`.

## Changelog

[`CHANGELOG.md`](CHANGELOG.md)
