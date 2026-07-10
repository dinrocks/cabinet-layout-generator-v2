import { describe, it, expect } from "vitest";
import { composePageSvg, composeBomPagesSvg } from "./page";
import type { LayoutModel } from "../model/types";

const model: LayoutModel = {
  project: { id: "p", name: "แบบแปลนตู้ RTU - type 2", panel_tag: "", rev: "A" },
  plate: { width_mm: 800, height_mm: 600, origin: "top_left" },
  ducts: [], elements: [], groups: [], labels: [],
};

describe("page SVG font", () => {
  it("lists Sarabun first so PDF text (incl. Thai titles) uses the embedded font", () => {
    const page = composePageSvg(model, {}, "A3");
    expect(page.svg).toContain(`font-family="Sarabun, Arial, Helvetica, sans-serif"`);
    expect(page.svg).toContain("แบบแปลนตู้ RTU - type 2"); // the Thai title is in the sheet
    for (const svg of composeBomPagesSvg(model, {}, "A3").svgs)
      expect(svg).toContain(`font-family="Sarabun, Arial, Helvetica, sans-serif"`);
  });
});
