# Plan de Implementacion: Optimizacion y Refactorizacion de "La Gran Biblioteca"

Este documento contiene un grounding tecnico exhaustivo y un plan de accion paso a paso para optimizar el rendimiento del explorador de grafos y preparar su integracion en el ecosistema **RepoCiv** y **LabHub**.

---

## 0. Estado Actual del Ecosistema (Grounding de Repositorios)

Antes de proponer cambios, es critico entender que **ya existe** y que **es solo documentacion teorica**.

### A. la-gran-biblioteca (Este Repositorio)
- **Backend:** FastAPI + Uvicorn. Endpoints: `/api/graph`, `/api/node/{id}`, `/api/study`, `/api/rescan`, `/api/rollback`, `/api/stream`.
- **SSE `/api/stream`:** Implementado con `sse-starlette.EventSourceResponse`, pero hace **polling bloqueante**: ejecuta `scan_workspaces()` sincrono cada 5 segundos dentro del generador `async`. Esto bloquea el event loop de FastAPI.
- **Frontend:** TypeScript vanilla + Vite + Canvas 2D. Usa `d3-force` para layout y `d3-zoom` para navegacion.
- **Deuda Tecnica:** No usa `watchdog`, no usa `asyncio.Queue`, no usa Web Workers, no usa WebGL. Docker compose existe pero no esta trackeado en git.

### B. RepoCiv
- **Stack:** TypeScript vanilla + Vite + Canvas 2D (hexagonal). **NO usa React.**
- **Backend:** `ThreadingHTTPServer` propio en Python (`server/bridge.py`). **NO usa FastAPI.**
- **Visualizacion:** Mapa hexagonal de repos como ciudades, unidades, edificios. Tiene su propio `renderer.ts`, `localRenderer.ts`, `bridge.ts` con SSE propio.
- **NO tiene integracion con la-gran-biblioteca.** `docs/ARQUITECTURA.md` propone envolver la Biblioteca en un iframe como "Maravilla", pero no hay codigo ni referencias.

### C. LabHub
- **Stack:** TypeScript vanilla + Vite + componentes modulares (`AppShell`, `LabShell`, `PluginAPI`). **NO usa React ni Vue.**
- **Backend:** `ThreadingHTTPServer` propio en Python (`server/bridge.py`).
- **Plugin System:** 5 labs registrados (`financial`, `cybersec`, `protein`, `sair`, `agentlab`). Cada lab expone `get_data()`, `apply_config()`, `run_action()`.
- **Grafos:** El lab `financial` usa Plotly.js (`scatter` markers+lines) para un "agent graph", NO d3-force.
- **NO tiene integracion con la-gran-biblioteca.**

### Implicacion Arquitectonica Clave
**Ninguno de los tres repositorios usa React.** Por tanto, cualquier propuesta basada en `react-force-graph`, componentes React, o SSR/Next.js es **inviable**. La integracion debe hacerse via vanilla TS, Web Components, iframe, o como plugin del sistema de LabHub.

---

## 1. Grounding Extendido: Analisis Tecnico Profundo

### A. Backend: De Polling Bloqueante a Event-Driven (FastAPI + Watchdog)
**El Problema Actual:** El endpoint `/api/stream` ejecuta la funcion sincrona `scan_workspaces()` cada 5 segundos dentro de un bucle `while True`. Esto bloquea por completo el event loop de FastAPI, impidiendo que el servidor procese otras peticiones concurrentes eficientemente.

**La Solucion:**
1. Utilizar `watchdog` (Python) para escuchar eventos del sistema operativo (`FileCreatedEvent`, `FileModifiedEvent`, `FileDeletedEvent`) en lugar de re-escanear todo el arbol de directorios.
2. **Patron Productor-Consumidor:** Como `watchdog` corre en hilos sincronos y FastAPI es asincrono, no se pueden mezclar directamente. El hilo de `watchdog` debe insertar los eventos en una `asyncio.Queue` (thread-safe). Una tarea de fondo en FastAPI consumira esta cola y hara broadcast a las conexiones SSE abiertas.
3. **Coalescencia de Eventos:** `watchdog` puede emitir multiples eventos para una sola operacion de usuario (ej. guardar un archivo genera `Modified` + posiblemente `Created`). El consumidor debe coalescer eventos en una ventana de tiempo (ej. 500ms) antes de reconstruir el subgrafo afectado, en lugar de reconstruir todo el grafo global.

### B. Frontend: Aislamiento Computacional con Web Workers
**El Problema Actual:** `d3.forceSimulation()` realiza calculos matematicos de repulsion/atraccion (O(n log n)) en el hilo principal del navegador. Si cargas 5,000 nodos, la interfaz de usuario (botones, scroll, animaciones) se congelara durante los primeros segundos.

**La Solucion:**
1. **Offloading de Fisicas:** Mover la simulacion completa a un **Web Worker**. El hilo principal solo envia el array de nodos y recibe las actualizaciones de posiciones (`x, y`) empaquetadas en lotes (ej. cada 10 ticks) para evitar saturar el bus de mensajes (`postMessage`).
2. **Progresive Disclosure desde el Backend:** En lugar de enviar el grafo completo al iniciar, el endpoint `/api/graph` debe soportar parametros de paginacion o filtrado por directorio raiz. El frontend solo pide lo que va a mostrar, reduciendo la carga tanto de red como de CPU.
3. **OffscreenCanvas (Opcional Avanzado):** Para un rendimiento extremo, transferir el control del elemento `<canvas>` al Worker usando `canvas.transferControlToOffscreen()`. El Worker no solo calcula las fisicas, sino que dibuja los fotogramas directamente. **Limitacion:** No todos los navegadores soportan `OffscreenCanvas` (Safari lo habilito recientemente). Requiere fallback al canvas principal.

### C. Renderizado: Canvas 2D vs. WebGL (Decision Realista)
Dado que **ningun repositorio del ecosistema usa React**, adoptar `react-force-graph` es inviable. Las opciones reales son:

1. **Mantener Canvas 2D + optimizar:** Para grafos < 5,000 nodos, Canvas 2D bien optimizado (batch drawing, dirty rectangles, level-of-detail en labels) es suficiente y mantiene la simplicidad actual.
2. **Migrar a WebGL via Three.js o Pixi.js:** Si se requiere escalar a > 10,000 nodos, se puede introducir `three` (ya esta en `labhub/package.json`, aunque sin uso confirmado) o `pixi.js` como renderer vanilla. Esto requiere reescribir `renderer.ts` completamente.
3. **Recomendacion inmediata:** No migrar a WebGL todavia. Primero implementar Web Workers + coalescencia backend + progressive disclosure. Si tras eso el rendimiento sigue siendo insuficiente con workspaces reales grandes, entonces evaluar WebGL.

---

## 2. Plan de Implementacion Paso a Paso

### Fase 0: Consolidacion y Auditoria (Pre-requisito)
*Objetivo: Limpiar el estado actual antes de tocar codigo critico.*

1. **Commit de Docker y archivos sueltos:**
   - `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile` existen pero no estan trackeados.
   - `backend/graph_engine.py`, `backend/scan_workspaces.py`, `frontend/vite.config.ts` tienen cambios no staged.
   - **Accion:** Commit o revertir estos cambios para partir de un estado limpio.

2. **Auditoria de tests existentes:**
   - Verificar que `test_library_bridge.py`, `test_scan_workspaces.py`, `test_graph_engine.py` pasan todos.
   - Los tests actuales validan polling; se necesitaran tests nuevos para watchdog.

3. **Decision de arquitectura de integracion:**
   - Leer `docs/ARQUITECTURA.md` de este repo para entender la vision de "Maravilla" en RepoCiv.
   - Decidir si la integracion final sera: **(a)** iframe embed en RepoCiv, **(b)** plugin de LabHub, o **(c)** biblioteca vanilla compartida. Esto afecta como se estructura el frontend.

### Fase 1: Refactorizacion Reactiva del Backend (Python)
*Objetivo: Eliminar los cuellos de botella de I/O y CPU en el servidor.*

1. **Instalar dependencias:**
   ```bash
   pip install watchdog
   ```
   Actualizar `requirements.txt`.

2. **Refactorizar `scan_workspaces.py`:**
   - Mantener una funcion de "escaneo inicial" (Bootstrap) para construir el grafo base al iniciar el servidor.
   - Extraer la logica de "diferencia de grafos" (que nodos cambiaron) para poder aplicar actualizaciones incrementales en lugar de rebuilds completos.

3. **Crear `workspace_watcher.py` (nuevo archivo):**
   - Crear una clase `WorkspaceEventHandler(FileSystemEventHandler)` que capture `FileCreatedEvent`, `FileModifiedEvent`, `FileDeletedEvent`, `DirCreatedEvent`, `DirDeletedEvent`.
   - Al detectar un evento, insertar un objeto serializable (ej. `{'type': 'modified', 'path': '/ruta', 'timestamp': ...}`) en una `queue.Queue` sincrona (thread-safe).
   - Iniciar un `watchdog.observers.Observer` en un hilo daemon que observe `~/.hermes/workspaces`.

4. **Refactorizar `library_bridge.py`:**
   - Crear una `asyncio.Queue` global.
   - Al arrancar FastAPI (`@app.on_event("startup")` o `lifespan`), iniciar el `Observer` de `watchdog` y arrancar un `asyncio.create_task` para consumir la cola.
   - El consumidor asincrono leera de la `asyncio.Queue`, coalescera eventos en una ventana de 500ms, y emitira actualizaciones SSE solo con el delta (nodos afectados), NO el grafo completo.
   - Actualizar el endpoint `/api/stream` para que sea un suscriptor pasivo que solo reacciona cuando el consumidor de la cola detecta un cambio valido.

5. **Tests:**
   - Crear `test_workspace_watcher.py` con `pytest` que simule eventos de watchdog y verifique que la `asyncio.Queue` recibe los mensajes correctos.
   - Verificar que `/api/stream` emite eventos cuando la cola tiene datos, sin polling.

### Fase 2: Aceleracion del Motor de Grafo (TypeScript / Frontend)
*Objetivo: Mantener 60 FPS en el cliente independientemente del tamaño del workspace.*

1. **Crear `frontend/src/workers/graph.worker.ts` (nuevo archivo):**
   - Inicializar `d3-force` dentro del worker.
   - Configurar un listener para recibir los datos iniciales y comandos (`start`, `stop`, `updateData`, `setDimensions`).
   - Ejecutar `simulation.tick()` en lotes (ej. 10 ticks por mensaje) y enviar posiciones actualizadas al hilo principal via `postMessage`.
   - Soportar "heating" y "cooling" de la simulacion (alpha decay) para evitar recalcular eternamente.

2. **Refactorizar `frontend/src/graphEngine.ts`:**
   - Eliminar la importacion directa de `d3-force` (o mantenerla solo para tipos).
   - Instanciar el Worker: `this.worker = new Worker(new URL('./workers/graph.worker.ts', import.meta.url))`.
   - Manejar `onmessage` para actualizar el estado local de los nodos (`node.x`, `node.y`) y notificar al renderer.
   - Proveer un metodo `terminate()` para destruir el worker al cerrar la pagina.

3. **Refactorizar `frontend/src/renderer.ts`:**
   - Asegurar que el render loop (`requestAnimationFrame`) no se bloquee. Separar claramente la fase de update (recibe posiciones del worker) de la fase de draw.
   - Implementar **dirty rectangles** o **culling**: solo dibujar nodos/edges dentro del viewport visible (considerando el zoom/pan de `d3-zoom`).
   - **Level-of-Detail (LOD):** Si hay mas de 1,000 nodos visibles, omitir labels de texto. Si hay mas de 3,000, reducir radio de nodos y omitir sombras.

4. **Progressive Disclosure en el Frontend:**
   - Agregar un parametro de query opcional al llamar `/api/graph`: `?root=/path/to/subdir`.
   - Por defecto, colapsar todos los directorios excepto la raiz. Doble-click expande/colapsa.
   - Esto reduce drasticamente la cantidad de nodos enviados y renderizados inicialmente.

5. **Tests:**
   - Agregar tests de Vitest para `graphEngine.ts` usando `vitest` con `jsdom` o `happy-dom`. Simular mensajes del worker.
   - Agregar tests de renderizado para verificar que LOD se activa correctamente.

### Fase 3: Integracion en el Ecosistema (RepoCiv + LabHub)
*Objetivo: Unificar la experiencia de usuario sin romper la arquitectura vanilla existente.*

**Pre-requisito:** Esta fase depende de la decision tomada en Fase 0. Se presentan tres opciones mutuamente no excluyentes:

#### Opcion 3A: Plugin de LabHub (Recomendada)
LabHub ya tiene un sistema de plugins con `PluginAPI.ts`, registro en `main.ts`, y backend plugins en Python. Es la integracion mas natural.

1. **Backend:** Crear `labhub/server/plugins/biblioteca.py`:
   - Exponer `get_data()` que consuma `http://localhost:3001/api/graph` (o el puerto de la Biblioteca) y transforme el grafo al formato esperado por LabHub.
   - Exponer `get_summary()` que retorne metadatos del workspace (total de archivos, tipos, etc.).
   - **Alternativa mas robusta:** En lugar de HTTP interno, extraer la logica de `graph_engine.py` y `scan_workspaces.py` de la-gran-biblioteca a un paquete Python compartido que ambos proyectos instalen via `pip install -e ../la-gran-biblioteca/backend` o similar.

2. **Frontend:** Crear `labhub/src/plugins/biblioteca/`:
   - Implementar `index.ts` que registre el plugin con `PluginAPI`.
   - Reutilizar o portar `graphEngine.ts` y `renderer.ts` de la-gran-biblioteca a un panel de LabHub.
   - Conectar al SSE de LabHub (`/api/labs/biblioteca/stream`) en lugar del SSE directo de la Biblioteca, manteniendo la consistencia arquitectonica de LabHub.

#### Opcion 3B: Embed/Iframe en RepoCiv (La Biblioteca de Alejandria)
Si la vision de `docs/ARQUITECTURA.md` es "Maravilla" dentro de RepoCiv (como un edificio especial), la forma mas rapida y sin friccion es un iframe.

1. **RepoCiv frontend:** En el renderer de ciudades/edificios, detectar un tipo especial de edificio (ej. `type: "library"`).
2. Al hacer doble-click en ese edificio, abrir un panel/overlay que cargue `http://localhost:3000` (frontend de la-gran-biblioteca) en un iframe.
3. **Comunicacion:** Usar `window.postMessage` entre RepoCiv y el iframe para sincronizar contexto (ej. que RepoCiv le diga a la Biblioteca cual es el repo activo).
4. **Ventaja:** Cero refactoring de la-gran-biblioteca. Cada proyecto mantiene su independencia.
5. **Desventaja:** No es una experiencia "integrada" visualmente (hay un iframe). Potenciales problemas de CORS/postMessage.

#### Opcion 3C: Biblioteca Compartida Vanilla (A largo plazo)
Si se quiere una verdadera integracion visual, extraer el frontend de la-gran-biblioteca como una libreria vanilla reutilizable.

1. **Crear `packages/biblioteca-graph`:**
   - Extraer `graphEngine.ts`, `renderer.ts`, `bridge.ts`, y el Web Worker a un paquete npm privado o monorepo.
   - Exportar una clase `BibliotecaGraph` que acepte un contenedor DOM y un endpoint URL.
2. **Consumir en RepoCiv y LabHub:**
   - Importar la libreria y renderizar el grafo directamente en un Canvas dentro de sus respectivos sistemas de UI.
   - Esto requiere que RepoCiv y LabHub adapten sus layouts para aceptar un canvas externo.
3. **Complejidad:** Alta. Requiere monorepo o publicacion de paquetes. Recomendado solo despues de que Fase 1 y 2 esten 100% estables.

### Fase 4: Docker y Despliegue Unificado (Infraestructura)
*Objetivo: Permitir levantar todo el ecosistema con un solo comando.*

1. **Commit de Dockerfiles actuales:**
   - `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml` deben pasar a ser parte del repo (no untracked).

2. **Extender `docker-compose.yml` para el ecosistema:**
   ```yaml
   services:
     biblioteca-backend:
       build: ./backend
       ports: ["3001:3001"]
       volumes: ["~/.hermes/workspaces:/workspaces:ro"]
     biblioteca-frontend:
       build: ./frontend
       ports: ["3000:3000"]
       depends_on: [biblioteca-backend]
     # Opcional: repociv y labhub como servicios adicionales
   ```

3. **Healthchecks:** Agregar endpoints `/health` (o usar `/api/graph` como healthcheck ligero) en los Dockerfiles.

---

## 3. Priorizacion y Roadmap Sugerido

| Prioridad | Fase | Impacto | Esfuerzo | Entregable |
|---|---|---|---|---|
| **P0** | Fase 0 | Medio | Bajo | Repo limpio, tests verdes, decision arquitectonica tomada |
| **P1** | Fase 1 | Alto | Medio | SSE sin polling, watchdog activo, backend usa asyncio.Queue |
| **P2** | Fase 2 | Alto | Medio-Alto | d3-force en Web Worker, LOD en renderer, progressive disclosure |
| **P3** | Fase 3A o 3B | Medio-Alto | Medio-Alto | Plugin de LabHub (3A) o iframe en RepoCiv (3B) funcionando |
| **P4** | Fase 3C | Alto | Alto | Libreria compartida vanilla (monorepo) |
| **P5** | Fase 4 | Medio | Bajo | `docker-compose up` levanta todo |

---

## 4. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigacion |
|---|---|---|---|
| `watchdog` no captura eventos en WSL2 (filesystem limitations) | Media | Alta | Probar explicitamente en WSL2. Fallback a polling adaptativo (intervalo variable segun carga). |
| Web Workers complican el debugging de d3-force | Media | Media | Mantener un modo "debug" que deshabilite el worker y corra todo en hilo principal. |
| Safari no soporta `OffscreenCanvas` | Baja (ya soportado) | Media | No usar OffscreenCanvas en la primera iteracion. Mantener Canvas 2D tradicional. |
| Integracion con RepoCiv rompe su renderer hexagonal | Baja | Alta | Usar iframe (3B) para aislamiento total, o hacer la libreria canvas completamente independiente del DOM de RepoCiv. |
| LabHub ya tiene `three` sin usar; anadir WebGL aumenta bundle | Media | Baja | Tree-shakear `three`. Solo cargar si se decide escalar a WebGL en el futuro. |

---

## 5. Siguientes Pasos Inmediatos

1. **Confirmar decision de integracion:** LabHub plugin (3A) vs. RepoCiv iframe (3B) vs. ambos.
2. **Ejecutar Fase 0:** Commit de archivos sueltos y pasar tests.
3. **Iniciar Fase 1:** Instalar `watchdog`, crear `workspace_watcher.py`, refactorizar `library_bridge.py` para usar `asyncio.Queue`.
4. **Paralelizar Fase 2 (frontend):** Mientras se estabiliza el backend, mover `d3-force` a `graph.worker.ts`.

Si estas de acuerdo con esta direccion, podemos comenzar con la **Fase 0** (limpieza de estado y decision arquitectonica) y luego **Fase 1** (backend reactivo).
