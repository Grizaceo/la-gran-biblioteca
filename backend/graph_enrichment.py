"""Graph metadata enrichment and structural summaries."""

from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


_GENERIC_TOPIC_PARTS = {
    "index",
    "readme",
    "docs",
    "doc",
    "notes",
    "note",
    "src",
    "lib",
    "app",
    "apps",
    "data",
    "assets",
    "public",
    "private",
    "generated",
    "imports",
    "backend",
    "frontend",
    "folder",
    "file",
}

_ROLE_KEYWORDS: list[tuple[str, set[str]]] = [
    ("imports", {"imports", "import", "github", "arxiv", "pubmed"}),
    ("papers", {"paper", "papers", "arxiv", "pubmed", "research"}),
    ("source", {"src", "source", "app", "apps", "lib", "pkg", "code"}),
    ("docs", {"docs", "documentation", "wiki", "manual", "guide", "readme"}),
    ("notes", {"notes", "zettel", "knowledge", "journal", "vault"}),
    ("config", {"config", "configs", "settings", "env", "yaml", "json", "toml"}),
    ("assets", {"assets", "images", "img", "media", "static"}),
    ("generated", {"dist", "build", "out", "generated", "export"}),
]

_EXT_ROLE_HINTS = {
    ".py": "source",
    ".ts": "source",
    ".tsx": "source",
    ".js": "source",
    ".jsx": "source",
    ".rs": "source",
    ".go": "source",
    ".java": "source",
    ".md": "notes",
    ".txt": "notes",
    ".yaml": "config",
    ".yml": "config",
    ".json": "config",
    ".toml": "config",
    ".png": "assets",
    ".jpg": "assets",
    ".jpeg": "assets",
    ".svg": "assets",
    ".gif": "assets",
    ".pdf": "papers",
}


def _safe_relative(path_str: str, root: Path) -> Path | None:
    if not path_str:
        return None
    try:
        return Path(path_str).resolve().relative_to(root.resolve())
    except (OSError, ValueError):
        return None


def _folder_depth_bucket(depth: int) -> str:
    if depth <= 1:
        return "root"
    if depth <= 3:
        return "mid"
    return "deep"


def _normalize_topic_token(raw: str) -> str | None:
    token = (
        raw.strip()
        .lower()
        .replace("\\", "/")
        .replace("-", "_")
        .replace(".", "_")
        .replace(" ", "_")
    )
    token = "".join(ch for ch in token if ch.isalnum() or ch in {"_", "/"})
    if not token or token in _GENERIC_TOPIC_PARTS or len(token) < 3:
        return None
    return token


def _collect_topics(node: dict[str, Any], rel: Path | None) -> list[str]:
    meta = dict(node.get("metadata") or {})
    frontmatter = meta.get("frontmatter") or {}
    topics: set[str] = set()

    for tag in meta.get("tags") or []:
        normalized = _normalize_topic_token(str(tag))
        if normalized:
            topics.add(normalized)

    fm_topic_keys = ("topic", "topics", "category", "categories", "keywords")
    for key in fm_topic_keys:
        value = frontmatter.get(key)
        if isinstance(value, list):
            values = value
        elif value:
            values = [value]
        else:
            values = []
        for item in values:
            normalized = _normalize_topic_token(str(item))
            if normalized:
                topics.add(normalized)

    if rel:
        for part in rel.parts[:-1]:
            normalized = _normalize_topic_token(part)
            if normalized:
                topics.add(normalized)

    label = str(node.get("label") or "")
    for token in label.replace("/", " ").replace("-", " ").split():
        normalized = _normalize_topic_token(token)
        if normalized:
            topics.add(normalized)

    return sorted(topics)[:12]


def _structural_role(
    node_type: str,
    label: str,
    rel: Path | None,
    ext: str,
    is_import: bool,
    is_index: bool,
) -> str:
    if is_import:
        return "imports"
    blob_parts = [label.lower(), node_type.lower(), ext.lower()]
    if rel:
        blob_parts.extend(part.lower() for part in rel.parts)
    blob = set(blob_parts)
    rel_parts = set(part.lower() for part in rel.parts) if rel else set()

    if is_index:
        return "docs" if ext == ".md" else "source"

    for role, keywords in _ROLE_KEYWORDS:
        if blob & keywords or rel_parts & keywords:
            return role

    ext_hint = _EXT_ROLE_HINTS.get(ext.lower())
    if ext_hint:
        return ext_hint

    if node_type == "folder":
        return "docs" if rel and len(rel.parts) <= 2 else "notes"
    return "notes" if ext in {".md", ".txt"} else "source"


def enrich_graph_metadata(graph: dict[str, Any], workspace_root: Path) -> dict[str, Any]:
    """Populate stable metadata fields and structural metrics."""
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    in_degree: Counter[str] = Counter()
    out_degree: Counter[str] = Counter()
    child_count: Counter[str] = Counter()

    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if source:
            out_degree[source] += 1
        if target:
            in_degree[target] += 1
        if edge.get("type") == "contains" and source:
            child_count[source] += 1

    for node in nodes:
        meta = dict(node.get("metadata") or {})
        rel = _safe_relative(str(node.get("path") or ""), workspace_root)
        depth = int(meta.get("depth") or 0)
        ext = Path(str(node.get("path") or "")).suffix.lower()
        workspace = ""
        parent_folder = ""
        if rel:
            workspace = rel.parts[0] if rel.parts else "root"
            if len(rel.parts) > 1:
                parent_folder = rel.parent.as_posix()
            elif node.get("type") != "folder":
                parent_folder = workspace
        is_import = bool(rel and rel.parts and rel.parts[0] == "imports")
        is_index = str(Path(str(node.get("path") or "")).name).lower() in {"readme.md", "index.md"}
        topics = _collect_topics(node, rel)
        study_count = int(meta.get("study_count") or 0)
        total_in = int(in_degree.get(node.get("id"), 0))
        total_out = int(out_degree.get(node.get("id"), 0))
        degree = total_in + total_out

        meta.update(
            {
                "workspace": workspace,
                "parent_folder": parent_folder,
                "extension": ext,
                "is_import": is_import,
                "is_index": is_index,
                "degree_hint": degree,
                "in_degree": total_in,
                "out_degree": total_out,
                "child_count": int(child_count.get(node.get("id"), 0)),
                "folder_depth_bucket": _folder_depth_bucket(depth),
                "tag_count": len(meta.get("tags") or []),
                "topics": topics,
                "study_score": study_count * 3 + min(degree, 10) + len(topics),
                "structural_role": _structural_role(
                    str(node.get("type") or ""),
                    str(node.get("label") or ""),
                    rel,
                    ext,
                    is_import,
                    is_index,
                ),
            }
        )
        node["metadata"] = meta
        node["degree"] = degree

    return graph


def build_graph_structure_summary(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    workspace_root: Path,
) -> dict[str, Any]:
    """Aggregate graph structure for overview panels and minimap."""
    workspace_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    folder_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    topic_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    topic_counts: Counter[str] = Counter()

    for node in nodes:
        meta = node.get("metadata") or {}
        workspace = str(meta.get("workspace") or "")
        if workspace:
            workspace_groups[workspace].append(node)
        parent_folder = str(meta.get("parent_folder") or "")
        if parent_folder:
            folder_groups[parent_folder].append(node)
        for topic in meta.get("topics") or []:
            topic_groups[str(topic)].append(node)
            topic_counts[str(topic)] += 1

    def summarize_group(key: str, members: list[dict[str, Any]], *, label: str | None = None) -> dict[str, Any]:
        count = len(members)
        if count == 0:
            return {"key": key, "label": label or key, "count": 0}
        degree_sum = sum(int(n.get("degree") or 0) for n in members)
        studied_count = sum(1 for n in members if int((n.get("metadata") or {}).get("study_count") or 0) > 0)
        sample_node_ids = [str(n.get("id")) for n in sorted(
            members,
            key=lambda n: (int(n.get("degree") or 0), int((n.get("metadata") or {}).get("study_score") or 0)),
            reverse=True,
        )[:5]]
        centers = [n.get("position") or {} for n in members]
        valid = [p for p in centers if "x" in p and "y" in p]
        centroid = {
            "x": sum(float(p.get("x", 0)) for p in valid) / len(valid) if valid else 0.0,
            "y": sum(float(p.get("y", 0)) for p in valid) / len(valid) if valid else 0.0,
        }
        return {
            "key": key,
            "label": label or key,
            "count": count,
            "degree_sum": degree_sum,
            "studied_count": studied_count,
            "sample_node_ids": sample_node_ids,
            "centroid": centroid,
        }

    workspaces = [
        summarize_group(ws, members, label=ws)
        for ws, members in sorted(workspace_groups.items(), key=lambda item: (-len(item[1]), item[0]))
    ]

    folders = [
        summarize_group(folder, members, label=Path(folder).name or folder)
        for folder, members in sorted(
            folder_groups.items(),
            key=lambda item: (-len(item[1]), -sum(int(n.get("degree") or 0) for n in item[1]), item[0]),
        )[:40]
    ]

    topics = [
        summarize_group(topic, members, label=topic.replace("_", " "))
        for topic, members in topic_groups.items()
        if topic_counts[topic] >= 2
    ]
    topics.sort(key=lambda item: (-item["count"], item["label"]))
    topics = topics[:30]

    role_counts = Counter(str((node.get("metadata") or {}).get("structural_role") or "unknown") for node in nodes)

    return {
        "workspace_root": str(workspace_root),
        "total_nodes": len(nodes),
        "total_edges": len(edges),
        "modes": {
            "workspace": workspaces,
            "folder": folders,
            "topic": topics,
        },
        "legend": {
            "workspaces": [{"key": item["key"], "count": item["count"]} for item in workspaces[:12]],
            "topics": [{"key": item["key"], "count": item["count"]} for item in topics[:12]],
            "roles": dict(role_counts),
        },
    }
