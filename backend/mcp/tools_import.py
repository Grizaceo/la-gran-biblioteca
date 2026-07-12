"""Import MCP tools: import_github, search_arxiv, import_arxiv, import_pubmed."""

from __future__ import annotations

from ..imports import (
    download_and_extract_github,
    import_arxiv as _import_arxiv,
    import_pubmed as _import_pubmed,
    search_arxiv as _search_arxiv,
)
from . import WORKSPACE_ROOT, get_workspace_root


def import_github(repo_url: str) -> dict:
    import backend.mcp as mcp_mod
    try:
        dest = download_and_extract_github(repo_url, WORKSPACE_ROOT)
        mcp_mod._recent_imports.append(str(dest))
        if len(mcp_mod._recent_imports) > 50:
            mcp_mod._recent_imports.pop(0)
        return {"status": "ok", "path": str(dest.relative_to(get_workspace_root()))}
    except Exception as e:
        return {"error": str(e)}


def search_arxiv(
    query: str | None = None,
    max_results: int = 10,
    sort: str = "relevance",
    author: str | None = None,
    category: str | None = None,
) -> dict:
    try:
        return _search_arxiv(
            query=query, author=author, category=category,
            max_results=max_results, sort=sort,
        )
    except Exception as e:
        return {"error": str(e)}


def import_arxiv(arxiv_id: str) -> dict:
    import backend.mcp as mcp_mod
    try:
        file_path = _import_arxiv(arxiv_id, WORKSPACE_ROOT)
        mcp_mod._recent_imports.append(str(file_path))
        if len(mcp_mod._recent_imports) > 50:
            mcp_mod._recent_imports.pop(0)
        return {"status": "ok", "path": str(file_path.relative_to(WORKSPACE_ROOT))}
    except Exception as e:
        return {"error": str(e)}


def import_pubmed(pmid: str) -> dict:
    import backend.mcp as mcp_mod
    try:
        file_path = _import_pubmed(pmid, WORKSPACE_ROOT)
        mcp_mod._recent_imports.append(str(file_path))
        if len(mcp_mod._recent_imports) > 50:
            mcp_mod._recent_imports.pop(0)
        return {"status": "ok", "path": str(file_path.relative_to(WORKSPACE_ROOT))}
    except Exception as e:
        return {"error": str(e)}