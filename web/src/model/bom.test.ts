import { describe, it, expect } from "vitest";
import { buildBom, bomToCsv, itemNo } from "./bom";
import type { LayoutModel, Library, Element, Group } from "./types";

const LIB: Library = {
  psu: {
    lib_key: "psu", source: "rect", name: "PSU", band: 1, width_mm: 40, height_mm: 110, confirm: true,
    description: "120W SINGLE OUTPUT SWITCHING POWER SUPPLY, 24VDC", manufacturer: "MEANWELL", model: "NDR-120-24",
  },
  relay: { lib_key: "relay", source: "rect", name: "Relay 24VDC", band: 3, width_mm: 15.5, height_mm: 80 },
  stop: { lib_key: "stop", source: "rect", name: "Stopper", band: 6, width_mm: 9.5, height_mm: 43.2 },
  // two per-instance label plates (unique keys, blank names) — must collapse to ONE line
  lbl1: { lib_key: "lbl1", source: "rect", name: "", label_plate: true, width_mm: 9.5, height_mm: 43.2 },
  lbl2: { lib_key: "lbl2", source: "rect", name: "", label_plate: true, width_mm: 9.5, height_mm: 43.2 },
  cust: { lib_key: "cust", source: "rect", name: "ACME-9", width_mm: 60, height_mm: 40, custom: true }, // no band
};

function el(id: string, lib_key: string, tag = ""): Element {
  return { id, lib_key, tag, x_mm: 0, y_mm: 0, rot_deg: 0, gap_before_mm: 0.1, clearance_to_duct_mm: 3, group_id: null, locked: false };
}
function set(id: string, lib_key: string, count: number, tag_start: string | null = null): Group {
  return { id, kind: "set", lib_key, count, internal_gap_mm: 0.1, tag_start, tag_step: 1, x_mm: 0, y_mm: 0, rot_deg: 0, exploded: false, label_id: null };
}

function model(): LayoutModel {
  return {
    project: { id: "p", name: "T", panel_tag: "", rev: "A" },
    plate: { width_mm: 800, height_mm: 1000, origin: "top_left" },
    defaults: { gap_between_equipment_mm: 0.1, clearance_equipment_to_duct_mm: 3 },
    ducts: [],
    elements: [
      el("e_psu", "psu", "PS01"),
      el("e_s1", "stop"), el("e_l1", "lbl1", "X1"),   // stopper (untagged) + its label marker
      el("e_s2", "stop"), el("e_l2", "lbl2", "X2"),   // another stopper + label marker
      el("e_cust", "cust", "U1"),
    ],
    groups: [set("g_relay", "relay", 12, "B101")],    // a set of 12, auto-tagged B101..B112
    labels: [],
    display: { show_row_clearance_dims: true, snap_enabled: true },
  };
}

const row = (bom: ReturnType<typeof buildBom>, key: string) => bom.rows.find((r) => r.key === key)!;

describe("buildBom", () => {
  it("counts elements (1 each) and sets (N), aggregating by part", () => {
    const bom = buildBom(model(), LIB);
    expect(row(bom, "psu").qty).toBe(1);
    expect(row(bom, "relay").qty).toBe(12);   // the set
    expect(row(bom, "stop").qty).toBe(2);     // two stopper elements share one lib_key
    expect(row(bom, "cust").qty).toBe(1);
  });

  it("collects each instance's tag into ITEM NO., expanding a set's auto-tags", () => {
    const bom = buildBom(model(), LIB);
    expect(itemNo(row(bom, "psu"))).toBe("PS01");
    const relayTags = row(bom, "relay").tags;
    expect(relayTags).toHaveLength(12);
    expect(relayTags[0]).toBe("B101");
    expect(relayTags[11]).toBe("B112");
    expect(itemNo(row(bom, "stop"))).toBe("-"); // untagged stoppers
  });

  it("collapses per-instance label plates into ONE line, keeping their markers", () => {
    const bom = buildBom(model(), LIB);
    const labels = bom.rows.filter((r) => r.key === "__label__");
    expect(labels).toHaveLength(1);
    expect(labels[0].qty).toBe(2);
    expect(labels[0].description).toBe("Label for stopper");
    expect(labels[0].tags).toEqual(["X1", "X2"]);
    expect(labels[0].band).toBeNull();
  });

  it("surfaces human-entered manufacturer/model/description; blank stays blank", () => {
    const bom = buildBom(model(), LIB);
    const psu = row(bom, "psu");
    expect(psu.description).toBe("120W SINGLE OUTPUT SWITCHING POWER SUPPLY, 24VDC");
    expect(psu.manufacturer).toBe("MEANWELL");
    expect(psu.model).toBe("NDR-120-24");
    expect(row(bom, "relay").manufacturer).toBe(""); // not entered → blank (renders "-")
    expect(row(bom, "relay").description).toBe("Relay 24VDC"); // falls back to name
  });

  it("flags unconfirmed estimates and totals all parts", () => {
    const bom = buildBom(model(), LIB);
    expect(row(bom, "psu").confirm).toBe(true);
    expect(row(bom, "relay").confirm).toBe(false);
    expect(bom.totalParts).toBe(1 + 12 + 2 + 2 + 1); // psu + relays + stoppers + labels + custom = 18
  });

  it("ignores unresolved lib_keys (validate() flags those separately)", () => {
    const m = model();
    m.elements.push(el("e_ghost", "does_not_exist"));
    const bom = buildBom(m, LIB);
    expect(bom.rows.some((r) => r.key === "does_not_exist")).toBe(false);
  });
});

describe("manual BOM-only rows", () => {
  it("appends manual lines after the device rows, in order, skipping blanks", () => {
    const m = model();
    m.bom_extras = [
      { id: "x1", item_no: "1", description: "RTU CABINET STEEL SHEET W800xH2000xD500", manufacturer: "LOCAL", model: "", qty: 1 },
      { id: "x2", item_no: "FAN01, FAN02", description: "FAN 220VAC 6\"", manufacturer: "", model: "", qty: 2 },
      { id: "x3", item_no: "", description: "", manufacturer: "", model: "", qty: 0 }, // blank → skipped
    ];
    const bom = buildBom(m, LIB);
    expect(itemNo(row(bom, "extra_x1"))).toBe("1");
    expect(row(bom, "extra_x1").manufacturer).toBe("LOCAL");
    expect(itemNo(row(bom, "extra_x2"))).toBe("FAN01, FAN02");
    expect(row(bom, "extra_x2").qty).toBe(2);
    expect(bom.rows.some((r) => r.key === "extra_x3")).toBe(false);
    // extras come after every counted device row
    const flags = bom.rows.map((r) => r.key.startsWith("extra_"));
    expect(flags.indexOf(true)).toBeGreaterThan(flags.lastIndexOf(false));
    expect(bom.totalParts).toBe(18 + 1 + 2); // devices + cabinet + fans
  });
});

describe("bomToCsv", () => {
  it("emits the shop columns and dashes missing fields", () => {
    const csv = bomToCsv(buildBom(model(), LIB));
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("Item No,Description,Manufacturer,Model,Qty");
    // quoted because the description contains commas
    expect(lines.some((l) => l.startsWith('PS01,"120W SINGLE OUTPUT SWITCHING POWER SUPPLY, 24VDC",MEANWELL,NDR-120-24,1'))).toBe(true);
    // relay set: tags joined, manufacturer/model unentered → "-"
    expect(lines.some((l) => l.includes("Relay 24VDC,-,-,12"))).toBe(true);
  });

  it("includes manual BOM-only rows", () => {
    const m = model();
    m.bom_extras = [{ id: "x1", item_no: "1", description: "RTU CABINET", manufacturer: "LOCAL", model: "", qty: 1 }];
    const csv = bomToCsv(buildBom(m, LIB));
    expect(csv).toContain("1,RTU CABINET,LOCAL,-,1");
  });
});
