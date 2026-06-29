import tempfile
import os
from pathlib import Path
from fastapi.testclient import TestClient

# We need to import the app after setting up a temporary DB
_IMPORT_TMP = tempfile.mkdtemp()
os.environ.setdefault("DB_PATH", str(Path(_IMPORT_TMP) / "import-test.db"))
from backend.graph_engine import GraphEngine  # noqa: E402
import backend.app_deps as app_deps  # noqa: E402
import backend.library_bridge as bridge  # noqa: E402


def _use_engine(db: Path) -> GraphEngine:
    ge = GraphEngine(db_path=db)
    bridge.engine = ge
    app_deps.engine = ge
    return ge


def test_health():
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "library.db"
        _use_engine(db)
        bridge.set_current_graph({"nodes": [], "edges": []})
        client = TestClient(bridge.app)
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


def test_get_graph():
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "library.db"
        ge = _use_engine(db)
        ge.build_graph({
            "nodes": [
                {"id": "n1", "type": "folder", "label": "Root", "path": "/", "metadata": {}, "position": None}
            ],
            "edges": []
        })
        bridge.set_current_graph(bridge.engine.load_from_db())
        client = TestClient(bridge.app)
        response = client.get("/api/graph")
        assert response.status_code == 200
        data = response.json()
        assert len(data["nodes"]) == 1


def test_overview_structure_and_search():
    with tempfile.TemporaryDirectory() as tmp:
        vault = Path(tmp) / "vault"
        vault.mkdir()
        db = Path(tmp) / "library.db"
        ge = _use_engine(db)
        graph = {
            "nodes": [
                {
                    "id": "n1",
                    "type": "document",
                    "label": "Graph Notes",
                    "path": str(vault / "notes" / "graph.md"),
                    "metadata": {
                        "workspace": "notes",
                        "topics": ["graph"],
                        "structural_role": "notes",
                        "parent_folder": "notes",
                    },
                    "position": {"x": 0, "y": 0},
                },
                {
                    "id": "n2",
                    "type": "folder",
                    "label": "notes",
                    "path": str(vault / "notes"),
                    "metadata": {"workspace": "notes", "structural_role": "docs"},
                    "position": {"x": 1, "y": 1},
                },
            ],
            "edges": [{"source": "n2", "target": "n1", "type": "contains"}],
        }
        ge.build_graph(graph)
        from unittest.mock import patch

        with patch("backend.constants.get_workspace_root", return_value=vault):
            bridge.set_current_graph(graph)
            client = TestClient(bridge.app)

            structure = client.get("/api/graph/overview-structure")
            assert structure.status_code == 200
            assert "modes" in structure.json()

            search = client.get("/api/search?q=graph")
            assert search.status_code == 200
            assert search.json()["results"][0]["id"] == "n1"


def test_study_node_persists():
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "library.db"
        ge = _use_engine(db)
        ge.build_graph({
            "nodes": [
                {"id": "n1", "type": "document", "label": "Doc", "path": "/doc", "metadata": {}, "position": None}
            ],
            "edges": []
        })
        bridge.set_current_graph(bridge.engine.load_from_db())
        client = TestClient(bridge.app)
        response = client.post("/api/study", json={"node_id": "n1"})
        assert response.status_code == 200
        assert response.json()["study_count"] == 1

        # Verify persistence in DB
        import sqlite3
        conn = sqlite3.connect(db)
        row = conn.execute("SELECT metadata FROM nodes WHERE id = ?", ("n1",)).fetchone()
        conn.close()
        import json
        assert json.loads(row[0]).get("study_count") == 1


def test_startup_returns_before_empty_db_scan():
    """HTTP must respond when vault DB exists but has no nodes (no blocking scan)."""
    import time
    from unittest.mock import patch

    with tempfile.TemporaryDirectory() as tmp:
        vault = Path(tmp) / "vault"
        vault.mkdir()
        db = vault / ".lgb" / "library.db"
        db.parent.mkdir(parents=True)
        db.write_bytes(b"x")  # non-empty file, schema created on GraphEngine init

        ge = GraphEngine(db_path=db)
        _use_engine(db)
        cfg = type("Cfg", (), {"root": vault, "db_path": db})()

        with patch("backend.library_bridge.load_vault_graph") as load_mock:
            def slow_scan(*_a, **_k):
                time.sleep(2)
                return {"nodes": [{"id": "n1", "type": "document", "label": "x", "path": "/x", "metadata": {}, "position": None}], "edges": []}

            load_mock.side_effect = slow_scan
            with patch("backend.library_bridge.vault_manager.bootstrap", return_value=cfg):
                with patch("backend.library_bridge.get_db_path", return_value=db):
                    with patch("backend.library_bridge.get_workspace_root", return_value=vault):
                        t0 = time.perf_counter()
                        with TestClient(bridge.app) as client:
                            elapsed = time.perf_counter() - t0
                            response = client.get("/api/health")
                        assert response.status_code == 200
                        assert elapsed < 1.0
                        load_mock.assert_called_once()
