#!/usr/bin/env python3
"""
library_bridge.py - FastAPI server para La Gran Biblioteca
Endpoints: /api/graph, /api/node/{id}, /api/study, /api/stream (SSE)
"""

import os
import json
import asyncio
import subprocess
import platform
from pathlib import Path
from typing import Dict, Any, Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
import uvicorn
import logging

from scan_workspaces import scan_workspaces, WORKSPACE_ROOT
from graph_engine import GraphEngine
from workspace_watcher import start_watcher

logger = logging.getLogger(__name__)

# Global state
engine = GraphEngine()
_graph_state = {"graph": {"nodes": [], "edges": []}}
_node_index: dict[str, dict] = {}
SCAN_MAX_FILES = int(os.environ.get("SCAN_MAX_FILES", "5000"))
SCAN_MAX_CHILDREN = int(os.environ.get("SCAN_MAX_CHILDREN", "50"))
_IS_WSL: bool | None = None

event_queue = None
graph_update_event = asyncio.Event()
observer = None


def get_current_graph():
    return _graph_state["graph"]


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
        
        try:
            # Ejecutar operaciones pesadas de I/O de disco y SQLite en un hilo separado
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
        except Exception as e:
            logger.error(f"Error processing fs events: {e}")


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
    graph = get_current_graph()
    total = len(graph["nodes"])
    if total > 1000:
        nodes = graph["nodes"][:1000]
        node_ids = {n["id"] for n in nodes}
        edges = [e for e in graph["edges"] if e["source"] in node_ids and e["target"] in node_ids]
        return {"nodes": nodes, "edges": edges, "total": total}
    return {**graph, "total": total}


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
    graph = get_current_graph()
    node = next((n for n in graph["nodes"] if n["id"] == req.node_id), None)
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
        graph = get_current_graph()
        yield {"event": "init", "data": json.dumps(graph)}

        try:
            while True:
                current_event = graph_update_event
                try:
                    # Usamos timeout para emitir pings y mantener la conexión (Vite/Proxy)
                    await asyncio.wait_for(current_event.wait(), timeout=15.0)
                    graph = get_current_graph()
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

    return {"status": "ok", "nodes": len(new_graph["nodes"]), "edges": len(new_graph["edges"])}


@app.post("/api/rollback")
async def trigger_rollback():
    """Restaura la base de datos desde el último backup."""
    restored = engine.restore_backup()
    if not restored:
        raise HTTPException(status_code=404, detail="No backup found")
    graph = engine.load_from_db()
    set_current_graph(graph)
    return {"status": "restored", "nodes": len(graph["nodes"]), "edges": len(graph["edges"])}


CONTENT_MAX_BYTES = 2 * 1024 * 1024  # 2 MB

TEXT_EXTENSIONS: dict[str, str] = {
    "md": "markdown", "txt": "text", "rst": "rst",
    "py": "python", "js": "javascript", "ts": "typescript",
    "jsx": "javascript", "tsx": "typescript",
    "json": "json", "yaml": "yaml", "yml": "yaml",
    "toml": "toml", "ini": "ini", "cfg": "ini",
    "sh": "bash", "bash": "bash", "zsh": "bash",
    "rs": "rust", "go": "go", "c": "c", "cpp": "cpp",
    "h": "c", "hpp": "cpp", "java": "java", "rb": "ruby",
    "php": "php", "cs": "csharp", "swift": "swift",
    "kt": "kotlin", "r": "r", "sql": "sql",
    "css": "css", "scss": "scss", "html": "html", "xml": "xml",
    "dockerfile": "dockerfile",
}


def _get_node_by_id(node_id: str):
    return _node_index.get(node_id)


def _validate_path(path_str: str) -> Path:
    """Resolve path and ensure it's within WORKSPACE_ROOT."""
    p = Path(path_str).resolve()
    root = Path(str(WORKSPACE_ROOT)).resolve()
    if not str(p).startswith(str(root)):
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

    ext = p.suffix.lstrip(".").lower()
    if p.name.lower() == "dockerfile":
        ext = "dockerfile"

    lang = TEXT_EXTENSIONS.get(ext)
    if lang is None:
        raise HTTPException(status_code=415, detail="Unsupported file type for preview")

    size = p.stat().st_size
    truncated = size > CONTENT_MAX_BYTES

    try:
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(CONTENT_MAX_BYTES)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not read file: {e}")

    return {"content": content, "lang": lang, "size": size, "truncated": truncated}


def _is_wsl() -> bool:
    global _IS_WSL
    if _IS_WSL is None:
        try:
            with open("/proc/version") as f:
                _IS_WSL = "microsoft" in f.read().lower()
        except Exception:
            _IS_WSL = False
    return _IS_WSL


class OpenRequest(BaseModel):
    reveal: bool = False


@app.post("/api/node/{node_id}/open")
async def open_node(node_id: str, req: OpenRequest = OpenRequest()):
    """Abre el archivo en el SO local. Solo disponible con LGB_ALLOW_OPEN=1."""
    if os.environ.get("LGB_ALLOW_OPEN") != "1":
        raise HTTPException(status_code=403, detail="LGB_ALLOW_OPEN not enabled")

    node = _get_node_by_id(node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    path_str = node.get("path", "")
    if not path_str:
        raise HTTPException(status_code=422, detail="Node has no path")

    p = _validate_path(path_str)

    try:
        if _is_wsl():
            win_path_result = subprocess.run(
                ["wslpath", "-w", str(p)], capture_output=True, text=True, timeout=5
            )
            win_path = win_path_result.stdout.strip()
            if req.reveal:
                subprocess.Popen(["explorer.exe", f"/select,{win_path}"])
            else:
                subprocess.Popen(["cmd.exe", "/c", "start", "", win_path])
        elif platform.system() == "Darwin":
            if req.reveal:
                subprocess.Popen(["open", "-R", str(p)])
            else:
                subprocess.Popen(["open", str(p)])
        else:
            if req.reveal:
                subprocess.Popen(["xdg-open", str(p.parent)])
            else:
                subprocess.Popen(["xdg-open", str(p)])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not open file: {e}")

    return {"ok": True}


@app.get("/api/health")
async def health():
    """Health check."""
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3001)