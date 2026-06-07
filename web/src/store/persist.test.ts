import { describe, it, expect } from "vitest";
import { buildDemo } from "../demo";
import { newModel } from "../model/factory";
import { validate } from "../model/validate";
import { SEED_LIBRARY } from "../model/library";
import { addElement } from "../model/edit";
import { projectLocal } from "./projectStore";
import type { LayoutModel, Library, RectLibItem, DxfLibItem } from "../model/types";

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
