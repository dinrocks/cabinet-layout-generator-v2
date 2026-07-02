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
}
TEXT_STYLE = "ARIAL"

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
    def __init__(self, model: dict[str, Any], library: dict[str, Any], scale: float = 1.0):
        self.model = model
        self.library = library
        self.scale = scale
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
        return self.doc


def assemble(model: dict[str, Any], library: dict[str, Any], scale: float = 1.0):
    return DxfAssembler(model, library, scale).build()
