"""Verification harness for the assembler (runs locally AND in CI).

Self-contained: it builds a synthetic equipment DXF in memory (no external file),
uploads it, and exercises the real assembler paths — rect/symbol geometry, an
UPLOADED DXF re-embedded as a block INSERT placed at rot 0 and rot 90 (the
rotated-anchor fix), a labelled stopper WIPEOUT, in-place set auto-numbering, and
a set with rail-aligned start/end caps. Writes out_service.dxf (+ .svg), audits it,
and asserts placement.
"""
from __future__ import annotations

import io
from collections import Counter

import ezdxf
from ezdxf import bbox
from ezdxf.addons.drawing import RenderContext, Frontend, layout as dlayout
from ezdxf.addons.drawing import svg as ezsvg

import dxf_build
import dxf_upload


def _sample_dxf(w: float = 70.0, h: float = 100.0) -> bytes:
    """A synthetic equipment DXF (mm) — a body rectangle with a little internal
    detail, so the re-embedded block carries several entities. Extents = w × h."""
    doc = ezdxf.new("R2018", setup=True)
    doc.units = ezdxf.units.MM
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (w, 0), (w, h), (0, h), (0, 0)])
    msp.add_circle((w * 0.3, h * 0.7), 6)
    msp.add_circle((w * 0.7, h * 0.7), 6)
    msp.add_line((5, h * 0.3), (w - 5, h * 0.3))
    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")


# 1) upload the synthetic part -> measured size + a retained block_ref
up = dxf_upload.process_upload(_sample_dxf())
print("UPLOAD:", up["confirm_message"], "units:", up["units"])
assert up["ok"] and up["units_confirmed"], "sample should be mm and parse cleanly"
part_w, part_h, block_ref = up["width_mm"], up["height_mm"], up["block_ref"]
assert abs(part_w - 70) < 0.1 and abs(part_h - 100) < 0.1, f"measured {part_w}x{part_h}"

# 2) a library: the uploaded part as a dxf block; the rest as rects
library = {
    "plc_sample": {"source": "dxf", "name": "PLC (sample)",
                   "width_mm": part_w, "height_mm": part_h, "block_ref": block_ref},
    "psu_switching_24vdc": {"source": "rect", "name": "PSU 24VDC", "width_mm": 40, "height_mm": 110},
    "term_degson_2c_2_5": {"source": "rect", "name": "Degson 2C", "width_mm": 5.2, "height_mm": 50},
    "cust1": {"source": "rect", "name": "ACME-9", "width_mm": 60, "height_mm": 40, "custom": True},
    "stop_blue": {"source": "rect", "name": "Stopper", "width_mm": 8, "height_mm": 35},
    "lbl_x": {"source": "rect", "name": "", "width_mm": 8, "height_mm": 35, "label_plate": True},
    # end cover for the capped-set case (shorter than the terminal, own rail line)
    "cover": {"source": "rect", "name": "D-DS2.5", "width_mm": 2.2, "height_mm": 43.2, "rail_offset_mm": 21.6},
}

# 3) a tall-enclosure demo model (mirrors the web demo)
SD = 60.0
PLATE_W, PLATE_H = 800.0, 1500.0
model = {
    "project": {"name": "Service Test"},
    "plate": {"width_mm": PLATE_W, "height_mm": PLATE_H, "origin": "top_left"},
    "ducts": [
        {"id": "WW_L", "x_mm": 0, "y_mm": 0, "length_mm": PLATE_H, "width_mm": SD, "label_h_mm": 60, "rot_deg": 90},
        {"id": "WW_R", "x_mm": PLATE_W - SD, "y_mm": 0, "length_mm": PLATE_H, "width_mm": SD, "label_h_mm": 60, "rot_deg": 90},
        {"id": "WW_top", "x_mm": SD, "y_mm": 110, "length_mm": PLATE_W - 2 * SD, "width_mm": 40, "label_h_mm": 60, "rot_deg": 0},
    ],
    "elements": [
        {"id": "e_plc0", "lib_key": "plc_sample", "tag": "PLC01", "x_mm": SD + 10, "y_mm": 170, "rot_deg": 0,
         "gap_before_mm": 0.1, "clearance_to_duct_mm": 3, "group_id": None, "locked": False},
        {"id": "e_plc90", "lib_key": "plc_sample", "tag": "PLC02", "x_mm": SD + 200, "y_mm": 170, "rot_deg": 90,
         "gap_before_mm": 0.1, "clearance_to_duct_mm": 3, "group_id": None, "locked": False},
        {"id": "e_psu", "lib_key": "psu_switching_24vdc", "tag": "PS01", "x_mm": SD + 400, "y_mm": 170, "rot_deg": 0,
         "gap_before_mm": 0.1, "clearance_to_duct_mm": 3, "group_id": None, "locked": False},
        {"id": "e_cust", "lib_key": "cust1", "tag": "U1", "x_mm": SD + 500, "y_mm": 320, "rot_deg": 0,
         "gap_before_mm": 0.1, "clearance_to_duct_mm": 3, "group_id": None, "locked": False},
        # a stopper + coincident label plate (locked pair): geometry should be masked
        {"id": "e_stop", "lib_key": "stop_blue", "tag": None, "x_mm": SD + 600, "y_mm": 170, "rot_deg": 0,
         "gap_before_mm": 0.1, "clearance_to_duct_mm": 3, "group_id": None, "locked": False, "pair_id": "ps1"},
        {"id": "e_lbl", "lib_key": "lbl_x", "tag": "X1", "x_mm": SD + 600, "y_mm": 170, "rot_deg": 0,
         "gap_before_mm": 0.1, "clearance_to_duct_mm": 3, "group_id": None, "locked": False, "pair_id": "ps1"},
    ],
    "groups": [
        {"id": "g_term", "kind": "set", "lib_key": "term_degson_2c_2_5", "count": 12,
         "internal_gap_mm": 0.1, "x_mm": SD + 10, "y_mm": 320, "rot_deg": 0,
         "tag_start": "B101", "tag_step": 1,
         "cap_start_key": "cover", "cap_end_key": "cover"},
    ],
    "labels": [
        {"id": "L1", "text": "24VDC", "anchor": "group:g_term", "dx_mm": 0, "dy_mm": -6, "rot_deg": 0},
    ],
}

# 4) assemble at 1:1, save, audit
doc = dxf_build.assemble(model, library, scale=1.0)
doc.saveas("out_service.dxf")
auditor = doc.audit()
print("AUDIT errors:", len(auditor.errors))
assert not auditor.errors, "assembled DXF must audit clean"

# 5) every part is now a named block (EQ_<lib_key>) so CAD can Count Block
msp = doc.modelspace()
all_inserts = [e for e in msp if e.dxftype() == "INSERT"]
by_block = Counter(e.dxf.name for e in all_inserts)
print("BLOCK INSERTS:", dict(by_block))
assert by_block["EQ_plc_sample"] == 2, "two uploaded-part placements"
assert by_block["EQ_psu_switching_24vdc"] == 1, "a rect part is a countable block"
assert by_block["EQ_term_degson_2c_2_5"] == 12, "each set member is a countable block"
assert by_block["EQ_cust1"] == 1, "a custom placeholder is its own countable block"
texts = [e.dxf.text for e in msp if e.dxftype() == "TEXT"]
assert "ACME-9" in texts, "custom part-no drawn centered inside the box"

# a labelled stopper masks its own geometry with exactly one WIPEOUT, and the
# marker text is still drawn (on top of the mask)
wipeouts = [e for e in msp if e.dxftype() == "WIPEOUT"]
assert len(wipeouts) == 1, f"one wipeout for the labelled stopper, got {len(wipeouts)}"
assert "X1" in texts, "the label marker reads over the masked stopper"
print("OK: labelled stopper masked by 1 wipeout, marker 'X1' on top")

# a SET auto-numbers its members in place (no explode needed): B101..B112
assert "B101" in texts and "B112" in texts, "set members are auto-tagged B101..B112"
print("OK: un-exploded set is auto-numbered B101..B112")

# the set's start/end caps are placed as their own countable blocks, rail-aligned
assert by_block["EQ_cover"] == 2, "one end cover per side of the capped set"
covers = [e for e in all_inserts if e.dxf.name == "EQ_cover"]
terms = [e for e in all_inserts if e.dxf.name == "EQ_term_degson_2c_2_5"]
# rail line (editor coords): members y=320 h=50 rail=345; cover rail_offset 21.6 →
# cover top = 345-21.6 = 323.4 → DXF lower-left y = plate_h - (323.4 + 43.2)
cover_ll_y = PLATE_H - (320 + 25 + 21.6)  # = plate_h - top - height, expanded
for c in covers:
    ext = bbox.extents([c], fast=False)
    assert abs(ext.extmin.y - cover_ll_y) < 0.1, f"cover not rail-aligned: {ext.extmin.y} vs {cover_ll_y}"
# start cap sits left of the first member
first_term_x = min(bbox.extents([t], fast=False).extmin.x for t in terms)
start_cap_x = min(bbox.extents([c], fast=False).extmin.x for c in covers)
assert start_cap_x < first_term_x, "start cap left of the members"
print("OK: capped set — 2 cover blocks, rail-aligned, flanking the members")

# the two uploaded-part INSERTs must NOT overlap (rotated-anchor fix)
plc = [e for e in all_inserts if e.dxf.name == "EQ_plc_sample"]
boxes = []
for ins in plc:
    ext = bbox.extents([ins], fast=False)
    boxes.append((ins.dxf.rotation, ext.extmin, ext.extmax))
    print(f"  PLC rot={ins.dxf.rotation:>3.0f} ll=({ext.extmin.x:.1f},{ext.extmin.y:.1f}) "
          f"size={ext.size.x:.1f}x{ext.size.y:.1f}")
assert len(plc) == 2
(_, amin, amax), (_, bmin, bmax) = boxes[0], boxes[1]
overlap = amin.x < bmax.x and amax.x > bmin.x and amin.y < bmax.y and amax.y > bmin.y
assert not overlap, "the two placements must NOT overlap (rotated-anchor fix)"
print("OK: no overlap between rot0 and rot90 placements")

# 6) verify rot=90 footprint swapped W x H
rot90 = next(b for b in boxes if b[0] == 90)
sw, sh = rot90[2].x - rot90[1].x, rot90[2].y - rot90[1].y
assert abs(sw - part_h) < 0.5 and abs(sh - part_w) < 0.5, "rot90 must swap W x H"
print(f"OK: rot90 footprint {sw:.1f}x{sh:.1f} == swapped {part_h:.1f}x{part_w:.1f}")

# 7) also dump an SVG of the result for eyeballing
backend = ezsvg.SVGBackend()
Frontend(RenderContext(doc), backend).draw_layout(msp)
page = dlayout.Page(0, 0, dlayout.Units.mm, margins=dlayout.Margins.all(0))
open("out_service.svg", "w", encoding="utf-8").write(backend.get_string(page))
print("wrote out_service.dxf + out_service.svg")
print("ALL ASSERTIONS PASSED")
