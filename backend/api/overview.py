"""Overview and health."""

from __future__ import annotations

from fastapi import APIRouter

from .. import graph_state
from ..app_deps import get_engine
from ..constants import get_workspace_root
from .. import vault_manager as vault_manager_mod
from ..overview import build_overview
from ..services.graph_pipeline import get_last_pipeline_stats, get_last_scan_stats

router = APIRouter(prefix="/api", tags=["overview"])


@router.get("/overview")
async def get_overview():
    graph = graph_state.get_current_graph()
    stats = get_last_scan_stats()
    pipeline = get_last_pipeline_stats()
    root = get_workspace_root()
    data = build_overview(
        graph["nodes"],
        graph["edges"],
        graph_state.recently_imported_paths,
        root,
    )
    active = vault_manager_mod.vault_manager.get_active()
    data["vault"] = vault_manager_mod.vault_manager.vault_to_public(active, active=True)
    data["workspace_root"] = str(root)
    data["skipped_archive_dirs"] = stats.get("skipped_archive_dirs", 0)
    data["pipeline"] = pipeline
    data["limited_count"] = len(graph_state.get_limited_graph().get("nodes", []))
    data["wiki_pattern"] = stats.get("wiki_pattern")
    data["unresolved_wikilinks"] = stats.get("unresolved_wikilinks") or []
    data["categories"] = stats.get("categories") or []
    return data


@router.get("/health")
async def health():
    graph = graph_state.get_current_graph()
    stats = get_last_scan_stats()
    pipeline = get_last_pipeline_stats()
    root = get_workspace_root()
    active = vault_manager_mod.vault_manager.get_active()
    return {
        "status": "ok",
        "nodes": len(graph["nodes"]),
        "edges": len(graph["edges"]),
        "workspace_root": str(root),
        "vault": vault_manager_mod.vault_manager.vault_to_public(active, active=True),
        "db_path": str(get_engine().db_path),
        "skipped_archive_dirs": stats.get("skipped_archive_dirs", 0),
        "pipeline": pipeline,
    }
