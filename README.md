# La Gran Biblioteca

Visualizador de grafo de conocimiento 2D standalone que escanea `~/.hermes/workspaces/`.

## Stack

- **Backend:** Python + FastAPI + SQLite (puerto 3001)
- **Frontend:** TypeScript + Vite + Canvas 2D + d3-force + d3-zoom (puerto 3000)
- **Sin:** React, Three.js, Neo4j

## Estructura

```
la-gran-biblioteca/
├── backend/
│   ├── scan_workspaces.py  # Escáner recursivo BFS
│   ├── graph_engine.py     # Construcción de grafo + SQLite
│   ├── library_bridge.py   # FastAPI server (SSE)
│   └── export_html.py      # Export HTML estático
└── frontend/
    ├── index.html
    ├── package.json
    └── src/
        ├── main.ts
        └── lib/
            ├── bridge.ts     # API client + SSE
            ├── graphEngine.ts # d3-force layout
            └── renderer.ts   # Canvas 2D render
```

## Uso

### Backend
```bash
cd backend
pip install -r requirements.txt
python library_bridge.py  # http://localhost:3001
```

### Frontend
```bash
cd frontend
npm install
npm run dev  # http://localhost:3000
```

### Export estático
```bash
cd backend
python export_html.py  # genera export/library.html
```

## Endpoints API

- `GET /api/overview` - Resumen compacto (nodos por tipo, top workspaces)
- `GET /api/graph` - Grafo completo con posiciones
- `GET /api/node/{id}` - Nodo específico
- `POST /api/study` - Registrar estudio de nodo
- `GET /api/stream` - SSE para actualizaciones en vivo
- `POST /api/rescan` - Forzar re-escaneo

## Uso desde agentes (MCP)

El MCP server expone todas las operaciones de la biblioteca como tools nativas para agentes (Claude Code, etc.). No requiere que el bridge HTTP esté corriendo.

```bash
# Registrar en Claude Code
claude mcp add la-gran-biblioteca -- python -m backend.mcp_server

# Smoke test
python -m backend.mcp_server  # debe arrancar sin errores
```

Tools principales: `overview`, `search`, `get_node`, `read_node`, `neighbors`, `mark_studied`, `rescan`, `create_file`, `create_folder`, `import_github`, `import_arxiv`, `import_pubmed`.

Ver [`AGENTS.md`](AGENTS.md) para guía completa de uso desde agentes.