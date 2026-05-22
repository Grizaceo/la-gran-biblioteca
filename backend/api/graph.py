"""Graph, SSE stream, rescan, rollback."""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

from .. import graph_state
from .. import app_deps
from ..app_deps import engine, notify_graph_clients
from ..security import safe_error_detail
from ..services.graph_pipeline import rebuild_graph

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["graph"])


@router.get("/graph")
async def get_graph():
    return graph_state.get_limited_graph()


@router.get("/stream")
async def stream_graph():
    async def event_generator():
        graph = graph_state.get_limited_graph()
        yield {"event": "init", "data": json.dumps(graph)}
        try:
            while True:
                current_event = app_deps.graph_update_event
                try:
                    await asyncio.wait_for(current_event.wait(), timeout=15.0)
                    graph = graph_state.get_limited_graph()
                    yield {"event": "update", "data": json.dumps(graph)}
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}
        except asyncio.CancelledError:
            return

    return EventSourceResponse(event_generator())


@router.post("/rescan")
async def trigger_rescan():
    try:
        new_graph = await asyncio.to_thread(
            rebuild_graph,
            engine,
            recently_imported_paths=graph_state.recently_imported_paths,
            use_rebuild=True,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))
    graph_state.set_current_graph(new_graph)
    await notify_graph_clients()
    return {
        "status": "ok",
        "nodes": len(new_graph["nodes"]),
        "edges": len(new_graph["edges"]),
    }


@router.post("/rollback")
async def trigger_rollback():
    restored = engine.restore_backup()
    if not restored:
        raise HTTPException(status_code=404, detail="No backup found")
    graph = engine.load_from_db()
    graph_state.set_current_graph(graph)
    await notify_graph_clients()
    return {
        "status": "restored",
        "nodes": len(graph["nodes"]),
        "edges": len(graph["edges"]),
    }
