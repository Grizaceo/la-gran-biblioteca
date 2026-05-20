import os
from pathlib import Path

_DEFAULT_WORKSPACE = str(Path.home() / ".hermes" / "workspaces")
WORKSPACE_ROOT = Path(os.environ.get("WORKSPACE_ROOT", _DEFAULT_WORKSPACE))

EXCLUDE_DIRS = {".hermes", "__pycache__", "node_modules", ".git", "archive", "backups", "snapshots"}

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
