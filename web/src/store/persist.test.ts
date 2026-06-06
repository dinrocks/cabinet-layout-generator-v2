import { describe, it, expect } from "vitest";
import { buildDemo } from "../demo";
import { newModel } from "../model/factory";
import { validate } from "../model/validate";
import { SEED_LIBRARY } from "../model/library";
import { addElement } from "../model/edit";
import type { LayoutModel } from "../model/types";

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
