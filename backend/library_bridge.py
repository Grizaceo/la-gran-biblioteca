#!/usr/bin/env python3
"""
library_bridge.py - FastAPI server para La Gran Biblioteca
Endpoints: /api/graph, /api/node/{id}, /api/study, /api/stream (SSE)
"""

import os
import json
import asyncio
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
import uvicorn
import logging

from .scan_workspaces import scan_workspaces
from .graph_engine import GraphEngine
from .workspace_watcher import start_watcher
from .constants import WORKSPACE_ROOT
from .os_open import open_in_os
from .preview import read_preview
from .imports import download_and_extract_github, import_arxiv, import_pubmed
from .overview import build_overview
from .os_dialog import (
    select_file_in_os,
    select_folder_in_os,
    import_selected_file,
    import_selected_folder,
)

logger = logging.getLogger(__name__)

# Global state
engine = GraphEngine()
_graph_state = {"graph": {"nodes": [], "edges": []}}
_node_index: dict[str, dict] = {}
SCAN_MAX_FILES = int(os.environ.get("SCAN_MAX_FILES", "5000"))
SCAN_MAX_CHILDREN = int(os.environ.get("SCAN_MAX_CHILDREN", "50"))

event_queue = None
graph_update_event = asyncio.Event()
observer = None

recently_imported_paths = []

def register_recently_imported(path: Path):
    try:
        abs_path = str(path.resolve())
        if abs_path in recently_imported_paths:
            recently_imported_paths.remove(abs_path)
        recently_imported_paths.append(abs_path)
        if len(recently_imported_paths) > 50:
            recently_imported_paths.pop(0)
    except Exception as e:
        logger.warning(f"Error registering recently imported path: {e}")


def get_current_graph():
    return _graph_state["graph"]


def get_limited_graph():
    graph = get_current_graph()
    total = len(graph["nodes"])
    if total > 1000:
        nodes = graph["nodes"]

        prioritized = []
        ordinary = []

        for n in nodes:
            node_path_str = n.get("path", "")
            if not node_path_str:
                ordinary.append(n)
                continue

            try:
                node_abs_path = str(Path(node_path_str).resolve())
            except Exception:
                node_abs_path = node_path_str

            is_recent = False
            for recent in recently_imported_paths:
                if (recent == node_abs_path or 
                    node_abs_path.startswith(recent + "/") or 
                    recent.startswith(node_abs_path + "/")):
                    is_recent = True
                    break

            if is_recent:
                prioritized.append(n)
            else:
                ordinary.append(n)

        selected_nodes = prioritized + ordinary
        selected_nodes = selected_nodes[:1000]

        node_ids = {n["id"] for n in selected_nodes}
        edges = [e for e in graph["edges"] if e["source"] in node_ids and e["target"] in node_ids]
        return {"nodes": selected_nodes, "edges": edges, "total": total}
    return {**graph, "total": total}


async def force_graph_update():
    try:
        raw = await asyncio.to_thread(
            scan_workspaces, max_files=SCAN_MAX_FILES, max_children=SCAN_MAX_CHILDREN
        )
        new_graph = await asyncio.to_thread(engine.build_graph, raw)
        set_current_graph(new_graph)
        
        # Notify clients creando un nuevo evento para evitar condiciones de carrera
        global graph_update_event
        old_event = graph_update_event
        graph_update_event = asyncio.Event()
        old_event.set()
        logger.info("Forced graph update and notified SSE clients successfully.")
    except Exception as e:
        logger.error(f"Error in force_graph_update: {e}")


def set_current_graph(g):
    global _node_index
    _graph_state["graph"] = g
    _node_index = {n["id"]: n for n in g["nodes"]}


async def process_fs_events():
    while True:
        await event_queue.get()
        event_queue.task_done()
        # Coalesce events in a 500ms window
        await asyncio.sleep(0.5)
        while not event_queue.empty():
            try:
                event_queue.get_nowait()
                event_queue.task_done()
            except asyncio.QueueEmpty:
                break
        
        await force_graph_update()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events using modern lifespan pattern."""
    global event_queue, observer
    event_queue = asyncio.Queue()
    
    db_path = Path(__file__).parent / "library.db"
    if db_path.exists():
        set_current_graph(engine.load_from_db())
    else:
        raw = scan_workspaces(max_files=SCAN_MAX_FILES, max_children=SCAN_MAX_CHILDREN)
        set_current_graph(engine.build_graph(raw))
        
    observer = start_watcher(str(WORKSPACE_ROOT), asyncio.get_running_loop(), event_queue)
    asyncio.create_task(process_fs_events())
    
    yield
    
    if observer:
        observer.stop()
        observer.join()


CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")]

app = FastAPI(title="La Gran Biblioteca API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/graph")
async def get_graph():
    """Retorna el grafo completo con posiciones (limitado a 1000 nodos para frontend)."""
    return get_limited_graph()


@app.get("/api/node/{node_id}")
async def get_node(node_id: str):
    """Retorna un nodo específico por ID."""
    node = _get_node_by_id(node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


class StudyRequest(BaseModel):
    node_id: str


@app.post("/api/study")
async def study_node(req: StudyRequest):
    """Endpoint para registrar estudio de un nodo."""
    node = _get_node_by_id(req.node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    if "study_count" not in node.get("metadata", {}):
        node["metadata"]["study_count"] = 0
    node["metadata"]["study_count"] += 1

    engine.update_node_metadata(req.node_id, node["metadata"])

    return {"status": "ok", "node": req.node_id, "study_count": node["metadata"]["study_count"]}


@app.get("/api/stream")
async def stream_graph():
    """SSE para actualizaciones en vivo del grafo."""
    
    async def event_generator():
        graph = get_limited_graph()
        yield {"event": "init", "data": json.dumps(graph)}

        try:
            while True:
                current_event = graph_update_event
                try:
                    # Usamos timeout para emitir pings y mantener la conexión (Vite/Proxy)
                    await asyncio.wait_for(current_event.wait(), timeout=15.0)
                    graph = get_limited_graph()
                    yield {"event": "update", "data": json.dumps(graph)}
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}
        except asyncio.CancelledError:
            return

    return EventSourceResponse(event_generator())


@app.post("/api/rescan")
async def trigger_rescan():
    """Fuerza un re-escaneo atómico del workspace con backup."""
    raw = scan_workspaces(max_files=SCAN_MAX_FILES, max_children=SCAN_MAX_CHILDREN)
    try:
        new_graph = engine.rebuild_graph(raw)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rebuild failed: {e}")
    set_current_graph(new_graph)

    # Notify clients
    global graph_update_event
    old_event = graph_update_event
    graph_update_event = asyncio.Event()
    old_event.set()

    return {"status": "ok", "nodes": len(new_graph["nodes"]), "edges": len(new_graph["edges"])}


@app.post("/api/rollback")
async def trigger_rollback():
    """Restaura la base de datos desde el último backup."""
    restored = engine.restore_backup()
    if not restored:
        raise HTTPException(status_code=404, detail="No backup found")
    graph = engine.load_from_db()
    set_current_graph(graph)

    # Notify clients
    global graph_update_event
    old_event = graph_update_event
    graph_update_event = asyncio.Event()
    old_event.set()

    return {"status": "restored", "nodes": len(graph["nodes"]), "edges": len(graph["edges"])}


# Models for resource creation and import
class CreateFileRequest(BaseModel):
    path: str
    content: str = ""

class CreateFolderRequest(BaseModel):
    path: str

class ImportGithubRequest(BaseModel):
    url: str

class ImportArxivRequest(BaseModel):
    id: str

class ImportPubmedRequest(BaseModel):
    id: str


def _validate_new_path(path_str: str) -> Path:
    """Ensure path is within WORKSPACE_ROOT, but does not have to exist yet."""
    p = Path(path_str)
    if not p.is_absolute():
        p = Path(WORKSPACE_ROOT) / p
    p = p.resolve()
    root = Path(str(WORKSPACE_ROOT)).resolve()
    if not p.is_relative_to(root):
        raise HTTPException(status_code=403, detail="Path outside workspace")
    return p


@app.post("/api/create/file")
async def create_file(req: CreateFileRequest):
    """Creates a new text or Markdown file inside the workspace."""
    try:
        dest_path = _validate_new_path(req.path)
        if dest_path.exists():
            raise HTTPException(status_code=400, detail="El archivo o carpeta ya existe.")
        
        # Ensure parent directories exist
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Write content
        with open(dest_path, "w", encoding="utf-8") as f:
            f.write(req.content)
            
        register_recently_imported(dest_path)
        asyncio.create_task(force_graph_update())
        return {"status": "ok", "path": str(dest_path.relative_to(WORKSPACE_ROOT))}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creando archivo: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/create/folder")
async def create_folder(req: CreateFolderRequest):
    """Creates a new folder/directory inside the workspace."""
    try:
        dest_path = _validate_new_path(req.path)
        if dest_path.exists():
            raise HTTPException(status_code=400, detail="El archivo o carpeta ya existe.")
            
        dest_path.mkdir(parents=True, exist_ok=True)
        register_recently_imported(dest_path)
        asyncio.create_task(force_graph_update())
        return {"status": "ok", "path": str(dest_path.relative_to(WORKSPACE_ROOT))}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creando carpeta: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/create/system-file")
async def create_system_file():
    """Abre el diálogo nativo del SO para seleccionar un archivo, y lo importa al workspace."""
    try:
        selected_path = await asyncio.to_thread(select_file_in_os)
        if not selected_path:
            raise HTTPException(status_code=400, detail="Operación cancelada por el usuario o diálogo cerrado.")
            
        dest_path = await asyncio.to_thread(import_selected_file, selected_path, WORKSPACE_ROOT)
        register_recently_imported(dest_path)
        asyncio.create_task(force_graph_update())
        return {"status": "ok", "path": str(dest_path.relative_to(WORKSPACE_ROOT))}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error importando archivo del sistema: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/create/system-folder")
async def create_system_folder():
    """Abre el diálogo nativo del SO para seleccionar una carpeta, y la importa al workspace."""
    try:
        selected_path = await asyncio.to_thread(select_folder_in_os)
        if not selected_path:
            raise HTTPException(status_code=400, detail="Operación cancelada por el usuario o diálogo cerrado.")
            
        dest_path = await asyncio.to_thread(import_selected_folder, selected_path, WORKSPACE_ROOT)
        register_recently_imported(dest_path)
        asyncio.create_task(force_graph_update())
        return {"status": "ok", "path": str(dest_path.relative_to(WORKSPACE_ROOT))}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error importando carpeta del sistema: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/api/create/github")
async def create_github(req: ImportGithubRequest):
    """Downloads a public GitHub repository zipball and extracts it in the workspace."""
    try:
        dest_dir = await asyncio.to_thread(
            download_and_extract_github, req.url, WORKSPACE_ROOT
        )
        register_recently_imported(dest_dir)
        asyncio.create_task(force_graph_update())
        return {"status": "ok", "path": str(dest_dir.relative_to(WORKSPACE_ROOT))}
    except Exception as e:
        logger.error(f"Error importando repositorio de GitHub: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/create/arxiv")
async def create_arxiv(req: ImportArxivRequest):
    """Queries arXiv API for a publication and generates a structured Markdown file in the workspace."""
    try:
        file_path = await asyncio.to_thread(
            import_arxiv, req.id, WORKSPACE_ROOT
        )
        register_recently_imported(file_path)
        asyncio.create_task(force_graph_update())
        return {"status": "ok", "path": str(file_path.relative_to(WORKSPACE_ROOT))}
    except Exception as e:
        logger.error(f"Error importando de arXiv: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/create/pubmed")
async def create_pubmed(req: ImportPubmedRequest):
    """Queries PubMed API for a publication and generates a structured Markdown file in the workspace."""
    try:
        file_path = await asyncio.to_thread(
            import_pubmed, req.id, WORKSPACE_ROOT
        )
        register_recently_imported(file_path)
        asyncio.create_task(force_graph_update())
        return {"status": "ok", "path": str(file_path.relative_to(WORKSPACE_ROOT))}
    except Exception as e:
        logger.error(f"Error importando de PubMed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _get_node_by_id(node_id: str):
    return _node_index.get(node_id)


def _validate_path(path_str: str) -> Path:
    """Resolve path and ensure it's within WORKSPACE_ROOT."""
    p = Path(path_str).resolve()
    root = Path(str(WORKSPACE_ROOT)).resolve()
    if not p.is_relative_to(root):
        raise HTTPException(status_code=403, detail="Path outside workspace")
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return p


@app.get("/api/node/{node_id}/content")
async def get_node_content(node_id: str):
    """Retorna el contenido textual de un nodo archivo."""
    node = _get_node_by_id(node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    path_str = node.get("path", "")
    if not path_str:
        raise HTTPException(status_code=422, detail="Node has no path")

    p = _validate_path(path_str)

    if not p.is_file():
        raise HTTPException(status_code=422, detail="Path is not a file")

    return read_preview(p)


class OpenRequest(BaseModel):
    node_id: str
    reveal: bool = False


@app.post("/api/open")
async def open_node(req: OpenRequest):
    """Abre el archivo en el SO local."""
    node = _get_node_by_id(req.node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    path_str = node.get("path", "")
    if not path_str:
        raise HTTPException(status_code=422, detail="Node has no path")

    p = _validate_path(path_str)

    try:
        open_in_os(p, req.reveal)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not open file: {e}")

    return {"ok": True}


@app.get("/api/overview")
async def get_overview():
    """Compact knowledge-graph summary: counts by type, top workspaces, recent imports."""
    graph = get_current_graph()
    return build_overview(graph["nodes"], graph["edges"], recently_imported_paths, WORKSPACE_ROOT)


@app.get("/api/health")
async def health():
    """Health check."""
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3001)