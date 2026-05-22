"""Workspace scanner package — re-exports stable API."""

from .layout import file_node_id, folder_node_id, posix_rel
from .imports_scan import (
    node_id_for_import_dir,
    node_id_for_import_path,
    scan_import_paths,
)
from .walker import scan_workspaces


def merge_scan_graphs(base, extra):
    """Merge nodes by id; dedupe edges by (source, target, type)."""
    nodes_by_id = {n["id"]: n for n in base.get("nodes", [])}
    for n in extra.get("nodes", []):
        nodes_by_id[n["id"]] = n
    edge_keys: set[tuple] = set()
    edges = []
    for e in base.get("edges", []) + extra.get("edges", []):
        key = (e["source"], e["target"], e["type"])
        if key in edge_keys:
            continue
        edge_keys.add(key)
        edges.append(e)
    return {"nodes": list(nodes_by_id.values()), "edges": edges}


__all__ = [
    "scan_workspaces",
    "scan_import_paths",
    "merge_scan_graphs",
    "node_id_for_import_path",
    "node_id_for_import_dir",
    "file_node_id",
    "folder_node_id",
    "posix_rel",
]
