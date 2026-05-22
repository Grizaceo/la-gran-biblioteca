import tempfile
from pathlib import Path
from fastapi.testclient import TestClient
from backend.graph_engine import GraphEngine

# We need to import the app after setting up a temporary DB
import backend.app_deps as app_deps
import backend.library_bridge as bridge


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
