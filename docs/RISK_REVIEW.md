# Risk review — Cabinet Layout Generator (Phase 2)

_Review date: 2026-07-02 · reviewed against `main` @ `f4ac768`._

A whole-project health check: what's solid, what can hurt us (ranked by expected real-world
damage), and how to fix each item. The **actionable priority list lives in
[ROADMAP.md](../ROADMAP.md)**; this file holds the full reasoning so future contributors know
*why* each item exists. When an item ships, mark it ✅ here and remove it from the roadmap.

---

## 1. What's genuinely solid (don't break these)

- **One JSON model as the single source of truth.** Everything — editor canvas, SVG/PDF/PNG,
  DXF, BOM — derives from the model. Exports never read the canvas. This is why the tool stays
  correct as it grows; keep it that way (CLAUDE.md §5).
- **Three renderers that must agree** (`web/src/render/toSvg.ts`, `web/src/editor/FabricStage.tsx`,
  `service/dxf_build.py`). Every rendering bug so far (giant rotated tags, label overflow, hidden
  set numbers, stopper masking) was one renderer drifting from the others. Any drawing change
  must land in **all three**, and the constants (tag fonts, gaps) are shared/mirrored on purpose.
- **Pure, tested core.** ~80 web unit tests over re-flow, rows, packing, geometry, BOM, validation;
  service harnesses (`test_build.py`, `test_auth.py`, `test_upload_rail.py`) for the assembler,
  JWT auth, and rail-datum capture.
- **The §0 law is enforced in practice.** Unknown BOM fields render "-", never guessed; the
  rail line from the DXF origin is *shown for confirmation*; estimated sizes carry `confirm:true`
  flags all the way into the BOM (`*`).
- **Free-tier degradation paths all exist.** No Supabase env → local-only mode + JSON
  download/upload; ezdxf asleep → everything except DXF still works; Storage-backed blocks
  survive Render restarts; a missing block is a clear 422, not an opaque 500.

---

## 2. Top risks, ranked by expected damage

### R1 — A whole drawing can be lost in one save (no history, no backup)  ✅ FIXED

**Why it's the #1 risk.** Each project is **one jsonb row, overwritten in place** on every Save
(`public.projects.layout`). Supabase's free tier has **no point-in-time recovery**, and RLS lets
**any member update any project** (`schema.sql` — "members update projects", by design:
team-shared, last-write-wins). So the mundane failure story is: a teammate opens the wrong
project — or an empty/broken local state — and hits **Save**. The previous drawing is gone,
permanently, with no way back. The drawings are now the most valuable data in the system;
everything else (parts, service, hosting) is recoverable by re-uploading or redeploying.

**How it was fixed (two complementary layers, shipped 2026-07-03):**
1. **Project revisions** — `project_revisions` (layout+library snapshot, saved_by/at), written on
   every save, trimmed to the last 20 per project by a SECURITY DEFINER trigger (append-only RLS:
   members read/insert, no update/delete). The Open dialog's **⟲ History** restores any revision
   *into the editor as unsaved work* — the live row is untouched until a normal (guarded) Save.
   Deleting a project cascades its history away — deletion is covered by layer 2.
2. **Nightly backup** — `.github/workflows/backup.yml` (cron 19:23 UTC ≈ 02:23 Bangkok) dumps
   projects + library_items + allowed_emails via PostgREST (service key from an Actions secret)
   into the **private Storage bucket `backups`**, one file per day-of-month (~30 rolling restore
   points, zero cleanup). Deliberately NOT a GitHub artifact — the repo is public.

### R2 — Silent work loss in the browser (no unsaved-changes guard)  ✅ FIXED

**Why.** There was **no `beforeunload` handler** — only the "New" button asked for confirmation,
and **Open discarded unsaved edits with no warning at all**. Close the tab, hit Back, or a
Windows-update reboot with unsaved edits → everything since the last Save vanished silently.
Undo history is in-memory only.

**How it was fixed.** Dirty = snapshot comparison: what a save persists (model + project-local
lib via `projectLocal()`) is serialized (`snapshot` memo in `App.tsx`) and compared against the
baseline taken at the last save/open/new — so undoing back to the saved state reads clean again.
While dirty: an "● unsaved" toolbar chip, a `beforeunload` leave-warning, confirm dialogs on
New/Open, and a **debounced localStorage draft** (`web/src/store/draft.ts`) that survives a crash;
next launch offers a restore (deferred until the shared catalog loads so validation can resolve
shared parts), and a restored draft **stays dirty** until actually saved. The JSON ⬇ download
also marks clean (it *is* the local-mode save). Draft is best-effort (quota errors swallowed).

### R3 — Concurrent edits silently clobber (last-write-wins)  ✅ FIXED

**Why.** Two people can open the same project; whoever saves last wins, silently. Distinct from
R1 (bad single save) — this is the *concurrent* case, and it grows with the team.

**How it was fixed.** `loadProject` returns the row's `updated_at` as a base; `saveProject` does a
**compare-and-set** (`update(...).eq("id", id).eq("updated_at", base)`) — atomic, no TOCTOU race.
If 0 rows match and the row still exists, it's a conflict: the store returns
`{ conflict: { updatedAt, updatedByName } }` and the UI warns "⚠ <name> saved this at <time>, after
you opened it" with **overwrite** (re-save using the server's version as the new base) or **abort**
(keep editing, nothing saved/lost). **"saved by <name> <when>"** shows in the top bar and every Open
row (embeds `profiles!projects_updated_by_fkey`). Restored drafts save unconditionally (base is null)
— an accepted edge case. Not yet done (optional): realtime presence ("<name> has this open now").

### R4 — The DXF service accepts unbounded uploads  ✅ FIXED

**Why.** `/upload` does `await file.read()` with **no size cap** (`service/app.py`). A huge or
accidental wrong file gets read fully into memory on a **512 MB free Render instance** — one
request can OOM-kill the service for everyone (real equipment DXFs are < 1 MB).

**How it was fixed.** `/upload` now reads the body in 256 KB chunks and 413s once it passes a
20 MB cap (`MAX_UPLOAD_BYTES` in `service/app.py`) — memory stays bounded, one bad file can't OOM
the instance.

### R5 — Deleting a shared part quietly breaks other projects  ✅ FIXED (mitigated)

**Why.** The library ✕ delete warns only if the part is placed **in the currently open layout**
(`App.tsx` — `deleteLibraryPart`). A shared part used by five *saved* projects can be deleted with
no hint; those projects then open with unresolved red placeholders and **can't DXF-export** the
missing block. (Storage objects are never garbage-collected, so the block bytes still exist —
but nothing references them.)

**How it was fixed (mitigated).** The delete confirm now warns for **shared** parts that they may
be used by other saved projects (and that placements would break) — plus the current-layout check
now includes set caps. Still a **static** warning, not an exact cross-project scan; an accurate
count would need a Postgres RPC over the `layout` jsonb (future refinement). The Storage block is
never deleted with the `library_items` row — old exports/projects can still reference it.

### R6 — Slow leak: orphaned per-instance library items  ✅ FIXED

**Why.** "Add label plate" and custom parts **mint a per-instance lib item** (`lbl_*`, custom
keys) stored in the project's local library. Deleting the placed element (`deleteSelected` →
`deleteEntity`) removes the *elements* but never the lib item — so dead entries accumulate in the
project jsonb forever. Harmless short-term; bloat and confusion long-term.

**How it was fixed.** `cleanProjectLocal(model, library, sharedKeys)` (used by `saveProject`) drops
project-local **label_plate/custom** items no element/group/cap references — self-healing on the
next save. Uploaded DXF parts are always kept (even unplaced), so an upload-then-save-before-place
never loses a part. Tested in `persist.test.ts`.

---

## 3. Warning spots (watch; low effort, not urgent)

- ✅ **CI now runs the assembler harness** (2026-07-03). `service/test_build.py` was rewritten to
  build a **synthetic sample DXF in memory** (no OneDrive dependency, no proprietary file committed),
  so it — plus `test_auth.py` and `test_upload_rail.py` — run in CI on every push. WIPEOUT / rotation /
  set-cap / tag / block-count regressions now fail CI, not just my local run.
- **Render free-tier monthly hours.** Keep-alive (`keepalive.yml`) correctly targets **Supabase**
  (free projects pause after ~7 idle days). Render cold-start is tolerated by design ("waking
  service…") — but Render free also has **monthly instance-hour limits**. If DXF export starts
  failing near month-end, check the Render dashboard quota before debugging code.
- **Docs drift.** `guide.html` and README screenshots predate: categories 1–8, the BOM, rail-line
  capture, label plates, the regrouped toolbar. Refresh once features settle.
- **`App.tsx` is ~800 lines** and absorbs every feature (toolbar, modals, sidebar, panels).
  The model/core stays clean; the shell is accreting. Split into components (Toolbar, LibrarySidebar,
  PropertiesPanel, modals) before it gets genuinely painful.
- **GitHub rename residue.** The account renamed `Taamrock04` → `Taam4142`; local git remotes are
  updated, but Cloudflare Pages / Render deploy via the old-name **redirect**. Works today —
  reconnect the integrations to the new name at an idle moment so a future redirect change doesn't
  silently stop deploys.
- **Admin ops are SQL-only.** Adding a teammate means inserting into `allowed_emails` in the SQL
  editor. Fine at this team size; an admin page is a Phase-3-ish nicety.
- **Supabase key rotation.** The service verifies both HS256 (legacy shared secret) and asymmetric
  JWKS tokens. If Supabase rotates keys or the project migrates signing schemes, update
  `SUPABASE_JWT_SECRET` on Render; `/health` (`{storage, auth}`) plus the specific 401 reasons
  ("signature mismatch…") are the diagnosis tools.

---

## 4. Priority order (mirrors ROADMAP.md)

| # | Item | Fixes | Effort |
|---|------|-------|--------|
| 1 | ✅ `beforeunload` dirty-guard (+ localStorage draft) — shipped 2026-07-02 | R2 | done |
| 2 | ✅ Multi-user safety: last-saved-by + stale-save warning — shipped 2026-07-02 | R3 | done |
| 3 | ✅ Project revisions (last 20 saves) + nightly backup Action — shipped 2026-07-03 | R1 | done |
| 4 | ✅ Upload size cap on the service — shipped 2026-07-03 | R4 | done |
| 5 | ✅ Assembler harness in CI (synthetic sample) — shipped 2026-07-03 | CI gap | done |
| 6 | ✅ Shared-part delete: cross-project warning (static) — shipped 2026-07-03 | R5 | done |
| 7 | ✅ Orphaned lib-item cleanup on save — shipped 2026-07-03 | R6 | done |
| 8 | Guide/README refresh · `App.tsx` split | drift | when convenient |

Items 1–3 share one theme: **protect the drawings** — now the most valuable thing in the system.

---

# Round 2 — review date 2026-07-16 · reviewed against `main` @ `7236c2c`

Everything planned has now shipped (Phases 1–3 + the drawing-output pipeline). This round
audits the surface added since 2026-07-02: **anonymous share links**, the **public-ish
`GET /block/{id}`** endpoint, the bundle export, the SVG linework embedding, the sheet/BOM
renderers and the App split.

## R2-1. Shared SVG could execute script in a viewer's browser — ✅ FIXED (2026-07-16)
The highest-severity finding. `svg_ref` (a part's uploaded drawing) is embedded verbatim into
export SVGs — and share links render layouts in **anonymous visitors'** browsers. A layout JSON
can be hand-edited and ⬆-imported, so a malicious/compromised member could plant
`<image onload="…">` in a part and share the link: stored XSS on anyone who opens it.
**Fix shipped:** (1) `render/embedSvg.ts` sanitizes every embed — strips `<script>`,
`<foreignObject>`, all `on*=` handler attributes and `javascript:` hrefs (tested);
(2) the share viewer now renders the drawing through an `<img>` data URI, an execution-free
context by construction (defence in depth). Model *text* (tags/labels/titles) was already
escaped everywhere (`esc()` in toSvg/page).

## R2-2. Share-token design — reviewed, sound (accepted)
- Token = 32 crypto-random bytes (base64url, 2^256) — unguessable, never listable; the RPC
  answers only an exact match, `SECURITY DEFINER` + pinned `search_path`, `revoke … from public`,
  and returns only that layout + the catalog items it references.
- Anyone with the link can view until revoked (Google-Docs model — chosen deliberately);
  revoke = clear the token, instant.
- Any allow-listed member can share/revoke any project (matches the existing "any member can
  edit any project" team-trust model).
- **Residual (recorded):** a shared link can be re-fetched by bots (egress on the free tier —
  layouts with many project-local uploads carry their `svg_ref` strings). Trigger to act:
  Supabase egress alerts → add a tiny edge cache or move share reads behind Cloudflare caching.

## R2-3. `GET /block/{id}` — reviewed, sound (accepted)
JWT-guarded like `/export`; block ids are regex-validated (path-traversal tested in
`test_block.py`); ids are uuid4-unguessable. Any member can fetch any block — same trust model
as the shared catalog itself. Residual DoS/egress risk is the same class as `/upload` (already
size-capped) — free-tier alarms are the trigger.

## R2-4. Linework embedding: size/perf on big sets — ✅ FIXED (2026-07-16)
Each set member duplicated the part's SVG string; the trigger fired on the FIRST real project
(750×1060, ~300 placements): the PDF export froze the engineer's browser. **Fix shipped:** the
embed is now define-once/use-many — each distinct part becomes one `<defs>` entry
(`buildPartDef`), every placement a one-line `<use>` (`placePartUse`), and the sanitizer/
recolour regexes run once per part instead of once per placement. Measured on a 299-placement
stress model with 160-path parts: export SVG 197 KB vs ~5.5 MB before (28×), compose 10 ms,
svg2pdf 0.95 s, PDF 305 KB with the linework verified rendering in all three consumers
(svg2pdf, the `<img>`/PNG path, the share viewer).

## R2-5. Monochrome mapping edge (recorded)
`embedSvg` recolours hex colours (attr + CSS forms). ezdxf emits hex today; if a future ezdxf
emits `rgb()`/named colours they'd pass through coloured (cosmetic only). One regex each if it
ever shows up.

## R2-6. What was checked and found already safe
- Crash-draft localStorage writes are fully try/catch-guarded (quota overflow can't loop-crash).
- Bundle export fails loudly on a missing block; never ships an incomplete ZIP.
- The App split was pure movement (browser-smoke-tested), and the hook captures fresh state per
  render exactly as the inline code did.
- Sheet/BOM/cap-height renderers are pure + tested; the em↔cap conversion is asserted in CI.
- `jszip` (MIT, ubiquitous) is the only new runtime dependency; pinned via package-lock.

---

# Round 3 — VibeSec security review · 2026-07-21 · reviewed against `main` @ `d94bed6`

A focused security audit (access control, XSS, SSRF/path, auth/JWT, upload, secrets, CSRF, headers)
after the anonymous share surface + block endpoint shipped. **Overall posture: strong (8.2/10)** —
RLS on every table, JWT `aud`/`exp`/alg-family checks (no `alg:none`, no RS/HS confusion), secrets
server-only, exact-token share RPC, `/block/{id}` regex, size-capped parse-validated upload, no raw
SQL, no cookie-CSRF surface. Findings below are hardening / two operational gaps — none outsider-
exploitable today. **The actionable HOW (exact file/code/test/deploy) lives in
[SECURITY_HARDENING.md](SECURITY_HARDENING.md); this is the ranked register.**

- **M1 — service fails OPEN if `SUPABASE_JWT_SECRET` unset** (MEDIUM) — ✅ FIXED (2026-07-21): `REQUIRE_AUTH=1`
  flag → 503 when the secret is missing; `/health` reports it; set in `render.yaml`. Set on Render.
- **M2 — `/export` doesn't validate `block_ref`** (LOW–MED) — ✅ FIXED (2026-07-21): validation centralized in
  `store.py` (`InvalidBlockId`); every path/put/exists checks; `/export` maps it to 400. Harness-tested.
- **M3 — no CSP / security headers** on the SPA (MEDIUM, defense-in-depth). The proper backstop for the
  anonymous share viewer. Fix: `web/public/_headers` CSP, verified on a Cloudflare preview. → Commit 2.
- **M4 — SVG sanitizer is regex-based and load-bearing** on the anon share-viewer PDF path (LOW–MED).
  Fix (OPTIONAL, after CSP): DOMPurify at the browser-only entry points; keep the regex baseline. → Commit 3.
- **L1 — de-provisioned member keeps *service* access until token `exp`** (LOW). Mitigate by lowering the
  Supabase JWT expiry (config). Accepted otherwise.
- **L2 — Supabase JWT in `localStorage`** (LOW, SDK default). Mitigated by CSP (M3). Accepted.
- **Shared-tenancy** (any member reads/edits/deletes any project) — by design, not a vuln. Recorded in
  SECURITY.md.
