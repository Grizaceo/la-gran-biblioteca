"""In-memory graph state (no FastAPI dependency)."""

from __future__ import annotations

import os
from pathlib import Path

from .constants import WORKSPACE_ROOT
from .graph_enrichment import build_graph_structure_summary

GRAPH_NODE_CAP = 1000

_graph_state: dict = {
    "graph": {"nodes": [], "edges": []},
    "overview_structure": {
        "workspace_root": str(WORKSPACE_ROOT),
        "total_nodes": 0,
        "total_edges": 0,
        "modes": {"workspace": [], "folder": [], "topic": []},
        "legend": {"workspaces": [], "topics": [], "roles": {}},
    },
    "constellation_figures": [],
}
_node_index: dict[str, dict] = {}
recently_imported_paths: list[str] = []


def get_current_graph() -> dict:
    return _graph_state["graph"]


def set_current_graph(g: dict) -> None:
    global _node_index
    _graph_state["graph"] = g
    _node_index = {n["id"]: n for n in g["nodes"]}
    _graph_state["overview_structure"] = build_graph_structure_summary(
        g.get("nodes", []),
        g.get("edges", []),
        WORKSPACE_ROOT,
    )


def get_constellation_figures() -> list:
    return _graph_state["constellation_figures"]


def set_constellation_figures(figures: list) -> None:
    _graph_state["constellation_figures"] = figures or []


def get_node_by_id(node_id: str) -> dict | None:
    return _node_index.get(node_id)


def register_recently_imported(path: Path) -> None:
    import logging

    logger = logging.getLogger(__name__)
    try:
        abs_path = str(path.resolve())
        if abs_path in recently_imported_paths:
            recently_imported_paths.remove(abs_path)
        recently_imported_paths.append(abs_path)
        if len(recently_imported_paths) > 50:
            recently_imported_paths.pop(0)
    except Exception as e:
        logger.warning("Error registering recently imported path: %s", e)


def get_overview_structure() -> dict:
    return _graph_state["overview_structure"]


def _path_matches_recent(node_path_str: str, recent: str) -> bool:
    if not node_path_str or not recent:
        return False
    try:
        node_abs = str(Path(node_path_str).resolve())
    except Exception:
        node_abs = node_path_str
    recent_abs = recent
    try:
        recent_abs = str(Path(recent).resolve())
    except Exception:
        pass
    return (
        recent_abs == node_abs
        or node_abs.startswith(recent_abs + os.sep)
        or recent_abs.startswith(node_abs + os.sep)
        or node_abs.endswith(recent_abs)
        or recent_abs.endswith(node_abs)
    )


def _is_vault_import_node(n: dict) -> bool:
    blob = f"{n.get('id', '')} {n.get('path', '')}".replace("\\", "/").lower()
    return (
        "/imports/github/" in blob
        or "/imports/arxiv/" in blob
        or "/imports/pubmed/" in blob
    )


def _node_priority_key(n: dict, degree: int, root: Path) -> tuple:
    node_path_str = n.get("path", "")
    is_recent = 0
    if node_path_str:
        for recent in recently_imported_paths:
            if _path_matches_recent(node_path_str, recent):
                is_recent = 1
                break
    study = int((n.get("metadata") or {}).get("study_count") or 0)
    meta = n.get("metadata") or {}
    structural_role = str(meta.get("structural_role") or "")
    role_bonus = {
        "imports": 0,
        "docs": 1,
        "notes": 1,
        "papers": 2,
        "source": 2,
        "config": 1,
    }.get(structural_role, 0)
    child_count = int(meta.get("child_count") or 0)
    study_score = int(meta.get("study_score") or 0)
    is_folder = 1 if n.get("type") == "folder" else 0
    return (is_recent, role_bonus, is_folder, 1 if study > 0 else 0, study_score, child_count, degree)


def get_limited_graph() -> dict:
    graph = get_current_graph()
    total = len(graph["nodes"])
    if total > GRAPH_NODE_CAP:
        nodes = graph["nodes"]
        degree: dict[str, int] = {}
        for e in graph["edges"]:
            degree[e["source"]] = degree.get(e["source"], 0) + 1
            degree[e["target"]] = degree.get(e["target"], 0) + 1

        root = Path(str(WORKSPACE_ROOT)).resolve()
        ranked = sorted(
            nodes,
            key=lambda n: _node_priority_key(n, degree.get(n["id"], 0), root),
            reverse=True,
        )
        selected_nodes = ranked[:GRAPH_NODE_CAP]
        selected_ids = {n["id"] for n in selected_nodes}

        for n in nodes:
            if n["id"] in selected_ids:
                continue
            if _is_vault_import_node(n):
                selected_nodes.append(n)
                selected_ids.add(n["id"])
                continue
            for recent in recently_imported_paths:
                if _path_matches_recent(n.get("path", ""), recent):
                    selected_nodes.append(n)
                    selected_ids.add(n["id"])
                    break

        node_ids = selected_ids
        edges = [
            e
            for e in graph["edges"]
            if e["source"] in node_ids and e["target"] in node_ids
        ]
        return {"nodes": selected_nodes, "edges": edges, "total": total}
    return {**graph, "total": total}
