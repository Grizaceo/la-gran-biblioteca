"""Normalize paths between Windows, WSL (/mnt/c), and Linux home layouts."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

_WIN_PATH_RE = re.compile(r"^[A-Za-z]:[/\\]")

_IS_WSL: bool | None = None


def is_wsl() -> bool:
    global _IS_WSL
    if _IS_WSL is None:
        try:
            with open("/proc/version") as f:
                _IS_WSL = "microsoft" in f.read().lower()
        except Exception:
            _IS_WSL = False
    return _IS_WSL


def is_windows_path(path_str: str) -> bool:
    return bool(_WIN_PATH_RE.match(path_str.strip()))


def _safe_resolve(root: Path, rel: str) -> Path | None:
    """Resolve a relative path under root, rejecting traversal escapes."""
    try:
        candidate = (root / rel).resolve()
        if candidate.is_relative_to(root):
            return candidate
    except (OSError, ValueError):
        pass
    return None


def path_from_node_id(node_id: str, workspace_root: Path) -> Path | None:
    """
    Canonical filesystem path from scanner node id (file_<rel> / folder_<rel>).
    """
    root = workspace_root.resolve()
    if node_id.startswith("file_"):
        rel = node_id[5:].replace("\\", "/")
        return _safe_resolve(root, rel)
    if node_id.startswith("folder_"):
        rel = node_id[7:].replace("\\", "/")
        return root if rel == "dot" else _safe_resolve(root, rel)
    return None


def _match_child_dir(parent: Path, name: str) -> Path | None:
    direct = parent / name
    if direct.exists():
        return direct
    lower = name.lower()
    try:
        for child in parent.iterdir():
            if child.is_dir() and child.name.lower() == lower:
                return child
    except OSError:
        return None
    return None


def _match_child_file(parent: Path, name: str) -> Path | None:
    direct = parent / name
    if direct.exists():
        return direct
    lower = name.lower()
    try:
        for child in parent.iterdir():
            if child.is_file() and child.name.lower() == lower:
                return child
    except OSError:
        return None
    return None


def path_from_node_id_fuzzy(node_id: str, workspace_root: Path) -> Path | None:
    """Resolve file_/folder_ ids with case-insensitive segment matching."""
    root = workspace_root.resolve()
    if node_id.startswith("file_"):
        rel = node_id[5:].replace("\\", "/")
        parts = [p for p in rel.split("/") if p]
        if not parts:
            return None
        current = root
        for part in parts[:-1]:
            nxt = _match_child_dir(current, part)
            if nxt is None:
                return None
            current = nxt
        found = _match_child_file(current, parts[-1])
        if found is not None:
            try:
                if found.resolve().is_relative_to(root):
                    return found
                return None
            except (OSError, ValueError):
                return None
        return None
    if node_id.startswith("folder_"):
        rel = node_id[7:].replace("\\", "/")
        if rel == "dot":
            return root
        parts = [p for p in rel.split("/") if p]
        current = root
        for part in parts:
            nxt = _match_child_dir(current, part)
            if nxt is None:
                return None
            current = nxt
        try:
            if current.resolve().is_relative_to(root):
                return current
        except (OSError, ValueError):
            pass
        return None
    return None


def _windows_to_posix_manual(path_str: str) -> Path:
    """Fallback when wslpath -u is unavailable (non-WSL)."""
    drive = path_str[0].lower()
    rest = path_str[2:].replace("\\", "/").lstrip("/")
    return Path(f"/mnt/{drive}/{rest}")


def windows_to_posix(path_str: str) -> Path:
    """Convert a Windows path (C:\\...) to a POSIX path for existence checks."""
    path_str = path_str.strip()
    if is_wsl():
        result = subprocess.run(
            ["wslpath", "-u", path_str],
            capture_output=True,
            text=True,
            timeout=5,
        )
        out = result.stdout.strip().replace("\r", "")
        if result.returncode == 0 and out:
            return Path(out)
    return _windows_to_posix_manual(path_str)


def normalize_stored_path(path_str: str, workspace_root: Path) -> Path:
    """
    Resolve a path string from the graph DB (Windows, relative, Docker /workspaces).
    """
    path_str = path_str.strip()
    if not path_str:
        return Path(path_str)

    if is_windows_path(path_str):
        candidate = windows_to_posix(path_str)
    else:
        candidate = Path(path_str)
        if not candidate.is_absolute():
            candidate = workspace_root / candidate

    if candidate.exists():
        return candidate.resolve()

    resolved = candidate.resolve()
    if resolved.exists():
        return resolved

    if path_str.startswith("/workspaces"):
        suffix = path_str.removeprefix("/workspaces").lstrip("/")
        if suffix:
            alt = (workspace_root / suffix).resolve()
            if alt.exists():
                return alt

    return resolved


def resolve_node_path(node_id: str, path_str: str, workspace_root: Path) -> Path:
    """
    Best path for a graph node: prefer scanner id (workspace tree) over stale DB paths.
    """
    root = workspace_root.resolve()
    canonical = path_from_node_id(node_id, root)
    fuzzy = path_from_node_id_fuzzy(node_id, root) if canonical is None or not canonical.exists() else None
    for candidate in (canonical, fuzzy):
        if candidate is None:
            continue
        try:
            resolved = candidate.resolve()
            if resolved.exists():
                return resolved
        except OSError:
            pass
        if candidate.exists():
            return candidate.resolve()

    stored = normalize_stored_path(path_str, root)
    if stored.exists():
        # Stale OneDrive C:\\ in DB must not beat an existing workspace file
        if canonical is not None and (
            is_windows_path(path_str) or str(stored).startswith("/mnt/")
        ):
            try:
                c = canonical.resolve()
                if c.exists() and c.is_relative_to(root):
                    return c
            except (OSError, ValueError):
                pass
        return stored.resolve()

    return stored


def to_windows_path(posix_path: Path) -> str:
    """
    Windows path for cmd start / general use (often \\\\wsl.localhost\\...).
    """
    if is_wsl():
        result = subprocess.run(
            ["wslpath", "-w", str(posix_path)],
            capture_output=True,
            text=True,
            timeout=5,
        )
        win_path = result.stdout.strip().replace("\r", "")
        if result.returncode != 0 or not win_path:
            err = (result.stderr or "").strip() or f"exit code {result.returncode}"
            raise RuntimeError(
                f"wslpath no pudo convertir la ruta: {posix_path} ({err})"
            )
        return win_path.replace("/", "\\")

    return str(posix_path)


def to_explorer_select_path(posix_path: Path) -> str:
    """
    UNC path for explorer.exe /select on WSL files.
    Explorer mishandles \\\\wsl.localhost\\... for /select; use \\\\wsl$\\<distro>\\...
    """
    win_path = to_windows_path(posix_path.resolve())
    lower = win_path.lower()
    if lower.startswith("\\\\wsl.localhost\\"):
        parts = win_path.split("\\")
        # ['', '', 'wsl.localhost', 'Ubuntu', 'home', ...]
        if len(parts) >= 5:
            distro = parts[3]
            rest = "\\".join(parts[4:])
            return f"\\\\wsl$\\{distro}\\{rest}"
    return win_path
