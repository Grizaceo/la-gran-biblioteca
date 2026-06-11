"""Search, filtering, and subgraph helpers shared by HTTP and MCP."""

from __future__ import annotations

from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Any

from .constants import get_workspace_root


def _workspace_from_node(node: dict[str, Any]) -> str:
    meta = node.get("metadata") or {}
    workspace = str(meta.get("workspace") or "")
    if workspace:
        return workspace
    path = str(node.get("path") or "")
    if not path:
        return ""
    try:
        root = get_workspace_root()
        rel = Path(path).resolve().relative_to(root)
        return rel.parts[0] if rel.parts else ""
    except (OSError, ValueError):
        return ""


def _node_summary(node: dict[str, Any]) -> dict[str, Any]:
    meta = node.get("metadata") or {}
    return {
        "id": node.get("id"),
        "label": node.get("label", ""),
        "type": node.get("type", ""),
        "path": node.get("path", ""),
        "workspace": _workspace_from_node(node),
        "topics": meta.get("topics", []),
        "degree": int(node.get("degree") or meta.get("degree_hint") or 0),
        "structural_role": meta.get("structural_role", ""),
        "study_count": int(meta.get("study_count") or 0),
    }


def _node_matches(
    node: dict[str, Any],
    *,
    node_type: str = "",
    workspace: str = "",
    folder_prefix: str = "",
    topic: str = "",
    min_degree: int = 0,
    studied: str = "all",
    is_import: str = "",
) -> bool:
    meta = node.get("metadata") or {}
    if node_type and node.get("type") != node_type:
        return False
    if workspace and _workspace_from_node(node) != workspace:
        return False
    if folder_prefix:
        parent_folder = str(meta.get("parent_folder") or "")
        if not parent_folder and node.get("path"):
            try:
                root = Path(os.environ.get("WORKSPACE_ROOT", str(WORKSPACE_ROOT))).resolve()
                rel = Path(str(node.get("path"))).resolve().relative_to(root)
                parent_folder = rel.parent.as_posix()
            except (OSError, ValueError):
                parent_folder = ""
        if not parent_folder.startswith(folder_prefix):
            return False
    if topic:
        topics = {str(item) for item in meta.get("topics") or []}
        topics.update(str(item) for item in meta.get("tags") or [])
        if topic not in topics:
            return False
    degree = int(node.get("degree") or meta.get("degree_hint") or 0)
    if degree < min_degree:
        return False
    study_count = int(meta.get("study_count") or 0)
    if studied == "studied" and study_count <= 0:
        return False
    if studied == "unstudied" and study_count > 0:
        return False
    if is_import:
        expected = is_import.lower() in {"1", "true", "yes"}
        if bool(meta.get("is_import")) != expected:
            return False
    return True


def _build_indexes(graph: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]]]:
    node_index = {str(node["id"]): node for node in graph.get("nodes", [])}
    adj_out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    adj_in: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for edge in graph.get("edges", []):
        source = str(edge.get("source"))
        target = str(edge.get("target"))
        adj_out[source].append(edge)
        adj_in[target].append(edge)
    return node_index, adj_out, adj_in


def search_graph(
    graph: dict[str, Any],
    *,
    engine_search_results: list[dict[str, Any]] | None = None,
    query: str = "",
    node_type: str = "",
    workspace: str = "",
    folder_prefix: str = "",
    topic: str = "",
    min_degree: int = 0,
    studied: str = "all",
    is_import: str = "",
    mode: str = "text",
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    node_index, adj_out, adj_in = _build_indexes(graph)
    base_nodes = [
        node for node in graph.get("nodes", [])
        if _node_matches(
            node,
            node_type=node_type,
            workspace=workspace,
            folder_prefix=folder_prefix,
            topic=topic,
            min_degree=min_degree,
            studied=studied,
            is_import=is_import,
        )
    ]

    results: list[dict[str, Any]] = []
    query_lc = query.lower().strip()

    if mode == "hub":
        ranked = sorted(
            base_nodes,
            key=lambda node: (
                int(node.get("degree") or 0),
                int((node.get("metadata") or {}).get("study_score") or 0),
                str(node.get("label") or ""),
            ),
            reverse=True,
        )
        for node in ranked:
            meta = node.get("metadata") or {}
            results.append(
                {
                    **_node_summary(node),
                    "why": f"hub grado={int(node.get('degree') or 0)}",
                    "folder": meta.get("parent_folder", ""),
                }
            )
    elif mode == "related":
        seeds = engine_search_results or []
        seed_ids = [str(item["node_id"]) for item in seeds if str(item["node_id"]) in node_index]
        if not seed_ids and query_lc:
            seed_ids = [
                str(node["id"]) for node in base_nodes
                if query_lc in str(node.get("label") or "").lower() or query_lc in str(node.get("path") or "").lower()
            ][:10]
        relation_score: Counter[str] = Counter()
        reason: dict[str, set[str]] = defaultdict(set)
        for seed_id in seed_ids[:10]:
            for edge in adj_out.get(seed_id, []) + adj_in.get(seed_id, []):
                other = str(edge["target"] if edge.get("source") == seed_id else edge.get("source"))
                if other == seed_id or other not in node_index:
                    continue
                relation_score[other] += 3 if edge.get("type") == "references" else 1
                reason[other].add(str(edge.get("type") or "link"))
        ranked_ids = sorted(
            relation_score,
            key=lambda node_id: (
                relation_score[node_id],
                int(node_index[node_id].get("degree") or 0),
            ),
            reverse=True,
        )
        for node_id in ranked_ids:
            node = node_index[node_id]
            if not _node_matches(
                node,
                node_type=node_type,
                workspace=workspace,
                folder_prefix=folder_prefix,
                topic=topic,
                min_degree=min_degree,
                studied=studied,
                is_import=is_import,
            ):
                continue
            meta = node.get("metadata") or {}
            results.append(
                {
                    **_node_summary(node),
                    "why": f"relacionado por {', '.join(sorted(reason[node_id]))}",
                    "folder": meta.get("parent_folder", ""),
                    "related_score": relation_score[node_id],
                }
            )
    else:
        indexed = engine_search_results or []
        seen: set[str] = set()
        for item in indexed:
            node = node_index.get(str(item["node_id"]))
            if not node or not _node_matches(
                node,
                node_type=node_type,
                workspace=workspace,
                folder_prefix=folder_prefix,
                topic=topic,
                min_degree=min_degree,
                studied=studied,
                is_import=is_import,
            ):
                continue
            node_id = str(node["id"])
            if node_id in seen:
                continue
            seen.add(node_id)
            meta = node.get("metadata") or {}
            matched_fields = []
            if query_lc:
                for field_name, field_value in {
                    "label": str(node.get("label") or ""),
                    "path": str(node.get("path") or ""),
                    "topics": " ".join(str(topic) for topic in meta.get("topics") or []),
                    "tags": " ".join(str(tag) for tag in meta.get("tags") or []),
                }.items():
                    if query_lc in field_value.lower():
                        matched_fields.append(field_name)
            results.append(
                {
                    **_node_summary(node),
                    "why": f"match en {', '.join(matched_fields or ['índice'])}",
                    "folder": meta.get("parent_folder", ""),
                    "search_rank": item.get("rank", 0.0),
                }
            )
        if not indexed:
            for node in base_nodes:
                meta = node.get("metadata") or {}
                results.append(
                    {
                        **_node_summary(node),
                        "why": "match estructural",
                        "folder": meta.get("parent_folder", ""),
                    }
                )

    total = len(results)
    page = results[offset : offset + limit]
    return {"results": page, "total": total, "has_more": offset + limit < total}


def build_subgraph(
    graph: dict[str, Any],
    *,
    node_id: str,
    depth: int = 1,
    direction: str = "both",
    workspace: str = "",
    node_type: str = "",
    limit: int = 120,
) -> dict[str, Any]:
    depth = max(1, min(depth, 4))
    limit = max(1, min(limit, 500))
    node_index, adj_out, adj_in = _build_indexes(graph)
    if node_id not in node_index:
        return {"error": f"Node {node_id!r} not found"}

    visited = {node_id}
    frontier = deque([(node_id, 0)])
    edges: list[dict[str, Any]] = []

    while frontier and len(visited) < limit:
        current, level = frontier.popleft()
        if level >= depth:
            continue
        edge_bucket: list[dict[str, Any]] = []
        if direction in ("out", "both"):
            edge_bucket.extend(adj_out.get(current, []))
        if direction in ("in", "both"):
            edge_bucket.extend(adj_in.get(current, []))
        for edge in edge_bucket:
            other = str(edge["target"] if edge.get("source") == current else edge.get("source"))
            other_node = node_index.get(other)
            if not other_node:
                continue
            meta = other_node.get("metadata") or {}
            if workspace and meta.get("workspace") != workspace:
                continue
            if node_type and other_node.get("type") != node_type:
                continue
            edges.append(edge)
            if other not in visited:
                visited.add(other)
                frontier.append((other, level + 1))
            if len(visited) >= limit:
                break

    sub_nodes = [node_index[nid] for nid in visited if nid in node_index]
    sub_ids = {node["id"] for node in sub_nodes}
    sub_edges = [
        edge for edge in edges
        if edge.get("source") in sub_ids and edge.get("target") in sub_ids
    ]
    return {
        "nodes": sub_nodes,
        "edges": sub_edges,
        "total": len(sub_nodes),
        "focus_node_id": node_id,
    }
