import platform
import subprocess
from pathlib import Path

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


def open_in_os(path: Path, reveal: bool) -> None:
    """Open a file or reveal it in the system file manager."""
    is_dir = path.is_dir()
    if is_wsl():
        result = subprocess.run(
            ["wslpath", "-w", str(path)], capture_output=True, text=True, timeout=5
        )
        win_path = result.stdout.strip()
        if not win_path:
            raise RuntimeError(f"wslpath no pudo convertir la ruta: {path}")
        if reveal and not is_dir:
            # Select the file inside its parent folder in Explorer
            subprocess.Popen(["explorer.exe", f"/select,{win_path}"])
        else:
            # Open the file or folder directly
            subprocess.Popen(["explorer.exe", win_path])
    elif platform.system() == "Darwin":
        if reveal and not is_dir:
            subprocess.Popen(["open", "-R", str(path)])
        else:
            subprocess.Popen(["open", str(path)])
    else:
        if reveal and not is_dir:
            subprocess.Popen(["xdg-open", str(path.parent)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
