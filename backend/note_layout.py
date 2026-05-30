"""Post-scan graph enrichment: inline note nodes, annotates edges, orbital layout."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from .scan.inline_notes import INLINE_EXTENSIONS, parse_inline_blocks_from_file
from .services.note_service import inline_note_node_id, normalize_source_node_id

NOTE_ORBIT_RADIUS = 55.0
GOLDEN_ANGLE = math.pi * (3.0 - math.sqrt(5.0))


def _file_node_id(rel_posix: str) -> str:
    return f"file_{rel_posix.replace(chr(92), '/')}"


def _position_dict(x: float, y: float, z: float) -> dict[str, float]:
    return {"x": x, "y": y, "z": z}


def _get_position(node: dict[str, Any]) -> tuple[float, float, float]:
    pos = node.get("position") or {}
    return (
        float(pos.get("x") or 0),
        float(pos.get("y") or 0),
        float(pos.get("z") or 0),
    )


def _orbit_point(
    center: tuple[float, float, float],
    index: int,
    total: int,
    radius: float = NOTE_ORBIT_RADIUS,
) -> tuple[float, float, float]:
    cx, cy, cz = center
    if total <= 0:
        return center
    angle = GOLDEN_ANGLE * index
    r = radius * (1.0 + (index // 8) * 0.12)
    z_offset = ((index % 5) - 2) * 6.0
    return (
        cx + r * math.cos(angle),
        cy + r * math.sin(angle),
        cz + z_offset,
    )


def _edge_exists(edges: list[dict], source: str, target: str, edge_type: str) -> bool:
    for e in edges:
        if e.get("source") == source and e.get("target") == target and e.get("type") == edge_type:
            return True
    return False


def apply_inline_note_nodes(graph: dict[str, Any], workspace_root: Path) -> dict[str, Any]:
    """Materialize virtual graph nodes for inline lgb-note blocks."""
    nodes = graph.setdefault("nodes", [])
    edges = graph.setdefault("edges", [])
    nodes_by_id = {n["id"]: n for n in nodes}

    for node in list(nodes):
        path_str = node.get("path") or ""
        if not path_str:
            continue
        path = Path(path_str)
        if path.suffix.lower() not in INLINE_EXTENSIONS:
            continue
        if "_notes" in path.parts:
            continue
        try:
            rel = path.resolve().relative_to(workspace_root.resolve())
            source_id = node.get("id") or _file_node_id(rel.as_posix())
        except ValueError:
            source_id = node.get("id") or ""
            rel = None

        if not path.is_file():
            continue

        for block in parse_inline_blocks_from_file(
            path,
            source_node_id=source_id,
            workspace_root=workspace_root,
        ):
            note_id = block["id"]
            src_nid = block.get("source_node_id") or source_id
            if not src_nid:
                continue
            vid = inline_note_node_id(src_nid, note_id)
            if vid in nodes_by_id:
                continue
            label = (block.get("title") or "").strip() or block.get("body", "")[:48] or note_id
            meta = {
                "storage": "inline",
                "source_node_id": src_nid,
                "note_id": note_id,
                "note_labels": block.get("labels") or [],
                "tags": list(block.get("labels") or []),
                "orbit_anchor": src_nid,
                "inline_line_start": block.get("line_start"),
                "inline_line_end": block.get("line_end"),
            }
            note_node = {
                "id": vid,
                "type": "note",
                "label": label,
                "path": block.get("path") or str(rel) if rel else path_str,
                "metadata": meta,
                "position": dict(node.get("position") or {"x": 0, "y": 0, "z": 0}),
            }
            nodes.append(note_node)
            nodes_by_id[vid] = note_node
            if not _edge_exists(edges, vid, src_nid, "annotates"):
                edges.append({"source": vid, "target": src_nid, "type": "annotates", "weight": 0.8})

    return graph


def enrich_vault_note_metadata(graph: dict[str, Any]) -> dict[str, Any]:
    """Add orbit_anchor and tags to vault note nodes scanned from _notes/."""
    for node in graph.get("nodes", []):
        if node.get("type") != "note":
            continue
        path_str = node.get("path") or ""
        if "_notes" not in Path(path_str).parts and "_notes" not in path_str.replace("\\", "/"):
            continue
        meta = dict(node.get("metadata") or {})
        fm = meta.get("frontmatter") or {}
        source_id = str(fm.get("source_node_id") or meta.get("source_node_id") or "")
        labels = fm.get("labels") or meta.get("note_labels") or []
        if isinstance(labels, str):
            labels = [labels] if labels else []
        if source_id:
            meta["source_node_id"] = normalize_source_node_id(source_id)
            meta["orbit_anchor"] = meta["source_node_id"]
        meta["storage"] = "vault"
        meta["note_labels"] = [str(x) for x in labels]
        if labels:
            existing_tags = set(meta.get("tags") or [])
            existing_tags.update(str(x) for x in labels)
            meta["tags"] = sorted(existing_tags)
        node["metadata"] = meta

        if source_id and meta.get("orbit_anchor"):
            edges = graph.setdefault("edges", [])
            nid = node["id"]
            anchor = meta["orbit_anchor"]
            if not _edge_exists(edges, nid, anchor, "annotates"):
                edges.append({"source": nid, "target": anchor, "type": "annotates", "weight": 0.8})

    return graph


def apply_note_orbit_layout(graph: dict[str, Any]) -> dict[str, Any]:
    """Place note nodes in a ring around their orbit_anchor source."""
    nodes_by_id = {n["id"]: n for n in graph.get("nodes", [])}
    groups: dict[str, list[dict]] = {}

    for node in graph.get("nodes", []):
        if node.get("type") != "note":
            continue
        meta = node.get("metadata") or {}
        anchor = meta.get("orbit_anchor") or meta.get("source_node_id")
        if not anchor:
            continue
        groups.setdefault(anchor, []).append(node)

    for anchor_id, group in groups.items():
        source = nodes_by_id.get(anchor_id)
        if source is None:
            continue
        cx, cy, cz = _get_position(source)
        group.sort(key=lambda n: (n.get("metadata") or {}).get("note_id") or n.get("label") or n["id"])
        total = len(group)
        for idx, note_node in enumerate(group):
            x, y, z = _orbit_point((cx, cy, cz), idx, total)
            note_node["position"] = _position_dict(x, y, z)
            meta = dict(note_node.get("metadata") or {})
            meta["orbit_index"] = idx
            note_node["metadata"] = meta

    return graph


def apply_note_counts_to_sources(graph: dict[str, Any]) -> dict[str, Any]:
    """Set inline_note_count on source document nodes."""
    counts: dict[str, int] = {}
    for node in graph.get("nodes", []):
        if node.get("type") != "note":
            continue
        meta = node.get("metadata") or {}
        anchor = meta.get("orbit_anchor") or meta.get("source_node_id")
        if anchor:
            counts[anchor] = counts.get(anchor, 0) + 1

    for node in graph.get("nodes", []):
        nid = node.get("id")
        if nid in counts:
            meta = dict(node.get("metadata") or {})
            meta["inline_note_count"] = counts[nid]
            node["metadata"] = meta

    return graph


def apply_note_graph_enrichment(
    graph: dict[str, Any],
    workspace_root: Path,
    *,
    apply_orbit: bool = True,
) -> dict[str, Any]:
    graph = apply_inline_note_nodes(graph, workspace_root)
    graph = enrich_vault_note_metadata(graph)
    if apply_orbit:
        graph = apply_note_orbit_layout(graph)
    graph = apply_note_counts_to_sources(graph)
    return graph
