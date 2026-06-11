"""Safe directory listing for in-app folder/file picker."""

from __future__ import annotations

import os
from pathlib import Path

from .os_open import is_wsl

_SKIP_DIR_NAMES = frozenset({".git", "__pycache__", "node_modules", ".lgb", ".hermes"})
_MAX_ENTRIES = 500


def browse_roots() -> list[dict[str, str]]:
    roots: list[dict[str, str]] = [{"label": "Inicio (~)", "path": str(Path.home())}]
    if not is_wsl():
        return roots
    users = Path("/mnt/c/Users")
    if users.is_dir():
        for user in sorted(users.iterdir()):
            if user.is_dir() and not user.name.startswith("."):
                roots.append({"label": f"Windows · {user.name}", "path": str(user)})
    mnt = Path("/mnt")
    if mnt.is_dir():
        for drive in sorted(mnt.iterdir()):
            if drive.is_dir() and drive.name != "c":
                roots.append({"label": f"/mnt/{drive.name}", "path": str(drive)})
    return roots


def _allowed_roots() -> list[Path]:
    allowed = [Path.home().resolve()]
    if is_wsl():
        mnt = Path("/mnt")
        if mnt.is_dir():
            allowed.append(mnt.resolve())
    return allowed


def is_path_allowed(path: Path) -> bool:
    try:
        resolved = path.expanduser().resolve()
    except OSError:
        return False
    for root in _allowed_roots():
        try:
            if resolved.is_relative_to(root):
                return True
        except ValueError:
            continue
    return False


def resolve_browse_path(path: str | None) -> Path:
    if not path:
        return Path.home().resolve()
    try:
        resolved = Path(path).expanduser().resolve()
    except OSError as exc:
        raise ValueError(f"Invalid path: {path}") from exc
    if not is_path_allowed(resolved):
        raise ValueError("Path outside allowed browse roots")
    if not resolved.is_dir():
        raise ValueError("Not a directory")
    if not os.access(resolved, os.R_OK | os.X_OK):
        raise ValueError("Directory not readable")
    return resolved


def resolve_import_path(path: str, *, must_be_file: bool, must_be_dir: bool) -> Path:
    try:
        resolved = Path(path).expanduser().resolve()
    except OSError as exc:
        raise ValueError(f"Invalid path: {path}") from exc
    if not is_path_allowed(resolved):
        raise ValueError("Path outside allowed browse roots")
    if must_be_file and not resolved.is_file():
        raise ValueError("Not a file")
    if must_be_dir and not resolved.is_dir():
        raise ValueError("Not a directory")
    if not os.access(resolved, os.R_OK):
        raise ValueError("Path not readable")
    return resolved


def list_directory(path: Path, *, include_files: bool = True) -> dict:
    parent: str | None
    if path.parent != path:
        parent = str(path.parent) if is_path_allowed(path.parent) else None
    else:
        parent = None

    entries: list[dict[str, object]] = []
    try:
        children = sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except PermissionError as exc:
        raise ValueError("Permission denied") from exc

    for child in children:
        if child.name in _SKIP_DIR_NAMES:
            continue
        try:
            if child.is_symlink():
                continue
            is_dir = child.is_dir()
            is_file = child.is_file()
        except OSError:
            continue
        if is_dir:
            entries.append({"name": child.name, "path": str(child.resolve()), "is_dir": True})
        elif include_files and is_file:
            entries.append({"name": child.name, "path": str(child.resolve()), "is_dir": False})
        if len(entries) >= _MAX_ENTRIES:
            break

    return {
        "path": str(path),
        "parent": parent,
        "entries": entries,
        "roots": browse_roots(),
    }
