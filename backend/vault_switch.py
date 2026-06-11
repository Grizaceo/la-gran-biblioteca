"""Hot-swap active vault: engine, graph, watcher, SSE."""

from __future__ import annotations

import logging
from typing import Any

from .graph_enrichment import enrich_graph_metadata
from . import graph_state
from .app_deps import get_engine, notify_graph_clients, set_engine
from .graph_engine import GraphEngine
from .services.graph_pipeline import (
    SCAN_MAX_CHILDREN,
    SCAN_MAX_FILES,
    finalize_raw_graph,
    scan_raw_graph,
)
from . import vault_manager as vault_manager_mod
from .vault_manager import VaultConfig

logger = logging.getLogger(__name__)


def load_vault_graph(vault: VaultConfig, engine: GraphEngine) -> dict[str, Any]:
    if vault.db_path.exists() and vault.db_path.stat().st_size > 0:
        try:
            graph = engine.load_from_db()
            if graph.get("nodes"):
                return graph
        except Exception as exc:
            logger.warning("Could not load vault DB %s: %s", vault.db_path, exc)

    raw = scan_raw_graph(
        root=vault.root,
        engine=engine,
        max_files=SCAN_MAX_FILES,
        max_children=SCAN_MAX_CHILDREN,
    )
    raw = finalize_raw_graph(raw, engine)
    return engine.build_graph(raw)


async def apply_vault_switch(
    *,
    vault_id: str | None = None,
    vault_path: str | None = None,
    restart_watcher: bool = True,
) -> dict[str, Any]:
    if vault_path:
        cfg = vault_manager_mod.vault_manager.switch_vault(vault_path, by_path=True)
    elif vault_id:
        cfg = vault_manager_mod.vault_manager.switch_vault(vault_id)
    else:
        raise ValueError("vault_id or vault_path required")

    new_engine = GraphEngine(db_path=cfg.db_path)
    set_engine(new_engine)

    import backend.library_bridge as bridge

    bridge.engine = new_engine

    graph = load_vault_graph(cfg, new_engine)
    graph = enrich_graph_metadata(graph, cfg.root)
    if graph.get("nodes"):
        new_engine.build_graph(graph)
    graph_state.set_current_graph(graph)
    graph_state.recently_imported_paths.clear()

    if restart_watcher:
        # Drop FS events queued for the previous vault before attaching the new watcher.
        q = bridge.event_queue
        if q is not None:
            while not q.empty():
                try:
                    q.get_nowait()
                    q.task_done()
                except Exception:
                    break
        try:
            await bridge.restart_workspace_watcher(cfg.root)
        except Exception as exc:
            logger.warning("Could not restart watcher for %s: %s", cfg.root, exc)

    await notify_graph_clients()
    return {
        "vault": vault_manager_mod.vault_manager.vault_to_public(cfg, active=True),
        "nodes": len(graph.get("nodes", [])),
        "edges": len(graph.get("edges", [])),
    }


def apply_vault_switch_sync(
    *,
    vault_id: str | None = None,
    vault_path: str | None = None,
) -> dict[str, Any]:
    """MCP path: no watcher/SSE asyncio."""
    if vault_path:
        cfg = vault_manager_mod.vault_manager.switch_vault(vault_path, by_path=True)
    elif vault_id:
        cfg = vault_manager_mod.vault_manager.switch_vault(vault_id)
    else:
        raise ValueError("vault_id or vault_path required")

    new_engine = GraphEngine(db_path=cfg.db_path)
    set_engine(new_engine)
    graph = load_vault_graph(cfg, new_engine)
    graph = enrich_graph_metadata(graph, cfg.root)
    if graph.get("nodes"):
        new_engine.build_graph(graph)
    graph_state.set_current_graph(graph)
    graph_state.recently_imported_paths.clear()
    sync_bridge_engine()
    return {
        "vault": vault_manager_mod.vault_manager.vault_to_public(cfg, active=True),
        "nodes": len(graph.get("nodes", [])),
        "edges": len(graph.get("edges", [])),
    }


def sync_bridge_engine() -> GraphEngine:
    """Ensure library_bridge.engine matches app_deps after MCP switch."""
    import backend.library_bridge as bridge

    eng = get_engine()
    bridge.engine = eng
    return eng
