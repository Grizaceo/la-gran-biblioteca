"""Mutation MCP tools: mark_studied, rescan, create_file, create_folder, open_in_os, list_vaults, switch_vault, apply_lens, publish_lens."""

from __future__ import annotations

import os

from ..lens import lens_to_search_params, preset_lens, validate_lens
from ..lens_session import publish_session_lens
from ..graph_queries import search_graph
from ..vault_manager import vault_manager
from ..vault_switch import apply_vault_switch_sync
from . import (
    _lock,
    _graph,
    _node_index,
    _engine,
    _load,
    _rescan_and_reload,
    _validate_workspace_path,
    WORKSPACE_ROOT,
    get_workspace_root,
)


def mark_studied(node_id: str) -> dict:
    with _lock:
        n = _node_index.get(node_id)
    if n is None:
        return {"error": f"Node {node_id!r} not found"}
    meta = dict(n.get("metadata") or {})
    meta["study_count"] = meta.get("study_count", 0) + 1
    _engine.update_node_metadata(node_id, meta)
    with _lock:
        if node_id in _node_index:
            _node_index[node_id]["metadata"] = meta
    return {"status": "ok", "node_id": node_id, "study_count": meta["study_count"]}


def rescan() -> dict:
    new_graph = _rescan_and_reload()
    return {"status": "ok", "nodes": len(new_graph["nodes"]), "edges": len(new_graph["edges"])}


def list_vaults() -> dict:
    vault_manager._load_registry()
    active_id = vault_manager._data.get("active_id")
    if not vault_manager._bootstrapped:
        vault_manager.bootstrap()
        active_id = vault_manager._data.get("active_id")
    vaults = [
        vault_manager.vault_to_public(v, active=v.id == active_id)
        for v in vault_manager.list_vaults()
    ]
    return {"active_id": active_id, "vaults": vaults}


def switch_vault(id: str = "", path: str = "") -> dict:
    import backend.mcp as mcp_mod

    if not id and not path:
        return {"error": "Provide id or path"}
    try:
        from ..app_deps import get_engine

        result = apply_vault_switch_sync(vault_id=id or None, vault_path=path or None)
        mcp_mod._engine = get_engine()
        _load()
        return result
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": str(e)}


def create_file(relative_path: str, content: str = "") -> dict:
    import backend.mcp as mcp_mod

    try:
        dest = _validate_workspace_path(relative_path)
    except ValueError as e:
        return {"error": str(e)}
    if dest.exists():
        return {"error": f"Already exists: {relative_path}"}
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(content, encoding="utf-8")
    mcp_mod._recent_imports.append(str(dest))
    if len(mcp_mod._recent_imports) > 50:
        mcp_mod._recent_imports.pop(0)
    return {"status": "ok", "path": str(dest.relative_to(get_workspace_root()))}


def create_folder(relative_path: str) -> dict:
    try:
        dest = _validate_workspace_path(relative_path)
    except ValueError as e:
        return {"error": str(e)}
    if dest.exists():
        return {"error": f"Already exists: {relative_path}"}
    dest.mkdir(parents=True, exist_ok=True)
    return {"status": "ok", "path": str(dest.relative_to(get_workspace_root()))}


def open_in_os(node_id: str, reveal: bool = False) -> dict:
    import backend.mcp as mcp_mod

    if not os.environ.get("LGB_MCP_ALLOW_OS_OPEN"):
        return {"error": "OS open is disabled. Set LGB_MCP_ALLOW_OS_OPEN=1 to enable."}
    with mcp_mod._lock:
        n = mcp_mod._node_index.get(node_id)
    if n is None:
        return {"error": f"Node {node_id!r} not found"}
    path_str = n.get("path", "")
    if not path_str:
        return {"error": "Node has no path"}
    try:
        from ..path_utils import resolve_node_path
        from ..os_open import open_in_os as _open

        p = resolve_node_path(node_id, path_str, WORKSPACE_ROOT.resolve())
        if not p.exists():
            return {"error": f"File not found: {path_str}"}
        _open(p, reveal)
        return {"status": "ok", "path": path_str}
    except Exception as e:
        return {"error": str(e)}


def apply_lens(lens: dict | None = None, preset: str = "") -> dict:
    try:
        if preset:
            validated = preset_lens(preset)
        else:
            validated = validate_lens(lens or {})
    except ValueError as e:
        return {"error": str(e)}
    with _lock:
        graph = {"nodes": list(_graph["nodes"]), "edges": list(_graph["edges"])}
    params = lens_to_search_params(validated)
    result = search_graph(
        graph,
        engine_search_results=[],
        query=params.get("query", ""),
        workspace=params.get("workspace", ""),
        folder_prefix=params.get("folder_prefix", ""),
        topic=params.get("topic", ""),
        min_degree=params.get("min_degree", 0),
        studied=params.get("studied", "all"),
        mode=params.get("mode", "text"),
        limit=params.get("limit", 20),
        offset=params.get("offset", 0),
    )
    preview = result.get("results", [])[:20]
    highlight_ids = [str(item["id"]) for item in preview if item.get("id")]
    suggested = validated.get("focusNodeId") or (highlight_ids[0] if highlight_ids else None)
    return {
        "lens": validated,
        "search_preview": preview,
        "suggested_focus_node_id": suggested,
        "highlight_node_ids": highlight_ids,
    }


def publish_lens(
    lens: dict | None = None,
    preset: str = "",
    focus_node_id: str = "",
    highlight_ids: list[str] | None = None,
) -> dict:
    try:
        if preset:
            validated = preset_lens(preset)
        else:
            validated = validate_lens(lens or {})
    except ValueError as e:
        return {"error": str(e)}
    return publish_session_lens(
        validated,
        updated_by="mcp",
        focus_node_id=focus_node_id or None,
        highlight_ids=highlight_ids,
    )
