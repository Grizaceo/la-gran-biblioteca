"""Shared app singletons (engine, SSE sync)."""

import asyncio

from .constants import get_db_path
from .graph_engine import GraphEngine

engine = GraphEngine(db_path=get_db_path())
graph_update_event = asyncio.Event()


def get_engine() -> GraphEngine:
    return engine


def set_engine(new_engine: GraphEngine) -> None:
    global engine
    engine = new_engine
    import sys

    bridge = sys.modules.get("backend.library_bridge")
    if bridge is not None:
        bridge.engine = new_engine


async def notify_graph_clients() -> None:
    global graph_update_event
    old_event = graph_update_event
    graph_update_event = asyncio.Event()
    old_event.set()
