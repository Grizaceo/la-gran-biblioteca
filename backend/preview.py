from pathlib import Path
from fastapi import HTTPException
from .constants import TEXT_EXTENSIONS, CONTENT_MAX_BYTES


def read_preview(path: Path) -> dict:
    """Read file content for preview. Returns content, lang, size, truncated."""
    ext = path.suffix.lstrip(".").lower()
    if path.name.lower() == "dockerfile":
        ext = "dockerfile"

    lang = TEXT_EXTENSIONS.get(ext)
    if lang is None:
        raise HTTPException(status_code=415, detail="Unsupported file type for preview")

    size = path.stat().st_size
    truncated = size > CONTENT_MAX_BYTES

    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(CONTENT_MAX_BYTES)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not read file: {e}")

    return {"content": content, "lang": lang, "size": size, "truncated": truncated}
