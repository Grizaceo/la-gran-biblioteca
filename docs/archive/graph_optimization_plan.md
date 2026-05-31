# Estado y roadmap — La Gran Biblioteca

Documento de referencia para optimización e integración con **RepoCiv** y **LabHub**. Actualizado al stack real del repositorio.

---

## Estado actual (implementado)

### Backend
- **FastAPI** en `library_bridge.py`: REST + SSE (`sse-starlette`).
- **watchdog** + `asyncio.Queue` en `workspace_watcher.py`: eventos FS coalescidos en **500ms** antes de `force_graph_update()` (rescan completo vía `scan_workspaces`).
- **SQLite** con rebuild atómico y backup en `graph_engine.py`.
- **Límite API:** `/api/graph` devuelve máximo 1000 nodos (prioriza imports recientes).
- **MCP** stdio en `mcp_server.py` para agentes.

### Frontend
- **WebGL 3D:** `three` + `3d-force-graph` en `Graph3DEngine.ts`.
- **Optimizaciones:** perfiles adaptativos por tamaño, carga progresiva (`renderOptimizations.ts`), LOD por distancia de cámara, caché GPU, pausa de física con panel abierto.
- **Vanilla TS/JS** + Vite; sin React.

### Infraestructura
- `docker-compose.yml`, Dockerfiles backend/frontend, nginx con proxy SSE (`proxy_buffering off`).

---

## Pendiente / mejoras planificadas

| Prioridad | Área | Trabajo |
|-----------|------|---------|
| P1 | Backend | Rescan **incremental** por subárbol (hoy rescanea todo el vault en cada evento FS) |
| P1 | API | Paginación `/api/graph?workspace=&limit=&cursor=` |
| P2 | Frontend | Carga progresiva también en actualizaciones SSE (`applyUpdate`) |
| P2 | Frontend | LOD con muestreo/throttle en grafos ≥400 nodos |
| P2 | Prod | Auth opcional (`LGB_API_KEY`), rate limits, import hardening |
| P3 | Integración | Modo `?embed=1` + iframe en RepoCiv (`docs/ARQUITECTURA.md`) |
| P3 | Integración | Plugin LabHub (opción 3A del plan original) |

---

## Integración ecosistema (sin React)

**Ningún repo del ecosistema usa React.** Opciones viables:

1. **Iframe en RepoCiv (3B)** — Maravilla “Biblioteca de Alejandría”; `postMessage` para contexto.
2. **Plugin LabHub (3A)** — Consumir `/api/graph` o paquete Python compartido.
3. **Librería vanilla (3C)** — Solo si Fase 1–2 están estables; alto esfuerzo.

Ver [ARQUITECTURA.md](ARQUITECTURA.md) para el paradigma “plano conocimiento vs plano herramientas”.

---

## Riesgos conocidos

| Riesgo | Mitigación |
|--------|------------|
| watchdog limitado en WSL2 | Fallback: `POST /api/rescan` manual; polling adaptativo futuro |
| Rescan completo costoso en vaults grandes | Rescan incremental (pendiente P1) |
| Exposición en red sin auth | Usar `LGB_API_KEY`; no bind público sin proxy |

---

## Historial

- **Fase 1 (watchdog):** completada — ya no hay polling SSE cada 5s.
- **Fase 2 (WebGL 3D):** completada — sustituye el MVP Canvas 2D documentado originalmente.
- **Fase 2 (Web Workers 2D):** obsoleta — la física corre en 3d-force-graph/WebGL.
