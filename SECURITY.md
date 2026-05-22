# Security

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Use [GitHub Security Advisories](https://github.com/TU_USUARIO/la-gran-biblioteca/security/advisories/new) (preferred) or email the maintainer privately. You should receive a response within 48 hours. If the issue is confirmed, we will release a fix as soon as possible.

## Scope

La Gran Biblioteca is a **local-first knowledge graph tool**. It runs on your machine, reads your local filesystem, and serves a web UI on localhost.

## Security model

### Local-only by default

The backend binds to `127.0.0.1:3001` and the frontend dev server to `localhost:5173`. No network exposure unless you explicitly configure it.

### Optional API key

Set `LGB_API_KEY` in `.env` to require an `X-API-Key` header on mutating endpoints (POST `/api/rescan`, `/api/study`, `/api/create/*`, `/api/open`). Read endpoints remain open.

### Path containment

All filesystem access is contained within `WORKSPACE_ROOT`. Node IDs and stored paths are validated to prevent directory traversal outside the workspace.

### Rate limiting

In-memory rate limiting (default: 30 mutations/min per client IP). Note: this is per-process, not shared across workers. Deployments with multiple gunicorn/uvicorn workers should use a shared store if rate limiting is needed.

### Production hardening

Set `LGB_PRODUCTION=1` to:
- Hide internal exception details in HTTP 500 responses (generic `"Internal server error"` instead of stack traces)
- Disable permissive CORS regex for localhost dev ports

### XSS prevention

- Markdown previews are sanitized through DOMPurify before DOM insertion
- Code highlighting output is sanitized through DOMPurify
- Node labels, breadcrumb names, and search results are HTML-escaped before rendering

### npm audit

Run `npm audit` in `frontend/` periodically. Known vulnerabilities in dev dependencies (vite, esbuild) are documented in the README and only affect the dev server.

## Supported versions

Only the latest `main` branch receives security fixes.
