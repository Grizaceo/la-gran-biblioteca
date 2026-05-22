# La Gran Biblioteca — guía para agentes

## Qué es

Visualizador y gestor de un **grafo de conocimiento** sobre `WORKSPACE_ROOT` (por defecto `~/.hermes/workspaces` si no hay `.env`; ver `.env.example` para vault genérico `~/knowledge`).
Cada archivo/carpeta escaneado es un **nodo**; cada wikilink o dependencia es una **arista**.
Backend: FastAPI + SQLite (`backend/library.db`) + watchdog (SSE event-driven). Frontend: WebGL 3D (`three` + `3d-force-graph`).

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
| `search_arxiv(query?, author?, category?, max_results?, sort?)` | Busca papers en arXiv (solo lectura; respeta ~1 req/3 s) |
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
search_arxiv(query="transformers", max_results=5)   # elegir arxiv_id
import_arxiv("2401.00001")                        # o ID conocido
rescan()
search("2401")                      # encontrar el nodo recién creado
read_node("<id>")
mark_studied("<id>")
```

Flujo recomendado con arXiv: `search_arxiv` → revisar `results[].arxiv_id` → `import_arxiv(id)` → `rescan()`.
En la UI: Archivo → Importar arXiv → pestaña **Buscar** → seleccionar fila → **Importar seleccionado**.

## Estructura del código (si necesitas tocar internals)

```
backend/
  library_bridge.py        # FastAPI app factory + lifespan
  api/                     # Routers: graph, nodes, constellation, create, imports, overview
  services/graph_pipeline.py  # Scan → merge imports → constellation → build (HTTP + MCP)
  graph_state.py           # Grafo en memoria, cap 1000 nodos, imports recientes
  mcp_server.py            # MCP stdio (usa graph_pipeline)
  graph_engine.py          # GraphEngine: SQLite ↔ grafo en memoria
  scan/                    # walker, markdown, layout (scan_workspaces re-exporta)
  overview.py              # build_overview() compartido por MCP y HTTP
  imports.py               # GitHub / arXiv / PubMed importers
  preview.py               # read_node_content() / read_preview()
  constants.py             # WORKSPACE_ROOT, LGB_ARCHIVE_POLICY, excludes
frontend/src/
  lib/api/                   # client, graph, nodes, imports, constellation
  lib/bridge.ts              # Barrel re-export
  services/constellationService.ts
  render3d/Graph3DEngine.ts  # WebGL 3D + d3-force
  render3d/renderOptimizations.ts  # perfiles adaptativos, carga progresiva
  render3d/ui/               # search, minimap, focus, visibility
  ui/                        # detailPanel, menuBar, tooltip, contextMenu
```

## Variables de entorno

Ver [`.env.example`](.env.example). Para exposición en red: `LGB_API_KEY` (header `X-API-Key` en POST mutadores) y `LGB_RATE_LIMIT_PER_MIN`.

### Vault hygiene (carpetas archive)

Por defecto el escáner **omite** subárboles cuyo directorio se llame exactamente `archive`, `backups` o `snapshots` (ruido, snapshots viejos, copias de seguridad). Configurable con `LGB_ARCHIVE_POLICY`:

| Valor | Comportamiento |
|-------|----------------|
| `exclude` (default) | No entran al BFS |
| `shadow` | Nodo `folder` con `metadata.archived: true`, sin hijos (“bóveda cerrada”) |
| `include` | Escaneo normal (solo para vaults pequeños) |

`LGB_EXTRA_EXCLUDE_DIRS=vendor,cache` añade nombres a la lista de exclusión técnica (`.git`, `node_modules`, etc.).

## Endpoints HTTP (si el bridge está corriendo en :3001)

```
GET  /api/overview          ← equivale a tool overview()
GET  /api/graph             ← grafo completo (limitado 1000 nodos)
GET  /api/node/{id}         ← nodo por ID
GET  /api/node/{id}/content ← contenido del archivo
GET  /api/arxiv/search?q=…  ← búsqueda arXiv (sin API key; params: q, author, cat, max, sort)
POST /api/study             ← marcar estudiado
POST /api/rescan            ← re-escanear
```

## Documentación adicional

- [`README.md`](README.md) — descripción general, setup, endpoints
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — guía de contribución y PR workflow
- [`SECURITY.md`](SECURITY.md) — modelo de seguridad y reporte de vulnerabilidades
- [`CHANGELOG.md`](CHANGELOG.md) — historial de versiones
- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) — decisiones de arquitectura

## Health Stack

Ejecutar todo: `./scripts/health.sh` (desde la raíz del repo, en WSL/Linux).

- **typecheck**: `cd frontend && npx tsc --noEmit`
- **lint**: `ruff check backend/`
- **test**: `cd backend && python -m pytest tests/ -v`
- **deadcode (opcional)**: `vulture backend/` — símbolos Python sin usar; `cd frontend && npx knip` — exports TS muertos tras splits de `bridge.ts`

## Skill routing

When the user's request matches an available Cursor skill (listed in the agent session), read and follow that skill file immediately. When in doubt, invoke the skill rather than improvising.

Open-source contributors: upstream skills may live outside this repo; only use skills present in your Cursor environment.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
