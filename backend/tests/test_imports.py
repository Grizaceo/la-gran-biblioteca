import tempfile
import io
import zipfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

from backend.imports import (
    import_arxiv,
    import_doi,
    import_pmc,
    import_preprint,
    import_pubmed,
    download_and_extract_github,
    _safe_extract_zip,
    search_arxiv,
)
from backend.scan_workspaces import scan_import_paths, merge_scan_graphs, node_id_for_import_path
import backend.library_bridge as bridge

# Mock XML content for arXiv
MOCK_ARXIV_SEARCH_XML = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>2</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v5</id>
    <title>Attention Is All You Need</title>
    <summary>We propose the Transformer architecture for sequence transduction.</summary>
    <published>2017-06-12T10:00:00Z</published>
    <updated>2017-08-02T10:00:00Z</updated>
    <author><name>Ashish Vaswani</name></author>
    <arxiv:primary_category term="cs.CL"/>
    <category term="cs.CL"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/1810.04805v2</id>
    <title>BERT: Pre-training of Deep Bidirectional Transformers</title>
    <summary>We introduce a new language representation model called BERT.</summary>
    <published>2018-10-11T10:00:00Z</published>
    <updated>2019-05-24T10:00:00Z</updated>
    <author><name>Jacob Devlin</name></author>
    <arxiv:primary_category term="cs.CL"/>
  </entry>
</feed>
"""

MOCK_ARXIV_WITHDRAWN_XML = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/9999.99999v1</id>
    <title>Withdrawn Paper Example</title>
    <summary>This paper has been withdrawn and should not be cited.</summary>
    <published>2020-01-01T10:00:00Z</published>
    <author><name>Test Author</name></author>
  </entry>
</feed>
"""

MOCK_ARXIV_XML = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2303.08774v1</id>
    <title>Attention Is All You Need</title>
    <summary>We propose a new simple network architecture, the Transformer...</summary>
    <published>2017-06-12T10:00:00Z</published>
    <author>
      <name>Ashish Vaswani</name>
    </author>
    <author>
      <name>Noam Shazeer</name>
    </author>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL"/>
    <category term="cs.CL"/>
    <category term="cs.AI"/>
  </entry>
</feed>
"""

# Mock XML content for PubMed
MOCK_PUBMED_XML = """<?xml version="1.0" encoding="UTF-8"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>36915867</PMID>
      <Article>
        <ArticleTitle>A beautiful medical discovery</ArticleTitle>
        <Abstract>
          <AbstractText Label="OBJECTIVE">To discover something new.</AbstractText>
          <AbstractText Label="RESULTS">We discovered it.</AbstractText>
        </Abstract>
        <AuthorList>
          <Author>
            <LastName>Smith</LastName>
            <ForeName>John</ForeName>
          </Author>
        </AuthorList>
        <Journal>
          <Title>Journal of Medicine</Title>
          <JournalIssue>
            <PubDate>
              <Year>2023</Year>
              <Month>03</Month>
              <Day>15</Day>
            </PubDate>
          </JournalIssue>
        </Journal>
      </Article>
      <KeywordList>
        <Keyword>Medicine</Keyword>
        <Keyword>Discovery</Keyword>
      </KeywordList>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>
"""

def create_mock_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zip_ref:
        zip_ref.writestr("octocat-Spoon-Knife-71ad982/README.md", "# Spoon Knife\\nCloned repo!")
        zip_ref.writestr("octocat-Spoon-Knife-71ad982/src/main.py", "print('hello')")
    return buf.getvalue()


@patch("urllib.request.urlopen")
def test_search_arxiv_returns_two_results(mock_urlopen):
    mock_response = MagicMock()
    mock_response.read.return_value = MOCK_ARXIV_SEARCH_XML.encode("utf-8")
    mock_urlopen.return_value.__enter__.return_value = mock_response

    result = search_arxiv(query="transformer", max_results=10)
    assert result["total"] == 2
    assert len(result["results"]) == 2
    first = result["results"][0]
    assert first["arxiv_id"] == "1706.03762"
    assert first["title"] == "Attention Is All You Need"
    assert first["authors"] == ["Ashish Vaswani"]
    assert first["published"] == "2017-06-12"
    assert first["updated"] == "2017-08-02"
    assert first["categories"] == ["cs.CL"]
    assert "Transformer" in first["abstract"]
    assert first["abs_url"].startswith("http")
    assert "1706.03762" in first["pdf_url"]
    assert first["withdrawn"] is False

    req = mock_urlopen.call_args[0][0]
    assert "export.arxiv.org" in req.full_url
    assert "search_query=" in req.full_url
    assert "max_results=10" in req.full_url


@patch("urllib.request.urlopen")
def test_search_arxiv_withdrawn(mock_urlopen):
    mock_response = MagicMock()
    mock_response.read.return_value = MOCK_ARXIV_WITHDRAWN_XML.encode("utf-8")
    mock_urlopen.return_value.__enter__.return_value = mock_response

    result = search_arxiv(query="withdrawn", max_results=5)
    assert len(result["results"]) == 1
    assert result["results"][0]["withdrawn"] is True


@patch("urllib.request.urlopen")
def test_api_arxiv_search_endpoint(mock_urlopen):
    mock_response = MagicMock()
    mock_response.read.return_value = MOCK_ARXIV_SEARCH_XML.encode("utf-8")
    mock_urlopen.return_value.__enter__.return_value = mock_response

    client = TestClient(bridge.app)
    resp = client.get("/api/arxiv/search", params={"q": "transformer", "max": 5})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert len(data["results"]) == 2
    assert data["results"][0]["arxiv_id"] == "1706.03762"


def test_scan_import_paths_adds_github_tree():
    with tempfile.TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        repo = root / "imports" / "github" / "owner-repo"
        docs = repo / "docs"
        docs.mkdir(parents=True)
        (repo / "README.md").write_text("# Demo\n", encoding="utf-8")
        (docs / "guide.md").write_text("# Guide\n", encoding="utf-8")

        patch = scan_import_paths([repo], root)
        ids = {n["id"] for n in patch["nodes"]}
        assert "folder_imports/github/owner-repo" in ids
        assert "file_imports/github/owner-repo/README.md" in ids
        assert "file_imports/github/owner-repo/docs/guide.md" in ids


def test_scan_import_paths_adds_file_node():
    with tempfile.TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        dest = root / "imports" / "arxiv"
        dest.mkdir(parents=True)
        paper = dest / "2605.21675.md"
        paper.write_text("# Test\n", encoding="utf-8")
        patch = scan_import_paths([paper], root)
        ids = {n["id"] for n in patch["nodes"]}
        assert node_id_for_import_path(paper, root) in ids
        file_nodes = [n for n in patch["nodes"] if n["id"] == "file_imports/arxiv/2605.21675.md"]
        assert len(file_nodes) == 1
        assert "2605.21675" in file_nodes[0]["path"]


def test_merge_scan_graphs_dedupes_nodes():
    base = {"nodes": [{"id": "a", "type": "file", "label": "A", "path": "/a", "metadata": {}, "position": {}}], "edges": []}
    extra = {"nodes": [{"id": "a", "label": "A2", "type": "file", "path": "/a", "metadata": {}, "position": {}}], "edges": []}
    merged = merge_scan_graphs(base, extra)
    assert len(merged["nodes"]) == 1
    assert merged["nodes"][0]["label"] == "A2"


@patch("urllib.request.urlopen")
def test_import_arxiv(mock_urlopen):
    # Setup mock response
    mock_response = MagicMock()
    mock_response.read.return_value = MOCK_ARXIV_XML.encode("utf-8")
    mock_urlopen.return_value.__enter__.return_value = mock_response

    with tempfile.TemporaryDirectory() as tmp_dir:
        workspace_root = Path(tmp_dir)
        
        file_path = import_arxiv("2303.08774", workspace_root)
        
        # Verify file creation
        assert file_path.exists()
        assert file_path.name == "2303.08774.md"
        
        # Read contents and verify parsing
        content = file_path.read_text(encoding="utf-8")
        assert 'title: "Attention Is All You Need"' in content
        assert 'authors: ["Ashish Vaswani", "Noam Shazeer"]' in content
        assert 'date: "2017-06-12"' in content
        assert "We propose a new simple network architecture" in content
        assert "#arxiv" in content
        assert "#arxiv_cs_CL" in content

        # HTTPS export API + encoded id_list
        req = mock_urlopen.call_args[0][0]
        assert "export.arxiv.org" in req.full_url
        assert "id_list=2303.08774" in req.full_url


@patch("urllib.request.urlopen")
def test_import_arxiv_old_id_with_slash(mock_urlopen):
    mock_response = MagicMock()
    mock_response.read.return_value = MOCK_ARXIV_XML.encode("utf-8")
    mock_urlopen.return_value.__enter__.return_value = mock_response

    with tempfile.TemporaryDirectory() as tmp_dir:
        workspace_root = Path(tmp_dir)
        file_path = import_arxiv("https://arxiv.org/abs/astro-ph/0411386v1", workspace_root)
        assert file_path.name == "astro-ph_0411386v1.md"
        req = mock_urlopen.call_args[0][0]
        assert "id_list=astro-ph%2F0411386v1" in req.full_url


@patch("urllib.request.urlopen")
def test_import_arxiv_rejects_api_error_entry(mock_urlopen):
    error_xml = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/api/errors/invalid_id</id>
    <title>Error</title>
    <summary>Invalid arXiv ID: 9999.99999</summary>
  </entry>
</feed>
"""
    mock_response = MagicMock()
    mock_response.read.return_value = error_xml.encode("utf-8")
    mock_urlopen.return_value.__enter__.return_value = mock_response

    with tempfile.TemporaryDirectory() as tmp_dir:
        with pytest.raises(ValueError, match="Invalid arXiv ID"):
            import_arxiv("9999.99999", Path(tmp_dir))


@patch("urllib.request.urlopen")
def test_import_pubmed(mock_urlopen):
    # Setup mock response
    mock_response = MagicMock()
    mock_response.read.return_value = MOCK_PUBMED_XML.encode("utf-8")
    mock_urlopen.return_value.__enter__.return_value = mock_response

    with tempfile.TemporaryDirectory() as tmp_dir:
        workspace_root = Path(tmp_dir)
        
        file_path = import_pubmed("36915867", workspace_root)
        
        # Verify file creation
        assert file_path.exists()
        assert file_path.name == "36915867.md"
        
        # Read contents and verify parsing
        content = file_path.read_text(encoding="utf-8")
        assert 'title: "A beautiful medical discovery"' in content
        assert 'authors: ["John Smith"]' in content
        assert 'date: "2023-03-15"' in content
        assert "**OBJECTIVE**: To discover something new." in content
        assert "**RESULTS**: We discovered it." in content
        assert 'journal: "Journal of Medicine"' in content
        assert "#pubmed" in content
        assert "#pm_medicine" in content


def test_safe_extract_zip_rejects_traversal():
    with tempfile.TemporaryDirectory() as tmp_dir:
        dest = Path(tmp_dir)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("../evil.txt", "bad")
        buf.seek(0)
        with zipfile.ZipFile(buf) as zf:
            with pytest.raises(RuntimeError, match="traversal"):
                _safe_extract_zip(zf, dest)


@patch("urllib.request.urlopen")
def test_import_github(mock_urlopen):
    # Setup mock response
    mock_response = MagicMock()
    mock_response.read.return_value = create_mock_zip()
    mock_urlopen.return_value.__enter__.return_value = mock_response

    with tempfile.TemporaryDirectory() as tmp_dir:
        workspace_root = Path(tmp_dir)
        
        dest_dir = download_and_extract_github("https://github.com/octocat/Spoon-Knife", workspace_root)
        
        # Verify directory structure
        assert dest_dir.exists()
        assert dest_dir.name == "octocat-Spoon-Knife"
        assert (dest_dir / "README.md").exists()
        assert (dest_dir / "src" / "main.py").exists()


@patch("urllib.request.urlopen")
def test_api_create_endpoints(mock_urlopen):
    # Mock arXiv response for API call
    mock_response = MagicMock()
    mock_response.read.return_value = MOCK_ARXIV_XML.encode("utf-8")
    mock_urlopen.return_value.__enter__.return_value = mock_response

    with tempfile.TemporaryDirectory() as tmp_dir:
        workspace_root = Path(tmp_dir)

        with patch("backend.constants.get_workspace_root", return_value=workspace_root), patch(
            "backend.api.create.get_workspace_root", return_value=workspace_root
        ), patch("backend.api.imports_api.get_workspace_root", return_value=workspace_root):
            client = TestClient(bridge.app)

            resp = client.post("/api/create/folder", json={"path": "documents"})
            assert resp.status_code == 200
            assert resp.json()["status"] == "ok"
            assert (workspace_root / "documents").exists()
            assert (workspace_root / "documents").is_dir()

            resp = client.post(
                "/api/create/file",
                json={"path": "documents/note.md", "content": "# Hello"},
            )
            assert resp.status_code == 200
            assert resp.json()["status"] == "ok"
            note_file = workspace_root / "documents" / "note.md"
            assert note_file.exists()
            assert note_file.read_text(encoding="utf-8") == "# Hello"

            resp = client.post("/api/create/file", json={"path": "../outside.md"})
            assert resp.status_code == 403

            resp = client.post("/api/create/arxiv", json={"id": "2303.08774"})
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "ok"
            assert data["path"] == "imports/arxiv/2303.08774.md"
            assert data["node_id"] == "file_imports/arxiv/2303.08774.md"
            assert (workspace_root / "imports" / "arxiv" / "2303.08774.md").exists()


MOCK_CROSSREF_JSON = {
    "message": {
        "title": ["Example Paper via DOI"],
        "author": [{"given": "Jane", "family": "Doe"}],
    }
}

MOCK_EUROPE_PMC_JSON = {
    "resultList": {"result": [{"title": "PMC Example Article"}]}
}

MOCK_PREPRINT_JSON = {
    "collection": [{"title": "A medRxiv Preprint Title"}]
}


@patch("backend.imports._fetch_json")
def test_import_doi(mock_fetch_json):
    mock_fetch_json.return_value = MOCK_CROSSREF_JSON

    with tempfile.TemporaryDirectory() as tmp_dir:
        workspace_root = Path(tmp_dir)
        file_path = import_doi("doi:10.1038/nature12373", workspace_root)
        assert file_path.exists()
        assert file_path.parent.name == "doi"
        content = file_path.read_text(encoding="utf-8")
        assert "10.1038/nature12373" in content
        assert "Example Paper via DOI" in content
        assert "Jane Doe" in content


@patch("backend.imports._fetch_json")
def test_import_doi_stub_on_network_error(mock_fetch_json):
    mock_fetch_json.side_effect = RuntimeError("network")

    with tempfile.TemporaryDirectory() as tmp_dir:
        workspace_root = Path(tmp_dir)
        file_path = import_doi("10.1038/nature12373", workspace_root)
        content = file_path.read_text(encoding="utf-8")
        assert "DOI 10.1038/nature12373" in content


@patch("backend.imports._fetch_json")
def test_import_pmc(mock_fetch_json):
    mock_fetch_json.return_value = MOCK_EUROPE_PMC_JSON

    with tempfile.TemporaryDirectory() as tmp_dir:
        workspace_root = Path(tmp_dir)
        file_path = import_pmc("PMC1234567", workspace_root)
        assert file_path.name == "PMC1234567.md"
        content = file_path.read_text(encoding="utf-8")
        assert "PMC Example Article" in content
        assert "PMC1234567" in content


@patch("backend.imports._fetch_json")
def test_import_preprint_medrxiv(mock_fetch_json):
    mock_fetch_json.return_value = MOCK_PREPRINT_JSON

    with tempfile.TemporaryDirectory() as tmp_dir:
        workspace_root = Path(tmp_dir)
        file_path = import_preprint(
            "medrxiv",
            "https://www.medrxiv.org/content/10.1101/2024.01.01.12345678v1",
            workspace_root,
        )
        assert file_path.parent.name == "medrxiv"
        content = file_path.read_text(encoding="utf-8")
        assert "10.1101/2024.01.01.12345678" in content
        assert "A medRxiv Preprint Title" in content


@patch("backend.imports._fetch_json")
def test_api_create_doi_pmc_preprint(mock_fetch_json):
    def fetch_side_effect(url: str) -> dict:
        if "crossref.org" in url:
            return MOCK_CROSSREF_JSON
        if "europepmc" in url:
            return MOCK_EUROPE_PMC_JSON
        if "biorxiv.org" in url:
            return MOCK_PREPRINT_JSON
        raise RuntimeError(f"unexpected url {url}")

    mock_fetch_json.side_effect = fetch_side_effect

    with tempfile.TemporaryDirectory() as tmp_dir:
        workspace_root = Path(tmp_dir)
        with patch("backend.constants.get_workspace_root", return_value=workspace_root), patch(
            "backend.api.imports_api.get_workspace_root", return_value=workspace_root
        ):
            client = TestClient(bridge.app)

            resp = client.post("/api/create/doi", json={"doi": "10.1038/nature12373"})
            assert resp.status_code == 200
            assert resp.json()["status"] == "ok"
            assert "imports/doi/" in resp.json()["path"]

            resp = client.post("/api/create/pmc", json={"pmcid": "PMC999"})
            assert resp.status_code == 200
            assert (workspace_root / "imports" / "pmc" / "PMC999.md").exists()

            resp = client.post(
                "/api/create/biorxiv",
                json={"id": "10.1101/2024.01.01.99999999"},
            )
            assert resp.status_code == 200
            assert (workspace_root / "imports" / "biorxiv").is_dir()
