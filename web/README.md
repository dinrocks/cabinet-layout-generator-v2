# web — the editor (React + Vite + TypeScript)

The Cabinet Layout Generator frontend: the manual-first 2D editor, the single `model → SVG` renderer
that drives every in-browser export, the cloud/store layer, and the read-only share viewer. See the
repo **[README](../README.md)** for the product overview, **[RUNNING.md](../RUNNING.md)** to run it
locally, and **[docs/REFERENCE.md](../docs/REFERENCE.md)** for the full source tree.

## Run

```bash
npm install
npm run dev        # → http://localhost:5180
```

With no Supabase env it runs in **local mode** (full editor + JSON save/open, no sign-in). To wire the
cloud (auth, saved projects, share links, audit log) set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_DXF_SERVICE_URL` in `web/.env` — see **[docs/PHASE2_SETUP.md](../docs/PHASE2_SETUP.md)**.

## Checks (the same ones CI runs)

```bash
npm run typecheck   # tsc -p tsconfig.app.json  (bare `tsc --noEmit` is a no-op here — use this)
npm run lint
npm run test        # vitest — the pure model/render core
npm run build       # tsc -b + vite build → dist/  (dist copies public/_headers CSP + _redirects SPA)
```

## Layout (see [docs/REFERENCE.md](../docs/REFERENCE.md) for the annotated tree)

- `src/model/` — **pure, unit-tested** core (geometry, rows, sets, insert, marquee, BOM, sheet, bundle…).
  No DOM/Fabric. Every risky rule lives here.
- `src/render/` — `toSvg` (THE renderer: preview = PDF/PNG/SVG), `page`/BOM-sheet composers, `embedSvg`
  (real part linework). Mirrored by `service/dxf_build.py` for the DXF — the three renderers must agree.
- `src/editor/` — Fabric canvas view-binding + `Toolbar` / `LibrarySidebar` / `PropertiesPanel` /
  `OpenDialog` + modals. The canvas is a **view only**; exports never read it.
- `src/store/` — cloud projects (folders / revisions / audit / share), the `useCloudProjects` hook,
  shared library, crash-draft, local JSON.
- `src/share/` — the anonymous `?share=<token>` read-only viewer.
