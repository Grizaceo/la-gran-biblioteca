import io
import json
import os
import re
import zipfile
import urllib.request
import urllib.error
import shutil
import tempfile
from pathlib import Path
from urllib.parse import quote, urlencode
import xml.etree.ElementTree as ET
import defusedxml.ElementTree as DET
import logging

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

_ATOM_NS = "http://www.w3.org/2005/Atom"
_ARXIV_NS = "http://arxiv.org/schemas/atom"
_ARXIV_NS_MAP = {"atom": _ATOM_NS, "arxiv": _ARXIV_NS}


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


def _doi_filename_stem(doi: str) -> str:
    safe = re.sub(r'[<>:"/\\|?*]', "_", doi.replace("/", "_"))
    return safe[:120] or "doi_paper"


def _normalize_pmcid(raw: str) -> str:
    s = raw.strip().upper()
    m = re.search(r"PMC(\d+)", s, re.I)
    if not m:
        raise ValueError(f"PMC ID invalido: {raw!r}")
    return f"PMC{m.group(1)}"


def _normalize_preprint_doi(raw: str) -> str:
    s = raw.strip()
    m = re.search(r"10\.1101/\S+", s, re.I)
    if m:
        return re.sub(r"v\d+$", "", m.group(0), flags=re.I).lower()
    path_m = re.search(r"([\d]{4}\.[\d]{2}\.[\d]{2}\.[\d]+)(?:v\d+)?", s)
    if path_m:
        return f"10.1101/{path_m.group(1)}"
    raise ValueError(f"ID de preprint invalido: {raw!r}")


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


def _fetch_crossref_work(doi: str) -> tuple[str, list[str]]:
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


def _fetch_preprint_title(kind: str, doi: str) -> str | None:
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
