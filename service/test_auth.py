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
assert auth.require_user(None) is None
assert auth.require_user("Bearer anything") is None
print("OK: open when no secret set")

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

print("ALL AUTH ASSERTIONS PASSED")
