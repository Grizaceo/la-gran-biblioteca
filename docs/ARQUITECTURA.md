# Visión Arquitectónica: "La Gran Biblioteca" y el Ecosistema RepoCiv

Este documento consolida la arquitectura estratégica diseñada para separar el dominio de conocimiento de las herramientas operativas UI, integrándolos orgánicamente dentro del "Agent OS" (RepoCiv).

---

## 1. El Paradigma de "Game-like UI" para Agentes

Inspirados en herramientas pioneras como AgentCraft, el ecosistema RepoCiv adopta el diseño de un juego de estrategia en tiempo real (RTS) para solucionar el principal cuello de botella de la orquestación de agentes IA: la **Fatiga de Observabilidad**.

Los dashboards estáticos tradicionales (listas, tablas de logs) no pueden representar intuitivamente la asincronía espacial y temporal de los agentes. En RepoCiv:
- Los repositorios son **Ciudades**.
- Los procesos en segundo plano son **Edificios**.
- Los agentes (DAVI, LexO, Workers) son **Unidades** tangibles con barras de energía (Fatiga estilo XCOM) y estados de movimiento.

## 2. La Separación de Planos (Ortogonalidad)

Para garantizar un escalado sin fricciones y evitar el "Spaghetti de Contexto", la arquitectura divide radicalmente el sistema en dos planos ortogonales.

### A. El Plano del Conocimiento (La Biblioteca de Alejandría)
- **Mapeo Físico:** `~/.hermes/workspaces` (El "Vault").
- **Propósito:** Es la base de datos documental. Contiene datos puros, papers, jurisprudencia, planes de ejecución y el contexto de fondo que alimenta a agentes especialistas (como LexO).
- **El Concepto In-Game:** La "Biblioteca de Alejandría" es una **Maravilla** construible en RepoCiv. Cuando un agente entra aquí, su objetivo es **leer y estudiar** el conocimiento del dominio. No hay métricas ni herramientas operativas aquí, solo relaciones semánticas.

### B. El Plano de Herramientas / Skills (LabHub / El Workshop)
- **Mapeo Físico:** `~/.hermes/workspace/repos/labhub`.
- **Propósito:** Es un registro de herramientas operativas (UI Skills) agnósticas al dominio. Aquí se desarrollan y testean visualizadores de tensores, monitores de SSE, dashboards de memoria y paneles de telemetría.
- **El Concepto In-Game:** Se materializa como **"El Workshop"** o el gremio. Si envías a un Worker aquí, está ensamblando una nueva interfaz visual. Mañana, si creas un `hardware-ai-lab`, este lab simplemente reutiliza el visualizador de hardware que fue creado en el Workshop de LabHub.

## 3. Arquitectura Técnica de la Biblioteca

Para representar "La Gran Biblioteca", el diseño técnico aísla completamente los datos de la presentación, habilitando una evolución fluida en dos fases.

### El Backend Unificado (El Grafo Agnóstico)
En lugar de renderizar carpetas, el backend de la Biblioteca (un script Python) recorre recursivamente `~/.hermes/workspaces` y expone una API estandarizada que emite un JSON topológico:
- **Nodos:** Archivos, documentos, papers y subcarpetas.
- **Aristas (Edges):** Relaciones jerárquicas, referencias bibliográficas o dependencias semánticas.

Esta API nunca cambia, sin importar qué UI se construya encima.

### Vault hygiene (archives y exclusiones)

El escáner (`backend/scan/walker.py`) comparte el pipeline HTTP y MCP (`backend/services/graph_pipeline.py`).

- **Exclusiones técnicas:** `.git`, `node_modules`, `.hermes`, etc., más `LGB_EXTRA_EXCLUDE_DIRS`.
- **Carpetas archive:** nombres exactos `archive`, `backups`, `snapshots` gobernados por `LGB_ARCHIVE_POLICY` (`exclude` | `shadow` | `include`). Ver `.env.example` y `AGENTS.md`.
- **Overview:** `GET /api/overview` incluye `skipped_archive_dirs` del último escaneo.
- **UI:** Opciones de vista → “Mostrar carpetas archive (bóveda)” cuando el backend emite nodos `archived`.

### Fase 1: El MVP Físico (Opción B - 2D Grid)
- Se aprovecha la "Vista Local" de RepoCiv (estilo RimWorld) ya existente en `src/types.ts`.
- El frontend consume el JSON del Grafo y utiliza un layout de grilla para asignar coordenadas `(x, y)` a los nodos.
- **Visualización:** Pasillos generados proceduralmente (las ramas del conocimiento) y estanterías o `workbenches` (los documentos y papers). Los agentes caminan físicamente a las estanterías para interactuar.

### Fase 2: El Mind Palace Inmersivo (Opción A - 3D)
- Una vez consolidada la mecánica 2D, se introduce un renderizador `Three.js` (como `react-force-graph-3d`).
- El frontend consume el **mismo JSON del Grafo** y proyecta los nodos en el espacio `(x, y, z)`.
- **Visualización:** El "Grafo de Conocimiento Astral". Los directorios son constelaciones y los archivos son planetas de información conectados por láseres (Edges). El usuario viaja por la bóveda para explorar sus conexiones jurídicas y técnicas.

## 4. Integración Técnica en RepoCiv (Workshop de Maravillas)

La orquestación de estas UIs especializadas (La Biblioteca, LabHub, Herramientas de 3ros) en el gran mapa de RepoCiv se logra mediante el patrón de **Micro-Frontends Basados en Capacidad**.

- **Iframes como Aislantes:** Las Maravillas, como la Biblioteca de Alejandría, se integran en RepoCiv a través de un panel modal de cristal (glassmorphism) que envuelve un `<iframe src="...">`.
- **Escalabilidad:** Esto permite que la Biblioteca se construya en Vue o en Three.js puro, y LabHub en React/Vite, sin que el motor Canvas principal de RepoCiv sufra por conflictos de dependencias o estados sobrecargados. RepoCiv se convierte, así, en un verdadero "Sistema Operativo" agéntico.
