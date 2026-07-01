"""GitHub, arXiv, PubMed imports."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import graph_state
from ..bridge_tasks import force_graph_update
from ..constants import get_workspace_root
from ..imports import (
    download_and_extract_github,
    import_arxiv,
    import_doi,
    import_pmc,
    import_preprint,
    import_pubmed,
    search_arxiv,
)
from ..scan_workspaces import node_id_for_import_dir, node_id_for_import_path
from ..security import safe_error_detail

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["imports"])


class ImportGithubRequest(BaseModel):
    url: str


class ImportArxivRequest(BaseModel):
    id: str


class ImportPubmedRequest(BaseModel):
    id: str


class ImportDoiRequest(BaseModel):
    doi: str


class ImportPmcRequest(BaseModel):
    pmcid: str


class ImportPreprintRequest(BaseModel):
    id: str


@router.post("/create/github")
async def create_github(req: ImportGithubRequest):
    try:
        dest_dir = await asyncio.to_thread(
            download_and_extract_github, req.url, get_workspace_root()
        )
        graph_state.register_recently_imported(dest_dir)
        rel_path = str(dest_dir.relative_to(get_workspace_root()))
        node_id = node_id_for_import_dir(dest_dir, get_workspace_root())
        asyncio.create_task(force_graph_update(ensure_paths=[dest_dir]))
        return {
            "status": "ok",
            "path": rel_path,
            "node_id": node_id,
            "workspace_root": str(get_workspace_root().resolve()),
        }
    except Exception as e:
        logger.error("Error importando repositorio de GitHub: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/arxiv/search")
async def arxiv_search(
    q: str | None = None,
    max: int = 10,
    sort: str = "relevance",
    author: str | None = None,
    cat: str | None = None,
):
    q_val = (q or "").strip()
    author_val = (author or "").strip()
    cat_val = (cat or "").strip()
    if not q_val and not author_val and not cat_val:
        raise HTTPException(
            status_code=400,
            detail="Indica al menos uno de: q, author o cat.",
        )
    if max < 1 or max > 30:
        raise HTTPException(status_code=400, detail="max debe estar entre 1 y 30.")
    try:
        return await asyncio.to_thread(
            search_arxiv,
            query=q_val or None,
            author=author_val or None,
            category=cat_val or None,
            max_results=max,
            sort=sort,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Error buscando en arXiv: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/create/arxiv")
async def create_arxiv(req: ImportArxivRequest):
    try:
        file_path = await asyncio.to_thread(import_arxiv, req.id, get_workspace_root())
        graph_state.register_recently_imported(file_path)
        rel_path = str(file_path.relative_to(get_workspace_root()))
        node_id = node_id_for_import_path(file_path, get_workspace_root())
        asyncio.create_task(force_graph_update(ensure_paths=[file_path]))
        return {
            "status": "ok",
            "path": rel_path,
            "node_id": node_id,
            "workspace_root": str(get_workspace_root().resolve()),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Error importando de arXiv: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/create/pubmed")
async def create_pubmed(req: ImportPubmedRequest):
    try:
        file_path = await asyncio.to_thread(import_pubmed, req.id, get_workspace_root())
        graph_state.register_recently_imported(file_path)
        rel_path = str(file_path.relative_to(get_workspace_root()))
        node_id = node_id_for_import_path(file_path, get_workspace_root())
        asyncio.create_task(force_graph_update(ensure_paths=[file_path]))
        return {
            "status": "ok",
            "path": rel_path,
            "node_id": node_id,
            "workspace_root": str(get_workspace_root().resolve()),
        }
    except Exception as e:
        logger.error("Error importando de PubMed: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


def _import_file_response(file_path, workspace_root) -> dict:
    rel_path = str(file_path.relative_to(workspace_root))
    node_id = node_id_for_import_path(file_path, workspace_root)
    return {
        "status": "ok",
        "path": rel_path,
        "node_id": node_id,
        "workspace_root": str(workspace_root.resolve()),
    }


@router.post("/create/doi")
async def create_doi(req: ImportDoiRequest):
    try:
        file_path = await asyncio.to_thread(import_doi, req.doi, get_workspace_root())
        graph_state.register_recently_imported(file_path)
        asyncio.create_task(force_graph_update(ensure_paths=[file_path]))
        return _import_file_response(file_path, get_workspace_root())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Error importando DOI: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/create/pmc")
async def create_pmc(req: ImportPmcRequest):
    try:
        file_path = await asyncio.to_thread(import_pmc, req.pmcid, get_workspace_root())
        graph_state.register_recently_imported(file_path)
        asyncio.create_task(force_graph_update(ensure_paths=[file_path]))
        return _import_file_response(file_path, get_workspace_root())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Error importando PMC: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/create/medrxiv")
async def create_medrxiv(req: ImportPreprintRequest):
    try:
        file_path = await asyncio.to_thread(
            import_preprint, "medrxiv", req.id, get_workspace_root()
        )
        graph_state.register_recently_imported(file_path)
        asyncio.create_task(force_graph_update(ensure_paths=[file_path]))
        return _import_file_response(file_path, get_workspace_root())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Error importando medRxiv: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/create/biorxiv")
async def create_biorxiv(req: ImportPreprintRequest):
    try:
        file_path = await asyncio.to_thread(
            import_preprint, "biorxiv", req.id, get_workspace_root()
        )
        graph_state.register_recently_imported(file_path)
        asyncio.create_task(force_graph_update(ensure_paths=[file_path]))
        return _import_file_response(file_path, get_workspace_root())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Error importando bioRxiv: %s", e)
        raise HTTPException(status_code=500, detail=safe_error_detail(e))
