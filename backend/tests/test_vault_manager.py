"""Tests for vault_manager registry CRUD and bootstrap."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from backend.graph_engine import GraphEngine
from backend.vault_manager import VaultManager, ensure_vault_layout, vault_id_for_path


@pytest.fixture
def registry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    reg = tmp_path / "vaults.json"
    monkeypatch.setenv("LGB_REGISTRY_PATH", str(reg))
    vm = VaultManager(registry_path=reg)
    monkeypatch.setattr("backend.vault_manager.vault_manager", vm)
    return vm


def test_vault_id_stable(registry: VaultManager, tmp_path: Path):
    p = tmp_path / "vault-a"
    p.mkdir()
    resolved = p.resolve()
    assert vault_id_for_path(resolved) == vault_id_for_path(resolved)
    assert len(vault_id_for_path(resolved)) == 12


def test_register_dedupe_by_path(registry: VaultManager, tmp_path: Path):
    v1 = tmp_path / "knowledge"
    v1.mkdir()
    a = registry.register_vault(v1, name="Alpha")
    b = registry.register_vault(v1, name="Alpha Renamed")
    assert a.id == b.id
    assert b.name == "Alpha Renamed"
    assert len(registry.list_vaults()) == 1


def test_switch_persists_active(registry: VaultManager, tmp_path: Path):
    v1 = tmp_path / "one"
    v2 = tmp_path / "two"
    v1.mkdir()
    v2.mkdir()
    c1 = registry.register_vault(v1)
    registry.register_vault(v2)
    registry.switch_vault(c1.id)
    assert registry.get_active().id == c1.id
    raw = json.loads(registry.registry_path.read_text(encoding="utf-8"))
    assert raw["active_id"] == c1.id


def test_remove_vault(registry: VaultManager, tmp_path: Path):
    v1 = tmp_path / "one"
    v2 = tmp_path / "two"
    v1.mkdir()
    v2.mkdir()
    c1 = registry.register_vault(v1, activate=True)
    c2 = registry.register_vault(v2)
    assert registry.remove_vault(c2.id)
    assert len(registry.list_vaults()) == 1
    assert registry.get_active().id == c1.id


def test_bootstrap_registers_env_root(registry: VaultManager, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    ws = tmp_path / "vault"
    ws.mkdir()
    monkeypatch.setenv("WORKSPACE_ROOT", str(ws))
    import backend.constants as constants

    constants.WORKSPACE_ROOT = ws
    registry._bootstrapped = False
    registry._data = {"active_id": None, "vaults": []}
    cfg = registry.bootstrap()
    assert cfg.root == ws.resolve()
    assert (ws / ".lgb" / "library.db").parent.exists()
    assert len(registry.list_vaults()) == 1


def test_legacy_db_migration(registry: VaultManager, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    ws = tmp_path / "vault"
    ws.mkdir()
    legacy_db = tmp_path / "legacy-library.db"
    ge = GraphEngine(db_path=legacy_db)
    ge.build_graph(
        {
            "nodes": [
                {
                    "id": "n1",
                    "type": "document",
                    "label": "x",
                    "path": str(ws / "x.md"),
                    "metadata": {},
                    "position": None,
                }
            ],
            "edges": [],
        }
    )

    target = ensure_vault_layout(ws)
    shutil.copy2(legacy_db, target)
    cfg = registry.register_vault(ws, activate=True)
    assert cfg.db_path.exists()
    loaded = GraphEngine(db_path=cfg.db_path).load_from_db()
    assert len(loaded["nodes"]) == 1


def test_ensure_vault_layout_creates_lgb(tmp_path: Path):
    root = tmp_path / "v"
    root.mkdir()
    db = ensure_vault_layout(root)
    assert db.parent.name == ".lgb"
    assert db.name == "library.db"
