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

### BOM (Bill of Materials) export  ← current focus
Generate an orderable parts list from a layout — the deterministic payoff of the named-block +
category work.
- **Count** every placed element and set-member by `lib_key`; a set of N counts as N.
- **Group by category** (BANDS). Stopper / Slim-Stopper categories are the BOM "type" tag
  ("tag now, total later"); a locked stopper+label pair tallies as **1 stopper + 1 label**
  (distinct `lib_key`s, already distinct blocks).
- Include `confirm:true` flag (unconfirmed estimate) per row so the reviewer sees what's not
  datasheet-verified.
- **Pure, testable core** (`model/bom.ts`) → aggregation function with unit tests, no UI/Fabric
  dependency (CLAUDE.md §5). UI panel + **CSV download** on top; printable table later.
- Optionally fold in `BOM_ONLY_ACCESSORIES` (zero-geometry items that must appear in a BOM).

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
