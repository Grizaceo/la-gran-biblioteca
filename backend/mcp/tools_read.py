"""Read-only MCP tools: overview, search, get_node, read_node, neighbors, explore, subgraph, impact, coverage, tour."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..path_utils import resolve_node_path
from ..graph_queries import build_subgraph, search_graph
from ..overview import build_overview
from ..graph_enrichment import build_graph_structure_summary
from ..lens_session import get_session_lens
from ..services.graph_pipeline import get_last_scan_stats
from ..impact import impact_files_bfs, paths_to_node_ids
from ..constants import WORKSPACE_ROOT, get_workspace_root

import backend.mcp as _mcp


def _state():
    """Access shared state dynamically (survives _load() reassignment)."""
    return _mcp


def overview() -> dict:
    s = _state()
    with s._lock:
        nodes = s._graph["nodes"]
        edges = s._graph["edges"]
        recent = list(s._recent_imports)
    root = get_workspace_root()
    overview_data = build_overview(nodes, edges, recent, root)
    coverage = build_graph_structure_summary(nodes, edges, root)
    scan_meta = get_last_scan_stats()
    coverage["wiki_pattern"] = scan_meta.get("wiki_pattern") or coverage.get("wiki_pattern")
    coverage["unresolved_wikilinks"] = (
        scan_meta.get("unresolved_wikilinks") or coverage.get("unresolved_wikilinks") or []
    )
    coverage["categories"] = scan_meta.get("categories") or coverage.get("categories") or []
    overview_data["coverage"] = coverage
    overview_data["wiki_pattern"] = scan_meta.get("wiki_pattern")
    overview_data["unresolved_wikilinks"] = scan_meta.get("unresolved_wikilinks") or []
    session = get_session_lens()
    if session.get("lens"):
        overview_data["published_lens"] = {
            "label": session["lens"].get("label"),
            "heatmap": session["lens"].get("heatmap"),
            "updated_at": session.get("updated_at"),
            "updated_by": session.get("updated_by"),
        }
    return overview_data


def list_workspaces() -> list[dict]:
    from collections import defaultdict

    counts: dict[str, int] = defaultdict(int)
    s = _state()
    with s._lock:
        nodes = s._graph["nodes"]
    root = get_workspace_root()
    for n in nodes:
        path_str = n.get("path", "")
        if not path_str:
            continue
        try:
            rel = Path(path_str).relative_to(root)
            ws = rel.parts[0] if rel.parts else "root"
        except ValueError:
            continue
        counts[ws] += 1
    return [
        {"workspace": ws, "path": str(root / ws), "nodes": c}
        for ws, c in sorted(counts.items(), key=lambda x: -x[1])
    ]


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
    s = _state()
    limit = min(limit, 100)
    with s._lock:
        graph = {"nodes": list(s._graph["nodes"]), "edges": list(s._graph["edges"])}
    indexed = (
        s._engine.search_index(query, limit=max(limit * 5, 50), offset=0)
        if mode in {"text", "related"}
        else []
    )
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
            item
            for item in result["results"]
            if tag in ((s._node_index.get(item["id"], {}).get("metadata") or {}).get("tags", []))
        ]
        result["total"] = len(result["results"])
        result["has_more"] = False
    return result


def get_node(node_id: str) -> dict:
    s = _state()
    with s._lock:
        n = s._node_index.get(node_id)
        out = list(s._adj_out.get(node_id, []))
        ins = list(s._adj_in.get(node_id, []))
    if n is None:
        return {"error": f"Node {node_id!r} not found"}
    result = {**n, "out_edges": out, "in_edges": ins}
    meta = n.get("metadata") or {}
    if n.get("type") not in ("folder", "workspace", "project") and n.get("path"):
        from ..services.note_service import attached_notes_preview

        try:
            result["attached_notes"] = attached_notes_preview(node_id)
        except Exception:
            pass
    elif n.get("type") == "note":
        anchor = meta.get("source_node_id") or meta.get("orbit_anchor")
        if anchor:
            result["source_anchor_id"] = anchor
    return result


def read_node(node_id: str, max_chars: int = 8000) -> dict:
    s = _state()
    with s._lock:
        n = s._node_index.get(node_id)
    if n is None:
        return {"error": f"Node {node_id!r} not found"}
    path_str = n.get("path", "")
    if not path_str:
        return {"error": "Node has no path"}
    try:
        root = get_workspace_root()
        p = resolve_node_path(node_id, path_str, root)
        if not p.is_relative_to(root):
            return {"error": "Path outside workspace"}
    except (OSError, ValueError) as e:
        return {"error": f"Invalid path: {e}"}
    if not p.exists():
        return {"error": f"File not found on disk: {path_str}"}
    if not p.is_file():
        return {"error": "Path is a directory, not a file"}
    from ..preview import read_node_content

    try:
        return read_node_content(p, max_chars=max_chars)
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": f"Cannot read file: {e}"}


def neighbors(
    node_id: str,
    direction: str = "both",
    depth: int = 1,
    limit: int = 50,
) -> dict:
    s = _state()
    depth = min(depth, 3)
    limit = min(limit, 200)
    with s._lock:
        idx = dict(s._node_index)
        adj_o = dict(s._adj_out)
        adj_i = dict(s._adj_in)
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
                            collected_nodes.append(s._node_summary(n))
                collected_edges.append(e)
        frontier = next_frontier
        if not frontier:
            break
    truncated = len(collected_nodes) >= limit
    return {"nodes": collected_nodes, "edges": collected_edges, "truncated": truncated}


def explore(
    query: str,
    workspace: str = "",
    depth: int = 1,
    limit: int = 5,
) -> dict:
    s = _state()
    depth = min(max(depth, 1), 3)
    limit = min(max(limit, 1), 10)
    preview_chars = 500
    with s._lock:
        graph = {"nodes": list(s._graph["nodes"]), "edges": list(s._graph["edges"])}
    indexed = s._engine.search_index(query, limit=limit * 3, offset=0) if query.strip() else []
    search_result = search_graph(
        graph,
        engine_search_results=indexed,
        query=query,
        workspace=workspace,
        mode="text",
        limit=limit,
        offset=0,
    )
    hits = search_result.get("results") or []
    if not hits:
        return {"query": query, "search": search_result, "focus": None, "previews": []}
    focus_id = hits[0]["id"]
    sub = build_subgraph(
        graph,
        node_id=focus_id,
        depth=depth,
        direction="both",
        workspace=workspace,
        limit=120,
    )
    with s._lock:
        for e in s._graph["edges"]:
            if e.get("type") == "annotates" and e.get("target") == focus_id:
                note_id = e.get("source")
                if note_id and note_id not in {n.get("id") for n in sub.get("nodes", [])}:
                    note_node = s._node_index.get(note_id)
                    if note_node:
                        sub.setdefault("nodes", []).append(s._node_summary(note_node))
                        sub.setdefault("edges", []).append(e)
    previews: list[dict] = []
    for hit in hits[:2]:
        nid = hit["id"]
        preview: dict[str, Any] = {
            "node_id": nid,
            "label": hit.get("label"),
            "type": hit.get("type"),
        }
        with s._lock:
            n = s._node_index.get(nid)
        if n and n.get("path"):
            from ..preview import read_node_content

            try:
                body = read_node_content(Path(n["path"]), max_chars=preview_chars)
                preview["content"] = body.get("content", "")[:preview_chars]
                preview["truncated"] = body.get("truncated", False)
                preview["lang"] = body.get("lang")
            except (ValueError, OSError):
                preview["error"] = "unreadable"
        meta = (n or {}).get("metadata") or {}
        if meta.get("summary"):
            preview["summary"] = meta["summary"]
        if meta.get("backlinks"):
            preview["backlinks"] = meta["backlinks"][:10]
        previews.append(preview)
    return {
        "query": query,
        "search": search_result,
        "focus": {"node_id": focus_id, "subgraph": sub},
        "previews": previews,
    }


def impact_files(paths: list[str], limit: int = 80) -> dict:
    s = _state()
    if not paths:
        return {"error": "paths must be a non-empty list"}
    limit = min(max(limit, 1), 200)
    with s._lock:
        graph = {"nodes": list(s._graph["nodes"]), "edges": list(s._graph["edges"])}
    seed_ids = paths_to_node_ids(paths, get_workspace_root(), graph.get("nodes"))
    if not seed_ids:
        return {"error": "No paths resolved to graph nodes", "paths": paths}
    return impact_files_bfs(graph, seed_ids, limit=limit)


def get_tour(workspace: str) -> dict:
    s = _state()
    tour = s._engine.get_exploration_tour(workspace)
    if not tour:
        return {"error": f"No tour for workspace {workspace!r}"}
    return tour


def subgraph(
    node_id: str,
    depth: int = 1,
    direction: str = "both",
    workspace: str = "",
    node_type: str = "",
    limit: int = 120,
) -> dict:
    s = _state()
    with s._lock:
        graph = {"nodes": list(s._graph["nodes"]), "edges": list(s._graph["edges"])}
    return build_subgraph(
        graph,
        node_id=node_id,
        depth=depth,
        direction=direction,
        workspace=workspace,
        node_type=node_type,
        limit=limit,
    )


def coverage() -> dict:
    s = _state()
    with s._lock:
        nodes = list(s._graph["nodes"])
        edges = list(s._graph["edges"])
    return build_graph_structure_summary(nodes, edges, WORKSPACE_ROOT)
