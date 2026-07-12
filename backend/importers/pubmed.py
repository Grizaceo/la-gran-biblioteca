"""PubMed, DOI, and PMC importers."""

from __future__ import annotations

import logging
import re
import urllib.request
from pathlib import Path
from urllib.parse import quote

import defusedxml.ElementTree as DET

from . import _doi_filename_stem, _urlopen, _yaml_double_quoted

logger = logging.getLogger(__name__)

_DOI_CORE = re.compile(r"10\.\d{4,9}/[-._;()/:A-Za-z0-9]+", re.I)


def _normalize_doi(raw: str) -> str:
    s = raw.strip()
    if not s:
        raise ValueError("DOI vacio.")
    lower = s.lower()
    if lower.startswith("doi:"):
        s = s[4:].strip()
    if "doi.org/" in lower:
        idx = lower.index("doi.org/")
        s = s[idx + len("doi.org/") :]
    elif "dx.doi.org/" in lower:
        idx = lower.index("dx.doi.org/")
        s = s[idx + len("dx.doi.org/") :]
    s = s.split("?")[0].split("#")[0].rstrip("/")
    s = re.sub(r"[.,;)\]]+$", "", s)
    m = _DOI_CORE.search(s)
    if not m:
        raise ValueError(f"DOI invalido: {raw!r}")
    return m.group(0).lower()


def _normalize_pmcid(raw: str) -> str:
    s = raw.strip().upper()
    m = re.search(r"PMC(\d+)", s, re.I)
    if not m:
        raise ValueError(f"PMC ID invalido: {raw!r}")
    return f"PMC{m.group(1)}"


def _fetch_crossref_work(doi: str) -> tuple[str, list[str]]:
    from ..imports import _fetch_json

    url = f"https://api.crossref.org/works/{quote(doi, safe='')}"
    data = _fetch_json(url)
    msg = data.get("message") or {}
    titles = msg.get("title") or []
    title = (titles[0] if titles else "").strip() or f"DOI {doi}"
    authors: list[str] = []
    for author in msg.get("author") or []:
        if isinstance(author, dict):
            name = (author.get("name") or "").strip()
            if not name:
                parts = [author.get("given"), author.get("family")]
                name = " ".join(p for p in parts if p).strip()
            if name:
                authors.append(name)
    return title, authors


def _fetch_pmc_title(pmcid: str) -> str | None:
    from ..imports import _fetch_json

    query = quote(f"PMCID:{pmcid}")
    url = (
        "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
        f"?query={query}&format=json&pageSize=1"
    )
    try:
        data = _fetch_json(url)
    except RuntimeError:
        return None
    results = (data.get("resultList") or {}).get("result") or []
    if not results:
        return None
    title = (results[0].get("title") or "").strip()
    return title or None


def import_pubmed(pmid: str, workspace_root: Path) -> Path:
    """
    Queries PubMed API for metadata and writes a structured Markdown file
    with detailed YAML frontmatter inside `workspace_root/imports/pubmed/{pmid}.md`.
    """
    pmid = pmid.strip()
    # Normalize ID by removing any URL wrapper if user provided a full link
    if "pubmed.ncbi.nlm.nih.gov/" in pmid:
        pmid = pmid.split("pubmed.ncbi.nlm.nih.gov/")[-1].split("/")[0]

    api_url = (
        f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id={pmid}&retmode=xml"
    )
    req = urllib.request.Request(
        api_url, headers={"User-Agent": "LaGranBiblioteca/1.0 (Python urllib)"}
    )

    try:
        xml_data = _urlopen(req)
    except Exception as e:
        logger.error(f"Error al conectar con la API de PubMed: {e}")
        raise RuntimeError(f"Error al consultar la API de PubMed: {e}")

    try:
        root = DET.fromstring(xml_data)

        article = root.find(".//PubmedArticle")
        if article is None:
            raise ValueError(f"No se encontro el articulo en PubMed para el PMID {pmid}")

        title_elem = article.find(".//ArticleTitle")
        title = (
            "".join(title_elem.itertext()).strip()
            if title_elem is not None
            else f"PubMed PMID:{pmid}"
        )
        title = " ".join(title.split())

        abstract_texts = []
        for abs_text in article.findall(".//AbstractText"):
            label = abs_text.attrib.get("Label")
            text = "".join(abs_text.itertext()).strip()
            if label and text:
                abstract_texts.append(f"**{label}**: {text}")
            elif text:
                abstract_texts.append(text)

        summary = "\n\n".join(abstract_texts)
        summary = "\n\n".join(" ".join(p.split()) for p in summary.split("\n\n"))

        authors = []
        for author in article.findall(".//AuthorList/Author"):
            last = author.find("LastName")
            fore = author.find("ForeName")
            coll = author.find("CollectiveName")
            if last is not None and fore is not None:
                authors.append(f"{fore.text.strip()} {last.text.strip()}")
            elif last is not None:
                authors.append(last.text.strip())
            elif coll is not None:
                authors.append(coll.text.strip())

        pub_date = article.find(".//JournalIssue/PubDate")
        year_str = ""
        month_str = "01"
        day_str = "01"
        if pub_date is not None:
            year_elem = pub_date.find("Year")
            month_elem = pub_date.find("Month")
            day_elem = pub_date.find("Day")
            medline_elem = pub_date.find("MedlineDate")

            if year_elem is not None:
                year_str = year_elem.text.strip()
            if month_elem is not None:
                month_str = month_elem.text.strip()
            if day_elem is not None:
                day_str = day_elem.text.strip()

            if not year_str and medline_elem is not None:
                parts = medline_elem.text.strip().split()
                if parts:
                    year_str = parts[0]

        published = f"{year_str}-{month_str}-{day_str}" if year_str else ""

        journal_elem = article.find(".//Journal/Title")
        journal = journal_elem.text.strip() if journal_elem is not None else ""

        keywords = []
        for kw in article.findall(".//KeywordList/Keyword"):
            keywords.append("".join(kw.itertext()).strip())
    except Exception as e:
        logger.error(f"Error parseando el XML de PubMed: {e}")
        raise RuntimeError(f"Error procesando la respuesta de PubMed: {e}")

    # Create the markdown file
    dest_dir = workspace_root / "imports" / "pubmed"
    dest_dir.mkdir(parents=True, exist_ok=True)
    file_path = dest_dir / f"{pmid}.md"

    tags = ["pubmed", "paper", "medical"]
    for kw in keywords[:5]:  # Take top 5 keywords
        kw_friendly = kw.lower().replace(" ", "_").replace("-", "_").replace(".", "")
        tags.append(f"pm_{kw_friendly}")

    authors_yaml = ", ".join([f'"{auth}"' for auth in authors])
    tags_yaml = ", ".join([f'"{t}"' for t in tags])

    md_content = f"""---
title: "{title}"
authors: [{authors_yaml}]
date: "{published}"
pmid: "{pmid}"
url: "https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
journal: "{journal}"
tags: [{tags_yaml}]
type: "paper"
---

# {title}

## Autores
{", ".join(authors)}

## Revista
*{journal}* ({published})

## Resumen
{summary}

---
#pubmed {" ".join(["#" + t for t in tags if t != "paper" and t != "pubmed"])}
"""

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(md_content)

    return file_path


def import_doi(doi_input: str, workspace_root: Path) -> Path:
    """Import a DOI as Markdown under imports/doi/."""
    doi = _normalize_doi(doi_input)
    url = f"https://doi.org/{doi}"
    try:
        title, authors = _fetch_crossref_work(doi)
    except RuntimeError:
        title, authors = f"DOI {doi}", []

    dest_dir = workspace_root / "imports" / "doi"
    dest_dir.mkdir(parents=True, exist_ok=True)
    file_path = dest_dir / f"{_doi_filename_stem(doi)}.md"

    authors_yaml = "\n".join(f"  - {_yaml_double_quoted(a)}" for a in authors) or "  []"
    md_content = f"""---
title: {_yaml_double_quoted(title)}
doi: {_yaml_double_quoted(doi)}
url: {_yaml_double_quoted(url)}
type: "paper"
tags: [{_yaml_double_quoted("doi")}, {_yaml_double_quoted("paper")}]
authors:
{authors_yaml}
---

# {title}

{(", ".join(authors) + chr(10) + chr(10)) if authors else ""}[{url}]({url})
"""
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    return file_path


def import_pmc(pmc_input: str, workspace_root: Path) -> Path:
    """Import a PMC article reference as Markdown under imports/pmc/."""
    pmcid = _normalize_pmcid(pmc_input)
    url = f"https://www.ncbi.nlm.nih.gov/pmc/articles/{pmcid}/"
    title = _fetch_pmc_title(pmcid) or pmcid

    dest_dir = workspace_root / "imports" / "pmc"
    dest_dir.mkdir(parents=True, exist_ok=True)
    file_path = dest_dir / f"{pmcid}.md"

    md_content = f"""---
title: {_yaml_double_quoted(title)}
pmcid: {_yaml_double_quoted(pmcid)}
url: {_yaml_double_quoted(url)}
type: "paper"
tags: [{_yaml_double_quoted("pmc")}, {_yaml_double_quoted("paper")}]
---

# {title}

[{url}]({url})
"""
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    return file_path
