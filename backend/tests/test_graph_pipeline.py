"""MCP/HTTP graph pipeline parity."""

from unittest.mock import patch

import pytest

from backend.graph_engine import GraphEngine
from backend.services.graph_pipeline import (
    finalize_raw_graph,
    import_ensure_paths,
    rebuild_graph,
    scan_raw_graph,
)


@pytest.fixture
def tiny_workspace(tmp_path):
    ws = tmp_path / "vault"
    ws.mkdir()
    (ws / "alpha.md").write_text("# Alpha\n\n[[beta]]", encoding="utf-8")
    sub = ws / "proj"
    sub.mkdir()
    (sub / "beta.md").write_text("---\ntitle: Beta\n---\n", encoding="utf-8")
    arch = ws / "archive"
    arch.mkdir()
    (arch / "old.md").write_text("hidden", encoding="utf-8")
    return ws


@pytest.fixture
def engine(tmp_path):
    return GraphEngine(db_path=tmp_path / "pipeline.db")


def test_scan_raw_graph_respects_archive_exclude(tiny_workspace, engine):
    raw = scan_raw_graph(root=tiny_workspace, max_files=100, max_children=20)
    paths = {n.get("path", "") for n in raw["nodes"]}
    assert not any("archive" in p for p in paths if p)
    assert any("alpha.md" in p for p in paths)


def test_finalize_applies_without_confirmed_prefs(tiny_workspace, engine):
    raw = scan_raw_graph(root=tiny_workspace, max_files=100, max_children=20)
    out = finalize_raw_graph(raw, engine)
    assert len(out["nodes"]) == len(raw["nodes"])


def test_rebuild_graph_matches_manual_pipeline(tiny_workspace, engine):
    raw = scan_raw_graph(root=tiny_workspace, max_files=100, max_children=20)
    raw = finalize_raw_graph(raw, engine)
    manual = engine.rebuild_graph(raw)

    unified = rebuild_graph(
        engine,
        root=tiny_workspace,
        use_rebuild=True,
        max_files=100,
        max_children=20,
    )
    assert len(unified["nodes"]) == len(manual["nodes"])
    assert len(unified["edges"]) == len(manual["edges"])


def test_import_ensure_paths_includes_github_root(tmp_path, engine):
    ws = tmp_path / "vault"
    ws.mkdir()
    gh = ws / "imports" / "github" / "demo"
    gh.mkdir(parents=True)
    with patch("backend.services.graph_pipeline.WORKSPACE_ROOT", ws):
        paths = import_ensure_paths([], extra=[ws / "imports" / "arxiv" / "x.md"])
    assert any(p.name == "demo" for p in paths)
