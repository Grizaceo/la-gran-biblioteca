"""Create files/folders and OS dialog imports."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import graph_state
from ..bridge_tasks import force_graph_update
from ..constants import WORKSPACE_ROOT
from ..os_dialog import (
    import_selected_file,
    import_selected_folder,
    select_file_in_os,
    select_folder_in_os,
)
from ..scan_workspaces import node_id_for_import_dir, node_id_for_import_path
from ..security import safe_error_detail

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/create", tags=["create"])


def _validate_new_path(path_str: str) -> Path:
    p = Path(path_str)
    if not p.is_absolute():
        p = Path(WORKSPACE_ROOT) / p
    p = p.resolve()
    root = Path(str(WORKSPACE_ROOT)).resolve()
    if not p.is_relative_to(root):
        raise HTTPException(status_code=403, detail="Path outside workspace")
    return p


class CreateFileRequest(BaseModel):
    path: str
    content: str = ""


class CreateFolderRequest(BaseModel):
    path: str


@router.post("/file")
async def create_file(req: CreateFileRequest):
    try:
        dest_path = _validate_new_path(req.path)
        if dest_path.exists():
            raise HTTPException(status_code=400, detail="El archivo o carpeta ya existe.")
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_text(req.content, encoding="utf-8")
        graph_state.register_recently_imported(dest_path)
        asyncio.create_task(force_graph_update())
        return {"status": "ok", "path": str(dest_path.relative_to(WORKSPACE_ROOT))}
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
        graph_state.register_recently_imported(dest_path)
        asyncio.create_task(force_graph_update())
        return {"status": "ok", "path": str(dest_path.relative_to(WORKSPACE_ROOT))}
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
        dest_path = await asyncio.to_thread(
            import_selected_file, selected_path, WORKSPACE_ROOT
        )
        graph_state.register_recently_imported(dest_path)
        asyncio.create_task(force_graph_update())
        return {"status": "ok", "path": str(dest_path.relative_to(WORKSPACE_ROOT))}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error importando archivo del sistema: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/system-folder")
async def create_system_folder():
    try:
        selected_path = await asyncio.to_thread(select_folder_in_os)
        if not selected_path:
            raise HTTPException(
                status_code=400,
                detail="Operación cancelada por el usuario o diálogo cerrado.",
            )
        dest_path = await asyncio.to_thread(
            import_selected_folder, selected_path, WORKSPACE_ROOT
        )
        graph_state.register_recently_imported(dest_path)
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
        logger.error("Error importando carpeta del sistema: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e))
