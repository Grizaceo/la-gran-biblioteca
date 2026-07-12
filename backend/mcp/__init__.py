"""MCP tools package — shared state and helpers for la-gran-biblioteca MCP server."""

from __future__ import annotations

import threading
from collections import defaultdict
from pathlib import Path
from typing import Any

from ..constants import WORKSPACE_ROOT, get_db_path, get_workspace_root
from ..graph_engine import GraphEngine
from ..graph_queries import build_subgraph, search_graph
from ..graph_enrichment import build_graph_structure_summary
from ..overview import build_overview
from ..lens import lens_to_search_params, preset_lens, validate_lens
from ..lens_session import get_session_lens, publish_session_lens
from ..services.graph_pipeline import rebuild_graph, get_last_scan_stats
from ..import graph_state

# ── Shared state ────────────────────────────────────────────────────────────

_engine = GraphEngine(db_path=get_db_path())
_graph: dict[str, Any] = {"nodes": [], "edges": []}
_node_index: dict[str, dict] = {}
_adj_out: dict[str, list[dict]] = defaultdict(list)
_adj_in: dict[str, list[dict]] = defaultdict(list)
_recent_imports: list[str] = []
_lock = threading.Lock()


def _load() -> None:
    """Reload graph from DB into in-memory indexes."""
    global _graph, _node_index, _adj_out, _adj_in
    g = _engine.load_from_db()
    idx = {n["id"]: n for n in g["nodes"]}
    out: dict[str, list[dict]] = defaultdict(list)
    ins: dict[str, list[dict]] = defaultdict(list)
    for e in g["edges"]:
        out[e["source"]].append(e)
        ins[e["target"]].append(e)
    with _lock:
        _graph = g
        _node_index = idx
        _adj_out = out
        _adj_in = ins


def _node_summary(n: dict) -> dict:
    """Compact node representation for list results."""
    path = n.get("path", "")
    workspace = ""
    if path:
        try:
            rel = Path(path).relative_to(WORKSPACE_ROOT)
            workspace = rel.parts[0] if rel.parts else ""
        except ValueError:
            pass
    return {
        "id": n["id"],
        "label": n.get("label", ""),
        "type": n.get("type", ""),
        "workspace": workspace,
        "path": path,
    }


def _validate_workspace_path(path_str: str) -> Path:
    """Ensure path is inside active vault root; resolves relative paths to root."""
    root = get_workspace_root()
    p = Path(path_str)
    if not p.is_absolute():
        p = root / p
    p = p.resolve()
    root = root.resolve()
    if not p.is_relative_to(root):
        raise ValueError(f"Path {path_str!r} is outside the workspace ({root})")
    return p


def _rescan_and_reload() -> dict:
    """Rescan workspace and reload graph into memory."""
    import backend.mcp as mcp_mod
    from ..services.graph_pipeline import rebuild_graph as _rebuild_graph
    from ..import graph_state
    new_graph = _rebuild_graph(
        mcp_mod._engine,
        recently_imported_paths=graph_state.recently_imported_paths,
        use_rebuild=True,
    )
    _load()
    return new_graph