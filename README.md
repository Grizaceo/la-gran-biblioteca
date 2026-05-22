# La Gran Biblioteca

3D knowledge-graph visualizer for a local vault of Markdown, code, and notes.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Grizaceo/la-gran-biblioteca/actions/workflows/ci.yml/badge.svg)](https://github.com/Grizaceo/la-gran-biblioteca/actions/workflows/ci.yml)

> Scans a local directory (`WORKSPACE_ROOT`), builds a SQLite graph of files and links,
> and renders it as an interactive WebGL constellation in the browser.

## Stack

- **Backend:** Python + FastAPI + SQLite + watchdog (port 3001)
- **Frontend:** TypeScript + Vite + Three.js + 3d-force-graph (port 5173 in dev)
- **Agents:** MCP stdio server (`backend/mcp_server.py`)
- **No:** React, Neo4j

## Quick start

```bash
git clone https://github.com/Grizaceo/la-gran-biblioteca.git
cd la-gran-biblioteca
mkdir -p ~/knowledge    # or any vault path you prefer

cp .env.example .env
# Edit .env: set WORKSPACE_ROOT=~/knowledge

python -m venv backend/venv && source backend/venv/bin/activate
pip install -r backend/requirements.txt
python -m backend.library_bridge   # http://127.0.0.1:3001/api/health

cd frontend && npm install && npm run dev   # http://localhost:5173
```

Open **http://localhost:5173** — the graph renders there, not at :3001 (that is the API only).

### Existing Hermes / `.env` users

If you already have a working `.env` pointing at `~/.hermes/workspaces`, **keep it**. Do not overwrite `.env` with `.env.example`.

`.env.example` documents the Hermes profile as a commented reference line:

```bash
# WORKSPACE_ROOT=~/.hermes/workspaces
```

The backend defaults to `~/.hermes/workspaces` when `WORKSPACE_ROOT` is unset (`backend/constants.py`).

## Configuration profiles

| Profile | `WORKSPACE_ROOT` | When to use |
|---------|------------------|-------------|
| **Generic vault** | `~/knowledge` (in `.env.example`) | New clones, open-source quick start |
| **Hermes** | `~/.hermes/workspaces` | Existing Agent OS / RepoCiv workspaces |

**Important:** `.env` is gitignored and local. Never run `cp .env.example .env` on top of an existing `.env` — merge new variables by hand. See [CONTRIBUTING.md](CONTRIBUTING.md).

If constellation features fail at runtime, regenerate the catalog once:

```bash
python -m backend.scripts.generate_constellation_catalog
```

## Structure

```
la-gran-biblioteca/
├── backend/          # FastAPI, scan, GraphEngine, MCP
├── frontend/         # Vite + WebGL 3D
├── docs/             # ARQUITECTURA.md, ecosystem-hermes.md
├── scripts/health.sh # ruff + pytest + tsc
└── docker-compose.yml
```

## Usage

### Backend (API only)

```bash
source backend/venv/bin/activate
python -m backend.library_bridge   # http://127.0.0.1:3001/api/health
```

### Frontend (3D visualizer)

```bash
cd frontend
npm run dev   # proxy /api → :3001
```

**WSL:** Vite proxy must point to `127.0.0.1:3001` (see `.env.example` → `VITE_API_TARGET`). Verify:

```bash
curl -s http://127.0.0.1:5173/api/health
```

### Docker

```bash
mkdir -p vault          # or set WORKSPACE_ROOT in .env
cp .env.example .env    # first time only
docker compose up --build
```

Compose mounts `${WORKSPACE_ROOT:-./vault}` — no hardcoded paths.

### Health checks

```bash
bash scripts/health.sh
```

### Static export

```bash
cd backend && python export_html.py   # generates export/library.html
```

## Environment variables

See [`.env.example`](.env.example). Key variables: `WORKSPACE_ROOT`, `DB_PATH`, `CORS_ORIGINS`, `LGB_API_KEY`, `LGB_ARXIV_USER_AGENT` (contact URL for arXiv ToU).

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/overview` | Compact summary |
| `GET` | `/api/graph` | Full graph (capped response) |
| `GET` | `/api/node/{id}` | Node metadata |
| `GET` | `/api/node/{id}/content` | Node file content |
| `POST` | `/api/study` | Record a study event |
| `GET` | `/api/stream` | SSE event stream (watchdog) |
| `POST` | `/api/rescan` | Trigger a re-scan |

## Agent usage (MCP)

```bash
claude mcp add la-gran-biblioteca -- python -m backend.mcp_server
```

See [`AGENTS.md`](AGENTS.md) for available tools and agent workflows.

## Security

[`SECURITY.md`](SECURITY.md) — local-first model, report via GitHub Security Advisories.

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) — setup, `scripts/health.sh`, PRs to `main`.

## Changelog

[`CHANGELOG.md`](CHANGELOG.md)

## License

[MIT](LICENSE)
