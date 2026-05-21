import pytest
import tempfile
import shutil
from pathlib import Path
from backend.os_dialog import import_selected_file, import_selected_folder

def test_import_selected_file_success():
    with tempfile.TemporaryDirectory() as tmp_dir:
        workspace_root = Path(tmp_dir) / "workspace"
        workspace_root.mkdir()
        
        # Create a source file
        src_dir = Path(tmp_dir) / "source"
        src_dir.mkdir()
        src_file = src_dir / "my_notes.md"
        src_file.write_text("Hello semantic graph", encoding="utf-8")
        
        # Import the file
        dest_path = import_selected_file(str(src_file), workspace_root)
        
        assert dest_path.exists()
        assert dest_path.name == "my_notes.md"
        assert dest_path.read_text(encoding="utf-8") == "Hello semantic graph"

def test_import_selected_file_conflict_resolution():
    with tempfile.TemporaryDirectory() as tmp_dir:
        workspace_root = Path(tmp_dir) / "workspace"
        workspace_root.mkdir()
        
        # Create first file in workspace to cause conflict
        existing_file = workspace_root / "my_notes.md"
        existing_file.write_text("Original content", encoding="utf-8")
        
        # Create a source file to import
        src_dir = Path(tmp_dir) / "source"
        src_dir.mkdir()
        src_file = src_dir / "my_notes.md"
        src_file.write_text("New imported content", encoding="utf-8")
        
        # Import the file (should rename to my_notes_1.md)
        dest_path_1 = import_selected_file(str(src_file), workspace_root)
        assert dest_path_1.name == "my_notes_1.md"
        assert dest_path_1.read_text(encoding="utf-8") == "New imported content"
        
        # Import again (should rename to my_notes_2.md)
        dest_path_2 = import_selected_file(str(src_file), workspace_root)
        assert dest_path_2.name == "my_notes_2.md"
        
        assert existing_file.read_text(encoding="utf-8") == "Original content"

def test_import_selected_folder_success_and_conflict():
    with tempfile.TemporaryDirectory() as tmp_dir:
        workspace_root = Path(tmp_dir) / "workspace"
        workspace_root.mkdir()
        
        # Create a source folder with files
        src_dir = Path(tmp_dir) / "my_folder"
        src_dir.mkdir()
        file_a = src_dir / "note_a.md"
        file_a.write_text("Note A content", encoding="utf-8")
        sub_dir = src_dir / "subdir"
        sub_dir.mkdir()
        file_b = sub_dir / "note_b.md"
        file_b.write_text("Note B content", encoding="utf-8")
        
        # Import the folder
        dest_path = import_selected_folder(str(src_dir), workspace_root)
        assert dest_path.exists()
        assert dest_path.name == "my_folder"
        assert (dest_path / "note_a.md").exists()
        assert (dest_path / "subdir" / "note_b.md").exists()
        
        # Import again causing conflict (should rename to my_folder_1)
        dest_path_conflict = import_selected_folder(str(src_dir), workspace_root)
        assert dest_path_conflict.exists()
        assert dest_path_conflict.name == "my_folder_1"
        assert (dest_path_conflict / "note_a.md").exists()
        assert (dest_path_conflict / "subdir" / "note_b.md").exists()

def test_import_non_existent_raises():
    with tempfile.TemporaryDirectory() as tmp_dir:
        workspace_root = Path(tmp_dir) / "workspace"
        workspace_root.mkdir()
        
        with pytest.raises(ValueError):
            import_selected_file(str(Path(tmp_dir) / "does_not_exist.md"), workspace_root)
            
        with pytest.raises(ValueError):
            import_selected_folder(str(Path(tmp_dir) / "does_not_exist_folder"), workspace_root)
