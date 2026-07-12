"""Tests for PUT /api/node/{id}/content — in-app file editor."""

import tempfile
from pathlib import Path
from unittest.mock import patch, AsyncMock

from fastapi.testclient import TestClient

import backend.library_bridge as bridge
from backend.graph_engine import GraphEngine
import backend.app_deps as app_deps


def _use_engine(db: Path) -> GraphEngine:
    ge = GraphEngine(db_path=db)
    bridge.engine = ge
    app_deps.engine = ge
    return ge


def _make_node(graph_engine: GraphEngine, tmp_path: Path, filename: str, content: str = "# test") -> str:
    """Create a real file and register it in the graph engine."""
    f = tmp_path / filename
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(content, encoding="utf-8")
    rel = str(f.relative_to(tmp_path))
    node_id = f"file_{rel}"
    graph_engine.rebuild_graph({
        "nodes": [{
            "id": node_id,
            "type": "document",
            "label": filename,
            "path": str(f),
            "metadata": {},
            "position": {"x": 0, "y": 0},
        }],
        "edges": [],
    })
    return node_id


def test_update_content_writes_file():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        db = tmp / "library.db"
        ge = _use_engine(db)
        node_id = _make_node(ge, tmp, "test.md", "# old content")

        with (
            patch("backend.constants.get_workspace_root", return_value=tmp),
            patch("backend.api.nodes.get_workspace_root", return_value=tmp),
            patch("backend.constants.WORKSPACE_ROOT", tmp),
            patch("backend.library_bridge._try_load_cached_graph", return_value=None),
            patch("backend.library_bridge._background_initial_load", new_callable=AsyncMock),
            patch("backend.library_bridge.start_workspace_watcher"),
            patch("backend.bridge_tasks.force_graph_update", new_callable=AsyncMock),
        ):
            bridge.set_current_graph(ge.load_from_db())
            client = TestClient(bridge.app)

            resp = client.put(f"/api/node/{node_id}/content", json={"content": "# new content"})
            assert resp.status_code == 200
            assert resp.json()["status"] == "ok"
            assert Path(tmp / "test.md").read_text() == "# new content"


def test_update_content_rejects_non_text_file():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        db = tmp / "library.db"
        ge = _use_engine(db)
        # Create a .png file (binary, not editable)
        f = tmp / "image.png"
        f.write_bytes(b"\x89PNG\r\n\x1a\n")
        node_id = "file_image.png"
        ge.rebuild_graph({
            "nodes": [{
                "id": node_id,
                "type": "file",
                "label": "image.png",
                "path": str(f),
                "metadata": {},
                "position": {"x": 0, "y": 0},
            }],
            "edges": [],
        })

        with (
            patch("backend.constants.get_workspace_root", return_value=tmp),
            patch("backend.api.nodes.get_workspace_root", return_value=tmp),
            patch("backend.constants.WORKSPACE_ROOT", tmp),
            patch("backend.library_bridge._try_load_cached_graph", return_value=None),
            patch("backend.library_bridge._background_initial_load", new_callable=AsyncMock),
            patch("backend.library_bridge.start_workspace_watcher"),
            patch("backend.bridge_tasks.force_graph_update", new_callable=AsyncMock),
        ):
            bridge.set_current_graph(ge.load_from_db())
            client = TestClient(bridge.app)

            resp = client.put(f"/api/node/{node_id}/content", json={"content": "fake image data"})
            assert resp.status_code == 415
            assert "not editable" in resp.json()["detail"]


def test_update_content_rejects_oversized():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        db = tmp / "library.db"
        ge = _use_engine(db)
        node_id = _make_node(ge, tmp, "big.md", "# small")

        with (
            patch("backend.constants.get_workspace_root", return_value=tmp),
            patch("backend.api.nodes.get_workspace_root", return_value=tmp),
            patch("backend.constants.WORKSPACE_ROOT", tmp),
            patch("backend.library_bridge._try_load_cached_graph", return_value=None),
            patch("backend.library_bridge._background_initial_load", new_callable=AsyncMock),
            patch("backend.library_bridge.start_workspace_watcher"),
            patch("backend.bridge_tasks.force_graph_update", new_callable=AsyncMock),
        ):
            bridge.set_current_graph(ge.load_from_db())
            client = TestClient(bridge.app)

            # Create content larger than CONTENT_MAX_BYTES (2MB)
            from backend.constants import CONTENT_MAX_BYTES
            big_content = "x" * (CONTENT_MAX_BYTES + 1)
            resp = client.put(f"/api/node/{node_id}/content", json={"content": big_content})
            assert resp.status_code == 413
            assert "exceed" in resp.json()["detail"]


def test_update_content_node_not_found():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        db = tmp / "library.db"
        _use_engine(db)

        with (
            patch("backend.constants.get_workspace_root", return_value=tmp),
            patch("backend.api.nodes.get_workspace_root", return_value=tmp),
            patch("backend.constants.WORKSPACE_ROOT", tmp),
            patch("backend.library_bridge._try_load_cached_graph", return_value=None),
            patch("backend.library_bridge._background_initial_load", new_callable=AsyncMock),
            patch("backend.library_bridge.start_workspace_watcher"),
            patch("backend.bridge_tasks.force_graph_update", new_callable=AsyncMock),
        ):
            bridge.set_current_graph({"nodes": [], "edges": []})
            client = TestClient(bridge.app)

            resp = client.put("/api/node/nonexistent/content", json={"content": "test"})
            assert resp.status_code == 404