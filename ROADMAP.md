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

## Now / In progress

### BOM (Bill of Materials) export
**Device rows — DONE** (shop-drawing format, matched to the engineer's real BOM):
ITEM NO. (equipment tags) · DESCRIPTION · MANUFACTURER · MODEL · QTY. Pure tested core
(`model/bom.ts`), per-part data entered at upload + editable in the panel, CSV download.

**Next (this feature's remaining piece): manual BOM-only rows.** The real sheet also lists items
that aren't placed on the back-plate — the **cabinet** (e.g. "RTU CABINET STEEL SHEET W800×H2000×D500"),
**name plates**, **lamp/fluorescent**, **fans**, **outlets**. Add a project-level editable list of
BOM-only line items (ITEM NO. / description / manufacturer / model / qty) that merge into the BOM and
CSV. Generalises the existing `BOM_ONLY_ACCESSORIES` idea.
- Likely a `project.bom_extras[]` on the model + a small editor in the BOM modal.
- Optional polish: collapse long set tag lists to a range ("B101–B112"); printable/PDF BOM.

## Backlog (deferred, in rough priority order)

### 1. Multi-user safety (presence + overwrite guard)
The tool is shared with **last-write-wins**, so two people editing the same project can silently
clobber each other.
- Show **"last saved by <name> at <time>"** on open and an **"opened by"** presence hint.
- On Save, if the project's `updated_at` changed since load, **warn before overwriting**
  (offer reload/merge/force). Cheap version: compare timestamps; richer: a `projects` realtime
  presence channel.

### 2. Audit log / activity trail
Record **who created / edited / saved** each project and when; a simple activity view.
- New `project_events` table (project_id, actor, action, at) + RLS (members read, insert own).
- Write an event on save/open; render a per-project timeline. Pairs naturally with #1.

### 3. Harden + custom domain
- Settle the **final domain** before re-wiring OAuth (CLAUDE.md §6 — callbacks are per-domain).
- Point Supabase OAuth redirect + Cloudflare Pages custom domain at it; tighten the service
  `ALLOWED_ORIGINS` / CORS and re-confirm the allowlist.
- Full **end-to-end verification across two allow-listed teammates** (upload → shared library →
  cross-project reuse → secured export).

### 4. Phase 3 — share-link + bundle (from CLAUDE.md §6)
- Read-only **share link** for a layout (view/print without edit).
- **Bundle export** (layout JSON + referenced equipment DXFs) so an engineer isn't trapped if a
  free tier changes — "free + portable, every layer" (CLAUDE.md §5).

### Smaller polish / known limitations
- Uploaded-SVG overlay can sit slightly off the footprint box for some parts (canvas only;
  DXF export is exact).
- Service free-tier cold start ("waking service…"); keep-alive cron mitigates but Render still
  sleeps — a missing-block export now returns a clear 422 (re-upload hint).
