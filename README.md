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

- `GET /api/graph` - Grafo completo con posiciones
- `GET /api/node/{id}` - Nodo específico
- `POST /api/study` - Registrar estudio de nodo
- `GET /api/stream` - SSE para actualizaciones en vivo
- `POST /api/rescan` - Forzar re-escaneo