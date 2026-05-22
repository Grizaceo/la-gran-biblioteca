"""Shared pytest fixtures."""

import pytest


@pytest.fixture(autouse=True)
def _reset_constellation_catalog_cache():
    """Isolate tests that load or mutate the in-memory IAU catalog cache."""
    import backend.constellation_layout as cl

    cl._catalog_cache = None
    yield
    cl._catalog_cache = None
