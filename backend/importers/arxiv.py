"""arXiv importer — search and import papers from the arXiv export API."""

from __future__ import annotations

import logging
import re
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import quote, urlencode

import defusedxml.ElementTree as DET

from . import ARXIV_API_BASE, ARXIV_USER_AGENT, _urlopen, _yaml_double_quoted

logger = logging.getLogger(__name__)

_ATOM_NS = "http://www.w3.org/2005/Atom"
_ARXIV_NS = "http://arxiv.org/schemas/atom"
_ARXIV_NS_MAP = {"atom": _ATOM_NS, "arxiv": _ARXIV_NS}


def _normalize_arxiv_id(arxiv_id: str) -> str:
    arxiv_id = arxiv_id.strip()
    if "arxiv.org/abs/" in arxiv_id:
        arxiv_id = arxiv_id.split("arxiv.org/abs/", 1)[1]
    elif "arxiv.org/pdf/" in arxiv_id:
        arxiv_id = arxiv_id.split("arxiv.org/pdf/", 1)[1].replace(".pdf", "", 1)
    arxiv_id = arxiv_id.split("?")[0].split("#")[0].strip().rstrip("/")
    if not arxiv_id:
        raise ValueError("Identificador de arXiv vacio.")
    return arxiv_id


def _arxiv_filename_id(arxiv_id: str) -> str:
    """Filesystem-safe stem for imports/arxiv/{id}.md (old IDs contain '/')."""
    safe = re.sub(r"[^\w.\-]+", "_", arxiv_id.replace("/", "_"))
    return safe.strip("_") or "arxiv_paper"


def _fetch_arxiv_api(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": ARXIV_USER_AGENT})
    try:
        return _urlopen(req)
    except urllib.error.HTTPError as e:
        logger.error(f"arXiv API HTTP {e.code}: {e.reason}")
        if e.code == 403:
            raise RuntimeError(
                "arXiv bloqueo la peticion (403). Espera unos segundos e intenta de nuevo; "
                "usa export.arxiv.org y un User-Agent con contacto (LGB_ARXIV_USER_AGENT)."
            ) from e
        raise RuntimeError(f"Error al consultar la API de arXiv: HTTP {e.code} {e.reason}") from e
    except Exception as e:
        logger.error(f"Error al conectar con la API de arXiv: {e}")
        raise RuntimeError(f"Error al consultar la API de arXiv: {e}") from e


def _fetch_arxiv_xml(arxiv_id: str) -> bytes:
    api_url = f"{ARXIV_API_BASE}?id_list={quote(arxiv_id, safe='')}"
    return _fetch_arxiv_api(api_url)


def _strip_arxiv_version(arxiv_id: str) -> str:
    if re.search(r"v\d+$", arxiv_id):
        return re.sub(r"v\d+$", "", arxiv_id)
    return arxiv_id


def _arxiv_id_from_atom_id(id_text: str) -> str:
    if "arxiv.org/abs/" in id_text:
        aid = id_text.split("arxiv.org/abs/", 1)[1]
        aid = aid.split("?")[0].split("#")[0].strip().rstrip("/")
        return _strip_arxiv_version(aid)
    return _strip_arxiv_version(id_text.strip())


def _is_arxiv_error_entry(entry: ET.Element) -> bool:
    id_elem = entry.find("atom:id", _ARXIV_NS_MAP)
    id_text = (id_elem.text or "").strip() if id_elem is not None else ""
    title_elem = entry.find("atom:title", _ARXIV_NS_MAP)
    title = (title_elem.text or "").strip().lower() if title_elem is not None else ""
    return "api/errors" in id_text or title == "error"


def _parse_arxiv_entry(entry: ET.Element, *, truncate_abstract: int | None = None) -> dict:
    """Parse one Atom entry from the arXiv export API."""
    id_elem = entry.find("atom:id", _ARXIV_NS_MAP)
    id_text = (id_elem.text or "").strip() if id_elem is not None else ""
    arxiv_id = _arxiv_id_from_atom_id(id_text) if id_text else ""

    title_elem = entry.find("atom:title", _ARXIV_NS_MAP)
    title_raw = (title_elem.text or "").strip() if title_elem is not None else ""
    title = " ".join(title_raw.replace("\n", " ").split()) or (
        f"arXiv:{arxiv_id}" if arxiv_id else "arXiv paper"
    )

    summary_elem = entry.find("atom:summary", _ARXIV_NS_MAP)
    summary = (summary_elem.text or "").strip() if summary_elem is not None else ""
    summary = " ".join(summary.split())
    withdrawn = bool(summary and re.search(r"\b(withdrawn|retracted)\b", summary, re.IGNORECASE))

    authors = []
    for author in entry.findall("atom:author", _ARXIV_NS_MAP):
        name_elem = author.find("atom:name", _ARXIV_NS_MAP)
        if name_elem is not None and name_elem.text:
            authors.append(name_elem.text.strip())

    published_elem = entry.find("atom:published", _ARXIV_NS_MAP)
    published = (published_elem.text or "").strip()[:10] if published_elem is not None else ""

    updated_elem = entry.find("atom:updated", _ARXIV_NS_MAP)
    updated = (updated_elem.text or "").strip()[:10] if updated_elem is not None else ""

    abs_url = id_text if id_text.startswith("http") else f"https://arxiv.org/abs/{arxiv_id}"
    pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf" if arxiv_id else ""

    categories = []
    primary_cat = entry.find("arxiv:primary_category", _ARXIV_NS_MAP)
    if primary_cat is not None:
        term = primary_cat.attrib.get("term")
        if term:
            categories.append(term)
    for cat in entry.findall("atom:category", _ARXIV_NS_MAP):
        term = cat.attrib.get("term")
        if term and term not in categories:
            categories.append(term)

    doi_elem = entry.find("arxiv:doi", _ARXIV_NS_MAP)
    doi = (doi_elem.text or "").strip() if doi_elem is not None else ""

    abstract = summary
    if truncate_abstract is not None and len(abstract) > truncate_abstract:
        abstract = abstract[: truncate_abstract - 3].rstrip() + "..."

    return {
        "arxiv_id": arxiv_id,
        "title": title,
        "authors": authors,
        "published": published,
        "updated": updated,
        "categories": categories,
        "abstract": abstract,
        "abs_url": abs_url,
        "pdf_url": pdf_url,
        "withdrawn": withdrawn,
        "doi": doi,
        "summary": summary,
    }


def search_arxiv(
    query: str | None = None,
    author: str | None = None,
    category: str | None = None,
    max_results: int = 10,
    sort: str = "relevance",
) -> dict:
    """
    Search arXiv via export API. Returns {"total": int|None, "results": [dict, ...]}.
    At least one of query, author, or category must be provided.
    """
    query = (query or "").strip()
    author = (author or "").strip()
    category = (category or "").strip()
    if not query and not author and not category:
        raise ValueError("Indica al menos uno de: consulta (query), autor o categoría.")

    sort = (sort or "relevance").strip().lower()
    if sort not in ("relevance", "date"):
        raise ValueError("sort debe ser 'relevance' o 'date'.")

    max_results = max(1, min(int(max_results), 30))

    parts = []
    if query:
        parts.append(f"all:{query}")
    if author:
        parts.append(f"au:{author}")
    if category:
        parts.append(f"cat:{category}")
    search_query = " AND ".join(parts)

    params = {
        "search_query": search_query,
        "start": 0,
        "max_results": max_results,
        "sortBy": "relevance" if sort == "relevance" else "submittedDate",
        "sortOrder": "descending",
    }
    api_url = f"{ARXIV_API_BASE}?{urlencode(params)}"
    xml_data = _fetch_arxiv_api(api_url)

    try:
        root = DET.fromstring(xml_data)
    except DET.ParseError as e:
        logger.error(f"XML invalido de arXiv (busqueda): {e}")
        raise RuntimeError(f"Respuesta invalida de arXiv: {e}") from e

    total = None
    opensearch_ns = "http://a9.com/-/spec/opensearch/1.1/"
    total_elem = root.find(f"{{{opensearch_ns}}}totalResults")
    if total_elem is not None and total_elem.text:
        try:
            total = int(total_elem.text.strip())
        except ValueError:
            total = None

    results = []
    for entry in root.findall("atom:entry", _ARXIV_NS_MAP):
        if _is_arxiv_error_entry(entry):
            continue
        parsed = _parse_arxiv_entry(entry, truncate_abstract=300)
        if parsed.get("arxiv_id"):
            results.append(parsed)

    return {"total": total, "results": results}


def import_arxiv(arxiv_id: str, workspace_root: Path) -> Path:
    """
    Queries arXiv API for metadata and writes a structured Markdown file
    with detailed YAML frontmatter inside `workspace_root/imports/arxiv/{arxiv_id}.md`.
    """
    arxiv_id = _normalize_arxiv_id(arxiv_id)
    xml_data = _fetch_arxiv_xml(arxiv_id)

    try:
        root = DET.fromstring(xml_data)
    except DET.ParseError as e:
        logger.error(f"XML invalido de arXiv: {e}")
        raise RuntimeError(f"Respuesta invalida de arXiv: {e}") from e

    entry = root.find("atom:entry", _ARXIV_NS_MAP)
    if entry is None:
        raise ValueError(f"No se encontro el articulo en arXiv para el ID {arxiv_id}")

    if _is_arxiv_error_entry(entry):
        summary_elem = entry.find("atom:summary", _ARXIV_NS_MAP)
        detail = (summary_elem.text or "").strip() if summary_elem is not None else ""
        raise ValueError(detail or f"No se encontro el articulo en arXiv para el ID {arxiv_id}")

    parsed = _parse_arxiv_entry(entry)
    title = parsed["title"]
    summary = parsed["summary"]
    authors = parsed["authors"]
    published = parsed["published"]
    url = parsed["abs_url"]
    doi = parsed["doi"]
    categories = parsed["categories"]

    # Create the markdown file
    dest_dir = workspace_root / "imports" / "arxiv"
    dest_dir.mkdir(parents=True, exist_ok=True)
    file_path = dest_dir / f"{_arxiv_filename_id(arxiv_id)}.md"

    # Format tags for semantic search indexation in La Gran Biblioteca
    # We substitute '.' and '-' in category names for compatible tag tokens
    tags = ["arxiv", "paper"]
    for cat in categories:
        tag_friendly = cat.replace(".", "_").replace("-", "_")
        tags.append(f"arxiv_{tag_friendly}")

    authors_yaml = ", ".join(_yaml_double_quoted(auth) for auth in authors)
    tags_yaml = ", ".join(_yaml_double_quoted(t) for t in tags)
    categories_yaml = ", ".join(_yaml_double_quoted(c) for c in categories)

    md_content = f"""---
title: {_yaml_double_quoted(title)}
authors: [{authors_yaml}]
date: {_yaml_double_quoted(published)}
arxiv_id: {_yaml_double_quoted(arxiv_id)}
doi: {_yaml_double_quoted(doi)}
url: {_yaml_double_quoted(url)}
categories: [{categories_yaml}]
tags: [{tags_yaml}]
type: "paper"
---

# {title}

## Autores
{", ".join(authors)}

## Resumen
{summary}

## Información Adicional
- **arXiv ID**: [{arxiv_id}]({url})
- **Publicado**: {published}
- **Categorías**: {", ".join(categories)}
{"- **DOI**: " + doi if doi else ""}

---
#arxiv {" ".join(["#" + t for t in tags if t != "paper"])}
"""

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(md_content)

    return file_path
