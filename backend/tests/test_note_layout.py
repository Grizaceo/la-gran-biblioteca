"""Tests for note satellite nodes and orbital layout."""

from __future__ import annotations

from pathlib import Path

from backend.note_layout import (
    apply_inline_note_nodes,
    apply_note_orbit_layout,
    apply_note_graph_enrichment,
)


def test_orbit_layout_places_notes_around_source(tmp_path: Path):
    source_id = "file_books/book.md"
    graph = {
        "nodes": [
            {
                "id": source_id,
                "type": "document",
                "label": "book.md",
                "path": str(tmp_path / "books" / "book.md"),
                "metadata": {},
                "position": {"x": 100, "y": 200, "z": 0},
            },
            {
                "id": "inline_note_file_books__book.md_aaa11111",
                "type": "note",
                "label": "N1",
                "path": "books/book.md",
                "metadata": {
                    "storage": "inline",
                    "source_node_id": source_id,
                    "orbit_anchor": source_id,
                    "note_id": "aaa11111",
                },
                "position": {"x": 0, "y": 0, "z": 0},
            },
            {
                "id": "inline_note_file_books__book.md_bbb22222",
                "type": "note",
                "label": "N2",
                "path": "books/book.md",
                "metadata": {
                    "storage": "inline",
                    "source_node_id": source_id,
                    "orbit_anchor": source_id,
                    "note_id": "bbb22222",
                },
                "position": {"x": 0, "y": 0, "z": 0},
            },
        ],
        "edges": [],
    }
    out = apply_note_orbit_layout(graph)
    n1 = next(n for n in out["nodes"] if n["id"].endswith("aaa11111"))
    n2 = next(n for n in out["nodes"] if n["id"].endswith("bbb22222"))
    sx, sy = 100, 200
    d1 = ((n1["position"]["x"] - sx) ** 2 + (n1["position"]["y"] - sy) ** 2) ** 0.5
    d2 = ((n2["position"]["x"] - sx) ** 2 + (n2["position"]["y"] - sy) ** 2) ** 0.5
    assert 40 < d1 < 55
    assert 40 < d2 < 55
    assert n1["position"] != n2["position"]


def test_apply_inline_note_nodes_from_file(tmp_path: Path):
    book = tmp_path / "books"
    book.mkdir(parents=True)
    md = book / "book.md"
    md.write_text(
        """# Book

<!-- lgb-note id=feedface title="Inline" labels="idea" created="2026-05-28T12:00:00" -->
Inline body here.
<!-- /lgb-note -->
""",
        encoding="utf-8",
    )
    source_id = "file_books/book.md"
    graph = {
        "nodes": [
            {
                "id": source_id,
                "type": "document",
                "label": "book.md",
                "path": str(md.resolve()),
                "metadata": {},
                "position": {"x": 0, "y": 0, "z": 0},
            }
        ],
        "edges": [],
    }
    out = apply_inline_note_nodes(graph, tmp_path)
    note_nodes = [n for n in out["nodes"] if n.get("type") == "note"]
    assert len(note_nodes) == 1
    assert note_nodes[0]["metadata"]["note_id"] == "feedface"
    annotates = [e for e in out["edges"] if e.get("type") == "annotates"]
    assert len(annotates) == 1
    assert annotates[0]["target"] == source_id


def test_note_graph_enrichment_counts(tmp_path: Path):
    source_id = "file_doc.md"
    graph = {
        "nodes": [
            {
                "id": source_id,
                "type": "document",
                "label": "doc.md",
                "path": str(tmp_path / "doc.md"),
                "metadata": {},
                "position": {"x": 0, "y": 0, "z": 0},
            },
            {
                "id": "inline_note_file_doc.md_abcd1234",
                "type": "note",
                "label": "n",
                "path": "doc.md",
                "metadata": {"orbit_anchor": source_id, "source_node_id": source_id},
                "position": {"x": 10, "y": 0, "z": 0},
            },
        ],
        "edges": [],
    }
    out = apply_note_graph_enrichment(graph, tmp_path, apply_orbit=True)
    source = next(n for n in out["nodes"] if n["id"] == source_id)
    assert source["metadata"].get("inline_note_count") == 1
