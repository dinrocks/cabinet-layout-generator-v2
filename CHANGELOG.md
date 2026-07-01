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

### Changed (library reorg — AMR house style)
- **Empty starting library** — the editor opens on a **blank plate** and the palette categories start
  empty; you build the library by **uploading** parts. (The old seed parts remain only as a test fixture.)
- **Categories** are now: 1 Power & protection · 2 Control & comms · 3 Relays · 4 Terminal blocks ·
  5 Ground bar · **6 Stopper** · **7 Slim Stopper** · **8 Accessories** ("Power distribution" removed;
  Accessories is a catch-all for misc parts — glands, brackets, markers). Empty categories still show so
  the structure is visible.
- **Upload picks a category** (dropdown in the confirm modal); shared uploads store it (`library_items.band`
  — re-run `supabase/schema.sql` once to add the column). Stopper / Slim-Stopper category = the BOM "type".
- **Stopper with Label → "Add label plate"** — select a placed stopper-category part and drop a same-size
  label plate on it as a locked pair (replaces the old fixed Stopper / Stopper-with-Label buttons).

### Fixed (labelled-stopper readability + sidebar tooltip)
- **Labelled stoppers read in CAD** — the DXF export now masks a labelled stopper's geometry with a
  `WIPEOUT` so the centered marker is visible in GstarCAD (previously the stopper block drew over it).
- **Label faces the other way** — the marker text is rotated 180° from before (now `rot + 90`) in the
  editor, SVG/PDF/PNG and DXF, so all paths agree.
- **Sidebar tooltip** shows the part **name** (plus its size) when hovering a library part.
- **Pack / centre keep a label plate locked to its stopper** — a row's auto-pack (and the ↕ centre,
  and overflow counting) no longer treats a coincident label plate as its own device, so it stays on
  top of its stopper instead of sliding into a separate slot beside it.

### Added — DIN-rail alignment from the DXF origin
- **Uploaded devices remember their own 0,0 as the rail datum.** The service reads the DXF origin at upload
  and derives the **rail offset** (top→origin), so a row of different-height devices aligns by their **DIN-rail
  hook line** instead of by bounding-box centre. The upload dialog shows a **"Rail line (mm from top)"** field
  (pre-filled from the origin, editable); it falls back to centre when the origin lands outside the outline.
  Still tunable later via the panel's "Rail offset". (No AI — a measured geometric datum, human-confirmed.)

### Added — BOM (Bill of Materials)
- **BOM toolbar button** opens a parts list shaped to the shop-drawing BOM —
  **ITEM NO. (equipment tags) · DESCRIPTION · MANUFACTURER · MODEL · QTY**. Every placed element counts 1,
  a set of N counts N (its auto-tags B101… expand into ITEM NO.), aggregated by part. Locked stopper+label
  pairs tally as the stopper plus one collapsed **"Label for stopper"** line; unconfirmed sizes flagged (`*`).
- **Per-part BOM data** — `manufacturer` / `model` / `description` are entered in the upload dialog and
  editable later, either on a selected placed part (the panel's "BOM details") or via the library's **✎ Edit
  part** dialog (name · category · manufacturer · model · description — the same fields as upload). Human-entered,
  never invented (CLAUDE.md §0); unentered fields show **"-"**. Shared parts persist them in `library_items`
  (re-run `supabase/schema.sql` once to add the columns).
- **Download CSV** (Excel-friendly) for ordering. Deterministic, derived only from the model — the pure
  core (`model/bom.ts`) is unit-tested, no AI (CLAUDE.md §0/§5).

_Roadmap (deferred, see [ROADMAP.md](ROADMAP.md)): multi-user safety (last-saved-by + overwrite guard),
audit log, harden + custom domain, Phase 3 share-link + bundle._

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
