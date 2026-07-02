import { describe, it, expect } from "vitest";
import { groupLayout } from "./sets";
import { explodeGroup } from "./edit";
import type { Group, Library, LayoutModel } from "./types";

// terminal 5.2×50 (rail at centre), end cover 2.2×43 with an explicit rail line
const LIB: Library = {
  term: { lib_key: "term", source: "rect", name: "DS2.5", band: 4, width_mm: 5.2, height_mm: 50 },
  cover: { lib_key: "cover", source: "rect", name: "D-DS2.5", band: 4, width_mm: 2.2, height_mm: 43, rail_offset_mm: 21.5 },
};

function grp(over: Partial<Group> = {}): Group {
  return {
    id: "g1", kind: "set", lib_key: "term", count: 3, internal_gap_mm: 0.1,
    tag_start: "1", tag_step: 1, x_mm: 100, y_mm: 200, rot_deg: 0,
    exploded: false, label_id: null, ...over,
  };
}

describe("groupLayout", () => {
  it("no caps → members only, old width formula", () => {
    const l = groupLayout(grp(), LIB)!;
    expect(l.pieces).toHaveLength(3);
    expect(l.pieces.every((p) => p.kind === "member")).toBe(true);
    expect(l.totalW).toBeCloseTo(3 * 5.2 + 2 * 0.1);
    expect(l.railY).toBeCloseTo(200 + 25); // member rail = h/2 default
  });

  it("caps flank the members and widen the run", () => {
    const l = groupLayout(grp({ cap_start_key: "cover", cap_end_key: "cover" }), LIB)!;
    expect(l.pieces.map((p) => p.kind)).toEqual(["cap_start", "member", "member", "member", "cap_end"]);
    expect(l.pieces[0].x_mm).toBe(100); // start cap sits at the group origin
    expect(l.pieces[1].x_mm).toBeCloseTo(100 + 2.2 + 0.1); // first member after cap+gap
    expect(l.totalW).toBeCloseTo(2.2 + 0.1 + (3 * 5.2 + 2 * 0.1) + 0.1 + 2.2);
  });

  it("caps are rail-aligned to the members (not top-aligned)", () => {
    const l = groupLayout(grp({ cap_end_key: "cover" }), LIB)!;
    const capPiece = l.pieces.find((p) => p.kind === "cap_end")!;
    // member rail = 200+25 = 225; cover rail offset 21.5 → cover top = 225-21.5
    expect(capPiece.y_mm).toBeCloseTo(225 - 21.5);
  });

  it("unresolved cap keys are skipped (validation flags them)", () => {
    const l = groupLayout(grp({ cap_start_key: "ghost" }), LIB)!;
    expect(l.pieces.map((p) => p.kind)).toEqual(["member", "member", "member"]);
  });
});

describe("explodeGroup with caps", () => {
  it("emits caps as untagged elements at their laid-out positions", () => {
    const m: LayoutModel = {
      project: { id: "p", name: "T", panel_tag: "", rev: "A" },
      plate: { width_mm: 800, height_mm: 1000, origin: "top_left" },
      defaults: { gap_between_equipment_mm: 0.1, clearance_equipment_to_duct_mm: 3 },
      ducts: [], elements: [], labels: [],
      groups: [grp({ cap_start_key: "cover", cap_end_key: "cover" })],
      display: { show_row_clearance_dims: true, snap_enabled: true },
    };
    const m2 = explodeGroup(m, "g1", LIB);
    expect(m2.groups).toHaveLength(0);
    expect(m2.elements).toHaveLength(5); // cover + 3 terminals + cover
    expect(m2.elements[0].lib_key).toBe("cover");
    expect(m2.elements[0].tag).toBe(""); // caps untagged
    expect(m2.elements[1].tag).toBe("1"); // members keep their auto-tags
    expect(m2.elements[3].tag).toBe("3");
    expect(m2.elements[4].lib_key).toBe("cover");
    // cap rail alignment carried through
    expect(m2.elements[0].y_mm).toBeCloseTo(225 - 21.5);
  });
});
