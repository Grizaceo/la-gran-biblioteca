"""Tests for /api/browse."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.library_bridge as bridge


def test_browse_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    (tmp_path / "notes").mkdir()
    client = TestClient(bridge.app)
    resp = client.get("/api/browse")
    assert resp.status_code == 200
    data = resp.json()
    assert data["path"] == str(tmp_path.resolve())
    names = {e["name"] for e in data["entries"]}
    assert "notes" in names
