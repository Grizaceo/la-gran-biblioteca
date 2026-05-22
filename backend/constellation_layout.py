#!/usr/bin/env python3
"""
constellation_layout.py — catálogo IAU, sugerencias por nombre y layout 3D por carpeta-ancla.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_CATALOG_PATH = Path(__file__).parent / "data" / "constellations.json"
_LAYOUT_SCALE = 400.0
_NESTED_SCALE = 0.32
_FILE_ORBIT_RADIUS = 28.0
_ISLAND_SPHERE_RADIUS = 600.0
_MAX_SCENE_RADIUS = 2400.0
_PERIPHERAL_CLOUD_RADIUS = 1.4 * _ISLAND_SPHERE_RADIUS
_catalog_cache: Optional[List[Dict[str, Any]]] = None


def _normalize_name(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")


def load_catalog() -> List[Dict[str, Any]]:
    global _catalog_cache
    if _catalog_cache is not None:
        return _catalog_cache
    if _CATALOG_PATH.is_file():
        with open(_CATALOG_PATH, encoding="utf-8") as f:
            data = json.load(f)
        _catalog_cache = data.get("constellations", data) if isinstance(data, dict) else data
        return _catalog_cache
    try:
        from .scripts.generate_constellation_catalog import build_constellations
    except ImportError:
        from backend.scripts.generate_constellation_catalog import build_constellations

    _catalog_cache = build_constellations()
    return _catalog_cache


def catalog_by_id() -> Dict[str, Dict[str, Any]]:
    return {c["id"]: c for c in load_catalog()}


def suggest_constellation(folder_name: str, threshold: float = 0.72) -> Optional[str]:
    """Fuzzy match folder name to constellation id."""
    if not folder_name or not folder_name.strip():
        return None
    needle = _normalize_name(folder_name)
    if not needle:
        return None

    best_id: Optional[str] = None
    best_score = 0.0

    for c in load_catalog():
        cid = c["id"]
        candidates = [cid, c.get("name", ""), c.get("name_es", "")]
        for alias in c.get("aliases", []):
            candidates.append(alias)
        for raw in candidates:
            if not raw:
                continue
            hay = _normalize_name(str(raw))
            if not hay:
                continue
            if needle == hay or needle in hay or hay in needle:
                return cid
            score = SequenceMatcher(None, needle, hay).ratio()
            if score > best_score:
                best_score = score
                best_id = cid

    if best_id and best_score >= threshold:
        return best_id
    return None


def _ra_dec_to_xy(ra_deg: float, dec_deg: float, center_ra: float, center_dec: float) -> Tuple[float, float]:
    """Stereographic projection around constellation center (degrees)."""
    ra_rad = math.radians(ra_deg - center_ra)
    dec_rad = math.radians(dec_deg)
    center_dec_rad = math.radians(center_dec)
    cos_c = math.cos(center_dec_rad)
    sin_c = math.sin(center_dec_rad)
    cos_d = math.cos(dec_rad)
    sin_d = math.sin(dec_rad)
    k = 2.0 / (1.0 + sin_c * sin_d + cos_c * cos_d * math.cos(ra_rad))
    x = k * cos_d * math.sin(ra_rad)
    y = k * (cos_c * sin_d - sin_c * cos_d * math.cos(ra_rad))
    return x, y


def _project_constellation_stars(constellation: Dict[str, Any]) -> List[Dict[str, float]]:
    stars = constellation.get("stars") or []
    if not stars:
        return [{"x": 0.0, "y": 0.0, "z": 0.0, "mag": 1.0}]

    ras = [s["ra"] for s in stars]
    decs = [s["dec"] for s in stars]
    center_ra = sum(ras) / len(ras)
    center_dec = sum(decs) / len(decs)

    projected: List[Dict[str, float]] = []
    xs: List[float] = []
    ys: List[float] = []
    for s in stars:
        x, y = _ra_dec_to_xy(s["ra"], s["dec"], center_ra, center_dec)
        xs.append(x)
        ys.append(y)
        projected.append({"x": x, "y": y, "mag": float(s.get("mag", 3.0))})

    max_r = max(math.hypot(px, py) for px, py in zip(xs, ys)) or 1.0
    scale = _LAYOUT_SCALE / max_r
    out: List[Dict[str, float]] = []
    for p in projected:
        mag = p["mag"]
        z = (6.0 - min(mag, 6.0)) * 12.0
        out.append({
            "x": p["x"] * scale,
            "y": p["y"] * scale,
            "z": z,
            "mag": mag,
        })
    return out


def _fibonacci_sphere_point(index: int, total: int, radius: float) -> Tuple[float, float, float]:
    """Uniform-ish point on a sphere: golden-angle azimuth + linear z in [-1, 1]."""
    if total <= 1:
        return (0.0, 0.0, 0.0)
    golden_angle = math.pi * (3.0 - math.sqrt(5.0))
    y = 1.0 - (2.0 * index + 1.0) / total
    r_at_y = math.sqrt(max(0.0, 1.0 - y * y))
    theta = golden_angle * index
    x = math.cos(theta) * r_at_y * radius
    y_coord = y * radius
    z = math.sin(theta) * r_at_y * radius
    return (x, y_coord, z)


def _top_level_island_origin(index: int, total: int) -> Tuple[float, float, float]:
    """Origin for a top-level island on the Fibonacci sphere packing."""
    return _fibonacci_sphere_point(index, total, _ISLAND_SPHERE_RADIUS)


def _recenter_positions(
    positions: Dict[str, Tuple[float, float, float]],
) -> Dict[str, Tuple[float, float, float]]:
    """Subtract centroid; optionally scale down if max radius exceeds cap."""
    if not positions:
        return positions
    xs = [p[0] for p in positions.values()]
    ys = [p[1] for p in positions.values()]
    zs = [p[2] for p in positions.values()]
    n = len(xs)
    cx = sum(xs) / n
    cy = sum(ys) / n
    cz = sum(zs) / n
    shifted = {
        nid: (x - cx, y - cy, z - cz)
        for nid, (x, y, z) in positions.items()
    }
    max_r = max(math.sqrt(x * x + y * y + z * z) for x, y, z in shifted.values())
    if _MAX_SCENE_RADIUS > 0 and max_r > _MAX_SCENE_RADIUS:
        scale = _MAX_SCENE_RADIUS / max_r
        return {
            nid: (x * scale, y * scale, z * scale)
            for nid, (x, y, z) in shifted.items()
        }
    return shifted


def _is_top_level_anchor(anchor_path: str, all_anchor_paths: List[str]) -> bool:
    for other in all_anchor_paths:
        if other != anchor_path and _path_is_under(anchor_path, other):
            return False
    return True


def _spiral_offset(index: int, radius: float = 55.0) -> Tuple[float, float, float]:
    angle = index * 2.399963
    r = radius * (1.0 + index * 0.15)
    return r * math.cos(angle), r * math.sin(angle), (index % 5) * 8.0


def _normalize_folder_path(path: str) -> str:
    return str(Path(path).resolve())


def _path_is_under(node_path: str, anchor_path: str) -> bool:
    try:
        node = Path(node_path).resolve()
        anchor = Path(anchor_path).resolve()
        node.relative_to(anchor)
        return True
    except (ValueError, OSError):
        return False


def _best_anchor_for_node(
    node_path: str,
    prefs_by_path: Dict[str, Dict[str, Any]],
) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Deepest folder_path prefix match among active prefs."""
    matches: List[Tuple[int, str, Dict[str, Any]]] = []
    for folder_path, pref in prefs_by_path.items():
        if pref.get("status") not in ("suggested", "confirmed"):
            continue
        if not pref.get("constellation_id"):
            continue
        if _path_is_under(node_path, folder_path):
            depth = len(Path(folder_path).parts)
            matches.append((depth, folder_path, pref))
    if not matches:
        return None
    matches.sort(key=lambda t: t[0], reverse=True)
    _, path, pref = matches[0]
    return path, pref


def _collect_subtree_nodes(
    graph: Dict[str, Any],
    anchor_path: str,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    folders: List[Dict[str, Any]] = []
    files: List[Dict[str, Any]] = []
    for n in graph.get("nodes", []):
        p = n.get("path") or ""
        if not _path_is_under(p, anchor_path):
            continue
        if n.get("type") == "folder":
            folders.append(n)
        else:
            files.append(n)
    return folders, files


def _parent_folder_path(file_path: str) -> str:
    return str(Path(file_path).resolve().parent)


def _layout_anchor_subtree(
    graph: Dict[str, Any],
    anchor_path: str,
    constellation_id: str,
    catalog: Dict[str, Dict[str, Any]],
    origin: Tuple[float, float, float],
    scale: float,
    nodes_by_id: Dict[str, Dict[str, Any]],
    parent_edges: Dict[str, str],
) -> Dict[str, Tuple[float, float, float]]:
    """Return node_id -> (x,y,z) for nodes under anchor."""
    const = catalog.get(constellation_id)
    if not const:
        return {}

    stars = _project_constellation_stars(const)
    stars.sort(key=lambda s: s["mag"])

    folders, files = _collect_subtree_nodes(graph, anchor_path)
    folders.sort(key=lambda n: (
        int((n.get("metadata") or {}).get("depth", 0)),
        (n.get("label") or "").lower(),
    ))

    positions: Dict[str, Tuple[float, float, float]] = {}
    ox, oy, oz = origin

    for idx, folder in enumerate(folders):
        if idx < len(stars):
            sx, sy, sz = stars[idx]["x"], stars[idx]["y"], stars[idx]["z"]
        else:
            sx, sy, sz = _spiral_offset(idx - len(stars))
        x = ox + sx * scale
        y = oy + sy * scale
        z = oz + sz * scale
        positions[folder["id"]] = (x, y, z)

    # Files orbit parent folder position
    folder_path_to_id = {
        _normalize_folder_path(n.get("path", "")): n["id"]
        for n in folders
    }
    files_by_parent: Dict[str, List[Dict[str, Any]]] = {}
    for f in files:
        parent = _normalize_folder_path(_parent_folder_path(f.get("path", "")))
        files_by_parent.setdefault(parent, []).append(f)

    for parent_path, group in files_by_parent.items():
        parent_id = folder_path_to_id.get(parent_path)
        if not parent_id or parent_id not in positions:
            cx, cy, cz = ox, oy, oz
        else:
            cx, cy, cz = positions[parent_id]
        group.sort(key=lambda n: (n.get("label") or "").lower())
        for i, fnode in enumerate(group):
            angle = (2 * math.pi * i) / max(len(group), 1)
            r = _FILE_ORBIT_RADIUS * scale
            positions[fnode["id"]] = (
                cx + r * math.cos(angle),
                cy + r * math.sin(angle),
                cz + (i % 3) * 6.0 * scale,
            )

    return positions


def _build_parent_map(graph: Dict[str, Any]) -> Dict[str, str]:
    """file/folder node_id -> parent folder node_id via contains edges."""
    parent: Dict[str, str] = {}
    for e in graph.get("edges", []):
        if e.get("type") != "contains":
            continue
        parent[e["target"]] = e["source"]
    return parent


def apply_constellation_layout(
    graph: Dict[str, Any],
    prefs: List[Dict[str, Any]],
    *,
    only_confirmed: bool = False,
) -> Dict[str, Any]:
    """
    Post-process scan graph: place nodes under folder anchors on constellation shapes.

    Top-level islands are packed on a Fibonacci sphere (stable order by folder_path),
    then the scene is recentered at the origin with optional uniform scale-down.
    Nodes outside any anchor are placed on a peripheral Fibonacci cloud so zoomToFit
    is not stretched by the scan tree layout.
    """
    catalog = catalog_by_id()
    prefs_by_path: Dict[str, Dict[str, Any]] = {}
    for p in prefs:
        fp = _normalize_folder_path(p["folder_path"])
        if only_confirmed and p.get("status") != "confirmed":
            continue
        if p.get("status") not in ("suggested", "confirmed"):
            continue
        prefs_by_path[fp] = p

    if not prefs_by_path:
        return graph

    nodes_by_id = {n["id"]: n for n in graph.get("nodes", [])}

    # Sort anchors shallow → deep for nested placement
    anchor_paths = sorted(
        prefs_by_path.keys(),
        key=lambda p: len(Path(p).parts),
    )

    all_positions: Dict[str, Tuple[float, float, float]] = {}
    anchor_world: Dict[str, Tuple[float, float, float]] = {}

    top_level_paths = sorted(
        [p for p in anchor_paths if _is_top_level_anchor(p, anchor_paths)],
    )
    top_level_origins = {
        path: _top_level_island_origin(i, len(top_level_paths))
        for i, path in enumerate(top_level_paths)
    }

    for anchor_path in anchor_paths:
        pref = prefs_by_path[anchor_path]
        cid = pref.get("constellation_id")
        if not cid or cid not in catalog:
            continue

        anchor_node_id = None
        for n in graph.get("nodes", []):
            if n.get("type") != "folder":
                continue
            if _normalize_folder_path(n.get("path", "")) == anchor_path:
                anchor_node_id = n["id"]
                break

        # Nested origin: parent anchor's position if any
        parent_anchor = None
        for other in sorted(anchor_world.keys(), key=lambda p: len(Path(p).parts), reverse=True):
            if other != anchor_path and _path_is_under(anchor_path, other):
                parent_anchor = other
                break

        if parent_anchor and anchor_node_id and anchor_node_id in all_positions:
            origin = all_positions[anchor_node_id]
            scale = _NESTED_SCALE
        elif parent_anchor:
            origin = anchor_world[parent_anchor]
            scale = _NESTED_SCALE
        else:
            origin = top_level_origins.get(anchor_path, (0.0, 0.0, 0.0))
            scale = 1.0

        subtree_pos = _layout_anchor_subtree(
            graph,
            anchor_path,
            cid,
            catalog,
            origin,
            scale,
            nodes_by_id,
            _build_parent_map(graph),
        )
        all_positions.update(subtree_pos)
        anchor_world[anchor_path] = origin

    unanchored = [
        n for n in graph.get("nodes", [])
        if n["id"] not in all_positions
    ]
    unanchored.sort(key=lambda n: (n.get("path") or "", n.get("label") or ""))
    for i, node in enumerate(unanchored):
        all_positions[node["id"]] = _fibonacci_sphere_point(
            i,
            max(len(unanchored), 1),
            _PERIPHERAL_CLOUD_RADIUS,
        )

    all_positions = _recenter_positions(all_positions)

    for node in graph.get("nodes", []):
        nid = node["id"]
        if nid not in all_positions:
            continue
        x, y, z = all_positions[nid]
        node["position"] = {"x": x, "y": y, "z": z}
        meta = dict(node.get("metadata") or {})
        pref_match = _best_anchor_for_node(node.get("path", ""), prefs_by_path)
        if pref_match:
            _, pref = pref_match
            meta["constellation_id"] = pref.get("constellation_id")
            meta["constellation_anchor"] = pref_match[0]
            meta["constellation_status"] = pref.get("status")
        node["metadata"] = meta

    return graph


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
