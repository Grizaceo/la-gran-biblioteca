"""Vault registry REST API."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import graph_state
from ..security import safe_error_detail
from .. import vault_manager as vault_manager_mod
from ..vault_switch import apply_vault_switch

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/vaults", tags=["vaults"])


class RegisterVaultRequest(BaseModel):
    path: str
    name: str | None = None


class SwitchVaultRequest(BaseModel):
    id: str | None = None
    path: str | None = None


class RenameVaultRequest(BaseModel):
    name: str = Field(min_length=1)


def _vault_with_stats(cfg, *, active: bool) -> dict:
    pub = vault_manager_mod.vault_manager.vault_to_public(cfg, active=active)
    if active:
        graph = graph_state.get_current_graph()
        pub["node_count"] = len(graph.get("nodes", []))
        pub["edge_count"] = len(graph.get("edges", []))
    return pub


@router.get("")
async def list_vaults():
    vault_manager_mod.vault_manager._load_registry()
    active_id = vault_manager_mod.vault_manager._data.get("active_id")
    vaults = []
    for cfg in vault_manager_mod.vault_manager.list_vaults():
        vaults.append(_vault_with_stats(cfg, active=cfg.id == active_id))
    return {"active_id": active_id, "vaults": vaults}


@router.post("")
async def register_vault(req: RegisterVaultRequest):
    try:
        cfg = vault_manager_mod.vault_manager.register_vault(req.path, name=req.name)
        active_id = vault_manager_mod.vault_manager._data.get("active_id")
        return _vault_with_stats(cfg, active=cfg.id == active_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("register_vault failed")
        raise HTTPException(status_code=500, detail=safe_error_detail(exc)) from exc


@router.post("/switch")
async def switch_vault_endpoint(req: SwitchVaultRequest):
    if not req.id and not req.path:
        raise HTTPException(status_code=400, detail="Provide id or path")
    try:
        return await apply_vault_switch(vault_id=req.id, vault_path=req.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("switch_vault failed")
        raise HTTPException(status_code=500, detail=safe_error_detail(exc)) from exc


@router.delete("/{vault_id}")
async def remove_vault(vault_id: str):
    active_id = vault_manager_mod.vault_manager._data.get("active_id")
    if vault_id == active_id:
        raise HTTPException(status_code=400, detail="Cannot remove the active vault")
    if not vault_manager_mod.vault_manager.remove_vault(vault_id):
        raise HTTPException(status_code=404, detail="Vault not found")
    return {"status": "ok", "removed_id": vault_id}


class RegisterVaultFromPathRequest(BaseModel):
    path: str
    name: str | None = None


@router.post("/register-from-path")
async def register_vault_from_path(req: RegisterVaultFromPathRequest):
    """Register (and switch to) a vault from a POSIX path selected via in-app browser."""
    try:
        cfg = vault_manager_mod.vault_manager.register_vault(req.path, name=req.name, activate=True)
        # Trigger async vault switch to reload graph, watcher, SSE
        result = await apply_vault_switch(vault_id=cfg.id)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("register_vault_from_path failed")
        raise HTTPException(status_code=500, detail=safe_error_detail(exc)) from exc


@router.patch("/{vault_id}")
async def rename_vault(vault_id: str, req: RenameVaultRequest):
    try:
        cfg = vault_manager_mod.vault_manager.rename_vault(vault_id, req.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if cfg is None:
        raise HTTPException(status_code=404, detail="Vault not found")
    active_id = vault_manager_mod.vault_manager._data.get("active_id")
    return _vault_with_stats(cfg, active=cfg.id == active_id)
