"""Persisted session lens shared between HTTP bridge and MCP (separate processes)."""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .lens import validate_lens

_SESSION_FILE = Path(__file__).parent / ".session_lens.json"
_lock = threading.Lock()

_EMPTY: dict[str, Any] = {
    "lens": None,
    "updated_at": None,
    "updated_by": None,
}


def _read_raw() -> dict[str, Any]:
    if not _SESSION_FILE.exists():
        return dict(_EMPTY)
    try:
        data = json.loads(_SESSION_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return dict(_EMPTY)


def _write_raw(data: dict[str, Any]) -> None:
    _SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    _SESSION_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def get_session_lens() -> dict[str, Any]:
    with _lock:
        raw = _read_raw()
    lens = raw.get("lens")
    if lens is None:
        return {"lens": None, "updated_at": raw.get("updated_at"), "updated_by": raw.get("updated_by")}
    try:
        validated = validate_lens(lens)
    except ValueError:
        validated = None
    return {
        "lens": validated,
        "updated_at": raw.get("updated_at"),
        "updated_by": raw.get("updated_by"),
    }


def publish_session_lens(
    lens: dict[str, Any],
    *,
    updated_by: str = "ui",
    focus_node_id: str | None = None,
    highlight_ids: list[str] | None = None,
) -> dict[str, Any]:
    validated = validate_lens(lens)
    if focus_node_id:
        validated["focusNodeId"] = focus_node_id
    if highlight_ids is not None:
        validated["highlightNodeIds"] = [str(item) for item in highlight_ids if str(item).strip()]

    payload = {
        "lens": validated,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": updated_by,
    }
    with _lock:
        _write_raw(payload)
    return payload
