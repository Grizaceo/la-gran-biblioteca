"""Session ExplorationLens — agent/human parity via GET/POST /api/lens/current."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..lens import lens_to_search_params, preset_lens, validate_lens
from ..lens_session import get_session_lens, publish_session_lens
from .. import graph_state
from ..graph_queries import search_graph

router = APIRouter(prefix="/api/lens", tags=["lens"])


class LensBody(BaseModel):
    lens: dict[str, Any] = Field(default_factory=dict)
    focus_node_id: str | None = None
    highlight_ids: list[str] | None = None
    updated_by: str = "ui"


class PresetBody(BaseModel):
    preset: str
    overrides: dict[str, Any] = Field(default_factory=dict)


@router.get("/current")
async def get_current_lens():
    return get_session_lens()


@router.post("/current")
async def post_current_lens(body: LensBody):
    try:
        validated = validate_lens(body.lens)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return publish_session_lens(
        validated,
        updated_by=body.updated_by or "ui",
        focus_node_id=body.focus_node_id,
        highlight_ids=body.highlight_ids,
    )


@router.post("/preset/{preset_id}")
async def post_preset_lens(preset_id: str, body: PresetBody | None = None):
    overrides = body.overrides if body else {}
    try:
        lens = preset_lens(preset_id, **overrides)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return publish_session_lens(lens, updated_by="ui")


@router.post("/apply")
async def apply_lens_preview(body: LensBody):
    """Validate lens, run search preview, suggest focus node — does not publish."""
    try:
        validated = validate_lens(body.lens)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    graph = graph_state.get_current_graph()
    params = lens_to_search_params(validated)
    result = search_graph(
        graph,
        engine_search_results=[],
        query=params.get("query", ""),
        workspace=params.get("workspace", ""),
        folder_prefix=params.get("folder_prefix", ""),
        topic=params.get("topic", ""),
        min_degree=params.get("min_degree", 0),
        studied=params.get("studied", "all"),
        mode=params.get("mode", "text"),
        limit=params.get("limit", 20),
        offset=params.get("offset", 0),
    )
    preview = result.get("results", [])[:20]
    highlight_ids = [str(item["id"]) for item in preview if item.get("id")]
    suggested_focus = (
        validated.get("focusNodeId")
        or (highlight_ids[0] if highlight_ids else None)
    )
    return {
        "lens": validated,
        "search_preview": preview,
        "suggested_focus_node_id": suggested_focus,
        "highlight_node_ids": highlight_ids,
    }
