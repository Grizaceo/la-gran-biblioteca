#!/usr/bin/env python3
"""
scan_workspaces.py - Versión semántica y optimizada
"""

import json
import logging
import os
import re
from pathlib import Path
from collections import deque
from typing import Dict, Any, List, Iterable, Optional

from .constants import WORKSPACE_ROOT, EXCLUDE_DIRS, SCAN_EXTENSIONS

logger = logging.getLogger(__name__)


def get_node_type(filepath: Path) -> str:
    ext = filepath.suffix.lower()
    if filepath.name.lower() == "readme.md":
        return "index"
    type_map = {
        ".md": "document", ".py": "script", ".ts": "typescript",
        ".js": "javascript", ".json": "config", ".txt": "text",
        ".yaml": "config", ".yml": "config"
    }
    return type_map.get(ext, "file")


def should_scan(filepath: Path) -> bool:
    if filepath.name.startswith("."):
        return False
    return filepath.suffix.lower() in SCAN_EXTENSIONS or filepath.is_dir()


def parse_frontmatter(content: str) -> dict:
    match = re.match(r"^---\n([\s\S]*?)\n---", content)
    if not match:
        return {}
    
    fm = {}
    lines = match.group(1).split("\n")
    for line in lines:
        if ":" not in line:
            continue
        colon_idx = line.index(":")
        key = line[:colon_idx].strip()
        value = line[colon_idx + 1:].strip()
        
        # Parse arrays [a, b]
        if value.startswith("[") and value.endswith("]"):
            value = [s.strip().strip("'\"") for s in value[1:-1].split(",") if s.strip()]
        else:
            value = value.strip("'\"")
        
        fm[key] = value
    return fm


def extract_wikilinks(content: str) -> list:
    # Match [[link]] or [[link|label]] or [[link#header]]
    # Regex: \[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]
    links = []
    matches = re.findall(r"\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]", content)
    for m in matches:
        links.append(m.strip())
    return list(dict.fromkeys(links))


def extract_tags(frontmatter: dict, content: str) -> list:
    tags = set()
    # From frontmatter
    fm_tags = frontmatter.get("tags")
    if fm_tags:
        if isinstance(fm_tags, list):
            for t in fm_tags:
                tags.add(t.lstrip("#"))
        else:
            tags.add(str(fm_tags).lstrip("#"))
            
    # From content inline tags (e.g., #tag-name)
    inline_matches = re.finditer(r"(?<!\S)#([a-zA-Z0-9_/\-áéíóúñüÁÉÍÓÚÑÜ]+)", content)
    for match in inline_matches:
        tags.add(match.group(1))
    return list(tags)


def scan_workspaces(
    root: Path = WORKSPACE_ROOT,
    max_files: int = 5000,
    max_children: int = 50,
) -> Dict[str, Any]:
    graph = {"nodes": [], "edges": []}
    node_map = {}
    
    # Semantic resolution structures
    name_to_id = {}
    pending_wikilinks = []
    created_tags = {}
    folder_files = {}

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
            # Saltar directorios excluidos
            if current_path.name in EXCLUDE_DIRS:
                continue
            
            rel = current_path.relative_to(root)
            node_id = f"folder_{rel}" if str(rel) != "." else "folder_dot"
            
            stored_path = str((root / rel).resolve())
            graph["nodes"].append({
                "id": node_id, "type": "folder", "label": current_path.name,
                "path": stored_path, "metadata": {"depth": depth},
                "position": {"x": x, "y": y}
            })
            node_map[str(current_path)] = node_id
            
            if depth > 0 and str(current_path.parent) in node_map:
                graph["edges"].append({
                    "source": node_map[str(current_path.parent)],
                    "target": node_id, "type": "contains"
                })
            
            # Children limitados
            try:
                children = [p for p in current_path.iterdir() if should_scan(p)]
                if len(children) > max_children:
                    logger.warning(
                        "Truncado: %s tiene %d hijos escaneables (max %d)",
                        current_path, len(children), max_children
                    )
                for idx, child in enumerate(sorted(children, key=lambda p: p.name)[:max_children]):
                    queue.append((child, depth + 1, x, y, idx))
            except (PermissionError, OSError) as e:
                logger.warning("No se pudo escanear %s: %s", current_path, e)
        else:
            file_count += 1
            rel = current_path.relative_to(root)
            node_id = f"file_{rel}"
            
            size = 0
            try:
                size = current_path.stat().st_size
            except (PermissionError, OSError) as e:
                logger.warning("No se pudo leer tamaño de %s: %s", current_path, e)
            
            # Content-based parsing for markdown files
            frontmatter = {}
            wikilinks = []
            tags = []
            
            if current_path.suffix.lower() == ".md":
                try:
                    # Let's read small files to parse semantics
                    if size < 2 * 1024 * 1024:  # 2MB Limit
                        with open(current_path, "r", encoding="utf-8", errors="ignore") as f:
                            content = f.read()
                        frontmatter = parse_frontmatter(content)
                        wikilinks = extract_wikilinks(content)
                        tags = extract_tags(frontmatter, content)
                except Exception as e:
                    logger.warning("No se pudo parsear contenido de %s: %s", current_path, e)

            # Node metadata hydration
            metadata = {"size": size, "depth": depth}
            if frontmatter:
                metadata["frontmatter"] = frontmatter
            if tags:
                metadata["tags"] = tags
                
            label = current_path.name
            if frontmatter.get("title"):
                label = frontmatter["title"]
            
            graph["nodes"].append({
                "id": node_id, "type": get_node_type(current_path),
                "label": label, "path": str((root / rel).resolve()),
                "metadata": metadata,
                "position": {"x": x, "y": y}
            })
            node_map[str(current_path)] = node_id
            
            # Register for wikilink resolution
            name_to_id[current_path.name] = node_id
            name_to_id[current_path.stem] = node_id
            name_to_id[str(rel)] = node_id
            
            # Register for co-location
            parent_str = str(current_path.parent)
            if parent_str not in folder_files:
                folder_files[parent_str] = []
            folder_files[parent_str].append(node_id)
            
            # Add to pending wikilinks
            for link in wikilinks:
                pending_wikilinks.append((node_id, link))
                
            # Process and attach tags
            for tag in tags:
                tag_id = f"tag_{tag}"
                if tag_id not in created_tags:
                    tag_node = {
                        "id": tag_id, "type": "tag", "label": f"#{tag}",
                        "path": "", "metadata": {"is_tag": True},
                        "position": {"x": x, "y": y + 40}
                    }
                    graph["nodes"].append(tag_node)
                    created_tags[tag_id] = tag_node
                
                graph["edges"].append({
                    "source": node_id,
                    "target": tag_id,
                    "type": "tagged",
                    "weight": 0.3
                })
            
            parent_id = node_map.get(str(current_path.parent))
            if parent_id:
                graph["edges"].append({
                    "source": parent_id, "target": node_id, "type": "contains"
                })

    # Resolve pending wikilinks (exact or fuzzy matches)
    for source_id, target_name in pending_wikilinks:
        target_id = name_to_id.get(target_name)
        if not target_id:
            # Try fuzzy match
            target_lower = target_name.lower()
            for key, val in name_to_id.items():
                if key.lower() == target_lower or target_lower in key.lower() or key.lower() in target_lower:
                    target_id = val
                    break
        
        if target_id:
            graph["edges"].append({
                "source": source_id,
                "target": target_id,
                "type": "references",
                "weight": 1.0
            })

    # Resolve co-location relationships (clique or star when LGB_COLOCATED_MAX is set)
    colocated_max = int(os.environ.get("LGB_COLOCATED_MAX", "0"))
    for folder_path, file_ids in folder_files.items():
        if 2 <= len(file_ids) <= 20:
            if colocated_max > 0 and len(file_ids) > colocated_max:
                hub = file_ids[0]
                for fid in file_ids[1:]:
                    graph["edges"].append({
                        "source": hub,
                        "target": fid,
                        "type": "co-located",
                        "weight": 0.2,
                    })
            else:
                for i in range(len(file_ids)):
                    for j in range(i + 1, len(file_ids)):
                        graph["edges"].append({
                            "source": file_ids[i],
                            "target": file_ids[j],
                            "type": "co-located",
                            "weight": 0.2,
                        })

    if file_count >= max_files:
        logger.warning("Escaneo truncado: se alcanzó el límite de %d archivos", max_files)

    return graph


def _posix_rel(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def _folder_node_id(rel_posix: str) -> str:
    return "folder_dot" if rel_posix == "." else f"folder_{rel_posix}"


def _file_node_id(rel_posix: str) -> str:
    return f"file_{rel_posix}"


def merge_scan_graphs(base: Dict[str, Any], extra: Dict[str, Any]) -> Dict[str, Any]:
    """Merge nodes by id; dedupe edges by (source, target, type)."""
    nodes_by_id = {n["id"]: n for n in base.get("nodes", [])}
    for n in extra.get("nodes", []):
        nodes_by_id[n["id"]] = n
    edge_keys: set[tuple] = set()
    edges: List[Dict[str, Any]] = []
    for e in base.get("edges", []) + extra.get("edges", []):
        key = (e["source"], e["target"], e["type"])
        if key in edge_keys:
            continue
        edge_keys.add(key)
        edges.append(e)
    return {"nodes": list(nodes_by_id.values()), "edges": edges}


def _import_island_origin(subroot: Path) -> tuple[float, float]:
    """Separate imported repos from the main vault cluster at (0,0)."""
    slot = abs(hash(subroot.name)) % 48
    return (4200.0 + slot * 220.0, 4200.0 + (slot % 9) * 180.0)


def _append_folder_node(
    graph: Dict[str, Any],
    node_map: Dict[str, str],
    folder: Path,
    root: Path,
    depth: int,
    *,
    position: Optional[Dict[str, float]] = None,
) -> str:
    rel = _posix_rel(folder, root)
    node_id = _folder_node_id(rel)
    folder_key = str(folder.resolve())
    if folder_key in node_map:
        return node_map[folder_key]
    stored_path = str(folder.resolve())
    pos = position if position is not None else {"x": 0, "y": depth * 150}
    graph["nodes"].append({
        "id": node_id,
        "type": "folder",
        "label": folder.name if rel != "." else root.name,
        "path": stored_path,
        "metadata": {"depth": depth},
        "position": pos,
    })
    node_map[str(folder.resolve())] = node_id
    if folder.parent != folder:
        parent_id = node_map.get(str(folder.parent.resolve()))
        if parent_id:
            graph["edges"].append({
                "source": parent_id,
                "target": node_id,
                "type": "contains",
            })
    return node_id


def _append_file_node(
    graph: Dict[str, Any],
    node_map: Dict[str, str],
    filepath: Path,
    root: Path,
    depth: int,
    *,
    position: Optional[Dict[str, float]] = None,
) -> str:
    rel_posix = _posix_rel(filepath, root)
    node_id = _file_node_id(rel_posix)
    size = 0
    try:
        size = filepath.stat().st_size
    except (PermissionError, OSError) as e:
        logger.warning("No se pudo leer tamaño de %s: %s", filepath, e)

    frontmatter: dict = {}
    tags: list = []
    if filepath.suffix.lower() == ".md":
        try:
            if size < 2 * 1024 * 1024:
                with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                frontmatter = parse_frontmatter(content)
                tags = extract_tags(frontmatter, content)
        except Exception as e:
            logger.warning("No se pudo parsear contenido de %s: %s", filepath, e)

    metadata: Dict[str, Any] = {"size": size, "depth": depth}
    if frontmatter:
        metadata["frontmatter"] = frontmatter
    if tags:
        metadata["tags"] = tags

    label = filepath.name
    if frontmatter.get("title"):
        label = frontmatter["title"]

    pos = position if position is not None else {"x": 0, "y": depth * 150}
    graph["nodes"].append({
        "id": node_id,
        "type": get_node_type(filepath),
        "label": label,
        "path": str(filepath.resolve()),
        "metadata": metadata,
        "position": pos,
    })
    node_map[str(filepath.resolve())] = node_id

    parent_id = node_map.get(str(filepath.parent.resolve()))
    if parent_id:
        graph["edges"].append({
            "source": parent_id,
            "target": node_id,
            "type": "contains",
        })

    for tag in tags:
        tag_id = f"tag_{tag}"
        if not any(n["id"] == tag_id for n in graph["nodes"]):
            graph["nodes"].append({
                "id": tag_id,
                "type": "tag",
                "label": f"#{tag}",
                "path": "",
                "metadata": {"is_tag": True},
                "position": {"x": 0, "y": depth * 150 + 40},
            })
        graph["edges"].append({
            "source": node_id,
            "target": tag_id,
            "type": "tagged",
            "weight": 0.3,
        })

    return node_id


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
    """BFS under a single imported folder so global SCAN_MAX_FILES does not skip it."""
    island_x, island_y = _import_island_origin(subroot)
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
            if current_path.name in EXCLUDE_DIRS:
                continue
            _append_folder_node(
                graph, node_map, current_path, workspace_root, depth, position=pos
            )
            try:
                children = [p for p in current_path.iterdir() if should_scan(p)]
                for idx, child in enumerate(sorted(children, key=lambda p: p.name)[:max_children]):
                    queue.append((child, depth + 1, idx))
            except (PermissionError, OSError) as e:
                logger.warning("No se pudo escanear import %s: %s", current_path, e)
        else:
            file_count += 1
            _append_file_node(
                graph, node_map, current_path, workspace_root, depth, position=pos
            )


def scan_import_paths(
    paths: Iterable[Path],
    root: Path = WORKSPACE_ROOT,
) -> Dict[str, Any]:
    """
    Scan specific imported files and their parent folders.
    Used when the global scan hits SCAN_MAX_FILES before reaching new imports.
    """
    root = root.resolve()
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


def node_id_for_import_dir(path: Path, root: Path = WORKSPACE_ROOT) -> str:
    """Graph node id for an imported folder under workspace root."""
    rel = _posix_rel(Path(path), root)
    return _folder_node_id(rel)


def node_id_for_import_path(path: Path, root: Path = WORKSPACE_ROOT) -> str:
    """Predict graph node id for a file under workspace root."""
    rel = _posix_rel(Path(path), root)
    return _file_node_id(rel)


if __name__ == "__main__":
    g = scan_workspaces()
    print(json.dumps(g, indent=2))