"""Tests for vault_switch hot-swap."""

from __future__ import annotations

from pathlib import Path

import pytest

import backend.app_deps as app_deps
import backend.graph_state as graph_state
from backend.graph_engine import GraphEngine
from backend.vault_manager import VaultManager
from backend.vault_switch import apply_vault_switch_sync, load_vault_graph


@pytest.fixture
def two_vaults(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    reg = tmp_path / "vaults.json"
    monkeypatch.setenv("LGB_REGISTRY_PATH", str(reg))
    vm = VaultManager(registry_path=reg)
    monkeypatch.setattr("backend.vault_manager.vault_manager", vm)

    v1 = tmp_path / "vault-one"
    v2 = tmp_path / "vault-two"
    v1.mkdir()
    v2.mkdir()
    (v1 / "alpha.md").write_text("# Alpha", encoding="utf-8")
    (v2 / "beta.md").write_text("# Beta", encoding="utf-8")

    c1 = vm.register_vault(v1, name="One", activate=True)
    c2 = vm.register_vault(v2, name="Two")
    vm._bootstrapped = True

    import backend.constants as constants

    constants.WORKSPACE_ROOT = v1.resolve()
    return vm, c1, c2, v1, v2


def test_load_vault_graph_scans_when_no_db(two_vaults):
    vm, c1, _c2, v1, _v2 = two_vaults
    engine = GraphEngine(db_path=c1.db_path)
    graph = load_vault_graph(c1, engine)
    assert graph["nodes"]
    labels = {n.get("label") for n in graph["nodes"]}
    assert "alpha.md" in labels


def test_switch_loads_second_vault_db(two_vaults):
    vm, c1, c2, _v1, v2 = two_vaults
    eng1 = GraphEngine(db_path=c1.db_path)
    g1 = load_vault_graph(c1, eng1)
    eng1.build_graph(g1)
    graph_state.set_current_graph(g1)

    eng2 = GraphEngine(db_path=c2.db_path)
    g2 = load_vault_graph(c2, eng2)
    eng2.build_graph(g2)

    result = apply_vault_switch_sync(vault_id=c2.id)
    assert result["vault"]["id"] == c2.id
    assert vm.get_active().id == c2.id

    current = graph_state.get_current_graph()
    labels = {n.get("label") for n in current["nodes"]}
    assert "beta.md" in labels
    assert app_deps.get_engine().db_path == c2.db_path.resolve()


def test_switch_by_path(two_vaults):
    _vm, _c1, c2, _v1, v2 = two_vaults
    result = apply_vault_switch_sync(vault_path=str(v2))
    assert result["vault"]["id"] == c2.id


def test_switch_updates_force_graph_engine(two_vaults):
    """Watcher/rescan must use the engine for the active vault, not a stale import."""
    _vm, c1, c2, _v1, _v2 = two_vaults
    eng1 = GraphEngine(db_path=c1.db_path)
    app_deps.set_engine(eng1)
    graph_state.set_current_graph(load_vault_graph(c1, eng1))

    apply_vault_switch_sync(vault_id=c2.id)
    assert app_deps.get_engine().db_path == c2.db_path.resolve()

    import asyncio
    from backend.bridge_tasks import force_graph_update

    asyncio.run(force_graph_update())
    labels = {n.get("label") for n in graph_state.get_current_graph()["nodes"]}
    assert "beta.md" in labels
    assert "alpha.md" not in labels
