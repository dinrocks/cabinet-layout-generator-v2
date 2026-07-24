"""Optional Supabase JWT auth for the service.

When SUPABASE_JWT_SECRET is set, `/upload` and `/export` require a valid Supabase
access token. Verifies BOTH signing schemes a Supabase project can use:

  - **legacy HS256** shared secret (the value in SUPABASE_JWT_SECRET), and
  - the newer **asymmetric signing keys** (RS256/ES256), verified against the
    project JWKS at ``{SUPABASE_URL}/auth/v1/.well-known/jwks.json``.

The algorithm is read from the token header, so whichever the project uses just
works. When the secret is unset (local dev) the endpoints stay open. Enforcement
is gated on SUPABASE_JWT_SECRET so the cutover is controlled by when it's added on
the host. (SKILL.md §7 invariant 8, CLAUDE.md §5.)
"""
from __future__ import annotations

import os

from fastapi import Header, HTTPException

try:
    import jwt  # PyJWT
    from jwt import PyJWKClient
except ImportError:  # pragma: no cover - dependency missing only in a broken env
    jwt = None  # type: ignore[assignment]
    PyJWKClient = None  # type: ignore[assignment]

# Supabase access tokens carry aud="authenticated" for a signed-in user.
_AUDIENCE = "authenticated"
_jwk_client: object | None = None  # cached PyJWKClient (lazy)


def auth_enabled() -> bool:
    """True when JWT enforcement is configured. Safe to expose (a boolean) so
    /health can confirm the deployed config without leaking the secret."""
    return bool(os.environ.get("SUPABASE_JWT_SECRET"))


def require_auth_configured() -> bool:
    """True when REQUIRE_AUTH is set, making a missing secret a hard error instead
    of an open door. Set REQUIRE_AUTH=1 in EVERY deployed environment so a dropped
    SUPABASE_JWT_SECRET fails closed (503) rather than silently opening the service.
    A public accessor so /health can report it without touching a private name."""
    return os.environ.get("REQUIRE_AUTH", "").strip().lower() in ("1", "true", "yes", "on")


def _jwks():
    """Cached JWKS client for the project's asymmetric signing keys (lazy)."""
    global _jwk_client
    if _jwk_client is not None:
        return _jwk_client
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not url or PyJWKClient is None:
        return None
    _jwk_client = PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json")
    return _jwk_client


def require_user(authorization: str | None = Header(default=None)) -> str | None:
    """Return the user id (`sub`) from a valid Supabase JWT, or None when auth is
    not configured. Raises 401 with a SPECIFIC reason when configured but the
    token is missing/invalid (so the cause is diagnosable from the client)."""
    secret = os.environ.get("SUPABASE_JWT_SECRET")
    if not secret:
        # Fail CLOSED where auth is declared required, so a dropped env var on
        # redeploy can't silently open /upload · /export · /block (RISK_REVIEW R3
        # M1). Stays open only in local dev, where REQUIRE_AUTH is unset.
        if require_auth_configured():
            raise HTTPException(503, "Service auth is required but SUPABASE_JWT_SECRET is not configured.")
        return None  # auth disabled (local dev) — open endpoint
    if jwt is None:
        raise HTTPException(500, "PyJWT is not installed on the service")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()

    try:
        alg = str(jwt.get_unverified_header(token).get("alg", "HS256"))
    except Exception as exc:
        raise HTTPException(401, "Malformed token (not a JWT)") from exc

    try:
        if alg.upper().startswith(("RS", "ES", "PS")):
            # newer Supabase asymmetric signing keys → verify via the project JWKS
            client = _jwks()
            if client is None:
                raise HTTPException(
                    500,
                    "Token uses asymmetric signing but SUPABASE_URL is not set for JWKS lookup.",
                )
            signing_key = client.get_signing_key_from_jwt(token).key
            payload = jwt.decode(token, signing_key, algorithms=[alg], audience=_AUDIENCE)
        else:
            payload = jwt.decode(token, secret, algorithms=["HS256"], audience=_AUDIENCE)
    except HTTPException:
        raise
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(401, "Token expired — sign out and back in, then retry.") from exc
    except jwt.InvalidAudienceError as exc:
        raise HTTPException(401, "Token audience is not 'authenticated'.") from exc
    except jwt.InvalidSignatureError as exc:
        raise HTTPException(
            401,
            "Token signature mismatch — SUPABASE_JWT_SECRET on the service does not "
            "match this Supabase project's JWT secret.",
        ) from exc
    except Exception as exc:  # any other PyJWT error — name it, never a raw crash
        raise HTTPException(401, f"Invalid token ({type(exc).__name__}).") from exc

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(401, "Token has no subject")
    return str(sub)
