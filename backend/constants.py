import os
from pathlib import Path

_DEFAULT_WORKSPACE = str(Path.home() / ".hermes" / "workspaces")
_ENV_WORKSPACE_ROOT = Path(os.environ.get("WORKSPACE_ROOT", _DEFAULT_WORKSPACE))
# Mutable shim: tests patch this; bootstrap/sync update it from VaultManager.
WORKSPACE_ROOT = _ENV_WORKSPACE_ROOT

_BASE_EXCLUDE_DIRS = frozenset({".hermes", ".lgb", "__pycache__", "node_modules", ".git"})
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


def get_workspace_root() -> Path:
    """Active vault root (VaultManager registry) or WORKSPACE_ROOT module fallback."""
    try:
        from .vault_manager import vault_manager

        vault_manager._load_registry()
        if vault_manager._data.get("active_id") or vault_manager._data.get("vaults"):
            return vault_manager.get_active().root.resolve()
    except Exception:
        pass
    return Path(WORKSPACE_ROOT).resolve()


def get_db_path() -> Path:
    """Per-vault DB at {root}/.lgb/library.db when registry has an active vault."""
    try:
        from .vault_manager import vault_manager

        vault_manager._load_registry()
        if vault_manager._data.get("active_id") or vault_manager._data.get("vaults"):
            return vault_manager.get_active().db_path
    except Exception:
        pass
    legacy = Path(__file__).parent / "library.db"
    return Path(os.environ.get("DB_PATH", str(legacy)))
