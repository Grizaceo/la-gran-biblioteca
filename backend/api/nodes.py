"""Node lookup, content, study, open."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import graph_state
from ..app_deps import engine
from ..constants import WORKSPACE_ROOT
from ..os_open import open_in_os
from ..path_utils import is_windows_path, resolve_node_path
from ..preview import read_preview
from ..security import safe_error_detail

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["nodes"])


def _validate_path(node_id: str, path_str: str) -> Path:
    root = Path(str(WORKSPACE_ROOT)).resolve()
    p = resolve_node_path(node_id, path_str, root)
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    try:
        if p.is_relative_to(root):
            return p
    except ValueError:
        pass
    if str(p).startswith("/mnt/") or is_windows_path(path_str):
        return p
    raise HTTPException(status_code=403, detail="Path outside workspace")


@router.get("/node/{node_id:path}/content")
async def get_node_content(node_id: str):
    node = graph_state.get_node_by_id(node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    path_str = node.get("path", "")
    if not path_str:
        raise HTTPException(status_code=422, detail="Node has no path")
    p = _validate_path(node_id, path_str)
    if not p.is_file():
        raise HTTPException(status_code=422, detail="Path is not a file")
    return read_preview(p)


@router.get("/node/{node_id:path}")
async def get_node(node_id: str):
    node = graph_state.get_node_by_id(node_id)
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


@router.post("/study")
async def study_node(req: StudyRequest):
    node = graph_state.get_node_by_id(req.node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    if "metadata" not in node:
        node["metadata"] = {}
    if "study_count" not in node["metadata"]:
        node["metadata"]["study_count"] = 0
    node["metadata"]["study_count"] += 1
    engine.update_node_metadata(req.node_id, node["metadata"])
    return {
        "status": "ok",
        "node": req.node_id,
        "study_count": node["metadata"]["study_count"],
    }


class OpenRequest(BaseModel):
    node_id: str
    reveal: bool = False


@router.post("/open")
async def open_node(req: OpenRequest):
    node = graph_state.get_node_by_id(req.node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    path_str = node.get("path", "")
    if not path_str:
        raise HTTPException(status_code=422, detail="Node has no path")
    p = _validate_path(req.node_id, path_str)
    try:
        open_in_os(p, req.reveal)
    except Exception as e:
        logger.warning("open_node failed: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e))
    return {"ok": True}
