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

from .scan_workspaces import (
    scan_workspaces,
    scan_import_paths,
    merge_scan_graphs,
    node_id_for_import_path,
    node_id_for_import_dir,
)
from .graph_engine import GraphEngine
from .workspace_watcher import start_watcher
from .constants import WORKSPACE_ROOT
from .os_open import open_in_os
from .path_utils import is_windows_path, resolve_node_path
from .preview import read_preview
from .imports import download_and_extract_github, import_arxiv, import_pubmed, search_arxiv
from .overview import build_overview
from .constellation_layout import apply_constellation_layout, load_catalog
from .security import SecurityMiddleware, safe_error_detail, PRODUCTION
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


def _path_matches_recent(node_path_str: str, recent: str) -> bool:
    if not node_path_str or not recent:
        return False
    try:
        node_abs = str(Path(node_path_str).resolve())
    except Exception:
        node_abs = node_path_str
    recent_abs = recent
    try:
        recent_abs = str(Path(recent).resolve())
    except Exception:
        pass
    return (
        recent_abs == node_abs
        or node_abs.startswith(recent_abs + os.sep)
        or recent_abs.startswith(node_abs + os.sep)
        or node_abs.endswith(recent_abs)
        or recent_abs.endswith(node_abs)
    )


def _is_vault_import_node(n: dict) -> bool:
    """Nodes under imports/{github,arxiv,pubmed} must stay visible in the 1000-node cap."""
    blob = f"{n.get('id', '')} {n.get('path', '')}".replace("\\", "/").lower()
    return "/imports/github/" in blob or "/imports/arxiv/" in blob or "/imports/pubmed/" in blob


def _node_priority_key(n: dict, degree: int, root: Path) -> tuple:
    """Higher sort key = higher priority for the 1000-node cap."""
    node_path_str = n.get("path", "")
    is_recent = 0
    if node_path_str:
        for recent in recently_imported_paths:
            if _path_matches_recent(node_path_str, recent):
                is_recent = 1
                break
    study = int((n.get("metadata") or {}).get("study_count") or 0)
    return (is_recent, 1 if study > 0 else 0, study, degree)


def get_limited_graph():
    graph = get_current_graph()
    total = len(graph["nodes"])
    if total > 1000:
        nodes = graph["nodes"]
        degree: dict[str, int] = {}
        for e in graph["edges"]:
            degree[e["source"]] = degree.get(e["source"], 0) + 1
            degree[e["target"]] = degree.get(e["target"], 0) + 1

        root = Path(str(WORKSPACE_ROOT)).resolve()
        ranked = sorted(
            nodes,
            key=lambda n: _node_priority_key(n, degree.get(n["id"], 0), root),
            reverse=True,
        )
        selected_nodes = ranked[:1000]
        selected_ids = {n["id"] for n in selected_nodes}

        for n in nodes:
            if n["id"] in selected_ids:
                continue
            if _is_vault_import_node(n):
                selected_nodes.append(n)
                selected_ids.add(n["id"])
                continue
            for recent in recently_imported_paths:
                if _path_matches_recent(n.get("path", ""), recent):
                    selected_nodes.append(n)
                    selected_ids.add(n["id"])
                    break

        node_ids = selected_ids
        edges = [e for e in graph["edges"] if e["source"] in node_ids and e["target"] in node_ids]
        return {"nodes": selected_nodes, "edges": edges, "total": total}
    return {**graph, "total": total}


def _import_ensure_paths(extra: list[Path | str] | None = None) -> list[Path]:
    """Paths that must appear in the graph even when the global scan truncates."""
    paths: list[Path] = []
    seen: set[str] = set()

    def add(p: Path) -> None:
        try:
            resolved = str(p.resolve())
        except OSError:
            return
        if resolved in seen or not p.exists():
            return
        seen.add(resolved)
        paths.append(p.resolve())

    for recent in recently_imported_paths:
        add(Path(recent))
    github_root = WORKSPACE_ROOT / "imports" / "github"
    if github_root.is_dir():
        for child in sorted(github_root.iterdir()):
            if child.is_dir():
                add(child)
    if extra:
        for item in extra:
            add(Path(item))
    return paths


async def force_graph_update(ensure_paths: list[Path | str] | None = None):
    try:
        raw = await asyncio.to_thread(
            scan_workspaces, max_files=SCAN_MAX_FILES, max_children=SCAN_MAX_CHILDREN
        )
        merged_ensure = _import_ensure_paths(ensure_paths)
        if merged_ensure:
            patch = await asyncio.to_thread(scan_import_paths, merged_ensure, WORKSPACE_ROOT)
            raw = merge_scan_graphs(raw, patch)
        raw = await asyncio.to_thread(_finalize_raw_graph, raw)
        new_graph = await asyncio.to_thread(engine.build_graph, raw)
        set_current_graph(new_graph)
        await _notify_graph_clients()
        logger.info("Forced graph update and notified SSE clients successfully.")
    except Exception as e:
        logger.error(f"Error in force_graph_update: {e}")


def set_current_graph(g):
    global _node_index
    _graph_state["graph"] = g
    _node_index = {n["id"]: n for n in g["nodes"]}


def _finalize_raw_graph(raw: dict) -> dict:
    """Sugerencias en DB; layout astral solo si hay asignaciones confirmadas."""
    engine.sync_folder_constellation_suggestions(raw)
    prefs = engine.list_constellation_prefs()
    confirmed = [p for p in prefs if p.get("status") == "confirmed"]
    if not confirmed:
        return raw
    return apply_constellation_layout(raw, prefs, only_confirmed=True)


async def _notify_graph_clients():
    global graph_update_event
    old_event = graph_update_event
    graph_update_event = asyncio.Event()
    old_event.set()


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
        raw = _finalize_raw_graph(raw)
        set_current_graph(engine.build_graph(raw))
        
    observer = None
    if WORKSPACE_ROOT.exists():
        observer = start_watcher(str(WORKSPACE_ROOT), asyncio.get_running_loop(), event_queue)
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


_DEFAULT_CORS = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", _DEFAULT_CORS).split(",") if o.strip()]

app = FastAPI(title="La Gran Biblioteca API", lifespan=lifespan)

app.add_middleware(SecurityMiddleware)
_cors_kwargs: dict = {
    "allow_origins": CORS_ORIGINS,
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
if not PRODUCTION:
    # Dev: navegador en :5173 puede llamar API directa en :3001 (fallback sin proxy)
    _cors_kwargs["allow_origin_regex"] = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"
app.add_middleware(CORSMiddleware, **_cors_kwargs)


@app.get("/")
async def root():
    """Evita confusión: el backend es solo API; la UI vive en el frontend."""
    return {
        "service": "La Gran Biblioteca API",
        "ui": "Arranca el frontend: cd frontend && npm run dev → http://localhost:5173",
        "health": "/api/health",
        "graph": "/api/graph",
    }


@app.get("/api/graph")
async def get_graph():
    """Retorna el grafo completo con posiciones (limitado a 1000 nodos para frontend)."""
    return get_limited_graph()


@app.get("/api/node/{node_id:path}/content")
async def get_node_content(node_id: str):
    """Retorna el contenido textual de un nodo archivo."""
    node = _get_node_by_id(node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    path_str = node.get("path", "")
    if not path_str:
        raise HTTPException(status_code=422, detail="Node has no path")

    p = _validate_path(node_id, path_str)

    if not p.is_file():
        raise HTTPException(status_code=422, detail="Path is not a file")

    return read_preview(p)


@app.get("/api/node/{node_id:path}")
async def get_node(node_id: str):
    """Retorna un nodo específico por ID."""
    node = _get_node_by_id(node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    path_str = node.get("path", "")
    if path_str:
        root = Path(str(WORKSPACE_ROOT)).resolve()
        resolved = resolve_node_path(node_id, path_str, root)
        if resolved.exists():
            return {**node, "path": str(resolved)}
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
    merged_ensure = _import_ensure_paths()
    if merged_ensure:
        patch = scan_import_paths(merged_ensure, WORKSPACE_ROOT)
        raw = merge_scan_graphs(raw, patch)
    raw = _finalize_raw_graph(raw)
    try:
        new_graph = engine.rebuild_graph(raw)
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))
    set_current_graph(new_graph)
    await _notify_graph_clients()
    return {"status": "ok", "nodes": len(new_graph["nodes"]), "edges": len(new_graph["edges"])}


@app.get("/api/constellation/catalog")
async def get_constellation_catalog():
    """Catálogo IAU para selector de constelaciones."""
    catalog = load_catalog()
    return {
        "constellations": [
            {
                "id": c["id"],
                "name": c.get("name"),
                "name_es": c.get("name_es"),
                "star_count": len(c.get("stars") or []),
            }
            for c in catalog
        ]
    }


@app.get("/api/constellation/prefs")
async def get_constellation_prefs():
    """Preferencias y sugerencias por carpeta."""
    prefs = engine.list_constellation_prefs()
    pending = [p for p in prefs if p.get("status") == "suggested"]
    return {"prefs": prefs, "pending": pending}


class ConstellationPrefRequest(BaseModel):
    folder_path: str
    constellation_id: str
    status: str = "confirmed"


@app.post("/api/constellation/prefs")
async def save_constellation_pref(req: ConstellationPrefRequest):
    """Confirmar o cambiar asignación carpeta → constelación."""
    if req.status not in ("confirmed", "suggested"):
        raise HTTPException(status_code=422, detail="status must be confirmed or suggested")
    catalog_ids = {c["id"] for c in load_catalog()}
    if req.constellation_id not in catalog_ids:
        raise HTTPException(status_code=422, detail="Unknown constellation_id")
    folder = Path(req.folder_path)
    try:
        folder = folder.resolve()
    except OSError:
        raise HTTPException(status_code=422, detail="Invalid folder_path")
    if not folder.is_dir():
        raise HTTPException(status_code=422, detail="folder_path is not a directory")
    suggested_from = "manual" if req.status == "confirmed" else "name_match"
    pref = engine.upsert_constellation_pref(
        str(folder), req.constellation_id, req.status, suggested_from
    )
    asyncio.create_task(force_graph_update())
    return {"status": "ok", "pref": pref}


@app.delete("/api/constellation/prefs")
async def delete_constellation_pref(folder_path: str):
    """Quitar asignación; la rama vuelve al layout de árbol en el próximo escaneo."""
    if not engine.delete_constellation_pref(folder_path):
        raise HTTPException(status_code=404, detail="Pref not found")
    asyncio.create_task(force_graph_update())
    return {"status": "ok"}


@app.post("/api/constellation/relayout")
async def constellation_relayout():
    """Recalcula posiciones de constelación sin cambiar nodos/aristas."""
    await force_graph_update()
    g = get_current_graph()
    return {"status": "ok", "nodes": len(g["nodes"]), "edges": len(g["edges"])}


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
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


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
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


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
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@app.post("/api/create/system-folder")
async def create_system_folder():
    """Abre el diálogo nativo del SO para seleccionar una carpeta, y la importa al workspace."""
    try:
        selected_path = await asyncio.to_thread(select_folder_in_os)
        if not selected_path:
            raise HTTPException(status_code=400, detail="Operación cancelada por el usuario o diálogo cerrado.")
            
        dest_path = await asyncio.to_thread(import_selected_folder, selected_path, WORKSPACE_ROOT)
        register_recently_imported(dest_path)
        asyncio.create_task(force_graph_update(ensure_paths=[dest_path]))
        rel_path = str(dest_path.relative_to(WORKSPACE_ROOT))
        return {
            "status": "ok",
            "path": rel_path,
            "node_id": node_id_for_import_dir(dest_path, WORKSPACE_ROOT),
            "workspace_root": str(WORKSPACE_ROOT.resolve()),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error importando carpeta del sistema: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e))



@app.post("/api/create/github")
async def create_github(req: ImportGithubRequest):
    """Downloads a public GitHub repository zipball and extracts it in the workspace."""
    try:
        dest_dir = await asyncio.to_thread(
            download_and_extract_github, req.url, WORKSPACE_ROOT
        )
        register_recently_imported(dest_dir)
        rel_path = str(dest_dir.relative_to(WORKSPACE_ROOT))
        node_id = node_id_for_import_dir(dest_dir, WORKSPACE_ROOT)
        asyncio.create_task(force_graph_update(ensure_paths=[dest_dir]))
        return {
            "status": "ok",
            "path": rel_path,
            "node_id": node_id,
            "workspace_root": str(WORKSPACE_ROOT.resolve()),
        }
    except Exception as e:
        logger.error(f"Error importando repositorio de GitHub: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@app.get("/api/arxiv/search")
async def arxiv_search(
    q: str | None = None,
    max: int = 10,
    sort: str = "relevance",
    author: str | None = None,
    cat: str | None = None,
):
    """Search arXiv (read-only). At least one of q, author, or cat is required."""
    q_val = (q or "").strip()
    author_val = (author or "").strip()
    cat_val = (cat or "").strip()
    if not q_val and not author_val and not cat_val:
        raise HTTPException(
            status_code=400,
            detail="Indica al menos uno de: q, author o cat.",
        )
    if max < 1 or max > 30:
        raise HTTPException(status_code=400, detail="max debe estar entre 1 y 30.")
    try:
        return await asyncio.to_thread(
            search_arxiv,
            query=q_val or None,
            author=author_val or None,
            category=cat_val or None,
            max_results=max,
            sort=sort,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error buscando en arXiv: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@app.post("/api/create/arxiv")
async def create_arxiv(req: ImportArxivRequest):
    """Queries arXiv API for a publication and generates a structured Markdown file in the workspace."""
    try:
        file_path = await asyncio.to_thread(
            import_arxiv, req.id, WORKSPACE_ROOT
        )
        register_recently_imported(file_path)
        rel_path = str(file_path.relative_to(WORKSPACE_ROOT))
        node_id = node_id_for_import_path(file_path, WORKSPACE_ROOT)
        asyncio.create_task(force_graph_update(ensure_paths=[file_path]))
        return {
            "status": "ok",
            "path": rel_path,
            "node_id": node_id,
            "workspace_root": str(WORKSPACE_ROOT.resolve()),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error importando de arXiv: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@app.post("/api/create/pubmed")
async def create_pubmed(req: ImportPubmedRequest):
    """Queries PubMed API for a publication and generates a structured Markdown file in the workspace."""
    try:
        file_path = await asyncio.to_thread(
            import_pubmed, req.id, WORKSPACE_ROOT
        )
        register_recently_imported(file_path)
        rel_path = str(file_path.relative_to(WORKSPACE_ROOT))
        node_id = node_id_for_import_path(file_path, WORKSPACE_ROOT)
        asyncio.create_task(force_graph_update(ensure_paths=[file_path]))
        return {
            "status": "ok",
            "path": rel_path,
            "node_id": node_id,
            "workspace_root": str(WORKSPACE_ROOT.resolve()),
        }
    except Exception as e:
        logger.error(f"Error importando de PubMed: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


def _get_node_by_id(node_id: str):
    return _node_index.get(node_id)


def _validate_path(node_id: str, path_str: str) -> Path:
    """Resolve path and ensure it is allowed and present on disk."""
    root = Path(str(WORKSPACE_ROOT)).resolve()
    p = resolve_node_path(node_id, path_str, root)
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    try:
        if p.is_relative_to(root):
            return p
    except ValueError:
        pass

    # OneDrive / Windows drives via /mnt/c (symlinked vaults, imported libraries)
    if str(p).startswith("/mnt/") or is_windows_path(path_str):
        return p

    raise HTTPException(status_code=403, detail="Path outside workspace")


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

    p = _validate_path(req.node_id, path_str)

    try:
        logger.info(
            "open_node node_id=%s stored=%s resolved=%s reveal=%s",
            req.node_id,
            path_str,
            p,
            req.reveal,
        )
        open_in_os(p, req.reveal)
    except Exception as e:
        logger.warning(
            "open_node failed node_id=%s path=%s reveal=%s: %s",
            req.node_id,
            p,
            req.reveal,
            e,
        )
        raise HTTPException(status_code=500, detail=safe_error_detail(e))

    return {"ok": True}


@app.get("/api/overview")
async def get_overview():
    """Compact knowledge-graph summary: counts by type, top workspaces, recent imports."""
    graph = get_current_graph()
    return build_overview(graph["nodes"], graph["edges"], recently_imported_paths, WORKSPACE_ROOT)


@app.get("/api/health")
async def health():
    """Health check with graph and workspace summary."""
    graph = get_current_graph()
    return {
        "status": "ok",
        "nodes": len(graph["nodes"]),
        "edges": len(graph["edges"]),
        "workspace_root": str(WORKSPACE_ROOT),
        "db_path": str(engine.db_path),
    }


if __name__ == "__main__":
    import socket
    import sys

    host = os.environ.get("LGB_HOST", "127.0.0.1")
    port = int(os.environ.get("LGB_PORT", "3001"))

    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.bind((host, port))
    except OSError as e:
        if e.errno == 98:  # EADDRINUSE
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

    print(f"API: http://{host}:{port}/  |  UI: http://localhost:5173 (npm run dev en frontend/)")
    uvicorn.run(app, host=host, port=port)