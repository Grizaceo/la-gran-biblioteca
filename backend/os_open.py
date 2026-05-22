import logging
import platform
import subprocess
from pathlib import Path

from .path_utils import is_wsl, to_explorer_select_path, to_windows_path

logger = logging.getLogger(__name__)

__all__ = ["is_wsl", "open_in_os"]


def _wsl_explorer_exe() -> str:
    """SysWOW64 explorer avoids some WSL interop quirks; fall back to PATH."""
    syswow = Path("/mnt/c/Windows/SysWOW64/explorer.exe")
    if syswow.is_file():
        return str(syswow)
    return "explorer.exe"


def _reveal_file_wsl(path: Path) -> None:
    """
    Reveal in Explorer on WSL.

    explorer.exe parses argv specially: /select and the path must be separate
    arguments (/select, then path). One quoted "/select,path" opens Documents.
    See https://wonkodv.github.io/open-files-on-windows-from-wsl/
    """
    path = path.resolve()
    file_win = to_explorer_select_path(path)
    explorer = _wsl_explorer_exe()
    argv = [explorer, "/select,", file_win]

    logger.info(
        "reveal_in_explorer posix=%s file_win=%s argv=%s",
        path,
        file_win,
        argv,
    )
    subprocess.Popen(argv)


def open_in_os(path: Path, reveal: bool) -> None:
    """Open a file or reveal it in the system file manager."""
    is_dir = path.is_dir()

    if is_wsl():
        if is_dir:
            win_path = to_explorer_select_path(path)
            logger.debug("open_in_os folder win_path=%s", win_path)
            subprocess.Popen(["explorer.exe", win_path])
        elif reveal:
            _reveal_file_wsl(path)
        else:
            win_path = to_windows_path(path)
            logger.debug("open_in_os file start win_path=%s", win_path)
            # /U: UTF-16 so Unicode paths are not mangled by cmd's ANSI code page
            subprocess.Popen(["cmd.exe", "/U", "/c", "start", "", win_path])
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
