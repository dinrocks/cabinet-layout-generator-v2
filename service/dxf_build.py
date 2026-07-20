"""DXF assembler: (layout model + library) -> ezdxf Document.

This is the deterministic export engine (SKILL.md §3.3 / §6, CLAUDE.md §0/§2/§4).
It NEVER invents geometry — it places exactly what the validated model says.

Conventions honoured here:
  - Editor coords are top-left, +y DOWN, mm. DXF is bottom-left, +y UP.
    The flip happens in ONE function: `_to_dxf`. (CLAUDE.md §4)
  - Layers: PLATE / DUCT / EQUIP / TEXT / GROUND.
  - Text style "ARIAL" (TrueType arial.ttf) — matches the engineer's GstarCAD text.
  - Scale: 1:1 (factor 1.0) or 1:100 (factor 0.01). Geometry is multiplied by the
    factor. (Dimension entities that must read the REAL value are a later feature;
    no dimensions are emitted yet, so the rule does not yet apply — see TODO.)
  - Uploaded `dxf` parts are re-embedded as INSERTs with the rotated-anchor offset
    computed so the rotated footprint's top-left lands exactly where placed
    (the wrinkle the Step-0 spike surfaced).
"""
from __future__ import annotations

import math
import re
from typing import Any

import ezdxf
from ezdxf import bbox
from ezdxf.addons.importer import Importer

import store

# All layers use ACI colour 7 (white/black): it shows white on GstarCAD's dark
# modelspace and prints BLACK on white paper / PDF. Layer NAMES are kept so the
# engineer can still select/toggle by layer; only the colour is unified.
MONO = 7
LAYERS = {
    "PLATE": MONO,
    "DUCT": MONO,
    "EQUIP": MONO,
    "TEXT": MONO,
    "GROUND": MONO,
    "SHEET": MONO,  # paper-space frame + title block
}
TEXT_STYLE = "ARIAL"

# ── drawing-sheet template (paper mm) — MUST match web/src/model/sheet.ts ──
# Measured 1:1 from the engineer's real Template.dxf (2026-07-20), normalized to
# A3 landscape. All text heights are CAD CAP heights (DXF's native unit) and are
# used directly here; the web renderer converts them to em for SVG.
SHEET_MARGIN_X = 4.99    # inner frame offset from the paper edge (sides)
SHEET_MARGIN_TOP = 4.83  # inner frame offset from the paper top
SHEET_BAND_MM = 28.51    # title band below the inner frame, down to the paper edge
SHEET_PAD_MM = 10.0      # min gap between the drawing and the frame/band (≥10mm)
SHEET_COL_TICKS = [42.8, 84.6, 126.4, 168.2, 210.0, 251.8, 293.6, 335.4, 377.2]
SHEET_ROW_TICKS = [49.15, 93.36, 137.57, 181.78, 225.99]
SHEET_ZONE_H = 2.56
# title band (A3 y coords): tables/cells as measured
BAND_Y = 268.49
REF_SPLIT, REF_X2 = 42.79, 111.29
REMARK_X1 = 111.29
REV_COLS = [187.09, 192.5, 202.86, 258.34, 263.87, 269.4, 274.93, 283.27]
BAND_ROW_YS = [272.48, 275.94, 279.4, 282.86, 286.31, 289.77, 293.22]
DESIGNER_X1, DESIGNER_X2, DESIGNER_Y2 = 283.27, 343.99, 288.57
CLIENT_SPLIT_Y = 278.62
STRIP_Y1, STRIP_LABEL_Y = 288.57, 291.03
STRIP_COLS = [283.27, 313.63, 343.99, 395.82, 413.09, 420.0]
H_LABEL, H_REVVAL, H_TITLE, H_TITLE2, H_CELLVAL, H_SHEETVAL = 1.28, 1.02, 1.88, 1.65, 2.13, 1.88
# standard plot scales 1:N — the smallest N that fits the draw area is chosen
STD_SCALES = [1, 2, 2.5, 5, 10, 15, 20, 25, 50, 100]

# ── BOM drawing sheet (paper mm) — MUST match web/src/model/bomsheet.ts ──
# The BOM aggregation lives in the tested TS core (buildBom); the frontend sends the
# already-collapsed rows in the export payload. Here we only lay them out on the AMR
# sheet, mirroring bomsheet.ts arithmetic exactly.
BOM_TABLE_W_FRAC = 0.65                        # centred table, ~0.65 of the draw area
BOM_COL_F = [0.13, 0.57, 0.12, 0.12, 0.06]     # ITEM · DESCRIPTION · MFR · MODEL · QTY
BOM_COL_HEAD = ["ITEM NO.", "DESCRIPTION", "MANUFACTURER", "MODEL", "QTY"]
BOM_COL_CENTER = [True, False, False, False, True]
BOM_FONT = 2.0                                 # small, matching the engineer's real sheet
BOM_LINE_H = 3.3
BOM_HEAD_H = 7.0
BOM_HEAD_FONT = 2.4
BOM_HEADING = "BILL OF MATERIALS"
# char-width estimate (× font mm) for wrapping — 0.68 (wider than the 0.62 used for
# part tags) because the all-caps descriptions run wider in true Arial.
BOM_CHAR_W = 0.68

# DXF TEXT height means CAP height in AutoCAD/GstarCAD for TrueType fonts, while the
# web renderer's SVG font-size means EM size (Arial caps ≈ 0.72 em). The sheet specs
# (sheet.ts / bomsheet.ts) are calibrated in EM terms against the real template, so
# paper-space text heights convert HERE, in one place — without this the same nominal
# height renders ~1.4x larger/wider in CAD and long BOM lines overflow their column
# (the GstarCAD overlap bug, 2026-07-09). Model space is untouched: its tag/label
# heights were calibrated directly against the engineer's CAD shop drawings.
ARIAL_CAP_PER_EM = 0.716


def _bom_dash(s: object) -> str:
    """'-' for an empty/blank cell (never invent); otherwise the value."""
    return str(s) if (s is not None and str(s).strip()) else "-"


def _wrap_cell(s: str, max_w: float, font: float = BOM_FONT) -> list[str]:
    """Greedy word-wrap to lines that fit `max_w` mm at `font` mm (BOM_CHAR_W·h per
    glyph) — mirrors wrapCell() in web/src/model/bomsheet.ts."""
    max_chars = max(4, int((max_w - 3) / (BOM_CHAR_W * font)))
    words = s.split()
    if not words:
        return [s]
    lines: list[str] = []
    cur = ""
    for w in words:
        cand = f"{cur} {w}" if cur else w
        if len(cand) <= max_chars:
            cur = cand
            continue
        if cur:
            lines.append(cur)
        rest = w  # hard-break a single overlong word (long tag runs)
        while len(rest) > max_chars:
            lines.append(rest[:max_chars])
            rest = rest[max_chars:]
        cur = rest
    if cur:
        lines.append(cur)
    return lines

# Part-tag text heights (mm) — small + horizontal, matching the shop drawings. Fixed
# per category; the Terminal-blocks category is smaller so a 2-digit number fits
# centered over a ~5mm terminal. MUST match web/src/render/toSvg.ts.
TAG_FONT_MM = 3.5
TAG_FONT_TERMINAL_MM = 2.5
TERMINAL_BAND = 4  # BANDS: 4 = "Terminal blocks"
TAG_GAP_MM = 2.5


def _num(v: object) -> str:
    """Format a dimension without a trailing '.0' (e.g. 40.0 -> '40')."""
    f = float(v)
    return str(int(f)) if f.is_integer() else str(f)


def _step_tag(start: str, n: int) -> str:
    """Step an auto-tag like "B101"/"RM1" by n, keeping the prefix + zero-pad width.
    Mirrors stepTag() in web/src/model/edit.ts so a set's in-place numbers match the
    tags an explode would bake in."""
    m = re.match(r"^(.*?)(\d+)$", start)
    if not m:
        return start if n == 0 else f"{start}{n}"
    prefix, num = m.group(1), m.group(2)
    return f"{prefix}{int(num) + n:0{len(num)}d}"


def _fit_font(text: str, w: float, h: float) -> float:
    """Font height (mm) so `text` fits centered in a w x h box without overflowing.
    Matches the web renderer's fitFontSize so the editor and DXF agree."""
    n = max(1, len(text))
    return max(2.5, min((0.85 * w) / (n * 0.62), 0.45 * h, 10.0))


# --------------------------- geometry helpers ---------------------------

def rotated_footprint(w: float, h: float, rot_deg: float) -> tuple[float, float]:
    a = rot_deg % 360
    if a in (0, 180):
        return w, h
    if a in (90, 270):
        return h, w
    r = math.radians(a)
    c, s = abs(math.cos(r)), abs(math.sin(r))
    return w * c + h * s, w * s + h * c


def rotate_point(x: float, y: float, rot_deg: float) -> tuple[float, float]:
    r = math.radians(rot_deg % 360)
    cs, sn = math.cos(r), math.sin(r)
    return (x * cs - y * sn, x * sn + y * cs)


def insert_point_for(part_w: float, part_h: float, rot_deg: float,
                     dxf_ll_x: float, dxf_ll_y: float) -> tuple[float, float]:
    """Insert point so a block (local origin at part lower-left) rotated by
    rot_deg has its rotated bbox lower-left at (dxf_ll_x, dxf_ll_y) in DXF space.

    Rotation is about the insert point; we offset the insert point by the
    rotated part's local bbox-min so placement is exact for any angle.
    """
    corners = [(0, 0), (part_w, 0), (part_w, part_h), (0, part_h)]
    rc = [rotate_point(cx, cy, rot_deg) for cx, cy in corners]
    rminx = min(p[0] for p in rc)
    rminy = min(p[1] for p in rc)
    return (dxf_ll_x - rminx, dxf_ll_y - rminy)


# --------------------------- the assembler ---------------------------

class DxfAssembler:
    def __init__(self, model: dict[str, Any], library: dict[str, Any], scale: float = 1.0,
                 bom: list[dict[str, Any]] | None = None):
        self.model = model
        self.library = library
        self.scale = scale
        # BOM rows are computed by the TS core (buildBom) and sent in the payload —
        # never re-aggregated here (single source of truth). None → no BOM tab.
        self.bom = bom or []
        self.plate_h = float(model["plate"]["height_mm"])
        self.doc = ezdxf.new("R2018", setup=True)
        self.doc.units = ezdxf.units.MM
        for name, color in LAYERS.items():
            if name not in self.doc.layers:
                self.doc.layers.add(name, color=color)
        if TEXT_STYLE not in self.doc.styles:
            self.doc.styles.add(TEXT_STYLE, font="arial.ttf")
        self.msp = self.doc.modelspace()
        self._imported_blocks: dict[str, str] = {}  # lib_key -> block name

    # the ONE place the top-left -> bottom-left flip + scale happens
    def _to_dxf(self, x_mm: float, y_top_mm: float) -> tuple[float, float]:
        return (x_mm * self.scale, (self.plate_h - y_top_mm) * self.scale)

    def _s(self, v: float) -> float:
        return v * self.scale

    def _rect(self, x_top_left: float, y_top: float, w: float, h: float, layer: str) -> None:
        # editor top-left rect -> four DXF corners (flip via lower-left)
        x0, y0 = self._to_dxf(x_top_left, y_top + h)  # lower-left
        x1, y1 = x0 + self._s(w), y0 + self._s(h)
        self.msp.add_lwpolyline(
            [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)],
            dxfattribs={"layer": layer},
        )

    def _text(self, s: str, cx_mm: float, cy_top_mm: float, height_mm: float,
              rot_deg: float = 0, layer: str = "TEXT",
              align: ezdxf.enums.TextEntityAlignment = ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER) -> None:
        x, y = self._to_dxf(cx_mm, cy_top_mm)
        t = self.msp.add_text(
            s, dxfattribs={"layer": layer, "height": self._s(height_mm),
                           "style": TEXT_STYLE, "rotation": rot_deg},
        )
        t.set_placement((x, y), align=align)

    def _line(self, x1: float, y1: float, x2: float, y2: float, layer: str = "TEXT") -> None:
        a = self._to_dxf(x1, y1)
        b = self._to_dxf(x2, y2)
        self.msp.add_line(a, b, dxfattribs={"layer": layer})

    # ----- row dimensions (right margin) -----

    def _row_dims(self) -> None:
        ducts = self.model.get("ducts", [])
        horiz = sorted(
            [d for d in ducts if float(d.get("rot_deg", 0)) % 180 == 0],
            key=lambda d: float(d["y_mm"]),
        )
        if len(horiz) < 2:
            return
        W = float(self.model["plate"]["width_mm"])
        dim_x = W + 40
        ml = ezdxf.enums.TextEntityAlignment.MIDDLE_LEFT
        for a, b in zip(horiz, horiz[1:]):
            top_y = float(a["y_mm"]) + float(a["width_mm"])
            bottom_y = float(b["y_mm"])
            value = round(bottom_y - top_y, 1)
            self._line(W, top_y, dim_x + 8, top_y)          # extension lines
            self._line(W, bottom_y, dim_x + 8, bottom_y)
            self._line(dim_x, top_y, dim_x, bottom_y)        # dimension line
            self._line(dim_x - 3, top_y + 3, dim_x + 3, top_y - 3)      # ticks
            self._line(dim_x - 3, bottom_y + 3, dim_x + 3, bottom_y - 3)
            self._text(_num(value), dim_x + 12, (top_y + bottom_y) / 2, 16, align=ml)

    # ----- parts -----

    def _import_block(self, lib_key: str, block_ref: str) -> str:
        if lib_key in self._imported_blocks:
            return self._imported_blocks[lib_key]
        src = ezdxf.readfile(str(store.path(block_ref)))
        ext = bbox.extents(src.modelspace(), fast=False)
        block_name = f"EQ_{lib_key}"
        block = self.doc.blocks.new(name=block_name)
        importer = Importer(src, self.doc)
        for e in src.modelspace():
            importer.import_entity(e, block)
        importer.finalize()
        # force the re-embedded geometry to mono colour so it prints black too
        for ent in block:
            try:
                ent.dxf.color = MONO
            except (AttributeError, ValueError):
                pass
        # normalize base point to part lower-left so placement is predictable
        block.block.dxf.base_point = (ext.extmin.x, ext.extmin.y, 0)
        self._imported_blocks[lib_key] = block_name
        return block_name

    def _unit_block(self, lib_key: str, w: float, h: float) -> str:
        """A named block holding the part's rectangle at local origin (0,0)-(w,h)
        in real mm, so rect/symbol parts are countable INSERTs in CAD (BOM /
        'Count Block'), just like uploaded-DXF parts. Base point = lower-left."""
        cached = self._imported_blocks.get(lib_key)
        if cached:
            return cached
        name = f"EQ_{lib_key}"
        if name not in self.doc.blocks:
            blk = self.doc.blocks.new(name=name)
            blk.add_lwpolyline(
                [(0, 0), (w, 0), (w, h), (0, h), (0, 0)],
                dxfattribs={"layer": "EQUIP", "color": MONO},
            )
            blk.block.dxf.base_point = (0, 0, 0)
        self._imported_blocks[lib_key] = name
        return name

    def _place_block(self, block_name: str, w: float, h: float,
                     x: float, y_top: float, rot: float) -> None:
        """Insert a block so its rotated footprint's top-left lands at (x, y_top)
        in editor coords. Same anchor math for uploaded-DXF and unit blocks."""
        fw, fh = rotated_footprint(w, h, rot)
        ll_x, ll_y = self._to_dxf(x, y_top + fh)  # footprint lower-left in DXF
        ins_x, ins_y = insert_point_for(self._s(w), self._s(h), rot, ll_x, ll_y)
        self.msp.add_blockref(
            block_name, (ins_x, ins_y),
            dxfattribs={"layer": "EQUIP", "rotation": rot,
                        "xscale": self.scale, "yscale": self.scale},
        )

    def _has_label(self, el: dict[str, Any]) -> bool:
        """True if this element is a stopper carrying a coincident label plate (its
        pair-mate is a label_plate part) — its geometry should be masked so the
        marker reads."""
        pid = el.get("pair_id")
        if not pid:
            return False
        eid = el.get("id")
        for o in self.model.get("elements", []):
            if o.get("id") == eid or o.get("pair_id") != pid:
                continue
            oi = self.library.get(o.get("lib_key"))
            if oi and oi.get("label_plate"):
                return True
        return False

    def _wipeout(self, x: float, y_top: float, w: float, h: float) -> None:
        """A WIPEOUT over the footprint — masks whatever is drawn behind it (prints
        blank), so a labelled stopper reads cleanly. Drawn after the part's block and
        before the label, so the label stays on top."""
        x0, y0 = self._to_dxf(x, y_top + h)  # lower-left
        x1, y1 = x0 + self._s(w), y0 + self._s(h)
        self.msp.add_wipeout([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])

    def _place_element(self, el: dict[str, Any]) -> None:
        item = self.library.get(el["lib_key"])
        if item is None:
            return  # validation already flags unresolved keys; never invent
        w, h = float(item["width_mm"]), float(item["height_mm"])
        rot = float(el.get("rot_deg", 0))
        fw, fh = rotated_footprint(w, h, rot)
        x, y_top = float(el["x_mm"]), float(el["y_mm"])

        # every part is a named block (EQ_<lib_key>) so it is countable in CAD
        if item["source"] == "dxf" and item.get("block_ref"):
            block_name = self._import_block(el["lib_key"], item["block_ref"])
        else:
            block_name = self._unit_block(el["lib_key"], w, h)
        self._place_block(block_name, w, h, x, y_top, rot)
        # a labelled stopper: mask its geometry so the marker on the label reads
        if self._has_label(el):
            self._wipeout(x, y_top, fw, fh)

        tag = el.get("tag")
        if tag:
            if item.get("label_plate"):
                # marker plate: tag centered + vertical, fit to the plate so a long
                # label stays inside it (length fits the height, glyph fits the width)
                self._text(tag, x + fw / 2, y_top + fh / 2,
                           _fit_font(tag, h, w), rot_deg=(rot + 90) % 360)
            else:
                # centered just above the part; small category font (Terminal blocks
                # smaller so 2 digits fit), shrunk to fit if it'd overflow. Never rotated.
                cap = TAG_FONT_TERMINAL_MM if item.get("band") == TERMINAL_BAND else TAG_FONT_MM
                tag_h = max(1.5, min(cap, (0.92 * fw) / (max(1, len(tag)) * 0.62)))
                bc = ezdxf.enums.TextEntityAlignment.BOTTOM_CENTER
                self._text(tag, x + fw / 2, y_top - TAG_GAP_MM, tag_h, align=bc)
        # custom placeholder: model / part-no centered inside, auto-fit to the box
        name = item.get("name")
        if item.get("custom") and name:
            self._text(name, x + fw / 2, y_top + fh / 2, _fit_font(name, fw, fh))

    def _block_for(self, lib_key: str, item: dict[str, Any]) -> str:
        """The named block for a part — imported DXF geometry or a unit rect."""
        if item["source"] == "dxf" and item.get("block_ref"):
            return self._import_block(lib_key, item["block_ref"])
        return self._unit_block(lib_key, float(item["width_mm"]), float(item["height_mm"]))

    @staticmethod
    def _rail_off(item: dict[str, Any], rot: float) -> float:
        """Distance from the (rotated) footprint TOP to the DIN-rail line.
        Mirrors railOffsetWithinFootprint in web/src/model/align.ts."""
        w, h = float(item["width_mm"]), float(item["height_mm"])
        off = float(item.get("rail_offset_mm") or h / 2)
        a = rot % 360
        if a == 0:
            return off
        if a == 180:
            return h - off
        _fw, fh = rotated_footprint(w, h, rot)
        return fh / 2  # 90/270: rail concept doesn't rotate cleanly — use centre

    def _place_group(self, g: dict[str, Any]) -> None:
        """A set: optional start cap, N members, optional end cap — laid out and
        rail-aligned exactly like web/src/model/sets.ts groupLayout()."""
        item = self.library.get(g["lib_key"])
        if item is None:
            return
        w, h = float(item["width_mm"]), float(item["height_mm"])
        rot = float(g.get("rot_deg", 0))
        fw, _fh = rotated_footprint(w, h, rot)
        x = float(g["x_mm"])
        y_top = float(g["y_mm"])
        gap = float(g.get("internal_gap_mm", 0.1))
        member_rail = self._rail_off(item, rot)
        rail_y = y_top + member_rail

        def place_cap(key: object) -> float:
            """Place a cap at the cursor (rail-aligned); returns its footprint width."""
            cap_item = self.library.get(key) if key else None
            if not cap_item:
                return 0.0
            cw, ch = float(cap_item["width_mm"]), float(cap_item["height_mm"])
            cfw, _cfh = rotated_footprint(cw, ch, rot)
            cap_y = rail_y - self._rail_off(cap_item, rot)
            self._place_block(self._block_for(str(key), cap_item), cw, ch, x, cap_y, rot)
            return cfw

        cap_w = place_cap(g.get("cap_start_key"))
        if cap_w:
            x += cap_w + gap

        block_name = self._block_for(g["lib_key"], item)
        tag_start = g.get("tag_start")
        tag_step = int(g.get("tag_step", 1))
        cap = TAG_FONT_TERMINAL_MM if item.get("band") == TERMINAL_BAND else TAG_FONT_MM
        bc = ezdxf.enums.TextEntityAlignment.BOTTOM_CENTER
        for i in range(int(g["count"])):
            self._place_block(block_name, w, h, x, y_top, rot)
            # auto-number each member in place (so a set is tagged without exploding)
            if tag_start:
                tag = _step_tag(str(tag_start), i * tag_step)
                tag_h = max(1.5, min(cap, (0.92 * fw) / (max(1, len(tag)) * 0.62)))
                self._text(tag, x + fw / 2, y_top - TAG_GAP_MM, tag_h, align=bc)
            x += fw + gap

        place_cap(g.get("cap_end_key"))

    def _place_duct(self, d: dict[str, Any]) -> None:
        horizontal = float(d.get("rot_deg", 0)) % 180 == 0
        w = float(d["length_mm"]) if horizontal else float(d["width_mm"])
        h = float(d["width_mm"]) if horizontal else float(d["length_mm"])
        self._rect(float(d["x_mm"]), float(d["y_mm"]), w, h, "DUCT")
        # label matches the as-builts: "WIRE DUCT 40X60 MM"; height ~60% of thickness
        label = f"WIRE DUCT {_num(d['width_mm'])}X{_num(d['label_h_mm'])} MM"
        self._text(label, float(d["x_mm"]) + w / 2, float(d["y_mm"]) + h / 2,
                   float(d["width_mm"]) * 0.6, rot_deg=0 if horizontal else 90)

    def _place_label(self, l: dict[str, Any]) -> None:
        kind, ref = l["anchor"].split(":")
        host = None
        if kind == "element":
            host = next((e for e in self.model["elements"] if e["id"] == ref), None)
        elif kind == "group":
            host = next((g for g in self.model["groups"] if g["id"] == ref), None)
        if host is None:
            return
        x = float(host["x_mm"]) + float(l.get("dx_mm", 0))
        y = float(host["y_mm"]) + float(l.get("dy_mm", 0))
        self._text(l["text"], x, y, 10, rot_deg=float(l.get("rot_deg", 0)))

    # ----- paper-space sheets (frame + zone grid + AMR title band + content) -----

    @staticmethod
    def _draw_area(paper_w: float, paper_h: float) -> tuple[float, float, float, float]:
        """Usable draw area (x, y, w, h) in top-left mm: inside the inner frame
        (whose bottom IS the band top), with the ≥10mm pad. Matches page.ts
        drawAreaDims + sheet.ts (measured template, scaled proportionally)."""
        kx, ky = paper_w / 420.0, paper_h / 297.0
        x = SHEET_MARGIN_X * kx + SHEET_PAD_MM
        y = SHEET_MARGIN_TOP * ky + SHEET_PAD_MM
        w = paper_w - 2 * SHEET_MARGIN_X * kx - 2 * SHEET_PAD_MM
        h = paper_h - (SHEET_MARGIN_TOP + SHEET_BAND_MM) * ky - 2 * SHEET_PAD_MM
        return (x, y, w, h)

    def _sheet_chrome(self, layout: Any, paper_w: float, paper_h: float, scale_txt: str):
        """Draw the AMR frame + zone grid + bottom title band on `layout` at true
        paper mm (bottom-left, so top-left y flips through `fy`). Shared by the
        layout sheet and the BOM sheet(s) — mirrors web/src/model/sheet.ts. Returns
        (fy, line, text, center) so the caller can add a viewport or the BOM table."""
        sh = {"layer": "SHEET"}

        def fy(y_top: float) -> float:
            return paper_h - y_top

        def line(x1: float, y1: float, x2: float, y2: float) -> None:
            layout.add_line((x1, fy(y1)), (x2, fy(y2)), dxfattribs=sh)

        def rect(x: float, y: float, w: float, h: float) -> None:
            line(x, y, x + w, y); line(x, y + h, x + w, y + h)
            line(x, y, x, y + h); line(x + w, y, x + w, y + h)

        kx, ky = paper_w / 420.0, paper_h / 297.0  # the measured template is A3

        def text(s: str, x: float, y_base: float, h: float, anchor: str) -> None:
            if not s:
                return
            align = (ezdxf.enums.TextEntityAlignment.BOTTOM_CENTER if anchor == "middle"
                     else ezdxf.enums.TextEntityAlignment.BOTTOM_LEFT)
            # h is a CAP height (the template's measured DXF unit) — used directly.
            t = layout.add_text(s, dxfattribs={"layer": "SHEET",
                                               "height": h,
                                               "style": TEXT_STYLE})
            t.set_placement((x, fy(y_base)), align=align)

        # template-space helpers: coordinates in measured-A3 mm, scaled to the page
        def tline(x1: float, y1: float, x2: float, y2: float) -> None:
            line(x1 * kx, y1 * ky, x2 * kx, y2 * ky)

        def ttext(s: str, x: float, y_base: float, h: float, anchor: str) -> None:
            text(s, x * kx, y_base * ky, h * ky, anchor)

        def tlabel(x: float, y: float, s: str) -> None:  # box top-left corner label
            ttext(s, x + 0.6, y + 2.12, H_LABEL, "start")

        def tcenter(x1: float, x2: float, y_base: float, s: str, h: float) -> None:
            ttext(s, (x1 + x2) / 2, y_base, h, "middle")

        # paper-space center-in-box (kept for the BOM table caller; h = CAP height)
        def center(x: float, y: float, w: float, h_box: float, s: str, h: float = 3.0) -> None:
            text(s, x + w / 2, y + h_box / 2 + h * 0.35, h, "middle")

        p = self.model.get("project", {})
        g = lambda k: str(p.get(k) or "")          # blank when unset (never invented)
        dash = lambda k: str(p.get(k) or "-")

        # ── paper edge + inner frame (band sits below the frame, to the edge) ──
        rect(0, 0, paper_w, paper_h)
        tline(SHEET_MARGIN_X, SHEET_MARGIN_TOP, 415.01, SHEET_MARGIN_TOP)
        tline(SHEET_MARGIN_X, BAND_Y, 415.01, BAND_Y)
        tline(SHEET_MARGIN_X, SHEET_MARGIN_TOP, SHEET_MARGIN_X, BAND_Y)
        tline(415.01, SHEET_MARGIN_TOP, 415.01, BAND_Y)

        # ── zone grid: numbers 1..10 top only; letters A..F on BOTH sides ─────
        for x in SHEET_COL_TICKS:
            tline(x, 0, x, SHEET_MARGIN_TOP)
        col_edges = [0.0, *SHEET_COL_TICKS, 420.0]
        for c in range(10):
            tcenter(col_edges[c], col_edges[c + 1], 3.72, str(c + 1), SHEET_ZONE_H)
        for y in SHEET_ROW_TICKS:
            tline(0, y, SHEET_MARGIN_X, y)
            tline(415.01, y, 420, y)
        row_edges = [SHEET_MARGIN_TOP, *SHEET_ROW_TICKS, BAND_Y]
        for r in range(6):
            y_base = (row_edges[r] + row_edges[r + 1]) / 2 + SHEET_ZONE_H * 0.45
            ttext(chr(65 + r), SHEET_MARGIN_X / 2, y_base, SHEET_ZONE_H, "middle")
            ttext(chr(65 + r), (415.01 + 420) / 2, y_base, SHEET_ZONE_H, "middle")

        # ── title band (full width, y BAND_Y → paper bottom) ──────────────────
        tline(0, BAND_Y, 420, BAND_Y)
        for x in [REF_SPLIT, REF_X2, *REV_COLS, DESIGNER_X2]:
            tline(x, BAND_Y, x, 297)
        # ref + rev tables share the 8 rows
        for y in BAND_ROW_YS:
            tline(0, y, REF_X2, y)
            tline(REV_COLS[0], y, REV_COLS[-1], y)
        tcenter(0, REF_SPLIT, 295.6, "REFERENCE DRAWING NO.", H_LABEL)
        tcenter(REF_SPLIT, REF_X2, 295.6, "DESCRIPTION", H_LABEL)
        tlabel(REMARK_X1, BAND_Y + 0.9, "REMARK")
        # revision table: headers on the bottom row; newest revision fills the row above
        rev_head = ["REV.", "DATE", "DESCRIPTION", "BY", "CHK", "ENG", "APPR"]
        rev_vals = [g("rev"), g("date"), g("rev_desc"), dash("by"), dash("chk"), dash("eng"), dash("appr")]
        for c in range(7):
            tcenter(REV_COLS[c], REV_COLS[c + 1], 295.56, rev_head[c], H_LABEL)
            if c == 2:
                ttext(rev_vals[c], REV_COLS[c] + 1.9, 292.01, H_REVVAL, "start")  # description: left-aligned
            else:
                tcenter(REV_COLS[c], REV_COLS[c + 1], 292.01, rev_vals[c], H_REVVAL)
        # designer / client / title
        tlabel(DESIGNER_X1, BAND_Y, "DESIGNER:")
        tcenter(DESIGNER_X1, DESIGNER_X2, 280, g("designer"), H_TITLE2)
        tline(DESIGNER_X2, CLIENT_SPLIT_Y, 420, CLIENT_SPLIT_Y)
        tline(DESIGNER_X1, DESIGNER_Y2, 420, DESIGNER_Y2)
        tlabel(DESIGNER_X2, BAND_Y, "CLIENT:")
        tcenter(DESIGNER_X2, 420, 275.5, g("client"), H_TITLE2)
        tlabel(DESIGNER_X2, CLIENT_SPLIT_Y, "TITLE:")
        tcenter(DESIGNER_X2, 420, 282.94, g("name"), H_TITLE)
        tcenter(DESIGNER_X2, 420, 286.21, g("title2"), H_TITLE2)
        # bottom strip: SCALE · PROJECT NO. · DRAWING NO. · SHEET · REV.
        tline(STRIP_COLS[0], STRIP_LABEL_Y, 420, STRIP_LABEL_Y)
        strip_head = ["SCALE", "PROJECT NO.", "DRAWING NO.", "SHEET", "REV."]
        strip_vals = [scale_txt, g("project_no"), g("drawing_no"), g("sheet_no"), dash("rev")]
        strip_val_h = [H_CELLVAL, H_CELLVAL, H_CELLVAL, H_SHEETVAL, H_CELLVAL]
        for c in range(5):
            if c:
                tline(STRIP_COLS[c], STRIP_Y1, STRIP_COLS[c], 297)
            tcenter(STRIP_COLS[c], STRIP_COLS[c + 1], 290.43, strip_head[c], H_LABEL)
            tcenter(STRIP_COLS[c], STRIP_COLS[c + 1], 294.73, strip_vals[c], strip_val_h[c])

        return fy, line, text, center

    def _paper_sheet(self, paper_w: float = 420.0, paper_h: float = 297.0) -> None:
        """An A3-landscape layout tab: the AMR sheet template with a viewport onto
        the plate at the nearest standard scale. Model space is untouched."""
        layout = self.doc.layouts.new("A3 SHEET")
        layout.page_setup(size=(int(paper_w), int(paper_h)), margins=(0, 0, 0, 0), units="mm")
        draw_x, draw_y, draw_w, draw_h = self._draw_area(paper_w, paper_h)

        # viewport scale: smallest standard 1:N that fits the draw area (real mm)
        plate_w = float(self.model["plate"]["width_mm"])
        n_horiz = sum(1 for d in self.model.get("ducts", []) if float(d.get("rot_deg", 0)) % 180 == 0)
        content_w = plate_w + (90.0 if n_horiz >= 2 else 0.0)  # rows.ts ROW_DIM_MARGIN_MM
        content_h = self.plate_h
        need = max(content_w / draw_w, content_h / draw_h)
        n_std = next((n for n in STD_SCALES if n >= need), STD_SCALES[-1])

        fy, _line, _text, _center = self._sheet_chrome(layout, paper_w, paper_h, f"1:{n_std:g}")

        # the viewport: paper size = real/N, showing the plate (+ row dims) centred
        vp_w, vp_h = content_w / n_std, content_h / n_std
        vp_cx = draw_x + draw_w / 2
        vp_cy_top = draw_y + draw_h / 2
        # model-space coords (already flipped/scaled by _to_dxf conventions)
        view_cx = content_w * self.scale / 2
        view_cy = self.plate_h * self.scale / 2
        layout.add_viewport(
            center=(vp_cx, fy(vp_cy_top)),
            size=(vp_w, vp_h),
            view_center_point=(view_cx, view_cy),
            view_height=content_h * self.scale,
        )

    def _bom_sheets(self, paper_w: float = 420.0, paper_h: float = 297.0) -> None:
        """One or more BOM layout tabs ("BOM", or "BOM 1".."BOM N" when paginated):
        the AMR sheet template with the Bill-of-Materials table laid out in the draw
        area. Mirrors web/src/model/bomsheet.ts. No BOM rows → no tab."""
        rows_in = self.bom
        if not rows_in:
            return
        draw_x, draw_y, draw_w, draw_h = self._draw_area(paper_w, paper_h)
        table_w = BOM_TABLE_W_FRAC * draw_w
        table_x = draw_x + (draw_w - table_w) / 2
        col_w = [f * table_w for f in BOM_COL_F]
        col_x = [table_x]
        for w in col_w:
            col_x.append(col_x[-1] + w)
        table_top = draw_y + 10          # heading sits above the table
        bottom = draw_y + draw_h

        # wrap every row up front so pagination sees real heights
        wrapped: list[tuple[list[list[str]], float]] = []
        for r in rows_in:
            cells_raw = [
                _bom_dash(r.get("item_no")),
                _bom_dash(r.get("description")) + (" *" if r.get("confirm") else ""),
                _bom_dash(r.get("manufacturer")),
                _bom_dash(r.get("model")),
                str(r.get("qty", 0)),
            ]
            cells = [_wrap_cell(s, col_w[c]) for c, s in enumerate(cells_raw)]
            n = max(len(c) for c in cells)
            wrapped.append((cells, n * BOM_LINE_H + 2.4))

        # paginate: header repeats per page (no Total-parts row — matches bomsheet.ts)
        pages: list[list[tuple[list[list[str]], float]]] = [[]]
        y = table_top + BOM_HEAD_H
        for cells, h in wrapped:
            if y + h > bottom and pages[-1]:
                pages.append([])
                y = table_top + BOM_HEAD_H
            pages[-1].append((cells, h))
            y += h
        n_pages = len(pages)

        for pi, page_rows in enumerate(pages):
            name = "BOM" if n_pages == 1 else f"BOM {pi + 1}"
            layout = self.doc.layouts.new(name)
            layout.page_setup(size=(int(paper_w), int(paper_h)), margins=(0, 0, 0, 0), units="mm")
            _fy, line, text, center = self._sheet_chrome(layout, paper_w, paper_h, "-")

            # heading — just the title (no page counter, even across "BOM 1".."BOM N")
            text(BOM_HEADING, draw_x + draw_w / 2, draw_y + 6, 4.5 * ARIAL_CAP_PER_EM, "middle")  # em-spec -> cap

            # header row
            ry = table_top
            for c, head in enumerate(BOM_COL_HEAD):
                center(col_x[c], ry, col_w[c], BOM_HEAD_H, head, BOM_HEAD_FONT * ARIAL_CAP_PER_EM)
            ry += BOM_HEAD_H
            line(col_x[0], table_top + BOM_HEAD_H, col_x[5], table_top + BOM_HEAD_H)

            # data rows
            for cells, h in page_rows:
                for c in range(5):
                    lines_c = cells[c]
                    block_h = (len(lines_c) - 1) * BOM_LINE_H
                    base = ry + h / 2 - block_h / 2 + BOM_FONT * 0.35
                    for s in lines_c:
                        if s:
                            if BOM_COL_CENTER[c]:
                                text(s, col_x[c] + col_w[c] / 2, base, BOM_FONT * ARIAL_CAP_PER_EM, "middle")
                            else:
                                text(s, col_x[c] + 1.5, base, BOM_FONT * ARIAL_CAP_PER_EM, "start")
                        base += BOM_LINE_H
                ry += h
                line(col_x[0], ry, col_x[5], ry)

            # table outline + column separators (span header → last row on this page)
            line(col_x[0], table_top, col_x[5], table_top)
            for c in range(6):
                line(col_x[c], table_top, col_x[c], ry)

    def build(self) -> ezdxf.document.Drawing:
        p = self.model["plate"]
        self._rect(0, 0, float(p["width_mm"]), float(p["height_mm"]), "PLATE")
        for d in self.model.get("ducts", []):
            self._place_duct(d)
        for g in self.model.get("groups", []):
            self._place_group(g)
        for e in self.model.get("elements", []):
            self._place_element(e)
        for l in self.model.get("labels", []):
            self._place_label(l)
        self._row_dims()
        self._paper_sheet()  # A3 layout tab: frame + title block + viewport
        self._bom_sheets()   # BOM layout tab(s): frame + title block + BOM table
        return self.doc


def assemble(model: dict[str, Any], library: dict[str, Any], scale: float = 1.0,
             bom: list[dict[str, Any]] | None = None):
    return DxfAssembler(model, library, scale, bom).build()
