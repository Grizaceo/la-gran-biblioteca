"""Optional API key auth and in-memory rate limiting for exposed deployments."""

from __future__ import annotations

import os
import time
from collections import defaultdict

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

API_KEY = os.environ.get("LGB_API_KEY", "").strip()
RATE_LIMIT_WINDOW = 60.0
RATE_LIMIT_MAX = int(os.environ.get("LGB_RATE_LIMIT_PER_MIN", "30"))
PRODUCTION = os.environ.get("LGB_PRODUCTION", "").lower() in ("1", "true", "yes")

MUTATING_PREFIXES = (
    "/api/rescan",
    "/api/rollback",
    "/api/study",
    "/api/create/",
    "/api/notes",
    "/api/open",
    "/api/vaults",
)

RATE_LIMITED_PREFIXES = MUTATING_PREFIXES

_rate_buckets: dict[str, list[float]] = defaultdict(list)


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def check_rate_limit(request: Request) -> None:
    path = request.url.path
    if request.method != "POST" or not any(path.startswith(p) for p in RATE_LIMITED_PREFIXES):
        return
    now = time.monotonic()
    key = f"{_client_key(request)}:{path}"
    bucket = _rate_buckets[key]
    bucket[:] = [t for t in bucket if now - t < RATE_LIMIT_WINDOW]
    if len(bucket) >= RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    bucket.append(now)


def requires_api_key(request: Request) -> bool:
    if not API_KEY:
        return False
    path = request.url.path
    if request.method == "GET" and path in (
        "/api/health",
        "/api/graph",
        "/api/overview",
        "/api/stream",
    ):
        return False
    if request.method == "GET" and path.startswith("/api/node/"):
        return False
    if request.method in ("POST", "PUT", "DELETE", "PATCH") and any(
        path.startswith(p) for p in MUTATING_PREFIXES
    ):
        return True
    return False


class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if requires_api_key(request):
            if request.headers.get("X-API-Key") != API_KEY:
                return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        try:
            check_rate_limit(request)
        except HTTPException as exc:
            return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
        return await call_next(request)


def safe_error_detail(exc: Exception) -> str:
    if PRODUCTION:
        return "Internal server error"
    return str(exc)
