"""BFS workspace walker with archive policy."""

from __future__ import annotations

import logging
from collections import deque
from pathlib import Path
from typing import Any, Dict, Optional

from ..constants import WORKSPACE_ROOT, get_archive_policy, get_exclude_dirs, is_archive_dir_name
from .layout import (
    attach_tags_to_node,
    file_node_id,
    folder_node_id,
    add_colocated_edges,
    resolve_wikilinks,
)
from .markdown import get_node_type, parse_markdown_file, should_scan

logger = logging.getLogger(__name__)

_scan_stats: dict[str, int] = {"skipped_archive_dirs": 0}


def consume_scan_stats() -> dict[str, int]:
    global _scan_stats
    out = dict(_scan_stats)
    _scan_stats = {"skipped_archive_dirs": 0}
    return out


def _should_skip_dir(dir_name: str) -> bool:
    if dir_name in get_exclude_dirs():
        return True
    if is_archive_dir_name(dir_name) and get_archive_policy() == "exclude":
        return True
    return False


def _append_shadow_folder(
    graph: Dict[str, Any],
    node_map: Dict[str, str],
    folder: Path,
    root: Path,
    depth: int,
    x: float,
    y: float,
) -> str:
    rel = folder.relative_to(root).as_posix()
    node_id = folder_node_id(rel)
    folder_key = str(folder.resolve())
    if folder_key in node_map:
        return node_map[folder_key]
    graph["nodes"].append(
        {
            "id": node_id,
            "type": "folder",
            "label": folder.name,
            "path": str(folder.resolve()),
            "metadata": {"depth": depth, "archived": True},
            "position": {"x": x, "y": y},
        }
    )
    node_map[folder_key] = node_id
    parent_id = node_map.get(str(folder.parent.resolve()))
    if parent_id:
        graph["edges"].append(
            {"source": parent_id, "target": node_id, "type": "contains"}
        )
    return node_id


def _append_folder_node(
    graph: Dict[str, Any],
    node_map: Dict[str, str],
    folder: Path,
    root: Path,
    depth: int,
    *,
    position: Optional[Dict[str, float]] = None,
) -> str:
    rel = folder.relative_to(root).as_posix()
    node_id = folder_node_id(rel)
    folder_key = str(folder.resolve())
    if folder_key in node_map:
        return node_map[folder_key]
    pos = position if position is not None else {"x": 0, "y": depth * 150}
    graph["nodes"].append(
        {
            "id": node_id,
            "type": "folder",
            "label": folder.name if rel != "." else root.name,
            "path": str(folder.resolve()),
            "metadata": {"depth": depth},
            "position": pos,
        }
    )
    node_map[folder_key] = node_id
    if folder.parent != folder:
        parent_id = node_map.get(str(folder.parent.resolve()))
        if parent_id:
            graph["edges"].append(
                {"source": parent_id, "target": node_id, "type": "contains"}
            )
    return node_id


def _append_file_node(
    graph: Dict[str, Any],
    node_map: Dict[str, str],
    filepath: Path,
    root: Path,
    depth: int,
    *,
    position: Optional[Dict[str, float]] = None,
    created_tags: Optional[dict] = None,
) -> str:
    rel_posix = filepath.relative_to(root).as_posix()
    node_id = file_node_id(rel_posix)
    size = 0
    try:
        size = filepath.stat().st_size
    except (PermissionError, OSError) as e:
        logger.warning("No se pudo leer tamaño de %s: %s", filepath, e)

    frontmatter, wikilinks, tags = parse_markdown_file(filepath, size)
    metadata: Dict[str, Any] = {"size": size, "depth": depth}
    if frontmatter:
        metadata["frontmatter"] = frontmatter
    if tags:
        metadata["tags"] = tags

    label = filepath.name
    if frontmatter.get("title"):
        label = frontmatter["title"]

    pos = position if position is not None else {"x": 0, "y": depth * 150}
    graph["nodes"].append(
        {
            "id": node_id,
            "type": get_node_type(filepath),
            "label": label,
            "path": str(filepath.resolve()),
            "metadata": metadata,
            "position": pos,
        }
    )
    node_map[str(filepath.resolve())] = node_id

    parent_id = node_map.get(str(filepath.parent.resolve()))
    if parent_id:
        graph["edges"].append(
            {"source": parent_id, "target": node_id, "type": "contains"}
        )

    tag_created = created_tags if created_tags is not None else {}
    attach_tags_to_node(graph, node_id, tags, position=pos, created_tags=tag_created)

    return node_id


def scan_workspaces(
    root: Path = WORKSPACE_ROOT,
    max_files: int = 5000,
    max_children: int = 50,
) -> Dict[str, Any]:
    global _scan_stats
    _scan_stats = {"skipped_archive_dirs": 0}

    graph: Dict[str, Any] = {"nodes": [], "edges": []}
    node_map: Dict[str, str] = {}
    name_to_id: dict[str, str] = {}
    pending_wikilinks: list[tuple[str, str]] = []
    created_tags: dict[str, dict] = {}
    folder_files: dict[str, list[str]] = {}

    queue = deque()
    queue.append((root, 0, 0, 0, 0))

    sibling_x_spacing = 150
    y_spacing = 150
    file_count = 0

    while queue and file_count < max_files:
        current_path, depth, parent_x, parent_y, sibling_idx = queue.popleft()

        if not current_path.exists():
            continue

        x = parent_x + (sibling_idx * sibling_x_spacing) if depth > 0 else 0
        y = parent_y + y_spacing if depth > 0 else 0

        if current_path.is_dir():
            if is_archive_dir_name(current_path.name):
                policy = get_archive_policy()
                if policy == "exclude":
                    _scan_stats["skipped_archive_dirs"] += 1
                    continue
                if policy == "shadow":
                    _scan_stats["skipped_archive_dirs"] += 1
                    _append_shadow_folder(
                        graph, node_map, current_path, root, depth, x, y
                    )
                    continue

            if _should_skip_dir(current_path.name):
                continue

            rel = current_path.relative_to(root)
            node_id = folder_node_id(rel.as_posix() if str(rel) != "." else ".")
            stored_path = str((root / rel).resolve())
            graph["nodes"].append(
                {
                    "id": node_id,
                    "type": "folder",
                    "label": current_path.name,
                    "path": stored_path,
                    "metadata": {"depth": depth},
                    "position": {"x": x, "y": y},
                }
            )
            node_map[str(current_path)] = node_id

            if depth > 0 and str(current_path.parent) in node_map:
                graph["edges"].append(
                    {
                        "source": node_map[str(current_path.parent)],
                        "target": node_id,
                        "type": "contains",
                    }
                )

            try:
                children = [p for p in current_path.iterdir() if should_scan(p)]
                if len(children) > max_children:
                    logger.warning(
                        "Truncado: %s tiene %d hijos escaneables (max %d)",
                        current_path,
                        len(children),
                        max_children,
                    )
                for idx, child in enumerate(
                    sorted(children, key=lambda p: p.name)[:max_children]
                ):
                    queue.append((child, depth + 1, x, y, idx))
            except (PermissionError, OSError) as e:
                logger.warning("No se pudo escanear %s: %s", current_path, e)
        else:
            file_count += 1
            rel = current_path.relative_to(root)
            node_id = file_node_id(rel.as_posix())

            size = 0
            try:
                size = current_path.stat().st_size
            except (PermissionError, OSError) as e:
                logger.warning("No se pudo leer tamaño de %s: %s", current_path, e)

            frontmatter, wikilinks, tags = parse_markdown_file(current_path, size)
            metadata: Dict[str, Any] = {"size": size, "depth": depth}
            if frontmatter:
                metadata["frontmatter"] = frontmatter
            if tags:
                metadata["tags"] = tags

            label = current_path.name
            if frontmatter.get("title"):
                label = frontmatter["title"]

            graph["nodes"].append(
                {
                    "id": node_id,
                    "type": get_node_type(current_path),
                    "label": label,
                    "path": str((root / rel).resolve()),
                    "metadata": metadata,
                    "position": {"x": x, "y": y},
                }
            )
            node_map[str(current_path)] = node_id

            name_to_id[current_path.name] = node_id
            name_to_id[current_path.stem] = node_id
            name_to_id[str(rel)] = node_id

            parent_str = str(current_path.parent)
            if parent_str not in folder_files:
                folder_files[parent_str] = []
            folder_files[parent_str].append(node_id)

            for link in wikilinks:
                pending_wikilinks.append((node_id, link))

            attach_tags_to_node(
                graph,
                node_id,
                tags,
                position={"x": x, "y": y + 40},
                created_tags=created_tags,
            )

            parent_id = node_map.get(str(current_path.parent))
            if parent_id:
                graph["edges"].append(
                    {"source": parent_id, "target": node_id, "type": "contains"}
                )

    resolve_wikilinks(graph, pending_wikilinks, name_to_id)
    add_colocated_edges(graph, folder_files)

    if file_count >= max_files:
        logger.warning("Escaneo truncado: se alcanzó el límite de %d archivos", max_files)

    return graph
