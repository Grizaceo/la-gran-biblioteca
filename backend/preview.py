from pathlib import Path
from fastapi import HTTPException
from .constants import TEXT_EXTENSIONS, CONTENT_MAX_BYTES
from .security import safe_error_detail


def read_node_content(path: Path, max_chars: int | None = None) -> dict:
    """Read file text with CONTENT_MAX_BYTES cap (HTTP preview + MCP read_node)."""
    ext = path.suffix.lstrip(".").lower()
    if path.name.lower() == "dockerfile":
        ext = "dockerfile"

    lang = TEXT_EXTENSIONS.get(ext)
    if lang is None:
        raise ValueError(f"Unsupported file type: {ext or path.suffix}")

    size = path.stat().st_size
    byte_limit = CONTENT_MAX_BYTES
    if max_chars is not None:
        byte_limit = min(max_chars * 4, CONTENT_MAX_BYTES)

    truncated_disk = size > byte_limit
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read(byte_limit)

    if max_chars is not None:
        content = raw[:max_chars]
        truncated = truncated_disk or len(raw) > max_chars
    else:
        content = raw
        truncated = truncated_disk

    out = {"content": content, "lang": lang, "size": size, "truncated": truncated}
    if max_chars is not None:
        out["total_bytes"] = size
    return out


def read_preview(path: Path) -> dict:
    """Read file content for preview. Returns content, lang, size, truncated."""
    path.suffix.lstrip(".").lower()
    if path.name.lower() == "dockerfile":
        pass

    try:
        return read_node_content(path)
    except ValueError:
        raise HTTPException(status_code=415, detail="Unsupported file type for preview")
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))
