# Changelog

## Unreleased

### Added
- Open-source readiness: LICENSE (MIT), CONTRIBUTING.md, SECURITY.md
- Stricter path containment in `path_from_node_id` and `path_from_node_id_fuzzy`
- DOMPurify sanitization on highlight.js code preview output
- HTML escaping on breadcrumb node names in focus, search, and visibility panels
- Production-safe error messages (stack traces hidden from UI)

### Fixed
- Path traversal via node IDs that resolved outside `WORKSPACE_ROOT`
- Stack traces and internal file paths exposed in browser error overlay (`main.ts` and `index.html`)
- Unescaped user content in `innerHTML` assignments (focus.js breadcrumb, visibility panel)
- Raw exception details leaked in `/api/rescan`, `/api/open`, and `read_preview` endpoints

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
