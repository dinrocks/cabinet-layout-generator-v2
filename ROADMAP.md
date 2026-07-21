# Roadmap — Cabinet Layout Generator (Phase 2+)

Living backlog. Shipped work is recorded in [CHANGELOG.md](CHANGELOG.md); this file is what's
**next** and what's **deliberately deferred** so good ideas don't get lost. Every item still obeys
the one law (CLAUDE.md §0): deterministic code draws/counts, a human reviews in CAD, the AI never
invents geometry or part data.

## Done

- **Phase 1** — single-user editor (Fabric.js) + all exports (DXF via ezdxf service, SVG/PDF/PNG
  in-browser), every part a named/countable DXF block.
- **Phase 2 · Slice 1** — Supabase auth + email allowlist, cloud-saved shared projects
  (last-write-wins), local-only graceful degrade.
- **Phase 2 · Slice 2** — durable uploaded blocks in Supabase Storage, JWT-secured service
  (HS256 + asymmetric/JWKS), shared `library_items` catalog, category picker.
- **Library** — empty-start palette, categories 1–8 (incl. 6 Stopper / 7 Slim Stopper /
  8 Accessories), "Add label plate" locked pairs, custom parts.

## Done (recent)

### BOM (Bill of Materials) export — COMPLETE
Shop-drawing format matched to the engineer's real BOM: ITEM NO. (equipment tags) · DESCRIPTION ·
MANUFACTURER · MODEL · QTY. Pure tested core (`model/bom.ts`); per-part data entered at upload + editable
in the panel and the ✎ Edit-part dialog; **manual BOM-only rows** (`model.bom_extras[]`) for items not on
the plate (cabinet, name plates, lamp, fans, outlets), edited in the BOM modal; CSV download; saved with
the project.
- Shipped polish: ITEM NO. collapses consecutive tag runs to ranges ("B101–B112").
- ✅ Printable/PDF BOM — DONE (2026-07-08): multi-page drawing sheets (AMR frame + title block) from
  the BOM dialog; word-wrap, pagination with repeating header, page numbering (`model/bomsheet.ts`).

## Now / In progress

_**Feature-driven.** The hardening block is done (below) except the deferred tech-debt item.
Build what real cabinet work bumps into next; the best recent features (insert-beside, set caps,
marquee, folders, tag ranges) all came from real-use friction, not a backlog._

## Hardening block — COMPLETE except #8 (from [docs/RISK_REVIEW.md](docs/RISK_REVIEW.md), 2026-07-02)

A whole-project risk review ranked what can actually hurt us; **R1–R6 + the CI gap are all fixed**
(2026-07-02→03). Full reasoning (the *why* and the failure stories) lives in the review doc. Only
the tech-debt item (#8) remains — deliberately deferred (see the **Deferred** section below).

1. ✅ **Unsaved-changes guard** — DONE (2026-07-02): dirty tracking via save-snapshot comparison,
   "● unsaved" chip, `beforeunload` warning, confirm on New/**Open** (Open previously discarded
   silently), and a crash-safe localStorage draft with restore-on-launch. → R2
2. ✅ **Multi-user safety** — DONE (2026-07-02): "saved by <name> <when>" in the top bar + Open list;
   Save is a compare-and-set against the opened version and warns (overwrite / keep unsaved) on a
   conflict. The concurrent-clobber guard. → R3
3. ✅ **Project revisions + backup** — DONE (2026-07-03): every Save keeps a revision (last 20,
   DB-trimmed; ⟲ History in the Open dialog restores into the editor as unsaved work) + a nightly
   backup Action dumping projects/library/allowlist to the private `backups` Storage bucket
   (day-of-month rotation). Provisioning: re-run schema.sql, create the bucket, add the
   SUPABASE_SERVICE_KEY Actions secret. → R1
4. ✅ **Upload size cap** — DONE (2026-07-03): `/upload` reads in chunks and 413s past 20 MB. → R4
5. ✅ **Assembler harness in CI** — DONE (2026-07-03): `test_build.py` builds a synthetic sample DXF
   in memory (no OneDrive dep); CI runs it + test_auth + test_upload_rail on every push.
6. ✅ **Shared-part delete: cross-project warning** — DONE (2026-07-03): static warning for shared
   parts + cap-aware current-layout check (exact RPC scan a future refinement). → R5
7. ✅ **Orphaned lib-item cleanup on save** — DONE (2026-07-03): `cleanProjectLocal` drops unplaced
   label-plate/custom items (keeps uploads). → R6
8. ✅ **Docs refresh + `App.tsx` split** — DONE (2026-07-10); the hardening block is fully closed.
   - `App.tsx` 1190 → ~510 lines: views extracted to `editor/Toolbar` / `LibrarySidebar` /
     `PropertiesPanel` / `OpenDialog`, cloud handlers grouped into `store/useCloudProjects`.
     Pure refactor, browser-smoke-tested.
   - `guide.html` + README rewritten to the current tool: shared catalog + empty-start palette,
     sets with caps + insert-beside, marquee/select-row/Ctrl+A, folders + revisions + drafts,
     the BOM (CSV / PDF sheet / DXF tab), drawing sheets + title block, Thai support.

## Backlog (deferred, in rough priority order)

### 1. Audit log / activity trail — ✅ DONE (2026-07-21)
`project_events` (append-only; `project_id` → null on delete so deletes stay auditable, name
snapshotted) + RLS (members read, insert own, no update/delete). Client logs create/save/duplicate/
delete/share/unshare best-effort (actor from session); the History dialog (⟲) shows the trail as an
**Activity** section beneath the restorable saves. Needs one `schema.sql` re-run.

### 2. Security hardening (VibeSec review, 2026-07-21) — plan ready, not built
Posture is strong (8.2/10); these close the review's gaps. **Full implementation spec (exact file/
code/test/deploy) in [docs/SECURITY_HARDENING.md](docs/SECURITY_HARDENING.md); risk register in
[docs/RISK_REVIEW.md](docs/RISK_REVIEW.md) Round 3.** In order:
- **Commit 1 (M1+M2):** service fail-closed (`REQUIRE_AUTH=1`) + centralize block-id validation in
  `store.py` (close the `/export` path-traversal gap). Fully unit-testable.
- **Commit 2 (M3):** add `web/public/_headers` CSP + security headers; verify on a Cloudflare preview.
- **Commit 3 (M4, optional):** DOMPurify at the browser export entry points (belt-and-suspenders on CSP).
- **Config (§4):** Render `REQUIRE_AUTH=1`; consider lowering the Supabase JWT expiry (L1); keep
  `ALLOWED_ORIGINS` exact.

### 3. Harden + custom domain
- Settle the **final domain** before re-wiring OAuth (CLAUDE.md §6 — callbacks are per-domain).
- Point Supabase OAuth redirect + Cloudflare Pages custom domain at it; tighten the service
  `ALLOWED_ORIGINS` / CORS and re-confirm the allowlist.
- Full **end-to-end verification across two allow-listed teammates** (upload → shared library →
  cross-project reuse → secured export).

### 4. Phase 3 — share-link + bundle (from CLAUDE.md §6) — ✅ COMPLETE
- ✅ **Share link** — DONE (2026-07-10): revocable `?share=<token>` viewer (live latest save,
  view + PDF/PNG/BOM only) via a SECURITY DEFINER exact-token RPC; RLS stays closed. Toolbar
  **Share** creates/copies/revokes. Needs one `schema.sql` re-run.
- ✅ **Bundle export** — DONE (2026-07-10): toolbar **Bundle** → `<name>.bundle.zip` with the layout
  JSON envelope + every placed uploaded part's raw DXF (via the new auth-guarded `GET /block/{id}`)
  + README. Pure core `model/bundle.ts`; `test_block.py` harness in CI.

### Smaller polish / known limitations
- Uploaded-SVG overlay can sit slightly off the footprint box for some parts (canvas only;
  DXF export is exact).
- Service free-tier cold start ("waking service…"); keep-alive cron mitigates but Render still
  sleeps — a missing-block export now returns a clear 422 (re-upload hint).
