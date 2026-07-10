import { describe, it, expect } from "vitest";
import { composePageSvg, composeBomPagesSvg } from "./page";
import { newModel } from "../model/factory";

const model = newModel("แบบแปลนตู้ RTU - type 2");

describe("page SVG font", () => {
  it("lists Sarabun first so PDF text (incl. Thai titles) uses the embedded font", () => {
    const page = composePageSvg(model, {}, "A3");
    expect(page.svg).toContain(`font-family="Sarabun, Arial, Helvetica, sans-serif"`);
    expect(page.svg).toContain("แบบแปลนตู้ RTU - type 2"); // the Thai title is in the sheet
    for (const svg of composeBomPagesSvg(model, {}, "A3").svgs)
      expect(svg).toContain(`font-family="Sarabun, Arial, Helvetica, sans-serif"`);
  });
});
