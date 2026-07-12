#!/usr/bin/env python3
"""
mcp_server.py — MCP stdio server for La Gran Biblioteca (thin entry point).

Exposes the knowledge graph to any MCP-compatible agent.
Does NOT require the FastAPI bridge to be running; reads library.db directly.

Tool implementations live in backend/mcp/ — this file creates the FastMCP
instance, registers tools, and re-exports for test compatibility.

Usage:
    python -m backend.mcp_server
"""

from __future__ import annotations

from typing import Callable


# FastMCP stub for when MCP package is not available
class _FastMCPStub:  # type: ignore[no-redef]
    def __init__(self, *_args, **_kwargs):
        pass

    def tool(self):
        def decorator(fn: Callable) -> Callable:
            return fn

        return decorator

    def run(self):
        pass


try:
    from mcp.server.fastmcp import FastMCP
except ModuleNotFoundError:  # pragma: no cover
    FastMCP = _FastMCPStub  # type: ignore[assignment,misc]


# ── Import and re-export shared state + helpers ─────────────────────────────

from .mcp import (  # noqa: E402,F401 — re-exported for test compat
    _engine,
    _graph,
    _node_index,
    _adj_out,
    _adj_in,
    _recent_imports,
    _lock,
    _load,
    _node_summary,
    _validate_workspace_path,
    _rescan_and_reload,
    WORKSPACE_ROOT,
    get_db_path,
    get_workspace_root,
)

# Initial load
_load()

# ── Import tool implementations ──────────────────────────────────────────────

from .mcp.tools_read import (  # noqa: E402
    overview,
    list_workspaces,
    search,
    get_node,
    read_node,
    neighbors,
    explore,
    impact_files,
    get_tour,
    subgraph,
    coverage,
)
from .mcp.tools_mutate import (  # noqa: E402
    mark_studied,
    rescan,
    list_vaults,
    switch_vault,
    create_file,
    create_folder,
    open_in_os,
    apply_lens,
    publish_lens,
)
from .mcp.tools_import import (  # noqa: E402
    import_github,
    search_arxiv,
    import_arxiv,
    import_pubmed,
)
from .mcp.tools_notes import (  # noqa: E402
    create_note,
    list_notes,
    get_note,
    update_note,
    search_notes,
    delete_note,
)

# ── Create MCP instance and register tools ──────────────────────────────────

mcp = FastMCP(
    "la-gran-biblioteca",
    instructions=(
        "La Gran Biblioteca is a knowledge graph of files scanned from the "
        "active vault (biblioteca). Use list_vaults() to see registered libraries "
        "and switch_vault(id|path) to change the active one. A 'node' is a file "
        "or folder; an 'edge' represents a link (wikilink, import, annotates, etc.). "
        "Notes may live inline in source markdown (<!-- lgb-note --> blocks) or under "
        "_notes/ (vault). Use get_node(source) → attached_notes or list_notes / "
        "search_notes for annotations. Always start with overview(), then search or "
        "get_node."
    ),
)

# Register all tools with @mcp.tool()
for _fn in [
    overview,
    list_workspaces,
    search,
    get_node,
    read_node,
    neighbors,
    explore,
    impact_files,
    get_tour,
    subgraph,
    coverage,
    mark_studied,
    rescan,
    list_vaults,
    switch_vault,
    create_file,
    create_folder,
    open_in_os,
    apply_lens,
    publish_lens,
    import_github,
    search_arxiv,
    import_arxiv,
    import_pubmed,
    create_note,
    list_notes,
    get_note,
    update_note,
    search_notes,
    delete_note,
]:
    mcp.tool()(_fn)

# ---------------------------------------------------------------------------

if __name__ == "__main__":
    mcp.run()
