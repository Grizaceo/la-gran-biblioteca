#!/usr/bin/env python3
"""
scan_workspaces.py - Versión rápida sin hashes
"""

import json
import logging
from pathlib import Path
from collections import deque
from typing import Dict, Any

from .constants import WORKSPACE_ROOT, EXCLUDE_DIRS, SCAN_EXTENSIONS

logger = logging.getLogger(__name__)


def get_node_type(filepath: Path) -> str:
    ext = filepath.suffix.lower()
    if filepath.name.lower() == "readme.md":
        return "index"
    type_map = {
        ".md": "document", ".py": "script", ".ts": "typescript",
        ".js": "javascript", ".json": "config", ".txt": "text",
    }
    return type_map.get(ext, "file")


def should_scan(filepath: Path) -> bool:
    if filepath.name.startswith("."):
        return False
    return filepath.suffix.lower() in SCAN_EXTENSIONS or filepath.is_dir()


def scan_workspaces(
    root: Path = WORKSPACE_ROOT,
    max_files: int = 5000,
    max_children: int = 50,
) -> Dict[str, Any]:
    graph = {"nodes": [], "edges": []}
    node_map = {}

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
            
            graph["nodes"].append({
                "id": node_id, "type": get_node_type(current_path),
                "label": current_path.name, "path": str(current_path),
                "metadata": {"size": size, "depth": depth},
                "position": {"x": x, "y": y}
            })
            node_map[str(current_path)] = node_id
            
            parent_id = node_map.get(str(current_path.parent))
            if parent_id:
                graph["edges"].append({
                    "source": parent_id, "target": node_id, "type": "contains"
                })

    if file_count >= max_files:
        logger.warning("Escaneo truncado: se alcanzó el límite de %d archivos", max_files)

    return graph


if __name__ == "__main__":
    g = scan_workspaces()
    print(json.dumps(g, indent=2))