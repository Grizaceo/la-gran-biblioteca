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
            {"id": "n1", "type": "markdown", "label": "note.md",
             "path": str(ws / "alpha" / "note.md"), "metadata": {"tags": ["foo"]}, "position": None},
            {"id": "n2", "type": "markdown", "label": "index.md",
             "path": str(ws / "beta" / "index.md"), "metadata": {}, "position": None},
            {"id": "n3", "type": "code", "label": "script.py",
             "path": str(ws / "alpha" / "script.py"), "metadata": {}, "position": None},
        ],
        "edges": [
            {"source": "n1", "target": "n2", "type": "wikilink"},
        ],
    }
    engine.build_graph(raw)

    # Re-import mcp_server with patched env
    import backend.mcp_server as srv
    # Re-point to a fresh engine (so _load() doesn't double-count edges)
    srv._engine = GraphEngine(db_path=db)
    srv.WORKSPACE_ROOT = ws
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
