"""REST API for vault notes under _notes/."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .. import graph_state
from ..bridge_tasks import force_graph_update
from ..security import safe_error_detail
from ..services.note_service import (
    NoteNotFoundError,
    NoteValidationError,
    SourceNodeNotFoundError,
    create_note,
    delete_note,
    get_note,
    list_notes_for_source,
    update_note,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/notes", tags=["notes"])


class NoteRequest(BaseModel):
    title: str = ""
    body: str
    labels: list[str] = Field(default_factory=list)
    source_node_id: str
    selected_text: str = ""
    source_path: str = ""
    storage: str = "inline"


class NotePatchRequest(BaseModel):
    title: str | None = None
    body: str | None = None
    labels: list[str] | None = None


def _after_mutation(note_path) -> None:
    graph_state.register_recently_imported(note_path)
    asyncio.create_task(force_graph_update(ensure_paths=[note_path]))


@router.post("")
async def post_note(req: NoteRequest):
    try:
        storage = req.storage if req.storage in ("inline", "vault") else "vault"
        note, path = create_note(
            title=req.title,
            body=req.body,
            labels=req.labels,
            source_node_id=req.source_node_id,
            selected_text=req.selected_text,
            source_path=req.source_path,
            storage=storage,
        )
        _after_mutation(path)
        return note
    except SourceNodeNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except NoteValidationError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        logger.error("Error creating note: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e)) from e


@router.get("")
async def list_notes(source: str = Query(..., alias="source")):
    try:
        notes = list_notes_for_source(source)
        return {"notes": notes, "total": len(notes)}
    except Exception as e:
        logger.error("Error listing notes: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e)) from e


@router.get("/{note_id}")
async def read_note(note_id: str):
    try:
        return get_note(note_id)
    except NoteNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        logger.error("Error reading note: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e)) from e


@router.patch("/{note_id}")
async def patch_note(note_id: str, req: NotePatchRequest):
    try:
        note, path = update_note(
            note_id,
            title=req.title,
            body=req.body,
            labels=req.labels,
        )
        _after_mutation(path)
        return note
    except NoteNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except SourceNodeNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except NoteValidationError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        logger.error("Error updating note: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e)) from e


@router.delete("/{note_id}")
async def remove_note(note_id: str):
    try:
        path = delete_note(note_id)
        _after_mutation(path)
        return {"status": "ok", "id": note_id}
    except NoteNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        logger.error("Error deleting note: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e)) from e
