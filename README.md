<h1 align="center">Cabinet Layout Generator <sup>· Phase 2</sup></h1>

<p align="center">
  <strong>Lay out a control-cabinet back-plate in the browser — and export a real DXF that opens in GstarCAD.</strong>
</p>

<p align="center">
  <sub><b>This is the Phase-2 (multi-user) continuation</b> of
  <a href="https://github.com/Taamrock04/cabinet-layout-generator">cabinet-layout-generator</a> (the frozen Phase-1 v1).
  Phase-2 setup: <a href="docs/PHASE2_SETUP.md">docs/PHASE2_SETUP.md</a>.</sub>
</p>

<p align="center">
  Drag real DIN-rail parts, wire ducts, terminal sets and labels onto a mounting plate, set exact
  spacing in millimetres, and generate fabrication-ready <b>DXF</b> · <b>PDF</b> · <b>PNG</b> · <b>SVG</b>.
</p>

<p align="center">
  <img src="docs/showcase-layout.svg" alt="Example cabinet back-plate drawn by the tool" width="420"/>
  &nbsp;&nbsp;&nbsp;
  <img src="docs/showcase-page.svg" alt="The same layout exported to an A3 sheet with title block and dimensions" width="300"/>
</p>

<p align="center">
  <sub><em>Left: the live editor drawing. Right: the same model exported to an A3 sheet with title line, scale and row
  dimensions. Both are rendered from <b>one JSON model</b> — no redrawing.</em></sub>
</p>

<p align="center">
  <img alt="React" src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-TypeScript-646cff?logo=vite&logoColor=white">
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-ezdxf-009688?logo=fastapi&logoColor=white">
  <img alt="Status" src="https://img.shields.io/badge/Phase%202-live-2ea44f">
</p>

---

## Why it's different

Most "AI CAD" tools guess. This one doesn't.

> **The tool never invents geometry, connectivity, or part data. It only structures and interprets your
> input. Deterministic code draws every line. A human reviews the result in CAD.**

Every dimension, position and part identity is *exactly* what your validated input says — never a model's
best guess, because a confidently-wrong terminal or clearance ships to a panel shop. Unknown values are
**flagged for human confirmation**, never silently filled. (AI is socketed but **off** in v1; when enabled
it only ever structures messy input into the validated schema — it never emits a coordinate.)

---

## What you can do

**Place & arrange**
- Upload your own equipment DXFs into a **team-shared parts catalog** (measured on upload, DIN-rail
  datum read from the DXF origin, BOM fields captured) — organised into shop categories
- Resize equipment only by **typed millimetres**, never by free-drag (a real panel part has one true size)
- Rotate 0 / 90 / 180 / 270° or arbitrary; spacing math uses the rotated bounding box
- Snap to the part's **DIN-rail line** and butt up to a neighbour with the 0.1 mm gap
- **CAD-style selection**: marquee window/crossing sweeps (L→R / R→L), Shift-click, **Select row**,
  Ctrl+A — then nudge with arrow keys; full undo / redo

**Terminal sets & inserting**
- **Add a set** — N identical parts placed rail-aligned with optional **start/end caps** (end covers),
  **auto-numbered in place** (`B101…B112`) without exploding; explode later if you want singles
- **⇤⇥ Insert beside** any part or set — the row **shifts open automatically** to make room

**Wire ducts**
- Side ducts + row ducts; drag a duct to snap it **exactly onto any of the 4 plate borders**
- Row ducts **auto-span between the side ducts** on creation — no hand-measuring; one click **Fit width** re-spans

**Terminal accessories & custom parts**
- **Add label plate** onto any stopper — the stopper and its centered-marker label **move, rotate and delete as a locked pair**, while staying two parts so the BOM counts 1 stopper + 1 label
- **Custom part** — a blank device you **size and name yourself** (model/part-no centered inside, auto-fit so it never overflows; tag above in plain sight), for any part you don't have a CAD file for yet

**Rows**
- Rows are auto-detected between ducts, with each row height **dimensioned in the right margin**
- Click a row dimension to edit its height; **Pack** a row from the left duct; **center** its devices vertically

**Validate — never silently coerce**
- Overlap, too-tight clearance and plate-overflow are **flagged with a human-readable message**, never auto-cropped

**Export — all from the one model**
- **PDF / PNG are real drawing sheets**: frame, zone grid and the company **title block** (project /
  drawing no., rev history, initials — blank stays blank), auto-fit to A4/A3 with the scale printed in
  the SCALE cell. **Thai titles fully supported** (embedded Sarabun in the PDF)
- **DXF** with layers `DUCT` / `EQUIP` / `TEXT` / `GROUND`, at 1:1 or 1:100, monochrome so it prints
  black in CAD — every part a **named block** (`EQ_<key>`) for CAD **Count Block**, plus plot-ready
  **“A3 SHEET” and “BOM” paper-space layout tabs**
- **BOM** in shop format (ITEM NO. with `B101-B112` tag ranges · DESCRIPTION · MANUFACTURER · MODEL ·
  QTY) with manual BOM-only rows — as CSV, a framed PDF sheet, and the DXF tab

**Team (Phase 2)**
- Sign-in with an email allowlist; **cloud-saved projects in shared folders**, "saved by who/when",
  a stale-save conflict guard, **per-save revision history** (restore any of the last ~20), crash-safe
  local drafts, project duplication — and nightly backups
- **Degrades gracefully**: no cloud → local JSON save/open; DXF service asleep → PDF/PNG/SVG still work

---

## How it works

One JSON model is the single source of truth. The canvas is only a view — every export re-renders from the
model, so what you see is what you get.

```mermaid
flowchart LR
  A["Library + your input"] --> M["JSON Layout Model<br/>(validated)"]
  M --> R["model → SVG renderer"]
  R --> P["Live preview"]
  R --> E1["PDF / PNG / SVG"]
  M --> D["ezdxf assembler"]
  D --> E2["DXF"]
  E1 --> H["Human review in CAD"]
  E2 --> H
```

- **One renderer** (`model → SVG`) feeds the live preview *and* the PDF/PNG/SVG exports — they can't drift apart.
- **One coordinate transform** converts the editor's top-left origin to DXF's bottom-left, in a single place.
- **Pure, unit-tested core** — re-flow, packing, bbox/rotation math and the transform have no UI dependency.

---

## Quick start (local)

```bash
# 1) the editor — everything except DXF works with no backend
cd web
npm install
npm run dev            # → http://localhost:5180

# 2) optional: the DXF upload/export service (only needed for DXF)
cd service
python -m venv .venv
.venv\Scripts\activate          # Windows  (use: source .venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
uvicorn app:app --port 8000
```

Full instructions: **[RUNNING.md](RUNNING.md)** · deployment (Cloudflare Pages + Render + Supabase): **[DEPLOY.md](DEPLOY.md)** + **[docs/PHASE2_SETUP.md](docs/PHASE2_SETUP.md)**.

**New to the editor?** Once it's running, click **? Guide** in the toolbar (or open `/guide.html`) for an
illustrated walkthrough of every feature.

---

## Tech stack

- **Editor** — React 19 + Vite + TypeScript, Fabric.js v7 canvas, Vitest for the pure core
- **DXF service** — Python + FastAPI + ezdxf, stateless with just two endpoints (`upload`, `export`)
- **Free & portable on every layer** — layouts persist as JSON, equipment as raw DXF; nothing traps the engineer if a free tier changes

## Project layout

```
web/        React (Vite) editor — the model, validation, the model→SVG renderer, the canvas UI
  src/model/    types, geometry, validate, rows, sets, insert, marquee, bom, sheet…  (pure, unit-tested)
  src/render/   toSvg + page/BOM-sheet composers — THE single renderer (preview + PDF/PNG/SVG)
  src/editor/   Fabric.js canvas binding + Toolbar / LibrarySidebar / PropertiesPanel / dialogs
  src/store/    cloud projects (folders/revisions) · shared library · drafts · local JSON
service/    Python ezdxf service — DXF upload (measure + retain block) and export (assemble .dxf)
docs/       WORKFLOW · REFERENCE (palette/tree/stack) · RISK_REVIEW · PHASE2_SETUP · planning corpus
```

## Status

**Phase 1 — complete.** Single-user editor (drag/drop, move/rotate/type-mm, sets, labels, ducts with
border-snap + auto-span, rows with dimensions, packing, zoom/pan, overlap + clearance warnings),
stopper/label locked pairs, user-defined custom parts, equipment DXF upload, and all four exports
(DXF via the service — every part a named block; PDF/PNG/SVG in-browser).

**Phase 2 — live (this repo).** Supabase auth + email allowlist, cloud projects with **folders +
revision history + nightly backups**, the **team-shared equipment catalog**, a JWT-secured DXF service,
drawing sheets with the company title block, and the full BOM (CSV / PDF sheet / DXF tab) — deployed on
Cloudflare Pages + Render + Supabase, all free-tier. Setup: [docs/PHASE2_SETUP.md](docs/PHASE2_SETUP.md) ·
process: [docs/WORKFLOW.md](docs/WORKFLOW.md) · backlog: [ROADMAP.md](ROADMAP.md). The AI socket stays off.

---

<p align="center"><sub>Built for AMR Asia panel-shop drawings. The showcase images above are real tool output, rendered straight from the JSON model.</sub></p>
