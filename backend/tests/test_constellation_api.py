"""Tests for constellation prefs persistence in GraphEngine."""

import pytest

from backend.graph_engine import GraphEngine
from backend.constellation_layout import suggest_constellation


@pytest.fixture
def engine(tmp_path):
    db = tmp_path / "test.db"
    return GraphEngine(db_path=db)


def test_upsert_and_list_prefs(engine, tmp_path):
    folder = tmp_path / "proj"
    folder.mkdir()
    pref = engine.upsert_constellation_pref(str(folder), "orion", "confirmed", "manual")
    assert pref["constellation_id"] == "orion"
    assert pref["status"] == "confirmed"
    listed = engine.list_constellation_prefs()
    assert len(listed) == 1
    assert listed[0]["folder_path"] == str(folder.resolve())


def test_delete_pref(engine, tmp_path):
    folder = tmp_path / "del_me"
    folder.mkdir()
    engine.upsert_constellation_pref(str(folder), "leo", "suggested", "name_match")
    assert engine.delete_constellation_pref(str(folder))
    assert engine.list_constellation_prefs() == []


def test_sync_suggestions(engine, tmp_path):
    folder = tmp_path / "orion_lab"
    folder.mkdir()
    graph = {
        "nodes": [
            {
                "id": "folder_x",
                "type": "folder",
                "label": "orion_lab",
                "path": str(folder.resolve()),
                "metadata": {"depth": 0},
            }
        ],
        "edges": [],
    }
    added = engine.sync_folder_constellation_suggestions(graph)
    assert added == 1
    prefs = engine.list_constellation_prefs()
    assert prefs[0]["status"] == "suggested"
    assert prefs[0]["constellation_id"] == suggest_constellation("orion_lab", threshold=0.85)


def test_sync_skips_generic_and_deep(engine, tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    deep = tmp_path / "a" / "b" / "c"
    deep.mkdir(parents=True)
    graph = {
        "nodes": [
            {
                "id": "f_src",
                "type": "folder",
                "label": "src",
                "path": str(src.resolve()),
                "metadata": {"depth": 0},
            },
            {
                "id": "f_deep",
                "type": "folder",
                "label": "leo_stuff",
                "path": str(deep.resolve()),
                "metadata": {"depth": 3},
            },
        ],
        "edges": [],
    }
    added = engine.sync_folder_constellation_suggestions(graph)
    assert added == 0


def test_constellation_catalog_has_leo_detail_fields():
    from backend.constellation_layout import catalog_by_id

    leo = catalog_by_id().get("leo")
    assert leo is not None
    assert leo.get("center_ra") is not None
    assert leo.get("center_dec") is not None
    assert any(s.get("name") == "Regulus" for s in leo.get("stars") or [])
