"""impact_files BFS tests."""

from backend.impact import impact_files_bfs, paths_to_node_ids
from backend.scan.layout import file_node_id


def test_impact_files_reverse_reach(tmp_path):
    root = tmp_path / "vault"
    root.mkdir()
    a = root / "a.md"
    b = root / "b.md"
    a.write_text("x", encoding="utf-8")
    b.write_text("y", encoding="utf-8")

    rel_a = a.relative_to(root).as_posix()
    rel_b = b.relative_to(root).as_posix()
    id_a = file_node_id(rel_a)
    id_b = file_node_id(rel_b)

    graph = {
        "nodes": [
            {"id": id_a, "label": "a.md", "type": "document", "path": str(a)},
            {"id": id_b, "label": "b.md", "type": "document", "path": str(b)},
        ],
        "edges": [{"source": id_a, "target": id_b, "type": "references"}],
    }

    seeds = paths_to_node_ids([str(b.relative_to(root))], root)
    result = impact_files_bfs(graph, seeds, limit=20)
    impacted_ids = {n["id"] for n in result["impacted"]}
    assert id_a in impacted_ids
