"""Unified scan → merge imports → constellation → build graph pipeline."""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Any

from ..constants import WORKSPACE_ROOT
from ..constellation_layout import apply_constellation_layout
from ..graph_enrichment import enrich_graph_metadata
from ..graph_engine import GraphEngine
from ..scan_workspaces import (
    merge_scan_graphs,
    scan_import_paths,
    scan_workspaces,
)

logger = logging.getLogger(__name__)

SCAN_MAX_FILES = int(os.environ.get("SCAN_MAX_FILES", "5000"))
SCAN_MAX_CHILDREN = int(os.environ.get("SCAN_MAX_CHILDREN", "50"))

_last_scan_stats: dict[str, int] = {"skipped_archive_dirs": 0}
_last_pipeline_stats: dict[str, int] = {
    "scan_ms": 0,
    "finalize_ms": 0,
    "build_ms": 0,
    "node_count": 0,
    "edge_count": 0,
}


def get_last_scan_stats() -> dict[str, int]:
    return dict(_last_scan_stats)


def get_last_pipeline_stats() -> dict[str, int]:
    return dict(_last_pipeline_stats)


def import_ensure_paths(
    recently_imported_paths: list[str],
    extra: list[Path | str] | None = None,
) -> list[Path]:
    """Paths that must appear in the graph even when the global scan truncates."""
    paths: list[Path] = []
    seen: set[str] = set()

    def add(p: Path) -> None:
        try:
            resolved = str(p.resolve())
        except OSError:
            return
        if resolved in seen or not p.exists():
            return
        seen.add(resolved)
        paths.append(p.resolve())

    for recent in recently_imported_paths:
        add(Path(recent))
    github_root = WORKSPACE_ROOT / "imports" / "github"
    if github_root.is_dir():
        for child in sorted(github_root.iterdir()):
            if child.is_dir():
                add(child)
    if extra:
        for item in extra:
            add(Path(item))
    return paths


def finalize_raw_graph(raw: dict[str, Any], engine: GraphEngine) -> dict[str, Any]:
    """DB suggestions; constellation layout only for confirmed prefs."""
    raw = enrich_graph_metadata(raw, WORKSPACE_ROOT)
    engine.sync_folder_constellation_suggestions(raw)
    prefs = engine.list_constellation_prefs()
    confirmed = [p for p in prefs if p.get("status") == "confirmed"]
    if not confirmed:
        return raw
    graph = apply_constellation_layout(raw, prefs, only_confirmed=True)
    return enrich_graph_metadata(graph, WORKSPACE_ROOT)


def scan_raw_graph(
    *,
    root: Path | None = None,
    recently_imported_paths: list[str] | None = None,
    ensure_paths: list[Path | str] | None = None,
    max_files: int | None = None,
    max_children: int | None = None,
) -> dict[str, Any]:
    """Scan workspace, merge import paths (no DB/constellation finalize)."""
    global _last_scan_stats
    from ..scan.walker import consume_scan_stats

    scan_root = root or WORKSPACE_ROOT
    mf = max_files if max_files is not None else SCAN_MAX_FILES
    mc = max_children if max_children is not None else SCAN_MAX_CHILDREN
    raw = scan_workspaces(root=scan_root, max_files=mf, max_children=mc)
    _last_scan_stats = consume_scan_stats()

    recent = recently_imported_paths or []
    merged_ensure = import_ensure_paths(recent, ensure_paths)
    if merged_ensure:
        patch = scan_import_paths(merged_ensure, scan_root)
        raw = merge_scan_graphs(raw, patch)
    return raw


def rebuild_graph(
    engine: GraphEngine,
    *,
    root: Path | None = None,
    recently_imported_paths: list[str] | None = None,
    ensure_paths: list[Path | str] | None = None,
    use_rebuild: bool = True,
    max_files: int | None = None,
    max_children: int | None = None,
) -> dict[str, Any]:
    """Full pipeline used by HTTP rescan, watcher, and MCP."""
    global _last_pipeline_stats
    t0 = time.perf_counter()
    raw = scan_raw_graph(
        root=root,
        recently_imported_paths=recently_imported_paths,
        ensure_paths=ensure_paths,
        max_files=max_files,
        max_children=max_children,
    )
    t1 = time.perf_counter()
    raw = finalize_raw_graph(raw, engine)
    t2 = time.perf_counter()
    if use_rebuild:
        graph = engine.rebuild_graph(raw)
    else:
        graph = engine.build_graph(raw)
    t3 = time.perf_counter()
    _last_pipeline_stats = {
        "scan_ms": int((t1 - t0) * 1000),
        "finalize_ms": int((t2 - t1) * 1000),
        "build_ms": int((t3 - t2) * 1000),
        "node_count": len(graph.get("nodes", [])),
        "edge_count": len(graph.get("edges", [])),
    }
    return graph
