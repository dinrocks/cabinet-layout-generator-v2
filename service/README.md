# ezdxf service

Python (FastAPI + ezdxf) service that does the DXF jobs the browser can't:
**upload** (equipment DXF → measured bbox + clean SVG + retained block),
**export** (layout model + library → assembled `.dxf` with plot-ready "A3 SHEET"
+ "BOM" layout tabs, for GstarCAD), and **block** (serve a retained DXF for the
portable bundle). Stateless w.r.t. layouts; touched only on DXF up/download. When
`SUPABASE_JWT_SECRET` is set the endpoints require a valid token, and with
`REQUIRE_AUTH=1` a missing secret **fails closed** (503). See `../SKILL.md §3.3`
and `../docs/SECURITY_HARDENING.md`.

## Dev
```
cd service
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app:app --reload --port 8000
```
- `GET  /health` — liveness + ezdxf version + `{storage, auth, require_auth}` config booleans
- `POST /upload` — multipart `file=<dxf>` (≤20 MB) → `{ block_ref, width_mm, height_mm, rail_offset_mm, units, svg, confirm_message }`
- `POST /export` — JSON `{ model, library, scale, bom }` (scale 1.0=1:1, 0.01=1:100) → `.dxf` download
- `GET  /block/{id}` — a retained equipment DXF by block ref (bundle export; id regex-validated)

## Verify (the harnesses CI runs on every push)
```
.venv\Scripts\python test_build.py       # synthetic sample DXF: assembler, blocks, sheet + BOM tabs, cap-height
.venv\Scripts\python test_auth.py        # JWT verify (HS256/JWKS) + REQUIRE_AUTH fail-closed
.venv\Scripts\python test_upload_rail.py # rail datum from the DXF origin
.venv\Scripts\python test_block.py       # /block download + block-id validation (traversal blocked)
```

## Notes
- Coordinate flip (editor top-left → DXF bottom-left) lives in ONE place: `DxfAssembler._to_dxf`.
- Layers PLATE/DUCT/EQUIP/TEXT/GROUND; text style ARIAL (arial.ttf). Sheet text is CAP-height; the
  BOM table em-spec converts via `ARIAL_CAP_PER_EM`.
- Block ids are validated in `store.py` (`InvalidBlockId`) before any FS/URL use — covers every caller.
- Durable blocks: set `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (+ `SUPABASE_BUCKET`) for Storage backing;
  else local-disk cache (ephemeral on Render).
- Scale 1:100 scales geometry uniformly; dimension text must read the REAL value once dimension
  entities are emitted (single hook in `_text`).
- Pinned to Python 3.14-compatible wheels; matplotlib excluded (native SVG backend).
