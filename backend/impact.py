"""Reverse graph reachability for file-level impact analysis."""

from __future__ import annotations

from collections import defaultdict, deque
from pathlib import Path
from typing import Any

from .scan.layout import file_node_id

_IMPACT_EDGE_TYPES = frozenset({"references", "depends_on", "contains", "wikilink"})


def paths_to_node_ids(
    paths: list[str],
    workspace_root: Path,
    nodes: list[dict[str, Any]] | None = None,
) -> list[str]:
    ids: list[str] = []
    root = workspace_root.resolve()
    path_index = {str(Path(n.get("path", "")).resolve()): n["id"] for n in (nodes or []) if n.get("path")}
    for raw in paths:
        p = Path(raw)
        if not p.is_absolute():
            p = root / p
        try:
            resolved = str(p.resolve())
            if resolved in path_index:
                ids.append(path_index[resolved])
                continue
            rel = p.resolve().relative_to(root).as_posix()
            ids.append(file_node_id(rel))
        except (OSError, ValueError):
            continue
    return ids


def impact_files_bfs(
    graph: dict[str, Any],
    start_ids: list[str],
    *,
    limit: int = 100,
) -> dict[str, Any]:
    """Reverse BFS over references, contains (parent), depends_on."""
    adj_in: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for e in graph.get("edges", []):
        et = e.get("type", "")
        if et not in _IMPACT_EDGE_TYPES:
            continue
        src, tgt = e.get("source"), e.get("target")
        if not src or not tgt:
            continue
        if et == "contains":
            adj_in[src].append((tgt, et))
        else:
            adj_in[tgt].append((src, et))

    id_to_node = {n["id"]: n for n in graph.get("nodes", [])}
    visited: set[str] = set()
    frontier = deque(start_ids)
    for sid in start_ids:
        visited.add(sid)

    results: list[dict[str, Any]] = []
    edges_found: list[dict[str, str]] = []

    while frontier and len(results) < limit:
        nid = frontier.popleft()
        node = id_to_node.get(nid)
        if node and nid not in start_ids:
            results.append(
                {
                    "id": nid,
                    "label": node.get("label", ""),
                    "type": node.get("type", ""),
                    "path": node.get("path", ""),
                }
            )
        for parent_id, edge_type in adj_in.get(nid, []):
            edges_found.append(
                {"from": parent_id, "to": nid, "type": edge_type}
            )
            if parent_id not in visited:
                visited.add(parent_id)
                frontier.append(parent_id)

    return {
        "seed_ids": start_ids,
        "impacted": results[:limit],
        "edges": edges_found[: limit * 3],
        "truncated": len(results) >= limit,
    }
