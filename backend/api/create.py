"""Create files/folders and OS dialog imports."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import graph_state
from ..bridge_tasks import force_graph_update
from ..constants import get_workspace_root
from ..path_utils import validate_path_under_workspace
from ..fs_browse import resolve_import_path
from ..os_dialog import (
    import_selected_file,
    import_selected_folder,
    select_file_in_os,
)
from ..scan_workspaces import node_id_for_import_dir
from ..security import safe_error_detail

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/create", tags=["create"])


def _validate_new_path(path_str: str) -> Path:
    try:
        return validate_path_under_workspace(path_str, get_workspace_root())
    except ValueError:
        raise HTTPException(status_code=403, detail="Path outside workspace") from None


class CreateFileRequest(BaseModel):
    path: str
    content: str = ""


class CreateFolderRequest(BaseModel):
    path: str


class PathImportRequest(BaseModel):
    path: str


@router.post("/import-file-path")
async def import_file_from_path(req: PathImportRequest):
    try:
        src = resolve_import_path(req.path, must_be_file=True, must_be_dir=False)
        root = get_workspace_root()
        dest_path = await asyncio.to_thread(import_selected_file, str(src), root)
        graph_state.register_recently_imported(dest_path)
        asyncio.create_task(force_graph_update())
        return {"status": "ok", "path": str(dest_path.relative_to(root))}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error importando archivo: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/import-folder-path")
async def import_folder_from_path(req: PathImportRequest):
    try:
        src = resolve_import_path(req.path, must_be_file=False, must_be_dir=True)
        root = get_workspace_root()
        dest_path = await asyncio.to_thread(import_selected_folder, str(src), root)
        graph_state.register_recently_imported(dest_path)
        asyncio.create_task(force_graph_update(ensure_paths=[dest_path]))
        rel_path = str(dest_path.relative_to(root))
        return {
            "status": "ok",
            "path": rel_path,
            "node_id": node_id_for_import_dir(dest_path, root),
            "workspace_root": str(root.resolve()),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error importando carpeta: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/file")
async def create_file(req: CreateFileRequest):
    try:
        dest_path = _validate_new_path(req.path)
        if dest_path.exists():
            raise HTTPException(status_code=400, detail="El archivo o carpeta ya existe.")
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_text(req.content, encoding="utf-8")
        root = get_workspace_root()
        graph_state.register_recently_imported(dest_path)
        asyncio.create_task(force_graph_update())
        return {"status": "ok", "path": str(dest_path.relative_to(root))}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error creando archivo: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/folder")
async def create_folder(req: CreateFolderRequest):
    try:
        dest_path = _validate_new_path(req.path)
        if dest_path.exists():
            raise HTTPException(status_code=400, detail="El archivo o carpeta ya existe.")
        dest_path.mkdir(parents=True, exist_ok=True)
        root = get_workspace_root()
        graph_state.register_recently_imported(dest_path)
        asyncio.create_task(force_graph_update())
        return {"status": "ok", "path": str(dest_path.relative_to(root))}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error creando carpeta: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/system-file")
async def create_system_file():
    try:
        selected_path = await asyncio.to_thread(select_file_in_os)
        if not selected_path:
            raise HTTPException(
                status_code=400,
                detail="Operación cancelada por el usuario o diálogo cerrado.",
            )
        root = get_workspace_root()
        dest_path = await asyncio.to_thread(import_selected_file, selected_path, root)
        graph_state.register_recently_imported(dest_path)
        asyncio.create_task(force_graph_update())
        return {"status": "ok", "path": str(dest_path.relative_to(root))}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error importando archivo del sistema: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e))
