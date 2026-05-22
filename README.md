# La Gran Biblioteca

Visualizador 3D de grafo de conocimiento que escanea `~/.hermes/workspaces/`.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Security](SECURITY.md)](SECURITY.md)
[![Contributing](CONTRIBUTING.md)](CONTRIBUTING.md)

## Stack

- **Backend:** Python + FastAPI + SQLite + watchdog (puerto 3001)
- **Frontend:** TypeScript + Vite + Three.js + 3d-force-graph (puerto 5173 en dev)
- **Agentes:** MCP stdio server (`backend/mcp_server.py`)
- **Sin:** React, Neo4j

## Estructura

```
la-gran-biblioteca/
├── backend/
│   ├── scan_workspaces.py    # Escáner recursivo BFS
│   ├── graph_engine.py       # Grafo + SQLite
│   ├── library_bridge.py     # FastAPI (REST + SSE)
│   ├── workspace_watcher.py  # watchdog → cola asyncio (coalescencia 500ms)
│   ├── mcp_server.py         # MCP para agentes
│   └── export_html.py        # Export HTML estático
└── frontend/
    ├── index.html
    ├── package.json
    └── src/
        ├── main.ts
        ├── lib/bridge.ts           # API client + SSE
        └── render3d/
            ├── Graph3DEngine.ts    # WebGL + d3-force 3D
            ├── renderOptimizations.ts
            └── ui/                 # search, minimap, focus, visibility
```

## Uso

### Backend (solo API — no sirve la UI)
```bash
# Desde la raíz del repo (no desde backend/)
pip install -r backend/requirements.txt
python -m backend.library_bridge   # http://localhost:3001/api/health
```

### Frontend (visualizador 3D)
```bash
cd frontend
npm install
npm run dev   # http://localhost:5173  (proxy /api → :3001)
```

Necesitas **ambos** procesos. Abrir solo `http://localhost:3001` en el navegador muestra la API, no el grafo.

**WSL:** el proxy de Vite debe apuntar a `127.0.0.1:3001` (no `localhost`), porque Node puede usar IPv6 (`::1`) y el backend escucha en IPv4. Tras cambiar config, reinicia `npm run dev`. Comprueba el proxy:

```bash
curl -s http://127.0.0.1:5173/api/health
```

### Docker
```bash
cp .env.example .env   # ajustar WORKSPACE_ROOT
docker compose up --build
```

### Export estático
```bash
cd backend
python export_html.py  # genera export/library.html
```

## Variables de entorno

Ver [`.env.example`](.env.example). Principales: `WORKSPACE_ROOT`, `DB_PATH`, `CORS_ORIGINS`, `LGB_API_KEY` (opcional, para exposición en red).

## Endpoints API

- `GET /api/overview` — Resumen compacto (nodos por tipo, top workspaces)
- `GET /api/graph` — Grafo (limitado a 1000 nodos en respuesta)
- `GET /api/node/{id}` — Nodo específico
- `GET /api/node/{id}/content` — Contenido del archivo
- `POST /api/study` — Registrar estudio de nodo
- `GET /api/stream` — SSE (actualizaciones vía watchdog, no polling)
- `POST /api/rescan` — Forzar re-escaneo
- `GET /api/health` — Health check

## Uso desde agentes (MCP)

El MCP server expone las operaciones de la biblioteca como tools nativas. No requiere que el bridge HTTP esté corriendo.

```bash
# Registrar en Claude Code (desde la raíz del repo)
claude mcp add la-gran-biblioteca -- python -m backend.mcp_server
```

Tools principales: `overview`, `search`, `get_node`, `read_node`, `neighbors`, `mark_studied`, `rescan`, `create_file`, `create_folder`, `import_github`, `import_arxiv`, `import_pubmed`.

Ver [`AGENTS.md`](AGENTS.md) para la guía completa.

## Seguridad

La aplicación es local-first por defecto. Ver [`SECURITY.md`](SECURITY.md) para el modelo de seguridad completo, hardening en producción, y cómo reportar vulnerabilidades.

## Desarrollo

Ver [`CONTRIBUTING.md`](CONTRIBUTING.md) para guías de setup, testing, y PR workflow.

## Changelog

Ver [`CHANGELOG.md`](CHANGELOG.md) para el historial de versiones.
