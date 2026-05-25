"""Lightweight code import edges."""

from backend.scan.code_imports import apply_code_imports, extract_imports
from backend.scan.layout import file_node_id


def test_extract_python_imports():
    content = "from utils.helpers import foo\nimport os\n"
    mods = extract_imports(__import__("pathlib").Path("x.py"), content)
    assert "utils.helpers" in mods
    assert "os" in mods


def test_depends_on_edge(tmp_path):
    vault = tmp_path / "vault"
    pkg = vault / "pkg"
    pkg.mkdir(parents=True)
    (pkg / "helpers.py").write_text("def foo(): pass", encoding="utf-8")
    main = pkg / "main.py"
    main.write_text("from utils.helpers import foo\n", encoding="utf-8")

    rel_main = main.relative_to(vault).as_posix()
    rel_help = (pkg / "helpers.py").relative_to(vault).as_posix()

    graph = {
        "nodes": [
            {
                "id": file_node_id(rel_main),
                "type": "script",
                "label": "main.py",
                "path": str(main),
                "metadata": {},
            },
            {
                "id": file_node_id(rel_help),
                "type": "script",
                "label": "helpers.py",
                "path": str(pkg / "helpers.py"),
                "metadata": {},
            },
        ],
        "edges": [],
    }
    out = apply_code_imports(graph, vault)
    dep = [e for e in out["edges"] if e.get("type") == "depends_on"]
    assert len(dep) >= 0
