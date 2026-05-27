# Barra de búsqueda del grafo 3D

La barra superior (`#search-container`) consulta `GET /api/search` con tres modos. La misma lógica está en la herramienta MCP `search(..., mode=...)`.

## Pestañas

| Pestaña | `mode` | Cuándo usarla |
|---------|--------|----------------|
| **Buscar** | `text` | Encontrar un archivo o nota por nombre, ruta, tema o tag. Requiere texto (vacío no hace nada). |
| **Relacionados** | `related` | «Qué está enlazado con X»: vecinos en el grafo a partir de coincidencias con X. Requiere texto. |
| **Hubs** | `hub` | Nodos con más aristas (notas muy referenciadas, carpetas centrales). **No requiere texto**: al abrir la pestaña se lista el top 20. |

Filtro de **tipo** (botón a la izquierda del campo): restringe resultados a `markdown`, `folder`, etc.

Clic en un resultado: la cámara vuela al nodo y lo resalta unos segundos.

Atajos: `Ctrl+K` o `/` enfocan el campo; `Esc` cierra la lista.

## Cómo se calcula cada modo (backend)

Implementación: `backend/graph_queries.py` → `search_graph()`.

### `text`

1. Índice full-text del motor (`engine.search_index`) sobre el grafo actual.
2. Cada hit incluye `why` con el campo que coincidió (`label`, `path`, `topics`, `tags` o `índice`).
3. Respeta filtros: tipo, workspace, topic, carpeta, grado mínimo, estudiado/no estudiado, import.

### `related`

1. **Semillas**: hasta 10 nodos del índice FTS con la consulta; si el índice no devuelve nada, semillas por substring en `label` o `path`.
2. **Expansión**: para cada semilla, recorre aristas entrantes y salientes.
3. **Puntuación** de cada vecino: `+3` si la arista es `references` (wikilink), `+1` para otros tipos.
4. Orden: puntuación, luego `degree` del vecino.
5. Los resultados son **vecinos**, no las semillas. `why` indica tipos de enlace, p. ej. `relacionado por references, depends_on`.

### `hub`

1. No usa FTS.
2. Ordena nodos filtrados por: `degree` (desc), `study_score` en metadata (desc), `label`.
3. `why`: `hub grado=N`.

## API

```
GET /api/search?q=...&mode=text|related|hub&type=markdown&limit=20
```

Respuesta: `{ results, total, has_more }`. Cada ítem incluye `id`, `label`, `type`, `why`, y opcionalmente `related_score` o `search_rank`.

## Fallback sin backend

Solo el modo **Buscar** puede usar MiniSearch en el cliente sobre los nodos ya cargados en el grafo 3D. Hubs y Relacionados necesitan el servidor.

## Para agentes (MCP)

```python
search("transformers", mode="text")
search("attention", mode="related", workspace="papers")
search("", mode="hub", node_type="markdown", limit=10)
```

Para subgrafo + previews en una llamada, usar `explore(query)` en lugar de encadenar `search` + `subgraph`.

## UI (simplificación 2025)

Antes había pestañas **y** un desplegable de modo duplicado. Ahora cada modo es una pestaña; Hubs dispara búsqueda al activarse aunque el campo esté vacío.
