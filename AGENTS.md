# La Gran Biblioteca — guía para agentes

## Qué es

Visualizador y gestor de un **grafo de conocimiento** sobre `WORKSPACE_ROOT` (configurado en `.env`; por defecto `~/knowledge`).
Cada archivo/carpeta escaneado es un **nodo**; cada wikilink o dependencia es una **arista**.
Backend: FastAPI + SQLite (`backend/library.db`) + watchdog (SSE event-driven). Frontend: WebGL 3D (`three` + `3d-force-graph`).

## LGB MCP vs CodeGraph (repos de código en el vault)

La Gran Biblioteca escanea **todo el vault** (notas, papers, imports, carpetas de código clonadas).
**CodeGraph** es un MCP hermano para **símbolos y call graphs** dentro de un repo concreto — no lo sustituye.

| Pregunta del agente | Herramienta |
|---------------------|-------------|
| Mapa del vault, huecos de estudio, lens en la UI | LGB `overview()` → `coverage()` → `publish_lens()` |
| Contenido de una nota o archivo del vault | LGB `read_node()` / `explore()` |
| Búsqueda rápida con contexto (nodos + aristas + preview) | LGB `explore(query)` |
| Cómo funciona **código** en un repo clonado bajo el vault | **CodeGraph** en esa carpeta (`.codegraph/`) |
| Re-analizar el grafo tras editar archivos **por MCP** | LGB `rescan()` (obligatorio antes de `search` si acabas de crear/importar) |

### CodeGraph opcional (subcarpetas `imports/` o workspaces de código)

Instálalo **solo** en la carpeta del repo, no en la raíz del vault entero:

```bash
# Dentro del repo clonado, p.ej. WORKSPACE_ROOT/imports/github/owner-repo/
npm install -g @colbymchenry/codegraph   # o el instalador del proyecto CodeGraph
codegraph init -i
```

Configura el MCP CodeGraph en Cursor/Claude apuntando al directorio del repo.
El agente usa **LGB** para conocimiento (wikis, papers, lens 3D) y **CodeGraph** para `trace`, impacto a nivel **símbolo**, y contexto de funciones.

LGB ofrece `impact_files()` a nivel **archivo** (wikilinks + `depends_on` heurístico) cuando no hace falta CodeGraph.

## Cómo navegar rápido (MCP preferred)

Usa el MCP server `la-gran-biblioteca` en lugar de leer código o llamar a `curl`.
Es más rápido, más seguro (path-validated) y no gasta tokens parseando JSON a mano.

Tras **cualquier mutación MCP** (`create_file`, `import_arxiv`, `import_github`, `create_note`, `delete_note`, …) llama `rescan()` antes de confiar en `search()` o `overview()` si el grafo parece desactualizado — `create_note` / `delete_note` ya ejecutan `_rescan_and_reload()` inline; en sesiones largas un `rescan()` extra no hace daño. El proceso MCP mantiene su propia copia del grafo en RAM (ver bridge vs MCP más abajo).

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
| `overview()` | **Empieza aquí.** Conteos por tipo, top workspaces, imports recientes, cobertura agregada |
| `coverage()` | Métricas por workspace/carpeta/topic (`study_ratio`, `avg_degree`, …) |
| `apply_lens(lens?, preset?)` | Valida lens + `search_preview` + nodo foco sugerido (no publica) |
| `publish_lens(lens?, preset?, focus_node_id?, highlight_ids?)` | Publica vista para la barra UI (`GET /api/lens/current`) |
| `list_workspaces()` | Workspaces de primer nivel con nodo-counts |
| `search(query, mode?, node_type?, …)` | Búsqueda con `mode`: `text` (FTS), `related` (vecinos de semillas), `hub` (top por grado; `query` vacío OK). Ver `docs/search-bar.md` |
| `get_node(id)` | Metadata + aristas + `attached_notes` (preview) cuando el nodo es documento fuente |
| `read_node(id, max_chars?)` | Contenido del archivo (truncado con `truncated=true` si es grande) |
| `neighbors(id, direction?, depth?, limit?)` | BFS desde un nodo (`out`/`in`/`both`, depth≤3) |
| `mark_studied(id)` | Incrementa `study_count` en el nodo |
| `rescan()` | Fuerza re-escaneo del workspace |
| `create_file(relative_path, content?)` | Crea archivo dentro del workspace |
| `create_folder(relative_path)` | Crea carpeta dentro del workspace |
| `create_note(source_node_id, body, title?, labels?, selected_text?, storage?)` | Crea nota ligada a un nodo: `storage=vault` (default MCP, `_notes/`) o `storage=inline` (bloque `<!-- lgb-note -->` en el `.md` fuente); rescanea el grafo MCP |
| `get_note(note_id)` | Lee una nota por id corto (inline o vault) |
| `update_note(note_id, title?, body?, labels?)` | Actualiza nota inline o vault; rescanea el grafo MCP |
| `search_notes(query?, label?, source_node_id?, limit?)` | Busca notas en todo el vault (inline + `_notes/`) |
| `list_notes(source_node_id)` | Lista notas inline + vault de un nodo fuente |
| `delete_note(note_id)` | Borra nota por id corto (8 chars); rescanea el grafo MCP |
| `import_github(repo_url)` | Descarga repo público de GitHub |
| `search_arxiv(query?, author?, category?, max_results?, sort?)` | Busca papers en arXiv (solo lectura; respeta ~1 req/3 s) |
| `import_arxiv(arxiv_id)` | Importa paper de arXiv como Markdown |
| `import_pubmed(pmid)` | Importa paper de PubMed como Markdown |
| `import_doi(doi)` | Importa DOI como Markdown (`imports/doi/`) |
| `import_pmc(pmcid)` | Importa referencia PMC (`imports/pmc/`) |
| `import_preprint` (medRxiv/bioRxiv vía HTTP) | `POST /api/create/medrxiv` o `/api/create/biorxiv` con `{"id":"..."}` |
| `explore(query, workspace?, depth=1)` | Búsqueda + subgrafo + previews truncados en una llamada |
| `impact_files(paths[])` | BFS inverso: qué nodos referencian o dependen de esas rutas |
| `get_tour(workspace)` | Pasos del tour generados desde `index.md` (wiki Karpathy) |
| `open_in_os(id, reveal?)` | Abre en app del SO (requiere `LGB_MCP_ALLOW_OS_OPEN=1`) |

## Flujos comunes

### Explorar el grafo desde cero
```
overview()                          # ¿cuántos nodos, tipos, workspaces?
coverage()                          # ¿dónde hay huecos de estudio?
list_workspaces()                   # ¿qué proyectos hay?
search("machine learning")          # buscar por tema
get_node("<id>")                    # ver metadata + vecinos
read_node("<id>")                   # leer contenido
```

### Agent-native: alinear criterio con el humano en la UI
```
coverage()                                    # orientación por workspace
apply_lens(preset="gaps_unstudied")           # preview de búsqueda + foco
publish_lens(preset="gaps_unstudied", focus_node_id="<id>", highlight_ids=[...])
neighbors("<id>", depth=2)                    # mismo radio que foco depth=2 en UI
```

El humano ve la **barra «Vista del agente»** (poll de `GET /api/lens/current`) y pulsa **Aplicar** para filtros + heatmap + flyTo + resaltados **sin recargar** el grafo. Presets: `heatmap_study`, `heatmap_volume`, `gaps_unstudied`, `follow_index` (tour desde `index.md`), `agent_default`.

### Encontrar todo lo relacionado con un tema
```
search("transformers", workspace="papers")
search("transformers", mode="related", workspace="papers")   # vecinos en grafo (UI: pestaña Relacionados)
search("", mode="hub", limit=15)                            # top nodos enlazados (UI: pestaña Hubs)
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

## Bridge HTTP vs servidor MCP (dos procesos)

Hay **dos procesos independientes** que comparten `backend/library.db` y `WORKSPACE_ROOT`, pero **no** comparten el grafo en memoria:

| | **Bridge HTTP** (`python -m backend.library_bridge`, :3001) | **MCP** (`python -m backend.mcp_server`, stdio) |
|---|-------------------------------------------------------------|------------------------------------------------|
| Para qué | UI en el navegador, SSE, watchdog al cambiar archivos | Agentes (Cursor, Claude Code, etc.) |
| Grafo en RAM | `graph_state` (cap ~1000 nodos para `/api/graph`) | Copia propia cargada al arrancar |
| ¿Necesita el otro? | No para servir la UI | No para leer/escribir la bóveda |

**Qué implica en la práctica:**

1. **Cambios en la UI o por watchdog** (rescan automático, imports desde el menú): el MCP sigue con datos viejos hasta que llames `rescan()` en el MCP o **reinicies** el proceso MCP.
2. **Mutaciones por MCP** (`create_file`, `import_arxiv`, etc.): escriben en disco y en SQLite solo tras `rescan()`; la UI no muestra nodos nuevos hasta `POST /api/rescan`, un rescan por watchdog, o reiniciar el bridge.
3. **`create_file` / imports no llaman `rescan()` solos** — el agente debe ejecutar `rescan()` antes de `search()` si quiere ver el nodo nuevo. **`create_note` / `delete_note` sí rescanean inline**; usa `rescan()` si aún ves datos viejos.
4. **`overview().recent_imports`** en MCP solo lista imports hechos **en esa sesión MCP**; los de la UI viven en `graph_state` del bridge.

Ambos usan el mismo pipeline (`rebuild_graph` en `services/graph_pipeline.py`) cuando rescanean.

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
  render3d/Graph3DEngine.ts  # orquestador WebGL 3D (LOD/Filter/Particle/Layout managers)
  render3d/{LODManager,FilterManager,ParticleManager,LayoutManager,gpuCache}.ts
  render3d/renderOptimizations.ts  # perfiles adaptativos, carga progresiva
  AppController.ts           # bootstrap UI (main.ts solo instancia)
  styles/{base,layout,panels,search,...}.css  # módulos CSS (@component); tokens.css
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
GET  /api/coverage          ← estructura enriquecida (study_ratio, avg_degree, …)
GET  /api/lens/current      ← lens publicado por agente o UI
POST /api/lens/current      ← publicar lens (paridad con publish_lens)
POST /api/lens/apply        ← preview búsqueda + foco sugerido
GET  /api/graph             ← grafo completo (limitado 1000 nodos)
GET  /api/node/{id}         ← nodo por ID
GET  /api/node/{id}/content ← contenido del archivo
GET  /api/arxiv/search?q=…  ← búsqueda arXiv (sin API key; params: q, author, cat, max, sort)
POST /api/study             ← marcar estudiado
POST /api/rescan            ← re-escanear
```

## Extensión de navegador (repo hermano)

El repo hermano **`lgb-citation-spotter`** (extensión «LGB Citation Spotter») detecta en páginas web citas **arXiv**, **PubMed (PMID)** y repos públicos de **GitHub**, y puede importarlas al bridge local con:

- `POST /api/create/arxiv` — body `{"id": "<arxiv_id o URL>"}`
- `POST /api/create/pubmed` — body `{"id": "<pmid o URL>"}`
- `POST /api/create/github` — body `{"url": "<https://github.com/owner/repo>"}`

Health: `GET /api/overview`. Si el bridge exige API key, header `X-API-Key` (misma variable `LGB_API_KEY` que el backend).

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
