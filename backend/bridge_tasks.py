"""Async graph refresh (watcher, imports, constellation)."""

from __future__ import annotations

import asyncio
import logging

from . import graph_state
from .app_deps import engine, notify_graph_clients
from .services.graph_pipeline import rebuild_graph

logger = logging.getLogger(__name__)


async def force_graph_update(ensure_paths=None) -> None:
    try:
        new_graph = await asyncio.to_thread(
            rebuild_graph,
            engine,
            recently_imported_paths=graph_state.recently_imported_paths,
            ensure_paths=ensure_paths,
            use_rebuild=False,
        )
        graph_state.set_current_graph(new_graph)
        await notify_graph_clients()
        logger.info("Forced graph update and notified SSE clients successfully.")
    except Exception as e:
        logger.error("Error in force_graph_update: %s", e)
