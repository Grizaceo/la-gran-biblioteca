# Changelog

## Unreleased

### Added
- Open-source readiness: GitHub templates, Dependabot, CI (pytest, tsc, ruff)
- Generic vault profile (`WORKSPACE_ROOT=~/knowledge`) in `.env.example`; Hermes path documented as commented alternative
- Docker Compose `${WORKSPACE_ROOT:-./vault}` volume (no hardcoded `~/.hermes`)
- `docs/ecosystem-hermes.md` for RepoCiv/Hermes context; technical architecture in `docs/ARQUITECTURA.md`
- Constellation layout (IA88 catalog), API prefs, frontend UX (experimental labels)
- `pyproject.toml` ruff configuration

### Changed
- `SECURITY.md` — report via GitHub Security Advisories
- `CONTRIBUTING.md` — `main` branch, `health.sh`, local `.env` guard
- `README.md` — dual setup profiles, publish checklist, CI badge placeholder
- `frontend/package.json` — MIT license and repository metadata placeholder

### Fixed
- `test_study_node_persists` — patch `app_deps.engine` so `/api/study` persists to the test database
- Ruff lint across `backend/` (unused imports, preview helper)

### Security
- arXiv `LGB_ARXIV_USER_AGENT` placeholder uses generic `github.com/TU_USUARIO/la-gran-biblioteca`

## 0.1.0 — 2026-05-21

### Added
- MCP stdio server exposing the knowledge graph as native agent tools
- Menu bar with local file/folder import, GitHub, arXiv, and PubMed ingestion
- Activity log panel with collapsible SSE-driven event feed
- Auto-focus on newly imported items via SSE update stream
- Native OS file/folder dialogs (Windows, macOS, WSL)
- Smooth camera animation on autofocus and folder reveal
- Rotating starfield background, tubular filament edges, and animated photon particles
- Shared geometry cache, 3-level LOD, and progressive batch loader for large graphs
- Right-click context menu to open nodes in OS file explorer
- Semantic frontmatter analysis, wikilinks, tags, and co-location edges
- Detail panel with markdown preview and syntax-highlighted code preview
- Visibility filter by node type category
- Paginated graph endpoint with transparent streaming

### Security
- XSS hardening: DOMPurify on markdown, HTML-escaped tooltips
- Path traversal validation on all file access endpoints
- ZIP extraction path safety checks
- Optional `LGB_API_KEY` auth for mutating endpoints
- Production mode (`LGB_PRODUCTION=1`) for error masking

### Changed
- Backend imports converted to relative paths with `__init__.py` package
- `.gitignore` improvements (SQLite, logs, coverage, local config)
