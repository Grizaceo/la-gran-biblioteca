"""overview.py — resumen compacto del grafo para MCP tool y endpoint HTTP."""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any


def build_overview(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    recent_imports: list[str] | None = None,
    workspace_root: Path | None = None,
) -> dict[str, Any]:
    """Return a token-efficient summary of the graph state."""
    by_type: Counter = Counter()
    workspace_counts: Counter = Counter()

    root = workspace_root or (Path.home() / ".hermes" / "workspaces")

    for node in nodes:
        by_type[node.get("type", "unknown")] += 1
        path_str = node.get("path", "")
        if path_str:
            try:
                rel = Path(path_str).relative_to(root)
                ws = rel.parts[0] if rel.parts else "root"
            except ValueError:
                ws = "external"
            workspace_counts[ws] += 1

    top_workspaces = [
        {"workspace": ws, "nodes": count} for ws, count in workspace_counts.most_common(10)
    ]

    recent: list[str] = []
    if recent_imports:
        for p in reversed(recent_imports[-10:]):
            try:
                rel = str(Path(p).relative_to(root))
            except ValueError:
                rel = p
            recent.append(rel)

    note_inline = 0
    note_vault = 0
    for node in nodes:
        if node.get("type") != "note":
            continue
        meta = node.get("metadata") or {}
        if meta.get("storage") == "inline":
            note_inline += 1
        else:
            note_vault += 1

    return {
        "total_nodes": len(nodes),
        "total_edges": len(edges),
        "by_type": dict(by_type),
        "top_workspaces": top_workspaces,
        "recent_imports": recent,
        "workspace_root": str(root),
        "notes": {
            "inline": note_inline,
            "vault": note_vault,
            "total": note_inline + note_vault,
        },
    }
