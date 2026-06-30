import { describe, it, expect } from "vitest";
import { buildBom, bomToCsv } from "./bom";
import type { LayoutModel, Library, Element, Group } from "./types";

const LIB: Library = {
  psu: { lib_key: "psu", source: "rect", name: "PSU 24VDC", band: 1, width_mm: 40, height_mm: 110, confirm: true },
  relay: { lib_key: "relay", source: "rect", name: "Relay 24VDC", band: 3, width_mm: 15.5, height_mm: 80 },
  stop: { lib_key: "stop", source: "rect", name: "Stopper", band: 6, width_mm: 9.5, height_mm: 43.2 },
  // two per-instance label plates (unique keys, blank names) — must collapse to ONE line
  lbl1: { lib_key: "lbl1", source: "rect", name: "", label_plate: true, width_mm: 9.5, height_mm: 43.2 },
  lbl2: { lib_key: "lbl2", source: "rect", name: "", label_plate: true, width_mm: 9.5, height_mm: 43.2 },
  cust: { lib_key: "cust", source: "rect", name: "ACME-9", width_mm: 60, height_mm: 40, custom: true }, // no band
};

function el(id: string, lib_key: string): Element {
  return { id, lib_key, tag: "", x_mm: 0, y_mm: 0, rot_deg: 0, gap_before_mm: 0.1, clearance_to_duct_mm: 3, group_id: null, locked: false };
}
function set(id: string, lib_key: string, count: number): Group {
  return { id, kind: "set", lib_key, count, internal_gap_mm: 0.1, tag_start: null, tag_step: 1, x_mm: 0, y_mm: 0, rot_deg: 0, exploded: false, label_id: null };
}

function model(): LayoutModel {
  return {
    project: { id: "p", name: "T", panel_tag: "", rev: "A" },
    plate: { width_mm: 800, height_mm: 1000, origin: "top_left" },
    defaults: { gap_between_equipment_mm: 0.1, clearance_equipment_to_duct_mm: 3 },
    ducts: [],
    elements: [
      el("e_psu", "psu"),
      el("e_s1", "stop"), el("e_l1", "lbl1"),   // stopper + its label
      el("e_s2", "stop"), el("e_l2", "lbl2"),   // another stopper + label
      el("e_cust", "cust"),
    ],
    groups: [set("g_relay", "relay", 12)],      // a set of 12 counts as 12
    labels: [],
    display: { show_row_clearance_dims: true, snap_enabled: true },
  };
}

describe("buildBom", () => {
  it("counts elements (1 each) and sets (N), aggregating by part", () => {
    const bom = buildBom(model(), LIB);
    const qty = (name: string) => bom.rows.find((r) => r.name === name)?.qty;
    expect(qty("PSU 24VDC")).toBe(1);
    expect(qty("Relay 24VDC")).toBe(12);     // the set
    expect(qty("Stopper")).toBe(2);          // two stopper elements share one lib_key
    expect(qty("ACME-9")).toBe(1);           // custom part
  });

  it("collapses per-instance label plates into ONE line", () => {
    const bom = buildBom(model(), LIB);
    const labels = bom.rows.filter((r) => r.name === "Label for stopper");
    expect(labels).toHaveLength(1);
    expect(labels[0].qty).toBe(2);
    expect(labels[0].category).toBe("Labels");
    expect(labels[0].band).toBeNull();
  });

  it("groups by category, sorted by band with uncategorised last", () => {
    const bom = buildBom(model(), LIB);
    const cats = bom.rows.map((r) => r.category);
    // band 1 (Power & protection) before band 3 (Relays) before band 6 (Stopper);
    // the custom part (no band) → "Uncategorized" and labels sort after banded rows
    expect(cats[0]).toBe("Power & protection");
    expect(cats.indexOf("Relays")).toBeLessThan(cats.indexOf("Stopper"));
    expect(cats[cats.length - 1] === "Labels" || cats[cats.length - 1] === "Uncategorized").toBe(true);
  });

  it("surfaces the unconfirmed-estimate flag and totals all parts", () => {
    const bom = buildBom(model(), LIB);
    expect(bom.rows.find((r) => r.name === "PSU 24VDC")!.confirm).toBe(true);
    expect(bom.rows.find((r) => r.name === "Relay 24VDC")!.confirm).toBe(false);
    expect(bom.totalParts).toBe(1 + 12 + 2 + 2 + 1); // psu + relays + stoppers + labels + custom = 18
  });

  it("ignores unresolved lib_keys (validate() flags those separately)", () => {
    const m = model();
    m.elements.push(el("e_ghost", "does_not_exist"));
    const bom = buildBom(m, LIB);
    expect(bom.rows.some((r) => r.key === "does_not_exist")).toBe(false);
  });
});

describe("bomToCsv", () => {
  it("emits a header and a quoted, Excel-friendly row per part", () => {
    const csv = bomToCsv(buildBom(model(), LIB));
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("Category,Part,Qty,Width_mm,Height_mm,Unconfirmed");
    expect(lines.some((l) => l.startsWith("Power & protection,PSU 24VDC,1,40,110,yes"))).toBe(true);
    expect(lines.some((l) => l.includes("Label for stopper,2,"))).toBe(true);
  });
});
