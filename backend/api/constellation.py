"""Constellation catalog and folder prefs."""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..app_deps import engine
from ..constellation_layout import load_catalog
from ..bridge_tasks import force_graph_update

router = APIRouter(prefix="/api/constellation", tags=["constellation"])


@router.get("/catalog")
async def get_constellation_catalog():
    catalog = load_catalog()
    return {
        "constellations": [
            {
                "id": c["id"],
                "name": c.get("name"),
                "name_es": c.get("name_es"),
                "star_count": len(c.get("stars") or []),
            }
            for c in catalog
        ]
    }


@router.get("/prefs")
async def get_constellation_prefs():
    prefs = engine.list_constellation_prefs()
    pending = [p for p in prefs if p.get("status") == "suggested"]
    return {"prefs": prefs, "pending": pending}


class ConstellationPrefRequest(BaseModel):
    folder_path: str
    constellation_id: str
    status: str = "confirmed"


@router.post("/prefs")
async def save_constellation_pref(req: ConstellationPrefRequest):
    if req.status not in ("confirmed", "suggested"):
        raise HTTPException(status_code=422, detail="status must be confirmed or suggested")
    catalog_ids = {c["id"] for c in load_catalog()}
    if req.constellation_id not in catalog_ids:
        raise HTTPException(status_code=422, detail="Unknown constellation_id")
    folder = Path(req.folder_path)
    try:
        folder = folder.resolve()
    except OSError:
        raise HTTPException(status_code=422, detail="Invalid folder_path")
    if not folder.is_dir():
        raise HTTPException(status_code=422, detail="folder_path is not a directory")
    suggested_from = "manual" if req.status == "confirmed" else "name_match"
    pref = engine.upsert_constellation_pref(
        str(folder), req.constellation_id, req.status, suggested_from
    )
    asyncio.create_task(force_graph_update())
    return {"status": "ok", "pref": pref}


@router.delete("/prefs")
async def delete_constellation_pref(folder_path: str):
    if not engine.delete_constellation_pref(folder_path):
        raise HTTPException(status_code=404, detail="Pref not found")
    asyncio.create_task(force_graph_update())
    return {"status": "ok"}


@router.post("/relayout")
async def constellation_relayout():
    await force_graph_update()
    from .. import graph_state

    g = graph_state.get_current_graph()
    return {"status": "ok", "nodes": len(g["nodes"]), "edges": len(g["edges"])}
