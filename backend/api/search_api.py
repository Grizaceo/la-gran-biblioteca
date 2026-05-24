"""Structured search endpoints for graph exploration."""

from __future__ import annotations

from fastapi import APIRouter, Query

from .. import graph_state
from ..app_deps import engine
from ..graph_queries import search_graph

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search")
async def search_nodes(
    q: str = "",
    workspace: str = "",
    topic: str = "",
    folder_prefix: str = "",
    mode: str = Query("text", pattern="^(text|related|hub)$"),
    node_type: str = Query("", alias="type"),
    min_degree: int = Query(0, ge=0),
    studied: str = Query("all", pattern="^(all|studied|unstudied)$"),
    is_import: str = "",
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    indexed = engine.search_index(q, limit=max(limit * 5, 50), offset=0) if mode in {"text", "related"} else []
    return search_graph(
        graph_state.get_current_graph(),
        engine_search_results=indexed,
        query=q,
        node_type=node_type,
        workspace=workspace,
        folder_prefix=folder_prefix,
        topic=topic,
        min_degree=min_degree,
        studied=studied,
        is_import=is_import,
        mode=mode,
        limit=limit,
        offset=offset,
    )
