# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Phase 2 (multi-user)

_This is the Phase-2 continuation repo (duplicated with full history from cabinet-layout-generator)._

### Added — project history + nightly backup (RISK_REVIEW R1)
- **Every Save keeps a revision** (`project_revisions`, last 20 per project, DB-trimmed). The Open
  dialog's **⟲ History** lists them ("saved by <name> · <time>"); **Restore loads that version into the
  editor as *unsaved* work** — the live project is untouched until you Save (which still runs the
  stale-save guard). One bad save no longer destroys a drawing. Re-run `supabase/schema.sql` once.
- **Nightly backup** (`.github/workflows/backup.yml`) dumps projects + shared library + allowlist to a
  **private** Supabase Storage bucket `backups`, rotating by day-of-month (~a month of restore points).
  Covers accidental project **deletion** too. Needs the `backups` bucket + a `SUPABASE_SERVICE_KEY`
  Actions secret (kept out of GitHub artifacts — the repo is public).

### Added — drawing sheets: frame + AMR title block on every export
- **Exports are now drawing sheets, not bare geometry.** PDF/PNG compose the real AMR sheet template
  (reproduced from the engineer's shop drawings): border + **zone grid** (1–10 / A–F), and the full
  bottom band — REFERENCE DRAWING NO./DESCRIPTION table, REMARK, REV/DATE/DESCRIPTION history,
  BY/CHK/ENG/APPR initials, DESIGNER/CLIENT/TITLE, and the SCALE · PROJECT NO. · DRAWING NO. ·
  SHEET · REV. cells. The **computed scale** (e.g. 1:10) prints in the SCALE cell.
- **DXF gets a paper-space "A3 SHEET" layout tab** — frame + title block at true paper mm and a
  **viewport** onto the plate at the nearest standard scale (1:1…1:100). Model space is untouched
  (blocks stay countable); open the layout tab in GstarCAD for a plot-ready sheet.
- **Title-block fields** (title line 2, project/drawing/sheet no., rev + date + description,
  BY/CHK/ENG/APPR, client, designer) are edited in the Plate panel, save with the project, and print
  blank when unset — never invented. Cell sizes are estimated from screenshots; tune in `model/sheet.ts`.
- **Sheets are always landscape** (house style) — a tall plate prints smaller instead of flipping the
  page to portrait.
- **Zone references** are drawn **once** — numbers along the top, letters down the left (the other two
  edges keep just the ticks) — and the drawing keeps a **≥10 mm gap** from the frame/band on all sides.

### Added — BOM as a printable drawing sheet (PDF)
- The BOM dialog now downloads a **multi-page vector PDF of real drawing sheets**: the AMR frame +
  title block with the BOM table (ITEM NO. · DESCRIPTION · MANUFACTURER · MODEL · QTY) laid out in the
  draw area. Long cells word-wrap and grow their row; rows **paginate** when the page fills, the column
  header repeats on every page, and multi-page runs are numbered ("PAGE 2 OF 3"). Uses the app's paper
  choice (A4/A3, landscape); the SCALE cell prints "-" (a BOM sheet has no scale). CSV export stays.
- Same data rules as the table: "-" for unentered fields, "*" marks unconfirmed size estimates, tag
  runs collapse to ranges (B101-B112). Pure tested core in `model/bomsheet.ts`.
- **Matched to the engineer's real BOM sheet** (2026-07-08): the table is a centred block ~0.65 of the
  draw-area width (not full-width), with DESCRIPTION dominant and MANUFACTURER/MODEL/QTY slim
  (`0.13 / 0.57 / 0.12 / 0.12 / 0.06`); heading reads "BILL OF MATERIALS". No **Total-parts** row on the
  drawing sheet (the real sheet doesn't carry one — the total is still in the on-screen dialog + CSV).

### Added — BOM in the DXF too (complete CAD drawing set)
- **The exported DXF now carries the BOM as its own paper-space layout tab** ("BOM", or "BOM 1…N" when
  it paginates) — the same AMR frame + title block as the "A3 SHEET" layout, with the BOM table laid
  out in the draw area. Open either tab in GstarCAD and plot: the single .dxf is now the whole set
  (layout sheet + BOM sheet), not just the geometry.
- The BOM **count stays the single tested TS core** (`buildBom`): the frontend sends the already
  aggregated + ITEM NO.-collapsed rows in the export payload; the service only lays them out (never
  re-counts). The table layout mirrors `model/bomsheet.ts` in `dxf_build.py`, sharing the frame/title
  block with the layout sheet via one `_sheet_chrome` helper.
- Widened the description word-wrap estimate (`CHAR_W` 0.62 → 0.68) so long all-caps lines stay inside
  their column in **true-Arial** DXF (and PDF), applied identically in both renderers.
- **Smaller BOM row font** (2.6 → 2.0 mm; line pitch + header sized to match) so the table reads like
  the engineer's real sheet — dense, with long descriptions comfortably inside the DESCRIPTION column
  (verified against real arial.ttf metrics: the longest line ≈ 104 mm in a 138 mm column).
- **Heading is just "BILL OF MATERIALS"** — dropped the "— PAGE n OF m" suffix on multi-page runs
  (PDF and DXF). Pagination still happens; the pages simply aren't numbered in the heading.

### Added — real device linework in PDF/PNG/SVG exports
- **Uploaded parts no longer export as bare rectangles.** The vector drawing captured at upload
  (`svg_ref` — the same one the editor canvas overlays) is now embedded into the export renderer,
  scaled/rotated onto each part's footprint: PDFs carry the part's real linework as vectors, like a
  monochrome plot from GstarCAD. Applies to placed elements AND set members/caps; PNG/SVG get it too.
- Styled like a monochrome CAD plot: the ezdxf screen background is stripped, every stroke/fill maps
  to print black, white fills stay white (masks). Per-instance class/id namespacing so repeated parts
  can't collide. Parse failure falls back to the plain rectangle — never a broken drawing.
- Pure tested core `render/embedSvg.ts`; rect/custom/label parts unchanged.

### Added — read-only share links (Phase 3, part 2 — Phase 3 complete)
- **Share** button (on a saved cloud project) creates a revocable link — `?share=<token>` — that anyone
  can open **without an account**: a read-only viewer showing the **latest saved version** (never
  unsaved editor work), rendered by the same engine as the editor, with PDF/PNG/BOM-sheet downloads.
  No editing, no DXF, no service dependency for the viewer.
- Security model: RLS stays closed. The only anonymous door is a `SECURITY DEFINER` RPC that answers
  an **exact 32-byte token match** and returns just the layout + the shared-catalog items it references
  (never listable, never the whole catalog). Revoke = clear the token; the link dies instantly.
- **Action needed once:** re-run `supabase/schema.sql` (adds `projects.share_token` + the
  `shared_project` RPC).

### Added — portable bundle export (Phase 3, part 1)
- **Bundle** button in the toolbar downloads `<name>.bundle.zip`: the layout JSON (the exact same
  envelope the ⬇/⬆ buttons use, so it re-imports directly) plus the **raw DXF of every placed uploaded
  part** (elements, set members, set caps — deduped) and a README. Nothing about a drawing stays
  trapped in a cloud bucket — "free + portable, every layer" (CLAUDE.md §5).
- New service endpoint `GET /block/{id}` serves a retained equipment DXF (auth-guarded like /export;
  id regex-validated — traversal-safe; clean 404 with a re-upload hint when a block is gone). A missing
  block fails the bundle loudly rather than shipping an incomplete ZIP.
- Pure tested core `model/bundle.ts` (manifest + ZIP-safe names); `test_block.py` harness runs in CI.

### Changed — App.tsx split into focused modules (hardening #8, part 1)
- Pure refactor, no behaviour change: the 1190-line shell is now ~500 lines of state + wiring, with
  the views extracted to `editor/Toolbar`, `editor/LibrarySidebar`, `editor/PropertiesPanel`,
  `editor/OpenDialog`, and the cloud project handlers (open/save/duplicate/folders/history +
  stale-save guard) grouped into a `store/useCloudProjects` hook. Verified by a browser smoke test
  (add/delete part, duct, zoom, panel switching — no console errors) plus all checks.

### Fixed — Thai titles in the PDF exports (embedded Sarabun font)
- **A Thai project name/title garbled in the exported PDF** — jsPDF's built-in fonts are Latin-only
  (Arial itself carries no Thai glyphs). The engineer's real titles ARE Thai, so this would have
  shipped a broken title block. **Arial stays the sheet default**; only text runs that actually
  contain Thai opt into the bundled **Sarabun** (OFL, the standard Thai document font) — so a
  Latin-only sheet is pure Arial/Helvetica (no font embedded), and a Thai title embeds just the
  Sarabun subset it needs.
- Verified end-to-end in a real browser through the real export pipeline: a Latin-only PDF contains
  zero Sarabun (14.7 KB, Helvetica), while a Thai-title PDF embeds Sarabun as a Type0 CID font with a
  ToUnicode CMap whose glyphs decode back to the correct Thai codepoints (title block screenshot
  confirms rendering). The DXF stores Thai intact through a write/read round-trip (harness-asserted)
  — CAD renders it with its own font substitution.
- License file ships alongside the font (`web/src/assets/Sarabun-OFL.txt`).

### Fixed — GstarCAD text overlap on the DXF sheets (cap-height vs em-size)
- **Root cause:** DXF TEXT height means **capital-letter height** in AutoCAD/GstarCAD (TrueType rule),
  while the browser's `font-size` means **em size** — Arial caps are only ~0.72 em. The same "2.0mm"
  therefore rendered ~1.4× larger *and wider* in CAD, pushing long BOM descriptions through the
  MANUFACTURER border (and into plots made from CAD), even though the PDF was clean.
- **Fix:** paper-space sheet text (title block + zone labels + BOM table) converts its em-spec heights
  by `ARIAL_CAP_PER_EM` (0.716) in one place (`dxf_build._sheet_chrome`), so the DXF layout tabs now
  render **identically to the PDF sheets** and the wrap budget holds in CAD. Model-space text (part
  tags, duct labels, row dims) is untouched — those were calibrated in CAD terms from real drawings.
- Harness asserts the conversion (2.0mm rows land as 1.432mm TEXT height; raw em heights are rejected).

### Hardening (RISK_REVIEW R4–R6)
- **Upload size cap** — the DXF service reads in chunks and rejects anything over **20 MB** (413), so a
  huge/wrong file can't OOM the free-tier instance for everyone. (R4)
- **Safer shared-part delete** — the delete confirm now warns that a **shared** part may be used by
  *other* saved projects (their placements would break), and the current-layout check now includes set
  caps. (R5)
- **Orphan cleanup on save** — unplaced per-instance label-plate/custom parts are dropped from the saved
  project (they used to accumulate forever); uploaded parts are always kept even if not yet placed. (R6)

### Added — folders for layouts
- Group layouts into **team-shared folders** (one level) — e.g. all the cabinets of one job under
  "Job X". The **Open dialog is now grouped**: collapsible folder sections (with a count) + an **Unfiled**
  section, ordered by most-recent activity (the folder you last touched floats up). **+ New folder**,
  rename (✎) / delete (✕, layouts move to Unfiled — never deleted), and a per-layout **▾ move** dropdown.
- Duplicating a layout keeps it in the same folder; **New** starts Unfiled. Nightly backup includes folders.
- Needs a one-time `supabase/schema.sql` re-run (adds `folders` + `projects.folder_id` + RLS).

### Changed — parts listed alphabetically
- Every part list — the sidebar under each category, **ADD A SET**, the start/end **cap** pickers, and
  the **Insert beside** dialog — now sorts **A→Z by name** (numeric-aware, case-insensitive) instead of
  by the order parts were added. Presentation only; nothing about the model/exports changes.

### Added — bulk selection (marquee, select-row, Ctrl+A)
- **Shift+drag rubber-band selection** with the CAD window/crossing rule: drag **left→right** (solid
  blue) selects only what's **fully inside**; **right→left** (dashed green) selects anything **touched**
  — GstarCAD muscle memory. Sweeps are additive (union), plain drag still pans, and the box picks up
  devices + labels only (never wire ducts).
- **⬌ Select row** (element/set panels) — one click selects every device sharing the anchor's DIN-rail
  line, plus their labels; then arrow-nudge or delete the pack. No more shift+clicking 100 objects.
- **Ctrl+A** selects all devices+labels; **Esc** clears the selection.

### Added — set caps (end covers) & insert-into-row
- **Sets can start/end with a cap device** (e.g. a D-DS2.5 end cover on a DS2.5 strip): pick optional
  **start/end** parts in the Add-a-set form, or add them to a **set already placed** (Set panel).
  Caps are part of the set — they move/rotate/pack/delete with it, sit **rail-aligned** to the members,
  count in the BOM (untagged, 1 per side), export as their own countable DXF blocks, and survive Explode.
- **⇤⇥ Insert beside…** (element + set panels) replaces the shift+click-a-dozen-slim-parts workflow:
  pick a part, side (left/right) and quantity in a small dialog — the row **shifts open automatically**
  (downstream only; cluster spacing, whole sets and locked pairs preserved; locked parts stay put) and
  the new part drops in flush, rail-aligned to the anchor. One undo step.
- Editor canvas now draws each set member/cap outline (matching the exports), not just one blank box.

### Added — duplicate a project
- **Duplicate** (toolbar, cloud) forks the **current** layout — including unsaved edits — into a brand-new
  project (prompts for a name, default "Copy of …"), then switches you onto the copy; the original row is
  left untouched. A clean "branch my work" without saving over the original.
- **⧉ per row in the Open dialog** copies a **saved** project into a new one *without opening it* (for
  template copies). Both reuse the normal insert path — no schema change; project-local parts ride along,
  shared parts stay shared.

### Added — multi-user safety (RISK_REVIEW R3)
- **Stale-save guard** — projects are team-shared with last-write-wins, so two people could silently
  clobber each other. Save now does a **compare-and-set** against the version you opened; if someone
  saved in between, you're warned (**"⚠ <name> saved this at <time>, after you opened it"**) and choose
  to **overwrite** or **keep your work unsaved** (nothing lost — you can ⬇ download or Open theirs).
- **"saved by <name> <when>"** shows in the top bar (after open/save) and on every row of the Open list,
  so you can see who touched a layout last before you edit it.

### Added — unsaved-changes guard (RISK_REVIEW R2)
- **You can no longer silently lose work.** The editor tracks unsaved changes (an **"● unsaved"**
  chip shows in the toolbar) and warns before every discard path: closing/reloading the tab
  (`beforeunload`), **New**, and **Open** (cloud or file) — Open previously discarded edits with
  no warning at all. Undoing back to the last-saved state reads as clean again.
- **Crash-safe draft** — while dirty, a working copy (model + project-local parts) is written to
  `localStorage` (debounced 2 s). On the next launch you're offered a restore; a restored draft
  stays *unsaved* until you actually Save. Cleared on save/open/new; the JSON ⬇ download also
  counts as a save (it's the local-mode save).

### Changed — top-bar tidy-up
- **Project name reads as an editable field** — it's now a bordered box with a ✎ pencil and an
  "Untitled project" placeholder, instead of looking like static grey text.
- **Toolbar regrouped by purpose** — File · History · View (zoom + Align) · Export (DXF /
  PDF-PNG-SVG-BOM) · and Help + status + account pushed to the far right. Same buttons, clearer order.
- **Removed "Snap 1mm"** — a coarse whole-mm drag grid that was off by default and superseded by **Align**
  (adjacent + rail snap), typed X/Y, and 1 mm arrow-nudge. Dropped to declutter (and it fought the 0.1 mm
  gap precision). Positioning is unchanged via those three.

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

### Changed — part tags match the shop drawings
- **Smaller, centered, horizontal part tags.** Tags were a fixed 10 mm and rotated 90° when wider than the
  part (giant vertical `R101`). They're now **3.5 mm** by default and **2.5 mm** for the **Terminal-blocks**
  category — centered just above each part, never rotated, and shrunk to fit if a tag would overflow a narrow
  part so it never overlaps a neighbour. Applied identically in the editor, SVG/PDF/PNG, and DXF. (Sizes are
  constants — easy to tune.)
- **Sets are auto-numbered in place** — a set (group) with a tag start now draws its member tags
  (`B101…B112`, `RM1…RM4`) directly, so you no longer have to **explode** it to get the numbers. Editor,
  SVG/PDF/PNG and DXF all match, and the numbers equal what an explode would bake in.
- **Label-plate text stays inside the plate** — a long marker (e.g. "WARNING-LAMP") no longer overflows
  past the ends of its label plate. The vertical text is now fit to the plate (length to the height, glyph
  to the width), shrinking as needed. Editor, SVG/PDF/PNG and DXF match.

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
  part** dialog (name · category · **rail line** · manufacturer · model · description — the same fields as upload,
  and the Edit dialog persists the rail line to the shared catalog too). Human-entered,
  never invented (CLAUDE.md §0); unentered fields show **"-"**. Shared parts persist them in `library_items`
  (re-run `supabase/schema.sql` once to add the columns).
- **Manual BOM-only rows** — the BOM dialog now has an editable list for items **not on the plate**
  (RTU cabinet, name plates, lamp/fluorescent, fans, outlets): Item No · Description · Manufacturer ·
  Model · Qty. They merge in after the counted device rows and into the CSV, and save with the project.
- **ITEM NO. collapses consecutive tags to ranges** — a run of 3+ consecutive tags shows as `first-last`
  (`R101, R102, … R111` → `R101-R111`; `1…16` → `1-16`), keeping singletons/pairs listed. Big space saver
  in the BOM table and CSV.
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
