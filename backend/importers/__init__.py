"""Importers package — shared helpers for downloading and importing external content."""

from __future__ import annotations

import json
import logging
import os
import urllib.request
import urllib.error

logger = logging.getLogger(__name__)

DOWNLOAD_TIMEOUT = int(os.environ.get("LGB_DOWNLOAD_TIMEOUT", "120"))
MAX_ZIP_BYTES = int(os.environ.get("LGB_MAX_ZIP_BYTES", str(100 * 1024 * 1024)))
ARXIV_API_BASE = os.environ.get("LGB_ARXIV_API_BASE", "https://export.arxiv.org/api/query").rstrip(
    "/"
)
ARXIV_USER_AGENT = os.environ.get(
    "LGB_ARXIV_USER_AGENT",
    "LaGranBiblioteca/1.0 (+https://github.com/la-gran-biblioteca; mailto:support@local)",
)


def _urlopen(req: urllib.request.Request) -> bytes:
    with urllib.request.urlopen(req, timeout=DOWNLOAD_TIMEOUT) as response:
        data = response.read()
        if len(data) > MAX_ZIP_BYTES:
            raise RuntimeError(f"Download exceeds limit ({MAX_ZIP_BYTES} bytes)")
        return data


def _yaml_double_quoted(value: str) -> str:
    """Escape a string for YAML double-quoted scalars."""
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ").replace("\r", " ")
    return f'"{escaped}"'


def _fetch_json(url: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "LaGranBiblioteca/1.0 (Python urllib)",
            "Accept": "application/json",
        },
    )
    try:
        data = _urlopen(req)
    except Exception as e:
        logger.error("Error al obtener JSON %s: %s", url, e)
        raise RuntimeError(f"Error al consultar {url}: {e}") from e
    try:
        return json.loads(data.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Respuesta JSON invalida de {url}") from e


def _doi_filename_stem(doi: str) -> str:
    import re

    safe = re.sub(r'[<>:"/\\|?*]', "_", doi.replace("/", "_"))
    return safe[:120] or "doi_paper"
