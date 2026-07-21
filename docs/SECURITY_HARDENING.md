# Security hardening plan — implement from this

_Source: the VibeSec security review, 2026-07-21 (see [RISK_REVIEW.md](RISK_REVIEW.md) Round 3 for the
ranked risk register). This file is the **implementation spec** — exact file, current code, the change,
the test, and the verify/deploy steps for each item. Build it in the numbered order; each numbered
group is one coherent commit. Nothing here is implemented yet._

**Baseline is good (8.2/10).** These are hardening / defense-in-depth + two operational gaps — none are
outsider-exploitable today. Do **not** regress what already works: RLS on every table, JWT `aud`/`exp`/
alg-family checks, secrets server-only, exact-token share RPC, `/block/{id}` regex, append-only audit.

Threat model reminder (what we're protecting): a **single trusted team** behind an email allowlist, plus
**one anonymous surface** — read-only share links. "Fail closed" and "the anon path must be XSS-proof" are
the two lenses that matter most.

Definition of done for the whole plan: all three commits landed, `npm run typecheck`/lint/`vitest`
+ the service harnesses green, CSP verified on a Cloudflare **preview** deploy across every export path,
and the deploy-config steps (§4) applied on Render + Supabase.

---

## Commit 1 — Service fail-closed + block-id validation (M1 + M2)

One commit: `service/auth.py`, `service/store.py`, `service/app.py`, `service/render.yaml`,
`service/.env.example`, `service/test_auth.py`, `service/test_block.py`.

### M1 — Service auth must FAIL CLOSED when the secret is missing  ·  severity: MEDIUM (operational)

**Review / risk.** `require_user()` returns `None` (allows the request) when `SUPABASE_JWT_SECRET` is
unset. That's deliberate for local dev, but it means a **dropped env var on a Render redeploy silently
opens** `/upload`, `/export`, and `/block` to the world. `/health` reports `auth:false` but nothing
*enforces* it. This is the only spot that fails open.

**Path.** `service/auth.py` → `require_user()`:
```python
    secret = os.environ.get("SUPABASE_JWT_SECRET")
    if not secret:
        return None  # auth disabled (local dev) — open endpoint
```

**Step.** Add a `REQUIRE_AUTH` flag that makes a missing secret a hard error (503) instead of open:
```python
def _require_auth() -> bool:
    """When truthy, a missing SUPABASE_JWT_SECRET is a hard error, not an open door.
    Set REQUIRE_AUTH=1 in every deployed environment so a dropped secret fails closed."""
    return os.environ.get("REQUIRE_AUTH", "").strip().lower() in ("1", "true", "yes", "on")
```
```python
    secret = os.environ.get("SUPABASE_JWT_SECRET")
    if not secret:
        if _require_auth():
            raise HTTPException(503, "Service auth is required but SUPABASE_JWT_SECRET is not configured.")
        return None  # local dev — open endpoint
```
Also surface it on `/health` (in `service/app.py` `health()`), next to `auth`:
```python
        "auth": auth_enabled(),
        "require_auth": auth.require_auth_configured(),   # or import _require_auth via a public alias
```
Expose a public accessor rather than importing the underscore name — add to `auth.py`:
```python
def require_auth_configured() -> bool:
    return _require_auth()
```

**Test.** `service/test_auth.py` — `require_user` reads env per call, so no reload needed:
```python
import os
from fastapi import HTTPException
import auth

# REQUIRE_AUTH set + secret missing → 503 (fail closed), not None
os.environ.pop("SUPABASE_JWT_SECRET", None)
os.environ["REQUIRE_AUTH"] = "1"
try:
    auth.require_user(None)
    raise SystemExit("FAIL: expected 503 when REQUIRE_AUTH set and secret missing")
except HTTPException as e:
    assert e.status_code == 503, e.status_code
# Without REQUIRE_AUTH, still open in dev (returns None)
del os.environ["REQUIRE_AUTH"]
assert auth.require_user(None) is None
print("OK: fail-closed when REQUIRE_AUTH + no secret; open in dev")
```

**Deploy (see §4).** Add `REQUIRE_AUTH=1` to the Render service env (it already has `SUPABASE_JWT_SECRET`).

---

### M2 — Validate `block_ref` everywhere (not just on `/block/{id}`)  ·  severity: LOW–MEDIUM

**Review / risk.** `/export` passes client-controlled `block_ref` (from the `library` JSON) straight
into `store.path(block_ref)` via `dxf_build._import_block` — with **no `_BLOCK_ID` regex**, unlike the
`/block/{id}` route. That's a path-traversal / arbitrary-`.dxf`-read + Storage-URL-probe gap. Bounded
(must end in `.dxf`, must parse as DXF, authenticated member only, Python 3 rejects null bytes) → low
real payoff, but it's the exact class `/block` already guards, and it should be closed centrally.

**Path.**
- `service/store.py` → `path()`, `put()`, `exists()` (no id validation today).
- `service/dxf_build.py` → `_import_block()` line ~272: `src = ezdxf.readfile(str(store.path(block_ref)))`.
- `service/app.py` → `/export` only catches `BlockNotFoundError` (→422) and generic `Exception` (→500).

**Step — validate in `store.py` so ALL callers are covered by construction:**
```python
import re
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")

class InvalidBlockId(ValueError):
    """A block id that isn't a store-generated slug — rejected before any FS/URL use."""

def _valid(block_id: str) -> str:
    if not isinstance(block_id, str) or not _ID_RE.match(block_id):
        raise InvalidBlockId(f"invalid block id: {block_id!r}")
    return block_id
```
- `put()`: `block_id = _valid(suggested_id) if suggested_id else uuid.uuid4().hex`
- `path()`: first line `_valid(block_id)`
- `exists()`: first line `_valid(block_id)`

**Step — map it to a 400 in `/export`** (add BEFORE the generic `except Exception`):
```python
    except store.InvalidBlockId as exc:
        raise HTTPException(400, f"Invalid block reference in the layout ({exc}).") from exc
```
The `/block/{id}` route already 400s via its own regex — leave it (clean message); it's now backed by
`store._valid` too. Optionally simplify it to catch `store.InvalidBlockId`, but keeping both is fine.

**Test.** `service/test_block.py`:
```python
import pytest, store, dxf_build
# store-level: traversal / bad ids are rejected before any FS/URL use
for bad in ("../etc/passwd", "a/b", "x".ljust(81, "x"), "has space", ""):
    with pytest.raises(store.InvalidBlockId):
        store.path(bad)
with pytest.raises(store.InvalidBlockId):
    store.put(b"x", suggested_id="../evil")
# export-level: a malicious block_ref in the library aborts the assemble (not a 500)
model = {"project": {"name": "x"}, "plate": {"width_mm": 100, "height_mm": 100, "origin": "top_left"},
         "ducts": [], "groups": [], "labels": [],
         "elements": [{"id": "e", "lib_key": "evil", "tag": "", "x_mm": 0, "y_mm": 0, "rot_deg": 0,
                       "gap_before_mm": 0.1, "clearance_to_duct_mm": 3, "group_id": None, "locked": False}]}
library = {"evil": {"source": "dxf", "name": "evil", "width_mm": 10, "height_mm": 10, "block_ref": "../../secret"}}
with pytest.raises(store.InvalidBlockId):
    dxf_build.assemble(model, library, 1.0)
print("OK: block-id validation blocks traversal in store + export")
```
(`test_block.py` isn't pytest-run today — it's a script. Either keep it a script with `try/except` asserts
matching its style, or add these as plain asserts. Match the existing file's style.)

---

## Commit 2 — Content-Security-Policy + security headers (M3)

One commit: `web/public/_headers` (new) + a note in `docs/PHASE2_SETUP.md`. **This is the primary,
proper fix for the residual XSS risk on the anonymous share surface** — a CSP blocks script execution even
if the SVG sanitizer (Commit 3 / existing regex) ever misses a vector.

**Review / risk.** The SPA ships **no CSP / X-Frame-Options / HSTS** (only `_redirects` for routing). The
share viewer renders drawings for anonymous visitors; its PDF/BOM-PDF download parses the shared layout via
`holder.innerHTML = svg` (`web/src/export/inBrowser.ts` `svgIntoPdf`, line ~97) — so any XSS vector that
slips the sanitizer would run in a recipient's browser. CSP is the real backstop.

**Path.** New file `web/public/_headers` (Vite copies `public/` → `dist/`; Cloudflare Pages applies it).

**Step.** Create `web/public/_headers` with the exact deployed hostnames (from
[REFERENCE.md §3](REFERENCE.md): Supabase `kfxhtqeooxvmikcgmfkc.supabase.co`, Render
`cabinet-ezdxf-kndf.onrender.com` — **update if hosts change**):
```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://kfxhtqeooxvmikcgmfkc.supabase.co https://cabinet-ezdxf-kndf.onrender.com; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
```

**Why each directive (do not tighten blindly — these are load-bearing):**
- `script-src 'self'` — Vite emits external hashed modules; **no** `unsafe-inline`/`unsafe-eval`. If a
  library provably needs eval, verify first (see matrix) and add `unsafe-eval` **only** if a real break.
- `style-src 'self' 'unsafe-inline'` — **required**: React inline `style=` props + inline `style` on the
  sheet/part SVGs. Can't drop `unsafe-inline` without refactoring all inline styles.
- `img-src 'self' data: blob:` — the share viewer's `<img src="data:image/svg+xml,…">` and the PNG export
  (`loadSvgImage` → `Blob` URL).
- `font-src 'self' data:` — bundled Sarabun (emitted as an asset) + any data-URI font.
- `connect-src` — Supabase REST/Auth/**JWKS** host + the Render service (`exportDxf`/`uploadDxf`/`ping`/
  `fetchBlock`). **Must** list the real hosts.
- `worker-src 'self' blob:` — jsPDF/svg2pdf may spin a worker from a blob; include defensively, verify.
- `frame-ancestors 'none'` + `X-Frame-Options: DENY` — clickjacking.
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` — standard lockdown.
- **Not** blocked: GitHub/Google OAuth — those are **top-level navigations** (Supabase redirects the whole
  page; `detectSessionInUrl` handles the callback in-page), not `connect-src`/`frame` — CSP doesn't touch
  them. Confirm sign-in still works anyway (matrix).

**Verify — MANDATORY, and CSP only applies on Cloudflare (not `vite dev`/`preview`).** Push the branch,
let Cloudflare Pages build the **preview deployment**, open it, and run this matrix with DevTools console
open (watch for `Refused to … Content Security Policy`):

- [ ] App loads, no CSP violations in console
- [ ] PDF export (layout) · [ ] PNG export · [ ] SVG export · [ ] BOM PDF
- [ ] DXF export (service `connect-src`) · [ ] Upload a DXF (service `connect-src`)
- [ ] Sign in with GitHub **and** Google (OAuth navigation + callback)
- [ ] Save / Open / History / Share-link create (Supabase `connect-src`)
- [ ] Open a share link in a private window (img data-URI renders)
- [ ] From the share viewer: PDF **and** BOM-PDF download (innerHTML path)

For any break, loosen only the **specific** directive it names, and add a one-line comment in `_headers`
saying why. Merge to `main` only after the matrix passes on the preview.

---

## Commit 3 — Parser-grade SVG sanitizer (M4) · OPTIONAL, defer unless wanted

**Do this only if you want belt-and-suspenders beyond the CSP (Commit 2).** With CSP in place, the residual
XSS risk is already mitigated; M4 is extra depth, and it adds a dependency + a DOM caveat.

**Review / risk.** `embedSvg`'s `sanitized()` is **regex-based** (strips `<script>`, `on*=`,
`javascript:`, `<foreignObject>`). Regex SVG sanitization is inherently fragile; it's tested against the
known vectors but a novel one could slip. On the anon share-viewer PDF path it's load-bearing (see M3).

**Path & caveat.** `web/src/render/embedSvg.ts` `buildPartDef` is a **pure** function that also runs in
Node (vitest, no DOM). **Do not** put DOMPurify there. Instead sanitize at the **browser-only** entry
points that feed `innerHTML`/`Image`.

**Step.**
1. `npm i dompurify` (+ `@types/dompurify`).
2. New `web/src/render/sanitizeSvg.ts`:
   ```ts
   import DOMPurify from "dompurify";
   /** Parser-grade SVG sanitize — browser only (needs a DOM). No-op fallback in Node. */
   export function sanitizeSvgMarkup(svg: string): string {
     if (typeof window === "undefined" || !DOMPurify.isSupported) return svg; // regex baseline already applied upstream
     return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["use"] });
   }
   ```
3. Wrap the composed SVG in the two entry points that parse it:
   - `web/src/export/inBrowser.ts` `svgIntoPdf`: `holder.innerHTML = sanitizeSvgMarkup(svg)`.
   - `web/src/export/inBrowser.ts` `loadSvgImage`: sanitize before the Blob (defensive).
   - The share viewer already renders via `<img>` (safe); its downloads go through the above.
4. Keep the regex `sanitized()` in `embedSvg` as the portable baseline (do **not** remove it).

**Test.** `web/src/render/sanitizeSvg.test.ts` (vitest jsdom env) — a `<script>`/`onload` svg comes back
clean; a normal part svg keeps its `<path>/<circle>/<use>`.

**Priority.** LOW. Recommend deferring until after M1–M3 unless a pentest asks for it.

---

## §4 — Deploy / config steps (no code) — do alongside the commits

- [ ] **Render → cabinet-ezdxf → Environment:** add `REQUIRE_AUTH=1` (M1). Confirm `SUPABASE_JWT_SECRET`,
      `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ALLOWED_ORIGINS` are still set. After deploy, hit
      `/health` → expect `{"auth": true, "require_auth": true}`. Add `REQUIRE_AUTH` to `render.yaml`
      `envVars` (`sync:false`) and `.env.example` with a comment, in Commit 1.
- [ ] **Confirm `ALLOWED_ORIGINS`** is the exact frontend origin (`https://…pages.dev` or the custom
      domain) — not `*`. (CORS isn't a CSRF vector here — the API is Bearer-header, not cookie — but keep
      it tight.)
- [ ] **Supabase → Auth → Sessions:** consider lowering the **JWT expiry** from 3600s to ~900s (L1a) to
      shrink the de-provisioned-member service-access window. Config-only, zero code.
- [ ] **After Commit 2 merges**, re-run the CSP matrix on the production URL once (sanity).

---

## §5 — Accepted, no action (documented so they're conscious decisions)

- **L1 (de-provisioned member keeps *service* access until token `exp`).** `auth.py` authorizes on a
  valid Supabase token (`sub`+sig+`aud`+`exp`), not live membership; RLS already cuts *data* access
  immediately, but `/export`/`/block` accept any unexpired token (~≤1 h). Mitigation = §4 JWT-expiry
  lowering. A code fix (per-request `profiles` membership check via the service key, cached) is possible
  but adds latency/coupling — only if strict revocation becomes a requirement.
- **L2 (Supabase JWT in `localStorage`, the SDK default).** Amplifies any XSS into token theft; mitigated
  by CSP (M3). Switching Supabase to cookie storage is a large change and not warranted for this model.
- **Shared-tenancy (any member may read/edit/delete any project).** Intended single-team workspace, not
  horizontal-access. Deletes are owner/admin; library edits admin-only; audit log records who did what.
  Recorded in [SECURITY.md](../SECURITY.md).

---

## §6 — Suggested order & sequencing

1. **Commit 1 (M1+M2)** — highest value, self-contained, fully unit-testable. Ship first.
2. **§4 Render env** (`REQUIRE_AUTH=1`) right after Commit 1 deploys — otherwise M1 changes nothing in prod.
3. **Commit 2 (M3 CSP)** — verify on a Cloudflare preview before merging (can't unit-test).
4. **§4 Supabase JWT expiry** (L1a) — anytime.
5. **Commit 3 (M4)** — optional; only if you want parser-grade depth beyond CSP.

Each commit follows the house loop (WORKFLOW.md): build → verify all checks + harnesses → one coherent
commit (what+why) → push → watch CI green → update CHANGELOG + mark the item ✅ in RISK_REVIEW Round 3.
