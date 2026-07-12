"""Preprint importers — medRxiv and bioRxiv via HTTP API."""

from __future__ import annotations

import logging
import re
from pathlib import Path
from urllib.parse import quote

from . import _doi_filename_stem, _yaml_double_quoted

logger = logging.getLogger(__name__)


def _normalize_preprint_doi(raw: str) -> str:
    s = raw.strip()
    m = re.search(r"10\.1101/\S+", s, re.I)
    if m:
        return re.sub(r"v\d+$", "", m.group(0), flags=re.I).lower()
    path_m = re.search(r"([\d]{4}\.[\d]{2}\.[\d]{2}\.[\d]+)(?:v\d+)?", s)
    if path_m:
        return f"10.1101/{path_m.group(1)}"
    raise ValueError(f"ID de preprint invalido: {raw!r}")


def _fetch_preprint_title(kind: str, doi: str) -> str | None:
    from ..imports import _fetch_json

    suffix = re.sub(r"^10\.1101/", "", doi, flags=re.I)
    server = "medrxiv" if kind == "medrxiv" else "biorxiv"
    url = f"https://api.biorxiv.org/details/{server}/{quote(suffix, safe='')}/na/json"
    try:
        data = _fetch_json(url)
    except RuntimeError:
        return None
    collection = data.get("collection") or []
    if not collection:
        return None
    title = (collection[0].get("title") or "").strip()
    return title or None


def import_preprint(kind: str, raw_id: str, workspace_root: Path) -> Path:
    """Import a medRxiv or bioRxiv preprint as Markdown."""
    if kind not in ("medrxiv", "biorxiv"):
        raise ValueError(f"Tipo de preprint no soportado: {kind}")
    doi = _normalize_preprint_doi(raw_id)
    host = "www.medrxiv.org" if kind == "medrxiv" else "www.biorxiv.org"
    url = f"https://{host}/content/{doi}v1"
    title = _fetch_preprint_title(kind, doi) or f"{kind}: {doi}"

    dest_dir = workspace_root / "imports" / kind
    dest_dir.mkdir(parents=True, exist_ok=True)
    file_path = dest_dir / f"{_doi_filename_stem(doi)}.md"

    md_content = f"""---
title: {_yaml_double_quoted(title)}
doi: {_yaml_double_quoted(doi)}
url: {_yaml_double_quoted(url)}
type: "preprint"
tags: [{_yaml_double_quoted(kind)}, {_yaml_double_quoted("preprint")}]
---

# {title}

[{url}]({url})
"""
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    return file_path
