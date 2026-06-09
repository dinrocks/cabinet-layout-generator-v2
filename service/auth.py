"""Optional Supabase JWT auth for the service.

When SUPABASE_JWT_SECRET is set, `/upload` and `/export` require a valid Supabase
access token (HS256, aud=authenticated). When it's unset (local dev) the endpoints
stay open. Enforcement is gated on that env var so the cutover is controlled by
when it's added on the host. (SKILL.md §7 invariant 8, CLAUDE.md §5.)
"""
from __future__ import annotations

import os

from fastapi import Header, HTTPException

try:
    import jwt  # PyJWT
except ImportError:  # pragma: no cover - dependency missing only in a broken env
    jwt = None  # type: ignore[assignment]


def auth_enabled() -> bool:
    """True when JWT enforcement is configured. Safe to expose (a boolean) so
    /health can confirm the deployed config without leaking the secret."""
    return bool(os.environ.get("SUPABASE_JWT_SECRET"))


def require_user(authorization: str | None = Header(default=None)) -> str | None:
    """Return the user id (`sub`) from a valid Supabase JWT, or None when auth is
    not configured. Raises 401 when configured but the token is missing/invalid."""
    secret = os.environ.get("SUPABASE_JWT_SECRET")
    if not secret:
        return None  # auth disabled (local dev) — open endpoint
    if jwt is None:
        raise HTTPException(500, "PyJWT is not installed on the service")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"], audience="authenticated")
    except Exception as exc:  # invalid signature / expired / wrong audience
        raise HTTPException(401, "Invalid or expired token") from exc
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(401, "Token has no subject")
    return str(sub)
