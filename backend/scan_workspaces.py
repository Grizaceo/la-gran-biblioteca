#!/usr/bin/env python3
"""
scan_workspaces.py - Versión rápida sin hashes
"""

import os
import json
from pathlib import Path
from collections import deque
from typing import Dict, Any

WORKSPACE_ROOT = Path.home() / ".hermes" / "workspaces"

# Directorios a excluir
EXCLUDE_DIRS = {".hermes", "__pycache__", "node_modules", ".git", "archive", "backups", "snapshots"}

# Extensiones importantes
SCAN_EXTENSIONS = {".md", ".py", ".ts", ".js", ".json", ".txt", ".yaml", ".yml"}


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


def scan_workspaces(root: Path = WORKSPACE_ROOT) -> Dict[str, Any]:
    graph = {"nodes": [], "edges": []}
    node_map = {}
    
    queue = deque()
    queue.append((root, 0, 0, 0, 0))
    
    sibling_x_spacing = 150
    y_spacing = 150
    file_count = 0
    
    while queue and file_count < 2000:
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
                for idx, child in enumerate(sorted(children, key=lambda p: p.name)[:30]):
                    queue.append((child, depth + 1, x, y, idx))
            except:
                pass
        else:
            file_count += 1
            rel = current_path.relative_to(root)
            node_id = f"file_{rel}"
            
            size = 0
            try:
                size = current_path.stat().st_size
            except:
                pass
            
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
    
    return graph


if __name__ == "__main__":
    g = scan_workspaces()
    print(json.dumps(g, indent=2))