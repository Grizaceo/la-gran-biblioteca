"""Tests for inline lgb-note block parsing and mutation."""

from __future__ import annotations

from pathlib import Path


from backend.scan.inline_notes import (
    build_inline_block,
    delete_inline_block,
    insert_inline_block,
    parse_inline_blocks,
    replace_inline_block,
)


def test_parse_inline_blocks():
    content = """# Doc

Some text.

<!-- lgb-note id=abc12345 title="T" labels="idea,cita" created="2026-05-28T10:00:00" -->
> "quoted bit"

Body line one.

<!-- /lgb-note -->
"""
    notes = parse_inline_blocks(content, source_path="books/x.md", source_node_id="file_books/x.md")
    assert len(notes) == 1
    n = notes[0]
    assert n["id"] == "abc12345"
    assert n["title"] == "T"
    assert n["labels"] == ["idea", "cita"]
    assert n["selected_text"] == "quoted bit"
    assert "Body line one" in n["body"]
    assert n["storage"] == "inline"
    assert n["line_start"] == 5


def test_insert_after_selection():
    content = "Para uno.\n\nPara dos con highlight aquí.\n\nFin."
    block = build_inline_block(
        note_id="deadbeef",
        title="",
        body="Nota nueva",
        labels=["idea"],
        selected_text="highlight aquí",
        created_at="2026-05-28T12:00:00",
    )
    updated = insert_inline_block(content, block, "highlight aquí")
    assert "<!-- lgb-note" in updated
    assert "Nota nueva" in updated
    notes = parse_inline_blocks(updated)
    assert len(notes) == 1
    assert notes[0]["id"] == "deadbeef"


def test_replace_and_delete_block():
    content = insert_inline_block(
        "Hello",
        build_inline_block(
            note_id="aabbccdd",
            title="A",
            body="First",
            labels=[],
            selected_text="",
            created_at="2026-05-28T12:00:00",
        ),
    )
    new_block = build_inline_block(
        note_id="aabbccdd",
        title="B",
        body="Second",
        labels=["task"],
        selected_text="",
        created_at="2026-05-28T12:00:00",
    )
    replaced = replace_inline_block(content, "aabbccdd", new_block)
    notes = parse_inline_blocks(replaced)
    assert notes[0]["title"] == "B"
    assert notes[0]["body"] == "Second"

    deleted = delete_inline_block(replaced, "aabbccdd")
    assert parse_inline_blocks(deleted) == []


def test_insert_append_when_no_selection(tmp_path: Path):
    f = tmp_path / "doc.md"
    f.write_text("# Title\n\nContent.", encoding="utf-8")
    block = build_inline_block(
        note_id="11223344",
        title="",
        body="End note",
        labels=[],
        selected_text="",
        created_at="2026-05-28T12:00:00",
    )
    updated = insert_inline_block(f.read_text(encoding="utf-8"), block)
    f.write_text(updated, encoding="utf-8")
    assert parse_inline_blocks(f.read_text(encoding="utf-8"))[0]["body"] == "End note"
