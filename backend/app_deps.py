"""Shared app singletons (engine, SSE sync)."""

import asyncio

from .graph_engine import GraphEngine

engine = GraphEngine()
graph_update_event = asyncio.Event()


async def notify_graph_clients() -> None:
    global graph_update_event
    old_event = graph_update_event
    graph_update_event = asyncio.Event()
    old_event.set()
