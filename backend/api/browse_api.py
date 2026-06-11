"""In-app directory browser (replaces native OS picker in the UI)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from ..fs_browse import list_directory, resolve_browse_path
from ..security import safe_error_detail

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/browse", tags=["browse"])


@router.get("")
async def browse_directory(
    path: str = Query("", description="Absolute directory path; empty = home"),
    include_files: bool = Query(True),
):
    try:
        resolved = resolve_browse_path(path or None)
        return list_directory(resolved, include_files=include_files)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("browse_directory failed")
        raise HTTPException(status_code=500, detail=safe_error_detail(exc)) from exc
