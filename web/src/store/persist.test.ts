import { describe, it, expect } from "vitest";
import { buildDemo } from "../demo";
import { newModel } from "../model/factory";
import { validate } from "../model/validate";
import { SEED_LIBRARY } from "../model/library";
import { addElement } from "../model/edit";
import { projectLocal, cleanProjectLocal } from "./projectStore";
import type { LayoutModel, Library, RectLibItem, DxfLibItem, Element } from "../model/types";

// The cloud + local stores both persist the layout as plain JSON, then re-validate
// it on load. These pure tests guard that contract (the stores themselves need a
// browser/Supabase and are exercised in the live verification).
describe("layout persistence contract", () => {
  it("a model survives JSON serialize → parse unchanged", () => {
    const m = buildDemo();
    const round = JSON.parse(JSON.stringify(m)) as LayoutModel;
    expect(round).toEqual(m);
  });

  it("validate() passes a freshly round-tripped valid model", () => {
    const m = JSON.parse(JSON.stringify(buildDemo())) as LayoutModel;
    expect(validate(m, SEED_LIBRARY).filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("validate() rejects a loaded model whose part isn't in the library (unresolved lib_key)", () => {
    // simulates opening a layout that referenced a custom/uploaded part that is now missing —
    // the Open flow must refuse it rather than draw a ghost.
    const { model } = addElement(newModel("T"), "ghost_part_123", SEED_LIBRARY, 100, 100);
    expect(validate(model, SEED_LIBRARY).filter((i) => i.level === "error").length).toBeGreaterThan(0);
  });
});

describe("projectLocal library filter (what a project carries itself)", () => {
  it("keeps custom + project-local items, drops seed and shared-catalog items", () => {
    const seedKey = Object.keys(SEED_LIBRARY)[0]; // a real seed part
    const custom: RectLibItem = { lib_key: "custom_x", source: "rect", name: "GW", width_mm: 60, height_mm: 60, custom: true };
    const sharedDxf: DxfLibItem = { lib_key: "up_shared", source: "dxf", name: "Shared", width_mm: 30, height_mm: 30, block_ref: "b1", svg_ref: "" };
    const localDxf: DxfLibItem = { lib_key: "up_local", source: "dxf", name: "Local", width_mm: 30, height_mm: 30, block_ref: "b2", svg_ref: "" };
    const library: Library = { [seedKey]: SEED_LIBRARY[seedKey], custom_x: custom, up_shared: sharedDxf, up_local: localDxf };

    const kept = projectLocal(library, new Set(["up_shared"]));
    expect(Object.keys(kept).sort()).toEqual(["custom_x", "up_local"]); // seed + shared excluded
  });
});

describe("cleanProjectLocal (orphan cleanup on save)", () => {
  const el = (id: string, lib_key: string): Element => ({ id, lib_key, tag: "", x_mm: 0, y_mm: 0, rot_deg: 0,
    gap_before_mm: 0.1, clearance_to_duct_mm: 3, group_id: null, locked: false });
  const base = (els: Element[]): LayoutModel => ({
    project: { id: "p", name: "T", panel_tag: "", rev: "A" },
    plate: { width_mm: 800, height_mm: 1000, origin: "top_left" },
    defaults: { gap_between_equipment_mm: 0.1, clearance_equipment_to_duct_mm: 3 },
    ducts: [], elements: els, groups: [], labels: [],
    display: { show_row_clearance_dims: true, snap_enabled: true },
  });

  it("drops unplaced label-plate/custom items but keeps placed ones and all uploads", () => {
    const lib: Library = {
      lbl_used: { lib_key: "lbl_used", source: "rect", name: "", label_plate: true, width_mm: 9, height_mm: 43 },
      lbl_orphan: { lib_key: "lbl_orphan", source: "rect", name: "", label_plate: true, width_mm: 9, height_mm: 43 },
      cust_used: { lib_key: "cust_used", source: "rect", name: "ACME", width_mm: 60, height_mm: 40, custom: true },
      cust_orphan: { lib_key: "cust_orphan", source: "rect", name: "DEAD", width_mm: 60, height_mm: 40, custom: true },
      up_unplaced: { lib_key: "up_unplaced", source: "dxf", name: "Uploaded", width_mm: 30, height_mm: 30, block_ref: "b", svg_ref: "" },
    };
    const model = base([el("e1", "lbl_used"), el("e2", "cust_used")]); // orphans + upload not placed
    const kept = cleanProjectLocal(model, lib, new Set());
    expect(Object.keys(kept).sort()).toEqual(["cust_used", "lbl_used", "up_unplaced"]);
  });

  it("keeps a cap part referenced only by a set", () => {
    const lib: Library = {
      cover_orphan: { lib_key: "cover_orphan", source: "rect", name: "", label_plate: true, width_mm: 2, height_mm: 43 },
    };
    // the label-plate part is used only as a set cap → must be kept
    const model: LayoutModel = { ...base([]), groups: [{ id: "g", kind: "set", lib_key: "term", count: 2,
      internal_gap_mm: 0.1, tag_start: null, tag_step: 1, x_mm: 0, y_mm: 0, rot_deg: 0, exploded: false, label_id: null,
      cap_end_key: "cover_orphan" }] };
    expect(Object.keys(cleanProjectLocal(model, lib, new Set()))).toEqual(["cover_orphan"]);
  });
});
