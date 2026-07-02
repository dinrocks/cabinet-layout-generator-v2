import { describe, it, expect } from "vitest";
import { insertBeside } from "./insert";
import type { Element, Group, Library, LayoutModel } from "./types";

const LIB: Library = {
  relay: { lib_key: "relay", source: "rect", name: "Relay", band: 3, width_mm: 15.5, height_mm: 80 },
  term: { lib_key: "term", source: "rect", name: "DS2.5", band: 4, width_mm: 5.2, height_mm: 50 },
  conv: { lib_key: "conv", source: "rect", name: "Converter", band: 2, width_mm: 20, height_mm: 80 },
};

function el(id: string, x: number, over: Partial<Element> = {}): Element {
  return { id, lib_key: "relay", tag: "", x_mm: x, y_mm: 100, rot_deg: 0,
    gap_before_mm: 0.1, clearance_to_duct_mm: 3, group_id: null, locked: false, ...over };
}
function grp(id: string, x: number): Group {
  return { id, kind: "set", lib_key: "term", count: 4, internal_gap_mm: 0.1,
    tag_start: null, tag_step: 1, x_mm: x, y_mm: 115, rot_deg: 0, exploded: false, label_id: null };
}
// relay rail = 100+40 = 140; terms at y 115 rail = 115+25 = 140 → same row
function model(): LayoutModel {
  return {
    project: { id: "p", name: "T", panel_tag: "", rev: "A" },
    plate: { width_mm: 800, height_mm: 1000, origin: "top_left" },
    defaults: { gap_between_equipment_mm: 0.1, clearance_equipment_to_duct_mm: 3 },
    ducts: [],
    elements: [
      el("a", 100),               // 100..115.5
      el("b", 130),               // 130..145.5 (deliberate cluster gap after a)
      el("far", 100, { y_mm: 500 }), // another row — must never move
    ],
    groups: [grp("s1", 160)],     // 160..181.1 in the same row
    labels: [],
    display: { show_row_clearance_dims: true, snap_enabled: true },
  };
}

describe("insertBeside", () => {
  it("right of an element: opens the gap downstream only, preserves cluster spacing", () => {
    const r = insertBeside(model(), LIB, { kind: "element", id: "a" }, "right", "conv", 1)!;
    const m = r.model;
    const ins = m.elements.find((e) => e.id === r.ids[0])!;
    expect(ins.x_mm).toBeCloseTo(115.5 + 0.1); // flush after the anchor + gap
    expect(ins.y_mm).toBeCloseTo(140 - 40);    // rail-aligned (conv rail = 40)
    const shift = 20 + 0.1;                    // inserted width + its gap
    expect(m.elements.find((e) => e.id === "a")!.x_mm).toBe(100);          // anchor unmoved
    expect(m.elements.find((e) => e.id === "b")!.x_mm).toBeCloseTo(130 + shift); // cluster gap preserved
    expect(m.groups.find((g) => g.id === "s1")!.x_mm).toBeCloseTo(160 + shift);  // set shifts whole
    expect(m.elements.find((e) => e.id === "far")!.x_mm).toBe(100);        // other row untouched
  });

  it("left of an element: anchor itself shifts right; upstream stays", () => {
    const r = insertBeside(model(), LIB, { kind: "element", id: "b" }, "left", "conv", 1)!;
    const m = r.model;
    const shift = 20 + 0.1;
    expect(m.elements.find((e) => e.id === "a")!.x_mm).toBe(100); // upstream never moves
    expect(m.elements.find((e) => e.id === "b")!.x_mm).toBeCloseTo(130 + shift);
    expect(m.elements.find((e) => e.id === r.ids[0])!.x_mm).toBeCloseTo(130); // in the anchor's old spot
  });

  it("works with a set as the anchor and inserts multiple copies", () => {
    const r = insertBeside(model(), LIB, { kind: "group", id: "s1" }, "right", "term", 3)!;
    const m = r.model;
    expect(r.ids).toHaveLength(3);
    const setRight = 160 + 4 * 5.2 + 3 * 0.1;
    expect(m.elements.find((e) => e.id === r.ids[0])!.x_mm).toBeCloseTo(setRight + 0.1);
    // nothing was right of the set, so only the inserts appear there
    expect(m.elements.find((e) => e.id === "b")!.x_mm).toBe(130);
  });

  it("honours locked elements (they keep their x, same as auto-pack)", () => {
    const m0 = model();
    m0.elements.push(el("lk", 200, { locked: true }));
    const r = insertBeside(m0, LIB, { kind: "element", id: "a" }, "right", "conv", 1)!;
    expect(r.model.elements.find((e) => e.id === "lk")!.x_mm).toBe(200);
  });

  it("returns null for an unknown part or anchor", () => {
    expect(insertBeside(model(), LIB, { kind: "element", id: "a" }, "right", "ghost", 1)).toBeNull();
    expect(insertBeside(model(), LIB, { kind: "element", id: "nope" }, "right", "conv", 1)).toBeNull();
  });
});
