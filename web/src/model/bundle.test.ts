import { describe, it, expect } from "vitest";
import { bundleParts, partFileName } from "./bundle";
import { newModel } from "./factory";
import type { Library, LayoutModel } from "./types";

const dxf = (lib_key: string, name: string, block_ref: string) => ({
  lib_key, source: "dxf" as const, name, width_mm: 10, height_mm: 10, block_ref, svg_ref: "<svg/>",
});
const library: Library = {
  plc: dxf("plc", "IDEC FC6A", "blk_plc"),
  psu: dxf("psu", "PSU 24VDC", "blk_psu"),
  term: dxf("term", "Degson 2C", "blk_term"),
  cover: dxf("cover", "D-DS2.5", "blk_cover"),
  rect1: { lib_key: "rect1", source: "rect", name: "Custom box", width_mm: 60, height_mm: 60, custom: true },
  unplaced: dxf("unplaced", "Spare part", "blk_spare"),
};

function modelWith(over: Partial<LayoutModel>): LayoutModel {
  return { ...newModel("Bundle test"), ...over };
}

const el = (id: string, lib_key: string) => ({
  id, lib_key, tag: "", x_mm: 0, y_mm: 0, rot_deg: 0,
  gap_before_mm: 0.1, clearance_to_duct_mm: 3, group_id: null, locked: false,
});

describe("bundleParts", () => {
  it("collects placed DXF parts from elements, sets and caps — deduped", () => {
    const m = modelWith({
      elements: [el("e1", "plc"), el("e2", "plc"), el("e3", "psu"), el("e4", "rect1")],
      groups: [{
        id: "g1", kind: "set", lib_key: "term", count: 12, internal_gap_mm: 0.1,
        x_mm: 0, y_mm: 0, rot_deg: 0, tag_start: "B101", tag_step: 1,
        cap_start_key: "cover", cap_end_key: "cover", exploded: false, label_id: null,
      }],
    });
    const parts = bundleParts(m, library);
    expect(parts.map((p) => p.lib_key)).toEqual(["plc", "psu", "term", "cover"]);
    expect(parts.every((p) => p.block_ref.startsWith("blk_"))).toBe(true);
  });

  it("skips rect/custom parts and unplaced library entries", () => {
    const m = modelWith({ elements: [el("e1", "rect1")] });
    expect(bundleParts(m, library)).toEqual([]); // rect placed, DXF 'unplaced' not placed
  });

  it("tolerates unresolved lib keys (validation flags them elsewhere)", () => {
    const m = modelWith({ elements: [el("e1", "ghost")] });
    expect(bundleParts(m, library)).toEqual([]);
  });

  it("partFileName is ZIP-safe and unique enough", () => {
    expect(partFileName({ lib_key: "plc", name: "IDEC FC6A-D16R1CEE (24V)", block_ref: "b" }))
      .toBe("parts/IDEC_FC6A-D16R1CEE_24V.dxf");
    expect(partFileName({ lib_key: "k1", name: "", block_ref: "b" })).toBe("parts/k1.dxf");
  });
});
