"""Coverage metrics API — enriched structure summary."""

from __future__ import annotations

from fastapi import APIRouter

from .. import graph_state
from ..services.graph_pipeline import get_last_pipeline_stats

router = APIRouter(prefix="/api", tags=["coverage"])


@router.get("/coverage")
async def get_coverage():
    """Workspace/folder/topic clusters with study_ratio and density metrics."""
    data = graph_state.get_overview_structure()
    limited = graph_state.get_limited_graph()
    data["limited_count"] = len(limited.get("nodes", []))
    data["shown_count"] = len(limited.get("nodes", []))
    data["pipeline"] = get_last_pipeline_stats()
    return data
