"""Verification harness for GET /block/{id} (runs locally AND in CI).

Exercises the portable-bundle download path against the LOCAL block cache (no
Supabase env in CI): put a block via store.put, fetch it through the FastAPI
route, and check the guardrails — a bad id is rejected (400, path-traversal
safe) and a missing block is a clean 404.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

import store
from app import app

client = TestClient(app)

# 1) retain a synthetic block in the local store
DATA = b"0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n"
block_id = store.put(DATA)
print("stored block:", block_id)

# 2) download it through the API route
r = client.get(f"/block/{block_id}")
assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
assert r.content == DATA, "bytes must round-trip unchanged"
assert "application/dxf" in r.headers.get("content-type", ""), r.headers.get("content-type")
assert f'{block_id}.dxf' in r.headers.get("content-disposition", ""), "download filename"
print("OK: block round-trips through GET /block/{id}")

# 3) guardrails. A slash-bearing id can't even match the single-segment route
#    (router 404 — never reaches the store); an id with other illegal chars hits
#    the regex guard (400); an unknown-but-valid id is a clean 404.
r = client.get("/block/..%2f..%2fetc%2fpasswd")
assert r.status_code in (400, 404), f"traversal path must not be served, got {r.status_code}"
r = client.get("/block/bad%20id%21")
assert r.status_code == 400, f"illegal chars must be rejected, got {r.status_code}"
r = client.get("/block/blk_does_not_exist_123")
assert r.status_code == 404, f"missing block must 404, got {r.status_code}"
print("OK: traversal blocked, bad id -> 400, missing block -> 404")

# 4) store-level validation is the single chokepoint (RISK_REVIEW R3 M2): every id
#    is checked BEFORE any filesystem/URL use, so the /export path (which routes
#    client library block_refs through store.path) is covered too.
import dxf_build

for bad in ("../etc/passwd", "a/b", "x" * 81, "has space", "", "a.b", "..\\win"):
    try:
        store.path(bad)
        raise AssertionError(f"store.path must reject {bad!r}")
    except store.InvalidBlockId:
        pass
try:
    store.put(b"x", suggested_id="../evil")
    raise AssertionError("store.put must reject a traversal suggested_id")
except store.InvalidBlockId:
    pass
print("OK: store.path/put reject traversal + malformed ids")

# a malicious block_ref in an EXPORT payload aborts the assemble as InvalidBlockId
# (which app.py maps to 400) — never a filesystem read or an opaque 500
evil_model = {
    "project": {"name": "x"}, "plate": {"width_mm": 100, "height_mm": 100, "origin": "top_left"},
    "ducts": [], "groups": [], "labels": [],
    "elements": [{"id": "e", "lib_key": "evil", "tag": "", "x_mm": 0, "y_mm": 0, "rot_deg": 0,
                  "gap_before_mm": 0.1, "clearance_to_duct_mm": 3, "group_id": None, "locked": False}],
}
evil_library = {"evil": {"source": "dxf", "name": "evil", "width_mm": 10, "height_mm": 10, "block_ref": "../../secret"}}
try:
    dxf_build.assemble(evil_model, evil_library, 1.0)
    raise AssertionError("export with a traversal block_ref must raise InvalidBlockId")
except store.InvalidBlockId:
    pass
print("OK: export payload with a traversal block_ref -> InvalidBlockId (400, not 500)")

print("ALL ASSERTIONS PASSED")
