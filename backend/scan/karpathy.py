"""Karpathy-style wiki enrichment: index.md sections, wikilinks, backlinks, tours."""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

from .layout import file_node_id
from .markdown import extract_wikilinks

logger = logging.getLogger(__name__)

_WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]")
_SECTION_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)

_karpathy_stats: dict[str, Any] = {
    "wiki_pattern": None,
    "unresolved_wikilinks": [],
    "categories": [],
    "workspaces_karpathy": [],
}


def consume_karpathy_stats() -> dict[str, Any]:
    global _karpathy_stats
    out = dict(_karpathy_stats)
    _karpathy_stats = {
        "wiki_pattern": None,
        "unresolved_wikilinks": [],
        "categories": [],
        "workspaces_karpathy": [],
    }
    return out


def _topic_node_id(workspace_rel: str, section: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", section.lower()).strip("_") or "section"
    return f"topic_{workspace_rel}_{slug}"


def detect_karpathy_workspace(ws_dir: Path) -> bool:
    """True when workspace has index.md and at least one other .md file."""
    index = ws_dir / "index.md"
    if not index.is_file():
        return False
    md_count = 0
    for p in ws_dir.rglob("*.md"):
        if p.name.startswith("."):
            continue
        md_count += 1
        if md_count >= 2:
            return True
    return False


def _build_link_maps(
    graph: dict[str, Any],
    root: Path,
) -> tuple[dict[str, str], dict[str, list[str]], dict[str, str]]:
    """stem/basename/rel maps for wikilink resolution."""
    stem_map: dict[str, list[str]] = {}
    basename_map: dict[str, list[str]] = {}
    path_to_id: dict[str, str] = {}

    for node in graph.get("nodes", []):
        path_str = node.get("path") or ""
        if not path_str or node.get("type") in ("tag", "topic"):
            continue
        try:
            rel = Path(path_str).resolve().relative_to(root.resolve()).as_posix()
        except (OSError, ValueError):
            continue
        nid = node["id"]
        path_to_id[rel] = nid
        path_to_id[file_node_id(rel)] = nid
        stem = Path(rel).stem.lower()
        base = Path(rel).name.lower()
        stem_map.setdefault(stem, []).append(nid)
        basename_map.setdefault(base, []).append(nid)
        if rel.endswith(".md"):
            stem_map.setdefault(stem, []).append(nid)

    name_to_id: dict[str, str] = {}
    for node in graph.get("nodes", []):
        path_str = node.get("path") or ""
        if path_str:
            try:
                rel = Path(path_str).resolve().relative_to(root.resolve()).as_posix()
                name_to_id[rel] = node["id"]
                name_to_id[Path(rel).name] = node["id"]
                name_to_id[Path(rel).stem] = node["id"]
            except (OSError, ValueError):
                pass
        label = node.get("label") or ""
        if label:
            name_to_id[label] = node["id"]

    return name_to_id, stem_map, basename_map


def resolve_wikilink_target(
    link: str,
    source_path: str,
    root: Path,
    name_to_id: dict[str, str],
    stem_map: dict[str, list[str]],
    basename_map: dict[str, list[str]],
) -> str | None:
    """Resolve a wikilink to a node id (stem map + basename disambiguation)."""
    raw = link.strip().strip("/")
    if not raw:
        return None

    if raw in name_to_id:
        return name_to_id[raw]

    candidates: list[str] = []
    if "/" in raw:
        rel = raw if raw.endswith(".md") else f"{raw}.md"
        try:
            full = (root / rel).resolve()
            rel_posix = full.relative_to(root.resolve()).as_posix()
            nid = name_to_id.get(rel_posix) or name_to_id.get(file_node_id(rel_posix))
            if nid:
                return nid
        except (OSError, ValueError):
            pass

    stem = Path(raw).stem.lower()
    if stem in stem_map:
        candidates = stem_map[stem]
    elif raw.lower() in basename_map:
        candidates = basename_map[raw.lower()]
    elif f"{raw}.md".lower() in basename_map:
        candidates = basename_map[f"{raw}.md".lower()]

    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1 and source_path:
        try:
            src_rel = Path(source_path).resolve().relative_to(root.resolve())
            src_dir = src_rel.parent.as_posix()
            for nid in candidates:
                for node_path, node_id in ((k, v) for k, v in name_to_id.items() if v == nid):
                    if "/" not in node_path or not node_path.endswith(".md"):
                        continue
                    try:
                        nrel = (
                            Path(node_path).relative_to(root.resolve())
                            if Path(node_path).is_absolute()
                            else Path(node_path)
                        )
                        if nrel.parent.as_posix() == src_dir:
                            return nid
                    except (OSError, ValueError):
                        continue
        except (OSError, ValueError):
            pass
        return candidates[0]

    lower = raw.lower()
    for key, val in name_to_id.items():
        if key.lower() == lower:
            return val
    return None


def _first_summary(content: str, max_len: int = 240) -> str:
    lines = content.splitlines()
    title = ""
    body_start = 0
    for i, line in enumerate(lines):
        if line.startswith("# ") and not title:
            title = line[2:].strip()
            body_start = i + 1
            break
    para_lines: list[str] = []
    for line in lines[body_start:]:
        if line.startswith("#"):
            break
        if not line.strip():
            if para_lines:
                break
            continue
        para_lines.append(line.strip())
    text = " ".join(para_lines).strip() or title
    if len(text) > max_len:
        return text[: max_len - 1].rstrip() + "…"
    return text


def _parse_index_sections(index_path: Path) -> list[dict[str, Any]]:
    try:
        content = index_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return []
    sections: list[dict[str, Any]] = []
    matches = list(_SECTION_RE.finditer(content))
    for i, match in enumerate(matches):
        title = match.group(1).strip()
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        block = content[start:end]
        links = extract_wikilinks(block)
        sections.append({"title": title, "wikilinks": links, "order": i})
    return sections


def _compute_backlinks(graph: dict[str, Any]) -> None:
    refs = [e for e in graph.get("edges", []) if e.get("type") in ("references", "wikilink")]
    incoming: dict[str, list[dict[str, str]]] = {}
    id_to_label: dict[str, str] = {
        n["id"]: n.get("label") or n["id"] for n in graph.get("nodes", [])
    }
    for e in refs:
        tgt = e.get("target")
        src = e.get("source")
        if not tgt or not src:
            continue
        incoming.setdefault(tgt, []).append({"id": src, "label": id_to_label.get(src, src)})

    for node in graph.get("nodes", []):
        bl = incoming.get(node["id"])
        if bl:
            meta = dict(node.get("metadata") or {})
            meta["backlinks"] = bl[:50]
            node["metadata"] = meta


def _store_tour(engine: Any, workspace_key: str, steps: list[dict[str, Any]]) -> None:
    if hasattr(engine, "upsert_exploration_tour"):
        engine.upsert_exploration_tour(workspace_key, steps)


def apply_karpathy_scan(
    graph: dict[str, Any],
    root: Path,
    *,
    engine: Any | None = None,
) -> dict[str, Any]:
    """
    Post-process scan graph for Karpathy wikis under each top-level workspace.
    """
    global _karpathy_stats
    unresolved: list[str] = []
    categories: list[str] = []
    karpathy_workspaces: list[str] = []

    name_to_id, stem_map, basename_map = _build_link_maps(graph, root)

    pending: list[tuple[str, str, str]] = []
    for node in graph.get("nodes", []):
        path_str = node.get("path") or ""
        if not path_str or not str(path_str).endswith(".md"):
            continue
        try:
            p = Path(path_str)
            if p.stat().st_size > 2 * 1024 * 1024:
                continue
            content = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        summary = _first_summary(content)
        if summary:
            meta = dict(node.get("metadata") or {})
            if not meta.get("summary"):
                meta["summary"] = summary
                node["metadata"] = meta
        for link in extract_wikilinks(content):
            pending.append((node["id"], link, path_str))

    existing_refs = {
        (e["source"], e["target"])
        for e in graph.get("edges", [])
        if e.get("type") in ("references", "wikilink")
    }
    for source_id, link, source_path in pending:
        target_id = resolve_wikilink_target(
            link, source_path, root, name_to_id, stem_map, basename_map
        )
        if target_id:
            key = (source_id, target_id)
            if key not in existing_refs:
                existing_refs.add(key)
                graph["edges"].append(
                    {
                        "source": source_id,
                        "target": target_id,
                        "type": "references",
                        "weight": 1.0,
                        "metadata": {"wikilink": link},
                    }
                )
        else:
            unresolved.append(link)

    try:
        for ws_dir in sorted(root.iterdir()):
            if not ws_dir.is_dir() or ws_dir.name.startswith("."):
                continue
            if not detect_karpathy_workspace(ws_dir):
                continue
            ws_key = ws_dir.name
            karpathy_workspaces.append(ws_key)
            index_path = ws_dir / "index.md"
            sections = _parse_index_sections(index_path)
            ws_rel = ws_key
            tour_steps: list[dict[str, Any]] = []

            for section in sections:
                title = section["title"]
                categories.append(f"{ws_key}/{title}")
                topic_id = _topic_node_id(ws_rel, title)
                existing = any(n["id"] == topic_id for n in graph["nodes"])
                if not existing:
                    graph["nodes"].append(
                        {
                            "id": topic_id,
                            "type": "topic",
                            "label": title,
                            "path": "",
                            "metadata": {
                                "workspace": ws_key,
                                "karpathy_category": True,
                                "section_order": section["order"],
                            },
                            "position": {"x": 0, "y": 0},
                        }
                    )

                highlight_ids: list[str] = []
                for link in section["wikilinks"]:
                    tid = resolve_wikilink_target(
                        link,
                        str(index_path),
                        root,
                        name_to_id,
                        stem_map,
                        basename_map,
                    )
                    if tid:
                        graph["edges"].append(
                            {
                                "source": tid,
                                "target": topic_id,
                                "type": "categorized_under",
                                "weight": 0.8,
                            }
                        )
                        highlight_ids.append(tid)
                    else:
                        unresolved.append(link)

                if highlight_ids:
                    tour_steps.append(
                        {
                            "order": section["order"],
                            "title": title,
                            "highlight_node_ids": highlight_ids[:20],
                            "focus_node_id": highlight_ids[0],
                        }
                    )

            if tour_steps and engine is not None:
                _store_tour(engine, ws_key, tour_steps)

    except OSError as e:
        logger.warning("Karpathy scan partial failure: %s", e)

    _compute_backlinks(graph)

    pattern = "karpathy" if karpathy_workspaces else None
    _karpathy_stats = {
        "wiki_pattern": pattern,
        "unresolved_wikilinks": sorted(set(unresolved))[:100],
        "categories": categories[:80],
        "workspaces_karpathy": karpathy_workspaces,
    }
    return graph
