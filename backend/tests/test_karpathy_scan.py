"""Karpathy wiki scan tests."""

from backend.graph_engine import GraphEngine
from backend.scan.karpathy import detect_karpathy_workspace
from backend.services.graph_pipeline import get_last_scan_stats, scan_raw_graph


def test_detect_karpathy_workspace(tmp_path):
    ws = tmp_path / "wiki"
    ws.mkdir()
    (ws / "index.md").write_text("## Topic\n\n[[note-a]]", encoding="utf-8")
    (ws / "note-a.md").write_text("# A", encoding="utf-8")
    assert detect_karpathy_workspace(ws) is True
    assert detect_karpathy_workspace(tmp_path / "empty") is False


def test_karpathy_categories_and_backlinks(tmp_path):
    vault = tmp_path / "vault"
    ws = vault / "ml"
    ws.mkdir(parents=True)
    (ws / "index.md").write_text(
        "## Foundations\n\n[[linear.md]]\n\n## Advanced\n\n[[transformer.md]]",
        encoding="utf-8",
    )
    (ws / "linear.md").write_text("# Linear\n\nSee [[transformer.md]]", encoding="utf-8")
    (ws / "transformer.md").write_text("# Transformer", encoding="utf-8")

    engine = GraphEngine(db_path=tmp_path / "k.db")
    raw = scan_raw_graph(
        root=vault, max_files=50, max_children=20, engine=engine, incremental=False
    )

    stats = get_last_scan_stats()
    assert stats.get("wiki_pattern") == "karpathy"
    assert "ml/Foundations" in (stats.get("categories") or [])

    transformer_id = "file_ml/transformer.md"
    tr_node = next(n for n in raw["nodes"] if n["id"] == transformer_id)
    assert any(
        bl["id"] == "file_ml/linear.md"
        for bl in (tr_node.get("metadata") or {}).get("backlinks", [])
    )

    cat_edges = [e for e in raw["edges"] if e.get("type") == "categorized_under"]
    assert len(cat_edges) >= 2

    tour = engine.get_exploration_tour("ml")
    assert tour is not None
    assert len(tour["steps"]) >= 2
