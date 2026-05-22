import os
from pathlib import Path

_DEFAULT_WORKSPACE = str(Path.home() / ".hermes" / "workspaces")
WORKSPACE_ROOT = Path(os.environ.get("WORKSPACE_ROOT", _DEFAULT_WORKSPACE))

_BASE_EXCLUDE_DIRS = frozenset({".hermes", "__pycache__", "node_modules", ".git"})
ARCHIVE_DIR_NAMES = frozenset({"archive", "backups", "snapshots"})


def get_extra_exclude_dirs() -> set[str]:
    raw = os.environ.get("LGB_EXTRA_EXCLUDE_DIRS", "")
    return {p.strip() for p in raw.split(",") if p.strip()}


def get_exclude_dirs() -> set[str]:
    return set(_BASE_EXCLUDE_DIRS) | get_extra_exclude_dirs()


def get_archive_policy() -> str:
    """exclude (default) | shadow | include — see AGENTS.md Vault hygiene."""
    return os.environ.get("LGB_ARCHIVE_POLICY", "exclude").strip().lower()


def is_archive_dir_name(name: str) -> bool:
    return name in ARCHIVE_DIR_NAMES


# Legacy name: technical excludes only (archives use LGB_ARCHIVE_POLICY).
EXCLUDE_DIRS = get_exclude_dirs()

SCAN_EXTENSIONS = {".md", ".py", ".ts", ".js", ".json", ".txt", ".yaml", ".yml"}

TEXT_EXTENSIONS: dict[str, str] = {
    "md": "markdown", "txt": "text", "rst": "rst",
    "py": "python", "js": "javascript", "ts": "typescript",
    "jsx": "javascript", "tsx": "typescript",
    "json": "json", "yaml": "yaml", "yml": "yaml",
    "toml": "toml", "ini": "ini", "cfg": "ini",
    "sh": "bash", "bash": "bash", "zsh": "bash",
    "rs": "rust", "go": "go", "c": "c", "cpp": "cpp",
    "h": "c", "hpp": "cpp", "java": "java", "rb": "ruby",
    "php": "php", "cs": "csharp", "swift": "swift",
    "kt": "kotlin", "r": "r", "sql": "sql",
    "css": "css", "scss": "scss", "html": "html", "xml": "xml",
    "dockerfile": "dockerfile",
}

CONTENT_MAX_BYTES = 2 * 1024 * 1024  # 2 MB
