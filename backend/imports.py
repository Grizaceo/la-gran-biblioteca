"""imports.py — Re-export shim for backward compatibility.

Implementation moved to backend/importers/ package.
"""

from .importers import (
    _urlopen,
    _yaml_double_quoted,
    _fetch_json,
    _doi_filename_stem,
    DOWNLOAD_TIMEOUT,
    MAX_ZIP_BYTES,
    ARXIV_API_BASE,
    ARXIV_USER_AGENT,
)
from .importers.github import download_and_extract_github, _safe_extract_zip
from .importers.arxiv import search_arxiv, import_arxiv
from .importers.pubmed import import_pubmed, import_doi, import_pmc
from .importers.preprints import import_preprint

__all__ = [
    "download_and_extract_github",
    "search_arxiv",
    "import_arxiv",
    "import_pubmed",
    "import_doi",
    "import_pmc",
    "import_preprint",
    "_urlopen",
    "_yaml_double_quoted",
    "_fetch_json",
    "_doi_filename_stem",
    "DOWNLOAD_TIMEOUT",
    "MAX_ZIP_BYTES",
    "ARXIV_API_BASE",
    "ARXIV_USER_AGENT",
    "_safe_extract_zip",
]
