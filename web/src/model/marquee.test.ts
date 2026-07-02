import { describe, it, expect } from "vitest";
import { marqueeSelect, selectRow } from "./marquee";
import type { Element, Group, Label, Library, LayoutModel } from "./types";

const LIB: Library = {
  relay: { lib_key: "relay", source: "rect", name: "Relay", band: 3, width_mm: 15.5, height_mm: 80 },
  term: { lib_key: "term", source: "rect", name: "DS2.5", band: 4, width_mm: 5.2, height_mm: 50 },
};

function el(id: string, x: number, y = 100): Element {
  return { id, lib_key: "relay", tag: "", x_mm: x, y_mm: y, rot_deg: 0,
    gap_before_mm: 0.1, clearance_to_duct_mm: 3, group_id: null, locked: false };
}
function grp(id: string, x: number, y = 115): Group {
  return { id, kind: "set", lib_key: "term", count: 4, internal_gap_mm: 0.1,
    tag_start: null, tag_step: 1, x_mm: x, y_mm: y, rot_deg: 0, exploded: false, label_id: null };
}
const label = (id: string, anchor: string): Label => ({ id, text: "24VDC", anchor: anchor as Label["anchor"], dx_mm: 0, dy_mm: -8, rot_deg: 0 });

// relay rail = y+40; term set at y=115 rail = 140 → same row as relays at y=100
function model(): LayoutModel {
  return {
    project: { id: "p", name: "T", panel_tag: "", rev: "A" },
    plate: { width_mm: 800, height_mm: 1000, origin: "top_left" },
    defaults: { gap_between_equipment_mm: 0.1, clearance_equipment_to_duct_mm: 3 },
    ducts: [{ id: "D1", x_mm: 0, y_mm: 90, length_mm: 800, width_mm: 40, label_h_mm: 60, rot_deg: 0 }],
    elements: [el("a", 100), el("b", 130), el("far", 100, 500)],
    groups: [grp("s1", 160)],
    labels: [label("L1", "element:a")],
    display: { show_row_clearance_dims: true, snap_enabled: true },
  };
}

describe("marqueeSelect", () => {
  it("left→right (window): only fully-inside devices; ducts never selected", () => {
    // box fully covering 'a' (100..115.5 × 100..180) + its label ("24VDC" ≈ 31mm wide),
    // clipping 'b' (130..145.5) — window must take a+L1 and skip b
    const sels = marqueeSelect(model(), LIB, 95, 85, 135, 190);
    expect(sels.map((s) => s.id).sort()).toEqual(["L1", "a"]);
    expect(sels.some((s) => s.id === "b")).toBe(false);
    expect(sels.some((s) => s.id === "D1")).toBe(false);
  });

  it("window mode excludes partially-covered devices", () => {
    // box clips 'b' halfway → window must NOT take it
    const sels = marqueeSelect(model(), LIB, 95, 85, 137, 190);
    expect(sels.some((s) => s.id === "b")).toBe(false);
  });

  it("right→left (crossing): touching counts, sets included", () => {
    // same clipping box but dragged right→left → crossing takes 'b' and the set edge
    const sels = marqueeSelect(model(), LIB, 165, 190, 95, 85);
    const ids = sels.map((s) => s.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("s1"); // box touches the set's left edge at 160..165
  });

  it("never selects devices in other rows outside the box", () => {
    const sels = marqueeSelect(model(), LIB, 0, 0, 800, 300);
    expect(sels.some((s) => s.id === "far")).toBe(false);
  });
});

describe("selectRow", () => {
  it("grabs every device sharing the anchor's rail line, plus their labels", () => {
    const sels = selectRow(model(), LIB, { id: "b", kind: "element" });
    expect(sels.map((s) => s.id).sort()).toEqual(["L1", "a", "b", "s1"]);
    expect(sels.some((s) => s.id === "far")).toBe(false); // other row
    expect(sels.some((s) => s.id === "D1")).toBe(false);  // ducts excluded
  });

  it("works from a set anchor too", () => {
    const sels = selectRow(model(), LIB, { id: "s1", kind: "group" });
    expect(sels.map((s) => s.id).sort()).toEqual(["L1", "a", "b", "s1"]);
  });
});
