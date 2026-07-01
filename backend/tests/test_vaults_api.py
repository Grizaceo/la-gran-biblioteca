"""Tests for /api/vaults endpoints."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.app_deps as app_deps
import backend.graph_state as graph_state
import backend.library_bridge as bridge
from backend.graph_engine import GraphEngine
from backend.vault_manager import VaultManager


def _setup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[TestClient, VaultManager, Path]:
    reg = tmp_path / "vaults.json"
    monkeypatch.setenv("LGB_REGISTRY_PATH", str(reg))
    vm = VaultManager(registry_path=reg)
    monkeypatch.setattr("backend.vault_manager.vault_manager", vm)

    ws = tmp_path / "vault"
    ws.mkdir()
    (ws / "doc.md").write_text("# Doc", encoding="utf-8")
    cfg = vm.register_vault(ws, name="TestVault", activate=True)
    vm._bootstrapped = True

    monkeypatch.setenv("WORKSPACE_ROOT", str(ws))
    import backend.constants as constants

    constants.WORKSPACE_ROOT = ws
    db = cfg.db_path
    ge = GraphEngine(db_path=db)
    graph = {
        "nodes": [
            {
                "id": "file_doc.md",
                "type": "document",
                "label": "doc.md",
                "path": str(ws / "doc.md"),
                "metadata": {},
                "position": None,
            }
        ],
        "edges": [],
    }
    ge.build_graph(graph)
    app_deps.set_engine(ge)
    graph_state.set_current_graph(graph)

    return TestClient(bridge.app), vm, ws


def test_list_vaults(tmp_path, monkeypatch):
    client, vm, _ws = _setup(tmp_path, monkeypatch)
    resp = client.get("/api/vaults")
    assert resp.status_code == 200
    data = resp.json()
    assert data["active_id"]
    assert len(data["vaults"]) == 1
    assert data["vaults"][0]["name"] == "TestVault"


def test_register_vault(tmp_path, monkeypatch):
    client, _vm, _ws = _setup(tmp_path, monkeypatch)
    other = tmp_path / "other"
    other.mkdir()
    resp = client.post("/api/vaults", json={"path": str(other), "name": "Other"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Other"


def test_switch_vault(tmp_path, monkeypatch):
    client, vm, ws = _setup(tmp_path, monkeypatch)
    other = tmp_path / "other"
    other.mkdir()
    (other / "other.md").write_text("# O", encoding="utf-8")
    cfg2 = vm.register_vault(other, name="Other")

    resp = client.post("/api/vaults/switch", json={"id": cfg2.id})
    assert resp.status_code == 200
    body = resp.json()
    assert body["vault"]["id"] == cfg2.id
    assert body["nodes"] >= 1

    graph = client.get("/api/graph").json()
    labels = {n.get("label") for n in graph.get("nodes", [])}
    assert "other.md" in labels

    ov = client.get("/api/overview").json()
    assert str(other) in ov["workspace_root"] or ov["workspace_root"].endswith("/other")

    open_resp = client.post("/api/open", json={"node_id": "file_other.md", "reveal": False})
    assert open_resp.status_code == 200


def test_overview_includes_vault(tmp_path, monkeypatch):
    client, _vm, _ws = _setup(tmp_path, monkeypatch)
    resp = client.get("/api/overview")
    assert resp.status_code == 200
    data = resp.json()
    assert "vault" in data
    assert data["vault"]["name"] == "TestVault"
    assert data["workspace_root"]


def test_rename_vault(tmp_path, monkeypatch):
    client, vm, _ws = _setup(tmp_path, monkeypatch)
    vid = vm.get_active().id
    resp = client.patch(f"/api/vaults/{vid}", json={"name": "Renamed"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


def test_cannot_remove_active_vault(tmp_path, monkeypatch):
    client, vm, _ws = _setup(tmp_path, monkeypatch)
    vid = vm.get_active().id
    resp = client.delete(f"/api/vaults/{vid}")
    assert resp.status_code == 400
