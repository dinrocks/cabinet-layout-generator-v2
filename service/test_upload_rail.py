"""Rail-datum-from-origin capture in process_upload (run with the service venv:
python test_upload_rail.py)."""
from __future__ import annotations

import io

import ezdxf

import dxf_upload


def _dxf(x0: float, y0: float, x1: float, y1: float) -> bytes:
    """A DXF (mm) holding one rectangle from (x0,y0) to (x1,y1)."""
    doc = ezdxf.new("R2018", setup=True)
    doc.units = ezdxf.units.MM
    doc.header["$INSUNITS"] = 4
    doc.modelspace().add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)])
    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")


# origin at the BOTTOM: rect (0,0)-(30,100) → top is 100 above y=0 → rail offset 100
up = _dxf(0, 0, 30, 100)
r = dxf_upload.process_upload(up)
assert r["ok"] and r["rail_from_origin"], r
assert abs(r["rail_offset_mm"] - 100) < 0.1, r["rail_offset_mm"]
print("OK: origin at bottom -> rail offset = full height (rail at the bottom edge)")

# origin at the CENTRE: rect (0,-50)-(30,50) → top 50 above 0 → rail offset 50 (== h/2)
r = dxf_upload.process_upload(_dxf(0, -50, 30, 50))
assert r["rail_from_origin"] and abs(r["rail_offset_mm"] - 50) < 0.1, r
print("OK: origin at centre -> rail offset = half height")

# origin at a rail 7.5mm above the bottom: rect (0,-7.5)-(30,92.5) → rail offset 92.5
r = dxf_upload.process_upload(_dxf(0, -7.5, 30, 92.5))
assert abs(r["rail_offset_mm"] - 92.5) < 0.1, r["rail_offset_mm"]
print("OK: origin at the rail line -> rail offset = top-to-rail distance")

# drawn FAR from 0,0 (origin not a datum): rect (0,500)-(30,600) → fall back to centre
r = dxf_upload.process_upload(_dxf(0, 500, 30, 600))
assert not r["rail_from_origin"] and r["rail_offset_mm"] is None, r
print("OK: origin outside the outline -> null (editor defaults to centre)")

print("ALL RAIL-CAPTURE ASSERTIONS PASSED")
