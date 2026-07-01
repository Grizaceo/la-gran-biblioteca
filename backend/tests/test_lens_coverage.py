"""Tests for ExplorationLens and coverage summarize_group metrics."""

from __future__ import annotations

from backend.graph_enrichment import build_graph_structure_summary, enrich_graph_metadata
from backend.lens import (
    DEFAULT_LENS,
    lens_to_search_params,
    preset_lens,
    validate_lens,
)
from backend.lens_session import get_session_lens, publish_session_lens


def _sample_graph(root):
    nodes = [
        {
            "id": "a",
            "type": "markdown",
            "label": "A",
            "path": str(root / "ws" / "a.md"),
            "metadata": {"study_count": 2, "topics": ["ml"]},
            "position": {"x": 0, "y": 0},
            "degree": 1,
        },
        {
            "id": "b",
            "type": "markdown",
            "label": "B",
            "path": str(root / "ws" / "b.md"),
            "metadata": {"study_count": 0, "topics": []},
            "position": {"x": 10, "y": 0},
            "degree": 1,
        },
    ]
    edges = [{"source": "a", "target": "b", "type": "references"}]
    return {"nodes": nodes, "edges": edges}


def test_summarize_group_study_metrics(tmp_path):
    root = tmp_path
    (root / "ws").mkdir(parents=True)
    graph = enrich_graph_metadata(_sample_graph(root), root)
    summary = build_graph_structure_summary(graph["nodes"], graph["edges"], root)
    ws = summary["modes"]["workspace"][0]
    assert ws["count"] == 2
    assert ws["studied_count"] == 1
    assert ws["study_ratio"] == 0.5
    assert ws["avg_degree"] >= 0
    assert ws["study_score_sum"] >= 0


def test_validate_lens_round_trip():
    raw = {
        "version": 1,
        "label": "Test",
        "workspaces": ["papers"],
        "studyFilter": "unstudied",
        "heatmap": "study",
        "highlightNodeIds": ["n1"],
        "depth": 2,
    }
    lens = validate_lens(raw)
    assert lens["workspaces"] == ["papers"]
    assert lens["studyFilter"] == "unstudied"
    assert lens["heatmap"] == "study"
    assert lens["highlightNodeIds"] == ["n1"]
    assert lens["depth"] == 2


def test_lens_to_search_params():
    lens = validate_lens(
        {
            "workspaces": ["ws"],
            "topics": ["ml"],
            "folders": ["ws/sub"],
            "studyFilter": "studied",
            "minDegree": 3,
        }
    )
    params = lens_to_search_params(lens)
    assert params["workspace"] == "ws"
    assert params["topic"] == "ml"
    assert params["folder_prefix"] == "ws/sub"
    assert params["studied"] == "studied"
    assert params["min_degree"] == 3


def test_presets():
    study = preset_lens("heatmap_study")
    assert study["heatmap"] == "study"
    gaps = preset_lens("gaps_unstudied")
    assert gaps["studyFilter"] == "unstudied"
    assert gaps["heatmap"] == "study"


def test_publish_and_get_session_lens(tmp_path, monkeypatch):
    from backend import lens_session

    monkeypatch.setattr(lens_session, "_SESSION_FILE", tmp_path / "session_lens.json")
    publish_session_lens(
        validate_lens({**DEFAULT_LENS, "label": "Agent view", "heatmap": "volume"}),
        updated_by="mcp",
        focus_node_id="node-1",
        highlight_ids=["a", "b"],
    )
    session = get_session_lens()
    assert session["lens"]["label"] == "Agent view"
    assert session["lens"]["heatmap"] == "volume"
    assert session["lens"]["focusNodeId"] == "node-1"
    assert session["updated_by"] == "mcp"
    assert "a" in session["lens"]["highlightNodeIds"]
