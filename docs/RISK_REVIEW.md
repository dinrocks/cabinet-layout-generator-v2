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

### R4 — The DXF service accepts unbounded uploads

**Why.** `/upload` does `await file.read()` with **no size cap** (`service/app.py`). A huge or
accidental wrong file gets read fully into memory on a **512 MB free Render instance** — one
request can OOM-kill the service for everyone (real equipment DXFs are < 1 MB).

**How.** Reject early: check `Content-Length` and/or read up to a cap (~20 MB) and 413 past it.
A few lines; do it next time the service is touched.

### R5 — Deleting a shared part quietly breaks other projects

**Why.** The library ✕ delete warns only if the part is placed **in the currently open layout**
(`App.tsx` — `deleteLibraryPart`). A shared part used by five *saved* projects can be deleted with
no hint; those projects then open with unresolved red placeholders and **can't DXF-export** the
missing block. (Storage objects are never garbage-collected, so the block bytes still exist —
but nothing references them.)

**How.** Before deleting a shared part, query saved projects for usage (`layout` jsonb contains
the `lib_key`) and name the affected projects in the confirm dialog. Minimum viable: a static
warning "may be used by other saved projects — their placements will break". Related invariant:
**deleting a `library_items` row must not delete the Storage block** (old exports/projects may
still reference it) — cheap storage is the right trade.

### R6 — Slow leak: orphaned per-instance library items

**Why.** "Add label plate" and custom parts **mint a per-instance lib item** (`lbl_*`, custom
keys) stored in the project's local library. Deleting the placed element (`deleteSelected` →
`deleteEntity`) removes the *elements* but never the lib item — so dead entries accumulate in the
project jsonb forever. Harmless short-term; bloat and confusion long-term.

**How.** On save (in `projectLocal()`), drop project-local lib items that no element/group
references — self-healing for existing projects. Alternatively clean up in `deleteEntity` itself.

---

## 3. Warning spots (watch; low effort, not urgent)

- **CI doesn't test the assembler.** The service CI job is an *import smoke* only (`ci.yml`).
  The real harness `service/test_build.py` can't run in CI because it hardcodes the FC6A sample
  path on the engineer's OneDrive. **Fix:** commit a small real DXF into the repo (e.g.
  `service/testdata/`) and make the harness path-relative — then WIPEOUT/rotation/tag/BOM-block
  regressions are caught on every push.
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
| 4 | Upload size cap on the service | R4 | minutes |
| 5 | Sample DXF in repo → full assembler harness in CI | CI gap | ~1 h |
| 6 | Shared-part delete: cross-project usage warning | R5 | small |
| 7 | Orphaned lib-item cleanup on save | R6 | small |
| 8 | Guide/README refresh · `App.tsx` split | drift | when convenient |

Items 1–3 share one theme: **protect the drawings** — now the most valuable thing in the system.
