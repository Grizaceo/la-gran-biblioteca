"""Scan specific import paths (islands) when global scan truncates."""

from __future__ import annotations

import logging
from collections import deque
from pathlib import Path
from typing import Any, Dict, Iterable

from ..constants import (
    get_exclude_dirs,
    get_workspace_root,
    is_archive_dir_name,
    get_archive_policy,
)
from .layout import import_island_origin, posix_rel
from .markdown import should_scan
from .walker import _append_file_node, _append_folder_node

logger = logging.getLogger(__name__)


def _scan_subdirectory(
    graph: Dict[str, Any],
    node_map: Dict[str, str],
    subroot: Path,
    workspace_root: Path,
    base_depth: int,
    *,
    max_files: int = 500,
    max_children: int = 50,
) -> None:
    island_x, island_y = import_island_origin(subroot)
    queue: deque = deque()
    queue.append((subroot.resolve(), base_depth, 0))
    file_count = 0

    while queue and file_count < max_files:
        current_path, depth, sibling_idx = queue.popleft()
        if not current_path.exists():
            continue
        rel_depth = depth - base_depth
        pos = {
            "x": island_x + sibling_idx * 120,
            "y": island_y + rel_depth * 90,
        }
        if current_path.is_dir():
            if is_archive_dir_name(current_path.name):
                if get_archive_policy() != "include":
                    continue
            if current_path.name in get_exclude_dirs():
                continue
            _append_folder_node(graph, node_map, current_path, workspace_root, depth, position=pos)
            try:
                children = [p for p in current_path.iterdir() if should_scan(p)]
                for idx, child in enumerate(sorted(children, key=lambda p: p.name)[:max_children]):
                    queue.append((child, depth + 1, idx))
            except (PermissionError, OSError) as e:
                logger.warning("No se pudo escanear import %s: %s", current_path, e)
        else:
            file_count += 1
            _append_file_node(graph, node_map, current_path, workspace_root, depth, position=pos)


def scan_import_paths(
    paths: Iterable[Path],
    root: Path | None = None,
) -> Dict[str, Any]:
    root = (root or get_workspace_root()).resolve()
    graph: Dict[str, Any] = {"nodes": [], "edges": []}
    node_map: Dict[str, str] = {}

    for raw in paths:
        filepath = Path(raw)
        if not filepath.is_absolute():
            filepath = root / filepath
        filepath = filepath.resolve()
        try:
            filepath.relative_to(root)
        except ValueError:
            logger.warning("Import fuera del workspace, omitido: %s", filepath)
            continue
        if not filepath.exists():
            continue

        if filepath.is_dir():
            parts = filepath.relative_to(root).parts
            accum = root
            for i, part in enumerate(parts):
                accum = accum / part
                _append_folder_node(graph, node_map, accum, root, i + 1)
            _scan_subdirectory(graph, node_map, filepath, root, len(parts))
            continue

        parts = filepath.relative_to(root).parts
        accum = root
        for i, part in enumerate(parts[:-1]):
            accum = accum / part
            _append_folder_node(graph, node_map, accum, root, i + 1)
        _append_file_node(graph, node_map, filepath, root, len(parts))

    return graph


def node_id_for_import_dir(path: Path, root: Path | None = None) -> str:
    from .layout import folder_node_id

    base = root or get_workspace_root()
    rel = posix_rel(Path(path), base)
    return folder_node_id(rel)


def node_id_for_import_path(path: Path, root: Path | None = None) -> str:
    from .layout import file_node_id

    base = root or get_workspace_root()
    rel = posix_rel(Path(path), base)
    return file_node_id(rel)
