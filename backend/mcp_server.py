#!/usr/bin/env python3
"""
mcp_server.py — MCP stdio server for La Gran Biblioteca.

Exposes the knowledge graph to any MCP-compatible agent.
Does NOT require the FastAPI bridge to be running; reads library.db directly.

Usage:
    python -m backend.mcp_server
    # or: uvx mcp run backend/mcp_server.py
"""

from __future__ import annotations

import os
import threading
from collections import defaultdict
from pathlib import Path
from typing import Any

try:
    from mcp.server.fastmcp import FastMCP
except ModuleNotFoundError:  # pragma: no cover - fallback for test/runtime without MCP package
    class FastMCP:  # type: ignore[override]
        def __init__(self, *_args, **_kwargs):
            pass

        def tool(self):
            def decorator(fn):
                return fn
            return decorator

from .constants import WORKSPACE_ROOT
from .graph_engine import GraphEngine, DB_PATH
from .graph_queries import build_subgraph, search_graph
from .overview import build_overview
from .graph_enrichment import build_graph_structure_summary
from .lens import lens_to_search_params, preset_lens, validate_lens
from .lens_session import get_session_lens, publish_session_lens
from .imports import (
    download_and_extract_github,
    import_arxiv as _import_arxiv,
    import_pubmed as _import_pubmed,
    search_arxiv as _search_arxiv,
)
from . import graph_state
from .services.graph_pipeline import rebuild_graph

# ---------------------------------------------------------------------------
# State (loaded once at startup, refreshed on demand)
# ---------------------------------------------------------------------------

_engine = GraphEngine(db_path=DB_PATH)
_graph: dict[str, Any] = {"nodes": [], "edges": []}
_node_index: dict[str, dict] = {}
_adj_out: dict[str, list[dict]] = defaultdict(list)
_adj_in: dict[str, list[dict]] = defaultdict(list)
_recent_imports: list[str] = []
_lock = threading.Lock()


def _load():
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


_load()

# ---------------------------------------------------------------------------
# MCP server
# ---------------------------------------------------------------------------

mcp = FastMCP(
    "la-gran-biblioteca",
    instructions=(
        "La Gran Biblioteca is a knowledge graph of files scanned from "
        f"{WORKSPACE_ROOT}. A 'node' is a file or folder; an 'edge' represents "
        "a link (wikilink, import, etc.). Always start with `overview` to get "
        "the big picture, then use `search` or `get_node` to zoom in."
    ),
)


# ── Helpers ────────────────────────────────────────────────────────────────

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
    """Ensure path is inside WORKSPACE_ROOT; resolves relative paths to root."""
    p = Path(path_str)
    if not p.is_absolute():
        p = WORKSPACE_ROOT / p
    p = p.resolve()
    root = WORKSPACE_ROOT.resolve()
    if not p.is_relative_to(root):
        raise ValueError(f"Path {path_str!r} is outside the workspace ({root})")
    return p


def _rescan_and_reload() -> dict:
    new_graph = rebuild_graph(
        _engine,
        recently_imported_paths=graph_state.recently_imported_paths,
        use_rebuild=True,
    )
    _load()
    return new_graph


# ── Read tools ─────────────────────────────────────────────────────────────

@mcp.tool()
def overview() -> dict:
    """
    Return a compact overview of the knowledge graph: node/edge counts by type,
    top workspaces, and recent imports.

    ALWAYS call this first in a new session — it gives you the lay of the land
    in < 2 KB so you don't waste tokens reading code.
    """
    with _lock:
        nodes = _graph["nodes"]
        edges = _graph["edges"]
        recent = list(_recent_imports)
    overview_data = build_overview(nodes, edges, recent, WORKSPACE_ROOT)
    overview_data["coverage"] = build_graph_structure_summary(
        nodes, edges, WORKSPACE_ROOT
    )
    session = get_session_lens()
    if session.get("lens"):
        overview_data["published_lens"] = {
            "label": session["lens"].get("label"),
            "heatmap": session["lens"].get("heatmap"),
            "updated_at": session.get("updated_at"),
            "updated_by": session.get("updated_by"),
        }
    return overview_data


@mcp.tool()
def list_workspaces() -> list[dict]:
    """
    List top-level workspaces under the workspace root.
    Returns name, path, and node count for each workspace.
    """
    counts: dict[str, int] = defaultdict(int)
    with _lock:
        nodes = _graph["nodes"]
    for n in nodes:
        path_str = n.get("path", "")
        if not path_str:
            continue
        try:
            rel = Path(path_str).relative_to(WORKSPACE_ROOT)
            ws = rel.parts[0] if rel.parts else "root"
        except ValueError:
            continue
        counts[ws] += 1
    return [
        {"workspace": ws, "path": str(WORKSPACE_ROOT / ws), "nodes": c}
        for ws, c in sorted(counts.items(), key=lambda x: -x[1])
    ]


@mcp.tool()
def search(
    query: str,
    node_type: str = "",
    tag: str = "",
    workspace: str = "",
    topic: str = "",
    folder_prefix: str = "",
    min_degree: int = 0,
    studied: str = "all",
    is_import: str = "",
    mode: str = "text",
    limit: int = 20,
    offset: int = 0,
) -> dict:
    """
    Full-text search over node labels and paths.

    Args:
        query: Text to search in label and path (case-insensitive). Empty = all.
        node_type: Filter by type ('markdown', 'code', 'folder', ...).
        tag: Filter by tag in node metadata.
        workspace: Restrict to a specific top-level workspace name.
        topic: Restrict to normalized topic metadata.
        folder_prefix: Filter by parent folder prefix.
        min_degree: Minimum graph degree.
        studied: all|studied|unstudied.
        is_import: true/false import filter.
        mode: text|related|hub.
        limit: Max results (default 20, max 100).
        offset: Pagination offset.

    Returns:
        {results, total, has_more}
    """
    limit = min(limit, 100)
    with _lock:
        graph = {"nodes": list(_graph["nodes"]), "edges": list(_graph["edges"])}
    indexed = _engine.search_index(query, limit=max(limit * 5, 50), offset=0) if mode in {"text", "related"} else []
    result = search_graph(
        graph,
        engine_search_results=indexed,
        query=query,
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
    if tag:
        result["results"] = [
            item for item in result["results"]
            if tag in ((_node_index.get(item["id"], {}).get("metadata") or {}).get("tags", []))
        ]
        result["total"] = len(result["results"])
        result["has_more"] = False
    return result


@mcp.tool()
def get_node(node_id: str) -> dict:
    """
    Get full metadata + direct edges for a node in one call.

    Returns the node dict merged with {in_edges, out_edges}.
    Use this instead of separate 'search + neighbors' calls.
    """
    with _lock:
        n = _node_index.get(node_id)
        out = list(_adj_out.get(node_id, []))
        ins = list(_adj_in.get(node_id, []))
    if n is None:
        return {"error": f"Node {node_id!r} not found"}
    return {**n, "out_edges": out, "in_edges": ins}


@mcp.tool()
def read_node(node_id: str, max_chars: int = 8000) -> dict:
    """
    Read the text content of a file node.

    Args:
        node_id: Node ID to read.
        max_chars: Character budget (default 8000). Content is truncated with
                   truncated=true and total_bytes reported so you can request more.

    Returns:
        {content, lang, size, truncated, total_bytes}
    """
    with _lock:
        n = _node_index.get(node_id)
    if n is None:
        return {"error": f"Node {node_id!r} not found"}

    path_str = n.get("path", "")
    if not path_str:
        return {"error": "Node has no path"}

    try:
        p = Path(path_str).resolve()
        root = Path(WORKSPACE_ROOT).resolve()
        if not p.is_relative_to(root):
            return {"error": "Path outside workspace"}
    except (OSError, ValueError) as e:
        return {"error": f"Invalid path: {e}"}

    if not p.exists():
        return {"error": f"File not found on disk: {path_str}"}
    if not p.is_file():
        return {"error": "Path is a directory, not a file"}

    from .preview import read_node_content

    try:
        return read_node_content(p, max_chars=max_chars)
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": f"Cannot read file: {e}"}


@mcp.tool()
def neighbors(
    node_id: str,
    direction: str = "both",
    depth: int = 1,
    limit: int = 50,
) -> dict:
    """
    BFS neighborhood of a node.

    Args:
        node_id: Starting node.
        direction: 'out' (links from this node), 'in' (links to this node),
                   or 'both'.
        depth: BFS depth (1 = direct neighbors only, max 3).
        limit: Max nodes returned.

    Returns:
        {nodes: [...summaries], edges: [...], truncated}
    """
    depth = min(depth, 3)
    limit = min(limit, 200)

    with _lock:
        idx = dict(_node_index)
        adj_o = dict(_adj_out)
        adj_i = dict(_adj_in)

    if node_id not in idx:
        return {"error": f"Node {node_id!r} not found"}

    visited: set[str] = {node_id}
    frontier = [node_id]
    collected_nodes: list[dict] = []
    collected_edges: list[dict] = []

    for _ in range(depth):
        next_frontier: list[str] = []
        for nid in frontier:
            edges_here = []
            if direction in ("out", "both"):
                edges_here.extend(adj_o.get(nid, []))
            if direction in ("in", "both"):
                edges_here.extend(adj_i.get(nid, []))
            for e in edges_here:
                other = e["target"] if e["source"] == nid else e["source"]
                if other not in visited:
                    visited.add(other)
                    next_frontier.append(other)
                    if len(collected_nodes) < limit:
                        n = idx.get(other)
                        if n:
                            collected_nodes.append(_node_summary(n))
                collected_edges.append(e)
        frontier = next_frontier
        if not frontier:
            break

    truncated = len(collected_nodes) >= limit
    return {"nodes": collected_nodes, "edges": collected_edges, "truncated": truncated}


@mcp.tool()
def subgraph(
    node_id: str,
    depth: int = 1,
    direction: str = "both",
    workspace: str = "",
    node_type: str = "",
    limit: int = 120,
) -> dict:
    """Return a focused subgraph around a node, aligned with the HTTP endpoint."""
    with _lock:
        graph = {"nodes": list(_graph["nodes"]), "edges": list(_graph["edges"])}
    return build_subgraph(
        graph,
        node_id=node_id,
        depth=depth,
        direction=direction,
        workspace=workspace,
        node_type=node_type,
        limit=limit,
    )


# ── Mutation tools ──────────────────────────────────────────────────────────

@mcp.tool()
def mark_studied(node_id: str) -> dict:
    """
    Increment study_count for a node (tracks which nodes you've reviewed).
    """
    with _lock:
        n = _node_index.get(node_id)
    if n is None:
        return {"error": f"Node {node_id!r} not found"}
    meta = dict(n.get("metadata") or {})
    meta["study_count"] = meta.get("study_count", 0) + 1
    _engine.update_node_metadata(node_id, meta)
    with _lock:
        if node_id in _node_index:
            _node_index[node_id]["metadata"] = meta
    return {"status": "ok", "node_id": node_id, "study_count": meta["study_count"]}


@mcp.tool()
def rescan() -> dict:
    """
    Force a full re-scan of the workspace and rebuild the graph.
    Use after adding or removing files outside the app.

    Returns updated node/edge counts.
    """
    new_graph = _rescan_and_reload()
    return {
        "status": "ok",
        "nodes": len(new_graph["nodes"]),
        "edges": len(new_graph["edges"]),
    }


@mcp.tool()
def create_file(relative_path: str, content: str = "") -> dict:
    """
    Create a new file inside the workspace.

    Args:
        relative_path: Path relative to workspace root (e.g. 'my-project/notes.md').
        content: File content (UTF-8 text).

    Returns:
        {status, path}
    """
    try:
        dest = _validate_workspace_path(relative_path)
    except ValueError as e:
        return {"error": str(e)}
    if dest.exists():
        return {"error": f"Already exists: {relative_path}"}
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(content, encoding="utf-8")
    _recent_imports.append(str(dest))
    if len(_recent_imports) > 50:
        _recent_imports.pop(0)
    return {"status": "ok", "path": str(dest.relative_to(WORKSPACE_ROOT))}


@mcp.tool()
def create_folder(relative_path: str) -> dict:
    """
    Create a new folder inside the workspace.

    Args:
        relative_path: Path relative to workspace root.
    """
    try:
        dest = _validate_workspace_path(relative_path)
    except ValueError as e:
        return {"error": str(e)}
    if dest.exists():
        return {"error": f"Already exists: {relative_path}"}
    dest.mkdir(parents=True, exist_ok=True)
    return {"status": "ok", "path": str(dest.relative_to(WORKSPACE_ROOT))}


@mcp.tool()
def import_github(repo_url: str) -> dict:
    """
    Download a public GitHub repository and extract it into the workspace.

    Args:
        repo_url: GitHub URL or 'owner/repo' shorthand.

    Returns:
        {status, path} — workspace-relative path of extracted folder.
    """
    try:
        dest = download_and_extract_github(repo_url, WORKSPACE_ROOT)
        _recent_imports.append(str(dest))
        if len(_recent_imports) > 50:
            _recent_imports.pop(0)
        return {"status": "ok", "path": str(dest.relative_to(WORKSPACE_ROOT))}
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
def search_arxiv(
    query: str | None = None,
    max_results: int = 10,
    sort: str = "relevance",
    author: str | None = None,
    category: str | None = None,
) -> dict:
    """
    Search arXiv papers (read-only). Returns {total, results} with metadata per hit.

    Use before import_arxiv to pick an arxiv_id. At least one of query, author,
    or category is required. Respect arXiv rate limits (~1 request per 3 seconds).

    Args:
        query: Free-text search (all fields).
        max_results: 1–30 (default 10).
        sort: 'relevance' or 'date'.
        author: Author name filter.
        category: arXiv category (e.g. cs.CL).

    Returns:
        {total: int|None, results: [{arxiv_id, title, authors, abstract, ...}]}
    """
    try:
        return _search_arxiv(
            query=query,
            author=author,
            category=category,
            max_results=max_results,
            sort=sort,
        )
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
def import_arxiv(arxiv_id: str) -> dict:
    """
    Fetch an arXiv paper by ID and create a structured Markdown note in the workspace.

    Args:
        arxiv_id: arXiv identifier, e.g. '2401.00001' or 'https://arxiv.org/abs/2401.00001'.

    Returns:
        {status, path}
    """
    try:
        file_path = _import_arxiv(arxiv_id, WORKSPACE_ROOT)
        _recent_imports.append(str(file_path))
        if len(_recent_imports) > 50:
            _recent_imports.pop(0)
        return {"status": "ok", "path": str(file_path.relative_to(WORKSPACE_ROOT))}
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
def import_pubmed(pmid: str) -> dict:
    """
    Fetch a PubMed record by PMID and create a structured Markdown note.

    Args:
        pmid: PubMed identifier, e.g. '39000000'.

    Returns:
        {status, path}
    """
    try:
        file_path = _import_pubmed(pmid, WORKSPACE_ROOT)
        _recent_imports.append(str(file_path))
        if len(_recent_imports) > 50:
            _recent_imports.pop(0)
        return {"status": "ok", "path": str(file_path.relative_to(WORKSPACE_ROOT))}
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
def open_in_os(node_id: str, reveal: bool = False) -> dict:
    """
    Open a node's file in the OS default app (or reveal in file manager).
    Only available when LGB_MCP_ALLOW_OS_OPEN=1 is set.

    Args:
        node_id: Node to open.
        reveal: If true, reveal in file manager instead of opening.
    """
    if not os.environ.get("LGB_MCP_ALLOW_OS_OPEN"):
        return {"error": "OS open is disabled. Set LGB_MCP_ALLOW_OS_OPEN=1 to enable."}
    with _lock:
        n = _node_index.get(node_id)
    if n is None:
        return {"error": f"Node {node_id!r} not found"}
    path_str = n.get("path", "")
    if not path_str:
        return {"error": "Node has no path"}
    try:
        from .constants import WORKSPACE_ROOT
        from .path_utils import resolve_node_path
        from .os_open import open_in_os as _open

        p = resolve_node_path(node_id, path_str, WORKSPACE_ROOT.resolve())
        if not p.exists():
            return {"error": f"File not found: {path_str}"}
        _open(p, reveal)
        return {"status": "ok", "path": path_str}
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
def coverage() -> dict:
    """
    Return workspace/folder/topic coverage metrics (study_ratio, avg_degree, counts).
    Use to decide where to explore before apply_lens / publish_lens.
    """
    with _lock:
        nodes = list(_graph["nodes"])
        edges = list(_graph["edges"])
    return build_graph_structure_summary(nodes, edges, WORKSPACE_ROOT)


@mcp.tool()
def apply_lens(lens: dict | None = None, preset: str = "") -> dict:
    """
    Validate an ExplorationLens (or preset id) and return search_preview + suggested focus.
    Does not publish — call publish_lens after the human should see the same view.
    """
    try:
        if preset:
            validated = preset_lens(preset)
        else:
            validated = validate_lens(lens or {})
    except ValueError as e:
        return {"error": str(e)}

    with _lock:
        graph = {"nodes": list(_graph["nodes"]), "edges": list(_graph["edges"])}

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
    suggested = validated.get("focusNodeId") or (highlight_ids[0] if highlight_ids else None)
    return {
        "lens": validated,
        "search_preview": preview,
        "suggested_focus_node_id": suggested,
        "highlight_node_ids": highlight_ids,
    }


@mcp.tool()
def publish_lens(
    lens: dict | None = None,
    preset: str = "",
    focus_node_id: str = "",
    highlight_ids: list[str] | None = None,
) -> dict:
    """
    Publish the current ExplorationLens for the UI agent bar (GET /api/lens/current).
    """
    try:
        if preset:
            validated = preset_lens(preset)
        else:
            validated = validate_lens(lens or {})
    except ValueError as e:
        return {"error": str(e)}

    return publish_session_lens(
        validated,
        updated_by="mcp",
        focus_node_id=focus_node_id or None,
        highlight_ids=highlight_ids,
    )


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    mcp.run()
