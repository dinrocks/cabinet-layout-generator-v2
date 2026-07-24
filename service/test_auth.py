"""Local test for the JWT auth dependency (run with the service venv: python test_auth.py)."""
from __future__ import annotations

import os
import time

import jwt
from fastapi import HTTPException

import auth

SECRET = "test-secret-123"


def _token(sub: str = "user-1", aud: str = "authenticated", exp_delta: int = 3600) -> str:
    return jwt.encode(
        {"sub": sub, "aud": aud, "exp": int(time.time()) + exp_delta},
        SECRET, algorithm="HS256",
    )


# 1) no secret configured → endpoint is open (returns None)
os.environ.pop("SUPABASE_JWT_SECRET", None)
os.environ.pop("REQUIRE_AUTH", None)
assert auth.require_user(None) is None
assert auth.require_user("Bearer anything") is None
print("OK: open when no secret set")

# 1b) REQUIRE_AUTH set + secret missing → FAIL CLOSED (503, not open) — a dropped
# secret on redeploy must never silently open the service (RISK_REVIEW R3 M1)
os.environ["REQUIRE_AUTH"] = "1"
assert auth.require_auth_configured() is True
try:
    auth.require_user(None)
    raise AssertionError("expected 503 when REQUIRE_AUTH set and secret missing")
except HTTPException as e:
    assert e.status_code == 503, e.status_code
del os.environ["REQUIRE_AUTH"]
assert auth.require_user(None) is None  # back to open in dev
print("OK: REQUIRE_AUTH + no secret -> 503 (fail closed); open again when unset")

# 2) secret configured → enforce
os.environ["SUPABASE_JWT_SECRET"] = SECRET

assert auth.require_user(f"Bearer {_token()}") == "user-1"
print("OK: valid token -> sub")


def _expect_401(authorization):
    try:
        auth.require_user(authorization)
    except HTTPException as e:
        assert e.status_code == 401, e.status_code
        return
    raise AssertionError("expected 401")


_expect_401(None)                                  # missing header
_expect_401("Bearer not.a.jwt")                    # malformed
_expect_401(f"Bearer {_token(aud='other')}")       # wrong audience
_expect_401(f"Bearer {_token(exp_delta=-10)}")     # expired
print("OK: 401 on missing / malformed / wrong-aud / expired")


def _detail(authorization) -> str:
    try:
        auth.require_user(authorization)
    except HTTPException as e:
        return e.detail
    raise AssertionError("expected 401")


# a token signed with the WRONG secret -> specific "signature mismatch" message
# (this is the most common real-world cause: SUPABASE_JWT_SECRET set to a wrong value)
_bad = jwt.encode(
    {"sub": "u", "aud": "authenticated", "exp": int(time.time()) + 3600},
    "a-different-secret", algorithm="HS256",
)
assert "signature" in _detail(f"Bearer {_bad}").lower()
print("OK: wrong secret -> 'signature mismatch' (diagnosable)")

print("ALL AUTH ASSERTIONS PASSED")
