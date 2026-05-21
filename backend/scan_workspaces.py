#!/usr/bin/env python3
"""
scan_workspaces.py - Versión semántica y optimizada
"""

import json
import logging
import re
from pathlib import Path
from collections import deque
from typing import Dict, Any, List

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
            
            graph["nodes"].append({
                "id": node_id, "type": "folder", "label": current_path.name,
                "path": str(current_path), "metadata": {"depth": depth},
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
                "label": label, "path": str(current_path),
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

    # Resolve co-location relationships
    for folder_path, file_ids in folder_files.items():
        if 2 <= len(file_ids) <= 20:
            for i in range(len(file_ids)):
                for j in range(i + 1, len(file_ids)):
                    graph["edges"].append({
                        "source": file_ids[i],
                        "target": file_ids[j],
                        "type": "co-located",
                        "weight": 0.2
                    })

    if file_count >= max_files:
        logger.warning("Escaneo truncado: se alcanzó el límite de %d archivos", max_files)

    return graph


if __name__ == "__main__":
    g = scan_workspaces()
    print(json.dumps(g, indent=2))