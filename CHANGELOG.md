# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Phase 2 (multi-user)

_This is the Phase-2 continuation repo (duplicated with full history from cabinet-layout-generator)._

### Added (Slice 1 — auth + cloud-saved projects)
- **Supabase auth** with an **email allowlist** (RLS-enforced): sign in with GitHub/Google; only
  allow-listed emails get access; first login sets a display name.
- **Cloud-saved projects** — New / Save / Open / list the team's layouts (shared, last-write-wins); each
  layout (and its non-seed library items) stored as JSON. See `supabase/schema.sql`.
- **Local-only graceful degrade** — with no Supabase env the editor runs exactly like Phase 1, plus
  **⬇ / ⬆ JSON** local save/open as a fallback.
- Keep-alive cron, a provisioning guide (`docs/PHASE2_SETUP.md`), and persistence round-trip tests.

### Added (Slice 2 — durable + shared equipment library, secured service)
- **Durable uploaded parts** — the ezdxf service stores blocks in **Supabase Storage** (with a local
  cache), so a part survives a Render restart/redeploy. `store.py` keeps its tiny `put`/`path` interface.
- **Shared equipment library** — on upload, a checkbox offers **"Add to the shared library"**: shared
  parts live in a `library_items` catalog (add-by-anyone, delete admin-only) usable in every project by
  everyone; unticked uploads stay project-local. The catalog loads on sign-in.
- **Secured service** — `/upload` and `/export` validate the Supabase JWT when `SUPABASE_JWT_SECRET` is
  set (open in local dev). The frontend sends the bearer token.

_Next slices: audit log + "opened by" presence; finish the Cloudflare move._

## [0.2.0] — 2026-06-06

Phase-1 enhancements: terminal accessories, a generic placeholder part, and a block-based DXF export.

### Added
- **Stopper** and **Stopper with Label** terminal parts (Band 4). The label is a same-footprint marker
  plate with centered vertical text (blank until tagged). The two are placed as a **locked pair** —
  they **move (drag + arrow-nudge, with live follow), rotate, and delete together** — while staying
  distinct objects so a BOM / CAD count tallies 1 stopper + 1 label.
- **Custom part** — a user-defined placeholder device for parts without a CAD file. A plain rectangle
  you **size and name per-instance** (Part No / Width / Height in the panel); the model/part number is
  drawn **centered inside, auto-fit so it never overflows**, with the tag shown above.

### Changed
- **DXF export now places every part as a named block** (`EQ_<lib_key>`), not just uploaded-DXF parts.
  Elements and set members alike are countable in CAD's *Count Block*; rect/symbol parts were previously
  plain rectangles. Label plates and custom parts also emit their centered marker / part-number text.

### Fixed
- Marker plates (the stopper label) are excluded from overlap detection, so their intentional
  coincidence with the stopper no longer raises a false "overlap" warning.

## [0.1.0] — 2026-06-05 — Phase 1

First complete single-user release: a manual-first cabinet back-plate editor that exports a real DXF
plus PDF/PNG/SVG, all rendered from one JSON model.

### Added
- **Editor** — drag/drop parts from a seeded library; move/rotate; resize equipment only by typed mm;
  multi-select (Shift-click), arrow-key nudge, undo/redo; zoom/pan.
- **Wire ducts** — side + row ducts; drag-snap exactly onto any of the 4 plate borders and onto
  perpendicular duct edges; row ducts auto-span between the side ducts on creation, with a one-click
  **Fit width** to re-span.
- **Rows** — auto-detected between ducts, each height dimensioned in the right margin and editable by
  clicking its dimension; **Pack** a row from the left duct; **center** devices vertically.
- **Terminal sets & labels** — auto-tagged sets; anchored labels.
- **Validation** — overlap, too-tight clearance and plate-overflow warnings, each flagged with a
  human-readable message (warn-but-allow, never silently coerced).
- **Exports** — DXF via the ezdxf service (layers DUCT/EQUIP/TEXT/GROUND, 1:1 or 1:100, monochrome so it
  prints black in CAD); PDF/PNG/SVG in-browser, auto-fit to A4/A3 with scale printed in the title line.
- **Equipment DXF upload** — drag-drop a `.dxf` to measure and add a part to the library.
- **ezdxf service** — stateless FastAPI service with `upload` and `export` endpoints.
- **Docs & scaffolding** — README with rendered showcase drawings, SKILL.md, CLAUDE.md, RUNNING.md,
  DEPLOY.md, CONTRIBUTING.md, SECURITY.md, CI workflow, issue/PR templates, MIT license.

### Notes
- AI is socketed but **off** on every path (`AI_ENABLED=false`).
- Library dimensions marked `confirm:true` are estimates pending datasheet/DXF measurement; the IDEC
  FC6A-D16 was measured from its DXF at 70.19 × 103.29 mm.

[Unreleased]: https://github.com/Taamrock04/cabinet-layout-generator/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Taamrock04/cabinet-layout-generator/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Taamrock04/cabinet-layout-generator/releases/tag/v0.1.0
