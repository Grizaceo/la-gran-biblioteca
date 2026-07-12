"""Tests for constellation catalog and layout."""

import math

from backend.constellation_layout import (
    _ISLAND_SPHERE_RADIUS,
    _PERIPHERAL_NEAR_CENTER_RADIUS,
    apply_constellation_layout,
    load_catalog,
    suggest_constellation,
)


def test_catalog_loads_88():
    cats = load_catalog()
    assert len(cats) >= 88
    ids = {c["id"] for c in cats}
    assert "orion" in ids
    assert "ursa_major" in ids


def test_suggest_orion():
    assert suggest_constellation("orion") == "orion"
    assert suggest_constellation("Orión") == "orion"


def test_suggest_osa_mayor():
    assert suggest_constellation("osa_mayor") == "ursa_major"


def test_suggest_no_match():
    assert suggest_constellation("xyzrandomfolder123") is None


def test_deepest_anchor_wins(tmp_path):
    parent = tmp_path / "parent"
    child = parent / "child"
    child.mkdir(parents=True)
    file_a = child / "a.md"
    file_a.write_text("# test", encoding="utf-8")

    graph = {
        "nodes": [
            {
                "id": "folder_parent",
                "type": "folder",
                "label": "parent",
                "path": str(parent.resolve()),
                "metadata": {"depth": 0},
                "position": {"x": 0, "y": 0},
            },
            {
                "id": "folder_child",
                "type": "folder",
                "label": "child",
                "path": str(child.resolve()),
                "metadata": {"depth": 1},
                "position": {"x": 150, "y": 150},
            },
            {
                "id": "file_a",
                "type": "document",
                "label": "a.md",
                "path": str(file_a.resolve()),
                "metadata": {"depth": 2},
                "position": {"x": 150, "y": 300},
            },
        ],
        "edges": [
            {"source": "folder_parent", "target": "folder_child", "type": "contains"},
            {"source": "folder_child", "target": "file_a", "type": "contains"},
        ],
    }
    prefs = [
        {
            "folder_path": str(parent.resolve()),
            "constellation_id": "leo",
            "status": "confirmed",
            "suggested_from": "manual",
        },
        {
            "folder_path": str(child.resolve()),
            "constellation_id": "orion",
            "status": "confirmed",
            "suggested_from": "manual",
        },
    ]
    out = apply_constellation_layout(graph, prefs)
    child_node = next(n for n in out["nodes"] if n["id"] == "folder_child")
    assert child_node["metadata"].get("constellation_id") == "orion"
    assert "z" in child_node["position"]


def test_unanchored_peripheral_cloud(tmp_path):
    other = tmp_path / "other"
    other.mkdir()
    graph = {
        "nodes": [
            {
                "id": "folder_other",
                "type": "folder",
                "label": "other",
                "path": str(other.resolve()),
                "metadata": {},
                "position": {"x": 99, "y": 88},
            },
        ],
        "edges": [],
    }
    anchored = tmp_path / "anchored"
    anchored.mkdir()
    out = apply_constellation_layout(
        graph,
        [
            {
                "folder_path": str(anchored.resolve()),
                "constellation_id": "orion",
                "status": "confirmed",
                "suggested_from": "manual",
            },
        ],
    )
    node = out["nodes"][0]
    pos = node["position"]
    assert "z" in pos
    r = math.hypot(pos["x"], pos["y"], pos.get("z", 0))
    assert r < _PERIPHERAL_NEAR_CENTER_RADIUS * 2.5


def test_top_level_islands_clustered(tmp_path):
    catalog_ids = [c["id"] for c in load_catalog()]
    roots = []
    prefs = []
    nodes = []
    for i in range(6):
        folder = tmp_path / f"root_{i}"
        folder.mkdir()
        path = str(folder.resolve())
        roots.append(path)
        cid = catalog_ids[i % len(catalog_ids)]
        nodes.append(
            {
                "id": f"folder_{i}",
                "type": "folder",
                "label": f"root_{i}",
                "path": path,
                "metadata": {"depth": 0},
                "position": {"x": i * 500, "y": 0, "z": 0},
            }
        )
        prefs.append(
            {
                "folder_path": path,
                "constellation_id": cid,
                "status": "confirmed",
                "suggested_from": "manual",
            }
        )

    out = apply_constellation_layout({"nodes": nodes, "edges": []}, prefs)
    positions = []
    for n in out["nodes"]:
        p = n["position"]
        positions.append((p["x"], p["y"], p.get("z", 0.0)))

    cx = sum(p[0] for p in positions) / len(positions)
    cy = sum(p[1] for p in positions) / len(positions)
    cz = sum(p[2] for p in positions) / len(positions)
    # Island origins sit on a sphere of _ISLAND_SPHERE_RADIUS; center can drift
    # proportionally to the radius (20% factor matches layout spread).
    _center_threshold = _ISLAND_SPHERE_RADIUS * 0.2
    assert abs(cx) < _center_threshold
    assert abs(cy) < _center_threshold
    assert abs(cz) < _center_threshold

    max_pair = 0.0
    for i, a in enumerate(positions):
        for b in positions[i + 1 :]:
            d = math.dist(a, b)
            max_pair = max(max_pair, d)
    # Island origins sit on a sphere of _ISLAND_SPHERE_RADIUS; star layout adds inner spread.
    assert max_pair < 2.8 * _ISLAND_SPHERE_RADIUS
