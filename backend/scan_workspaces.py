"""Backward-compatible re-exports from backend.scan."""

from .scan import (
    merge_scan_graphs,
    node_id_for_import_dir,
    node_id_for_import_path,
    scan_import_paths,
    scan_workspaces,
)

__all__ = [
    "scan_workspaces",
    "scan_import_paths",
    "merge_scan_graphs",
    "node_id_for_import_path",
    "node_id_for_import_dir",
]
