import { describe, it, expect } from "vitest";
import { composePageSvg, composeBomPagesSvg } from "./page";
import { newModel } from "../model/factory";

describe("page SVG font", () => {
  it("defaults to Arial; only Thai-bearing runs opt into the embedded Sarabun", () => {
    const page = composePageSvg(newModel("แบบแปลนตู้ RTU - type 2"), {}, "A3");
    // sheet default is Arial (the house font)
    expect(page.svg).toContain(`font-family="Arial, Helvetica, sans-serif"`);
    // the Thai title text run carries Sarabun so it doesn't garble in the PDF
    expect(page.svg).toMatch(/<text[^>]*font-family="Sarabun, Arial, Helvetica, sans-serif"[^>]*>แบบแปลนตู้ RTU - type 2<\/text>/);
  });

  it("a Latin-only sheet has NO per-run Sarabun override (stays pure Arial)", () => {
    const page = composePageSvg(newModel("RTU FLOOR TYPE 4"), {}, "A3");
    expect(page.svg).not.toContain("Sarabun");
    for (const svg of composeBomPagesSvg(newModel("RTU FLOOR TYPE 4"), {}, "A3").svgs)
      expect(svg).not.toContain("Sarabun");
  });
});
