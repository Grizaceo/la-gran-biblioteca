"""Tests for workspace_watcher.py - watchdog event handling."""
import asyncio
import tempfile
from pathlib import Path
import pytest


def test_excluded_dirs_are_filtered():
    """Test that excluded directories are properly filtered."""
    from workspace_watcher import is_valid_path, EXCLUDE_DIRS
    
    # .hermes is in EXCLUDE_DIRS, so any path containing it should be excluded
    assert is_valid_path("/home/user/.hermes/workspaces/test.md") == False  # .hermes excluded
    assert is_valid_path("/home/user/project/__pycache__/test.py") == False  # __pycache__ excluded
    assert is_valid_path("/home/user/project/node_modules/test.js") == False  # node_modules excluded
    
    # Normal paths should pass
    assert is_valid_path("/home/user/project/test.md") == True
    assert is_valid_path("/home/user/project/data.json") == True


def test_valid_extensions():
    """Test that watched file extensions are recognized."""
    from workspace_watcher import is_valid_path, SCAN_EXTENSIONS
    
    # Valid extensions should pass
    for ext in SCAN_EXTENSIONS:
        assert is_valid_path(f"/workspace/file{ext}") == True, f"Extension {ext} should be valid"
    
    # Hidden files in workspace should be excluded
    assert is_valid_path("/workspace/.hidden.md") == False


def test_directory_handling():
    """Test that directories are handled specially."""
    from workspace_watcher import is_valid_path
    
    # Directories don't have suffixes, so they pass the suffix check
    # but are filtered by EXCLUDE_DIRS
    assert is_valid_path("/workspace/.hermes") == False  # hidden dir excluded
    assert is_valid_path("/workspace/.git") == False  # hidden dir excluded  
    assert is_valid_path("/workspace/src") == True  # regular dir passes


def test_on_created_modified_deleted():
    """Test that handlers don't raise errors."""
    from workspace_watcher import WorkspaceEventHandler
    
    loop = asyncio.new_event_loop()
    queue = asyncio.Queue()
    handler = WorkspaceEventHandler(loop, queue)
    
    class MockEvent:
        def __init__(self, src_path, is_dir=False):
            self.src_path = src_path
            self.is_directory = is_dir
    
    # These should not raise errors
    handler.on_created(MockEvent("/workspace/test.md"))
    handler.on_modified(MockEvent("/workspace/test.md"))
    handler.on_deleted(MockEvent("/workspace/test.md"))


def test_start_watcher_returns_observer():
    """Test that start_watcher returns a valid Observer instance."""
    from workspace_watcher import start_watcher
    from watchdog.observers import Observer
    
    with tempfile.TemporaryDirectory() as tmpdir:
        loop = asyncio.new_event_loop()
        queue = asyncio.Queue()
        
        observer = start_watcher(tmpdir, loop, queue)
        
        assert observer is not None
        assert isinstance(observer, Observer)
        assert observer.is_alive()
        
        # Cleanup
        observer.stop()
        observer.join()


def test_handler_enqueue_thread_safety():
    """Test that handler uses call_soon_threadsafe for queue operations."""
    from workspace_watcher import WorkspaceEventHandler
    
    loop = asyncio.new_event_loop()
    queue = asyncio.Queue()
    handler = WorkspaceEventHandler(loop, queue)
    
    class MockEvent:
        def __init__(self, src_path):
            self.src_path = src_path
            self.is_directory = False
    
    # on_created uses call_soon_threadsafe - should not block
    handler.on_created(MockEvent("/workspace/valid.md"))
    
    # Queue operation happens asynchronously via call_soon_threadsafe
    # Give it a moment to process
    import time
    time.sleep(0.01)
    
    # The path won't be enqueued if filtered by is_valid_path
    # This test mainly verifies no exception is raised