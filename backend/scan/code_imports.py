"""Lightweight import extraction for Python and TS/JS files."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .layout import file_node_id

_PY_FROM = re.compile(r"^\s*from\s+([\w.]+)\s+import", re.MULTILINE)
_PY_IMPORT = re.compile(r"^\s*import\s+([\w.]+)", re.MULTILINE)
_TS_IMPORT = re.compile(
    r"""^\s*import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]""",
    re.MULTILINE,
)
_JS_REQUIRE = re.compile(r"""require\s*\(\s*['"]([^'"]+)['"]\s*\)""")


def _resolve_import_module(
    module: str,
    source_rel: str,
    root: Path,
    rel_to_id: dict[str, str],
) -> str | None:
    """Map import string to file_* node id within vault."""
    mod = module.strip().strip("./")
    if not mod or mod.startswith("."):
        base = Path(source_rel).parent
        parts = mod.replace("\\", "/").split("/")
        candidate = base
        for part in parts:
            if part == "..":
                candidate = candidate.parent
            elif part and part != ".":
                candidate = candidate / part
        for ext in ("", ".py", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"):
            rel = (candidate.as_posix() + ext).lstrip("/")
            nid = rel_to_id.get(rel)
            if nid:
                return nid
        return None

    parts = mod.split(".")
    rel_py = "/".join(parts) + ".py"
    rel_init = "/".join(parts) + "/__init__.py"
    for rel in (rel_py, rel_init, "/".join(parts) + ".ts", "/".join(parts) + "/index.ts"):
        nid = rel_to_id.get(rel)
        if nid:
            return nid
    return None


def extract_imports(path: Path, content: str) -> list[str]:
    ext = path.suffix.lower()
    if ext == ".py":
        mods: list[str] = []
        mods.extend(_PY_FROM.findall(content))
        mods.extend(_PY_IMPORT.findall(content))
        return list(dict.fromkeys(mods))
    if ext in (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"):
        mods = _TS_IMPORT.findall(content)
        mods.extend(_JS_REQUIRE.findall(content))
        return [m for m in mods if not m.startswith("@types/")]
    return []


def apply_code_imports(graph: dict[str, Any], root: Path) -> dict[str, Any]:
    """Add depends_on edges from lightweight import parsing."""
    rel_to_id: dict[str, str] = {}
    path_by_id: dict[str, str] = {}

    for node in graph.get("nodes", []):
        path_str = node.get("path") or ""
        if not path_str:
            continue
        try:
            rel = Path(path_str).resolve().relative_to(root.resolve()).as_posix()
        except (OSError, ValueError):
            continue
        rel_to_id[rel] = node["id"]
        path_by_id[node["id"]] = rel

    seen_edges: set[tuple[str, str]] = set()

    for node in graph.get("nodes", []):
        path_str = node.get("path") or ""
        if not path_str:
            continue
        p = Path(path_str)
        ext = p.suffix.lower()
        if ext not in (".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"):
            continue
        try:
            if p.stat().st_size > 512 * 1024:
                continue
            content = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        source_id = node["id"]
        source_rel = path_by_id.get(source_id, "")
        for mod in extract_imports(p, content):
            target_id = _resolve_import_module(mod, source_rel, root, rel_to_id)
            if not target_id or target_id == source_id:
                continue
            key = (source_id, target_id)
            if key in seen_edges:
                continue
            seen_edges.add(key)
            graph["edges"].append(
                {
                    "source": source_id,
                    "target": target_id,
                    "type": "depends_on",
                    "weight": 0.6,
                    "metadata": {"module": mod},
                }
            )

    return graph
