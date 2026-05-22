# La Gran Biblioteca — guía para agentes

## Qué es

Visualizador y gestor de un **grafo de conocimiento** sobre `~/.hermes/workspaces/`.
Cada archivo/carpeta escaneado es un **nodo**; cada wikilink o dependencia es una **arista**.
Backend: FastAPI + SQLite (`backend/library.db`). Frontend: Canvas 2D + d3-force.

## Cómo navegar rápido (MCP preferred)

Usa el MCP server `la-gran-biblioteca` en lugar de leer código o llamar a `curl`.
Es más rápido, más seguro (path-validated) y no gasta tokens parseando JSON a mano.

### Configurar el MCP en Claude Code

```bash
# desde la raíz del repo:
claude mcp add la-gran-biblioteca -- python -m backend.mcp_server
```

O en `~/.claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "la-gran-biblioteca": {
      "command": "python",
      "args": ["-m", "backend.mcp_server"],
      "cwd": "/ruta/a/la-gran-biblioteca"
    }
  }
}
```

## Tools disponibles

| Tool | Qué hace |
|------|----------|
| `overview()` | **Empieza aquí.** Conteos por tipo, top workspaces, imports recientes |
| `list_workspaces()` | Workspaces de primer nivel con nodo-counts |
| `search(query, node_type?, tag?, workspace?, limit?, offset?)` | Búsqueda texto/tag/tipo con paginación |
| `get_node(id)` | Metadata + aristas de entrada/salida en una sola llamada |
| `read_node(id, max_chars?)` | Contenido del archivo (truncado con `truncated=true` si es grande) |
| `neighbors(id, direction?, depth?, limit?)` | BFS desde un nodo (`out`/`in`/`both`, depth≤3) |
| `mark_studied(id)` | Incrementa `study_count` en el nodo |
| `rescan()` | Fuerza re-escaneo del workspace |
| `create_file(relative_path, content?)` | Crea archivo dentro del workspace |
| `create_folder(relative_path)` | Crea carpeta dentro del workspace |
| `import_github(repo_url)` | Descarga repo público de GitHub |
| `import_arxiv(arxiv_id)` | Importa paper de arXiv como Markdown |
| `import_pubmed(pmid)` | Importa paper de PubMed como Markdown |
| `open_in_os(id, reveal?)` | Abre en app del SO (requiere `LGB_MCP_ALLOW_OS_OPEN=1`) |

## Flujos comunes

### Explorar el grafo desde cero
```
overview()                          # ¿cuántos nodos, tipos, workspaces?
list_workspaces()                   # ¿qué proyectos hay?
search("machine learning")          # buscar por tema
get_node("<id>")                    # ver metadata + vecinos
read_node("<id>")                   # leer contenido
```

### Encontrar todo lo relacionado con un tema
```
search("transformers", workspace="papers")
neighbors("<id>", direction="both", depth=2)
```

### Importar material nuevo y revisarlo
```
import_arxiv("2401.00001")
rescan()
search("2401")                      # encontrar el nodo recién creado
read_node("<id>")
mark_studied("<id>")
```

## Estructura del código (si necesitas tocar internals)

```
backend/
  library_bridge.py   # FastAPI server (HTTP + SSE)
  mcp_server.py       # MCP stdio server (este archivo llama aquí)
  graph_engine.py     # GraphEngine: SQLite ↔ grafo en memoria
  scan_workspaces.py  # BFS scanner recursivo
  overview.py         # build_overview() compartido por MCP y HTTP
  imports.py          # GitHub / arXiv / PubMed importers
  preview.py          # read_preview() para contenido de archivos
  constants.py        # WORKSPACE_ROOT, extensiones, límites
frontend/src/
  lib/bridge.ts       # API client + SSE
  lib/graphEngine.ts  # d3-force layout
  lib/renderer.ts     # Canvas 2D render
```

## Endpoints HTTP (si el bridge está corriendo en :3001)

```
GET  /api/overview          ← equivale a tool overview()
GET  /api/graph             ← grafo completo (limitado 1000 nodos)
GET  /api/node/{id}         ← nodo por ID
GET  /api/node/{id}/content ← contenido del archivo
POST /api/study             ← marcar estudiado
POST /api/rescan            ← re-escanear
```
