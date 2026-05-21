import tempfile
import io
import zipfile
from pathlib import Path
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from backend.imports import import_arxiv, import_pubmed, download_and_extract_github
import backend.library_bridge as bridge

# Mock XML content for arXiv
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
        
        # Configure bridge settings
        bridge.WORKSPACE_ROOT = workspace_root
        client = TestClient(bridge.app)
        
        # Test 1: /api/create/folder
        resp = client.post("/api/create/folder", json={"path": "documents"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        assert (workspace_root / "documents").exists()
        assert (workspace_root / "documents").is_dir()
        
        # Test 2: /api/create/file
        resp = client.post("/api/create/file", json={"path": "documents/note.md", "content": "# Hello"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        note_file = workspace_root / "documents" / "note.md"
        assert note_file.exists()
        assert note_file.read_text(encoding="utf-8") == "# Hello"
        
        # Test 3: Path outside workspace protection
        resp = client.post("/api/create/file", json={"path": "../outside.md"})
        assert resp.status_code == 403
        
        # Test 4: /api/create/arxiv
        resp = client.post("/api/create/arxiv", json={"id": "2303.08774"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        assert (workspace_root / "imports" / "arxiv" / "2303.08774.md").exists()
