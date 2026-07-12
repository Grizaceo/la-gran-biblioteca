"""Layout helpers: import islands, co-location edges, node ids."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, Optional


def posix_rel(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def folder_node_id(rel_posix: str) -> str:
    return "folder_dot" if rel_posix == "." else f"folder_{rel_posix}"


def file_node_id(rel_posix: str) -> str:
    return f"file_{rel_posix}"


def import_island_origin(subroot: Path) -> tuple[float, float]:
    slot = abs(hash(subroot.name)) % 48
    return (4200.0 + slot * 220.0, 4200.0 + (slot % 9) * 180.0)


def resolve_wikilinks(
    graph: Dict[str, Any],
    pending_wikilinks: list[tuple[str, str]],
    name_to_id: dict[str, str],
) -> None:
    """Resolve wikilinks to edges, deduplicating by (source, target, type)."""
    existing = {
        (e["source"], e["target"]) for e in graph.get("edges", []) if e.get("type") == "references"
    }
    for source_id, target_name in pending_wikilinks:
        target_id = name_to_id.get(target_name)
        if not target_id:
            target_lower = target_name.lower()
            for key, val in name_to_id.items():
                if (
                    key.lower() == target_lower
                    or target_lower in key.lower()
                    or key.lower() in target_lower
                ):
                    target_id = val
                    break
        if target_id:
            key = (source_id, target_id)
            if key not in existing:
                existing.add(key)
                graph["edges"].append(
                    {
                        "source": source_id,
                        "target": target_id,
                        "type": "references",
                        "weight": 1.0,
                    }
                )


def add_colocated_edges(graph: Dict[str, Any], folder_files: dict[str, list[str]]) -> None:
    """Add co-location edges, deduplicating by (source, target, type)."""
    colocated_max = int(os.environ.get("LGB_COLOCATED_MAX", "0"))
    existing = {
        (e["source"], e["target"]) for e in graph.get("edges", []) if e.get("type") == "co-located"
    }
    for _folder_path, file_ids in folder_files.items():
        if 2 <= len(file_ids) <= 20:
            if colocated_max > 0 and len(file_ids) > colocated_max:
                hub = file_ids[0]
                for fid in file_ids[1:]:
                    key = (hub, fid)
                    if key not in existing:
                        existing.add(key)
                        graph["edges"].append(
                            {
                                "source": hub,
                                "target": fid,
                                "type": "co-located",
                                "weight": 0.2,
                            }
                        )
            else:
                for i in range(len(file_ids)):
                    for j in range(i + 1, len(file_ids)):
                        key = (file_ids[i], file_ids[j])
                        if key not in existing:
                            existing.add(key)
                            graph["edges"].append(
                                {
                                    "source": file_ids[i],
                                    "target": file_ids[j],
                                    "type": "co-located",
                                    "weight": 0.2,
                                }
                            )


def attach_tags_to_node(
    graph: Dict[str, Any],
    node_id: str,
    tags: list,
    *,
    position: Optional[Dict[str, float]] = None,
    created_tags: Optional[dict[str, dict]] = None,
) -> None:
    pos = position or {"x": 0, "y": 40}
    tag_created = created_tags if created_tags is not None else {}
    for tag in tags:
        tag_id = f"tag_{tag}"
        if tag_id not in tag_created:
            tag_node = {
                "id": tag_id,
                "type": "tag",
                "label": f"#{tag}",
                "path": "",
                "metadata": {"is_tag": True},
                "position": {"x": pos.get("x", 0), "y": pos.get("y", 40)},
            }
            graph["nodes"].append(tag_node)
            tag_created[tag_id] = tag_node
        graph["edges"].append(
            {"source": node_id, "target": tag_id, "type": "tagged", "weight": 0.3}
        )
