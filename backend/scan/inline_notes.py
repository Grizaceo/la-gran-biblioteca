"""Parse and mutate inline lgb-note blocks inside markdown/text source files."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BLOCK_OPEN = re.compile(r"<!--\s*lgb-note\s+([^>]+?)\s*-->", re.MULTILINE)
BLOCK_CLOSE = re.compile(r"<!--\s*/lgb-note\s*-->")
ATTR_RE = re.compile(r'(\w+)=("(?:\\.|[^"\\])*"|[^\s]+)')

INLINE_EXTENSIONS = {".md", ".txt"}
NOTE_ID_RE = re.compile(r"^[a-f0-9]{8}$")


def _parse_attr_value(raw: str) -> str:
    if raw.startswith('"') and raw.endswith('"'):
        return raw[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    return raw


def parse_open_attrs(attr_str: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for match in ATTR_RE.finditer(attr_str.strip()):
        out[match.group(1)] = _parse_attr_value(match.group(2))
    return out


def _format_attr(key: str, value: str) -> str:
    if not value:
        return f'{key}=""'
    if any(c in value for c in ' "\n'):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'{key}="{escaped}"'
    return f"{key}={value}"


def _parse_block_body(raw_body: str) -> tuple[str, str]:
    """Return (selected_text, body) from block inner content."""
    text = raw_body.strip("\n")
    if text.startswith(">"):
        parts = text.split("\n\n", 1)
        if len(parts) == 2 and parts[0].startswith(">"):
            quote_line = parts[0].strip()
            if quote_line.startswith('> "') and quote_line.endswith('"'):
                selected = quote_line[3:-1]
            elif quote_line.startswith(">"):
                selected = quote_line[1:].strip().strip('"')
            else:
                selected = ""
            return selected, parts[1].strip()
    return "", text.strip()


def _line_number_at(content: str, index: int) -> int:
    return content[:index].count("\n") + 1


def parse_inline_blocks(
    content: str,
    *,
    source_path: str = "",
    source_node_id: str = "",
) -> list[dict[str, Any]]:
    """Extract all lgb-note blocks from file content."""
    blocks: list[dict[str, Any]] = []
    for open_match in BLOCK_OPEN.finditer(content):
        start = open_match.start()
        attrs = parse_open_attrs(open_match.group(1))
        note_id = attrs.get("id", "").strip()
        if not note_id:
            continue
        close_match = BLOCK_CLOSE.search(content, open_match.end())
        if close_match is None:
            continue
        inner = content[open_match.end() : close_match.start()]
        selected_text, body = _parse_block_body(inner)
        labels_raw = attrs.get("labels", "")
        labels = [x.strip() for x in labels_raw.split(",") if x.strip()] if labels_raw else []
        line_start = _line_number_at(content, start)
        line_end = _line_number_at(content, close_match.end())
        blocks.append(
            {
                "id": note_id,
                "title": attrs.get("title", ""),
                "body": body,
                "labels": labels,
                "source_node_id": source_node_id or attrs.get("source_node_id", ""),
                "selected_text": selected_text,
                "created_at": attrs.get("created", "") or attrs.get("created_at", ""),
                "path": source_path,
                "storage": "inline",
                "line_start": line_start,
                "line_end": line_end,
            }
        )
    return blocks


def parse_inline_blocks_from_file(
    path: Path,
    *,
    source_node_id: str = "",
    workspace_root: Path | None = None,
) -> list[dict[str, Any]]:
    if path.suffix.lower() not in INLINE_EXTENSIONS:
        return []
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return []
    rel = source_path = str(path)
    if workspace_root is not None:
        try:
            rel = str(path.resolve().relative_to(workspace_root.resolve()))
        except ValueError:
            rel = str(path)
    return parse_inline_blocks(
        content,
        source_path=rel,
        source_node_id=source_node_id,
    )


def build_inline_block(
    *,
    note_id: str,
    title: str,
    body: str,
    labels: list[str],
    selected_text: str,
    created_at: str,
) -> str:
    labels_str = ",".join(labels) if labels else ""
    attrs = " ".join(
        [
            _format_attr("id", note_id),
            _format_attr("title", title),
            _format_attr("labels", labels_str),
            _format_attr("created", created_at),
        ]
    )
    quote = ""
    if selected_text.strip():
        safe = selected_text.strip().replace("\n", " ")
        quote = f'> "{safe}"\n\n'
    inner = f"{quote}{body.rstrip()}\n"
    return f"<!-- lgb-note {attrs} -->\n{inner}<!-- /lgb-note -->"


def _insertion_index(content: str, selected_text: str) -> int:
    if selected_text.strip():
        needle = selected_text.strip()
        idx = content.find(needle)
        if idx >= 0:
            end = idx + len(needle)
            para_end = content.find("\n\n", end)
            if para_end >= 0:
                return para_end + 2
            return len(content.rstrip()) + (1 if content.endswith("\n") else 0)
    stripped = content.rstrip()
    if not stripped:
        return 0
    if content.endswith("\n"):
        return len(content)
    return len(stripped)


def insert_inline_block(content: str, block: str, selected_text: str = "") -> str:
    idx = _insertion_index(content, selected_text)
    prefix = content[:idx]
    suffix = content[idx:]
    sep = "" if not prefix or prefix.endswith("\n\n") else ("\n\n" if prefix.endswith("\n") else "\n\n")
    if not prefix:
        return block + ("\n" if suffix else "\n\n") + suffix
    if suffix and not suffix.startswith("\n"):
        return prefix + sep + block + "\n\n" + suffix
    return prefix + sep + block + ("\n" if suffix else "") + suffix


def _find_block_span(content: str, note_id: str) -> tuple[int, int] | None:
    for open_match in BLOCK_OPEN.finditer(content):
        attrs = parse_open_attrs(open_match.group(1))
        if attrs.get("id") != note_id:
            continue
        close_match = BLOCK_CLOSE.search(content, open_match.end())
        if close_match is None:
            continue
        start = open_match.start()
        end = close_match.end()
        if end < len(content) and content[end : end + 1] == "\n":
            end += 1
        if start > 0 and content[start - 1 : start + 1] == "\n\n":
            start -= 1
        return start, end
    return None


def replace_inline_block(content: str, note_id: str, new_block: str) -> str:
    span = _find_block_span(content, note_id)
    if span is None:
        raise KeyError(note_id)
    start, end = span
    return content[:start] + new_block + content[end:]


def delete_inline_block(content: str, note_id: str) -> str:
    span = _find_block_span(content, note_id)
    if span is None:
        raise KeyError(note_id)
    start, end = span
    return content[:start].rstrip() + "\n" + content[end:].lstrip("\n")


def new_note_id() -> str:
    return uuid.uuid4().hex[:8]
