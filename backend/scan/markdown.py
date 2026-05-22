"""Markdown parsing: frontmatter, wikilinks, tags."""

from __future__ import annotations

import re
from pathlib import Path

from ..constants import SCAN_EXTENSIONS


def get_node_type(filepath: Path) -> str:
    ext = filepath.suffix.lower()
    if filepath.name.lower() == "readme.md":
        return "index"
    type_map = {
        ".md": "document",
        ".py": "script",
        ".ts": "typescript",
        ".js": "javascript",
        ".json": "config",
        ".txt": "text",
        ".yaml": "config",
        ".yml": "config",
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

    fm: dict = {}
    for line in match.group(1).split("\n"):
        if ":" not in line:
            continue
        colon_idx = line.index(":")
        key = line[:colon_idx].strip()
        value = line[colon_idx + 1 :].strip()

        if value.startswith("[") and value.endswith("]"):
            value = [s.strip().strip("'\"") for s in value[1:-1].split(",") if s.strip()]
        else:
            value = value.strip("'\"")

        fm[key] = value
    return fm


def extract_wikilinks(content: str) -> list:
    links = []
    matches = re.findall(r"\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]", content)
    for m in matches:
        links.append(m.strip())
    return list(dict.fromkeys(links))


def extract_tags(frontmatter: dict, content: str) -> list:
    tags: set[str] = set()
    fm_tags = frontmatter.get("tags")
    if fm_tags:
        if isinstance(fm_tags, list):
            for t in fm_tags:
                tags.add(t.lstrip("#"))
        else:
            tags.add(str(fm_tags).lstrip("#"))

    inline_matches = re.finditer(
        r"(?<!\S)#([a-zA-Z0-9_/\-áéíóúñüÁÉÍÓÚÑÜ]+)", content
    )
    for match in inline_matches:
        tags.add(match.group(1))
    return list(tags)


def parse_markdown_file(filepath: Path, size: int) -> tuple[dict, list, list]:
    """Return (frontmatter, wikilinks, tags) for a markdown file."""
    frontmatter: dict = {}
    wikilinks: list = []
    tags: list = []
    if filepath.suffix.lower() != ".md":
        return frontmatter, wikilinks, tags
    try:
        if size < 2 * 1024 * 1024:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            frontmatter = parse_frontmatter(content)
            wikilinks = extract_wikilinks(content)
            tags = extract_tags(frontmatter, content)
    except Exception:
        pass
    return frontmatter, wikilinks, tags
