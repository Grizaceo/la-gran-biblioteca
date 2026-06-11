"""Shared pytest fixtures."""

import pytest


@pytest.fixture(autouse=True)
def _reset_vault_manager(monkeypatch, tmp_path):
    """Isolate vault registry so get_workspace_root() does not leak between tests."""
    import backend.library_bridge as bridge
    import backend.vault_manager as vm_mod

    reg = tmp_path / "lgb" / "vaults.json"
    monkeypatch.setenv("LGB_REGISTRY_PATH", str(reg))
    fresh = vm_mod.VaultManager(registry_path=reg)
    fresh._bootstrapped = False
    monkeypatch.setattr(vm_mod, "vault_manager", fresh)
    monkeypatch.setattr(bridge, "vault_manager", fresh)
    yield
    fresh._bootstrapped = False


@pytest.fixture(autouse=True)
def _reset_constellation_catalog_cache():
    """Isolate tests that load or mutate the in-memory IAU catalog cache."""
    import backend.constellation_layout as cl

    cl._catalog_cache = None
    yield
    cl._catalog_cache = None
