import platform
import subprocess
import shutil
import logging
from pathlib import Path
from .os_open import is_wsl

logger = logging.getLogger("la-gran-biblioteca")

def select_file_in_os() -> str:
    """Opens a native system file selector dialog and returns the absolute path of the selected file."""
    try:
        if is_wsl():
            cmd = [
                "powershell.exe", "-Sta", "-NoProfile", "-Command",
                "Add-Type -AssemblyName System.Windows.Forms; "
                "$owner = New-Object System.Windows.Forms.Form; "
                "$owner.TopMost = $true; "
                "$owner.ShowInTaskbar = $false; "
                "$owner.StartPosition = 'CenterScreen'; "
                "$owner.Size = New-Object System.Drawing.Size(0,0); "
                "$owner.Show(); "
                "$owner.Activate(); "
                "$f = New-Object System.Windows.Forms.OpenFileDialog; "
                "$f.Filter = 'All Files (*.*)|*.*'; "
                "$f.Title = 'Seleccionar Archivo para La Gran Biblioteca'; "
                "$res = $f.ShowDialog($owner); "
                "$owner.Dispose(); "
                "if ($res -eq 'OK') { Write-Output $f.FileName }",
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            win_path = result.stdout.strip()
            if not win_path:
                return ""

            res_wsl = subprocess.run(["wslpath", "-u", win_path], capture_output=True, text=True, timeout=5)
            wsl_path = res_wsl.stdout.strip()
            if res_wsl.returncode == 0 and wsl_path:
                return wsl_path
            logger.warning(
                "wslpath failed for %r (rc=%s): %s",
                win_path,
                res_wsl.returncode,
                (res_wsl.stderr or "").strip(),
            )
            return ""

        elif platform.system() == "Darwin":
            # macOS AppleScript dialog
            cmd = [
                "osascript", "-e",
                'POSIX path of (choose file with prompt "Seleccionar Archivo para La Gran Biblioteca")'
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            return result.stdout.strip()

        else:
            # Linux Zenity dialog
            cmd = [
                "zenity", "--file-selection",
                "--title=Seleccionar Archivo para La Gran Biblioteca"
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            return result.stdout.strip()

    except subprocess.TimeoutExpired:
        logger.warning("El selector de archivos del SO expiró tras 120 segundos.")
        return ""
    except Exception as e:
        logger.error(f"Error al abrir el selector de archivos del SO: {e}")
        return ""
def import_selected_file(src_path_str: str, workspace_root: Path) -> Path:
    """Copies selected file into workspace_root, managing any name conflicts with numeric suffixes."""
    src_path = Path(src_path_str)
    if not src_path.exists() or not src_path.is_file():
        raise ValueError("El archivo seleccionado no existe o no es válido.")
        
    dest_path = workspace_root / src_path.name
    if dest_path.exists():
        base = dest_path.stem
        ext = dest_path.suffix
        counter = 1
        while dest_path.exists():
            dest_path = workspace_root / f"{base}_{counter}{ext}"
            counter += 1
            
    shutil.copy2(src_path, dest_path)
    logger.info(f"Archivo importado con éxito: {src_path} -> {dest_path}")
    return dest_path

def import_selected_folder(src_path_str: str, workspace_root: Path) -> Path:
    """Recursively copies selected directory into workspace_root, resolving name conflicts."""
    src_path = Path(src_path_str)
    if not src_path.exists() or not src_path.is_dir():
        raise ValueError("La carpeta seleccionada no existe o no es válida.")
        
    dest_path = workspace_root / src_path.name
    if dest_path.exists():
        base = dest_path.name
        counter = 1
        while dest_path.exists():
            dest_path = workspace_root / f"{base}_{counter}"
            counter += 1
            
    shutil.copytree(src_path, dest_path)
    logger.info(f"Carpeta importada con éxito: {src_path} -> {dest_path}")
    return dest_path
