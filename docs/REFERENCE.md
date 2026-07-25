# Reference — palette · folder tree · stack (Cabinet Layout Generator)

_The lookup card. Values here are pulled from the code (not invented); when code and this file
disagree, the code wins — fix this file in the same commit. Companion docs: [WORKFLOW.md](WORKFLOW.md)
(how we work), `SKILL.md` (architecture), `CLAUDE.md` (laws)._

---

## 1. Color palette

### Brand / UI (App.css, auth.css)
| Role | Hex | Notes |
|---|---|---|
| **Primary (action blue)** | `#2f6fed` | buttons, focus, selection, links; hover `#235fd1` |
| Primary focus ring | `rgba(47,111,237,.15)` | inputs (`:focus-within`) |
| Soft-blue fills | `#eef3ff` `#f5f8ff` `#e9f0ff` `#dbe8ff` | hovers, drop-target, list hover |
| Headings / strong text | `#1a1a1a` | body text `#444`, subheads `#374151` |
| Muted text | `#6b7280` | fainter `#9aa3af`, placeholder `#b6bcc6`, badge text `#4b5563` |
| Borders (grey ramp) | `#e3e3e3` `#ddd` `#eee` `#d6d6d6` `#cfd4dc` `#d0d5dd` `#cfd8e3` | pick the nearest existing one — don't add new greys |
| Card / panel bg | `#fff`, `#fafafa` | page bg `#eef0f2`, stage bg `#e9ecef` |
| Folder header | `#f0f3f8` (hover `#e7edf6`), count badge `#dbe3ee` | Open-dialog groups |
| Modal overlay | `rgba(0,0,0,.4)` | shadows `rgba(0,0,0,.12/.2/.25)` |

### Status colors
| State | Hex | Chip bg / border |
|---|---|---|
| OK / success | `#1a7f37` | `#eefaf1` / `#b6e3c2` |
| Error / danger | `#c00` (delete btn `#c0392b`) | `#fdf0f0` / `#f2c2c2` (danger border `#e0b4b4`) |
| Warning / estimate `*` | `#9a6700` | `#fff8e8` / `#f0e0b0` |
| "● unsaved" | `#b45309` | — |
| Checking / pending | `#d0a000` | — |

### Canvas & exports (toSvg.ts + FabricStage.tsx — MUST stay identical in both)
| Thing | Values |
|---|---|
| Plate | fill `#fafafa`, stroke `#000` @ 0.8 |
| Equipment rect | fill `#fff`, stroke `#222` @ 0.4 (set members 0.3; set piece outlines `#555` @ 0.25) |
| Uploaded-part linework (exports) | `svg_ref` embedded monochrome (strokes/fills → `#111`, white fills kept as masks, bg stripped) via `render/embedSvg.ts`; canvas keeps its own Fabric overlay |
| Wire duct | fill `#eef3ff`, stroke `#3559b3` @ 0.4 |
| Text | `#111` canvas / black SVG; row dims `#333`; stopper labels (canvas) `#1a7f37` |
| Unresolved part | fill `#fdd`/`#fdecec`, stroke `#c00` dashed — never silent |
| Overlap alert | stroke `#e00000`, fill `#fde2e2` |
| Too-tight alert | stroke `#e08600`, fill `#fff3e0` (snap guides also `#e08600`) |
| Marquee | L→R window: solid `#2f6fed`, fill `rgba(47,111,237,.08)` · R→L crossing: dashed `#1a7f37`, fill `rgba(26,127,55,.08)` |

### DXF export (dxf_build.py)
**Monochrome by design** — every layer ACI color **7** (white on CAD dark bg, black on paper).
Layers `PLATE / DUCT / EQUIP / TEXT / GROUND`; text style `ARIAL` (arial.ttf); blocks `EQ_<lib_key>`.

### Typography (drawing text, mm — shared constants, keep the three renderers in sync)
**Height semantics differ by medium:** DXF TEXT height = **CAP height** (AutoCAD/GstarCAD TrueType
rule); SVG/PDF `font-size` = **EM size** (Arial caps ≈ 0.716 em). The SHEET spec (measured 1:1 from
the engineer's Template.dxf, 2026-07-20 — kept OUT of the public repo) is in **CAP heights**: the DXF
tabs use them natively, `sheet.ts` converts cap→em (`CAP_TO_EM`) for SVG. The BOM **table** spec stays
in EM terms and converts em→cap at its DXF call sites (`ARIAL_CAP_PER_EM`). Model-space heights
(below) are CAD-calibrated — no conversion.
**Thai text:** **Arial is the sheet default**; only text runs containing Thai list "Sarabun" in their
font-family (`render/page.ts` `THAI_RE`) and embed **Sarabun** (OFL, `web/src/assets/`, registered in
`export/pdfFont.ts` — registered but NOT made active). So Latin-only PDFs stay pure Arial/Helvetica
with no font embedded; Thai runs embed just the Sarabun subset. PNG/preview use OS font fallback; DXF
stores UTF-8 and CAD substitutes fonts at render time.
Arial everywhere. Part tags **3.5 mm** (`TAG_FONT_MM`), Terminal-blocks band **2.5 mm**
(`TAG_FONT_TERMINAL_MM`), gap above part **2.5 mm** (`TAG_GAP_MM`) — defined in `toSvg.ts`,
mirrored in `dxf_build.py`. Duct label = 0.6 × duct thickness. Row-dim text 16 mm. Stopper
labels 10 mm. Label-plate marker: fit-to-plate (`fitFontSize`, swapped axes for the 90° text).

---

## 2. Folder tree (tracked files; one line each)

```
cabinet-layout-generator-v2/
├─ CLAUDE.md · SKILL.md            the laws · the architecture (read these first)
├─ README.md · ROADMAP.md · CHANGELOG.md · CONTRIBUTING.md · SECURITY.md · DEPLOY.md · RUNNING.md
├─ docs/
│  ├─ WORKFLOW.md                  how we work (process loop, doc map, commit style)
│  ├─ REFERENCE.md                 this file (palette · tree · stack)
│  ├─ RISK_REVIEW.md               ranked risks + why/how each fixed (Rounds 1–3, incl. VibeSec)
│  ├─ SECURITY_HARDENING.md        the security implementation plan (fail-closed · block-id · CSP)
│  ├─ PHASE2_SETUP.md              click-by-click provisioning (Supabase/Render/Cloudflare/share/audit)
│  ├─ planning/00–05 + README      as-built planning corpus
│  └─ showcase-*.svg               README artwork
├─ supabase/schema.sql             idempotent DB schema + RLS (allowlist·projects·revisions·folders·
│                                  library·share_token+RPC·project_events) — re-run the WHOLE file on change
├─ .github/workflows/              ci.yml (web checks + service harnesses) · keepalive.yml (Supabase
│                                  anti-pause) · backup.yml (nightly dump → private `backups` bucket)
├─ web/                            React 19 + Vite + TS, Fabric.js v7, Vitest
│  ├─ public/guide.html            in-app user guide  ·  public/_headers (CSP) · _redirects (SPA)
│  └─ src/
│     ├─ model/                    PURE core, no DOM/Fabric — every risky rule lives here, tested:
│     │   types · edit · geometry · rows · align · sets · insert · marquee · bom · validate ·
│     │   sheet (AMR title-block spec measured 1:1 from Template.dxf, mirrored in dxf_build.py) ·
│     │   bomsheet (BOM on sheets: wrap + paginate → PDF; mirrored in dxf_build.py BOM tab) ·
│     │   bundle (which uploaded DXFs a portable bundle needs) ·
│     │   library (BANDS/byName) · resolve · factory · overlap · ductsnap · reflow (+ *.test.ts)
│     ├─ render/                   toSvg.ts THE renderer (preview = PDF/PNG/SVG) · page.ts paper fit +
│     │                            BOM pages · embedSvg.ts (part linework: define-once/<use>, sanitize)
│     ├─ export/                   inBrowser (PDF/PNG/SVG via jsPDF/svg2pdf/canvas) · bundle (ZIP) · pdfFont (Thai/Sarabun)
│     ├─ editor/                   FabricStage (canvas view-binding) · useHistory (undo/redo) · zoom ·
│     │                            Toolbar · LibrarySidebar · PropertiesPanel · OpenDialog ·
│     │                            modals: Upload / EditPart / Insert / Bom / Revisions(+Activity) / Share
│     ├─ share/ShareViewer.tsx     anonymous read-only viewer (?share=<token>)
│     ├─ store/                    projectStore (cloud projects+folders+revisions+audit+share, stale-save CAS) ·
│     │                            useCloudProjects (open/save/dup/folders/history hook) ·
│     │                            libraryStore (shared parts, rowToItem) · draft (crash copy) · localFile (JSON)
│     ├─ auth/                     SignInGate · AuthProvider/Context · auth.css
│     ├─ lib/                      supabaseClient (client + accessToken) · timeAgo · shareToken
│     ├─ service/dxfClient.ts      the ONLY code that talks to the ezdxf service (export/upload/ping/fetchBlock)
│     └─ App.tsx + App.css         the shell (~500 lines: state + wiring; views extracted)
└─ service/                        FastAPI + ezdxf 1.4.4, deployed on Render
   ├─ app.py                       /health {storage,auth,require_auth} · /upload (20MB) · /export (JWT) · /block (bundle)
   ├─ dxf_build.py                 deterministic assembler — the ONE top-left↔bottom-left flip; AMR sheet + BOM tabs
   ├─ dxf_upload.py                measure bbox + rail datum from DXF origin + SVG preview
   ├─ store.py · auth.py           Storage block store (block-id validated) · JWT verify (HS256 + JWKS, fail-closed)
   ├─ test_build.py · test_auth.py · test_upload_rail.py · test_block.py   harnesses — all run in CI
   └─ render.yaml · .env.example   (generated, untracked: _blocks/ · out_service.* · __pycache__)
```

---

## 3. Hosting / env map (all free-tier)

| Where | What | Env / secrets |
|---|---|---|
| **Cloudflare Pages** `cabinet-layout-generator-v2.pages.dev` | frontend (root `web`, `npm ci && npm run build` → `dist`) | `NODE_VERSION=22`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_DXF_SERVICE_URL` |
| **Render** `cabinet-ezdxf-kndf.onrender.com` | ezdxf service (root `service`) | `ALLOWED_ORIGINS`, `REQUIRE_AUTH=1` (fail-closed), `SUPABASE_JWT_SECRET` ⚠, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` ⚠, `SUPABASE_BUCKET=equipment` |
| **Supabase** project `kfxhtqeooxvmikcgmfkc` | auth + DB (RLS) + Storage buckets `equipment`, `backups` (both private) | schema via `supabase/schema.sql` |
| **GitHub** `Taam4142/cabinet-layout-generator-v2` | repo (public) + Actions | secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` ⚠ |

⚠ `service_role` key = full DB access: **only** in Render env + GitHub Actions secrets. Never in
code, the frontend, or `web/.env` (anon key is the only browser-safe key). GitHub account was
renamed `Taamrock04` → `Taam4142`; Cloudflare/Render still deploy via the redirect — reconnect someday.

---

## 4. Hard conventions (the ones that bite — full text in CLAUDE.md/SKILL.md)

- **Units/origin:** model is real **mm**, origin **top-left**, +y down. DXF flips to bottom-left in
  **exactly one function** (`dxf_build._to_dxf`) — never scatter sign flips.
- **Three renderers must agree:** `toSvg.ts` (preview/PDF/PNG/SVG) · `FabricStage.tsx` (canvas) ·
  `dxf_build.py` (DXF). Every drawing change lands in all three; shared constants are mirrored
  TS↔Python with comments pointing at each other.
- **Model is the source of truth.** Fabric is view-only; exports never read the canvas.
- **Pure core, tested.** Anything risky (re-flow, pack, insert, bbox/rotation, BOM, marquee) is a
  pure function in `web/src/model/` with unit tests — no DOM.
- **Never invent data** (CLAUDE.md §0): unknown BOM fields render "-", estimated sizes carry
  `confirm:true` → `*`, unresolved lib_keys draw the red dashed placeholder + validation error.
- **Every part is a named block** `EQ_<lib_key>` in DXF (CAD "Count Block" / BOM-able).
- **Free + portable:** layouts are JSON, parts are raw DXF; local-only mode must keep working.
