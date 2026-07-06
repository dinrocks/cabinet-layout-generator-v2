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
- Optional later polish: printable/PDF BOM.

## Now / In progress

_Next: the hardening block below (from the risk review), starting with the dirty-guard and
multi-user safety._

## Hardening block — protect the drawings (from [docs/RISK_REVIEW.md](docs/RISK_REVIEW.md), 2026-07-02)

A whole-project risk review ranked what can actually hurt us. Full reasoning (the *why* and the
failure stories) lives in the review doc; this is the build order:

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
8. **Docs refresh + `App.tsx` split** — guide/README predate categories 1–8/BOM/rail-line/toolbar;
   App.tsx (~800 lines) wants splitting into Toolbar / LibrarySidebar / PropertiesPanel / modals.

## Backlog (deferred, in rough priority order)

### 1. Audit log / activity trail
Record **who created / edited / saved** each project and when; a simple activity view.
- New `project_events` table (project_id, actor, action, at) + RLS (members read, insert own).
- Write an event on save/open; render a per-project timeline. Pairs naturally with the
  multi-user-safety and revisions work above.

### 2. Harden + custom domain
- Settle the **final domain** before re-wiring OAuth (CLAUDE.md §6 — callbacks are per-domain).
- Point Supabase OAuth redirect + Cloudflare Pages custom domain at it; tighten the service
  `ALLOWED_ORIGINS` / CORS and re-confirm the allowlist.
- Full **end-to-end verification across two allow-listed teammates** (upload → shared library →
  cross-project reuse → secured export).

### 3. Phase 3 — share-link + bundle (from CLAUDE.md §6)
- Read-only **share link** for a layout (view/print without edit).
- **Bundle export** (layout JSON + referenced equipment DXFs) so an engineer isn't trapped if a
  free tier changes — "free + portable, every layer" (CLAUDE.md §5).

### Smaller polish / known limitations
- Uploaded-SVG overlay can sit slightly off the footprint box for some parts (canvas only;
  DXF export is exact).
- Service free-tier cold start ("waking service…"); keep-alive cron mitigates but Render still
  sleeps — a missing-block export now returns a clear 422 (re-upload hint).
