import io
import zipfile
import urllib.request
import urllib.error
import shutil
import tempfile
from pathlib import Path
import xml.etree.ElementTree as ET
import logging

logger = logging.getLogger(__name__)

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
        zipball_url,
        headers={"User-Agent": "LaGranBiblioteca/1.0 (Python urllib)"}
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            zip_data = response.read()
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
            zip_ref.extractall(temp_path)
            
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
    arxiv_id = arxiv_id.strip()
    # Normalize ID by removing any URL wrapper if user provided a full link
    if "arxiv.org/abs/" in arxiv_id:
        arxiv_id = arxiv_id.split("arxiv.org/abs/")[-1].split()[0]
    elif "arxiv.org/pdf/" in arxiv_id:
        arxiv_id = arxiv_id.split("arxiv.org/pdf/")[-1].replace(".pdf", "").split()[0]

    api_url = f"http://export.arxiv.org/api/query?id_list={arxiv_id}"
    req = urllib.request.Request(
        api_url,
        headers={"User-Agent": "LaGranBiblioteca/1.0 (Python urllib)"}
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            xml_data = response.read()
    except Exception as e:
        logger.error(f"Error al conectar con la API de arXiv: {e}")
        raise RuntimeError(f"Error al consultar la API de arXiv: {e}")
        
    try:
        root = ET.fromstring(xml_data)
        ns = {'atom': 'http://www.w3.org/2005/Atom', 'arxiv': 'http://arxiv.org/schemas/atom'}
        
        entry = root.find('atom:entry', ns)
        if entry is None:
            raise ValueError(f"No se encontro el articulo en arXiv para el ID {arxiv_id}")
            
        title_elem = entry.find('atom:title', ns)
        title = title_elem.text.strip().replace('\n', ' ') if title_elem is not None else f"arXiv:{arxiv_id}"
        title = " ".join(title.split())
        
        summary_elem = entry.find('atom:summary', ns)
        summary = summary_elem.text.strip() if summary_elem is not None else ""
        summary = " ".join(summary.split())
        
        authors = []
        for author in entry.findall('atom:author', ns):
            name_elem = author.find('atom:name', ns)
            if name_elem is not None:
                authors.append(name_elem.text.strip())
                
        published_elem = entry.find('atom:published', ns)
        published = published_elem.text.strip()[:10] if published_elem is not None else ""
        
        id_elem = entry.find('atom:id', ns)
        url = id_elem.text.strip() if id_elem is not None else f"https://arxiv.org/abs/{arxiv_id}"
        
        doi_elem = entry.find('arxiv:doi', ns)
        doi = doi_elem.text.strip() if doi_elem is not None else ""
        
        categories = []
        primary_cat = entry.find('arxiv:primary_category', ns)
        if primary_cat is not None:
            term = primary_cat.attrib.get('term')
            if term:
                categories.append(term)
                
        for cat in entry.findall('atom:category', ns):
            term = cat.attrib.get('term')
            if term and term not in categories:
                categories.append(term)
    except Exception as e:
        logger.error(f"Error parseando el XML de arXiv: {e}")
        raise RuntimeError(f"Error procesando la respuesta de arXiv: {e}")
        
    # Create the markdown file
    dest_dir = workspace_root / "imports" / "arxiv"
    dest_dir.mkdir(parents=True, exist_ok=True)
    file_path = dest_dir / f"{arxiv_id}.md"
    
    # Format tags for semantic search indexation in La Gran Biblioteca
    # We substitute '.' and '-' in category names for compatible tag tokens
    tags = ["arxiv", "paper"]
    for cat in categories:
        tag_friendly = cat.replace(".", "_").replace("-", "_")
        tags.append(f"arxiv_{tag_friendly}")
        
    authors_yaml = ", ".join([f'"{auth}"' for auth in authors])
    tags_yaml = ", ".join([f'"{t}"' for t in tags])
    categories_yaml = ", ".join([f'"{c}"' for c in categories])

    md_content = f"""---
title: "{title}"
authors: [{authors_yaml}]
date: "{published}"
arxiv_id: "{arxiv_id}"
doi: "{doi}"
url: "{url}"
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

    api_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id={pmid}&retmode=xml"
    req = urllib.request.Request(
        api_url,
        headers={"User-Agent": "LaGranBiblioteca/1.0 (Python urllib)"}
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            xml_data = response.read()
    except Exception as e:
        logger.error(f"Error al conectar con la API de PubMed: {e}")
        raise RuntimeError(f"Error al consultar la API de PubMed: {e}")
        
    try:
        root = ET.fromstring(xml_data)
        
        article = root.find('.//PubmedArticle')
        if article is None:
            raise ValueError(f"No se encontro el articulo en PubMed para el PMID {pmid}")
            
        title_elem = article.find('.//ArticleTitle')
        title = "".join(title_elem.itertext()).strip() if title_elem is not None else f"PubMed PMID:{pmid}"
        title = " ".join(title.split())
            
        abstract_texts = []
        for abs_text in article.findall('.//AbstractText'):
            label = abs_text.attrib.get('Label')
            text = "".join(abs_text.itertext()).strip()
            if label and text:
                abstract_texts.append(f"**{label}**: {text}")
            elif text:
                abstract_texts.append(text)
                
        summary = "\n\n".join(abstract_texts)
        summary = "\n\n".join(" ".join(p.split()) for p in summary.split("\n\n"))
        
        authors = []
        for author in article.findall('.//AuthorList/Author'):
            last = author.find('LastName')
            fore = author.find('ForeName')
            coll = author.find('CollectiveName')
            if last is not None and fore is not None:
                authors.append(f"{fore.text.strip()} {last.text.strip()}")
            elif last is not None:
                authors.append(last.text.strip())
            elif coll is not None:
                authors.append(coll.text.strip())
                
        pub_date = article.find('.//JournalIssue/PubDate')
        year_str = ""
        month_str = "01"
        day_str = "01"
        if pub_date is not None:
            year_elem = pub_date.find('Year')
            month_elem = pub_date.find('Month')
            day_elem = pub_date.find('Day')
            medline_elem = pub_date.find('MedlineDate')
            
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
        
        journal_elem = article.find('.//Journal/Title')
        journal = journal_elem.text.strip() if journal_elem is not None else ""
        
        keywords = []
        for kw in article.findall('.//KeywordList/Keyword'):
            keywords.append("".join(kw.itertext()).strip())
    except Exception as e:
        logger.error(f"Error parseando el XML de PubMed: {e}")
        raise RuntimeError(f"Error procesando la respuesta de PubMed: {e}")
        
    # Create the markdown file
    dest_dir = workspace_root / "imports" / "pubmed"
    dest_dir.mkdir(parents=True, exist_ok=True)
    file_path = dest_dir / f"{pmid}.md"
    
    tags = ["pubmed", "paper", "medical"]
    for kw in keywords[:5]: # Take top 5 keywords
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
