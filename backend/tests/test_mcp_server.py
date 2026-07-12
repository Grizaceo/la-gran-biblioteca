"""Tests for the MCP server tools using a fixture graph."""

import pytest

# ---------------------------------------------------------------------------
# Fixture setup — patch DB_PATH before importing mcp_server
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def isolated_mcp(tmp_path, monkeypatch):
    """Patch the engine and graph state to use a temp DB + fixture data."""
    db = tmp_path / "test.db"
    monkeypatch.setenv("DB_PATH", str(db))
    monkeypatch.setenv("WORKSPACE_ROOT", str(tmp_path / "workspaces"))

    ws = tmp_path / "workspaces"
    ws.mkdir()
    (ws / "alpha").mkdir()
    (ws / "beta").mkdir()
    (ws / "alpha" / "note.md").write_text("# Hello\n[[beta/index]]", encoding="utf-8")
    (ws / "beta" / "index.md").write_text("# Beta index", encoding="utf-8")
    (ws / "alpha" / "script.py").write_text("print('hi')", encoding="utf-8")

    # Build DB
    from backend.graph_engine import GraphEngine

    engine = GraphEngine(db_path=db)
    raw = {
        "nodes": [
            {
                "id": "n1",
                "type": "markdown",
                "label": "note.md",
                "path": str(ws / "alpha" / "note.md"),
                "metadata": {"tags": ["foo"]},
                "position": None,
            },
            {
                "id": "n2",
                "type": "markdown",
                "label": "index.md",
                "path": str(ws / "beta" / "index.md"),
                "metadata": {},
                "position": None,
            },
            {
                "id": "n3",
                "type": "code",
                "label": "script.py",
                "path": str(ws / "alpha" / "script.py"),
                "metadata": {},
                "position": None,
            },
        ],
        "edges": [
            {"source": "n1", "target": "n2", "type": "wikilink"},
        ],
    }
    engine.build_graph(raw)

    # Re-import mcp_server with patched env
    import backend.constants as constants
    import backend.mcp_server as srv
    import backend.mcp as mcp_mod

    constants.WORKSPACE_ROOT = ws
    monkeypatch.setattr(constants, "get_workspace_root", lambda: ws)
    # Re-point to a fresh engine in both mcp_server (re-export) and backend.mcp (source)
    srv._engine = GraphEngine(db_path=db)
    mcp_mod._engine = srv._engine
    srv.WORKSPACE_ROOT = ws
    mcp_mod.WORKSPACE_ROOT = ws
    srv._load()

    yield srv, ws


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_overview_counts(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.overview()
    assert result["total_nodes"] == 3
    assert result["total_edges"] == 1
    assert "markdown" in result["by_type"]
    assert result["by_type"]["markdown"] == 2
    assert result["by_type"]["code"] == 1
    assert len(result["top_workspaces"]) >= 2


def test_search_all(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.search("")
    assert result["total"] == 3
    assert result["has_more"] is False


def test_search_by_query(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.search("note")
    assert result["total"] == 1
    assert result["results"][0]["id"] == "n1"


def test_search_by_type(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.search("", node_type="code")
    assert result["total"] == 1
    assert result["results"][0]["id"] == "n3"


def test_search_by_tag(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.search("", tag="foo")
    assert result["total"] == 1
    assert result["results"][0]["id"] == "n1"


def test_search_by_workspace(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.search("", workspace="alpha")
    assert result["total"] == 2


def test_search_hubs_mode(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.search("", mode="hub")
    assert result["total"] >= 1
    assert result["results"][0]["why"].startswith("hub")


def test_subgraph(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.subgraph("n1", depth=1, direction="out")
    ids = {node["id"] for node in result["nodes"]}
    assert "n1" in ids
    assert "n2" in ids


def test_get_node_found(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.get_node("n1")
    assert result["id"] == "n1"
    assert len(result["out_edges"]) == 1
    assert result["out_edges"][0]["target"] == "n2"
    assert result["in_edges"] == []


def test_get_node_not_found(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.get_node("missing")
    assert "error" in result


def test_read_node_content(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.read_node("n1")
    assert "Hello" in result["content"]
    assert result["lang"] == "markdown"
    assert result["truncated"] is False


def test_read_node_max_chars(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.read_node("n1", max_chars=3)
    assert result["truncated"] is True
    assert len(result["content"]) <= 3


def test_neighbors_out(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.neighbors("n1", direction="out")
    ids = {n["id"] for n in result["nodes"]}
    assert "n2" in ids
    assert "n3" not in ids


def test_neighbors_in(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.neighbors("n2", direction="in")
    ids = {n["id"] for n in result["nodes"]}
    assert "n1" in ids


def test_mark_studied(isolated_mcp):
    srv, ws = isolated_mcp
    r1 = srv.mark_studied("n1")
    assert r1["study_count"] == 1
    r2 = srv.mark_studied("n1")
    assert r2["study_count"] == 2


def test_mark_studied_not_found(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.mark_studied("ghost")
    assert "error" in result


def test_create_file(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.create_file("alpha/new_note.md", content="# New")
    assert result["status"] == "ok"
    assert (ws / "alpha" / "new_note.md").read_text() == "# New"


def test_create_file_outside_workspace(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.create_file("/etc/passwd")
    assert "error" in result


def test_create_folder(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.create_folder("gamma/sub")
    assert result["status"] == "ok"
    assert (ws / "gamma" / "sub").is_dir()


def test_open_in_os_blocked_by_default(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.open_in_os("n1")
    assert "error" in result
    assert "LGB_MCP_ALLOW_OS_OPEN" in result["error"]


def test_list_workspaces(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.list_workspaces()
    names = [w["workspace"] for w in result]
    assert "alpha" in names
    assert "beta" in names


def test_explore_composite(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.explore("note", depth=1, limit=3)
    assert result["search"]["total"] >= 1
    assert result["focus"] is not None
    assert result["focus"]["node_id"] == "n1"
    assert len(result["previews"]) >= 1
    assert "Hello" in (result["previews"][0].get("content") or "")


def test_impact_files(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.impact_files([str(ws / "beta" / "index.md")])
    assert "impacted" in result
    impacted_ids = {n["id"] for n in result["impacted"]}
    assert "n1" in impacted_ids


def test_get_tour_missing(isolated_mcp):
    srv, ws = isolated_mcp
    result = srv.get_tour("nonexistent")
    assert "error" in result


def test_mcp_create_list_delete_note(isolated_mcp, monkeypatch):
    srv, ws = isolated_mcp
    source_id = "n1"
    with srv._lock:
        srv._node_index[source_id] = {
            "id": source_id,
            "type": "markdown",
            "label": "note.md",
            "path": str(ws / "alpha" / "note.md"),
            "metadata": {},
        }

    import backend.constants as constants
    import backend.services.note_service as note_svc

    monkeypatch.setattr(constants, "get_workspace_root", lambda: ws)
    monkeypatch.setattr(note_svc, "get_workspace_root", lambda: ws)
    import backend.graph_state as gs

    monkeypatch.setattr(
        gs,
        "get_node_by_id",
        lambda nid: srv._node_index.get(nid),
    )

    created = srv.create_note(source_id, body="MCP body", title="MCP title", labels=["idea"])
    assert created.get("status") == "ok"
    note_id = created["id"]
    note_path = ws / "_notes" / source_id.replace("/", "__") / f"{note_id}.md"
    assert note_path.is_file()

    listed = srv.list_notes(source_id)
    assert listed["total"] >= 1
    assert any(n["id"] == note_id for n in listed["notes"])

    deleted = srv.delete_note(note_id)
    assert deleted.get("status") == "ok"
    assert not note_path.exists()


def test_mcp_get_update_search_notes(isolated_mcp, monkeypatch):
    srv, ws = isolated_mcp
    source_id = "n1"
    with srv._lock:
        srv._node_index[source_id] = {
            "id": source_id,
            "type": "markdown",
            "label": "note.md",
            "path": str(ws / "alpha" / "note.md"),
            "metadata": {},
        }

    import backend.constants as constants
    import backend.services.note_service as note_svc

    monkeypatch.setattr(constants, "get_workspace_root", lambda: ws)
    monkeypatch.setattr(note_svc, "get_workspace_root", lambda: ws)
    import backend.graph_state as gs

    monkeypatch.setattr(gs, "get_node_by_id", lambda nid: srv._node_index.get(nid))
    monkeypatch.setattr(
        gs, "get_current_graph", lambda: {"nodes": list(srv._node_index.values()), "edges": []}
    )
    monkeypatch.setattr(srv, "_rescan_and_reload", lambda: srv._graph)
    import backend.mcp as mcp_mod
    monkeypatch.setattr(mcp_mod, "_rescan_and_reload", lambda: srv._graph)

    created = srv.create_note(
        source_id,
        body="Searchable body",
        title="Find me",
        labels=["pregunta"],
        storage="vault",
    )
    assert created.get("status") == "ok"
    note_id = created["id"]

    got = srv.get_note(note_id)
    assert got.get("title") == "Find me"
    assert got.get("storage") == "vault"

    updated = srv.update_note(note_id, body="Updated via MCP")
    assert updated.get("status") == "ok"
    assert updated.get("body") == "Updated via MCP"

    found = srv.search_notes(query="Updated via MCP")
    assert found.get("total", 0) >= 1
    assert any(n["id"] == note_id for n in found["notes"])

    node = srv.get_node(source_id)
    assert "attached_notes" in node
    assert node["attached_notes"]["total"] >= 1

    srv.delete_note(note_id)
