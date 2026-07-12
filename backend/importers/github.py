"""GitHub repository importer — download and extract public repos as ZIP archives."""

from __future__ import annotations

import io
import logging
import os
import shutil
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from . import _urlopen

logger = logging.getLogger(__name__)


def _safe_extract_zip(zip_ref: zipfile.ZipFile, dest_dir: Path) -> None:
    dest = dest_dir.resolve()
    for member in zip_ref.namelist():
        target = (dest / member).resolve()
        if not (str(target) == str(dest) or str(target).startswith(str(dest) + os.sep)):
            raise RuntimeError("Zip path traversal detected")
    zip_ref.extractall(dest)


def download_and_extract_github(repo_input: str, workspace_root: Path) -> Path:
    """
    Downloads a public GitHub repository as a ZIP archive via HTTP and extracts it
    to `workspace_root/imports/github/{owner}-{repo}/`.
    """
    repo_input = repo_input.strip()
    if repo_input.endswith(".git"):
        repo_input = repo_input[:-4]

    # Parse owner and repo name
    if "github.com/" in repo_input:
        parts = repo_input.split("github.com/")[-1].split("/")
    else:
        parts = repo_input.split("/")

    if len(parts) < 2:
        raise ValueError("Format invalido para GitHub. Usar 'usuario/repo' o la URL completa.")

    owner, repo = parts[0].strip(), parts[1].strip()
    if not owner or not repo:
        raise ValueError("Nombre de usuario o repositorio vacio.")

    dest_dir = workspace_root / "imports" / "github" / f"{owner}-{repo}"

    # Create the imports directory and cleanup previous version if it exists
    if dest_dir.exists():
        shutil.rmtree(dest_dir)

    zipball_url = f"https://api.github.com/repos/{owner}/{repo}/zipball"
    req = urllib.request.Request(
        zipball_url, headers={"User-Agent": "LaGranBiblioteca/1.0 (Python urllib)"}
    )

    try:
        zip_data = _urlopen(req)
    except urllib.error.HTTPError as e:
        logger.error(f"Error descargando zipball de GitHub: {e.code} {e.reason}")
        raise RuntimeError(f"No se pudo descargar el repositorio desde GitHub: {e.code} {e.reason}")
    except Exception as e:
        logger.error(f"Error de red al descargar de GitHub: {e}")
        raise RuntimeError(f"Error de conexion al descargar de GitHub: {e}")

    # Extract ZIP file
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        with zipfile.ZipFile(io.BytesIO(zip_data)) as zip_ref:
            _safe_extract_zip(zip_ref, temp_path)

        # GitHub zipballs pack everything in a single root folder: owner-repo-hash
        extracted_dirs = [p for p in temp_path.iterdir() if p.is_dir()]
        if not extracted_dirs:
            raise RuntimeError("El archivo ZIP descargado esta vacio.")

        root_extracted = extracted_dirs[0]

        # Ensure destination parent directory exists
        dest_dir.parent.mkdir(parents=True, exist_ok=True)
        # Move the inner folder contents to target destination folder
        shutil.move(str(root_extracted), str(dest_dir))

    return dest_dir
