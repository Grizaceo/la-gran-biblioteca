import tempfile
from pathlib import Path
from backend.scan_workspaces import scan_workspaces


def test_scan_empty_directory():
    with tempfile.TemporaryDirectory() as tmp:
        result = scan_workspaces(root=Path(tmp))
        assert "nodes" in result
        assert "edges" in result
        # Root folder itself
        assert any(n["type"] == "folder" for n in result["nodes"])


def test_scan_finds_files():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "readme.md").write_text("hello")
        (root / "src").mkdir()
        (root / "src" / "main.py").write_text("print(1)")

        result = scan_workspaces(root=root)
        ids = {n["id"] for n in result["nodes"]}
        assert "file_readme.md" in ids
        assert "file_src/main.py" in ids or any("main.py" in n["id"] for n in result["nodes"])


def test_scan_truncates_children():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for i in range(5):
            (root / f"file{i}.md").write_text("x")

        result = scan_workspaces(root=root, max_children=2)
        file_nodes = [n for n in result["nodes"] if n["type"] != "folder"]
        assert len(file_nodes) <= 2
