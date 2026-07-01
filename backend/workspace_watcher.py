import asyncio
from pathlib import Path
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer
import logging

from .constants import EXCLUDE_DIRS, SCAN_EXTENSIONS

logger = logging.getLogger(__name__)


def is_valid_path(path_str: str) -> bool:
    path = Path(path_str)
    # Ignore hidden files/folders (except .hermes if it's the root, but we exclude .hermes in EXCLUDE_DIRS anyway)
    if any(part.startswith(".") and part != "." for part in path.parts):
        return False
    # Ignore excluded dirs
    if any(part in EXCLUDE_DIRS for part in path.parts):
        return False
    # If it's a file, check extension
    if path.is_file():
        if path.suffix.lower() not in SCAN_EXTENSIONS:
            return False
    return True


class WorkspaceEventHandler(FileSystemEventHandler):
    def __init__(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
        self.loop = loop
        self.queue = queue

    def _enqueue(self, event_type: str, path: str, is_directory: bool):
        if is_valid_path(path):
            self.loop.call_soon_threadsafe(
                self.queue.put_nowait,
                {"event_type": event_type, "path": path, "is_directory": is_directory},
            )

    def on_created(self, event):
        self._enqueue("created", event.src_path, event.is_directory)

    def on_deleted(self, event):
        self._enqueue("deleted", event.src_path, event.is_directory)

    def on_modified(self, event):
        self._enqueue("modified", event.src_path, event.is_directory)

    def on_moved(self, event):
        self._enqueue("deleted", event.src_path, event.is_directory)
        if hasattr(event, "dest_path"):
            self._enqueue("created", event.dest_path, event.is_directory)


def start_watcher(path: str, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue) -> Observer:
    event_handler = WorkspaceEventHandler(loop, queue)
    observer = Observer()
    observer.schedule(event_handler, path, recursive=True)
    observer.start()
    logger.info(f"Started watchdog observer on {path}")
    return observer
