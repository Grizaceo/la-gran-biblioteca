#!/usr/bin/env python3
"""
library_bridge.py - FastAPI app factory for La Gran Biblioteca.
Routers live under backend/api/; graph pipeline in backend/services/graph_pipeline.py.
"""

from __future__ import annotations

import asyncio
import logging
import os
import socket
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import graph_state
from .api import constellation, coverage, create, graph, imports_api, lens_api, nodes, overview, search_api
from .app_deps import engine
from .bridge_tasks import force_graph_update
from .constants import WORKSPACE_ROOT  # tests may patch via bridge.WORKSPACE_ROOT
from .scan_workspaces import scan_workspaces
from .security import PRODUCTION, SecurityMiddleware
from .services.graph_pipeline import finalize_raw_graph
from .workspace_watcher import start_watcher

logger = logging.getLogger(__name__)

event_queue: asyncio.Queue | None = None
observer = None


async def process_fs_events() -> None:
    from .bridge_tasks import force_graph_update as _fgu

    while True:
        await event_queue.get()
        event_queue.task_done()
        await asyncio.sleep(0.5)
        while not event_queue.empty():
            try:
                event_queue.get_nowait()
                event_queue.task_done()
            except asyncio.QueueEmpty:
                break
        await _fgu()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global event_queue, observer
    event_queue = asyncio.Queue()

    db_path = Path(__file__).parent / "library.db"
    if db_path.exists():
        graph_state.set_current_graph(engine.load_from_db())
    else:
        from .services.graph_pipeline import SCAN_MAX_CHILDREN, SCAN_MAX_FILES

        raw = scan_workspaces(max_files=SCAN_MAX_FILES, max_children=SCAN_MAX_CHILDREN)
        raw = finalize_raw_graph(raw, engine)
        graph_state.set_current_graph(engine.build_graph(raw))

    observer = None
    if WORKSPACE_ROOT.exists():
        observer = start_watcher(
            str(WORKSPACE_ROOT), asyncio.get_running_loop(), event_queue
        )
        asyncio.create_task(process_fs_events())
    else:
        logger.warning(
            "WORKSPACE_ROOT no existe (%s); watcher desactivado. "
            "Crea el directorio o define WORKSPACE_ROOT en .env",
            WORKSPACE_ROOT,
        )

    yield

    if observer:
        observer.stop()
        observer.join()


_DEFAULT_CORS = (
    "http://localhost:5173,http://127.0.0.1:5173,"
    "http://localhost:3000,http://127.0.0.1:3000"
)
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get("CORS_ORIGINS", _DEFAULT_CORS).split(",")
    if o.strip()
]

app = FastAPI(title="La Gran Biblioteca API", lifespan=lifespan)
app.add_middleware(SecurityMiddleware)
_cors_kwargs: dict = {
    "allow_origins": CORS_ORIGINS,
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
if not PRODUCTION:
    _cors_kwargs["allow_origin_regex"] = (
        r"https?://(localhost|127\.0\.0\.1)(:\d+)?"
    )
app.add_middleware(CORSMiddleware, **_cors_kwargs)

app.include_router(graph.router)
app.include_router(nodes.router)
app.include_router(constellation.router)
app.include_router(create.router)
app.include_router(imports_api.router)
app.include_router(overview.router)
app.include_router(search_api.router)
app.include_router(coverage.router)
app.include_router(lens_api.router)


@app.get("/")
async def root():
    return {
        "service": "La Gran Biblioteca API",
        "ui": "Arranca el frontend: cd frontend && npm run dev → http://localhost:5173",
        "health": "/api/health",
        "graph": "/api/graph",
    }


# Back-compat for tests and scripts that import state from library_bridge
set_current_graph = graph_state.set_current_graph
get_current_graph = graph_state.get_current_graph
get_limited_graph = graph_state.get_limited_graph
register_recently_imported = graph_state.register_recently_imported

__all__ = [
    "app",
    "engine",
    "force_graph_update",
    "set_current_graph",
    "get_current_graph",
    "get_limited_graph",
    "register_recently_imported",
]


if __name__ == "__main__":
    host = os.environ.get("LGB_HOST", "127.0.0.1")
    port = int(os.environ.get("LGB_PORT", "3001"))

    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.bind((host, port))
    except OSError as e:
        if e.errno == 98:
            print(
                f"Puerto {port} ya en uso en {host}. "
                f"O bien usa el servidor existente (curl http://{host}:{port}/api/health), "
                f"o libera el puerto: ss -tlnp | grep {port}  /  pkill -f backend.library_bridge  "
                f"o arranca en otro puerto: LGB_PORT=3002 python -m backend.library_bridge",
                file=sys.stderr,
            )
            sys.exit(1)
        raise
    finally:
        probe.close()

    print(
        f"API: http://{host}:{port}/  |  UI: http://localhost:5173 "
        "(npm run dev en frontend/)"
    )
    uvicorn.run(app, host=host, port=port)
