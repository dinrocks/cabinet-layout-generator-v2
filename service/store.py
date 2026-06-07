"""Block store — uploaded equipment DXFs, retained for re-embedding on export.

Backed by **Supabase Storage** (durable) with a local on-disk cache, falling back
to local-only when the Storage env isn't configured (local dev). The interface
stays tiny — put(bytes)->id, path(id)->Path, exists(id) — so dxf_upload and
dxf_build don't change. (SKILL.md §2/§3, CLAUDE.md §5.)
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

import httpx

_CACHE_DIR = Path(__file__).parent / "_blocks"
_CACHE_DIR.mkdir(exist_ok=True)

_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
_BUCKET = os.environ.get("SUPABASE_BUCKET", "equipment")
_STORAGE = bool(_URL and _KEY)  # Storage-backed when both are set; else local-only


def _obj_url(block_id: str) -> str:
    return f"{_URL}/storage/v1/object/{_BUCKET}/{block_id}.dxf"


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_KEY}", "apikey": _KEY}


def _cache_file(block_id: str) -> Path:
    return _CACHE_DIR / f"{block_id}.dxf"


def put(data: bytes, *, suggested_id: str | None = None) -> str:
    """Store raw DXF bytes; return a block id. Writes the local cache and, when
    configured, uploads to Supabase Storage (upsert) so it survives a restart."""
    block_id = suggested_id or uuid.uuid4().hex
    _cache_file(block_id).write_bytes(data)
    if _STORAGE:
        r = httpx.post(
            _obj_url(block_id),
            headers={**_headers(), "x-upsert": "true", "Content-Type": "application/octet-stream"},
            content=data,
            timeout=30,
        )
        r.raise_for_status()
    return block_id


def path(block_id: str) -> Path:
    """Local path to the block, downloading from Storage on a cache miss (the case
    after a fresh container with an empty cache)."""
    p = _cache_file(block_id)
    if p.exists():
        return p
    if _STORAGE:
        r = httpx.get(_obj_url(block_id), headers=_headers(), timeout=30)
        if r.status_code == 200:
            p.write_bytes(r.content)
            return p
    raise KeyError(f"block '{block_id}' not in store")


def exists(block_id: str) -> bool:
    if _cache_file(block_id).exists():
        return True
    if _STORAGE:
        try:
            return httpx.get(_obj_url(block_id), headers=_headers(), timeout=15).status_code == 200
        except httpx.HTTPError:
            return False
    return False
