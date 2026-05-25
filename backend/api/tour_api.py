"""Exploration tours from Karpathy index.md."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..app_deps import engine

router = APIRouter(prefix="/api/tour", tags=["tour"])


@router.get("/{workspace}")
async def get_tour(workspace: str):
    tour = engine.get_exploration_tour(workspace)
    if not tour:
        raise HTTPException(status_code=404, detail=f"No tour for workspace {workspace!r}")
    return tour


@router.get("")
async def list_tours():
    return {"tours": engine.list_exploration_tours()}
