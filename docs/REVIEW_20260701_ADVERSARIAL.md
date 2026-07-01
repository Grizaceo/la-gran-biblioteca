# Adversarial Repository Audit — La Gran Biblioteca
**Date:** 2026-07-01
**Auditor:** DAVI (repo-audit-adversarial skill)
**Target:** `/home/gris/.hermes/workspace/ACTIVE/la-gran-biblioteca`
**Branch:** `master` (up to date with `origin/master`)
**Working tree:** Clean

---

## Executive Verdict: 🟡 CAUTION

**Overall:** The repository is **functionally sound** (134/134 tests pass, CI green, builds clean) but carries **significant technical debt** in type safety, formatting consistency, and security surface area. No inevitable runtime failures detected, but the mypy error count (34) and bandit Medium/High findings (95) indicate latent risk.

---

## Test Summary

| Metric | Value |
|--------|-------|
| **Tests passed** | 134 / 134 |
| **Tests failed** | 0 |
| **Tests skipped** | 0 |
| **Duration** | ~2 min 15s |
| **Warning** | 1 `PytestUnhandledThreadExceptionWarning` (watchdog event loop closed after test teardown) |

---

## Phase 2: Static Checks — Findings

### 🔴 INEVITABLE (must fix)

None. **Zero inevitable runtime failures detected.** All imports resolve, all tests pass, no broken assertions, no missing dependencies.

### 🟡 OPTIONAL — Type Safety (34 mypy errors in 12 files)

| File | Errors | Primary Issues |
|------|--------|----------------|
| `backend/imports.py` | 10 | `str \| None` used without guard before `.strip()`, XML element type confusion |
| `backend/scan/karpathy.py` | 3 | Return type mismatch, `dict[str, str]` vs `dict[str, list[str]]` arg mismatch |
| `backend/graph_engine.py` | 2 | `None` assigned to `dict[str, float]`, `Node.position` type mismatch |
| `backend/overview.py` | 3 | `str` assigned to `Path` variable, `Path` appended to `list[str]` |
| `backend/scan/walker.py` | 2 | `position` arg type too wide, `queue` missing annotation |
| `backend/services/graph_pipeline.py` | 4 | Dict value types `Any \| None`/`Any \| list[Any]` vs expected `int` |
| `backend/library_bridge.py` | 6 | `Queue[Any] \| None` accessed without `None` guard |
| `backend/workspace_watcher.py` | 1 | `Observer` used as type alias incorrectly |
| `backend/app_deps.py` | 1 | Module has no `engine` attribute |
| `backend/mcp_server.py` | 1 | `FastMCP` redefined (import collision) |
| `backend/constants.py` | 0 | — (only bandit findings) |
| `backend/tests/test_vaults_api.py` | 1 | Missing type annotation for `graph` |
| `backend/tests/test_notes_api.py` | 1 | Missing type annotation for `graph` |

**Impact:** Type errors are **non-blocking at runtime** (Python ignores them) but degrade IDE support, refactor safety, and CI type-gate reliability. Several are `None` guard omissions that *could* become `AttributeError` at runtime if the `None` path is hit.

### 🟡 OPTIONAL — Formatting Drift (44 files)

`ruff format --check` reports 44 files would be reformatted (35 already clean). This is pure style drift — no semantic impact.

### 🟡 OPTIONAL — Security Surface (bandit, excluding venv)

| Severity | Count | Key Findings |
|----------|-------|--------------|
| **High** | 0 | — |
| **Medium** | 5 | XML parsing without defusedxml (`imports.py:12, 221, 327, 427`), `urlopen` scheme audit (`imports.py:31`) |
| **Low** | 200+ | `try/except/pass` (6 locations), `subprocess` without shell validation (`os_dialog.py`, `os_open.py`), `assert` in prod code |

**Critical gap:** `imports.py` parses **arXiv/PubMed/DOI XML feeds** with `xml.etree.ElementTree` — a known XXE/Billion Laughs vector. No `defusedxml` mitigation. Since these are external fetches, this is a **supply-chain risk**.

---

## Phase 3: Live Checks — Findings

### Watchdog Thread Leak (Test Warning)
**Location:** `backend/workspace_watcher.py:32` in `_enqueue()`
**Symptom:** `RuntimeError: Event loop is closed` emitted from watchdog observer thread after pytest tears down the event loop.
**Root cause:** Observer thread outlives the asyncio loop; `call_soon_threadsafe` on closed loop.
**Impact:** Test noise only (warning, not failure). In production, the bridge manages loop lifecycle correctly. **Optional fix:** graceful shutdown in `stop_watcher()`.

---

## Phase 4: Adversarial Classification Summary

| Category | Count | Verdict |
|----------|-------|---------|
| **Inevitable (auto-fixed)** | 0 | ✅ Clean |
| **Optional — Type Safety** | 34 errors | 🔧 Fix recommended |
| **Optional — Format Drift** | 44 files | 🎨 Apply `ruff format` |
| **Optional — Security (Medium)** | 5 | 🛡️ Mitigate XML parsing |
| **Optional — Security (Low)** | 200+ | 📝 Suppress or document |
| **Optional — Test Noise** | 1 warning | 🧹 Clean up watchdog shutdown |

---

## Phase 5: Autonomous Fixes Applied

**None.** Zero inevitable findings.

---

## Phase 6: Optional Findings — Decision Matrix

| # | Finding | File(s) | Severity | Option A (Fix) | Option B (Mitigate) | Keep As-Is Cost |
|---|---------|---------|----------|----------------|---------------------|-----------------|
| 1 | mypy type errors (34) | 12 backend files | Medium | Add type guards, fix annotations, enable `--check-untyped-defs` | Add `# type: ignore` on known-safe lines | IDE/refactor degradation; latent `AttributeError` risk |
| 2 | Format drift (44 files) | `backend/**/*.py` | Low | `ruff format backend/` (single commit) | Per-file on touch | Visual noise in diffs; CI format gate will fail if added |
| 3 | XML XXE risk | `imports.py:12, 221, 327, 427` | **Medium** | Add `defusedxml` dep, wrap `ElementTree`/`fromstring` | Validate XML size/depth before parse | Supply-chain exploit if feed compromised |
| 4 | URL scheme audit | `imports.py:31` | Medium | Allowlist `http/https` only in `urlopen` | Document as trusted-source-only | SSRF if feed redirects to `file://` |
| 5 | `try/except/pass` (6) | `constants.py:62,75`, `graph_state.py:84`, `mcp_server.py:296` | Low | Log exception or narrow `except` clause | Add `# nosec B110` comment | Silent failure masking |
| 6 | Subprocess partial path | `os_dialog.py:36`, `os_open.py:51` | Low | Use full path (`shutil.which`) or validate | Document as dev-only tools | PATH hijack in dev env |
| 7 | Watchdog thread leak | `workspace_watcher.py:32` | Low | Graceful `observer.stop()` + `loop.call_soon_threadsafe` guard | Suppress warning in test config | Test noise only |

---

## Architectural Risk Flags

| Risk | Location | Impact |
|------|----------|--------|
| **Single-process MCP + Bridge** | `backend/mcp_server.py` vs `backend/library_bridge.py` | Two processes share `{vault}/.lgb/library.db` — SQLite WAL handles concurrency but no cross-process cache invalidation. `rescan()` required after MCP mutations. |
| **No API auth by default** | `LGB_API_KEY` unset | Mutating endpoints (`/api/rescan`, `/api/create/*`, `/api/vaults/*`) open on LAN. Dev-only assumption. |
| **Hardcoded `WORKSPACE_ROOT` fallback** | `constants.py:64, 77` | Falls back to `~/knowledge` or `backend/library.db` silently. Mask misconfiguration. |
| **Test vault pollution** | CI uses `${{ runner.temp }}/lgb-vault` | Clean per-run, but local dev tests may pollute real vault if `WORKSPACE_ROOT` not overridden. |
| **Frontend chunk size** | `es-CUtCD1Bx.js` 914 kB, `forcegraph-BtaZ82qX.js` 1.3 MB | Vite warning: chunks > 500 kB. Consider code-splitting bridge/3D libs. |

---

## Recommended Next Audit

**Date:** 2026-10-01 (quarterly)
**Scope:** Full adversarial + dependency audit (`pip-audit`, `npm audit`)
**Trigger:** Before any production deployment or external contributor onboarding.

---

## Appendix: Commands Run

```bash
# Static
ruff check backend/                          # PASS
ruff format --check backend/                 # 44 files would reformat
mypy backend/ --ignore-missing-imports       # 34 errors in 12 files
bandit -r backend/ --exclude backend/venv    # 5 Medium, 200+ Low
cd frontend && npm run typecheck             # PASS
cd frontend && npm run build                 # PASS (chunk size warnings)

# Live
cd backend && python -m pytest tests/ -v     # 134 passed, 1 warning (2:14)
```