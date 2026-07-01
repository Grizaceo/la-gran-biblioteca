import json
import sqlite3
import tempfile
from pathlib import Path
from backend.graph_engine import GraphEngine


def test_build_graph_clears_previous_state():
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "test.db"
        engine = GraphEngine(db_path=db)

        raw1 = {
            "nodes": [
                {
                    "id": "a",
                    "type": "folder",
                    "label": "A",
                    "path": "/a",
                    "metadata": {},
                    "position": {"x": 0, "y": 0},
                }
            ],
            "edges": [],
        }
        engine.build_graph(raw1)
        assert len(engine.nodes) == 1

        raw2 = {
            "nodes": [
                {
                    "id": "b",
                    "type": "file",
                    "label": "B",
                    "path": "/b",
                    "metadata": {},
                    "position": {"x": 1, "y": 1},
                }
            ],
            "edges": [],
        }
        engine.build_graph(raw2)
        assert len(engine.nodes) == 1
        assert "b" in engine.nodes
        assert "a" not in engine.nodes


def test_update_node_metadata_persists():
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "test.db"
        engine = GraphEngine(db_path=db)

        raw = {
            "nodes": [
                {
                    "id": "n1",
                    "type": "document",
                    "label": "Doc",
                    "path": "/doc",
                    "metadata": {"views": 0},
                    "position": None,
                }
            ],
            "edges": [],
        }
        engine.build_graph(raw)
        engine.update_node_metadata("n1", {"views": 5})

        conn = sqlite3.connect(db)
        row = conn.execute("SELECT metadata FROM nodes WHERE id = ?", ("n1",)).fetchone()
        conn.close()

        assert json.loads(row[0]) == {"views": 5}
        assert engine.nodes["n1"].metadata == {"views": 5}


def test_rebuild_graph_is_atomic():
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "test.db"
        engine = GraphEngine(db_path=db)

        raw1 = {
            "nodes": [
                {
                    "id": "a",
                    "type": "folder",
                    "label": "A",
                    "path": "/a",
                    "metadata": {},
                    "position": None,
                }
            ],
            "edges": [],
        }
        engine.build_graph(raw1)

        raw2 = {
            "nodes": [
                {
                    "id": "b",
                    "type": "file",
                    "label": "B",
                    "path": "/b",
                    "metadata": {},
                    "position": None,
                }
            ],
            "edges": [],
        }
        result = engine.rebuild_graph(raw2)
        assert len(result["nodes"]) == 1
        assert result["nodes"][0]["id"] == "b"

        conn = sqlite3.connect(db)
        count = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
        conn.close()
        assert count == 1


def test_restore_backup():
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "test.db"
        engine = GraphEngine(db_path=db)

        raw1 = {
            "nodes": [
                {
                    "id": "a",
                    "type": "folder",
                    "label": "A",
                    "path": "/a",
                    "metadata": {},
                    "position": None,
                }
            ],
            "edges": [],
        }
        engine.build_graph(raw1)
        engine.rebuild_graph({"nodes": [], "edges": []})

        restored = engine.restore_backup()
        assert restored is True
        graph = engine.load_from_db()
        assert len(graph["nodes"]) == 1
