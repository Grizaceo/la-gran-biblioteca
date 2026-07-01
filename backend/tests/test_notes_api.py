"""Tests for /api/notes endpoints."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.app_deps as app_deps
import backend.graph_state as graph_state
import backend.library_bridge as bridge
from backend.graph_engine import GraphEngine


def _setup_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, Path, str]:
    ws = tmp_path / "vault"
    ws.mkdir()
    source_file = ws / "books" / "mybook.md"
    source_file.parent.mkdir(parents=True)
    source_file.write_text("# Book\n", encoding="utf-8")
    source_id = "file_books/mybook.md"

    db = tmp_path / "library.db"
    monkeypatch.setenv("WORKSPACE_ROOT", str(ws))
    monkeypatch.setenv("DB_PATH", str(db))

    import backend.constants as constants
    import backend.services.note_service as note_svc

    monkeypatch.setattr(constants, "get_workspace_root", lambda: ws)
    monkeypatch.setattr(note_svc, "get_workspace_root", lambda: ws)

    ge = GraphEngine(db_path=db)
    bridge.engine = ge
    app_deps.engine = ge
    graph = {
        "nodes": [
            {
                "id": source_id,
                "type": "document",
                "label": "mybook.md",
                "path": str(source_file),
                "metadata": {},
                "position": None,
            }
        ],
        "edges": [],
    }
    ge.build_graph(graph)
    graph_state.set_current_graph(graph)

    return TestClient(bridge.app), ws, source_id


def test_create_and_get_note(tmp_path, monkeypatch):
    client, ws, source_id = _setup_client(tmp_path, monkeypatch)
    res = client.post(
        "/api/notes",
        json={
            "title": "Test",
            "body": "Hello note",
            "labels": ["idea"],
            "source_node_id": source_id,
            "selected_text": "quoted bit",
            "storage": "vault",
        },
    )
    assert res.status_code == 200
    data = res.json()
    note_id = data["id"]
    assert len(note_id) == 8
    note_path = ws / "_notes" / source_id.replace("/", "__") / f"{note_id}.md"
    assert note_path.is_file()
    text = note_path.read_text(encoding="utf-8")
    assert "[[mybook]]" in text
    assert "Hello note" in text

    got = client.get(f"/api/notes/{note_id}")
    assert got.status_code == 200
    assert got.json()["body"] == "Hello note"


def test_create_unknown_source(tmp_path, monkeypatch):
    client, _ws, _source_id = _setup_client(tmp_path, monkeypatch)
    res = client.post(
        "/api/notes",
        json={"body": "x", "source_node_id": "file_missing.md"},
    )
    assert res.status_code == 404


def test_create_note_with_source_path_without_graph_node(tmp_path, monkeypatch):
    """source_path lets notes save when graph index lacks the node (e.g. after cap trim)."""
    ws = tmp_path / "vault"
    ws.mkdir()
    source_file = ws / "orphan.md"
    source_file.write_text("# Orphan\n", encoding="utf-8")
    source_id = "file_orphan.md"

    db = tmp_path / "library.db"
    monkeypatch.setenv("WORKSPACE_ROOT", str(ws))
    monkeypatch.setenv("DB_PATH", str(db))

    import backend.constants as constants
    import backend.services.note_service as note_svc

    constants.get_workspace_root = lambda: ws
    note_svc.get_workspace_root = lambda: ws
    import backend.library_bridge as bridge

    bridge.WORKSPACE_ROOT = ws
    ge = GraphEngine(db_path=db)
    bridge.engine = ge
    app_deps.engine = ge
    graph_state.set_current_graph({"nodes": [], "edges": []})

    client = TestClient(bridge.app)
    res = client.post(
        "/api/notes",
        json={
            "body": "from path only",
            "source_node_id": source_id,
            "source_path": str(source_file),
            "storage": "vault",
        },
    )
    assert res.status_code == 200, res.text
    assert (
        "[[orphan]]"
        in (ws / "_notes" / source_id.replace("/", "__") / f"{res.json()['id']}.md").read_text()
    )


def test_list_notes_by_source(tmp_path, monkeypatch):
    client, _ws, source_id = _setup_client(tmp_path, monkeypatch)
    client.post(
        "/api/notes",
        json={"body": "one", "source_node_id": source_id},
    )
    client.post(
        "/api/notes",
        json={"body": "two", "source_node_id": source_id},
    )
    listed = client.get("/api/notes", params={"source": source_id})
    assert listed.status_code == 200
    assert listed.json()["total"] == 2


def test_patch_and_delete_note(tmp_path, monkeypatch):
    client, ws, source_id = _setup_client(tmp_path, monkeypatch)
    created = client.post(
        "/api/notes",
        json={"title": "Old", "body": "content", "source_node_id": source_id},
    ).json()
    note_id = created["id"]

    patched = client.patch(
        f"/api/notes/{note_id}",
        json={"title": "New title"},
    )
    assert patched.status_code == 200
    assert patched.json()["title"] == "New title"

    deleted = client.delete(f"/api/notes/{note_id}")
    assert deleted.status_code == 200
    assert not list((ws / "_notes").rglob(f"{note_id}.md"))

    assert client.get(f"/api/notes/{note_id}").status_code == 404
    assert client.patch(f"/api/notes/{note_id}", json={"title": "x"}).status_code == 404
    assert client.delete("/api/notes/ghost99").status_code == 404


def test_label_validation(tmp_path, monkeypatch):
    client, _ws, source_id = _setup_client(tmp_path, monkeypatch)
    base = {"body": "ok", "source_node_id": source_id}

    ok_labels = [f"tag{i}" for i in range(10)]
    assert client.post("/api/notes", json={**base, "labels": ok_labels}).status_code == 200

    assert (
        client.post("/api/notes", json={**base, "labels": ok_labels + ["extra"]}).status_code == 422
    )
    assert (
        client.post(
            "/api/notes",
            json={**base, "labels": ["a" * 31]},
        ).status_code
        == 422
    )
    assert client.post("/api/notes", json={**base, "labels": ["Hello"]}).status_code == 422
    assert client.post("/api/notes", json={**base, "labels": ["my label"]}).status_code == 422
    assert client.post("/api/notes", json={**base, "labels": ["my-label_2"]}).status_code == 200


def test_validate_path_under_workspace(tmp_path):
    from backend.path_utils import validate_path_under_workspace

    root = tmp_path / "root"
    root.mkdir()
    inside = validate_path_under_workspace("sub/file.md", root)
    assert inside == (root / "sub" / "file.md").resolve()

    with pytest.raises(ValueError):
        validate_path_under_workspace("/etc/passwd", root)


def test_get_node_type_note_under_notes(tmp_path, monkeypatch):
    from backend.scan.markdown import get_node_type

    monkeypatch.setenv("WORKSPACE_ROOT", str(tmp_path))
    import backend.constants as constants

    constants.WORKSPACE_ROOT = tmp_path
    (tmp_path / "_notes" / "slug").mkdir(parents=True)
    note_file = tmp_path / "_notes" / "slug" / "abc12345.md"
    note_file.write_text("---\n---\n", encoding="utf-8")
    assert get_node_type(note_file) == "note"

    doc = tmp_path / "docs" / "file.md"
    doc.parent.mkdir(parents=True)
    doc.write_text("# doc", encoding="utf-8")
    assert get_node_type(doc) == "document"

    nested = tmp_path / "_notes" / "abc" / "readme.md"
    nested.parent.mkdir(parents=True, exist_ok=True)
    nested.write_text("# idx", encoding="utf-8")
    assert get_node_type(nested) == "note"


def test_create_inline_note_in_source_file(tmp_path, monkeypatch):
    client, ws, source_id = _setup_client(tmp_path, monkeypatch)
    source_file = ws / "books" / "mybook.md"
    res = client.post(
        "/api/notes",
        json={
            "title": "Inline title",
            "body": "Inline body",
            "labels": ["idea"],
            "source_node_id": source_id,
            "storage": "inline",
            "selected_text": "Book",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["storage"] == "inline"
    note_id = data["id"]
    text = source_file.read_text(encoding="utf-8")
    assert f"id={note_id}" in text
    assert "Inline body" in text

    listed = client.get(f"/api/notes?source={source_id}")
    assert listed.status_code == 200
    ids = [n["id"] for n in listed.json()["notes"]]
    assert note_id in ids

    patched = client.patch(
        f"/api/notes/{note_id}",
        json={"body": "Updated inline"},
    )
    assert patched.status_code == 200
    assert "Updated inline" in source_file.read_text(encoding="utf-8")

    deleted = client.delete(f"/api/notes/{note_id}")
    assert deleted.status_code == 200
    assert f"id={note_id}" not in source_file.read_text(encoding="utf-8")


def test_list_merges_vault_and_inline(tmp_path, monkeypatch):
    client, ws, source_id = _setup_client(tmp_path, monkeypatch)
    client.post(
        "/api/notes",
        json={"body": "vault one", "source_node_id": source_id, "storage": "vault"},
    )
    client.post(
        "/api/notes",
        json={"body": "inline one", "source_node_id": source_id, "storage": "inline"},
    )
    listed = client.get(f"/api/notes?source={source_id}")
    assert listed.json()["total"] == 2
    storages = {n["storage"] for n in listed.json()["notes"]}
    assert storages == {"vault", "inline"}
